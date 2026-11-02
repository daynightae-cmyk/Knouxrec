import React from "react";
import { Icon, type IconName } from "../app/icons";
import { CAPABILITIES, type RouteId } from "../app/capabilities";
import { StateBadge } from "./ui";

/**
 * Small real-data visualisations for the dashboard metric cards.
 *
 * Every one of them draws from measured values — counts that came out of
 * IndexedDB, bytes the browser reported, or seconds actually recorded. There
 * is no decorative random data anywhere in this file.
 */

export function Sparkline({
  values,
  label,
}: {
  values: number[];
  label: string;
}) {
  const max = Math.max(1, ...values);
  const width = 100;
  const height = 30;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values
    .map((value, index) => {
      const x = index * step;
      const y = height - (value / max) * (height - 3) - 1.5;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const area = `0,${height} ${points} ${width},${height}`;

  return (
    <svg
      className="kx-sparkline"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <polygon points={area} className="kx-sparkline-area" />
      <polyline points={points} className="kx-sparkline-line" />
    </svg>
  );
}

export function MiniBars({
  values,
  labels,
  caption,
}: {
  values: number[];
  labels: string[];
  caption: string;
}) {
  const max = Math.max(1, ...values);
  return (
    <div className="kx-mini-bars" role="img" aria-label={caption}>
      {values.map((value, index) => (
        <span className="kx-mini-bar" key={`${labels[index] ?? index}`}>
          <span
            className="kx-mini-bar-fill"
            style={{ height: `${Math.max(4, Math.round((value / max) * 100))}%` }}
            data-empty={value === 0 ? "true" : undefined}
          />
          <span className="kx-mini-bar-label">{labels[index] ?? ""}</span>
        </span>
      ))}
    </div>
  );
}

export function RingGauge({
  score,
  caption,
  tone = "ok",
}: {
  score: number | null;
  caption: string;
  tone?: "ok" | "warn" | "unknown";
}) {
  const value = score ?? 0;
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const dash = (Math.max(0, Math.min(100, value)) / 100) * circumference;
  return (
    <div className="kx-ring" data-tone={tone}>
      <svg viewBox="0 0 64 64" role="img" aria-label={caption}>
        <circle className="kx-ring-track" cx="32" cy="32" r={radius} />
        <circle
          className="kx-ring-value"
          cx="32"
          cy="32"
          r={radius}
          strokeDasharray={`${dash} ${circumference}`}
          transform="rotate(-90 32 32)"
        />
      </svg>
      <span className="kx-ring-label">
        {score === null ? "—" : `${score}%`}
      </span>
    </div>
  );
}

export function StorageBar({
  used,
  quota,
}: {
  used: number;
  quota: number | null;
}) {
  const percent = quota && quota > 0 ? Math.min(100, (used / quota) * 100) : 0;
  return (
    <div className="kx-storage-bar">
      <span className="kx-storage-bar-track">
        <span
          className="kx-storage-bar-fill"
          style={{ width: `${Math.round(percent)}%` }}
        />
      </span>
      <span className="kx-storage-bar-text">
        {quota === null ? "quota unknown" : `${percent.toFixed(1)}%`}
      </span>
    </div>
  );
}

/**
 * The three promise cards from the approved dashboard artwork. Each one names
 * a capability that the product actually has and links to the real route.
 */
export function HeroFeatureCards({
  onNavigate,
  t,
}: {
  onNavigate: (route: RouteId) => void;
  t: (key: string) => string;
}) {
  const cards: Array<{
    route: RouteId;
    icon: IconName;
    titleKey: string;
    detailKey: string;
  }> = [
    {
      route: "studio",
      icon: "studio",
      titleKey: "dashboard.promiseRecord",
      detailKey: "dashboard.promiseRecordDetail",
    },
    {
      route: "toolbox",
      icon: "toolbox",
      titleKey: "dashboard.promiseCreate",
      detailKey: "dashboard.promiseCreateDetail",
    },
    {
      route: "library",
      icon: "library",
      titleKey: "dashboard.promiseLocal",
      detailKey: "dashboard.promiseLocalDetail",
    },
  ];

  return (
    <div className="kx-hero-features">
      {cards.map((card) => (
        <button
          type="button"
          className="kx-hero-feature"
          key={card.route}
          onClick={() => onNavigate(card.route)}
        >
          <span className="kx-hero-feature-icon">
            <Icon name={card.icon} size={19} />
          </span>
          <span className="kx-hero-feature-body">
            <span className="kx-hero-feature-title">{t(card.titleKey)}</span>
            <span className="kx-hero-feature-detail">{t(card.detailKey)}</span>
          </span>
          <Icon name="chevronRight" size={16} />
        </button>
      ))}
    </div>
  );
}

/**
 * The Featured Services grid. Every card comes from the one capability
 * registry that also drives the sidebar, so a card can never advertise a
 * state the rest of the product does not have.
 */
export function FeaturedServices({
  onNavigate,
  routes,
  t,
}: {
  onNavigate: (route: RouteId) => void;
  routes: RouteId[];
  t: (key: string) => string;
}) {
  return (
    <div className="kx-service-grid">
      {routes.map((route) => {
        const capability = CAPABILITIES[route];
        return (
          <button
            type="button"
            className="kx-service-card"
            data-state={capability.state}
            key={route}
            onClick={() => onNavigate(route)}
          >
            <span className="kx-service-card-head">
              <span className="kx-service-card-title">
                {t(capability.labelKey)}
              </span>
              <StateBadge state={capability.state} />
            </span>
            <span className="kx-service-card-summary">{t(capability.summaryKey)}</span>
            <span className="kx-service-card-foot">
              <span className="kx-service-card-open">
                {t("dashboard.openService")}
                <Icon name="chevronRight" size={14} />
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Section heading with the yellow rule used across the approved artwork.
 */
export function RuledHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="kx-ruled-head">
      <span className="kx-ruled-bar" aria-hidden="true" />
      <div className="kx-ruled-text">
        <h2 className="kx-ruled-title">{title}</h2>
        {description && <p className="kx-ruled-desc">{description}</p>}
      </div>
      {action && <div className="kx-ruled-action">{action}</div>}
    </div>
  );
}
