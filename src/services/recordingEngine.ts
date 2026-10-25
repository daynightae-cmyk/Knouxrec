import type { RecorderSettings } from "../state/types";
import { patchWebmDuration } from "./webm";

export type CaptureMode = "screen" | "window" | "webcam" | "audio";

export interface CaptureSupport {
  display: boolean;
  webcam: boolean;
  microphone: boolean;
  mediaRecorder: boolean;
  systemAudio: boolean;
  reason?: string;
}

export interface CaptureRequest {
  mode: CaptureMode;
  width: number;
  height: number;
  fps: number;
  systemAudio: boolean;
  microphone: boolean;
  webcamOverlay: boolean;
  webcamPosition: RecorderSettings["webcamPosition"];
  webcamSize: RecorderSettings["webcamSize"];
  /** Optional microphone selection for an audio-only session. */
  audioDeviceId?: string | null;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
}

export interface CaptureResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  width: number;
  height: number;
  thumbnail: string | null;
}

interface ActiveCapture {
  recorder: MediaRecorder;
  chunks: Blob[];
  stream: MediaStream;
  ownedStreams: MediaStream[];
  audioContext: AudioContext | null;
  canvasTimer: number | null;
  mimeType: string;
  width: number;
  height: number;
  /** An audio-only session has no frame, so nothing may ask it for one. */
  audioOnly: boolean;
  analyser: AnalyserNode | null;
  levelBuffer: Float32Array | null;
}

const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4",
];

/**
 * Audio-only containers, probed before use. Opus in WebM is what Chromium
 * actually encodes here; the list is walked in order and nothing is promised
 * that `isTypeSupported` has not confirmed.
 */
const AUDIO_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
];

export function detectCaptureSupport(): CaptureSupport {
  if (typeof navigator === "undefined" || !navigator.mediaDevices) {
    return {
      display: false,
      webcam: false,
      microphone: false,
      mediaRecorder: false,
      systemAudio: false,
      reason: "MediaDevices API is not available in this runtime.",
    };
  }
  const display = typeof navigator.mediaDevices.getDisplayMedia === "function";
  const webcam = typeof navigator.mediaDevices.getUserMedia === "function";
  const mediaRecorder = typeof window !== "undefined" && "MediaRecorder" in window;
  return {
    display,
    webcam,
    microphone: webcam,
    mediaRecorder,
    systemAudio: display && mediaRecorder,
    reason: display
      ? undefined
      : "Screen capture is unavailable. Open the desktop build or a Chromium browser.",
  };
}

export function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

/** The container the runtime can really encode for a microphone-only session. */
export function pickAudioMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return AUDIO_MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      /* noop */
    }
  });
}

/**
 * Close an audio graph if there is one that can be closed. A session that
 * failed halfway through building its meter can hold a half-initialised
 * context, and cleanup must never be the thing that throws while a microphone
 * is still open.
 */
function closeAudioContext(context: AudioContext | null): void | Promise<void> {
  if (!context || typeof context.close !== "function") return;
  try {
    return context.close().catch(() => undefined);
  } catch {
    /* noop */
  }
}

async function mixAudioStreams(
  screenStream: MediaStream,
  microphoneStream: MediaStream | null,
): Promise<{ stream: MediaStream; context: AudioContext } | null> {
  const screenAudio = screenStream.getAudioTracks();
  const micAudio = microphoneStream?.getAudioTracks() ?? [];
  if (screenAudio.length === 0 && micAudio.length === 0) return null;

  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();
  if (screenAudio.length > 0) {
    context.createMediaStreamSource(new MediaStream(screenAudio)).connect(destination);
  }
  if (micAudio.length > 0) {
    const micSource = context.createMediaStreamSource(
      new MediaStream(micAudio),
    );
    const gain = context.createGain();
    gain.gain.value = 1;
    micSource.connect(gain).connect(destination);
  }
  if (context.state === "suspended") await context.resume();
  return { stream: destination.stream, context };
}

