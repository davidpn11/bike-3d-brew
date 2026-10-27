import { describe, expect, it } from 'vitest';
import { easeInOutCubic, fitDistance, lerpView, normalize, viewForBox, viewForPoint } from '../src/scene/camera';
import type { CameraView, Vec3 } from '../src/scene/schema';

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('camera math', () => {
  it('fits farther on narrow (portrait) viewports', () => {
    expect(fitDistance(1, 35, 0.5)).toBeGreaterThan(fitDistance(1, 35, 1.5));
  });

  it('views a box from the requested side, centered on it', () => {
    const v = viewForBox([-1, 0, -1], [1, 2, 1], [0, 0, 1], 35, 1);
    expect(v.target).toEqual([0, 1, 0]);
    expect(v.position[2]).toBeGreaterThan(1);
    expect(v.position[0]).toBeCloseTo(0);
  });

  it('lerpView hits both endpoints and keeps a sane radius mid-flight', () => {
    const a: CameraView = { position: [2, 0, 0], target: [0, 0, 0] };
    const b: CameraView = { position: [-2, 0, 0], target: [0, 0, 0] };
    expect(lerpView(a, b, 0).position[0]).toBeCloseTo(2);
    expect(lerpView(a, b, 1).position[0]).toBeCloseTo(-2);
    // Opposite sides: must not pass through the model at the center.
    const mid = lerpView(a, b, 0.5);
    expect(dist(mid.position, mid.target)).toBeCloseTo(2);
  });

  it('close-up views back off along the surface normal', () => {
    const v = viewForPoint([0, 0, 0], [0, 0, 1], [5, 5, 5], 0.5);
    expect(dist(v.position, v.target)).toBeCloseTo(0.5);
    expect(v.position[2]).toBeGreaterThan(0.4);
  });

  it('easing is monotonic with fixed endpoints', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.25)).toBeLessThan(easeInOutCubic(0.75));
  });

  it('normalize returns unit vectors and a safe default for zero', () => {
    normalize([3, 0, 4]).forEach((n, i) => expect(n).toBeCloseTo([0.6, 0, 0.8][i]));
    expect(normalize([0, 0, 0])).toEqual([0, 0, 1]);
  });

  it('fitDistance grows with radius and padding, and uses the vertical FOV on wide screens', () => {
    expect(fitDistance(2, 35, 1.5)).toBeCloseTo(2 * fitDistance(1, 35, 1.5));
    expect(fitDistance(1, 35, 1.5, 2)).toBeGreaterThan(fitDistance(1, 35, 1.5));
    // Wide viewports: horizontal FOV is wider, so aspect stops mattering.
    expect(fitDistance(1, 35, 2)).toBeCloseTo(fitDistance(1, 35, 3));
  });

  it('viewForBox survives degenerate boxes', () => {
    const v = viewForBox([1, 1, 1], [1, 1, 1], [1, 0, 0], 35, 1);
    expect(v.target).toEqual([1, 1, 1]);
    expect(v.position[0]).toBeGreaterThan(1);
  });

  it('close-up without a normal backs off toward the current camera', () => {
    const v = viewForPoint([0, 0, 0], undefined, [-4, 0, 0], 1);
    expect(dist(v.position, v.target)).toBeCloseTo(1);
    expect(v.position[0]).toBeLessThan(-0.9);
    expect(v.position[1]).toBeGreaterThan(0); // lifted a little
  });

  it('lerpView keeps the direction when only the radius or target changes', () => {
    const a: CameraView = { position: [0, 0, 2], target: [0, 0, 0] };
    const b: CameraView = { position: [1, 0, 5], target: [1, 0, 1] };
    const mid = lerpView(a, b, 0.5);
    expect(mid.target).toEqual([0.5, 0, 0.5]);
    expect(dist(mid.position, mid.target)).toBeCloseTo(3);
    expect(mid.position[0]).toBeCloseTo(0.5);
  });

  it('lerpView goes over the top for opposite views, on both halves of the flight', () => {
    const a: CameraView = { position: [0, 0, 2], target: [0, 0, 0] };
    const b: CameraView = { position: [0, 0, -2], target: [0, 0, 0] };
    for (const t of [0.25, 0.5, 0.75]) {
      const v = lerpView(a, b, t);
      expect(v.position[1]).toBeGreaterThan(0);
      expect(dist(v.position, v.target)).toBeCloseTo(2);
    }
    expect(lerpView(a, b, 1).position[2]).toBeCloseTo(-2);
  });

  it('lerpView slerps a quarter turn at constant radius', () => {
    const a: CameraView = { position: [1, 0, 0], target: [0, 0, 0] };
    const b: CameraView = { position: [0, 0, 1], target: [0, 0, 0] };
    const mid = lerpView(a, b, 0.5);
    expect(mid.position[0]).toBeCloseTo(Math.SQRT1_2);
    expect(mid.position[2]).toBeCloseTo(Math.SQRT1_2);
  });

  it('easing is symmetric around the midpoint', () => {
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
    expect(easeInOutCubic(0.2) + easeInOutCubic(0.8)).toBeCloseTo(1);
  });
});
