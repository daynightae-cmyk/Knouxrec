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
