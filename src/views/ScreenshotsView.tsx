import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRecorder } from "../state/RecorderContext";
import { useLibrary } from "../state/LibraryContext";
import { useSettings } from "../state/SettingsContext";
import { useToast } from "../state/ToastContext";
import { translate } from "../i18n/translate";
import { Icon } from "../app/icons";
import { CAPABILITIES, type RouteId } from "../app/capabilities";
import {
  EmptyState,
  PreviewDialog,
  SectionHeader,
  StateBadge,
  Thumbnail,
} from "./ui";
import ScreenshotEditor from "./ScreenshotEditor";
import RegionCaptureOverlay from "../ui/RegionCaptureOverlay";
import { downloadBlob, formatBytes, buildFileName } from "../lib/format";
import type { LibraryItem } from "../state/types";

type ShotSource = "screen" | "window" | "region" | "scrolling";

const MAX_NOTE = 500;

/** Ruler ticks that stay readable whatever the image size. */
function rulerTicks(length: number, step: number): number[] {
  const ticks: number[] = [];
  for (let value = 0; value <= length; value += step) ticks.push(value);
  return ticks;
}

export default function ScreenshotsView({
  onNavigate,
}: {
  onNavigate?: (route: RouteId) => void;
}) {
  const recorder = useRecorder();
  const { items, urlFor, update, add } = useLibrary();
  const { settings, update: updateSettings } = useSettings();
  const { push } = useToast();
  const t = (key: string) => translate(settings.language, key);

  const [preview, setPreview] = useState<LibraryItem | null>(null);
  const [editing, setEditing] = useState<LibraryItem | null>(null);
  const [regionOpen, setRegionOpen] = useState(false);
  const [regionStream, setRegionStream] = useState<MediaStream | null>(null);
  const [regionError, setRegionError] = useState<string | null>(null);
  const [delay, setDelay] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [source, setSource] = useState<ShotSource>("screen");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"items" | "metadata">("items");
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [dirty, setDirty] = useState(false);

  const timerRef = useRef<number | null>(null);
  const openedCaptureRef = useRef<string | null>(null);

  const images = useMemo(() => items.filter((item) => item.kind === "image"), [items]);
  const totalBytes = images.reduce((sum, item) => sum + item.size, 0);

  const selected = useMemo(
    () => images.find((item) => item.id === selectedId) ?? images[0] ?? null,
    [images, selectedId],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return images;
    return images.filter(
      (item) =>
        item.name.toLowerCase().includes(needle) ||
        (item.tags ?? []).some((tag) => tag.toLowerCase().includes(needle)),
    );
  }, [images, query]);

  // Tag and note edits follow the selected capture; unsaved edits are dropped
  // rather than silently written onto a different file.
  useEffect(() => {
    setTagDraft("");
    setNoteDraft(selected?.note ?? "");
    setDirty(Boolean(selected && (selected.note ?? "") !== noteDraft));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  useEffect(() => {
    if (!selected) return;
    setNoteDraft(selected.note ?? "");
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const clearCountdown = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setCountdown(null);
  };

  useEffect(() => () => clearCountdown(), []);

  const stopRegionStream = useCallback(() => {
    if (regionStream) {
      regionStream.getTracks().forEach((track) => {
        try { track.stop(); } catch { /* noop */ }
      });
      setRegionStream(null);
    }
  }, [regionStream]);

  useEffect(() => {
    if (!regionOpen) stopRegionStream();
  }, [regionOpen, stopRegionStream]);

  const startCapture = () => {
    if (source === "scrolling") return;
    if (source === "region") {
      void openRegionCapture();
      return;
    }
    if (delay === 0) {
      void captureScreenOrWindow();
      return;
    }
    clearCountdown();
    let remaining = delay;
    setCountdown(remaining);
    timerRef.current = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearCountdown();
        void captureScreenOrWindow();
      } else {
        setCountdown(remaining);
      }
    }, 1000);
  };

  /**
   * Screen and window are the same OS picker with a different surface hint.
   * The hint is not a bypass: the system still shows the picker and still
   * needs the user to choose and grant permission.
   */
  const captureScreenOrWindow = async () => {
    if (typeof navigator.mediaDevices?.getDisplayMedia !== "function") {
      setRegionError("OS display capture is not available in this runtime.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 3840 },
          height: { ideal: 2160 },
          displaySurface: source === "window" ? "window" : "monitor",
        },
        audio: false,
      });
      const frame = await frameFromStream(stream);
      stream.getTracks().forEach((track) => {
        try { track.stop(); } catch { /* noop */ }
      });
      if (!frame) {
        setRegionError("The display picker returned no video frame.");
        return;
      }
      await persistFrame(frame.blob, frame.width, frame.height);
    } catch (cause) {
      setRegionError(
        cause instanceof Error ? cause.message : "The capture was cancelled.",
      );
    }
  };

  const persistFrame = async (blob: Blob, width: number, height: number) => {
    const extension =
      blob.type === "image/jpeg" ? "jpg" : blob.type.replace("image/", "");
    const name = buildFileName(settings.recorder.namingPattern, extension);
    const item = await add({
      name,
      kind: "image",
      mimeType: blob.type,
      blob,
      duration: 0,
      width,
      height,
      source: "screenshot",
      thumbnail: null,
    });
    setSelectedId(item.id);
    // A fresh capture opens straight into the editor, the same way one taken
    // through the recorder does.
    setEditing(item);
    push("success", t("screenshots.saved"), `${item.name} · ${width}×${height}`);
  };

  const frameFromStream = async (
    stream: MediaStream,
  ): Promise<{ blob: Blob; width: number; height: number } | null> => {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play().catch(() => undefined);
    if (!video.videoWidth) {
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        video.onloadedmetadata = done;
        window.setTimeout(done, 3000);
      });
    }
    if (!video.videoWidth || !video.videoHeight) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, `image/${settings.screenshotFormat}`, settings.screenshotQuality),
    );
    video.pause();
    video.srcObject = null;
    if (!blob) return null;
    return { blob, width: canvas.width, height: canvas.height };
  };

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
    setSelectedId(item.id);
    setEditing(item);
  }, [lastCaptureId, items]);

  const copyToClipboard = async () => {
    if (!selected) return;
    if (
      typeof navigator.clipboard === "undefined" ||
      typeof ClipboardItem === "undefined" ||
      !navigator.clipboard.write
    ) {
      push("error", t("screenshots.clipboardUnavailable"), t("screenshots.clipboardHint"));
      return;
    }
    try {
      // Chromium only accepts PNG on the clipboard, so a JPEG or WebP capture is
      // re-encoded here rather than the write being faked or refused silently.
      const blob = await toPng(selected);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      push("success", t("screenshots.copied"), `${selected.name} · ${formatBytes(blob.size)}`);
    } catch (cause) {
      push(
        "error",
        t("screenshots.clipboardUnavailable"),
        cause instanceof Error ? cause.message : t("screenshots.clipboardHint"),
      );
    }
  };

  const toPng = (item: LibraryItem): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(item.blob);
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) {
          URL.revokeObjectURL(url);
          reject(new Error("The 2D canvas context is unavailable."));
          return;
        }
        context.drawImage(image, 0, 0);
        canvas.toBlob((value) => {
          URL.revokeObjectURL(url);
          if (value) resolve(value);
          else reject(new Error("The browser could not encode the PNG."));
        }, "image/png");
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("The stored image could not be decoded."));
      };
      image.src = url;
    });

  const addTag = () => {
    const clean = tagDraft.trim().toLowerCase();
    if (!clean || !selected) return;
    const next = Array.from(new Set([...(selected.tags ?? []), clean]));
    void update(selected.id, { blob: selected.blob, tags: next });
    setTagDraft("");
  };

  const removeTag = (tag: string) => {
    if (!selected) return;
    const next = (selected.tags ?? []).filter((entry) => entry !== tag);
    void update(selected.id, { blob: selected.blob, tags: next });
  };

  const saveEdits = async () => {
    if (!selected) return;
    await update(selected.id, {
      blob: selected.blob,
      note: noteDraft.slice(0, MAX_NOTE),
    });
    setDirty(false);
    push("success", t("screenshots.editsSaved"), selected.name);
  };

  const capability = CAPABILITIES.screenshots;
  const zoomValue =
    zoom === "fit" ? 1 : zoom;

  return (
    <div className="kx-content">
      <SectionHeader
        eyebrow={t("screenshots.eyebrow")}
        title={t("screenshots.studio")}
        description={t("screenshots.description")}
        actions={
          <>
            <StateBadge state={capability.state} />
            <button
              type="button"
              className="kx-btn"
              onClick={() => onNavigate?.("library")}
            >
              <Icon name="library" size={16} />
              {t("screenshots.openLibrary")}
            </button>
            <button
              type="button"
              className="kx-btn kx-btn-primary"
              data-action="new-capture"
              onClick={startCapture}
              disabled={countdown !== null || source === "scrolling"}
            >
              <Icon name="camera" size={16} />
              {t("screenshots.newCapture")}
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

      <div className="kx-shot-bar" data-shot-bar>
        <div className="kx-segmented" data-shot-sources>
          {(["screen", "window", "region", "scrolling"] as ShotSource[]).map((option) => (
            <button
              key={option}
              type="button"
              data-shot-source={option}
              aria-pressed={source === option}
              disabled={option === "scrolling"}
              title={
                option === "scrolling" ? t("screenshots.scrollBlocked") : undefined
              }
              onClick={() => setSource(option)}
            >
              <Icon
                name={
                  option === "screen"
                    ? "studio"
                    : option === "window"
                      ? "layers"
                      : option === "region"
                        ? "cut"
                        : "expand"
                }
                size={14}
              />
              {t(`screenshots.source.${option}`)}
              {option === "scrolling" && (
                <span className="kx-shot-blocked" data-scrolling-blocked>
                  {t("screenshots.blockedTag")}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="kx-row" style={{ gap: 6 }} role="group" aria-label={t("screenshots.delay")}>
          <Icon name="clock" size={14} />
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

        <button
          type="button"
          className="kx-btn kx-btn-primary"
          data-action="capture"
          onClick={startCapture}
          disabled={
            countdown !== null ||
            source === "scrolling" ||
            (!recorder.support.display && !recorder.previewStream)
          }
        >
          <Icon name="camera" size={16} />
          {t("screenshots.capture")}
        </button>
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

      <div className="kx-shot-workspace">
        <section className="kx-shot-canvas-panel" data-shot-canvas>
          {selected ? (
            <>
              <div className="kx-shot-ruler-top" aria-hidden="true">
                {rulerTicks(selected.width, Math.max(1, Math.round(selected.width / 8 / 160) * 160)).map(
                  (tick) => (
                    <span className="kx-shot-tick" key={tick} style={{ left: `${(tick / selected.width) * 100}%` }}>
                      {tick}
                    </span>
                  ),
                )}
              </div>
              <div className="kx-shot-canvas-body">
                <div className="kx-shot-ruler-left" aria-hidden="true">
                  {rulerTicks(
                    selected.height,
                    Math.max(1, Math.round(selected.height / 6 / 180) * 180),
                  ).map((tick) => (
                    <span
                      className="kx-shot-tick"
                      key={tick}
                      style={{ top: `${(tick / selected.height) * 100}%` }}
                    >
                      {tick}
                    </span>
                  ))}
                </div>
                <div className="kx-studio-canvas">
                  <img
                    src={urlFor(selected.id) ?? selected.thumbnail ?? undefined}
                    alt={selected.name}
                    data-shot-image
                    style={{ width: `${zoomValue * 100}%` }}
                  />
                </div>
              </div>
              <div className="kx-shot-canvas-foot">
                <button
                  type="button"
                  className="kx-btn kx-btn-sm"
                  data-action="edit"
                  onClick={() => setEditing(selected)}
                >
                  <Icon name="pencil" size={14} />
                  {t("screenshots.openEditor")}
                </button>
                <div className="kx-row" style={{ gap: 4 }}>
                  <button
                    type="button"
                    className="kx-btn kx-btn-sm"
                    aria-pressed={zoom === "fit"}
                    data-action="zoom-fit"
                    onClick={() => setZoom("fit")}
                  >
                    {t("screenshots.fit")}
                  </button>
                  <button
                    type="button"
                    className="kx-btn kx-btn-sm"
                    data-action="zoom-out"
                    aria-label={t("screenshots.zoomOut")}
                    onClick={() =>
                      setZoom((current) =>
                        Math.max(0.25, (current === "fit" ? 1 : current) - 0.25),
                      )
                    }
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="kx-btn kx-btn-sm"
                    data-action="zoom-in"
                    aria-label={t("screenshots.zoomIn")}
                    onClick={() =>
                      setZoom((current) =>
                        Math.min(3, (current === "fit" ? 1 : current) + 0.25),
                      )
                    }
                  >
                    +
                  </button>
                  <span className="kx-muted kx-mono" style={{ fontSize: "0.68rem" }}>
                    {zoom === "fit" ? "fit" : `${Math.round(zoom * 100)}%`}
                  </span>
                </div>
                <span className="kx-shot-readout" data-shot-readout>
                  {selected.width}×{selected.height} · {selected.mimeType.replace("image/", "").toUpperCase()} ·{" "}
                  {formatBytes(selected.size)}
                </span>
              </div>
            </>
          ) : (
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
                  {t("screenshots.capture")}
                </button>
              }
            />
          )}
        </section>

        <aside className="kx-shot-rail">
          <div className="kx-shot-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "items"}
              data-shot-tab="items"
              className="kx-shot-tab"
              onClick={() => setTab("items")}
            >
              <Icon name="image" size={14} />
              {t("screenshots.items")} ({images.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "metadata"}
              data-shot-tab="metadata"
              className="kx-shot-tab"
              onClick={() => setTab("metadata")}
            >
              <Icon name="info" size={14} />
              {t("screenshots.metadata")}
            </button>
          </div>

          {tab === "items" ? (
            <>
              <div className="kx-shot-search">
                <Icon name="search" size={14} />
                <input
                  type="search"
                  value={query}
                  data-shot-search
                  aria-label={t("screenshots.searchShots")}
                  placeholder={t("screenshots.searchShots")}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <div className="kx-shot-list" data-shot-list>
                {filtered.length === 0 ? (
                  <p className="kx-card-sub" style={{ padding: "12px 14px" }}>
                    {images.length === 0
                      ? t("screenshots.emptyHint")
                      : t("screenshots.noMatches")}
                  </p>
                ) : (
                  filtered.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      className="kx-shot-row"
                      data-shot-row={item.id}
                      data-selected={selected?.id === item.id ? "true" : undefined}
                      onClick={() => setSelectedId(item.id)}
                    >
                      <span className="kx-shot-row-thumb">
                        <Thumbnail item={item} url={urlFor(item.id)} />
                      </span>
                      <span className="kx-shot-row-body">
                        <span className="kx-shot-row-name" title={item.name}>
                          {item.name}
                        </span>
                        <span className="kx-shot-row-meta">
                          {item.width}×{item.height} · {formatBytes(item.size)}
                        </span>
                        <span className="kx-shot-row-state">
                          <StateBadge state="VERIFIED" />
                          <span className="kx-muted" style={{ fontSize: "0.66rem" }}>
                            {new Date(item.createdAt).toLocaleTimeString()}
                          </span>
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="kx-shot-meta" data-shot-meta>
              {!selected ? (
                <p className="kx-card-sub" style={{ padding: "12px 14px" }}>
                  {t("screenshots.nothingSelected")}
                </p>
              ) : (
                <>
                  <dl className="kx-shot-dl">
                    <div>
                      <dt>{t("screenshots.dimensions")}</dt>
                      <dd className="kx-mono">
                        {selected.width} × {selected.height}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("storageUsed")}</dt>
                      <dd className="kx-mono">{formatBytes(selected.size)}</dd>
                    </div>
                    <div>
                      <dt>{t("screenshots.format")}</dt>
                      <dd className="kx-mono">{selected.mimeType}</dd>
                    </div>
                    <div>
                      <dt>{t("screenshots.origin")}</dt>
                      <dd>{selected.source}</dd>
                    </div>
                  </dl>

                  <div className="kx-shot-section">
                    <div className="kx-row-between">
                      <span className="kx-label">{t("screenshots.tags")}</span>
                      <button
                        type="button"
                        className="kx-btn kx-btn-sm"
                        onClick={() =>
                          void update(selected.id, {
                            blob: selected.blob,
                            favorite: !selected.favorite,
                          })
                        }
                        aria-pressed={Boolean(selected.favorite)}
                      >
                        <Icon name="star" size={13} />
                        {t("screenshots.favorite")}
                      </button>
                    </div>
                    <div className="kx-shot-tags">
                      {(selected.tags ?? []).map((tag) => (
                        <span className="kx-shot-tag" key={tag} data-shot-tag={tag}>
                          {tag}
                          <button
                            type="button"
                            aria-label={`${t("screenshots.removeTag")} ${tag}`}
                            onClick={() => removeTag(tag)}
                          >
                            <Icon name="x" size={11} />
                          </button>
                        </span>
                      ))}
                      {selected.tags?.length === 0 && (
                        <span className="kx-muted" style={{ fontSize: "0.7rem" }}>
                          {t("screenshots.noTags")}
                        </span>
                      )}
                    </div>
                    <div className="kx-row" style={{ gap: 6, marginTop: 8 }}>
                      <input
                        className="kx-input"
                        value={tagDraft}
                        data-tag-input
                        aria-label={t("screenshots.addTag")}
                        placeholder={t("screenshots.addTag")}
                        onChange={(event) => setTagDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") addTag();
                        }}
                      />
                      <button
                        type="button"
                        className="kx-btn kx-btn-sm"
                        data-action="add-tag"
                        onClick={addTag}
                        disabled={!tagDraft.trim()}
                      >
                        <Icon name="plus" size={13} />
                      </button>
                    </div>
                  </div>

                  <div className="kx-shot-section">
                    <span className="kx-label">{t("screenshots.notes")}</span>
                    <textarea
                      className="kx-input kx-shot-note"
                      value={noteDraft}
                      data-note-input
                      maxLength={MAX_NOTE}
                      rows={4}
                      aria-label={t("screenshots.notes")}
                      onChange={(event) => {
                        setNoteDraft(event.target.value);
                        setDirty(event.target.value !== (selected.note ?? ""));
                      }}
                    />
                    <span className="kx-muted kx-mono" style={{ fontSize: "0.64rem" }}>
                      {noteDraft.length} / {MAX_NOTE}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="kx-shot-format">
            <span className="kx-label">{t("screenshots.captureFormat")}</span>
            <div className="kx-segmented">
              {(["png", "jpeg", "webp"] as const).map((format) => (
                <button
                  key={format}
                  type="button"
                  aria-pressed={settings.screenshotFormat === format}
                  data-shot-format={format}
                  onClick={() => updateSettings({ screenshotFormat: format })}
                >
                  {format.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>

      <div className="kx-shot-footer" data-shot-footer>
        <span className="kx-shot-status" data-shot-status>
          <Icon
            name={dirty ? "alert" : selected ? "check" : "info"}
            size={15}
          />
          {dirty
            ? t("screenshots.unsaved")
            : selected
              ? t("screenshots.readyToSave")
              : t("screenshots.nothingSelected")}
        </span>
        <span className="kx-muted kx-mono" style={{ fontSize: "0.68rem" }}>
          {images.length} {t("screenshots.captureCount").replace("{count}", "")}·{" "}
          {formatBytes(totalBytes)}
        </span>
        <div className="kx-row" style={{ gap: 8 }}>
          <button
            type="button"
            className="kx-btn"
            data-action="copy-clipboard"
            onClick={() => void copyToClipboard()}
            disabled={!selected}
          >
            <Icon name="copy" size={15} />
            {t("screenshots.copyClipboard")}
          </button>
          <button
            type="button"
            className="kx-btn"
            data-action="save-edits"
            onClick={() => void saveEdits()}
            disabled={!selected || !dirty}
          >
            <Icon name="check" size={15} />
            {t("screenshots.saveEdits")}
          </button>
          <button
            type="button"
            className="kx-btn kx-btn-primary"
            data-action="export"
            onClick={() => selected && downloadBlob(selected.blob, selected.name)}
            disabled={!selected}
          >
            <Icon name="download" size={15} />
            {t("export")}
          </button>
        </div>
      </div>

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
