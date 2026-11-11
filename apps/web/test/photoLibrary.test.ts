// @vitest-environment happy-dom
import { zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureCache } from '../src/scene/captureCache';
import { PhotoLibrary } from '../src/ui/photoLibrary';

// Decoding is mocked (photoDecode.test.ts covers it); this is about caching, laziness and limits.
const decode = vi.hoisted(() => ({ active: 0, peak: 0, gate: null as Promise<void> | null }));
vi.mock('../src/ui/photoDecode', () => ({
  decodePhoto: vi.fn(async (bytes: Uint8Array, path: string) => {
    decode.active++;
    decode.peak = Math.max(decode.peak, decode.active);
    await decode.gate;
    decode.active--;
    if (path.includes('broken')) throw new Error(`cannot decode ${path}`);
    return { width: 4032, height: 3024, close: vi.fn(), bytes };
  }),
  // The "JPEG" records which size it was made for, so tests can tell thumbs from full photos.
  toJpeg: vi.fn(async (_b: unknown, maxSide: number) => new TextEncoder().encode(`jpeg:${maxSide}`)),
}));

const HEIC = new Uint8Array([0, 0, 0, 24, ...'ftypheic'.split('').map((c) => c.charCodeAt(0)), 1, 2, 3, 4]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
const URL_KEY = 'bundle:bike.bikecapture.zip/model.usdz';
const text = (b: Uint8Array | null | undefined) => (b ? new TextDecoder().decode(b) : null);

function zip(): Blob {
  return new Blob([
    zipSync({
      'Cap/images/IMG_0001.HEIC': HEIC,
      'Cap/images/IMG_0002.jpg': JPG,
      'Cap/images/IMG_0003.HEIC': HEIC,
      'Cap/images/IMG_0004.HEIC': HEIC,
      'Cap/images/broken.jpg': JPG,
    }) as BlobPart,
  ]);
}

/** A capture cache that only stores files, which is all PhotoLibrary uses. */
function fakeCache(initial: Record<string, string> = {}) {
  const files = new Map<string, Uint8Array>(Object.entries(initial).map(([k, v]) => [k, new TextEncoder().encode(v)]));
  const cache = {
    files,
    getFile: vi.fn(async (url: string, name: string) => (url === URL_KEY ? (files.get(name) ?? null) : null)),
    putFile: vi.fn(async (_url: string, name: string, data: Uint8Array) => (files.set(name, data), true)),
  };
  return cache as typeof cache & CaptureCache;
}

let blobs: Map<string, Blob>;
beforeEach(() => {
  decode.active = 0;
  decode.peak = 0;
  decode.gate = null;
  blobs = new Map();
  let n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
    const url = `blob:photo-${n++}`;
    blobs.set(url, b as Blob);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const contents = async (url: string | null) => (url ? new TextDecoder().decode(new Uint8Array(await blobs.get(url)!.arrayBuffer())) : null);

describe('PhotoLibrary', () => {
  it('serves cached photos without touching the zip', async () => {
    const cache = fakeCache({ 'thumb/images/IMG_0001.HEIC.jpg': 'cached thumb' });
    const lib = new PhotoLibrary({ url: URL_KEY, zip: null, root: 'Cap/', cache: Promise.resolve(cache), stored: Promise.resolve() });
    expect(lib.hasZip).toBe(false);
    expect(await contents(await lib.get('images/IMG_0001.HEIC', 'thumb'))).toBe('cached thumb');
    // Not cached and no zip (after a reload): nothing to show, and no error either.
    expect(await lib.get('images/IMG_0002.jpg', 'full')).toBeNull();
    expect(lib.errors.size).toBe(0);
  });

  it('extracts, decodes and caches a photo on first use, then reuses the promise', async () => {
    const cache = fakeCache();
    const lib = new PhotoLibrary({ url: URL_KEY, zip: zip(), root: 'Cap/', cache: Promise.resolve(cache), stored: Promise.resolve() });
    expect(lib.hasZip).toBe(true);
    const url = await lib.get('images/IMG_0002.jpg', 'thumb');
    expect(await contents(url)).toBe('jpeg:360');
    expect(lib.get('images/IMG_0002.jpg', 'thumb')).toBe(lib.get('images/IMG_0002.jpg', 'thumb'));
    await vi.waitFor(() => expect(text(cache.files.get('thumb/images/IMG_0002.jpg.jpg'))).toBe('jpeg:360'));
    // JPEG sources are cheap to decode, so only the requested size is made.
    expect(cache.files.has('full/images/IMG_0002.jpg.jpg')).toBe(false);
  });

  it('makes both sizes from one HEIC decode', async () => {
    const cache = fakeCache();
    const { decodePhoto } = await import('../src/ui/photoDecode');
    vi.mocked(decodePhoto).mockClear();
    const lib = new PhotoLibrary({ url: URL_KEY, zip: zip(), root: 'Cap/', cache: Promise.resolve(cache), stored: Promise.resolve() });
    expect(await contents(await lib.get('images/IMG_0001.HEIC', 'thumb'))).toBe('jpeg:360');
    expect(await contents(await lib.get('images/IMG_0001.HEIC', 'full'))).toBe('jpeg:2048');
    expect(decodePhoto).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect([...cache.files.keys()].sort()).toEqual(['full/images/IMG_0001.HEIC.jpg', 'thumb/images/IMG_0001.HEIC.jpg']));
  });

  it('waits for the bundle to be stored before caching thumbnails, and works without a cache', async () => {
    const cache = fakeCache();
    let stored = () => {};
    const lib = new PhotoLibrary({ url: URL_KEY, zip: zip(), root: 'Cap/', cache: Promise.resolve(cache), stored: new Promise<void>((r) => (stored = r)) });
    await lib.get('images/IMG_0002.jpg', 'full');
    expect(cache.putFile).not.toHaveBeenCalled();
    stored();
    await vi.waitFor(() => expect(cache.putFile).toHaveBeenCalledTimes(1));

    const noCache = new PhotoLibrary({ url: URL_KEY, zip: zip(), root: 'Cap/', cache: Promise.resolve(null), stored: Promise.resolve() });
    expect(await contents(await noCache.get('images/IMG_0002.jpg', 'full'))).toBe('jpeg:2048');
  });

  it('records why a photo is unavailable', async () => {
    const lib = new PhotoLibrary({ url: URL_KEY, zip: zip(), root: 'Cap/', cache: Promise.resolve(null), stored: Promise.resolve() });
    expect(await lib.get('images/missing.HEIC', 'thumb')).toBeNull();
    expect(lib.errors.get('images/missing.HEIC')).toMatch(/not in the bundle/);
    expect(await lib.get('images/broken.jpg', 'thumb')).toBeNull();
    expect(lib.errors.get('images/broken.jpg')).toMatch(/cannot decode/);
    const throwing = new PhotoLibrary({ url: URL_KEY, zip: zip(), root: 'Cap/', cache: Promise.reject('storage gone'), stored: Promise.resolve() });
    expect(await throwing.get('images/IMG_0002.jpg', 'thumb')).toBeNull();
    expect(throwing.errors.get('images/IMG_0002.jpg')).toBe('storage gone');
  });

  it('decodes at most two photos at a time', async () => {
    let open = () => {};
    decode.gate = new Promise<void>((r) => (open = r));
    const lib = new PhotoLibrary({ url: URL_KEY, zip: zip(), root: 'Cap/', cache: Promise.resolve(null), stored: Promise.resolve() });
    const all = ['images/IMG_0001.HEIC', 'images/IMG_0002.jpg', 'images/IMG_0003.HEIC', 'images/IMG_0004.HEIC'].map((p) => lib.get(p, 'thumb'));
    await vi.waitFor(() => expect(decode.active).toBe(2));
    open();
    expect((await Promise.all(all)).every(Boolean)).toBe(true);
    expect(decode.peak).toBe(2);
  });

  it('revokes its object URLs on dispose', async () => {
    const lib = new PhotoLibrary({ url: URL_KEY, zip: zip(), root: 'Cap/', cache: Promise.resolve(null), stored: Promise.resolve() });
    const a = await lib.get('images/IMG_0002.jpg', 'thumb');
    lib.dispose();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(a);
    // A fresh request after dispose decodes again instead of returning a revoked URL.
    expect(await lib.get('images/IMG_0002.jpg', 'thumb')).not.toBe(a);
  });
});
