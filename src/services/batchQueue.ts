/**
 * KNOUX REC — batch processing queue.
 *
 * A bounded worker pool over the image processors that are already verified
 * elsewhere in the product. The pool itself is pure scheduling and is unit
 * tested with fake tasks; the operations below delegate to `mediaTools` and the
 * Elysian `imageOps` pipeline, so nothing here re-implements pixel work.
 *
 * Memory is bounded on purpose: at most `concurrency` files are in flight, each
 * worker holds one source and one output at a time, and only the finished blob
 * is retained per job.
 */

import {
  convertImage,
  cropImage,
  resizeImage,
  type ImageFormat,
} from "./mediaTools";
import { applyOps, type Pixels } from "./imageOps";
import type { ProvenanceRecord } from "../state/types";

export type BatchOperation = "resize" | "convert" | "crop" | "watermark";

export interface BatchSettings {
  operation: BatchOperation;
  width: number;
  height: number;
  /** resize behaviour, mirroring the single-file tool. */
  mode: "fit" | "fill" | "stretch";
  format: ImageFormat;
  quality: number;
  /** centred crop to this aspect ratio, e.g. 1, 16/9, 4/3 */
  aspect: number;
  watermarkText: string;
  watermarkOpacity: number;
  watermarkSize: number;
}

export type BatchItemStatus =
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "cancelled";

export interface BatchOutput {
  blob: Blob;
  mimeType: string;
  fileName: string;
  width: number;
  height: number;
  bytes: number;
}

export interface BatchItem {
  id: string;
  name: string;
  inputBytes: number;
  mimeType: string;
  status: BatchItemStatus;
  progress: number;
  error: string | null;
  ms: number;
  output: BatchOutput | null;
  blob: Blob;
  /** Where this file came from, when it was handed over rather than imported. */
  provenance?: ProvenanceRecord[];
}

export interface PoolReport {
  done: number;
  failed: number;
  cancelled: number;
  total: number;
}

export interface PoolOptions {
  concurrency: number;
  isCancelled: () => boolean;
  onItem: (id: string, patch: Partial<BatchItem>) => void;
}

/**
 * Run `task` over `items` with at most `concurrency` in flight. A rejected task
 * fails only its own item; cancellation stops new starts and marks the rest.
 */
export async function runPool<T extends { id: string }>(
  items: T[],
  task: (item: T) => Promise<void>,
  options: PoolOptions,
): Promise<PoolReport> {
  const queue = [...items];
  const report: PoolReport = { done: 0, failed: 0, cancelled: 0, total: items.length };
  const workers: Promise<void>[] = [];
  const width = Math.max(1, Math.min(options.concurrency, items.length || 1));

  for (let slot = 0; slot < width; slot += 1) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          if (options.isCancelled()) break;
          const item = queue.shift() as T;
          try {
            await task(item);
            if (options.isCancelled()) {
              report.cancelled += 1;
            } else {
              report.done += 1;
            }
          } catch (cause) {
            // A cancellation is never recorded as a failure, whether it came
            // from the flag or from the task throwing.
            const cancelled = cause instanceof BatchCancelledError || options.isCancelled();
            if (cancelled) {
              report.cancelled += 1;
            } else {
              report.failed += 1;
            }
            options.onItem(item.id, {
              status: cancelled ? "cancelled" : "failed",
              error: cause instanceof Error ? cause.message : "The job failed.",
              progress: 0,
            });
          }
        }
      })(),
    );
  }

  await Promise.all(workers);
  const left = queue.length;
  report.cancelled += left;
  return report;
}

export class BatchCancelledError extends Error {
  constructor() {
    super("The batch was cancelled.");
    this.name = "BatchCancelledError";
  }
}

/* ------------------------------------------------------------------ */
/* Operations — each one calls an existing verified processor          */
/* ------------------------------------------------------------------ */

function pixelsFromBlob(blob: Blob): Promise<Pixels> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(blob);
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("The 2D canvas context is unavailable.");
        context.drawImage(image, 0, 0);
        const data = context.getImageData(0, 0, canvas.width, canvas.height);
        resolve({
          width: data.width,
          height: data.height,
          data: new Uint8ClampedArray(data.data),
        });
      } catch (cause) {
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The image could not be decoded."));
    };
    image.src = url;
  });
}

function blobFromPixels(pixels: Pixels, format: ImageFormat, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    const context = canvas.getContext("2d");
    if (!context) return reject(new Error("The 2D canvas context is unavailable."));
    if (format !== "png") {
      context.fillStyle = "#000000";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error(`The ${format.toUpperCase()} encoder produced no bytes.`)),
      `image/${format}`,
      format === "png" ? undefined : quality / 100,
    );
  });
}

/**
 * The watermark reuses the Elysian text pipeline. It is given a real glyph
 * rasteriser backed by a canvas, so the batch output is the same pixels the
 * single-file studio produces.
 */
