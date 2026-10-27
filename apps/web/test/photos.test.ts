import * as THREE from 'three';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { PoseSample } from '../src/scene/capture';
import {
  IDENTITY,
  centeringMatrix,
  imageForSample,
  imageMime,
  isHeif,
  mulMat4,
  rankPhotos,
  transformDir,
  transformPoint,
} from '../src/scene/photos';
import type { Vec3 } from '../src/scene/schema';
import { readZipEntry, readZipIndex } from '../src/scene/zipIndex';
import { sourceToModelRoot } from '../src/viewer/captureSpace';
import { USDLoader } from 'three/examples/jsm/loaders/USDLoader.js';
import { centerOnGround } from '../src/viewer/loaders';
import { MODEL_ORIGIN, bikeCenter, capturePoses, lookAtTransform, makeUsdz, orbitPoses } from '../../../tools/fixtures/make-capture.mjs';

const pose = (sample: number, eye: Vec3, target: Vec3, file?: string): PoseSample => ({ sample, transform: lookAtTransform(eye, target), ...(file ? { file } : {}) });
const images = (n: number) => Array.from({ length: n }, (_, i) => `images/IMG_${String(i).padStart(4, '0')}.HEIC`);
const close = (a: number[], b: number[], eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps);

describe('matrix helpers', () => {
  it('match three.js', () => {
    const a = new THREE.Matrix4().compose(new THREE.Vector3(1, 2, 3), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.7, 0.2)), new THREE.Vector3(2, 2, 2));
    const b = new THREE.Matrix4().makeRotationY(1.1).setPosition(-0.5, 0.2, 4);
    expect(close(mulMat4(a.toArray(), b.toArray()), a.clone().multiply(b).toArray())).toBe(true);
    const p = new THREE.Vector3(0.4, -1, 2);
    expect(close(transformPoint(a.toArray(), [0.4, -1, 2]), p.clone().applyMatrix4(a).toArray())).toBe(true);
    expect(close(transformDir(a.toArray(), [0, 0, -1]), new THREE.Vector3(0, 0, -1).transformDirection(a).multiplyScalar(2).toArray())).toBe(true);
    expect(mulMat4(IDENTITY, b.toArray())).toEqual(b.toArray());
  });

  it('fixture poses look down -Z at the bike', () => {
    const [s] = orbitPoses(4);
    const eye: Vec3 = [s.transform[12], s.transform[13], s.transform[14]];
    const forward = transformDir(s.transform, [0, 0, -1]);
    const toCenter = bikeCenter().map((v, i) => v - eye[i]);
    const cos = (forward[0] * toCenter[0] + forward[1] * toCenter[1] + forward[2] * toCenter[2]) / Math.hypot(...toCenter);
    expect(cos).toBeGreaterThan(0.9999);
  });
});

describe('pose space → model-root space', () => {
  it('sourceToModelRoot is the centering shift that centerOnGround applies', () => {
    // A reconstruction that is off-center and below the floor, like Object Capture output.
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1, 0.4));
    mesh.position.set(0.3, -0.2, 0.5);
    const object = new THREE.Group().add(mesh);
    const modelRoot = new THREE.Group();
    // Scene model.rotation/scale/offset live on the root and must not leak into the mapping.
    modelRoot.scale.setScalar(1.7);
    modelRoot.rotation.set(0, 0.8, 0);
    modelRoot.position.set(1, 0, -2);
    modelRoot.add(centerOnGround(object));
    modelRoot.updateMatrixWorld(true);

    const m = sourceToModelRoot(modelRoot)!;
    expect(close(m, centeringMatrix([-0.5, -0.7, 0.3], [1.1, 0.3, 0.7]))).toBe(true);

    // A vertex in file space lands where the viewer draws it, expressed in model-root space.
    const vertex = new THREE.Vector3(0.8, 0.5, 0.2); // corner of the box in mesh-local space
    const fileSpace = vertex.clone().add(mesh.position);
    const world = vertex.clone().applyMatrix4(mesh.matrixWorld);
    const modelRootSpace = world.applyMatrix4(modelRoot.matrixWorld.clone().invert());
    expect(close(transformPoint(m, fileSpace.toArray() as Vec3), modelRootSpace.toArray(), 1e-6)).toBe(true);
    expect(sourceToModelRoot(new THREE.Group())).toBeNull();
  });
});

