import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../app/icons";
import { CAPABILITIES } from "../app/capabilities";
import { translate } from "../i18n/translate";
import { useLibrary } from "../state/LibraryContext";
import { useSettings } from "../state/SettingsContext";
import { useToast } from "../state/ToastContext";
import { downloadBlob, formatBytes } from "../lib/format";
import { EmptyState, SectionHeader, StateBadge } from "./ui";

/**
 * The preserved laboratory lives outside `src/`. It is loaded on demand so its
 * canvases are only created when the section is opened.
 */
interface VisualPatchToolSummary {
  id: string;
  name: string;
  nameAr: string;
  category: string;
  description: string;
  descriptionAr: string;
  editMode: string;
  defaultIntensity: number;
  maxIntensity: number;
  defaultBrushSize: number;
  maxBrushSize: number;
  defaultFeather: number;
  supportsSymmetry: boolean;
  requiresRegionSelection: boolean;
  enabled: boolean;
  processingComplexity: "low" | "medium" | "high";
}

interface EditRegionShape {
  id: string;
  points: Array<{ x: number; y: number }>;
  intensity: number;
  brushSize: number;
  feather: number;
}

interface LabService {
  createSession(imageFile: File): Promise<string>;
  applyTool(
    toolId: string,
    regions: EditRegionShape[],
    settings: {
      intensity: number;
      brushSize: number;
      feather: number;
      symmetry: boolean;
      brushHardness: number;
      opacity: number;
    },
  ): Promise<void>;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  canUndo(): boolean;
  canRedo(): boolean;
  resetToOriginal(): void;
  getCanvas(): HTMLCanvasElement;
  exportImage(options: {
    format: "png" | "jpg" | "webp";
    quality: number;
    resolution: "original" | "hd" | "4k";
    includeMetadata: boolean;
  }): Promise<string>;
}

const FAMILY_LABELS: Record<string, string> = {
  "body-scale": "Body scale",
  "waist-belly": "Waist & belly",
  chest: "Chest",
  "hips-thighs": "Hips & thighs",
  "legs-feet": "Legs & feet",
  "arms-shoulders": "Arms & shoulders",
  "head-face": "Head & face",
  freeform: "Freeform",
};

const FAMILY_ORDER = [
  "body-scale",
  "waist-belly",
  "chest",
  "hips-thighs",
  "legs-feet",
  "arms-shoulders",
  "head-face",
  "freeform",
];

