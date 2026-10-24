#!/usr/bin/env node
/**
 * AI workspace and Model Manager smoke test.
 *
 * Verifies that the two AI routes expose one unified catalog of 38 canonical
 * tasks (not 76 duplicated entries), that the Model Manager measures the real
 * manifest hashes and the expected weight payload, and that nothing claims to
 * be ready when the weight binaries are absent.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.KNOUX_BASE_URL ?? "http://localhost:4173/";
const OUT = path.resolve("artifacts/evidence/ai");
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

  /* ---------------- offline AI route ---------------- */
  await page.goto(`${BASE}#/offline-ai`, { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await page.waitForSelector(".kx-ai-row", { timeout: 20000 });

  const offline = await page.evaluate(() => ({
    rows: document.querySelectorAll(".kx-ai-row").length,
    counter:
      [...document.querySelectorAll(".kx-badge")]
        .map((badge) => badge.textContent?.trim() ?? "")
        .find((text) => /\d+\s*\/\s*\d+/.test(text)) ?? "",
    ids: [...document.querySelectorAll(".kx-ai-row")].map(
      (row) => row.querySelector(".kx-ai-row-sub")?.textContent?.split(" · ").pop() ?? "",
    ),
    titles: [...document.querySelectorAll(".kx-ai-row-title")].map(
      (row) => row.textContent?.trim() ?? "",
    ),
    states: [...document.querySelectorAll(".kx-ai-row .kx-badge")].map(
      (badge) => badge.textContent?.trim() ?? "",
    ),
  }));
  report.offline = offline;
  check("offline AI lists 38 canonical tasks", offline.rows === 38, offline.rows);
  check(
    "the catalog counter reports 38 of 38",
    offline.counter.replace(/\s/g, "") === "38/38",
    offline.counter,
  );
  check(
    "every task carries a canonical id",
    offline.ids.every((id) => id.length > 0) && new Set(offline.ids).size === 38,
    offline.ids.length,
  );
  check(
    "no task claims to be ready without weights",
    offline.states.every((state) => state !== "Ready"),
    [...new Set(offline.states)],
  );
  await shot(page, "01-offline-ai");

  /* ---------------- detail panel ---------------- */
  await page.evaluate(() => {
    document
      .querySelector(".kx-ai-row")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  // Wait for the panel to finish populating instead of racing a fixed delay:
  // the manifest rows are hashed asynchronously, and under the load of the full
  // sequential suite a static 400 ms read has caught the panel mid-render with
  // "Expected" still empty. The assertions below are unchanged.
  await page.waitForFunction(
    () => {
      const body = document.querySelector(".kx-ai-detail")?.textContent ?? "";
      return /sha256\s+[0-9a-f]{16,}/.test(body) && /Expected\s+\S/.test(body);
    },
    { timeout: 20000 },
  ).catch(() => undefined);
  const detail = await page.evaluate(() => ({
    title: document.querySelector(".kx-ai-detail .kx-card-title")?.textContent?.trim() ?? "",
    body: document.querySelector(".kx-ai-detail")?.textContent ?? "",
    runDisabled: document.querySelector(".kx-ai-detail .kx-btn-primary")?.disabled ?? false,
    manifestHash: /sha256\s+([0-9a-f]{16,})/.exec(
      document.querySelector(".kx-ai-detail")?.textContent ?? "",
    )?.[1] ?? null,
  }));
  report.detail = detail;
  check("selecting a task opens its detail panel", detail.title.length > 3, detail.title);
  check("the run control stays disabled", detail.runDisabled === true, detail.runDisabled);
  check(
    "the detail panel names the exact missing dependency",
    detail.body.includes("weights.bin") || detail.body.includes("Not installed"),
    detail.body.slice(0, 160),
  );
  check(
    "the manifest hash is measured and shown",
    Boolean(detail.manifestHash),
    detail.manifestHash,
  );
  await shot(page, "02-offline-ai-detail");

  /* ---------------- search ---------------- */
  await page.type(".kx-search", "speech");
  await new Promise((r) => setTimeout(r, 350));
  const searched = await page.evaluate(() => ({
    rows: document.querySelectorAll(".kx-ai-row").length,
    titles: [...document.querySelectorAll(".kx-ai-row-title")].map(
      (row) => row.textContent?.trim() ?? "",
    ),
  }));
  report.search = searched;
  check(
    "search narrows the catalog to matching tasks",
    searched.rows > 0 && searched.rows < 38,
    searched,
  );
  check(
    "search matches the task name",
    searched.titles.some((title) => title.toLowerCase().includes("speech")),
    searched.titles,
  );
  await page.evaluate(() => {
    const input = document.querySelector(".kx-search");
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 250));

  /* ---------------- arabic AI route ---------------- */
  await page.goto(`${BASE}#/arabic-ai`, { waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 1200));
  const arabic = await page.evaluate(() => ({
    rows: document.querySelectorAll(".kx-ai-row").length,
    titles: [...document.querySelectorAll(".kx-ai-row-title")].map(
      (row) => row.textContent?.trim() ?? "",
    ),
    subs: [...document.querySelectorAll(".kx-ai-row-sub")].map(
      (row) => row.textContent?.trim() ?? "",
    ),
    dir: document.documentElement.dir,
  }));
  report.arabic = arabic;
  check("arabic AI lists the same 38 tasks", arabic.rows === 38, arabic.rows);
  check(
    "arabic route shows Arabic labels",
    arabic.titles.some((title) => /[\u0600-\u06FF]/.test(title)),
    arabic.titles.slice(0, 4),
  );
  check(
    "arabic route keeps the canonical ids visible",
    arabic.subs.some((sub) => sub.includes("remove_background")),
    arabic.subs.slice(0, 4),
  );
  await shot(page, "03-arabic-ai");

  /* ---------------- model manager ---------------- */
  await page.goto(`${BASE}#/models`, { waitUntil: "domcontentloaded" });
  await page
    .waitForFunction(() => document.querySelectorAll(".kx-table tbody tr").length > 0, {
      timeout: 90000,
    })
    .catch(() => undefined);
  const models = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".kx-table tbody tr")];
    return {
      count: rows.length,
      states: [...document.querySelectorAll(".kx-table tbody .kx-badge")].map(
        (badge) => badge.textContent?.trim() ?? "",
      ),
      hashes: rows
        .map((row) => /sha256\s+([0-9a-f]{8,})/.exec(row.textContent ?? "")?.[1] ?? null)
        .filter(Boolean),
      expected: rows
        .map((row) => /([\d.]+\s?(KB|MB|GB))\s·\s\d+\s?tensors/.exec(row.textContent ?? "")?.[1] ?? null)
        .filter(Boolean),
      firstRow: rows[0]?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    };
  });
  report.models = models;
  check("model manager lists all 24 manifests", models.count === 24, models.count);
  check(
    "every manifest is hashed with SHA-256",
    models.hashes.length === models.count,
    { hashed: models.hashes.length, rows: models.count },
  );
  check(
    "the expected weight payload is derived from the tensor shapes",
    models.expected.length === models.count && models.expected.length > 0,
    models.expected.slice(0, 4),
  );
  check(
    "no model claims to be ready without weight binaries",
    models.states.every((state) => state === "Manifest only"),
    [...new Set(models.states)],
  );
  await shot(page, "04-models");

  check("no uncaught page errors", report.pageErrors.length === 0, report.pageErrors);
  check(
    "no console errors",
    report.consoleErrors.length === 0,
    report.consoleErrors.slice(0, 4),
  );
} finally {
  await browser.close();
}

const failed = report.checks.filter((entry) => !entry.pass);
report.finishedAt = new Date().toISOString();
report.failed = failed.length;
await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));

console.log(
  `ai smoke: ${report.checks.length - failed.length}/${report.checks.length} checks passed`,
);
if (failed.length) process.exit(1);
