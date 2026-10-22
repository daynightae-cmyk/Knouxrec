import type { CapabilityState } from "../state/types";

export type RouteId =
  | "dashboard"
  | "studio"
  | "screenshots"
  | "library"
  | "templates"
  | "toolbox"
  | "visual-patch"
  | "morphcore"
  | "elysian"
  | "body-editor"
  | "offline-ai"
  | "arabic-ai"
  | "models"
  | "settings"
  | "diagnostics";

export interface Capability {
  id: RouteId;
  group: "capture" | "library" | "create" | "intelligence" | "system";
  labelKey: string;
  state: CapabilityState;
  summary: string;
  requirements: string[];
  evidence: string;
  adult?: boolean;
}

export interface SectionGroup {
  id: Capability["group"];
  labelKey: string;
  routes: RouteId[];
}

export const NAVIGATION: SectionGroup[] = [
  { id: "capture", labelKey: "groupRecord", routes: ["dashboard", "studio", "screenshots"] },
  { id: "library", labelKey: "groupLibrary", routes: ["library"] },
  {
    id: "create",
    labelKey: "groupCreate",
    routes: ["templates", "toolbox", "visual-patch", "morphcore", "elysian", "body-editor"],
  },
  { id: "intelligence", labelKey: "groupIntelligence", routes: ["offline-ai", "arabic-ai", "models"] },
  { id: "system", labelKey: "groupSystem", routes: ["settings", "diagnostics"] },
];

/**
 * Truthful capability registry. State is deliberately conservative:
 * nothing is labelled VERIFIED until it has been executed in a real runtime.
 */
