#!/usr/bin/env node
// Makes a phone-friendly GLB from a capture (docs/PERFORMANCE.md#optimizing-a-capture).
//
//   node tools/optimize-glb.mjs in.glb out.glb [options]
//
//   --compress meshopt|draco|none   geometry compression (default meshopt: smallest decoder, fastest decode)
//   --simplify <ratio>              keep this fraction of triangles (0–1), e.g. 0.5; off by default
//   --error <fraction>              simplifier error limit as a fraction of the mesh radius (default 0.001)
//   --textures keep|webp|ktx2       webp needs `npm i -D sharp`; ktx2 needs KTX-Software's `toktx` on PATH
//   --max-texture <px>              downscale textures larger than this (needs sharp), e.g. 2048
//
// Always: dedup + weld (indexed geometry) + prune. USDZ captures go through tools/usdz-to-glb.py
// first. The viewer decodes Meshopt, Draco and KTX2 itself and only fetches the decoder a file needs.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, draco, meshopt, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

/**
 * @param {Uint8Array} input GLB bytes
 * @param {{ compress?: 'meshopt'|'draco'|'none', simplify?: number, error?: number, textures?: 'keep'|'webp'|'ktx2', maxTexture?: number, log?: (msg: string) => void }} [options]
 * @returns {Promise<{ bytes: Uint8Array, stats: { inBytes: number, outBytes: number, trianglesIn: number, trianglesOut: number, verticesIn: number, verticesOut: number } }>}
 */
export async function optimizeGlb(input, options = {}) {
  const { compress = 'meshopt', textures = 'keep', error = 0.001, log = () => {} } = options;
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.WARN)).registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
    'draco3d.decoder': await draco3d.createDecoderModule(),
    'draco3d.encoder': await draco3d.createEncoderModule(),
  });
  const doc = await io.readBinary(input);
  const before = count(doc);

  const steps = [dedup(), weld()];
  if (options.simplify && options.simplify < 1) {
    await MeshoptSimplifier.ready;
    steps.push(simplify({ simplifier: MeshoptSimplifier, ratio: options.simplify, error }));
  }
  steps.push(prune());
  if (textures === 'webp' || options.maxTexture) {
    const sharp = await import('sharp').then((m) => m.default).catch(() => null);
    if (!sharp) throw new Error('--textures webp / --max-texture need sharp: npm i -D sharp');
    const size = options.maxTexture;
    steps.push(textureCompress({ encoder: sharp, targetFormat: textures === 'webp' ? 'webp' : undefined, resize: size ? [size, size] : undefined }));
  }
  if (compress === 'meshopt') steps.push(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  else if (compress === 'draco') steps.push(draco({ method: 'edgebreaker' }));
  await doc.transform(...steps);

  let bytes = await io.writeBinary(doc);
  if (textures === 'ktx2') bytes = ktx2(bytes, log);
  const after = count(await io.readBinary(bytes));
  return {
    bytes,
    stats: { inBytes: input.length, outBytes: bytes.length, trianglesIn: before.triangles, trianglesOut: after.triangles, verticesIn: before.vertices, verticesOut: after.vertices },
  };
}

/** KTX2 (ETC1S/UASTC) encoding needs KTX-Software's toktx; gltf-transform's CLI drives it. */
function ktx2(bytes, log) {
  if (spawnSync('toktx', ['--version']).error) throw new Error('--textures ktx2 needs KTX-Software (toktx) on PATH: https://github.com/KhronosGroup/KTX-Software/releases');
  const tmp = `${process.env.TMPDIR ?? '/tmp'}/optimize-glb-${process.pid}.glb`;
  writeFileSync(tmp, bytes);
  log('Encoding textures to KTX2 (ETC1S) with toktx…');
  const r = spawnSync('npx', ['--yes', '@gltf-transform/cli@4.5.1', 'etc1s', tmp, tmp], { stdio: 'inherit' });
  if (r.status) throw new Error('KTX2 encoding failed');
  return new Uint8Array(readFileSync(tmp));
}

function count(doc) {
  let triangles = 0;
  let vertices = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const n = prim.getAttribute('POSITION')?.getCount() ?? 0;
      vertices += n;
      if (prim.getMode() === 4) triangles += (prim.getIndices()?.getCount() ?? n) / 3;
    }
  }
  return { triangles: Math.round(triangles), vertices };
}

async function main(argv) {
  const [inPath, outPath] = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
  if (!inPath || !outPath) {
    console.error('usage: node tools/optimize-glb.mjs in.glb out.glb [--compress meshopt|draco|none] [--simplify 0.5] [--error 0.001] [--textures keep|webp|ktx2] [--max-texture 2048]');
    process.exit(2);
  }
  const opt = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const num = (name) => (opt(name) === undefined ? undefined : Number(opt(name)));
  const t = performance.now();
  const { bytes, stats } = await optimizeGlb(new Uint8Array(readFileSync(inPath)), {
    compress: opt('compress') ?? 'meshopt',
    simplify: num('simplify'),
    error: num('error') ?? 0.001,
    textures: opt('textures') ?? 'keep',
    maxTexture: num('max-texture'),
    log: console.log,
  });
  writeFileSync(outPath, bytes);
  const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;
  console.log(
    `${inPath} → ${outPath}: ${mb(stats.inBytes)} → ${mb(stats.outBytes)}, ${stats.trianglesIn} → ${stats.trianglesOut} triangles, ` +
      `${stats.verticesIn} → ${stats.verticesOut} vertices (${((performance.now() - t) / 1000).toFixed(1)} s)`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main(process.argv.slice(2));
