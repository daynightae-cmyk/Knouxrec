#!/usr/bin/env node
/**
 * KNOUX REC — Elysian creative image studio smoke.
 *
 * Drives the full workspace in Chromium against real pixels:
 *
 *   - the 18+ gate must be passed before the studio exists at all,
 *   - the effect browser renders its thumbnails by running the same operations
 *     over the working image (so every card shows a unique, genuine preview),
 *   - adding a layer changes the canvas, and retuning its slider changes it
 *     again,
 *   - the Noir preset really collapses the channels to grey,
 *   - layers can be selected, reordered, removed and replayed from the history
 *     strip, and undo/redo restore pixel-identical states,
 *   - dragging on the canvas produces a crop at the expected size,
 *   - text and watermark layers rasterise onto the image,
 *   - the tone-curve workbench edits a real transfer function: measured
 *     histogram, draggable and typeable control points, per-channel curves,
 *     auto levels built from the measured range, a straight line that is a
 *     byte-identical no-op, and keyboard nudging,
 *   - split compare shows the untouched original next to the encoded result,
 *   - the output dock measures real encoded bytes; Save writes a decodable
 *     IndexedDB blob that re-opens identical, and Export downloads bytes that
 *     decode at the expected size for both PNG and half-scale JPEG,
 *   - neural services stay listed as blocked with no preview and no control,
 *   - Arabic RTL renders without overflow and without console errors.
 */

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { decodePng, writeSolidPng } from "./lib/png.mjs";

const BASE = process.env.KNOUX_BASE_URL ?? "http://localhost:4173/";
const OUT = path.resolve("artifacts/evidence/elysian-studio");
const DOWNLOADS = path.join(OUT, "downloads");
const CHROME =
  process.env.KNOUX_CHROME ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const SOURCE_PNG = path.join(OUT, "input-elysian.png");
const WRONG_FILE = path.join(OUT, "notes.txt");
const SOURCE_W = 800;
const SOURCE_H = 600;

await rm(OUT, { recursive: true, force: true });
await mkdir(DOWNLOADS, { recursive: true });
writeSolidPng(SOURCE_PNG, SOURCE_W, SOURCE_H, [40, 120, 200]);
await writeFile(WRONG_FILE, "definitely not an image\n", "utf8");

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

async function canvasHash(page) {
  return page.evaluate(async () => {
    const canvas = document.querySelector(".elys-canvas");
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

/** Channel statistics over the painted area — used to prove a grey render. */
function channelStats(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector(".elys-canvas");
    if (!canvas) return null;
    const data = canvas
      .getContext("2d", { willReadFrequently: true })
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let maxChannelDelta = 0;
    let painted = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      painted += 1;
      maxChannelDelta = Math.max(
        maxChannelDelta,
        Math.abs(data[i] - data[i + 1]),
        Math.abs(data[i + 1] - data[i + 2]),
      );
    }
    return { maxChannelDelta, painted };
  });
}

function layerCount(page) {
  return page.evaluate(
    () => document.querySelectorAll(".elys-layers .elys-layer").length,
  );
}

async function clickByAttribute(page, selector, attribute, value) {
  const clicked = await page.evaluate(
    ({ sel, attr, needle }) => {
      const element = document.querySelector(`${sel}[${attr}="${needle}"]`);
      if (!element) return false;
      element.click();
      return true;
    },
    { sel: selector, attr: attribute, needle: value },
  );
  if (!clicked) throw new Error(`Not found: ${selector}[${attribute}=${value}]`);
  await sleep(260);
}

async function clickText(page, label, scope = "button") {
  const clicked = await page.evaluate(
    ({ needle, sel }) => {
      const element = [...document.querySelectorAll(sel)].find(
        (node) => node.textContent?.trim() === needle,
      );
      if (!element) return false;
      element.click();
      return true;
    },
    { needle: label, sel: scope },
  );
  if (!clicked) throw new Error(`Control not found: ${label}`);
  await sleep(260);
}

async function setSlider(page, sliderKey, value) {
  const done = await page.evaluate(
    ({ key, next }) => {
      const input = document.querySelector(`.elys-inspector input[data-slider="${key}"]`);
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      ).set;
      setter.call(input, String(next));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    { key: sliderKey, next: value },
  );
  if (!done) throw new Error(`Slider not found: ${sliderKey}`);
  await sleep(320);
}

