#!/usr/bin/env node
/**
 * KNOUX REC — proportion mirror smoke.
 *
 * The Body Editor screen measures guides the user places; it never infers a
 * body. These checks hold it to exactly that:
 *
 *   - the 18+ declaration is required and a child year is refused,
 *   - an uploaded photograph becomes a real stage at its own size,
 *   - seven guides are drawn and every measurement is a real number,
 *   - dragging a guide changes the measured span, arrow keys nudge it,
 *   - canon placement lands chin/shoulder/waist on the documented heads,
 *   - the copied report contains the numbers on screen,
 *   - the body-aware services are listed as blocked with no control,
 *   - saving archives the source image, and Arabic renders translated.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { writeSolidPng } from "./lib/png.mjs";

const BASE = process.env.KNOUX_BASE_URL ?? "http://localhost:4173/";
const OUT = path.resolve("artifacts/evidence/proportions");
const CHROME =
  process.env.KNOUX_CHROME ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

await mkdir(OUT, { recursive: true });
const SOURCE = path.join(OUT, "figure.png");
writeSolidPng(SOURCE, 400, 800, [60, 90, 140]);

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

const measures = (page) =>
  page.evaluate(() => {
    const read = (key) =>
      document.querySelector(`[data-measure="${key}"]`)?.textContent?.trim() ?? "";
    return {
      height: read("height"),
      head: read("head"),
      width: read("width"),
      heads: read("heads"),
      perHead: read("perHead"),
      rows: [...document.querySelectorAll("[data-prop-row]")].map((row) => ({
        id: row.getAttribute("data-prop-row"),
        values: [...row.querySelectorAll("span")].map((node) => node.textContent?.trim() ?? ""),
      })),
      guides: document.querySelectorAll("[data-prop-guide]").length,
    };
  });

const numberFrom = (text) => Number((text.match(/-?\d+(\.\d+)?/) ?? ["NaN"])[0]);

const guidePercent = async (page, id) => {
  const row = await page.evaluate((needle) => {
    const node = document.querySelector(`[data-prop-row="${needle}"]`);
    return node ? node.querySelectorAll("span")[1]?.textContent?.trim() ?? "" : "";
  }, id);
  return numberFrom(row);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1500,980", "--no-first-run"],
  defaultViewport: { width: 1500, height: 980 },
});

try {
  const context = browser.defaultBrowserContext();
  await context.overridePermissions(new URL(BASE).origin, ["clipboard-read", "clipboard-write"]);

  const page = await browser.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => report.pageErrors.push(String(error)));

  await page.goto(`${BASE}?intro=hold#/body-editor`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".kx-splash-skip", { timeout: 20000 });
  await page.click(".kx-splash-skip");
  await page.waitForFunction(() => !document.querySelector(".kx-splash"));
  await page.waitForSelector("#bodyBirthYear", { timeout: 20000 });

  /* ------------------------------------------------------ age gate */
  await page.evaluate(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const year = document.querySelector("#bodyBirthYear");
    setter.call(year, String(new Date().getFullYear() - 12));
    year.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForSelector(".kx-switch input", { timeout: 5000 });
  await page.evaluate(() => document.querySelector(".kx-switch input")?.click());
  await page.evaluate(() => {
    [...document.querySelectorAll(".kx-btn")].find((node) => /Enter the mirror/.test(node.textContent ?? ""))?.click();
  });
  await sleep(500);
  const refused = await page.evaluate(() => ({
    denied: Boolean(document.querySelector(".kx-notice[data-tone='danger']")),
    stage: Boolean(document.querySelector("[data-prop-stage]")),
  }));
  check("age: a child year is refused and the mirror stays closed", refused.denied && !refused.stage, refused);

  await page.evaluate(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const year = document.querySelector("#bodyBirthYear");
    setter.call(year, String(new Date().getFullYear() - 30));
    year.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.evaluate(() => {
    [...document.querySelectorAll(".kx-btn")].find((node) => /Enter the mirror/.test(node.textContent ?? ""))?.click();
  });
  const opened = await waitFor(page, () => Boolean(document.querySelector("input[type=file]")));
  check("age: an adult declaration opens the mirror", opened);

  /* -------------------------------------------------------- upload */
  const input = await page.waitForSelector('input[type="file"]', { visible: false });
  await input.uploadFile(SOURCE);
  const staged = await waitFor(page, () => Boolean(document.querySelector("[data-prop-stage]")));
  const stage = await page.evaluate(() => {
    const frame = document.querySelector("[data-prop-stage]");
    const image = frame?.querySelector("img");
    return {
      staged: Boolean(frame),
      width: frame?.querySelector("img")?.naturalWidth ?? 0,
      height: frame?.querySelector("img")?.naturalHeight ?? 0,
      decoded: Boolean(image?.complete && image?.naturalWidth),
      box: frame
        ? {
            width: Math.round(frame.getBoundingClientRect().width),
            height: Math.round(frame.getBoundingClientRect().height),
          }
        : null,
    };
  });
  check(
    "mirror: the photograph becomes a real stage at its own size",
    staged && stage.decoded && stage.width === 400 && stage.height === 800,
    stage,
  );

  const initial = await measures(page);
  check(
    "mirror: seven guides are drawn — five heights and two edges",
    initial.guides === 7 && initial.rows.length === 5,
    { guides: initial.guides, rows: initial.rows.length },
  );
  check(
    "mirror: every measurement is a real number",
    numberFrom(initial.height) > 0 &&
      numberFrom(initial.head) > 0 &&
      numberFrom(initial.width) > 0 &&
      numberFrom(initial.heads) > 0,
    initial,
  );
  check(
    "mirror: the default span reads as four heads",
    Math.abs(numberFrom(initial.heads) - 4) < 0.05 &&
      Math.abs(numberFrom(initial.height) - 384) < 1,
    { heads: initial.heads, height: initial.height },
  );
  await shot(page, "01-mirror");

  /* ----------------------------------------------------- dragging */
  const overlayBox = await page.evaluate(() => {
    const svg = document.querySelector("[data-prop-overlay]");
    const rect = svg.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });
  const hipBefore = await guidePercent(page, "hip");
  const heightBefore = numberFrom(initial.height);
  await page.mouse.move(overlayBox.x + overlayBox.width * 0.5, overlayBox.y + overlayBox.height * (hipBefore / 100));
  await page.mouse.down();
  await page.mouse.move(
    overlayBox.x + overlayBox.width * 0.5,
    overlayBox.y + overlayBox.height * ((hipBefore + 15) / 100),
    { steps: 8 },
  );
  await page.mouse.up();
  await sleep(500);
  const dragged = await measures(page);
  const hipAfter = await guidePercent(page, "hip");
  check(
    "mirror: dragging a guide moves it and re-measures the span",
    hipAfter > hipBefore + 5 &&
      Math.abs(numberFrom(dragged.height) - heightBefore) > 40,
    { before: hipBefore, after: hipAfter, height: dragged.height },
  );

  const focused = await page.evaluate(() => {
    const handle = document.querySelector('[data-prop-guide="chin"]');
    handle?.focus();
    return document.activeElement === handle;
  });
  check("mirror: a guide takes keyboard focus", focused === true, focused);
  const chinBefore = await guidePercent(page, "chin");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await sleep(400);
  const chinAfter = await guidePercent(page, "chin");
  check(
    "mirror: arrow keys nudge the focused guide",
    Math.abs(chinAfter - (chinBefore + 2)) <= 0.3,
    { before: chinBefore, after: chinAfter },
  );

  /* -------------------------------------------------------- canon */
  const canonBefore = await page.evaluate(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    return { crown: setter !== null };
  });
  check("mirror: the canon action is offered", canonBefore.crown === true);
  await page.evaluate(() => document.querySelector("[data-prop-canon]")?.click());
  await sleep(500);
  const canon = await page.evaluate(() => {
    const row = (id) =>
      Number(
        (document.querySelector(`[data-prop-row="${id}"]`)?.querySelectorAll("span")[1]?.textContent ?? "")
          .replace("%", ""),
      );
    return { crown: row("crown"), chin: row("chin"), shoulder: row("shoulder"), waist: row("waist"), hip: row("hip") };
  });
  const span = canon.hip - canon.crown;
  const head = span / 4;
  const near = (a, b) => Math.abs(a - b) <= 0.6;
  check(
    "mirror: canon placement lands the lines on whole and half heads",
    near(canon.chin, canon.crown + head) &&
      near(canon.shoulder, canon.crown + head * 1.5) &&
      near(canon.waist, canon.crown + head * 3),
    { canon, head },
  );

  /* ------------------------------------------------------- copying */
  await page.evaluate(() => document.querySelector("[data-prop-copy]")?.click());
  const copyReported = await waitFor(
    page,
    () => {
      const label = document.querySelector("[data-prop-copy]")?.textContent?.trim() ?? "";
      if (/Copied/.test(label)) return true;
      const toasts = [...document.querySelectorAll(".kx-toast")];
      return toasts.some((toast) =>
        /Measurements copied|Could not copy/.test(toast.textContent ?? ""),
      );
    },
    6000,
  );
  const copyState = await page.evaluate(() => ({
    report: document.querySelector("[data-prop-report] pre")?.textContent ?? "",
    label: document.querySelector("[data-prop-copy]")?.textContent?.trim() ?? "",
    toast: [...document.querySelectorAll(".kx-toast")].at(-1)?.textContent?.trim() ?? "",
  }));
  check(
    "mirror: the report on the page carries every measurement",
    /Crown to hip: \d+ px/.test(copyState.report) &&
      /Span in heads: \d/.test(copyState.report) &&
      /Crown: \d/.test(copyState.report),
    copyState.report.slice(0, 160),
  );
  check(
    "mirror: the copy action always says what happened",
    copyReported,
    copyState,
  );

  /* -------------------------------------------------------- blocked */
  const blocked = await page.evaluate(() => {
    const items = [...document.querySelectorAll(".kx-prop-blocked li")];
    return {
      count: items.length,
      badges: items.filter((item) => item.querySelector('.kx-badge[data-state="BLOCKED"]')).length,
      controls: document.querySelectorAll(".kx-prop-blocked button, .kx-prop-blocked input").length,
    };
  });
  check(
    "mirror: the body-aware services are listed as blocked with no control",
    blocked.count === 2 && blocked.badges === 2 && blocked.controls === 0,
    blocked,
  );

  /* ----------------------------------------------------------- save */
  await page.evaluate(() => document.querySelector("[data-prop-save]")?.click());
  await sleep(1600);
  const stored = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open("knoux-rec.library");
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const request = open.result.transaction("items", "readonly").objectStore("items").getAll();
          request.onsuccess = () => {
            const items = (request.result ?? []).filter((item) => /-proportions\.png$/.test(item.name));
            const latest = items[items.length - 1];
            resolve(latest ? { name: latest.name, size: latest.blob?.size ?? 0, width: latest.width, height: latest.height } : null);
          };
        };
      }),
  );
  check(
    "mirror: saving archives the source image with its size",
    Boolean(stored && stored.size > 1000 && stored.width === 400 && stored.height === 800),
    stored,
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
    labels: [...document.querySelectorAll("[data-measure]")].length,
    heading: document.querySelector(".kx-card-title")?.textContent?.trim() ?? "",
    rawKeys: /body\.[a-zA-Z]/.test(document.querySelector(".kx-content")?.textContent ?? ""),
  }));
  check(
    "arabic: the mirror is translated and keeps its measurements",
    rtl.dir === "rtl" && rtl.labels === 5 && /[\u0600-\u06FF]/.test(rtl.heading),
    rtl,
  );
  check("arabic: no translation key leaks into the mirror", rtl.rawKeys === false, rtl.rawKeys);
  check("arabic: no horizontal overflow in the two-column layout", rtl.overflow <= 0, rtl.overflow);
  await shot(page, "02-arabic");

  check("mirror: no uncaught page errors", report.pageErrors.length === 0, report.pageErrors.slice(0, 4));
  check("mirror: no console errors", report.consoleErrors.length === 0, report.consoleErrors.slice(0, 5));
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
