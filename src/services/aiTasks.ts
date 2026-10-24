/**
 * Deterministic on-device tasks for the AI workspace.
 *
 * The 38 catalog entries describe a mix of model-based tasks and ordinary
 * media operations. The operations below are the ones that can be performed
 * correctly with standard algorithms — audio decoding, DSP, canvas pixel
 * maths, container analysis — so they run for real without pretending a model
 * exists. Model-based tasks are not listed here and stay blocked until their
 * weight files exist.
 *
 * Every result is a real Blob produced by the browser: WAV files written from
 * decoded PCM, PNG canvases, WebM video encoded by MediaRecorder, and JSON
 * reports computed from the actual bytes.
 */

import {
  detectContainer,
  detectSilence,
  encodeWav,
  histogramDistance,
  luminanceHistogram,
  meanAbsoluteDifference,
  mixToMono,
  parseWavHeader,
  pitchShiftPhaseVocoder,
  profileNoise,
  resampleLinear,
  reverseChannels,
  rmsWindows,
  shannonEntropy,
  sobelEdges,
  spectrogram,
  spectrogramColor,
  toGrayscale,
  toHex,
  downscaleGray,
  type GrayImage,
} from "./aiDsp";

export type AiTaskOutputKind = "image" | "audio" | "video" | "text" | "json";

export interface AiOutputPart {
  name: string;
  blob: Blob;
  mimeType: string;
  kind: AiTaskOutputKind;
  width?: number;
  height?: number;
  duration?: number;
}

export interface AiTaskResult {
  taskId: string;
  engine: string;
  summary: string;
  parts: AiOutputPart[];
  metrics: Record<string, unknown>;
}

export type AiParamValue = number | string;

export interface AiTaskRequest {
  taskId: string;
  file: File;
  params: Record<string, AiParamValue>;
  signal?: AbortSignal;
  onProgress?: (ratio: number, stage: string) => void;
}

export class AiTaskError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AiTaskError";
    this.code = code;
  }
}

function numberParam(
  params: Record<string, AiParamValue>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = params[key];
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function stringParam(
  params: Record<string, AiParamValue>,
  key: string,
  fallback: string,
): string {
  const raw = params[key];
  return typeof raw === "string" && raw.length > 0 ? raw : fallback;
}

function ensureNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new AiTaskError("CANCELLED", "The task was cancelled.");
  }
}

function report(
  onProgress: AiTaskRequest["onProgress"],
  ratio: number,
  stage: string,
): void {
  onProgress?.(Math.max(0, Math.min(1, ratio)), stage);
}

async function yieldToUi(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function baseName(file: File): string {
  return file.name.replace(/\.[^.]+$/, "").replace(/[^\w\-.\u0600-\u06FF ]+/g, "-") || "task";
}

/* ------------------------------------------------------------------ audio */

interface DecodedAudio {
  channels: Float32Array[];
  sampleRate: number;
  duration: number;
}

async function decodeAudioFile(file: File): Promise<DecodedAudio> {
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    throw new AiTaskError("UNSUPPORTED_INPUT", "The input file could not be read.");
  }
  if (buffer.byteLength === 0) {
    throw new AiTaskError("EMPTY_INPUT", "The input file is empty.");
  }
  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    throw new AiTaskError("MISSING_ENGINE", "The Web Audio API is not available.");
  }
  let context: AudioContext | null = null;
  try {
    // Chrome's decodeAudioData resamples to the AudioContext rate. When the
    // source is PCM WAV we know the real rate from the header, so ask for a
    // context at that rate and keep the samples untouched.
    let declaredRate: number | undefined;
    try {
      const header = parseWavHeader(new Uint8Array(await file.slice(0, 64).arrayBuffer()));
      if (header && header.sampleRate >= 8000 && header.sampleRate <= 192000) {
        declaredRate = header.sampleRate;
      }
    } catch {
      // not a WAV or unreadable header — use the default rate
    }
    try {
      context = declaredRate
        ? new AudioContextCtor({ sampleRate: declaredRate })
        : new AudioContextCtor();
    } catch {
      context = new AudioContextCtor();
    }
    const audioBuffer = await context.decodeAudioData(buffer.slice(0));
    const channels: Float32Array[] = [];
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
      channels.push(audioBuffer.getChannelData(channel).slice());
    }
    return {
      channels,
      sampleRate: audioBuffer.sampleRate,
      duration: audioBuffer.duration,
    };
  } catch {
    throw new AiTaskError(
      "DECODE_FAILED",
      "The browser could not decode an audio track from this file. Use a WAV, MP3, Ogg, AAC/M4A or a video container with a supported audio track.",
    );
  } finally {
    await context?.close().catch(() => undefined);
  }
}

async function applyBiquad(
  audio: DecodedAudio,
  type: BiquadFilterType,
  frequency: number,
  q: number,
): Promise<DecodedAudio> {
  const OfflineCtor =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  if (!OfflineCtor) {
    throw new AiTaskError("MISSING_ENGINE", "Offline audio rendering is not available.");
  }
  const length = audio.channels[0]?.length ?? 0;
  if (length === 0) throw new AiTaskError("EMPTY_INPUT", "The decoded audio is empty.");
  const context = new OfflineCtor(audio.channels.length, length, audio.sampleRate);
  const buffer = context.createBuffer(audio.channels.length, length, audio.sampleRate);
  audio.channels.forEach((channel, index) => buffer.copyToChannel(channel, index));
  const source = context.createBufferSource();
  source.buffer = buffer;
  const filter = context.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  source.connect(filter);
  filter.connect(context.destination);
  source.start(0);
  const rendered = await context.startRendering();
  const channels: Float32Array[] = [];
  for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
    channels.push(rendered.getChannelData(channel).slice());
  }
  return { channels, sampleRate: audio.sampleRate, duration: audio.duration };
}

