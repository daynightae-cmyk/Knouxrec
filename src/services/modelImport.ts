/**
 * Safe local model import.
 *
 * KNOUX REC never downloads models automatically and never executes remote
 * code. The only supported installation path is explicit user consent: the
 * user picks a local model manifest (and its weight file), the manifest is
 * validated, the weight bytes are hashed with SHA-256, and the result is
 * reported honestly. Nothing is written into the application bundle and no
 * model is marked runnable until the weights are present and verified.
 */

export interface ModelImportFile {
  name: string;
  size: number;
  type: string;
  sha256: string;
  buffer: ArrayBuffer;
}

export interface ModelImportReport {
  ok: boolean;
  reason?: string;
  manifestSha256?: string;
  manifest?: {
    modelName: string;
    version: string;
    description: string;
    weightsPath: string;
    expectedWeightsBytes: number;
    tensorCount: number;
    capabilities: string[];
    source: string | null;
    license: string | null;
  };
  weights?: {
    name: string;
    size: number;
    sha256: string;
    matchesDeclaredSize: boolean;
    sha256Trusted: boolean;
  };
}

const MAX_MANIFEST_BYTES = 4 * 1024 * 1024; // 4 MiB manifest cap
const MAX_WEIGHTS_BYTES = 8 * 1024 * 1024 * 1024; // 8 GiB weights cap

interface TensorShape {
  name?: string;
  shape?: number[];
  dtype?: string;
}

interface WeightsGroup {
  paths?: string[];
  weights?: TensorShape[];
}

interface ManifestShape {
  modelName?: string;
  version?: string;
  description?: string;
  generatedBy?: string;
  source?: string;
  license?: string;
  /** Independently trusted SHA-256 of the weight file, if the publisher provides one. */
  expectedWeightsSha256?: string;
  weightsManifest?: WeightsGroup[];
  userDefinedMetadata?: {
    capabilities?: string[];
    inputSize?: number[];
    outputFormat?: string;
  };
}

function shapeBytes(shape: number[] | undefined, dtype: string | undefined): number {
  if (!shape || shape.length === 0) return 0;
  const elements = shape.reduce((total, value) => total * Math.max(1, value), 1);
  return elements * (dtype === "float16" ? 2 : dtype === "int8" || dtype === "bool" || dtype === "uint8" ? 1 : 4);
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto is not available in this runtime.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function parseManifest(buffer: ArrayBuffer): ManifestShape | null {
  try {
    const text = new TextDecoder().decode(buffer);
    return JSON.parse(text) as ManifestShape;
  } catch {
    return null;
  }
}

export async function importModelFiles(
  manifestFile: File,
  weightsFile: File | null,
): Promise<ModelImportReport> {
  const report: ModelImportReport = { ok: false };

  if (manifestFile.size === 0) {
    report.reason = "The manifest file is empty.";
    return report;
  }
  if (manifestFile.size > MAX_MANIFEST_BYTES) {
    report.reason = `The manifest exceeds ${Math.round(MAX_MANIFEST_BYTES / 1024 / 1024)} MiB.`;
    return report;
  }

  const manifestBuffer = await manifestFile.arrayBuffer();
  const manifest = parseManifest(manifestBuffer);
  if (!manifest) {
    report.reason = "The manifest is not valid JSON.";
    return report;
  }

  const group = manifest.weightsManifest?.[0];
  const weightsPath = group?.paths?.[0] ?? "weights.bin";
  const tensors = group?.weights ?? [];
  const expectedWeightsBytes = tensors.reduce(
    (total, tensor) => total + shapeBytes(tensor.shape, tensor.dtype),
    0,
  );

  const manifestSha256 = await sha256Hex(manifestBuffer);
  report.manifestSha256 = manifestSha256;

  report.manifest = {
    modelName: manifest.modelName ?? manifestFile.name.replace(/\.json$/i, ""),
    version: manifest.version ?? "",
    description: manifest.description ?? "",
    weightsPath,
    expectedWeightsBytes,
    tensorCount: tensors.length,
    capabilities: manifest.userDefinedMetadata?.capabilities ?? [],
    source: manifest.source ?? manifest.generatedBy ?? null,
    license: manifest.license ?? null,
  };

  if (!weightsFile) {
    report.ok = true;
    report.reason = "Manifest parsed (catalog-only); no model was installed or made executable.";
    return report;
  }

  if (weightsFile.size === 0) {
    report.reason = "The weight file is empty.";
    return report;
  }
  if (weightsFile.size > MAX_WEIGHTS_BYTES) {
    report.reason = `The weight file exceeds ${Math.round(MAX_WEIGHTS_BYTES / 1024 / 1024 / 1024)} GiB.`;
    return report;
  }

  const weightsBuffer = await weightsFile.arrayBuffer();
  const weightsSha256 = await sha256Hex(weightsBuffer);
  const matchesDeclaredSize = expectedWeightsBytes > 0 && weightsBuffer.byteLength === expectedWeightsBytes;

  // Trusted hash: only meaningful when the manifest carries an independently
  // trusted expected SHA-256. Computing a hash and displaying it is not proof
  // of authenticity; it must match a value from an authorized source.
  let sha256Trusted = true;
  if (manifest.expectedWeightsSha256) {
    sha256Trusted =
      weightsSha256.toLowerCase() === String(manifest.expectedWeightsSha256).toLowerCase();
  }

  report.weights = {
    name: weightsFile.name,
    size: weightsBuffer.byteLength,
    sha256: weightsSha256,
    matchesDeclaredSize,
    sha256Trusted,
  };

  report.ok = matchesDeclaredSize && expectedWeightsBytes > 0 && sha256Trusted;
  if (!report.ok) {
    if (!sha256Trusted && manifest.expectedWeightsSha256) {
      report.reason = "Weight SHA-256 does not match the trusted value in the manifest.";
    } else {
      report.reason = `Weight size ${weightsBuffer.byteLength.toLocaleString()} does not match a valid declared size of ${expectedWeightsBytes.toLocaleString()} bytes.`;
    }
  } else {
    report.reason = "Manifest and selected file sizes match; SHA-256 fingerprint computed. No model was installed, activated, or independently authenticated beyond this local inspection.";
  }
  return report;
}

export { shapeBytes, sha256Hex, parseManifest };
export type { ManifestShape };
export { MAX_MANIFEST_BYTES, MAX_WEIGHTS_BYTES };
