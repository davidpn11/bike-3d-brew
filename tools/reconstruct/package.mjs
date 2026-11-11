// Reconstruction result → `bike-capture/1` zip (the same contract as the iOS export, see
// docs/ARCHITECTURE.md), so a photo/video reconstruction opens in the viewer like a phone capture.

import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { zipSync } from 'fflate';

export const SOURCES = ['photos', 'video'];
// What the viewer can load from a bundle (apps/web/src/scene/schema.ts formatFromFilename); GLB is the default.
const MODEL_EXTS = ['.glb', '.usdz', '.ply'];
const isJpeg = (name) => /\.jpe?g$/i.test(name);

/**
 * @param {object} opts
 * @param {string} opts.name  Bike name shown in the viewer.
 * @param {'photos'|'video'} opts.source
 * @param {string} opts.backend  e.g. "colmap", "object-capture".
 * @param {{ name: string, data: Uint8Array }} opts.model  Reconstructed mesh (.glb preferred).
 * @param {{ schema: string, samples: { sample: number, file?: string, transform: number[] }[] } | null} opts.poses
 * @param {{ name: string, data: Uint8Array }[]} opts.images  JPEG frames (basenames).
 * @param {string} [opts.createdAt]
 * @returns {Uint8Array}
 */
export function packageCapture({ name, source, backend, model, poses = null, images, createdAt = new Date().toISOString() }) {
  if (!SOURCES.includes(source)) throw new Error(`source must be one of ${SOURCES.join(', ')}, got ${JSON.stringify(source)}`);
  if (!backend) throw new Error('backend is required');
  const ext = extname(model.name).toLowerCase();
  if (!MODEL_EXTS.includes(ext)) throw new Error(`model must be ${MODEL_EXTS.join(' / ')}, got ${model.name}`);
  const bad = images.find((img) => !isJpeg(img.name) || img.name.includes('/'));
  if (bad) throw new Error(`images must be JPEG basenames, got ${bad.name}`);
  const names = new Set(images.map((img) => img.name));
  if (names.size !== images.length) throw new Error('duplicate image names');
  // A pose without its photo silently drops out of the close-ups; fail here instead.
  const missing = poses?.samples.find((s) => s.file && !names.has(s.file));
  if (missing) throw new Error(`poses.json names ${missing.file}, which is not among the images`);

  const modelPath = `model${ext}`;
  const manifest = {
    schema: 'bike-capture/1',
    name,
    createdAt,
    device: `tools/reconstruct (${backend})`,
    mode: 'object',
    model: modelPath,
    poses: poses ? 'poses.json' : null,
    images: 'images/',
    imageCount: images.length,
    source,
    backend,
  };
  const enc = (v) => new TextEncoder().encode(JSON.stringify(v, null, 2));
  const files = { 'manifest.json': enc(manifest), [modelPath]: model.data };
  if (poses) files['poses.json'] = enc(poses);
  // JPEGs are already compressed: store them so zipping 200 frames stays fast.
  for (const img of images) files[`images/${img.name}`] = [img.data, { level: 0 }];
  return zipSync(files);
}

/** The JPEG frames of a folder, sorted by name. */
export function readImageDir(dir) {
  return readdirSync(dir)
    .filter(isJpeg)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .map((name) => ({ name, data: readFileSync(join(dir, name)) }));
}
