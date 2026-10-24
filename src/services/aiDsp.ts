/**
 * Deterministic signal and pixel algorithms for the on-device AI workspace.
 *
 * These helpers implement the tasks that do not need a neural network:
 * waveform maths, FFT analysis, classic edge detection, motion and scene
 * differencing, container sniffing and hashing support. Everything here is a
 * pure function so it can be unit tested without a DOM or a GPU.
 */

/* ------------------------------------------------------------------ audio */

/** Encodes planar float channels as a 16-bit PCM WAV file. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const channelCount = Math.max(1, channels.length);
  const frameCount = channels[0]?.length ?? 0;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const dataBytes = frameCount * blockAlign;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeText = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeText(36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const source = channels[channel]?.[frame] ?? 0;
      const clamped = Math.max(-1, Math.min(1, source));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += 2;
    }
  }

  return new Uint8Array(buffer);
}

/** Parses the header of a PCM WAV file. Returns null when it is not PCM WAV. */
export function parseWavHeader(bytes: Uint8Array): {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataBytes: number;
} | null {
  if (bytes.length < 44) return null;
  const text = (offset: number, length: number) =>
    String.fromCharCode(...bytes.slice(offset, offset + length));
  if (text(0, 4) !== "RIFF" || text(8, 4) !== "WAVE" || text(12, 4) !== "fmt ") {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  let offset = 12;
  let dataBytes = 0;
  while (offset + 8 <= bytes.length) {
    const chunkId = text(offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkId === "data") {
      dataBytes = Math.min(chunkSize, bytes.length - offset - 8);
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  return { sampleRate, channels, bitsPerSample, dataBytes };
}

export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const length = Math.min(...channels.map((channel) => channel.length));
  const mono = new Float32Array(length);
  for (let frame = 0; frame < length; frame += 1) {
    let sum = 0;
    for (const channel of channels) sum += channel[frame] ?? 0;
    mono[frame] = sum / channels.length;
  }
  return mono;
}

export function reverseChannels(channels: Float32Array[]): Float32Array[] {
  return channels.map((channel) => {
    const reversed = new Float32Array(channel.length);
    for (let index = 0; index < channel.length; index += 1) {
      reversed[index] = channel[channel.length - 1 - index];
    }
    return reversed;
  });
}

/** Linear-interpolation resampler used by the converter and pitch shifter. */
export function resampleLinear(
  samples: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate || samples.length === 0) return samples.slice();
  const ratio = toRate / fromRate;
  const length = Math.max(1, Math.round(samples.length * ratio));
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const position = index / ratio;
    const left = Math.floor(position);
    const right = Math.min(samples.length - 1, left + 1);
    const fraction = position - left;
    output[index] =
      (samples[left] ?? 0) * (1 - fraction) + (samples[right] ?? 0) * fraction;
  }
  return output;
}

export interface RmsWindow {
  time: number;
  rms: number;
  db: number;
}

export function rmsWindows(
  samples: Float32Array,
  sampleRate: number,
  windowMs: number,
): RmsWindow[] {
  const windowSize = Math.max(1, Math.round((windowMs / 1000) * sampleRate));
  const windows: RmsWindow[] = [];
  for (let offset = 0; offset + windowSize <= samples.length; offset += windowSize) {
    let sum = 0;
    for (let index = 0; index < windowSize; index += 1) {
      const value = samples[offset + index] ?? 0;
      sum += value * value;
    }
    const rms = Math.sqrt(sum / windowSize);
    windows.push({
      time: offset / sampleRate,
      rms,
      db: rms > 0 ? 20 * Math.log10(rms) : -120,
    });
  }
  return windows;
}

export interface SilenceInterval {
  start: number;
  end: number;
  duration: number;
}

