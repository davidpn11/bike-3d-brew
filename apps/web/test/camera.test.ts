import { describe, expect, it } from 'vitest';
import { easeInOutCubic, fitDistance, lerpView, viewForBox, viewForPoint } from '../src/scene/camera';
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
});
