/**
 * Model registry — real inspection of the local model bundle.
 *
 * Every value reported here is measured:
 *  - the manifest is fetched and hashed with SHA-256,
 *  - the expected weight payload is derived from the tensor shapes in the
 *    manifest,
 *  - the weight file is probed for its real byte count.
 *
 * Nothing is downloaded and no model is ever marked ready because a JSON file
 * exists: a task is only runnable when the weight bytes are actually present.
 */

export type WeightState = "present" | "missing" | "unknown";

export interface ModelInspection {
  id: string;
  name: string;
  version: string;
  description: string;
  manifestPath: string;
  manifestBytes: number;
  manifestSha256: string | null;
  weightsPath: string;
  weightsState: WeightState;
  weightsBytes: number;
  /** Payload size derived from the declared tensor shapes. */
  expectedWeightsBytes: number;
  tensorCount: number;
  capabilities: string[];
  inputSize: number[] | null;
  outputFormat: string | null;
  source: string | null;
  license: string | null;
}

const DTYPE_BYTES: Record<string, number> = {
  float32: 4,
  float16: 2,
  int32: 4,
  int8: 1,
  uint8: 1,
  bool: 1,
};

function shapeBytes(shape: number[] | undefined, dtype: string | undefined): number {
  if (!shape || shape.length === 0) return 0;
  const elements = shape.reduce((total, value) => total * Math.max(1, value), 1);
  return elements * (DTYPE_BYTES[dtype ?? "float32"] ?? 4);
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) return "";
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

interface ManifestShape {
  modelName?: string;
  version?: string;
  description?: string;
  generatedBy?: string;
  source?: string;
  license?: string;
  userDefinedMetadata?: {
    capabilities?: string[];
    inputSize?: number[];
    outputFormat?: string;
  };
  weightsManifest?: Array<{
    paths?: string[];
    weights?: Array<{ name?: string; shape?: number[]; dtype?: string }>;
  }>;
}

/** Inspect one model folder from the local bundle. */
export async function inspectModel(id: string): Promise<ModelInspection> {
  const fallback: ModelInspection = {
    id,
    name: id,
    version: "",
    description: "",
    manifestPath: `models/${id}/model.json`,
    manifestBytes: 0,
    manifestSha256: null,
    weightsPath: `models/${id}/weights.bin`,
    weightsState: "unknown",
    weightsBytes: 0,
    expectedWeightsBytes: 0,
    tensorCount: 0,
    capabilities: [],
    inputSize: null,
    outputFormat: null,
    source: null,
    license: null,
  };

  const bridge = window.knouxDesktop;
  if (bridge?.inspectModel) {
    try {
      const info = await bridge.inspectModel(id);
      if (info) {
        return {
          ...fallback,
          id: info.id,
          name: info.name,
          description: info.description,
          weightsPath: info.weightsPath,
          weightsState: info.weightsState,
          weightsBytes: info.weightsBytes,
        };
      }
    } catch {
      /* fall through to the browser inspection */
    }
  }

  let manifestBytes = 0;
  let manifest: ManifestShape | null = null;
  let manifestSha256: string | null = null;
  try {
    const response = await fetch(new URL(`models/${id}/model.json`, document.baseURI));
    if (!response.ok) return fallback;
    const buffer = await response.arrayBuffer();
    manifestBytes = buffer.byteLength;
    manifest = JSON.parse(new TextDecoder().decode(buffer)) as ManifestShape;
    manifestSha256 = await sha256Hex(buffer);
  } catch {
    return fallback;
  }

  const group = manifest.weightsManifest?.[0];
  const weightsPath = group?.paths?.[0] ?? "weights.bin";
  const tensors = group?.weights ?? [];
  const expectedWeightsBytes = tensors.reduce(
    (total, tensor) => total + shapeBytes(tensor.shape, tensor.dtype),
    0,
  );

  let weightsState: WeightState = "missing";
  let weightsBytes = 0;
  try {
    const response = await fetch(
      new URL(`models/${id}/${weightsPath}`, document.baseURI),
      { method: "HEAD" },
    );
    const contentType = response.headers.get("content-type") ?? "";
    if (response.ok && !contentType.includes("text/html")) {
      weightsState = "present";
      weightsBytes = Number(response.headers.get("content-length") ?? 0) || 0;
    }
  } catch {
    weightsState = "unknown";
  }

  return {
    id,
    name: manifest.modelName ?? id,
    version: manifest.version ?? "",
    description: manifest.description ?? "",
    manifestPath: `models/${id}/model.json`,
    manifestBytes,
    manifestSha256,
    weightsPath: `models/${id}/${weightsPath}`,
    weightsState,
    weightsBytes,
    expectedWeightsBytes,
    tensorCount: tensors.length,
    capabilities: manifest.userDefinedMetadata?.capabilities ?? [],
    inputSize: manifest.userDefinedMetadata?.inputSize ?? null,
    outputFormat: manifest.userDefinedMetadata?.outputFormat ?? null,
    source: manifest.source ?? manifest.generatedBy ?? null,
    license: manifest.license ?? null,
  };
}

/** Inspect a list of models, one at a time so the bundle is not hammered. */
export async function inspectModels(ids: string[]): Promise<ModelInspection[]> {
  const results: ModelInspection[] = [];
  for (const id of ids) {
    results.push(await inspectModel(id));
  }
  return results;
}

export const MODEL_IDS = [
  "animatediff",
  "bark_tts",
  "beat_detector",
  "face_detection",
  "gpt4all",
  "llama2",
  "m2m100",
  "modnet",
  "real_esrgan",
  "rnnoise",
  "sadtalker",
  "sam",
  "scenecut",
  "selfie_segmentation",
  "simswap",
  "sovits",
  "spleeter",
  "stable_diffusion",
  "super_resolution",
  "u2net",
  "videocrafter",
  "wav2lip",
  "whisper",
  "yolo",
];
