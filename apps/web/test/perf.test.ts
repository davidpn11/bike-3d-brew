import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BVH_MIN_TRIANGLES, accelerateRaycasts, countTriangles } from '../src/viewer/bvh';
import { decodersFor, gltfExtensionsUsed } from '../src/viewer/gltfInfo';
import { HEAVY_TRIANGLES, chooseQuality, isHandheld, parseQualityLevel, pixelRatioFor } from '../src/viewer/quality';
import { RenderScheduler } from '../src/viewer/renderScheduler';
import { weldArrays, weldGeometry } from '../src/viewer/weld';

// Pure parts of the rendering/loading performance work (docs/PERFORMANCE.md).

describe('RenderScheduler', () => {
  function setup() {
    const loop = vi.fn();
    const s = new RenderScheduler(loop);
    return { s, loop, on: () => loop.mock.calls.at(-1)?.[0] as boolean | undefined };
  }

  it('starts the loop on a request, draws once and stops again', () => {
    const { s, loop, on } = setup();
    expect(s.active).toBe(false);
    s.request();
    expect(on()).toBe(true);
    expect(s.active).toBe(true);
    expect(s.frame(false)).toBe(true);
    expect(on()).toBe(false);
    expect(s.renders).toBe(1);
    expect(loop).toHaveBeenCalledTimes(2);
  });

  it('coalesces requests within a frame and honors multi-frame requests', () => {
    const { s, loop } = setup();
    s.request();
    s.request();
    s.request(3);
    expect(loop).toHaveBeenCalledTimes(1);
    expect([s.frame(false), s.frame(false), s.frame(false), s.frame(false)]).toEqual([true, true, true, false]);
    expect(s.renders).toBe(3);
    expect(s.active).toBe(false);
  });

  it('keeps running while the camera moves and one frame after, to see it stop', () => {
    const { s } = setup();
    s.request();
    expect(s.frame(true)).toBe(true);
    expect(s.frame(true)).toBe(true);
    expect(s.active).toBe(true);
    // Damping ended: nothing to draw, loop stops.
    expect(s.frame(false)).toBe(false);
    expect(s.active).toBe(false);
    expect(s.renders).toBe(2);
  });

  it('pauses while hidden and redraws once when visible again', () => {
    const { s, on } = setup();
    s.request();
    s.setHidden(true);
    expect(on()).toBe(false);
    s.request();
    expect(s.active).toBe(false);
    s.setHidden(false);
    expect(on()).toBe(true);
    expect(s.frame(false)).toBe(true);
    expect(s.active).toBe(false);
  });
});

describe('weldArrays', () => {
  // Two triangles of a quad expanded to six corners, two of them shared.
  const quad = () => ({
    position: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0]),
    normal: new Float32Array(Array.from({ length: 6 }, () => [0, 0, 1]).flat()),
    uv: new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]),
  });

  it('merges identical corners into an order-preserving indexed list', () => {
    const { position, normal, uv } = quad();
    const r = weldArrays(
      [
        { array: position, itemSize: 3 },
        { array: normal, itemSize: 3 },
        { array: uv, itemSize: 2 },
      ],
      6,
    );
    expect(r.count).toBe(4);
    expect([...r.index]).toEqual([0, 1, 2, 0, 2, 3]);
    expect([...r.attributes[0].array]).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
    expect([...r.attributes[2].array]).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
    // Same result in any attribute order (the unrolled position/normal/uv path) and on the generic path.
    const reordered = weldArrays(
      [
        { array: uv, itemSize: 2 },
        { array: position, itemSize: 3 },
        { array: normal, itemSize: 3 },
      ],
      6,
    );
    expect([...reordered.index]).toEqual([...r.index]);
    const generic = weldArrays([{ array: position, itemSize: 3 }, { array: uv, itemSize: 2 }], 6);
    expect([...generic.index]).toEqual([...r.index]);
  });

  it('keeps corners apart when any attribute differs (UV seams, hard edges)', () => {
    const { position, normal, uv } = quad();
    uv[6] = 0.5; // the second (0,0,0) corner sits on another UV island
    normal[3 * 4 + 2] = -1; // and (1,1,0) has a hard edge
    const r = weldArrays(
      [
        { array: position, itemSize: 3 },
        { array: normal, itemSize: 3 },
        { array: uv, itemSize: 2 },
      ],
      6,
    );
    expect(r.count).toBe(6);
  });

  it('merges near-identical values within a tolerance, per attribute', () => {
    const position = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1e-7, 0, 0]);
    const exact = weldArrays([{ array: position, itemSize: 3 }], 4);
    expect(exact.count).toBe(4);
    const loose = weldArrays([{ array: position, itemSize: 3 }], 4, 1e-5);
    expect(loose.count).toBe(3);
    expect(loose.index[3]).toBe(0);
    expect(weldArrays([{ array: position, itemSize: 3 }], 4, [1e-5]).count).toBe(3);
  });

  it('handles integer and float64 attributes', () => {
    const ints = new Uint16Array([1, 2, 1, 3, 1, 2]);
    expect(weldArrays([{ array: ints, itemSize: 2 }], 3).count).toBe(2);
    const doubles = new Float64Array([0.1, 0.2, 0.1, 0.3, 0.1]);
    const r = weldArrays([{ array: doubles, itemSize: 1 }], 5);
    expect(r.count).toBe(3);
    expect(r.attributes[0].array).toBeInstanceOf(Float64Array);
  });

  it('is linear-time on a large expanded mesh (hash table, not pairwise)', () => {
    // A 300×300 grid expanded to 6 corners per cell: 540k vertices, 90601 distinct.
    const n = 300;
    const pos = new Float32Array(n * n * 6 * 3);
    let o = 0;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        for (const [di, dj] of [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
          [1, 1],
          [0, 1],
        ]) {
          pos[o++] = i + di;
          pos[o++] = j + dj;
          pos[o++] = 0;
        }
    const t = performance.now();
    const r = weldArrays([{ array: pos, itemSize: 3 }], n * n * 6);
    expect(r.count).toBe((n + 1) * (n + 1));
    expect(performance.now() - t).toBeLessThan(2000);
  });
});

