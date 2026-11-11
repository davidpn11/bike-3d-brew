#!/usr/bin/env node
// Installs a share package (`*.bikeshare.zip`, format `bike-share/1`, exported by the viewer's
// Share → "Export share package") as a published scene, so the customer link
//   …/app/?scene=scenes/<id>/scene.bike.json&view=present
// works on the deployed viewer (GitHub Pages: tools/publish-pages.sh copies apps/web/public).
//
//   node tools/publish-scene.mjs <file.bikeshare.zip> [--id <id>] [--out <dir>] [--force]
//
//   --id <id>    folder name under scenes/ (default: the id in the package's bike-share.json)
//   --out <dir>  where scenes live (default: apps/web/public/scenes). Use a folder outside the
//                repo to publish to another static host, e.g. for real customer captures.
//   --force      replace an existing scenes/<id>/ folder
//
// The package is untrusted: it is validated with the viewer's own code (src/scene/share.ts:
// parseScene, size limits, only a scene, a manifest, one model and JPEG photos, no paths outside
// the package) before anything is written.

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function usage(code = 2) {
  console.error('usage: node tools/publish-scene.mjs <file.bikeshare.zip> [--id <id>] [--out <dir>] [--force]');
  process.exit(code);
}

/** Parses argv; exported shape is used by tests through `publishScene`. */
function parseArgs(argv) {
  const args = { file: null, id: undefined, out: join(root, 'apps/web/public/scenes'), force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--id') args.id = argv[++i] ?? usage();
    else if (a === '--out') args.out = resolve(argv[++i] ?? usage());
    else if (a === '--force') args.force = true;
    else if (a === '-h' || a === '--help') usage(0);
    else if (a.startsWith('-')) usage();
    else if (!args.file) args.file = a;
    else usage();
  }
  if (!args.file) usage();
  return args;
}

/**
 * Validates and writes a package; returns the scene folder and its `?scene=` path. Throws with a
 * readable message on any problem, writing nothing.
 */
export async function publishScene({ file, id, out, force = false }) {
  const { module: share } = await runnerImport(join(root, 'apps/web/src/scene/share.ts'));
  const size = statSync(file).size;
  if (size > share.SHARE_LIMITS.zip) throw new Error(`${file} is larger than ${share.SHARE_LIMITS.zip >> 20} MB.`);
  const pkg = share.readSharePackage(new Uint8Array(readFileSync(file)), { id });
  const dir = resolve(out, pkg.id);
  if (!dir.startsWith(resolve(out) + sep)) throw new Error(`Refusing to write outside ${out}.`);
  if (existsSync(dir)) {
    if (!force) throw new Error(`${relative(process.cwd(), dir) || dir} already exists. Pass --force to replace it, or --id <other-id>.`);
    rmSync(dir, { recursive: true, force: true });
  }
  for (const f of pkg.files) {
    const target = resolve(dir, f.path);
    if (!target.startsWith(dir + sep)) throw new Error(`Refusing to write ${f.path}.`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.bytes);
  }
  return { id: pkg.id, dir, scene: pkg.scene, files: pkg.files.map((f) => f.path), warnings: pkg.warnings, sceneParam: `scenes/${pkg.id}/scene.bike.json` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const r = await publishScene(args);
    for (const w of r.warnings) console.warn(`warning: ${w}`);
    console.log(`Published “${r.scene.name}” to ${relative(process.cwd(), r.dir) || r.dir}/ (${r.files.length} files: ${r.files.join(', ')})`);
    const inRepo = r.dir.startsWith(join(root, 'apps/web/public') + sep);
    console.log(`\nCustomer link (local dev):  http://localhost:5190/?scene=${r.sceneParam}&view=present`);
    if (inRepo) {
      console.log(`Customer link (live site):  https://davidpn11.github.io/bike-3d-brew/app/?scene=${r.sceneParam}&view=present`);
      console.log('  …after committing it and running tools/publish-pages.sh.');
      if (r.scene.model.format === 'usdz') console.log('note: publish-pages.sh refuses .usdz files (they look like private captures); convert with tools/usdz-to-glb.py.');
      console.log('Reminder: never commit real customer captures to this repo; use --out to publish them elsewhere.');
    }
  } catch (err) {
    console.error(`publish-scene: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
