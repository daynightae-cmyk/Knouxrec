import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactCompareSlider } from "react-compare-slider";
import {
  TransformComponent,
  TransformWrapper,
  type ReactZoomPanPinchContentRef,
} from "react-zoom-pan-pinch";
import { AdultGateAdvanced } from "../../elysian-canvas/core/AdultGateAdvanced";
import { CAPABILITIES } from "../app/capabilities";
import { Icon } from "../app/icons";
import { useLibrary } from "../state/LibraryContext";
import { useSettings } from "../state/SettingsContext";
import { useToast } from "../state/ToastContext";
import { translate } from "../i18n/translate";
import { downloadBlob, formatBytes } from "../lib/format";
import {
  applyOps,
  cropPixels,
  meanDifference,
  resizePixels,
  type Op,
  type Pixels,
  type Rasterizer,
} from "../services/imageOps";
import {
  BLOCKED_SERVICES,
  CATEGORY_KEYS,
  CATEGORY_ORDER,
  EFFECTS,
  PRESETS,
  type EffectCategory,
  type EffectDefinition,
} from "../services/elysianPresets";
import { EmptyState, SectionHeader, StateBadge } from "./ui";
import { useHandoffReceiver, useProvenanceLine } from "../ui/handoff";
import type { ProvenanceRecord } from "../state/types";

const MAX_EDGE = 1400;
const THUMB_EDGE = 132;
const MIMES: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** Scale pixel-valued fields so a preview renders the same intent at any size. */
function scaleOp(op: Op, factor: number): Op {
  if (factor === 1) return op;
  const round = (value: number) => Math.max(1, Math.round(value * factor));
  switch (op.kind) {
    case "crop":
      return {
        ...op,
        x: Math.round(op.x * factor),
        y: Math.round(op.y * factor),
        width: round(op.width),
        height: round(op.height),
      };
    case "resize":
      return { ...op, width: round(op.width), height: round(op.height) };
    case "border":
      return { ...op, width: round(op.width) };
    case "text":
      return { ...op, size: round(op.size) };
    case "watermark":
      return { ...op, size: round(op.size), step: round(op.step) };
    default:
      return op;
  }
}

/** Turn an effect template into a concrete op for the current image size. */
function instantiate(effect: EffectDefinition, width: number, height: number): Op {
  if (effect.id === "crop") {
    return {
      kind: "crop",
      x: Math.round(width * 0.1),
      y: Math.round(height * 0.1),
      width: Math.round(width * 0.8),
      height: Math.round(height * 0.8),
    };
  }
  if (effect.id === "resize") {
    return {
      kind: "resize",
      width: Math.max(8, Math.round(width * 0.75)),
      height: Math.max(8, Math.round(height * 0.75)),
    };
  }
  return effect.op;
}

function opLabel(op: Op): string {
  switch (op.kind) {
    case "flip":
      return op.axis === "h" ? "flipH" : "flipV";
    default:
      return op.kind;
  }
}

/**
 * Elysian Canvas — the full creative image studio.
 *
 * A non-destructive stack of real pixel operations, an effect browser whose
 * thumbnails are produced by running those same operations over the working
 * image, and an output dock that encodes, verifies and archives the result.
 * Services that need missing weights are listed as blocked and are never given
 * a simulated preview.
 */
