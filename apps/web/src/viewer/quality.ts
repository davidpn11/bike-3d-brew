/** `?quality=` override; `auto` picks from the device. */
export type QualityLevel = 'auto' | 'low' | 'high';

export interface DeviceInfo {
  devicePixelRatio: number;
  /** Touch-first device (`(pointer: coarse)`). */
  coarsePointer: boolean;
  /** Shorter side of the screen in CSS pixels. */
  screenMin: number;
}

export interface QualitySettings {
  /** Cap for the renderer's pixel ratio. */
  pixelRatio: number;
  /** MSAA; decided once, at WebGL context creation. */
  antialias: boolean;
  shadowMapSize: number;
  /** PCF soft shadows (desktop) vs. plain PCF (phones). */
  softShadows: boolean;
}

/** A phone or small tablet: coarse pointer and a short side under 820 CSS px (iPad mini is 744). */
export function isHandheld(d: DeviceInfo): boolean {
  return d.coarsePointer && d.screenMin < 820;
}

/**
 * Rendering budget for a device. Retina phones render at most 2× (3× is 2.25× the pixels of 2× for
 * no visible gain on a moving bike), skip MSAA when the pixel ratio already supersamples, and use a
 * smaller, hard-edged shadow map; the shadow map is only redrawn when the model changes anyway.
 */
export function chooseQuality(d: DeviceInfo, level: QualityLevel = 'auto'): QualitySettings {
  const dpr = Math.max(1, d.devicePixelRatio || 1);
  if (level === 'low') return { pixelRatio: 1, antialias: false, shadowMapSize: 512, softShadows: false };
  if (level === 'high') return { pixelRatio: Math.min(dpr, 3), antialias: true, shadowMapSize: 2048, softShadows: true };
  const handheld = isHandheld(d);
  const pixelRatio = Math.min(dpr, 2);
  return { pixelRatio, antialias: pixelRatio < 2, shadowMapSize: handheld ? 1024 : 2048, softShadows: !handheld };
}

/**
 * Pixel ratio for a loaded model: heavy captures (fill-rate and vertex bound on a phone GPU) drop a
 * handheld to 1.5×, which still looks sharp on a 6" screen and shades ~44% fewer pixels than 2×.
 */
export function pixelRatioFor(settings: QualitySettings, d: DeviceInfo, triangles: number, level: QualityLevel = 'auto'): number {
  if (level === 'auto' && isHandheld(d) && triangles > HEAVY_TRIANGLES) return Math.min(settings.pixelRatio, 1.5);
  return settings.pixelRatio;
}

/** Above this many triangles a model counts as heavy for a phone. */
export const HEAVY_TRIANGLES = 400_000;

export function parseQualityLevel(value: string | null | undefined): QualityLevel {
  return value === 'low' || value === 'high' ? value : 'auto';
}
