import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { isCrate, parseCrate } from '../src/viewer/usd/crate';
import { UsdLoadError, loadUsd } from '../src/viewer/usd/usdz';
import { unzipSync, zipSync } from 'fflate';

// Synthetic fixtures from tools/fixtures/make-usdc.py (see test/fixtures/README.md).
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const OBJECT_CAPTURE = 'object-capture-like.usdz';
const ZUP_SUBSETS = 'zup-cm-subsets.usdz';

// Node has no image decoder. Stand in for HTMLImageElement: "decode" anything that starts with a
// PNG/JPEG signature, so texture wiring is tested without a browser.
const decoded: string[] = [];
beforeAll(() => {
  class FakeImage {
    width = 1;
    height = 1;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(url: string) {
      void fetch(url)
        .then((r) => r.arrayBuffer())
        .then((b) => {
          const u = new Uint8Array(b);
          const ok = (u[0] === 0x89 && u[1] === 0x50) || (u[0] === 0xff && u[1] === 0xd8);
          decoded.push(ok ? 'ok' : 'bad');
          (ok ? this.onload : this.onerror)?.();
        });
    }
  }
  (globalThis as unknown as { Image: unknown }).Image = FakeImage;
});

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => (o as THREE.Mesh).isMesh && out.push(o as THREE.Mesh));
  return out;
}

function worldBox(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root);
}

describe('fixtures', () => {
  it('are binary USDC (crate) packages with the layer first, like Object Capture', () => {
    for (const name of [OBJECT_CAPTURE, ZUP_SUBSETS]) {
      const files = unzipSync(fixture(name));
      const first = Object.keys(files)[0];
      expect(first).toBe('baked_mesh.usdc');
      expect(isCrate(files[first])).toBe(true);
    }
  });
});

describe('parseCrate', () => {
  it('reads the stage metadata and mesh topology', () => {
    const layer = parseCrate(unzipSync(fixture(OBJECT_CAPTURE))['baked_mesh.usdc']);
    const root = layer.specsByPath['/'].fields;
    expect(root).toMatchObject({ upAxis: 'Y', metersPerUnit: 1, defaultPrim: 'baked_mesh' });
    const counts = layer.specsByPath['/baked_mesh/baked_mesh.faceVertexCounts'].fields.default as Int32Array;
    const indices = layer.specsByPath['/baked_mesh/baked_mesh.faceVertexIndices'].fields.default as Int32Array;
    expect(counts.length).toBe(1080);
    expect(indices.length).toBe(3 * 1080);
    expect(layer.specsByPath['/baked_mesh/baked_mesh.primvars:st'].fields).toMatchObject({ interpolation: 'faceVarying' });
    expect((layer.specsByPath['/baked_mesh/baked_mesh.primvars:st:indices'].fields.default as Int32Array).length).toBe(3 * 1080);
  });

  it('decodes small integral double3 values that USD inlines as int8 (three r186 returned a packed int)', () => {
    const layer = parseCrate(unzipSync(fixture(ZUP_SUBSETS))['baked_mesh.usdc']);
    expect(layer.specsByPath['/baked_mesh.xformOp:translate'].fields.default).toEqual([0, 0, 5]);
  });

  it('decodes the other values three r186 misreads: negative ints, halves, half3, double4', () => {
    const { specsByPath } = parseCrate(unzipSync(fixture(ZUP_SUBSETS))['baked_mesh.usdc']);
    const value = (name: string) => specsByPath[`/baked_mesh.test:${name}`].fields.default;
    expect(value('int')).toBe(-3);
    expect(value('half')).toBe(0.5);
    expect(value('double3')).toEqual([1, -2, 3]);
    expect(value('half3')).toEqual([1.5, -2, 0.25]);
    expect(value('double4')).toEqual([-1, 0, 1, 2]);
  });

  it('builds the same geometry as three.js USDComposer, faster', async () => {
    const { USDComposer } = await import('three/examples/jsm/loaders/usd/USDComposer.js');
    const { FastUSDComposer } = await import('../src/viewer/usd/composer');
    for (const name of [OBJECT_CAPTURE, ZUP_SUBSETS]) {
      const layer = parseCrate(unzipSync(fixture(name))['baked_mesh.usdc']);
      const [a] = meshesOf(new USDComposer().compose(layer, {}, {}, ''));
      const [b] = meshesOf(new FastUSDComposer().compose(layer, {}, {}, ''));
      for (const attr of ['position', 'normal', 'uv']) expect(b.geometry.getAttribute(attr).array).toEqual(a.geometry.getAttribute(attr).array);
      expect(b.geometry.groups).toEqual(a.geometry.groups);
    }
  });
});

