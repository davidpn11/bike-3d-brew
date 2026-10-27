import type { CaptureBundle } from './capture';
import type { BikeScene, Hotspot, ModelRef, Vec3 } from './schema';

// Small pure helpers used by the UI, kept here (DOM- and three.js-free) so they are unit-tested.

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** The area whose camera target is closest to a point: a good default for new comments. */
export function nearestHotspot(hotspots: Hotspot[], p: Vec3): Hotspot | undefined {
  let best: Hotspot | undefined;
  let bestD = Infinity;
  for (const hs of hotspots) {
    const d = distance(hs.view.target, p);
    if (d < bestD) {
      bestD = d;
      best = hs;
    }
  }
  return best;
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bike';
}

/** Wraps a present-mode step index so ‹ on the first step goes to the last and › on the last to the first. */
export function wrapStep(step: number, count: number): number {
  if (count <= 0) return 0;
  return ((step % count) + count) % count;
}

/** Decodes a base64 `data:` URL (e.g. canvas.toDataURL) into bytes. */
export function dataUrlToBytes(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const comma = dataUrl.indexOf(',');
  const head = comma >= 0 ? dataUrl.slice(0, comma) : '';
  const mime = /^data:([^;,]+)/.exec(head)?.[1] ?? 'image/png';
  const bin = atob(comma >= 0 ? dataUrl.slice(comma + 1) : '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime, bytes };
}

/**
 * Where to fetch a scene's model from, or null when it cannot be fetched and must be dropped
 * again. `dropped` maps scene model URLs to object URLs of files dropped in this tab.
 */
export function resolveModelUrl(ref: ModelRef, dropped: ReadonlyMap<string, string>, baseUrl: string, pageUrl: string): string | null {
  if (ref.format === 'demo') return ref.url;
  const file = dropped.get(ref.url);
  if (file) return file;
  if (/^(blob:|data:|bundle:)/.test(ref.url)) return null;
  // Bare filenames without a known base (a scene saved from a dropped file) cannot be fetched.
  if (!ref.url.includes('/') && !/^https?:/.test(ref.url) && baseUrl === pageUrl) return null;
  return new URL(ref.url, baseUrl).href;
}

/** The toast shown after a capture bundle opened: what was found, plus any non-fatal warnings. */
export function captureSummary(sceneName: string, bundle: Pick<CaptureBundle, 'manifest' | 'poses' | 'images' | 'warnings'>): { message: string; tone: 'info' | 'error'; ms: number } {
  const { manifest, poses, images, warnings } = bundle;
  const facts = [`${images.length || manifest.imageCount || 0} photos`, poses ? `${poses.samples.length} camera poses` : 'no camera poses', manifest.mode === 'area' ? 'area mode' : null];
  const message = [`Opened capture “${sceneName}” · ${facts.filter(Boolean).join(' · ')}`, ...warnings].join('. ');
  return warnings.length ? { message, tone: 'error', ms: 8000 } : { message, tone: 'info', ms: 4500 };
}

/** The subtitle of present mode's first (whole bike) step. */
export function presentLede(scene: Pick<BikeScene, 'brand' | 'modelName' | 'year'>): string {
  return [scene.brand, scene.modelName, scene.year].filter(Boolean).join(' · ') || 'Swipe through the highlights →';
}
