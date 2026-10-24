# KNOuX REC — UI component adoption report

Date: 2026-10-24 · Branch: `feat/sovereign-2026-10-24` · Checkpoint: `5030703`

Surgical UI modernization using mature open-source components. **No framework,
router, Tailwind or application-shell migration.** The existing KNOUX CSS
design system, hash navigation, service engines and smokes remain the source of
truth.

## 1. Current UI inventory (what already exists)

| Area | Existing implementation | Assessment |
| --- | --- | --- |
| Buttons / cards / badges / chips | `.kx-btn` variants, `.kx-card`, `.kx-badge[data-state]`, `.kx-chip` in `src/design-system.css` | Complete, themed, tested by `ui-smoke` — replacing would be pure churn |
| Dialog | `components/Modal.tsx`: focus trap, focus restore, Escape, scroll lock, `aria-modal`, backdrop control | Already accessible; Radix Dialog would be near-parity |
| Dialog suite | `PreviewDialog`, `ConfirmDialog`, `RenameDialog`, `TrimDialog` in `src/views/ui.tsx` | Complete and wired to real library actions |
| Segmented controls | `.kx-segmented` with `aria-pressed` (asserted by smokes) | Accessible; replacing changes test semantics without user gain |
| Switch | native checkbox + `.kx-switch-track` | Native semantics — sufficient |
| Selects | native `<select>` in Settings/Toolbox surface | Native — sufficient |
| Tooltips | native `title` attributes on icon buttons | **Gap:** no styled/focus-visible tooltips |
| Live Studio layout | CSS grid (fixed proportion, responsive collapse) | **Gap:** no user-resizable inspector/preview |
| Compare slider | custom clip-path + native range input | Works, but handle rendering/keys are ours to maintain |
| Image zoom | ±1× buttons and fit/fill | **Gap:** no wheel zoom / pan |
| Audio preview | native `<audio controls>` + real rendered waveform image | **Gap:** no interactive seekable waveform |
| Color parameters | none exposed (colors exist in defaults only) | **Gap:** users cannot set text/QR/waveform colors |

## 2. Candidate evaluation

| Candidate | Source | License | React 19 | Tailwind 3.4 / CSS | CSP / Electron | RTL | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| shadcn/ui components | https://github.com/shadcn-ui/ui | MIT | yes (current) | upstream targets Tailwind v4 styles; porting would require token migration | bundled | yes | **Reject as code source** — existing Button/Card/Dialog/Tabs/Select/Switch/Badge equivalents are complete and tested; latest upstream expects Tailwind v4 |
| shadcn-admin | https://github.com/satnaing/shadcn-admin | MIT | yes | Tailwind v4 app; ships router/auth/backend | n/a | partial | **Patterns only** — extract sidebar/search/settings composition ideas; transplant nothing |
| Origin UI | https://github.com/shadcn/originui | MIT | yes | Tailwind v4-first | n/a | partial | **Patterns only** — card/inspector polish references; no code transplant |
| `@radix-ui/react-tooltip` 1.4.1 | radix-ui/primitives | MIT | `^16.8 \|\| ^17 \|\| ^18 \|\| ^19` | unstyled — KNOUX CSS styles it | no network | floating-ui respects `dir` | **Adopt** |
| `@radix-ui/react-dialog` 1.3.1 | radix-ui/primitives | MIT | yes | unstyled | fine | yes | **Reject** — `Modal` already traps/restores focus and handles Escape/scroll lock |
| `@radix-ui/react-dropdown-menu` 2.2.1 | radix-ui/primitives | MIT | yes | unstyled | fine | yes | **Defer** — no real menu surface exists today; adding menus without actions would be decoration |
| `@radix-ui/react-tabs` / `select` / `switch` | radix-ui/primitives | MIT | yes | unstyled | fine | yes | **Reject** — replaces tested native/aria-pressed controls with no functional gain |
| `react-resizable-panels` 4.14.8 | bvaughn/react-resizable-panels | MIT | `^18 \|\| ^19` | plain CSS | fine | inherits | **Adopt** (Live Studio split) |
| `react-compare-slider` 4.0.0 | nerdyman/react-compare-slider | MIT | `>=16.8` | inline styles overridable | fine | supported (wrapped LTR for media) | **Adopt** (before/after) |
| `react-zoom-pan-pinch` 4.2.0 | BetterTyped/react-zoom-pan-pinch | MIT | peer `*` | inline transforms | fine | n/a | **Adopt** (image zoom/pan) |
| `wavesurfer.js` 8.0.3 | katspaugh/wavesurfer.js | BSD-3-Clause | framework-agnostic | container styling | **must not fetch** audio (CSP `connect-src 'self'`); use a media element + locally decoded peaks | n/a | **Adopt** with CSP-safe loading |
| `react-colorful` 5.8.1 | omgovich/react-colorful | MIT | `>=16.8` | tiny, styles overridable | fine | n/a | **Adopt** (tool color fields) |
| React Konva | konvajs/react-konva | MIT | yes | – | – | – | **Reject** — no object-model need; canvas engines already exist |
| Motion Primitives | ibelick/motion-primitives | MIT (beta) | yes | Tailwind-oriented | – | – | **Reject** — beta; CSS motion tokens already cover needs |
| Twick / Ektie / ClipKit / Remotion kits | – | restrictive/AGPL/BSL | – | – | – | – | **Excluded** per mission |
| New video player | – | – | – | – | – | – | **Rejected** — native `<video>` playback already verified |

