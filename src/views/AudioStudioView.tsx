import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CAPABILITIES, type RouteId } from "../app/capabilities";
import { Icon } from "../app/icons";
import MediaPicker from "../ui/MediaPicker";
import { useLibrary } from "../state/LibraryContext";
import { useSettings } from "../state/SettingsContext";
import { useToast } from "../state/ToastContext";
import { translate } from "../i18n/translate";
import { downloadBlob, formatBytes, formatDuration } from "../lib/format";
import type { LibraryItem } from "../state/types";
import {
  analyseSilence,
  applySteps,
  createFilterRenderer,
  decodeAudioBlob,
  encodeWavBlob,
  encodeWebmBlob,
  frameCount,
  probeAudioEncoders,
  signalDuration,
  signalStats,
  splitSignal,
  waveformGeometry,
  type AudioSignal,
  type AudioStep,
  type FilterType,
  type SilenceInterval,
} from "../services/audioOps";
import { EmptyState, SectionHeader, StateBadge } from "./ui";

const MAX_SECONDS = 600;

type OperationGroup = "edit" | "level" | "tone" | "shape";

interface Operation {
  id: string;
  group: OperationGroup;
  labelKey: string;
  make: (context: { selection: [number, number]; playhead: number; duration: number }) => AudioStep | null;
}

const OPERATIONS: Operation[] = [
  {
    id: "trim",
    group: "edit",
    labelKey: "audio.op.trim",
    make: ({ selection }) =>
      selection[1] - selection[0] > 0.01
        ? { kind: "trim", start: selection[0], end: selection[1] }
        : null,
  },
  {
    id: "cut-silence",
    group: "edit",
    labelKey: "audio.op.cutSilence",
    make: () => ({ kind: "cut-silence", thresholdDb: -40, minSilenceMs: 250 }),
  },
  {
    id: "fade",
    group: "edit",
    labelKey: "audio.op.fade",
    make: () => ({ kind: "fade", inMs: 150, outMs: 150 }),
  },
  {
    id: "gain",
    group: "level",
    labelKey: "audio.op.gain",
    make: () => ({ kind: "gain", db: 3 }),
  },
  {
    id: "normalise",
    group: "level",
    labelKey: "audio.op.normalise",
    make: () => ({ kind: "normalise", targetDb: -1 }),
  },
  {
    id: "lowpass",
    group: "tone",
    labelKey: "audio.op.lowpass",
    make: () => ({ kind: "filter", type: "lowpass" as FilterType, frequency: 1200, q: 0.9, gainDb: 0 }),
  },
  {
    id: "highpass",
    group: "tone",
    labelKey: "audio.op.highpass",
    make: () => ({ kind: "filter", type: "highpass" as FilterType, frequency: 220, q: 0.7, gainDb: 0 }),
  },
  {
    id: "bandpass",
    group: "tone",
    labelKey: "audio.op.bandpass",
    make: () => ({ kind: "filter", type: "bandpass" as FilterType, frequency: 1000, q: 1.4, gainDb: 0 }),
  },
  {
    id: "reverse",
    group: "shape",
    labelKey: "audio.op.reverse",
    make: () => ({ kind: "reverse" }),
  },
  {
    id: "mono",
    group: "shape",
    labelKey: "audio.op.mono",
    make: () => ({ kind: "channels", layout: "mono" }),
  },
  {
    id: "stereo",
    group: "shape",
    labelKey: "audio.op.stereo",
    make: () => ({ kind: "channels", layout: "stereo" }),
  },
];

const GROUP_KEYS: Record<OperationGroup, string> = {
  edit: "audio.group.edit",
  level: "audio.group.level",
  tone: "audio.group.tone",
  shape: "audio.group.shape",
};

