import { describe, expect, it } from "vitest";
import { encodeWav, parseWavHeader } from "./aiDsp";
import {
  analyseSilence,
  applySteps,
  cutSilenceSignal,
  dbToLinear,
  decodeAudioBlob,
  encodeWavBlob,
  fadeSignal,
  frameCount,
  gainSignal,
  linearToDb,
  normaliseSignal,
  peakOf,
  probeAudioEncoders,
  removeRanges,
  reverseSignal,
  signalStats,
  splitSignal,
  toMonoSignal,
  toStereoSignal,
  trimSignal,
  waveformGeometry,
  type AudioSignal,
} from "./audioOps";

const RATE = 8000;

/** A full-scale sine of `cycles` over `seconds`. */
function sine(seconds: number, cycles: number, amplitude = 0.8): AudioSignal {
  const frames = Math.round(seconds * RATE);
  const channel = new Float32Array(frames);
  for (let index = 0; index < frames; index += 1) {
    channel[index] = amplitude * Math.sin((2 * Math.PI * cycles * index) / RATE);
  }
  return { channels: [channel], sampleRate: RATE };
}

function stereo(): AudioSignal {
  const left = new Float32Array([0.1, 0.2, 0.3, 0.4]);
  const right = new Float32Array([-0.1, -0.2, -0.3, -0.4]);
  return { channels: [left, right], sampleRate: RATE };
}

function loudThenQuietThenLoud(): AudioSignal {
  const loud = (frames: number) => {
    const out = new Float32Array(frames);
    for (let index = 0; index < frames; index += 1) {
      out[index] = 0.7 * Math.sin((2 * Math.PI * 200 * index) / RATE);
    }
    return out;
  };
  return {
    channels: [
      // 0.2s loud, 0.4s digital silence, 0.2s loud
      new Float32Array([...loud(1600), ...new Float32Array(3200), ...loud(1600)]),
    ],
    sampleRate: RATE,
  };
}

describe("audio trimming and splitting", () => {
  it("trims to the requested seconds at the source rate", () => {
    const trimmed = trimSignal(sine(2, 40), 0.5, 1.5);
    expect(frameCount(trimmed)).toBe(8000);
    expect(trimmed.sampleRate).toBe(RATE);
  });

  it("clamps an out-of-range trim instead of throwing", () => {
    const source = sine(1, 40);
    const trimmed = trimSignal(source, 0.8, 99);
    expect(frameCount(trimmed)).toBe(1600);
    expect(frameCount(trimmed)).toBeLessThan(frameCount(source));
  });

  it("keeps the audio between the removed ranges", () => {
    const source = loudThenQuietThenLoud();
    const withoutGap = removeRanges(source, [{ start: 0.2, end: 0.6, duration: 0.4 }]);
    expect(frameCount(withoutGap)).toBe(3200);
    expect(peakOf(withoutGap)).toBeGreaterThan(0.5);
  });

  it("splits into ordered segments that add back up", () => {
    const source = sine(2, 40);
    const parts = splitSignal(source, [0.5, 1.25]);
    expect(parts.length).toBe(3);
    expect(parts.map((part) => frameCount(part))).toEqual([4000, 6000, 6000]);
    expect(parts.reduce((sum, part) => sum + frameCount(part), 0)).toBe(frameCount(source));
  });

  it("ignores duplicate or out-of-range split markers", () => {
    const parts = splitSignal(sine(1, 40), [-5, 0.5, 0.5, 20]);
    expect(parts.length).toBe(2);
  });
});

