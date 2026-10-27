import { describe, expect, it } from 'vitest';
import { insideBox, moveFace, padBox, suggestCrop } from '../src/scene/crop';
import { rng, syntheticBike } from './helpers/syntheticBike';

/** An area-mode style scan: the bike plus the floor it stands on, a wall behind it, a crate and floaters. */
function areaScan(seed = 5): number[] {
  const rand = rng(seed);
  const out = syntheticBike(rng(seed + 1));
  for (let i = 0; i < 40_000; i++) out.push(-1.3 + rand() * 2.6, (rand() - 0.5) * 0.004, -0.8 + rand() * 1.6); // floor top
  for (let i = 0; i < 15_000; i++) out.push(-1.3 + rand() * 2.6, rand() * 1.2, -0.9 + (rand() - 0.5) * 0.01); // wall
  for (let i = 0; i < 3_000; i++) out.push(0.95 + rand() * 0.3, rand() * 0.3, 0.45 + rand() * 0.3); // crate
  for (let i = 0; i < 30; i++) out.push((rand() - 0.5) * 2.6, rand() * 1.4, (rand() - 0.5) * 1.6); // floaters
  return out;
}

// Bike bounds in the synthetic frame (tyres, bars, pedals).
const BIKE = { min: [-0.844, 0, -0.21], max: [0.844, 0.99, 0.21] };

describe('suggestCrop', () => {
  it('removes the floor slab, the wall, clutter and floaters of an area-mode scan', () => {
    const s = suggestCrop(new Float32Array(areaScan()))!;
    expect(s.floor).not.toBeNull();
    expect(s.floor!).toBeGreaterThan(0);
    expect(s.floor!).toBeLessThan(0.02);
    expect(s.min[1]).toBeCloseTo(s.floor!, 5);
    expect(s.min[0]).toBeGreaterThan(BIKE.min[0] - 0.06);
    expect(s.min[0]).toBeLessThan(BIKE.min[0]);
    expect(s.max[0]).toBeLessThan(BIKE.max[0] + 0.06); // crate at x ≥ 0.95 excluded
    expect(s.max[0]).toBeGreaterThan(BIKE.max[0]);
    expect(s.min[2]).toBeGreaterThan(-0.3); // wall at z = -0.9 excluded
    expect(s.max[2]).toBeLessThan(0.3);
    expect(s.max[1]).toBeGreaterThan(BIKE.max[1]);
    expect(s.max[1]).toBeLessThan(BIKE.max[1] + 0.06);
  });

  it('hugs a clean object-mode capture without inventing a floor', () => {
    const s = suggestCrop(new Float32Array(syntheticBike()))!;
    expect(s.floor).toBeNull();
    expect(s.kept).toBe(1);
    s.min.forEach((v, k) => expect(v).toBeLessThanOrEqual(BIKE.min[k]));
    s.max.forEach((v, k) => expect(v).toBeGreaterThanOrEqual(BIKE.max[k] - 0.01));
    s.max.forEach((v, k) => expect(v - s.min[k]).toBeLessThan(BIKE.max[k] - BIKE.min[k] + 0.1));
  });

  it('uses the given up axis, including a negative one', () => {
    // Rotate the scan -90° about X: world up (+Y) becomes -Z in model-root space.
    const scan = areaScan();
    const rotated = new Float32Array(scan.length);
    for (let i = 0; i < scan.length; i += 3) {
      rotated[i] = scan[i];
      rotated[i + 1] = scan[i + 2];
      rotated[i + 2] = -scan[i + 1];
    }
    const s = suggestCrop(rotated, { up: [0.05, 0.1, -0.99] })!;
    const upright = suggestCrop(new Float32Array(scan))!;
    expect(s.floor).toBeCloseTo(-upright.floor!, 5);
    expect(s.max[2]).toBeCloseTo(-upright.min[1], 5);
    expect(s.min[2]).toBeCloseTo(-upright.max[1], 5);
    expect(s.min[1]).toBeCloseTo(upright.min[2], 5);
    expect(s.max[0]).toBeCloseTo(upright.max[0], 5);
  });

  it('handles 1M vertices quickly and rejects degenerate input', () => {
    const scan = areaScan();
    const big = new Float32Array(3_000_000);
    for (let i = 0; i < big.length; i++) big[i] = scan[i % scan.length];
    const t0 = performance.now();
    expect(suggestCrop(big)).not.toBeNull();
    const ms = performance.now() - t0;
    console.info(`suggestCrop(1M vertices): ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(250);
    expect(suggestCrop(new Float32Array(9))).toBeNull();
    expect(suggestCrop(new Float32Array(300).fill(2))).toBeNull();
  });
});

describe('box helpers', () => {
  const box = { min: [0, 0, 0] as [number, number, number], max: [1, 2, 3] as [number, number, number] };
  it('tests containment inclusively', () => {
    expect(insideBox(box, 0, 2, 1.5)).toBe(true);
    expect(insideBox(box, -0.01, 1, 1)).toBe(false);
    expect(insideBox(box, 0.5, 1, 3.01)).toBe(false);
  });
  it('moves one face without crossing the opposite one', () => {
    expect(moveFace(box, 1, 'max', 1.5)).toEqual({ min: [0, 0, 0], max: [1, 1.5, 3] });
    expect(moveFace(box, 0, 'min', 5, 0.01).min[0]).toBeCloseTo(0.99, 9);
    expect(moveFace(box, 2, 'max', -4, 0.01).max[2]).toBeCloseTo(0.01, 9);
    expect(box.max).toEqual([1, 2, 3]); // not mutated
  });
  it('pads a box by a fraction of its largest side', () => {
    expect(padBox(box, 0.1)).toEqual({ min: [-0.3, -0.3, -0.3], max: [1.3, 2.3, 3.3] });
  });
});