describe('imageForSample', () => {
  const list = ['images/IMG_0000.HEIC', 'images/IMG_0001.HEIC', 'images/IMG_0012.HEIC'];
  it('matches by file name, stem, then sample number', () => {
    expect(imageForSample({ sample: 5, file: 'IMG_0001.HEIC', transform: IDENTITY }, list)).toBe('images/IMG_0001.HEIC');
    expect(imageForSample({ sample: 5, file: 'img_0001.jpg', transform: IDENTITY }, list)).toBe('images/IMG_0001.HEIC');
    expect(imageForSample({ sample: 12, transform: IDENTITY }, list)).toBe('images/IMG_0012.HEIC');
    expect(imageForSample({ sample: 7, transform: IDENTITY }, list)).toBeNull();
  });
});

describe('rankPhotos', () => {
  const target: Vec3 = [0.5, 0.6, 0];

  it('prefers photos that look straight at the target from close by', () => {
    const samples = [
      pose(0, [0.5, 0.6, 2.5], target), // dead on, far
      pose(1, [0.5, 0.6, 0.8], target), // dead on, close
      pose(2, [0.5, 0.6, 0.8], [0.75, 0.6, 0]), // close but target off-center
      pose(3, [0.5, 0.6, -1.5], [0.5, 0.6, -3]), // looking away
      pose(4, [-1, 0.6, 1], [-1, 0.6, 0]), // target outside the frame
    ];
    const ranked = rankPhotos(samples, images(5), { point: target }, { minSeparationDeg: 0 });
    expect(ranked.map((r) => r.sample)).toEqual([1, 2, 0]);
    // By default the photo from the same spot is a duplicate; the farther one along the same ray is not.
    expect(rankPhotos(samples, images(5), { point: target }).map((r) => r.sample)).toEqual([1, 0]);
    expect(ranked[0]).toMatchObject({ path: 'images/IMG_0001.HEIC', angleDeg: 0, distance: 0.8 });
    expect(ranked[1].angleDeg).toBeGreaterThan(10);
  });

  it('drops cameras that see the back of the surface', () => {
    const samples = [pose(0, [0.5, 0.6, 1], target), pose(1, [0.5, 0.6, -0.9], target)];
    expect(rankPhotos(samples, images(2), { point: target }).map((r) => r.sample)).toEqual([1, 0]);
    expect(rankPhotos(samples, images(2), { point: target, side: [0, 0, 1] }).map((r) => r.sample)).toEqual([0]);
  });

  it('skips near-duplicate viewpoints and honors the limit', () => {
    const samples = [pose(0, [0.5, 0.6, 1], target), pose(1, [0.52, 0.61, 1], target), pose(2, [1.5, 0.6, 0.2], target), pose(3, [0.5, 1.6, 0.3], target)];
    const ranked = rankPhotos(samples, images(4), { point: target });
    expect(ranked.map((r) => r.sample)).not.toContain(1);
    expect(rankPhotos(samples, images(4), { point: target }, { limit: 2 })).toHaveLength(2);
    expect(rankPhotos(samples, images(4), { point: target }, { minSeparationDeg: 0 })).toHaveLength(4);
  });

  it('works in model-root space through the centering matrix', () => {
    // Poses are in reconstruction space; the viewer shifted the model by `toModel`.
    const toModel = centeringMatrix([2, 0.5, 1.5], [4, 1.5, 2.5]); // shift by (-3, -0.5, -2)
    const inv = new THREE.Matrix4().makeTranslation(3, 0.5, 2).toArray();
    expect(close(mulMat4(toModel, inv), IDENTITY)).toBe(true);
    const reconTarget = transformPoint(inv, target);
    const samples = [pose(0, transformPoint(inv, [0.5, 0.6, 1]), reconTarget), pose(1, transformPoint(inv, [3, 0.6, 1]), transformPoint(inv, [3, 0.6, 0]))];
    expect(rankPhotos(samples, images(2), { point: target }, { toModel }).map((r) => r.sample)).toEqual([0]);
    // Without the mapping the same target is outside every photo.
    expect(rankPhotos(samples, images(2), { point: target })).toEqual([]);
  });

  it('end to end: fixture USDZ through the viewer transform picks the matching close-ups', () => {
    // Same path as the app: USDLoader → centerOnGround → model root (with a scene transform).
    const object = new USDLoader().parse(makeUsdz().buffer as ArrayBuffer);
    const modelRoot = new THREE.Group();
    modelRoot.rotation.set(0, 1.2, 0);
    modelRoot.add(centerOnGround(object));
    const toModel = sourceToModelRoot(modelRoot)!;
    const poses = capturePoses(24);
    const imgs = poses.map((p) => `images/${p.file}.jpg`);
    // Points the user would tap, in model-root space: reconstruction coordinates mapped like the viewer does.
    const inModelRoot = (p: Vec3) => transformPoint(toModel, p.map((v, i) => v + MODEL_ORIGIN[i]) as Vec3);
    const hub = rankPhotos(poses, imgs, { point: inModelRoot([0.5, 0.34, 0.03]), side: [0, 0, 1] }, { toModel });
    expect(hub[0].path).toBe('images/IMG_0025.jpg'); // the front-hub close-up
    const fork = rankPhotos(poses, imgs, { point: inModelRoot([0.44, 0.66, 0]), side: [1, 0.2, 0.5] }, { toModel });
    expect(fork[0].path).toBe('images/IMG_0024.jpg'); // the fork-crown close-up
    // The non-drive-side close-up of the seat cluster never shows up for a drive-side comment.
    const seat = rankPhotos(poses, imgs, { point: inModelRoot([-0.17, 0.74, 0.02]), side: [0, 0, 1] }, { toModel });
    expect(seat.map((r) => r.path)).not.toContain('images/IMG_0030.jpg');
  });
});

