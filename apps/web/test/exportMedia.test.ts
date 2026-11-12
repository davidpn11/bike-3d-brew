import { describe, expect, it } from 'vitest';
import {
  MAX_CANVAS_PIXELS,
  exportBackdrop,
  snapshotFileName,
  snapshotSize,
  turntableAngle,
  turntableFileName,
  videoExtension,
  videoMimeType,
  videoSize,
} from '../src/scene/exportMedia';

describe('snapshotSize', () => {
  it('multiplies the stage size', () => {
    expect(snapshotSize(800, 600, 2, 16384)).toEqual({ width: 1600, height: 1200 });
  });

  it('shrinks to the GPU limit keeping the aspect', () => {
    expect(snapshotSize(1000, 500, 4, 2048)).toEqual({ width: 2048, height: 1024 });
  });

  it('stays under the canvas pixel cap', () => {
    const s = snapshotSize(1920, 1080, 4, 16384);
    expect(s.width * s.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    expect(s.width / s.height).toBeCloseTo(1920 / 1080, 2);
  });

  it('never returns an empty image', () => {
    expect(snapshotSize(1, 1, 0.1, 16384)).toEqual({ width: 1, height: 1 });
  });
});

describe('videoSize', () => {
  it('is even and at most 1080p-ish', () => {
    expect(videoSize(801, 601, 1)).toEqual({ width: 800, height: 600 });
    expect(videoSize(1440, 900, 2)).toEqual({ width: 1920, height: 1200 });
    expect(videoSize(1, 1, 1)).toEqual({ width: 2, height: 2 });
  });
});

describe('exportBackdrop', () => {
  it('uses the stage backdrop for "as shown"', () => {
    expect(exportBackdrop('scene', 'dark')).toBe('dark');
    expect(exportBackdrop('green', 'dark')).toBe('green');
    expect(exportBackdrop('transparent', 'studio')).toBe('transparent');
  });

  it('records transparent videos on the studio backdrop', () => {
    expect(exportBackdrop('transparent', 'dark', true)).toBe('studio');
    expect(exportBackdrop('scene', 'transparent', true)).toBe('studio');
    expect(exportBackdrop('green', 'transparent', true)).toBe('green');
  });
});

describe('videoMimeType', () => {
  it('prefers WebM VP9, falls back to MP4 (Safari), null without support', () => {
    expect(videoMimeType(() => true)).toBe('video/webm;codecs=vp9');
    expect(videoMimeType((t) => t.startsWith('video/mp4'))).toBe('video/mp4;codecs=avc1');
    expect(videoMimeType(() => false)).toBeNull();
    expect(videoMimeType(null)).toBeNull();
  });

  it('maps to a file extension', () => {
    expect(videoExtension('video/webm;codecs=vp8')).toBe('webm');
    expect(videoExtension('video/mp4')).toBe('mp4');
  });
});

describe('turntableAngle', () => {
  it('turns once over the duration and clamps', () => {
    expect(turntableAngle(0, 8000)).toBe(0);
    expect(turntableAngle(4000, 8000)).toBeCloseTo(Math.PI);
    expect(turntableAngle(9000, 8000)).toBeCloseTo(2 * Math.PI);
    expect(turntableAngle(-5, 8000)).toBe(0);
  });
});

describe('file names', () => {
  it('names snapshots and videos after the scene', () => {
    expect(snapshotFileName('Demo road bike', 'green', { width: 1600, height: 1200 })).toBe('demo-road-bike-green-1600x1200.png');
    expect(turntableFileName('Demo road bike', 'video/webm;codecs=vp9')).toBe('demo-road-bike-turntable.webm');
    expect(turntableFileName('', 'video/mp4')).toBe('bike-turntable.mp4');
  });
});
