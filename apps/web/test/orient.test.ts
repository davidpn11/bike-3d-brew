import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  type Mat3,
  axisAngle,
  eulerXYZFromMatrix,
  estimateOrientation,
  matrixFromEulerXYZ,
  multiply,
  rotateAboutWorld,
  rotationDistance,
  shouldAutoOrient,
  symmetricEigen,
} from '../src/scene/orient';
import { SCHEMA, type BikeScene, type Vec3 } from '../src/scene/schema';

const DEG = Math.PI / 180;
const I: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Deterministic PRNG so failures are reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A road bike as a surface point cloud in the target frame: +X front, +Y up, +Z drive side,
 * tyres touching y = 0. Densities roughly follow surface area like a scanned mesh.
 */
function syntheticBike(rand = rng(1), scale = 1): number[] {
  const out: number[] = [];
  const push = (x: number, y: number, z: number) => out.push(x * scale, y * scale, z * scale);
  const jitter = (r: number) => (rand() - 0.5) * 2 * r;
  const wheel = (cx: number) => {
    for (let i = 0; i < 6000; i++) {
      const a = rand() * Math.PI * 2;
      const tube = rand() * Math.PI * 2;
      const r = 0.33 + Math.cos(tube) * 0.014;
      push(cx + Math.cos(a) * r, 0.344 + Math.sin(a) * r, Math.sin(tube) * 0.014);
    }
    for (let i = 0; i < 1500; i++) {
      const a = Math.floor(rand() * 24) * ((Math.PI * 2) / 24);
      const t = rand();
      push(cx + Math.cos(a) * 0.3 * t, 0.344 + Math.sin(a) * 0.3 * t, (1 - t) * (rand() < 0.5 ? 0.035 : -0.035));
    }
  };
  const tube = (a: Vec3, b: Vec3, r: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const t = rand();
      push(a[0] + (b[0] - a[0]) * t + jitter(r), a[1] + (b[1] - a[1]) * t + jitter(r), a[2] + (b[2] - a[2]) * t + jitter(r));
    }
  };
  wheel(-0.5);
  wheel(0.5);
  const bb: Vec3 = [-0.08, 0.27, 0];
  const seatTop: Vec3 = [-0.22, 0.84, 0];
  const headTop: Vec3 = [0.36, 0.86, 0];
  const headBot: Vec3 = [0.42, 0.66, 0];
  tube(bb, seatTop, 0.015, 900);
  tube(seatTop, headTop, 0.015, 900);
  tube(bb, headBot, 0.02, 1000);
  tube(headTop, headBot, 0.02, 300);
  tube([-0.5, 0.344, 0.05], bb, 0.01, 500);
  tube([-0.5, 0.344, -0.05], bb, 0.01, 500);
  tube([-0.5, 0.344, 0.05], seatTop, 0.01, 500);
  tube([-0.5, 0.344, -0.05], seatTop, 0.01, 500);
  tube(headBot, [0.5, 0.344, 0.05], 0.012, 400);
  tube(headBot, [0.5, 0.344, -0.05], 0.012, 400);
  tube([-0.25, 0.84, 0], [-0.26, 0.95, 0], 0.01, 200); // seatpost
  tube([-0.36, 0.96, 0], [-0.1, 0.96, 0], 0.03, 600); // saddle
  tube([0.36, 0.86, 0], [0.45, 0.92, 0], 0.015, 200); // stem
  tube([0.45, 0.92, -0.21], [0.45, 0.92, 0.21], 0.012, 900); // bars
  tube([0.45, 0.92, 0.21], [0.5, 0.78, 0.21], 0.012, 300); // drops
  tube([0.45, 0.92, -0.21], [0.5, 0.78, -0.21], 0.012, 300);
  // Drivetrain on the +Z side: chainrings, cassette, crank arms and pedals.
  for (let i = 0; i < 1600; i++) {
    const a = rand() * Math.PI * 2;
    const r = 0.1 + jitter(0.006);
    push(bb[0] + Math.cos(a) * r, bb[1] + Math.sin(a) * r, 0.06);
  }
  for (let i = 0; i < 500; i++) {
    const a = rand() * Math.PI * 2;
    push(-0.5 + Math.cos(a) * 0.05, 0.344 + Math.sin(a) * 0.05, 0.045);
  }
  tube([bb[0], bb[1], 0.07], [bb[0] + 0.1, bb[1] - 0.14, 0.08], 0.01, 200);
  tube([bb[0], bb[1], -0.07], [bb[0] - 0.1, bb[1] + 0.14, -0.08], 0.01, 200);
  tube([bb[0] + 0.1, bb[1] - 0.14, 0.08], [bb[0] + 0.1, bb[1] - 0.14, 0.17], 0.015, 150);
  tube([bb[0] - 0.1, bb[1] + 0.14, -0.08], [bb[0] - 0.1, bb[1] + 0.14, -0.17], 0.015, 150);
  return out;
}

