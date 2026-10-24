/**
 * Shared typed job runner for the KNOUX REC media tools.
 *
 * Every tool goes through the same lifecycle so the UI never has to special
 * case a processor:
 *
 *   VALIDATE -> PROCESS -> VERIFY -> DONE
 *
 * Progress is derived from completed stages only. Cancellation is real: the
 * runner checks the token between stages and refuses to report a result that
 * was produced after the job was cancelled.
 */

import {
  MEDIA_TOOLS,
  convertImage,
  cropImage,
  extractColorPalette,
  extractVideoThumbnail,
  filterImage,
  pixelateImage,
  renderAudioWaveform,
  renderQrCode,
  renderTextImage,
  resizeImage,
  rotateImage,
  type ImageAdjustments,
  type ImageFormat,
  type MediaToolDescriptor,
  type MediaToolId,
  type MediaToolResult,
  type QrRenderOptions,
  type ResizeOptions,
  type TextImageOptions,
} from "./mediaTools";
import type { QrEcLevel } from "./qrCode";
import { sanitizeFileName } from "../lib/format";

export type MediaJobStage =
  | "idle"
  | "validating"
  | "processing"
  | "verifying"
  | "done"
  | "cancelled"
  | "error";

export interface MediaJobProgress {
  stage: MediaJobStage;
  /** 0..1, derived from the stages that actually finished. */
  progress: number;
  message: string;
}

export interface MediaJobRequest {
  toolId: MediaToolId;
  file?: Blob;
  fileName?: string;
  text?: string;
  options: Record<string, unknown>;
}

export interface CancellationToken {
  cancelled: boolean;
}

export class MediaJobCancelledError extends Error {
  constructor() {
    super("The job was cancelled.");
    this.name = "MediaJobCancelledError";
  }
}

export class MediaJobValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaJobValidationError";
  }
}

export function findTool(toolId: MediaToolId): MediaToolDescriptor | undefined {
  return MEDIA_TOOLS.find((tool) => tool.id === toolId);
}

/** Reject an input the tool cannot process, before any work is started. */
export function validateRequest(request: MediaJobRequest): void {
  const tool = findTool(request.toolId);
  if (!tool) {
    throw new MediaJobValidationError(`Unknown tool "${request.toolId}".`);
  }
  if (tool.inputKind === "text") {
    const text = (request.text ?? "").trim();
    if (!text) {
      throw new MediaJobValidationError("Enter the text that should be processed.");
    }
    return;
  }
  if (!request.file) {
    throw new MediaJobValidationError("Choose a file to process.");
  }
  const type = request.file.type;
  if (type && tool.accepts.length > 0 && !tool.accepts.includes(type)) {
    throw new MediaJobValidationError(
      `${tool.name} does not accept ${type}. Accepted: ${tool.accepts.join(", ")}.`,
    );
  }
  if (request.file.size === 0) {
    throw new MediaJobValidationError("The selected file is empty.");
  }
}

function assertNotCancelled(token: CancellationToken): void {
  if (token.cancelled) throw new MediaJobCancelledError();
}

