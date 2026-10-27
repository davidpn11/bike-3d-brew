import { type Zippable, unzipSync, zipSync } from 'fflate';
import { slugify } from './helpers';
import { KIOSK_DEFAULTS } from './kiosk';
import { type BikeScene, type ModelFormat, type ModelRef, parseScene } from './schema';

// Sharing a bike with a customer: the read-only `?scene=…&view=present` link, and the
// `bike-share/1` package (`<slug>.bikeshare.zip`) that publishes a local scene to any static host.
// Pure and DOM-free: used by the app and by tools/publish-scene.mjs.

export const SHARE_SCHEMA = 'bike-share/1' as const;
export const SCENE_FILE = 'scene.bike.json';
export const MANIFEST_FILE = 'bike-share.json';

/** Generous for a phone-friendly scene, small enough that a bad zip cannot fill a disk. */
export const SHARE_LIMITS = { zip: 300 << 20, model: 250 << 20, json: 2 << 20, photo: 8 << 20, photos: 64 };

export class ShareError extends Error {}

// ---------------------------------------------------------------- URL parameters

export interface ViewParams {
  /** `?scene=`: a published scene to load (relative to the page, or absolute). */
  scene: string | null;
  /** `?view=present`: the customer link. Present mode only, no editing UI at all. */
  readOnly: boolean;
  /** Start in Present mode (`?mode=present` or the read-only view). */
  present: boolean;
  /** `?kiosk=1`: auto-advance through the areas. */
  kiosk: boolean;
  /** Milliseconds per area (`?interval=` seconds, 1–120). */
  interval: number;
  /** Milliseconds without input before auto-advance resumes (`?idle=` seconds, 1–600). */
  idle: number;
  /** `?fresh`: ignore the local copy of a published scene. */
  fresh: boolean;
}

function seconds(raw: string | null, min: number, max: number, fallback: number): number {
  const n = raw === null || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n)) * 1000) : fallback;
}

export function readViewParams(search: string): ViewParams {
  const p = new URLSearchParams(search);
  const readOnly = p.get('view') === 'present';
  const kiosk = ['1', 'true', 'yes', ''].includes(p.get('kiosk') ?? 'no');
  return {
    scene: p.get('scene')?.trim() || null,
    readOnly,
    present: readOnly || p.get('mode') === 'present' || kiosk,
    kiosk,
    interval: seconds(p.get('interval'), 1, 120, KIOSK_DEFAULTS.interval),
    idle: seconds(p.get('idle'), 1, 600, KIOSK_DEFAULTS.idle),
    fresh: p.has('fresh') || readOnly,
  };
}

/** True for URLs the viewer may fetch on a link's behalf: this site, or any https host. */
export function isAllowedUrl(url: URL, pageHref: string): boolean {
  if (url.username || url.password) return false;
  return url.origin === new URL(pageHref).origin || url.protocol === 'https:';
}

/** Resolves a `?scene=` value; throws a ShareError a customer can understand when it is not allowed. */
export function checkSceneUrl(raw: string, pageHref: string): string {
  let url: URL;
  try {
    url = new URL(raw, pageHref);
  } catch {
    throw new ShareError(`The link’s scene address “${raw}” is not a valid URL.`);
  }
  if (!isAllowedUrl(url, pageHref)) throw new ShareError(`The link’s scene address must be on this site or use https (got “${url.protocol}//${url.host}”).`);
  return url.href;
}

/**
 * Checks a scene fetched from a link before anything else is loaded from it: its model and photos
 * must be fetchable under the same rules as the scene. Bad photo URLs are dropped, a bad model throws.
 */
