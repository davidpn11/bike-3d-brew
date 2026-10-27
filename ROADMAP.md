# Roadmap

The backlog autonomous sessions work through, top to bottom. Each item is sized for one
session / one PR. Protocol is in [CLAUDE.md](CLAUDE.md#autonomous-session-protocol).

Markers: `[ ]` open · `[~]` in progress (draft PR open) · `[x]` done (in an open or merged PR).

## Milestone 1: Foundation (PR 1)

- [x] Web viewer: three.js, orbit, fly-to areas, background modes (clear / chroma green / studio / dark)
- [x] Scene format `bike-scene/1` with validation, local persistence, import/export
- [x] Areas (hotspots) and sales comments pinned to the model surface, edit + present modes
- [x] Procedural demo bike with seeded areas and comments
- [x] iOS app skeleton: Object Capture (object + area mode), on-device reconstruction, poses, bundle export
- [x] CI: web typecheck/test/build, unsigned iOS build on macOS, Pages deploy workflow

## Milestone 2: Real captures into the viewer

- [~] **Capture bundle import**: drop `*.bikecapture.zip` on the viewer, unzip in the browser (fflate), load `model.usdz`, read `manifest.json` and `poses.json`, name the scene from the manifest. Unit-test the bundle parser with a synthetic zip.
- [ ] **USDZ robustness**: verify three.js `USDZLoader` against an Object Capture USDZ (binary USDC inside). If unsupported, document and add `tools/usdz-to-glb.py` (Blender headless) plus a clear in-app message. Add a small sample USDZ fixture if licensing allows (generate one, never commit customer captures).
- [ ] **Auto-orient captures**: detect the ground plane / longest horizontal axis so a scanned bike stands upright facing +X; expose rotate/scale/offset controls in Edit mode (writes `model.rotation/scale/offset`).
- [ ] **Crop box for area-mode / splat captures**: draggable box in Edit mode that clips everything outside (clipping planes), saved in the scene, so area-mode scans get a clean background.
- [ ] **Photo close-ups per area**: use `poses.json` to find the capture photos that look most directly at each area target (angle + distance score) and show them as a filmstrip under the area; tap to open full screen. HEIC → JPEG conversion at export time on iOS if browsers can't decode HEIC.

## Milestone 3: Sales experience

- [ ] **Shareable read-only link**: `?scene=` URL loads a published scene in Present mode with editing hidden; "Copy share link" button. Scenes + models served from `apps/web/public/scenes/<id>/`.
- [ ] **Comment polish**: leader lines from pin to card in Present mode, auto-advance/kiosk mode, comment ordering (drag to reorder), markdown-lite (bold, bullet lists) in bodies.
- [ ] **Hotspot auto-suggest**: for captures, propose default areas (Fork, Drivetrain, Cockpit, Wheels, Saddle) by letting the user tap each part once; camera view computed from tapped point + local bounds.
- [ ] **Spec sheet**: per-bike key specs table (frame material, groupset, weight, sizes) shown in Present mode intro and exported.
- [ ] **Branding**: shop logo, accent color and font in scene settings; applied to Present mode.
- [ ] **Snapshot / video export**: high-res PNG with transparent or green background; 360° turntable WebM via MediaRecorder for social posts.
- [ ] **Accessibility & i18n pass**: keyboard navigation for pins, focus states, screen-reader labels, number/currency formatting.

## Milestone 4: iOS app depth

- [ ] **In-app viewer**: RealityKit/SceneKit view of `model.usdz` with the same areas and comments (read `bike-scene/1` JSON), so sales staff can present from the phone offline.
- [ ] **Capture guidance for bikes**: checklist overlay (3 orbits: hub height, saddle height, top-down; close-ups of fork crown, dropouts, rear derailleur, cockpit), shot counter per pass, tips for reflective paint (dulling spray / polarizer), turntable support.
- [ ] **Mac high-detail reconstruction**: `tools/mac-reconstruct` Swift CLI running `PhotogrammetrySession` at `.full` / `.raw` detail from an exported bundle, writing `model.usdz` + `poses.json` back.
- [ ] **On-device GLB export**: convert the USDZ to GLB (ModelIO → glTF writer) so the web viewer never needs conversion.
- [ ] **Upload to viewer**: share sheet target / direct upload of bundles to the web app storage (see Milestone 5).

## Milestone 5: Backend & multi-bike catalog

- [ ] **Catalog page**: list of bikes (cards with turntable thumbnails), search/filter, each opening its scene.
- [ ] **Storage**: decide (Cloudflare R2 + Workers, or Supabase) and document; upload bundles, store scenes, auth for editors, public read for shared links.
- [ ] **Collaborative comments**: multiple staff editing comments; history.

## Milestone 6: Quality

- [ ] **Gaussian splat support**: load `.spz` / splat `.ply` (Scaniverse, Polycam, Luma) via Spark (`@sparkjsdev/spark`) for photoreal paint and chrome; crop box + pins work the same.
- [ ] **Performance**: Draco/Meshopt compression, KTX2 textures, lazy loading, 60 fps on iPhone Safari with 50 pins.
- [ ] **E2E tests**: Playwright smoke test (load demo, fly to Fork, add comment, export JSON) in CI.
- [ ] **Docs**: end-to-end guide with screenshots: capture → build → export → annotate → share.

## Ideas parking lot

- AR "place the bike in your room" via Quick Look (`model.usdz` + `<a rel="ar">`).
- Compare two bikes side by side.
- Size guide overlay (rider silhouette to scale).
- Measure tool (tap two points → distance in mm).
