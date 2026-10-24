#!/usr/bin/env node
/**
 * KNOUX REC — Audio Studio smoke.
 *
 * Generates real PCM WAV fixtures in Node, drives the workspace in Chromium and
 * measures what comes back: decoded rate and duration, painted waveform energy,
 * real playback position, the effect of each operation on the rendered samples,
 * silence detection, splitting, library persistence and exported file bytes.
 */

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.KNOUX_BASE_URL ?? "http://localhost:4173/";
const OUT = path.resolve("artifacts/evidence/audio-studio");
const DOWNLOADS = path.join(OUT, "downloads");
const CHROME =
  process.env.KNOUX_CHROME ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const RATE = 8000;
const TONE = path.join(OUT, "tone.wav");
const WRONG_FILE = path.join(OUT, "notes.txt");

/* ------------------------------------------------------------------ */
/* Fixtures: real 16-bit PCM WAV                                       */
/* ------------------------------------------------------------------ */

function wav(samples, sampleRate = RATE) {
  const frames = samples.length;
  const buffer = Buffer.alloc(44 + frames * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + frames * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(frames * 2, 40);
  for (let index = 0; index < frames; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    buffer.writeInt16LE(Math.round(value * 32767), 44 + index * 2);
  }
  return buffer;
}

/** 0.5s of 440 Hz tone, 0.5s of digital silence, then 1s of tone again. */
function toneWithGap() {
  const out = new Float32Array(RATE * 2);
  for (let index = 0; index < out.length; index += 1) {
    const seconds = index / RATE;
    const quiet = seconds >= 0.5 && seconds < 1;
    out[index] = quiet ? 0 : 0.7 * Math.sin(2 * Math.PI * 440 * seconds);
  }
  return out;
}

await rm(OUT, { recursive: true, force: true });
await mkdir(DOWNLOADS, { recursive: true });
await writeFile(TONE, wav(toneWithGap()));
await writeFile(WRONG_FILE, "not audio at all\n", "utf8");

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

/** Painted waveform energy: the green channel sums the yellow bars. */
function waveEnergy(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector(".kx-audio-canvas");
    if (!canvas) return null;
    const data = canvas
      .getContext("2d", { willReadFrequently: true })
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    let hash = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += data[i + 1];
      hash = (hash * 31 + data[i] + data[i + 1] * 3 + data[i + 2] * 7) % 2147483647;
    }
    return { sum, hash, pixels: data.length / 4 };
  });
}

function headerText(page) {
  return page.evaluate(
    () =>
      document.querySelector(".kx-audio-stage-card .kx-mono.kx-muted")?.textContent?.trim() ??
      "",
  );
}

async function click(page, selector) {
  const done = await page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (!element || element.disabled) return false;
    element.click();
    return true;
  }, selector);
  if (!done) throw new Error(`Control unavailable: ${selector}`);
  await sleep(500);
}

async function setSlider(page, sliderKey, value) {
  const done = await page.evaluate(
    ({ key, next }) => {
      const input = document.querySelector(`.kx-audio-inspector input[data-slider="${key}"]`);
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      ).set;
      setter.call(input, String(next));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    { key: sliderKey, next: value },
  );
  if (!done) throw new Error(`Slider not found: ${sliderKey}`);
  await sleep(450);
}

async function upload(page, file) {
  const input = await page.waitForSelector('input[type="file"]', { visible: false });
  await input.uploadFile(file);
  await sleep(1600);
}

async function waitForDownload(folder, extension) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const files = (await readdir(folder)).filter((name) => name.endsWith(extension));
    if (files.length) return path.join(folder, files[0]);
    await sleep(300);
  }
  return null;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--autoplay-policy=no-user-gesture-required",
    "--window-size=1600,1050",
    "--no-first-run",
  ],
  defaultViewport: { width: 1600, height: 1050 },
});

