# Manual steps

Things an agent cannot do (hardware, accounts, decisions). Newest first.

- **Decide on the HEIC decoder license**: photo close-ups decode HEIC in Chrome/Firefox with
  `libheif-js` (LGPL-3.0), shipped as a separate, lazily loaded worker chunk. Fine for a private
  tool; before a public release, either confirm LGPL compliance (unmodified library in its own
  file, notice in the about/credits) or remove it once the iOS app exports JPEGs (see ROADMAP).
- **Close-ups on a real capture**: open a real `.bikecapture.zip` with a few areas and check that
  each area's first photos really show it, in Chrome (WASM HEIC path) and iPhone Safari (native).

- **Real iPhone capture test** (needs an iPhone with LiDAR, iOS 18+): build `apps/ios`, capture a
  bike, export the `.bikecapture.zip`, drop it on the viewer. Report whether the USDZ loads.
- **GitHub Pages**: done by the owner on 2026-10-27 (Settings → Pages → Deploy from branch
  `gh-pages`). The site is published from this repo by `tools/publish-pages.sh`.
