/* eslint-disable @typescript-eslint/no-explicit-any -- canvas mock needs any for internal state */
/**
 * Visual Patch Lab — algorithm-family regression tests.
 *
 * The capability registry declares visual-patch PARTIAL because only one tool
 * family was driven end to end. These tests exercise every edit mode that a
 * catalog tool actually maps to (pinch, warp, sculpt, curve, smooth, mirror,
 * brush) through the real service, and assert that each one produces a
 * measurable pixel change on a non-trivial canvas.
 *
 * The global test setup (src/test/setup.ts) replaces getContext with a no-op
 * mock. These tests need a real 2D context, so each test creates a fresh
 * canvas and installs a minimal but real pixel backend before constructing the
 * service. The backend is intentionally simple — it stores pixels in a
 * Uint8ClampedArray and implements exactly the operations the service calls:
 * drawImage, getImageData, putImageData, createImageData, save, restore,
 * scale, and globalAlpha / globalCompositeOperation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── Minimal real canvas backend ─────────────────────────────────────────────

type Transform = { a: number; b: number; c: number; d: number; e: number; f: number };

function createRealContext(width: number, height: number): CanvasRenderingContext2D {
  const pixels = new Uint8ClampedArray(width * height * 4);
  // Fill with a gradient-like pattern so we have distinct pixels to verify.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      pixels[idx] = (x * 255) / width; // R varies horizontally
      pixels[idx + 1] = (y * 255) / height; // G varies vertically
      pixels[idx + 2] = 128; // B constant
      pixels[idx + 3] = 255; // A opaque
    }
  }

  const state = {
    width,
    height,
    pixels,
    alpha: 1,
    compositeOp: "source-over" as GlobalCompositeOperation,
    transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    transformStack: [] as Transform[],
    currentPath: [] as Array<{ x: number; y: number }>,
    strokeStyle: "rgba(0,0,0,0.1)",
    lineWidth: 1,
    lineCap: "butt" as string,
    lineJoin: "miter" as string,
  };

  function blendPixel(x: number, y: number, r: number, g: number, b: number, a: number) {
    const idx = (y * width + x) * 4;
    if (idx < 0 || idx + 3 >= state.pixels.length) return;
    const alpha = state.alpha * a;
    if (alpha <= 0) return;
    const inv = 1 - alpha;
    state.pixels[idx] = Math.round(state.pixels[idx] * inv + r * alpha);
    state.pixels[idx + 1] = Math.round(state.pixels[idx + 1] * inv + g * alpha);
    state.pixels[idx + 2] = Math.round(state.pixels[idx + 2] * inv + b * alpha);
  }

  function parseColor(style: string): [number, number, number, number] {
    if (style.startsWith("rgba")) {
      const m = style.match(/rgba?\(([^)]+)\)/);
      if (m) {
        const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
        return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, (parts[3] ?? 1)];
      }
    }
    if (style.startsWith("rgb")) {
      const m = style.match(/rgb\(([^)]+)\)/);
      if (m) {
        const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
        return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, 1];
      }
    }
    if (style.startsWith("#")) {
      const hex = style.slice(1);
      if (hex.length === 6) {
        return [
          parseInt(hex.slice(0, 2), 16),
          parseInt(hex.slice(2, 4), 16),
          parseInt(hex.slice(4, 6), 16),
          1,
        ];
      }
    }
    return [0, 0, 0, 1];
  }

  function strokePath() {
    const [r, g, b, a] = parseColor(state.strokeStyle);
    const lw = Math.max(1, Math.round(state.lineWidth));
    for (let i = 0; i < state.currentPath.length - 1; i++) {
      const p0 = state.currentPath[i];
      const p1 = state.currentPath[i + 1];
      // Bresenham-like line with thickness.
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const steps = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dy * dy)));
      for (let s = 0; s <= steps; s++) {
        const px = Math.round(p0.x + (dx * s) / steps);
        const py = Math.round(p0.y + (dy * s) / steps);
        for (let oy = -lw; oy <= lw; oy++) {
          for (let ox = -lw; ox <= lw; ox++) {
            if (ox * ox + oy * oy <= lw * lw) {
              blendPixel(px + ox, py + oy, r, g, b, a);
            }
          }
        }
      }
    }
    state.currentPath = [];
  }

  const ctx = {
    canvas: { width, height } as HTMLCanvasElement,
    globalAlpha: 1,
    globalCompositeOperation: "source-over" as GlobalCompositeOperation,
    fillRect: () => {},
    clearRect: () => {},
    getImageData: (x: number, y: number, w: number, h: number): ImageData => {
      const data = new Uint8ClampedArray(w * h * 4);
      const sx = Math.max(0, Math.floor(x));
      const sy = Math.max(0, Math.floor(y));
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) {
          const srcIdx = ((sy + row) * width + (sx + col)) * 4;
          const dstIdx = (row * w + col) * 4;
          if (srcIdx >= 0 && srcIdx + 3 < state.pixels.length) {
            data[dstIdx] = state.pixels[srcIdx];
            data[dstIdx + 1] = state.pixels[srcIdx + 1];
            data[dstIdx + 2] = state.pixels[srcIdx + 2];
            data[dstIdx + 3] = state.pixels[srcIdx + 3];
          }
        }
      }
      return { data, width: w, height: h, colorSpace: "srgb" } as ImageData;
    },
    putImageData: (img: ImageData, dx: number, dy: number): void => {
      for (let row = 0; row < img.height; row++) {
        for (let col = 0; col < img.width; col++) {
          const srcIdx = (row * img.width + col) * 4;
          const dstIdx = ((dy + row) * width + (dx + col)) * 4;
          if (dstIdx >= 0 && dstIdx + 3 < state.pixels.length) {
            state.pixels[dstIdx] = img.data[srcIdx];
            state.pixels[dstIdx + 1] = img.data[srcIdx + 1];
            state.pixels[dstIdx + 2] = img.data[srcIdx + 2];
            state.pixels[dstIdx + 3] = img.data[srcIdx + 3];
          }
        }
      }
    },
    createImageData: (w: number, h: number): ImageData => {
      return {
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h,
        colorSpace: "srgb",
      } as ImageData;
    },
    drawImage: (source: HTMLCanvasElement | CanvasImageSource, sx: number, sy: number, sw?: number, sh?: number): void => {
      // Self-copy (mirror flips the canvas onto itself): snapshot first.
      const src = source as unknown as { pixels?: Uint8ClampedArray; width?: number; height?: number };
      const sourcePixels = src.pixels
        ? src.pixels.slice()
        : state.pixels.slice();
      const srcW = src.width ?? width;
      const srcH = src.height ?? height;
      const drawW = sw ?? srcW;
      const drawH = sh ?? srcH;
      for (let row = 0; row < drawH; row++) {
        for (let col = 0; col < drawW; col++) {
          const srcIdx = ((sy + row) * srcW + (sx + col)) * 4;
          const dstIdx = (row * width + col) * 4;
          if (srcIdx + 3 < sourcePixels.length && dstIdx + 3 < state.pixels.length) {
            // Apply transform (for mirror: scale(-1,1) then translate).
            const tx = state.transform.a * col + state.transform.e;
            const ty = state.transform.d * row + state.transform.f;
            const dstX = Math.round(tx < 0 ? width + tx : tx);
            const dstY = Math.round(ty);
            const finalIdx = (dstY * width + dstX) * 4;
            if (finalIdx >= 0 && finalIdx + 3 < state.pixels.length) {
              state.pixels[finalIdx] = sourcePixels[srcIdx];
              state.pixels[finalIdx + 1] = sourcePixels[srcIdx + 1];
              state.pixels[finalIdx + 2] = sourcePixels[srcIdx + 2];
              state.pixels[finalIdx + 3] = sourcePixels[srcIdx + 3];
            }
          }
        }
      }
    },
    save: () => {
      state.transformStack.push({ ...state.transform });
    },
    restore: () => {
      const t = state.transformStack.pop();
      if (t) state.transform = t;
    },
    scale: (x: number, y: number) => {
      state.transform.a *= x;
      state.transform.d *= y;
    },
    translate: (x: number, y: number) => {
      state.transform.e += x;
      state.transform.f += y;
    },
    rotate: () => {},
    transform: () => {},
    setTransform: () => {},
    beginPath: () => { state.currentPath = []; },
    closePath: () => {},
    moveTo: (x: number, y: number) => { state.currentPath = [{ x, y }]; },
    lineTo: (x: number, y: number) => { state.currentPath.push({ x, y }); },
    arc: () => {},
    fill: () => {},
    stroke: () => { strokePath(); },
    rect: () => {},
    clip: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    set fillStyle(_: unknown) {},
    get fillStyle() { return "#000"; },
    set strokeStyle(v: unknown) { state.strokeStyle = String(v); },
    get strokeStyle() { return state.strokeStyle; },
    set lineWidth(v: number) { state.lineWidth = v; },
    get lineWidth() { return state.lineWidth; },
    set lineCap(v: string) { state.lineCap = v; },
    get lineCap() { return state.lineCap; },
    set lineJoin(v: string) { state.lineJoin = v; },
    get lineJoin() { return state.lineJoin; },
    set font(_: string) {},
    get font() { return "10px sans-serif"; },
    set textAlign(_: unknown) {},
    get textAlign() { return "left"; },
    fillText: () => {},
    strokeText: () => {},
    measureText: () => ({ width: 10 }),
    set imageSmoothingEnabled(_: boolean) {},
    get imageSmoothingEnabled() { return true; },
    set shadowBlur(_: number) {},
    get shadowBlur() { return 0; },
    set shadowColor(_: string) {},
    get shadowColor() { return "transparent"; },
    set shadowOffsetX(_: number) {},
    get shadowOffsetX() { return 0; },
    set shadowOffsetY(_: number) {},
    get shadowOffsetY() { return 0; },
  } as unknown as CanvasRenderingContext2D;

  // Sync the public property back to state on every access.
  Object.defineProperty(ctx, "globalAlpha", {
    get: () => state.alpha,
    set: (v: number) => { state.alpha = v; },
  });
  Object.defineProperty(ctx, "globalCompositeOperation", {
    get: () => state.compositeOp,
    set: (v: GlobalCompositeOperation) => { state.compositeOp = v; },
  });

  // Expose the pixel store so patchCanvasProto can attach it to canvas elements.
  (ctx as any)._pixels = state.pixels;

  return ctx;
}

function patchCanvasProto(width: number, height: number) {
  const ctx = createRealContext(width, height);
  const origGetContext = HTMLCanvasElement.prototype.getContext;

  // The service calls getContext on multiple canvases; they all share the
  // same context and pixel store. We also attach the pixel store to each
  // canvas element so drawImage(canvas, ...) can read from it.
  const pixelStore = (ctx as any)._pixels as Uint8ClampedArray;

  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as any;

  // Override createElement so canvases carry the pixel store and dimensions.
  const origCreateElement = document.createElement.bind(document);
  (document as any).createElement = function (tag: string) {
    const el = origCreateElement(tag);
    if (tag.toLowerCase() === "canvas") {
      (el as any).pixels = pixelStore;
      (el as any).width = width;
      (el as any).height = height;
      // When getContext is called on this specific canvas, return the shared ctx.
      (el as any).getContext = () => ctx;
    }
    return el;
  };

  return {
    ctx,
    restore: () => {
      HTMLCanvasElement.prototype.getContext = origGetContext;
      (document as any).createElement = origCreateElement;
    },
  };
}

// ── Test fixtures ───────────────────────────────────────────────────────────

const W = 40;
const H = 40;

async function makeFile(): Promise<File> {
  // A 40×40 PNG created as a data URL is enough for createSession.
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext("2d")!;
  const img = c.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      img.data[idx] = (x * 255) / W;
      img.data[idx + 1] = (y * 255) / H;
      img.data[idx + 2] = 128;
      img.data[idx + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), "image/png"),
  );
  return new File([blob], "test.png", { type: "image/png" });
}

function makeRegion(cx: number, cy: number, brushSize: number): EditRegion {
  return {
    id: "r1",
    points: [
      { x: cx, y: cy },
      { x: cx + 5, y: cy },
      { x: cx + 10, y: cy + 3 },
    ],
    intensity: 50,
    brushSize,
    feather: 10,
  };
}

function countChangedPixels(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
): number {
  let changed = 0;
  for (let i = 0; i < before.length; i += 4) {
    if (
      before[i] !== after[i] ||
      before[i + 1] !== after[i + 1] ||
      before[i + 2] !== after[i + 2]
    ) {
      changed++;
    }
  }
  return changed;
}

// ── Tests ───────────────────────────────────────────────────────────────────

import type { EditRegion } from "../../types/visualPatchLab";

describe("Visual Patch Lab — algorithm-family regression", () => {
  let service: any;
  let patch: { ctx: CanvasRenderingContext2D; restore: () => void };
  let origImage: typeof Image;

  beforeEach(async () => {
    patch = patchCanvasProto(W, H);

    // The service's createSession calls new Image() and waits for onload.
    // jsdom never fires onload for data URLs, so we stub Image to resolve
    // synchronously with the expected dimensions.
    origImage = globalThis.Image;
    class StubImage {
      width = W;
      height = H;
      private _src = "";
      onload: (() => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      get src(): string { return this._src; }
      set src(v: string) {
        this._src = v;
        // Fire onload on the next microtask so the listener is attached.
        Promise.resolve().then(() => {
          if (this.onload) this.onload();
        });
      }
    }
    (globalThis as unknown as { Image: typeof Image }).Image = StubImage as unknown as typeof Image;

    const { VisualPatchLabService } = await import(
      "../../services/visualPatchLabService"
    );
    service = new VisualPatchLabService();
    const file = await makeFile();
    await service.createSession(file);
  });

  afterEach(() => {
    patch?.restore();
    (globalThis as any).Image = origImage;
  });

  it("pinch: body-scale-full-enlarge changes pixels inside the brush radius", async () => {
    const ctx = patch.ctx;
    const before = ctx.getImageData(0, 0, W, H).data;
    const region = makeRegion(20, 20, 15);
    await service.applyTool("body-scale-full-enlarge", [region], {
      intensity: 50,
      brushSize: 15,
      feather: 10,
      symmetryEnabled: false,
      realTimePreview: false,
      snapToGrid: false,
    });
    const after = ctx.getImageData(0, 0, W, H).data;
    const changed = countChangedPixels(before, after);
    expect(changed).toBeGreaterThan(0);
  });

  it("warp: body-scale-upper-enlarge changes pixels along the warp path", async () => {
    const ctx = patch.ctx;
    const before = ctx.getImageData(0, 0, W, H).data;
    const region = makeRegion(10, 10, 12);
    await service.applyTool("body-scale-upper-enlarge", [region], {
      intensity: 50,
      brushSize: 12,
      feather: 10,
      symmetryEnabled: false,
      realTimePreview: false,
      snapToGrid: false,
    });
    const after = ctx.getImageData(0, 0, W, H).data;
    const changed = countChangedPixels(before, after);
    expect(changed).toBeGreaterThan(0);
  });

  it("sculpt: belly-flatten changes pixels in the sculpted region", async () => {
    const ctx = patch.ctx;
    const before = ctx.getImageData(0, 0, W, H).data;
    const region = makeRegion(20, 25, 10);
    await service.applyTool("belly-flatten", [region], {
      intensity: 50,
      brushSize: 10,
      feather: 10,
      symmetryEnabled: false,
      realTimePreview: false,
      snapToGrid: false,
    });
    const after = ctx.getImageData(0, 0, W, H).data;
    const changed = countChangedPixels(before, after);
    expect(changed).toBeGreaterThan(0);
  });

  it("curve: waist-curves-enhance changes pixels along the spline", async () => {
    const ctx = patch.ctx;
    const before = ctx.getImageData(0, 0, W, H).data;
    const region = makeRegion(15, 20, 12);
    await service.applyTool("waist-curves-enhance", [region], {
      intensity: 50,
      brushSize: 12,
      feather: 10,
      symmetryEnabled: false,
      realTimePreview: false,
      snapToGrid: false,
    });
    const after = ctx.getImageData(0, 0, W, H).data;
    const changed = countChangedPixels(before, after);
    expect(changed).toBeGreaterThan(0);
  });

  it("smooth: thighs-smooth changes pixels by blurring", async () => {
    const ctx = patch.ctx;
    const before = ctx.getImageData(0, 0, W, H).data;
    const region = makeRegion(20, 30, 10);
    await service.applyTool("thighs-smooth", [region], {
      intensity: 60,
      brushSize: 10,
      feather: 20,
      symmetryEnabled: false,
      realTimePreview: false,
      snapToGrid: false,
    });
    const after = ctx.getImageData(0, 0, W, H).data;
    const changed = countChangedPixels(before, after);
    expect(changed).toBeGreaterThan(0);
  });

  it("mirror: chest-balance mirrors pixels across the centre axis", async () => {
    const ctx = patch.ctx;
    const before = ctx.getImageData(0, 0, W, H).data;
    const region = makeRegion(10, 20, 15);
    await service.applyTool("chest-balance", [region], {
      intensity: 50,
      brushSize: 15,
      feather: 10,
      symmetryEnabled: false,
      realTimePreview: false,
      snapToGrid: false,
    });
    const after = ctx.getImageData(0, 0, W, H).data;
    const changed = countChangedPixels(before, after);
    expect(changed).toBeGreaterThan(0);
  });

  it("brush: freeform-brush paints pixels onto the canvas", async () => {
    const ctx = patch.ctx;
    const before = ctx.getImageData(0, 0, W, H).data;
    const region = makeRegion(20, 20, 10);
    await service.applyTool("freeform-brush", [region], {
      intensity: 80,
      brushSize: 10,
      feather: 20,
      symmetryEnabled: false,
      realTimePreview: false,
      snapToGrid: false,
    });
    const after = ctx.getImageData(0, 0, W, H).data;
    const changed = countChangedPixels(before, after);
    expect(changed).toBeGreaterThan(0);
  });

  it("undo restores the pre-operation pixels after any edit mode", async () => {
    const ctx = patch.ctx;
    const before = ctx.getImageData(0, 0, W, H).data;
    const region = makeRegion(20, 20, 12);
    await service.applyTool("body-scale-full-enlarge", [region], {
      intensity: 50,
      brushSize: 12,
      feather: 10,
      symmetryEnabled: false,
      realTimePreview: false,
      snapToGrid: false,
    });
    const afterEdit = ctx.getImageData(0, 0, W, H).data;
    expect(countChangedPixels(before, afterEdit)).toBeGreaterThan(0);

    service.undo();
    const afterUndo = ctx.getImageData(0, 0, W, H).data;
    // Undo should restore pixels to the pre-operation state.
    expect(countChangedPixels(before, afterUndo)).toBe(0);
  });
});