describe('weldGeometry', () => {
  it('turns a non-indexed geometry into an indexed one that draws the same triangles', () => {
    const src = new THREE.TorusGeometry(1, 0.3, 12, 24).toNonIndexed();
    src.addGroup(0, 300, 0);
    src.addGroup(300, src.getAttribute('position').count - 300, 1);
    const flat = src.getAttribute('position').array.slice();
    const stats = weldGeometry(src)!;
    expect(stats.before).toBe(12 * 24 * 6);
    expect(stats.after).toBe(13 * 25);
    expect(src.index!.array).toBeInstanceOf(Uint16Array);
    expect(src.toNonIndexed().getAttribute('position').array).toEqual(flat);
    expect(src.groups.map((g) => g.start)).toEqual([0, 300]);
  });

  it('uses 32-bit indices past 65535 vertices and leaves indexed or morphing geometry alone', () => {
    const big = new THREE.SphereGeometry(1, 400, 200).toNonIndexed();
    // UV-seamless positions would merge; keep every corner distinct to cross the 16-bit limit.
    big.deleteAttribute('uv');
    big.deleteAttribute('normal');
    const pos = big.getAttribute('position');
    for (let i = 0; i < pos.count; i++) pos.setX(i, i);
    expect(weldGeometry(big)!.after).toBe(pos.count);
    expect(big.index).toBeNull(); // nothing merged: left as is

    const sphere = new THREE.SphereGeometry(1, 400, 200).toNonIndexed();
    const stats = weldGeometry(sphere)!;
    expect(stats.after).toBeGreaterThan(65535);
    expect(sphere.index!.array).toBeInstanceOf(Uint32Array);

    expect(weldGeometry(new THREE.BoxGeometry())).toBeNull();
    const morph = new THREE.BoxGeometry().toNonIndexed();
    morph.morphAttributes.position = [morph.getAttribute('position').clone()];
    expect(weldGeometry(morph)).toBeNull();
    expect(weldGeometry(new THREE.BufferGeometry())).toBeNull();
  });
});

describe('quality', () => {
  const phone = { devicePixelRatio: 3, coarsePointer: true, screenMin: 390 };
  const laptop = { devicePixelRatio: 2, coarsePointer: false, screenMin: 900 };
  const office = { devicePixelRatio: 1, coarsePointer: false, screenMin: 1080 };

  it('caps phones at 2× without MSAA and a cheaper shadow map', () => {
    expect(isHandheld(phone)).toBe(true);
    expect(chooseQuality(phone)).toEqual({ pixelRatio: 2, antialias: false, shadowMapSize: 1024, softShadows: false });
  });

  it('keeps soft shadows on desktop and MSAA only at 1×', () => {
    expect(isHandheld(laptop)).toBe(false);
    expect(isHandheld({ ...phone, screenMin: 1024 })).toBe(false); // big iPad
    expect(chooseQuality(laptop)).toEqual({ pixelRatio: 2, antialias: false, shadowMapSize: 2048, softShadows: true });
    expect(chooseQuality(office)).toEqual({ pixelRatio: 1, antialias: true, shadowMapSize: 2048, softShadows: true });
    expect(chooseQuality({ ...office, devicePixelRatio: 0 }).pixelRatio).toBe(1);
  });

  it('honors ?quality=low|high', () => {
    expect(parseQualityLevel('low')).toBe('low');
    expect(parseQualityLevel('high')).toBe('high');
    expect(parseQualityLevel('ultra')).toBe('auto');
    expect(parseQualityLevel(null)).toBe('auto');
    expect(chooseQuality(phone, 'low')).toEqual({ pixelRatio: 1, antialias: false, shadowMapSize: 512, softShadows: false });
    expect(chooseQuality(phone, 'high')).toMatchObject({ pixelRatio: 3, antialias: true, softShadows: true });
  });

  it('drops a phone to 1.5× for heavy captures only', () => {
    const q = chooseQuality(phone);
    expect(pixelRatioFor(q, phone, HEAVY_TRIANGLES + 1)).toBe(1.5);
    expect(pixelRatioFor(q, phone, 50_000)).toBe(2);
    expect(pixelRatioFor(chooseQuality(laptop), laptop, 2_000_000)).toBe(2);
    expect(pixelRatioFor(chooseQuality(phone, 'high'), phone, 2_000_000, 'high')).toBe(3);
  });
});

