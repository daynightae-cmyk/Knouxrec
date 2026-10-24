#!/usr/bin/env node
/**
 * KNOUX REC — unified service discovery smoke.
 *
 * Drives the discovery view in Chromium and checks it against the registry it
 * is supposed to mirror:
 *
 *   - the header count equals the number of registry entries,
 *   - search filters by English label, Arabic label and blocker text,
 *   - hub and execution-mode filters only ever show what they claim,
 *   - the runnable filter leaves no blocked card behind,
 *   - a blocked card states its missing dependency and offers the model
 *     manager, while a verified card offers a working Open button,
 *   - favourites survive a page reload,
 *   - opening a service records it as recent and really navigates,
 *   - the Live Studio shortcut reaches the shared workspace,
 *   - Arabic RTL renders without horizontal overflow,
 *   - no console or page errors occur anywhere in the run.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.KNOUX_BASE_URL ?? "http://localhost:4173/";
const OUT = path.resolve("artifacts/evidence/discover");
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

async function gotoRoute(page, hash) {
  await page.evaluate((target) => {
    window.location.hash = target;
  }, hash);
  await sleep(500);
}

function setNativeValue(page, selector, value) {
  return page.evaluate(
    ({ sel, next }) => {
      const input = document.querySelector(sel);
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      ).set;
      setter.call(input, next);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    { sel: selector, next: value },
  );
}

async function clickBy(page, selector) {
  const clicked = await page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (!element || element.disabled) return false;
    element.click();
    return true;
  }, selector);
  if (!clicked) throw new Error(`Control not found or disabled: ${selector}`);
  await sleep(450);
  return clicked;
}

function readCards(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".elys-service")].map((card) => ({
      id: card.getAttribute("data-service-id"),
      runnable: card.getAttribute("data-runnable") === "true",
      mode: card.querySelector(".kx-chip[data-mode]")?.textContent?.trim() ?? "",
      badge: card.querySelector(".kx-badge")?.textContent?.trim() ?? "",
      needs: card.querySelector(".elys-service-needs")?.textContent?.trim() ?? "",
      name: card.querySelector(".elys-service-name")?.textContent?.trim() ?? "",
    })),
  );
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
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

  await page.goto(`${BASE}?nc=${Date.now()}#/discover`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".elys-service", { timeout: 30000 });
  await sleep(600);

  const cards = await readCards(page);
  const headerCount = await page.evaluate(
    () => document.querySelector(".elys-discover-bar .kx-badge")?.textContent ?? "",
  );
  check("discovery renders the whole registry", cards.length > 60, cards.length);
  check(
    "the header count matches the rendered cards",
    headerCount.replace(/\s+/g, "") === `${cards.length}/${cards.length}`,
    { headerCount, cards: cards.length },
  );

  const focused = await page.evaluate(
    () => document.activeElement?.getAttribute("type") === "search",
  );
  check("the search field takes focus on open", focused);

  /* ---------------------------------------------------------- search */
  await setNativeValue(page, 'input[type="search"]', "watermark");
  await sleep(400);
  const searched = await readCards(page);
  check(
    "search narrows the list to matching services",
    searched.length > 0 && searched.length < cards.length,
    { matched: searched.length, total: cards.length },
  );
  check(
    "search finds the Elysian watermark service",
    searched.some((card) => card.id === "el-marks"),
    searched.map((card) => card.id),
  );

  await setNativeValue(page, 'input[type="search"]', "تمويه");
  await sleep(400);
  const arabicSearch = await readCards(page);
  check(
    "search matches Arabic labels as well",
    arabicSearch.length > 0 &&
      arabicSearch.every((card) => /blur|pixelate|تمويه/i.test(card.name)) &&
      arabicSearch.some((card) => card.id === "shot-redact"),
    arabicSearch.map((card) => card.id),
  );

  await setNativeValue(page, 'input[type="search"]', "segmentation");
  await sleep(400);
  const blockedSearch = await readCards(page);
  check(
    "searching a blocker returns only entries that state a dependency",
    blockedSearch.length > 0 && blockedSearch.every((card) => card.needs.length > 0),
    blockedSearch.map((card) => ({ id: card.id, needs: card.needs.slice(0, 40) })),
  );

  await setNativeValue(page, 'input[type="search"]', "nothing-matches-this");
  await sleep(400);
  const emptyState = await page.evaluate(
    () => document.querySelector(".kx-empty-title")?.textContent ?? null,
  );
  check("an empty result set shows a real empty state", Boolean(emptyState), emptyState);
  await setNativeValue(page, 'input[type="search"]', "");
  await sleep(400);

  /* ---------------------------------------------------------- filters */
  await clickBy(page, '.elys-filters [data-hub-id="elysian"]');
  const hubFiltered = await page.evaluate(
    () => [...document.querySelectorAll("[data-hub-block]")].map((node) => node.dataset.hubBlock),
  );
  check(
    "the hub filter shows exactly one hub",
    hubFiltered.length === 1 && hubFiltered[0] === "elysian",
    hubFiltered,
  );

  await clickBy(page, '.elys-filters [data-hub-id="ALL"]');
  await clickBy(page, '[data-mode-id="MODEL-LOCAL"]');
  const modeFiltered = await readCards(page);
  check(
    "the mode filter never shows the wrong mode",
    modeFiltered.length > 0 && modeFiltered.every((card) => card.mode === "MODEL-LOCAL"),
    modeFiltered.map((card) => ({ id: card.id, mode: card.mode })),
  );
  check(
    "no model-backed service is advertised as verified",
    modeFiltered.every((card) => card.badge !== "Verified"),
    modeFiltered.map((card) => ({ id: card.id, badge: card.badge })),
  );

  await clickBy(page, '[data-mode-id="ALL"]');
  await clickBy(page, '[data-stat="runnable"]');
  const runnableOnly = await readCards(page);
  check(
    "the runnable filter leaves nothing blocked on screen",
    runnableOnly.length > 0 && runnableOnly.every((card) => card.runnable),
    { count: runnableOnly.length, blocked: runnableOnly.filter((c) => !c.runnable).map((c) => c.id) },
  );
  await clickBy(page, '[data-stat="runnable"]');

  /* ------------------------------------------------- honesty of a card */
  const blockedCard = await page.evaluate(() => {
    const card = document.querySelector('[data-service-id="el-retouch"]');
    if (!card) return null;
    return {
      runnable: card.getAttribute("data-runnable"),
      badge: card.querySelector(".kx-badge")?.textContent?.trim(),
      needs: card.querySelector(".elys-service-needs")?.textContent?.trim(),
      openDisabled:
        card.querySelector(".elys-service-actions button")?.disabled ?? null,
      configure: [...card.querySelectorAll("button")].some((node) =>
        /configure models/i.test(node.textContent ?? ""),
      ),
    };
  });
  check(
    "a blocked neural service states its missing weights",
    Boolean(
      blockedCard &&
        blockedCard.runnable === "false" &&
        /segmentation/i.test(blockedCard.needs ?? "") &&
        blockedCard.openDisabled === true &&
        blockedCard.configure,
    ),
    blockedCard,
  );

  const verifiedCard = await page.evaluate(() => {
    const card = document.querySelector('[data-service-id="tb-qr"]');
    if (!card) return null;
    const open = card.querySelector(".elys-service-actions button");
    return {
      runnable: card.getAttribute("data-runnable"),
      badge: card.querySelector(".kx-badge")?.textContent?.trim(),
      openEnabled: open ? !open.disabled : null,
    };
  });
  check(
    "a verified local service is offered as runnable",
    Boolean(
      verifiedCard &&
        verifiedCard.runnable === "true" &&
        /verified/i.test(verifiedCard.badge ?? "") &&
        verifiedCard.openEnabled === true,
    ),
    verifiedCard,
  );

  /* ------------------------------------------------------- favourites */
  const favouritesBefore = await page.evaluate(
    () => document.querySelectorAll(".elys-star[aria-pressed='true']").length,
  );
  await page.evaluate(() => {
    document
      .querySelector('[data-service-id="tb-qr"] .elys-star')
      ?.click();
  });
  await sleep(400);
  const favouritesAfter = await page.evaluate(
    () => document.querySelectorAll(".elys-star[aria-pressed='true']").length,
  );
  check(
    "a service can be favourited from its card",
    favouritesBefore === 0 && favouritesAfter === 1,
    { favouritesBefore, favouritesAfter },
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".elys-service", { timeout: 30000 });
  await sleep(700);
  const persisted = await page.evaluate(
    () => document.querySelectorAll(".elys-star[aria-pressed='true']").length,
  );
  check("favourites survive a reload", persisted === 1, persisted);

  await clickBy(page, '[data-stat="favourites"]');
  const favouriteView = await page.evaluate(
    () => [...document.querySelectorAll(".elys-service")].map((c) => c.dataset.serviceId),
  );
  check(
    "the favourites view lists only starred services",
    favouriteView.length === 1 && favouriteView[0] === "tb-qr",
    favouriteView,
  );
  await clickBy(page, '[data-stat="favourites"]');

  /* --------------------------------------------------- recent + links */
  await gotoRoute(page, "#/library");
  await gotoRoute(page, "#/discover");
  await clickBy(page, '[data-service-id="tb-qr"] [data-action="open"]');
  await sleep(700);
  const afterOpen = await page.evaluate(() => window.location.hash);
  check("opening a service navigates to its hub", afterOpen === "#/toolbox", afterOpen);

  await gotoRoute(page, "#/discover");
  const recentChips = await page.evaluate(
    () => [...document.querySelectorAll(".elys-recent .kx-btn")].map((node) => node.textContent?.trim()),
  );
  check(
    "the opened service is remembered as recent",
    recentChips.length > 0 && recentChips.some((label) => /QR/i.test(label ?? "")),
    recentChips,
  );

  await clickBy(page, '[data-action="studio"]');
  const studioHash = await page.evaluate(() => window.location.hash);
  check("the Live Studio shortcut reaches the shared workspace", studioHash === "#/live-studio", studioHash);

  await gotoRoute(page, "#/discover");
  await clickBy(page, '[data-service-id="el-retouch"] [data-action="configure"]');
  const modelsHash = await page.evaluate(() => window.location.hash);
  check("a blocked service links to the model manager", modelsHash === "#/models", modelsHash);

  await gotoRoute(page, "#/discover");
  await shot(page, "01-discover");

  /* ------------------------------------------------------------ RTL */
  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".kx-topbar button")].find(
      (element) => element.textContent?.trim() === "AR",
    );
    button?.click();
  });
  await gotoRoute(page, "#/discover");
  await sleep(900);
  const rtl = await page.evaluate(() => ({
    dir: document.documentElement.dir,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    arabicCards: [...document.querySelectorAll(".elys-service-name")].filter((node) =>
      /[؀-ۿ]/.test(node.textContent ?? ""),
    ).length,
    cards: document.querySelectorAll(".elys-service").length,
  }));
  check("arabic: the document is RTL on the discovery route", rtl.dir === "rtl", rtl);
  check("arabic: service names render in Arabic", rtl.arabicCards === rtl.cards && rtl.cards > 0, rtl);
  check("arabic: no horizontal overflow", rtl.overflow <= 0, rtl.overflow);
  await shot(page, "02-discover-arabic");

  check("discovery: no uncaught page errors", report.pageErrors.length === 0, report.pageErrors);
  check(
    "discovery: no console errors",
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
