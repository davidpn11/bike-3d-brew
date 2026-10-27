import type { CaptureCache } from '../scene/captureCache';
import { isHeif } from '../scene/photos';
import { type ZipEntry, readZipEntry, readZipIndex } from '../scene/zipIndex';
import { decodePhoto, toJpeg } from './photoDecode';

export type PhotoSize = 'thumb' | 'full';
const MAX_SIDE: Record<PhotoSize, number> = { thumb: 360, full: 2048 };
const QUALITY: Record<PhotoSize, number> = { thumb: 0.78, full: 0.86 };
// HEIC decoding is CPU- and memory-heavy (a 12 MP photo is 48 MB of RGBA); two at a time keeps phones alive.
const MAX_PARALLEL = 2;
const MAX_PHOTO_BYTES = 64 << 20;

export interface PhotoLibraryOptions {
  /** The capture's `bundle:` model URL: the cache entry photos are stored under. */
  url: string;
  /** The dropped zip (a File stays on disk); null after a reload, when only cached photos exist. */
  zip: Blob | null;
  /** Folder of the bundle inside the zip. */
  root: string;
  cache: Promise<CaptureCache | null>;
  /** Resolves once the bundle's cache entry exists, so thumbnails can be attached to it. */
  stored: Promise<unknown>;
}

/**
 * Capture photos as displayable JPEG object URLs. Each photo is extracted from the zip only when
 * first shown, decoded (HEIC via WASM where needed), downscaled, and kept in the capture cache so
 * it is instant after a reload, even without the zip.
 */
export class PhotoLibrary {
  private urls = new Map<string, Promise<string | null>>();
  private objectUrls: string[] = [];
  private index: Promise<Map<string, ZipEntry>> | null = null;
  private running = 0;
  private waiting: (() => void)[] = [];
  readonly errors = new Map<string, string>();

  constructor(private opts: PhotoLibraryOptions) {}

  get hasZip(): boolean {
    return !!this.opts.zip;
  }

  get(path: string, size: PhotoSize): Promise<string | null> {
    const key = `${size}:${path}`;
    let p = this.urls.get(key);
    if (!p) {
      p = this.load(path, size).catch((err) => {
        this.errors.set(path, err instanceof Error ? err.message : String(err));
        return null;
      });
      this.urls.set(key, p);
    }
    return p;
  }

  dispose(): void {
    for (const u of this.objectUrls) URL.revokeObjectURL(u);
    this.objectUrls = [];
    this.urls.clear();
  }

  private async load(path: string, size: PhotoSize): Promise<string | null> {
    const cache = await this.opts.cache;
    const name = `${size}/${path}.jpg`;
    const cached = await cache?.getFile(this.opts.url, name);
    if (cached) return this.objectUrl(cached);
    const zip = this.opts.zip;
    if (!zip) return null;
    this.index ??= readZipIndex(zip);
    const entry = (await this.index).get(this.opts.root + path);
    if (!entry) throw new Error(`${path} is not in the bundle`);
    const other: PhotoSize = size === 'thumb' ? 'full' : 'thumb';
    const [jpeg, extra] = await this.limited(async () => {
      const bytes = await readZipEntry(zip, entry, MAX_PHOTO_BYTES);
      const bitmap = await decodePhoto(bytes, path);
      try {
        // HEIC decoding is the slow part, so make both sizes from one decode (thumbnails are
        // almost always followed by a tap on one of them).
        const both = isHeif(bytes) && !this.urls.has(`${other}:${path}`);
        return [await toJpeg(bitmap, MAX_SIDE[size], QUALITY[size]), both ? await toJpeg(bitmap, MAX_SIDE[other], QUALITY[other]) : null] as const;
      } finally {
        bitmap.close();
      }
    });
    this.keep(cache, `${size}/${path}.jpg`, jpeg);
    if (extra) {
      this.keep(cache, `${other}/${path}.jpg`, extra);
      this.urls.set(`${other}:${path}`, Promise.resolve(this.objectUrl(extra)));
    }
    return this.objectUrl(jpeg);
  }

  private keep(cache: CaptureCache | null, name: string, jpeg: Uint8Array): void {
    void this.opts.stored.then(() => cache?.putFile(this.opts.url, name, jpeg));
  }

  private objectUrl(bytes: Uint8Array): string {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/jpeg' }));
    this.objectUrls.push(url);
    return url;
  }

  private async limited<T>(fn: () => Promise<T>): Promise<T> {
    while (this.running >= MAX_PARALLEL) await new Promise<void>((r) => this.waiting.push(r));
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      this.waiting.shift()?.();
    }
  }
}
