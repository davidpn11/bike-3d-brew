# Bun trial evidence

Trial date: 2026-11-12. Bun 1.4.4 on macOS; existing Node 24.18.0 runtime and warm npm/Bun download caches. Wall times are rounded to seconds from shell wall clock; npm baseline ran before Bun install on a clean `node_modules` for each project. Later Bun operations used Bun-created `node_modules`.

| Step | npm result/time | Bun result/time | Notes |
|---|---|---|---|
| Root clean install | `npm ci` exit 0, 4s | `bun install` exit 0, 1s | Bun said `migrated lockfile from package-lock.json`; installed listed versions exactly matching root npm resolution. `bun.lock` created as text. |
| Docs clean install | `npm --prefix apps/docs ci` exit 0, 10s | `(cd apps/docs && bun install)` exit 0, 2s | Bun migrated docs package-lock; exact direct versions matched. These are single warm-cache measurements, not a benchmark. |
| Root versions | `npm ls --all --json`: exit 0, <1s | `bun pm ls --all`: exit 0, <1s | three 0.186.1; vite 8.3.5; vitest 5.0.5; @playwright/test 1.63.0; typescript 7.0.2 in both. `next` absent in root as expected. |
| Docs versions | `npm --prefix apps/docs ls --all --json`: exit 0, <1s | `(cd apps/docs && bun pm ls --all)`: exit 0, <1s | next 16.4.3 and typescript 7.0.2 in both; web-only keys absent. |
| Bun frozen lock | n/a | `bun install --frozen-lockfile` exit 0, <1s | checked 95 root installs / 165 packages with no changes. Docs frozen install also exit 0, checked 285 / 394 with no changes. A second root install reported no changes. Lock hashes stayed stable. |
| `bun run typecheck` | n/a | exit 0, 1s | `tsc --noEmit`. |
| `bun run test:coverage` | n/a | exit 0, 5s | Vitest on Node; statement coverage 98.95%, lines 99.63%. |
| `bun run build` | n/a | exit 0, 1s | TypeScript + Vite. |
| `E2E_PORT=4292 bun run e2e` | n/a | exit 0, 310s | 102 Playwright tests passed desktop + mobile. Playwright binary uses Node and Chromium; E2E's webServer invokes `npx vite build` and `npx vite preview`, which fell through to npm/npx from PATH and worked. |
| `bun run fixtures` | n/a | exit 0, <1s | Script invokes `node tools/fixtures/make-capture-bundle.mjs`; Node worked. |
| `bun run docs:build` | n/a | exit 0, 11s | Script invokes `npm --prefix apps/docs run build`; nested npm then invokes `npm run sync` and Next. Silent migration to npm for the package-manager operations. |
| `bun run e2e:coverage && bun run coverage:merge` | n/a | compound exit 1, 1s | E2E coverage did not start: Playwright reported `Error: http://localhost:4190 is already used...`; merge then reported `No E2E coverage: run \`npm run e2e:coverage\` first`. Not a Bun compatibility result; full non-coverage E2E passed on isolated 4292. Coverage E2E not retried because the full suite took 5m10s. |
| `bun --bun run test` | n/a | exit 1, 12s | Vitest running in Bun runtime: 34/35 files and 362/364 tests passed, but 2 tests failed / 3 errors. Key failure: `ReferenceError: ProgressEvent is not defined` from `three/build/three.core.js:45169` in `test/compressed.test.ts`. |
| Bun sample fixture | n/a | `bun tools/fixtures/make-capture-bundle.mjs --sample /tmp/t.bikecapture.zip` exit 0, <1s | Wrote a 52 KB bundle. |
| Bun reconstruct help | n/a | `bun tools/reconstruct/cli.mjs --help` exit 0, <1s | Help printed correctly. |
| Bun-runtime web build | n/a | `bun --bun run build` exit 0, 1s | TypeScript/Vite build succeeded under Bun runtime. |
| Bun-runtime Playwright | n/a | `bun --bun run e2e -- --list` exit 0, 1s | One bounded runtime attempt: Playwright listed 102 tests; did not launch browser or webServer. Full browser E2E was run with Node binaries. |
| Bun-runtime Next | n/a | `bun --bun run docs:build` exit 0, 4s | One runtime attempt built docs successfully. Nested npm script still starts `npm run sync`; Next build completed. |

## Install scripts and compatibility failures

- npm emitted its local `allow-scripts` policy warnings: root `fsevents@2.3.3` (optional platform package) and docs `esbuild@0.28.2` (`node install.js`). Bun emitted no untrusted-script warning; `bun pm untrusted` reported zero. Bun-created dependencies passed Vite, Next, and docs builds, including esbuild-dependent operations. No `sharp` package exists in either lockfile; the `sharp` mentions in `tools/optimize-glb.mjs` describe an optional install. `package-lock.json` marks only fsevents and docs esbuild with `hasInstallScript`.
- The only runtime failure observed was Vitest + three.js under `bun --bun`: missing global `ProgressEvent`. Keep Vitest and browser/tool execution on Node pending a dedicated runtime fix and full verification.
- `bun run docs:build` succeeds but the root and docs scripts explicitly invoke `npm`; successful output shows `npm --prefix apps/docs run build` then `npm run sync`. This silently retains npm as a script runner for those nested commands. Playwright's configured server explicitly invokes `npx` in `apps/web/playwright.config.ts` and succeeds by resolving npx from PATH. The plan should replace those nested package-manager calls with Bun equivalents or clearly retain npm, not leave an accidental fallback.
- First merged-coverage compound command failed due to unrelated port 4190 occupancy. The requested isolated full E2E on port 4292 passed.

## Recommendation

Adopt Bun 1.4.4 as package manager only in a staged migration, retaining Node 22 as runtime for CI and browser tooling. Measurements show exact tested versions, deterministic text locks, frozen install success, and about 4x/5x faster warm installs in this one local trial. The runtime trial is mixed: web/docs build and plain Node-compatible tools worked, while Vitest failed on `ProgressEvent`; Playwright runtime was only listed, not browser-executed. This is trial evidence, not a claim of cold-cache or CI performance.
