import { type Zippable, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  CAPTURE_SCHEMA,
  CaptureBundleError,
  POSES_SCHEMA,
  bundleNameOf,
  captureModelUrl,
  looksLikeZip,
  parseManifest,
  parsePoses,
  readCaptureBundle,
  sceneFromCapture,
} from '../src/scene/capture';
import { parseScene } from '../src/scene/schema';

const enc = (v: unknown) => new TextEncoder().encode(typeof v === 'string' ? v : JSON.stringify(v));
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.5, 1, 2, 1];
const manifest = {
  schema: CAPTURE_SCHEMA,
  name: 'Trek Domane SL6',
  createdAt: '2026-10-20T14:03:11Z',
  device: 'iPhone',
  systemVersion: '18.1',
  mode: 'object',
  model: 'model.usdz',
  poses: 'poses.json',
  images: 'images/',
  imageCount: 2,
};
const poses = { schema: POSES_SCHEMA, samples: [{ sample: 0, file: 'IMG_0000.HEIC', transform: identity }, { sample: 1, transform: identity }] };
// Stand-in bytes: the parser never interprets the model, it only hands it to the loader.
const modelBytes = new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9]);

/** Mimics the iOS export: NSFileCoordinator zips the staging folder, so everything is nested. */
function bundle(files: Record<string, unknown> = {}, prefix = 'export-1234/'): Uint8Array {
  const base: Record<string, unknown> = {
    'manifest.json': manifest,
    'model.usdz': modelBytes,
    'poses.json': poses,
    'images/IMG_0000.HEIC': new Uint8Array(64),
    'images/IMG_0001.HEIC': new Uint8Array(64),
    'record.json': {},
  };
  const zippable: Zippable = {};
  for (const [path, v] of Object.entries({ ...base, ...files })) {
    if (v === undefined) continue;
    zippable[prefix + path] = v instanceof Uint8Array ? v : enc(v);
  }
  return zipSync(zippable);
}

describe('readCaptureBundle', () => {
  it('reads an iOS export nested in a folder', async () => {
    const b = await readCaptureBundle(bundle());
    expect(b.manifest).toMatchObject({ name: 'Trek Domane SL6', mode: 'object', model: 'model.usdz', imageCount: 2 });
    expect(b.model.path).toBe('model.usdz');
    expect(b.model.format).toBe('usdz');
    expect([...b.model.data]).toEqual([...modelBytes]);
    expect(b.poses?.samples).toHaveLength(2);
    expect(b.poses?.samples[0]).toEqual({ sample: 0, file: 'IMG_0000.HEIC', transform: identity });
    expect(b.images).toEqual(['images/IMG_0000.HEIC', 'images/IMG_0001.HEIC']);
    expect(b.root).toBe('export-1234/');
    expect(b.warnings).toEqual([]);
  });

  it('reads a flat zip and ignores Finder junk', async () => {
    const zip = zipSync({
      '__MACOSX/manifest.json': enc('garbage'),
      '__MACOSX/._model.usdz': new Uint8Array(4),
      'manifest.json': enc(manifest),
      'model.usdz': modelBytes,
      'poses.json': enc(poses),
    });
    const b = await readCaptureBundle(zip);
    expect(b.root).toBe('');
    expect(b.manifest.name).toBe('Trek Domane SL6');
    expect(b.model.path).toBe('model.usdz');
  });

  it('falls back to a converted model next to the manifest', async () => {
    const b = await readCaptureBundle(bundle({ 'model.usdz': undefined, 'model.glb': modelBytes, 'manifest.json': { ...manifest, model: null } }));
    expect(b.model).toMatchObject({ path: 'model.glb', format: 'glb' });
  });

  it('prefers GLB over USDZ when the manifest has no model', async () => {
    const b = await readCaptureBundle(bundle({ 'model.glb': modelBytes, 'manifest.json': { ...manifest, model: undefined } }));
    expect(b.model.format).toBe('glb');
  });

  it('explains a capture that was never reconstructed', async () => {
    const zip = bundle({ 'model.usdz': undefined, 'manifest.json': { ...manifest, model: null } });
    await expect(readCaptureBundle(zip)).rejects.toThrow(/no 3D model yet/);
  });

  it('explains a model listed but missing', async () => {
    await expect(readCaptureBundle(bundle({ 'model.usdz': undefined }))).rejects.toThrow(/model\.usdz is listed/);
  });

  it('rejects zips without a manifest, foreign manifests and non-zips', async () => {
    await expect(readCaptureBundle(zipSync({ 'model.usdz': modelBytes }))).rejects.toThrow(/manifest\.json is missing/);
    await expect(readCaptureBundle(bundle({ 'manifest.json': { ...manifest, schema: 'other/1' } }))).rejects.toThrow(/bike-capture\/1/);
    await expect(readCaptureBundle(bundle({ 'manifest.json': '{nope' }))).rejects.toThrow(/not valid JSON/);
    await expect(readCaptureBundle(enc('not a zip at all, just text'))).rejects.toBeInstanceOf(CaptureBundleError);
  });

  it('keeps going without poses when poses.json is broken or missing', async () => {
    const broken = await readCaptureBundle(bundle({ 'poses.json': { schema: POSES_SCHEMA, samples: [{ sample: 0, transform: [1, 2] }] } }));
    expect(broken.poses).toBeNull();
    expect(broken.warnings[0]).toMatch(/samples\[0\]/);
    const missing = await readCaptureBundle(bundle({ 'poses.json': undefined }));
    expect(missing.poses).toBeNull();
    expect(missing.warnings[0]).toMatch(/missing/);
    const unlisted = await readCaptureBundle(bundle({ 'poses.json': undefined, 'manifest.json': { ...manifest, poses: null } }));
    expect(unlisted.warnings).toEqual([]);
  });

  it('refuses entries that would inflate past the limits', async () => {
    const zip = bundle({ 'model.usdz': new Uint8Array(4096) });
    await expect(readCaptureBundle(zip, { maxJsonBytes: 1 << 20, maxModelBytes: 1024 })).rejects.toThrow(/too large/);
  });
});

