/**
 * MediaRecorder writes WebM streams without a Duration element, which makes
 * browsers report Infinity and breaks seeking. This module patches the EBML
 * Info block with a real duration so saved clips seek and report correctly.
 */

const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_TIMECODE_SCALE = 0x2ad7b1;
const ID_DURATION = 0x4489;
const DEFAULT_TIMECODE_SCALE = 1_000_000;

interface Vint {
  value: number;
  width: number;
  unknown: boolean;
}

interface Element {
  id: number;
  idStart: number;
  idWidth: number;
  sizeStart: number;
  sizeWidth: number;
  dataStart: number;
  dataEnd: number;
  size: number | null;
}

function readVint(bytes: Uint8Array, offset: number, keepMarker: boolean): Vint {
  if (offset >= bytes.length) throw new Error("EBML: truncated variable integer.");
  const first = bytes[offset];
  if (first === 0) throw new Error("EBML: invalid variable integer.");
  let width = 1;
  let mask = 0x80;
  while (width <= 8 && (first & mask) === 0) {
    width += 1;
    mask >>= 1;
  }
  if (width > 8) throw new Error("EBML: variable integer wider than 8 bytes.");
  let value = keepMarker ? first : first & (mask - 1);
  for (let index = 1; index < width; index += 1) {
    if (offset + index >= bytes.length) {
      throw new Error("EBML: truncated variable integer.");
    }
    value = value * 256 + bytes[offset + index];
  }
  let unknown = false;
  if (!keepMarker) {
    unknown = (first & (mask - 1)) === mask - 1;
    for (let index = 1; index < width && unknown; index += 1) {
      unknown = bytes[offset + index] === 0xff;
    }
  }
  return { value, width, unknown };
}

function encodeSize(value: number): Uint8Array {
  let width = 1;
  while (width < 8 && value >= 2 ** (7 * width) - 1) width += 1;
  const out = new Uint8Array(width);
  let remaining = value;
  for (let index = width - 1; index >= 0; index -= 1) {
    out[index] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  out[0] |= 0x80 >> (width - 1);
  return out;
}

function readElement(bytes: Uint8Array, offset: number): Element {
  const id = readVint(bytes, offset, true);
  const size = readVint(bytes, offset + id.width, false);
  const dataStart = offset + id.width + size.width;
  const dataEnd = size.unknown ? bytes.length : dataStart + size.value;
  if (dataEnd > bytes.length) throw new Error("EBML: element exceeds buffer.");
  return {
    id: id.value,
    idStart: offset,
    idWidth: id.width,
    sizeStart: offset + id.width,
    sizeWidth: size.width,
    dataStart,
    dataEnd,
    size: size.unknown ? null : size.value,
  };
}

function findChild(
  bytes: Uint8Array,
  parent: Element,
  target: number,
): Element | null {
  let offset = parent.dataStart;
  while (offset < parent.dataEnd) {
    const child = readElement(bytes, offset);
    if (child.id === target) return child;
    if (child.size === null) return null;
    offset = child.dataEnd;
  }
  return null;
}

function readUint(bytes: Uint8Array, start: number, end: number): number {
  let value = 0;
  for (let index = start; index < end; index += 1) value = value * 256 + bytes[index];
  return value;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function findSegment(bytes: Uint8Array): Element | null {
  let offset = 0;
  while (offset < bytes.length) {
    const element = readElement(bytes, offset);
    if (element.id === ID_SEGMENT) return element;
    if (element.size === null) return null;
    offset = element.dataEnd;
  }
  return null;
}

function buildDurationElement(durationMs: number, timecodeScale: number): Uint8Array {
  const scaled = (durationMs * 1_000_000) / timecodeScale;
  const element = new Uint8Array(11);
  element[0] = 0x44;
  element[1] = 0x89;
  element[2] = 0x88;
  new DataView(element.buffer).setFloat64(3, scaled, false);
  return element;
}

export async function patchWebmDuration(
  blob: Blob,
  durationMs: number,
): Promise<Blob> {
  if (!/webm/i.test(blob.type) || !(durationMs > 0)) return blob;
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const segment = findSegment(bytes);
    if (!segment) return blob;
    const info = findChild(bytes, segment, ID_INFO);
    if (!info) return blob;

    const scaleElement = findChild(bytes, info, ID_TIMECODE_SCALE);
    const timecodeScale =
      scaleElement && scaleElement.size
        ? readUint(bytes, scaleElement.dataStart, scaleElement.dataEnd)
        : DEFAULT_TIMECODE_SCALE;

    const duration = findChild(bytes, info, ID_DURATION);
    if (duration && (duration.size === 4 || duration.size === 8)) {
      const scaled = (durationMs * 1_000_000) / timecodeScale;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (duration.size === 4) view.setFloat32(duration.dataStart, scaled, false);
      else view.setFloat64(duration.dataStart, scaled, false);
      return new Blob([bytes], { type: blob.type });
    }

    const durationElement = buildDurationElement(durationMs, timecodeScale);
    const infoBody = bytes.subarray(info.dataStart, info.dataEnd);
    const infoId = bytes.subarray(info.idStart, info.idStart + info.idWidth);
    const newInfoBody = concat([infoBody, durationElement]);
    const newInfoHeader = concat([infoId, encodeSize(newInfoBody.length)]);
    const newInfo = concat([newInfoHeader, newInfoBody]);
    const oldInfoLength = info.dataEnd - info.idStart;
    const delta = newInfo.length - oldInfoLength;

    let output = concat([
      bytes.subarray(0, info.idStart),
      newInfo,
      bytes.subarray(info.dataEnd),
    ]);

    if (segment.size !== null) {
      const segmentId = bytes.subarray(
        segment.idStart,
        segment.idStart + segment.idWidth,
      );
      const newSegmentHeader = concat([
        segmentId,
        encodeSize(segment.size + delta),
      ]);
      output = concat([
        output.subarray(0, segment.idStart),
        newSegmentHeader,
        output.subarray(segment.dataStart),
      ]);
    }

    return new Blob([output], { type: blob.type });
  } catch {
    return blob;
  }
}
