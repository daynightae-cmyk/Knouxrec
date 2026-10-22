import { describe, it, expect } from "vitest";
import { patchWebmDuration } from "../services/webm";

const makeWebm = (hasDuration = false) => {
  const ebmlHeader = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
  const segment = hasDuration
    ? new Uint8Array([0x18, 0x53, 0x80, 0x67, 0x01, 0x01, 0x86, 0x81, 0x01])
    : new Uint8Array([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  return new Blob([ebmlHeader, segment], { type: "video/webm" });
};

describe("patchWebmDuration", () => {
  it("returns original blob on invalid input", async () => {
    const blob = new Blob(["not webm"], { type: "video/webm" });
    const out = await patchWebmDuration(blob, 5000);
    expect(out).toBe(blob);
  });

  it("returns original blob for malformed WebM (fallback behavior)", async () => {
    const blob = makeWebm(false);
    const patched = await patchWebmDuration(blob, 4840);
    expect(patched).toBe(blob);
  });
});