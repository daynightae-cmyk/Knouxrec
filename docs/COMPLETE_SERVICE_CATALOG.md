# KNOuX REC — complete service catalog

Date: 2026-10-25 · Branch `feat/services-2026-10-25` · Baseline `1f8ca2d`

This is the product inventory behind every hub. It records what genuinely
exists, what is a real processor away, and what needs weights, native engines
or an approved online provider. Execution modes: **LOCAL**, **MODEL-LOCAL**,
**HYBRID**, **ONLINE**, **UNAVAILABLE**. Status: VERIFIED / PARTIAL /
IMPLEMENTED-NOT-VERIFIED / BLOCKED / NOT-IMPLEMENTED / UNKNOWN.

## Cross-hub registries already in place

| Registry | File | What it drives |
| --- | --- | --- |
| Route capabilities | `src/app/capabilities.ts` | 18 routes, honest state, evidence strings, sidebar indicators |
| Media tools | `src/services/mediaTools.ts` + `mediaJobs.ts` | Real local processors with validation, cancellation, verification |
| AI catalog | `src/data/aiCatalog.ts` | 38 canonical tasks (15 deterministic, 23 model-gated) |
| Models | `src/services/modelRegistry.ts` | 24 manifests, weight probes, SHA-256, expected tensor bytes |
| Templates | `services/realTemplateEngine.ts` | 5 real canvas renderers + 51 development placeholders |
| Jobs | `src/state/JobsContext.tsx` | Live Studio records for tools, template exports, recordings |
| Service registry | `src/data/serviceRegistry.ts` | 123 entries across 18 hubs with execution mode, honest status, destination route and missing dependency; drives the Discover section and is audited by `serviceRegistry.test.ts` |
| Workflow chains | `src/services/workflowChains.ts` | Four named chains that sequence the existing processors; no chain owns pixel or encoder math of its own |

## HUB 01 — Dashboard / Command Center

| Service | Mode | Status | Notes |
| --- | --- | --- | --- |
| Start screen recording | LOCAL | VERIFIED | Studio + hotkeys + TopBar |
| Start window/camera recording | LOCAL | VERIFIED | Real pickers; camera via getUserMedia |
| Capture screenshot | LOCAL | VERIFIED | Canvas capture, PNG/JPEG/WebP |
| Audio recording | LOCAL | PARTIAL | Microphone path exists inside recordings; standalone audio recorder is NOT-IMPLEMENTED |
| Recent media, storage, jobs, model readiness | LOCAL | VERIFIED | Real IndexedDB/registry data |
| Global search | LOCAL | VERIFIED — the Discover section searches the canonical registry (123 entries) by English label, Arabic label, hub, mode and blocker |
| One-click workflows | LOCAL | VERIFIED — four chains on the Dashboard, 30 checks in `scripts/workflow-smoke.mjs` |

## HUB 02 — Recording Studio

| Service | Mode | Status | Notes |
| --- | --- | --- | --- |
| Full display / window / tab recording | LOCAL | VERIFIED | getDisplayMedia picker, MediaRecorder, pause/resume/stop |
| Webcam recording + overlay | LOCAL | VERIFIED | getUserMedia + overlay compositing |
| System audio | LOCAL | PARTIAL | Captured when the platform offers a system-audio track |
| Microphone-only recording | LOCAL | NOT-IMPLEMENTED | Reuses the recording engine once an audio sink is added |
| Scheduled / delayed start | LOCAL | NOT-IMPLEMENTED | Timer + same session engine |
| Resolution/fps presets | LOCAL | VERIFIED | Persisted settings reach the session |
| Trim after capture | LOCAL | VERIFIED | `trimMedia` re-encode + new library item |

## HUB 03 — Screenshot Studio

| Service | Mode | Status | Notes |
| --- | --- | --- | --- |
| Capture display | LOCAL | VERIFIED | Real pixels from the display stream |
| In-editor crop (region) | LOCAL | VERIFIED | Drag-rectangle crop on the captured canvas (16-check smoke) |
| Annotations: arrow, rectangle, ellipse, highlight, text | LOCAL | VERIFIED | Real canvas drawing with colour/stroke controls |
| Sensitive-region pixelate / blur | LOCAL | VERIFIED | Real mosaic and canvas-filter blur on the selected region |
| Undo / redo history | LOCAL | VERIFIED | Compressed snapshots (bounded), restored pixel-exact |
| Before/after comparison | LOCAL | VERIFIED | Toggle renders the untouched capture over the edited canvas |
| Save as new image + export PNG | LOCAL | VERIFIED | Library blob + downloaded bytes decode at the edited size |
| Fresh capture opens the editor | LOCAL | VERIFIED | Auto-open once the library row exists |
| Window / region capture at OS level | LOCAL | PARTIAL | Full display capture + editor crop; OS region picker NOT-IMPLEMENTED |
| Delayed capture with a live countdown and cancel | LOCAL | VERIFIED — the capture fires only when the count reaches zero |
| Watermark | LOCAL | NOT-IMPLEMENTED | Text tool covers ad-hoc labels; no dedicated watermark preset |