async function upload(page, file) {
  const input = await page.waitForSelector('input[type="file"]', { visible: false });
  await input.uploadFile(file);
  await sleep(1400);
}

/* ---------------------------------------------------- curve helpers */

/** Geometry of the curve plot, in client pixels, for synthetic pointer input. */
async function curveBox(page) {
  return page.evaluate(() => {
    const svg = document.querySelector(".elys-curves-svg");
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });
}

const levelToClient = (box, input, output) => ({
  x: box.x + (input / 256) * box.width,
  y: box.y + (1 - output / 256) * box.height,
});

/**
 * Synthetic drags need a settled layout: scrollIntoView can still be animating
 * when the box is read, and a stale rectangle drops the pointer events on the
 * panel instead of the handle. Poll until two consecutive reads agree.
 */
async function settledCurveBox(page, attempts = 14) {
  let previous = await curveBox(page);
  for (let index = 0; index < attempts; index += 1) {
    await sleep(120);
    const current = await curveBox(page);
    if (current && previous && Math.abs(current.y - previous.y) < 0.5 && Math.abs(current.x - previous.x) < 0.5) {
      return current;
    }
    previous = current;
  }
  return previous;
}

/** What actually sits under a client point — the grab must land on a handle. */
async function targetAt(page, point) {
  return page.evaluate(
    ({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      if (!element) return null;
      return `${element.tagName}.${element.getAttribute("class") ?? ""}`;
    },
    { x: point.x, y: point.y },
  );
}

/** Everything the workbench exposes: handles, knot table, stats and plot. */
async function curveState(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll(".elys-curves-points li")].map((row) => {
      const inputs = row.querySelectorAll("input");
      return { input: Number(inputs[0]?.value), output: Number(inputs[1]?.value) };
    });
    const path = document.querySelector(".elys-curves-line")?.getAttribute("d") ?? "";
    const table = [...path.matchAll(/[ML]\s*(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)/g)].map((match) => ({
      x: Number(match[1]),
      y: Number(match[2]),
    }));
    let reversals = 0;
    for (let index = 1; index < table.length; index += 1) {
      // y grows downward in SVG space: an output that falls as input rises is
      // a tone reversal, which the pipeline refuses to produce.
      if (table[index].y > table[index - 1].y + 0.01) reversals += 1;
    }
    return {
      handles: document.querySelectorAll(".elys-curves-handle").length,
      rows,
      stats: [...document.querySelectorAll(".elys-curves-stats dd")].map((node) =>
        node.textContent?.trim() ?? "",
      ),
      readout: document.querySelector("[data-curve-readout]")?.textContent?.trim() ?? "",
      stroke: document.querySelector(".elys-curves-line")?.getAttribute("stroke") ?? "",
      histogram: (document.querySelector(".elys-curves-hist")?.getAttribute("d") ?? "").length,
      channel:
        document.querySelector(".elys-curves-head .kx-segmented button[aria-pressed='true']")
          ?.getAttribute("data-curve-channel") ?? null,
      reversals,
      rawKeys: document.querySelector("[data-curves-workbench]")?.textContent?.includes("elysian.") ?? true,
    };
  });
}

async function setCurvePoint(page, row, field, value) {
  const done = await page.evaluate(
    ({ index, which, next }) => {
      const input = document.querySelectorAll(
        `.elys-curves-points li[data-curve-row="${index}"] input`,
      )[which];
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, String(next));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    { index: row, which: field, next: value },
  );
  if (!done) throw new Error(`Curve point row not found: ${row}`);
  await sleep(340);
}

async function curveAction(page, action) {
  const done = await page.evaluate((needle) => {
    const button = document.querySelector(`[data-curve-action="${needle}"]`);
    if (!button) return false;
    button.click();
    return true;
  }, action);
  if (!done) throw new Error(`Curve action not found: ${action}`);
  await sleep(340);
}

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
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
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

async function waitForDownload(folder, extension, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
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
    "--window-size=1680,1050",
    "--no-first-run",
  ],
  defaultViewport: { width: 1680, height: 1050 },
});

