# Changelog

Every PR adds a line under **Unreleased** (newest first) with its PR number. When the owner
merges the stack to `main`, the Unreleased block becomes a dated release.

## Unreleased

### Added
- Performance: the viewer renders on demand (an idle stage draws 0 frames, the loop pauses in hidden tabs), redraws the shadow map only when the scene changes, caps the pixel ratio per device (`?quality=low|high`), welds USDZ meshes into indexed geometry (2.9M → 0.49M vertices on a 1M-triangle capture), builds a BVH in a worker so picking and pin occlusion cost ~0.05 ms instead of ~200 ms, and updates 50+ pins with budgeted occlusion and transform-only writes. GLBs with Meshopt, Draco or KTX2 load with lazily fetched, self-hosted decoders; `tools/optimize-glb.mjs` makes phone-friendly GLBs; `tools/bench/bench.mjs` measures it all. See `docs/PERFORMANCE.md`. (#TBD)
- Test system: Playwright E2E suite (`npm run e2e`, desktop + iPhone viewport) over the production build, synthetic capture-bundle fixtures (`tools/fixtures/make-capture-bundle.mjs`), unit coverage with ratcheting thresholds (`npm run test:coverage`), `e2e` CI job, `docs/TESTING.md`. UI decisions moved into tested `scene/helpers.ts`; `?e2e` test hook. (#7)
- Photo close-ups: for the active area, the active comment and each Present step, a filmstrip of the capture photos that best show it (ranked from `poses.json`), with a full-screen viewer (swipe, arrows, pinch/zoom). Photos are read lazily from the zip, HEIC is decoded natively or by a lazily loaded WASM worker, and thumbnails are kept in the capture cache. (#6)
- Captures survive reloads: opened `*.bikecapture.zip` bundles are kept in browser storage (OPFS, IndexedDB fallback, LRU under a quota-aware budget) and reopen automatically; "Open…" lists stored captures with size and a forget button. Synthetic fixture generator in `tools/fixtures/`. (#5)
- Docs & progress site (Fumadocs, `apps/docs`) generated from the repo's markdown: home dashboard with roadmap progress per milestone, latest changes and build commit; "How to test" guide; offline search. `tools/publish-pages.sh` publishes it with the viewer (under `/app/`) and a synthetic test bundle to the `gh-pages` branch; `tools/make-test-bundle.mjs` writes a synthetic `*.bikecapture.zip`. The Actions-based `pages.yml` deploy is removed. (#4)
- USDZ robustness: Object Capture USDZ (binary USDC) loads with textures; fixes three.js r186 crate decoding of inline vectors/halves/negative ints, ~10× faster mesh build for large captures, lazy-loaded USD code, clear fallback to `tools/usdz-to-glb.py`. Synthetic fixture generator `tools/fixtures/make-usdc.py`. (#3)
- Capture bundle import: drop an iPhone `*.bikecapture.zip` on the viewer; it is unzipped in the browser, the model loads and the scene is named from the manifest. Re-dropping a bundle restores its comments. (#2)
- Foundation: three.js viewer/editor with areas, pinned sales comments, present mode, background modes, `bike-scene/1` format; iOS Object Capture app skeleton; CI. (#1)
