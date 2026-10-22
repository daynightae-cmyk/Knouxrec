/**
 * Real media tool processors for the KNOUX REC Toolbox.
 *
 * Every processor produces genuine bytes: a canvas is encoded with the
 * browser's own encoder, audio is decoded with the Web Audio API and video is
 * decoded by the media element. Nothing here fabricates a result.
 *
 * The pixel maths is exported as pure functions so it can be verified without
 * a DOM (see `mediaTools.test.ts`).
 */

import { encodeQrCode, drawQrCode, type QrEcLevel } from "./qrCode";

export type MediaToolId =
  | "image-resize"
  | "image-filters"
  | "image-convert"
  | "video-thumbnail"
  | "audio-visualizer"
  | "text-image"
  | "qr-code"
  | "color-palette";

export type MediaToolCategory = "image" | "video" | "audio" | "text" | "utility";

export type ImageFormat = "png" | "jpeg" | "webp";

export interface MediaToolDescriptor {
  id: MediaToolId;
  name: string;
  nameAr: string;
  category: MediaToolCategory;
  description: string;
  descriptionAr: string;
  /** MIME types accepted as input. Empty means the tool takes no file. */
  accepts: string[];
  /** MIME type produced by the tool. */
  outputMime: string;
  outputExtension: string;
  /** `file` requires a file input, `text` requires typed text. */
  inputKind: "file" | "text";
  /** True when the processor is implemented and produces real bytes. */
  runnable: boolean;
}

export const MEDIA_TOOLS: MediaToolDescriptor[] = [
  {
    id: "image-resize",
    name: "Image Resizer",
    nameAr: "تغيير حجم الصور",
    category: "image",
    description: "Resample an image to new dimensions with a real pixel pipeline.",
    descriptionAr: "إعادة تحجيم الصورة بأبعاد جديدة عبر معالجة بكسل حقيقية.",
    accepts: ["image/png", "image/jpeg", "image/webp"],
    outputMime: "image/png",
    outputExtension: "png",
    inputKind: "file",
    runnable: true,
  },
  {
    id: "image-filters",
    name: "Image Filters",
    nameAr: "فلاتر الصور",
    category: "image",
    description: "Adjust exposure, brightness, contrast and saturation per pixel.",
    descriptionAr: "ضبط الإضاءة والسطوع والتباين والتشبع بكسل ببكسل.",
    accepts: ["image/png", "image/jpeg", "image/webp"],
    outputMime: "image/png",
    outputExtension: "png",
    inputKind: "file",
    runnable: true,
  },
  {
    id: "image-convert",
    name: "Format Converter",
    nameAr: "محول الصيغ",
    category: "image",
    description: "Re-encode an image into a format the runtime can really write.",
    descriptionAr: "إعادة ترميز الصورة إلى صيغة يدعمها المحرك فعليًا.",
    accepts: ["image/png", "image/jpeg", "image/webp"],
    outputMime: "image/png",
    outputExtension: "png",
    inputKind: "file",
    runnable: true,
  },
  {
    id: "video-thumbnail",
    name: "Video Thumbnail",
    nameAr: "صورة مصغرة للفيديو",
    category: "video",
    description: "Decode a video, seek to a timestamp and export the real frame.",
    descriptionAr: "فك ترميز الفيديو والانتقال إلى لحظة محددة وتصدير الإطار الحقيقي.",
    accepts: ["video/webm", "video/mp4", "video/ogg"],
    outputMime: "image/png",
    outputExtension: "png",
    inputKind: "file",
    runnable: true,
  },
  {
    id: "audio-visualizer",
    name: "Audio Visualizer",
    nameAr: "مصور صوتي",
    category: "audio",
    description: "Decode PCM samples and draw the measured waveform.",
    descriptionAr: "فك ترميز عينات PCM ورسم الموجة الصوتية المقاسة فعليًا.",
    accepts: ["audio/webm", "audio/wav", "audio/mp4", "audio/ogg", "audio/mpeg"],
    outputMime: "image/png",
    outputExtension: "png",
    inputKind: "file",
    runnable: true,
  },
  {
    id: "text-image",
    name: "Text Image Generator",
    nameAr: "مولد صور النصوص",
    category: "text",
    description: "Render text onto a canvas with real font metrics.",
    descriptionAr: "رسم النص على لوحة رسم بقياسات خطوط حقيقية.",
    accepts: [],
    outputMime: "image/png",
    outputExtension: "png",
    inputKind: "text",
    runnable: true,
  },
  {
    id: "qr-code",
    name: "QR Code Generator",
    nameAr: "مولد رمز QR",
    category: "utility",
    description: "Encode a scannable QR Code with Reed-Solomon error correction.",
    descriptionAr: "ترميز رمز QR قابل للمسح مع تصحيح أخطاء ريد-سولومون.",
    accepts: [],
    outputMime: "image/png",
    outputExtension: "png",
    inputKind: "text",
    runnable: true,
  },
  {
    id: "color-palette",
    name: "Color Palette Extractor",
    nameAr: "استخراج لوحة الألوان",
    category: "image",
    description: "Sample the real pixels and return the dominant colours.",
    descriptionAr: "أخذ عينة من البكسلات الحقيقية واستخراج الألوان الغالبة.",
    accepts: ["image/png", "image/jpeg", "image/webp"],
    outputMime: "image/png",
    outputExtension: "png",
    inputKind: "file",
    runnable: true,
  },
];

