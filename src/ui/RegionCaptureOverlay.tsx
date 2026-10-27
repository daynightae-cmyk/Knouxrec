import { useCallback, useEffect, useRef, useState } from "react";
import { captureRegion, stageRegionToSourcePixels } from "../services/regionCapture";
import type { ScreenRegion } from "../services/regionCapture";
import { Icon } from "../app/icons";
import { buildFileName, formatBytes } from "../lib/format";
import { useLibrary } from "../state/LibraryContext";
import { useSettings } from "../state/SettingsContext";
import { useToast } from "../state/ToastContext";
import { translate } from "../i18n/translate";

export interface RegionCaptureOverlayProps {
  open: boolean;
  onClose: () => void;
  /** Stream already acquired through a trusted user gesture (OS picker). When
   * provided, the overlay reuses it instead of calling getDisplayMedia again,
   * which keeps the display-media request inside a transient user activation. */
  sourceStream?: MediaStream | null;
}

export default function RegionCaptureOverlay({ open, onClose, sourceStream }: RegionCaptureOverlayProps) {
  const { settings } = useSettings();
  const { add: addToLibrary } = useLibrary();
  const { push } = useToast();
  const t = (key: string) => translate(settings.language, key);
  const title = t("regionCapture.title");
  const hint = t("regionCapture.hint");
  const confirmLabel = t("regionCapture.confirm");
  const cancelLabel = t("cancel");
  const saved = t("screenshotSaved");

  const [stream, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [region, setRegion] = useState<ScreenRegion>({ x: 0, y: 0, width: 0, height: 0 });
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  // Pointer-down starts a new selection rectangle; dimensions grow while dragging.

  const stopStream = (stream: MediaStream) => {
    stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        /* noop */
      }
    });
  };

  const cancelCapture = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    const active = streamRef.current;
    streamRef.current = null;
    // Only the overlay stops streams it acquired itself. A sourceStream passed
    // by the caller is owned by the caller and must not be closed here.
    if (active && !sourceStream) stopStream(active);
    if (!sourceStream) setStream(null);
    setError(null);
    setReady(false);
    dragStartRef.current = null;
  }, [sourceStream]);

  useEffect(() => {
    if (!open) {
      cancelCapture();
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        // Reuse a stream acquired through a real user gesture (OS picker).
        // Otherwise request the display surface here; this path is only a
        // fallback and must remain inside a user gesture in callers.
        let captured: MediaStream;
        if (sourceStream) {
          captured = sourceStream;
        } else if (typeof navigator.mediaDevices?.getDisplayMedia === "function") {
          captured = await navigator.mediaDevices.getDisplayMedia({
            video: { width: { ideal: 3840 }, height: { ideal: 2160 } },
            audio: false,
          });
        } else {
          setError("OS display capture is not available in this runtime.");
          return;
        }
        if (cancelled) {
          if (sourceStream === null) stopStream(captured);
          return;
        }
        if (captured.getVideoTracks().length === 0) {
          if (sourceStream === null) stopStream(captured);
          setError("The display picker returned no video track.");
          return;
        }
        streamRef.current = captured;
        setStream(captured);
        const video = videoRef.current;
        if (!video) {
          cancelCapture();
          return;
        }
        video.srcObject = captured;
        await video.play();
        if (!cancelled) setReady(true);
      } catch (cause) {
        if (cancelled) return;
        cancelCapture();
        setError(cause instanceof Error ? cause.message : "Region capture was cancelled.");
      }
    })();
    return () => {
      cancelled = true;
      cancelCapture();
    };
    }, [open, cancelCapture, sourceStream]);

  const startDrag = useCallback((clientX: number, clientY: number) => {
    if (!overlayRef.current || !ready) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
    dragStartRef.current = { x, y };
    setRegion({ x, y, width: 0, height: 0 });
  }, [ready]);

  const moveDrag = useCallback((clientX: number, clientY: number) => {
    if (!dragStartRef.current || !overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
    const anchor = dragStartRef.current;
    setRegion({
      x: Math.min(anchor.x, x),
      y: Math.min(anchor.y, y),
      width: Math.abs(x - anchor.x),
      height: Math.abs(y - anchor.y),
    });
  }, []);

  const confirm = useCallback(async () => {
    if (!stream || !videoRef.current) return;
    setError(null);
    try {
      const video = videoRef.current;
      const stage = overlayRef.current;
      if (!stage || !video.videoWidth || !video.videoHeight) {
        throw new Error("Capture preview is not ready.");
      }
      const sourceRegion = stageRegionToSourcePixels(
        region,
        { width: stage.clientWidth, height: stage.clientHeight },
        { width: video.videoWidth, height: video.videoHeight },
      );
      const result = await captureRegion({
        region: sourceRegion,
        sourcePixels: true,
        mimeType: settings.screenshotFormat,
        quality: settings.screenshotQuality,
        sourceStream: stream,
      });
      const extension =
        result.mimeType === "image/jpeg" ? "jpg" : result.mimeType.replace("image/", "");
      const name = buildFileName(
        settings.recorder.namingPattern || "KNOUX-REC-[DATE]_[TIME]",
        extension,
      );
      await addToLibrary({
        name,
        kind: "image",
        mimeType: result.mimeType,
        blob: result.blob,
        duration: 0,
        width: result.width,
        height: result.height,
        source: "screenshot",
        thumbnail: null,
      });
      push("success", saved, `${name} · ${formatBytes(result.blob.size)}`);
      cancelCapture();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Region capture failed.");
    }
  }, [stream, region, settings, addToLibrary, push, saved, cancelCapture, onClose]);

  const pointerMove = useCallback(
    (event: PointerEvent) => {
      if (!dragStartRef.current) return;
      moveDrag(event.clientX, event.clientY);
    },
    [moveDrag],
  );

  const endDrag = useCallback(() => {
    dragStartRef.current = null;
  }, []);

  const escape = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        cancelCapture();
        onClose();
      }
    },
    [cancelCapture, onClose],
  );

  useEffect(() => {
    if (open) {
      window.addEventListener("pointermove", pointerMove);
      window.addEventListener("pointerup", endDrag);
      window.addEventListener("pointercancel", endDrag);
    }
    return () => {
      window.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, [open, pointerMove, endDrag]);

  useEffect(() => {
    if (open) {
      window.addEventListener("keydown", escape);
    }
    return () => window.removeEventListener("keydown", escape);
  }, [open, escape]);

  if (!open) return null;

  return (
    <div
      className="kx-region-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="kx-region-backdrop" />
      <div className="kx-region-shell">
        <div className="kx-region-header">
          <strong>{title}</strong>
          <span className="kx-muted kx-mono">
            {Math.round(region.width)}×{Math.round(region.height)}
          </span>
          <button
            type="button"
            className="kx-btn"
            onClick={() => { cancelCapture(); onClose(); }}
            aria-label={cancelLabel}
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
        <div
          className="kx-region-stage"
          ref={overlayRef}
          onPointerDown={(event) => startDrag(event.clientX, event.clientY)}
        >
          <video ref={videoRef} autoPlay muted playsInline className="kx-region-video" />
          {region.width > 0 && region.height > 0 && (
            <div
              className="kx-region-selection"
              style={{ left: region.x, top: region.y, width: region.width, height: region.height }}
              aria-hidden="true"
            />
          )}
          <div className="kx-region-hint">{hint}</div>
        </div>
        <div className="kx-region-footer">
          <button
            type="button"
            className="kx-btn"
            disabled={!stream || !ready}
            onClick={() => { cancelCapture(); onClose(); }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="kx-btn kx-btn-primary"
            disabled={!stream || !ready || region.width < 2 || region.height < 2}
            onClick={confirm}
          >
            <Icon name="camera" size={15} />
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
