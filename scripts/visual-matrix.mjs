#!/usr/bin/env node
/**
 * Collect actual KNOUX REC route evidence, not splash images.
 *
 * Images are EVIDENCE ONLY, not proof of visual reference fidelity.
 * Default: 20 routes * 2 themes * 2 languages * 3 DPRs * 2 viewport sizes.
 * Filter locally with KNOUX_MATRIX_ROUTES, THEMES, LANGUAGES, DPIS, VIEWPORTS.
 * Existing artifacts/visual-matrix is deliberately left untouched.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import puppeteer from "puppeteer-core";

const BASE = process.env.KNOUX_BASE_URL ?? "http://127.0.0.1:4174/";
const OUT = path.resolve(process.env.KNOUX_MATRIX_OUTPUT ?? "artifacts/visual-matrix-verified");
const CHROME = process.env.KNOUX_CHROME ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ALL_ROUTES = [
  "dashboard", "discover", "studio", "screenshots", "library", "templates",
  "toolbox", "visual-patch", "morphcore", "audio-studio", "batch", "elysian",
  "body-editor", "offline-ai", "arabic-ai", "models", "settings", "diagnostics",
  "about", "live-studio",
];
function choices(name, all) {
  const specified = process.env[name]?.split(",").map((v) => v.trim()).filter(Boolean);
  const selected = specified?.length ? specified : all;
  if (selected.some((v) => !all.includes(v))) throw new Error("Unsupported " + name + " option");
  return selected;
}
const routes = choices("KNOUX_MATRIX_ROUTES", ALL_ROUTES);
const themes = choices("KNOUX_MATRIX_THEMES", ["light", "dark"]);
const languages = choices("KNOUX_MATRIX_LANGUAGES", ["en", "ar"]);
const dpis = choices("KNOUX_MATRIX_DPIS", ["1", "1.25", "1.5"]).map(Number);
const viewports = (process.env.KNOUX_MATRIX_VIEWPORTS ?? "1600x1000,1024x700")
  .split(",").map((spec) => {
    const match = /^(\d{3,4})x(\d{3,4})$/.exec(spec.trim());
    if (!match) throw new Error("Invalid KNOUX_MATRIX_VIEWPORTS: " + spec);
    return { width: Number(match[1]), height: Number(match[2]) };
  });
const manifest = {
  generatedAt: new Date().toISOString(), base: BASE,
  expectedCases: routes.length * themes.length * languages.length * dpis.length * viewports.length,
  checks: [], screenshots: [],
  visualReferenceReview: "NOT_REVIEWED",
  allAutomatedChecksPassed: false,
};
async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ["--no-first-run", "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  });
  let failed = 0;
  try {
    const page = await browser.newPage();
    let currentCase = "boot";
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push({ case: currentCase, error: String(err) }));
    // Browser-reported errors are retained as evidence, never silently ignored.
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push({ case: currentCase, error: msg.text() });
    });
    await page.evaluateOnNewDocument(() => {
      const params = new URLSearchParams(location.search);
      const theme = params.get("matrixTheme");
      const language = params.get("matrixLanguage");
      if (!theme || !language) return;
      let previous = {};
      try {
        previous = JSON.parse(localStorage.getItem("knoux-rec.settings.v1") || "{}") || {};
      } catch {
        previous = {};
      }
      localStorage.setItem("knoux-rec.settings.v1", JSON.stringify({ ...previous, theme, language }));
    });
    for (const route of routes) {
      for (const theme of themes) {
        for (const language of languages) {
          for (const dpi of dpis) {
            for (const viewport of viewports) {
              currentCase = [route, theme, language, dpi, viewport.width + "x" + viewport.height].join("/");
              let result;
              try {
                await page.setViewport({ ...viewport, deviceScaleFactor: dpi });
                const url = new URL(BASE);
                url.searchParams.set("matrixTheme", theme);
                url.searchParams.set("matrixLanguage", language);
                url.hash = "/" + route; // AppRoot parses hash, not the URL pathname.
                await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 30000 });
                await page.waitForSelector(".kx-app", { timeout: 20000 });
                // .kx-app mounts behind the splash. Waiting for it alone is invalid.
                await page.waitForFunction(
                  () => document.querySelector(".kx-splash") === null,
                  { timeout: 30000 },
                );
                await page.waitForFunction(
                  (id) => location.hash.startsWith("#/" + id)
                    && document.querySelector(".kx-main")?.textContent?.trim().length > 50,
                  { timeout: 12000 }, route,
                );
                const observed = await page.evaluate(() => {
                  const main = document.querySelector(".kx-main");
                  return {
                    hash: location.hash,
                    theme: document.documentElement.dataset.theme,
                    lang: document.documentElement.lang,
                    dir: document.documentElement.dir,
                    splashPresent: !!document.querySelector(".kx-splash"),
                    contentLength: main?.textContent?.trim().length ?? 0,
                    rootOverflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
                    rootOverflowY: Math.max(0, document.documentElement.scrollHeight - innerHeight),
                    mainOverflowX: main ? Math.max(0, main.scrollWidth - main.clientWidth) : -1,
                    devicePixelRatio,
                  };
                });
                const passed = observed.hash.startsWith("#/" + route)
                  && observed.theme === theme
                  && observed.lang === language
                  && observed.dir === (language === "ar" ? "rtl" : "ltr")
                  && !observed.splashPresent && observed.contentLength > 50
                  && observed.rootOverflowX <= 1 && observed.rootOverflowY <= 1
                  && observed.mainOverflowX <= 1
                  && Math.abs(observed.devicePixelRatio - dpi) < 0.01;
                const dir = path.join(OUT, route);
                await mkdir(dir, { recursive: true });
                const file = path.join(dir,
                  [theme, language, Math.round(dpi * 100), viewport.width + "x" + viewport.height].join("-") + ".png");
                await page.screenshot({ path: file, fullPage: false });
                manifest.screenshots.push(file);
                result = { case: currentCase, passed, observed, file };
              } catch (error) {
                result = { case: currentCase, passed: false, error: String(error?.stack ?? error) };
              }
              manifest.checks.push(result);
              if (!result.passed) failed++;
              console.log((result.passed ? "PASS " : "FAIL ") + currentCase);
            }
          }
        }
      }
    }
    manifest.pageErrors = pageErrors;
    manifest.consoleErrors = consoleErrors;
    if (pageErrors.length) failed += pageErrors.length;
  } finally {
    await browser.close();
    manifest.allAutomatedChecksPassed = failed === 0
      && manifest.checks.length === manifest.expectedCases
      && manifest.screenshots.length === manifest.expectedCases;
    manifest.finishedAt = new Date().toISOString();
    await writeFile(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
    console.log("RESULT " + JSON.stringify({
      cases: manifest.checks.length, expected: manifest.expectedCases,
      images: manifest.screenshots.length, failed, visualReferenceReview: "NOT_REVIEWED",
    }));
  }
  if (!manifest.allAutomatedChecksPassed) process.exitCode = 1;
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