describe('image helpers', () => {
  it('sniffs HEIF brands and maps MIME types', () => {
    const heic = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode('ftypheic'), 0, 0, 0, 0]);
    expect(isHeif(heic)).toBe(true);
    expect(isHeif(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
    expect(imageMime('a/IMG_1.HEIC')).toBe('image/heic');
    expect(imageMime('x.JPG')).toBe('image/jpeg');
    expect(imageMime('x.png')).toBe('image/png');
    expect(imageMime('x.bin')).toBe('application/octet-stream');
  });
});

describe('zip random access', () => {
  const big = new Uint8Array(50_000).map((_, i) => (i * 7) % 251);
  const zip = zipSync({ 'b/manifest.json': new TextEncoder().encode('{"a":1}'), 'b/images/IMG_0001.HEIC': [big, { level: 0 }], 'b/images/IMG_0002.HEIC': [big, { level: 6 }], 'b/ü.txt': new Uint8Array([1]) });

  it('reads single entries from a Blob without inflating the rest', async () => {
    const blob = new Blob([zip as BlobPart]);
    const index = await readZipIndex(blob);
    expect([...index.keys()].sort()).toEqual(['b/images/IMG_0001.HEIC', 'b/images/IMG_0002.HEIC', 'b/manifest.json', 'b/ü.txt']);
    expect(await readZipEntry(blob, index.get('b/images/IMG_0001.HEIC')!)).toEqual(big);
    expect(await readZipEntry(blob, index.get('b/images/IMG_0002.HEIC')!)).toEqual(big);
    expect(new TextDecoder().decode(await readZipEntry(blob, index.get('b/manifest.json')!))).toBe('{"a":1}');
    await expect(readZipEntry(blob, index.get('b/images/IMG_0002.HEIC')!, 1000)).rejects.toThrow(/too large/);
  });

  it('rejects non-zips and corrupt offsets', async () => {
    await expect(readZipIndex(new Blob(['hello']))).rejects.toThrow(/Not a zip/);
    const blob = new Blob([zip as BlobPart]);
    const entry = (await readZipIndex(blob)).get('b/manifest.json')!;
    await expect(readZipEntry(blob, { ...entry, offset: entry.offset + 3 })).rejects.toThrow(/Corrupt local header/);
    await expect(readZipEntry(blob, { ...entry, offset: zip.length + 10 })).rejects.toThrow(/outside/);
  });
});
