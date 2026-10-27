import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseChangelog, parseRoadmap, rewriteLink, roadmapTotals, slugOf, splitFences, transformMarkdown } from './lib.mjs';

const repoUrl = 'https://github.com/o/r';
const pages = new Map([
  ['README.md', '/docs/'],
  ['ROADMAP.md', '/docs/roadmap/'],
  ['docs/ARCHITECTURE.md', '/docs/architecture/'],
]);

test('splitFences keeps code blocks intact, including unclosed ones', () => {
  const parts = splitFences('a\n```js\n# not a heading\n```\nb\n~~~~\nx\n```\nstill code');
  assert.deepEqual(
    parts.map((p) => p.code),
    [false, true, false, true],
  );
  assert.match(parts[1].text, /# not a heading/);
  assert.match(parts[3].text, /still code$/);
});

test('rewriteLink maps synced files to pages and the rest to GitHub', () => {
  assert.equal(rewriteLink('ROADMAP.md', 'README.md', pages, repoUrl), '/docs/roadmap/');
  assert.equal(rewriteLink('../ROADMAP.md#m2', 'docs/GOALS.md', pages, repoUrl), '/docs/roadmap/#m2');
  assert.equal(rewriteLink('ARCHITECTURE.md', 'docs/GOALS.md', pages, repoUrl), '/docs/architecture/');
  assert.equal(rewriteLink('apps/ios/README.md', 'README.md', pages, repoUrl), 'https://github.com/o/r/blob/develop/apps/ios/README.md');
  assert.equal(rewriteLink('https://x.dev/a.md', 'README.md', pages, repoUrl), 'https://x.dev/a.md');
  assert.equal(rewriteLink('#local', 'README.md', pages, repoUrl), '#local');
  assert.equal(rewriteLink('../../etc/passwd', 'README.md', pages, repoUrl), '../../etc/passwd');
});

test('transformMarkdown extracts the title, strips comments, leaves code alone', () => {
  const md = '<!-- hidden -->\n# Hello `world`\n\nSee [roadmap](ROADMAP.md) and `[x](ROADMAP.md)`.\n\n```\n<!-- keep --> [y](ROADMAP.md)\n```\n\n[ref]: docs/ARCHITECTURE.md\n';
  const { title, body } = transformMarkdown(md, { from: 'README.md', pages, repoUrl });
  assert.equal(title, 'Hello world');
  assert.doesNotMatch(body, /hidden|^# /m);
  assert.match(body, /\[roadmap\]\(\/docs\/roadmap\/\)/);
  assert.match(body, /`\[x\]\(ROADMAP\.md\)`/);
  assert.match(body, /<!-- keep --> \[y\]\(ROADMAP\.md\)/);
  assert.match(body, /\[ref\]: \/docs\/architecture\//);
});

test('transformMarkdown survives MDX-hostile input', () => {
  const md = '# T\n\n{oops} <div> a < b </span> {{x}} <!-- unclosed\n- [~] **Thing**: doing\n';
  const { body } = transformMarkdown(md, { from: 'docs/X.md', pages, repoUrl });
  assert.match(body, /\{oops\}/);
  assert.match(body, /- \[ \] _\(in progress\)_ \*\*Thing\*\*/);
});

const roadmap = `# Roadmap

Markers: \`[ ]\` open

## Milestone 1: Foundation

- [x] Viewer
- [x] **Format**: bike-scene/1

## Milestone 2: Captures

- [~] **Import**: drop a zip
- [ ] **Cache**: keep across reloads
  - [ ] nested sub-item counts too

\`\`\`
- [x] not an item
\`\`\`

## Ideas parking lot

- AR quick look
`;

test('parseRoadmap counts statuses per milestone and skips sections without items', () => {
  const ms = parseRoadmap(roadmap);
  assert.deepEqual(
    ms.map((m) => m.title),
    ['Milestone 1: Foundation', 'Milestone 2: Captures'],
  );
  assert.deepEqual(ms[0].counts, { done: 2, progress: 0, open: 0, total: 2 });
  assert.deepEqual(ms[1].counts, { done: 0, progress: 1, open: 2, total: 3 });
  assert.deepEqual(ms[1].items[0], { status: 'progress', name: 'Import', detail: 'Drop a zip' });
  assert.deepEqual(ms[0].items[0], { status: 'done', name: 'Viewer', detail: '' });
  assert.deepEqual(roadmapTotals(ms), { done: 2, progress: 1, open: 2, total: 5 });
});

test('parseChangelog groups bullets by release and category', () => {
  const md = '# Changelog\n\nIntro.\n\n## Unreleased\n\n### Added\n- New thing (#3)\n  continued\n- Other (#2)\n\n### Fixed\n- Bug\n\n## 0.1.0\n\n- Old\n';
  const rel = parseChangelog(md);
  assert.equal(rel.length, 2);
  assert.equal(rel[0].title, 'Unreleased');
  assert.deepEqual(rel[0].entries, [
    { category: 'Added', text: 'New thing (#3) continued' },
    { category: 'Added', text: 'Other (#2)' },
    { category: 'Fixed', text: 'Bug' },
  ]);
  assert.deepEqual(rel[1].entries, [{ category: '', text: 'Old' }]);
});

test('slugOf', () => {
  assert.equal(slugOf('MANUAL-STEPS.md'), 'manual-steps');
  assert.equal(slugOf('docs/Some Guide.MD'), 'some-guide');
});
