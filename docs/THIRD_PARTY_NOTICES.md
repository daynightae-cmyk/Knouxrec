# Third-party notices

KNOuX REC bundles the following open-source packages. All are installed from
npm and bundled locally by Vite; nothing is loaded from a CDN at runtime.
Full license texts ship inside each package under `node_modules/<package>/LICENSE`.

## UI modernization components (2026-10-24)

| Package | Version | License | Origin | Copyright / attribution | Local modifications |
| --- | --- | --- | --- | --- | --- |
| `@radix-ui/react-tooltip` | 1.4.1 | MIT | https://github.com/radix-ui/primitives | © WorkOS and Radix UI contributors | None — wrapped by `src/ui/Tooltip.tsx` with KNOUX styling |
| `react-resizable-panels` | 4.14.8 | MIT | https://github.com/bvaughn/react-resizable-panels | © Brian Vaughn | None — used through `Group`/`Panel`/`Separator` in the Live Studio |
| `react-compare-slider` | 4.0.0 | MIT | https://github.com/nerdyman/react-compare-slider | © nerdyman | Wrapped in `dir="ltr"` media chrome and KNOUX CSS |
| `react-zoom-pan-pinch` | 4.2.0 | MIT | https://github.com/BetterTyped/react-zoom-pan-pinch | © BetterTyped contributors | Styled wrapper classes only |
| `wavesurfer.js` | 8.0.3 | BSD-3-Clause | https://github.com/katspaugh/wavesurfer.js | © katspaugh and WaveSurfer contributors | Peaks are computed locally with Web Audio and passed in; playback uses an existing media element (no network fetch) |
| `react-colorful` | 5.8.1 | MIT | https://github.com/omgovich/react-colorful | © Vlad Shcherbin | Wrapped by `src/ui/ColorField.tsx` with KNOUX styling |

BSD-3-Clause obligations for WaveSurfer are met by retaining its copyright
notice and license text in the distributed package folder.

## Previously existing runtime dependencies

`react` / `react-dom` (MIT, © Meta Platforms and contributors) and all other
entries in `package.json` keep their own licenses inside `node_modules`.

## Excluded licenses (not integrated)

- Twick — Sustainable Use License (restrictive).
- Ektie React Video Timeline Editor — AGPL-3.0.
- ClipKit — BSL.
- Remotion-based kits — commercial terms not verified.

These are deliberately **not** installed or copied.
