import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
  args: ["--window-size=900,400"],
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 400, deviceScaleFactor: 2 });
await page.goto("http://localhost:4173/?intro=hold", { waitUntil: "networkidle0" });
await page.waitForSelector(".kx-splash-skip");
await page.click(".kx-splash-skip");
await page.waitForFunction(() => !document.querySelector(".kx-splash"));
await page.evaluate(() => {
  const wrap = document.createElement("div");
  wrap.style.cssText =
    "position:fixed;inset:0;z-index:99999;background:#0a0a0b;color:#fff;padding:30px;font-size:40px;display:flex;flex-direction:column;gap:16px";
  wrap.innerHTML = `
    <div style="font-family:Orbitron;font-weight:700">Orbitron 700 0123456789 00:00 0 B</div>
    <div style="font-family:Rajdhani;font-weight:700">Rajdhani 700 0123456789 00:00 0 B</div>
    <div style="font-family:Inter;font-weight:700">Inter 700 0123456789 00:00 0 B</div>
    <div style="font-family:Orbitron;font-weight:700;font-variant-numeric:normal">Orbitron normal numerals 0123456789 00:00</div>
  `;
  document.body.appendChild(wrap);
});
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: "artifacts/evidence/inspect-font.png" });
await browser.close();
