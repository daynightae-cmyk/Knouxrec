/**
 * KNOUX REC — local audio workspace primitives.
 *
 * Everything here is real sample math or a real browser codec. The step
 * functions are pure over Float32Array so they can be unit tested in Node;
 * only the two things that genuinely need the platform — decoding a container
 * and rendering a biquad filter — touch Web Audio, and both are injected so a
 * test can substitute its own renderer.
 *
 * Nothing claims a codec the runtime cannot encode: `probeAudioEncoders()`
 * asks MediaRecorder, and the UI disables whatever comes back unsupported.
 */

import {
  detectSilence,
  encodeWav,
  mixToMono,
  parseWavHeader,
  reverseChannels,
  rmsWindows,
  type SilenceInterval,
} from "./aiDsp";
import { buildWaveformPeaks } from "./mediaTools";

export type { SilenceInterval };

export interface AudioSignal {
  channels: Float32Array[];
  sampleRate: number;
}

export type FilterType = "lowpass" | "highpass" | "bandpass" | "notch" | "peaking";

export type AudioStep =
  | { kind: "trim"; start: number; end: number }
  | { kind: "gain"; db: number }
  | { kind: "normalise"; targetDb: number }
  | { kind: "reverse" }
  | { kind: "channels"; layout: "mono" | "stereo" }
  | { kind: "filter"; type: FilterType; frequency: number; q: number; gainDb: number }
  | { kind: "cut-silence"; thresholdDb: number; minSilenceMs: number }
  | { kind: "fade"; inMs: number; outMs: number };

export type AudioStepKind = AudioStep["kind"];

export type FilterRenderer = (
  signal: AudioSignal,
  step: Extract<AudioStep, { kind: "filter" }>,
) => Promise<AudioSignal>;

export const STEP_LABELS: Record<AudioStepKind, string> = {
  trim: "Trim",
  gain: "Gain",
  normalise: "Normalise",
  reverse: "Reverse",
  channels: "Channel layout",
  filter: "Frequency filter",
  "cut-silence": "Cut silence",
  fade: "Fade in/out",
};

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const dbToLinear = (db: number) => Math.pow(10, db / 20);

export const linearToDb = (value: number) =>
  value > 0 ? 20 * Math.log10(value) : -120;

export function signalDuration(signal: AudioSignal): number {
  const frames = signal.channels[0]?.length ?? 0;
  return signal.sampleRate > 0 ? frames / signal.sampleRate : 0;
}

export function cloneSignal(signal: AudioSignal): AudioSignal {
  return {
    sampleRate: signal.sampleRate,
    channels: signal.channels.map((channel) => new Float32Array(channel)),
  };
}

export function frameCount(signal: AudioSignal): number {
  return signal.channels.reduce(
    (shortest, channel) => Math.min(shortest, channel.length),
    signal.channels[0]?.length ?? 0,
  );
}

/* ------------------------------------------------------------------ */
/* Pure steps                                                          */
/* ------------------------------------------------------------------ */

export function trimSignal(signal: AudioSignal, start: number, end: number): AudioSignal {
  const rate = signal.sampleRate;
  const total = frameCount(signal);
  const from = clamp(Math.round(start * rate), 0, total);
  const to = clamp(Math.round(end * rate), from + 1, total);
  return {
    sampleRate: rate,
    channels: signal.channels.map((channel) => channel.slice(from, to)),
  };
}

export function gainSignal(signal: AudioSignal, db: number): AudioSignal {
  const factor = dbToLinear(db);
  return {
    sampleRate: signal.sampleRate,
    channels: signal.channels.map((channel) => {
      const out = new Float32Array(channel.length);
      for (let index = 0; index < channel.length; index += 1) {
        out[index] = clamp(channel[index] * factor, -1, 1);
      }
      return out;
    }),
  };
}

export function peakOf(signal: AudioSignal): number {
  let peak = 0;
  for (const channel of signal.channels) {
    for (let index = 0; index < channel.length; index += 1) {
      const value = Math.abs(channel[index]);
      if (value > peak) peak = value;
    }
  }
  return peak;
}

/** Scale the whole signal so its loudest sample lands on the target dBFS. */
export function normaliseSignal(signal: AudioSignal, targetDb = -1): AudioSignal {
  const peak = peakOf(signal);
  if (peak === 0) return cloneSignal(signal);
  const target = clamp(dbToLinear(targetDb), 0, 1);
  const factor = target / peak;
  return {
    sampleRate: signal.sampleRate,
    channels: signal.channels.map((channel) => {
      const out = new Float32Array(channel.length);
      for (let index = 0; index < channel.length; index += 1) {
        out[index] = clamp(channel[index] * factor, -1, 1);
      }
      return out;
    }),
  };
}

