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
  | "audio-studio"
  | "batch"
  | "elysian"
  | "body-editor"
  | "offline-ai"
  | "arabic-ai"
  | "models"
  | "settings"
  | "diagnostics"
  | "about"
  | "live-studio";

export interface Capability {
  id: RouteId;
  group: "capture" | "library" | "create" | "intelligence" | "system";
  labelKey: string;
  state: CapabilityState;
  summaryKey: string;
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
    routes: [
      "templates",
      "toolbox",
      "audio-studio",
      "batch",
      "visual-patch",
      "morphcore",
      "elysian",
      "body-editor",
    ],
  },
  { id: "intelligence", labelKey: "groupIntelligence", routes: ["offline-ai", "arabic-ai", "models"] },
  {
    id: "system",
    labelKey: "groupSystem",
    routes: ["settings", "diagnostics", "about"],
  },
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
    summaryKey: "cap.summary.dashboard",
    requirements: [],
    evidence: "Rendered shell; navigation and recorder state wired to a single provider.",
  },
  discover: {
    id: "discover",
    group: "capture",
    labelKey: "discover",
    state: "VERIFIED",
    summaryKey: "cap.summary.discover",
    requirements: [],
    evidence:
      "src/data/serviceRegistry.ts is the single source and src/data/serviceRegistry.test.ts fails when an entry claims VERIFIED without a route or is BLOCKED without a dependency. scripts/discover-smoke.mjs drives search, filters, favourites persistence across a reload, badge accuracy against the registry, the Live Studio and model-manager links, and Arabic RTL.",
  },
  studio: {
    id: "studio",
    group: "capture",
    labelKey: "studio",
    state: "VERIFIED",
    summaryKey: "cap.summary.studio",
    requirements: ["Screen capture permission", "MediaRecorder support"],
    evidence:
      "RecordingSession branches on the capture mode: the display path composes screen, microphone and webcam tracks, the window path passes the OS window picker, the region path cuts the chosen rectangle out of every frame with RegionCompositor so the encoded file holds only those pixels, and the audio path opens the microphone alone and encodes the container the runtime actually reports (probed with isTypeSupported, never assumed). scripts/region-recording-smoke.mjs drives the real pipeline in Chromium with a fake capture device (27/27) and answers the question a screenshot cannot: a full-screen take decodes at 1920×1080, while a rectangle chosen at 461,303 for 1536×864 produces a WebM (magic 1a 45 df a3) that decodes at exactly 1536×864 with a measured 2.89 s duration, so the region file is provably not the whole desktop. The same harness proves drag-to-create, the live readout, Escape cancelling without recording, pause holding the elapsed clock, resume returning to recording, and every take stored with real bytes. scripts/recording-smoke.mjs (21/21) covers dimensions, container, live-preview screenshot, decoded playback, trim, favourites, reload persistence and export. scripts/audio-recording-smoke.mjs drives the microphone session and its meter, and scripts/hotkeys-smoke.mjs (17/17) proves a rebound shortcut starts and stops a real take. src/services/regionRecording.test.ts pins the rectangle guards that refuse empty, inverted, sliver and non-finite selections before the encoder opens.",
  },
  screenshots: {
    id: "screenshots",
    group: "capture",
    labelKey: "screenshots",
    state: "PARTIAL",
    summaryKey: "cap.summary.screenshots",
    requirements: ["Screen capture permission"],
    evidence:
      "scripts/screenshot-editor-smoke.mjs captures a real frame from the display stream and drives the editor (18/18): the delay counts down before any pixel is taken and cancelling takes nothing, the editor decodes the captured pixels, the overlay tracks the canvas geometry, crop lands on the dragged rectangle in real pixels, arrow/text/blur each change real pixels, undo restores the pre-blur bytes, before/after shows the untouched capture, the edit saves as a real PNG library item, export writes PNG bytes that decode at the edited dimensions, and the editor closes back to the hub.",
  },
  library: {
    id: "library",
    group: "library",
    labelKey: "library",
    state: "VERIFIED",
    summaryKey: "cap.summary.library",
    requirements: ["IndexedDB"],
    evidence:
      "Items survive reload and object URLs are created from stored blobs, never placeholders. scripts/recording-smoke.mjs proves the round trip end to end (21/21): a capture appears in the library, decodes in the browser, trims into a new persisted clip, survives a full page reload with its favourite flag, and exports a real media file signature. scripts/handoff-smoke.mjs drives the open-in control across hubs (31/31) including the Arabic build. The quota card reads navigator.storage.estimate() for this origin and says so, rather than inventing a disk size.",
  },
  templates: {
    id: "templates",
    group: "create",
    labelKey: "templates",
    state: "VERIFIED",
    summaryKey: "cap.summary.templates",
    requirements: ["Canvas 2D renderer", "MediaRecorder WebM encoder"],
    evidence:
      "services/realTemplateEngine.ts evaluates element lifetimes and keyframes per frame. scripts/templates-smoke.mjs verifies the gallery thumbnails (480×270 PNG data), customization→pixels, PNG/WebM exports, cancellation and RTL (27 checks).",
  },
  toolbox: {
    id: "toolbox",
    group: "create",
    labelKey: "toolbox",
    state: "VERIFIED",
    summaryKey: "cap.summary.toolbox",
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
    summaryKey: "cap.summary.visual-patch",
    requirements: ["An image to edit"],
    evidence:
      "src/services/maskOps.ts holds the selection geometry as pure functions (rectangle normalisation, polygon hit testing, segment distance, grow/shrink about a centroid) with 10 unit tests. scripts/visual-patch-smoke.mjs verifies the full pipeline (28/28): the painted mask is visible on the overlay, freehand/rectangle/erase all exist, a dragged rectangle becomes a rectangular region, growing changes the measured extent, erase removes the region under the pointer, clearing empties list and overlay, then paint, apply, pixel change, undo/redo, before/after repaint, reset, PNG export and the library blob signature. Individual algorithms beyond the driven tool family are not each proven.",
  },
  morphcore: {
    id: "morphcore",
    group: "create",
    labelKey: "morphCore",
    state: "PARTIAL",
    summaryKey: "cap.summary.morphcore",
    requirements: ["An image to transform"],
    evidence:
      "src/services/geometryOps.ts holds the mesh as pure functions over RGBA bytes, covered by 11 unit tests (a flat lattice is byte-identical, a pulled vertex moves content with it and leaves a far column untouched, displacement stays local, border pulls survive a density change, alpha follows its pixels). scripts/morphcore-smoke.mjs drives the studio in Chromium (67/67): the 18+ gate refuses a child year and stays session-scoped, stretch lands on the predicted box and source coordinates, pinch resamples only inside the declared radius, perspective leaves fully transparent wedges, rotate fills the rotated bounding box and flips mirror real pixels, warp shifts rows by different amounts, the mesh lattice drags under a real pointer and under arrow keys, flattening restores the exact source bytes and Apply bakes the warp, undo/redo restore snapshots pixel-for-pixel, the saved IndexedDB blob re-opens identical, and the exported PNG decodes to the same bytes. The legacy body-aware catalog is listed separately as blocked with no run control.",
    adult: true,
  },
  "audio-studio": {
    id: "audio-studio",
    group: "create",
    labelKey: "audioStudio",
    state: "PARTIAL",
    summaryKey: "cap.summary.audio-studio",
    requirements: ["An audio file, or a stored library item", "Web Audio decode support"],
    evidence:
      "src/services/audioOps.ts is pure sample math covered by 25 unit tests (exact frame counts, +6 dB doubling, peak landing on the requested dBFS, detected silence intervals and their removal, split segments adding back up, WAV header round-trip); src/services/spectralDenoise.ts adds a real STFT subtractor with 8 more unit tests, including a measured noise-floor drop above 8 dB on a voiced burst over constant noise and a preserved 440 Hz amplitude. scripts/audio-studio-smoke.mjs drives the workspace in Chromium and checks the decoded rate and duration, waveform pixels, real playback position, every operation's measured effect on samples, the filter's measured high-frequency attenuation, WebM support probing, saved library bytes and exported file magic.",
  },
  batch: {
    id: "batch",
    group: "create",
    labelKey: "batchHub",
    state: "PARTIAL",
    summaryKey: "cap.summary.batch",
    requirements: ["Two or more images"],
    evidence:
      "src/services/batchQueue.ts runs a fixed worker pool over the real mediaTools processors and records measured output bytes and dimensions per file; scripts/batch-smoke.mjs asserts concurrency never exceeds the cap, a poisoned file fails alone, cancellation stops the queue, every output decodes at the requested size, and the multi-file export writes each artefact.",
  },
  elysian: {
    id: "elysian",
    group: "create",
    labelKey: "elysian",
    state: "PARTIAL",
    summaryKey: "cap.summary.elysian",
    requirements: ["Image input", "Model weights for the AI pipeline"],
    evidence:
      "src/services/imageOps.ts is a pure RGBA pipeline covered by 43 numeric unit tests (exact crop rectangles, bilinear mapping, radius-limited blur, unsharp overshoot, grey-channel presets, monotone curve tables, measured histograms and auto-levels stretch, plus the guarantee that a composite step never writes back into the caller's base pixels). scripts/elysian-studio-smoke.mjs drives the workspace in Chromium (70/70): age gate, unique per-card thumbnails, stacked and reordered layers, history replay, pixel-identical undo/redo, drag crop, rotate, text and watermark rendering, the tone-curve workbench (dragged handle, typed level, per-channel curve, auto levels, straight line that is byte-identical to the source, keyboard nudging), split compare, IndexedDB save with an identical re-open, PNG and half-scale JPEG exports decoded independently, and Arabic RTL. The neural services stay listed as blocked with no preview.",
    adult: true,
  },
  "body-editor": {
    id: "body-editor",
    group: "create",
    labelKey: "bodyEditor",
    state: "PARTIAL",
    summaryKey: "cap.summary.body-editor",
    requirements: [
      "Age verification",
      "An image to measure",
      "Segmentation weights for the blocked tools",
    ],
    evidence:
      "src/services/proportions.ts holds the measurement maths as pure functions (span, head length, heads tall, width per head, canon placement, clamping) with 7 unit tests. scripts/proportions-smoke.mjs drives the screen in Chromium (20/20): a child year is refused, an adult declaration opens the mirror, a 400x800 photograph stages at its own size, seven guides measure 384 px and exactly four heads by default, dragging the hip guide re-measures the span, arrow keys nudge a focused guide, canon placement lands chin/shoulder/waist on whole and half heads, the on-page report carries every number, the two body-aware services are listed as blocked with no control, saving archives the source with provenance, and Arabic renders translated. Weight files for the blocked services still do not exist.",
    adult: true,
  },
  "offline-ai": {
    id: "offline-ai",
    group: "intelligence",
    labelKey: "offlineAI",
    state: "PARTIAL",
    summaryKey: "cap.summary.offline-ai",
    requirements: ["Weight binaries for the 23 model tasks", "Inference runtime"],
    evidence:
      "scripts/ai-tools-smoke.mjs now runs in the standard suite (79 checks): every deterministic task executes in Chromium with real fixtures, saves and downloads its bytes, rejects wrong input, cancels cleanly and leaves model tasks blocked.",
  },
  "arabic-ai": {
    id: "arabic-ai",
    group: "intelligence",
    labelKey: "arabicAI",
    state: "PARTIAL",
    summaryKey: "cap.summary.arabic-ai",
    requirements: ["Weight binaries for the 23 model tasks", "Inference runtime"],
    evidence:
      "components/ArabicAIToolsPanel.tsx supplied the localized labels; four corrupted Arabic strings in that file were repaired; ai-tools-smoke runs a task on the Arabic route and asserts the RTL shell, localized runner labels and identical output bytes.",
  },
  models: {
    id: "models",
    group: "intelligence",
    labelKey: "models",
    state: "MISSING_MODEL",
    summaryKey: "cap.summary.models",
    requirements: ["Weight binaries"],
    evidence:
      "Only model.json graph metadata ships; no weights.bin present. The validation panel hashes a selected file in-browser and reports the size verdict without claiming installation.",
  },
  settings: {
    id: "settings",
    group: "system",
    labelKey: "settings",
    state: "VERIFIED",
    summaryKey: "cap.summary.settings",
    requirements: [],
    evidence:
      "Settings persist in localStorage and are applied to the document root. src/services/hotkeys.ts canonicalises combinations, refuses a shortcut without a modifier, refuses a duplicate and repairs a hand-edited settings file (12 unit tests); the settings screen records a combination live and Escape leaves it alone; scripts/hotkeys-smoke.mjs drives the real window listener (17/17) — a rebound Ctrl+Alt+K starts and stops a microphone take and archives it, the screenshot binding still lands a file, the binding survives a reload, and the Arabic card stays translated.",
  },
  diagnostics: {
    id: "diagnostics",
    group: "system",
    labelKey: "diagnostics",
    state: "VERIFIED",
    summaryKey: "cap.summary.diagnostics",
    requirements: [],
    evidence:
      "Values are computed in-browser; the packaged smoke asserts the live desktop bridge row and the real 0/24 weight inventory from inside Electron.",
  },
  about: {
    id: "about",
    group: "system",
    labelKey: "about",
    state: "VERIFIED",
    summaryKey: "cap.summary.about",
    requirements: [],
    evidence:
      "src/data/knouxIdentity.ts is the only source of the destinations and src/services/externalLinks.ts refuses any scheme outside https/mailto/tel (18 unit tests). In Electron a mailto: or tel: click goes through the preload bridge to a main-process handler that validates the same allowlist before shell.openExternal, and a refusal is reported as a refusal with the value copied as the fallback. scripts/about-smoke.mjs drives the screen in Chromium: the bundled logo decodes at its real 800x800 size, all nine destinations match the official list exactly, copy and open actions report real outcomes, and the Arabic build renders translated in RTL.",
  },
  "live-studio": {
    id: "live-studio",
    group: "create",
    labelKey: "liveStudio",
    state: "VERIFIED",
    summaryKey: "cap.summary.live-studio",
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
  "audio-studio": "audioStudio",
  batch: "batchHub",
  elysian: "elysian",
  "body-editor": "bodyEditor",
  "offline-ai": "offlineAI",
  "arabic-ai": "arabicAI",
  models: "models",
  settings: "settings",
  diagnostics: "diagnostics",
  about: "about",
  "live-studio": "liveStudio",
};
