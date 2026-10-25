import { useCallback, useMemo, useRef, useState } from "react";
import { Icon } from "../app/icons";
import {
  autoCurvePoints,
  buildCurveLut,
  IDENTITY_CURVE,
  normaliseCurvePoints,
  type CurveChannel,
  type CurvePoint,
  type Histogram,
} from "../services/imageOps";
import { CURVE_SHAPES } from "../services/elysianPresets";

const CHANNELS: CurveChannel[] = ["rgb", "r", "g", "b"];
const SPAN = 256;
const HIT_RADIUS = 12;

const CHANNEL_COLOR: Record<CurveChannel, string> = {
  rgb: "var(--kx-accent)",
  r: "#ff6b61",
  g: "#5fd08a",
  b: "#5aa9ff",
};

const clampLevel = (value: number) => Math.max(0, Math.min(SPAN - 1, Math.round(value)));

/** Proximity test used when a click has to decide between grab and add. */
function withinTolerance(a: number, b: number, tolerance: number): boolean {
  const distance = Math.abs(a - b);
  return distance < tolerance;
}

/** Area under the sampled distribution, leaving headroom so the curve stays readable. */
function histogramPath(bins: number[], max: number): string {
  if (!max) return "";
  let d = `M 0 ${SPAN}`;
  for (let level = 0; level < SPAN; level += 2) {
    const height = (bins[level] / max) * (SPAN * 0.72);
    d += ` L ${level} ${SPAN - height}`;
  }
  return `${d} L ${SPAN - 1} ${SPAN} Z`;
}

function curvePath(lut: Uint8ClampedArray): string {
  let d = "";
  for (let level = 0; level < SPAN; level += 1) {
    d += `${level === 0 ? "M" : "L"} ${level} ${SPAN - lut[level]}`;
  }
  return d;
}

/**
 * Tone-curve workbench.
 *
 * The plot is the real transfer function: the histogram behind it is measured
 * from the pixels entering this layer, the stroke is sampled from the same
 * 256-entry table the pipeline applies, and every handle writes plain numbers
 * into the layer. Nothing here previews a look the pipeline cannot reproduce.
 *
 * The plot is pinned to `dir="ltr"` even in the Arabic build because the
 * horizontal axis is signal level, not text.
 */
