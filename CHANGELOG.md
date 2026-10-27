# Changelog

Every PR adds a line under **Unreleased** (newest first) with its PR number. When the owner
merges the stack to `main`, the Unreleased block becomes a dated release.

## Unreleased

### Added
- Crop box: Edit → Model → Crop clips everything outside an axis-aligned box (model-root space, saved as optional `crop` in `bike-scene/1`) with renderer clipping planes; drag the face handles (mouse or touch) or type the corners; "Fit to bike" removes the floor slab and background clusters. Cropped-away geometry can't take comments, and comments outside the box are hidden. Area-mode captures get a suggested box and a hint. (#9)
- Auto-orient captures: a scanned bike is stood upright facing +X (PCA + side-view ground line, bike-shaped sign heuristics) on first load, with a toast; Edit → Model has Auto-orient, rotate ±90° per axis, flip, turn 180°, scale, real length in cm, 1 cm nudges, on-ground, undo and reset. Comments stay attached. `tools/fixtures/make-bike-capture.mjs` generates tilted test bundles. (#8)
- Test system: Playwright E2E suite (`npm run e2e`, desktop + iPhone viewport) over the production build, synthetic capture-bundle fixtures (`tools/fixtures/make-capture-bundle.mjs`), unit coverage with ratcheting thresholds (`npm run test:coverage`), `e2e` CI job, `docs/TESTING.md`. UI decisions moved into tested `scene/helpers.ts`; `?e2e` test hook. (#7)
- Photo close-ups: for the active area, the active comment and each Present step, a filmstrip of the capture photos that best show it (ranked from `poses.json`), with a full-screen viewer (swipe, arrows, pinch/zoom). Photos are read lazily from the zip, HEIC is decoded natively or by a lazily loaded WASM worker, and thumbnails are kept in the capture cache. (#6)
- Captures survive reloads: opened `*.bikecapture.zip` bundles are kept in browser storage (OPFS, IndexedDB fallback, LRU under a quota-aware budget) and reopen automatically; "Open…" lists stored captures with size and a forget button. Synthetic fixture generator in `tools/fixtures/`. (#5)
- Docs & progress site (Fumadocs, `apps/docs`) generated from the repo's markdown: home dashboard with roadmap progress per milestone, latest changes and build commit; "How to test" guide; offline search. `tools/publish-pages.sh` publishes it with the viewer (under `/app/`) and a synthetic test bundle to the `gh-pages` branch; `tools/make-test-bundle.mjs` writes a synthetic `*.bikecapture.zip`. The Actions-based `pages.yml` deploy is removed. (#4)
- USDZ robustness: Object Capture USDZ (binary USDC) loads with textures; fixes three.js r186 crate decoding of inline vectors/halves/negative ints, ~10× faster mesh build for large captures, lazy-loaded USD code, clear fallback to `tools/usdz-to-glb.py`. Synthetic fixture generator `tools/fixtures/make-usdc.py`. (#3)
- Capture bundle import: drop an iPhone `*.bikecapture.zip` on the viewer; it is unzipped in the browser, the model loads and the scene is named from the manifest. Re-dropping a bundle restores its comments. (#2)
- Foundation: three.js viewer/editor with areas, pinned sales comments, present mode, background modes, `bike-scene/1` format; iOS Object Capture app skeleton; CI. (#1)

### Fixed
- The active comment pin (and the draft pin) drifted away from its point by 25% of its screen position because CSS `scale` also scaled the position transform. (#8)
