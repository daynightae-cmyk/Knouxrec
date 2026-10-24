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
/** Signals a capture session that produced nothing; retried once by the caller. */
export class EmptyCaptureError extends Error {
  constructor() {
    super("The encoder produced an empty video.");
    this.name = "EmptyCaptureError";
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
 * Encode a template to WebM, retrying once if the capture session delivered
 * nothing at all. Cancellation is never retried.
 */
export async function exportTemplateVideo(
  spec: TemplateExportSpec,
  onProgress: (report: TemplateExportReport) => void,
  token: { cancelled: boolean },
): Promise<TemplateExportOutput> {
  try {
    return await exportTemplateVideoOnce(spec, onProgress, token);
  } catch (cause) {
    if (cause instanceof EmptyCaptureError && !token.cancelled) {
      onProgress({ percent: 1, message: "The capture produced nothing; retrying once." });
      return exportTemplateVideoOnce(spec, onProgress, token);
    }
    throw cause;
  }
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

  // A fixed capture rate is what Chromium delivers reliably from a canvas
  // stream. It has a consequence that used to be hidden: the encoded length is
  // the number of frames the compositor actually presented divided by this
  // rate, so on a machine that cannot sustain spec.fps the clip comes out
  // shorter than requested. The loop below records a short tail to reduce that,
  // and the result now reports the duration measured from the produced file
  // next to the one that was asked for, so the shortfall is visible.
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
  // Extra wall time recorded after the animation reaches its end.
  const TAIL_SECONDS = 0.35;
  try {
    recorder.start(100);
    // The clip is paced by delivered frames, not by the wall clock. A canvas
    // captureStream advances its media time by the frames it is actually given,
    // so a wall-clock loop on a busy machine stops after fewer frames than
    // requested and silently produces a short video. Driving the loop from the
    // frame count makes the encoded duration equal the request even when the
    // machine needs longer than real time to get there.
    const targetFrames = Math.max(1, Math.round(spec.duration * spec.fps));
    const startedAt = performance.now();
    await new Promise<void>((resolve) => {
      const tick = async () => {
        if (token.cancelled) {
          resolve();
          return;
        }
        // The animation follows the wall clock and the loop stops on the wall
        // clock. Because the stream now carries real timestamps, that makes the
        // encoded clip the requested length whatever frame rate the machine
        // sustains; only the smoothness changes, never the duration.
        const elapsed = (performance.now() - startedAt) / 1000;
        const time = Math.min(spec.duration, elapsed);
        // Recording runs a short tail past the animation so the container's
        // last timestamp is at or after the requested length. A clip that ends
        // a quarter second early loses the closing frame; holding the finished
        // frame for a moment does not.
        await engine.renderTemplate(
          spec.templateId,
          spec.customizations,
          settings,
          time,
        );
        frames += 1;
        onProgress({
          percent: Math.round((time / spec.duration) * 100),
          message: `Rendering and encoding frame ${frames} (target ${targetFrames})`,
        });
        if (elapsed >= spec.duration + TAIL_SECONDS) {
          resolve();
          return;
        }
        window.requestAnimationFrame(() => void tick());
      };
      window.requestAnimationFrame(() => void tick());
    });

    // Give the encoder a moment to capture the final frame.
    await new Promise((resolve) => window.setTimeout(resolve, 120));
    if (recorder.state !== "inactive") recorder.stop();
    await stopped;

    if (token.cancelled) throw new TemplateExportCancelledError();

    const blob = new Blob(chunks, { type: mimeType.split(";")[0] });
    if (blob.size < 1000) {
      // Chromium sometimes delivers no frame at all to a canvas capture stream
      // for a given recording session. Retrying once is bounded and keeps a
      // single lost session from failing an export that is otherwise fine.
      throw new EmptyCaptureError();
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
