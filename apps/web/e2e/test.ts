import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { type Page, test as base } from '@playwright/test';
import { RAW_DIR } from '../../../tools/coverage/e2e-coverage.mjs';

export { expect, type Page } from '@playwright/test';

type ProcessCov = { result: { scriptId: string; url: string; functions: unknown[] }[] };
const { mergeProcessCovs } = createRequire(import.meta.url)('@bcoe/v8-coverage') as { mergeProcessCovs(covs: ProcessCov[]): ProcessCov };

/**
 * Playwright's `test`, plus V8 coverage of the app bundle when E2E_COVERAGE=1 (Chromium only).
 * Each worker merges its tests' coverage in memory and writes one file at the end, so the raw data
 * stays small; the global teardown turns it into an Istanbul report (tools/coverage/e2e-coverage.mjs).
 */
export const test = base.extend<{ page: Page }, { v8: ProcessCov }>({
  v8: [
    async ({}, use) => {
      const acc: ProcessCov = { result: [] };
      await use(acc);
      if (!acc.result.length) return;
      mkdirSync(RAW_DIR, { recursive: true });
      writeFileSync(join(RAW_DIR, `${randomUUID()}.json`), JSON.stringify(acc));
    },
    { scope: 'worker' },
  ],
  page: async ({ page, browserName, v8 }, use) => {
    if (!process.env.E2E_COVERAGE || browserName !== 'chromium') return use(page);
    // Keep counts across reloads: several tests reload to check persistence.
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    await use(page);
    const entries = await page.coverage.stopJSCoverage().catch(() => []);
    const app = entries
      .map((e) => ({ ...e, path: URL.canParse(e.url) ? new URL(e.url).pathname : '' }))
      .filter((e) => e.path.startsWith('/assets/') && e.path.endsWith('.js'))
      .map((e) => ({ scriptId: e.scriptId, url: e.path, functions: e.functions }));
    v8.result = mergeProcessCovs([v8, { result: app }]).result;
  },
});