export function reverseSignal(signal: AudioSignal): AudioSignal {
  return { sampleRate: signal.sampleRate, channels: reverseChannels(signal.channels) };
}

export function toMonoSignal(signal: AudioSignal): AudioSignal {
  return { sampleRate: signal.sampleRate, channels: [mixToMono(signal.channels)] };
}

export function toStereoSignal(signal: AudioSignal): AudioSignal {
  const base = signal.channels.length > 1 ? signal.channels : [signal.channels[0] ?? new Float32Array(0)];
  return {
    sampleRate: signal.sampleRate,
    channels: [new Float32Array(base[0]), new Float32Array(base[Math.min(1, base.length - 1)])],
  };
}

export function channelSignal(
  signal: AudioSignal,
  layout: "mono" | "stereo",
): AudioSignal {
  return layout === "mono" ? toMonoSignal(signal) : toStereoSignal(signal);
}

export function fadeSignal(signal: AudioSignal, inMs: number, outMs: number): AudioSignal {
  const rate = signal.sampleRate;
  const inFrames = clamp(Math.round((inMs / 1000) * rate), 0, frameCount(signal));
  const outFrames = clamp(Math.round((outMs / 1000) * rate), 0, frameCount(signal));
  return {
    sampleRate: rate,
    channels: signal.channels.map((channel) => {
      const out = new Float32Array(channel);
      for (let index = 0; index < inFrames; index += 1) {
        out[index] *= index / Math.max(1, inFrames);
      }
      const length = out.length;
      for (let index = 0; index < outFrames; index += 1) {
        const at = length - 1 - index;
        if (at < 0) break;
        out[at] *= index / Math.max(1, outFrames);
      }
      return out;
    }),
  };
}

export interface SilenceReport {
  intervals: SilenceInterval[];
  silenceRatio: number;
  totalSeconds: number;
}

/** Loudness map of the first channel, reusing the RMS window helper. */
export function analyseSilence(
  signal: AudioSignal,
  options: { thresholdDb: number; minSilenceMs: number },
): SilenceReport {
  const mono = signal.channels.length > 1 ? [mixToMono(signal.channels)] : signal.channels;
  const windows = rmsWindows(mono[0] ?? new Float32Array(0), signal.sampleRate, 20);
  const result = detectSilence(windows, options);
  return {
    intervals: result.intervals,
    silenceRatio: result.silenceRatio,
    totalSeconds: result.totalSeconds,
  };
}

/** Remove every interval at once, keeping the audio between them. */
export function removeRanges(signal: AudioSignal, ranges: SilenceInterval[]): AudioSignal {
  if (ranges.length === 0) return cloneSignal(signal);
  const rate = signal.sampleRate;
  const total = frameCount(signal);
  const keep: Array<[number, number]> = [];
  let cursor = 0;
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const from = clamp(Math.round(range.start * rate), 0, total);
    if (from > cursor) keep.push([cursor, from]);
    cursor = Math.max(cursor, clamp(Math.round(range.end * rate), 0, total));
  }
  if (cursor < total) keep.push([cursor, total]);
  const channels = signal.channels.map(
    () => new Float32Array(keep.reduce((sum, [from, to]) => sum + (to - from), 0)),
  );
  let offset = 0;
  for (const [from, to] of keep) {
    for (let channel = 0; channel < signal.channels.length; channel += 1) {
      channels[channel].set(signal.channels[channel].slice(from, to), offset);
    }
    offset += to - from;
  }
  return { sampleRate: rate, channels };
}

export function cutSilenceSignal(
  signal: AudioSignal,
  options: { thresholdDb: number; minSilenceMs: number },
): { signal: AudioSignal; report: SilenceReport } {
  const report = analyseSilence(signal, options);
  return { signal: removeRanges(signal, report.intervals), report };
}

/** Split at absolute second markers; always returns at least one segment. */
export function splitSignal(signal: AudioSignal, points: number[]): AudioSignal[] {
  const duration = signalDuration(signal);
  const marks = [
    0,
    ...points
      .map((point) => clamp(point, 0, duration))
      .sort((a, b) => a - b)
      .filter((point, index, list) => index === 0 || point - list[index - 1] > 0.001),
    duration,
  ].filter((point, index, list) => index === 0 || Math.abs(point - list[index - 1]) > 1e-6);
  const segments: AudioSignal[] = [];
  for (let index = 0; index < marks.length - 1; index += 1) {
    segments.push(trimSignal(signal, marks[index], marks[index + 1]));
  }
  return segments.length ? segments : [cloneSignal(signal)];
}

