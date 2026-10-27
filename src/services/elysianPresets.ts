/**
 * KNOUX REC — Elysian effect and preset registry.
 *
 * Every entry here maps to real operations in `imageOps`. Nothing in this file
 * produces a preview on its own; the UI renders thumbnails by running the ops
 * over the working image, so a card can never show art that the app cannot
 * reproduce. Services that need missing weights are listed separately and are
 * never given a fake preview.
 */

import type { CurvePoint, Op } from "./imageOps";

export type EffectCategory = "geometry" | "light" | "colour" | "detail" | "marks";

export type EffectDefinition = {
  id: string;
  labelKey: string;
  category: EffectCategory;
  /** The op added to the stack when the card is used. */
  op: Op;
  /** Parameters the inspector exposes for tuning this effect. */
  controls: Array<{ field: string; labelKey: string; min: number; max: number; step: number }>;
};

export type PresetDefinition = {
  id: string;
  labelKey: string;
  ops: Op[];
};

export type BlockedService = {
  id: string;
  labelKey: string;
  reasonKey: string;
  needs: string;
};

const slider = (
  field: string,
  labelKey: string,
  min: number,
  max: number,
  step = 1,
) => ({ field, labelKey, min, max, step });

/**
 * Curve shapes are literal transfer functions, not looks baked into a file.
 * The card preview, the workbench and the saved layer all read the same
 * points, so what the user drags is what the pixels do.
 */
export type CurveShape = {
  id: string;
  labelKey: string;
  points: CurvePoint[];
};

/** The curve a new layer starts with: a gentle S, so it visibly does work. */
export const DEFAULT_CURVE_POINTS: CurvePoint[] = [
  { input: 0, output: 0 },
  { input: 64, output: 52 },
  { input: 128, output: 134 },
  { input: 192, output: 208 },
  { input: 255, output: 255 },
];

export const CURVE_SHAPES: CurveShape[] = [
  {
    id: "linear",
    labelKey: "elysian.curve.linear",
    points: [
      { input: 0, output: 0 },
      { input: 255, output: 255 },
    ],
  },
  {
    id: "contrast",
    labelKey: "elysian.curve.contrast",
    points: [
      { input: 0, output: 0 },
      { input: 64, output: 48 },
      { input: 128, output: 134 },
      { input: 192, output: 212 },
      { input: 255, output: 255 },
    ],
  },
  {
    id: "matte",
    labelKey: "elysian.curve.matte",
    points: [
      { input: 0, output: 34 },
      { input: 64, output: 74 },
      { input: 128, output: 138 },
      { input: 192, output: 194 },
      { input: 255, output: 231 },
    ],
  },
  {
    id: "open",
    labelKey: "elysian.curve.open",
    points: [
      { input: 0, output: 0 },
      { input: 64, output: 86 },
      { input: 128, output: 162 },
      { input: 192, output: 216 },
      { input: 255, output: 255 },
    ],
  },
];

