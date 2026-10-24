/**
 * KNOUX REC — real workflow chains.
 *
 * Four named chains that carry one artefact through several steps. Every step
 * calls a processor that already exists and is already verified elsewhere in
 * the product: the media tools, the recording engine's trimmer, the template
 * engine and the WebM exporter. This module owns no pixel math of its own — it
 * only sequences, measures and reports. If a step cannot run, the chain fails
 * honestly instead of substituting a simulation.
 */

import {
  convertImage,
  cropImage,
  extractColorPalette,
  extractVideoThumbnail,
  filterImage,
  resizeImage,
  type ImageFormat,
  type PaletteSwatch,
} from "./mediaTools";
import { trimMedia } from "./recordingEngine";
import type { CancellationToken } from "./mediaJobs";
import { exportTemplateVideo } from "./templateExport";
import { realTemplateEngine } from "../../services/realTemplateEngine";

export type ChainInput = "image" | "video" | "template";

export interface ChainArtifact {
  blob: Blob;
  mimeType: string;
  fileName: string;
  width?: number;
  height?: number;
  duration?: number;
  bytes: number;
  swatches?: PaletteSwatch[];
}

export interface ChainStepOutcome {
  id: string;
  labelEn: string;
  label: string;
  /** The existing processor this step delegates to. */
  processor: string;
  ok: boolean;
  ms: number;
  detail: string;
  artifact: ChainArtifact | null;
}

export interface ChainDefinition {
  id: string;
  labelEn: string;
  label: string;
  summaryEn: string;
  summary: string;
  input: ChainInput;
  steps: Array<{ id: string; labelEn: string; label: string; processor: string }>;
}

export interface ChainContext {
  onProgress: (fraction: number, message: string) => void;
  /**
   * The same mutable token the underlying processors poll, so cancelling a
   * chain really stops an in-flight encode rather than only the next step.
   */
  token: CancellationToken;
  signal?: AbortSignal;
}

export interface ChainRunResult {
  chainId: string;
  ok: boolean;
  ms: number;
  steps: ChainStepOutcome[];
  outputs: ChainArtifact[];
}

export class ChainCancelledError extends Error {
  constructor() {
    super("The workflow was cancelled.");
    this.name = "MediaJobCancelledError";
  }
}

export class ChainStepError extends Error {
  readonly stepId: string;

  constructor(stepId: string, message: string) {
    super(message);
    this.name = "ChainStepError";
    this.stepId = stepId;
  }
}

const toArtifact = (
  fileName: string,
  value: {
    blob: Blob;
    mimeType: string;
    width?: number;
    height?: number;
    duration?: number;
    swatches?: PaletteSwatch[];
  },
): ChainArtifact => ({
  blob: value.blob,
  mimeType: value.mimeType,
  fileName,
  width: value.width,
  height: value.height,
  duration: value.duration,
  bytes: value.blob.size,
  swatches: value.swatches,
});

const describe = (artifact: ChainArtifact | null): string => {
  if (!artifact) return "no output";
  const parts = [artifact.mimeType, `${artifact.bytes} B`];
  if (artifact.width && artifact.height) parts.push(`${artifact.width}x${artifact.height}`);
  if (artifact.duration) parts.push(`${artifact.duration.toFixed(2)}s`);
  if (artifact.swatches?.length) parts.push(`${artifact.swatches.length} swatches`);
  return parts.join(" · ");
};

async function guard(ctx: ChainContext): Promise<void> {
  if (ctx.token.cancelled || ctx.signal?.aborted) throw new ChainCancelledError();
}

/** Runs one timed step and records what the processor actually produced. */
async function step(
  definition: ChainDefinition["steps"][number],
  ctx: ChainContext,
  work: () => Promise<Omit<ChainStepOutcome, "ms">>,
): Promise<ChainStepOutcome> {
  await guard(ctx);
  const started = performance.now();
  ctx.onProgress(0, `${definition.labelEn}…`);
  try {
    const result = await work();
    return { ...result, ms: Math.round(performance.now() - started) };
  } catch (cause) {
    if (cause instanceof ChainCancelledError) throw cause;
    throw new ChainStepError(
      definition.id,
      cause instanceof Error ? cause.message : "The step failed.",
    );
  }
}

