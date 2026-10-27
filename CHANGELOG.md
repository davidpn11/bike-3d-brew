# Changelog

Every PR adds a line under **Unreleased** (newest first) with its PR number. When the owner
merges the stack to `main`, the Unreleased block becomes a dated release.

## Unreleased

### Added
- Auto-orient captures: a scanned bike is stood upright facing +X (PCA + side-view ground line, bike-shaped sign heuristics) on first load, with a toast; Edit → Model has Auto-orient, rotate ±90° per axis, flip, turn 180°, scale, real length in cm, 1 cm nudges, on-ground, undo and reset. Comments stay attached. `tools/fixtures/make-bike-capture.mjs` generates tilted test bundles. (#TBD)
- Capture bundle import: drop an iPhone `*.bikecapture.zip` on the viewer; it is unzipped in the browser, the model loads and the scene is named from the manifest. Re-dropping a bundle restores its comments. (#2)
- Foundation: three.js viewer/editor with areas, pinned sales comments, present mode, background modes, `bike-scene/1` format; iOS Object Capture app skeleton; CI. (#1)

### Fixed
- The active comment pin (and the draft pin) drifted away from its point by 25% of its screen position because CSS `scale` also scaled the position transform. (#TBD)
