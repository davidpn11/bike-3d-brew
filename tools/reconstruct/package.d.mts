// Types for the bundle packager so tests can import it.
export const SOURCES: string[];
export interface PackageInput {
  name: string;
  source: 'photos' | 'video' | string;
  backend: string;
  model: { name: string; data: Uint8Array };
  poses?: { schema: string; samples: { sample: number; file?: string; transform: number[] }[] } | null;
  images: { name: string; data: Uint8Array }[];
  createdAt?: string;
}
export function packageCapture(opts: PackageInput): Uint8Array;
export function readImageDir(dir: string): { name: string; data: Uint8Array }[];