export function detectSilence(
  windows: RmsWindow[],
  options: { thresholdDb: number; minSilenceMs: number },
): { intervals: SilenceInterval[]; silenceRatio: number; totalSeconds: number } {
  const intervals: SilenceInterval[] = [];
  const minSeconds = options.minSilenceMs / 1000;
  let runStart: number | null = null;
  let runEnd = 0;

  const flush = () => {
    if (runStart !== null && runEnd - runStart >= minSeconds) {
      intervals.push({ start: runStart, end: runEnd, duration: runEnd - runStart });
    }
    runStart = null;
  };

  for (const window of windows) {
    if (window.db <= options.thresholdDb) {
      if (runStart === null) runStart = window.time;
      runEnd = window.time;
    } else {
      flush();
    }
  }
  flush();

  const totalSeconds =
    windows.length > 0 ? windows[windows.length - 1].time + 1 / 1000 : 0;
  const silentSeconds = intervals.reduce((sum, interval) => sum + interval.duration, 0);
  return {
    intervals,
    silenceRatio: totalSeconds > 0 ? Math.min(1, silentSeconds / totalSeconds) : 0,
    totalSeconds,
  };
}

export interface NoiseProfile {
  durationSeconds: number;
  sampleRate: number;
  peak: number;
  peakDb: number;
  rms: number;
  rmsDb: number;
  crestDb: number;
  dcOffset: number;
  noiseFloorDb: number;
  signalToNoiseDb: number;
  clippingSamples: number;
  zeroCrossingRate: number;
  silenceRatio: number;
}

export function profileNoise(samples: Float32Array, sampleRate: number): NoiseProfile {
  const length = samples.length;
  let peak = 0;
  let sumSquares = 0;
  let sum = 0;
  let clipping = 0;
  let crossings = 0;
  for (let index = 0; index < length; index += 1) {
    const value = samples[index] ?? 0;
    const magnitude = Math.abs(value);
    if (magnitude > peak) peak = magnitude;
    sumSquares += value * value;
    sum += value;
    if (magnitude >= 0.999) clipping += 1;
    if (index > 0 && (samples[index - 1] < 0) !== (value < 0)) crossings += 1;
  }
  const rms = length > 0 ? Math.sqrt(sumSquares / length) : 0;
  const dcOffset = length > 0 ? sum / length : 0;

  const windows = rmsWindows(samples, sampleRate, 50).map((window) => window.rms);
  const sorted = windows.slice().sort((a, b) => a - b);
  const floorIndex = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.1));
  const floorRms = sorted.length > 0 ? sorted[Math.max(0, floorIndex)] : 0;

  const toDb = (value: number) => (value > 0 ? 20 * Math.log10(value) : -120);
  const noiseFloorDb = toDb(floorRms);
  const rmsDb = toDb(rms);
  const peakDb = toDb(peak);
  const silence = detectSilence(rmsWindows(samples, sampleRate, 50), {
    thresholdDb: -50,
    minSilenceMs: 100,
  });

  return {
    durationSeconds: length / sampleRate,
    sampleRate,
    peak,
    peakDb,
    rms,
    rmsDb,
    crestDb: peakDb - rmsDb,
    dcOffset,
    noiseFloorDb,
    signalToNoiseDb: rmsDb - noiseFloorDb,
    clippingSamples: clipping,
    zeroCrossingRate: length > 1 ? crossings / (length - 1) : 0,
    silenceRatio: silence.silenceRatio,
  };
}

/**
 * Granular pitch shifter.
 *
 * The input is cut into Hann-windowed grains; each output grain reads its
 * source `ratio` times faster while grains are still laid down at the original
 * hop, which shifts pitch while preserving duration. It is the classic
 * granular algorithm (as used in hardware pitch pedals), not a resampler that
 * also changes speed.
 */
