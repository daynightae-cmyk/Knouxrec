import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const read = (file) => readFile(path.join(ROOT, file), "utf8");
const clean = (value) => value.replace(/\s+/g, " ").trim();

const routesSource = await read("src/app/capabilities.ts");
const routeBlocks = [...routesSource.matchAll(/^\s{2}(?:"([^"]+)"|([a-z-]+)):\s*\{([\s\S]*?)^\s{2}\},/gm)];
const routes = routeBlocks.map((match) => {
  const id = match[1] ?? match[2];
  const body = match[3];
  const field = (name) => body.match(new RegExp(`${name}:\\s*"([^"]*)"`))?.[1] ?? "";
  const state = field("state");
  const requirements = [
    ...(body.match(/requirements:\s*\[([\s\S]*?)\]/)?.[1] ?? "").matchAll(/"([^"]*)"/g),
  ].map((entry) => entry[1]);
  return {
    id,
    group: field("group"),
    state,
    summary: field("summary"),
    requirements,
    evidence: field("evidence"),
  };
});

const offlineSource = await read("services/offlineAIToolsService.ts");
const offlineAI = [
  ...offlineSource.matchAll(
    /{\s*id:\s*"([^"]+)",\s*name:\s*"([^"]*)",\s*nameEn:\s*"([^"]*)",[\s\S]*?category:\s*"([^"]*)",[\s\S]*?modelPath:\s*"([^"]+)",[\s\S]*?modelSize:\s*(\d+)/g,
  ),
].map((match) => ({
  id: match[1],
  name: match[2],
  nameEn: match[3],
  category: match[4],
  modelPath: match[5],
  modelSize: Number(match[6]),
  status: "MISSING_MODEL",
}));

const arabicSource = (await read("components/ArabicAIToolsPanel.tsx")).slice(
  (await read("components/ArabicAIToolsPanel.tsx")).indexOf("export const ARABIC_AI_TOOLS"),
);
const arabicAI = [
  ...arabicSource.matchAll(
    /{\s*icon:\s*"([^"]*)",\s*title:\s*"([^"]*)",[\s\S]*?desc:\s*"([^"]*)",[\s\S]*?modelSize:\s*(\d+),[\s\S]*?time:\s*(\d+),/g,
  ),
].map((match, index) => ({
  id: `arabic-ai-${String(index + 1).padStart(2, "0")}`,
  title: match[2],
  description: match[3],
  modelSize: Number(match[4]),
  minutes: Number(match[5]),
  status: "MISSING_ENGINE",
}));

const visualSource = await read("types/visualPatchLab.ts");
const visualPatch = [
  ...visualSource.matchAll(
    /{\s*id:\s*"([^"]+)",\s*name:\s*"([^"]*)",\s*nameAr:\s*"([^"]*)",\s*category:\s*"([^"]*)"/g,
  ),
].map((match) => ({
  id: match[1],
  name: match[2],
  nameAr: match[3],
  category: match[4],
  status: "MISSING_ENGINE",
}));

const morphSource = await read("services/knouxMorphCore.ts");
const morphCore = [
  ...morphSource.matchAll(
    /{\s*id:\s*"([^"]+)",\s*name:\s*"([^"]*)",\s*nameEn:\s*"([^"]*)",\s*category:\s*"([^"]*)",\s*executable:\s*"([^"]+)"/g,
  ),
].map((match) => ({
  id: match[1],
  name: match[2],
  nameEn: match[3],
  category: match[4],
  executable: match[5],
  status: "MISSING_ENGINE",
}));

const toolboxSource = await read("components/ToolboxPanel.tsx");
const toolbox = [
  ...toolboxSource.matchAll(
    /id:\s*"(image-resizer|image-filter|image-format-converter|video-thumbnail|audio-visualizer|text-generator|qr-generator|color-palette)",\s*name:\s*"([^"]+)"/g,
  ),
].map((match) => ({ id: match[1], name: match[2], status: "BLOCKED" }));

const templateSource = await read("components/TemplatesPanel.tsx");
const baseTemplateIds = [
  ...templateSource
    .slice(templateSource.indexOf("const baseRealTemplates"), templateSource.indexOf("];", templateSource.indexOf("const baseRealTemplates")))
    .matchAll(/id:\s*"([^"]+)"/g),
].map((match) => match[1]);
const templateCategories = [
  ["for-you", 15],
  ["birthday", 8],
  ["festival", 6],
  ["vlog", 10],
  ["social-media", 12],
];
const generatedTemplates = templateCategories.flatMap(([category, count]) =>
  Array.from({ length: count }, (_, index) => ({
    id: `${category}-generated-${index + 1}`,
    category,
    status: "MOCK",
  })),
);