## 3. License matrix (required notices)

| Package | Version | License | Copyright |
| --- | --- | --- | --- |
| `@radix-ui/react-tooltip` | 1.4.1 | MIT | © WorkOS / Radix contributors |
| `react-resizable-panels` | 4.14.8 | MIT | © Brian Vaughn |
| `react-compare-slider` | 4.0.0 | MIT | © nerdyman |
| `react-zoom-pan-pinch` | 4.2.0 | MIT | © BetterTyped contributors |
| `wavesurfer.js` | 8.0.3 | BSD-3-Clause | © katspaugh and WaveSurfer contributors |
| `react-colorful` | 5.8.1 | MIT | © Vlad Shcherbin |

Notices are recorded in `docs/THIRD_PARTY_NOTICES.md`. All packages are bundled
locally by Vite; nothing loads from a CDN at runtime.

## 4. Compatibility findings and constraints

- **React 19.1 / ReactDOM 19.1** — every adopted package declares React 19 in
  its peer range or is framework-agnostic. `@types/react` stays at 18; `tsc`
  must pass before committing.
- **Vite 6.2 / Tailwind 3.4** — nothing depends on Tailwind utilities; new
  components are styled with KNOUX tokens (`--kx-*`) in `design-system.css`.
- **CSP** (`vite.config.ts`): `default-src 'self'; img-src 'self' data: blob:;
  media-src 'self' blob:; connect-src 'self'`. Consequences:
  - Wavesurfer must **not** fetch blob URLs. Implementation decodes
    `blob.arrayBuffer()` locally, computes peaks with Web Audio, and plays
    through a media element (allowed by `media-src blob:`).
  - Radix Tooltip portals create DOM only — no CSP impact.
- **RTL** — Radix floating-ui reads `document.dir`; the compare slider is
  wrapped in `dir="ltr"` media chrome, matching the current implementation;
  panels inherit flex direction. Arabic must be re-verified visually.
- **Electron 45** — all components are DOM-only; packaged smoke will prove the
  build still boots under the Electron CSP.
- **Bundle size** — expected additions: Radix tooltip ~15 KB, panels ~12 KB,
  compare ~10 KB, zoom-pan ~18 KB, wavesurfer ~100 KB (lazy with the audio
  preview), react-colorful ~8 KB. All within the existing 500 KB warning budget;
  verify the build after adoption.

## 5. Migration risk assessment

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Live Studio smoke asserts custom compare DOM | medium | Update assertions to the real new component (container, two images, keyboard interaction); never weaken |
| Resizable panels change responsive layout | low | Media-query remount (`horizontal ≥1181px`, stacked below); auto-save disabled |
| Wavesurfer decode timing in headless | medium | Precomputed peaks; fall back to the native player if decode fails; smoke waits on real peaks |
| New dependency peer conflicts | low | Install with npm, run `npm run verify`; revert individually if a package conflicts |
| RTL regressions from floating elements | low | Arabic visual check + existing overflow assertions |
| CSP violation at runtime | low | No new network calls; `connect-src` untouched |

## 6. Adopted integration plan

1. `TooltipProvider` + `KxTooltip` wrapper; apply to TopBar actions, collapsed
   Sidebar items and Live Studio toolbar.
2. Live Studio: resizable preview/inspector panels; `ReactCompareSlider`
   before/after; `TransformWrapper` zoom/pan with buttons; WaveSurfer waveform
   for audio sources (local peaks, media playback).
3. Toolbox: `HexColorPicker` fields for waveform/text colors and QR dark/light
   (options already understood by the processors).
4. Shared primitives unchanged: Modal/Dialog suite, Button, Card, Badge,
   Segmented, Switch, Select — documented above as sufficient.
5. Every touched route re-verified by `npm run verify`, the full smoke suite,
   Arabic RTL and DPI checks; new screenshots added to `docs/evidence/`.

**Status: report complete — implementation proceeds in the same session.**

## 7. Outcome (verified)

| Component | Outcome | Verification |
| --- | --- | --- |
| Radix Tooltip | Adopted in TopBar, collapsed Sidebar and Live Studio toolbar | ui 50/50; tooltip provider exercised by route traversal |
| react-resizable-panels | Adopted for the Live Studio split (horizontal ≥1181px, stacked below) | live-studio 33/33 |
| react-compare-slider | Adopted; keyboard interaction asserted | live-studio 33/33 |
| react-zoom-pan-pinch | Adopted for single-image results (buttons, drag pan, double-click) | live-studio 33/33 |
| wavesurfer.js | Adopted for audio sources with locally decoded peaks; real playback asserted | live-studio 33/33 |
| react-colorful | Adopted via `src/ui/ColorField.tsx` for waveform, text and QR colours (swatch + hex input + inline picker) | toolbox 128/128 — a QR colour change is proven to alter the encoded pixels |
| Radix Dialog/Tabs/Select/Switch/Menu | Rejected/deferred with reasons above | existing suites unchanged |

Additional product work delivered in the same pass: three new real Toolbox
processors (rotate/flip, crop, pixelate — toolbox 127/127) and a Templates
gallery with genuine rendered thumbnails (27/27).
