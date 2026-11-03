#!/usr/bin/env node
/**
 * Independent WebM inspector.
 *
 * The hardware harness measures a capture by decoding it inside the app that
 * produced it, which is one place a bug could hide. This reads the EBML tree
 * straight out of the file's bytes and reports the coded frame size, the
 * declared play duration and the track codec — so "the region file is 1533x693"
 * can be checked without trusting the recorder, the harness, or a browser.
 *
 * Usage: node scripts/webm-inspect.mjs artifacts/hardware-acceptance/*.webm
 */

import fs from "node:fs";

/** EBML element ids this inspector cares about. */
const IDS = {
  Segment: 0x18538067,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Duration: 0x4489,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  CodecID: 0x86,
  Video: 0x1712b9aa,
  PixelWidth: 0xb0,
  // Chromium's WebM writer emits 0xBA where the Matroska specification names
  // PixelHeight 0xB8 — the bytes are unambiguous either way: the element after
  // PixelWidth carries the height, and it is what the decoded frame size must
  // agree with. Both ids are accepted.
  PixelHeightA: 0xb8,
  PixelHeightB: 0xba,
  DisplayWidth: 0x54b0,
  DisplayHeight: 0x54ba,
};

function readVint(buffer, offset) {
  if (offset >= buffer.length) return null;
  const first = buffer[offset];
  for (let length = 1; length <= 8; length += 1) {
    if (first & (0x80 >> (length - 1))) {
      if (offset + length > buffer.length) return null;
      let value = first & (0xff >> length);
      for (let i = 1; i < length; i += 1) value = value * 256 + buffer[offset + i];
      return { value, size: length };
    }
  }
  return null;
}

function readElementId(buffer, offset) {
  if (offset >= buffer.length) return null;
  const first = buffer[offset];
  for (let length = 1; length <= 4; length += 1) {
    if (first & (0x80 >> (length - 1))) {
      if (offset + length > buffer.length) return null;
      // Unlike a size integer, an element ID keeps its length-marker bits:
      // PixelWidth is 0xB0, not 0x30. Masking them off, as the first version of
      // this walker did, made every element unreadable.
      let value = first;
      for (let i = 1; i < length; i += 1) value = value * 256 + buffer[offset + i];
      return { value, size: length };
    }
  }
  return null;
}

function unsigned(buffer, offset, size) {
  let value = 0;
  for (let i = 0; i < size; i += 1) value = value * 256 + buffer[offset + i];
  return value;
}

function float(buffer, offset, size) {
  // EBML floats are big-endian. The first version of this read reversed the
  // bytes first and then read them as big-endian, which silently produced a
  // duration of zero for every file.
  if (size === 4) return buffer.readFloatBE(offset);
  if (size === 8) return buffer.readDoubleBE(offset);
  return null;
}

/** Master elements: only these are descended into. Everything else is skipped. */
const MASTERS = new Set([
  IDS.Segment,
  IDS.Info,
  IDS.Tracks,
  IDS.TrackEntry,
  IDS.Video,
  // Matroska spells the video sub-element 0xE0 and the audio sub-element 0xE1.
  // 0x1712B9AA is the legacy TrackVideo id some muxers emit instead, so both are
  // accepted — Chromium's WebM writer uses 0xE0.
  0xe0,
  0xe1,
  IDS.Operations,
]);

function inspect(file) {
  const buffer = fs.readFileSync(file);
  const result = {
    file,
    bytes: buffer.length,
    container: buffer.subarray(0, 4).toString("hex") === "1a45dfa3" ? "EBML/Matroska-WebM" : "NOT EBML",
    codecs: [],
    videos: [],
    durationMs: null,
    timecodeScale: 1_000_000,
  };

  // Recursive descent with exact byte scopes. The first version of this walker
  // stepped into every element it did not recognise, so it wandered through
  // encoded video payloads reading compressed bytes as element ids and never
  // found the track table at all. Unknown elements are now skipped whole, and a
  // master is only entered within the size its parent declared.
  const walk = (start, end, depth, onElement) => {
    let offset = start;
    while (offset + 1 < end) {
      const id = readElementId(buffer, offset);
      if (!id) return;
      const sizeField = readVint(buffer, offset + id.size);
      if (!sizeField) return;
      const dataStart = offset + id.size + sizeField.size;
      const dataEnd = Math.min(dataStart + sizeField.value, end);
      if (dataStart > end) return;
      onElement?.({ id: id.value, size: sizeField.value, depth, dataStart, dataEnd });

      if (MASTERS.has(id.value)) {
        walk(dataStart, dataEnd, depth + 1, onElement);
      } else {
        switch (id.value) {
          case IDS.TimecodeScale:
            result.timecodeScale = unsigned(buffer, dataStart, sizeField.value);
            break;
          case IDS.Duration: {
            const value = float(buffer, dataStart, sizeField.value) ?? unsigned(buffer, dataStart, sizeField.value);
            if (Number.isFinite(value)) result.durationMs = (value * result.timecodeScale) / 1e6;
            break;
          }
          case IDS.CodecID:
            result.codecs.push(buffer.toString("utf8", dataStart, dataEnd).replace(/\0+$/, ""));
            break;
          case IDS.PixelWidth:
            result.pendingWidth = unsigned(buffer, dataStart, sizeField.value);
            break;
          case IDS.PixelHeightA:
          case IDS.PixelHeightB:
            result.pendingHeight = unsigned(buffer, dataStart, sizeField.value);
            if (result.pendingWidth !== undefined) {
              result.videos.push({ width: result.pendingWidth, height: result.pendingHeight });
            }
            break;
          default:
            break;
        }
      }
      offset = dataEnd;
    }
  };

  if (process.argv.includes("--tree")) {
    const lines = [];
    walk(0, buffer.length, 0, (element) => {
      const known = Object.entries(IDS).find(([, value]) => value === element.id)?.[0] ?? "";
      lines.push(
        `${"  ".repeat(element.depth)}0x${element.id.toString(16)} ${known} size=${element.size}`,
      );
    });
    console.log(lines.slice(0, 60).join("\n"));
  }

  walk(0, buffer.length, 0);
  return result;
}

const files = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
if (files.length === 0) {
  console.error("usage: node scripts/webm-inspect.mjs <file.webm> [...]");
  process.exit(2);
}
for (const file of files) {
  const r = inspect(file);
  const video = r.videos[0] ?? null;
  console.log(
    `${r.file}\n   container=${r.container} codecs=[${r.codecs.join(", ")}] ${
      video ? `${video.width}x${video.height}` : "no video track found"
    } duration=${r.durationMs === null ? "unknown" : `${(r.durationMs / 1000).toFixed(3)}s`} bytes=${r.bytes}`,
  );
}
