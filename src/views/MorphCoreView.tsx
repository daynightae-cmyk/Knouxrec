import { useCallback, useEffect, useRef, useState } from "react";
import { CAPABILITIES } from "../app/capabilities";
import { Icon } from "../app/icons";
import { useLibrary } from "../state/LibraryContext";
import { useSettings } from "../state/SettingsContext";
import { useToast } from "../state/ToastContext";
import { translate } from "../i18n/translate";
import { downloadBlob, formatBytes } from "../lib/format";
import { EmptyState, SectionHeader, StateBadge } from "./ui";

type GeometryMode = "stretch" | "rotate" | "pinch" | "perspective" | "warp";

const MAX_EDGE = 1600;
const MAX_HISTORY = 6;
const AGE_GATE_KEY = "knoux-geometry.age-gate.v1";

const DEFAULTS = {
  stretchX: 100,
  stretchY: 100,
  angle: 0,
  flipH: false,
  flipV: false,
  pinch: 0,
  pinchRadius: 60,
  pinchX: 50,
  pinchY: 50,
  perspTop: 100,
  perspBottom: 100,
  warpAmplitude: 0,
  warpFrequency: 3,
};

type GeometryParams = typeof DEFAULTS;

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("The PNG encoder produced no bytes.")),
      "image/png",
    );
  });
}

