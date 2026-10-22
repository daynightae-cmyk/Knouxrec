import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = process.cwd();
const BUILD_DIR = path.join(ROOT, "knoux-rec-app", "build");
const ICO_PATH = path.join(BUILD_DIR, "icon.ico");
const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const MASTER = 512;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function segmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function roundRectDistance(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - halfW + radius;
  const qy = Math.abs(py - cy) - halfH + radius;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function renderMaster() {
  const data = Buffer.alloc(MASTER * MASTER * 4);
  const scale = MASTER / 128;
  const surfaceTop = [0x1b, 0x1b, 0x22];
  const surfaceBottom = [0x08, 0x08, 0x0b];
  const accentTop = [0xff, 0xe8, 0x66];
  const accentBottom = [0xff, 0xc4, 0x00];

  for (let y = 0; y < MASTER; y += 1) {
    for (let x = 0; x < MASTER; x += 1) {
      const px = (x + 0.5) / scale;
      const py = (y + 0.5) / scale;
      const index = (y * MASTER + x) * 4;

      const rect = roundRectDistance(px, py, 64, 64, 60, 60, 30);
      if (rect > 0) continue;

      let color = mix(surfaceTop, surfaceBottom, Math.min(1, (px + py) / 256));
      const vertical = Math.min(1, Math.max(0, (py - 30) / 68));
      const accent = mix(accentTop, accentBottom, vertical);

      if (rect > -2) {
        color = [0x2a, 0x2a, 0x33];
      } else if (segmentDistance(px, py, 38, 32, 38, 96) <= 6) {
        color = [0xf5, 0xf5, 0xf7];
      } else if (
        segmentDistance(px, py, 40, 66, 74, 32) <= 6 ||
        segmentDistance(px, py, 40, 62, 78, 96) <= 6
      ) {
        color = accent;
      } else if (Math.hypot(px - 92, py - 88) <= 10) {
        color = [0xff, 0x4d, 0x5e];
      }

      data[index] = color[0];
      data[index + 1] = color[1];
      data[index + 2] = color[2];
      data[index + 3] = 255;
    }
  }
  return { data, size: MASTER };
}

function downsample(source, sourceSize, targetSize) {
  const output = Buffer.alloc(targetSize * targetSize * 4);
  const ratio = sourceSize / targetSize;
  for (let y = 0; y < targetSize; y += 1) {
    for (let x = 0; x < targetSize; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;
      const startY = Math.floor(y * ratio);
      const endY = Math.max(startY + 1, Math.floor((y + 1) * ratio));
      const startX = Math.floor(x * ratio);
      const endX = Math.max(startX + 1, Math.floor((x + 1) * ratio));
      for (let sy = startY; sy < endY; sy += 1) {
        for (let sx = startX; sx < endX; sx += 1) {
          const index = (sy * sourceSize + sx) * 4;
          const alpha = source[index + 3];
          r += source[index] * alpha;
          g += source[index + 1] * alpha;
          b += source[index + 2] * alpha;
          a += alpha;
          count += 1;
        }
      }
      const index = (y * targetSize + x) * 4;
      if (a > 0) {
        output[index] = Math.round(r / a);
        output[index + 1] = Math.round(g / a);
        output[index + 2] = Math.round(b / a);
      }
      output[index + 3] = Math.round(a / count);
    }
  }
  return output;
}

function pngToIco(pngBuffers) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngBuffers.length, 4);

  let offset = 6 + pngBuffers.length * 16;
  const entries = [];
  for (let i = 0; i < pngBuffers.length; i += 1) {
    const png = pngBuffers[i];
    const size = SIZES[i];
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }

  return Buffer.concat([header, ...entries, ...pngBuffers]);
}

async function main() {
  await mkdir(BUILD_DIR, { recursive: true });
  const master = renderMaster();
  const pngs = SIZES.map((size) => {
    const pixels =
      size === MASTER
        ? master.data
        : downsample(master.data, master.size, size);
    return encodePng(size, size, pixels);
  });
  const ico = pngToIco(pngs);
  await writeFile(ICO_PATH, ico);
  console.log(
    `Wrote ${ICO_PATH} (${ico.length} bytes, ${SIZES.length} sizes, PNG-compressed)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
