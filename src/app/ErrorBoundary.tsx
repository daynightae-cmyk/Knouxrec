import React from "react";
import { Icon } from "./icons";
import { loadSettings } from "../state/settingsStore";
import { translate } from "../i18n/translate";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  resetKey?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[KNOUX REC] Section failed to render:", error);
  }

  componentDidUpdate(previous: ErrorBoundaryProps) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      const t = (key: string) => translate(loadSettings().language, key);
      return (
        <div className="kx-empty" role="alert">
          <Icon name="alert" size={34} />
          <div className="kx-empty-title">{t("shell.error.title")}</div>
          <p className="kx-empty-hint">
            {this.state.error.message || t("shell.error.description")}
          </p>
          <button
            type="button"
            className="kx-btn kx-btn-primary"
            onClick={() => this.setState({ error: null })}
          >
            <Icon name="refresh" size={16} />
            {t("retry")}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
