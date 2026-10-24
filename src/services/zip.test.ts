import { describe, expect, it } from "vitest";
import { createZip, crc32, readZipDirectory, zipSummary } from "./zip";

const encoder = new TextEncoder();

function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

describe("CRC-32", () => {
  it("matches the standard check value", () => {
    expect(crc32(bytes("123456789"))).toBe(0xcbf43926);
  });

  it("is zero for empty input and differs for different data", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(bytes("a"))).not.toBe(crc32(bytes("b")));
  });
});

describe("ZIP container", () => {
  it("writes local headers, the central directory and the end record", () => {
    const archive = createZip([
      { name: "a.txt", bytes: bytes("hello"), modifiedAt: 1_700_000_000 },
      { name: "dir/b.bin", bytes: new Uint8Array([0, 1, 2, 3]), modifiedAt: 1_700_000_000 },
    ]);
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(
      view.getUint32(archive.length - 22, true),
      "the archive ends with an end-of-central-directory record",
    ).toBe(0x06054b50);
    expect(view.getUint16(archive.length - 22 + 10, true)).toBe(2);
  });

  it("round-trips names, sizes, CRCs and offsets through the directory", () => {
    const entries = [
      { name: "shot-batch.jpg", bytes: bytes("jpeg-ish bytes"), modifiedAt: 1_700_000_000 },
      { name: "notes/readme.txt", bytes: bytes("x".repeat(1000)), modifiedAt: 1_700_000_000 },
    ];
    const archive = createZip(entries);
    const directory = readZipDirectory(archive);
    expect(directory).toHaveLength(2);
    expect(directory[0].name).toBe("shot-batch.jpg");
    expect(directory[0].bytes).toBe(entries[0].bytes.length);
    expect(directory[0].crc).toBe(crc32(entries[0].bytes));
    expect(directory[1].name).toBe("notes/readme.txt");
    expect(directory[1].bytes).toBe(1000);
    expect(directory[1].offset).toBe(30 + entries[0].name.length + entries[0].bytes.length);

    // The stored payload at each recorded offset is the original data.
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    for (let index = 0; index < directory.length; index += 1) {
      const entry = directory[index];
      const nameLength = view.getUint16(entry.offset + 26, true);
      const start = entry.offset + 30 + nameLength;
      const payload = archive.subarray(start, start + entry.bytes);
      expect(Array.from(payload)).toEqual(Array.from(entries[index].bytes));
    }
  });

  it("keeps UTF-8 names intact", () => {
    const archive = createZip([{ name: "تقرير.png", bytes: bytes("data") }]);
    expect(readZipDirectory(archive)[0].name).toBe("تقرير.png");
  });

  it("refuses an empty archive instead of writing a broken file", () => {
    expect(() => createZip([])).toThrow(/empty/i);
  });

  it("summarises what the archive will contain", () => {
    const summary = zipSummary([
      { name: "a", bytes: new Uint8Array(10) },
      { name: "b", bytes: new Uint8Array(5) },
    ]);
    expect(summary).toEqual({ files: 2, bytes: 15 });
  });
});
