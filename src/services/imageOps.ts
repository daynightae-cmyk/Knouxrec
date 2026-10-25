/**
 * KNOUX REC — Elysian image pipeline.
 *
 * Every operation here is a pure function over raw RGBA bytes. Nothing is
 * simulated: the same code path produces the live preview, the effect-browser
 * thumbnails, the saved library item and the exported file, and it can be unit
 * tested without a DOM. Only text and watermark steps need a rasteriser, which
 * the caller injects (a canvas in the app, a spy in tests).
 */

export type Pixels = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export type TextOp = {
  kind: "text";
  text: string;
  x: number;
  y: number;
  size: number;
  color: string;
  opacity: number;
  weight: "400" | "600" | "800";
  shadow: boolean;
};

export type WatermarkOp = {
  kind: "watermark";
  text: string;
  size: number;
  opacity: number;
  angle: number;
  step: number;
  color: string;
};

/** Which part of the signal a tone curve touches. */
export type CurveChannel = "rgb" | "r" | "g" | "b";

/**
 * One control point of a tone curve, both axes in the 0–255 domain. The curve
 * is a real transfer function: every input level maps through it to an output
 * level, exactly like a curves adjustment in a raster editor.
 */
export type CurvePoint = { input: number; output: number };

export type CurvesOp = {
  kind: "curves";
  channel: CurveChannel;
  points: CurvePoint[];
};

export type Op =
  | { kind: "crop"; x: number; y: number; width: number; height: number }
  | { kind: "resize"; width: number; height: number }
  | { kind: "rotate"; angle: number }
  | { kind: "flip"; axis: "h" | "v" }
  | { kind: "exposure"; stops: number }
  | { kind: "brightness"; amount: number }
  | { kind: "contrast"; amount: number }
  | { kind: "saturation"; amount: number }
  | { kind: "temperature"; amount: number }
  | { kind: "gamma"; amount: number }
  | { kind: "vignette"; amount: number }
  | { kind: "blur"; radius: number }
  | { kind: "sharpen"; amount: number }
  | { kind: "pixelate"; blocks: number }
  | { kind: "border"; width: number; color: string; opacity: number }
  | CurvesOp
  | TextOp
  | WatermarkOp;

export type OpKind = Op["kind"];

export type Rasterizer = (
  target: Pixels,
  draw: (context: CanvasRenderingContext2D, width: number, height: number) => void,
) => void;

export const OP_LABELS: Record<OpKind, string> = {
  crop: "Crop",
  resize: "Resize",
  rotate: "Rotate",
  flip: "Flip",
  exposure: "Exposure",
  brightness: "Brightness",
  contrast: "Contrast",
  saturation: "Saturation",
  temperature: "Temperature",
  gamma: "Gamma",
  vignette: "Vignette",
  blur: "Blur",
  sharpen: "Sharpen",
  pixelate: "Pixelate",
  border: "Border",
  curves: "Curves",
  text: "Text",
  watermark: "Watermark",
};

export function clonePixels(source: Pixels): Pixels {
  return {
    width: source.width,
    height: source.height,
    data: new Uint8ClampedArray(source.data),
  };
}

export function parseColor(color: string): [number, number, number] {
  const hex = color.trim().replace(/^#/, "");
  if (hex.length === 3) {
    return [
      parseInt(hex[0] + hex[0], 16),
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16),
    ];
  }
  if (hex.length >= 6) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  return [255, 255, 255];
}

/* ------------------------------------------------------------------ */
/* Geometry                                                           */
/* ------------------------------------------------------------------ */

export function cropPixels(source: Pixels, x: number, y: number, width: number, height: number): Pixels {
  const left = Math.max(0, Math.min(source.width - 1, Math.round(x)));
  const top = Math.max(0, Math.min(source.height - 1, Math.round(y)));
  const outWidth = Math.max(1, Math.min(source.width - left, Math.round(width)));
  const outHeight = Math.max(1, Math.min(source.height - top, Math.round(height)));
  const out = new Uint8ClampedArray(outWidth * outHeight * 4);
  for (let row = 0; row < outHeight; row += 1) {
    const from = ((top + row) * source.width + left) * 4;
    out.set(source.data.subarray(from, from + outWidth * 4), row * outWidth * 4);
  }
  return { width: outWidth, height: outHeight, data: out };
}

