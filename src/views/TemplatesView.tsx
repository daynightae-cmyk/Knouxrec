import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../app/icons";
import { CAPABILITIES } from "../app/capabilities";
import { translate } from "../i18n/translate";
import { useLibrary } from "../state/LibraryContext";
import { useSettings } from "../state/SettingsContext";
import { useToast } from "../state/ToastContext";
import { downloadBlob, formatBytes } from "../lib/format";
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

export default function TemplatesView() {
  const { settings } = useSettings();
  const { add } = useLibrary();
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

  const urlRef = useRef<string | null>(null);
  const engineRef = useRef<TemplateEngine | null>(null);

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
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
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
      );
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((value) => resolve(value), "image/png"),
      );
      if (!blob) throw new Error("The frame could not be encoded.");
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(blob);
      setRenderedUrl(urlRef.current);
      setRenderedBytes(blob.size);
      setSaved(false);
    } catch (cause) {
      setRenderError(
        cause instanceof Error ? cause.message : "The template could not be rendered.",
      );
    } finally {
      setRendering(false);
    }
  }, [customizations, selected]);

  const saveToLibrary = useCallback(async () => {
    if (!renderedUrl || !selected) return;
    try {
      const response = await fetch(renderedUrl);
      const blob = await response.blob();
      await add({
        name: `${selected.id}-frame.png`,
        kind: "image",
        mimeType: blob.type || "image/png",
        blob,
        duration: 0,
        width: selected.width,
        height: selected.height,
        source: "toolbox",
        thumbnail: renderedUrl,
      });
      setSaved(true);
      push("success", t("templates.saved"), `${selected.id}-frame.png`);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "The frame could not be saved.";
      setRenderError(message);
      push("error", t("templates.saveFailed"), message);
    }
  }, [add, push, renderedUrl, selected, t]);

  return (
    <div className="kx-section">
      <SectionHeader
        eyebrow={t("groupCreate")}
        title={t("templates")}
        description={t("templates.description")}
        actions={<StateBadge state={capability.state} />}
      />

      <div className="kx-notice" data-tone="warn" style={{ marginBottom: 16 }}>
        <Icon name="info" size={18} />
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
              <div className="kx-col" style={{ gap: 8, marginTop: 12 }}>
                {templates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className="kx-ai-row"
                    data-active={selectedId === template.id}
                    onClick={() => {
                      setSelectedId(template.id);
                      setCustomizations({});
                      setRenderedUrl(null);
                      setRenderError(null);
                    }}
                  >
                    <span className="kx-ai-row-icon">
                      <Icon name="templates" size={17} />
                    </span>
                    <span className="kx-ai-row-body">
                      <span className="kx-ai-row-title">{template.name}</span>
                      <span className="kx-ai-row-sub">
                        {CATEGORY_LABELS[template.category] ?? template.category} ·{" "}
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
            )}
          </div>

          <div className="kx-card">
            <div className="kx-card-title">
              <span>{t("templates.generated")}</span>
              <span className="kx-badge" data-state="BLOCKED">
                {MOCK_TEMPLATE_TOTAL}
              </span>
            </div>
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
          </div>
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
                  <span className="kx-badge" data-state="PARTIAL">
                    {t("templates.frameOnly")}
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
                              setRenderedUrl(null);
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
                    disabled={rendering}
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
                  {renderedUrl && (
                    <>
                      <button
                        type="button"
                        className="kx-btn"
                        onClick={() => void saveToLibrary()}
                      >
                        <Icon name="download" size={15} />
                        {saved ? t("templates.saved") : t("templates.saveToLibrary")}
                      </button>
                      <button
                        type="button"
                        className="kx-btn"
                        onClick={async () => {
                          const response = await fetch(renderedUrl);
                          const blob = await response.blob();
                          downloadBlob(blob, `${selected.id}-frame.png`);
                        }}
                      >
                        <Icon name="external" size={15} />
                        {t("templates.exportFrame")}
                      </button>
                    </>
                  )}
                </div>

                {renderError && (
                  <div className="kx-notice" data-tone="danger" style={{ marginTop: 12 }}>
                    <Icon name="alert" size={16} />
                    <div>{renderError}</div>
                  </div>
                )}
              </div>

              <div className="kx-preview">
                {renderedUrl ? (
                  <img src={renderedUrl} alt={selected.name} />
                ) : (
                  <div className="kx-preview-idle">
                    <Icon name="templates" size={34} />
                    <div className="kx-empty-title">{t("templates.stageEmpty")}</div>
                    <p className="kx-empty-hint">{t("templates.stageHint")}</p>
                  </div>
                )}
              </div>

              {renderedUrl && (
                <div className="kx-row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <span className="kx-chip">
                    {selected.width}×{selected.height}
                  </span>
                  <span className="kx-chip">{formatBytes(renderedBytes)}</span>
                  <span className="kx-chip">image/png</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
