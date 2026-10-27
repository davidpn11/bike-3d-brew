# Manual steps

Things an agent cannot do (hardware, accounts, decisions). Newest first.

- **Auto-orient on a real capture** (needs the real-capture test below): open a real `.bikecapture.zip`
  and check the bike stands upright, front to the right (+X), drive side towards the default camera.
  If not, note which button fixed it (Flip / Turn 180° / rotate) so the heuristics can be tuned.

- **Real iPhone capture test** (needs an iPhone with LiDAR, iOS 18+): build `apps/ios`, capture a
  bike, export the `.bikecapture.zip`, drop it on the viewer. Report whether the USDZ loads.
- **GitHub Pages**: done by the owner on 2026-10-27 (Settings → Pages → Deploy from branch
  `gh-pages`). The site is published from this repo by `tools/publish-pages.sh`.