function sampleBilinear(source: Pixels, fx: number, fy: number): [number, number, number, number] {
  const x = Math.max(0, Math.min(source.width - 1, fx));
  const y = Math.max(0, Math.min(source.height - 1, fy));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(source.width - 1, x0 + 1);
  const y1 = Math.min(source.height - 1, y0 + 1);
  const dx = x - x0;
  const dy = y - y0;
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let channel = 0; channel < 4; channel += 1) {
    const p00 = source.data[(y0 * source.width + x0) * 4 + channel];
    const p10 = source.data[(y0 * source.width + x1) * 4 + channel];
    const p01 = source.data[(y1 * source.width + x0) * 4 + channel];
    const p11 = source.data[(y1 * source.width + x1) * 4 + channel];
    out[channel] = (p00 * (1 - dx) + p10 * dx) * (1 - dy) + (p01 * (1 - dx) + p11 * dx) * dy;
  }
  return out;
}

export function resizePixels(source: Pixels, width: number, height: number): Pixels {
  const outWidth = Math.max(1, Math.round(width));
  const outHeight = Math.max(1, Math.round(height));
  const out = new Uint8ClampedArray(outWidth * outHeight * 4);
  const sx = source.width / outWidth;
  const sy = source.height / outHeight;
  for (let y = 0; y < outHeight; y += 1) {
    const fy = (y + 0.5) * sy - 0.5;
    for (let x = 0; x < outWidth; x += 1) {
      const fx = (x + 0.5) * sx - 0.5;
      const value = sampleBilinear(source, fx, fy);
      const at = (y * outWidth + x) * 4;
      out[at] = value[0];
      out[at + 1] = value[1];
      out[at + 2] = value[2];
      out[at + 3] = value[3];
    }
  }
  return { width: outWidth, height: outHeight, data: out };
}

export function flipPixels(source: Pixels, axis: "h" | "v"): Pixels {
  const { width, height, data } = source;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sx = axis === "h" ? width - 1 - x : x;
      const sy = axis === "v" ? height - 1 - y : y;
      const from = (sy * width + sx) * 4;
      const to = (y * width + x) * 4;
      out[to] = data[from];
      out[to + 1] = data[from + 1];
      out[to + 2] = data[from + 2];
      out[to + 3] = data[from + 3];
    }
  }
  return { width, height, data: out };
}

/** Rotate by any angle; the bounding box grows and uncovered pixels stay transparent. */
export function rotatePixels(source: Pixels, angle: number): Pixels {
  const normalized = ((angle % 360) + 360) % 360;
  if (normalized === 0) return clonePixels(source);
  if (normalized === 90) return quarterTurn(source, true);
  if (normalized === 180) return flipPixels(flipPixels(source, "h"), "v");
  if (normalized === 270) return quarterTurn(source, false);

  const radians = (normalized * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const outWidth = Math.max(1, Math.round(source.width * cos + source.height * sin));
  const outHeight = Math.max(1, Math.round(source.width * sin + source.height * cos));
  const out = new Uint8ClampedArray(outWidth * outHeight * 4);
  const centreX = source.width / 2;
  const centreY = source.height / 2;
  const inverse = -radians;
  const cosI = Math.cos(inverse);
  const sinI = Math.sin(inverse);
  for (let y = 0; y < outHeight; y += 1) {
    const dy = y - outHeight / 2 + 0.5;
    for (let x = 0; x < outWidth; x += 1) {
      const dx = x - outWidth / 2 + 0.5;
      const srcX = centreX + (dx * cosI - dy * sinI) - 0.5;
      const srcY = centreY + (dx * sinI + dy * cosI) - 0.5;
      const at = (y * outWidth + x) * 4;
      if (srcX < -0.5 || srcY < -0.5 || srcX > source.width - 0.5 || srcY > source.height - 0.5) {
        continue;
      }
      const value = sampleBilinear(source, srcX, srcY);
      out[at] = value[0];
      out[at + 1] = value[1];
      out[at + 2] = value[2];
      out[at + 3] = value[3];
    }
  }
  return { width: outWidth, height: outHeight, data: out };
}

function quarterTurn(source: Pixels, clockwise: boolean): Pixels {
  const { width, height, data } = source;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const toX = clockwise ? height - 1 - y : y;
      const toY = clockwise ? x : width - 1 - x;
      const from = (y * width + x) * 4;
      const to = (toY * height + toX) * 4;
      out[to] = data[from];
      out[to + 1] = data[from + 1];
      out[to + 2] = data[from + 2];
      out[to + 3] = data[from + 3];
    }
  }
  return { width: height, height: width, data: out };
}

