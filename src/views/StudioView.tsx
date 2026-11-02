import { useEffect, useMemo, useRef, useState } from "react";
import { useRecorder } from "../state/RecorderContext";
import { useSettings } from "../state/SettingsContext";
import { useLibrary } from "../state/LibraryContext";
import { translate } from "../i18n/translate";
import type { RouteId } from "../app/capabilities";
import { Icon } from "../app/icons";
import BrandMark from "../app/BrandMark";
import { EmptyState, PreviewDialog, SectionHeader } from "./ui";
import { downloadBlob, formatBytes, formatDuration } from "../lib/format";
import type { CaptureMode } from "../services/recordingEngine";
import type { ScreenRegion } from "../services/regionCapture";
import RegionSelector from "../ui/RegionSelector";
import { LevelMeter } from "../ui/LevelMeter";
import { comboParts, HOTKEY_ACTIONS } from "../services/hotkeys";
import type { LibraryItem } from "../state/types";

/** Every capture surface the recorder can drive, in the approved order. */
const CAPTURE_MODES: Array<{ mode: CaptureMode; labelKey: string; icon: "studio" | "layers" | "cut" | "camera" | "audio" }> = [
  { mode: "screen", labelKey: "screen", icon: "studio" },
  { mode: "window", labelKey: "window", icon: "layers" },
  { mode: "region", labelKey: "studio.regionChip", icon: "cut" },
  { mode: "webcam", labelKey: "webcam", icon: "camera" },
  { mode: "audio", labelKey: "studio.audioChip", icon: "audio" },
];

function StreamPreview({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = stream;
    void element.play().catch(() => undefined);
    return () => {
      element.srcObject = null;
    };
  }, [stream]);

  return <video ref={ref} muted playsInline autoPlay />;
}

const STATUS_LABEL: Record<string, string> = {
  idle: "studio.status.ready",
  requesting: "studio.status.requesting",
  recording: "studio.status.recording",
  paused: "studio.status.paused",
  stopping: "studio.status.stopping",
  error: "studio.status.error",
};