/** Re-decode an image result so a "done" state always means real bytes. */
async function verifyImageOutput(blob: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("The produced image cannot be decoded."));
      element.src = url;
    });
    return {
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function baseName(fileName: string | undefined, fallback: string): string {
  if (!fileName) return fallback;
  // Only a real trailing extension is removed: a URL such as
  // "https://knoux.app/qr" must not lose everything after its first dot.
  const withoutExtension =
    fileName.includes("/") || fileName.includes("\\")
      ? fileName
      : fileName.replace(/\.[a-zA-Z0-9]{1,5}$/, "");
  // Exported names must survive Windows' file system rules.
  return sanitizeFileName(withoutExtension.length > 0 ? withoutExtension : fallback);
}

function optionNumber(
  options: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const value = options[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionString(
  options: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const value = options[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function optionBoolean(
  options: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = options[key];
  return typeof value === "boolean" ? value : fallback;
}

async function processTool(
  request: MediaJobRequest,
  token: CancellationToken,
): Promise<MediaToolResult> {
  const { toolId, file, options } = request;
  const tool = findTool(toolId)!;
  const logs: string[] = [];

  assertNotCancelled(token);

  switch (toolId) {
    case "image-resize": {
      const resizeOptions: ResizeOptions & { format?: ImageFormat; quality?: number } = {
        mode: (optionString(options, "mode", "fit") as ResizeOptions["mode"]),
        width: optionNumber(options, "width", 1280),
        height: optionNumber(options, "height", 720),
        percentage: optionNumber(options, "percentage", 100),
        format: optionString(options, "format", "png") as ImageFormat,
        quality: optionNumber(options, "quality", 92) / 100,
      };
      const output = await resizeImage(file!, resizeOptions);
      logs.push(`Resampled to ${output.width}×${output.height}.`);
      return {
        toolId,
        blob: output.blob,
        mimeType: output.mimeType,
        fileName: `${baseName(request.fileName, "image")}-resized.${output.mimeType === "image/jpeg" ? "jpg" : output.mimeType.split("/")[1]}`,
        width: output.width,
        height: output.height,
        bytes: output.blob.size,
        metrics: { width: output.width, height: output.height, mode: resizeOptions.mode },
        logs,
      };
    }
    case "image-filters": {
      const adjustments: ImageAdjustments = {
        exposure: optionNumber(options, "exposure", 0),
        brightness: optionNumber(options, "brightness", 0),
        contrast: optionNumber(options, "contrast", 0),
        saturation: optionNumber(options, "saturation", 0),
        grayscale: optionNumber(options, "grayscale", 0),
        sepia: optionNumber(options, "sepia", 0),
        blur: optionNumber(options, "blur", 0),
      };
      const output = await filterImage(file!, adjustments, {
        format: optionString(options, "format", "png") as ImageFormat,
        quality: optionNumber(options, "quality", 92) / 100,
      });
      logs.push("Applied per-pixel adjustments.");
      return {
        toolId,
        blob: output.blob,
        mimeType: output.mimeType,
        fileName: `${baseName(request.fileName, "image")}-filtered.${output.mimeType === "image/jpeg" ? "jpg" : output.mimeType.split("/")[1]}`,
        width: output.width,
        height: output.height,
        bytes: output.blob.size,
        metrics: { ...adjustments, width: output.width, height: output.height },
        logs,
      };
    }
    case "image-convert": {
      const format = optionString(options, "format", "png") as ImageFormat;
      const output = await convertImage(file!, {
        format,
        quality: optionNumber(options, "quality", 90) / 100,
        background: optionString(options, "background", "#101016"),
      });
      logs.push(`Encoded as ${output.mimeType}.`);
      return {
        toolId,
        blob: output.blob,
        mimeType: output.mimeType,
        fileName: `${baseName(request.fileName, "image")}.${format === "jpeg" ? "jpg" : format}`,
        width: output.width,
        height: output.height,
        bytes: output.blob.size,
        metrics: { format, width: output.width, height: output.height },
        logs,
      };
    }
    case "image-rotate": {
      const rotation = Math.round(Number(optionString(options, "rotation", "90")) || 0);
      const flipHorizontal = optionBoolean(options, "flipH", false);
      const flipVertical = optionBoolean(options, "flipV", false);
      const format = optionString(options, "format", "png") as ImageFormat;
      const output = await rotateImage(file!, {
        rotation,
        flipHorizontal,
        flipVertical,
        format,
        quality: optionNumber(options, "quality", 92) / 100,
      });
      logs.push(
        `Rotated ${((rotation % 360) + 360) % 360}°${flipHorizontal ? " · flipped horizontally" : ""}${flipVertical ? " · flipped vertically" : ""}.`,
      );
      return {
        toolId,
        blob: output.blob,
        mimeType: output.mimeType,
        fileName: `${baseName(request.fileName, "image")}-rotated.${format === "jpeg" ? "jpg" : format}`,
        width: output.width,
        height: output.height,
        bytes: output.blob.size,
        metrics: {
          rotation: ((rotation % 360) + 360) % 360,
          flipHorizontal,
          flipVertical,
          width: output.width,
          height: output.height,
        },
        logs,
      };
    }
    case "image-crop": {
      const cropWidth = Math.round(optionNumber(options, "cropWidth", 512));
      const cropHeight = Math.round(optionNumber(options, "cropHeight", 512));
      if (cropWidth < 2 || cropHeight < 2) {
        throw new MediaJobValidationError("Choose a crop size of at least 2×2 pixels.");
      }
      const format = optionString(options, "format", "png") as ImageFormat;
      const output = await cropImage(file!, {
        x: Math.round(optionNumber(options, "cropX", 0)),
        y: Math.round(optionNumber(options, "cropY", 0)),
        width: cropWidth,
        height: cropHeight,
        format,
        quality: optionNumber(options, "quality", 92) / 100,
      });
      logs.push(`Cropped to ${output.width}×${output.height}.`);
      return {
        toolId,
        blob: output.blob,
        mimeType: output.mimeType,
        fileName: `${baseName(request.fileName, "image")}-cropped.${format === "jpeg" ? "jpg" : format}`,
        width: output.width,
        height: output.height,
        bytes: output.blob.size,
        metrics: { width: output.width, height: output.height },
        logs,
      };
    }
    case "image-pixelate": {
      const block = Math.round(optionNumber(options, "block", 12));
      const format = optionString(options, "format", "png") as ImageFormat;
      const output = await pixelateImage(file!, {
        block,
        format,
        quality: optionNumber(options, "quality", 92) / 100,
      });
      logs.push(`Mosaicked through a ${block}px grid.`);
      return {
        toolId,
        blob: output.blob,
        mimeType: output.mimeType,
        fileName: `${baseName(request.fileName, "image")}-pixelated.${format === "jpeg" ? "jpg" : format}`,
        width: output.width,
        height: output.height,
        bytes: output.blob.size,
        metrics: { block, width: output.width, height: output.height },
        logs,
      };
    }
    case "video-thumbnail": {
      const output = await extractVideoThumbnail(file!, {
        time: optionNumber(options, "time", 1),
        format: optionString(options, "format", "png") as ImageFormat,
        quality: optionNumber(options, "quality", 92) / 100,
      });
      logs.push(`Grabbed the frame at ${output.timestamp.toFixed(2)}s.`);
      return {
        toolId,
        blob: output.blob,
        mimeType: output.mimeType,
        fileName: `${baseName(request.fileName, "video")}-thumbnail.${output.mimeType === "image/jpeg" ? "jpg" : "png"}`,
        width: output.width,
        height: output.height,
        duration: output.duration,
        bytes: output.blob.size,
        metrics: {
          timestamp: Number(output.timestamp.toFixed(3)),
          duration: Number(output.duration.toFixed(3)),
          width: output.width,
          height: output.height,
        },
        logs,
      };
    }
    case "audio-visualizer": {
      const output = await renderAudioWaveform(file!, {
        width: optionNumber(options, "width", 1200),
        height: optionNumber(options, "height", 400),
        color: optionString(options, "color", "#ffde00"),
        background: optionString(options, "background", "#0b0b10"),
        style: optionString(options, "style", "wave") as "wave" | "bars",
        normalize: optionBoolean(options, "normalize", true),
      });
      logs.push(
        `Decoded ${output.duration.toFixed(2)}s at ${output.sampleRate} Hz and drew the waveform.`,
      );
      return {
        toolId,
        blob: output.blob,
        mimeType: output.mimeType,
        fileName: `${baseName(request.fileName, "audio")}-waveform.png`,
        width: output.width,
        height: output.height,
        duration: output.duration,
        bytes: output.blob.size,
        metrics: {
          duration: Number(output.duration.toFixed(3)),
          sampleRate: output.sampleRate,
          channels: output.channels,
          peak: Number(output.peak.toFixed(4)),
        },
        logs,
      };
    }
    case "text-image": {
      const renderOptions: TextImageOptions = {
        text: request.text ?? "",
        width: optionNumber(options, "width", 1200),
        height: optionNumber(options, "height", 600),
        fontSize: optionNumber(options, "fontSize", 64),
        fontFamily: optionString(options, "fontFamily", "Inter, system-ui, sans-serif"),
        color: optionString(options, "color", "#ffde00"),
        background: optionString(options, "background", "#101016"),
        align: optionString(options, "align", "center") as "left" | "center" | "right",
        padding: optionNumber(options, "padding", 48),
      };
      const output = await renderTextImage(renderOptions);
      logs.push(`Rendered ${output.lines} line(s) of text.`);
      return {
        toolId,
        blob: output.blob,
        mimeType: output.mimeType,
        fileName: `${baseName((request.text ?? "text").slice(0, 32), "text")}.png`,
        width: output.width,
        height: output.height,
        bytes: output.blob.size,
        metrics: { lines: output.lines, width: output.width, height: output.height },
        logs,
      };
    }
    case "qr-code": {
      const renderOptions: QrRenderOptions = {
        text: request.text ?? "",
        ecLevel: optionString(options, "ecLevel", "M") as QrEcLevel,
        moduleSize: optionNumber(options, "moduleSize", 8),
        margin: optionNumber(options, "margin", 4),
        dark: optionString(options, "dark", "#000000"),
        light: optionString(options, "light", "#ffffff"),
        format: "png",
      };
      const output = await renderQrCode(renderOptions);
      logs.push(
        `Encoded a version ${output.version} symbol with level ${output.ecLevel} correction (mask ${output.mask}).`,
      );
      return {
        toolId,
        blob: output.blob,
        mimeType: output.mimeType,
        fileName: `${baseName((request.text ?? "qr").slice(0, 32), "qr")}.png`,        width: output.width,
        height: output.height,
        bytes: output.blob.size,
        metrics: {
          version: output.version,
          ecLevel: output.ecLevel,
          mask: output.mask,
          width: output.width,
          height: output.height,
        },
        logs,
      };
    }
    case "color-palette": {
      const output = await extractColorPalette(file!, {
        count: optionNumber(options, "count", 6),
        ignoreTransparent: optionBoolean(options, "ignoreTransparent", true),
      });
      logs.push(
        `Extracted ${output.swatches.length} colour(s) from the sampled pixels.`,
      );
      return {
        toolId,
        blob: output.blob,
        mimeType: output.mimeType,
        fileName: `${baseName(request.fileName, "image")}-palette.png`,
        width: output.width,
        height: output.height,
        bytes: output.blob.size,
        metrics: {
          swatches: output.swatches.map((swatch) => swatch.hex).join(", "),
          colours: output.swatches.length,
        },
        logs,
      };
    }
    default:
      throw new MediaJobValidationError(`The tool "${tool.name}" has no processor.`);
  }
}

/**
 * Run a media tool end to end and report real progress.
 */
export async function executeMediaJob(
  request: MediaJobRequest,
  onProgress: (progress: MediaJobProgress) => void,
  token: CancellationToken,
): Promise<MediaToolResult> {
  onProgress({ stage: "validating", progress: 0.05, message: "Validating the input" });
  validateRequest(request);
  assertNotCancelled(token);

  onProgress({ stage: "processing", progress: 0.35, message: "Processing" });
  const result = await processTool(request, token);
  assertNotCancelled(token);
  onProgress({ stage: "verifying", progress: 0.8, message: "Verifying the output" });
  if (result.mimeType.startsWith("image/")) {
    const verified = await verifyImageOutput(result.blob);
    result.width = verified.width;
    result.height = verified.height;
    result.metrics.verifiedWidth = verified.width;
    result.metrics.verifiedHeight = verified.height;
  }
  if (result.blob.size === 0) {
    throw new Error("The processor produced an empty file.");
  }
  assertNotCancelled(token);

  onProgress({ stage: "done", progress: 1, message: "Done" });
  return result;
}
