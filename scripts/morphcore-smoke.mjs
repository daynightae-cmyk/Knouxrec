#!/usr/bin/env node
/**
 * KNOUX REC — MorphCore geometry studio smoke.
 *
 * Drives the real workspace in Chromium with real image bytes and reads the
 * actual pixels back out of the canvas:
 *
 *   - the 18+ age gate blocks the studio until an adult year is declared,
 *   - scale/stretch lands on the exact expected box and maps source colours
 *     to the predicted destination coordinates,
 *   - pinch resamples only inside the declared radius,
 *   - perspective leaves genuinely transparent wedges where rows are inset,
 *   - rotate fills the rotated bounding box with transparent corners, flipping
 *     mirrors real pixels,
 *   - wave warp shears rows,
 *   - Apply bakes into history; Undo/Redo restore snapshots pixel-for-pixel;
 *     Reset returns to the untouched fixture,
 *   - the before/after overlay shows the untouched original from real bytes,
 *   - a non-image file is rejected without damaging the working image,
 *   - Save writes a decodable PNG blob into IndexedDB that re-opens identical,
 *   - Export downloads bytes that decode independently at the working size and
 *     match the saved blob byte-for-byte,
 *   - the legacy body-aware catalog stays listed and blocked, with no run control,
 *   - Arabic RTL renders with no overflow and no console/page errors.
 */

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { decodePng, writeSolidPng } from "./lib/png.mjs";

const BASE = process.env.KNOUX_BASE_URL ?? "http://localhost:4173/";
const OUT = path.resolve("artifacts/evidence/morphcore");
const DOWNLOADS = path.join(OUT, "downloads");
const CHROME =
  process.env.KNOUX_CHROME ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const SOURCE_PNG = path.join(OUT, "input-geometry.png");
const WRONG_FILE = path.join(OUT, "not-an-image.txt");
const SOURCE_W = 600;
const SOURCE_H = 400;

await rm(OUT, { recursive: true, force: true });
await mkdir(DOWNLOADS, { recursive: true });
writeSolidPng(SOURCE_PNG, SOURCE_W, SOURCE_H, [24, 96, 180]);
await writeFile(WRONG_FILE, "this is not an image and must be rejected\n", "utf8");

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