export const MEDIA_TOOL_IDS = MEDIA_TOOLS.map((tool) => tool.id);

export interface MediaToolMetrics {
  [key: string]: string | number | boolean;
}

export interface MediaToolResult {
  toolId: MediaToolId;
  blob: Blob;
  mimeType: string;
  fileName: string;
  width?: number;
  height?: number;
  duration?: number;
  bytes: number;
  metrics: MediaToolMetrics;
  /** Human readable processing notes shown in the result tray. */
  logs: string[];
}

export class MediaToolError extends Error {
  readonly toolId: MediaToolId;

  constructor(toolId: MediaToolId, message: string) {
    super(message);
    this.name = "MediaToolError";
    this.toolId = toolId;
  }
}

/* ------------------------------------------------------------------ */
/* Pure pixel helpers                                                  */
/* ------------------------------------------------------------------ */

export interface ResizeOptions {
  width?: number;
  height?: number;
  /** How the requested box maps onto the source aspect ratio. */
  mode: "fit" | "fill" | "stretch" | "percentage";
  percentage?: number;
}

export interface ResizedDimensions {
  width: number;
  height: number;
}

/**
 * Resolve the output size of a resize operation.
 * `fit` keeps the whole image inside the box, `fill` covers the box and
 * crops, `stretch` ignores the aspect ratio and `percentage` scales.
 */
export function computeResizedDimensions(
  source: { width: number; height: number },
  options: ResizeOptions,
): ResizedDimensions {
  const { width: sourceWidth, height: sourceHeight } = source;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error("The source image has no usable dimensions.");
  }
  if (options.mode === "percentage") {
    const percentage = clamp(options.percentage ?? 100, 1, 400) / 100;
    return {
      width: Math.max(1, Math.round(sourceWidth * percentage)),
      height: Math.max(1, Math.round(sourceHeight * percentage)),
    };
  }
  if (options.mode === "stretch") {
    const width = Math.max(1, Math.round(options.width ?? sourceWidth));
    const height = Math.max(1, Math.round(options.height ?? sourceHeight));
    return { width, height };
  }
  const boxWidth = Math.max(1, Math.round(options.width ?? sourceWidth));
  const boxHeight = Math.max(1, Math.round(options.height ?? sourceHeight));
  const scale =
    options.mode === "fill"
      ? Math.max(boxWidth / sourceWidth, boxHeight / sourceHeight)
      : Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

