/**
 * Real QR Code encoder — byte mode, versions 1..10, EC levels L/M/Q/H.
 *
 * The previous implementation in `services/toolboxService.ts` painted a
 * decorative grid that was not a QR Code at all: it had no finder patterns, no
 * timing pattern, no format information and no error correction, so no scanner
 * could ever read it. This module implements ISO/IEC 18004 properly:
 *
 *  - byte-mode data encoding with the correct character-count indicator width,
 *  - Reed-Solomon error correction over GF(256) with the 0x11D primitive
 *    polynomial, block splitting and interleaving,
 *  - function patterns (finder + separator, timing, alignment, dark module),
 *  - the eight data masks with penalty scoring,
 *  - BCH-protected format information and version information.
 *
 * The output is a plain boolean matrix so it can be verified without a canvas
 * (see `qrCode.test.ts`, which decodes the matrix with an independent reader).
 */

export type QrEcLevel = "L" | "M" | "Q" | "H";

export interface QrCodeOptions {
  ecLevel?: QrEcLevel;
  minVersion?: number;
  maxVersion?: number;
}

export interface QrCode {
  /** QR version (1..10). */
  version: number;
  ecLevel: QrEcLevel;
  /** Chosen data mask (0..7). */
  mask: number;
  /** Modules per side, excluding the quiet zone. */
  size: number;
  /** `modules[row][column]`; `true` is a dark module. */
  modules: boolean[][];
  /** Number of data codewords in the symbol. */
  dataCodewords: number;
  /** Error-correction codewords per block. */
  ecCodewordsPerBlock: number;
  /** Number of error-correction blocks. */
  blockCount: number;
  /** Payload bytes that were encoded. */
  byteLength: number;
}

export const QR_MIN_VERSION = 1;
export const QR_MAX_VERSION = 10;

/** Error-correction codewords per block, indexed by [level][version]. */
const ECC_CODEWORDS_PER_BLOCK: Record<QrEcLevel, number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28],
};

/** Number of error-correction blocks, indexed by [level][version]. */
const NUM_EC_BLOCKS: Record<QrEcLevel, number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8],
};

/** 2-bit level indicator used inside the format information. */
const EC_LEVEL_BITS: Record<QrEcLevel, number> = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

/* ------------------------------------------------------------------ */
/* GF(256) arithmetic                                                  */
/* ------------------------------------------------------------------ */

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/** Generator polynomial for `degree` error-correction codewords. */
function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

/** Remainder of `data` divided by `divisor` — the error-correction codewords. */
function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = divisor.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() ?? 0);
    result.push(0);
    divisor.forEach((coefficient, index) => {
      result[index] ^= gfMultiply(coefficient, factor);
    });
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Version geometry                                                    */
/* ------------------------------------------------------------------ */

function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const alignmentCount = Math.floor(version / 7) + 2;
    result -= (25 * alignmentCount - 10) * alignmentCount - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function totalCodewords(version: number): number {
  return Math.floor(rawDataModules(version) / 8);
}

function dataCodewords(version: number, ecLevel: QrEcLevel): number {
  const blocks = NUM_EC_BLOCKS[ecLevel][version];
  const ecc = ECC_CODEWORDS_PER_BLOCK[ecLevel][version];
  return totalCodewords(version) - blocks * ecc;
}

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let pos = version * 4 + 10; result.length < count; pos -= step) {
    result.splice(1, 0, pos);
  }
  return result;
}

function characterCountBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

/* ------------------------------------------------------------------ */
/* Bit buffer                                                          */
/* ------------------------------------------------------------------ */

class BitBuffer {
  private bits: number[] = [];

  append(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) {
      this.bits.push((value >>> i) & 1);
    }
  }

  get length(): number {
    return this.bits.length;
  }

  toBytes(): number[] {
    const bytes: number[] = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j += 1) {
        byte = (byte << 1) | (this.bits[i + j] ?? 0);
      }
      bytes.push(byte & 0xff);
    }
    return bytes;
  }
}

/* ------------------------------------------------------------------ */
/* Encoder                                                             */
/* ------------------------------------------------------------------ */

function chooseVersion(
  byteLength: number,
  ecLevel: QrEcLevel,
  minVersion: number,
  maxVersion: number,
): number {
  for (let version = minVersion; version <= maxVersion; version += 1) {
    const capacityBits = dataCodewords(version, ecLevel) * 8;
    const requiredBits = 4 + characterCountBits(version) + byteLength * 8;
    if (requiredBits <= capacityBits) return version;
  }
  throw new Error(
    `The payload needs ${byteLength} bytes which does not fit into a version ${maxVersion} QR code at error-correction level ${ecLevel}.`,
  );
}

