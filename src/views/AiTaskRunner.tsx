import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../app/icons";
import { translate } from "../i18n/translate";
import { useSettings } from "../state/SettingsContext";
import { useLibrary } from "../state/LibraryContext";
import { useToast } from "../state/ToastContext";
import { downloadBlob, formatBytes, formatDuration } from "../lib/format";
import type { AiCatalogEntry } from "../data/aiCatalog";
import {
  validateInputFile,
  type AiParamSpec,
  type DeterministicRuntime,
} from "../data/aiRuntime";
import {
  AiTaskError,
  runDeterministicTask,
  type AiOutputPart,
  type AiParamValue,
  type AiTaskResult,
} from "../services/aiTasks";

interface Props {
  entry: AiCatalogEntry;
  runtime: DeterministicRuntime;
  preferArabic: boolean;
}

type RunStatus = "idle" | "running" | "done" | "error" | "cancelled";

const MEDIA_KIND: Record<string, "image" | "audio" | "video" | null> = {
  image: "image",
  audio: "audio",
  video: "video",
  json: null,
  text: null,
};

function defaultsFor(params: AiParamSpec[]): Record<string, AiParamValue> {
  const values: Record<string, AiParamValue> = {};
  for (const spec of params) {
    // Numeric specs keep a number; select specs keep their string value.
    values[spec.key] = spec.defaultValue;
  }
  return values;
}

/** Browser inputs hold strings; numeric parameters are stored as numbers. */
function normalizeParamValue(spec: AiParamSpec, raw: string): AiParamValue {
  if (spec.kind === "number") {
    const value = Number(raw);
    return Number.isFinite(value) ? value : spec.defaultValue;
  }
  return raw;
}

