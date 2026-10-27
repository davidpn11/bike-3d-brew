// USDZ / USDC / USDA → three.js, tuned for Apple Object Capture output (binary crate layer,
// one baked triangle mesh, UsdPreviewSurface + PNG/JPEG textures packed next to the layer).
// Parsing uses three's USD parsers with the fixes in ./crate and ./composer.

import { unzipSync } from 'fflate';
import * as THREE from 'three';
import { USDAParser } from 'three/examples/jsm/loaders/usd/USDAParser.js';
import type { UsdLayerData } from 'three/examples/jsm/loaders/usd/USDCParser.js';
import { FastUSDComposer } from './composer';
import { isCrate, parseCrate } from './crate';
import { weldGeometry } from '../weld';

export class UsdLoadError extends Error {}

/** Parses one USD layer (crate or text). Swappable so the browser can run it in a worker. */
export type LayerParser = (bytes: Uint8Array) => UsdLayerData | Promise<UsdLayerData>;

export const parseLayer: LayerParser = (bytes) => (isCrate(bytes) ? parseCrate(bytes) : new USDAParser().parseData(new TextDecoder().decode(bytes)));

export interface UsdLoadStats {
  rootLayer: string;
  crate: boolean;
  /** Milliseconds per phase. Textures are decoded by the browser, after compose. */
  ms: { unzip: number; parse: number; compose: number; weld: number; textures: number };
  meshes: number;
  triangles: number;
  /** Vertices before and after welding the face-varying expansion back into an indexed mesh. */
  vertices: { before: number; after: number };
  textures: { loaded: number; failed: number };
}

export interface UsdLoadResult {
  object: THREE.Group;
  stats: UsdLoadStats;
  warnings: string[];
}

const USD_EXT = /\.(usd|usda|usdc)$/i;
const IMAGE_EXT = /\.(png|jpe?g|avif|webp)$/i;
const now = () => performance.now();

export async function loadUsd(bytes: Uint8Array, parse: LayerParser = parseLayer): Promise<UsdLoadResult> {
  const t0 = now();
  const files = isZip(bytes) ? unzipPackage(bytes) : { [isCrate(bytes) ? 'model.usdc' : 'model.usda']: bytes };
  const names = Object.keys(files);
  // AOUSD core spec 16.4.1.2: the first entry of a package is its root layer. Some exporters get
  // that wrong, so fall back to the first USD layer anywhere in the archive.
  const rootLayer = USD_EXT.test(names[0] ?? '') ? names[0] : names.find((n) => USD_EXT.test(n));
  if (!rootLayer) throw new UsdLoadError('This USDZ contains no USD layer (.usd/.usdc/.usda).');
  const t1 = now();

  const assets: Record<string, unknown> = {};
  let root: UsdLayerData | undefined;
  for (const name of names) {
    const data = files[name];
    if (IMAGE_EXT.test(name)) assets[name] = data;
    else if (USD_EXT.test(name)) {
      let layer: UsdLayerData;
      try {
        layer = await parse(data);
      } catch (err) {
        throw new UsdLoadError(`Could not parse ${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
      assets[name] = layer;
      if (name === rootLayer) root = layer;
    }
  }
  const t2 = now();

  const composer = new FastUSDComposer();
  const slash = rootLayer.lastIndexOf('/');
  let object: THREE.Group;
  try {
    object = composer.compose(root!, assets, {}, slash >= 0 ? rootLayer.slice(0, slash) : '');
  } catch (err) {
    throw new UsdLoadError(`Could not build the USD scene: ${err instanceof Error ? err.message : String(err)}`);
  }
  const t3 = now();
  const vertices = weld(object);
  const t3w = now();
  // three creates (and revokes) one blob URL per packed image; wait so the model appears textured.
  await Promise.all(composer.texturePromises);
  const t4 = now();

  const warnings: string[] = [];
  const { meshes, triangles, textures } = inspect(object, warnings);
  return {
    object,
    warnings,
    stats: {
      rootLayer,
      crate: isCrate(files[rootLayer]),
      ms: { unzip: t1 - t0, parse: t2 - t1, compose: t3 - t2, weld: t3w - t3, textures: t4 - t3w },
      meshes,
      triangles,
      vertices,
      textures,
    },
  };
}

/**
 * three expands face-varying primvars (Object Capture's normals and UVs) to three vertices per
 * triangle. Merging the identical corners back makes the mesh indexed: ~6× fewer vertices for the
 * GPU to store and transform, and a smaller BVH input.
 */
function weld(root: THREE.Object3D): { before: number; after: number } {
  let before = 0;
  let after = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const n = mesh.geometry.getAttribute('position')?.count ?? 0;
    const stats = weldGeometry(mesh.geometry);
    before += n;
    after += stats ? stats.after : n;
  });
  return { before, after };
}

function isZip(b: Uint8Array): boolean {
  return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

function unzipPackage(bytes: Uint8Array): Record<string, Uint8Array> {
  try {
    // Skip anything we would not use (e.g. audio, MaterialX sidecars) instead of inflating it.
    return unzipSync(bytes, { filter: (f) => USD_EXT.test(f.name) || IMAGE_EXT.test(f.name) });
  } catch (err) {
    throw new UsdLoadError(`Could not read the USDZ archive: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const MAP_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'] as const;

/** Counts geometry, fixes material conventions three gets wrong, and reports textures that did not decode. */
function inspect(root: THREE.Object3D, warnings: string[]) {
  let meshes = 0;
  let triangles = 0;
  const seen = new Set<THREE.Texture>();
  let loaded = 0;
  let failed = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshes++;
    const g = mesh.geometry;
    triangles += (g.index ? g.index.count : (g.getAttribute('position')?.count ?? 0)) / 3;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const mat = m as THREE.MeshStandardMaterial;
      if (mat.normalMap) fixNormalScale(mat);
      for (const key of MAP_KEYS) {
        const tex = mat[key] as THREE.Texture | null | undefined;
        if (!tex || seen.has(tex)) continue;
        seen.add(tex);
        if (tex.image) loaded++;
        else failed++;
      }
    }
  });
  if (failed) warnings.push(`${failed} texture${failed > 1 ? 's' : ''} could not be decoded; the model is shown without ${failed > 1 ? 'them' : 'it'}.`);
  return { meshes, triangles, textures: { loaded, failed } };
}

/**
 * UsdPreviewSurface expects normal maps remapped by UsdUVTexture `scale`/`bias` (Object Capture
 * writes scale 2, bias -1: the standard 0..1 → -1..1 decode). three already decodes that way and
 * then used `scale` as `normalScale`, doubling the bumps. Strength relative to the standard decode
 * is scale / 2.
 */
export function fixNormalScale(mat: THREE.MeshStandardMaterial): void {
  const scale = mat.normalMap?.userData.scale as number[] | undefined;
  const bias = mat.normalMap?.userData.bias as number[] | undefined;
  if (!Array.isArray(scale) || scale.length < 2) return;
  const decodes = Array.isArray(bias) && bias.length >= 2 && (Math.abs(bias[0] + scale[0] / 2) < 1e-3 && Math.abs(bias[1] + scale[1] / 2) < 1e-3);
  if (decodes) mat.normalScale.set(scale[0] / 2, scale[1] / 2);
}
