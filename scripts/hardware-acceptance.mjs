#!/usr/bin/env node
/**
 * KNOUX REC — real Windows hardware acceptance.
 *
 * Every capture number in the delivery ledger so far came from Chromium started
 * with `--use-fake-device-for-media-stream` and an auto-selected fake desktop.
 * That proves the pipeline, the crop arithmetic, the container and the decode.
 * It does not prove this machine's actual display, audio endpoints or windows
 * produce real pixels through the shipped binary.
 *
 * This harness runs the PACKAGED app — release-hw/win-unpacked/KNOUX REC.exe —
 * under remote debugging and drives the app's own source picker, so capture goes
 * through desktopCapturer, the app's setDisplayMediaRequestHandler and the real
 * display surface. Produced bytes are then decoded, measured, written to disk and
 * re-opened.
 *
 * Input is dispatched through CDP `Input.dispatchMouseEvent`, not `element.click()`:
 * a scripted click carries no user activation, and Chromium requires one for
 * display capture. The first version of this harness used `.click()` and never
 * reached a recording at all.
 *
 * Where the operating system or the hardware cannot satisfy a gate, it is
 * recorded as blocked or unavailable with the exact error — never as a pass.
 *
 * Usage:
 *   node scripts/hardware-acceptance.mjs
 *   node scripts/hardware-acceptance.mjs --exe "K:\\other\\KNOUX REC.exe" --keep
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  createCdpClient,
  evaluate,
  killTree,
  sleep,
  startAndAttach,
  waitFor,
} from "./lib/app-session.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const EXE = path.resolve(root, arg("exe", path.join("release-hw", "win-unpacked", "KNOUX REC.exe")));
const OUT = path.resolve(root, "artifacts", "hardware-acceptance");
const KEEP = process.argv.includes("--keep");
const RECORD_SECONDS = Number(arg("record-seconds", "4"));

fs.mkdirSync(OUT, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  exe: EXE,
  exeExists: fs.existsSync(EXE),
  gates: [],
  checks: [],
  environment: null,
  captures: [],
  consoleErrors: [],
  pageErrors: [],
  failed: true,
};

function gate(name, status, detail) {
  report.gates.push({ name, status, detail });
}

function check(name, pass, detail = null) {
  report.checks.push({ name, pass: Boolean(pass), detail });
  if (!pass) report.failed = true;
}

/** Centre point of a selector, in CSS pixels of that page's viewport. Pure measurement. */
async function centreOf(client, selector) {
  return JSON.parse(
    await evaluate(
      client,
      `(() => {
         const el = document.querySelector(${JSON.stringify(selector)});
         if (!el) return "null";
         const r = el.getBoundingClientRect();
         return JSON.stringify({
           x: Math.round(r.left + r.width / 2),
           y: Math.round(r.top + r.height / 2),
           width: Math.round(r.width),
           height: Math.round(r.height),
           viewport: { width: Math.round(innerWidth), height: Math.round(innerHeight) },
         });
       })()`,
    ),
  );
}

/**
 * Bring a control into the viewport and prove it stayed there.
 *
 * The packaged window opens at 1384x835 and the recorder's start control sits at
 * y≈873 — below the fold. scrollIntoView alone was not enough: the shell scrolls
 * its own container back to the top on route changes, so the measurement taken
 * immediately after can still be off-screen. This scrolls, waits for layout,
 * re-measures, and if it is still out of view nudges the scroll container
 * directly. The caller gets an honest yes/no rather than a click that landed on
 * nothing.
 */
async function reveal(client, selector) {
  const inView = (point) =>
    Boolean(point) && point.x >= 0 && point.y >= 0 && point.x <= point.viewport.width && point.y <= point.viewport.height;

  let point = null;
  // Retry rather than trust one measurement: the shell scrolls its container
  // back to the top on route changes, and that effect can land after a single
  // scroll, putting the control back below the fold.
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await evaluate(
      client,
      `(() => { document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: "center", inline: "center" }); return "ok"; })()`,
    );
    await sleep(250 + attempt * 120);
    point = await centreOf(client, selector);
    if (inView(point)) return point;

    const delta = Math.round((point?.y ?? 0) - (point?.viewport?.height ?? 600) / 2);
    await evaluate(
      client,
      `(() => {
         const el = document.querySelector(${JSON.stringify(selector)});
         if (!el) return "missing";
         let node = el.parentElement;
         while (node && node !== document.body) {
           const style = getComputedStyle(node);
           if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) {
             node.scrollTop += ${delta};
             return "scrolled-ancestor";
           }
           node = node.parentElement;
         }
         window.scrollBy(0, ${delta});
         return "scrolled-window";
       })()`,
    );
    await sleep(300);
    point = await centreOf(client, selector);
    if (inView(point)) return point;
  }
  return point;
}

