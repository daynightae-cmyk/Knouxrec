import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  importModelFiles,
  parseManifest,
  shapeBytes,
  sha256Hex,
} from "./modelImport";

const realSubtle = globalThis.crypto?.subtle;

beforeEach(() => {
  Object.defineProperty(globalThis, "crypto", {
    value: {
      subtle: {
        digest: vi.fn(() => Promise.resolve(new ArrayBuffer(32))),
      },
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i;
        return arr;
      },
    },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, "crypto", {
    value: realSubtle,
    writable: true,
    configurable: true,
  });
});

function makeFile(name: string, bytes: Uint8Array, type: string): File {
  const file = {
    name,
    size: bytes.byteLength,
    type,
    arrayBuffer: () => Promise.resolve(bytes.buffer.slice(0)),
    stream: () => {
      throw new Error("stream not implemented");
    },
    text: () => Promise.resolve(new TextDecoder().decode(bytes)),
    slice: () => {
      throw new Error("slice not implemented");
    },
  } as unknown as File;
  return file;
}

describe("shapeBytes", () => {
  it("computes float32 tensor bytes", () => {
    expect(shapeBytes([3, 3, 3, 64], "float32")).toBe(3 * 3 * 3 * 64 * 4);
  });
  it("computes float16 tensor bytes", () => {
    expect(shapeBytes([2, 2], "float16")).toBe(2 * 2 * 2);
  });
  it("returns zero for empty shape", () => {
    expect(shapeBytes(undefined, "float32")).toBe(0);
  });
});

describe("parseManifest", () => {
  it("parses a valid manifest", () => {
    const buffer = new TextEncoder().encode('{"modelName":"x","version":"1"}').buffer;
    const m = parseManifest(buffer);
    expect(m?.modelName).toBe("x");
  });
  it("returns null for invalid JSON", () => {
    expect(parseManifest(new TextEncoder().encode("{not json").buffer)).toBeNull();
  });
});

describe("sha256Hex", () => {
  it("returns a hex digest", async () => {
    const digest = await sha256Hex(new TextEncoder().encode("hello").buffer);
    expect(/^[0-9a-f]{64}$/.test(digest)).toBe(true);
  });
});

describe("importModelFiles", () => {
  it("validates a manifest without weights and marks catalog-only", async () => {
    const manifest = makeFile("model.json", new TextEncoder().encode(JSON.stringify({ modelName: "Test", version: "1.0", weightsManifest: [{ paths: ["weights.bin"], weights: [{ name: "w", shape: [2, 2], dtype: "float32" }] }] })), "application/json");
    const report = await importModelFiles(manifest, null);
    expect(report.ok).toBe(true);
    expect(report.manifest?.modelName).toBe("Test");
    expect(report.manifest?.expectedWeightsBytes).toBe(2 * 2 * 4);
    expect(report.reason).toContain("catalog-only");
  });

  it("rejects an empty manifest", async () => {
    const manifest = makeFile("empty.json", new Uint8Array(0), "application/json");
    const report = await importModelFiles(manifest, null);
    expect(report.ok).toBe(false);
    expect(report.reason).toContain("empty");
  });

  it("rejects invalid JSON", async () => {
    const manifest = makeFile("bad.json", new TextEncoder().encode("{not json"), "application/json");
    const report = await importModelFiles(manifest, null);
    expect(report.ok).toBe(false);
    expect(report.reason).toContain("valid JSON");
  });

  it("validates a manifest with a matching weight file", async () => {
    const manifest = makeFile("model.json", new TextEncoder().encode(JSON.stringify({ weightsManifest: [{ paths: ["weights.bin"], weights: [{ name: "w", shape: [2], dtype: "float32" }] }] })), "application/json");
    const weights = makeFile("weights.bin", new Uint8Array(8), "application/octet-stream");
    const report = await importModelFiles(manifest, weights);
    expect(report.ok).toBe(true);
    expect(report.weights?.size).toBe(8);
    expect(report.weights?.matchesDeclaredSize).toBe(true);
    expect(typeof report.weights?.sha256).toBe("string");
  });

  it("reports a size mismatch", async () => {
    const manifest = makeFile("model.json", new TextEncoder().encode(JSON.stringify({ weightsManifest: [{ paths: ["weights.bin"], weights: [{ name: "w", shape: [1000], dtype: "float32" }] }] })), "application/json");
    const weights = makeFile("weights.bin", new Uint8Array(8), "application/octet-stream");
    const report = await importModelFiles(manifest, weights);
    expect(report.ok).toBe(false);
    expect(report.weights?.matchesDeclaredSize).toBe(false);
    expect(report.reason).toContain("does not match");
  });

  it("accepts a weight file whose hash matches the trusted manifest value", async () => {
    const digest = await sha256Hex(new Uint8Array(8).buffer);
    const manifest = makeFile(
      "model.json",
      new TextEncoder().encode(
        JSON.stringify({
          weightsManifest: [{ paths: ["weights.bin"], weights: [{ name: "w", shape: [2], dtype: "float32" }] }],
          expectedWeightsSha256: digest,
        }),
      ),
      "application/json",
    );
    const weights = makeFile("weights.bin", new Uint8Array(8), "application/octet-stream");
    const report = await importModelFiles(manifest, weights);
    expect(report.ok).toBe(true);
    expect(report.weights?.sha256Trusted).toBe(true);
  });

  it("rejects a weight file whose hash does not match the trusted manifest value", async () => {
    // crypto.subtle is mocked in beforeEach to return all-zero bytes, so the
    // computed SHA-256 is 64 zero hex digits. Use an expected value that
    // differs so the mismatch path is exercised for real.
    const manifest = makeFile(
      "model.json",
      new TextEncoder().encode(
        JSON.stringify({
          weightsManifest: [{ paths: ["weights.bin"], weights: [{ name: "w", shape: [2], dtype: "float32" }] }],
          expectedWeightsSha256: "0000000000000000000000000000000000000000000000000000000000000001",
        }),
      ),
      "application/json",
    );
    const weights = makeFile("weights.bin", new Uint8Array(8), "application/octet-stream");
    const report = await importModelFiles(manifest, weights);
    expect(report.ok).toBe(false);
    expect(report.weights?.sha256Trusted).toBe(false);
    expect(report.reason).toContain("SHA-256");
  });
});