try {
  const page = await browser.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => report.pageErrors.push(String(error)));

  const cdp = await page.createCDPSession();
  await cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DOWNLOADS });

  await page.goto(`${BASE}?nc=${Date.now()}#/elysian`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".kx-app", { timeout: 30000 });
  await sleep(900);

  /* --------------------------------------------------------- age gate */
  await page.waitForSelector(".adult-gate-container", { timeout: 15000 });
  check("elysian: the studio is closed behind the age gate", true);

  await page.evaluate(() => {
    const year = document.querySelector("#birthYear");
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(year, String(new Date().getFullYear() - 28));
    year.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelectorAll(".checkbox-group input[type=checkbox]").forEach((box) => {
      if (!box.checked) box.click();
    });
  });
  await sleep(200);
  await page.evaluate(() => document.querySelector(".verification-button")?.click());
  await page.waitForSelector(".elys-hero", { timeout: 15000 });
  check("elysian: an adult declaration opens the workspace", true);
  await shot(page, "01-empty");

  /* ------------------------------------------------------------ load */
  await upload(page, SOURCE_PNG);
  await page.waitForSelector(".elys-canvas", { timeout: 20000 });
  await sleep(1200);
  const loaded = await canvasHash(page);
  check(
    "elysian: the uploaded image is painted at its working size",
    Boolean(loaded && loaded.width === SOURCE_W && loaded.height === SOURCE_H),
    loaded,
  );

  /* ------------------------------------------------- effect browser */
  const browserState = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".elys-card")];
    return {
      cards: cards.length,
      thumbs: cards
        .map((card) => card.querySelector(".elys-card-thumb img")?.getAttribute("src") ?? "")
        .filter((src) => src.startsWith("data:image/png")),
      blocked: [...document.querySelectorAll(".elys-blocked li")].length,
    };
  });
  const uniqueThumbs = new Set(browserState.thumbs).size;
  check(
    "browser: every card in the default category renders a thumbnail",
    browserState.thumbs.length > 0 && browserState.thumbs.length === browserState.cards,
    { cards: browserState.cards, thumbs: browserState.thumbs.length },
  );
  check(
    "browser: thumbnails are per-effect renders, not one shared placeholder",
    uniqueThumbs === browserState.thumbs.length && uniqueThumbs > 1,
    { unique: uniqueThumbs, total: browserState.thumbs.length },
  );
  check(
    "browser: neural services are listed as blocked",
    browserState.blocked === 6,
    browserState.blocked,
  );
  const blockedHasPreview = await page.evaluate(
    () => Boolean(document.querySelector(".elys-blocked img, .elys-blocked canvas")),
  );
  check("browser: blocked services show no simulated preview", !blockedHasPreview);
  await shot(page, "02-browser");

  /* ------------------------------------------------------ add a layer */
  await clickText(page, "Detail", ".elys-categories button");
  await sleep(400);
  const basePixels = await canvasHash(page);
  await clickByAttribute(page, ".elys-card", "data-effect-id", "blur");
  await page.waitForFunction(
    () => document.querySelectorAll(".elys-layers .elys-layer").length === 1,
    { timeout: 10000 },
  );
  await sleep(600);
  const blurred = await canvasHash(page);
  check("layers: adding an effect registers a layer", (await layerCount(page)) === 1);
  check(
    "layers: the blur layer changes real pixels",
    Boolean(blurred && blurred.sha256 !== basePixels.sha256),
    { before: basePixels.sha256.slice(0, 12), after: blurred.sha256.slice(0, 12) },
  );
  check(
    "layers: the canvas keeps its size for a non-geometric effect",
    Boolean(blurred && blurred.width === basePixels.width && blurred.height === basePixels.height),
    blurred,
  );

  await setSlider(page, "elysian.field.radius", 22);
  const retuned = await canvasHash(page);
  check(
    "inspector: retuning the slider re-renders the pipeline",
    Boolean(retuned && retuned.sha256 !== blurred.sha256),
    { radius6: blurred.sha256.slice(0, 12), radius22: retuned.sha256.slice(0, 12) },
  );

  /* ---------------------------------------------------------- preset */
  await clickByAttribute(page, ".elys-card", "data-preset-id", "noir");
  await sleep(900);
  const noirCount = await layerCount(page);
  check("presets: Noir appends its full operation list", noirCount === 6, noirCount);
  const grey = await channelStats(page);
  check(
    "presets: Noir really desaturates the result to grey",
    Boolean(grey && grey.painted > 0 && grey.maxChannelDelta <= 2),
    grey,
  );
  await shot(page, "03-preset");

  /* --------------------------------------------------------- history */
  const history = await page.evaluate(
    () => document.querySelectorAll(".elys-history-step").length,
  );
  check("history: one real preview per applied step", history === noirCount, {
    history,
    noirCount,
  });
  await clickByAttribute(page, ".elys-history-step", "data-history-step", "0");
  await sleep(700);
  const truncated = await layerCount(page);
  check("history: clicking a step replays the stack up to it", truncated === 1, truncated);
  const stepped = await canvasHash(page);
  check(
    "history: the replayed step matches the blur-only render",
    Boolean(stepped && stepped.sha256 === retuned.sha256),
    { expected: retuned.sha256.slice(0, 16), actual: stepped?.sha256.slice(0, 16) },
  );

  /* ------------------------------------------------------ undo / redo */
  await clickText(page, "Light", ".elys-categories button");
  await sleep(300);
  await clickByAttribute(page, ".elys-card", "data-effect-id", "exposure");
  await sleep(700);
  const withExposure = await canvasHash(page);
  check("layers: a second effect stacks on top of the first", (await layerCount(page)) === 2, await layerCount(page));
  await clickText(page, "Undo", ".elys-actions button");
  await sleep(800);
  const undone = await canvasHash(page);
  check(
    "undo: restores the previous stack pixel-for-pixel",
    Boolean(undone && undone.sha256 === stepped.sha256),
    { expected: stepped.sha256.slice(0, 16), actual: undone?.sha256.slice(0, 16) },
  );
  await clickText(page, "Redo", ".elys-actions button");
  await sleep(800);
  const redone = await canvasHash(page);
  check(
    "redo: returns to the stacked state",
    Boolean(redone && redone.sha256 === withExposure.sha256),
    { expected: withExposure.sha256.slice(0, 16), actual: redone?.sha256.slice(0, 16) },
  );

  /* ------------------------------------------------------ layer order */
  await clickByAttribute(page, ".elys-layer", "data-layer-index", "1");
  await sleep(300);
  const selectedName = await page.evaluate(
    () =>
      document.querySelector('.elys-layer[aria-pressed="true"] .elys-layer-name')
        ?.textContent ?? null,
  );
  check("inspector: selecting a layer names it", selectedName === "Exposure", selectedName);
  await clickText(page, "Move earlier", ".elys-inspector button");
  await sleep(600);
  const reordered = await page.evaluate(
    () => [...document.querySelectorAll(".elys-layer-name")].map((node) => node.textContent),
  );
  check(
    "inspector: layers can be reordered",
    reordered[0] === "Exposure" && reordered[1] === "Blur",
    reordered,
  );
  const reorderedPixels = await canvasHash(page);
  check(
    "inspector: reordering changes the render",
    Boolean(reorderedPixels && reorderedPixels.sha256 !== withExposure.sha256),
    { before: withExposure.sha256.slice(0, 12), after: reorderedPixels.sha256.slice(0, 12) },
  );

  /* ------------------------------------------------------------ crop */
  const stageBox = await page.evaluate(() => {
    const rect = document.querySelector(".elys-canvas").getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });
  await page.mouse.move(stageBox.x + stageBox.width * 0.2, stageBox.y + stageBox.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(stageBox.x + stageBox.width * 0.7, stageBox.y + stageBox.height * 0.75, {
    steps: 10,
  });
  const selectionVisible = await page.evaluate(() => ({
    rect: Boolean(document.querySelector(".elys-crop-rect")),
    width: document.querySelector(".elys-canvas")?.getBoundingClientRect().width ?? 0,
  }));
  await page.mouse.up();
  await sleep(400);
  check(
    "crop: the drag shows a selection aligned with the canvas",
    selectionVisible.rect,
    selectionVisible,
  );
  await clickText(page, "Crop to selection", ".elys-actions button");
  await sleep(1000);
  const cropped = await canvasHash(page);
  const expectedCropWidth = Math.round(SOURCE_W * 0.5);
  check(
    "crop: dragging on the canvas crops to the selected rectangle",
    Boolean(cropped && Math.abs(cropped.width - expectedCropWidth) <= 8),
    { expected: expectedCropWidth, actual: cropped?.width },
  );

  /* ---------------------------------------------------------- rotate */
  await clickText(page, "Geometry", ".elys-categories button");
  await sleep(300);
  await clickByAttribute(page, ".elys-card", "data-effect-id", "rotate");
  await sleep(900);
  const rotated = await canvasHash(page);
  check(
    "geometry: the Rotate layer swaps the working dimensions",
    Boolean(rotated && rotated.width === cropped.height && rotated.height === cropped.width),
    { before: `${cropped.width}x${cropped.height}`, after: `${rotated?.width}x${rotated?.height}` },
  );
  await clickByAttribute(page, ".elys-card", "data-effect-id", "flip-h");
  await sleep(900);
  const flipped = await canvasHash(page);
  check(
    "geometry: the flip layer mirrors real pixels",
    Boolean(flipped && flipped.sha256 !== rotated.sha256),
    { rotated: rotated.sha256.slice(0, 12), flipped: flipped?.sha256.slice(0, 12) },
  );

  /* ------------------------------------------------------------ text */
  await clickText(page, "Marks", ".elys-categories button");
  await sleep(300);
  await clickByAttribute(page, ".elys-card", "data-effect-id", "text");
  await sleep(1200);
  const withText = await canvasHash(page);
  check(
    "marks: the text layer rasterises onto the image",
    Boolean(withText && withText.sha256 !== flipped.sha256),
    { before: flipped.sha256.slice(0, 12), after: withText?.sha256.slice(0, 12) },
  );
  const textBefore = await page.evaluate(
    () => document.querySelector('.elys-inspector input[data-slider="elysian.field.size"]')?.value,
  );
  await setSlider(page, "elysian.field.size", 200);
  const textResized = await canvasHash(page);
  check(
    "marks: text size is a live parameter",
    Boolean(textBefore && textResized && textResized.sha256 !== withText.sha256),
    { size: textBefore },
  );
  await clickByAttribute(page, ".elys-card", "data-effect-id", "watermark");
  await sleep(1400);
  const withWatermark = await canvasHash(page);
  check(
    "marks: the watermark tiles across the image",
    Boolean(withWatermark && withWatermark.sha256 !== textResized.sha256),
    { before: textResized.sha256.slice(0, 12), after: withWatermark?.sha256.slice(0, 12) },
  );
  await shot(page, "04-layers");

  /* --------------------------------------------------------- compare */
  await clickText(page, "Split compare", ".elys-stage-bar button");
  await page.waitForSelector(".elys-compare", { timeout: 10000 });
  await sleep(600);
  const compare = await page.evaluate(() => {
    const images = [...document.querySelectorAll(".elys-compare img")];
    return {
      count: images.length,
      decoded: images.every((image) => image.complete && image.naturalWidth > 0),
      distinct: images.length === 2 && images[0].src !== images[1].src,
      handle: Boolean(document.querySelector(".elys-compare [role='slider']")),
    };
  });
  check("compare: both sides decode real image data", compare.decoded && compare.count === 2, compare);
  check("compare: the original differs from the rendered result", compare.distinct);
  check("compare: the slider handle is present", compare.handle);
  await shot(page, "05-compare");
  await clickText(page, "Split compare", ".elys-stage-bar button");
  await sleep(400);

  const peekVisible = await page.evaluate(async () => {
    const button = [...document.querySelectorAll(".elys-stage-bar button")].find(
      (node) => node.textContent?.trim() === "Hold to see original",
    );
    if (!button) return { shown: false };
    const down = new Event("pointerdown", { bubbles: true });
    button.dispatchEvent(down);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const shown = Boolean(document.querySelector(".elys-peek"));
    button.dispatchEvent(new Event("pointerup", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 250));
    return { shown, hidden: !document.querySelector(".elys-peek") };
  });
  check("compare: holding reveals the untouched original", peekVisible.shown === true, peekVisible);

  /* ------------------------------------------------------ bad input */
  await upload(page, WRONG_FILE);
  const rejected = await page.evaluate(() => {
    const notice = document.querySelector(".elys-stage-card .kx-notice[data-tone='danger']");
    return notice ? notice.textContent.trim() : null;
  });
  const afterBadUpload = await canvasHash(page);
  check("error path: a non-image is rejected with a message", Boolean(rejected), rejected);
  check(
    "error path: the working image survives a rejected file",
    Boolean(afterBadUpload && afterBadUpload.sha256 === withWatermark.sha256),
    { before: withWatermark.sha256.slice(0, 12), after: afterBadUpload?.sha256.slice(0, 12) },
  );

  /* ------------------------------------------------------ output dock */
  const estimatePng = await page.evaluate(
    () => document.querySelector(".elys-inspector .kx-card-sub[dir='ltr']")?.textContent ?? "",
  );
  check("output: the dock measures real encoded bytes", /KB|MB|B/.test(estimatePng), estimatePng);

  const beforeSave = await canvasHash(page);
  await clickText(page, "Save to library", ".elys-dock button");
  await sleep(1800);
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
            const items = (request.result ?? []).filter((item) =>
              /-elysian\.png$/.test(item.name),
            );
            const latest = items.reduce(
              (best, item) => (!best || item.createdAt > best.createdAt ? item : best),
              null,
            );
            if (!latest) return resolve(null);
            const bytes = new Uint8Array(await latest.blob.arrayBuffer());
            const url = URL.createObjectURL(latest.blob);
            let reopened = null;
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
              const digest = await crypto.subtle.digest("SHA-256", data);
              reopened = {
                width: canvas.width,
                height: canvas.height,
                sha256: Array.from(new Uint8Array(digest))
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
              reopened,
            });
          };
        };
      }),
  );
  check(
    "save: the library holds a real PNG blob at the working size",
    Boolean(
      stored &&
        stored.magic.startsWith("89 50 4e 47 0d 0a 1a 0a") &&
        stored.bytes > 2000 &&
        stored.width === beforeSave.width &&
        stored.height === beforeSave.height,
    ),
    stored,
  );
  check(
    "reopen: the stored blob decodes to the same pixels as the canvas",
    Boolean(stored && stored.reopened?.sha256 === beforeSave.sha256),
    stored && {
      canvas: beforeSave.sha256.slice(0, 16),
      reopened: stored.reopened?.sha256.slice(0, 16),
    },
  );

  await clickText(page, "Export", ".elys-dock button");
  const pngDownload = await waitForDownload(DOWNLOADS, ".png");
  check("export: a PNG file is written", Boolean(pngDownload), pngDownload);
  if (pngDownload) {
    const bytes = await readFile(pngDownload);
    const decoded = decodePng(bytes);
    check(
      "export: the PNG decodes independently at the working size",
      decoded.width === beforeSave.width && decoded.height === beforeSave.height,
      { decoded: `${decoded.width}x${decoded.height}`, canvas: `${beforeSave.width}x${beforeSave.height}` },
    );
  }

  /* ------------------------------------------- lossy + scaled export */
  await rm(DOWNLOADS, { recursive: true, force: true });
  await mkdir(DOWNLOADS, { recursive: true });
  await clickText(page, "JPEG", ".elys-inspector .kx-segmented button");
  await sleep(700);
  await setSlider(page, "elysian.scale", 50);
  await sleep(900);
  const estimateJpeg = await page.evaluate(
    () => document.querySelector(".elys-inspector .kx-card-sub[dir='ltr']")?.textContent ?? "",
  );
  check(
    "output: switching to half-scale JPEG changes the measured size",
    estimateJpeg !== estimatePng && /KB|MB|B/.test(estimateJpeg),
    { png: estimatePng, jpeg: estimateJpeg },
  );
  await clickText(page, "Export", ".elys-dock button");
  const jpgDownload = await waitForDownload(DOWNLOADS, ".jpg");
  check("export: a JPEG file is written", Boolean(jpgDownload), jpgDownload);
  if (jpgDownload) {
    const bytes = await readFile(jpgDownload);
    const dimensions = jpegDimensions(bytes);
    check(
      "export: the JPEG magic and header are genuine",
      bytes[0] === 0xff && bytes[1] === 0xd8 && Boolean(dimensions),
      { magic: bytes.subarray(0, 2).toString("hex"), dimensions },
    );
    check(
      "export: the scale control really resamples the output",
      Boolean(
        dimensions &&
          Math.abs(dimensions.width - Math.round(beforeSave.width / 2)) <= 2 &&
          Math.abs(dimensions.height - Math.round(beforeSave.height / 2)) <= 2,
      ),
      { dimensions, full: `${beforeSave.width}x${beforeSave.height}` },
    );
  }

  /* ----------------------------------------------------- clear stack */
  await clickText(page, "Clear layers", ".elys-actions button");
  await sleep(900);
  const cleared = await canvasHash(page);
  check(
    "reset: clearing the stack returns to the untouched source size",
    Boolean(cleared && cleared.width === SOURCE_W && cleared.height === SOURCE_H),
    cleared,
  );
  check(
    "reset: the source pixels are restored exactly",
    Boolean(cleared && cleared.sha256 === loaded.sha256),
    { source: loaded.sha256.slice(0, 16), cleared: cleared?.sha256.slice(0, 16) },
  );

  /* ----------------------------------------------------- tone curves */
  await clickText(page, "Light", ".elys-categories button");
  await sleep(300);
  await clickByAttribute(page, ".elys-card", "data-effect-id", "curves");
  await page.waitForSelector("[data-curves-workbench]", { timeout: 10000 });
  await sleep(900);
  const curved = await canvasHash(page);
  check(
    "curves: the curve layer renders through the shared pipeline",
    Boolean(curved && curved.sha256 !== loaded.sha256),
    { source: loaded.sha256.slice(0, 12), curve: curved?.sha256.slice(0, 12) },
  );

  const opened = await curveState(page);
  check(
    "curves: the workbench exposes a draggable handle per control point",
    opened.handles === 5 && opened.rows.length === 5,
    { handles: opened.handles, rows: opened.rows.length },
  );
  check(
    "curves: the plot is backed by a measured histogram",
    opened.histogram > 500 && /^\d+$/.test(opened.stats[0]),
    { histogramPoints: opened.histogram, stats: opened.stats },
  );
  check("curves: the rendered transfer table never reverses tone", opened.reversals === 0, opened.reversals);
  check("curves: no translation key leaks into the workbench", opened.rawKeys === false, opened.rawKeys);

  await page.evaluate(() => {
    document.querySelector(".elys-curves-svg")?.scrollIntoView({ block: "center", inline: "center" });
  });
  const box = await settledCurveBox(page);
  if (!box || box.y < 0 || box.y + box.height > 1050) {
    throw new Error(`The curve plot is not inside the viewport: ${JSON.stringify(box)}`);
  }
  const beforeDrag = await canvasHash(page);
  const grabPoint = levelToClient(box, 64, 52);
  const dropPoint = levelToClient(box, 64, 112);
  const grabTarget = await targetAt(page, grabPoint);
  check(
    "curves: the grab point lands on the shadow mid-tone handle",
    /elys-curves-handle/.test(grabTarget ?? ""),
    { grabTarget, grabPoint },
  );
  await page.mouse.move(grabPoint.x, grabPoint.y);
  await page.mouse.down();
  await page.mouse.move(dropPoint.x, dropPoint.y, { steps: 8 });
  await page.mouse.up();
  await sleep(800);
  const dragged = await canvasHash(page);
  const afterDrag = await curveState(page);
  check(
    "curves: dragging a handle rewrites the control point",
    Boolean(dragged && dragged.sha256 !== beforeDrag.sha256) && afterDrag.rows[1]?.input === 64,
    { row: afterDrag.rows[1], before: beforeDrag?.sha256.slice(0, 12), after: dragged?.sha256.slice(0, 12) },
  );
  check(
    "curves: the dragged mid-tone lands where the pointer released",
    Math.abs((afterDrag.rows[1]?.output ?? 0) - 112) <= 4,
    { row: afterDrag.rows[1], wanted: 112 },
  );

  await page.evaluate(() => document.querySelector('[data-curve-channel="r"]')?.click());
  await sleep(900);
  const redState = await curveState(page);
  const redPixels = await canvasHash(page);
  check(
    "curves: the channel control scopes the curve to one channel",
    redState.channel === "r" &&
      redState.stroke === "#ff6b61" &&
      Boolean(redPixels && redPixels.sha256 !== dragged.sha256),
    { channel: redState.channel, stroke: redState.stroke },
  );

  await curveAction(page, "add");
  const withExtra = await curveState(page);
  check(
    "curves: add point inserts a knot into the table",
    withExtra.handles === 6 && withExtra.rows.length === 6,
    { handles: withExtra.handles, rows: withExtra.rows.length },
  );

  const anchorGuard = await page.evaluate(() => {
    const first = document.querySelector('[data-curve-row="0"] .elys-curves-remove');
    const last = document.querySelector(
      `[data-curve-row="${document.querySelectorAll(".elys-curves-points li").length - 1}"] .elys-curves-remove`,
    );
    return { first: first ? first.disabled : null, last: last ? last.disabled : null };
  });
  check(
    "curves: the shadow and highlight anchors cannot be deleted",
    anchorGuard.first === true && anchorGuard.last === true,
    anchorGuard,
  );

  await page.evaluate(() => document.querySelector('[data-curve-row="2"] .elys-curves-remove')?.click());
  await sleep(600);
  const afterRemove = await curveState(page);
  check("curves: a control point can be removed", afterRemove.rows.length === 5, afterRemove.rows.length);

  const beforeType = await canvasHash(page);
  await setCurvePoint(page, 1, 1, 90);
  const typedState = await curveState(page);
  const typedPixels = await canvasHash(page);
  check(
    "curves: a typed level reaches the pipeline",
    typedState.rows[1]?.output === 90 &&
      Boolean(typedPixels && typedPixels.sha256 !== beforeType.sha256),
    { row: typedState.rows[1] },
  );
  check(
    "curves: the readout reports the real transfer value, not the handle",
    new RegExp(`^${typedState.rows[1]?.input} → 90`).test(typedState.readout),
    { readout: typedState.readout, row: typedState.rows[1] },
  );

  await curveAction(page, "auto");
  await sleep(700);
  const autoState = await curveState(page);
  const autoPixels = await canvasHash(page);
  check(
    "curves: auto levels rebuilds the table from the measured range",
    autoState.rows.length === 3 &&
      autoState.rows[0]?.output === 0 &&
      autoState.rows[2]?.output === 255 &&
      Boolean(autoPixels && autoPixels.sha256 !== typedPixels.sha256),
    { rows: autoState.rows },
  );

  await page.evaluate(() => document.querySelector('[data-curve-shape="linear"]')?.click());
  await sleep(800);
  const straight = await canvasHash(page);
  check(
    "curves: a straight line is a true no-op against the source pixels",
    Boolean(straight && straight.sha256 === loaded.sha256),
    { source: loaded.sha256.slice(0, 16), straight: straight?.sha256.slice(0, 16) },
  );

  await page.evaluate(() => document.querySelector('[data-curve-shape="contrast"]')?.click());
  await sleep(700);
  const beforeKeys = await canvasHash(page);
  // SVGElement.focus() has to be called in the page: Puppeteer's focus helper
  // only accepts HTML elements.
  const focused = await page.evaluate(() => {
    const handle = document.querySelector('.elys-curves-handle[data-curve-point="1"]');
    if (!handle) return false;
    handle.focus();
    return document.activeElement === handle;
  });
  check("curves: a control point handle takes keyboard focus", focused === true, focused);
  for (let index = 0; index < 10; index += 1) await page.keyboard.press("ArrowUp");
  await sleep(800);
  const keyed = await canvasHash(page);
  const keyedState = await curveState(page);
  check(
    "curves: arrow keys nudge the focused handle",
    Boolean(keyed && keyed.sha256 !== beforeKeys.sha256) && keyedState.rows[1]?.output >= 58,
    { row: keyedState.rows[1] },
  );
  await shot(page, "07-tone-curves");

  /* --------------------------------------------------------- Arabic */
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
    cards: document.querySelectorAll(".elys-card").length,
    canvas: Boolean(document.querySelector(".elys-canvas")),
    curves: Boolean(document.querySelector("[data-curves-workbench]")),
    plotLtr: document.querySelector(".elys-curves-plot")?.getAttribute("dir") ?? null,
    rawKeys: document.querySelector("[data-curves-workbench]")?.textContent?.includes("elysian.") ?? true,
  }));
  check("arabic: the studio renders in RTL", rtl.dir === "rtl" && rtl.lang === "ar", rtl);
  check(
    "arabic: the browser, canvas and curve table survive the switch",
    rtl.cards > 0 && rtl.canvas && rtl.curves,
    rtl,
  );
  check(
    "arabic: the curve plot stays left-to-right and fully translated",
    rtl.plotLtr === "ltr" && rtl.rawKeys === false,
    rtl,
  );
  check("arabic: no horizontal overflow in the three-column grid", rtl.overflow <= 0, rtl.overflow);
  await shot(page, "08-arabic-rtl");

  check("elysian: no uncaught page errors", report.pageErrors.length === 0, report.pageErrors);
  check(
    "elysian: no console errors",
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
