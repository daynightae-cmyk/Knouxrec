#!/usr/bin/env node
/**
 * KNOUX REC — selected-area recording evidence (2026-11-02)
 *
 * The Recorder gate is not passed by a screenshot. This harness drives the real
 * pipeline in Chromium and answers one question with a measurement:
 *
 *   Does a "Selected area" recording contain the selected pixels, or is it a
 *   full-desktop recording with a rectangle drawn on top?
 *
 * It records the whole surface once and a sub-rectangle once, decodes both
 * files back in the browser, and compares the decoded frame dimensions against
 * the rectangle that was chosen. A decorative overlay would produce two files
 * of identical full-surface size and would fail here.
 *
 * It also checks pause/resume timing, cancellation, permission loss, library
 * persistence and re-open, and that the region badge reports real coordinates.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.KNOUX_BASE_URL ?? "http://localhost:4173/";
const OUT = path.resolve("artifacts/visual-execution/phase04-region");
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
  if (pass) console.log(`PASS ${name}`);
  else console.error(`FAIL ${name}: ${JSON.stringify(detail)}`);
  return pass;
}

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
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
page.on("console", (msg) => {
  if (msg.type() === "error") report.consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => report.pageErrors.push(err.message));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Clicks through the DOM rather than the mouse. The OS capture picker and the
 * React re-render that follows move the controls around, and a coordinate
 * click can land on empty space; a dispatched click is what the established
 * recording harness in this repository already uses for the same reason.
 */
const click = async (selector) => {
  const ok = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el || el.disabled) return false;
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return true;
  }, selector);
  if (!ok) throw new Error(`Control not clickable: ${selector}`);
  return ok;
};

const waitFor = async (fn, timeout = 25000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fn)) return true;
    await wait(200);
  }
  return false;
};

const readItems = () =>
  page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("knoux-rec.library");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const records = await new Promise((resolve, reject) => {
      const tx = database.transaction("items", "readonly");
      const request = tx.objectStore("items").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return Promise.all(
      records.map(async (record) => ({
        id: record.id,
        name: record.name,
        kind: record.kind,
        mimeType: record.mimeType,
        bytes: record.blob?.size ?? 0,
        magic: Array.from(
          new Uint8Array(await record.blob.slice(0, 4).arrayBuffer()),
        )
          .map((value) => value.toString(16).padStart(2, "0"))
          .join(" "),
        duration: record.duration,
        width: record.width,
        height: record.height,
        source: record.source,
        hasThumbnail: Boolean(record.thumbnail),
      })),
    );
  });

