/**
 * KNOUX REC — spectral noise reduction.
 *
 * A real, local denoiser: no model weight, no network, no third-party DSP. It
 * estimates a noise profile from the quietest frames of the clip itself, then
 * subtracts that profile from every short-time spectrum, keeping the phase and
 * a floor of the original magnitude so the result never sounds like a robot.
 *
 * Everything is pure sample math so a test can measure the signal-to-noise
 * improvement on a synthetic tone buried in broadband noise.
 */

import type { AudioSignal } from "./audioOps";

export interface DenoiseOptions {
  /** Over-subtraction factor: 0.5 is gentle, 4 is aggressive. */
  strength?: number;
  /** How much of the original magnitude survives, 0.02..0.5. */
  floor?: number;
  /** Share of the quietest frames used to learn the noise profile. */
  quietShare?: number;
}

const FRAME = 1024;
const HOP = 256;

/** In-place iterative radix-2 FFT. */
function fft(re: Float32Array, im: Float32Array, inverse: boolean): void {
  const n = re.length;
  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / length;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let start = 0; start < n; start += length) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < length / 2; k += 1) {
        const aRe = re[start + k];
        const aIm = im[start + k];
        const bRe = re[start + k + length / 2] * curRe - im[start + k + length / 2] * curIm;
        const bIm = re[start + k + length / 2] * curIm + im[start + k + length / 2] * curRe;
        re[start + k] = aRe + bRe;
        im[start + k] = aIm + bIm;
        re[start + k + length / 2] = aRe - bRe;
        im[start + k + length / 2] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i += 1) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

function hann(size: number): Float32Array {
  const table = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    table[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  }
  return table;
}

function frameCountFor(length: number): number {
  if (length <= FRAME) return 1;
  return 1 + Math.ceil((length - FRAME) / HOP);
}

/** Per-bin median of the selected frames, which is the noise profile. */
function medianProfile(
  magnitudes: Float32Array[],
  indices: number[],
  bins: number,
): Float32Array {
  const profile = new Float32Array(bins);
  const column = new Float32Array(indices.length);
  for (let bin = 0; bin < bins; bin += 1) {
    for (let i = 0; i < indices.length; i += 1) column[i] = magnitudes[indices[i]][bin];
    const sorted = Array.from(column).sort((a, b) => a - b);
    const middle = sorted.length >> 1;
    profile[bin] =
      sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  }
  return profile;
}

function denoiseChannel(
  samples: Float32Array,
  strength: number,
  floor: number,
  quietShare: number,
): Float32Array {
  const length = samples.length;
  if (length === 0) return new Float32Array(0);
  const window = hann(FRAME);
  const frameCount = frameCountFor(length);

  const re = new Float32Array(FRAME);
  const im = new Float32Array(FRAME);
  const spectraRe: Float32Array[] = [];
  const spectraIm: Float32Array[] = [];
  const magnitudes: Float32Array[] = [];
  const energies = new Float32Array(frameCount);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const offset = frame * HOP;
    let energy = 0;
    for (let i = 0; i < FRAME; i += 1) {
      const sample = offset + i < length ? samples[offset + i] : 0;
      const value = sample * window[i];
      re[i] = value;
      im[i] = 0;
      energy += value * value;
    }
    energies[frame] = energy;
    fft(re, im, false);
    const half = FRAME / 2 + 1;
    const mag = new Float32Array(half);
    for (let bin = 0; bin < half; bin += 1) mag[bin] = Math.hypot(re[bin], im[bin]);
    spectraRe.push(re.slice());
    spectraIm.push(im.slice());
    magnitudes.push(mag);
  }

  // Freeze the quietest share of frames as the noise estimate. Sorting the
  // frame energies keeps this deterministic, which the test relies on.
  const order = Array.from({ length: frameCount }, (_, index) => index).sort(
    (a, b) => energies[a] - energies[b],
  );
  const quietCount = Math.max(3, Math.round(frameCount * quietShare));
  const quietest = order.slice(0, Math.min(frameCount, quietCount));
  const profile = medianProfile(magnitudes, quietest, FRAME / 2 + 1);

  const out = new Float32Array(length);
  const norm = new Float32Array(length);
  const half = FRAME / 2 + 1;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const spectrumRe = spectraRe[frame];
    const spectrumIm = spectraIm[frame];
    const mag = magnitudes[frame];
    for (let bin = 0; bin < half; bin += 1) {
      const original = mag[bin];
      const reduced = Math.max(original - strength * profile[bin], floor * original);
      const scale = original > 1e-9 ? reduced / original : 0;
      spectrumRe[bin] *= scale;
      spectrumIm[bin] *= scale;
      if (bin > 0 && bin < FRAME / 2) {
        spectrumRe[FRAME - bin] *= scale;
        spectrumIm[FRAME - bin] *= scale;
      }
    }
    fft(spectrumRe, spectrumIm, true);
    const offset = frame * HOP;
    for (let i = 0; i < FRAME; i += 1) {
      const target = offset + i;
      if (target >= length) break;
      out[target] += spectrumRe[i] * window[i];
      norm[target] += window[i] * window[i];
    }
  }

  for (let i = 0; i < length; i += 1) {
    // The first and last few hundred samples receive fewer overlapping windows,
    // so a near-zero divisor there would amplify them instead of fading them.
    // Clamping keeps those edges quiet and the interior exactly normalised.
    out[i] /= Math.max(norm[i], 0.25);
  }
  return out;
}

/**
 * Reduce steady noise in a decoded signal. The length, sample rate and channel
 * count are preserved so the step composes with trim, gain and fades.
 */
export function denoiseSignal(
  signal: AudioSignal,
  options: DenoiseOptions = {},
): AudioSignal {
  const strength = Math.min(4, Math.max(0.5, options.strength ?? 2));
  const floor = Math.min(0.5, Math.max(0.02, options.floor ?? 0.08));
  const quietShare = Math.min(0.5, Math.max(0.05, options.quietShare ?? 0.2));
  return {
    sampleRate: signal.sampleRate,
    channels: signal.channels.map((channel) =>
      denoiseChannel(channel, strength, floor, quietShare),
    ),
  };
}
