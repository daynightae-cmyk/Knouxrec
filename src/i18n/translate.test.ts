import { describe, expect, it } from "vitest";
import { dictionaryEntry, dictionaryKeys, fill, translate } from "./translate";

/**
 * The Arabic build is a shipped surface, not a machine translation. These
 * checks exist because a code-agent wrote an English word straight into an
 * Arabic value ("إعادة shaping") and every existing gate passed it: the source
 * was valid TypeScript and the Arabic side was not literally equal to English.
 */

// Tokens that are the same in every language: formats, hardware, key names and
// the product's own identity. Anything else in Latin script is a leak.
const TECHNICAL_LATIN = new Set([
  "webm", "webp", "jpeg", "jpg", "png", "gif", "svg", "ico", "pdf", "wav",
  "mp3", "aac", "flac", "opus", "mp4", "mkv", "mov", "avi", "csv", "json",
  "html", "css", "usb", "dvi", "hdmi", "nvme", "ssd", "cpu", "gpu", "ram",
  "lufs", "dbfs", "hz", "kb", "mb", "gb", "tb", "fps", "dpi", "dpr", "hdr",
  "sdr", "rgb", "cmyk", "rgba", "argb", "utf", "sha", "md", "url", "uri",
  "http", "https", "oauth", "api", "ipc", "exe", "msi", "nsis", "xbox",
  "indexeddb", "localstorage", "mediarecorder", "mediadevices", "getusermedia",
  "getdisplaymedia", "javascript", "typescript", "react", "electron", "vite",
  "windows", "android", "macos", "linux", "ubuntu", "photoshop", "premiere",
  "chromium", "obs", "discord", "telegram", "zoom", "meet", "teams", "slack",
  "chrome", "edge", "firefox", "safari", "knoux", "rec", "store", "admin",
  "com", "ctrl", "shift", "alt", "esc", "escape", "tab", "enter", "backspace",
  "pro", "max", "ultra", "mini", "beta", "lite", "sdk", "pngs", "screenshot",
  "elgazar", "eng",
  // Runtime and API nouns the Arabic copy deliberately keeps: naming them in
  // Arabic would send the reader looking for a control the product does not
  // call by that name.
  "blob", "canvas", "cairo", "mime", "head", "http", "chunk", "codec",
  "bitrate", "keyframe", "container",
  // KNOUX's own engine names: the product calls them this in both locales.
  "morphcore", "elysian", "knouxrec",
]);

const LATIN_WORD = /[A-Za-z]{4,}/g;
const ARABIC_SCRIPT = /[؀-ۿ]/;
const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;

