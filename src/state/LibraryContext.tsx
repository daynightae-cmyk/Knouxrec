import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { LibraryItem } from "./types";
import { libraryStore } from "../services/libraryStore";
import { sanitizeFileName } from "../lib/format";

export interface NewLibraryItem {
  name: string;
  kind: LibraryItem["kind"];
  mimeType: string;
  blob: Blob;
  duration: number;
  width: number;
  height: number;
  source: LibraryItem["source"];
  thumbnail: string | null;
  /** Hubs this result was derived through; the source file itself is untouched. */
  provenance?: LibraryItem["provenance"];
}

export interface LibraryContextValue {
  items: LibraryItem[];
  ready: boolean;
  error: string | null;
  add: (item: NewLibraryItem) => Promise<LibraryItem>;
  update: (id: string, patch: Pick<LibraryItem, "blob"> & Partial<LibraryItem>) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  setCollection: (id: string, collection: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  urlFor: (id: string) => string | null;
  reload: () => Promise<void>;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urls = useRef(new Map<string, string>());

  const urlFor = useCallback((id: string) => urls.current.get(id) ?? null, []);

  const ensureUrl = useCallback((item: LibraryItem) => {
    if (!urls.current.has(item.id)) {
      urls.current.set(item.id, URL.createObjectURL(item.blob));
    }
    return urls.current.get(item.id)!;
  }, []);

  const hydrate = useCallback(
    (list: LibraryItem[]) => {
      // `blob:` URLs are scoped to the document that created them. A thumbnail
      // persisted as a blob URL is dead after a reload, so drop it and let the
      // view fall back to the freshly-created object URL for the stored blob.
      const hydrated = list.map((item) =>
        item.thumbnail?.startsWith("blob:") ? { ...item, thumbnail: null } : item,
      );
      const ids = new Set(hydrated.map((item) => item.id));
      urls.current.forEach((url, id) => {
        if (!ids.has(id)) {
          URL.revokeObjectURL(url);
          urls.current.delete(id);
        }
      });
      hydrated.forEach(ensureUrl);
      setItems(hydrated);
    },
    [ensureUrl],
  );

  const reload = useCallback(async () => {
    try {
      const list = await libraryStore.list();
      hydrate(list);
      setError(null);
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "The local library could not be opened.";
      setError(message);
      // The caller decides how to report the failure; swallowing it here made
      // the UI report a successful reload while the library was unreadable.
      throw cause instanceof Error ? cause : new Error(message);
    } finally {
      setReady(true);
    }
  }, [hydrate]);

  useEffect(() => {
    const urlsAtMount = urls.current;
    void reload().catch(() => undefined);
    return () => {
      urlsAtMount.forEach((url) => URL.revokeObjectURL(url));
      urlsAtMount.clear();
    };
  }, [reload]);

  const add = useCallback(
    async (input: NewLibraryItem) => {
      const item: LibraryItem = {
        id: `knx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: sanitizeFileName(input.name),
        kind: input.kind,
        mimeType: input.mimeType,
        size: input.blob.size,
        duration: input.duration,
        width: input.width,
        height: input.height,
        createdAt: Date.now(),
        source: input.source,
        blob: input.blob,
        thumbnail: input.thumbnail?.startsWith("blob:") ? null : input.thumbnail,
        provenance: input.provenance?.length ? input.provenance : undefined,
      };
      // The row is written first: a failed write must not leave a ghost entry
      // in the UI or an object URL that nothing owns.
      await libraryStore.add(item);
      ensureUrl(item);
      setItems((previous) => [item, ...previous]);
      setError(null);
      return item;
    },
    [ensureUrl],
  );

  const update = useCallback(
    async (
      id: string,
      patch: Pick<LibraryItem, "blob"> & Partial<LibraryItem>,
    ) => {
      const current = items.find((item) => item.id === id);
      if (!current) throw new Error("Recording not found.");
      const updated: LibraryItem = {
        ...current,
        ...patch,
        size: patch.blob.size,
        mimeType: patch.blob.type || current.mimeType,
      };
      // Persist before touching React state so the UI never advertises a
      // change that was rolled back by the storage layer.
      await libraryStore.add(updated);
      const existingUrl = urls.current.get(id);
      if (existingUrl) URL.revokeObjectURL(existingUrl);
      urls.current.delete(id);
      ensureUrl(updated);
      setItems((previous) => previous.map((item) => (item.id === id ? updated : item)));
    },
    [ensureUrl, items],
  );

  const rename = useCallback(async (id: string, name: string) => {
    const clean = sanitizeFileName(name);
    await libraryStore.rename(id, clean);
    setItems((previous) =>
      previous.map((item) => (item.id === id ? { ...item, name: clean } : item)),
    );
  }, []);

  const toggleFavorite = useCallback(async (id: string) => {
    const current = items.find((item) => item.id === id);
    if (!current) return;
    const favorite = !current.favorite;
    await libraryStore.setFavorite(id, favorite);
    setItems((previous) =>
      previous.map((item) => (item.id === id ? { ...item, favorite } : item)),
    );
  }, [items]);

  const setCollection = useCallback(async (id: string, collection: string) => {
    await libraryStore.setCollection(id, collection);
    const value = collection.trim();
    setItems((previous) =>
      previous.map((item) =>
        item.id === id
          ? { ...item, collection: value || undefined }
          : item,
      ),
    );
  }, []);

  const remove = useCallback(async (id: string) => {
    await libraryStore.remove(id);
    const url = urls.current.get(id);
    if (url) URL.revokeObjectURL(url);
    urls.current.delete(id);
    setItems((previous) => previous.filter((item) => item.id !== id));
  }, []);

  const value = useMemo(
    () => ({ items, ready, error, add, update, rename, toggleFavorite, setCollection, remove, urlFor, reload }),
    [items, ready, error, add, update, rename, toggleFavorite, setCollection, remove, urlFor, reload],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryContextValue {
  const value = useContext(LibraryContext);
  if (!value) throw new Error("useLibrary must be used inside LibraryProvider");
  return value;
}
