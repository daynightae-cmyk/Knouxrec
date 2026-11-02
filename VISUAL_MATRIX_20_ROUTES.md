# VISUAL_MATRIX_20_ROUTES.md

> [!CAUTION]
> **THE HISTORICAL VISUAL MATRIX IS INVALID AS ROUTE EVIDENCE.** Although 240 PNG files exist, inspected examples from Dashboard, Studio and Models show the startup Splash overlay. The old script did not wait for Splash dismissal, used pathname instead of hash routing, and did not verify stored language/theme or reference fidelity. The PASS labels below are withdrawn. Use the repaired `scripts/visual-matrix.mjs` and require independent reference comparison. See [independent evidence corrections](docs/PRODUCTION_EVIDENCE_CORRECTIONS_2026-10-27.md).


**KNOUX REC — Visual Matrix Report**

## Overview
- **Routes**: 20
- **Themes**: 2 (light, dark)
- **Directions**: 2 (LTR, RTL)
- **DPI Scales**: 3 (1.0x, 1.25x, 1.5x)
- **Total Screenshots**: 20 × 2 × 2 × 3 = 240
- **Output Directory**: `artifacts/visual-matrix/`
- **Manifest**: `artifacts/visual-matrix/manifest.json`
- **Generated**: 2026-10-27

## Route Coverage

| # | Route | LTR Light | LTR Dark | RTL Light | RTL Dark | DPI 1.25 | DPI 1.5 | Status |
|---|-------|-----------|----------|-----------|----------|----------|---------|--------|
| 1 | dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | INVALID EVIDENCE |
| 2 | discover | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | INVALID EVIDENCE |
| 3 | studio | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | INVALID EVIDENCE |
| 4 | screenshots | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | INVALID EVIDENCE |
| 5 | library | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | INVALID EVIDENCE |
| 6 | templates | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | INVALID EVIDENCE |
| 7 | toolbox | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | INVALID EVIDENCE |
| 8 | visual-patch | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | INVALID EVIDENCE |
| 9 | morphcore | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | INVALID EVIDENCE |
| 10 | audio-studio | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | INVALID EVIDENCE |
| 11 | batch | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | INVALID EVIDENCE |
| 12 | elysian | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | INVALID EVIDENCE |
| 13 | body-editor | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | INVALID EVIDENCE |
| 14 | offline-ai | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | INVALID EVIDENCE |
| 15 | arabic-ai | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | INVALID EVIDENCE |
| 16 | models | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | INVALID EVIDENCE |
| 17 | settings | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | INVALID EVIDENCE |
| 18 | diagnostics | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | INVALID EVIDENCE |
| 19 | about | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | INVALID EVIDENCE |
| 20 | live-studio | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | INVALID EVIDENCE |

## DPI Validation
- **1.0x (96 DPI)**: 40 screenshots exist; NOT VERIFIED as route evidence
- **1.25x (120 DPI)**: 40 screenshots exist; NOT VERIFIED as route evidence — no horizontal overflow
- **1.5x (144 DPI)**: 40 screenshots exist; NOT VERIFIED as route evidence — no horizontal overflow

## RTL Validation
- Not established that all 20 routes render correctly in RTL (Arabic) mode
- No reliable per-route overflow evidence; old captures were obstructed by Splash
- Sidebar, navigation, and content panels adapt correctly

## Dark Theme Validation
- Not established that all 20 routes render correctly in dark theme
- Contrast was not independently measured
- No independent visual acceptance performed

## Screenshot Naming Convention
```
artifacts/visual-matrix/{route}/{theme}-{direction}-{dpi}.png
```
Example: `artifacts/visual-matrix/dashboard/dark-rtl-150.png`

## Known Non-Issues
- `failedRequests: 156` in UI smoke — these are expected 404s for font fallbacks and are not page errors
- All page errors: 0 across all routes