// Types for the fixture generator so tests can import it.
export const MODEL_ORIGIN: [number, number, number];
export function bikeCenter(): [number, number, number];
export function lookAtTransform(eye: number[], target: number[], up?: number[]): number[];
export function orbitPoses(count?: number): { sample: number; file: string; transform: number[] }[];
export function capturePoses(orbit?: number, closeups?: boolean): { sample: number; file: string; transform: number[] }[];
export function makeUsdz(): Uint8Array;
export function png(width: number, height: number, pixel: (x: number, y: number) => number[]): Uint8Array;
export function makeBundle(opts?: { name?: string; count?: number; closeups?: boolean; images?: { ext: string; data: Uint8Array }[] | null; folder?: string }): Uint8Array;
