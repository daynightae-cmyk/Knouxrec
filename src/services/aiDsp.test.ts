import { describe, expect, it } from "vitest";
import {
  detectContainer,
  detectSilence,
  encodeWav,
  fftInPlace,
  histogramDistance,
  luminanceHistogram,
  meanAbsoluteDifference,
  mixToMono,
  parseWavHeader,
  pitchShiftPhaseVocoder,
  profileNoise,
  resampleLinear,
  reverseChannels,
  rmsWindows,
  shannonEntropy,
  sobelEdges,
  spectrogram,
  spectrogramColor,
  timeStretchPhaseVocoder,
  toGrayscale,
  toHex,
  type GrayImage,
} from "./aiDsp";

function sine(frequency: number, sampleRate: number, seconds: number): Float32Array {
  const length = Math.round(sampleRate * seconds);
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    samples[index] = Math.sin((2 * Math.PI * frequency * index) / sampleRate);
  }
  return samples;
}

describe("WAV encoder", () => {
  it("writes a valid RIFF/WAVE header that parses back", () => {
    const left = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const right = new Float32Array([0, -0.25, 0.25, 0.75, -0.75]);
    const bytes = encodeWav([left, right], 48000);
    const header = parseWavHeader(bytes);
    expect(header).not.toBeNull();
    expect(header?.sampleRate).toBe(48000);
    expect(header?.channels).toBe(2);
    expect(header?.bitsPerSample).toBe(16);
    expect(header?.dataBytes).toBe(5 * 2 * 2);
  });

  it("rejects non-WAV data", () => {
    expect(parseWavHeader(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });

  it("writes sample values that decode back to the expected PCM", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const bytes = encodeWav([samples], 8000);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(16383);
    expect(view.getInt16(48, true)).toBe(-16384);
    expect(view.getInt16(50, true)).toBe(32767);
    expect(view.getInt16(52, true)).toBe(-32768);
  });
});

describe("audio maths", () => {
  it("reverses every channel sample-for-sample", () => {
    const reversed = reverseChannels([new Float32Array([1, 2, 3, 4])]);
    expect(Array.from(reversed[0])).toEqual([4, 3, 2, 1]);
  });

  it("mixes stereo to mono with the mean", () => {
    const mono = mixToMono([new Float32Array([1, 0]), new Float32Array([0, 1])]);
    expect(Array.from(mono)).toEqual([0.5, 0.5]);
  });

  it("resamples to a different rate with the right length", () => {
    const input = sine(440, 8000, 0.25);
    const output = resampleLinear(input, 8000, 16000);
    expect(output.length).toBe(input.length * 2);
    expect(output[0]).toBeCloseTo(input[0], 5);
  });

  it("report RMS windows and identify digital silence", () => {
    const samples = new Float32Array(8000);
    for (let index = 4000; index < 6000; index += 1) samples[index] = 0.5;
    const windows = rmsWindows(samples, 8000, 50);
    expect(windows).toHaveLength(20);
    const silence = detectSilence(windows, { thresholdDb: -40, minSilenceMs: 100 });
    expect(silence.intervals.length).toBeGreaterThan(0);
    expect(silence.silenceRatio).toBeGreaterThan(0);
  });

  it("profiles peak, RMS, DC offset and clipping", () => {
    const samples = new Float32Array(1000);
    samples.fill(0.25);
    const profile = profileNoise(samples, 8000);
    expect(profile.peak).toBeCloseTo(0.25, 3);
    expect(profile.rms).toBeCloseTo(0.25, 3);
    expect(profile.dcOffset).toBeCloseTo(0.25, 3);
    expect(profile.clippingSamples).toBe(0);
    expect(profile.durationSeconds).toBeCloseTo(0.125, 4);
  });

  it("shifts a 440 Hz tone to 880 Hz with the phase vocoder", () => {
    const input = sine(440, 44100, 0.6);
    const shifted = pitchShiftPhaseVocoder(input, 12);
    expect(shifted.length).toBe(input.length);
    const from = Math.round(0.15 * 44100);
    const to = Math.round(0.45 * 44100);
    let crossings = 0;
    for (let index = from + 1; index < to; index += 1) {
      if ((shifted[index - 1] < 0) !== (shifted[index] < 0)) crossings += 1;
    }
    const estimatedHz = crossings / 2 / ((to - from) / 44100);
    expect(estimatedHz).toBeGreaterThan(820);
    expect(estimatedHz).toBeLessThan(940);
  });

  it("stretches time without changing the sample rate", () => {
    const input = sine(440, 44100, 0.4);
    const stretched = timeStretchPhaseVocoder(input, 2);
    expect(stretched.length).toBe(input.length * 2);
    let energy = 0;
    for (const value of stretched) energy += value * value;
    expect(energy).toBeGreaterThan(0);
  });

  it("returns the phase-vocoder input unchanged at zero semitones", () => {
    const input = sine(220, 8000, 0.1);
    const shifted = pitchShiftPhaseVocoder(input, 0);
    expect(Array.from(shifted.slice(0, 10))).toEqual(Array.from(input.slice(0, 10)));
  });
});

describe("FFT and spectrogram", () => {
  it("computes a single-bin impulse as a flat magnitude spectrum", () => {
    const real = new Float32Array(8);
    const imaginary = new Float32Array(8);
    real[0] = 1;
    fftInPlace(real, imaginary);
    for (const value of real) expect(value).toBeCloseTo(1, 5);
    for (const value of imaginary) expect(value).toBeCloseTo(0, 5);
  });

  it("finds the frequency peak of a pure sine", () => {
    const sampleRate = 8192;
    const frequency = 1024;
    const samples = sine(frequency, sampleRate, 0.25);
    const { bins, frames } = spectrogram(samples, { fftSize: 1024, hopSize: 512 });
    expect(bins).toBe(512);
    expect(frames.length).toBeGreaterThan(0);
    let peakBin = 0;
    let peakValue = 0;
    for (let bin = 0; bin < bins; bin += 1) {
      if (frames[2][bin] > peakValue) {
        peakValue = frames[2][bin];
        peakBin = bin;
      }
    }
    const peakFrequency = (peakBin / bins) * (sampleRate / 2);
    expect(Math.abs(peakFrequency - frequency)).toBeLessThan(20);
  });

  it("rejects non power-of-two FFT sizes", () => {
    expect(() => fftInPlace(new Float32Array(6), new Float32Array(6))).toThrow();
  });

  it("maps every spectrogram level into the 0..255 colour range", () => {
    for (const level of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const [r, g, b] = spectrogramColor(level);
      for (const channel of [r, g, b]) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe("pixel algorithms", () => {
  function blank(width: number, height: number): GrayImage {
    return { width, height, data: new Float32Array(width * height) };
  }

  it("detects a hard edge and leaves a flat field alone", () => {
    const width = 8;
    const height = 4;
    const flat = blank(width, height);
    flat.data.fill(0.5);
    const flatEdges = sobelEdges(flat);
    expect(Math.max(...flatEdges.data)).toBeCloseTo(0, 6);

    const half = blank(width, height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 4; x < width; x += 1) half.data[y * width + x] = 1;
    }
    const edges = sobelEdges(half);
    expect(Math.max(...edges.data)).toBeGreaterThan(0.9);
    // the edge runs down the x = 3/4 boundary
    expect(edges.data[1 * width + 3]).toBeGreaterThan(0.5);
  });

  it("converts RGBA to luminance", () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]);
    const gray = toGrayscale(rgba, 3, 1);
    expect(gray.data[0]).toBeCloseTo(1, 3);
    expect(gray.data[1]).toBeCloseTo(0, 3);
    expect(gray.data[2]).toBeCloseTo(0.2126, 3);
  });

  it("compares histograms and frames", () => {
    const black = blank(4, 4);
    const white = blank(4, 4);
    white.data.fill(1);
    const distance = histogramDistance(
      luminanceHistogram(black, 8),
      luminanceHistogram(white, 8),
    );
    expect(distance).toBeCloseTo(1, 5);
    expect(meanAbsoluteDifference(black, white)).toBeCloseTo(1, 5);
  });
});

describe("container inspection", () => {
  it("sniffs PNG, JPEG, WebP, WAV, MP4, WebM and PDF magic bytes", () => {
    expect(detectContainer(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).format).toBe(
      "PNG image",
    );
    expect(detectContainer(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])).format).toBe("JPEG image");
    const webp = new Uint8Array(16);
    webp.set([0x52, 0x49, 0x46, 0x46], 0);
    webp.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(detectContainer(webp).format).toBe("WebP image");
    const wav = new Uint8Array(16);
    wav.set([0x52, 0x49, 0x46, 0x46], 0);
    wav.set([0x57, 0x41, 0x56, 0x45], 8);
    expect(detectContainer(wav).format).toBe("WAV audio");
    const mp4 = new Uint8Array(16);
    mp4.set([0x66, 0x74, 0x79, 0x70], 4);
    expect(detectContainer(mp4).format).toContain("MP4");
    expect(detectContainer(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])).format).toBe(
      "Matroska/WebM",
    );
    expect(detectContainer(new TextEncoder().encode("%PDF-1.7")).format).toBe("PDF document");
  });

  it("never trusts the extension, only the bytes", () => {
    // A file that claims to be MP4 but is plain text.
    expect(detectContainer(new TextEncoder().encode("hello world")).format).toBe(
      "Unknown binary",
    );
  });

  it("computes Shannon entropy and hex", () => {
    expect(shannonEntropy(new Uint8Array([0, 0, 0, 0]))).toBe(0);
    expect(shannonEntropy(new Uint8Array([0, 1, 2, 3]))).toBeCloseTo(2, 5);
    expect(toHex(new Uint8Array([0, 15, 16, 255]))).toBe("000f10ff");
  });
});
