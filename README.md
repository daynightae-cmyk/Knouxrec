# KNOUX REC - Local-first screen recorder

![KNOUX REC](https://img.shields.io/badge/KNOUX-REC-8b5cf6?style=for-the-badge&logo=video&logoColor=white)

A local-first desktop screen recorder (Electron + React + TypeScript). Captures
screen, window or camera through `getDisplayMedia` / `getUserMedia`, records with
`MediaRecorder`, and stores every clip, screenshot and edit as a real Blob in
IndexedDB on the machine it was captured on. Nothing is uploaded, and the
runtime loads no external resource.

> **Status transparency** — this README describes what the code actually does.
> The AI catalogues in the navigation are **catalogues**: their model manifests
> ship without weight files, so they are listed as unavailable instead of
> returning fabricated output. The authoritative, machine-generated state of
> every section lives in [`docs/CAPABILITY_REGISTRY.md`](docs/CAPABILITY_REGISTRY.md).

## ✨ What works today

| Area | Capability | State |
| --- | --- | --- |
| Capture | Screen / window capture through the OS picker, camera capture, microphone | Verified at runtime |
| Capture | Pause, resume, stop, webcam picture-in-picture overlay | Verified at runtime |
| Capture | Frame-accurate screenshots (PNG / JPEG / WebP) from the live display stream | Verified at runtime |
| Library | Real Blobs in IndexedDB, preview, rename, favourite, delete, export, trim | Verified at runtime |
| Library | Trim re-encodes a range into a new clip and keeps the original | Verified at runtime |
| Shell | Dark / light theme, English / Arabic (RTL), reduced motion, persisted settings | Verified at runtime |
| Shell | Diagnostics view that measures the live runtime (capture, encoder, storage, fonts) | Verified at runtime |
| Desktop | Hardened Electron shell: `contextIsolation`, `sandbox`, CSP, validated IPC, own source picker | Verified at runtime |
| Packaging | NSIS installer, per-user install, uninstall, signed-blockmap metadata | Verified by install + run |
| Elysian Canvas | Image editing workspace: sliders, real presets, preview, PNG export with filters baked in | Preview / demo |
| AI catalogues | 38 offline tools, 38 Arabic tools, 24 model manifests | Missing model weights — listed, not faked |

## 🚫 What is deliberately not available

These sections are visible in the navigation but are **disabled with an explicit
reason**, because their previous implementations produced placeholder output:

- **Templates / Toolbox / Visual Patch** — the original panels are preserved in
  `components/` but are not mounted: their dependency graph does not compile and
  their handlers call processor methods that do not exist.
- **Offline AI (38 tools) / Arabic AI (38 tools)** — catalogue only. The
  `model.json` graphs ship without `weights.bin`, and no inference runtime is
  bundled.
- **MorphCore / AI Body Editor** — age-gated catalogues whose native engines
  never existed as executable modules.
- **Elysian Canvas AI pipeline** — `elysian-canvas/core/AICore.ts` references an
  ONNX runtime and model paths that are not shipped; it is dead code and is not
  part of the bundle.

## 🚀 Quick start

### Prerequisites

- Node.js 18+ (CI runs on Node 22)
- npm 8+
- Windows, macOS or Linux desktop with a Chromium browser or the Electron build

### Install and run

```bash
npm ci
npm run dev          # Vite dev server (renderer only)
npm run electron     # Electron shell against the source tree
```

### Build

```bash
npm run build        # production renderer into dist/
npm run electron:dist  # renderer + NSIS installer into release/
```

The desktop shell entry point is `knoux-rec-app/main.cjs`. It is CommonJS on
purpose: the root `package.json` declares `"type": "module"`, and electron-builder
copies that manifest into the archive, so a `.js` entry point would be loaded as
an ES module and crash before the window appears.

### Recording in 30 seconds

1. Press `Ctrl+Shift+R` (or use **Recorder** → **Start recording**).
2. Pick a screen or window in the OS picker, optionally enable the camera
   overlay and microphone.
3. Stop with `Ctrl+Shift+R`; the encoded WebM is written to the library.
4. Open **Library** to preview, trim, rename, favourite or export it.

Hotkeys: `Ctrl+Shift+R` start/stop, `Ctrl+Shift+P` pause, `Ctrl+Shift+S`
screenshot.

## 🛠️ Technology stack

- **Electron 45** desktop shell, **React 19**, **TypeScript 5.7**, **Vite 6**
- **MediaRecorder** (`vp9/opus` preferred) with EBML duration patching
- **IndexedDB** (`knoux-rec.library`) for durable media storage
- **localStorage** (`knoux-rec.settings.v1`) for preferences
- **CSP** injected at build time (`vite.config.ts`), enforced in the renderer
  and in the source picker
- **Vitest** for unit tests, **Puppeteer/Chrome DevTools Protocol** for the
  runtime smoke tests

## 🧪 Verification

Every claim in this file is reproduced by a script in `scripts/`:

```bash
npm run type-check      # tsc --noEmit
npm run lint            # eslint over src/
npm test                # unit tests (vitest)
npm run smoke:ui        # renderer behaviour in headless Chrome
npm run smoke:recording # record -> pause -> resume -> save -> persist
npm run smoke:screen    # display capture path
npm run smoke:error     # permission denial and recovery
npm run smoke:electron  # Electron shell, routes, CSP, console errors
npm run smoke:packaged  # the packaged binary: boots and renders every route
npm run smoke:all       # all of the above
```

`npm run smoke:packaged` is the gate that matters most for releases: it starts
the real `release/win-unpacked/KNOUX REC.exe`, attaches to the renderer over the
DevTools protocol, walks all 15 routes and fails on any console error, failed
request or missing view.

CI (`.github/workflows/ci.yml`) runs the quality gates on every push and
packages the desktop app on Windows, then runs the packaged smoke test.

## 🔒 Privacy and security

- **Local only** — media stays in IndexedDB on the device; the renderer loads
  no external resource and the CSP forbids remote origins.
- **No account, no telemetry, no cloud sync.**
- **Hardened Electron** — `nodeIntegration: false`, `contextIsolation: true`,
  `sandbox: true`, navigation allowlist, `window.open` denial, sender-validated
  IPC, and a dedicated source picker with its own CSP.
- **Not encrypted at rest** — captures are stored unencrypted in the OS profile
  directory, readable by other processes running as the same user. Encryption is
  a roadmap item, not a current guarantee.
- **Permissions** — screen capture, camera and microphone are requested only
  from an explicit user gesture.

## 📄 License

MIT — see [LICENSE](LICENSE).
