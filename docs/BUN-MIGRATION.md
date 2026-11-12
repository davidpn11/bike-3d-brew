# Bun migration plan

Decision: adopt Bun 1.4.4 as the package manager; keep Node 22 as the runtime for now. Trial evidence is in [BUN-TRIAL.md](BUN-TRIAL.md). Bun migrated both npm locks with matching tested package versions, `--frozen-lockfile` was stable, package builds passed, and warm installs were faster in this single local sample. Vitest under Bun runtime failed in three errors including `ReferenceError: ProgressEvent is not defined` in three.js. Browser E2E passed with Bun as script runner and Node/Playwright binaries; actual Playwright runtime support remains unverified.

## What stays on Node

- Keep Node 22 installed and on PATH for Playwright, npm scripts' explicit `node` calls, `node --test`, docs scripts and Next/MDX until each is intentionally moved and verified. The trial's successful `bun --bun run docs:build` is one result, not enough evidence to remove Node from all environments.
- Keep `bun run` as the script entry point, but note scripts with `node` commands and shebang binaries still dispatch Node. Use Node explicitly for runtime-sensitive tests until Bun runtime is independently green.
- `apps/web/playwright.config.ts:61-64` invokes `npx vite build`/`npx vite preview`. Replace with `bunx` or direct local binaries in its own verified edit; otherwise this keeps npm/npx on PATH. `tools/bench/bench.mjs:33-36` and `tools/optimize-glb.mjs:73` similarly use npx.

## Local changes

1. Pin Bun with `"packageManager": "bun@1.4.4"` in root `package.json` and `apps/docs/package.json`; keep `"engines": {"node": ">=22.12"}` while Node scripts remain.
2. Generate and commit text `bun.lock` at root and `apps/docs/bun.lock` from the current manifests. Remove `package-lock.json` and `apps/docs/package-lock.json` in the lockfile cutover PR; don't maintain two authoritative locks. Trial locks are generated from the current npm locks, with tested versions matching.
3. Run `bun install --frozen-lockfile` at root and `bun install --cwd apps/docs --frozen-lockfile` for docs. Use `bun pm untrusted` to audit scripts. Trial output showed no untrusted scripts; root npm had fsevents (optional) and docs had esbuild postinstall. Confirm Bun's trust behavior on CI and add `trustedDependencies` only for packages whose required install scripts demonstrably need it; validate esbuild and Next after any trust policy change.
4. Convert nested npm calls so `bun run` doesn't silently invoke npm: root `package.json:25-26` (`docs:dev`, `docs:build`); `apps/docs/package.json:8-11` (`dev`, `build`, `typecheck`); the Playwright `webServer` command in `apps/web/playwright.config.ts:61-64`; `tools/publish-pages.sh:78-83`; and optionally npx invocations in `tools/bench/bench.mjs:33-36`, `tools/optimize-glb.mjs:73`. Use `bun run --cwd apps/docs ...` / `bunx` or local executable paths and keep Node commands that are runtime-specific.
5. Change `orca.yaml:4` worktree bootstrap to `bun install --frozen-lockfile`; update onboarding and commands listed below.

Onboarding should state Bun 1.4.4 and Node 22 prerequisites, then:

```sh
bun install --frozen-lockfile
bun run dev
bun run typecheck && bun run test:coverage && bun run build
E2E_PORT=4292 bun run e2e
bun install --cwd apps/docs --frozen-lockfile
bun run --cwd apps/docs build
```

Use `bun run` for scripts but do not set `--bun` globally. Use Node for Vitest runtime-sensitive commands until the `ProgressEvent` failure is fixed and covered.

## GitHub Actions

Use `oven-sh/setup-bun@v2` with `bun-version: 1.4.4` and explicit cache on `~/.bun/install/cache`:

