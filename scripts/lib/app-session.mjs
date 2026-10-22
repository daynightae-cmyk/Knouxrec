import { execFileSync, spawn } from "node:child_process";
import net from "node:net";

/**
 * Shared helper for the DevTools-driven smoke tests.
 *
 * It owns the fragile part of talking to a freshly started desktop app:
 *
 *  - the DevTools target is replaced while the renderer boots, so a socket
 *    attached to a transient target never answers again;
 *  - the renderer sets document.title only after the app mounted, which under
 *    load can take a minute, so the target is matched on its URL instead;
 *  - on a busy machine the GPU process can die ("GPU process exited
 *    unexpectedly"), which makes the renderer exit cleanly and the app quit.
 *    In that case the app is relaunched with the GPU disabled, which keeps the
 *    DOM-level assertions of the smoke valid.
 */

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function freePort() {
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

export function createCdpClient(ws, { onConsoleError, onPageError, onFailedRequest, onRequestUrl } = {}) {
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
      onConsoleError?.(
        message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "),
      );
    }
    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params.exceptionDetails;
      onPageError?.(details?.exception?.description ?? details?.text ?? "exception");
    }
    if (message.method === "Network.loadingFailed") {
      onFailedRequest?.(
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

export async function evaluate(client, expression, timeoutMs = 20000) {
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

export async function waitFor(client, expression, timeoutMs, label) {
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

/** Waits for the real application document to be the current DevTools target. */
export async function discoverTarget(port, timeoutMs) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      last = targets.map((t) => ({ type: t.type, title: t.title, url: t.url }));
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
  return { page: null, last };
}

export function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
        timeout: 15000,
      });
    } catch {
      // the process may already have exited
    }
  } else {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
  }
}

/**
 * Starts the application and attaches to its renderer.
 *
 * Returns { child, ws, client, target, attempts, gpuFallback } or throws with
 * the last error after every attempt failed.
 */
export async function startAndAttach({
  executable,
  args,
  cwd,
  port,
  timeoutMs = 120000,
  attempts = 3,
  env,
}) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const useGpuFallback = attempt > 1;
    const launchArgs = useGpuFallback ? [...args, "--disable-gpu", "--disable-gpu-compositing"] : args;
    let child = null;
    let ws = null;
    let exited = false;

    try {
      child = spawn(executable, launchArgs, {
        cwd,
        env: env ?? process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.once("exit", () => {
        exited = true;
      });

      const { page, last } = await discoverTarget(port, timeoutMs);
      if (!page) {
        throw new Error(
          exited
            ? "the application exited before the renderer appeared (GPU process failure)"
            : `the application document never appeared${last ? `: ${JSON.stringify(last)}` : ""}`,
        );
      }

      ws = new WebSocket(page.webSocketDebuggerUrl);
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

      return {
        child,
        ws,
        target: page,
        attempts: attempt,
        gpuFallback: useGpuFallback,
        kill: () => {
          try {
            ws?.close();
          } catch {
            // ignore
          }
          killTree(child);
        },
      };
    } catch (error) {
      lastError = error;
      try {
        ws?.close();
      } catch {
        // ignore
      }
      killTree(child);
      if (attempt < attempts) await sleep(1500);
    }
  }

  throw lastError ?? new Error("could not attach to the application");
}