function buildDataCodewords(
  bytes: number[],
  version: number,
  ecLevel: QrEcLevel,
): number[] {
  const capacity = dataCodewords(version, ecLevel);
  const buffer = new BitBuffer();
  buffer.append(0b0100, 4); // byte mode
  buffer.append(bytes.length, characterCountBits(version));
  for (const byte of bytes) buffer.append(byte, 8);

  const capacityBits = capacity * 8;
  buffer.append(0, Math.min(4, capacityBits - buffer.length)); // terminator
  while (buffer.length % 8 !== 0) buffer.append(0, 1); // pad to byte boundary

  const data = buffer.toBytes();
  const padBytes = [0xec, 0x11];
  let padIndex = 0;
  while (data.length < capacity) {
    data.push(padBytes[padIndex % 2]);
    padIndex += 1;
  }
  return data;
}

/** Split into blocks, add error correction, and interleave. */
function interleave(data: number[], version: number, ecLevel: QrEcLevel): number[] {
  const blockCount = NUM_EC_BLOCKS[ecLevel][version];
  const eccLength = ECC_CODEWORDS_PER_BLOCK[ecLevel][version];
  const rawCodewords = totalCodewords(version);

  const shortBlockCount = blockCount - (rawCodewords % blockCount);
  const shortBlockLength = Math.floor(rawCodewords / blockCount);

  const blocks: { data: number[]; ecc: number[] }[] = [];
  const divisor = rsDivisor(eccLength);
  let offset = 0;
  for (let index = 0; index < blockCount; index += 1) {
    const dataLength =
      shortBlockLength - eccLength + (index < shortBlockCount ? 0 : 1);
    const chunk = data.slice(offset, offset + dataLength);
    offset += dataLength;
    blocks.push({ data: chunk, ecc: rsRemainder(chunk, divisor) });
  }

  const result: number[] = [];
  for (let i = 0; i < shortBlockLength - eccLength + 1; i += 1) {
    for (const block of blocks) {
      if (i < block.data.length) result.push(block.data[i]);
    }
  }
  for (let i = 0; i < eccLength; i += 1) {
    for (const block of blocks) {
      result.push(block.ecc[i]);
    }
  }
  return result;
}

interface QrGrid {
  size: number;
  modules: boolean[][];
  isFunction: boolean[][];
}

function createGrid(size: number): QrGrid {
  const modules: boolean[][] = [];
  const isFunction: boolean[][] = [];
  for (let y = 0; y < size; y += 1) {
    modules.push(new Array<boolean>(size).fill(false));
    isFunction.push(new Array<boolean>(size).fill(false));
  }
  return { size, modules, isFunction };
}

function setFunctionModule(grid: QrGrid, x: number, y: number, dark: boolean): void {
  grid.modules[y][x] = dark;
  grid.isFunction[y][x] = true;
}

function drawFinder(grid: QrGrid, centerX: number, centerY: number): void {
  const { size } = grid;
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const x = centerX + dx;
      const y = centerY + dy;
      if (x < 0 || x >= size || y < 0 || y >= size) continue;
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      // distance 0,1,3 are dark; distance 2 is the light ring; 4 is the separator
      setFunctionModule(grid, x, y, distance !== 2 && distance !== 4);
    }
  }
}

function drawAlignment(grid: QrGrid, centerX: number, centerY: number): void {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      setFunctionModule(
        grid,
        centerX + dx,
        centerY + dy,
        Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
      );
    }
  }
}

/**
 * Reserve the format-information area so the data placement never writes
 * payload bits into it. The module values are written later by
 * `drawFormatInformation`; (8, 6) and (6, 8) stay timing modules.
 */
function reserveFormatAreas(grid: QrGrid): void {
  const { size } = grid;
  const mark = (x: number, y: number) => {
    grid.isFunction[y][x] = true;
  };
  for (let i = 0; i <= 5; i += 1) mark(8, i);
  mark(8, 7);
  mark(8, 8);
  mark(7, 8);
  for (let i = 9; i < 15; i += 1) mark(14 - i, 8);
  for (let i = 0; i < 8; i += 1) mark(size - 1 - i, 8);
  for (let i = 8; i < 15; i += 1) mark(8, size - 15 + i);
  mark(8, size - 8);
}

/** Reserve the version-information area (versions 7 and up). */
function reserveVersionAreas(grid: QrGrid, version: number): void {
  if (version < 7) return;
  const { size } = grid;
  for (let i = 0; i < 18; i += 1) {
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    grid.isFunction[b][a] = true;
    grid.isFunction[a][b] = true;
  }
}

