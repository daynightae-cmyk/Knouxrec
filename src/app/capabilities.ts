import type { CapabilityState } from "../state/types";

export type RouteId =
  | "dashboard"
  | "discover"
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
  | "diagnostics"
  | "live-studio";

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
  {
    id: "capture",
    labelKey: "groupRecord",
    routes: ["dashboard", "discover", "studio", "screenshots"],
  },
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
  discover: {
    id: "discover",
    group: "capture",
    labelKey: "discover",
    state: "VERIFIED",
    summary:
      "One place to find every service: global search across the canonical registry, hub filters, favourites and recents, with the execution mode (local, model-local, hybrid, online) and the honest run state of each entry. Blocked services name the missing dependency and link to the model manager.",
    requirements: [],
    evidence:
      "src/data/serviceRegistry.ts is the single source and src/data/serviceRegistry.test.ts fails when an entry claims VERIFIED without a route or is BLOCKED without a dependency. scripts/discover-smoke.mjs drives search, filters, favourites persistence across a reload, badge accuracy against the registry, the Live Studio and model-manager links, and Arabic RTL.",
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
    summary:
      "Real display capture plus a full editor: crop, arrows, shapes, highlight, text, blur/pixelate, undo/redo, compare, library save and verified PNG export; fresh captures open directly in the editor.",
    requirements: ["Screen capture permission"],
    evidence:
      "scripts/screenshot-editor-smoke.mjs captures a real frame from the display stream and drives the editor (16 checks): crop geometry, pixel-changing annotations and blur, undo, compare, the stored PNG and the exported bytes.",
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
    state: "VERIFIED",
    summary:
      "Five real templates presented as a visual gallery with rendered thumbnails, editable text, frame export and WebM video export; the 51 placeholders stay behind a clearly labelled development catalog.",
    requirements: ["Canvas 2D renderer", "MediaRecorder WebM encoder"],
    evidence:
      "services/realTemplateEngine.ts evaluates element lifetimes and keyframes per frame. scripts/templates-smoke.mjs verifies the gallery thumbnails (480×270 PNG data), customization→pixels, PNG/WebM exports, cancellation and RTL (27 checks).",
  },
  toolbox: {
    id: "toolbox",
    group: "create",
    labelKey: "toolbox",
    state: "VERIFIED",
    summary:
      "Eleven local media utilities with real processors: resize, filters, format conversion, rotate/flip, crop, pixelate, video thumbnail, waveform, text image, QR code and colour palette.",
    requirements: [
      "Canvas 2D encoder",
      "Web Audio decoder for the visualiser",
      "Video decoder for the thumbnail",
    ],
    evidence:
      "scripts/toolbox-smoke.mjs drives all eleven tools through the UI (127/127 checks): real fixtures, invalid-input rejection, preview/saved/export SHA-256 equality, signatures, cancellation, reload persistence and Arabic RTL.",
  },
  "visual-patch": {
    id: "visual-patch",
    group: "create",
    labelKey: "visualPatch",
    state: "PARTIAL",
    summary:
      "Region based image editor with the fifty preserved tools and their real canvas processors: paint a region, apply the tool, compare, undo and export.",
    requirements: ["An image to edit"],
    evidence:
      "scripts/visual-patch-smoke.mjs now verifies the full pipeline (21/21): paint, apply, pixel change, undo/redo, before/after repaint, reset, PNG export and the library blob signature. Individual algorithms beyond the driven tool family are not each proven.",
  },
  morphcore: {
    id: "morphcore",
    group: "create",
    labelKey: "morphCore",
    state: "PARTIAL",
    summary:
      "Local geometry studio with real resampling: independent stretch, free rotation with flips, pinch/bulge, trapezoid perspective and a sine warp, with history, compare and export. Body-aware operations remain blocked behind missing segmentation weights and a native engine.",
    requirements: ["An image to transform"],
    evidence:
      "scripts/morphcore-smoke.mjs drives the studio in Chromium (51/51): the 18+ gate refuses a child year and stays session-scoped, stretch lands on the predicted box and source coordinates, pinch resamples only inside the declared radius, perspective leaves fully transparent wedges, rotate fills the rotated bounding box and flips mirror real pixels, warp shifts rows by different amounts, undo/redo restore snapshots pixel-for-pixel, the saved IndexedDB blob re-opens identical, and the exported PNG decodes to the same bytes. The legacy body-aware catalog is listed separately as blocked with no run control.",
    adult: true,
  },
  elysian: {
    id: "elysian",
    group: "create",
    labelKey: "elysian",
    state: "PARTIAL",
    summary:
      "Full creative image studio on a non-destructive layer stack: crop, resize, rotate, flip, exposure, brightness, contrast, gamma, vignette, saturation, temperature, blur, sharpen, pixelate, borders, text and tiled watermarks, plus eight presets built from the same operations. The effect browser renders its thumbnails by running those operations on the working image.",
    requirements: ["Image input", "Model weights for the AI pipeline"],
    evidence:
      "src/services/imageOps.ts is a pure RGBA pipeline covered by 29 numeric unit tests (exact crop rectangles, bilinear mapping, radius-limited blur, unsharp overshoot, grey-channel presets). scripts/elysian-studio-smoke.mjs drives the workspace in Chromium (51/51): age gate, unique per-card thumbnails, stacked and reordered layers, history replay, pixel-identical undo/redo, drag crop, rotate, text and watermark rendering, split compare, IndexedDB save with an identical re-open, PNG and half-scale JPEG exports decoded independently, and Arabic RTL. The neural services stay listed as blocked with no preview.",
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
    state: "PARTIAL",
    summary:
      "One unified catalog of 38 on-device tasks. 15 run now on deterministic local engines (DSP, canvas, container analysis); the other 23 stay blocked until their weight binaries exist.",
    requirements: ["Weight binaries for the 23 model tasks", "Inference runtime"],
    evidence:
      "scripts/ai-tools-smoke.mjs now runs in the standard suite (79 checks): every deterministic task executes in Chromium with real fixtures, saves and downloads its bytes, rejects wrong input, cancels cleanly and leaves model tasks blocked.",
  },
  "arabic-ai": {
    id: "arabic-ai",
    group: "intelligence",
    labelKey: "arabicAI",
    state: "PARTIAL",
    summary:
      "The Arabic entry point of the same 38 canonical tasks, with Arabic titles, descriptions and features taken from the preserved panel. The 15 deterministic tasks run here too.",
    requirements: ["Weight binaries for the 23 model tasks", "Inference runtime"],
    evidence:
      "components/ArabicAIToolsPanel.tsx supplied the localized labels; four corrupted Arabic strings in that file were repaired; ai-tools-smoke runs a task on the Arabic route and asserts the RTL shell, localized runner labels and identical output bytes.",
  },
  models: {
    id: "models",
    group: "intelligence",
    labelKey: "models",
    state: "MISSING_MODEL",
    summary:
      "Model manifest inventory with explicit weight-file probes plus a local validation workflow (size against the manifest, SHA-256 of the chosen file); nothing is installed or executed.",
    requirements: ["Weight binaries"],
    evidence:
      "Only model.json graph metadata ships; no weights.bin present. The validation panel hashes a selected file in-browser and reports the size verdict without claiming installation.",
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
    summary:
      "Runtime capability matrix measured from MediaDevices, MediaRecorder, IndexedDB, the Electron bridge and the bundled model folders.",
    requirements: [],
    evidence:
      "Values are computed in-browser; the packaged smoke asserts the live desktop bridge row and the real 0/24 weight inventory from inside Electron.",
  },
  "live-studio": {
    id: "live-studio",
    group: "create",
    labelKey: "liveStudio",
    state: "VERIFIED",
    summary:
      "Shared execution workspace for every real job: media tools, template WebM exports and recordings, with live lifecycle events, media previews, verification and save/export.",
    requirements: ["Real jobs from the tool registry, template encoder or recorder"],
    evidence:
      "scripts/live-studio-smoke.mjs ran 30 checks through the workspace: image job with live timeline and verified dock, save/reopen, real retry, before/after slider, audio playback plus waveform, template WebM preview, a fake-display recording, cancellation and Arabic RTL.",
  },
};

export const ROUTE_TITLES: Record<RouteId, string> = {
  dashboard: "dashboard",
  discover: "discover",
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
  "live-studio": "liveStudio",
};
