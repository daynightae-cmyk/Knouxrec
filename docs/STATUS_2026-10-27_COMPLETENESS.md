# KNOuX REC — completeness pass, 2026-10-27

Second batch of the day, on top of the corporate identity screen. Two things
were genuinely broken or missing; both are fixed, measured and merged.

## 1. Template cards that rendered as black voids

The gallery rendered each thumbnail at 480×270 while the canvas engine draws
elements in the template's native 1920×1080 coordinate space without rescaling.
Every element below the small box fell outside it, so *Lower third* and
*Transition* presented as empty black cards even though their preview and export
were correct.

Fixed in `src/views/TemplatesView.tsx`: each sample is rendered at the
template's own resolution, downscaled into the 480×270 thumb canvas, scored for
variance and only kept above a floor. All five cards now show their real frame,
verified in `artifacts/evidence` and by the existing `smoke:templates` (27/27).

## 2. Spectral noise reduction — a blocked service, now real

`au-noise-reduction` was blocked with "a spectral gate that is not implemented".
It is implemented now, with no model and no network: `src/services/spectralDenoise.ts`
runs a 1024-point STFT (75 % overlap, Hann, overlap-add), learns a per-bin noise
profile from the quietest 20 % of frames, subtracts it with an over-subtraction
factor and a residual floor, and preserves length, rate and channel count.

- 8 unit tests (`src/services/spectralDenoise.test.ts`): a voiced burst over
  constant noise loses more than **8 dB** of its noise floor, the 440 Hz tone
  keeps more than **75 %** of its amplitude, stronger settings remove more,
  silence stays silent, output is deterministic, short clips and absurd
  parameters are handled.
- Wired into the Audio Studio step stack with two live controls (strength,
  residual floor) and its own hint. `smoke:audio-studio` grew to **44/44**,
  including the step appearing, the length staying at 2.00 s and the waveform
  keeping its signal.
- Registry: `au-noise-reduction` is **VERIFIED** (mode LOCAL). The blocked count
  is now 10. The neural/weight-dependent services are untouched and still
  blocked: `el-retouch`, `el-upscale`, `el-generative`, `mc-body`,
  `body-segment`, `ai-transcribe`, `ai-ocr`, `ar-model`, `models-download`,
  `tpl-dev-catalog`, `au-mp3`.

## Gates

`npm run verify` — PASS (21 test files, 1316 i18n strings, lint 0 warnings,
build). `smoke:templates` 27/27, `smoke:audio-studio` 44/44, `smoke:ui` 58/58.

## 3. Real resampling upscale and spot heal (same day, later)

- **Upscale** — `resamplePixels` (Lanczos-3, Catmull-Rom on request), separable,
  with a kernel that widens when reducing and premultiplied alpha. Seven unit
  tests; a one-click `Upscale 2x` card plus a filter selector on the resize
  card. Neural super resolution stays blocked on its weight file.
- **Spot heal** — `healPixels` solves Laplace over the disc with alternating
  Gauss-Seidel sweeps from the surrounding pixels. Five unit tests (blemish
  within 12 levels of a clean gradient, outside byte-identical, alpha kept,
  full-frame no-op, op dispatch). The inspector says plainly that heavy texture
  softens, so it is a spot heal and not a content-aware fill.
- **Licence gateway** — `src/services/licensing.ts` with a Settings card. It
  checks shape and a five-character checksum and stores the result; it never
  claims activation, because no activation server exists in this build.
  Eleven unit tests.
- **MP3 — attempted and reverted.** `lamejs` was installed to unblock `au-mp3`;
  its module entry throws `MPEGMode is not defined` and its browser bundle does
  not export an encoder outside a global. Rather than ship a fragile global
  shim, the dependency was removed and MP3 stays blocked with that reason.
- **Model inventory — checked, not a defect.** After a full load the screen
  reports 24 manifests, 0 weight files, 3.6 GB expected and 0 B installed; the
  earlier empty-looking capture was taken mid-probe.

Totals after this pass: 108 VERIFIED, 5 PARTIAL, 3 NOT-IMPLEMENTED,
10 BLOCKED. `npm run verify` green with 282 unit tests.