describe("audio level operations", () => {
  it("converts decibels to linear gain both ways", () => {
    expect(dbToLinear(0)).toBeCloseTo(1, 6);
    expect(dbToLinear(-6)).toBeCloseTo(0.5012, 3);
    expect(linearToDb(1)).toBeCloseTo(0, 6);
    expect(linearToDb(0)).toBe(-120);
  });

  it("doubles amplitude at +6 dB", () => {
    const source = sine(0.25, 100, 0.3);
    const boosted = gainSignal(source, 6);
    expect(peakOf(boosted)).toBeCloseTo(peakOf(source) * 2, 2);
  });

  it("never exceeds full scale", () => {
    const loud = gainSignal(sine(0.1, 100, 0.9), 20);
    for (const channel of loud.channels) {
      for (const value of channel) expect(Math.abs(value)).toBeLessThanOrEqual(1);
    }
  });

  it("normalises the peak onto the requested dBFS", () => {
    const quiet = sine(0.5, 60, 0.05);
    const levelled = normaliseSignal(quiet, -3);
    expect(linearToDb(peakOf(levelled))).toBeCloseTo(-3, 1);
  });

  it("leaves a fully silent signal untouched rather than dividing by zero", () => {
    const silent: AudioSignal = { channels: [new Float32Array(100)], sampleRate: RATE };
    expect(peakOf(normaliseSignal(silent, -1))).toBe(0);
  });

  it("measures peak and loudness statistics", () => {
    const stats = signalStats(sine(1, 100, 0.8));
    expect(stats.channels).toBe(1);
    expect(stats.duration).toBeCloseTo(1, 3);
    expect(stats.peak).toBeCloseTo(0.8, 2);
    expect(stats.peakDb).toBeCloseTo(linearToDb(0.8), 2);
    // A sine's RMS sits about 3 dB under its peak.
    expect(stats.rmsDb).toBeLessThan(stats.peakDb);
    expect(stats.peakDb - stats.rmsDb).toBeGreaterThan(2);
    expect(stats.peakDb - stats.rmsDb).toBeLessThan(4);
  });
});

describe("audio layout and shape", () => {
  it("reverses the sample order", () => {
    const source: AudioSignal = {
      channels: [new Float32Array([1, 2, 3, 4])],
      sampleRate: RATE,
    };
    const reversed = reverseSignal(source);
    expect(Array.from(reversed.channels[0])).toEqual([4, 3, 2, 1]);
  });

  it("mixes two channels down to their average", () => {
    const mono = toMonoSignal(stereo());
    expect(mono.channels.length).toBe(1);
    expect(mono.channels[0][0]).toBeCloseTo(0, 6);
    expect(mono.channels[0][1]).toBeCloseTo(0, 6);
  });

  it("duplicates a mono source into two stereo channels", () => {
    const wide = toStereoSignal(sine(0.1, 50));
    expect(wide.channels.length).toBe(2);
    expect(Array.from(wide.channels[0])).toEqual(Array.from(wide.channels[1]));
  });

  it("fades the first and last samples to silence", () => {
    const faded = fadeSignal(sine(0.5, 200, 0.9), 100, 100);
    const channel = faded.channels[0];
    expect(Math.abs(channel[0])).toBeLessThan(0.01);
    expect(Math.abs(channel[channel.length - 1])).toBeLessThan(0.01);
    // The untouched middle still swings at full amplitude.
    let middlePeak = 0;
    for (let index = 1800; index <= 2200; index += 1) {
      middlePeak = Math.max(middlePeak, Math.abs(channel[index]));
    }
    expect(middlePeak).toBeGreaterThan(0.8);
    // And the fade really ramps: the first 100 ms is quieter than the middle.
    let fadePeak = 0;
    for (let index = 0; index < 800; index += 1) {
      fadePeak = Math.max(fadePeak, Math.abs(channel[index]));
    }
    expect(fadePeak).toBeLessThan(middlePeak);
  });
});

describe("silence detection", () => {
  it("finds the quiet gap and reports its share of the file", () => {
    const source = loudThenQuietThenLoud();
    const report = analyseSilence(source, { thresholdDb: -40, minSilenceMs: 200 });
    expect(report.intervals.length).toBe(1);
    expect(report.intervals[0].start).toBeCloseTo(0.2, 1);
    expect(report.intervals[0].end).toBeCloseTo(0.6, 1);
    expect(report.silenceRatio).toBeGreaterThan(0.3);
    expect(report.silenceRatio).toBeLessThan(0.7);
  });

  it("cuts the detected silence in one step", () => {
    const source = loudThenQuietThenLoud();
    const { signal, report } = cutSilenceSignal(source, {
      thresholdDb: -40,
      minSilenceMs: 200,
    });
    expect(report.intervals.length).toBe(1);
    expect(frameCount(signal)).toBeLessThan(frameCount(source));
    expect(peakOf(signal)).toBeGreaterThan(0.5);
  });

  it("detects nothing in continuous audio", () => {
    const report = analyseSilence(sine(1, 200, 0.7), { thresholdDb: -40, minSilenceMs: 100 });
    expect(report.intervals.length).toBe(0);
  });
});