export const CHAINS: ChainDefinition[] = [
  {
    id: "social-cover",
    labelEn: "Social cover",
    label: "غلاف اجتماعي",
    summaryEn: "Cover the share box, crop it exactly, grade it, then encode a WebP.",
    summary: "تغطية صندوق المشاركة ثم قصه بدقة ثم تلوينه ثم ترميزه WebP.",
    input: "image",
    steps: [
      { id: "resize", labelEn: "Resize", label: "تحجيم", processor: "mediaTools.resizeImage" },
      { id: "crop", labelEn: "Crop", label: "قص", processor: "mediaTools.cropImage" },
      { id: "grade", labelEn: "Grade", label: "تدرّج", processor: "mediaTools.filterImage" },
      { id: "encode", labelEn: "Encode WebP", label: "ترميز WebP", processor: "mediaTools.convertImage" },
    ],
  },
  {
    id: "clip-cover",
    labelEn: "Clip cover",
    label: "غلاف مقطع",
    summaryEn: "Pull a real frame from a clip and read its palette.",
    summary: "استخراج إطار حقيقي من المقطع وقراءة لوحة ألوانه.",
    input: "video",
    steps: [
      { id: "thumbnail", labelEn: "Frame", label: "إطار", processor: "mediaTools.extractVideoThumbnail" },
      { id: "palette", labelEn: "Palette", label: "لوحة ألوان", processor: "mediaTools.extractColorPalette" },
    ],
  },
  {
    id: "trim-and-cover",
    labelEn: "Trim and cover",
    label: "قص وتغطية",
    summaryEn: "Re-encode a slice of the clip, then cover the trimmed result.",
    summary: "إعادة ترميز جزء من المقطع ثم استخراج غلاف للنتيجة.",
    input: "video",
    steps: [
      { id: "trim", labelEn: "Trim", label: "قص", processor: "recordingEngine.trimMedia" },
      { id: "thumbnail", labelEn: "Frame", label: "إطار", processor: "mediaTools.extractVideoThumbnail" },
    ],
  },
  {
    id: "motion-ident",
    labelEn: "Motion ident",
    label: "هوية متحركة",
    summaryEn: "Render a template still and its WebM animation from one spec.",
    summary: "رسم صورة ثابتة للقالب وفيديو WebM من نفس المواصفات.",
    input: "template",
    steps: [
      { id: "still", labelEn: "Still", label: "صورة ثابتة", processor: "realTemplateEngine.renderTemplate" },
      { id: "video", labelEn: "WebM", label: "فيديو WebM", processor: "templateExport.exportTemplateVideo" },
    ],
  },
];

export function chainById(id: string): ChainDefinition | undefined {
  return CHAINS.find((chain) => chain.id === id);
}

const TEMPLATE_SETTINGS = {
  resolution: { width: 1280, height: 720 },
  fps: 30,
  quality: "export" as const,
  format: "webm" as const,
  backgroundColor: "#05050a",
};

/**
 * Execute a chain. `input` is the source blob for image and video chains; the
 * template chain ignores it and drives the real template engine instead.
 */
