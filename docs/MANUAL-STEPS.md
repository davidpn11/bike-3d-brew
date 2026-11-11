# Manual steps

Things an agent cannot do (hardware, accounts, decisions). Newest first.

- **Customer link on a real phone**: open the published demo link
  (`…/app/?scene=scenes/demo/scene.bike.json&view=present`) on an iPhone, check swiping, the
  bottom sheet, pin taps and the share sheet. Real customer captures should be published to a
  host you control with `node tools/publish-scene.mjs <zip> --out <folder>`, not committed here.

- **Crop on a real area-mode capture**: capture a bike in area mode, open the bundle, turn on
  Edit → Model → Crop and check "Fit to bike" removes the floor and the room. Note scans where the
  bike touches a wall or stand (the box then includes it; drag the faces to fix).

- **Auto-orient on a real capture** (needs the real-capture test below): open a real `.bikecapture.zip`
  and check the bike stands upright, front to the right (+X), drive side towards the default camera.
  If not, note which button fixed it (Flip / Turn 180° / rotate) so the heuristics can be tuned.

- **Decide on the HEIC decoder license**: photo close-ups decode HEIC in Chrome/Firefox with
  `libheif-js` (LGPL-3.0), shipped as a separate, lazily loaded worker chunk. Fine for a private
  tool; before a public release, either confirm LGPL compliance (unmodified library in its own
  file, notice in the about/credits) or remove it once the iOS app exports JPEGs (see ROADMAP).
- **Close-ups on a real capture**: open a real `.bikecapture.zip` with a few areas and check that
  each area's first photos really show it, in Chrome (WASM HEIC path) and iPhone Safari (native).
- **Real Object Capture USDZ in the viewer** (needs a real capture): drop the `model.usdz` (or
  the `.bikecapture.zip`) on the viewer and compare with Quick Look on the Mac/iPhone: textures
  present and not flipped, size in meters, bike upright, normal-map bumps not exaggerated. The
  browser console logs `USDZ …: N triangles, unzip/parse/build ms`; note those numbers in the
  PR. If anything is off, describe the file structure (`usdcat model.usdz | head -80` without
  sharing the capture) so an agent can re-create it in `tools/fixtures/make-usdc.py`.
- **Real iPhone capture test** (needs an iPhone with LiDAR, iOS 18+): build `apps/ios`, capture a
  bike, export the `.bikecapture.zip`, drop it on the viewer. Report whether the USDZ loads.
- **GitHub Pages**: done by the owner on 2026-10-27 (Settings → Pages → Deploy from branch
  `gh-pages`). The site is published from this repo by `tools/publish-pages.sh`.
- **Let Actions publish the site** (auto-publish on `develop` and PR previews): Settings →
  Actions → General → Workflow permissions → **Read and write permissions**, so the
  `GITHUB_TOKEN` of `pages.yml` and `pr-preview.yml` may push to `gh-pages`. If `gh-pages` has a
  branch protection rule, allow GitHub Actions to push to it. Check after the first run: the
  "Publish site" / "PR preview" run is green and Settings → Pages shows a new deployment. PRs
  only get a preview once their branch contains `pr-preview.yml` (it runs from the PR's own
  code), so PRs below this one in the stack get theirs after they are rebased or merged.

## Photos & video → 3D

Owner decisions for turning any photo set or video into a model (details in [RECONSTRUCTION.md](RECONSTRUCTION.md)):

- **Mac for the default path**: is an Apple silicon Mac (macOS 14+) available to run Object Capture
  (`PhotogrammetrySession`) on photo folders? Without one, the fallback is COLMAP + OpenMVS on Linux.
- **GPU box**: rent (per-hour cloud GPU) or own an NVIDIA machine for COLMAP dense and Gaussian splats? Budget?
- **Cloud API**: use a paid service (KIRI Engine API, Luma, Polycam…)? Which one, monthly budget,
  and are its data terms acceptable for customer bikes? Needs an account and an API key stored as a secret, never in the repo.
- **Dulling spray**: acceptable on customer bikes, or only polarizer + diffuse light?
- **Test capture**: shoot one bike with the photo protocol and one 4K video with the video protocol,
  so the pipeline can be measured on real input (keep the files out of the repo).
