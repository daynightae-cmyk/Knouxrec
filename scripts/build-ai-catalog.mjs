#!/usr/bin/env node
/**
 * Builds the unified AI catalog.
 *
 * The repository ships two catalogs that describe the same 38 tasks twice:
 * `src/data/offlineAICatalog.ts` (English ids, categories and model paths) and
 * `components/ArabicAIToolsPanel.tsx` (Arabic titles sorted alphabetically).
 * The blueprint asks for shared canonical task ids instead of "76 misleading
 * independent inference pipelines", so this script derives the mapping from
 * the two sources and writes `src/data/aiCatalog.ts`.
 *
 * The mapping is asserted: every Arabic entry must land on an offline entry
 * whose expected model size agrees, so a source change that breaks the
 * correspondence fails the build instead of silently producing a wrong table.
 */

import fs from "node:fs";

const ARABIC_SOURCE = "components/ArabicAIToolsPanel.tsx";
const OFFLINE_SOURCE = "src/data/offlineAICatalog.ts";
const OUTPUT = "src/data/aiCatalog.ts";

/** Arabic entry index (alphabetical order in the panel) -> offline catalog id. */
const CORRESPONDENCE = [
  ["remove_background", "إزالة الخلفية"],
  ["extract_audio", "استخراج الصوت"],
  ["extract_scenes", "استخراج المشاهد"],
  ["ocr_extract", "استخراج النص من الصور"],
  ["extract_faces_video", "استخراج الوجوه من الفيديو"],
  ["face_swap", "تبديل الوجوه"],
  ["track_objects", "تتبع الأجسام"],
  ["stabilize_video", "تثبيت الفيديو"],
  ["enhance_voice", "تحسين الصوت البشري"],
  ["enhance_face", "تحسين الوجه والجلد"],
  ["enhance_image", "تحسين جودة الصور"],
  ["enhance_video", "تحسين جودة الفيديو"],
  ["sentiment_analysis", "تحليل المشاعر"],
  ["analyze_fps", "تحليل معدل الإطارات"],
  ["local_speech_to_text", "تحويل الكلام المحلي"],
  ["speech_to_text", "تحويل الكلام إلى نص"],
  ["toonify_image", "تحويل إلى رسمة"],
  ["extract_frames", "تحويل فيديو إلى صور"],
  ["change_pitch", "تغيير نغمة الصوت"],
  ["upscale_image", "تكبير الصور"],
  ["colorize_image", "تلوين الصور القديمة"],
  ["generate_spectrogram", "توليد طيف ترددي"],
  ["reverse_audio", "عكس الصوت"],
  ["separate_audio", "فصل الصوت والموسيقى"],
  ["video_filters", "فلاتر الفيديو"],
  ["language_detector", "كاشف اللغة"],
  ["detect_objects", "كشف الأجسام"],
  ["detect_motion", "كشف الحركة"],
  ["edge_detection", "كشف الحواف والتفاصيل"],
  ["detect_faces", "كشف الوجوه"],
  ["detect_silence", "كشف فترات الصمت"],
  ["noise_profiler", "محلل الضوضاء"],
  ["file_analyzer", "محلل الملفات الشامل"],
  ["audio_converter", "محول الصوت"],
  ["frequency_filter", "مرشح الترددات"],
  ["document_classifier", "مصنف الوثائق"],
  ["text_summarizer", "ملخص النصوص"],
  ["text_generator", "مولد النصوص"],
];

