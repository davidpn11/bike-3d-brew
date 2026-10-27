import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { CAPTURE_SCHEMA, type CaptureManifest, POSES_SCHEMA, captureModelUrl } from '../src/scene/capture';
import {
  type BlobBackend,
  CaptureCache,
  DEFAULT_BUDGET,
  MemoryBackend,
  type StoreInput,
  budgetFor,
  cacheKeyFor,
  fnv1a,
  formatBytes,
  parseIndex,
  planEviction,
} from '../src/scene/captureCache';
import { IdbBackend } from '../src/storage/backends';

const manifest = (name: string): CaptureManifest => ({ schema: CAPTURE_SCHEMA, name, mode: 'object', model: 'model.usdz', poses: 'poses.json', images: 'images/' });
const poses = { schema: POSES_SCHEMA, samples: [{ sample: 0, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }] };

function input(zip: string, size = 100, sceneId = `capture-${zip}`): StoreInput {
  return {
    url: captureModelUrl(zip, 'model.usdz'),
    sceneId,
    manifest: manifest(zip),
    poses,
    model: { path: 'model.usdz', format: 'usdz', data: new Uint8Array(size).fill(7) },
    images: ['images/IMG_0000.HEIC'],
  };
}

function clock() {
  let t = 1000;
  return () => ++t;
}

describe('cache policy', () => {
  it('plans LRU eviction under a budget', () => {
    const entries = [
      { key: 'a', bytes: 40, lastUsed: 3 },
      { key: 'b', bytes: 40, lastUsed: 1 },
      { key: 'c', bytes: 40, lastUsed: 2 },
    ];
    expect(planEviction(entries, 10, 200)).toEqual([]);
    expect(planEviction(entries, 50, 150)).toEqual(['b']);
    expect(planEviction(entries, 100, 150)).toEqual(['b', 'c']);
    expect(planEviction(entries, 140, 150)).toEqual(['b', 'c', 'a']);
    expect(planEviction(entries, 50, 150, ['b'])).toEqual(['c']);
    expect(planEviction(entries, 151, 150)).toBeNull();
    expect(planEviction(entries, 100, 100, ['a'])).toBeNull();
  });

  it('derives the budget from the quota estimate', () => {
    expect(budgetFor(null)).toBe(DEFAULT_BUDGET);
    expect(budgetFor({ quota: 10e9, usage: 0 })).toBe(DEFAULT_BUDGET);
    // Small quota (Safari, private windows): half of it, minus what others already use.
    expect(budgetFor({ quota: 200e6, usage: 30e6 })).toBe(70e6);
    // Our own usage is ours to reuse.
    expect(budgetFor({ quota: 200e6, usage: 30e6 }, 30e6)).toBe(100e6);
    expect(budgetFor({ quota: 10e6, usage: 9e6 })).toBe(0);
  });

  it('derives stable, storage-safe keys from bundle URLs', () => {
    const a = cacheKeyFor(captureModelUrl('Trek Domane SL6.bikecapture.zip', 'model.usdz'));
    expect(a).toMatch(/^cap-trek-domane-sl6-[0-9a-f]{8}$/);
    expect(cacheKeyFor(captureModelUrl('Trek Domane SL6.bikecapture.zip', 'model.usdz'))).toBe(a);
    expect(cacheKeyFor(captureModelUrl('Trek Domane SL6.bikecapture.zip', 'model.glb'))).not.toBe(a);
    expect(cacheKeyFor(captureModelUrl('../../etc/x.zip', 'model.usdz'))).not.toMatch(/[/.]/);
    expect(fnv1a('')).toBe('811c9dc5');
  });

  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(4096)).toBe('4 KB');
    expect(formatBytes(3.25 * 2 ** 20)).toBe('3.3 MB');
    expect(formatBytes(42 * 2 ** 20)).toBe('42 MB');
    expect(formatBytes(1.5 * 2 ** 30)).toBe('1.5 GB');
  });

  it('drops malformed index entries', () => {
    expect(parseIndex(null)).toEqual([]);
    expect(parseIndex({ entries: [{ url: 'https://x/y.glb', modelPath: 'y.glb' }, { url: 'bundle:a.zip/model.exe', modelPath: 'model.exe' }, 7] })).toEqual([]);
    const [e] = parseIndex({ entries: [{ url: 'bundle:a.zip/model.glb', modelPath: 'model.glb', bytes: -5, files: { t: 3, bad: 'x' } }] });
    expect(e).toMatchObject({ key: cacheKeyFor('bundle:a.zip/model.glb'), format: 'glb', bytes: 0, files: { t: 3 }, name: 'Captured bike' });
  });
});

