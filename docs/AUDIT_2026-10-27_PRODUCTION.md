# KNOUX REC — production readiness audit, 2026-10-27

Baseline: `main` = `origin/main` = `71b3ab4` · clean tree · 466 commits ·
388 tracked files · one worktree · one documented stash.
This is an evidence list, not a sales page: every claim below is something that
was run, read or measured in this session, and the gaps are named with the
command that closes them.

## 1. What passed, measured now

| Gate | Result |
| --- | --- |
| `npm run verify` (type-check → lint → i18n → tests → build) | **exit 0**, build 2m 01s |
| Unit tests | **282 in 22 files** |
| i18n coverage | **1336 strings**, 25 views + 1 shared surface, no untranslated key |
| Lint | 0 errors, 0 warnings (`--max-warnings 0`) |
| `npm audit --omit=dev` | **0 vulnerabilities** |
| `smoke:ui` | 58/58 |
| `smoke:elysian-studio` | 70/70 |
| `smoke:audio-studio` | 44/44 |
| `smoke:about` | 33/33 |
| `smoke:electron` | 16/16 |
| `smoke:templates` | 27/27 |
| Chained `smoke:all` | **25 commands · 947 assertions · 946 pass · 1 fail** |
| CI (`gh run list`) | last three pushes green; the heal commit's run was *cancelled* by concurrency; the docs commit was *in progress* at audit time |

Security posture, read from the code and the built artifact:

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`,
  `webSecurity: true`, `webviewTag: false`, `allowRunningInsecureContent: false`
  on both windows.
- Build-time CSP: `default-src 'self'; script-src 'self'; object-src 'none';
  base-uri 'none'; form-action 'none'; img/media from self/blob; connect-src 'self'`.
- External links: allowlist `https/http/mailto/tel`, re-validated in the main
  process before `shell.openExternal`, refusal reported as refusal.
- No remote runtime resource is requested (the Electron smoke asserts it).

## 2. Blockers before a real release (P0)

1. **The packaged binary is five days old.** `release/KNOUX-REC-Setup-1.0.0-x64.exe`
   is from 2026-10-22 (114.8 MB), `release/win-unpacked` from 2026-10-24, the code
   from 2026-10-27. `smoke:packaged` launches that unpacked build, so a green
   packaged run today says nothing about what would ship.
   *Close it:* `npm run electron:dist` → `npm run smoke:packaged` on the new
   bundle → regenerate `latest.yml`.
2. **The installer is unsigned.** No `certificateFile` / `signingHashAlgorithms`
   in the builder config (and no certificate in the repo, correctly ignored).
   SmartScreen will warn on every install and auto-update cannot work without it.
   *Close it:* a Windows code-signing certificate plus a CI secret.
3. **There is no auto-update.** `publish` points at GitHub, but nothing imports
   `electron-updater`; `latest.yml` is generated and never consumed. Users would
   receive no fixes after installing 1.0.0.
   *Close it:* wire `electron-updater` on signed builds, or delete the `publish`
   block so the config stops implying updates that do not exist.
4. **There is no release pipeline and no tag.** CI uploads build artifacts only;
   nothing publishes a GitHub Release; `git tag` is empty; the version is still
   1.0.0 after 40+ commits of change.
   *Close it:* tag `v1.0.0-rc.1`, add a release job with `--publish always`.
5. **The chained suite is red on one assertion.**
   `smoke:recording → "trim produces a new persisted clip"` is the known
   real-time capture limitation (a busy machine can starve the canvas recorder).
   Every suite is green on its own; the chain is not.
   *Close it:* an offline frame-accurate encoder, or a written waiver in the
   release record. It must not stay red without a decision.

## 3. Release hygiene (P1)

- A 15.7 MB `.asar-new.asar` sits at the repository root, plus a leftover
  `release/win-unpacked.tmp`. Both are ignored by git, both are noise on a
  release machine.
- Ten tracked legacy root documents contradict the honest status docs:
  `MISSION_ACCOMPLISHED.md`, `AUDIT_COMPLETE.md`, `KNOUX_REC_COMPLETE_FINAL.md`,
  `LUXURY_UI_README.md`, `ENHANCED_SYSTEM_IMPROVEMENTS.md`,
  `README_COMPLETE_LOCAL_AI.md`, `OFFLINE_AI_TOOLS_DOCUMENTATION.md`,
  `RNNOISE_FALLBACK_FIX.md`, `App_BACKUP.tsx.bak`, `App_WORKING.tsx.bak`.
  A release reader cannot tell which of them is true; the `docs/STATUS_*` files
  are. They should be archived into one `docs/history/` folder or deleted.
- **No `PRIVACY.md` and no EULA.** The app makes a strong local-only claim; a
  one-page privacy note is cheap, expected by users and by any store listing.
- **Licence mismatch.** `LICENSE` is MIT, while the new Settings card ships a
  commercial key field. That is a product decision that should be stated, not
  implied.
- **One 1,070 kB bundle** (313 kB gzip) with only Elysian lazy-loaded. Fine for
  a desktop installer, but it costs startup time on a cold disk.
- **`lamejs` is in `devDependencies` with a broken module entry**
  (`MPEGMode is not defined`); its browser bundle is a global script. Either
  wire it behind a test for MP3 export or remove the dependency.
- **No crash reporting.** A deliberate local-first stance, but it is currently
  only implied; it belongs in the privacy note.

## 4. Product completeness (P2)

Registry, read from `src/data/serviceRegistry.ts`: **108 VERIFIED, 5 PARTIAL,
3 NOT-IMPLEMENTED, 10 BLOCKED** across 126 entries.

- **Blocked on model weights or a runtime encoder** (cannot be finished
  honestly in this environment): `el-retouch`, `el-upscale` (neural SR — the
  optical Lanczos upscale is shipped and verified), `el-generative`, `mc-body`,
  `body-segment`, `ai-transcribe`, `ai-ocr`, `ar-model`, `models-download`,
  `au-mp3`, `tpl-dev-catalog`.
- **Partial, for platform reasons**: system-audio capture (browser track
  availability), WebM export (runtime support), Visual Patch family coverage,
  the local inference runtime, Arabic text utilities beyond the deterministic set.
- **Not implemented, listed as such**: OS region picker, a dedicated watermark
  preset, library collections/duplicate/batch export, explicit cross-links
  between hubs, extra template families, per-region colour adjustments.
- **Licensing**: format and checksum only; there is no activation server, so
  entitlement is not provable and the UI says so.

## 5. The release sequence this audit implies

1. Freeze scope and tag `v1.0.0-rc.1`.
2. Decide the trim assertion: fix or waive in writing.
3. Install the signing certificate, then `npm run electron:dist`.
4. Verify the signature (`Get-AuthenticodeSignature`) and run `smoke:packaged`
   against the **newly built** unpacked app.
5. Publish the GitHub Release with the installer and `latest.yml`; wire or drop
   the updater.
6. After the release: privacy note, archive the legacy root documents, and
   decide the licence model (MIT vs commercial keys).
