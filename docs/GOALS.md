# Goals

## Product

A bike shop captures a bike with an iPhone in a few minutes and gets a background-free,
photoreal 3D model that sales staff (in store, on a tablet) and customers (on a shared link)
can spin, zoom into named areas (fork, drivetrain, cockpit…) and read pinned sales comments.

## Success criteria

1. **Capture → viewer in under 15 minutes** with no desktop software: capture on iPhone,
   AirDrop the `.bikecapture.zip`, drop it on the viewer.
2. **Looks like the real bike**: textures, thin parts (spokes, cables) acceptable; background gone.
3. **Fast on phones**: first model visible in < 3 s on iPhone Safari over 4G for a 20 MB model;
   60 fps orbiting with 50 pins.
4. **Selling tool, not a 3D toy**: areas and comments are the primary UI; present mode is
   usable by a non-technical salesperson with one hand.
5. **Robust**: untrusted files never crash the app; every failure says what to do next.

## Quality bar for every PR

- Pure logic in `apps/web/src/scene/` with unit tests; coverage does not go down.
- `npm run typecheck`, `npm test`, `npm run build` and the E2E suite pass; CI green.
- UI changes verified in Chromium with screenshots, at desktop and phone sizes.
- Docs (ROADMAP, CHANGELOG, ARCHITECTURE, guides) updated in the same PR.

## Non-goals (for now)

- Public release / app store distribution (the owner decides when).
- Real customer captures in the repo: only generated fixtures.
