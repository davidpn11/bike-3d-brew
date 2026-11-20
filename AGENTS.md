# bike-3d-brew: agent guide (Claude Code + Codex)

Capture bikes with an iPhone (Apple Object Capture), view them as background-free 3D models
in the browser, zoom into areas (fork, drivetrain, cockpit…) and pin sales comments on them.
Inspired by [wesbos/3d-model-anything](https://github.com/wesbos/3d-model-anything) (posed
iPhone photos + LiDAR → three.js), adapted from rooms to a single object.

## Layout

- `apps/web/`: Vite + TypeScript + three.js viewer/editor (no UI framework; `ui/dom.ts` `h()` helper).
  - `src/scene/`: pure logic (`schema.ts` = `bike-scene/1` format + validation, `store.ts`, `camera.ts`). Unit-tested in `apps/web/test/`.
  - `src/viewer/`: three.js (`Viewer.ts`, `loaders.ts`, `pins.ts`, `demoBike.ts`).
  - `src/storage/`: browser storage adapters (OPFS / IndexedDB) behind interfaces defined in `src/scene/`.
  - `src/ui/app.ts`: modes (view / edit / present), panel, comment editor, file drop.
- `apps/ios/`: SwiftUI capture app (`project.yml` for xcodegen). Object Capture → `model.usdz` + `poses.json` → `*.bikecapture.zip` (`bike-capture/1`).
- `apps/web/e2e/`: Playwright suite; `window.__bike` test hook (only with `?e2e` or in dev).
- `apps/docs/`: Fumadocs (Next.js static export) docs + progress site. Own `package.json`; its pages are
  generated from the repo's markdown by `scripts/sync-content.mjs` (README, ROADMAP, CHANGELOG, `docs/*.md`),
  so edit the markdown, never `apps/docs/content/`.
- `tools/`: offline helpers (USDZ → GLB, `publish-pages.sh`; `tools/fixtures/make-capture-bundle.mjs` the one synthetic-bundle generator: E2E variants, `--photos` bundle with close-up poses, `--sample` Pages sample; `render-photos.mjs` renders its photos from the poses; `tools/coverage/e2e-coverage.mjs` E2E V8 coverage → Istanbul, merged with the unit report).
- `docs/ARCHITECTURE.md`: data contracts and pipeline. Keep it current when contracts change.
- `ROADMAP.md`: the backlog.

## Commands

```sh
bun install --frozen-lockfile
bun run dev         # http://localhost:5190
bun run typecheck
bun run test            # vitest, apps/web/test
bun run test:coverage  # + V8 coverage; fails under the thresholds in apps/web/vite.config.ts
bun run build       # → dist/
bun run e2e         # Playwright, apps/web/e2e (builds + serves dist/ itself)
bun run fixtures    # synthetic *.bikecapture.zip fixtures → apps/web/e2e/.fixtures/
bun run docs:dev    # docs site, http://localhost:5191/bike-3d-brew/ (installs: bun install --cwd apps/docs --frozen-lockfile)
bun run docs:build  # → apps/docs/out/
bun run e2e:coverage && bun run coverage:merge   # E2E V8 coverage merged with the unit report → coverage-all/
node tools/fixtures/make-capture-bundle.mjs --sample /tmp/test.bikecapture.zip   # synthetic capture bundle
tools/publish-pages.sh [--source <branch>]   # build docs + viewer, push to gh-pages (the live site)
tools/publish-pages.sh --pr <n> --no-push --out /tmp/site   # PR-preview build (basePath /bike-3d-brew/pr/<n>), local only
```

Testing is documented in `docs/TESTING.md`. In agent containers Chromium is preinstalled: run
E2E with `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium bun run e2e` and never `playwright install`.

The owner follows progress at https://davidpn11.github.io/bike-3d-brew/ (viewer at `/app/`).
Publishing is automatic: every push to the stack tip (or `develop` when no PR is open) republishes
the main site (`.github/workflows/pages.yml`), and every open PR from this repo gets a preview at
`/bike-3d-brew/pr/<n>/` (viewer at `/pr/<n>/app/`) that is removed when the PR closes
(`pr-preview.yml`). Both run `tools/publish-pages.sh`; each only replaces its own part of gh-pages.

The iOS app cannot be built on Linux. CI (`.github/workflows/ios.yml`) compiles it unsigned on
macOS for any PR touching `apps/ios/**`; treat that check as your compiler. On a Mac with Xcode,
build it locally first (see the `ios-engineer` skill).

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

## Agents: who does what

Work is split by role, and each role runs on the tool it suits best. One persona skill per role
lives in `.agents/skills/<role>/SKILL.md` (Codex reads that folder; `.claude/skills/<role>` symlinks
to it), so both tools follow the same workflow. Thin wrappers pick the model and carry the platform prefix: `.claude/agents/claude-<role>.md`
(agent `claude-<role>`) for Claude Code, `.codex/agents/codex-<role>.toml` (agent `codex_<role>`) for Codex. The `delegation` skill has the
brief format and response contract; the `architect` skill splits a roadmap item into tasks.

