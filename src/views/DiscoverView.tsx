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

const STATUSES: Array<ServiceStatus | "ALL"> = [
  "ALL",
  "VERIFIED",
  "IMPLEMENTED-NOT-VERIFIED",
  "PARTIAL",
  "BLOCKED",
  "NOT-IMPLEMENTED",
];

const CAPABILITY_FILTERS = ["ALL", "RUNNABLE", "CATALOGUE"] as const;
type CapabilityFilter = (typeof CAPABILITY_FILTERS)[number];

const TYPES = [
  "ALL",
  "capture",
  "library",
  "create",
  "intelligence",
  "system",
] as const;
type TypeFilter = (typeof TYPES)[number];

const SORTS = ["RELEVANCE", "NAME", "STATUS"] as const;
type SortMode = (typeof SORTS)[number];

/**
 * The three creative environments the approved artwork puts on the front of
 * the discovery page. Each one opens a real route and carries the state the
 * capability registry gives it, so a hub that is only partly built is labelled
 * as such instead of being presented as finished.
 */
const APPLICATION_HUBS: Array<{
  route: RouteId;
  hubId: HubId;
  icon: "elysian" | "morph" | "patch";
  titleKey: string;
  taglineEn: string;
  artwork: "elysian" | "morph" | "patch";
}> = [
  {
    route: "elysian",
    hubId: "elysian",
    icon: "elysian",
    titleKey: "elysian",
    taglineEn: "Art for the discerning eye",
    artwork: "elysian",
  },
  {
    route: "morphcore",
    hubId: "morphcore",
    icon: "morph",
    titleKey: "morphCore",
    taglineEn: "Manual geometry studio",
    artwork: "morph",
  },
  {
    route: "visual-patch",
    hubId: "visual-patch",
    icon: "patch",
    titleKey: "visualPatch",
    taglineEn: "Node-based visual lab",
    artwork: "patch",
  },
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
  const [status, setStatus] = useState<ServiceStatus | "ALL">("ALL");
  const [capabilityFilter, setCapabilityFilter] = useState<CapabilityFilter>("ALL");
  const [type, setType] = useState<TypeFilter>("ALL");
  const [sort, setSort] = useState<SortMode>("RELEVANCE");
  const [showAllHubs, setShowAllHubs] = useState(false);
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
      if (status !== "ALL" && service.status !== status) return false;
      if (capabilityFilter === "RUNNABLE" && !isRunnable(service)) return false;
      if (capabilityFilter === "CATALOGUE" && isRunnable(service)) return false;
      if (type !== "ALL") {
        const group = service.route ? CAPABILITIES[service.route]?.group : undefined;
        if (group !== type) return false;
      }
      if (runnableOnly && !isRunnable(service)) return false;
      if (showFavourites && !favourites.includes(service.id)) return false;
      return true;
    });
    if (sort === "NAME") {
      return [...found].sort((a, b) => a.labelEn.localeCompare(b.labelEn));
    }
    if (sort === "STATUS") {
      const weight: Record<ServiceStatus, number> = {
        VERIFIED: 0,
        "IMPLEMENTED-NOT-VERIFIED": 1,
        PARTIAL: 2,
        BLOCKED: 3,
        "NOT-IMPLEMENTED": 4,
      };
      return [...found].sort(
        (a, b) => weight[a.status] - weight[b.status] || a.labelEn.localeCompare(b.labelEn),
      );
    }
    return found;
  }, [
    query,
    hub,
    mode,
    status,
    capabilityFilter,
    type,
    sort,
    runnableOnly,
    showFavourites,
    favourites,
  ]);

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

      <div
        className="kx-row elys-filters"
        style={{ gap: 6, flexWrap: "wrap" }}
        data-expanded={showAllHubs ? "true" : "false"}
      >
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
        <button
          type="button"
          className="kx-chip kx-chip-more"
          onClick={() => setShowAllHubs((value) => !value)}
          aria-expanded={showAllHubs}
        >
          {showAllHubs ? t("discover.showAllHubs") : t("discover.moreHubs")}
          <Icon name={showAllHubs ? "chevronRight" : "chevronDown"} size={13} />
        </button>
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

      <div className="kx-row elys-selects" style={{ gap: 10, flexWrap: "wrap" }}>
        <label className="kx-select-wrap">
          <span className="kx-select-label">{t("discover.filterStatus")}</span>
          <select
            className="kx-select"
            data-filter="status"
            value={status}
            onChange={(event) => setStatus(event.target.value as ServiceStatus | "ALL")}
          >
            {STATUSES.map((entry) => (
              <option key={entry} value={entry} dir="ltr">
                {entry === "ALL" ? t("discover.all") : entry}
              </option>
            ))}
          </select>
        </label>
        <label className="kx-select-wrap">
          <span className="kx-select-label">{t("discover.filterCapability")}</span>
          <select
            className="kx-select"
            data-filter="capability"
            value={capabilityFilter}
            onChange={(event) =>
              setCapabilityFilter(event.target.value as CapabilityFilter)
            }
          >
            <option value="ALL">{t("discover.all")}</option>
            <option value="RUNNABLE">{t("discover.capabilityRunnable")}</option>
            <option value="CATALOGUE">{t("discover.capabilityCatalogue")}</option>
          </select>
        </label>
        <label className="kx-select-wrap">
          <span className="kx-select-label">{t("discover.filterType")}</span>
          <select
            className="kx-select"
            data-filter="type"
            value={type}
            onChange={(event) => setType(event.target.value as TypeFilter)}
          >
            <option value="ALL">{t("discover.all")}</option>
            <option value="capture">{t("discover.typeCapture")}</option>
            <option value="library">{t("discover.typeLibrary")}</option>
            <option value="create">{t("discover.typeCreate")}</option>
            <option value="intelligence">{t("discover.typeIntelligence")}</option>
            <option value="system">{t("discover.typeSystem")}</option>
          </select>
        </label>
        <label className="kx-select-wrap">
          <span className="kx-select-label">{t("discover.filterSort")}</span>
          <select
            className="kx-select"
            data-filter="sort"
            value={sort}
            onChange={(event) => setSort(event.target.value as SortMode)}
          >
            <option value="RELEVANCE">{t("discover.sortRelevance")}</option>
            <option value="NAME">{t("discover.sortName")}</option>
            <option value="STATUS">{t("discover.sortStatus")}</option>
          </select>
        </label>
      </div>

      <section className="elys-hub-showcase">
        <div className="kx-row-between" style={{ marginBottom: 12 }}>
          <div>
            <h3 className="elys-subtitle">{t("discover.applicationHubs")}</h3>
            <p className="kx-card-sub">{t("discover.applicationHubsDesc")}</p>
          </div>
          <button
            type="button"
            className="kx-btn kx-btn-sm"
            onClick={() => setHub("ALL")}
          >
            {t("discover.openHub")}
            <Icon name="chevronRight" size={13} />
          </button>
        </div>
        <div className="elys-hub-cards">
          {APPLICATION_HUBS.map((entry) => {
            const hubCapability = CAPABILITIES[entry.route];
            return (
              <article
                className="elys-hub-card"
                data-hub-card={entry.route}
                data-state={hubCapability.state}
                key={entry.route}
              >
                <div className="elys-hub-art" data-art={entry.artwork} aria-hidden="true">
                  <span className="elys-hub-art-shape" />
                  <span className="elys-hub-art-shape" />
                  <span className="elys-hub-art-shape" />
                </div>
                <div className="elys-hub-body">
                  <div className="elys-hub-head">
                    <span className="elys-hub-icon">
                      <Icon name={entry.icon} size={19} />
                    </span>
                    <span className="elys-hub-title">{t(entry.titleKey)}</span>
                    <StateBadge state={hubCapability.state} />
                  </div>
                  <p className="elys-hub-tagline">{entry.taglineEn}</p>
                  <p className="elys-hub-summary">{hubCapability.summary}</p>
                  <div className="elys-hub-actions">
                    <button
                      type="button"
                      className="kx-btn kx-btn-sm kx-btn-primary"
                      onClick={() => onNavigate(entry.route)}
                    >
                      <Icon name="play" size={14} />
                      {t("discover.open")}
                    </button>
                    <button
                      type="button"
                      className="kx-btn kx-btn-sm"
                      onClick={() => setHub(entry.hubId)}
                    >
                      {t("discover.details")}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

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
