#!/usr/bin/env node
// tools/reconstruct: photos / video → bike-capture/1. See docs/RECONSTRUCTION.md.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { readColmapDir } from './colmap.mjs';
import { packageCapture, readImageDir } from './package.mjs';

const HELP = `Usage: node tools/reconstruct/cli.mjs <command> [options]

Commands:
  poses    COLMAP model → bike-poses/1
           --colmap <dir>    folder with cameras.txt/images.txt or cameras.bin/images.bin
                             (TXT is preferred when both are present; points3D is optional)
           -o, --out <file>  poses.json to write (default: stdout)

  package  reconstruction result → *.bikecapture.zip (bike-capture/1)
           --model <file>    model.glb (or .usdz / .ply)
           --images <dir>    JPEG frames the poses refer to
           --colmap <dir>    poses from a COLMAP model, or
           --poses <file>    an existing bike-poses/1 poses.json (omit both: no poses)
           --source <s>      photos | video
           --backend <b>     e.g. colmap, object-capture
           --name <name>     bike name (default: the model's folder name)
           -o, --out <file>  zip to write (default: <name>.bikecapture.zip)

  -h, --help               this help
`;

const options = {
  colmap: { type: 'string' },
  out: { type: 'string', short: 'o' },
  model: { type: 'string' },
  images: { type: 'string' },
  poses: { type: 'string' },
  source: { type: 'string' },
  backend: { type: 'string' },
  name: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
};

function need(values, ...keys) {
  const missing = keys.filter((k) => !values[k]);
  if (missing.length) throw new Error(`missing ${missing.map((k) => `--${k}`).join(', ')} (see --help)`);
}

function main(argv) {
  const { values, positionals } = parseArgs({ args: argv, options, allowPositionals: true });
  const [command] = positionals;
  if (values.help || !command) return void process.stdout.write(HELP);

  if (command === 'poses') {
    need(values, 'colmap');
    const { poses, points, pointsWarning } = readColmapDir(values.colmap, { includePoints: Boolean(values.out) });
    if (pointsWarning) console.error(`warning: ${pointsWarning}`);
    const json = JSON.stringify(poses, null, 2);
    if (!values.out) return void process.stdout.write(`${json}\n`);
    writeFileSync(values.out, json);
    console.error(`wrote ${values.out}: ${poses.samples.length} poses (${points.length} sparse points)`);
    return;
  }

  if (command === 'package') {
    need(values, 'model', 'images', 'source', 'backend');
    if (values.colmap && values.poses) throw new Error('give --colmap or --poses, not both');
    const poses = values.colmap ? readColmapDir(values.colmap).poses : values.poses ? JSON.parse(readFileSync(values.poses, 'utf8')) : null;
    const model = resolve(values.model);
    const name = values.name ?? basename(dirname(model));
    const zip = packageCapture({
      name,
      source: values.source,
      backend: values.backend,
      model: { name: basename(model), data: readFileSync(model) },
      poses,
      images: readImageDir(values.images),
    });
    const out = values.out ?? `${name.replace(/[^\w.-]+/g, '-')}.bikecapture.zip`;
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(out, zip);
    console.error(`wrote ${out} (${(zip.length / 2 ** 20).toFixed(1)} MB, ${poses?.samples.length ?? 0} poses)`);
    return;
  }

  throw new Error(`unknown command "${command}" (see --help)`);
}

try {
  main(process.argv.slice(2));
} catch (err) {
  console.error(`reconstruct: ${err.message}`);
  process.exit(1);
}
