/**
 * Runtime metadata for the deterministic AI tasks.
 *
 * The catalog describes what each task does; this file declares what it
 * actually needs to run: the engine, the accepted input, and the real
 * parameters exposed in the UI. Tasks that are not listed here require a
 * neural model and stay blocked until the weight binaries exist.
 */

import type { AiTaskOutputKind } from "../services/aiTasks";

export interface AiParamOption {
  value: string;
  labelEn: string;
  labelAr: string;
}

export type AiParamSpec =
  | {
      kind: "number";
      key: string;
      labelKey: string;
      min: number;
      max: number;
      step: number;
      defaultValue: number;
      unit?: string;
    }
  | {
      kind: "select";
      key: string;
      labelKey: string;
      options: AiParamOption[];
      defaultValue: string;
    };

export interface DeterministicRuntime {
  taskId: string;
  /** Human-readable engine description shown in the UI. */
  engineEn: string;
  engineAr: string;
  /** Input families used for validation and the file picker. */
  inputFamilies: Array<"image" | "audio" | "video" | "file">;
  accept: string;
  outputKind: AiTaskOutputKind;
  params: AiParamSpec[];
}

const AUDIO_ACCEPT = "audio/*,.wav,.mp3,.ogg,.oga,.m4a,.aac,.flac,.opus";
const VIDEO_ACCEPT = "video/*,.webm,.mp4,.mov,.mkv,.ogv,.m4v";
const AV_ACCEPT = `${AUDIO_ACCEPT},${VIDEO_ACCEPT}`;
const IMAGE_ACCEPT = "image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp";

