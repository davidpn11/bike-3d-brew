import { describe, expect, it, vi } from 'vitest';
import { SCHEMA, type BikeScene } from '../src/scene/schema';
import { type KeyValueStorage, SceneStore } from '../src/scene/store';

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
});
