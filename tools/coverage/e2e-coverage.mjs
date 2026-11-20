#!/usr/bin/env node
// Turns the V8 coverage Chromium collected during an `E2E_COVERAGE=1` Playwright run into an
// Istanbul report of apps/web/src, and merges it with the unit report, so code only the browser
// runs (ui/app.ts, viewer/Viewer.ts, main.ts…) counts too. See docs/TESTING.md.
//
//   node tools/coverage/e2e-coverage.mjs [unit.json e2e.json…]   # default: coverage/ + coverage-e2e/**/ → coverage-all/
//
// `convertE2eCoverage()` runs in the E2E global teardown: raw V8 per worker (coverage-e2e/raw/,
// written by apps/web/e2e/test.ts) + dist/ source maps → coverage-e2e/coverage-final.json.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCoverageMap } from '@vitest/istanbul-lib-coverage';
import { createContext, create } from '@vitest/istanbul-lib-report';
import astV8ToIstanbul from 'ast-v8-to-istanbul';
import { parseAstAsync } from 'vite';

const { mergeProcessCovs } = createRequire(import.meta.url)('@bcoe/v8-coverage');

const root = fileURLToPath(new URL('../..', import.meta.url));
const SRC = join(root, 'apps/web/src') + sep;
const DIST = join(root, 'dist');
export const E2E_DIR = join(root, 'coverage-e2e');
export const RAW_DIR = join(E2E_DIR, 'raw');
const UNIT_JSON = join(root, 'coverage/coverage-final.json');
const OUT_DIR = join(root, 'coverage-all');
/** Ratchet for the merged report, like the unit thresholds in apps/web/vite.config.ts: just under the current numbers; raise, never lower. */
export const THRESHOLDS = { lines: 96.5, statements: 95, functions: 92, branches: 89.5 };

/** App sources only: no node_modules, no type declarations, no Web Worker (V8 coverage of the page does not see it). */
const isAppSource = (file) => file.startsWith(SRC) && !file.endsWith('.d.ts');

export async function convertE2eCoverage() {
  if (!existsSync(RAW_DIR)) return null;
  const raw = readdirSync(RAW_DIR).map((f) => JSON.parse(readFileSync(join(RAW_DIR, f), 'utf8')));
  const { result } = mergeProcessCovs(raw);
  const map = createCoverageMap({});
  for (const script of result) {
    // Scripts were recorded by URL path (/assets/x.js); the build that served them is in dist/.
    const file = join(DIST, script.url);
    if (!existsSync(file) || !existsSync(`${file}.map`)) continue; // decoders, or a build without E2E_COVERAGE source maps
    const code = readFileSync(file, 'utf8');
    const data = await astV8ToIstanbul({
      code,
      sourceMap: JSON.parse(readFileSync(`${file}.map`, 'utf8')),
      ast: parseAstAsync(code),
      coverage: { url: pathToFileURL(file).href, functions: script.functions },
    });
    for (const [path, fileCov] of Object.entries(data)) if (isAppSource(path)) map.addFileCoverage(fileCov);
  }
  mkdirSync(E2E_DIR, { recursive: true });
  const out = join(E2E_DIR, 'coverage-final.json');
  writeFileSync(out, JSON.stringify(map.toJSON()));
  rmSync(RAW_DIR, { recursive: true, force: true });
  return out;
}

/** Every coverage-final.json under coverage-e2e/ (one per run, or per CI shard). */
function e2eReports(dir = E2E_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .filter((f) => f.endsWith('coverage-final.json'))
    .map((f) => join(dir, f));
}

const locKey = (l) => `${l.start.line}|${l.start.column}|${l.end.line}|${l.end.column}`;

/**
 * The E2E counts of a file the unit report also measures, restricted to the statements,
 * functions and branches the unit report has: the production build and Vitest's transform place a
 * few of them differently, and unmatched locations would count twice.
 */
export function alignTo(unit, e2e) {
  const out = { ...e2e, statementMap: {}, s: {}, fnMap: {}, f: {}, branchMap: {}, b: {} };
  delete out.bT;
  const keep = (mapName, countName, locOf) => {
    const known = new Set(Object.values(unit[mapName]).map((x) => locKey(locOf(x))));
    for (const [id, x] of Object.entries(e2e[mapName])) {
      if (!known.has(locKey(locOf(x)))) continue;
      out[mapName][id] = x;
      out[countName][id] = e2e[countName][id];
    }
  };
  keep('statementMap', 's', (l) => l);
  keep('fnMap', 'f', (fn) => fn.loc);
  keep('branchMap', 'b', (br) => br.locations[0]);
  return out;
}

const readJson = (file) => {
  if (!existsSync(file)) throw new Error(`Missing ${file}: run \`bun run test:coverage\` and \`bun run e2e:coverage\` first`);
  return JSON.parse(readFileSync(file, 'utf8'));
};

/** Unit report + E2E reports → one report of apps/web/src in `outDir`. Returns the totals. */
export function mergeReports(unitJson = UNIT_JSON, e2eJsons = e2eReports(), outDir = OUT_DIR) {
  if (!e2eJsons.length) throw new Error('No E2E coverage: run `bun run e2e:coverage` first');
  const unit = readJson(unitJson);
  const map = createCoverageMap(unit);
  for (const file of e2eJsons) {
    for (const [path, cov] of Object.entries(readJson(file))) map.addFileCoverage(unit[path] ? alignTo(unit[path], cov) : cov);
  }
  map.filter(isAppSource);
  const context = createContext({ dir: outDir, coverageMap: map });
  for (const name of ['text-summary', 'html', 'json-summary']) create(name, { projectRoot: root }).execute(context);
  return map.getCoverageSummary();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [unit, ...e2e] = process.argv.slice(2).map((p) => resolve(p));
  const totals = mergeReports(unit, e2e.length ? e2e : undefined);
  console.log(`\nMerged unit + E2E report: ${join(OUT_DIR, 'index.html')}`);
  const low = Object.entries(THRESHOLDS).filter(([k, min]) => totals[k].pct < min);
  for (const [k, min] of low) console.error(`ERROR: merged ${k} coverage ${totals[k].pct}% is below the threshold ${min}%`);
  if (low.length) process.exit(1);
}