/* ------------------------------------------------------------------ */
/* Tone                                                               */
/* ------------------------------------------------------------------ */

function tone(source: Pixels, table: (value: number) => number): Pixels {
  const out = new Uint8ClampedArray(source.data.length);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v += 1) lut[v] = table(v);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = lut[source.data[i]];
    out[i + 1] = lut[source.data[i + 1]];
    out[i + 2] = lut[source.data[i + 2]];
    out[i + 3] = source.data[i + 3];
  }
  return { width: source.width, height: source.height, data: out };
}

export function exposurePixels(source: Pixels, stops: number): Pixels {
  const gain = Math.pow(2, stops);
  return tone(source, (v) => v * gain);
}

export function brightnessPixels(source: Pixels, amount: number): Pixels {
  const offset = amount * 1.28;
  return tone(source, (v) => v + offset);
}

export function contrastPixels(source: Pixels, amount: number): Pixels {
  const c = amount * 1.28;
  const factor = (259 * (c + 255)) / (255 * (259 - c));
  return tone(source, (v) => factor * (v - 128) + 128);
}

export function gammaPixels(source: Pixels, amount: number): Pixels {
  const exponent = 1 / Math.max(0.05, amount);
  return tone(source, (v) => 255 * Math.pow(v / 255, exponent));
}

export function saturationPixels(source: Pixels, amount: number): Pixels {
  const k = amount / 100;
  const out = new Uint8ClampedArray(source.data.length);
  for (let i = 0; i < out.length; i += 4) {
    const r = source.data[i];
    const g = source.data[i + 1];
    const b = source.data[i + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    out[i] = luma + (1 + k) * (r - luma);
    out[i + 1] = luma + (1 + k) * (g - luma);
    out[i + 2] = luma + (1 + k) * (b - luma);
    out[i + 3] = source.data[i + 3];
  }
  return { width: source.width, height: source.height, data: out };
}

export function temperaturePixels(source: Pixels, amount: number): Pixels {
  const shift = amount * 0.8;
  const out = new Uint8ClampedArray(source.data.length);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = source.data[i] + shift;
    out[i + 1] = source.data[i + 1];
    out[i + 2] = source.data[i + 2] - shift;
    out[i + 3] = source.data[i + 3];
  }
  return { width: source.width, height: source.height, data: out };
}

/** Radial falloff multiplied into RGB; the centre is untouched. */
export function vignettePixels(source: Pixels, amount: number): Pixels {
  const out = new Uint8ClampedArray(source.data.length);
  const cx = (source.width - 1) / 2;
  const cy = (source.height - 1) / 2;
  const norm = Math.sqrt(cx * cx + cy * cy);
  const strength = amount / 100;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const distance = Math.sqrt(dx * dx + dy * dy) / norm;
      const falloff = 1 - strength * Math.pow(Math.max(0, (distance - 0.35) / 0.65), 1.6);
      const at = (y * source.width + x) * 4;
      out[at] = source.data[at] * falloff;
      out[at + 1] = source.data[at + 1] * falloff;
      out[at + 2] = source.data[at + 2] * falloff;
      out[at + 3] = source.data[at + 3];
    }
  }
  return { width: source.width, height: source.height, data: out };
}

/* ------------------------------------------------------------------ */
/* Tone curves                                                        */
/* ------------------------------------------------------------------ */

export const IDENTITY_CURVE: CurvePoint[] = [
  { input: 0, output: 0 },
  { input: 255, output: 255 },
];

const clampLevel = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

/**
 * Sort, de-duplicate and clamp the control points. Two points on the same
 * input level would make the transfer function undefined, so the earlier one
 * is dropped and the last one the caller supplied wins.
 */
export function normaliseCurvePoints(points: CurvePoint[]): CurvePoint[] {
  const sorted = points
    .map((point) => ({ input: clampLevel(point.input), output: clampLevel(point.output) }))
    .sort((a, b) => a.input - b.input);
  const out: CurvePoint[] = [];
  for (const point of sorted) {
    const last = out[out.length - 1];
    if (last && last.input === point.input) out[out.length - 1] = point;
    else out.push(point);
  }
  if (!out.length) return IDENTITY_CURVE.map((point) => ({ ...point }));
  return out;
}

