# bike-3d-brew

Capture bikes with an iPhone, show them as background-free 3D models, zoom into components
(fork, drivetrain, cockpit…) and pin sales comments on them.

- **`apps/ios`**: iPhone capture app (Apple Object Capture: background removed automatically, on-device 3D build, camera poses, shareable bundle).
- **`apps/web`**: three.js viewer and editor: clear / chroma-green / studio backgrounds, fly-to areas, comment pins, presentation mode, JSON export.

```sh
npm ci && npm run dev   # open http://localhost:5190, the demo bike loads with sample comments
```

Drop a `.glb`, `.usdz` or `.ply` onto the viewer to use your own capture. Switch to **Edit** to
tap the bike and add comments, save camera views as areas; **Present** steps through areas for
a customer.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [ROADMAP.md](ROADMAP.md) and
[apps/ios/README.md](apps/ios/README.md). Inspired by
[wesbos/3d-model-anything](https://github.com/wesbos/3d-model-anything).
