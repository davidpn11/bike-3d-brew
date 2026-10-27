#!/usr/bin/env node
// Generates the docs site's content from the repo's markdown, which stays the single source of
// truth. Writes (all gitignored):
//   content/docs/*.md, *.mdx, meta.json   pages for fumadocs-mdx
//   .generated/site-data.json             roadmap progress, latest changes, build info
// Runs before `dev` and `build`. Safe to run repeatedly: content/docs is rebuilt from scratch.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChangelog, parseRoadmap, roadmapTotals, slugOf, transformMarkdown } from './lib.mjs';

const docsApp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(docsApp, '../..');
const outDir = path.join(docsApp, 'content/docs');
const genDir = path.join(docsApp, '.generated');
const repoUrl = 'https://github.com/davidpn11/bike-3d-brew';

// Fixed pages first (in sidebar order), then every other docs/*.md alphabetically.
const fixed = [
  { src: 'README.md', slug: 'index', title: 'Overview' },
  { src: 'docs/TESTING-GUIDE.md', slug: 'testing-guide' },
  { src: 'docs/GOALS.md', slug: 'goals' },
  { src: 'ROADMAP.md', slug: 'roadmap' },
  { src: 'CHANGELOG.md', slug: 'changelog' },
  { src: 'docs/ARCHITECTURE.md', slug: 'architecture' },
  { src: 'docs/MANUAL-STEPS.md', slug: 'manual-steps' },
];
const reserved = new Set(['progress', ...fixed.map((p) => p.slug)]);
const extra = fs
  .readdirSync(path.join(repo, 'docs'))
  .filter((f) => /\.md$/i.test(f) && !fixed.some((p) => p.src === `docs/${f}`))
  .sort()
  .map((f) => ({ src: `docs/${f}`, slug: slugOf(f) }))
  .filter((p) => p.slug && !reserved.has(p.slug));
const sources = [...fixed, ...extra].filter((p) => fs.existsSync(path.join(repo, p.src)));

const pages = new Map(sources.map((p) => [p.src, p.slug === 'index' ? '/docs/' : `/docs/${p.slug}/`]));

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(genDir, { recursive: true });

const frontmatter = (fields) =>
  `---\n${Object.entries(fields)
    .filter(([, v]) => v)
    // JSON strings are valid YAML scalars, so any title is safe.
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n')}\n---\n\n`;

for (const p of sources) {
  const raw = fs.readFileSync(path.join(repo, p.src), 'utf8');
  let title = p.title;
  let body;
  try {
    const t = transformMarkdown(raw, { from: p.src, pages, repoUrl });
    title ??= t.title;
    body = t.body;
  } catch (err) {
    // Never fail the build over one odd file: show it verbatim instead.
    console.warn(`sync-content: ${p.src}: ${err.message}; rendering as plain text`);
    const fence = '`'.repeat(Math.max(3, ...[...raw.matchAll(/`+/g)].map((m) => m[0].length + 1)));
    body = `${fence}text\n${raw}\n${fence}\n`;
  }
  title ??= path.basename(p.src, path.extname(p.src));
  const note = `\n\n---\n\n_Source: [\`${p.src}\`](${repoUrl}/blob/develop/${p.src})_\n`;
  fs.writeFileSync(path.join(outDir, `${p.slug}.md`), frontmatter({ title }) + body.trimEnd() + note);
}

// The progress page is ours, so it can be MDX and use the dashboard components.
fs.writeFileSync(
  path.join(outDir, 'progress.mdx'),
  frontmatter({ title: 'Progress', description: 'Roadmap status per milestone, generated from ROADMAP.md at build time.' }) +
    '<ProgressPage />\n',
);

const sidebar = ['index', 'progress', 'testing-guide', '---Plan---', 'goals', 'roadmap', 'changelog', '---Technical---', 'architecture', 'manual-steps', '...'];
const have = new Set(['progress', ...sources.map((p) => p.slug)]);
fs.writeFileSync(
  path.join(outDir, 'meta.json'),
  JSON.stringify({ title: 'Docs', pages: sidebar.filter((s) => s.startsWith('---') || s === '...' || have.has(s)) }, null, 2) + '\n',
);

const read = (f) => {
  try {
    return fs.readFileSync(path.join(repo, f), 'utf8');
  } catch {
    return '';
  }
};
const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

const milestones = parseRoadmap(read('ROADMAP.md'));

// Session credit counter: docs/credits.json is updated by the agent session before each publish.
function readCredits() {
  try {
    const c = JSON.parse(read('docs/credits.json'));
    const budget = Number(c.budgetUsd);
    const spent = Number(c.spentUsd);
    if (!Number.isFinite(budget) || !Number.isFinite(spent) || budget <= 0) return null;
    return { budgetUsd: budget, spentUsd: spent, leftUsd: Math.max(0, budget - spent), updatedAt: String(c.updatedAt ?? '') };
  } catch {
    return null;
  }
}
const data = {
  roadmap: { milestones, totals: roadmapTotals(milestones) },
  changelog: parseChangelog(read('CHANGELOG.md')).slice(0, 3),
  credits: readCredits(),
  build: {
    // publish-pages.sh pins this to the commit date so identical sources build identical sites.
    builtAt: process.env.DOCS_BUILT_AT || new Date().toISOString(),
    sha: process.env.DOCS_GIT_SHA || git('rev-parse', '--short', 'HEAD'),
    branch: process.env.DOCS_GIT_BRANCH || git('rev-parse', '--abbrev-ref', 'HEAD'),
    commitDate: git('log', '-1', '--format=%cI'),
    dirty: git('status', '--porcelain') !== '',
  },
};
fs.writeFileSync(path.join(genDir, 'site-data.json'), JSON.stringify(data, null, 2) + '\n');

const t = data.roadmap.totals;
console.log(`sync-content: ${sources.length + 1} pages, roadmap ${t.done}/${t.total} done, ${t.progress} in progress (${data.build.sha || 'no git'})`);
