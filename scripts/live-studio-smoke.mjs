#!/usr/bin/env node
/**
 * KNOUX REC — KNOuX LIVE STUDIO smoke.
 *
 * Drives the shared execution workspace with real jobs:
 *   1. image tool (QR) — run, live timeline, result dock, Save to Library,
 *      Retry through the same engine, Reopen the owning service,
 *   2. image tool with file input (resize) — before/after comparison slider,
 *   3. audio tool (waveform) — real decoded samples, waveform result, playback,
 *   4. template video export — the WebM encoder feeds the same workspace,
 *   5. recording — an authorized fake display stream produces a playable result,
 *   6. cancellation — a long audio job is really cancelled,
 *   7. Arabic RTL — localized stages and no horizontal overflow.
 *
 * Every assertion reads the genuine registry: the timeline entries, artifact
 * bytes and preview elements all come from the processor that ran.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.KNOUX_BASE_URL ?? "http://localhost:4173/";
const OUT = path.resolve("artifacts/evidence/live-studio");
const CHROME =
  process.env.KNOUX_CHROME ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const SOURCE_PNG = path.join(OUT, "input-source.png");
const AUDIO_WAV = path.join(OUT, "fixture-audio.wav");
const CANCEL_WAV = path.join(OUT, "cancel-audio.wav");

await mkdir(OUT, { recursive: true });
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  base: BASE,
  checks: [],
  consoleErrors: [],
  pageErrors: [],
  screens: [],
};

function check(name, pass, detail) {
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

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

async function writePng(filePath, width, height, painter) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0;
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = painter(x, y);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      offset += 3;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  await writeFile(filePath, png);
}

async function writeWav(filePath, seconds) {
  const sampleRate = 44100;
  const frames = Math.floor(seconds * sampleRate);
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
    const time = index / sampleRate;
    const sample = Math.sin(2 * Math.PI * 440 * time) * 0.55;
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + index * 2);
  }
  await writeFile(filePath, buffer);
}

await writePng(SOURCE_PNG, 320, 200, (x, y) => [
  (x * 255) % 256,
  (y * 255) % 256,
  (x + y) % 256,
]);
await writeWav(AUDIO_WAV, 2);
await writeWav(CANCEL_WAV, 120);

/* ------------------------------------------------------------------ */
/* Page helpers                                                        */
/* ------------------------------------------------------------------ */

async function waitForApp(page) {
  await page.waitForSelector(".kx-app", { timeout: 30000 });
  await sleep(400);
}

async function clickText(page, text) {
  const clicked = await page.evaluate((needle) => {
    const button = [...document.querySelectorAll("button")].find((element) =>
      element.textContent?.trim().includes(needle),
    );
    if (!button) return false;
    button.click();
    return true;
  }, text);
  if (!clicked) throw new Error(`Button not found: ${text}`);
  return clicked;
}

async function openTool(page, name) {
  await page.evaluate(() => {
    window.location.hash = "#/toolbox";
  });
  await page.waitForSelector(".kx-tool-card", { timeout: 15000 });
  await sleep(250);
  const opened = await page.evaluate((label) => {
    const card = [...document.querySelectorAll(".kx-tool-card")].find(
      (element) =>
        element.querySelector(".kx-tool-name")?.textContent?.trim() === label,
    );
    if (!card) return false;
    card.click();
    return true;
  }, name);
  if (!opened) throw new Error(`Tool card not found: ${name}`);
  await page.waitForSelector(".kx-tool-layout", { timeout: 15000 });
  await sleep(250);
}

async function uploadFile(page, filePath) {
  const input = await page.$(".kx-tool-layout input[type='file']");
  if (!input) throw new Error("The tool has no file input.");
  await input.uploadFile(filePath);
  await sleep(350);
}

async function setToolText(page, value) {
  await page.evaluate((text) => {
    const area = document.querySelector(".kx-tool-layout textarea");
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    ).set;
    setter.call(area, text);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
  await sleep(150);
}

async function openStudioFromService(page) {
  const appeared = await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll("button")].some((element) =>
          /Open in Live Studio|افتح في الاستوديو المباشر/.test(
            element.textContent ?? "",
          ),
        ),
      { timeout: 20000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!appeared) throw new Error("Open in Live Studio never appeared.");
  await clickText(page, "Open in Live Studio");
  await page.waitForSelector(".kx-live-title", { timeout: 15000 });
  await sleep(300);
}

