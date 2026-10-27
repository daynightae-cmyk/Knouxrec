import { useEffect, useMemo, useState } from "react";
import { Icon } from "../app/icons";
import { CAPABILITIES } from "../app/capabilities";
import { translate } from "../i18n/translate";
import { useSettings } from "../state/SettingsContext";
import {
  AI_CATALOG,
  AI_CATALOG_CATEGORIES,
  type AiTaskCategory,
} from "../data/aiCatalog";
import {
  inspectModels,
  type ModelInspection,
} from "../services/modelRegistry";
import { runtimeFor } from "../data/aiRuntime";
import {
  convertArabicNumerals,
  stripDiacritics,
  normalizeArabic,
  arabicWordCount,
} from "../services/arabicOps";
import { downloadBlob } from "../lib/format";
import AiTaskRunner from "./AiTaskRunner";
import { EmptyState, SectionHeader, StateBadge } from "./ui";

export type AiWorkspaceVariant = "offline-ai" | "arabic-ai";

const CATEGORY_ICONS: Record<AiTaskCategory, "image" | "video" | "audio" | "pencil" | "layers"> = {
  image: "image",
  video: "video",
  audio: "audio",
  text: "pencil",
  analysis: "layers",
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export default function AiWorkspaceView({ variant }: { variant: AiWorkspaceVariant }) {
  const { settings } = useSettings();
  const t = (key: string) => translate(settings.language, key);
  const capability = CAPABILITIES[variant];

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<AiTaskCategory | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [models, setModels] = useState<Record<string, ModelInspection>>({});
  const [inspecting, setInspecting] = useState(true);

  const preferArabic = variant === "arabic-ai" || settings.language === "ar";

  // Arabic text utilities — deterministic, offline, no model. Wired to a real
  // user action with real output and export so `ar-tools` is backed by a UI
  // consumer rather than tests alone.
  const [arabicText, setArabicText] = useState("");
  const [arabicResult, setArabicResult] = useState<string | null>(null);
  const [arabicOp, setArabicOp] = useState<string | null>(null);

  const runArabicOp = (op: string) => {
    let result: string | null = null;
    switch (op) {
      case "to-western":
        result = convertArabicNumerals(arabicText, "to-western");
        break;
      case "to-arabic":
        result = convertArabicNumerals(arabicText, "to-arabic");
        break;
      case "strip":
        result = stripDiacritics(arabicText);
        break;
      case "normalize":
        result = normalizeArabic(arabicText);
        break;
      case "count":
        result = String(arabicWordCount(arabicText));
        break;
    }
    setArabicResult(result);
    setArabicOp(op);
  };

  const exportArabic = () => {
    if (!arabicResult || !arabicOp) return;
    const blob = new Blob([arabicResult], { type: "text/plain;charset=utf-8" });
    downloadBlob(blob, `arabic-tools-${arabicOp}.txt`);
  };

  useEffect(() => {
    let cancelled = false;
    const ids = [...new Set(AI_CATALOG.map((entry) => entry.modelId))];
    const run = async () => {
      const inspected = await inspectModels(ids);
      if (cancelled) return;
      const map: Record<string, ModelInspection> = {};
      for (const model of inspected) map[model.id] = model;
      setModels(map);
      setInspecting(false);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return AI_CATALOG.filter((entry) => {
      const matchesCategory = category === "all" || entry.category === category;
      if (!matchesCategory) return false;
      if (!needle) return true;
      return (
        entry.id.includes(needle) ||
        entry.nameEn.toLowerCase().includes(needle) ||
        entry.nameAr.includes(query.trim()) ||
        entry.descriptionEn.toLowerCase().includes(needle) ||
        entry.descriptionAr.includes(query.trim()) ||
        entry.aliases.some((alias) => alias.includes(needle))
      );
    });
  }, [query, category]);

  const selected = useMemo(
    () => AI_CATALOG.find((entry) => entry.id === selectedId) ?? null,
    [selectedId],
  );

  const selectedModel = selected ? models[selected.modelId] : undefined;
  const weightsPresent = selectedModel?.weightsState === "present";
  const selectedRuntime = selected ? runtimeFor(selected.id) : undefined;
  const localTasks = useMemo(
    () => AI_CATALOG.filter((entry) => runtimeFor(entry.id)).length,
    [],
  );
  const modelTasks = AI_CATALOG.length - localTasks;

  return (
    <div className="kx-section">
      <SectionHeader
        eyebrow={t("groupIntelligence")}
        title={t(capability.labelKey)}
        description={t("ai.description")}
        actions={<StateBadge state={capability.state} />}
      />

      <div className="kx-notice" data-tone="info" style={{ marginBottom: 16 }}>
        <Icon name="info" size={18} />
        <div>
          <strong>{t("ai.unifiedTitle")}</strong> {t("ai.unifiedBody")}
        </div>
      </div>

      <div
        className="kx-notice"
        data-tone="ok"
        style={{ marginBottom: 16 }}
        data-ai-runtime-summary
      >
        <Icon name="cpu" size={18} />
        <div>
          <strong data-ai-local-count>{localTasks}</strong> {t("ai.localRuntimeBody")}{" "}
          <strong data-ai-model-count>{modelTasks}</strong> {t("ai.modelRuntimeBody")}
        </div>
      </div>

      {variant === "arabic-ai" && <ArabicToolsPanel
        t={t}
        text={arabicText}
        onTextChange={setArabicText}
        runOp={runArabicOp}
        result={arabicResult}
        exportResult={exportArabic}
      />}

      <div className="kx-row" style={{ gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <input
          className="kx-input kx-search"
          type="search"
          value={query}
          placeholder={t("ai.searchPlaceholder")}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t("ai.searchPlaceholder")}
        />
        <div className="kx-segmented" role="group" aria-label={t("ai.category")}>
          <button
            type="button"
            aria-pressed={category === "all"}
            onClick={() => setCategory("all")}
          >
            {t("ai.all")}
          </button>
          {AI_CATALOG_CATEGORIES.map((entry) => (
            <button
              key={entry}
              type="button"
              aria-pressed={category === entry}
              onClick={() => setCategory(entry)}
            >
              {t(`ai.category.${entry}`)}
            </button>
          ))}
        </div>
        <span className="kx-badge" data-state="PARTIAL">
          {filtered.length} / {AI_CATALOG.length}
        </span>
      </div>

      <div className="kx-ai-layout">
        <div className="kx-ai-list">
          {filtered.length === 0 ? (
            <EmptyState
              icon="search"
              title={t("ai.noMatch")}
              hint={t("ai.noMatchHint")}
            />
          ) : (
            filtered.map((entry) => {
              const model = models[entry.modelId];
              const runtime = runtimeFor(entry.id);
              const ready = model?.weightsState === "present";
              return (
                <button
                  key={entry.id}
                  type="button"
                  className="kx-ai-row"
                  data-task-id={entry.id}
                  data-active={selectedId === entry.id}
                  data-runtime={runtime ? "local" : "model"}
                  onClick={() => setSelectedId(entry.id)}
                  aria-pressed={selectedId === entry.id}
                >
                  <span className="kx-ai-row-icon">
                    <Icon name={CATEGORY_ICONS[entry.category]} size={17} />
                  </span>
                  <span className="kx-ai-row-body">
                    <span className="kx-ai-row-title">
                      {preferArabic ? entry.nameAr : entry.nameEn}
                    </span>
                    <span className="kx-ai-row-sub">
                      {preferArabic ? entry.nameEn : entry.nameAr} · {entry.id}
                    </span>
                  </span>
                  <span
                    className="kx-badge"
                    data-state={runtime ? "PARTIAL" : ready ? "PARTIAL" : "MISSING_MODEL"}
                  >
                    {runtime
                      ? t("ai.runsLocally")
                      : ready
                        ? t("ai.weightsPresent")
                        : t("ai.weightsMissing")}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <aside className="kx-ai-detail">
          {!selected ? (
            <EmptyState
              icon="brain"
              title={t("ai.selectPrompt")}
              hint={t("ai.selectHint")}
            />
          ) : (
            <>
              <div className="kx-card-title">
                <span>{preferArabic ? selected.nameAr : selected.nameEn}</span>
                <Icon name={CATEGORY_ICONS[selected.category]} size={17} />
              </div>
              <p className="kx-card-sub" style={{ marginTop: 6 }}>
                {preferArabic ? selected.descriptionAr : selected.descriptionEn}
              </p>

              <div className="kx-divider" />

              <div className="kx-grid kx-grid-2" style={{ gap: 10 }}>
                <div>
                  <div className="kx-muted">{t("ai.input")}</div>
                  <strong>{selected.inputType}</strong>
                </div>
                <div>
                  <div className="kx-muted">{t("ai.output")}</div>
                  <strong>{selected.outputType}</strong>
                </div>
                <div>
                  <div className="kx-muted">{t("ai.difficulty")}</div>
                  <strong>{selected.difficulty}</strong>
                </div>
                <div>
                  <div className="kx-muted">{t("ai.credits")}</div>
                  <strong>{selected.credits}</strong>
                </div>
              </div>

              <div className="kx-divider" />

              {selectedRuntime ? (
                <AiTaskRunner
                  entry={selected}
                  runtime={selectedRuntime}
                  preferArabic={preferArabic}
                />
              ) : (
                <>
                  <div className="kx-card-title" style={{ fontSize: "0.84rem" }}>
                    <span>{t("ai.modelRequirement")}</span>
                  </div>
                  <table className="kx-table" style={{ marginTop: 8 }}>
                    <tbody>
                      <tr>
                        <td className="kx-muted">{t("ai.modelFolder")}</td>
                        <td className="kx-mono">/models/{selected.modelId}</td>
                      </tr>
                      <tr>
                        <td className="kx-muted">{t("ai.manifest")}</td>
                        <td className="kx-mono">
                          {selected.modelPath}
                          {selectedModel?.manifestSha256 && (
                            <div className="kx-muted kx-mono" style={{ fontSize: "0.68rem" }}>
                              sha256 {selectedModel.manifestSha256.slice(0, 24)}…
                            </div>
                          )}
                        </td>
                      </tr>
                      <tr>
                        <td className="kx-muted">{t("ai.expectedWeights")}</td>
                        <td className="kx-mono">
                          {selectedModel
                            ? `${formatBytes(selectedModel.expectedWeightsBytes)} · ${selectedModel.tensorCount} tensors`
                            : "—"}
                        </td>
                      </tr>
                      <tr>
                        <td className="kx-muted">{t("ai.actualWeights")}</td>
                        <td className="kx-mono">
                          {inspecting
                            ? t("ai.inspecting")
                            : selectedModel
                              ? selectedModel.weightsState === "present"
                                ? formatBytes(selectedModel.weightsBytes)
                                : t("ai.notInstalled")
                              : "—"}
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <div
                    className="kx-notice"
                    data-tone={weightsPresent ? "warn" : "danger"}
                    style={{ marginTop: 12 }}
                  >
                    <Icon name={weightsPresent ? "alert" : "lock"} size={16} />
                    <div>
                      {weightsPresent
                        ? t("ai.blockedRuntime")
                        : t("ai.blockedWeights")}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="kx-btn kx-btn-primary"
                    disabled
                    style={styles.blockedButton}
                  >
                    <Icon name="play" size={15} />
                    {t("ai.runDisabled")}
                  </button>
                </>
              )}

              <div className="kx-divider" />
              <div className="kx-card-title" style={{ fontSize: "0.84rem" }}>
                <span>{t("ai.aliases")}</span>
              </div>
              <div className="kx-row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                {selected.aliases.map((alias) => (
                  <span key={alias} className="kx-chip kx-mono">
                    {alias}
                  </span>
                ))}
              </div>
              {selected.features.length > 0 && (
                <>
                  <div className="kx-card-title" style={{ fontSize: "0.84rem", marginTop: 12 }}>
                    <span>{t("ai.features")}</span>
                  </div>
                  <div className="kx-row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                    {selected.features.map((feature) => (
                      <span key={feature} className="kx-chip">
                        {feature}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </aside>
      </div>

      <div className="kx-notice" data-tone="info" style={{ marginTop: 16 }}>
        <Icon name="shield" size={18} />
        <div>{t("ai.privacy")}</div>
      </div>
    </div>
  );
}

function ArabicToolsPanel({
  t,
  text,
  onTextChange,
  runOp,
  result,
  exportResult,
}: {
  t: (key: string) => string;
  text: string;
  onTextChange: (value: string) => void;
  runOp: (op: string) => void;
  result: string | null;
  exportResult: () => void;
}) {
  return (
    <div className="kx-card" style={{ marginBottom: 16 }}>
      <div className="kx-card-title" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Icon name="pencil" size={16} />
        <strong>{t("arabicTools.title")}</strong>
      </div>
      <div className="kx-muted kx-card-sub" style={{ marginTop: 6 }}>{t("arabicTools.subtitle")}</div>
      <div style={{ marginTop: 12 }}>
        <label className="kx-field" style={{ display: "block", marginBottom: 8 }}>
          <span className="kx-label">{t("arabicTools.input")}</span>
          <textarea
            className="kx-input"
            value={text}
            onChange={(event) => onTextChange(event.target.value)}
            placeholder={t("arabicTools.inputHint")}
            rows={3}
            dir="auto"
            spellCheck={false}
          />
        </label>
        <div className="kx-row" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <button type="button" className="kx-btn" onClick={() => runOp("to-western")}>
            {t("arabicTools.toWestern")}
          </button>
          <button type="button" className="kx-btn" onClick={() => runOp("to-arabic")}>
            {t("arabicTools.toArabic")}
          </button>
          <button type="button" className="kx-btn" onClick={() => runOp("strip")}>
            {t("arabicTools.stripDiacritics")}
          </button>
          <button type="button" className="kx-btn" onClick={() => runOp("normalize")}>
            {t("arabicTools.normalize")}
          </button>
          <button type="button" className="kx-btn" onClick={() => runOp("count")}>
            {t("arabicTools.wordCount")}
          </button>
        </div>
        {result !== null && (
          <div style={{ marginTop: 10 }}>
            <div className="kx-row" style={{ gap: 8, alignItems: "center", marginBottom: 8 }}>
              <strong style={{ fontSize: "0.78rem" }}>{t("arabicTools.output")}</strong>
              <button
                type="button"
                className="kx-btn kx-btn-sm"
                onClick={exportResult}
              >
                <Icon name="download" size={13} />
                {t("arabicTools.export")}
              </button>
            </div>
            <div className="kx-mono" style={{ marginTop: 8, padding: 10, borderRadius: 6 }}>
              {result}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  blockedButton: { opacity: 0.55, cursor: "not-allowed" } as React.CSSProperties,
};
