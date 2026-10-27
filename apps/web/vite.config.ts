import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  // Relative base so the build works from GitHub Pages or any sub-path.
  base: './',
  server: { port: 5190, host: true },
  build: { outDir: '../../dist', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
  test: {
    root,
    include: ['test/**/*.test.ts'],
    // Most tests are pure logic; DOM tests opt in with `// @vitest-environment happy-dom`.
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Need WebGL / the whole page: covered by the Playwright suite in apps/web/e2e instead.
      exclude: ['src/main.ts', 'src/ui/app.ts', 'src/viewer/Viewer.ts'],
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: '../../coverage',
      // Ratchet: set just under the current numbers. Raise them when coverage goes up; never lower.
      thresholds: {
        lines: 99,
        statements: 98,
        functions: 97,
        branches: 93,
        'src/scene/**': { lines: 99, statements: 97, functions: 97, branches: 94 },
      },
    },
  },
});