function wavPart(name: string, audio: DecodedAudio, channels: Float32Array[]): AiOutputPart {
  const wav = encodeWav(channels, audio.sampleRate);
  const blob = new Blob([wav], { type: "audio/wav" });
  return {
    name: `${name}.wav`,
    blob,
    mimeType: "audio/wav",
    kind: "audio",
    duration: (channels[0]?.length ?? 0) / audio.sampleRate,
  };
}

/* ------------------------------------------------------------------ video */

interface LoadedVideo {
  video: HTMLVideoElement;
  cleanup: () => void;
}

async function loadVideo(file: File): Promise<LoadedVideo> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  const cleanup = () => {
    try {
      video.pause();
    } catch {
      // ignore
    }
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  };
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new AiTaskError("DECODE_FAILED", "The video metadata did not load in time."));
    }, 20000);
    video.onloadedmetadata = () => {
      window.clearTimeout(timer);
      resolve();
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      cleanup();
      reject(
        new AiTaskError(
          "DECODE_FAILED",
          "The browser could not decode this video. Use a WebM, MP4 or Ogg container supported by Chromium.",
        ),
      );
    };
  });

  // MediaRecorder output (and many screen recordings) carries no duration in
  // the header, so the element reports Infinity. Seeking far past the end makes
  // Chromium scan the clusters and publish the real duration.
  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const onDuration = () => {
        if (Number.isFinite(video.duration) && video.duration > 0) finish();
      };
      video.addEventListener("durationchange", onDuration);
      video.addEventListener("seeked", finish, { once: true });
      window.setTimeout(finish, 5000);
      try {
        video.currentTime = 1e9;
      } catch {
        finish();
      }
    });
  }
  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    cleanup();
    throw new AiTaskError(
      "DECODE_FAILED",
      "The video duration could not be determined; the container may be truncated or still being written.",
    );
  }

  // Make sure a frame is decoded before the first grab or play().
  if (video.readyState < 2) {
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      video.addEventListener("loadeddata", finish, { once: true });
      video.addEventListener("seeked", finish, { once: true });
      window.setTimeout(finish, 5000);
      try {
        video.currentTime = 0.001;
      } catch {
        finish();
      }
    });
  }

  return { video, cleanup };
}

function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const target = Math.max(0, Math.min(Math.max(0, video.duration - 0.05), time));
    if (Math.abs(video.currentTime - target) < 0.001 && video.readyState >= 2) {
      resolve();
      return;
    }
    const timer = window.setTimeout(() => {
      video.removeEventListener("seeked", onSeeked);
      reject(new AiTaskError("DECODE_FAILED", "Seeking the video timed out."));
    }, 15000);
    const onSeeked = () => {
      window.clearTimeout(timer);
      resolve();
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.currentTime = target;
  });
}

interface VideoSize {
  width: number;
  height: number;
}

function boundedVideoSize(video: HTMLVideoElement, maxWidth: number): VideoSize {
  const sourceWidth = video.videoWidth || 640;
  const sourceHeight = video.videoHeight || 360;
  const scale = Math.min(1, maxWidth / sourceWidth);
  return {
    width: Math.max(2, Math.round(sourceWidth * scale)),
    height: Math.max(2, Math.round(sourceHeight * scale)),
  };
}

function grabGray(video: HTMLVideoElement, size: VideoSize): GrayImage {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new AiTaskError("MISSING_ENGINE", "Canvas 2D is not available.");
  context.drawImage(video, 0, 0, size.width, size.height);
  const data = context.getImageData(0, 0, size.width, size.height);
  return toGrayscale(data.data, size.width, size.height);
}

function makeCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
} {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext("2d");
  if (!context) throw new AiTaskError("MISSING_ENGINE", "Canvas 2D is not available.");
  return { canvas, context };
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new AiTaskError("ENCODE_FAILED", "The canvas could not be encoded as PNG."));
    }, "image/png");
  });
}

function drawLabel(context: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  context.save();
  context.font = "600 12px system-ui, sans-serif";
  const width = context.measureText(text).width + 10;
  context.fillStyle = "rgba(4, 6, 14, 0.72)";
  context.fillRect(x, y, width, 20);
  context.fillStyle = "#f4f7ff";
  context.fillText(text, x + 5, y + 14);
  context.restore();
}

function contactSheet(
  thumbnails: Array<{ canvas: HTMLCanvasElement; label: string }>,
): Promise<Blob> {
  const columns = Math.max(1, Math.ceil(Math.sqrt(thumbnails.length)));
  const rows = Math.max(1, Math.ceil(thumbnails.length / columns));
  const thumbWidth = thumbnails[0]?.canvas.width ?? 320;
  const thumbHeight = thumbnails[0]?.canvas.height ?? 180;
  const gap = 8;
  const { canvas, context } = makeCanvas(
    columns * thumbWidth + (columns + 1) * gap,
    rows * thumbHeight + (rows + 1) * gap,
  );
  context.fillStyle = "#070912";
  context.fillRect(0, 0, canvas.width, canvas.height);
  thumbnails.forEach((thumbnail, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = gap + column * (thumbWidth + gap);
    const y = gap + row * (thumbHeight + gap);
    context.drawImage(thumbnail.canvas, x, y);
    drawLabel(context, thumbnail.label, x + 4, y + thumbHeight - 24);
  });
  return canvasToBlob(canvas);
}

