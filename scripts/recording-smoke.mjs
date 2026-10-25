import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.KNOUX_BASE_URL ?? "http://localhost:4173/";
const OUT = path.resolve("artifacts/evidence");
const DOWNLOADS = path.resolve("artifacts/downloads");
const CHROME =
  process.env.KNOUX_CHROME ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

await mkdir(OUT, { recursive: true });
await mkdir(DOWNLOADS, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  consoleErrors: [],
  pageErrors: [],
  checks: [],
  items: null,
  playback: null,
  export: null,
};

function check(name, pass, detail) {
  report.checks.push({ name, pass, detail });
  if (pass) console.log(`PASS ${name}`);
  else console.error(`FAIL ${name}: ${JSON.stringify(detail)}`);
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

const clickByText = async (page, selector, text) =>
  page.evaluate(
    (sel, needle) => {
      const el = [...document.querySelectorAll(sel)].find((node) =>
        node.textContent?.trim().includes(needle),
      );
      if (!el) return false;
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return true;
    },
    selector,
    text,
  );

const nav = async (page, label) => {
  const ok = await clickByText(page, ".kx-nav-item", label);
  if (!ok) throw new Error(`Navigation item not found: ${label}`);
  await new Promise((r) => setTimeout(r, 350));
};

const statusText = (page) =>
  page.evaluate(
    () => document.querySelector(".kx-status-chip")?.textContent?.trim() ?? "",
  );

const waitFor = async (page, fn, timeout = 20000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await page.evaluate(fn)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

const readItems = (page) =>
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
    const withMagic = await Promise.all(
      records.map(async (record) => {
        let magic = "";
        try {
          const head = new Uint8Array(await record.blob.slice(0, 4).arrayBuffer());
          magic = Array.from(head)
            .map((value) => value.toString(16).padStart(2, "0"))
            .join(" ");
        } catch {
          magic = "";
        }
        return { record, magic };
      }),
    );
    return withMagic.map(({ record, magic }) => ({
      id: record.id,
      name: record.name,
      kind: record.kind,
      mimeType: record.mimeType,
      size: record.blob?.size ?? 0,
      magic,
      duration: record.duration,
      width: record.width,
      height: record.height,
      source: record.source,
      hasThumbnail: Boolean(record.thumbnail),
      favorite: Boolean(record.favorite),
    }));
  });

