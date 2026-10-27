# Changelog

Every PR adds a line under **Unreleased** (newest first) with its PR number. When the owner
merges the stack to `main`, the Unreleased block becomes a dated release.

## Unreleased

### Added
- Test system: Playwright E2E suite (`npm run e2e`, desktop + iPhone viewport) over the production build, synthetic capture-bundle fixtures (`tools/fixtures/make-capture-bundle.mjs`), unit coverage with ratcheting thresholds (`npm run test:coverage`), `e2e` CI job, `docs/TESTING.md`. UI decisions moved into tested `scene/helpers.ts`; `?e2e` test hook. (#TBD)
- Capture bundle import: drop an iPhone `*.bikecapture.zip` on the viewer; it is unzipped in the browser, the model loads and the scene is named from the manifest. Re-dropping a bundle restores its comments. (#2)
- Foundation: three.js viewer/editor with areas, pinned sales comments, present mode, background modes, `bike-scene/1` format; iOS Object Capture app skeleton; CI. (#1)