export function pitchShiftGranular(
  samples: Float32Array,
  semitones: number,
): Float32Array {
  const ratio = Math.pow(2, semitones / 12);
  if (!Number.isFinite(ratio) || ratio <= 0 || Math.abs(semitones) < 0.01) {
    return samples.slice();
  }
  const grainSize = 2048;
  const hop = grainSize / 4;
  const output = new Float32Array(samples.length);
  const weight = new Float32Array(samples.length);
  const window = new Float32Array(grainSize);
  for (let index = 0; index < grainSize; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (grainSize - 1));
  }

  const sourceLength = samples.length;
  for (let outPosition = 0; outPosition < sourceLength; outPosition += hop) {
    const sourceStart = outPosition * ratio;
    const integerStart = Math.floor(sourceStart);
    const fraction = sourceStart - integerStart;
    for (let index = 0; index < grainSize; index += 1) {
      const outIndex = outPosition + index;
      if (outIndex >= sourceLength) break;
      const left = ((integerStart + index) % sourceLength + sourceLength) % sourceLength;
      const right = ((left + 1) % sourceLength + sourceLength) % sourceLength;
      const value = (samples[left] ?? 0) * (1 - fraction) + (samples[right] ?? 0) * fraction;
      output[outIndex] += value * window[index];
      weight[outIndex] += window[index];
    }
  }
  for (let index = 0; index < sourceLength; index += 1) {
    if (weight[index] > 1e-6) output[index] /= weight[index];
  }
  return output;
}

/**
 * Inverse FFT via the conjugate trick, in place.
 */
export function ifftInPlace(real: Float32Array, imaginary: Float32Array): void {
  const size = real.length;
  for (let index = 0; index < size; index += 1) imaginary[index] = -imaginary[index];
  fftInPlace(real, imaginary);
  const scale = 1 / size;
  for (let index = 0; index < size; index += 1) {
    real[index] *= scale;
    imaginary[index] = -imaginary[index] * scale;
  }
}

/**
 * Phase-vocoder time stretch.
 *
 * Each STFT frame keeps its measured magnitude and accumulates a phase that
 * advances at the true instantaneous frequency. Synthesis hops are spaced by
 * `stretch` times the analysis hop, so the signal becomes longer (or shorter)
 * without changing its pitch.
 */
export function timeStretchPhaseVocoder(
  input: Float32Array,
  stretch: number,
): Float32Array {
  const fftSize = 2048;
  const analysisHop = 512;
  if (input.length < fftSize || !Number.isFinite(stretch) || stretch <= 0) {
    return input.slice();
  }
  if (Math.abs(stretch - 1) < 0.0001) return input.slice();

  const synthesisHop = Math.max(1, Math.round(analysisHop * stretch));
  const bins = fftSize / 2;
  const frameCount = Math.max(1, Math.ceil(input.length / analysisHop));
  const outputLength = frameCount * synthesisHop + fftSize;
  const output = new Float32Array(outputLength);
  const weight = new Float32Array(outputLength);
  const window = new Float32Array(fftSize);
  for (let index = 0; index < fftSize; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (fftSize - 1));
  }

  const expected = new Float32Array(bins + 1);
  for (let bin = 0; bin <= bins; bin += 1) {
    expected[bin] = (2 * Math.PI * bin * analysisHop) / fftSize;
  }

  const previousPhase = new Float32Array(bins + 1);
  const accumulatedPhase = new Float32Array(bins + 1);
  let initialised = false;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frame * analysisHop;
    const real = new Float32Array(fftSize);
    const imaginary = new Float32Array(fftSize);
    for (let index = 0; index < fftSize; index += 1) {
      const source = start + index;
      real[index] = (source < input.length ? input[source] : 0) * window[index];
    }
    fftInPlace(real, imaginary);

    const outputReal = new Float32Array(fftSize);
    const outputImaginary = new Float32Array(fftSize);
    for (let bin = 0; bin <= bins; bin += 1) {
      const magnitude = Math.hypot(real[bin], imaginary[bin]);
      const phase = Math.atan2(imaginary[bin], real[bin]);
      if (!initialised) {
        accumulatedPhase[bin] = phase;
        previousPhase[bin] = phase;
      } else if (bin === 0 || bin === bins) {
        accumulatedPhase[bin] = phase;
        previousPhase[bin] = phase;
      } else {
        let delta = phase - previousPhase[bin] - expected[bin];
        delta -= 2 * Math.PI * Math.round(delta / (2 * Math.PI));
        const trueFrequency = expected[bin] + delta / analysisHop;
        accumulatedPhase[bin] += trueFrequency * synthesisHop;
        previousPhase[bin] = phase;
      }
      const valueReal = magnitude * Math.cos(accumulatedPhase[bin]);
      const valueImaginary = magnitude * Math.sin(accumulatedPhase[bin]);
      outputReal[bin] = valueReal;
      outputImaginary[bin] = valueImaginary;
      if (bin > 0 && bin < bins) {
        outputReal[fftSize - bin] = valueReal;
        outputImaginary[fftSize - bin] = -valueImaginary;
      }
    }
    initialised = true;
    ifftInPlace(outputReal, outputImaginary);
    const outputStart = frame * synthesisHop;
    for (let index = 0; index < fftSize; index += 1) {
      const target = outputStart + index;
      if (target >= outputLength) break;
      output[target] += outputReal[index] * window[index];
      weight[target] += window[index] * window[index];
    }
  }

  const targetLength = Math.max(1, Math.round(input.length * stretch));
  const result = new Float32Array(targetLength);
  for (let index = 0; index < targetLength; index += 1) {
    result[index] = weight[index] > 1e-6 ? output[index] / weight[index] : 0;
  }
  return result;
}

