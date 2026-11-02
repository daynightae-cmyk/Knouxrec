import { useEffect, useMemo, useRef, useState } from "react";
import { useLibrary } from "../state/LibraryContext";
import { useSettings } from "../state/SettingsContext";
import { useToast } from "../state/ToastContext";
import { translate } from "../i18n/translate";
import { Icon } from "../app/icons";
import {
  ConfirmDialog,
  EmptyState,
  PreviewDialog,
  RenameDialog,
  SectionHeader,
  StatCard,
  Thumbnail,
  TrimDialog,
} from "./ui";
import { downloadBlob, formatBytes, formatDuration } from "../lib/format";
import { RECEIVERS, useHandoffSender } from "../ui/handoff";
import type { RouteId } from "../app/capabilities";
import type { LibraryItem } from "../state/types";

type KindFilter = "all" | "video" | "image" | "audio";
type SortMode = "newest" | "oldest" | "largest" | "name";
type DateFilter = "all" | "today" | "week" | "month";
type ResolutionFilter = "all" | "sd" | "hd" | "qhd" | "uhd";
type DurationFilter = "all" | "short" | "medium" | "long";
type SizeFilter = "all" | "small" | "medium" | "large";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Facet predicates kept apart from the component so a filter can be reasoned
 * about, and tested, on its own. Every one of them reads a value the library
 * actually stores — a byte count, a timestamp, a decoded frame size — never a
 * number invented for the card.
 */
function matchesDate(item: LibraryItem, filter: DateFilter, now: number): boolean {
  if (filter === "all") return true;
  const age = now - item.createdAt;
  if (filter === "today") return age < DAY;
  if (filter === "week") return age < 7 * DAY;
  return age < 30 * DAY;
}

function matchesResolution(item: LibraryItem, filter: ResolutionFilter): boolean {
  if (filter === "all") return true;
  const edge = Math.max(item.width, item.height);
  if (!edge) return false;
  if (filter === "sd") return edge < 1920;
  if (filter === "hd") return edge >= 1920 && edge < 2560;
  if (filter === "qhd") return edge >= 2560 && edge < 3840;
  return edge >= 3840;
}

function matchesDuration(item: LibraryItem, filter: DurationFilter): boolean {
  if (filter === "all") return true;
  if (item.kind === "image") return false;
  if (filter === "short") return item.duration < 60;
  if (filter === "medium") return item.duration >= 60 && item.duration < 300;
  return item.duration >= 300;
}

function matchesSize(item: LibraryItem, filter: SizeFilter): boolean {
  if (filter === "all") return true;
  const mb = item.size / 1024 / 1024;
  if (filter === "small") return mb < 1;
  if (filter === "medium") return mb >= 1 && mb < 10;
  return mb >= 10;
}

