import { useEffect, useMemo, useState } from "react";
import Modal from "../../components/Modal";
import { Icon } from "../app/icons";
import { useLibrary } from "../state/LibraryContext";
import { useSettings } from "../state/SettingsContext";
import { translate } from "../i18n/translate";
import { formatBytes, formatDuration } from "../lib/format";
import type { LibraryItem } from "../state/types";

/**
 * Shared "pick an existing file" dialog.
 *
 * Any hub that can work on a stored media file uses this instead of asking the
 * user to re-import something that is already on disk. The item is handed back
 * by reference: callers must treat `item.blob` as read-only and save their
 * result as a new library entry, so originals are never overwritten.
 */
export default function MediaPicker({
  open,
  kind,
  onClose,
  onPick,
}: {
  open: boolean;
  kind: "audio" | "video" | "image";
  onClose: () => void;
  onPick: (item: LibraryItem) => void;
}) {
  const { items } = useLibrary();
  const { settings } = useSettings();
  const t = (key: string) => translate(settings.language, key);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items
      .filter((item) => item.kind === kind)
      .filter((item) => (needle ? item.name.toLowerCase().includes(needle) : true))
      .slice(0, 60);
  }, [items, kind, query]);

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={t("picker.title")}
      size="lg"
      type="preview"
    >
      <div className="kx-picker">
        <div className="kx-row" style={{ gap: 10 }}>
          <input
            className="kx-input kx-search"
            type="search"
            autoFocus
            value={query}
            placeholder={t("picker.search")}
            aria-label={t("picker.search")}
            onChange={(event) => setQuery(event.target.value)}
          />
          <span className="kx-badge" data-state="PARTIAL" dir="ltr">
            {candidates.length}
          </span>
        </div>
        <p className="kx-card-sub">{t("picker.hint")}</p>
        {candidates.length === 0 ? (
          <div className="kx-empty">
            <Icon name="folder" size={28} />
            <div className="kx-empty-title">{t("picker.empty")}</div>
            <p className="kx-empty-hint">{t("picker.emptyHint")}</p>
          </div>
        ) : (
          <ul className="kx-picker-grid">
            {candidates.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="kx-picker-card"
                  data-picker-item={item.id}
                  onClick={() => onPick(item)}
                >
                  <span className="kx-picker-thumb">
                    {item.thumbnail ? (
                      <img src={item.thumbnail} alt="" />
                    ) : (
                      <Icon name={item.kind === "image" ? "image" : item.kind} size={26} />
                    )}
                  </span>
                  <span className="kx-picker-name">{item.name}</span>
                  <span className="kx-muted kx-mono" style={{ fontSize: "0.66rem" }} dir="ltr">
                    {formatBytes(item.size)}
                    {item.duration ? ` · ${formatDuration(item.duration)}` : ""}
                    {item.width ? ` · ${item.width}×${item.height}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
