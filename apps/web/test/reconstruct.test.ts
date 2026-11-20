import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { bikeCenter, capturePoses } from '../../../tools/fixtures/make-capture.mjs';
import { colmapToPoses, parseCameras, parseImages, parsePoints3D, quatToMat3, readColmapDir } from '../../../tools/reconstruct/colmap.mjs';
import { packageCapture } from '../../../tools/reconstruct/package.mjs';
import { readCaptureBundle } from '../src/scene/capture';
import { imageForSample, rankPhotos } from '../src/scene/photos';

// tools/reconstruct: COLMAP → bike-poses/1 and the bike-capture/1 packager. The COLMAP text is
// synthesized from the fixture's ground-truth cameras using COLMAP's own definitions
// (x_cam = R·X + t, OpenCV axes, Hamilton QW QX QY QZ), so the converter must invert it exactly.

const CLI = fileURLToPath(new URL('../../../tools/reconstruct/cli.mjs', import.meta.url));
const CAM = { width: 1920, height: 1440, f: 1500, cx: 960, cy: 720 };

type Mat3 = number[][];

/** Shepperd's method: rotation matrix (row-major) → unit quaternion (w, x, y, z). */
function mat3ToQuat(R: Mat3): number[] {
  const tr = R[0][0] + R[1][1] + R[2][2];
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    return [s / 4, (R[2][1] - R[1][2]) / s, (R[0][2] - R[2][0]) / s, (R[1][0] - R[0][1]) / s];
  }
  if (R[0][0] > R[1][1] && R[0][0] > R[2][2]) {
    const s = Math.sqrt(1 + R[0][0] - R[1][1] - R[2][2]) * 2;
    return [(R[2][1] - R[1][2]) / s, s / 4, (R[0][1] + R[1][0]) / s, (R[0][2] + R[2][0]) / s];
  }
  if (R[1][1] > R[2][2]) {
    const s = Math.sqrt(1 + R[1][1] - R[0][0] - R[2][2]) * 2;
    return [(R[0][2] - R[2][0]) / s, (R[0][1] + R[1][0]) / s, s / 4, (R[1][2] + R[2][1]) / s];
  }
  const s = Math.sqrt(1 + R[2][2] - R[0][0] - R[1][1]) * 2;
  return [(R[1][0] - R[0][1]) / s, (R[0][2] + R[2][0]) / s, (R[1][2] + R[2][1]) / s, s / 4];
}

/** Ground-truth camera→model (-Z forward, +Y up) → COLMAP world→camera (OpenCV axes). */
function toColmap(T: number[]) {
  const x = T.slice(0, 3);
  const y = T.slice(4, 7);
  const z = T.slice(8, 11);
  const C = T.slice(12, 15);
  // OpenCV camera axes in world: x, -y (down), -z (forward). R_w2c's rows are those axes.
  const R = [x, y.map((v) => -v), z.map((v) => -v)];
  const t = R.map((row) => -(row[0] * C[0] + row[1] * C[1] + row[2] * C[2]));
  return { R, t };
}

const project = (R: Mat3, t: number[], X: number[]) => {
  const p = R.map((row, i) => row[0] * X[0] + row[1] * X[1] + row[2] * X[2] + t[i]);
  return { z: p[2], u: (CAM.f * p[0]) / p[2] + CAM.cx, v: (CAM.f * p[1]) / p[2] + CAM.cy };
};

const truth = capturePoses(24, true).map((s, i) => ({ ...s, file: `frames/frame_${String(i + 1).padStart(5, '0')}.jpg` }));
const center = bikeCenter();