describe('gltfExtensionsUsed', () => {
  const glb = (json: object | string, chunkType = 0x4e4f534a) => {
    const text = new TextEncoder().encode(typeof json === 'string' ? json : JSON.stringify(json));
    const out = new Uint8Array(20 + text.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, 0x46546c67, true);
    v.setUint32(4, 2, true);
    v.setUint32(8, out.length, true);
    v.setUint32(12, text.length, true);
    v.setUint32(16, chunkType, true);
    out.set(text, 20);
    return out;
  };

  it('reads extensionsUsed from GLB and glTF JSON', () => {
    const exts = ['EXT_meshopt_compression', 'KHR_texture_basisu', 'KHR_materials_clearcoat'];
    expect(gltfExtensionsUsed(glb({ asset: { version: '2.0' }, extensionsUsed: exts }))).toEqual(exts);
    expect(gltfExtensionsUsed(new TextEncoder().encode(JSON.stringify({ extensionsUsed: ['KHR_draco_mesh_compression'] })))).toEqual(['KHR_draco_mesh_compression']);
    expect(gltfExtensionsUsed(glb({ asset: {} }))).toEqual([]);
  });

  it('returns [] for anything malformed', () => {
    expect(gltfExtensionsUsed(new Uint8Array([1, 2, 3]))).toEqual([]);
    expect(gltfExtensionsUsed(glb('{not json'))).toEqual([]);
    expect(gltfExtensionsUsed(glb({ extensionsUsed: 'EXT_meshopt_compression' }))).toEqual([]);
    expect(gltfExtensionsUsed(glb({ extensionsUsed: [1, 'KHR_draco_mesh_compression'] }))).toEqual(['KHR_draco_mesh_compression']);
    expect(gltfExtensionsUsed(glb({ extensionsUsed: [] }, 0x004e4942))).toEqual([]); // BIN chunk first
    const truncated = glb({ extensionsUsed: ['x'] }).subarray(0, 24);
    expect(gltfExtensionsUsed(truncated)).toEqual([]);
    expect(gltfExtensionsUsed(new TextEncoder().encode('null'))).toEqual([]);
  });

  it('maps extensions to the decoders to fetch', () => {
    expect(decodersFor([])).toEqual([]);
    expect(decodersFor(['KHR_materials_clearcoat'])).toEqual([]);
    expect(decodersFor(['KHR_meshopt_compression', 'KHR_draco_mesh_compression', 'KHR_texture_basisu'])).toEqual(['meshopt', 'draco', 'ktx2']);
    expect(decodersFor(['EXT_meshopt_compression'])).toEqual(['meshopt']);
  });
});

describe('accelerateRaycasts', () => {
  it('builds a BVH for big meshes only and keeps raycasts returning the same hit', async () => {
    const big = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), new THREE.MeshBasicMaterial());
    const small = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial());
    small.position.set(0, 0, 2);
    const root = new THREE.Group().add(big, small);
    root.updateMatrixWorld(true);
    expect(countTriangles(root)).toBe(128 * 63 * 2 + 12);
    expect(countTriangles(new THREE.Points(new THREE.BufferGeometry()))).toBe(0);

    const ray = new THREE.Raycaster(new THREE.Vector3(0.03, 0.07, 5), new THREE.Vector3(0, 0, -1));
    ray.params.Points.threshold = 0.01;
    const before = ray.intersectObject(root, true).map((h) => h.distance);

    const { built } = await accelerateRaycasts(root);
    expect(built).toBe(1);
    expect(big.geometry.boundsTree).toBeTruthy();
    expect(small.geometry.boundsTree).toBeUndefined();
    const after = ray.intersectObject(root, true).map((h) => h.distance);
    expect(after.length).toBe(before.length);
    after.forEach((d, i) => expect(d).toBeCloseTo(before[i], 5));
    (ray as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
    expect(ray.intersectObject(big)[0].distance).toBeCloseTo(before.at(-1)!, 5);
    // Already built: nothing to do.
    expect((await accelerateRaycasts(root)).built).toBe(0);
    expect(BVH_MIN_TRIANGLES).toBeGreaterThan(12);
  });
});
