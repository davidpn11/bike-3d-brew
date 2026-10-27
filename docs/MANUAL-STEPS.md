# Manual steps

Things an agent cannot do (hardware, accounts, decisions). Newest first.

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
