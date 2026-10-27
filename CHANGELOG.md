# Changelog

Every PR adds a line under **Unreleased** (newest first) with its PR number. When the owner
merges the stack to `main`, the Unreleased block becomes a dated release.

## Unreleased

### Added
- Captures survive reloads: opened `*.bikecapture.zip` bundles are kept in browser storage (OPFS, IndexedDB fallback, LRU under a quota-aware budget) and reopen automatically; "Open…" lists stored captures with size and a forget button. Synthetic fixture generator in `tools/fixtures/`. (#5)
- Docs & progress site (Fumadocs, `apps/docs`) generated from the repo's markdown: home dashboard with roadmap progress per milestone, latest changes and build commit; "How to test" guide; offline search. `tools/publish-pages.sh` publishes it with the viewer (under `/app/`) and a synthetic test bundle to the `gh-pages` branch; `tools/make-test-bundle.mjs` writes a synthetic `*.bikecapture.zip`. The Actions-based `pages.yml` deploy is removed. (#4)
- USDZ robustness: Object Capture USDZ (binary USDC) loads with textures; fixes three.js r186 crate decoding of inline vectors/halves/negative ints, ~10× faster mesh build for large captures, lazy-loaded USD code, clear fallback to `tools/usdz-to-glb.py`. Synthetic fixture generator `tools/fixtures/make-usdc.py`. (#3)
- Capture bundle import: drop an iPhone `*.bikecapture.zip` on the viewer; it is unzipped in the browser, the model loads and the scene is named from the manifest. Re-dropping a bundle restores its comments. (#2)
- Foundation: three.js viewer/editor with areas, pinned sales comments, present mode, background modes, `bike-scene/1` format; iOS Object Capture app skeleton; CI. (#1)
