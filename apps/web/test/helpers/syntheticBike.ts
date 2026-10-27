import type { Vec3 } from '../../src/scene/schema';

/** Deterministic PRNG so failures are reproducible. */
export function rng(seed: number): () => number {
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
export function syntheticBike(rand = rng(1), scale = 1): number[] {
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

/**
 * Time budgets assume plain `npm test`; coverage instrumentation slows hot loops several-fold,
 * so `npm run test:coverage` gets a 10× budget (the numbers are still printed).
 */
export function timeBudget(ms: number): number {
  const worker = (globalThis as { __vitest_worker__?: { config?: { coverage?: { enabled?: boolean } } } }).__vitest_worker__;
  return worker?.config?.coverage?.enabled ? ms * 10 : ms;
}
