#!/usr/bin/env node
/**
 * KNOUX REC — workflow chain smoke.
 *
 * Runs the four named chains in Chromium and checks that every step reports
 * bytes the real processors produced. The chains are also composed: the WebM
 * that the motion-ident chain encodes becomes the input for the clip-cover and
 * trim-and-cover chains, so the test proves the artefacts are usable media and
 * not just non-empty blobs.
 */

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { writeSolidPng } from "./lib/png.mjs";

const BASE = process.env.KNOUX_BASE_URL ?? "http://localhost:4173/";
const OUT = path.resolve("artifacts/evidence/workflows");
const DOWNLOADS = path.join(OUT, "downloads");
const CHROME =
  process.env.KNOUX_CHROME ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const SOURCE_PNG = path.join(OUT, "chain-source.png");

await rm(OUT, { recursive: true, force: true });
await mkdir(DOWNLOADS, { recursive: true });
writeSolidPng(SOURCE_PNG, 900, 500, [30, 110, 190]);

const report = {
  startedAt: new Date().toISOString(),
  base: BASE,
  checks: [],
  steps: [],
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

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  report.screens.push(file);
  return file;
}

/** Evidence of the chain card itself, scrolled into view. */
async function shotChains(page, name) {
  const file = path.join(OUT, `${name}.png`);
  const element = await page.$(".kx-chains");
  if (!element) return shot(page, name);
  await element.scrollIntoView();
  await sleep(300);
  await element.screenshot({ path: file });
  report.screens.push(file);
  return file;
}

async function selectChain(page, id) {
  await page.evaluate((chainId) => {
    document.querySelector(`[data-chain-id="${chainId}"]`)?.click();
  }, id);
  await sleep(300);
}

/** Feed a real file into the active chain's input without any OS dialog. */
async function supplyFile(page, inputSelector, name, type, base64) {
  const ok = await page.evaluate(
    async ({ selector, fileName, mime, payload }) => {
      const bytes = Uint8Array.from(atob(payload), (character) =>
        character.charCodeAt(0),
      );
      const file = new File([bytes], fileName, { type: mime });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const input = document.querySelector(selector);
      if (!input) return false;
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    { selector: inputSelector, fileName: name, mime: type, payload: base64 },
  );
  if (!ok) throw new Error(`Input not found: ${inputSelector}`);
  await sleep(400);
}

function readSteps(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("[data-chain-step]")].map((node) => ({
      id: node.dataset.chainStep,
      ok: node.dataset.ok,
      outcome: node.querySelector(".kx-chain-outcome")?.textContent?.trim() ?? "",
      processor: node.querySelector(".kx-chain-processor")?.textContent?.trim() ?? "",
    })),
  );
}

function readOutputs(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("[data-chain-output]")].map((node) => ({
      name: node.querySelector(".kx-chain-output-name")?.textContent?.trim() ?? "",
      meta: node.querySelectorAll("span")[1]?.textContent?.trim() ?? "",
    })),
  );
}

async function runActiveChain(page, timeoutMs = 60000) {
  await page.evaluate(() => document.querySelector("[data-chain-run]")?.click());
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => ({
      running: Boolean(document.querySelector("[data-chain-cancel]")),
      outputs: document.querySelectorAll("[data-chain-output]").length,
      error: document.querySelector(".kx-chains .kx-notice[data-tone='danger']")?.textContent ?? "",
    }));
    if (!state.running && (state.outputs > 0 || state.error)) return state;
    await sleep(400);
  }
  return { running: true, outputs: 0, error: "timeout" };
}

async function waitForDownload(folder, extension) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const files = (await readdir(folder)).filter((name) => name.endsWith(extension));
    if (files.length) return path.join(folder, files[0]);
    await sleep(300);
  }
  return null;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--autoplay-policy=no-user-gesture-required",
    "--window-size=1600,1100",
    "--no-first-run",
  ],
  defaultViewport: { width: 1600, height: 1100 },
});

