#!/usr/bin/env node
/**
 * i18n gate.
 *
 * Fails when a user-visible string is hardcoded in the shipped renderer, or
 * when the translation dictionary contains a value that is not valid Arabic.
 *
 * The renderer must reach its strings through src/i18n/translate.ts so the
 * Arabic build stays complete.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Which directories hold renderer code — every .tsx below them is scanned.
//
// This used to be a hand-typed list of 30 paths. That is how src/views/ui.tsx,
// the dialog and badge library behind every route, stayed unchecked while its
// English chrome shipped into the Arabic build, and how a route added next
// month would be invisible to the gate until someone remembered this file.
const SCAN_ROOTS = ["src/app", "src/ui", "src/views", "src/state"];

// Surfaces that must always be present in the discovered set.
const REQUIRED_SCANNED = [
  "src/app/Sidebar.tsx",
  "src/app/TopBar.tsx",
  "src/app/SplashScreen.tsx",
  "src/app/AppRoot.tsx",
  "src/views/Dashboard.tsx",
  "src/views/StudioView.tsx",
  "src/views/ScreenshotsView.tsx",
  "src/views/LibraryView.tsx",
  "src/views/BatchView.tsx",
  "src/views/AudioStudioView.tsx",
  "src/views/ui.tsx",
  "src/ui/RegionSelector.tsx",
  "src/ui/CurveEditor.tsx",
];

function collectRendererFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectRendererFiles(full, out);
    else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
      out.push(full.split(path.sep).join("/"));
    }
  }
  return out;
}

const SCANNED_FILES = [
  ...new Set(SCAN_ROOTS.flatMap((dir) => collectRendererFiles(dir))),
].sort();

// Registries that carry user-visible labels through a key field rather than a
// t("…") call, so their literals are checked against the dictionary too.
const KEY_FIELD_FILES = [
  "src/services/elysianPresets.ts",
  "src/data/knouxIdentity.ts",
];

// A JSX text node breaks across source lines whenever the copy is wrapped at a
// readable width, so a newline has to be part of the character class. Excluding
// them let every multi-line paragraph slip through this gate unnoticed.
//
// The lookbehind skips `=> Promise<void>` and `=> Partial<Settings>`: an arrow
// followed by a generic type reads exactly like a JSX text node to this regex.
const TEXT_PATTERN =
  /(?<!=)>\s*([A-Z][A-Za-z0-9 ,.'’&/():%+—\-\n]{3,})\s*</g;
const ATTRIBUTE_PATTERN =
  /(?:title|aria-label|placeholder|hint|label|description|message|eyebrow)=(?:"([A-Z][A-Za-z0-9 ,.'’&/():%+—\-]{3,})")/g;
const QUOTED_LITERAL_PATTERN =
  /(?:title|aria-label|placeholder|hint|description)="([A-Z][A-Za-z0-9 ,.'’&/():%+—\-]{8,})"/g;

const failures = [];

// A rename or a move that takes one of these out of the discovered set is a
// coverage regression, not a cleanup.
for (const required of REQUIRED_SCANNED) {
  if (!SCANNED_FILES.includes(required)) {
    failures.push(
      `gate coverage: "${required}" is no longer scanned — check SCAN_ROOTS and the file's location`,
    );
  }
}

// Brand names and technical identifiers that are intentionally not translated.
const ALLOWED = new Set([
  "KNOUX",
  "KNOUX REC",
  "IndexedDB",
  "localStorage",
  "MediaRecorder",
  "MediaDevices",
  "getUserMedia",
  "WebM",
  "WEBP",
  "JPEG",
  "PNG",
  // Container and codec names printed beside a measured support mark. They are
  // the same tokens in every language and are shown inside dir="ltr" spans.
  "WAV",
  "MP3",
  "AAC",
  "FLAC",
  "Opus",
  "WebM/Opus",
  "Capture.",
  "Create.",
  "Ctrl+Shift+R",
  // A printed key combination, like the recorder hotkeys above: it is the same
  // two tokens in every language and is not prose to translate.
  "Ctrl K",
  "Ctrl O",
]);

const dictionary = fs.readFileSync(path.join(root, "src/i18n/translate.ts"), "utf8");

for (const file of SCANNED_FILES) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  const hits = new Set();
  for (const match of text.matchAll(TEXT_PATTERN)) {
    // Wrapped copy normalises to single spaces so a hit is the string the
    // reader sees, not the source's line breaks.
    hits.add(match[1].replace(/\s+/g, " ").trim());
  }
  for (const match of text.matchAll(ATTRIBUTE_PATTERN)) hits.add(match[1].trim());
  for (const hit of hits) {
    if (ALLOWED.has(hit)) continue;
    failures.push(`${file}: hardcoded user-visible string "${hit}"`);
  }
}

// An Arabic value identical to the English one usually means the translation
// was never written.
const bilingual = [
  ...dictionary.matchAll(
    /"?([a-zA-Z][a-zA-Z0-9.]*)"?:\s*\{\s*en:\s*"([^"]*)"\s*,\s*ar:\s*"([^"]*)"\s*\}/g,
  ),
];
for (const [, key, english, arabic] of bilingual) {
  if (english.trim() && english === arabic) {
    failures.push(`src/i18n/translate.ts: "${key}" has an untranslated Arabic value`);
  }
}

const arabicValues = [...dictionary.matchAll(/ar:\s*"([^"]*)"/g)].map((match) => match[1]);
for (const value of arabicValues) {
  if (value.includes("?")) {
    failures.push(`src/i18n/translate.ts: broken Arabic value "${value}"`);
  }
  if (value.trim().length === 0) {
    failures.push("src/i18n/translate.ts: empty Arabic value");
  }
}
const arabicCharacters = (dictionary.match(/[\u0600-\u06FF]/g) || []).length;
if (arabicCharacters < 1000) {
  failures.push(
    `src/i18n/translate.ts: only ${arabicCharacters} Arabic characters found, the dictionary looks truncated`,
  );
}

// Every t("...") key used in the renderer must exist in the dictionary.
const dictionaryKeys = new Set(
  [...dictionary.matchAll(/^\s*"?([a-zA-Z][a-zA-Z0-9.]*)"?:\s*\{\s*en:/gm)].map(
    (match) => match[1],
  ),
);
for (const file of SCANNED_FILES) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  // A word boundary keeps setters such as setFit("contain") from being
  // mistaken for translation lookups.
  for (const match of text.matchAll(/\bt\("([a-zA-Z][a-zA-Z0-9.]*)"\)/g)) {
    if (!dictionaryKeys.has(match[1])) {
      failures.push(`${file}: missing translation key "${match[1]}"`);
    }
  }
}

// Registries declare labels through key fields rather than a t("...") call, so
// a typo there stays invisible until the UI renders the raw key. Both the
// dedicated registry files and the view files are resolved here.
for (const file of [...SCANNED_FILES, ...KEY_FIELD_FILES]) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  for (const match of text.matchAll(
    /\b(?:labelKey|reasonKey|hintKey|actionKey):\s*"([a-zA-Z][a-zA-Z0-9.]*)"/g,
  )) {
    if (!dictionaryKeys.has(match[1])) {
      failures.push(`${file}: missing translation key "${match[1]}"`);
    }
  }
}

// A dotted string whose first segment is a real dictionary namespace is a
// translation key wherever it appears — including lookup tables such as
// STATE_KEY, which no t("...") call and no *Key field reveals.
const namespaces = new Set(
  [...dictionaryKeys]
    .filter((key) => key.includes("."))
    .map((key) => key.slice(0, key.indexOf("."))),
);
for (const file of SCANNED_FILES) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  for (const match of text.matchAll(/"([a-z][a-zA-Z0-9]*\.[a-zA-Z0-9.]+)"/g)) {
    const key = match[1];
    if (!namespaces.has(key.slice(0, key.indexOf(".")))) continue;
    if (!dictionaryKeys.has(key)) {
      failures.push(`${file}: missing translation key "${key}"`);
    }
  }
}

if (failures.length) {
  console.error(`i18n gate: FAILED (${failures.length} problems)`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log(
  `i18n gate: PASSED (${SCANNED_FILES.length} renderer files, ${arabicValues.length} translated strings)`,
);
