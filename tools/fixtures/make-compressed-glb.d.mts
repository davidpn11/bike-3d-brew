// Types for make-compressed-glb.mjs so TypeScript tests can import it.
export function makeKtx2(): Uint8Array;
export function buildCompressedGlbs(glb: Uint8Array): Promise<Record<'bike-meshopt.glb' | 'bike-draco.glb' | 'bike-ktx2.glb', Uint8Array>>;
export function writeCompressedGlbs(bikeGlbPath: string, dir: string): Promise<string[]>;