function randomRotation(rand: () => number): Mat3 {
  // Uniform random unit quaternion (Shoemake).
  const u1 = rand();
  const u2 = rand() * Math.PI * 2;
  const u3 = rand() * Math.PI * 2;
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  const q = new THREE.Quaternion(a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3));
  const e = new THREE.Matrix4().makeRotationFromQuaternion(q).elements; // column-major
  return [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]];
}

function transform(points: number[], r: Mat3, t: Vec3 = [0, 0, 0]): Float32Array {
  const out = new Float32Array(points.length);
  for (let i = 0; i < points.length; i += 3) {
    const [x, y, z] = [points[i], points[i + 1], points[i + 2]];
    out[i] = r[0] * x + r[1] * y + r[2] * z + t[0];
    out[i + 1] = r[3] * x + r[4] * y + r[5] * z + t[1];
    out[i + 2] = r[6] * x + r[7] * y + r[8] * z + t[2];
  }
  return out;
}

const bike = syntheticBike();

describe('estimateOrientation', () => {
  it('leaves an upright bike facing +X alone', () => {
    const res = estimateOrientation(new Float32Array(bike))!;
    expect(res.keptUp).toBe(true);
    expect(rotationDistance(res.matrix, I)).toBeLessThan(2 * DEG);
  });

  it('fixes only the yaw of a gravity-aligned capture, including facing backwards', () => {
    for (const yaw of [17, 90, 135, 180, -100]) {
      const scanned = transform(bike, axisAngle('y', yaw * DEG), [0.3, 0.1, -2]);
      const res = estimateOrientation(scanned)!;
      expect(res.keptUp).toBe(true);
      expect(res.rotation[0]).toBeCloseTo(0, 6);
      expect(res.rotation[2]).toBeCloseTo(0, 6);
      expect(rotationDistance(multiply(res.matrix, axisAngle('y', yaw * DEG)), I) / DEG).toBeLessThan(2);
    }
  });

  it('stands a bike lying on its side or upside down back up', () => {
    for (const r of [axisAngle('x', 90 * DEG), axisAngle('x', -90 * DEG), axisAngle('z', 180 * DEG), axisAngle('x', 180 * DEG)]) {
      const res = estimateOrientation(transform(bike, r))!;
      expect(rotationDistance(multiply(res.matrix, r), I) / DEG).toBeLessThan(3);
    }
  });

  it('recovers random rotations (and units) within 3°', () => {
    const rand = rng(42);
    let worst = 0;
    let worstPreferY = 0;
    for (let i = 0; i < 60; i++) {
      const r = randomRotation(rand);
      const scanned = transform(syntheticBike(rng(100 + i), i % 2 ? 1 : 100), r, [rand() * 5, rand() * 5, rand() * 5]);
      const strict = estimateOrientation(scanned, { preferYUp: false })!;
      worst = Math.max(worst, rotationDistance(multiply(strict.matrix, r), I) / DEG);
      // Preferring Y-up may keep a tilt below the 6° threshold (real captures are gravity-aligned).
      const res = estimateOrientation(scanned)!;
      worstPreferY = Math.max(worstPreferY, rotationDistance(multiply(res.matrix, r), I) / DEG);
    }
    expect(worst).toBeLessThan(3);
    expect(worstPreferY).toBeLessThan(6.5);
  });

  it('produces Euler angles that three.js turns into the same rotation', () => {
    const r = randomRotation(rng(7));
    const res = estimateOrientation(transform(bike, r))!;
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...res.rotation, 'XYZ')).elements;
    const fromThree: Mat3 = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
    expect(rotationDistance(fromThree, res.matrix)).toBeLessThan(1e-4);
  });

  it('handles 1M vertices in under 50 ms', () => {
    const big = new Float32Array(3_000_000);
    const rot = transform(bike, randomRotation(rng(3)));
    for (let i = 0; i < big.length; i++) big[i] = rot[i % rot.length] + ((i * 2654435761) % 1000) * 1e-6;
    let best = Infinity;
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now();
      estimateOrientation(big);
      best = Math.min(best, performance.now() - t0);
    }
    console.info(`estimateOrientation(1M vertices): ${best.toFixed(1)} ms`);
    expect(best).toBeLessThan(50);
  });

  it('rejects degenerate input', () => {
    expect(estimateOrientation(new Float32Array(6))).toBeNull();
    expect(estimateOrientation(new Float32Array(300).fill(1))).toBeNull();
    const line = new Float32Array(300);
    for (let i = 0; i < 100; i++) line[i * 3] = i;
    expect(estimateOrientation(line)).toBeNull();
    const withNaN = new Float32Array(bike);
    withNaN[0] = NaN;
    expect(estimateOrientation(withNaN)).not.toBeNull();
  });
});

