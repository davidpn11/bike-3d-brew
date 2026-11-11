// Types for render-photos.mjs so the E2E global setup can import it.
export function renderPhotos(poses: { file: string; transform: number[] }[], opts?: { executablePath?: string }): Promise<{ file: string; data: Uint8Array }[]>;
