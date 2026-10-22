
import { useToast } from "../state/ToastContext";
import { useSettings } from "../state/SettingsContext";
import { translate } from "../i18n/translate";
import { Icon } from "./icons";

export default function ToastViewport() {
  const { toasts, dismiss } = useToast();
  const { settings } = useSettings();
  const t = (key: string) => translate(settings.language, key);

  if (toasts.length === 0) return null;

  return (
    <div className="kx-toasts" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div className="kx-toast" data-kind={toast.kind} key={toast.id} role="status">
          <span className="kx-toast-bar" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="kx-toast-title">{toast.title}</div>
            {toast.detail && <div className="kx-toast-detail">{toast.detail}</div>}
          </div>
          <button
            type="button"
            className="kx-icon-button"
            style={{ width: 26, height: 26 }}
            aria-label={t("a11y.dismissNotification")}
            onClick={() => dismiss(toast.id)}
          >
            <Icon name="x" size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
