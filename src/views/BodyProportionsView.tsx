import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CAPABILITIES } from "../app/capabilities";
import { Icon } from "../app/icons";
import { useLibrary } from "../state/LibraryContext";
import { useSettings } from "../state/SettingsContext";
import { useToast } from "../state/ToastContext";
import { translate } from "../i18n/translate";
import { EmptyState, SectionHeader, StateBadge } from "./ui";
import { useHandoffReceiver, useProvenanceLine } from "../ui/handoff";
import {
  canonGuides,
  DEFAULT_GUIDES,
  findGuide,
  guideRows,
  measureProportions,
  measurementText,
  moveGuide,
  type Guide,
} from "../services/proportions";
import type { ProvenanceRecord } from "../state/types";

const AGE_GATE_KEY = "knoux-body.age-gate.v1";
const MAX_EDGE = 2000;

/**
 * The Body Editor screen, rebuilt as what it can honestly be: a manual
 * proportion mirror. The user places guides over their own photograph and the
 * screen measures those guides — spans in pixels, spans in head lengths, and
 * the gap between consecutive lines. Nothing recognises a body, nothing
 * reshapes one, and the body-aware services stay listed as blocked with the
 * artefact they are missing.
 */
export default function BodyProportionsView() {
  const capability = CAPABILITIES["body-editor"];
  const { settings } = useSettings();
  const { add } = useLibrary();
  const { push } = useToast();
  const t = useCallback((key: string) => translate(settings.language, key), [settings.language]);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ id: string; axis: Guide["axis"] } | null>(null);

  const [gatePassed, setGatePassed] = useState(false);
  const [birthYear, setBirthYear] = useState("");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [ageDenied, setAgeDenied] = useState(false);

  const [image, setImage] = useState<{
    url: string;
    blob: Blob;
    width: number;
    height: number;
    name: string;
  } | null>(null);
  const [guides, setGuides] = useState<Guide[]>(DEFAULT_GUIDES);
  const [dragging, setDragging] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provenance, setProvenance] = useState<ProvenanceRecord[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      setGatePassed(sessionStorage.getItem(AGE_GATE_KEY) === "verified");
    } catch {
      setGatePassed(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      setImage((current) => {
        if (current) URL.revokeObjectURL(current.url);
        return null;
      });
    };
  }, []);

  const confirmAge = useCallback(() => {
    const declared = new Date().getFullYear();
    const year = Number.parseInt(birthYear, 10);
    const adult = Number.isFinite(year) && year >= 1900 && year <= declared && declared - year >= 18;
    if (!adult || !ageConfirmed) {
      setAgeDenied(true);
      return;
    }
    try {
      sessionStorage.setItem(AGE_GATE_KEY, "verified");
    } catch {
      /* the in-memory decision still applies */
    }
    setAgeDenied(false);
    setGatePassed(true);
  }, [ageConfirmed, birthYear]);

  const loadBlob = useCallback(
    (file: Blob, name: string, origin?: ProvenanceRecord[]) => {
      if (!file.type.startsWith("image/")) {
        setError(t("body.notImage"));
        return;
      }
      setBusy(true);
      setError(null);
      setProvenance(origin ?? []);
      const url = URL.createObjectURL(file);
      const probe = new Image();
      probe.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(probe.naturalWidth, probe.naturalHeight));
        setImage({
          url,
          blob: file,
          width: Math.max(2, Math.round(probe.naturalWidth * scale)),
          height: Math.max(2, Math.round(probe.naturalHeight * scale)),
          name,
        });
        setGuides(DEFAULT_GUIDES.map((guide) => ({ ...guide })));
        setCopied(false);
        setBusy(false);
      };
      probe.onerror = () => {
        URL.revokeObjectURL(url);
        setBusy(false);
        setError(t("body.notImage"));
      };
      probe.src = url;
    },
    [t],
  );

  useHandoffReceiver(
    "body",
    "image",
    (incoming) => {
      loadBlob(incoming.blob, incoming.name, incoming.provenance);
    },
    gatePassed,
  );
  const provenanceLine = useProvenanceLine(provenance, t);

  const report = useMemo(
    () => measureProportions(guides, image?.width ?? 1000, image?.height ?? 1000),
    [guides, image],
  );
  const rows = useMemo(() => guideRows(guides), [guides]);

  const positionFromEvent = useCallback((event: React.PointerEvent) => {
    const drag = dragRef.current;
    const svg = svgRef.current;
    if (!drag || !svg) return null;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return drag.axis === "horizontal"
      ? (event.clientY - rect.top) / rect.height
      : (event.clientX - rect.left) / rect.width;
  }, []);

  const applyCanon = useCallback(() => {
    setGuides((current) => canonGuides(current));
    push("success", t("body.canonApplied"), t("body.canonAppliedBody"));
  }, [push, t]);

  const resetGuides = useCallback(() => {
    setGuides(DEFAULT_GUIDES.map((guide) => ({ ...guide })));
    setCopied(false);
  }, []);

  const copyMeasurements = useCallback(async () => {
    const text = measurementText(guides, report, t);
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("This runtime has no clipboard.");
      }
      // A clipboard promise can hang when the document is not focused, which
      // would leave the button silent forever. The wait is bounded so the user
      // always gets an answer.
      await Promise.race([
        navigator.clipboard.writeText(text),
        new Promise((_, reject) =>
          window.setTimeout(() => reject(new Error("The clipboard did not answer.")), 1500),
        ),
      ]);
      setCopied(true);
      push("success", t("body.copied"), t("body.copiedBody"));
    } catch {
      setCopied(false);
      push("error", t("body.copyFailed"), t("body.copyFailedBody"));
    }
  }, [guides, push, report, t]);

  const savePng = useCallback(async () => {
    if (!image) return;
    setBusy(true);
    try {
      // The blob is kept from the drop, never fetched back: the app CSP allows
      // no connect-src to blob URLs, and a round trip through the network
      // stack would be a strange way to move bytes the page already holds.
      const blob = image.blob;
      const base = image.name.replace(/\.[^.]+$/, "") || "proportions";
      const name = `${base}-proportions.png`;
      await add({
        name,
        kind: "image",
        mimeType: blob.type || "image/png",
        blob,
        duration: 0,
        width: image.width,
        height: image.height,
        source: "toolbox",
        thumbnail: null,
        provenance: [...provenance, { itemId: null, name, hub: "body", at: Date.now() }],
      });
      push("success", t("body.saved"), name);
    } catch (cause) {
      push("error", t("body.saveFailed"), cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [add, image, provenance, push, t]);

  if (!gatePassed) {
    return (
      <div className="kx-content">
        <SectionHeader
          eyebrow={t("groupCreate")}
          title={t("bodyEditor")}
          description={t("body.description")}
          actions={<StateBadge state={capability.state} />}
        />
        <div className="kx-card kx-age-gate">
          <div className="kx-age-gate-head">
            <Icon name="shield" size={20} />
            <div>
              <div className="kx-card-title">{t("body.ageTitle")}</div>
              <p className="kx-card-sub">{t("body.ageBody")}</p>
            </div>
          </div>
          <div className="kx-col" style={{ gap: 12, marginTop: 16 }}>
            <label className="kx-field">
              <span className="kx-label">{t("body.birthYear")}</span>
              <input
                id="bodyBirthYear"
                className="kx-input"
                inputMode="numeric"
                value={birthYear}
                maxLength={4}
                onChange={(event) => setBirthYear(event.target.value.replace(/\D/g, ""))}
                placeholder="1990"
              />
            </label>
            <label className="kx-switch">
              <input
                type="checkbox"
                checked={ageConfirmed}
                onChange={(event) => setAgeConfirmed(event.target.checked)}
              />
              <span className="kx-switch-track" />
              <span className="kx-switch-label">{t("body.ageConfirm")}</span>
            </label>
            <button
              type="button"
              className="kx-btn kx-btn-primary"
              onClick={confirmAge}
              disabled={!birthYear || !ageConfirmed}
            >
              {t("body.ageVerify")}
            </button>
          </div>
          {ageDenied && (
            <div className="kx-notice" data-tone="danger">
              <Icon name="alert" size={16} />
              <div>{t("body.ageDenied")}</div>
            </div>
          )}
          <p className="kx-age-privacy">
            <Icon name="shield" size={14} />
            {t("body.agePrivacy")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="kx-content">
      <SectionHeader
        eyebrow={t("groupCreate")}
        title={t("bodyEditor")}
        description={t("body.description")}
        actions={
          <div className="kx-row" style={{ gap: 8 }}>
            <StateBadge state={capability.state} />
            <button
              type="button"
              className="kx-btn kx-btn-sm kx-btn-primary"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              <Icon name="upload" size={14} />
              {image ? t("body.replace") : t("body.open")}
            </button>
          </div>
        }
      />

      <div className="kx-notice" data-tone="info">
        <Icon name="shield" size={18} />
        <div>
          <strong>{t("body.honestTitle")}</strong> {t("body.honestBody")}
        </div>
      </div>

      {!image ? (
        <div className="kx-card">
          <EmptyState
            icon="body"
            title={t("body.emptyTitle")}
            hint={t("body.emptyHint")}
            action={
              <button
                type="button"
                className="kx-btn kx-btn-primary"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                <Icon name="image" size={16} />
                {t("body.open")}
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
        <div className="kx-prop-layout">
          <section className="kx-card kx-prop-stage-card">
            <div className="kx-row-between" style={{ marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
              <span className="kx-mono kx-muted" dir="ltr">
                {image.width}×{image.height} · {image.name}
              </span>
              {provenanceLine && (
                <span className="kx-muted kx-provenance" title={provenanceLine}>
                  <Icon name="external" size={13} />
                  {provenanceLine}
                </span>
              )}
            </div>
            <div className="kx-prop-stage" data-prop-stage>
              <img src={image.url} alt={image.name} draggable={false} />
              <svg
                ref={svgRef}
                className="kx-prop-overlay"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                role="group"
                aria-label={t("body.guides")}
                data-prop-overlay
                onPointerMove={(event) => {
                  if (!dragging) return;
                  const position = positionFromEvent(event);
                  if (position === null) return;
                  setGuides((current) => moveGuide(current, dragging, position));
                  setCopied(false);
                }}
                onPointerUp={(event) => {
                  if (!dragging) return;
                  setDragging(null);
                  svgRef.current?.releasePointerCapture?.(event.pointerId);
                }}
                onPointerCancel={() => setDragging(null)}
              >
                {guides.map((guide) => {
                  const horizontal = guide.axis === "horizontal";
                  return (
                    <g key={guide.id}>
                      <line
                        className={`kx-prop-guide${dragging === guide.id ? " is-active" : ""}`}
                        x1={horizontal ? 0 : guide.position * 100}
                        y1={horizontal ? guide.position * 100 : 0}
                        x2={horizontal ? 100 : guide.position * 100}
                        y2={horizontal ? guide.position * 100 : 100}
                      />
                      <rect
                        className="kx-prop-hit"
                        data-prop-guide={guide.id}
                        x={horizontal ? 0 : guide.position * 100 - 2}
                        y={horizontal ? guide.position * 100 - 1.4 : 0}
                        width={horizontal ? 100 : 4}
                        height={horizontal ? 2.8 : 100}
                        tabIndex={0}
                        role="slider"
                        aria-label={t(`body.guide.${guide.id}`)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(guide.position * 100)}
                        aria-orientation={horizontal ? "vertical" : "horizontal"}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          dragRef.current = { id: guide.id, axis: guide.axis };
                          setDragging(guide.id);
                          svgRef.current?.setPointerCapture(event.pointerId);
                        }}
                        onKeyDown={(event) => {
                          const step = event.shiftKey ? 0.05 : 0.01;
                          const delta =
                            event.key === "ArrowUp" || event.key === "ArrowLeft"
                              ? -step
                              : event.key === "ArrowDown" || event.key === "ArrowRight"
                                ? step
                                : 0;
                          if (!delta) return;
                          event.preventDefault();
                          const current = findGuide(guides, guide.id)?.position ?? 0;
                          setGuides((state) => moveGuide(state, guide.id, current + delta));
                          setCopied(false);
                        }}
                      />
                    </g>
                  );
                })}
              </svg>
            </div>
            <div className="kx-prop-legend">
              <span className="kx-mono kx-muted" dir="ltr" data-prop-count>
                {t("body.guides")} {guides.length}
              </span>
              <div className="kx-row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="kx-btn kx-btn-sm" data-prop-canon onClick={applyCanon}>
                  <Icon name="sparkles" size={13} />
                  {t("body.canon")}
                </button>
                <button type="button" className="kx-btn kx-btn-sm" data-prop-reset onClick={resetGuides}>
                  {t("body.resetGuides")}
                </button>
                <button
                  type="button"
                  className="kx-btn kx-btn-sm"
                  data-prop-copy
                  onClick={() => void copyMeasurements()}
                >
                  <Icon name="copy" size={13} />
                  {copied ? t("body.copiedShort") : t("body.copy")}
                </button>
                <button
                  type="button"
                  className="kx-btn kx-btn-sm"
                  data-prop-save
                  onClick={() => void savePng()}
                  disabled={busy}
                >
                  <Icon name="download" size={13} />
                  {t("body.save")}
                </button>
              </div>
            </div>
            {error && (
              <div className="kx-notice" data-tone="danger" style={{ marginTop: 10 }}>
                <Icon name="alert" size={16} />
                <div>{error}</div>
              </div>
            )}
          </section>

          <aside className="kx-card kx-prop-panel">
            <div className="kx-card-title">
              <span>{t("body.measurements")}</span>
              <Icon name="hash" size={16} />
            </div>
            <dl className="kx-measure-grid" dir="ltr" data-prop-report>
              <div>
                <dt>{t("body.measure.height")}</dt>
                <dd data-measure="height">{Math.round(report.heightPx)} px</dd>
              </div>
              <div>
                <dt>{t("body.measure.head")}</dt>
                <dd data-measure="head">{Math.round(report.headPx)} px</dd>
              </div>
              <div>
                <dt>{t("body.measure.width")}</dt>
                <dd data-measure="width">{Math.round(report.widthPx)} px</dd>
              </div>
              <div>
                <dt>{t("body.measure.heads")}</dt>
                <dd data-measure="heads">{report.headsTall === null ? "—" : report.headsTall.toFixed(2)}</dd>
              </div>
              <div>
                <dt>{t("body.measure.perHead")}</dt>
                <dd data-measure="perHead">
                  {report.widthPerHead === null ? "—" : report.widthPerHead.toFixed(2)}
                </dd>
              </div>
              <div>
                <dt>{t("body.measure.canon")}</dt>
                <dd>{report.canonHeads.toFixed(2)}</dd>
              </div>
            </dl>

            <p className="kx-card-sub" style={{ marginTop: 10 }}>
              {t("body.canonNote")}
            </p>

            {/* The clipboard can be refused by the browser, so the same report
                is always readable and selectable on the page. */}
            <details className="kx-prop-report" data-prop-report>
              <summary>{t("body.reportText")}</summary>
              <pre dir="ltr">{measurementText(guides, report, t)}</pre>
            </details>

            <div className="kx-divider" />
            <ul className="kx-prop-rows" data-prop-rows>
              {rows.map(({ guide, fromPreviousPct }) => (
                <li key={guide.id} data-prop-row={guide.id}>
                  <span>{t(`body.guide.${guide.id}`)}</span>
                  <span className="kx-mono" dir="ltr">
                    {(guide.position * 100).toFixed(1)}%
                  </span>
                  <span className="kx-mono kx-muted" dir="ltr">
                    {fromPreviousPct === null ? "—" : `+${fromPreviousPct}`}
                  </span>
                </li>
              ))}
            </ul>

            <div className="kx-divider" />
            <div className="kx-card-title">{t("body.blockedTitle")}</div>
            <p className="kx-card-sub">{t("body.blockedHint")}</p>
            <ul className="kx-prop-blocked">
              <li data-blocked="segment">
                <span>
                  <strong>{t("body.blockedSegment")}</strong>
                  <em>{t("body.blockedSegmentWhy")}</em>
                </span>
                <span className="kx-badge" data-state="BLOCKED">
                  {t("body.blockedNeedsWeights")}
                </span>
              </li>
              <li data-blocked="deform">
                <span>
                  <strong>{t("body.blockedDeform")}</strong>
                  <em>{t("body.blockedDeformWhy")}</em>
                </span>
                <span className="kx-badge" data-state="BLOCKED">
                  {t("body.blockedNeedsEngine")}
                </span>
              </li>
            </ul>
            <p className="kx-card-sub" style={{ marginTop: 10 }}>
              {t("body.blockedFooter")}
            </p>
          </aside>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        aria-label={t("body.open")}
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          if (chosen) loadBlob(chosen, chosen.name);
          event.target.value = "";
        }}
      />
    </div>
  );
}
