import { describe, expect, it } from 'vitest';
import { SCHEMA, SceneValidationError, emptyScene, formatFromFilename, newId, parseCrop, parseScene } from '../src/scene/schema';

const valid = {
  schema: SCHEMA,
  id: 'bike-1',
  name: 'Test',
  model: { url: 'bike.glb', format: 'glb', scale: 2 },
  background: 'green',
  hotspots: [{ id: 'hs-fork', name: 'Fork', view: { position: [1, 1, 1], target: [0, 0.5, 0] } }],
  annotations: [
    { id: 'n1', position: [0.4, 0.5, 0], title: 'Carbon fork', body: '', kind: 'feature', hotspotId: 'hs-fork', price: '+$1' },
    { id: 'n2', position: [0, 0, 0], title: 'Orphan', kind: 'bogus', hotspotId: 'missing' },
  ],
};

describe('parseScene', () => {
  it('round-trips a valid scene', () => {
    const s = parseScene(valid);
    expect(s.model).toEqual({ url: 'bike.glb', format: 'glb', scale: 2 });
    expect(s.background).toBe('green');
    expect(s.annotations[0]).toMatchObject({ title: 'Carbon fork', hotspotId: 'hs-fork', price: '+$1' });
    expect(parseScene(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it('repairs unknown kinds and dangling area references', () => {
    const n2 = parseScene(valid).annotations[1];
    expect(n2.kind).toBe('note');
    expect(n2.hotspotId).toBeUndefined();
  });

  it('rejects other schemas and malformed vectors', () => {
    expect(() => parseScene({ ...valid, schema: 'bike-scene/0' })).toThrow(SceneValidationError);
    expect(() => parseScene({ ...valid, annotations: [{ id: 'x', position: [0, 'a', 0] }] })).toThrow(/annotations\[0\]\.position/);
    expect(() => parseScene({ ...valid, model: { url: 'x', format: 'obj' } })).toThrow(/format/);
  });

  it('rejects structurally broken input with a path to the problem', () => {
    expect(() => parseScene(null)).toThrow(/^scene: expected object/);
    expect(() => parseScene([])).toThrow(SceneValidationError);
    expect(() => parseScene({ ...valid, model: undefined })).toThrow(/scene\.model\.url/);
    expect(() => parseScene({ ...valid, model: { url: 3, format: 'glb' } })).toThrow(/scene\.model\.url/);
    expect(() => parseScene({ ...valid, hotspots: [{ id: 'h' }] })).toThrow(/hotspots\[0\]: expected/);
    expect(() => parseScene({ ...valid, hotspots: [{ id: 'h', name: 'H', view: 3 }] })).toThrow(/hotspots\[0\]\.view: expected object/);
    expect(() => parseScene({ ...valid, hotspots: [{ id: 'h', name: 'H', view: { position: [0, 0, 0] } }] })).toThrow(/view\.target/);
    expect(() => parseScene({ ...valid, hotspots: [{ id: 'h', name: 'H', view: { target: [0, 0, 0], position: [0, 0] } }] })).toThrow(/view\.position/);
    expect(() => parseScene({ ...valid, annotations: ['x'] })).toThrow(/annotations\[0\]: expected/);
    expect(() => parseScene({ ...valid, annotations: [{ id: 'x', position: [0, 0, Infinity] }] })).toThrow(/position/);
  });

  it('fills defaults for missing optional fields', () => {
    const s = parseScene({ schema: SCHEMA, model: { url: 'demo:road', format: 'demo' }, hotspots: 'nope', annotations: [{ id: 'a', position: [0, 0, 0] }] });
    expect(s.id).toMatch(/^bike-/);
    expect(s.name).toBe('Untitled bike');
    expect(s.hotspots).toEqual([]);
    expect(s.annotations[0]).toEqual({ id: 'a', position: [0, 0, 0], title: '', body: '', kind: 'note', createdAt: new Date(0).toISOString() });
  });

  it('keeps optional model transform, bike details, photos and normals; drops junk', () => {
    const s = parseScene({
      ...valid,
      brand: 'Brew',
      modelName: 'R1',
      year: 2026,
      price: '$1',
      model: { url: 'a.usdz', format: 'usdz', scale: 0.01, rotation: [0, 1, 0], offset: [0, 0.1, 0] },
      hotspots: [{ id: 'hs', name: 'Fork', view: { position: [1, 1, 1], target: [0, 0, 0] }, photos: ['a.jpg', 3, 'b.jpg'] }],
      annotations: [{ id: 'n', position: [0, 0, 0], normal: [0, 1, 0], hotspotId: 'hs', createdAt: '2026-01-01T00:00:00Z' }],
    });
    expect(s.model).toEqual({ url: 'a.usdz', format: 'usdz', scale: 0.01, rotation: [0, 1, 0], offset: [0, 0.1, 0] });
    expect(s).toMatchObject({ brand: 'Brew', modelName: 'R1', year: 2026, price: '$1' });
    expect(s.hotspots[0].photos).toEqual(['a.jpg', 'b.jpg']);
    expect(s.annotations[0]).toMatchObject({ normal: [0, 1, 0], hotspotId: 'hs', createdAt: '2026-01-01T00:00:00Z' });
    const junk = parseScene({ ...valid, brand: 3, year: '2026', model: { url: 'a.glb', format: 'glb', scale: 'big', rotation: [0, 0] } });
    expect(junk.brand).toBeUndefined();
    expect(junk.year).toBeUndefined();
    expect(junk.model).toEqual({ url: 'a.glb', format: 'glb' });
  });

  it('defaults background for unknown modes', () => {
    expect(parseScene({ ...valid, background: 'pink' }).background).toBe('transparent');
  });
});

describe('helpers', () => {
  it('detects model formats from filenames', () => {
    expect(formatFromFilename('Bike.USDZ')).toBe('usdz');
    expect(formatFromFilename('scan.ply')).toBe('ply');
    expect(formatFromFilename('photo.jpg')).toBeNull();
  });

  it('detects every supported model format and rejects names without one', () => {
    expect(['a.glb', 'a.gltf', 'a.usdz', 'a.ply'].map(formatFromFilename)).toEqual(['glb', 'gltf', 'usdz', 'ply']);
    expect(formatFromFilename('README')).toBeNull();
  });

  it('makes unique prefixed ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newId('note')));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^note-[a-z0-9]+$/);
  });

  it('creates empty scenes that validate', () => {
    const s = emptyScene({ url: 'a.glb', format: 'glb' }, 'Mine');
    expect(parseScene(s)).toEqual(s);
  });

  it('keeps a valid crop box and stays compatible with scenes without one', () => {
    expect(parseScene(valid).crop).toBeUndefined();
    const crop = { min: [-1, 0, -0.4], max: [1, 1.2, 0.4], enabled: true };
    const s = parseScene({ ...valid, crop });
    expect(s.crop).toEqual(crop);
    expect(parseScene(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(parseScene({ ...valid, crop: { ...crop, enabled: false } }).crop?.enabled).toBe(false);
  });

  it('repairs or drops malformed crop boxes instead of rejecting the scene', () => {
    expect(parseCrop({ min: [1, 1, 1], max: [0, 2, 0] })).toEqual({ min: [0, 1, 0], max: [1, 2, 1], enabled: true });
    expect(parseCrop({ min: [0, 0, 0], max: [1, 0, 1] })).toBeUndefined();
    expect(parseCrop({ min: [0, 0], max: [1, 1, 1] })).toBeUndefined();
    expect(parseCrop({ min: [0, 0, NaN], max: [1, 1, 1] })).toBeUndefined();
    expect(parseCrop('box')).toBeUndefined();
    expect(parseScene({ ...valid, crop: { min: 'x' } }).crop).toBeUndefined();
  });
});
