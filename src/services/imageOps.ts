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

function applyText(target: Pixels, op: TextOp, rasterize: Rasterizer | undefined): Pixels {
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

function applyWatermark(target: Pixels, op: WatermarkOp, rasterize: Rasterizer | undefined): Pixels {
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
 * testable while the app still renders real glyphs.
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
