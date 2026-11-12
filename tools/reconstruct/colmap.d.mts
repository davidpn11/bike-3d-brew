// Types for the COLMAP converter so tests can import it.
export interface ColmapCamera { id: number; model: string; width: number; height: number; params: number[]; fx: number; fy: number; cx: number; cy: number }
export interface ColmapImage { id: number; q: [number, number, number, number]; t: [number, number, number]; cameraId: number; name: string }
export interface ColmapPoint { id: number; xyz: [number, number, number]; rgb: [number, number, number]; error: number }
export interface PoseCamera { model: string; width: number; height: number; fx: number; fy: number; cx: number; cy: number }
export interface Poses { schema: 'bike-poses/1'; samples: { sample: number; file: string; transform: number[]; camera: PoseCamera }[] }
export function parseCameras(text: string): Map<number, ColmapCamera>;
export function parseImages(text: string): ColmapImage[];
export function parsePoints3D(text: string): ColmapPoint[];
export function parseCamerasBin(data: Buffer): Map<number, ColmapCamera>;
export function parseImagesBin(data: Buffer): ColmapImage[];
export function parsePoints3DBin(data: Buffer): ColmapPoint[];
export function quatToMat3(q: number[]): number[][];
export function colmapToTransform(q: number[], t: number[]): number[];
export function colmapToPoses(cameras: Map<number, ColmapCamera>, images: ColmapImage[], imageFile?: string): Poses;
export function readColmapDir(dir: string, options?: { includePoints?: boolean }): { cameras: Map<number, ColmapCamera>; images: ColmapImage[]; points: ColmapPoint[]; pointsWarning?: string; poses: Poses };
