import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "../app/icons";
import { CAPABILITIES } from "../app/capabilities";
import { translate } from "../i18n/translate";
import { useLibrary } from "../state/LibraryContext";
import { useSettings } from "../state/SettingsContext";
import { useToast } from "../state/ToastContext";
import { downloadBlob, formatBytes, formatDuration } from "../lib/format";
import {
  MEDIA_TOOLS,
  type MediaToolCategory,
  type MediaToolDescriptor,
  type MediaToolId,
} from "../services/mediaTools";
import {
  executeMediaJob,
  type CancellationToken,
  type MediaJobProgress,
} from "../services/mediaJobs";
import { EmptyState, SectionHeader, StateBadge } from "./ui";

const CATEGORY_ICONS: Record<MediaToolCategory, IconName> = {
  image: "image",
  video: "video",
  audio: "audio",
  text: "pencil",
  utility: "toolbox",
};

interface ToolOptions {
  mode: string;
  width: number;
  height: number;
  percentage: number;
  format: string;
  quality: number;
  exposure: number;
  brightness: number;
  contrast: number;
  saturation: number;
  grayscale: number;
  blur: number;
  time: number;
  style: string;
  color: string;
  background: string;
  fontSize: number;
  fontFamily: string;
  align: string;
  ecLevel: string;
  moduleSize: number;
  margin: number;
  count: number;
}

const DEFAULT_OPTIONS: ToolOptions = {
  mode: "fit",
  width: 1280,
  height: 720,
  percentage: 100,
  format: "png",
  quality: 92,
  exposure: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  grayscale: 0,
  blur: 0,
  time: 1,
  style: "wave",
  color: "#ffde00",
  background: "#101016",
  fontSize: 64,
  fontFamily: "Inter, system-ui, sans-serif",
  align: "center",
  ecLevel: "M",
  moduleSize: 8,
  margin: 4,
  count: 6,
};

