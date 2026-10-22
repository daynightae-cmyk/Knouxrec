import type { LibraryItem } from "../state/types";

const DB_NAME = "knoux-rec.library";
const DB_VERSION = 1;
const STORE = "items";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this runtime."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB could not be opened."));
    request.onblocked = () =>
      reject(new Error("IndexedDB upgrade blocked by another window."));
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = action(transaction.objectStore(STORE));
        let result: T;
        let requestError: Error | null = null;

        request.onsuccess = () => {
          result = request.result;
        };
        request.onerror = () => {
          requestError = request.error ?? new Error("IndexedDB request failed.");
        };

        // The write is only durable once the transaction commits. Resolving on
        // request success reported saves that could still be rolled back.
        transaction.oncomplete = () => {
          db.close();
          if (requestError) reject(requestError);
          else resolve(result);
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error ?? requestError ?? new Error("IndexedDB transaction failed."));
        };
        transaction.onabort = () => {
          db.close();
          reject(
            transaction.error ??
              requestError ??
              new Error("IndexedDB transaction was aborted before it committed."),
          );
        };
      }),
  );
}

export const libraryStore = {
  async list(): Promise<LibraryItem[]> {
    const items = await withStore<LibraryItem[]>("readonly", (store) =>
      store.getAll(),
    );
    return items.sort((a, b) => b.createdAt - a.createdAt);
  },

  async add(item: LibraryItem): Promise<void> {
    await withStore("readwrite", (store) => store.put(item));
  },

  async remove(id: string): Promise<void> {
    await withStore("readwrite", (store) => store.delete(id));
  },

  async rename(id: string, name: string): Promise<void> {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      const getRequest = store.get(id);
      let found = false;
      getRequest.onsuccess = () => {
        const value = getRequest.result as LibraryItem | undefined;
        if (value) {
          found = true;
          value.name = name;
          store.put(value);
        }
      };
      transaction.oncomplete = () => {
        db.close();
        if (found) resolve();
        else reject(new Error("The item no longer exists in the library."));
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error ?? new Error("Rename failed."));
      };
      transaction.onabort = () => {
        db.close();
        reject(transaction.error ?? new Error("Rename was rolled back."));
      };
    });
  },

  async setFavorite(id: string, favorite: boolean): Promise<void> {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      const getRequest = store.get(id);
      let found = false;
      getRequest.onsuccess = () => {
        const value = getRequest.result as LibraryItem | undefined;
        if (value) {
          found = true;
          value.favorite = favorite;
          store.put(value);
        }
      };
      transaction.oncomplete = () => {
        db.close();
        if (found) resolve();
        else reject(new Error("The item no longer exists in the library."));
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error ?? new Error("Favorite update failed."));
      };
      transaction.onabort = () => {
        db.close();
        reject(transaction.error ?? new Error("Favorite update was rolled back."));
      };
    });
  },

  async get(id: string): Promise<LibraryItem | undefined> {
    return withStore<LibraryItem | undefined>("readonly", (store) =>
      store.get(id),
    );
  },

  async clear(): Promise<void> {
    await withStore("readwrite", (store) => store.clear());
  },
};