// Interpolation tokens, naming tokens, file names and paths are not prose: a
// dictionary value may carry "weights.bin" or "{count}" through both locales
// unchanged. Removed before the Latin-word scan.
const NON_PROSE =
  /\{[a-zA-Z][a-zA-Z0-9]*\}|\[[A-Z]{3,}\]|[A-Za-z0-9_-]+(?:[./-][A-Za-z0-9_-]+)+|[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+/g;

const keys = dictionaryKeys();

/** Latin words in an Arabic value that are neither technical nor a token. */
function latinLeak(value: string): string[] {
  const stripped = value.replace(NON_PROSE, " ");
  const found: string[] = [];
  for (const word of stripped.match(LATIN_WORD) ?? []) {
    if (TECHNICAL_LATIN.has(word.toLowerCase())) continue;
    // An all-capitals run is a filter token, mode id or acronym the app prints
    // verbatim in both locales. Leaked prose arrives lowercase, so this does
    // not excuse it.
    if (/^[A-Z]{3,}$/.test(word)) continue;
    found.push(word);
  }
  return found;
}

describe("dictionary shape", () => {
  it("is populated", () => {
    expect(keys.length).toBeGreaterThan(1000);
  });

  it("gives every key both locales", () => {
    for (const key of keys) {
      const entry = dictionaryEntry(key);
      expect(entry, key).toBeDefined();
      expect(entry?.en.trim(), `${key} english`).not.toHaveLength(0);
      expect(entry?.ar.trim(), `${key} arabic`).not.toHaveLength(0);
    }
  });

  it("never leaves an Arabic value identical to its English one", () => {
    const same = keys.filter((key) => dictionaryEntry(key)?.en === dictionaryEntry(key)?.ar);
    expect(same).toEqual([]);
  });
});

describe("Arabic values", () => {
  it("contain Arabic script", () => {
    const missing = keys.filter((key) => {
      const ar = dictionaryEntry(key)?.ar ?? "";
      return !ARABIC_SCRIPT.test(ar);
    });
    expect(missing).toEqual([]);
  });

  it("carry no untranslated English words", () => {
    const leaked: string[] = [];
    for (const key of keys) {
      const raw = dictionaryEntry(key)?.ar ?? "";
      for (const word of latinLeak(raw)) {
        leaked.push(`${key}: "${word}" in "${raw}"`);
      }
    }
    expect(leaked).toEqual([]);
  });

  it("carries no characters from a third script", () => {
    // Two Arabic values shipped with Chinese inside them ("整套 الإبداع…"
    // and "…الأوزان也不再 التحقق…"). Neither the Latin-word rule nor the
    // Arabic-script rule notices that: the value does contain Arabic, and CJK
    // is not Latin. The product speaks English and Arabic, nothing else.
    const THIRD_SCRIPT =
      /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u0400-\u04FF\u0370-\u03FF\u1100-\u11FF\uAC00-\uD7AF]/;
    const offenders = keys
      .map((key) => {
        const entry = dictionaryEntry(key);
        const field = THIRD_SCRIPT.test(entry?.ar ?? "")
          ? "ar"
          : THIRD_SCRIPT.test(entry?.en ?? "")
            ? "en"
            : null;
        return field ? `${key} (${field})` : null;
      })
      .filter(Boolean);
    expect(offenders).toEqual([]);
  });

  it("detector itself distinguishes a leak from a technical token", () => {
    // The regression this rule was written for, and the shapes it must not
    // report. Without this the suite above could pass on a broken detector.
    expect(latinLeak("تحرير · إعادة shaping · ترقيع")).toEqual(["shaping"]);
    expect(latinLeak("جارٍ فحص MediaDevices وMediaRecorder والخطوط")).toEqual([]);
    expect(latinLeak("عدد ملفات model.json الموجودة")).toEqual([]);
    expect(latinLeak("{count} قسمًا")).toEqual([]);
    expect(latinLeak("ضع اسمًا مثل LOCAL أو MODEL-LOCAL")).toEqual([]);
  });

  it("keeps every placeholder the English value declares", () => {
    const broken: string[] = [];
    for (const key of keys) {
      const entry = dictionaryEntry(key);
      if (!entry) continue;
      const english = [...entry.en.matchAll(PLACEHOLDER)].map((m) => m[1]).sort();
      const arabic = [...entry.ar.matchAll(PLACEHOLDER)].map((m) => m[1]).sort();
      if (english.join(",") !== arabic.join(",")) {
        broken.push(`${key}: en {${english}} vs ar {${arabic}}`);
      }
    }
    expect(broken).toEqual([]);
  });
});

describe("fill", () => {
  it("substitutes a token", () => {
    expect(fill("{count} sections", { count: "12" })).toBe("12 sections");
  });

  it("substitutes every occurrence, not only the first", () => {
    expect(fill("{n} and {n}", { n: "1" })).toBe("1 and 1");
  });

  it("leaves a token the caller did not supply visible", () => {
    expect(fill("kept {count} here", {})).toBe("kept {count} here");
  });

  it("treats the replacement as text, not a replacement pattern", () => {
    expect(fill("size: {bytes}", { bytes: "$& literal" })).toBe("size: $& literal");
  });

  it("does not read the token as a regular expression", () => {
    expect(fill("{a.b} tail", { "a.b": "x" })).toBe("x tail");
  });
});

describe("translate", () => {
  it("returns the key when nothing is registered", () => {
    expect(translate("en", "definitely.not.a.key")).toBe("definitely.not.a.key");
  });

  it("resolves a real key in both locales", () => {
    expect(translate("en", "ui.stateBlocked")).toBe("Blocked");
    expect(translate("ar", "ui.stateBlocked")).toBe("محجوبة");
  });

  it("covers every capability state the shared badge renders", () => {
    for (const state of [
      "VERIFIED",
      "AVAILABLE_UNVERIFIED",
      "PARTIAL",
      "MISSING_ENGINE",
      "MISSING_MODEL",
      "NOT_IMPLEMENTED",
      "BLOCKED",
    ]) {
      const key = `ui.state${state.charAt(0)}${state
        .slice(1)
        .toLowerCase()
        .replace(/_([a-z])/g, (_, c) => c.toUpperCase())}`;
      expect(dictionaryEntry(key), key).toBeDefined();
    }
  });
});
