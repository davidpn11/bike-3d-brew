// Browser storage behind the pure CaptureCache (src/scene/captureCache.ts). OPFS first: it
// stores large binaries as real files without base64 or structured-clone overhead. IndexedDB
// is the fallback (older Safari has OPFS but no createWritable() on the main thread, and some
// private modes reject OPFS outright). Either may throw at any time, so callers treat every
// method as fallible and the whole cache as optional.

import { type BlobBackend, CaptureCache, budgetFor } from '../scene/captureCache';

const DIR = 'bike-captures';

export class OpfsBackend implements BlobBackend {
  readonly kind = 'opfs';
  private constructor(private dir: FileSystemDirectoryHandle) {}

  static async open(): Promise<OpfsBackend> {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(DIR, { create: true });
    const backend = new OpfsBackend(dir);
    // Probe a real write: getDirectory() succeeds in some modes where writing then fails.
    await backend.put('.probe', new Uint8Array([1]));
    await backend.delete('.probe');
    return backend;
  }

  async get(key: string): Promise<Uint8Array | null> {
    let handle: FileSystemFileHandle;
    try {
      handle = await this.dir.getFileHandle(fileName(key));
    } catch (err) {
      if ((err as DOMException)?.name === 'NotFoundError') return null;
      throw err;
    }
    return new Uint8Array(await (await handle.getFile()).arrayBuffer());
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const handle = await this.dir.getFileHandle(fileName(key), { create: true });
    if (typeof handle.createWritable !== 'function') throw new Error('OPFS createWritable unsupported');
    const writable = await handle.createWritable();
    try {
      await writable.write(data as BufferSource);
      await writable.close();
    } catch (err) {
      await writable.abort().catch(() => {});
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.dir.removeEntry(fileName(key));
    } catch (err) {
      if ((err as DOMException)?.name !== 'NotFoundError') throw err;
    }
  }
}

/** OPFS names cannot contain slashes, so keys become percent-encoded flat names. */
const fileName = (key: string) => encodeURIComponent(key);

export class IdbBackend implements BlobBackend {
  readonly kind = 'indexeddb';
  private constructor(private db: IDBDatabase) {}

  static open(factory: IDBFactory = indexedDB, name = 'bike-3d-brew'): Promise<IdbBackend> {
    return new Promise((resolve, reject) => {
      const req = factory.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files');
      req.onsuccess = () => resolve(new IdbBackend(req.result));
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
  }

  get(key: string): Promise<Uint8Array | null> {
    return this.run('readonly', (s) => s.get(key)).then((v) => (v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : null));
  }

  put(key: string, data: Uint8Array): Promise<void> {
    return this.run('readwrite', (s) => s.put(data, key)).then(() => {});
  }

  delete(key: string): Promise<void> {
    return this.run('readwrite', (s) => s.delete(key)).then(() => {});
  }

  close(): void {
    this.db.close();
  }

  private run(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('files', mode);
      const req = fn(tx.objectStore('files'));
      let result: unknown;
      req.onsuccess = () => (result = req.result);
      // Resolve on commit, not on request success, so a quota error at commit time is seen.
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? req.error);
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  }
}

/** The first backend that works in this browser, or null (the app then behaves as before: re-drop the zip). */
export async function openBackend(): Promise<BlobBackend | null> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && 'getDirectory' in navigator.storage) return await OpfsBackend.open();
  } catch {
    // Fall through to IndexedDB.
  }
  try {
    if (typeof indexedDB !== 'undefined') return await IdbBackend.open();
  } catch {
    // No persistent storage at all (e.g. some private modes).
  }
  return null;
}

let persistAsked = false;

/** Asks once per page load for persistent storage so the browser does not evict captures under pressure. */
export function requestPersistence(): void {
  if (persistAsked) return;
  persistAsked = true;
  try {
    void navigator.storage
      ?.persisted?.()
      .then((yes) => (yes ? true : navigator.storage.persist?.()))
      .catch(() => {});
  } catch {
    /* unsupported */
  }
}

export async function openCaptureCache(): Promise<CaptureCache | null> {
  const backend = await openBackend();
  if (!backend) return null;
  const cache: CaptureCache = new CaptureCache(backend, async () => {
    let estimate: StorageEstimate | null = null;
    try {
      estimate = (await navigator.storage?.estimate?.()) ?? null;
    } catch {
      estimate = null;
    }
    return budgetFor(estimate, await cache.usage());
  });
  return cache;
}
