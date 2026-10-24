import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ReactCompareSlider } from "react-compare-slider";
import {
  TransformComponent,
  TransformWrapper,
  type ReactZoomPanPinchContentRef,
} from "react-zoom-pan-pinch";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import { useJobs, type MediaJobRecord, type StudioArtifact } from "../state/JobsContext";
import { useLibrary } from "../state/LibraryContext";
import { useRecorder } from "../state/RecorderContext";
import { useSettings } from "../state/SettingsContext";
import { useToast } from "../state/ToastContext";
import { translate } from "../i18n/translate";
import { CAPABILITIES, type RouteId } from "../app/capabilities";
import { Icon, type IconName } from "../app/icons";
import { AudioWaveform } from "../ui/AudioWaveform";
import { KxTooltip } from "../ui/Tooltip";
import { EmptyState } from "./ui";
import { downloadBlob, formatBytes, formatDuration } from "../lib/format";

const TERMINAL: ReadonlySet<string> = new Set(["done", "cancelled", "error"]);

const STAGE_META: Record<string, { key: string; icon: IconName }> = {
  validating: { key: "jobs.stageValidating", icon: "search" },
  processing: { key: "jobs.stageProcessing", icon: "activity" },
  verifying: { key: "jobs.stageVerifying", icon: "check" },
  done: { key: "jobs.done", icon: "check" },
  cancelled: { key: "jobs.cancelled", icon: "x" },
  error: { key: "jobs.error", icon: "alert" },
};

const KIND_KEYS: Record<string, string> = {
  tool: "liveStudio.kindTool",
  template: "liveStudio.kindTemplate",
  recording: "liveStudio.kindRecording",
};

function readHashJobId(): string | null {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const parts = raw.split("/");
  return parts[0] === "live-studio" && parts[1] ? parts[1] : null;
}

function paramValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function relativeOffset(at: number, startedAt: number): string {
  const seconds = Math.max(0, (at - startedAt) / 1000);
  return `+${seconds.toFixed(1)}s`;
}

function artifactKind(artifact: StudioArtifact): "image" | "video" | "audio" {
  if (artifact.mimeType.startsWith("video/")) return "video";
  if (artifact.mimeType.startsWith("audio/")) return "audio";
  return "image";
}

/**
 * KNOuX LIVE STUDIO — the shared execution workspace.
 *
 * Every panel is driven by the real job registry: the header, timeline and
 * result dock render only events and bytes that the underlying processor
 * actually produced. Cancellation is real for jobs whose engine observes a
 * token; previews come from the genuine input blob and output artifact.
 */