async function renderFrame(
  video: HTMLVideoElement,
  size: VideoSize,
): Promise<HTMLCanvasElement> {
  const { canvas, context } = makeCanvas(size.width, size.height);
  context.drawImage(video, 0, 0, size.width, size.height);
  return canvas;
}

/* --------------------------------------------------------------- analyzer */

async function analyzeFile(file: File): Promise<AiTaskResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const container = detectContainer(bytes);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = toHex(new Uint8Array(digest));
  let nullBytes = 0;
  let printable = 0;
  for (const byte of bytes) {
    if (byte === 0) nullBytes += 1;
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte < 127)) {
      printable += 1;
    }
  }
  const textPreview =
    bytes.length > 0 && printable / bytes.length > 0.85
      ? Array.from(bytes.slice(0, 2000))
          .filter(
            (byte) => byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte < 127),
          )
          .map((byte) => String.fromCharCode(byte))
          .join("")
          .replace(/\s+/g, " ")
          .trim()
      : "";
  const report = {
    fileName: file.name,
    sizeBytes: bytes.length,
    declaredMime: file.type || "(none)",
    detectedFormat: container.format,
    detectedMime: container.mimeType,
    sha256: hash,
    entropyBitsPerByte: shannonEntropy(bytes),
    nullByteRatio: bytes.length > 0 ? nullBytes / bytes.length : 0,
    printableRatio: bytes.length > 0 ? printable / bytes.length : 0,
    first32BytesHex: toHex(bytes.slice(0, 32)),
    textPreview,
  };
  return {
    taskId: "file_analyzer",
    engine: "Container sniffing + Web Crypto SHA-256",
    summary: `${container.format} · ${bytes.length} bytes · sha256 ${hash.slice(0, 16)}…`,
    parts: [
      {
        name: `${baseName(file)}-analysis.json`,
        blob: new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
        mimeType: "application/json",
        kind: "json",
      },
    ],
    metrics: report,
  };
}

/* ------------------------------------------------------------------ tasks */

export const DETERMINISTIC_TASK_IDS = [
  "extract_audio",
  "reverse_audio",
  "audio_converter",
  "frequency_filter",
  "generate_spectrogram",
  "detect_silence",
  "noise_profiler",
  "change_pitch",
  "edge_detection",
  "extract_frames",
  "analyze_fps",
  "extract_scenes",
  "detect_motion",
  "video_filters",
  "file_analyzer",
] as const;

export type DeterministicTaskId = (typeof DETERMINISTIC_TASK_IDS)[number];

export function isDeterministicTask(taskId: string): taskId is DeterministicTaskId {
  return (DETERMINISTIC_TASK_IDS as readonly string[]).includes(taskId);
}

