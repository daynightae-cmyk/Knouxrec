# KNOuX REC — corporate identity screen, 2026-10-27

Branch `feat/services-2026-10-25` · baseline `dd2d6fb` (the commit the services
batch ended on). This records one screen and the boundary it needed, not a
marketing document: the deliverable is the mounted route.

## What shipped

| Piece | What it is | Where |
| --- | --- | --- |
| `about` route | A nineteenth route in the System group, reachable from the real sidebar, titled and breadcrumb'd like every other screen | `src/app/capabilities.ts`, `AppRoot.tsx`, `Sidebar.tsx` |
| Corporate hero | The genuine KNOUX artwork on a lit medallion, the wordmark, the founder in both scripts, three disciplines and three shortcuts, over the app's own obsidian surfaces and yellow accent | `src/views/AboutView.tsx` |
| Founder section | Four roles, a biography, and the engineering practice as four groups of twenty-one chips, with a sentence saying these describe the person and not this application | same file |
| Contact centre | WhatsApp, corporate email, direct call and the website as cards with real actions, copy buttons and an inline `aria-live` outcome per card | same file |
| Social grid | Five profiles — company page, founder page, engineering GitHub, KNOUX GitHub, TikTok — each labelled `COMPANY` or `FOUNDER` so the two are never confused | same file |
| Signature | Founder credit, a compact corporate record and the application version. No copyright year, because none was supplied | same file |
| Identity data | The single source for every destination, so the screen cannot drift from the official list | `src/data/knouxIdentity.ts` |
| Link policy | https/mailto/tel and nothing else; a desktop bridge call, a browser window, or an honest refusal with the value copied instead | `src/services/externalLinks.ts` |
| Desktop boundary | `openExternal` on the existing context bridge, re-validated in the main process before `shell.openExternal`; `contextIsolation` and `nodeIntegration` untouched | `knoux-rec-app/preload.cjs`, `main.cjs`, `types/desktop.d.ts` |
| Artwork | The official logo downloaded once, verified as an 800×800 RGBA PNG and bundled locally, because the CSP forbids remote images | `public/brand/knoux-official.png` |
| Brand glyphs | Facebook, GitHub, TikTok and WhatsApp paths inlined from Simple Icons; mail, phone, code and cloud added to the hand-drawn stroke set. No icon dependency was installed | `src/app/brandIcons.tsx`, `src/app/icons.tsx` |

## One harness fix

`src/test/setup.ts` replaced the whole `URL` global with `{ createObjectURL,
revokeObjectURL }` to work around jsdom. That made every `new URL(...)` in the
unit suite throw, which a scheme validator cannot survive. The two blob helpers
are still stubbed; the constructor is now the real one.

## What was measured

- `npm run verify` — PASS: type-check, lint with `--max-warnings 0`, i18n gate
  (25 views + 1 shared surface, 1311 strings), 251 unit tests across 20 files
  (24 of them new: 15 for the link policy, 9 for the identity directory), build.
- `npm run smoke:about` — 33/33 in Chromium, `artifacts/evidence/about/`.
  It proves the route is reached by a real sidebar click, the artwork decodes at
  800×800 and is drawn square, all nine destinations match the supplied list
  character for character, the copy actions write the true values to the system
  clipboard, a mailto click reports what the platform actually did, Tab reaches
  the next contact action with a visible ring, the Arabic build is RTL with no
  leaked key, the light theme and a 480 px viewport hold, and no image is
  fetched from the network.
- `npm run smoke:ui` — 58/58 with the navigation count at 19 routes.
- `npm run smoke:electron` — 16/16, including the new check that the main
  process refuses `javascript:`, `file:`, `data:`, an empty string and a
  newline-smuggled scheme through the bridge.
- `node scripts/count-smoke.mjs` — 25 smoke commands, 945 assertions, 944
  passing. The one failure is the pre-existing `smoke:recording` trim flake
  documented in `STATUS_2026-10-25_SERVICES.md`; nothing in this batch touched it.

## Limits, stated plainly

- No real call, chat or email was started during testing. The Electron check
  exercises the refusal path only, so "a mail client opened" remains unverified
  by design; what is verified is that the request is validated, handed to
  `shell.openExternal`, and that a refusal is reported as a refusal.
- The packaged Windows binary was not rebuilt, so `smoke:packaged` still runs
  the previous bundle and does not contain this screen.
- `README.md` carries an uncommitted corporate-identity section written by
  another session. It was left exactly as found, neither committed nor
  reverted, and the in-app page does not depend on it.
- Nothing was pushed, merged or deployed from this work.
