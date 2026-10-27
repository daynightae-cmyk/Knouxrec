#!/usr/bin/env node
/**
 * KNOUX REC — corporate identity (About) smoke.
 *
 * The About screen is the company's official presence inside the application,
 * so it is held to three things: the genuine artwork, the exact destinations,
 * and actions that report what really happened.
 *
 *   - the route is reachable from the real sidebar and renders five sections,
 *   - the bundled KNOUX logo decodes at its official size, undistorted,
 *   - every contact and social href matches the supplied directory exactly,
 *   - company pages are labelled apart from the founder's own profiles,
 *   - copy actions put the real value on the system clipboard,
 *   - a mailto:/tel: click reports an honest outcome, never a fake success,
 *   - keyboard focus reaches the contact actions,
 *   - Arabic renders translated in RTL, narrow widths do not overflow, the
 *     light theme stays readable, and nothing loads a remote image.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.KNOUX_BASE_URL ?? "http://localhost:4173/";
const OUT = path.resolve("artifacts/evidence/about");
const CHROME =
  process.env.KNOUX_CHROME ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

await mkdir(OUT, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  checks: [],
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
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

const waitFor = async (page, fn, timeout = 20000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await page.evaluate(fn)) return true;
    await sleep(300);
  }
  return false;
};


/** Scrolls a section to the top of the viewport so the shot is not a repeat of the hero. */
async function shootSection(page, section, name) {
  await page.evaluate((id) => {
    const node = document.querySelector(`[data-about-section="${id}"]`);
    node?.scrollIntoView({ block: "start" });
  }, section);
  await sleep(450);
  await shot(page, name);
}

const OFFICIAL_HREFS = {
  website: "https://knoux.store/",
  email: "mailto:admin@knoux.store",
  phone: "tel:+971503281920",
  whatsapp: "https://wa.me/971503281920",
  facebookCompany: "https://www.facebook.com/knouxStore/",
  facebookFounder: "https://www.facebook.com/CopSadek",
  githubEngineering: "https://github.com/daynightae-cmyk",
  githubCompany: "https://github.com/knoux-io",
  tiktok: "https://www.tiktok.com/@knoux_7",
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--window-size=1500,980",
    "--no-first-run",
  ],
  defaultViewport: { width: 1500, height: 980 },
});

