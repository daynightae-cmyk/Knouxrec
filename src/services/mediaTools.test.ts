import { describe, expect, it } from "vitest";
import {
  compressionReport,
  frameSheetLayout,
  frameSheetTimestamps,
} from "./mediaTools";
import {
  MEDIA_TOOLS,
  buildWaveformPeaks,
  computeResizedDimensions,
  applyImageAdjustments,
  quantizePalette,
  rgbToHex,
  extensionForFormat,
  mimeForFormat,
  type ResizeOptions,
} from "./mediaTools";

describe("media tool registry", () => {
  it("describes every toolbox tool exactly once", () => {
    expect(MEDIA_TOOLS).toHaveLength(13);
    const ids = MEDIA_TOOLS.map((tool) => tool.id);
    expect(new Set(ids).size).toBe(13);
  });

  it("gives every tool a runnable processor, a name and an output type", () => {
    for (const tool of MEDIA_TOOLS) {
      expect(tool.runnable).toBe(true);
      expect(tool.name.length).toBeGreaterThan(3);
      expect(tool.nameAr.length).toBeGreaterThan(3);
      expect(tool.outputMime).toMatch(/^(image|audio|video)\//);
      expect(tool.outputExtension).toMatch(/^[a-z0-9]+$/);
      if (tool.inputKind === "file") {
        expect(tool.accepts.length).toBeGreaterThan(0);
      } else {
        expect(tool.accepts).toHaveLength(0);
      }
    }
  });

  it("maps formats to the right MIME types and extensions", () => {
    expect(mimeForFormat("png")).toBe("image/png");
    expect(mimeForFormat("jpeg")).toBe("image/jpeg");
    expect(mimeForFormat("webp")).toBe("image/webp");
    expect(extensionForFormat("jpeg")).toBe("jpg");
    expect(extensionForFormat("png")).toBe("png");
    expect(extensionForFormat("webp")).toBe("webp");
  });
});

describe("resize geometry", () => {
  const source = { width: 1600, height: 900 };

  it("keeps the aspect ratio in fit mode", () => {
    const result = computeResizedDimensions(source, { mode: "fit", width: 800, height: 800 });
    expect(result).toEqual({ width: 800, height: 450 });
  });

  it("covers the box in fill mode", () => {
    const result = computeResizedDimensions(source, { mode: "fill", width: 800, height: 800 });
    expect(result).toEqual({ width: 1422, height: 800 });
  });

  it("ignores the aspect ratio in stretch mode", () => {
    const result = computeResizedDimensions(source, { mode: "stretch", width: 300, height: 1200 });
    expect(result).toEqual({ width: 300, height: 1200 });
  });

  it("scales by percentage", () => {
    const result = computeResizedDimensions(source, { mode: "percentage", percentage: 50 });
    expect(result).toEqual({ width: 800, height: 450 });
  });

  it("never returns a zero or negative size", () => {
    const options: ResizeOptions = { mode: "fit", width: 0, height: 0 };
    const result = computeResizedDimensions(source, options);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });

  it("rejects an empty source", () => {
    expect(() => computeResizedDimensions({ width: 0, height: 0 }, { mode: "fit" })).toThrow(
      /no usable dimensions/,
    );
  });
});

describe("pixel adjustments", () => {
  const pixel = (r: number, g: number, b: number, a = 255): number[] => [r, g, b, a];

  it("raises brightness by a measurable amount", () => {
    const pixels = new Uint8ClampedArray(pixel(100, 120, 140));
    applyImageAdjustments(pixels, { brightness: 50 });
    expect(pixels[0]).toBeGreaterThan(100);
    expect(pixels[1]).toBeGreaterThan(120);
    expect(pixels[2]).toBeGreaterThan(140);
    expect(pixels[3]).toBe(255);
  });

  it("lowers brightness below the source value", () => {
    const pixels = new Uint8ClampedArray(pixel(100, 120, 140));
    applyImageAdjustments(pixels, { brightness: -50 });
    expect(pixels[0]).toBeLessThan(100);
    expect(pixels[2]).toBeLessThan(140);
  });

  it("increases contrast around the mid grey point", () => {
    const dark = new Uint8ClampedArray(pixel(60, 60, 60));
    applyImageAdjustments(dark, { contrast: 60 });
    expect(dark[0]).toBeLessThan(60);

    const light = new Uint8ClampedArray(pixel(200, 200, 200));
    applyImageAdjustments(light, { contrast: 60 });
    expect(light[0]).toBeGreaterThan(200);
  });

  it("removes colour with a full grayscale pass", () => {
    const pixels = new Uint8ClampedArray(pixel(200, 40, 90));
    applyImageAdjustments(pixels, { grayscale: 100 });
    expect(pixels[0]).toBeCloseTo(pixels[1], 0);
    expect(pixels[1]).toBeCloseTo(pixels[2], 0);
  });

  it("desaturates to grey with a zero saturation pass", () => {
    const pixels = new Uint8ClampedArray(pixel(200, 40, 90));
    applyImageAdjustments(pixels, { saturation: -100 });
    expect(pixels[0]).toBeCloseTo(pixels[1], 0);
    expect(pixels[1]).toBeCloseTo(pixels[2], 0);
  });

  it("brightens with exposure", () => {
    const pixels = new Uint8ClampedArray(pixel(40, 40, 40));
    applyImageAdjustments(pixels, { exposure: 1 });
    expect(pixels[0]).toBeCloseTo(80, 0);
  });

  it("keeps the alpha channel untouched", () => {
    const pixels = new Uint8ClampedArray(pixel(10, 20, 30, 77));
    applyImageAdjustments(pixels, { brightness: 80, contrast: 40, saturation: 40 });
    expect(pixels[3]).toBe(77);
  });

  it("does nothing when no adjustment is requested", () => {
    const pixels = new Uint8ClampedArray(pixel(10, 20, 30, 40));
    applyImageAdjustments(pixels, {});
    expect([...pixels]).toEqual([10, 20, 30, 40]);
  });
});

describe("palette extraction", () => {
  it("finds the dominant colour of a flat image", () => {
    const pixels = new Uint8ClampedArray([
      255, 222, 0, 255,
      255, 222, 0, 255,
      255, 222, 0, 255,
      12, 13, 14, 255,
    ]);
    const swatches = quantizePalette(pixels, { count: 4 });
    expect(swatches.length).toBeGreaterThan(0);
    expect(swatches[0].hex).toBe(rgbToHex(255, 222, 0));
    expect(swatches[0].weight).toBeGreaterThan(0.5);
  });

  it("returns several distinct colours for a mixed image", () => {
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      255, 255, 255, 255,
    ]);
    const swatches = quantizePalette(pixels, { count: 4 });
    expect(swatches.length).toBe(4);
    expect(swatches.map((swatch) => swatch.hex)).toContain("#ff0000");
    expect(swatches.map((swatch) => swatch.hex)).toContain("#00ff00");
  });

  it("ignores transparent pixels", () => {
    const pixels = new Uint8ClampedArray([
      10, 20, 30, 0,
      40, 50, 60, 0,
    ]);
    expect(quantizePalette(pixels, { count: 4 })).toHaveLength(0);
  });

  it("returns nothing for an empty buffer", () => {
    expect(quantizePalette(new Uint8ClampedArray(0), { count: 4 })).toHaveLength(0);
  });

  it("formats colours as six digit hex", () => {
    expect(rgbToHex(255, 222, 0)).toBe("#ffde00");
    expect(rgbToHex(0, 0, 0)).toBe("#000000");
    expect(rgbToHex(300, -5, 12)).toBe("#ff000c");
  });
});

