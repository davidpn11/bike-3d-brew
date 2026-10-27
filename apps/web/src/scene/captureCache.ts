// Keeps opened capture bundles across reloads. A capture scene references its model as
// `bundle:<zip name>/<path>`, which can never be fetched, so without this cache a reload
// asks for the zip again. The cache stores only what the viewer needs (model bytes,
// manifest, poses, and image entries / thumbnails as they are first extracted), keyed by
// that model URL, with LRU eviction under a byte budget.
//
// This module is pure: the browser storage (OPFS / IndexedDB) sits behind `BlobBackend`
// (see src/storage/backends.ts), and `MemoryBackend` stands in for it in tests.

import { type CaptureManifest, type CapturePoses, bundleNameOf, parseManifest, parsePoses } from './capture';
import { type ModelFormat, formatFromFilename } from './schema';

/** Flat key → bytes store. Every method may throw (private mode, quota, Safari quirks). */
export interface BlobBackend {
  readonly kind: string;
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, data: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
}

export class MemoryBackend implements BlobBackend {
  readonly kind = 'memory';
  readonly data = new Map<string, Uint8Array>();
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async put(key: string, data: Uint8Array) {
    this.data.set(key, data.slice());
  }
  async delete(key: string) {
    this.data.delete(key);
  }
}

export interface CachedCapture {
  /** The `bundle:` model URL this entry restores. */
  url: string;
  /** Storage prefix derived from the URL (see `cacheKeyFor`). */
  key: string;
  /** Scene the bundle was opened as, so a different bike that reuses a zip filename never loads the wrong model. */
  sceneId: string;
  name: string;
  bundleName: string;
  modelPath: string;
  format: ModelFormat;
  /** Bundle-relative image paths (the photos themselves are cached lazily, see `putFile`). */
  images: string[];
  /** Extra files stored under this entry (e.g. `img/…`, `thumb/…`) with their sizes. */
  files: Record<string, number>;
  bytes: number;
  storedAt: number;
  lastUsed: number;
}

export interface RestoredCapture {
  entry: CachedCapture;
  manifest: CaptureManifest;
  poses: CapturePoses | null;
  model: Uint8Array;
}

export interface StoreInput {
  url: string;
  sceneId: string;
  manifest: CaptureManifest;
  poses: CapturePoses | null;
  model: { path: string; format: ModelFormat; data: Uint8Array };
  images: string[];
}

// ------------------------------------------------------------------ pure policy

export const DEFAULT_BUDGET = 500 * 2 ** 20;
/** Never take more than this share of the origin quota: other sites' data and our own scenes live there too. */
export const QUOTA_SHARE = 0.5;

/**
 * Byte budget for cached captures: the fixed cap, shrunk to a share of the origin quota when the
 * browser reports one (Safari and private windows can report tiny quotas). `ours` is what the cache
 * already uses, so it counts as available to itself.
 */
export function budgetFor(estimate: { quota?: number; usage?: number } | null, ours = 0, cap = DEFAULT_BUDGET): number {
  const quota = estimate?.quota;
  if (!quota || !Number.isFinite(quota)) return cap;
  const othersUsage = Math.max(0, (estimate?.usage ?? 0) - ours);
  return Math.max(0, Math.min(cap, quota * QUOTA_SHARE - othersUsage));
}

/**
 * Least-recently-used entries to drop so `incoming` more bytes fit under `budget`. Entries in
 * `keep` (the one being written) are never evicted. Returns null when it cannot fit at all.
 */
export function planEviction(entries: Pick<CachedCapture, 'key' | 'bytes' | 'lastUsed'>[], incoming: number, budget: number, keep: string[] = []): string[] | null {
  if (incoming > budget) return null;
  let used = entries.reduce((s, e) => s + e.bytes, 0);
  const evict: string[] = [];
  for (const e of [...entries].sort((a, b) => a.lastUsed - b.lastUsed)) {
    if (used + incoming <= budget) break;
    if (keep.includes(e.key)) continue;
    evict.push(e.key);
    used -= e.bytes;
  }
  return used + incoming <= budget ? evict : null;
}

/**
 * Storage prefix for a `bundle:` URL: readable slug plus a hash, safe as an OPFS file name and
 * an IndexedDB key, and short enough whatever the zip is called.
 */
