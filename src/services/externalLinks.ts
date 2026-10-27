/**
 * External destination policy.
 *
 * Every link the corporate identity page opens goes through this module, so a
 * hand-edited data file can never aim a click at `javascript:` or a local file.
 *
 * Two runtimes are supported and never conflated:
 *  - the Electron shell, which exposes an approved `openExternal` bridge that
 *    validates again in the main process before calling `shell.openExternal`;
 *  - a plain browser, where an https link opens in a new tab and a
 *    `mailto:`/`tel:` link is handed to an anchor click. A browser cannot know
 *    whether the operating system actually has a handler, so the caller gets an
 *    honest "handed off" outcome rather than a claim that a call started.
 */

export type ExternalScheme = "https" | "mailto" | "tel";

/** The slice of the desktop bridge this module needs, kept structural for tests. */
export interface ExternalLinkBridge {
  openExternal?(url: string): Promise<boolean> | boolean;
}

export type OpenOutcome =
  | { ok: true; via: "electron" | "browser"; scheme: ExternalScheme }
  | { ok: false; reason: "unsafe-url" | "no-handler" | "failed"; scheme: ExternalScheme | null };

/**
 * True when the value carries a control character, a space or DEL anywhere.
 * A legitimate destination never does, and this is what stops a split scheme
 * such as `java` + newline + `script:` from reaching the parser.
 */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Classify a destination, returning the scheme only when it is one of the three
 * the application is allowed to open. Anything else — `http:`, `file:`,
 * `data:`, `javascript:`, a protocol-relative string, an empty or padded value,
 * or a malformed URL — is refused.
 */
export function externalScheme(raw: string): ExternalScheme | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Whitespace and control characters inside a URL are a classic handler
  // smuggling trick (`java` + newline + `script:`), so any character below the
  // printable range, plus DEL, is refused before the value is parsed.
  if (hasControlCharacter(trimmed)) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const scheme = url.protocol.replace(/:$/, "").toLowerCase() as ExternalScheme;
  if (scheme !== "https" && scheme !== "mailto" && scheme !== "tel") return null;

  if (scheme === "https") {
    // A hostname is required, and credentials in the authority are never okay.
    if (!url.hostname.includes(".")) return null;
    if (url.username || url.password) return null;
    return "https";
  }
  if (scheme === "mailto") {
    const address = decodeURIComponent(url.pathname).trim();
    if (!/^[^\s@]+@[^\s@]+(\.[^\s@]+)+$/i.test(address)) return null;
    return "mailto";
  }
  const digits = url.pathname.replace(/[^\dx+*#]/gi, "");
  if (digits.replace(/\D/g, "").length < 6) return null;
  return "tel";
}

export function isSafeExternalUrl(raw: string): boolean {
  return externalScheme(raw) !== null;
}

function bridgeOpened(
  bridge: ExternalLinkBridge | undefined,
  url: string,
): Promise<boolean> | null {
  if (!bridge || typeof bridge.openExternal !== "function") return null;
  return Promise.resolve(bridge.openExternal(url));
}

/**
 * Open a destination through the safest available path. The caller is expected
 * to surface the outcome verbatim: `no-handler` and `failed` are reported as
 * failures, never as success.
 */
export async function openExternal(
  raw: string,
  bridge?: ExternalLinkBridge | null,
): Promise<OpenOutcome> {
  const scheme = externalScheme(raw);
  if (!scheme) return { ok: false, reason: "unsafe-url", scheme: null };
  const target = raw.trim();

  const accepted = bridgeOpened(bridge ?? undefined, target);
  if (accepted !== null) {
    try {
      return (await accepted)
        ? { ok: true, via: "electron", scheme }
        : { ok: false, reason: "no-handler", scheme };
    } catch {
      return { ok: false, reason: "failed", scheme };
    }
  }

  try {
    if (scheme === "https") {
      const opened = window.open(target, "_blank", "noopener,noreferrer");
      return opened
        ? { ok: true, via: "browser", scheme }
        : { ok: false, reason: "no-handler", scheme };
    }
    // mailto: and tel: have no window to open; an anchor click is how a browser
    // hands them to the registered protocol handler.
    const anchor = document.createElement("a");
    anchor.href = target;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return { ok: true, via: "browser", scheme };
  } catch {
    return { ok: false, reason: "failed", scheme };
  }
}

/**
 * Copy a value to the clipboard. Returns false when the platform refuses, so
 * the UI can show a real failure instead of a success it did not earn.
 */
export async function copyText(value: string): Promise<boolean> {
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const field = document.createElement("textarea");
    field.value = value;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    return copied;
  } catch {
    return false;
  }
}

/** The main-process allowlist, mirrored here so both layers agree. */
export const MAIN_PROCESS_ALLOWLIST = ["https:", "mailto:", "tel:"] as const;
