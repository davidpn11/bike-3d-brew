# Testing

Three layers, cheapest first. CI (`.github/workflows/ci.yml`) runs all of them on every PR.

| Layer | Where | Runs in | Command |
| --- | --- | --- | --- |
| Unit | `apps/web/test/*.test.ts` | Vitest, Node (happy-dom per file where needed) | `npm test` |
| Coverage | same tests, V8 coverage | Vitest | `npm run test:coverage` |
| End-to-end | `apps/web/e2e/*.spec.ts` | Playwright, Chromium + SwiftShader WebGL | `npm run e2e` |

Fixtures for both come from one generator: `tools/fixtures/make-capture-bundle.mjs`.

## Unit tests

- Pure logic lives in `apps/web/src/scene/` (scene format, store, camera math, capture bundles,
  UI helpers in `helpers.ts`) and is tested in plain Node. When UI code grows a decision (a
  default, a message, a URL rule), move it into `src/scene/helpers.ts` and test it there.
- three.js code that needs no WebGL (loaders, `centerOnGround`, the demo bike's geometry) is
  tested in Node too (`viewer-node.test.ts`). three's `FileLoader` needs a `ProgressEvent`
  stub in Node; the test file installs one. Models are passed as `data:` URLs.
- DOM code (`ui/dom.ts`, `viewer/pins.ts`) opts into happy-dom with a first-line comment
  `// @vitest-environment happy-dom` and uses a fake `Viewer` with just the methods it calls.
- `Viewer.ts`, `ui/app.ts` and `main.ts` need a real WebGL page, so they are excluded from unit
  coverage and covered by the E2E suite instead.

### Coverage

`npm run test:coverage` writes `coverage/` (text summary, HTML report, `coverage-summary.json`).
Thresholds in `apps/web/vite.config.ts` are a ratchet set just under the current numbers,
globally and for `src/scene/**`; CI fails when coverage drops below them. When you raise
coverage, raise the thresholds in the same PR. Never lower them to make a PR pass.

## Fixtures

```sh
npm run fixtures                      # writes apps/web/e2e/.fixtures/ (gitignored)
node tools/fixtures/make-capture-bundle.mjs /some/dir
```

`buildFixtures()` returns every fixture as bytes and is also imported by unit tests. Output is
byte-for-byte deterministic (fixed zip timestamps, rounded floats), so nothing binary is
committed. What it makes:

| File | What it exercises |
| --- | --- |
| `bike.bikecapture.zip` | iOS layout (everything under one folder): manifest, ASCII-USD `model.usdz` of a low-poly vertex-colored bike (wheels, frame tubes, fork, cockpit, saddle, drivetrain as named meshes), `poses.json` with 32 cameras on three rings looking at the bike, 32 tiny placeholder PNG photos, `record.json` |
| `bike-glb.bikecapture.zip` | same bike as GLB (three's `GLTFExporter` in Node, vertex colors) |
| `bike-flat.bikecapture.zip` | flat zip with Finder `__MACOSX` junk |
| `bike-broken-poses.bikecapture.zip` | invalid `poses.json`: opens with a warning |
| `bike-no-model.bikecapture.zip` | capture never reconstructed: error |
| `not-a-zip.bikecapture.zip` | text with a `.zip` name: error |
| `bike.usdz`, `bike.glb` | bare model files |

The photos are PNG stand-ins: real captures have HEIC, which Node cannot encode.

## End-to-end tests

Playwright drives the **production build** (`vite build` + `vite preview` on port 4190, started
by the config's `webServer`) in two projects: `desktop` (1280×800) and `mobile` (iPhone 14
viewport with touch, DPR 1 to keep CPU rendering fast). WebGL runs on SwiftShader
(`--use-angle=swiftshader --enable-unsafe-swiftshader`), so no GPU is needed.

```sh
npm run e2e                                   # all projects
npm run e2e -- --project=desktop files.spec   # one project, one file
npm run e2e -- -g "present mode"              # by title
npm run e2e:ui                                # Playwright UI mode
E2E_SKIP_BUILD=1 npm run e2e                  # reuse an existing dist/
npx playwright show-report                    # HTML report after a run
```

Browser: CI runs `npx playwright install --with-deps --only-shell chromium`. On a machine with a
preinstalled Chromium (e.g. the agent containers: `/opt/pw-browsers/chromium`), do not run
`playwright install`; set `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium` and the config uses it as
`launchOptions.executablePath`. `@playwright/test` is pinned to the version whose browsers are
preinstalled there.

### The `window.__bike` test hook

`main.ts` exposes `window.__bike = { app, store, viewer, ready }` only in the dev server or when
the URL has `?e2e` (the suite always adds it). Tests use it to:

- wait for state instead of sleeping: `ready` (boot finished), a model in `viewer.modelRoot`,
  `viewer.flying` (camera animation running);
- find a point on the model to tap: `modelPoint()` in `e2e/helpers.ts` asks the app's own
  `viewer.pick()` and checks `document.elementFromPoint` so the tap lands on the canvas, not a pin;
- read the scene for assertions (`store.scene`).

Everything else goes through the real UI: clicks, taps, keys, the file picker
(`setInputFiles`), real `DragEvent` drops with a `DataTransfer`, dialogs and downloads. Keep the
hook read-mostly; if a test needs to mutate app state through it, that is a sign a UI path is
missing.

### Writing reliable E2E tests

- Never `waitForTimeout`. Wait on app state (`waitForFunction`, `expect.poll`) or on web-first
  assertions (`toHaveText`, `toHaveCount`, `toHaveAttribute`).
- Camera flights are instant because the suite emulates `prefers-reduced-motion: reduce`, which
  the viewer honors; a test that wants the animation calls
  `page.emulateMedia({ reducedMotion: 'no-preference' })` and waits for `viewer.flying === false`.
- Use `collectErrors(page)` and assert it is empty where a flow should be clean.
- Screenshots are for humans: `snap(page, testInfo, name)` saves to `test-results/` and attaches
  to the HTML report. Do not add pixel-diff assertions; SwiftShader output differs across
  machines.
- Tests run in parallel across fresh browser contexts, so each test starts from an empty
  `localStorage` and the seeded demo.
- On CI a failing run uploads `playwright-report/` and `test-results/` (traces, screenshots) as
  the `playwright-report` artifact. CI retries once; a test that only passes on retry is reported
  as flaky and should be fixed, not ignored.

### What the suite covers

- `view.spec.ts`: demo loads with seeded areas/comments/pins and no console errors; fly to an
  area and back; comment focus; background modes (and the chroma-green opaque clear); Snapshot
  downloads a real PNG; Reset view.
- `edit.spec.ts`: add/edit/delete a comment picked on the canvas; persistence across reload;
  Cancel/Escape; default area; save/rename/set view/delete areas; bike details.
- `present.spec.ts`: keys (←, →, space, Esc) and ‹ › buttons with wrap-around; `?mode=present`.
- `files.spec.ts`: export JSON → re-import; `?scene=` published scene (routed); capture bundles
  via picker and drag-and-drop (USDZ, GLB, flat); re-drop after reload restores comments;
  broken poses warning; bare model drop; error toasts for seven kinds of bad files.
- `storage.spec.ts`: everything still works with `localStorage` throwing.