## HUB 04 — Media Library

| Service | Mode | Status | Notes |
| --- | --- | --- | --- |
| IndexedDB persistence, preview, playback | LOCAL | VERIFIED | Blobs read back, never placeholders |
| Search, filters, sort, favorites | LOCAL | VERIFIED | ui smoke |
| Rename, delete with confirmation, export | LOCAL | VERIFIED | Modal + real file write |
| Trim | LOCAL | VERIFIED | Re-encoded clip saved separately |
| Collections, duplicate, batch export | LOCAL | NOT-IMPLEMENTED | Registry-ready |
| Open in editor/toolbox | LOCAL | PARTIAL | Visual Patch can consume library items; explicit cross-links NOT-IMPLEMENTED |

## HUB 05 — Templates / Creative Motion Library

| Service | Mode | Status | Notes |
| --- | --- | --- | --- |
| 5 real renderers (intro, outro, lower third, transition, overlay) | LOCAL | VERIFIED | Frame render, customization→pixels, PNG, WebM |
| Real video export | LOCAL | VERIFIED | Canvas captureStream + MediaRecorder, EBML verified |
| Visual gallery with real thumbnails | LOCAL | PARTIAL | Delivered in this iteration (cards render real frames) |
| 51 placeholder entries | UNAVAILABLE | LABELLED | Stay in a separate development section; never presented as ready |
| Additional template families (social, story, title packs) | LOCAL | NOT-IMPLEMENTED | Same engine can host them over time |

## HUB 06 — Toolbox / Multimedia Utilities

Verified at baseline: resize, filters, convert, video thumbnail, waveform,
text image, QR, palette (99 checks).

| New local utilities (this iteration) | Mode | Status |
| --- | --- | --- |
| Image rotate/flip | LOCAL | Implemented + smoke-verified |
| Image crop | LOCAL | Implemented + smoke-verified |
| Image pixelate | LOCAL | Implemented + smoke-verified |
| Colour parameters (waveform / text / QR modules + background) | LOCAL | Implemented + smoke-verified (a QR colour change alters the encoded pixels) |

Toolbox now exposes 13 tools and the suite covers 148 checks.

| New local utilities (this milestone) | Mode | Status |
| --- | --- | --- |
| Image compressor: chosen lossy format, quality and long-edge limit, with the saving measured against the source bytes | LOCAL | VERIFIED |
| Video frame sheet: evenly spaced seeks composed into a labelled contact sheet, including clips whose container reports no duration until scanned | LOCAL | VERIFIED |

Still open in this hub (real, no model): sharpen and watermark presets, video
trim/mute/extract-audio, HEX/RGB/HSL utilities, gradient creator and filename
cleaning. Batch resize/convert/crop/watermark and audio trim/reverse/normalise/
filters are now wired to their own hubs (Batch Processing and Audio Studio) and
recorded as verified there, not duplicated here. Audio trim/reverse/normalise/filters live in Audio Studio, and batch
resize/convert/crop/watermark live in Batch Processing; both are verified there.

## HUB 07 — Visual Patch Lab

| Service | Mode | Status |
| --- | --- | --- |
| Open image, paint region, apply 50 catalog tools, undo/redo, reset | LOCAL | VERIFIED (21 checks; one tool family driven) |
| Before/after, CSP-safe PNG export → library | LOCAL | VERIFIED (fixed this session) |
| Zoom/pan, rectangle/freehand selection, mask editing, local color/exposure | LOCAL | PARTIAL / NOT-IMPLEMENTED |
| Per-algorithm family coverage | LOCAL | PARTIAL — needs dedicated tests |

## HUB 08 — MorphCore

