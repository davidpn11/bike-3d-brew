export const appName = 'bike-3d-brew';
export const repoUrl = 'https://github.com/davidpn11/bike-3d-brew';
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
/** The Vite viewer is published next to the docs, at <basePath>/app/ (not a Next route). */
export const demoUrl = `${basePath}/app/`;
/** Where the main site lives: basePath, except in PR previews, which sit at <siteRoot>/pr/<n>/. */
export const siteRoot = process.env.NEXT_PUBLIC_SITE_ROOT ?? basePath;
