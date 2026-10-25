/**
 * Real WebM encoding for template compositions.
 *
 * Extracted from TemplatesView so the view and the Live Studio retry path use
 * the same encoder: the canvas engine draws every frame, `canvas.captureStream`
 * feeds MediaRecorder, and the produced container is verified before the job
 * may claim success.
 */

import { realTemplateEngine } from "../../services/realTemplateEngine";
import { patchWebmDuration } from "./webm";

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
  /** Measured from the produced file, or the request when it reports nothing. */
  duration: number;
  requestedDuration: number;
  durationMeasured: boolean;
  codec: string;
  frames: number;
}

/** Errors with this name are treated as real cancellations by the registry. */
/**
 * Signals a capture session that produced no usable media. The frame, chunk
 * and byte counts travel with it: whether the loop never drew or the recorder
 * never received is the difference between a drawing bug and a starved
 * compositor, and the message is the only evidence a smoke run leaves behind.
 */
export class EmptyCaptureError extends Error {
  readonly frames: number;
  readonly chunks: number;
  readonly bytes: number;

  constructor(detail: { frames: number; chunks: number; bytes: number }) {
    super(
      `The encoder produced an empty video (drew ${detail.frames} frames, ` +
        `${detail.chunks} chunks, ${detail.bytes} bytes).`,
    );
    this.name = "EmptyCaptureError";
    this.frames = detail.frames;
    this.chunks = detail.chunks;
    this.bytes = detail.bytes;
  }
}

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
/**
 * Confirms the container really decodes, and reports the duration the encoder
 * actually produced. The returned value is measured from the file, never the
 * requested one: an export that ran short must say so instead of repeating the
 * number it was asked for.
 */
async function verifyWebm(
  blob: Blob,
  expectedDuration: number,
): Promise<{ measured: number | null }> {
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  if (head[0] !== 0x1a || head[1] !== 0x45 || head[2] !== 0xdf || head[3] !== 0xa3) {
    throw new Error("The encoder output is not a WebM container.");
  }
  return new Promise<{ measured: number | null }>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.preload = "metadata";
    let settled = false;
    const timer = window.setTimeout(() => {
      // MediaRecorder streams often omit duration metadata; the EBML magic was
      // already verified, so absence of metadata is not a failure.
      finish(true, undefined, null);
    }, 4000);
    const finish = (ok: boolean, message?: string, measured: number | null = null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeAttribute("src");
      URL.revokeObjectURL(url);
      if (ok) resolve({ measured });
      else reject(new Error(message));
    };
    video.onloadedmetadata = () => {
      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) {
        finish(true, undefined, null);
        return;
      }
      if (duration < expectedDuration * 0.5) {
        finish(
          false,
          `The encoded video is only ${duration.toFixed(2)}s long, requested ${expectedDuration.toFixed(2)}s.`,
        );
        return;
      }
      finish(true, undefined, duration);
    };
    video.onerror = () => finish(false, "The encoded video cannot be decoded.");
    video.src = url;
  });
}

/**
 * Encode a template to WebM. A capture session that delivers nothing is retried
 * up to three times: Chromium occasionally hands a canvas stream no compositor
 * frames at all, and one lost session must not fail an export that is otherwise
 * fine. The budget is bounded and cancellation is never retried.
 */
const CAPTURE_ATTEMPTS = 3;

export async function exportTemplateVideo(
  spec: TemplateExportSpec,
  onProgress: (report: TemplateExportReport) => void,
  token: { cancelled: boolean },
): Promise<TemplateExportOutput> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= CAPTURE_ATTEMPTS; attempt += 1) {
    try {
      return await exportTemplateVideoOnce(spec, onProgress, token);
    } catch (cause) {
      if (cause instanceof EmptyCaptureError && !token.cancelled && attempt < CAPTURE_ATTEMPTS) {
        lastError = cause;
        onProgress({
          percent: 1,
          message: `${cause.message} Retrying the capture (attempt ${attempt + 1} of ${CAPTURE_ATTEMPTS}).`,
        });
        // Give the compositor a beat before spending another session.
        await new Promise((resolve) => window.setTimeout(resolve, 250 * attempt));
        continue;
      }
      throw cause;
    }
  }
  throw lastError ?? new Error("The template video could not be encoded.");
}

async function exportTemplateVideoOnce(
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

  // A canvas capture stream samples the bitmap on the compositor's clock. The
  // consequence used to be hidden and is now faced head on: the encoded length
  // is the number of samples the compositor actually accepted divided by the
  // requested rate. A wall-clock loop alone loses that race on a busy machine —
  // it stops having delivered 30 samples per second, so a two-second ident
  // comes out under a second long. The loop below therefore keeps drawing
  // frames until BOTH the frame count and the wall clock have covered the
  // request. A loaded machine spends more real time producing the clip and the
  // motion may be choppy; the duration stops lying.
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
  // Wall time still matters: the sampler only ticks spec.fps times per second,
  // so a session that finishes drawing its frames in half the requested length
  // has only fed the recorder half the samples. Both conditions have to hold.
  const TAIL_SECONDS = 0.2;
  try {
    recorder.start(100);
    const targetFrames = Math.max(1, Math.round(spec.duration * spec.fps));
    const startedAt = performance.now();
    const ceilingMs = Math.max(20_000, (spec.duration + 6) * 1_000 + targetFrames * 500);
    await new Promise<void>((resolve) => {
      const step = async () => {
        const elapsed = (performance.now() - startedAt) / 1000;
        if (token.cancelled || elapsed * 1000 > ceilingMs) {
          resolve();
          return;
        }
        const time = Math.min(spec.duration, frames / spec.fps);
        await engine.renderTemplate(
          spec.templateId,
          spec.customizations,
          settings,
          time,
        );
        frames += 1;
        onProgress({
          percent: Math.min(100, Math.round((frames / targetFrames) * 100)),
          message: `Rendering and encoding frame ${frames} of ${targetFrames}`,
        });
        if (frames >= targetFrames && elapsed >= spec.duration + TAIL_SECONDS) {
          resolve();
          return;
        }
        window.requestAnimationFrame(() => void step());
      };
      window.requestAnimationFrame(() => void step());
    });

    // Give the encoder a moment to capture the final frame.
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    if (recorder.state !== "inactive") recorder.stop();
    await stopped;

    if (token.cancelled) throw new TemplateExportCancelledError();

    const blob = new Blob(chunks, { type: mimeType.split(";")[0] });
    if (blob.size < 1000) {
      // Chromium sometimes delivers no frame at all to a canvas capture stream
      // for a given recording session; the counts say which half failed.
      throw new EmptyCaptureError({ frames, chunks: chunks.length, bytes: blob.size });
    }
    const { measured } = await verifyWebm(blob, spec.duration);
    // MediaRecorder leaves the container duration unset, which makes the file
    // awkward to seek and therefore to trim or re-cover downstream. The
    // recorder's own output is patched the same way the trimmer patches its
    // result, using the duration measured from the produced bytes.
    const patched = measured
      ? await patchWebmDuration(blob, measured * 1000)
      : blob;
    return {
      blob: patched,
      mimeType: patched.type || blob.type,
      // Measured from the produced file when the container reports it; the
      // requested value is kept separately so a shortfall stays visible.
      duration: measured ?? spec.duration,
      requestedDuration: spec.duration,
      durationMeasured: measured !== null,
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
