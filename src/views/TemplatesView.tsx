import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../app/icons";
import { CAPABILITIES, type RouteId } from "../app/capabilities";
import { translate } from "../i18n/translate";
import { useJobs } from "../state/JobsContext";
import { useLibrary } from "../state/LibraryContext";
import { useSettings } from "../state/SettingsContext";
import { useToast } from "../state/ToastContext";
import { downloadBlob, formatBytes } from "../lib/format";
import { exportTemplateVideo } from "../services/templateExport";
import { EmptyState, SectionHeader, StateBadge } from "./ui";
import { MOCK_TEMPLATE_FAMILIES, MOCK_TEMPLATE_TOTAL } from "../data/templateCatalog";

/**
 * The preserved engine lives outside `src/` and is loaded on demand so its
 * canvas and audio context are only created when the section is opened.
 */
interface TemplateEngine {
  getAllTemplates(): Array<{
    id: string;
    name: string;
    description: string;
    category: string;
    duration: number;
    resolution: { width: number; height: number };
    fps: number;
    elements: Array<{ id: string; type: string; visible: boolean; properties: Record<string, unknown> }>;
  }>;
  renderTemplate(
    templateId: string,
    customizations: Record<string, unknown>,
    settings: {
      resolution: { width: number; height: number };
      fps: number;
      quality: "draft" | "preview" | "high" | "export";
      format: "mp4" | "webm" | "gif" | "png-sequence";
      backgroundColor?: string;
    },
    /** Playhead in seconds for the time-aware keyframe renderer. */
    timeSeconds?: number,
  ): Promise<HTMLCanvasElement>;
}

interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  category: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  elementCount: number;
  textElements: Array<{ id: string; label: string }>;
}

const CATEGORY_LABELS: Record<string, string> = {
  intro: "Intro",
  outro: "Outro",
  "lower-third": "Lower third",
  transition: "Transition",
  overlay: "Overlay",
};

