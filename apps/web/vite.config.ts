import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  // Relative base so the build works from GitHub Pages or any sub-path.
  base: './',
  server: { port: 5190, host: true },
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      // The app, the iframe embed and its demo page; `bike-viewer.js` keeps a stable name so shops can link it.
      input: { main: `${root}index.html`, embed: `${root}embed.html`, 'embed-demo': `${root}embed-demo.html`, proto: `${root}proto.html`, 'bike-viewer': `${root}src/present/element.ts` },
      output: { entryFileNames: (chunk) => (chunk.name === 'bike-viewer' ? 'bike-viewer.js' : 'assets/[name]-[hash].js') },
    },
    // E2E_COVERAGE=1 (bun run e2e:coverage): source maps and readable code, so V8 coverage maps back to src/ precisely.
    ...(process.env.E2E_COVERAGE ? { sourcemap: true, minify: false } : {}),
  },
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
        'src/entry.ts', // picks the editor or customer chunk from the URL
        'src/present/BikePresenter.ts', // customer presenter over the WebGL Viewer (e2e/share.spec.ts)
        'src/present/customer.ts', // customer page bootstrap
        'src/present/embed.ts', // iframe page bootstrap + postMessage bridge (e2e/embed.spec.ts)
        'src/present/element.ts', // <bike-viewer> custom element (e2e/embed.spec.ts)
        'src/ui/heic.worker.ts', // Web Worker running libheif WASM
        'src/proto/**', // phase 0 clickable prototype with made-up data, covered by e2e/proto*.spec.ts
        'src/**/*.d.ts', // type declarations only
      ],
      // json: coverage-final.json, merged with the E2E report by tools/coverage/e2e-coverage.mjs.
      reporter: ['text', 'html', 'json-summary', 'json'],
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