export default function LibraryView({
  onNavigate,
}: {
  onNavigate: (route: RouteId) => void;
}) {
  const {
    items,
    urlFor,
    rename,
    toggleFavorite,
    setCollection,
    remove,
    reload,
    ready,
    error,
  } = useLibrary();
  const send = useHandoffSender("library");
  const { settings } = useSettings();
  const { push } = useToast();
  const t = (key: string) => translate(settings.language, key);

  const [kind, setKind] = useState<KindFilter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("newest");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [preview, setPreview] = useState<LibraryItem | null>(null);
  const [renameItem, setRenameItem] = useState<LibraryItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<LibraryItem | null>(null);
  const [trimItem, setTrimItem] = useState<LibraryItem | null>(null);
  const [collectionFilter, setCollectionFilter] = useState<string>("all");
  const [extraCollections, setExtraCollections] = useState<string[]>([]);
  const [newCollection, setNewCollection] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [resolutionFilter, setResolutionFilter] = useState<ResolutionFilter>("all");
  const [durationFilter, setDurationFilter] = useState<DurationFilter>("all");
  const [sizeFilter, setSizeFilter] = useState<SizeFilter>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDelete, setBulkDelete] = useState(false);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(
    null,
  );

  const searchRef = useRef<HTMLInputElement | null>(null);

  // Ctrl/Cmd+K focuses the library search, the shortcut the reference artwork
  // prints on the field itself.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // The quota is whatever the browser is willing to report for this origin. It
  // is deliberately not presented as the size of the physical disk.
  useEffect(() => {
    let active = true;
    void navigator.storage
      ?.estimate?.()
      .then((estimate) => {
        if (!active) return;
        if (estimate.usage !== undefined && estimate.quota !== undefined) {
          setStorage({ usage: estimate.usage, quota: estimate.quota });
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [items.length]);

  const collections = Array.from(
    new Set([
      ...items
        .map((item) => item.collection)
        .filter((value): value is string => Boolean(value)),
      ...extraCollections,
    ]),
  ).sort((a, b) => a.localeCompare(b));

  const allTags = useMemo(
    () =>
      Array.from(new Set(items.flatMap((item) => item.tags ?? []))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [items],
  );

  const counts = useMemo(
    () => ({
      video: items.filter((item) => item.kind === "video").length,
      image: items.filter((item) => item.kind === "image").length,
      audio: items.filter((item) => item.kind === "audio").length,
      favorites: items.filter((item) => item.favorite).length,
    }),
    [items],
  );

  const now = Date.now();
  const needle = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    const list = items.filter((item) => {
      if (kind !== "all" && item.kind !== kind) return false;
      if (favoritesOnly && !item.favorite) return false;
      if (
        needle &&
        !item.name.toLowerCase().includes(needle) &&
        !item.source.includes(needle) &&
        !(item.tags ?? []).some((tag) => tag.toLowerCase().includes(needle))
      ) {
        return false;
      }
      if (
        collectionFilter !== "all" &&
        (collectionFilter === "unfiled" ? Boolean(item.collection) : item.collection !== collectionFilter)
      ) {
        return false;
      }
      if (tagFilter !== "all" && !(item.tags ?? []).includes(tagFilter)) return false;
      if (!matchesDate(item, dateFilter, now)) return false;
      if (!matchesResolution(item, resolutionFilter)) return false;
      if (!matchesDuration(item, durationFilter)) return false;
      if (!matchesSize(item, sizeFilter)) return false;
      return true;
    });
    return list.sort((a, b) => {
      if (sort === "oldest") return a.createdAt - b.createdAt;
      if (sort === "largest") return b.size - a.size;
      if (sort === "name") return a.name.localeCompare(b.name);
      return b.createdAt - a.createdAt;
    });
  }, [
    items,
    kind,
    favoritesOnly,
    needle,
    collectionFilter,
    tagFilter,
    dateFilter,
    resolutionFilter,
    durationFilter,
    sizeFilter,
    sort,
    now,
  ]);

  const totalBytes = items.reduce((sum, item) => sum + item.size, 0);

  const activeFacets =
    (dateFilter !== "all" ? 1 : 0) +
    (resolutionFilter !== "all" ? 1 : 0) +
    (durationFilter !== "all" ? 1 : 0) +
    (sizeFilter !== "all" ? 1 : 0) +
    (tagFilter !== "all" ? 1 : 0) +
    (collectionFilter !== "all" ? 1 : 0);

  const clearFacets = () => {
    setDateFilter("all");
    setResolutionFilter("all");
    setDurationFilter("all");
    setSizeFilter("all");
    setTagFilter("all");
    setCollectionFilter("all");
  };

  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedItems = useMemo(
    () => items.filter((item) => selected.has(item.id)),
    [items, selected],
  );

  const bulkFavorite = () => {
    selectedItems.forEach((item) => {
      if (!item.favorite) void toggleFavorite(item.id);
    });
    push("success", t("library.bulkFavorite"), `${selectedItems.length}`);
    setSelected(new Set());
  };

  const bulkExport = () => {
    selectedItems.forEach((item, index) => {
      // Staggered so the browser does not collapse simultaneous downloads.
      window.setTimeout(() => downloadBlob(item.blob, item.name), index * 220);
    });
    push("success", t("library.bulkExport"), `${selectedItems.length}`);
  };

  const bulkCollection = (name: string) => {
    selectedItems.forEach((item) => void setCollection(item.id, name));
    push("success", t("library.bulkCollection"), `${selectedItems.length} · ${name}`);
    setSelected(new Set());
  };

  const confirmBulkDelete = async () => {
    const targets = [...selectedItems];
    setBulkDelete(false);
    setSelected(new Set());
    let done = 0;
    for (const item of targets) {
      try {
        await remove(item.id);
        done += 1;
      } catch (cause) {
        push(
          "error",
          t("library.deleteFailed"),
          cause instanceof Error ? cause.message : item.name,
        );
      }
    }
    push("success", t("library.bulkDelete"), `${done} / ${targets.length}`);
  };

  const heroTitle = t("library.heroTitle").replace(
    "{local}",
    t("library.heroLocal"),
  );

  return (
    <div className="kx-content">
      <SectionHeader
        eyebrow={t("groupLibrary")}
        title={t("library")}
        description={t("library.description")}
        actions={
          <button
            type="button"
            className="kx-btn"
            onClick={() => {
              void reload()
                .then(() => push("success", t("library.reloaded"), t("library.reloadedHint")))
                .catch((cause: unknown) =>
                  push(
                    "error",
                    t("library.storageCheckFailed"),
                    cause instanceof Error ? cause.message : t("library.unknownStorageError"),
                  ),
                );
            }}
          >
            <Icon name="refresh" size={16} />
            {t("library.verifyStorage")}
          </button>
        }
      />

      {error && (
        <div className="kx-notice" data-tone="danger">
          <Icon name="alert" size={18} />
          <div>
            <strong>{t("library.storageProblem")}</strong> {error}
          </div>
        </div>
      )}

      <div className="kx-lib-head">
        <div>
          <h2 className="kx-lib-title">{heroTitle}</h2>
          <p className="kx-lib-sub">{t("library.heroBody")}</p>
        </div>
        <div className="kx-lib-quota" data-lib-quota>
          <span className="kx-lib-quota-icon">
            <Icon name="hardDrive" size={20} />
          </span>
          <div className="kx-lib-quota-body">
            <span className="kx-lib-quota-title">{t("storageUsed")}</span>
            <span className="kx-lib-quota-line">
              {storage
                ? t("library.quotaLine")
                    .replace("{free}", formatBytes(Math.max(0, storage.quota - storage.usage)))
                    .replace("{quota}", formatBytes(storage.quota))
                : t("library.quotaUnknown")}
            </span>
            <span className="kx-storage-bar-track" aria-hidden="true">
              <span
                className="kx-storage-bar-fill"
                style={{
                  width: storage
                    ? `${Math.min(100, Math.round((storage.usage / Math.max(1, storage.quota)) * 100))}%`
                    : "0%",
                }}
              />
            </span>
            <span className="kx-muted" style={{ fontSize: "0.64rem" }}>
              {t("library.quotaNote")}
            </span>
          </div>
        </div>
      </div>

      <div className="kx-grid kx-grid-metrics">
        <StatCard
          label={t("library.totalItems")}
          value={String(items.length)}
          icon="layers"
          hint={t("library.persistedLocally")}
        />
        <StatCard
          label={t("filterVideos")}
          value={String(counts.video)}
          icon="video"
          hint={t("library.playableClips")}
        />
        <StatCard
          label={t("filterImages")}
          value={String(counts.image)}
          icon="image"
          hint={t("library.screenshotsEdits")}
        />
        <StatCard
          label={t("library.audio")}
          value={String(counts.audio)}
          icon="audio"
          hint={t("library.audioHint")}
        />
        <StatCard
          label={t("favorites")}
          value={String(counts.favorites)}
          icon="star"
          hint={t("library.favoritesHint")}
        />
      </div>

      <div className="kx-card kx-lib-controls" data-lib-controls>
        <div className="kx-row" style={{ gap: 6, flexWrap: "wrap" }}>
          {(
            [
              ["all", t("filterAll")],
              ["video", t("filterVideos")],
              ["image", t("filterImages")],
              ["audio", t("library.audio")],
            ] as [KindFilter, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="kx-chip"
              data-kind={value}
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className="kx-chip"
            data-kind="favorites"
            aria-pressed={favoritesOnly}
            onClick={() => setFavoritesOnly((value) => !value)}
          >
            <Icon name="star" size={13} />
            {t("favorites")}
          </button>
        </div>

        <div className="kx-row" style={{ gap: 8, flexWrap: "wrap" }}>
          <label className="kx-search">
            <Icon name="search" size={16} />
            <input
              ref={searchRef}
              className="kx-input"
              placeholder={`${t("search")}…`}
              value={query}
              data-lib-search
              onChange={(event) => setQuery(event.target.value)}
              aria-label={t("search")}
            />
            <kbd className="kx-kbd">Ctrl K</kbd>
          </label>
          <select
            className="kx-select"
            value={sort}
            data-lib-sort
            onChange={(event) => setSort(event.target.value as SortMode)}
            aria-label={t("library.sort")}
          >
            <option value="newest">{t("library.sort.newest")}</option>
            <option value="oldest">{t("library.sort.oldest")}</option>
            <option value="largest">{t("library.sort.largest")}</option>
            <option value="name">{t("library.sort.name")}</option>
          </select>
          <div className="kx-segmented" data-lib-view>
            <button
              type="button"
              aria-pressed={view === "grid"}
              data-view="grid"
              onClick={() => setView("grid")}
              title={t("library.viewGrid")}
            >
              <Icon name="dashboard" size={14} />
            </button>
            <button
              type="button"
              aria-pressed={view === "list"}
              data-view="list"
              onClick={() => setView("list")}
              title={t("library.viewList")}
            >
              <Icon name="layers" size={14} />
            </button>
          </div>
        </div>

        <div className="kx-row kx-lib-facets" style={{ gap: 8, flexWrap: "wrap" }}>
          <span className="kx-lib-facet-label" data-active-facets={activeFacets}>
            <Icon name="cut" size={13} />
            {t("library.filters")}
            {activeFacets > 0 && <b>{activeFacets}</b>}
          </span>
          <select
            className="kx-select kx-select-sm"
            value={dateFilter}
            data-facet="date"
            aria-label={t("library.date")}
            onChange={(event) => setDateFilter(event.target.value as DateFilter)}
          >
            <option value="all">{t("library.date.all")}</option>
            <option value="today">{t("library.date.today")}</option>
            <option value="week">{t("library.date.week")}</option>
            <option value="month">{t("library.date.month")}</option>
          </select>
          <select
            className="kx-select kx-select-sm"
            value={resolutionFilter}
            data-facet="resolution"
            aria-label={t("library.resolution")}
            onChange={(event) =>
              setResolutionFilter(event.target.value as ResolutionFilter)
            }
          >
            <option value="all">{t("library.resolution.all")}</option>
            <option value="sd">&lt; 1920</option>
            <option value="hd">1920–2559</option>
            <option value="qhd">2560–3839</option>
            <option value="uhd">3840+</option>
          </select>
          <select
            className="kx-select kx-select-sm"
            value={durationFilter}
            data-facet="duration"
            aria-label={t("library.duration")}
            onChange={(event) =>
              setDurationFilter(event.target.value as DurationFilter)
            }
          >
            <option value="all">{t("library.duration.all")}</option>
            <option value="short">&lt; 1 {t("library.minute")}</option>
            <option value="medium">1–5 {t("library.minutes")}</option>
            <option value="long">5+ {t("library.minutes")}</option>
          </select>
          <select
            className="kx-select kx-select-sm"
            value={sizeFilter}
            data-facet="size"
            aria-label={t("library.size")}
            onChange={(event) => setSizeFilter(event.target.value as SizeFilter)}
          >
            <option value="all">{t("library.size.all")}</option>
            <option value="small">&lt; 1 MB</option>
            <option value="medium">1–10 MB</option>
            <option value="large">10 MB+</option>
          </select>
          <select
            className="kx-select kx-select-sm"
            value={tagFilter}
            data-facet="tag"
            aria-label={t("library.tag")}
            onChange={(event) => setTagFilter(event.target.value)}
          >
            <option value="all">{t("library.tag.all")}</option>
            {allTags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
          {(activeFacets > 0 || favoritesOnly || Boolean(needle)) && (
            <button
              type="button"
              className="kx-btn kx-btn-sm"
              data-action="clear-filters"
              onClick={() => {
                clearFacets();
                setFavoritesOnly(false);
                setQuery("");
              }}
            >
              <Icon name="x" size={13} />
              {t("library.clearAll")}
            </button>
          )}
        </div>

        <div className="kx-row kx-muted kx-lib-summary" data-lib-summary>
          <span>
            {filtered.length} {t("library.summaryItems")}
          </span>
          <span>· {counts.video} {t("filterVideos")}</span>
          <span>· {counts.image} {t("filterImages")}</span>
          <span>· {counts.audio} {t("library.audio")}</span>
          <span>· {counts.favorites} {t("favorites")}</span>
          {!ready && <span>· {t("library.opening")}</span>}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="kx-lib-bulk" data-lib-bulk role="region" aria-label={t("library.bulk")}>
          <span className="kx-lib-bulk-count" data-selected-count>
            {t("library.selected").replace("{count}", String(selected.size))}
          </span>
          <button
            type="button"
            className="kx-btn kx-btn-sm"
            data-action="select-all"
            onClick={() =>
              setSelected(
                filtered.every((item) => selected.has(item.id))
                  ? new Set()
                  : new Set(filtered.map((item) => item.id)),
              )
            }
          >
            {t("library.selectAll")}
          </button>
          <button
            type="button"
            className="kx-btn kx-btn-sm"
            data-action="bulk-favorite"
            onClick={bulkFavorite}
          >
            <Icon name="star" size={14} />
            {t("library.bulkFavorite")}
          </button>
          <button
            type="button"
            className="kx-btn kx-btn-sm"
            data-action="bulk-export"
            onClick={bulkExport}
          >
            <Icon name="download" size={14} />
            {t("library.bulkExport")}
          </button>
          <select
            className="kx-select kx-select-sm"
            data-action="bulk-collection"
            aria-label={t("library.bulkCollection")}
            value=""
            onChange={(event) => event.target.value && bulkCollection(event.target.value)}
          >
            <option value="">{t("library.bulkCollection")}</option>
            {collections.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="kx-btn kx-btn-sm kx-btn-danger"
            data-action="bulk-delete"
            onClick={() => setBulkDelete(true)}
          >
            <Icon name="trash" size={14} />
            {t("library.bulkDelete")}
          </button>
          <button
            type="button"
            className="kx-btn kx-btn-sm"
            data-action="clear-selection"
            onClick={() => setSelected(new Set())}
          >
            {t("library.clearSelection")}
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon="folder"
          title={
            favoritesOnly
              ? t("noFavorites")
              : query || activeFacets
                ? t("library.noMatching")
                : t("emptyLibrary")
          }
          hint={
            favoritesOnly
              ? t("noFavoritesHint")
              : query || activeFacets
                ? t("library.tryDifferent")
                : t("emptyLibraryHint")
          }
        />
      ) : (
        <>
          <div className="kx-row kx-collection-bar" role="group" aria-label={t("library.collections")}>
            <span className="kx-muted kx-mono" style={{ fontSize: "0.68rem" }}>
              {t("library.collections")}
            </span>
            <button
              type="button"
              className="kx-chip"
              aria-pressed={collectionFilter === "all"}
              onClick={() => setCollectionFilter("all")}
            >
              {t("library.allCollections")}
            </button>
            <button
              type="button"
              className="kx-chip"
              aria-pressed={collectionFilter === "unfiled"}
              onClick={() => setCollectionFilter("unfiled")}
            >
              {t("library.noCollection")}
            </button>
            {collections.map((name) => (
              <button
                key={name}
                type="button"
                className="kx-chip"
                data-collection={name}
                aria-pressed={collectionFilter === name}
                onClick={() => setCollectionFilter(name)}
              >
                {name}
              </button>
            ))}
            {newCollection === null ? (
              <button
                type="button"
                className="kx-chip"
                data-action="new-collection"
                onClick={() => setNewCollection("")}
              >
                + {t("library.newCollection")}
              </button>
            ) : (
              <span className="kx-row" style={{ gap: 6 }}>
                <input
                  className="kx-input"
                  style={{ height: 28, minWidth: 140 }}
                  value={newCollection}
                  autoFocus
                  placeholder={t("library.collectionPlaceholder")}
                  aria-label={t("library.newCollection")}
                  onChange={(event) => setNewCollection(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && newCollection.trim()) {
                      // Only register the name. Filtering to it immediately would
                      // hide every card — and this bar — while the collection is
                      // still empty, which reads as if the click did nothing.
                      setExtraCollections((current) => [
                        ...new Set([...current, newCollection.trim()]),
                      ]);
                      setNewCollection(null);
                    }
                    if (event.key === "Escape") setNewCollection(null);
                  }}
                />
                <button
                  type="button"
                  className="kx-btn kx-btn-sm"
                  onClick={() => {
                    const value = newCollection.trim();
                    if (!value) return;
                    setExtraCollections((current) => [...new Set([...current, value])]);
                    setNewCollection(null);
                  }}
                >
                  {t("library.createCollection")}
                </button>
              </span>
            )}
          </div>

          <div className={view === "list" ? "kx-lib-list" : "kx-media-grid"} data-lib-results>
            {filtered.map((item) => (
              <article
                className={view === "list" ? "kx-lib-row" : "kx-media-card"}
                key={item.id}
                data-item-id={item.id}
              >
                {view === "list" && (
                  <input
                    type="checkbox"
                    className="kx-lib-check"
                    checked={selected.has(item.id)}
                    aria-label={`${t("library.select")}: ${item.name}`}
                    onChange={() => toggleSelected(item.id)}
                  />
                )}
                <button
                  type="button"
                  className={view === "list" ? "kx-lib-row-thumb" : "kx-media-thumb"}
                  onClick={() => setPreview(item)}
                  aria-label={`Preview ${item.name}`}
                >
                  <Thumbnail item={item} url={urlFor(item.id)} />
                  {item.kind === "video" && (
                    <span className="kx-media-duration">{formatDuration(item.duration)}</span>
                  )}
                  <span
                    className="kx-badge"
                    style={{ position: "absolute", top: 8, insetInlineStart: 8 }}
                  >
                    {item.source}
                  </span>
                </button>

                <div className={view === "list" ? "kx-lib-row-body" : "kx-media-body"}>
                  <span className={view === "list" ? "kx-lib-row-name" : "kx-media-name"} title={item.name}>
                    {item.name}
                  </span>
                  <span className="kx-media-meta">
                    <span>{formatBytes(item.size)}</span>
                    {item.kind === "video" && <span>{formatDuration(item.duration)}</span>}
                    {item.width > 0 && (
                      <span>
                        {item.width}×{item.height}
                      </span>
                    )}
                    <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                  </span>
                  {(item.tags ?? []).length > 0 && (
                    <span className="kx-lib-tags">
                      {item.tags?.map((tag) => (
                        <span className="kx-shot-tag" key={tag}>
                          {tag}
                        </span>
                      ))}
                    </span>
                  )}

                  <div className="kx-media-actions">
                    <button
                      type="button"
                      className={`kx-btn kx-btn-sm${item.favorite ? " kx-star-active" : ""}`}
                      onClick={() => void toggleFavorite(item.id)}
                      title={item.favorite ? t("removeFavorite") : t("addFavorite")}
                      aria-pressed={Boolean(item.favorite)}
                    >
                      <Icon name="star" size={14} />
                    </button>
                    <button
                      type="button"
                      className="kx-btn kx-btn-sm"
                      onClick={() => setPreview(item)}
                      title={t("preview")}
                    >
                      <Icon name="eye" size={14} />
                    </button>
                    <button
                      type="button"
                      className="kx-btn kx-btn-sm"
                      onClick={() => downloadBlob(item.blob, item.name)}
                      title={t("export")}
                    >
                      <Icon name="download" size={14} />
                    </button>
                    <button
                      type="button"
                      className="kx-btn kx-btn-sm"
                      onClick={() => setRenameItem(item)}
                      title={t("rename")}
                    >
                      <Icon name="pencil" size={14} />
                    </button>
                    <select
                      className="kx-btn kx-btn-sm kx-open-in"
                      data-collection-for={item.id}
                      aria-label={t("library.collection")}
                      value={item.collection ?? ""}
                      onChange={(event) => void setCollection(item.id, event.target.value)}
                    >
                      <option value="">{t("library.noCollection")}</option>
                      {collections.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <select
                      className="kx-btn kx-btn-sm kx-open-in"
                      data-open-in={item.id}
                      aria-label={t("openIn")}
                      value=""
                      onChange={(event) => {
                        const hub = event.target.value;
                        if (!hub) return;
                        const receiver = RECEIVERS[item.kind].find((entry) => entry.hub === hub);
                        if (!receiver) return;
                        send({
                          kind: item.kind,
                          name: item.name,
                          blob: item.blob,
                          itemId: item.id,
                          provenance: item.provenance ?? [],
                        });
                        push("info", t("openIn"), `${hub} · ${item.name}`);
                        onNavigate(receiver.route);
                      }}
                    >
                      <option value="">{t("openIn")}</option>
                      {RECEIVERS[item.kind].map((receiver) => (
                        <option key={receiver.hub} value={receiver.hub}>
                          {t(`hub.${receiver.hub}`)}
                        </option>
                      ))}
                    </select>
                    {item.kind === "video" && (
                      <button
                        type="button"
                        className="kx-btn kx-btn-sm"
                        onClick={() => setTrimItem(item)}
                        title={t("trim")}
                      >
                        <Icon name="cut" size={14} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="kx-btn kx-btn-sm kx-btn-danger"
                      onClick={() => setDeleteItem(item)}
                      title={t("delete")}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="kx-lib-footer" data-lib-footer>
            <span className="kx-lib-footer-note">
              <Icon name="check" size={15} />
              {t("library.storedLocally")}
            </span>
            <span className="kx-muted kx-mono" style={{ fontSize: "0.7rem" }}>
              {items.length} {t("library.summaryItems")} · {formatBytes(totalBytes)}
            </span>
          </div>
        </>
      )}

      <PreviewDialog
        item={preview}
        url={preview ? urlFor(preview.id) : null}
        onClose={() => setPreview(null)}
        onExport={(item) => downloadBlob(item.blob, item.name)}
      />

      <RenameDialog
        open={Boolean(renameItem)}
        initial={renameItem?.name ?? ""}
        onCancel={() => setRenameItem(null)}
        onSave={(value) => {
          if (!renameItem) return;
          const target = renameItem;
          setRenameItem(null);
          void rename(target.id, value)
            .then(() => push("success", t("rename"), value))
            .catch((cause: unknown) =>
              push(
                "error",
                t("library.renameFailed"),
                cause instanceof Error ? cause.message : t("library.unknownStorageError"),
              ),
            );
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteItem)}
        title={t("library.deleteCapture")}
        message={
          deleteItem
            ? `“${deleteItem.name}” will be removed from IndexedDB. This cannot be undone.`
            : ""
        }
        onCancel={() => setDeleteItem(null)}
        onConfirm={() => {
          if (!deleteItem) return;
          const target = deleteItem;
          setDeleteItem(null);
          void remove(target.id)
            .then(() => push("success", t("delete"), target.name))
            .catch((cause: unknown) =>
              push(
                "error",
                t("library.deleteFailed"),
                cause instanceof Error ? cause.message : t("library.unknownStorageError"),
              ),
            );
        }}
      />

      <ConfirmDialog
        open={bulkDelete}
        title={t("library.bulkDelete")}
        message={t("library.bulkDeleteMessage").replace("{count}", String(selected.size))}
        onConfirm={() => void confirmBulkDelete()}
        onCancel={() => setBulkDelete(false)}
      />

      <TrimDialog
        item={trimItem}
        url={trimItem ? urlFor(trimItem.id) : null}
        onClose={() => setTrimItem(null)}
      />
    </div>
  );
}
