import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.KNOUX_BASE_URL ?? "http://localhost:4173/";
const OUT = path.resolve("artifacts/evidence");
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--auto-select-desktop-capture-source=Entire screen",
    "--autoplay-policy=no-user-gesture-required",
    "--window-size=1600,1000",
  ],
});
const report = { checks: [], consoleErrors: [], pageErrors: [] };
const check = (name, pass, detail) => {
  report.checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${name} ${pass ? "" : JSON.stringify(detail)}`);
};

try {
  const page = await browser.newPage();
  page.on("console", (m) => m.type() === "error" && report.consoleErrors.push(m.text()));
  page.on("pageerror", (e) => report.pageErrors.push(String(e)));
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  await page.goto(`${BASE}?intro=hold`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".kx-splash-skip", { timeout: 15000 });
  await page.click(".kx-splash-skip");
  await page.waitForFunction(() => !document.querySelector(".kx-splash"));
  await page.evaluate(() =>
    [...document.querySelectorAll(".kx-nav-item")]
      .find((el) => el.textContent?.trim() === "Recorder")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  await new Promise((r) => setTimeout(r, 400));

  report.support = await page.evaluate(() => ({
    display: typeof navigator.mediaDevices?.getDisplayMedia === "function",
    mediaRecorder: typeof MediaRecorder !== "undefined",
    codecs: [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/mp4",
    ].filter((type) => MediaRecorder.isTypeSupported(type)),
  }));

  const started = await page.evaluate(() =>
    [...document.querySelectorAll(".kx-btn")]
      .find((el) => el.textContent?.includes("Start recording"))
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  const live = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 12000);
    const poll = setInterval(() => {
      page
        .evaluate(
          () =>
            Boolean(document.querySelector(".kx-preview video")) &&
            document
              .querySelector(".kx-status-chip")
              ?.textContent?.includes("Recording"),
        )
        .then((value) => {
          if (value) {
            clearInterval(poll);
            clearTimeout(timer);
            resolve(true);
          }
        })
        .catch(() => undefined);
    }, 300);
  });
  report.errorNotice = await page.evaluate(
    () => document.querySelector('[role="alert"]')?.textContent?.trim() ?? null,
  );
  await page.screenshot({ path: path.join(OUT, "16-screen-capture-attempt.png") });
  check("screen capture starts under fake picker", live, {
    started,
    error: report.errorNotice,
  });

  if (live) {
    await new Promise((r) => setTimeout(r, 2600));
    await page.screenshot({ path: path.join(OUT, "17-screen-recording.png") });
    await page.evaluate(() =>
      [...document.querySelectorAll(".kx-btn")]
        .find((el) => el.textContent?.includes("Stop"))
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    const idle = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 30000);
      const poll = setInterval(() => {
        page
          .evaluate(
            () =>
              document
                .querySelector(".kx-status-chip")
                ?.textContent?.includes("Ready") ?? false,
          )
          .then((value) => {
            if (value) {
              clearInterval(poll);
              clearTimeout(timer);
              resolve(true);
            }
          })
          .catch(() => undefined);
      }, 300);
    });
    const items = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("knoux-rec.library");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const records = await new Promise((resolve, reject) => {
        const request = db.transaction("items", "readonly").objectStore("items").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return records.map((r) => ({
        name: r.name,
        size: r.blob?.size,
        type: r.mimeType,
        width: r.width,
        height: r.height,
        duration: r.duration,
      }));
    });
    report.items = items;
    await page.evaluate(() =>
      [...document.querySelectorAll(".kx-nav-item")]
        .find((el) => el.textContent?.trim() === "Library")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    await new Promise((r) => setTimeout(r, 500));
    await page.screenshot({ path: path.join(OUT, "18-screen-library.png") });
    check("screen capture saves a video", idle && items.length > 0, items);
  }
} catch (error) {
  report.fatal = String(error?.stack ?? error);
} finally {
  await browser.close();
}

report.failed = Boolean(report.fatal) || report.checks.some((c) => !c.pass);
await writeFile(
  path.join(OUT, "screen-capture-smoke.json"),
  JSON.stringify(report, null, 2),
  "utf8",
);
console.log(JSON.stringify({ failed: report.failed, fatal: report.fatal ?? null }, null, 2));
process.exit(report.failed ? 1 : 0);