/** COLMAP TXT model like `colmap model_converter --output_type TXT` writes it. */
function colmapText() {
  const cameras = `# Camera list with one line of data per camera:\n#   CAMERA_ID, MODEL, WIDTH, HEIGHT, PARAMS[]\n# Number of cameras: 1\n1 SIMPLE_RADIAL ${CAM.width} ${CAM.height} ${CAM.f} ${CAM.cx} ${CAM.cy} 0.012\n`;
  const lines = ['# Image list with two lines of data per image:', '#   IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME', '#   POINTS2D[] as (X, Y, POINT3D_ID)', `# Number of images: ${truth.length}`];
  // COLMAP's image ids follow registration order, not names: write them shuffled.
  const order = truth.map((_, i) => (i * 7) % truth.length);
  for (const i of order) {
    const { R, t } = toColmap(truth[i].transform);
    let q = mat3ToQuat(R);
    if (i % 3 === 0) q = q.map((v) => -v); // q and -q are the same rotation
    const { u, v } = project(R, t, center);
    lines.push(`${i + 10} ${[...q, ...t].join(' ')} 1 ${truth[i].file}`);
    lines.push(i % 2 ? `${u} ${v} 1 12.5 30.25 -1` : ''); // registered images may have no observations
  }
  const points3D = `# 3D point list with one line of data per point:\n#   POINT3D_ID, X, Y, Z, R, G, B, ERROR, TRACK[] as (IMAGE_ID, POINT2D_IDX)\n1 ${center.join(' ')} 200 40 30 0.42 10 0 11 0\n`;
  return { cameras, images: `${lines.join('\n')}\n`, points3D };
}

describe('COLMAP → bike-poses/1', () => {
  it('quaternions are Hamilton (w, x, y, z): 90° about +Z maps +X to +Y', () => {
    const R = quatToMat3([Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
    expect(R.flat().map((v) => Math.round(v * 1e9) / 1e9 + 0)).toEqual([0, -1, 0, 1, 0, 0, 0, 0, 1]);
  });

  it('an identity COLMAP camera at the origin looks down world +Z with image-down = world -Y', () => {
    const poses = colmapToPoses(parseCameras('1 PINHOLE 4 3 2 2 2 1.5'), parseImages('1 1 0 0 0 0 0 0 1 a.jpg\n\n'));
    expect(poses.samples[0].transform.map((v) => v + 0)).toEqual([1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1]);
    expect(poses.samples[0].camera).toEqual({ model: 'PINHOLE', width: 4, height: 3, fx: 2, fy: 2, cx: 2, cy: 1.5 });
  });

  it('round-trips the ground-truth cameras of the fixture capture', () => {
    const { cameras, images } = colmapText();
    const poses = colmapToPoses(parseCameras(cameras), parseImages(images));
    expect(poses.schema).toBe('bike-poses/1');
    expect(poses.samples.map((s) => s.file)).toEqual(truth.map((s) => s.file.slice('frames/'.length)));
    poses.samples.forEach((s, i) => {
      expect(s.sample).toBe(i);
      s.transform.forEach((v, k) => expect(v).toBeCloseTo(truth[i].transform[k], 5));
      expect(s.camera).toMatchObject({ model: 'SIMPLE_RADIAL', fx: CAM.f, fy: CAM.f, cx: CAM.cx, cy: CAM.cy });
    });
  });

  it('a point projects to the same pixel in COLMAP and in the converted three.js camera', () => {
    const { cameras, images } = colmapText();
    const parsed = parseImages(images);
    const poses = colmapToPoses(parseCameras(cameras), parsed);
    const X = [center[0] + 0.3, center[1] + 0.2, center[2] - 0.1];
    for (const img of parsed) {
      const R = quatToMat3(img.q);
      const cv = project(R, img.t, X);
      expect(cv.z).toBeGreaterThan(0); // in front of the OpenCV camera
      const sample = poses.samples.find((s) => `frames/${s.file}` === img.name)!;
      const local = new Vector3(...X).applyMatrix4(new Matrix4().fromArray(sample.transform).invert());
      expect(local.z).toBeLessThan(0); // in front of the -Z camera
      expect(CAM.cx + (CAM.f * local.x) / -local.z).toBeCloseTo(cv.u, 6);
      expect(CAM.cy - (CAM.f * local.y) / -local.z).toBeCloseTo(cv.v, 6); // image v grows down, camera +Y is up
      if (sample.sample >= 24) continue;
      // The orbit cameras look at the bike center: it lands on the principal point.
      const c = project(R, img.t, center);
      expect(c.u).toBeCloseTo(CAM.cx, 2);
      expect(c.v).toBeCloseTo(CAM.cy, 2);
    }
  });

  it('parses points3D.txt', () => {
    expect(parsePoints3D(colmapText().points3D)).toEqual([{ id: 1, xyz: center, rgb: [200, 40, 30], error: 0.42 }]);
  });

  it('rejects malformed files with the line number', () => {
    expect(() => parseCameras('# c\n1 PINHOLE 4 3 x 2 2 2')).toThrow('cameras.txt:2: expected numbers');
    expect(() => parseCameras('1 PINHOLE 4 3 2 2')).toThrow('expected CAMERA_ID MODEL');
    expect(() => parseCameras('1 OPENCV 4 3 2 2 2')).toThrow('too few parameters for OPENCV');
    expect(() => parseImages('1 1 0 0 0 0 0 0 1')).toThrow('images.txt:1: expected IMAGE_ID');
    expect(() => parseImages('1 0 0 0 0 0 0 0 1 a.jpg\n')).toThrow('zero quaternion');
    expect(() => parsePoints3D('1 0 0 0 1 2')).toThrow('points3D.txt:1');
    expect(() => colmapToPoses(new Map(), parseImages('1 1 0 0 0 0 0 0 7 a.jpg\n'))).toThrow('unknown camera 7');
  });

  it('keeps image names with spaces and normalizes quaternions', () => {
    const [img] = parseImages('3 2 0 0 0 1 2 3 1 my bike 01.jpg\n1 2 -1\n');
    expect(img).toEqual({ id: 3, q: [1, 0, 0, 0], t: [1, 2, 3], cameraId: 1, name: 'my bike 01.jpg' });
  });
});

const jpeg = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, n, 0xff, 0xd9]);
const glb = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]); // the bundle reader hands the model over unparsed

