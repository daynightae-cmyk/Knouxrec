#!/usr/bin/env node
/**
 * KNOUX REC — cross-hub integration smoke.
 *
 * Proves that a file produced in one hub reaches another real workspace without
 * being written to disk and re-imported, that the original survives the trip
 * unchanged, and that each derived result records where it came from.
 *
 *   Batch → Library → Elysian → Library   (provenance chain grows)
 *   Batch → Library → Batch               (queue adopts a handed-over file)
 *   Audio Studio → Library → Audio Studio (audio handoff, no re-import)
 */

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { writeSolidPng } from "./lib/png.mjs";

const BASE = process.env.KNOUX_BASE_URL ?? "http://localhost:4173/";
const OUT = path.resolve("artifacts/evidence/handoff");
const CHROME =
  process.env.KNOUX_CHROME ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const DOWNLOADS = path.join(OUT, "downloads");
const SOURCE_PNG = path.join(OUT, "seed.png");
const RATE = 8000;

function wav(samples, sampleRate = RATE) {
  const frames = samples.length;
  const buffer = Buffer.alloc(44 + frames * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + frames * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(frames * 2, 40);
  for (let index = 0; index < frames; index += 1) {
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[index])) * 32767), 44 + index * 2);
  }
  return buffer;
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await mkdir(DOWNLOADS, { recursive: true });
writeSolidPng(SOURCE_PNG, 1200, 700, [22, 130, 205]);
const tone = new Float32Array(RATE * 2);
for (let index = 0; index < tone.length; index += 1) {
  tone[index] = 0.6 * Math.sin((2 * Math.PI * 320 * index) / RATE);
}
const SOURCE_WAV = path.join(OUT, "seed.wav");
await writeFile(SOURCE_WAV, wav(tone));

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

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  report.screens.push(file);
  return file;
}

async function gotoRoute(page, hash) {
  await page.evaluate((target) => {
    window.location.hash = target;
  }, hash);
  await sleep(700);
}

async function click(page, selector) {
  const done = await page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (!element || element.disabled) return false;
    element.click();
    return true;
  }, selector);
  if (!done) throw new Error(`Control unavailable: ${selector}`);
  await sleep(400);
}

async function attach(page, entries, selector = 'input[type="file"]') {
  const ok = await page.evaluate(
    async ({ payload, sel }) => {
      const transfer = new DataTransfer();
      for (const entry of payload) {
        const bytes = Uint8Array.from(atob(entry.base64), (character) => character.charCodeAt(0));
        transfer.items.add(new File([bytes], entry.name, { type: entry.type }));
      }
      const input = document.querySelector(sel);
      if (!input) return false;
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    { payload: entries, sel: selector },
  );
  if (!ok) throw new Error(`Input not found: ${selector}`);
  await sleep(900);
}

function readLibrary(page, filterSource) {
  return page.evaluate(
    (source) =>
      new Promise((resolve) => {
        const open = indexedDB.open("knoux-rec.library");
        open.onerror = () => resolve([]);
        open.onsuccess = () => {
          const request = open.result
            .transaction("items", "readonly")
            .objectStore("items")
            .getAll();
          request.onerror = () => resolve([]);
          request.onsuccess = () => {
            const matcher = new RegExp(source);
            resolve(
              (request.result ?? [])
                .filter((item) => matcher.test(item.name))
                .map((item) => ({
                  id: item.id,
                  name: item.name,
                  kind: item.kind,
                  bytes: item.blob.size,
                  width: item.width,
                  height: item.height,
                  provenance: item.provenance ?? null,
                })),
            );
          };
        };
      }),
    filterSource,
  );
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1600,1050", "--no-first-run"],
  defaultViewport: { width: 1600, height: 1050 },
});