/**
 * Phase-vocoder pitch shifter: time-stretch by the pitch ratio, then resample
 * back to the original length. The resampling multiplies the pitch by the
 * ratio while restoring the original duration.
 */
export function pitchShiftPhaseVocoder(
  samples: Float32Array,
  semitones: number,
): Float32Array {
  const ratio = Math.pow(2, semitones / 12);
  if (!Number.isFinite(ratio) || ratio <= 0 || Math.abs(semitones) < 0.01) {
    return samples.slice();
  }
  const stretched = timeStretchPhaseVocoder(samples, ratio);
  return resampleLinear(stretched, ratio, 1);
}

/* -------------------------------------------------------------------- fft */

/** In-place iterative radix-2 Cooley-Tukey FFT. Length must be a power of two. */
export function fftInPlace(real: Float32Array, imaginary: Float32Array): void {
  const size = real.length;
  if (size !== imaginary.length) throw new Error("FFT buffers must be equal length.");
  if (size < 2 || (size & (size - 1)) !== 0) {
    throw new Error("FFT size must be a power of two.");
  }

  for (let index = 1, reversed = 0; index < size; index += 1) {
    let bit = size >> 1;
    for (; reversed & bit; bit >>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index < reversed) {
      const tmpReal = real[index];
      real[index] = real[reversed];
      real[reversed] = tmpReal;
      const tmpImaginary = imaginary[index];
      imaginary[index] = imaginary[reversed];
      imaginary[reversed] = tmpImaginary;
    }
  }

  for (let length = 2; length <= size; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    for (let start = 0; start < size; start += length) {
      let twiddleReal = 1;
      let twiddleImaginary = 0;
      for (let offset = 0; offset < length / 2; offset += 1) {
        const even = start + offset;
        const odd = even + length / 2;
        const oddReal =
          real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
        const oddImaginary =
          real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
        const nextReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
        twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
        twiddleReal = nextReal;
      }
    }
  }
}

/**
 * Short-time Fourier transform of a mono signal.
 * Returns one magnitude frame per hop, each holding `fftSize / 2` bins.
 */
