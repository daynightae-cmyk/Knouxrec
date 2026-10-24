#!/usr/bin/env node
/**
 * Elysian Canvas runtime smoke test.
 *
 * Drives the Elysian creative image studio end to end in the packaged Windows
 * binary: age gate -> image upload -> effect browser -> preset layer ->
 * before/after -> library save -> PNG export whose pixels are decoded outside
 * the application and compared with the source.
 *
 * Usage:
 *   node scripts/elysian-smoke.mjs [--exe <path>] [--port <port>]
 */

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { writeSolidPng, decodePng } from "./lib/png.mjs";
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

const checks = [];
const consoleErrors = [];

function check(name, pass, detail = null) {
  checks.push({ name, pass: Boolean(pass), detail });
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

// A real PNG is generated without any image dependency.
function writeTestPng(directory) {
  const file = path.join(directory, "elysian-source.png");
  writeSolidPng(file, 64, 64, [32, 96, 200]);
  return file;
}

async function discoverTarget(port, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      // Attach to the application page only. A transient target is replaced
      // when the renderer navigates to the real document, which kills the
      // DevTools socket and turns every command into a timeout. The title is
      // not required: it is set a moment after the document loads.
      const page = targets.find(
        (target) =>
          target.type === "page" &&
          target.webSocketDebuggerUrl &&
          /\/dist\/index\.html/.test(target.url ?? ""),
      );
      if (page) return page;
    } catch {
      // still starting
    }
    await sleep(400);
  }
  return null;
}

function createClient(ws) {
  let sequence = 0;
  const pending = new Map();

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
      consoleErrors.push(
        message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "),
      );
    }
    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params.exceptionDetails;
      consoleErrors.push(details?.exception?.description ?? details?.text ?? "exception");
    }
  });

  ws.addEventListener("close", () => {
    for (const entry of pending.values()) {
      entry.reject(new Error("CDP connection closed"));
    }
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
  console.error(`elysian-smoke: executable not found at ${EXE}`);
  process.exit(2);
}

fs.mkdirSync(evidenceDir, { recursive: true });
const port = await freePort();
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "knoux-elysian-"));
const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), "knoux-elysian-dl-"));
const sourcePng = writeTestPng(downloadDir);

const child = spawn(EXE, [`--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`], {
  cwd: root,
  env: cleanElectronEnv(process.env),
  stdio: ["ignore", "pipe", "pipe"],
});
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
child.stderr.on("data", (chunk) => (stderr += chunk.toString()));

let ws = null;

/**
 * Connects to the renderer and runs the Elysian suite. The DevTools target is
 * re-discovered on every attempt: a target can be replaced while the app
 * boots, and a socket attached to a replaced target never answers again.
 */
async function runSuite(attempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const target = await discoverTarget(port, BOOT_TIMEOUT);
      if (!target) throw new Error("no renderer target");

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
      await client.send("DOM.enable");
      await client.send("Page.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: downloadDir,
      });

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
        checks.length = 0;
        consoleErrors.length = 0;
        await sleep(1500);
      }
    }
  }
  throw lastError;
}