describe('CaptureCache', () => {
  it('stores and restores a bundle', async () => {
    const backend = new MemoryBackend();
    const cache = new CaptureCache(backend, async () => DEFAULT_BUDGET, clock());
    expect(await cache.store(input('trek.bikecapture.zip'))).toBe(true);
    // A new cache over the same storage = a page reload.
    const reloaded = new CaptureCache(backend);
    const url = captureModelUrl('trek.bikecapture.zip', 'model.usdz');
    const r = await reloaded.restore(url, 'capture-trek.bikecapture.zip');
    expect(r?.manifest.name).toBe('trek.bikecapture.zip');
    expect(r?.poses?.samples).toHaveLength(1);
    expect(r?.model.length).toBe(100);
    expect(r?.entry).toMatchObject({ bundleName: 'trek.bikecapture.zip', format: 'usdz', images: ['images/IMG_0000.HEIC'] });
    expect(await reloaded.has(url)).toBe(true);
  });

  it('never restores a bundle for a different scene that reuses the zip name', async () => {
    const cache = new CaptureCache(new MemoryBackend());
    await cache.store(input('export.zip', 10, 'capture-bike-a'));
    expect(await cache.restore(captureModelUrl('export.zip', 'model.usdz'), 'capture-bike-b')).toBeNull();
    expect(await cache.restore(captureModelUrl('export.zip', 'model.usdz'), 'capture-bike-a')).not.toBeNull();
  });

  it('evicts least recently used bundles to stay under budget', async () => {
    // Each entry is ~500 bytes (300 model + manifest/poses JSON): two fit, three do not.
    const cache = new CaptureCache(new MemoryBackend(), async () => 1200, clock());
    await cache.store(input('a.zip', 300));
    await cache.store(input('b.zip', 300));
    await cache.restore(captureModelUrl('a.zip', 'model.usdz')); // a is now more recent than b
    await cache.store(input('c.zip', 300));
    expect((await cache.list()).map((e) => e.bundleName)).toEqual(['c.zip', 'a.zip']);
    expect(await cache.usage()).toBeLessThanOrEqual(1200);
  });

  it('skips bundles larger than the budget and keeps the rest', async () => {
    const cache = new CaptureCache(new MemoryBackend(), async () => 1000, clock());
    await cache.store(input('a.zip', 300));
    expect(await cache.store(input('huge.zip', 5000))).toBe(false);
    expect((await cache.list()).map((e) => e.bundleName)).toEqual(['a.zip']);
  });

  it('replaces an older copy of the same bundle', async () => {
    const backend = new MemoryBackend();
    const cache = new CaptureCache(backend, async () => DEFAULT_BUDGET, clock());
    await cache.store(input('a.zip', 300));
    await cache.putFile(captureModelUrl('a.zip', 'model.usdz'), 'thumb/x.jpg', new Uint8Array(20));
    await cache.store(input('a.zip', 50));
    const [e] = await cache.list();
    expect(e.files).toEqual({});
    expect([...backend.data.keys()].some((k) => k.endsWith('thumb/x.jpg'))).toBe(false);
    expect((await cache.restore(e.url))?.model.length).toBe(50);
  });

  it('caches lazily extracted files with their entry and removes them together', async () => {
    const backend = new MemoryBackend();
    const cache = new CaptureCache(backend, async () => DEFAULT_BUDGET, clock());
    const url = captureModelUrl('a.zip', 'model.usdz');
    expect(await cache.putFile(url, 'thumb/x.jpg', new Uint8Array(5))).toBe(false); // no entry yet
    await cache.store(input('a.zip', 100));
    const before = await cache.usage();
    await Promise.all([cache.putFile(url, 'thumb/x.jpg', new Uint8Array(20)), cache.putFile(url, 'thumb/y.jpg', new Uint8Array(30))]);
    expect(await cache.usage()).toBe(before + 50);
    expect((await cache.getFile(url, 'thumb/y.jpg'))?.length).toBe(30);
    expect(await cache.getFile(url, 'thumb/z.jpg')).toBeNull();
    await cache.remove(url);
    expect(await cache.list()).toEqual([]);
    expect(backend.data.size).toBe(1); // only the (empty) index is left
  });

  it('forgets an entry whose files the browser evicted', async () => {
    const backend = new MemoryBackend();
    const cache = new CaptureCache(backend);
    await cache.store(input('a.zip'));
    for (const k of [...backend.data.keys()]) if (k.endsWith('/model')) backend.data.delete(k);
    expect(await cache.restore(captureModelUrl('a.zip', 'model.usdz'))).toBeNull();
    expect(await cache.list()).toEqual([]);
  });

  it('degrades to a no-op when storage throws', async () => {
    const broken: BlobBackend = {
      kind: 'broken',
      get: () => Promise.reject(new DOMException('denied', 'SecurityError')),
      put: () => Promise.reject(new DOMException('full', 'QuotaExceededError')),
      delete: () => Promise.reject(new Error('nope')),
    };
    const cache = new CaptureCache(broken);
    expect(await cache.store(input('a.zip'))).toBe(false);
    expect(await cache.restore(captureModelUrl('a.zip', 'model.usdz'))).toBeNull();
    expect(await cache.list()).toEqual([]);
    await expect(cache.remove('bundle:a.zip/model.usdz')).resolves.toBeUndefined();
  });

  it('runs on IndexedDB', async () => {
    const backend = await IdbBackend.open(new IDBFactory());
    const cache = new CaptureCache(backend, async () => DEFAULT_BUDGET, clock());
    expect(await cache.store(input('idb.zip', 64))).toBe(true);
    const r = await new CaptureCache(backend).restore(captureModelUrl('idb.zip', 'model.usdz'));
    expect(r?.model).toEqual(new Uint8Array(64).fill(7));
    expect(await backend.get('missing')).toBeNull();
    await backend.delete('missing');
    backend.close();
  });
});