| Service | Mode | Status |
| --- | --- | --- |
| Geometry studio: open image, live preview, apply, undo/redo, reset, compare, save, export | LOCAL | VERIFIED (67 checks in `scripts/morphcore-smoke.mjs`) |
| Independent horizontal/vertical stretch with predicted source-coordinate mapping | LOCAL | VERIFIED |
| Free rotation to any angle with horizontal/vertical mirror | LOCAL | VERIFIED |
| Pinch / bulge with radius and centre control | LOCAL | VERIFIED (only pixels inside the declared radius change) |
| Trapezoid perspective (independent top/bottom width) | LOCAL | VERIFIED (transparent wedges measured) |
| Sine wave warp (amplitude, frequency) | LOCAL | VERIFIED (per-row displacement differs) |
| 18+ age gate kept from the legacy route, session-scoped, nothing stored permanently | LOCAL | VERIFIED |
| Preserved body-aware catalog (50 tools) shown separately with no run control | UNAVAILABLE | BLOCKED (no native morphology engine, no segmentation weights) |
| Body-aware deformation, masking driven by anatomy | MODEL-LOCAL | BLOCKED (segmentation weights absent) |
| Mesh warp with draggable control points (lattice 2×2 to 6×6, keyboard nudge, density change keeps the border pull, flatten restores the source bytes) | LOCAL | VERIFIED — `src/services/geometryOps.ts` inverts a bilinear displacement field over raw RGBA bytes; 11 unit tests plus a real pointer drag in the browser smoke. Sampling clamps at the frame, so a pull beyond the edge stretches border pixels instead of inventing detail |

## HUB 09 — Elysian Canvas

| Service | Mode | Status |
| --- | --- | --- |
| Non-destructive layer stack: add, select, reorder, remove, history replay, undo/redo, clear | LOCAL | VERIFIED (70 browser checks + 26 packaged checks) |
| Effect browser with per-card previews rendered from the working image | LOCAL | VERIFIED (unique genuine thumbnails) |
| Crop (drag selection on the canvas), resize, rotate to any angle, horizontal/vertical flip | LOCAL | VERIFIED |
| Exposure, brightness, contrast, gamma, vignette | LOCAL | VERIFIED (43 numeric unit tests on the pipeline) |
| Saturation, temperature | LOCAL | VERIFIED |
| Tone curves: monotone 256-entry transfer tables per channel, draggable and typeable control points, keyboard nudging, preset shapes, auto levels from the measured range | LOCAL | VERIFIED (curve table maths unit-tested; browser drag, type, channel, auto and no-op paths asserted) |
| Histogram of the pixels entering a layer: per-channel and Rec.601 luma bins, mean, shadow/highlight clip fractions, measured tonal range | LOCAL | VERIFIED (transparent pixels excluded; large images sampled with a bounded stride) |
| Blur, unsharp sharpen, pixelate | LOCAL | VERIFIED |
| Border, text, tiled watermark (real glyph rasterisation) | LOCAL | VERIFIED |
| Ten presets composed from the same operations, editable as layers | LOCAL | VERIFIED (Noir measured as genuinely desaturated; two presets are built from real curve layers) |
| Split compare, hold-to-peek original, zoom and pan stage | LOCAL | VERIFIED |
| Output dock: PNG/JPEG/WebP, quality, export scale, measured byte size | LOCAL | VERIFIED |
| Save to IndexedDB library with independent decode and pixel-identical reopen | LOCAL | VERIFIED |
| Neural retouch, background removal, super resolution, style transfer, auto composition, generative fill | MODEL-LOCAL / ONLINE | BLOCKED — listed with the missing artefact, no preview, no control |
| Layer masks, brush-local edits, healing | LOCAL | NOT-IMPLEMENTED — needs a paint surface and a mask channel in the pipeline |

## HUB 10 — Body Editor

| Service | Mode | Status |
| --- | --- | --- |
| Manual geometric editing | LOCAL | IMPLEMENTED in the MorphCore geometry studio, not in this hub |
| Segmentation / pose / body-aware tools | MODEL-LOCAL | BLOCKED (weights absent) |
| Age gate + privacy | LOCAL | Safeguard preserved; no processing occurs in blocked state |

## HUB 11 — Offline AI

| Service | Mode | Status |
| --- | --- | --- |
| 15 deterministic processors (audio DSP, canvas analysis, container analysis) | LOCAL | VERIFIED (79 runtime checks, promoted to `smoke:all`) |
| 23 model tasks | MODEL-LOCAL | BLOCKED (0/24 weight files) |
| Search/filters/favorites/recent/batch/readiness | LOCAL | PARTIAL — category grouping, real availability; search/favorites NOT-IMPLEMENTED |

## HUB 12 — Arabic AI