function webcamRect(
  canvasWidth: number,
  canvasHeight: number,
  size: RecorderSettings["webcamSize"],
  position: RecorderSettings["webcamPosition"],
): { x: number; y: number; w: number; h: number } {
  const fraction = size === "small" ? 0.18 : size === "large" ? 0.32 : 0.24;
  const height = Math.round(canvasHeight * fraction);
  const width = Math.round((height * 4) / 3);
  const margin = Math.round(canvasHeight * 0.03);
  const x =
    position === "topLeft" || position === "bottomLeft"
      ? margin
      : canvasWidth - width - margin;
  const y =
    position === "topLeft" || position === "topRight"
      ? margin
      : canvasHeight - height - margin;
  return { x, y, w: width, h: height };
}

export class RecordingSession {
  private active: ActiveCapture | null = null;
  private startedAt = 0;
  private pausedTotal = 0;
  private pausedAt = 0;

  get isActive(): boolean {
    return this.active !== null;
  }

  previewStream(): MediaStream | null {
    if (!this.active) return null;
    const tracks = this.active.stream.getVideoTracks();
    // An audio-only session has no frame to show; the studio draws a level
    // meter for it instead of an empty video surface.
    if (tracks.length === 0) return null;
    return new MediaStream(tracks);
  }

  /**
   * Peak input level of the live microphone, 0…1, measured from the very same
   * stream that is being encoded. Zero when nothing is recording or the meter
   * could not be built.
   */
  level(): number {
    const active = this.active;
    if (!active?.analyser || !active.levelBuffer) return 0;
    try {
      active.analyser.getFloatTimeDomainData(active.levelBuffer);
    } catch {
      return 0;
    }
    let peak = 0;
    for (let index = 0; index < active.levelBuffer.length; index += 1) {
      const value = Math.abs(active.levelBuffer[index]);
      if (value > peak) peak = value;
    }
    return Math.min(1, peak);
  }

