import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAPTURE_SCHEMA, POSES_SCHEMA, captureModelUrl } from '../src/scene/capture';
import { DEFAULT_BUDGET } from '../src/scene/captureCache';
import { IdbBackend, OpfsBackend, openBackend, openCaptureCache } from '../src/storage/backends';

// The browser storage backends, against fake-indexeddb and a small in-memory OPFS.

const notFound = () => new DOMException('missing', 'NotFoundError');

/** Just enough of the Origin Private File System for OpfsBackend. */
class FakeDir {
  files = new Map<string, Uint8Array>();
  dirs = new Map<string, FakeDir>();
  writable: 'ok' | 'missing' | 'failing' = 'ok';

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FakeDir> {
    let d = this.dirs.get(name);
    if (!d) {
      if (!opts?.create) throw notFound();
      d = new FakeDir();
      d.writable = this.writable;
      this.dirs.set(name, d);
    }
    return d;
  }

  async getFileHandle(name: string, opts?: { create?: boolean }) {
    if (!this.files.has(name)) {
      if (!opts?.create) throw notFound();
      this.files.set(name, new Uint8Array());
    }
    const write = this.writable;
    const files = this.files;
    let pending: Uint8Array | null = null;
    return {
      getFile: async () => new Blob([files.get(name)! as BlobPart]),
      createWritable:
        write === 'missing'
          ? undefined
          : async () => ({
              write: async (d: Uint8Array) => {
                if (write === 'failing') throw new DOMException('full', 'QuotaExceededError');
                pending = d.slice();
              },
              close: async () => void files.set(name, pending!),
              abort: async () => {
                throw new Error('abort also fails');
              },
            }),
    };
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name)) throw notFound();
  }
}

function stubStorage(root: FakeDir | null, extra: Record<string, unknown> = {}) {
  const storage = { ...(root ? { getDirectory: async () => root } : {}), ...extra };
  vi.stubGlobal('navigator', { storage });
  return storage;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('OpfsBackend', () => {
  it('stores binaries as percent-encoded flat files', async () => {
    const root = new FakeDir();
    stubStorage(root);
    const opfs = await OpfsBackend.open();
    expect(opfs.kind).toBe('opfs');
    await opfs.put('abc/f/thumb/images/IMG_1.jpg', new Uint8Array([1, 2, 3]));
    const dir = root.dirs.get('bike-captures')!;
    expect([...dir.files.keys()]).toEqual(['abc%2Ff%2Fthumb%2Fimages%2FIMG_1.jpg']); // the probe file is gone
    expect(await opfs.get('abc/f/thumb/images/IMG_1.jpg')).toEqual(new Uint8Array([1, 2, 3]));
    expect(await opfs.get('nope')).toBeNull();
    await opfs.delete('abc/f/thumb/images/IMG_1.jpg');
    await opfs.delete('abc/f/thumb/images/IMG_1.jpg'); // already gone: fine
    expect(dir.files.size).toBe(0);
  });

  it('rethrows errors other than "not found"', async () => {
    const root = new FakeDir();
    stubStorage(root);
    const opfs = await OpfsBackend.open();
    const dir = root.dirs.get('bike-captures')!;
    const denied = async (): Promise<never> => {
      throw new DOMException('denied', 'SecurityError');
    };
    dir.getFileHandle = denied;
    dir.removeEntry = denied;
    await expect(opfs.get('x')).rejects.toThrow('denied');
    await expect(opfs.delete('x')).rejects.toThrow('denied');
  });

  it('fails to open where writing is impossible (no createWritable, or writes throw)', async () => {
    const noWritable = new FakeDir();
    noWritable.writable = 'missing';
    stubStorage(noWritable);
    await expect(OpfsBackend.open()).rejects.toThrow(/createWritable unsupported/);
    const failing = new FakeDir();
    failing.writable = 'failing';
    stubStorage(failing);
    await expect(OpfsBackend.open()).rejects.toThrow('full');
  });
});

describe('IdbBackend', () => {
  it('round-trips bytes, also when stored as an ArrayBuffer, and ignores foreign values', async () => {
    const factory = new IDBFactory();
    const idb = await IdbBackend.open(factory, 'test-db');
    expect(idb.kind).toBe('indexeddb');
    await idb.put('a', new Uint8Array([9, 8]));
    expect(await idb.get('a')).toEqual(new Uint8Array([9, 8]));
    // Older entries or other writers may hold an ArrayBuffer or something else entirely.
    await (idb as unknown as { run(m: string, fn: (s: IDBObjectStore) => IDBRequest): Promise<unknown> }).run('readwrite', (s) => s.put(new Uint8Array([5]).buffer, 'buf'));
    await (idb as unknown as { run(m: string, fn: (s: IDBObjectStore) => IDBRequest): Promise<unknown> }).run('readwrite', (s) => s.put('text', 'str'));
    expect(await idb.get('buf')).toEqual(new Uint8Array([5]));
    expect(await idb.get('str')).toBeNull();
    await idb.delete('a');
    expect(await idb.get('a')).toBeNull();
    idb.close();
  });

  it('rejects when the database cannot be opened or a transaction fails', async () => {
    const failing = {
      open: () => {
        const req = {} as IDBOpenDBRequest & { error: DOMException };
        queueMicrotask(() => {
          Object.defineProperty(req, 'error', { value: new DOMException('denied', 'SecurityError') });
          req.onerror?.(new Event('error'));
        });
        return req;
      },
    } as unknown as IDBFactory;
    await expect(IdbBackend.open(failing)).rejects.toThrow('denied');

    const blocked = {
      open: () => {
        const req = {} as IDBOpenDBRequest;
        queueMicrotask(() => req.onblocked?.(new Event('blocked') as IDBVersionChangeEvent));
        return req;
      },
    } as unknown as IDBFactory;
    await expect(IdbBackend.open(blocked)).rejects.toThrow(/blocked/);

    const idb = await IdbBackend.open(new IDBFactory());
    // A put of a value IndexedDB cannot clone aborts the transaction.
    await expect(
      (idb as unknown as { run(m: string, fn: (s: IDBObjectStore) => IDBRequest): Promise<unknown> }).run('readwrite', (s) => {
        const req = s.put(new Uint8Array([1]), 'k');
        s.transaction.abort();
        return req;
      }),
    ).rejects.toBeTruthy();
    idb.close();
  });
});

describe('openBackend', () => {
  it('prefers OPFS', async () => {
    stubStorage(new FakeDir());
    expect((await openBackend())?.kind).toBe('opfs');
  });

  it('falls back to IndexedDB when OPFS is missing or broken', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    stubStorage(null);
    expect((await openBackend())?.kind).toBe('indexeddb');
    const broken = new FakeDir();
    broken.writable = 'missing';
    stubStorage(broken);
    expect((await openBackend())?.kind).toBe('indexeddb');
  });

  it('returns null without any storage', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('indexedDB', undefined);
    expect(await openBackend()).toBeNull();
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    expect(await openBackend()).toBeNull();
  });
});