export default function StudioView({
  onNavigate,
}: {
  onNavigate: (route: RouteId, jobId?: string) => void;
}) {
  const recorder = useRecorder();
  const { settings, updateRecorder } = useSettings();
  const { items, urlFor } = useLibrary();
  const t = (key: string) => translate(settings.language, key);
  const [mode, setMode] = useState<CaptureMode>(recorder.preferredMode);
  const [preview, setPreview] = useState<LibraryItem | null>(null);
  const [devices, setDevices] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [delay, setDelay] = useState(5);
  const [displaySurface, setDisplaySurface] = useState<"monitor" | "window">(
    "monitor",
  );
  const [regionStream, setRegionStream] = useState<MediaStream | null>(null);
  const [regionOpen, setRegionOpen] = useState(false);
  const [region, setRegion] = useState<ScreenRegion | null>(null);
  const [pendingRegion, setPendingRegion] = useState(false);

  const active = recorder.status === "recording" || recorder.status === "paused";
  const busy = recorder.status === "requesting" || recorder.status === "stopping";
  const videos = items.filter((item) => item.kind === "video").slice(0, 3);

  /**
   * A selected-area take needs the rectangle measured against the surface the
   * OS actually handed over, so the picker is opened first, the rectangle is
   * drawn on the live preview of that surface, and only then is the recorder
   * started with the already-acquired stream.
   */
  const requestRegionStream = async () => {
    if (typeof navigator.mediaDevices?.getDisplayMedia !== "function") {
      recorder.clearError();
      return;
    }
    try {
      // Called directly from the click so the request stays inside the user
      // activation the OS picker requires.
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 3840 },
          height: { ideal: 2160 },
          frameRate: { ideal: settings.recorder.fps },
          cursor: "always",
          displaySurface,
        },
        audio: settings.recorder.systemAudio,
      });
      if (stream.getVideoTracks().length === 0) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      setRegionStream(stream);
      setRegionOpen(true);
    } catch {
      // The user dismissed the OS picker. Nothing was recorded and nothing is
      // claimed; the notice on screen already explains that permission is
      // required.
      setRegionStream(null);
      setRegionOpen(false);
    }
  };

  const releaseRegionStream = () => {
    regionStream?.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        /* noop */
      }
    });
    setRegionStream(null);
    setRegionOpen(false);
  };

  const startRegionRecording = async (chosen: ScreenRegion) => {
    if (!regionStream) return;
    setRegion(chosen);
    setRegionOpen(false);
    setPendingRegion(true);
    // The recorder takes ownership of the stream, so it is not released here.
    const stream = regionStream;
    setRegionStream(null);
    try {
      await recorder.start("region", { region: chosen, sourceStream: stream });
    } finally {
      setPendingRegion(false);
    }
  };

  // Device labels only exist once the microphone has been granted, so the list
  // is refreshed whenever a session starts or ends rather than guessed at.
  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    let cancelled = false;
    navigator.mediaDevices
      .enumerateDevices()
      .then((found) => {
        if (cancelled) return;
        setDevices(
          found
            .filter((device) => device.kind === "audioinput")
            .map((device) => ({ deviceId: device.deviceId, label: device.label })),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [recorder.status]);

  const audioMode = mode === "audio";
  const selectedDevice = useMemo(
    () => devices.find((device) => device.deviceId === settings.recorder.audioDeviceId) ?? null,
    [devices, settings.recorder.audioDeviceId],
  );

  return (
    <div className="kx-content">
      <SectionHeader
        eyebrow={t("groupRecord")}
        title={t("studio")}
        description={t("studio.description")}
        actions={
          <>
            <span className="kx-promise" data-recorder-promises>
              <span className="kx-promise-item">
                <Icon name="sparkles" size={14} />
                {t("studio.badgeLocal")}
              </span>
              <span className="kx-promise-item">
                <Icon name="shield" size={14} />
                {t("studio.badgePrivate")}
              </span>
              <span className="kx-promise-item">
                <Icon name="layers" size={14} />
                {t("studio.badgeQuality")}
              </span>
            </span>
            <span className="kx-badge" data-state="VERIFIED">
              {t("studio.pipelineBadge")}
            </span>
            <button
              type="button"
              className="kx-btn kx-btn-sm"
              onClick={() => void recorder.takeScreenshot()}
              disabled={!recorder.support.display && !recorder.previewStream}
            >
              <Icon name="camera" size={15} />
              {t("captureScreenshot")}
            </button>
          </>
        }
      />

      {recorder.error && (
        <div className="kx-notice" data-tone="danger" role="alert">
          <Icon name="alert" size={18} />
          <div style={{ flex: 1 }}>
            <strong>{t("studio.captureFailed")}</strong> {recorder.error}
          </div>
          <button type="button" className="kx-btn kx-btn-sm" onClick={recorder.clearError}>
            {t("studio.dismiss")}
          </button>
        </div>
      )}

      {!recorder.support.display && (
        <div className="kx-notice" data-tone="warn">
          <Icon name="alert" size={18} />
          <div>
            <strong>{t("studio.displayUnavailable")}</strong>{" "}
            {recorder.support.reason ?? t("studio.displayUnavailableHint")}
          </div>
        </div>
      )}

      <div className="kx-grid kx-grid-2" style={{ alignItems: "start" }}>
        <div className="kx-col">
          <div
            className="kx-preview"
            data-state={recorder.status === "recording" ? "live" : undefined}
            style={{ minHeight: 380 }}
          >
            {active && recorder.mode === "audio" ? (
              <div className="kx-preview-audio" data-audio-session>
                <div className="kx-preview-overlay">
                  <span className="kx-rec-dot" />
                  <span>{recorder.status === "paused" ? t("paused") : t("recording")}</span>
                  <time>{formatDuration(recorder.elapsed)}</time>
                </div>
                <BrandMark size={68} />
                <div className="kx-preview-audio-title">
                  <Icon name="audio" size={15} />
                  {t("studio.audioTitle")}
                </div>
                <LevelMeter
                  readLevel={recorder.readLevel}
                  active={recorder.status === "recording"}
                  labels={{
                    aria: t("studio.meterAria"),
                    peak: t("studio.meterPeak"),
                    average: t("studio.meterAverage"),
                    loudest: t("studio.meterLoudest"),
                    clip: t("studio.meterClip"),
                    silent: t("studio.meterSilent"),
                    value: (dB: string, average: string) =>
                      t("studio.meterValue").replace("{dB}", dB).replace("{avg}", average),
                  }}
                />
                <div className="kx-card-sub kx-mono" dir="ltr" style={{ marginTop: 2 }}>
                  {t("studio.audioSource")}
                </div>
              </div>
            ) : recorder.previewStream ? (
              <>
                <StreamPreview stream={recorder.previewStream} />
                <div className="kx-preview-overlay">
                  <span className="kx-rec-dot" />
                  <span>{recorder.status === "paused" ? t("paused") : t("recording")}</span>
                  <time>{formatDuration(recorder.elapsed)}</time>
                </div>
                {recorder.mode === "region" && region && (
                  <div className="kx-preview-region" data-region-badge>
                    <Icon name="cut" size={13} />
                    <span className="kx-mono">
                      {region.width}×{region.height} @ {region.x},{region.y}
                    </span>
                  </div>
                )}
                <div className="kx-preview-timestamp">
                  {settings.recorder.quality}p · {settings.recorder.fps} fps
                </div>
              </>
            ) : (
              <div className="kx-preview-idle">
                <BrandMark size={86} />
                <div style={{ fontFamily: "var(--kx-font-display)", letterSpacing: "0.16em" }}>
                  {t(STATUS_LABEL[recorder.status] ?? recorder.status)}
                </div>
                <div>{t("previewIdle")}</div>
                <div className="kx-row" style={{ justifyContent: "center", marginTop: 8 }}>
                  {CAPTURE_MODES.map((option) => (
                    <span
                      key={option.mode}
                      className="kx-chip"
                      aria-pressed={mode === option.mode}
                    >
                      <Icon name={option.icon} size={14} /> {t(option.labelKey)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="kx-preview-status" data-preview-status>
            <span className="kx-preview-status-item">
              <Icon name="studio" size={13} />
              <span className="kx-mono">
                {recorder.mode === "region" && region
                  ? `${region.width} × ${region.height}`
                  : `${settings.recorder.quality}p`}
              </span>
            </span>
            <span className="kx-preview-status-item">
              <Icon name="clock" size={13} />
              <span className="kx-mono">{settings.recorder.fps} fps</span>
            </span>
            <span className="kx-preview-status-item">
              <Icon name="audio" size={13} />
              {t("systemAudio")}:{" "}
              <strong data-system-audio-state={settings.recorder.systemAudio ? "on" : "off"}>
                {settings.recorder.systemAudio ? t("studio.on") : t("studio.off")}
              </strong>
            </span>
            <span className="kx-preview-status-item">
              <Icon name="microphone" size={13} />
              {t("microphone")}:{" "}
              <strong data-microphone-state={settings.recorder.microphone ? "on" : "off"}>
                {settings.recorder.microphone ? t("studio.on") : t("studio.off")}
              </strong>
            </span>
            <button
              type="button"
              className="kx-btn kx-btn-sm kx-preview-status-settings"
              onClick={() => onNavigate("settings")}
            >
              <Icon name="settings" size={13} />
              {t("studio.previewSettings")}
            </button>
          </div>

          <div className="kx-grid kx-grid-3">
            <div className="kx-stat">
              <span className="kx-stat-label">{t("studio.elapsed")}</span>
              <span className="kx-stat-value">{formatDuration(recorder.elapsed)}</span>
              <span className="kx-stat-hint">
                {recorder.status === "paused" ? t("studio.timerPaused") : t("studio.liveFromClock")}
              </span>
            </div>
            <div className="kx-stat">
              <span className="kx-stat-label">{t("studio.recordingSize")}</span>
              <span className="kx-stat-value">
                {active ? formatBytes(recorder.readBytes()) : "—"}
              </span>
              <span className="kx-stat-hint">
                {active
                  ? t("studio.recordingSizeHint")
                  : t("studio.recordingSizeIdle")}
              </span>
            </div>
            <div className="kx-stat">
              <span className="kx-stat-label">{t("studio.output")}</span>
              <span className="kx-stat-value">
                {audioMode
                  ? t("studio.audioValue")
                  : recorder.mode === "region" && region
                    ? `${region.width}×${region.height}`
                    : `${settings.recorder.quality}p`}
              </span>
              <span className="kx-stat-hint">
                {audioMode
                  ? t("studio.audioHint")
                  : `${settings.recorder.fps} fps · ${
                      settings.recorder.systemAudio ? "system audio" : "no system audio"
                    }`}
              </span>
            </div>
          </div>

          <div className="kx-notice" data-tone="info">
            <Icon name="info" size={16} />
            <div>
              <strong>{t("hotkeys")}:</strong>{" "}
              <span dir="ltr" className="kx-mono" data-hotkey-hint>
                {HOTKEY_ACTIONS.map(({ action }) =>
                  comboParts(settings.hotkeys[action] ?? "").join("+"),
                )
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
          </div>
        </div>

        <div className="kx-card">
          <div className="kx-row-between">
            <div className="kx-card-title">{t("recordingSettings")}</div>
            <span
              className="kx-badge"
              data-state={
                recorder.status === "recording"
                  ? "LIVE"
                  : recorder.status === "paused"
                    ? "PARTIAL"
                    : recorder.status === "error"
                      ? "BLOCKED"
                      : "AVAILABLE_UNVERIFIED"
              }
            >
              {t(STATUS_LABEL[recorder.status] ?? recorder.status)}
            </span>
          </div>

          <div className="kx-col" style={{ marginTop: 16 }}>
            <div className="kx-field">
              <span className="kx-label">{t("studio.captureSource")}</span>
              <div className="kx-segmented" data-capture-modes>
                {CAPTURE_MODES.map((option) => (
                  <button
                    key={option.mode}
                    type="button"
                    aria-pressed={mode === option.mode}
                    data-capture-mode={option.mode}
                    onClick={() => {
                      setMode(option.mode);
                      // The screen/window chips are the same display picker
                      // with a different surface hint, so choosing one also
                      // chooses what the OS picker opens on.
                      if (option.mode === "window") setDisplaySurface("window");
                      else if (option.mode === "screen") setDisplaySurface("monitor");
                      // The toggle shortcut starts whatever source was chosen
                      // last, so choosing one here is also a preference.
                      recorder.setPreferredMode(option.mode);
                    }}
                    disabled={
                      active ||
                      busy ||
                      (option.mode === "region" && !recorder.support.region)
                    }
                  >
                    <Icon name={option.icon} size={14} />
                    {t(option.labelKey)}
                  </button>
                ))}
              </div>
              <span className="kx-card-sub">
                {mode === "audio"
                  ? t("studio.audioNote")
                  : mode === "region"
                    ? t("studio.regionNote")
                    : t("studio.screenAndWindowNote")}
              </span>
              {(mode === "screen" || mode === "window" || mode === "region") && (
                <div className="kx-field" data-surface-picker>
                  <span className="kx-label">{t("studio.sourceSurface")}</span>
                  <select
                    className="kx-input"
                    value={displaySurface}
                    aria-label={t("studio.sourceSurface")}
                    disabled={active || busy}
                    onChange={(event) =>
                      setDisplaySurface(
                        event.target.value as "monitor" | "window",
                      )
                    }
                  >
                    <option value="monitor">{t("studio.sourceEntireScreen")}</option>
                    <option value="window">{t("studio.sourceWindow")}</option>
                  </select>
                  <span className="kx-card-sub">{t("studio.sourceSurfaceHint")}</span>
                </div>
              )}
              {audioMode && (
                <div className="kx-field" data-microphone-picker>
                  <span className="kx-label">{t("studio.microphone")}</span>
                  <select
                    className="kx-input"
                    value={settings.recorder.audioDeviceId ?? ""}
                    aria-label={t("studio.microphone")}
                    disabled={active || busy}
                    onChange={(event) =>
                      updateRecorder({ audioDeviceId: event.target.value || null })
                    }
                  >
                    <option value="">{t("studio.defaultMicrophone")}</option>
                    {devices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || t("studio.unnamedDevice")}
                      </option>
                    ))}
                  </select>
                  <span className="kx-card-sub">
                    {devices.length === 0
                      ? t("studio.noDevices")
                      : selectedDevice
                        ? t("studio.deviceChosen")
                        : t("studio.deviceNamesHint")}
                  </span>
                </div>
              )}
            </div>

            <div className="kx-field" data-schedule-control>
              <span className="kx-label">{t("studio.delayLabel")}</span>
              <div className="kx-row" style={{ gap: 6, flexWrap: "wrap" }}>
                {[3, 5, 10, 30].map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="kx-btn kx-btn-sm"
                    aria-pressed={delay === value}
                    data-delay={value}
                    disabled={active || busy || Boolean(recorder.schedule)}
                    onClick={() => setDelay(value)}
                  >
                    {value}s
                  </button>
                ))}
                <button
                  type="button"
                  className="kx-btn kx-btn-sm kx-btn-primary"
                  data-schedule-start
                  onClick={() => recorder.scheduleStart(delay, mode)}
                  disabled={
                    active ||
                    busy ||
                    Boolean(recorder.schedule) ||
                    !recorder.support.mediaRecorder
                  }
                >
                  <Icon name="clock" size={13} />
                  {t("studio.scheduleStart")}
                </button>
              </div>
              <span className="kx-card-sub">{t("studio.delayHint")}</span>
            </div>

            {recorder.schedule && (
              <div
                className="kx-notice"
                data-tone="info"
                data-schedule-countdown
                data-remaining={recorder.schedule.remaining}
              >
                <Icon name="clock" size={16} />
                <div style={{ flex: 1 }}>
                  <strong>
                    {t("studio.scheduleIn")} {recorder.schedule.remaining}s
                  </strong>{" "}
                  <span className="kx-muted">
                    {t(`rec.mode.${recorder.schedule.mode}`)}
                  </span>
                </div>
                <button
                  type="button"
                  className="kx-btn kx-btn-sm"
                  data-schedule-cancel
                  onClick={recorder.cancelSchedule}
                >
                  {t("studio.scheduleCancel")}
                </button>
              </div>
            )}

            <div className="kx-grid kx-grid-2">
              <div className="kx-field">
                <span className="kx-label">{t("quality")}</span>
                <div className="kx-segmented">
                  {([720, 1080, 1440, 2160] as const).map((quality) => (
                    <button
                      key={quality}
                      type="button"
                      aria-pressed={settings.recorder.quality === quality}
                      onClick={() => updateRecorder({ quality })}
                      disabled={active}
                    >
                      {quality}p
                    </button>
                  ))}
                </div>
              </div>
              <div className="kx-field">
                <span className="kx-label">{t("fps")}</span>
                <div className="kx-segmented">
                  {([30, 60] as const).map((fps) => (
                    <button
                      key={fps}
                      type="button"
                      aria-pressed={settings.recorder.fps === fps}
                      onClick={() => updateRecorder({ fps })}
                      disabled={active}
                    >
                      {fps}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="kx-divider" />

            <div className="kx-row" style={{ gap: 18 }}>
              <label className="kx-switch">
                <input
                  type="checkbox"
                  checked={settings.recorder.systemAudio}
                  onChange={(event) => updateRecorder({ systemAudio: event.target.checked })}
                  disabled={active}
                />
                <span className="kx-switch-track" />
                <span className="kx-switch-label">{t("systemAudio")}</span>
              </label>
              <label className="kx-switch">
                <input
                  type="checkbox"
                  checked={settings.recorder.microphone}
                  onChange={(event) => updateRecorder({ microphone: event.target.checked })}
                  disabled={active}
                />
                <span className="kx-switch-track" />
                <span className="kx-switch-label">{t("microphone")}</span>
              </label>
            </div>

            {mode !== "webcam" && (
              <label className="kx-switch">
                <input
                  type="checkbox"
                  checked={settings.recorder.webcamOverlay}
                  onChange={(event) => updateRecorder({ webcamOverlay: event.target.checked })}
                  disabled={active}
                />
                <span className="kx-switch-track" />
                <span className="kx-switch-label">{t("webcamOverlay")}</span>
              </label>
            )}

            {settings.recorder.webcamOverlay && mode !== "webcam" && (
              <div className="kx-grid kx-grid-2">
                <label className="kx-field">
                  <span className="kx-label">{t("studio.overlayPosition")}</span>
                  <select
                    className="kx-select"
                    value={settings.recorder.webcamPosition}
                    onChange={(event) =>
                      updateRecorder({
                        webcamPosition: event.target
                          .value as typeof settings.recorder.webcamPosition,
                      })
                    }
                    disabled={active}
                  >
                    <option value="topLeft">{t("position.topLeft")}</option>
                    <option value="topRight">{t("position.topRight")}</option>
                    <option value="bottomLeft">{t("position.bottomLeft")}</option>
                    <option value="bottomRight">{t("position.bottomRight")}</option>
                  </select>
                </label>
                <div className="kx-field">
                  <span className="kx-label">{t("studio.overlaySize")}</span>
                  <div className="kx-segmented">
                    {(["small", "medium", "large"] as const).map((size) => (
                      <button
                        key={size}
                        type="button"
                        aria-pressed={settings.recorder.webcamSize === size}
                        onClick={() => updateRecorder({ webcamSize: size })}
                        disabled={active}
                      >
                        {t(`size.${size}`)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="kx-divider" />

            <div className="kx-row" style={{ gap: 8 }}>
              {recorder.status === "recording" || recorder.status === "paused" ? (
                <>
                  <button
                    type="button"
                    className="kx-btn kx-btn-primary"
                    style={{ flex: 1 }}
                    data-pause-toggle
                    aria-pressed={recorder.status === "paused"}
                    onClick={() =>
                      recorder.status === "paused" ? recorder.resume() : recorder.pause()
                    }
                  >
                    <Icon
                      name={recorder.status === "paused" ? "play" : "pause"}
                      size={17}
                    />
                    {recorder.status === "paused" ? t("resume") : t("pause")}
                  </button>
                  <button
                    type="button"
                    className="kx-btn kx-btn-danger"
                    style={{ flex: 1 }}
                    data-stop-recording
                    onClick={() => void recorder.stop()}
                  >
                    <Icon name="stop" size={17} />
                    {t("stop")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="kx-btn kx-btn-primary kx-btn-block"
                  data-start-recording
                  onClick={() => {
                    if (mode === "region") {
                      void requestRegionStream();
                      return;
                    }
                    void recorder.start(mode, { displaySurface });
                  }}
                  disabled={
                    busy ||
                    pendingRegion ||
                    !recorder.support.mediaRecorder ||
                    (mode === "region" && !recorder.support.region)
                  }
                >
                  <Icon name="play" size={17} />
                  {recorder.status === "requesting"
                    ? t("studio.status.requesting")
                    : recorder.status === "stopping"
                      ? t("studio.status.stopping")
                      : mode === "region"
                        ? t("studio.chooseArea")
                        : t("startRecording")}
                </button>
              )}
            </div>

            <div className="kx-notice" data-tone="warn">
              <Icon name="shield" size={16} />
              <div>
                Screen capture requires a direct user gesture and OS permission. Nothing is
                recorded until the picker is accepted.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="kx-card">
        <div className="kx-row-between">
          <div className="kx-card-title">{t("lastCapture")}</div>
          <div className="kx-row" style={{ gap: 8 }}>
            {recorder.lastCapture && (
              <button
                type="button"
                className="kx-btn kx-btn-sm"
                onClick={() => onNavigate("live-studio")}
              >
                <Icon name="activity" size={15} />
                {t("liveStudio.open")}
              </button>
            )}
            <button
              type="button"
              className="kx-btn kx-btn-sm"
              onClick={() => {
                const first = items[0];
                if (first) setPreview(first);
              }}
              disabled={!items[0]}
            >
              <Icon name="eye" size={15} />
              {t("preview")}
            </button>
          </div>
        </div>
        {videos.length === 0 ? (
          <div style={{ marginTop: 14 }}>
            <EmptyState
              icon="video"
              title={t("studio.noRecordings")}
              hint={t("studio.noRecordingsHint")}
            />
          </div>
        ) : (
          <div className="kx-media-grid" style={{ marginTop: 14 }}>
            {videos.map((item) => (
              <article className="kx-media-card" key={item.id}>
                <button
                  type="button"
                  className="kx-media-thumb"
                  onClick={() => setPreview(item)}
                  aria-label={`Preview ${item.name}`}
                >
                  {item.thumbnail ? (
                    <img src={item.thumbnail} alt="" />
                  ) : (
                    <span className="kx-media-fallback">
                      <Icon name="video" size={28} />
                    </span>
                  )}
                  <span className="kx-media-duration">{formatDuration(item.duration)}</span>
                </button>
                <div className="kx-media-body">
                  <span className="kx-media-name">{item.name}</span>
                  <span className="kx-media-meta">
                    <span>{formatBytes(item.size)}</span>
                    <span>
                      {item.width}×{item.height}
                    </span>
                  </span>
                  <div className="kx-media-actions">
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
      </div>

      <RegionSelector
        open={regionOpen}
        stream={regionStream}
        onCancel={releaseRegionStream}
        onConfirm={(chosen) => void startRegionRecording(chosen)}
      />

      <PreviewDialog
        item={preview}
        url={preview ? urlFor(preview.id) : null}
        onClose={() => setPreview(null)}
        onExport={(item) => downloadBlob(item.blob, item.name)}
      />
    </div>
  );
}
