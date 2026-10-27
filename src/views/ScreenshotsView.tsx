import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRecorder } from "../state/RecorderContext";
import { useLibrary } from "../state/LibraryContext";
import { useSettings } from "../state/SettingsContext";
import { translate } from "../i18n/translate";
import { Icon } from "../app/icons";
import {
  EmptyState,
  PreviewDialog,
  SectionHeader,
  StatCard,
  Thumbnail,
} from "./ui";
import ScreenshotEditor from "./ScreenshotEditor";
import RegionCaptureOverlay from "../ui/RegionCaptureOverlay";
import { downloadBlob, formatBytes } from "../lib/format";
import type { LibraryItem } from "../state/types";

export default function ScreenshotsView() {
  const recorder = useRecorder();
  const { items, urlFor } = useLibrary();
  const { settings, update } = useSettings();
  const t = (key: string) => translate(settings.language, key);
  const [preview, setPreview] = useState<LibraryItem | null>(null);
  const [editing, setEditing] = useState<LibraryItem | null>(null);
  const [regionOpen, setRegionOpen] = useState(false);
  const [regionStream, setRegionStream] = useState<MediaStream | null>(null);
  const [regionError, setRegionError] = useState<string | null>(null);
  const [delay, setDelay] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const openedCaptureRef = useRef<string | null>(null);

  const clearCountdown = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setCountdown(null);
  };

  useEffect(() => () => clearCountdown(), []);

  // Release a region-capture stream the view owns when the overlay closes or
  // the component unmounts so no camera/screen track stays open.
  const stopRegionStream = useCallback(() => {
    if (regionStream) {
      regionStream.getTracks().forEach((track) => {
        try { track.stop(); } catch { /* noop */ }
      });
      setRegionStream(null);
    }
  }, [regionStream]);

  // Stop the view-owned region stream when the overlay closes so no track
  // stays open after the user cancels.
  useEffect(() => {
    if (!regionOpen) stopRegionStream();
  }, [regionOpen, stopRegionStream]);

  // A delay is real wall-clock time: the overlay counts it down and either the
  // countdown reaches zero or the user cancels before any pixels are captured.
  const startCapture = () => {
    if (delay === 0) {
      void recorder.takeScreenshot();
      return;
    }
    clearCountdown();
    let remaining = delay;
    setCountdown(remaining);
    timerRef.current = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearCountdown();
        void recorder.takeScreenshot();
      } else {
        setCountdown(remaining);
      }
    }, 1000);
  };

  // OS display capture (getDisplayMedia) requires a transient user gesture, so
  // the stream is acquired directly in this click handler and handed to the
  // overlay. The overlay never re-requests it, which keeps the picker inside
  // the activation window and avoids a denied capture on Windows.
  const openRegionCapture = async () => {
    stopRegionStream();
    setRegionError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
      setRegionError("OS display capture is not available in this runtime.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 3840 }, height: { ideal: 2160 } },
        audio: false,
      });
      if (stream.getVideoTracks().length === 0) {
        stream.getTracks().forEach((track) => track.stop());
        setRegionError("The display picker returned no video track.");
        return;
      }
      setRegionStream(stream);
      setRegionOpen(true);
    } catch (cause) {
      setRegionError(cause instanceof Error ? cause.message : "Region capture was cancelled.");
    }
  };

  // A fresh capture opens straight into the editor once its library row exists.
  const lastCaptureId = recorder.lastCapture?.id ?? null;
  useEffect(() => {
    if (!lastCaptureId || openedCaptureRef.current === lastCaptureId) return;
    const item = items.find((entry) => entry.id === lastCaptureId);
    if (!item || item.kind !== "image") return;
    openedCaptureRef.current = lastCaptureId;
    setEditing(item);
  }, [lastCaptureId, items]);

  const images = useMemo(() => items.filter((item) => item.kind === "image"), [items]);
  const totalBytes = images.reduce((sum, item) => sum + item.size, 0);

  return (
    <div className="kx-content">
      <SectionHeader
        eyebrow={t("groupRecord")}
        title={t("screenshots")}
        description={t("screenshots.description")}
        actions={
          <>
            <button
              type="button"
              className="kx-btn kx-btn-primary"
              onClick={openRegionCapture}
              disabled={countdown !== null}
            >
              <Icon name="cut" size={17} />
              {t("regionCapture.label")}
            </button>
            <button
              type="button"
              className="kx-btn kx-btn-primary"
              onClick={startCapture}
              disabled={!recorder.support.display && !recorder.previewStream || countdown !== null}
            >
              <Icon name="camera" size={17} />
              {t("captureScreen")}
            </button>
          </>
        }
      />

      {regionError && (
        <div className="kx-notice" data-tone="error" role="alert">
          <Icon name="alert" size={17} />
          <div>{regionError}</div>
        </div>
      )}

      <div className="kx-row kx-shot-delay" role="group" aria-label={t("screenshots.delay")}>
        <span className="kx-muted kx-mono" style={{ fontSize: "0.68rem" }}>
          {t("screenshots.delay")}
        </span>
        {[0, 3, 5, 10].map((seconds) => (
          <button
            key={seconds}
            type="button"
            className="kx-chip"
            data-delay={seconds}
            aria-pressed={delay === seconds}
            onClick={() => setDelay(seconds)}
            disabled={countdown !== null}
          >
            {seconds === 0 ? t("screenshots.noDelay") : `${seconds}s`}
          </button>
        ))}
      </div>

      {countdown !== null && (
        <div className="kx-shot-countdown" role="status" data-countdown={countdown}>
          <div className="kx-shot-countdown-card">
            <span className="kx-shot-countdown-number">{countdown}</span>
            <p className="kx-card-sub">{t("screenshots.countdownHint")}</p>
            <button type="button" className="kx-btn" data-action="cancel-countdown" onClick={clearCountdown}>
              {t("screenshots.cancelCountdown")}
            </button>
          </div>
        </div>
      )}

      {!recorder.support.display && !recorder.previewStream && (
        <div className="kx-notice" data-tone="warn">
          <Icon name="alert" size={18} />
          <div>
            <strong>{t("screenshots.unavailable")}</strong>{" "}
            {recorder.support.reason ?? t("screenshots.unavailableHint")}
          </div>
        </div>
      )}

      <div className="kx-grid kx-grid-3">
        <StatCard
          label={t("screenshots")}
          value={String(images.length)}
          hint={t("screenshots.realBlobs")}
          icon="image"
        />
        <StatCard
          label={t("storageUsed")}
          value={formatBytes(totalBytes)}
          hint={t("screenshots.encodedSize")}
          icon="hardDrive"
        />
        <div className="kx-card">
          <div className="kx-card-title" style={{ fontSize: "0.82rem" }}>
            {t("screenshots.captureFormat")}
          </div>
          <div className="kx-segmented" style={{ marginTop: 10 }}>
            {(["png", "jpeg", "webp"] as const).map((format) => (
              <button
                key={format}
                type="button"
                aria-pressed={settings.screenshotFormat === format}
                onClick={() => update({ screenshotFormat: format })}
              >
                {format.toUpperCase()}
              </button>
            ))}
          </div>
          <label className="kx-field" style={{ marginTop: 12 }}>
            <span className="kx-label">
              {t("quality")} · {Math.round(settings.screenshotQuality * 100)}%
            </span>
            <input
              type="range"
              min={0.5}
              max={1}
              step={0.05}
              value={settings.screenshotQuality}
              onChange={(event) => update({ screenshotQuality: Number(event.target.value) })}
            />
          </label>
        </div>
      </div>

      {images.length === 0 ? (
        <EmptyState
          icon="camera"
          title={t("capturesEmpty")}
          hint={t("screenshots.emptyHint")}
          action={
            <button
              type="button"
              className="kx-btn kx-btn-primary"
              onClick={startCapture}
              disabled={!recorder.support.display && !recorder.previewStream}
            >
              <Icon name="camera" size={16} />
              {t("captureAgain")}
            </button>
          }
        />
      ) : (
        <div className="kx-media-grid">
          {images.map((item) => (
            <article className="kx-media-card" key={item.id}>
              <button
                type="button"
                className="kx-media-thumb"
                onClick={() => setPreview(item)}
                aria-label={`Preview ${item.name}`}
              >
                <Thumbnail item={item} url={urlFor(item.id)} />
              </button>
              <div className="kx-media-body">
                <span className="kx-media-name" title={item.name}>
                  {item.name}
                </span>
                <span className="kx-media-meta">
                  <span>
                    {item.width}×{item.height}
                  </span>
                  <span>{formatBytes(item.size)}</span>
                  <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                </span>
                <div className="kx-media-actions">
                  <button
                    type="button"
                    className="kx-btn kx-btn-sm kx-btn-primary"
                    onClick={() => setEditing(item)}
                  >
                    <Icon name="pencil" size={14} />
                    {t("screenshots.openEditor")}
                  </button>
                  <button
                    type="button"
                    className="kx-btn kx-btn-sm"
                    onClick={() => setPreview(item)}
                  >
                    <Icon name="eye" size={14} />
                    {t("preview")}
                  </button>
                  <button
                    type="button"
                    className="kx-btn kx-btn-sm"
                    onClick={() => downloadBlob(item.blob, item.name)}
                  >
                    <Icon name="download" size={14} />
                    {t("export")}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <PreviewDialog
        item={preview}
        url={preview ? urlFor(preview.id) : null}
        onClose={() => setPreview(null)}
        onExport={(item) => downloadBlob(item.blob, item.name)}
      />

      <ScreenshotEditor
        open={Boolean(editing)}
        blob={editing?.blob ?? null}
        name={editing?.name ?? ""}
        onClose={() => setEditing(null)}
      />

      <RegionCaptureOverlay
        open={regionOpen}
        onClose={() => setRegionOpen(false)}
        sourceStream={regionStream}
      />
    </div>
  );
}
