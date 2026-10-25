/**
 * KNOUX REC — minimal, honest ZIP writer.
 *
 * The product ships no archiving dependency, so this writes the container
 * itself: local file headers, the central directory and the end record, all with
 * real CRC-32 values computed over the exact bytes. Entries are STORED, not
 * deflated — the archive is a container lossless by construction, and the UI
 * says so instead of implying compression it did not perform.
 */

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
  /** Seconds since the epoch; defaults to now. */
  modifiedAt?: number;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = -1;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function dosDateTime(epochSeconds: number): { time: number; date: number } {
  const date = new Date(epochSeconds * 1000);
  const year = Math.max(1980, date.getFullYear());
  return {
    time:
      (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const encoder = new TextEncoder();

/** Build a complete STORE-only archive. Names are written as UTF-8. */
export function createZip(entries: ZipEntry[]): Uint8Array {
  if (entries.length === 0) throw new Error("The archive would be empty.");

  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name.replace(/\\/g, "/"));
    if (nameBytes.length === 0) throw new Error("An archive entry has an empty name.");
    if (nameBytes.length > 0xffff) throw new Error("An archive entry name is too long.");
    if (entry.bytes.length > 0xffffffff) throw new Error("An archive entry is too large.");
    const crc = crc32(entry.bytes);
    const stamp = dosDateTime(entry.modifiedAt ?? Math.floor(Date.now() / 1000));

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true); // local file header
    localView.setUint16(4, 20, true); // version needed
    localView.setUint16(6, 0x0800, true); // UTF-8 name flag
    localView.setUint16(8, 0, true); // method: store
    localView.setUint16(10, stamp.time, true);
    localView.setUint16(12, stamp.date, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, entry.bytes.length, true);
    localView.setUint32(22, entry.bytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true); // central directory header
    centralView.setUint16(4, 20, true); // version made by
    centralView.setUint16(6, 20, true); // version needed
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, stamp.time, true);
    centralView.setUint16(14, stamp.date, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, entry.bytes.length, true);
    centralView.setUint32(24, entry.bytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true); // external attributes
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    localChunks.push(local, entry.bytes);
    centralChunks.push(central);
    offset += local.length + entry.bytes.length;
  }

  const centralBytes = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralBytes, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true);

  const totalLength =
    localChunks.reduce((sum, chunk) => sum + chunk.length, 0) + centralBytes + end.length;
  const out = new Uint8Array(totalLength);
  let cursor = 0;
  for (const chunk of localChunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  for (const chunk of centralChunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  out.set(end, cursor);
  return out;
}

export interface ZipDirectoryEntry {
  name: string;
  bytes: number;
  crc: number;
  offset: number;
}

/** Reads the central directory back. Used by the tests and diagnostics. */
export function readZipDirectory(bytes: Uint8Array): ZipDirectoryEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Find the end record by scanning backwards for its signature.
  let endOffset = -1;
  for (let index = bytes.length - 22; index >= 0; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      endOffset = index;
      break;
    }
  }
  if (endOffset < 0) throw new Error("No ZIP end-of-central-directory record.");
  const count = view.getUint16(endOffset + 10, true);
  let cursor = view.getUint32(endOffset + 16, true);
  const decoder = new TextDecoder();
  const entries: ZipDirectoryEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error(`Central directory entry ${index} has the wrong signature.`);
    }
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    entries.push({
      name: decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)),
      bytes: view.getUint32(cursor + 20, true),
      crc: view.getUint32(cursor + 16, true),
      offset: view.getUint32(cursor + 42, true),
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Human-readable archive size, kept beside the writer for the UI. */
export function zipSummary(entries: ZipEntry[]): { files: number; bytes: number } {
  return {
    files: entries.length,
    bytes: entries.reduce((sum, entry) => sum + entry.bytes.length, 0),
  };
}