describe("waveform peaks", () => {
  it("reduces samples into min/max buckets", () => {
    const samples = [0, 0.5, -0.5, 1, -1, 0.25, -0.25, 0];
    const { peaks, peak } = buildWaveformPeaks(samples, 4);
    expect(peaks).toHaveLength(8);
    expect(peak).toBe(1);
    expect(peaks[0]).toBe(0);
    expect(peaks[1]).toBe(0.5);
    expect(peaks[2]).toBe(-0.5);
    expect(peaks[3]).toBe(1);
  });

  it("handles an empty buffer", () => {
    const { peaks, peak } = buildWaveformPeaks([], 8);
    expect(peaks).toHaveLength(16);
    expect(peak).toBe(0);
  });

  it("keeps the absolute maximum", () => {
    const { peak } = buildWaveformPeaks([0.1, -0.9, 0.2], 1);
    expect(peak).toBeCloseTo(0.9, 5);
  });
});

describe("image compression accounting", () => {
  it("reports the measured saving from both byte counts", () => {
    const report = compressionReport(200_000, 50_000);
    expect(report.savedBytes).toBe(150_000);
    expect(report.savedPercent).toBeCloseTo(75, 5);
    expect(report.ratio).toBeCloseTo(0.25, 5);
  });

  it("reports an increase honestly when the output is larger", () => {
    const report = compressionReport(10_000, 12_500);
    expect(report.savedBytes).toBe(-2_500);
    expect(report.savedPercent).toBeCloseTo(-25, 5);
  });

  it("does not divide by zero on an empty source", () => {
    const report = compressionReport(0, 0);
    expect(report.savedPercent).toBe(0);
    expect(report.ratio).toBe(1);
  });
});

describe("frame sheet geometry", () => {
  it("spaces the sampled timestamps evenly inside the clip", () => {
    const stamps = frameSheetTimestamps(10, 4);
    expect(stamps).toEqual([1.25, 3.75, 6.25, 8.75]);
    expect(Math.min(...stamps)).toBeGreaterThan(0);
    expect(Math.max(...stamps)).toBeLessThan(10);
  });

  it("never asks for a zero or absurd number of frames", () => {
    expect(frameSheetTimestamps(5, 0).length).toBe(1);
    expect(frameSheetTimestamps(5, 999).length).toBe(24);
    expect(frameSheetTimestamps(0, 5)).toEqual([0]);
  });

  it("lays out the grid with padding and a label strip per tile", () => {
    const layout = frameSheetLayout(6, 3, 320, 16 / 9);
    expect(layout.columns).toBe(3);
    expect(layout.rows).toBe(2);
    expect(layout.tileWidth).toBe(320);
    expect(layout.tileHeight).toBe(180);
    expect(layout.width).toBe(3 * 320 + 4 * 8);
    expect(layout.height).toBe(2 * (180 + 22) + 3 * 8);
  });

  it("clamps the column count to the frame count", () => {
    const layout = frameSheetLayout(2, 6, 320, 1);
    expect(layout.columns).toBe(2);
    expect(layout.rows).toBe(1);
  });
});
