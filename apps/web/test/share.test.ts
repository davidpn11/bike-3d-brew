import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { type BikeScene, SCHEMA } from '../src/scene/schema';
import {
  MANIFEST_FILE,
  SCENE_FILE,
  SHARE_LIMITS,
  SHARE_SCHEMA,
  ShareError,
  buildSharePackage,
  checkPublishedScene,
  checkSceneUrl,
  isAllowedUrl,
  isLocalModel,
  isPackageId,
  modelFileName,
  packageFileName,
  readSharePackage,
  readViewParams,
  shareLink,
  shareOption,
  stableJson,
} from '../src/scene/share';

const PAGE = 'https://shop.example/bike-3d-brew/app/?e2e';
const GLB = new Uint8Array([...strToU8('glTF'), 2, 0, 0, 0, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function scene(over: Partial<BikeScene> = {}): BikeScene {
  return {
    schema: SCHEMA,
    id: 'capture-gravel-1',
    name: 'Gravel Bike X',
    model: { url: 'bundle:bike.bikecapture.zip/model.glb', format: 'glb' },
    background: 'transparent',
    hotspots: [
      { id: 'hs-fork', name: 'Fork', view: { position: [1, 1, 1], target: [0, 0.5, 0] } },
      { id: 'hs-rear', name: 'Rear end', view: { position: [-1, 1, 1], target: [0, 0.5, 0] }, photos: ['blob:http://x/1', 'https://cdn.example/a.jpg'] },
    ],
    annotations: [{ id: 'n1', position: [0, 1, 0], title: 'Fork', body: '**Carbon**', kind: 'feature', hotspotId: 'hs-fork', createdAt: '2026-01-01T00:00:00Z' }],
    ...over,
  };
}

describe('readViewParams', () => {
  it('defaults', () => {
    expect(readViewParams('')).toEqual({ scene: null, readOnly: false, present: false, kiosk: false, interval: 8000, idle: 20000, fresh: false });
  });

  it('the customer link is read-only, present and fresh', () => {
    const p = readViewParams('?scene=scenes/demo/scene.bike.json&view=present');
    expect(p).toMatchObject({ scene: 'scenes/demo/scene.bike.json', readOnly: true, present: true, fresh: true, kiosk: false });
  });

  it('mode=present, kiosk, timing (clamped seconds) and fresh', () => {
    expect(readViewParams('?mode=present&fresh').present).toBe(true);
    expect(readViewParams('?mode=present&fresh').fresh).toBe(true);
    expect(readViewParams('?kiosk=1&interval=3&idle=0.5')).toMatchObject({ kiosk: true, present: true, interval: 3000, idle: 1000 });
    expect(readViewParams('?kiosk&interval=999&idle=9999')).toMatchObject({ kiosk: true, interval: 120_000, idle: 600_000 });
    expect(readViewParams('?kiosk=no&interval=abc&idle=')).toMatchObject({ kiosk: false, interval: 8000, idle: 20000 });
    expect(readViewParams('?scene=%20%20').scene).toBeNull();
  });
});

describe('scene URL checks', () => {
  it('allows same-origin and https, refuses the rest', () => {
    expect(checkSceneUrl('scenes/demo/scene.bike.json', PAGE)).toBe('https://shop.example/bike-3d-brew/app/scenes/demo/scene.bike.json');
    expect(checkSceneUrl('https://cdn.example/s.json', PAGE)).toBe('https://cdn.example/s.json');
    expect(checkSceneUrl('/x.json', 'http://localhost:4190/')).toBe('http://localhost:4190/x.json');
    for (const bad of ['http://evil.example/s.json', 'javascript:alert(1)', 'data:application/json,{}', 'https://user:pw@cdn.example/s.json', 'ftp://x/s.json']) {
      expect(() => checkSceneUrl(bad, PAGE)).toThrow(ShareError);
    }
    expect(() => checkSceneUrl('http://[bad', PAGE)).toThrow(/not a valid URL/);
    expect(isAllowedUrl(new URL('http://localhost:5190/a'), 'http://localhost:5190/')).toBe(true);
  });

  it('checks a fetched scene’s model and photos', () => {
    const href = 'https://shop.example/app/scenes/x/scene.bike.json';
    const ok = checkPublishedScene(scene({ model: { url: 'model.glb', format: 'glb' } }), href, PAGE);
    expect(ok.hotspots[1].photos).toEqual(['https://cdn.example/a.jpg']);
    expect(ok.hotspots[0].photos).toBeUndefined();
    const mixed = scene({ model: { url: 'model.glb', format: 'glb' }, hotspots: [{ id: 'h', name: 'H', view: { position: [0, 0, 0], target: [0, 0, 0] }, photos: ['photos/a.jpg', 'http://evil/b.jpg', 'photos/c.txt', 'http://[bad'] }] });
    expect(checkPublishedScene(mixed, href, PAGE).hotspots[0].photos).toEqual(['photos/a.jpg']);
    expect(() => checkPublishedScene(scene(), href, PAGE)).toThrow(/without its 3D model/);
    expect(() => checkPublishedScene(scene({ model: { url: 'http://evil.example/m.glb', format: 'glb' } }), href, PAGE)).toThrow(/must be on this site or use https/);
    expect(() => checkPublishedScene(scene({ model: { url: 'http://[bad', format: 'glb' } }), href, PAGE)).toThrow(/must be on this site/);
    expect(checkPublishedScene(scene({ model: { url: 'demo:road', format: 'demo' } }), href, PAGE).model.url).toBe('demo:road');
    expect(() => checkPublishedScene(scene({ model: { url: 'https://x/m.glb', format: 'demo' } }), href, PAGE)).toThrow(/Unknown built-in/);
  });
});

describe('share link and options', () => {
  it('builds a clean present link from the page URL', () => {
    expect(shareLink(PAGE, 'scenes/demo/scene.bike.json')).toBe('https://shop.example/bike-3d-brew/app/?scene=scenes/demo/scene.bike.json&view=present');
    expect(shareLink('http://localhost:5190/#x', 'https://cdn.example/a b.json', { kiosk: '1' })).toBe('http://localhost:5190/?scene=https://cdn.example/a%20b.json&view=present&kiosk=1');
    expect(readViewParams(new URL(shareLink(PAGE, 'scenes/a&b.json')).search).scene).toBe('scenes/a&b.json');
  });

  it('stableJson ignores key order and undefined', () => {
    expect(stableJson({ b: 1, a: [1, { d: undefined, c: 'x' }], e: undefined })).toBe(stableJson({ a: [1, { c: 'x' }], b: 1 }));
    expect(stableJson([undefined])).toBe('[null]');
  });

  it('offers the link for an unchanged published scene, flags local edits, else a package', () => {
    const published = { param: 'scenes/x/scene.bike.json', scene: scene({ model: { url: 'model.glb', format: 'glb' } }) };
    expect(shareOption(published.scene, published, PAGE)).toEqual({ kind: 'link', url: 'https://shop.example/bike-3d-brew/app/?scene=scenes/x/scene.bike.json&view=present', stale: false });
    const edited = { ...published.scene, name: 'Renamed' };
    expect(shareOption(edited, published, PAGE)).toMatchObject({ kind: 'link', stale: true });
    expect(shareOption(scene(), null, PAGE)).toEqual({ kind: 'package', reason: 'local-model' });
    expect(shareOption(scene({ id: 'other', model: { url: 'model.glb', format: 'glb' } }), published, PAGE)).toEqual({ kind: 'package', reason: 'not-published' });
    expect(isLocalModel({ url: 'demo:road', format: 'demo' })).toBe(false);
    expect(isLocalModel({ url: 'blob:x', format: 'glb' })).toBe(true);
  });
});

describe('bike-share/1 packages', () => {
  it('round-trips: build → read', () => {
    const photos = new Map([['hs-rear', [JPEG, JPEG]]]);
    const pkg = buildSharePackage({ scene: scene(), model: { bytes: GLB, format: 'glb' }, photos, createdAt: '2026-02-03T00:00:00Z' });
    expect(pkg.id).toBe('gravel-bike-x');
    expect(pkg.filename).toBe('gravel-bike-x.bikeshare.zip');
    expect(pkg.manifest).toEqual({ schema: SHARE_SCHEMA, id: 'gravel-bike-x', name: 'Gravel Bike X', createdAt: '2026-02-03T00:00:00Z', scene: SCENE_FILE, model: 'model.glb', photos: ['photos/02-rear-end-1.jpg', 'photos/02-rear-end-2.jpg'] });
    const files = unzipSync(pkg.bytes);
    expect(Object.keys(files).sort()).toEqual([MANIFEST_FILE, 'model.glb', 'photos/02-rear-end-1.jpg', 'photos/02-rear-end-2.jpg', SCENE_FILE]);
    const read = readSharePackage(pkg.bytes);
    expect(read.id).toBe('gravel-bike-x');
    expect(read.warnings).toEqual([]);
    expect(read.scene.model).toEqual({ url: 'model.glb', format: 'glb' });
    // Local photo URLs are replaced by packaged files; https ones are kept.
    expect(read.scene.hotspots[1].photos).toEqual(['photos/02-rear-end-1.jpg', 'photos/02-rear-end-2.jpg', 'https://cdn.example/a.jpg']);
    expect(read.scene.hotspots[0].photos).toBeUndefined();
    expect(read.scene.annotations[0].body).toBe('**Carbon**');
    expect(read.files.map((f) => f.path)).toEqual([SCENE_FILE, MANIFEST_FILE, 'model.glb', 'photos/02-rear-end-1.jpg', 'photos/02-rear-end-2.jpg']);
    expect(readSharePackage(pkg.bytes, { id: 'demo' }).id).toBe('demo');
  });

  it('packages the demo bike without a model; usdz is stored', () => {
    const demo = buildSharePackage({ scene: scene({ name: '!!!', model: { url: 'demo:road', format: 'demo' }, hotspots: [] }) });
    expect(demo.id).toBe('bike');
    expect(demo.manifest.model).toBeNull();
    expect(readSharePackage(demo.bytes).scene.model.url).toBe('demo:road');
    const usdz = buildSharePackage({ scene: scene({ hotspots: [] }), model: { bytes: new Uint8Array([0x50, 0x4b, 3, 4, 9]), format: 'usdz' } });
    expect(readSharePackage(usdz.bytes).scene.model).toEqual({ url: 'model.usdz', format: 'usdz' });
    expect(() => buildSharePackage({ scene: scene() })).toThrow(/model file is needed/);
    expect(modelFileName('ply')).toBe('model.ply');
    expect(packageFileName('x')).toBe('x.bikeshare.zip');
    expect(isPackageId('demo-1')).toBe(true);
    expect(isPackageId('../x')).toBe(false);
  });

  const good = () => ({
    [SCENE_FILE]: strToU8(JSON.stringify(scene({ model: { url: 'model.glb', format: 'glb' }, hotspots: [{ id: 'h', name: 'H', view: { position: [0, 0, 0], target: [0, 0, 0] }, photos: ['photos/a.jpg'] }] }))),
    [MANIFEST_FILE]: strToU8(JSON.stringify({ schema: SHARE_SCHEMA, id: 'x' })),
    'model.glb': GLB,
    'photos/a.jpg': JPEG,
  });
  const zip = (files: Record<string, Uint8Array>) => zipSync(files);

  it('accepts a minimal valid package and fills manifest defaults', () => {
    const r = readSharePackage(zip(good()));
    expect(r.manifest.createdAt).toBe(new Date(0).toISOString());
    expect(r.manifest.photos).toEqual(['photos/a.jpg']);
  });

  it('refuses anything that is not a scene, a manifest, one model or JPEG photos', () => {
    const cases: [Record<string, Uint8Array>, RegExp][] = [
      [{ ...good(), 'evil.html': strToU8('<script>') }, /Refusing files.*evil\.html/],
      [{ ...good(), '../escape.jpg': JPEG }, /Refusing files/],
      [{ ...good(), 'photos/x.png': JPEG }, /Refusing files/],
      [{ ...good(), 'a/scene.bike.json': JPEG, b: JPEG, c: JPEG, d: JPEG, e: JPEG, f: JPEG }, /…/],
      [{ ...good(), 'model.usdz': new Uint8Array([0x50, 0x4b, 3, 4]) }, /More than one model/],
      [{ ...good(), 'model.glb': strToU8('nope') }, /model\.glb is not the file type/],
      [{ ...good(), 'photos/a.jpg': strToU8('<svg>') }, /photos\/a\.jpg is not the file type/],
      [{ ...good(), [MANIFEST_FILE]: strToU8('{') }, /not valid JSON/],
      [{ ...good(), [MANIFEST_FILE]: strToU8('null') }, /expected schema/],
      [{ ...good(), [MANIFEST_FILE]: strToU8(JSON.stringify({ schema: SHARE_SCHEMA, id: 'Bad Id' })) }, /Invalid package id/],
      [{ ...good(), [SCENE_FILE]: strToU8('{"schema":"nope"}') }, /scene\.bike\.json: scene\.schema/],
      [{ [MANIFEST_FILE]: good()[MANIFEST_FILE] }, /scene\.bike\.json is missing/],
      [{ ...good(), 'model.glb': undefined as unknown as Uint8Array }, /must be the packaged model file \(none found\)/],
      [{ ...good(), [SCENE_FILE]: strToU8(JSON.stringify(scene({ model: { url: 'https://cdn/m.glb', format: 'glb' } }))) }, /must be the packaged model\.glb/],
      [{ ...good(), [SCENE_FILE]: strToU8(JSON.stringify(scene({ model: { url: 'x', format: 'demo' }, hotspots: [] }))) }, /Unknown built-in/],
      [{ ...good(), [SCENE_FILE]: strToU8(JSON.stringify(scene({ model: { url: 'model.glb', format: 'glb' }, hotspots: [{ id: 'h', name: 'H', view: { position: [0, 0, 0], target: [0, 0, 0] }, photos: ['photos/missing.jpg'] }] }))) }, /not in the package: photos\/missing\.jpg/],
    ];
    for (const [files, re] of cases) {
      const clean = Object.fromEntries(Object.entries(files).filter(([, v]) => v));
      expect(() => readSharePackage(zip(clean)), String(re)).toThrow(re);
    }
    expect(() => readSharePackage(strToU8('not a zip'))).toThrow(/Not a zip/);
    expect(() => readSharePackage(new Uint8Array([0x50, 0x4b, 1, 2]))).toThrow(/Could not unzip/);
  });

  it('warns about unused files and accepts https photos and gltf/ply magic', () => {
    const files = good();
    const demoScene = scene({ model: { url: 'demo:road', format: 'demo' }, hotspots: [{ id: 'h', name: 'H', view: { position: [0, 0, 0], target: [0, 0, 0] }, photos: ['https://cdn.example/p.jpg'] }] });
    const r = readSharePackage(zip({ ...files, [SCENE_FILE]: strToU8(JSON.stringify(demoScene)) }));
    expect(r.warnings).toEqual(['photos/a.jpg is not used by any area.', 'model.glb is not used (the scene shows the built-in demo bike).']);
    const gltf = readSharePackage(zip({ [MANIFEST_FILE]: files[MANIFEST_FILE], [SCENE_FILE]: strToU8(JSON.stringify(scene({ model: { url: 'model.gltf', format: 'gltf' }, hotspots: [] }))), 'model.gltf': strToU8('{"asset":{}}') }));
    expect(gltf.manifest.model).toBe('model.gltf');
    const ply = readSharePackage(zip({ [MANIFEST_FILE]: files[MANIFEST_FILE], [SCENE_FILE]: strToU8(JSON.stringify(scene({ model: { url: 'model.ply', format: 'ply' }, hotspots: [] }))), 'model.ply': strToU8('ply\n') }));
    expect(ply.manifest.model).toBe('model.ply');
  });

  it('enforces size limits before inflating', () => {
    const big = new Uint8Array(SHARE_LIMITS.photo + 1);
    big.set(JPEG);
    expect(() => readSharePackage(zip({ ...good(), 'photos/a.jpg': big }))).toThrow(/photos\/a\.jpg is larger than 8 MB/);
    const many: Record<string, Uint8Array> = good();
    for (let i = 0; i <= SHARE_LIMITS.photos; i++) many[`photos/p${i}.jpg`] = JPEG;
    expect(() => readSharePackage(zip(many))).toThrow(/More than 64 photos/);
    const huge = { byteLength: SHARE_LIMITS.zip + 1 } as Uint8Array;
    expect(() => readSharePackage(huge)).toThrow(/larger than 300 MB/);
  });
});