export default function ElysianStudioView() {
  const capability = CAPABILITIES.elysian;
  const { settings } = useSettings();
  const { add } = useLibrary();
  const { push } = useToast();
  const t = useCallback(
    (key: string) => translate(settings.language, key),
    [settings.language],
  );

  const fileRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const zoomRef = useRef<ReactZoomPanPinchContentRef | null>(null);
  const resultRef = useRef<Pixels | null>(null);

  const [gatePassed, setGatePassed] = useState(false);
  const [base, setBase] = useState<Pixels | null>(null);
  const [fileName, setFileName] = useState("image");
  const [ops, setOps] = useState<Op[]>([]);
  const [past, setPast] = useState<Op[][]>([]);
  const [future, setFuture] = useState<Op[][]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<Pixels | null>(null);
  const [rendering, setRendering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<EffectCategory>("light");
  const [splitCompare, setSplitCompare] = useState(false);
  const [stageMode, setStageMode] = useState<"crop" | "pan">("crop");
  const [peekOriginal, setPeekOriginal] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null,
  );
  const [output, setOutput] = useState({ format: "png", quality: 92, scale: 100 });
  const [estimate, setEstimate] = useState<number | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [layerThumbs, setLayerThumbs] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [provenance, setProvenance] = useState<ProvenanceRecord[]>([]);

  const onVerified = useCallback(() => setGatePassed(true), []);

  /**
   * Text and watermark layers need real glyph rasterisation. The pipeline hands
   * us a transparent overlay to draw on; we composite it over the working
   * pixels and read the result back.
   */
  const rasterize = useCallback<Rasterizer>((target, draw) => {
    const overlay = overlayCanvasRef.current ?? document.createElement("canvas");
    overlayCanvasRef.current = overlay;
    overlay.width = target.width;
    overlay.height = target.height;
    const overlayContext = overlay.getContext("2d");
    if (!overlayContext) return;
    overlayContext.clearRect(0, 0, overlay.width, overlay.height);
    draw(overlayContext, target.width, target.height);

    const surface = baseCanvasRef.current ?? document.createElement("canvas");
    baseCanvasRef.current = surface;
    surface.width = target.width;
    surface.height = target.height;
    const context = surface.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    context.putImageData(new ImageData(target.data, target.width, target.height), 0, 0);
    context.drawImage(overlay, 0, 0);
    target.data.set(context.getImageData(0, 0, target.width, target.height).data);
  }, []);

  const toCanvas = useCallback((pixels: Pixels): HTMLCanvasElement => {
    const canvas = scratchRef.current ?? document.createElement("canvas");
    scratchRef.current = canvas;
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The 2D canvas context is unavailable.");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);
    return canvas;
  }, []);

  const toDataUrl = useCallback(
    (pixels: Pixels): string => toCanvas(pixels).toDataURL("image/png"),
    [toCanvas],
  );

  const paint = useCallback((canvas: HTMLCanvasElement, pixels: Pixels) => {
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);
  }, []);

  // The stage canvas is unmounted while split compare is on. Without this the
  // node that comes back would be a blank 300×150 surface, because the paint
  // effect only runs when the result itself changes.
  const attachCanvas = useCallback(
    (node: HTMLCanvasElement | null) => {
      canvasRef.current = node;
      if (node && resultRef.current) paint(node, resultRef.current);
    },
    [paint],
  );

  /* ------------------------------------------------------------- render */
  useEffect(() => {
    if (!base) {
      setResult(null);
      return;
    }
    let cancelled = false;
    setRendering(true);
    const handle = window.setTimeout(() => {
      try {
        const out = applyOps(base, ops, rasterize);
        if (!cancelled) setResult(out);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "The render failed.");
        }
      } finally {
        if (!cancelled) setRendering(false);
      }
    }, 24);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [base, ops, rasterize]);

  useEffect(() => {
    resultRef.current = result;
    if (canvasRef.current && result) paint(canvasRef.current, result);
  }, [result, paint]);

  /* ---------------------------------------------------------- thumbnails */
  useEffect(() => {
    if (!base) {
      setThumbs({});
      return;
    }
    const factor = Math.min(1, THUMB_EDGE / Math.max(base.width, base.height));
    const thumbBase = resizePixels(base, base.width * factor, base.height * factor);
    const next: Record<string, string> = {};
    try {
      for (const effect of EFFECTS) {
        const op = scaleOp(instantiate(effect, base.width, base.height), factor);
        next[effect.id] = toDataUrl(applyOps(thumbBase, [op], rasterize));
      }
      for (const preset of PRESETS) {
        next[`preset:${preset.id}`] = toDataUrl(
          applyOps(
            thumbBase,
            preset.ops.map((op) => scaleOp(op, factor)),
            rasterize,
          ),
        );
      }
    } catch {
      // A thumbnail is never worth breaking the studio over.
    }
    setThumbs(next);
  }, [base, rasterize, toDataUrl]);

  useEffect(() => {
    if (!base || ops.length === 0) {
      setLayerThumbs([]);
      return;
    }
    const factor = Math.min(1, THUMB_EDGE / Math.max(base.width, base.height));
    const thumbBase = resizePixels(base, base.width * factor, base.height * factor);
    const urls: string[] = [];
    try {
      for (let index = 0; index < ops.length; index += 1) {
        const chain = ops.slice(0, index + 1).map((op) => scaleOp(op, factor));
        urls.push(toDataUrl(applyOps(thumbBase, chain, rasterize)));
      }
    } catch {
      // leave whatever rendered
    }
    setLayerThumbs(urls);
  }, [base, ops, rasterize, toDataUrl]);

  /* ------------------------------------------------------------- encode */
  const encode = useCallback(
    async (pixels: Pixels): Promise<Blob> => {
      const scale = output.scale / 100;
      const target =
        scale >= 1 ? pixels : resizePixels(pixels, pixels.width * scale, pixels.height * scale);
      const canvas = toCanvas(target);
      const mime = MIMES[output.format] ?? "image/png";
      return new Promise((resolve, reject) => {
        canvas.toBlob(
          (blob) =>
            blob
              ? resolve(blob)
              : reject(new Error(`The ${output.format.toUpperCase()} encoder produced no bytes.`)),
          mime,
          output.format === "png" ? undefined : output.quality / 100,
        );
      });
    },
    [output, toCanvas],
  );

  useEffect(() => {
    if (!result) {
      setEstimate(null);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      void encode(result)
        .then((blob) => {
          if (!cancelled) setEstimate(blob.size);
        })
        .catch(() => {
          if (!cancelled) setEstimate(null);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [result, encode]);

  /* ---------------------------------------------------- compare sources */
  useEffect(() => {
    if (!base) {
      setOriginalUrl(null);
      return;
    }
    const url = `data:image/png;base64,${toCanvas(base)
      .toDataURL("image/png")
      .split(",")[1]}`;
    setOriginalUrl(url);
  }, [base, toCanvas]);

  useEffect(() => {
    if (!splitCompare || !result) {
      setResultUrl(null);
      return;
    }
    let revoked: string | null = null;
    const canvas = toCanvas(result);
    const dataUrl = canvas.toDataURL("image/png");
    const binary = atob(dataUrl.split(",")[1] ?? "");
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    revoked = url;
    setResultUrl(url);
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [splitCompare, result, toCanvas]);

  /* ------------------------------------------------------------ actions */
  const commit = useCallback(
    (next: Op[], select: number | null = next.length - 1) => {
      setPast((entries) => [...entries.slice(-24), ops]);
      setFuture([]);
      setOps(next);
      setSelected(select);
      setSaved(false);
      setError(null);
    },
    [ops],
  );

  const addEffect = useCallback(
    (effect: EffectDefinition) => {
      if (!base) return;
      const op = instantiate(effect, base.width, base.height);
      commit([...ops, op]);
    },
    [base, commit, ops],
  );

  const applyPreset = useCallback(
    (presetId: string) => {
      if (!base) return;
      const preset = PRESETS.find((entry) => entry.id === presetId);
      if (!preset) return;
      commit([...ops, ...preset.ops], ops.length + preset.ops.length - 1);
    },
    [base, commit, ops],
  );

  const updateSelected = useCallback(
    (patch: Record<string, number | string | boolean>) => {
      if (selected === null || !ops[selected]) return;
      const current = ops[selected] as unknown as Record<string, unknown>;
      const next = [...ops];
      next[selected] = { ...current, ...patch } as Op;
      setOps(next);
      setSaved(false);
    },
    [ops, selected],
  );

  const removeSelected = useCallback(() => {
    if (selected === null) return;
    commit(ops.filter((_, index) => index !== selected), null);
  }, [commit, ops, selected]);

  const moveSelected = useCallback(
    (direction: -1 | 1) => {
      if (selected === null) return;
      const target = selected + direction;
      if (target < 0 || target >= ops.length) return;
      const next = [...ops];
      [next[selected], next[target]] = [next[target], next[selected]];
      commit(next, target);
    },
    [commit, ops, selected],
  );

  const undo = useCallback(() => {
    if (!past.length) return;
    setFuture((entries) => [ops, ...entries]);
    setOps(past[past.length - 1]);
    setPast((entries) => entries.slice(0, -1));
    setSelected(null);
    setSaved(false);
  }, [ops, past]);

  const redo = useCallback(() => {
    if (!future.length) return;
    setPast((entries) => [...entries, ops]);
    setOps(future[0]);
    setFuture((entries) => entries.slice(1));
    setSelected(null);
    setSaved(false);
  }, [future, ops]);

  const resetStack = useCallback(() => {
    commit([], null);
  }, [commit]);

  const loadBlob = useCallback(
    (file: Blob, name: string, origin?: ProvenanceRecord[]) => {
      if (!file.type.startsWith("image/")) {
        setError(t("elysian.notImage"));
        return;
      }
      setBusy(true);
      setError(null);
      setProvenance(origin ?? []);
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        try {
          const factor = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
          const width = Math.max(2, Math.round(image.naturalWidth * factor));
          const height = Math.max(2, Math.round(image.naturalHeight * factor));
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) throw new Error("The 2D canvas context is unavailable.");
          context.drawImage(image, 0, 0, width, height);
          const data = context.getImageData(0, 0, width, height);
          setBase({ width, height, data: new Uint8ClampedArray(data.data) });
          setOps([]);
          setPast([]);
          setFuture([]);
          setSelected(null);
          setSaved(false);
          setFileName(name.replace(/\.[^.]+$/, "") || "image");
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "The image could not be opened.");
        } finally {
          URL.revokeObjectURL(url);
          setBusy(false);
        }
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        setBusy(false);
        setError(t("elysian.notImage"));
      };
      image.src = url;
    },
    [t],
  );

  const chooseFile = useCallback(
    (file: File | null) => {
      if (!file) return;
      loadBlob(file, file.name);
    },
    [loadBlob],
  );

  // Only consumed once the 18+ gate is open; taking a file the user cannot see
  // yet would discard it.
  useHandoffReceiver(
    "elysian",
    "image",
    (incoming) => {
      loadBlob(incoming.blob, incoming.name, incoming.provenance);
    },
    gatePassed,
  );
  const provenanceLine = useProvenanceLine(provenance, t);

  const saveToLibrary = useCallback(async () => {
    if (!result) return;
    setBusy(true);
    try {
      const blob = await encode(result);
      const url = URL.createObjectURL(blob);
      let decoded: { width: number; height: number };
      try {
        decoded = await new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () =>
            resolve({ width: image.naturalWidth, height: image.naturalHeight });
          image.onerror = () => reject(new Error("The encoded result cannot be decoded."));
          image.src = url;
        });
      } finally {
        URL.revokeObjectURL(url);
      }
      if (!decoded || !decoded.width || !decoded.height) {
        throw new Error("The encoded result reported no dimensions.");
      }
      const name = `${fileName}-elysian.${output.format === "jpeg" ? "jpg" : output.format}`;
      await add({
        name,
        kind: "image",
        mimeType: MIMES[output.format] ?? "image/png",
        blob,
        duration: 0,
        width: decoded.width,
        height: decoded.height,
        source: "toolbox",
        thumbnail: null,
        // The chain grows by this hub's own hop, so the stored record says
        // plainly that the file was produced here from the named source.
        provenance: [...provenance, { itemId: null, name, hub: "elysian", at: Date.now() }],
      });
      setSaved(true);
      push("success", t("elysian.savedTitle"), `${name} · ${decoded.width}×${decoded.height} · ${formatBytes(blob.size)}`);
    } catch (cause) {
      push("error", t("elysian.saveFailed"), cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [add, encode, fileName, output.format, provenance, push, result, t]);

  const exportFile = useCallback(async () => {
    if (!result) return;
    setBusy(true);
    try {
      const blob = await encode(result);
      const extension = output.format === "jpeg" ? "jpg" : output.format;
      downloadBlob(blob, `${fileName}-elysian.${extension}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The export failed.");
    } finally {
      setBusy(false);
    }
  }, [encode, fileName, output.format, result]);

  /* --------------------------------------------------------- crop drag */
  const imagePointFromEvent = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || !result) return null;
      const rect = canvas.getBoundingClientRect();
      const u = (event.clientX - rect.left) / Math.max(1, rect.width);
      const v = (event.clientY - rect.top) / Math.max(1, rect.height);
      return {
        x: Math.max(0, Math.min(result.width, Math.round(u * result.width))),
        y: Math.max(0, Math.min(result.height, Math.round(v * result.height))),
      };
    },
    [result],
  );

  const applyDragCrop = useCallback(() => {
    if (!drag || !result) return;
    const x = Math.min(drag.x0, drag.x1);
    const y = Math.min(drag.y0, drag.y1);
    const width = Math.abs(drag.x1 - drag.x0);
    const height = Math.abs(drag.y1 - drag.y0);
    setDrag(null);
    if (width < 8 || height < 8) return;
    const rect = cropPixels(result, x, y, width, height);
    commit([
      ...ops,
      { kind: "crop", x, y, width: rect.width, height: rect.height },
    ]);
  }, [commit, drag, ops, result]);

  /* ------------------------------------------------------------ derived */
  const selectedOp = selected !== null ? ops[selected] ?? null : null;
  const inspector = useMemo(() => {
    if (!selectedOp || !base) return null;
    switch (selectedOp.kind) {
      case "crop":
        return (
          <>
            {range("elysian.field.x", selectedOp.x, 0, base.width - 1, 1, (value) =>
              updateSelected({ x: value }),
            )}
            {range("elysian.field.y", selectedOp.y, 0, base.height - 1, 1, (value) =>
              updateSelected({ y: value }),
            )}
            {range("elysian.field.width", selectedOp.width, 8, base.width, 1, (value) =>
              updateSelected({ width: value }),
            )}
            {range("elysian.field.height", selectedOp.height, 8, base.height, 1, (value) =>
              updateSelected({ height: value }),
            )}
          </>
        );
      case "resize":
        return (
          <>
            {range("elysian.field.width", selectedOp.width, 8, 4096, 1, (value) =>
              updateSelected({ width: value }),
            )}
            {range("elysian.field.height", selectedOp.height, 8, 4096, 1, (value) =>
              updateSelected({ height: value }),
            )}
          </>
        );
      case "rotate":
        return range("elysian.field.angle", selectedOp.angle, -180, 180, 1, (value) =>
          updateSelected({ angle: value }),
        );
      case "flip":
        return (
          <div className="kx-row" style={{ gap: 8 }}>
            <button
              type="button"
              className="kx-btn kx-btn-sm"
              onClick={() => updateSelected({ axis: selectedOp.axis === "h" ? "v" : "h" })}
            >
              {t("elysian.swapAxis")}
            </button>
          </div>
        );
      case "exposure":
        return range("elysian.field.stops", selectedOp.stops, -3, 3, 0.05, (value) =>
          updateSelected({ stops: value }),
        );
      case "gamma":
        return range("elysian.field.gamma", selectedOp.amount, 0.2, 3, 0.01, (value) =>
          updateSelected({ amount: value }),
        );
      case "blur":
        return range("elysian.field.radius", selectedOp.radius, 1, 40, 1, (value) =>
          updateSelected({ radius: value }),
        );
      case "pixelate":
        return range("elysian.field.blocks", selectedOp.blocks, 2, 200, 1, (value) =>
          updateSelected({ blocks: value }),
        );
      case "border":
        return (
          <>
            {range("elysian.field.width", selectedOp.width, 1, 200, 1, (value) =>
              updateSelected({ width: value }),
            )}
            {range("elysian.field.opacity", selectedOp.opacity, 0, 100, 1, (value) =>
              updateSelected({ opacity: value }),
            )}
            {colorField("elysian.field.color", selectedOp.color, (value) =>
              updateSelected({ color: value }),
            )}
          </>
        );
      case "text":
        return (
          <>
            <label className="kx-field">
              <span className="kx-label">{t("elysian.field.text")}</span>
              <input
                className="kx-input"
                value={selectedOp.text}
                onChange={(event) => updateSelected({ text: event.target.value })}
              />
            </label>
            {range("elysian.field.x", selectedOp.x, 0, 100, 1, (value) =>
              updateSelected({ x: value }),
            )}
            {range("elysian.field.y", selectedOp.y, 0, 100, 1, (value) =>
              updateSelected({ y: value }),
            )}
            {range("elysian.field.size", selectedOp.size, 8, 400, 1, (value) =>
              updateSelected({ size: value }),
            )}
            {range("elysian.field.opacity", selectedOp.opacity, 0, 100, 1, (value) =>
              updateSelected({ opacity: value }),
            )}
            {colorField("elysian.field.color", selectedOp.color, (value) =>
              updateSelected({ color: value }),
            )}
            <label className="kx-switch">
              <input
                type="checkbox"
                checked={selectedOp.shadow}
                onChange={(event) => updateSelected({ shadow: event.target.checked })}
              />
              <span className="kx-switch-track" />
              <span className="kx-switch-label">{t("elysian.field.shadow")}</span>
            </label>
          </>
        );
      case "watermark":
        return (
          <>
            <label className="kx-field">
              <span className="kx-label">{t("elysian.field.text")}</span>
              <input
                className="kx-input"
                value={selectedOp.text}
                onChange={(event) => updateSelected({ text: event.target.value })}
              />
            </label>
            {range("elysian.field.size", selectedOp.size, 8, 160, 1, (value) =>
              updateSelected({ size: value }),
            )}
            {range("elysian.field.opacity", selectedOp.opacity, 1, 100, 1, (value) =>
              updateSelected({ opacity: value }),
            )}
            {range("elysian.field.angle", selectedOp.angle, -90, 90, 1, (value) =>
              updateSelected({ angle: value }),
            )}
            {range("elysian.field.step", selectedOp.step, 5, 100, 1, (value) =>
              updateSelected({ step: value }),
            )}
            {colorField("elysian.field.color", selectedOp.color, (value) =>
              updateSelected({ color: value }),
            )}
          </>
        );
      case "brightness":
      case "contrast":
      case "saturation":
      case "temperature":
      case "vignette":
        return range("elysian.field.amount", selectedOp.amount, -100, 100, 1, (value) =>
          updateSelected({ amount: value }),
        );
      case "sharpen":
        return range("elysian.field.amount", selectedOp.amount, 0, 200, 1, (value) =>
          updateSelected({ amount: value }),
        );
      default:
        return null;
    }

    function range(
      labelKey: string,
      value: number,
      min: number,
      max: number,
      step: number,
      onChange: (value: number) => void,
    ) {
      return (
        <label className="kx-field" key={labelKey}>
          <span className="kx-label">
            {t(labelKey)} <output className="kx-mono">{value}</output>
          </span>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            data-slider={labelKey}
            onChange={(event) => onChange(Number(event.target.value))}
          />
        </label>
      );
    }

    function colorField(
      labelKey: string,
      value: string,
      onChange: (value: string) => void,
    ) {
      return (
        <label className="kx-field" key={labelKey}>
          <span className="kx-label">{t(labelKey)}</span>
          <span className="kx-color-field">
            <input
              type="color"
              value={value}
              onChange={(event) => onChange(event.target.value)}
            />
            <input
              className="kx-input kx-mono"
              value={value}
              onChange={(event) => onChange(event.target.value)}
            />
          </span>
        </label>
      );
    }
  }, [base, selectedOp, t, updateSelected]);

  const effectCards = EFFECTS.filter((effect) => effect.category === category);
  const pixelDelta = result && base ? meanDifference(base, result) : 0;

  /* -------------------------------------------------------------- gate */
  if (!gatePassed) {
    return (
      <div className="kx-content">
        <SectionHeader
          eyebrow={t("groupCreate")}
          title={t("elysian.title")}
          description={t("elysian.gateDescription")}
          actions={<StateBadge state={capability.state} />}
        />
        <AdultGateAdvanced onVerified={onVerified} />
      </div>
    );
  }

  return (
    <div className="kx-content elys-studio">
      <SectionHeader
        eyebrow={t("groupCreate")}
        title={t("elysian.title")}
        description={t("elysian.description")}
        actions={
          <div className="kx-row" style={{ gap: 8 }}>
            <StateBadge state={capability.state} />
            <button
              type="button"
              className="kx-btn kx-btn-primary kx-btn-sm"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              <Icon name="upload" size={14} />
              {base ? t("elysian.replace") : t("elysian.open")}
            </button>
          </div>
        }
      />

      <div className="kx-notice" data-tone="info">
        <Icon name="shield" size={18} />
        <div>
          <strong>{t("elysian.honestTitle")}</strong> {t("elysian.honestBody")}
        </div>
      </div>

      {!base ? (
        <div className="kx-card elys-hero">
          <EmptyState
            icon="sparkles"
            title={t("elysian.emptyTitle")}
            hint={t("elysian.emptyHint")}
            action={
              <button
                type="button"
                className="kx-btn kx-btn-primary"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                <Icon name="image" size={16} />
                {t("elysian.open")}
              </button>
            }
          />
          {error && (
            <div className="kx-notice" data-tone="danger">
              <Icon name="alert" size={16} />
              <div>{error}</div>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="elys-layout">
            {/* ------------------------------------------------ browser */}
            <aside className="kx-card elys-browser" aria-label={t("elysian.browser")}>
              <div className="kx-segmented elys-categories" role="group" aria-label={t("elysian.categories")}>
                {CATEGORY_ORDER.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    aria-pressed={category === entry}
                    onClick={() => setCategory(entry)}
                  >
                    {t(CATEGORY_KEYS[entry])}
                  </button>
                ))}
              </div>

              <div className="elys-cards">
                {effectCards.map((effect) => (
                  <button
                    key={effect.id}
                    type="button"
                    className="elys-card"
                    data-effect-id={effect.id}
                    onClick={() => addEffect(effect)}
                    title={t(effect.labelKey)}
                  >
                    <span className="elys-card-thumb">
                      {thumbs[effect.id] ? (
                        <img src={thumbs[effect.id]} alt="" />
                      ) : (
                        <span className="elys-card-skeleton" />
                      )}
                    </span>
                    <span className="elys-card-label">{t(effect.labelKey)}</span>
                  </button>
                ))}
              </div>

              <div className="kx-divider" />
              <h3 className="elys-subtitle">{t("elysian.presets")}</h3>
              <div className="elys-cards elys-presets">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="elys-card"
                    data-preset-id={preset.id}
                    onClick={() => applyPreset(preset.id)}
                    title={t(preset.labelKey)}
                  >
                    <span className="elys-card-thumb">
                      {thumbs[`preset:${preset.id}`] ? (
                        <img src={thumbs[`preset:${preset.id}`]} alt="" />
                      ) : (
                        <span className="elys-card-skeleton" />
                      )}
                    </span>
                    <span className="elys-card-label">{t(preset.labelKey)}</span>
                  </button>
                ))}
              </div>

              <div className="kx-divider" />
              <h3 className="elys-subtitle">{t("elysian.blockedTitle")}</h3>
              <p className="kx-card-sub">{t("elysian.blockedHint")}</p>
              <ul className="elys-blocked">
                {BLOCKED_SERVICES.map((service) => (
                  <li key={service.id} data-blocked-id={service.id}>
                    <span>
                      <strong>{t(service.labelKey)}</strong>
                      <em>{t(service.reasonKey)}</em>
                    </span>
                    <span className="kx-badge" data-state="BLOCKED">
                      {service.needs}
                    </span>
                  </li>
                ))}
              </ul>
            </aside>

            {/* -------------------------------------------------- stage */}
            <section className="kx-card elys-stage-card">
              <div className="kx-row-between elys-stage-bar">
                <span className="kx-mono kx-muted" dir="ltr">
                  {result ? `${result.width}×${result.height}` : `${base.width}×${base.height}`}
                  {" · "}
                  {fileName}
                  {" · "}
                  {ops.length} {t("elysian.layers")}
                </span>
                {provenanceLine && (
                  <span className="kx-muted kx-provenance" data-provenance title={provenanceLine}>
                    <Icon name="external" size={13} />
                    {provenanceLine}
                  </span>
                )}
                <div className="kx-row" style={{ gap: 6, flexWrap: "wrap" }}>
                  <div className="kx-segmented" role="group" aria-label={t("elysian.stageMode")}>
                    <button
                      type="button"
                      aria-pressed={stageMode === "crop"}
                      onClick={() => setStageMode("crop")}
                    >
                      {t("elysian.cropMode")}
                    </button>
                    <button
                      type="button"
                      aria-pressed={stageMode === "pan"}
                      onClick={() => setStageMode("pan")}
                    >
                      {t("elysian.panMode")}
                    </button>
                  </div>
                  <button
                    type="button"
                    className="kx-btn kx-btn-sm"
                    aria-pressed={splitCompare}
                    onClick={() => setSplitCompare((value) => !value)}
                  >
                    {t("elysian.splitCompare")}
                  </button>
                  <button
                    type="button"
                    className="kx-btn kx-btn-sm"
                    onPointerDown={() => setPeekOriginal(true)}
                    onPointerUp={() => setPeekOriginal(false)}
                    onPointerLeave={() => setPeekOriginal(false)}
                  >
                    {t("elysian.peek")}
                  </button>
                  <button
                    type="button"
                    className="kx-btn kx-btn-sm"
                    onClick={() => zoomRef.current?.zoomOut()}
                    aria-label={t("elysian.zoomOut")}
                  >
                    <Icon name="minus" size={14} />
                  </button>
                  <button
                    type="button"
                    className="kx-btn kx-btn-sm"
                    onClick={() => zoomRef.current?.zoomIn()}
                    aria-label={t("elysian.zoomIn")}
                  >
                    <Icon name="plus" size={14} />
                  </button>
                  <button
                    type="button"
                    className="kx-btn kx-btn-sm"
                    onClick={() => zoomRef.current?.resetTransform()}
                  >
                    {t("elysian.fit")}
                  </button>
                </div>
              </div>

              <div className="elys-stage">
                {splitCompare && originalUrl && resultUrl ? (
                  <ReactCompareSlider
                    className="elys-compare"
                    itemOne={<img src={originalUrl} alt={t("elysian.compareOriginal")} />}
                    itemTwo={<img src={resultUrl} alt={t("elysian.compareResult")} />}
                  />
                ) : (
                  <TransformWrapper
                    key={stageMode}
                    ref={zoomRef}
                    limitToBounds
                    centerOnInit
                    panning={{ disabled: stageMode === "crop" }}
                    onTransform={(_services, state) => setZoom(state.scale)}
                    wheel={{ disabled: true }}
                  >
                    <TransformComponent
                      wrapperClass="elys-transform-wrapper"
                      contentClass="elys-transform-content"
                    >
                      <div className="elys-canvas-frame">
                        <canvas
                          ref={attachCanvas}
                          className="elys-canvas"
                          data-stage-mode={stageMode}
                          data-zoom={zoom.toFixed(2)}
                          onPointerDown={(event) => {
                            if (stageMode !== "crop") return;
                            const point = imagePointFromEvent(event);
                            if (!point) return;
                            setDrag({ x0: point.x, y0: point.y, x1: point.x, y1: point.y });
                          }}
                          onPointerMove={(event) => {
                            if (!drag || stageMode !== "crop") return;
                            const point = imagePointFromEvent(event);
                            if (!point) return;
                            setDrag((current) =>
                              current ? { ...current, x1: point.x, y1: point.y } : current,
                            );
                          }}
                          onPointerUp={() => {
                            if (stageMode !== "crop") setDrag(null);
                          }}
                          onPointerLeave={() => setDrag(null)}
                        />
                        {drag && result && (
                          <div
                            className="elys-crop-rect"
                            style={{
                              left: `${(Math.min(drag.x0, drag.x1) / result.width) * 100}%`,
                              top: `${(Math.min(drag.y0, drag.y1) / result.height) * 100}%`,
                              width: `${(Math.abs(drag.x1 - drag.x0) / result.width) * 100}%`,
                              height: `${(Math.abs(drag.y1 - drag.y0) / result.height) * 100}%`,
                            }}
                          />
                        )}
                        {peekOriginal && originalUrl && (
                          <img className="elys-peek" src={originalUrl} alt={t("elysian.peek")} />
                        )}
                      </div>
                    </TransformComponent>
                  </TransformWrapper>
                )}

                {rendering && (
                  <span className="elys-rendering" role="status">
                    <Icon name="refresh" size={14} />
                    {t("elysian.rendering")}
                  </span>
                )}
              </div>

              <div className="elys-actions">
                <button type="button" className="kx-btn kx-btn-primary" onClick={undo} disabled={!past.length || busy}>
                  <Icon name="undo" size={15} />
                  {t("elysian.undo")}
                </button>
                <button type="button" className="kx-btn" onClick={redo} disabled={!future.length || busy}>
                  <Icon name="redo" size={15} />
                  {t("elysian.redo")}
                </button>
                <button type="button" className="kx-btn" onClick={resetStack} disabled={!ops.length || busy}>
                  {t("elysian.reset")}
                </button>
                {drag && (
                  <button type="button" className="kx-btn" onClick={applyDragCrop}>
                    {t("elysian.applyCrop")}
                  </button>
                )}
              </div>

              {error && (
                <div className="kx-notice" data-tone="danger" style={{ marginTop: 10 }}>
                  <Icon name="alert" size={16} />
                  <div>{error}</div>
                </div>
              )}
            </section>

            {/* ----------------------------------------------- inspector */}
            <aside className="kx-card elys-inspector" aria-label={t("elysian.inspector")}>
              <h3 className="elys-subtitle">{t("elysian.layers")}</h3>
              {ops.length === 0 ? (
                <p className="kx-card-sub">{t("elysian.noLayers")}</p>
              ) : (
                <ul className="elys-layers">
                  {ops.map((op, index) => (
                    <li key={`${op.kind}-${index}`}>
                      <button
                        type="button"
                        className="elys-layer"
                        data-layer-index={index}
                        aria-pressed={selected === index}
                        onClick={() => setSelected(index)}
                      >
                        <span className="elys-layer-no">{index + 1}</span>
                        <span className="elys-layer-name">{t(`elysian.effect.${opLabel(op)}`)}</span>
                      </button>
                      <button
                        type="button"
                        className="kx-btn kx-btn-sm elys-layer-remove"
                        onClick={() => commit(ops.filter((_, i) => i !== index), null)}
                        aria-label={t("elysian.removeLayer")}
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="kx-divider" />
              <h3 className="elys-subtitle">{t("elysian.parameters")}</h3>
              {inspector ? (
                <div className="kx-col" style={{ gap: 12 }}>
                  <div className="kx-row" style={{ gap: 6 }}>
                    <button
                      type="button"
                      className="kx-btn kx-btn-sm"
                      onClick={() => moveSelected(-1)}
                      disabled={selected === null || selected === 0}
                    >
                      {t("elysian.moveUp")}
                    </button>
                    <button
                      type="button"
                      className="kx-btn kx-btn-sm"
                      onClick={() => moveSelected(1)}
                      disabled={selected === null || selected === ops.length - 1}
                    >
                      {t("elysian.moveDown")}
                    </button>
                    <button type="button" className="kx-btn kx-btn-sm" onClick={removeSelected}>
                      {t("elysian.removeLayer")}
                    </button>
                  </div>
                  {inspector}
                </div>
              ) : (
                <p className="kx-card-sub">{t("elysian.selectLayer")}</p>
              )}

              <div className="kx-divider" />
              <h3 className="elys-subtitle">{t("elysian.output")}</h3>
              <div className="kx-row" style={{ gap: 8, flexWrap: "wrap" }}>
                <div
                  className="kx-segmented"
                  dir="ltr"
                  role="group"
                  aria-label={t("elysian.format")}
                >
                  {["png", "jpeg", "webp"].map((format) => (
                    <button
                      key={format}
                      type="button"
                      aria-pressed={output.format === format}
                      onClick={() => setOutput((current) => ({ ...current, format }))}
                    >
                      {format.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              {output.format !== "png" && (
                <label className="kx-field" style={{ marginTop: 10 }}>
                  <span className="kx-label">
                    {t("elysian.quality")} <output className="kx-mono">{output.quality}</output>
                  </span>
                  <input
                    type="range"
                    min={20}
                    max={100}
                    value={output.quality}
                    data-slider="elysian.quality"
                    onChange={(event) =>
                      setOutput((current) => ({ ...current, quality: Number(event.target.value) }))
                    }
                  />
                </label>
              )}
              <label className="kx-field" style={{ marginTop: 10 }}>
                <span className="kx-label">
                  {t("elysian.scale")} <output className="kx-mono">{output.scale}%</output>
                </span>
                <input
                  type="range"
                  min={10}
                  max={100}
                  step={5}
                  value={output.scale}
                  data-slider="elysian.scale"
                  onChange={(event) =>
                    setOutput((current) => ({ ...current, scale: Number(event.target.value) }))
                  }
                />
              </label>
              <p className="kx-card-sub" dir="ltr">
                {estimate !== null ? formatBytes(estimate) : t("elysian.measuring")}
                {" · "}
                {pixelDelta > 0.5 ? `${pixelDelta.toFixed(1)} ${t("elysian.pixelDelta")}` : t("elysian.unchanged")}
              </p>
            </aside>
          </div>

          {/* ------------------------------------------------------ dock */}
          <footer className="kx-card elys-dock">
            <div className="elys-history" aria-label={t("elysian.history")}>
              {layerThumbs.length === 0 ? (
                <span className="kx-card-sub">{t("elysian.historyEmpty")}</span>
              ) : (
                layerThumbs.map((url, index) => (
                  <button
                    key={`${url}-${index}`}
                    type="button"
                    className={`elys-history-step${index === ops.length - 1 ? " is-current" : ""}`}
                    data-history-step={index}
                    onClick={() => commit(ops.slice(0, index + 1), index)}
                    title={`${index + 1}`}
                  >
                    <img src={url} alt="" />
                    <span>{index + 1}</span>
                  </button>
                ))
              )}
            </div>
            <div className="kx-row" style={{ gap: 8 }}>
              <button
                type="button"
                className="kx-btn"
                onClick={() => void saveToLibrary()}
                disabled={busy || !result}
              >
                <Icon name="download" size={15} />
                {saved ? t("elysian.saved") : t("elysian.save")}
              </button>
              <button
                type="button"
                className="kx-btn kx-btn-primary"
                onClick={() => void exportFile()}
                disabled={busy || !result}
              >
                <Icon name="export" size={15} />
                {t("elysian.export")}
              </button>
            </div>
          </footer>
        </>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        aria-label={t("elysian.open")}
        onChange={(event) => {
          chooseFile(event.target.files?.[0] ?? null);
          event.target.value = "";
        }}
      />
    </div>
  );
}
