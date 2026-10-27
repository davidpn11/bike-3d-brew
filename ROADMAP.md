# Roadmap

The backlog autonomous sessions work through, top to bottom. Each item is sized for one
session / one PR. Protocol is in [CLAUDE.md](CLAUDE.md#autonomous-session-protocol).

Markers: `[ ]` open · `[~]` in progress (draft PR open) · `[x]` done (in an open or merged PR).

## Milestone 0: Project ops

- [x] **Docs & progress site**: Fumadocs static site (`apps/docs`) generated from the repo's markdown, with a roadmap progress dashboard and a "How to test" guide, published with the viewer to GitHub Pages by `tools/publish-pages.sh` (site at `/bike-3d-brew/`, viewer at `/bike-3d-brew/app/`).
- [ ] **Auto-publish on develop**: a workflow (`contents: write`) that runs `tools/publish-pages.sh --source develop` on every push to `develop`, so the site stays current even when no agent session runs.
- [ ] **PR previews**: publish each open stack PR under `/bike-3d-brew/pr/<n>/` (docs + viewer) and link them from the Progress page, so the owner can test a PR before merging it.

## Milestone 1: Foundation (PR 1)

- [x] Web viewer: three.js, orbit, fly-to areas, background modes (clear / chroma green / studio / dark)
- [x] Scene format `bike-scene/1` with validation, local persistence, import/export
- [x] Areas (hotspots) and sales comments pinned to the model surface, edit + present modes
- [x] Procedural demo bike with seeded areas and comments
- [x] iOS app skeleton: Object Capture (object + area mode), on-device reconstruction, poses, bundle export
- [x] CI: web typecheck/test/build, unsigned iOS build on macOS, Pages deploy workflow

## Milestone 2: Real captures into the viewer

- [x] **Capture bundle import**: drop `*.bikecapture.zip` on the viewer, unzip in the browser (fflate), load `model.usdz`, read `manifest.json` and `poses.json`, name the scene from the manifest. Unit-test the bundle parser with a synthetic zip.
- [x] **Keep captures across reloads**: cache the unzipped model of the last opened bundles in IndexedDB/OPFS (best effort, quota-aware) so a reload reopens a capture scene without re-dropping the `.bikecapture.zip`.
- [ ] **Capture cache on real Safari / iOS**: verify OPFS `createWritable()` vs. the IndexedDB fallback, quota numbers and `persist()` behavior on iPhone Safari and a home-screen web app; tune the 500 MB budget for phones.
- [ ] **Cache large models without a main-thread copy**: write models to OPFS from a worker (`createSyncAccessHandle`) or straight from the dropped `File` stream, so a 300 MB capture does not briefly double memory on phones.
- [x] **USDZ robustness**: three r186 reads binary USDC; `apps/web/src/viewer/usd/` fixes its inline-value decoding, speeds up large meshes ~10×, waits for packed textures and falls back to a `tools/usdz-to-glb.py` hint. Synthetic Object-Capture-like fixtures from `tools/fixtures/make-usdc.py`.
- [ ] **Verify a real Object Capture USDZ**: load a real `model.usdz` (owner's iPhone, see docs/MANUAL-STEPS.md), compare against Quick Look; turn anything off into a fixture-based test (synthetic re-creation, never the capture itself).
- [x] **Weld USDZ meshes**: three expands face-varying meshes to 3 vertices per triangle (~3M vertices for a 1M-triangle capture); identical corners are merged into an indexed geometry (hash-based, typed arrays, O(n)): 2.9M → 0.49M vertices, 89 → 26 MB of geometry on the 1M-triangle fixture. Decimation stays offline (`tools/optimize-glb.mjs --simplify`). See [docs/PERFORMANCE.md](docs/PERFORMANCE.md).
- [ ] **Auto-orient captures**: detect the ground plane / longest horizontal axis so a scanned bike stands upright facing +X; expose rotate/scale/offset controls in Edit mode (writes `model.rotation/scale/offset`).
- [ ] **Crop box for area-mode / splat captures**: draggable box in Edit mode that clips everything outside (clipping planes), saved in the scene, so area-mode scans get a clean background.
- [x] **Photo close-ups per area**: use `poses.json` to find the capture photos that look most directly at each area target (angle + distance score) and show them as a filmstrip under the area; tap to open full screen. HEIC → JPEG conversion at export time on iOS if browsers can't decode HEIC.
- [ ] **iOS JPEG photo export**: write `images/*.jpg` (or a `photos/` folder of 2048 px JPEGs) next to the HEICs in the bundle so Chrome/Firefox skip the 2 MB WASM HEIC decoder and decoding is instant; the web side already prefers whatever decodes natively.
- [ ] **Validate close-ups on a real capture**: confirm Object Capture poses share the USDZ frame and the 65° landscape intrinsics assumption (portrait captures, EXIF rotation); read real intrinsics if the iOS app can export them.
- [ ] **Occlusion-aware close-ups**: raycast from each candidate camera to the target against the loaded mesh and drop photos where the bike hides it.
- [ ] **Pin favourite close-ups**: let staff star photos for an area (the schema already has `Hotspot.photos`) and show starred ones first, also in shared links.

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
- [x] **Performance**: Draco/Meshopt compression, KTX2 textures, lazy loading, 60 fps on iPhone Safari with 50 pins. Lazily loaded, self-hosted decoders; `tools/optimize-glb.mjs`; BVH picking/occlusion in a worker; budgeted pin updates; device-aware quality (`?quality=low|high`); `tools/bench/` benchmark. See [docs/PERFORMANCE.md](docs/PERFORMANCE.md).
- [ ] **Measure on a real iPhone**: first model visible, fps while orbiting with 50 pins and idle CPU in iPhone Safari over 4G (Web Inspector timeline), for a real 20 MB capture and its `optimize-glb` output; record them in docs/PERFORMANCE.md next to the SwiftShader numbers.
- [ ] **Runtime decimation for phones**: lazy-load meshoptimizer's simplifier (in a worker) and simplify captures above ~500k triangles on handhelds behind the quality setting, if real-device numbers show the GPU, not fill rate, is the limit.
- [ ] **KTX2/Basis E2E**: an ETC1S/UASTC fixture (needs a Basis encoder in Node, e.g. a WASM build) so the transcoder path is exercised in CI, not only raw KTX2.
- [ ] **Progressive capture loading**: show a coarse proxy (or the GLB's first LOD) while a big USDZ parses, and parse/weld it in a worker so the page stays responsive on phones.
- [x] **E2E tests**: Playwright suite (desktop + iPhone viewport, SwiftShader WebGL) covering view, edit, present, export/import, capture-bundle drop and re-drop, error toasts, blocked storage, snapshot; synthetic capture-bundle fixture generator; unit coverage with ratcheting thresholds; CI jobs. See [docs/TESTING.md](docs/TESTING.md).
- [ ] **E2E coverage for app code**: collect V8 coverage from Chromium during the Playwright run (`page.coverage`) and merge it with the unit report, so `ui/app.ts`, `Viewer.ts` and `main.ts` count toward the coverage ratchet.
- [x] **Render on demand**: only render when the camera, model or pins change (idle stage at 0 fps). Saves phone battery and makes the E2E suite much faster on SwiftShader (today every frame costs ~150–250 ms on CPU).
- [ ] **WebKit E2E project**: run the suite in Playwright WebKit (closest to iPhone Safari) on a macOS runner or with WebKit's Linux deps; the `mobile` project is Chromium with an iPhone viewport today.
- [ ] **Move USDZ loading to `USDLoader`**: three r186 deprecates `USDZLoader` (console warning on every capture); `USDLoader` reads the same files.
- [ ] **Docs**: end-to-end guide with screenshots: capture → build → export → annotate → share.

## Ideas parking lot

- AR "place the bike in your room" via Quick Look (`model.usdz` + `<a rel="ar">`).
- Compare two bikes side by side.
- Size guide overlay (rider silhouette to scale).
- Measure tool (tap two points → distance in mm).