export default function AudioStudioView({
  onNavigate,
}: {
  onNavigate: (route: RouteId) => void;
}) {
  const capability = CAPABILITIES["audio-studio"];
  const { settings } = useSettings();
  const { add } = useLibrary();
  const { push } = useToast();
  const t = useCallback(
    (key: string) => translate(settings.language, key),
    [settings.language],
  );

  const fileRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const renderFilter = useMemo(() => createFilterRenderer(), []);

  const [fileName, setFileName] = useState<string | null>(null);
  const [source, setSource] = useState<AudioSignal | null>(null);
  const [steps, setSteps] = useState<AudioStep[]>([]);
  const [past, setPast] = useState<AudioStep[][]>([]);
  const [future, setFuture] = useState<AudioStep[][]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<AudioSignal | null>(null);
  const [rendering, setRendering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<OperationGroup>("edit");
  const [selection, setSelection] = useState<[number, number]>([0, 0]);
  const [dragging, setDragging] = useState<{ from: number; to: number } | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [segments, setSegments] = useState<AudioSignal[]>([]);
  const [silence, setSilence] = useState<{ intervals: SilenceInterval[]; ratio: number } | null>(null);
  const [output, setOutput] = useState<{ format: "wav" | "webm"; quality: number }>({
    format: "wav",
    quality: 128,
  });
  const [estimate, setEstimate] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sourceItem, setSourceItem] = useState<LibraryItem | null>(null);

  const encoders = useMemo(() => probeAudioEncoders(), []);
  const stats = useMemo(() => (result ? signalStats(result) : null), [result]);
  const sourceDuration = source ? signalDuration(source) : 0;

  /* ------------------------------------------------------------- load */
  const adopt = useCallback(
    async (blob: Blob, name: string, from?: LibraryItem) => {
      if (!blob.type.startsWith("audio/") && !/\.(wav|mp3|ogg|webm|m4a|flac)$/i.test(name)) {
        setError(t("audio.notAudio"));
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const signal = await decodeAudioBlob(blob);
        if (signalDuration(signal) > MAX_SECONDS) {
          throw new Error(`Only files up to ${MAX_SECONDS}s are handled here.`);
        }
        setSource(signal);
        setSourceItem(from ?? null);
        setFileName(name.replace(/\.[^.]+$/, "") || "audio");
        setSteps([]);
        setPast([]);
        setFuture([]);
        setSelected(null);
        setSegments([]);
        setSilence(null);
        setSelection([0, 0]);
        setPlayhead(0);
        setSaved(false);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? `${t("audio.decodeFailed")} ${cause.message}`
            : t("audio.decodeFailed"),
        );
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  const chooseFile = useCallback(
    (file: File | null) => {
      if (!file) return;
      void adopt(file, file.name);
    },
    [adopt],
  );

  /* ---------------------------------------------------------- render */
  useEffect(() => {
    if (!source) {
      setResult(null);
      return;
    }
    let cancelled = false;
    setRendering(true);
    const handle = window.setTimeout(() => {
      applySteps(source, steps, renderFilter)
        .then(({ signal }) => {
          if (!cancelled) setResult(signal);
        })
        .catch((cause: unknown) => {
          if (!cancelled) {
            setError(cause instanceof Error ? cause.message : "The render failed.");
          }
        })
        .finally(() => {
          if (!cancelled) setRendering(false);
        });
    }, 30);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [source, steps, renderFilter]);

  /* ------------------------------------------------------- waveform */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !result) return;
    const geometry = waveformGeometry(result, 1400);
    const width = canvas.width;
    const height = canvas.height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#07070c";
    context.fillRect(0, 0, width, height);
    // Drawn at true amplitude, not auto-fitted: a gain or normalise step has to
    // visibly change the picture, which an auto-scaled waveform cannot show.
    const scale = 1;
    const middle = height / 2;
    const bars = Math.floor(geometry.peaks.length / 2);
    const barWidth = width / Math.max(1, bars);
    context.fillStyle = "#ffde00";
    for (let index = 0; index < bars; index += 1) {
      const min = geometry.peaks[index * 2] * scale;
      const max = geometry.peaks[index * 2 + 1] * scale;
      const top = middle - max * middle;
      const bottom = middle - min * middle;
      context.fillRect(index * barWidth, top, Math.max(1, barWidth - 0.4), Math.max(1, bottom - top));
    }
    const duration = signalDuration(result) || 1;
    const [from, to] = [Math.min(...selection), Math.max(...selection)];
    if (to > from) {
      context.fillStyle = "rgba(255,222,0,0.16)";
      context.fillRect((from / duration) * width, 0, ((to - from) / duration) * width, height);
    }
    context.fillStyle = "#8b5cf6";
    context.fillRect((playhead / duration) * width - 1, 0, 2, height);
  }, [result, selection, playhead]);

  /* ------------------------------------------------------- playback */
  useEffect(() => {
    if (!result) {
      setPlaybackUrl(null);
      return;
    }
    const blob = encodeWavBlob(result);
    const url = URL.createObjectURL(blob);
    setPlaybackUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [result]);

  useEffect(() => {
    const element = audioRef.current;
    if (!element || !playbackUrl) return;
    element.src = playbackUrl;
    setPlaying(false);
  }, [playbackUrl]);

  /* ------------------------------------------------------ estimation */
  useEffect(() => {
    if (!result) {
      setEstimate(null);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      try {
        setEstimate(encodeWavBlob(result).size);
      } catch {
        if (!cancelled) setEstimate(null);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [result]);

  /* --------------------------------------------------------- commits */
  const commit = useCallback(
    (next: AudioStep[], select: number | null = next.length - 1) => {
      setPast((entries) => [...entries.slice(-24), steps]);
      setFuture([]);
      setSteps(next);
      setSelected(select);
      setSaved(false);
      setError(null);
    },
    [steps],
  );

  const addOperation = useCallback(
    (operation: Operation) => {
      if (!result) return;
      const step = operation.make({
        selection,
        playhead,
        duration: signalDuration(result),
      });
      if (!step) {
        setError(t("audio.needSelection"));
        return;
      }
      commit([...steps, step]);
    },
    [commit, playhead, result, selection, steps, t],
  );

  const updateSelected = useCallback(
    (patch: Record<string, number | string>) => {
      if (selected === null || !steps[selected]) return;
      const next = [...steps];
      next[selected] = { ...(next[selected] as object), ...patch } as AudioStep;
      setSteps(next);
      setSaved(false);
    },
    [selected, steps],
  );

  const undo = useCallback(() => {
    if (!past.length) return;
    setFuture((entries) => [steps, ...entries]);
    setSteps(past[past.length - 1]);
    setPast((entries) => entries.slice(0, -1));
    setSelected(null);
  }, [past, steps]);

  const redo = useCallback(() => {
    if (!future.length) return;
    setPast((entries) => [...entries, steps]);
    setSteps(future[0]);
    setFuture((entries) => entries.slice(1));
    setSelected(null);
  }, [future, steps]);

  /* -------------------------------------------------------- analysis */
  const runSilenceScan = useCallback(() => {
    if (!result) return;
    const report = analyseSilence(result, { thresholdDb: -40, minSilenceMs: 250 });
    setSilence({ intervals: report.intervals, ratio: report.silenceRatio });
  }, [result]);

  const splitAtPlayhead = useCallback(() => {
    if (!result) return;
    const marks = [
      ...segments.map((segment) => signalDuration(segment)).reduce<number[]>((acc, seconds) => {
        acc.push((acc[acc.length - 1] ?? 0) + seconds);
        return acc;
      }, []),
      playhead,
    ].filter((point) => point > 0.01 && point < signalDuration(result) - 0.01);
    const parts = splitSignal(result, Array.from(new Set(marks)));
    setSegments(parts);
    push(
      "info",
      t("audio.splitTitle"),
      parts.map((part) => `${signalDuration(part).toFixed(2)}s`).join(" + "),
    );
  }, [playhead, push, result, segments, t]);

  /* ---------------------------------------------------------- export */
  const encodeOutput = useCallback(async (): Promise<{ blob: Blob; mime: string; ext: string }> => {
    if (!result) throw new Error("Nothing to export yet.");
    if (output.format === "wav") {
      return { blob: encodeWavBlob(result), mime: "audio/wav", ext: "wav" };
    }
    if (!encoders.webm || !encoders.webmMime) {
      throw new Error("This runtime cannot encode WebM audio. Use WAV.");
    }
    const blob = await encodeWebmBlob(result, { mime: encoders.webmMime, maxSeconds: 30 });
    return { blob, mime: encoders.webmMime, ext: "webm" };
  }, [encoders, output.format, result]);

  const saveToLibrary = useCallback(async () => {
    if (!result) return;
    setBusy(true);
    try {
      const { blob, mime, ext } = await encodeOutput();
      const name = `${fileName ?? "audio"}-studio.${ext}`;
      const probe = new Audio();
      const url = URL.createObjectURL(blob);
      let duration = signalDuration(result);
      try {
        duration = await new Promise<number>((resolve, reject) => {
          probe.onloadedmetadata = () => resolve(probe.duration);
          probe.onerror = () => reject(new Error("The encoded audio cannot be played back."));
          probe.src = url;
        });
      } finally {
        URL.revokeObjectURL(url);
      }
      await add({
        name,
        kind: "audio",
        mimeType: mime,
        blob,
        duration: Number.isFinite(duration) ? duration : 0,
        width: 0,
        height: 0,
        source: "toolbox",
        thumbnail: null,
      });
      setSaved(true);
      push(
        "success",
        t("audio.savedTitle"),
        `${name} · ${formatBytes(blob.size)} · ${formatDuration(duration)} · ${result.sampleRate} Hz`,
      );
    } catch (cause) {
      push("error", t("audio.saveFailed"), cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [add, encodeOutput, fileName, push, result, t]);

  const exportFile = useCallback(async () => {
    if (!result) return;
    setBusy(true);
    try {
      const { blob, ext } = await encodeOutput();
      downloadBlob(blob, `${fileName ?? "audio"}-studio.${ext}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The export failed.");
    } finally {
      setBusy(false);
    }
  }, [encodeOutput, fileName, result]);

  /* -------------------------------------------------------- selection */
  const pointToSeconds = useCallback(
    (clientX: number) => {
      const canvas = canvasRef.current;
      if (!canvas || !result) return 0;
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
      return ratio * signalDuration(result);
    },
    [result],
  );

  const selectedStep = selected !== null ? steps[selected] ?? null : null;
  const inspector = useMemo(() => {
    if (!selectedStep) return null;
    switch (selectedStep.kind) {
      case "trim":
        return (
          <>
            {range("audio.field.start", selectedStep.start, 0, Number(sourceDuration.toFixed(2)), 0.01, (value) =>
              updateSelected({ start: Math.min(value, selectedStep.end - 0.01) }),
            )}
            {range("audio.field.end", selectedStep.end, 0, Number(sourceDuration.toFixed(2)), 0.01, (value) =>
              updateSelected({ end: Math.max(value, selectedStep.start + 0.01) }),
            )}
          </>
        );
      case "gain":
        return range("audio.field.db", selectedStep.db, -24, 24, 0.5, (value) => updateSelected({ db: value }));
      case "normalise":
        return range("audio.field.target", selectedStep.targetDb, -24, 0, 0.5, (value) =>
          updateSelected({ targetDb: value }),
        );
      case "fade":
        return (
          <>
            {range("audio.field.fadeIn", selectedStep.inMs, 0, 5000, 10, (value) => updateSelected({ inMs: value }))}
            {range("audio.field.fadeOut", selectedStep.outMs, 0, 5000, 10, (value) => updateSelected({ outMs: value }))}
          </>
        );
      case "cut-silence":
        return (
          <>
            {range("audio.field.threshold", selectedStep.thresholdDb, -80, -10, 1, (value) =>
              updateSelected({ thresholdDb: value }),
            )}
            {range("audio.field.minSilence", selectedStep.minSilenceMs, 50, 3000, 10, (value) =>
              updateSelected({ minSilenceMs: value }),
            )}
          </>
        );
      case "filter":
        return (
          <>
            {range("audio.field.frequency", selectedStep.frequency, 20, 16000, 10, (value) =>
              updateSelected({ frequency: value }),
            )}
            {range("audio.field.q", selectedStep.q, 0.1, 12, 0.1, (value) => updateSelected({ q: value }))}
            <p className="kx-card-sub">{t("audio.filterHint")}</p>
          </>
        );
      case "channels":
        return (
          <div className="kx-row" style={{ gap: 6 }}>
            <button
              type="button"
              className="kx-btn kx-btn-sm"
              onClick={() => updateSelected({ layout: selectedStep.layout === "mono" ? "stereo" : "mono" })}
            >
              {t("audio.swapLayout")}
            </button>
          </div>
        );
      default:
        return null;
    }

    function range(
      labelKey: string,
      value: number,
      min: number,
      max: number,
      stepValue: number,
      onChange: (value: number) => void,
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
            step={stepValue}
            value={value}
            data-slider={labelKey}
            onChange={(event) => onChange(Number(event.target.value))}
          />
        </label>
      );
    }
  }, [selectedStep, sourceDuration, t, updateSelected]);

  const operations = OPERATIONS.filter((operation) => operation.group === group);

  return (
    <div className="kx-content kx-audio">
      <SectionHeader
        eyebrow={t("groupCreate")}
        title={t("audio.title")}
        description={t("audio.description")}
        actions={
          <div className="kx-row" style={{ gap: 8 }}>
            <StateBadge state={capability.state} />
            <button type="button" className="kx-btn kx-btn-sm" onClick={() => setPickerOpen(true)}>
              <Icon name="folder" size={14} />
              {t("audio.fromLibrary")}
            </button>
            <button
              type="button"
              className="kx-btn kx-btn-primary kx-btn-sm"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              <Icon name="upload" size={14} />
              {source ? t("audio.replace") : t("audio.open")}
            </button>
          </div>
        }
      />

      <div className="kx-notice" data-tone="info">
        <Icon name="cpu" size={18} />
        <div>
          <strong>{t("audio.honestTitle")}</strong> {t("audio.honestBody")}{" "}
          <span dir="ltr">
            WAV {encoders.wav ? "✓" : "✕"} · WebM/Opus {encoders.webm ? "✓" : "✕"} · MP3 ✕ · AAC ✕
          </span>
        </div>
      </div>

      {!source ? (
        <div className="kx-card kx-audio-hero">
          <EmptyState
            icon="audio"
            title={t("audio.emptyTitle")}
            hint={t("audio.emptyHint")}
            action={
              <div className="kx-row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="kx-btn kx-btn-primary"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                >
                  {t("audio.open")}
                </button>
                <button type="button" className="kx-btn" onClick={() => setPickerOpen(true)}>
                  {t("audio.fromLibrary")}
                </button>
              </div>
            }
          />
          {error && (
            <div className="kx-notice" data-tone="danger">
              <Icon name="alert" size={16} />
              <div>{error}</div>
            </div>
          )}
        </div>
      ) : (
        <div className="kx-audio-grid">
          {/* operations */}
          <aside className="kx-card kx-audio-ops" aria-label={t("audio.operations")}>
            <div className="kx-segmented kx-audio-groups" role="group" aria-label={t("audio.groups")}>
              {(Object.keys(GROUP_KEYS) as OperationGroup[]).map((entry) => (
                <button
                  key={entry}
                  type="button"
                  data-group={entry}
                  aria-pressed={group === entry}
                  onClick={() => setGroup(entry)}
                >
                  {t(GROUP_KEYS[entry])}
                </button>
              ))}
            </div>
            <div className="kx-audio-oplist">
              {operations.map((operation) => (
                <button
                  key={operation.id}
                  type="button"
                  className="kx-btn kx-audio-op"
                  data-operation-id={operation.id}
                  onClick={() => addOperation(operation)}
                  disabled={!result || rendering}
                >
                  {t(operation.labelKey)}
                </button>
              ))}
            </div>
            <div className="kx-divider" />
            <button type="button" className="kx-btn kx-btn-sm" data-action="scan" onClick={runSilenceScan} disabled={!result}>
              <Icon name="search" size={14} />
              {t("audio.scanSilence")}
            </button>
            {silence && (
              <div className="kx-audio-silence" data-silence-report>
                <p className="kx-muted" style={{ margin: "6px 0", fontSize: "0.72rem" }} dir="ltr">
                  {silence.intervals.length} intervals · {(silence.ratio * 100).toFixed(1)}%
                </p>
                <ul>
                  {silence.intervals.slice(0, 12).map((interval, index) => (
                    <li key={`${interval.start}-${index}`} data-silence-interval>
                      <span dir="ltr">
                        {interval.start.toFixed(2)}s → {interval.end.toFixed(2)}s
                      </span>
                      <button
                        type="button"
                        className="kx-btn kx-btn-sm kx-btn-quiet"
                        onClick={() => {
                          setSelection([interval.start, interval.end]);
                          setPlayhead(interval.start);
                        }}
                      >
                        {t("audio.select")}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>

          {/* stage */}
          <section className="kx-card kx-audio-stage-card">
            <div className="kx-row-between" style={{ marginBottom: 8, gap: 10, flexWrap: "wrap" }}>
              <span className="kx-mono kx-muted" dir="ltr">
                {result
                  ? `${result.channels.length}ch · ${result.sampleRate} Hz · ${signalDuration(result).toFixed(2)}s`
                  : "—"}
                {fileName ? ` · ${fileName}` : ""}
                {sourceItem ? ` · ${t("audio.fromLibraryTag")}` : ""}
              </span>
              <span className="kx-row" style={{ gap: 6 }}>
                {steps.length > 0 && (
                  <span className="kx-badge" data-state="PARTIAL" dir="ltr">
                    {steps.length} {t("audio.steps")}
                  </span>
                )}
                {rendering && (
                  <span className="kx-badge" data-state="AVAILABLE_UNVERIFIED">
                    {t("audio.rendering")}
                  </span>
                )}
              </span>
            </div>

            <div className="kx-audio-wave">
              <canvas
                ref={canvasRef}
                width={1400}
                height={220}
                className="kx-audio-canvas"
                onPointerDown={(event) => {
                  const seconds = pointToSeconds(event.clientX);
                  setDragging({ from: seconds, to: seconds });
                  setPlayhead(seconds);
                }}
                onPointerMove={(event) => {
                  if (!dragging) return;
                  setDragging((current) =>
                    current ? { ...current, to: pointToSeconds(event.clientX) } : current,
                  );
                }}
                onPointerUp={() => {
                  if (!dragging) return;
                  const from = Math.min(dragging.from, dragging.to);
                  const to = Math.max(dragging.from, dragging.to);
                  setSelection([from, to]);
                  setDragging(null);
                }}
                onPointerLeave={() => setDragging(null)}
              />
              {rendering && (
                <span className="kx-audio-rendering" role="status">
                  {t("audio.rendering")}
                </span>
              )}
            </div>

            <div className="kx-row kx-audio-transport">
              <button
                type="button"
                className="kx-btn kx-btn-sm"
                data-action="play"
                onClick={() => {
                  const element = audioRef.current;
                  if (!element) return;
                  if (element.paused) {
                    void element.play().then(() => setPlaying(true)).catch(() => setError(t("audio.playBlocked")));
                  } else {
                    element.pause();
                    setPlaying(false);
                  }
                }}
                disabled={!playbackUrl}
              >
                <Icon name={playing ? "pause" : "play"} size={14} />
                {playing ? t("audio.pause") : t("audio.play")}
              </button>
              <button
                type="button"
                className="kx-btn kx-btn-sm"
                data-action="stop"
                onClick={() => {
                  const element = audioRef.current;
                  if (!element) return;
                  element.pause();
                  element.currentTime = 0;
                  setPlayhead(0);
                  setPlaying(false);
                }}
              >
                <Icon name="stop" size={14} />
                {t("audio.stop")}
              </button>
              <span className="kx-mono kx-muted" dir="ltr" data-playhead>
                {playhead.toFixed(2)} / {(result ? signalDuration(result) : 0).toFixed(2)}s
              </span>
              <span className="kx-muted" style={{ fontSize: "0.72rem" }} data-selection dir="ltr">
                {selection[1] > selection[0]
                  ? `${t("audio.selection")} ${selection[0].toFixed(2)}s → ${selection[1].toFixed(2)}s`
                  : t("audio.noSelection")}
              </span>
              <button type="button" className="kx-btn kx-btn-sm" data-action="split" onClick={splitAtPlayhead} disabled={!result}>
                {t("audio.split")}
              </button>
            </div>

            {playbackUrl && (
              <audio
                ref={audioRef}
                controls
                className="kx-audio-element"
                onTimeUpdate={(event) => setPlayhead(event.currentTarget.currentTime)}
                onEnded={() => setPlaying(false)}
              />
            )}

            {segments.length > 0 && (
              <div className="kx-audio-segments" data-segments>
                {segments.map((segment, index) => (
                  <div className="kx-audio-segment" key={`${index}-${signalDuration(segment)}`}>
                    <strong>{index + 1}</strong>
                    <span dir="ltr">{signalDuration(segment).toFixed(2)}s</span>
                    <span className="kx-muted kx-mono" dir="ltr">
                      {formatBytes(encodeWavBlob(segment).size)}
                    </span>
                    <button
                      type="button"
                      className="kx-btn kx-btn-sm"
                      onClick={() => {
                        const blob = encodeWavBlob(segment);
                        downloadBlob(blob, `${fileName ?? "audio"}-part-${index + 1}.wav`);
                      }}
                    >
                      {t("audio.exportSegment")}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="kx-audio-actions">
              <button type="button" className="kx-btn" onClick={undo} disabled={!past.length}>
                <Icon name="undo" size={14} />
                {t("audio.undo")}
              </button>
              <button type="button" className="kx-btn" onClick={redo} disabled={!future.length}>
                <Icon name="redo" size={14} />
                {t("audio.redo")}
              </button>
              <button type="button" className="kx-btn" onClick={() => commit([], null)} disabled={!steps.length}>
                {t("audio.clear")}
              </button>
              <button
                type="button"
                className="kx-btn"
                onClick={() => {
                  setSource(null);
                  setSteps([]);
                  setSegments([]);
                  setSilence(null);
                  setSourceItem(null);
                }}
              >
                {t("audio.close")}
              </button>
            </div>

            {error && (
              <div className="kx-notice" data-tone="danger" style={{ marginTop: 10 }}>
                <Icon name="alert" size={16} />
                <div>{error}</div>
              </div>
            )}
          </section>

          {/* inspector + output */}
          <aside className="kx-card kx-audio-inspector" aria-label={t("audio.inspector")}>
            <h3 className="kx-subtitle">{t("audio.steps")}</h3>
            {steps.length === 0 ? (
              <p className="kx-card-sub">{t("audio.noSteps")}</p>
            ) : (
              <ul className="kx-audio-steps">
                {steps.map((step, index) => (
                  <li key={`${step.kind}-${index}`}>
                    <button
                      type="button"
                      className="kx-audio-step"
                      data-step-index={index}
                      aria-pressed={selected === index}
                      onClick={() => setSelected(index)}
                    >
                      <span className="kx-audio-step-no">{index + 1}</span>
                      <span>{t(`audio.kind.${step.kind}`)}</span>
                    </button>
                    <button
                      type="button"
                      className="kx-btn kx-btn-sm"
                      aria-label={t("audio.removeStep")}
                      onClick={() => commit(steps.filter((_, at) => at !== index), null)}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="kx-divider" />
            <h3 className="kx-subtitle">{t("audio.parameters")}</h3>
            {inspector ?? <p className="kx-card-sub">{t("audio.selectStep")}</p>}

            <div className="kx-divider" />
            <h3 className="kx-subtitle">{t("audio.output")}</h3>
            <div className="kx-segmented" dir="ltr" role="group" aria-label={t("audio.format")}>
              <button
                type="button"
                aria-pressed={output.format === "wav"}
                onClick={() => setOutput((current) => ({ ...current, format: "wav" }))}
              >
                WAV
              </button>
              <button
                type="button"
                data-format="webm"
                aria-pressed={output.format === "webm"}
                disabled={!encoders.webm}
                title={encoders.webm ? t("audio.webmOk") : t("audio.webmUnsupported")}
                onClick={() => setOutput((current) => ({ ...current, format: "webm" }))}
              >
                WebM
              </button>
            </div>
            {stats && (
              <dl className="kx-audio-stats" dir="ltr">
                <div>
                  <dt>{t("audio.duration")}</dt>
                  <dd>{stats.duration.toFixed(2)}s</dd>
                </div>
                <div>
                  <dt>{t("audio.sampleRate")}</dt>
                  <dd>{stats.sampleRate} Hz</dd>
                </div>
                <div>
                  <dt>{t("audio.channels")}</dt>
                  <dd>{stats.channels}</dd>
                </div>
                <div>
                  <dt>{t("audio.peak")}</dt>
                  <dd>{stats.peakDb.toFixed(1)} dBFS</dd>
                </div>
                <div>
                  <dt>{t("audio.loudness")}</dt>
                  <dd>{stats.rmsDb.toFixed(1)} dBFS</dd>
                </div>
                <div>
                  <dt>{t("audio.frames")}</dt>
                  <dd>{result ? frameCount(result) : 0}</dd>
                </div>
              </dl>
            )}
            <p className="kx-muted" style={{ fontSize: "0.72rem" }} dir="ltr" data-estimate>
              {estimate !== null ? `${formatBytes(estimate)} · WAV` : t("audio.measuring")}
            </p>
            <div className="kx-row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="kx-btn kx-btn-primary"
                data-action="save"
                onClick={() => void saveToLibrary()}
                disabled={busy || !result}
              >
                <Icon name="download" size={15} />
                {saved ? t("audio.saved") : t("audio.save")}
              </button>
              <button
                type="button"
                className="kx-btn"
                data-action="export"
                onClick={() => void exportFile()}
                disabled={busy || !result}
              >
                <Icon name="export" size={15} />
                {t("audio.export")}
              </button>
            </div>
            {sourceItem && (
              <p className="kx-card-sub" data-provenance>
                {t("audio.provenance")}{" "}
                <button
                  type="button"
                  className="kx-btn kx-btn-quiet kx-btn-sm"
                  style={{ padding: 0, height: "auto" }}
                  onClick={() => onNavigate("library")}
                >
                  {sourceItem.name}
                </button>
              </p>
            )}
          </aside>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="audio/*,.wav,.mp3,.ogg,.webm,.m4a,.flac"
        hidden
        aria-label={t("audio.open")}
        onChange={(event) => {
          chooseFile(event.target.files?.[0] ?? null);
          event.target.value = "";
        }}
      />

      <MediaPicker
        open={pickerOpen}
        kind="audio"
        onClose={() => setPickerOpen(false)}
        onPick={(item) => {
          setPickerOpen(false);
          void adopt(item.blob, item.name, item);
        }}
      />
    </div>
  );
}