describe('CaptureCache edge cases', () => {
  const url = captureModelUrl('a.zip', 'model.usdz');

  it('restores a bundle whose stored poses are unreadable, without poses', async () => {
    const backend = new MemoryBackend();
    const cache = new CaptureCache(backend);
    await cache.store(input('a.zip'));
    const posesKey = [...backend.data.keys()].find((k) => k.endsWith('/poses.json'))!;
    backend.data.set(posesKey, new TextEncoder().encode('{"schema":"bike-poses/1"}'));
    const r = await cache.restore(url);
    expect(r?.manifest.name).toBe('a.zip');
    expect(r?.poses).toBeNull();
  });

  it('putFile / getFile fail soft when the backend throws, and ignore unknown bundles', async () => {
    const backend = new MemoryBackend();
    const cache = new CaptureCache(backend);
    await cache.store(input('a.zip'));
    expect(await cache.putFile('bundle:other.zip/model.usdz', 'thumb/x.jpg', new Uint8Array(3))).toBe(false);
    expect(await cache.getFile(url, 'thumb/x.jpg')).toBeNull();
    const put = backend.put.bind(backend);
    backend.put = () => Promise.reject(new DOMException('full', 'QuotaExceededError'));
    expect(await cache.putFile(url, 'thumb/x.jpg', new Uint8Array(3))).toBe(false);
    backend.put = put;
    expect(await cache.putFile(url, 'thumb/x.jpg', new Uint8Array(3))).toBe(true);
    backend.get = () => Promise.reject(new DOMException('gone', 'NotReadableError'));
    expect(await cache.getFile(url, 'thumb/x.jpg')).toBeNull();
  });
});
