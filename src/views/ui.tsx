import React, { useEffect, useMemo, useState } from "react";
import Modal from "../../components/Modal";
import { Icon, type IconName } from "../app/icons";
import type { Capability } from "../app/capabilities";
import type { CapabilityState, LibraryItem } from "../state/types";
import {
  createThumbnail,
  formatBytes,
  formatDuration,
  extensionForMime,
} from "../lib/format";
import { trimMedia } from "../services/recordingEngine";
import { useLibrary } from "../state/LibraryContext";
import { useToast } from "../state/ToastContext";

export const STATE_LABEL: Record<CapabilityState, string> = {
  VERIFIED: "Verified",
  AVAILABLE_UNVERIFIED: "Available · unverified",
  PARTIAL: "Partial",
  MISSING_ENGINE: "Missing engine",
  MISSING_MODEL: "Missing model",
  NOT_IMPLEMENTED: "Not implemented",
  BLOCKED: "Blocked",
};

export function StateBadge({ state }: { state: CapabilityState }) {
  return (
    <span className="kx-badge" data-state={state}>
      {STATE_LABEL[state]}
    </span>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="kx-row-between kx-view-head">
      <div>
        {eyebrow && (
          <div className="kx-eyebrow">
            <span className="kx-status-dot" />
            {eyebrow}
          </div>
        )}
        <h1 className="kx-view-title">{title}</h1>
        {description && <p className="kx-view-desc">{description}</p>}
      </div>
      {actions && <div className="kx-row">{actions}</div>}
    </header>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: IconName;
}) {
  return (
    <div className="kx-stat">
      <span className="kx-stat-label">
        {icon && <Icon name={icon} size={14} />} {label}
      </span>
      <span className="kx-stat-value">{value}</span>
      {hint && <span className="kx-stat-hint">{hint}</span>}
    </div>
  );
}

export function EmptyState({
  icon = "folder",
  title,
  hint,
  action,
}: {
  icon?: IconName;
  title: string;
  hint: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="kx-empty">
      <Icon name={icon} size={34} />
      <div className="kx-empty-title">{title}</div>
      <p className="kx-empty-hint">{hint}</p>
      {action}
    </div>
  );
}

export function CapabilityNotice({ capability }: { capability: Capability }) {
  const tone =
    capability.state === "VERIFIED"
      ? "ok"
      : capability.state === "AVAILABLE_UNVERIFIED"
        ? "info"
        : capability.state === "PARTIAL"
          ? "warn"
          : "danger";
  return (
    <div className="kx-notice" data-tone={tone}>
      <Icon
        name={
          tone === "ok"
            ? "check"
            : tone === "info"
              ? "info"
              : tone === "warn"
                ? "alert"
                : "lock"
        }
        size={18}
      />
      <div>
        <div className="kx-row" style={{ gap: 8 }}>
          <strong>{capability.summary}</strong>
          <StateBadge state={capability.state} />
        </div>
        {capability.requirements.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <span className="kx-muted">Requires: </span>
            {capability.requirements.join(" · ")}
          </div>
        )}
        <div style={{ marginTop: 4 }}>
          <span className="kx-muted">Evidence: </span>
          {capability.evidence}
        </div>
      </div>
    </div>
  );
}

export function SectionLoading({ label = "Loading section" }: { label?: string }) {
  return (
    <div className="kx-empty" role="status" aria-live="polite">
      <span className="kx-spin">
        <Icon name="refresh" size={26} />
      </span>
      <div className="kx-empty-title">{label}</div>
      <p className="kx-empty-hint">
        The module is being loaded from the local bundle.
      </p>
    </div>
  );
}

export function Thumbnail({
  item,
  url,
}: {
  item: LibraryItem;
  url: string | null;
}) {
  const source =
    item.thumbnail ?? (item.kind === "image" && url ? url : null);
  if (source) {
    return <img src={source} alt="" loading="lazy" />;
  }
  return (
    <span className="kx-media-fallback">
      <Icon
        name={item.kind === "video" ? "video" : item.kind === "audio" ? "audio" : "image"}
        size={30}
      />
    </span>
  );
}

export function PreviewDialog({
  item,
  url,
  onClose,
  onExport,
}: {
  item: LibraryItem | null;
  url: string | null;
  onClose: () => void;
  onExport: (item: LibraryItem) => void;
}) {
  const mediaStyle: React.CSSProperties = {
    width: "100%",
    maxHeight: "62vh",
    borderRadius: 12,
    background: "#050507",
    display: "block",
  };

  return (
    <Modal
      isOpen={Boolean(item)}
      onClose={onClose}
      title={item?.name ?? "Preview"}
      size="lg"
      footer={
        item && (
          <>
            <button type="button" className="kx-btn" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="kx-btn kx-btn-primary"
              onClick={() => onExport(item)}
            >
              <Icon name="download" size={16} />
              Export file
            </button>
          </>
        )
      }
    >
      {!item || !url ? (
        <EmptyState
          icon="info"
          title="No preview available"
          hint="The stored blob could not be turned into a local object URL."
        />
      ) : item.kind === "image" ? (
        <img src={url} alt={item.name} style={mediaStyle} />
      ) : item.kind === "audio" ? (
        <>
          <div className="kx-empty" style={{ padding: 30 }}>
            <Icon name="audio" size={40} />
            <div className="kx-empty-title">{item.name}</div>
            <p className="kx-empty-hint">
              {formatDuration(item.duration)} · {formatBytes(item.size)}
            </p>
          </div>
          <audio src={url} controls autoPlay style={{ width: "100%", marginTop: 12 }} />
        </>
      ) : (
        <video src={url} controls autoPlay style={mediaStyle} />
      )}
    </Modal>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      isOpen={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <button type="button" className="kx-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="kx-btn kx-btn-danger" onClick={onConfirm}>
            <Icon name="trash" size={16} />
            {confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ lineHeight: 1.6, margin: 0 }}>{message}</p>
    </Modal>
  );
}

