import { Icon } from "./icons";
import { CAPABILITIES, NAVIGATION, type RouteId } from "./capabilities";
import { useSettings } from "../state/SettingsContext";
import { useRecorder } from "../state/RecorderContext";
import { translate } from "../i18n/translate";
import { formatDuration } from "../lib/format";

export default function TopBar({
  route,
  onNavigate,
  canBack,
  canForward,
  onBack,
  onForward,
}: {
  route: RouteId;
  onNavigate: (route: RouteId) => void;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
}) {
  const { settings, update } = useSettings();
  const recorder = useRecorder();
  const t = (key: string) => translate(settings.language, key);
  const capability = CAPABILITIES[route];
  const group = NAVIGATION.find((entry) => entry.routes.includes(route));

  const statusLabel =
    recorder.status === "recording"
      ? t("recording")
      : recorder.status === "paused"
        ? t("paused")
        : recorder.status === "requesting"
          ? t("shell.status.requesting")
          : recorder.status === "stopping"
            ? t("shell.status.saving")
            : recorder.status === "error"
              ? t("shell.status.error")
              : t("ready");

  const tone =
    recorder.status === "recording"
      ? "live"
      : recorder.status === "paused" || recorder.status === "error"
        ? "warn"
        : recorder.status === "idle"
          ? "ok"
          : "default";

  return (
    <header className="kx-topbar">
      <div className="kx-history" role="group" aria-label={t("a11y.navigationHistory")}>
        <button
          type="button"
          className="kx-icon-button kx-icon-button-sm"
          onClick={onBack}
          disabled={!canBack}
          title={t("a11y.goBack")}
          aria-label={t("a11y.goBack")}
        >
          <Icon name="arrowLeft" size={16} />
        </button>
        <button
          type="button"
          className="kx-icon-button kx-icon-button-sm"
          onClick={onForward}
          disabled={!canForward}
          title={t("a11y.goForward")}
          aria-label={t("a11y.goForward")}
        >
          <Icon name="expand" size={16} />
        </button>
      </div>

      <div className="kx-topbar-heading">
        <span className="kx-topbar-title">{t(capability.labelKey)}</span>
        <span className="kx-breadcrumb">
          {group && (
            <>
              <span>{t(group.labelKey)}</span>
              <Icon name="chevronRight" size={11} />
            </>
          )}
          <span aria-current="page">{t(capability.labelKey)}</span>
        </span>
      </div>

      <div className="kx-topbar-spacer" />

      <button
        type="button"
        className="kx-status-chip"
        data-tone={tone}
        onClick={() => onNavigate("studio")}
        title={t("a11y.openRecorder")}
      >
        <span className="kx-status-dot" />
        {statusLabel}
        {(recorder.status === "recording" || recorder.status === "paused") && (
          <span className="kx-mono" style={{ color: "inherit" }}>
            {formatDuration(recorder.elapsed)}
          </span>
        )}
      </button>

      <button
        type="button"
        className="kx-icon-button"
        title={t("captureScreenshot")}
        aria-label={t("captureScreenshot")}
        onClick={() => void recorder.takeScreenshot()}
        disabled={!recorder.support.display && !recorder.previewStream}
      >
        <Icon name="camera" size={18} />
      </button>

      <button
        type="button"
        className="kx-icon-button"
        title={settings.theme === "dark" ? t("light") : t("dark")}
        aria-label={settings.theme === "dark" ? t("light") : t("dark")}
        onClick={() => update({ theme: settings.theme === "dark" ? "light" : "dark" })}
      >
        <Icon name={settings.theme === "dark" ? "sun" : "moon"} size={18} />
      </button>

      <button
        type="button"
        className="kx-icon-button"
        title={settings.language === "en" ? "العربية" : "English"}
        aria-label={
          settings.language === "en" ? t("a11y.switchToArabic") : t("a11y.switchToEnglish")
        }
        onClick={() => update({ language: settings.language === "en" ? "ar" : "en" })}
        style={{ fontSize: "0.7rem", fontWeight: 700 }}
      >
        {settings.language === "en" ? "AR" : "EN"}
      </button>

      <button
        type="button"
        className="kx-icon-button"
        data-active={route === "settings"}
        title={t("settings")}
        aria-label={t("settings")}
        onClick={() => onNavigate("settings")}
      >
        <Icon name="settings" size={18} />
      </button>
    </header>
  );
}
