import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CAPABILITIES, type RouteId } from "../app/capabilities";
import { Icon } from "../app/icons";
import { useSettings } from "../state/SettingsContext";
import type { CapabilityState } from "../state/types";
import { translate } from "../i18n/translate";
import {
  HUBS,
  SERVICES,
  isRunnable,
  searchServices,
  type HubId,
  type ServiceEntry,
  type ServiceMode,
  type ServiceStatus,
} from "../data/serviceRegistry";
import { EmptyState, SectionHeader, StateBadge } from "./ui";

const FAVOURITES_KEY = "knoux-rec.discover.favourites.v1";
const RECENT_KEY = "knoux-rec.discover.recent.v1";
const MAX_RECENT = 8;

const STATUS_TO_STATE: Record<ServiceStatus, CapabilityState> = {
  VERIFIED: "VERIFIED",
  "IMPLEMENTED-NOT-VERIFIED": "AVAILABLE_UNVERIFIED",
  PARTIAL: "PARTIAL",
  BLOCKED: "BLOCKED",
  "NOT-IMPLEMENTED": "NOT_IMPLEMENTED",
};

const MODES: Array<ServiceMode | "ALL"> = [
  "ALL",
  "LOCAL",
  "MODEL-LOCAL",
  "HYBRID",
  "ONLINE",
  "UNAVAILABLE",
];

function readList(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeList(key: string, value: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value.slice(0, MAX_RECENT)));
  } catch {
    // Storage can be unavailable in a locked-down profile; the view still works.
  }
}

/**
 * Unified service discovery.
 *
 * One search surface over the canonical registry. Every row states where the
 * service runs and whether it actually works today; blocked entries name the
 * missing dependency and link to the model manager instead of pretending.
 */
