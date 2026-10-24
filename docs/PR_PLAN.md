# KNOuX REC — review plan for the next pull request

Date: 2026-10-24 · Branch `feat/sovereign-2026-10-24`

## Why this document exists

PR #1 was **merged**, not left as a draft. Remote `main` moved from `3619910`
to `6fd62a2` (`Merge pull request #1 from …/feat/sovereign-2026-10-24`). The
previous plan is therefore obsolete and the branch must be re-based in scope
against the real remote state, not against what was written earlier today.

## Verified Git state at the time of writing

| Item | Value |
| --- | --- |
| Local branch | `feat/sovereign-2026-10-24` |
| Local HEAD | `c5000bb` |
| `origin/main` after `git fetch --prune` | `6fd62a2` |
| Commits ahead of `origin/main` | 13 |
| Commits behind `origin/main` | 1 (the merge commit itself) |
| Working tree | only the documentation and counter changes of this plan |
| Push state | **nothing pushed in this session; no merge, no deploy, no release** |

The nine commits that existed when the milestone was issued are all still
present and unmodified; four were added on top of them. Nothing was rebased,
squashed, reordered or dropped.

```
c5000bb chore(style): restore LF line endings on the files touched this milestone
c10264c feat(integration): cross-hub handoff with provenance chains
8efa0ad feat(batch): bounded batch queue over the already-verified processors
2cd8849 feat(audio): local audio studio on real sample math
87cc8f6 docs(status): restore the file's original LF line endings
a9ec1fb docs(status): record the product implementation batch with its evidence
b6cc162 feat(workflows): four real workflow chains on the dashboard
fa1f710 feat(discover): canonical service registry with unified discovery
077ddfe feat(elysian): full creative image studio on a real pixel pipeline
e413d1d feat(morphcore): real local geometry studio with pixel-verified transforms
0d04587 feat(hubs): real Screenshot Studio editor, best-frame template thumbnails and weight validation
4963594 feat(product): complete service catalog, three new image processors and a visual template gallery
425dc23 feat(ui): adopt accessible tooltips, resizable studio panels, compare, zoom and waveforms
```

## Proposed next PR

| Field | Proposal |
| --- | --- |
| Branch | push the existing `feat/sovereign-2026-10-24` to `origin` (fast-forward; no force) |
| Base | `main` at `6fd62a2` |
| Title | `feat: KNOuX REC — creative studios, service discovery and real workflow chains` |
| State | **Draft** until review is requested explicitly |
| Merge | not performed by me; requires a decision from the director |

Before pushing, the plan requires: `git fetch` and confirmation that
`origin/main` has not moved again; a review of every file in the diff for
secrets, private media, credentials and generated binaries; and a green
`npm run verify` plus a full sequential `npm run smoke:all` whose exit code and
assertion totals are recorded from the reports, not from console lines.

## What the PR would contain

**Creative studios.** Elysian Canvas is now a full image workspace on a pure
RGBA pipeline with a non-destructive layer stack, an effect browser whose
thumbnails are produced by running those operations on the user's own image,
split compare, zoom and pan, and an output dock that measures real encoded
bytes. MorphCore is a manual geometry studio with genuine resampling. Audio
Studio is a real local audio workspace: waveform, selection, playback, trim,
split, silence detection and cutting, gain, peak normalisation, fades, reverse,
channel conversion and browser biquad filters.

**Scale and structure.** A canonical service registry of 121 entries across 17
hubs with execution mode, honest status, destination route and missing
dependency, surfaced through a searchable Discover section. Four named workflow
chains that sequence already-verified processors. A bounded batch queue with
per-file progress, failure isolation, cancellation and output verification.

**Integration.** A cross-hub handoff so a stored file opens directly in another
workspace without re-importing, with a provenance chain recorded on every
derived save and originals left byte-identical.

**What it does not deliver.** No installer build (electron-builder's final
rename is blocked by an external file lock on this machine). No model-backed
feature is enabled: neural retouch, background removal, super resolution, style
transfer, auto composition, generative fill, body-aware deformation, speech to
text, OCR and Arabic model tasks all remain blocked with the missing artefact
named. MP3 and AAC audio encoding remain unavailable and the controls say so.

## Verified result at merge time

`npm run smoke:all` completed with **exit code 0**: 21 smoke commands, 21 reports
on disk, **765 assertions and 765 passing, 0 failing**, computed by
`node scripts/count-smoke.mjs` (which exited 0 as well). Unit tests: 12 files,
148 tests. CI on the head: 4/4.

## Verification reporting rule

The headline numbers come from `node scripts/count-smoke.mjs`, which reads the
report each smoke command writes. See `docs/VERIFICATION_METHOD.md` for the
counting definition. Console `PASS` lines are a cross-check only.