/**
 * Build the 256-entry transfer table from the control points with a monotone
 * cubic (Fritsch–Carlson) interpolation. Monotone matters: an ordinary spline
 * overshoots between knots, which produces banding and reversals a real image
 * adjustment must not have. Levels outside the point range hold flat at the
 * nearest endpoint, and the finished table is forced non-decreasing.
 */
export function buildCurveLut(points: CurvePoint[]): Uint8ClampedArray {
  const knots = normaliseCurvePoints(points);
  const lut = new Uint8ClampedArray(256);
  if (knots.length < 2) {
    for (let v = 0; v < 256; v += 1) lut[v] = v;
    return lut;
  }

  const xs = knots.map((point) => point.input);
  const ys = knots.map((point) => point.output);
  const count = knots.length;
  const width: number[] = [];
  const secant: number[] = [];
  for (let i = 0; i < count - 1; i += 1) {
    const dx = Math.max(1e-6, xs[i + 1] - xs[i]);
    width.push(dx);
    secant.push((ys[i + 1] - ys[i]) / dx);
  }

  const slope: number[] = new Array(count).fill(0);
  slope[0] = secant[0];
  slope[count - 1] = secant[count - 2];
  for (let i = 1; i < count - 1; i += 1) {
    slope[i] = secant[i - 1] * secant[i] <= 0 ? 0 : (secant[i - 1] + secant[i]) / 2;
  }
  for (let i = 0; i < count - 1; i += 1) {
    if (secant[i] === 0) {
      slope[i] = 0;
      slope[i + 1] = 0;
      continue;
    }
    const alpha = slope[i] / secant[i];
    const beta = slope[i + 1] / secant[i];
    const radius = alpha * alpha + beta * beta;
    if (radius > 9) {
      const tau = 3 / Math.sqrt(radius);
      slope[i] = tau * alpha * secant[i];
      slope[i + 1] = tau * beta * secant[i];
    }
  }

  for (let level = 0; level < 256; level += 1) {
    if (level <= xs[0]) {
      lut[level] = ys[0];
      continue;
    }
    if (level >= xs[count - 1]) {
      lut[level] = ys[count - 1];
      continue;
    }
    let segment = 0;
    while (segment < count - 2 && xs[segment + 1] <= level) segment += 1;
    const t = (level - xs[segment]) / width[segment];
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    lut[level] =
      h00 * ys[segment] +
      h10 * width[segment] * slope[segment] +
      h01 * ys[segment + 1] +
      h11 * width[segment] * slope[segment + 1];
  }

  for (let level = 1; level < 256; level += 1) {
    if (lut[level] < lut[level - 1]) lut[level] = lut[level - 1];
  }
  return lut;
}

/** The output level a given input level lands on — used by the editor. */
export function evaluateCurve(points: CurvePoint[], input: number): number {
  return buildCurveLut(points)[clampLevel(input)];
}

export function curvePixels(source: Pixels, channel: CurveChannel, points: CurvePoint[]): Pixels {
  const lut = buildCurveLut(points);
  const paintRed = channel === "rgb" || channel === "r";
  const paintGreen = channel === "rgb" || channel === "g";
  const paintBlue = channel === "rgb" || channel === "b";
  const out = new Uint8ClampedArray(source.data.length);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = paintRed ? lut[source.data[i]] : source.data[i];
    out[i + 1] = paintGreen ? lut[source.data[i + 1]] : source.data[i + 1];
    out[i + 2] = paintBlue ? lut[source.data[i + 2]] : source.data[i + 2];
    out[i + 3] = source.data[i + 3];
  }
  return { width: source.width, height: source.height, data: out };
}

/* ------------------------------------------------------------------ */
/* Histogram                                                          */
/* ------------------------------------------------------------------ */

export type Histogram = {
  /** 256 bins of sampled pixels per channel plus Rec.601 luma. */
  r: number[];
  g: number[];
  b: number[];
  luma: number[];
  /** Pixels actually counted; large images are systematically sampled. */
  samples: number;
  /** Every bin was walked with this step, so counts can be compared honestly. */
  stride: number;
  max: number;
  mean: number;
  /** Fraction of sampled pixels sitting in the four darkest bins. */
  shadows: number;
  /** Fraction sitting in the four brightest bins. */
  highlights: number;
  /** First and last luminance bin that hold a sample. */
  lowInput: number;
  highInput: number;
};

const emptyBins = () => new Array<number>(256).fill(0);