| Service | Mode | Status |
| --- | --- | --- |
| Same 38-task backend, Arabic titles/descriptions, RTL runner | LOCAL | VERIFIED for the deterministic tasks (same 79 checks; RTL asserted) |
| Arabic search, favorites, workflow guidance | LOCAL | PARTIAL |
| Arabic speech/translation | MODEL-LOCAL / ONLINE | BLOCKED (no model; no approved provider) |

## HUB 13 — Model Manager

| Service | Mode | Status |
| --- | --- | --- |
| Manifest inventory, weight probes, expected bytes, SHA-256, license/source | LOCAL | VERIFIED (displayed from real probes) |
| Validate a local weight file (size vs manifest + SHA-256) | LOCAL | VERIFIED (in-browser hashing; never claims installation) |
| Install / remove weights, health checks | LOCAL | NOT-IMPLEMENTED (rejected: no legitimate artifact pipeline yet) |
| Health checks / hardware estimates | LOCAL | NOT-IMPLEMENTED |
| Remote provider connection | ONLINE | NOT-IMPLEMENTED (requires explicit user setup) |

## HUB 14 — Settings

| Service | Mode | Status |
| --- | --- | --- |
| Theme, language, reduce motion, recorder defaults, screenshot format/quality | LOCAL | VERIFIED (persist + apply) |
| Export defaults, performance, shortcuts, provider credentials | LOCAL | PARTIAL / NOT-IMPLEMENTED |
| No fake toggles | — | Every shipped switch reaches its engine |

## HUB 15 — Diagnostics

| Service | Mode | Status |
| --- | --- | --- |
| Capability matrix, encoder support, storage, fonts, bridge channels, model inventory | LOCAL | VERIFIED (packaged smoke asserts bridge + weights rows) |
| Recent errors, test report export, library integrity | LOCAL | PARTIAL / NOT-IMPLEMENTED |
| Hardware measurements | LOCAL | Only browser-exposed facts; no invented numbers |

## HUB 16 — Service discovery

| Service | Mode | Status |
| --- | --- | --- |
| Global search over the canonical registry (English labels, Arabic labels, hubs, modes, blockers) | LOCAL | VERIFIED (26 checks in `scripts/discover-smoke.mjs`) |
| Hub filters, execution-mode filters, runnable-only filter | LOCAL | VERIFIED |
| Favourites and recents, persisted locally and restored after a reload | LOCAL | VERIFIED |
| Accurate LOCAL / MODEL-LOCAL / HYBRID / ONLINE / UNAVAILABLE badges | LOCAL | VERIFIED — `serviceRegistry.test.ts` refuses a VERIFIED claim on model-backed work and a blocked entry without a stated dependency |
| Links to the running hub, the Live Studio and the model manager | LOCAL | VERIFIED |
| Arabic RTL rendering without overflow | LOCAL | VERIFIED |

## HUB 17 — Audio Studio

| Service | Mode | Status |
| --- | --- | --- |
| Decode a file or reuse a stored clip; waveform with drag selection | LOCAL | VERIFIED |
| Real playback of the rendered result with a live playhead | LOCAL | VERIFIED |
| Trim to selection; split into segments at the playhead | LOCAL | VERIFIED |
| Silence scan, per-interval select, one-step cut | LOCAL | VERIFIED |
| Gain in dB, peak normalisation to a target dBFS, fades | LOCAL | VERIFIED |
| Reverse, mono and stereo conversion | LOCAL | VERIFIED |
| Low-pass, high-pass, band-pass via the browser's own biquad | LOCAL | VERIFIED |
| Non-destructive step stack with reorder, retune, undo, redo, clear | LOCAL | VERIFIED |
| 16-bit WAV export, always available | LOCAL | VERIFIED |
| WebM/Opus export through MediaRecorder, probed at runtime, real-time and capped | LOCAL | PARTIAL |
| MP3 / AAC encoding | UNAVAILABLE | BLOCKED — no encoder exists; the control is disabled, not faked |
| Spectral noise reduction | MODEL-LOCAL | BLOCKED — no noise model in the bundle |

## HUB 18 — Batch Processing

| Service | Mode | Status |
| --- | --- | --- |
| Bounded worker pool with per-file progress, cancellation and failure isolation | LOCAL | VERIFIED (12 pool unit tests + browser run) |
| Batch resize (fit / fill / stretch) through the verified processor | LOCAL | VERIFIED |
| Batch centred crop presets (1:1, 4:3, 3:2, 16:9) | LOCAL | VERIFIED |
| Batch format conversion to PNG / JPEG / WebP | LOCAL | VERIFIED |
| Batch watermark through the Elysian text pipeline | LOCAL | VERIFIED |
| Output verification: each result is re-decoded before the row may say done | LOCAL | VERIFIED |
| Multi-file download and save-all as new library items | LOCAL | VERIFIED |
| Originals preserved (derived names carry a `-batch` suffix) | LOCAL | VERIFIED |
| Zip archive download | LOCAL | NOT-IMPLEMENTED — no packaging library is bundled |

