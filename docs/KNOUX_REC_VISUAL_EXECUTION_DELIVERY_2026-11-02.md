# KNOUX REC — Visual Execution Delivery (2026-11-02)

Workspace: `K:\Knoux Projects\Knouxrec\workspace`
Remote: https://github.com/daynightae-cmyk/Knouxrec
Baseline HEAD at start: `a0a39299631497f8055314d1ce919b53b357c376` (main)
State: **local commits only — nothing pushed, nothing released, no deploy.**

---

## 0. Asset package — verified, not assumed

The handoff document said the ZIP had **not** been transferred to this Windows
device and instructed that it must not be claimed otherwise. It was present at
`C:\Users\day night\Downloads\KNOUX_REC_VISUAL_EXECUTION_PACK_2026-11-02\`, so
that line is now out of date and the package is genuinely on the machine.

All ten PNGs were checked against `ASSET_MANIFEST.json` before anything was
touched: **10/10 SHA-256 matches, 10/10 byte sizes match.** They were copied to
`docs/design/knoux-rec-2026-11-02/` with the manifest and the mission document
beside them, and committed. Re-hashing the **committed git blobs** returns the
same ten digests as the manifest, so nothing was altered by line-ending or
filter handling:

```
ace3795e…  01-brand-logo.png        5312b11b…  07-templates.png
5b8d76ac…  02-dashboard-shell.png   eab7a395…  08-toolbox.png
3d80c322…  03-discover-service-cards 05d767c4… 09-audio-studio.png
14106d15…  04-recorder.png          8ba97fa5…  10-batch-processing.png
b48e60f5…  05-screenshots.png
770b7156…  06-library.png
```

No existing asset was overwritten. `public/knoux-mark.svg` and
`public/brand/knoux-official.png` are untouched; the new transparent glyph was
added as a **new** file (`public/knoux-glyph.svg`).

`.gitignore` has no rule affecting `docs/`, so the references are not silently
excluded. Staging was always by explicit path — never `git add -A`.

`stash@{0}` (`On feat/services-2026-10-25: superseded README corporate
appendix`) is **intact and untouched** — never applied, dropped or cleaned.
`git worktree list` shows one worktree. No reset, no force-push, no delete.

---

## 1. Method

Each phase followed the same loop: read the real implementation and the
historical work → map every exposed control to an actual service → build the
layout as React components (no mockup image is used as an interface anywhere) →
add empty/loading/error states → run focused unit tests and a real browser
workflow → measure the produced bytes → capture a runtime screenshot from the
live app and compare it to the reference → fix what broke → commit.

Two harnesses were added because the repo lacked them:

- `scripts/visual-execution-capture.mjs` — captures routes by **hash**. The
  existing `scripts/visual-matrix.mjs` navigates by path segment
  (`/dashboard`), which the router ignores, so it had been silently photographing
  the dashboard for all twenty routes. That is why its output could not be used
  as before/after evidence.
- `scripts/capture-splash.mjs` — the splash lives about a second, so it is
  captured through the shell's own `?intro=hold` flag.

---

## 2. Phase results

### 01 — Brand, splash, shell
`BrandWordmark` (name + ruled strapline) and `BrandFrame` (corner brackets,
reticle) are reusable components; the splash now carries the approved grid,
single warm corner light and two signal traces with teal nodes. Sidebar gains
roving arrow/Home/End keyboard navigation with a single tab stop. Icon pipeline
verified: `knoux-rec-app/build/icon.ico` holds **16 / 20 / 24 / 32 / 40 / 48 /
64 / 96 / 128 / 256**, all PNG-encoded — the four sizes the mission requires are
present.

Evidence: `artifacts/visual-execution/phase01/splash/splash.png`, `shell.png`.
`smoke:ui` 58/58 including reduced-motion, 125%/150% DPI, 1024×700 minimum.

### 02 — Dashboard
Five metric cards, all measured: capture count from IndexedDB, the browser's own
`navigator.storage.estimate()` quota and usage, recorded seconds bucketed per
day, kind breakdown, and a **device-health ring produced by a new runtime probe**
(`src/services/runtimeHealth.ts`) that checks display capture, the encoder, a
real IndexedDB write, storage quota, audio and camera paths, and the weight
inventory. The reference's 1,248 / 26.4 GB / 92% are gone; an empty profile
shows 0 and the honest "measuring" states. Featured Services reads the same
`CAPABILITIES` registry as the sidebar, so a card cannot claim a state the rest
of the product does not have.

### 03 — Discover
Application-hub showcase (Elysian Canvas, MorphCore, Visual Patch) with artwork
drawn in CSS, plus Status / Capability / Type / Sort filters. The hub rail keeps
**every** hub in the DOM and collapses by height only, because removing them
from the document made the later hubs unreachable to keyboard and to the harness
— which caught it. `smoke:discover` 26/26.

### 04 — Recorder (critical gate)
`CaptureMode` gains **`region`**. `RegionCompositor`
(`src/services/regionRecording.ts`) copies only the chosen rectangle out of
every frame into a canvas sized exactly to that rectangle and encodes that
canvas stream, so the container holds the region's pixels and nothing else.
`src/ui/RegionSelector.tsx` provides drag-to-create, drag-to-move, eight resize
handles, arrow-key nudging with Shift for ×10, Escape to cancel and Enter to
confirm; the rectangle lives in a box measured to the video's own content rect,
so the preview→surface scale is a single constant with no letterbox maths.
Screen / Window / Selected area / Camera / Microphone only are all offered, plus
a source-surface picker that is documented as a **hint to the OS picker, not a
bypass of it**.

**Decisive evidence** (`scripts/region-recording-smoke.mjs`, 27/27, report at
`artifacts/visual-execution/phase04-region/region-recording-report.json`):

| Measurement | Value |
|---|---|
| Full-screen take, stored / decoded | 1920×1080 / 1920×1080 |
| Rectangle chosen (surface px) | 1536×864 at 461,303 |
| Region take decoded | **1536×864** |
| Region take ≠ full surface | proven by the row above |
| Container | magic `1a 45 df a3` (WebM/EBML), 131,410 bytes |
| Decoded duration | 2.891 s |
| Stored metadata matches region | 1536×864 |
| Pause holds the elapsed clock | asserted |
| Escape cancels without recording | asserted, recorder returns to Ready |

`src/services/regionRecording.test.ts` adds 6 unit tests refusing empty,
one-pixel, inverted and non-finite rectangles before the encoder opens.

Not claimed: no native `cropTo` path is presented, no hardware encoder is named,
and camera overlay stays gated on real compositing. Region capture is a
canvas-crop of an authorized display stream — stated plainly rather than
described as a native API.

### 05 — Screenshots Studio
Rebuilt as the reference's studio shell: capture bar (from screen / window /
region / **scrolling shown disabled and labelled BLOCKED with its reason**),
delay countdown, canvas panel with live rulers and a zoom + dimension readout,
item rail with search and a metadata tab carrying persisted tags and notes, and
a footer that copies to clipboard, saves edits and exports. Clipboard copy
re-encodes to PNG because Chromium only accepts a PNG `ClipboardItem`, and
refuses out loud when the runtime will not take the write. Tags/notes are
additive optional fields on `LibraryItem` — **no IndexedDB version bump, no
migration, existing records untouched.**

`smoke:screenshot-editor` 18/18. The section is labelled **PARTIAL**, not
VERIFIED: window-only capture, clipboard write and tag persistence are
implemented-but-not-automated and are listed that way in the registry.

### 06 — Library
Five counts from stored items; the quota card reads
`navigator.storage.estimate()` and states "Browser storage granted to this app —
not the size of your disk" instead of the reference's invented 512 GB NVMe.
Adds date / resolution / duration / size / tag facets with an active-facet
counter and one Clear all, grid/list view, Ctrl+K, and a multi-select bulk bar
(favourite, export, file, delete) with the destructive path behind a
confirmation that names the count. `smoke:handoff` 31/31, `smoke:recording`
21/21.

### 07 — Templates
Search, sort, and category counts that are **true**: the reference prints
"All Templates 51 / Intro 12 / Outro 8", which counts generated placeholders as
if they rendered. This build shows five renderable templates, one per category,
with the 51 placeholders still separated behind their own BLOCKED section. Spec
strip reads resolution, duration, frame rate and container from the template
itself.

Also fixed a **test that had been passing vacuously**: the pixel-proof step
selected `input.kx-input[0]`, which after adding the search box meant typing the
proof string into a filter field instead of a template text element — yet the
check still passed, because the intro template's animated particles make any two
renders differ. The customization inputs now carry `data-template-text` and the
harness targets it. `smoke:templates` 27/27.

### 08 — Toolbox
Category tabs with real counts (13 total: image 8, video 2, audio 1, text 1,
utility 1 — the capability blurb said "Eleven" and was stale), per-category
artwork drawn in CSS, and a Ctrl+K binding behind the badge that advertised it.
`smoke:toolbox` 148/148.

### 09 — Audio Studio
Drop zone gains a real microphone take through the recorder's own path (the
button meters elapsed time and says the clip lands in the library; the studio
does not pretend to record inline), Ctrl+O carries its binding, and the header
chips are limited to what is true. The reference's
"Multi-format (WAV/MP3/FLAC)" claim is deliberately **not** reproduced: this
build encodes 16-bit WAV always, WebM/Opus only when the runtime reports it, and
says MP3 and AAC are unavailable. The reference's Compressor, Limiter and
−16 LUFS controls are absent rather than rendered inert, because that DSP does
not exist here. `smoke:audio-studio` 44/44.

### 10 — Batch Processing
Queue counter strip and a status card with completion ring, elapsed clock,
estimated remaining and throughput — all derived from the measured run, showing
"measuring…" until a file has actually completed rather than inventing the
reference's 73% / 13.4 files/min.

**Pause is implemented, not drawn.** `runPool` now takes an `isPaused`
predicate: parked workers stop pulling the next file while anything already in
flight runs to completion, so a pause cannot abandon a half-written output;
cancelling releases the pause flag so workers exit instead of sitting in the
poll loop. Three unit tests pin that (`batchQueue` 15/15) and the browser
harness drives it on a twelve-file queue. Because the pause detour drains the
queue the cancellation test relied on, cancellation now runs on its own fresh
twelve-file queue so both measure a real interruption. `smoke:batch` 37/37.

---

## 3. Commands and outcomes

| Gate | Result |
|---|---|
| `npm run type-check` | exit 0 |
| `npm run lint` (max-warnings 0) | exit 0 |
| `npm run check:i18n` | PASSED — 1549 translated strings, 25 views + 1 shared surface |
| `npm test` | 26 files, **319 tests** passed |
| `npm run build` | exit 0 |
| `npm run verify` (all five above) | **exit 0** |
| `smoke:ui` | 58/58 |
| `smoke:discover` | 26/26 |
| `smoke:recording` | 21/21 |
| `smoke:region` (new) | 27/27 |
| `smoke:audio-recording` | 35/35 |
| `smoke:hotkeys` | 17/17 |
| `smoke:screenshot-editor` | 18/18 |
| `smoke:templates` | 27/27 |
| `smoke:toolbox` | 148/148 |
| `smoke:audio-studio` | 44/44 |
| `smoke:batch` | 37/37 |
| `smoke:handoff` | 31/31 |

Commits, in order: `b5d67b9` (01–04) → `c2b5401` (05) → `d2e67ba` (06) →
`da40ff4` (07) → `c97c969` (08) → `e63d67a` (09) → `ccc6799` (10) →
`03adef9` (splash regression fix).

---

## 4. Regressions found and fixed during the run

1. **Splash brand selector.** Moving the strapline inside `BrandWordmark` made
   `.kx-splash-name` read as "KNOUXREC" + tagline, failing `smoke:ui` on its
   first check — and because `smoke:all` chains with `&&`, that single failure
   silently prevented the other 24 suites from running at all. The tagline is a
   sibling again; `smoke:ui` back to 58/58.
2. **Hub rail.** Collapsing hub chips by removing them from the DOM made later
   hubs unreachable; the smoke caught it. Now collapsed by height only.
3. **Two stale harness assumptions** in `smoke:audio-recording` asserted exactly
   four capture modes; with region added they now assert five and also check the
   Arabic region label is translated.
4. **A vacuous test** in `smoke:templates` (described under phase 07).
5. **Class-name collision**: the new canvas wrapper was first named
   `.kx-shot-canvas`, which is the editor's own `<canvas>` class. Renamed to
   `.kx-studio-canvas`.

---

## 5. Limitations and what remains unverified

- **OS-level capture cannot be proven by automation.** Every recording number
  above comes from Chromium's `--use-fake-device-for-media-stream` and
  `--auto-select-desktop-capture-source`. That proves the pipeline, the crop
  geometry, the container and the decode — it does **not** prove real Windows
  monitor content, real multi-monitor coordinates, real DPI scaling, real
  microphone hardware or real system audio. Those need a human at the machine.
- **Region recording is a canvas crop of an authorized display stream.** It is
  correct and measured, but it is not a native `cropTo`; it costs one extra
  decode/composite stage.
- **Screenshots is PARTIAL**: window-only capture, clipboard write and tag/note
  persistence are implemented but not yet asserted end to end.
- **Audio Studio is PARTIAL** and **Batch is PARTIAL**, as before.
- **Model weights are still 0/24.** The 163 "failed requests" in `smoke:ui` are
  all `/models/*/weights.bin` existence probes — that is the mechanism by which
  the app honestly reports missing weights, and there are **zero** failures on
  any other URL. Offline AI, Arabic AI model tasks, neural retouch, super
  resolution, generative fill, segmentation and pose tools stay BLOCKED.
- **MP3 / AAC / FLAC encoding do not exist in this runtime** and are not
  offered.
- **Scrolling screenshot capture is not implemented** and is shown as blocked.
- **Templates WebM export has a real flake**: when an export starts immediately
  after a cancelled one, the frame loop can hit its wall-clock ceiling while the
  previous job still holds CPU, producing a short clip and failing three timing
  assertions. It reproduced once and cleared on re-run. It is a genuine
  robustness weakness in `templateExport.ts`, not caused by this work, and it is
  **not fixed here**.
- **Android-native was not touched.** It is out of scope for a desktop visual
  pass and was left alone as instructed.
- **Elysian Canvas, MorphCore, Visual Patch, Proportion Mirror, Offline AI,
  Arabic AI, AI Models, Settings, Diagnostics, About and Live Studio were not
  edited.** They are covered by the full smoke sweep below; shared shell and card
  changes were made additively so their own layouts are unchanged.
- **Nothing is pushed, published or released.**
