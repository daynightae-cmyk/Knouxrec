#!/usr/bin/env node
/**
 * Electron shell smoke test.
 *
 * Starts the desktop shell from the source tree, attaches to the renderer over
 * the DevTools protocol and verifies the shell, the routes, the CSP, the
 * preload bridge and the absence of console errors.
 *
 * Usage: node scripts/electron-smoke.mjs
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  createCdpClient,
  evaluate,
  freePort,
  killTree,
  sleep,
  startAndAttach,
  waitFor,
} from "./lib/app-session.mjs";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = path.join(root, "artifacts", "evidence");
fs.mkdirSync(evidenceDir, { recursive: true });

const result = {
  startedAt: new Date().toISOString(),
  electron: null,
  attempts: 1,
  gpuFallback: false,
  checks: [],
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
  failed: true,
};
const failedRequests = [];

function check(name, pass, detail = null) {
  result.checks.push({ name, pass: Boolean(pass), detail });
}

const port = await freePort();
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "knoux-electron-"));

let session = null;
try {
  session = await startAndAttach({
    executable: electronPath,
    args: [".", `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`],
    cwd: root,
    port,
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
  });
  result.attempts = session.attempts;
  result.gpuFallback = session.gpuFallback;

  const client = createCdpClient(session.ws, {
    onConsoleError: (message) => result.consoleErrors.push(message),
    onPageError: (message) => result.pageErrors.push(message),
    onFailedRequest: (message) => failedRequests.push(message),
  });
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  try {
    await client.send("Network.enable", {}, 15000);
  } catch {
    result.checks.push({
      name: "Network domain enabled",
      pass: false,
      detail: "Network.enable timed out; request failures are only partially observed",
    });
  }

  await waitFor(client, "Boolean(document.querySelector('.kx-shell'))", 40000, "shell");
  check("electron window opens dist/index.html", Boolean(session.target), session.target?.url ?? null);

  result.electron = await evaluate(
    client,
    `({
      bridge: window.knouxDesktop?.isDesktop === true,
      platform: window.knouxDesktop?.platform ?? null,
      userAgent: navigator.userAgent,
      csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content") ?? null
    })`,
  );

  check("secure preload bridge is available", result.electron.bridge, result.electron.platform);
  check("renderer runs in Electron", /Electron\//.test(result.electron.userAgent), result.electron.userAgent);
  check("CSP meta tag is present", Boolean(result.electron.csp));

  await waitFor(client, "!document.querySelector('.kx-splash')", 20000, "splash");
  check("splash transitions into the shell", true);

  const title = await evaluate(client, "document.title");
  check("window title is set", /KNOUX REC/.test(title), title);

  const shell = await evaluate(
    client,
    `({
      nav: Array.from(document.querySelectorAll("[data-route]")).map((node) => node.getAttribute("data-route")),
      overflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      rootChildren: document.getElementById("root")?.childElementCount ?? 0
    })`,
  );
  check("navigation renders all routes", shell.nav.length >= 15, shell.nav.length);
  check("no horizontal overflow", shell.overflow === 0, shell.overflow);
  check("React mounted", shell.rootChildren > 0, shell.rootChildren);

  await evaluate(client, `window.location.hash = "#/studio"; true`);
  await waitFor(client, `window.location.hash === "#/studio"`, 8000, "studio hash");
  await sleep(400);
  const studio = await evaluate(
    client,
    `({
      hash: window.location.hash,
      heading: document.querySelector("h1")?.textContent ?? "",
      startButton: Array.from(document.querySelectorAll("button")).some((button) => /start recording/i.test(button.textContent ?? ""))
    })`,
  );
  check("hash navigation reaches the recorder", studio.hash === "#/studio", studio);
  check("recorder exposes a start control", studio.startButton, studio.heading);

  const studioShot = await client.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(
    path.join(evidenceDir, "30-electron-studio.png"),
    Buffer.from(studioShot.data, "base64"),
  );

  await evaluate(client, `window.location.hash = "#/dashboard"; true`);
  await sleep(500);
  const dashboardShot = await client.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(
    path.join(evidenceDir, "31-electron-dashboard.png"),
    Buffer.from(dashboardShot.data, "base64"),
  );

  const external = await evaluate(
    client,
    `performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => /^https?:/i.test(name))`,
  );
  check("no external runtime resources", external.length === 0, external);
  check("no failed local requests", failedRequests.length === 0, failedRequests);
  check("no renderer console errors", result.consoleErrors.length === 0, result.consoleErrors);
  check("no uncaught page errors", result.pageErrors.length === 0, result.pageErrors);
} catch (error) {
  check("electron smoke completed", false, String(error));
} finally {
  if (session) {
    session.kill();
  } else {
    killTree(null);
  }
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    // the OS will reap the temporary profile
  }
  result.finishedAt = new Date().toISOString();
  result.failed = result.checks.some((entry) => !entry.pass);
  fs.writeFileSync(
    path.join(evidenceDir, "electron-smoke.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
  console.log(
    JSON.stringify(
      {
        failed: result.failed,
        attempts: result.attempts,
        gpuFallback: result.gpuFallback,
        passed: result.checks.filter((entry) => entry.pass).length,
        total: result.checks.length,
      },
      null,
      2,
    ),
  );
  process.exit(result.failed ? 1 : 0);
}