/* ------------------------------------------------------------------ */
/* Pipeline                                                            */
/* ------------------------------------------------------------------ */

export async function applySteps(
  source: AudioSignal,
  steps: AudioStep[],
  renderFilter?: FilterRenderer,
): Promise<{ signal: AudioSignal; applied: AudioStepKind[] }> {
  let signal = source;
  const applied: AudioStepKind[] = [];
  for (const step of steps) {
    switch (step.kind) {
      case "trim":
        signal = trimSignal(signal, step.start, step.end);
        break;
      case "gain":
        signal = gainSignal(signal, step.db);
        break;
      case "normalise":
        signal = normaliseSignal(signal, step.targetDb);
        break;
      case "reverse":
        signal = reverseSignal(signal);
        break;
      case "channels":
        signal = channelSignal(signal, step.layout);
        break;
      case "fade":
        signal = fadeSignal(signal, step.inMs, step.outMs);
        break;
      case "cut-silence":
        signal = cutSilenceSignal(signal, {
          thresholdDb: step.thresholdDb,
          minSilenceMs: step.minSilenceMs,
        }).signal;
        break;
      case "filter":
        if (!renderFilter) throw new Error("No filter renderer is available in this runtime.");
        signal = await renderFilter(signal, step);
        break;
      default:
        break;
    }
    applied.push(step.kind);
  }
  return { signal, applied };
}

/* ------------------------------------------------------------------ */
/* Platform: decode, filter render, encode                             */
/* ------------------------------------------------------------------ */

function audioContextCtor(): typeof AudioContext | null {
  const ctor =
    typeof window !== "undefined"
      ? window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;
  return ctor ?? null;
}

export async function decodeAudioBlob(blob: Blob): Promise<AudioSignal> {
  const Ctor = audioContextCtor();
  if (!Ctor) throw new Error("The Web Audio API is unavailable in this runtime.");
  const arrayBuffer = await blob.arrayBuffer();
  // For PCM WAV the true rate lives in the header; ask for a context at that
  // rate so decodeAudioData does not resample the file away from itself.
  let declaredRate: number | undefined;
  try {
    const header = parseWavHeader(new Uint8Array(arrayBuffer.slice(0, 64)));
    if (header && header.sampleRate >= 8000 && header.sampleRate <= 192000) {
      declaredRate = header.sampleRate;
    }
  } catch {
    // Not a readable WAV header; fall back to the runtime default.
  }
  let context: AudioContext;
  try {
    context = declaredRate ? new Ctor({ sampleRate: declaredRate }) : new Ctor();
  } catch {
    context = new Ctor();
  }
  try {
    const buffer = await context.decodeAudioData(arrayBuffer.slice(0));
    const channels: Float32Array[] = [];
    for (let index = 0; index < buffer.numberOfChannels; index += 1) {
      channels.push(new Float32Array(buffer.getChannelData(index)));
    }
    return { channels, sampleRate: buffer.sampleRate };
  } finally {
    await context.close().catch(() => undefined);
  }
}

/** Renders a biquad through an OfflineAudioContext — the browser's own filter. */
export function createFilterRenderer(): FilterRenderer {
  return async (signal, step) => {
    const Ctor = audioContextCtor();
    if (!Ctor) throw new Error("The Web Audio API is unavailable in this runtime.");
    const frames = frameCount(signal);
    const OfflineCtor =
      (globalThis as unknown as { OfflineAudioContext?: typeof OfflineAudioContext })
        .OfflineAudioContext ?? null;
    if (!OfflineCtor) throw new Error("Offline rendering is unavailable in this runtime.");
    void Ctor;
    const context = new OfflineCtor(
      signal.channels.length,
      Math.max(1, frames),
      signal.sampleRate,
    );
    const buffer = context.createBuffer(
      signal.channels.length,
      Math.max(1, frames),
      signal.sampleRate,
    );
    for (let channel = 0; channel < signal.channels.length; channel += 1) {
      buffer.copyToChannel(signal.channels[channel], channel);
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = step.type;
    filter.frequency.value = clamp(step.frequency, 10, Math.min(20000, signal.sampleRate / 2 - 1));
    filter.Q.value = clamp(step.q, 0.0001, 30);
    if (step.type === "peaking") filter.gain.value = step.gainDb;
    source.connect(filter);
    filter.connect(context.destination);
    source.start(0);
    const rendered = await context.startRendering();
    const channels: Float32Array[] = [];
    for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
      channels.push(new Float32Array(rendered.getChannelData(channel)));
    }
    return { channels, sampleRate: rendered.sampleRate };
  };
}

