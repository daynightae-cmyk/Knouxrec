# KNOUX REC — SOVEREIGN STATUS (2026-10-24)

Accurate, evidence-based implementation matrix for the Sovereign engineering
batches. This document supersedes `PROJECT_STATUS.md` (historical, inflated).

## Repository state

| Item | Value |
| --- | --- |
| Local branch | `feat/sovereign-2026-10-24` |
| Local HEAD | `d96c887` (plus this docs commit) |
| Remote main | `3619910` — `checkpoint: preserve KNOUX REC recovery work (not release ready)` |
| Commits ahead of origin/main | 8 preserved local commits + the Sovereign commits listed below |
| Push status | **Not pushed.** §16 requires explicit user approval before any push. |
| Working tree | Clean; build artifacts (`release*`, `artifacts`) are ignored. |

Sovereign commits:

1. `712ed71` feat(creative): real template rendering and WebM export
2. `c9fd07f` test(smoke): honest template/toolbox assertions; sanitise ELECTRON_RUN_AS_NODE
3. `96179d2` feat(shell): Sovereign dashboard with real jobs registry and model readiness
4. `dc72a69` feat(studio): KNOuX Live Studio workspace (image, audio, video, recording)
5. `0c25160` feat(creative): visual patch compare/export fixes, Elysian verified save
6. `00fb914` test(ai): deterministic runtime suite promoted, Arabic RTL execution
7. `d96c887` feat(diagnostics): live desktop bridge and real model inventory

## Implementation matrix (directive statuses)

| Section | Route | Real functionality | Evidence | Status |
| --- | --- | --- | --- | --- |
| Dashboard | `dashboard` | Live recorder state, real jobs card (opens the workspace at the exact job), recent captures, recording defaults, AI readiness (0/24 weights), service cards | ui 50/50, live-studio 30/30 | VERIFIED |
| Studio (recording) | `studio` | getDisplayMedia/getUserMedia → MediaRecorder, pause/resume/stop, IndexedDB save, Live Studio job record + "Open in Live Studio" | recording 21/21, screen-capture smoke, live-studio 30/30 | VERIFIED |
| Screenshots | `screenshots` | Canvas drawImage from the display stream, PNG/JPEG/WebP, saved blob signature checked | prior smoke evidence; screen-capture smoke | VERIFIED |
| Library | `library` | IndexedDB persistence, search, favorites, preview/playback, rename, trim, export, reopen | toolbox 99/99 reload persistence, ui 50/50, unit tests | VERIFIED |
| Templates | `templates` | 5 real canvas templates, frame render, text customization reaches pixels, WebM via MediaRecorder, cancel, save/export, Live Studio job | templates 26/26 | VERIFIED |
| Toolbox | `toolbox` | 8 tools with real processors, validation, previews, save/reopen, export, cancel, RTL, Live Studio link | toolbox 99/99 | VERIFIED |
| Visual Patch | `visual-patch` | Region paint → mask, 50-tool catalog, true pixel transforms, undo/redo, reset, before/after (fixed), PNG export via CSP-safe decode → library | visual-patch 21/21 | PARTIAL (one tool family driven; not every algorithm proven) |
| MorphCore | `morphcore` | Preserved catalog with exact per-tool blockers; no simulated execution | UnavailableView evidence; ui 50/50 | BLOCKED (missing native morphology engine) |
| Elysian | `elysian` | Age gate, upload, slider filters, presets, before/after (new), verified PNG export at source resolution, library save (new); dead "Save to Gallery" wired | elysian 18/18 (packaged binary) | PARTIAL (AI inference pipeline absent) |
| Body Editor | `body-editor` | Blocked state naming missing segmentation weights; no fabricated output | UnavailableView evidence; ui 50/50 | BLOCKED (missing model weights) |
| Offline AI | `offline-ai` | 15 deterministic processors (DSP, canvas, container analysis) via one runtime; 23 model tasks stay blocked | ai-tools 79/79, ai 19/19, unit tests | PARTIAL (23 model tasks need weights) |
| Arabic AI | `arabic-ai` | Same 38-task backend and engines, Arabic catalog, RTL runner, identical output bytes | ai-tools 79/79 (Arabic section) | PARTIAL (same 23 model tasks) |
| Models | `models` | 24 manifests, weight probes, manifest SHA-256, expected tensor bytes, license/source, capabilities | dashboard + diagnostics probes, packaged smoke, ui 50/50 | PARTIAL (no dedicated integrity unit test; 0 weight files exist) |
| Settings | `settings` | Theme, language, reduce motion (OS + app level), recorder quality/fps/audio, screenshot format/quality persisted and applied | ui 50/50 (persist across reload), settings wiring review | VERIFIED |
| Diagnostics | `diagnostics` | Measured MediaDevices/MediaRecorder/IndexedDB/storage/fonts, live Electron bridge channels, real 0/24 model inventory, capability ledger | packaged smoke 59/59 asserts bridge + models rows | VERIFIED |
| Live Studio (workspace) | `live-studio` | Shared workspace for tool/template/recording jobs: real lifecycle timeline, media-adaptive previews, before/after slider, fit/fill/zoom/fullscreen, inspector, verified dock, save/export/retry/reopen, real cancellation | live-studio 30/30 | VERIFIED |

