#!/usr/bin/env node
/**
 * Templates end-to-end smoke.
 *
 * Verifies that the five preserved templates really render, that PNG frames
 * can be saved/exported, and that the new WebM export is a genuine encoded
 * video: the browser decodes it, reports 1920x1080, and two seeked frames have
 * different pixel hashes proves the animation is in the container.
 *
 * The exported file is downloaded through the real UI and its SHA-256 is
 * compared with the blob stored in IndexedDB, so the download is not merely a
 * renamed frame or an HTML file with a video extension.
 */

import { mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.KNOUX_BASE_URL ?? "http://localhost:4173/";
const OUT = path.resolve("artifacts/evidence/templates");
const DOWNLOADS = path.join(OUT, "downloads");
const CHROME =
  process.env.KNOUX_CHROME ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

await mkdir(OUT, { recursive: true });
await rm(DOWNLOADS, { recursive: true, force: true });
await mkdir(DOWNLOADS, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  base: BASE,
  chrome: CHROME,
  checks: [],
  downloads: [],
  consoleErrors: [],
  pageErrors: [],
};

function check(name, pass, detail) {
  report.checks.push({ name, pass: Boolean(pass), detail });
  if (!pass) console.error(`FAIL ${name}: ${JSON.stringify(detail)}`);
  else console.log(`PASS ${name}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

async function waitForApp(page) {
  await page.waitForSelector(".kx-app", { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector(".kx-splash"), {
    timeout: 30000,
  });
}

async function clickButton(page, labels, wait = 100) {
  const list = Array.isArray(labels) ? labels : [labels];
  const clicked = await page.evaluate((texts) => {
    const button = [...document.querySelectorAll(".kx-btn")].find((element) =>
      texts.includes(element.textContent?.trim() ?? ""),
    );
    if (!button) return false;
    button.click();
    return true;
  }, list);
  if (!clicked) throw new Error(`Button not found: ${list.join(" | ")}`);
  if (wait) await sleep(wait);
}

async function selectRow(page, matcher) {
  const selected = await page.evaluate((needle) => {
    const rows = [...document.querySelectorAll(".kx-template-card")];
    const row = rows.find((element) => {
      const text = element.querySelector(".kx-template-sub")?.textContent ?? "";
      return text.includes(needle);
    });
    if (!row) return false;
    row.click();
    return true;
  }, matcher);
  if (!selected) throw new Error(`Template row not found: ${matcher}`);
  await sleep(500);
}

async function clearDownloads() {
  const files = await readdir(DOWNLOADS).catch(() => []);
  for (const file of files) {
    await unlink(path.join(DOWNLOADS, file)).catch(() => undefined);
  }
}

async function waitForDownload(extension, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const files = await readdir(DOWNLOADS).catch(() => []);
    const ready = files.filter(
      (file) =>
        !file.endsWith(".crdownload") &&
        !file.endsWith(".tmp") &&
        file.toLowerCase().endsWith(extension),
    );
    if (ready.length > 0) return path.join(DOWNLOADS, ready[0]);
    await sleep(150);
  }
  throw new Error(`No ${extension} download reached ${DOWNLOADS}.`);
}

function describeFile(buffer) {
  const magic = Array.from(buffer.subarray(0, 16))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join(" ");
  return {
    bytes: buffer.length,
    magic,
    isPng:
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47,
    isWebm:
      buffer.length >= 4 &&
      buffer[0] === 0x1a &&
      buffer[1] === 0x45 &&
      buffer[2] === 0xdf &&
      buffer[3] === 0xa3,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  };
}

async function downloadAsset(page, label, extension) {
  await clearDownloads();
  await clickButton(page, label, 200);
  const filePath = await waitForDownload(extension);
  const bytes = await readFile(filePath);
  const described = describeFile(bytes);
  const asset = { name: path.basename(filePath), ...described };
  report.downloads.push({ label, ...asset });
  return asset;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--autoplay-policy=no-user-gesture-required",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1600,1000",
  ],
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 },
});

try {
  const page = await browser.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location();
      report.consoleErrors.push({
        text: message.text(),
        url: location?.url ?? null,
        line: location?.lineNumber ?? null,
      });
    }
  });
  page.on("pageerror", (error) => report.pageErrors.push(String(error?.stack ?? error)));

  let downloadSession = null;
  try {
    downloadSession = await browser.target().createCDPSession();
    await downloadSession.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: DOWNLOADS,
      eventsEnabled: true,
    });
  } catch (error) {
    report.downloadSetupError = String(error);
    const pageSession = await page.createCDPSession();
    await pageSession.send("Page.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: DOWNLOADS,
    });
  }

  await page.evaluateOnNewDocument(() => {
    const counters = { created: 0, revoked: 0 };
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object) => {
      counters.created += 1;
      return create(object);
    };
    URL.revokeObjectURL = (url) => {
      counters.revoked += 1;
      return revoke(url);
    };
    window.__kxUrlCounters = counters;

    const hex = (buffer) =>
      Array.from(new Uint8Array(buffer))
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");

    async function loadImageBlob(blob) {
      const url = URL.createObjectURL(blob);
      try {
        return await new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error("The image could not be decoded."));
          image.src = url;
        });
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    async function imageStatsFromElement(image) {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas 2D is unavailable.");
      context.drawImage(image, 0, 0);
      const frame = context.getImageData(0, 0, canvas.width, canvas.height);
      const digest = await crypto.subtle.digest("SHA-256", frame.data);
      let dark = 0;
      let coloured = 0;
      for (let index = 0; index < frame.data.length; index += 4) {
        const r = frame.data[index];
        const g = frame.data[index + 1];
        const b = frame.data[index + 2];
        if (r + g + b < 120) dark += 1;
        if (Math.max(r, g, b) - Math.min(r, g, b) > 24) coloured += 1;
      }
      return {
        width: canvas.width,
        height: canvas.height,
        darkPixels: dark,
        colouredPixels: coloured,
        totalPixels: frame.data.length / 4,
        pixelSha256: hex(digest),
      };
    }

    window.__KX = {
      async flatFillHash(width, height, color) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas 2D is unavailable.");
        context.fillStyle = color;
        context.fillRect(0, 0, width, height);
        const frame = context.getImageData(0, 0, width, height);
        const digest = await crypto.subtle.digest("SHA-256", frame.data);
        return hex(digest);
      },
      async inspect(selector) {
        const image = document.querySelector(selector);
        if (!image) return null;
        if (!image.complete || !image.naturalWidth) {
          await new Promise((resolve) => {
            image.addEventListener("load", resolve, { once: true });
            image.addEventListener("error", resolve, { once: true });
            setTimeout(resolve, 5000);
          });
        }
        if (!image.naturalWidth) return null;
        return imageStatsFromElement(image);
      },
      async persistedImage(fragment) {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open("knoux-rec.library", 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const items = await new Promise((resolve, reject) => {
          const transaction = db.transaction("items", "readonly");
          const request = transaction.objectStore("items").getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const matches = items
          .filter((item) => item.kind === "image" && item.name.includes(fragment))
          .sort((a, b) => b.createdAt - a.createdAt);
        const match = matches[0];
        if (!match) {
          db.close();
          return null;
        }
        const buffer = await match.blob.arrayBuffer();
        const digest = await crypto.subtle.digest("SHA-256", buffer);
        const image = await loadImageBlob(match.blob);
        const stats = await imageStatsFromElement(image);
        db.close();
        return {
          name: match.name,
          mimeType: match.mimeType,
          kind: match.kind,
          size: match.blob.size,
          sha256: hex(digest),
          magic: Array.from(new Uint8Array(buffer).slice(0, 16))
            .map((value) => value.toString(16).padStart(2, "0"))
            .join(" "),
          ...stats,
        };
      },
      async persistedVideo(fragment) {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open("knoux-rec.library", 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const items = await new Promise((resolve, reject) => {
          const transaction = db.transaction("items", "readonly");
          const request = transaction.objectStore("items").getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const matches = items
          .filter((item) => item.kind === "video" && item.name.includes(fragment))
          .sort((a, b) => b.createdAt - a.createdAt);
        const match = matches[0];
        if (!match) {
          db.close();
          return null;
        }
        const buffer = await match.blob.arrayBuffer();
        const digest = await crypto.subtle.digest("SHA-256", buffer);
        db.close();
        return {
          name: match.name,
          mimeType: match.mimeType,
          kind: match.kind,
          size: match.blob.size,
          sha256: hex(digest),
          magic: Array.from(new Uint8Array(buffer).slice(0, 16))
            .map((value) => value.toString(16).padStart(2, "0"))
            .join(" "),
          storedWidth: match.width,
          storedHeight: match.height,
          storedDuration: match.duration,
        };
      },
      async videoInfo() {
        const video = document.querySelector(".kx-preview video");
        if (!video) return null;
        if (video.readyState < 1) {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error("The video metadata never loaded.")),
              20000,
            );
            video.addEventListener(
              "loadedmetadata",
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
            video.addEventListener(
              "error",
              () => {
                clearTimeout(timer);
                reject(new Error("The exported video could not be decoded."));
              },
              { once: true },
            );
          });
        }
        if (!Number.isFinite(video.duration)) {
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, 5000);
            video.addEventListener(
              "durationchange",
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
            video.currentTime = 1e9;
          });
        }
        const duration = video.duration;
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 5000);
          video.addEventListener(
            "seeked",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
          video.currentTime = 0;
        });
        return {
          width: video.videoWidth,
          height: video.videoHeight,
          duration,
          readyState: video.readyState,
        };
      },
      async videoFrame(target) {
        const video = document.querySelector(".kx-preview video");
        if (!video) throw new Error("No video preview exists.");
        if (!Number.isFinite(video.duration)) {
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, 5000);
            video.addEventListener(
              "durationchange",
              () => {
                clearTimeout(timer);
                resolve();
              },
              { once: true },
            );
            video.currentTime = 1e9;
          });
        }
        const limit = Number.isFinite(video.duration)
          ? Math.max(0, video.duration - 0.05)
          : target;
        const clamped = Math.max(0, Math.min(target, limit));
        await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("The video seek timed out.")),
            20000,
          );
          video.addEventListener(
            "seeked",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
          video.currentTime = clamped;
        });
        await new Promise((resolve) => setTimeout(resolve, 250));
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Canvas 2D is unavailable.");
        context.drawImage(video, 0, 0);
        const frame = context.getImageData(0, 0, canvas.width, canvas.height);
        const digest = await crypto.subtle.digest("SHA-256", frame.data);
        let dark = 0;
        let luma = 0;
        for (let index = 0; index < frame.data.length; index += 4) {
          const r = frame.data[index];
          const g = frame.data[index + 1];
          const b = frame.data[index + 2];
          if (r + g + b < 120) dark += 1;
          luma += 0.299 * r + 0.587 * g + 0.114 * b;
        }
        const total = frame.data.length / 4;
        return {
          requestedTime: target,
          actualTime: video.currentTime,
          pixelSha256: hex(digest),
          darkRatio: dark / total,
          meanLuma: luma / total,
        };
      },
    };
  });

  await page.goto(`${BASE}#/templates`, { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await page.waitForSelector(".kx-template-card", { timeout: 30000 });

  const catalog = await page.evaluate(() => ({
    renderable: document.querySelectorAll(".kx-template-card").length,
    badge: document.querySelector(".kx-view-head .kx-badge")?.textContent?.trim() ?? "",
    badgeState:
      document.querySelector(".kx-view-head .kx-badge")?.getAttribute("data-state") ?? "",
    notice: document.querySelector(".kx-notice")?.textContent?.trim() ?? "",
    mockRows: document.querySelectorAll(".kx-table tbody tr").length,
    mockBadges: [...document.querySelectorAll(".kx-table tbody .kx-badge")].map(
      (badge) => badge.textContent?.trim() ?? "",
    ),
    mockTotal:
      document.querySelector(".kx-dev-count")?.textContent?.trim() ?? "",
    rows: [...document.querySelectorAll(".kx-template-card")].map((row) => ({
      title: row.querySelector(".kx-template-name")?.textContent?.trim() ?? "",
      sub: row.querySelector(".kx-template-sub")?.textContent?.trim() ?? "",
    })),
  }));
  report.catalog = catalog;
  check("templates: five renderable templates are listed", catalog.renderable === 5, catalog.renderable);
  await page
    .waitForFunction(
      () => document.querySelectorAll(".kx-template-card img").length >= 5,
      { timeout: 25000 },
    )
    .catch(() => undefined);
  const thumbs = await page.evaluate(() =>
    [...document.querySelectorAll(".kx-template-card img")].map((image) => ({
      width: image.naturalWidth,
      height: image.naturalHeight,
      src: image.src.slice(0, 24),
    })),
  );
  check(
    "templates: the gallery paints real rendered thumbnails",
    thumbs.length === 5 &&
      thumbs.every(
        (thumb) =>
          thumb.width === 480 &&
          thumb.height === 270 &&
          thumb.src.startsWith("data:image/png"),
      ),
    thumbs,
  );
  check(
    "templates: the capability is marked VERIFIED",
    catalog.badgeState === "VERIFIED" && /verif/i.test(catalog.badge),
    { badge: catalog.badge, state: catalog.badgeState },
  );
  check(
    "templates: the notice describes real WebM encoding",
    /WebM/i.test(catalog.notice) && /MediaRecorder/i.test(catalog.notice),
    catalog.notice,
  );
  check(
    "templates: the generated entries stay labelled Mock",
    catalog.mockRows >= 5 &&
      catalog.mockBadges.length > 0 &&
      catalog.mockBadges.every((badge) => badge.toLowerCase() === "mock"),
    { rows: catalog.mockRows, badges: [...new Set(catalog.mockBadges)] },
  );
  check("templates: the generated total is 51", catalog.mockTotal === "51", catalog.mockTotal);
  await shot(page, "01-templates-catalog");

  /* -------------------------------------------------- frame render + save */
  await selectRow(page, "5s");
  const selectedFrame = await page.evaluate(
    () => document.querySelector(".kx-card-title span")?.textContent?.trim() ?? "",
  );
  check(
    "templates: the selected card offers the WebM video badge",
    /WebM/i.test(await page.evaluate(() => document.body.innerText)),
    selectedFrame,
  );
  await clickButton(page, "Render frame");
  await page.waitForFunction(
    () => Boolean(document.querySelector(".kx-preview img")),
    { timeout: 30000 },
  );
  await sleep(300);
  const frame = await page.evaluate(() => window.__KX.inspect(".kx-preview img"));
  report.frame = frame;
  check(
    "templates: the rendered frame is 1920×1080",
    frame.width === 1920 && frame.height === 1080,
    { width: frame.width, height: frame.height },
  );
  check(
    "templates: the rendered frame contains real template pixels",
    frame.colouredPixels > frame.totalPixels * 0.2 &&
      frame.pixelSha256 !==
        (await page.evaluate(() => window.__KX.flatFillHash(1920, 1080, "#05050a"))),
    {
      coloured: frame.colouredPixels,
      dark: frame.darkPixels,
      total: frame.totalPixels,
      sha: frame.pixelSha256,
    },
  );
  await shot(page, "02-frame-rendered");

  await clickButton(page, "Save to library");
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".kx-btn")].some(
        (button) => button.textContent?.trim() === "Saved",
      ),
    { timeout: 20000 },
  );
  await sleep(250);
  const frameItem = await page.evaluate(() => window.__KX.persistedImage("-frame.png"));
  report.frameItem = frameItem;
  check(
    "templates: the saved frame is a real PNG at 1920×1080",
    Boolean(
      frameItem &&
        frameItem.mimeType === "image/png" &&
        frameItem.size > 100 &&
        frameItem.width === 1920 &&
        frameItem.height === 1080 &&
        frameItem.magic.startsWith("89 50 4e 47"),
    ),
    frameItem && {
      name: frameItem.name,
      mimeType: frameItem.mimeType,
      size: frameItem.size,
      width: frameItem.width,
      height: frameItem.height,
      magic: frameItem.magic,
    },
  );
  check(
    "templates: the saved frame decodes to exactly the preview pixels",
    Boolean(frameItem && frameItem.pixelSha256 === frame.pixelSha256),
    {
      preview: frame.pixelSha256,
      saved: frameItem?.pixelSha256 ?? null,
    },
  );
  const frameDownload = await downloadAsset(page, "Export PNG frame", ".png");
  check(
    "templates: the exported PNG frame equals the saved frame bytes",
    Boolean(
      frameItem &&
        frameDownload.isPng &&
        frameDownload.sha256 === frameItem.sha256 &&
        frameDownload.bytes === frameItem.size,
    ),
    {
      downloaded: { name: frameDownload.name, bytes: frameDownload.bytes, sha256: frameDownload.sha256 },
      saved: frameItem && { name: frameItem.name, bytes: frameItem.size, sha256: frameItem.sha256 },
    },
  );

  /* ------------------------------------- text customizations reach pixels */
  const customized = await page.evaluate(async () => {
    const inputs = [...document.querySelectorAll("input.kx-input")];
    if (!inputs.length) return { targeted: false, reason: "no text input" };
    const input = inputs[0];
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(input, "KNOUX PIXEL PROOF");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 250));
    const button = [...document.querySelectorAll(".kx-btn")].find((element) =>
      ["Render frame", "Render again"].includes(element.textContent?.trim() ?? ""),
    );
    if (!button) return { targeted: false, reason: "render button missing" };
    button.click();
    return { targeted: true, value: input.value };
  });
  await page.waitForFunction(
    () => Boolean(document.querySelector(".kx-preview img")),
    { timeout: 30000 },
  );
  await sleep(350);
  const customizedFrame = await page.evaluate(() => window.__KX.inspect(".kx-preview img"));
  check(
    "templates: text customizations reach the rendered pixels",
    Boolean(
      customized.targeted &&
        customizedFrame.width === 1920 &&
        customizedFrame.height === 1080 &&
        customizedFrame.pixelSha256 !== frame.pixelSha256,
    ),
    {
      customized,
      original: frame.pixelSha256,
      customizedSha: customizedFrame.pixelSha256,
    },
  );
  await shot(page, "02b-frame-customized");

  /* ------------------------------------------------------------ cancel */
  const cancelStart = await page.evaluate(async () => {
    const button = [...document.querySelectorAll(".kx-btn")].find(
      (element) => element.textContent?.trim() === "Export WebM video",
    );
    if (!button) return { started: false, reason: "export button missing" };
    button.click();
    for (let attempt = 0; attempt < 800; attempt += 1) {
      const cancel = [...document.querySelectorAll(".kx-btn")].find(
        (element) => element.textContent?.trim() === "Cancel export",
      );
      if (cancel) {
        cancel.click();
        return { started: true, waitedMs: attempt * 5 };
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return { started: false, reason: "cancel button never appeared" };
  });
  await page
    .waitForFunction(
      () => !document.body.innerText.includes("Encoding video"),
      { timeout: 30000 },
    )
    .catch(() => undefined);
  const cancelState = await page.evaluate(() => ({
    exporting: document.body.innerText.includes("Encoding video"),
    hasVideo: Boolean(document.querySelector(".kx-preview video")),
    exportButton: [...document.querySelectorAll(".kx-btn")].some(
      (button) => button.textContent?.trim() === "Export WebM video",
    ),
  }));
  report.cancel = { cancelStart, cancelState };
  check(
    "templates: a video export can be cancelled without publishing a partial file",
    cancelStart.started &&
      !cancelState.exporting &&
      !cancelState.hasVideo &&
      cancelState.exportButton,
    { cancelStart, cancelState },
  );
  await shot(page, "03-export-cancelled");

  /* ------------------------------------------------------- WebM export */
  await selectRow(page, "2s");
  await clickButton(page, "Export WebM video");
  await page.waitForFunction(
    () => Boolean(document.querySelector(".kx-preview video")),
    { timeout: 120000, polling: 250 },
  );
  await sleep(500);
  const videoInfo = await page.evaluate(() => window.__KX.videoInfo());
  report.videoInfo = videoInfo;
  check(
    "templates: the exported video decodes at 1920×1080",
    videoInfo.width === 1920 && videoInfo.height === 1080,
    videoInfo,
  );
  check(
    "templates: the exported video has a real duration",
    videoInfo.duration > 1.5 && videoInfo.duration < 10,
    videoInfo,
  );

  const frameA = await page.evaluate(() => window.__KX.videoFrame(0.2));
  const frameB = await page.evaluate(() => window.__KX.videoFrame(0.9));
  const frameC = await page.evaluate(() => window.__KX.videoFrame(1.5));
  report.videoFrames = { frameA, frameB, frameC };
  check(
    "templates: two seeked video frames are different (the animation is encoded)",
    frameA.pixelSha256 !== frameB.pixelSha256,
    {
      first: { time: frameA.actualTime, sha: frameA.pixelSha256, dark: frameA.darkRatio },
      second: { time: frameB.actualTime, sha: frameB.pixelSha256, dark: frameB.darkRatio },
    },
  );
  check(
    "templates: the video is not a still image (three sampled frames show motion)",
    new Set([frameA.pixelSha256, frameB.pixelSha256, frameC.pixelSha256]).size >= 2,
    {
      times: [frameA.actualTime, frameB.actualTime, frameC.actualTime],
      distinctHashes: new Set([
        frameA.pixelSha256,
        frameB.pixelSha256,
        frameC.pixelSha256,
      ]).size,
    },
  );
  await shot(page, "04-video-exported");

  const videoDownload = await downloadAsset(page, "Download WebM", ".webm");
  report.videoDownload = videoDownload;
  check(
    "templates: the downloaded file is a real EBML/WebM container",
    videoDownload.isWebm && videoDownload.bytes > 1024,
    {
      name: videoDownload.name,
      bytes: videoDownload.bytes,
      magic: videoDownload.magic,
    },
  );

  await clickButton(page, "Save video to library");
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".kx-btn")].some(
        (button) => button.textContent?.trim() === "Video saved",
      ),
    { timeout: 20000 },
  );
  await sleep(250);
  const videoItem = await page.evaluate(() => window.__KX.persistedVideo(".webm"));
  report.videoItem = videoItem;
  check(
    "templates: the video is persisted in the library as video/webm",
    Boolean(
      videoItem &&
        videoItem.kind === "video" &&
        videoItem.mimeType === "video/webm" &&
        videoItem.size > 1024 &&
        videoItem.storedWidth === 1920 &&
        videoItem.storedHeight === 1080 &&
        videoItem.storedDuration > 1.5,
    ),
    videoItem && {
      name: videoItem.name,
      kind: videoItem.kind,
      mimeType: videoItem.mimeType,
      size: videoItem.size,
      width: videoItem.storedWidth,
      height: videoItem.storedHeight,
      duration: videoItem.storedDuration,
    },
  );
  check(
    "templates: the downloaded WebM equals the library-persisted bytes",
    Boolean(
      videoItem &&
        videoItem.sha256 === videoDownload.sha256 &&
        videoItem.size === videoDownload.bytes,
    ),
    {
      downloaded: { bytes: videoDownload.bytes, sha256: videoDownload.sha256 },
      saved: videoItem && { bytes: videoItem.size, sha256: videoItem.sha256 },
    },
  );

  /* ------------------------------------------- mock actions + cleanup */
  const mockActions = await page.evaluate(() =>
    [...document.querySelectorAll(".kx-btn")]
      .map((button) => button.textContent?.trim() ?? "")
      .filter((label) => /use template/i.test(label)),
  );
  check(
    "templates: no dead 'use template' button is offered for mock entries",
    mockActions.length === 0,
    mockActions,
  );

  const countersBefore = await page.evaluate(() => ({ ...window.__kxUrlCounters }));
  await page.evaluate(() => {
    window.location.hash = "#/";
  });
  // The dashboard legitimately renders its own .kx-preview, so wait for the
  // templates catalog rows to leave the DOM instead.
  await page.waitForFunction(() => !document.querySelector(".kx-template-card"), {
    timeout: 15000,
  });
  await sleep(500);
  const countersAfter = await page.evaluate(() => ({ ...window.__kxUrlCounters }));
  report.urlCounters = { before: countersBefore, after: countersAfter };
  check(
    "templates: unmounting revokes the frame and video object URLs",
    countersAfter.revoked > countersBefore.revoked,
    { before: countersBefore, after: countersAfter },
  );

  await page.evaluate(() => {
    window.location.hash = "#/templates";
  });
  await page.waitForSelector(".kx-template-card", { timeout: 20000 });
  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".kx-topbar button")].find(
      (element) => element.textContent?.trim() === "AR",
    );
    button?.click();
  });
  await sleep(700);
  const rtl = await page.evaluate(() => ({
    dir: document.documentElement.dir,
    lang: document.documentElement.lang,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  report.rtl = rtl;
  check("templates: Arabic mode switches the document to RTL", rtl.dir === "rtl", rtl);
  check("templates: no horizontal overflow in Arabic", rtl.overflow <= 0, rtl.overflow);
  await shot(page, "05-templates-arabic-rtl");

  check("templates: no uncaught page errors", report.pageErrors.length === 0, report.pageErrors);
  check(
    "templates: no console errors",
    report.consoleErrors.length === 0,
    report.consoleErrors,
  );
} catch (error) {
  report.fatal = String(error?.stack ?? error);
  console.error(`FATAL ${error?.stack ?? error}`);
} finally {
  await browser.close();
}

const failed = report.checks.filter((entry) => !entry.pass);
report.finishedAt = new Date().toISOString();
report.failed = failed.length;
await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));

console.log(
  `templates smoke: ${report.checks.length - failed.length}/${report.checks.length} checks passed`,
);
if (failed.length || report.fatal) process.exit(1);
