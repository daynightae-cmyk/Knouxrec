#!/usr/bin/env node
/**
 * KNOUX REC — standalone audio recording smoke.
 *
 * Proves the microphone-only session is a real recorder rather than a screen
 * recording with the picture hidden. Chromium's fake capture device feeds a
 * genuine tone into the pipeline, so every claim below is measured:
 *
 *   - the studio offers a fourth capture source and it asks for audio only,
 *   - no <video> element is created and no display surface is requested,
 *   - the level meter reads the live signal in dBFS, not an animation,
 *   - pause and resume hold the elapsed clock,
 *   - stopping saves an audio/* blob into IndexedDB with zero frame size,
 *   - the stored blob plays back and reports a real duration,
 *   - the dashboard quick action records a second take on its own,
 *   - the Arabic build renders the same session without overflow or errors.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.KNOUX_BASE_URL ?? "http://localhost:4173/";
const OUT = path.resolve("artifacts/evidence/audio-recording");
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
}

const clickByText = (page, selector, text) =>
  page.evaluate(
    (sel, needle) => {
      const element = [...document.querySelectorAll(sel)].find((node) =>
        node.textContent?.trim().includes(needle),
      );
      if (!element) return false;
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return true;
    },
    selector,
    text,
  );

const waitFor = async (page, fn, timeout = 25000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await page.evaluate(fn)) return true;
    await sleep(250);
  }
  return false;
};

const readAudioItems = (page) =>
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
    const audio = records.filter((record) => record.kind === "audio");
    // Decode the stored bytes with the audio pipeline itself: a file that
    // plays but carries silence would still pass a duration check, and the
    // point of a voice memo is that it contains the voice.
    const levelOf = async (record) => {
      try {
        const bytes = await record.blob.arrayBuffer();
        const context = new AudioContext();
        const decoded = await context.decodeAudioData(bytes.slice(0));
        const channel = decoded.getChannelData(0);
        let peak = 0;
        let sum = 0;
        for (let index = 0; index < channel.length; index += 1) {
          const value = Math.abs(channel[index]);
          if (value > peak) peak = value;
          sum += value * value;
        }
        await context.close();
        return {
          peak,
          rms: Math.sqrt(sum / Math.max(1, channel.length)),
          seconds: decoded.duration,
          sampleRate: decoded.sampleRate,
        };
      } catch (error) {
        return { error: String(error) };
      }
    };
    const measured = await Promise.all(audio.map(levelOf));
    const decoded = await Promise.all(
      audio.map(
        (record) =>
          new Promise((resolve) => {
            const url = URL.createObjectURL(record.blob);
            const media = document.createElement("audio");
            const timer = window.setTimeout(() => {
              URL.revokeObjectURL(url);
              resolve({ name: record.name, playable: false, duration: null });
            }, 8000);
            media.preload = "metadata";
            media.onloadedmetadata = () => {
              window.clearTimeout(timer);
              const value = media.duration;
              URL.revokeObjectURL(url);
              resolve({
                name: record.name,
                playable: true,
                duration: Number.isFinite(value) ? value : null,
                infinite: value === Infinity,
              });
            };
            media.onerror = () => {
              window.clearTimeout(timer);
              URL.revokeObjectURL(url);
              resolve({ name: record.name, playable: false, duration: null });
            };
            media.src = url;
          }),
      ),
    );
    return {
      items: audio.map((record) => ({
        id: record.id,
        name: record.name,
        mimeType: record.mimeType,
        size: record.blob?.size ?? 0,
        duration: record.duration,
        width: record.width,
        height: record.height,
        source: record.source,
        hasThumbnail: Boolean(record.thumbnail),
      })),
      decoded,
      measured,
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

  await page.goto(`${BASE}?intro=hold#/studio`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".kx-splash-skip", { timeout: 20000 });
  await page.click(".kx-splash-skip");
  await page.waitForFunction(() => !document.querySelector(".kx-splash"));
  await sleep(700);

  /* ------------------------------------------------- the fourth source */
  const sources = await page.evaluate(() =>
    [...document.querySelectorAll("[data-capture-mode]")].map((button) =>
      button.getAttribute("data-capture-mode"),
    ),
  );
  check(
    "studio: the capture source list offers microphone only",
    sources.includes("audio") && sources.length === 4,
    sources,
  );

  await page.evaluate(() => {
    document.querySelector('[data-capture-mode="audio"]')?.click();
  });
  await sleep(400);
  const panel = await page.evaluate(() => ({
    pressed: document.querySelector('[data-capture-mode="audio"]')?.getAttribute("aria-pressed"),
    picker: Boolean(document.querySelector("[data-microphone-picker]")),
    select: document.querySelector("[data-microphone-picker] select")?.options.length ?? 0,
    note: document.querySelector("[data-capture-modes]")?.parentElement?.textContent ?? "",
  }));
  check("studio: selecting it reveals the microphone picker", panel.pressed === "true" && panel.picker, panel);
  check(
    "studio: the note says plainly that no display surface is requested",
    /no display surface|لا تُطلب/i.test(panel.note),
    panel.note.slice(0, 120),
  );

  /* --------------------------------------------------------- recording */
  await clickByText(page, ".kx-btn", "Start recording");
  const live = await waitFor(page, () => Boolean(document.querySelector("[data-audio-session]")));
  const alert = await page.evaluate(
    () => document.querySelector('[role="alert"]')?.textContent?.trim() ?? null,
  );
  check("audio: the session starts", live, alert);

  // Chromium's fake capture device emits a beeping tone, so a reading of the
  // instantaneous level can legitimately land in a gap. The meter holds the
  // loudest moment of the take, and that is what is asserted — after waiting
  // for the source to actually make a sound.
  const signalSeen = await waitFor(page, () => {
    const node = document.querySelector("[data-level-max]");
    return Boolean(node && !/∞/.test(node.textContent ?? ""));
  }, 20000);
  const surface = await page.evaluate(() => ({
    video: Boolean(document.querySelector(".kx-preview video")),
    meter: Boolean(document.querySelector("[data-level-meter]")),
    canvas: Boolean(document.querySelector(".kx-meter-canvas")),
    dB: document.querySelector("[data-level-dB]")?.textContent?.trim() ?? "",
    max: document.querySelector("[data-level-max]")?.textContent?.trim() ?? "",
    frames: Number(document.querySelector("[data-level-frames]")?.getAttribute("data-level-frames") ?? 0),
    flag: document.querySelector("[data-level-clip]")?.getAttribute("data-level-clip") ?? "",
    role: document.querySelector(".kx-meter-track")?.getAttribute("role") ?? "",
  }));
  check(
    "audio: no video surface is invented for a microphone take",
    surface.video === false && surface.meter && surface.canvas,
    surface,
  );
  const loudest = Number((surface.max.match(/-?\d+(\.\d+)?/) ?? ["-999"])[0]);
  check(
    "audio: the meter samples the live signal and holds its loudest moment",
    signalSeen && surface.frames > 5 && loudest > -60 && loudest <= 0,
    { signalSeen, frames: surface.frames, loudest: surface.max, current: surface.dB },
  );
  check("audio: the meter is exposed as a meter role", surface.role === "meter", surface.role);
  await shot(page, "01-audio-session");

  const firstReading = await page.evaluate(
    () => document.querySelector(".kx-stat-value time, .kx-preview-overlay time")?.textContent ?? "",
  );
  await sleep(2200);
  const secondReading = await page.evaluate(
    () => document.querySelector(".kx-stat-value time, .kx-preview-overlay time")?.textContent ?? "",
  );
  const elapsed = await page.evaluate(() => {
    const [value] = [...document.querySelectorAll(".kx-stat")]
      .map((card) => card.textContent ?? "")
      .filter((text) => /\d{2}:\d{2}/.test(text));
    return value ?? "";
  });
  check(
    "audio: the elapsed clock advances while the microphone is open",
    /00:0[2-9]|00:[1-9]\d/.test(elapsed) && secondReading !== firstReading,
    { firstReading, secondReading, elapsed },
  );

  const framesBefore = await page.evaluate(
    () => Number(document.querySelector("[data-level-frames]")?.getAttribute("data-level-frames") ?? 0),
  );
  await sleep(900);
  const framesAfter = await page.evaluate(
    () => Number(document.querySelector("[data-level-frames]")?.getAttribute("data-level-frames") ?? 0),
  );
  check(
    "audio: the meter keeps sampling while the session runs",
    framesAfter > framesBefore + 3,
    { framesBefore, framesAfter },
  );

  /* ------------------------------------------------------ pause, resume */
  const paused = await clickByText(page, ".kx-btn", "Pause");
  await sleep(600);
  const pausedState = await page.evaluate(() => ({
    status: document.querySelector(".kx-status-chip")?.textContent?.trim() ?? "",
    recorder: document.querySelector("[data-audio-session]") !== null,
  }));
  const pausedClock = await page.evaluate(
    () => document.querySelector(".kx-preview-overlay time")?.textContent ?? "",
  );
  await sleep(1200);
  const pausedClockLater = await page.evaluate(
    () => document.querySelector(".kx-preview-overlay time")?.textContent ?? "",
  );
  check(
    "audio: pause is honoured and the elapsed clock holds",
    paused && /Paused|متوقف/i.test(pausedState.status) && pausedClock === pausedClockLater,
    { pausedState, pausedClock, pausedClockLater },
  );

  const resumed = await clickByText(page, ".kx-btn", "Resume");
  await sleep(700);
  const resumedStatus = await page.evaluate(
    () => document.querySelector(".kx-status-chip")?.textContent?.trim() ?? "",
  );
  check(
    "audio: resume returns to recording",
    resumed && /Recording|جارٍ التسجيل|يُسجَّل/i.test(resumedStatus),
    resumedStatus,
  );

  /* ------------------------------------------------------------- stop */
  await clickByText(page, ".kx-btn", "Stop");
  const idle = await waitFor(page, () => {
    const chip = document.querySelector(".kx-status-chip")?.textContent?.trim() ?? "";
    return /Ready|جاهز/i.test(chip) && !document.querySelector("[data-audio-session]");
  });
  check("audio: stopping returns the studio to Ready", idle, await page.evaluate(
    () => document.querySelector(".kx-status-chip")?.textContent?.trim() ?? "",
  ));

  const stored = await readAudioItems(page);
  const take = stored.items[stored.items.length - 1] ?? null;
  check("audio: the library holds an audio item", Boolean(take), stored.items);
  check(
    "audio: the recorded take is a real container with bytes",
    Boolean(take && take.size > 1000 && /^audio\//.test(take.mimeType)),
    take,
  );
  check(
    "audio: an audio take declares no frame size and no fake thumbnail",
    Boolean(take && take.width === 0 && take.height === 0 && take.hasThumbnail === false),
    take,
  );
  check(
    "audio: the recorded duration is measured, not zero",
    Boolean(take && take.duration > 1),
    take,
  );
  const playable = stored.decoded[stored.decoded.length - 1] ?? null;
  check(
    "audio: the stored blob plays back and reports a duration",
    Boolean(playable?.playable && (playable.duration > 1 || playable.infinite)),
    playable,
  );
  const signal = stored.measured[stored.measured.length - 1] ?? null;
  check(
    "audio: the encoded take really contains audio, decoded and measured",
    Boolean(signal && !signal.error && signal.peak > 0.005 && signal.seconds > 1),
    signal,
  );
  report.storage = { stored, playable, signal };

  /* ------------------------------------------------------- scheduling */
  await page.evaluate(() => {
    document.querySelector('[data-capture-mode="audio"]')?.click();
  });
  await sleep(300);
  const delayButtons = await page.evaluate(() =>
    [...document.querySelectorAll("[data-delay]")].map((node) => node.getAttribute("data-delay")),
  );
  check("schedule: the studio offers short start delays", delayButtons.length === 4, delayButtons);

  await page.evaluate(() => document.querySelector('[data-delay="3"]')?.click());
  await page.evaluate(() => document.querySelector("[data-schedule-start]")?.click());
  await sleep(600);
  const scheduled = await page.evaluate(() => {
    const node = document.querySelector("[data-schedule-countdown]");
    return {
      shown: Boolean(node),
      remaining: Number(node?.getAttribute("data-remaining") ?? -1),
      session: Boolean(document.querySelector("[data-audio-session]")),
    };
  });
  check(
    "schedule: a countdown is armed and nothing records yet",
    scheduled.shown && scheduled.remaining > 0 && scheduled.session === false,
    scheduled,
  );

  await sleep(1200);
  const counting = await page.evaluate(() => {
    const node = document.querySelector("[data-schedule-countdown]");
    return {
      remaining: Number(node?.getAttribute("data-remaining") ?? -1),
      session: Boolean(document.querySelector("[data-audio-session]")),
    };
  });
  check(
    "schedule: the countdown decreases and still holds the session back",
    counting.remaining < scheduled.remaining && counting.session === false,
    { scheduled: scheduled.remaining, counting },
  );

  const fired = await waitFor(
    page,
    () => Boolean(document.querySelector("[data-audio-session]")),
    15000,
  );
  const firedState = await page.evaluate(() => ({
    session: Boolean(document.querySelector("[data-audio-session]")),
    countdown: Boolean(document.querySelector("[data-schedule-countdown]")),
  }));
  check(
    "schedule: the timer starts the source on its own and clears itself",
    fired && firedState.session && firedState.countdown === false,
    firedState,
  );
  await sleep(1200);
  await clickByText(page, ".kx-btn", "Stop");
  await waitFor(page, () => !document.querySelector("[data-audio-session]"), 30000);

  // Cancelling has to leave nothing behind: no countdown and no session.
  await page.evaluate(() => document.querySelector("[data-schedule-start]")?.click());
  await sleep(500);
  const armed = await page.evaluate(() => Boolean(document.querySelector("[data-schedule-countdown]")));
  await page.evaluate(() => document.querySelector("[data-schedule-cancel]")?.click());
  await sleep(4200);
  const cancelled = await page.evaluate(() => ({
    countdown: Boolean(document.querySelector("[data-schedule-countdown]")),
    session: Boolean(document.querySelector("[data-audio-session]")),
  }));
  check(
    "schedule: cancelling the countdown really prevents the recording",
    armed && !cancelled.countdown && !cancelled.session,
    { armed, cancelled },
  );

  /* ------------------------------------------------- dashboard action */
  await page.goto(`${BASE}#/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => Boolean(document.querySelector("[data-dashboard-audio]")),
    { timeout: 20000 },
  );
  await sleep(500);
  const dashboardButton = await page.evaluate(() => {
    const button = document.querySelector("[data-dashboard-audio]");
    return button ? button.getAttribute("data-dashboard-audio") : null;
  });
  check("dashboard: the standalone audio action is offered", dashboardButton === "start", dashboardButton);
  await page.evaluate(() => document.querySelector("[data-dashboard-audio]")?.click());
  const dashboardLive = await waitFor(page, () =>
    Boolean(document.querySelector("[data-audio-session]")),
  );
  const dashboardMeter = await page.evaluate(() => ({
    max: document.querySelector("[data-level-max]")?.textContent?.trim() ?? "",
    frames: Number(document.querySelector("[data-level-frames]")?.getAttribute("data-level-frames") ?? 0),
    stopLabel: document.querySelector("[data-dashboard-audio]")?.textContent?.trim() ?? "",
  }));
  check("dashboard: the take records from the command centre", dashboardLive, dashboardMeter);
  check(
    "dashboard: the action turns into a stop with the running clock",
    /Stop|إيقاف/i.test(dashboardMeter.stopLabel) && dashboardMeter.frames > 3,
    dashboardMeter,
  );
  await sleep(1800);
  await page.evaluate(() => document.querySelector("[data-dashboard-audio]")?.click());
  const dashboardIdle = await waitFor(page, () => !document.querySelector("[data-audio-session]"));
  check("dashboard: stopping the memo returns the page to idle", dashboardIdle);

  const afterDashboard = await readAudioItems(page);
  check(
    "dashboard: the memo is archived beside the studio take",
    afterDashboard.items.length >= 2 &&
      afterDashboard.items.every((item) => item.source === "recording"),
    afterDashboard.items.map((item) => ({ name: item.name, size: item.size })),
  );

  /* --------------------------------------------------------- Arabic */
  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".kx-topbar button")].find(
      (element) => element.textContent?.trim() === "AR",
    );
    button?.click();
  });
  await sleep(900);
  await page.goto(`${BASE}#/studio`, { waitUntil: "domcontentloaded" });
  const rtlReady = await waitFor(
    page,
    () => document.querySelectorAll("[data-capture-mode]").length === 4,
    20000,
  );
  const rtl = await page.evaluate(() => ({
    dir: document.documentElement.dir,
    lang: document.documentElement.lang,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    sources: [...document.querySelectorAll("[data-capture-mode]")].map((button) =>
      button.textContent?.trim() ?? "",
    ),
    rawKeys: /studio\.[a-zA-Z]|rec\.[a-zA-Z]|dashboard\.[a-zA-Z]/.test(
      document.querySelector(".kx-content")?.textContent ?? "",
    ),
  }));
  check(
    "arabic: the studio lists the microphone source in Arabic",
    rtlReady && rtl.dir === "rtl" && rtl.sources.length === 4 && /ميكروفون/.test(rtl.sources.join(" ")),
    rtl,
  );
  check("arabic: no translation key leaks into the studio", rtl.rawKeys === false, rtl);
  check("arabic: no horizontal overflow with the audio controls", rtl.overflow <= 0, rtl.overflow);

  // Start one last take in Arabic and read the meter back, so the specialised
  // surface is proven in the right-to-left build too.
  await page.evaluate(() => {
    document.querySelector('[data-capture-mode="audio"]')?.click();
  });
  await sleep(300);
  await clickByText(page, ".kx-btn", "بدء");
  const arabicLive = await waitFor(page, () => Boolean(document.querySelector("[data-audio-session]")), 15000);
  const arabicSignal = await waitFor(page, () => {
    const node = document.querySelector("[data-level-max]");
    return Boolean(node && !/∞/.test(node.textContent ?? ""));
  }, 20000);
  const arabicMeter = await page.evaluate(() => ({
    max: document.querySelector("[data-level-max]")?.textContent?.trim() ?? "",
    frames: Number(document.querySelector("[data-level-frames]")?.getAttribute("data-level-frames") ?? 0),
    canvasWidth: document.querySelector(".kx-meter-canvas")?.width ?? 0,
    meterDir: getComputedStyle(document.querySelector(".kx-meter") ?? document.body).direction,
  }));
  check(
    "arabic: the Arabic studio records and meters",
    arabicLive &&
      arabicSignal &&
      arabicMeter.frames > 3 &&
      /-?\d/.test(arabicMeter.max) &&
      arabicMeter.canvasWidth > 0,
    arabicMeter,
  );
  await shot(page, "02-arabic-audio");
  // "إيقاف" alone would also match the pause button, so the stop control is
  // addressed by its full label.
  await clickByText(page, ".kx-btn", "إيقاف وحفظ");
  await sleep(1200);

  check("audio: no uncaught page errors", report.pageErrors.length === 0, report.pageErrors.slice(0, 4));
  check(
    "audio: no console errors",
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
