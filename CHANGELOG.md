# Changelog

Every PR adds a line under **Unreleased** (newest first) with its PR number. When the owner
merges the stack to `main`, the Unreleased block becomes a dated release.

## Unreleased

### Added
- Docs & progress site (Fumadocs, `apps/docs`) generated from the repo's markdown: home dashboard with roadmap progress per milestone, latest changes and build commit; "How to test" guide; offline search. `tools/publish-pages.sh` publishes it with the viewer (under `/app/`) and a synthetic test bundle to the `gh-pages` branch; `tools/make-test-bundle.mjs` writes a synthetic `*.bikecapture.zip`. The Actions-based `pages.yml` deploy is removed.
- Capture bundle import: drop an iPhone `*.bikecapture.zip` on the viewer; it is unzipped in the browser, the model loads and the scene is named from the manifest. Re-dropping a bundle restores its comments. (#2)
- Foundation: three.js viewer/editor with areas, pinned sales comments, present mode, background modes, `bike-scene/1` format; iOS Object Capture app skeleton; CI. (#1)
