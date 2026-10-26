import type { RecordStorage } from "./designRecord";

/** The database and object store holding the kept design: one slot of a few named entries (ADR 0002). */
const DB_NAME = "pumpkin-template";
const DB_VERSION = 1;
const STORE = "design";

/**
 * The browser's IndexedDB as the record's storage, or undefined where it can't be reached. Opening it can still
 * fail later (e.g. blocked by privacy settings); every call then rejects, which the record keeper reports.
 */
export function indexedDbStorage(): RecordStorage | undefined {
  let factory: IDBFactory | undefined;
  try {
    factory = globalThis.indexedDB;
  } catch {
    return undefined;
  }
  if (!factory) return undefined;
  const idb = factory;
  let db: Promise<IDBDatabase> | null = null;
  const open = () =>
    (db ??= new Promise((resolve, reject) => {
      const request = idb.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB wouldn't open"));
    }));

  /** Run one request in its own transaction; resolves once the transaction has committed. */
  const run = async <T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = act(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () =>
        reject(transaction.error ?? request.error ?? new Error("IndexedDB write failed"));
    });
  };

  return {
    get: (key) => run("readonly", (store) => store.get(key)),
    set: async (key, value) => void (await run("readwrite", (store) => store.put(value, key))),
    delete: async (key) => void (await run("readwrite", (store) => store.delete(key))),
  };
}
