#!/usr/bin/env node
/**
 * Packaged-app smoke test.
 *
 * Launches the real packaged Windows binary (release/win-unpacked/KNOUX REC.exe),
 * attaches to the renderer through the Chrome DevTools Protocol, walks every
 * application route, and fails when the packaged product misbehaves.
 *
 * This gate exists because the shipped product could not boot at all: the
 * packaged package.json declared "type": "module" while the Electron entry was
 * CommonJS, so the renderer never loaded and Electron showed its error page.
 *
 * Usage:
 *   node scripts/packaged-smoke.mjs [--exe <path>] [--port <port>] [--timeout <ms>]
 */

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { cleanElectronEnv } from "./lib/app-session.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = path.join(root, "artifacts", "evidence");

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index === process.argv.length - 1) return fallback;
  return process.argv[index + 1];
}

const EXE = path.resolve(root, arg("exe", path.join("release", "win-unpacked", "KNOUX REC.exe")));
const BOOT_TIMEOUT = Number(arg("timeout", "90000"));

const ROUTES = [
  "dashboard",
  "studio",
  "screenshots",
  "library",
  "templates",
  "toolbox",
  "visual-patch",
  "morphcore",
  "elysian",
  "body-editor",
  "offline-ai",
  "arabic-ai",
  "models",
  "settings",
  "diagnostics",
  "live-studio",
];

const result = {
  startedAt: new Date().toISOString(),
  exe: EXE,
  attempts: 1,
  checks: [],
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
  failed: true,
};
const failures = [];

function check(name, pass, detail = null) {
  result.checks.push({ name, pass: Boolean(pass), detail });
  if (!pass) failures.push(`${name}${detail ? ` :: ${JSON.stringify(detail)}` : ""}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function discoverTarget(port, timeoutMs) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      last = targets.map((t) => ({ type: t.type, title: t.title, url: t.url }));
      // Only attach to the real application page. A transient target (the
      // initial about:blank or the splash document) is replaced as soon as the
      // renderer navigates, which silently kills the DevTools socket and
      // makes every command time out. The title is deliberately not required
      // here: the renderer sets it a moment after the document is loaded, and
      // waiting for it would make the gate depend on machine load.
      const page = targets.find(
        (target) =>
          target.type === "page" &&
          target.webSocketDebuggerUrl &&
          /\/dist\/index\.html/.test(target.url ?? ""),
      );
      if (page) return page;
    } catch {
      // the devtools endpoint is not up yet
    }
    await sleep(400);
  }
  result.lastTargets = last;
  return null;
}

function createClient(ws) {
  let sequence = 0;
  const pending = new Map();
  const requestUrls = new Map();

  ws.addEventListener("message", async (event) => {
    let raw = event.data;
    if (typeof raw !== "string") {
      raw =
        typeof raw?.text === "function"
          ? await raw.text()
          : Buffer.from(raw).toString("utf8");
    }
    const message = JSON.parse(raw);
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
      return;
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      result.consoleErrors.push(
        message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "),
      );
    }
    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params.exceptionDetails;
      result.pageErrors.push(details?.exception?.description ?? details?.text ?? "unknown");
    }
    if (message.method === "Network.loadingFailed") {
      result.failedRequests.push(
        `${requestUrls.get(message.params.requestId) ?? message.params.requestId} ${
          message.params.errorText ?? ""
        }`,
      );
    }
    if (message.method === "Network.requestWillBeSent") {
      requestUrls.set(message.params.requestId, message.params.request.url);
    }
  });

  ws.addEventListener("close", () => {
    for (const entry of pending.values()) entry.reject(new Error("CDP connection closed"));
    pending.clear();
  });

  return {
    send(method, params = {}, timeoutMs = 20000) {
      return new Promise((resolve, reject) => {
        const id = (sequence += 1);
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} timed out`));
        }, timeoutMs);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

async function evaluate(client, expression, timeoutMs = 20000) {
  const response = await client.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    timeoutMs,
  );
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text ?? "evaluation failed");
  }
  return response.result?.value;
}

async function waitFor(client, expression, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await evaluate(client, expression, 5000)) return true;
    } catch {
      // still initialising
    }
    await sleep(250);
  }
  throw new Error(`${label} did not settle within ${timeoutMs}ms`);
}

if (!fs.existsSync(EXE)) {
  console.error(`packaged-smoke: executable not found at ${EXE}`);
  console.error("Run `npm run electron:dist` first.");
  process.exit(2);
}

fs.mkdirSync(evidenceDir, { recursive: true });
const port = await freePort();
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "knoux-packaged-"));

const child = spawn(EXE, [`--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`], {
  cwd: root,
  env: { ...cleanElectronEnv(process.env), ELECTRON_ENABLE_LOGGING: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
child.stderr.on("data", (chunk) => (stderr += chunk.toString()));

let ws = null;

/**
 * Connects to the packaged renderer and runs the suite. The renderer target is
 * re-discovered on every attempt because a target can be replaced while the
 * application boots, and a dead DevTools socket cannot be reused.
 */
async function runSuite(attempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const target = await discoverTarget(port, BOOT_TIMEOUT);
      if (!target) throw new Error("packaged renderer never reached the KNOUX REC title");

      ws = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("CDP socket open timed out")), 20000);
        ws.addEventListener("open", () => {
          clearTimeout(timer);
          resolve();
        });
        ws.addEventListener("error", () => {
          clearTimeout(timer);
          reject(new Error("CDP socket failed"));
        });
      });

      const client = createClient(ws);
      await client.send("Page.enable");
      await client.send("Runtime.enable");
      try {
        await client.send("Network.enable", {}, 10000);
      } catch {
        // request failures are then only partially observed
      }
      await runChecks(client);
      return;
    } catch (error) {
      lastError = error;
      try {
        ws?.close();
      } catch {
        // ignore
      }
      ws = null;
      if (attempt < attempts) {
        result.attempts = attempt + 1;
        await sleep(1500);
      }
    }
  }
  throw lastError;
}