const modelRoot = path.join(ROOT, "public/models");
const models = [];
for (const entry of await readdir(modelRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const manifestPath = `public/models/${entry.name}/model.json`;
  try {
    const manifest = JSON.parse(await readFile(path.join(ROOT, manifestPath), "utf8"));
    let hasWeights = false;
    try {
      const weightStat = await stat(path.join(modelRoot, entry.name, "weights.bin"));
      hasWeights = weightStat.size > 0;
    } catch {
      hasWeights = false;
    }
    models.push({
      id: entry.name,
      name: manifest.name ?? manifest.modelName ?? entry.name,
      version: manifest.version ?? null,
      manifest: manifestPath,
      expectedWeights: `public/models/${entry.name}/weights.bin`,
      weightsPresent: hasWeights,
      status: hasWeights ? "AVAILABLE_UNVERIFIED" : "MISSING_MODEL",
    });
  } catch (error) {
    models.push({
      id: entry.name,
      manifest: manifestPath,
      expectedWeights: `public/models/${entry.name}/weights.bin`,
      weightsPresent: false,
      status: "BLOCKED",
      error: String(error),
    });
  }
}
models.sort((a, b) => a.id.localeCompare(b.id));

const core = [
  {
    id: "screen-recording",
    name: "Screen recording",
    state: "RUNTIME_VERIFIED",
    evidence: "Headless Chrome fake display: 1920x1080 VP9/Opus WebM, patched finite duration, exported EBML signature.",
  },
  {
    id: "camera-recording",
    name: "Camera recording",
    state: "RUNTIME_VERIFIED",
    evidence: "Fake camera capture produced a 4.84s 1920x1080 VP9/Opus clip persisted in IndexedDB.",
  },
  {
    id: "pause-resume",
    name: "Pause and resume",
    state: "RUNTIME_VERIFIED",
    evidence: "recording-smoke.mjs pauses and resumes; elapsed time excludes paused spans.",
  },
  {
    id: "screenshot-capture",
    name: "Screenshot capture",
    state: "RUNTIME_VERIFIED",
    evidence: "Live display stream drew real pixels into canvas; 1920x1080 image saved and previewed.",
  },
  {
    id: "library-persistence",
    name: "Library persistence",
    state: "RUNTIME_VERIFIED",
    evidence: "IndexedDB objects survive full reload; blob URLs are recreated on hydrate.",
  },
  {
    id: "video-trim",
    name: "Video trim",
    state: "RUNTIME_VERIFIED",
    evidence: "Trim re-encodes a range to a new item, patches WebM duration and keeps the original.",
  },
  {
    id: "webm-duration",
    name: "WebM duration patch",
    state: "RUNTIME_VERIFIED",
    evidence: "EBML Info>Duration injected; browser reports finite duration instead of Infinity.",
  },
  {
    id: "export-download",
    name: "Export download",
    state: "RUNTIME_VERIFIED",
    evidence: "Download produced a file starting with EBML magic 1a45dfa3.",
  },
  {
    id: "favorites",
    name: "Library favorites",
    state: "BUILD_VERIFIED",
    evidence: "Favorite flag persisted through libraryStore.setFavorite; UI filter is wired.",
  },
  {
    id: "settings-persistence",
    name: "Settings persistence",
    state: "RUNTIME_VERIFIED",
    evidence: "Theme and language survive reload; document root receives theme/lang/dir.",
  },
  {
    id: "rtl-arabic",
    name: "Arabic RTL",
    state: "RUNTIME_VERIFIED",
    evidence: "Language toggle sets lang=ar dir=rtl with no horizontal overflow.",
  },
  {
    id: "high-dpi",
    name: "High DPI",
    state: "RUNTIME_VERIFIED",
    evidence: "deviceScaleFactor 1.25 and 1.5 rendered without overflow.",
  },
  {
    id: "minimum-window",
    name: "Minimum window",
    state: "RUNTIME_VERIFIED",
    evidence: "1024x700 viewport has no horizontal overflow.",
  },
  {
    id: "reduced-motion",
    name: "Reduced motion",
    state: "RUNTIME_VERIFIED",
    evidence: "prefers-reduced-motion collapses animation durations.",
  },
  {
    id: "navigation-history",
    name: "Back and forward navigation",
    state: "RUNTIME_VERIFIED",
    evidence: "ui-smoke.mjs verifies back returns to recorder and forward to library.",
  },
  {
    id: "permission-error",
    name: "Permission error recovery",
    state: "RUNTIME_VERIFIED",
    evidence: "Denied camera shows an error notice, no fake preview, and Dismiss restores ready state.",
  },
];

const counts = {
  routes: routes.length,
  core: core.length,
  offlineAI: offlineAI.length,
  arabicAI: arabicAI.length,
  visualPatch: visualPatch.length,
  morphCore: morphCore.length,
  toolbox: toolbox.length,
  templatesBase: baseTemplateIds.length,
  templatesGenerated: generatedTemplates.length,
  models: models.length,
};

const payload = {
  generatedAt: new Date().toISOString(),
  source: {
    repository: "https://github.com/daynightae-cmyk/Knouxrec.git",
    commit: "05a542957a62730301972361c1300ccd7d66ca54",
    note: "Generated from the working tree; runtime states reference artifacts/evidence.",
  },
  counts,
  routes,
  core,
  offlineAI,
  arabicAI,
  visualPatch,
  morphCore,
  toolbox,
  templates: {
    base: baseTemplateIds.map((id) => ({ id, status: "BLOCKED" })),
    generated: generatedTemplates,
  },
  models,
};

const esc = (value) => String(value ?? "").replace(/\|/g, "\\|");
const table = (headers, rows) =>
  [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(esc).join(" | ")} |`),
  ].join("\n");

const markdown = `# KNOUX REC capability registry

Generated ${payload.generatedAt} from commit ${payload.source.commit} (working tree).

Counts: ${Object.entries(counts)
  .map(([key, value]) => `${key}=${value}`)
  .join(", ")}.

Statuses are evidence-based. \`MISSING_MODEL\` and \`MISSING_ENGINE\` mean the catalog entry ships without its runtime; \`MOCK\` means the data is explicitly generated placeholder content; \`BLOCKED\` means the view cannot be mounted as shipped.

## Routes

${table(
  ["Route", "Group", "State", "Summary"],
  routes.map((route) => [route.id, route.group, route.state, route.summary]),
)}

## Core runtime

${table(
  ["Capability", "State", "Evidence"],
  core.map((entry) => [entry.id, entry.state, entry.evidence]),
)}

## Offline AI catalog (${offlineAI.length})

${table(
  ["ID", "English name", "Category", "Model", "Status"],
  offlineAI.map((entry) => [entry.id, entry.nameEn, entry.category, entry.modelPath, entry.status]),
)}

## Arabic AI catalog (${arabicAI.length})

${table(
  ["ID", "Title", "Model size (MB)", "Minutes", "Status"],
  arabicAI.map((entry) => [entry.id, entry.title, entry.modelSize, entry.minutes, entry.status]),
)}

## Visual Patch (${visualPatch.length})

${table(
  ["ID", "English name", "Category", "Status"],
  visualPatch.map((entry) => [entry.id, entry.name, entry.category, entry.status]),
)}

## MorphCore (${morphCore.length})

${table(
  ["ID", "English name", "Category", "Executable", "Status"],
  morphCore.map((entry) => [entry.id, entry.nameEn, entry.category, entry.executable, entry.status]),
)}

## Toolbox (${toolbox.length})

${table(
  ["ID", "Name", "Status"],
  toolbox.map((entry) => [entry.id, entry.name, entry.status]),
)}

## Templates (${baseTemplateIds.length} base + ${generatedTemplates.length} generated)

Base: ${baseTemplateIds.join(", ")}

Generated entries are explicitly tagged \`dummy\`/\`generated\` by the source and are recorded as \`MOCK\`.

## Models (${models.length})

${table(
  ["ID", "Manifest", "Expected weights", "Weights present", "Status"],
  models.map((entry) => [entry.id, entry.manifest, entry.expectedWeights, entry.weightsPresent, entry.status]),
)}
`;

await mkdir(path.join(ROOT, "docs"), { recursive: true });
await writeFile(path.join(ROOT, "docs/CAPABILITY_REGISTRY.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
await writeFile(path.join(ROOT, "docs/CAPABILITY_REGISTRY.md"), markdown, "utf8");

console.log(JSON.stringify(counts, null, 2));