export const EFFECTS: EffectDefinition[] = [
  /* geometry */
  {
    id: "crop",
    labelKey: "elysian.effect.crop",
    category: "geometry",
    op: { kind: "crop", x: 0, y: 0, width: 400, height: 300 },
    controls: [
      slider("x", "elysian.field.x", 0, 100),
      slider("y", "elysian.field.y", 0, 100),
      slider("width", "elysian.field.width", 10, 100),
      slider("height", "elysian.field.height", 10, 100),
    ],
  },
  {
    id: "resize",
    labelKey: "elysian.effect.resize",
    category: "geometry",
    op: { kind: "resize", width: 1200, height: 800, filter: "lanczos" },
    controls: [
      slider("width", "elysian.field.width", 16, 4096),
      slider("height", "elysian.field.height", 16, 4096),
    ],
  },
  {
    // One click doubles the working image through the same Lanczos path; the
    // neural super-resolution service stays blocked on its weight file.
    id: "upscale",
    labelKey: "elysian.effect.upscale",
    category: "geometry",
    op: { kind: "resize", width: 0, height: 0, filter: "lanczos" },
    controls: [],
  },
  {
    id: "rotate",
    labelKey: "elysian.effect.rotate",
    category: "geometry",
    op: { kind: "rotate", angle: 90 },
    controls: [slider("angle", "elysian.field.angle", -180, 180)],
  },
  {
    id: "flip-h",
    labelKey: "elysian.effect.flipH",
    category: "geometry",
    op: { kind: "flip", axis: "h" },
    controls: [],
  },
  {
    id: "flip-v",
    labelKey: "elysian.effect.flipV",
    category: "geometry",
    op: { kind: "flip", axis: "v" },
    controls: [],
  },

  /* light */
  {
    id: "curves",
    labelKey: "elysian.effect.curves",
    category: "light",
    op: { kind: "curves", channel: "rgb", points: DEFAULT_CURVE_POINTS },
    controls: [],
  },
  {
    id: "exposure",
    labelKey: "elysian.effect.exposure",
    category: "light",
    op: { kind: "exposure", stops: 0.5 },
    controls: [slider("stops", "elysian.field.stops", -3, 3, 0.05)],
  },
  {
    id: "brightness",
    labelKey: "elysian.effect.brightness",
    category: "light",
    op: { kind: "brightness", amount: 15 },
    controls: [slider("amount", "elysian.field.amount", -100, 100)],
  },
  {
    id: "contrast",
    labelKey: "elysian.effect.contrast",
    category: "light",
    op: { kind: "contrast", amount: 20 },
    controls: [slider("amount", "elysian.field.amount", -100, 100)],
  },
  {
    id: "gamma",
    labelKey: "elysian.effect.gamma",
    category: "light",
    op: { kind: "gamma", amount: 1.2 },
    controls: [slider("amount", "elysian.field.gamma", 0.2, 3, 0.01)],
  },
  {
    id: "vignette",
    labelKey: "elysian.effect.vignette",
    category: "light",
    op: { kind: "vignette", amount: 55 },
    controls: [slider("amount", "elysian.field.amount", 0, 100)],
  },

  /* colour */
  {
    id: "saturation",
    labelKey: "elysian.effect.saturation",
    category: "colour",
    op: { kind: "saturation", amount: 30 },
    controls: [slider("amount", "elysian.field.amount", -100, 100)],
  },
  {
    id: "temperature",
    labelKey: "elysian.effect.temperature",
    category: "colour",
    op: { kind: "temperature", amount: 20 },
    controls: [slider("amount", "elysian.field.amount", -100, 100)],
  },
  {
    id: "mono",
    labelKey: "elysian.effect.mono",
    category: "colour",
    op: { kind: "saturation", amount: -100 },
    controls: [slider("amount", "elysian.field.amount", -100, 100)],
  },

  /* detail */
  {
    id: "heal",
    labelKey: "elysian.effect.heal",
    category: "detail",
    op: { kind: "heal", x: 0, y: 0, radius: 24 },
    controls: [],
  },
  {
    id: "blur",
    labelKey: "elysian.effect.blur",
    category: "detail",
    op: { kind: "blur", radius: 6 },
    controls: [slider("radius", "elysian.field.radius", 1, 40)],
  },
  {
    id: "sharpen",
    labelKey: "elysian.effect.sharpen",
    category: "detail",
    op: { kind: "sharpen", amount: 60 },
    controls: [slider("amount", "elysian.field.amount", 0, 200)],
  },
  {
    id: "pixelate",
    labelKey: "elysian.effect.pixelate",
    category: "detail",
    op: { kind: "pixelate", blocks: 48 },
    controls: [slider("blocks", "elysian.field.blocks", 2, 200)],
  },

  /* marks */
  {
    id: "border",
    labelKey: "elysian.effect.border",
    category: "marks",
    op: { kind: "border", width: 24, color: "#ffffff", opacity: 100 },
    controls: [
      slider("width", "elysian.field.width", 1, 200),
      slider("opacity", "elysian.field.opacity", 0, 100),
    ],
  },
  {
    id: "text",
    labelKey: "elysian.effect.text",
    category: "marks",
    op: {
      kind: "text",
      text: "KNOUX",
      x: 50,
      y: 82,
      size: 64,
      color: "#ffffff",
      opacity: 100,
      weight: "800",
      shadow: true,
    },
    controls: [
      slider("x", "elysian.field.x", 0, 100),
      slider("y", "elysian.field.y", 0, 100),
      slider("size", "elysian.field.size", 8, 400),
      slider("opacity", "elysian.field.opacity", 0, 100),
    ],
  },
  {
    id: "watermark",
    labelKey: "elysian.effect.watermark",
    category: "marks",
    op: {
      kind: "watermark",
      text: "KNOUX REC",
      size: 28,
      opacity: 14,
      angle: -28,
      step: 34,
      color: "#ffffff",
    },
    controls: [
      slider("size", "elysian.field.size", 8, 160),
      slider("opacity", "elysian.field.opacity", 1, 100),
      slider("angle", "elysian.field.angle", -90, 90),
      slider("step", "elysian.field.step", 5, 100),
    ],
  },
];

/**
 * Presets are ordinary op lists — visible, editable and removable in the
 * history strip rather than an opaque lookup.
 */