try {
  const context = browser.defaultBrowserContext();
  await context.overridePermissions(new URL(BASE).origin, [
    "clipboard-read",
    "clipboard-write",
  ]);

  const page = await browser.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => report.pageErrors.push(String(error)));
  page.on("requestfailed", (request) =>
    report.failedRequests.push(`${request.url()} :: ${request.failure()?.errorText}`),
  );

  await page.goto(`${BASE}?intro=hold#/about`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".kx-splash-skip", { timeout: 20000 });
  await page.click(".kx-splash-skip");
  await page.waitForSelector("[data-about-view]", { timeout: 20000 });
  await sleep(300);
  await page.bringToFront();

  /* ------------------------------------------------ navigation */
  const nav = await page.evaluate(() => {
    const item = [...document.querySelectorAll(".kx-nav-item")].find((node) =>
      node.textContent?.includes("About KNOUX"),
    );
    item?.click();
    return { found: Boolean(item) };
  });
  await sleep(500);
  const routed = await page.evaluate(() => ({
    hash: window.location.hash,
    active: document
      .querySelector('.kx-nav-item[aria-current="page"]')
      ?.textContent?.trim(),
  }));
  check(
    "about: reachable from the real sidebar and marked current",
    nav.found && routed.hash === "#/about" && /About KNOUX/.test(routed.active ?? ""),
    routed,
  );

  const sections = await page.evaluate(() =>
    [...document.querySelectorAll("[data-about-section]")].map((node) =>
      node.getAttribute("data-about-section"),
    ),
  );
  check(
    "about: the five sections render in order",
    JSON.stringify(sections) ===
      JSON.stringify(["hero", "founder", "contact", "social", "signature"]),
    sections,
  );

  /* ------------------------------------------------ the genuine logo */
  await waitFor(page, () => {
    const img = document.querySelector("[data-about-logo]");
    return Boolean(img && img.complete && img.naturalWidth > 0);
  });
  const logo = await page.evaluate(() => {
    const img = document.querySelector("[data-about-logo]");
    if (!img) return null;
    const box = img.getBoundingClientRect();
    return {
      src: img.getAttribute("src"),
      origin: new URL(img.currentSrc || img.src).origin,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      drawnWidth: Math.round(box.width),
      drawnHeight: Math.round(box.height),
      alt: img.getAttribute("alt"),
      fallback: document.querySelectorAll("[data-about-logo-fallback]").length,
      note: document.querySelector("[data-about-logo-note]")?.textContent?.trim() ?? "",
    };
  });
  check(
    "logo: the official artwork is bundled locally, not fetched",
    Boolean(
      logo &&
        logo.origin === new URL(BASE).origin &&
        logo.src?.endsWith("/brand/knoux-official.png"),
    ),
    logo,
  );
  check(
    "logo: it decodes at its true 800x800 square with no distortion",
    Boolean(
      logo &&
        logo.naturalWidth === 800 &&
        logo.naturalHeight === 800 &&
        Math.abs(logo.drawnWidth - logo.drawnHeight) <= 1,
    ),
    logo,
  );
  check(
    "logo: it carries no textual fallback and names the company",
    Boolean(logo && logo.fallback === 0 && logo.alt === "KNOUX" && logo.note.length > 20),
    logo,
  );
  const composition = await page.evaluate(() => {
    const copy = document.querySelector(".kx-about-hero-copy").getBoundingClientRect();
    const side = document.querySelector(".kx-about-hero-side").getBoundingClientRect();
    const hero = document.querySelector(".kx-about-hero").getBoundingClientRect();
    return {
      columns: side.left >= copy.right - 2 || copy.left >= side.right - 2,
      overlap: !(side.right <= copy.left || side.left >= copy.right),
      used: Math.round(((copy.width + side.width) / hero.width) * 100),
    };
  });
  check(
    "hero: the artwork and the copy hold separate columns and fill the plate",
    composition.columns && !composition.overlap && composition.used >= 80,
    composition,
  );
  await shot(page, "01-hero");

  /* ------------------------------------------------ identity copy */
  const identity = await page.evaluate(() => {
    const text = document.querySelector('[data-about-section="hero"]')?.textContent ?? "";
    return {
      wordmark: document.querySelector(".kx-about-wordmark")?.textContent?.trim(),
      founder: text.includes("Eng. Sadek Elgazar"),
      founderAr: text.includes("م. صادق الجزار"),
      disciplines: document.querySelectorAll("[data-about-disciplines] li").length,
    };
  });
  check(
    "hero: KNOUX, the founder in both scripts and three disciplines",
    identity.wordmark === "KNOUX" &&
      identity.founder &&
      identity.founderAr &&
      identity.disciplines === 3,
    identity,
  );

  const founder = await page.evaluate(() => ({
    roles: document.querySelectorAll("[data-about-roles] li").length,
    bio: document.querySelector("[data-about-bio]")?.textContent?.trim().length ?? 0,
    groups: document.querySelectorAll("[data-about-expertise-grid]").length,
    cards: document.querySelectorAll("[data-about-expertise]").length,
    skills: document.querySelectorAll("[data-about-skills] li").length,
    note: document.querySelector("[data-about-expertise-note]")?.textContent?.trim() ?? "",
  }));
  check(
    "founder: four roles, a real biography and four expertise groups",
    founder.roles === 4 && founder.bio > 120 && founder.groups === 1 && founder.cards === 4,
    founder,
  );
  check(
    "founder: the twenty-one skills are listed and disclaimed as practice, not features",
    founder.skills === 21 && founder.note.length > 60,
    { skills: founder.skills, note: founder.note.slice(0, 80) },
  );
  await shootSection(page, "founder", "02-founder");

  /* ------------------------------------------------ exact destinations */
  const directory = await page.evaluate((official) => {
    const href = (selector) => document.querySelector(selector)?.getAttribute("href");
    const value = (id) =>
      document.querySelector(`[data-contact-value="${id}"]`)?.textContent?.trim() ?? "";
    return {
      channels: [...document.querySelectorAll("[data-contact]")].map((node) =>
        node.getAttribute("data-contact"),
      ),
      actions: {
        whatsapp: href('[data-contact-action="whatsapp"]'),
        email: href('[data-contact-action="email"]'),
        phone: href('[data-contact-action="phone"]'),
        website: href('[data-contact-action="website"]'),
      },
      hero: {
        whatsapp: href('[data-about-cta="whatsapp"]'),
        email: href('[data-about-cta="email"]'),
        website: href('[data-about-cta="website"]'),
      },
      social: Object.fromEntries(
        [...document.querySelectorAll("[data-social]")].map((node) => [
          node.getAttribute("data-social"),
          node.getAttribute("href"),
        ]),
      ),
      displayed: {
        email: value("email"),
        phone: value("phone"),
        whatsapp: value("whatsapp"),
        website: value("website"),
        localPhone:
          document.querySelector("[data-contact-local='phone']")?.textContent?.trim() ?? "",
      },
      mailto: [...new Set([...document.querySelectorAll('a[href^="mailto:"]')].map((a) => a.getAttribute("href")))],
      tel: [...new Set([...document.querySelectorAll('a[href^="tel:"]')].map((a) => a.getAttribute("href")))],
      otherSchemes: [...document.querySelectorAll("a[href]")].filter((a) => {
        const raw = a.getAttribute("href") ?? "";
        return /^(javascript|data|file|vbscript):/i.test(raw);
      }).length,
      official,
    };
  }, OFFICIAL_HREFS);

  check(
    "contact: the four official channels are present in priority order",
    JSON.stringify(directory.channels) ===
      JSON.stringify(["whatsapp", "email", "phone", "website"]),
    directory.channels,
  );
  check(
    "contact: every action points at the exact destination supplied",
    directory.actions.whatsapp === OFFICIAL_HREFS.whatsapp &&
      directory.actions.email === OFFICIAL_HREFS.email &&
      directory.actions.phone === OFFICIAL_HREFS.phone &&
      directory.actions.website === OFFICIAL_HREFS.website,
    directory.actions,
  );
  check(
    "contact: the hero shortcuts use the same destinations",
    directory.hero.whatsapp === OFFICIAL_HREFS.whatsapp &&
      directory.hero.email === OFFICIAL_HREFS.email &&
      directory.hero.website === OFFICIAL_HREFS.website,
    directory.hero,
  );
  check(
    "contact: the printed numbers and address are the official ones",
    directory.displayed.email === "admin@knoux.store" &&
      directory.displayed.phone === "+971 50 328 1920" &&
      directory.displayed.whatsapp === "+971 50 328 1920" &&
      directory.displayed.website === "knoux.store" &&
      directory.displayed.localPhone.includes("050 328 1920"),
    directory.displayed,
  );
  check(
    "contact: no second inbox or number was invented, and no unsafe scheme exists",
    directory.mailto.length === 1 &&
      directory.tel.length === 1 &&
      directory.otherSchemes === 0,
    { mailto: directory.mailto, tel: directory.tel },
  );
  check(
    "contact: nothing is reported as misconfigured",
    (await page.evaluate(() => document.querySelectorAll("[data-about-misconfigured]").length)) === 0,
  );
  await shootSection(page, "contact", "03-contact");

  /* ------------------------------------------------ social grid */
  const social = await page.evaluate(() => ({
    cards: [...document.querySelectorAll("[data-social]")].map((node) => ({
      id: node.getAttribute("data-social"),
      audience: node.getAttribute("data-audience"),
      href: node.getAttribute("href"),
      external: Boolean(node.querySelector(".kx-about-social-meta svg")),
    })),
  }));
  const byId = Object.fromEntries(social.cards.map((card) => [card.id, card]));
  check(
    "social: five profiles, each opening its own verified destination",
    social.cards.length === 5 &&
      byId["facebook-company"]?.href === OFFICIAL_HREFS.facebookCompany &&
      byId["facebook-founder"]?.href === OFFICIAL_HREFS.facebookFounder &&
      byId["github-engineering"]?.href === OFFICIAL_HREFS.githubEngineering &&
      byId["github-company"]?.href === OFFICIAL_HREFS.githubCompany &&
      byId.tiktok?.href === OFFICIAL_HREFS.tiktok,
    social.cards,
  );
  check(
    "social: company pages are separated from the founder's own profiles",
    byId["facebook-company"]?.audience === "company" &&
      byId["facebook-founder"]?.audience === "founder" &&
      byId["github-engineering"]?.audience === "founder" &&
      byId["github-company"]?.audience === "company" &&
      social.cards.filter((card) => card.audience === "founder").length === 2,
    social.cards.map((card) => [card.id, card.audience]),
  );
  check(
    "social: every card carries an external-link indicator",
    social.cards.every((card) => card.external),
  );
  await shootSection(page, "social", "04-social");

  /* ------------------------------------------------ real feedback */
  const readClipboard = () =>
    page.evaluate(async () => {
      try {
        return await navigator.clipboard.readText();
      } catch {
        return null;
      }
    });

  await page.click("[data-contact-copy='email']");
  await waitFor(page, () => {
    const node = document.querySelector('[data-contact-status="email"]');
    return Boolean(node && node.textContent?.trim());
  });
  const emailCopy = await page.evaluate(() => ({
    status: document.querySelector('[data-contact-status="email"]')?.textContent?.trim() ?? "",
    toast: document.querySelector(".kx-toast")?.textContent?.trim() ?? "",
  }));
  const emailClipboard = await readClipboard();
  check(
    "copy: the email action really writes the address to the clipboard",
    emailClipboard === "admin@knoux.store" &&
      /copied/i.test(emailCopy.status) &&
      emailCopy.toast.length > 0,
    { ...emailCopy, clipboard: emailClipboard },
  );

  await page.click("[data-contact-copy='phone']");
  await waitFor(page, () =>
    /copied/i.test(document.querySelector('[data-contact-status="phone"]')?.textContent ?? ""),
  );
  const phoneClipboard = await readClipboard();
  check(
    "copy: the phone action writes the international number",
    phoneClipboard === "+971 50 328 1920",
    phoneClipboard,
  );

  // A mailto: click must report what the platform actually did. In a browser
  // with no mail client the honest answer is a refusal plus a copy fallback —
  // never a claim that an email was sent.
  await page.evaluate(() => {
    const node = document.querySelector('[data-contact-status="email"]');
    if (node) node.textContent = "";
  });
  await page.click('[data-contact-action="email"]');
  await waitFor(page, () =>
    Boolean(document.querySelector('[data-contact-status="email"]')?.textContent?.trim()),
  );
  const mailOutcome = await page.evaluate(() => ({
    status: document.querySelector('[data-contact-status="email"]')?.textContent?.trim() ?? "",
    href: document.querySelector('[data-contact-action="email"]')?.getAttribute("href"),
  }));
  check(
    "email: the click hands off honestly and keeps the real mailto destination",
    mailOutcome.href === OFFICIAL_HREFS.email &&
      /handed|handler|copied|refus|blocked/i.test(mailOutcome.status) &&
      !/sent successfully/i.test(mailOutcome.status),
    mailOutcome,
  );
  await shootSection(page, "contact", "05-feedback");

  /* ------------------------------------------------ keyboard */
  // Proven with a real Tab press: :focus-visible only matches a keyboard
  // interaction, so a programmatic focus would prove nothing.
  await page.evaluate(() => {
    document.querySelector('[data-contact-action="phone"]')?.focus();
  });
  await page.keyboard.press("Tab");
  const keyboard = await page.evaluate(() => {
    const active = document.activeElement;
    const style = active ? getComputedStyle(active) : null;
    return {
      landed: active?.getAttribute?.("data-contact-copy") ?? null,
      outline: style?.outlineStyle ?? "none",
      width: style?.outlineWidth ?? "0px",
    };
  });
  check(
    "keyboard: Tab walks to the next contact action and shows a focus ring",
    keyboard.landed === "phone" &&
      keyboard.outline !== "none" &&
      parseFloat(keyboard.width) >= 2,
    keyboard,
  );

  /* ------------------------------------------------ signature */
  const signature = await page.evaluate(() => {
    const section = document.querySelector('[data-about-section="signature"]');
    return {
      text: section?.textContent?.trim().slice(0, 400) ?? "",
      identityRows: document.querySelectorAll("[data-about-identity] [data-identity]").length,
      build: document.querySelector("[data-about-build]")?.textContent?.trim() ?? "",
      year: /\b(20\d{2})\b/.test(section?.textContent ?? ""),
    };
  });
  check(
    "signature: credits the founder, repeats the identity and invents no year",
    signature.text.includes("Eng. Sadek Elgazar") &&
      signature.identityRows === 4 &&
      signature.build.includes("1.0.0") &&
      signature.year === false,
    { rows: signature.identityRows, year: signature.year, build: signature.build },
  );
  await shootSection(page, "signature", "06-signature");

  /* ------------------------------------------------ Arabic / RTL */
  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".kx-topbar button")].find(
      (element) => element.textContent?.trim() === "AR",
    );
    button?.click();
  });
  await sleep(900);
  const arabic = await page.evaluate(() => {
    const content = document.querySelector(".kx-content")?.textContent ?? "";
    const img = document.querySelector("[data-about-logo]");
    return {
      dir: document.documentElement.dir,
      lang: document.documentElement.lang,
      arabic: /[\u0600-\u06FF]/.test(content),
      leakedKey: /about\.[a-zA-Z]/.test(content),
      overflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      logoNatural: img?.naturalWidth ?? 0,
      wordmark: document.querySelector(".kx-about-wordmark")?.textContent?.trim(),
      heroTitle: document.querySelector("#about-hero-title")?.textContent?.trim(),
    };
  });
  check(
    "arabic: the screen flips to RTL and translates itself",
    arabic.dir === "rtl" && arabic.lang === "ar" && arabic.arabic && arabic.leakedKey === false,
    arabic,
  );
  check(
    "arabic: the artwork and the wordmark survive the flip",
    arabic.logoNatural === 800 && arabic.wordmark === "KNOUX" && arabic.heroTitle === "KNOUX",
    arabic,
  );
  check("arabic: no horizontal overflow in RTL", arabic.overflow <= 0, arabic.overflow);
  await shot(page, "07-arabic");

  /* ------------------------------------------------ light theme + narrow */
  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".kx-topbar button")].find(
      (element) => element.getAttribute("aria-label") === "Light" ||
        element.getAttribute("aria-label") === "فاتح",
    );
    button?.click();
  });
  await sleep(600);
  const light = await page.evaluate(() => {
    const hero = document.querySelector(".kx-about-hero");
    const title = document.querySelector(".kx-about-wordmark");
    return {
      theme: document.documentElement.dataset.theme,
      heroBackground: hero ? getComputedStyle(hero).backgroundImage.length : 0,
      titleColor: title ? getComputedStyle(title).color : "",
      bodyColor: getComputedStyle(document.body).color,
      overflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  check(
    "light theme: the hero keeps its treatment and readable ink",
    light.theme === "light" &&
      light.heroBackground > 20 &&
      light.titleColor === light.bodyColor &&
      light.overflow <= 0,
    light,
  );
  await shot(page, "08-light");

  await page.setViewport({ width: 480, height: 900 });
  await sleep(300);
  const narrow = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll("[data-about-section]")]
      .map((node) => node.getBoundingClientRect())
      .filter((box) => box.width > 0);
    return {
      overflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      stacked: boxes.every((box) => box.width <= window.innerWidth + 1),
      logo: document.querySelector("[data-about-logo]")?.naturalWidth ?? 0,
      socialColumns:
        document.querySelectorAll("[data-social]").length &&
        new Set(
          [...document.querySelectorAll("[data-social]")].map((node) =>
            Math.round(node.getBoundingClientRect().top),
          ),
        ).size,
    };
  });
  check(
    "narrow: nothing overflows horizontally and the cards stack",
    narrow.overflow <= 0 && narrow.stacked && narrow.logo === 800,
    narrow,
  );
  check(
    "narrow: the social grid becomes a single scrolling column",
    narrow.socialColumns === 5,
    narrow,
  );
  await shot(page, "09-narrow");

  // Back to the shipped defaults, so the narrow evidence is not only an RTL
  // crop, and so a language switch is proven to leave the page intact.
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll(".kx-topbar button")];
    buttons
      .find((element) => element.textContent?.trim() === "EN")
      ?.click();
    buttons
      .find((element) => ["Dark", "داكن"].includes(element.getAttribute("aria-label") ?? ""))
      ?.click();
  });
  await sleep(700);
  await page.evaluate(() => {
    document.querySelector(".kx-main")?.scrollTo(0, 0);
    window.scrollTo(0, 0);
  });
  await sleep(400);
  const restored = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    theme: document.documentElement.dataset.theme,
    overflow:
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    staleStatus: [...document.querySelectorAll("[data-contact-status]")].some((node) =>
      Boolean(node.textContent?.trim()),
    ),
  }));
  check(
    "responsive: English dark returns clean at phone width with no stale status text",
    restored.lang === "en" &&
      restored.theme === "dark" &&
      restored.overflow <= 0 &&
      restored.staleStatus === false,
    restored,
  );
  await shot(page, "10-narrow-english");

  /* ------------------------------------------------ hygiene */
  const remote = await page.evaluate(() =>
    [...document.querySelectorAll("img")].filter(
      (img) => new URL(img.currentSrc || img.src, window.location.href).origin !== window.location.origin,
    ).length,
  );
  check("hygiene: no remote image is referenced", remote === 0, remote);
  check(
    "hygiene: no uncaught page errors",
    report.pageErrors.length === 0,
    report.pageErrors.slice(0, 4),
  );
  check(
    "hygiene: no console errors",
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
