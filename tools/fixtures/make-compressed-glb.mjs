#!/usr/bin/env node
// Compressed variants of the fixture bike GLB, for the lazy-decoder tests (docs/PERFORMANCE.md):
//
//   bike-meshopt.glb  EXT_meshopt_compression       (tools/optimize-glb.mjs --compress meshopt)
//   bike-draco.glb    KHR_draco_mesh_compression    (tools/optimize-glb.mjs --compress draco)
//   bike-ktx2.glb     KHR_texture_basisu with a 4×4 RGBA8 KTX2 base color texture
//
// The KTX2 texture is uncompressed (vkFormat R8G8B8A8_SRGB): Node has no Basis encoder, and the
// viewer's KTX2Loader wiring is the same for both. Deterministic output, nothing committed.
//
//   node tools/fixtures/make-compressed-glb.mjs <bike.glb> <out-dir>

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { KHR_DF_MODEL_RGBSDA, KHR_DF_TRANSFER_SRGB, VK_FORMAT_R8G8B8A8_SRGB, createDefaultContainer, write } from 'three/examples/jsm/libs/ktx-parse.module.js';
import { optimizeGlb } from '../optimize-glb.mjs';

/** A 4×4 checker as an uncompressed sRGB KTX2 file. */
export function makeKtx2() {
  const c = createDefaultContainer();
  c.vkFormat = VK_FORMAT_R8G8B8A8_SRGB;
  c.typeSize = 1;
  c.pixelWidth = 4;
  c.pixelHeight = 4;
  c.pixelDepth = 0;
  c.levelCount = 1;
  const rgba = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < 16; i++) rgba.set((i + (i >> 2)) % 2 ? [230, 80, 30, 255] : [250, 250, 250, 255], i * 4);
  c.levels = [{ levelData: rgba, uncompressedByteLength: rgba.length }];
  const dfd = c.dataFormatDescriptor[0];
  dfd.colorModel = KHR_DF_MODEL_RGBSDA;
  dfd.transferFunction = KHR_DF_TRANSFER_SRGB;
  dfd.texelBlockDimension = [0, 0, 0, 0];
  dfd.bytesPlane = [4, 0, 0, 0, 0, 0, 0, 0];
  dfd.samples = [0, 1, 2, 15].map((channelType, i) => ({
    bitOffset: i * 8,
    bitLength: 7,
    channelType,
    samplePosition: [0, 0, 0, 0],
    sampleLower: 0,
    sampleUpper: 255,
  }));
  return write(c);
}

/** @param {Uint8Array} glb the fixture bike (tools/fixtures/make-capture-bundle.mjs → bike.glb) */
export async function buildCompressedGlbs(glb) {
  const out = {};
  out['bike-meshopt.glb'] = (await optimizeGlb(glb, { compress: 'meshopt' })).bytes;
  out['bike-draco.glb'] = (await optimizeGlb(glb, { compress: 'draco' })).bytes;

  const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.ERROR)).registerExtensions(ALL_EXTENSIONS);
  const doc = await io.readBinary(glb);
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  const texture = doc.createTexture('checker').setMimeType('image/ktx2').setImage(makeKtx2()).setURI('checker.ktx2');
  for (const material of doc.getRoot().listMaterials()) material.setBaseColorTexture(texture);
  out['bike-ktx2.glb'] = await io.writeBinary(doc);
  return out;
}

export async function writeCompressedGlbs(bikeGlbPath, dir) {
  mkdirSync(dir, { recursive: true });
  const files = await buildCompressedGlbs(new Uint8Array(readFileSync(bikeGlbPath)));
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(dir, name), bytes);
  return Object.keys(files);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [glb, dir] = process.argv.slice(2);
  if (!glb || !dir) {
    console.error('usage: node tools/fixtures/make-compressed-glb.mjs <bike.glb> <out-dir>');
    process.exit(2);
  }
  console.log((await writeCompressedGlbs(glb, dir)).join('\n'));
}
