import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildCompressedGlbs } from '../../../tools/fixtures/make-compressed-glb.mjs';
import { buildFixtures } from '../../../tools/fixtures/make-capture-bundle.mjs';
import { gltfExtensionsUsed } from '../src/viewer/gltfInfo';
import { ModelLoadError, loadModel } from '../src/viewer/loaders';

// GLB compression: fixtures from tools/optimize-glb.mjs, decoded by the viewer's lazy decoders.
// Draco and KTX2 need Workers / WebGL, so the browser parts run in e2e/perf.spec.ts.

const dataUrl = (bytes: Uint8Array) => `data:model/gltf-binary;base64,${Buffer.from(bytes).toString('base64')}`;

function triangles(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const g = (o as THREE.Mesh).isMesh ? (o as THREE.Mesh).geometry : null;
    if (g) n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return n;
}

let plain: Uint8Array;
let compressed: Awaited<ReturnType<typeof buildCompressedGlbs>>;
beforeAll(async () => {
  plain = (await buildFixtures())['bike.glb'];
  compressed = await buildCompressedGlbs(plain);
}, 30_000);

describe('compressed GLB fixtures', () => {
  it('declare the extensions the viewer keys its decoders on', () => {
    expect(gltfExtensionsUsed(plain)).toEqual([]);
    expect(gltfExtensionsUsed(compressed['bike-meshopt.glb'])).toContain('EXT_meshopt_compression');
    expect(gltfExtensionsUsed(compressed['bike-draco.glb'])).toContain('KHR_draco_mesh_compression');
    expect(gltfExtensionsUsed(compressed['bike-ktx2.glb'])).toContain('KHR_texture_basisu');
    expect(compressed['bike-meshopt.glb'].length).toBeLessThan(plain.length / 2);
    expect(compressed['bike-draco.glb'].length).toBeLessThan(plain.length / 4);
  });
});

describe('loadModel with compressed GLBs', () => {
  it('decodes Meshopt geometry to the same triangles, named parts kept', async () => {
    const a = await loadModel(dataUrl(plain), 'glb');
    const b = await loadModel(dataUrl(compressed['bike-meshopt.glb']), 'glb');
    expect(triangles(b)).toBe(triangles(a));
    expect(b.getObjectByName('front-wheel')).toBeTruthy();
    const size = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
    // Quantized positions: within a millimeter.
    expect(size(b).distanceTo(size(a))).toBeLessThan(1e-3);
  });

  it('explains instead of crashing when KTX2 textures arrive before the 3D view exists', async () => {
    const err = await loadModel(dataUrl(compressed['bike-ktx2.glb']), 'glb').catch((e) => e);
    expect(err).toBeInstanceOf(ModelLoadError);
    expect(err.message).toMatch(/KTX2/);
  });
});