## UI modernization and service hubs (2026-10-24, post-checkpoint)

Open-source adoption (see `UI_COMPONENT_ADOPTION.md`, `THIRD_PARTY_NOTICES.md`):
Radix Tooltip, react-resizable-panels, react-compare-slider,
react-zoom-pan-pinch, wavesurfer.js and react-colorful — all MIT/BSD-3, all
bundled locally. Existing dialogs/cards/switches were kept where already
accessible; no Tailwind or router migration.

Product direction updates committed on top of the checkpoint:

- Live Studio: user-resizable preview/inspector, keyboard-accessible
  before/after slider, zoom/pan for image results, decoded interactive
  waveform for audio sources with real playback.
- Toolbox: 11 verified tools (rotate/flip, crop and pixelate added) plus
  colour parameters for waveform, text and QR; suite 128/128.
- Templates: visual gallery with genuine rendered thumbnails and category
  filters; the 51 placeholders moved into a labelled development catalog;
  suite 27/27.
- Service inventory: `COMPLETE_SERVICE_CATALOG.md` records every hub, its real
  services, modes, statuses and remaining gaps.

## Creative hubs increment (2026-10-24, second pass)

- **Screenshot Studio**: a real editor now opens from fresh captures or any
  library image — drag-crop, arrow/rectangle/ellipse/highlight/text,
  pixelate/blur regions, undo/redo, before/after, save-as-new and verified
  PNG export. Suite: screenshot-editor-smoke 16/16 with real capture bytes.
- **Templates**: thumbnails now scan four playhead samples and keep the frame
  with the highest luminance variance, so dark openings no longer represent a
  template; cards keep real thumbnails and a labelled development catalog.
- **Model Manager**: a local validation workflow hashes a selected weight file
  (SHA-256), compares its size against the manifest and states explicitly that
  nothing is installed or executed.
- **Modal shell**: dialogs now portal to document.body, fixing clipping by
  transformed route containers for every dialog in the product.

## Delivered after this section

The remaining hub work (Screenshot delayed capture/watermark/OS region picker,
MorphCore geometric suite, Elysian broadening, dashboard global search,
workflow chains, model installation pipeline) is specified in
`COMPLETE_SERVICE_CATALOG.md` and must not be reported as implemented until
each processor is verified.

## Test evidence (this checkout)

`npm run smoke:all` was executed sequentially on 2026-10-24 and exited `0`
with every suite green: ui, recording, screen, error, electron (15/15),
packaged (59/59), elysian (18/18), toolbox (99/99), ai (19/19), ai-tools
(79/79), templates (26/26), visual-patch (21/21), live-studio (30/30).

| Suite | Command | Result |
| --- | --- | --- |
| TypeScript / ESLint / i18n / unit / build | `npm run verify` | PASS — i18n 618 strings, 71/71 tests, build ok |
| UI + navigation | `npm run smoke:ui` | 50/50 |
| Toolbox | `npm run smoke:toolbox` | 99/99 |
| Templates | `npm run smoke:templates` | 26/26 |
| Visual Patch | `npm run smoke:visual-patch` | 21/21 |
| AI workspace | `npm run smoke:ai` | 19/19 |
| AI deterministic runtime | `npm run smoke:ai-tools` | 79/79 (twice consecutively) |
| Live Studio | `npm run smoke:live-studio` | 30/30 |
| Recording | `npm run smoke:recording` | 21/21 |
| Screen capture | `npm run smoke:screen` | PASS |
| Error states | `npm run smoke:error` | PASS |
| Electron runtime | `npm run smoke:electron` | 15/15 |
| Packaged binary | `npm run smoke:packaged` | 59/59 |
| Elysian (packaged) | `npm run smoke:elysian` | 18/18 |

Windows-native claims are based on the packaged Electron binary runs above,
not headless Chromium alone. Browser smokes use real Chromium + real fixtures.

## Known blockers (nothing is faked)

- **23 model-dependent AI tasks** — the repository ships `model.json`
  manifests only; every `weights.bin` is absent (0/24). The UI reports
  `MISSING_MODEL` and disables execution.