export default function VisualPatchView() {
  const { settings } = useSettings();
  const { items, add, urlFor } = useLibrary();
  const { push } = useToast();
  const t = useCallback(
    (key: string) => translate(settings.language, key),
    [settings.language],
  );
  const capability = CAPABILITIES["visual-patch"];

  const [tools, setTools] = useState<VisualPatchToolSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [family, setFamily] = useState<string>("all");

  const [fileName, setFileName] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [historyState, setHistoryState] = useState({ undo: false, redo: false });

  const [intensity, setIntensity] = useState(100);
  const [brushSize, setBrushSize] = useState(40);
  const [feather, setFeather] = useState(10);
  const [regions, setRegions] = useState<EditRegionShape[]>([]);
  const [painting, setPainting] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  const serviceRef = useRef<LabService | null>(null);
  const displayRef = useRef<HTMLCanvasElement | null>(null);
  const paintRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sourceUrlRef = useRef<string | null>(null);
  const originalUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const [types, service] = await Promise.all([
          import("../../types/visualPatchLab"),
          import("../../services/visualPatchLabService"),
        ]);
        if (cancelled) return;
        serviceRef.current = service.visualPatchLabService as unknown as LabService;
        setTools(
          types.ALL_VISUAL_PATCH_TOOLS.map((tool) => ({
            id: tool.id,
            name: tool.name,
            nameAr: tool.nameAr,
            category: tool.category,
            description: tool.description,
            descriptionAr: tool.descriptionAr,
            editMode: tool.editMode,
            defaultIntensity: tool.defaultIntensity,
            maxIntensity: tool.maxIntensity,
            defaultBrushSize: tool.defaultBrushSize,
            maxBrushSize: tool.maxBrushSize,
            defaultFeather: tool.defaultFeather,
            supportsSymmetry: tool.supportsSymmetry,
            requiresRegionSelection: tool.requiresRegionSelection,
            enabled: tool.enabled,
            processingComplexity: tool.processingComplexity,
          })),
        );
        setLoadError(null);
      } catch (cause) {
        if (!cancelled) {
          setLoadError(
            cause instanceof Error
              ? cause.message
              : "The preserved laboratory could not be loaded.",
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

  const paintService = useCallback(() => {
    const service = serviceRef.current;
    const display = displayRef.current;
    if (!service || !display) return;
    const source = service.getCanvas();
    if (display.width !== source.width || display.height !== source.height) {
      display.width = source.width;
      display.height = source.height;
      const paint = paintRef.current;
      if (paint) {
        paint.width = source.width;
        paint.height = source.height;
      }
    }
    const context = display.getContext("2d");
    if (!context) return;
    if (showOriginal) {
      context.clearRect(0, 0, display.width, display.height);
      if (originalUrlRef.current) {
        const image = new Image();
        image.onload = () => context.drawImage(image, 0, 0);
        image.src = originalUrlRef.current;
      }
    } else {
      context.drawImage(source, 0, 0);
    }
    setHistoryState({ undo: service.canUndo(), redo: service.canRedo() });
  }, [showOriginal]);

  const loadFile = useCallback(
    async (blob: Blob, name: string) => {
      const service = serviceRef.current;
      if (!service) return;
      setBusy(true);
      setError(null);
      try {
        const file = new File([blob], name, { type: blob.type || "image/png" });
        const id = await service.createSession(file);
        setSessionId(id);
        setFileName(name);
        setRegions([]);
        if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
        sourceUrlRef.current = URL.createObjectURL(blob);
        if (originalUrlRef.current) URL.revokeObjectURL(originalUrlRef.current);
        originalUrlRef.current = URL.createObjectURL(blob);
        setStatus(t("visualPatch.sessionReady"));
        window.setTimeout(paintService, 30);
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "The image could not be opened.",
        );
      } finally {
        setBusy(false);
      }
    },
    [paintService, t],
  );

  const selected = useMemo(
    () => tools.find((tool) => tool.id === selectedId) ?? null,
    [tools, selectedId],
  );

  const visibleTools = useMemo(
    () =>
      tools.filter((tool) => family === "all" || tool.category === family),
    [tools, family],
  );

  const applyTool = useCallback(async () => {
    const service = serviceRef.current;
    if (!service || !selected) return;
    if (regions.length === 0) {
      setError(t("visualPatch.paintFirst"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await service.applyTool(selected.id, regions, {
        intensity,
        brushSize,
        feather,
        symmetry: false,
        brushHardness: 50,
        opacity: 100,
      });
      setStatus(
        `${t("visualPatch.applied")} ${selected.name} · ${t("visualPatch.regions")} ${regions.length}`,
      );
      paintService();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The tool could not be applied.",
      );
    } finally {
      setBusy(false);
    }
  }, [brushSize, feather, intensity, paintService, regions, selected, t]);

  const undo = useCallback(async () => {
    const service = serviceRef.current;
    if (!service) return;
    const restored = await service.undo();
    if (restored) {
      setStatus(t("visualPatch.undone"));
      paintService();
    }
  }, [paintService, t]);

  const redo = useCallback(async () => {
    const service = serviceRef.current;
    if (!service) return;
    const restored = await service.redo();
    if (restored) {
      setStatus(t("visualPatch.redone"));
      paintService();
    }
  }, [paintService, t]);

  const reset = useCallback(() => {
    const service = serviceRef.current;
    if (!service) return;
    service.resetToOriginal();
    setRegions([]);
    setStatus(t("visualPatch.reset"));
    paintService();
  }, [paintService, t]);

  const exportPng = useCallback(async () => {
    const service = serviceRef.current;
    if (!service) return;
    try {
      const dataUrl = await service.exportImage({
        format: "png",
        quality: 100,
        resolution: "original",
        includeMetadata: false,
      });
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const name = `${(fileName ?? "image").replace(/\.[^.]+$/, "")}-patched.png`;
      downloadBlob(blob, name);
      await add({
        name,
        kind: "image",
        mimeType: blob.type || "image/png",
        blob,
        duration: 0,
        width: service.getCanvas().width,
        height: service.getCanvas().height,
        source: "toolbox",
        thumbnail: null,
      });
      setStatus(`${t("visualPatch.exported")} ${name} · ${formatBytes(blob.size)}`);
      push("success", t("visualPatch.exported"), name);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "The image could not be exported.";
      setError(message);
      push("error", t("visualPatch.exportFailed"), message);
    }
  }, [add, fileName, push, t]);

  const pointerPosition = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = paintRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  return (
    <div className="kx-section">
      <SectionHeader
        eyebrow={t("groupCreate")}
        title={t("visualPatch")}
        description={t("visualPatch.description")}
        actions={<StateBadge state={capability.state} />}
      />

      <div className="kx-notice" data-tone="info" style={{ marginBottom: 16 }}>
        <Icon name="info" size={18} />
        <div>{t("visualPatch.localOnly")}</div>
      </div>

      <div className="kx-tool-layout">
        {/* ---------------- tools ---------------- */}
        <section className="kx-card">
          <div className="kx-card-title">
            <span>{t("visualPatch.tools")}</span>
            <span className="kx-badge" data-state="PARTIAL">{tools.length}</span>
          </div>

          <div className="kx-segmented" style={{ marginTop: 12, flexWrap: "wrap" }}>
            <button type="button" aria-pressed={family === "all"} onClick={() => setFamily("all")}>
              {t("visualPatch.allFamilies")}
            </button>
            {FAMILY_ORDER.filter((entry) =>
              tools.some((tool) => tool.category === entry),
            ).map((entry) => (
              <button
                key={entry}
                type="button"
                aria-pressed={family === entry}
                onClick={() => setFamily(entry)}
              >
                {FAMILY_LABELS[entry] ?? entry}
              </button>
            ))}
          </div>

          <div className="kx-scroll-x" style={{ marginTop: 12, maxHeight: 460, overflowY: "auto" }}>
            {loading ? (
              <EmptyState icon="refresh" title={t("visualPatch.loading")} hint={t("visualPatch.loadingHint")} />
            ) : loadError ? (
              <EmptyState icon="alert" title={t("visualPatch.loadFailed")} hint={loadError} />
            ) : (
              visibleTools.map((tool) => (
                <button
                  key={tool.id}
                  type="button"
                  className="kx-ai-row"
                  data-active={selectedId === tool.id}
                  onClick={() => {
                    setSelectedId(tool.id);
                    setIntensity(tool.defaultIntensity);
                    setBrushSize(tool.defaultBrushSize);
                    setFeather(tool.defaultFeather);
                  }}
                >
                  <span className="kx-ai-row-icon">
                    <Icon name="patch" size={17} />
                  </span>
                  <span className="kx-ai-row-body">
                    <span className="kx-ai-row-title">{tool.name}</span>
                    <span className="kx-ai-row-sub">
                      {tool.nameAr} · {tool.editMode}
                    </span>
                  </span>
                  <span className="kx-badge" data-state="PARTIAL">
                    {tool.processingComplexity}
                  </span>
                </button>
              ))
            )}
          </div>
        </section>

        {/* ---------------- canvas ---------------- */}
        <section className="kx-tool-stage">
          <div className="kx-preview" style={{ position: "relative" }}>
            {sessionId ? (
              <>
                <canvas ref={displayRef} style={{ width: "100%", height: "auto" }} />
                <canvas
                  ref={paintRef}
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    cursor: "crosshair",
                    touchAction: "none",
                  }}
                  onPointerDown={(event) => {
                    const point = pointerPosition(event);
                    if (!point) return;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setPainting(true);
                    setRegions((current) => [
                      ...current,
                      {
                        id: `region-${Date.now()}`,
                        points: [point],
                        intensity,
                        brushSize,
                        feather,
                      },
                    ]);
                  }}
                  onPointerMove={(event) => {
                    if (!painting) return;
                    const point = pointerPosition(event);
                    if (!point) return;
                    setRegions((current) => {
                      if (current.length === 0) return current;
                      const next = [...current];
                      const last = next[next.length - 1];
                      next[next.length - 1] = { ...last, points: [...last.points, point] };
                      return next;
                    });
                  }}
                  onPointerUp={() => setPainting(false)}
                />
              </>
            ) : (
              <div className="kx-preview-idle">
                <Icon name="patch" size={34} />
                <div className="kx-empty-title">{t("visualPatch.noImage")}</div>
                <p className="kx-empty-hint">{t("visualPatch.noImageHint")}</p>
                <button
                  type="button"
                  className="kx-btn kx-btn-primary"
                  onClick={() => inputRef.current?.click()}
                >
                  <Icon name="upload" size={15} />
                  {t("visualPatch.chooseImage")}
                </button>
              </div>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                if (chosen) void loadFile(chosen, chosen.name);
                event.target.value = "";
              }}
            />
          </div>

          {status && (
            <div className="kx-row" style={{ gap: 8, flexWrap: "wrap" }}>
              <span className="kx-chip">{status}</span>
              {regions.length > 0 && (
                <span className="kx-chip">
                  {t("visualPatch.regions")} {regions.length}
                </span>
              )}
            </div>
          )}

          {error && (
            <div className="kx-notice" data-tone="danger">
              <Icon name="alert" size={16} />
              <div>{error}</div>
            </div>
          )}
        </section>

        {/* ---------------- settings ---------------- */}
        <section className="kx-card kx-tool-settings">
          <div className="kx-card-title">
            <span>{t("visualPatch.settings")}</span>
            <Icon name="settings" size={16} />
          </div>

          {selected ? (
            <>
              <p className="kx-card-sub" style={{ marginTop: 8 }}>
                {selected.description}
              </p>
              <div className="kx-mono kx-muted" style={{ fontSize: "0.7rem" }}>
                {selected.id} · {selected.editMode}
              </div>
            </>
          ) : (
            <p className="kx-card-sub" style={{ marginTop: 8 }}>
              {t("visualPatch.selectTool")}
            </p>
          )}

          <div className="kx-col" style={{ gap: 12, marginTop: 14 }}>
            <label className="kx-field">
              <span className="kx-label">
                {t("visualPatch.intensity")} <output className="kx-mono">{intensity}</output>
              </span>
              <input
                type="range"
                min={0}
                max={selected?.maxIntensity ?? 100}
                value={intensity}
                onChange={(event) => setIntensity(Number(event.target.value))}
                disabled={!selected}
              />
            </label>
            <label className="kx-field">
              <span className="kx-label">
                {t("visualPatch.brushSize")} <output className="kx-mono">{brushSize}</output>
              </span>
              <input
                type="range"
                min={2}
                max={selected?.maxBrushSize ?? 120}
                value={brushSize}
                onChange={(event) => setBrushSize(Number(event.target.value))}
                disabled={!selected}
              />
            </label>
            <label className="kx-field">
              <span className="kx-label">
                {t("visualPatch.feather")} <output className="kx-mono">{feather}</output>
              </span>
              <input
                type="range"
                min={0}
                max={50}
                value={feather}
                onChange={(event) => setFeather(Number(event.target.value))}
                disabled={!selected}
              />
            </label>
          </div>

          <div className="kx-divider" />

          <div className="kx-tool-actions">
            <button
              type="button"
              className="kx-btn kx-btn-primary"
              onClick={() => void applyTool()}
              disabled={!selected || busy || !sessionId}
            >
              <Icon name="play" size={15} />
              {t("visualPatch.apply")}
            </button>
            <button
              type="button"
              className="kx-btn"
              onClick={undo}
              disabled={!historyState.undo || busy}
            >
              {t("visualPatch.undo")}
            </button>
            <button
              type="button"
              className="kx-btn"
              onClick={redo}
              disabled={!historyState.redo || busy}
            >
              {t("visualPatch.redo")}
            </button>
            <button type="button" className="kx-btn" onClick={reset} disabled={!sessionId || busy}>
              {t("visualPatch.reset")}
            </button>
          </div>

          <div className="kx-tool-actions" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="kx-btn"
              onClick={() => setShowOriginal((current) => !current)}
              disabled={!sessionId}
            >
              <Icon name="eye" size={15} />
              {showOriginal ? t("visualPatch.showResult") : t("visualPatch.showOriginal")}
            </button>
            <button
              type="button"
              className="kx-btn"
              onClick={() => void exportPng()}
              disabled={!sessionId || busy}
            >
              <Icon name="external" size={15} />
              {t("visualPatch.export")}
            </button>
          </div>

          {sessionId && (
            <>
              <div className="kx-divider" />
              <div className="kx-card-title" style={{ fontSize: "0.84rem" }}>
                <span>{t("visualPatch.fromLibrary")}</span>
              </div>
              <div className="kx-scroll-x" style={{ maxHeight: 160, overflowY: "auto" }}>
                {items
                  .filter((item) => item.mimeType.startsWith("image/"))
                  .slice(0, 12)
                  .map((item) => (
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
                        void loadFile(blob, item.name);
                      }}
                    >
                      <span>{item.name}</span>
                      <span className="kx-mono kx-muted">{formatBytes(item.size)}</span>
                    </button>
                  ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
