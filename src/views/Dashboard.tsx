import { useEffect, useMemo, useRef, useState } from "react";
import { useLibrary } from "../state/LibraryContext";
import { useRecorder } from "../state/RecorderContext";
import { useSettings } from "../state/SettingsContext";
import { useJobs } from "../state/JobsContext";
import { fill, translate } from "../i18n/translate";
import { CAPABILITIES, type RouteId } from "../app/capabilities";
import { Icon, type IconName } from "../app/icons";
import BrandMark from "../app/BrandMark";
import { EmptyState, PreviewDialog, StateBadge, Thumbnail } from "./ui";
import {
  FeaturedServices,
  HeroFeatureCards,
  MiniBars,
  RingGauge,
  RuledHeading,
  Sparkline,
  StorageBar,
} from "./dashboardWidgets";
import WorkflowChains from "./WorkflowChains";
import { LevelMeter } from "../ui/LevelMeter";
import { downloadBlob, formatBytes, formatDuration } from "../lib/format";
import { inspectModels, MODEL_IDS } from "../services/modelRegistry";
import { healthLabel, measureRuntimeHealth, type RuntimeHealth } from "../services/runtimeHealth";
import type { LibraryItem } from "../state/types";

function LivePreview({ stream }: { stream: MediaStream }) {
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

function relativeAge(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const JOB_STAGE_LABELS: Record<string, { key: string; icon: IconName }> = {
  validating: { key: "jobs.stageValidating", icon: "search" },
  processing: { key: "jobs.stageProcessing", icon: "activity" },
  verifying: { key: "jobs.stageVerifying", icon: "check" },
  done: { key: "jobs.done", icon: "check" },
  cancelled: { key: "jobs.cancelled", icon: "x" },
  error: { key: "jobs.error", icon: "alert" },
};

const QUICK_TOOLS: { route: RouteId; icon: IconName }[] = [
  { route: "templates", icon: "templates" },
  { route: "toolbox", icon: "toolbox" },
  { route: "visual-patch", icon: "patch" },
  { route: "offline-ai", icon: "brain" },
];

/**
 * The services the approved dashboard artwork puts on the front page. The
 * order is the artwork's order; the state on each card is read from the
 * capability registry, never hardcoded here.
 */
const FEATURED_ROUTES: RouteId[] = [
  "studio",
  "screenshots",
  "library",
  "templates",
  "toolbox",
  "audio-studio",
  "batch",
  "elysian",
  "morphcore",
  "visual-patch",
  "body-editor",
];

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function dayBuckets(items: LibraryItem[], now: number): number[] {
  const buckets = new Array(7).fill(0);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfWindow = startOfToday.getTime() - 6 * 24 * 60 * 60 * 1000;
  for (const item of items) {
    if (item.createdAt < startOfWindow || item.createdAt > now) continue;
    const day = Math.floor(
      (item.createdAt - startOfWindow) / (24 * 60 * 60 * 1000),
    );
    if (day >= 0 && day < 7) buckets[day] += 1;
  }
  return buckets;
}

/** Recorded seconds per day over the same seven-day window. */
function daySeconds(items: LibraryItem[], now: number): number[] {
  const buckets = new Array(7).fill(0);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfWindow = startOfToday.getTime() - 6 * 24 * 60 * 60 * 1000;
  for (const item of items) {
    if (item.kind !== "video") continue;
    if (item.createdAt < startOfWindow || item.createdAt > now) continue;
    const day = Math.floor(
      (item.createdAt - startOfWindow) / (24 * 60 * 60 * 1000),
    );
    if (day >= 0 && day < 7) buckets[day] += item.duration;
  }
  return buckets;
}

export default function Dashboard({
  onNavigate,
}: {
  onNavigate: (route: RouteId, jobId?: string) => void;
}) {
  const { items, urlFor } = useLibrary();
  const recorder = useRecorder();
  const { settings, updateRecorder } = useSettings();
  const { jobs, activeJobs } = useJobs();
  const t = (key: string) => translate(settings.language, key);
  const [preview, setPreview] = useState<LibraryItem | null>(null);
  const [templateOptions, setTemplateOptions] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [models, setModels] = useState<{
    checked: boolean;
    present: number;
    missing: number;
    total: number;
  }>({ checked: false, present: 0, missing: 0, total: MODEL_IDS.length });
  const [health, setHealth] = useState<RuntimeHealth | null>(null);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    void measureRuntimeHealth()
      .then((value) => {
        if (active) setHealth(value);
      })
      .catch(() => {
        if (active) setHealth(null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void navigator.storage
      ?.estimate?.()
      .then((estimate) => {
        if (!active) return;
        if (estimate && estimate.usage !== undefined && estimate.quota !== undefined) {
          setStorage({ usage: estimate.usage, quota: estimate.quota });
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const deadline = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), 4000),
    );
    void Promise.race([inspectModels(MODEL_IDS), deadline])
      .then((rows) => {
        if (!active) return;
        if (!rows) {
          setModels((previous) => ({ ...previous, checked: true }));
          return;
        }
        const present = rows.filter((row) => row.weightsState === "present").length;
        setModels({
          checked: true,
          present,
          missing: rows.length - present,
          total: rows.length,
        });
      })
      .catch(() => {
        if (active) setModels((previous) => ({ ...previous, checked: true }));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    // The motion-ident chain runs the same engine the Templates hub lists, so
    // the picker is filled from the real catalogue rather than a hard-coded id.
    void import("../../services/realTemplateEngine")
      .then((module) => {
        if (!active) return;
        const templates = module.realTemplateEngine.getAllTemplates() as Array<{
          id: string;
          name: string;
        }>;
        setTemplateOptions(templates.map((item) => ({ id: item.id, name: item.name })));
      })
      .catch(() => {
        if (active) setTemplateOptions([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const stats = useMemo(() => {
    const totalBytes = items.reduce((sum, item) => sum + item.size, 0);
    const totalSeconds = items
      .filter((item) => item.kind === "video")
      .reduce((sum, item) => sum + item.duration, 0);
    const last = items[0] ?? null;
    return { totalBytes, totalSeconds, last };
  }, [items]);

  const series = useMemo(() => dayBuckets(items, Date.now()), [items]);
  const secondsSeries = useMemo(() => daySeconds(items, Date.now()), [items]);

  const kindCounts = useMemo(
    () => ({
      video: items.filter((item) => item.kind === "video").length,
      image: items.filter((item) => item.kind === "image").length,
      audio: items.filter((item) => item.kind === "audio").length,
    }),
    [items],
  );

  const healthState = healthLabel(health?.score ?? null);

  const rendering = recorder.status === "recording" || recorder.status === "paused";
  const audioLive =
    (recorder.status === "recording" || recorder.status === "paused") &&
    recorder.mode === "audio";
  const busy = recorder.status === "requesting" || recorder.status === "stopping";
  const now = Date.now();
  const finishedJobs = jobs
    .filter((job) => job.stage === "done" || job.stage === "cancelled" || job.stage === "error")
    .slice(0, 4);

  return (
    <div className="kx-content">
      <section className="kx-hero">
        <div className="kx-hero-copy">
          <span className="kx-eyebrow">
            <span className="kx-status-dot" />
            {t("appTagline")}
          </span>
          <h1 className="kx-hero-title">
            {t("dashboard.heroTitle")}
            <br />
            <em>{t("dashboard.keepItLocal")}</em>
          </h1>
          <p className="kx-hero-desc">{t("dashboard.heroBody")}</p>
          <div className="kx-hero-actions">
            {rendering ? (
              <button
                type="button"
                className="kx-btn kx-btn-primary kx-btn-lg"
                onClick={() => onNavigate("studio")}
              >
                <Icon name="studio" size={18} />
                {t("dashboard.returnToRecorder")}
              </button>
            ) : (
              <button
                type="button"
                className="kx-btn kx-btn-primary kx-btn-lg"
                onClick={() => void recorder.start("screen")}
                disabled={!recorder.support.display}
              >
                <Icon name="play" size={18} />
                {t("startRecording")}
              </button>
            )}
            <button
              type="button"
              className="kx-btn kx-btn-lg"
              onClick={() => void recorder.takeScreenshot()}
              disabled={!recorder.support.display && !recorder.previewStream}
            >
              <Icon name="camera" size={18} />
              {t("captureScreenshot")}
            </button>
            {/* A standalone microphone take: no display surface, no camera,
                just the voice memo going straight into the library. */}
            <button
              type="button"
              className="kx-btn kx-btn-lg"
              data-dashboard-audio={audioLive ? "stop" : "start"}
              onClick={() => {
                if (audioLive) void recorder.stop();
                else void recorder.start("audio");
              }}
              disabled={busy || (recorder.status !== "idle" && !audioLive)}
            >
              <Icon name={audioLive ? "stop" : "audio"} size={18} />
              {audioLive
                ? `${t("dashboard.stopAudio")} · ${formatDuration(recorder.elapsed)}`
                : t("dashboard.startAudio")}
            </button>
          </div>
          <div className="kx-row kx-muted" style={{ fontSize: "0.74rem" }}>
            <Icon name="shield" size={14} />
            {t("dashboard.localFirstNote")}
          </div>
          <div className="kx-hero-chips">
            <span className="kx-hero-chip">
              <Icon name="shield" size={13} />
              {t("dashboard.chipLocalFirst")}
            </span>
            <span className="kx-hero-chip">
              <Icon name="hardDrive" size={13} />
              {t("dashboard.chipIndexedDb")}
            </span>
            <span className="kx-hero-chip">
              <Icon name="check" size={13} />
              {t("dashboard.chipNoAccount")}
            </span>
          </div>
        </div>

        <div className="kx-hero-side">
          <div className="kx-preview" data-state={recorder.status === "recording" ? "live" : undefined}>
            {audioLive ? (
              <div className="kx-preview-audio" data-audio-session>
                <BrandMark size={56} />
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
              </div>
            ) : recorder.previewStream ? (
              <>
                <LivePreview stream={recorder.previewStream} />
                <div className="kx-preview-overlay">
                  {recorder.status === "recording" && <span className="kx-rec-dot" />}
                  <span>{recorder.status === "paused" ? t("paused") : t("recording")}</span>
                  <time>{formatDuration(recorder.elapsed)}</time>
                </div>
              </>
            ) : (
              <div className="kx-preview-idle">
                <BrandMark size={78} />
                <div style={{ fontFamily: "var(--kx-font-display)", letterSpacing: "0.2em" }}>
                  KNOUX REC
                </div>
                <div>{t("previewIdle")}</div>
                <div className="kx-row" style={{ justifyContent: "center", marginTop: 6 }}>
                  <span className="kx-badge" data-state={recorder.support.display ? "VERIFIED" : "BLOCKED"}>
                    {recorder.support.display
                      ? t("dashboard.displayReady")
                      : t("dashboard.displayBlocked")}
                  </span>
                  <span className="kx-badge" data-state={recorder.support.mediaRecorder ? "VERIFIED" : "BLOCKED"}>
                    {recorder.support.mediaRecorder
                      ? t("dashboard.mediaRecorderReady")
                      : t("dashboard.noMediaRecorder")}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="kx-hero-rail">
          <HeroFeatureCards onNavigate={onNavigate} t={t} />
        </div>
      </section>

      <section className="kx-grid kx-grid-metrics">
        <div className="kx-stat kx-stat-metric">
          <span className="kx-stat-label">
            <Icon name="layers" size={14} /> {t("totalCaptures")}
          </span>
          <span className="kx-stat-value">{items.length}</span>
          <span className="kx-stat-hint">
            {fill(t("dashboard.kindHint"), {
              video: String(kindCounts.video),
              image: String(kindCounts.image),
              audio: String(kindCounts.audio),
            })}
          </span>
          <Sparkline values={series} label={t("dashboard.capturesSeries")} />
          <span className="kx-stat-foot">{t("dashboard.last7Days")}</span>
        </div>

        <div className="kx-stat kx-stat-metric">
          <span className="kx-stat-label">
            <Icon name="hardDrive" size={14} /> {t("storageUsed")}
          </span>
          <span className="kx-stat-value">{formatBytes(stats.totalBytes)}</span>
          <StorageBar
            used={storage?.usage ?? stats.totalBytes}
            quota={storage?.quota ?? null}
          />
          <span className="kx-stat-hint">
            {storage
              ? fill(t("dashboard.quotaHint"), {
                  used: formatBytes(storage.usage),
                  quota: formatBytes(storage.quota),
                })
              : t("dashboard.quotaUnknown")}
          </span>
        </div>

        <div className="kx-stat kx-stat-metric">
          <span className="kx-stat-label">
            <Icon name="clock" size={14} /> {t("totalDuration")}
          </span>
          <span className="kx-stat-value">{formatDuration(stats.totalSeconds)}</span>
          <MiniBars
            values={secondsSeries}
            labels={DAY_LABELS}
            caption={t("dashboard.capturesSeries")}
          />
          <span className="kx-stat-hint">{t("dashboard.sumOfClips")}</span>
        </div>

        <div className="kx-stat kx-stat-metric">
          <span className="kx-stat-label">
            <Icon name="library" size={14} /> {t("dashboard.libraryItems")}
          </span>
          <span className="kx-stat-value">{items.length}</span>
          <MiniBars
            values={[kindCounts.video, kindCounts.image, kindCounts.audio]}
            labels={["VID", "IMG", "AUD"]}
            caption={t("dashboard.kindSeries")}
          />
          <span className="kx-stat-hint">{t("dashboard.libraryItemsHint")}</span>
        </div>

        <div className="kx-stat kx-stat-metric" data-tone={healthState}>
          <span className="kx-stat-label">
            <Icon name="activity" size={14} /> {t("dashboard.health")}
          </span>
          <div className="kx-stat-health">
            <RingGauge
              score={health?.score ?? null}
              caption={t("dashboard.health")}
              tone={
                healthState === "optimal"
                  ? "ok"
                  : healthState === "degraded"
                    ? "warn"
                    : "unknown"
              }
            />
            <span className="kx-stat-health-text">
              <strong>
                {healthState === "optimal"
                  ? t("dashboard.healthOptimal")
                  : healthState === "degraded"
                    ? t("dashboard.healthDegraded")
                    : t("dashboard.healthUnknown")}
              </strong>
              <span className="kx-stat-hint">
                {health
                  ? health.checks.every((check) => check.state === "ok")
                    ? t("dashboard.healthAllReady")
                    : t("dashboard.healthChecksNeedAttention").replace(
                        "{count}",
                        String(
                          health.checks.filter((check) => check.state !== "ok").length,
                        ),
                      )
                  : t("dashboard.modelsChecking")}
              </span>
            </span>
          </div>
        </div>
      </section>

      <section>
        <RuledHeading
          title={t("dashboard.featuredServices")}
          description={t("dashboard.featuredServicesDesc")}
          action={
            <button
              type="button"
              className="kx-btn kx-btn-sm"
              onClick={() => onNavigate("discover")}
            >
              {t("dashboard.viewAllTools")}
              <Icon name="chevronRight" size={15} />
            </button>
          }
        />
        <FeaturedServices onNavigate={onNavigate} routes={FEATURED_ROUTES} t={t} />
      </section>

      <section className="kx-card">
        <div className="kx-row-between">
          <div className="kx-card-title">
            <span>{t("jobs.title")}</span>
            {activeJobs.length > 0 && (
              <span className="kx-badge" data-state="LIVE">
                {activeJobs.length}
              </span>
            )}
          </div>
          <button type="button" className="kx-btn kx-btn-sm" onClick={() => onNavigate("toolbox")}>
            {t("jobs.runTool")}
            <Icon name="chevronRight" size={15} />
          </button>
        </div>

        {jobs.length === 0 ? (
          <p className="kx-card-sub" style={{ marginTop: 10 }}>
            {t("jobs.noneHint")}
          </p>
        ) : (
          <div className="kx-jobs-list" style={{ marginTop: 12 }}>
            {activeJobs.map((job) => {
              const stage = JOB_STAGE_LABELS[job.stage] ?? JOB_STAGE_LABELS.processing;
              return (
                <button
                  type="button"
                  className="kx-job-row"
                  data-active="true"
                  key={job.id}
                  onClick={() => onNavigate("live-studio", job.id)}
                  title={t("jobs.openWorkspace")}
                >
                  <span className="kx-job-icon">
                    <Icon name={stage.icon} size={15} />
                  </span>
                  <span className="kx-job-tool">{job.title}</span>
                  <span className="kx-job-stage">{t(stage.key)}</span>
                  <span className="kx-job-progress" aria-hidden="true">
                    <span
                      data-indeterminate={job.progress === null}
                      style={
                        job.progress === null
                          ? undefined
                          : {
                              width: `${Math.round(Math.min(1, Math.max(0, job.progress)) * 100)}%`,
                            }
                      }
                    />
                  </span>
                  <span className="kx-job-age kx-mono">
                    {relativeAge(job.startedAt, now)}
                  </span>
                </button>
              );
            })}
            {finishedJobs.map((job) => {
              const stage = JOB_STAGE_LABELS[job.stage] ?? JOB_STAGE_LABELS.done;
              return (
                <button
                  type="button"
                  className="kx-job-row"
                  key={job.id}
                  onClick={() => onNavigate("live-studio", job.id)}
                  title={t("jobs.openWorkspace")}
                >
                  <span className="kx-job-icon">
                    <Icon name={stage.icon} size={15} />
                  </span>
                  <span className="kx-job-tool">{job.title}</span>
                  <span className="kx-job-stage">{t(stage.key)}</span>
                  <span className="kx-job-age kx-mono">
                    {relativeAge(job.finishedAt ?? job.startedAt, now)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="kx-card">
        <div className="kx-row-between">
          <div>
            <div className="kx-card-title">{t("recent")}</div>
            <p className="kx-card-sub">
              {t("dashboard.blobsReadBack")}
            </p>
          </div>
          <button type="button" className="kx-btn kx-btn-sm" onClick={() => onNavigate("library")}>
            {t("viewAll")}
            <Icon name="chevronRight" size={15} />
          </button>
        </div>

        {items.length === 0 ? (
          <div style={{ marginTop: 16 }}>
            <EmptyState
              icon="folder"
              title={t("emptyLibrary")}
              hint={t("emptyLibraryHint")}
              action={
                <button
                  type="button"
                  className="kx-btn kx-btn-primary"
                  onClick={() => void recorder.start("screen")}
                  disabled={!recorder.support.display}
                >
                  <Icon name="play" size={16} />
                  {t("startRecording")}
                </button>
              }
            />
          </div>
        ) : (
          <div className="kx-media-grid" style={{ marginTop: 16 }}>
            {items.slice(0, 7).map((item) => (
              <article className="kx-media-card" key={item.id}>
                <button
                  type="button"
                  className="kx-media-thumb"
                  onClick={() => setPreview(item)}
                  aria-label={`Preview ${item.name}`}
                >
                  <Thumbnail item={item} url={urlFor(item.id)} />
                  {item.kind === "video" && (
                    <span className="kx-media-duration">{formatDuration(item.duration)}</span>
                  )}
                </button>
                <div className="kx-media-body">
                  <span className="kx-media-name" title={item.name}>
                    {item.name}
                  </span>
                  <span className="kx-media-meta">
                    <span>{formatBytes(item.size)}</span>
                    <span>{item.kind}</span>
                    <span>{item.source}</span>
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="kx-grid kx-grid-2">
        <div className="kx-card">
          <div className="kx-card-title">
            <span>{t("recordingSettings")}</span>
            <Icon name="studio" size={18} />
          </div>
          <p className="kx-card-sub">
            {t("dashboard.defaultsNote")}
          </p>

          <div className="kx-col" style={{ marginTop: 14 }}>
            <div className="kx-field">
              <span className="kx-label">{t("quality")}</span>
              <div className="kx-segmented">
                {([720, 1080, 1440, 2160] as const).map((quality) => (
                  <button
                    key={quality}
                    type="button"
                    aria-pressed={settings.recorder.quality === quality}
                    onClick={() => updateRecorder({ quality })}
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
                  >
                    {fps} fps
                  </button>
                ))}
              </div>
            </div>

            <div className="kx-row" style={{ gap: 18 }}>
              <label className="kx-switch">
                <input
                  type="checkbox"
                  checked={settings.recorder.systemAudio}
                  onChange={(event) => updateRecorder({ systemAudio: event.target.checked })}
                />
                <span className="kx-switch-track" />
                <span className="kx-switch-label">{t("systemAudio")}</span>
              </label>
              <label className="kx-switch">
                <input
                  type="checkbox"
                  checked={settings.recorder.microphone}
                  onChange={(event) => updateRecorder({ microphone: event.target.checked })}
                />
                <span className="kx-switch-track" />
                <span className="kx-switch-label">{t("microphone")}</span>
              </label>
            </div>
          </div>
        </div>

        <div className="kx-col">
          <div className="kx-grid kx-grid-2">
            {QUICK_TOOLS.map(({ route, icon }) => {
              const capability = CAPABILITIES[route];
              return (
                <button
                  key={route}
                  type="button"
                  className="kx-tool-card"
                  onClick={() => onNavigate(route)}
                >
                  <span className="kx-tool-icon">
                    <Icon name={icon} size={22} />
                  </span>
                  <span className="kx-tool-name">{t(capability.labelKey)}</span>
                  <span className="kx-tool-desc">{capability.summary}</span>
                  <span className="kx-tool-foot">
                    <StateBadge state={capability.state} />
                  </span>
                </button>
              );
            })}
          </div>
          <div className="kx-card">
            <div className="kx-row-between">
              <div className="kx-card-title">
                <span>{t("dashboard.modelsTitle")}</span>
                <Icon name="models" size={17} />
              </div>
              <button
                type="button"
                className="kx-btn kx-btn-quiet kx-btn-sm"
                onClick={() => onNavigate("models")}
              >
                {t("viewAll")}
              </button>
            </div>
            {models.checked ? (
              <div className="kx-models-meter" style={{ marginTop: 12 }}>
                <span className="kx-models-meter-label kx-mono">
                  {models.present}/{models.total} {t("dashboard.modelsUnits")}
                </span>
                <span className="kx-models-meter-track" aria-hidden="true">
                  <span
                    className="kx-models-meter-fill"
                    style={{
                      width: `${models.total === 0 ? 0 : Math.round((models.present / models.total) * 100)}%`,
                    }}
                  />
                </span>
                <p className="kx-card-sub" style={{ marginTop: 8 }}>
                  {models.present > 0
                    ? t("dashboard.modelsPartial")
                    : t("dashboard.modelsNone")}
                </p>
              </div>
            ) : (
              <p className="kx-card-sub" style={{ marginTop: 12 }}>
                {t("dashboard.modelsChecking")}
              </p>
            )}
          </div>
          <div className="kx-notice" data-tone="warn">
            <Icon name="info" size={18} />
            <div>
              <strong>{t("dashboard.aiGated")}</strong> {t("dashboard.aiGatedBody")}{" "}
              {t("dashboard.aiGatedSee")}{" "}
              <button
                type="button"
                className="kx-btn kx-btn-quiet kx-btn-sm"
                style={{ height: "auto", padding: 0, display: "inline" }}
                onClick={() => onNavigate("diagnostics")}
              >
                {t("diag.title")}
              </button>
              .
            </div>
          </div>
        </div>
      </section>

      <WorkflowChains templateOptions={templateOptions} />

      <PreviewDialog
        item={preview}
        url={preview ? urlFor(preview.id) : null}
        onClose={() => setPreview(null)}
        onExport={(item) => downloadBlob(item.blob, item.name)}
      />
    </div>
  );
}
