import { describe, expect, it, vi } from "vitest";
import {
  applyOps,
  autoCurvePoints,
  averagePixels,
  blurPixels,
  borderPixels,
  brightnessPixels,
  buildCurveLut,
  clonePixels,
  contrastPixels,
  cropPixels,
  curvePixels,
  evaluateCurve,
  exposurePixels,
  flipPixels,
  gammaPixels,
  histogramPixels,
  IDENTITY_CURVE,
  meanDifference,
  normaliseCurvePoints,
  pixelatePixels,
  resizePixels,
  rotatePixels,
  saturationPixels,
  sharpenPixels,
  temperaturePixels,
  vignettePixels,
  type CurvePoint,
  type Histogram,
  type Op,
  type Pixels,
  type Rasterizer,
} from "./imageOps";

/** Deterministic synthetic image: a hard vertical edge plus a colour ramp. */
function checker(width = 8, height = 6): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const light = x < width / 2;
      data[at] = light ? 20 : 230;
      data[at + 1] = light ? 30 : 220;
      data[at + 2] = y * 10;
      data[at + 3] = 255;
    }
  }
  return { width, height, data };
}

function flat(value: number, width = 4, height = 4): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

function pixelAt(image: Pixels, x: number, y: number): [number, number, number, number] {
  const at = (y * image.width + x) * 4;
  return [image.data[at], image.data[at + 1], image.data[at + 2], image.data[at + 3]];
}

function spread(image: Pixels): number {
  const { r } = averagePixels(image);
  let sum = 0;
  for (let i = 0; i < image.data.length; i += 4) sum += Math.abs(image.data[i] - r);
  return sum / (image.width * image.height);
}

describe("geometry operations", () => {
  it("crops the exact sub-rectangle", () => {
    const source = checker(8, 6);
    const cropped = cropPixels(source, 4, 2, 3, 3);
    expect([cropped.width, cropped.height]).toEqual([3, 3]);
    expect(pixelAt(cropped, 0, 0)).toEqual(pixelAt(source, 4, 2));
    expect(pixelAt(cropped, 2, 2)).toEqual(pixelAt(source, 6, 4));
  });

  it("clamps a crop that runs past the edge instead of throwing", () => {
    const cropped = cropPixels(checker(8, 6), 6, 4, 50, 50);
    expect([cropped.width, cropped.height]).toEqual([2, 2]);
  });

  it("upscales with bilinear sampling and keeps flat colours flat", () => {
    const upscaled = resizePixels(flat(120, 4, 4), 12, 12);
    expect([upscaled.width, upscaled.height]).toEqual([12, 12]);
    for (let i = 0; i < upscaled.data.length; i += 4) {
      expect(upscaled.data[i]).toBeCloseTo(120, 0);
    }
  });

  it("downsamples by sampling the source grid", () => {
    const source = checker(8, 6);
    const down = resizePixels(source, 4, 3);
    expect([down.width, down.height]).toEqual([4, 3]);
    // Centre of the left half of the first cell stays dark.
    expect(pixelAt(down, 0, 0)[0]).toBeLessThan(60);
    expect(pixelAt(down, 3, 0)[0]).toBeGreaterThan(180);
  });

  it("mirrors pixels across the horizontal axis", () => {
    const source = checker(8, 6);
    const flipped = flipPixels(source, "h");
    expect(pixelAt(flipped, 0, 0)).toEqual(pixelAt(source, 7, 0));
    expect(pixelAt(flipped, 7, 5)).toEqual(pixelAt(source, 0, 5));
  });

  it("swaps dimensions on a quarter turn and maps the corner", () => {
    const source = checker(8, 6);
    const turned = rotatePixels(source, 90);
    expect([turned.width, turned.height]).toEqual([6, 8]);
    expect(pixelAt(turned, 5, 0)).toEqual(pixelAt(source, 0, 0));
    expect(pixelAt(turned, 0, 7)).toEqual(pixelAt(source, 7, 5));
  });

  it("grows the bounding box for an arbitrary angle and leaves the corners transparent", () => {
    const rotated = rotatePixels(checker(8, 6), 45);
    expect(rotated.width).toBeGreaterThan(8);
    expect(rotated.height).toBeGreaterThan(6);
    expect(pixelAt(rotated, 0, 0)[3]).toBe(0);
    let painted = 0;
    for (let i = 3; i < rotated.data.length; i += 4) if (rotated.data[i] > 0) painted += 1;
    expect(painted).toBeGreaterThan(0);
    expect(painted).toBeLessThan(rotated.width * rotated.height);
  });

  it("treats a zero angle as an identity copy", () => {
    const source = checker(8, 6);
    const same = rotatePixels(source, 0);
    expect(meanDifference(source, same)).toBe(0);
  });
});

