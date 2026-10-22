import { beforeEach, describe, expect, it } from "vitest";
import { libraryStore } from "./libraryStore";
import type { LibraryItem } from "../state/types";

function makeItem(id: string, overrides: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id,
    name: `${id}.webm`,
    kind: "video",
    mimeType: "video/webm",
    size: 4,
    duration: 1,
    width: 1920,
    height: 1080,
    createdAt: 1_700_000_000_000,
    source: "recording",
    blob: new Blob(["payload"], { type: "video/webm" }),
    thumbnail: null,
    ...overrides,
  };
}

describe("libraryStore durability", () => {
  beforeEach(async () => {
    await libraryStore.clear();
  });

  it("resolves a write only after the transaction committed", async () => {
    await libraryStore.add(makeItem("item-1"));

    // The point of the fix: once add() resolves, the row is readable. Blob
    // fidelity inside the fake IndexedDB is not asserted here because the
    // jsdom Blob clone does not survive structured cloning; that path is
    // covered by the Chromium smoke (scripts/recording-smoke.mjs).
    const stored = await libraryStore.get("item-1");
    expect(stored).toBeDefined();
    expect(stored?.name).toBe("item-1.webm");
    expect(stored?.size).toBe(4);
    expect(stored?.createdAt).toBe(1_700_000_000_000);
  });

  it("lists stored items newest first", async () => {
    await libraryStore.add(makeItem("older", { createdAt: 1_000 }));
    await libraryStore.add(makeItem("newer", { createdAt: 2_000 }));

    const items = await libraryStore.list();
    expect(items.map((item) => item.id)).toEqual(["newer", "older"]);
  });

  it("persists a rename", async () => {
    await libraryStore.add(makeItem("item-2"));

    await libraryStore.rename("item-2", "renamed.webm");

    const stored = await libraryStore.get("item-2");
    expect(stored?.name).toBe("renamed.webm");
  });

  it("rejects a rename for an item that does not exist instead of resolving silently", async () => {
    await expect(libraryStore.rename("missing", "renamed.webm")).rejects.toThrow();
  });

  it("persists the favourite flag", async () => {
    await libraryStore.add(makeItem("item-3"));

    await libraryStore.setFavorite("item-3", true);

    const stored = await libraryStore.get("item-3");
    expect(stored?.favorite).toBe(true);
  });

  it("removes an item", async () => {
    await libraryStore.add(makeItem("item-4"));

    await libraryStore.remove("item-4");

    expect(await libraryStore.get("item-4")).toBeUndefined();
  });
});
