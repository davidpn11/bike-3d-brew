# Changelog

Every PR adds a line under **Unreleased** (newest first) with its PR number. When the owner
merges the stack to `main`, the Unreleased block becomes a dated release.

## Unreleased

### Added
- USDZ robustness: Object Capture USDZ (binary USDC) loads with textures; fixes three.js r186 crate decoding of inline vectors/halves/negative ints, ~10× faster mesh build for large captures, lazy-loaded USD code, clear fallback to `tools/usdz-to-glb.py`. Synthetic fixture generator `tools/fixtures/make-usdc.py`.
- Capture bundle import: drop an iPhone `*.bikecapture.zip` on the viewer; it is unzipped in the browser, the model loads and the scene is named from the manifest. Re-dropping a bundle restores its comments. (#2)
- Foundation: three.js viewer/editor with areas, pinned sales comments, present mode, background modes, `bike-scene/1` format; iOS Object Capture app skeleton; CI. (#1)
