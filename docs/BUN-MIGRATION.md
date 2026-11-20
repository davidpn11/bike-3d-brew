# Bun migration

Decision: use Bun 1.4.4 as the package manager and keep Node 22 as the runtime. Trial evidence is in [BUN-TRIAL.md](BUN-TRIAL.md). The package versions matched the npm resolution, frozen installs were stable, and builds passed. Vitest under Bun runtime failed with `ReferenceError: ProgressEvent is not defined` in three.js, so do not enable Bun runtime globally.

## Completed rollout

1. **Atomic package-manager cutover — done.** Commit 1 added root `bun.lock` and `apps/docs/bun.lock`, deleted both `package-lock.json` files, pinned `packageManager: "bun@1.4.4"` in both manifests, converted nested package-manager scripts and the Playwright web server, changed `tools/publish-pages.sh` and `orca.yaml`, and migrated `.github/workflows/ci.yml`, `pages.yml` and `pr-preview.yml` together. CI installs Bun 1.4.4 and caches `~/.bun/install/cache` using the relevant lock hashes. Jobs that run Node tools also set up Node 22. `prune-previews.yml` and `ios.yml` remain unchanged.
2. **Docs and agent cleanup — done.** Commit 2 updated README, AGENTS.md, docs, agent skills and wrappers to use `bun install --frozen-lockfile`, `bun run` and `bunx`. Commands that need the Node runtime retain explicit `node` invocations.

`trustedDependencies` is intentionally empty. Clean frozen installs and Vite, Next and esbuild-dependent docs builds pass without allowing install scripts. GitHub Actions remain on version tags (`oven-sh/setup-bun@v2`, `actions/*@v4`); SHA pinning was declined. Node 22 remains the runtime.

The optional `npx` calls in `tools/bench/bench.mjs` and `tools/optimize-glb.mjs` remain deferred, as specified in the rollout plan. Historical npm commands and observations remain in [BUN-TRIAL.md](BUN-TRIAL.md) as trial evidence.

## Verification

The rollout was verified from a clean dependency tree with two frozen installs at the root and docs package, with no lockfile changes; `bun run typecheck`, `bun run test:coverage`, `bun run build`, `bun run fixtures`, `bun run docs:build`, E2E on isolated port 4492, and a local-only PR preview build. The three changed workflows pass `actionlint`.

## Risks and rollback

- Bun install behavior may differ across operating systems or architectures. CI exercises frozen installs and the actual Vite, Next, esbuild and Playwright flows on Ubuntu.
- A future Bun runtime change can expose Node compatibility gaps. Keep Node 22 as runtime until those are separately tested.
- The cutover is independently revertable in commit 1: reverting it restores both npm lockfiles, npm workflow steps and package scripts together.
