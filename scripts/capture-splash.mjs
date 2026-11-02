#!/usr/bin/env node
/**
 * KNOUX REC — Splash / shell capture (2026-11-02)
 *
 * The splash only lives for about a second, so it is captured separately with
 * the `intro=hold` flag the shell already honours. Nothing is mocked: the
 * splash is the real one, showing the real readiness steps.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.KNOUX_BASE_URL ?? "http://localhost:4174/";
const CHROME =
  process.env.KNOUX_CHROME ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const label = process.argv.includes("--label")
  ? process.argv[process.argv.indexOf("--label") + 1]
  : "current";
const OUT = path.resolve("artifacts/visual-execution", label, "splash");

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-first-run", "--no-sandbox", "--disable-gpu", "--window-size=1680,960"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1680, height: 960, deviceScaleFactor: 1 });
await mkdir(OUT, { recursive: true });

await page.goto(`${BASE}?intro=hold#/dashboard`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".kx-splash", { timeout: 20000 });
await new Promise((r) => setTimeout(r, 2200));
await page.screenshot({ path: path.join(OUT, "splash.png") });

// The shell itself, after the splash is dismissed.
await page.goto(`${BASE}#/dashboard`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".kx-app", { timeout: 20000 });
await new Promise((r) => setTimeout(r, 2600));
await page.screenshot({ path: path.join(OUT, "shell.png") });

await browser.close();
console.log(`Splash captures written to ${OUT}`);
