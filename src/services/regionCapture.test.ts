import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { captureRegion, regionPixels, clampRegion, stageRegionToSourcePixels } from "./regionCapture";

describe("stageRegionToSourcePixels", () => {
  it("maps a centered contained image without using devicePixelRatio", () => {
    // 1920x1080 source is displayed 800x450 in an 800x600 stage (75px letterbox).
    expect(stageRegionToSourcePixels(
      { x: 100, y: 175, width: 200, height: 100 },
      { width: 800, height: 600 },
      { width: 1920, height: 1080 },
    )).toEqual({ x: 240, y: 240, width: 480, height: 240 });
  });
  it("rejects selections entirely in black letterboxing", () => {
    expect(() => stageRegionToSourcePixels(
      { x: 20, y: 10, width: 100, height: 30 },
      { width: 800, height: 600 },
      { width: 1920, height: 1080 },
    )).toThrow(/outside the captured/);
  });
});

describe("regionPixels", () => {
  it("converts CSS region to device pixels", () => {
    expect(regionPixels({ x: 10, y: 20, width: 100, height: 200 }, 2)).toEqual({
      x: 20,
      y: 40,
      width: 200,
      height: 400,
    });
  });
  it("rounds fractional device pixels up for size", () => {
    expect(regionPixels({ x: 0, y: 0, width: 3, height: 3 }, 1.5)).toEqual({
      x: 0,
      y: 0,
      width: 5,
      height: 5,
    });
  });
});

describe("clampRegion", () => {
  it("clamps a region that exceeds the canvas", () => {
    expect(clampRegion({ x: 100, y: 100, width: 200, height: 200 }, 150, 150)).toEqual({
      x: 100,
      y: 100,
      width: 50,
      height: 50,
    });
  });
  it("never produces a zero-size region", () => {
    const clamped = clampRegion({ x: 149, y: 149, width: 10, height: 10 }, 150, 150);
    expect(clamped.width).toBeGreaterThan(0);
    expect(clamped.height).toBeGreaterThan(0);
  });
});

let originalAddEventListener: HTMLVideoElement["addEventListener"];

function stubVideoSurface(): void {
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
    value: 400,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
    value: 300,
    writable: true,
    configurable: true,
  });
  originalAddEventListener = HTMLVideoElement.prototype.addEventListener;
  HTMLVideoElement.prototype.addEventListener = function (
    this: HTMLVideoElement,
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (type === "loadedmetadata") {
      window.setTimeout(() => listener.call(this, new Event("loadedmetadata")), 0);
    }
    return originalAddEventListener.call(this, type, listener, options);
  } as unknown as HTMLVideoElement["addEventListener"];
}

function restoreVideoSurface(): void {
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { value: 0, writable: true, configurable: true });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { value: 0, writable: true, configurable: true });
  HTMLVideoElement.prototype.addEventListener = originalAddEventListener;
}

describe("captureRegion", () => {
  beforeEach(() => {
    stubVideoSurface();
  });
  afterEach(() => {
    restoreVideoSurface();
    vi.restoreAllMocks();
  });

  it("crops a real frame to the requested region and returns an image", async () => {
    const result = await captureRegion({
      region: { x: 50, y: 60, width: 100, height: 80 },
      mimeType: "png",
      sourceStream: ({} as unknown as MediaStream),
    });
    const dpr = window.devicePixelRatio || 1;
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.mimeType).toBe("image/png");
    expect(result.width).toBe(Math.ceil(100 * dpr));
    expect(result.height).toBe(Math.ceil(80 * dpr));
    expect(result.devicePixelRatio).toBe(dpr);
    expect(result.sourceSize.width).toBe(400);
    expect(result.sourceSize.height).toBe(300);
  });

  it("rejects quickly when the display picker is denied", async () => {
    const original = navigator.mediaDevices.getDisplayMedia;
    navigator.mediaDevices.getDisplayMedia = vi.fn(() =>
      Promise.reject(new Error("NotAllowedError: permission denied")),
    );
    try {
      await expect(
        captureRegion({ region: { x: 0, y: 0, width: 10, height: 10 } }),
      ).rejects.toThrow(/permission denied/);
    } finally {
      navigator.mediaDevices.getDisplayMedia = original;
    }
  });
});