/** Input / output kind per canonical task. */
const IO = {
  remove_background: ["image", "image"],
  upscale_image: ["image", "image"],
  enhance_image: ["image", "image"],
  detect_objects: ["image", "detections"],
  detect_faces: ["image", "detections"],
  face_swap: ["image", "image"],
  colorize_image: ["image", "image"],
  toonify_image: ["image", "image"],
  enhance_face: ["image", "image"],
  edge_detection: ["image", "image"],
  track_objects: ["video", "tracks"],
  extract_scenes: ["video", "clips"],
  stabilize_video: ["video", "video"],
  enhance_video: ["video", "video"],
  detect_motion: ["video", "events"],
  analyze_fps: ["video", "metrics"],
  extract_audio: ["video", "audio"],
  video_filters: ["video", "video"],
  extract_faces_video: ["video", "detections"],
  extract_frames: ["video", "images"],
  separate_audio: ["audio", "audio"],
  enhance_voice: ["audio", "audio"],
  detect_silence: ["audio", "events"],
  speech_to_text: ["audio", "text"],
  change_pitch: ["audio", "audio"],
  generate_spectrogram: ["audio", "image"],
  noise_profiler: ["audio", "metrics"],
  reverse_audio: ["audio", "audio"],
  frequency_filter: ["audio", "audio"],
  audio_converter: ["audio", "audio"],
  ocr_extract: ["image", "text"],
  text_summarizer: ["text", "text"],
  sentiment_analysis: ["text", "metrics"],
  local_speech_to_text: ["text", "text"],
  text_generator: ["text", "text"],
  language_detector: ["text", "text"],
  document_classifier: ["text", "labels"],
  file_analyzer: ["file", "report"],
};

const arabicSource = fs.readFileSync(ARABIC_SOURCE, "utf8");
const arabicStart = arabicSource.indexOf("ARABIC_AI_TOOLS: AITool[] = [");
const arabicBody = arabicSource.slice(arabicStart, arabicSource.indexOf("];", arabicStart));
const arabicRe =
  /icon:\s*"([^"]*)",\s*title:\s*"([^"]*)",\s*difficulty:\s*"([^"]*)",\s*color:\s*"([^"]*)",\s*desc:\s*"([^"]*)",\s*features:\s*\[([^\]]*)\],\s*modelSize:\s*(\d+),\s*time:\s*(\d+),\s*points:\s*(\d+)/g;
const arabic = [];
let match;
while ((match = arabicRe.exec(arabicBody)) !== null) {
  arabic.push({
    icon: match[1],
    title: match[2],
    difficulty: match[3],
    color: match[4],
    desc: match[5],
    features: match[6]
      .split(",")
      .map((value) => value.trim().replace(/^"|"$/g, ""))
      .filter(Boolean),
    modelSize: Number(match[7]),
    time: Number(match[8]),
    points: Number(match[9]),
  });
}

const offlineSource = fs.readFileSync(OFFLINE_SOURCE, "utf8");
const offlineRe =
  /"id":\s*"([^"]+)",\s*"name":\s*"([^"]+)",\s*"nameEn":\s*"([^"]+)",\s*"category":\s*"([^"]+)",\s*"modelPath":\s*"([^"]+)",\s*"modelSize":\s*(\d+)/g;
const offline = [];
while ((match = offlineRe.exec(offlineSource)) !== null) {
  offline.push({
    id: match[1],
    name: match[2],
    nameEn: match[3],
    category: match[4],
    modelPath: match[5],
    modelSize: Number(match[6]),
  });
}

if (arabic.length !== 38 || offline.length !== 38) {
  console.error(
    `Expected 38 entries in both catalogs, found ${arabic.length} Arabic and ${offline.length} offline.`,
  );
  process.exit(1);
}

const offlineById = new Map(offline.map((entry) => [entry.id, entry]));
const seenOffline = new Set();
const entries = [];

CORRESPONDENCE.forEach(([offlineId, expectedTitle], index) => {
  const source = arabic[index];
  const offlineEntry = offlineById.get(offlineId);
  if (!offlineEntry) {
    console.error(`Unknown offline id "${offlineId}".`);
    process.exit(1);
  }
  if (source.title !== expectedTitle) {
    console.error(
      `Arabic entry ${index} is "${source.title}" but the correspondence table expects "${expectedTitle}".`,
    );
    process.exit(1);
  }
  if (seenOffline.has(offlineId)) {
    console.error(`Offline id "${offlineId}" is mapped twice.`);
    process.exit(1);
  }
  seenOffline.add(offlineId);

  const ratio = offlineEntry.modelSize / source.modelSize;
  if (ratio < 0.9 || ratio > 1.1) {
    console.error(
      `Model size mismatch for "${offlineId}": offline ${offlineEntry.modelSize} MB vs Arabic ${source.modelSize} MB.`,
    );
    process.exit(1);
  }

  const [inputType, outputType] = IO[offlineId] ?? ["file", "file"];
  entries.push({
    id: offlineId,
    nameEn: offlineEntry.nameEn,
    nameAr: source.title,
    descriptionEn: offlineEntry.nameEn,
    descriptionAr: source.desc,
    category: offlineEntry.category,
    modelId: offlineEntry.modelPath.split("/")[2],
    modelPath: offlineEntry.modelPath,
    expectedSizeMb: offlineEntry.modelSize,
    inputType,
    outputType,
    difficulty: source.difficulty,
    estimatedSeconds: source.time,
    credits: source.points,
    features: source.features,
    aliases: [offlineId, `arabic-${index}`],
  });
});

