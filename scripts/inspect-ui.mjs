import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
  args: ["--window-size=1600,1000", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 });
await page.goto("http://localhost:4173/?intro=hold", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".kx-splash-skip");
await page.click(".kx-splash-skip");
await page.waitForFunction(() => !document.querySelector(".kx-splash"));
await new Promise((r) => setTimeout(r, 600));

const info = await page.evaluate(() => {
  const stat = document.querySelector(".kx-stat-value");
  const nav = document.querySelector(".kx-nav");
  const sidebar = document.querySelector(".kx-sidebar");
  const footer = document.querySelector(".kx-sidebar-footer");
  const style = stat ? getComputedStyle(stat) : null;
  return {
    statText: JSON.stringify(stat?.textContent),
    statFont: style?.fontFamily,
    statWeight: style?.fontWeight,
    statSize: style?.fontSize,
    statLetterSpacing: style?.letterSpacing,
    statBox: stat?.getBoundingClientRect().toJSON(),
    fonts: [...document.fonts].map((f) => `${f.family} ${f.weight} ${f.status}`),
    nav: nav?.getBoundingClientRect().toJSON(),
    navScroll: nav ? { scrollHeight: nav.scrollHeight, clientHeight: nav.clientHeight, overflowY: getComputedStyle(nav).overflowY } : null,
    sidebar: sidebar?.getBoundingClientRect().toJSON(),
    footer: footer?.getBoundingClientRect().toJSON(),
    lastNav: [...document.querySelectorAll(".kx-nav-item")].at(-1)?.getBoundingClientRect().toJSON(),
  };
});
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: "artifacts/evidence/inspect-stats.png", clip: { x: 280, y: 540, width: 1290, height: 160 } });
await browser.close();
