// Types for make-capture-bundle.mjs so TypeScript tests can import it.
import type { Group } from 'three';

export const FIXTURE_NAME: string;
export const FIXTURE_CREATED_AT: string;
export const POSE_COUNT: number;
export const DEFAULT_OUT_DIR: string;

export function createFixtureBike(): Group;
export function bikeToUsda(root: Group): string;
export function bikeToUsdz(root: Group): Uint8Array;
export function bikeToGlb(root: Group): Promise<Uint8Array>;
export function orbitPoses(target?: [number, number, number]): { schema: 'bike-poses/1'; samples: { sample: number; file: string; transform: number[] }[] };
export function placeholderPng(rgb: [number, number, number], size?: number): Uint8Array;
export function zipBundle(files: Record<string, unknown>, prefix?: string): Uint8Array;
export function buildFixtures(): Promise<Record<string, Uint8Array>>;
export function writeFixtures(outDir: string): Promise<string[]>;
