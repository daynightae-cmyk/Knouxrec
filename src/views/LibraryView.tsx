import { useState } from "react";
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
  useFilteredItems,
} from "./ui";
import { downloadBlob, formatBytes, formatDuration } from "../lib/format";
import type { LibraryItem } from "../state/types";

type KindFilter = "all" | "video" | "image" | "audio";
type SortMode = "newest" | "oldest" | "largest";

export default function LibraryView() {
  const { items, urlFor, rename, toggleFavorite, remove, reload, ready, error } =
    useLibrary();
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

  const filtered = useFilteredItems(items, kind, query, sort).filter(
    (item) => !favoritesOnly || item.favorite,
  );
  const totalBytes = items.reduce((sum, item) => sum + item.size, 0);

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

      <div className="kx-grid kx-grid-4">
        <StatCard
          label={t("library.totalItems")}
          value={String(items.length)}
          icon="layers"
          hint={t("library.persistedLocally")}
        />
        <StatCard
          label={t("filterVideos")}
          value={String(items.filter((item) => item.kind === "video").length)}
          icon="video"
          hint={t("library.playableClips")}
        />
        <StatCard
          label={t("filterImages")}
          value={String(items.filter((item) => item.kind === "image").length)}
          icon="image"
          hint={t("library.screenshotsEdits")}
        />
        <StatCard
          label={t("storageUsed")}
          value={formatBytes(totalBytes)}
          icon="hardDrive"
          hint={t("library.encodedBlob")}
        />
      </div>

      <div className="kx-card">
        <div className="kx-row-between">
          <div className="kx-row" style={{ gap: 6 }}>
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
                aria-pressed={kind === value}
                onClick={() => setKind(value)}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className="kx-chip"
              aria-pressed={favoritesOnly}
              onClick={() => setFavoritesOnly((value) => !value)}
            >
              <Icon name="star" size={13} />
              {t("favorites")}
            </button>
          </div>

          <div className="kx-row">
            <label className="kx-search">
              <Icon name="search" size={16} />
              <input
                className="kx-input"
                placeholder={`${t("search")}…`}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label={t("search")}
              />
            </label>
            <select
              className="kx-select"
              style={{ width: 160 }}
              value={sort}
              onChange={(event) => setSort(event.target.value as SortMode)}
              aria-label={t("library.sort")}
            >
              <option value="newest">{t("library.sort.newest")}</option>
              <option value="oldest">{t("library.sort.oldest")}</option>
              <option value="largest">{t("library.sort.largest")}</option>
            </select>
          </div>
        </div>

        <div className="kx-row kx-muted" style={{ marginTop: 12, fontSize: "0.76rem" }}>
          <span>
            {filtered.length} {t("searchResults")}
          </span>
          {!ready && <span>· opening library…</span>}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon="folder"
          title={
            favoritesOnly
              ? t("noFavorites")
              : query
                ? t("library.noMatching")
                : t("emptyLibrary")
          }
          hint={
            favoritesOnly
              ? t("noFavoritesHint")
              : query
                ? t("library.tryDifferent")
                : t("emptyLibraryHint")
          }
        />
      ) : (
        <div className="kx-media-grid">
          {filtered.map((item) => (
            <article className="kx-media-card" key={item.id}>
              <button
                type="button"
                className="kx-media-thumb"
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

              <div className="kx-media-body">
                <span className="kx-media-name" title={item.name}>
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

      <TrimDialog
        item={trimItem}
        url={trimItem ? urlFor(trimItem.id) : null}
        onClose={() => setTrimItem(null)}
      />
    </div>
  );
}
