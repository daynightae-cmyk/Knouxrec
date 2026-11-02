import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../app/icons";
import { translate } from "../i18n/translate";
import { useSettings } from "../state/SettingsContext";
import type { ScreenRegion } from "../services/regionCapture";

/**
 * Interactive selection rectangle for a chosen area.
 *
 * The rectangle can be drawn by dragging on the preview, moved by dragging its
 * body, and resized from any of the eight handles. Arrow keys nudge it and
 * Escape cancels. The selection is reported in DEVICE pixels of the captured
 * surface, because that is the coordinate space the encoder works in: a scaled
 * or high-DPI monitor is already normalised by the OS surface, and a second
 * multiplication by the page's devicePixelRatio would shift the result twice.
 *
 * The rectangle is positioned inside a canvas element that is sized to the
 * video's own content box, so one CSS pixel of the rectangle is a known,
 * constant fraction of the captured surface — no letterbox maths, no guessing.
 */

export type ResizeHandle =
  | "nw"
  | "n"
  | "ne"
  | "e"
  | "se"
  | "s"
  | "sw"
  | "w";

const HANDLES: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export interface RegionSelectorProps {
  open: boolean;
  /** The authorized display stream, already acquired through the OS picker. */
  stream: MediaStream | null;
  onCancel: () => void;
  /** Receives the chosen rectangle in device pixels of the captured surface. */
  onConfirm: (region: ScreenRegion) => void;
}

interface DragState {
  kind: "create" | "move" | "resize";
  handle?: ResizeHandle;
  originX: number;
  originY: number;
  startRect: ScreenRegion;
}

interface Fit {
  width: number;
  height: number;
}