export default function ToolboxView() {
  const { settings } = useSettings();
  const { items, add, urlFor } = useLibrary();
  const { push } = useToast();
  const t = useCallback(
    (key: string) => translate(settings.language, key),
    [settings.language],
  );

  const [toolId, setToolId] = useState<MediaToolId | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<MediaToolCategory | "all">("all");

  const [file, setFile] = useState<{ blob: Blob; name: string } | null>(null);
  const [text, setText] = useState("");
  const [options, setOptions] = useState<ToolOptions>(DEFAULT_OPTIONS);

  const [progress, setProgress] = useState<MediaJobProgress | null>(null);
  const [result, setResult] = useState<{
    blob: Blob;
    fileName: string;
    mimeType: string;
    width?: number;
    height?: number;
    duration?: number;
    bytes: number;
    metrics: Record<string, string | number | boolean>;
    logs: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [saved, setSaved] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const tokenRef = useRef<CancellationToken>({ cancelled: false });
  const resultUrlRef = useRef<string | null>(null);
  const sourceUrlRef = useRef<string | null>(null);

  const tool = useMemo(
    () => MEDIA_TOOLS.find((entry) => entry.id === toolId) ?? null,
    [toolId],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return MEDIA_TOOLS.filter((entry) => {
      const matchesCategory = category === "all" || entry.category === category;
      const matchesQuery =
        !needle ||
        entry.name.toLowerCase().includes(needle) ||
        entry.nameAr.includes(query.trim()) ||
        entry.description.toLowerCase().includes(needle);
      return matchesCategory && matchesQuery;
    });
  }, [query, category]);

  const sourceUrl = useMemo(() => {
    if (!file) return null;
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
    sourceUrlRef.current = URL.createObjectURL(file.blob);
    return sourceUrlRef.current;
  }, [file]);

  const resultUrl = useMemo(() => {
    if (!result) return null;
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    resultUrlRef.current = URL.createObjectURL(result.blob);
    return resultUrlRef.current;
  }, [result]);

  useEffect(
    () => () => {
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
      if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
    },
    [],
  );

  const libraryCandidates = useMemo(() => {
    if (!tool || tool.inputKind !== "file") return [];
    return items.filter((item) => {
      if (tool.accepts.length === 0) return true;
      return tool.accepts.includes(item.mimeType);
    });
  }, [items, tool]);

  const reset = useCallback(() => {
    tokenRef.current = { cancelled: false };
    setProgress(null);
    setResult(null);
    setError(null);
    setSaved(false);
  }, []);

  const openTool = useCallback(
    (next: MediaToolId) => {
      reset();
      setFile(null);
      setText("");
      setOptions(DEFAULT_OPTIONS);
      setToolId(next);
    },
    [reset],
  );

  const closeTool = useCallback(() => {
    reset();
    setFile(null);
    setText("");
    setOptions(DEFAULT_OPTIONS);
    setToolId(null);
  }, [reset]);

  const selectFile = useCallback(
    (blob: Blob, name: string) => {
      const descriptor = MEDIA_TOOLS.find((entry) => entry.id === toolId);
      if (descriptor && descriptor.inputKind === "file") {
        const type = blob.type;
        if (type && descriptor.accepts.length > 0 && !descriptor.accepts.includes(type)) {
          setError(
            `${descriptor.name} does not accept ${type}. Accepted: ${descriptor.accepts.join(", ")}.`,
          );
          return;
        }
      }
      setError(null);
      setResult(null);
      setSaved(false);
      setFile({ blob, name });
    },
    [toolId],
  );

  const run = useCallback(async () => {
    if (!tool) return;
    tokenRef.current = { cancelled: false };
    setError(null);
    setResult(null);
    setSaved(false);
    setProgress({ stage: "validating", progress: 0.05, message: t("toolbox.stageValidating") });
    try {
      const output = await executeMediaJob(
        {
          toolId: tool.id,
          file: file?.blob,
          fileName: file?.name,
          text,
          options: options as unknown as Record<string, unknown>,
        },
        (update) =>
          setProgress({
            stage: update.stage,
            progress: update.progress,
            message: update.message,
          }),
        tokenRef.current,
      );
      setResult({
        blob: output.blob,
        fileName: output.fileName,
        mimeType: output.mimeType,
        width: output.width,
        height: output.height,
        duration: output.duration,
        bytes: output.bytes,
        metrics: output.metrics,
        logs: output.logs,
      });
      push(
        "success",
        `${tool.name} finished`,
        `${output.fileName} · ${formatBytes(output.bytes)}`,
      );
    } catch (cause) {
      if (cause instanceof Error && cause.name === "MediaJobCancelledError") {
        setProgress({ stage: "cancelled", progress: 0, message: t("toolbox.cancelled") });
        return;
      }
      const message = cause instanceof Error ? cause.message : "The tool failed.";
      setError(message);
      setProgress({ stage: "error", progress: 0, message });
      push("error", `${tool.name} failed`, message);
    }
  }, [file, options, push, t, text, tool]);

  const cancel = useCallback(() => {
    tokenRef.current.cancelled = true;
  }, []);

  const saveToLibrary = useCallback(async () => {
    if (!result || !tool) return;
    try {
      await add({
        name: result.fileName,
        kind: "image",
        mimeType: result.mimeType,
        blob: result.blob,
        duration: result.duration ?? 0,
        width: result.width ?? 0,
        height: result.height ?? 0,
        source: "toolbox",
        thumbnail: result.mimeType.startsWith("image/") ? resultUrl : null,
      });
      setSaved(true);
      push("success", t("toolbox.saved"), result.fileName);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The item could not be saved.";
      setError(message);
      push("error", t("toolbox.saveFailed"), message);
    }
  }, [add, push, result, resultUrl, t, tool]);

  if (!tool) {
    return (
      <div className="kx-section">
        <SectionHeader
          eyebrow={t("groupCreate")}
          title={t("toolbox")}
          description={t("toolbox.subtitle")}
          actions={<StateBadge state={CAPABILITIES.toolbox.state} />}
        />

        <div className="kx-row" style={{ gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <input
            className="kx-input kx-search"
            type="search"
            value={query}
            placeholder={t("toolbox.searchPlaceholder")}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t("toolbox.searchPlaceholder")}
          />
          <div className="kx-segmented" role="group" aria-label={t("toolbox.category")}>
            <button
              type="button"
              aria-pressed={category === "all"}
              onClick={() => setCategory("all")}
            >
              {t("toolbox.all")}
            </button>
            {(["image", "video", "audio", "text", "utility"] as MediaToolCategory[]).map(
              (entry) => (
                <button
                  key={entry}
                  type="button"
                  aria-pressed={category === entry}
                  onClick={() => setCategory(entry)}
                >
                  {t(`toolbox.category.${entry}`)}
                </button>
              ),
            )}
          </div>
        </div>

        <div className="kx-grid kx-grid-3">
          {filtered.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="kx-tool-card"
              onClick={() => openTool(entry.id)}
            >
              <span className="kx-tool-icon">
                <Icon name={CATEGORY_ICONS[entry.category]} size={22} />
              </span>
              <span className="kx-tool-name">{entry.name}</span>
              <span className="kx-tool-desc">{entry.description}</span>
              <span className="kx-tool-foot">
                <span className="kx-chip">{t(`toolbox.category.${entry.category}`)}</span>
                <span className="kx-badge" data-state="VERIFIED">
                  {t("toolbox.ready")}
                </span>
              </span>
            </button>
          ))}
        </div>

        {filtered.length === 0 && (
          <EmptyState
            icon="search"
            title={t("toolbox.noMatch")}
            hint={t("toolbox.noMatchHint")}
          />
        )}
      </div>
    );
  }

  const update = (patch: Partial<ToolOptions>) => {
    setOptions((current) => ({ ...current, ...patch }));
    setResult(null);
    setSaved(false);
  };

  const running = progress?.stage === "validating" || progress?.stage === "processing" || progress?.stage === "verifying";
  const sourceIsAudioVideo =
    tool?.accepts.some((type) => type.startsWith("video/") || type.startsWith("audio/")) ?? false;

  const slider = (
    label: string,
    key: keyof ToolOptions,
    minimum: number,
    maximum: number,
    step = 1,
  ) => (
    <label className="kx-field">
      <span className="kx-label">
        {label} <output className="kx-mono">{String(options[key])}</output>
      </span>
      <input
        type="range"
        min={minimum}
        max={maximum}
        step={step}
        value={Number(options[key])}
        onChange={(event) => update({ [key]: Number(event.target.value) } as Partial<ToolOptions>)}
      />
    </label>
  );

  const segmented = (
    label: string,
    key: keyof ToolOptions,
    values: string[],
  ) => (
    <div className="kx-field">
      <span className="kx-label">{label}</span>
      <div className="kx-segmented" role="group" aria-label={label}>
        {values.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={options[key] === value}
            onClick={() => update({ [key]: value } as Partial<ToolOptions>)}
          >
            {t(`toolbox.option.${key}.${value}`)}
          </button>
        ))}
      </div>
    </div>
  );

  const settingsFor = (descriptor: MediaToolDescriptor) => {
    switch (descriptor.id) {
      case "image-resize":
        return (
          <>
            {segmented(t("toolbox.mode"), "mode", ["fit", "fill", "stretch", "percentage"])}
            {options.mode === "percentage" ? (
              slider(t("toolbox.percentage"), "percentage", 10, 400, 5)
            ) : (
              <>
                {slider(t("toolbox.width"), "width", 16, 4096)}
                {slider(t("toolbox.height"), "height", 16, 4096)}
              </>
            )}
            {segmented(t("toolbox.format"), "format", ["png", "jpeg", "webp"])}
            {options.format !== "png" && slider(t("toolbox.quality"), "quality", 30, 100)}
          </>
        );
      case "image-filters":
        return (
          <>
            {slider(t("toolbox.exposure"), "exposure", -2, 2, 0.1)}
            {slider(t("toolbox.brightness"), "brightness", -100, 100)}
            {slider(t("toolbox.contrast"), "contrast", -100, 100)}
            {slider(t("toolbox.saturation"), "saturation", -100, 100)}
            {slider(t("toolbox.grayscale"), "grayscale", 0, 100)}
            {slider(t("toolbox.blur"), "blur", 0, 10)}
            {segmented(t("toolbox.format"), "format", ["png", "jpeg", "webp"])}
          </>
        );
      case "image-convert":
        return (
          <>
            {segmented(t("toolbox.format"), "format", ["png", "jpeg", "webp"])}
            {options.format !== "png" && slider(t("toolbox.quality"), "quality", 30, 100)}
          </>
        );
      case "video-thumbnail":
        return (
          <>
            {slider(t("toolbox.timecode"), "time", 0, 60, 0.1)}
            {segmented(t("toolbox.format"), "format", ["png", "jpeg"])}
          </>
        );
      case "audio-visualizer":
        return (
          <>
            {segmented(t("toolbox.waveStyle"), "style", ["wave", "bars"])}
            {slider(t("toolbox.width"), "width", 320, 2400, 20)}
            {slider(t("toolbox.height"), "height", 120, 1200, 20)}
          </>
        );
      case "text-image":
        return (
          <>
            {slider(t("toolbox.fontSize"), "fontSize", 12, 240)}
            {slider(t("toolbox.width"), "width", 320, 2400, 20)}
            {slider(t("toolbox.height"), "height", 200, 1600, 20)}
            {segmented(t("toolbox.align"), "align", ["left", "center", "right"])}
          </>
        );
      case "qr-code":
        return (
          <>
            {segmented(t("toolbox.ecLevel"), "ecLevel", ["L", "M", "Q", "H"])}
            {slider(t("toolbox.moduleSize"), "moduleSize", 2, 20)}
            {slider(t("toolbox.margin"), "margin", 0, 8)}
          </>
        );
      case "color-palette":
        return slider(t("toolbox.paletteCount"), "count", 2, 16);
      default:
        return null;
    }
  };

  return (
    <div className="kx-section">
      <SectionHeader
        eyebrow={t("groupCreate")}
        title={`${tool.name} · ${tool.nameAr}`}
        description={tool.description}
        actions={
          <div className="kx-row" style={{ gap: 10 }}>
            <span className="kx-badge" data-state="VERIFIED">
              {t("toolbox.ready")}
            </span>
            <button type="button" className="kx-btn kx-btn-quiet" onClick={closeTool}>
              <Icon name="arrowLeft" size={15} />
              {t("toolbox.back")}
            </button>
          </div>
        }
      />

      <div className="kx-notice" data-tone="info" style={{ marginBottom: 16 }}>
        <Icon name="lock" size={16} />
        <div>{t("toolbox.localOnly")}</div>
      </div>

      <div className="kx-tool-layout">
        {/* ---------------- input ---------------- */}
        <section className="kx-card">
          <div className="kx-card-title">
            <span>{t("toolbox.input")}</span>
            <Icon name="folder" size={16} />
          </div>

          {tool.inputKind === "file" ? (
            <>
              <div
                className="kx-dropzone"
                data-active={dragActive}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                  const dropped = event.dataTransfer.files?.[0];
                  if (dropped) selectFile(dropped, dropped.name);
                }}
              >
                <Icon name="upload" size={22} />
                <p className="kx-card-sub">{t("toolbox.dropHere")}</p>
                <button
                  type="button"
                  className="kx-btn kx-btn-sm"
                  onClick={() => inputRef.current?.click()}
                >
                  {t("toolbox.chooseFile")}
                </button>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept={tool.accepts.join(",")}
                hidden
                onChange={(event) => {
                  const selected = event.target.files?.[0];
                  if (selected) selectFile(selected, selected.name);
                  event.target.value = "";
                }}
              />

              {file && (
                <div className="kx-row-between" style={{ marginTop: 12 }}>
                  <span className="kx-muted">{file.name}</span>
                  <span className="kx-mono kx-muted">{formatBytes(file.blob.size)}</span>
                </div>
              )}

              {libraryCandidates.length > 0 && (
                <div className="kx-divider" />
              )}
              {libraryCandidates.length > 0 && (
                <div className="kx-card-title" style={{ fontSize: "0.84rem" }}>
                  <span>{t("toolbox.useLibrary")}</span>
                </div>
              )}
              <div className="kx-scroll-x" style={{ maxHeight: 180, overflowY: "auto" }}>
                {libraryCandidates.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="kx-btn kx-btn-quiet kx-btn-block"
                    style={{ justifyContent: "space-between", marginBottom: 6 }}
                    onClick={async () => {
                      const url = urlFor(item.id);
                      if (!url) return;
                      const response = await fetch(url);
                      const blob = await response.blob();
                      selectFile(blob, item.name);
                    }}
                  >
                    <span>{item.name}</span>
                    <span className="kx-mono kx-muted">{formatBytes(item.size)}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <label className="kx-field">
              <span className="kx-label">{t("toolbox.text")}</span>
              <textarea
                className="kx-input"
                rows={5}
                value={text}
                placeholder={t("toolbox.textPlaceholder")}
                onChange={(event) => {
                  setText(event.target.value);
                  setResult(null);
                }}
              />
            </label>
          )}

          {error && (
            <div className="kx-notice" data-tone="danger" style={{ marginTop: 12 }}>
              <Icon name="alert" size={16} />
              <div>{error}</div>
            </div>
          )}
        </section>

        {/* ---------------- stage ---------------- */}
        <section className="kx-tool-stage">
          <div className="kx-preview">
            {resultUrl ? (
              <img src={resultUrl} alt={result?.fileName ?? ""} />
            ) : sourceUrl && tool.inputKind === "file" ? (
              tool.accepts.some((type) => type.startsWith("video/")) ? (
                <video
                  src={sourceUrl}
                  controls
                  muted
                  playsInline
                  preload="metadata"
                  aria-label={file?.name ?? tool.name}
                />
              ) : tool.accepts.some((type) => type.startsWith("audio/")) ? (
                <audio
                  src={sourceUrl}
                  controls
                  preload="metadata"
                  aria-label={file?.name ?? tool.name}
                />
              ) : (
                <img src={sourceUrl} alt={file?.name ?? ""} />
              )
            ) : (
              <div className="kx-preview-idle">
                <Icon name={CATEGORY_ICONS[tool.category]} size={34} />
                <div className="kx-empty-title">{t("toolbox.emptyStage")}</div>
                <p className="kx-empty-hint">{t("toolbox.emptyStageHint")}</p>
              </div>
            )}
          </div>

          {sourceUrl && resultUrl && !sourceIsAudioVideo && (
            <div className="kx-compare">
              <figure>
                <figcaption className="kx-muted">{t("toolbox.before")}</figcaption>
                <img src={sourceUrl} alt={file?.name ?? ""} />
              </figure>
              <figure>
                <figcaption className="kx-muted">{t("toolbox.after")}</figcaption>
                <img src={resultUrl} alt={result?.fileName ?? ""} />
              </figure>
            </div>
          )}

          {progress && (
            <div className="kx-card">
              <div className="kx-row-between">
                <span>{progress.message}</span>
                <span className="kx-mono">{Math.round(progress.progress * 100)}%</span>
              </div>
              <div
                className="kx-progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress.progress * 100)}
              >
                <span style={{ width: `${Math.round(progress.progress * 100)}%` }} />
              </div>
            </div>
          )}

          {result && (
            <div className="kx-card">
              <div className="kx-card-title">
                <span>{t("toolbox.result")}</span>
                <span className="kx-badge" data-state="VERIFIED">
                  {t("toolbox.verified")}
                </span>
              </div>
              <p className="kx-card-sub" style={{ marginTop: 8 }}>
                {result.fileName} · {result.mimeType} · {formatBytes(result.bytes)}
                {result.width ? ` · ${result.width}×${result.height}` : ""}
                {result.duration ? ` · ${formatDuration(result.duration)}` : ""}
              </p>
              <div className="kx-row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                {Object.entries(result.metrics).map(([key, value]) => (
                  <span key={key} className="kx-chip">
                    <span className="kx-muted">{key}</span> {String(value)}
                  </span>
                ))}
              </div>
              {result.logs.map((log) => (
                <p key={log} className="kx-card-sub" style={{ marginTop: 8 }}>
                  {log}
                </p>
              ))}
              <div className="kx-tool-actions" style={{ marginTop: 14 }}>
                <button type="button" className="kx-btn kx-btn-primary" onClick={() => void saveToLibrary()}>
                  <Icon name="download" size={15} />
                  {saved ? t("toolbox.saved") : t("toolbox.saveToLibrary")}
                </button>
                <button
                  type="button"
                  className="kx-btn"
                  onClick={() => downloadBlob(result.blob, result.fileName)}
                >
                  <Icon name="external" size={15} />
                  {t("toolbox.export")}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* ---------------- settings ---------------- */}
        <section className="kx-card kx-tool-settings">
          <div className="kx-card-title">
            <span>{t("toolbox.settings")}</span>
            <Icon name="settings" size={16} />
          </div>
          <div className="kx-col" style={{ gap: 12, marginTop: 12 }}>
            {settingsFor(tool)}
          </div>

          <div className="kx-divider" />

          <div className="kx-tool-actions">
            <button
              type="button"
              className="kx-btn kx-btn-primary"
              onClick={() => void run()}
              disabled={running}
            >
              {running ? (
                <>
                  <span className="kx-spin">
                    <Icon name="refresh" size={15} />
                  </span>
                  {t("toolbox.running")}
                </>
              ) : (
                <>
                  <Icon name="play" size={15} />
                  {result ? t("toolbox.retry") : t("toolbox.run")}
                </>
              )}
            </button>
            {running && (
              <button type="button" className="kx-btn kx-btn-danger" onClick={cancel}>
                {t("toolbox.cancel")}
              </button>
            )}
            <button type="button" className="kx-btn" onClick={reset} disabled={running}>
              {t("toolbox.reset")}
            </button>
          </div>

          <div className="kx-card-sub" style={{ marginTop: 12 }}>
            {t("toolbox.accepts")} {tool.accepts.length ? tool.accepts.join(", ") : t("toolbox.textOnly")}
          </div>
          <div className="kx-card-sub">{t("toolbox.output")} {tool.outputMime}</div>
        </section>
      </div>
    </div>
  );
}