export function RenameDialog({
  open,
  initial,
  onCancel,
  onSave,
}: {
  open: boolean;
  initial: string;
  onCancel: () => void;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);

  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);

  return (
    <Modal
      isOpen={open}
      onClose={onCancel}
      title="Rename item"
      size="sm"
      footer={
        <>
          <button type="button" className="kx-btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="kx-btn kx-btn-primary"
            disabled={!value.trim()}
            onClick={() => onSave(value)}
          >
            Save name
          </button>
        </>
      }
    >
      <label className="kx-field">
        <span className="kx-label">File name</span>
        <input
          className="kx-input"
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && value.trim()) onSave(value);
          }}
        />
      </label>
    </Modal>
  );
}

export function TrimDialog({
  item,
  url,
  onClose,
}: {
  item: LibraryItem | null;
  url: string | null;
  onClose: () => void;
}) {
  const { add } = useLibrary();
  const { push } = useToast();
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    setDuration(item.duration || 0);
    setStart(0);
    setEnd(item.duration || 0);
    setBusy(false);
    setProgress(0);
    setError(null);
  }, [item]);

  const apply = async () => {
    if (!item) return;
    if (!(end > start)) {
      setError("Choose a non-empty range before trimming.");
      return;
    }
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      const blob = await trimMedia(item.blob, start, end, setProgress);
      const extension = extensionForMime(blob.type || item.mimeType);
      const base = item.name.replace(/\.[^.]+$/, "");
      const name = `${base}-trim.${extension}`;
      const thumbnail = await createThumbnail(blob);
      await add({
        name,
        kind: "video",
        mimeType: blob.type || item.mimeType,
        blob,
        duration: Math.max(0, end - start),
        width: item.width,
        height: item.height,
        source: "trim",
        thumbnail,
      });
      push(
        "success",
        "Trim saved as a new clip",
        `${name} · ${formatDuration(end - start)} · ${formatBytes(blob.size)}`,
      );
      onClose();
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "The trim could not be completed.";
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={Boolean(item)}
      onClose={busy ? () => undefined : onClose}
      title={item ? `Trim · ${item.name}` : "Trim"}
      size="lg"
      closeOnBackdrop={!busy}
      footer={
        <>
          <button
            type="button"
            className="kx-btn"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="kx-btn kx-btn-primary"
            onClick={() => void apply()}
            disabled={busy || !duration}
          >
            {busy ? (
              <>
                <span className="kx-spin">
                  <Icon name="refresh" size={16} />
                </span>
                Re-encoding {Math.round(progress * 100)}%
              </>
            ) : (
              <>
                <Icon name="cut" size={16} />
                Apply trim
              </>
            )}
          </button>
        </>
      }
    >
      {!item || !url ? (
        <EmptyState
          icon="info"
          title="Trim unavailable"
          hint="The stored video could not be opened for trimming."
        />
      ) : (
        <div className="kx-col">
          <video
            src={url}
            controls
            style={{
              width: "100%",
              maxHeight: "48vh",
              borderRadius: 12,
              background: "#050507",
            }}
            onLoadedMetadata={(event) => {
              const value = event.currentTarget.duration;
              if (Number.isFinite(value) && value > 0) {
                setDuration(value);
                setEnd((current) => (current > 0 ? Math.min(current, value) : value));
              }
            }}
          />
          {duration > 0 && (
            <>
              <div className="kx-row-between kx-mono">
                <span>Start {formatDuration(start)}</span>
                <span>End {formatDuration(end)}</span>
                <span>Length {formatDuration(Math.max(0, end - start))}</span>
              </div>
              <label className="kx-field">
                <span className="kx-label">Start point</span>
                <input
                  type="range"
                  min={0}
                  max={duration}
                  step={0.1}
                  value={start}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setStart(Math.min(value, end - 0.1));
                  }}
                  disabled={busy}
                />
              </label>
              <label className="kx-field">
                <span className="kx-label">End point</span>
                <input
                  type="range"
                  min={0}
                  max={duration}
                  step={0.1}
                  value={end}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setEnd(Math.max(value, start + 0.1));
                  }}
                  disabled={busy}
                />
              </label>
              <div className="kx-notice" data-tone="info">
                <Icon name="info" size={16} />
                The selection is re-encoded into a new clip. The original stays in the
                library untouched.
              </div>
            </>
          )}
          {busy && (
            <div className="kx-splash-progress">
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
          {error && (
            <div className="kx-notice" data-tone="danger">
              <Icon name="alert" size={16} />
              {error}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export function useFilteredItems(
  items: LibraryItem[],
  kind: "all" | "video" | "image" | "audio",
  query: string,
  sort: "newest" | "oldest" | "largest",
) {
  return useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = items.filter((item) => {
      const kindMatches = kind === "all" || item.kind === kind;
      const queryMatches =
        !needle || item.name.toLowerCase().includes(needle) || item.source.includes(needle);
      return kindMatches && queryMatches;
    });
    return filtered.sort((a, b) => {
      if (sort === "oldest") return a.createdAt - b.createdAt;
      if (sort === "largest") return b.size - a.size;
      return b.createdAt - a.createdAt;
    });
  }, [items, kind, query, sort]);
}