export function spectrogram(
  samples: Float32Array,
  options: { fftSize?: number; hopSize?: number } = {},
): { bins: number; frames: Float32Array[] } {
  const fftSize = options.fftSize ?? 1024;
  const hopSize = options.hopSize ?? 256;
  const bins = fftSize / 2;
  const frames: Float32Array[] = [];
  const window = new Float32Array(fftSize);
  for (let index = 0; index < fftSize; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (fftSize - 1));
  }

  for (let start = 0; start + fftSize <= samples.length; start += hopSize) {
    const real = new Float32Array(fftSize);
    const imaginary = new Float32Array(fftSize);
    for (let index = 0; index < fftSize; index += 1) {
      real[index] = (samples[start + index] ?? 0) * window[index];
    }
    fftInPlace(real, imaginary);
    const magnitudes = new Float32Array(bins);
    for (let bin = 0; bin < bins; bin += 1) {
      magnitudes[bin] = Math.hypot(real[bin], imaginary[bin]) / (fftSize / 2);
    }
    frames.push(magnitudes);
  }
  return { bins, frames };
}

/** Maps a normalized level (0..1) to a warm spectrogram colour. */
export function spectrogramColor(value: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, value));
  if (clamped < 0.25) {
    const t = clamped / 0.25;
    return [Math.round(8 + 40 * t), Math.round(8 + 40 * t), Math.round(60 + 120 * t)];
  }
  if (clamped < 0.5) {
    const t = (clamped - 0.25) / 0.25;
    return [Math.round(48 + 120 * t), Math.round(48 + 20 * t), Math.round(180 - 60 * t)];
  }
  if (clamped < 0.75) {
    const t = (clamped - 0.5) / 0.25;
    return [Math.round(168 + 70 * t), Math.round(68 + 120 * t), Math.round(120 - 40 * t)];
  }
  const t = (clamped - 0.75) / 0.25;
  return [Math.round(238 + 17 * t), Math.round(188 + 60 * t), Math.round(80 + 140 * t)];
}

/* ------------------------------------------------------------------ pixels */

export interface GrayImage {
  width: number;
  height: number;
  data: Float32Array;
}

export function toGrayscale(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): GrayImage {
  const data = new Float32Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    data[index] =
      (0.2126 * (rgba[offset] ?? 0) +
        0.7152 * (rgba[offset + 1] ?? 0) +
        0.0722 * (rgba[offset + 2] ?? 0)) /
      255;
  }
  return { width, height, data };
}

/** Sobel gradient magnitude, returned as a 0..1 grayscale image. */
export function sobelEdges(image: GrayImage): GrayImage {
  const { width, height, data } = image;
  const output = new Float32Array(width * height);
  const at = (x: number, y: number) =>
    data[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))] ?? 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const topLeft = at(x - 1, y - 1);
      const top = at(x, y - 1);
      const topRight = at(x + 1, y - 1);
      const left = at(x - 1, y);
      const right = at(x + 1, y);
      const bottomLeft = at(x - 1, y + 1);
      const bottom = at(x, y + 1);
      const bottomRight = at(x + 1, y + 1);
      const gx =
        -topLeft - 2 * left - bottomLeft + topRight + 2 * right + bottomRight;
      const gy =
        -topLeft - 2 * top - topRight + bottomLeft + 2 * bottom + bottomRight;
      output[y * width + x] = Math.min(1, Math.hypot(gx, gy));
    }
  }
  return { width, height, data: output };
}

/** Nearest-neighbour downscale of a grayscale image (used for comparisons). */
export function downscaleGray(
  image: GrayImage,
  targetWidth: number,
  targetHeight: number,
): GrayImage {
  const output = new Float32Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor((y / targetHeight) * image.height));
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor((x / targetWidth) * image.width));
      output[y * targetWidth + x] = image.data[sourceY * image.width + sourceX] ?? 0;
    }
  }
  return { width: targetWidth, height: targetHeight, data: output };
}

export function meanAbsoluteDifference(a: GrayImage, b: GrayImage): number {
  const length = Math.min(a.data.length, b.data.length);
  if (length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < length; index += 1) {
    sum += Math.abs((a.data[index] ?? 0) - (b.data[index] ?? 0));
  }
  return sum / length;
}