```yaml
- uses: oven-sh/setup-bun@v2
  with:
    bun-version: 1.4.4
- uses: actions/cache@v4
  with:
    path: ~/.bun/install/cache
    key: ${{ runner.os }}-bun-${{ hashFiles('bun.lock') }}
- uses: actions/setup-node@v4
  with:
    node-version: 22
- run: bun install --frozen-lockfile
```

For docs jobs use key `${{ runner.os }}-bun-docs-${{ hashFiles('apps/docs/bun.lock') }}` and `bun install --cwd apps/docs --frozen-lockfile`. Keep setup-node in the jobs while their scripts/tools use Node. `ci.yml` has a trial-only implementation of this shape; it keeps Node in all jobs for current scripts and changes root/docs package commands.

| Workflow | Planned changes | Node requirement |
|---|---|---|
| `.github/workflows/ci.yml` | Replace npm setup/cache/install/run with setup-bun, cache path above, frozen Bun install, `bun run` and `bunx playwright install`. Docs job uses docs lock/cache and Bun commands. | Retain setup-node for Node-based Playwright, scripts, and coverage-summary `node -e`. |
| `.github/workflows/pages.yml` | Set up Bun + cache both lockfiles; retain Node; frozen installs before `tools/publish-pages.sh`. | `publish-pages.sh` uses npm/node today; retain until converted. |
| `.github/workflows/pr-preview.yml` | Same setup/cache/install treatment as pages before publish script. | Same publish script reason; `actions/github-script` is an action and unaffected. |
| `.github/workflows/prune-previews.yml` | No package install expected; don't add Bun. | Inline `node` heredoc relies on runner Node. |
| `.github/workflows/ios.yml` | No package-manager change unless inspection confirms web dependencies; currently Swift/Xcode workflow. | Swift/Xcode toolchain only; no Bun needed. |

Cache keys: include lockfile hash and OS; docs must key its own lock. Never cache `node_modules`. Keep setup-node after setup-bun in jobs where runtime Node is used.

## Inventory of npm/Node assumptions

| Location | References / planned action |
|---|---|
| `package.json:6-9,19-26` | Node engine and scripts; node commands in coverage/fixture helpers, nested npm for docs. Add packageManager and convert nested npm. |
| `apps/docs/package.json:6-11` | Node script commands and nested npm sync; change package calls to Bun, retain `node` where runtime tested/needed. |
| `package-lock.json`, `apps/docs/package-lock.json` | npm locks; replace with root and docs Bun text locks in lockfile cutover. Install-script entries: fsevents 2.3.3 and docs esbuild 0.28.2. |
| `.github/workflows/ci.yml:13-104` | setup-node/npm cache/npm ci/npm scripts/npx Playwright and node summary. Trial-only Bun edit exists. |
| `.github/workflows/pages.yml:52-63` | setup-node with npm cache; calls `tools/publish-pages.sh`. |
| `.github/workflows/pr-preview.yml:30-46` | setup-node/npm cache then publish script. |
| `.github/workflows/prune-previews.yml:30-32` | inline Node script; no dependency install. |
| `.github/workflows/ios.yml` | No npm, npx, or Node reference found. |
| `tools/publish-pages.sh:78-92,135` | npm installs/builds, Node fixture and inline scripts. |
| `tools/bench/bench.mjs:1,4,33-36`; `tools/optimize-glb.mjs:1,4,9,50,73,94` | Node shebang/commands; npx commands. |
| `tools/coverage/e2e-coverage.mjs:1,6,93,99`; `tools/fixtures/*.mjs`; `tools/reconstruct/cli.mjs:1,10`; `tools/publish-scene.mjs:1,7` | Node shebangs and usage examples; retain runtime as Node-compatible commands unless separately tested. `tools/fixtures/render-photos.mjs:24-26` also calls global `npm root -g` fallback. |
| `apps/docs/scripts/sync-content.mjs:1,7-10`; `apps/docs/scripts/lib.mjs:1`; `apps/docs/scripts/lib.test.mjs:1-2` | Node shebang, child_process and `node --test`. |
| `apps/web/playwright.config.ts:37,53,61-64`; `apps/web/vite.config.ts:20` | Playwright setup docs and `npx` webServer command; command line comments mention npm. |
| `orca.yaml:4` | npm worktree bootstrap; change to frozen Bun install. |
| `README.md:10`; `AGENTS.md:27-44,113-139`; `docs/TESTING.md:7-10,20,50,59,69-102,124,154-173`; `docs/TESTING-GUIDE.md:36-46,57,76-84`; `docs/GOALS.md:23`; `docs/PERFORMANCE.md:29-49`; `docs/RECONSTRUCTION.md:110,126,133`; `docs/ARCHITECTURE.md:184`; `docs/MANUAL-STEPS.md:8` | Onboarding/test/reconstruction commands and agent workflow use npm/node; update npm commands and install guidance, preserve Node runtime commands where they remain supported. |
| `.agents/skills/{architect,docs-engineer,junior-engineer,quality-engineer,viewer-engineer,web-engineer}/SKILL.md`; `.claude/agents/claude-runner.md` | Agent command guidance references npm; align with Bun install/run workflow. `.codex/agents/**` has no npm/node references found in this scan. |

