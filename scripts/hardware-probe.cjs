/**
 * KNOUX REC — real hardware probe (read-only).
 *
 * Asks the exact runtime that performs capture — Electron + Chromium — what the
 * machine actually has, instead of trusting a WMI query or a fake device flag.
 * Reports displays with real bounds and scale factor, every media device with
 * its kind and id, whether permission grants labels, and what MediaRecorder can
 * encode. Writes nothing and records nothing.
 *
 * Run: npx electron scripts/hardware-probe.cjs
 */
const { app, BrowserWindow, screen, systemPreferences } = require("electron");

app.commandLine.appendSwitch("enable-media-stream");

const probe = `
(async () => {
  const out = { mediaDevices: [], enumerateError: null, recorderMimeTypes: {}, getUserMedia: {}, secureContext: window.isSecureContext };
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    out.mediaDevices = list.map((d) => ({ kind: d.kind, id: d.deviceId.slice(0, 12), label: d.label || "(no label without permission)" }));
  } catch (error) { out.enumerateError = String(error); }

  for (const mime of [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/webm;codecs=opus",
    "audio/webm;codecs=opus",
    "video/mp4",
  ]) {
    out.recorderMimeTypes[mime] = typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime);
  }

  out.support = {
    getDisplayMedia: typeof navigator.mediaDevices.getDisplayMedia === "function",
    getUserMedia: typeof navigator.mediaDevices.getUserMedia === "function",
  };

  // A real microphone open is the only proof the OS hands this app capture access.
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const tracks = stream.getAudioTracks();
    out.getUserMedia.microphone = { ok: true, tracks: tracks.map((t) => ({ label: t.label, state: t.readyState })) };
    tracks.forEach((t) => t.stop());
  } catch (error) { out.getUserMedia.microphone = { ok: false, name: error.name, message: String(error.message) }; }

  // A real display surface, with its intrinsic pixel size — this is what region
  // cropping is measured against, so a wrong scale factor shows up here.
  try {
    const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const video = document.createElement("video");
    video.srcObject = display;
    video.muted = true;
    await video.play().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 900));
    const settings = display.getVideoTracks()[0]?.getSettings?.() ?? {};
    out.displayCapture = {
      ok: true,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      settings: { width: settings.width, height: settings.height, deviceId: settings.deviceId, displaySurface: settings.displaySurface, logicalSurface: settings.logicalSurface, deviceScaleFactor: settings.deviceScaleFactor },
      audioTracks: display.getAudioTracks().map((t) => t.label || "(system audio track)"),
    };
    display.getTracks().forEach((t) => t.stop());
  } catch (error) { out.displayCapture = { ok: false, name: error.name, message: String(error.message) }; }

  return out;
})()`;

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 800, height: 600, webPreferences: { offscreen: false } });
  // navigator.mediaDevices only exists in a secure context. A data: URL is not
  // one — the first version of this probe died with "cannot read getDisplayMedia
  // of undefined". localhost is potentially trustworthy, and loading the real
  // app origin also means the probe runs in the same environment the product
  // captures from.
  const origin = process.env.KNOUX_PROBE_ORIGIN || "http://localhost:4173/";
  await window.loadURL(origin);
  await new Promise((resolve) => setTimeout(resolve, 2500));

  const displays = screen.getAllDisplays().map((d, i) => ({
    index: i,
    bounds: d.bounds,
    workArea: d.workArea,
    scaleFactor: d.scaleFactor,
    isPrimary: i === 0,
    label: d.label,
  }));

  const page = await window.webContents.executeJavaScript(probe, true);
  const micAccess = (() => {
    try {
      return {
        microphone: systemPreferences.getMediaAccessStatus("microphone"),
        screen: systemPreferences.getMediaAccessStatus("screen"),
        camera: systemPreferences.getMediaAccessStatus("camera"),
      };
    } catch (error) {
      return { error: String(error) };
    }
  })();

  console.log(
    JSON.stringify(
      {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        platform: process.platform,
        windowsRelease: require("os").release(),
        displays,
        micAccess,
        page,
      },
      null,
      2,
    ),
  );
  app.quit();
});