async function studioState(page) {
  return page.evaluate(() => ({
    hash: window.location.hash,
    title: document.querySelector(".kx-live-title")?.textContent?.trim() ?? null,
    kind: document.querySelector(".kx-live-kind")?.textContent?.trim() ?? null,
    status:
      document.querySelector(".kx-live-status")?.textContent?.trim() ?? null,
    stage: document
      .querySelector(".kx-live-status")
      ?.getAttribute("data-stage"),
    timeline: [...document.querySelectorAll(".kx-live-timeline li")].map(
      (element) => element.textContent?.trim() ?? "",
    ),
    dock: [...document.querySelectorAll(".kx-live-dock-grid > div")].map(
      (element) => element.textContent?.trim() ?? "",
    ),
    verified: Boolean(document.querySelector(".kx-live-verified")),
    jobs: document.querySelectorAll(".kx-live-job").length,
    compare: Boolean(document.querySelector(".kx-live-compare")),
    compareSlider: Boolean(document.querySelector(".kx-live-compare-range")),
    videos: document.querySelectorAll(".kx-live-stage video").length,
    audios: document.querySelectorAll(".kx-live-stage audio").length,
    images: document.querySelectorAll(".kx-live-stage img").length,
    dir: document.documentElement.dir,
    overflow:
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
    body: document.body.innerText,
  }));
}

async function waitForStage(page, ...stages) {
  const ok = await page
    .waitForFunction(
      (allowed) => {
        const status = document.querySelector(".kx-live-status");
        if (!status) return false;
        return allowed.includes(status.getAttribute("data-stage"));
      },
      { timeout: 40000 },
      stages,
    )
    .then(() => true)
    .catch(() => false);
  if (!ok) {
    const state = await studioState(page);
    throw new Error(
      `Studio did not reach ${stages.join("/")}: ${JSON.stringify(state)}`,
    );
  }
  await sleep(250);
}

async function decodeImage(page, selector) {
  return page.evaluate(
    (sel) =>
      new Promise((resolve) => {
        const image = document.querySelector(sel);
        if (!image) return resolve({ width: 0, height: 0, src: null });
        if (image.complete && image.naturalWidth > 0) {
          return resolve({
            width: image.naturalWidth,
            height: image.naturalHeight,
            src: image.src.slice(0, 24),
          });
        }
        image.addEventListener("load", () =>
          resolve({
            width: image.naturalWidth,
            height: image.naturalHeight,
            src: image.src.slice(0, 24),
          }),
        );
        image.addEventListener("error", () => resolve({ width: 0, height: 0, src: null }));
      }),
    selector,
  );
}

/* ------------------------------------------------------------------ */
/* Browser                                                             */
/* ------------------------------------------------------------------ */

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--auto-select-desktop-capture-source=Entire screen",
    "--window-size=1600,1000",
    "--no-first-run",
    "--no-default-browser-check",
  ],
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 },
});

