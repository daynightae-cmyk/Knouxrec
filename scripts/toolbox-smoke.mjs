#!/usr/bin/env node
/**
 * KNOUX REC Toolbox end-to-end smoke.
 *
 * Every implemented tool is driven through the real UI in Chromium with
 * real input bytes:
 *
 *   image-resize, image-filters, image-convert, video-thumbnail,
 *   audio-visualizer, text-image, qr-code, color-palette.
 *
 * For each tool the smoke verifies:
 *   - invalid input is rejected by the shared validator (wrong MIME / empty text),
 *   - a real result is produced and its preview decodes to the reported size,
 *   - the preview pixels, the IndexedDB-saved bytes and the downloaded export
 *     all agree (SHA-256 of the decoded RGBA + SHA-256 of the container bytes),
 *   - the container magic is the real signature for PNG / JPEG / WEBP.
 *
 * It also verifies cooperative cancellation on a long audio decode, URL
 * cleanup when the route unmounts, IndexedDB persistence across a page reload
 * and the Arabic RTL layout.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.KNOUX_BASE_URL ?? "http://localhost:4173/";
const OUT = path.resolve("artifacts/evidence/toolbox");
const DOWNLOADS = path.join(OUT, "downloads");
const CHROME =
  process.env.KNOUX_CHROME ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const VIDEO_FIXTURE =
  process.env.KNOUX_VIDEO_FIXTURE ??
  path.resolve("artifacts/downloads/KNOUX-REC-2026-10-21_11-57-14-trim.webm");

const SOURCE_PNG = path.join(OUT, "input-source.png");
const PALETTE_PNG = path.join(OUT, "palette-source.png");
const AUDIO_WAV = path.join(OUT, "fixture-audio.wav");
const CANCEL_WAV = path.join(OUT, "cancel-audio.wav");
const WRONG_FILE = path.join(OUT, "wrong.txt");

await mkdir(OUT, { recursive: true });
await rm(DOWNLOADS, { recursive: true, force: true });
await mkdir(DOWNLOADS, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  base: BASE,
  chrome: CHROME,
  videoFixture: VIDEO_FIXTURE,
  checks: [],
  tools: [],
  downloads: [],
  consoleErrors: [],
  pageErrors: [],
};

/* ------------------------------------------------------------------ */
/* Fixtures                                                           */
/* ------------------------------------------------------------------ */

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
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
  return png;
}

function describeMedia(buffer) {
  const magic = Array.from(buffer.subarray(0, 16))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join(" ");
  const isPng =
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47;
  const isJpeg =
    buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isWebp =
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP";
  return {
    bytes: buffer.length,
    magic,
    isPng,
    isJpeg,
    isWebp,
    width: isPng ? buffer.readUInt32BE(16) : null,
    height: isPng ? buffer.readUInt32BE(20) : null,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  };
}

/** A real 16-bit PCM WAV. Two seconds: tone / silence / tone / silence. */
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
    let sample = 0;
    if (seconds <= 3) {
      const sounding = time < 0.5 || (time >= 1 && time < 1.5);
      if (sounding) {
        const frequency = time < 0.5 ? 440 : 880;
        sample = Math.sin(2 * Math.PI * frequency * time) * 0.55;
      }
    } else {
      sample = Math.sin(2 * Math.PI * 440 * time) * 0.55;
    }
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), 44 + index * 2);
  }
  await writeFile(filePath, buffer);
  return describeMedia(buffer);
}

/* ------------------------------------------------------------------ */
/* Utilities                                                          */
/* ------------------------------------------------------------------ */