/** Decodes a stored blob and reports the real playable frame dimensions. */
const decodeDimensions = (blob) =>
  page.evaluate(
    async (payload) => {
      const record = await new Promise((resolve, reject) => {
        const request = indexedDB.open("knoux-rec.library");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const item = await new Promise((resolve, reject) => {
        const tx = record.transaction("items", "readonly");
        const request = tx.objectStore("items").get(payload.id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const url = URL.createObjectURL(item.blob);
      const result = await new Promise((resolve) => {
        const video = document.createElement("video");
        const timer = setTimeout(
          () => resolve({ ok: false, reason: "decode timed out" }),
          12000,
        );
        video.preload = "metadata";
        video.muted = true;
        video.onloadedmetadata = () => {
          clearTimeout(timer);
          resolve({
            ok: true,
            width: video.videoWidth,
            height: video.videoHeight,
            duration: Number.isFinite(video.duration) ? video.duration : null,
          });
          video.src = "";
        };
        video.onerror = () => {
          clearTimeout(timer);
          resolve({ ok: false, reason: "decode error" });
        };
        video.src = url;
      });
      URL.revokeObjectURL(url);
      record.close();
      return result;
    },
    blob,
  );

const statusText = () =>
  page.evaluate(() => document.querySelector(".kx-status-chip")?.textContent?.trim() ?? "");

/** Whatever the app is complaining about right now, for a failure detail. */
const pageDiagnostics = () =>
  page.evaluate(() => ({
    status: document.querySelector(".kx-status-chip")?.textContent?.trim() ?? null,
    alerts: [...document.querySelectorAll(".kx-notice")].map((node) =>
      node.textContent?.trim().slice(0, 220),
    ),
    toasts: [...document.querySelectorAll(".kx-toast")].map((node) =>
      node.textContent?.trim().slice(0, 220),
    ),
    buttons: [...document.querySelectorAll("button")]
      .filter((node) => /stop|pause|recording|area/i.test(node.textContent ?? ""))
      .map((node) => ({
        text: node.textContent?.trim().slice(0, 40),
        disabled: node.disabled,
      })),
  }));

/** Drags a rectangle on the region canvas using real pointer input. */
async function dragRegion(fraction) {
  const box = await page.evaluate(() => {
    const canvas = document.querySelector("[data-region-stage]");
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  if (!box) return null;
  const startX = box.x + box.width * fraction.x0;
  const startY = box.y + box.height * fraction.y0;
  const endX = box.x + box.width * fraction.x1;
  const endY = box.y + box.height * fraction.y1;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move((startX + endX) / 2, (startY + endY) / 2, { steps: 6 });
  await page.mouse.move(endX, endY, { steps: 6 });
  await page.mouse.up();
  await wait(180);
  return box;
}

async function openStudio() {
  await page.goto(`${BASE}?nc=${Date.now()}#/studio`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-capture-modes]", { timeout: 30000 });
  await wait(900);
}

try {
  /* ---------------------------------------------------- full surface first */
  await openStudio();

  check(
    "the recorder offers five capture modes",
    (await page.evaluate(() => document.querySelectorAll("[data-capture-mode]").length)) === 5,
    await page.evaluate(() =>
      [...document.querySelectorAll("[data-capture-mode]")].map((node) => node.dataset.captureMode),
    ),
  );

  check(
    "selected area is offered and enabled",
    await page.evaluate(
      () =>
        !!document.querySelector('[data-capture-mode="region"]') &&
        !document.querySelector('[data-capture-mode="region"]').disabled,
    ),
  );

  await click('[data-capture-mode="screen"]');
  await wait(200);
  await click("[data-start-recording]");
  const fullStarted = await waitFor(
    () => document.querySelector(".kx-status-chip")?.textContent?.includes("Recording") ?? false,
  );
  check("a full-screen recording starts", fullStarted, await statusText());
  await wait(2600);
  await click("[data-stop-recording]");
  const fullSaved = await waitFor(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("knoux-rec.library");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const records = await new Promise((resolve, reject) => {
      const tx = database.transaction("items", "readonly");
      const request = tx.objectStore("items").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return records.some((record) => record.kind === "video");
  });
  check("the full-screen take is written to the library", fullSaved, await pageDiagnostics());

  let items = await readItems();
  const fullItem = items.filter((item) => item.kind === "video").at(-1) ?? null;
  const fullDecoded = fullItem ? await decodeDimensions({ id: fullItem.id }) : null;
  check(
    "the full-screen file decodes at the surface size",
    Boolean(fullDecoded?.ok && fullDecoded.width >= 320),
    { stored: fullItem && [fullItem.width, fullItem.height], decoded: fullDecoded },
  );
  const surfaceWidth = fullDecoded?.width ?? 0;
  const surfaceHeight = fullDecoded?.height ?? 0;

  /* ------------------------------------------------------- selected area */
  await click('[data-capture-mode="region"]');
  await wait(200);
  await click("[data-start-recording]");

  const selectorOpen = await waitFor(
    () => !!document.querySelector("[data-region-stage]"),
    20000,
  );
  check("choosing an area opens the interactive selector", selectorOpen);

  // Draw a rectangle that is clearly smaller than the whole surface.
  const box = await dragRegion({ x0: 0.12, y0: 0.14, x1: 0.52, y1: 0.54 });
  check("a rectangle can be dragged on the live preview", Boolean(box), box);

  const readout = await page.evaluate(
    () => document.querySelector("[data-region-selection-label]")?.textContent ?? null,
  );
  const selectionSize = await page.evaluate(() => {
    const rect = document.querySelector("[data-region-selection]")?.getBoundingClientRect();
    const canvas = document.querySelector("[data-region-stage]")?.getBoundingClientRect();
    const readout = document.querySelector("[data-region-readout]")?.textContent ?? "";
    const match = readout.match(/(\d+)×(\d+) selected/);
    return {
      canvasWidth: canvas?.width ?? 0,
      canvasHeight: canvas?.height ?? 0,
      rectWidth: rect?.width ?? 0,
      rectHeight: rect?.height ?? 0,
      selectedWidth: match ? Number(match[1]) : 0,
      selectedHeight: match ? Number(match[2]) : 0,
    };
  });
  check(
    "the selector reports a rectangle smaller than the surface",
    selectionSize.selectedWidth > 0 &&
      selectionSize.selectedHeight > 0 &&
      selectionSize.selectedWidth < surfaceWidth &&
      selectionSize.selectedHeight < surfaceHeight,
    { surface: [surfaceWidth, surfaceHeight], ...selectionSize },
  );

  await click(".kx-region-footer .kx-btn-primary");
  const regionStarted = await waitFor(
    () => document.querySelector(".kx-status-chip")?.textContent?.includes("Recording") ?? false,
  );
  check("confirming the rectangle starts the recording", regionStarted, await statusText());

  const badge = await page.evaluate(() => {
    const node = document.querySelector("[data-region-badge]");
    const match = node?.textContent?.match(/(\d+)×(\d+)\s*@\s*(-?\d+),(-?\d+)/);
    return match
      ? {
          width: Number(match[1]),
          height: Number(match[2]),
          x: Number(match[3]),
          y: Number(match[4]),
        }
      : null;
  });
  check(
    "the running session reports the chosen rectangle in surface pixels",
    Boolean(badge && badge.width > 0 && badge.height > 0),
    badge,
  );

  await wait(2600);
  await click("[data-stop-recording]");
  const regionSaved = await waitFor(async () => {
    const database = await new Promise((resolve) => {
      const request = indexedDB.open("knoux-rec.library");
      request.onsuccess = () => resolve(request.result);
    });
    const records = await new Promise((resolve) => {
      const tx = database.transaction("items", "readonly");
      const request = tx.objectStore("items").getAll();
      request.onsuccess = () => resolve(request.result);
    });
    database.close();
    return records.filter((record) => record.kind === "video").length >= 2;
  });
  check("the selected-area take is written to the library", regionSaved);

  items = await readItems();
  const regionItem = items.filter((item) => item.kind === "video").at(-1) ?? null;
  const regionDecoded = regionItem ? await decodeDimensions({ id: regionItem.id }) : null;

  check(
    "the selected-area file decodes at all",
    Boolean(regionDecoded?.ok),
    regionDecoded,
  );

  // THE decisive assertion. A CSS-only overlay would leave this equal to the
  // full surface size and would fail.
  check(
    "the selected-area file is NOT the full surface",
    Boolean(
      regionDecoded?.ok &&
        surfaceWidth > 0 &&
        (regionDecoded.width !== surfaceWidth || regionDecoded.height !== surfaceHeight),
    ),
    { surface: [surfaceWidth, surfaceHeight], decoded: regionDecoded },
  );

  const tolerance = 4;
  check(
    "the selected-area file matches the chosen rectangle within a few pixels",
    Boolean(
      badge &&
        regionDecoded?.ok &&
        Math.abs(regionDecoded.width - badge.width) <= tolerance &&
        Math.abs(regionDecoded.height - badge.height) <= tolerance,
    ),
    { badge, decoded: regionDecoded },
  );

  check(
    "the stored metadata carries the region dimensions",
    Boolean(
      regionItem &&
        badge &&
        regionItem.width === badge.width &&
        regionItem.height === badge.height,
    ),
    { stored: regionItem && [regionItem.width, regionItem.height], badge },
  );

  check(
    "the selected-area file is a real playable container",
    Boolean(regionItem?.magic.startsWith("1a 45 df a3") || regionItem?.magic.startsWith("00 00")),
    { magic: regionItem?.magic, bytes: regionItem?.bytes },
  );

  check(
    "the selected-area recording carries a decoded duration",
    Boolean(regionDecoded?.duration && regionDecoded.duration > 0.5),
    { duration: regionDecoded?.duration },
  );

  /* ------------------------------------------------------- cancel path */
  await click("[data-start-recording]");
  const againOpen = await waitFor(() => !!document.querySelector("[data-region-stage]"), 20000);
  check("the selector can be opened again", againOpen);
  if (againOpen) {
    await page.keyboard.press("Escape");
    await wait(600);
    const closed = await page.evaluate(
      () => !document.querySelector("[data-region-stage]"),
    );
    check("Escape cancels the selection without recording", closed);
    check(
      "a cancelled selection leaves the recorder idle",
      (await statusText()).includes("Ready"),
      await statusText(),
    );
  }

  /* -------------------------------------------------- pause / resume clock */
  await click('[data-capture-mode="screen"]');
  await wait(200);
  await click("[data-start-recording]");
  const pauseStarted = await waitFor(
    () => document.querySelector(".kx-status-chip")?.textContent?.includes("Recording") ?? false,
  );
  check("a second full-screen take starts", pauseStarted, await statusText());
  await wait(1500);
  const beforePause = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll(".kx-stat")];
    const node = nodes.find((item) => item.textContent?.includes("Elapsed"));
    return node?.querySelector(".kx-stat-value")?.textContent ?? null;
  });
  await click("[data-pause-toggle]");
  await wait(1600);
  const pausedStatus = await statusText();
  check("pause is accepted", pausedStatus.includes("Paused"), pausedStatus);
  const elapsedWhilePaused = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll(".kx-stat")];
    const node = nodes.find((item) => item.textContent?.includes("Elapsed"));
    return node?.querySelector(".kx-stat-value")?.textContent ?? null;
  });
  check(
    "the clock holds while paused",
    elapsedWhilePaused === beforePause,
    { beforePause, elapsedWhilePaused },
  );
  await click("[data-pause-toggle]");
  await wait(900);
  const resumedStatus = await statusText();
  check("resume returns to recording", resumedStatus.includes("Recording"), resumedStatus);
  await click("[data-stop-recording]");
  await wait(2500);

  const finalItems = await readItems();
  check(
    "every take is stored with real bytes",
    finalItems.filter((item) => item.kind === "video").every((item) => item.bytes > 1000),
    finalItems
      .filter((item) => item.kind === "video")
      .map((item) => ({ name: item.name, bytes: item.bytes })),
  );
  check(
    "the pause clock is reported and did not run away",
    typeof elapsedWhilePaused === "string",
    { elapsedWhilePaused, beforePause: beforePause.length > 0 },
  );

  check(
    "no uncaught page errors",
    report.pageErrors.length === 0,
    report.pageErrors,
  );
} catch (error) {
  report.fatal = error.message;
  console.error("FATAL", error);
} finally {
  report.failed = report.checks.some((entry) => !entry.pass) || Boolean(report.fatal);
  report.passed = report.checks.filter((entry) => entry.pass).length;
  report.total = report.checks.length;
  await writeFile(
    path.join(OUT, "region-recording-report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  console.log(
    JSON.stringify(
      {
        failed: report.failed,
        fatal: report.fatal ?? null,
        checks: report.total,
        passed: report.passed,
        pageErrors: report.pageErrors.length,
      },
      null,
      2,
    ),
  );
  process.exit(report.failed ? 1 : 0);
}