try {
  const page = await browser.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => report.pageErrors.push(String(error)));

  await page.goto(`${BASE}?nocache=${Date.now()}#/toolbox`, {
    waitUntil: "domcontentloaded",
  });
  await waitForApp(page);
  await shot(page, "00-toolbox");

  /* ---------------- 1. image job through the workspace --------------- */
  await openTool(page, "QR Code Generator");
  await setToolText(page, "KNOUX LIVE STUDIO EVIDENCE");
  await clickText(page, "Run");
  await openStudioFromService(page);

  const runningState = await studioState(page);
  check(
    "studio opens with the real job selected",
    /^#\/live-studio\/[0-9a-f-]{8,}/.test(runningState.hash),
    runningState.hash,
  );
  check(
    "studio header names the real service",
    runningState.title === "QR Code Generator",
    runningState.title,
  );
  check(
    "studio marks the job as a tool",
    /Tool/i.test(runningState.kind ?? ""),
    runningState.kind,
  );
  check(
    "live timeline already carries real stages",
    runningState.timeline.length >= 1,
    runningState.timeline,
  );

  await waitForStage(page, "done");
  const doneState = await studioState(page);
  const doneStages = doneState.timeline.join(" | ");
  check(
    "timeline records validating, processing, verifying and completion",
    ["Validating", "Processing", "Verifying", "Done"].every((word) =>
      doneStages.includes(word),
    ),
    doneState.timeline,
  );
  check(
    "timeline entries carry real elapsed offsets",
    doneState.timeline.every((row) => /\+\d+\.\ds/.test(row)),
    doneState.timeline,
  );
  check(
    "result dock reports the real container and size",
    doneState.dock.some((row) => row.includes("image/png")) &&
      doneState.dock.some((row) => /Size\d+(\.\d+)? (B|KB|MB)/.test(row)),
    doneState.dock,
  );
  check(
    "result dock reports real dimensions",
    doneState.dock.some((row) => /Dimensions\d+×\d+/.test(row)),
    doneState.dock,
  );
  check("verified badge only after a real result", doneState.verified, doneState);

  const decoded = await decodeImage(page, ".kx-live-stage img");
  check(
    "result preview decodes to real pixels",
    decoded.width > 0 && decoded.height > 0,
    decoded,
  );
  await shot(page, "01-live-image-done");

  await clickText(page, "Save to library");
  await sleep(700);
  await page.evaluate(() => {
    window.location.hash = "#/library";
  });
  await page.waitForSelector(".kx-media-card", { timeout: 15000 });
  const libraryText = await page.evaluate(() => document.body.innerText);
  check(
    "saved artifact is reopened from the library",
    libraryText.includes("KNOUX LIVE STUDIO EVIDENCE.png"),
    libraryText.slice(0, 200),
  );
  await shot(page, "02-library-saved");

  /* ---------------- 2. retry re-runs the real engine ----------------- */
  await page.evaluate(() => {
    window.history.back();
  });
  await page.waitForSelector(".kx-live-title", { timeout: 15000 });
  await sleep(300);
  const beforeRetry = await studioState(page);
  await clickText(page, "Run again");
  await sleep(600);
  const afterRetry = await studioState(page);
  check(
    "retry registers a second real job",
    afterRetry.jobs === beforeRetry.jobs + 1,
    { before: beforeRetry.jobs, after: afterRetry.jobs },
  );
  await waitForStage(page, "done");
  check(
    "retried job completes with a fresh result",
    (await studioState(page)).verified,
  );
  await clickText(page, "Reopen service");
  await page.waitForSelector(".kx-tool-card, .kx-tool-layout", { timeout: 15000 });
  check(
    "reopen returns to the owning service",
    page.url().includes("#/toolbox"),
    page.url(),
  );

  /* ---------------- 3. image comparison slider ----------------------- */
  await openTool(page, "Image Resizer");
  await uploadFile(page, SOURCE_PNG);
  await clickText(page, "Run");
  await openStudioFromService(page);
  await waitForStage(page, "done");
  const compareState = await studioState(page);
  check(
    "file-based image jobs show the before/after slider",
    compareState.compare && compareState.compareSlider,
    { compare: compareState.compare, slider: compareState.compareSlider },
  );
  const stageImages = await page.evaluate(
    () => document.querySelectorAll(".kx-live-compare img").length,
  );
  check("comparison shows source and processed pixels", stageImages === 2, stageImages);
  await shot(page, "03-live-compare");

  /* ---------------- 4. audio service --------------------------------- */
  await openTool(page, "Audio Visualizer");
  await uploadFile(page, AUDIO_WAV);
  await clickText(page, "Run");
  await openStudioFromService(page);
  await waitForStage(page, "done");
  const audioState = await studioState(page);
  check(
    "audio jobs expose the source playback and a real waveform image",
    audioState.audios === 1 && audioState.images === 1,
    { audios: audioState.audios, images: audioState.images },
  );
  check(
    "waveform result dock reports the decoded duration",
    audioState.dock.some((row) => /Duration0\d:0\d/.test(row)),
    audioState.dock,
  );
  await shot(page, "04-live-audio");

  /* ---------------- 5. template video export ------------------------- */
  await page.evaluate(() => {
    window.location.hash = "#/templates";
  });
  await page.waitForSelector(".kx-ai-row", { timeout: 20000 });
  await sleep(400);
  await page.evaluate(() => {
    document.querySelector(".kx-ai-row")?.click();
  });
  await sleep(300);
  await clickText(page, "Export WebM video");
  await openStudioFromService(page);
  await waitForStage(page, "done", "error");
  const videoState = await studioState(page);
  check(
    "template export runs inside the workspace",
    /Template video/i.test(videoState.kind ?? ""),
    videoState.kind,
  );
  check(
    "template job produced a decodable video preview",
    videoState.videos >= 1,
    { videos: videoState.videos },
  );
  check(
    "template dock reports the WebM container and real bytes",
    videoState.dock.some((row) => row.includes("video/webm")) &&
      videoState.dock.some((row) => /Size[\d.]+ (KB|MB)/.test(row)),
    videoState.dock,
  );
  await shot(page, "05-live-video");

  /* ---------------- 6. recording lifecycle --------------------------- */
  await page.evaluate(() => {
    window.location.hash = "#/studio";
  });
  await page.waitForSelector(".kx-card", { timeout: 15000 });
  await sleep(400);
  await clickText(page, "Start recording");
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].some((element) =>
        /Stop & save/.test(element.textContent ?? ""),
      ),
    { timeout: 20000 },
  );
  await sleep(1300);
  await clickText(page, "Stop & save");
  await sleep(1200);
  await openStudioFromService(page);
  await waitForStage(page, "done", "error");
  const recordingState = await studioState(page);
  check(
    "recording registers a workspace job",
    /Recording/i.test(recordingState.kind ?? ""),
    recordingState.kind,
  );
  check(
    "recording produced a playable video artifact",
    recordingState.videos >= 1 &&
      recordingState.dock.some((row) => row.includes("video/webm")),
    { videos: recordingState.videos, dock: recordingState.dock },
  );
  check(
    "recording dock reports a measured duration",
    recordingState.dock.some((row) => /Duration0\d:0\d/.test(row)),
    recordingState.dock,
  );
  await shot(page, "06-live-recording");

  /* ---------------- 7. real cancellation ----------------------------- */
  await openTool(page, "Audio Visualizer");
  await uploadFile(page, CANCEL_WAV);
  await clickText(page, "Run");
  await openStudioFromService(page);
  await waitForStage(page, "done", "cancelled", "error");
  // Start a fresh run from the dock and cancel it while it is genuinely
  // active — the same millisecond-level poll the toolbox smoke proved.
  const cancelled = await page.evaluate(async () => {
    const retry = [...document.querySelectorAll(".kx-live-dock button")].find(
      (element) => element.textContent?.trim() === "Run again",
    );
    if (!retry) return { clicked: false, reason: "retry missing" };
    retry.click();
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const cancel = [...document.querySelectorAll(".kx-live-actions button")].find(
        (element) => element.textContent?.trim() === "Cancel",
      );
      if (cancel) {
        cancel.click();
        return { clicked: true, waitedMs: attempt * 5 };
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return { clicked: false, reason: "cancel never appeared" };
  });
  await waitForStage(page, "cancelled", "done", "error");
  const cancelState = await studioState(page);
  check(
    "cancelled job is reported honestly",
    cancelled.clicked && cancelState.stage === "cancelled",
    { cancelled, stage: cancelState.stage },
  );
  check(
    "cancelled job exposes no result or verification",
    !cancelState.verified &&
      (cancelState.dock.length === 0 ||
        cancelState.body.includes("no output was saved") ||
        cancelState.body.includes("لم تُحفظ")),
    { dock: cancelState.dock, verified: cancelState.verified },
  );
  await shot(page, "07-live-cancelled");

  /* ---------------- 8. Arabic RTL ------------------------------------ */
  await page.evaluate(() => {
    const toggle = [...document.querySelectorAll("button")].find(
      (element) => element.textContent?.trim() === "AR",
    );
    toggle?.click();
  });
  await sleep(700);
  const arabicState = await studioState(page);
  check(
    "studio switches to RTL Arabic",
    arabicState.dir === "rtl" &&
      arabicState.body.includes("الجدول الزمني للتنفيذ") &&
      arabicState.body.includes("رصيف النتيجة"),
    { dir: arabicState.dir },
  );
  check(
    "Arabic studio has no horizontal overflow",
    arabicState.overflow <= 0,
    arabicState.overflow,
  );
  await shot(page, "08-live-arabic");

  check(
    "no uncaught page errors",
    report.pageErrors.length === 0,
    report.pageErrors,
  );
  check(
    "no console errors",
    report.consoleErrors.length === 0,
    report.consoleErrors.slice(0, 4),
  );
} catch (error) {
  report.fatal = String(error);
  console.error("FATAL", error);
} finally {
  await browser.close();
}

const failed = report.checks.filter((entry) => !entry.pass);
report.failedChecks = failed.length;
report.checksTotal = report.checks.length;
await writeFile(
  path.join(OUT, "report.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    {
      failed: Boolean(report.fatal) || failed.length > 0,
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
process.exit(Boolean(report.fatal) || failed.length > 0 ? 1 : 0);
