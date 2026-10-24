import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CAPABILITIES, type RouteId } from "../app/capabilities";
import { Icon } from "../app/icons";
import MediaPicker from "../ui/MediaPicker";
import { useLibrary } from "../state/LibraryContext";
import { useSettings } from "../state/SettingsContext";
import { useToast } from "../state/ToastContext";
import { translate } from "../i18n/translate";
import { downloadBlob, formatBytes } from "../lib/format";
import type { LibraryItem, ProvenanceRecord } from "../state/types";
import {
  BatchCancelledError,
  DEFAULT_SETTINGS,
  processItem,
  runPool,
  verifyOutput,
  type BatchItem,
  type BatchOperation,
  type BatchSettings,
} from "../services/batchQueue";
import { EmptyState, SectionHeader, StateBadge } from "./ui";
import { useHandoffReceiver } from "../ui/handoff";

const MAX_FILES = 40;
const MAX_TOTAL_BYTES = 120 * 1024 * 1024;

const OPERATIONS: Array<{ id: BatchOperation; labelKey: string; hintKey: string }> = [
  { id: "resize", labelKey: "batch.op.resize", hintKey: "batch.op.resizeHint" },
  { id: "convert", labelKey: "batch.op.convert", hintKey: "batch.op.convertHint" },
  { id: "crop", labelKey: "batch.op.crop", hintKey: "batch.op.cropHint" },
  { id: "watermark", labelKey: "batch.op.watermark", hintKey: "batch.op.watermarkHint" },
];

const ASPECTS: Array<{ value: number; label: string }> = [
  { value: 1, label: "1:1" },
  { value: 4 / 3, label: "4:3" },
  { value: 3 / 2, label: "3:2" },
  { value: 16 / 9, label: "16:9" },
];

let nextId = 0;
const makeId = () => `batch-${Date.now().toString(36)}-${(nextId += 1)}`;

