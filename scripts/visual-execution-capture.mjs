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

async function captureRoute(page, route, theme, direction, dpi) {
  // Preferences are written to the app's own storage key before React
  // initialises, so the capture shows the real SettingsContext state. Toggling
  // a CSS class afterwards — which is what the first version of this harness
  // did — only ever painted over the surface and was called out as a faulty
  // evidence method in the independent production-evidence correction.
  await page.evaluateOnNewDocument(
    (t, d) => {
      try {
        window.localStorage.setItem(
          "knoux-rec.settings.v1",
          JSON.stringify({
            theme: t,
            language: d === "rtl" ? "ar" : "en",
            reduceMotion: true,
            screenshotFormat: "png",
            screenshotQuality: 0.92,
            recorder: {
              quality: 1080,
              fps: 30,
              systemAudio: false,
              microphone: false,
              webcamOverlay: false,
              webcamPosition: "bottomRight",
              webcamSize: "medium",
              namingPattern: "KNOUX-REC-[DATE]_[TIME]",
            },
            hotkeys: {},
          }),
        );
      } catch {
        /* storage may be blocked; the capture still proceeds on defaults */
      }
    },
    theme,
    direction,
  );

  const url = `${BASE}#/${route}`;
  await page.setViewport({ width, height, deviceScaleFactor: dpi });
  // A hash-only navigation does not create a new document, so the preference
  // hook above would never run again and every later capture would silently be
  // the first page's theme and language. Dropping to about:blank forces a real
  // load, which is the only way the boot-time preferences take effect.
  await page.goto("about:blank");
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".kx-app", { timeout: 20000 });
  // .kx-app mounts *behind* the splash, so waiting for it alone captures an
  // overlay and calls it a route. Wait for the splash to be gone.
  await page
    .waitForFunction(() => document.querySelector(".kx-splash") === null, { timeout: 20000 })
    .catch(() => undefined);
  // Let lazy routes and measured probes settle.
  await new Promise((resolve) => setTimeout(resolve, 2400));

  const observed = await page.evaluate(() => ({
    hash: location.hash,
    theme: document.documentElement.dataset.theme ?? null,
    dir: document.documentElement.dir,
    lang: document.documentElement.lang,
    splashPresent: Boolean(document.querySelector(".kx-splash")),
    contentLength: (document.querySelector(".kx-main")?.textContent ?? "").trim().length,
    horizontalOverflow:
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    routeLabel:
      document.querySelector(".kx-nav-item[aria-current='page'] .kx-nav-label")?.textContent?.trim() ??
      null,
  }));

  // Fail closed: a capture of the wrong route, of the splash, or of a page that
  // overflows horizontally is recorded as a failure, never as a picture.
  const problems = [];
  if (!observed.hash.startsWith(`#/${route}`)) problems.push(`route is ${observed.hash}`);
  if (observed.splashPresent) problems.push("splash still covering the route");
  if (observed.contentLength < 50) problems.push("main content is empty");
  if (observed.horizontalOverflow > 1) problems.push(`overflow ${observed.horizontalOverflow}px`);
  if (direction === "rtl" && observed.dir !== "rtl") problems.push("document is not RTL");

  const routeName = direction === "rtl" ? `${route}-rtl` : route;
  const file = path.join(OUT_ROOT, label, theme, `${routeName}-${Math.round(dpi * 100)}.png`);
  await mkdir(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: false });
  const info = await stat(file);
  return { file, bytes: info.size, observed, problems };
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

  const manifest = {
    label,
    base: BASE,
    capturedAt: new Date().toISOString(),
    viewport: { width, height },
    // The independent correction requires both a wide and a minimum window.
    shots: {},
  };

  const themes = arg("themes", "dark") === "all" ? ["dark", "light"] : ["dark"];
  const directions = arg("dirs", "ltr") === "all" ? ["ltr", "rtl"] : ["ltr"];
  const dpis = arg("dpis", "1") === "all" ? [1, 1.25, 1.5] : [Number(arg("dpis", "1"))];

  for (const theme of themes) {
    for (const direction of directions) {
      for (const route of routes) {
        for (const dpi of dpis) {
          const key = `${theme}/${direction}/${route}@${dpi}x`;
          try {
            const result = await captureRoute(page, route, theme, direction, dpi);
            manifest.shots[key] = result;
            const flag = result.problems.length ? "FAIL " : "OK   ";
            console.log(
              `${flag}${key} -> ${path.relative(process.cwd(), result.file)} (${result.bytes} B)${
                result.problems.length ? " :: " + result.problems.join("; ") : ""
              }`,
            );
          } catch (err) {
            manifest.shots[key] = { error: err.message };
            console.error(`ERROR ${key}: ${err.message}`);
          }
        }
      }
    }
  }

  const failing = Object.entries(manifest.shots).filter(
    ([, value]) => value.problems?.length || value.error,
  );
  manifest.failingCount = failing.length;
  manifest.visualReferenceReview =
    "NOT_REVIEWED — these captures prove the route rendered without the splash, at the requested theme, direction and viewport, with no horizontal overflow. They are not a human design-fidelity acceptance.";

  manifest.consoleErrors = consoleErrors.slice(0, 50);
  const scopeLabel = `${routes.length} routes × ${themes.length} theme(s) × ${directions.length} direction(s) × ${dpis.length} dpi`;
  const manifestPath = path.join(OUT_ROOT, label, "manifest.json");

  // A second run with a narrower --routes list used to replace the manifest
  // outright, so capturing four light cases deleted the record of the
  // thirty-eight already taken. Captures are additive: this run's keys
  // overwrite their own previous entries and everything else is kept.
  manifest.shotCount = Object.keys(manifest.shots).length;
  let merged = manifest;
  if (existsSync(manifestPath)) {
    try {
      const previous = JSON.parse(await readFile(manifestPath, "utf8"));
      merged = {
        ...previous,
        ...manifest,
        shots: { ...(previous.shots ?? {}), ...manifest.shots },
        runs: [...(previous.runs ?? []), { at: manifest.capturedAt, scope: scopeLabel }],
      };
      merged.failingCount = Object.values(merged.shots).filter(
        (value) => value.problems?.length || value.error,
      ).length;
      merged.shotCount = Object.keys(merged.shots).length;
    } catch {
      // An unreadable previous manifest is replaced rather than trusted.
    }
  }

  await writeFile(manifestPath, JSON.stringify(merged, null, 2));
  await browser.close();
  console.log(`\nManifest: ${manifestPath} (${merged.shotCount ?? 0} captures on record)`);
  if (consoleErrors.length) {
    console.log(`Console errors observed: ${consoleErrors.length}`);
  }

  // The manifest is written either way, but a run where captures were flagged
  // must not report success. Counting failures and exiting 0 is the same faulty
  // evidence method the production-evidence correction called out: the harness
  // proved it could take a picture, not that the picture was real. Judged
  // against the merged record, so a narrow clean run cannot bury an earlier
  // flagged capture.
  const onRecord = Object.entries(merged.shots ?? {});
  const flagged = onRecord.filter(
    ([, value]) => value.problems?.length || value.error,
  );
  if (flagged.length) {
    console.error(
      `\nvisual-execution-capture: FAILED — ${flagged.length} of ${onRecord.length} captures on record flagged`,
    );
    for (const [key, value] of flagged.slice(0, 15)) {
      console.error(
        ` - ${key}: ${(value.problems?.length ? value.problems : [value.error]).join("; ")}`,
      );
    }
    process.exit(1);
  }
  console.log(
    `\nvisual-execution-capture: PASSED — ${onRecord.length} captures on record, none flagged`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