describe("tone operations", () => {
  it("leaves the image untouched at zero stops", () => {
    const source = checker(8, 6);
    expect(meanDifference(source, exposurePixels(source, 0))).toBe(0);
    expect(meanDifference(source, brightnessPixels(source, 0))).toBe(0);
    expect(meanDifference(source, contrastPixels(source, 0))).toBe(0);
    expect(meanDifference(source, gammaPixels(source, 1))).toBe(0);
  });

  it("doubles linear values at +1 stop and clamps at white", () => {
    const out = exposurePixels(flat(100), 1);
    expect(pixelAt(out, 0, 0)[0]).toBe(200);
    const clipped = exposurePixels(flat(200), 1);
    expect(pixelAt(clipped, 0, 0)[0]).toBe(255);
  });

  it("raises and lowers brightness symmetrically", () => {
    expect(pixelAt(brightnessPixels(flat(100), 20), 0, 0)[0]).toBe(126);
    expect(pixelAt(brightnessPixels(flat(100), -20), 0, 0)[0]).toBe(74);
  });

  it("increases tonal spread as contrast rises", () => {
    const source = checker();
    expect(spread(contrastPixels(source, 60))).toBeGreaterThan(spread(source));
  });

  it("collapses colour to luminance at full negative saturation", () => {
    const source = checker();
    const mono = saturationPixels(source, -100);
    for (let i = 0; i < mono.data.length; i += 4) {
      expect(mono.data[i]).toBe(mono.data[i + 1]);
      expect(mono.data[i + 1]).toBe(mono.data[i + 2]);
    }
  });

  it("pushes red up and blue down when warming", () => {
    const source = flat(120, 4, 4);
    const warm = temperaturePixels(source, 40);
    expect(warm.data[0]).toBeGreaterThan(source.data[0]);
    expect(warm.data[2]).toBeLessThan(source.data[2]);
    expect(warm.data[1]).toBe(source.data[1]);
  });

  it("brightens mid-tones with gamma above one", () => {
    const out = gammaPixels(flat(128), 1.6);
    expect(pixelAt(out, 0, 0)[0]).toBeGreaterThan(128);
  });

  it("keeps the centre of a vignette and darkens the corners", () => {
    const source = flat(200, 21, 21);
    const vignetted = vignettePixels(source, 80);
    expect(pixelAt(vignetted, 10, 10)[0]).toBeCloseTo(200, 0);
    expect(pixelAt(vignetted, 0, 0)[0]).toBeLessThan(140);
  });
});