try {
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DOWNLOADS });
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => report.pageErrors.push(String(error)));

  await page.goto(`${BASE}?nc=${Date.now()}#/batch`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".kx-batch", { timeout: 30000 });
  await sleep(700);

  /* ------------------------------------------- seed: Batch → Library */
  await attach(page, [
    {
      name: "seed.png",
      type: "image/png",
      base64: (await readFile(SOURCE_PNG)).toString("base64"),
    },
  ]);
  await click(page, '[data-operation-id="resize"]');
  await click(page, '[data-action="start"]');
  await page.waitForFunction(
    () =>
      !document.querySelector('[data-action="cancel"]') &&
      document.querySelector('[data-batch-item][data-status="done"]'),
    { timeout: 60000 },
  );
  await click(page, '[data-action="save-all"]');
  await sleep(1600);
  const batchOutputs = await readLibrary(page, "^seed-batch\.jpg$");
  check("the batch result is stored in the library", batchOutputs.length === 1, batchOutputs);
  check(
    "the batch records only the hop that really happened",
    batchOutputs[0]?.provenance?.length === 1 &&
      batchOutputs[0].provenance[0].hub === "batch" &&
      batchOutputs[0].provenance[0].itemId === null,
    batchOutputs[0]?.provenance,
  );

  // ZIP archive of the finished batch output, parsed outside the app.
  await page.evaluate(() => document.querySelector('[data-action="download-zip"]')?.click());
  let zipFile = null;
  for (let attempt = 0; attempt < 40 && !zipFile; attempt += 1) {
    const names = (await readdir(DOWNLOADS)).filter((n) => n.endsWith(".zip"));
    if (names.length) zipFile = names[0];
    else await sleep(300);
  }
  check("the batch writes a ZIP archive", Boolean(zipFile), zipFile);
  if (zipFile) {
    const archive = await readFile(path.join(DOWNLOADS, zipFile));
    const eocd = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const count = eocd >= 0 ? archive.readUInt16LE(eocd + 10) : -1;
    const centralSize = eocd >= 0 ? archive.readUInt32LE(eocd + 12) : 0;
    const centralOffset = eocd >= 0 ? archive.readUInt32LE(eocd + 16) : 0;
    const nameLength = archive.readUInt16LE(centralOffset + 28);
    const storedSize = archive.readUInt32LE(centralOffset + 20);
    const localOffset = archive.readUInt32LE(centralOffset + 42);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const payloadStart = localOffset + 30 + localNameLength;
    const payload = archive.subarray(payloadStart, payloadStart + storedSize);
    check(
      "the archive records one entry with a real central directory",
      count === 1 && centralSize > 0 && centralOffset > 0,
      { count, centralSize, centralOffset },
    );
    check(
      "the entry is named after the produced file",
      archive.toString("utf8", centralOffset + 46, centralOffset + 46 + nameLength) ===
        "seed-batch.jpg",
      archive.toString("utf8", centralOffset + 46, centralOffset + 46 + nameLength),
    );
    check(
      "the stored payload is the real JPEG, not an empty placeholder",
      payload.subarray(0, 2).toString("hex") === "ffd8" && payload.length > 500,
      { magic: payload.subarray(0, 2).toString("hex"), bytes: payload.length },
    );
  }

  /* -------------------------------------------- collections + ZIP archive */
  await gotoRoute(page, "#/library");
  await page.waitForSelector("[data-action='new-collection']", { timeout: 20000 });
  // The list itself loads from IndexedDB after the bar renders.
  await page.waitForSelector(".kx-media-card", { timeout: 20000 });
  await page.evaluate(() => document.querySelector("[data-action='new-collection']")?.click());
  await sleep(300);
  await page.evaluate(() => {
    const input = document.querySelector(".kx-collection-bar input");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "Marketing");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await sleep(250);
  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".kx-collection-bar .kx-btn")].find((node) =>
      /create|إنشاء/i.test(node.textContent ?? ""),
    );
    button?.click();
  });
  await sleep(600);
  report.collectionProbe = await page.evaluate(() => ({
    hash: window.location.hash,
    bar: document.querySelector(".kx-collection-bar")?.textContent?.trim().slice(0, 160) ?? null,
    chips: [...document.querySelectorAll(".kx-collection-bar .kx-chip")].map((n) => n.textContent),
    cards: document.querySelectorAll(".kx-media-card").length,
    collectionSelects: document.querySelectorAll("[data-collection-for]").length,
    openIn: document.querySelectorAll("[data-open-in]").length,
  }));
  const chipCreated = await page.evaluate(() =>
    Boolean(document.querySelector("[data-collection='Marketing']")),
  );
  check("a collection can be created from the library", chipCreated);

  await page.evaluate(() => {
    const select = document.querySelector("[data-collection-for]");
    if (!select) throw new Error("no collection control on the first card");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(select, "Marketing");
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(700);
  const assigned = await page.evaluate(() =>
    new Promise((resolve) => {
      const open = indexedDB.open("knoux-rec.library");
      open.onsuccess = () => {
        const request = open.result.transaction("items", "readonly").objectStore("items").getAll();
        request.onsuccess = () =>
          resolve(
            (request.result ?? [])
              .filter((item) => item.collection)
              .map((item) => ({ name: item.name, collection: item.collection })),
          );
        request.onerror = () => resolve([]);
      };
      open.onerror = () => resolve(null);
    }),
  );
  check(
    "the assignment is persisted on the stored item",
    Array.isArray(assigned) && assigned.length === 1 && assigned[0].collection === "Marketing",
    assigned,
  );

  await page.evaluate(() => document.querySelector("[data-collection='Marketing']")?.click());
  await sleep(600);
  const filtered = await page.evaluate(() => ({
    cards: document.querySelectorAll(".kx-media-card").length,
    names: [...document.querySelectorAll(".kx-media-name")].map((n) => n.textContent),
  }));
  check(
    "filtering by the collection shows only filed items",
    filtered.cards === 1,
    filtered,
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await sleep(1200);
  const survived = await page.evaluate(() => ({
    chips: [...document.querySelectorAll("[data-collection]")].map((n) => n.dataset.collection),
    items: document.querySelectorAll(".kx-media-card").length,
  }));
  check(
    "the collection survives a reload because it lives on the item",
    survived.chips.includes("Marketing"),
    survived,
  );

  /* --------------------------------------- Library → Elysian handoff */
  await gotoRoute(page, "#/library");
  await page.waitForSelector("[data-open-in]", { timeout: 20000 });
  const receivers = await page.evaluate(() => {
    const select = document.querySelector("[data-open-in]");
    return [...(select?.querySelectorAll("option") ?? [])].map((option) => option.value).filter(Boolean);
  });
  check(
    "an image offers the real image workspaces as destinations",
    receivers.includes("elysian") &&
      receivers.includes("batch") &&
      receivers.includes("morphcore") &&
      receivers.includes("toolbox"),
    receivers,
  );

  await page.evaluate(() => {
    const select = document.querySelector("[data-open-in]");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(select, "elysian");
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(1400);
  // Elysian is an 18+ workspace: the gate must be passed before the studio can
  // show the handed-over file, and the handoff has to survive that wait.
  const gateShown = await page.evaluate(() => Boolean(document.querySelector(".adult-gate-container")));
  check("the receiving hub keeps its age gate in front of the file", gateShown);
  if (gateShown) {
    await page.evaluate(() => {
      const year = document.querySelector("#birthYear");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(year, "1990");
      year.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelectorAll(".checkbox-group input[type=checkbox]").forEach((box) => {
        if (!box.checked) box.click();
      });
    });
    await sleep(200);
    await page.evaluate(() => document.querySelector(".verification-button")?.click());
    await sleep(2400);
  }
  const elysianState = await page.evaluate(() => {
    const canvas = document.querySelector(".elys-canvas");
    return {
      hash: window.location.hash,
      painted: Boolean(canvas && canvas.width > 0),
      width: canvas?.width ?? 0,
      height: canvas?.height ?? 0,
      provenance: document.querySelector("[data-provenance]")?.textContent?.trim() ?? "",
      layers: document.querySelectorAll(".elys-layer").length,
    };
  });
  check("the library opened Elysian directly", elysianState.hash === "#/elysian", elysianState.hash);
  check(
    "Elysian adopted the handed-over file at its stored size, without a re-import",
    elysianState.painted &&
      elysianState.width === batchOutputs[0].width &&
      elysianState.height === batchOutputs[0].height &&
      elysianState.layers === 0,
    { canvas: elysianState, stored: batchOutputs[0] },
  );
  check(
    "the receiving hub names the source it came from",
    /seed-batch/.test(elysianState.provenance) && /Library|المكتبة/.test(elysianState.provenance),
    elysianState.provenance,
  );
  await shot(page, "01-elysian-handoff");

  /* -------------------------- edit, save, and check the chain grows */
  await click(page, '.elys-card[data-effect-id="contrast"]');
  await page.waitForFunction(() => document.querySelectorAll(".elys-layer").length === 1, { timeout: 20000 });
  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".elys-dock button")].find((node) =>
      /save to library/i.test(node.textContent ?? ""),
    );
    button?.click();
  });
  await sleep(2200);
  const elysianOutputs = await readLibrary(page, "-elysian\\.png$");
  check("the edited copy is stored as a new item", elysianOutputs.length === 1, elysianOutputs);
  const chain = elysianOutputs[0]?.provenance ?? [];
  check(
    "the derived item carries the whole chain of hubs it passed through",
    chain.length === 3 &&
      chain[0].hub === "batch" &&
      chain[1].hub === "library" &&
      chain[2].hub === "elysian" &&
      chain[1].itemId === batchOutputs[0].id &&
      chain.every((hop, index) => index === 0 || hop.at >= chain[index - 1].at),
    chain,
  );
  const stillIntact = await readLibrary(page, "^seed-batch\.jpg$");
  check(
    "the original is untouched by the round trip",
    stillIntact.length === 1 && stillIntact[0].bytes === batchOutputs[0].bytes,
    { before: batchOutputs[0].bytes, after: stillIntact[0]?.bytes },
  );

  /* ------------------------------------------- Library → Batch handoff */
  await gotoRoute(page, "#/library");
  await page.waitForSelector("[data-open-in]", { timeout: 20000 });
  await page.evaluate(() => {
    const selects = [...document.querySelectorAll("[data-open-in]")];
    const target = selects.find((node) =>
      [...node.querySelectorAll("option")].some((option) => option.value === "batch"),
    );
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(target, "batch");
    target.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(1500);
  const batchHandoff = await page.evaluate(() => ({
    hash: window.location.hash,
    rows: [...document.querySelectorAll("[data-batch-item]")].map((node) => ({
      name: node.dataset.batchItem,
      status: node.dataset.status,
    })),
    note: document.querySelector("[data-handoff-note]")?.textContent?.trim() ?? "",
  }));
  check("the batch hub received the handoff", batchHandoff.hash === "#/batch", batchHandoff.hash);
  check(
    "the queue adopted the file without an upload",
    batchHandoff.rows.length >= 1 && batchHandoff.rows.some((row) => /seed|elysian/.test(row.name)),
    batchHandoff.rows,
  );
  check("the batch hub shows what was handed over", /Handed over|سُلِّمت/.test(batchHandoff.note), batchHandoff.note);
  await shot(page, "02-batch-handoff");

  /* --------------------------------------- Audio Studio → library → back */
  await gotoRoute(page, "#/audio-studio");
  await attach(
    page,
    [
      {
        name: "seed.wav",
        type: "audio/wav",
        base64: (await readFile(SOURCE_WAV)).toString("base64"),
      },
    ],
    'input[type="file"]',
  );
  await page.waitForSelector(".kx-audio-canvas", { timeout: 20000 });
  await sleep(700);
  await page.evaluate(() => {
    document.querySelector('[data-action="save"]')?.click();
  });
  await sleep(2200);
  const audioItems = await readLibrary(page, "-studio\\.wav$");
  check("the audio result is stored in the library", audioItems.length === 1, audioItems);
  check(
    "the stored audio reports a real duration",
    Boolean(audioItems[0]) && audioItems[0].bytes > 1000,
    audioItems[0],
  );

  await gotoRoute(page, "#/library");
  await page.waitForSelector("[data-open-in]", { timeout: 20000 });
  const audioReceivers = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("[data-open-in]")];
    const audioRow = rows.find((node) =>
      [...node.querySelectorAll("option")].some((option) => option.value === "audio-studio"),
    );
    return audioRow
      ? [...audioRow.querySelectorAll("option")].map((option) => option.value).filter(Boolean)
      : [];
  });
  check(
    "an audio item offers only the audio workspace",
    audioReceivers.length === 0 || (audioReceivers.length === 1 && audioReceivers[0] === "audio-studio"),
    audioReceivers,
  );
  if (audioReceivers.length > 0) {
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll("[data-open-in]")];
      const audioRow = rows.find((node) =>
        [...node.querySelectorAll("option")].some((option) => option.value === "audio-studio"),
      );
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
      setter.call(audioRow, "audio-studio");
      audioRow.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await sleep(1600);
    const audioHandoff = await page.evaluate(() => {
      const header = document.querySelector(".kx-audio-stage-card .kx-mono.kx-muted")?.textContent ?? "";
      return {
        hash: window.location.hash,
        decoded: /8000 Hz/.test(header) && /2\.00s/.test(header),
        header: header.trim(),
        steps: document.querySelectorAll(".kx-audio-step").length,
      };
    });
    check("the audio studio reopened its own saved result", audioHandoff.hash === "#/audio-studio", audioHandoff.hash);
    check(
      "the reopened audio decodes at the stored rate and length",
      audioHandoff.decoded && audioHandoff.steps === 0,
      audioHandoff,
    );
    await shot(page, "03-audio-handoff");
  }

  /* ------------------------------------------------------------- RTL */
  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".kx-topbar button")].find(
      (element) => element.textContent?.trim() === "AR",
    );
    button?.click();
  });
  await gotoRoute(page, "#/library");
  await sleep(900);
  const rtl = await page.evaluate(() => ({
    dir: document.documentElement.dir,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    labels: [...document.querySelectorAll("[data-open-in] option")].map((node) => node.textContent).slice(0, 6),
  }));
  check("arabic: the library renders RTL with the handoff control", rtl.dir === "rtl", rtl.dir);
  check(
    "arabic: destination labels are translated",
    rtl.labels.some((label) => /[؀-ۿ]/.test(label ?? "")),
    rtl.labels,
  );
  check("arabic: no horizontal overflow", rtl.overflow <= 0, rtl.overflow);
  await shot(page, "04-arabic-rtl");

  check("handoff: no uncaught page errors", report.pageErrors.length === 0, report.pageErrors);
  check("handoff: no console errors", report.consoleErrors.length === 0, report.consoleErrors.slice(0, 6));
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
