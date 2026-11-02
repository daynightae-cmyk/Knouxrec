import React, { useCallback, useRef } from "react";
import BrandMark from "./BrandMark";
import { BrandWordmark } from "./BrandWordmark";
import { Icon, type IconName } from "./icons";
import { CAPABILITIES, NAVIGATION, type RouteId } from "./capabilities";
import { useSettings } from "../state/SettingsContext";
import { translate } from "../i18n/translate";
import { KxTooltip } from "../ui/Tooltip";
import type { CapabilityState } from "../state/types";

const ROUTE_ICONS: Record<RouteId, IconName> = {
  dashboard: "dashboard",
  discover: "search",
  studio: "studio",
  screenshots: "screenshots",
  library: "library",
  templates: "templates",
  toolbox: "toolbox",
  "visual-patch": "patch",
  morphcore: "morph",
  "audio-studio": "audio",
  batch: "layers",
  elysian: "elysian",
  "body-editor": "body",
  "offline-ai": "brain",
  "arabic-ai": "arabic",
  models: "models",
  settings: "settings",
  diagnostics: "diagnostics",
  about: "info",
  "live-studio": "studio",
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
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  /** Every route in document order, so arrow keys can walk the whole rail. */
  const orderedRoutes = React.useMemo(
    () => NAVIGATION.flatMap((group) => group.routes),
    [],
  );

  const focusRoute = useCallback((next: RouteId) => {
    itemRefs.current[next]?.focus();
  }, []);

  /**
   * Roving keyboard navigation over the rail: Up/Down walk the items, Home and
   * End jump to the ends, and the active route is the one that holds the tab
   * stop so the rail is a single stop in the page tab order.
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      const current = orderedRoutes.indexOf(route);
      let target: RouteId | null = null;
      switch (event.key) {
        case "ArrowDown":
          target = orderedRoutes[(current + 1) % orderedRoutes.length];
          break;
        case "ArrowUp":
          target =
            orderedRoutes[(current - 1 + orderedRoutes.length) % orderedRoutes.length];
          break;
        case "Home":
          target = orderedRoutes[0];
          break;
        case "End":
          target = orderedRoutes[orderedRoutes.length - 1];
          break;
        default:
          return;
      }
      event.preventDefault();
      if (target) focusRoute(target);
    },
    [focusRoute, orderedRoutes, route],
  );

  return (
    <aside
      className="kx-sidebar"
      data-collapsed={collapsed}
      aria-label={t("a11y.mainNavigation")}
    >
      <div className="kx-brand">
        <BrandMark />
        <div className="kx-brand-text">
          <BrandWordmark size="sm" />
          <span className="kx-brand-tag">{t("appTagline")}</span>
        </div>
      </div>

      <nav className="kx-nav" onKeyDown={onKeyDown}>
        {NAVIGATION.map((group) => (
          <React.Fragment key={group.id}>
            <div className="kx-nav-group-label">{t(group.labelKey)}</div>
            {group.routes.map((id) => {
              const capability = CAPABILITIES[id];
              const label = t(capability.labelKey);
              const active = route === id;
              const stateText = capability.state.replace(/_/g, " ").toLowerCase();
              const item = (
                <button
                  type="button"
                  className="kx-nav-item"
                  data-route={id}
                  aria-current={active ? "page" : undefined}
                  tabIndex={active ? 0 : -1}
                  ref={(node) => {
                    itemRefs.current[id] = node;
                  }}
                  onClick={() => onNavigate(id)}
                  title={collapsed ? undefined : `${label} — ${stateText}`}
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
              return collapsed ? (
                <KxTooltip
                  key={id}
                  label={`${label} — ${stateText}`}
                  side="right"
                >
                  {item}
                </KxTooltip>
              ) : (
                item
              );
            })}
          </React.Fragment>
        ))}
      </nav>

      <div className="kx-sidebar-footer">
        <p className="kx-sidebar-note">
          {t("shell.localFirstNote")}
        </p>
        {collapsed ? (
          <KxTooltip label={t("shell.expand")} side="right">
            <button type="button" className="kx-collapse-btn" onClick={onToggle}>
              <Icon name="expand" size={16} />
            </button>
          </KxTooltip>
        ) : (
          <button type="button" className="kx-collapse-btn" onClick={onToggle}>
            <Icon name="collapse" size={16} />
            <span>{t("shell.collapse")}</span>
          </button>
        )}
      </div>
    </aside>
  );
}
