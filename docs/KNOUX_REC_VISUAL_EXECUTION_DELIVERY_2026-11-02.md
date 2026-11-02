# KNOUX REC — Visual Execution Delivery (2026-11-02)

Workspace: `K:\Knoux Projects\Knouxrec\workspace`
Remote: https://github.com/daynightae-cmyk/Knouxrec
Baseline HEAD at start: `a0a39299631497f8055314d1ce919b53b357c376` (main)
State: **merged to `origin/main`. Not released, not signed, not published.**

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
| `npm run check:i18n` | PASSED — 1608 translated strings across **48 renderer files** (was 25 views + 1 shared surface; see §6.4) |
| `npm test` | 28 files, **342 tests** passed |
| `npm run build` | exit 0 |
| `npm run verify` (all five above) | **exit 0** |
| `node scripts/smoke-all.mjs` | **26/26 passed**, 726 s, exit 0 — first complete aggregate run (§6.8) |
| GitHub Actions CI on `450c142` | both jobs green: type-check/lint/unit/build, and a freshly packaged desktop binary rendering every route |
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
`03adef9` (splash regression fix) → then the review work in §6, listed at §6.9.

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
- **Templates WebM export was flaky under load; two causes fixed after this
  section was first written.** It appeared as a short clip failing three timing
  assertions when an export ran while the machine was busy. Cause one was an
  absolute wall-clock ceiling combined with a `requestAnimationFrame` loop that
  Chromium throttles — fixed in `aab9258`. Cause two was the encoder's tracks
  being released before `recorder.stop()` had flushed — fixed in `869911b`. What
  remains true is the underlying characteristic: the export depends on the page
  being compositor-priority, so on a loaded machine it takes materially longer
  (measured 14 s alone against 140 s inside a full suite run). See §6.8.
- **Android-native was not touched.** It is out of scope for a desktop visual
  pass and was left alone as instructed.
- **Elysian Canvas, MorphCore, Visual Patch, Proportion Mirror, Offline AI,
  Arabic AI, AI Models, Settings, Diagnostics, About and Live Studio were not
  edited.** They are covered by the full smoke sweep below; shared shell and card
  changes were made additively so their own layouts are unchanged.
- **Merged, not released.** The work is on `origin/main`. There is no signed
  installer, no published GitHub release and no update feed: the signing gate in
  the production-evidence correction still reads BLOCKED, and nothing here
  changes that.

---

## 6. Post-delivery review (same day)

The ten phases above were delivered first and reviewed after. This section
records what the review found, including defects in the tools that produced the
evidence in sections 2–4. It supersedes nothing: the phase text stands as
written at the time.

### 6.1 Upstream merge

`origin/main` had moved to `a0a3929` and PR #4 (the independent production
evidence corrections) had merged. Merged here as `7fdceeb` — no file overlap
with the visual work, so no resolution was needed. The correction record
`docs/PRODUCTION_EVIDENCE_CORRECTIONS_2026-10-27.md` is now part of this
branch's history and its acceptance gates are applied below.

### 6.2 Two runtime defects found by re-reading, not by a failing test

- **Template export produced 0.236 s files.** `templateExport.ts` bounded the
  frame loop with an absolute wall-clock ceiling and paced it on
  `requestAnimationFrame`. On a loaded machine rAF is throttled, so the ceiling
  fired while frames were still valid: the clip ended early and three timing
  assertions failed. Replaced with a stall budget keyed to the last frame time
  and a `setTimeout` loop (`aab9258`).
- **Audio Studio playhead lagged 0.1–0.25 s behind the clock.** It was driven by
  `timeupdate`, which Chromium fires about four times per second. Now driven per
  frame (`4344679`). The harness that "proved" this was also wrong: it compared
  a rendered label against a live clock in the same instant, which measures
  render latency rather than correctness, and it clicked Stop — zeroing both —
  before checking.

### 6.3 The screenshot harness was producing invalid evidence

Re-checking the corrected harness against the acceptance gates in the production
evidence record found that **all 19 RTL captures were silently the LTR page**:
identical byte sizes to their LTR counterparts and `document.dir` still `ltr`.
Root cause: navigating by hash alone does not create a new document, so the
boot-time preference hook never ran again. Fixed by forcing a real load
(`about:blank` then the route) — the same class of fault the October audit
called out in the previous harness.

