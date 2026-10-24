import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.KNOUX_BASE_URL ?? "http://localhost:4173/";
const OUT = path.resolve("artifacts/evidence");
const CHROME =
  process.env.KNOUX_CHROME ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

await mkdir(OUT, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  base: BASE,
  chrome: CHROME,
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
  routes: [],
  layout: [],
  checks: [],
};

function check(name, pass, detail) {
  report.checks.push({ name, pass, detail });
  if (!pass) console.error(`FAIL ${name}: ${JSON.stringify(detail)}`);
  else console.log(`PASS ${name}`);
}

function wire(page, tag) {
  page.on("console", (message) => {
    if (message.type() === "error") {
      report.consoleErrors.push({ tag, text: message.text() });
    }
  });
  page.on("pageerror", (error) => {
    report.pageErrors.push({ tag, text: String(error?.stack ?? error) });
  });
  page.on("requestfailed", (request) => {
    report.failedRequests.push({
      tag,
      url: request.url(),
      reason: request.failure()?.errorText ?? "unknown",
    });
  });
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

async function waitForApp(page) {
  await page.waitForSelector(".kx-app", { timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector(".kx-splash"), {
    timeout: 15000,
  });
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
    "--no-default-browser-check",
    "--disable-features=Translate,MediaRouter",
  ],
});