/**
 * Count the tonal distribution of real pixels. Fully transparent pixels are
 * skipped — they carry no image information and would fake a shadow spike.
 * The stride keeps the cost bounded on a 1400 px working image without
 * changing the shape of the distribution.
 */
export function histogramPixels(
  source: Pixels,
  options: { stride?: number } = {},
): Histogram {
  const pixels = source.width * source.height;
  const stride = Math.max(
    1,
    options.stride ?? Math.ceil(pixels / 200_000),
  );
  const r = emptyBins();
  const g = emptyBins();
  const b = emptyBins();
  const luma = emptyBins();
  let samples = 0;
  let lumaSum = 0;

  for (let index = 0; index < pixels; index += stride) {
    const at = index * 4;
    if (source.data[at + 3] < 8) continue;
    const red = source.data[at];
    const green = source.data[at + 1];
    const blue = source.data[at + 2];
    r[red] += 1;
    g[green] += 1;
    b[blue] += 1;
    const level = Math.max(0, Math.min(255, Math.round(0.299 * red + 0.587 * green + 0.114 * blue)));
    luma[level] += 1;
    lumaSum += level;
    samples += 1;
  }

  let max = 0;
  for (let level = 0; level < 256; level += 1) max = Math.max(max, luma[level]);
  let lowInput = 0;
  while (lowInput < 255 && luma[lowInput] === 0) lowInput += 1;
  let highInput = 255;
  while (highInput > 0 && luma[highInput] === 0) highInput -= 1;

  const shadowCount = luma[0] + luma[1] + luma[2] + luma[3];
  const highlightCount = luma[252] + luma[253] + luma[254] + luma[255];

  return {
    r,
    g,
    b,
    luma,
    samples,
    stride,
    max,
    mean: samples ? lumaSum / samples : 0,
    shadows: samples ? shadowCount / samples : 0,
    highlights: samples ? highlightCount / samples : 0,
    lowInput: samples ? lowInput : 0,
    highInput: samples ? highInput : 255,
  };
}

/** Percentile of a histogram, in level units. */
export function histogramPercentile(bins: number[], samples: number, fraction: number): number {
  if (!samples) return fraction < 0.5 ? 0 : 255;
  const target = samples * Math.max(0, Math.min(1, fraction));
  let seen = 0;
  for (let level = 0; level < bins.length; level += 1) {
    seen += bins[level];
    if (seen >= target) return level;
  }
  return bins.length - 1;
}

/**
 * Auto levels without a model: clip a small fraction from both ends of the
 * luminance range and stretch the rest across the full scale. Everything is
 * measured from the pixels in front of it, so the result is reproducible and
 * never invents detail the file does not contain.
 */
export function autoCurvePoints(histogram: Histogram, clip = 0.004): CurvePoint[] {
  if (!histogram.samples) return IDENTITY_CURVE.map((point) => ({ ...point }));
  const low = histogramPercentile(histogram.luma, histogram.samples, Math.min(clip, 0.2));
  const high = histogramPercentile(histogram.luma, histogram.samples, Math.max(0.8, 1 - clip));
  if (high - low < 8) return IDENTITY_CURVE.map((point) => ({ ...point }));
  const span = high - low;
  const median = histogramPercentile(histogram.luma, histogram.samples, 0.5);
  const mid = Math.max(low, Math.min(high, median));
  return [
    { input: low, output: 0 },
    { input: mid, output: Math.round(((mid - low) / span) * 255) },
    { input: high, output: 255 },
  ];
}

/* ------------------------------------------------------------------ */
/* Detail                                                             */
/* ------------------------------------------------------------------ */

/** Separable box blur, three passes — an O(n) approximation of a Gaussian. */
export function blurPixels(source: Pixels, radius: number): Pixels {
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return clonePixels(source);
  let current = source;
  for (let pass = 0; pass < 3; pass += 1) {
    current = boxBlurOnce(current, r);
  }
  return current;
}