export function checkPublishedScene(scene: BikeScene, sceneHref: string, pageHref: string): BikeScene {
  const { url, format } = scene.model;
  if (format !== 'demo') {
    if (/^(bundle|blob|data):/i.test(url)) throw new ShareError(`“${scene.name}” was shared without its 3D model (it only exists in the browser it was captured in). Export a share package and publish it.`);
    let model: URL | null = null;
    try {
      model = new URL(url, sceneHref);
    } catch {
      /* invalid below */
    }
    if (!model || !isAllowedUrl(model, pageHref)) throw new ShareError(`The 3D model of “${scene.name}” must be on this site or use https.`);
  } else if (!/^demo:/.test(url)) throw new ShareError(`Unknown built-in model “${url}”.`);
  const hotspots = scene.hotspots.map((hs) => {
    if (!hs.photos) return hs;
    const photos = hs.photos.filter((p) => {
      try {
        const u = new URL(p, sceneHref);
        return isAllowedUrl(u, pageHref) && /\.(jpe?g|png|webp)$/i.test(u.pathname);
      } catch {
        return false;
      }
    });
    return { ...hs, photos };
  });
  return { ...scene, hotspots };
}

// ---------------------------------------------------------------- the link

/** The customer link for a published scene: the app page with `?scene=…&view=present`. */
export function shareLink(pageHref: string, sceneParam: string, extra: Record<string, string> = {}): string {
  const u = new URL(pageHref);
  const q = (s: string) => encodeURIComponent(s).replace(/%2F/g, '/').replace(/%3A/g, ':');
  const params = [`scene=${q(sceneParam)}`, 'view=present', ...Object.entries(extra).map(([k, v]) => `${q(k)}=${q(v)}`)];
  return `${u.origin}${u.pathname}?${params.join('&')}`;
}

/** Deterministic JSON (sorted keys, undefined dropped): "is this still the published scene?" */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => stableJson(x ?? null)).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(v);
}

export const isLocalModel = (ref: ModelRef) => ref.format !== 'demo' && /^(bundle|blob|data):/i.test(ref.url);

export interface Published {
  /** The `?scene=` value it was opened with. */
  param: string;
  scene: BikeScene;
}

export type ShareOption =
  | { kind: 'link'; url: string; /** This browser has edits the published copy lacks. */ stale: boolean }
  | { kind: 'package'; reason: 'local-model' | 'not-published' };

/** What Share can offer for the open scene. */
export function shareOption(scene: BikeScene, published: Published | null, pageHref: string): ShareOption {
  if (published && published.scene.id === scene.id && !isLocalModel(scene.model)) {
    return { kind: 'link', url: shareLink(pageHref, published.param), stale: stableJson(scene) !== stableJson(published.scene) };
  }
  return { kind: 'package', reason: isLocalModel(scene.model) ? 'local-model' : 'not-published' };
}

// ---------------------------------------------------------------- bike-share/1 package

export interface ShareManifest {
  schema: typeof SHARE_SCHEMA;
  /** Folder name under scenes/: `?scene=scenes/<id>/scene.bike.json`. */
  id: string;
  name: string;
  createdAt: string;
  scene: typeof SCENE_FILE;
  model: string | null;
  photos: string[];
}

export interface SharePackageInput {
  scene: BikeScene;
  /** The model file; omitted for the built-in demo bike. */
  model?: { bytes: Uint8Array; format: ModelFormat };
  /** JPEG close-ups per hotspot id, best first. */
  photos?: ReadonlyMap<string, Uint8Array[]>;
  createdAt?: string;
}

export const modelFileName = (format: ModelFormat) => `model.${format}`;
export const packageFileName = (id: string) => `${id}.bikeshare.zip`;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const isPackageId = (id: string) => ID_RE.test(id);

