import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { USDLoader } from 'three/examples/jsm/loaders/USDLoader.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_NAME, POSE_COUNT, buildFixtures, orbitPoses } from '../../../tools/fixtures/make-capture-bundle.mjs';
import { CaptureBundleError, readCaptureBundle, sceneFromCapture } from '../src/scene/capture';

// The synthetic capture bundles the E2E suite drops on the viewer (tools/fixtures). Checking them
// here keeps the E2E failures meaningful: if these pass, a failing E2E is the app's fault.

let fixtures: Record<string, Uint8Array>;
beforeAll(async () => {
  fixtures = await buildFixtures();
});

const buffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
}

describe('capture bundle fixtures', () => {
  it('are deterministic', async () => {
    const again = await buildFixtures();
    for (const [name, bytes] of Object.entries(fixtures)) expect(Buffer.from(again[name]).equals(Buffer.from(bytes)), name).toBe(true);
  });

  it('the iOS-layout bundle reads like a real export', async () => {
    const b = await readCaptureBundle(fixtures['bike.bikecapture.zip']);
    expect(b.manifest).toMatchObject({ name: FIXTURE_NAME, mode: 'object', imageCount: POSE_COUNT });
    expect(b.model.format).toBe('usdz');
    expect(b.poses?.samples).toHaveLength(POSE_COUNT);
    expect(b.images).toHaveLength(POSE_COUNT);
    expect(b.warnings).toEqual([]);
    expect(sceneFromCapture(b, 'bike.bikecapture.zip').id).toBe('capture-fixture-gravel-bike-20260102030405');
  });

  it('covers the GLB, flat, broken-poses and no-model variants', async () => {
    expect((await readCaptureBundle(fixtures['bike-glb.bikecapture.zip'])).model.format).toBe('glb');
    const flat = await readCaptureBundle(fixtures['bike-flat.bikecapture.zip']);
    expect(flat.manifest.name).toBe('Fixture Flat Bike');
    const broken = await readCaptureBundle(fixtures['bike-broken-poses.bikecapture.zip']);
    expect(broken.poses).toBeNull();
    expect(broken.warnings[0]).toMatch(/samples\[0\]/);
    await expect(readCaptureBundle(fixtures['bike-no-model.bikecapture.zip'])).rejects.toThrow(/no 3D model yet/);
    await expect(readCaptureBundle(fixtures['not-a-zip.bikecapture.zip'])).rejects.toBeInstanceOf(CaptureBundleError);
  });

  it('the USDZ loads in three.js as a bike-sized, colored, multi-part mesh', () => {
    const group = new USDLoader().parse(buffer(fixtures['bike.usdz']));
    const parts = meshes(group);
    expect(parts.map((m) => m.name).sort()).toEqual(['cockpit', 'drivetrain', 'fork', 'frame', 'front_wheel', 'rear_wheel', 'saddle']);
    const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(1.5); // wheelbase + wheels
    expect(size.x).toBeLessThan(2);
    expect(size.y).toBeGreaterThan(0.9);
    const frame = parts.find((m) => m.name === 'frame')!;
    expect((frame.material as THREE.MeshStandardMaterial).color.r).toBeGreaterThan(0.5);
  });

  it('the GLB loads in three.js with vertex colors', async () => {
    const gltf = await new GLTFLoader().parseAsync(buffer(fixtures['bike.glb']), '');
    const parts = meshes(gltf.scene);
    expect(parts).toHaveLength(7);
    for (const m of parts) expect(m.geometry.getAttribute('color')).toBeDefined();
  });

  it('poses orbit the bike with every camera looking at it', () => {
    const { samples } = orbitPoses([0, 0.55, 0]);
    expect(samples).toHaveLength(POSE_COUNT);
    const target = new THREE.Vector3(0, 0.55, 0);
    for (const s of samples) {
      const m = new THREE.Matrix4().fromArray(s.transform);
      const eye = new THREE.Vector3().setFromMatrixPosition(m);
      // Cameras look down their local -Z axis.
      const forward = new THREE.Vector3(0, 0, -1).transformDirection(m);
      expect(forward.angleTo(target.clone().sub(eye).normalize())).toBeLessThan(1e-3);
      expect(eye.distanceTo(target)).toBeGreaterThan(1);
    }
    expect(new Set(samples.map((s) => s.file)).size).toBe(POSE_COUNT);
  });
});
