import { useCallback, useEffect, useState } from "react";
import { useSettings } from "../state/SettingsContext";
import { useLibrary } from "../state/LibraryContext";
import { useToast } from "../state/ToastContext";
import { translate } from "../i18n/translate";
import { Icon } from "../app/icons";
import { openExternal } from "../services/externalLinks";
import {
  activateLicense,
  checkLicenseKey,
  clearLicense,
  PURCHASE_URL,
  readLicense,
  sampleLicenseKey,
} from "../services/licensing";
import { ConfirmDialog, SectionHeader, StatCard } from "./ui";
import { formatBytes, formatDuration } from "../lib/format";
import {
  comboFromEvent,
  comboParts,
  DEFAULT_HOTKEYS,
  findConflict,
  HOTKEY_ACTIONS,
  type HotkeyAction,
} from "../services/hotkeys";

export default function SettingsView() {
  const { settings, update, updateRecorder, reset } = useSettings();
  const { items } = useLibrary();
  const { push } = useToast();
  const t = useCallback((key: string) => translate(settings.language, key), [settings.language]);
  const [confirmReset, setConfirmReset] = useState(false);
  const [capturing, setCapturing] = useState<HotkeyAction | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [license, setLicense] = useState(() => readLicense());
  const [licenseInput, setLicenseInput] = useState("");

  // While a shortcut is being recorded the listener owns the keyboard: it
  // stops propagation so the very combination being entered cannot also fire
  // its old action, and Escape is the only way out without a change.
  useEffect(() => {
    if (!capturing) return;
    const handler = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setCapturing(null);
        setConflict(null);
        return;
      }
      const combo = comboFromEvent(event);
      if (!combo) return;
      const clash = findConflict(settings.hotkeys, combo, capturing);
      if (clash) {
        const label = HOTKEY_ACTIONS.find((entry) => entry.action === clash);
        setConflict(
          t("settings.hotkeyConflict")
            .replace("{combo}", combo)
            .replace("{action}", label ? t(label.labelKey) : clash),
        );
        return;
      }
      update({ hotkeys: { ...settings.hotkeys, [capturing]: combo } });
      setCapturing(null);
      setConflict(null);
      push("success", t("settings.hotkeySaved"), t("settings.hotkeySavedBody").replace("{combo}", combo));
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [capturing, push, settings.hotkeys, t, update]);

  const totalBytes = items.reduce((sum, item) => sum + item.size, 0);
  const totalSeconds = items
    .filter((item) => item.kind === "video")
    .reduce((sum, item) => sum + item.duration, 0);

  return (
    <div className="kx-content">
      <SectionHeader
        eyebrow={t("groupSystem")}
        title={t("settings")}
        description={t("settings.description")}
        actions={
          <button
            type="button"
            className="kx-btn kx-btn-danger"
            onClick={() => setConfirmReset(true)}
          >
            <Icon name="refresh" size={16} />
            {t("resetSettings")}
          </button>
        }
      />

      <div className="kx-grid kx-grid-2">
        <div className="kx-card">
          <div className="kx-card-title">
            <span>{t("theme")}</span>
            <Icon name="sun" size={18} />
          </div>
          <p className="kx-card-sub">
            {t("settings.appearanceHint")}
          </p>

          <div className="kx-col" style={{ marginTop: 14 }}>
            <div className="kx-field">
              <span className="kx-label">{t("theme")}</span>
              <div className="kx-segmented">
                {(["dark", "light"] as const).map((theme) => (
                  <button
                    key={theme}
                    type="button"
                    aria-pressed={settings.theme === theme}
                    onClick={() => update({ theme })}
                  >
                    {theme === "dark" ? t("dark") : t("light")}
                  </button>
                ))}
              </div>
            </div>

            <div className="kx-field">
              <span className="kx-label">{t("language")}</span>
              <div className="kx-segmented">
                <button
                  type="button"
                  aria-pressed={settings.language === "en"}
                  onClick={() => update({ language: "en" })}
                >
                  {t("settings.english")}
                </button>
                <button
                  type="button"
                  aria-pressed={settings.language === "ar"}
                  onClick={() => update({ language: "ar" })}
                >
                  {t("settings.arabic")}
                </button>
              </div>
              <span className="kx-card-sub">
                {t("settings.languageHint")}
              </span>
            </div>

            <label className="kx-switch">
              <input
                type="checkbox"
                checked={settings.reduceMotion}
                onChange={(event) => update({ reduceMotion: event.target.checked })}
              />
              <span className="kx-switch-track" />
              <span className="kx-switch-label">{t("reduceMotion")}</span>
            </label>
          </div>
        </div>

        <div className="kx-card">
          <div className="kx-card-title">
            <span>{t("recordingSettings")}</span>
            <Icon name="studio" size={18} />
          </div>
          <p className="kx-card-sub">
            {t("settings.recorderNote")}
          </p>

          <div className="kx-col" style={{ marginTop: 14 }}>
            <div className="kx-grid kx-grid-2">
              <div className="kx-field">
                <span className="kx-label">{t("quality")}</span>
                <div className="kx-segmented">
                  {([720, 1080, 1440, 2160] as const).map((quality) => (
                    <button
                      key={quality}
                      type="button"
                      aria-pressed={settings.recorder.quality === quality}
                      onClick={() => updateRecorder({ quality })}
                    >
                      {quality}p
                    </button>
                  ))}
                </div>
              </div>
              <div className="kx-field">
                <span className="kx-label">{t("fps")}</span>
                <div className="kx-segmented">
                  {([30, 60] as const).map((fps) => (
                    <button
                      key={fps}
                      type="button"
                      aria-pressed={settings.recorder.fps === fps}
                      onClick={() => updateRecorder({ fps })}
                    >
                      {fps} fps
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="kx-row" style={{ gap: 18 }}>
              <label className="kx-switch">
                <input
                  type="checkbox"
                  checked={settings.recorder.systemAudio}
                  onChange={(event) => updateRecorder({ systemAudio: event.target.checked })}
                />
                <span className="kx-switch-track" />
                <span className="kx-switch-label">{t("systemAudio")}</span>
              </label>
              <label className="kx-switch">
                <input
                  type="checkbox"
                  checked={settings.recorder.microphone}
                  onChange={(event) => updateRecorder({ microphone: event.target.checked })}
                />
                <span className="kx-switch-track" />
                <span className="kx-switch-label">{t("microphone")}</span>
              </label>
              <label className="kx-switch">
                <input
                  type="checkbox"
                  checked={settings.recorder.webcamOverlay}
                  onChange={(event) => updateRecorder({ webcamOverlay: event.target.checked })}
                />
                <span className="kx-switch-track" />
                <span className="kx-switch-label">{t("webcamOverlay")}</span>
              </label>
            </div>

            {settings.recorder.webcamOverlay && (
              <div className="kx-grid kx-grid-2">
                <label className="kx-field">
                  <span className="kx-label">{t("settings.overlayPosition")}</span>
                  <select
                    className="kx-select"
                    value={settings.recorder.webcamPosition}
                    onChange={(event) =>
                      updateRecorder({
                        webcamPosition: event.target
                          .value as typeof settings.recorder.webcamPosition,
                      })
                    }
                  >
                    <option value="topLeft">{t("position.topLeft")}</option>
                    <option value="topRight">{t("position.topRight")}</option>
                    <option value="bottomLeft">{t("position.bottomLeft")}</option>
                    <option value="bottomRight">{t("position.bottomRight")}</option>
                  </select>
                </label>
                <div className="kx-field">
                  <span className="kx-label">{t("settings.overlaySize")}</span>
                  <div className="kx-segmented">
                    {(["small", "medium", "large"] as const).map((size) => (
                      <button
                        key={size}
                        type="button"
                        aria-pressed={settings.recorder.webcamSize === size}
                        onClick={() => updateRecorder({ webcamSize: size })}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <label className="kx-field">
              <span className="kx-label">{t("settings.fileNaming")}</span>
              <input
                className="kx-input"
                value={settings.recorder.namingPattern}
                onChange={(event) => updateRecorder({ namingPattern: event.target.value })}
                placeholder="KNOUX-REC-[DATE]_[TIME]"
              />
              <span className="kx-card-sub">
                {t("settings.namingTokens")}
              </span>
            </label>
          </div>
        </div>
      </div>

      <div className="kx-grid kx-grid-2">
        <div className="kx-card">
          <div className="kx-card-title">
            <span>{t("settings.screenshotDefaults")}</span>
            <Icon name="camera" size={18} />
          </div>
            <p className="kx-card-sub">{t("settings.screenshotDefaultsHint")}</p>
          <div className="kx-col" style={{ marginTop: 14 }}>
            <div className="kx-field">
              <span className="kx-label">{t("settings.format")}</span>
              <div className="kx-segmented">
                {(["png", "jpeg", "webp"] as const).map((format) => (
                  <button
                    key={format}
                    type="button"
                    aria-pressed={settings.screenshotFormat === format}
                    onClick={() => update({ screenshotFormat: format })}
                  >
                    {format.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <label className="kx-field">
              <span className="kx-label">
                Quality · {Math.round(settings.screenshotQuality * 100)}%
              </span>
              <input
                type="range"
                min={0.5}
                max={1}
                step={0.05}
                value={settings.screenshotQuality}
                onChange={(event) => update({ screenshotQuality: Number(event.target.value) })}
              />
            </label>
          </div>
        </div>

        <div className="kx-card" data-hotkey-card>
          <div className="kx-card-title">
            <span>{t("settings.shortcuts")}</span>
            <Icon name="hash" size={18} />
          </div>
          <p className="kx-card-sub">{t("settings.shortcutsNote")}</p>

          <ul className="kx-hotkey-list">
            {HOTKEY_ACTIONS.map(({ action, labelKey, hintKey }) => {
              const parts = comboParts(settings.hotkeys[action] ?? "");
              const recording = capturing === action;
              return (
                <li key={action} data-hotkey-row={action} data-combo={settings.hotkeys[action] ?? ""}>
                  <span className="kx-hotkey-label">
                    <strong>{t(labelKey)}</strong>
                    <em>{t(hintKey)}</em>
                  </span>
                  <span className="kx-hotkey-keys" dir="ltr" data-hotkey-value={action}>
                    {recording ? (
                      <span className="kx-hotkey-capture">{t("settings.hotkeyPress")}</span>
                    ) : parts.length ? (
                      parts.map((part) => <kbd key={`${action}-${part}`}>{part}</kbd>)
                    ) : (
                      <span className="kx-muted">{t("settings.hotkeyNone")}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="kx-btn kx-btn-sm"
                    data-hotkey-edit={action}
                    aria-pressed={recording}
                    onClick={() => {
                      setCapturing(recording ? null : action);
                      setConflict(null);
                    }}
                  >
                    {recording ? t("settings.hotkeyCancel") : t("settings.hotkeyChange")}
                  </button>
                </li>
              );
            })}
          </ul>

          {conflict && (
            <div className="kx-notice" data-tone="danger" data-hotkey-conflict role="alert">
              <Icon name="alert" size={16} />
              <div>{conflict}</div>
            </div>
          )}

          <div className="kx-row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              className="kx-btn kx-btn-sm"
              data-hotkey-reset
              onClick={() => {
                update({ hotkeys: { ...DEFAULT_HOTKEYS } });
                setConflict(null);
                setCapturing(null);
                push("success", t("settings.hotkeyReset"), t("settings.hotkeyResetBody"));
              }}
            >
              <Icon name="refresh" size={13} />
              {t("settings.hotkeyReset")}
            </button>
            <span className="kx-card-sub">{t("settings.hotkeyEscape")}</span>
          </div>
        </div>

        <div className="kx-card">
          <div className="kx-card-title">
            <span>{t("settings.localData")}</span>
            <Icon name="hardDrive" size={18} />
          </div>
          <p className="kx-card-sub">
            {t("settings.localDataNote")}
          </p>
          <div className="kx-grid kx-grid-2" style={{ marginTop: 14 }}>
            <StatCard
              label={t("totalCaptures")}
              value={String(items.length)}
              icon="layers"
            />
            <StatCard
              label={t("settings.mediaSize")}
              value={formatBytes(totalBytes)}
              icon="hardDrive"
            />
            <StatCard
              label={t("settings.videoTime")}
              value={formatDuration(totalSeconds)}
              icon="clock"
            />
            <StatCard
              label={t("settings.settingsKey")}
              value="v1"
              hint="knoux-rec.settings.v1"
              icon="shield"
            />
          </div>
          <div className="kx-notice" data-tone="ok" style={{ marginTop: 14 }}>
            <Icon name="shield" size={16} />
            <div>
              {t("settings.noTelemetry")}
            </div>
          </div>
        </div>
      </div>

      <div className="kx-card" data-license-card>
        <div className="kx-card-title">
          <span>
            <Icon name="shield" size={16} /> {t("settings.license")}
          </span>
          <span className="kx-badge" data-state={license?.state === "format-valid" ? "AVAILABLE_UNVERIFIED" : license?.state === "invalid" ? "BLOCKED" : "NOT_IMPLEMENTED"} data-license-state={license?.state ?? "unlicensed"}>
            {license?.state === "format-valid"
              ? t("settings.licenseStateValid")
              : license?.state === "invalid"
                ? t("settings.licenseStateInvalid")
                : t("settings.licenseStateNone")}
          </span>
        </div>
        <p className="kx-card-sub">{t("settings.licenseDescription")}</p>
        <div className="kx-row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <input
            className="kx-input"
            dir="ltr"
            spellCheck={false}
            value={licenseInput}
            placeholder={sampleLicenseKey()}
            aria-label={t("settings.licensePlaceholder")}
            data-license-input
            onChange={(event) => setLicenseInput(event.target.value)}
          />
          <button
            type="button"
            className="kx-btn kx-btn-primary"
            data-license-activate
            onClick={() => {
              const record = activateLicense(licenseInput);
              setLicense(record);
              const verdict = checkLicenseKey(licenseInput);
              if (verdict.ok) push("success", t("settings.license"), t("settings.licenseFormatValid"));
              else push("error", t("settings.license"), t("settings.licenseInvalid"));
            }}
          >
            {t("settings.licenseActivate")}
          </button>
          {license && (
            <button
              type="button"
              className="kx-btn"
              data-license-remove
              onClick={() => {
                clearLicense();
                setLicense(null);
                setLicenseInput("");
              }}
            >
              {t("settings.licenseRemove")}
            </button>
          )}
        </div>
        {license?.state === "format-valid" && (
          <p className="kx-card-sub kx-mono" dir="ltr" data-license-key>
            {license.key}
          </p>
        )}
        <p className="kx-card-sub">{t("settings.licenseHonest")}</p>
        <button
          type="button"
          className="kx-btn kx-btn-sm"
          data-license-purchase
          onClick={() => void openExternal(PURCHASE_URL, window.knouxDesktop)}
        >
          {t("settings.licensePurchase")}
          <Icon name="external" size={13} />
        </button>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title={t("settings.reset")}
        message={t("settings.resetDescription")}
        confirmLabel={t("settings.reset")}
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          reset();
          setConfirmReset(false);
          push("success", t("settings.reset"), t("settings.resetDone"));
        }}
      />
    </div>
  );
}
