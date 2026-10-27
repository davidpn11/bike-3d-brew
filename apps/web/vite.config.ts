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
      // Only what cannot run in Node; each is exercised by the Playwright suite (apps/web/e2e).
      exclude: [
        'src/main.ts', // page bootstrap: needs the whole DOM + WebGL
        'src/ui/app.ts', // UI controller over the WebGL Viewer
        'src/viewer/Viewer.ts', // WebGLRenderer, OrbitControls
        'src/ui/heic.worker.ts', // Web Worker running libheif WASM
        'src/**/*.d.ts', // type declarations only
      ],
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: '../../coverage',
      // Ratchet: set just under the current numbers. Raise them when coverage goes up; never lower.
      thresholds: {
        lines: 99.5,
        statements: 98.5,
        functions: 97.5,
        branches: 92,
        'src/scene/**': { lines: 99.5, statements: 98, functions: 96.5, branches: 93 },
      },
    },
  },
});
