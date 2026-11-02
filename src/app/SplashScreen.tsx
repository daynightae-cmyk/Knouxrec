
import BrandMark from "./BrandMark";
import { BrandFrame, BrandWordmark } from "./BrandWordmark";
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
      {/* Decorative atmosphere of the approved brand artwork: a fine grid, one
          warm corner light and two signal traces. Nothing here is a button and
          nothing here is read out. */}
      <span className="kx-splash-grid" aria-hidden="true" />
      <span className="kx-splash-glow" aria-hidden="true" />
      <span className="kx-splash-trace kx-splash-trace-tl" aria-hidden="true">
        <i className="kx-splash-node" />
      </span>
      <span className="kx-splash-trace kx-splash-trace-br" aria-hidden="true">
        <i className="kx-splash-node" />
      </span>

      <div className="kx-splash-inner">
        <div className="kx-splash-emblem">
          <BrandFrame />
          <BrandMark size={104} className="kx-splash-mark" />
        </div>

        <BrandWordmark
          size="lg"
          className="kx-splash-name"
          tagline={t("shell.tagline")}
        />

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