export function cacheKeyFor(url: string): string {
  const name = bundleNameOf(url) ?? url;
  const slug = name.toLowerCase().replace(/\.bikecapture\.zip$|\.zip$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
  return `cap-${slug || 'bundle'}-${fnv1a(url)}`;
}

/** 32-bit FNV-1a as 8 hex digits: a stable, dependency-free fingerprint (not a security hash). */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 2 ** 20) return `${Math.round(n / 1024)} KB`;
  if (n < 2 ** 30) return `${(n / 2 ** 20).toFixed(n < 10 * 2 ** 20 ? 1 : 0)} MB`;
  return `${(n / 2 ** 30).toFixed(1)} GB`;
}

/** Validates the persisted index; anything malformed is dropped rather than trusted. */
export function parseIndex(input: unknown): CachedCapture[] {
  if (!input || typeof input !== 'object' || !Array.isArray((input as { entries?: unknown }).entries)) return [];
  const out: CachedCapture[] = [];
  for (const e of (input as { entries: unknown[] }).entries) {
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    const str = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : null);
    const num = (k: string) => (typeof r[k] === 'number' && Number.isFinite(r[k]) && (r[k] as number) >= 0 ? (r[k] as number) : null);
    const url = str('url');
    const modelPath = str('modelPath');
    if (!url || !bundleNameOf(url) || !modelPath || !formatFromFilename(modelPath)) continue;
    const files: Record<string, number> = {};
    if (r.files && typeof r.files === 'object') {
      for (const [k, v] of Object.entries(r.files as Record<string, unknown>)) if (typeof v === 'number' && v >= 0) files[k] = v;
    }
    out.push({
      url,
      key: cacheKeyFor(url),
      sceneId: str('sceneId') ?? '',
      name: str('name') ?? 'Captured bike',
      bundleName: bundleNameOf(url)!,
      modelPath,
      format: formatFromFilename(modelPath)!,
      images: Array.isArray(r.images) ? r.images.filter((x): x is string => typeof x === 'string') : [],
      files,
      bytes: num('bytes') ?? 0,
      storedAt: num('storedAt') ?? 0,
      lastUsed: num('lastUsed') ?? 0,
    });
  }
  return out;
}

// ------------------------------------------------------------------ cache

const INDEX_KEY = 'index.json';
const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const dec = (b: Uint8Array) => JSON.parse(new TextDecoder().decode(b)) as unknown;

/**
 * The capture cache. Best effort throughout: a failed write leaves the app exactly as it was
 * before the cache existed (the user drops the zip again), so callers never need to catch.
 */
export class CaptureCache {
  private index: CachedCapture[] | null = null;
  /** Serializes index read-modify-write so concurrent puts (thumbnails) don't lose entries. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly backend: BlobBackend,
    private budget: () => Promise<number> = async () => DEFAULT_BUDGET,
    private now: () => number = Date.now,
  ) {}

  async list(): Promise<CachedCapture[]> {
    return [...(await this.loadIndex())].sort((a, b) => b.lastUsed - a.lastUsed);
  }

  async usage(): Promise<number> {
    return (await this.loadIndex()).reduce((s, e) => s + e.bytes, 0);
  }

  async has(url: string): Promise<boolean> {
    return (await this.loadIndex()).some((e) => e.url === url);
  }

  /** Stores a freshly opened bundle (replacing an older copy of the same URL). Resolves false if it did not fit or storage failed. */
  store(input: StoreInput): Promise<boolean> {
    return this.serial(async () => {
      const key = cacheKeyFor(input.url);
      const manifest = enc(input.manifest);
      const poses = input.poses ? enc(input.poses) : null;
      const bytes = input.model.data.byteLength + manifest.byteLength + (poses?.byteLength ?? 0);
      const index = await this.loadIndex();
      const old = index.find((e) => e.key === key);
      if (old) await this.dropFiles(old);
      const others = index.filter((e) => e.key !== key);
      const evict = planEviction(others, bytes, await this.budget());
      if (!evict) {
        await this.saveIndex(others);
        return false;
      }
      for (const k of evict) await this.dropFiles(others.find((e) => e.key === k)!);
      const kept = others.filter((e) => !evict.includes(e.key));
      try {
        await this.backend.put(`${key}/model`, input.model.data);
        await this.backend.put(`${key}/manifest.json`, manifest);
        if (poses) await this.backend.put(`${key}/poses.json`, poses);
      } catch {
        await this.backend.delete(`${key}/model`).catch(() => {});
        await this.saveIndex(kept);
        return false;
      }
      const t = this.now();
      const entry: CachedCapture = {
        url: input.url,
        key,
        sceneId: input.sceneId,
        name: input.manifest.name,
        bundleName: bundleNameOf(input.url) ?? input.url,
        modelPath: input.model.path,
        format: input.model.format,
        images: input.images,
        files: {},
        bytes,
        storedAt: t,
        lastUsed: t,
      };
      await this.saveIndex([...kept, entry]);
      return true;
    });
  }