export interface ImageAdjustments {
  /** Stops, -2..2. */
  exposure?: number;
  /** -100..100. */
  brightness?: number;
  /** -100..100. */
  contrast?: number;
  /** -100..100. */
  saturation?: number;
  /** 0..100. */
  grayscale?: number;
  /** 0..100. */
  sepia?: number;
  /** 0..10 box-blur radius. */
  blur?: number;
}

/**
 * Apply the adjustments to an RGBA pixel buffer in place.
 * The maths is the standard photographic pipeline: exposure is a power of two
 * multiplier, contrast uses the classic 259/(255*(259-C)) curve and
 * saturation mixes each pixel with its Rec. 601 luminance.
 */
export function applyImageAdjustments(
  pixels: Uint8ClampedArray,
  adjustments: ImageAdjustments,
): void {
  const exposure = clamp(adjustments.exposure ?? 0, -2, 2);
  const brightness = clamp(adjustments.brightness ?? 0, -100, 100);
  const contrast = clamp(adjustments.contrast ?? 0, -100, 100);
  const saturation = clamp(adjustments.saturation ?? 0, -100, 100);
  const grayscale = clamp(adjustments.grayscale ?? 0, 0, 100);
  const sepia = clamp(adjustments.sepia ?? 0, 0, 100);
  const blur = clamp(adjustments.blur ?? 0, 0, 10);

  const exposureFactor = Math.pow(2, exposure);
  const brightnessOffset = (brightness / 100) * 255;
  const contrastFactor =
    (259 * (contrast + 255)) / (255 * (259 - contrast));
  const saturationFactor = 1 + saturation / 100;

  for (let index = 0; index < pixels.length; index += 4) {
    let r = pixels[index] * exposureFactor + brightnessOffset;
    let g = pixels[index + 1] * exposureFactor + brightnessOffset;
    let b = pixels[index + 2] * exposureFactor + brightnessOffset;

    r = contrastFactor * (r - 128) + 128;
    g = contrastFactor * (g - 128) + 128;
    b = contrastFactor * (b - 128) + 128;

    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    r = luminance + (r - luminance) * saturationFactor;
    g = luminance + (g - luminance) * saturationFactor;
    b = luminance + (b - luminance) * saturationFactor;

    if (grayscale > 0) {
      const value = 0.299 * r + 0.587 * g + 0.114 * b;
      const factor = grayscale / 100;
      r += (value - r) * factor;
      g += (value - g) * factor;
      b += (value - b) * factor;
    }

    if (sepia > 0) {
      const factor = sepia / 100;
      const sr = 0.393 * r + 0.769 * g + 0.189 * b;
      const sg = 0.349 * r + 0.686 * g + 0.168 * b;
      const sb = 0.272 * r + 0.534 * g + 0.131 * b;
      r += (sr - r) * factor;
      g += (sg - g) * factor;
      b += (sb - b) * factor;
    }

    pixels[index] = r;
    pixels[index + 1] = g;
    pixels[index + 2] = b;
  }

  if (blur > 0) {
    boxBlur(pixels, Math.round(blur));
  }
}

/** In-place box blur over the RGB channels, alpha untouched. */
function boxBlur(pixels: Uint8ClampedArray, radius: number): void {
  if (radius < 1) return;
  const length = pixels.length / 4;
  const width = Math.round(Math.sqrt(length));
  if (!Number.isFinite(width) || width < 1) return;
  const height = Math.round(length / width);
  if (height < 1) return;

  const copy = new Uint8ClampedArray(pixels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const nx = x + offset;
        if (nx < 0 || nx >= width) continue;
        const index = (y * width + nx) * 4;
        r += copy[index];
        g += copy[index + 1];
        b += copy[index + 2];
        count += 1;
      }
      const index = (y * width + x) * 4;
      pixels[index] = r / count;
      pixels[index + 1] = g / count;
      pixels[index + 2] = b / count;
    }
  }
}

export interface PaletteSwatch {
  hex: string;
  red: number;
  green: number;
  blue: number;
  /** Share of the sampled pixels, 0..1. */
  weight: number;
}