export const CAPABILITIES: Record<RouteId, Capability> = {
  dashboard: {
    id: "dashboard",
    group: "capture",
    labelKey: "dashboard",
    state: "VERIFIED",
    summary: "Unified capture dashboard with live recorder status and recent local media.",
    requirements: [],
    evidence: "Rendered shell; navigation and recorder state wired to a single provider.",
  },
  studio: {
    id: "studio",
    group: "capture",
    labelKey: "studio",
    state: "VERIFIED",
    summary:
      "Real getDisplayMedia/getUserMedia capture through MediaRecorder with pause/resume and persisted output.",
    requirements: ["Screen capture permission", "MediaRecorder support"],
    evidence:
      "RecordingSession records real timestamps from the active media stream; output is written to IndexedDB.",
  },
  screenshots: {
    id: "screenshots",
    group: "capture",
    labelKey: "screenshots",
    state: "VERIFIED",
    summary: "Real pixel capture from the display stream with PNG/JPEG/WebP encoding.",
    requirements: ["Screen capture permission"],
    evidence: "Canvas drawImage from a live display stream; blob signature checked before saving.",
  },
  library: {
    id: "library",
    group: "library",
    labelKey: "library",
    state: "VERIFIED",
    summary: "Persistent local library with preview, rename, delete, export and trim.",
    requirements: ["IndexedDB"],
    evidence: "Items survive reload; object URLs are created from stored blobs, never placeholders.",
  },
  templates: {
    id: "templates",
    group: "create",
    labelKey: "templates",
    state: "BLOCKED",
    summary:
      "Template browser preserved, but it is not mounted: its dependency graph does not compile or run as shipped.",
    requirements: ["Repaired VisualPatchToolCard exports", "Runtime verification"],
    evidence:
      "components/TemplatesPanel.tsx imports a VisualPatchTool export that does not exist; its tool cards call missing service methods.",
  },
  toolbox: {
    id: "toolbox",
    group: "create",
    labelKey: "toolbox",
    state: "BLOCKED",
    summary:
      "Media utility panel preserved, but it is not mounted: the shared tool card has no default export and broken handlers.",
    requirements: ["Repaired VisualPatchToolCard", "Per-tool runtime verification"],
    evidence:
      "components/ToolboxPanel.tsx default-imports VisualPatchToolCard, which only exposes named exports; handlers call absent processor APIs.",
  },
  "visual-patch": {
    id: "visual-patch",
    group: "create",
    labelKey: "visualPatch",
    state: "BLOCKED",
    summary:
      "Region-based image editor preserved, but it is not mounted because its processing pipeline is incomplete.",
    requirements: ["Repaired processor methods", "Runtime pixel diffing"],
    evidence:
      "components/VisualPatchLabPanel.tsx and VisualPatchToolCard.tsx call extractAudio/detectObjects/applyStyle methods that do not exist on the services.",
  },
  morphcore: {
    id: "morphcore",
    group: "create",
    labelKey: "morphCore",
    state: "MISSING_ENGINE",
    summary:
      "Body-shape tool catalog preserved, but it depended on fictional .exe modules and fabricated output paths.",
    requirements: ["Native morphology engine", "Per-tool validated model"],
    evidence:
      "services/knouxMorphCore.ts only simulates execution; no executable module or pixel pipeline exists.",
    adult: true,
  },
  elysian: {
    id: "elysian",
    group: "create",
    labelKey: "elysian",
    state: "PARTIAL",
    summary:
      "Image editing workspace with slider filters, real presets and PNG export. The AI inference pipeline is not part of the bundle.",
    requirements: ["Image input", "Model weights for the AI pipeline"],
    evidence:
      "scripts/elysian-smoke.mjs drives the packaged binary: age gate, upload, preset filter and a PNG export whose pixels carry the filter.",
    adult: true,
  },
  "body-editor": {
    id: "body-editor",
    group: "create",
    labelKey: "bodyEditor",
    state: "MISSING_MODEL",
    summary:
      "Age-gated body editor UI preserved. It depends on segmentation models whose weight files are not distributed.",
    requirements: ["Age verification", "Segmentation weights", "Inference runtime"],
    evidence: "public/models/*/model.json manifests exist, weights.bin files do not.",
    adult: true,
  },
  "offline-ai": {
    id: "offline-ai",
    group: "intelligence",
    labelKey: "offlineAI",
    state: "MISSING_MODEL",
    summary:
      "38-tool catalog recovered. The previous service returned synthetic images/transcripts; it is now marked unavailable instead of faking output.",
    requirements: ["Model weights", "Inference runtime"],
    evidence:
      "Weights binaries are absent from public/models; the old service produced canvas placeholders.",
  },
  "arabic-ai": {
    id: "arabic-ai",
    group: "intelligence",
    labelKey: "arabicAI",
    state: "MISSING_ENGINE",
    summary:
      "38-tool Arabic catalog preserved for future engines; the prior handler only waited and logged.",
    requirements: ["Per-tool inference engine"],
    evidence: "components/ArabicAIToolsPanel.tsx handleToolRun performed no processing.",
  },
  models: {
    id: "models",
    group: "intelligence",
    labelKey: "models",
    state: "MISSING_MODEL",
    summary: "Model manifest inventory with explicit weight-file verification.",
    requirements: ["Weight binaries"],
    evidence: "Only model.json graph metadata ships; no weights.bin present.",
  },
  settings: {
    id: "settings",
    group: "system",
    labelKey: "settings",
    state: "VERIFIED",
    summary: "Persisted appearance, language and recording defaults.",
    requirements: [],
    evidence: "Settings persist in localStorage and are applied to the document root.",
  },
  diagnostics: {
    id: "diagnostics",
    group: "system",
    labelKey: "diagnostics",
    state: "VERIFIED",
    summary: "Runtime capability matrix measured from MediaDevices, MediaRecorder and IndexedDB.",
    requirements: [],
    evidence: "Values computed in-browser; model availability proven by bundle inspection.",
  },
};

export const ROUTE_TITLES: Record<RouteId, string> = {
  dashboard: "dashboard",
  studio: "studio",
  screenshots: "screenshots",
  library: "library",
  templates: "templates",
  toolbox: "toolbox",
  "visual-patch": "visualPatch",
  morphcore: "morphCore",
  elysian: "elysian",
  "body-editor": "bodyEditor",
  "offline-ai": "offlineAI",
  "arabic-ai": "arabicAI",
  models: "models",
  settings: "settings",
  diagnostics: "diagnostics",
};