try {
  const page = await browser.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => report.pageErrors.push(String(error)));

  const cdp = await page.createCDPSession();
  await cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DOWNLOADS });

  await page.goto(`${BASE}?nc=${Date.now()}#/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".kx-chains", { timeout: 30000 });
  await sleep(900);

  const chips = await page.evaluate(
    () => [...document.querySelectorAll("[data-chain-id]")].map((node) => node.dataset.chainId),
  );
  check("four named chains are offered", chips.length === 4, chips);
  const processors = await page.evaluate(() =>
    [...document.querySelectorAll(".kx-chain-processor")].map((node) => node.textContent),
  );
  check(
    "every step names an existing processor rather than a simulated one",
    processors.length === 4 && processors.every((name) => /\w+\.\w+/.test(name ?? "")),
    processors,
  );
  /* ------------------------------------------------ motion ident first */
  await selectChain(page, "motion-ident");
  const templateChoice = await page.evaluate(
    () => document.querySelectorAll("[data-chain-template] option").length,
  );
  check("the template chain lists the real catalogue", templateChoice >= 5, templateChoice);
  await page.evaluate(() => {
    const input = document.querySelector("[data-chain-title]");
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(input, "KNOUX CHAIN");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const ident = await runActiveChain(page, 90000);
  const identSteps = await readSteps(page);
  const identOutputs = await readOutputs(page);
  check("motion ident completes", ident.outputs === 2 && !ident.error, ident);
  check(
    "motion ident reports a timed result for both steps",
    identSteps.length === 2 &&
      identSteps.every((step) => step.ok === "true" && /\d+ ms/.test(step.outcome)),
    identSteps,
  );
  const still = identOutputs[0] ?? {};
  const video = identOutputs[1] ?? {};
  check("the still step reports 1280x720 PNG bytes", /ident-still\.png/.test(still.name) && /1280×720/.test(still.meta), still);
  check(
    "the video step reports the real encode: codec, frames and duration",
    (identSteps[1]?.outcome ?? "").includes("frames") &&
      /vp8|vp9/i.test(identSteps[1]?.outcome ?? ""),
    identSteps[1],
  );
  check(
    "the WebM artefact is offered for reuse with its duration",
    /ident\.webm/.test(video.name) && /video\/webm/.test(video.meta) && /s/.test(video.meta),
    video,
  );
  await shotChains(page, "01-motion-ident");

  /* ------------------------------------------- reuse the encoded WebM */
  // Pull the WebM out of the chain by using its own download control, then
  // feed the bytes back in as the source of the next two chains.
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll("[data-chain-output]")];
    const row = rows.find((node) => /ident\.webm/.test(node.textContent ?? ""));
    const button = [...(row?.querySelectorAll("button") ?? [])].find((node) =>
      /download/i.test(node.textContent ?? ""),
    );
    button?.click();
  });
  const webmPath = await waitForDownload(DOWNLOADS, ".webm");
  check("the chain's WebM can be downloaded", Boolean(webmPath), webmPath);
  let webmBytes = null;
  if (webmPath) {
    webmBytes = await readFile(webmPath);
    const magic = Array.from(webmBytes.subarray(0, 4))
      .map((value) => value.toString(16).padStart(2, "0"))
      .join(" ");
    check(
      "the encoded video carries a genuine EBML header",
      magic === "1a 45 df a3" && webmBytes.length > 2000,
      { magic, bytes: webmBytes.length },
    );
  }

  /* ------------------------------------------------------ clip cover */
  if (webmBytes) {
    await rm(DOWNLOADS, { recursive: true, force: true });
    await mkdir(DOWNLOADS, { recursive: true });
    await selectChain(page, "clip-cover");
    await supplyFile(
      page,
      '[data-chain-input="clip-cover"]',
      "ident.webm",
      "video/webm",
      webmBytes.toString("base64"),
    );
    const clip = await runActiveChain(page, 60000);
    const clipSteps = await readSteps(page);
    const clipOutputs = await readOutputs(page);
    check("clip cover completes on the generated video", clip.outputs === 2 && !clip.error, clip);
    check(
      "the frame step reports real dimensions",
      /\d+x\d+/.test(clipSteps[0]?.outcome ?? ""),
      clipSteps[0],
    );
    check(
      "the palette step lists sampled colours",
      /#([0-9a-f]{6})\s+#/i.test(clipSteps[1]?.outcome ?? ""),
      clipSteps[1],
    );
    check("clip cover yields a PNG frame and a palette image", /clip-cover\.png/.test(clipOutputs[0]?.name ?? "") && /clip-palette\.png/.test(clipOutputs[1]?.name ?? ""), clipOutputs);
    await shotChains(page, "02-clip-cover");

    /* ------------------------------------------------------ trim chain */
    await selectChain(page, "trim-and-cover");
    await supplyFile(
      page,
      '[data-chain-input="trim-and-cover"]',
      "ident.webm",
      "video/webm",
      webmBytes.toString("base64"),
    );
    const trim = await runActiveChain(page, 90000);
    const trimSteps = await readSteps(page);
    check("trim and cover completes", trim.outputs === 2 && !trim.error, trim);
    check(
      "the trim step re-encodes real bytes",
      /trimmed\.webm|B ·/.test(trimSteps[0]?.outcome ?? "") &&
        (trimSteps[0]?.ok ?? "") === "true",
      trimSteps[0],
    );
    check(
      "the cover step reads a frame from the trimmed clip",
      (trimSteps[1]?.ok ?? "") === "true" && /\d+x\d+/.test(trimSteps[1]?.outcome ?? ""),
      trimSteps[1],
    );
  }

  /* ---------------------------------------------------- social cover */
  await selectChain(page, "social-cover");
  const pngBase64 = (await readFile(SOURCE_PNG)).toString("base64");
  await supplyFile(page, '[data-chain-input="social-cover"]', "source.png", "image/png", pngBase64);
  const cover = await runActiveChain(page, 60000);
  const coverSteps = await readSteps(page);
  const coverOutputs = await readOutputs(page);
  check("social cover completes through all four processors", cover.outputs === 1 && !cover.error, cover);
  check(
    "each social-cover step reports its own bytes and timing",
    coverSteps.length === 4 &&
      coverSteps.every((step) => step.ok === "true" && /B · \d+ ms/.test(step.outcome)),
    coverSteps,
  );
  check(
    "the crop step lands the artefact on the exact 1200x630 share box",
    coverSteps[1]?.outcome?.startsWith("1200x630") === true &&
      coverSteps[3]?.outcome?.startsWith("1200x630") === true,
    coverSteps.map((step) => step.outcome),
  );
  check(
    "the final artefact is a WebP at the share box",
    /cover\.webp/.test(coverOutputs[0]?.name ?? "") && /1200×630/.test(coverOutputs[0]?.meta ?? ""),
    coverOutputs[0],
  );

  await page.evaluate(() => {
    const row = document.querySelector("[data-chain-output]");
    const button = [...(row?.querySelectorAll("button") ?? [])].find((node) =>
      /download/i.test(node.textContent ?? ""),
    );
    button?.click();
  });
  const webpPath = await waitForDownload(DOWNLOADS, ".webp");
  check("the WebP cover downloads", Boolean(webpPath), webpPath);
  if (webpPath) {
    const bytes = await readFile(webpPath);
    const riff = bytes.subarray(0, 4).toString("ascii");
    const webp = bytes.subarray(8, 12).toString("ascii");
    check(
      "the downloaded cover is a genuine RIFF/WEBP container",
      riff === "RIFF" && webp === "WEBP" && bytes.length > 500,
      { riff, webp, bytes: bytes.length },
    );
  }

  /* ------------------------------------------------------ library save */
  await page.evaluate(() => {
    const row = document.querySelector("[data-chain-output]");
    const button = [...(row?.querySelectorAll("button") ?? [])].find((node) =>
      /save to library/i.test(node.textContent ?? ""),
    );
    button?.click();
  });
  await sleep(1500);
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
            const items = (request.result ?? []).filter((item) => item.name === "cover.webp");
            const latest = items[items.length - 1];
            if (!latest) return resolve(null);
            const bytes = new Uint8Array(await latest.blob.slice(0, 12).arrayBuffer());
            resolve({
              name: latest.name,
              kind: latest.kind,
              bytes: latest.blob.size,
              head: Array.from(bytes).join(","),
            });
          };
        };
      }),
  );
  check(
    "a chain output can be archived into the library",
    Boolean(stored && stored.bytes > 500 && stored.kind === "image"),
    stored,
  );

  /* --------------------------------------------------------- cancel it */
  await selectChain(page, "social-cover");
  await supplyFile(page, '[data-chain-input="social-cover"]', "source.png", "image/png", pngBase64);
  await page.evaluate(() => document.querySelector("[data-chain-run]")?.click());
  await sleep(120);
  await page.evaluate(() => document.querySelector("[data-chain-cancel]")?.click());
  await sleep(1200);
  const cancelled = await page.evaluate(() => ({
    message: document.querySelector(".kx-chains .kx-notice[data-tone='danger']")?.textContent ?? "",
    outputs: document.querySelectorAll("[data-chain-output]").length,
    running: Boolean(document.querySelector("[data-chain-cancel]")),
  }));
  check(
    "a running chain can be cancelled and reports it honestly",
    /cancelled/i.test(cancelled.message) && cancelled.outputs === 0 && !cancelled.running,
    cancelled,
  );

  /* ------------------------------------------------------------ RTL */
  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".kx-topbar button")].find(
      (element) => element.textContent?.trim() === "AR",
    );
    button?.click();
  });
  await sleep(900);
  const rtl = await page.evaluate(() => ({
    dir: document.documentElement.dir,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    arabicSteps: [...document.querySelectorAll(".kx-chain-name")].filter((node) =>
      /[؀-ۿ]/.test(node.textContent ?? ""),
    ).length,
    steps: document.querySelectorAll("[data-chain-step]").length,
  }));
  check("arabic: the chain section renders RTL", rtl.dir === "rtl", rtl);
  check("arabic: step names are translated", rtl.arabicSteps === rtl.steps && rtl.steps > 0, rtl);
  check("arabic: no horizontal overflow", rtl.overflow <= 0, rtl.overflow);
  await shotChains(page, "03-arabic-rtl");

  check("workflows: no uncaught page errors", report.pageErrors.length === 0, report.pageErrors);
  check(
    "workflows: no console errors",
    report.consoleErrors.length === 0,
    report.consoleErrors.slice(0, 5),
  );
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