export interface PaletteOptions {
  count?: number;
  /** Ignore pixels that are almost transparent. */
  ignoreTransparent?: boolean;
}

/**
 * Extract the dominant colours from raw RGBA pixels.
 * A histogram buckets the colours into a 4-bit-per-channel grid, then the
 * heaviest buckets are merged by averaging their real members.
 */
export function quantizePalette(
  pixels: Uint8ClampedArray,
  options: PaletteOptions = {},
): PaletteSwatch[] {
  const count = clamp(Math.round(options.count ?? 6), 1, 32);
  const ignoreTransparent = options.ignoreTransparent ?? true;

  interface Bucket {
    red: number;
    green: number;
    blue: number;
    pixels: number;
  }

  const buckets = new Map<number, Bucket>();
  let sampled = 0;

  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    if (ignoreTransparent && alpha < 8) continue;
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const key = ((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.red += red;
      bucket.green += green;
      bucket.blue += blue;
      bucket.pixels += 1;
    } else {
      buckets.set(key, { red, green, blue, pixels: 1 });
    }
    sampled += 1;
  }

  if (sampled === 0) return [];

  const sorted = [...buckets.values()].sort((a, b) => b.pixels - a.pixels);
  const chosen: PaletteSwatch[] = [];
  for (const bucket of sorted) {
    if (chosen.length >= count) break;
    const red = Math.round(bucket.red / bucket.pixels);
    const green = Math.round(bucket.green / bucket.pixels);
    const blue = Math.round(bucket.blue / bucket.pixels);
    // Skip colours that are effectively the same as an accepted swatch.
    const tooSimilar = chosen.some(
      (swatch) =>
        Math.abs(swatch.red - red) +
          Math.abs(swatch.green - green) +
          Math.abs(swatch.blue - blue) <
        24,
    );
    if (tooSimilar) continue;
    chosen.push({
      hex: rgbToHex(red, green, blue),
      red,
      green,
      blue,
      weight: bucket.pixels / sampled,
    });
  }
  return chosen;
}