/** A real mouse click: CDP input, so the renderer records user activation. */
async function realClick(client, selector, { waitForEnabled = false } = {}) {
  if (waitForEnabled) {
    await waitFor(
      client,
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el && !el.disabled; })()`,
      15000,
      `${selector} enabled`,
    );
  }
  const point = await reveal(client, selector);
  if (!point) return { clicked: false, reason: "selector not found" };
  // An off-viewport point means the click would silently do nothing, and a
  // harness that reports "clicked" from an event nobody received is worse than
  // one that admits it never reached the control.
  if (point.x < 0 || point.y < 0 || point.x > point.viewport.width || point.y > point.viewport.height) {
    return { clicked: false, reason: "still outside the viewport after two scroll attempts", point };
  }
  for (const type of ["mousePressed", "mouseReleased"]) {
    // A modal child window — the app's own picker, or a Windows consent prompt —
    // blocks input to the parent, and the dispatch then times out. That is a
    // state to report, not a reason to abort the whole run.
    try {
      await client.send(
        "Input.dispatchMouseEvent",
        { type, x: point.x, y: point.y, button: "left", clickCount: 1, buttons: type === "mousePressed" ? 1 : 0 },
        10000,
      );
    } catch (error) {
      return { clicked: false, reason: `input blocked (${error.message}) — a modal window is probably open`, point };
    }
  }
  return { clicked: true, point };
}

/** Close any picker left open by an earlier attempt, so it cannot block input. */
async function dismissStrayPickers(port) {
  const closed = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const list = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) })
      .then((response) => response.json())
      .catch(() => []);
    const pickers = list.filter((t) => t.type === "page" && /picker\.html/.test(t.url ?? ""));
    if (pickers.length === 0) break;
    for (const target of pickers) {
      try {
        const ws = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          ws.addEventListener("open", resolve, { once: true });
          ws.addEventListener("error", reject, { once: true });
          setTimeout(() => reject(new Error("attach timeout")), 5000);
        });
        const pickerClient = createCdpClient(ws);
        await pickerClient.send("Runtime.enable", {}, 8000);
        await pickerClient.send(
          "Runtime.evaluate",
          { expression: `document.querySelector("#cancelBtn")?.click(); "cancelled"` },
          8000,
        );
        ws.close();
        closed.push(target.url);
      } catch {
        /* the window may already be going */
      }
    }
    await sleep(600);
  }
  return closed;
}

async function realDrag(client, from, to, steps = 8) {
  await client.send(
    "Input.dispatchMouseEvent",
    { type: "mousePressed", x: from.x, y: from.y, button: "left", clickCount: 1, buttons: 1 },
    10000,
  );
  for (let step = 1; step <= steps; step += 1) {
    const x = Math.round(from.x + ((to.x - from.x) * step) / steps);
    const y = Math.round(from.y + ((to.y - from.y) * step) / steps);
    await client.send(
      "Input.dispatchMouseEvent",
      { type: "mouseMoved", x, y, button: "left", buttons: 1 },
      10000,
    );
    await sleep(35);
  }
  await client.send(
    "Input.dispatchMouseEvent",
    { type: "mouseReleased", x: to.x, y: to.y, button: "left", clickCount: 1, buttons: 0 },
    10000,
  );
}

/** Attach a second CDP session to whichever page matches, used for the picker. */
async function attachTarget(port, test, timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
      const targets = await response.json();
      const hit = targets.find(
        (t) => t.type === "page" && t.webSocketDebuggerUrl && test(t.url ?? "", t.title ?? ""),
      );
      if (!hit) {
        await sleep(250);
        continue;
      }
      const ws = new WebSocket(hit.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        ws.addEventListener("open", resolve, { once: true });
        ws.addEventListener("error", reject, { once: true });
        setTimeout(() => reject(new Error("target attach timed out")), 10000);
      });
      const client = createCdpClient(ws);
      await client.send("Runtime.enable", {}, 15000);
      await client.send("Page.enable", {}, 15000);
      await client.send("Input.enable", {}, 15000).catch(() => undefined);
      return { client, ws, url: hit.url };
    } catch (error) {
      // The picker window is still being created, and a socket opened against a
      // target mid-creation closes before the first command completes. That is
      // transient, so keep polling until one session survives its enable calls.
      await sleep(400);
      if (Date.now() - started > timeoutMs) throw error;
    }
  }
  throw new Error("no matching target appeared in time");
}

/**
 * Chooses a capture source in the app's real picker window: the same two clicks
 * a person makes. No test-only auto-approve is added to the shipped main process.
 */
async function resolvePicker(port, pick, label) {
  const attached = await attachTarget(port, (url) => /picker\.html/.test(url));
  try {
    await waitFor(attached.client, `!!document.querySelector(".source-card")`, 20000, "picker cards");
    const sources = JSON.parse(
      await evaluate(
        attached.client,
        `JSON.stringify([...document.querySelectorAll(".source-card")].map((c) => ({
           id: c.dataset.id,
           name: c.querySelector(".name")?.textContent ?? "",
           type: c.dataset.id.startsWith("screen:") ? "screen" : "window",
         })))`,
      ),
    );
    const wanted = pick(sources);
    if (!wanted) return { ok: false, reason: `no ${label} source among ${sources.length} listed`, sources };

    // Source ids look like `screen:0:0`; an attribute selector with quotes
    // handles the colons, and the only characters needing escapes are the quote
    // and the backslash themselves.
    const safeId = wanted.id.replace(/[\\"]/g, (character) => `\\${character}`);
    const point = await centreOf(attached.client, `.source-card[data-id="${safeId}"]`).catch(() => null);
    if (!point) return { ok: false, reason: "source card has no box", sources };
    for (const type of ["mousePressed", "mouseReleased"]) {
      await attached.client.send(
        "Input.dispatchMouseEvent",
        { type, x: point.x, y: point.y, button: "left", clickCount: 1, buttons: type === "mousePressed" ? 1 : 0 },
        10000,
      );
    }
    await waitFor(attached.client, `!document.querySelector("#shareBtn")?.disabled`, 10000, "share enabled");

    const audio = await evaluate(
      attached.client,
      `(() => {
         const box = document.querySelector("#shareAudio") ?? document.querySelector(".checkbox-row input[type=checkbox]");
         if (!box) return "absent";
         if (!box.checked) box.click();
         return "checked";
       })()`,
    );

    const share = await centreOf(attached.client, "#shareBtn");
    for (const type of ["mousePressed", "mouseReleased"]) {
      await attached.client.send(
        "Input.dispatchMouseEvent",
        { type, x: share.x, y: share.y, button: "left", clickCount: 1, buttons: type === "mousePressed" ? 1 : 0 },
        10000,
      );
    }
    return { ok: true, sources, chosen: wanted, audio };
  } finally {
    try {
      attached.ws.close();
    } catch {
      /* already gone */
    }
  }
}

/**
 * What the recorder page is saying right now.
 *
 * A real capture started and then left the library empty with no console or page
 * error at all — the app had reported the outcome through its own status chip,
 * notices and toasts, and a harness that does not read them can only report
 * "nothing arrived" without the reason.
 */
async function studioState(client) {
  return JSON.parse(
    await evaluate(
      client,
      `JSON.stringify({
         hash: location.hash,
         status: document.querySelector(".kx-status-chip")?.textContent?.replace(/\\s+/g," ").trim() ?? null,
         notices: [...document.querySelectorAll(".kx-notice")].map((n) => (n.textContent||"").replace(/\\s+/g," ").trim().slice(0,220)),
         alerts: [...document.querySelectorAll("[role='alert'], .kx-alert, .kx-toast")].map((n) => (n.textContent||"").replace(/\\s+/g," ").trim().slice(0,220)),
         buttons: [...document.querySelectorAll("button")].map((b) => (b.textContent||"").replace(/\\s+/g," ").trim()).filter(Boolean).slice(0, 24),
       })`,
    ),
  );
}

/** Newest video in the app's IndexedDB library, decoded inside the app itself. */
async function measureLatest(client, kind = "video") {
  const response = await client.send(
    "Runtime.evaluate",
    {
      expression: `(async () => {
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
        const matching = records.filter((r) => r.kind === ${JSON.stringify(kind)});
        const item = matching[matching.length - 1] ?? null;
        if (!item) return JSON.stringify({ none: true, total: records.length });
        const blob = item.blob instanceof Blob ? item.blob : new Blob([item.blob], { type: item.mimeType });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const head = Array.from(bytes.slice(0, 12)).map((b) => b.toString(16).padStart(2, "0")).join(" ");
        const url = URL.createObjectURL(blob);
        const media = document.createElement("video");
        media.src = url;
        media.muted = true;
        const decoded = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve({ ok: false, error: "metadata timeout" }), 15000);
          media.onloadedmetadata = () => {
            clearTimeout(timer);
            resolve({ ok: true, width: media.videoWidth, height: media.videoHeight, duration: Number.isFinite(media.duration) ? media.duration : null });
          };
          media.onerror = () => { clearTimeout(timer); resolve({ ok: false, error: media.error?.message ?? "decode failed" }); };
        });
        URL.revokeObjectURL(url);
        let binary = "";
        const CHUNK = 0x8000;
        for (let offset = 0; offset < bytes.length; offset += CHUNK) {
          binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + CHUNK));
        }
        return JSON.stringify({
          id: item.id, name: item.name, mimeType: item.mimeType,
          storedWidth: item.width, storedHeight: item.height, storedDuration: item.duration,
          source: item.source, size: bytes.length, magic: head, decoded,
          base64: btoa(binary),
        });
      })()`,
      awaitPromise: true,
      returnByValue: true,
    },
    90000,
  );
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text ?? "library read failed");
  return JSON.parse(response.result.value);
}

function saveArtifact(item, label) {
  if (!item?.base64) return null;
  const safeName = String(item.name ?? "capture").replace(/[^\w.\-]+/g, "_");
  const file = path.join(OUT, `${label}-${safeName}`);
  fs.writeFileSync(file, Buffer.from(item.base64, "base64"));
  return file;
}

function verifyReopen(file) {
  if (!file || !fs.existsSync(file)) return { ok: false, reason: "file missing" };
  const bytes = fs.readFileSync(file);
  const header = bytes.subarray(0, 4).toString("hex");
  return {
    ok: header === "1a45dfa3",
    bytes: bytes.length,
    header,
    reason: header === "1a45dfa3" ? null : "not an EBML/Matroska container",
  };
}

async function main() {
  if (!report.exeExists) {
    gate("packaged binary", "BLOCKED_ENVIRONMENT", `${EXE} not found — build it first`);
    throw new Error(`packaged binary missing: ${EXE}`);
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "knoux-hw-"));
  const session = await startAndAttach({
    executable: EXE,
    baseArgs: [`--user-data-dir=${userDataDir}`],
    cwd: root,
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
  });
  const client = createCdpClient(session.ws, {
    onConsoleError: (message) => report.consoleErrors.push(message),
    onPageError: (message) => report.pageErrors.push(message),
  });

  try {
    await client.send("Page.enable", {}, 20000);
    await client.send("Runtime.enable", {}, 20000);
    await client.send("Input.enable", {}, 20000).catch(() => undefined);

    await waitFor(client, `!!document.querySelector(".kx-app")`, 40000, "app shell");

    // Electron's remote-debugging endpoint does not expose the Browser domain
    // ("Browser.windowForTarget wasn't found"), so the real window cannot be
    // resized from here, and scrolling is a race against the shell's own
    // scroll-to-top on route change — it worked in some runs and not others.
    // The viewport is therefore given explicitly: the page reflows taller, every
    // control lands inside the viewport, and pointer coordinates stop depending
    // on scroll timing. The captured display surface is unaffected — it is still
    // the real 1920x1080 monitor.
    await client
      .send(
        "Emulation.setDeviceMetricsOverride",
        { width: 1384, height: 1240, deviceScaleFactor: 1, mobile: false },
        10000,
      )
      .catch((error) => {
        report.viewportOverride = { attempted: true, failed: String(error.message) };
      });
    await sleep(700);
    report.viewport = JSON.parse(await evaluate(client, `JSON.stringify({ width: innerWidth, height: innerHeight })`));
    check("viewport is tall enough to reach every control", (report.viewport?.height ?? 0) >= 1000, report.viewport);

    // Record every route change with the stack that caused it. The first run of
    // this harness found #/studio had become #/models with no explanation, and
    // a harness that cannot say who moved the page cannot debug itself.
    await evaluate(
      client,
      `(() => {
         window.__routeTrail = [{ at: Date.now(), from: null, to: location.hash, why: "baseline" }];
         window.addEventListener("hashchange", (event) => {
           window.__routeTrail.push({
             at: Date.now(),
             from: String(event.oldURL).split("#")[1] ?? null,
             to: String(event.newURL).split("#")[1] ?? null,
             why: (new Error().stack || "").split("\\n").slice(1, 4).join(" <- "),
           });
         }, true);
         return "instrumented";
       })()`,
    );

    await evaluate(client, `document.querySelector(".kx-splash-skip")?.click(); "ok"`);
    await sleep(1500);

    // `fallback` is source, not a value: it is spliced into the page as the
    // expression to resolve if a probe never returns. Windows holds a consent
    // prompt open for a person, and an unbounded page call stops the whole run.
    const withTimeout = (ms, fallback) =>
      `new Promise((resolve) => setTimeout(() => resolve(${fallback}), ${ms}))`;

    report.environment = JSON.parse(
      await evaluate(
        client,
        `Promise.race([
           (async () => {
             const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
             return JSON.stringify({
               secureContext: window.isSecureContext, dpr: window.devicePixelRatio,
               screen: { width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight },
               inner: { width: innerWidth, height: innerHeight },
               inputs: devices.filter((d) => d.kind === "audioinput").map((d) => d.label || "(unlabelled)"),
               outputs: devices.filter((d) => d.kind === "audiooutput").map((d) => d.label || "(unlabelled)"),
               cameras: devices.filter((d) => d.kind === "videoinput").map((d) => d.label || "(unlabelled)"),
               mimes: ["video/webm;codecs=vp9","video/webm;codecs=vp8","audio/webm;codecs=opus"].map((m) => ({ m, ok: MediaRecorder.isTypeSupported(m) })),
             });
           })(),
           // enumerateDevices can stall behind an OS consent prompt, and an
           // unbounded page call took the whole run down with it.
           ${withTimeout(15000, `JSON.stringify({ stalled: "enumerateDevices did not resolve — a Windows consent prompt is likely open", inputs: [], outputs: [], cameras: [], screen: { width: screen.width, height: screen.height }, dpr: window.devicePixelRatio, mimes: [] })`)}
         ])`,
        25000,
      ),
    );
    const environment = report.environment;
    check("packaged app reaches its shell", true, { target: session.target?.url });
    check("real display is 1920x1080 at dpr 1", environment.screen.width === 1920 && environment.dpr === 1, {
      screen: environment.screen,
      dpr: environment.dpr,
    });

    // ---- microphone: access, then whether any real signal arrives ----
    // getUserMedia can hang rather than reject when Windows is holding a
    // consent prompt, and a hanging page call took the whole run down with it.
    // Every device probe is therefore bounded inside the page itself.
    const mic = JSON.parse(
      await evaluate(
        client,
        `Promise.race([
           (async () => {
             try {
               const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
               const tracks = stream.getAudioTracks();
               const context = new AudioContext();
               const analyser = context.createAnalyser();
               analyser.fftSize = 2048;
               context.createMediaStreamSource(stream).connect(analyser);
               const buffer = new Uint8Array(analyser.frequencyBinCount);
               let peak = 0;
               for (let i = 0; i < 40; i += 1) {
                 await new Promise((r) => setTimeout(r, 50));
                 analyser.getByteTimeDomainData(buffer);
                 for (const value of buffer) peak = Math.max(peak, Math.abs(value - 128));
               }
               const out = { ok: true, tracks: tracks.map((t) => ({ label: t.label, state: t.readyState })), peak };
               tracks.forEach((t) => t.stop());
               await context.close();
               return JSON.stringify(out);
             } catch (error) {
               return JSON.stringify({ ok: false, name: error.name, message: String(error.message) });
             }
           })(),
           ${withTimeout(20000, 'JSON.stringify({ ok: false, name: "Timeout", message: "getUserMedia({audio}) never resolved — an OS consent prompt is likely open and waiting for a person" })')}
         ])`,
        30000,
      ),
    );
    report.microphone = mic;
    if (!mic.ok) {
      gate("microphone access", "BLOCKED_ENVIRONMENT", `${mic.name}: ${mic.message}`);
    } else {
      // An open track is not a captured signal. peak is 0..128; anything under 3
      // is digital silence, which means nobody made a sound at the machine.
      gate(
        "microphone access",
        "VERIFIED_ON_HARDWARE",
        { tracks: mic.tracks, note: "getUserMedia({audio}) returned a live track from the real OS endpoint" },
      );
      gate(
        "microphone signal level",
        mic.peak >= 3 ? "VERIFIED_ON_HARDWARE" : "PARTIAL",
        mic.peak >= 3
          ? { peak: mic.peak }
          : {
              peak: mic.peak,
              note: "the capsule opened and streamed, but captured digital silence — a person must speak at the machine for level to mean anything",
            },
      );
    }

    // ---- camera: unavailable hardware is not the same as a denial ----
    const camera = JSON.parse(
      await evaluate(
        client,
        `Promise.race([
           (async () => {
             try {
               const stream = await navigator.mediaDevices.getUserMedia({ video: true });
               const video = document.createElement("video");
               video.srcObject = stream; video.muted = true;
               await video.play().catch(() => undefined);
               await new Promise((r) => setTimeout(r, 900));
               const out = { ok: true, width: video.videoWidth, height: video.videoHeight, label: stream.getVideoTracks()[0]?.label ?? null };
               stream.getTracks().forEach((t) => t.stop());
               return JSON.stringify(out);
             } catch (error) {
               return JSON.stringify({ ok: false, name: error.name, message: String(error.message) });
             }
           })(),
           ${withTimeout(15000, 'JSON.stringify({ ok: false, name: "Timeout", message: "getUserMedia({video}) never resolved" })')}
         ])`,
        25000,
      ),
    );
    report.camera = camera;
    if (camera.ok) {
      gate("camera capture", "VERIFIED_ON_HARDWARE", camera);
    } else if (camera.name === "NotFoundError" || environment.cameras.length === 0) {
      gate("camera capture", "NOT_AVAILABLE_ON_THIS_MACHINE", {
        error: `${camera.name}: ${camera.message}`,
        videoInputs: environment.cameras,
        note: "no videoinput endpoint exists on this host, so camera acceptance cannot be performed here at any permission level",
      });
    } else {
      gate("camera capture", "BLOCKED_ENVIRONMENT", `${camera.name}: ${camera.message}`);
    }

    // ---- REAL full-screen recording through the app's own picker ----
    report.strayPickersClosed = await dismissStrayPickers(session.port);
    // Settle on the recorder route and prove the controls are actually there
    // before clicking anything: the previous run found the page on #/models and
    // reported a missing start control as if the app were broken.
    let route = null;
    let modeButtons = 0;
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      await evaluate(client, `location.hash = "#/studio"; "ok"`);
      await sleep(500);
      route = await evaluate(client, `location.hash`);
      modeButtons = Number(await evaluate(client, `document.querySelectorAll("[data-capture-mode]").length`));
      if (route === "#/studio" && modeButtons > 0) break;
    }
    const trail = await evaluate(client, `JSON.stringify(window.__routeTrail ?? [])`);
    check("recorder route holds and exposes its capture modes", route === "#/studio" && modeButtons > 0, {
      route,
      modeButtons,
      title: await evaluate(client, `document.title`),
      trail: JSON.parse(trail),
    });

    const started = await realClick(client, "[data-start-recording]");
    check("start control clicked with real mouse input", started.clicked, started);

    const picker = await resolvePicker(
      session.port,
      (sources) => sources.find((s) => s.type === "screen"),
      "screen",
    ).catch(async (error) => ({ ok: false, reason: String(error.message) }));
    if (!picker.ok) {
      // Record what DevTools actually saw at the moment of failure. "no target"
      // and "a target that closes on attach" are different faults with different
      // causes, and the harness cannot tell them apart from the error string.
      picker.targetsAtFailure = await fetch(`http://127.0.0.1:${session.port}/json/list`)
        .then((response) => response.json())
        .then((list) => list.map((t) => ({ type: t.type, title: t.title, url: t.url })))
        .catch((fetchError) => String(fetchError.message));
      picker.viewportAtFailure = report.viewport;
    }
    check("app picker offered a real screen source", picker.ok === true, picker.reason ?? picker.chosen);

    if (picker.ok) {
      const recording = await waitFor(
        client,
        `document.querySelector(".kx-status-chip")?.textContent?.includes("Recording") ?? false`,
        25000,
        "recording started",
      ).then(() => true).catch(() => false);
      check("recording reaches the Recording state on real hardware", recording);

      await sleep(RECORD_SECONDS * 1000);
      report.recordingState = await studioState(client);
      await realClick(client, "[data-stop-recording]");
      await sleep(6000);
      report.afterStopState = await studioState(client);

      const item = await measureLatest(client);
      const file = saveArtifact(item, "fullscreen");
      const reopen = verifyReopen(file);
      report.captures.push({ mode: "fullscreen", item: { ...item, base64: undefined }, file, reopen });
      if (!item.id) {
        check("full-screen attempt produced a library item", false, {
          library: item,
          afterStop: report.afterStopState,
        });
      }

      check("full-screen file stored with real bytes", (item.size ?? 0) > 2000, { size: item.size, magic: item.magic });
      check(
        "full-screen file decodes at the real display size",
        Boolean(item.decoded?.ok && item.decoded.width === 1920 && item.decoded.height === 1080),
        item.decoded,
      );
      check("full-screen recording has a real duration", (item.decoded?.duration ?? 0) >= 2, item.decoded);
      check("full-screen file reopens from disk as EBML/Matroska", reopen.ok, reopen);
      gate(
        "full screen recording",
        item.decoded?.ok && item.decoded.width === 1920 && reopen.ok ? "VERIFIED_ON_HARDWARE" : "FAILED",
        { width: item.decoded?.width, height: item.decoded?.height, duration: item.decoded?.duration, bytes: item.size, file },
      );

      // ---- selected area: the mission's critical gate, on real pixels ----
      const regionChip = await realClick(client, '[data-capture-mode="region"]');
      const regionSelected = regionChip.clicked
        ? true
        : await evaluate(
            client,
            `(() => { const b = [...document.querySelectorAll("button")].find((x) => /Selected area|منطقة محددة/.test(x.textContent ?? "")); b?.click(); return !!b; })()`,
          );
      check("region mode selectable", Boolean(regionSelected));
      await sleep(1200);

      // In area mode the start control does not record: it calls
      // requestRegionStream(), which asks the OS for a display surface so the
      // app can show the real desktop behind the selector. The stage therefore
      // only exists after the picker has been answered — looking for it before
      // this click was the reason the gate reported "no stage".
      const regionStart = await realClick(client, "[data-start-recording]");
      check("area-mode start clicked", regionStart.clicked, regionStart);
      const regionPicker = await resolvePicker(
        session.port,
        (sources) => sources.find((s) => s.type === "screen"),
        "screen",
      ).catch((error) => ({ ok: false, reason: String(error.message) }));
      check("area mode obtained a real display surface for the selector", regionPicker.ok === true, regionPicker.reason ?? regionPicker.chosen);
      await sleep(1500);

      const stage = JSON.parse(
        await evaluate(
          client,
          `(() => { const el = document.querySelector("[data-region-stage]"); if (!el) return "null"; const r = el.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }); })()`,
        ),
      );
      if (stage) {
        // Draw a rectangle inset from every edge so the crop is unambiguous.
        const inset = Math.max(24, Math.round(Math.min(stage.width, stage.height) * 0.18));
        await realDrag(
          client,
          { x: stage.x + inset, y: stage.y + inset },
          { x: stage.x + stage.width - inset, y: stage.y + stage.height - inset },
        );
        await sleep(600);
        // The readout states both the source surface and the selected rectangle
        // ("1920×1080 source · 1533×693 selected"), which is exactly the pair the
        // gate needs. The in-recording badge is a separate element and is not
        // always present while selecting, so the readout is the source of truth.
        const readout = await evaluate(client, `document.querySelector("[data-region-readout]")?.textContent ?? ""`);
        const parsed = readout.match(/(\d+)×(\d+)\s*source\s*·\s*(\d+)×(\d+)\s*selected/i);
        const badge = JSON.parse(
          await evaluate(
            client,
            `(() => { const n = document.querySelector("[data-region-badge]"); const m = n?.textContent?.match(/(\\d+)×(\\d+)\\s*@\\s*(-?\\d+),(-?\\d+)/); return JSON.stringify(m ? { width: +m[1], height: +m[2], x: +m[3], y: +m[4] } : null); })()`,
          ),
        );
        const selected = parsed
          ? { sourceWidth: +parsed[1], sourceHeight: +parsed[2], width: +parsed[3], height: +parsed[4] }
          : badge
            ? { sourceWidth: 1920, sourceHeight: 1080, width: badge.width, height: badge.height }
            : null;
        check("region selector reports a real rectangle smaller than the source", Boolean(selected) && selected.width < selected.sourceWidth, { readout, badge, selected });

        const confirmClicked = await realClick(client, ".kx-region-footer .kx-btn-primary");
        check("region confirm clicked", confirmClicked.clicked, confirmClicked);
        const regionRecording = await waitFor(
          client,
          `document.querySelector(".kx-status-chip")?.textContent?.includes("Recording") ?? false`,
          25000,
          "region recording started",
        ).then(() => true).catch(() => false);
        check("region recording starts on real hardware", regionRecording);

        await sleep(RECORD_SECONDS * 1000);
        await realClick(client, "[data-stop-recording]");
        await sleep(5000);

        const regionItem = await measureLatest(client);
        const regionFile = saveArtifact(regionItem, "region");
        const regionReopen = verifyReopen(regionFile);
        report.captures.push({ mode: "region", selected, badge, item: { ...regionItem, base64: undefined }, file: regionFile, reopen: regionReopen });

        const tolerance = 4;
        const matchesRectangle =
          Boolean(selected) &&
          regionItem.decoded?.ok &&
          Math.abs(regionItem.decoded.width - selected.width) <= tolerance &&
          Math.abs(regionItem.decoded.height - selected.height) <= tolerance;
        const notWholeSurface =
          regionItem.decoded?.ok &&
          Boolean(selected) &&
          (regionItem.decoded.width !== selected.sourceWidth || regionItem.decoded.height !== selected.sourceHeight);
        check("selected-area file is NOT the whole source surface", notWholeSurface, {
          decoded: regionItem.decoded,
          selected,
        });
        check("selected-area file matches the chosen rectangle", matchesRectangle, { decoded: regionItem.decoded, selected });
        check("selected-area file reopens from disk", regionReopen.ok, regionReopen);
        gate(
          "selected area recording (real pixels)",
          matchesRectangle && notWholeSurface && regionReopen.ok ? "VERIFIED_ON_HARDWARE" : "FAILED",
          {
            chosen: selected,
            decoded: regionItem.decoded,
            bytes: regionItem.size,
            file: regionFile,
            note: "a decorative overlay that recorded the whole monitor would decode at 1920x1080 and fail this gate",
          },
        );
      } else {
        gate("selected area recording (real pixels)", "FAILED", "no [data-region-stage] after choosing region mode");
      }

      // ---- application window capture ----
      await evaluate(client, `location.hash = "#/studio"; "ok"`);
      await sleep(1200);
      const windowChip = await evaluate(
        client,
        `(() => { const b = [...document.querySelectorAll("button")].find((x) => /^(Window|النافذة)$/.test((x.textContent ?? "").trim())); b?.click(); return !!b; })()`,
      );
      check("window mode selectable", Boolean(windowChip));
      await sleep(500);
      const windowStart = (await realClick(client, "[data-start-recording]")).clicked;
      // The previous picker window is still tearing down; attaching to the next
      // one too quickly closed the socket mid-handshake.
      await sleep(1500);
      const windowPicker = windowStart
        ? await resolvePicker(
            session.port,
            (sources) => sources.find((s) => s.type === "window" && !/KNOUX/i.test(s.name)),
            "window",
          ).catch((error) => ({ ok: false, reason: String(error.message) }))
        : { ok: false, reason: "start not clicked" };
      check("picker offered a real application window", windowPicker.ok === true, windowPicker.reason ?? windowPicker.chosen);

      if (windowPicker.ok) {
        await waitFor(
          client,
          `document.querySelector(".kx-status-chip")?.textContent?.includes("Recording") ?? false`,
          25000,
          "window recording started",
        ).catch(() => undefined);
        await sleep(RECORD_SECONDS * 1000);
        await realClick(client, "[data-stop-recording]");
        await sleep(5000);
        const windowItem = await measureLatest(client);
        const windowFile = saveArtifact(windowItem, "window");
        const windowReopen = verifyReopen(windowFile);
        report.captures.push({
          mode: "window",
          chosen: windowPicker.chosen,
          item: { ...windowItem, base64: undefined },
          file: windowFile,
          reopen: windowReopen,
        });
        gate(
          "application window recording",
          windowItem.decoded?.ok && windowItem.decoded.width > 0 && windowReopen.ok ? "VERIFIED_ON_HARDWARE" : "FAILED",
          { source: windowPicker.chosen?.name, decoded: windowItem.decoded, bytes: windowItem.size, file: windowFile },
        );
      }
    }

    // ---- system audio, read from the picker the app actually presented ----
    // A second bare getDisplayMedia call would open another picker that nobody
    // resolves and hang the run. The picker's audio option is the OS's own
    // answer about whether this display surface can carry audio at all.
    const audioOffered = picker.ok ? picker.audio : "unknown";
    report.systemAudio = {
      fromPicker: audioOffered,
      recordedWithScreen: Boolean(picker.ok && audioOffered === "checked"),
    };
    gate(
      "system audio availability",
      audioOffered === "checked" ? "AVAILABLE_UNVERIFIED" : audioOffered === "absent" ? "BLOCKED_ENVIRONMENT" : "UNKNOWN",
      {
        note:
          audioOffered === "checked"
            ? "the picker offered a system-audio option and it was enabled for the full-screen take; whether audio bytes landed still needs the produced file inspected"
            : audioOffered === "absent"
              ? "the app's picker exposes no audio option on this host, so system audio cannot be requested here"
              : "the picker never opened, so nothing is known",
      },
    );
  } finally {
    if (!KEEP) killTree(session.child);
    try {
      session.ws?.close();
    } catch {
      /* ignore */
    }
  }
}

main()
  .then(() => {
    report.finishedAt = new Date().toISOString();
    const passed = report.checks.filter((c) => c.pass).length;
    fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
    console.log("\n══════════ HARDWARE ACCEPTANCE ══════════");
    for (const g of report.gates) console.log(`  ${g.status.padEnd(26)} ${g.name}`);
    console.log(`\n${report.checks.length} checks · ${passed} passed · ${report.checks.length - passed} failed`);
    for (const c of report.checks.filter((x) => !x.pass)) {
      console.log(`  FAIL ${c.name} :: ${JSON.stringify(c.detail).slice(0, 200)}`);
    }
    console.log(`\nReport: ${path.join(OUT, "report.json")}`);
    const blocking = report.gates.filter((g) => g.status === "FAILED");
    process.exit(blocking.length || report.checks.some((c) => !c.pass) ? 1 : 0);
  })
  .catch((error) => {
    report.error = String(error);
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
    console.error("FATAL", error);
    process.exit(1);
  });