try {
  const page = await browser.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => report.pageErrors.push(String(error)));

  const cdp = await page.createCDPSession();
  await cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DOWNLOADS });

  await page.goto(`${BASE}?nc=${Date.now()}#/audio-studio`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".kx-audio", { timeout: 30000 });
  await sleep(700);

  check("the studio opens on an empty state", await page.evaluate(() => Boolean(document.querySelector(".kx-audio-hero"))));
  const honesty = await page.evaluate(
    () => document.querySelector(".kx-notice[data-tone='info']")?.textContent ?? "",
  );
  check(
    "the runtime's real codec support is stated up front",
    /WAV/.test(honesty) && /WebM\/Opus/.test(honesty) && /MP3/.test(honesty),
    honesty.replace(/\s+/g, " ").slice(0, 160),
  );

  /* ------------------------------------------------------------ load */
  await upload(page, TONE);
  await page.waitForSelector(".kx-audio-canvas", { timeout: 20000 });
  await sleep(900);
  const loadedHeader = await headerText(page);
  check(
    "the WAV decodes at its real rate and duration",
    /1ch/.test(loadedHeader) && /8000 Hz/.test(loadedHeader) && /2\.00s/.test(loadedHeader),
    loadedHeader,
  );
  const loadedEnergy = await waveEnergy(page);
  check("the waveform is painted from the samples", Boolean(loadedEnergy && loadedEnergy.sum > 10000), loadedEnergy);
  await shot(page, "01-loaded");

  /* -------------------------------------------------------- playback */
  const beforePlay = await page.evaluate(
    () => document.querySelector("[data-playhead]")?.textContent ?? "",
  );
  await click(page, '[data-action="play"]');
  await sleep(900);
  const duringPlay = await page.evaluate(() => {
    const element = document.querySelector(".kx-audio-element");
    return {
      currentTime: element?.currentTime ?? 0,
      paused: element?.paused ?? true,
      label: document.querySelector("[data-playhead]")?.textContent ?? "",
    };
  });
  await click(page, '[data-action="stop"]');
  check(
    "playback runs on the real decoded audio",
    duringPlay.currentTime > 0.15 && duringPlay.paused === false,
    { beforePlay, duringPlay },
  );
  check(
    "the playhead label follows the media position",
    parseFloat((duringPlay.label.match(/([\d.]+)\s*\//) ?? [])[1] ?? "0") > 0.15,
    duringPlay.label,
  );
  const stopped = await page.evaluate(
    () => document.querySelector(".kx-audio-element")?.currentTime ?? -1,
  );
  check("stop rewinds the element", Math.abs(stopped) < 0.05, stopped);

  /* -------------------------------------------------------- silence */
  // Scanned on the untouched fixture: 0.5s of digital silence sits between the
  // two tone bursts, so the detector has something definite to find.
  await click(page, '[data-action="scan"]');
  await sleep(900);
  const silence = await page.evaluate(() => ({
    rows: document.querySelectorAll("[data-silence-interval]").length,
    report: document.querySelector(".kx-audio-silence .kx-muted")?.textContent ?? "",
    first: document.querySelector("[data-silence-interval] span")?.textContent ?? "",
  }));
  check("the silence scan finds the quiet gap", silence.rows === 1, silence);
  // detectSilence reports on 20 ms RMS window boundaries, so the interval is
  // allowed to sit within one window of the fixture's true 0.50s–1.00s gap.
  const gap = (silence.first.match(/([\d.]+)s\s*→\s*([\d.]+)s/) ?? []).slice(1).map(Number);
  check(
    "the detected interval matches the fixture within one RMS window",
    gap.length === 2 && Math.abs(gap[0] - 0.5) <= 0.021 && Math.abs(gap[1] - 1.0) <= 0.021,
    { parsed: gap, raw: silence.first },
  );
  check("the silence report states its share", /2[0-9]\.\d%/.test(silence.report), silence.report);
  await click(page, "[data-silence-interval] .kx-btn");
  const selectedGap = await page.evaluate(
    () => document.querySelector("[data-selection]")?.textContent ?? "",
  );
  const selectedPair = (selectedGap.match(/([\d.]+)s\s*→\s*([\d.]+)s/) ?? []).slice(1).map(Number);
  check(
    "an interval can be selected from the report",
    selectedPair.length === 2 &&
      Math.abs(selectedPair[0] - gap[0]) < 0.001 &&
      Math.abs(selectedPair[1] - gap[1]) < 0.001,
    { selectedPair, gap, selectedGap },
  );
  await click(page, '[data-operation-id="cut-silence"]');
  await sleep(1400);
  const cutHeader = await headerText(page);
  check(
    "cutting silence removes those samples",
    Number((cutHeader.match(/([\d.]+)s/) ?? [])[1] ?? 9) < 1.6,
    cutHeader,
  );
  await click(page, ".kx-audio-actions .kx-btn:nth-child(3)");
  await sleep(1200);
  const clearedHeader = await headerText(page);
  check("clearing the steps returns the full source", /2\.00s/.test(clearedHeader), clearedHeader);

  /* ------------------------------------------------------- selection */
  const box = await page.evaluate(() => {
    const rect = document.querySelector(".kx-audio-canvas").getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await sleep(400);
  const selectionLabel = await page.evaluate(
    () => document.querySelector("[data-selection]")?.textContent ?? "",
  );
  const fromMatch = Number((selectionLabel.match(/([\d.]+)s\s*→/) ?? [])[1] ?? -1);
  const toMatch = Number((selectionLabel.match(/→\s*([\d.]+)s/) ?? [])[1] ?? -1);
  check(
    "dragging selects a region in real seconds",
    Math.abs(fromMatch - 0.2) < 0.06 && Math.abs(toMatch - 0.7) < 0.06,
    { selectionLabel, fromMatch, toMatch },
  );

  /* ----------------------------------------------------------- trim */
  await click(page, '[data-operation-id="trim"]');
  await sleep(1200);
  const trimmedHeader = await headerText(page);
  const trimmedSeconds = Number((trimmedHeader.match(/([\d.]+)s/) ?? [])[1] ?? 0);
  check(
    "trim to selection shortens the working audio",
    trimmedSeconds > 0.4 && trimmedSeconds < 0.6,
    { trimmedHeader, expected: "≈0.50s" },
  );
  check("the trim registers one step", (await page.evaluate(() => document.querySelectorAll(".kx-audio-step").length)) === 1);

  const trimmedEnergy = await waveEnergy(page);
  check(
    "the waveform redraws for the trimmed result",
    Boolean(trimmedEnergy && trimmedEnergy.hash !== loadedEnergy.hash),
    { before: loadedEnergy.hash, after: trimmedEnergy.hash },
  );

  /* ----------------------------------------------------- undo/redo */
  await click(page, ".kx-audio-actions .kx-btn:nth-child(1)");
  await sleep(1000);
  const undoneHeader = await headerText(page);
  check("undo restores the full duration", /2\.00s/.test(undoneHeader), undoneHeader);
  await click(page, ".kx-audio-actions .kx-btn:nth-child(2)");
  await sleep(1000);
  const redoneHeader = await headerText(page);
  check("redo re-applies the trim", Number((redoneHeader.match(/([\d.]+)s/) ?? [])[1] ?? 9) < 0.6, redoneHeader);

  /* ------------------------------------------------------------ gain */
  await click(page, '[data-group="edit"]');
  await click(page, '[data-operation-id="trim"]');
  await sleep(900);
  const baseEnergy = await waveEnergy(page);
  await click(page, '[data-group="level"]');
  await click(page, '[data-operation-id="gain"]');
  await sleep(1100);
  const gainedEnergy = await waveEnergy(page);
  check(
    "gain raises the rendered sample energy",
    Boolean(gainedEnergy && gainedEnergy.sum > baseEnergy.sum),
    { base: baseEnergy.sum, gained: gainedEnergy.sum },
  );
  await click(page, ".kx-audio-steps li:last-child .kx-audio-step");
  await setSlider(page, "audio.field.db", -18);
  const quietEnergy = await waveEnergy(page);
  check(
    "retuning the gain step re-renders immediately",
    Boolean(quietEnergy && quietEnergy.sum < baseEnergy.sum),
    { base: baseEnergy.sum, quiet: quietEnergy.sum },
  );

  /* ------------------------------------------------------- normalise */
  await click(page, '[data-group="level"]');
  await click(page, '[data-operation-id="normalise"]');
  await sleep(1200);
  const levelledEnergy = await waveEnergy(page);
  check(
    "peak normalisation recovers the loudness",
    Boolean(levelledEnergy && levelledEnergy.sum > quietEnergy.sum * 1.5),
    { quiet: quietEnergy.sum, levelled: levelledEnergy.sum },
  );
  const statsText = await page.evaluate(
    () => document.querySelector(".kx-audio-stats")?.textContent?.replace(/\s+/g, " ") ?? "",
  );
  check(
    "the reported peak sits near the normalisation target",
    /-1\.\d dBFS|0\.0 dBFS|-0\.\d dBFS/.test(statsText),
    statsText.slice(0, 160),
  );

  /* --------------------------------------------------------- reverse */
  await click(page, '[data-group="shape"]');
  await click(page, '[data-operation-id="reverse"]');
  await sleep(1100);
  const reversed = await waveEnergy(page);
  await click(page, '[data-operation-id="reverse"]');
  await sleep(1100);
  const doubleReversed = await waveEnergy(page);
  check(
    "reversing changes the samples",
    Boolean(reversed && reversed.hash !== levelledEnergy.hash),
    { levelled: levelledEnergy.hash, reversed: reversed.hash },
  );
  check(
    "reversing twice returns the original waveform",
    Boolean(doubleReversed && doubleReversed.hash === levelledEnergy.hash),
    { levelled: levelledEnergy.hash, doubleReversed: doubleReversed.hash },
  );

  /* -------------------------------------------------------- channels */
  await click(page, '[data-operation-id="stereo"]');
  await sleep(1100);
  const stereoHeader = await headerText(page);
  check("converting to stereo reports two channels", /2ch/.test(stereoHeader), stereoHeader);

  /* ---------------------------------------------------------- filter */
  await click(page, '[data-group="tone"]');
  await click(page, '[data-operation-id="lowpass"]');
  await sleep(1600);
  const filtered = await waveEnergy(page);
  const filterStep = await page.evaluate(
    () => document.querySelector(".kx-audio-step[aria-pressed='true']")?.textContent ?? null,
  );
  check("the low-pass step is added and selected", /Filter|مرش/.test(filterStep ?? ""), filterStep);
  await click(page, ".kx-audio-inspector input[data-slider='audio.field.frequency']");
  await setSlider(page, "audio.field.frequency", 60);
  const heavilyFiltered = await waveEnergy(page);
  check(
    "a real biquad attenuates the 440 Hz tone",
    Boolean(heavilyFiltered && heavilyFiltered.sum < filtered.sum * 0.75),
    { at1200Hz: filtered.sum, at60Hz: heavilyFiltered.sum },
  );

  /* ---------------------------------------------------------- split */
  await page.evaluate(() => {
    const canvas = document.querySelector(".kx-audio-canvas");
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        clientX: rect.left + rect.width * 0.5,
        clientY: rect.top + rect.height / 2,
      }),
    );
    canvas.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
  await sleep(400);
  await click(page, '[data-action="split"]');
  await sleep(700);
  const segments = await page.evaluate(() =>
    [...document.querySelectorAll(".kx-audio-segment")].map((node) => node.textContent ?? ""),
  );
  check("splitting at the playhead yields two segments", segments.length === 2, segments);

  /* ----------------------------------------------------------- save */
  const saved = await (async () => {
    await click(page, '[data-action="save"]');
    await sleep(2200);
    return page.evaluate(
      () =>
        new Promise((resolve) => {
          const open = indexedDB.open("knoux-rec.library");
          open.onerror = () => resolve(null);
          open.onsuccess = () => {
            const request = open.result
              .transaction("items", "readonly")
              .objectStore("items")
              .getAll();
            request.onerror = () => resolve(null);
            request.onsuccess = async () => {
              const items = (request.result ?? []).filter((item) => item.kind === "audio");
              const latest = items[items.length - 1];
              if (!latest) return resolve(null);
              const head = new Uint8Array(await latest.blob.slice(0, 12).arrayBuffer());
              resolve({
                name: latest.name,
                mime: latest.mimeType,
                bytes: latest.blob.size,
                duration: latest.duration,
                magic: String.fromCharCode(...head.subarray(0, 4)) +
                  "/" +
                  String.fromCharCode(...head.subarray(8, 12)),
              });
            };
          };
        }),
    );
  })();
  check(
    "the studio saves a playable WAV into the library",
    Boolean(
      saved &&
        saved.magic === "RIFF/WAVE" &&
        saved.bytes > 1000 &&
        saved.duration > 0.2 &&
        /-studio\.wav$/.test(saved.name),
    ),
    saved,
  );

  /* --------------------------------------------------------- export */
  await click(page, '[data-action="export"]');
  const download = await waitForDownload(DOWNLOADS, ".wav");
  check("export writes a WAV file", Boolean(download), download);
  if (download) {
    const bytes = await readFile(download);
    check(
      "the exported file is a real RIFF/WAVE container",
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
        bytes.subarray(8, 12).toString("ascii") === "WAVE" &&
        bytes.readUInt16LE(22) === 2 &&
        bytes.length > 1000,
      {
        channels: bytes.readUInt16LE(22),
        sampleRate: bytes.readUInt32LE(24),
        bytes: bytes.length,
      },
    );
    check(
      "the exported bytes match the measured output size",
      saved && Math.abs(bytes.length - saved.bytes) < 8,
      { exported: bytes.length, stored: saved?.bytes },
    );
  }

  /* ---------------------------------------------------- webm honesty */
  const webmState = await page.evaluate(() => {
    const button = document.querySelector('[data-format="webm"]');
    return { disabled: button?.disabled ?? null, title: button?.title ?? "" };
  });
  const honestyLine = await page.evaluate(
    () => document.querySelector(".kx-notice[data-tone='info']")?.textContent ?? "",
  );
  const claimsWebm = /WebM\/Opus ✓/.test(honestyLine);
  check(
    "the WebM control agrees with the probed runtime support",
    claimsWebm ? webmState.disabled === false : webmState.disabled === true,
    { claimsWebm, webmState },
  );

  /* ------------------------------------------------------ error path */
  const beforeBad = await headerText(page);
  await upload(page, WRONG_FILE);
  const badError = await page.evaluate(
    () => document.querySelector(".kx-notice[data-tone='danger']")?.textContent ?? "",
  );
  const afterBad = await headerText(page);
  check("a non-audio file is refused with a message", /not recognised as audio/i.test(badError), badError);
  check("the refused file leaves the session intact", beforeBad === afterBad, { beforeBad, afterBad });

  await shot(page, "02-workspace");

  /* ------------------------------------------------------------ RTL */
  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".kx-topbar button")].find(
      (element) => element.textContent?.trim() === "AR",
    );
    button?.click();
  });
  await sleep(1000);
  const rtl = await page.evaluate(() => ({
    dir: document.documentElement.dir,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    arabicOps: [...document.querySelectorAll(".kx-audio-op")].filter((node) =>
      /[؀-ۿ]/.test(node.textContent ?? ""),
    ).length,
    ops: document.querySelectorAll(".kx-audio-op").length,
    canvas: Boolean(document.querySelector(".kx-audio-canvas")),
  }));
  check("arabic: the studio renders RTL", rtl.dir === "rtl", rtl);
  check("arabic: operation labels are translated", rtl.arabicOps === rtl.ops && rtl.ops > 0, rtl);
  check("arabic: the workspace survives the switch", rtl.canvas, rtl);
  check("arabic: no horizontal overflow", rtl.overflow <= 0, rtl.overflow);
  await shot(page, "03-arabic-rtl");

  check("audio: no uncaught page errors", report.pageErrors.length === 0, report.pageErrors);
  check("audio: no console errors", report.consoleErrors.length === 0, report.consoleErrors.slice(0, 6));
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
