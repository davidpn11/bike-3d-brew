import * as THREE from 'three';

/** A vertex attribute as plain typed data (what `weldArrays` reads and writes). */
export interface WeldAttribute {
  array: THREE.TypedArray;
  itemSize: number;
}

export interface WeldResult {
  /** New vertex index per old vertex (the triangle list of the welded mesh). */
  index: Uint32Array;
  /** Number of distinct vertices kept. */
  count: number;
  attributes: WeldAttribute[];
}

/**
 * Merges vertices whose attributes are all equal into an indexed vertex list, in O(n) with an
 * open-addressing hash table over typed arrays (no strings, no per-vertex objects).
 *
 * three expands USD face-varying meshes to three vertices per triangle, so a 1M-triangle capture
 * becomes ~3M vertices where ~0.5M are distinct: every corner shared by neighbouring triangles is
 * a bit-identical copy. `tolerance` 0 (default) merges exact copies only; a positive tolerance
 * merges float components that round to the same multiple of it (per attribute: pass an array).
 * The first occurrence of each vertex is kept, so welding is deterministic and order-preserving.
 */
export function weldArrays(attributes: WeldAttribute[], count: number, tolerance: number | number[] = 0): WeldResult {
  const tol = attributes.map((_, i) => (Array.isArray(tolerance) ? (tolerance[i] ?? 0) : tolerance));
  const exact = tol.every((t) => !(t > 0)) && attributes.every(({ array }) => array.BYTES_PER_ELEMENT === 4);
  const index = new Uint32Array(count);
  const unique = exact ? weldWords(attributes, count, index) : weldValues(attributes, count, index, tol);

  // Unique ids were handed out in order of first occurrence: copy each first occurrence.
  const out = attributes.map(({ array, itemSize }) => {
    const Ctor = array.constructor as new (n: number) => THREE.TypedArray;
    const dst = new Ctor(unique * itemSize);
    for (let v = 0, next = 0; next < unique; v++) {
      if (index[v] !== next) continue;
      for (let j = 0, s = v * itemSize, d = next * itemSize; j < itemSize; j++) dst[d + j] = array[s + j];
      next++;
    }
    return { array: dst, itemSize };
  });
  return { index, count: unique, attributes: out };
}

/** Load factor ≤ 0.5 even if nothing merges, so linear probing stays short and always terminates. */
function hashTable(count: number): Int32Array {
  let size = 2;
  while (size < count * 2) size <<= 1;
  return new Int32Array(size).fill(-1);
}

/** Final avalanche (murmur3 fmix32) so linear probing sees well-spread slots. */
function mix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return h ^ (h >>> 16);
}

/**
 * Exact fast path (the face-varying expansion case): compares and hashes the 32-bit words of every
 * component, so float32 corners merge only when bit-identical. Table slots hold the first vertex
 * with that value; ~6× faster than the generic path below.
 */
function weldWords(attributes: WeldAttribute[], count: number, index: Uint32Array): number {
  const words = attributes.map(({ array }) => new Uint32Array(array.buffer, array.byteOffset, array.length));
  const sizes = attributes.map((a) => a.itemSize);
  if (sizes.length === 3 && [...sizes].sort().join() === '2,3,3') {
    // Any order (three's USD composer emits position, uv, normal).
    const [p, n] = words.filter((_, i) => sizes[i] === 3);
    return weldPositionNormalUv(p, n, words[sizes.indexOf(2)], count, index);
  }
  const n = words.length;
  const table = hashTable(count);
  const mask = table.length - 1;
  let unique = 0;
  for (let v = 0; v < count; v++) {
    let h = 0x811c9dc5;
    for (let a = 0; a < n; a++) {
      const w = words[a];
      const s = sizes[a];
      for (let j = 0, o = v * s; j < s; j++) h = Math.imul(h ^ w[o + j], 0x01000193);
    }
    let slot = mix(h) & mask;
    for (;;) {
      const first = table[slot];
      if (first < 0) {
        table[slot] = v;
        index[v] = unique++;
        break;
      }
      let same = true;
      for (let a = 0; a < n && same; a++) {
        const w = words[a];
        const s = sizes[a];
        for (let j = 0, p = first * s, q = v * s; j < s; j++) {
          if (w[p + j] !== w[q + j]) {
            same = false;
            break;
          }
        }
      }
      if (same) {
        index[v] = index[first];
        break;
      }
      slot = (slot + 1) & mask;
    }
  }
  return unique;
}

/**
 * weldWords unrolled for position + normal + uv, the layout of every Object Capture mesh: the JIT
 * keeps it all in registers, ~40% faster than the loops over attributes.
 */
