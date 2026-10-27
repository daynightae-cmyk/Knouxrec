#!/usr/bin/env node
/**
 * Visual Matrix Screenshot Generator
 *
 * Captures screenshots of all 20 routes in all theme/DPI/RTL combinations.
 * Output: artifacts/visual-matrix/{route}/{theme}-{direction}-{dpi}.png
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.KNOUX_BASE_URL ?? "http://localhost:4174/";
const OUT = path.resolve("artifacts/visual-matrix");
const CHROME =
  process.env.KNOUX_CHROME ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const ROUTES = [
  "dashboard",
  "discover",
  "studio",
  "screenshots",
  "library",
  "templates",
  "toolbox",
  "visual-patch",
  "morphcore",
  "audio-studio",
  "batch",
  "elysian",
  "body-editor",
  "offline-ai",
  "arabic-ai",
  "models",
  "settings",
  "diagnostics",
  "about",
  "live-studio",
];

const THEMES = ["light", "dark"];
const DIRECTIONS = ["ltr", "rtl"];
const DPIS = [1, 1.25, 1.5];

async function captureRoute(page, route, theme, direction, dpi) {
  const url = `${BASE}${route}?theme=${theme}&dir=${direction}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".kx-app", { timeout: 15000 });
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: dpi });

  if (direction === "rtl") {
    await page.evaluate(() => {
      document.documentElement.dir = "rtl";
      document.documentElement.lang = "ar";
    });
  }

  if (theme === "dark") {
    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
    });
  } else {
    await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
    });
  }

  await new Promise((r) => setTimeout(r, 500));

  const routeDir = path.join(OUT, route);
  await mkdir(routeDir, { recursive: true });

  const fileName = `${theme}-${direction}-${Math.round(dpi * 100)}.png`;
  const filePath = path.join(routeDir, fileName);
  await page.screenshot({ path: filePath, fullPage: false });
  return filePath;
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      "--auto-select-desktop-capture-source=Entire screen",
      "--window-size=1600,1000",
      "--no-first-run",
    ],
  });

  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error(`[${route}]`, msg.text());
  });

  const manifest = { generatedAt: new Date().toISOString(), routes: {} };

  for (const route of ROUTES) {
    console.log(`\n=== ${route} ===`);
    manifest.routes[route] = {};

    for (const theme of THEMES) {
      for (const direction of DIRECTIONS) {
        for (const dpi of DPIS) {
          const label = `${theme}/${direction}/${dpi}x`;
          try {
            const file = await captureRoute(page, route, theme, direction, dpi);
            manifest.routes[route][label] = file;
            console.log(`  ✓ ${label}`);
          } catch (err) {
            console.error(`  ✗ ${label}:`, err.message);
            manifest.routes[route][label] = { error: err.message };
          }
        }
      }
    }
  }

  await writeFile(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  await browser.close();
  console.log(`\nVisual matrix complete. Output: ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});