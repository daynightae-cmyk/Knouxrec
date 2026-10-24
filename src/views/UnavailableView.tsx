import { useEffect, useState } from "react";
import { CAPABILITIES, type RouteId } from "../app/capabilities";
import { useSettings } from "../state/SettingsContext";
import { translate } from "../i18n/translate";
import {
  CapabilityNotice,
  EmptyState,
  SectionHeader,
  StateBadge,
} from "./ui";
import { Icon } from "../app/icons";
import { OFFLINE_AI_CATALOG } from "../data/offlineAICatalog";

interface CatalogEntry {
  id: string;
  name: string;
  group: string;
  requirement: string;
}

const TITLES: Record<string, string> = {
  morphcore: "MorphCore catalog",
  "body-editor": "Body editor catalog",
  "offline-ai": "Offline AI catalog",
  "arabic-ai": "Arabic AI catalog",
  templates: "Template catalog",
  toolbox: "Toolbox catalog",
  "visual-patch": "Visual patch catalog",
};

const GROUP_KEYS: Record<string, string> = {
  capture: "groupRecord",
  library: "groupLibrary",
  create: "groupCreate",
  intelligence: "groupIntelligence",
  system: "groupSystem",
};

export default function UnavailableView({ route }: { route: RouteId }) {
  const { settings } = useSettings();
  const t = (key: string) => translate(settings.language, key);
  const capability = CAPABILITIES[route];
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setCatalog([]);
      setNote("");
      try {
        if (route === "morphcore") {
          const module = await import("../../services/knouxMorphCore");
          const categories = module.knouxMorphCore.getCategories();
          const entries: CatalogEntry[] = [];
          for (const category of categories) {
            for (const tool of category.tools) {
              entries.push({
                id: `${category.id}/${tool.id}`,
                name: tool.name || tool.nameEn,
                group: category.nameEn || category.name,
                requirement: tool.executable
                  ? `Missing executable: ${tool.executable}`
                  : "Missing engine",
              });
            }
          }
          if (!cancelled) setCatalog(entries);
          if (!cancelled) setNote(`${categories.length} categories read from the preserved catalog.`);
        } else if (route === "offline-ai") {
          if (!cancelled) {
            setCatalog(
              OFFLINE_AI_CATALOG.map((tool) => ({
                id: tool.id,
                name: tool.nameEn || tool.name,
                group: tool.category,
                requirement: `Missing ${tool.modelPath || "model weights"}${
                  tool.modelSize ? ` (${tool.modelSize} MB)` : ""
                }`,
              })),
            );
            setNote(
              `${OFFLINE_AI_CATALOG.length} tool definitions read from the static catalog (no inference service is started).`,
            );
          }
        } else if (route === "arabic-ai") {
          const module = await import("../../components/ArabicAIToolsPanel");
          const tools = module.ARABIC_AI_TOOLS;
          if (!cancelled) {
            setCatalog(
              tools.map((tool, index) => ({
                id: `arabic-${index}`,
                name: tool.title,
                group: `${tool.difficulty} · ${tool.modelSize} MB model`,
                requirement: "No inference engine wired",
              })),
            );
            setNote(`${tools.length} Arabic tool definitions read from the preserved panel.`);
          }
        } else if (
          route === "templates" ||
          route === "toolbox" ||
          route === "visual-patch"
        ) {
          if (!cancelled) {
            setNote(
              "The original panel is preserved in the repository but excluded from the runtime: its dependency graph does not compile and its handlers call missing processor methods.",
            );
          }
        } else {
          if (!cancelled) {
            setNote(
              "The original panel is preserved in the repository. It is not mounted because its output was fabricated.",
            );
          }
        }
      } catch (cause) {
        if (!cancelled) {
          setNote(
            cause instanceof Error
              ? cause.message
              : "The preserved catalog could not be read.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [route]);

  return (
    <div className="kx-section">
      <SectionHeader
        eyebrow={t(GROUP_KEYS[capability.group] ?? "groupIntelligence")}
        title={`${t(capability.labelKey)} · ${TITLES[route] ?? "Catalog"}`}
        description={capability.summary}
        actions={<StateBadge state={capability.state} />}
      />
      {capability.adult && (
        <div className="kx-notice" data-tone="danger">
          <Icon name="lock" size={18} />
          <div>
            <strong>{t("adult.title")}</strong> {t("adult.body")}
          </div>
        </div>
      )}
      <CapabilityNotice capability={capability} />

      <div className="kx-grid kx-grid-2">
        <div className="kx-card">
          <div className="kx-card-title">
            <span>What is preserved</span>
            <span className="kx-badge">{catalog.length} entries</span>
          </div>
          <p className="kx-card-sub">{note || "Reading the preserved catalog…"}</p>
          <div
            className="kx-scroll-x"
            style={{ marginTop: 12, maxHeight: 460, overflowY: "auto" }}
          >
            {loading ? (
              <EmptyState
                icon="refresh"
                title="Reading catalog"
                hint="Loading the preserved local definitions."
              />
            ) : catalog.length === 0 ? (
              <EmptyState
                icon="lock"
                title="No runnable catalog"
                hint="The panel source is preserved, but it exposes no verified tool metadata for execution."
              />
            ) : (
              <table className="kx-table">
                <thead>
                  <tr>
                    <th>Tool</th>
                    <th>Group</th>
                    <th>Blocker</th>
                  </tr>
                </thead>
                <tbody>
                  {catalog.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <strong>{entry.name}</strong>
                        <div className="kx-mono kx-muted">{entry.id}</div>
                      </td>
                      <td>{entry.group}</td>
                      <td>{entry.requirement}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="kx-col">
          <div className="kx-card">
            <div className="kx-card-title">
              <span>Why execution is disabled</span>
              <Icon name="lock" size={18} />
            </div>
            <p className="kx-card-sub" style={{ marginTop: 10 }}>
              {capability.evidence}
            </p>
            <div className="kx-divider" />
            <div className="kx-card-title" style={{ fontSize: "0.84rem" }}>
              Requirements before this can run
            </div>
            <ul
              className="kx-card-sub"
              style={{ paddingInlineStart: 18, marginTop: 8, lineHeight: 1.9 }}
            >
              {capability.requirements.map((requirement) => (
                <li key={requirement}>{requirement}</li>
              ))}
            </ul>
          </div>

          <div className="kx-notice" data-tone="warn">
            <Icon name="info" size={18} />
            <div>
              <strong>No simulated results.</strong> KNOUX REC will not paint fake
              frames, transcripts, or “completed” files. This section stays read-only
              until a real engine is installed and verified.
            </div>
          </div>

          <div className="kx-card">
            <div className="kx-card-title">Where the code lives</div>
            <p className="kx-card-sub" style={{ marginTop: 8 }}>
              The original components and services remain in the repository. They are
              excluded from the runtime because their previous handlers returned
              placeholders instead of real output.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