function weldPositionNormalUv(P: Uint32Array, N: Uint32Array, U: Uint32Array, count: number, index: Uint32Array): number {
  const table = hashTable(count);
  const mask = table.length - 1;
  let unique = 0;
  for (let v = 0; v < count; v++) {
    const o = v * 3;
    const q = v * 2;
    let h = 0x811c9dc5;
    h = Math.imul(h ^ P[o], 0x01000193);
    h = Math.imul(h ^ P[o + 1], 0x01000193);
    h = Math.imul(h ^ P[o + 2], 0x01000193);
    h = Math.imul(h ^ N[o], 0x01000193);
    h = Math.imul(h ^ N[o + 1], 0x01000193);
    h = Math.imul(h ^ N[o + 2], 0x01000193);
    h = Math.imul(h ^ U[q], 0x01000193);
    h = Math.imul(h ^ U[q + 1], 0x01000193);
    let slot = mix(h) & mask;
    for (;;) {
      const f = table[slot];
      if (f < 0) {
        table[slot] = v;
        index[v] = unique++;
        break;
      }
      const fo = f * 3;
      const fq = f * 2;
      if (P[fo] === P[o] && P[fo + 1] === P[o + 1] && P[fo + 2] === P[o + 2] && N[fo] === N[o] && N[fo + 1] === N[o + 1] && N[fo + 2] === N[o + 2] && U[fq] === U[q] && U[fq + 1] === U[q + 1]) {
        index[v] = index[f];
        break;
      }
      slot = (slot + 1) & mask;
    }
  }
  return unique;
}

/** Generic path: any typed array, optional per-attribute tolerance (values that round to the same multiple merge). */
function weldValues(attributes: WeldAttribute[], count: number, index: Uint32Array, tol: number[]): number {
  const component = (a: number, o: number): number => {
    const x = attributes[a].array[o];
    return tol[a] > 0 ? Math.round(x / tol[a]) : x;
  };
  const scratch = new Float64Array(1);
  const scratchWords = new Uint32Array(scratch.buffer);
  const table = hashTable(count);
  const mask = table.length - 1;
  let unique = 0;
  for (let v = 0; v < count; v++) {
    let h = 0x811c9dc5;
    for (let a = 0; a < attributes.length; a++) {
      const s = attributes[a].itemSize;
      for (let j = 0, o = v * s; j < s; j++) {
        scratch[0] = component(a, o + j) + 0; // + 0 folds -0 into 0, as === does
        h = Math.imul(h ^ scratchWords[0] ^ scratchWords[1], 0x01000193);
      }
    }
    let slot = mix(h) & mask;
    for (;;) {
      const first = table[slot];
      if (first < 0) {
        table[slot] = v;
        index[v] = unique++;
        break;
      }
      let same = true;
      for (let a = 0; a < attributes.length && same; a++) {
        const s = attributes[a].itemSize;
        for (let j = 0; j < s && same; j++) same = component(a, first * s + j) === component(a, v * s + j);
      }
      if (same) {
        index[v] = index[first];
        break;
      }
      slot = (slot + 1) & mask;
    }
  }
  return unique;
}

export interface WeldStats {
  before: number;
  after: number;
  ms: number;
}

/**
 * Welds a non-indexed BufferGeometry in place (attributes replaced, index added). Indexed
 * geometries, interleaved or morph-targeted ones are left alone. Groups keep their ranges: index
 * position i is still old vertex i. Returns null when nothing was done.
 */
export function weldGeometry(geometry: THREE.BufferGeometry, tolerance: number | number[] = 0): WeldStats | null {
  if (geometry.index || Object.keys(geometry.morphAttributes).length) return null;
  const names = Object.keys(geometry.attributes);
  const attrs = names.map((n) => geometry.getAttribute(n));
  if (!attrs.length || attrs.some((a) => !(a instanceof THREE.BufferAttribute))) return null;
  const count = (attrs[0] as THREE.BufferAttribute).count;
  if (count < 3) return null;
  const t0 = performance.now();
  const result = weldArrays(
    attrs.map((a) => ({ array: (a as THREE.BufferAttribute).array, itemSize: a.itemSize })),
    count,
    tolerance,
  );
  if (result.count === count) return { before: count, after: count, ms: performance.now() - t0 };
  names.forEach((name, i) => {
    const old = attrs[i] as THREE.BufferAttribute;
    const next = new THREE.BufferAttribute(result.attributes[i].array, old.itemSize, old.normalized);
    next.name = old.name;
    geometry.setAttribute(name, next);
  });
  geometry.setIndex(new THREE.BufferAttribute(result.count > 65535 ? result.index : Uint16Array.from(result.index), 1));
  return { before: count, after: result.count, ms: performance.now() - t0 };
}
