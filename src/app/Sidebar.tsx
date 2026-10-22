import React from "react";
import BrandMark from "./BrandMark";
import { Icon, type IconName } from "./icons";
import { CAPABILITIES, NAVIGATION, type RouteId } from "./capabilities";
import { useSettings } from "../state/SettingsContext";
import { translate } from "../i18n/translate";
import type { CapabilityState } from "../state/types";

const ROUTE_ICONS: Record<RouteId, IconName> = {
  dashboard: "dashboard",
  studio: "studio",
  screenshots: "screenshots",
  library: "library",
  templates: "templates",
  toolbox: "toolbox",
  "visual-patch": "patch",
  morphcore: "morph",
  elysian: "elysian",
  "body-editor": "body",
  "offline-ai": "brain",
  "arabic-ai": "arabic",
  models: "models",
  settings: "settings",
  diagnostics: "diagnostics",
};

function dotColor(state: CapabilityState): string {
  switch (state) {
    case "VERIFIED":
      return "var(--kx-success)";
    case "AVAILABLE_UNVERIFIED":
      return "var(--kx-info)";
    case "PARTIAL":
      return "var(--kx-warning)";
    case "NOT_IMPLEMENTED":
      return "var(--kx-text-faint)";
    default:
      return "var(--kx-danger)";
  }
}

export default function Sidebar({
  route,
  onNavigate,
  collapsed,
  onToggle,
}: {
  route: RouteId;
  onNavigate: (route: RouteId) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { settings } = useSettings();
  const t = (key: string) => translate(settings.language, key);

  return (
    <aside
      className="kx-sidebar"
      data-collapsed={collapsed}
      aria-label={t("a11y.mainNavigation")}
    >
      <div className="kx-brand">
        <BrandMark />
        <div className="kx-brand-text">
          <span className="kx-brand-name">
            KNOUX<em>REC</em>
          </span>
          <span className="kx-brand-tag">{t("appTagline")}</span>
        </div>
      </div>

      <nav className="kx-nav">
        {NAVIGATION.map((group) => (
          <React.Fragment key={group.id}>
            <div className="kx-nav-group-label">{t(group.labelKey)}</div>
            {group.routes.map((id) => {
              const capability = CAPABILITIES[id];
              const label = t(capability.labelKey);
              const active = route === id;
              return (
                <button
                  key={id}
                  type="button"
                  className="kx-nav-item"
                  data-route={id}
                  aria-current={active ? "page" : undefined}
                  onClick={() => onNavigate(id)}
                  title={`${label} — ${capability.state.replace(/_/g, " ").toLowerCase()}`}
                >
                  <span className="kx-nav-icon">
                    <Icon name={ROUTE_ICONS[id]} size={19} />
                  </span>
                  <span className="kx-nav-label">{label}</span>
                  <span
                    className="kx-nav-dot"
                    style={{ background: dotColor(capability.state) }}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </React.Fragment>
        ))}
      </nav>

      <div className="kx-sidebar-footer">
        <p className="kx-sidebar-note">
          {t("shell.localFirstNote")}
        </p>
        <button type="button" className="kx-collapse-btn" onClick={onToggle}>
          <Icon name={collapsed ? "expand" : "collapse"} size={16} />
          {!collapsed && <span>{t("shell.collapse")}</span>}
        </button>
      </div>
    </aside>
  );
}