export function encodeWavBlob(signal: AudioSignal): Blob {
  const bytes = encodeWav(signal.channels, signal.sampleRate);
  return new Blob([bytes.slice().buffer], { type: "audio/wav" });
}

export interface AudioEncoderSupport {
  wav: boolean;
  webm: boolean;
  mp3: boolean;
  aac: boolean;
  webmMime: string | null;
}

/** Ask the runtime what it can actually encode. Never guess. */
export function probeAudioEncoders(): AudioEncoderSupport {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];
  let chosen: string | null = null;
  if (typeof MediaRecorder !== "undefined") {
    for (const candidate of candidates) {
      try {
        if (MediaRecorder.isTypeSupported(candidate)) {
          chosen = candidate;
          break;
        }
      } catch {
        // treat as unsupported
      }
    }
  }
  return {
    wav: true,
    webm: chosen !== null,
    mp3: false,
    aac: false,
    webmMime: chosen,
  };
}

/**
 * Encode to the runtime's WebM/Opus by playing the buffer through a media
 * stream recorder. This is real-time, so it is capped; WAV stays available for
 * anything longer.
 */
export async function encodeWebmBlob(
  signal: AudioSignal,
  options: { mime: string; onProgress?: (fraction: number) => void; maxSeconds?: number } = {
    mime: "audio/webm;codecs=opus",
  },
): Promise<Blob> {
  const Ctor = audioContextCtor();
  if (!Ctor) throw new Error("The Web Audio API is unavailable in this runtime.");
  if (typeof MediaRecorder === "undefined") {
    throw new Error("MediaRecorder is unavailable, so WebM audio cannot be encoded here.");
  }
  const duration = signalDuration(signal);
  const cap = options.maxSeconds ?? 30;
  if (duration > cap) {
    throw new Error(
      `WebM encoding runs in real time; use WAV for audio longer than ${cap}s (this is ${duration.toFixed(1)}s).`,
    );
  }
  const context = new Ctor({ sampleRate: signal.sampleRate });
  try {
    const buffer = context.createBuffer(
      signal.channels.length,
      Math.max(1, frameCount(signal)),
      signal.sampleRate,
    );
    for (let channel = 0; channel < signal.channels.length; channel += 1) {
      buffer.copyToChannel(signal.channels[channel], channel);
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    const destination = context.createMediaStreamDestination();
    source.connect(destination);
    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(destination.stream, { mimeType: options.mime });
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    const timer = window.setInterval(() => {
      options.onProgress?.(Math.min(1, context.currentTime / Math.max(0.001, duration)));
    }, 100);
    recorder.start(200);
    source.start(0);
    await new Promise<void>((resolve) => {
      source.onended = () => resolve();
    });
    window.clearInterval(timer);
    recorder.stop();
    await stopped;
    const blob = new Blob(chunks, { type: options.mime });
    if (!blob.size) throw new Error("The WebM encoder produced no bytes.");
    return blob;
  } finally {
    await context.close().catch(() => undefined);
  }
}

/* ------------------------------------------------------------------ */
/* Presentation helpers                                                */
/* ------------------------------------------------------------------ */

export interface WaveformGeometry {
  peaks: number[];
  peak: number;
  duration: number;
  sampleRate: number;
  channels: number;
}

export function waveformGeometry(signal: AudioSignal, width = 1200): WaveformGeometry {
  const mono = signal.channels.length > 1 ? mixToMono(signal.channels) : signal.channels[0] ?? new Float32Array(0);
  const { peaks, peak } = buildWaveformPeaks(mono, clamp(width, 64, 4096));
  return {
    peaks,
    peak,
    duration: signalDuration(signal),
    sampleRate: signal.sampleRate,
    channels: signal.channels.length,
  };
}

export interface SignalStats {
  duration: number;
  sampleRate: number;
  channels: number;
  frames: number;
  peak: number;
  peakDb: number;
  rmsDb: number;
}

export function signalStats(signal: AudioSignal): SignalStats {
  const mono = signal.channels.length > 1 ? mixToMono(signal.channels) : signal.channels[0] ?? new Float32Array(0);
  const windows = rmsWindows(mono, signal.sampleRate, 50);
  const meanSquare =
    windows.reduce((sum, window) => sum + window.rms * window.rms, 0) / Math.max(1, windows.length);
  const peak = peakOf(signal);
  return {
    duration: signalDuration(signal),
    sampleRate: signal.sampleRate,
    channels: signal.channels.length,
    frames: frameCount(signal),
    peak,
    peakDb: linearToDb(peak),
    rmsDb: linearToDb(Math.sqrt(meanSquare)),
  };
}
