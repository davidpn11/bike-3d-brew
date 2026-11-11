import { zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelLoadError, loadModel, loadWarnings } from '../src/viewer/loaders';
import { FastUSDComposer } from '../src/viewer/usd/composer';
import { CrateParser, isCrate } from '../src/viewer/usd/crate';
import { UsdLoadError, loadUsd } from '../src/viewer/usd/usdz';
import * as THREE from 'three';

// Value encodings and error paths the synthetic USDC fixtures (usdz.test.ts) do not contain.
// Regenerating fixtures needs Pixar USD, so these drive the overridden decoder methods directly.

// crateDataTypes.h
const T = { Bool: 1, Int: 3, Int64: 5, UInt64: 6, Half: 7, Matrix2d: 13, Matrix3d: 14, Quath: 18, Vec3h: 25, Vec4h: 29, Vec4i: 30, Vec2d: 19, Float: 8 };

type Testable = {
  _conversionView: DataView;
  reader: Record<string, () => number>;
  _readInlinedValue(rep: { typeEnum: number; getInlinedValue(): number }): unknown;
  _readScalarValue(type: number): unknown;
  _readHalf(): number;
};

function parser(values: number[] = []): Testable {
  const p = new CrateParser() as unknown as Testable;
  p._conversionView = new DataView(new ArrayBuffer(16));
  let i = 0;
  const next = () => values[i++];
  p.reader = { readInt32: next, readFloat64: next, readUint16: next };
  p._readHalf = next;
  return p;
}
const inlined = (typeEnum: number, payload: number) => ({ typeEnum, getInlinedValue: () => payload });

afterEach(() => vi.restoreAllMocks());

describe('CrateParser value decoding', () => {
  it('sniffs the crate magic', () => {
    expect(isCrate(new TextEncoder().encode('PXR-USDC....'))).toBe(true);
    expect(isCrate(new TextEncoder().encode('PXR-USD'))).toBe(false);
    expect(isCrate(new TextEncoder().encode('#usda 1.0\n'))).toBe(false);
  });

  it('decodes inlined integers, halves and int8-packed vectors', () => {
    const p = parser();
    expect(p._readInlinedValue(inlined(T.Int, 0xfffffffd))).toBe(-3);
    expect(p._readInlinedValue(inlined(T.Int64, 7))).toBe(7);
    expect(p._readInlinedValue(inlined(T.UInt64, 0xfffffffe))).toBe(4294967294);
    expect(p._readInlinedValue(inlined(T.Half, 0x3800))).toBe(0.5);
    // (1, -2) packed as int8: 0x01, 0xFE.
    expect(p._readInlinedValue(inlined(T.Vec2d, 0xfe01))).toEqual([1, -2]);
    // Everything else is three's job.
    expect(p._readInlinedValue(inlined(T.Bool, 1))).toBe(true);
  });

  it('decodes the scalar types three r186 does not', () => {
    expect(parser([1, 2, 3])._readScalarValue(T.Vec3h)).toEqual([1, 2, 3]);
    expect(parser([1, 2, 3, 4])._readScalarValue(T.Vec4h)).toEqual([1, 2, 3, 4]);
    expect(parser([0, 0, 0, 1])._readScalarValue(T.Quath)).toEqual([0, 0, 0, 1]);
    expect(parser([1, -2, 3, -4])._readScalarValue(T.Vec4i)).toEqual([1, -2, 3, -4]);
    expect(parser([1, 0, 0, 1])._readScalarValue(T.Matrix2d)).toEqual([1, 0, 0, 1]);
    expect(parser([1, 0, 0, 0, 1, 0, 0, 0, 1])._readScalarValue(T.Matrix3d)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });
});

describe('FastUSDComposer', () => {
  type Internals = {
    _triangulateIndicesWithPattern(i: ArrayLike<number>, c: ArrayLike<number>): { indices: ArrayLike<number>; pattern: ArrayLike<number> };
    _applyTriangulationPattern(i: ArrayLike<number>, p: ArrayLike<number>): ArrayLike<number>;
  };
  const c = new FastUSDComposer() as unknown as Internals;

  it('reuses index arrays for all-triangle meshes', () => {
    const tri = [0, 1, 2, 2, 1, 3];
    const { indices, pattern } = c._triangulateIndicesWithPattern(tri, [3, 3]);
    expect(indices).toBe(tri);
    const uvIndices = [5, 6, 7, 8, 9, 10];
    expect(c._applyTriangulationPattern(uvIndices, pattern)).toBe(uvIndices);
  });

  it('falls back to three for quads and remaps through a real pattern', () => {
    const { indices, pattern } = c._triangulateIndicesWithPattern([0, 1, 2, 3], [4]);
    expect(Array.from(indices)).toHaveLength(6);
    const remapped = c._applyTriangulationPattern([10, 11, 12, 13], pattern);
    expect(remapped).toBeInstanceOf(Int32Array);
    expect(Array.from(remapped).every((v) => v >= 10 && v <= 13)).toBe(true);
    // An identity pattern applied to arrays of another length is remapped, not reused.
    const identity = c._triangulateIndicesWithPattern([0, 1, 2], [3]).pattern;
    expect(Array.from(c._applyTriangulationPattern([7, 8, 9, 99], identity))).toEqual([7, 8, 9]);
  });
});

describe('loadUsd error paths', () => {
  it('wraps broken archives and scenes that cannot be built', async () => {
    const corrupt = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6]);
    await expect(loadUsd(corrupt)).rejects.toThrow(/Could not read the USDZ archive/);
    const usda = new TextEncoder().encode('#usda 1.0\n');
    const nonsense = () => ({ specsByPath: null }) as never;
    await expect(loadUsd(zipSync({ 'a.usda': usda }), nonsense)).rejects.toBeInstanceOf(UsdLoadError);
    await expect(loadUsd(zipSync({ 'a.usda': usda }), nonsense)).rejects.toThrow(/Could not build the USD scene/);
    const failing = () => {
      throw new Error('bad layer');
    };
    await expect(loadUsd(zipSync({ 'a.usda': usda }), failing)).rejects.toThrow(/Could not parse a\.usda: bad layer/);
  });

  it('finds the root layer even when it is not the first entry', async () => {
    const usda = '#usda 1.0\n(\n    upAxis = "Y"\n)\ndef Mesh "m"\n{\n    int[] faceVertexCounts = [3]\n    int[] faceVertexIndices = [0, 1, 2]\n    point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 1, 0)]\n}\n';
    const pkg = zipSync({ 'readme.png': new Uint8Array([0x89, 0x50]), 'model.usda': new TextEncoder().encode(usda) });
    const { stats } = await loadUsd(pkg);
    expect(stats.rootLayer).toBe('model.usda');
    expect(stats.meshes).toBe(1);
  });
});

describe('loadModel (network and warnings)', () => {
  it('explains a model URL that does not download', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 404 }));
    const err = await loadModel('https://example.test/bike.usdz', 'usdz').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelLoadError);
    expect((err as Error).message).toBe('Could not download the model (HTTP 404).');
  });

  it('reports no warnings for models loaded without any', () => {
    expect(loadWarnings(new THREE.Group())).toEqual([]);
    const g = new THREE.Group();
    g.userData.loadWarnings = ['1 texture could not be decoded'];
    expect(loadWarnings(g)).toEqual(['1 texture could not be decoded']);
  });
});
