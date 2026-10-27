// Decodes HEIC/HEIF (iPhone photos) for browsers that cannot (Chrome, Firefox). libheif is ~2 MB
// of WASM, so it loads only here, in a worker, the first time a HEIC photo is actually needed.

/// <reference lib="webworker" />

interface HeifImage {
  get_width(): number;
  get_height(): number;
  display(target: { data: Uint8ClampedArray; width: number; height: number }, cb: (result: unknown) => void): void;
  free?(): void;
}
interface LibHeif {
  HeifDecoder: new () => { decode(data: Uint8Array): HeifImage[] };
}

let lib: Promise<LibHeif> | null = null;
const load = () => (lib ??= import('libheif-js/libheif-wasm/libheif-bundle.mjs').then((m) => (m.default as () => LibHeif)()));

self.onmessage = async (e: MessageEvent<{ id: number; bytes: Uint8Array }>) => {
  const { id, bytes } = e.data;
  try {
    const libheif = await load();
    const images = new libheif.HeifDecoder().decode(bytes);
    // An iPhone HEIC holds the photo as its primary (first) image; libheif applies its rotation.
    const image = images[0];
    if (!image) throw new Error('no image in HEIC file');
    const width = image.get_width();
    const height = image.get_height();
    const data = new Uint8ClampedArray(width * height * 4);
    await new Promise<void>((resolve, reject) => image.display({ data, width, height }, (r) => (r ? resolve() : reject(new Error('HEIF processing error')))));
    for (const im of images) im.free?.();
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, width, height, data }, [data.buffer]);
  } catch (err) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