export const DETERMINISTIC_RUNTIMES: Record<string, DeterministicRuntime> = {
  extract_audio: {
    taskId: "extract_audio",
    engineEn: "Web Audio decodeAudioData + PCM WAV encoder",
    engineAr: "فك ترميز Web Audio ومُرمِّز WAV",
    inputFamilies: ["video", "audio"],
    accept: AV_ACCEPT,
    outputKind: "audio",
    params: [],
  },
  reverse_audio: {
    taskId: "reverse_audio",
    engineEn: "Sample reversal + PCM WAV encoder",
    engineAr: "عكس العينات ومُرمِّز WAV",
    inputFamilies: ["audio"],
    accept: AUDIO_ACCEPT,
    outputKind: "audio",
    params: [],
  },
  audio_converter: {
    taskId: "audio_converter",
    engineEn: "Web Audio decode + linear resample + WAV encoder",
    engineAr: "فك ترميز وإعادة أخذ عينات ومُرمِّز WAV",
    inputFamilies: ["audio", "video"],
    accept: AV_ACCEPT,
    outputKind: "audio",
    params: [
      {
        kind: "select",
        key: "sampleRate",
        labelKey: "ai.param.sampleRate",
        defaultValue: "48000",
        options: [
          { value: "22050", labelEn: "22 050 Hz", labelAr: "٢٢٬٠٥٠ هرتز" },
          { value: "44100", labelEn: "44 100 Hz", labelAr: "٤٤٬١٠٠ هرتز" },
          { value: "48000", labelEn: "48 000 Hz", labelAr: "٤٨٬٠٠٠ هرتز" },
          { value: "96000", labelEn: "96 000 Hz", labelAr: "٩٦٬٠٠٠ هرتز" },
        ],
      },
    ],
  },
  frequency_filter: {
    taskId: "frequency_filter",
    engineEn: "OfflineAudioContext BiquadFilter",
    engineAr: "مرشح Biquad عبر OfflineAudioContext",
    inputFamilies: ["audio", "video"],
    accept: AV_ACCEPT,
    outputKind: "audio",
    params: [
      {
        kind: "select",
        key: "filterType",
        labelKey: "ai.param.filterType",
        defaultValue: "lowpass",
        options: [
          { value: "lowpass", labelEn: "Low-pass", labelAr: "تمرير منخفض" },
          { value: "highpass", labelEn: "High-pass", labelAr: "تمرير مرتفع" },
          { value: "bandpass", labelEn: "Band-pass", labelAr: "تمرير نطاقي" },
        ],
      },
      {
        kind: "number",
        key: "frequency",
        labelKey: "ai.param.frequency",
        min: 20,
        max: 20000,
        step: 10,
        defaultValue: 1200,
        unit: "Hz",
      },
      {
        kind: "number",
        key: "q",
        labelKey: "ai.param.q",
        min: 0.1,
        max: 20,
        step: 0.1,
        defaultValue: 0.707,
      },
    ],
  },
  generate_spectrogram: {
    taskId: "generate_spectrogram",
    engineEn: "Radix-2 FFT spectrogram renderer",
    engineAr: "راسم طيفي بتحويل فورييه السريع",
    inputFamilies: ["audio", "video"],
    accept: AV_ACCEPT,
    outputKind: "image",
    params: [
      {
        kind: "select",
        key: "fftSize",
        labelKey: "ai.param.fftSize",
        defaultValue: "1024",
        options: [
          { value: "512", labelEn: "512 bins window", labelAr: "نافذة ٥١٢" },
          { value: "1024", labelEn: "1024 bins window", labelAr: "نافذة ١٠٢٤" },
          { value: "2048", labelEn: "2048 bins window", labelAr: "نافذة ٢٠٤٨" },
        ],
      },
      {
        kind: "number",
        key: "maxSeconds",
        labelKey: "ai.param.maxSeconds",
        min: 1,
        max: 600,
        step: 1,
        defaultValue: 30,
        unit: "s",
      },
    ],
  },
  detect_silence: {
    taskId: "detect_silence",
    engineEn: "RMS window analysis",
    engineAr: "تحليل الجذر التربيعي المتوسط",
    inputFamilies: ["audio", "video"],
    accept: AV_ACCEPT,
    outputKind: "json",
    params: [
      {
        kind: "number",
        key: "thresholdDb",
        labelKey: "ai.param.thresholdDb",
        min: -90,
        max: -5,
        step: 1,
        defaultValue: -40,
        unit: "dB",
      },
      {
        kind: "number",
        key: "minSilenceMs",
        labelKey: "ai.param.minSilenceMs",
        min: 20,
        max: 10000,
        step: 10,
        defaultValue: 300,
        unit: "ms",
      },
    ],
  },
  noise_profiler: {
    taskId: "noise_profiler",
    engineEn: "RMS / peak / crest / SNR analysis",
    engineAr: "تحليل RMS والذروة ونسبة الإشارة للضجيج",
    inputFamilies: ["audio", "video"],
    accept: AV_ACCEPT,
    outputKind: "json",
    params: [],
  },
  change_pitch: {
    taskId: "change_pitch",
    engineEn: "Granular overlap-add pitch shifter",
    engineAr: "مبدّل طبقة صوتية حبيبي",
    inputFamilies: ["audio", "video"],
    accept: AV_ACCEPT,
    outputKind: "audio",
    params: [
      {
        kind: "number",
        key: "semitones",
        labelKey: "ai.param.semitones",
        min: -12,
        max: 12,
        step: 1,
        defaultValue: 4,
        unit: "st",
      },
    ],
  },
  edge_detection: {
    taskId: "edge_detection",
    engineEn: "Sobel gradient operator (3×3)",
    engineAr: "عامل سوبل للتدرج",
    inputFamilies: ["image"],
    accept: IMAGE_ACCEPT,
    outputKind: "image",
    params: [
      {
        kind: "number",
        key: "threshold",
        labelKey: "ai.param.edgeThreshold",
        min: 0.01,
        max: 1,
        step: 0.01,
        defaultValue: 0.18,
      },
    ],
  },
  extract_frames: {
    taskId: "extract_frames",
    engineEn: "HTMLVideoElement seek + canvas frame grab",
    engineAr: "التقاط إطارات الفيديو عبر Canvas",
    inputFamilies: ["video"],
    accept: VIDEO_ACCEPT,
    outputKind: "image",
    params: [
      {
        kind: "number",
        key: "count",
        labelKey: "ai.param.frameCount",
        min: 1,
        max: 30,
        step: 1,
        defaultValue: 9,
      },
      {
        kind: "number",
        key: "maxWidth",
        labelKey: "ai.param.maxWidth",
        min: 120,
        max: 1920,
        step: 10,
        defaultValue: 480,
        unit: "px",
      },
    ],
  },
  analyze_fps: {
    taskId: "analyze_fps",
    engineEn: "requestVideoFrameCallback timing",
    engineAr: "قياس الإطارات عبر requestVideoFrameCallback",
    inputFamilies: ["video"],
    accept: VIDEO_ACCEPT,
    outputKind: "json",
    params: [],
  },
  extract_scenes: {
    taskId: "extract_scenes",
    engineEn: "Luminance histogram cut detection",
    engineAr: "كشف المشاهد عبر توزيع الإضاءة",
    inputFamilies: ["video"],
    accept: VIDEO_ACCEPT,
    outputKind: "json",
    params: [
      {
        kind: "number",
        key: "samples",
        labelKey: "ai.param.samples",
        min: 4,
        max: 120,
        step: 1,
        defaultValue: 40,
      },
      {
        kind: "number",
        key: "sensitivity",
        labelKey: "ai.param.sensitivity",
        min: 0.05,
        max: 0.95,
        step: 0.01,
        defaultValue: 0.35,
      },
    ],
  },
  detect_motion: {
    taskId: "detect_motion",
    engineEn: "Frame differencing + motion heatmap",
    engineAr: "مقارنة الإطارات وخريطة الحركة",
    inputFamilies: ["video"],
    accept: VIDEO_ACCEPT,
    outputKind: "json",
    params: [
      {
        kind: "number",
        key: "samples",
        labelKey: "ai.param.samples",
        min: 4,
        max: 120,
        step: 1,
        defaultValue: 60,
      },
      {
        kind: "number",
        key: "threshold",
        labelKey: "ai.param.motionThreshold",
        min: 0.001,
        max: 0.5,
        step: 0.001,
        defaultValue: 0.04,
      },
    ],
  },
  video_filters: {
    taskId: "video_filters",
    engineEn: "Canvas filter + MediaRecorder encoder",
    engineAr: "مرشح Canvas ومُرمِّز MediaRecorder",
    inputFamilies: ["video"],
    accept: VIDEO_ACCEPT,
    outputKind: "video",
    params: [
      {
        kind: "select",
        key: "filter",
        labelKey: "ai.param.videoFilter",
        defaultValue: "grayscale",
        options: [
          { value: "none", labelEn: "None (re-encode)", labelAr: "بدون (إعادة ترميز)" },
          { value: "grayscale", labelEn: "Grayscale", labelAr: "تدرج رمادي" },
          { value: "sepia", labelEn: "Sepia", labelAr: "بني داكن" },
          { value: "invert", labelEn: "Invert", labelAr: "عكس الألوان" },
          { value: "contrast", labelEn: "Contrast + saturation", labelAr: "تباين وتشبع" },
          { value: "saturate", labelEn: "Saturation ×2", labelAr: "تشبع ×٢" },
        ],
      },
      {
        kind: "number",
        key: "maxDuration",
        labelKey: "ai.param.maxDuration",
        min: 1,
        max: 60,
        step: 1,
        defaultValue: 10,
        unit: "s",
      },
    ],
  },
  file_analyzer: {
    taskId: "file_analyzer",
    engineEn: "Container sniffing + Web Crypto SHA-256",
    engineAr: "فحص الحاوية وتجزئة SHA-256",
    inputFamilies: ["file"],
    accept: "",
    outputKind: "json",
    params: [],
  },
};