export function rgbToHex(red: number, green: number, blue: number): string {
  const part = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(red)}${part(green)}${part(blue)}`;
}

/**
 * Reduce decoded PCM samples to per-bucket peaks.
 * Each bucket yields the minimum and maximum sample it contains, which is what
 * a waveform display needs.
 */
export function buildWaveformPeaks(samples: ArrayLike<number>, buckets: number): {
  peaks: number[];
  peak: number;
} {
  const bucketCount = clamp(Math.round(buckets), 1, 4096);
  const peaks = new Array<number>(bucketCount * 2).fill(0);
  const length = samples.length;
  if (length === 0) return { peaks, peak: 0 };

  const size = Math.max(1, Math.floor(length / bucketCount));
  let peak = 0;
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = bucket * size;
    const end = bucket === bucketCount - 1 ? length : Math.min(length, start + size);
    let min = 0;
    let max = 0;
    for (let index = start; index < end; index += 1) {
      const value = samples[index];
      if (value < min) min = value;
      if (value > max) max = value;
    }
    peaks[bucket * 2] = min;
    peaks[bucket * 2 + 1] = max;
    peak = Math.max(peak, Math.abs(min), Math.abs(max));
  }
  return { peaks, peak };
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

/* ------------------------------------------------------------------ */
/* Canvas helpers                                                      */
/* ------------------------------------------------------------------ */

function loadImageElement(source: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(source);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The image could not be decoded."));
    };
    image.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error(`The runtime could not encode ${type}.`));
          return;
        }
        resolve(blob);
      },
      type,
      quality,
    );
  });
}

export interface EncoderSupport {
  png: boolean;
  jpeg: boolean;
  webp: boolean;
}

/**
 * Probe which image encoders the runtime really provides.
 * A canvas is encoded and the resulting bytes are inspected — the capability
 * is never assumed from the MIME string alone.
 */
export async function probeImageEncoders(): Promise<EncoderSupport> {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 4;
  const context = canvas.getContext("2d");
  if (!context) return { png: false, jpeg: false, webp: false };
  context.fillStyle = "#ffde00";
  context.fillRect(0, 0, 4, 4);

  const check = async (type: string, magic: number[]): Promise<boolean> => {
    try {
      const blob = await canvasToBlob(canvas, type, 0.8);
      const header = new Uint8Array(await blob.slice(0, magic.length).arrayBuffer());
      return magic.every((byte, index) => header[index] === byte);
    } catch {
      return false;
    }
  };

  const [png, jpeg, webp] = await Promise.all([
    check("image/png", [0x89, 0x50, 0x4e, 0x47]),
    check("image/jpeg", [0xff, 0xd8, 0xff]),
    check("image/webp", [0x52, 0x49, 0x46, 0x46]),
  ]);
  return { png, jpeg, webp };
}

export function mimeForFormat(format: ImageFormat): string {
  return format === "png" ? "image/png" : format === "jpeg" ? "image/jpeg" : "image/webp";
}

export function extensionForFormat(format: ImageFormat): string {
  return format === "jpeg" ? "jpg" : format;
}

/* ------------------------------------------------------------------ */
/* Processors                                                          */
/* ------------------------------------------------------------------ */

export interface ImageResizeOptions extends ResizeOptions {
  format?: ImageFormat;
  quality?: number;
  /** Flatten alpha onto this colour when the target has no alpha channel. */
  background?: string;
}

export async function resizeImage(
  source: Blob,
  options: ImageResizeOptions,
): Promise<{ blob: Blob; width: number; height: number; mimeType: string }> {
  const image = await loadImageElement(source);
  const { width, height } = computeResizedDimensions(image, options);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The 2D canvas context is unavailable.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const format = options.format ?? "png";
  if (format !== "png") {
    context.fillStyle = options.background ?? "#000000";
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(image, 0, 0, width, height);
  const mimeType = mimeForFormat(format);
  const blob = await canvasToBlob(canvas, mimeType, options.quality ?? 0.92);
  return { blob, width, height, mimeType };
}

export async function filterImage(
  source: Blob,
  adjustments: ImageAdjustments,
  options: { format?: ImageFormat; quality?: number } = {},
): Promise<{ blob: Blob; width: number; height: number; mimeType: string }> {
  const image = await loadImageElement(source);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("The 2D canvas context is unavailable.");
  context.drawImage(image, 0, 0);
  const frame = context.getImageData(0, 0, canvas.width, canvas.height);
  applyImageAdjustments(frame.data, adjustments);
  context.putImageData(frame, 0, 0);
  const format = options.format ?? "png";
  const mimeType = mimeForFormat(format);
  const blob = await canvasToBlob(canvas, mimeType, options.quality ?? 0.92);
  return { blob, width: canvas.width, height: canvas.height, mimeType };
}

export async function convertImage(
  source: Blob,
  options: { format: ImageFormat; quality?: number; background?: string },
): Promise<{ blob: Blob; width: number; height: number; mimeType: string }> {
  const image = await loadImageElement(source);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The 2D canvas context is unavailable.");
  const mimeType = mimeForFormat(options.format);
  if (options.format !== "png") {
    context.fillStyle = options.background ?? "#000000";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(image, 0, 0);
  const blob = await canvasToBlob(canvas, mimeType, options.quality ?? 0.9);
  return { blob, width: canvas.width, height: canvas.height, mimeType };
}

export async function extractVideoThumbnail(
  source: Blob,
  options: { time?: number; format?: ImageFormat; quality?: number } = {},
): Promise<{
  blob: Blob;
  width: number;
  height: number;
  mimeType: string;
  duration: number;
  timestamp: number;
}> {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  const url = URL.createObjectURL(source);

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error("The video did not report its metadata in time.")),
        12000,
      );
      video.onloadedmetadata = () => {
        window.clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error("The video could not be decoded by this runtime."));
      };
      video.src = url;
    });

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const requested = options.time ?? Math.min(1, duration * 0.25);
    const timestamp = Math.max(0, Math.min(duration || 0, requested));

    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error("The video did not reach the requested frame.")),
        12000,
      );
      video.onseeked = () => {
        window.clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error("The video could not be seeked."));
      };
      video.currentTime = timestamp;
    });

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) throw new Error("The video reported no frame size.");

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The 2D canvas context is unavailable.");
    context.drawImage(video, 0, 0);
    const format = options.format ?? "png";
    const mimeType = mimeForFormat(format);
    const blob = await canvasToBlob(canvas, mimeType, options.quality ?? 0.92);
    return { blob, width, height, mimeType, duration, timestamp };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function renderAudioWaveform(
  source: Blob,
  options: {
    width?: number;
    height?: number;
    color?: string;
    background?: string;
    normalize?: boolean;
    style?: "wave" | "bars";
  } = {},
): Promise<{
  blob: Blob;
  width: number;
  height: number;
  mimeType: string;
  duration: number;
  sampleRate: number;
  channels: number;
  peak: number;
}> {
  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error("The Web Audio API is unavailable in this runtime.");
  }
  const context = new AudioContextCtor();
  try {
    const arrayBuffer = await source.arrayBuffer();
    const audioBuffer = await context.decodeAudioData(arrayBuffer);
    const channel = audioBuffer.getChannelData(0);
    const width = clamp(Math.round(options.width ?? 1200), 64, 4096);
    const height = clamp(Math.round(options.height ?? 400), 64, 2048);
    const { peaks, peak } = buildWaveformPeaks(channel, width);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("The 2D canvas context is unavailable.");

    ctx.fillStyle = options.background ?? "#0b0b10";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = options.color ?? "#ffde00";
    ctx.fillStyle = options.color ?? "#ffde00";
    ctx.lineWidth = 2;

    const middle = height / 2;
    const scale = options.normalize === false ? 1 : 1 / (peak || 1);

    if ((options.style ?? "wave") === "bars") {
      const barWidth = Math.max(1, Math.floor(width / peaks.length / 2) || 1);
      for (let bucket = 0; bucket < peaks.length / 2; bucket += 1) {
        const min = peaks[bucket * 2] * scale;
        const max = peaks[bucket * 2 + 1] * scale;
        const top = middle - max * middle;
        const bottom = middle - min * middle;
        ctx.fillRect(bucket * (barWidth + 1), top, barWidth, Math.max(1, bottom - top));
      }
    } else {
      ctx.beginPath();
      for (let bucket = 0; bucket < peaks.length / 2; bucket += 1) {
        const min = peaks[bucket * 2] * scale;
        const max = peaks[bucket * 2 + 1] * scale;
        const x = bucket;
        if (bucket === 0) ctx.moveTo(x, middle - max * middle);
        else ctx.lineTo(x, middle - max * middle);
        ctx.lineTo(x, middle - min * middle);
      }
      ctx.stroke();
    }

    const blob = await canvasToBlob(canvas, "image/png");
    return {
      blob,
      width,
      height,
      mimeType: "image/png",
      duration: audioBuffer.duration,
      sampleRate: audioBuffer.sampleRate,
      channels: audioBuffer.numberOfChannels,
      peak,
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}

export interface TextImageOptions {
  text: string;
  width?: number;
  height?: number;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  background?: string;
  align?: "left" | "center" | "right";
  padding?: number;
}

export async function renderTextImage(options: TextImageOptions): Promise<{
  blob: Blob;
  width: number;
  height: number;
  mimeType: string;
  lines: number;
}> {
  const width = clamp(Math.round(options.width ?? 1200), 64, 4096);
  const height = clamp(Math.round(options.height ?? 600), 64, 4096);
  const fontSize = clamp(Math.round(options.fontSize ?? 64), 8, 512);
  const padding = clamp(Math.round(options.padding ?? 48), 0, Math.min(width, height) / 2);
  const text = options.text ?? "";

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The 2D canvas context is unavailable.");

  context.fillStyle = options.background ?? "#101016";
  context.fillRect(0, 0, width, height);
  context.fillStyle = options.color ?? "#ffde00";
  context.font = `600 ${fontSize}px ${options.fontFamily ?? "Inter, system-ui, sans-serif"}`;
  context.textBaseline = "middle";
  context.textAlign = options.align ?? "center";

  const lineHeight = fontSize * 1.35;
  const lines = text.split("\n");
  const blockHeight = lineHeight * lines.length;
  let y = Math.max(padding + fontSize / 2, (height - blockHeight) / 2 + fontSize / 2);
  const x =
    (options.align ?? "center") === "left"
      ? padding
      : (options.align ?? "center") === "right"
        ? width - padding
        : width / 2;

  for (const line of lines) {
    context.fillText(line, x, y, Math.max(16, width - padding * 2));
    y += lineHeight;
  }

  const blob = await canvasToBlob(canvas, "image/png");
  return { blob, width, height, mimeType: "image/png", lines: lines.length };
}

export interface QrRenderOptions {
  text: string;
  ecLevel?: QrEcLevel;
  moduleSize?: number;
  margin?: number;
  dark?: string;
  light?: string;
  format?: ImageFormat;
  quality?: number;
}

export async function renderQrCode(options: QrRenderOptions): Promise<{
  blob: Blob;
  width: number;
  height: number;
  mimeType: string;
  version: number;
  ecLevel: QrEcLevel;
  mask: number;
}> {
  const code = encodeQrCode(options.text, { ecLevel: options.ecLevel ?? "M" });
  const moduleSize = clamp(Math.round(options.moduleSize ?? 8), 1, 40);
  const margin = clamp(Math.round(options.margin ?? 4), 0, 16);
  const total = (code.size + margin * 2) * moduleSize;

  const canvas = document.createElement("canvas");
  canvas.width = total;
  canvas.height = total;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The 2D canvas context is unavailable.");
  drawQrCode(code, context, {
    moduleSize,
    margin,
    dark: options.dark ?? "#000000",
    light: options.light ?? "#ffffff",
  });

  const format = options.format ?? "png";
  const mimeType = mimeForFormat(format);
  const blob = await canvasToBlob(canvas, mimeType, options.quality ?? 0.95);
  return {
    blob,
    width: total,
    height: total,
    mimeType,
    version: code.version,
    ecLevel: code.ecLevel,
    mask: code.mask,
  };
}

export async function extractColorPalette(
  source: Blob,
  options: { count?: number; ignoreTransparent?: boolean; swatchSize?: number } = {},
): Promise<{
  blob: Blob;
  width: number;
  height: number;
  mimeType: string;
  swatches: PaletteSwatch[];
  sampled: number;
}> {
  const image = await loadImageElement(source);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("The 2D canvas context is unavailable.");
  context.drawImage(image, 0, 0);
  const frame = context.getImageData(0, 0, canvas.width, canvas.height);

  const swatches = quantizePalette(frame.data, {
    count: options.count ?? 6,
    ignoreTransparent: options.ignoreTransparent ?? true,
  });

  const swatchSize = clamp(Math.round(options.swatchSize ?? 96), 16, 512);
  const columns = Math.max(1, swatches.length);
  const out = document.createElement("canvas");
  out.width = swatchSize * columns;
  out.height = swatchSize;
  const outContext = out.getContext("2d");
  if (!outContext) throw new Error("The 2D canvas context is unavailable.");
  outContext.fillStyle = "#0b0b10";
  outContext.fillRect(0, 0, out.width, out.height);
  swatches.forEach((swatch, index) => {
    outContext.fillStyle = swatch.hex;
    outContext.fillRect(index * swatchSize, 0, swatchSize, swatchSize);
  });

  const blob = await canvasToBlob(out, "image/png");
  return {
    blob,
    width: out.width,
    height: out.height,
    mimeType: "image/png",
    swatches,
    sampled: swatches.reduce((total, swatch) => total + swatch.weight, 0),
  };
}
