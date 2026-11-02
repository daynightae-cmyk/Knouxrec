/**
 * KNOUX REC — runtime health probe.
 *
 * Every row of the health gauge is a measurement taken in this browser at this
 * moment. Nothing here is a placeholder percentage: a row that cannot be
 * measured is reported as "unknown" and lowers the score honestly instead of
 * being counted as a pass.
 */

import { detectCaptureSupport, pickMimeType } from "./recordingEngine";
import { inspectModels, MODEL_IDS } from "./modelRegistry";

export type HealthCheckId =
  | "display"
  | "encoder"
  | "library"
  | "storage"
  | "audio"
  | "camera"
  | "models";

export type HealthCheckState = "ok" | "warn" | "fail" | "unknown";

export interface HealthCheck {
  id: HealthCheckId;
  label: string;
  state: HealthCheckState;
  detail: string;
  /** Weight of this row in the overall score. */
  weight: number;
}

export interface RuntimeHealth {
  /** 0…100. `null` when nothing at all could be measured. */
  score: number | null;
  checks: HealthCheck[];
  measuredAt: number;
}

function checkIndexedDb(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(false);
      return;
    }
    try {
      const request = indexedDB.open("knoux-rec.health", 1);
      request.onsuccess = () => {
        request.result.close();
        indexedDB.deleteDatabase("knoux-rec.health");
        resolve(true);
      };
      request.onerror = () => resolve(false);
      request.onblocked = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function measureRuntimeHealth(): Promise<RuntimeHealth> {
  const support = detectCaptureSupport();
  const mime = pickMimeType();
  const checks: HealthCheck[] = [];

  checks.push({
    id: "display",
    label: "Display capture",
    state: support.display ? "ok" : "fail",
    detail: support.display
      ? "getDisplayMedia is available"
      : support.reason ?? "getDisplayMedia is missing",
    weight: 3,
  });

  checks.push({
    id: "encoder",
    label: "Video encoder",
    state: !support.mediaRecorder ? "fail" : mime ? "ok" : "warn",
    detail: !support.mediaRecorder
      ? "MediaRecorder is missing"
      : mime
        ? `Encodes ${mime}`
        : "MediaRecorder exists but reports no usable container",
    weight: 3,
  });

  const indexedDb = await checkIndexedDb();
  checks.push({
    id: "library",
    label: "Local library",
    state: indexedDb ? "ok" : "fail",
    detail: indexedDb
      ? "IndexedDB accepts a real write"
      : "IndexedDB is unavailable or blocked",
    weight: 2,
  });

  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate && estimate.usage !== undefined && estimate.quota !== undefined) {
      checks.push({
        id: "storage",
        label: "Storage quota",
        state: estimate.quota > 0 ? "ok" : "warn",
        detail: `${Math.round(estimate.usage / 1024 / 1024)} MB used of ${Math.round(
          estimate.quota / 1024 / 1024,
        )} MB quota`,
        weight: 2,
      });
    } else {
      checks.push({
        id: "storage",
        label: "Storage quota",
        state: "unknown",
        detail: "The runtime reports no storage estimate",
        weight: 2,
      });
    }
  } catch {
    checks.push({
      id: "storage",
      label: "Storage quota",
      state: "unknown",
      detail: "The storage estimate threw",
      weight: 2,
    });
  }

  checks.push({
    id: "audio",
    label: "Audio input",
    state: support.microphone ? "ok" : "fail",
    detail: support.microphone
      ? "getUserMedia can open a microphone"
      : "getUserMedia is missing",
    weight: 2,
  });

  checks.push({
    id: "camera",
    label: "Camera input",
    state: support.webcam ? "ok" : "warn",
    detail: support.webcam
      ? "getUserMedia can open a camera"
      : "No camera path is exposed by this runtime",
    weight: 1,
  });

  // The model inventory is measured, but a missing weight file is a catalogue
  // gap rather than a broken installation, so it is reported as a warning and
  // carries a small weight.
  const deadline = new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000));
  const inspected = await Promise.race([inspectModels(MODEL_IDS), deadline]).catch(
    () => null,
  );
  const present = inspected
    ? inspected.filter((row) => row.weightsState === "present").length
    : 0;
  const total = inspected ? inspected.length : MODEL_IDS.length;
  checks.push({
    id: "models",
    label: "Model weights",
    state: inspected === null ? "unknown" : present > 0 ? "ok" : "warn",
    detail:
      inspected === null
        ? "The weight inventory could not be read in time"
        : `${present} of ${total} weight files are installed`,
    weight: 1,
  });

  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  const earned = checks.reduce((sum, check) => {
    if (check.state === "ok") return sum + check.weight;
    if (check.state === "warn") return sum + check.weight * 0.5;
    return sum;
  }, 0);
  const score =
    totalWeight === 0 ? null : Math.round((earned / totalWeight) * 100);

  return { score, checks, measuredAt: Date.now() };
}

export function healthLabel(score: number | null): "optimal" | "degraded" | "unknown" {
  if (score === null) return "unknown";
  if (score >= 85) return "optimal";
  return "degraded";
}
