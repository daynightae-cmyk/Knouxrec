import { describe, expect, it } from "vitest";
import { encodeQrCode, type QrCode, type QrEcLevel } from "./qrCode";

/*
 * Independent verification of the QR encoder.
 *
 * The reader below is written from the specification again — it re-derives the
 * function-module map, reads the format information back, un-masks the data
 * region, de-interleaves the Reed-Solomon blocks and checks that every block
 * has zero syndromes before it extracts the payload. If the encoder places a
 * single bit wrongly the reader returns garbage and the test fails.
 */

type BitMatrix = boolean[][];

/* ---------------- independent GF(256) with log/antilog tables ---------------- */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function gfPow(base: number, exponent: number): number {
  if (exponent === 0) return 1;
  if (base === 0) return 0;
  return GF_EXP[(GF_LOG[base] * exponent) % 255];
}

/* ---------------- independent structural tables ---------------- */

/** [ecCodewordsPerBlock, blockCount] for versions 1..10. */
const BLOCK_TABLE: Record<QrEcLevel, Array<[number, number]>> = {
  L: [
    [7, 1],
    [10, 1],
    [15, 1],
    [20, 1],
    [26, 1],
    [18, 2],
    [20, 2],
    [24, 2],
    [30, 2],
    [18, 4],
  ],
  M: [
    [10, 1],
    [16, 1],
    [26, 1],
    [18, 2],
    [24, 2],
    [16, 4],
    [18, 4],
    [22, 4],
    [22, 5],
    [26, 5],
  ],
  Q: [
    [13, 1],
    [22, 1],
    [18, 2],
    [26, 2],
    [18, 4],
    [24, 4],
    [18, 6],
    [22, 6],
    [20, 8],
    [24, 8],
  ],
  H: [
    [17, 1],
    [28, 1],
    [22, 2],
    [16, 4],
    [22, 4],
    [28, 4],
    [26, 5],
    [26, 6],
    [24, 8],
    [28, 8],
  ],
};

const EC_FROM_BITS: Record<number, QrEcLevel> = { 0b01: "L", 0b00: "M", 0b11: "Q", 0b10: "H" };

/** Published byte-mode capacities, used to validate the block table. */
const PUBLISHED_BYTE_CAPACITY_M = [0, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213];

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  // Built forwards from 6 so the list is ascending: the first and the last
  // entry are the ones that collide with the finder patterns.
  const positions: number[] = [];
  for (let pos = 6; positions.length < count; pos += step) positions.push(pos);
  return positions;
}

/** Rebuild the map of function (non-data) modules independently. */
function functionMap(size: number, version: number): BitMatrix {
  const map: BitMatrix = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (x: number, y: number) => {
    if (x >= 0 && x < size && y >= 0 && y < size) map[y][x] = true;
  };

  // Finder patterns and their separators.
  for (let dy = 0; dy < 8; dy += 1) {
    for (let dx = 0; dx < 8; dx += 1) {
      mark(dx, dy);
      mark(size - 1 - dx, dy);
      mark(dx, size - 1 - dy);
    }
  }
  // Timing patterns.
  for (let i = 0; i < size; i += 1) {
    mark(i, 6);
    mark(6, i);
  }
  // Format information areas plus the dark module.
  for (let i = 0; i <= 8; i += 1) {
    mark(8, i);
    mark(i, 8);
  }
  for (let i = 0; i < 8; i += 1) {
    mark(size - 1 - i, 8);
    mark(8, size - 1 - i);
  }
  // Version information (versions 7 and up).
  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      mark(a, b);
      mark(b, a);
    }
  }
  // Alignment patterns.
  const positions = alignmentPositions(version);
  const last = positions.length - 1;
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = 0; j < positions.length; j += 1) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          mark(positions[i] + dx, positions[j] + dy);
        }
      }
    }
  }
  return map;
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

interface Decoded {
  text: string;
  ecLevel: QrEcLevel;
  mask: number;
  version: number;
  syndromesClean: boolean;
}

