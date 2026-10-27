// Turns capture photo bytes into small JPEGs the page can show. Native decoding first (Safari
// reads HEIC; every browser reads JPEG/PNG); HEIC elsewhere goes through the libheif worker.

import { imageMime, isHeif } from '../scene/photos';

export class PhotoDecodeError extends Error {}

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (d: ImageData) => void; reject: (e: Error) => void }>();

function heicWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./heic.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<{ id: number; width?: number; height?: number; data?: Uint8ClampedArray<ArrayBuffer>; error?: string }>) => {
    const job = pending.get(e.data.id);
    if (!job) return;
    pending.delete(e.data.id);
    const { width, height, data, error } = e.data;
    if (error || !data || !width || !height) job.reject(new PhotoDecodeError(`Could not decode HEIC: ${error ?? 'empty result'}`));
    else job.resolve(new ImageData(data, width, height));
  };
  worker.onerror = (e) => {
    for (const job of pending.values()) job.reject(new PhotoDecodeError(`HEIC decoder failed to load: ${e.message || 'worker error'}`));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function decodeHeic(bytes: Uint8Array): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    // Copy so the transfer never detaches a buffer the caller (or the cache) still holds.
    const copy = bytes.slice();
    heicWorker().postMessage({ id, bytes: copy }, [copy.buffer]);
  });
}

async function viaImgElement(blob: Blob): Promise<ImageBitmap> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return await createImageBitmap(img);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Decodes any capture photo; EXIF / HEIF rotation is applied so the image is upright. */
export async function decodePhoto(bytes: Uint8Array, path: string): Promise<ImageBitmap> {
  const heif = isHeif(bytes);
  const blob = new Blob([bytes as BlobPart], { type: heif ? 'image/heic' : imageMime(path) });
  try {
    return await createImageBitmap(blob);
  } catch {
    // Some engines decode a format in <img> but not in createImageBitmap (Safari and HEIC).
  }
  try {
    return await viaImgElement(blob);
  } catch {
    if (!heif) throw new PhotoDecodeError(`Unsupported image format: ${path}`);
  }
  return createImageBitmap(await decodeHeic(bytes));
}

/** Scales a bitmap down to fit `maxSide` and encodes it as JPEG. */
export async function toJpeg(bitmap: ImageBitmap, maxSide: number, quality = 0.82): Promise<Uint8Array> {
  const s = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * s));
  const h = Math.max(1, Math.round(bitmap.height * s));
  let blob: Blob;
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new PhotoDecodeError('2D canvas unavailable');
    ctx.drawImage(bitmap, 0, 0, w, h);
    blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
    blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new PhotoDecodeError('JPEG encode failed'))), 'image/jpeg', quality));
  }
  return new Uint8Array(await blob.arrayBuffer());
}