## Cross-hub integration

| Service | Mode | Status |
| --- | --- | --- |
| Library "Open in" sends any stored file to Elysian, Batch, MorphCore, Toolbox or Visual Patch | LOCAL | VERIFIED |
| Audio Studio is the only destination offered for an audio item | LOCAL | VERIFIED |
| Receiving hubs adopt the handed-over blob without a re-import dialog | LOCAL | VERIFIED |
| A handoff survives the 18+ gate instead of being consumed and lost | LOCAL | VERIFIED (defect found and fixed) |
| Every derived save appends its own hub to a provenance chain | LOCAL | VERIFIED (three-hop chain measured: batch → library → elysian) |
| Originals stay byte-identical after a round trip | LOCAL | VERIFIED |
| Handoff that survives a page reload | LOCAL | NOT-IMPLEMENTED by design — it would be a second copy of media the library already stores |

## Workflow chains

Four named chains now run from the Dashboard card, each step delegating to a
processor that already exists elsewhere in the product. `scripts/workflow-smoke.mjs`
drives all four in Chromium (30 checks) and feeds the WebM encoded by one chain
back into the next two, so the artefacts are proven usable, not just non-empty.

| Chain | Steps (real processors) | Status |
| --- | --- | --- |
| Social cover | `resizeImage` → `cropImage` → `filterImage` → `convertImage` | VERIFIED — lands exactly on 1200×630 and downloads as a genuine RIFF/WEBP |
| Clip cover | `extractVideoThumbnail` → `extractColorPalette` | VERIFIED — frame at 1280×720 plus six sampled swatches |
| Trim and cover | `trimMedia` → `extractVideoThumbnail` | VERIFIED — re-encoded slice with a cover read back from it |
| Motion ident | `realTemplateEngine.renderTemplate` → `exportTemplateVideo` | VERIFIED — 1280×720 still plus an EBML WebM with codec and frame count |
| Cancellation, per-step timing, library archive, download, Arabic RTL | — | VERIFIED |
| Capture → Trim → Thumbnail → Export as a single automatic chain | — | NOT-IMPLEMENTED (the display capture path still needs a user gesture; the pieces are verified separately) |
| Audio analyse → silence removal → normalise | — | NOT-IMPLEMENTED (no verified audio DSP chain yet) |

## Real-time media capture: what was measured and what was fixed

Template WebM export and `trimMedia` both record by playing media into a
`MediaRecorder` in real time. Three failure modes were found by measurement, not
assumption, and two of them are fixed in the product.

**Trim produced empty files.** A `captureStream()` taken from a detached media
element sometimes delivers nothing to the encoder: playback reports `playing` and
then `ended` while the recorder receives one zero-byte chunk, twice in a row from
a valid source. Video is now bridged through a canvas that is drawn every frame,
which does not depend on the element having a compositor surface. The manual
`captureStream(0)` + `requestFrame()` variant was also measured and rejected: it
issued thirty-six explicit frame requests and the recorder still received
nothing, so the canvas is captured at a fixed 30 fps instead. The produced file's
real duration is measured and a capture that starts before the first painted
frame — the source of sub-second clips — is retried rather than relabelled.
Eight consecutive chain runs and the recording suite are clean after the change.

**Trim ran to the end of the file.** The slice used to play through to `ended`
and then have its container duration rewritten to the requested range. Playback
now pauses at the range end, so the file contains the slice it claims.

**Template export length follows the compositor (accepted).** A fixed capture
rate means the encoded length is the frames Chromium presents divided by that
rate, so a machine that cannot sustain the requested frame rate produces a
shorter clip. The service measures the produced file and returns `duration`,
`requestedDuration` and `durationMeasured`, so the shortfall is reported instead
of hidden; a container without metadata is not treated as a failure.

No assertion was relaxed for any of these.

## Definition of done for the next increments

1. Every advertised service has a real processor and a test that reads its bytes.
2. Hub pages present services as identity-rich cards with real previews.
3. Unavailable services stay separated and explain the exact dependency.
4. No new online provider ships without explicit consent, credential storage
   and a verified API contract.
