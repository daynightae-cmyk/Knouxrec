#!/usr/bin/env node
/**
 * KNOUX REC — keyboard shortcut smoke.
 *
 * Drives the real settings screen and the real window listener:
 *
 *   - the shortcut card lists every action with its current binding,
 *   - recording a new combination captures it live and Escape leaves it alone,
 *   - a combination already in use is refused with the name of its owner,
 *   - the binding survives a reload because it is written to the settings file,
 *   - the new combination actually starts and stops a microphone take,
 *   - the screenshot binding still lands a real file,
 *   - resetting restores the defaults, and the Arabic build translates the card.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.KNOUX_BASE_URL ?? "http://localhost:4173/";
const OUT = path.resolve("artifacts/evidence/hotkeys");
const CHROME =
  process.env.KNOUX_CHROME ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

await mkdir(OUT, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
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
}

const waitFor = async (page, fn, timeout = 20000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await page.evaluate(fn)) return true;
    await sleep(250);
  }
  return false;
};

const hotkeyState = (page) =>
  page.evaluate(() => ({
    rows: [...document.querySelectorAll("[data-hotkey-row]")].map((row) => ({
      action: row.getAttribute("data-hotkey-row"),
      combo: row.getAttribute("data-combo"),
      label: row.querySelector(".kx-hotkey-label strong")?.textContent?.trim() ?? "",
    })),
    capturing: Boolean(document.querySelector(".kx-hotkey-capture")),
    conflict: document.querySelector("[data-hotkey-conflict]")?.textContent?.trim() ?? null,
    hint: document.querySelector("[data-hotkey-hint]")?.textContent?.trim() ?? "",
  }));

async function pressCombo(page, combo) {
  const parts = combo.split("+");
  const key = parts.pop();
  if (parts.includes("Ctrl")) await page.keyboard.down("Control");
  if (parts.includes("Alt")) await page.keyboard.down("Alt");
  if (parts.includes("Shift")) await page.keyboard.down("Shift");
  await page.keyboard.press(key.length === 1 ? key.toLowerCase() : key);
  if (parts.includes("Shift")) await page.keyboard.up("Shift");
  if (parts.includes("Alt")) await page.keyboard.up("Alt");
  if (parts.includes("Ctrl")) await page.keyboard.up("Control");
  await sleep(350);
}

const audioItemCount = (page) =>
  page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("knoux-rec.library");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const records = await new Promise((resolve, reject) => {
      const transaction = database.transaction("items", "readonly");
      const request = transaction.objectStore("items").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return {
      audio: records.filter((item) => item.kind === "audio").length,
      shots: records.filter((item) => item.kind === "image").length,
      total: records.length,
    };
  });

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
    "--window-size=1500,980",
    "--no-first-run",
  ],
  defaultViewport: { width: 1500, height: 980 },
});

try {
  const page = await browser.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => report.pageErrors.push(String(error)));

  await page.goto(`${BASE}?intro=hold#/settings`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".kx-splash-skip", { timeout: 20000 });
  await page.click(".kx-splash-skip");
  await page.waitForFunction(() => !document.querySelector(".kx-splash"));
  await page.waitForSelector("[data-hotkey-card]", { timeout: 20000 });
  await sleep(500);

  /* ------------------------------------------------------ the card */
  const initial = await hotkeyState(page);
  check(
    "settings: the shortcut card lists every action",
    initial.rows.length === 4 &&
      initial.rows.every((row) => row.combo && row.combo.includes("+")),
    initial.rows,
  );
  check(
    "settings: the bindings start at their documented defaults",
    initial.rows.find((row) => row.action === "toggle")?.combo === "Ctrl+Shift+R" &&
      initial.rows.find((row) => row.action === "audio")?.combo === "Ctrl+Shift+A",
    initial.rows,
  );

  /* ------------------------------------------------ capture a combo */
  await page.evaluate(() => document.querySelector('[data-hotkey-edit="toggle"]')?.click());
  await sleep(300);
  const capturing = await hotkeyState(page);
  check(
    "settings: changing a binding waits for the keys",
    capturing.capturing === true,
    capturing,
  );

  await page.keyboard.press("Escape");
  await sleep(300);
  const escaped = await hotkeyState(page);
  check(
    "settings: Escape leaves the binding untouched",
    escaped.capturing === false &&
      escaped.rows.find((row) => row.action === "toggle")?.combo === "Ctrl+Shift+R",
    escaped,
  );

  await page.evaluate(() => document.querySelector('[data-hotkey-edit="toggle"]')?.click());
  await sleep(250);
  await pressCombo(page, "Ctrl+Alt+K");
  const recorded = await hotkeyState(page);
  check(
    "settings: a recorded combination is stored in canonical order",
    recorded.rows.find((row) => row.action === "toggle")?.combo === "Ctrl+Alt+K",
    recorded.rows,
  );

  /* ---------------------------------------------------- the conflict */
  await page.evaluate(() => document.querySelector('[data-hotkey-edit="audio"]')?.click());
  await sleep(250);
  await pressCombo(page, "Ctrl+Alt+K");
  const conflict = await hotkeyState(page);
  check(
    "settings: a combination already in use is refused, naming its owner",
    Boolean(
      conflict.conflict &&
        /Ctrl\+Alt\+K/.test(conflict.conflict) &&
        conflict.rows.find((row) => row.action === "audio")?.combo === "Ctrl+Shift+A",
    ),
    { conflict: conflict.conflict, rows: conflict.rows },
  );
  await page.keyboard.press("Escape");
  await sleep(300);
  await shot(page, "01-settings");

  /* ------------------------------------------------ persistence */
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-hotkey-card]", { timeout: 25000 });
  await sleep(600);
  const reloaded = await hotkeyState(page);
  check(
    "settings: the new binding survives a reload",
    reloaded.rows.find((row) => row.action === "toggle")?.combo === "Ctrl+Alt+K",
    reloaded.rows,
  );

  /* ------------------------------------------ the binding really fires */
  await page.goto(`${BASE}#/studio`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-capture-mode]", { timeout: 20000 });
  await page.evaluate(() => document.querySelector('[data-capture-mode="audio"]')?.click());
  await sleep(400);
  const hint = await page.evaluate(
    () => document.querySelector("[data-hotkey-hint]")?.textContent?.trim() ?? "",
  );
  check(
    "studio: the visible hint reflects the remapped binding",
    hint.includes("Ctrl+Alt+K"),
    hint,
  );

  const before = await audioItemCount(page);
  await pressCombo(page, "Ctrl+Alt+K");
  const started = await waitFor(page, () => Boolean(document.querySelector("[data-audio-session]")), 15000);
  check("hotkey: the new combination starts a take", started);
  await sleep(1800);
  await pressCombo(page, "Ctrl+Alt+K");
  const stopped = await waitFor(
    page,
    () => !document.querySelector("[data-audio-session]"),
    30000,
  );
  const after = await audioItemCount(page);
  check(
    "hotkey: pressing it again stops and archives the take",
    stopped && after.audio === before.audio + 1,
    { before, after },
  );

  /* ------------------------------------------------ the screenshot key */
  await pressCombo(page, "Ctrl+Shift+S");
  await sleep(2500);
  const afterShot = await audioItemCount(page);
  check(
    "hotkey: the screenshot binding captures a real file",
    afterShot.shots > before.shots,
    { before: before.shots, after: afterShot.shots },
  );

  /* --------------------------------------------------- reset defaults */
  await page.goto(`${BASE}#/settings`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-hotkey-card]", { timeout: 20000 });
  await page.evaluate(() => document.querySelector("[data-hotkey-reset]")?.click());
  await sleep(500);
  const restored = await hotkeyState(page);
  check(
    "settings: resetting brings every binding back to its default",
    restored.rows.find((row) => row.action === "toggle")?.combo === "Ctrl+Shift+R" &&
      restored.rows.find((row) => row.action === "screenshot")?.combo === "Ctrl+Shift+S",
    restored.rows,
  );

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
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    rows: [...document.querySelectorAll("[data-hotkey-row]")].map((row) =>
      row.querySelector(".kx-hotkey-label strong")?.textContent?.trim() ?? "",
    ),
    rawKeys: /settings\.[a-zA-Z.]*/.test(
      document.querySelector("[data-hotkey-card]")?.textContent ?? "",
    ),
  }));
  check(
    "arabic: the shortcut card is translated and readable",
    rtl.dir === "rtl" && rtl.rows.length === 4 && rtl.rows.every((row) => /[\u0600-\u06FF]/.test(row)),
    rtl,
  );
  check("arabic: no translation key leaks into the card", rtl.rawKeys === false, rtl.rawKeys);
  check("arabic: no horizontal overflow in the shortcut list", rtl.overflow <= 0, rtl.overflow);
  await shot(page, "02-arabic");

  check("hotkeys: no uncaught page errors", report.pageErrors.length === 0, report.pageErrors.slice(0, 4));
  check("hotkeys: no console errors", report.consoleErrors.length === 0, report.consoleErrors.slice(0, 5));
} catch (error) {
  report.fatal = String(error);
  console.error("FATAL", error);
} finally {
  await browser.close();
}

const failed = report.checks.filter((entry) => !entry.pass);
report.failures = failed.length;
report.failed = Boolean(report.fatal) || failed.length > 0;
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