describe('rotation helpers', () => {
  it('matches three.js Euler XYZ in both directions', () => {
    const rand = rng(9);
    for (let i = 0; i < 20; i++) {
      const e: Vec3 = [(rand() - 0.5) * 6, (rand() - 0.5) * 3, (rand() - 0.5) * 6];
      const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...e, 'XYZ')).elements;
      const ours = matrixFromEulerXYZ(e);
      expect(ours.map((v) => +v.toFixed(9))).toEqual([m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]].map((v) => +v.toFixed(9)));
      const back = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...e, 'XYZ')), 'XYZ');
      eulerXYZFromMatrix(ours).forEach((v, k) => expect(v).toBeCloseTo([back.x, back.y, back.z][k], 5));
    }
    expect(eulerXYZFromMatrix(axisAngle('y', Math.PI / 2))[1]).toBeCloseTo(Math.PI / 2, 6); // gimbal lock branch
  });

  it('rotates about world axes on top of an existing rotation', () => {
    expect(rotateAboutWorld(undefined, 'y', Math.PI / 2)).toEqual([0, 1.570796, 0]);
    const r = rotateAboutWorld(rotateAboutWorld([0.3, 0, 0], 'z', Math.PI / 2), 'z', -Math.PI / 2);
    r.forEach((v, k) => expect(v).toBeCloseTo([0.3, 0, 0][k], 5));
    const twice = rotateAboutWorld(rotateAboutWorld([0, 0, 0], 'x', Math.PI), 'x', Math.PI);
    expect(rotationDistance(matrixFromEulerXYZ(twice), I)).toBeLessThan(1e-5);
  });

  it('diagonalises symmetric matrices', () => {
    const { values, vectors } = symmetricEigen([4, 1, 0, 1, 3, 0, 0, 0, 1]);
    expect(values[0]).toBeCloseTo((7 + Math.sqrt(5)) / 2, 9);
    expect(values[2]).toBeCloseTo(1, 9);
    expect(Math.abs(vectors[2][2])).toBeCloseTo(1, 9);
  });
});

describe('shouldAutoOrient', () => {
  const scene = (patch: Partial<BikeScene> = {}): BikeScene => ({
    schema: SCHEMA,
    id: 'c',
    name: 'Capture',
    model: { url: 'bundle:a.zip/model.usdz', format: 'usdz' },
    background: 'transparent',
    hotspots: [],
    annotations: [],
    ...patch,
  });
  it('only orients fresh captures', () => {
    expect(shouldAutoOrient(scene())).toBe(true);
    expect(shouldAutoOrient(scene({ model: { url: 'demo:road', format: 'demo' } }))).toBe(false);
    expect(shouldAutoOrient(scene({ model: { url: 'x.usdz', format: 'usdz', rotation: [0, 0, 0] } }))).toBe(false);
    expect(shouldAutoOrient(scene({ annotations: [{ id: 'n', position: [0, 0, 0], title: '', body: '', kind: 'note', createdAt: '' }] }))).toBe(false);
  });
});