function boxBlurOnce(source: Pixels, radius: number): Pixels {
  const { width, height, data } = source;
  const span = radius * 2 + 1;
  const interim = new Uint8ClampedArray(data.length);
  const out = new Uint8ClampedArray(data.length);
  // horizontal
  for (let y = 0; y < height; y += 1) {
    for (let channel = 0; channel < 4; channel += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        sum += data[(y * width + Math.min(width - 1, Math.max(0, k))) * 4 + channel];
      }
      for (let x = 0; x < width; x += 1) {
        interim[(y * width + x) * 4 + channel] = sum / span;
        const outIndex = Math.min(width - 1, Math.max(0, x - radius));
        const inIndex = Math.min(width - 1, x + radius + 1);
        sum += data[(y * width + inIndex) * 4 + channel] - data[(y * width + outIndex) * 4 + channel];
      }
    }
  }
  // vertical
  for (let x = 0; x < width; x += 1) {
    for (let channel = 0; channel < 4; channel += 1) {
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        sum += interim[(Math.min(height - 1, Math.max(0, k)) * width + x) * 4 + channel];
      }
      for (let y = 0; y < height; y += 1) {
        out[(y * width + x) * 4 + channel] = sum / span;
        const outIndex = Math.min(height - 1, Math.max(0, y - radius));
        const inIndex = Math.min(height - 1, y + radius + 1);
        sum +=
          interim[(inIndex * width + x) * 4 + channel] -
          interim[(outIndex * width + x) * 4 + channel];
      }
    }
  }
  return { width, height, data: out };
}

/** Unsharp mask: original plus the amplified difference against a blurred copy. */
export function sharpenPixels(source: Pixels, amount: number): Pixels {
  const k = amount / 100;
  if (k === 0) return clonePixels(source);
  const blurred = blurPixels(source, 2);
  const out = new Uint8ClampedArray(source.data.length);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = source.data[i] + k * (source.data[i] - blurred.data[i]);
    out[i + 1] = source.data[i + 1] + k * (source.data[i + 1] - blurred.data[i + 1]);
    out[i + 2] = source.data[i + 2] + k * (source.data[i + 2] - blurred.data[i + 2]);
    out[i + 3] = source.data[i + 3];
  }
  return { width: source.width, height: source.height, data: out };
}

/** Block-average mosaic. Blocks counts the tiles across the long edge. */
export function pixelatePixels(source: Pixels, blocks: number): Pixels {
  const tiles = Math.max(1, Math.round(blocks));
  const size = Math.max(1, Math.round(Math.max(source.width, source.height) / tiles));
  if (size <= 1) return clonePixels(source);
  const out = new Uint8ClampedArray(source.data.length);
  for (let blockY = 0; blockY < source.height; blockY += size) {
    for (let blockX = 0; blockX < source.width; blockX += size) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      const endY = Math.min(source.height, blockY + size);
      const endX = Math.min(source.width, blockX + size);
      for (let y = blockY; y < endY; y += 1) {
        for (let x = blockX; x < endX; x += 1) {
          const at = (y * source.width + x) * 4;
          r += source.data[at];
          g += source.data[at + 1];
          b += source.data[at + 2];
          a += source.data[at + 3];
          count += 1;
        }
      }
      r /= count;
      g /= count;
      b /= count;
      a /= count;
      for (let y = blockY; y < endY; y += 1) {
        for (let x = blockX; x < endX; x += 1) {
          const at = (y * source.width + x) * 4;
          out[at] = r;
          out[at + 1] = g;
          out[at + 2] = b;
          out[at + 3] = a;
        }
      }
    }
  }
  return { width: source.width, height: source.height, data: out };
}

/** Solid frame painted over the inner edge of the image. */
export function borderPixels(source: Pixels, width: number, color: string, opacity: number): Pixels {
  const band = Math.max(0, Math.round(width));
  if (band === 0) return clonePixels(source);
  const [r, g, b] = parseColor(color);
  const alpha = Math.max(0, Math.min(1, opacity / 100));
  const out = new Uint8ClampedArray(source.data);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      if (x >= band && x < source.width - band && y >= band && y < source.height - band) {
        continue;
      }
      const at = (y * source.width + x) * 4;
      out[at] = out[at] * (1 - alpha) + r * alpha;
      out[at + 1] = out[at + 1] * (1 - alpha) + g * alpha;
      out[at + 2] = out[at + 2] * (1 - alpha) + b * alpha;
      out[at + 3] = Math.max(out[at + 3], 255 * alpha);
    }
  }
  return { width: source.width, height: source.height, data: out };
}

/* ------------------------------------------------------------------ */
/* Pipeline                                                           */
/* ------------------------------------------------------------------ */

