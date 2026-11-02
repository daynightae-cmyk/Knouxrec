#!/usr/bin/env node
/**
 * KNOUX REC — Visual Execution Screenshot Harness (2026-11-02)
 *
 * Captures the ten mission routes (plus preserved routes) from the real running
 * application so BEFORE/AFTER visual fidelity can be compared against the
 * approved design references in docs/design/knoux-rec-2026-11-02/.
 *
 * Usage:
 *   node scripts/visual-execution-capture.mjs --label before
 *   node scripts/visual-execution-capture.mjs --label after --routes dashboard,studio
 *
 * Output: artifacts/visual-execution/{label}/{route}.png  + manifest.json
 *
 * Notes:
 * - The app routes by hash (#/route), NOT by path. The historical
 *   scripts/visual-matrix.mjs used path segments, which silently rendered the
 *   dashboard for every route; this harness fixes that.
 * - Nothing here fabricates content: every pixel comes from the live app.
 */

import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.KNOUX_BASE_URL ?? "http://localhost:4174/";
const CHROME =
  process.env.KNOUX_CHROME ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUT_ROOT = path.resolve("artifacts/visual-execution");

const ALL_ROUTES = [
  "dashboard",
  "discover",
  "studio",
  "screenshots",
  "library",
  "templates",
  "toolbox",
  "audio-studio",
  "batch",
  // preserved sections that must not regress
  "visual-patch",
  "morphcore",
  "elysian",
  "body-editor",
  "offline-ai",
  "arabic-ai",
  "models",
  "settings",
  "diagnostics",
  "about",
];

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : fallback;
}

const label = arg("label", "current");
const routes = arg("routes", "")
  ? arg("routes", "")
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean)
  : ALL_ROUTES;
const width = Number(arg("width", "1680"));
const height = Number(arg("height", "960"));

async function ensureChrome() {
  if (existsSync(CHROME)) return CHROME;
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`No Chromium/Edge binary found for screenshots (${CHROME})`);
}

async function captureRoute(page, route, theme, direction) {
  const url = `${BASE}#/${route}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // Wait for the app shell (the splash screen may still be on top).
  await page.waitForSelector(".kx-app", { timeout: 20000 });
  // Force the theme/direction explicitly so the capture is deterministic.
  await page.evaluate(
    (t, d) => {
      document.documentElement.classList.toggle("dark", t === "dark");
      document.documentElement.classList.toggle("light", t !== "dark");
      document.documentElement.dir = d;
      document.documentElement.lang = d === "rtl" ? "ar" : "en";
    },
    theme,
    direction,
  );
  // Let the splash transition finish and lazy routes settle.
  await new Promise((resolve) => setTimeout(resolve, 2600));
  const routeName = direction === "rtl" ? `${route}-rtl` : route;
  const file = path.join(OUT_ROOT, label, theme, `${routeName}.png`);
  await mkdir(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function main() {
  const executablePath = await ensureChrome();
  await mkdir(path.join(OUT_ROOT, label), { recursive: true });

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      "--window-size=1680,960",
      "--no-first-run",
      "--no-sandbox",
      "--disable-gpu",
      "--font-render-hinting=none",
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

  const manifest = { label, base: BASE, capturedAt: new Date().toISOString(), shots: {} };

  const themes = arg("themes", "dark") === "all" ? ["dark", "light"] : ["dark"];
  const directions = arg("dirs", "ltr") === "all" ? ["ltr", "rtl"] : ["ltr"];

  for (const theme of themes) {
    for (const direction of directions) {
      for (const route of routes) {
        const key = `${theme}/${direction}/${route}`;
        try {
          const file = await captureRoute(page, route, theme, direction);
          const info = await stat(file);
          manifest.shots[key] = { file, bytes: info.size };
          console.log(`OK   ${key} -> ${path.relative(process.cwd(), file)} (${info.size} B)`);
        } catch (err) {
          manifest.shots[key] = { error: err.message };
          console.error(`FAIL ${key}: ${err.message}`);
        }
      }
    }
  }

  manifest.consoleErrors = consoleErrors.slice(0, 50);
  const manifestPath = path.join(OUT_ROOT, label, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await browser.close();
  console.log(`\nManifest: ${manifestPath}`);
  if (consoleErrors.length) {
    console.log(`Console errors observed: ${consoleErrors.length}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
