import { describe, expect, it } from 'vitest';
import { SCHEMA, SceneValidationError, emptyScene, formatFromFilename, parseCrop, parseScene } from '../src/scene/schema';

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
