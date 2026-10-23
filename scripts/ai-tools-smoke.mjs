#!/usr/bin/env node
/**
 * Deterministic AI task smoke test.
 *
 * Exercises every task that claims to run without a neural model, in a real
 * Chromium renderer, with real media generated inside the page:
 *
 *   - a 2 s WAV with two silent gaps,
 *   - a PNG with a hard edge and a gradient,
 *   - a 2.4 s WebM/VP9 video with three luminance-distinct scenes and motion,
 *   - a text file with a known SHA-256.
 *
 * For each task it verifies the produced preview, saves the media output to the
 * real IndexedDB library, reads the stored blob back, checks its magic bytes
 * and hashes, and downloads the export through Chrome's download manager.
 * It also verifies wrong-type and empty-file rejection, cancellation, and that
 * model-based tasks stay blocked.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.KNOUX_BASE_URL ?? "http://localhost:4173/";
const OUT = path.resolve("artifacts/evidence/ai-tools");
const DOWNLOADS = path.join(OUT, "downloads");
const CHROME =
  process.env.KNOUX_CHROME ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

await rm(DOWNLOADS, { recursive: true, force: true });
await mkdir(DOWNLOADS, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  base: BASE,
  checks: [],
  tasks: {},
  consoleErrors: [],
  pageErrors: [],
};

let failures = 0;

function check(name, pass, detail = null) {
  report.checks.push({ name, pass: Boolean(pass), detail });
  if (!pass) {
    failures += 1;
    console.error(`FAIL ${name}: ${JSON.stringify(detail)}`);
  } else {
    console.log(`PASS ${name}${detail === null ? "" : `: ${JSON.stringify(detail)}`}`);
  }
}

function runnerSelector(taskId) {
  return `.kx-ai-runner[data-task-id="${taskId}"]`;
}

async function clickInPage(selector) {
  await page.evaluate((target) => {
    const element = document.querySelector(target);
    if (!element) throw new Error(`click target not found: ${target}`);
    element.click();
  }, selector);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--autoplay-policy=no-user-gesture-required",
    "--window-size=1440,1100",
  ],
  defaultViewport: { width: 1440, height: 1100 },
});

let page;
try {
  page = await browser.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    report.pageErrors.push(error.stack ?? error.message);
  });

  const cdp = await page.createCDPSession();
  await cdp.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: DOWNLOADS,
  });

  await page.goto(`${BASE}#/offline-ai`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-ai-runtime-summary]", { timeout: 30000 });

  /* ------------------------------------------------------------- catalog */
  const catalog = await page.evaluate(() => ({
    local: Number(document.querySelector("[data-ai-local-count]")?.textContent),
    model: Number(document.querySelector("[data-ai-model-count]")?.textContent),
    rows: document.querySelectorAll(".kx-ai-row[data-task-id]").length,
    localRows: document.querySelectorAll('.kx-ai-row[data-runtime="local"]').length,
    modelRows: document.querySelectorAll('.kx-ai-row[data-runtime="model"]').length,
  }));
  report.catalog = catalog;
  check("catalog lists 38 canonical tasks", catalog.rows === 38, catalog.rows);
  check("15 tasks advertise a deterministic local runtime", catalog.local === 15 && catalog.localRows === 15, {
    summary: catalog.local,
    rows: catalog.localRows,
  });
  check("23 tasks remain model-blocked", catalog.model === 23 && catalog.modelRows === 23, {
    summary: catalog.model,
    rows: catalog.modelRows,
  });

  /* ------------------------------------------------------------ fixtures */
  const fixtures = await page.evaluate(async () => {
    function encodeWav(channels, sampleRate) {
      const channelCount = channels.length;
      const frames = channels[0].length;
      const buffer = new ArrayBuffer(44 + frames * channelCount * 2);
      const view = new DataView(buffer);
      const text = (offset, value) => {
        for (let index = 0; index < value.length; index += 1) {
          view.setUint8(offset + index, value.charCodeAt(index));
        }
      };
      text(0, "RIFF");
      view.setUint32(4, 36 + frames * channelCount * 2, true);
      text(8, "WAVE");
      text(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, channelCount, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * channelCount * 2, true);
      view.setUint16(32, channelCount * 2, true);
      view.setUint16(34, 16, true);
      text(36, "data");
      view.setUint32(40, frames * channelCount * 2, true);
      let offset = 44;
      for (let frame = 0; frame < frames; frame += 1) {
        for (let channel = 0; channel < channelCount; channel += 1) {
          const sample = Math.max(-1, Math.min(1, channels[channel][frame]));
          view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
          offset += 2;
        }
      }
      return new Uint8Array(buffer);
    }

    const sampleRate = 44100;
    const seconds = 2;
    const pcm = new Float32Array(sampleRate * seconds);
    for (let index = 0; index < pcm.length; index += 1) {
      const time = index / sampleRate;
      // Two half-second tones separated by half-second silences, ending in
      // silence so a correct reversal starts with silence.
      const inTone = (time >= 0 && time < 0.5) || (time >= 1.0 && time < 1.5);
      if (inTone) pcm[index] = 0.55 * Math.sin(2 * Math.PI * 440 * time);
    }
    const wavFile = new File([encodeWav([pcm], sampleRate)], "fixture-tone.wav", {
      type: "audio/wav",
    });

    const imageCanvas = document.createElement("canvas");
    imageCanvas.width = 160;
    imageCanvas.height = 120;
    const imageContext = imageCanvas.getContext("2d");
    const gradient = imageContext.createLinearGradient(0, 0, 160, 0);
    gradient.addColorStop(0, "#0a0a0a");
    gradient.addColorStop(1, "#d8d8d8");
    imageContext.fillStyle = gradient;
    imageContext.fillRect(0, 0, 160, 120);
    imageContext.fillStyle = "#ffffff";
    imageContext.fillRect(80, 0, 80, 120);
    imageContext.fillStyle = "#e01b2e";
    imageContext.beginPath();
    imageContext.arc(40, 60, 22, 0, Math.PI * 2);
    imageContext.fill();
    const pngBlob = await new Promise((resolve) => imageCanvas.toBlob(resolve, "image/png"));
    const imageFile = new File([pngBlob], "fixture-edges.png", { type: "image/png" });

    const textContent = "KNOUX REC deterministic file analyzer fixture\nsecond line\n";
    const textFile = new File([textContent], "fixture-note.txt", { type: "text/plain" });
    const emptyFile = new File([], "fixture-empty.wav", { type: "audio/wav" });

    // A real WebM/VP9 fixture with three luminance-distinct scenes and a
    // moving square, recorded through canvas.captureStream + MediaRecorder.
    // --disable-gpu keeps the software encoder available in headless Chrome.
    const videoCanvas = document.createElement("canvas");
    videoCanvas.width = 320;
    videoCanvas.height = 180;
    const videoContext = videoCanvas.getContext("2d");
    const videoStream = videoCanvas.captureStream(30);
    const videoMime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(
      (candidate) => MediaRecorder.isTypeSupported(candidate),
    );
    const recorder = new MediaRecorder(videoStream, { mimeType: videoMime });
    const chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    const stopped = new Promise((resolve) => {
      recorder.onstop = resolve;
    });
    recorder.start(200);
    const started = performance.now();
    let frameCount = 0;
    await new Promise((resolve) => {
      const tick = () => {
        const elapsed = (performance.now() - started) / 1000;
        if (elapsed >= 2.4) {
          resolve();
          return;
        }
        videoContext.fillStyle = elapsed < 1 ? "#101010" : elapsed < 1.8 ? "#f0f0f0" : "#202060";
        videoContext.fillRect(0, 0, 320, 180);
        videoContext.fillStyle = elapsed < 1 ? "#ffffff" : "#000000";
        const x = (elapsed / 2.4) * 250;
        videoContext.fillRect(20 + x, 60, 42, 62);
        frameCount += 1;
        requestAnimationFrame(tick);
      };
      tick();
    });
    recorder.stop();
    await stopped;
    // onstop can precede the final dataavailable dispatch by a task turn.
    await new Promise((resolve) => setTimeout(resolve, chunks.length === 0 ? 1000 : 200));
    if (chunks.length === 0) {
      throw new Error(`fixture video recording produced no chunks (${videoMime})`);
    }
    const videoBlob = new Blob(chunks, { type: videoMime });
    const videoFile = new File([videoBlob], "fixture-motion.webm", { type: videoMime });

    const url = URL.createObjectURL(videoFile);
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.src = url;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () =>
        reject(new Error(`fixture video failed to load: ${video.error?.code}`));
      setTimeout(() => reject(new Error("fixture video metadata timeout")), 10000);
    });
    if (!Number.isFinite(video.duration)) {
      await new Promise((resolve) => {
        video.addEventListener("seeked", resolve, { once: true });
        setTimeout(resolve, 5000);
        video.currentTime = 1e9;
      });
    }
    const videoDuration = video.duration;
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    URL.revokeObjectURL(url);

    window.__knouxFixtures = {
      audio: wavFile,
      image: imageFile,
      video: videoFile,
      text: textFile,
      empty: emptyFile,
    };
    return {
      audioSize: wavFile.size,
      imageSize: imageFile.size,
      textSize: textFile.size,
      videoSize: videoFile.size,
      videoMime,
      videoDuration,
      videoWidth,
      videoHeight,
      videoFrames: frameCount,
      textContent,
    };
  });
  report.fixtures = fixtures;
  check("WAV fixture is a real 16-bit PCM file", fixtures.audioSize > 150000, fixtures.audioSize);
  check("PNG fixture is a real image", fixtures.imageSize > 1000, fixtures.imageSize);
  check(
    "WebM fixture recorded with real motion",
    fixtures.videoSize > 10000 &&
      fixtures.videoMime.includes("webm") &&
      fixtures.videoWidth === 320 &&
      fixtures.videoHeight === 180 &&
      fixtures.videoFrames >= 40,
    {
      size: fixtures.videoSize,
      mime: fixtures.videoMime,
      width: fixtures.videoWidth,
      height: fixtures.videoHeight,
      frames: fixtures.videoFrames,
    },
  );
  check(
    "WebM fixture duration resolves",
    Number.isFinite(fixtures.videoDuration) && fixtures.videoDuration > 2,
    fixtures.videoDuration,
  );

  const expectedTextSha = createHash("sha256")
    .update(Buffer.from(fixtures.textContent, "utf8"))
    .digest("hex");

  /* ------------------------------------------------------------- helpers */
  async function selectTask(taskId) {
    await page.evaluate((id) => {
      const row = document.querySelector(`.kx-ai-row[data-task-id="${id}"]`);
      row?.scrollIntoView({ block: "center" });
    }, taskId);
    await clickInPage(`.kx-ai-row[data-task-id="${taskId}"]`);
    await page.waitForSelector(runnerSelector(taskId), { timeout: 10000 });
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.getAttribute("data-status") === "idle",
      { timeout: 5000 },
      runnerSelector(taskId),
    );
  }

  async function injectFixture(taskId, key) {
    await page.evaluate(
      ({ id, fixtureKey }) => {
        const input = document.querySelector(
          `.kx-ai-runner[data-task-id="${id}"] [data-ai-file-input]`,
        );
        const file = window.__knouxFixtures[fixtureKey];
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      },
      { id: taskId, fixtureKey: key },
    );
    await page.waitForFunction(
      (selector) => Boolean(document.querySelector(selector)),
      { timeout: 5000 },
      `${runnerSelector(taskId)} [data-ai-file-name]`,
    );
  }

  async function setParams(taskId, params) {
    await page.evaluate(
      ({ id, values }) => {
        for (const [key, value] of Object.entries(values)) {
          const element = document.querySelector(
            `.kx-ai-runner[data-task-id="${id}"] [data-ai-param="${key}"]`,
          );
          if (!element) throw new Error(`missing parameter ${key}`);
          const prototype =
            element instanceof HTMLSelectElement
              ? HTMLSelectElement.prototype
              : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
          setter.call(element, String(value));
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
        }
      },
      { id: taskId, values: params },
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  async function runTask(taskId, timeout = 60000) {
    const started = Date.now();
    await clickInPage(`${runnerSelector(taskId)} [data-ai-run]`);
    await page.waitForFunction(
      (selector) => {
        const status = document.querySelector(selector)?.getAttribute("data-status");
        return status === "done" || status === "error" || status === "cancelled";
      },
      { timeout, polling: 200 },
      runnerSelector(taskId),
    );
    const result = await page.evaluate((selector) => {
      const runner = document.querySelector(selector);
      return {
        status: runner?.getAttribute("data-status"),
        error: runner?.querySelector("[data-ai-error]")?.textContent ?? null,
        summary: runner?.querySelector("[data-ai-summary]")?.textContent ?? null,
        elapsed: 0,
      };
    }, runnerSelector(taskId));
    result.elapsed = Date.now() - started;
    return result;
  }

  async function inspectPreview(taskId) {
    return page.evaluate(async (selector) => {
      const runner = document.querySelector(selector);
      const preview = runner?.querySelector("[data-ai-preview]");
      const kind = preview?.getAttribute("data-ai-preview") ?? null;
      const parts = Array.from(runner?.querySelectorAll(".kx-ai-part") ?? []).map((part) => ({
        name: part.querySelector(".kx-ai-part-name")?.textContent ?? "",
        save: Boolean(part.querySelector("[data-ai-save]")),
        export: Boolean(part.querySelector("[data-ai-export]")),
      }));
      const result = { kind, parts, summary: null, image: null, audio: null, video: null, json: null };
      result.summary = runner?.querySelector("[data-ai-summary]")?.textContent ?? null;

      if (kind === "image") {
        const element = preview;
        if (!element.complete) {
          await new Promise((resolve) => {
            element.onload = resolve;
            element.onerror = resolve;
            setTimeout(resolve, 5000);
          });
        }
        const canvas = document.createElement("canvas");
        canvas.width = element.naturalWidth;
        canvas.height = element.naturalHeight;
        const context = canvas.getContext("2d");
        context.drawImage(element, 0, 0);
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let min = 255;
        let max = 0;
        let total = 0;
        let white = 0;
        let black = 0;
        const colors = new Set();
        for (let index = 0; index < data.length; index += 4) {
          const value = data[index];
          if (value < min) min = value;
          if (value > max) max = value;
          total += value;
          if (value > 200) white += 1;
          if (value < 20) black += 1;
          if (colors.size < 64) {
            colors.add(`${data[index]},${data[index + 1]},${data[index + 2]}`);
          }
        }
        const pixels = data.length / 4;
        const rowEnergy = new Array(canvas.height).fill(0);
        for (let y = 0; y < canvas.height; y += 1) {
          let sum = 0;
          for (let x = 0; x < canvas.width; x += 1) {
            sum += data[(y * canvas.width + x) * 4];
          }
          rowEnergy[y] = sum / canvas.width;
        }
        const peakRow = rowEnergy.indexOf(Math.max(...rowEnergy));
        result.image = {
          width: element.naturalWidth,
          height: element.naturalHeight,
          min,
          max,
          mean: total / pixels,
          white,
          black,
          colors: colors.size,
          peakRow,
          peakRowRatio: peakRow / canvas.height,
        };
      }

      if (kind === "audio" || kind === "video") {
        const element = preview;
        await new Promise((resolve) => {
          if (element.readyState >= 1) {
            resolve();
            return;
          }
          element.onloadedmetadata = resolve;
          element.onerror = resolve;
          setTimeout(resolve, 8000);
        });
        let duration = element.duration;
        if (kind === "video" && !Number.isFinite(duration)) {
          await new Promise((resolve) => {
            element.addEventListener("seeked", resolve, { once: true });
            setTimeout(resolve, 5000);
            try {
              element.currentTime = 1e9;
            } catch {
              resolve();
            }
          });
          duration = element.duration;
          try {
            element.currentTime = 0;
          } catch {
            // ignore
          }
        }
        const info = {
          readyState: element.readyState,
          duration: Number.isFinite(duration) ? duration : null,
          width: element.videoWidth ?? null,
          height: element.videoHeight ?? null,
        };
        result[kind] = info;
      }

      if (kind === "json" || kind === "text") {
        const text = preview.textContent ?? "";
        result.json = { text, parsed: null };
        try {
          result.json.parsed = JSON.parse(text);
        } catch {
          // plain text
        }
      }
      return result;
    }, runnerSelector(taskId));
  }

  async function readLibrary() {
    return page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open("knoux-rec.library", 1);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction("items", "readonly");
            const all = tx.objectStore("items").getAll();
            all.onerror = () => reject(all.error);
            all.onsuccess = async () => {
              const items = all.result.sort((a, b) => b.createdAt - a.createdAt);
              const mapped = [];
              for (const item of items) {
                const bytes = new Uint8Array(await item.blob.arrayBuffer());
                const digest = await crypto.subtle.digest("SHA-256", bytes);
                mapped.push({
                  id: item.id,
                  name: item.name,
                  kind: item.kind,
                  mimeType: item.mimeType,
                  size: item.size,
                  width: item.width,
                  height: item.height,
                  duration: item.duration,
                  source: item.source,
                  createdAt: item.createdAt,
                  magic: Array.from(bytes.slice(0, 12))
                    .map((byte) => byte.toString(16).padStart(2, "0"))
                    .join(" "),
                  sha256: Array.from(new Uint8Array(digest))
                    .map((byte) => byte.toString(16).padStart(2, "0"))
                    .join(""),
                  text:
                    item.mimeType.includes("json") || item.mimeType.startsWith("text/")
                      ? await item.blob.text()
                      : null,
                });
              }
              resolve(mapped);
            };
          };
        }),
    );
  }

  async function savePrimaryMedia(taskId) {
    const before = await readLibrary();
    const button = await page.$(`${runnerSelector(taskId)} [data-ai-save]`);
    if (!button) return { supported: false };
    await clickInPage(`${runnerSelector(taskId)} [data-ai-save]`);
    await page.waitForFunction(
      (selector) =>
        document.querySelector(selector)?.hasAttribute("disabled"),
      { timeout: 15000 },
      `${runnerSelector(taskId)} [data-ai-save]`,
    );
    const after = await readLibrary();
    const fresh = after.find((item) => !before.some((old) => old.id === item.id));
    if (!fresh) return { supported: true, saved: false };
    return {
      supported: true,
      saved: true,
      name: fresh.name,
      kind: fresh.kind,
      mimeType: fresh.mimeType,
      size: fresh.size,
      width: fresh.width,
      height: fresh.height,
      duration: fresh.duration,
      source: fresh.source,
      magic: fresh.magic,
      sha256: fresh.sha256,
      text: fresh.text,
    };
  }

  async function waitForDownload(before) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const files = (await readdir(DOWNLOADS)).filter((name) => !name.endsWith(".crdownload"));
      const fresh = files.filter((name) => !before.has(name));
      if (fresh.length > 0) {
        const name = fresh.sort()[0];
        const full = path.join(DOWNLOADS, name);
        const bytes = await readFile(full);
        return {
          name,
          size: bytes.length,
          magic: bytes
            .subarray(0, 12)
            .toString("hex")
            .replace(/(..)(?=.)/g, "$1 "),
          text: name.endsWith(".json") ? bytes.toString("utf8") : null,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  }

  async function exportFirstPart(taskId) {
    const before = new Set(await readdir(DOWNLOADS));
    await clickInPage(`${runnerSelector(taskId)} [data-ai-export]`);
    return waitForDownload(before);
  }

  async function runSimpleTask(taskId, fixtureKey, params, options = {}) {
    await selectTask(taskId);
    await injectFixture(taskId, fixtureKey);
    if (params) await setParams(taskId, params);
    const run = await runTask(taskId, options.timeout ?? 60000);
    check(`${taskId}: finishes successfully`, run.status === "done", run);
    if (run.status !== "done") {
      report.tasks[taskId] = { run };
      return {
        run,
        preview: {
          kind: null,
          parts: [],
          summary: null,
          image: null,
          audio: null,
          video: null,
          json: null,
        },
        saved: {
          supported: true,
          saved: false,
          name: null,
          kind: null,
          mimeType: null,
          size: 0,
          width: null,
          height: null,
          duration: null,
          source: null,
          magic: "",
          sha256: null,
          text: null,
        },
        download: null,
      };
    }
    const preview = await inspectPreview(taskId);
    const saved = options.save === false ? { supported: false } : await savePrimaryMedia(taskId);
    const download = await exportFirstPart(taskId);
    const taskReport = { run, preview, saved: { ...saved, bytes: undefined }, download };
    report.tasks[taskId] = taskReport;
    if (options.screenshot) {
      await page.screenshot({
        path: path.join(OUT, options.screenshot),
        fullPage: false,
      });
    }
    return { run, preview, saved, download };
  }

  /* --------------------------------------------------------- audio tasks */
  {
    const { preview, saved, download } = await runSimpleTask("extract_audio", "audio", null, {
      screenshot: "01-extract-audio.png",
    });
    check(
      "extract_audio: real WAV output",
      saved.saved && saved.kind === "audio" && saved.mimeType === "audio/wav" && saved.magic.startsWith("52 49 46 46"),
      { mime: saved.mimeType, magic: saved.magic, size: saved.size },
    );
    check(
      "extract_audio: decoded duration matches the source",
      preview.audio && preview.audio.duration !== null && Math.abs(preview.audio.duration - 2) < 0.15,
      preview.audio,
    );
    check(
      "extract_audio: export matches the saved blob size",
      download && saved.saved && download.size === saved.size,
      { download: download?.size, saved: saved.size },
    );
  }

  {
    const { preview, saved } = await runSimpleTask("reverse_audio", "audio", null);
    check(
      "reverse_audio: real WAV output",
      saved.saved && saved.mimeType === "audio/wav" && saved.magic.startsWith("52 49 46 46"),
      { mime: saved.mimeType, magic: saved.magic },
    );
    const envelope = await page.evaluate(async (selector) => {
      const audio = document.querySelector(`${selector} [data-ai-preview="audio"]`);
      const response = await new Promise((resolve, reject) => {
        const request = indexedDB.open("knoux-rec.library", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("items", "readonly");
          const all = tx.objectStore("items").getAll();
          all.onsuccess = () => {
            const item = all.result.sort((a, b) => b.createdAt - a.createdAt)[0];
            resolve(item.blob);
          };
          all.onerror = () => reject(all.error);
        };
      });
      const bytes = await response.arrayBuffer();
      const context = new AudioContext();
      const buffer = await context.decodeAudioData(bytes.slice(0));
      const channel = buffer.getChannelData(0);
      const rms = (start, end) => {
        const from = Math.floor(start * buffer.sampleRate);
        const to = Math.min(channel.length, Math.floor(end * buffer.sampleRate));
        let sum = 0;
        for (let index = from; index < to; index += 1) sum += channel[index] * channel[index];
        return Math.sqrt(sum / Math.max(1, to - from));
      };
      const result = {
        duration: buffer.duration,
        firstHalfSecond: rms(0, 0.5),
        toneRegion: rms(0.5, 1.0),
        srcPresent: Boolean(audio?.src),
      };
      await context.close();
      return result;
    }, runnerSelector("reverse_audio"));
    check(
      "reverse_audio: the tail silence is now at the start",
      envelope.firstHalfSecond < 0.02 && envelope.toneRegion > 0.1,
      envelope,
    );
    check(
      "reverse_audio: preview is a playable audio element",
      Boolean(preview.audio) && preview.audio.readyState >= 1,
      preview.audio,
    );
  }

  {
    const { preview, saved } = await runSimpleTask("audio_converter", "audio", {
      sampleRate: "22050",
    });
    const converted = await page.evaluate(async () => {
      const blob = await new Promise((resolve, reject) => {
        const request = indexedDB.open("knoux-rec.library", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("items", "readonly");
          const all = tx.objectStore("items").getAll();
          all.onsuccess = () => resolve(all.result.sort((a, b) => b.createdAt - a.createdAt)[0].blob);
          all.onerror = () => reject(all.error);
        };
      });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const sampleRate = view.getUint32(24, true);
      const channels = view.getUint16(22, true);
      const bitsPerSample = view.getUint16(34, true);
      const dataBytes = view.getUint32(40, true);
      return {
        sampleRate,
        channels,
        bitsPerSample,
        dataBytes,
        duration: dataBytes / (sampleRate * channels * (bitsPerSample / 8)),
      };
    });
    check(
      "audio_converter: resampled to 22 050 Hz",
      converted.sampleRate === 22050,
      converted,
    );
    check(
      "audio_converter: duration preserved",
      Math.abs(converted.duration - 2) < 0.1,
      converted.duration,
    );
    check(
      "audio_converter: preview is playable",
      Boolean(preview.audio) && preview.audio.readyState >= 1,
      preview.audio,
    );
    check("audio_converter: WAV saved", saved.saved && saved.magic.startsWith("52 49 46 46"), saved.magic);
  }

  {
    const { preview, saved } = await runSimpleTask("frequency_filter", "audio", {
      filterType: "highpass",
      frequency: "5000",
      q: "0.707",
    });
    const filtered = await page.evaluate(async () => {
      const blob = await new Promise((resolve, reject) => {
        const request = indexedDB.open("knoux-rec.library", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("items", "readonly");
          const all = tx.objectStore("items").getAll();
          all.onsuccess = () => resolve(all.result.sort((a, b) => b.createdAt - a.createdAt)[0].blob);
          all.onerror = () => reject(all.error);
        };
      });
      const bytes = await blob.arrayBuffer();
      const context = new AudioContext();
      const buffer = await context.decodeAudioData(bytes.slice(0));
      const channel = buffer.getChannelData(0);
      let sum = 0;
      let peak = 0;
      for (const value of channel) {
        sum += value * value;
        if (Math.abs(value) > peak) peak = Math.abs(value);
      }
      const info = { rms: Math.sqrt(sum / channel.length), peak, sampleRate: buffer.sampleRate };
      await context.close();
      return info;
    });
    check(
      "frequency_filter: a 5 kHz high-pass removes a 440 Hz tone",
      filtered.rms < 0.02 && filtered.peak < 0.1,
      filtered,
    );
    check(
      "frequency_filter: WAV saved",
      saved.saved && saved.magic.startsWith("52 49 46 46"),
      saved.magic,
    );
    check(
      "frequency_filter: preview is playable",
      Boolean(preview.audio) && preview.audio.readyState >= 1,
      preview.audio,
    );
  }

  {
    const { preview, saved } = await runSimpleTask("generate_spectrogram", "audio", null, {
      screenshot: "02-spectrogram.png",
    });
    check(
      "generate_spectrogram: PNG output",
      saved.saved && saved.mimeType === "image/png" && saved.magic.startsWith("89 50 4e 47"),
      { mime: saved.mimeType, magic: saved.magic },
    );
    check(
      "generate_spectrogram: image has real spectral content",
      preview.image &&
        preview.image.width > 100 &&
        preview.image.height === 360 &&
        preview.image.colors > 10 &&
        preview.image.max > 80,
      preview.image,
    );
    check(
      "generate_spectrogram: the 440 Hz band is in the low-frequency rows",
      preview.image && preview.image.peakRowRatio > 0.7,
      preview.image ? { peakRow: preview.image.peakRow, ratio: preview.image.peakRowRatio } : null,
    );
  }

  {
    const { preview, download } = await runSimpleTask("detect_silence", "audio", null);
    const parsed = preview.json?.parsed;
    check(
      "detect_silence: report has at least two silent intervals",
      parsed && Array.isArray(parsed.intervals) && parsed.intervals.length >= 2,
      parsed ? { intervals: parsed.intervals, ratio: parsed.silenceRatio } : preview.json?.text?.slice(0, 200),
    );
    check(
      "detect_silence: silence ratio is plausible",
      parsed && parsed.silenceRatio > 0.3 && parsed.silenceRatio < 0.8,
      parsed?.silenceRatio,
    );
    check(
      "detect_silence: JSON export is the same report",
      download &&
        download.name.endsWith(".json") &&
        download.text &&
        JSON.parse(download.text).intervals.length === parsed.intervals.length,
      { name: download?.name, size: download?.size },
    );
  }

  {
    const { preview, download } = await runSimpleTask("noise_profiler", "audio", null);
    const parsed = preview.json?.parsed;
    check(
      "noise_profiler: measures the real sample rate and duration",
      parsed && parsed.sampleRate === 44100 && Math.abs(parsed.durationSeconds - 2) < 0.05,
      parsed ? { sampleRate: parsed.sampleRate, duration: parsed.durationSeconds } : null,
    );
    check(
      "noise_profiler: RMS, peak and noise floor are measured",
      parsed &&
        Number.isFinite(parsed.rmsDb) &&
        Number.isFinite(parsed.peakDb) &&
        Number.isFinite(parsed.noiseFloorDb) &&
        parsed.peakDb > parsed.rmsDb,
      parsed
        ? { rmsDb: parsed.rmsDb, peakDb: parsed.peakDb, floor: parsed.noiseFloorDb }
        : null,
    );
    check(
      "noise_profiler: JSON report exported",
      download && download.name.endsWith(".json") && download.size > 100,
      { name: download?.name, size: download?.size },
    );
  }

  {
    const { preview, saved } = await runSimpleTask("change_pitch", "audio", { semitones: "12" });
    const pitch = await page.evaluate(async () => {
      const blob = await new Promise((resolve, reject) => {
        const request = indexedDB.open("knoux-rec.library", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("items", "readonly");
          const all = tx.objectStore("items").getAll();
          all.onsuccess = () => resolve(all.result.sort((a, b) => b.createdAt - a.createdAt)[0].blob);
          all.onerror = () => reject(all.error);
        };
      });
      const bytes = await blob.arrayBuffer();
      const context = new AudioContext();
      const buffer = await context.decodeAudioData(bytes.slice(0));
      const channel = buffer.getChannelData(0);
      const from = Math.floor(0.2 * buffer.sampleRate);
      const to = Math.floor(0.4 * buffer.sampleRate);
      let crossings = 0;
      for (let index = from + 1; index < to; index += 1) {
        if ((channel[index - 1] < 0) !== (channel[index] < 0)) crossings += 1;
      }
      const info = {
        duration: buffer.duration,
        crossings,
        estimatedHz: crossings / 2 / 0.2,
      };
      await context.close();
      return info;
    });
    check(
      "change_pitch: +12 semitones roughly doubles the zero-crossing rate",
      pitch.estimatedHz > 700 && pitch.estimatedHz < 1100,
      pitch,
    );
    check(
      "change_pitch: duration is preserved",
      Math.abs(pitch.duration - 2) < 0.1,
      pitch.duration,
    );
    check(
      "change_pitch: WAV saved",
      saved.saved && saved.magic.startsWith("52 49 46 46"),
      saved.magic,
    );
    check(
      "change_pitch: preview is playable",
      Boolean(preview.audio) && preview.audio.readyState >= 1,
      preview.audio,
    );
  }

  /* --------------------------------------------------------- image tasks */
  {
    const { preview, saved, download } = await runSimpleTask("edge_detection", "image", null, {
      screenshot: "03-edge-detection.png",
    });
    check(
      "edge_detection: PNG output with a real Sobel edge map",
      saved.saved &&
        saved.magic.startsWith("89 50 4e 47") &&
        preview.image.white > 0 &&
        preview.image.black > 0 &&
        preview.image.white < preview.image.width * preview.image.height,
      preview.image,
    );
    check(
      "edge_detection: the hard vertical edge produces many edge pixels",
      preview.image.white > 300,
      preview.image.white,
    );
    check(
      "edge_detection: export size matches the saved PNG",
      download && download.size === saved.size,
      { download: download?.size, saved: saved.size },
    );
  }

  /* --------------------------------------------------------- video tasks */
  {
    const { preview, saved, download } = await runSimpleTask(
      "extract_frames",
      "video",
      { count: "5", maxWidth: "480" },
      { timeout: 90000, screenshot: "04-extract-frames.png" },
    );
    check(
      "extract_frames: contact sheet plus one PNG per frame",
      preview.parts.length === 6 && preview.kind === "image",
      preview.parts.map((part) => part.name),
    );
    check(
      "extract_frames: contact sheet has the expected grid size",
      preview.image && preview.image.width > 900 && preview.image.height > 300,
      preview.image,
    );
    check(
      "extract_frames: saved contact sheet is a PNG",
      saved.saved && saved.mimeType === "image/png" && saved.magic.startsWith("89 50 4e 47"),
      { mime: saved.mimeType, magic: saved.magic, size: saved.size },
    );
    check(
      "extract_frames: export matches the saved sheet",
      download && saved.saved && download.size === saved.size,
      { download: download?.size, saved: saved.size },
    );
  }

  {
    const { preview, download } = await runSimpleTask("analyze_fps", "video", null, {
      timeout: 90000,
    });
    const parsed = preview.json?.parsed;
    check(
      "analyze_fps: reports the real resolution",
      parsed && parsed.width === 320 && parsed.height === 180,
      parsed ? { width: parsed.width, height: parsed.height } : null,
    );
    check(
      "analyze_fps: measures a plausible frame rate with the median interval",
      parsed &&
        parsed.framesObserved >= 5 &&
        parsed.measuredFps >= 5 &&
        parsed.measuredFps <= 240 &&
        parsed.baseFrameDurationSeconds > 0 &&
        /median/i.test(parsed.measurementMethod ?? ""),
      parsed
        ? {
            fps: parsed.measuredFps,
            frames: parsed.framesObserved,
            baseFrameDuration: parsed.baseFrameDurationSeconds,
            method: parsed.measurementMethod,
          }
        : null,
    );
    check(
      "analyze_fps: JSON export present",
      download && download.name.endsWith(".json"),
      { name: download?.name, size: download?.size },
    );
  }

  {
    const { preview, saved, download } = await runSimpleTask(
      "extract_scenes",
      "video",
      { samples: "24", sensitivity: "0.25" },
      { timeout: 90000, screenshot: "05-extract-scenes.png" },
    );
    const parsed = preview.json?.parsed;
    check(
      "extract_scenes: detects scene cuts in the recording",
      parsed && parsed.sceneCount >= 2 && parsed.cuts.length >= 1,
      parsed ? { scenes: parsed.sceneCount, cuts: parsed.cuts } : null,
    );
    check(
      "extract_scenes: scene sheet is saved as a PNG",
      saved.saved && saved.magic.startsWith("89 50 4e 47"),
      { magic: saved.magic, size: saved.size },
    );
    check(
      "extract_scenes: JSON export lists the scenes",
      download &&
        download.text &&
        JSON.parse(download.text).scenes.length === parsed.scenes.length,
      { name: download?.name, size: download?.size },
    );
  }

  {
    const { preview, saved, download } = await runSimpleTask(
      "detect_motion",
      "video",
      { samples: "24", threshold: "0.01" },
      { timeout: 90000 },
    );
    const parsed = preview.json?.parsed;
    check(
      "detect_motion: finds moving sampled intervals",
      parsed && parsed.movingSamples > 0 && parsed.peakScore > 0.01,
      parsed
        ? { moving: parsed.movingSamples, peak: parsed.peakScore, ratio: parsed.movingRatio }
        : null,
    );
    check(
      "detect_motion: heatmap is saved as a PNG",
      saved.saved && saved.magic.startsWith("89 50 4e 47"),
      { magic: saved.magic, size: saved.size },
    );
    check(
      "detect_motion: JSON export matches the preview",
      download &&
        download.text &&
        JSON.parse(download.text).timeline.length === parsed.timeline.length,
      { name: download?.name, size: download?.size },
    );
  }

  {
    const { preview, saved, download } = await runSimpleTask(
      "video_filters",
      "video",
      { filter: "grayscale", maxDuration: "2" },
      { timeout: 90000, screenshot: "06-video-filters.png" },
    );
    check(
      "video_filters: produces a real WebM video",
      saved.saved &&
        saved.kind === "video" &&
        saved.magic.startsWith("1a 45 df a3") &&
        saved.size > 3000,
      { magic: saved.magic, size: saved.size, mime: saved.mimeType },
    );
    check(
      "video_filters: preview decodes with the right dimensions and duration",
      preview.video &&
        preview.video.width === 320 &&
        preview.video.height === 180 &&
        preview.video.duration !== null &&
        preview.video.duration > 1,
      preview.video,
    );
    check(
      "video_filters: export matches the saved video",
      download && saved.saved && download.size === saved.size,
      { download: download?.size, saved: saved.size },
    );
  }

  /* -------------------------------------------------------- analysis task */
  {
    const { preview, download } = await runSimpleTask("file_analyzer", "text", null, {
      save: false,
    });
    const parsed = preview.json?.parsed;
    check(
      "file_analyzer: SHA-256 matches the independent Node hash",
      parsed && parsed.sha256 === expectedTextSha,
      parsed ? { expected: expectedTextSha, actual: parsed.sha256 } : null,
    );
    check(
      "file_analyzer: sniffs the text container and size",
      parsed && parsed.sizeBytes === fixtures.textSize && parsed.detectedFormat === "Unknown binary",
      parsed ? { size: parsed.sizeBytes, format: parsed.detectedFormat } : null,
    );
    check(
      "file_analyzer: JSON export parses and carries the same hash",
      download && download.text && JSON.parse(download.text).sha256 === expectedTextSha,
      { name: download?.name, size: download?.size },
    );
  }

  /* ----------------------------------------------------- rejection paths */
  {
    await selectTask("reverse_audio");
    await injectFixture("reverse_audio", "image");
    const wrong = await page.evaluate((selector) => {
      const runner = document.querySelector(selector);
      return {
        notice: runner?.querySelector(".kx-notice[data-tone='danger']")?.textContent ?? null,
        disabled: runner?.querySelector("[data-ai-run]")?.disabled ?? null,
      };
    }, runnerSelector("reverse_audio"));
    check(
      "validation: a PNG is rejected by an audio task",
      Boolean(wrong.notice) && wrong.disabled === true,
      wrong,
    );

    await injectFixture("reverse_audio", "empty");
    const empty = await page.evaluate((selector) => {
      const runner = document.querySelector(selector);
      return {
        notice: runner?.querySelector(".kx-notice[data-tone='danger']")?.textContent ?? null,
        disabled: runner?.querySelector("[data-ai-run]")?.disabled ?? null,
      };
    }, runnerSelector("reverse_audio"));
    check(
      "validation: an empty file is rejected",
      Boolean(empty.notice) && empty.disabled === true,
      empty,
    );
  }

  /* ----------------------------------------------------------- cancellation */
  {
    await selectTask("video_filters");
    await injectFixture("video_filters", "video");
    await setParams("video_filters", { filter: "sepia", maxDuration: "10" });
    await clickInPage(`${runnerSelector("video_filters")} [data-ai-run]`);
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.getAttribute("data-status") === "running",
      { timeout: 10000 },
      runnerSelector("video_filters"),
    );
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const cancelStarted = Date.now();
    await clickInPage(`${runnerSelector("video_filters")} [data-ai-cancel]`);
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.getAttribute("data-status") === "cancelled",
      { timeout: 10000 },
      runnerSelector("video_filters"),
    );
    const cancelled = await page.evaluate((selector) => {
      const runner = document.querySelector(selector);
      return {
        status: runner?.getAttribute("data-status"),
        notice: runner?.querySelector("[data-ai-cancelled]")?.textContent ?? null,
        preview: Boolean(runner?.querySelector("[data-ai-preview]")),
      };
    }, runnerSelector("video_filters"));
    check(
      "cancellation: video_filters stops promptly and keeps no output",
      cancelled.status === "cancelled" &&
        Boolean(cancelled.notice) &&
        cancelled.preview === false &&
        Date.now() - cancelStarted < 8000,
      { ...cancelled, elapsedMs: Date.now() - cancelStarted },
    );
  }

  /* --------------------------------------------------------- model blocked */
  {
    await page.evaluate(() => {
      const row = document.querySelector('.kx-ai-row[data-task-id="remove_background"]');
      row?.scrollIntoView({ block: "center" });
    });
    await clickInPage('.kx-ai-row[data-task-id="remove_background"]');
    await page.waitForFunction(
      () => !document.querySelector('.kx-ai-runner[data-task-id="remove_background"]'),
      { timeout: 5000 },
    );
    const blocked = await page.evaluate(() => {
      const row = document.querySelector('.kx-ai-row[data-task-id="remove_background"]');
      const badge = row?.querySelector(".kx-badge");
      const buttons = Array.from(document.querySelectorAll("button")).filter(
        (button) => button.disabled && /blocked/i.test(button.textContent ?? ""),
      );
      return {
        runtime: row?.getAttribute("data-runtime"),
        badge: badge?.textContent ?? null,
        badgeState: badge?.getAttribute("data-state") ?? null,
        blockedButtons: buttons.length,
        runner: Boolean(document.querySelector('.kx-ai-runner[data-task-id="remove_background"]')),
      };
    });
    check(
      "model tasks: remove_background stays blocked",
      blocked.runtime === "model" &&
        blocked.badgeState === "MISSING_MODEL" &&
        blocked.blockedButtons > 0 &&
        blocked.runner === false,
      blocked,
    );
  }

  /* -------------------------------------------------------- Arabic route */
  {
    await page.goto(`${BASE}#/arabic-ai`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("[data-ai-runtime-summary]", { timeout: 30000 });
    await selectTask("file_analyzer");
    await injectFixture("file_analyzer", "text");
    const run = await runTask("file_analyzer", 30000);
    const preview = await inspectPreview("file_analyzer");
    check(
      "Arabic route: a deterministic task runs and reports the same hash",
      run.status === "done" && preview.json?.parsed?.sha256 === expectedTextSha,
      { status: run.status, hash: preview.json?.parsed?.sha256 },
    );

    // The shell must localize the runner surface, not just the catalog card.
    await page.evaluate(() => {
      const toggle = [...document.querySelectorAll("button")].find(
        (element) => element.textContent?.trim() === "AR",
      );
      toggle?.click();
    });
    await new Promise((resolve) => setTimeout(resolve, 700));
    const arabic = await page.evaluate(() => ({
      dir: document.documentElement.dir,
      lang: document.documentElement.lang,
      overflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.body.innerText.slice(0, 6000),
    }));
    check(
      "Arabic route: RTL shell with localized runner labels",
      arabic.dir === "rtl" &&
        arabic.lang === "ar" &&
        /تشغيل هذه المهمة|محرك محلي/.test(arabic.body),
      { dir: arabic.dir, lang: arabic.lang },
    );
    check(
      "Arabic route: no horizontal overflow",
      arabic.overflow <= 0,
      arabic.overflow,
    );
    await page.screenshot({ path: path.join(OUT, "07-arabic-route.png"), fullPage: false });

    // Restore English so later checks and evidence screenshots stay stable.
    await page.evaluate(() => {
      const toggle = [...document.querySelectorAll("button")].find(
        (element) => element.textContent?.trim() === "EN",
      );
      toggle?.click();
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  /* -------------------------------------------------------------- summary */
  check(
    "no renderer console errors during the suite",
    report.consoleErrors.length === 0,
    report.consoleErrors.slice(0, 5),
  );
  check("no uncaught page errors", report.pageErrors.length === 0, report.pageErrors.slice(0, 5));
} catch (error) {
  failures += 1;
  report.fatal = error.stack ?? String(error);
  console.error("FATAL", report.fatal);
} finally {
  report.finishedAt = new Date().toISOString();
  report.failures = failures;
  report.failed = failures > 0;
  await mkdir(OUT, { recursive: true });
  await page?.screenshot({ path: path.join(OUT, "00-final.png"), fullPage: false }).catch(() => {});
  await browser.close();
}

const { writeFile } = await import("node:fs/promises");
await writeFile(
  path.join(OUT, "ai-tools-smoke.json"),
  JSON.stringify(report, null, 2),
  "utf8",
);
console.log(
  `\nAI tools smoke: ${report.checks.length - failures}/${report.checks.length} checks passed, ${failures} failed`,
);
process.exit(failures === 0 ? 0 : 1);
