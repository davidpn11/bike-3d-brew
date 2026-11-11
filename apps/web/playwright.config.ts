import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// E2E suite: drives the production build (vite build + vite preview) in Chromium, at desktop
// and iPhone sizes. WebGL runs on SwiftShader so it works on GPU-less CI runners.
// See docs/TESTING.md.

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const PORT = Number(process.env.E2E_PORT ?? 4190);
const CI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  outputDir: `${repoRoot}/test-results`,
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: CI,
  // One retry on CI so a runner hiccup does not block a PR; flaky tests still show up as "flaky" in the report.
  retries: CI ? 1 : 0,
  // SwiftShader rendering is CPU-bound: too many parallel pages starve each other.
  workers: 2,
  // Generous: a page load (shader compile + PMREM on SwiftShader) takes 3–5 s on an idle CI runner
  // but 20+ s on a contended machine, and reload tests load the page twice.
  timeout: 90_000,
  // Web-first assertions return as soon as they pass; the ceiling only matters on slow machines.
  expect: { timeout: 30_000 },
  reporter: CI ? [['github'], ['list'], ['html', { open: 'never', outputFolder: `${repoRoot}/playwright-report` }]] : [['list'], ['html', { open: 'never', outputFolder: `${repoRoot}/playwright-report` }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Camera flights become instant (the app honors prefers-reduced-motion); tests that want the
    // animation opt back in.
    reducedMotion: 'reduce',
    launchOptions: {
      // Locally a preinstalled Chromium can be used instead of `playwright install` (PW_CHROMIUM_PATH).
      executablePath: process.env.PW_CHROMIUM_PATH || undefined,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    // iPhone 14 viewport, touch and user agent, in Chromium (WebKit is not installed on CI runners).
    // DPR 1 instead of 3: SwiftShader renders on the CPU and 9x the pixels made every step crawl.
    // Only the specs where layout and touch matter; file handling and storage are viewport-independent
    // and run on desktop only, which keeps the suite (and CI) fast.
    {
      name: 'mobile',
      testMatch: ['view.spec.ts', 'edit.spec.ts', 'present.spec.ts', 'photos.spec.ts'],
      use: { ...devices['iPhone 14'], deviceScaleFactor: 1, browserName: 'chromium', defaultBrowserType: 'chromium' },
    },
  ],
  webServer: {
    // The production build, like GitHub Pages serves it. E2E_SKIP_BUILD reuses an existing dist/.
    command: `${process.env.E2E_SKIP_BUILD ? '' : 'npx vite build --config apps/web/vite.config.ts && '}npx vite preview --config apps/web/vite.config.ts --port ${PORT} --strictPort`,
    cwd: repoRoot,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
});
