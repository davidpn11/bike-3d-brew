import { describe, expect, it } from 'vitest';
import { CAPTURE_SCHEMA, type CaptureManifest } from '../src/scene/capture';
import { captureSummary, dataUrlToBytes, distance, nearestHotspot, presentLede, resolveModelUrl, slugify, wrapStep } from '../src/scene/helpers';
import type { Hotspot } from '../src/scene/schema';

const hs = (id: string, target: [number, number, number]): Hotspot => ({ id, name: id, view: { position: [0, 0, 5], target } });

describe('nearestHotspot', () => {
  it('picks the area whose target is closest', () => {
    const areas = [hs('fork', [0.5, 0.5, 0]), hs('saddle', [-0.3, 1, 0]), hs('drivetrain', [-0.1, 0.3, 0.1])];
    expect(nearestHotspot(areas, [0.45, 0.4, 0])?.id).toBe('fork');
    expect(nearestHotspot(areas, [-0.25, 0.95, 0])?.id).toBe('saddle');
    expect(nearestHotspot([], [0, 0, 0])).toBeUndefined();
  });

  it('measures euclidean distance', () => {
    expect(distance([0, 0, 0], [1, 2, 2])).toBe(3);
  });
});

describe('slugify', () => {
  it('makes file-safe names', () => {
    expect(slugify('Trek Domane SL6 (2026)')).toBe('trek-domane-sl6-2026');
    expect(slugify('  --Ünïcode--  ')).toBe('n-code');
    expect(slugify('!!!')).toBe('bike');
  });
});

describe('wrapStep', () => {
  it('wraps both ways', () => {
    expect(wrapStep(0, 4)).toBe(0);
    expect(wrapStep(4, 4)).toBe(0);
    expect(wrapStep(-1, 4)).toBe(3);
    expect(wrapStep(-9, 4)).toBe(3);
    expect(wrapStep(3, 0)).toBe(0);
  });
});

describe('dataUrlToBytes', () => {
  it('decodes base64 data URLs and their mime type', () => {
    const { mime, bytes } = dataUrlToBytes(`data:image/png;base64,${btoa('\x89PNG')}`);
    expect(mime).toBe('image/png');
    expect([...bytes]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('defaults to PNG for odd input', () => {
    expect(dataUrlToBytes('data:;base64,').mime).toBe('image/png');
    expect(dataUrlToBytes('').bytes).toHaveLength(0);
  });
});

describe('resolveModelUrl', () => {
  const page = 'https://shop.example/viewer/';
  const none = new Map<string, string>();

  it('passes the demo through and prefers dropped files', () => {
    expect(resolveModelUrl({ url: 'demo:road', format: 'demo' }, none, page, page)).toBe('demo:road');
    expect(resolveModelUrl({ url: 'bike.glb', format: 'glb' }, new Map([['bike.glb', 'blob:x']]), page, page)).toBe('blob:x');
  });

  it('refuses URLs that only lived in another tab', () => {
    for (const url of ['blob:https://x/1', 'data:model/gltf-binary;base64,AA', 'bundle:a.bikecapture.zip/model.usdz']) {
      expect(resolveModelUrl({ url, format: 'glb' }, none, page, page)).toBeNull();
    }
    // A bare filename from a dropped file has nothing to resolve against.
    expect(resolveModelUrl({ url: 'bike.glb', format: 'glb' }, none, page, page)).toBeNull();
  });

  it('resolves relative URLs against the scene file', () => {
    const scene = 'https://shop.example/scenes/r1/bike.json';
    expect(resolveModelUrl({ url: 'bike.glb', format: 'glb' }, none, scene, page)).toBe('https://shop.example/scenes/r1/bike.glb');
    expect(resolveModelUrl({ url: 'models/bike.glb', format: 'glb' }, none, page, page)).toBe('https://shop.example/viewer/models/bike.glb');
    expect(resolveModelUrl({ url: 'https://cdn.example/b.usdz', format: 'usdz' }, none, page, page)).toBe('https://cdn.example/b.usdz');
  });
});

describe('captureSummary', () => {
  const manifest: CaptureManifest = { schema: CAPTURE_SCHEMA, name: 'R1', mode: 'object', model: 'model.usdz', poses: 'poses.json', images: 'images/', imageCount: 40 };
  const poses = { schema: 'bike-poses/1' as const, samples: [{ sample: 0, transform: [] }] };

  it('lists photos and poses', () => {
    expect(captureSummary('R1', { manifest, poses, images: ['images/a.heic', 'images/b.heic'], warnings: [] })).toEqual({
      message: 'Opened capture “R1” · 2 photos · 1 camera poses',
      tone: 'info',
      ms: 4500,
    });
  });

  it('falls back to the manifest image count, flags area mode, and surfaces warnings longer', () => {
    const s = captureSummary('R1', { manifest: { ...manifest, mode: 'area' }, poses: null, images: [], warnings: ['poses.json: broken'] });
    expect(s.message).toBe('Opened capture “R1” · 40 photos · no camera poses · area mode. poses.json: broken');
    expect(s.tone).toBe('error');
    expect(s.ms).toBe(8000);
    expect(captureSummary('R1', { manifest: { ...manifest, imageCount: undefined }, poses: null, images: [], warnings: [] }).message).toContain('0 photos');
  });
});

describe('presentLede', () => {
  it('joins known details or invites to swipe', () => {
    expect(presentLede({ brand: 'Brew', modelName: 'R1', year: 2026 })).toBe('Brew · R1 · 2026');
    expect(presentLede({ brand: 'Brew' })).toBe('Brew');
    expect(presentLede({})).toMatch(/Swipe/);
  });
});
