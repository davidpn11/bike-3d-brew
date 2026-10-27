// bike-scene/1: one bike, its 3D model, the zoomable component areas ("hotspots")
// and the sales comments pinned onto the model. Plain JSON so it can be exported,
// versioned in git, or served next to the model file.

export const SCHEMA = 'bike-scene/1' as const;

export type Vec3 = [number, number, number];

export type BackgroundMode = 'transparent' | 'green' | 'studio' | 'dark';
export const BACKGROUND_MODES: BackgroundMode[] = ['transparent', 'green', 'studio', 'dark'];

export type ModelFormat = 'glb' | 'gltf' | 'usdz' | 'ply' | 'demo';

export interface ModelRef {
  /** URL relative to the scene file, absolute URL, or 'demo:road' for the built-in bike. */
  url: string;
  format: ModelFormat;
  /** Applied after loading so captures in arbitrary units/orientation sit upright in meters. */
  scale?: number;
  rotation?: Vec3; // Euler XYZ radians
  offset?: Vec3;
}

export interface CameraView {
  position: Vec3;
  target: Vec3;
}

export interface Hotspot {
  id: string;
  name: string;
  view: CameraView;
  /** Optional close-up photo URLs (posed capture photos that best show this area). */
  photos?: string[];
}

export type AnnotationKind = 'feature' | 'spec' | 'upgrade' | 'note';
export const ANNOTATION_KINDS: AnnotationKind[] = ['feature', 'spec', 'upgrade', 'note'];

export interface Annotation {
  id: string;
  /** Point on the model surface, in model-root space (survives scale/rotation edits). */
  position: Vec3;
  normal?: Vec3;
  title: string;
  body: string;
  kind: AnnotationKind;
  hotspotId?: string;
  /** Free text so it can hold "+$350", "€1,200" or "included". */
  price?: string;
  createdAt: string;
}

export interface BikeScene {
  schema: typeof SCHEMA;
  id: string;
  name: string;
  brand?: string;
  modelName?: string;
  year?: number;
  price?: string;
  model: ModelRef;
  background: BackgroundMode;
  hotspots: Hotspot[];
  annotations: Annotation[];
}

export function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}${rand}`;
}

export function emptyScene(model: ModelRef, name = 'Untitled bike'): BikeScene {
  return {
    schema: SCHEMA,
    id: newId('bike'),
    name,
    model,
    background: 'transparent',
    hotspots: [],
    annotations: [],
  };
}

export class SceneValidationError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
const isStr = (v: unknown): v is string => typeof v === 'string';

function fail(path: string, msg: string): never {
  throw new SceneValidationError(`${path}: ${msg}`);
}

function parseView(v: unknown, path: string): CameraView {
  if (!isObj(v)) fail(path, 'expected object');
  if (!isVec3(v.position)) fail(`${path}.position`, 'expected [x,y,z]');
  if (!isVec3(v.target)) fail(`${path}.target`, 'expected [x,y,z]');
  return { position: v.position, target: v.target };
}

/** Validates untrusted JSON (imports, URLs) into a BikeScene, filling safe defaults. */
export function parseScene(input: unknown): BikeScene {
  if (!isObj(input)) fail('scene', 'expected object');
  if (input.schema !== SCHEMA) fail('scene.schema', `expected "${SCHEMA}", got ${JSON.stringify(input.schema)}`);
  const m = input.model;
  if (!isObj(m) || !isStr(m.url)) fail('scene.model.url', 'expected string');
  const formats: ModelFormat[] = ['glb', 'gltf', 'usdz', 'ply', 'demo'];
  if (!formats.includes(m.format as ModelFormat)) fail('scene.model.format', `expected one of ${formats.join(', ')}`);
  const model: ModelRef = { url: m.url, format: m.format as ModelFormat };
  if (typeof m.scale === 'number') model.scale = m.scale;
  if (isVec3(m.rotation)) model.rotation = m.rotation;
  if (isVec3(m.offset)) model.offset = m.offset;

  const hotspots = Array.isArray(input.hotspots) ? input.hotspots : [];
  const annotations = Array.isArray(input.annotations) ? input.annotations : [];

  const scene: BikeScene = {
    schema: SCHEMA,
    id: isStr(input.id) ? input.id : newId('bike'),
    name: isStr(input.name) ? input.name : 'Untitled bike',
    model,
    background: BACKGROUND_MODES.includes(input.background as BackgroundMode) ? (input.background as BackgroundMode) : 'transparent',
    hotspots: hotspots.map((h, i): Hotspot => {
      const p = `scene.hotspots[${i}]`;
      if (!isObj(h) || !isStr(h.id) || !isStr(h.name)) fail(p, 'expected {id, name, view}');
      const out: Hotspot = { id: h.id, name: h.name, view: parseView(h.view, `${p}.view`) };
      if (Array.isArray(h.photos)) out.photos = h.photos.filter(isStr);
      return out;
    }),
    annotations: annotations.map((a, i): Annotation => {
      const p = `scene.annotations[${i}]`;
      if (!isObj(a) || !isStr(a.id)) fail(p, 'expected {id, position, title}');
      if (!isVec3(a.position)) fail(`${p}.position`, 'expected [x,y,z]');
      const out: Annotation = {
        id: a.id,
        position: a.position,
        title: isStr(a.title) ? a.title : '',
        body: isStr(a.body) ? a.body : '',
        kind: ANNOTATION_KINDS.includes(a.kind as AnnotationKind) ? (a.kind as AnnotationKind) : 'note',
        createdAt: isStr(a.createdAt) ? a.createdAt : new Date(0).toISOString(),
      };
      if (isVec3(a.normal)) out.normal = a.normal;
      if (isStr(a.hotspotId)) out.hotspotId = a.hotspotId;
      if (isStr(a.price)) out.price = a.price;
      return out;
    }),
  };
  for (const key of ['brand', 'modelName', 'price'] as const) if (isStr(input[key])) scene[key] = input[key];
  if (typeof input.year === 'number') scene.year = input.year;

  const ids = new Set(scene.hotspots.map((h) => h.id));
  for (const a of scene.annotations) if (a.hotspotId && !ids.has(a.hotspotId)) delete a.hotspotId;
  return scene;
}

export function formatFromFilename(name: string): ModelFormat | null {
  const ext = name.toLowerCase().split('.').pop();
  switch (ext) {
    case 'glb':
    case 'gltf':
    case 'usdz':
    case 'ply':
      return ext;
    default:
      return null;
  }
}
