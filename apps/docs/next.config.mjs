import { createMDX } from 'fumadocs-mdx/next';

// GitHub Pages serves the site from https://davidpn11.github.io/bike-3d-brew/, so every URL is
// prefixed. Set DOCS_BASE_PATH='' to serve from a domain root.
const basePath = (process.env.DOCS_BASE_PATH ?? '/bike-3d-brew').replace(/\/+$/, '');

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  basePath,
  assetPrefix: basePath || undefined,
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  // tools/publish-pages.sh passes the commit, so republishing the same commit is a no-op diff.
  generateBuildId: async () => process.env.DOCS_BUILD_ID || null,
  // Plain <a> links (live demo under /app/, search index) need the prefix on the client too.
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

export default withMDX(config);