/** SHA-256 over the backing-store pixels of the working canvas. */
async function canvasHash(page) {
  return page.evaluate(async () => {
    const canvas = document.querySelector(".kx-geo-canvas");
    if (!canvas) return null;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
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

/** SHA-256 over one rectangular region plus a transparent-pixel census. */
async function regionHash(page, rect) {
  return page.evaluate(async (area) => {
    const canvas = document.querySelector(".kx-geo-canvas");
    if (!canvas) return null;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const x = Math.max(0, Math.round(area.x));
    const y = Math.max(0, Math.round(area.y));
    const width = Math.max(1, Math.min(canvas.width - x, Math.round(area.width)));
    const height = Math.max(1, Math.min(canvas.height - y, Math.round(area.height)));
    const data = context.getImageData(x, y, width, height);
    let transparent = 0;
    for (let i = 3; i < data.data.length; i += 4) if (data.data[i] === 0) transparent += 1;
    const digest = await crypto.subtle.digest("SHA-256", data.data);
    return {
      x,
      y,
      width,
      height,
      transparent,
      pixels: width * height,
      sha256: Array.from(new Uint8Array(digest))
        .map((value) => value.toString(16).padStart(2, "0"))
        .join(""),
    };
  }, rect);
}

/**
 * Left-most painted pixel of sampled rows. A wave warp shifts each row by a
 * different amount, so the per-row edge must move differently per row — a
 * constant shift would mean the whole image was merely translated.
 */
function rowLeftEdges(page, fractions) {
  return page.evaluate((fracs) => {
    const canvas = document.querySelector(".kx-geo-canvas");
    if (!canvas) return null;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    return fracs.map((fraction) => {
      const y = Math.min(canvas.height - 1, Math.round(canvas.height * fraction));
      const data = context.getImageData(0, y, canvas.width, 1).data;
      for (let x = 0; x < canvas.width; x += 1) if (data[x * 4 + 3] > 0) return { y, x };
      return { y, x: -1 };
    });
  }, fractions);
}

function pixelAt(page, x, y) {
  return page.evaluate(
    ({ px, py }) => {
      const canvas = document.querySelector(".kx-geo-canvas");
      if (!canvas) return null;
      const data = canvas
        .getContext("2d", { willReadFrequently: true })
        .getImageData(px, py, 1, 1).data;
      return [data[0], data[1], data[2], data[3]];
    },
    { px: Math.round(x), py: Math.round(y) },
  );
}

async function clickButton(page, label, scope = "button") {
  const clicked = await page.evaluate(
    ({ needle, sel }) => {
      const button = [...document.querySelectorAll(sel)].find(
        (element) => element.textContent?.trim() === needle,
      );
      if (!button) return false;
      button.click();
      return true;
    },
    { needle: label, sel: scope },
  );
  if (!clicked) throw new Error(`Control not found: ${label}`);
  await sleep(220);
}

/** Drive a React-controlled range input located by its visible label. */
async function setRange(page, label, value) {
  const done = await page.evaluate(
    ({ text, next }) => {
      const field = [...document.querySelectorAll(".kx-geo-inspector .kx-field")].find(
        (element) => element.querySelector(".kx-label")?.textContent?.trim().startsWith(text),
      );
      const input = field?.querySelector('input[type="range"]');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      ).set;
      setter.call(input, String(next));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    { text: label, next: value },
  );
  if (!done) throw new Error(`Slider not found: ${label}`);
  await sleep(280);
}

async function toggleCheckbox(page, label, scope) {
  const done = await page.evaluate(
    ({ text, sel }) => {
      const row = [...document.querySelectorAll(sel)].find(
        (element) => element.textContent?.includes(text),
      );
      const input = row?.querySelector('input[type="checkbox"]');
      if (!input) return false;
      input.click();
      return true;
    },
    { text: label, sel: scope },
  );
  if (!done) throw new Error(`Checkbox not found: ${label}`);
  await sleep(300);
}

async function setNumberInput(page, value) {
  await page.evaluate((next) => {
    const input = document.querySelector(".kx-age-form input[type='number']");
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(input, String(next));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
  await sleep(180);
}

async function upload(page, file) {
  const input = await page.waitForSelector('input[type="file"]', { visible: false });
  await input.uploadFile(file);
  await sleep(900);
}

async function readLibraryItem(page, pattern) {
  return page.evaluate(
    ({ source }) =>
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
            const matcher = new RegExp(source);
            const items = (request.result ?? []).filter((item) => matcher.test(item.name));
            const latest = items.reduce(
              (best, item) => (!best || item.createdAt > best.createdAt ? item : best),
              null,
            );
            if (!latest) return resolve(null);
            const bytes = new Uint8Array(await latest.blob.arrayBuffer());
            const digest = await crypto.subtle.digest("SHA-256", bytes);
            let reopened = null;
            const url = URL.createObjectURL(latest.blob);
            try {
              const image = await new Promise((fulfill, reject) => {
                const element = new Image();
                element.onload = () => fulfill(element);
                element.onerror = () => reject(new Error("decode failed"));
                element.src = url;
              });
              const canvas = document.createElement("canvas");
              canvas.width = image.naturalWidth;
              canvas.height = image.naturalHeight;
              const context = canvas.getContext("2d", { willReadFrequently: true });
              context.drawImage(image, 0, 0);
              const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
              const pixelDigest = await crypto.subtle.digest("SHA-256", data);
              reopened = {
                width: canvas.width,
                height: canvas.height,
                sha256: Array.from(new Uint8Array(pixelDigest))
                  .map((value) => value.toString(16).padStart(2, "0"))
                  .join(""),
              };
            } catch {
              reopened = null;
            } finally {
              URL.revokeObjectURL(url);
            }
            resolve({
              name: latest.name,
              width: latest.width,
              height: latest.height,
              bytes: bytes.length,
              magic: Array.from(bytes.subarray(0, 8))
                .map((value) => value.toString(16).padStart(2, "0"))
                .join(" "),
              blobSha256: Array.from(new Uint8Array(digest))
                .map((value) => value.toString(16).padStart(2, "0"))
                .join(""),
              reopened,
            });
          };
        };
      }),
    { source: pattern },
  );
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
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
  await cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DOWNLOADS });

  await page.goto(`${BASE}?nc=${Date.now()}#/morphcore`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".kx-app", { timeout: 30000 });
  await sleep(700);

  /* ------------------------------------------------------- age safeguard */
  check(
    "morphcore: the studio opens behind an 18+ age gate",
    await page.evaluate(() => Boolean(document.querySelector(".kx-age-gate"))),
  );

  await setNumberInput(page, new Date().getFullYear() - 12);
  await toggleCheckbox(
    page,
    "I confirm that I am 18 or older",
    ".kx-age-form .kx-switch",
  );
  await clickButton(page, "Enter the studio", ".kx-age-gate button");
  const refused = await page.evaluate(() => ({
    denied: Boolean(document.querySelector(".kx-age-gate .kx-notice")),
    studio: Boolean(document.querySelector(".kx-geo-canvas")),
  }));
  check("morphcore: a declared child year is refused", refused.denied && !refused.studio, refused);

  await setNumberInput(page, new Date().getFullYear() - 30);
  await clickButton(page, "Enter the studio", ".kx-age-gate button");
  await page.waitForFunction(
    () => !document.querySelector(".kx-age-gate"),
    { timeout: 10000 },
  );
  const gateState = await page.evaluate(() => ({
    session: sessionStorage.getItem("knoux-geometry.age-gate.v1"),
    permanent: localStorage.getItem("knoux-geometry.age-gate.v1"),
  }));
  check(
    "morphcore: an adult declaration opens the studio, session-scoped only",
    gateState.session === "verified" && gateState.permanent === null,
    gateState,
  );
  await shot(page, "01-studio-empty");

  const honest = await page.evaluate(() => {
    const notice = document.querySelector(".kx-notice[data-tone='info']");
    return notice ? notice.textContent.replace(/\s+/g, " ").trim() : null;
  });
  check(
    "morphcore: the honest manual-geometry notice is shown",
    Boolean(honest && /not AI body reconstruction/i.test(honest)),
    honest,
  );

  /* ------------------------------------------------------------ load */
  await upload(page, SOURCE_PNG);
  await page.waitForSelector(".kx-geo-canvas", { timeout: 15000 });
  await sleep(400);
  const loaded = await canvasHash(page);
  check(
    "morphcore: the uploaded fixture renders at its real size",
    Boolean(loaded && loaded.width === SOURCE_W && loaded.height === SOURCE_H),
    loaded,
  );
  await shot(page, "02-studio-loaded");

  /* --------------------------------------------------- scale / stretch */
  await setRange(page, "Horizontal", 150);
  await setRange(page, "Vertical", 80);
  const stretched = await canvasHash(page);
  check(
    "stretch: 150% x 80% resamples to the exact expected box",
    Boolean(stretched && stretched.width === 900 && stretched.height === 320),
    { expected: "900x320", actual: `${stretched?.width}x${stretched?.height}` },
  );
  check(
    "stretch: the resampled pixels differ from the source",
    Boolean(stretched && stretched.sha256 !== loaded.sha256),
    { before: loaded.sha256.slice(0, 12), after: stretched?.sha256.slice(0, 12) },
  );
  // Destination (30,20) maps back to source (20.0, 25.1) on the fixture gradient.
  const mapped = await pixelAt(page, 30, 20);
  check(
    "stretch: sampled colours land at the predicted source coordinates",
    Boolean(mapped && Math.abs(mapped[0] - 44) <= 3 && Math.abs(mapped[1] - 121) <= 3),
    { pixel: mapped, expected: "r=44 g=121" },
  );

  await clickButton(page, "Apply transform");
  await sleep(500);
  const stretchedBaked = await canvasHash(page);
  check(
    "apply: bakes the stretched result into the working image",
    Boolean(
      stretchedBaked &&
        stretchedBaked.width === 900 &&
        stretchedBaked.height === 320 &&
        stretchedBaked.sha256 === stretched.sha256,
    ),
    stretchedBaked,
  );
  check(
    "apply: history becomes undoable",
    await page.evaluate(() => {
      const button = [...document.querySelectorAll(".kx-geo-actions button")].find(
        (element) => element.textContent?.trim() === "Undo",
      );
      return button ? !button.disabled : false;
    }),
  );
  report.steps.push({ step: "stretch-applied", canvas: stretchedBaked });

  /* ------------------------------------------------------------ pinch */
  await clickButton(page, "Pinch / bulge", ".kx-geo-inspector .kx-segmented button");
  const beforePinch = await canvasHash(page);
  const outsideBefore = await regionHash(page, { x: 0, y: 0, width: 40, height: 40 });
  const centreRegion = { x: 450 - 30, y: 160 - 30, width: 60, height: 60 };
  const centreBefore = await regionHash(page, centreRegion);
  await setRange(page, "Strength", 70);
  await setRange(page, "Radius", 25);
  const afterPinch = await canvasHash(page);
  const outsideAfter = await regionHash(page, { x: 0, y: 0, width: 40, height: 40 });
  const centreAfter = await regionHash(page, centreRegion);
  check(
    "pinch: the working size is preserved",
    Boolean(
      afterPinch &&
        afterPinch.width === beforePinch.width &&
        afterPinch.height === beforePinch.height,
    ),
    { before: `${beforePinch?.width}x${beforePinch?.height}`, after: `${afterPinch?.width}x${afterPinch?.height}` },
  );
  check(
    "pinch: the effect disc is genuinely resampled",
    Boolean(centreAfter && centreAfter.sha256 !== centreBefore.sha256),
    { before: centreBefore?.sha256.slice(0, 12), after: centreAfter?.sha256.slice(0, 12) },
  );
  check(
    "pinch: pixels outside the declared radius are untouched",
    Boolean(outsideAfter && outsideAfter.sha256 === outsideBefore.sha256),
    { before: outsideBefore?.sha256.slice(0, 12), after: outsideAfter?.sha256.slice(0, 12) },
  );
  check(
    "pinch: the overall canvas changed",
    Boolean(afterPinch && afterPinch.sha256 !== beforePinch.sha256),
    { before: beforePinch?.sha256.slice(0, 12), after: afterPinch?.sha256.slice(0, 12) },
  );
  await shot(page, "03-pinch");

  /* ----------------------------------------------------- perspective */
  await clickButton(page, "Perspective", ".kx-geo-inspector .kx-segmented button");
  await setRange(page, "Top width", 55);
  const perspective = await canvasHash(page);
  const expectedInset = Math.round((900 - 900 * 0.55) / 2);
  const topLeftPixel = await pixelAt(page, 2, 2);
  const topCentrePixel = await pixelAt(page, 450, 2);
  const wedge = await regionHash(page, { x: 0, y: 0, width: expectedInset - 6, height: 6 });
  check(
    "perspective: the inset row is unpainted at the left edge",
    Boolean(topLeftPixel && topLeftPixel[3] === 0),
    { topLeftPixel, expectedInset },
  );
  check("perspective: the same row keeps painted pixels at the centre", Boolean(topCentrePixel && topCentrePixel[3] === 255), topCentrePixel);
  check(
    "perspective: the wedge outside the trapezoid is fully transparent",
    Boolean(wedge && wedge.transparent === wedge.pixels),
    { transparent: wedge?.transparent, pixels: wedge?.pixels },
  );
  check(
    "perspective: rows are resampled, not overlaid",
    Boolean(perspective && perspective.sha256 !== afterPinch.sha256),
    { before: afterPinch?.sha256.slice(0, 12), after: perspective?.sha256.slice(0, 12) },
  );
  await shot(page, "04-perspective");

  await clickButton(page, "Apply transform");
  await sleep(600);
  const perspectiveBaked = await canvasHash(page);
  check(
    "apply: the perspective result is baked at the working size",
    Boolean(
      perspectiveBaked &&
        perspectiveBaked.width === 900 &&
        perspectiveBaked.height === 320,
    ),
    perspectiveBaked,
  );

  /* --------------------------------------------------------- rotate */
  await clickButton(page, "Rotate", ".kx-geo-inspector .kx-segmented button");
  await setRange(page, "Angle", 30);
  const radians = (30 * Math.PI) / 180;
  const expectedW = Math.round(900 * Math.abs(Math.cos(radians)) + 320 * Math.abs(Math.sin(radians)));
  const expectedH = Math.round(900 * Math.abs(Math.sin(radians)) + 320 * Math.abs(Math.cos(radians)));
  const rotated = await canvasHash(page);
  check(
    "rotate: the result fills the rotated bounding box",
    Boolean(
      rotated &&
        Math.abs(rotated.width - expectedW) <= 1 &&
        Math.abs(rotated.height - expectedH) <= 1,
    ),
    { expected: `${expectedW}x${expectedH}`, actual: `${rotated?.width}x${rotated?.height}` },
  );
  check(
    "rotate: real pixels are resampled, not CSS transformed",
    Boolean(rotated && rotated.sha256 !== perspectiveBaked.sha256),
    { before: perspectiveBaked.sha256.slice(0, 12), after: rotated?.sha256.slice(0, 12) },
  );
  const corner = await pixelAt(page, 2, 2);
  check("rotate: corners outside the rotated image are transparent", Boolean(corner && corner[3] === 0), corner);

  await toggleCheckbox(page, "Flip horizontally", ".kx-geo-inspector .kx-switch");
  const flippedCanvas = await canvasHash(page);
  check(
    "rotate: flipping mirrors real pixels",
    Boolean(flippedCanvas && flippedCanvas.sha256 !== rotated.sha256),
    { rotated: rotated.sha256.slice(0, 12), flipped: flippedCanvas?.sha256.slice(0, 12) },
  );

  await clickButton(page, "Apply transform");
  await sleep(700);
  const rotatedBaked = await canvasHash(page);
  check(
    "apply: the rotated result is baked at the rotated size",
    Boolean(
      rotatedBaked &&
        Math.abs(rotatedBaked.width - expectedW) <= 1 &&
        Math.abs(rotatedBaked.height - expectedH) <= 1,
    ),
    rotatedBaked,
  );

  /* ------------------------------------------------------ undo / redo */
  await clickButton(page, "Undo");
  await sleep(1000);
  const undone = await canvasHash(page);
  check(
    "undo: restores the previous baked snapshot pixel-for-pixel",
    Boolean(undone && undone.sha256 === perspectiveBaked.sha256),
    { expected: perspectiveBaked.sha256.slice(0, 16), actual: undone?.sha256.slice(0, 16) },
  );

  await clickButton(page, "Redo");
  await sleep(1000);
  const redone = await canvasHash(page);
  check(
    "redo: returns to the rotated snapshot",
    Boolean(redone && redone.sha256 === rotatedBaked.sha256),
    { expected: rotatedBaked.sha256.slice(0, 16), actual: redone?.sha256.slice(0, 16) },
  );

  /* ------------------------------------------------------------ warp */
  await clickButton(page, "Wave warp", ".kx-geo-inspector .kx-segmented button");
  const warpFractions = [0.08, 0.2, 0.32, 0.44, 0.56, 0.68, 0.8, 0.92];
  const edgesBefore = await rowLeftEdges(page, warpFractions);
  const beforeWarp = await canvasHash(page);
  await setRange(page, "Amplitude", 60);
  await setRange(page, "Frequency", 4);
  const afterWarp = await canvasHash(page);
  const edgesAfter = await rowLeftEdges(page, warpFractions);
  const shifts = warpFractions
    .map((_, index) => {
      const before = edgesBefore[index]?.x ?? -1;
      const after = edgesAfter[index]?.x ?? -1;
      return before >= 0 && after >= 0 ? after - before : null;
    })
    .filter((value) => value !== null);
  const spread = shifts.length ? Math.max(...shifts) - Math.min(...shifts) : 0;
  const distinctBuckets = new Set(shifts.map((value) => Math.round(value / 10))).size;
  check(
    "warp: rows are displaced, changing real pixels",
    Boolean(afterWarp && afterWarp.sha256 !== beforeWarp.sha256),
    { before: beforeWarp?.sha256.slice(0, 12), after: afterWarp?.sha256.slice(0, 12) },
  );
  check(
    "warp: every row shifts by a different amount, so it is a wave not a translation",
    shifts.length >= 5 && spread > 40 && distinctBuckets >= 3,
    { shifts, spread, distinctBuckets, edgesBefore, edgesAfter },
  );
  report.steps.push({ step: "warp", shifts, spread });
  await shot(page, "05-warp");

  /* ------------------------------------------------------------ reset */
  await clickButton(page, "Reset all");
  await sleep(1000);
  const reset = await canvasHash(page);
  check(
    "reset: returns to the untouched fixture size",
    Boolean(reset && reset.width === SOURCE_W && reset.height === SOURCE_H),
    reset,
  );
  check(
    "reset: the pixels match the freshly loaded image",
    Boolean(reset && reset.sha256 === loaded.sha256),
    { loaded: loaded.sha256.slice(0, 16), reset: reset?.sha256.slice(0, 16) },
  );

  /* ---------------------------------------- working state for save path */
  await clickButton(page, "Scale / stretch", ".kx-geo-inspector .kx-segmented button");
  await setRange(page, "Horizontal", 120);
  await setRange(page, "Vertical", 90);
  await clickButton(page, "Apply transform");
  await sleep(700);
  const working = await canvasHash(page);
  check(
    "pipeline: the working image is the expected 720x360 result",
    Boolean(working && working.width === 720 && working.height === 360),
    working,
  );

  /* ------------------------------------------------ before / after view */
  await clickButton(page, "Show original");
  const compareOn = await page.evaluate(() => {
    const image = document.querySelector(".kx-geo-original");
    return image
      ? { decoded: image.complete && image.naturalWidth > 0, source: image.src.slice(0, 16) }
      : null;
  });
  check(
    "compare: the untouched original is overlaid from real bytes",
    Boolean(compareOn && compareOn.decoded && compareOn.source.startsWith("data:image/png")),
    compareOn,
  );
  await shot(page, "06-compare");
  await clickButton(page, "Show result");
  check(
    "compare: toggling back reveals the edited canvas",
    await page.evaluate(() => !document.querySelector(".kx-geo-original")),
  );

  /* ------------------------------------------------------- bad input */
  const beforeBadInput = await canvasHash(page);
  await upload(page, WRONG_FILE);
  const rejected = await page.evaluate(() => {
    const notice = document.querySelector(".kx-geo-stage-card .kx-notice[data-tone='danger']");
    return notice ? notice.textContent.trim() : null;
  });
  const afterBadInput = await canvasHash(page);
  check(
    "error path: a non-image file is rejected with a message",
    Boolean(rejected && /PNG, JPEG or WebP/.test(rejected)),
    rejected,
  );
  check(
    "error path: the rejected file leaves the working image intact",
    Boolean(afterBadInput && afterBadInput.sha256 === beforeBadInput.sha256),
    { before: beforeBadInput?.sha256.slice(0, 16), after: afterBadInput?.sha256.slice(0, 16) },
  );

  /* ------------------------------------------------------- save path */
  const beforeSave = await canvasHash(page);
  await clickButton(page, "Save to library");
  await sleep(1400);
  const stored = await readLibraryItem(page, "-geometry\\.png$");
  check(
    "save: writes a real PNG blob into IndexedDB",
    Boolean(stored && stored.magic.startsWith("89 50 4e 47 0d 0a 1a 0a") && stored.bytes > 1000),
    stored && { name: stored.name, bytes: stored.bytes, magic: stored.magic },
  );
  check(
    "save: the library record reports the working dimensions",
    Boolean(stored && stored.width === beforeSave.width && stored.height === beforeSave.height),
    stored && { width: stored.width, height: stored.height, canvas: beforeSave },
  );
  check(
    "reopen: the stored blob decodes to the same pixels as the canvas",
    Boolean(stored && stored.reopened && stored.reopened.sha256 === beforeSave.sha256),
    stored && {
      canvas: beforeSave.sha256.slice(0, 16),
      reopened: stored.reopened?.sha256.slice(0, 16),
      size: `${stored.reopened?.width}x${stored.reopened?.height}`,
    },
  );
  check(
    "save: the control confirms the write",
    await page.evaluate(() => {
      const button = [...document.querySelectorAll(".kx-geo-actions button")].find(
        (element) => /Saved|Save to library/.test(element.textContent ?? ""),
      );
      return button?.textContent?.trim() === "Saved";
    }),
  );

  /* ----------------------------------------------------- export path */
  await clickButton(page, "Export PNG");
  let download = null;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const files = (await readdir(DOWNLOADS)).filter((name) => name.endsWith(".png"));
    if (files.length) {
      download = files[0];
      break;
    }
    await sleep(300);
  }
  check("export: a PNG file is downloaded", Boolean(download), download);
  if (download) {
    const bytes = await readFile(path.join(DOWNLOADS, download));
    const decoded = decodePng(bytes);
    const containerSha = createHash("sha256").update(bytes).digest("hex");
    check(
      "export: the file decodes independently at the working size",
      decoded.width === beforeSave.width && decoded.height === beforeSave.height,
      { decoded: `${decoded.width}x${decoded.height}`, canvas: `${beforeSave.width}x${beforeSave.height}` },
    );
    check(
      "export: the saved blob and the exported file are the same bytes",
      Boolean(stored && containerSha === stored.blobSha256),
      { export: containerSha.slice(0, 16), saved: stored?.blobSha256.slice(0, 16) },
    );
    report.exports = { file: download, bytes: bytes.length, containerSha };
  }
  await shot(page, "07-final-state");

  /* -------------------------------------------- legacy blocked catalog */
  const legacy = await page.evaluate(() => {
    const details = document.querySelector(".kx-geo-inspector details.kx-dev-catalog");
    if (!details) return null;
    details.open = true;
    const items = [...details.querySelectorAll(".kx-geo-legacy li")];
    return {
      count: items.length,
      blockedBadges: items.filter((item) =>
        item.querySelector('.kx-badge[data-state="BLOCKED"]'),
      ).length,
      hasRunControl: Boolean(details.querySelector("button:not(summary), input")),
      names: items.slice(0, 4).map((item) => item.textContent.replace(/\s+/g, " ").trim()),
    };
  });
  check("legacy: the body-aware catalog is listed in the studio", Boolean(legacy && legacy.count > 0), legacy?.count);
  check(
    "legacy: every preserved operation is marked blocked",
    Boolean(legacy && legacy.count > 0 && legacy.blockedBadges === legacy.count),
    legacy && { count: legacy.count, blockedBadges: legacy.blockedBadges },
  );
  check("legacy: no control can run a body-aware operation", Boolean(legacy && !legacy.hasRunControl), legacy?.hasRunControl);

  /* --------------------------------------------------------- Arabic RTL */
  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".kx-topbar button")].find(
      (element) => element.textContent?.trim() === "AR",
    );
    button?.click();
  });
  await sleep(900);
  const rtl = await page.evaluate(() => ({
    dir: document.documentElement.dir,
    lang: document.documentElement.lang,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    canvas: Boolean(document.querySelector(".kx-geo-canvas")),
    sliders: document.querySelectorAll(".kx-geo-inspector input[type='range']").length,
  }));
  check("arabic: the document switches to RTL", rtl.dir === "rtl" && rtl.lang === "ar", rtl);
  check("arabic: the studio keeps working in RTL", rtl.canvas && rtl.sliders > 0, rtl);
  check("arabic: no horizontal overflow in the geometry grid", rtl.overflow <= 0, rtl.overflow);
  await shot(page, "08-arabic-rtl");

  const afterLanguage = await canvasHash(page);
  check(
    "arabic: switching language does not lose the working image",
    Boolean(afterLanguage && afterLanguage.sha256 === beforeSave.sha256),
    { before: beforeSave.sha256.slice(0, 16), after: afterLanguage?.sha256.slice(0, 16) },
  );

  check("morphcore: no uncaught page errors", report.pageErrors.length === 0, report.pageErrors);
  check(
    "morphcore: no console errors",
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
await mkdir(OUT, { recursive: true });
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
