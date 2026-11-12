# How to test

A short guide for the owner: how to try what the agents built, on a phone or a laptop. Every
PR that adds something testable extends the "What each PR adds" table at the bottom.

## On your phone (no setup)

1. Open the live demo: **https://davidpn11.github.io/bike-3d-brew/app/**
   (this site lives one level up: https://davidpn11.github.io/bike-3d-brew/).
2. The procedural demo bike loads with sample areas and comments.
   - **View**: drag to orbit, pinch to zoom, tap an area chip (Fork, Drivetrain, Cockpit…) to fly there.
   - **Edit**: tap the bike to drop a comment pin; save the current camera as a new area.
   - **Present**: steps through the areas one by one, as you would with a customer.
   - The background buttons switch between clear, chroma green, studio and dark.
3. To try a capture bundle without the iPhone app, download the synthetic one:
   **https://davidpn11.github.io/bike-3d-brew/app/samples/synthetic-bike.bikecapture.zip**,
   then in the viewer tap **Open…** and pick it from Files. A red low-poly bike replaces the demo
   and the scene is named "Synthetic test bike".
4. Try what a customer gets: open
   **https://davidpn11.github.io/bike-3d-brew/app/?scene=scenes/demo/scene.bike.json&view=present**
   on the phone. Only the bike, its name and price, and the Present card: swipe the card or tap
   ‹ › to change area, tap a pin or a comment to fly to it, tap **Share** for the share sheet.
   Add `&area=hs-fork` to open on the fork, or `&kiosk=1&interval=4` for auto-play.
5. Embedding on a shop's site: **https://davidpn11.github.io/bike-3d-brew/app/embed-demo.html**
   shows the bike in an iframe driven by the buttons under it, and as a `<bike-viewer>` element.

The site is republished automatically on every push to the stack tip (the newest open PR nothing else is stacked on, or `develop` when none is open). Each open PR also gets its
own copy at `https://davidpn11.github.io/bike-3d-brew/pr/<n>/` (viewer at `/pr/<n>/app/`),
listed under **PR previews** on the home and Progress pages, so you can try a PR before
merging it. Each PR also gets a comment with Docs and Viewer links; closed previews are removed
daily when their PR is no longer open. The home page says which commit and branch it was built from.

## On a laptop

```sh
bun install --frozen-lockfile
bun run dev          # viewer at http://localhost:5190 (also reachable from your phone on the same Wi-Fi)
bun run docs:dev     # this docs site at http://localhost:5191/bike-3d-brew/
```

Checks the agents run on every PR (CI runs them too):

```sh
bun run typecheck && bun run test:coverage && bun run build
bun run e2e          # Playwright end-to-end suite (see Testing)
bun run docs:build   # static docs site → apps/docs/out/
```

How the automated tests work and how to add them: [Testing](TESTING.md).

## Make a synthetic capture bundle

The iPhone app exports `*.bikecapture.zip` (format `bike-capture/1`, see
[Architecture](ARCHITECTURE.md)). To test the import path without a phone:

```sh
node tools/fixtures/make-capture-bundle.mjs --sample /tmp/test.bikecapture.zip --name "My test bike"
```

It writes a low-poly bike as `model.glb`, a `manifest.json`, an orbit of camera poses in
`poses.json` and no photos, all nested in one folder like the real export. Drag the file onto
the viewer (or use **Open…**). Dropping the same file again later restores the comments you
added to it.

With a real capture: AirDrop the `.bikecapture.zip` from the iPhone to the laptop and drop it on
the viewer. If the model does not show, note what the viewer says and add it to
[Manual steps](MANUAL-STEPS.md).

## What each PR adds

| PR | What to try |
| -- | ----------- |
| #1 Foundation | Demo bike, areas, comments, Edit and Present modes, background switcher, Export JSON. |
| #2 Capture bundle import | **Open…** the synthetic bundle above (or drop it on desktop): it loads and is named from the manifest. Add a comment, reload, open the same file again: the comment is back. |
| Docs site | This site: the home page shows roadmap progress; **Progress** lists every item. |
| #7 Test system | Nothing new to click: `bun run e2e` drives the real viewer through every flow above (demo, edit, present, export/import, capture bundles, stored captures, photo close-ups, error toasts) at desktop and iPhone sizes; `bun run test:coverage` shows unit coverage. The suite found and fixed a bug where a tap right after jumping to an area (with reduced motion on) missed the bike. |
| #9 Auto-orient | Make a tilted bundle (`node tools/fixtures/make-bike-capture.mjs --out tilted.bikecapture.zip`) and **Open…** it: the bike stands up facing right and the toast says "Auto-oriented". In **Edit** try ↶ Undo at the top of the panel (back to lying on its side), then in **Edit → Model**, Auto-orient, the rotate ±90° buttons, Turn 180°, and type a real length in cm. Pin a comment first: it stays on the same spot through every rotation. |
| #10 Crop box | Make an area-mode bundle with a floor and clutter (`node tools/fixtures/make-bike-capture.mjs --out area.bikecapture.zip --rotate 0,0,0 --offset 0,0,0 --ground --mode area`) and **Open…** it: the toast suggests cropping. In **Edit → Model → Crop** turn the crop on, press **Fit to bike** (floor and crate disappear), then drag a face handle with the mouse or a finger: the camera must not orbit while dragging. Comments can't be pinned on cropped-away parts, and pins outside the box hide. |
| #8 Share with customers | Open the published demo as a customer: `/bike-3d-brew/app/?scene=scenes/demo/scene.bike.json&view=present` (on your phone too). Swipe between areas, tap a pin (leader line to its card), add `&kiosk=1&interval=4` for auto-play that pauses when you touch it. In the editor, **Share** on a published scene copies the link; on a local capture it exports a `.bikeshare.zip` that `node tools/publish-scene.mjs <zip>` installs. In Edit mode, drag comments to reorder them and use **bold**, *italic* and `- ` lists in bodies. |
| #12 Performance | Orbit the demo, then let go: the camera glides to a stop and the page goes quiet (DevTools → Performance shows no frames while idle). Pins slide with the bike and dim when the bike is in front of them. On a phone, open a large capture: it appears, then picking a comment point is instant. Add `?quality=low` to the URL for the cheapest rendering. A GLB made with `node tools/optimize-glb.mjs in.glb out.glb` opens like any other. |
| #21 One fixture generator + E2E coverage | Nothing new to click. `bun run fixture:photos` renders the fixture bike from every pose and writes `tools/fixtures/out/fixture-photos.bikecapture.zip`: **Open…** it, save an area and the close-ups show the bike from each camera. `bun run test:coverage && bun run e2e:coverage && bun run coverage:merge`, then open `coverage-all/index.html`: `ui/app.ts`, `Viewer.ts` and `main.ts` are in the report. On a PR, the CI `coverage` job's summary has the merged numbers. |
| #14 iOS capture guidance + JPEG photos | On the iPhone: during a capture tap **Checklist**: orbits tick themselves after each completed pass, close-ups tick on tap, the top bar shows shots for the current pass. Export a bundle: the zip has `photos/*.jpg` next to `images/*.HEIC` and `manifest.json` has `"photos": "photos/"`. Open it in desktop Chrome: close-up photos appear without the HEIC decoder (no `heic` worker request in DevTools → Network). Web side alone: `bun run test` (capture.test.ts covers the `photos/` preference). |
| #16 WebKit E2E | Nothing new to click. On a Mac: `bunx playwright install webkit && bun run e2e:webkit` runs the iPhone flows in Safari's engine (45 tests). Open the customer link in Safari on your phone: no console error when the Present card changes height. |
| #19 Reconstruct: COLMAP → poses + package | Nothing to click yet. `node tools/reconstruct/cli.mjs --help`; with a COLMAP sparse model in TXT (`colmap model_converter … --output_type TXT`): `node tools/reconstruct/cli.mjs package --model model.glb --images frames --colmap sparse_txt --source video --backend colmap --name "My bike"`, then drop `My-bike.bikecapture.zip` on the viewer: the model loads and the close-up filmstrip shows the frames. `bun run test` runs `reconstruct.test.ts` (round-trip and reprojection checks). |
| #22 Snapshot / video export | Click **Snapshot**: pick 4×, Transparent, Show pins, **Save PNG**: the file opens with a see-through background and numbered pins. Chroma green gives a solid key color with no floor shadow. **Record 360° WebM** turns the camera once around the bike (8 s) and downloads a video; the view returns to where it was. In Safari the button says MP4. |
| #13 Spec sheet | In **Edit**, the **Spec sheet** section lists the demo's specs: change a value, remove a row, **+ Add spec** and Tab from the name to the value. Clear a value: that row disappears from **Present** but stays in the editor. **Present** shows a "Key specs" table on the first card only; **Export** has a `specs` array. The customer link (`?scene=scenes/demo/scene.bike.json&view=present`) shows it too, on a phone as part of the bottom sheet. |
| #24 Prune stale previews + preview link | Open the PR on GitHub: a sticky comment (one per PR, updated on each push) links to its Docs and Viewer at `/bike-3d-brew/pr/<n>/`. Nothing else to click: the daily **Prune previews** run (Actions → "Prune PR previews", or *Run workflow*) removes previews of closed PRs; close a PR and check that `/pr/<n>/` is gone after the next run. |
| #25 COLMAP binary models | Nothing to click in the viewer. Locally, with a COLMAP sparse model in binary form (`cameras.bin`, `images.bin`, no `model_converter` step): `node tools/reconstruct/cli.mjs poses --colmap sparse_bin -o poses.json` writes the same poses as the TXT model. `bun run test` runs `reconstruct.test.ts` on both formats, including truncated binary files. |
| #26 Real intrinsics in close-ups | Nothing new to click. Close-up ranking now uses each photo's own `camera` from `poses.json`, so a bundle packaged from a COLMAP model (`cli.mjs poses` then `package`) ranks with its real focal length. Bundles without `camera` keep the 65° iPhone default. `bun run test` runs `photos.test.ts`, including the fallback for bad camera values. |
| #28 Save the capture checklist | On the iPhone: during a capture tap **Checklist** and tick a few close-ups, then export the bundle. In the zip, `manifest.json` has `"checklist": [{ "id", "label", "done" }]` with your ticks; it is left out when the bike has no checklist items. The viewer does not read it yet. The app itself is only compiled by the iOS CI check (no simulator run here). |
| #27 Spec sheet on short screens | Open the preview viewer, add 6+ rows in Edit → Spec sheet, switch to Present on a laptop-size window: the first card shows 4 specs in two columns and **All specs (k)**; the bike sits fully above the card. On a phone the card is a bottom sheet as before. |
| #15 Auto-publish + PR previews | Open the home page: **PR previews** lists open PRs with Viewer and Docs links; open `/bike-3d-brew/pr/15/app/` and the demo bike loads. Push to a PR and its preview updates a few minutes later (Actions → "PR preview"); close it and it disappears from the list. Merging into `develop` updates the main site (Actions → "Publish site"). |
| #17 Site follows the stack tip | The home page has no credits box any more. Push to the top PR of the stack (or press *Run workflow* on Actions → "Publish site" from it): the main site shows that branch a few minutes later (the footer names it). Pushes to other branches skip publishing. |
| #20 Embeddable viewer + share docs | Open `/bike-3d-brew/app/embed-demo.html` (also on the phone): the top bike is an iframe; **Next ›**, **Drivetrain**, **Green screen**, **Get state** drive it and the events show up in the log. The bottom one is a `<bike-viewer>` element opening on the Cockpit: it looks the same as the customer link while the page around it keeps its own serif font. Copy a snippet from the page into any HTML file to embed on another site. Customer links now take `&area=hs-fork`. |
| #18 Undo/redo for the whole scene | In **Edit**, add a comment, move it with ↑, delete it, save a view as an area, then press Ctrl/Cmd+Z (or ↶ Undo at the top of the panel) step by step: each change comes back in order; Shift+Ctrl/Cmd+Z, Ctrl+Y or ↷ Redo replays them. Ctrl/Cmd+Z inside a text field only undoes your typing. Click the 1 cm nudge buttons quickly: one Undo puts them all back. Reload: the scene is as you left it (the history itself starts fresh). |