describe('loadUsd', () => {
  it('loads an Object-Capture-like USDZ: one textured mesh, meters, +Y up', async () => {
    const { object, stats, warnings } = await loadUsd(fixture(OBJECT_CAPTURE));
    expect(warnings).toEqual([]);
    expect(stats).toMatchObject({ rootLayer: 'baked_mesh.usdc', crate: true, meshes: 1, triangles: 1080, textures: { loaded: 3, failed: 0 } });

    const [mesh] = meshesOf(object);
    const geo = mesh.geometry;
    expect(geo.getAttribute('position').count).toBe(3240);
    expect(geo.getAttribute('normal').count).toBe(3240);
    const uv = geo.getAttribute('uv');
    expect(uv.count).toBe(3240);
    const us = Array.from({ length: uv.count }, (_, i) => uv.getX(i));
    const vs = Array.from({ length: uv.count }, (_, i) => uv.getY(i));
    expect(Math.min(...us)).toBeCloseTo(0.02, 3);
    expect(Math.max(...us)).toBeCloseTo(0.98, 3);
    expect(Math.min(...vs)).toBeCloseTo(0.02, 3);
    expect(Math.max(...vs)).toBeCloseTo(0.98, 3);

    const mat = mesh.material as THREE.MeshStandardMaterial;
    expect(mat.isMeshStandardMaterial).toBe(true);
    expect(mat.map?.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(mat.map?.image).toBeTruthy();
    expect(mat.normalMap?.colorSpace).toBe(THREE.NoColorSpace);
    expect(mat.normalScale.toArray()).toEqual([1, 1]); // scale 2 / bias -1 is the plain decode
    expect(mat.aoMap).toBeTruthy();
    expect(mat.roughness).toBeCloseTo(0.75);
    expect(mat.metalness).toBe(0);

    // Meters, +Y up: a ~1.7 m long bike standing on y = 0.05 (the root translate).
    const box = worldBox(object);
    expect(box.min.y).toBeCloseTo(0.05, 2);
    expect(box.max.x - box.min.x).toBeCloseTo(1.736, 2);
    expect(box.max.y - box.min.y).toBeGreaterThan(0.8);
    expect(box.max.z - box.min.z).toBeLessThan(0.05);
  });

  it('applies metersPerUnit and upAxis Z, and binds GeomSubset materials', async () => {
    const { object, stats } = await loadUsd(fixture(ZUP_SUBSETS));
    expect(stats).toMatchObject({ meshes: 1, triangles: 1080, textures: { loaded: 1, failed: 0 } });
    const [mesh] = meshesOf(object);
    const mats = mesh.material as THREE.MeshStandardMaterial[];
    expect(mats).toHaveLength(2);
    // Subset order is three's choice; match groups to materials instead.
    const trisByMaterial = new Map(mesh.geometry.groups.map((g) => [mats[g.materialIndex!], g.count / 3]));
    const wheels = mats.find((m) => m.map)!;
    const frame = mats.find((m) => !m.map)!;
    expect(trisByMaterial.get(wheels)).toBe(864);
    expect(trisByMaterial.get(frame)).toBe(216);
    expect(frame.color.r).toBeGreaterThan(5 * frame.color.g); // flat red diffuseColor

    // Same bike as the Y-up fixture once units and axis are applied: Z-up centimeters → Y-up meters.
    const box = worldBox(object);
    expect(box.min.y).toBeCloseTo(0.05, 2);
    expect(box.max.x - box.min.x).toBeCloseTo(1.736, 2);
    expect(box.max.z - box.min.z).toBeLessThan(0.05);
  });

  it('loads a bare .usdc layer (no package, so no textures)', async () => {
    const usdc = unzipSync(fixture(OBJECT_CAPTURE))['baked_mesh.usdc'];
    const { stats } = await loadUsd(usdc);
    expect(stats).toMatchObject({ crate: true, meshes: 1, triangles: 1080 });
  });

  it('reports a broken texture instead of failing the model', async () => {
    const files = unzipSync(fixture(OBJECT_CAPTURE));
    files['0/baked_mesh_tex0.png'] = new Uint8Array([1, 2, 3, 4]);
    const { stats, warnings } = await loadUsd(zipSync(files, { level: 0 }));
    expect(stats.textures).toEqual({ loaded: 2, failed: 1 });
    expect(warnings[0]).toMatch(/1 texture could not be decoded/);
  });

  it('rejects packages without a USD layer and corrupt crates with UsdLoadError', async () => {
    await expect(loadUsd(zipSync({ 'readme.txt': new Uint8Array(3) }))).rejects.toThrow(UsdLoadError);
    const files = unzipSync(fixture(OBJECT_CAPTURE));
    files['baked_mesh.usdc'] = files['baked_mesh.usdc'].slice(0, 200);
    await expect(loadUsd(zipSync(files, { level: 0 }))).rejects.toThrow(/Could not parse baked_mesh.usdc/);
  });
});
