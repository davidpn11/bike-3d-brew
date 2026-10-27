import type { CameraView, Vec3 } from './schema';

// Pure camera math, kept free of three.js so it is trivially unit-testable.

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function normalize(a: Vec3): Vec3 {
  const l = len(a);
  return l === 0 ? [0, 0, 1] : scale(a, 1 / l);
}

/** Distance at which a sphere of `radius` fills the view, honoring the narrower FOV axis. */
export function fitDistance(radius: number, fovDeg: number, aspect: number, padding = 1.15): number {
  const vFov = (fovDeg * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const fov = Math.min(vFov, hFov);
  return (radius * padding) / Math.sin(fov / 2);
}

/** A view looking at an axis-aligned box from `direction` (pointing from target toward camera). */
export function viewForBox(min: Vec3, max: Vec3, direction: Vec3, fovDeg: number, aspect: number, padding = 1.15): CameraView {
  const target = scale(add(min, max), 0.5);
  const radius = Math.max(len(sub(max, min)) / 2, 1e-3);
  const dist = fitDistance(radius, fovDeg, aspect, padding);
  return { target, position: add(target, scale(normalize(direction), dist)) };
}

/** A close-up view of a surface point, backing off along its normal (or the current view axis). */
export function viewForPoint(point: Vec3, normal: Vec3 | undefined, from: Vec3, distance: number): CameraView {
  const dir = normal ? normalize(normal) : normalize(sub(from, point));
  // Lift slightly so we are not dead-on, which reads better for pins on tubes.
  const lifted = normalize(add(dir, [0, 0.25, 0]));
  return { target: point, position: add(point, scale(lifted, distance)) };
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Interpolates two views. Position orbits around the blended target at a blended radius
 * rather than cutting straight through the model, which a linear lerp would do when
 * flying from one side of the bike to the other.
 */
export function lerpView(a: CameraView, b: CameraView, t: number): CameraView {
  const target: Vec3 = [lerp(a.target[0], b.target[0], t), lerp(a.target[1], b.target[1], t), lerp(a.target[2], b.target[2], t)];
  const da = sub(a.position, a.target);
  const db = sub(b.position, b.target);
  const ra = len(da);
  const rb = len(db);
  const na = normalize(da);
  const nb = normalize(db);
  const dot = Math.min(1, Math.max(-1, na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2]));
  const omega = Math.acos(dot);
  let dir: Vec3;
  if (omega < 1e-4) {
    dir = na;
  } else if (Math.PI - omega < 1e-3) {
    // Opposite directions: slerp is undefined, go over the top.
    const up: Vec3 = [0, 1, 0];
    dir = normalize(t < 0.5 ? add(scale(na, 1 - 2 * t), scale(up, 2 * t)) : add(scale(up, 2 - 2 * t), scale(nb, 2 * t - 1)));
  } else {
    const s = Math.sin(omega);
    dir = add(scale(na, Math.sin((1 - t) * omega) / s), scale(nb, Math.sin(t * omega) / s));
  }
  return { target, position: add(target, scale(dir, lerp(ra, rb, t))) };
}
