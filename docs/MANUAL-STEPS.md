# Manual steps

Things an agent cannot do (hardware, accounts, decisions). Newest first.

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