function decodeQrCode(code: QrCode): Decoded {
  const size = code.size;
  const version = (size - 17) / 4;

  // --- read the format information back ---
  const formatPositions: Array<[number, number]> = [];
  for (let i = 0; i <= 5; i += 1) formatPositions.push([8, i]);
  formatPositions.push([8, 7]);
  formatPositions.push([8, 8]);
  formatPositions.push([7, 8]);
  for (let i = 9; i < 15; i += 1) formatPositions.push([14 - i, 8]);

  let rawFormat = 0;
  formatPositions.forEach(([x, y], index) => {
    if (code.modules[y][x]) rawFormat |= 1 << index;
  });
  const unmasked = rawFormat ^ 0x5412;
  const formatData = unmasked >>> 10;
  let remainder = formatData;
  for (let i = 0; i < 10; i += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  }
  if (remainder !== (unmasked & 0x3ff)) {
    throw new Error("Format information failed its BCH check.");
  }
  const ecLevel = EC_FROM_BITS[(formatData >>> 3) & 0b11];
  const mask = formatData & 0b111;

  // --- un-mask and read the codewords ---
  const map = functionMap(size, version);
  const bits: number[] = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical += 1) {
      for (let column = 0; column < 2; column += 1) {
        const x = right - column;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (map[y][x]) continue;
        let dark = code.modules[y][x];
        if (maskApplies(mask, x, y)) dark = !dark;
        bits.push(dark ? 1 : 0);
      }
    }
  }

  const codewords: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }

  // --- de-interleave into blocks ---
  const [eccLength, blockCount] = BLOCK_TABLE[ecLevel][version - 1];
  const rawCodewords = codewords.length;
  const shortBlockCount = blockCount - (rawCodewords % blockCount);
  const shortBlockLength = Math.floor(rawCodewords / blockCount);

  const blockData: number[][] = Array.from({ length: blockCount }, () => []);
  const blockEcc: number[][] = Array.from({ length: blockCount }, () => []);
  let cursor = 0;
  for (let i = 0; i < shortBlockLength - eccLength + 1; i += 1) {
    for (let block = 0; block < blockCount; block += 1) {
      const dataLength = shortBlockLength - eccLength + (block < shortBlockCount ? 0 : 1);
      if (i < dataLength) {
        blockData[block].push(codewords[cursor]);
        cursor += 1;
      }
    }
  }
  for (let i = 0; i < eccLength; i += 1) {
    for (let block = 0; block < blockCount; block += 1) {
      blockEcc[block].push(codewords[cursor]);
      cursor += 1;
    }
  }

  // --- every Reed-Solomon block must have zero syndromes ---
  let syndromesClean = true;
  for (let block = 0; block < blockCount; block += 1) {
    const full = [...blockData[block], ...blockEcc[block]];
    for (let i = 0; i < eccLength; i += 1) {
      let syndrome = 0;
      for (const coefficient of full) {
        syndrome = gfMul(syndrome, gfPow(2, i)) ^ coefficient;
      }
      if (syndrome !== 0) syndromesClean = false;
    }
  }

  // --- concatenate the data codewords back in block order ---
  // The symbol stores the blocks interleaved; the original message is the
  // blocks concatenated one after the other.
  const dataBytes: number[] = [];
  for (const block of blockData) {
    for (const byte of block) dataBytes.push(byte);
  }

  // --- parse the bit stream (byte mode) ---
  const stream: number[] = [];
  for (const byte of dataBytes) {
    for (let bit = 7; bit >= 0; bit -= 1) stream.push((byte >>> bit) & 1);
  }
  let pointer = 0;
  const readBits = (count: number): number => {
    let value = 0;
    for (let i = 0; i < count; i += 1) {
      value = (value << 1) | (stream[pointer] ?? 0);
      pointer += 1;
    }
    return value;
  };
  const mode = readBits(4);
  if (mode !== 0b0100) throw new Error(`Unexpected QR mode 0b${mode.toString(2)}.`);
  const countBits = version <= 9 ? 8 : 16;
  const length = readBits(countBits);
  const payload = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) payload[i] = readBits(8);

  return {
    text: new TextDecoder().decode(payload),
    ecLevel,
    mask,
    version,
    syndromesClean,
  };
}

