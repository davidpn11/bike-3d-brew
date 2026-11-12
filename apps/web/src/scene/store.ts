import { moveItem } from './reorder';
import { type Annotation, type BikeScene, type Hotspot, newId, parseScene } from './schema';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type Listener = (scene: BikeScene) => void;

const storageKey = (id: string) => `bike-scene:${id}`;
const HISTORY = 100;
/** Edits sharing a merge key less than this far apart are one undo step. */
const MERGE_MS = 1000;

/**
 * Single source of truth for the open scene. Every mutation persists to storage
 * (best effort: private windows and full quotas must not break editing) and
 * notifies listeners so the viewer and panel re-render. Every edit is also an undo step.
 */
export class SceneStore {
  private listeners = new Set<Listener>();
  private past: BikeScene[] = [];
  private future: BikeScene[] = [];
  private merge = { key: '', at: 0 };

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

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Replaces the whole scene (load / import). Not an undo step; another scene id starts a fresh history. */
  replace(scene: BikeScene): void {
    if (scene.id !== this.current.id) {
      this.past = [];
      this.future = [];
    }
    this.merge.key = '';
    this.current = scene;
    this.commit();
  }

  /** `merge`: repeated edits with the same key (rapid nudges) collapse into one undo step. */
  update(patch: Partial<Omit<BikeScene, 'schema' | 'id' | 'hotspots' | 'annotations'>>, merge = ''): void {
    this.set({ ...this.current, ...patch }, merge);
  }

  undo(): boolean {
    return this.step(this.past, this.future);
  }

  redo(): boolean {
    return this.step(this.future, this.past);
  }

  addHotspot(h: Omit<Hotspot, 'id'>): Hotspot {
    const hotspot: Hotspot = { ...h, id: newId('hs') };
    this.set({ ...this.current, hotspots: [...this.current.hotspots, hotspot] });
    return hotspot;
  }

  updateHotspot(id: string, patch: Partial<Omit<Hotspot, 'id'>>): void {
    this.set({
      ...this.current,
      hotspots: this.current.hotspots.map((h) => (h.id === id ? { ...h, ...patch } : h)),
    });
  }

  removeHotspot(id: string): void {
    this.set({
      ...this.current,
      hotspots: this.current.hotspots.filter((h) => h.id !== id),
      // Comments stay; they just lose their area grouping.
      annotations: this.current.annotations.map((a) => (a.hotspotId === id ? { ...a, hotspotId: undefined } : a)),
    });
  }

  addAnnotation(a: Omit<Annotation, 'id' | 'createdAt'>): Annotation {
    const annotation: Annotation = { ...a, id: newId('note'), createdAt: new Date().toISOString() };
    this.set({ ...this.current, annotations: [...this.current.annotations, annotation] });
    return annotation;
  }

  updateAnnotation(id: string, patch: Partial<Omit<Annotation, 'id' | 'createdAt'>>): void {
    this.set({
      ...this.current,
      annotations: this.current.annotations.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    });
  }

  removeAnnotation(id: string): void {
    this.set({ ...this.current, annotations: this.current.annotations.filter((a) => a.id !== id) });
  }

  /** Reorders comments (the order customers see and the pin numbers); `visible` limits the move to a shown subset. */
  moveAnnotation(id: string, to: number, visible?: readonly string[]): void {
    const annotations = moveItem(this.current.annotations, id, to, visible);
    if (annotations === this.current.annotations) return;
    this.set({ ...this.current, annotations });
  }

  annotationsFor(hotspotId: string | null): Annotation[] {
    return this.current.annotations.filter((a) => (hotspotId ? a.hotspotId === hotspotId : true));
  }

  /** The locally saved copy of another scene, e.g. a capture bundle dropped again. */
  saved(id: string): BikeScene | null {
    return SceneStore.restore(id, this.storage);
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

  private set(next: BikeScene, merge = ''): void {
    const now = Date.now();
    if (!merge || merge !== this.merge.key || now - this.merge.at > MERGE_MS) {
      this.past.push(this.current);
      if (this.past.length > HISTORY) this.past.shift();
    }
    this.merge = { key: merge, at: now };
    this.future = [];
    this.current = next;
    this.commit();
  }

  private step(from: BikeScene[], to: BikeScene[]): boolean {
    const next = from.pop();
    if (!next) return false;
    to.push(this.current);
    this.merge.key = '';
    this.current = next;
    this.commit();
    return true;
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