export async function runDeterministicTask(request: AiTaskRequest): Promise<AiTaskResult> {
  const { taskId, file, params, signal, onProgress } = request;
  ensureNotAborted(signal);
  if (file.size === 0) {
    throw new AiTaskError("EMPTY_INPUT", "The input file is empty.");
  }

  switch (taskId) {
    case "file_analyzer":
      report(onProgress, 0.2, "read");
      return analyzeFile(file);

    case "extract_audio": {
      report(onProgress, 0.1, "decode");
      const audio = await decodeAudioFile(file);
      ensureNotAborted(signal);
      report(onProgress, 0.7, "encode");
      await yieldToUi();
      const part = wavPart(`${baseName(file)}-audio`, audio, audio.channels);
      return {
        taskId,
        engine: "Web Audio decodeAudioData + PCM WAV encoder",
        summary: `${audio.duration.toFixed(2)}s · ${audio.sampleRate} Hz · ${audio.channels.length} channel(s)`,
        parts: [part],
        metrics: {
          durationSeconds: audio.duration,
          sampleRate: audio.sampleRate,
          channels: audio.channels.length,
          bytes: part.blob.size,
        },
      };
    }

    case "reverse_audio": {
      report(onProgress, 0.1, "decode");
      const audio = await decodeAudioFile(file);
      ensureNotAborted(signal);
      report(onProgress, 0.55, "process");
      const reversed = reverseChannels(audio.channels);
      await yieldToUi();
      report(onProgress, 0.8, "encode");
      const part = wavPart(`${baseName(file)}-reversed`, audio, reversed);
      return {
        taskId,
        engine: "Sample reversal + PCM WAV encoder",
        summary: `Reversed ${audio.duration.toFixed(2)}s of audio sample-by-sample.`,
        parts: [part],
        metrics: { durationSeconds: audio.duration, sampleRate: audio.sampleRate, bytes: part.blob.size },
      };
    }

    case "audio_converter": {
      report(onProgress, 0.1, "decode");
      const audio = await decodeAudioFile(file);
      ensureNotAborted(signal);
      const targetRate = numberParam(params, "sampleRate", 48000, 8000, 192000);
      report(onProgress, 0.5, "process");
      const channels = audio.channels.map((channel) =>
        resampleLinear(channel, audio.sampleRate, targetRate),
      );
      await yieldToUi();
      report(onProgress, 0.8, "encode");
      const converted: DecodedAudio = {
        channels,
        sampleRate: targetRate,
        duration: audio.duration,
      };
      const part = wavPart(`${baseName(file)}-${Math.round(targetRate / 1000)}k`, converted, channels);
      return {
        taskId,
        engine: "Web Audio decode + linear resample + PCM WAV encoder",
        summary: `Converted to ${targetRate} Hz · ${channels.length} channel(s) · ${(part.blob.size / 1024).toFixed(1)} KB`,
        parts: [part],
        metrics: {
          sourceSampleRate: audio.sampleRate,
          targetSampleRate: targetRate,
          channels: channels.length,
          durationSeconds: audio.duration,
          bytes: part.blob.size,
        },
      };
    }

    case "frequency_filter": {
      report(onProgress, 0.1, "decode");
      const audio = await decodeAudioFile(file);
      ensureNotAborted(signal);
      const type = stringParam(params, "filterType", "lowpass") as BiquadFilterType;
      const frequency = numberParam(params, "frequency", 1200, 20, 20000);
      const q = numberParam(params, "q", 0.707, 0.1, 30);
      report(onProgress, 0.4, "process");
      const filtered = await applyBiquad(audio, type, frequency, q);
      ensureNotAborted(signal);
      report(onProgress, 0.8, "encode");
      const part = wavPart(`${baseName(file)}-${type}-${Math.round(frequency)}hz`, filtered, filtered.channels);
      return {
        taskId,
        engine: "OfflineAudioContext BiquadFilter",
        summary: `${type} at ${Math.round(frequency)} Hz (Q ${q.toFixed(2)}) applied offline.`,
        parts: [part],
        metrics: {
          filterType: type,
          frequency,
          q,
          durationSeconds: audio.duration,
          sampleRate: audio.sampleRate,
          bytes: part.blob.size,
        },
      };
    }

    case "generate_spectrogram": {
      report(onProgress, 0.1, "decode");
      const audio = await decodeAudioFile(file);
      ensureNotAborted(signal);
      const fftSize = numberParam(params, "fftSize", 1024, 256, 4096);
      const maxSeconds = numberParam(params, "maxSeconds", 30, 1, 600);
      const mono = mixToMono(audio.channels);
      const limit = Math.min(mono.length, Math.round(maxSeconds * audio.sampleRate));
      report(onProgress, 0.35, "process");
      const { bins, frames } = spectrogram(mono.subarray(0, limit), {
        fftSize,
        hopSize: Math.max(64, Math.floor(fftSize / 4)),
      });
      if (frames.length === 0) {
        throw new AiTaskError("EMPTY_INPUT", "The audio is too short for the selected FFT size.");
      }
      ensureNotAborted(signal);
      report(onProgress, 0.7, "render");
      const width = Math.min(1200, frames.length);
      const height = 360;
      const { canvas, context } = makeCanvas(width, height);
      const image = context.createImageData(width, height);
      for (let x = 0; x < width; x += 1) {
        const frameIndex = Math.min(frames.length - 1, Math.floor((x / width) * frames.length));
        const frame = frames[frameIndex];
        for (let y = 0; y < height; y += 1) {
          const bin = Math.min(bins - 1, Math.floor(((height - 1 - y) / height) * bins));
          const magnitude = frame[bin] ?? 0;
          const db = 20 * Math.log10(magnitude + 1e-7);
          const normalized = Math.max(0, Math.min(1, (db + 80) / 80));
          const [r, g, b] = spectrogramColor(normalized);
          const offset = (y * width + x) * 4;
          image.data[offset] = r;
          image.data[offset + 1] = g;
          image.data[offset + 2] = b;
          image.data[offset + 3] = 255;
        }
      }
      context.putImageData(image, 0, 0);
      const blob = await canvasToBlob(canvas);
      return {
        taskId,
        engine: "Radix-2 FFT spectrogram renderer",
        summary: `${frames.length} FFT frames · ${bins} bins · ${(limit / audio.sampleRate).toFixed(2)}s analysed`,
        parts: [
          {
            name: `${baseName(file)}-spectrogram.png`,
            blob,
            mimeType: "image/png",
            kind: "image",
            width,
            height,
          },
        ],
        metrics: {
          fftSize,
          bins,
          frames: frames.length,
          analysedSeconds: limit / audio.sampleRate,
          sampleRate: audio.sampleRate,
        },
      };
    }

    case "detect_silence": {
      report(onProgress, 0.1, "decode");
      const audio = await decodeAudioFile(file);
      const thresholdDb = numberParam(params, "thresholdDb", -40, -90, -5);
      const minSilenceMs = numberParam(params, "minSilenceMs", 300, 20, 10000);
      report(onProgress, 0.5, "analyse");
      const mono = mixToMono(audio.channels);
      const windows = rmsWindows(mono, audio.sampleRate, 50);
      const silence = detectSilence(windows, { thresholdDb, minSilenceMs });
      ensureNotAborted(signal);
      const result = {
        thresholdDb,
        minSilenceMs,
        durationSeconds: audio.duration,
        silenceRatio: silence.silenceRatio,
        intervals: silence.intervals,
      };
      report(onProgress, 0.85, "encode");
      return {
        taskId,
        engine: "RMS window analysis",
        summary: `${silence.intervals.length} silent interval(s) · ${(silence.silenceRatio * 100).toFixed(1)}% of the track`,
        parts: [
          {
            name: `${baseName(file)}-silence.json`,
            blob: new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }),
            mimeType: "application/json",
            kind: "json",
          },
        ],
        metrics: {
          intervals: silence.intervals.length,
          silenceRatio: silence.silenceRatio,
          durationSeconds: audio.duration,
          thresholdDb,
          minSilenceMs,
        },
      };
    }

    case "noise_profiler": {
      report(onProgress, 0.1, "decode");
      const audio = await decodeAudioFile(file);
      report(onProgress, 0.5, "analyse");
      const mono = mixToMono(audio.channels);
      const profile = profileNoise(mono, audio.sampleRate);
      ensureNotAborted(signal);
      report(onProgress, 0.85, "encode");
      return {
        taskId,
        engine: "RMS/peak/crest/SNR analysis",
        summary: `RMS ${profile.rmsDb.toFixed(1)} dB · peak ${profile.peakDb.toFixed(1)} dB · noise floor ${profile.noiseFloorDb.toFixed(1)} dB`,
        parts: [
          {
            name: `${baseName(file)}-noise-profile.json`,
            blob: new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" }),
            mimeType: "application/json",
            kind: "json",
          },
        ],
        metrics: { ...profile },
      };
    }

    case "change_pitch": {
      report(onProgress, 0.1, "decode");
      const audio = await decodeAudioFile(file);
      ensureNotAborted(signal);
      const semitones = numberParam(params, "semitones", 4, -12, 12);
      report(onProgress, 0.4, "process");
      const shifted = audio.channels.map((channel) => pitchShiftPhaseVocoder(channel, semitones));
      await yieldToUi();
      report(onProgress, 0.8, "encode");
      const part = wavPart(`${baseName(file)}-${semitones >= 0 ? "up" : "down"}${Math.abs(semitones)}st`, audio, shifted);
      return {
        taskId,
        engine: "Phase-vocoder time stretch + resample",
        summary: `Pitch shifted ${semitones > 0 ? "+" : ""}${semitones} semitones with duration preserved.`,
        parts: [part],
        metrics: {
          semitones,
          durationSeconds: audio.duration,
          sampleRate: audio.sampleRate,
          bytes: part.blob.size,
        },
      };
    }

    case "edge_detection": {
      report(onProgress, 0.15, "decode");
      const bitmap = await createImageBitmap(file).catch(() => {
        throw new AiTaskError("DECODE_FAILED", "The image could not be decoded.");
      });
      const width = Math.min(1600, bitmap.width);
      const height = Math.max(1, Math.round((width / bitmap.width) * bitmap.height));
      const { canvas, context } = makeCanvas(width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      const source = context.getImageData(0, 0, width, height);
      report(onProgress, 0.45, "process");
      const gray = toGrayscale(source.data, width, height);
      const edges = sobelEdges(gray);
      const threshold = numberParam(params, "threshold", 0.18, 0.01, 1);
      ensureNotAborted(signal);
      report(onProgress, 0.75, "render");
      const output = context.createImageData(width, height);
      let edgePixels = 0;
      for (let index = 0; index < edges.data.length; index += 1) {
        const magnitude = edges.data[index] ?? 0;
        const value = magnitude >= threshold ? 255 : 0;
        if (value > 0) edgePixels += 1;
        const offset = index * 4;
        output.data[offset] = value;
        output.data[offset + 1] = value;
        output.data[offset + 2] = value;
        output.data[offset + 3] = 255;
      }
      context.putImageData(output, 0, 0);
      const blob = await canvasToBlob(canvas);
      return {
        taskId,
        engine: "Sobel gradient operator (3×3)",
        summary: `${edgePixels} edge pixels above ${threshold.toFixed(2)} at ${width}×${height}.`,
        parts: [
          {
            name: `${baseName(file)}-edges.png`,
            blob,
            mimeType: "image/png",
            kind: "image",
            width,
            height,
          },
        ],
        metrics: { width, height, threshold, edgePixels, edgeRatio: edgePixels / (width * height) },
      };
    }

    case "extract_frames": {
      const count = Math.round(numberParam(params, "count", 9, 1, 30));
      const maxWidth = numberParam(params, "maxWidth", 480, 120, 1920);
      report(onProgress, 0.05, "decode");
      const { video, cleanup } = await loadVideo(file);
      try {
        const size = boundedVideoSize(video, maxWidth);
        const duration = video.duration;
        const frames: HTMLCanvasElement[] = [];
        for (let index = 0; index < count; index += 1) {
          ensureNotAborted(signal);
          const time = count === 1 ? duration / 2 : (index / (count - 1)) * Math.max(0, duration - 0.05);
          await seekVideo(video, time);
          frames.push(await renderFrame(video, size));
          report(onProgress, 0.1 + (0.65 * (index + 1)) / count, "extract");
        }
        const sheet = await contactSheet(
          frames.map((frame, index) => ({
            canvas: frame,
            label: `${((index / Math.max(1, count - 1)) * Math.max(0, duration - 0.05)).toFixed(2)}s`,
          })),
        );
        const parts: AiOutputPart[] = [
          {
            name: `${baseName(file)}-contact-sheet.png`,
            blob: sheet,
            mimeType: "image/png",
            kind: "image",
            width: size.width,
            height: size.height,
          },
        ];
        for (let index = 0; index < frames.length; index += 1) {
          const time = count === 1 ? duration / 2 : (index / (count - 1)) * Math.max(0, duration - 0.05);
          const blob = await canvasToBlob(frames[index]);
          parts.push({
            name: `${baseName(file)}-frame-${String(index + 1).padStart(2, "0")}-${time.toFixed(2)}s.png`,
            blob,
            mimeType: "image/png",
            kind: "image",
            width: size.width,
            height: size.height,
          });
        }
        return {
          taskId,
          engine: "HTMLVideoElement seek + canvas frame grab",
          summary: `${frames.length} frames extracted at ${size.width}×${size.height} from ${duration.toFixed(2)}s.`,
          parts,
          metrics: { frames: frames.length, width: size.width, height: size.height, durationSeconds: duration },
        };
      } finally {
        cleanup();
      }
    }

    case "analyze_fps": {
      report(onProgress, 0.1, "decode");
      const { video, cleanup } = await loadVideo(file);
      try {
        const qualityBefore =
          typeof video.getVideoPlaybackQuality === "function"
            ? video.getVideoPlaybackQuality()
            : null;
        const rvfc = (
          video as HTMLVideoElement & {
            requestVideoFrameCallback?: (
              callback: (now: number, metadata: { mediaTime: number }) => void,
            ) => number;
          }
        ).requestVideoFrameCallback;
        let frames = 0;
        let firstMediaTime = -1;
        let lastMediaTime = -1;
        let method = "requestVideoFrameCallback median inter-frame interval";
        const mediaTimes: number[] = [];
        const measureMs = Math.min(1500, Math.max(500, video.duration * 600));
        report(onProgress, 0.3, "measure");

        if (typeof rvfc === "function") {
          await new Promise<void>((resolve) => {
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              try {
                video.pause();
              } catch {
                // ignore
              }
              resolve();
            };
            const onFrame = (_now: number, metadata: { mediaTime: number }) => {
              if (settled) return;
              frames += 1;
              if (firstMediaTime < 0) firstMediaTime = metadata.mediaTime;
              lastMediaTime = metadata.mediaTime;
              mediaTimes.push(metadata.mediaTime);
              if (performance.now() < deadline && !video.ended) {
                rvfc.call(video, onFrame);
              } else {
                finish();
              }
            };
            const deadline = performance.now() + measureMs;
            window.setTimeout(finish, measureMs + 3000);
            video
              .play()
              .then(() => rvfc.call(video, onFrame))
              .catch(finish);
          });
        } else {
          method = "getVideoPlaybackQuality over the measurement window";
          const started = performance.now();
          await video.play().catch(() => undefined);
          await new Promise((resolve) => setTimeout(resolve, measureMs));
          video.pause();
          const elapsed = (performance.now() - started) / 1000;
          const qualityAfter =
            typeof video.getVideoPlaybackQuality === "function"
              ? video.getVideoPlaybackQuality()
              : null;
          if (qualityBefore && qualityAfter) {
            frames = qualityAfter.totalVideoFrames - qualityBefore.totalVideoFrames;
            firstMediaTime = 0;
            lastMediaTime = elapsed;
          }
        }

        const measuredSeconds =
          firstMediaTime >= 0 && lastMediaTime > firstMediaTime
            ? lastMediaTime - firstMediaTime
            : 0;
        // Presentation callbacks can skip frames when the compositor is busy.
        // The median inter-frame interval is the base frame duration; deltas
        // that are multiples of it (dropped frames) are discarded first.
        const deltas: number[] = [];
        for (let index = 1; index < mediaTimes.length; index += 1) {
          const delta = mediaTimes[index] - mediaTimes[index - 1];
          if (delta > 0.001) deltas.push(delta);
        }
        deltas.sort((left, right) => left - right);
        const medianDelta =
          deltas.length > 0 ? deltas[Math.floor(deltas.length / 2)] : 0;
        const baseDeltas =
          medianDelta > 0 ? deltas.filter((delta) => delta <= medianDelta * 3) : deltas;
        const baseFrameDuration =
          baseDeltas.length > 0
            ? baseDeltas[Math.floor(baseDeltas.length / 2)]
            : medianDelta;
        const measuredFps = baseFrameDuration > 0 ? 1 / baseFrameDuration : 0;
        const averageFps =
          frames > 1 && measuredSeconds > 0 ? (frames - 1) / measuredSeconds : 0;
        ensureNotAborted(signal);
        const reportData = {
          durationSeconds: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
          measurementMethod: method,
          framesObserved: frames,
          measuredWindowSeconds: measuredSeconds,
          measuredFps: Number(measuredFps.toFixed(2)),
          baseFrameDurationSeconds: Number(baseFrameDuration.toFixed(5)),
          averageFpsFromFrameCount: Number(averageFps.toFixed(2)),
          playbackQuality: qualityBefore
            ? {
                creationTime: qualityBefore.creationTime,
                totalVideoFrames: qualityBefore.totalVideoFrames,
                droppedVideoFrames: qualityBefore.droppedVideoFrames,
              }
            : null,
        };
        return {
          taskId,
          engine: "requestVideoFrameCallback timing (median frame interval)",
          summary: `Measured ${reportData.measuredFps} fps (${(baseFrameDuration * 1000).toFixed(1)} ms median frame interval over ${reportData.framesObserved} frames).`,
          parts: [
            {
              name: `${baseName(file)}-fps.json`,
              blob: new Blob([JSON.stringify(reportData, null, 2)], { type: "application/json" }),
              mimeType: "application/json",
              kind: "json",
            },
          ],
          metrics: reportData,
        };
      } finally {
        cleanup();
      }
    }

    case "extract_scenes": {
      const samples = Math.round(numberParam(params, "samples", 40, 4, 120));
      const sensitivity = numberParam(params, "sensitivity", 0.35, 0.05, 0.95);
      report(onProgress, 0.05, "decode");
      const { video, cleanup } = await loadVideo(file);
      try {
        const size = boundedVideoSize(video, 320);
        const duration = video.duration;
        const histograms: Float32Array[] = [];
        const thumbnails: HTMLCanvasElement[] = [];
        const times: number[] = [];
        for (let index = 0; index < samples; index += 1) {
          ensureNotAborted(signal);
          const time = (index / Math.max(1, samples - 1)) * Math.max(0, duration - 0.05);
          await seekVideo(video, time);
          const gray = downscaleGray(grabGray(video, size), 64, 36);
          histograms.push(luminanceHistogram(gray, 32));
          times.push(time);
          if (index % Math.max(1, Math.floor(samples / 12)) === 0) {
            thumbnails.push(await renderFrame(video, boundedVideoSize(video, 320)));
          }
          report(onProgress, 0.08 + (0.55 * (index + 1)) / samples, "sample");
        }
        const cuts: Array<{ time: number; score: number }> = [];
        for (let index = 1; index < histograms.length; index += 1) {
          const distance = histogramDistance(histograms[index - 1], histograms[index]);
          if (distance >= sensitivity) cuts.push({ time: times[index], score: distance });
        }
        const boundaries = [0, ...cuts.map((cut) => cut.time), duration];
        const scenes = boundaries.slice(0, -1).map((start, index) => {
          const end = boundaries[index + 1] ?? duration;
          return {
            index: index + 1,
            start: Number(start.toFixed(3)),
            end: Number(end.toFixed(3)),
            duration: Number((end - start).toFixed(3)),
          };
        });
        ensureNotAborted(signal);
        report(onProgress, 0.7, "render");
        const sheet =
          thumbnails.length > 0
            ? await contactSheet(
                thumbnails.map((thumbnail, index) => ({
                  canvas: thumbnail,
                  label: `#${index + 1} · ${(index * (duration / Math.max(1, thumbnails.length))).toFixed(2)}s`,
                })),
              )
            : null;
        const reportData = {
          durationSeconds: duration,
          samples,
          sensitivity,
          sceneCount: scenes.length,
          cuts: cuts.map((cut) => ({ time: Number(cut.time.toFixed(3)), score: Number(cut.score.toFixed(4)) })),
          scenes,
        };
        const parts: AiOutputPart[] = [
          {
            name: `${baseName(file)}-scenes.json`,
            blob: new Blob([JSON.stringify(reportData, null, 2)], { type: "application/json" }),
            mimeType: "application/json",
            kind: "json",
          },
        ];
        if (sheet) {
          parts.push({
            name: `${baseName(file)}-scene-sheet.png`,
            blob: sheet,
            mimeType: "image/png",
            kind: "image",
          });
        }
        return {
          taskId,
          engine: "Luminance histogram cut detection",
          summary: `${scenes.length} scene(s), ${cuts.length} detected cut(s) at sensitivity ${sensitivity}.`,
          parts,
          metrics: reportData,
        };
      } finally {
        cleanup();
      }
    }

    case "detect_motion": {
      const samples = Math.round(numberParam(params, "samples", 60, 4, 120));
      const threshold = numberParam(params, "threshold", 0.04, 0.001, 0.5);
      report(onProgress, 0.05, "decode");
      const { video, cleanup } = await loadVideo(file);
      try {
        const size = boundedVideoSize(video, 320);
        const sampleSize = { width: 64, height: 36 };
        const duration = video.duration;
        const frames: GrayImage[] = [];
        const times: number[] = [];
        for (let index = 0; index < samples; index += 1) {
          ensureNotAborted(signal);
          const time = (index / Math.max(1, samples - 1)) * Math.max(0, duration - 0.05);
          await seekVideo(video, time);
          frames.push(downscaleGray(grabGray(video, size), sampleSize.width, sampleSize.height));
          times.push(time);
          report(onProgress, 0.08 + (0.55 * (index + 1)) / samples, "sample");
        }
        const heatmap = new Float32Array(sampleSize.width * sampleSize.height);
        const timeline: Array<{ time: number; score: number }> = [];
        for (let index = 1; index < frames.length; index += 1) {
          const a = frames[index - 1];
          const b = frames[index];
          for (let pixel = 0; pixel < heatmap.length; pixel += 1) {
            heatmap[pixel] += Math.abs((a.data[pixel] ?? 0) - (b.data[pixel] ?? 0));
          }
          timeline.push({ time: Number(times[index].toFixed(3)), score: Number(meanAbsoluteDifference(a, b).toFixed(5)) });
          if (index % 10 === 0) await yieldToUi();
        }
        let maxHeat = 0;
        for (const value of heatmap) if (value > maxHeat) maxHeat = value;
        report(onProgress, 0.7, "render");
        const { canvas, context } = makeCanvas(sampleSize.width, sampleSize.height);
        const image = context.createImageData(sampleSize.width, sampleSize.height);
        for (let pixel = 0; pixel < heatmap.length; pixel += 1) {
          const normalized = maxHeat > 0 ? heatmap[pixel] / maxHeat : 0;
          const [r, g, b] = spectrogramColor(normalized);
          const offset = pixel * 4;
          image.data[offset] = r;
          image.data[offset + 1] = g;
          image.data[offset + 2] = b;
          image.data[offset + 3] = 255;
        }
        context.putImageData(image, 0, 0);
        const blob = await canvasToBlob(canvas);
        const moving = timeline.filter((entry) => entry.score >= threshold);
        const reportData = {
          durationSeconds: duration,
          samples,
          threshold,
          movingSamples: moving.length,
          movingRatio: timeline.length > 0 ? moving.length / timeline.length : 0,
          peakScore: timeline.reduce((max, entry) => Math.max(max, entry.score), 0),
          timeline,
        };
        ensureNotAborted(signal);
        return {
          taskId,
          engine: "Frame differencing + motion heatmap",
          summary: `${moving.length}/${timeline.length} sampled intervals moved above ${threshold}.`,
          parts: [
            {
              name: `${baseName(file)}-motion.json`,
              blob: new Blob([JSON.stringify(reportData, null, 2)], { type: "application/json" }),
              mimeType: "application/json",
              kind: "json",
            },
            {
              name: `${baseName(file)}-motion-heatmap.png`,
              blob,
              mimeType: "image/png",
              kind: "image",
              width: sampleSize.width,
              height: sampleSize.height,
            },
          ],
          metrics: reportData,
        };
      } finally {
        cleanup();
      }
    }

    case "video_filters": {
      const filter = stringParam(params, "filter", "grayscale");
      const maxDuration = numberParam(params, "maxDuration", 10, 1, 120);
      if (typeof MediaRecorder === "undefined") {
        throw new AiTaskError("MISSING_ENGINE", "MediaRecorder is not available in this runtime.");
      }
      report(onProgress, 0.05, "decode");
      const { video, cleanup } = await loadVideo(file);
      const size = boundedVideoSize(video, 1280);
      const { canvas, context } = makeCanvas(size.width, size.height);
      if (typeof canvas.captureStream !== "function") {
        cleanup();
        throw new AiTaskError("MISSING_ENGINE", "canvas.captureStream is not available.");
      }
      const mimeCandidates = [
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm",
        "video/mp4;codecs=avc1.42E01E",
        "video/mp4",
      ];
      const mimeType = mimeCandidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
      if (!mimeType) {
        cleanup();
        throw new AiTaskError("MISSING_ENGINE", "No supported video encoder is available in this browser.");
      }
      const stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      const stopped = new Promise<void>((resolve, reject) => {
        recorder.onstop = () => resolve();
        recorder.onerror = () => reject(new AiTaskError("ENCODE_FAILED", "The video encoder failed."));
      });
      const cssFilter: Record<string, string> = {
        none: "none",
        grayscale: "grayscale(1)",
        sepia: "sepia(1)",
        invert: "invert(1)",
        contrast: "contrast(1.6) saturate(1.15)",
        saturate: "saturate(2)",
      };
      const draw = () => {
        context.filter = cssFilter[filter] ?? "none";
        context.drawImage(video, 0, 0, size.width, size.height);
        context.filter = "none";
      };
      let finishPlayback: (() => void) | null = null;
      let recordedSeconds = 0;
      const abortHandler = () => {
        finishPlayback?.();
        try {
          recorder.stop();
        } catch {
          // ignore
        }
        try {
          video.pause();
        } catch {
          // ignore
        }
      };
      signal?.addEventListener("abort", abortHandler, { once: true });
      try {
        draw();
        recorder.start(250);
        video.currentTime = 0;
        await video.play();
        const limit = Math.min(maxDuration, video.duration);
        recordedSeconds = limit;
        await new Promise<void>((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          finishPlayback = finish;
          const tick = () => {
            if (settled) return;
            draw();
            report(onProgress, 0.1 + 0.8 * Math.min(1, video.currentTime / Math.max(0.01, limit)), "encode");
            if (video.currentTime >= limit || video.ended) {
              finish();
              return;
            }
            if (typeof video.requestVideoFrameCallback === "function") {
              video.requestVideoFrameCallback(tick);
            } else {
              window.setTimeout(tick, 33);
            }
          };
          tick();
          window.setTimeout(() => {
            // Safety valve so a stalled decoder or a cancel cannot hang the task.
            finish();
          }, (limit + 5) * 1000);
        });
        finishPlayback = null;
        video.pause();
        recorder.stop();
        await stopped;
      } finally {
        finishPlayback = null;
        signal?.removeEventListener("abort", abortHandler);
        cleanup();
      }
      ensureNotAborted(signal);
      const extension = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
      const blob = new Blob(chunks, { type: mimeType });
      if (blob.size === 0) {
        throw new AiTaskError("ENCODE_FAILED", "The encoder produced an empty file.");
      }
      report(onProgress, 0.95, "encode");
      return {
        taskId,
        engine: `Canvas filter + MediaRecorder (${mimeType})`,
        summary: `${filter} filter encoded as ${extension.toUpperCase()} · ${(blob.size / 1024).toFixed(0)} KB`,
        parts: [
          {
            name: `${baseName(file)}-${filter}.${extension}`,
            blob,
            mimeType: blob.type,
            kind: "video",
            width: size.width,
            height: size.height,
            duration: recordedSeconds,
          },
        ],
        metrics: {
          filter,
          encoder: mimeType,
          width: size.width,
          height: size.height,
          durationSeconds: recordedSeconds,
          bytes: blob.size,
        },
      };
    }

    default:
      throw new AiTaskError("NO_RUNTIME", "This task has no deterministic runtime.");
  }
}
