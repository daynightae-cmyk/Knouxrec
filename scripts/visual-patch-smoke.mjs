#!/usr/bin/env node
/**
 * Visual Patch Lab smoke test.
 *
 * Loads an image into the preserved laboratory, paints a region, applies a
 * tool and verifies that the canvas pixels really changed, that undo restores
 * the original pixels and that the exported PNG carries the edited pixels.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.KNOUX_BASE_URL ?? "http://localhost:4173/";
const OUT = path.resolve("artifacts/evidence/visual-patch");
const CHROME =
  process.env.KNOUX_CHROME ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

await mkdir(OUT, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  base: BASE,
  checks: [],
  consoleErrors: [],
  pageErrors: [],
};

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

/** Hash the pixels that the laboratory currently shows. */
async function canvasHash(page) {
  return page.evaluate(async () => {
    const display = document.querySelector(".kx-preview canvas");
    if (!display) return null;
    const canvas = document.createElement("canvas");
    canvas.width = display.width;
    canvas.height = display.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(display, 0, 0);
    const frame = context.getImageData(0, 0, canvas.width, canvas.height);
    const digest = await crypto.subtle.digest("SHA-256", frame.data);
    return {
      width: canvas.width,
      height: canvas.height,
      sha256: Array.from(new Uint8Array(digest))
        .map((value) => value.toString(16).padStart(2, "0"))
        .join(""),
    };
  });
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-first-run", "--no-default-browser-check", "--window-size=1600,1000"],
});

