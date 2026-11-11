import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import type { ModelFormat } from '../scene/schema';
import { createDemoBike } from './demoBike';
import { type Decoder, decodersFor, gltfExtensionsUsed } from './gltfInfo';

export class ModelLoadError extends Error {}

const CONVERT_HINT = 'Convert it to GLB with tools/usdz-to-glb.py (Blender) and drop the .glb instead.';

/** Non-fatal problems found while loading (e.g. a texture that did not decode), for the UI to show. */
export function loadWarnings(object: THREE.Object3D): string[] {
  return (object.userData.loadWarnings as string[] | undefined) ?? [];
}

/**
 * Loads a model into a plain Object3D. Object Capture exports USDZ with a binary USDC layer
 * (meters, +Y up), read by ./usd (three's USD parsers plus fixes); GLB stays the most portable
 * format (see tools/usdz-to-glb.py). PLY covers raw meshes and point clouds.
 */
export async function loadModel(url: string, format: ModelFormat): Promise<THREE.Object3D> {
  try {
    switch (format) {
      case 'demo':
        return createDemoBike();
      case 'glb':
      case 'gltf':
        return await loadGltf(url);
      case 'usdz':
        return await loadUsdz(url);
      case 'ply':
        return plyToObject(await new PLYLoader().loadAsync(url));
    }
  } catch (err) {
    if (err instanceof ModelLoadError) throw err;
    throw new ModelLoadError(`Could not load ${format.toUpperCase()} model: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** KTX2 textures need the renderer to pick a GPU format; the Viewer registers it. */
let renderer: THREE.WebGLRenderer | null = null;
export function setLoaderRenderer(r: THREE.WebGLRenderer | null): void {
  renderer = r;
}

/** One instance per decoder for the page's lifetime: each owns workers and a compiled WASM module. */
const decoders: Partial<Record<Decoder, Promise<(loader: GLTFLoader) => void>>> = {};

/**
 * GLB/glTF with lazy decoders: the file's `extensionsUsed` decides which of Meshopt (~20 KB),
 * Draco (~300 KB WASM) and KTX2/Basis (~550 KB WASM) are fetched; plain GLBs fetch none. The
 * decoder files ship with the build (three's loaders resolve them via `new URL(…, import.meta.url)`,
 * which Vite emits as assets), never from a CDN.
 */
async function loadGltf(url: string): Promise<THREE.Object3D> {
  const bytes = await fetchBytes(url);
  const loader = new GLTFLoader();
  for (const configure of await Promise.all(decodersFor(gltfExtensionsUsed(bytes)).map(decoder))) configure(loader);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const gltf = await loader.parseAsync(buffer, THREE.LoaderUtils.extractUrlBase(url));
  return gltf.scene;
}

function decoder(name: Decoder): Promise<(loader: GLTFLoader) => void> {
  const pending = (decoders[name] ??= createDecoder(name));
  // A failed download (offline) may succeed next time.
  pending.catch(() => delete decoders[name]);
  return pending;
}

async function createDecoder(name: Decoder): Promise<(loader: GLTFLoader) => void> {
  switch (name) {
    case 'meshopt': {
      const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
      await MeshoptDecoder.ready;
      return (loader) => loader.setMeshoptDecoder(MeshoptDecoder);
    }
    case 'draco': {
      const { DRACOLoader, DRACO_GLTF_CONFIG } = await import('three/examples/jsm/loaders/DRACOLoader.js');
      // The glTF-only decoder build: smaller than the full one.
      const draco = new DRACOLoader().setDecoderPath(DRACO_GLTF_CONFIG);
      return (loader) => loader.setDRACOLoader(draco);
    }
    case 'ktx2': {
      if (!renderer) throw new ModelLoadError('KTX2 textures need the 3D view to be ready.');
      const { KTX2Loader } = await import('three/examples/jsm/loaders/KTX2Loader.js');
      const ktx2 = new KTX2Loader().detectSupport(renderer);
      return (loader) => loader.setKTX2Loader(ktx2);
    }
  }
}

async function loadUsdz(url: string): Promise<THREE.Object3D> {
  // The USD parsers are ~70 KB of minified JS that only captures need, so they load on first use.
  const [{ loadUsd }, bytes] = await Promise.all([import('./usd/usdz'), fetchBytes(url)]);
  let result: Awaited<ReturnType<typeof loadUsd>>;
  try {
    result = await loadUsd(bytes);
  } catch (err) {
    throw new ModelLoadError(`Could not read this USDZ (${err instanceof Error ? err.message : String(err)}). ${CONVERT_HINT}`);
  }
  const { object, stats, warnings } = result;
  if (!stats.meshes || !stats.triangles) throw new ModelLoadError(`This USDZ has no mesh the viewer can show. ${CONVERT_HINT}`);
  const ms = stats.ms;
  console.info(
    `USDZ ${stats.rootLayer}${stats.crate ? ' (binary)' : ''}: ${stats.meshes} mesh(es), ${Math.round(stats.triangles)} triangles, ` +
      `${stats.textures.loaded} textures; unzip ${ms.unzip.toFixed(0)} ms, parse ${ms.parse.toFixed(0)} ms, build ${ms.compose.toFixed(0)} ms, weld ${ms.weld.toFixed(0)} ms (${stats.vertices.before} → ${stats.vertices.after} vertices), textures ${ms.textures.toFixed(0)} ms`,
  );
  object.userData.loadWarnings = warnings;
  return object;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new ModelLoadError(`Could not download the model (HTTP ${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

function plyToObject(geometry: THREE.BufferGeometry): THREE.Object3D {
  const hasColor = geometry.hasAttribute('color');
  if (geometry.index && geometry.index.count > 0) {
    if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: hasColor, color: hasColor ? 0xffffff : 0x9a9a9a, roughness: 0.8 }));
  }
  // Point cloud (or a gaussian-splat PLY rendered as points until splat support lands).
  return new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.004, vertexColors: hasColor, color: hasColor ? 0xffffff : 0x9a9a9a }));
}

/**
 * Wraps a freshly loaded model so its bounding box is centered on X/Z and rests on y=0.
 * Deterministic for a given file, so annotation positions saved against it stay valid.
 */
export function centerOnGround(model: THREE.Object3D): THREE.Group {
  const wrapper = new THREE.Group();
  wrapper.name = 'centered';
  wrapper.add(model);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  if (!box.isEmpty()) {
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
  }
  return wrapper;
}