describe("QR encoder", () => {
  it("produces the expected geometry for a short payload", () => {
    const code = encodeQrCode("KNOUX");
    expect(code.version).toBe(1);
    expect(code.size).toBe(21);
    expect(code.ecLevel).toBe("M");
    expect(code.byteLength).toBe(5);
  });

  it("draws the finder, timing and dark-module patterns", () => {
    const code = encodeQrCode("https://knoux.app");
    const isDark = (x: number, y: number) => code.modules[y][x];

    // Finder pattern corners: a 7x7 block with a dark 3x3 core.
    expect(isDark(0, 0)).toBe(true);
    expect(isDark(3, 3)).toBe(true);
    expect(isDark(1, 1)).toBe(false);
    expect(isDark(20, 0)).toBe(true);
    expect(isDark(0, 20)).toBe(true);
    // The separator ring around each finder is light.
    expect(isDark(7, 0)).toBe(false);
    expect(isDark(0, 7)).toBe(false);
    // The bottom-right corner carries no finder, only payload modules.
    expect(code.modules[19][19]).toBeDefined();

    // Timing pattern alternates around row 6.
    for (let i = 8; i < code.size - 8; i += 1) {
      expect(isDark(i, 6)).toBe(i % 2 === 0);
      expect(isDark(6, i)).toBe(i % 2 === 0);
    }

    // Dark module.
    expect(isDark(8, code.size - 8)).toBe(true);
  });

  it("round-trips ASCII payloads through an independent reader", () => {
    const payloads = [
      "KNOUX",
      "https://knoux.app/library",
      "1234567890",
      "The quick brown fox jumps over the lazy dog.",
    ];
    for (const payload of payloads) {
      const code = encodeQrCode(payload);
      const decoded = decodeQrCode(code);
      expect(decoded.text).toBe(payload);
      expect(decoded.version).toBe(code.version);
      expect(decoded.ecLevel).toBe(code.ecLevel);
      expect(decoded.mask).toBe(code.mask);
      expect(decoded.syndromesClean).toBe(true);
    }
  });

  it("round-trips UTF-8 Arabic payloads", () => {
    const payload = "مرحبا بك في KNOUX REC — تسجيل الشاشة";
    const code = encodeQrCode(payload);
    const decoded = decodeQrCode(code);
    expect(decoded.text).toBe(payload);
    expect(decoded.syndromesClean).toBe(true);
  });

  it("round-trips at every error-correction level", () => {
    const payload = "KNOUX REC error correction levels";
    for (const ecLevel of ["L", "M", "Q", "H"] as QrEcLevel[]) {
      const code = encodeQrCode(payload, { ecLevel });
      const decoded = decodeQrCode(code);
      expect(decoded.text).toBe(payload);
      expect(decoded.ecLevel).toBe(ecLevel);
      expect(decoded.syndromesClean).toBe(true);
    }
  });

  it("grows the version for long payloads and still decodes", () => {
    const payload = "A".repeat(180);
    const code = encodeQrCode(payload);
    expect(code.version).toBeGreaterThan(1);
    const decoded = decodeQrCode(code);
    expect(decoded.text).toBe(payload);
    expect(decoded.syndromesClean).toBe(true);
  });

  it("rejects payloads that cannot fit", () => {
    expect(() => encodeQrCode("x".repeat(400), { maxVersion: 5 })).toThrow(/does not fit/);
  });

  it("matches the published byte-mode capacities", () => {
    for (let version = 1; version <= 10; version += 1) {
      const [eccLength, blockCount] = BLOCK_TABLE.M[version - 1];
      let raw = (16 * version + 128) * version + 64;
      if (version >= 2) {
        const alignmentCount = Math.floor(version / 7) + 2;
        raw -= (25 * alignmentCount - 10) * alignmentCount - 55;
        if (version >= 7) raw -= 36;
      }
      const total = Math.floor(raw / 8);
      const dataCodewords = total - eccLength * blockCount;
      const countBits = version <= 9 ? 8 : 16;
      const capacity = Math.floor((dataCodewords * 8 - 4 - countBits) / 8);
      expect(capacity).toBe(PUBLISHED_BYTE_CAPACITY_M[version]);
    }
  });
});
