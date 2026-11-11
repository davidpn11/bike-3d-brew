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

The site is redeployed by `tools/publish-pages.sh` after each finished PR, so it shows the
newest work in the stack, which may not be merged yet. The footer of the home page says which
commit and branch it was built from.

## On a laptop

```sh
npm ci
npm run dev          # viewer at http://localhost:5190 (also reachable from your phone on the same Wi-Fi)
npm run docs:dev     # this docs site at http://localhost:5191/bike-3d-brew/
```

Checks the agents run on every PR (CI runs them too):

```sh
npm run typecheck && npm run test:coverage && npm run build
npm run e2e          # Playwright end-to-end suite (see Testing)
npm run docs:build   # static docs site → apps/docs/out/
```

How the automated tests work and how to add them: [Testing](TESTING.md).

## Make a synthetic capture bundle

The iPhone app exports `*.bikecapture.zip` (format `bike-capture/1`, see
[Architecture](ARCHITECTURE.md)). To test the import path without a phone:

```sh
node tools/make-test-bundle.mjs /tmp/test.bikecapture.zip --name "My test bike"
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
| #7 Test system | Nothing new to click: `npm run e2e` drives the real viewer through every flow above (demo, edit, present, export/import, capture bundles, stored captures, photo close-ups, error toasts) at desktop and iPhone sizes; `npm run test:coverage` shows unit coverage. The suite found and fixed a bug where a tap right after jumping to an area (with reduced motion on) missed the bike. |