function applyText(source: Pixels, op: TextOp, rasterize: Rasterizer | undefined): Pixels {
  const target = clonePixels(source);
  if (!rasterize || !op.text) return target;
  rasterize(target, (context, width, height) => {
    context.clearRect(0, 0, width, height);
    context.font = `${op.weight} ${op.size}px "Inter", "Segoe UI", sans-serif`;
    context.textBaseline = "middle";
    context.textAlign = "center";
    context.globalAlpha = Math.max(0, Math.min(1, op.opacity / 100));
    if (op.shadow) {
      context.shadowColor = "rgba(0,0,0,0.6)";
      context.shadowBlur = Math.max(2, op.size * 0.25);
    }
    context.fillStyle = op.color;
    context.fillText(op.text, (op.x / 100) * width, (op.y / 100) * height);
  });
  return target;
}

function applyWatermark(source: Pixels, op: WatermarkOp, rasterize: Rasterizer | undefined): Pixels {
  const target = clonePixels(source);
  if (!rasterize || !op.text) return target;
  rasterize(target, (context, width, height) => {
    context.clearRect(0, 0, width, height);
    context.font = `600 ${op.size}px "Inter", "Segoe UI", sans-serif`;
    context.textBaseline = "middle";
    context.textAlign = "center";
    context.globalAlpha = Math.max(0, Math.min(1, op.opacity / 100));
    context.fillStyle = op.color;
    const step = Math.max(40, (op.step / 100) * width);
    const radians = (op.angle * Math.PI) / 180;
    const diagonal = Math.sqrt(width * width + height * height);
    context.translate(width / 2, height / 2);
    context.rotate(radians);
    for (let y = -diagonal / 2; y <= diagonal / 2; y += step * 0.6) {
      for (let x = -diagonal / 2; x <= diagonal / 2; x += step) {
        context.fillText(op.text, x, y);
      }
    }
  });
  return target;
}

/**
 * Run the whole chain. Text and watermark steps composite onto the working
 * surface through the injected rasteriser, so the pipeline stays pure and
 * testable while the app still renders real glyphs. Every step hands back a
 * new buffer: the caller's base pixels are never written in place, which is
 * what lets the same chain run twice and produce the same image.
 */
export function applyOps(source: Pixels, ops: Op[], rasterize?: Rasterizer): Pixels {
  let current = source;
  for (const op of ops) {
    switch (op.kind) {
      case "crop":
        current = cropPixels(current, op.x, op.y, op.width, op.height);
        break;
      case "resize":
        current = resizePixels(current, op.width, op.height);
        break;
      case "rotate":
        current = rotatePixels(current, op.angle);
        break;
      case "flip":
        current = flipPixels(current, op.axis);
        break;
      case "exposure":
        current = exposurePixels(current, op.stops);
        break;
      case "brightness":
        current = brightnessPixels(current, op.amount);
        break;
      case "contrast":
        current = contrastPixels(current, op.amount);
        break;
      case "saturation":
        current = saturationPixels(current, op.amount);
        break;
      case "temperature":
        current = temperaturePixels(current, op.amount);
        break;
      case "gamma":
        current = gammaPixels(current, op.amount);
        break;
      case "vignette":
        current = vignettePixels(current, op.amount);
        break;
      case "blur":
        current = blurPixels(current, op.radius);
        break;
      case "sharpen":
        current = sharpenPixels(current, op.amount);
        break;
      case "pixelate":
        current = pixelatePixels(current, op.blocks);
        break;
      case "border":
        current = borderPixels(current, op.width, op.color, op.opacity);
        break;
      case "curves":
        current = curvePixels(current, op.channel, op.points);
        break;
      case "text":
        current = applyText(current, op, rasterize);
        break;
      case "watermark":
        current = applyWatermark(current, op, rasterize);
        break;
      default:
        break;
    }
  }
  return current;
}

/** Mean absolute difference per channel — used by tests and the smoke suite. */
export function meanDifference(a: Pixels, b: Pixels): number {
  const shared = Math.min(a.data.length, b.data.length);
  if (!shared) return 0;
  let sum = 0;
  for (let i = 0; i < shared; i += 1) sum += Math.abs(a.data[i] - b.data[i]);
  return sum / shared;
}

export function averagePixels(source: Pixels): { r: number; g: number; b: number } {
  let r = 0;
  let g = 0;
  let b = 0;
  const pixels = source.width * source.height;
  for (let i = 0; i < source.data.length; i += 4) {
    r += source.data[i];
    g += source.data[i + 1];
    b += source.data[i + 2];
  }
  return { r: r / pixels, g: g / pixels, b: b / pixels };
}