function packaged(overrides: Partial<Parameters<typeof packageCapture>[0]> = {}) {
  const { cameras, images } = colmapText();
  const poses = colmapToPoses(parseCameras(cameras), parseImages(images));
  return packageCapture({
    name: 'Fixture Road Bike',
    source: 'video',
    backend: 'colmap',
    model: { name: 'scene_dense_mesh.glb', data: glb },
    poses,
    images: poses.samples.map((s, i) => ({ name: s.file, data: jpeg(i) })),
    createdAt: '2026-11-11T10:00:00Z',
    ...overrides,
  });
}

describe('package → bike-capture/1', () => {
  it('opens through the viewer’s own bundle reader, poses and photos matched', async () => {
    const b = await readCaptureBundle(packaged());
    expect(b.warnings).toEqual([]);
    expect(b.manifest).toMatchObject({ schema: 'bike-capture/1', name: 'Fixture Road Bike', mode: 'object', model: 'model.glb', poses: 'poses.json', imageCount: truth.length, source: 'video', backend: 'colmap' });
    expect(b.model).toMatchObject({ path: 'model.glb', format: 'glb' });
    expect([...b.model.data]).toEqual([...glb]);
    expect(b.images).toHaveLength(truth.length);
    expect(b.images.every((p) => /^images\/frame_\d{5}\.jpg$/.test(p))).toBe(true);
    b.poses!.samples.forEach((s, i) => {
      expect(imageForSample(s, b.images)).toBe(`images/${s.file}`);
      s.transform.forEach((v, k) => expect(v).toBeCloseTo(truth[i].transform[k], 5));
    });
    // Close-ups work on the result: every orbit camera looks at the bike center.
    expect(rankPhotos(b.poses!.samples, b.images, { point: center }, { limit: 100 }).length).toBeGreaterThanOrEqual(24);
  });

  it('packages a model without poses', async () => {
    const b = await readCaptureBundle(packaged({ poses: null, model: { name: 'mesh.PLY', data: glb } }));
    expect(b.manifest).toMatchObject({ poses: null, model: 'model.ply', source: 'video' });
    expect(b.poses).toBeNull();
  });

  it('refuses inputs the viewer could not use', () => {
    expect(() => packaged({ source: 'drone' })).toThrow('source must be one of photos, video');
    expect(() => packaged({ backend: '' })).toThrow('backend is required');
    expect(() => packaged({ model: { name: 'mesh.obj', data: glb } })).toThrow('model must be .glb / .usdz / .ply');
    expect(() => packaged({ images: [{ name: 'a.png', data: jpeg(0) }] })).toThrow('images must be JPEG basenames');
    expect(() => packaged({ images: [{ name: 'a.jpg', data: jpeg(0) }, { name: 'a.jpg', data: jpeg(1) }] })).toThrow('duplicate image names');
    expect(() => packaged({ images: [{ name: 'frame_00001.jpg', data: jpeg(0) }] })).toThrow('names frame_00002.jpg, which is not among the images');
  });
});

