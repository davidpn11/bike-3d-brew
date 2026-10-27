# Changelog

Every PR adds a line under **Unreleased** (newest first) with its PR number. When the owner
merges the stack to `main`, the Unreleased block becomes a dated release.

## Unreleased

### Added
- Captures survive reloads: opened `*.bikecapture.zip` bundles are kept in browser storage (OPFS, IndexedDB fallback, LRU under a quota-aware budget) and reopen automatically; "Open…" lists stored captures with size and a forget button. Synthetic fixture generator in `tools/fixtures/`.
- Capture bundle import: drop an iPhone `*.bikecapture.zip` on the viewer; it is unzipped in the browser, the model loads and the scene is named from the manifest. Re-dropping a bundle restores its comments. (#2)
- Foundation: three.js viewer/editor with areas, pinned sales comments, present mode, background modes, `bike-scene/1` format; iOS Object Capture app skeleton; CI. (#1)
