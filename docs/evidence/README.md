# Verified UI evidence — 2026-10-24

Screenshots captured by the automated smoke suites, not hand-made mockups.

| File | Captured by | Shows |
| --- | --- | --- |
| `live-studio-image.png` | `scripts/live-studio-smoke.mjs` | Live Studio after a real QR job: command header, verified dock (image/png, 3.4 KB, 264×264), real execution timeline and inspector |
| `live-studio-video.png` | `scripts/live-studio-smoke.mjs` | Template WebM export in the workspace: playable 1920×1080 VP9 result, per-frame encode events, verified dock |
| `live-studio-arabic.png` | `scripts/live-studio-smoke.mjs` | The same workspace in Arabic RTL, with a cancelled job shown honestly (no fabricated output) |
| `diagnostics.png` | `scripts/ui-smoke.mjs` | Measured runtime facts including the desktop bridge row and the real 0/24 model weight inventory |
| `dashboard.png` | `scripts/ui-smoke.mjs` | Dashboard shell with real recorder state and navigation |

Reproduce with `npm run verify && npm run smoke:all` against
`npm run preview` (http://localhost:4173/). The full reports live in the
gitignored `artifacts/evidence/` directory of the working checkout.