export default function DiscoverView({
  onNavigate,
}: {
  onNavigate: (route: RouteId) => void;
}) {
  const capability = CAPABILITIES.discover;
  const { settings } = useSettings();
  const t = useCallback(
    (key: string) => translate(settings.language, key),
    [settings.language],
  );
  const arabic = settings.language === "ar";
  const searchRef = useRef<HTMLInputElement | null>(null);

  const [query, setQuery] = useState("");
  const [hub, setHub] = useState<HubId | "ALL">("ALL");
  const [mode, setMode] = useState<ServiceMode | "ALL">("ALL");
  const [runnableOnly, setRunnableOnly] = useState(false);
  const [favourites, setFavourites] = useState<string[]>(() => readList(FAVOURITES_KEY));
  const [recent, setRecent] = useState<string[]>(() => readList(RECENT_KEY));
  const [showFavourites, setShowFavourites] = useState(false);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    const found = searchServices(query).filter((service) => {
      if (hub !== "ALL" && service.hub !== hub) return false;
      if (mode !== "ALL" && service.mode !== mode) return false;
      if (runnableOnly && !isRunnable(service)) return false;
      if (showFavourites && !favourites.includes(service.id)) return false;
      return true;
    });
    return found;
  }, [query, hub, mode, runnableOnly, showFavourites, favourites]);

  const grouped = useMemo(() => {
    const buckets = new Map<HubId, ServiceEntry[]>();
    for (const service of results) {
      const list = buckets.get(service.hub) ?? [];
      list.push(service);
      buckets.set(service.hub, list);
    }
    return HUBS.filter((entry) => buckets.has(entry.id)).map((entry) => ({
      hub: entry,
      services: buckets.get(entry.id) ?? [],
    }));
  }, [results]);

  const counts = useMemo(() => {
    const tally: Record<ServiceStatus, number> = {
      VERIFIED: 0,
      "IMPLEMENTED-NOT-VERIFIED": 0,
      PARTIAL: 0,
      BLOCKED: 0,
      "NOT-IMPLEMENTED": 0,
    };
    for (const service of SERVICES) tally[service.status] += 1;
    return tally;
  }, []);

  const recentServices = useMemo(
    () =>
      recent
        .map((id) => SERVICES.find((service) => service.id === id))
        .filter((service): service is ServiceEntry => Boolean(service)),
    [recent],
  );

  const toggleFavourite = useCallback((id: string) => {
    setFavourites((current) => {
      const next = current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [id, ...current];
      writeList(FAVOURITES_KEY, next);
      return next;
    });
  }, []);

  const open = useCallback(
    (service: ServiceEntry) => {
      if (!service.route) return;
      setRecent((current) => {
        const next = [service.id, ...current.filter((entry) => entry !== service.id)];
        writeList(RECENT_KEY, next);
        return next;
      });
      onNavigate(service.route);
    },
    [onNavigate],
  );

  const label = (service: ServiceEntry) => (arabic ? service.label : service.labelEn);

  return (
    <div className="kx-content elys-discover">
      <SectionHeader
        eyebrow={t("groupRecord")}
        title={t("discover.title")}
        description={t("discover.description")}
        actions={<StateBadge state={capability.state} />}
      />

      <div className="kx-grid kx-grid-4">
        <button
          type="button"
          className="kx-card elys-stat"
          data-stat="runnable"
          onClick={() => setRunnableOnly((value) => !value)}
          aria-pressed={runnableOnly}
        >
          <span className="elys-stat-value">{counts.VERIFIED}</span>
          <span className="elys-stat-label">{t("discover.runnable")}</span>
        </button>
        <button
          type="button"
          className="kx-card elys-stat"
          data-stat="blocked"
          onClick={() => setMode("MODEL-LOCAL")}
        >
          <span className="elys-stat-value">
            {counts.BLOCKED}
          </span>
          <span className="elys-stat-label">{t("discover.blocked")}</span>
        </button>
        <button
          type="button"
          className="kx-card elys-stat"
          data-stat="favourites"
          onClick={() => setShowFavourites((value) => !value)}
          aria-pressed={showFavourites}
        >
          <span className="elys-stat-value">{favourites.length}</span>
          <span className="elys-stat-label">{t("discover.favourites")}</span>
        </button>
        <button
          type="button"
          className="kx-card elys-stat"
          data-stat="total"
          onClick={() => setHub("ALL")}
        >
          <span className="elys-stat-value">{SERVICES.length}</span>
          <span className="elys-stat-label">{t("discover.total")}</span>
        </button>
      </div>

      <div className="kx-row elys-discover-bar" style={{ gap: 10 }}>
        <input
          ref={searchRef}
          className="kx-input kx-search"
          type="search"
          value={query}
          placeholder={t("discover.searchPlaceholder")}
          aria-label={t("discover.searchPlaceholder")}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="kx-badge" data-state="PARTIAL" dir="ltr">
          {results.length} / {SERVICES.length}
        </span>
      </div>

      <div className="kx-row elys-filters" style={{ gap: 6, flexWrap: "wrap" }}>
        <button
          type="button"
          className="kx-chip"
          data-hub-id="ALL"
          aria-pressed={hub === "ALL"}
          onClick={() => setHub("ALL")}
        >
          {t("discover.allHubs")}
        </button>
        {HUBS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="kx-chip"
            data-hub-id={entry.id}
            aria-pressed={hub === entry.id}
            onClick={() => setHub(entry.id)}
          >
            {arabic ? entry.label : entry.labelEn}
          </button>
        ))}
      </div>

      <div className="kx-row" style={{ gap: 6, flexWrap: "wrap", margin: "10px 0 16px" }}>
        {MODES.map((entry) => (
          <button
            key={entry}
            type="button"
            className="kx-chip"
            data-mode-id={entry}
            aria-pressed={mode === entry}
            onClick={() => setMode(entry)}
            dir="ltr"
          >
            {entry === "ALL" ? t("discover.allModes") : entry}
          </button>
        ))}
      </div>

      {recentServices.length > 0 && (
        <section className="elys-recent">
          <h3 className="elys-subtitle">{t("discover.recent")}</h3>
          <div className="kx-row" style={{ gap: 8, flexWrap: "wrap" }}>
            {recentServices.map((service) => (
              <button
                key={service.id}
                type="button"
                className="kx-btn kx-btn-sm"
                onClick={() => open(service)}
              >
                {label(service)}
              </button>
            ))}
          </div>
        </section>
      )}

      {grouped.length === 0 ? (
        <EmptyState
          icon="search"
          title={t("discover.noResults")}
          hint={t("discover.noResultsHint")}
        />
      ) : (
        grouped.map(({ hub: hubEntry, services }) => (
          <section key={hubEntry.id} className="elys-hub-block" data-hub-block={hubEntry.id}>
            <div className="kx-row-between">
              <h3 className="elys-subtitle">
                {arabic ? hubEntry.label : hubEntry.labelEn}
              </h3>
              <button
                type="button"
                className="kx-btn kx-btn-sm"
                onClick={() => onNavigate(hubEntry.route)}
              >
                {t("discover.openHub")}
                <Icon name="chevronRight" size={13} />
              </button>
            </div>
            <div className="elys-services">
              {services.map((service) => {
                const runnable = isRunnable(service);
                const starred = favourites.includes(service.id);
                return (
                  <article
                    key={service.id}
                    className="elys-service"
                    data-service-id={service.id}
                    data-runnable={runnable}
                  >
                    <header className="elys-service-head">
                      <span className="elys-service-name">{label(service)}</span>
                      <button
                        type="button"
                        className="elys-star"
                        aria-pressed={starred}
                        aria-label={t("discover.favourite")}
                        onClick={() => toggleFavourite(service.id)}
                      >
                        <Icon name="star" size={14} />
                      </button>
                    </header>
                    <div className="elys-service-badges">
                      <span className="kx-chip" data-mode={service.mode} dir="ltr">
                        {service.mode}
                      </span>
                      <StateBadge state={STATUS_TO_STATE[service.status]} />
                    </div>
                    {service.needs && (
                      <p className="elys-service-needs">{service.needs}</p>
                    )}
                    <footer className="elys-service-actions">
                      {service.route && (
                        <button
                          type="button"
                          className="kx-btn kx-btn-sm kx-btn-primary"
                          data-action="open"
                          onClick={() => open(service)}
                          disabled={!runnable}
                        >
                          {runnable ? t("discover.open") : t("discover.notRunnable")}
                        </button>
                      )}
                      {service.studio && runnable && (
                        <button
                          type="button"
                          className="kx-btn kx-btn-sm"
                          data-action="studio"
                          onClick={() => {
                            setRecent((current) => {
                              const next = [service.id, ...current.filter((id) => id !== service.id)];
                              writeList(RECENT_KEY, next);
                              return next;
                            });
                            onNavigate("live-studio");
                          }}
                        >
                          {t("discover.studio")}
                        </button>
                      )}
                      {service.mode !== "LOCAL" && !runnable && (
                        <button
                          type="button"
                          className="kx-btn kx-btn-sm"
                          data-action="configure"
                          onClick={() => onNavigate("models")}
                        >
                          {t("discover.configure")}
                        </button>
                      )}
                    </footer>
                  </article>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
