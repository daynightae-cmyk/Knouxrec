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

const VIEW_FILES = [
  "src/app/Sidebar.tsx",
  "src/app/TopBar.tsx",
  "src/app/SplashScreen.tsx",
  "src/app/ErrorBoundary.tsx",
  "src/app/ToastViewport.tsx",
  "src/views/Dashboard.tsx",
  "src/views/StudioView.tsx",
  "src/views/ScreenshotsView.tsx",
  "src/views/LibraryView.tsx",
  "src/views/SettingsView.tsx",
  "src/views/DiagnosticsView.tsx",
  "src/views/ModelsView.tsx",
];

const TEXT_PATTERN = />\s*([A-Z][A-Za-z0-9 ,.'’&/():%+—\-]{3,})\s*</g;
const ATTRIBUTE_PATTERN =
  /(?:title|aria-label|placeholder|hint|label|description|message|eyebrow)=(?:"([A-Z][A-Za-z0-9 ,.'’&/():%+—\-]{3,})")/g;
const QUOTED_LITERAL_PATTERN =
  /(?:title|aria-label|placeholder|hint|description)="([A-Z][A-Za-z0-9 ,.'’&/():%+—\-]{8,})"/g;

const failures = [];

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
  "Capture.",
  "Create.",
  "Ctrl+Shift+R",
]);

const dictionary = fs.readFileSync(path.join(root, "src/i18n/translate.ts"), "utf8");

for (const file of VIEW_FILES) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  const hits = new Set();
  for (const match of text.matchAll(TEXT_PATTERN)) hits.add(match[1].trim());
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
for (const file of VIEW_FILES) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  for (const match of text.matchAll(/t\("([a-zA-Z][a-zA-Z0-9.]*)"\)/g)) {
    if (!dictionaryKeys.has(match[1])) {
      failures.push(`${file}: missing translation key "${match[1]}"`);
    }
  }
}

if (failures.length) {
  console.error(`i18n gate: FAILED (${failures.length} problems)`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}

console.log(
  `i18n gate: PASSED (${VIEW_FILES.length} views, ${arabicValues.length} translated strings)`,
);
