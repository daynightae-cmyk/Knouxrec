import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../app/icons";
import { CAPABILITIES } from "../app/capabilities";
import {
  CapabilityNotice,
  EmptyState,
  SectionHeader,
  StatCard,
  StateBadge,
} from "./ui";
import { useSettings } from "../state/SettingsContext";
import { useToast } from "../state/ToastContext";
import { translate } from "../i18n/translate";
import {
  inspectModels,
  MODEL_IDS,
  type ModelInspection,
} from "../services/modelRegistry";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

type WeightFilter = "all" | "present" | "missing";

interface WeightCheck {
  fileName: string;
  bytes: number;
  sha256: string;
  verdict: "match" | "mismatch" | "no-baseline";
  expectedBytes: number;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export default function ModelsView() {
  const capability = CAPABILITIES.models;
  const { settings } = useSettings();
  const { push } = useToast();
  const t = (key: string) => translate(settings.language, key);
  const [rows, setRows] = useState<ModelInspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<WeightFilter>("all");
  const [query, setQuery] = useState("");
  const [checks, setChecks] = useState<Record<string, WeightCheck>>({});
  const [checking, setChecking] = useState<string | null>(null);
  const weightInputRef = useRef<HTMLInputElement | null>(null);
  const checkTargetRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const inspected = await inspectModels(MODEL_IDS);
      if (cancelled) return;
      setRows(inspected);
      setLoading(false);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "present" && row.weightsState === "present") ||
        (filter === "missing" && row.weightsState !== "present");
      if (!matchesFilter) return false;
      if (!needle) return true;
      return (
        row.id.includes(needle) ||
        row.name.toLowerCase().includes(needle) ||
        row.capabilities.some((capabilityName) =>
          capabilityName.toLowerCase().includes(needle),
        )
      );
    });
  }, [rows, filter, query]);

  const present = rows.filter((row) => row.weightsState === "present").length;
  const totalBytes = rows.reduce((sum, row) => sum + row.weightsBytes, 0);
  const expectedBytes = rows.reduce((sum, row) => sum + row.expectedWeightsBytes, 0);
  const manifestBytes = rows.reduce((sum, row) => sum + row.manifestBytes, 0);

  const startCheck = (id: string) => {
    checkTargetRef.current = id;
    const input = weightInputRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  };

  const onWeightFile = async (file: File | null) => {
    const target = checkTargetRef.current;
    const row = rows.find((entry) => entry.id === target);
    checkTargetRef.current = null;
    if (!file || !row) return;
    setChecking(row.id);
    try {
      const buffer = await file.arrayBuffer();
      const sha256 = await sha256Hex(buffer);
      const expected = row.expectedWeightsBytes;
      const verdict: WeightCheck["verdict"] =
        expected <= 0 ? "no-baseline" : buffer.byteLength === expected ? "match" : "mismatch";
      setChecks((current) => ({
        ...current,
        [row.id]: {
          fileName: file.name,
          bytes: buffer.byteLength,
          sha256,
          verdict,
          expectedBytes: expected,
        },
      }));
      push(
        verdict === "match" ? "success" : "info",
        verdict === "match"
          ? t("models.validFile")
          : verdict === "mismatch"
            ? t("models.invalidFile")
            : t("models.noBaseline"),
        `${file.name} · ${formatBytes(buffer.byteLength)}`,
      );
    } catch (cause) {
      push(
        "error",
        t("models.validateFile"),
        cause instanceof Error ? cause.message : String(cause),
      );
    } finally {
      setChecking(null);
    }
  };

  return (
    <div className="kx-section">
      <SectionHeader
        eyebrow={t("groupIntelligence")}
        title={t("models.title")}
        description={t("models.description")}
        actions={<StateBadge state={capability.state} />}
      />
      <CapabilityNotice capability={capability} />

      <div className="kx-grid kx-grid-4">
        <StatCard
          label={t("models.manifests")}
          value={String(rows.length)}
          hint={t("models.manifestsHint")}
          icon="models"
        />
        <StatCard
          label={t("models.weightFiles")}
          value={String(present)}
          hint={t("models.weightFilesHint")}
          icon="hardDrive"
        />
        <StatCard
          label={t("models.expectedWeights")}
          value={formatBytes(expectedBytes)}
          hint={t("models.expectedWeightsHint")}
          icon="layers"
        />
        <StatCard
          label={t("models.installedWeights")}
          value={formatBytes(totalBytes)}
          hint={t("models.installedWeightsHint")}
          icon="hardDrive"
        />
      </div>

      <div className="kx-row" style={{ gap: 12, margin: "18px 0 14px", flexWrap: "wrap" }}>
        <input
          className="kx-input kx-search"
          type="search"
          value={query}
          placeholder={t("models.searchPlaceholder")}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t("models.searchPlaceholder")}
        />
        <div className="kx-segmented" role="group" aria-label={t("models.filter")}>
          <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            {t("models.all")}
          </button>
          <button
            type="button"
            aria-pressed={filter === "present"}
            onClick={() => setFilter("present")}
          >
            {t("models.present")}
          </button>
          <button
            type="button"
            aria-pressed={filter === "missing"}
            onClick={() => setFilter("missing")}
          >
            {t("models.missing")}
          </button>
        </div>
        <span className="kx-badge" data-state="PARTIAL">
          {visible.length} / {rows.length}
        </span>
        <input
          ref={weightInputRef}
          type="file"
          accept=".bin,application/octet-stream"
          hidden
          onChange={(event) => void onWeightFile(event.target.files?.[0] ?? null)}
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
                <th>{t("models.expectedWeights")}</th>
                <th>{t("models.installedWeights")}</th>
                <th>{t("models.status")}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.name}</strong>
                    <div className="kx-mono kx-muted">{row.id}</div>
                    {row.version && (
                      <div className="kx-muted" style={{ fontSize: "0.72rem" }}>
                        {t("models.version")} {row.version}
                      </div>
                    )}
                    {row.capabilities.length > 0 && (
                      <div className="kx-row" style={{ gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                        {row.capabilities.slice(0, 3).map((capabilityName) => (
                          <span key={capabilityName} className="kx-chip">
                            {capabilityName}
                          </span>
                        ))}
                      </div>
                    )}
                    {row.license && (
                      <div className="kx-muted" style={{ fontSize: "0.72rem", marginTop: 4 }}>
                        {t("models.license")} {row.license}
                      </div>
                    )}
                    {row.source && (
                      <div className="kx-muted" style={{ fontSize: "0.72rem" }}>
                        {t("models.source")} {row.source}
                      </div>
                    )}
                  </td>
                  <td className="kx-mono">
                    /models/{row.id}/model.json
                    <div className="kx-muted" style={{ fontSize: "0.72rem" }}>
                      {formatBytes(row.manifestBytes)}
                    </div>
                    {row.manifestSha256 && (
                      <div className="kx-muted kx-mono" style={{ fontSize: "0.66rem" }}>
                        sha256 {row.manifestSha256.slice(0, 26)}…
                      </div>
                    )}
                  </td>
                  <td className="kx-mono">
                    {row.weightsPath.replace(`/models/${row.id}/`, "")}
                    <div className="kx-muted" style={{ fontSize: "0.72rem" }}>
                      {formatBytes(row.expectedWeightsBytes)} · {row.tensorCount}{" "}
                      {t("models.tensors")}
                    </div>
                  </td>
                  <td className="kx-mono">
                    {row.weightsState === "present" ? (
                      <>
                        {formatBytes(row.weightsBytes)}
                        <div className="kx-muted" style={{ fontSize: "0.72rem" }}>
                          {t("models.verifiedOnDisk")}
                        </div>
                      </>
                    ) : row.weightsState === "unknown" ? (
                      t("models.unknown")
                    ) : (
                      <span className="kx-muted">{t("models.notInstalled")}</span>
                    )}
                  </td>
                  <td>
                    <span
                      className="kx-badge"
                      data-state={
                        row.weightsState === "present" ? "PARTIAL" : "MISSING_MODEL"
                      }
                    >
                      {row.weightsState === "present"
                        ? t("models.weightsOnly")
                        : t("models.manifestOnly")}
                    </span>
                    <div style={{ marginTop: 8 }}>
                      <button
                        type="button"
                        className="kx-btn kx-btn-sm"
                        onClick={() => startCheck(row.id)}
                        disabled={checking === row.id}
                      >
                        <Icon name="shield" size={13} />
                        {checking === row.id
                          ? t("models.validatingFile")
                          : t("models.validateFile")}
                      </button>
                    </div>
                    {checks[row.id] && (
                      <div className="kx-model-check">
                        <span
                          className="kx-badge"
                          data-state={
                            checks[row.id].verdict === "match" ? "VERIFIED" : "BLOCKED"
                          }
                        >
                          {checks[row.id].verdict === "match"
                            ? t("models.validFile")
                            : checks[row.id].verdict === "mismatch"
                              ? t("models.invalidFile")
                              : t("models.noBaseline")}
                        </span>
                        <span className="kx-mono">
                          {checks[row.id].fileName} ·{" "}
                          {formatBytes(checks[row.id].bytes)}
                          {checks[row.id].expectedBytes > 0
                            ? ` / ${formatBytes(checks[row.id].expectedBytes)}`
                            : ""}
                        </span>
                        <span className="kx-mono">
                          sha256 {checks[row.id].sha256.slice(0, 20)}…
                        </span>
                        <span className="kx-muted">{t("models.notInstalledNote")}</span>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="kx-notice" data-tone="warn" style={{ marginTop: 16 }}>
        <Icon name="info" size={18} />
        <div>
          <strong>{t("models.honestResult")}</strong> {t("models.honestBody")} (
          {formatBytes(manifestBytes)} {t("models.ofManifests")})
        </div>
      </div>
    </div>
  );
}