- **MorphCore** — no native morphology engine exists in the bundle; the
  preserved catalog lists per-tool blockers.
- **Body Editor** — requires segmentation weights that are not distributed.
- **Elysian AI pipeline** — image editing/export work; the neural pipeline is
  not part of the bundle.
- **Visual Patch** — the shared pipeline is proven end-to-end; individual
  algorithm families beyond the driven tool are not each independently tested.

## Product implementation batch (same day, after the Sovereign batches)

Four priorities from the NEXT PRODUCT IMPLEMENTATION BATCH directive, each
delivered with real pixels, real bytes and a targeted browser test.

| Priority | What exists now | Evidence | Status |
| --- | --- | --- | --- |
| 1 — Elysian Canvas | Non-destructive layer stack over a pure RGBA pipeline: crop (drag), resize, rotate, flip, exposure, brightness, contrast, gamma, vignette, saturation, temperature, blur, unsharp, pixelate, border, text, tiled watermark, 8 presets as editable layers, split compare, zoom/pan stage, output dock with measured bytes | 29 unit tests in `src/services/imageOps.test.ts`, 51 checks in `scripts/elysian-studio-smoke.mjs`, 26 checks in the retargeted packaged `scripts/elysian-smoke.mjs` | VERIFIED |
| 2 — MorphCore | Manual geometry studio: independent stretch, free rotation with mirrors, radial pinch/bulge, trapezoid perspective, sine warp, apply/undo/redo/reset, before-after, verified save and export; 18+ safeguard kept session-scoped; the 50 body-aware tools stay listed as blocked with no run control | 51 checks in `scripts/morphcore-smoke.mjs` | PARTIAL (geometry VERIFIED, body-aware BLOCKED) |
| 3 — Unified discovery | `src/data/serviceRegistry.ts` (121 services, 17 hubs, execution mode + honest status + destination + missing dependency) behind a searchable Discover section with hub/mode filters, favourites, recents and links to Live Studio and the model manager | 11 audit unit tests, 26 checks in `scripts/discover-smoke.mjs` | VERIFIED |
| 4 — Workflow chains | Four named chains sequencing only already-verified processors, with per-step bytes, timing, codec and frame counts, shared cancellation token, library archive and download | 30 checks in `scripts/workflow-smoke.mjs`, which feeds the WebM encoded by one chain into the next two | VERIFIED |

Defects found by these tests and fixed in the product, not in the assertions:

- MorphCore `apply()` re-rendered through a stale closure and kept the flips
  active, so the visible frame disagreed with the snapshot pushed into history.
- A MorphCore history restore could leave the previous frame on screen because
  React bails out when the shared defaults object is set again.
- The Elysian stage canvas stayed blank after split compare unmounted it.
- Panning fought the crop drag, so the stage now has explicit Crop and Pan modes.
- The motion-ident chain asked the template engine for an id that does not
  exist, and the "share box" came out 1200x667 because fill covers without
  cropping; a crop step now asserts the exact 1200x630 result.
- The visual-patch compare overlay and CSP-blocked data-URL export (earlier in
  the session) were fixed the same way.

Navigation grew from 15 to 16 routes, so `scripts/ui-smoke.mjs` now asserts 16 —
an updated contract, still an exact count. The i18n gate gained
`MorphCoreView`, `ElysianStudioView`, `WorkflowChains` and the preset registry's
`labelKey` fields, closing a hole where dynamically-built translation keys were
never checked. `src/views/ToolSection.tsx` became unreachable once every route
drew its own header; the 18+ notice it carried moved into `UnavailableView`
through the capability's `adult` flag.

## Environment notes

- Qoder tool shells inherit `ELECTRON_RUN_AS_NODE=1`; every smoke sanitises
  the environment via `scripts/lib/app-session.mjs#cleanElectronEnv`. Without
  it Electron binaries behave as plain Node and no DevTools target appears.
- electron-builder's final directory rename is intermittently blocked on this
  machine by an external file lock (EBUSY/EPERM on freshly written binaries).
  Workaround used: package with `-c.electronDist=<existing unpacked runtime>`
  into a fresh output directory, then copy `resources/app.asar` into
  `release/win-unpacked`. The packaged smoke passes against the result.
- Web smokes expect a Vite preview server on `http://localhost:4173/`
  (`npm run preview`). `smoke:ai-tools` now defaults to the same server.

## Continuation

1. `npm run verify && npm run smoke:all` reproduces every claim above.
2. Rebuild the installer with electron-builder once the file-lock issue is
   gone (a reboot usually clears it); the unpacked binary is current.
3. The next honest increment is broader Visual Patch algorithm coverage and
   dedicated model-integrity tests; weight-dependent features stay blocked
   until real files exist. Do not enable them by configuration alone.