async function rasteriseWatermark(pixels: Pixels, settings: BatchSettings): Promise<Pixels> {
  const overlay = document.createElement("canvas");
  overlay.width = pixels.width;
  overlay.height = pixels.height;
  const surface = document.createElement("canvas");
  surface.width = pixels.width;
  surface.height = pixels.height;
  const surfaceContext = surface.getContext("2d", { willReadFrequently: true });
  if (!surfaceContext) throw new Error("The 2D canvas context is unavailable.");

  const target: Pixels = {
    width: pixels.width,
    height: pixels.height,
    data: new Uint8ClampedArray(pixels.data),
  };

  await applyOps(
    target,
    [
      {
        kind: "watermark",
        text: settings.watermarkText || "KNOUX",
        size: Math.max(8, Math.round(settings.watermarkSize)),
        opacity: settings.watermarkOpacity,
        angle: -28,
        step: 34,
        color: "#ffffff",
      },
    ],
    (working, draw) => {
      // 1. paint the glyphs onto a clean transparent overlay;
      const overlayContext = overlay.getContext("2d");
      if (!overlayContext) return;
      overlayContext.clearRect(0, 0, overlay.width, overlay.height);
      draw(overlayContext, working.width, working.height);
      // 2. composite that overlay over the current pixels;
      surfaceContext.clearRect(0, 0, surface.width, surface.height);
      surfaceContext.putImageData(
        new ImageData(working.data, working.width, working.height),
        0,
        0,
      );
      surfaceContext.drawImage(overlay, 0, 0);
      // 3. and read the composited result back into the pipeline.
      working.data.set(surfaceContext.getImageData(0, 0, working.width, working.height).data);
    },
  );

  return target;
}

export function centredCrop(width: number, height: number, aspect: number) {
  const sourceAspect = width / height;
  let cropWidth = width;
  let cropHeight = height;
  if (sourceAspect > aspect) {
    cropHeight = height;
    cropWidth = Math.round(height * aspect);
  } else {
    cropWidth = width;
    cropHeight = Math.round(width / aspect);
  }
  cropWidth = Math.max(1, Math.min(width, cropWidth));
  cropHeight = Math.max(1, Math.min(height, cropHeight));
  return {
    x: Math.round((width - cropWidth) / 2),
    y: Math.round((height - cropHeight) / 2),
    width: cropWidth,
    height: cropHeight,
  };
}

export const DEFAULT_SETTINGS: BatchSettings = {
  operation: "resize",
  width: 1024,
  height: 768,
  mode: "fit",
  format: "jpeg",
  quality: 88,
  aspect: 1,
  watermarkText: "KNOUX REC",
  watermarkOpacity: 16,
  watermarkSize: 34,
};

/** Run one file through the configured operation and verify the output. */
export async function processItem(
  item: BatchItem,
  settings: BatchSettings,
): Promise<BatchOutput> {
  const extension = settings.format === "jpeg" ? "jpg" : settings.format;
  const base = item.name.replace(/\.[^.]+$/, "") || "image";
  const fileName = `${base}-batch.${extension}`;

  if (settings.operation === "resize") {
    const value = await resizeImage(item.blob, {
      mode: settings.mode,
      width: settings.width,
      height: settings.height,
      format: settings.format,
      quality: settings.quality,
    });
    return {
      blob: value.blob,
      mimeType: value.mimeType,
      fileName,
      width: value.width,
      height: value.height,
      bytes: value.blob.size,
    };
  }

  if (settings.operation === "convert") {
    const value = await convertImage(item.blob, {
      format: settings.format,
      quality: settings.quality,
    });
    return {
      blob: value.blob,
      mimeType: value.mimeType,
      fileName,
      width: value.width,
      height: value.height,
      bytes: value.blob.size,
    };
  }

  if (settings.operation === "crop") {
    const probe = await pixelsFromBlob(item.blob);
    const box = centredCrop(probe.width, probe.height, settings.aspect);
    const value = await cropImage(item.blob, {
      ...box,
      format: settings.format,
      quality: settings.quality,
    });
    return {
      blob: value.blob,
      mimeType: value.mimeType,
      fileName,
      width: value.width,
      height: value.height,
      bytes: value.blob.size,
    };
  }

  const pixels = await pixelsFromBlob(item.blob);
  const marked = await rasteriseWatermark(pixels, settings);
  const blob = await blobFromPixels(marked, settings.format, settings.quality);
  const verified = await pixelsFromBlob(blob);
  return {
    blob,
    mimeType: `image/${settings.format}`,
    fileName,
    width: verified.width,
    height: verified.height,
    bytes: blob.size,
  };
}

/** Decode the produced blob so a corrupt output can never be reported as done. */
export async function verifyOutput(output: BatchOutput): Promise<void> {
  const probe = await pixelsFromBlob(output.blob);
  if (!probe.width || !probe.height) {
    throw new Error("The output image has no decodable size.");
  }
  if (probe.width !== output.width || probe.height !== output.height) {
    throw new Error(
      `The output reports ${output.width}x${output.height} but decodes as ${probe.width}x${probe.height}.`,
    );
  }
  if (!output.bytes || output.blob.size !== output.bytes) {
    throw new Error("The recorded byte size does not match the produced blob.");
  }
}