| Role | Owns | Default runtime | Why |
| ---- | ---- | --------------- | --- |
| `architect` | the session protocol below, task split, PRs | Claude main session (`claude --agent claude-architect`) | Holds the user conversation, GitHub, the PR stack and Orca orchestration |
| `scout`, `runner` | read-only lookups; running commands | Claude subagent, haiku | Cheap work on a cheap model |
| `junior-engineer` | easy, fully specified edits anywhere (renames, copy, known small fixes, bumps, one extra test) | Codex worker, low effort | Cheapest writer; returns `needs_replan` for anything needing judgment or touching a contract |
| `web-engineer` | `apps/web/src/{scene,storage,ui,present}` | Claude subagent, sonnet | UI flows are checked in a browser with screenshots |
| `viewer-engineer` | `apps/web/src/viewer/**` (three.js, USD, BVH, workers), `tools/*.mjs` | Codex worker | Algorithmic, self-contained tasks with numeric checks |
| `ios-engineer` | `apps/ios/**` | Codex worker on the Mac | Disjoint from the web code; long xcodebuild loops in its own worktree |
| `quality-engineer` | `apps/web/test`, `apps/web/e2e`, fixtures | Claude subagent, sonnet | E2E needs the browser; owns coverage |
| `docs-engineer` | `docs/*.md`, README, ROADMAP, CHANGELOG, `apps/docs` | Claude subagent, haiku | Prose, small diffs |
| `security-engineer` | read-only audit of untrusted input | Codex worker | A second model family audits Claude-written code |
| `reviewer` | read-only review of a finished diff | the *other* family from the author | Claude reviews Codex diffs, Codex reviews Claude diffs |

Codex workers start through Orca (`orca orchestration worker-start --agent codex …`, see the
`orchestration` and `orca-cli` skills). When Orca is not reachable (`orca status` fails, e.g. a
scheduled cloud session), run the same persona as a Claude subagent instead; the routing is a
default, never a blocker. When Codex is the main session it plays `architect` with its own
`.codex/agents` and starts Claude workers the same way (`--agent claude`).


## Branching: stacked PRs, humans merge

Agents **never merge PRs**; the owner reviews and merges. To keep building while PRs wait
for review, work is **stacked**:

- `main`: stable. `develop`: integration branch; the bottom PR of the stack targets it.
- Every other PR targets the head branch of the PR directly below it, forming a chain:
  `develop ← PR1 ← PR2 ← PR3 …`. The owner merges bottom-up (GitHub retargets the next PR
  automatically when the merged branch is deleted).
- The **stack tip** is the newest open `[roadmap]` (or foundation) PR whose head branch no
  other open PR uses as its base. If nothing is open, the tip is `develop`.

## Parallel agents and worktrees

Several agents can build roadmap items at once, each in its own git worktree:

- One worktree per branch under `.claude/worktrees/<name>` (gitignored):
  `git worktree add -B claude/<item> .claude/worktrees/<item> origin/<tip-branch>`, then `bun install --frozen-lockfile` inside it.
- Give each worktree its own E2E port (`E2E_PORT=4191 bun run e2e`, 4192, …). The suite never reuses a
  server already on the port, so a clash fails fast instead of testing another checkout's build.
- Parallel items start from the same tip and open their PRs against it. When they are done, chain them
  (merge the previous PR's branch into the next one, resolve ROADMAP/CHANGELOG/TESTING-GUIDE by keeping
  both sides, retarget the PR) so the stack stays one line.
- Pick items that touch different files; `ui/app.ts` and `scene/schema.ts` changes are the usual conflicts.
- The site publishes itself: `.github/workflows/pages.yml` republishes whenever the stack tip is pushed,
  and every PR gets a preview at `/bike-3d-brew/pr/<n>/`.

## Autonomous session protocol

Sessions are started on a schedule with no human watching. Each session:

1. **Sync.** `git fetch origin`. List open PRs (GitHub MCP tools or `gh`, repo `davidpn11/bike-3d-brew`)
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
4. **Build it properly.** Small, reviewable diff. Add/extend unit and E2E tests. Run `bun run typecheck`,
   `bun run test:coverage`, `bun run build`, `bun run e2e`. For UI changes, drive the app with Playwright (Chromium is
   preinstalled; launch with `--use-angle=swiftshader --enable-unsafe-swiftshader`) and check
   screenshots. For Swift, re-read the diff carefully against Apple's API, since only CI compiles it.
5. **Finish.** Flip the item to `[x]`, add any follow-ups you discovered as new `[ ]` items in
   the right milestone, update docs, and mark the PR ready for review. PR body: what/why, how
   verified, screenshots (described), known gaps, and "Stacked on #N" with the PR below it.
   Check CI on your PR before ending; if red, fix and push. The site republishes itself when
   your branch is the stack tip (check Actions → "Publish site"); add a row for your PR to "What each PR adds" in `docs/TESTING-GUIDE.md`.
6. If an item needs hardware or a human decision (e.g. a real iPhone capture, a hosting
   account), do what can be done, document the remaining manual step in the PR and
   `docs/MANUAL-STEPS.md`, and move on to the next item.

One roadmap item per session (two if both are small). Leave every PR in the stack green.