export function luminanceHistogram(
  image: GrayImage,
  bins = 32,
): Float32Array {
  const histogram = new Float32Array(bins);
  for (const value of image.data) {
    const bin = Math.min(bins - 1, Math.max(0, Math.floor(value * bins)));
    histogram[bin] += 1;
  }
  const total = image.data.length || 1;
  for (let index = 0; index < bins; index += 1) histogram[index] /= total;
  return histogram;
}

/** Sum of absolute bin differences between two normalized histograms. */
export function histogramDistance(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length);
  let sum = 0;
  for (let index = 0; index < length; index += 1) {
    sum += Math.abs((a[index] ?? 0) - (b[index] ?? 0));
  }
  return sum / 2;
}

/* ------------------------------------------------------------------- bytes */

export interface ContainerInfo {
  format: string;
  mimeType: string;
  extension: string;
}

/** Sniffs a container from its magic bytes; never trusts the file name. */
export function detectContainer(bytes: Uint8Array): ContainerInfo {
  const startsWith = (...signature: number[]) =>
    signature.every((value, index) => bytes[index] === value);
  const text = (offset: number, length: number) =>
    String.fromCharCode(...Array.from(bytes.slice(offset, offset + length)));

  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return { format: "PNG image", mimeType: "image/png", extension: "png" };
  }
  if (startsWith(0xff, 0xd8, 0xff)) {
    return { format: "JPEG image", mimeType: "image/jpeg", extension: "jpg" };
  }
  if (text(0, 4) === "RIFF" && text(8, 4) === "WEBP") {
    return { format: "WebP image", mimeType: "image/webp", extension: "webp" };
  }
  if (text(0, 4) === "GIF8") {
    return { format: "GIF image", mimeType: "image/gif", extension: "gif" };
  }
  if (text(0, 4) === "RIFF" && text(8, 4) === "WAVE") {
    return { format: "WAV audio", mimeType: "audio/wav", extension: "wav" };
  }
  if (text(0, 4) === "RIFF" && text(8, 4) === "AVI ") {
    return { format: "AVI video", mimeType: "video/x-msvideo", extension: "avi" };
  }
  if (text(4, 4) === "ftyp") {
    return { format: "ISO base media (MP4/MOV/M4A)", mimeType: "video/mp4", extension: "mp4" };
  }
  if (startsWith(0x1a, 0x45, 0xdf, 0xa3)) {
    return { format: "Matroska/WebM", mimeType: "video/webm", extension: "webm" };
  }
  if (startsWith(0x4f, 0x67, 0x67, 0x53)) {
    return { format: "Ogg media", mimeType: "application/ogg", extension: "ogg" };
  }
  if (startsWith(0x49, 0x44, 0x33) || startsWith(0xff, 0xfb) || startsWith(0xff, 0xf3)) {
    return { format: "MP3 audio", mimeType: "audio/mpeg", extension: "mp3" };
  }
  if (startsWith(0x66, 0x4c, 0x61, 0x43)) {
    return { format: "FLAC audio", mimeType: "audio/flac", extension: "flac" };
  }
  if (text(0, 4) === "%PDF") {
    return { format: "PDF document", mimeType: "application/pdf", extension: "pdf" };
  }
  if (startsWith(0x50, 0x4b, 0x03, 0x04)) {
    return { format: "ZIP archive", mimeType: "application/zip", extension: "zip" };
  }
  return { format: "Unknown binary", mimeType: "application/octet-stream", extension: "bin" };
}

/** Shannon entropy of a byte buffer in bits per byte. */
export function shannonEntropy(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  const counts = new Uint32Array(256);
  for (const byte of bytes) counts[byte] += 1;
  let entropy = 0;
  for (const count of counts) {
    if (count === 0) continue;
    const probability = count / bytes.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

/** Formats bytes as lowercase hexadecimal. */
export function toHex(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}