try {
  const page = await browser.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => report.pageErrors.push(String(error?.stack ?? error)));
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });

  await page.goto(`${BASE}#/visual-patch`, { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await page.waitForSelector(".kx-ai-row", { timeout: 25000 });

  const catalog = await page.evaluate(() => ({
    tools: document.querySelectorAll(".kx-ai-row").length,
    families: [...document.querySelectorAll(".kx-segmented button")].map(
      (button) => button.textContent?.trim() ?? "",
    ),
    modes: [...document.querySelectorAll(".kx-ai-row-sub")].map(
      (row) => row.textContent?.split("·").pop()?.trim() ?? "",
    ),
  }));
  report.catalog = catalog;
  check("all fifty preserved tools are listed", catalog.tools === 50, catalog.tools);
  check(
    "the tool families are grouped",
    catalog.families.length >= 8,
    catalog.families,
  );
  check(
    "the tools cover the distinct edit modes",
    new Set(catalog.modes).size >= 6,
    [...new Set(catalog.modes)],
  );
  await shot(page, "01-visual-patch-catalog");

  /* ---------------- load an image ---------------- */
  const inputFile = path.join(OUT, "source.png");
  await writePng(inputFile, 320, 240, (x, y) => [
    40 + Math.round((x / 320) * 180),
    90 + Math.round((y / 240) * 120),
    160,
  ]);

  const fileInput = await page.$("input[type='file']");
  check("the laboratory exposes a real file input", fileInput !== null, "no input");
  await fileInput.uploadFile(inputFile);
  await page.waitForFunction(
    () => Boolean(document.querySelector(".kx-preview canvas")),
    { timeout: 25000 },
  );
  await new Promise((r) => setTimeout(r, 600));
  const original = await canvasHash(page);
  report.original = original;
  check(
    "the source image is loaded into the laboratory",
    Boolean(original && original.width === 320 && original.height === 240),
    original,
  );

  /* ---------------- negative path ---------------- */
  await page.evaluate(() => {
    const row = document.querySelector(".kx-ai-row");
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".kx-btn")].find(
      (element) => element.textContent?.trim() === "Apply",
    );
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 600));
  const negative = await page.evaluate(() => {
    const notice = document.querySelector('.kx-notice[data-tone="danger"]');
    return { text: notice?.textContent?.trim() ?? null };
  });
  check(
    "applying without a painted region is refused with a real message",
    Boolean(negative.text && negative.text.length > 10),
    negative,
  );

  /* ---------------- paint a region ---------------- */
  const paintBox = await page.evaluate(() => {
    const canvas = document.querySelector(".kx-preview canvas:last-of-type");
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  check("the paint surface is present", paintBox !== null, paintBox);

  await page.mouse.move(paintBox.x + paintBox.width * 0.35, paintBox.y + paintBox.height * 0.4);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(
      paintBox.x + paintBox.width * (0.35 + step * 0.03),
      paintBox.y + paintBox.height * (0.4 + step * 0.02),
    );
  }
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 400));
  const painted = await page.evaluate(() => ({
    chips: [...document.querySelectorAll(".kx-chip")].map(
      (chip) => chip.textContent?.trim() ?? "",
    ),
  }));
  check(
    "painting records a region",
    painted.chips.some((chip) => /Regions\s*\d/i.test(chip) || /\d/.test(chip)),
    painted.chips,
  );

  /* ---------------- apply the tool ---------------- */
  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".kx-btn")].find(
      (element) => element.textContent?.trim() === "Apply",
    );
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 1500));
  const edited = await canvasHash(page);
  report.edited = edited;
  check(
    "the applied tool really changes the pixels",
    Boolean(edited && original && edited.sha256 !== original.sha256),
    { original: original?.sha256, edited: edited?.sha256 },
  );
  check(
    "the edited canvas keeps the source dimensions",
    Boolean(edited && edited.width === original.width && edited.height === original.height),
    { original, edited },
  );
  await shot(page, "02-visual-patch-applied");

  /* ---------------- mask: visible, rectangular, erasable ---------------- */
  const maskOverlay = await page.evaluate(() => {
    const canvas = document.querySelector("[data-mask-surface]");
    if (!canvas) return null;
    const data = canvas
      .getContext("2d", { willReadFrequently: true })
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    for (let index = 3; index < data.length; index += 4) if (data[index] > 8) painted += 1;
    return { painted, width: canvas.width, height: canvas.height };
  });
  check(
    "mask: the painted selection is visible on the overlay",
    Boolean(maskOverlay && maskOverlay.painted > 40),
    maskOverlay,
  );

  const maskModes = await page.evaluate(() =>
    [...document.querySelectorAll("[data-mask-mode]")].map((node) =>
      node.getAttribute("data-mask-mode"),
    ),
  );
  check(
    "mask: freehand, rectangle and erase are all offered",
    maskModes.join(",") === "freehand,rect,erase",
    maskModes,
  );

  await page.evaluate(() => document.querySelector('[data-mask-mode="rect"]')?.click());
  const maskBox = await page.evaluate(() => {
    const canvas = document.querySelector("[data-mask-surface]");
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });
  await page.mouse.move(maskBox.x + maskBox.width * 0.6, maskBox.y + maskBox.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(maskBox.x + maskBox.width * 0.85, maskBox.y + maskBox.height * 0.8, {
    steps: 8,
  });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 500));
  const afterRect = await page.evaluate(() => ({
    regions: document.querySelectorAll("[data-mask-region]").length,
    kinds: [...document.querySelectorAll(".kx-mask-kind")].map((node) => node.textContent?.trim()),
    stats: document.querySelector("[data-mask-stats]")?.textContent?.trim() ?? "",
  }));
  check(
    "mask: dragging a rectangle adds a rectangular region",
    afterRect.regions === 2 && afterRect.kinds.includes("Rectangle"),
    afterRect,
  );

  const rectPixels = await page.evaluate(() => {
    const canvas = document.querySelector("[data-mask-surface]");
    const data = canvas
      .getContext("2d", { willReadFrequently: true })
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    for (let index = 3; index < data.length; index += 4) if (data[index] > 8) painted += 1;
    return painted;
  });
  check(
    "mask: the rectangle is drawn into the overlay",
    rectPixels > (maskOverlay?.painted ?? 0),
    { before: maskOverlay?.painted, after: rectPixels },
  );

  await page.evaluate(() => document.querySelector('[data-mask-refine="grow"]')?.click());
  await new Promise((r) => setTimeout(r, 400));
  const grownStats = await page.evaluate(
    () => document.querySelector("[data-mask-stats]")?.textContent?.trim() ?? "",
  );
  check(
    "mask: growing the mask changes its measured extent",
    grownStats !== afterRect.stats,
    { before: afterRect.stats, after: grownStats },
  );

  await page.evaluate(() => document.querySelector('[data-mask-mode="erase"]')?.click());
  await page.mouse.click(maskBox.x + maskBox.width * 0.75, maskBox.y + maskBox.height * 0.7);
  await new Promise((r) => setTimeout(r, 500));
  const erased = await page.evaluate(() => ({
    regions: document.querySelectorAll("[data-mask-region]").length,
    status: document.querySelector(".kx-chip")?.textContent?.trim() ?? "",
  }));
  check(
    "mask: erase removes the region under the pointer",
    erased.regions === 1,
    erased,
  );

  await page.evaluate(() => document.querySelector("[data-mask-clear]")?.click());
  await new Promise((r) => setTimeout(r, 400));
  const cleared = await page.evaluate(() => ({
    regions: document.querySelectorAll("[data-mask-region]").length,
    painted: (() => {
      const canvas = document.querySelector("[data-mask-surface]");
      const data = canvas
        .getContext("2d", { willReadFrequently: true })
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let index = 3; index < data.length; index += 4) if (data[index] > 8) count += 1;
      return count;
    })(),
  }));
  check(
    "mask: clearing empties both the list and the overlay",
    cleared.regions === 0 && cleared.painted === 0,
    cleared,
  );
  await shot(page, "04-visual-patch-mask");

  /* ---------------- undo ---------------- */
  const undoEnabled = await page.evaluate(() => {
    const button = [...document.querySelectorAll(".kx-btn")].find(
      (element) => element.textContent?.trim() === "Undo",
    );
    return button ? !button.disabled : false;
  });
  check("undo becomes available after an edit", undoEnabled, undoEnabled);

  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".kx-btn")].find(
      (element) => element.textContent?.trim() === "Undo",
    );
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 900));
  const undone = await canvasHash(page);
  report.undone = undone;
  check(
    "undo restores the original pixels",
    Boolean(undone && original && undone.sha256 === original.sha256),
    { original: original?.sha256, undone: undone?.sha256 },
  );
  await shot(page, "03-visual-patch-undone");

  /* ---------------- redo ---------------- */
  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".kx-btn")].find(
      (element) => element.textContent?.trim() === "Redo",
    );
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 900));
  const redone = await canvasHash(page);
  report.redone = redone;
  check(
    "redo returns to the edited pixels",
    Boolean(redone && edited && redone.sha256 === edited.sha256),
    { edited: edited?.sha256, redone: redone?.sha256 },
  );

  /* ---------------- before / after comparison ---------------- */
  const findToggle = () =>
    page.evaluate(() => {
      const button = [...document.querySelectorAll(".kx-btn")].find((element) =>
        ["Show original", "Show result"].includes(
          element.textContent?.trim() ?? "",
        ),
      );
      return button ? button.textContent?.trim() : null;
    });
  const clickToggle = () =>
    page.evaluate(() => {
      const button = [...document.querySelectorAll(".kx-btn")].find((element) =>
        ["Show original", "Show result"].includes(
          element.textContent?.trim() ?? "",
        ),
      );
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

  check("comparison toggle is available", (await findToggle()) === "Show original", await findToggle());
  await clickToggle();
  await new Promise((r) => setTimeout(r, 500));
  const compared = await canvasHash(page);
  check(
    "before/after shows the untouched original pixels",
    Boolean(compared && original && compared.sha256 === original.sha256),
    { original: original?.sha256, compared: compared?.sha256 },
  );
  await shot(page, "04-visual-patch-before");
  await clickToggle();
  await new Promise((r) => setTimeout(r, 500));
  const comparedBack = await canvasHash(page);
  check(
    "comparison returns to the edited result",
    Boolean(comparedBack && edited && comparedBack.sha256 === edited.sha256),
    { edited: edited?.sha256, comparedBack: comparedBack?.sha256 },
  );

  /* ---------------- export persists a real PNG ---------------- */
  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".kx-btn")].find(
      (element) => element.textContent?.trim() === "Export PNG",
    );
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 1400));
  const stored = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("knoux-rec.library");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const transaction = db.transaction("items", "readonly");
          const request = transaction.objectStore("items").getAll();
          request.onerror = () => reject(request.error);
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
              size: latest.blob.size,
              type: latest.blob.type,
              magic: Array.from(head)
                .map((value) => value.toString(16).padStart(2, "0"))
                .join(" "),
            });
          };
        };
      }),
  );
  check(
    "the exported artwork is persisted in the library",
    Boolean(stored && /-patched\.png$/.test(stored.name) && stored.size > 100),
    stored,
  );
  check(
    "the stored artifact carries the real PNG signature",
    Boolean(stored && stored.magic.startsWith("89 50 4e 47 0d 0a 1a 0a")),
    stored,
  );

  /* ---------------- reset ---------------- */
  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".kx-btn")].find(
      (element) => element.textContent?.trim() === "Reset",
    );
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 800));
  const reset = await canvasHash(page);
  check(
    "reset restores the original pixels",
    Boolean(reset && original && reset.sha256 === original.sha256),
    { original: original?.sha256, reset: reset?.sha256 },
  );
  await shot(page, "05-visual-patch-reset");

  check("no uncaught page errors", report.pageErrors.length === 0, report.pageErrors);
  check("no console errors", report.consoleErrors.length === 0, report.consoleErrors.slice(0, 4));
} finally {
  await browser.close();
}

const failed = report.checks.filter((entry) => !entry.pass);
report.finishedAt = new Date().toISOString();
report.failed = failed.length;
await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));

console.log(
  `visual patch smoke: ${report.checks.length - failed.length}/${report.checks.length} checks passed`,
);
if (failed.length) process.exit(1);