function normalise(rect: ScreenRegion): ScreenRegion {
  return {
    x: Math.min(rect.x, rect.x + rect.width),
    y: Math.min(rect.y, rect.y + rect.height),
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
}

function clampRect(rect: ScreenRegion, bounds: Fit): ScreenRegion {
  const width = Math.max(0, Math.min(rect.width, bounds.width));
  const height = Math.max(0, Math.min(rect.height, bounds.height));
  const x = Math.max(0, Math.min(rect.x, Math.max(0, bounds.width - width)));
  const y = Math.max(0, Math.min(rect.y, Math.max(0, bounds.height - height)));
  return { x, y, width, height };
}

/** The largest box with the surface's aspect ratio that fits in the stage. */
function containFit(
  box: Fit,
  surface: { width: number; height: number },
): Fit {
  if (!box.width || !box.height || !surface.width || !surface.height) {
    return { width: 0, height: 0 };
  }
  const scale = Math.min(box.width / surface.width, box.height / surface.height);
  return {
    width: Math.max(1, Math.floor(surface.width * scale)),
    height: Math.max(1, Math.floor(surface.height * scale)),
  };
}

export default function RegionSelector({
  open,
  stream,
  onCancel,
  onConfirm,
}: RegionSelectorProps) {
  const { settings } = useSettings();
  const t = (key: string) => translate(settings.language, key);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const [ready, setReady] = useState(false);
  const [surface, setSurface] = useState({ width: 0, height: 0 });
  const [box, setBox] = useState<Fit>({ width: 0, height: 0 });
  const [rect, setRect] = useState<ScreenRegion>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setReady(false);
      setError(null);
      setRect({ x: 0, y: 0, width: 0, height: 0 });
      return undefined;
    }
    let cancelled = false;
    const video = videoRef.current;
    if (!video || !stream) return undefined;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
    const readSize = () => {
      if (cancelled) return;
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setSurface({ width: video.videoWidth, height: video.videoHeight });
        setReady(true);
      }
    };
    video.addEventListener("loadedmetadata", readSize);
    video.addEventListener("resize", readSize);
    readSize();
    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", readSize);
      video.removeEventListener("resize", readSize);
    };
  }, [open, stream]);

  // The stage box changes with the window, so the content box is recomputed
  // whenever the stage is resized.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const measure = () => {
      setBox({ width: stage.clientWidth, height: stage.clientHeight });
    };
    measure();
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : null;
    observer?.observe(stage);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  const fit = useMemo(() => containFit(box, surface), [box, surface]);

  /** Scale between the on-screen rectangle and the captured surface. */
  const scale = useMemo(
    () => (fit.width > 0 ? surface.width / fit.width : 1),
    [fit.width, surface.width],
  );

  const canvasPoint = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const bounds = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(bounds.width, clientX - bounds.left)),
      y: Math.max(0, Math.min(bounds.height, clientY - bounds.top)),
    };
  }, []);

  const startCreate = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!ready) return;
      const point = canvasPoint(event.clientX, event.clientY);
      dragRef.current = {
        kind: "create",
        originX: point.x,
        originY: point.y,
        startRect: { x: point.x, y: point.y, width: 0, height: 0 },
      };
      setRect({ x: point.x, y: point.y, width: 0, height: 0 });
    },
    [ready, canvasPoint],
  );

  const startMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!ready) return;
      const point = canvasPoint(event.clientX, event.clientY);
      dragRef.current = {
        kind: "move",
        originX: point.x,
        originY: point.y,
        startRect: rect,
      };
      event.stopPropagation();
    },
    [ready, rect, canvasPoint],
  );

  const startResize = useCallback(
    (handle: ResizeHandle) => (event: React.PointerEvent<HTMLSpanElement>) => {
      if (!ready) return;
      const point = canvasPoint(event.clientX, event.clientY);
      dragRef.current = {
        kind: "resize",
        handle,
        originX: point.x,
        originY: point.y,
        startRect: rect,
      };
      event.stopPropagation();
    },
    [ready, rect, canvasPoint],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const point = canvasPoint(event.clientX, event.clientY);

      if (drag.kind === "create") {
        setRect(
          normalise({
            x: Math.min(drag.originX, point.x),
            y: Math.min(drag.originY, point.y),
            width: Math.abs(point.x - drag.originX),
            height: Math.abs(point.y - drag.originY),
          }),
        );
        return;
      }

      if (drag.kind === "move") {
        const dx = point.x - drag.originX;
        const dy = point.y - drag.originY;
        setRect(
          clampRect(
            {
              x: drag.startRect.x + dx,
              y: drag.startRect.y + dy,
              width: drag.startRect.width,
              height: drag.startRect.height,
            },
            fit,
          ),
        );
        return;
      }

      const handle = drag.handle ?? "se";
      const start = drag.startRect;
      const left = start.x;
      const top = start.y;
      const right = start.x + start.width;
      const bottom = start.y + start.height;
      let nextLeft = left;
      let nextTop = top;
      let nextRight = right;
      let nextBottom = bottom;

      if (handle.includes("w")) nextLeft = Math.min(point.x, right);
      if (handle.includes("e")) nextRight = Math.max(point.x, left);
      if (handle.includes("n")) nextTop = Math.min(point.y, bottom);
      if (handle.includes("s")) nextBottom = Math.max(point.y, top);

      setRect(
        clampRect(
          {
            x: nextLeft,
            y: nextTop,
            width: nextRight - nextLeft,
            height: nextBottom - nextTop,
          },
          fit,
        ),
      );
    },
    [canvasPoint, fit],
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  const nudge = useCallback(
    (deltaX: number, deltaY: number) => {
      setRect((current) =>
        clampRect(
          {
            x: current.x + deltaX,
            y: current.y + deltaY,
            width: current.width,
            height: current.height,
          },
          fit,
        ),
      );
    },
    [fit],
  );

  const confirm = useCallback(() => {
    if (!surface.width || !surface.height) {
      setError("The captured surface has no size yet.");
      return;
    }
    if (rect.width < 4 || rect.height < 4) {
      setError("Drag a rectangle of at least 4×4 pixels.");
      return;
    }
    const sourceX = Math.round(rect.x * scale);
    const sourceY = Math.round(rect.y * scale);
    const sourceWidth = Math.round(rect.width * scale);
    const sourceHeight = Math.round(rect.height * scale);
    if (
      sourceX < 0 ||
      sourceY < 0 ||
      sourceX + sourceWidth > surface.width ||
      sourceY + sourceHeight > surface.height
    ) {
      setError("The selection falls outside the captured surface.");
      return;
    }
    onConfirm({
      x: sourceX,
      y: sourceY,
      width: sourceWidth,
      height: sourceHeight,
    });
  }, [onConfirm, rect, scale, surface]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        confirm();
        return;
      }
      const step = event.shiftKey ? 10 : 1;
      if (event.key === "ArrowLeft") nudge(-step, 0);
      else if (event.key === "ArrowRight") nudge(step, 0);
      else if (event.key === "ArrowUp") nudge(0, -step);
      else if (event.key === "ArrowDown") nudge(0, step);
      else return;
      event.preventDefault();
    },
    [confirm, nudge, onCancel],
  );

  useEffect(() => {
    if (!open) return undefined;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="kx-region-overlay kx-region-overlay-select"
      role="dialog"
      aria-modal="true"
      aria-label={t("regionCapture.title")}
    >
      <div className="kx-region-backdrop" />
      <div className="kx-region-shell kx-region-shell-wide">
        <div className="kx-region-header">
          <strong>{t("regionCapture.title")}</strong>
          <span className="kx-muted kx-mono" data-region-readout>
            {surface.width}×{surface.height} source · {Math.round(rect.width * scale)}×
            {Math.round(rect.height * scale)} selected
          </span>
          <button
            type="button"
            className="kx-btn"
            onClick={onCancel}
            aria-label={t("cancel")}
          >
            <Icon name="x" size={15} />
          </button>
        </div>

        {error && (
          <div className="kx-notice" data-tone="error">
            <Icon name="alert" size={17} />
            <div>{error}</div>
          </div>
        )}

        <div className="kx-region-stage" ref={stageRef}>
          <div
            className="kx-region-canvas"
            ref={canvasRef}
            style={{ width: fit.width || undefined, height: fit.height || undefined }}
            onPointerDown={startCreate}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onKeyDown}
            tabIndex={0}
            data-region-stage
          >
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="kx-region-video"
            />
            {rect.width > 0 && rect.height > 0 && (
              <div
                className="kx-region-selection"
                data-region-selection
                style={{
                  left: rect.x,
                  top: rect.y,
                  width: rect.width,
                  height: rect.height,
                }}
                onPointerDown={startMove}
              >
                <span
                  className="kx-region-selection-label kx-mono"
                  data-region-selection-label
                >
                  {Math.round(rect.width * scale)}×{Math.round(rect.height * scale)}
                </span>
                {HANDLES.map((handle) => (
                  <span
                    key={handle}
                    className="kx-region-handle"
                    data-handle={handle}
                    onPointerDown={startResize(handle)}
                  />
                ))}
              </div>
            )}
            <div className="kx-region-hint">{t("regionCapture.hint")}</div>
          </div>
        </div>

        <div className="kx-region-footer">
          <button type="button" className="kx-btn" onClick={onCancel}>
            {t("cancel")}
          </button>
          <button
            type="button"
            className="kx-btn kx-btn-primary"
            disabled={!ready || rect.width < 4 || rect.height < 4}
            onClick={confirm}
          >
            <Icon name="play" size={15} />
            {t("regionCapture.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