export const PRESETS: PresetDefinition[] = [
  {
    id: "noir",
    labelKey: "elysian.preset.noir",
    ops: [
      { kind: "saturation", amount: -100 },
      { kind: "contrast", amount: 38 },
      { kind: "gamma", amount: 0.92 },
      { kind: "vignette", amount: 62 },
      { kind: "sharpen", amount: 40 },
    ],
  },
  {
    id: "bleach",
    labelKey: "elysian.preset.bleach",
    ops: [
      { kind: "exposure", stops: 0.45 },
      { kind: "saturation", amount: -62 },
      { kind: "contrast", amount: 26 },
      { kind: "temperature", amount: -14 },
    ],
  },
  {
    id: "golden",
    labelKey: "elysian.preset.golden",
    ops: [
      { kind: "temperature", amount: 34 },
      { kind: "exposure", stops: 0.2 },
      { kind: "saturation", amount: 16 },
      { kind: "vignette", amount: 28 },
    ],
  },
  {
    id: "cinema",
    labelKey: "elysian.preset.cinema",
    ops: [
      { kind: "contrast", amount: 22 },
      { kind: "temperature", amount: -22 },
      { kind: "saturation", amount: -18 },
      { kind: "gamma", amount: 1.08 },
      { kind: "border", width: 26, color: "#000000", opacity: 100 },
    ],
  },
  {
    id: "soft",
    labelKey: "elysian.preset.soft",
    ops: [
      { kind: "blur", radius: 2 },
      { kind: "brightness", amount: 10 },
      { kind: "saturation", amount: -12 },
      { kind: "contrast", amount: -8 },
    ],
  },
  {
    id: "punch",
    labelKey: "elysian.preset.punch",
    ops: [
      { kind: "contrast", amount: 34 },
      { kind: "saturation", amount: 42 },
      { kind: "sharpen", amount: 80 },
    ],
  },
  {
    id: "vhs",
    labelKey: "elysian.preset.vhs",
    ops: [
      { kind: "pixelate", blocks: 140 },
      { kind: "saturation", amount: 46 },
      { kind: "temperature", amount: 18 },
      { kind: "contrast", amount: 14 },
    ],
  },
  {
    id: "signature",
    labelKey: "elysian.preset.signature",
    ops: [
      { kind: "contrast", amount: 12 },
      { kind: "border", width: 34, color: "#ffffff", opacity: 100 },
      {
        kind: "text",
        text: "KNOUX REC",
        x: 50,
        y: 93,
        size: 34,
        color: "#101014",
        opacity: 80,
        weight: "600",
        shadow: false,
      },
    ],
  },
  {
    id: "mattefilm",
    labelKey: "elysian.preset.mattefilm",
    ops: [
      { kind: "curves", channel: "rgb", points: CURVE_SHAPES[2].points },
      { kind: "saturation", amount: -16 },
      { kind: "temperature", amount: -8 },
    ],
  },
  {
    id: "crossprocess",
    labelKey: "elysian.preset.crossprocess",
    ops: [
      { kind: "curves", channel: "rgb", points: CURVE_SHAPES[1].points },
      {
        kind: "curves",
        channel: "r",
        points: [
          { input: 0, output: 18 },
          { input: 128, output: 118 },
          { input: 255, output: 248 },
        ],
      },
      {
        kind: "curves",
        channel: "b",
        points: [
          { input: 0, output: 30 },
          { input: 128, output: 150 },
          { input: 255, output: 255 },
        ],
      },
      { kind: "saturation", amount: 22 },
    ],
  },
];

/**
 * Listed for completeness of the creative universe, but genuinely unavailable:
 * each needs model weights or a native engine that is not installed. The UI
 * shows these as blocked rows, never as runnable cards.
 */
export const BLOCKED_SERVICES: BlockedService[] = [
  {
    id: "neural-retouch",
    labelKey: "elysian.blocked.retouch",
    reasonKey: "elysian.blocked.retouchReason",
    needs: "face-parsing.onnx",
  },
  {
    id: "background-removal",
    labelKey: "elysian.blocked.background",
    reasonKey: "elysian.blocked.backgroundReason",
    needs: "u2netp.onnx",
  },
  {
    id: "super-resolution",
    labelKey: "elysian.blocked.upscale",
    reasonKey: "elysian.blocked.upscaleReason",
    needs: "real-esrgan-x2.onnx",
  },
  {
    id: "style-transfer",
    labelKey: "elysian.blocked.style",
    reasonKey: "elysian.blocked.styleReason",
    needs: "transformer.tflite",
  },
  {
    id: "auto-crop",
    labelKey: "elysian.blocked.autocrop",
    reasonKey: "elysian.blocked.autocropReason",
    needs: "saliency.onnx",
  },
  {
    id: "generative-fill",
    labelKey: "elysian.blocked.generative",
    reasonKey: "elysian.blocked.generativeReason",
    needs: "sd-turbo (online service, not bundled)",
  },
];

export const CATEGORY_KEYS: Record<EffectCategory, string> = {
  geometry: "elysian.category.geometry",
  light: "elysian.category.light",
  colour: "elysian.category.colour",
  detail: "elysian.category.detail",
  marks: "elysian.category.marks",
};

export const CATEGORY_ORDER: EffectCategory[] = [
  "geometry",
  "light",
  "colour",
  "detail",
  "marks",
];

/** A neutral starting point for each effect when the card is added. */
export function effectById(id: string): EffectDefinition | undefined {
  return EFFECTS.find((effect) => effect.id === id);
}
