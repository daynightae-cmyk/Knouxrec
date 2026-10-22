
import BrandMark from "./BrandMark";
import { Icon } from "./icons";
import { useSettings } from "../state/SettingsContext";
import { translate } from "../i18n/translate";

export type SplashStepState = "pending" | "active" | "done" | "warn";

export interface SplashStep {
  id: string;
  label: string;
  state: SplashStepState;
}

export default function SplashScreen({
  steps,
  progress,
  leaving,
  onSkip,
}: {
  steps: SplashStep[];
  progress: number;
  leaving: boolean;
  onSkip: () => void;
}) {
  const { settings } = useSettings();
  const t = (key: string) => translate(settings.language, key);

  return (
    <div className="kx-splash" data-leaving={leaving} role="status" aria-live="polite">
      <div className="kx-splash-inner">
        <BrandMark size={96} className="kx-splash-mark" />
        <div className="kx-splash-name">
          KNOUX<em>REC</em>
        </div>
        <div className="kx-splash-tag">{t("shell.tagline")}</div>

        <div className="kx-splash-steps">
          {steps.map((step) => (
            <div className="kx-splash-step" data-state={step.state} key={step.id}>
              <span className="kx-splash-step-icon">
                {step.state === "active" && (
                  <span className="kx-spin">
                    <Icon name="refresh" size={13} />
                  </span>
                )}
                {step.state === "done" && <Icon name="check" size={13} />}
                {step.state === "warn" && <Icon name="alert" size={13} />}
                {step.state === "pending" && (
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "currentColor",
                      display: "inline-block",
                    }}
                  />
                )}
              </span>
              <span>{step.label}</span>
            </div>
          ))}
        </div>

        <div className="kx-splash-progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>

        <button type="button" className="kx-splash-skip" onClick={onSkip}>
          {t("skip")}
        </button>
      </div>
    </div>
  );
}