export default function BatchView({
  onNavigate,
}: {
  onNavigate: (route: RouteId) => void;
}) {
  const capability = CAPABILITIES.batch;
  const { settings: appSettings } = useSettings();
  const { items: libraryItems, add } = useLibrary();
  const { push } = useToast();
  const t = useCallback(
    (key: string) => translate(appSettings.language, key),
    [appSettings.language],
  );

  const fileRef = useRef<HTMLInputElement | null>(null);
  const cancelledRef = useRef(false);
  const urlsRef = useRef<Map<string, string>>(new Map());

  const [items, setItems] = useState<BatchItem[]>([]);
  const [config, setConfig] = useState<BatchSettings>(DEFAULT_SETTINGS);
  const [concurrency, setConcurrency] = useState(3);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<{ done: number; failed: number; cancelled: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [handoffNote, setHandoffNote] = useState<string | null>(null);

  const patch = useCallback((id: string, value: Partial<BatchItem>) => {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...value } : item)),
    );
  }, []);

  useEffect(() => {
    const map = urlsRef.current;
    return () => {
      map.forEach((url) => URL.revokeObjectURL(url));
      map.clear();
    };
  }, []);

  useHandoffReceiver("batch", "image", (incoming) => {
    addFiles([
      {
        name: incoming.name,
        blob: incoming.blob,
        mimeType: incoming.blob.type,
        provenance: incoming.provenance,
      },
    ]);
    setHandoffNote(incoming.name);
  });

  const outputUrl = useCallback((item: BatchItem): string | null => {
    if (!item.output) return null;
    const existing = urlsRef.current.get(item.id);
    if (existing) return existing;
    const url = URL.createObjectURL(item.output.blob);
    urlsRef.current.set(item.id, url);
    return url;
  }, []);

  const addFiles = useCallback(
    (
      files: Array<{
        name: string;
        blob: Blob;
        mimeType: string;
        provenance?: ProvenanceRecord[];
      }>,
    ) => {
      setError(null);
      setItems((current) => {
        const room = MAX_FILES - current.length;
        if (room <= 0) {
          setError(`${t("batch.tooMany")} (${MAX_FILES})`);
          return current;
        }
        const existing = new Set(current.map((item) => `${item.name}:${item.inputBytes}`));
        const accepted: BatchItem[] = [];
        let bytes = current.reduce((sum, item) => sum + item.inputBytes, 0);
        for (const file of files.slice(0, room)) {
          const key = `${file.name}:${file.blob.size}`;
          if (existing.has(key)) continue;
          if (bytes + file.blob.size > MAX_TOTAL_BYTES) {
            setError(t("batch.tooLarge"));
            break;
          }
          bytes += file.blob.size;
          existing.add(key);
          accepted.push({
            id: makeId(),
            name: file.name,
            inputBytes: file.blob.size,
            mimeType: file.mimeType || file.blob.type || "image/png",
            status: "queued",
            progress: 0,
            error: null,
            ms: 0,
            output: null,
            blob: file.blob,
            provenance: file.provenance,
          });
        }
        return [...current, ...accepted];
      });
      setSummary(null);
    },
    [t],
  );

  const onPicked = useCallback(
    (picked: LibraryItem[]) => {
      addFiles(
        picked.map((item) => ({ name: item.name, blob: item.blob, mimeType: item.mimeType })),
      );
    },
    [addFiles],
  );

  const start = useCallback(async () => {
    const pending = items.filter((item) => item.status !== "done");
    if (pending.length === 0) {
      setError(t("batch.nothing"));
      return;
    }
    cancelledRef.current = false;
    setRunning(true);
    setSummary(null);
    setError(null);
    for (const item of pending) {
      patch(item.id, { status: "queued", progress: 0, error: null, output: null, ms: 0 });
    }
    const report = await runPool(
      pending,
      async (entry) => {
        if (cancelledRef.current) throw new BatchCancelledError();
        patch(entry.id, { status: "running", progress: 0.4 });
        const started = performance.now();
        const output = await processItem(entry as BatchItem, config);
        await verifyOutput(output);
        if (cancelledRef.current) throw new BatchCancelledError();
        patch(entry.id, {
          status: "done",
          progress: 1,
          output,
          ms: Math.round(performance.now() - started),
          error: null,
        });
      },
      {
        concurrency,
        isCancelled: () => cancelledRef.current,
        onItem: (id, value) => patch(id, value),
      },
    );
    setSummary({ done: report.done, failed: report.failed, cancelled: report.cancelled });
    setRunning(false);
  }, [config, concurrency, items, patch, t]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
  }, []);

  const clearFinished = useCallback(() => {
    setItems((current) => {
      current
        .filter((item) => item.output)
        .forEach((item) => {
          const url = urlsRef.current.get(item.id);
          if (url) URL.revokeObjectURL(url);
          urlsRef.current.delete(item.id);
        });
      return current.filter((item) => item.status === "queued");
    });
    setSummary(null);
  }, []);

  const saveAll = useCallback(async () => {
    const finished = items.filter((item) => item.output);
    let saved = 0;
    for (const item of finished) {
      const output = item.output as NonNullable<BatchItem["output"]>;
      await add({
        name: output.fileName,
        kind: "image",
        mimeType: output.mimeType,
        blob: output.blob,
        duration: 0,
        width: output.width,
        height: output.height,
        source: "toolbox",
        thumbnail: null,
        provenance: item.provenance?.length
          ? [...item.provenance, { itemId: null, name: output.fileName, hub: "batch" as const, at: Date.now() }]
          : [{ itemId: null, name: item.name, hub: "batch" as const, at: Date.now() }],
      });
      saved += 1;
    }
    if (saved > 0) {
      push("success", t("batch.savedAll"), `${saved} · ${t("batch.provenanceNote")}`);
    }
  }, [add, items, push, t]);

  const downloadAll = useCallback(async () => {
    const finished = items.filter((item) => item.output);
    for (const item of finished) {
      const output = item.output as NonNullable<BatchItem["output"]>;
      downloadBlob(output.blob, output.fileName);
      await new Promise((resolve) => setTimeout(resolve, 220));
    }
  }, [items]);

  const totals = useMemo(() => {
    const finished = items.filter((item) => item.output);
    return {
      queued: items.filter((item) => item.status === "queued").length,
      done: finished.length,
      failed: items.filter((item) => item.status === "failed").length,
      inputBytes: items.reduce((sum, item) => sum + item.inputBytes, 0),
      outputBytes: finished.reduce((sum, item) => sum + (item.output?.bytes ?? 0), 0),
    };
  }, [items]);

  const activeOperation = OPERATIONS.find((entry) => entry.id === config.operation);

  return (
    <div className="kx-content kx-batch">
      <SectionHeader
        eyebrow={t("groupCreate")}
        title={t("batch.title")}
        description={t("batch.description")}
        actions={
          <div className="kx-row" style={{ gap: 8 }}>
            <StateBadge state={capability.state} />
            <button
              type="button"
              className="kx-btn kx-btn-sm"
              onClick={() => setPickerOpen(true)}
              disabled={running}
            >
              <Icon name="folder" size={14} />
              {t("batch.fromLibrary")}
            </button>
            <button
              type="button"
              className="kx-btn kx-btn-primary kx-btn-sm"
              onClick={() => fileRef.current?.click()}
              disabled={running}
            >
              <Icon name="upload" size={14} />
              {t("batch.addFiles")}
            </button>
          </div>
        }
      />

      <div className="kx-notice" data-tone="info">
        <Icon name="cpu" size={18} />
        <div>
          <strong>{t("batch.honestTitle")}</strong> {t("batch.honestBody")}
        </div>
      </div>

      <div className="kx-batch-grid">
        {/* settings */}
        <aside className="kx-card kx-batch-side" aria-label={t("batch.settings")}>
          <h3 className="kx-subtitle">{t("batch.operation")}</h3>
          <div className="kx-batch-ops" role="group" aria-label={t("batch.operation")}>
            {OPERATIONS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="kx-btn kx-batch-op"
                data-operation-id={entry.id}
                aria-pressed={config.operation === entry.id}
                disabled={running}
                onClick={() => setConfig((current) => ({ ...current, operation: entry.id }))}
              >
                {t(entry.labelKey)}
              </button>
            ))}
          </div>
          {activeOperation && <p className="kx-card-sub">{t(activeOperation.hintKey)}</p>}

          <div className="kx-divider" />

          {config.operation === "resize" && (
            <>
              <div className="kx-segmented" role="group" aria-label={t("batch.mode")}>
                {(["fit", "fill", "stretch"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    data-mode={mode}
                    aria-pressed={config.mode === mode}
                    onClick={() => setConfig((current) => ({ ...current, mode }))}
                  >
                    {t(`batch.mode.${mode}`)}
                  </button>
                ))}
              </div>
              {numberField("batch.field.width", config.width, 16, 4096, (value) => ({ width: value }))}
              {numberField("batch.field.height", config.height, 16, 4096, (value) => ({ height: value }))}
            </>
          )}

          {config.operation === "crop" && (
            <div className="kx-segmented" role="group" aria-label={t("batch.aspect")}>
              {ASPECTS.map((aspect) => (
                <button
                  key={aspect.label}
                  type="button"
                  data-aspect={aspect.label}
                  aria-pressed={Math.abs(config.aspect - aspect.value) < 0.001}
                  onClick={() => setConfig((current) => ({ ...current, aspect: aspect.value }))}
                >
                  {aspect.label}
                </button>
              ))}
            </div>
          )}

          {config.operation === "watermark" && (
            <>
              <label className="kx-field">
                <span className="kx-label">{t("batch.field.text")}</span>
                <input
                  className="kx-input"
                  value={config.watermarkText}
                  data-field="watermarkText"
                  onChange={(event) =>
                    setConfig((current) => ({ ...current, watermarkText: event.target.value }))
                  }
                />
              </label>
              {numberField(
                "batch.field.size",
                config.watermarkSize,
                8,
                200,
                (value) => ({ watermarkSize: value }),
              )}
              {numberField(
                "batch.field.opacity",
                config.watermarkOpacity,
                1,
                100,
                (value) => ({ watermarkOpacity: value }),
              )}
            </>
          )}

          <div className="kx-segmented" dir="ltr" role="group" aria-label={t("batch.format")}>
            {(["png", "jpeg", "webp"] as const).map((format) => (
              <button
                key={format}
                type="button"
                data-format={format}
                aria-pressed={config.format === format}
                onClick={() => setConfig((current) => ({ ...current, format }))}
              >
                {format.toUpperCase()}
              </button>
            ))}
          </div>
          {config.format !== "png" &&
            numberField("batch.field.quality", config.quality, 20, 100, (value) => ({ quality: value }))}

          <div className="kx-divider" />
          <h3 className="kx-subtitle">{t("batch.concurrency")}</h3>
          <div className="kx-segmented" role="group" aria-label={t("batch.concurrency")}>
            {[1, 2, 3, 4].map((slot) => (
              <button
                key={slot}
                type="button"
                data-concurrency={slot}
                aria-pressed={concurrency === slot}
                disabled={running}
                onClick={() => setConcurrency(slot)}
              >
                {slot}
              </button>
            ))}
          </div>
          <p className="kx-card-sub">{t("batch.concurrencyHint")}</p>
        </aside>

        {/* queue */}
        <section className="kx-card kx-batch-queue" aria-label={t("batch.queue")}>
          <div className="kx-row-between" style={{ gap: 10, flexWrap: "wrap" }}>
            <span className="kx-mono kx-muted" dir="ltr">
              {items.length} / {MAX_FILES} · {formatBytes(totals.inputBytes)} →{" "}
              {formatBytes(totals.outputBytes)}
            </span>
            <div className="kx-row" style={{ gap: 6, flexWrap: "wrap" }}>
              {!running ? (
                <button
                  type="button"
                  className="kx-btn kx-btn-primary"
                  data-action="start"
                  onClick={() => void start()}
                  disabled={items.length === 0}
                >
                  <Icon name="play" size={15} />
                  {t("batch.start")}
                </button>
              ) : (
                <button type="button" className="kx-btn" data-action="cancel" onClick={cancel}>
                  <Icon name="x" size={15} />
                  {t("batch.cancel")}
                </button>
              )}
              <button
                type="button"
                className="kx-btn"
                data-action="save-all"
                onClick={() => void saveAll()}
                disabled={running || totals.done === 0}
              >
                <Icon name="download" size={15} />
                {t("batch.saveAll")}
              </button>
              <button
                type="button"
                className="kx-btn"
                data-action="download-all"
                onClick={() => void downloadAll()}
                disabled={running || totals.done === 0}
              >
                <Icon name="export" size={15} />
                {t("batch.downloadAll")}
              </button>
              <button
                type="button"
                className="kx-btn"
                data-action="clear"
                onClick={clearFinished}
                disabled={running || items.length === 0}
              >
                {t("batch.clear")}
              </button>
            </div>
          </div>

          {summary && (
            <div className="kx-notice" data-tone={summary.failed ? "warn" : "info"} role="status">
              <Icon name={summary.failed ? "alert" : "check"} size={16} />
              <div dir="ltr">
                {summary.done} {t("batch.done")} · {summary.failed} {t("batch.failed")} ·{" "}
                {summary.cancelled} {t("batch.cancelled")}
              </div>
            </div>
          )}

          {error && (
            <div className="kx-notice" data-tone="danger">
              <Icon name="alert" size={16} />
              <div>{error}</div>
            </div>
          )}

          {handoffNote && (
            <p className="kx-muted kx-provenance" data-handoff-note>
              <Icon name="external" size={13} />
              {t("handoff.received")} {handoffNote}
            </p>
          )}

          {items.length === 0 ? (
            <EmptyState
              icon="layers"
              title={t("batch.emptyTitle")}
              hint={t("batch.emptyHint")}
              action={
                <div className="kx-row" style={{ gap: 8 }}>
                  <button
                    type="button"
                    className="kx-btn kx-btn-primary"
                    onClick={() => fileRef.current?.click()}
                  >
                    {t("batch.addFiles")}
                  </button>
                  <button
                    type="button"
                    className="kx-btn"
                    onClick={() => setPickerOpen(true)}
                    disabled={libraryItems.length === 0}
                  >
                    {t("batch.fromLibrary")}
                  </button>
                </div>
              }
            />
          ) : (
            <ul className="kx-batch-list">
              {items.map((item) => {
                const url = outputUrl(item);
                return (
                  <li key={item.id} className="kx-batch-row" data-batch-item={item.name} data-status={item.status}>
                    <span className="kx-batch-thumb">
                      {url ? <img src={url} alt="" /> : <Icon name="image" size={22} />}
                    </span>
                    <span className="kx-batch-meta">
                      <strong>{item.name}</strong>
                      <span className="kx-muted kx-mono" dir="ltr">
                        {formatBytes(item.inputBytes)}
                        {item.output
                          ? ` → ${item.output.mimeType} · ${formatBytes(item.output.bytes)} · ${item.output.width}×${item.output.height} · ${item.ms} ms`
                          : ""}
                        {item.error ? ` · ${item.error}` : ""}
                      </span>
                      <span className="kx-batch-bar" data-progress={Math.round(item.progress * 100)}>
                        <span style={{ width: `${Math.round(item.progress * 100)}%` }} />
                      </span>
                    </span>
                    <span className="kx-badge" data-state={badgeFor(item.status)}>
                      {t(`batch.status.${item.status}`)}
                    </span>
                    <button
                      type="button"
                      className="kx-btn kx-btn-sm"
                      aria-label={t("batch.remove")}
                      onClick={() => {
                        const stale = urlsRef.current.get(item.id);
                        if (stale) URL.revokeObjectURL(stale);
                        urlsRef.current.delete(item.id);
                        setItems((current) => current.filter((entry) => entry.id !== item.id));
                      }}
                      disabled={running}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="kx-card-sub">
            {t("batch.provenance")}{" "}
            <button
              type="button"
              className="kx-btn kx-btn-quiet kx-btn-sm"
              style={{ padding: 0, height: "auto" }}
              onClick={() => onNavigate("library")}
            >
              {t("batch.openLibrary")}
            </button>
          </p>
        </section>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        aria-label={t("batch.addFiles")}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []).map((file) => ({
            name: file.name,
            blob: file as Blob,
            mimeType: file.type,
          }));
          addFiles(files);
          event.target.value = "";
        }}
      />

      <MediaPicker
        open={pickerOpen}
        kind="image"
        onClose={() => setPickerOpen(false)}
        onPick={(item) => {
          onPicked([item]);
        }}
      />
    </div>
  );

  function numberField(
    labelKey: string,
    value: number,
    min: number,
    max: number,
    apply: (value: number) => Partial<BatchSettings>,
  ) {
    return (
      <label className="kx-field" key={labelKey}>
        <span className="kx-label">
          {t(labelKey)} <output className="kx-mono" dir="ltr">{value}</output>
        </span>
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          data-slider={labelKey}
          disabled={running}
          onChange={(event) =>
            setConfig((current) => ({ ...current, ...apply(Number(event.target.value)) }))
          }
        />
      </label>
    );
  }
}

function badgeFor(status: BatchItem["status"]) {
  switch (status) {
    case "done":
      return "VERIFIED" as const;
    case "failed":
      return "BLOCKED" as const;
    case "cancelled":
      return "NOT_IMPLEMENTED" as const;
    case "running":
      return "PARTIAL" as const;
    default:
      return "AVAILABLE_UNVERIFIED" as const;
  }
}
