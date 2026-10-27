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
- `tools/`: offline helpers (e.g. USDZ → GLB).
- `docs/ARCHITECTURE.md`: data contracts and pipeline. Keep it current when contracts change.
- `ROADMAP.md`: the backlog.

## Commands

```sh
npm ci
npm run dev         # http://localhost:5190
npm run typecheck
npm test            # vitest, apps/web/test
npm run build       # → dist/
```

The iOS app cannot be built on Linux. CI (`.github/workflows/ios.yml`) compiles it unsigned on
macOS for any PR touching `apps/ios/**`; treat that check as your compiler.

## Conventions

- Positions in scene JSON (annotations, hotspot views) are in **model-root space**, so changing
  `model.rotation/scale/offset` keeps comments attached. Convert with `Viewer.toWorld/toModel`.
- Pure logic goes in `src/scene/` with tests; three.js code stays in `src/viewer/`.
- Untrusted input (imported JSON, URLs, bundles) goes through a validating parser (`parseScene`).
- Every storage access is wrapped in try/catch (private mode, quotas).
- Match the existing code style (2-space TS, Prettier-ish 160 cols, sparse comments that explain *why*).
- Never commit real customer captures, photos or secrets. Generated fixtures only.

## Branching

- `main`: stable; only the owner merges into it (via the standing `develop → main` PR).
- `develop`: integration branch. Every feature PR targets `develop`.

## Autonomous session protocol

Sessions are started on a schedule with no human watching. Each session:

1. **Sync.** `git fetch origin develop main`, then base your work branch on `origin/develop`
   (`git checkout -B <your-branch> origin/develop`). Use the branch name your session was given.
2. **Triage open PRs into `develop` first** (GitHub MCP tools, repo `davidpn11/bike-3d-brew`):
   - CI green + mergeable + not draft → squash-merge it into `develop`.
   - CI red or conflicted → fix it on its branch (merge `develop` in, never force-push someone
     else's branch), push, and move on; merge it next session once green.
   - A draft PR whose last commit is older than 3 hours is abandoned: finish it or close it with a comment.
3. **Pick work.** The first `[ ]` item in `ROADMAP.md` that no open PR covers (check PR titles).
   Claim it immediately: push a first commit that flips it to `[~]` and open a **draft** PR to
   `develop` titled `[roadmap] <item name>`, so a parallel session doesn't take it too.
4. **Build it properly.** Small, reviewable diff. Add/extend unit tests. Run `npm run typecheck`,
   `npm test`, `npm run build`. For UI changes, drive the app with Playwright (Chromium is
   preinstalled; launch with `--use-angle=swiftshader --enable-unsafe-swiftshader`) and check
   screenshots. For Swift, re-read the diff carefully against Apple's API, since only CI compiles it.
5. **Finish.** Flip the item to `[x]`, add any follow-ups you discovered as new `[ ]` items in
   the right milestone, update docs, mark the PR ready for review. PR body: what/why, how
   verified, screenshots (described), known gaps.
6. **Keep the integration PR.** Ensure an open PR `develop → main` titled
   `Integration: develop → main` exists; update its body with a checklist of merged features.
7. If an item needs hardware or a human decision (e.g. a real iPhone capture, a hosting
   account), do what can be done, document the remaining manual step in the PR and
   `docs/MANUAL-STEPS.md`, and move on to the next item.

One roadmap item per session (two if both are small). Leave the repo green.
