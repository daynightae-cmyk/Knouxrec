# KNOuX REC — review plan for `feat/services-2026-10-25`

## Scope of this branch

Every service the product claims to offer that was still a gap became a real
workspace: tone curves, mesh warp, microphone-only recording, scheduled start,
hotkey remapping, mask selection and the proportion mirror — plus the capture
and pipeline fixes those surfaced. The per-slice evidence lives in
`docs/STATUS_2026-10-25_SERVICES.md`; the per-hub inventory lives in
`docs/COMPLETE_SERVICE_CATALOG.md`.

## Commits

`git log --oneline b515dbf..HEAD` — 19 commits, grouped as:

1. tooling and library work carried from the previous checkpoint
   (`35aa1b5`, `f1812c0`, `1f8ca2d`),
2. `5bed19b` tone curves, `8327c49` mesh warp,
3. `4bae5d7`/`84a3398`/`634548` capture and trim robustness,
4. `213cdaa`/`fd8bb0e` microphone recording and scheduled start,
5. `4b62215` hotkey remapping,
6. `4ab366d` mask selection,
7. `31c42cb` proportion mirror (and the removal of the dead
   `UnavailableView`),
8. `a15794f`/`b09c971`/`e759608`/`f792103` harness waits, line endings and a
   layout fix.

## What a reviewer should look at first

- `src/services/imageOps.ts` — the curves LUT and the purity fix; the composite
  steps now copy before writing.
- `src/services/geometryOps.ts` — the displacement sign convention and the
  clamp at the frame edge.
- `src/services/recordingEngine.ts` — the audio-only branch, the analyser
  window, and the two trim strategies. The trim is the one known flaky path.
- `src/services/hotkeys.ts` — `sanitiseHotkeys`, which repairs a hand-edited
  settings file rather than trusting it.
- `src/views/BodyProportionsView.tsx` — the claim this screen makes and the
  claim it refuses to make.

## Verification expected before merge

```bash
npm run verify      # green at this tip: 227 unit tests, i18n 24 views
npm run smoke:all   # see the status document: not green as a chain
```

The batch is mergeable with the trim limitation recorded. It is not presented
as production-ready: the packaged binary predates it, and the real-time capture
paths remain the least reliable part of the product.

## Not in this branch

No packaging, no installer, no weights, no online providers. The 11 BLOCKED
services stay blocked with their missing artefact named.
