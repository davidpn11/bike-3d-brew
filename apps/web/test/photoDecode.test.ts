// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Browser image APIs (createImageBitmap, <img>.decode, OffscreenCanvas, Worker) are stubbed: the
// point is the fallback order and the worker protocol, not pixels. Real decoding runs in the E2E suite.

const HEIC = new Uint8Array([0, 0, 0, 24, ...'ftypheic'.split('').map((c) => c.charCodeAt(0)), 0, 0, 0, 0]);
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const bitmap = (w = 4000, h = 3000) => ({ width: w, height: h, close: vi.fn() }) as unknown as ImageBitmap;

class FakeWorker {
  static last: FakeWorker | null = null;
  static created = 0;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  posted: { id: number; bytes: Uint8Array }[] = [];
  transfers: Transferable[][] = [];
  terminate = vi.fn();
  constructor() {
    FakeWorker.last = this;
    FakeWorker.created++;
  }
  postMessage(msg: { id: number; bytes: Uint8Array }, transfer: Transferable[]) {
    this.posted.push(msg);
    this.transfers.push(transfer);
  }
  reply(data: Record<string, unknown>) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

class FakeImageData {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}

let imgDecode: () => Promise<void>;

async function load() {
  vi.resetModules();
  return import('../src/ui/photoDecode');
}

beforeEach(() => {
  FakeWorker.last = null;
  FakeWorker.created = 0;
  imgDecode = () => Promise.reject(new Error('img cannot decode'));
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('ImageData', FakeImageData);
  vi.stubGlobal(
    'Image',
    class {
      src = '';
      decode = () => imgDecode();
    },
  );
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:photo');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('decodePhoto', () => {
  it('uses createImageBitmap when the browser decodes the format natively', async () => {
    const native = bitmap();
    const cib = vi.fn(async () => native);
    vi.stubGlobal('createImageBitmap', cib);
    const { decodePhoto } = await load();
    expect(await decodePhoto(PNG, 'images/a.png')).toBe(native);
    expect((cib.mock.calls[0] as unknown[])[0]).toBeInstanceOf(Blob);
    expect(((cib.mock.calls[0] as unknown[])[0] as Blob).type).toBe('image/png');
  });

  it('falls back to an <img> element (Safari decodes HEIC there but not in createImageBitmap)', async () => {
    const fromImg = bitmap();
    vi.stubGlobal('createImageBitmap', async (src: unknown) => {
      if (src instanceof Blob) throw new Error('unsupported');
      return fromImg;
    });
    imgDecode = () => Promise.resolve();
    const { decodePhoto } = await load();
    expect(await decodePhoto(HEIC, 'images/a.HEIC')).toBe(fromImg);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:photo');
    expect(FakeWorker.created).toBe(0);
  });

  it('gives up on formats nobody can decode', async () => {
    vi.stubGlobal('createImageBitmap', async () => {
      throw new Error('unsupported');
    });
    const { decodePhoto, PhotoDecodeError } = await load();
    await expect(decodePhoto(PNG, 'images/a.tiff')).rejects.toBeInstanceOf(PhotoDecodeError);
    await expect(decodePhoto(PNG, 'images/a.tiff')).rejects.toThrow(/Unsupported image format: images\/a\.tiff/);
  });

  it('decodes HEIC in the libheif worker, transferring a copy of the bytes', async () => {
    const out = bitmap(2, 1);
    vi.stubGlobal('createImageBitmap', async (src: unknown) => {
      if (src instanceof FakeImageData) return out;
      throw new Error('unsupported');
    });
    const { decodePhoto } = await load();
    const pending = decodePhoto(HEIC, 'images/a.HEIC');
    await vi.waitFor(() => expect(FakeWorker.last?.posted).toHaveLength(1));
    const w = FakeWorker.last!;
    const { id, bytes } = w.posted[0];
    expect(bytes).toEqual(HEIC);
    expect(bytes).not.toBe(HEIC);
    expect(w.transfers[0]).toEqual([bytes.buffer]);
    w.reply({ id: 999 }); // unknown job: ignored
    w.reply({ id, width: 2, height: 1, data: new Uint8ClampedArray(8) });
    expect(await pending).toBe(out);

    // The worker is reused; decoder errors reject that one photo only.
    const second = decodePhoto(HEIC, 'images/b.HEIC');
    await vi.waitFor(() => expect(w.posted).toHaveLength(2));
    w.reply({ id: w.posted[1].id, error: 'bad file' });
    await expect(second).rejects.toThrow(/Could not decode HEIC: bad file/);
    const third = decodePhoto(HEIC, 'images/c.HEIC');
    await vi.waitFor(() => expect(w.posted).toHaveLength(3));
    w.reply({ id: w.posted[2].id });
    await expect(third).rejects.toThrow(/empty result/);
    expect(FakeWorker.created).toBe(1);
  });

  it('fails pending HEIC jobs when the worker cannot load, then starts a fresh worker', async () => {
    vi.stubGlobal('createImageBitmap', async (src: unknown) => {
      if (src instanceof FakeImageData) return bitmap();
      throw new Error('unsupported');
    });
    const { decodePhoto } = await load();
    const a = decodePhoto(HEIC, 'a.HEIC');
    const b = decodePhoto(HEIC, 'b.HEIC');
    await vi.waitFor(() => expect(FakeWorker.last?.posted).toHaveLength(2));
    const broken = FakeWorker.last!;
    broken.onerror?.({ message: 'wasm 404' } as ErrorEvent);
    await expect(a).rejects.toThrow(/HEIC decoder failed to load: wasm 404/);
    await expect(b).rejects.toThrow(/wasm 404/);
    expect(broken.terminate).toHaveBeenCalled();
    const c = decodePhoto(HEIC, 'c.HEIC');
    await vi.waitFor(() => expect(FakeWorker.created).toBe(2));
    FakeWorker.last!.onerror?.({ message: '' } as ErrorEvent);
    await expect(c).rejects.toThrow(/worker error/);
  });
});

describe('toJpeg', () => {
  it('downscales to fit the longest side and encodes JPEG on an OffscreenCanvas', async () => {
    const draws: unknown[][] = [];
    const sizes: number[][] = [];
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        constructor(w: number, h: number) {
          sizes.push([w, h]);
        }
        getContext = () => ({ drawImage: (...a: unknown[]) => draws.push(a) });
        convertToBlob = async (o: { type: string; quality: number }) => new Blob([new Uint8Array([0xff, 0xd8, Math.round(o.quality * 100)])], { type: o.type });
      },
    );
    const { toJpeg } = await load();
    expect(await toJpeg(bitmap(4000, 3000), 360, 0.5)).toEqual(new Uint8Array([0xff, 0xd8, 50]));
    expect(sizes[0]).toEqual([360, 270]);
    await toJpeg(bitmap(100, 50), 360);
    expect(sizes[1]).toEqual([100, 50]); // never upscales
    await toJpeg(bitmap(10000, 1), 100);
    expect(sizes[2]).toEqual([100, 1]); // at least one pixel
    expect(draws).toHaveLength(3);
  });

  it('reports a missing 2D context', async () => {
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext = () => null;
      },
    );
    const { toJpeg } = await load();
    await expect(toJpeg(bitmap(), 100)).rejects.toThrow(/2D canvas unavailable/);
  });

  it('falls back to a DOM canvas without OffscreenCanvas', async () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    let encodeOk = true;
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback, type?: string) {
      cb(encodeOk ? new Blob([new Uint8Array([this.width, this.height])], { type }) : null);
    });
    const { toJpeg } = await load();
    expect(await toJpeg(bitmap(200, 100), 100)).toEqual(new Uint8Array([100, 50]));
    expect(drawImage).toHaveBeenCalledTimes(1);
    encodeOk = false;
    await expect(toJpeg(bitmap(200, 100), 100)).rejects.toThrow(/JPEG encode failed/);
  });
});