The harness also **flagged bad captures and then exited 0**: it computed the
failing list, wrote it into the manifest, and reported success. It now exits 1
with the flagged cases named. A green signal from a red run is exactly the
failure mode that audit was written about, and this was my own code doing it.

### 6.4 Arabic build

Visual review of `dashboard-rtl-100.png` found English inside an Arabic page.
Two of the defects were mine, and neither the i18n gate nor any test could see
them:

- the gate's text pattern could not match a JSX text node containing a newline,
  so every paragraph wrapped at a readable width passed as "no text found";
- `src/views/ui.tsx` was not in the gate's file list at all. Its capability
  badges render on 19 routes, so "Missing engine" and "Not implemented" were
  shipping into the Arabic build everywhere at once.

Fixed in `2c872c7`: shared dialogs, badges and notices go through the dictionary;
the scanned set is discovered from the renderer directories (33 files → 48) with
a required-surface guard; and a dotted literal is validated wherever it appears,
which is the only way a lookup table like `STATE_KEY` is checked at all.

`src/i18n/translate.test.ts` now audits the dictionary at runtime instead of by
source regex: both locales present, Arabic script present, `{placeholders}`
intact, no untranslated Latin word. The Latin rule ships with its own positive
control — it asserts `"إعادة shaping"` **is** reported while `"وMediaRecorder"`
and `"{count}"` are not — because a clean run from a broken detector is worthless.
Writing that test surfaced two further real defects: an Arabic value glued to a
file name (`model.jsonالموجودة`) and one brand transliterated two different ways
in the same dictionary.

Not fixed, and stated plainly: `src/app/capabilities.ts` also carries `requirements[]`
and `evidence` prose per service. Those render in the capability notice on
Diagnostics and on the models/discover detail cards, and they are still English
in the Arabic build — visible in `artifacts/visual-execution/after/dark/models-rtl-100.png`
as "المتطلبات: Weight binaries". The service *summaries* are translated; the
dependency and evidence lines are not.

A sweep of the whole dictionary for characters outside Arabic and Latin found
two Arabic values shipped with **Chinese inside them** — `dashboard.featuredServicesDesc`
began with `整套 ` and `models.honestBody` read `…الأوزان也不再 التحقق…`. Neither
is noticed by the Latin-word rule (CJK is not Latin) nor by the Arabic-script
rule (the value does contain Arabic). Both are rewritten against the English
source, and `translate.test.ts` now rejects any third script in either field —
verified to catch both original strings and to pass the corrected ones.

### 6.8 Aggregate sweep versus isolated suites

Four full 26-suite runs were made. The result depends on how loaded the machine
is, and the honest report is both numbers:

| Run | Wall | Result | Cause |
|---|---|---|---|
| 1 | 698 s | 25/26 | `recording` failed; detail destroyed by piping stdout through `tail` |
| 2 | 1143 s | 22/26 | pre-flush-fix: four encoders starved |
| 3 | 952 s | 24/26 | flush fix landed; two harness timeouts remained |
| 4 | 687 s | 25/26 | only `morphcore`, on weights-probe 404 console noise |
| 5 | 1288 s | 23/26 | `audio-recording`, `recording`, `region` — heavy external load |
| 6 | 726 s | **26/26** | final run on the pushed code, all fixes in |

Run 6 is the first aggregate execution of all 26 suites with nothing skipped,
and it exits 0. The intermediate runs are kept in this table rather than
replaced by the green one, because the sequence is the evidence: each failure
named here led to a fix, and the number only moved when a fix went in.

**Every one of the 26 suites also passes when run individually**, including each
of the five that ever failed in aggregate. Failures between runs rotated and
correlated with wall time rather than with the diff: the same code produced
25/26 in 687 s and 23/26 in 1288 s. The mechanism is that a canvas- or
element-captured `MediaRecorder` session depends on the page being
compositor-priority, and a second Chromium starting while the first is tearing
down starves it.

What the sweeps genuinely fixed, rather than merely revealed: the encoder flush
ordering (§6.6) and the region suite's misattribution (§6.6). Two further
evidence defects came out of the same review — `morphcore` asserted zero console
errors while the app deliberately probes missing `weights.bin` files, so the
policy now excuses only those probes and still fails on any other missing asset;
and the capture harness's narrower second run **overwrote** the full manifest,
deleting the record of 38 captures, so manifests are now merged and the exit
code is judged against the whole record.