async function decodePng(blob: Blob): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("The exported PNG cannot be decoded."));
      element.src = url;
    });
    return { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * MorphCore geometry studio.
 *
 * Real local pixel resampling: independent stretch, free rotation with flips,
 * radial pinch/bulge, trapezoid perspective and a sine warp. This is manual
 * geometric image editing; the legacy body-aware catalog stays visibly blocked
 * because its engines and weights are absent.
 */
export default function MorphCoreView() {
  const capability = CAPABILITIES.morphcore;
  const { settings } = useSettings();
  const { add } = useLibrary();
  const { push } = useToast();
  const t = useCallback(
    (key: string) => translate(settings.language, key),
    [settings.language],
  );

  const fileRef = useRef<HTMLInputElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const originalRef = useRef<HTMLCanvasElement | null>(null);
  const historyRef = useRef<{ entries: Blob[]; index: number }>({ entries: [], index: -1 });
  const rafRef = useRef<number | null>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<GeometryMode>("stretch");
  const [params, setParams] = useState<GeometryParams>(DEFAULTS);
  const [compare, setCompare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyTick, setHistoryTick] = useState(0);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [legacy, setLegacy] = useState<
    Array<{ id: string; name: string; nameEn: string; tools: number }>
  >([]);
  const [saved, setSaved] = useState(false);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);

  // The blocked body-aware catalog lives in this section, so the 18+ safeguard
  // that guarded the legacy route is preserved here. The declaration is
  // self-declared and deliberately scoped to the browser session — nothing is
  // written permanently and nothing leaves the device.
  const [ageVerified, setAgeVerified] = useState(() => {
    try {
      return sessionStorage.getItem(AGE_GATE_KEY) === "verified";
    } catch {
      return false;
    }
  });
  const [birthYear, setBirthYear] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [ageDenied, setAgeDenied] = useState(false);

  const currentYear = new Date().getFullYear();

  const confirmAge = useCallback(() => {
    const declared = new Date().getFullYear();
    const year = Number.parseInt(birthYear, 10);
    const adult =
      Number.isFinite(year) && year >= 1900 && year <= declared && declared - year >= 18;
    if (!adult || !ageConfirmed) {
      setAgeDenied(true);
      return;
    }
    try {
      sessionStorage.setItem(AGE_GATE_KEY, "verified");
    } catch {
      // Storage can be unavailable; the in-memory decision still applies.
    }
    setAgeDenied(false);
    setAgeVerified(true);
  }, [ageConfirmed, birthYear]);

  const canUndo = historyRef.current.index > 0;
  const canRedo =
    historyRef.current.index >= 0 &&
    historyRef.current.index < historyRef.current.entries.length - 1;

  // Legacy body-aware catalog, kept separate and clearly blocked.
  useEffect(() => {
    let cancelled = false;
    void import("../../services/knouxMorphCore")
      .then((module) => {
        if (cancelled) return;
        const categories = module.knouxMorphCore.getCategories();
        setLegacy(
          categories.map((category) => ({
            id: category.id,
            name: category.name,
            nameEn: category.nameEn || category.name,
            tools: category.tools.length,
          })),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const renderPreview = useCallback(
    (source: HTMLCanvasElement | null = baseRef.current) => {
      const base = source;
      const preview = previewRef.current;
      if (!base || !preview) return;
      const context = preview.getContext("2d");
      if (!context) return;
      const width = base.width;
      const height = base.height;
      context.save();
      context.clearRect(0, 0, preview.width, preview.height);

      if (mode === "stretch") {
        const sx = Math.max(0.2, params.stretchX / 100);
        const sy = Math.max(0.2, params.stretchY / 100);
        const outWidth = Math.max(2, Math.round(width * sx));
        const outHeight = Math.max(2, Math.round(height * sy));
        preview.width = outWidth;
        preview.height = outHeight;
        setDimensions({ width: outWidth, height: outHeight });
        context.imageSmoothingQuality = "high";
        context.drawImage(base, 0, 0, outWidth, outHeight);
      } else if (mode === "rotate") {
        const radians = (params.angle * Math.PI) / 180;
        const cos = Math.abs(Math.cos(radians));
        const sin = Math.abs(Math.sin(radians));
        const outWidth = Math.max(2, Math.round(width * cos + height * sin));
        const outHeight = Math.max(2, Math.round(width * sin + height * cos));
        preview.width = outWidth;
        preview.height = outHeight;
        setDimensions({ width: outWidth, height: outHeight });
        context.translate(outWidth / 2, outHeight / 2);
        context.rotate(radians);
        context.scale(params.flipH ? -1 : 1, params.flipV ? -1 : 1);
        context.imageSmoothingQuality = "high";
        context.drawImage(base, -width / 2, -height / 2);
      } else if (mode === "pinch") {
        preview.width = width;
        preview.height = height;
        setDimensions({ width, height });
        const source = base.getContext("2d", { willReadFrequently: true });
        if (!source) return;
        const image = source.getImageData(0, 0, width, height);
        const out = context.createImageData(width, height);
        out.data.set(image.data);
        const cx = (params.pinchX / 100) * width;
        const cy = (params.pinchY / 100) * height;
        const radius = Math.max(8, (params.pinchRadius / 100) * Math.min(width, height));
        const strength = params.pinch / 100;
        if (strength !== 0) {
          const radiusSq = radius * radius;
          const minX = Math.max(0, Math.floor(cx - radius));
          const maxX = Math.min(width, Math.ceil(cx + radius));
          const minY = Math.max(0, Math.floor(cy - radius));
          const maxY = Math.min(height, Math.ceil(cy + radius));
          for (let y = minY; y < maxY; y += 1) {
            for (let x = minX; x < maxX; x += 1) {
              const dx = x - cx;
              const dy = y - cy;
              const distanceSq = dx * dx + dy * dy;
              if (distanceSq > radiusSq) continue;
              const tNorm = Math.sqrt(distanceSq) / radius;
              const factor = 1 + strength * (1 - tNorm) * (1 - tNorm);
              const sx = Math.max(0, Math.min(width - 1, Math.round(cx + dx / factor)));
              const sy = Math.max(0, Math.min(height - 1, Math.round(cy + dy / factor)));
              const from = (sy * width + sx) * 4;
              const to = (y * width + x) * 4;
              out.data[to] = image.data[from];
              out.data[to + 1] = image.data[from + 1];
              out.data[to + 2] = image.data[from + 2];
              out.data[to + 3] = image.data[from + 3];
            }
          }
        }
        context.putImageData(out, 0, 0);
      } else if (mode === "perspective") {
        preview.width = width;
        preview.height = height;
        setDimensions({ width, height });
        const strips = Math.max(24, Math.min(120, Math.round(height / 8)));
        for (let strip = 0; strip < strips; strip += 1) {
          const sy = Math.floor((strip * height) / strips);
          const sh = Math.ceil(height / strips) + 1;
          const ratio = strip / Math.max(1, strips - 1);
          const top = params.perspTop / 100;
          const bottom = params.perspBottom / 100;
          const scale = top + (bottom - top) * ratio;
          const inset = (width - width * scale) / 2;
          context.drawImage(
            base,
            0,
            sy,
            width,
            sh,
            inset,
            sy,
            width * scale,
            sh,
          );
        }
      } else {
        preview.width = width;
        preview.height = height;
        setDimensions({ width, height });
        const amplitude = (params.warpAmplitude / 100) * (width * 0.2);
        const rows = Math.max(30, Math.min(200, Math.round(height / 6)));
        for (let row = 0; row < rows; row += 1) {
          const sy = Math.floor((row * height) / rows);
          const sh = Math.ceil(height / rows) + 1;
          const phase = (2 * Math.PI * params.warpFrequency * sy) / height;
          const offset = Math.sin(phase) * amplitude;
          context.drawImage(base, 0, sy, width, sh, offset, sy, width, sh);
        }
      }
      context.restore();
    },
    [mode, params],
  );

  // Live preview with RAF coalescing.
  useEffect(() => {
    if (!ready) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => renderPreview());
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [ready, renderPreview]);

  const pushHistory = useCallback(async (canvas: HTMLCanvasElement) => {
    const snapshot = await canvasToPng(canvas);
    const history = historyRef.current;
    const entries = history.entries.slice(0, history.index + 1);
    entries.push(snapshot);
    while (entries.length > MAX_HISTORY) entries.shift();
    historyRef.current = { entries, index: entries.length - 1 };
    setHistoryTick((value) => value + 1);
  }, []);

  const apply = useCallback(async () => {
    const preview = previewRef.current;
    const base = baseRef.current;
    if (!preview || !base) return;
    setBusy(true);
    try {
      const baked = document.createElement("canvas");
      baked.width = preview.width;
      baked.height = preview.height;
      const context = baked.getContext("2d");
      if (!context) throw new Error("The 2D canvas context is unavailable.");
      context.drawImage(preview, 0, 0);
      baseRef.current = baked;
      // Paint the baked result directly. Re-rendering through renderPreview()
      // here would use the closure captured before the state update and draw the
      // transform a second time — a flipped rotate baked twice mirrors the image
      // back, so the canvas would disagree with the history snapshot.
      preview.width = baked.width;
      preview.height = baked.height;
      const surface = preview.getContext("2d");
      if (!surface) throw new Error("The 2D canvas context is unavailable.");
      surface.clearRect(0, 0, preview.width, preview.height);
      surface.drawImage(baked, 0, 0);
      setDimensions({ width: baked.width, height: baked.height });
      // Every parameter is now part of the image, including the flips.
      setParams({ ...DEFAULTS });
      await pushHistory(baked);
      setSaved(false);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The transform could not be applied.");
    } finally {
      setBusy(false);
    }
  }, [pushHistory]);

  const restore = useCallback(
    async (index: number) => {
      const entry = historyRef.current.entries[index];
      const base = baseRef.current;
      const preview = previewRef.current;
      if (!entry || !base || !preview) return;
      setBusy(true);
      try {
        const url = URL.createObjectURL(entry);
        try {
          const image = await new Promise<HTMLImageElement>((resolve, reject) => {
            const element = new Image();
            element.onload = () => resolve(element);
            element.onerror = () => reject(new Error("The snapshot cannot be decoded."));
            element.src = url;
          });
          const restored = document.createElement("canvas");
          restored.width = image.naturalWidth || image.width;
          restored.height = image.naturalHeight || image.height;
          const context = restored.getContext("2d");
          if (!context) throw new Error("The 2D canvas context is unavailable.");
          context.drawImage(image, 0, 0);
          baseRef.current = restored;
          historyRef.current = { ...historyRef.current, index };
          setHistoryTick((value) => value + 1);
          setParams({ ...DEFAULTS });
          // Show the snapshot itself, not the active transform on top of it.
          preview.width = restored.width;
          preview.height = restored.height;
          const surface = preview.getContext("2d");
          if (surface) {
            surface.clearRect(0, 0, preview.width, preview.height);
            surface.drawImage(restored, 0, 0);
          }
          setDimensions({ width: restored.width, height: restored.height });
          setSaved(false);
        } finally {
          URL.revokeObjectURL(url);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The snapshot could not be restored.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const resetAll = useCallback(async () => {
    const original = originalRef.current;
    const preview = previewRef.current;
    if (!original || !preview) return;
    const copy = document.createElement("canvas");
    copy.width = original.width;
    copy.height = original.height;
    copy.getContext("2d")?.drawImage(original, 0, 0);
    baseRef.current = copy;
    preview.width = copy.width;
    preview.height = copy.height;
    const surface = preview.getContext("2d");
    if (surface) {
      surface.clearRect(0, 0, preview.width, preview.height);
      surface.drawImage(copy, 0, 0);
    }
    setDimensions({ width: copy.width, height: copy.height });
    setParams({ ...DEFAULTS });
    await pushHistory(copy);
    setSaved(false);
  }, [pushHistory]);

  const chooseFile = useCallback(
    (file: File | null) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setError(t("geo.notImage"));
        return;
      }
      setBusy(true);
      setError(null);
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = async () => {
        try {
          const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
          const width = Math.max(2, Math.round(image.naturalWidth * scale));
          const height = Math.max(2, Math.round(image.naturalHeight * scale));
          const base = document.createElement("canvas");
          base.width = width;
          base.height = height;
          const context = base.getContext("2d");
          if (!context) throw new Error("The 2D canvas context is unavailable.");
          context.drawImage(image, 0, 0, width, height);
          const original = document.createElement("canvas");
          original.width = width;
          original.height = height;
          original.getContext("2d")?.drawImage(base, 0, 0);
          originalRef.current = original;
          setOriginalUrl(original.toDataURL("image/png"));
          baseRef.current = base;
          const preview = previewRef.current;
          if (preview) {
            preview.width = width;
            preview.height = height;
            renderPreview(base);
          }
          setDimensions({ width, height });
          setFileName(file.name);
          setParams(DEFAULTS);
          setReady(true);
          setSaved(false);
          historyRef.current = { entries: [], index: -1 };
          await pushHistory(base);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "The image could not be opened.");
        } finally {
          URL.revokeObjectURL(url);
          setBusy(false);
        }
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        setBusy(false);
        setError(t("geo.notImage"));
      };
      image.src = url;
    },
    [pushHistory, renderPreview, t],
  );

  const saveToLibrary = useCallback(async () => {
    const preview = previewRef.current;
    if (!preview) return;
    setBusy(true);
    try {
      const blob = await canvasToPng(preview);
      const size = await decodePng(blob);
      const base = (fileName ?? "geometry").replace(/\.[^.]+$/, "") || "geometry";
      const name = `${base}-geometry.png`;
      await add({
        name,
        kind: "image",
        mimeType: "image/png",
        blob,
        duration: 0,
        width: size.width,
        height: size.height,
        source: "toolbox",
        thumbnail: null,
      });
      setSaved(true);
      push("success", t("geo.savedTitle"), `${name} · ${size.width}×${size.height} · ${formatBytes(blob.size)}`);
    } catch (cause) {
      push("error", t("geo.saveFailed"), cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [add, fileName, push, t]);

  const exportPng = useCallback(async () => {
    const preview = previewRef.current;
    if (!preview) return;
    setBusy(true);
    try {
      const blob = await canvasToPng(preview);
      await decodePng(blob);
      downloadBlob(blob, `${(fileName ?? "geometry").replace(/\.[^.]+$/, "") || "geometry"}-geometry.png`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The export failed.");
    } finally {
      setBusy(false);
    }
  }, [fileName]);

  const sliders = (() => {
    if (mode === "stretch") {
      return (
        <>
          {slider(t("geo.stretchX"), "stretchX", 20, 200, "%")}
          {slider(t("geo.stretchY"), "stretchY", 20, 200, "%")}
        </>
      );
    }
    if (mode === "rotate") {
      return (
        <>
          {slider(t("geo.angle"), "angle", -180, 180, "°")}
          {toggle(t("geo.flipH"), "flipH")}
          {toggle(t("geo.flipV"), "flipV")}
        </>
      );
    }
    if (mode === "pinch") {
      return (
        <>
          {slider(t("geo.strength"), "pinch", -100, 100, "%")}
          {slider(t("geo.radius"), "pinchRadius", 10, 100, "%")}
          {slider(t("geo.centerX"), "pinchX", 0, 100, "%")}
          {slider(t("geo.centerY"), "pinchY", 0, 100, "%")}
        </>
      );
    }
    if (mode === "perspective") {
      return (
        <>
          {slider(t("geo.topWidth"), "perspTop", 20, 100, "%")}
          {slider(t("geo.bottomWidth"), "perspBottom", 20, 100, "%")}
        </>
      );
    }
    return (
      <>
        {slider(t("geo.amplitude"), "warpAmplitude", -100, 100, "%")}
        {slider(t("geo.frequency"), "warpFrequency", 1, 12, "")}
      </>
    );
  })();

  function slider(
    label: string,
    key: keyof GeometryParams,
    minimum: number,
    maximum: number,
    suffix: string,
  ) {
    return (
      <label className="kx-field" key={key}>
        <span className="kx-label">
          {label}{" "}
          <output className="kx-mono">
            {String(params[key])}
            {suffix}
          </output>
        </span>
        <input
          type="range"
          min={minimum}
          max={maximum}
          value={Number(params[key])}
          onChange={(event) =>
            setParams((current) => ({ ...current, [key]: Number(event.target.value) }))
          }
        />
      </label>
    );
  }

  function toggle(label: string, key: "flipH" | "flipV") {
    return (
      <label className="kx-switch" key={key}>
        <input
          type="checkbox"
          checked={params[key]}
          onChange={(event) =>
            setParams((current) => ({ ...current, [key]: event.target.checked }))
          }
        />
        <span className="kx-switch-track" />
        <span className="kx-switch-label">{label}</span>
      </label>
    );
  }

  return (
    <div className="kx-content">
      <SectionHeader
        eyebrow={t("groupCreate")}
        title={t("morphCore")}
        description={t("geo.description")}
        actions={<StateBadge state={capability.state} />}
      />

      <div className="kx-notice" data-tone="info">
        <Icon name="shield" size={18} />
        <div>
          <strong>{t("geo.honestTitle")}</strong> {t("geo.honestBody")}
        </div>
      </div>

      {!ageVerified ? (
        <div className="kx-card kx-age-gate">
          <div className="kx-age-gate-head">
            <Icon name="lock" size={24} />
            <div>
              <h2 className="kx-card-title">{t("geo.ageTitle")}</h2>
              <p className="kx-card-sub">{t("geo.ageBody")}</p>
            </div>
          </div>
          <div className="kx-age-form">
            <label className="kx-field">
              <span className="kx-label">{t("geo.ageBirthYear")}</span>
              <input
                className="kx-input"
                type="number"
                inputMode="numeric"
                min={1900}
                max={currentYear}
                value={birthYear}
                onChange={(event) => {
                  setBirthYear(event.target.value);
                  setAgeDenied(false);
                }}
              />
            </label>
            <label className="kx-switch">
              <input
                type="checkbox"
                checked={ageConfirmed}
                onChange={(event) => setAgeConfirmed(event.target.checked)}
              />
              <span className="kx-switch-track" />
              <span className="kx-switch-label">{t("geo.ageConfirm")}</span>
            </label>
            <button
              type="button"
              className="kx-btn kx-btn-primary"
              onClick={confirmAge}
              disabled={!birthYear || !ageConfirmed}
            >
              {t("geo.ageVerify")}
            </button>
          </div>
          {ageDenied && (
            <div className="kx-notice" data-tone="danger">
              <Icon name="alert" size={16} />
              <div>{t("geo.ageDenied")}</div>
            </div>
          )}
          <p className="kx-age-privacy">
            <Icon name="shield" size={14} />
            {t("geo.agePrivacy")}
          </p>
        </div>
      ) : !ready ? (
        <div className="kx-card">
          <EmptyState
            icon="morph"
            title={t("geo.openImage")}
            hint={t("geo.openHint")}
            action={
              <button
                type="button"
                className="kx-btn kx-btn-primary"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                <Icon name="upload" size={16} />
                {t("geo.chooseFile")}
              </button>
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
        <div className="kx-geo-grid">
          <section className="kx-card kx-geo-stage-card">
            <div className="kx-row-between" style={{ marginBottom: 10 }}>
              <span className="kx-mono kx-muted" dir="ltr">
                {dimensions.width}×{dimensions.height} · {fileName}
              </span>
              <div className="kx-row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="kx-btn kx-btn-sm"
                  data-active={compare}
                  aria-pressed={compare}
                  onClick={() => setCompare((value) => !value)}
                  disabled={busy}
                >
                  <Icon name="eye" size={14} />
                  {compare ? t("geo.showResult") : t("geo.showOriginal")}
                </button>
                <button
                  type="button"
                  className="kx-btn kx-btn-sm"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                >
                  <Icon name="upload" size={14} />
                  {t("geo.replace")}
                </button>
              </div>
            </div>
            <div className="kx-geo-stage">
              <canvas ref={previewRef} className="kx-geo-canvas" />
              {compare && originalUrl && (
                <img
                  className="kx-geo-original"
                  src={originalUrl}
                  alt={t("geo.showOriginal")}
                />
              )}
            </div>
            <div className="kx-geo-actions">
              <button type="button" className="kx-btn kx-btn-primary" onClick={() => void apply()} disabled={busy}>
                <Icon name="check" size={15} />
                {t("geo.apply")}
              </button>
              <button type="button" className="kx-btn" onClick={() => void resetAll()} disabled={busy}>
                {t("geo.reset")}
              </button>
              <button
                type="button"
                className="kx-btn"
                onClick={() => (historyRef.current.index > 0 ? void restore(historyRef.current.index - 1) : undefined)}
                disabled={!canUndo || busy}
                data-history={historyTick}
              >
                {t("geo.undo")}
              </button>
              <button
                type="button"
                className="kx-btn"
                onClick={() => (canRedo ? void restore(historyRef.current.index + 1) : undefined)}
                disabled={!canRedo || busy}
              >
                {t("geo.redo")}
              </button>
              <button type="button" className="kx-btn" onClick={() => void saveToLibrary()} disabled={busy}>
                <Icon name="download" size={15} />
                {saved ? t("geo.saved") : t("geo.save")}
              </button>
              <button type="button" className="kx-btn" onClick={() => void exportPng()} disabled={busy}>
                <Icon name="export" size={15} />
                {t("geo.export")}
              </button>
            </div>
            {error && (
              <div className="kx-notice" data-tone="danger" style={{ marginTop: 10 }}>
                <Icon name="alert" size={16} />
                <div>{error}</div>
              </div>
            )}
          </section>

          <aside className="kx-card kx-geo-inspector">
            <div className="kx-card-title">{t("geo.transform")}</div>
            <div className="kx-segmented" style={{ marginTop: 10 }} role="group" aria-label={t("geo.transform")}>
              {(["stretch", "rotate", "pinch", "perspective", "warp"] as GeometryMode[]).map((entry) => (
                <button
                  key={entry}
                  type="button"
                  aria-pressed={mode === entry}
                  onClick={() => {
                    setMode(entry);
                    setParams(DEFAULTS);
                  }}
                >
                  {t(`geo.mode.${entry}`)}
                </button>
              ))}
            </div>
            <div className="kx-col" style={{ gap: 12, marginTop: 14 }}>
              {sliders}
            </div>
            <p className="kx-card-sub" style={{ marginTop: 12 }}>
              {t("geo.liveHint")}
            </p>
            <div className="kx-divider" />
            <details className="kx-dev-catalog">
              <summary>
                <span>{t("geo.legacyTitle")}</span>
                <span className="kx-badge" data-state="BLOCKED">
                  {legacy.reduce((sum, entry) => sum + entry.tools, 0)}
                </span>
              </summary>
              <p className="kx-card-sub" style={{ marginTop: 8 }}>
                {t("geo.legacyHint")}
              </p>
              <ul className="kx-geo-legacy">
                {legacy.map((entry) => (
                  <li key={entry.id}>
                    <span>{settings.language === "ar" ? entry.name : entry.nameEn}</span>
                    <span className="kx-badge" data-state="BLOCKED">
                      {entry.tools}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </aside>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        aria-label={t("geo.chooseFile")}
        onChange={(event) => {
          chooseFile(event.target.files?.[0] ?? null);
          event.target.value = "";
        }}
      />
    </div>
  );
}
