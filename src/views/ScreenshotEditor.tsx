import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Modal from "../../components/Modal";
import { Icon } from "../app/icons";
import { useLibrary } from "../state/LibraryContext";
import { useSettings } from "../state/SettingsContext";
import { useToast } from "../state/ToastContext";
import { translate } from "../i18n/translate";
import { downloadBlob, formatBytes } from "../lib/format";

type EditorTool =
  | "crop"
  | "arrow"
  | "rectangle"
  | "ellipse"
  | "highlight"
  | "text"
  | "pixelate"
  | "blur";

interface Point {
  x: number;
  y: number;
}

interface ScreenshotEditorProps {
  open: boolean;
  blob: Blob | null;
  name: string;
  onClose: () => void;
}

const COLORS = ["#ffde00", "#ffffff", "#ff4d5e", "#22d3ee"] as const;
const MAX_HISTORY = 6;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("The PNG encoder produced no bytes.")),
      "image/png",
    );
  });
}

async function decodePng(
  blob: Blob,
): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("The edited PNG cannot be decoded."));
      element.src = url;
    });
    return {
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Real screenshot editor: crop and annotate the captured pixels, pixelate or
 * blur sensitive regions, undo/redo with compressed snapshots, compare against
 * the original, then save a new library item and/or export the PNG.
 */
export default function ScreenshotEditor({
  open,
  blob,
  name,
  onClose,
}: ScreenshotEditorProps) {
  const { settings } = useSettings();
  const { add } = useLibrary();
  const { push } = useToast();
  const t = useCallback(
    (key: string) => translate(settings.language, key),
    [settings.language],
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const historyRef = useRef<{ entries: Blob[]; index: number }>({ entries: [], index: -1 });
  const dragRef = useRef<{ start: Point; current: Point } | null>(null);

  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<EditorTool>("crop");
  const [color, setColor] = useState<string>(COLORS[0]);
  const [stroke, setStroke] = useState(4);
  const [text, setText] = useState("KNOUX REC");
  const [showOriginal, setShowOriginal] = useState(false);
  const [historyTick, setHistoryTick] = useState(0);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const canUndo = historyRef.current.index > 0;
  const canRedo =
    historyRef.current.index >= 0 &&
    historyRef.current.index < historyRef.current.entries.length - 1;

  // Load the source pixels into the working canvas when a new capture arrives.
  useEffect(() => {
    if (!open || !blob) return;
    let cancelled = false;
    setReady(false);
    setError(null);
    setSaved(false);
    setShowOriginal(false);
    historyRef.current = { entries: [], index: -1 };
    setHistoryTick((value) => value + 1);

    const url = URL.createObjectURL(blob);
    setOriginalUrl(url);

    const load = async () => {
      try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const element = new Image();
          element.onload = () => resolve(element);
          element.onerror = () => reject(new Error("The capture cannot be decoded."));
          element.src = url;
        });
        if (cancelled) return;
        const canvas = canvasRef.current;
        const overlay = overlayRef.current;
        if (!canvas || !overlay) return;
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;
        overlay.width = canvas.width;
        overlay.height = canvas.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("The 2D canvas context is unavailable.");
        context.drawImage(image, 0, 0);
        setDimensions({ width: canvas.width, height: canvas.height });
        const snapshot = await canvasToPng(canvas);
        historyRef.current = { entries: [snapshot], index: 0 };
        if (!cancelled) {
          setReady(true);
          setHistoryTick((value) => value + 1);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : "The editor could not open the image.",
          );
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [open, blob]);

  const pushHistory = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const snapshot = await canvasToPng(canvas);
    const history = historyRef.current;
    const entries = history.entries.slice(0, history.index + 1);
    entries.push(snapshot);
    while (entries.length > MAX_HISTORY) entries.shift();
    historyRef.current = { entries, index: entries.length - 1 };
    setHistoryTick((value) => value + 1);
  }, []);

  const restore = useCallback(
    async (index: number) => {
      const entry = historyRef.current.entries[index];
      const canvas = canvasRef.current;
      const overlay = overlayRef.current;
      if (!entry || !canvas || !overlay) return;
      setBusy(true);
      try {
        const url = URL.createObjectURL(entry);
        try {
          const image = await new Promise<HTMLImageElement>((resolve, reject) => {
            const element = new Image();
            element.onload = () => resolve(element);
            element.onerror = () => reject(new Error("The snapshot cannot be decoded."));
            element.src = url;
          });
          canvas.width = image.naturalWidth || image.width;
          canvas.height = image.naturalHeight || image.height;
          overlay.width = canvas.width;
          overlay.height = canvas.height;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("The 2D canvas context is unavailable.");
          context.clearRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0);
          setDimensions({ width: canvas.width, height: canvas.height });
        } finally {
          URL.revokeObjectURL(url);
        }
        historyRef.current = { ...historyRef.current, index };
        setHistoryTick((value) => value + 1);
        setSaved(false);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The snapshot could not be restored.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const undo = useCallback(() => {
    if (historyRef.current.index > 0) void restore(historyRef.current.index - 1);
  }, [restore]);

  const redo = useCallback(() => {
    const history = historyRef.current;
    if (history.index < history.entries.length - 1) void restore(history.index + 1);
  }, [restore]);

  const pointerPosition = (event: ReactPointerEvent<HTMLCanvasElement>): Point | null => {
    const overlay = overlayRef.current;
    if (!overlay) return null;
    const rect = overlay.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * overlay.width, 0, overlay.width),
      y: clamp(((event.clientY - rect.top) / rect.height) * overlay.height, 0, overlay.height),
    };
  };

  const paintOverlay = useCallback((start: Point | null) => {
    const overlay = overlayRef.current;
    const drag = dragRef.current;
    if (!overlay) return;
    const context = overlay.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, overlay.width, overlay.height);
    if (!start || !drag) return;
    const x = Math.min(drag.start.x, drag.current.x);
    const y = Math.min(drag.start.y, drag.current.y);
    const width = Math.abs(drag.current.x - drag.start.x);
    const height = Math.abs(drag.current.y - drag.start.y);
    context.save();
    context.fillStyle = "rgba(255, 222, 0, 0.12)";
    context.strokeStyle = "#ffde00";
    context.lineWidth = Math.max(1, overlay.width / 800);
    context.setLineDash([8, 6]);
    context.fillRect(x, y, width, height);
    context.strokeRect(x, y, width, height);
    context.restore();
  }, []);

  const applyBlurRegion = (
    canvas: HTMLCanvasElement,
    rect: { x: number; y: number; width: number; height: number },
    mode: "blur" | "pixelate",
  ) => {
    const context = canvas.getContext("2d");
    if (!context) return;
    const { x, y, width, height } = rect;
    const temp = document.createElement("canvas");
    temp.width = Math.max(1, Math.round(width));
    temp.height = Math.max(1, Math.round(height));
    const tempContext = temp.getContext("2d");
    if (!tempContext) return;
    tempContext.drawImage(canvas, x, y, width, height, 0, 0, temp.width, temp.height);
    context.save();
    context.beginPath();
    context.rect(x, y, width, height);
    context.clip();
    if (mode === "pixelate") {
      const scale = Math.max(8, Math.round(Math.max(width, height) / 16));
      const small = document.createElement("canvas");
      small.width = Math.max(1, Math.ceil(width / scale));
      small.height = Math.max(1, Math.ceil(height / scale));
      const smallContext = small.getContext("2d");
      if (smallContext) {
        smallContext.imageSmoothingEnabled = false;
        smallContext.drawImage(temp, 0, 0, small.width, small.height);
        context.imageSmoothingEnabled = false;
        context.drawImage(small, x, y, width, height);
      }
    } else {
      const radius = Math.max(3, Math.round(Math.min(width, height) * 0.05));
      context.filter = `blur(${radius}px)`;
      context.drawImage(temp, x - radius, y - radius, width + radius * 2, height + radius * 2);
      context.filter = "none";
    }
    context.restore();
  };

  const drawArrow = (
    context: CanvasRenderingContext2D,
    start: Point,
    end: Point,
    lineWidth: number,
  ) => {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const head = Math.max(10, lineWidth * 4);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    context.beginPath();
    context.moveTo(end.x, end.y);
    context.lineTo(
      end.x - head * Math.cos(angle - Math.PI / 6),
      end.y - head * Math.sin(angle - Math.PI / 6),
    );
    context.lineTo(
      end.x - head * Math.cos(angle + Math.PI / 6),
      end.y - head * Math.sin(angle + Math.PI / 6),
    );
    context.closePath();
    context.fill();
  };

  const commitDrag = useCallback(
    async (start: Point, end: Point) => {
      const canvas = canvasRef.current;
      const overlay = overlayRef.current;
      if (!canvas || !overlay) return;
      const context = canvas.getContext("2d");
      if (!context) return;
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      const width = Math.abs(end.x - start.x);
      const height = Math.abs(end.y - start.y);
      const scale = canvas.width / Math.max(1, overlay.clientWidth);
      const lineWidth = Math.max(1, stroke * scale * 0.7);

      if (width < 4 || height < 4) {
        paintOverlay(null);
        return;
      }

      setBusy(true);
      try {
        if (tool === "crop") {
          const cropWidth = Math.max(8, Math.round(width));
          const cropHeight = Math.max(8, Math.round(height));
          const cropped = document.createElement("canvas");
          cropped.width = cropWidth;
          cropped.height = cropHeight;
          const croppedContext = cropped.getContext("2d");
          if (!croppedContext) throw new Error("The crop canvas is unavailable.");
          croppedContext.drawImage(
            canvas,
            Math.round(x),
            Math.round(y),
            cropWidth,
            cropHeight,
            0,
            0,
            cropWidth,
            cropHeight,
          );
          canvas.width = cropWidth;
          canvas.height = cropHeight;
          overlay.width = cropWidth;
          overlay.height = cropHeight;
          context.clearRect(0, 0, cropWidth, cropHeight);
          context.drawImage(cropped, 0, 0);
          setDimensions({ width: cropWidth, height: cropHeight });
        } else if (tool === "blur" || tool === "pixelate") {
          applyBlurRegion(canvas, { x, y, width, height }, tool);
        } else {
          context.save();
          context.strokeStyle = color;
          context.fillStyle = color;
          context.lineWidth = lineWidth;
          context.lineJoin = "round";
          context.lineCap = "round";
          if (tool === "arrow") {
            drawArrow(context, start, end, lineWidth);
          } else if (tool === "rectangle") {
            context.strokeRect(x, y, width, height);
          } else if (tool === "ellipse") {
            context.beginPath();
            context.ellipse(
              x + width / 2,
              y + height / 2,
              width / 2,
              height / 2,
              0,
              0,
              Math.PI * 2,
            );
            context.stroke();
          } else if (tool === "highlight") {
            context.globalAlpha = 0.32;
            context.fillRect(x, y, width, height);
            context.globalAlpha = 1;
          } else if (tool === "text") {
            const fontSize = Math.max(14, lineWidth * 5);
            context.font = `600 ${fontSize}px "Inter", "Rajdhani", sans-serif`;
            context.textBaseline = "top";
            context.fillText(text || "KNOUX", start.x, start.y);
          }
          context.restore();
        }
        setSaved(false);
        setError(null);
        await pushHistory();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The edit could not be applied.");
      } finally {
        paintOverlay(null);
        setBusy(false);
      }
    },
    [color, paintOverlay, pushHistory, stroke, text, tool],
  );

  const saveToLibrary = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setBusy(true);
    try {
      const edited = await canvasToPng(canvas);
      const size = await decodePng(edited);
      const base = name.replace(/\.[^.]+$/, "") || "screenshot";
      const fileName = `${base}-edited.png`;
      await add({
        name: fileName,
        kind: "image",
        mimeType: "image/png",
        blob: edited,
        duration: 0,
        width: size.width,
        height: size.height,
        source: "toolbox",
        thumbnail: null,
      });
      setSaved(true);
      push(
        "success",
        t("screenshots.savedTitle"),
        `${fileName} · ${size.width}×${size.height} · ${formatBytes(edited.size)}`,
      );
    } catch (cause) {
      push(
        "error",
        t("screenshots.saveFailed"),
        cause instanceof Error ? cause.message : String(cause),
      );
    } finally {
      setBusy(false);
    }
  }, [add, name, push, t]);

  const exportPng = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setBusy(true);
    try {
      const edited = await canvasToPng(canvas);
      await decodePng(edited);
      downloadBlob(edited, `${name.replace(/\.[^.]+$/, "") || "screenshot"}-edited.png`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The export failed.");
    } finally {
      setBusy(false);
    }
  }, [name]);

  const tools = useMemo(
    () =>
      [
        { id: "crop" as const, icon: "cut" as const, label: t("screenshots.toolCrop") },
        { id: "arrow" as const, icon: "arrowLeft" as const, label: t("screenshots.toolArrow") },
        { id: "rectangle" as const, icon: "dashboard" as const, label: t("screenshots.toolRect") },
        { id: "ellipse" as const, icon: "activity" as const, label: t("screenshots.toolEllipse") },
        { id: "highlight" as const, icon: "star" as const, label: t("screenshots.toolHighlight") },
        { id: "text" as const, icon: "pencil" as const, label: t("screenshots.toolText") },
        { id: "pixelate" as const, icon: "layers" as const, label: t("screenshots.toolPixelate") },
        { id: "blur" as const, icon: "eye" as const, label: t("screenshots.toolBlur") },
      ],
    [t],
  );

  return (
    <Modal
      isOpen={open}
      onClose={busy ? () => undefined : onClose}
      title={`${t("screenshots.editorTitle")} · ${name}`}
      size="xl"
      closeOnBackdrop={!busy}
      footer={
        <>
          <span className="kx-mono kx-muted" style={{ marginInlineEnd: "auto" }}>
            {dimensions.width}×{dimensions.height}
          </span>
          <button type="button" className="kx-btn" onClick={onClose} disabled={busy}>
            {t("screenshots.close")}
          </button>
          <button
            type="button"
            className="kx-btn"
            onClick={() => void saveToLibrary()}
            disabled={!ready || busy}
          >
            <Icon name="download" size={15} />
            {saved ? t("screenshots.saved") : t("screenshots.saveAs")}
          </button>
          <button
            type="button"
            className="kx-btn kx-btn-primary"
            onClick={() => void exportPng()}
            disabled={!ready || busy}
          >
            <Icon name="export" size={15} />
            {t("screenshots.exportPng")}
          </button>
        </>
      }
    >
      <div className="kx-shot-editor">
        <div className="kx-shot-toolbar" role="toolbar" aria-label={t("screenshots.editorTitle")}>
          <div className="kx-shot-toolgroup">
            {tools.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="kx-shot-tool"
                data-active={tool === entry.id}
                aria-pressed={tool === entry.id}
                title={entry.label}
                onClick={() => setTool(entry.id)}
              >
                <Icon name={entry.icon} size={15} />
                <span>{entry.label}</span>
              </button>
            ))}
          </div>
          <div className="kx-shot-toolgroup">
            {COLORS.map((value) => (
              <button
                key={value}
                type="button"
                className="kx-shot-color"
                style={{ background: value }}
                data-active={color === value}
                aria-label={value}
                aria-pressed={color === value}
                onClick={() => setColor(value)}
              />
            ))}
            <label className="kx-shot-range">
              <span>{t("screenshots.stroke")}</span>
              <input
                type="range"
                min={2}
                max={14}
                value={stroke}
                onChange={(event) => setStroke(Number(event.target.value))}
              />
            </label>
            {tool === "text" && (
              <input
                className="kx-input kx-shot-text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={t("screenshots.textPlaceholder")}
                aria-label={t("screenshots.textPlaceholder")}
              />
            )}
          </div>
          <div className="kx-shot-toolgroup">
            <button
              type="button"
              className="kx-shot-tool"
              onClick={undo}
              disabled={!canUndo || busy}
              data-history={historyTick}
            >
              {t("screenshots.undo")}
            </button>
            <button
              type="button"
              className="kx-shot-tool"
              onClick={redo}
              disabled={!canRedo || busy}
            >
              {t("screenshots.redo")}
            </button>
            <button
              type="button"
              className="kx-shot-tool"
              data-active={showOriginal}
              aria-pressed={showOriginal}
              onClick={() => setShowOriginal((value) => !value)}
              disabled={!ready}
            >
              {showOriginal ? t("screenshots.edited") : t("screenshots.original")}
            </button>
          </div>
        </div>

        {error && (
          <div className="kx-notice" data-tone="danger">
            <Icon name="alert" size={16} />
            <div>{error}</div>
          </div>
        )}

        <div className="kx-shot-canvas-wrap" ref={wrapRef}>
          <canvas ref={canvasRef} className="kx-shot-canvas" />
          {showOriginal && originalUrl && (
            <img
              className="kx-shot-original"
              src={originalUrl}
              alt={t("screenshots.original")}
              draggable={false}
            />
          )}
          <canvas
            ref={overlayRef}
            className="kx-shot-overlay"
            aria-label={t("screenshots.canvasHint")}
            onPointerDown={(event) => {
              if (!ready || busy || showOriginal) return;
              const point = pointerPosition(event);
              if (!point) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              dragRef.current = { start: point, current: point };
              paintOverlay(point);
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current;
              if (!drag) return;
              const point = pointerPosition(event);
              if (!point) return;
              drag.current = point;
              paintOverlay(drag.start);
            }}
            onPointerUp={(event) => {
              const drag = dragRef.current;
              if (!drag) return;
              const point = pointerPosition(event);
              dragRef.current = null;
              void commitDrag(drag.start, point ?? drag.current);
            }}
            onPointerCancel={() => {
              dragRef.current = null;
              paintOverlay(null);
            }}
          />
          {!ready && !error && (
            <div className="kx-shot-loading" role="status" aria-live="polite">
              <span className="kx-spin">
                <Icon name="refresh" size={22} />
              </span>
              <span>{t("screenshots.loadingEditor")}</span>
            </div>
          )}
        </div>
        <p className="kx-card-sub" style={{ margin: 0 }}>
          {t("screenshots.canvasHint")}
        </p>
      </div>
    </Modal>
  );
}