async function runChecks(client) {
  check("renderer target available", true);

  await waitFor(client, "Boolean(document.querySelector('.kx-shell'))", 25000, "shell");

  // 1. The age gate must be closed in a fresh session.
  await evaluate(client, `window.location.hash = "#/elysian"; true`);
  // The Elysian workspace is a lazily loaded chunk, so the gate appears only
  // after the bundle is evaluated.
  await waitFor(
    client,
    `Boolean(document.querySelector('.adult-gate-container'))`,
    25000,
    "Elysian age gate",
  );
  const gateVisible = await evaluate(
    client,
    `Boolean(document.querySelector('.adult-gate-container'))`,
  );
  check("age gate is closed for a fresh session", gateVisible === true);

  // 2. Complete the self-declared gate.
  await evaluate(
    client,
    `(() => {
      const year = document.querySelector('#birthYear');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(year, '1990');
      year.dispatchEvent(new Event('input', { bubbles: true }));
      const boxes = Array.from(document.querySelectorAll('.checkbox-group input[type=checkbox]'));
      boxes.forEach((box) => box.click());
      return true;
    })()`,
  );
  await sleep(300);
  await evaluate(
    client,
    `(() => {
      const button = document.querySelector('.verification-button');
      if (button) button.click();
      return true;
    })()`,
  );
  await sleep(2500);
  const editorOpen = await evaluate(
    client,
    `(() => ({
      gateClosed: !document.querySelector('.adult-gate-container'),
      fileInputs: document.querySelectorAll('input[type=file]').length
    }))()`,
  );
  check("the gate closes after the confirmation", editorOpen.gateClosed === true, editorOpen);
  check("the upload view is reachable", editorOpen.fileInputs === 1, editorOpen);

  // 3. Upload an image through the real file input. The editor view (and its
  //    canvas) only mounts once an image is selected.
  await waitFor(
    client,
    `Boolean(document.querySelector('input[type=file]'))`,
    20000,
    "Elysian upload input",
  );
  const document_ = await client.send("DOM.getDocument", { depth: -1 });
  const node = await client.send("DOM.querySelector", {
    nodeId: document_.root.nodeId,
    selector: "input[type=file]",
  });
  check("file input is present", node.nodeId > 0);
  await client.send("DOM.setFileInputFiles", {
    nodeId: node.nodeId,
    files: [sourcePng],
  });
  // The canvas paints asynchronously after the upload; wait for real pixels
  // instead of racing a fixed delay on a loaded machine.
  await waitFor(
    client,
    `(() => {
      const canvas = document.querySelector('.elys-canvas');
      if (!canvas) return false;
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
      return false;
    })()`,
    25000,
    "Elysian canvas paint",
  );
  await sleep(400);

  const painted = await evaluate(
    client,
    `(() => {
      const canvas = document.querySelector('.elys-canvas');
      if (!canvas) return { found: false };
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let nonZero = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) nonZero += 1;
      return { found: true, nonZero, width: canvas.width, height: canvas.height };
    })()`,
  );
  check("uploaded image is painted on the canvas", painted.found && painted.nonZero > 0, painted);
  check(
    "the studio keeps the source resolution",
    painted.width === 64 && painted.height === 64,
    painted,
  );

  // 3b. The effect browser must render a distinct thumbnail per card, so a
  //     screenshot of a dead card cannot pass as evidence.
  const browser = await evaluate(
    client,
    `(() => {
      const cards = Array.from(document.querySelectorAll('.elys-card'));
      const thumbs = cards
        .map((card) => card.querySelector('.elys-card-thumb img')?.getAttribute('src') ?? '')
        .filter((src) => src.startsWith('data:image/png'));
      return { cards: cards.length, thumbs: thumbs.length, unique: new Set(thumbs).size };
    })()`,
  );
  check(
    "the effect browser renders real per-card previews",
    browser.cards > 0 && browser.thumbs === browser.cards && browser.unique === browser.thumbs,
    browser,
  );

  // 4. A preset must change the pixels and register its layers.
  const beforePreset = await evaluate(
    client,
    `(() => {
      const canvas = document.querySelector('.elys-canvas');
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
      return sum;
    })()`,
  );
  const presetClicked = await evaluate(
    client,
    `(() => {
      const button = document.querySelector('.elys-card[data-preset-id="noir"]');
      if (button) button.click();
      return Boolean(button);
    })()`,
  );
  await sleep(900);
  const afterPreset = await evaluate(
    client,
    `(() => {
      const canvas = document.querySelector('.elys-canvas');
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
      return sum;
    })()`,
  );
  const layers = await evaluate(
    client,
    `document.querySelectorAll('.elys-layers .elys-layer').length`,
  );
  check("the Noir preset is applied from the browser", presetClicked === true);
  check(
    "the Noir preset changes the rendered pixels",
    beforePreset !== afterPreset,
    { beforePreset, afterPreset },
  );
  check("each operation of the preset becomes a layer", layers === 5, layers);

  // 4b. Before/after must reveal the untouched source and return.
  const canvasSum = () =>
    evaluate(
      client,
      `(() => {
        const canvas = document.querySelector('.elys-canvas');
        const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
        return sum;
      })()`,
    );
  const peek = await evaluate(
    client,
    `(() => {
      const buttons = Array.from(document.querySelectorAll('.elys-stage-bar button'));
      const button = buttons.find((b) => /original/i.test(b.textContent ?? ''));
      if (!button) return { found: false };
      button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      return { found: true };
    })()`,
  );
  await sleep(400);
  const peekState = await evaluate(
    client,
    `(() => {
      const image = document.querySelector('.elys-peek');
      return { shown: Boolean(image), natural: image?.naturalWidth ?? 0 };
    })()`,
  );
  await evaluate(
    client,
    `(() => {
      const buttons = Array.from(document.querySelectorAll('.elys-stage-bar button'));
      const button = buttons.find((b) => /original/i.test(b.textContent ?? ''));
      button?.dispatchEvent(new Event('pointerup', { bubbles: true }));
      return true;
    })()`,
  );
  await sleep(400);
  const peekReleased = await evaluate(
    client,
    `(() => ({ hidden: !document.querySelector('.elys-peek'), sum: (() => {
      const canvas = document.querySelector('.elys-canvas');
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let total = 0;
      for (let i = 0; i < data.length; i += 4) total += data[i] + data[i + 1] + data[i + 2];
      return total;
    })() }))()`,
  );
  check(
    "before/after overlays the untouched source",
    peek.found && peekState.shown && peekState.natural === 64,
    { peek, peekState },
  );
  check(
    "releasing returns to the edited pixels",
    peekReleased.hidden && peekReleased.sum === afterPreset,
    { afterPreset, released: peekReleased.sum },
  );

  // 4c. Split compare must mount both sides from real image data.
  await evaluate(
    client,
    `(() => {
      const button = Array.from(document.querySelectorAll('.elys-stage-bar button')).find(
        (b) => /split compare/i.test(b.textContent ?? ''),
      );
      if (button) button.click();
      return Boolean(button);
    })()`,
  );
  await sleep(900);
  const split = await evaluate(
    client,
    `(() => {
      const images = Array.from(document.querySelectorAll('.elys-compare img'));
      return {
        count: images.length,
        decoded: images.every((image) => image.complete && image.naturalWidth > 0),
        distinct: images.length === 2 && images[0].src !== images[1].src,
      };
    })()`,
  );
  check("split compare shows both sides decoded", split.count === 2 && split.decoded, split);
  check("split compare distinguishes original from result", split.distinct, split);
  await evaluate(
    client,
    `(() => {
      const button = Array.from(document.querySelectorAll('.elys-stage-bar button')).find(
        (b) => /split compare/i.test(b.textContent ?? ''),
      );
      if (button) button.click();
      return true;
    })()`,
  );
  await sleep(700);

  // 4d. Undo must return to the untouched source pixels.
  await evaluate(
    client,
    `(() => {
      const button = Array.from(document.querySelectorAll('.elys-actions button')).find(
        (b) => /undo/i.test(b.textContent ?? ''),
      );
      if (button) button.click();
      return Boolean(button);
    })()`,
  );
  await sleep(900);
  const undoneSum = await canvasSum();
  check("undo restores the pre-preset pixels", undoneSum === beforePreset, {
    beforePreset,
    undoneSum,
  });
  await evaluate(
    client,
    `(() => {
      const button = Array.from(document.querySelectorAll('.elys-actions button')).find(
        (b) => /redo/i.test(b.textContent ?? ''),
      );
      if (button) button.click();
      return Boolean(button);
    })()`,
  );
  await sleep(900);
  const redoneSum = await canvasSum();
  check("redo returns to the edited pixels", redoneSum === afterPreset, {
    afterPreset,
    redoneSum,
  });

  // 4e. Saving persists the verified PNG into the local library.
  // Anything this run did not write must not be able to satisfy the check
  // below, so previously stored studio exports are removed first. The packaged
  // app keeps its user data between runs, and the retry wrapper can reach this
  // point on a second attempt with the first attempt's item still present.
  await evaluate(
    client,
    `new Promise((resolve) => {
      const open = indexedDB.open('knoux-rec.library');
      open.onerror = () => resolve(-1);
      open.onsuccess = () => {
        const db = open.result;
        const transaction = db.transaction('items', 'readwrite');
        const store = transaction.objectStore('items');
        const request = store.getAll();
        request.onsuccess = async () => {
          const stale = (request.result ?? []).filter((item) => /-elysian\.(png|jpg|jpeg|webp)$/i.test(item.name));
          for (const item of stale) store.delete(item.id);
          transaction.oncomplete = () => {
            db.close();
            resolve(stale.length);
          };
          transaction.onerror = () => {
            db.close();
            resolve(-1);
          };
        };
        request.onerror = () => resolve(-1);
      };
    })`,
  );
  const saveClicked = await evaluate(
    client,
    `(() => {
      const button = Array.from(document.querySelectorAll('.elys-dock button')).find((b) => /save to library/i.test(b.textContent ?? ''));
      if (button) button.click();
      return Boolean(button);
    })()`,
  );
  // Encode + decode + IndexedDB write is timed, not guessed: on a loaded
  // machine a fixed delay used to read the label before the write finished.
  const saveNote = await evaluate(
    client,
    `new Promise((resolve) => {
      const deadline = Date.now() + 25000;
      const poll = () => {
        const button = Array.from(document.querySelectorAll('.elys-dock button')).find((b) => /saved|save to library/i.test(b.textContent ?? ''));
        const label = button?.textContent?.trim() ?? null;
        if (/saved/i.test(label ?? '') || Date.now() > deadline) return resolve(label);
        setTimeout(poll, 250);
      };
      poll();
    })`,
    30000,
  );
  check(
    "saving confirms a completed write",
    saveClicked && /Saved/i.test(saveNote ?? ""),
    saveNote,
  );
  const archived = await evaluate(
    client,
    `new Promise((resolve) => {
      const open = indexedDB.open('knoux-rec.library');
      open.onerror = () => resolve(null);
      open.onsuccess = () => {
        const db = open.result;
        const request = db.transaction('items', 'readonly').objectStore('items').getAll();
        request.onerror = () => resolve(null);
        request.onsuccess = async () => {
          const items = (request.result ?? []).filter((item) => /-elysian\\.png$/.test(item.name));
          const latest = items.reduce((best, item) => (!best || item.createdAt > best.createdAt ? item : best), null);
          if (!latest) return resolve(null);
          const head = new Uint8Array(await latest.blob.slice(0, 8).arrayBuffer());
          resolve({
            name: latest.name,
            width: latest.width,
            height: latest.height,
            size: latest.blob.size,
            magic: Array.from(head).map((value) => value.toString(16).padStart(2, '0')).join(' '),
          });
        };
      };
    })`,
    20000,
  );
  check(
    "the library stores the real PNG blob",
    Boolean(
      archived &&
        archived.size > 100 &&
        archived.magic.startsWith("89 50 4e 47 0d 0a 1a 0a") &&
        archived.width === 64 &&
        archived.height === 64,
    ),
    archived,
  );

  // 5. Export must write a PNG file with the layers baked into the pixels.
  const exportClicked = await evaluate(
    client,
    `new Promise((resolve) => {
      const deadline = Date.now() + 20000;
      const poll = () => {
        const button = Array.from(document.querySelectorAll('.elys-dock button')).find((b) => /^export$/i.test((b.textContent ?? '').trim()));
        if (button && !button.disabled) {
          button.click();
          return resolve(true);
        }
        if (Date.now() > deadline) return resolve(false);
        setTimeout(poll, 250);
      };
      poll();
    })`,
    25000,
  );
  check("the export control is offered", exportClicked === true, exportClicked);
  let exported = null;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const files = fs
      .readdirSync(downloadDir)
      .filter((name) => name.endsWith(".png") && name !== "elysian-source.png");
    if (files.length) {
      exported = files[0];
      break;
    }
    await sleep(400);
  }
  check("export writes a PNG file", Boolean(exported), exported);

  if (exported) {
    const bytes = fs.readFileSync(path.join(downloadDir, exported));
    const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    check("exported file is a valid PNG", isPng, { bytes: bytes.length });
    check("exported file is not empty", bytes.length > 100, bytes.length);

    // Independent proof that the layers reached the exported pixels: the file
    // is decoded here, outside the application, and compared with the source.
    try {
      const image = decodePng(bytes);
      check(
        "the export keeps the source resolution",
        image.width === 64 && image.height === 64,
        { width: image.width, height: image.height },
      );
      let differing = 0;
      let total = 0;
      let grey = 0;
      for (let y = 0; y < image.height; y += 1) {
        for (let x = 0; x < image.width; x += 1) {
          const index = (y * image.width + x) * image.channels;
          const sourceR = (32 + x) % 256;
          const sourceG = (96 + y) % 256;
          const sourceB = 200;
          const r = image.pixels[index];
          const g = image.pixels[index + 1];
          const b = image.pixels[index + 2];
          total += 1;
          if (r !== sourceR || g !== sourceG || b !== sourceB) differing += 1;
          // The Noir preset desaturates, so every painted pixel must lose its
          // channel spread entirely.
          if (Math.abs(r - g) <= 2 && Math.abs(g - b) <= 2) grey += 1;
        }
      }
      check(
        "the exported pixels carry the preset, not the untouched source",
        differing > total * 0.5,
        { differing, total },
      );
      check(
        "the exported pixels are genuinely desaturated",
        grey > total * 0.95,
        { grey, total },
      );
    } catch (error) {
      check("the exported PNG could be decoded independently", false, String(error));
    }
  }

  const shot = await client.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(
    path.join(evidenceDir, "41-elysian-editor.png"),
    Buffer.from(shot.data, "base64"),
  );

  check("no renderer console errors", consoleErrors.length === 0, consoleErrors);
}

try {
  await runSuite();
} catch (error) {
  check("elysian smoke completed", false, String(error));
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
  for (const directory of [userDataDir, downloadDir]) {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
}

const failed = checks.filter((entry) => !entry.pass);
fs.writeFileSync(
  path.join(evidenceDir, "elysian-smoke.json"),
  `${JSON.stringify({ checks, consoleErrors, stdout: stdout.slice(-2000), stderr: stderr.slice(-2000) }, null, 2)}\n`,
  "utf8",
);
console.log(
  JSON.stringify(
    { failed: failed.length, passed: checks.length - failed.length, total: checks.length, failures: failed },
    null,
    2,
  ),
);
process.exit(failed.length ? 1 : 0);