export function runtimeFor(taskId: string): DeterministicRuntime | undefined {
  return DETERMINISTIC_RUNTIMES[taskId];
}

function extensionOf(name: string): string {
  const match = /\.([^.]+)$/.exec(name);
  return match ? match[1].toLowerCase() : "";
}

/**
 * Validates the picked file against the runtime's declared families.
 * The MIME type is used when the browser provides one; the extension is the
 * fallback because Windows can report an empty type for uncommon containers.
 */
export function validateInputFile(
  file: File,
  runtime: DeterministicRuntime,
): { ok: true } | { ok: false; reason: "empty" | "type" } {
  if (file.size === 0) return { ok: false, reason: "empty" };
  if (runtime.inputFamilies.includes("file")) return { ok: true };
  const type = (file.type || "").toLowerCase();
  const extension = extensionOf(file.name);
  const familyByExtension: Record<string, Array<"image" | "audio" | "video">> = {
    png: ["image"],
    jpg: ["image"],
    jpeg: ["image"],
    webp: ["image"],
    gif: ["image"],
    bmp: ["image"],
    wav: ["audio"],
    mp3: ["audio"],
    ogg: ["audio"],
    oga: ["audio"],
    opus: ["audio"],
    m4a: ["audio"],
    aac: ["audio"],
    flac: ["audio"],
    webm: ["video", "audio"],
    mp4: ["video", "audio"],
    m4v: ["video"],
    mov: ["video"],
    mkv: ["video"],
    ogv: ["video"],
  };
  for (const family of runtime.inputFamilies) {
    if (type.startsWith(`${family}/`)) return { ok: true };
  }
  const families = familyByExtension[extension];
  if (families && families.some((family) => runtime.inputFamilies.includes(family))) {
    return { ok: true };
  }
  return { ok: false, reason: "type" };
}