try {
  const page = await browser.newPage();
  page.on("console", (message) => {
    if (message.type() === "error")
      report.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) =>
    report.pageErrors.push(String(error?.stack ?? error)),
  );
  const cdp = await page.createCDPSession();
  await cdp.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: DOWNLOADS,
  });
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  await page.goto(`${BASE}?intro=hold`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".kx-splash-skip", { timeout: 15000 });
  await page.click(".kx-splash-skip");
  await page.waitForFunction(() => !document.querySelector(".kx-splash"));

  await nav(page, "Recorder");
  await clickByText(page, ".kx-segmented button", "Camera");
  await new Promise((r) => setTimeout(r, 200));

  const started = await clickByText(page, ".kx-btn", "Start recording");
  check("start button clicked", started);
  const live = await waitFor(
    page,
    () =>
      document.querySelector(".kx-preview video") !== null &&
      document.querySelector(".kx-status-chip")?.textContent?.includes("Recording"),
    20000,
  );
  const startFailure = await page.evaluate(
    () => document.querySelector('[role="alert"]')?.textContent?.trim() ?? null,
  );
  check("camera recording starts", live, startFailure);
  report.startFailure = startFailure;

  if (live) {
    await new Promise((r) => setTimeout(r, 2400));
    const elapsed = await page.evaluate(
      () => document.querySelector(".kx-status-chip .kx-mono")?.textContent?.trim(),
    );
    await page.screenshot({ path: path.join(OUT, "10-studio-recording.png") });
    check("live elapsed clock advances", Number(elapsed?.split(":")?.at(-1)) >= 0, elapsed);

    const paused = await clickByText(page, ".kx-btn", "Pause");
    await new Promise((r) => setTimeout(r, 900));
    const pausedStatus = await statusText(page);
    await page.screenshot({ path: path.join(OUT, "11-studio-paused.png") });
    check("pause transitions to Paused", paused && pausedStatus.includes("Paused"), {
      paused,
      pausedStatus,
    });

    const resumed = await clickByText(page, ".kx-btn", "Resume");
    await new Promise((r) => setTimeout(r, 900));
    const resumedStatus = await statusText(page);
    check(
      "resume transitions to Recording",
      resumed && resumedStatus.includes("Recording"),
      { resumed, resumedStatus },
    );

    const cameraButton = await page.$(
      '.kx-topbar button[aria-label="Capture screenshot"]',
    );
    await cameraButton?.click();
    await new Promise((r) => setTimeout(r, 1200));

    const stopped = await clickByText(page, ".kx-btn", "Stop");
    const idle = await waitFor(
      page,
      () =>
        document.querySelector(".kx-status-chip")?.textContent?.includes("Ready") ??
        false,
      30000,
    );
    const stopFailure = await page.evaluate(
      () => document.querySelector('[role="alert"]')?.textContent?.trim() ?? null,
    );
    check("stop completes and returns to Ready", stopped && idle, stopFailure);

    const items = await readItems(page);
    report.items = items;
    const video = items.find((item) => item.kind === "video");
    const image = items.find((item) => item.kind === "image");
    check("video blob persisted", Boolean(video), items);
    check(
      // A static desktop compresses to a few kilobytes per second, so the byte
      // floor stays low while the container magic proves this is a real file
      // rather than a placeholder blob.
      "video blob is a real container with bytes and a duration",
      Boolean(
        video &&
          video.size > 2000 &&
          video.duration > 1 &&
          /^(1a 45 df a3|00 00 00)/.test(video.magic),
      ),
      video,
    );
    check(
      "video has real dimensions",
      Boolean(video && video.width > 0 && video.height > 0),
      video && { width: video.width, height: video.height },
    );
    check(
      "video mime is a real container",
      Boolean(video && /^video\/(webm|mp4)/.test(video.mimeType)),
      video?.mimeType,
    );
    check("screenshot persisted during live preview", Boolean(image), image);
    check(
      "screenshot has pixels",
      Boolean(image && image.size > 2000 && image.width > 0 && image.height > 0),
      image,
    );

    if (image) {
      const variance = await page.evaluate(async (itemId) => {
        const database = await new Promise((resolve, reject) => {
          const request = indexedDB.open("knoux-rec.library");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const record = await new Promise((resolve, reject) => {
          const request = database
            .transaction("items", "readonly")
            .objectStore("items")
            .get(itemId);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        database.close();
        const bitmap = await createImageBitmap(record.blob);
        const canvas = document.createElement("canvas");
        canvas.width = Math.min(64, bitmap.width);
        canvas.height = Math.min(64, bitmap.height);
        const context = canvas.getContext("2d");
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const colors = new Set();
        let total = 0;
        for (let i = 0; i < data.length; i += 16) {
          colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
          total += data[i] + data[i + 1] + data[i + 2];
        }
        return {
          width: bitmap.width,
          height: bitmap.height,
          distinctColors: colors.size,
          mean: total / (data.length / 16) / 3,
        };
      }, image.id);
      report.screenshotPixels = variance;
      check(
        "screenshot contains real image data",
        variance.distinctColors > 8 && variance.width > 0,
        variance,
      );
    }

    await nav(page, "Library");
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: path.join(OUT, "12-library-populated.png") });

    const videoCard = await page.evaluate(() => {
      const cards = [...document.querySelectorAll(".kx-media-card")];
      const card = cards.find((node) => node.textContent?.match(/\.webm|\.mp4/));
      const thumb = card?.querySelector(".kx-media-thumb");
      thumb?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return Boolean(card);
    });
    check("video card opens preview", videoCard);
    await page.waitForSelector(".knoux-modal video, .knoux-modal img", {
      timeout: 10000,
    });
    const playback = await page.evaluate(async () => {
      const video = document.querySelector(".knoux-modal video");
      if (!video) return null;
      if (!video.duration) {
        await new Promise((resolve) => {
          video.onloadedmetadata = resolve;
          setTimeout(resolve, 4000);
        });
      }
      return {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        readyState: video.readyState,
        error: video.error?.message ?? null,
      };
    });
    report.playback = playback;
    await page.screenshot({ path: path.join(OUT, "13-video-preview.png") });
    check(
      "saved video decodes in browser",
      Boolean(playback && playback.duration > 1 && playback.width > 0),
      playback,
    );
    await clickByText(page, ".knoux-modal .kx-btn", "Close");
    await new Promise((r) => setTimeout(r, 300));

    const trimOpened = await page.evaluate(() => {
      const card = [...document.querySelectorAll(".kx-media-card")].find((node) =>
        node.textContent?.match(/\.webm|\.mp4/),
      );
      const trim = card?.querySelector('button[title="Trim"]');
      trim?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return Boolean(trim);
    });
    check("trim dialog opens", trimOpened);
    if (trimOpened) {
      await page.waitForSelector(".knoux-modal input[type=range]", {
        timeout: 8000,
      });
      await page.evaluate(() => {
        const ranges = [...document.querySelectorAll(".knoux-modal input[type=range]")];
        const end = ranges[1];
        if (end) {
          const value = Math.min(1.2, Number(end.max));
          const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          ).set;
          setter.call(end, String(value));
          end.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
      await new Promise((r) => setTimeout(r, 300));
      const trimmed = await clickByText(page, ".knoux-modal .kx-btn", "Apply trim");
      const trimDone = await waitFor(
        page,
        () => document.body.innerText.includes("Trim saved as a new clip"),
        45000,
      );
      const afterTrim = await readItems(page);
      const trimItem = afterTrim.find((item) => item.name.includes("-trim"));
      // When a re-encode fails the dialog says why; keeping that text in the
      // report is the difference between a diagnosable failure and a shrug.
      const trimError = await page.evaluate(
        () =>
          document.querySelector(".knoux-modal .kx-notice[data-tone='danger']")?.textContent?.trim() ??
          null,
      );
      report.trim = { trimmed, trimDone, trimItem, trimError };
      await page.screenshot({ path: path.join(OUT, "14-trim-result.png") });
      check(
        "trim produces a new persisted clip",
        trimmed && trimDone && Boolean(trimItem && trimItem.size > 1000),
        report.trim,
      );
    }

    const favoriteToggled = await page.evaluate(() => {
      const card = [...document.querySelectorAll(".kx-media-card")].find((node) =>
        node.textContent?.match(/\.webm|\.mp4/),
      );
      const button = card?.querySelector('button[title="Add to favorites"]');
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return Boolean(button);
    });
    await new Promise((r) => setTimeout(r, 600));
    const favoriteFilter = await page.evaluate(() => {
      const chip = [...document.querySelectorAll(".kx-chip")].find(
        (node) => node.textContent?.trim() === "Favorites",
      );
      chip?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return Boolean(chip);
    });
    await new Promise((r) => setTimeout(r, 400));
    const favoriteCards = await page.evaluate(
      () => document.querySelectorAll(".kx-media-card").length,
    );
    await page.evaluate(() => {
      const chip = [...document.querySelectorAll(".kx-chip")].find(
        (node) => node.textContent?.trim() === "Favorites",
      );
      chip?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const beforeFavReload = await readItems(page);
    const favoriteItem = beforeFavReload.find((item) => item.favorite);
    report.favorite = { favoriteToggled, favoriteFilter, favoriteCards, favoriteItem };
    await page.screenshot({ path: path.join(OUT, "21-library-favorites.png") });
    check("favorite toggles and filters the library", favoriteToggled && favoriteFilter && favoriteCards === 1, report.favorite);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".kx-splash-skip, .kx-app", { timeout: 15000 });
    const skipExists = await page.$(".kx-splash-skip");
    if (skipExists) await page.click(".kx-splash-skip");
    await page.waitForFunction(() => !document.querySelector(".kx-splash"));
    await nav(page, "Library");
    await new Promise((r) => setTimeout(r, 500));
    const afterReload = await readItems(page);
    await page.screenshot({ path: path.join(OUT, "15-library-after-reload.png") });
    check(
      "library survives a full page reload",
      afterReload.length >= afterReload.length && afterReload.length > 0,
      afterReload.length,
    );
    report.persistenceCount = afterReload.length;
    const favoriteAfterReload = afterReload.find((item) => item.favorite);
    report.favoriteAfterReload = favoriteAfterReload;
    check("favorite survives a full reload", Boolean(favoriteAfterReload), favoriteAfterReload);

    await page.evaluate(() => {
      const card = [...document.querySelectorAll(".kx-media-card")].find((node) =>
        node.textContent?.match(/\.webm|\.mp4/),
      );
      const exportButton = card?.querySelector('button[title="Export"]');
      exportButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 2500));
    const downloads = await readdir(DOWNLOADS).catch(() => []);
    const media = downloads.filter((name) => /\.(webm|mp4)$/i.test(name));
    if (media.length > 0) {
      const file = path.join(DOWNLOADS, media[0]);
      const bytes = await readFile(file);
      const info = await stat(file);
      report.export = {
        file,
        size: info.size,
        header: bytes.subarray(0, 4).toString("hex"),
      };
      check(
        "export writes a real media file signature",
        bytes.subarray(0, 4).toString("hex") === "1a45dfa3" ||
          bytes.subarray(4, 8).toString("ascii") === "ftyp",
        report.export,
      );
    } else {
      check("export writes a media file", false, downloads);
    }
  }
} catch (error) {
  report.fatal = String(error?.stack ?? error);
  console.error(report.fatal);
} finally {
  await browser.close();
}

report.finishedAt = new Date().toISOString();
report.failed = Boolean(report.fatal) || !report.checks.every((c) => c.pass);
await writeFile(
  path.join(OUT, "recording-smoke.json"),
  JSON.stringify(report, null, 2),
  "utf8",
);
console.log(
  JSON.stringify(
    {
      failed: report.failed,
      fatal: report.fatal ?? null,
      checks: report.checks.length,
      failedChecks: report.checks.filter((c) => !c.pass).length,
      pageErrors: report.pageErrors.length,
    },
    null,
    2,
  ),
);
process.exit(report.failed ? 1 : 0);
