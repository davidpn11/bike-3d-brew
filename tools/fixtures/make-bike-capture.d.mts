// Types for make-bike-capture.mjs so the TypeScript E2E setup can import it.
export function buildBikeCapture(opts?: {
  name?: string;
  /** Euler XYZ degrees. */
  rotate?: [number, number, number];
  /** Meters. */
  offset?: [number, number, number];
  mode?: 'object' | 'area';
  ground?: boolean;
}): Uint8Array;