The app's behaviour under starvation is correct and is not a defect: it errors
with a precise diagnostic — "the recorder produced an empty file. Nothing was
saved" — and stores nothing.

### 6.9 Commits added by the review

`7fdceeb` merge of PR #4 → `aab9258` template export frame loop →
`4344679` audio playhead → `2c872c7` shared-UI translation + gate blind spots →
`294acd8` smoke runner + fail-closed harness → `869911b` recorder flush +
harness attribution → `845ba04` capability registry translation, CJK dictionary
repairs and recorder toasts → `08695dd` weights-probe console policy and capture
manifest merge → then this record. All are on `origin/main`.

### 6.5 Evidence infrastructure

`npm run smoke:all` was 25 `npm run …` calls joined by `&&`, which has two
failure modes: the first failing suite prevented every later suite from running
at all (one splash-selector regression during this mission silently hid 24
suites), and a suite missing from the chain simply vanished from the record —
`smoke:region`, the selected-area capture gate the mission names as mandatory,
was defined and never executed by the aggregate. Replaced by
`scripts/smoke-all.mjs` (`294acd8`): derives its list from package.json, runs
every suite regardless of its neighbours, writes a per-suite transcript, and
returns 1 if any failed.

### 6.6 Recorder robustness under load

A full 26-suite run surfaced a class of failure that no isolated run reproduces:
`recording`, `region`, `screen` and `templates` all reported encoders producing
**zero chunks while still painting frames**. Two findings came out of it.

A genuine ordering bug, now fixed: `trimMediaOnce` and `templateExport` stopped
the `MediaStream` tracks immediately after `recorder.stop()` and only then
awaited the blob. `stop()` is asynchronous — the last timeslices are still
arriving through `dataavailable` when `onstop` fires — so releasing the tracks
first discards them. `src/services/mediaFlush.ts` now holds the bounded wait
every encoder uses before releasing its tracks; `recordingEngine.stop()` and
`aiTasks` already had the order right, so two of the codebase's four encoders
were affected.

An evidence bug in my own suite, also fixed: `region-recording-smoke.mjs`
identified the region take with `.at(-1)` — "the newest video". When a region
take failed to store, that silently returned the earlier **full-screen** file,
and the suite reported "the selected-area file is 1920×1080, not the chosen
1536×864 rectangle". That reads as the exact accusation the mission forbids —
decorative overlay recording the whole monitor — when the truth was that no
region file existed. The suite now snapshots the library first and identifies
the take by being new, and fails explicitly when there is no new item.

Behaviour under load is a real limit of this runtime, not a fixed bug: every one
of these four suites passes on an otherwise idle machine, and the app's response
to starvation is correct — it errors with a precise diagnostic and saves
nothing. The runner now settles 2.5 s between suites, which removes the overlap
between one suite's Chromium teardown and the next one's capture.

**Packaged evidence caveat.** `smoke:packaged` and `smoke:electron` as run in
this workspace pass against `release/win-unpacked/resources/app.asar` dated
**2026-10-27** — five days before this work. Locally, they prove the old bundle
boots; they do **not** evidence the redesigned renderer. `release/` was left
untouched because the October audit cites those exact files.

GitHub Actions closes that gap for the merged code: `.github/workflows/ci.yml`
runs `npm run electron:dist` — which is `npm run build` followed by
`electron-builder` — and then `npm run smoke:packaged` against the package it
just made. Both jobs are green on `450c142`, the current `origin/main`, so the
packaged runtime of this code is verified in CI even though it is not verified
by the local run described above. What remains unverified in both places is the
same thing: real Windows display, microphone and system-audio hardware (§5).

### 6.7 A note on this session's own errors

While testing the gate's required-surface guard I ran `git checkout --` on
`scripts/check-i18n.mjs`, which destroyed the uncommitted gate work. The file
was rebuilt from scratch and each construct re-verified individually rather than
assumed. No other file was affected and nothing committed was lost. Earlier, one
aggregate run was piped through `tail -60`, which discarded the failing check
line of a recorder failure permanently — the reason the runner now writes
transcripts to `artifacts/smoke/<timestamp>/` instead of relying on stdout.
