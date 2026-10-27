// bike-capture/1: the `*.bikecapture.zip` the iOS app exports (see docs/ARCHITECTURE.md).
// Everything in here is untrusted input, so the manifest and poses go through validators
// and only the files the viewer needs are decompressed (images can be hundreds of MB).

import { type UnzipFileInfo, unzip, unzipSync } from 'fflate';
import { type BikeScene, type ModelFormat, type ModelRef, SCHEMA, formatFromFilename } from './schema';

export const CAPTURE_SCHEMA = 'bike-capture/1' as const;
export const POSES_SCHEMA = 'bike-poses/1' as const;

export type CaptureMode = 'object' | 'area';

export interface CaptureManifest {
  schema: typeof CAPTURE_SCHEMA;
  name: string;
  createdAt?: string;
  device?: string;
  systemVersion?: string;
  mode: CaptureMode;
  /** Bundle-relative paths; null when reconstruction had not produced the file yet. */
  model: string | null;
  poses: string | null;
  images: string;
  imageCount?: number;
}

export interface PoseSample {
  sample: number;
  /** Image filename inside `images/`, when Object Capture reported it. */
  file?: string;
  /** 4×4 column-major camera→model transform (three.js `Matrix4.fromArray`). */
  transform: number[];
}

export interface CapturePoses {
  schema: typeof POSES_SCHEMA;
  samples: PoseSample[];
}

export interface CaptureBundle {
  manifest: CaptureManifest;
  model: { path: string; format: ModelFormat; data: Uint8Array };
  poses: CapturePoses | null;
  /** Bundle-relative image paths (not decompressed; see zipIndex.ts for lazy access). */
  images: string[];
  /** Folder of manifest.json inside the zip ('' for a flat zip): zip path = root + bundle-relative path. */
  root: string;
  /** Non-fatal problems worth surfacing, e.g. an unreadable poses.json. */
  warnings: string[];
}

export class CaptureBundleError extends Error {}

export interface ReadLimits {
  maxJsonBytes: number;
  maxModelBytes: number;
}

// Generous for a phone capture, but stops a hostile zip from inflating into the tab's memory.
export const DEFAULT_LIMITS: ReadLimits = { maxJsonBytes: 16 << 20, maxModelBytes: 1 << 30 };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const optStr = (v: unknown): string | undefined => (isStr(v) ? v : undefined);

export function parseManifest(input: unknown): CaptureManifest {
  if (!isObj(input)) throw new CaptureBundleError('manifest.json: expected an object');
  if (input.schema !== CAPTURE_SCHEMA) throw new CaptureBundleError(`manifest.json: expected schema "${CAPTURE_SCHEMA}", got ${JSON.stringify(input.schema)}`);
  const manifest: CaptureManifest = {
    schema: CAPTURE_SCHEMA,
    name: isStr(input.name) && input.name.trim() ? input.name.trim() : 'Captured bike',
    mode: input.mode === 'area' ? 'area' : 'object',
    model: isStr(input.model) && input.model ? input.model : null,
    poses: isStr(input.poses) && input.poses ? input.poses : null,
    images: isStr(input.images) ? input.images : 'images/',
  };
  for (const key of ['createdAt', 'device', 'systemVersion'] as const) {
    const v = optStr(input[key]);
    if (v) manifest[key] = v;
  }
  if (typeof input.imageCount === 'number' && Number.isInteger(input.imageCount) && input.imageCount >= 0) manifest.imageCount = input.imageCount;
  return manifest;
}

export function parsePoses(input: unknown): CapturePoses {
  if (!isObj(input)) throw new CaptureBundleError('poses.json: expected an object');
  if (input.schema !== POSES_SCHEMA) throw new CaptureBundleError(`poses.json: expected schema "${POSES_SCHEMA}", got ${JSON.stringify(input.schema)}`);
  if (!Array.isArray(input.samples)) throw new CaptureBundleError('poses.json: expected samples[]');
  const samples = input.samples.map((s, i): PoseSample => {
    const ok =
      isObj(s) &&
      Number.isInteger(s.sample) &&
      Array.isArray(s.transform) &&
      s.transform.length === 16 &&
      s.transform.every((n) => typeof n === 'number' && Number.isFinite(n));
    if (!ok) throw new CaptureBundleError(`poses.json: samples[${i}] expected {sample, transform[16]}`);
    const out: PoseSample = { sample: s.sample as number, transform: s.transform as number[] };
    if (isStr(s.file)) out.file = s.file;
    return out;
  });
  return { schema: POSES_SCHEMA, samples };
}

/** Cheap first look at a file: zip local-file-header magic, so misnamed bundles still work. */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * Reads a capture bundle. iOS zips the export folder itself (NSFileCoordinator .forUploading),
 * so files usually sit under one top-level directory; the shallowest manifest.json wins and
 * Finder's __MACOSX resource forks are ignored.
 */
