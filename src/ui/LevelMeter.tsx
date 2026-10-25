import { useCallback, useEffect, useRef, useState } from "react";
import { linearToDb } from "../services/audioOps";

const BAR_HEIGHT = 10;
const CANVAS_HEIGHT = 46;

/**
 * One dB definition for the whole product: `audioOps.linearToDb` is what the
 * audio studio reports in its statistics, so a meter and a processed file can
 * never disagree about what -12 dBFS means. Silence is floored, not infinite.
 */
const formatDb = (value: number) => {
  const db = linearToDb(value);
  return db <= -119 ? "-∞" : db.toFixed(1);
};

/**
 * Live input meter for an audio-only recording session.
 *
 * The value comes from an AnalyserNode wired to the exact stream that is being
 * encoded, so the meter cannot drift into a decoration: it shows the signal,
 * and when the signal clips the meter says so. dBFS is the honest unit — a
 * recording tool that only shows a bouncing bar tells the user nothing about
 * whether the take is usable.
 */
export function LevelMeter({
  readLevel,
  active,
  labels,
}: {
  /** Peak of the live input, 0…1. Called once per animation frame. */
  readLevel: () => number;
  active: boolean;
  labels: {
    aria: string;
    peak: string;
    average: string;
    loudest: string;
    clip: string;
    silent: string;
    value: (dB: string, peak: string) => string;
  };
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const peakRef = useRef(0);
  const holdRef = useRef(0);
  const sumRef = useRef(0);
  const countRef = useRef(0);
  const framesRef = useRef(0);
  const maxRef = useRef(0);
  const lastRef = useRef(0);
  const clipRef = useRef(false);
  const [readout, setReadout] = useState({
    dB: "-∞",
    peak: "-∞",
    max: "-∞",
    frames: 0,
    clipped: false,
  });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const level = active ? Math.max(0, Math.min(1, readLevel())) : 0;

    // Decay is measured in seconds, not frames: a peak that falls off in half
    // a second turns an intermittent source into a blank meter, and a meter at
    // sixty or four hundred frames per second must read the same.
    const now = performance.now();
    const dt = lastRef.current ? Math.min(0.25, (now - lastRef.current) / 1000) : 0;
    lastRef.current = now;
    peakRef.current = Math.max(level, peakRef.current * Math.exp(-dt / 0.9));
    if (level >= 0.995) clipRef.current = true;
    if (level > maxRef.current) maxRef.current = level;
    sumRef.current += level;
    countRef.current += 1;
    framesRef.current += 1;

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || 240;
    const cssHeight = CANVAS_HEIGHT;
    if (canvas.width !== Math.round(cssWidth * dpr) || canvas.height !== Math.round(cssHeight * dpr)) {
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
    }
    const width = cssWidth;
    const height = cssHeight;

    const peak = peakRef.current;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Track
    context.fillStyle = "rgba(255,255,255,0.08)";
    context.fillRect(0, height - BAR_HEIGHT - 14, width, BAR_HEIGHT);

    // Graduated fill: quiet through loud, with the last tenth as the danger zone.
    const barWidth = width * peak;
    const gradient = context.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, "#2bd9a0");
    gradient.addColorStop(0.7, "#ffde00");
    gradient.addColorStop(1, "#ff4d5e");
    context.fillStyle = gradient;
    context.fillRect(0, height - BAR_HEIGHT - 14, barWidth, BAR_HEIGHT);

    // Peak hold tick
    holdRef.current = Math.max(peak * width, holdRef.current - 1.4);
    if (holdRef.current > 2) {
      context.fillStyle = clipRef.current ? "#ff4d5e" : "rgba(244,244,246,0.85)";
      context.fillRect(Math.min(width - 2, holdRef.current - 2), height - BAR_HEIGHT - 18, 2, BAR_HEIGHT + 8);
    }

    // Grid marks at -6, -12 and -18 dBFS, so the bar can be read rather than
    // admired. The bar is linear in amplitude, like every honest peak meter.
    context.strokeStyle = "rgba(255,255,255,0.16)";
    context.lineWidth = 1;
    [0.5, 0.25, 0.125].forEach((fraction) => {
      const x = Math.round(width * fraction);
      if (x <= 0 || x >= width) return;
      context.beginPath();
      context.moveTo(x, height - BAR_HEIGHT - 18);
      context.lineTo(x, height - 14);
      context.stroke();
    });
  }, [active, readLevel]);

  useEffect(() => {
    if (!active) {
      peakRef.current = 0;
      holdRef.current = 0;
      lastRef.current = 0;
      draw();
      return;
    }
    let cancelled = false;
    const loop = () => {
      if (cancelled) return;
      draw();
      frameRef.current = requestAnimationFrame(loop);
    };
    frameRef.current = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [active, draw]);

  // The numeric readout is refreshed ten times a second; a screen reader does
  // not need sixty updates a minute and the canvas already shows the shape.
  useEffect(() => {
    if (!active) {
      setReadout({ dB: "-∞", peak: "-∞", max: formatDb(maxRef.current), frames: framesRef.current, clipped: false });
      return;
    }
    const handle = window.setInterval(() => {
      const peak = peakRef.current;
      const average = countRef.current ? sumRef.current / countRef.current : 0;
      setReadout({
        dB: formatDb(peak),
        peak: formatDb(average),
        max: formatDb(maxRef.current),
        frames: framesRef.current,
        clipped: clipRef.current,
      });
    }, 100);
    return () => window.clearInterval(handle);
  }, [active]);

  return (
    <div className="kx-meter" data-level-meter>
      <div
        className="kx-meter-track"
        role="meter"
        aria-label={labels.aria}
        aria-valuemin={-60}
        aria-valuemax={0}
        aria-valuenow={readout.dB === "-∞" ? -60 : Number(readout.dB)}
        aria-valuetext={labels.value(readout.dB, readout.peak)}
      >
        <canvas ref={canvasRef} className="kx-meter-canvas" />
      </div>
      <div className="kx-meter-readout" dir="ltr">
        <span className="kx-mono">
          {labels.peak} <strong data-level-dB>{readout.dB}</strong> dBFS
        </span>
        <span className="kx-mono kx-muted">
          {labels.average} {readout.peak} dBFS
        </span>
        <span className="kx-mono kx-muted" data-level-max>
          {labels.loudest} {readout.max} dBFS
        </span>
        <span
          className="kx-meter-flag"
          data-level-frames={readout.frames}
          data-level-clip={readout.clipped ? "clip" : readout.max === "-∞" ? "silent" : "ok"}
        >
          {readout.clipped ? labels.clip : active ? "" : labels.silent}
        </span>
      </div>
    </div>
  );
}