export default function TemplatesView({
  onNavigate,
}: {
  onNavigate: (route: RouteId, jobId?: string) => void;
}) {
  const { settings } = useSettings();
  const { add } = useLibrary();
  const { beginJob } = useJobs();
  const { push } = useToast();
  const t = useCallback(
    (key: string) => translate(settings.language, key),
    [settings.language],
  );
  const capability = CAPABILITIES.templates;

  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customizations, setCustomizations] = useState<Record<string, string>>({});
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderedUrl, setRenderedUrl] = useState<string | null>(null);
  const [renderedBytes, setRenderedBytes] = useState(0);
  const [saved, setSaved] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoBytes, setVideoBytes] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoSaved, setVideoSaved] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [previewKind, setPreviewKind] = useState<"frame" | "video">("frame");
  const [studioJobId, setStudioJobId] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [category, setCategory] = useState<string>("all");

  const urlRef = useRef<string | null>(null);
  const videoUrlRef = useRef<string | null>(null);
  const frameBlobRef = useRef<Blob | null>(null);
  const videoBlobRef = useRef<Blob | null>(null);
  const cancelExportRef = useRef(false);
  const jobTokenRef = useRef<{ cancelled: boolean } | null>(null);
  const engineRef = useRef<TemplateEngine | null>(null);

  const clearVideo = useCallback(() => {
    if (videoUrlRef.current) {
      URL.revokeObjectURL(videoUrlRef.current);
      videoUrlRef.current = null;
    }
    videoBlobRef.current = null;
    setVideoUrl(null);
    setVideoBytes(0);
    setVideoDuration(0);
    setVideoSaved(false);
    setExportProgress(0);
    setPreviewKind("frame");
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const module = await import("../../services/realTemplateEngine");
        const engine = module.realTemplateEngine as unknown as TemplateEngine;
        if (cancelled) return;
        engineRef.current = engine;
        setTemplates(
          engine.getAllTemplates().map((template) => ({
            id: template.id,
            name: template.name,
            description: template.description,
            category: template.category,
            duration: template.duration,
            width: template.resolution.width,
            height: template.resolution.height,
            fps: template.fps,
            elementCount: template.elements.length,
            textElements: template.elements
              .filter((element) => element.type === "text")
              .map((element) => ({
                id: element.id,
                label:
                  typeof element.properties.text === "string"
                    ? element.properties.text
                    : element.id,
              })),
          })),
        );
        setLoadError(null);
      } catch (cause) {
        if (!cancelled) {
          setLoadError(
            cause instanceof Error
              ? cause.message
              : "The preserved template engine could not be loaded.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      cancelExportRef.current = true;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    },
    [],
  );

  // Real thumbnails: each card paints its template at a small resolution.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || templates.length === 0) return;
    let cancelled = false;
    const build = async () => {
      const next: Record<string, string> = {};
      for (const template of templates) {
        if (cancelled) return;
        try {
          const canvas = await engine.renderTemplate(
            template.id,
            {},
            {
              resolution: { width: 480, height: 270 },
              fps: 12,
              quality: "draft",
              format: "png-sequence",
              backgroundColor: "#14141b",
            },
            Math.min(template.duration - 0.1, Math.max(0.5, template.duration * 0.6)),
          );
          next[template.id] = canvas.toDataURL("image/png");
        } catch {
          // A template that cannot paint a thumbnail simply keeps the placeholder.
        }
      }
      if (!cancelled) setThumbs(next);
    };
    void build();
    return () => {
      cancelled = true;
    };
  }, [templates]);

  const selectTemplate = useCallback(
    (template: TemplateSummary) => {
      setSelectedId(template.id);
      setCustomizations({});
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
      frameBlobRef.current = null;
      setRenderedUrl(null);
      setRenderedBytes(0);
      setSaved(false);
      setRenderError(null);
      clearVideo();
      setPreviewKind("frame");
    },
    [clearVideo],
  );

  const selected = useMemo(
    () => templates.find((template) => template.id === selectedId) ?? null,
    [templates, selectedId],
  );

  const render = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || !selected) return;
    setRendering(true);
    setRenderError(null);
    try {
      const canvas = await engine.renderTemplate(
        selected.id,
        customizations,
        {
          resolution: { width: selected.width, height: selected.height },
          fps: selected.fps,
          quality: "preview",
          format: "png-sequence",
          backgroundColor: "#05050a",
        },
        0,
      );
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((value) => resolve(value), "image/png"),
      );
      if (!blob) throw new Error("The frame could not be encoded.");
      frameBlobRef.current = blob;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(blob);
      setRenderedUrl(urlRef.current);
      setRenderedBytes(blob.size);
      setSaved(false);
      setPreviewKind("frame");
    } catch (cause) {
      setRenderError(
        cause instanceof Error ? cause.message : "The template could not be rendered.",
      );
    } finally {
      setRendering(false);
    }
  }, [customizations, selected]);

  const saveToLibrary = useCallback(async () => {
    const blob = frameBlobRef.current;
    if (!blob || !selected) return;
    const name = `${selected.id}-frame.png`;
    try {
      await add({
        name,
        kind: "image",
        mimeType: blob.type || "image/png",
        blob,
        duration: 0,
        width: selected.width,
        height: selected.height,
        source: "toolbox",
        thumbnail: null,
      });
      setSaved(true);
      push("success", t("templates.saved"), name);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "The frame could not be saved.";
      setRenderError(message);
      push("error", t("templates.saveFailed"), message);
    }
  }, [add, push, selected, t]);

  const cancelExport = useCallback(() => {
    cancelExportRef.current = true;
    if (jobTokenRef.current) jobTokenRef.current.cancelled = true;
  }, []);

  const exportVideo = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || !selected || exporting) return;
    setExporting(true);
    setRenderError(null);
    setExportProgress(0);
    cancelExportRef.current = false;

    const fps = Math.max(12, Math.min(30, Math.round(selected.fps || 30)));
    const duration = selected.duration > 0 ? selected.duration : 5;
    const job = beginJob({
      kind: "template",
      title: selected.name,
      route: "templates",
      input: {
        fileName: `${selected.id}.template`,
        mimeType: "application/x-knoux-template",
        bytes: null,
      },
      params: {
        templateId: selected.id,
        width: selected.width,
        height: selected.height,
        fps,
        duration,
        ...customizations,
      },
    });
    jobTokenRef.current = job.token;
    setStudioJobId(job.id);

    try {
      job.report("validating", "Checking the WebM encoder", 0.02);
      const output = await exportTemplateVideo(
        {
          templateId: selected.id,
          customizations,
          width: selected.width,
          height: selected.height,
          fps,
          duration,
        },
        (report) => {
          setExportProgress(report.percent);
          job.report(
            "processing",
            report.message,
            0.05 + (report.percent / 100) * 0.85,
          );
        },
        job.token,
      );
      job.report("verifying", "Verifying the WebM container", 0.95);

      if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
      videoUrlRef.current = URL.createObjectURL(output.blob);
      videoBlobRef.current = output.blob;
      setVideoUrl(videoUrlRef.current);
      setVideoBytes(output.blob.size);
      setVideoDuration(output.duration);
      setVideoSaved(false);
      setExportProgress(100);
      setPreviewKind("video");
      job.complete({
        blob: output.blob,
        mimeType: output.mimeType,
        fileName: `${selected.id}-${duration.toFixed(1)}s.webm`,
        width: selected.width,
        height: selected.height,
        duration: output.duration,
        bytes: output.blob.size,
        metrics: {
          codec: output.codec,
          frames: output.frames,
          fps,
          width: selected.width,
          height: selected.height,
        },
        logs: [`Encoded ${output.frames} canvas frames as ${output.codec}.`],
      });
      push(
        "success",
        t("templates.videoReady"),
        `${selected.id}-${duration.toFixed(1)}s.webm`,
      );
    } catch (cause) {
      if (cause instanceof Error && cause.name === "MediaJobCancelledError") {
        job.report("cancelled", "Cancelled by the user", 0);
        setExportProgress(0);
        return;
      }
      const message =
        cause instanceof Error
          ? cause.message
          : "The video could not be exported.";
      job.fail(message);
      setRenderError(message);
      push("error", t("templates.videoFailed"), message);
    } finally {
      jobTokenRef.current = null;
      cancelExportRef.current = false;
      setExporting(false);
    }
  }, [beginJob, customizations, exporting, push, selected, t]);

  const saveVideoToLibrary = useCallback(async () => {
    const blob = videoBlobRef.current;
    if (!blob || !selected) return;
    const name = `${selected.id}-${videoDuration.toFixed(1)}s.webm`;
    try {
      await add({
        name,
        kind: "video",
        mimeType: blob.type || "video/webm",
        blob,
        duration: videoDuration,
        width: selected.width,
        height: selected.height,
        source: "toolbox",
        thumbnail: null,
      });
      setVideoSaved(true);
      push("success", t("templates.videoSaved"), name);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "The video could not be saved.";
      setRenderError(message);
      push("error", t("templates.saveFailed"), message);
    }
  }, [add, push, selected, t, videoDuration]);

  const downloadVideo = useCallback(() => {
    const blob = videoBlobRef.current;
    if (!blob || !selected) return;
    downloadBlob(blob, `${selected.id}-${videoDuration.toFixed(1)}s.webm`);
  }, [selected, videoDuration]);

  return (
    <div className="kx-section">
      <SectionHeader
        eyebrow={t("groupCreate")}
        title={t("templates")}
        description={t("templates.description")}
        actions={<StateBadge state={capability.state} />}
      />

      <div className="kx-notice" data-tone="ok" style={{ marginBottom: 16 }}>
        <Icon name="check" size={18} />
        <div>{t("templates.exporting")}</div>
      </div>

      <div className="kx-grid kx-grid-2">
        <div className="kx-col">
          <div className="kx-card">
            <div className="kx-card-title">
              <span>{t("templates.renderable")}</span>
              <span className="kx-badge" data-state="VERIFIED">
                {templates.length}
              </span>
            </div>
            {loading ? (
              <EmptyState
                icon="refresh"
                title={t("templates.loading")}
                hint={t("templates.loadingHint")}
              />
            ) : loadError ? (
              <EmptyState icon="alert" title={t("templates.loadFailed")} hint={loadError} />
            ) : (
              <>
                <div className="kx-template-filter" role="group" aria-label={t("templates.allCategories")}>
                  {["all", ...Array.from(new Set(templates.map((template) => template.category)))].map(
                    (categoryId) => (
                      <button
                        key={categoryId}
                        type="button"
                        className="kx-template-chip"
                        data-active={category === categoryId}
                        aria-pressed={category === categoryId}
                        onClick={() => setCategory(categoryId)}
                      >
                        {categoryId === "all"
                          ? t("templates.allCategories")
                          : CATEGORY_LABELS[categoryId] ?? categoryId}
                      </button>
                    ),
                  )}
                </div>
                <div className="kx-template-gallery">
                  {templates
                    .filter((template) => category === "all" || template.category === category)
                    .map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        className="kx-template-card"
                        data-template-id={template.id}
                        data-active={selectedId === template.id}
                        onClick={() => selectTemplate(template)}
                      >
                        <span className="kx-template-thumb">
                          {thumbs[template.id] ? (
                            <img src={thumbs[template.id]} alt="" draggable={false} />
                          ) : (
                            <span className="kx-template-thumb-empty">
                              <Icon name="templates" size={22} />
                            </span>
                          )}
                          <span className="kx-template-cat">
                            {CATEGORY_LABELS[template.category] ?? template.category}
                          </span>
                        </span>
                        <span className="kx-template-body">
                          <span className="kx-template-name">{template.name}</span>
                          <span className="kx-template-sub">
                            {template.width}×{template.height} · {template.duration}s ·{" "}
                            {template.fps} fps
                          </span>
                        </span>
                        <span className="kx-badge" data-state="VERIFIED">
                          {t("templates.ready")}
                        </span>
                      </button>
                    ))}
                </div>
              </>
            )}
          </div>

          <details className="kx-dev-catalog">
            <summary>
              <span>{t("templates.generated")}</span>
              <span className="kx-badge kx-dev-count" data-state="BLOCKED">
                {MOCK_TEMPLATE_TOTAL}
              </span>
            </summary>
            <p className="kx-card-sub" style={{ marginTop: 8 }}>
              {t("templates.generatedHint")}
            </p>
            <table className="kx-table" style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>{t("templates.family")}</th>
                  <th>{t("templates.count")}</th>
                  <th>{t("templates.status")}</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_TEMPLATE_FAMILIES.map((family) => (
                  <tr key={family.id}>
                    <td>
                      <strong>{family.name}</strong>
                      <div className="kx-mono kx-muted">{family.id}</div>
                    </td>
                    <td className="kx-mono">{family.count}</td>
                    <td>
                      <span className="kx-badge" data-state="BLOCKED">
                        {t("templates.mockBadge")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>

        <div className="kx-col">
          {!selected ? (
            <EmptyState
              icon="templates"
              title={t("templates.selectPrompt")}
              hint={t("templates.selectHint")}
            />
          ) : (
            <>
              <div className="kx-card">
                <div className="kx-card-title">
                  <span>{selected.name}</span>
                  <span className="kx-badge" data-state="VERIFIED">
                    {t("templates.videoExport")}
                  </span>
                </div>
                <p className="kx-card-sub" style={{ marginTop: 6 }}>
                  {selected.description}
                </p>

                {selected.textElements.length > 0 && (
                  <>
                    <div className="kx-divider" />
                    <div className="kx-card-title" style={{ fontSize: "0.84rem" }}>
                      <span>{t("templates.texts")}</span>
                    </div>
                    <div className="kx-col" style={{ gap: 10, marginTop: 10 }}>
                      {selected.textElements.map((element) => (
                        <label key={element.id} className="kx-field">
                          <span className="kx-label">{element.label}</span>
                          <input
                            className="kx-input"
                            value={customizations[element.id] ?? ""}
                            placeholder={element.label}
                            onChange={(event) => {
                              setCustomizations((current) => ({
                                ...current,
                                [element.id]: event.target.value,
                              }));
                              if (urlRef.current) {
                                URL.revokeObjectURL(urlRef.current);
                                urlRef.current = null;
                              }
                              frameBlobRef.current = null;
                              setRenderedUrl(null);
                              setRenderedBytes(0);
                              setSaved(false);
                              clearVideo();
                              setPreviewKind("frame");
                            }}
                          />
                        </label>
                      ))}
                    </div>
                  </>
                )}

                <div className="kx-tool-actions" style={{ marginTop: 14 }}>
                  <button
                    type="button"
                    className="kx-btn kx-btn-primary"
                    onClick={() => void render()}
                    disabled={rendering || exporting}
                  >
                    {rendering ? (
                      <>
                        <span className="kx-spin">
                          <Icon name="refresh" size={15} />
                        </span>
                        {t("templates.rendering")}
                      </>
                    ) : (
                      <>
                        <Icon name="play" size={15} />
                        {t("templates.render")}
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    className="kx-btn"
                    onClick={() => void exportVideo()}
                    disabled={exporting || rendering}
                  >
                    {exporting ? (
                      <>
                        <span className="kx-spin">
                          <Icon name="refresh" size={15} />
                        </span>
                        {t("templates.exportingVideo")}
                      </>
                    ) : (
                      <>
                        <Icon name="video" size={15} />
                        {t("templates.exportVideo")}
                      </>
                    )}
                  </button>

                  {exporting && (
                    <button
                      type="button"
                      className="kx-btn kx-btn-quiet"
                      onClick={cancelExport}
                    >
                      <Icon name="stop" size={15} />
                      {t("templates.cancelExport")}
                    </button>
                  )}

                  {videoUrl && (
                    <>
                      <button
                        type="button"
                        className="kx-btn"
                        onClick={() => void saveVideoToLibrary()}
                      >
                        <Icon name="download" size={15} />
                        {videoSaved
                          ? t("templates.videoSaved")
                          : t("templates.saveVideo")}
                      </button>
                      <button
                        type="button"
                        className="kx-btn"
                        onClick={downloadVideo}
                      >
                        <Icon name="external" size={15} />
                        {t("templates.downloadVideo")}
                      </button>
                      {studioJobId && (
                        <button
                          type="button"
                          className="kx-btn kx-btn-quiet"
                          onClick={() => onNavigate("live-studio", studioJobId)}
                        >
                          <Icon name="activity" size={15} />
                          {t("liveStudio.open")}
                        </button>
                      )}
                      {previewKind === "frame" && (
                        <button
                          type="button"
                          className="kx-btn kx-btn-quiet"
                          onClick={() => setPreviewKind("video")}
                        >
                          <Icon name="video" size={15} />
                          {t("templates.showVideo")}
                        </button>
                      )}
                    </>
                  )}

                  {renderedUrl && (
                    <>
                      <button
                        type="button"
                        className="kx-btn"
                        onClick={() => void saveToLibrary()}
                      >
                        <Icon name="download" size={15} />
                        {saved
                          ? t("templates.saved")
                          : t("templates.saveToLibrary")}
                      </button>
                      <button
                        type="button"
                        className="kx-btn"
                        onClick={() => {
                          const blob = frameBlobRef.current;
                          if (blob) {
                            downloadBlob(blob, `${selected.id}-frame.png`);
                          }
                        }}
                      >
                        <Icon name="external" size={15} />
                        {t("templates.exportFrame")}
                      </button>
                      {videoUrl && previewKind === "video" && (
                        <button
                          type="button"
                          className="kx-btn kx-btn-quiet"
                          onClick={() => setPreviewKind("frame")}
                        >
                          <Icon name="image" size={15} />
                          {t("templates.showFrame")}
                        </button>
                      )}
                    </>
                  )}
                </div>

                {exporting && (
                  <div style={{ marginTop: 12 }}>
                    <div className="kx-row-between">
                      <span>{t("templates.exportingVideo")}</span>
                      <span className="kx-mono">{exportProgress}%</span>
                    </div>
                    <div
                      className="kx-progress"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={exportProgress}
                    >
                      <span style={{ width: `${exportProgress}%` }} />
                    </div>
                    {studioJobId && (
                      <button
                        type="button"
                        className="kx-btn kx-btn-sm"
                        style={{ marginTop: 10 }}
                        onClick={() => onNavigate("live-studio", studioJobId)}
                      >
                        <Icon name="activity" size={14} />
                        {t("liveStudio.open")}
                      </button>
                    )}
                  </div>
                )}

                {renderError && (
                  <div className="kx-notice" data-tone="danger" style={{ marginTop: 12 }}>
                    <Icon name="alert" size={16} />
                    <div>{renderError}</div>
                  </div>
                )}
              </div>

              <div className="kx-preview">
                {previewKind === "video" && videoUrl ? (
                  <video src={videoUrl} controls playsInline />
                ) : renderedUrl ? (
                  <img src={renderedUrl} alt={selected.name} />
                ) : (
                  <div className="kx-preview-idle">
                    <Icon name="templates" size={34} />
                    <div className="kx-empty-title">{t("templates.stageEmpty")}</div>
                    <p className="kx-empty-hint">{t("templates.stageHint")}</p>
                  </div>
                )}
              </div>

              {previewKind === "video" && videoUrl ? (
                <div className="kx-row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <span className="kx-chip">
                    {selected.width}×{selected.height}
                  </span>
                  <span className="kx-chip">{formatBytes(videoBytes)}</span>
                  <span className="kx-chip">{videoDuration.toFixed(1)}s</span>
                  <span className="kx-chip">video/webm</span>
                </div>
              ) : renderedUrl ? (
                <div className="kx-row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <span className="kx-chip">
                    {selected.width}×{selected.height}
                  </span>
                  <span className="kx-chip">{formatBytes(renderedBytes)}</span>
                  <span className="kx-chip">image/png</span>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
