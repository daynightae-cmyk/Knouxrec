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
    "--use-fake-device-for-media-stream",
    "--deny-permission-prompts",
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
  const context = browser.defaultBrowserContext();
  await context.overridePermissions("http://localhost:4173", []);
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
  await page.evaluate(() =>
    [...document.querySelectorAll(".kx-segmented button")]
      .find((el) => el.textContent?.trim() === "Camera")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  await new Promise((r) => setTimeout(r, 200));
  await page.evaluate(() =>
    [...document.querySelectorAll(".kx-btn")]
      .find((el) => el.textContent?.includes("Start recording"))
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );

  const sawError = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 15000);
    const poll = setInterval(() => {
      page
        .evaluate(
          () =>
            document
              .querySelector(".kx-status-chip")
              ?.textContent?.includes("Recorder error") ?? false,
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

  const state = await page.evaluate(() => ({
    status: document.querySelector(".kx-status-chip")?.textContent?.trim(),
    alert: document.querySelector('[role="alert"]')?.textContent?.trim(),
    supportReason: document.body.innerText.includes("Screen capture is unavailable"),
    dismiss: [...document.querySelectorAll(".kx-btn")].some(
      (el) => el.textContent?.trim() === "Dismiss",
    ),
    video: Boolean(document.querySelector(".kx-preview video")),
    startEnabled: ![...document.querySelectorAll(".kx-btn")]
      .find((el) => el.textContent?.includes("Start recording"))
      ?.hasAttribute("disabled"),
  }));
  report.state = state;
  await page.screenshot({ path: path.join(OUT, "19-camera-permission-denied.png") });
  check("denied camera surfaces recorder error", sawError, state);
  check("error copy mentions permission", /permission|denied|allowed/i.test(state.alert ?? ""), state.alert);
  check("no fake preview appears after denial", state.video === false, state.video);
  check("start control can be retried", state.startEnabled === true, state.startEnabled);

  if (state.dismiss) {
    await page.evaluate(() =>
      [...document.querySelectorAll(".kx-btn")]
        .find((el) => el.textContent?.trim() === "Dismiss")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    await new Promise((r) => setTimeout(r, 500));
    const recovered = await page.evaluate(() => ({
      status: document.querySelector(".kx-status-chip")?.textContent?.trim(),
      alert: Boolean(document.querySelector('[role="alert"]')),
    }));
    report.recovered = recovered;
    check(
      "dismiss recovers to idle",
      recovered.status?.includes("Ready") && recovered.alert === false,
      recovered,
    );
    await page.screenshot({ path: path.join(OUT, "20-camera-denied-recovered.png") });
  }
} catch (error) {
  report.fatal = String(error?.stack ?? error);
} finally {
  await browser.close();
}

report.failed = Boolean(report.fatal) || report.checks.some((c) => !c.pass);
await writeFile(
  path.join(OUT, "error-state-smoke.json"),
  JSON.stringify(report, null, 2),
  "utf8",
);
console.log(JSON.stringify({ failed: report.failed, fatal: report.fatal ?? null }, null, 2));
process.exit(report.failed ? 1 : 0);