describe('tools/reconstruct/cli.mjs', () => {
  it('poses + package from a COLMAP TXT folder, opened by the viewer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reconstruct-'));
    const { cameras, images, points3D } = colmapText();
    mkdirSync(join(dir, 'sparse'));
    mkdirSync(join(dir, 'frames'));
    writeFileSync(join(dir, 'sparse/cameras.txt'), cameras);
    writeFileSync(join(dir, 'sparse/images.txt'), images);
    writeFileSync(join(dir, 'sparse/points3D.txt'), points3D);
    truth.forEach((s, i) => writeFileSync(join(dir, s.file), jpeg(i)));
    writeFileSync(join(dir, 'frames/notes.txt'), 'not a frame');
    mkdirSync(join(dir, 'Gravel Bike'));
    writeFileSync(join(dir, 'Gravel Bike/model.glb'), glb);

    const node = (...args: string[]) => execFileSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
    expect(node('--help')).toContain('Usage: node tools/reconstruct/cli.mjs');
    expect(JSON.parse(node('poses', '--colmap', 'sparse')).samples).toHaveLength(truth.length);
    node('poses', '--colmap', 'sparse', '-o', 'poses.json');
    node('package', '--model', 'Gravel Bike/model.glb', '--images', 'frames', '--poses', 'poses.json', '--source', 'photos', '--backend', 'colmap');
    const b = await readCaptureBundle(readFileSync(join(dir, 'Gravel-Bike.bikecapture.zip')));
    expect(b.manifest).toMatchObject({ name: 'Gravel Bike', source: 'photos', backend: 'colmap' });
    expect(b.poses!.samples).toHaveLength(truth.length);
    expect(b.images).toHaveLength(truth.length);
    node('package', '--model', 'Gravel Bike/model.glb', '--images', 'frames', '--colmap', 'sparse', '--source', 'video', '--backend', 'colmap', '--name', 'Orbit', '-o', 'out/orbit.zip');
    expect((await readCaptureBundle(readFileSync(join(dir, 'out/orbit.zip')))).poses!.samples).toHaveLength(truth.length);

    // No points3D.txt is fine; a missing flag is a clear error and a non-zero exit.
    rmSync(join(dir, 'sparse/points3D.txt'));
    expect(readColmapDir(join(dir, 'sparse')).points).toEqual([]);
    const bad = spawnSync(process.execPath, [CLI, 'package', '--model', 'x.glb'], { cwd: dir, encoding: 'utf8' });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('missing --images, --source, --backend');
  });
});
