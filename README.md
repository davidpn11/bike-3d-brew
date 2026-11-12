# bike-3d-brew

Capture bikes with an iPhone, show them as background-free 3D models, zoom into components
(fork, drivetrain, cockpit…) and pin sales comments on them.

- **`apps/ios`**: iPhone capture app (Apple Object Capture: background removed automatically, on-device 3D build, camera poses, shareable bundle).
- **`apps/web`**: three.js viewer and editor: clear / chroma-green / studio backgrounds, fly-to areas, comment pins, presentation mode, JSON export.

Prerequisites: Bun 1.4.4 and Node.js 22 (used by browser tooling and runtime-sensitive scripts).

```sh
bun install --frozen-lockfile && bun run dev   # open http://localhost:5190, the demo bike loads with sample comments
```

Drop a `.bikecapture.zip` from the iPhone app (or a `.glb`, `.usdz`, `.ply`) onto the viewer to use your own capture. Switch to **Edit** to
tap the bike and add comments, save camera views as areas; **Present** steps through areas for
a customer.

**Share** gives customers a read-only link (`?scene=…&view=present`). To put a bike on a shop's own
site, use an iframe or the custom element (live demo: `/app/embed-demo.html`):

```html
<iframe src="https://davidpn11.github.io/bike-3d-brew/app/embed.html?scene=scenes/demo/scene.bike.json&area=hs-fork"
        style="width:100%;height:440px;border:0" allow="fullscreen; web-share"></iframe>

<script type="module" src="https://davidpn11.github.io/bike-3d-brew/app/bike-viewer.js"></script>
<bike-viewer src="https://davidpn11.github.io/bike-3d-brew/app/scenes/demo/scene.bike.json" area="hs-cockpit"></bike-viewer>
```

The iframe takes commands over `postMessage` (`{ type: "bike-embed/1", cmd: "next" }`); the
element exposes `element.presenter` and DOM events. Details in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#embedding-on-a-shops-site).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [ROADMAP.md](ROADMAP.md) and
[apps/ios/README.md](apps/ios/README.md). Inspired by
[wesbos/3d-model-anything](https://github.com/wesbos/3d-model-anything).