describe('openCaptureCache', () => {
  const store = (cache: NonNullable<Awaited<ReturnType<typeof openCaptureCache>>>) =>
    cache.store({
      url: captureModelUrl('a.zip', 'model.usdz'),
      sceneId: 'capture-a',
      manifest: { schema: CAPTURE_SCHEMA, name: 'A', mode: 'object', model: 'model.usdz', poses: 'poses.json', images: 'images/' },
      poses: { schema: POSES_SCHEMA, samples: [] },
      model: { path: 'model.usdz', format: 'usdz', data: new Uint8Array(1000) },
      images: [],
    });

  it('budgets from the storage estimate', async () => {
    stubStorage(new FakeDir(), { estimate: async () => ({ quota: 10_000, usage: 9_500 }) });
    const cache = (await openCaptureCache())!;
    // Hardly any quota left: the bundle does not fit.
    expect(await store(cache)).toBe(false);
  });

  it('uses the default budget when the estimate is missing or throws', async () => {
    stubStorage(new FakeDir(), {
      estimate: async () => {
        throw new Error('no estimate');
      },
    });
    expect(await store((await openCaptureCache())!)).toBe(true);
    stubStorage(new FakeDir());
    expect(await store((await openCaptureCache())!)).toBe(true);
    expect(DEFAULT_BUDGET).toBeGreaterThan(1000);
  });

  it('is null without storage', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('indexedDB', undefined);
    expect(await openCaptureCache()).toBeNull();
  });
});

describe('requestPersistence', () => {
  it('asks once per page load, and only when not yet persisted', async () => {
    vi.resetModules();
    const persist = vi.fn(async () => true);
    const persisted = vi.fn(async () => false);
    stubStorage(null, { persist, persisted });
    const { requestPersistence } = await import('../src/storage/backends');
    requestPersistence();
    requestPersistence();
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
    expect(persisted).toHaveBeenCalledTimes(1);
  });

  it('skips persist() when already persisted and survives missing APIs', async () => {
    vi.resetModules();
    const persist = vi.fn(async () => true);
    stubStorage(null, { persist, persisted: async () => true });
    const first = await import('../src/storage/backends');
    first.requestPersistence();
    await new Promise((r) => setTimeout(r, 0));
    expect(persist).not.toHaveBeenCalled();

    vi.resetModules();
    vi.stubGlobal('navigator', undefined);
    const second = await import('../src/storage/backends');
    expect(() => second.requestPersistence()).not.toThrow();
  });
});
