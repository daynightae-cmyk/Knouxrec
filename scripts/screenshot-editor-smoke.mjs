#!/usr/bin/env node
/**
 * KNOUX REC — Screenshot Studio editor smoke.
 *
 * Captures a real frame from the fake display stream, then drives the editor:
 * crop, arrow, text, blur, undo, before/after, library save and PNG export.
 * Every assertion reads the actual canvas pixels or the stored bytes.
 */

import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { decodePng } from "./lib/png.mjs";

const BASE = process.env.KNOUX_BASE_URL ?? "http://localhost:4173/";
const OUT = path.resolve("artifacts/evidence/screenshot-editor");
const DOWNLOADS = path.join(OUT, "downloads");
const CHROME =
  process.env.KNOUX_CHROME ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

await rm(OUT, { recursive: true, force: true });
await mkdir(DOWNLOADS, { recursive: true });

const report = { checks: [], consoleErrors: [], pageErrors: [], screens: [] };

function check(name, pass, detail = null) {
  report.checks.push({ name, pass: Boolean(pass), detail });
  if (!pass) console.error(`FAIL ${name}: ${JSON.stringify(detail)}`);
  else console.log(`PASS ${name}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  report.screens.push(file);
  return file;
}

async function canvasHash(page) {
  return page.evaluate(async () => {
    const canvas = document.querySelector(".kx-shot-canvas");
    if (!canvas) return null;
    const copy = document.createElement("canvas");
    copy.width = canvas.width;
    copy.height = canvas.height;
    const context = copy.getContext("2d", { willReadFrequently: true });
    context.drawImage(canvas, 0, 0);
    const data = context.getImageData(0, 0, copy.width, copy.height).data;
    const digest = await crypto.subtle.digest("SHA-256", data);
    return {
      width: canvas.width,
      height: canvas.height,
      sha256: Array.from(new Uint8Array(digest))
        .map((value) => value.toString(16).padStart(2, "0"))
        .join(""),
    };
  });
}

async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await sleep(450);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--auto-select-desktop-capture-source=Entire screen",
    "--autoplay-policy=no-user-gesture-required",
    "--window-size=1600,1000",
    "--no-first-run",
  ],
  defaultViewport: { width: 1600, height: 1000 },
});

try {
  const page = await browser.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => report.pageErrors.push(String(error)));

  const cdp = await page.createCDPSession();
  await cdp.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: DOWNLOADS,
  });

  await page.goto(`${BASE}?nc=${Date.now()}#/screenshots`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForSelector(".kx-app", { timeout: 30000 });
  await sleep(600);

  // 1. Real capture through the display stream.
  const clicked = await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find(
      (element) => element.textContent?.trim() === "Capture screen",
    );
    if (!button) return false;
    button.click();
    return true;
  });
  check("a real screenshot can be requested", clicked);
  await page.waitForSelector(".kx-shot-canvas", { timeout: 30000 });
  await page.waitForFunction(
    () => !document.querySelector(".kx-shot-loading"),
    { timeout: 30000 },
  );
  await sleep(300);

  const original = await canvasHash(page);
  check(
    "the editor decodes the captured pixels",
    Boolean(original && original.width > 0 && original.height > 0),
    original,
  );
  await shot(page, "01-editor-open");

  const overlay = await page.evaluate(() => {
    const element = document.querySelector(".kx-shot-overlay");
    const rect = element.getBoundingClientRect();
    const canvas = document.querySelector(".kx-shot-canvas");
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    };
  });
  check("the overlay tracks the canvas geometry", overlay.width > 100 && overlay.height > 60, overlay);

  // 2. Crop by dragging on the overlay (Crop is the default tool).
  const cropStart = { x: overlay.x + overlay.width * 0.2, y: overlay.y + overlay.height * 0.25 };
  const cropEnd = { x: overlay.x + overlay.width * 0.65, y: overlay.y + overlay.height * 0.7 };
  await drag(page, cropStart, cropEnd);
  const cropped = await canvasHash(page);
  const expectedWidth = Math.round(
    (overlay.width > 0 ? (cropEnd.x - cropStart.x) / overlay.width : 0) * overlay.canvasWidth,
  );
  check(
    "crop produces the dragged rectangle in real pixels",
    Boolean(
      cropped &&
        Math.abs(cropped.width - expectedWidth) <= 6 &&
        cropped.width < original.width &&
        cropped.height < original.height &&
        cropped.sha256 !== original.sha256,
    ),
    { cropped, expectedWidth, original: { w: original?.width, h: original?.height } },
  );
  await shot(page, "02-after-crop");

  // Re-read the overlay after the crop resized the canvas.
  const overlay2 = await page.evaluate(() => {
    const rect = document.querySelector(".kx-shot-overlay").getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });

  const clickTool = async (label) => {
    const ok = await page.evaluate((needle) => {
      const button = [...document.querySelectorAll(".kx-shot-tool")].find(
        (element) => element.textContent?.trim() === needle,
      );
      if (!button) return false;
      button.click();
      return true;
    }, label);
    if (!ok) throw new Error(`Tool not found: ${label}`);
    await sleep(150);
  };

  // 3. Arrow annotation changes real pixels.
  await clickTool("Arrow");
  const beforeArrow = await canvasHash(page);
  await drag(
    page,
    { x: overlay2.x + overlay2.width * 0.15, y: overlay2.y + overlay2.height * 0.2 },
    { x: overlay2.x + overlay2.width * 0.5, y: overlay2.y + overlay2.height * 0.45 },
  );
  const afterArrow = await canvasHash(page);
  check(
    "arrow annotation changes real pixels",
    Boolean(afterArrow && beforeArrow && afterArrow.sha256 !== beforeArrow.sha256),
    { before: beforeArrow?.sha256, after: afterArrow?.sha256 },
  );

  // 4. Text annotation.
  await clickTool("Text");
  await page.evaluate(() => {
    const input = document.querySelector(".kx-shot-text");
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(input, "KNOUX SMOKE");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const beforeText = await canvasHash(page);
  await drag(
    page,
    { x: overlay2.x + overlay2.width * 0.2, y: overlay2.y + overlay2.height * 0.62 },
    { x: overlay2.x + overlay2.width * 0.2 + 4, y: overlay2.y + overlay2.height * 0.62 + 4 },
  );
  const afterText = await canvasHash(page);
  check(
    "text annotation changes real pixels",
    Boolean(afterText && beforeText && afterText.sha256 !== beforeText.sha256),
    { before: beforeText?.sha256, after: afterText?.sha256 },
  );

  // 5. Blur a region.
  await clickTool("Blur");
  const beforeBlur = await canvasHash(page);
  await drag(
    page,
    { x: overlay2.x + overlay2.width * 0.55, y: overlay2.y + overlay2.height * 0.5 },
    { x: overlay2.x + overlay2.width * 0.9, y: overlay2.y + overlay2.height * 0.85 },
  );
  const afterBlur = await canvasHash(page);
  check(
    "blur region changes real pixels",
    Boolean(afterBlur && beforeBlur && afterBlur.sha256 !== beforeBlur.sha256),
    { before: beforeBlur?.sha256, after: afterBlur?.sha256 },
  );
  await shot(page, "03-annotated");

  // 6. Undo restores the state before the blur.
  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".kx-shot-tool")].find(
      (element) => element.textContent?.trim() === "Undo",
    );
    button?.click();
  });
  await sleep(600);
  const undone = await canvasHash(page);
  check(
    "undo restores the pre-blur pixels",
    Boolean(undone && beforeBlur && undone.sha256 === beforeBlur.sha256),
    { beforeBlur: beforeBlur?.sha256, undone: undone?.sha256 },
  );

  // 7. Before/after compare.
  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".kx-shot-tool")].find(
      (element) => element.textContent?.trim() === "Show original",
    );
    button?.click();
  });
  await sleep(250);
  const originalVisible = await page.evaluate(
    () => Boolean(document.querySelector(".kx-shot-original")),
  );
  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".kx-shot-tool")].find(
      (element) => element.textContent?.trim() === "Show edited",
    );
    button?.click();
  });
  await sleep(200);
  check("before/after toggles the untouched capture", originalVisible);
  await shot(page, "04-compare");

  // 8. Save creates a verified library item.
  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".knoux-modal-footer button")].find(
      (element) => /Save as new image/.test(element.textContent ?? ""),
    );
    button?.click();
  });
  await sleep(1200);
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
            const items = request.result ?? [];
            const latest = items.reduce(
              (best, item) => (!best || item.createdAt > best.createdAt ? item : best),
              null,
            );
            if (!latest) return resolve(null);
            const head = new Uint8Array(await latest.blob.slice(0, 8).arrayBuffer());
            resolve({
              name: latest.name,
              width: latest.width,
              height: latest.height,
              size: latest.blob.size,
              magic: Array.from(head)
                .map((value) => value.toString(16).padStart(2, "0"))
                .join(" "),
            });
          };
        };
      }),
  );
  const finalCanvas = await canvasHash(page);
  check(
    "the edited screenshot is saved as a real PNG library item",
    Boolean(
      stored &&
        /-edited\.png$/.test(stored.name) &&
        stored.magic.startsWith("89 50 4e 47 0d 0a 1a 0a") &&
        stored.width === finalCanvas.width &&
        stored.height === finalCanvas.height,
    ),
    { stored, canvas: finalCanvas },
  );

  // 9. Export downloads genuine PNG bytes.
  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".knoux-modal-footer button")].find(
      (element) => /Export PNG/.test(element.textContent ?? ""),
    );
    button?.click();
  });
  let download = null;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const files = (await readdir(DOWNLOADS)).filter((name) => name.endsWith(".png"));
    if (files.length) {
      download = files[0];
      break;
    }
    await sleep(300);
  }
  check("export writes a PNG file", Boolean(download), download);
  if (download) {
    const bytes = await readFile(path.join(DOWNLOADS, download));
    const isPng = bytes.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    const decoded = decodePng(bytes);
    check(
      "the exported PNG decodes at the edited dimensions",
      isPng &&
        decoded.width === finalCanvas.width &&
        decoded.height === finalCanvas.height,
      { isPng, width: decoded.width, height: decoded.height },
    );
    check(
      "the exported bytes are not empty",
      bytes.length > 200,
      bytes.length,
    );
  }

  // 10. Close the editor.
  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".knoux-modal-footer button")].find(
      (element) => element.textContent?.trim() === "Close",
    );
    button?.click();
  });
  await sleep(300);
  const closed = await page.evaluate(
    () => !document.querySelector(".knoux-modal"),
  );
  check("the editor closes back to the screenshots hub", closed);

  check("no uncaught page errors", report.pageErrors.length === 0, report.pageErrors);
  check("no console errors", report.consoleErrors.length === 0, report.consoleErrors.slice(0, 4));
} catch (error) {
  report.fatal = String(error);
  console.error("FATAL", error);
} finally {
  await browser.close();
}

const failed = report.checks.filter((entry) => !entry.pass);
report.failures = failed.length;
report.failed = Boolean(report.fatal) || failed.length > 0;
await mkdir(OUT, { recursive: true });
await import("node:fs/promises").then((fs) =>
  fs.writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2)),
);
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
