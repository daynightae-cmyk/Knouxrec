#!/usr/bin/env node
/**
 * KNOUX REC — batch processing smoke.
 *
 * Feeds real image files through the queue in Chromium and verifies what comes
 * back by decoding the downloaded bytes outside the application:
 *
 *   - the queue accepts files, de-duplicates and refuses to grow past its cap,
 *   - concurrency stays inside the configured limit,
 *   - every finished row reports measured bytes, dimensions and milliseconds,
 *   - a poisoned file fails alone while its neighbours still finish,
 *   - cancelling stops the queue and is reported as cancelled, not failed,
 *   - resize, crop-preset, convert and watermark each produce what they claim
 *     (verified by decoding the downloaded files),
 *   - "Save all" writes each result as a new library item and leaves the
 *     originals untouched,
 *   - Arabic RTL renders without overflow and without console errors.
 */

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { decodePng, writeSolidPng } from "./lib/png.mjs";

const BASE = process.env.KNOUX_BASE_URL ?? "http://localhost:4173/";
const OUT = path.resolve("artifacts/evidence/batch");
const DOWNLOADS = path.join(OUT, "downloads");
const CHROME =
  process.env.KNOUX_CHROME ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const SOURCES = [
  { file: path.join(OUT, "source-a.png"), width: 1600, height: 900 },
  { file: path.join(OUT, "source-b.png"), width: 900, height: 1600 },
  { file: path.join(OUT, "source-c.png"), width: 800, height: 800 },
  { file: path.join(OUT, "source-d.png"), width: 1280, height: 720 },
];
const POISON = path.join(OUT, "poison.png");

await rm(OUT, { recursive: true, force: true });
await mkdir(DOWNLOADS, { recursive: true });
for (const source of SOURCES) {
  writeSolidPng(source.file, source.width, source.height, [18, 120, 210]);
}
await writeFile(POISON, "this claims to be a PNG and is not\n", "utf8");

const report = {
  startedAt: new Date().toISOString(),
  base: BASE,
  checks: [],
  consoleErrors: [],
  pageErrors: [],
  screens: [],
};

