#!/usr/bin/env node
/**
 * Toolbox smoke test.
 *
 * Drives the real Toolbox route in a real Chrome instance and verifies that the
 * tools produce genuine bytes:
 *  - the QR symbol is rendered to a real PNG and read back from IndexedDB,
 *  - the resizer is checked against the decoded PNG header of the saved file,
 *  - the palette reports real sampled hex colours,
 *  - the negative path is exercised,
 *  - the Arabic right-to-left pass is checked for overflow.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.KNOUX_BASE_URL ?? "http://localhost:4173/";
const OUT = path.resolve("artifacts/evidence/toolbox");
const CHROME =
  process.env.KNOUX_CHROME ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

await mkdir(OUT, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  base: BASE,
  chrome: CHROME,
  checks: [],
  consoleErrors: [],
  pageErrors: [],
  tools: [],
};

/* ---------------- a tiny PNG writer so the test has a real input file ------ */

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
    raw[offset] = 0; // filter: none
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  await writeFile(filePath, png);
  return png;
}

function describePng(buffer) {
  const signature = Array.from(buffer.subarray(0, 8));
  const isPng =
    signature[0] === 0x89 &&
    signature[1] === 0x50 &&
    signature[2] === 0x4e &&
    signature[3] === 0x47 &&
    signature[4] === 0x0d &&
    signature[5] === 0x0a &&
    signature[6] === 0x1a &&
    signature[7] === 0x0a;
  return {
    bytes: buffer.length,
    isPng,
    signature: signature.map((value) => value.toString(16).padStart(2, "0")).join(" "),
    width: isPng ? buffer.readUInt32BE(16) : 0,
    height: isPng ? buffer.readUInt32BE(20) : 0,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  };
}