/** Builds `<slug>.bikeshare.zip`: unzipped into `scenes/<id>/`, `?scene=scenes/<id>/scene.bike.json` works. */
export function buildSharePackage(input: SharePackageInput): { id: string; filename: string; bytes: Uint8Array; manifest: ShareManifest } {
  const { scene } = input;
  if (isLocalModel(scene.model) && !input.model) throw new ShareError('The model file is needed for a share package; open the capture first.');
  const id = slugify(scene.name).slice(0, 64).replace(/-+$/, '') || 'bike';
  const files: Zippable = {};
  const photos: string[] = [];
  let model: string | null = null;
  const out: BikeScene = structuredClone(scene);
  if (input.model) {
    model = modelFileName(input.model.format);
    out.model = { ...out.model, url: model, format: input.model.format };
    // Already-compressed formats are stored, not deflated again.
    files[model] = [input.model.bytes, { level: input.model.format === 'usdz' ? 0 : 6 }];
  }
  out.hotspots = out.hotspots.map((hs, i) => {
    const jpegs = input.photos?.get(hs.id) ?? [];
    const kept = (hs.photos ?? []).filter((p) => /^https:/i.test(p));
    const added = jpegs.slice(0, 8).map((bytes, k) => {
      const path = `photos/${String(i + 1).padStart(2, '0')}-${slugify(hs.name).slice(0, 32)}-${k + 1}.jpg`;
      files[path] = [bytes, { level: 0 }];
      photos.push(path);
      return path;
    });
    const next: typeof hs = { ...hs, photos: [...added, ...kept] };
    if (!next.photos?.length) delete next.photos;
    return next;
  });
  const manifest: ShareManifest = { schema: SHARE_SCHEMA, id, name: scene.name, createdAt: input.createdAt ?? new Date().toISOString(), scene: SCENE_FILE, model, photos };
  const enc = new TextEncoder();
  files[SCENE_FILE] = enc.encode(JSON.stringify(out, null, 2) + '\n');
  files[MANIFEST_FILE] = enc.encode(JSON.stringify(manifest, null, 2) + '\n');
  return { id, filename: packageFileName(id), bytes: zipSync(files), manifest };
}

const ALLOWED = /^(scene\.bike\.json|bike-share\.json|model\.(glb|gltf|usdz|ply)|photos\/[a-z0-9][a-z0-9._-]{0,80}\.jpe?g)$/;
const startsWith = (b: Uint8Array, ...sig: number[]) => sig.every((x, i) => b[i] === x);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

function checkMagic(path: string, b: Uint8Array): void {
  const ok = path.endsWith('.glb')
    ? startsWith(b, ...ascii('glTF'))
    : path.endsWith('.usdz')
      ? startsWith(b, 0x50, 0x4b, 0x03, 0x04)
      : path.endsWith('.ply')
        ? startsWith(b, ...ascii('ply'))
        : path.endsWith('.gltf')
          ? b[0] === 0x7b || b[0] === 0x20 || b[0] === 0x0a
          : /\.jpe?g$/.test(path)
            ? startsWith(b, 0xff, 0xd8, 0xff)
            : true;
  if (!ok) throw new ShareError(`${path} is not the file type its name says.`);
}

export interface ReadPackage {
  id: string;
  manifest: ShareManifest;
  scene: BikeScene;
  /** Every file to write under `scenes/<id>/`, validated. */
  files: { path: string; bytes: Uint8Array }[];
  warnings: string[];
}

/**
 * Validates an untrusted `.bikeshare.zip`: only a scene, a manifest, one model and JPEG photos,
 * under size limits, no paths outside the package, a scene that passes parseScene and only
 * references files in the package (or https URLs).
 */
