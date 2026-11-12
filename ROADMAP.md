# Roadmap

The backlog autonomous sessions work through, top to bottom. Each item is sized for one
session / one PR. Protocol is in [AGENTS.md](AGENTS.md#autonomous-session-protocol).

Markers: `[ ]` open · `[~]` in progress (draft PR open) · `[x]` done (in an open or merged PR).

## Milestone 0: Project ops

- [x] **Docs & progress site**: Fumadocs static site (`apps/docs`) generated from the repo's markdown, with a roadmap progress dashboard and a "How to test" guide, published with the viewer to GitHub Pages by `tools/publish-pages.sh` (site at `/bike-3d-brew/`, viewer at `/bike-3d-brew/app/`).
- [x] **Auto-publish on develop**: a workflow (`contents: write`) that runs `tools/publish-pages.sh --source develop` on every push to `develop`, so the site stays current even when no agent session runs.
- [x] **PR previews**: publish each open stack PR under `/bike-3d-brew/pr/<n>/` (docs + viewer) and link them from the Progress page, so the owner can test a PR before merging it.
- [x] **Prune stale previews**: a scheduled job that removes `/pr/<n>/` for PRs that are no longer open (a missed or failed close run leaves them behind), and squashes gh-pages history once it grows large (each preview adds a full site copy to the branch). Done: `prune-previews.yml` runs daily and removes the preview of every closed PR; when gh-pages passes 200 commits it squashes the history, pushing with `--force-with-lease` on the base it read.
- [x] **Preview link on the PR**: comment (or update one sticky comment) on each PR with its preview URL, so the owner can open it from the GitHub app. Done: `pr-preview.yml` keeps one sticky comment (marker `<!-- pr-preview -->`) with the Docs and Viewer links on each PR.
- [x] **Bun as package manager**: Bun 1.4.4 with frozen root and docs locks, Bun scripts in CI/Pages/Orca and repo docs; Node 22 stays the runtime. Done: [docs/BUN-MIGRATION.md](docs/BUN-MIGRATION.md).

## Milestone 1: Foundation (PR 1)

- [x] Web viewer: three.js, orbit, fly-to areas, background modes (clear / chroma green / studio / dark)
- [x] Scene format `bike-scene/1` with validation, local persistence, import/export
- [x] Areas (hotspots) and sales comments pinned to the model surface, edit + present modes
- [x] Procedural demo bike with seeded areas and comments
- [x] iOS app skeleton: Object Capture (object + area mode), on-device reconstruction, poses, bundle export
- [x] CI: web typecheck/test/build, unsigned iOS build on macOS, Pages deploy workflow

## Milestone 1.5: Photos & video → 3D

Top priority: any photo set or video of a bike (any camera) must become a `bike-capture/1` bundle the viewer opens. Research and recommendation: [docs/RECONSTRUCTION.md](docs/RECONSTRUCTION.md).

- [x] **Reconstruction research**: options for bikes (Object Capture on macOS, COLMAP + OpenMVS, Meshroom, Gaussian splats, cloud APIs, AI image-to-3D), recommendation, photo and video capture protocols, owner decisions (docs/MANUAL-STEPS.md). Vendor prices/terms still to verify against current pages.
- [ ] **`ingest` CLI** (`tools/reconstruct/`, Node/TS + ffmpeg): photos and videos → sharp, deduplicated, EXIF-upright JPEG frames (variance-of-Laplacian sharpness + novelty selection, 80–200 frames), HEIC → JPEG, coverage report; unit-tested scoring.
- [x] **COLMAP → `bike-poses/1` conversion**: parse `cameras.txt`/`images.txt`/`points3D.txt`, world→camera OpenCV axes → camera→model −Z/+Y, with tests on synthetic COLMAP output generated from ground truth. Done: `tools/reconstruct/colmap.mjs` (`cli.mjs poses`), round-trip + reprojection tests in `apps/web/test/reconstruct.test.ts`; each sample also carries the COLMAP intrinsics as `camera`.
- [x] **COLMAP binary models**: read `cameras.bin`/`images.bin`/`points3D.bin` directly (skip `model_converter`); TXT wins when both exist; points are optional and a missing or bad `points3D` gives a warning, not a failure. Done: `tools/reconstruct/colmap.mjs` reads the binary records with bounds checks, `apps/web/test/reconstruct.test.ts` checks that binary and TXT give the same poses and rejects truncated records.
- [ ] **Real COLMAP run**: check the converter on a real `colmap automatic_reconstructor` run over rendered fixture photos (part of the synthetic end-to-end eval).
- [x] **Real intrinsics in close-ups**: use `poses.json` `samples[].camera` (fx, fy, width, height) in `scene/photos.ts` ranking instead of the 65° iPhone assumption when present. Done: `sampleIntrinsics()` gives each sample its own horizontal FOV and aspect, bounds-checked (bad values fall back to 65°); the halo/frame test per photo uses that sample's diagonal. Tested in `apps/web/test/photos.test.ts`.
- [ ] **`reconstruct --backend colmap`**: COLMAP + OpenMVS via `tools/reconstruct/docker/` (and native), dense mesh + texture, crop the mesh to the dominant object, optional photo masking (rembg).
- [ ] **`reconstruct --backend object-capture`**: Swift CLI `tools/reconstruct/macos/` (`PhotogrammetrySession` over an image folder → `model.usdz` + poses), built by a path-filtered macos-latest CI job.
- [x] **`package`**: result → `bike-capture/1` zip (GLB model, `poses.json`, `images/*.jpg`, manifest with `source: photos|video` and `backend`). Done: `tools/reconstruct/package.mjs` (`cli.mjs package`), the zip is checked through the viewer's own `readCaptureBundle` in a unit test; the web manifest parser keeps `source`/`backend`.
- [ ] **`package` polish**: convert OpenMVS OBJ/PLY to GLB (gltf-transform) and decimate for the web (`tools/optimize-glb.mjs`), crop the mesh to the dominant object, resize frames to ≤ 2048 px; show `source`/`backend` in the viewer's capture info.
- [ ] **Synthetic end-to-end eval**: render the fixture bike with texture + textured floor from 60–120 posed cameras and as an orbit video (`tools/fixtures/render-photos.mjs`), run ingest → reconstruct → package, measure pose error after similarity alignment, Chamfer distance / completeness vs ground truth and close-up ranking; report in `docs/RECONSTRUCTION-EVAL.md`.
- [ ] **Web upload flow**: drop a folder of photos or a video on the viewer, send it to a reconstruction backend, open the result.
- [ ] **Cloud backend**: one paid API behind `reconstruct --backend <vendor>` once the owner picks a vendor and budget.
- [ ] **Splats from video**: COLMAP poses + gsplat/nerfstudio → `.spz`, opened through the M6 splat support.

## Milestone 2: Real captures into the viewer

- [x] **Capture bundle import**: drop `*.bikecapture.zip` on the viewer, unzip in the browser (fflate), load `model.usdz`, read `manifest.json` and `poses.json`, name the scene from the manifest. Unit-test the bundle parser with a synthetic zip.
- [x] **Keep captures across reloads**: cache the unzipped model of the last opened bundles in IndexedDB/OPFS (best effort, quota-aware) so a reload reopens a capture scene without re-dropping the `.bikecapture.zip`.
- [ ] **Capture cache on real Safari / iOS**: verify OPFS `createWritable()` vs. the IndexedDB fallback, quota numbers and `persist()` behavior on iPhone Safari and a home-screen web app; tune the 500 MB budget for phones.
- [ ] **Cache large models without a main-thread copy**: write models to OPFS from a worker (`createSyncAccessHandle`) or straight from the dropped `File` stream, so a 300 MB capture does not briefly double memory on phones.
- [x] **USDZ robustness**: three r186 reads binary USDC; `apps/web/src/viewer/usd/` fixes its inline-value decoding, speeds up large meshes ~10×, waits for packed textures and falls back to a `tools/usdz-to-glb.py` hint. Synthetic Object-Capture-like fixtures from `tools/fixtures/make-usdc.py`.
- [ ] **Verify a real Object Capture USDZ**: load a real `model.usdz` (owner's iPhone, see docs/MANUAL-STEPS.md), compare against Quick Look; turn anything off into a fixture-based test (synthetic re-creation, never the capture itself).
- [x] **Weld USDZ meshes**: three expands face-varying meshes to 3 vertices per triangle (~3M vertices for a 1M-triangle capture); identical corners are merged into an indexed geometry (hash-based, typed arrays, O(n)): 2.9M → 0.49M vertices, 89 → 26 MB of geometry on the 1M-triangle fixture. Decimation stays offline (`tools/optimize-glb.mjs --simplify`). See [docs/PERFORMANCE.md](docs/PERFORMANCE.md).
- [x] **Auto-orient captures**: detect the ground plane / longest horizontal axis so a scanned bike stands upright facing +X; expose rotate/scale/offset controls in Edit mode (writes `model.rotation/scale/offset`).
- [ ] **Auto-orient on real scans**: check the up/front heuristics (`scene/orient.ts`) against real Object Capture bikes (flat bars, kids' bikes, e-bikes with a battery, kickstands); tune the vote weights and add the cases as generated test fixtures.
- [x] **Crop box for area-mode / splat captures**: draggable box in Edit mode that clips everything outside (clipping planes), saved in the scene, so area-mode scans get a clean background.
- [ ] **Crop polish**: a rotatable (oriented) crop box for scans whose model-root axes are tilted; a floor-height handle that also re-grounds; show how many comments the crop hides.
- [x] **Photo close-ups per area**: use `poses.json` to find the capture photos that look most directly at each area target (angle + distance score) and show them as a filmstrip under the area; tap to open full screen. HEIC → JPEG conversion at export time on iOS if browsers can't decode HEIC.
- [x] **iOS JPEG photo export**: write `images/*.jpg` (or a `photos/` folder of 2048 px JPEGs) next to the HEICs in the bundle so Chrome/Firefox skip the 2 MB WASM HEIC decoder and decoding is instant; the web side already prefers whatever decodes natively. Done: `photos/*.jpg` (2048 px, upright) + `manifest.photos`; the web reader uses them when present.
- [ ] **Drop the WASM HEIC decoder**: once every exported bundle has `photos/`, remove `libheif-js` (LGPL) or keep it only for old bundles; also check the exported zip size growth (~0.5 MB per photo) on a real capture.
- [ ] **Validate close-ups on a real capture**: confirm Object Capture poses share the USDZ frame and the 65° landscape intrinsics assumption (portrait captures, EXIF rotation); read real intrinsics if the iOS app can export them.
- [ ] **Portrait captures in close-ups**: test and handle rotated/portrait sample cameras in `scene/photos.ts` ranking (the horizontal FOV comes from `width` and `fx`; a portrait frame may need its axes swapped).
- [ ] **Flag missing close-ups**: read the bundle manifest `checklist` in the viewer and warn about unticked close-ups (e.g. "no derailleur photos").
- [ ] **Occlusion-aware close-ups**: raycast from each candidate camera to the target against the loaded mesh and drop photos where the bike hides it.
- [ ] **Pin favourite close-ups**: let staff star photos for an area (the schema already has `Hotspot.photos`) and show starred ones first, also in shared links.

## Milestone 3: Sales experience

- [x] **Shareable read-only link**: `?scene=` URL loads a published scene in Present mode with editing hidden; "Copy share link" button. Scenes + models served from `apps/web/public/scenes/<id>/`.
- [x] **Comment polish**: leader lines from pin to card in Present mode, auto-advance/kiosk mode, comment ordering (drag to reorder), markdown-lite (bold, bullet lists) in bodies.
- [x] **Embeddable viewer** (was also listed as *Embed packaging*): an `embed.html` page + `postMessage` bridge and a `<bike-viewer>` custom element around `mountPresenter` (`present/BikePresenter.ts`), so shops can put a bike on their own site; scope the `styles.css` base rules first so it works inside Shadow DOM.
- [x] **Share docs**: ARCHITECTURE (`bike-share/1`, BikePresenter controller API for the embed), TESTING-GUIDE (try the customer link on a phone), README; mobile E2E run of `share.spec.ts`.
- [ ] **Cross-origin embed check**: an E2E run that loads `bike-viewer.js` and `embed.html` from a second origin (two preview ports) to prove CORS module loading, the `?origin=` lock end to end, and the BVH build falling back to the main thread when the worker cannot start cross-origin (shop pages); add `interval`/`idle` attributes to `<bike-viewer>`.
- [ ] **Hotspot auto-suggest**: for captures, propose default areas (Fork, Drivetrain, Cockpit, Wheels, Saddle) by letting the user tap each part once; camera view computed from tapped point + local bounds.
- [x] **Spec sheet**: per-bike key specs table (frame material, groupset, weight, sizes) shown in Present mode intro and exported.
- [x] **Spec sheet on short screens**: with 6+ rows the first Present card covers the lower half of the bike on a laptop; collapse the table to a few rows with "All specs" (or a two-column layout on wide cards). Done: 4 rows plus an "All specs (k)" toggle, two columns on cards ≥ 500 px, and on wide stages the viewport ends above the card (as on phones) so the bike is never behind it.
- [~] **Area views with depth + long specs** (owner review): Set view gives no feedback and the camera always orbits and zooms around the bike's center, so close-ups of a part cannot be framed; zoom toward the cursor, double-click to orbit around a point, confirm Set view; spec values longer than one line wrap in the editor and are clamped in Present.
- [ ] **Present backdrop under the card**: on wide stages the viewport now ends above the card, so the bike renders smaller and a dark band shows behind the card; extend the stage backdrop under the card or let the card sit beside the bike on landscape screens.
- [ ] **Branding**: shop logo, accent color and font in scene settings; applied to Present mode.
- [x] **Snapshot / video export**: high-res PNG with transparent or green background; 360° turntable WebM via MediaRecorder for social posts. Done: **Snapshot** menu in the top bar (1× / 2× / 4× the stage, capped by the GPU and 16.7 MP; as shown / transparent / chroma green; pins on or off), 8 s turntable in WebM (MP4 where only that records, hidden where neither does).
- [ ] **Square / vertical video formats**: the turntable records the stage's aspect; offer 1:1 and 9:16 framings (refit the camera to the bike) and a duration choice for Reels/Stories.
- [ ] **Turntable in WebKit E2E**: check the MP4 path (Safari's MediaRecorder) in `bun run e2e:webkit`; the Chromium suite only covers WebM.
- [x] **Undo/redo for the whole scene**: Edit → Model has its own undo stack; extend it to comments and areas (store-level history, Ctrl/Cmd+Z).
- [ ] **Accessibility & i18n pass**: keyboard navigation for pins, focus states, screen-reader labels, number/currency formatting.

## Milestone 4: iOS app depth

- [ ] **In-app viewer**: RealityKit/SceneKit view of `model.usdz` with the same areas and comments (read `bike-scene/1` JSON), so sales staff can present from the phone offline.
- [x] **Capture guidance for bikes**: checklist overlay (3 orbits: hub height, saddle height, top-down; close-ups of fork crown, dropouts, rear derailleur, cockpit), shot counter per pass, tips for reflective paint (dulling spray / polarizer), turntable support. Done: checklist in the capture screen (orbits ticked by Object Capture's pass detection, close-ups ticked by hand, shots per pass). Turntable: not possible with `ObjectCaptureSession` (ARKit world tracking needs the object still); documented in the app and README.
- [ ] **Turntable capture via the Mac**: a fixed-camera photo mode (plain `AVCapturePhotoOutput` shots while the bike spins on a turntable) reconstructed by `PhotogrammetrySession` on the Mac (see Mac high-detail reconstruction), which accepts turntable sets.
- [x] **Save the capture checklist**: store ticked close-ups and shots per pass in `record.json` / the manifest so the web side can flag missing close-ups (e.g. "no derailleur photos"). Done: the app keeps each checklist item (`id`, `label`, `done`, `pass`) in the bike's `record.json`; the exported manifest gets an optional `checklist: [{id, label, done}]` (left out when empty). Simulator build checked by iOS CI only.
- [ ] **Mac high-detail reconstruction**: `tools/mac-reconstruct` Swift CLI running `PhotogrammetrySession` at `.full` / `.raw` detail from an exported bundle, writing `model.usdz` + `poses.json` back.
- [ ] **On-device GLB export**: convert the USDZ to GLB (ModelIO → glTF writer) so the web viewer never needs conversion.
- [ ] **Upload to viewer**: share sheet target / direct upload of bundles to the web app storage (see Milestone 5).

## Milestone 5: Backend & multi-bike catalog

Commercial plan (screens for shops, the shop floor and customers; phases; owner decisions): [docs/PRODUCT-VIEWS.md](docs/PRODUCT-VIEWS.md).

- [x] **Product views plan**: Studio, Bike page, Show customer / Window mode, Storefront, Embed, Request form, Leads, Captures, Platform console; wireframes, data model, phases 0–3, owner decisions.
- [x] **Clickable prototype (phase 0)**: `/app/proto.html` with tabs Studio · Bike workspace · Bike page · Show customer · Storefront · Talk to a salesperson, for new bikes in the US (English, USD, email/SMS), on the demo bike with made-up data (`src/proto/data.ts`). Done: real 3D on the bike page, workspace and Show customer; components and upgrades fly the camera to their area; contact sheet with email/SMS (TCPA line) and call; 3D deferred on Save-Data, 2G/3G or < 4 GB memory with a timeout and Retry; E2E on desktop and phone.
- [ ] **Prototype polish from owner review**: whatever the owner flags after clicking through the prototype; known: Show customer's stage is short on a 1024×768 iPad (bike small next to its touch-size pins), the bike page poster is a placeholder (use a Snapshot export), Compare's second bike has no capture.
- [ ] **Hosting cost spike**: tenant auth, signed upload, public reads and the cost of 1,000 views of a 20 MB model on Cloudflare (R2/Workers/D1) vs Supabase; result in docs/PRODUCT-VIEWS.md section 9.

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
- [x] **E2E tests**: Playwright suite (desktop + iPhone viewport, SwiftShader WebGL) covering view, edit, present, export/import, capture-bundle drop and re-drop, stored captures (reload, Open menu, forget), photo close-ups and lightbox, binary USDC with textures, error toasts, blocked storage, snapshot; synthetic capture-bundle fixtures; unit coverage with ratcheting thresholds; sharded CI job. See [docs/TESTING.md](docs/TESTING.md).
- [x] **E2E coverage for app code**: collect V8 coverage from Chromium during the Playwright run (`page.coverage`) and merge it with the unit report, so `ui/app.ts`, `Viewer.ts` and `main.ts` count toward the coverage ratchet.
- [ ] **Raise app.ts coverage**: the merged report has `ui/app.ts` at ~87% lines / 79% branches; cover its untested paths (see `coverage-all/`) and raise the merged thresholds in `tools/coverage/e2e-coverage.mjs`.
- [ ] **E2E coverage of the minified build**: E2E in CI now runs the unminified, source-mapped build (`E2E_COVERAGE`); add a periodic run over the exact production build, or map coverage through the minifier's source maps.
- [x] **Render on demand**: only render when the camera, model or pins change (idle stage at 0 fps). Saves phone battery and makes the E2E suite much faster on SwiftShader (today every frame costs ~150–250 ms on CPU).
- [x] **WebKit E2E project**: run the suite in Playwright WebKit (closest to iPhone Safari) on a macOS runner or with WebKit's Linux deps; the `mobile` project is Chromium with an iPhone viewport today.
- [ ] **WebKit E2E in CI**: on GitHub's macOS runners (no GPU) every WebKit `page.goto` timed out while the same 45 tests pass locally in 17 s; find a WebGL path that works headless there (or a Linux runner with WebKit deps) and add the job back.
- [ ] **Real Safari storage in E2E**: WebKit test contexts have no OPFS, so the WebKit project only exercises the IndexedDB capture cache; cover OPFS in Safari on a real device (see the "Capture cache on real Safari / iOS" item).
- [x] **One fixture generator**: fold `tools/make-test-bundle.mjs` (GLB bundle for the Pages sample) and `tools/fixtures/make-capture.mjs` (USDZ bundle with photo poses) into `tools/fixtures/make-capture-bundle.mjs` as variants, so there is one bike geometry and one pose layout to maintain.
- [ ] **Tilted/area bundles from the same generator**: `tools/fixtures/make-bike-capture.mjs` (auto-orient and crop fixtures) still uses the demo bike; make it a `make-capture-bundle.mjs` variant too.
- [ ] **HEIC in E2E**: a small synthetic HEIC photo fixture (needs an encoder at generation time) so the libheif worker path is exercised in Chromium.
- [ ] **Docs**: end-to-end guide with screenshots: capture → build → export → annotate → share.

## Ideas parking lot

- AR "place the bike in your room" via Quick Look (`model.usdz` + `<a rel="ar">`).
- Compare two bikes side by side.
- Size guide overlay (rider silhouette to scale).
- Measure tool (tap two points → distance in mm).
