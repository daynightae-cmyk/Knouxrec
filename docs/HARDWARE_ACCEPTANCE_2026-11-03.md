# KNOUX REC — Real Windows Hardware Acceptance (2026-11-03)

Machine: Windows 10.0.19045 (22H2) · Electron 45.0.0 · Chromium 156.0.8078.48 ·
Node 24.22.0 · Intel HD Graphics 4600 · display **LEN-M93z-B, 1920×1080, scaleFactor 1**.
Binary under test: `release-hw/win-unpacked/KNOUX REC.exe`, packaged from `main` at
`92a3978` (fresh `app.asar`, 16,302,236 bytes, dated 2026-11-03). The frozen
`release/` bundle of 2026-10-27 was not touched.

This is the phase the delivery ledger of 2026-11-02 said was still open: every capture
number in that record came from Chromium's `--use-fake-device-for-media-stream` and an
auto-selected fake desktop. That proves the pipeline, the crop arithmetic, the container
and the decode. It does not prove that this machine's actual display produces real pixels
through the shipped binary.

## What was measured

Capture is driven through the app's own picker — `session.setDisplayMediaRequestHandler`
in `knoux-rec-app/main.cjs` opens the app's real source window, and the harness clicks a
source in it. No test-only auto-approve path was added to the shipped main process.

The four files below are in `artifacts/hardware-acceptance/`. Their frame sizes and
durations are read **straight out of the EBML bytes** by `scripts/webm-inspect.mjs`,
which is independent of the app, of the recorder and of any browser decoder:

| capture | codecs | frame size | duration | bytes | container |
|---|---|---|---|---|---|
| full screen | V_VP9 + A_OPUS | **1920×1080** | 4.816 s | 289,960 | EBML/Matroska |
| full screen (second take) | V_VP9 + A_OPUS | **1920×1080** | 4.560 s | 256,491 | EBML/Matroska |
| **selected area** | V_VP9 + A_OPUS | **1533×693** | 4.891 s | 438,569 | EBML/Matroska |
| application window | A_OPUS + V_VP9 | **1920×1050** | 4.673 s | 264,380 | EBML/Matroska |

The selected-area take is the mission's critical gate and the one number that cannot be
faked by a decorative overlay: the file declares **1533×693**, not the 1920×1080 of the
surface it was cut from, and the raw bytes carry `b0 82 05 fd` (width 1533) followed by
`ba 82 02 b5` (height 693). Every file carries an Opus track, so system audio was
requested and muxed into the recording rather than merely offered.

Each file was also written to disk by the harness and re-opened as an independent file:
the header reads `1a 45 df a3` and the byte count matches what the app stored.

## Gate matrix

| Gate | Status | Evidence |
|---|---|---|
| Full-screen recording, real display | **VERIFIED_ON_HARDWARE** | 1920×1080, 4.816 s, 289,960 bytes, re-opened from disk |
| Selected-area recording, real pixels | **VERIFIED_ON_HARDWARE** | 1533×693 cut from a 1920×1080 surface — not the whole monitor |
| Application-window recording | **VERIFIED_ON_HARDWARE** | 1920×1050, the window's client area |
| System audio | **VERIFIED_ON_HARDWARE** | A_OPUS track present in every captured file |
| Microphone access | **VERIFIED_ON_HARDWARE** | `getUserMedia({audio})` returned a live track from "Microphone (High Definition Audio Device)" |
| Microphone signal level | **PARTIAL** | The capsule opened and streamed, but the analyser peak was 1/128 — digital silence. A person must speak at the machine for a level to mean anything |
| Camera | **NOT_AVAILABLE_ON_THIS_MACHINE** | `getUserMedia({video})` → `NotFoundError: Requested device not found`; `enumerateDevices` lists zero `videoinput` endpoints. This host has no camera, so the gate cannot be performed here at any permission level |
| Save and re-open | **VERIFIED_ON_HARDWARE** | Files written by the harness and re-parsed independently |
| Display at 100 % DPI | **VERIFIED_ON_HARDWARE** | The only mode this host has: one display, scaleFactor 1 |
| Display at another scale factor | **NOT_AVAILABLE_ON_THIS_MACHINE** | One monitor only; Windows scaling is a host setting this phase cannot change |
| Second monitor | **NOT_AVAILABLE_ON_THIS_MACHINE** | One display is attached |

## What is still open, and what closes it

- **Microphone level** needs a person to speak, clap or play a tone at the machine while
  the capture runs. Everything up to the signal is verified.
- **Camera** needs a host with a webcam.
- **Non-100 % DPI and multi-monitor** need a second display or a host whose scaling is
  changed. The application code paths for those are exercised by the automated suite
  with a fake device, but they are not proven against real scaled hardware.
- **Windows signing remains BLOCKED.** `Get-AuthenticodeSignature` on the new
  `KNOUX REC.exe` returns `NotSigned`, exactly as the October audit reported for the
  previous bundle. The 2026-10-27 installer and `release/` are preserved unmodified.

## Tooling added

- `scripts/hardware-probe.cjs` — asks Electron what the machine actually has: displays
  with bounds and scale factor, OS media-access statuses, device enumeration, recorder
  support. It loads the app origin because `navigator.mediaDevices` only exists in a
  secure context.
- `scripts/hardware-acceptance.mjs` — runs the packaged binary under remote debugging,
  drives the app's own picker with real pointer events, and measures each capture.
- `scripts/webm-inspect.mjs` — reads the EBML tree out of a `.webm` and reports the
  declared frame size, codecs and duration without involving the app or a browser.

Two harness bugs worth recording, because both produced convincing false results before
they were caught: a scripted `element.click()` carries no user activation, so display
capture never started; and the packaged window is shorter than the recorder page, so a
click computed from the element's own coordinates landed outside the viewport and did
nothing while the harness still reported "clicked".
