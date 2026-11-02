# KNOUX REC — Independent Production-Evidence Correction

**Audit:** 27 October 2026 · **Reviewed base:** `a0a39299631497f8055314d1ce919b53b357c376` · **Scope:** release evidence, visual test harness, model import language.  
**Disposition:** **NOT PRODUCTION VERIFIED.** This record supersedes contradictory "all gates PASS" conclusions in historical agent delivery files. It does **not** delete those historical records.

## Confirmed facts

| Claim / area | Independent evidence | Current disposition |
|---|---|---|
| Git source merge | Local `HEAD` = `origin/main` = GitHub `a0a3929`; clean worktree; one KNOUX REC worktree; one preserved stash | **VERIFIED** Git integration only |
| GitHub CI at audited SHA | [Run 40548597732](https://github.com/daynightae-cmyk/Knouxrec/actions/runs/40548597732): TypeScript/lint/i18n/unit/build job **success**; packaged desktop job **success** | **VERIFIED** specified CI steps, not complete product quality |
| Windows installer signing | `Get-AuthenticodeSignature` for `release/KNOUX-REC-Setup-1.0.0-x64.exe` and `release/win-unpacked/KNOUX REC.exe` returned **NotSigned** / **no signer** | **BLOCKED** trusted signed release |
| Historical visual matrix | 240 PNGs exist (67,040,912 bytes) and a manifest exists; opened sampled `dashboard/dark-ltr-100.png`, `dashboard/dark-rtl-100.png`, `studio/dark-ltr-100.png` and `models/light-ltr-100.png` — all visibly capture a **Splash overlay**, not the intended clean route | **FAILED** visual evidence gate |
| Root cause in previous harness | `scripts/visual-matrix.mjs` awaited `.kx-app` but not disappearance of `.kx-splash`; used pathname rather than the app's hash route; toggled a CSS class without persisting SettingsContext theme/language; only 1600x1000 viewport | **CONFIRMED** faulty evidence methodology |
| Corrected targeted screenshot | A standalone local probe loaded `#/models` at 1024×700, persisted `theme=light, language=ar`, waited until splash was absent, and measured zero root/main horizontal overflow. Corrected collector's filtered case passed (1/1), image written outside the old matrix. | **VERIFIED for that one case only**; no all-route approval |
| Old references in task crosswalk | `model-import-truth.json`, `arabic-ai-tools.json`, `trim-stability.json`, `packaged-routes.json`, `smoke-all-results.json`, `09-region-capture.png` were **missing at the documented paths** | **FAILED** link/evidence accuracy |
| Model import | Electron main process reads a manifest and computes a weight SHA-256 but explicitly does **not** install or activate it; matching file size is not proof of origin or functioning inference | **PARTIAL**; never toast "installed" |
| Screenshot/layout review | User reports scroll, layout hierarchy and mismatch with approved reference designs; historical PNG generation contained no image-to-reference visual comparison | **NOT VERIFIED** design fidelity |
| Version and release | Package version 1.0.0; no tags at inspection; no published public release verified | **NOT RELEASED** |

## Corrections and safe new acceptance gates

1. **Do not equate PNG count with screenshot validity.** Capture only after `.kx-splash` disappears. Navigate by `#/route`. Set actual app preferences *before React initializes*. Record each case's requested and observed theme, direction, DPR, content and overflow.
2. **Do not equate layout metrics with design review.** New manifest explicitly says `visualReferenceReview: "NOT_REVIEWED"`. Require independent screenshot comparison against the approved KNOUX REC references and human acceptance for all major routes. Organization Studio from **another product** is not interchangeable with KNOUX REC references.
3. **Viewport gate:** verify both 1600×1000 and 1024×700; report root vertical/horizontal overflow and content overflow. Any failure marks automated gate failed.
4. **Signing gate:** a built NSIS file is not a signed NSIS file. Require `Get-AuthenticodeSignature` to be `Valid` with a trusted, approved signer on the actual release candidate. Until then, flag unsigned development artifact; do not promise safe public distribution.
5. **Model gate:** distinguish manifest parsing, local file inspection, verified vendor checksum, persisted model installation, and executable inference. None imply the others.
6. **CI gate:** commit-scoped GitHub Actions success is necessary, not sufficient. Include Windows UI/permission E2E, model handling, trim stress, media export, and accepted design reference comparisons.
7. **Evidence links:** paths in crosswalk must be checked for existence and report actual SHA/case information; missing files are not PASS.
8. **Version/release:** maintain a signed artifact manifest, appropriate user-facing privacy and licensing decisions, and an approved publishing/update policy prior to public release.

## Brand identity correction

KNOUX REC's existing official README identifies **Eng. Sadek Elgazar (م. صادق الجزار)** and **KNOUX** at [knoux.store](https://knoux.store/) with **admin@knoux.store**. The unrelated identity/contact values recorded in the previous `FINAL_DELIVERY.md` are incorrect and must not be reused. The local product identity and main README remain intact.

## What this correction did not do

- Did not delete/reset any local work, worktree, stash, screenshot, old release candidate or branches.
- Did not claim to re-run all 313 unit tests or all 25 smoke suites.
- Did not rebuild/re-sign/publish a release, nor assert a new runtime verification.
- Did not approve any of the 240 historical screenshot designs.
- Did not assert that all 126 registered services passed end-to-end.

**Release decision:** **BLOCKED** pending trusted signing, corrected route captures and visual approval, full evidence provenance, privacy/licence/update policy and required functional acceptance.
