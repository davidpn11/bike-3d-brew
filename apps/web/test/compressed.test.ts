import * as THREE from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { buildCompressedGlbs } from '../../../tools/fixtures/make-compressed-glb.mjs';
import { buildFixtures } from '../../../tools/fixtures/make-capture-bundle.mjs';
import { gltfExtensionsUsed } from '../src/viewer/gltfInfo';
import { ModelLoadError, loadModel, setLoaderRenderer } from '../src/viewer/loaders';

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

  // Node has no Workers or WebGL: decoding stops there, but the decoder set-up runs and the failure
  // must surface as a readable ModelLoadError (the decoded result is checked in e2e/perf.spec.ts).
  it('sets up the Draco decoder and reports a decode failure readably', async () => {
    const err = await loadModel(dataUrl(compressed['bike-draco.glb']), 'glb').catch((e) => e);
    expect(err).toBeInstanceOf(ModelLoadError);
  });

  it('sets up the KTX2 transcoder once the 3D view has registered its renderer', async () => {
    const renderer = { extensions: { has: () => false }, capabilities: {} } as unknown as THREE.WebGLRenderer;
    setLoaderRenderer(renderer);
    try {
      const err = await loadModel(dataUrl(compressed['bike-ktx2.glb']), 'glb').catch((e) => e);
      expect(err).toBeInstanceOf(ModelLoadError);
      expect(err.message).not.toMatch(/3D view to be ready/);
    } finally {
      setLoaderRenderer(null);
    }
  });

  it('explains a USDZ it cannot read', async () => {
    vi.doMock('../src/viewer/usd/usdz', () => ({ loadUsd: async () => Promise.reject(new Error('bad crate')) }));
    const err = await loadModel('data:model/vnd.usdz+zip;base64,' + Buffer.from('not a usdz').toString('base64'), 'usdz').catch((e) => e);
    expect(err).toBeInstanceOf(ModelLoadError);
    expect(err.message).toMatch(/Could not read this USDZ \(bad crate\)/);
    vi.doUnmock('../src/viewer/usd/usdz');
  });
});