export default function LiveStudioView({
  onNavigate,
}: {
  onNavigate: (route: RouteId, jobId?: string) => void;
}) {
  const { jobs, cancelJob, runJob } = useJobs();
  const { add } = useLibrary();
  const recorder = useRecorder();
  const { settings } = useSettings();
  const { push } = useToast();
  const t = useCallback(
    (key: string) => translate(settings.language, key),
    [settings.language],
  );

  const [hashId, setHashId] = useState<string | null>(() => readHashJobId());
  const [split, setSplit] = useState(50);
  const [fit, setFit] = useState<"contain" | "cover">("contain");
  const [zoomPercent, setZoomPercent] = useState(100);
  const [wide, setWide] = useState(() =>
    typeof window === "undefined"
      ? true
      : window.matchMedia("(min-width: 1181px)").matches,
  );
  const [now, setNow] = useState(() => Date.now());
  const stageRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef<ReactZoomPanPinchContentRef | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1181px)");
    const onChange = (event: MediaQueryListEvent) => setWide(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const onHash = () => setHashId(readHashJobId());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const record: MediaJobRecord | null = useMemo(() => {
    if (jobs.length === 0) return null;
    return jobs.find((job) => job.id === hashId) ?? jobs[0];
  }, [jobs, hashId]);

  const active = record ? !TERMINAL.has(record.stage) : false;

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [active]);

  const selectJob = useCallback((id: string) => {
    try {
      window.history.replaceState(null, "", `#/live-studio/${id}`);
    } catch {
      /* replaceState can fail in exotic embeds; the selection still applies. */
    }
    setHashId(id);
  }, []);

  // Object URLs are owned here and revoked when the selection changes.
  const [urls, setUrls] = useState<{ source: string | null; result: string | null }>(
    { source: null, result: null },
  );
  const sourceBlob = record?.request?.file ?? null;
  const resultBlob = record?.result?.blob ?? null;
  useEffect(() => {
    const source = sourceBlob ? URL.createObjectURL(sourceBlob) : null;
    const result = resultBlob ? URL.createObjectURL(resultBlob) : null;
    setUrls({ source, result });
    return () => {
      if (source) URL.revokeObjectURL(source);
      if (result) URL.revokeObjectURL(result);
    };
  }, [sourceBlob, resultBlob]);

  useEffect(() => {
    setSplit(50);
    setZoomPercent(100);
    setFit("contain");
  }, [record?.id]);

  const sourceIsImage = Boolean(sourceBlob?.type.startsWith("image/"));
  const sourceIsVideo = Boolean(sourceBlob?.type.startsWith("video/"));
  const sourceIsAudio = Boolean(sourceBlob?.type.startsWith("audio/"));
  const resultIsImage = Boolean(record?.result?.mimeType.startsWith("image/"));
  const resultIsVideo = Boolean(record?.result?.mimeType.startsWith("video/"));
  const resultIsAudio = Boolean(record?.result?.mimeType.startsWith("audio/"));

  const elapsedSeconds = record
    ? ((record.finishedAt ?? (active ? now : record.startedAt)) - record.startedAt) /
      1000
    : 0;

  const saveToLibrary = useCallback(async () => {
    if (!record?.result) return;
    const artifact = record.result;
    try {
      await add({
        name: artifact.fileName,
        kind: artifactKind(artifact),
        mimeType: artifact.mimeType,
        blob: artifact.blob,
        duration: artifact.duration ?? 0,
        width: artifact.width ?? 0,
        height: artifact.height ?? 0,
        source: record.kind === "recording" ? "recording" : "toolbox",
        thumbnail: null,
      });
      push(
        "success",
        t("liveStudio.savedTitle"),
        `${artifact.fileName} · ${formatBytes(artifact.bytes)}`,
      );
    } catch (cause) {
      push(
        "error",
        t("liveStudio.saveFailed"),
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  }, [add, push, record, t]);

  const retry = useCallback(() => {
    if (!record?.request) return;
    void runJob(record.request, {
      route: record.route,
      onStart: (id) => selectJob(id),
    }).catch(() => undefined);
  }, [record, runJob, selectJob]);

  const goFullscreen = useCallback(() => {
    const element = stageRef.current;
    if (!element) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void element.requestFullscreen?.().catch(() => undefined);
    }
  }, []);

  if (!record) {
    return (
      <section className="kx-content kx-live">
        <h1 className="kx-live-title" style={{ margin: 0 }}>
          {t("liveStudio")}
        </h1>
        <EmptyState
          icon="activity"
          title={t("liveStudio.emptyTitle")}
          hint={t("liveStudio.emptyHint")}
          action={
            <div className="kx-row" style={{ gap: 10 }}>
              <button
                type="button"
                className="kx-btn kx-btn-primary"
                onClick={() => onNavigate("toolbox")}
              >
                <Icon name="toolbox" size={16} />
                {t("jobs.runTool")}
              </button>
              <button
                type="button"
                className="kx-btn"
                onClick={() => onNavigate("studio")}
              >
                <Icon name="studio" size={16} />
                {t("startRecording")}
              </button>
            </div>
          }
        />
      </section>
    );
  }

  const stageMeta = STAGE_META[record.stage] ?? STAGE_META.processing;
  const routeLabel = CAPABILITIES[record.route as RouteId]
    ? t(CAPABILITIES[record.route as RouteId].labelKey)
    : record.route;
  const artifact = record.result;

  const sourcePreview = sourceIsImage && urls.source && (
    <img
      className="kx-live-media"
      data-fit={fit}
      src={urls.source}
      alt={t("liveStudio.source")}
      draggable={false}
    />
  );
  const sourceVideo = sourceIsVideo && urls.source && (
    <video
      className="kx-live-media"
      data-fit={fit}
      src={urls.source}
      controls
      playsInline
    />
  );
  const sourceAudio = sourceIsAudio && sourceBlob && (
    <AudioWaveform
      blob={sourceBlob}
      label={t("liveStudio.sourceAudio")}
      playLabel={t("liveStudio.playAudio")}
      pauseLabel={t("liveStudio.pauseAudio")}
      decodingLabel={t("liveStudio.decodingAudio")}
      fallbackNote={t("liveStudio.audioFallback")}
    />
  );

  let stageBody: ReactNode;
  if (resultIsVideo && urls.result) {
    stageBody = (
      <video className="kx-live-media" data-fit={fit} src={urls.result} controls playsInline />
    );
  } else if (resultIsAudio && urls.result) {
    stageBody = (
      <div className="kx-live-audio">
        <span className="kx-live-audio-label">{t("liveStudio.result")}</span>
        <audio src={urls.result} controls preload="metadata" />
        {record.result && (
          <span className="kx-live-audio-meta kx-mono">
            {formatDuration(record.result.duration ?? 0)} ·{" "}
            {formatBytes(record.result.bytes)}
          </span>
        )}
      </div>
    );
  } else if (resultIsImage && urls.result && sourceIsImage && urls.source) {
    stageBody = (
      <div className="kx-live-compare-wrap" dir="ltr">
        <ReactCompareSlider
          key={record.id}
          className="kx-live-compare"
          itemOne={
            <img
              className="kx-live-compare-img"
              src={urls.source}
              alt={t("liveStudio.source")}
              draggable={false}
            />
          }
          itemTwo={
            <img
              className="kx-live-compare-img"
              src={urls.result}
              alt={t("liveStudio.result")}
              draggable={false}
            />
          }
          defaultPosition={split}
          onPositionChange={setSplit}
          portrait={false}
        />
        <span className="kx-live-compare-tag" data-side="left">
          {t("liveStudio.source")}
        </span>
        <span className="kx-live-compare-tag" data-side="right">
          {t("liveStudio.result")}
        </span>
      </div>
    );
  } else if (resultIsImage && urls.result && sourceIsAudio && sourceBlob) {
    stageBody = (
      <div className="kx-live-audio-stack">
        {sourceAudio}
        <img
          className="kx-live-media"
          data-fit={fit}
          src={urls.result}
          alt={t("liveStudio.result")}
          draggable={false}
        />
      </div>
    );
  } else if (resultIsImage && urls.result) {
    stageBody = (
      <TransformWrapper
        key={record.id}
        ref={zoomRef}
        minScale={0.5}
        maxScale={4}
        initialScale={1}
        centerOnInit
        doubleClick={{ mode: "toggle", step: 0.7 }}
        wheel={{ disabled: true }}
        panning={{ velocityDisabled: false }}
        onTransform={(_ref, state) => {
          const next = Math.round(state.scale * 100);
          setZoomPercent((current) => (current === next ? current : next));
        }}
      >
        <TransformComponent
          wrapperClass="kx-live-zoom"
          contentClass="kx-live-zoom-content"
        >
          <img
            className="kx-live-media"
            data-fit={fit}
            src={urls.result}
            alt={t("liveStudio.result")}
            draggable={false}
          />
        </TransformComponent>
      </TransformWrapper>
    );
  } else if (active && (sourceIsImage || sourceIsVideo || sourceIsAudio)) {
    stageBody = (
      <div className="kx-live-waiting">
        {sourcePreview || sourceVideo || sourceAudio}
        <div className="kx-live-waiting-note">
          <Icon name="activity" size={16} />
          <span>{t(stageMeta.key)}</span>
          <span className="kx-mono">{formatDuration(elapsedSeconds)}</span>
        </div>
      </div>
    );
  } else if (active) {
    stageBody = (
      <div className="kx-live-waiting">
        <div className="kx-live-waiting-pulse" aria-hidden="true">
          <Icon name="activity" size={34} />
        </div>
        <div className="kx-live-waiting-note">
          <span>{t(stageMeta.key)}</span>
          <span className="kx-mono">{formatDuration(elapsedSeconds)}</span>
        </div>
      </div>
    );
  } else {
    stageBody = (
      <div className="kx-live-waiting">
        <div className="kx-live-waiting-pulse" aria-hidden="true">
          <Icon name={record.stage === "error" ? "alert" : "info"} size={34} />
        </div>
        <p className="kx-live-waiting-text">
          {record.stage === "error"
            ? record.error ?? t("liveStudio.failed")
            : record.stage === "cancelled"
              ? t("liveStudio.cancelled")
              : t("liveStudio.noResultYet")}
        </p>
      </div>
    );
  }

  const canZoom = resultIsImage && !sourceIsImage && Boolean(artifact);

  return (
    <section className="kx-content kx-live">
      <header className="kx-live-header">
        <KxTooltip label={t("liveStudio.back")}>
          <button
            type="button"
            className="kx-icon-button"
            onClick={() => onNavigate(record.route as RouteId)}
            aria-label={t("liveStudio.back")}
          >
            <Icon name="arrowLeft" size={17} />
          </button>
        </KxTooltip>
        <div className="kx-live-heading">
          <div className="kx-live-title-row">
            <h1 className="kx-live-title">{record.title}</h1>
            <span className="kx-live-kind">{t(KIND_KEYS[record.kind] ?? "liveStudio.kindTool")}</span>
            <span className="kx-live-status" data-stage={record.stage}>
              <Icon name={stageMeta.icon} size={13} />
              {t(stageMeta.key)}
            </span>
          </div>
          <div className="kx-live-subline">
            <span className="kx-mono">
              {record.input?.fileName ?? artifact?.fileName ?? t("liveStudio.noInputFile")}
            </span>
            <span>·</span>
            <span>{routeLabel}</span>
            <span>·</span>
            <span className="kx-mono">
              {t("liveStudio.elapsed")} {formatDuration(elapsedSeconds)}
            </span>
          </div>
        </div>
        <div className="kx-live-actions">
          {active && record.kind !== "recording" && (
            <button
              type="button"
              className="kx-btn kx-btn-sm kx-btn-danger"
              onClick={() => cancelJob(record.id)}
            >
              <Icon name="x" size={14} />
              {t("toolbox.cancel")}
            </button>
          )}
          {active && record.kind === "recording" && recorder.status === "recording" && (
            <button
              type="button"
              className="kx-btn kx-btn-sm kx-btn-danger"
              onClick={() => void recorder.stop()}
            >
              <Icon name="stop" size={14} />
              {t("stop")}
            </button>
          )}
          {artifact && (
            <>
              <button type="button" className="kx-btn kx-btn-sm" onClick={() => void saveToLibrary()}>
                <Icon name="download" size={14} />
                {t("toolbox.saveToLibrary")}
              </button>
              <button
                type="button"
                className="kx-btn kx-btn-sm kx-btn-primary"
                onClick={() => downloadBlob(artifact.blob, artifact.fileName)}
              >
                <Icon name="export" size={14} />
                {t("export")}
              </button>
            </>
          )}
        </div>
      </header>

      <PanelGroup
        key={wide ? "wide" : "narrow"}
        className={wide ? "kx-live-grid" : "kx-live-grid kx-live-stacked"}
        orientation={wide ? "horizontal" : "vertical"}
      >
        <Panel
          defaultSize={wide ? "64" : "62"}
          minSize={wide ? "38" : "26"}
          className="kx-live-main-panel"
        >
        <div className="kx-live-main">
          <div className="kx-live-stage" ref={stageRef} data-fit={fit}>
            <div className="kx-live-stage-toolbar">
              {canZoom && (
                <>
                  <KxTooltip label={t("liveStudio.zoomOut")}>
                    <button
                      type="button"
                      className="kx-live-tool"
                      onClick={() => void zoomRef.current?.zoomOut(0.4)}
                      aria-label={t("liveStudio.zoomOut")}
                    >
                      −
                    </button>
                  </KxTooltip>
                  <span className="kx-live-zoom kx-mono">{zoomPercent}%</span>
                  <KxTooltip label={t("liveStudio.zoomIn")}>
                    <button
                      type="button"
                      className="kx-live-tool"
                      onClick={() => void zoomRef.current?.zoomIn(0.4)}
                      aria-label={t("liveStudio.zoomIn")}
                    >
                      +
                    </button>
                  </KxTooltip>
                  <KxTooltip label={t("liveStudio.resetZoom")}>
                    <button
                      type="button"
                      className="kx-live-tool"
                      onClick={() => zoomRef.current?.resetTransform(180)}
                      aria-label={t("liveStudio.resetZoom")}
                    >
                      <Icon name="refresh" size={13} />
                    </button>
                  </KxTooltip>
                </>
              )}
              <KxTooltip label={t("liveStudio.fit")}>
                <button
                  type="button"
                  className="kx-live-tool"
                  data-active={fit === "contain"}
                  onClick={() => setFit("contain")}
                >
                  {t("liveStudio.fit")}
                </button>
              </KxTooltip>
              <KxTooltip label={t("liveStudio.fill")}>
                <button
                  type="button"
                  className="kx-live-tool"
                  data-active={fit === "cover"}
                  onClick={() => setFit("cover")}
                >
                  {t("liveStudio.fill")}
                </button>
              </KxTooltip>
              <KxTooltip label={t("liveStudio.fullscreen")}>
                <button
                  type="button"
                  className="kx-live-tool"
                  onClick={goFullscreen}
                  aria-label={t("liveStudio.fullscreen")}
                >
                  <Icon name="expand" size={14} />
                </button>
              </KxTooltip>
            </div>
            <div className="kx-live-stage-body">{stageBody}</div>
          </div>

          <div className="kx-live-dock">
            <div className="kx-live-panel-title">
              <span>{t("liveStudio.dock")}</span>
              {artifact && (
                <span className="kx-live-verified">
                  <Icon name="check" size={13} />
                  {t("liveStudio.verified")}
                </span>
              )}
            </div>
            {artifact ? (
              <>
                <div className="kx-live-dock-grid">
                  <div>
                    <span className="kx-live-label">{t("liveStudio.format")}</span>
                    <span className="kx-mono">{artifact.mimeType}</span>
                  </div>
                  <div>
                    <span className="kx-live-label">{t("liveStudio.size")}</span>
                    <span className="kx-mono">{formatBytes(artifact.bytes)}</span>
                  </div>
                  {artifact.width && artifact.height ? (
                    <div>
                      <span className="kx-live-label">{t("liveStudio.dimensions")}</span>
                      <span className="kx-mono">
                        {artifact.width}×{artifact.height}
                      </span>
                    </div>
                  ) : null}
                  {typeof artifact.duration === "number" && artifact.duration > 0 ? (
                    <div>
                      <span className="kx-live-label">{t("liveStudio.duration")}</span>
                      <span className="kx-mono">{formatDuration(artifact.duration)}</span>
                    </div>
                  ) : null}
                  {typeof artifact.metrics.codec === "string" ? (
                    <div>
                      <span className="kx-live-label">{t("liveStudio.codec")}</span>
                      <span className="kx-mono">{String(artifact.metrics.codec)}</span>
                    </div>
                  ) : null}
                  <div>
                    <span className="kx-live-label">{t("liveStudio.fileName")}</span>
                    <span className="kx-mono">{artifact.fileName}</span>
                  </div>
                </div>
                <div className="kx-live-dock-actions">
                  <button type="button" className="kx-btn kx-btn-sm" onClick={() => void saveToLibrary()}>
                    {t("toolbox.saveToLibrary")}
                  </button>
                  <button
                    type="button"
                    className="kx-btn kx-btn-sm"
                    onClick={() => downloadBlob(artifact.blob, artifact.fileName)}
                  >
                    {t("toolbox.export")}
                  </button>
                  {record.request && (
                    <button type="button" className="kx-btn kx-btn-sm" onClick={retry}>
                      {t("toolbox.retry")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="kx-btn kx-btn-sm"
                    onClick={() => onNavigate(record.route as RouteId)}
                  >
                    {t("liveStudio.reopen")}
                  </button>
                </div>
              </>
            ) : (
              <p className="kx-card-sub">
                {record.stage === "error"
                  ? record.error ?? t("liveStudio.failed")
                  : record.stage === "cancelled"
                    ? t("liveStudio.cancelled")
                    : t("liveStudio.noResultYet")}
              </p>
            )}
          </div>
        </div>
        </Panel>

        <PanelResizeHandle className="kx-live-resize" />

        <Panel
          defaultSize={wide ? "36" : "38"}
          minSize={wide ? "22" : "18"}
          className="kx-live-side-panel"
        >
        <aside className="kx-live-side">
          <div className="kx-live-panel">
            <div className="kx-live-panel-title">
              <span>{t("liveStudio.jobs")}</span>
              <span className="kx-mono">{jobs.length}</span>
            </div>
            <div className="kx-live-jobs">
              {jobs.map((job) => {
                const meta = STAGE_META[job.stage] ?? STAGE_META.processing;
                return (
                  <button
                    key={job.id}
                    type="button"
                    className="kx-live-job"
                    data-selected={job.id === record.id}
                    onClick={() => selectJob(job.id)}
                  >
                    <Icon name={meta.icon} size={14} />
                    <span className="kx-live-job-title">{job.title}</span>
                    <span className="kx-live-job-stage">{t(meta.key)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="kx-live-panel">
            <div className="kx-live-panel-title">
              <span>{t("liveStudio.timeline")}</span>
            </div>
            <ol className="kx-live-timeline">
              {record.history.map((event, index) => (
                <li key={`${event.at}-${index}`} data-stage={event.stage}>
                  <span className="kx-live-timeline-dot" aria-hidden="true" />
                  <span className="kx-live-timeline-stage">{t(STAGE_META[event.stage]?.key ?? stageMeta.key)}</span>
                  <span className="kx-live-timeline-message">{event.message}</span>
                  <span className="kx-live-timeline-time kx-mono">
                    {relativeOffset(event.at, record.startedAt)}
                  </span>
                </li>
              ))}
              {active && (
                <li data-stage="active">
                  <span className="kx-live-timeline-dot" aria-hidden="true" />
                  <span className="kx-live-timeline-stage">{t(stageMeta.key)}</span>
                  <span className="kx-live-timeline-message">{record.message}</span>
                  <span className="kx-live-timeline-time kx-mono">
                    {relativeOffset(now, record.startedAt)}
                  </span>
                </li>
              )}
            </ol>
          </div>

          <div className="kx-live-panel">
            <div className="kx-live-panel-title">
              <span>{t("liveStudio.inspector")}</span>
            </div>
            <div className="kx-live-inspector">
              <span className="kx-live-label">{t("liveStudio.engine")}</span>
              <span className="kx-mono">
                {t(KIND_KEYS[record.kind] ?? "liveStudio.kindTool")} · {routeLabel}
              </span>
              {record.input?.mimeType && (
                <>
                  <span className="kx-live-label">{t("liveStudio.input")}</span>
                  <span className="kx-mono">
                    {record.input.mimeType}
                    {record.input.bytes ? ` · ${formatBytes(record.input.bytes)}` : ""}
                  </span>
                </>
              )}
              {record.input?.text && (
                <>
                  <span className="kx-live-label">{t("toolbox.text")}</span>
                  <span className="kx-live-param">{record.input.text}</span>
                </>
              )}
              {record.params && Object.keys(record.params).length > 0 && (
                <>
                  <span className="kx-live-label">{t("liveStudio.parameters")}</span>
                  <dl className="kx-live-params">
                    {Object.entries(record.params).map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd className="kx-mono">{paramValue(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}
              {artifact && artifact.logs.length > 0 && (
                <>
                  <span className="kx-live-label">{t("liveStudio.logs")}</span>
                  <ul className="kx-live-logs">
                    {artifact.logs.map((line, index) => (
                      <li key={index} className="kx-mono">
                        {line}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        </aside>
        </Panel>
      </PanelGroup>
    </section>
  );
}
