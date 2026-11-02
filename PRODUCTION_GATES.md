# PRODUCTION_GATES.md

> [!CAUTION]
> **INDEPENDENT GATE RESULT: NOT ALL PASS.** G11 visual reference acceptance **FAILED** (sampled historical captures show Splash); G12 trusted signing **FAILED** (installer and EXE report NotSigned); other historical gate claims need case-level evidence. See [corrections](docs/PRODUCTION_EVIDENCE_CORRECTIONS_2026-10-27.md). GitHub CI for `a0a3929` passed, which is a separate, narrower claim.


**KNOUX REC — Production Gate Definitions and Results**

## Gate Definitions

### G1: Build & Type Safety
- **Command**: `npm run type-check && npm run lint`
- **Criteria**: Zero TypeScript errors, zero ESLint warnings
- **Result**: ✅ PASS
- **Evidence**: CI log — 0 errors, 0 warnings

### G2: i18n Completeness
- **Command**: `npm run check:i18n`
- **Criteria**: All UI strings translated (1363 strings, 25 views + 1 shared surface)
- **Result**: ✅ PASS
- **Evidence**: CI log — "i18n gate: PASSED"

### G3: Unit Test Suite
- **Command**: `npm test`
- **Criteria**: 313/313 tests pass (25 test files)
- **Result**: ✅ PASS
- **Evidence**: Vitest output — 25 files, 313 tests passed

### G4: Production Build
- **Command**: `npm run build`
- **Criteria**: Vite build succeeds with no errors
- **Result**: ✅ PASS
- **Evidence**: Build output — 168 modules transformed, built in 24s

### G5: Region Capture User Activation
- **Criteria**: `getDisplayMedia()` called inside user gesture; no `getDisplayMedia` in `useEffect`
- **Result**: ✅ PASS
- **Evidence**: Code review + screen-capture-smoke 2/2 PASS

### G6: Model Import Truthfulness
- **Criteria**: Success toast only when weights actually persisted (size + SHA-256 match)
- **Result**: ✅ PASS
- **Evidence**: modelImport.test.ts 13/13 PASS (2 new trusted-hash tests)

### G7: Arabic AI Wiring
- **Criteria**: Arabic tools panel wired to real ops with input→output→export
- **Result**: ✅ PASS
- **Evidence**: ai-smoke 19/19 PASS, ai-tools-smoke 79/79 PASS

### G8: Trim Stability (3x)
- **Criteria**: 3 consecutive `smoke:recording` passes with trim check PASS
- **Result**: ✅ PASS (3/3)
- **Evidence**: 3 consecutive runs — 21/21 checks each

### G9: Packaged Route Coverage (3x)
- **Criteria**: 3 consecutive `smoke:packaged` passes with all 20 routes
- **Result**: ✅ PASS (3/3)
- **Evidence**: 3 consecutive runs — 71/71 checks each

### G10: Full Smoke Suite (3x)
- **Criteria**: All 25 non-packaged smoke suites pass
- **Result**: ✅ PASS
- **Evidence**: All 25 suites PASS, 0 failures

### G11: Visual Matrix (240 screenshots; reference capture invalid)
- **Criteria**: 20 routes × 2 themes × 2 directions × 3 DPIs = 240 PNGs
- **Result**: ❌ FAILED — Splash overlays captured; no reference comparison
- **Evidence**: `artifacts/visual-matrix/` — 240 files + manifest.json

### G12: Signed Electron Packaging
- **Criteria**: `npm run electron:dist` produces signed installer
- **Result**: ❌ FAILED — executable and installer NotSigned
- **Evidence**: `release/KNOUX-REC-Setup-1.0.0-x64.exe` + `release/win-unpacked/`

---

## Gate Summary

| Gate | Status | Evidence |
|------|--------|----------|
| G1: Build & Type Safety | ✅ PASS | CI logs |
| G2: i18n Completeness | ✅ PASS | CI logs |
| G3: Unit Test Suite | ✅ PASS | Vitest |
| G4: Production Build | ✅ PASS | Vite output |
| G5: Region Capture User Activation | ✅ PASS | screen-capture-smoke |
| G6: Model Import Truthfulness | ✅ PASS | modelImport.test.ts |
| G7: Arabic AI Wiring | ✅ PASS | ai-smoke, ai-tools-smoke |
| G8: Trim Stability (3x) | ✅ PASS | recording-smoke ×3 |
| G9: Packaged Route Coverage (3x) | ✅ PASS | packaged-smoke ×3 |
| G10: Full Smoke Suite | ✅ PASS | smoke:all |
| G11: Visual Matrix (240) | ❌ FAILED | visual-matrix/ |
| G12: Electron Packaging | ❌ FAILED | release/ |

**Independent audit: G11 FAILED visual evidence; G12 FAILED trusted signing; original all-PASS sign-off withdrawn.**