async function runChecks(client) {
  await waitFor(client, "Boolean(document.querySelector('.kx-shell'))", 20000, "shell");
  check("packaged window renders the app shell", true);

  const environment = await evaluate(
    client,
    `({
      title: document.title,
      bridge: window.knouxDesktop?.isDesktop === true,
      userAgent: navigator.userAgent,
      csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content") ?? null,
      rootChildren: document.getElementById("root")?.childElementCount ?? 0
    })`,
  );
  check("packaged renderer mounted React", environment.rootChildren > 0, environment.rootChildren);
  check("packaged preload bridge is available", environment.bridge === true);
  check("packaged build keeps the CSP meta tag", Boolean(environment.csp));
  check("packaged renderer runs inside Electron", /Electron\//.test(environment.userAgent));

  for (const route of ROUTES) {
    await evaluate(client, `window.location.hash = "#/${route}"; true`);
    // The packaged renderer is slower than the dev build on a loaded machine,
    // and a fixed sleep reported an empty heading for a route that was merely
    // still rendering. Poll for the state the check is about.
    let state = { hash: "", heading: "", rootChildren: 0, errorBoundary: false, errorPage: false };
    for (let attempt = 0; attempt < 24; attempt += 1) {
      await sleep(250);
      state = await evaluate(
        client,
        `(() => {
          const heading = document.querySelector("h1, .kx-card-title");
          return {
            hash: window.location.hash,
            heading: (heading?.textContent || "").trim(),
            rootChildren: document.getElementById("root")?.childElementCount ?? 0,
            errorBoundary: /This section failed to render/i.test(document.body.innerText || ""),
            errorPage: /ERR_|refused to load|Application error/i.test(document.body.innerText || "")
          };
        })()`,
      );
      if (state.rootChildren > 0 && state.heading) break;
    }
    check(`route ${route} renders`, state.rootChildren > 0 && Boolean(state.heading), state);
    check(`route ${route} has no error boundary`, !state.errorBoundary, state.heading);
    check(`route ${route} is not an error page`, !state.errorPage, state.heading);
  }

  // Diagnostics must report the live Electron bridge and the real model probe.
  await evaluate(client, `window.location.hash = "#/diagnostics"; true`);
  let diagnosticsRows = { bridge: false, models: false, text: "" };
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(400);
    diagnosticsRows = await evaluate(
      client,
      `(() => {
        const text = document.body.innerText || "";
        return {
          bridge: /Connected · \\d+ channels/.test(text),
          models: /\\d+ \\/ 24 weight files present/.test(text),
          text: text.slice(0, 400)
        };
      })()`,
    );
    if (diagnosticsRows.bridge && diagnosticsRows.models) break;
  }
  check(
    "diagnostics reports the live desktop bridge",
    diagnosticsRows.bridge,
    diagnosticsRows.text,
  );
  check(
    "diagnostics reports the real model inventory",
    diagnosticsRows.models,
    diagnosticsRows.text,
  );

  const external = await evaluate(
    client,
    `performance.getEntriesByType("resource").map((entry) => entry.name).filter((name) => /^https?:/i.test(name))`,
  );
  check("packaged app loads no external resources", external.length === 0, external);
  check("packaged app has no failed local requests", result.failedRequests.length === 0, result.failedRequests);
  check("packaged app logs no renderer console errors", result.consoleErrors.length === 0, result.consoleErrors);
  check("packaged app throws no uncaught errors", result.pageErrors.length === 0, result.pageErrors);

  // A screenshot of a busy renderer can time out; one retry is enough to tell
  // a slow frame from a broken one, and a second failure still fails the run.
  let shot = null;
  for (let attempt = 1; attempt <= 2 && !shot; attempt += 1) {
    try {
      shot = await client.send("Page.captureScreenshot", { format: "png" }, 30000);
    } catch (error) {
      if (attempt === 2) throw error;
      await sleep(800);
    }
  }
  fs.writeFileSync(
    path.join(evidenceDir, "40-packaged-dashboard.png"),
    Buffer.from(shot.data, "base64"),
  );
}

try {
  await runSuite();
} catch (error) {
  check("packaged smoke completed", false, String(error));
} finally {
  try {
    ws?.close();
  } catch {
    // ignore
  }
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
        timeout: 15000,
      });
    } catch {
      // already exited
    }
  }
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(5000)]);
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    // best effort
  }
  result.stdout = stdout.slice(-4000);
  result.stderr = stderr.slice(-4000);
  result.finishedAt = new Date().toISOString();
  result.failed = result.checks.some((entry) => !entry.pass);
  fs.writeFileSync(
    path.join(evidenceDir, "packaged-smoke.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
}

console.log(
  JSON.stringify(
    {
      failed: result.failed,
      passed: result.checks.filter((entry) => entry.pass).length,
      total: result.checks.length,
      failures,
    },
    null,
    2,
  ),
);
process.exit(result.failed ? 1 : 0);
