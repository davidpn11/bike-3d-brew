import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { USDZLoader } from 'three/examples/jsm/loaders/USDZLoader.js';
import type { ModelFormat } from '../scene/schema';
import { createDemoBike } from './demoBike';

export class ModelLoadError extends Error {}

/**
 * Loads a model into a plain Object3D. Object Capture exports USDZ (meters, +Y up),
 * which three.js reads directly for most captures; GLB is the most reliable format
 * (see tools/usdz-to-glb.py). PLY covers raw meshes and point clouds.
 */
export async function loadModel(url: string, format: ModelFormat): Promise<THREE.Object3D> {
  try {
    switch (format) {
      case 'demo':
        return createDemoBike();
      case 'glb':
      case 'gltf': {
        const gltf = await new GLTFLoader().loadAsync(url);
        return gltf.scene;
      }
      case 'usdz': {
        const group = await new USDZLoader().loadAsync(url);
        if (!hasMeshes(group)) throw new ModelLoadError('USDZ loaded but contains no meshes three.js can read. Convert it to GLB with tools/usdz-to-glb.py.');
        return group;
      }
      case 'ply':
        return plyToObject(await new PLYLoader().loadAsync(url));
    }
  } catch (err) {
    if (err instanceof ModelLoadError) throw err;
    throw new ModelLoadError(`Could not load ${format.toUpperCase()} model: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function hasMeshes(obj: THREE.Object3D): boolean {
  let found = false;
  obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) found = true;
  });
  return found;
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
