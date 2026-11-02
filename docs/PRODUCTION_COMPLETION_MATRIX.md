# KNOUX REC — Production Completion Matrix

**Generated:** 2026-11-02
**Base SHA:** `630ec6087bf2a121f74a13f195f2ea32f58c98cc` (main, verified clean)
**Branch:** `feat/rec-production-completion-2026-11-02`

## Baseline Verification

| Gate | Result |
|------|--------|
| TypeScript (`tsc --noEmit`) | PASS (0 errors) |
| ESLint (`--max-warnings 0`) | PASS |
| Unit tests (`vitest run`) | PASS (342 tests, 28 files, 0 failures) |
| Production build (`vite build`) | PASS (1 warning: chunk size > 500 kB) |

## Service Registry Summary

132 registered services across 17 hubs.

| Status | Count | Description |
|--------|-------|-------------|
| VERIFIED | 110 | Real engine, real output, tested in runtime |
| IMPLEMENTED-NOT-VERIFIED | 5 | Code exists but lacks end-to-end smoke assertion |
| PARTIAL | 5 | Core works; a sub-feature or runtime boundary is incomplete |
| BLOCKED | 10 | Requires external dependency (model weights, native engine, online service) |
| NOT-IMPLEMENTED | 2 | Honestly absent; shown as blocked, not faked |

## Route Capability States

| Route | Group | State | Feasible Action |
|-------|-------|-------|-----------------|
| dashboard | capture | VERIFIED | — |
| discover | capture | VERIFIED | — |
| studio | capture | VERIFIED | — |
| screenshots | capture | PARTIAL | Verify window/clipboard/tags via smoke assertions |
| library | library | VERIFIED | — |
| templates | create | VERIFIED | — |
| toolbox | create | VERIFIED | — |
| visual-patch | create | PARTIAL | Add per-algorithm-family regression tests |
| morphcore | create | PARTIAL | Body-aware stays BLOCKED; geometry is verified |
| audio-studio | create | PARTIAL | WebM/Opus export is runtime-gated honestly |
| batch | create | PARTIAL | Core verified; image-only scope is honest |
| elysian | create | PARTIAL | Neural stays BLOCKED; non-neural verified |
| body-editor | create | PARTIAL | Manual measurement verified; body-aware BLOCKED |
| offline-ai | intelligence | PARTIAL | 15/38 deterministic tasks run; 23 BLOCKED by weights |
| arabic-ai | intelligence | PARTIAL | Same engine as offline-ai; Arabic labels verified |
| models | intelligence | MISSING_MODEL | Import/validation works; 0/23 weights present |
| settings | system | VERIFIED | — |
| diagnostics | system | VERIFIED | — |
| about | system | VERIFIED | — |
| live-studio | create | VERIFIED | — |

## Actionable Gaps (Not Blocked by External Dependencies)

### GAP-01: Bundle code-splitting
- **Problem:** Main chunk is 1.18 MB (gzip 342 KB). Only ElysianStudio is lazy-loaded.
- **Scope:** Add `manualChunks` to `vite.config.ts` and lazy-load heavy views (AudioStudio, VisualPatch, MorphCore, Batch, Elysian, Templates, AiWorkspace).
- **Priority:** High (performance, user experience)
- **Risk:** Low — chunk splitting is deterministic; lazy imports are standard React.

### GAP-02: Visual Patch algorithm-family regression tests
- **Problem:** 50 catalog tools map to 8 edit modes, but only one family is smoke-tested end-to-end.
- **Scope:** Add unit tests that exercise each of the 8 edit-mode pixel operations (`applyPinchTool`, `applyWarpTool`, `applySculptTool`, `applyBrushTool`, `applySmoothTool`, `applyCurveTool`, `applyMirrorTool`, `applyDragTool`) with measured pixel changes.
- **Priority:** Medium (the engine is real; coverage is the gap)
- **Risk:** Low — tests verify existing behavior.

### GAP-03: Screenshot IMPLEMENTED-NOT-VERIFIED services
- **Problem:** `shot-window`, `shot-clipboard`, `shot-tags`, `shot-os-region` are implemented but lack smoke assertions.
- **Scope:** Extend the screenshot smoke to assert clipboard write, tag persistence across reload, and window-source picker path.
- **Priority:** Medium
- **Risk:** Low — the code already exists; only test coverage is added.

## Blocked Gaps (External Dependencies Required)

### BLK-01: Model weights (0/23 present)
- **Dependency:** Licensed neural model weight binaries for 23 model IDs.
- **Status:** Import, validation, and manifest inspection are implemented. No weights ship.
- **Affected:** offline-ai (23 tasks), arabic-ai (23 tasks), elysian neural, morphcore body-aware, body-editor segmentation, models hub.

### BLK-02: MP3/AAC encoding
- **Dependency:** No encoder runtime exists in the browser/Electron.
- **Status:** Honestly disabled; WAV and WebM/Opus are supported.

### BLK-03: System audio capture
- **Dependency:** Platform-level system-audio loopback (Chromium limitation).
- **Status:** `getDisplayMedia({ audio: true })` is requested; availability depends on OS/runtime.

### BLK-04: Scrolling screenshot capture
- **Dependency:** Frame stitching engine not implemented.
- **Status:** Control shown as blocked, not faked.

### BLK-05: Durable cross-reload handoff
- **Dependency:** Deliberate design decision — library already persists media; a reload-surviving handoff would duplicate the library's role.

### BLK-06: Digital signing
- **Dependency:** Trusted Authenticode certificate.
- **Status:** Unsigned development builds can be produced; public trusted release is BLOCKED.

### BLK-07: Online provider integrations
- **Dependency:** Credentials, paid APIs, user consent.
- **Status:** Opt-in boundary implemented; no provider is configured.
