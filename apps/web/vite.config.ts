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
    environment: 'node',
  },
});
