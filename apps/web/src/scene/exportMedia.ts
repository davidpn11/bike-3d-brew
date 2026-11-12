import { slugify } from './helpers';
import type { BackgroundMode } from './schema';

// Snapshot (PNG) and turntable video decisions, DOM- and three.js-free so they are unit-tested.

/** What the export paints behind the bike: the stage's own backdrop, or a forced alpha / chroma key. */
export type ExportBackground = 'scene' | 'transparent' | 'green';
export const EXPORT_BACKGROUNDS: ExportBackground[] = ['scene', 'transparent', 'green'];
export const EXPORT_BACKGROUND_LABEL: Record<ExportBackground, string> = { scene: 'As shown', transparent: 'Transparent', green: 'Chroma green' };
/** Snapshot sizes as multiples of the stage's CSS size. */
export const SNAPSHOT_SCALES = [1, 2, 4];
export const DEFAULT_SNAPSHOT_SCALE = 2;
/** iOS Safari refuses canvases over 16.7 MP; also keeps a 4× desktop snapshot within memory. */
export const MAX_CANVAS_PIXELS = 4096 * 4096;
/** Social platforms re-encode anything bigger than 1080p anyway. */
export const MAX_VIDEO_SIDE = 1920;
export const TURNTABLE_SECONDS = 8;

/** Output size for `scale` × the stage, shrunk (keeping the aspect) to the GPU's limit and MAX_CANVAS_PIXELS. */
export function snapshotSize(width: number, height: number, scale: number, maxSide: number): { width: number; height: number } {
  const w = width * scale;
  const h = height * scale;
  const fit = Math.min(1, maxSide / Math.max(w, h), Math.sqrt(MAX_CANVAS_PIXELS / (w * h)));
  return { width: Math.max(1, Math.floor(w * fit)), height: Math.max(1, Math.floor(h * fit)) };
}

/** Video encoders (H.264 in particular) need even dimensions. */
export function videoSize(width: number, height: number, pixelRatio: number): { width: number; height: number } {
  const s = snapshotSize(width, height, pixelRatio, MAX_VIDEO_SIDE);
  return { width: Math.max(2, s.width & ~1), height: Math.max(2, s.height & ~1) };
}

/** The backdrop actually painted. Videos have no alpha channel, so a transparent one records on the studio backdrop. */
export function exportBackdrop(choice: ExportBackground, scene: BackgroundMode, video = false): BackgroundMode {
  const mode = choice === 'scene' ? scene : choice;
  return video && mode === 'transparent' ? 'studio' : mode;
}

/** The stage's CSS gradients (styles.css `.viewport[data-background]`) as canvas colour stops. */
export const BACKDROP_STOPS: Partial<Record<BackgroundMode, [number, string][]>> = {
  studio: [
    [0, '#ffffff'],
    [0.55, '#e9eaee'],
    [1, '#cfd2d8'],
  ],
  dark: [
    [0, '#2b2d33'],
    [0.75, '#131417'],
  ],
};

const VIDEO_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1', 'video/mp4'];

/** First recordable video type (WebM, else MP4 as in Safari), or null where MediaRecorder / captureStream is missing. */
export function videoMimeType(isTypeSupported: ((type: string) => boolean) | null): string | null {
  return (isTypeSupported && VIDEO_TYPES.find((t) => isTypeSupported(t))) || null;
}

export const videoExtension = (mime: string) => (mime.startsWith('video/mp4') ? 'mp4' : 'webm');

/** Camera angle (radians) around the bike `elapsed` ms into a turntable of `duration` ms: one full turn. */
export function turntableAngle(elapsed: number, duration: number): number {
  return 2 * Math.PI * Math.min(1, Math.max(0, elapsed / duration));
}

export function snapshotFileName(sceneName: string, backdrop: BackgroundMode, size: { width: number; height: number }): string {
  return `${slugify(sceneName)}-${backdrop}-${size.width}x${size.height}.png`;
}

export function turntableFileName(sceneName: string, mime: string): string {
  return `${slugify(sceneName)}-turntable.${videoExtension(mime)}`;
}