describe('parseManifest / parsePoses', () => {
  it('fills safe defaults', () => {
    const m = parseManifest({ schema: CAPTURE_SCHEMA, name: '  ', mode: 'weird', imageCount: -3 });
    expect(m).toEqual({ schema: CAPTURE_SCHEMA, name: 'Captured bike', mode: 'object', model: null, poses: null, images: 'images/' });
    expect(parseManifest({ ...manifest, mode: 'area' }).mode).toBe('area');
  });

  it('rejects non-finite transforms', () => {
    expect(() => parsePoses({ schema: POSES_SCHEMA, samples: [{ sample: 0, transform: [...identity.slice(0, 15), NaN] }] })).toThrow(CaptureBundleError);
    expect(() => parsePoses({ schema: POSES_SCHEMA })).toThrow(/samples/);
  });
});

describe('capture scenes', () => {
  it('builds a valid scene with a stable id and a bundle model URL', async () => {
    const b = await readCaptureBundle(bundle());
    const scene = sceneFromCapture(b, 'trek.bikecapture.zip');
    expect(scene.id).toBe('capture-trek-domane-sl6-20261020140311');
    expect(scene.name).toBe('Trek Domane SL6');
    expect(scene.model).toEqual({ url: 'bundle:trek.bikecapture.zip/model.usdz', format: 'usdz' });
    expect(parseScene(JSON.parse(JSON.stringify(scene)))).toEqual(scene);
    expect(sceneFromCapture(b, 'trek.bikecapture.zip').id).toBe(scene.id);
  });

  it('maps model URLs back to their bundle', () => {
    expect(bundleNameOf(captureModelUrl('a b.bikecapture.zip', 'model.usdz'))).toBe('a b.bikecapture.zip');
    expect(bundleNameOf('bike.glb')).toBeNull();
    expect(bundleNameOf('https://x/y.glb')).toBeNull();
  });

  it('sniffs zip magic', () => {
    expect(looksLikeZip(bundle())).toBe(true);
    expect(looksLikeZip(enc('{"schema":1}'))).toBe(false);
  });
});

describe('fixture generator', () => {
  it('produces a bundle the importer reads', async () => {
    const { makeBundle } = await import('../../../tools/fixtures/make-capture.mjs');
    const b = await readCaptureBundle(makeBundle({ count: 6, closeups: false }));
    expect(b.manifest.name).toBe('Fixture Road Bike');
    expect(b.model.format).toBe('usdz');
    expect(b.poses?.samples).toHaveLength(6);
    expect(b.images).toHaveLength(6);
    expect(b.warnings).toEqual([]);
  });
});