try {
  const page = await browser.newPage();
  wire(page, "shell");
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  await page.goto(`${BASE}?intro=hold`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".kx-splash-name", { timeout: 10000 });
  const splashState = await page.evaluate(() => ({
    name: document.querySelector(".kx-splash-name")?.textContent?.trim(),
    steps: [...document.querySelectorAll(".kx-splash-step")].map((el) => ({
      label: el.textContent?.trim(),
      state: el.getAttribute("data-state"),
    })),
    progress: document
      .querySelector(".kx-splash-progress span")
      ?.getAttribute("style"),
  }));
  const splash = await shot(page, "01-splash");
  report.splash = { file: splash, ...splashState };
  check("splash renders brand", splashState.name === "KNOUXREC", splashState.name);
  check(
    "splash shows real step states",
    splashState.steps.length === 5 &&
      splashState.steps.every((s) => s.state !== undefined) &&
      ["active", "done", "warn"].includes(splashState.steps[4]?.state),
    splashState.steps,
  );

  await page.click(".kx-splash-skip");
  await waitForApp(page);
  const dashboard = await shot(page, "02-dashboard-idle");
  const shell = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
    theme: document.documentElement.dataset.theme,
    hash: window.location.hash,
    title: document.title,
    nav: [...document.querySelectorAll(".kx-nav-item")].map((el) =>
      el.textContent?.trim(),
    ),
    overflow:
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  }));
  report.shell = shell;
  check("dashboard idle screenshot", true, dashboard);
  check("16 navigation routes registered", shell.nav.length === 16, shell.nav);
  check("document language is English", shell.lang === "en", shell.lang);
  check("no horizontal overflow at 1600x1000", shell.overflow <= 0, shell.overflow);

  const routes = await page.evaluate(() =>
    [...document.querySelectorAll(".kx-nav-item")].map((el, index) => ({
      index,
      label: el.textContent?.trim() ?? "",
    })),
  );

  for (const route of routes) {
    await page.evaluate((index) => {
      const buttons = document.querySelectorAll(".kx-nav-item");
      buttons[index]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }, route.index);
    await new Promise((r) => setTimeout(r, 420));
    const state = await page.evaluate(() => ({
      hash: window.location.hash,
      heading:
        document.querySelector(".kx-view-title, .kx-hero-title")?.textContent?.trim() ??
        "",
      active: document
        .querySelector('.kx-nav-item[aria-current="page"]')
        ?.textContent?.trim(),
      empty:
        document.querySelector(".kx-empty-title")?.textContent?.trim() ?? null,
      overflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      bodyText: document.body.innerText.slice(0, 160),
    }));
    const slug = state.hash.replace(/^#\/?/, "") || "dashboard";
    const file = await shot(page, `route-${slug}`);
    report.routes.push({ ...route, ...state, file });
    check(
      `route ${route.label} opens ${slug}`,
      state.hash === `#/${slug}` && Boolean(state.active),
      state,
    );
    check(`route ${slug} no horizontal overflow`, state.overflow <= 0, state.overflow);
  }

  await page.evaluate(() =>
    [...document.querySelectorAll(".kx-nav-item")]
      .find((el) => el.textContent?.trim() === "Settings")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  await new Promise((r) => setTimeout(r, 300));

  const lastNav = (await page.$$(".kx-nav-item")).at(-1);
  await lastNav?.click();
  await new Promise((r) => setTimeout(r, 400));
  const scrolledNav = await page.evaluate(() => ({
    hash: window.location.hash,
    active: document
      .querySelector('.kx-nav-item[aria-current="page"]')
      ?.textContent?.trim(),
    settingsVisible: (() => {
      const el = [...document.querySelectorAll(".kx-nav-item")].find((node) =>
        node.textContent?.includes("Settings"),
      );
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const nav = document.querySelector(".kx-nav")?.getBoundingClientRect();
      return Boolean(nav && rect.top >= nav.top && rect.bottom <= nav.bottom);
    })(),
  }));
  check(
    "sidebar scroll reaches last route by real click",
    scrolledNav.hash === "#/diagnostics" && Boolean(scrolledNav.active),
    scrolledNav,
  );
  await page.evaluate(() =>
    [...document.querySelectorAll(".kx-nav-item")]
      .find((el) => el.textContent?.trim() === "Settings")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  await new Promise((r) => setTimeout(r, 300));
  const themeButton = await page.$(
    '.kx-topbar button[aria-label="Light"], .kx-topbar button[aria-label="Dark"]',
  );
  if (themeButton) {
    await themeButton.click();
    await new Promise((r) => setTimeout(r, 350));
  }
  const lightTheme = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    bg: getComputedStyle(document.body).backgroundColor,
  }));
  await shot(page, "03-settings-light");
  report.lightTheme = lightTheme;
  check("light theme toggle applies", lightTheme.theme === "light", lightTheme);
  await themeButton?.click();
  await new Promise((r) => setTimeout(r, 250));

  const langButton = await page.$(
    '.kx-topbar button[aria-label="Switch to Arabic"], .kx-topbar button[aria-label="Switch to English"]',
  );
  await langButton?.click();
  await new Promise((r) => setTimeout(r, 500));
  const arabic = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
    heading: document.querySelector(".kx-view-title")?.textContent?.trim(),
    nav: [...document.querySelectorAll(".kx-nav-item")].slice(0, 3).map((el) =>
      el.textContent?.trim(),
    ),
    overflow:
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  }));
  await shot(page, "04-settings-arabic-rtl");
  report.arabic = arabic;
  check("Arabic switches language and RTL", arabic.lang === "ar" && arabic.dir === "rtl", arabic);
  check("Arabic layout has no horizontal overflow", arabic.overflow <= 0, arabic.overflow);
  await langButton?.click();
  await new Promise((r) => setTimeout(r, 350));

  const dashButton = await page.$(".kx-nav-item");
  await dashButton?.click();
  await new Promise((r) => setTimeout(r, 350));

  await page.evaluate(() => {
    [...document.querySelectorAll(".kx-nav-item")]
      .find((el) => el.textContent?.trim() === "Recorder")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => {
    [...document.querySelectorAll(".kx-nav-item")]
      .find((el) => el.textContent?.trim() === "Library")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 350));
  const breadcrumb = await page.evaluate(() =>
    document.querySelector(".kx-breadcrumb")?.textContent?.replace(/\s+/g, " ").trim(),
  );
  await page.click(".kx-history .kx-icon-button:nth-of-type(1)");
  await new Promise((r) => setTimeout(r, 450));
  const afterBack = await page.evaluate(() => window.location.hash);
  await page.click(".kx-history .kx-icon-button:nth-of-type(2)");
  await new Promise((r) => setTimeout(r, 450));
  const afterForward = await page.evaluate(() => window.location.hash);
  report.history = { breadcrumb, afterBack, afterForward };
  check("breadcrumb shows group and route", /Library/.test(breadcrumb ?? ""), breadcrumb);
  check("back returns to previous route", afterBack === "#/studio", afterBack);
  check("forward restores next route", afterForward === "#/library", afterForward);

  for (const [label, width, height, dsf] of [
    ["125", 1536, 960, 1.25],
    ["150", 1280, 800, 1.5],
  ]) {
    await page.setViewport({ width, height, deviceScaleFactor: dsf });
    await new Promise((r) => setTimeout(r, 300));
    const metrics = await page.evaluate(() => ({
      overflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      dpr: window.devicePixelRatio,
      inner: [window.innerWidth, window.innerHeight],
    }));
    const file = await shot(page, `05-dpi-${label}`);
    report.layout.push({ label, width, height, dsf, ...metrics, file });
    check(`DPI ${label}% dpr=${dsf}`, metrics.dpr === dsf, metrics);
    check(`DPI ${label}% no horizontal overflow`, metrics.overflow <= 0, metrics);
  }

  await page.setViewport({ width: 1024, height: 700, deviceScaleFactor: 1 });
  await new Promise((r) => setTimeout(r, 300));
  const minLayout = await page.evaluate(() => ({
    overflow:
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    sidebar: document.querySelector(".kx-sidebar")?.clientWidth,
  }));
  const minFile = await shot(page, "06-min-window-1024x700");
  report.minLayout = { ...minLayout, file: minFile };
  check("min window 1024x700 has no horizontal overflow", minLayout.overflow <= 0, minLayout);

  await page.emulateMediaFeatures([
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".kx-splash-skip", { timeout: 10000 });
  await page.click(".kx-splash-skip");
  await waitForApp(page);
  const reduced = await shot(page, "07-reduced-motion-dashboard");
  const reducedMetrics = await page.evaluate(() => {
    const el = document.querySelector(".kx-hero");
    const style = el ? getComputedStyle(el) : null;
    return { animationDuration: style?.animationDuration ?? null };
  });
  report.reducedMotion = { ...reducedMetrics, file: reduced };
  check(
    "reduced motion honored",
    parseFloat(reducedMetrics.animationDuration ?? "") <= 0.01 ||
      reducedMetrics.animationDuration === "0s" ||
      reducedMetrics.animationDuration === null,
    reducedMetrics,
  );
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);

  const persisted = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    theme: document.documentElement.dataset.theme,
    hash: window.location.hash,
    storage: localStorage.getItem("knoux-rec.settings.v1"),
  }));
  report.persisted = persisted;
  check("settings persist across reload", Boolean(persisted.storage), persisted);

  await browser.close();
} catch (error) {
  report.fatal = String(error?.stack ?? error);
  await browser.close();
}

report.finishedAt = new Date().toISOString();
report.failed = Boolean(report.fatal) || !report.checks.every((c) => c.pass);
await writeFile(
  path.join(OUT, "ui-smoke.json"),
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
      consoleErrors: report.consoleErrors.length,
      pageErrors: report.pageErrors.length,
      failedRequests: report.failedRequests.length,
    },
    null,
    2,
  ),
);
process.exit(report.failed ? 1 : 0);