export default function AiTaskRunner({ entry, runtime, preferArabic }: Props) {
  const { settings } = useSettings();
  const { add } = useLibrary();
  const { push } = useToast();
  const t = useCallback(
    (key: string) => translate(settings.language, key),
    [settings.language],
  );

  const [file, setFile] = useState<File | null>(null);
  const [params, setParams] = useState<Record<string, AiParamValue>>(() =>
    defaultsFor(runtime.params),
  );
  const [status, setStatus] = useState<RunStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [result, setResult] = useState<AiTaskResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [jsonPreview, setJsonPreview] = useState<string | null>(null);
  const [savedParts, setSavedParts] = useState<Set<number>>(new Set());
  const [dragActive, setDragActive] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const urlsRef = useRef<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setParams(defaultsFor(runtime.params));
    setFile(null);
    setResult(null);
    setStatus("idle");
    setError(null);
    setProgress(0);
    setStage("");
    setSavedParts(new Set());
  }, [runtime]);

  useEffect(() => {
    for (const url of urlsRef.current) URL.revokeObjectURL(url);
    urlsRef.current = previewUrls;
    return () => {
      for (const url of previewUrls) URL.revokeObjectURL(url);
    };
  }, [previewUrls]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const validation = useMemo(
    () => (file ? validateInputFile(file, runtime) : null),
    [file, runtime],
  );

  const canRun =
    Boolean(file) &&
    validation?.ok === true &&
    status !== "running" &&
    (file?.size ?? 0) > 0;

  const resetOutput = useCallback(() => {
    setResult(null);
    setPreviewUrls([]);
    setJsonPreview(null);
    setSavedParts(new Set());
    setError(null);
    setProgress(0);
    setStage("");
  }, []);

  const acceptFile = useCallback(
    (candidate: File | null) => {
      abortRef.current?.abort();
      resetOutput();
      setStatus("idle");
      setFile(candidate);
    },
    [resetOutput],
  );

  const run = useCallback(async () => {
    if (!file || !canRun) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    resetOutput();
    setStatus("running");
    setStage(t("ai.runner.stagePrepare"));
    setProgress(0.02);
    try {
      const output = await runDeterministicTask({
        taskId: entry.id,
        file,
        params,
        signal: controller.signal,
        onProgress: (ratio, nextStage) => {
          setProgress(ratio);
          setStage(nextStage);
        },
      });
      if (controller.signal.aborted) return;
      const urls = output.parts.map((part) =>
        part.kind === "json" || part.kind === "text" ? "" : URL.createObjectURL(part.blob),
      );
      setPreviewUrls(urls);
      const jsonPart = output.parts.find(
        (part) => part.kind === "json" || part.kind === "text",
      );
      if (jsonPart) {
        try {
          setJsonPreview((await jsonPart.blob.text()).slice(0, 8000));
        } catch {
          setJsonPreview(null);
        }
      }
      setResult(output);
      setProgress(1);
      setStage(t("ai.runner.stageDone"));
      setStatus("done");
      push("success", t("ai.runner.doneTitle"), output.summary);
    } catch (cause) {
      if (controller.signal.aborted || (cause instanceof AiTaskError && cause.code === "CANCELLED")) {
        setStatus("cancelled");
        setStage(t("ai.runner.cancelled"));
        setProgress(0);
        return;
      }
      const message = cause instanceof Error ? cause.message : String(cause);
      setStatus("error");
      setError(message);
      setStage(t("ai.runner.failed"));
      setProgress(0);
      push("error", t("ai.runner.errorTitle"), message);
    } finally {
      abortRef.current = null;
    }
  }, [canRun, entry.id, file, params, push, resetOutput, t]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const savePart = useCallback(
    async (part: AiOutputPart, index: number) => {
      const libraryKind = MEDIA_KIND[part.kind];
      if (!libraryKind) {
        push("error", t("ai.runner.saveUnsupported"), part.name);
        return;
      }
      try {
        await add({
          name: part.name,
          kind: libraryKind,
          mimeType: part.mimeType,
          blob: part.blob,
          duration: part.duration ?? 0,
          width: part.width ?? 0,
          height: part.height ?? 0,
          source: "toolbox",
          thumbnail: part.kind === "image" ? (previewUrls[index] ?? null) : null,
        });
        setSavedParts((previous) => new Set(previous).add(index));
        push("success", t("ai.runner.saved"), part.name);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : t("ai.runner.failed");
        push("error", t("ai.runner.saveFailed"), message);
      }
    },
    [add, previewUrls, push, t],
  );

  const primary = result?.parts[0];
  const primaryUrl = previewUrls[0] ?? "";

  return (
    <div className="kx-ai-runner" data-task-id={entry.id} data-status={status}>
      <div className="kx-card-title" style={{ fontSize: "0.9rem" }}>
        <span>{t("ai.runner.title")}</span>
        <span className="kx-badge" data-state="PARTIAL">
          {t("ai.runner.local")}
        </span>
      </div>

      <div className="kx-notice" data-tone="info" style={{ marginTop: 8 }}>
        <Icon name="cpu" size={16} />
        <div>{preferArabic ? runtime.engineAr : runtime.engineEn}</div>
      </div>

      {/* 1. Input */}
      <div className="kx-runner-step" data-step="input">
        <div className="kx-runner-label">
          <strong>1 · {t("ai.runner.input")}</strong>
          <span className="kx-muted">{t("ai.runner.inputHint")}</span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={runtime.accept || undefined}
          data-ai-file-input
          style={{ display: "none" }}
          onChange={(event) => acceptFile(event.target.files?.[0] ?? null)}
        />
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
            acceptFile(event.dataTransfer.files?.[0] ?? null);
          }}
        >
          <Icon name="upload" size={18} />
          <div className="kx-runner-file">
            {file ? (
              <>
                <strong data-ai-file-name>{file.name}</strong>
                <span className="kx-muted">
                  {formatBytes(file.size)} · {file.type || t("ai.runner.unknownType")}
                </span>
              </>
            ) : (
              <>
                <strong>{t("ai.runner.chooseFile")}</strong>
                <span className="kx-muted">
                  {runtime.inputFamilies.join(" · ").toUpperCase()}
                </span>
              </>
            )}
          </div>
          <button
            type="button"
            className="kx-btn kx-btn-ghost"
            onClick={() => fileInputRef.current?.click()}
          >
            {file ? t("ai.runner.replace") : t("ai.runner.browse")}
          </button>
        </div>
        {validation && validation.ok === false && (
          <div className="kx-notice" data-tone="danger" style={{ marginTop: 8 }}>
            <Icon name="alert" size={15} />
            <div>
              {validation.reason === "empty"
                ? t("ai.runner.emptyFile")
                : t("ai.runner.wrongType")}
            </div>
          </div>
        )}
      </div>

      {/* 2. Parameters */}
      {runtime.params.length > 0 && (
        <div className="kx-runner-step" data-step="params">
          <div className="kx-runner-label">
            <strong>2 · {t("ai.runner.parameters")}</strong>
            <span className="kx-muted">{t("ai.runner.parametersHint")}</span>
          </div>
          <div className="kx-grid kx-grid-2" style={{ gap: 10 }}>
            {runtime.params.map((spec) => (
              <label key={spec.key} className="kx-field">
                <span className="kx-muted">
                  {t(spec.labelKey)}
                  {spec.kind === "number" && spec.unit ? ` (${spec.unit})` : ""}
                </span>
                {spec.kind === "number" ? (
                  <input
                    className="kx-input"
                    type="number"
                    name={spec.key}
                    data-ai-param={spec.key}
                    min={spec.min}
                    max={spec.max}
                    step={spec.step}
                    value={String(params[spec.key] ?? spec.defaultValue)}
                    onChange={(event) =>
                      setParams((previous) => ({
                        ...previous,
                        [spec.key]: normalizeParamValue(spec, event.target.value),
                      }))
                    }
                  />
                ) : (
                  <select
                    className="kx-input"
                    name={spec.key}
                    data-ai-param={spec.key}
                    value={String(params[spec.key] ?? spec.defaultValue)}
                    onChange={(event) =>
                      setParams((previous) => ({
                        ...previous,
                        [spec.key]: normalizeParamValue(spec, event.target.value),
                      }))
                    }
                  >
                    {spec.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {preferArabic ? option.labelAr : option.labelEn}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* 3. Model status / runtime */}
      <div className="kx-runner-step" data-step="runtime">
        <div className="kx-runner-label">
          <strong>3 · {t("ai.runner.runtime")}</strong>
        </div>
        <table className="kx-table">
          <tbody>
            <tr>
              <td className="kx-muted">{t("ai.runner.engine")}</td>
              <td className="kx-mono">
                {preferArabic ? runtime.engineAr : runtime.engineEn}
              </td>
            </tr>
            <tr>
              <td className="kx-muted">{t("ai.runner.requiresModel")}</td>
              <td className="kx-mono">{t("ai.runner.noModel")}</td>
            </tr>
            <tr>
              <td className="kx-muted">{t("ai.runner.output")}</td>
              <td className="kx-mono">{runtime.outputKind.toUpperCase()}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 4. Run + progress */}
      <div className="kx-runner-step" data-step="run">
        <div className="kx-runner-actions">
          <button
            type="button"
            className="kx-btn kx-btn-primary"
            data-ai-run
            disabled={!canRun}
            onClick={() => void run()}
          >
            <Icon name="play" size={15} />
            {status === "running" ? t("ai.runner.running") : t("ai.runner.run")}
          </button>
          {status === "running" && (
            <button type="button" className="kx-btn kx-btn-ghost" data-ai-cancel onClick={cancel}>
              <Icon name="x" size={15} />
              {t("ai.runner.cancel")}
            </button>
          )}
          {file && status !== "running" && (
            <button
              type="button"
              className="kx-btn kx-btn-ghost"
              onClick={() => acceptFile(null)}
            >
              {t("ai.runner.clear")}
            </button>
          )}
        </div>

        {(status === "running" || status === "done") && (
          <div style={{ marginTop: 10 }}>
            <div className="kx-row" style={{ justifyContent: "space-between" }}>
              <span className="kx-muted" data-ai-stage>
                {stage}
              </span>
              <span className="kx-mono">{Math.round(progress * 100)}%</span>
            </div>
            <div
              className="kx-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
            >
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          </div>
        )}

        {status === "cancelled" && (
          <div className="kx-notice" data-tone="warn" style={{ marginTop: 8 }} data-ai-cancelled>
            <Icon name="alert" size={15} />
            <div>{t("ai.runner.cancelled")}</div>
          </div>
        )}

        {status === "error" && error && (
          <div className="kx-notice" data-tone="danger" style={{ marginTop: 8 }} data-ai-error>
            <Icon name="alert" size={15} />
            <div>{error}</div>
          </div>
        )}
      </div>

      {/* 5. Preview + save/export */}
      {result && primary && (
        <div className="kx-runner-step" data-step="output">
          <div className="kx-runner-label">
            <strong>5 · {t("ai.runner.output")}</strong>
            <span className="kx-muted" data-ai-summary>
              {result.summary}
            </span>
          </div>

          <div className="kx-ai-preview" data-kind={primary.kind}>
            {primary.kind === "image" && (
              <img src={primaryUrl} alt={primary.name} data-ai-preview="image" />
            )}
            {primary.kind === "audio" && (
              <audio src={primaryUrl} controls data-ai-preview="audio" />
            )}
            {primary.kind === "video" && (
              <video src={primaryUrl} controls data-ai-preview="video" />
            )}
            {(primary.kind === "json" || primary.kind === "text") && (
              <pre className="kx-mono" data-ai-preview={primary.kind}>
                {jsonPreview ?? t("ai.runner.noPreview")}
              </pre>
            )}
          </div>

          <div className="kx-ai-parts" data-part-count={result.parts.length}>
            {result.parts.map((part, index) => {
              const libraryKind = MEDIA_KIND[part.kind];
              const saved = savedParts.has(index);
              return (
                <div className="kx-ai-part" key={`${part.name}-${index}`}>
                  <span className="kx-ai-part-name kx-mono">{part.name}</span>
                  <span className="kx-muted">
                    {formatBytes(part.blob.size)}
                    {part.duration && part.duration > 0
                      ? ` · ${formatDuration(part.duration)}`
                      : ""}
                  </span>
                  <div className="kx-row" style={{ gap: 6 }}>
                    {libraryKind && (
                      <button
                        type="button"
                        className="kx-btn kx-btn-ghost"
                        data-ai-save
                        disabled={saved}
                        onClick={() => void savePart(part, index)}
                      >
                        <Icon name="check" size={14} />
                        {saved ? t("ai.runner.saved") : t("ai.runner.save")}
                      </button>
                    )}
                    <button
                      type="button"
                      className="kx-btn kx-btn-ghost"
                      data-ai-export
                      onClick={() => downloadBlob(part.blob, part.name)}
                    >
                      <Icon name="download" size={14} />
                      {t("ai.runner.export")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <details className="kx-ai-metrics">
            <summary>{t("ai.runner.metrics")}</summary>
            <pre className="kx-mono">{JSON.stringify(result.metrics, null, 2)}</pre>
          </details>
        </div>
      )}
    </div>
  );
}