export function CurveWorkbench({
  channel,
  points,
  histogram,
  onChannel,
  onPoints,
  t,
}: {
  channel: CurveChannel;
  points: CurvePoint[];
  histogram: Histogram | null;
  onChannel: (channel: CurveChannel) => void;
  onPoints: (points: CurvePoint[]) => void;
  t: (key: string) => string;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<number | null>(null);
  const [active, setActive] = useState(0);

  const knots = useMemo(() => normaliseCurvePoints(points), [points]);
  const lut = useMemo(() => buildCurveLut(points), [points]);
  const selected = knots[Math.min(active, knots.length - 1)] ?? knots[0];

  const bins = useMemo(() => {
    if (!histogram) return null;
    const source =
      channel === "r" ? histogram.r : channel === "g" ? histogram.g : channel === "b" ? histogram.b : histogram.luma;
    let max = 0;
    for (const value of source) max = Math.max(max, value);
    return { path: histogramPath(source, max), max };
  }, [histogram, channel]);

  const write = useCallback(
    (next: CurvePoint[], focus?: number) => {
      const normalised = normaliseCurvePoints(next);
      if (focus !== undefined) setActive(Math.max(0, Math.min(normalised.length - 1, focus)));
      onPoints(normalised);
    },
    [onPoints],
  );

  const levelFromEvent = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const input = ((event.clientX - rect.left) / rect.width) * SPAN;
    const output = SPAN - ((event.clientY - rect.top) / rect.height) * SPAN;
    return { input: clampLevel(input), output: clampLevel(output) };
  }, []);

  const nearestKnot = useCallback(
    (level: { input: number; output: number }) => {
      let best = -1;
      let bestDistance = Number.POSITIVE_INFINITY;
      knots.forEach((knot, index) => {
        const distance = Math.hypot(knot.input - level.input, knot.output - level.output);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });
      return bestDistance <= HIT_RADIUS ? best : null;
    },
    [knots],
  );

  const moveKnot = useCallback(
    (index: number, level: { input: number; output: number }) => {
      const knot = knots[index];
      if (!knot) return;
      const minInput = index === 0 ? 0 : knots[index - 1].input + 1;
      const maxInput = index === knots.length - 1 ? SPAN - 1 : knots[index + 1].input - 1;
      const minOutput = index === 0 ? 0 : knots[index - 1].output;
      const maxOutput = index === knots.length - 1 ? SPAN - 1 : knots[index + 1].output;
      const next = knots.map((entry, position) =>
        position === index
          ? {
              input: clampLevel(Math.max(minInput, Math.min(maxInput, level.input))),
              output: clampLevel(Math.max(minOutput, Math.min(maxOutput, level.output))),
            }
          : entry,
      );
      write(next, index);
    },
    [knots, write],
  );

  const removeKnot = useCallback(
    (index: number) => {
      if (index === 0 || index === knots.length - 1 || knots.length <= 2) return;
      write(knots.filter((_, entry) => entry !== index), Math.max(0, index - 1));
    },
    [knots, write],
  );

  const addKnot = useCallback(() => {
    if (knots.length >= 12) return;
    let gap = 0;
    let index = 0;
    for (let i = 0; i < knots.length - 1; i += 1) {
      const width = knots[i + 1].input - knots[i].input;
      if (width > gap) {
        gap = width;
        index = i;
      }
    }
    if (gap < 8) {
      // No room between existing knots: drop the point on the midpoint instead.
      const input = Math.round((knots[0].input + knots[knots.length - 1].input) / 2);
      if (knots.some((knot) => withinTolerance(knot.input, input, 2))) return;
      write([...knots, { input, output: lut[input] }], knots.length);
      return;
    }
    const input = Math.round((knots[index].input + knots[index + 1].input) / 2);
    write([...knots, { input, output: lut[input] }], index + 1);
  }, [knots, lut, write]);

  const applyAuto = useCallback(() => {
    if (!histogram || !histogram.samples) return;
    write(autoCurvePoints(histogram), 1);
  }, [histogram, write]);

  const resetCurve = useCallback(() => {
    write(IDENTITY_CURVE.map((point) => ({ ...point })), 0);
  }, [write]);

  return (
    <section className="elys-curves" aria-label={t("elysian.curves.workbench")} data-curves-workbench>
      <header className="elys-curves-head">
        <div className="kx-segmented" role="group" aria-label={t("elysian.curves.channels")} dir="ltr">
          {CHANNELS.map((entry) => (
            <button
              key={entry}
              type="button"
              aria-pressed={channel === entry}
              data-curve-channel={entry}
              onClick={() => onChannel(entry)}
            >
              <span className="elys-curves-dot" style={{ background: CHANNEL_COLOR[entry] }} />
              {t(`elysian.curves.channel.${entry}`)}
            </button>
          ))}
        </div>
        <div className="kx-row" style={{ gap: 6, flexWrap: "wrap" }}>
          <button
            type="button"
            className="kx-btn kx-btn-sm"
            data-curve-action="auto"
            onClick={applyAuto}
            disabled={!histogram || histogram.samples === 0}
            title={t("elysian.curves.autoHint")}
          >
            <Icon name="sparkles" size={13} />
            {t("elysian.curves.auto")}
          </button>
          <button
            type="button"
            className="kx-btn kx-btn-sm"
            data-curve-action="add"
            onClick={addKnot}
            disabled={knots.length >= 12}
          >
            <Icon name="plus" size={13} />
            {t("elysian.curves.add")}
          </button>
          <button
            type="button"
            className="kx-btn kx-btn-sm"
            data-curve-action="reset"
            onClick={resetCurve}
          >
            <Icon name="undo" size={13} />
            {t("elysian.curves.reset")}
          </button>
        </div>
      </header>

      <div className="elys-curves-body">
        <div className="elys-curves-plot" dir="ltr">
          <svg
            ref={svgRef}
            className="elys-curves-svg"
            data-curve-plot
            viewBox={`0 0 ${SPAN} ${SPAN}`}
            preserveAspectRatio="none"
            role="group"
            aria-label={t("elysian.curves.plot")}
            onPointerDown={(event) => {
              const level = levelFromEvent(event);
              if (!level) return;
              const hit = nearestKnot(level);
              if (hit === null) {
                const index = knots.filter((knot) => knot.input < level.input).length;
                const next = [...knots];
                if (next.length < 12) {
                  next.splice(index, 0, { input: level.input, output: lut[level.input] });
                  write(next, index);
                  dragRef.current = index;
                }
              } else {
                dragRef.current = hit;
                setActive(hit);
              }
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (dragRef.current === null) return;
              const level = levelFromEvent(event);
              if (level) moveKnot(dragRef.current, level);
            }}
            onPointerUp={(event) => {
              dragRef.current = null;
              event.currentTarget.releasePointerCapture?.(event.pointerId);
            }}
            onPointerCancel={() => {
              dragRef.current = null;
            }}
          >
            <g className="elys-curves-grid">
              {[64, 128, 192].map((line) => (
                <line key={`v${line}`} x1={line} y1={0} x2={line} y2={SPAN} />
              ))}
              {[64, 128, 192].map((line) => (
                <line key={`h${line}`} x1={0} y1={line} x2={SPAN} y2={line} />
              ))}
            </g>
            {bins?.path && <path className="elys-curves-hist" d={bins.path} fill={CHANNEL_COLOR[channel]} />}
            <line className="elys-curves-diagonal" x1={0} y1={SPAN} x2={SPAN} y2={0} />
            <path className="elys-curves-line" d={curvePath(lut)} stroke={CHANNEL_COLOR[channel]} />
            {knots.map((knot, index) => (
              <circle
                // Index-stable key: a value-keyed node would be remounted on
                // every edit and the keyboard focus would drop mid-nudge.
                key={`curve-handle-${index}`}
                className={`elys-curves-handle${index === active ? " is-active" : ""}`}
                data-curve-point={index}
                cx={knot.input}
                cy={SPAN - knot.output}
                r={index === active ? 7 : 5}
                tabIndex={0}
                role="button"
                aria-label={`${t("elysian.curves.point")} ${index + 1}: ${knot.input} → ${knot.output}`}
                onFocus={() => setActive(index)}
                onKeyDown={(event) => {
                  const step = event.shiftKey ? 10 : 1;
                  const next = [...knots];
                  if (event.key === "ArrowLeft") next[index] = { ...knot, input: knot.input - step };
                  else if (event.key === "ArrowRight") next[index] = { ...knot, input: knot.input + step };
                  else if (event.key === "ArrowUp") next[index] = { ...knot, output: knot.output + step };
                  else if (event.key === "ArrowDown") next[index] = { ...knot, output: knot.output - step };
                  else if (event.key === "Delete" || event.key === "Backspace") {
                    event.preventDefault();
                    removeKnot(index);
                    return;
                  } else return;
                  event.preventDefault();
                  write(next, index);
                }}
              />
            ))}
          </svg>
          <div className="elys-curves-axes">
            <span>{t("elysian.curves.axisInput")}</span>
            <span>{t("elysian.curves.axisOutput")}</span>
          </div>
        </div>

        <div className="elys-curves-side">
          <div className="kx-segmented elys-curves-shapes" role="group" aria-label={t("elysian.curves.shapes")}>
            {CURVE_SHAPES.map((shape) => (
              <button
                key={shape.id}
                type="button"
                data-curve-shape={shape.id}
                aria-pressed={
                  knots.length === shape.points.length &&
                  normaliseCurvePoints(shape.points).every(
                    (knot, index) => knot.input === knots[index]?.input && knot.output === knots[index]?.output,
                  )
                }
                onClick={() => write(shape.points.map((point) => ({ ...point })), 1)}
              >
                {t(shape.labelKey)}
              </button>
            ))}
          </div>

          <p className="elys-curves-readout" dir="ltr" data-curve-readout>
            {selected ? `${selected.input} → ${lut[selected.input]}` : "—"}
            <span className="kx-muted">
              {" · "}
              {t("elysian.curves.slope")} {((lut[192] - lut[64]) / 128).toFixed(2)}
            </span>
          </p>

          <dl className="elys-curves-stats" dir="ltr">
            <div>
              <dt>{t("elysian.curves.mean")}</dt>
              <dd>{histogram && histogram.samples ? Math.round(histogram.mean) : "—"}</dd>
            </div>
            <div>
              <dt>{t("elysian.curves.shadows")}</dt>
              <dd>
                {histogram && histogram.samples ? `${(histogram.shadows * 100).toFixed(1)}%` : "—"}
              </dd>
            </div>
            <div>
              <dt>{t("elysian.curves.highlights")}</dt>
              <dd>
                {histogram && histogram.samples ? `${(histogram.highlights * 100).toFixed(1)}%` : "—"}
              </dd>
            </div>
            <div>
              <dt>{t("elysian.curves.range")}</dt>
              <dd>
                {histogram && histogram.samples
                  ? `${histogram.lowInput}–${histogram.highInput}`
                  : "—"}
              </dd>
            </div>
          </dl>

          <ul className="elys-curves-points">
            {knots.map((knot, index) => (
              <li key={`row-${index}`} data-curve-row={index}>
                <span className="elys-curves-row-no">{index + 1}</span>
                <label className="elys-curves-num">
                  <span>{t("elysian.curves.input")}</span>
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={knot.input}
                    onChange={(event) => {
                      const next = [...knots];
                      next[index] = { ...knot, input: clampLevel(Number(event.target.value)) };
                      write(next, index);
                    }}
                  />
                </label>
                <label className="elys-curves-num">
                  <span>{t("elysian.curves.output")}</span>
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={knot.output}
                    onChange={(event) => {
                      const next = [...knots];
                      next[index] = { ...knot, output: clampLevel(Number(event.target.value)) };
                      write(next, index);
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="kx-btn kx-btn-sm elys-curves-remove"
                  onClick={() => removeKnot(index)}
                  disabled={index === 0 || index === knots.length - 1 || knots.length <= 2}
                  aria-label={`${t("elysian.curves.remove")} ${index + 1}`}
                >
                  <Icon name="trash" size={12} />
                </button>
              </li>
            ))}
          </ul>
          <p className="kx-card-sub">{t("elysian.curves.dragHint")}</p>
        </div>
      </div>
    </section>
  );
}
