import { describe, expect, it } from "vitest";
import type { AudioSignal } from "./audioOps";
import { denoiseSignal } from "./spectralDenoise";

const RATE = 44100;

function noise(index: number, seed: number): number {
  // Deterministic LCG noise, so two runs of the test compare the same bytes.
  const x = Math.sin((index + seed) * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/** A voiced burst over constant broadband noise — the case the denoiser targets. */
function speechLikeClip(seconds = 2): AudioSignal {
  const length = Math.round(RATE * seconds);
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const t = i / RATE;
    const voiced = t > 0.7 && t < 1.3;
    const envelope = voiced
      ? Math.min(1, (t - 0.7) / 0.03, (1.3 - t) / 0.03)
      : 0;
    samples[i] = 0.3 * envelope * Math.sin(2 * Math.PI * 440 * t) + 0.06 * noise(i, 7);
  }
  return { channels: [samples], sampleRate: RATE };
}

const rms = (samples: Float32Array, from: number, to: number): number => {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, to - from));
};

/** Amplitude of a 440 Hz component over a window, by direct correlation. */
const toneAmplitude = (samples: Float32Array, from: number, to: number): number => {
  let re = 0;
  let im = 0;
  for (let i = from; i < to; i += 1) {
    const phase = (2 * Math.PI * 440 * i) / RATE;
    re += samples[i] * Math.cos(phase);
    im += samples[i] * Math.sin(phase);
  }
  return (2 * Math.hypot(re, im)) / Math.max(1, to - from);
};

describe("spectral noise reduction", () => {
  it("keeps length, rate and channel count so it composes with other steps", () => {
    const source = speechLikeClip(1);
    const result = denoiseSignal(source, { strength: 2, floor: 0.08 });
    expect(result.sampleRate).toBe(RATE);
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0]).toHaveLength(source.channels[0].length);
  });

  it("lowers the noise floor in the pauses by a measured margin", () => {
    const source = speechLikeClip(2);
    const silentFrom = Math.round(0.1 * RATE);
    const silentTo = Math.round(0.6 * RATE);
    const before = rms(source.channels[0], silentFrom, silentTo);
    const after = rms(
      denoiseSignal(source, { strength: 2.5, floor: 0.06 }).channels[0],
      silentFrom,
      silentTo,
    );
    const gainDb = 20 * Math.log10(before / after);
    expect(gainDb).toBeGreaterThan(8);
  });

  it("keeps the voiced tone, so the result is not hollow", () => {
    const source = speechLikeClip(2);
    const from = Math.round(0.85 * RATE);
    const to = Math.round(1.15 * RATE);
    const before = toneAmplitude(source.channels[0], from, to);
    const after = toneAmplitude(
      denoiseSignal(source, { strength: 2, floor: 0.1 }).channels[0],
      from,
      to,
    );
    expect(after / before).toBeGreaterThan(0.75);
  });

  it("removes more as the strength rises", () => {
    const source = speechLikeClip(2);
    const from = Math.round(0.1 * RATE);
    const to = Math.round(0.6 * RATE);
    const gentle = rms(denoiseSignal(source, { strength: 0.8 }).channels[0], from, to);
    const strong = rms(denoiseSignal(source, { strength: 3.5 }).channels[0], from, to);
    expect(strong).toBeLessThan(gentle);
  });

  it("leaves a silent clip silent instead of inventing content", () => {
    const source: AudioSignal = {
      channels: [new Float32Array(RATE)],
      sampleRate: RATE,
    };
    const result = denoiseSignal(source, { strength: 4, floor: 0.02 });
    const peak = result.channels[0].reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    expect(peak).toBeLessThan(1e-6);
  });

  it("is deterministic for the same input", () => {
    const source = speechLikeClip(1);
    const first = denoiseSignal(source, { strength: 2, floor: 0.08 }).channels[0];
    const second = denoiseSignal(source, { strength: 2, floor: 0.08 }).channels[0];
    expect(Array.from(first.slice(0, 2000))).toEqual(Array.from(second.slice(0, 2000)));
  });

  it("handles a clip shorter than one analysis frame", () => {
    const source: AudioSignal = {
      channels: [new Float32Array(300).map((_, i) => Math.sin(i / 20) * 0.2)],
      sampleRate: RATE,
    };
    const result = denoiseSignal(source);
    expect(result.channels[0]).toHaveLength(300);
    expect(result.channels[0].every((value) => Number.isFinite(value))).toBe(true);
  });

  it("clamps absurd parameters instead of producing silence or blow-ups", () => {
    const source = speechLikeClip(1);
    for (const options of [
      { strength: -10, floor: -1 },
      { strength: 99, floor: 9 },
    ]) {
      const result = denoiseSignal(source, options);
      const peak = result.channels[0].reduce(
        (max, value) => Math.max(max, Math.abs(value)),
        0,
      );
      expect(Number.isFinite(peak)).toBe(true);
      expect(peak).toBeLessThan(1);
      expect(peak).toBeGreaterThan(0);
    }
  });
});
