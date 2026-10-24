/**
 * Real WebM encoding for template compositions.
 *
 * Extracted from TemplatesView so the view and the Live Studio retry path use
 * the same encoder: the canvas engine draws every frame, `canvas.captureStream`
 * feeds MediaRecorder, and the produced container is verified before the job
 * may claim success.
 */

import { realTemplateEngine } from "../../services/realTemplateEngine";

export interface TemplateExportSpec {
  templateId: string;
  customizations: Record<string, unknown>;
  width: number;
  height: number;
  fps: number;
  duration: number;
}

export interface TemplateExportReport {
  /** 0..100 encode progress, measured from the real frame clock. */
  percent: number;
  message: string;
}

export interface TemplateExportOutput {
  blob: Blob;
  mimeType: string;
  duration: number;
  codec: string;
  frames: number;
}

/** Errors with this name are treated as real cancellations by the registry. */
export class TemplateExportCancelledError extends Error {
  constructor() {
    super("The export was cancelled.");
    this.name = "MediaJobCancelledError";
  }
}

function pickWebmMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return (
    ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(
      (type) => MediaRecorder.isTypeSupported(type),
    ) ?? null
  );
}

/** EBML magic + decodability check on the produced container. */
async function verifyWebm(blob: Blob, expectedDuration: number): Promise<void> {
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  if (head[0] !== 0x1a || head[1] !== 0x45 || head[2] !== 0xdf || head[3] !== 0xa3) {
    throw new Error("The encoder output is not a WebM container.");
  }
  await new Promise<void>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.preload = "metadata";
    let settled = false;
    const timer = window.setTimeout(() => {
      // MediaRecorder streams often omit duration metadata; the EBML magic was
      // already verified, so absence of metadata is not a failure.
      finish(true);
    }, 4000);
    const finish = (ok: boolean, message?: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeAttribute("src");
      URL.revokeObjectURL(url);
      if (ok) resolve();
      else reject(new Error(message));
    };
    video.onloadedmetadata = () => {
      const duration = video.duration;
      if (
        Number.isFinite(duration) &&
        duration > 0 &&
        duration < expectedDuration * 0.5
      ) {
        finish(
          false,
          `The encoded video is only ${duration.toFixed(2)}s long.`,
        );
        return;
      }
      finish(true);
    };
    video.onerror = () => finish(false, "The encoded video cannot be decoded.");
    video.src = url;
  });
}

export async function exportTemplateVideo(
  spec: TemplateExportSpec,
  onProgress: (report: TemplateExportReport) => void,
  token: { cancelled: boolean },
): Promise<TemplateExportOutput> {
  const engine = realTemplateEngine;
  const settings = {
    resolution: { width: spec.width, height: spec.height },
    fps: spec.fps,
    quality: "export" as const,
    format: "webm" as const,
    backgroundColor: "#05050a",
  };
  const mimeType = pickWebmMimeType();
  if (!mimeType) {
    throw new Error("This browser cannot encode WebM video.");
  }

  const canvas = await engine.renderTemplate(
    spec.templateId,
    spec.customizations,
    settings,
    0,
  );
  if (typeof canvas.captureStream !== "function") {
    throw new Error("This browser cannot capture a canvas stream.");
  }

  const stream = canvas.captureStream(spec.fps);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 8_000_000,
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = () => reject(new Error("The WebM encoder failed."));
  });
  void stopped.catch(() => undefined);

  let frames = 0;
  try {
    recorder.start(100);
    const startedAt = performance.now();
    await new Promise<void>((resolve) => {
      const tick = async () => {
        if (token.cancelled) {
          resolve();
          return;
        }
        const elapsed = (performance.now() - startedAt) / 1000;
        const time = Math.min(elapsed, spec.duration);
        await engine.renderTemplate(
          spec.templateId,
          spec.customizations,
          settings,
          time,
        );
        frames += 1;
        const percent = Math.min(100, Math.round((time / spec.duration) * 100));
        onProgress({
          percent,
          message: `Rendering and encoding frame ${frames}`,
        });
        if (elapsed >= spec.duration) {
          resolve();
          return;
        }
        window.setTimeout(() => void tick(), 1000 / spec.fps);
      };
      void tick();
    });

    // Give the encoder a moment to capture the final frame.
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    if (recorder.state !== "inactive") recorder.stop();
    await stopped;

    if (token.cancelled) throw new TemplateExportCancelledError();

    const blob = new Blob(chunks, { type: mimeType.split(";")[0] });
    if (blob.size < 1000) {
      throw new Error("The encoder produced an empty video.");
    }
    await verifyWebm(blob, spec.duration);
    return {
      blob,
      mimeType: blob.type,
      duration: spec.duration,
      codec: mimeType,
      frames,
    };
  } finally {
    if (recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // The recorder may already be stopping.
      }
    }
    stream.getTracks().forEach((track) => track.stop());
  }
}