export async function runChain(
  chainId: string,
  input: Blob | null,
  ctx: ChainContext,
  options: { templateId?: string; title?: string; trimStart?: number; trimEnd?: number } = {},
): Promise<ChainRunResult> {
  const chain = chainById(chainId);
  if (!chain) throw new Error(`Unknown chain: ${chainId}`);
  if (chain.input !== "template" && (!input || input.size === 0)) {
    throw new Error("This chain needs a source file.");
  }
  const started = performance.now();
  const steps: ChainStepOutcome[] = [];

  const record = async (
    index: number,
    work: () => Promise<Omit<ChainStepOutcome, "ms">>,
  ) => {
    const definition = chain.steps[index];
    const outcome = await step(definition, ctx, work);
    steps.push(outcome);
    ctx.onProgress((index + 1) / chain.steps.length, `${definition.labelEn} done`);
    return outcome;
  };

  if (chain.id === "social-cover") {
    const source = input as Blob;
    const BOX = { width: 1200, height: 630 };
    const resized = await record(0, async () => {
      const value = await resizeImage(source, { mode: "fill", width: BOX.width, height: BOX.height });
      return {
        id: "resize",
        labelEn: "Resize",
        label: "تحجيم",
        processor: "mediaTools.resizeImage",
        ok: true,
        ms: 0,
        detail: `${value.width}x${value.height} · ${value.blob.size} B`,
        artifact: toArtifact("cover-resized.png", value),
      };
    });
    const cropped = await record(1, async () => {
      const artifact = resized.artifact as ChainArtifact;
      const width = Math.min(BOX.width, artifact.width as number);
      const height = Math.min(BOX.height, artifact.height as number);
      const value = await cropImage(artifact.blob, {
        x: Math.max(0, Math.round(((artifact.width as number) - width) / 2)),
        y: Math.max(0, Math.round(((artifact.height as number) - height) / 2)),
        width,
        height,
        format: "png",
      });
      if (value.width !== BOX.width || value.height !== BOX.height) {
        throw new Error(
          `The share box could not be reached (${value.width}x${value.height}).`,
        );
      }
      return {
        id: "crop",
        labelEn: "Crop",
        label: "قص",
        processor: "mediaTools.cropImage",
        ok: true,
        ms: 0,
        detail: `${value.width}x${value.height} · ${value.blob.size} B`,
        artifact: toArtifact("cover-cropped.png", value),
      };
    });
    const graded = await record(2, async () => {
      const value = await filterImage(
        cropped.artifact?.blob as Blob,
        { brightness: 4, contrast: 14, saturation: 16 },
        { format: "png" },
      );
      return {
        id: "grade",
        labelEn: "Grade",
        label: "تدرّج",
        processor: "mediaTools.filterImage",
        ok: true,
        ms: 0,
        detail: `${value.width}x${value.height} · ${value.blob.size} B`,
        artifact: toArtifact("cover-graded.png", value),
      };
    });
    const encoded = await record(3, async () => {
      const format: ImageFormat = "webp";
      const value = await convertImage(graded.artifact?.blob as Blob, { format, quality: 86 });
      if (!value.blob.size) throw new Error("The WebP encoder produced no bytes.");
      return {
        id: "encode",
        labelEn: "Encode WebP",
        label: "ترميز WebP",
        processor: "mediaTools.convertImage",
        ok: true,
        ms: 0,
        detail: `${value.width}x${value.height} · ${value.blob.size} B`,
        artifact: toArtifact("cover.webp", value),
      };
    });
    return finish(chain.id, steps, [encoded.artifact as ChainArtifact], started);
  }

  if (chain.id === "clip-cover") {
    const source = input as Blob;
    const thumb = await record(0, async () => {
      const value = await extractVideoThumbnail(source, { time: 0.35, format: "png" });
      if (!value.width || !value.height) throw new Error("The clip produced no decodable frame.");
      return {
        id: "thumbnail",
        labelEn: "Frame",
        label: "إطار",
        processor: "mediaTools.extractVideoThumbnail",
        ok: true,
        ms: 0,
        detail: `${value.width}x${value.height} · ${value.blob.size} B @ ${value.timestamp.toFixed(2)}s`,
        artifact: toArtifact("clip-cover.png", value),
      };
    });
    const palette = await record(1, async () => {
      const value = await extractColorPalette(thumb.artifact?.blob as Blob, { count: 6 });
      if (!value.swatches.length) throw new Error("No colours could be sampled.");
      return {
        id: "palette",
        labelEn: "Palette",
        label: "لوحة ألوان",
        processor: "mediaTools.extractColorPalette",
        ok: true,
        ms: 0,
        detail: value.swatches.map((swatch) => swatch.hex).join(" "),
        artifact: toArtifact("clip-palette.png", value),
      };
    });
    return finish(chain.id, steps, [thumb.artifact as ChainArtifact, palette.artifact as ChainArtifact], started);
  }

  if (chain.id === "trim-and-cover") {
    const source = input as Blob;
    const start = options.trimStart ?? 0;
    const end = options.trimEnd ?? 1.2;
    const trimmed = await record(0, async () => {
      const blob = await trimMedia(source, start, end, (fraction) =>
        ctx.onProgress(fraction * 0.5, "re-encoding"),
      );
      if (!blob.size) throw new Error("The trim produced no bytes.");
      return {
        id: "trim",
        labelEn: "Trim",
        label: "قص",
        processor: "recordingEngine.trimMedia",
        ok: true,
        ms: 0,
        detail: `${blob.size} B · ${start.toFixed(2)}s–${end.toFixed(2)}s`,
        artifact: {
          blob,
          mimeType: blob.type || "video/webm",
          fileName: "trimmed.webm",
          duration: Math.max(0, end - start),
          bytes: blob.size,
        },
      };
    });
    const cover = await record(1, async () => {
      const value = await extractVideoThumbnail(trimmed.artifact?.blob as Blob, {
        time: 0.2,
        format: "png",
      });
      return {
        id: "thumbnail",
        labelEn: "Frame",
        label: "إطار",
        processor: "mediaTools.extractVideoThumbnail",
        ok: true,
        ms: 0,
        detail: `${value.width}x${value.height} · ${value.blob.size} B`,
        artifact: toArtifact("trimmed-cover.png", value),
      };
    });
    return finish(chain.id, steps, [trimmed.artifact as ChainArtifact, cover.artifact as ChainArtifact], started);
  }

  /* template chain */
  const templateId = options.templateId;
  if (!templateId) throw new Error("No template was selected for this chain.");
  const customizations = { title: options.title ?? "KNOUX REC" };
  const still = await record(0, async () => {
    const canvas = await realTemplateEngine.renderTemplate(
      templateId,
      customizations,
      TEMPLATE_SETTINGS,
      0.5,
    );
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("The still encoder failed."))),
        "image/png",
      );
    });
    return {
      id: "still",
      labelEn: "Still",
      label: "صورة ثابتة",
      processor: "realTemplateEngine.renderTemplate",
      ok: true,
      ms: 0,
      detail: `${canvas.width}x${canvas.height} · ${blob.size} B`,
      artifact: {
        blob,
        mimeType: "image/png",
        fileName: "ident-still.png",
        width: canvas.width,
        height: canvas.height,
        bytes: blob.size,
      },
    };
  });
  const video = await record(1, async () => {
    const output = await exportTemplateVideo(
      {
        templateId,
        customizations,
        width: 1280,
        height: 720,
        fps: 30,
        duration: 1.6,
      },
      (report) => ctx.onProgress(report.percent / 100, report.message),
      ctx.token,
    );
    return {
      id: "video",
      labelEn: "WebM",
      label: "فيديو WebM",
      processor: "templateExport.exportTemplateVideo",
      ok: true,
      ms: 0,
      detail: `${output.blob.size} B · ${output.codec} · ${output.frames} frames · ${output.duration.toFixed(2)}s`,
      artifact: {
        blob: output.blob,
        mimeType: output.mimeType,
        fileName: "ident.webm",
        duration: output.duration,
        bytes: output.blob.size,
      },
    };
  });
  return finish(chain.id, steps, [still.artifact as ChainArtifact, video.artifact as ChainArtifact], started);
}

function finish(
  chainId: string,
  steps: ChainStepOutcome[],
  outputs: ChainArtifact[],
  started: number,
): ChainRunResult {
  return {
    chainId,
    ok: steps.every((entry) => entry.ok),
    ms: Math.round(performance.now() - started),
    steps,
    outputs,
  };
}

export function describeStep(step: ChainStepOutcome): string {
  return step.detail || describe(step.artifact);
}
