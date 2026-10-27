import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCHEMA, type BikeScene, type Vec3 } from '../src/scene/schema';
import { type KeyValueStorage, SceneStore, safeLocalStorage } from '../src/scene/store';

const base = (): BikeScene => ({
  schema: SCHEMA,
  id: 'b1',
  name: 'Bike',
  model: { url: 'demo:road', format: 'demo' },
  background: 'transparent',
  hotspots: [],
  annotations: [],
});

class MemoryStorage implements KeyValueStorage {
  data = new Map<string, string>();
  getItem = (k: string) => this.data.get(k) ?? null;
  setItem = (k: string, v: string) => void this.data.set(k, v);
}

describe('SceneStore', () => {
  it('adds hotspots and comments, notifies and persists', () => {
    const storage = new MemoryStorage();
    const store = new SceneStore(base(), storage);
    const listener = vi.fn();
    store.subscribe(listener);
    const hs = store.addHotspot({ name: 'Fork', view: { position: [1, 1, 1], target: [0, 0, 0] } });
    const a = store.addAnnotation({ position: [0, 1, 0], title: 'Carbon', body: '', kind: 'feature', hotspotId: hs.id });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.annotationsFor(hs.id).map((x) => x.id)).toEqual([a.id]);
    expect(SceneStore.restore('b1', storage)?.annotations).toHaveLength(1);
  });

  it('keeps comments when their area is deleted', () => {
    const store = new SceneStore(base());
    const hs = store.addHotspot({ name: 'Fork', view: { position: [1, 1, 1], target: [0, 0, 0] } });
    store.addAnnotation({ position: [0, 1, 0], title: 'x', body: '', kind: 'note', hotspotId: hs.id });
    store.removeHotspot(hs.id);
    expect(store.scene.hotspots).toHaveLength(0);
    expect(store.scene.annotations[0].hotspotId).toBeUndefined();
  });

  it('survives a throwing storage', () => {
    const store = new SceneStore(base(), { getItem: () => null, setItem: () => { throw new Error('quota'); } });
    expect(() => store.update({ name: 'Renamed' })).not.toThrow();
    expect(store.scene.name).toBe('Renamed');
  });

  it('restore ignores corrupt data', () => {
    const storage = new MemoryStorage();
    storage.setItem('bike-scene:b1', '{nope');
    expect(SceneStore.restore('b1', storage)).toBeNull();
  });

  it('reads saved copies of other scenes', () => {
    const storage = new MemoryStorage();
    new SceneStore({ ...base(), id: 'capture-1', name: 'Saved' }, storage).update({ price: '$1' });
    const store = new SceneStore(base(), storage);
    expect(store.saved('capture-1')?.price).toBe('$1');
    expect(store.saved('nope')).toBeNull();
  });

  it('updates and removes hotspots and comments by id only', () => {
    const store = new SceneStore(base());
    const view = { position: [1, 1, 1] as Vec3, target: [0, 0, 0] as Vec3 };
    const a = store.addHotspot({ name: 'Fork', view });
    const b = store.addHotspot({ name: 'Saddle', view });
    store.updateHotspot(a.id, { name: 'Fork crown' });
    expect(store.scene.hotspots.map((h) => h.name)).toEqual(['Fork crown', 'Saddle']);
    const n1 = store.addAnnotation({ position: [0, 0, 0], title: 'one', body: '', kind: 'note', hotspotId: a.id });
    const n2 = store.addAnnotation({ position: [0, 0, 0], title: 'two', body: '', kind: 'spec', hotspotId: b.id });
    expect(n1.createdAt).toMatch(/^\d{4}-/);
    store.updateAnnotation(n2.id, { title: 'two!', price: '+$5' });
    expect(store.scene.annotations[1]).toMatchObject({ title: 'two!', price: '+$5', kind: 'spec' });
    expect(store.scene.annotations[0].title).toBe('one');
    expect(store.annotationsFor(null)).toHaveLength(2);
    expect(store.annotationsFor(b.id).map((x) => x.id)).toEqual([n2.id]);
    store.removeHotspot(a.id);
    expect(store.scene.annotations.find((x) => x.id === n2.id)?.hotspotId).toBe(b.id);
    store.removeAnnotation(n1.id);
    expect(store.scene.annotations.map((x) => x.id)).toEqual([n2.id]);
  });

  it('replace swaps the scene, and unsubscribed listeners stop hearing about it', () => {
    const store = new SceneStore(base());
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.replace({ ...base(), id: 'b2', name: 'Other' });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ id: 'b2' }));
    off();
    store.update({ name: 'Again' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('exports pretty JSON that parses back to the same scene', () => {
    const store = new SceneStore(base());
    store.addAnnotation({ position: [0, 1, 0], title: 'x', body: 'y', kind: 'feature' });
    expect(store.toJSON()).toContain('\n  "schema"');
    expect(JSON.parse(store.toJSON())).toEqual(store.scene);
  });

  it('restore without storage or without a saved copy is null', () => {
    expect(SceneStore.restore('b1', null)).toBeNull();
    expect(SceneStore.restore('b1', new MemoryStorage())).toBeNull();
    expect(new SceneStore(base()).saved('b1')).toBeNull();
  });
});

describe('safeLocalStorage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns working storage after a probe write', () => {
    const storage = Object.assign(new MemoryStorage(), { removeItem: vi.fn() });
    vi.stubGlobal('window', { localStorage: storage });
    expect(safeLocalStorage()).toBe(storage);
    expect(storage.removeItem).toHaveBeenCalledWith('__bike_probe__');
  });

  it('returns null when storage is blocked or full', () => {
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    expect(safeLocalStorage()).toBeNull();
    const full = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
    vi.stubGlobal('window', { localStorage: { setItem: full } });
    expect(safeLocalStorage()).toBeNull();
  });
});