export async function readCaptureBundle(bytes: Uint8Array, limits: ReadLimits = DEFAULT_LIMITS): Promise<CaptureBundle> {
  const entries = listEntries(bytes);
  const manifestEntry = entries
    .filter((e) => !isJunk(e.name) && (e.name === 'manifest.json' || e.name.endsWith('/manifest.json')))
    .sort((a, b) => depth(a.name) - depth(b.name))[0];
  if (!manifestEntry) throw new CaptureBundleError('Not a capture bundle: manifest.json is missing.');
  const root = manifestEntry.name.slice(0, -'manifest.json'.length);
  const byPath = new Map(entries.filter((e) => e.name.startsWith(root) && !isJunk(e.name)).map((e) => [e.name.slice(root.length), e]));

  const manifest = parseManifest(parseJson(await extract(bytes, manifestEntry, limits.maxJsonBytes), 'manifest.json'));

  const modelPath = pickModelPath(manifest, byPath);
  if (!modelPath) {
    throw new CaptureBundleError(
      manifest.model
        ? `${manifest.model} is listed in the manifest but missing from the bundle.`
        : `“${manifest.name}” has no 3D model yet. Finish reconstruction on the iPhone, then export again.`,
    );
  }
  const format = formatFromFilename(modelPath)!;
  const data = await extract(bytes, byPath.get(modelPath)!, limits.maxModelBytes);

  const warnings: string[] = [];
  let poses: CapturePoses | null = null;
  const posesPath = manifest.poses ?? (byPath.has('poses.json') ? 'poses.json' : null);
  const posesEntry = posesPath ? byPath.get(posesPath) : undefined;
  if (posesPath && !posesEntry) warnings.push(`${posesPath} is listed in the manifest but missing.`);
  if (posesEntry) {
    try {
      poses = parsePoses(parseJson(await extract(bytes, posesEntry, limits.maxJsonBytes), posesPath!));
    } catch (err) {
      warnings.push(err instanceof Error ? err.message : String(err));
    }
  }

  const imageDir = manifest.images.endsWith('/') ? manifest.images : `${manifest.images}/`;
  const images = [...byPath.keys()].filter((p) => p.startsWith(imageDir) && !p.endsWith('/')).sort();
  return { manifest, model: { path: modelPath, format, data }, poses, images, root, warnings };
}

/** The `bike-scene/1` model URL for a bundle's model. Never fetchable: the bundle must be dropped again. */
export function captureModelUrl(bundleName: string, modelPath: string): string {
  return `bundle:${bundleName}/${modelPath}`;
}

/** The bundle filename a `captureModelUrl` points into, or null for other URLs. */
export function bundleNameOf(url: string): string | null {
  const m = /^bundle:([^/]+)\//.exec(url);
  return m ? m[1] : null;
}

/**
 * A fresh scene for a capture. The id is derived from the manifest so dropping the same bundle
 * again (another day, another tab) restores the comments saved for it.
 */
export function sceneFromCapture(bundle: CaptureBundle, bundleName: string): BikeScene {
  const { manifest } = bundle;
  const stamp = (manifest.createdAt ?? '').replace(/[^0-9]/g, '').slice(0, 14);
  return {
    schema: SCHEMA,
    id: ['capture', slug(manifest.name), stamp].filter(Boolean).join('-'),
    name: manifest.name,
    model: captureModelRef(bundle, bundleName),
    // Object Capture masks the background away, so a clear stage shows the bike cut out.
    background: 'transparent',
    hotspots: [],
    annotations: [],
  };
}

export function captureModelRef(bundle: CaptureBundle, bundleName: string): ModelRef {
  return { url: captureModelUrl(bundleName, bundle.model.path), format: bundle.model.format };
}

function pickModelPath(manifest: CaptureManifest, byPath: Map<string, UnzipFileInfo>): string | null {
  if (manifest.model && byPath.has(manifest.model) && formatFromFilename(manifest.model)) return manifest.model;
  // A converted model (e.g. tools/usdz-to-glb.py output) may sit next to an older manifest.
  const candidates = [...byPath.keys()].filter((p) => !p.includes('/') && formatFromFilename(p));
  const rank = (p: string) => ['glb', 'gltf', 'usdz', 'ply'].indexOf(formatFromFilename(p)!);
  return candidates.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

function listEntries(bytes: Uint8Array): UnzipFileInfo[] {
  const entries: UnzipFileInfo[] = [];
  try {
    // Returning false only walks the central directory, so this costs nothing per file.
    unzipSync(bytes, { filter: (f) => (entries.push(f), false) });
  } catch (err) {
    throw new CaptureBundleError(`Could not read the zip: ${err instanceof Error ? err.message : String(err)}`);
  }
  return entries;
}

function extract(bytes: Uint8Array, entry: UnzipFileInfo, maxBytes: number): Promise<Uint8Array> {
  if (entry.originalSize > maxBytes) {
    return Promise.reject(new CaptureBundleError(`${entry.name} is too large (${Math.round(entry.originalSize / 2 ** 20)} MB).`));
  }
  return new Promise((resolve, reject) => {
    unzip(bytes, { filter: (f) => f.name === entry.name }, (err, files) => {
      const data = files?.[entry.name];
      if (err || !data) reject(new CaptureBundleError(`Could not extract ${entry.name}: ${err?.message ?? 'missing'}`));
      else resolve(data);
    });
  });
}

function parseJson(data: Uint8Array, name: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(data));
  } catch {
    throw new CaptureBundleError(`${name} is not valid JSON.`);
  }
}

const isJunk = (name: string) => name.startsWith('__MACOSX/') || name.split('/').some((part) => part.startsWith('._'));
const depth = (name: string) => name.split('/').length;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