describe("detail operations", () => {
  it("leaves a flat field unchanged", () => {
    const source = flat(140, 12, 12);
    const blurred = blurPixels(source, 4);
    expect([blurred.width, blurred.height]).toEqual([12, 12]);
    expect(meanDifference(source, blurred)).toBeLessThan(0.01);
  });

  it("softens a hard edge", () => {
    const source = checker(16, 8);
    const blurred = blurPixels(source, 2);
    const before = Math.abs(
      pixelAt(source, 8, 4)[0] - pixelAt(source, 7, 4)[0],
    );
    const after = Math.abs(pixelAt(blurred, 8, 4)[0] - pixelAt(blurred, 7, 4)[0]);
    expect(after).toBeLessThan(before);
  });

  it("increases the gradient across an edge when sharpening", () => {
    const source = blurPixels(checker(16, 8), 2);
    const sharpened = sharpenPixels(source, 120);
    const before = Math.abs(
      pixelAt(source, 8, 4)[0] - pixelAt(source, 7, 4)[0],
    );
    const after = Math.abs(
      pixelAt(sharpened, 8, 4)[0] - pixelAt(sharpened, 7, 4)[0],
    );
    expect(after).toBeGreaterThan(before);
  });

  it("reduces a zero-strength sharpen to the original", () => {
    const source = checker(8, 6);
    expect(meanDifference(source, sharpenPixels(source, 0))).toBe(0);
  });

  it("makes every pixel inside a mosaic block identical", () => {
    const out = pixelatePixels(checker(16, 8), 4);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 16; x += 2) {
        expect(pixelAt(out, x, y)).toEqual(pixelAt(out, x + 1, y));
      }
    }
    expect(out.width).toBe(16);
  });

  it("paints only the inner frame band", () => {
    const source = flat(120, 20, 20);
    const framed = borderPixels(source, 4, "#ff0000", 100);
    expect(pixelAt(framed, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(framed, 19, 19)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(framed, 10, 10)).toEqual([120, 120, 120, 255]);
  });

  it("blends a semi transparent frame over the image", () => {
    const source = flat(100, 10, 10);
    const framed = borderPixels(source, 2, "#000000", 50);
    expect(pixelAt(framed, 0, 0)[0]).toBeCloseTo(50, 0);
    expect(pixelAt(framed, 5, 5)[0]).toBe(100);
  });
});

describe("pipeline", () => {
  it("applies operations in order", () => {
    const source = checker(20, 20);
    const cropThenResize = applyOps(source, [
      { kind: "crop", x: 0, y: 0, width: 20, height: 10 },
      { kind: "resize", width: 5, height: 5 },
    ]);
    const resizeThenCrop = applyOps(source, [
      { kind: "resize", width: 10, height: 10 },
      { kind: "crop", x: 0, y: 0, width: 10, height: 5 },
    ]);
    expect([cropThenResize.width, cropThenResize.height]).toEqual([5, 5]);
    expect([resizeThenCrop.width, resizeThenCrop.height]).toEqual([10, 5]);
  });

  it("does not mutate the source pixels", () => {
    const source = checker(8, 6);
    const before = Array.from(source.data);
    applyOps(source, [
      { kind: "brightness", amount: 40 },
      { kind: "border", width: 2, color: "#00ff00", opacity: 100 },
    ]);
    expect(Array.from(source.data)).toEqual(before);
  });

  it("routes text and watermark through the injected rasteriser", () => {
    const rasterize = vi.fn<Rasterizer>();
    const source = checker(8, 6);
    const out = applyOps(source, [
      {
        kind: "text",
        text: "HELLO",
        x: 50,
        y: 50,
        size: 12,
        color: "#ffffff",
        opacity: 100,
        weight: "600",
        shadow: false,
      },
    ], rasterize);
    expect(rasterize).toHaveBeenCalledTimes(1);
    expect(out.width).toBe(8);
  });

  it("skips an empty text layer without touching the image", () => {
    const source = checker(8, 6);
    const out = applyOps(
      source,
      [
        {
          kind: "text",
          text: "",
          x: 50,
          y: 50,
          size: 12,
          color: "#ffffff",
          opacity: 100,
          weight: "600",
          shadow: false,
        },
      ],
      vi.fn<Rasterizer>(),
    );
    expect(meanDifference(source, out)).toBe(0);
  });

  it("ignores text when no rasteriser is available rather than crashing", () => {
    const source = checker(8, 6);
    const out = applyOps(source, [
      {
        kind: "watermark",
        text: "KNOUX",
        size: 10,
        opacity: 20,
        angle: -20,
        step: 30,
        color: "#ffffff",
      },
    ]);
    expect(meanDifference(source, out)).toBe(0);
  });

  it("clones pixels independently", () => {
    const source = checker(8, 6);
    const copy = clonePixels(source);
    copy.data[0] = 9;
    expect(source.data[0]).not.toBe(9);
  });
});

