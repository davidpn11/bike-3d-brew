# Manual steps

Things an agent cannot do (hardware, accounts, decisions). Newest first.

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
