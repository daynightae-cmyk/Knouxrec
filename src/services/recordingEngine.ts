import type { RecorderSettings } from "../state/types";
import { patchWebmDuration } from "./webm";

export type CaptureMode = "screen" | "window" | "webcam";

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
}

const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4",
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

function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      /* noop */
    }
  });
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
    return new MediaStream(this.active.stream.getVideoTracks());
  }

  async start(request: CaptureRequest): Promise<{ width: number; height: number }> {
    if (this.active) throw new Error("A recording is already in progress.");

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
      await audioContext?.close().catch(() => undefined);
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
      await active.audioContext?.close().catch(() => undefined);
      this.active = null;
    }

    if (blob.size === 0) {
      throw new Error("The recorder produced an empty file. Nothing was saved.");
    }

    const patched = await patchWebmDuration(blob, durationMs);
    const thumbnail = await createThumbnailFromBlob(patched);
    return {
      blob: patched,
      mimeType: patched.type || active.mimeType,
      durationMs,
      width: active.width,
      height: active.height,
      thumbnail,
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
    active.audioContext?.close().catch(() => undefined);
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
 * Re-encodes a slice of media by playing it back into a capture stream.
 * This is a real trim (frame-accurate playback range), not metadata surgery.
 */
/**
 * Re-encodes a slice of media by playing it back into a capture stream.
 *
 * Chromium occasionally delivers no frame at all to a media-element capture
 * stream when playback starts before the first picture is composited, which
 * produced an empty file from a perfectly good source. The single retry is
 * bounded and only happens when nothing was captured; the second attempt waits
 * for a rendered frame before recording.
 */
export async function trimMedia(
  source: Blob,
  start: number,
  end: number,
  onProgress?: (fraction: number) => void,
): Promise<Blob> {
  const first = await trimMediaOnce(source, start, end, onProgress, false);
  if (first.size > 0) return first;
  return trimMediaOnce(source, start, end, onProgress, true);
}

async function trimMediaOnce(
  source: Blob,
  start: number,
  end: number,
  onProgress: ((fraction: number) => void) | undefined,
  waitForFrame: boolean,
): Promise<Blob> {
  if (!(end > start)) throw new Error("The trim range is empty.");
  const media = document.createElement(source.type.startsWith("audio") ? "audio" : "video");
  const url = URL.createObjectURL(source);
  media.src = url;
  media.preload = "auto";
  media.muted = true;

  type CapturableMedia = HTMLMediaElement & {
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
  };
  const capturable = media as CapturableMedia;
  const capture = (capturable.captureStream ?? capturable.mozCaptureStream)?.bind(
    capturable,
  ) as (() => MediaStream) | undefined;

  if (!capture) {
    URL.revokeObjectURL(url);
    throw new Error("This runtime cannot re-encode media in the browser.");
  }

  await new Promise<void>((resolve, reject) => {
    media.onloadedmetadata = () => resolve();
    media.onerror = () => reject(new Error("The media file could not be decoded."));
  });

  const mimeType = source.type.includes("mp4")
    ? pickMimeType() || "video/webm"
    : source.type || "video/webm";

  const stream = capture.call(media);
  if (stream.getVideoTracks().length === 0 && "mozCaptureStream" in media) {
    // Firefox fallback
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
  await media.play();
  if (waitForFrame) {
    // Second attempt: do not start consuming until a picture is actually
    // composited, which is what the first attempt can miss.
    await new Promise<void>((resolve) => {
      const frameAware = media as HTMLVideoElement & {
        requestVideoFrameCallback?: (callback: () => void) => number;
      };
      const timer = window.setTimeout(resolve, 1500);
      const done = () => {
        window.clearTimeout(timer);
        resolve();
      };
      if (typeof frameAware.requestVideoFrameCallback === "function") {
        frameAware.requestVideoFrameCallback(() => done());
      } else {
        media.addEventListener("timeupdate", done, { once: true });
      }
    });
  }
  onProgress?.(0);

  const tick = window.setInterval(() => {
    const fraction = Math.min(1, Math.max(0, (media.currentTime - start) / duration));
    onProgress?.(fraction);
  }, 200);

  await new Promise<void>((resolve) => {
    media.onended = () => resolve();
    window.setTimeout(resolve, duration * 1000 + 4000);
  });

  window.clearInterval(tick);
  media.pause();
  if (recorder.state !== "inactive") recorder.stop();
  stream.getTracks().forEach((track) => {
    try {
      track.stop();
    } catch {
      /* noop */
    }
  });
  URL.revokeObjectURL(url);
  onProgress?.(1);

  const blob = await result;
  return blob.size ? patchWebmDuration(blob, duration * 1000) : blob;
}
