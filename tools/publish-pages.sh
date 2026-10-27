#!/usr/bin/env bash
# Publishes the owner's site to the `gh-pages` branch (GitHub Pages: deploy from branch, root):
#
#   /            docs + progress site (apps/docs, Fumadocs static export)
#   /app/        the web viewer (Vite build, relative base)
#   /app/samples/synthetic-bike.bikecapture.zip   generated test bundle
#
# Usage: tools/publish-pages.sh [--source <branch>] [--out <dir>] [--no-push]
#   --source <branch>  note which branch/PR the site was built from (default: current branch)
#   --out <dir>        also copy the assembled site to <dir> (e.g. to preview it locally)
#   --no-push          build and assemble only; do not touch gh-pages
#
# Safe to run repeatedly from any branch: builds the current checkout, commits into a temporary
# worktree of origin/gh-pages (your checkout and branches are untouched), and skips the commit
# when nothing changed (Shiki highlighting can still differ run to run in rare spots).
set -euo pipefail

source_note=""
out_dir=""
push=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) source_note="${2:?--source needs a value}"; shift 2 ;;
    --out) out_dir="${2:?--out needs a directory}"; shift 2 ;;
    --no-push) push=0; shift ;;
    -h | --help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "publish-pages: unknown argument: $1" >&2; exit 2 ;;
  esac
done

root="$(git rev-parse --show-toplevel)"
cd "$root"
sha="$(git rev-parse --short HEAD)"
branch="$(git rev-parse --abbrev-ref HEAD)"
source_note="${source_note:-$branch}"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "publish-pages: warning: uncommitted changes; the site will say '$sha+local changes'." >&2
fi

tmp="$(mktemp -d "${TMPDIR:-/tmp}/publish-pages.XXXXXX")"
worktree="$tmp/gh-pages"
cleanup() {
  git -C "$root" worktree remove --force "$worktree" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

# Pin timestamps and build ids to the commit so republishing the same commit is (nearly) a no-op.
export SOURCE_DATE_EPOCH="$(git log -1 --format=%ct)"
export DOCS_BUILT_AT="$(git log -1 --format=%cI)"
export DOCS_BUILD_ID="$sha"
export DOCS_GIT_BRANCH="$source_note"

echo "==> Building viewer"
[[ -d node_modules ]] || npm ci --no-audit --no-fund
npm run build

echo "==> Building docs"
[[ -d apps/docs/node_modules ]] || npm --prefix apps/docs ci --no-audit --no-fund
npm --prefix apps/docs run build

echo "==> Assembling site"
site="$tmp/site"
mkdir -p "$site/app"
cp -R apps/docs/out/. "$site/"
cp -R dist/. "$site/app/"
node tools/make-test-bundle.mjs "$site/app/samples/synthetic-bike.bikecapture.zip"
touch "$site/.nojekyll"

# The repo is private but the site is public: refuse anything that looks like a real capture
# or a credential.
leaks="$(find "$site" -type f \( -iname '*.usdz' -o -iname '*.heic' -o -iname '*.mov' -o -iname '*.pem' -o -iname '.env*' \
  -o \( -iname '*.bikecapture.zip' -not -name 'synthetic-bike.bikecapture.zip' \) \) -print)"
# AWS key ids must stand alone: inlined WASM (e.g. libheif-js) is base64 and contains "AKIA…" runs.
if grep -rIlE -- '-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|(^|[^A-Za-z0-9+/])AKIA[0-9A-Z]{16}([^A-Za-z0-9+/=]|$)' "$site" >/dev/null 2>&1; then
  leaks+=$'\n'"(secret-looking strings in: $(grep -rIlE -- '-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|(^|[^A-Za-z0-9+/])AKIA[0-9A-Z]{16}([^A-Za-z0-9+/=]|$)' "$site" | tr '\n' ' '))"
fi
if [[ -n "${leaks//[$'\n ']/}" ]]; then
  echo "publish-pages: refusing to publish, these look private:" >&2
  echo "$leaks" >&2
  exit 1
fi

if [[ -n "$out_dir" ]]; then
  rm -rf "$out_dir"
  mkdir -p "$out_dir"
  cp -R "$site/." "$out_dir/"
  echo "==> Site copied to $out_dir"
fi
[[ "$push" == 1 ]] || { echo "==> --no-push: done"; exit 0; }

echo "==> Committing to gh-pages"
if git fetch --quiet origin gh-pages 2>/dev/null; then
  # Detached, so it never clashes with a local gh-pages branch checked out elsewhere.
  git worktree add --quiet --detach "$worktree" FETCH_HEAD
else
  git worktree add --quiet --detach "$worktree" HEAD
  git -C "$worktree" checkout --quiet --orphan gh-pages-publish
fi
git -C "$worktree" rm -r --quiet --cached --ignore-unmatch . >/dev/null
find "$worktree" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R "$site/." "$worktree/"
git -C "$worktree" add -A
if git -C "$worktree" diff --cached --quiet; then
  echo "==> gh-pages already up to date with $sha"
  exit 0
fi
git -C "$worktree" commit --quiet -m "Publish $sha" -m "Source: $source_note ($(git log -1 --format=%H))"
git -C "$worktree" push --quiet origin HEAD:refs/heads/gh-pages
echo "==> Published $sha from $source_note: https://davidpn11.github.io/bike-3d-brew/"