function check(name, pass, detail) {
  report.checks.push({ name, pass: Boolean(pass), detail });
  if (!pass) console.error(`FAIL ${name}: ${JSON.stringify(detail)}`);
  else console.log(`PASS ${name}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

async function waitForApp(page) {
  await page.waitForSelector(".kx-app", { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector(".kx-splash"), { timeout: 30000 });
}

async function waitForResult(page, timeout = 90000) {
  await page.waitForFunction(
    () => {
      const card = [...document.querySelectorAll(".kx-card")].find((element) =>
        element.textContent?.includes("Result"),
      );
      const image = document.querySelector(".kx-preview img");
      return Boolean(card && image && image.complete && image.naturalWidth > 0);
    },
    { timeout, polling: 150 },
  );
  await sleep(200);
}

async function clickButton(page, labels, wait = 100) {
  const list = Array.isArray(labels) ? labels : [labels];
  const clicked = await page.evaluate((texts) => {
    const button = [...document.querySelectorAll(".kx-btn")].find((element) =>
      texts.includes(element.textContent?.trim() ?? ""),
    );
    if (!button) return false;
    button.click();
    return true;
  }, list);
  if (!clicked) throw new Error(`Button not found: ${list.join(" | ")}`);
  if (wait) await sleep(wait);
}

async function goBackToCatalog(page) {
  if (!(await page.$(".kx-tool-layout"))) return;
  await page.evaluate(() => {
    const button = document.querySelector(".kx-view-head .kx-btn-quiet");
    button?.click();
  });
  await page.waitForSelector(".kx-tool-card", { timeout: 15000 });
  await sleep(200);
}

async function openTool(page, name) {
  await goBackToCatalog(page);
  const opened = await page.evaluate((label) => {
    const card = [...document.querySelectorAll(".kx-tool-card")].find(
      (element) => element.querySelector(".kx-tool-name")?.textContent?.trim() === label,
    );
    if (!card) return false;
    card.click();
    return true;
  }, name);
  if (!opened) throw new Error(`Tool card not found: ${name}`);
  await page.waitForSelector(".kx-tool-layout", { timeout: 15000 });
  await sleep(300);
}

async function uploadFile(page, filePath) {
  const input = await page.$(".kx-tool-layout input[type='file']");
  if (!input) throw new Error("The tool has no file input.");
  await input.uploadFile(filePath);
  await sleep(400);
}

async function waitForSourceImage(page) {
  await page.waitForFunction(
    () => {
      const image = document.querySelector(".kx-preview img");
      return Boolean(image && image.complete && image.naturalWidth > 0);
    },
    { timeout: 20000 },
  );
}

async function waitForSourceMedia(page, tag) {
  await page.waitForFunction(
    (kind) => {
      const element = document.querySelector(`.kx-preview ${kind}`);
      if (!element) return false;
      if (kind === "video") return element.readyState >= 1 && element.videoWidth > 0;
      return (
        element.readyState >= 1 &&
        Number.isFinite(element.duration) &&
        element.duration > 0
      );
    },
    { timeout: 60000 },
    tag,
  );
  return page.evaluate(async (kind) => {
    const element = document.querySelector(`.kx-preview ${kind}`);
    // MediaRecorder WebM reports Infinity until Chromium is forced to scan
    // the cluster timestamps; seeking past the end publishes the duration.
    if (kind === "video" && !Number.isFinite(element.duration)) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 5000);
        element.addEventListener(
          "durationchange",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
        element.currentTime = 1e9;
      });
      element.currentTime = 0;
    }
    return {
      width: element.videoWidth ?? null,
      height: element.videoHeight ?? null,
      duration: element.duration,
    };
  }, tag);
}

async function typeText(page, text) {
  await page.evaluate((value) => {
    const area = document.querySelector(".kx-tool-layout textarea");
    if (!area) throw new Error("The tool has no text area.");
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    ).set;
    setter.call(area, value);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
  await sleep(150);
}

async function setRange(page, labelPrefix, value) {
  const changed = await page.evaluate(
    ({ prefix, next }) => {
      const field = [...document.querySelectorAll(".kx-tool-settings .kx-field")].find(
        (element) =>
          (element.querySelector(".kx-label")?.textContent?.trim() ?? "").startsWith(prefix),
      );
      const input = field?.querySelector("input[type='range']");
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set;
      setter.call(input, String(next));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    { prefix: labelPrefix, next: value },
  );
  if (!changed) throw new Error(`Range field not found: ${labelPrefix}`);
  await sleep(120);
}

async function chooseSegment(page, groupLabel, optionText) {
  const clicked = await page.evaluate(
    ({ label, text }) => {
      const group = [...document.querySelectorAll(".kx-segmented")].find(
        (element) => element.getAttribute("aria-label") === label,
      );
      const button = [...(group?.querySelectorAll("button") ?? [])].find(
        (element) => element.textContent?.trim() === text,
      );
      if (!button) return false;
      button.click();
      return true;
    },
    { label: groupLabel, text: optionText },
  );
  if (!clicked) throw new Error(`Segment not found: ${groupLabel} / ${optionText}`);
  await sleep(200);
}

async function setHexColor(page, labelPrefix, value) {
  const changed = await page.evaluate(
    ({ prefix, next }) => {
      const field = [...document.querySelectorAll(".kx-tool-settings .kx-field")].find(
        (element) =>
          (element.querySelector(".kx-label")?.textContent?.trim() ?? "").startsWith(prefix),
      );
      const input = field?.querySelector("input.kx-color-hex");
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set;
      setter.call(input, next);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    { prefix: labelPrefix, next: value },
  );
  if (!changed) throw new Error(`Colour field not found: ${labelPrefix}`);
  await sleep(150);
}

async function readDanger(page) {
  return page.evaluate(() => {
    const notice = document.querySelector('.kx-notice[data-tone="danger"]');
    return notice?.textContent?.trim() ?? null;
  });
}

async function assertWrongMime(page, toolName) {
  await uploadFile(page, WRONG_FILE);
  const message = await readDanger(page);
  check(
    `${toolName}: rejects a text file with a real validation message`,
    Boolean(message && /does not accept/i.test(message)),
    message,
  );
}

async function assertEmptyText(page, toolName) {
  await clickButton(page, ["Run", "Run again"], 250);
  const message = await readDanger(page);
  check(
    `${toolName}: rejects empty text with a real validation message`,
    Boolean(message && /enter the text/i.test(message)),
    message,
  );
}

async function inspectPreview(page) {
  const preview = await page.evaluate(() => window.__KX.inspectRendered(".kx-preview img"));
  if (!preview) throw new Error("The result preview could not be decoded.");
  return preview;
}

async function resultMeta(page) {
  return page.evaluate(() => {
    const card = [...document.querySelectorAll(".kx-card")].find((element) =>
      element.textContent?.includes("Result"),
    );
    const summary = card?.querySelector(".kx-card-sub")?.textContent?.trim() ?? "";
    return {
      summary,
      fileName: summary.split(" · ")[0]?.trim() ?? "",
      chips: [...(card?.querySelectorAll(".kx-chip") ?? [])].map(
        (chip) => chip.textContent?.trim() ?? "",
      ),
    };
  });
}

async function saveToLibrary(page) {
  await clickButton(page, "Save to library", 150);
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".kx-btn")].some(
        (button) => button.textContent?.trim() === "Saved",
      ),
    { timeout: 20000 },
  );
  await sleep(250);
}

async function readPersisted(page, fragment) {
  const item = await page.evaluate((needle) => window.__KX.persisted(needle), fragment);
  if (!item) throw new Error(`No saved library item matching "${fragment}".`);
  return item;
}

async function clearDownloads() {
  const files = await readdir(DOWNLOADS).catch(() => []);
  for (const file of files) {
    await unlink(path.join(DOWNLOADS, file)).catch(() => undefined);
  }
}

async function waitForDownload(expectedName, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const files = await readdir(DOWNLOADS).catch(() => []);
    const ready = files.filter(
      (file) => !file.endsWith(".crdownload") && !file.endsWith(".tmp"),
    );
    if (ready.length > 0) {
      const exact = ready.find((file) => file === expectedName) ?? ready[0];
      return path.join(DOWNLOADS, exact);
    }
    await sleep(150);
  }
  throw new Error(`The export "${expectedName}" did not reach ${DOWNLOADS}.`);
}

async function exportAndVerify(page, persisted) {
  await clearDownloads();
  await clickButton(page, "Export file", 250);
  const filePath = await waitForDownload(persisted.name);
  const bytes = await readFile(filePath);
  const described = describeMedia(bytes);
  const exported = {
    name: path.basename(filePath),
    ...described,
  };
  report.downloads.push({ expected: persisted.name, actual: exported.name, bytes: exported.bytes });
  return exported;
}

/**
 * Verify the whole chain for an image-producing tool: preview, saved bytes and
 * exported container must describe the same image.
 */
function verifyArtifact({
  label,
  preview,
  meta,
  persisted,
  exported,
  expectedWidth,
  expectedHeight,
  expectedMime,
  expectedMagic,
  expectedExtension,
}) {
  check(
    `${label}: result preview decodes at ${expectedWidth}×${expectedHeight}`,
    preview.width === expectedWidth && preview.height === expectedHeight,
    { width: preview.width, height: preview.height },
  );
  check(
    `${label}: saved file is ${expectedMime}`,
    persisted.mimeType === expectedMime && persisted.magic.startsWith(expectedMagic),
    { mimeType: persisted.mimeType, magic: persisted.magic, size: persisted.size },
  );
  check(
    `${label}: saved file decodes at ${expectedWidth}×${expectedHeight}`,
    persisted.width === expectedWidth &&
      persisted.height === expectedHeight &&
      persisted.size > 100,
    {
      width: persisted.width,
      height: persisted.height,
      size: persisted.size,
      magic: persisted.magic,
    },
  );
  check(
    `${label}: saved bytes decode to exactly the preview pixels`,
    persisted.pixelSha256 === preview.pixelSha256,
    { preview: preview.pixelSha256, saved: persisted.pixelSha256 },
  );
  check(
    `${label}: exported file has the ${expectedExtension.toUpperCase()} signature`,
    exported.magic.startsWith(expectedMagic) &&
      exported.name.toLowerCase().endsWith(`.${expectedExtension}`),
    { name: exported.name, magic: exported.magic, size: exported.bytes },
  );
  check(
    `${label}: exported bytes equal the saved bytes`,
    exported.sha256 === persisted.sha256 && exported.bytes === persisted.size,
    {
      exported: { sha256: exported.sha256, bytes: exported.bytes },
      saved: { sha256: persisted.sha256, bytes: persisted.size },
    },
  );
  check(
    `${label}: result metadata names the produced file`,
    Boolean(meta.summary && meta.fileName),
    { summary: meta.summary, chips: meta.chips },
  );
}

async function countPersisted(page, source) {
  return page.evaluate(async (wantedSource) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("knoux-rec.library", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const items = await new Promise((resolve, reject) => {
      const transaction = db.transaction("items", "readonly");
      const request = transaction.objectStore("items").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return items.filter((item) => !wantedSource || item.source === wantedSource).length;
  }, source);
}

/* ------------------------------------------------------------------ */
/* Browser                                                            */
/* ------------------------------------------------------------------ */

if (!existsSync(VIDEO_FIXTURE)) {
  throw new Error(
    `Video fixture not found at ${VIDEO_FIXTURE}. Set KNOUX_VIDEO_FIXTURE to a real WebM recording.`,
  );
}

const sourceBytes = await writePng(SOURCE_PNG, 640, 480, (x, y) => [
  Math.round((x / 640) * 255),
  Math.round((y / 480) * 255),
  200,
]);
const sourceInfo = describeMedia(sourceBytes);

const paletteBands = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
  [0, 255, 255],
  [255, 0, 255],
];
const paletteBytes = await writePng(PALETTE_PNG, 640, 480, (x) => {
  const band = Math.min(5, Math.floor((x / 640) * 6));
  return paletteBands[band];
});
const paletteInfo = describeMedia(paletteBytes);
const audioInfo = await writeWav(AUDIO_WAV, 2);
const cancelInfo = await writeWav(CANCEL_WAV, 120);
await writeFile(WRONG_FILE, "This is not an image, a video or an audio file.\n", "utf8");
await writeFile(path.join(OUT, "empty.png"), Buffer.alloc(0));
await writeFile(path.join(OUT, "empty.webm"), Buffer.alloc(0));
await writeFile(path.join(OUT, "empty.wav"), Buffer.alloc(0));

report.fixtures = {
  source: sourceInfo,
  palette: paletteInfo,
  audio: audioInfo,
  cancel: cancelInfo,
  video: path.basename(VIDEO_FIXTURE),
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--autoplay-policy=no-user-gesture-required",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1600,1000",
  ],
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 },
});

try {
  const page = await browser.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location();
      report.consoleErrors.push({
        text: message.text(),
        url: location?.url ?? null,
        line: location?.lineNumber ?? null,
      });
    }
  });
  page.on("pageerror", (error) => report.pageErrors.push(String(error?.stack ?? error)));

  const downloadSession = await browser.target().createCDPSession();
  try {
    await downloadSession.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: DOWNLOADS,
      eventsEnabled: true,
    });
  } catch (error) {
    report.downloadSetupError = String(error);
    const pageSession = await page.createCDPSession();
    await pageSession.send("Page.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: DOWNLOADS,
    });
  }

  await page.evaluateOnNewDocument(() => {
    const counters = { created: 0, revoked: 0 };
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object) => {
      counters.created += 1;
      return create(object);
    };
    URL.revokeObjectURL = (url) => {
      counters.revoked += 1;
      return revoke(url);
    };
    window.__kxUrlCounters = counters;

    const hex = (buffer) =>
      Array.from(new Uint8Array(buffer))
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");

    window.__KX = {
      async inspect(input) {
        let url;
        let revoke = false;
        if (typeof input === "string") {
          url = input;
        } else {
          url = URL.createObjectURL(input);
          revoke = true;
        }
        try {
          const image = await new Promise((resolve, reject) => {
            const element = new Image();
            element.onload = () => resolve(element);
            element.onerror = () => reject(new Error("The image could not be decoded."));
            element.src = url;
          });
          const width = image.naturalWidth || image.width;
          const height = image.naturalHeight || image.height;
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) throw new Error("Canvas 2D is unavailable.");
          context.drawImage(image, 0, 0);
          const frame = context.getImageData(0, 0, width, height);
          const digest = await crypto.subtle.digest("SHA-256", frame.data);
          const colours = new Set();
          let grayscale = 0;
          let changed = 0;
          let counted = 0;
          let luma = 0;
          const background = [frame.data[0], frame.data[1], frame.data[2]];
          const stride = Math.max(4, Math.floor((width * height) / 250000) * 4);
          for (let index = 0; index < frame.data.length; index += stride) {
            const r = frame.data[index];
            const g = frame.data[index + 1];
            const b = frame.data[index + 2];
            colours.add((r << 16) | (g << 8) | b);
            if (Math.max(r, g, b) - Math.min(r, g, b) <= 8) grayscale += 1;
            if (
              Math.max(
                Math.abs(r - background[0]),
                Math.abs(g - background[1]),
                Math.abs(b - background[2]),
              ) > 8
            ) {
              changed += 1;
            }
            luma += 0.299 * r + 0.587 * g + 0.114 * b;
            counted += 1;
          }
          const centreIndex = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
          return {
            width,
            height,
            pixelSha256: hex(digest),
            centrePixel: [
              frame.data[centreIndex],
              frame.data[centreIndex + 1],
              frame.data[centreIndex + 2],
            ],
            uniqueColours: colours.size,
            grayscaleRatio: counted ? grayscale / counted : 0,
            changedFromCorner: counted ? changed / counted : 0,
            meanLuma: counted ? luma / counted : 0,
          };
        } finally {
          if (revoke) URL.revokeObjectURL(url);
        }
      },
      async inspectRendered(selector) {
        const image = document.querySelector(selector);
        if (!image) return null;
        if (!image.complete || !image.naturalWidth) {
          await new Promise((resolve) => {
            image.addEventListener("load", resolve, { once: true });
            image.addEventListener("error", resolve, { once: true });
            setTimeout(resolve, 5000);
          });
        }
        if (!image.naturalWidth) return null;
        return await window.__KX.inspect(image.src);
      },
      async persisted(fragment) {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open("knoux-rec.library", 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const items = await new Promise((resolve, reject) => {
          const transaction = db.transaction("items", "readonly");
          const request = transaction.objectStore("items").getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const matches = items
          .filter((item) => item.name.includes(fragment))
          .sort((a, b) => b.createdAt - a.createdAt);
        const match = matches[0];
        if (!match) {
          db.close();
          return null;
        }
        const buffer = await match.blob.arrayBuffer();
        const fileDigest = await crypto.subtle.digest("SHA-256", buffer);
        const stats = await window.__KX.inspect(match.blob);
        db.close();
        return {
          name: match.name,
          mimeType: match.mimeType,
          source: match.source,
          size: match.blob.size,
          sha256: hex(fileDigest),
          magic: Array.from(new Uint8Array(buffer).slice(0, 16))
            .map((value) => value.toString(16).padStart(2, "0"))
            .join(" "),
          ...stats,
        };
      },
      async sampleSwatches(selector, count) {
        const image = document.querySelector(selector);
        if (!image) return null;
        if (!image.complete || !image.naturalWidth) {
          await new Promise((resolve) => {
            image.addEventListener("load", resolve, { once: true });
            image.addEventListener("error", resolve, { once: true });
            setTimeout(resolve, 5000);
          });
        }
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        const swatches = [];
        for (let index = 0; index < count; index += 1) {
          const x = Math.min(
            image.naturalWidth - 1,
            Math.floor(((index + 0.5) * image.naturalWidth) / count),
          );
          const y = Math.floor(image.naturalHeight / 2);
          const pixel = context.getImageData(x, y, 1, 1).data;
          swatches.push(
            `#${[pixel[0], pixel[1], pixel[2]]
              .map((value) => value.toString(16).padStart(2, "0"))
              .join("")}`,
          );
        }
        return swatches;
      },
    };
  });

  await page.goto(`${BASE}#/toolbox`, { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await page.waitForSelector(".kx-tool-card", { timeout: 20000 });

  const catalog = await page.evaluate(() =>
    [...document.querySelectorAll(".kx-tool-card")].map((card) => ({
      name: card.querySelector(".kx-tool-name")?.textContent?.trim() ?? "",
      category: card.querySelector(".kx-chip")?.textContent?.trim() ?? "",
    })),
  );
  report.catalog = catalog;
  check("toolbox catalog lists thirteen tools", catalog.length === 13, catalog.length);
  check(
    "catalog shows the thirteen documented tools",
    [
      "Image Resizer",
      "Image Filters",
      "Format Converter",
      "Image Rotator",
      "Image Cropper",
      "Image Pixelator",
      "Image compressor",
      "Frame sheet",
      "Video Thumbnail",
      "Audio Visualizer",
      "Text Image Generator",
      "QR Code Generator",
      "Color Palette Extractor",
    ].every((name) => catalog.some((entry) => entry.name === name)),
    catalog.map((entry) => entry.name),
  );
  await shot(page, "01-toolbox-catalog");

  /* ---------------------------------------------------------------- QR */
  {
    await openTool(page, "QR Code Generator");
    await assertEmptyText(page, "qr-code");
    await typeText(page, "https://knoux.app/qr-test");
    await clickButton(page, "Run");
    await waitForResult(page);
    const preview = await inspectPreview(page);
    const meta = await resultMeta(page);
    check(
      "qr-code: output is a square PNG larger than 100 px",
      preview.width === preview.height && preview.width > 100,
      { width: preview.width, height: preview.height },
    );
    check(
      "qr-code: result reports the real version and error-correction level",
      meta.chips.some((chip) => chip.includes("version")) &&
        meta.chips.some((chip) => chip.includes("ecLevel")),
      meta.chips,
    );
    check(
      "qr-code: a real dark/light symbol was drawn",
      preview.uniqueColours >= 2 && preview.uniqueColours <= 4,
      { uniqueColours: preview.uniqueColours },
    );
    await saveToLibrary(page);
    const persisted = await readPersisted(page, "qr-test");
    const exported = await exportAndVerify(page, persisted);
    verifyArtifact({
      label: "qr-code",
      preview,
      meta,
      persisted,
      exported,
      expectedWidth: preview.width,
      expectedHeight: preview.height,
      expectedMime: "image/png",
      expectedMagic: "89 50 4e 47",
      expectedExtension: "png",
    });
    report.tools.push({ tool: "qr-code", preview, meta, persisted, exported });
    await shot(page, "02-qr-result");

    // Colour parameters must reach the encoded pixels, not just the UI.
    await setHexColor(page, "Modules colour", "#ff0000");
    await clickButton(page, "Run");
    await waitForResult(page);
    const recolored = await inspectPreview(page);
    check(
      "qr-code: colour parameters reach the encoded pixels",
      recolored.width === preview.width &&
        recolored.pixelSha256 !== preview.pixelSha256,
      { before: preview.pixelSha256, after: recolored.pixelSha256 },
    );
  }

  /* ------------------------------------------------------- Image Filters */
  {
    await openTool(page, "Image Filters");
    await assertWrongMime(page, "image-filters");
    await uploadFile(page, SOURCE_PNG);
    await waitForSourceImage(page);
    const before = await inspectPreview(page);
    await setRange(page, "Exposure", 0.5);
    await setRange(page, "Brightness", 20);
    await setRange(page, "Contrast", 30);
    await setRange(page, "Saturation", 40);
    await setRange(page, "Grayscale", 100);
    await clickButton(page, "Run");
    await waitForResult(page);
    const preview = await inspectPreview(page);
    const meta = await resultMeta(page);
    check(
      "image-filters: the preview really changed the source pixels",
      preview.pixelSha256 !== before.pixelSha256,
      { before: before.pixelSha256, after: preview.pixelSha256 },
    );
    check(
      "image-filters: grayscale 100 produced grey pixels",
      preview.grayscaleRatio > 0.9,
      { grayscaleRatio: preview.grayscaleRatio, uniqueColours: preview.uniqueColours },
    );
    await saveToLibrary(page);
    const persisted = await readPersisted(page, "filtered");
    const exported = await exportAndVerify(page, persisted);
    verifyArtifact({
      label: "image-filters",
      preview,
      meta,
      persisted,
      exported,
      expectedWidth: 640,
      expectedHeight: 480,
      expectedMime: "image/png",
      expectedMagic: "89 50 4e 47",
      expectedExtension: "png",
    });
    report.tools.push({ tool: "image-filters", before, preview, meta, persisted, exported });
    await shot(page, "03-filters-result");
  }

  /* ---------------------------------------------------- Format Converter */
  {
    await openTool(page, "Format Converter");
    await assertWrongMime(page, "image-convert");
    await uploadFile(page, SOURCE_PNG);
    await waitForSourceImage(page);
    await chooseSegment(page, "Format", "JPEG");
    await setRange(page, "Quality", 80);
    await clickButton(page, "Run");
    await waitForResult(page);
    const jpegPreview = await inspectPreview(page);
    const jpegMeta = await resultMeta(page);
    await saveToLibrary(page);
    const jpegPersisted = await readPersisted(page, ".jpg");
    const jpegExported = await exportAndVerify(page, jpegPersisted);
    verifyArtifact({
      label: "image-convert/jpeg",
      preview: jpegPreview,
      meta: jpegMeta,
      persisted: jpegPersisted,
      exported: jpegExported,
      expectedWidth: 640,
      expectedHeight: 480,
      expectedMime: "image/jpeg",
      expectedMagic: "ff d8 ff",
      expectedExtension: "jpg",
    });

    await chooseSegment(page, "Format", "WEBP");
    await clickButton(page, ["Run", "Run again"]);
    await waitForResult(page);
    const webpPreview = await inspectPreview(page);
    const webpMeta = await resultMeta(page);
    await saveToLibrary(page);
    const webpPersisted = await readPersisted(page, ".webp");
    const webpExported = await exportAndVerify(page, webpPersisted);
    check(
      "image-convert/webp: saved file carries the RIFF/WEBP signature",
      webpPersisted.magic.startsWith("52 49 46 46") &&
        webpPersisted.magic.split(" ").slice(8, 12).join(" ") === "57 45 42 50",
      webpPersisted.magic,
    );
    verifyArtifact({
      label: "image-convert/webp",
      preview: webpPreview,
      meta: webpMeta,
      persisted: webpPersisted,
      exported: webpExported,
      expectedWidth: 640,
      expectedHeight: 480,
      expectedMime: "image/webp",
      expectedMagic: "52 49 46 46",
      expectedExtension: "webp",
    });
    report.tools.push({
      tool: "image-convert",
      jpeg: { preview: jpegPreview, persisted: jpegPersisted, exported: jpegExported },
      webp: { preview: webpPreview, persisted: webpPersisted, exported: webpExported },
    });
    await shot(page, "04-convert-webp-result");
  }

  /* --------------------------------------------------------- Image Resizer */
  {
    await openTool(page, "Image Resizer");
    await assertWrongMime(page, "image-resize");
    await uploadFile(page, SOURCE_PNG);
    await waitForSourceImage(page);
    const before = await inspectPreview(page);
    await setRange(page, "Width", 320);
    await setRange(page, "Height", 240);
    await clickButton(page, "Run");
    await waitForResult(page);
    const preview = await inspectPreview(page);
    const meta = await resultMeta(page);
    check(
      "image-resize: the preview really changed the source pixels",
      preview.pixelSha256 !== before.pixelSha256,
      { before: before.pixelSha256, after: preview.pixelSha256 },
    );
    await saveToLibrary(page);
    const persisted = await readPersisted(page, "resized");
    const exported = await exportAndVerify(page, persisted);
    verifyArtifact({
      label: "image-resize",
      preview,
      meta,
      persisted,
      exported,
      expectedWidth: 320,
      expectedHeight: 240,
      expectedMime: "image/png",
      expectedMagic: "89 50 4e 47",
      expectedExtension: "png",
    });
    report.tools.push({ tool: "image-resize", before, preview, meta, persisted, exported });
    await shot(page, "05-resize-result");
  }

  /* ------------------------------------------------------- Image Rotator */
  {
    await openTool(page, "Image Rotator");
    await assertWrongMime(page, "Image Rotator");
    await uploadFile(page, SOURCE_PNG);
    await waitForSourceImage(page);
    await clickButton(page, "Run");
    await waitForResult(page);
    const preview = await inspectPreview(page);
    const meta = await resultMeta(page);
    check(
      "image-rotate: a 90° turn swaps the real dimensions",
      preview.width === 480 && preview.height === 640,
      { width: preview.width, height: preview.height },
    );
    check(
      "image-rotate: the result reports the applied rotation",
      meta.chips.some((chip) => chip.includes("rotation") && chip.includes("90")),
      meta.chips,
    );
    await saveToLibrary(page);
    const persisted = await readPersisted(page, "rotated");
    const exported = await exportAndVerify(page, persisted);
    verifyArtifact({
      label: "image-rotate",
      preview,
      meta,
      persisted,
      exported,
      expectedWidth: 480,
      expectedHeight: 640,
      expectedMime: "image/png",
      expectedMagic: "89 50 4e 47",
      expectedExtension: "png",
    });
    report.tools.push({ tool: "image-rotate", preview, meta, persisted, exported });
    await shot(page, "05b-rotate-result");
  }

  /* --------------------------------------------------------- Image Cropper */
  {
    await openTool(page, "Image Cropper");
    await assertWrongMime(page, "Image Cropper");
    await uploadFile(page, SOURCE_PNG);
    await waitForSourceImage(page);
    await setRange(page, "Crop width", 300);
    await setRange(page, "Crop height", 200);
    await clickButton(page, "Run");
    await waitForResult(page);
    const preview = await inspectPreview(page);
    const meta = await resultMeta(page);
    check(
      "image-crop: the output is exactly the requested rectangle",
      preview.width === 300 && preview.height === 200,
      { width: preview.width, height: preview.height },
    );
    await saveToLibrary(page);
    const persisted = await readPersisted(page, "cropped");
    const exported = await exportAndVerify(page, persisted);
    verifyArtifact({
      label: "image-crop",
      preview,
      meta,
      persisted,
      exported,
      expectedWidth: 300,
      expectedHeight: 200,
      expectedMime: "image/png",
      expectedMagic: "89 50 4e 47",
      expectedExtension: "png",
    });
    report.tools.push({ tool: "image-crop", preview, meta, persisted, exported });
    await shot(page, "05c-crop-result");
  }

  /* ------------------------------------------------------- Image Pixelator */
  {
    await openTool(page, "Image Pixelator");
    await assertWrongMime(page, "Image Pixelator");
    await uploadFile(page, SOURCE_PNG);
    await waitForSourceImage(page);
    const before = await inspectPreview(page);
    await clickButton(page, "Run");
    await waitForResult(page);
    const preview = await inspectPreview(page);
    const meta = await resultMeta(page);
    check(
      "image-pixelate: the mosaic changes real pixels but keeps the frame",
      preview.width === 640 &&
        preview.height === 480 &&
        preview.pixelSha256 !== before.pixelSha256,
      { width: preview.width, height: preview.height },
    );
    await saveToLibrary(page);
    const persisted = await readPersisted(page, "pixelated");
    const exported = await exportAndVerify(page, persisted);
    verifyArtifact({
      label: "image-pixelate",
      preview,
      meta,
      persisted,
      exported,
      expectedWidth: 640,
      expectedHeight: 480,
      expectedMime: "image/png",
      expectedMagic: "89 50 4e 47",
      expectedExtension: "png",
    });
    report.tools.push({ tool: "image-pixelate", preview, meta, persisted, exported });
    await shot(page, "05d-pixelate-result");
  }

  /* ------------------------------------------------------- Image Compressor */
  {
    await openTool(page, "Image compressor");
    await assertWrongMime(page, "Image compressor");
    await uploadFile(page, SOURCE_PNG);
    await waitForSourceImage(page);
    await clickButton(page, "Run");
    await waitForResult(page);
    const preview = await inspectPreview(page);
    const meta = await resultMeta(page);
    const chips = (meta?.chips ?? []).join(" | ");
    const savedPercent = Number((chips.match(/savedPercent\s+(-?[\d.]+)/) ?? [])[1] ?? 0);
    const reportedOutput = Number((chips.match(/outputBytes\s+(\d+)/) ?? [])[1] ?? -1);
    check(
      "image-compress: the frame is kept and the result is a JPEG",
      preview.width === 640 && preview.height === 480 && /image\/jpeg/.test(meta?.summary ?? ""),
      { width: preview.width, height: preview.height, summary: meta?.summary },
    );
    check(
      "image-compress: the saving is measured from the real source bytes",
      savedPercent > 0 && reportedOutput > 0 && reportedOutput < 104117,
      { savedPercent, reportedOutput, chips },
    );
    await saveToLibrary(page);
    const persisted = await readPersisted(page, "compressed");
    const exported = await exportAndVerify(page, persisted);
    verifyArtifact({
      label: "image-compress",
      preview,
      meta,
      persisted,
      exported,
      expectedWidth: 640,
      expectedHeight: 480,
      expectedMime: "image/jpeg",
      expectedMagic: "ff d8",
      expectedExtension: "jpg",
    });
    report.tools.push({ tool: "image-compress", preview, meta, persisted, exported });
    await shot(page, "05e-compress-result");
  }

  /* ----------------------------------------------------------- Frame Sheet */
  {
    await openTool(page, "Frame sheet");
    await assertWrongMime(page, "Frame sheet");
    await uploadFile(page, VIDEO_FIXTURE);
    await waitForSourceMedia(page, "video");
    await clickButton(page, "Run");
    await waitForResult(page);
    const preview = await inspectPreview(page);
    const meta = await resultMeta(page);
    const sheetChips = (meta?.chips ?? []).join(" | ");
    const sheetCount = Number((sheetChips.match(/count\s+(\d+)/) ?? [])[1] ?? 0);
    const sheetDuration = Number((sheetChips.match(/duration\s+([\d.]+)/) ?? [])[1] ?? 0);
    check(
      "video-frame-sheet: the default 6 frames compose a 3x2 sheet",
      preview.width === 992 && preview.height === 428 && /image\/png/.test(meta?.summary ?? ""),
      { width: preview.width, height: preview.height, summary: meta?.summary },
    );
    check(
      "video-frame-sheet: every tile is a sampled frame from a measured duration",
      sheetCount === 6 && sheetDuration > 0,
      { sheetCount, sheetDuration, sheetChips },
    );
    await saveToLibrary(page);
    const persisted = await readPersisted(page, "sheet");
    const exported = await exportAndVerify(page, persisted);
    verifyArtifact({
      label: "video-frame-sheet",
      preview,
      meta,
      persisted,
      exported,
      expectedWidth: 992,
      expectedHeight: 428,
      expectedMime: "image/png",
      expectedMagic: "89 50 4e 47",
      expectedExtension: "png",
    });
    report.tools.push({ tool: "video-frame-sheet", preview, meta, persisted, exported });
    await shot(page, "05f-frame-sheet");
  }

  /* -------------------------------------------------------- Video Thumbnail */
  {
    await openTool(page, "Video Thumbnail");
    await assertWrongMime(page, "video-thumbnail");
    await uploadFile(page, VIDEO_FIXTURE);
    const sourceMedia = await waitForSourceMedia(page, "video");
    check(
      "video-thumbnail: the uploaded video preview reports its real metadata",
      sourceMedia.width === 1920 &&
        sourceMedia.height === 1080 &&
        sourceMedia.duration > 3 &&
        sourceMedia.duration < 4,
      sourceMedia,
    );
    await setRange(page, "Timestamp", 1.2);
    await clickButton(page, "Run");
    await waitForResult(page, 120000);
    const preview = await inspectPreview(page);
    const meta = await resultMeta(page);
    check(
      "video-thumbnail: the extracted frame is a real 1920×1080 image",
      preview.width === 1920 && preview.height === 1080 && preview.uniqueColours > 8,
      {
        width: preview.width,
        height: preview.height,
        uniqueColours: preview.uniqueColours,
        meanLuma: preview.meanLuma,
      },
    );
    check(
      "video-thumbnail: the result reports the exact timestamp and duration",
      meta.chips.some((chip) => chip.includes("timestamp") && chip.includes("1.2")) &&
        meta.chips.some((chip) => chip.includes("duration") && chip.includes("3.4")),
      meta.chips,
    );
    await saveToLibrary(page);
    const persisted = await readPersisted(page, "thumbnail");
    const exported = await exportAndVerify(page, persisted);
    verifyArtifact({
      label: "video-thumbnail",
      preview,
      meta,
      persisted,
      exported,
      expectedWidth: 1920,
      expectedHeight: 1080,
      expectedMime: "image/png",
      expectedMagic: "89 50 4e 47",
      expectedExtension: "png",
    });
    report.tools.push({ tool: "video-thumbnail", sourceMedia, preview, meta, persisted, exported });
    await shot(page, "06-video-thumbnail-result");
  }

  /* -------------------------------------------------------- Audio Visualizer */
  {
    await openTool(page, "Audio Visualizer");
    await assertWrongMime(page, "audio-visualizer");
    await uploadFile(page, AUDIO_WAV);
    const sourceMedia = await waitForSourceMedia(page, "audio");
    check(
      "audio-visualizer: the uploaded WAV preview reports its real duration",
      sourceMedia.duration > 1.9 && sourceMedia.duration < 2.1,
      sourceMedia,
    );
    await setRange(page, "Width", 800);
    await setRange(page, "Height", 240);
    await clickButton(page, "Run");
    await waitForResult(page);
    const preview = await inspectPreview(page);
    const meta = await resultMeta(page);
    check(
      "audio-visualizer: the waveform image is 800×240 with real strokes",
      preview.width === 800 &&
        preview.height === 240 &&
        preview.uniqueColours > 2 &&
        preview.changedFromCorner > 0.001,
      {
        width: preview.width,
        height: preview.height,
        uniqueColours: preview.uniqueColours,
        changed: preview.changedFromCorner,
      },
    );
    check(
      "audio-visualizer: the result reports the decoded sample rate and channels",
      meta.chips.some((chip) => chip.includes("sampleRate") && chip.includes("44100")) &&
        meta.chips.some((chip) => chip.includes("channels") && chip.includes("1")),
      meta.chips,
    );
    await saveToLibrary(page);
    const persisted = await readPersisted(page, "waveform");
    const exported = await exportAndVerify(page, persisted);
    verifyArtifact({
      label: "audio-visualizer",
      preview,
      meta,
      persisted,
      exported,
      expectedWidth: 800,
      expectedHeight: 240,
      expectedMime: "image/png",
      expectedMagic: "89 50 4e 47",
      expectedExtension: "png",
    });
    report.tools.push({ tool: "audio-visualizer", sourceMedia, preview, meta, persisted, exported });
    await shot(page, "07-audio-visualizer-result");
  }

  /* -------------------------------------------------- Text Image Generator */
  {
    await openTool(page, "Text Image Generator");
    await assertEmptyText(page, "text-image");
    await typeText(page, "KNOUX REC\nToolbox");
    await setRange(page, "Width", 800);
    await setRange(page, "Height", 400);
    await setRange(page, "Font size", 48);
    await clickButton(page, "Run");
    await waitForResult(page);
    const preview = await inspectPreview(page);
    const meta = await resultMeta(page);
    check(
      "text-image: the rendered canvas is 800×400 with visible glyph pixels",
      preview.width === 800 &&
        preview.height === 400 &&
        preview.uniqueColours > 2 &&
        preview.changedFromCorner > 0.001,
      {
        width: preview.width,
        height: preview.height,
        uniqueColours: preview.uniqueColours,
        changed: preview.changedFromCorner,
      },
    );
    check(
      "text-image: the result reports two rendered lines",
      meta.chips.some((chip) => chip.includes("lines") && chip.includes("2")),
      meta.chips,
    );
    await saveToLibrary(page);
    const persisted = await readPersisted(page, "KNOUX REC");
    const exported = await exportAndVerify(page, persisted);
    verifyArtifact({
      label: "text-image",
      preview,
      meta,
      persisted,
      exported,
      expectedWidth: 800,
      expectedHeight: 400,
      expectedMime: "image/png",
      expectedMagic: "89 50 4e 47",
      expectedExtension: "png",
    });
    report.tools.push({ tool: "text-image", preview, meta, persisted, exported });
    await shot(page, "08-text-image-result");
  }

  /* ------------------------------------------------------ Color Palette */
  {
    await openTool(page, "Color Palette Extractor");
    await assertWrongMime(page, "color-palette");
    await uploadFile(page, PALETTE_PNG);
    await waitForSourceImage(page);
    await clickButton(page, "Run");
    await waitForResult(page);
    const preview = await inspectPreview(page);
    const meta = await resultMeta(page);
    const hexes = [...meta.chips.join(" ").matchAll(/#[0-9a-f]{6}/gi)].map((match) =>
      match[0].toLowerCase(),
    );
    check(
      "color-palette: the output is a real swatch strip",
      hexes.length >= 4 &&
        preview.height === 96 &&
        preview.width === hexes.length * 96 &&
        preview.uniqueColours >= 4,
      {
        hexes,
        width: preview.width,
        height: preview.height,
        uniqueColours: preview.uniqueColours,
      },
    );
    const sampled = await page.evaluate(
      ({ count }) => window.__KX.sampleSwatches(".kx-preview img", count),
      { count: hexes.length },
    );
    check(
      "color-palette: every painted swatch matches its reported hex colour",
      Boolean(sampled) &&
        sampled.length === hexes.length &&
        sampled.every((colour, index) => colour === hexes[index]),
      { sampled, hexes },
    );
    await saveToLibrary(page);
    const persisted = await readPersisted(page, "palette");
    const exported = await exportAndVerify(page, persisted);
    verifyArtifact({
      label: "color-palette",
      preview,
      meta,
      persisted,
      exported,
      expectedWidth: hexes.length * 96,
      expectedHeight: 96,
      expectedMime: "image/png",
      expectedMagic: "89 50 4e 47",
      expectedExtension: "png",
    });
    report.tools.push({ tool: "color-palette", preview, meta, persisted, exported, sampled });
    await shot(page, "09-palette-result");
  }

  /* -------------------------------------------------------- Cancellation */
  {
    await openTool(page, "Audio Visualizer");
    await uploadFile(page, CANCEL_WAV);
    await waitForSourceMedia(page, "audio");
    const clicked = await page.evaluate(async () => {
      const run = [...document.querySelectorAll(".kx-btn")].find((element) =>
        ["Run", "Run again"].includes(element.textContent?.trim() ?? ""),
      );
      if (!run) return { clicked: false, reason: "run button missing" };
      run.click();
      for (let attempt = 0; attempt < 600; attempt += 1) {
        const cancel = [...document.querySelectorAll(".kx-btn")].find(
          (element) => element.textContent?.trim() === "Cancel",
        );
        if (cancel) {
          cancel.click();
          return { clicked: true, waitedMs: attempt * 5 };
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return { clicked: false, reason: "cancel button never appeared" };
    });
    await sleep(2500);
    await page
      .waitForFunction(
        () => {
          const text = document.body.innerText;
          const result = [...document.querySelectorAll(".kx-card")].find((element) =>
            element.textContent?.includes("Result"),
          );
          return text.includes("Cancelled") || Boolean(result);
        },
        { timeout: 60000, polling: 200 },
      )
      .catch(() => undefined);
    const cancelled = await page.evaluate(() => {
      const progress = [...document.querySelectorAll(".kx-card")].find((element) =>
        element.textContent?.includes("Cancelled"),
      );
      const result = [...document.querySelectorAll(".kx-card")].find((element) =>
        element.textContent?.includes("Result"),
      );
      return { cancelled: Boolean(progress), result: Boolean(result) };
    });
    report.cancellation = { clicked, cancelled };
    check(
      "toolbox: a long audio job can be cancelled without producing a result",
      clicked.clicked && cancelled.cancelled && !cancelled.result,
      { clicked, cancelled },
    );
    await shot(page, "10-cancelled-audio");
  }

  /* ------------------------------------------------ Cleanup + reload */
  const countersBefore = await page.evaluate(() => ({ ...window.__kxUrlCounters }));
  await page.evaluate(() => {
    window.location.hash = "#/";
  });
  await page.waitForFunction(() => !document.querySelector(".kx-tool-layout"), {
    timeout: 15000,
  });
  await sleep(500);
  const countersAfter = await page.evaluate(() => ({ ...window.__kxUrlCounters }));
  report.urlCounters = { before: countersBefore, after: countersAfter };
  check(
    "toolbox: unmounting the route revokes its object URLs",
    countersAfter.revoked > countersBefore.revoked,
    { before: countersBefore, after: countersAfter },
  );

  const persistedToolboxCount = await countPersisted(page, "toolbox");
  check(
    "toolbox: all saved results survive in IndexedDB",
    persistedToolboxCount >= 9,
    persistedToolboxCount,
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForApp(page);
  const reloadedCount = await countPersisted(page, "toolbox");
  check(
    "toolbox: saved results survive a full page reload",
    reloadedCount === persistedToolboxCount && reloadedCount >= 9,
    { before: persistedToolboxCount, after: reloadedCount },
  );

  await page.evaluate(() => {
    window.location.hash = "#/library";
  });
  await sleep(1200);
  const libraryText = await page.evaluate(() => document.body.innerText);
  check(
    "toolbox: the library route shows saved items after reload",
    /resized|waveform|thumbnail|palette|KNOUX/i.test(libraryText),
    libraryText.slice(0, 300),
  );

  /* ---------------------------------------------------------- Arabic RTL */
  await page.evaluate(() => {
    window.location.hash = "#/toolbox";
  });
  await page.waitForSelector(".kx-tool-card", { timeout: 20000 });
  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".kx-topbar button")].find(
      (element) => element.textContent?.trim() === "AR",
    );
    button?.click();
  });
  await sleep(700);
  await openTool(page, "QR Code Generator");
  const rtl = await page.evaluate(() => ({
    dir: document.documentElement.dir,
    lang: document.documentElement.lang,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    cards: document.querySelectorAll(".kx-tool-card").length,
  }));
  report.rtl = rtl;
  check("toolbox: Arabic mode switches the document to RTL", rtl.dir === "rtl", rtl);
  check("toolbox: no horizontal overflow in Arabic", rtl.overflow <= 0, rtl.overflow);
  await shot(page, "11-toolbox-arabic-rtl");

  check("toolbox: no uncaught page errors", report.pageErrors.length === 0, report.pageErrors);
  check("toolbox: no console errors", report.consoleErrors.length === 0, report.consoleErrors);
} catch (error) {
  report.fatal = String(error?.stack ?? error);
  console.error(`FATAL ${error?.stack ?? error}`);
} finally {
  await browser.close();
}

const failed = report.checks.filter((entry) => !entry.pass);
report.finishedAt = new Date().toISOString();
report.failed = failed.length;
await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));

console.log(
  `toolbox smoke: ${report.checks.length - failed.length}/${report.checks.length} checks passed`,
);
if (failed.length || report.fatal) process.exit(1);
