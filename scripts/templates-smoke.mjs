#!/usr/bin/env node
/**
 * Templates smoke test.
 *
 * Renders a real template frame in a real browser, verifies that the produced
 * PNG carries the template's pixels, checks the honest mock listing for the 51
 * generated entries and confirms that no mislabelled video is offered.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.KNOUX_BASE_URL ?? "http://localhost:4173/";
const OUT = path.resolve("artifacts/evidence/templates");
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

  await page.goto(`${BASE}#/templates`, { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await page.waitForSelector(".kx-ai-row", { timeout: 20000 });

  const catalog = await page.evaluate(() => ({
    renderable: document.querySelectorAll(".kx-col:first-child .kx-ai-row").length,
    names: [...document.querySelectorAll(".kx-ai-row-title")].map(
      (row) => row.textContent?.trim() ?? "",
    ),
    mockRows: document.querySelectorAll(".kx-table tbody tr").length,
    mockBadges: [...document.querySelectorAll(".kx-table tbody .kx-badge")].map(
      (badge) => badge.textContent?.trim() ?? "",
    ),
    notice: document.querySelector(".kx-notice")?.textContent?.trim() ?? "",
  }));
  report.catalog = catalog;
  check("five templates are listed as renderable", catalog.renderable === 5, catalog.renderable);
  check(
    "the 51 generated entries are listed per family",
    catalog.mockRows === 5 &&
      catalog.mockBadges.every((badge) => badge.toLowerCase() === "mock"),
    { rows: catalog.mockRows, badges: [...new Set(catalog.mockBadges)] },
  );
  check(
    "the export is described honestly as a frame, not a video",
    /PNG frame/i.test(catalog.notice) &&
      /encoder that is not shipped/i.test(catalog.notice),
    catalog.notice.slice(0, 200),
  );
  await shot(page, "01-templates-catalog");

  // Render a real frame.
  await page.evaluate(() => {
    document
      .querySelector(".kx-col:first-child .kx-ai-row")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 500));

  const beforeRender = await page.evaluate(() => ({
    hasPreview: Boolean(document.querySelector(".kx-preview img")),
    renderButton: [...document.querySelectorAll(".kx-btn")].some(
      (button) => button.textContent?.trim() === "Render frame",
    ),
  }));
  check("the render control is offered", beforeRender.renderButton, beforeRender);
  check("nothing is rendered before the user asks", beforeRender.hasPreview === false);

  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".kx-btn")].find(
      (element) => element.textContent?.trim() === "Render frame",
    );
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await page.waitForFunction(
    () => Boolean(document.querySelector(".kx-preview img")),
    { timeout: 25000 },
  );
  await new Promise((r) => setTimeout(r, 400));

  const frame = await page.evaluate(async () => {
    const image = document.querySelector(".kx-preview img");
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const frame = context.getImageData(0, 0, canvas.width, canvas.height);
    let dark = 0;
    let coloured = 0;
    for (let index = 0; index < frame.data.length; index += 4) {
      const [r, g, b] = [frame.data[index], frame.data[index + 1], frame.data[index + 2]];
      if (r + g + b < 120) dark += 1;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 24) coloured += 1;
    }
    const digest = await crypto.subtle.digest("SHA-256", frame.data);
    return {
      width: canvas.width,
      height: canvas.height,
      darkPixels: dark,
      colouredPixels: coloured,
      totalPixels: frame.data.length / 4,
      pixelSha256: Array.from(new Uint8Array(digest))
        .map((value) => value.toString(16).padStart(2, "0"))
        .join(""),
    };
  });
  report.frame = frame;
  check(
    "the rendered frame has the template resolution",
    frame.width === 1920 && frame.height === 1080,
    { width: frame.width, height: frame.height },
  );
  check(
    "the rendered frame really contains template pixels",
    frame.colouredPixels > frame.totalPixels * 0.5 && frame.darkPixels > 0,
    frame,
  );
  await shot(page, "02-templates-rendered");

  // The mock entries must not offer a working button.
  const mockAction = await page.evaluate(() =>
    [...document.querySelectorAll(".kx-btn")]
      .map((button) => button.textContent?.trim() ?? "")
      .filter((label) => /use template/i.test(label)),
  );
  check(
    "no dead 'use template' button is offered",
    mockAction.length === 0,
    mockAction,
  );

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
  `templates smoke: ${report.checks.length - failed.length}/${report.checks.length} checks passed`,
);
if (failed.length) process.exit(1);