function check(name, pass, detail) {
  report.checks.push({ name, pass, detail });
  if (!pass) console.error(`FAIL ${name}: ${JSON.stringify(detail)}`);
  else console.log(`PASS ${name}`);
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

async function waitForApp(page) {
  await page.waitForSelector(".kx-app", { timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector(".kx-splash"), {
    timeout: 20000,
  });
}

/** Read the rendered image back through a canvas and hash its real pixels. */
async function inspectRenderedImage(page, selector) {
  return page.evaluate(async (target) => {
    const image = document.querySelector(target);
    if (!image) return null;
    if (!image.complete) {
      await new Promise((resolve) => {
        image.onload = resolve;
        image.onerror = resolve;
      });
    }
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const frame = context.getImageData(0, 0, canvas.width, canvas.height);
    const digest = await crypto.subtle.digest("SHA-256", frame.data);
    const hash = Array.from(new Uint8Array(digest))
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    const centre = (() => {
      const x = Math.floor(canvas.width / 2);
      const y = Math.floor(canvas.height / 2);
      const index = (y * canvas.width + x) * 4;
      return [frame.data[index], frame.data[index + 1], frame.data[index + 2]];
    })();
    return {
      width: canvas.width,
      height: canvas.height,
      pixelSha256: hash,
      centrePixel: centre,
      src: image.src.slice(0, 12),
    };
  }, selector);
}

/** Read a stored library item back out of IndexedDB and return its bytes. */
async function readPersistedItem(page, nameFragment) {
  const dataUrl = await page.evaluate(async (fragment) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("knoux-rec.library", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const items = await new Promise((resolve, reject) => {
      const tx = db.transaction("items", "readonly");
      const request = tx.objectStore("items").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    const match = items
      .filter((item) => item.name.includes(fragment))
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!match) return null;
    const blob = match.blob;
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve({ name: match.name, mimeType: match.mimeType, dataUrl: reader.result });
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }, nameFragment);

  if (!dataUrl) return null;
  const base64 = String(dataUrl.dataUrl).split(",")[1];
  const buffer = Buffer.from(base64, "base64");
  return {
    name: dataUrl.name,
    mimeType: dataUrl.mimeType,
    ...describePng(buffer),
  };
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1600,1000"],
});

try {
  const page = await browser.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") {
      report.consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => report.pageErrors.push(String(error?.stack ?? error)));
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });

  await page.goto(`${BASE}#/toolbox`, { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await page.waitForSelector(".kx-tool-card", { timeout: 15000 });

  const catalog = await page.evaluate(() =>
    [...document.querySelectorAll(".kx-tool-card")].map((card) => ({
      name: card.querySelector(".kx-tool-name")?.textContent?.trim() ?? "",
      category: card.querySelector(".kx-chip")?.textContent?.trim() ?? "",
    })),
  );
  report.catalog = catalog;
  check("toolbox catalog lists eight tools", catalog.length === 8, catalog.length);
  check(
    "catalog shows the eight documented tools",
    [
      "Image Resizer",
      "Image Filters",
      "Format Converter",
      "Video Thumbnail",
      "Audio Visualizer",
      "Text Image Generator",
      "QR Code Generator",
      "Color Palette Extractor",
    ].every((name) => catalog.some((entry) => entry.name === name)),
    catalog.map((entry) => entry.name),
  );
  await shot(page, "01-toolbox-catalog");

  const openTool = async (name) => {
    // The catalog is replaced by the service screen, so return to it first.
    const back = await page.evaluate(() => {
      const button = [...document.querySelectorAll(".kx-btn")].find((element) =>
        element.textContent?.trim() === "All tools",
      );
      if (!button) return false;
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return true;
    });
    if (back) await new Promise((r) => setTimeout(r, 350));
    await page.evaluate((label) => {
      const card = [...document.querySelectorAll(".kx-tool-card")].find(
        (element) => element.querySelector(".kx-tool-name")?.textContent?.trim() === label,
      );
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }, name);
    await new Promise((r) => setTimeout(r, 400));
  };

  const clickButton = async (label) => {
    await page.evaluate((text) => {
      const button = [...document.querySelectorAll(".kx-btn")].find(
        (element) => element.textContent?.trim() === text,
      );
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }, label);
  };

  /* ---------------- QR tool ---------------- */
  await openTool("QR Code Generator");
  check(
    "QR tool opens its own service screen",
    (await page.$(".kx-tool-layout")) !== null,
    "no toolbox layout",
  );

  // Negative path first: running without text must fail loudly.
  await clickButton("Run");
  await new Promise((r) => setTimeout(r, 600));
  const negative = await page.evaluate(() => {
    const notice = document.querySelector('.kx-notice[data-tone="danger"]');
    return { text: notice?.textContent?.trim() ?? null };
  });
  check(
    "running the QR tool without text fails with a real message",
    Boolean(negative.text && negative.text.length > 10),
    negative,
  );
  report.tools.push({ tool: "qr-code", negative });

  const payload = "https://knoux.app/qr-test";
  await page.type(".kx-tool-layout textarea", payload);
  await clickButton("Run");
  await page.waitForFunction(
    () =>
      Boolean(document.querySelector(".kx-tool-stage img")) &&
      Boolean(document.querySelector(".kx-badge[data-state='VERIFIED']")),
    { timeout: 25000 },
  );
  await new Promise((r) => setTimeout(r, 400));

  const qr = await inspectRenderedImage(page, ".kx-tool-stage img");
  const qrMeta = await page.evaluate(() => {
    const card = [...document.querySelectorAll(".kx-card")].find((element) =>
      element.textContent?.includes("Result"),
    );
    return {
      summary: card?.querySelector(".kx-card-sub")?.textContent?.trim() ?? "",
      chips: [...(card?.querySelectorAll(".kx-chip") ?? [])].map((chip) =>
        chip.textContent?.trim() ?? "",
      ),
    };
  });
  report.tools.push({ tool: "qr-code", payload, rendered: qr, meta: qrMeta });
  check(
    "QR output renders a square image",
    Boolean(qr && qr.width === qr.height && qr.width > 100),
    qr ? { width: qr.width, height: qr.height } : null,
  );
  check(
    "QR result reports the encoded version and error correction",
    qrMeta.chips.some((chip) => chip.includes("version")) &&
      qrMeta.chips.some((chip) => chip.includes("ecLevel")),
    qrMeta.chips,
  );

  // Save it to the library and read the real bytes back out of IndexedDB.
  await clickButton("Save to library");
  await new Promise((r) => setTimeout(r, 900));
  const qrFile = await readPersistedItem(page, "qr");
  report.tools.push({ tool: "qr-code", persisted: qrFile });
  check("QR result was persisted to the library", qrFile !== null, qrFile);
  check(
    "persisted QR file is a valid PNG",
    Boolean(qrFile?.isPng),
    qrFile ? { signature: qrFile.signature, bytes: qrFile.bytes } : null,
  );
  check(
    "persisted QR file matches the rendered image size",
    Boolean(qrFile && qrFile.width === qr.width && qrFile.height === qr.height),
    qrFile ? { file: [qrFile.width, qrFile.height], rendered: [qr?.width, qr?.height] } : null,
  );
  await shot(page, "02-qr-result");

  /* ---------------- resizer with a real file ---------------- */
  const inputFile = path.join(OUT, "input-source.png");
  const sourceBytes = await writePng(inputFile, 640, 480, (x, y) => [
    Math.round((x / 640) * 255),
    Math.round((y / 480) * 255),
    200,
  ]);
  const sourceInfo = describePng(sourceBytes);

  await openTool("Image Resizer");
  const input = await page.$(".kx-tool-layout input[type='file']");
  check("resizer exposes a real file input", input !== null, "no file input");
  await input.uploadFile(inputFile);
  await new Promise((r) => setTimeout(r, 500));

  await page.evaluate(() => {
    const slider = document.querySelector(".kx-tool-settings input[type='range']");
    if (slider) {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      ).set;
      setter.call(slider, "320");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      slider.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await new Promise((r) => setTimeout(r, 300));

  await clickButton("Run");
  await page.waitForFunction(
    () => Boolean(document.querySelector(".kx-tool-stage img")),
    { timeout: 25000 },
  );
  await new Promise((r) => setTimeout(r, 400));

  const resized = await inspectRenderedImage(page, ".kx-tool-stage img");
  report.tools.push({ tool: "image-resize", source: sourceInfo, rendered: resized });
  check(
    "resizer really changed the pixel dimensions",
    Boolean(resized && resized.width === 320 && resized.height === 240),
    resized ? { width: resized.width, height: resized.height } : null,
  );

  await clickButton("Save to library");
  await new Promise((r) => setTimeout(r, 900));
  const resizedFile = await readPersistedItem(page, "resized");
  report.tools.push({ tool: "image-resize", persisted: resizedFile });
  check("resized result was persisted to the library", resizedFile !== null, resizedFile);
  check(
    "persisted resized file is a valid PNG with the new size",
    Boolean(resizedFile?.isPng && resizedFile.width === 320 && resizedFile.height === 240),
    resizedFile
      ? { signature: resizedFile.signature, width: resizedFile.width, height: resizedFile.height }
      : null,
  );
  check(
    "resized bytes differ from the source bytes",
    Boolean(resizedFile && resizedFile.sha256 !== sourceInfo.sha256),
    { source: sourceInfo.sha256, result: resizedFile?.sha256 },
  );
  await shot(page, "03-resize-result");

  /* ---------------- colour palette ---------------- */
  await openTool("Color Palette Extractor");
  const paletteInput = await page.$(".kx-tool-layout input[type='file']");
  await paletteInput.uploadFile(inputFile);
  await new Promise((r) => setTimeout(r, 500));
  await clickButton("Run");
  await page.waitForFunction(
    () => Boolean(document.querySelector(".kx-tool-stage img")),
    { timeout: 25000 },
  );
  await new Promise((r) => setTimeout(r, 400));
  const palette = await inspectRenderedImage(page, ".kx-tool-stage img");
  const paletteMeta = await page.evaluate(() => {
    const card = [...document.querySelectorAll(".kx-card")].find((element) =>
      element.textContent?.includes("Result"),
    );
    return {
      chips: [...(card?.querySelectorAll(".kx-chip") ?? [])].map((chip) =>
        chip.textContent?.trim() ?? "",
      ),
    };
  });
  report.tools.push({ tool: "color-palette", rendered: palette, meta: paletteMeta });
  check("palette output renders an image", palette !== null, palette);
  check(
    "palette reports real hex colours",
    paletteMeta.chips.some((chip) => /#[0-9a-f]{6}/i.test(chip)),
    paletteMeta.chips,
  );
  await shot(page, "04-palette-result");

  /* ---------------- Arabic right-to-left pass ---------------- */
  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".kx-topbar button")].find(
      (element) => element.textContent?.trim() === "AR",
    );
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 600));
  await openTool("QR Code Generator");
  const rtl = await page.evaluate(() => ({
    dir: document.documentElement.dir,
    lang: document.documentElement.lang,
    overflow:
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  report.rtl = rtl;
  check("Arabic mode switches the document to RTL", rtl.dir === "rtl", rtl);
  check("toolbox has no horizontal overflow in Arabic", rtl.overflow <= 0, rtl.overflow);
  await shot(page, "05-toolbox-arabic-rtl");

  check("no uncaught page errors", report.pageErrors.length === 0, report.pageErrors);
  check("no console errors", report.consoleErrors.length === 0, report.consoleErrors);
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
if (failed.length) process.exit(1);
