import { useEffect, useMemo, useState } from "react";
import { CAPABILITIES } from "../app/capabilities";
import { APP_CHANNEL, APP_VERSION } from "../app/buildInfo";
import { Icon } from "../app/icons";
import {
  detectCaptureSupport,
  pickMimeType,
  type CaptureSupport,
} from "../services/recordingEngine";
import { SectionHeader, StateBadge } from "./ui";
import { formatBytes } from "../lib/format";
import { useToast } from "../state/ToastContext";
import { useSettings } from "../state/SettingsContext";
import { translate } from "../i18n/translate";

interface RuntimeInfo {
  support: CaptureSupport;
  mime: string | null;
  secureContext: boolean;
  indexedDb: boolean;
  localStorage: boolean;
  hardwareConcurrency: number;
  deviceMemory: number | null;
  fonts: { name: string; loaded: boolean }[];
  storage: { usage: number; quota: number } | null;
  userAgent: string;
  platform: string;
  online: boolean;
}

function checkIndexedDb(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(false);
      return;
    }
    try {
      const request = indexedDB.open("knoux-rec.diagnostics", 1);
      request.onsuccess = () => {
        request.result.close();
        indexedDB.deleteDatabase("knoux-rec.diagnostics");
        resolve(true);
      };
      request.onerror = () => resolve(false);
      request.onblocked = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export default function DiagnosticsView() {
  const { push } = useToast();
  const { settings } = useSettings();
  const t = (key: string) => translate(settings.language, key);
  const [info, setInfo] = useState<RuntimeInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      await document.fonts.ready.catch(() => undefined);
      const bundledFonts = ["Orbitron", "Rajdhani", "Inter", "Cairo"];
      // Web fonts are only fetched when they are used, so a font that ships
      // with the app but is not rendered yet (Cairo, until Arabic is enabled)
      // would be reported as missing. Ask the font loader for each face first.
      await Promise.all(
        bundledFonts.map((name) =>
          document.fonts?.load?.(`16px "${name}"`).catch(() => undefined),
        ),
      );
      const indexedDb = await checkIndexedDb();
      let storage: RuntimeInfo["storage"] = null;
      try {
        const estimate = await navigator.storage?.estimate?.();
        if (estimate && estimate.usage !== undefined && estimate.quota !== undefined) {
          storage = { usage: estimate.usage, quota: estimate.quota };
        }
      } catch {
        storage = null;
      }
      if (cancelled) return;
      const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };
      setInfo({
        support: detectCaptureSupport(),
        mime: pickMimeType(),
        secureContext: window.isSecureContext,
        indexedDb,
        localStorage: (() => {
          try {
            localStorage.setItem("knoux-rec.probe", "1");
            localStorage.removeItem("knoux-rec.probe");
            return true;
          } catch {
            return false;
          }
        })(),
        hardwareConcurrency: navigator.hardwareConcurrency ?? 0,
        deviceMemory: navigatorWithMemory.deviceMemory ?? null,
        fonts: bundledFonts.map((name) => ({
          name,
          loaded:
            typeof document.fonts?.check === "function"
              ? document.fonts.check(`16px "${name}"`)
              : false,
        })),
        storage,
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        online: navigator.onLine,
      });
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const capabilityRows = useMemo(() => Object.values(CAPABILITIES), []);

  const digest = useMemo(
    () =>
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          app: { version: APP_VERSION, channel: APP_CHANNEL },
          runtime: info,
          capabilities: capabilityRows.map((row) => ({
            id: row.id,
            state: row.state,
            requirements: row.requirements,
            evidence: row.evidence,
          })),
        },
        null,
        2,
      ),
    [info, capabilityRows],
  );

  const copyDigest = async () => {
    try {
      await navigator.clipboard.writeText(digest);
      push("success", t("diag.copied"), t("diag.copiedDetail"));
    } catch {
      push("error", t("diag.clipboardUnavailable"), t("diag.clipboardFallback"));
    }
  };

  return (
    <div className="kx-content">
      <SectionHeader
        eyebrow={t("groupSystem")}
        title={t("diag.title")}
        description={t("diag.description")}
        actions={
          <>
            <button type="button" className="kx-btn" onClick={() => void copyDigest()}>
              <Icon name="copy" size={16} />
              {t("copyDigest")}
            </button>
            <span className="kx-badge">v{APP_VERSION}</span>
          </>
        }
      />

      {!info ? (
        <div className="kx-empty" role="status" aria-live="polite">
          <span className="kx-spin">
            <Icon name="refresh" size={26} />
          </span>
          <div className="kx-empty-title">{t("diag.measuring")}</div>
          <p className="kx-empty-hint">
            {t("diag.probing")}
          </p>
        </div>
      ) : (
        <>
          <div className="kx-grid kx-grid-4">
            <div className="kx-card">
              <div className="kx-card-title" style={{ fontSize: "0.8rem" }}>
                {t("diag.displayCapture")}
              </div>
              <div style={{ marginTop: 8 }}>
                <span
                  className="kx-badge"
                  data-state={info.support.display ? "VERIFIED" : "BLOCKED"}
                >
                  {info.support.display ? "getDisplayMedia present" : t("diag.unavailable")}
                </span>
              </div>
              <p className="kx-card-sub" style={{ marginTop: 8 }}>
                {info.support.reason ?? t("diag.displayPickerHint")}
              </p>
            </div>
            <div className="kx-card">
              <div className="kx-card-title" style={{ fontSize: "0.8rem" }}>
                {t("diag.encoder")}
              </div>
              <div style={{ marginTop: 8 }}>
                <span
                  className="kx-badge"
                  data-state={info.support.mediaRecorder ? "VERIFIED" : "BLOCKED"}
                >
                  {info.support.mediaRecorder ? t("diag.mediaRecorderPresent") : t("diag.unavailable")}
                </span>
              </div>
              <p className="kx-card-sub kx-mono" style={{ marginTop: 8 }}>
                {info.mime || t("diag.noMime")}
              </p>
            </div>
            <div className="kx-card">
              <div className="kx-card-title" style={{ fontSize: "0.8rem" }}>
                {t("diag.localStorage")}
              </div>
              <div style={{ marginTop: 8 }}>
                <span
                  className="kx-badge"
                  data-state={info.indexedDb ? "VERIFIED" : "BLOCKED"}
                >
                  {info.indexedDb ? t("diag.indexedDbUsable") : t("diag.indexedDbBlocked")}
                </span>
              </div>
              <p className="kx-card-sub" style={{ marginTop: 8 }}>
                {info.storage
                  ? `${formatBytes(info.storage.usage)} used of ${formatBytes(info.storage.quota)} quota`
                  : t("diag.storageEstimateUnavailable")}
              </p>
            </div>
            <div className="kx-card">
              <div className="kx-card-title" style={{ fontSize: "0.8rem" }}>
                {t("diag.environment")}
              </div>
              <div style={{ marginTop: 8 }}>
                <span
                  className="kx-badge"
                  data-state={info.secureContext ? "VERIFIED" : "BLOCKED"}
                >
                  {info.secureContext ? t("diag.secureContextValue") : t("diag.notSecure")}
                </span>
              </div>
              <p className="kx-card-sub" style={{ marginTop: 8 }}>
                {info.hardwareConcurrency} logical cores
                {info.deviceMemory ? ` · ${info.deviceMemory} GB device memory` : ""}
              </p>
            </div>
          </div>

          <div className="kx-grid kx-grid-2">
            <div className="kx-card">
              <div className="kx-card-title">
                <span>{t("diag.runtimeFacts")}</span>
                <Icon name="cpu" size={18} />
              </div>
              <table className="kx-table" style={{ marginTop: 10 }}>
                <tbody>
                  <tr>
                    <td>{t("diag.platform")}</td>
                    <td className="kx-mono">{info.platform}</td>
                  </tr>
                  <tr>
                    <td>{t("diag.secureContext")}</td>
                    <td>{info.secureContext ? t("diag.yes") : t("diag.no")}</td>
                  </tr>
                  <tr>
                    <td>{t("diag.network")}</td>
                    <td>{info.online ? t("diag.online") : t("diag.offline")}</td>
                  </tr>
                  <tr>
                    <td>{t("diag.webcamMic")}</td>
                    <td>
                      {info.support.webcam ? t("diag.cameraPresent") : t("diag.unavailable")} ·{" "}
                      {info.support.microphone ? t("diag.microphonePath") : t("diag.noMicrophonePath")}
                    </td>
                  </tr>
                  <tr>
                    <td>localStorage</td>
                    <td>{info.localStorage ? "writable" : "blocked"}</td>
                  </tr>
                  <tr>
                    <td>{t("diag.userAgent")}</td>
                    <td className="kx-mono" style={{ maxWidth: 460 }}>
                      {info.userAgent}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="kx-card">
              <div className="kx-card-title">
                <span>{t("diag.bundledFonts")}</span>
                <Icon name="hash" size={18} />
              </div>
              <p className="kx-card-sub">
                Loaded from the local @fontsource packages, not a CDN.
              </p>
              <div className="kx-col" style={{ marginTop: 12 }}>
                {info.fonts.map((font) => (
                  <div className="kx-row-between" key={font.name}>
                    <span style={{ fontFamily: `"${font.name}", sans-serif` }}>
                      {font.name}
                    </span>
                    <span
                      className="kx-badge"
                      data-state={font.loaded ? "VERIFIED" : "MISSING_MODEL"}
                    >
                      {font.loaded ? "loaded" : "not detected"}
                    </span>
                  </div>
                ))}
              </div>
              <div className="kx-divider" />
              <div className="kx-row-between">
                <span className="kx-muted">{t("diag.appChannel")}</span>
                <span className="kx-mono">{APP_CHANNEL}</span>
              </div>
            </div>
          </div>

          <div className="kx-card kx-scroll-x">
            <div className="kx-card-title">
              <span>{t("diag.capabilityLedger")}</span>
              <span className="kx-badge">{capabilityRows.length} sections</span>
            </div>
            <p className="kx-card-sub">
              The same registry that drives navigation. A red state means the feature is
              present in source but cannot execute honestly in this build.
            </p>
            <table className="kx-table" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>{t("diag.section")}</th>
                  <th>{t("diag.state")}</th>
                  <th>{t("diag.requirements")}</th>
                  <th>{t("diag.evidence")}</th>
                </tr>
              </thead>
              <tbody>
                {capabilityRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.labelKey}</strong>
                      <div className="kx-mono kx-muted">{row.id}</div>
                    </td>
                    <td>
                      <StateBadge state={row.state} />
                    </td>
                    <td>{row.requirements.join(" · ") || "—"}</td>
                    <td>{row.evidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="kx-notice" data-tone="danger">
            <Icon name="lock" size={18} />
            <div>
              <strong>{t("diag.permanentGaps")}</strong> no model weight binaries
              ship with the repository, and MorphCore only contains simulated executable
              names. Those sections stay catalog-only until real engines are installed and
              verified.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