if (seenOffline.size !== 38) {
  console.error(`Only ${seenOffline.size} offline tools were mapped.`);
  process.exit(1);
}

const body = entries
  .map((entry) => {
    const aliasList = entry.aliases.map((alias) => `"${alias}"`).join(", ");
    const featureList = entry.features.map((feature) => `"${feature}"`).join(", ");
    return `  {
    id: "${entry.id}",
    nameEn: "${entry.nameEn}",
    nameAr: "${entry.nameAr}",
    descriptionEn: "${entry.descriptionEn}",
    descriptionAr: "${entry.descriptionAr}",
    category: "${entry.category}",
    modelId: "${entry.modelId}",
    modelPath: "${entry.modelPath}",
    expectedSizeMb: ${entry.expectedSizeMb},
    inputType: "${entry.inputType}",
    outputType: "${entry.outputType}",
    difficulty: "${entry.difficulty}",
    estimatedSeconds: ${entry.estimatedSeconds},
    credits: ${entry.credits},
    features: [${featureList}],
    aliases: [${aliasList}],
  },`;
  })
  .join("\n");

const output = `/**
 * Unified AI catalog.
 *
 * GENERATED FILE — do not edit by hand.
 * Rebuild with \`node scripts/build-ai-catalog.mjs\`.
 *
 * The repository described the same 38 on-device tasks twice: an English
 * catalog with ids, categories and model paths, and an Arabic panel with the
 * localized titles, difficulty and feature list. They are the same tasks, so
 * this catalog stores one canonical entry per task with both labels, the
 * source aliases and the single model each one actually requires.
 */

export type AiTaskCategory = "image" | "video" | "audio" | "text" | "analysis";

export type AiTaskStatus =
  | "RUNTIME_VERIFIED"
  | "BUILD_VERIFIED"
  | "STATIC_VERIFIED"
  | "PARTIAL"
  | "MISSING_MODEL"
  | "MISSING_ENGINE"
  | "BLOCKED"
  | "MOCK"
  | "NOT_TESTED";

export interface AiCatalogEntry {
  /** Canonical task id — the same value in both source catalogs. */
  id: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  category: AiTaskCategory;
  /** Folder under /models that must provide the weights. */
  modelId: string;
  /** Manifest path declared by the source catalog. */
  modelPath: string;
  /** Expected weight payload in megabytes, as declared by the sources. */
  expectedSizeMb: number;
  inputType: string;
  outputType: string;
  difficulty: "easy" | "medium" | "hard";
  /** Source estimate in seconds — a source claim, not a measured value. */
  estimatedSeconds: number;
  credits: number;
  features: string[];
  /** Ids this task answers to in the preserved catalogs. */
  aliases: string[];
}

export const AI_CATALOG: AiCatalogEntry[] = [
${body}
];

export const AI_CATALOG_CATEGORIES: AiTaskCategory[] = [
  "image",
  "video",
  "audio",
  "text",
  "analysis",
];

export function findAiTask(id: string): AiCatalogEntry | undefined {
  return AI_CATALOG.find((entry) => entry.id === id);
}

/**
 * Resolve any alias — an offline id, an Arabic index or the canonical id — to
 * its canonical task.
 */
export function resolveAiTask(alias: string): AiCatalogEntry | undefined {
  return AI_CATALOG.find((entry) => entry.aliases.includes(alias) || entry.id === alias);
}
`;

fs.writeFileSync(OUTPUT, output, "utf8");
console.log(`Wrote ${OUTPUT} with ${entries.length} canonical tasks.`);