function drawFunctionPatterns(grid: QrGrid, version: number): void {
  const { size } = grid;

  // Timing patterns.
  for (let i = 8; i < size - 8; i += 1) {
    const dark = i % 2 === 0;
    setFunctionModule(grid, i, 6, dark);
    setFunctionModule(grid, 6, i, dark);
  }

  // Finder patterns with separators.
  drawFinder(grid, 3, 3);
  drawFinder(grid, size - 4, 3);
  drawFinder(grid, 3, size - 4);

  // Alignment patterns (skipping the three that collide with the finders).
  const positions = alignmentPositions(version);
  const last = positions.length - 1;
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = 0; j < positions.length; j += 1) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) {
        continue;
      }
      drawAlignment(grid, positions[i], positions[j]);
    }
  }

  // The dark module is always set.
  setFunctionModule(grid, 8, size - 8, true);

  // Reserved areas: format information and version information.
  reserveFormatAreas(grid);
  reserveVersionAreas(grid, version);
}

function drawCodewords(grid: QrGrid, data: number[]): void {
  const { size } = grid;
  let bitIndex = 0;
  const totalBits = data.length * 8;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing pattern column
    for (let vertical = 0; vertical < size; vertical += 1) {
      for (let column = 0; column < 2; column += 1) {
        const x = right - column;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (grid.isFunction[y][x]) continue;
        if (bitIndex < totalBits) {
          const byte = data[bitIndex >>> 3];
          grid.modules[y][x] = ((byte >>> (7 - (bitIndex & 7))) & 1) === 1;
          bitIndex += 1;
        }
        // Remaining modules stay light (padding).
      }
    }
  }
}

function maskApplies(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function applyMask(grid: QrGrid, mask: number): void {
  const { size, modules, isFunction } = grid;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (isFunction[y][x]) continue;
      if (maskApplies(mask, x, y)) modules[y][x] = !modules[y][x];
    }
  }
}

/**
 * Penalty score used to pick the mask. The rules follow ISO/IEC 18004:
 * runs of five or more modules, 2x2 blocks of the same colour, finder-like
 * 1:1:3:1:1 patterns and the dark/light balance.
 */
function penaltyScore(grid: QrGrid): number {
  const { size, modules } = grid;
  let score = 0;

  const runPatternA = [true, false, true, true, true, false, true, false, false, false, false];
  const runPatternB = [false, false, false, false, true, false, true, true, true, false, true];

  const matches = (
    get: (index: number) => boolean,
    start: number,
    pattern: boolean[],
  ): boolean => {
    for (let i = 0; i < pattern.length; i += 1) {
      if (get(start + i) !== pattern[i]) return false;
    }
    return true;
  };

  for (let y = 0; y < size; y += 1) {
    // Rule 1 — horizontal runs of five or more identical modules.
    let runColor = modules[y][0];
    let runLength = 1;
    for (let x = 1; x < size; x += 1) {
      if (modules[y][x] === runColor) {
        runLength += 1;
      } else {
        if (runLength >= 5) score += 3 + (runLength - 5);
        runColor = modules[y][x];
        runLength = 1;
      }
    }
    if (runLength >= 5) score += 3 + (runLength - 5);

    // Rule 3 — finder-like patterns in a row.
    for (let x = 0; x + 11 <= size; x += 1) {
      const get = (index: number) => modules[y][index];
      if (matches(get, x, runPatternA) || matches(get, x, runPatternB)) score += 40;
    }
  }

  for (let x = 0; x < size; x += 1) {
    let runColor = modules[0][x];
    let runLength = 1;
    for (let y = 1; y < size; y += 1) {
      if (modules[y][x] === runColor) {
        runLength += 1;
      } else {
        if (runLength >= 5) score += 3 + (runLength - 5);
        runColor = modules[y][x];
        runLength = 1;
      }
    }
    if (runLength >= 5) score += 3 + (runLength - 5);

    for (let y = 0; y + 11 <= size; y += 1) {
      const get = (index: number) => modules[index][x];
      if (matches(get, y, runPatternA) || matches(get, y, runPatternB)) score += 40;
    }
  }

  // Rule 2 — 2x2 blocks of the same colour.
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const color = modules[y][x];
      if (
        color === modules[y][x + 1] &&
        color === modules[y + 1][x] &&
        color === modules[y + 1][x + 1]
      ) {
        score += 3;
      }
    }
  }

  // Rule 4 — deviation from a 50/50 dark/light balance.
  let dark = 0;
  for (const row of modules) {
    for (const module of row) {
      if (module) dark += 1;
    }
  }
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  score += k * 10;

  return score;
}

/** BCH(15,5) protected format information. */
function formatBits(ecLevel: QrEcLevel, mask: number): number {
  const data = (EC_LEVEL_BITS[ecLevel] << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  }
  return ((data << 10) | remainder) ^ 0x5412;
}

