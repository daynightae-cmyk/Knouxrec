import { useEffect, useState } from "react";
import { CAPABILITIES } from "../app/capabilities";
import {
  CapabilityNotice,
  EmptyState,
  SectionHeader,
  StatCard,
  StateBadge,
} from "./ui";
import { useSettings } from "../state/SettingsContext";
import { translate } from "../i18n/translate";

interface ModelRow {
  id: string;
  name: string;
  description: string;
  weightsPath: string;
  weightsState: "checking" | "present" | "missing";
  weightsBytes: number;
}

const MODEL_IDS = [
  "animatediff",
  "bark_tts",
  "beat_detector",
  "face_detection",
  "gpt4all",
  "llama2",
  "m2m100",
  "modnet",
  "real_esrgan",
  "rnnoise",
  "sadtalker",
  "sam",
  "scenecut",
  "selfie_segmentation",
  "simswap",
  "sovits",
  "spleeter",
  "stable_diffusion",
  "super_resolution",
  "u2net",
  "videocrafter",
  "wav2lip",
  "whisper",
  "yolo",
];

async function inspectModel(id: string): Promise<ModelRow> {
  const fallback: ModelRow = {
    id,
    name: id,
    description: "",
    weightsPath: `models/${id}/weights.bin`,
    weightsState: "missing",
    weightsBytes: 0,
  };

  const bridge = window.knouxDesktop;
  if (bridge?.inspectModel) {
    try {
      const info = await bridge.inspectModel(id);
      if (!info) return fallback;
      return {
        id: info.id,
        name: info.name,
        description: info.description,
        weightsPath: info.weightsPath,
        weightsState: info.weightsState,
        weightsBytes: info.weightsBytes,
      };
    } catch {
      return fallback;
    }
  }

  try {
    const manifestUrl = new URL(`models/${id}/model.json`, document.baseURI);
    const response = await fetch(manifestUrl);
    if (!response.ok) return fallback;
    const manifest = (await response.json()) as {
      modelName?: string;
      description?: string;
      weightsManifest?: { paths?: string[] }[];
    };
    const path = manifest.weightsManifest?.[0]?.paths?.[0] ?? "weights.bin";
    let weightsState: ModelRow["weightsState"] = "missing";
    let weightsBytes = 0;
    try {
      const weights = await fetch(
        new URL(`models/${id}/${path}`, document.baseURI),
        { method: "HEAD" },
      );
      const contentType = weights.headers.get("content-type") ?? "";
      if (weights.ok && !contentType.includes("text/html")) {
        weightsState = "present";
        weightsBytes = Number(weights.headers.get("content-length") ?? 0) || 0;
      }
    } catch {
      weightsState = "missing";
    }
    return {
      id,
      name: manifest.modelName ?? id,
      description: manifest.description ?? "",
      weightsPath: path,
      weightsState,
      weightsBytes,
    };
  } catch {
    return fallback;
  }
}

export default function ModelsView() {
  const capability = CAPABILITIES.models;
  const { settings } = useSettings();
  const t = (key: string) => translate(settings.language, key);
  const [rows, setRows] = useState<ModelRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const inspected = await Promise.all(MODEL_IDS.map(inspectModel));
      if (!cancelled) {
        setRows(inspected);
        setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const present = rows.filter((row) => row.weightsState === "present").length;
  const totalBytes = rows.reduce((sum, row) => sum + row.weightsBytes, 0);

  return (
    <div className="kx-section">
      <SectionHeader
        eyebrow={t("groupIntelligence")}
        title={t("models.title")}
        description={t("models.description")}
        actions={<StateBadge state={capability.state} />}
      />
      <CapabilityNotice capability={capability} />

      <div className="kx-grid kx-grid-3">
        <StatCard label={t("models.manifests")} value={String(rows.length)} hint={t("models.manifestsHint")} />
        <StatCard
          label={t("models.weightFiles")}
          value={String(present)}
          hint={t("models.weightFilesHint")}
        />
        <StatCard
          label={t("models.weightPayload")}
          value={totalBytes > 0 ? `${(totalBytes / 1024 / 1024).toFixed(1)} MB` : "0 B"}
          hint={t("models.measuredFromHead")}
        />
      </div>

      {loading ? (
        <EmptyState
          icon="refresh"
          title={t("models.inspecting")}
          hint={t("models.inspectingHint")}
        />
      ) : (
        <div className="kx-card kx-scroll-x" style={{ padding: 0 }}>
          <table className="kx-table">
            <thead>
              <tr>
                <th>{t("models.model")}</th>
                <th>{t("models.manifest")}</th>
                <th>{t("models.weightFile")}</th>
                <th>{t("models.status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.name}</strong>
                    <div className="kx-mono kx-muted">{row.id}</div>
                  </td>
                  <td className="kx-mono">
                    /models/{row.id}/model.json
                    {row.description && (
                      <div className="kx-muted" style={{ maxWidth: 320, marginTop: 4 }}>
                        {row.description}
                      </div>
                    )}
                  </td>
                  <td className="kx-mono">
                    {row.weightsPath}
                    {row.weightsBytes > 0 && (
                      <div className="kx-muted">
                        {(row.weightsBytes / 1024 / 1024).toFixed(1)} MB
                      </div>
                    )}
                  </td>
                  <td>
                    <span
                      className="kx-badge"
                      data-state={row.weightsState === "present" ? "VERIFIED" : "MISSING_MODEL"}
                    >
                      {row.weightsState === "present" ? "Present" : "Missing"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="kx-notice" data-tone="danger">
        <strong>{t("models.honestResult")}</strong> manifests describe graph metadata only. Until the
        matching weight binaries are shipped and verified, all AI tools that depend on
        them stay disabled.
      </div>
    </div>
  );
}
