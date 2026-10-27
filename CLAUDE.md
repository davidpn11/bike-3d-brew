# bike-3d-brew: agent guide

Capture bikes with an iPhone (Apple Object Capture), view them as background-free 3D models
in the browser, zoom into areas (fork, drivetrain, cockpit…) and pin sales comments on them.
Inspired by [wesbos/3d-model-anything](https://github.com/wesbos/3d-model-anything) (posed
iPhone photos + LiDAR → three.js), adapted from rooms to a single object.

## Layout

- `apps/web/`: Vite + TypeScript + three.js viewer/editor (no UI framework; `ui/dom.ts` `h()` helper).
  - `src/scene/`: pure logic (`schema.ts` = `bike-scene/1` format + validation, `store.ts`, `camera.ts`). Unit-tested in `apps/web/test/`.
  - `src/viewer/`: three.js (`Viewer.ts`, `loaders.ts`, `pins.ts`, `demoBike.ts`).
  - `src/ui/app.ts`: modes (view / edit / present), panel, comment editor, file drop.
- `apps/ios/`: SwiftUI capture app (`project.yml` for xcodegen). Object Capture → `model.usdz` + `poses.json` → `*.bikecapture.zip` (`bike-capture/1`).
- `apps/web/e2e/`: Playwright suite; `window.__bike` test hook (only with `?e2e` or in dev).
- `tools/`: offline helpers (e.g. USDZ → GLB) and `tools/fixtures/` (synthetic capture bundles for tests).
- `docs/ARCHITECTURE.md`: data contracts and pipeline. Keep it current when contracts change.
- `ROADMAP.md`: the backlog.

## Commands

```sh
npm ci
npm run dev         # http://localhost:5190
npm run typecheck
npm test            # vitest, apps/web/test
npm run test:coverage  # + V8 coverage; fails under the thresholds in apps/web/vite.config.ts
npm run build       # → dist/
npm run e2e         # Playwright, apps/web/e2e (builds + serves dist/ itself)
npm run fixtures    # synthetic *.bikecapture.zip fixtures → apps/web/e2e/.fixtures/
```

Testing is documented in `docs/TESTING.md`. In agent containers Chromium is preinstalled: run
E2E with `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run e2e` and never `playwright install`.

The iOS app cannot be built on Linux. CI (`.github/workflows/ios.yml`) compiles it unsigned on
macOS for any PR touching `apps/ios/**`; treat that check as your compiler.

## Conventions

- Positions in scene JSON (annotations, hotspot views) are in **model-root space**, so changing
  `model.rotation/scale/offset` keeps comments attached. Convert with `Viewer.toWorld/toModel`.
- Pure logic goes in `src/scene/` with tests; three.js code stays in `src/viewer/`. UI decisions
  (defaults, messages, URL rules) go in `src/scene/helpers.ts`, not inline in `ui/app.ts`.
- New UI flows get an E2E test; coverage thresholds only go up.
- Untrusted input (imported JSON, URLs, bundles) goes through a validating parser (`parseScene`).
- Every storage access is wrapped in try/catch (private mode, quotas).
- Match the existing code style (2-space TS, Prettier-ish 160 cols, sparse comments that explain *why*).
- Never commit real customer captures, photos or secrets. Generated fixtures only.

## Branching: stacked PRs, humans merge

Agents **never merge PRs**; the owner reviews and merges. To keep building while PRs wait
for review, work is **stacked**:

- `main`: stable. `develop`: integration branch; the bottom PR of the stack targets it.
- Every other PR targets the head branch of the PR directly below it, forming a chain:
  `develop ← PR1 ← PR2 ← PR3 …`. The owner merges bottom-up (GitHub retargets the next PR
  automatically when the merged branch is deleted).
- The **stack tip** is the newest open `[roadmap]` (or foundation) PR whose head branch no
  other open PR uses as its base. If nothing is open, the tip is `develop`.

## Autonomous session protocol

Sessions are started on a schedule with no human watching. Each session:

1. **Sync.** `git fetch origin`. List open PRs (GitHub MCP tools, repo `davidpn11/bike-3d-brew`)
   and find the stack tip (see above). Create your branch (the name your session was given)
   from the tip's head branch: `git checkout -B <your-branch> origin/<tip-branch>`.
2. **Keep the stack healthy first.** For open PRs, oldest first: if CI is red, fix it on that
   PR's branch (only branches created by these sessions; never force-push) and push. If a PR
   has a merge conflict with its base, merge the base branch into it and resolve. Then
   continue the stack from the new tip. Do **not** merge, approve or close others' PRs.
3. **Pick work.** The first `[ ]` item in `ROADMAP.md` that no open PR covers (check PR titles).
   Claim it immediately: push a first commit that flips it to `[~]` and open a **draft** PR
   titled `[roadmap] <item name>` whose base is the tip branch, so a parallel session sees the
   claim and stacks on you instead.
4. **Build it properly.** Small, reviewable diff. Add/extend unit and E2E tests. Run `npm run typecheck`,
   `npm run test:coverage`, `npm run build`, `npm run e2e`. For UI changes, drive the app with Playwright (Chromium is
   preinstalled; launch with `--use-angle=swiftshader --enable-unsafe-swiftshader`) and check
   screenshots. For Swift, re-read the diff carefully against Apple's API, since only CI compiles it.
5. **Finish.** Flip the item to `[x]`, add any follow-ups you discovered as new `[ ]` items in
   the right milestone, update docs, and mark the PR ready for review. PR body: what/why, how
   verified, screenshots (described), known gaps, and "Stacked on #N" with the PR below it.
   Check CI on your PR before ending; if red, fix and push.
6. If an item needs hardware or a human decision (e.g. a real iPhone capture, a hosting
   account), do what can be done, document the remaining manual step in the PR and
   `docs/MANUAL-STEPS.md`, and move on to the next item.

One roadmap item per session (two if both are small). Leave every PR in the stack green.