export function readSharePackage(zip: Uint8Array, opts: { id?: string } = {}): ReadPackage {
  if (zip.byteLength > SHARE_LIMITS.zip) throw new ShareError(`The package is larger than ${SHARE_LIMITS.zip >> 20} MB.`);
  if (!startsWith(zip, 0x50, 0x4b)) throw new ShareError('Not a zip file.');
  const refused: string[] = [];
  let photoCount = 0;
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(zip, {
      filter: (f) => {
        if (f.name.endsWith('/')) return false;
        if (!ALLOWED.test(f.name)) {
          refused.push(f.name);
          return false;
        }
        const limit = f.name.startsWith('photos/') ? SHARE_LIMITS.photo : f.name.startsWith('model.') ? SHARE_LIMITS.model : SHARE_LIMITS.json;
        if (f.originalSize > limit) throw new ShareError(`${f.name} is larger than ${Math.round(limit / (1 << 20))} MB.`);
        if (f.name.startsWith('photos/') && ++photoCount > SHARE_LIMITS.photos) throw new ShareError(`More than ${SHARE_LIMITS.photos} photos.`);
        return true;
      },
    });
  } catch (err) {
    if (err instanceof ShareError) throw err;
    throw new ShareError(`Could not unzip the package: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (refused.length) throw new ShareError(`Refusing files that are not part of a share package: ${refused.slice(0, 5).join(', ')}${refused.length > 5 ? '…' : ''}`);

  const json = (path: string): unknown => {
    const bytes = raw[path];
    if (!bytes) throw new ShareError(`${path} is missing.`);
    if (bytes.byteLength > SHARE_LIMITS.json) throw new ShareError(`${path} is too large.`);
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new ShareError(`${path} is not valid JSON.`);
    }
  };
  const m = json(MANIFEST_FILE) as Partial<ShareManifest> | null;
  if (!m || typeof m !== 'object' || m.schema !== SHARE_SCHEMA) throw new ShareError(`${MANIFEST_FILE}: expected schema "${SHARE_SCHEMA}".`);
  const id = opts.id ?? m.id;
  if (typeof id !== 'string' || !isPackageId(id)) throw new ShareError(`Invalid package id ${JSON.stringify(id)} (lowercase letters, digits and dashes).`);
  let scene: BikeScene;
  try {
    scene = parseScene(json(SCENE_FILE));
  } catch (err) {
    throw new ShareError(`${SCENE_FILE}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const paths = Object.keys(raw);
  const models = paths.filter((p) => p.startsWith('model.'));
  if (models.length > 1) throw new ShareError(`More than one model: ${models.join(', ')}.`);
  if (scene.model.format === 'demo') {
    if (!/^demo:/.test(scene.model.url)) throw new ShareError(`Unknown built-in model “${scene.model.url}”.`);
  } else if (scene.model.url !== models[0] || modelFileName(scene.model.format) !== models[0]) {
    throw new ShareError(`The scene’s model “${scene.model.url}” must be the packaged ${models[0] ?? 'model file (none found)'}.`);
  }
  for (const p of paths) {
    if (raw[p].byteLength > (p.startsWith('photos/') ? SHARE_LIMITS.photo : p.startsWith('model.') ? SHARE_LIMITS.model : SHARE_LIMITS.json)) throw new ShareError(`${p} is too large.`);
    checkMagic(p, raw[p]);
  }

  const warnings: string[] = [];
  const referenced = new Set<string>();
  for (const hs of scene.hotspots) {
    for (const photo of hs.photos ?? []) {
      if (/^https:/i.test(photo)) continue;
      if (!raw[photo] || !photo.startsWith('photos/')) throw new ShareError(`Area “${hs.name}” refers to a photo that is not in the package: ${photo}`);
      referenced.add(photo);
    }
  }
  for (const p of paths) if (p.startsWith('photos/') && !referenced.has(p)) warnings.push(`${p} is not used by any area.`);
  if (models.length && scene.model.format === 'demo') warnings.push(`${models[0]} is not used (the scene shows the built-in demo bike).`);

  const manifest: ShareManifest = {
    schema: SHARE_SCHEMA,
    id,
    name: scene.name,
    createdAt: typeof m.createdAt === 'string' ? m.createdAt : new Date(0).toISOString(),
    scene: SCENE_FILE,
    model: models[0] ?? null,
    photos: paths.filter((p) => p.startsWith('photos/')).sort(),
  };
  const enc = new TextEncoder();
  // Re-serialize the validated scene and manifest: what is published is exactly what was checked.
  const files = [
    { path: SCENE_FILE, bytes: enc.encode(JSON.stringify(scene, null, 2) + '\n') },
    { path: MANIFEST_FILE, bytes: enc.encode(JSON.stringify(manifest, null, 2) + '\n') },
    ...paths.filter((p) => p !== SCENE_FILE && p !== MANIFEST_FILE).sort().map((path) => ({ path, bytes: raw[path] })),
  ];
  return { id, manifest, scene, files, warnings };
}
