# Verified UI evidence — 2026-10-24

Screenshots captured by the automated smoke suites, not hand-made mockups.

| File | Captured by | Shows |
| --- | --- | --- |
| `live-studio-image.png` | `scripts/live-studio-smoke.mjs` | Live Studio after a real QR job: command header, verified dock (image/png, 3.4 KB, 264×264), real execution timeline and inspector |
| `live-studio-video.png` | `scripts/live-studio-smoke.mjs` | Template WebM export in the workspace: playable 1920×1080 VP9 result, per-frame encode events, verified dock |
| `live-studio-arabic.png` | `scripts/live-studio-smoke.mjs` | The same workspace in Arabic RTL, with a cancelled job shown honestly (no fabricated output) |
| `diagnostics.png` | `scripts/ui-smoke.mjs` | Measured runtime facts including the desktop bridge row and the real 0/24 model weight inventory |
| `dashboard.png` | `scripts/ui-smoke.mjs` | Dashboard shell with real recorder state and navigation |
| `templates-gallery.png` | `scripts/templates-smoke.mjs` | Visual template gallery with genuine 480×270 rendered thumbnails and category filters |
| `toolbox-crop.png` | `scripts/toolbox-smoke.mjs` | Image Cropper result in the Live Studio-enabled Toolbox (300×200 real output) |
| `live-studio-compare.png` | `scripts/live-studio-smoke.mjs` | react-compare-slider with real source/processed pixels and resizable panels |
| `screenshot-editor.png` | `scripts/screenshot-editor-smoke.mjs` | Screenshot editor after a real capture with crop, arrow, text and blur applied |
| `models-validation.png` | runtime probe | Local weight-file validation: real size verdict and SHA-256, explicitly not installed |
| `morphcore-perspective.png` | `scripts/morphcore-smoke.mjs` | MorphCore geometry studio: trapezoid perspective resampled on real pixels (900×320 working image, transparent wedges measured) |
| `morphcore-arabic.png` | `scripts/morphcore-smoke.mjs` | The same studio in Arabic RTL after the 18+ gate, with the blocked body-aware catalog listed separately |
| `elysian-studio-layers.png` | `scripts/elysian-studio-smoke.mjs` | Elysian creative image studio: seven stacked real layers, per-card rendered thumbnails, live text and watermark parameters |
| `elysian-studio-compare.png` | `scripts/elysian-studio-smoke.mjs` | Split compare between the untouched source and the rendered result |
| `elysian-studio-arabic.png` | `scripts/elysian-studio-smoke.mjs` | The full studio in Arabic RTL with the mirrored three-column layout |
| `service-discovery.png` | `scripts/discover-smoke.mjs` | Unified service discovery: 93 registry entries with execution mode, honest run state, favourites and recents |
| `service-discovery-arabic.png` | `scripts/discover-smoke.mjs` | The same registry view in Arabic RTL |

Reproduce with `npm run verify && npm run smoke:all` against
`npm run preview` (http://localhost:4173/). The full reports live in the
gitignored `artifacts/evidence/` directory of the working checkout.