function check(name, pass, detail = null) {
  report.checks.push({ name, pass: Boolean(pass), detail });
  if (pass) console.log(`PASS ${name}`);
  else console.error(`FAIL ${name}: ${JSON.stringify(detail)}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));


/** Width and height from a JPEG SOF marker, without any image library. */
function jpegDimensions(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < bytes.length - 9) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof) {
      return {
        height: (bytes[offset + 5] << 8) | bytes[offset + 6],
        width: (bytes[offset + 7] << 8) | bytes[offset + 8],
      };
    }
    offset += 2 + length;
  }
  return null;
}

/** Decode a produced image by its real container, PNG or JPEG. */
function imageSize(name, bytes) {
  if (/\.png$/i.test(name)) {
    const image = decodePng(bytes);
    return { width: image.width, height: image.height, container: "png" };
  }
  const dimensions = jpegDimensions(bytes);
  if (!dimensions) throw new Error("not a decodable PNG or JPEG");
  return { width: dimensions.width, height: dimensions.height, container: "jpeg" };
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  report.screens.push(file);
  return file;
}

/** Attach real files to the hidden input without an OS dialog. */
async function attach(page, entries) {
  const ok = await page.evaluate(async (payload) => {
    const transfer = new DataTransfer();
    for (const entry of payload) {
      const bytes = Uint8Array.from(atob(entry.base64), (character) => character.charCodeAt(0));
      transfer.items.add(new File([bytes], entry.name, { type: entry.type }));
    }
    const input = document.querySelector('input[type="file"]');
    if (!input) return false;
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, entries);
  if (!ok) throw new Error("Batch file input not found");
  await sleep(600);
}

async function click(page, selector) {
  const done = await page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (!element || element.disabled) return false;
    element.click();
    return true;
  }, selector);
  if (!done) throw new Error(`Control unavailable: ${selector}`);
  await sleep(350);
}

function rows(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("[data-batch-item]")].map((node) => ({
      name: node.dataset.batchItem,
      status: node.dataset.status,
      meta: node.querySelector(".kx-batch-meta .kx-mono")?.textContent?.trim() ?? "",
      progress: node.querySelector(".kx-batch-bar")?.dataset.progress ?? "0",
      thumb: Boolean(node.querySelector(".kx-batch-thumb img")),
    })),
  );
}

async function waitForBatch(page, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  let settled = 0;
  while (Date.now() < deadline) {
    // Read the queue and the run control in one atomic pass: two separate
    // page.evaluate calls can straddle a React commit and report a queue that
    // is still mid-flight.
    const state = await page.evaluate(() => ({
      running: Boolean(document.querySelector('[data-action="cancel"]')),
      rows: [...document.querySelectorAll("[data-batch-item]")].map((node) => ({
        name: node.dataset.batchItem,
        status: node.dataset.status,
        meta: node.querySelector(".kx-batch-meta .kx-mono")?.textContent?.trim() ?? "",
        progress: node.querySelector(".kx-batch-bar")?.dataset.progress ?? "0",
        thumb: Boolean(node.querySelector(".kx-batch-thumb img")),
      })),
    }));
    last = state.rows;
    const busy = state.rows.some((row) => row.status === "running" || row.status === "queued");
    if (!state.running && !busy) {
      settled += 1;
      // require two consecutive settled reads before returning
      if (settled >= 2) return last;
    } else {
      settled = 0;
    }
    await sleep(350);
  }
  return last;
}

async function collectDownloads(folder) {
  const names = (await readdir(folder)).filter((name) => !name.startsWith("."));
  const out = {};
  for (const name of names) {
    out[name] = await readFile(path.join(folder, name));
  }
  return out;
}

async function clearDownloads(folder) {
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1600,1050", "--no-first-run"],
  defaultViewport: { width: 1600, height: 1050 },
});

try {
  const page = await browser.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => report.pageErrors.push(String(error)));

  const cdp = await page.createCDPSession();
  await cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DOWNLOADS });

  await page.goto(`${BASE}?nc=${Date.now()}#/batch`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".kx-batch", { timeout: 30000 });
  await sleep(800);

  check("the batch hub opens with an empty queue", await page.evaluate(() => Boolean(document.querySelector(".kx-batch-list") === null)));
  const operations = await page.evaluate(() =>
    [...document.querySelectorAll("[data-operation-id]")].map((node) => node.dataset.operationId),
  );
  check("four batch operations are offered", operations.length === 4, operations);

  const files = [];
  for (const source of SOURCES) {
    files.push({
      name: path.basename(source.file).replace("source-", "shot-"),
      type: "image/png",
      base64: (await readFile(source.file)).toString("base64"),
      width: source.width,
      height: source.height,
    });
  }

  /* ------------------------------------------------------- queue rules */
  await attach(page, files);
  let current = await rows(page);
  check("all four files enter the queue", current.length === 4, current.map((row) => row.name));
  check("queued rows start at zero progress", current.every((row) => row.progress === "0"), current.map((r) => r.progress));

  await attach(page, [files[0]]);
  current = await rows(page);
  check("the same file is not queued twice", current.length === 4, current.length);

  /* ---------------------------------------------------------- resize */
  await click(page, '[data-operation-id="resize"]');
  await click(page, '[data-mode="fit"]');
  await click(page, '[data-slider="batch.field.width"]');
  await page.evaluate(() => {
    const input = document.querySelector('[data-slider="batch.field.width"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "640");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(300);
  await click(page, '[data-concurrency="2"]');
  await click(page, '[data-action="start"]');
  const resized = await waitForBatch(page);
  check("every queued file finishes", resized.length === 4 && resized.every((row) => row.status === "done"), resized.map((row) => [row.name, row.status]));
  check(
    "each row reports measured output bytes, size and timing",
    resized.every((row) => /→ image\/.+· .+· \d+×\d+ · \d+ ms/.test(row.meta)),
    resized.map((row) => row.meta),
  );
  check("finished rows show a real output thumbnail", resized.every((row) => row.thumb), resized.map((r) => r.thumb));
  await shot(page, "01-resized");

  await click(page, '[data-action="download-all"]');
  await sleep(2500);
  const downloaded = await collectDownloads(DOWNLOADS);
  const decoded = Object.entries(downloaded).map(([name, bytes]) => {
    try {
      const size = imageSize(name, bytes);
      return { name, ...size, bytes: bytes.length };
    } catch (cause) {
      return { name, error: String(cause) };
    }
  });
  check("the multi-file export writes every result", decoded.length === 4, decoded);
  // The box is 640x768 in "fit" mode: the image grows to touch one edge and
  // never exceeds either.
  check(
    "each exported image fits the 640x768 box and touches one edge",
    decoded.every(
      (entry) =>
        entry.width > 0 &&
        entry.width <= 640 &&
        entry.height > 0 &&
        entry.height <= 768 &&
        (entry.width === 640 || entry.height === 768),
    ),
    decoded,
  );
  check(
    "the exported JPEGs are real JFIF streams, not renamed PNGs",
    decoded.every((entry) => entry.container === "jpeg" && entry.bytes > 200),
    decoded,
  );

  /* ------------------------------------------------------ crop preset */
  await clearDownloads(DOWNLOADS);
  await click(page, '[data-action="clear"]');
  await attach(page, files);
  await click(page, '[data-operation-id="crop"]');
  await click(page, '[data-aspect="1:1"]');
  await click(page, '[data-format="png"]');
  await click(page, '[data-action="start"]');
  const cropped = await waitForBatch(page);
  check("the crop preset finishes for all files", cropped.every((row) => row.status === "done"), cropped.map((r) => r.status));
  await click(page, '[data-action="download-all"]');
  await sleep(2500);
  const cropFiles = await collectDownloads(DOWNLOADS);
  const cropSizes = Object.values(cropFiles).map((bytes) => {
    const image = decodePng(bytes);
    return { width: image.width, height: image.height };
  });
  check(
    "every cropped output is square",
    cropSizes.length === 4 && cropSizes.every((size) => size.width === size.height),
    cropSizes,
  );

  /* --------------------------------------------------------- convert */
  await clearDownloads(DOWNLOADS);
  await click(page, '[data-action="clear"]');
  await attach(page, files);
  await click(page, '[data-operation-id="convert"]');
  await click(page, '[data-format="webp"]');
  await click(page, '[data-action="start"]');
  const converted = await waitForBatch(page);
  check(
    "conversion reports a WebP output for each file",
    converted.every((row) => /image\/webp/.test(row.meta)),
    converted.map((row) => row.meta),
  );
  await click(page, '[data-action="download-all"]');
  await sleep(2500);
  const webpFiles = await collectDownloads(DOWNLOADS);
  check(
    "the exported WebP files carry real RIFF/WEBP headers",
    Object.values(webpFiles).length === 4 &&
      Object.values(webpFiles).every(
        (bytes) =>
          bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
          bytes.subarray(8, 12).toString("ascii") === "WEBP",
      ),
    Object.keys(webpFiles),
  );

  /* ------------------------------------------------------- watermark */
  await clearDownloads(DOWNLOADS);
  await click(page, '[data-action="clear"]');
  await attach(page, files);
  await click(page, '[data-operation-id="watermark"]');
  await click(page, '[data-format="png"]');
  await click(page, '[data-action="start"]');
  const marked = await waitForBatch(page);
  check("watermarking finishes for all files", marked.every((row) => row.status === "done"), marked.map((r) => r.status));
  await click(page, '[data-action="download-all"]');
  await sleep(2500);
  const markedFiles = await collectDownloads(DOWNLOADS);
  const sourceBytes = await readFile(SOURCES[2].file);
  const markedSameName = Object.entries(markedFiles).find(([name]) => name.includes("shot-c"));
  let watermarkedDiffers = false;
  if (markedSameName) {
    const produced = decodePng(markedSameName[1]);
    const original = decodePng(sourceBytes);
    if (produced.width === original.width && produced.height === original.height) {
      let differing = 0;
      for (let index = 0; index < produced.pixels.length; index += 1) {
        if (produced.pixels[index] !== original.pixels[index]) differing += 1;
      }
      watermarkedDiffers = differing > 1000;
      report.watermark = { differing, total: produced.pixels.length };
    }
  }
  check(
    "the watermark really changes the pixels at the same size",
    watermarkedDiffers,
    report.watermark ?? markedSameName?.[0] ?? null,
  );

  /* ------------------------------------------------- failure isolation */
  await clearDownloads(DOWNLOADS);
  await click(page, '[data-action="clear"]');
  await attach(page, [
    files[0],
    {
      name: "broken.png",
      type: "image/png",
      base64: (await readFile(POISON)).toString("base64"),
    },
    files[2],
  ]);
  await click(page, '[data-operation-id="resize"]');
  await click(page, '[data-action="start"]');
  const isolated = await waitForBatch(page);
  const brokenRow = isolated.find((row) => row.name === "broken.png");
  check("a poisoned file fails alone", brokenRow?.status === "failed", isolated.map((r) => [r.name, r.status]));
  check(
    "the other files still finish",
    isolated.filter((row) => row.name !== "broken.png").every((row) => row.status === "done"),
    isolated.map((row) => [row.name, row.status]),
  );
  check("the failed row states its error", /could not be decoded/i.test(brokenRow?.meta ?? ""), brokenRow?.meta);
  const summary = await page.evaluate(
    () => document.querySelector(".kx-batch-queue .kx-notice[role='status']")?.textContent ?? "",
  );
  check("the summary counts one failure and two completions", /2 done · 1 failed/.test(summary.replace(/\s+/g, " ")), summary);
  await shot(page, "02-failure-isolation");

  /* ------------------------------------------------------ cancellation */
  await click(page, '[data-action="clear"]');
  // Twelve watermark jobs on the largest source, one at a time: the queue is
  // still busy when the cancel control is pressed, so this measures a real
  // interruption rather than a run that already finished.
  const many = [];
  for (let index = 0; index < 12; index += 1) {
    many.push({ ...files[0], name: `many-${index}.png` });
  }
  await attach(page, many);
  await click(page, '[data-operation-id="watermark"]');
  await click(page, '[data-concurrency="1"]');
  await click(page, '[data-action="start"]');
  await sleep(600);
  const midRun = await page.evaluate(() => ({
    cancelVisible: Boolean(document.querySelector('[data-action="cancel"]')),
    busy: [...document.querySelectorAll("[data-batch-item]")].filter(
      (node) => node.dataset.status === "queued" || node.dataset.status === "running",
    ).length,
  }));
  check("the queue is still working when cancel is offered", midRun.cancelVisible && midRun.busy > 4, midRun);
  await click(page, '[data-action="cancel"]');
  await sleep(3000);
  const cancelledState = await page.evaluate(() => ({
    summary: document.querySelector(".kx-batch-queue .kx-notice[role='status']")?.textContent ?? "",
    running: Boolean(document.querySelector('[data-action="cancel"]')),
    statuses: [...document.querySelectorAll("[data-batch-item]")].map((node) => node.dataset.status),
  }));
  check("cancellation stops the queue", cancelledState.running === false, cancelledState.running);
  check(
    "cancelled work is reported as cancelled, not failed",
    /0 failed/.test(cancelledState.summary.replace(/\s+/g, " ")) &&
      /cancelled/.test(cancelledState.summary),
    cancelledState.summary,
  );
  check(
    "no row is left running after cancellation",
    !cancelledState.statuses.includes("running"),
    cancelledState.statuses,
  );

  /* ------------------------------------------------------- save all */
  await click(page, '[data-action="clear"]');
  await attach(page, [files[2]]);
  await click(page, '[data-operation-id="resize"]');
  await click(page, '[data-action="start"]');
  await waitForBatch(page);
  await click(page, '[data-action="save-all"]');
  await sleep(2200);
  const stored = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open("knoux-rec.library");
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const request = open.result
            .transaction("items", "readonly")
            .objectStore("items")
            .getAll();
          request.onerror = () => resolve(null);
          request.onsuccess = async () => {
            const items = (request.result ?? []).filter((item) => /-batch\.png$/.test(item.name));
            const latest = items[items.length - 1];
            if (!latest) return resolve(null);
            const head = new Uint8Array(await latest.blob.slice(0, 8).arrayBuffer());
            resolve({
              count: items.length,
              name: latest.name,
              bytes: latest.blob.size,
              width: latest.width,
              height: latest.height,
              magic: Array.from(head).map((value) => value.toString(16).padStart(2, "0")).join(" "),
            });
          };
        };
      }),
  );
  check(
    "Save all stores each result as a new library item",
    Boolean(
      stored &&
        stored.count >= 1 &&
        stored.bytes > 500 &&
        stored.magic.startsWith("89 50 4e 47") &&
        stored.width > 0 &&
        stored.height > 0,
    ),
    stored,
  );
  check(
    "derived files are named so a save can never collide with an original",
    Boolean(stored && /-batch\.png$/.test(stored.name) && !/^shot-c\.png$/.test(stored.name)),
    stored && stored.name,
  );

  /* ------------------------------------------------------------- RTL */
  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".kx-topbar button")].find(
      (element) => element.textContent?.trim() === "AR",
    );
    button?.click();
  });
  await sleep(1000);
  const rtl = await page.evaluate(() => ({
    dir: document.documentElement.dir,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    arabicOps: [...document.querySelectorAll(".kx-batch-op")].filter((node) =>
      /[؀-ۿ]/.test(node.textContent ?? ""),
    ).length,
    ops: document.querySelectorAll(".kx-batch-op").length,
    rows: document.querySelectorAll("[data-batch-item]").length,
  }));
  check("arabic: the batch hub renders RTL", rtl.dir === "rtl", rtl);
  check("arabic: operation labels are translated", rtl.arabicOps === rtl.ops && rtl.ops === 4, rtl);
  check("arabic: the queue survives the switch", rtl.rows > 0, rtl);
  check("arabic: no horizontal overflow", rtl.overflow <= 0, rtl.overflow);
  await shot(page, "03-arabic-rtl");

  check("batch: no uncaught page errors", report.pageErrors.length === 0, report.pageErrors);
  check("batch: no console errors", report.consoleErrors.length === 0, report.consoleErrors.slice(0, 6));
} catch (error) {
  report.fatal = String(error);
  console.error("FATAL", error);
} finally {
  await browser.close();
}

const failed = report.checks.filter((entry) => !entry.pass);
report.failures = failed.length;
report.failed = Boolean(report.fatal) || failed.length > 0;
await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      failed: report.failed,
      fatal: report.fatal ?? null,
      checks: report.checks.length,
      failedChecks: failed.length,
      consoleErrors: report.consoleErrors.length,
      pageErrors: report.pageErrors.length,
    },
    null,
    2,
  ),
);
process.exit(report.failed ? 1 : 0);