No `.nvmrc` or `.node-version` was found. `apps/ios/README.md` has no JS package setup. `apps/web/vite.config.ts` and `apps/docs/next.config.mjs` don't otherwise configure a package manager. Docs build uses Next and should retain Node toolchain pending wider verification.

## Rollout

Two PRs, each green on its own. The lockfile and the workflows switch **together**: committing `bun.lock`
while CI still runs `npm ci` would leave the Bun lock untested and drifting, and two authoritative lockfiles
is exactly what this plan avoids.

1. **Cutover PR (atomic, one revert undoes it):**
   - commit `bun.lock` and `apps/docs/bun.lock`, regenerated from the current manifests;
   - delete both `package-lock.json` files;
   - add `packageManager: "bun@1.4.4"`;
   - convert the nested npm/npx calls (the `docs:*` scripts, `apps/docs` scripts, the Playwright `webServer`, and
     `tools/publish-pages.sh`);
   - update `orca.yaml`;
   - migrate `ci.yml`, `pages.yml` and `pr-preview.yml` as in the table above.

   Verify:
   - a full CI run (web, docs, both E2E shards, merged coverage);
   - a PR preview build from this PR;
   - `bun install --frozen-lockfile` on a clean clone on macOS.

   Optional tool scripts (`tools/bench`, `tools/optimize-glb.mjs`) can keep `npx` for now; it still works when
   Node is installed.
2. **Docs and agent cleanup PR:** README, AGENTS.md, docs/*.md and the agent skills switch to `bun install` /
   `bun run`, keeping `node` where a command really needs the Node runtime. A final grep for `npm ` and `npx `
   finds only intentional leftovers, each with a reason.

Bun as the *runtime* (`--bun`) is a separate, later decision. It is blocked by the Vitest/three.js
`ProgressEvent` failure and needs its own trial.

## Risks and rollback

- Bun may install lifecycle dependencies differently across macOS/Linux or architectures; exercise frozen installs and actual esbuild/Next/Playwright jobs on Ubuntu before lock deletion.
- `bunx` may resolve packages differently from npx; Playwright installation and the configured local server must be checked in CI.
- A Bun runtime upgrade can expose Node compatibility gaps; keep runtime fixed at Node 22 and pin Bun 1.4.4.
- Roll back the package-manager switch by reverting the cutover PR: it restores both `package-lock.json` files, the npm workflow steps and the scripts in one commit. This only works because nothing else ships in that PR.

## Open questions for owner

- Should Bun be pinned at 1.4.4 in `packageManager` and setup-bun, or should CI use a newer version before cutover? Trial used the requested 1.4.4.
- Should lifecycle trust be explicitly allow-listed in `trustedDependencies` after Linux CI proves whether esbuild scripts are required, or left empty when builds pass?
- Is there a policy preference for pinning GitHub Actions by SHA in addition to version tags?
