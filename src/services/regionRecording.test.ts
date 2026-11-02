import { describe, it, expect } from "vitest";
import { isUsableRegion, MIN_REGION_EDGE } from "./regionRecording";

/**
 * The maths that decides whether a chosen rectangle can become a real video.
 *
 * These are the guards that keep a selected-area recording honest: a region
 * that is empty, inverted, off-surface or non-finite must be refused before
 * the encoder is opened, rather than silently recorded as something else.
 */
describe("isUsableRegion", () => {
  it("accepts a rectangle at the minimum edge", () => {
    expect(
      isUsableRegion({ x: 0, y: 0, width: MIN_REGION_EDGE, height: MIN_REGION_EDGE }),
    ).toBe(true);
  });

  it("accepts a normal interior rectangle", () => {
    expect(
      isUsableRegion({ x: 461, y: 303, width: 1536, height: 864 }),
    ).toBe(true);
  });

  it("refuses a zero-sized rectangle", () => {
    expect(isUsableRegion({ x: 10, y: 10, width: 0, height: 0 })).toBe(false);
  });

  it("refuses a one-pixel sliver", () => {
    expect(isUsableRegion({ x: 10, y: 10, width: 1920, height: 1 })).toBe(false);
  });

  it("refuses an inverted rectangle instead of silently normalising it", () => {
    expect(isUsableRegion({ x: 100, y: 100, width: -40, height: -30 })).toBe(false);
  });

  it("refuses non-finite coordinates", () => {
    expect(
      isUsableRegion({ x: Number.NaN, y: 0, width: 100, height: 100 }),
    ).toBe(false);
    expect(
      isUsableRegion({ x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 100 }),
    ).toBe(false);
  });
});