  /**
   * Microphone-only session: no display surface, no compositor, no frame.
   * The container is whatever the runtime admits to encoding, probed rather
   * than assumed.
   */
  private async startAudio(
    request: CaptureRequest,
  ): Promise<{ width: number; height: number }> {
    if (typeof MediaRecorder === "undefined") {
      throw new Error("MediaRecorder is not available in this runtime.");
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone capture is unavailable in this runtime.");
    }
    const mimeType = pickAudioMimeType();
    if (!mimeType) {
      throw new Error("This runtime cannot encode an audio-only recording.");
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: request.echoCancellation ?? true,
          noiseSuppression: request.noiseSuppression ?? true,
          autoGainControl: request.autoGainControl ?? true,
          ...(request.audioDeviceId ? { deviceId: { exact: request.audioDeviceId } } : {}),
        },
        video: false,
      });
    } catch (error) {
      throw new Error(
        `Microphone permission was denied or unavailable: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }

    if (stream.getAudioTracks().length === 0) {
      stopStream(stream);
      throw new Error("The microphone returned no audio track.");
    }

    let context: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let levelBuffer: Float32Array | null = null;
    try {
      context = new AudioContext();
      analyser = context.createAnalyser();
      // 16384 frames is ~340 ms at 48 kHz. A small window would only be
      // honest if the page read it every few milliseconds; a starved page
      // reads ten times a second, and a 21 ms window silently loses every
      // transient that falls between two reads.
      analyser.fftSize = 16384;
      analyser.smoothingTimeConstant = 0;
      // An analyser is only pulled when something downstream consumes it, so
      // the graph ends in a muted gain node: the page never hears the
      // microphone, but the measurement runs.
      const sink = context.createGain();
      sink.gain.value = 0;
      context.createMediaStreamSource(stream).connect(analyser);
      analyser.connect(sink);
      sink.connect(context.destination);
      levelBuffer = new Float32Array(analyser.fftSize);
      await context.resume().catch(() => undefined);
    } catch {
      // Metering is a nicety: a recording must not fail because the analyser
      // could not be built.
      analyser = null;
      levelBuffer = null;
    }

    try {
      const recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 128_000,
      });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };
      this.active = {
        recorder,
        chunks,
        stream,
        ownedStreams: [stream],
        audioContext: context,
        canvasTimer: null,
        mimeType,
        width: 0,
        height: 0,
        audioOnly: true,
        analyser,
        levelBuffer,
      };
      this.startedAt = performance.now();
      this.pausedTotal = 0;
      this.pausedAt = 0;
      recorder.start(1000);
      return { width: 0, height: 0 };
    } catch (error) {
      stopStream(stream);
      await closeAudioContext(context);
      throw error;
    }
  }

  async start(request: CaptureRequest): Promise<{ width: number; height: number }> {
    if (this.active) throw new Error("A recording is already in progress.");

    if (request.mode === "audio") return this.startAudio(request);

    const mimeType = pickMimeType();
    if (!mimeType || typeof MediaRecorder === "undefined") {
      throw new Error("MediaRecorder is not available in this runtime.");
    }

    const ownedStreams: MediaStream[] = [];

    let videoStream: MediaStream;
    if (request.mode === "webcam") {
      videoStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: request.width },
          height: { ideal: request.height },
          frameRate: { ideal: request.fps },
        },
        audio: request.microphone,
      });
    } else {
      videoStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: request.width },
          height: { ideal: request.height },
          frameRate: { ideal: request.fps },
          cursor: "always",
        },
        audio: request.systemAudio,
      });
    }
    ownedStreams.push(videoStream);

    let audioContext: AudioContext | null = null;

    try {
      let microphoneStream: MediaStream | null = null;
      if (request.microphone && request.mode !== "webcam") {
        try {
          microphoneStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
          ownedStreams.push(microphoneStream);
        } catch (error) {
          throw new Error(
            `Microphone permission was denied or unavailable: ${
              error instanceof Error ? error.message : "unknown error"
            }`,
          );
        }
      }

      const videoTrack = videoStream.getVideoTracks()[0];
      const detected = videoTrack?.getSettings?.() ?? {};
      const width = detected.width || request.width;
      const height = detected.height || request.height;

      let outputStream: MediaStream;

      const mixed = await mixAudioStreams(videoStream, microphoneStream);
      if (mixed) {
        audioContext = mixed.context;
        outputStream = new MediaStream([
          ...videoStream.getVideoTracks(),
          ...mixed.stream.getAudioTracks(),
        ]);
      } else {
        outputStream = new MediaStream(videoStream.getVideoTracks());
      }

      let canvasTimer: number | null = null;

      if (request.webcamOverlay && request.mode !== "webcam") {
        let webcamStream: MediaStream;
        try {
          webcamStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
          });
        } catch (error) {
          throw new Error(
            `Webcam overlay requested but camera access failed: ${
              error instanceof Error ? error.message : "unknown error"
            }`,
          );
        }
        ownedStreams.push(webcamStream);

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Unable to create compositor canvas.");

        const screenVideo = document.createElement("video");
        screenVideo.srcObject = videoStream;
        screenVideo.muted = true;
        screenVideo.playsInline = true;
        await screenVideo.play().catch(() => undefined);

        const cameraVideo = document.createElement("video");
        cameraVideo.srcObject = webcamStream;
        cameraVideo.muted = true;
        cameraVideo.playsInline = true;
        await cameraVideo.play().catch(() => undefined);

        let lastCameraTime = -1;
        const draw = () => {
          // The screen frame is always repainted: gating the whole compositor on
          // the camera clock freezes the recorded video whenever the camera
          // stalls or stops producing frames.
          context.drawImage(screenVideo, 0, 0, width, height);
          if (cameraVideo.currentTime === lastCameraTime) return;
          if (cameraVideo.readyState < 2) return;
          const rect = webcamRect(
            width,
            height,
            request.webcamSize,
            request.webcamPosition,
          );
          context.save();
          context.beginPath();
          context.roundRect(rect.x, rect.y, rect.w, rect.h, 24);
          context.clip();
          context.drawImage(cameraVideo, rect.x, rect.y, rect.w, rect.h);
          context.restore();
          context.strokeStyle = "rgba(255, 222, 0, 0.9)";
          context.lineWidth = 4;
          context.beginPath();
          context.roundRect(rect.x, rect.y, rect.w, rect.h, 24);
          context.stroke();
          lastCameraTime = cameraVideo.currentTime;
        };
        const canvasStream = canvas.captureStream(request.fps);
        canvasTimer = window.setInterval(draw, Math.max(16, Math.round(1000 / request.fps)));
        draw();

        const mixedAudio = outputStream.getAudioTracks();
        outputStream = new MediaStream([
          ...canvasStream.getVideoTracks(),
          ...mixedAudio,
        ]);
      }

      const recorder = new MediaRecorder(outputStream, {
        mimeType: mimeType || undefined,
        videoBitsPerSecond: Math.min(
          24_000_000,
          Math.max(1_500_000, width * height * request.fps * 0.07),
        ),
        audioBitsPerSecond: 128_000,
      });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };

      this.active = {
        recorder,
        chunks,
        stream: outputStream,
        ownedStreams,
        audioContext,
        canvasTimer,
        mimeType,
        width,
        height,
        audioOnly: false,
        analyser: null,
        levelBuffer: null,
      };
      this.startedAt = performance.now();
      this.pausedTotal = 0;
      this.pausedAt = 0;

      recorder.start(1000);
      return { width, height };
    } catch (error) {
      // The capture never became active, so this.active is still null and
      // cancel() cannot clean up. Release every acquired stream here instead.
      this.active = null;
      ownedStreams.forEach(stopStream);
      await closeAudioContext(audioContext);
      throw error;
    }
  }

  pause(): void {
    const active = this.active;
    if (!active || active.recorder.state !== "recording") return;
    active.recorder.pause();
    this.pausedAt = performance.now();
  }

  resume(): void {
    const active = this.active;
    if (!active || active.recorder.state !== "paused") return;
    active.recorder.resume();
    if (this.pausedAt > 0) {
      this.pausedTotal += performance.now() - this.pausedAt;
      this.pausedAt = 0;
    }
  }

  elapsedSeconds(): number {
    if (!this.active) return 0;
    const now = this.pausedAt > 0 ? this.pausedAt : performance.now();
    return Math.max(0, (now - this.startedAt - this.pausedTotal) / 1000);
  }

  async stop(): Promise<CaptureResult> {
    const active = this.active;
    if (!active) throw new Error("No recording in progress.");

    const durationMs = Math.max(
      0,
      (this.pausedAt > 0 ? this.pausedAt : performance.now()) -
        this.startedAt -
        this.pausedTotal,
    );

    let blob: Blob;
    try {
      blob = await new Promise<Blob>((resolve, reject) => {
        // A recorder that never fires onstop would otherwise hang the UI in
        // the "stopping" state forever, so the wait is bounded.
        const watchdog = window.setTimeout(() => {
          reject(new Error("The recorder did not finish within 15 seconds."));
        }, 15_000);

        const finish = (value: Blob) => {
          window.clearTimeout(watchdog);
          resolve(value);
        };
        const fail = (error: Error) => {
          window.clearTimeout(watchdog);
          reject(error);
        };

        if (active.recorder.state === "inactive") {
          finish(new Blob(active.chunks, { type: active.mimeType }));
          return;
        }
        active.recorder.onstop = () => {
          finish(new Blob(active.chunks, { type: active.mimeType }));
        };
        active.recorder.onerror = () => fail(new Error("Recording failed."));
        try {
          active.recorder.stop();
        } catch (error) {
          fail(error instanceof Error ? error : new Error("Recording failed."));
        }
      });
    } finally {
      // The capture resources are released whether or not the encoder
      // produced a usable blob.
      if (active.canvasTimer !== null) window.clearInterval(active.canvasTimer);
      active.ownedStreams.forEach(stopStream);
      stopStream(active.stream);
      await closeAudioContext(active.audioContext);
      this.active = null;
    }

    if (blob.size === 0) {
      throw new Error("The recorder produced an empty file. Nothing was saved.");
    }

    const audioOnly = active.audioOnly;
    let patched = blob;
    if (!audioOnly) {
      patched = await patchWebmDuration(blob, durationMs);
    }
    return {
      blob: patched,
      mimeType: patched.type || active.mimeType,
      durationMs,
      width: active.width,
      height: active.height,
      // An audio file has no frame to offer; inventing one would be a colour
      // swatch dressed up as a preview.
      thumbnail: audioOnly ? null : await createThumbnailFromBlob(patched),
    };
  }

  cancel(): void {
    const active = this.active;
    if (!active) return;
    try {
      if (active.recorder.state !== "inactive") active.recorder.stop();
    } catch {
      /* noop */
    }
    if (active.canvasTimer !== null) window.clearInterval(active.canvasTimer);
    active.ownedStreams.forEach(stopStream);
    stopStream(active.stream);
    closeAudioContext(active.audioContext);
    this.active = null;
  }
}

export async function createThumbnailFromBlob(blob: Blob): Promise<string | null> {
  const { createThumbnail } = await import("../lib/format");
  return createThumbnail(blob);
}

export interface ScreenshotOptions {
  format: "png" | "jpeg" | "webp";
  quality: number;
  sourceStream?: MediaStream | null;
  crop?: { x: number; y: number; width: number; height: number } | null;
}

export interface ScreenshotCapture {
  blob: Blob;
  width: number;
  height: number;
  dataUrl: string;
  mimeType: string;
}

export async function captureScreenshot(
  options: ScreenshotOptions,
): Promise<ScreenshotCapture> {
  let stream = options.sourceStream ?? null;
  let owned = false;

  if (!stream) {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error("Screen capture is not available in this runtime.");
    }
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: 3840 }, height: { ideal: 2160 } },
      audio: false,
    });
    owned = true;
  }

  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;

  try {
    await video.play().catch(() => undefined);
    if (!video.videoWidth) {
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        video.onloadedmetadata = done;
        window.setTimeout(done, 3000);
      });
    }
    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    if (!sourceWidth || !sourceHeight) {
      throw new Error("The capture stream did not provide any video frames.");
    }
    const crop = options.crop;
    const width = Math.max(1, Math.round(crop?.width ?? sourceWidth));
    const height = Math.max(1, Math.round(crop?.height ?? sourceHeight));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to create screenshot canvas.");
    context.drawImage(
      video,
      crop?.x ?? 0,
      crop?.y ?? 0,
      crop?.width ?? sourceWidth,
      crop?.height ?? sourceHeight,
      0,
      0,
      width,
      height,
    );
    const mimeType = `image/${options.format}`;
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, mimeType, options.quality),
    );
    if (!blob) throw new Error("The browser could not encode the screenshot.");
    const dataUrl = canvas.toDataURL(mimeType, options.quality);
    return { blob, width, height, dataUrl, mimeType };
  } finally {
    video.pause();
    video.srcObject = null;
    if (owned) stopStream(stream);
  }
}

/**
 * Re-encodes a slice of media into a new file.
 *
 * Video is bridged through a canvas for a reason measured in the field: a
 * `captureStream()` taken straight from a detached media element occasionally
 * delivers no frames to the encoder at all — playback reports `playing` and then
 * `ended`, while the recorder receives a single zero-byte chunk — and the result
 * was an empty file from a perfectly good source. Drawing the video into a
 * canvas and capturing that canvas does not depend on whether the compositor
 * granted the element a surface. The canvas is captured at a fixed rate while it
 * is being drawn: a manual `captureStream(0)` was measured calling
 * `requestFrame()` thirty-six times and still handing the recorder nothing.
 * Audio-only sources keep the element stream, which has no such failure mode.
 *
 * The slice also ends where it was asked to: playback pauses at `end` instead of
 * running to the end of the file and relabelling the container afterwards.
 */
export async function trimMedia(
  source: Blob,
  start: number,
  end: number,
  onProgress?: (fraction: number) => void,
): Promise<Blob> {
  const requested = Math.max(0.1, end - start);
  let lastError: Error | null = null;
  // The second attempt is not the same attempt twice. A capture session that
  // starves while driven by animation frames is retried with a timer-paced
  // painter and a short pre-roll, which is the condition it starved under.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const clip = await trimMediaOnce(source, start, end, onProgress, {
        timerPaced: attempt > 1,
      });
      const measured = await measureMediaDuration(clip);
      // A session that started before the first frame was painted produces a
      // clip materially shorter than the range asked for. That is retried
      // rather than relabelled with the requested duration.
      if (measured === null || measured >= requested * 0.8) return clip;
      lastError = new Error(
        `The trim produced a ${measured.toFixed(2)} s clip for a ${requested.toFixed(2)} s range.`,
      );
    } catch (cause) {
      lastError = cause instanceof Error ? cause : new Error(String(cause));
    }
  }
  throw lastError ?? new Error("The trim produced no media.");
}

/** Real playable duration of a produced file, or null when it reports none. */
async function measureMediaDuration(blob: Blob): Promise<number | null> {
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<number | null>((resolve) => {
      const media = document.createElement(blob.type.startsWith("audio") ? "audio" : "video");
      const timer = window.setTimeout(() => resolve(null), 3000);
      media.preload = "metadata";
      media.onloadedmetadata = () => {
        window.clearTimeout(timer);
        const value = media.duration;
        resolve(Number.isFinite(value) && value > 0 ? value : null);
      };
      media.onerror = () => {
        window.clearTimeout(timer);
        resolve(null);
      };
      media.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function trimMediaOnce(
  source: Blob,
  start: number,
  end: number,
  onProgress: ((fraction: number) => void) | undefined,
  options: { timerPaced?: boolean } = {},
): Promise<Blob> {
  if (!(end > start)) throw new Error("The trim range is empty.");
  const isAudioSource = source.type.startsWith("audio");
  const media = document.createElement(isAudioSource ? "audio" : "video");
  const url = URL.createObjectURL(source);
  media.src = url;
  media.preload = "auto";
  media.muted = true;
  if (!isAudioSource) {
    (media as HTMLVideoElement).playsInline = true;
    // Attached but invisible: an element in the document is decoded and
    // presented reliably, and it also stays measurable by requestFrame below.
    media.style.cssText =
      "position:fixed;left:-4px;top:-4px;width:2px;height:2px;opacity:0;pointer-events:none";
    document.body.appendChild(media);
  }

  type CapturableMedia = HTMLMediaElement & {
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
  };
  const capturable = media as CapturableMedia;
  const elementCapture = (capturable.captureStream ?? capturable.mozCaptureStream)?.bind(
    capturable,
  ) as (() => MediaStream) | undefined;
  if (!elementCapture) {
    URL.revokeObjectURL(url);
    media.remove();
    throw new Error("This runtime cannot re-encode media in the browser.");
  }

  // The compositor surface is created inside the try block; cleanup has to be
  // able to release it from outside.
  let surfaceCanvas: HTMLCanvasElement | null = null;
  const cleanup = () => {
    surfaceCanvas?.remove();
    surfaceCanvas = null;
    media.pause();
    media.removeAttribute("src");
    media.load();
    media.remove();
    URL.revokeObjectURL(url);
  };

  try {
    await new Promise<void>((resolve, reject) => {
      media.onloadedmetadata = () => resolve();
      media.onerror = () => reject(new Error("The media file could not be decoded."));
    });

    const mimeType = source.type.includes("mp4")
      ? pickMimeType() || "video/webm"
      : source.type || "video/webm";

    const video = media as HTMLVideoElement;
    const hasPicture = !isAudioSource && video.videoWidth > 0 && video.videoHeight > 0;

    let stream: MediaStream;
    let canvas: HTMLCanvasElement | null = null;
    let context: CanvasRenderingContext2D | null = null;

    if (hasPicture) {
      canvas = document.createElement("canvas");
      const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(2, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(2, Math.round(video.videoHeight * scale));
      // Attached but invisible, like the decoder above it. A detached canvas
      // can be drawn without the compositor ever sampling it, which shows up
      // as "frames painted, zero chunks" in the encoder — the same failure the
      // video element had before it was attached.
      canvas.style.cssText =
        "position:fixed;left:-4px;top:-4px;width:2px;height:2px;opacity:0;pointer-events:none";
      document.body.appendChild(canvas);
      surfaceCanvas = canvas;
      context = canvas.getContext("2d", { willReadFrequently: false });
      if (!context) throw new Error("The 2D canvas context is unavailable.");
      // A fixed rate is the configuration Chromium reliably feeds to
      // MediaRecorder from a canvas; the manual rate-0 mode was measured
      // delivering nothing at all despite explicit frame requests.
      stream = canvas.captureStream(30);
    } else {
      stream = elementCapture.call(media);
    }

    const recorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported(mimeType) ? mimeType : undefined,
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    const duration = Math.max(0.1, end - start);
    media.currentTime = start;
    await new Promise<void>((resolve) => {
      media.onseeked = () => resolve();
      window.setTimeout(resolve, 2500);
    });

    const result = new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
      recorder.onerror = () => reject(new Error("The trim encoder failed."));
    });

    recorder.start(250);
    // A pre-roll on the retry: the compositor needs a painted frame before it
    // starts sampling, and starting playback in the same task can mean the
    // first sample never happens.
    if (options.timerPaced) {
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
    await media.play();
    onProgress?.(0);

    let raf = 0;
    let timer = 0;
    let stopped = false;
    let painted = 0;
    const stopCapture = () => {
      if (stopped) return;
      stopped = true;
      if (raf) window.cancelAnimationFrame(raf);
      if (timer) window.clearInterval(timer);
      media.pause();
      if (recorder.state !== "inactive") recorder.stop();
    };

    const report = () => {
      const fraction = Math.min(1, Math.max(0, (media.currentTime - start) / duration));
      onProgress?.(fraction);
    };

    if (canvas && context) {
      const drawFrame = () => {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        painted += 1;
        report();
      };
      const paint = () => {
        if (stopped) return;
        drawFrame();
        if (media.currentTime >= end || media.ended) {
          // The boundary frame has just been drawn; stop exactly here.
          stopCapture();
          return;
        }
        raf = window.requestAnimationFrame(paint);
      };
      if (options.timerPaced) {
        // Twenty frames a second driven by a timer, not by animation frames:
        // a starved page still paints, so the sampler always has a fresh
        // surface to read.
        const tick = () => {
          if (stopped) return;
          drawFrame();
          if (media.currentTime >= end || media.ended) stopCapture();
        };
        timer = window.setInterval(tick, 50);
      } else {
        paint();
      }
    } else {
      const tick = window.setInterval(report, 150);
      media.addEventListener("ended", () => {
        window.clearInterval(tick);
        stopCapture();
      });
      window.setTimeout(() => {
        window.clearInterval(tick);
        stopCapture();
      }, duration * 1000 + 2000);
    }

    // Watchdog: a stalled decoder must not hang the job forever.
    const watchdog = window.setTimeout(stopCapture, duration * 1000 + 8000);
    while (!stopped) {
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    window.clearTimeout(watchdog);

    onProgress?.(1);
    stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        /* noop */
      }
    });

    const blob = await result;
    if (!blob.size) {
      // Both halves are named because they fail for different reasons: a paint
      // count of zero means the decoder never presented a frame, a zero chunk
      // count with a live paint count means the capture session was starved.
      const tracks = stream.getVideoTracks();
      const track = tracks[0];
      throw new Error(
        `The trim captured no media (${painted} frames painted, ${chunks.length} chunks, ` +
          `recorder ${recorder.state}, ${tracks.length} track(s) ` +
          `${track ? track.readyState : "none"}, ` +
          `media ${video.readyState} at ${video.currentTime.toFixed(2)}s).`,
      );
    }
    return patchWebmDuration(blob, duration * 1000);
  } finally {
    cleanup();
  }
}
