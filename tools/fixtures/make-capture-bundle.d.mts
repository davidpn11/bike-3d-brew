// Types for make-capture-bundle.mjs so TypeScript tests can import it.
import type { Group } from 'three';

type Vec3 = [number, number, number];
type PoseSample = { sample: number; file: string; transform: number[] };
type Poses = { schema: 'bike-poses/1'; samples: PoseSample[] };

export const FIXTURE_NAME: string;
export const FIXTURE_CREATED_AT: string;
export const POSE_COUNT: number;
export const POSE_TARGET: Vec3;
export const MODEL_ORIGIN: Vec3;
export const PHOTO_NAME: string;
export const CLOSEUP_COUNT: number;
export const DEFAULT_OUT_DIR: string;

export function createFixtureBike(origin?: Vec3): Group;
export function bikeToUsda(root: Group): string;
export function bikeToUsdz(root: Group): Uint8Array;
export function bikeToGlb(root: Group): Promise<Uint8Array>;
export function lookAtTransform(eye: number[], target: number[], up?: number[]): number[];
export function orbitPoses(origin?: Vec3): Poses;
export function capturePoses(origin?: Vec3): Poses;
export function placeholderPng(rgb: [number, number, number], size?: number): Uint8Array;
export function zipBundle(files: Record<string, unknown>, prefix?: string): Uint8Array;
export function buildFixtures(): Promise<Record<string, Uint8Array>>;
export function buildPhotoBundle(opts?: { name?: string; images?: { ext: string; data: Uint8Array }[] | null }): Uint8Array;
export function buildSampleBundle(opts?: { name?: string; createdAt?: string }): Promise<Uint8Array>;
export function writeFixtures(outDir: string): Promise<string[]>;