/** Grey ramp confined to a narrow band — the classic low-contrast input. */
function band(width = 24, height = 8, from = 100, to = 150): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  const span = to - from;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = from + ((x + y * width) % (span + 1));
      const at = (y * width + x) * 4;
      data[at] = value;
      data[at + 1] = value;
      data[at + 2] = value;
      data[at + 3] = 255;
    }
  }
  return { width, height, data };
}

describe("tone curves", () => {
  it("keeps an identity curve pixel-perfect", () => {
    const source = checker(8, 6);
    const out = curvePixels(source, "rgb", IDENTITY_CURVE);
    expect(meanDifference(source, out)).toBe(0);
  });

  it("sorts, de-duplicates and clamps control points", () => {
    const knots = normaliseCurvePoints([
      { input: 300, output: -20 },
      { input: 128, output: 200 },
      { input: 128, output: 90 },
      { input: 0, output: 12 },
    ]);
    expect(knots.map((knot) => knot.input)).toEqual([0, 128, 255]);
    expect(knots[0]).toEqual({ input: 0, output: 12 });
    // Out-of-range levels clamp and the later duplicate wins.
    expect(knots[1]).toEqual({ input: 128, output: 90 });
    expect(knots[2]).toEqual({ input: 255, output: 0 });
  });

  it("produces a non-decreasing table even from a reversed handle", () => {
    const lut = buildCurveLut([
      { input: 0, output: 0 },
      { input: 64, output: 200 },
      { input: 128, output: 40 },
      { input: 255, output: 255 },
    ]);
    for (let level = 1; level < 256; level += 1) {
      expect(lut[level] >= lut[level - 1]).toBe(true);
    }
    expect(lut[0]).toBe(0);
    expect(lut[255]).toBe(255);
  });

  it("holds the tone flat outside the control range", () => {
    const lut = buildCurveLut([
      { input: 40, output: 80 },
      { input: 200, output: 210 },
    ]);
    // Levels below the lowest knot cannot invent shadow detail.
    expect(lut[0]).toBe(80);
    expect(lut[39]).toBe(80);
    expect(lut[255]).toBe(210);
    expect(lut[201]).toBe(210);
    // The editor's readout and the pipeline share one table.
    expect(
      evaluateCurve(
        [
          { input: 40, output: 80 },
          { input: 200, output: 210 },
        ],
        120,
      ),
    ).toBe(lut[120]);
  });

  it("lifts a black point onto every channel at once", () => {
    const source = flat(0, 4, 4);
    const out = curvePixels(source, "rgb", [
      { input: 0, output: 48 },
      { input: 255, output: 255 },
    ]);
    expect(pixelAt(out, 0, 0).slice(0, 3)).toEqual([48, 48, 48]);
  });

  it("edits only the selected channel and never the alpha", () => {
    const source = checker(8, 6);
    const out = curvePixels(source, "b", [
      { input: 0, output: 60 },
      { input: 255, output: 255 },
    ]);
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i]).toBe(source.data[i]);
      expect(out.data[i + 1]).toBe(source.data[i + 1]);
      expect(out.data[i + 3]).toBe(source.data[i + 3]);
    }
    expect(meanDifference(source, out)).toBeGreaterThan(0);
  });

  it("runs the curve through the shared pipeline like any other layer", () => {
    const source = checker(8, 6);
    const points: CurvePoint[] = [
      { input: 0, output: 0 },
      { input: 128, output: 150 },
      { input: 255, output: 255 },
    ];
    const throughPipeline = applyOps(source, [{ kind: "curves", channel: "rgb", points }]);
    const direct = curvePixels(source, "rgb", points);
    expect(Array.from(throughPipeline.data)).toEqual(Array.from(direct.data));
  });

  it("measures the tonal distribution of real pixels", () => {
    const source = checker(8, 6);
    const histogram = histogramPixels(source);
    expect(histogram.samples).toBe(48);
    expect(histogram.stride).toBe(1);
    expect(histogram.luma.reduce((total, count) => total + count, 0)).toBe(48);
    // One row per luminance step, six dark and six bright, with a real gap
    // between the two halves of the edge.
    const occupied = histogram.luma
      .map((count, level) => (count > 0 ? level : -1))
      .filter((level) => level >= 0);
    expect(occupied).toHaveLength(12);
    expect(occupied.filter((level) => level < 128)).toHaveLength(6);
    expect(occupied.filter((level) => level >= 128)).toHaveLength(6);
    expect(occupied[5]).toBeLessThan(30);
    expect(occupied[6]).toBeGreaterThan(190);
    expect(histogram.lowInput).toBe(occupied[0]);
    expect(histogram.highInput).toBe(occupied[11]);
    expect(histogram.shadows).toBe(0);
    expect(histogram.highlights).toBe(0);
    expect(histogram.mean).toBeGreaterThan(100);
    expect(histogram.mean).toBeLessThan(160);
  });

  it("ignores fully transparent pixels", () => {
    const source = flat(200, 4, 4);
    for (let i = 3; i < source.data.length; i += 8) source.data[i] = 0;
    const histogram = histogramPixels(source);
    expect(histogram.samples).toBe(8);
    expect(histogram.luma[0]).toBe(0);
  });

  it("auto levels stretches a narrow band across the full scale", () => {
    const source = band();
    const before = histogramPixels(source);
    expect(before.lowInput).toBeGreaterThanOrEqual(100);
    expect(before.highInput).toBeLessThanOrEqual(150);

    const points = autoCurvePoints(before, 0.004);
    const lut = buildCurveLut(points);
    expect(lut[before.lowInput]).toBe(0);
    expect(lut[before.highInput]).toBe(255);

    const after = histogramPixels(curvePixels(source, "rgb", points));
    expect(after.lowInput).toBe(0);
    expect(after.highInput).toBe(255);
    expect(after.highlights).toBeGreaterThan(before.highlights);
  });

  it("falls back to a straight line when there is nothing to measure", () => {
    const empty: Histogram = {
      r: new Array(256).fill(0),
      g: new Array(256).fill(0),
      b: new Array(256).fill(0),
      luma: new Array(256).fill(0),
      samples: 0,
      stride: 1,
      max: 0,
      mean: 0,
      shadows: 0,
      highlights: 0,
      lowInput: 0,
      highInput: 255,
    };
    expect(autoCurvePoints(empty)).toEqual([
      { input: 0, output: 0 },
      { input: 255, output: 255 },
    ]);
  });

  it("samples large images with a bounded stride", () => {
    const source = flat(120, 100, 100);
    const histogram = histogramPixels(source);
    expect(histogram.stride).toBe(Math.ceil(10_000 / 200_000));
    expect(histogram.samples).toBeLessThanOrEqual(10_000);
    expect(histogram.luma[120]).toBe(histogram.samples);
  });
});

describe("pipeline purity", () => {
  it("never writes a composite step back into the caller's base pixels", () => {
    const source = checker(6, 4);
    const before = Array.from(source.data);
    const stomper: Rasterizer = (target) => {
      target.data.fill(7);
    };
    applyOps(source, [
      {
        kind: "text",
        text: "KNOUX",
        x: 50,
        y: 50,
        size: 12,
        color: "#ffffff",
        opacity: 100,
        weight: "600",
        shadow: false,
      },
    ], stomper);
    expect(Array.from(source.data)).toEqual(before);

    applyOps(source, [
      { kind: "watermark", text: "KNOUX", size: 10, opacity: 20, angle: 0, step: 30, color: "#ffffff" },
    ], stomper);
    expect(Array.from(source.data)).toEqual(before);
  });

  it("produces the same bytes when the same chain runs twice", () => {
    const source = band(16, 8, 60, 190);
    const ops: Op[] = [
      { kind: "curves", channel: "rgb", points: [{ input: 0, output: 10 }, { input: 255, output: 240 }] },
      { kind: "saturation", amount: 30 },
    ];
    const first = applyOps(source, ops);
    const second = applyOps(source, ops);
    expect(Array.from(first.data)).toEqual(Array.from(second.data));
  });
});
