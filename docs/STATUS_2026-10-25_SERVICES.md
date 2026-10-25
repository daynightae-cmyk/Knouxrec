# KNOuX REC — services batch, 2026-10-25

Branch `feat/services-2026-10-25` · base `b515dbf` (merged PR #2) · 19 commits.
This is the record of what the batch actually delivered, what it did not, and
what was measured, written to be read next to the code rather than instead of
it.

## What shipped

| Slice | What it does | Where |
| --- | --- | --- |
| Tone curves (`el-curves`) | A real 256-entry monotone transfer table per channel, built from the points the user drags; histogram of the pixels entering the layer; auto levels measured from that histogram; straight line provably a no-op | `src/services/imageOps.ts`, `src/ui/CurveEditor.tsx` |
| Mesh warp (`mc-mesh`) | 2×2 to 6×6 draggable lattice over the canvas, bilinear displacement field inverted per destination pixel, keyboard nudge, flatten, density change that keeps border pulls | `src/services/geometryOps.ts`, `MorphCoreView` |
| Microphone-only recording (`rec-mic-only`, `cmd-audio`) | A fourth capture source and a dashboard voice memo: `getUserMedia` audio only, probed container (Opus/WebM), live dBFS meter with a 340 ms window, saved as `audio/*` | `recordingEngine.ts`, `LevelMeter.tsx`, `StudioView`, `Dashboard` |
| Scheduled start (`rec-schedule`) | 3/5/10/30-second countdown over the same session engine, visible remaining time, real cancel, page-scoped on purpose | `RecorderContext.tsx` |
| Hotkey remapping (`set-hotkeys`) | Four actions rebound by pressing the keys, canonical order, modifier required, duplicates refused with the owner named, Escape to abandon, reset, persisted | `src/services/hotkeys.ts`, `SettingsView` |
| Selection and mask (`vp-mask`) | Visible mask overlay in image coordinates, freehand/rectangle/erase, grow/shrink about the centroid, per-region list and clear | `src/services/maskOps.ts`, `VisualPatchView` |
| Proportion mirror (`body-editor`) | The placeholder screen became a manual proportion mirror: five height guides, two edge guides, spans in pixels and head lengths, canon placement as an aid, body-aware tools listed as blocked with no control | `src/services/proportions.ts`, `BodyProportionsView` |

Supporting fixes found while doing the work:

- **Pipeline purity** — a text or watermark layer composited onto the caller's
  base buffer, so a chain starting with text baked itself into the base and ran
  twice on the next render. Composite steps copy first now.
- **Export length** — template exports paced by the wall clock alone produced a
  0.98 s clip for a 2 s request under load. The loop now requires both the
  frame count and the wall clock to cover the request; the measured 1080p/2 s
  export landed at 2.21 s.
- **Capture retries** — empty capture sessions retry with a different strategy
  and carry their own evidence (frames painted, chunks, bytes, recorder state).
- **Trim flake** — see the limitation below; two capture strategies were added
  and the failure is still reproducible under sustained load.

## Honest status

`src/data/serviceRegistry.ts`: 123 services, 104 VERIFIED, 5 PARTIAL,
3 NOT-IMPLEMENTED, 11 BLOCKED.

**BLOCKED (11), all needing artefacts this build does not ship** — `au-mp3`,
`au-noise-reduction`, `el-retouch`, `el-upscale`, `el-generative`, `mc-body`,
`body-segment`, `ai-transcribe`, `ai-ocr`, `ar-model`, `models-download`.

**PARTIAL (5)** — `rec-system-audio` (the platform decides), `au-export-webm`
(real-time capped, runtime-probed), `vp-families` (one tool family driven end to
end), `ai-runtime` (the runtime executes; most catalogue entries have no
weights), `ar-tools` (deterministic utilities run; model tasks await weights).

**NOT-IMPLEMENTED (3)** — `shot-os-region` (native window enumeration),
`xh-durable` (the handoff is deliberately memory-only), `models-download` (no
silent downloads).

## Verification

`npm run verify` — green at this branch tip: type-check, lint with zero
warnings, the i18n gate over 24 views + 1 shared surface (1223 strings),
**227 unit tests**, production build.

`npm run smoke:all` — **not green as a chain.** Every suite has a green run of
its own at this code (ui 56, recording, screen, error, electron 15, packaged
59, elysian 27, toolbox, ai, ai-tools, templates, visual-patch 28, live-studio,
screenshot-editor 18, morphcore 67, elysian-studio 70, discover 26, workflows
31, audio-studio, audio-recording 35, hotkeys 17, proportions 20, batch,
handoff 31). The chained run fails intermittently on one assertion:
`smoke:recording` → "trim produces a new persisted clip".

**The trim limitation, stated plainly.** The trim re-encodes a clip through a
canvas bridge. Under sustained load the capture session sometimes receives
zero chunks even though the canvas is drawn and the recorder was started;
a second strategy (the element's own `captureStream`) failed the same way in
the last chained run. Standalone runs pass consistently (three consecutive,
plus once with four CPU burners). Until that is solved properly — an offline
frame-accurate encoder rather than a real-time capture — trimming stays a
feature that can fail on a busy machine, and it says so in its error message
instead of saving an empty file.

The packaged Windows binary was **not** rebuilt for this batch, so
`smoke:packaged` still exercises the previous bundle.

## Git state at the time of writing

- `main` and `origin/main` were at `b515dbf` when the batch started.
- 19 commits on `feat/services-2026-10-25`; nothing was pushed, merged or
  deployed from this session before the consolidation request.
- The working tree was clean apart from documentation updates committed with
  this file.