  /**
   * Loads a cached bundle for a model URL, or null when it is not cached, belongs to another
   * scene, or its files are gone (evicted by the browser) or corrupt.
   */
  async restore(url: string, sceneId?: string): Promise<RestoredCapture | null> {
    const entry = (await this.loadIndex()).find((e) => e.url === url);
    if (!entry || (sceneId && entry.sceneId && entry.sceneId !== sceneId)) return null;
    try {
      const [model, manifestBytes, posesBytes] = await Promise.all([
        this.backend.get(`${entry.key}/model`),
        this.backend.get(`${entry.key}/manifest.json`),
        this.backend.get(`${entry.key}/poses.json`),
      ]);
      if (!model || !manifestBytes) throw new Error('missing files');
      const manifest = parseManifest(dec(manifestBytes));
      let poses: CapturePoses | null = null;
      try {
        poses = posesBytes ? parsePoses(dec(posesBytes)) : null;
      } catch {
        poses = null;
      }
      void this.touch(entry.key);
      return { entry, manifest, poses, model };
    } catch {
      await this.remove(url);
      return null;
    }
  }

  /** Adds a lazily extracted file (an image, a thumbnail) to an existing entry; counted in its size and evicted with it. */
  putFile(url: string, name: string, data: Uint8Array): Promise<boolean> {
    return this.serial(async () => {
      const index = await this.loadIndex();
      const entry = index.find((e) => e.url === url);
      if (!entry) return false;
      const prev = entry.files[name] ?? 0;
      const others = index.filter((e) => e !== entry);
      const evict = planEviction(others, entry.bytes - prev + data.byteLength, await this.budget());
      if (!evict) return false;
      for (const k of evict) await this.dropFiles(others.find((e) => e.key === k)!);
      try {
        await this.backend.put(`${entry.key}/f/${name}`, data);
      } catch {
        return false;
      }
      const updated = { ...entry, files: { ...entry.files, [name]: data.byteLength }, bytes: entry.bytes - prev + data.byteLength };
      await this.saveIndex([...others.filter((e) => !evict.includes(e.key)), updated]);
      return true;
    });
  }

  async getFile(url: string, name: string): Promise<Uint8Array | null> {
    const entry = (await this.loadIndex()).find((e) => e.url === url);
    if (!entry || !(name in entry.files)) return null;
    try {
      return await this.backend.get(`${entry.key}/f/${name}`);
    } catch {
      return null;
    }
  }

  remove(url: string): Promise<void> {
    return this.serial(async () => {
      const index = await this.loadIndex();
      const entry = index.find((e) => e.url === url);
      if (!entry) return;
      await this.dropFiles(entry);
      await this.saveIndex(index.filter((e) => e !== entry));
    });
  }

  private touch(key: string): Promise<void> {
    return this.serial(async () => {
      const index = await this.loadIndex();
      await this.saveIndex(index.map((e) => (e.key === key ? { ...e, lastUsed: this.now() } : e)));
    });
  }

  private async dropFiles(entry: CachedCapture): Promise<void> {
    const keys = ['model', 'manifest.json', 'poses.json', ...Object.keys(entry.files).map((f) => `f/${f}`)];
    for (const k of keys) await this.backend.delete(`${entry.key}/${k}`).catch(() => {});
  }

  private async loadIndex(): Promise<CachedCapture[]> {
    if (this.index) return this.index;
    try {
      const raw = await this.backend.get(INDEX_KEY);
      this.index = raw ? parseIndex(dec(raw)) : [];
    } catch {
      this.index = [];
    }
    return this.index;
  }

  private async saveIndex(entries: CachedCapture[]): Promise<void> {
    this.index = entries;
    try {
      await this.backend.put(INDEX_KEY, enc({ version: 1, entries }));
    } catch {
      // The in-memory index still serves this tab; the next reload simply finds less cached.
    }
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run.catch(() => false as T);
  }
}