describe("step pipeline", () => {
  it("applies steps in order", () => {
    const source = sine(2, 100, 0.4);
    const trimThenGain = applySteps(source, [
      { kind: "trim", start: 0, end: 1 },
      { kind: "gain", db: 6 },
    ]);
    const gainThenTrim = applySteps(source, [
      { kind: "gain", db: 6 },
      { kind: "trim", start: 0, end: 1 },
    ]);
    return Promise.all([trimThenGain, gainThenTrim]).then(([first, second]) => {
      expect(frameCount(first.signal)).toBe(RATE);
      expect(frameCount(second.signal)).toBe(RATE);
      expect(first.applied).toEqual(["trim", "gain"]);
      expect(second.applied).toEqual(["gain", "trim"]);
      expect(peakOf(first.signal)).toBeCloseTo(peakOf(second.signal), 3);
    });
  });

  it("refuses to pretend a filter ran without a renderer", async () => {
    await expect(
      applySteps(sine(0.2, 100), [
        { kind: "filter", type: "lowpass", frequency: 500, q: 1, gainDb: 0 },
      ]),
    ).rejects.toThrow(/filter renderer/i);
  });

  it("uses the injected renderer for filter steps", async () => {
    const fake = async (signal: AudioSignal) => gainSignal(signal, -20);
    const result = await applySteps(
      sine(0.2, 100, 0.8),
      [{ kind: "filter", type: "lowpass", frequency: 500, q: 1, gainDb: 0 }],
      fake,
    );
    expect(result.applied).toEqual(["filter"]);
    expect(peakOf(result.signal)).toBeLessThan(0.2);
  });
});

describe("WAV encoding", () => {
  it("writes a header that round-trips the format", async () => {
    const bytes = encodeWav(stereo().channels, stereo().sampleRate);
    const header = parseWavHeader(bytes);
    expect(header).not.toBeNull();
    expect(header?.channels).toBe(2);
    expect(header?.sampleRate).toBe(RATE);
    expect(header?.bitsPerSample).toBe(16);
    expect(header?.dataBytes).toBe(4 * 2 * 2);

    // The Blob wrapper carries exactly those bytes.
    const blob = encodeWavBlob(stereo());
    expect(blob.type).toBe("audio/wav");
    expect(blob.size).toBe(bytes.length);
  });

  it("produces a decodable signal when the platform can decode it", async () => {
    const blob = encodeWavBlob(sine(0.25, 100, 0.5));
    if (!audioContextAvailable()) return;
    const signal = await decodeAudioBlob(blob);
    expect(signal.sampleRate).toBe(RATE);
    expect(signal.channels.length).toBe(1);
    expect(Math.abs(frameCount(signal) - 2000)).toBeLessThanOrEqual(2);
  });
});

function audioContextAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(window.AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext)
  );
}

describe("presentation helpers", () => {
  it("builds a waveform geometry from the real samples", () => {
    const geometry = waveformGeometry(sine(1, 50, 0.6), 200);
    expect(geometry.peaks.length).toBe(400);
    expect(geometry.peak).toBeGreaterThan(0.5);
    expect(geometry.duration).toBeCloseTo(1, 3);
    expect(geometry.sampleRate).toBe(RATE);
  });

  it("never advertises an encoder the runtime cannot provide", () => {
    const support = probeAudioEncoders();
    expect(support.wav).toBe(true);
    expect(support.mp3).toBe(false);
    expect(support.aac).toBe(false);
    if (!support.webm) expect(support.webmMime).toBeNull();
  });
});