/** BCH(18,6) protected version information (versions 7 and up). */
function versionBits(version: number): number {
  let remainder = version;
  for (let i = 0; i < 12; i += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  }
  return (version << 12) | remainder;
}

function drawFormatInformation(grid: QrGrid, ecLevel: QrEcLevel, mask: number): void {
  const { size } = grid;
  const bits = formatBits(ecLevel, mask);
  const bit = (index: number) => ((bits >>> index) & 1) === 1;

  // First copy, around the top-left finder.
  for (let i = 0; i <= 5; i += 1) setFunctionModule(grid, 8, i, bit(i));
  setFunctionModule(grid, 8, 7, bit(6));
  setFunctionModule(grid, 8, 8, bit(7));
  setFunctionModule(grid, 7, 8, bit(8));
  for (let i = 9; i < 15; i += 1) setFunctionModule(grid, 14 - i, 8, bit(i));

  // Second copy, split between the other two finders.
  for (let i = 0; i < 8; i += 1) setFunctionModule(grid, size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i += 1) setFunctionModule(grid, 8, size - 15 + i, bit(i));
  setFunctionModule(grid, 8, size - 8, true);
}

function drawVersionInformation(grid: QrGrid, version: number): void {
  if (version < 7) return;
  const { size } = grid;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i += 1) {
    const dark = ((bits >>> i) & 1) === 1;
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFunctionModule(grid, a, b, dark);
    setFunctionModule(grid, b, a, dark);
  }
}

function cloneGrid(grid: QrGrid): QrGrid {
  return {
    size: grid.size,
    modules: grid.modules.map((row) => [...row]),
    isFunction: grid.isFunction.map((row) => [...row]),
  };
}

/**
 * Encode `text` into a QR Code matrix.
 *
 * @throws when the payload does not fit into the requested version range.
 */
export function encodeQrCode(text: string, options: QrCodeOptions = {}): QrCode {
  const ecLevel = options.ecLevel ?? "M";
  const minVersion = Math.max(QR_MIN_VERSION, options.minVersion ?? QR_MIN_VERSION);
  const maxVersion = Math.min(QR_MAX_VERSION, options.maxVersion ?? QR_MAX_VERSION);
  if (minVersion > maxVersion) {
    throw new Error("The requested QR version range is empty.");
  }

  const bytes = Array.from(new TextEncoder().encode(text));
  const version = chooseVersion(bytes.length, ecLevel, minVersion, maxVersion);

  const data = buildDataCodewords(bytes, version, ecLevel);
  const interleaved = interleave(data, version, ecLevel);

  const size = version * 4 + 17;
  const base = createGrid(size);
  drawFunctionPatterns(base, version);
  drawCodewords(base, interleaved);

  let bestMask = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = cloneGrid(base);
    applyMask(candidate, mask);
    const score = penaltyScore(candidate);
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
    }
  }

  applyMask(base, bestMask);
  drawFormatInformation(base, ecLevel, bestMask);
  drawVersionInformation(base, version);

  return {
    version,
    ecLevel,
    mask: bestMask,
    size,
    modules: base.modules,
    dataCodewords: dataCodewords(version, ecLevel),
    ecCodewordsPerBlock: ECC_CODEWORDS_PER_BLOCK[ecLevel][version],
    blockCount: NUM_EC_BLOCKS[ecLevel][version],
    byteLength: bytes.length,
  };
}

/**
 * Render a QR matrix into a canvas-like target. The caller supplies the
 * drawing surface so this module stays free of DOM dependencies.
 */
export function drawQrCode(
  code: QrCode,
  target: {
    fillStyle: string | CanvasGradient | CanvasPattern;
    fillRect: (x: number, y: number, width: number, height: number) => void;
  },
  options: { moduleSize?: number; margin?: number; dark?: string; light?: string } = {},
): { size: number; moduleSize: number; margin: number } {
  const moduleSize = options.moduleSize ?? 6;
  const margin = options.margin ?? 4;
  const dark = options.dark ?? "#000000";
  const light = options.light ?? "#ffffff";
  const total = (code.size + margin * 2) * moduleSize;

  target.fillStyle = light;
  target.fillRect(0, 0, total, total);
  target.fillStyle = dark;
  for (let y = 0; y < code.size; y += 1) {
    for (let x = 0; x < code.size; x += 1) {
      if (!code.modules[y][x]) continue;
      target.fillRect((x + margin) * moduleSize, (y + margin) * moduleSize, moduleSize, moduleSize);
    }
  }
  return { size: total, moduleSize, margin };
}
