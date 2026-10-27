import { type Annotation, type BikeScene, type Hotspot, newId, parseScene } from './schema';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type Listener = (scene: BikeScene) => void;

const storageKey = (id: string) => `bike-scene:${id}`;

/**
 * Single source of truth for the open scene. Every mutation persists to storage
 * (best effort: private windows and full quotas must not break editing) and
 * notifies listeners so the viewer and panel re-render.
 */
export class SceneStore {
  private listeners = new Set<Listener>();

  constructor(
    private current: BikeScene,
    private storage: KeyValueStorage | null = null,
  ) {}

  get scene(): BikeScene {
    return this.current;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Replaces the whole scene (load / import). */
  replace(scene: BikeScene): void {
    this.current = scene;
    this.commit();
  }

  update(patch: Partial<Omit<BikeScene, 'schema' | 'id' | 'hotspots' | 'annotations'>>): void {
    this.current = { ...this.current, ...patch };
    this.commit();
  }

  addHotspot(h: Omit<Hotspot, 'id'>): Hotspot {
    const hotspot: Hotspot = { ...h, id: newId('hs') };
    this.current = { ...this.current, hotspots: [...this.current.hotspots, hotspot] };
    this.commit();
    return hotspot;
  }

  updateHotspot(id: string, patch: Partial<Omit<Hotspot, 'id'>>): void {
    this.current = {
      ...this.current,
      hotspots: this.current.hotspots.map((h) => (h.id === id ? { ...h, ...patch } : h)),
    };
    this.commit();
  }

  removeHotspot(id: string): void {
    this.current = {
      ...this.current,
      hotspots: this.current.hotspots.filter((h) => h.id !== id),
      // Comments stay; they just lose their area grouping.
      annotations: this.current.annotations.map((a) => (a.hotspotId === id ? { ...a, hotspotId: undefined } : a)),
    };
    this.commit();
  }

  addAnnotation(a: Omit<Annotation, 'id' | 'createdAt'>): Annotation {
    const annotation: Annotation = { ...a, id: newId('note'), createdAt: new Date().toISOString() };
    this.current = { ...this.current, annotations: [...this.current.annotations, annotation] };
    this.commit();
    return annotation;
  }

  updateAnnotation(id: string, patch: Partial<Omit<Annotation, 'id' | 'createdAt'>>): void {
    this.current = {
      ...this.current,
      annotations: this.current.annotations.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    };
    this.commit();
  }

  removeAnnotation(id: string): void {
    this.current = { ...this.current, annotations: this.current.annotations.filter((a) => a.id !== id) };
    this.commit();
  }

  annotationsFor(hotspotId: string | null): Annotation[] {
    return this.current.annotations.filter((a) => (hotspotId ? a.hotspotId === hotspotId : true));
  }

  toJSON(): string {
    return JSON.stringify(this.current, null, 2);
  }

  /** Loads the saved copy of a scene id, if any, validating it like an import. */
  static restore(id: string, storage: KeyValueStorage | null): BikeScene | null {
    try {
      const raw = storage?.getItem(storageKey(id));
      return raw ? parseScene(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  private commit(): void {
    try {
      this.storage?.setItem(storageKey(this.current.id), JSON.stringify(this.current));
    } catch {
      // Storage unavailable or full; the in-memory scene and Export still work.
    }
    for (const fn of this.listeners) fn(this.current);
  }
}

export function safeLocalStorage(): KeyValueStorage | null {
  try {
    const s = window.localStorage;
    const probe = '__bike_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}
