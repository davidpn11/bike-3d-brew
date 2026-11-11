#!/usr/bin/env bash
# Publishes the owner's site to the `gh-pages` branch (GitHub Pages: deploy from branch, root):
#
#   /            docs + progress site (apps/docs, Fumadocs static export)
#   /app/        the web viewer (Vite build, relative base)
#   /app/samples/synthetic-bike.bikecapture.zip   generated test bundle
#   /pr/<n>/     preview of PR <n> (same layout), all listed in /pr/index.json
#
# Usage: tools/publish-pages.sh [--source <branch>] [--pr <n> [--title <t>]] [--remove-pr <n>] [--out <dir>] [--no-push]
#   --source <branch>  note which branch/PR the site was built from (default: current branch)
#   --pr <n>           publish this checkout as the preview of PR <n>, under /pr/<n>/ only
#   --title <t>        PR title for the previews list (with --pr)
#   --remove-pr <n>    delete the preview of PR <n> (no build)
#   --out <dir>        also copy the assembled site to <dir> (e.g. to preview it locally)
#   --no-push          build and assemble only; do not touch gh-pages
#
# Safe to run repeatedly from any branch: builds the current checkout, commits into a temporary
# worktree of origin/gh-pages (your checkout and branches are untouched), and skips the commit
# when nothing changed (Shiki highlighting can still differ run to run in rare spots).
# Each mode replaces only its own part of gh-pages: the main site keeps /pr/, a preview touches
# only /pr/<n>/. CI runs it from .github/workflows/pages.yml (develop) and pr-preview.yml (PRs).
set -euo pipefail

source_note=""
out_dir=""
push=1
pr=""
pr_title=""
remove_pr=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) source_note="${2:?--source needs a value}"; shift 2 ;;
    --pr) pr="${2:?--pr needs a number}"; shift 2 ;;
    --title) pr_title="${2?--title needs a value}"; shift 2 ;;
    --remove-pr) remove_pr="${2:?--remove-pr needs a number}"; shift 2 ;;
    --out) out_dir="${2:?--out needs a directory}"; shift 2 ;;
    --no-push) push=0; shift ;;
    -h | --help) sed -n '2,21p' "$0"; exit 0 ;;
    *) echo "publish-pages: unknown argument: $1" >&2; exit 2 ;;
  esac
done
# The number becomes a path on gh-pages: digits only.
for n in "$pr" "$remove_pr"; do
  [[ -z "$n" || "$n" =~ ^[1-9][0-9]*$ ]] || { echo "publish-pages: PR number must be a positive integer: $n" >&2; exit 2; }
done
[[ -z "$pr" || -z "$remove_pr" ]] || { echo "publish-pages: --pr and --remove-pr are exclusive" >&2; exit 2; }

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
site="$tmp/site"
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
if [[ -n "$pr" ]]; then
  # Next bakes its basePath into every URL; the viewer has a relative base and needs nothing.
  export DOCS_BASE_PATH="/bike-3d-brew/pr/$pr" DOCS_SITE_ROOT="/bike-3d-brew"
fi

build_site() {
  echo "==> Building viewer"
  [[ -d node_modules ]] || npm ci --no-audit --no-fund
  npm run build

  echo "==> Building docs"
  [[ -d apps/docs/node_modules ]] || npm --prefix apps/docs ci --no-audit --no-fund
  npm --prefix apps/docs run build

  echo "==> Assembling site"
  mkdir -p "$site/app"
  cp -R apps/docs/out/. "$site/"
  cp -R dist/. "$site/app/"
  node tools/make-test-bundle.mjs "$site/app/samples/synthetic-bike.bikecapture.zip"
  touch "$site/.nojekyll"
  if [[ -n "$pr" ]]; then
    PR="$pr" TITLE="$pr_title" SRC="$source_note" SHA="$sha" node -e '
      const e = process.env;
      console.log(JSON.stringify({ number: Number(e.PR), title: e.TITLE, branch: e.SRC, sha: e.SHA, updatedAt: e.DOCS_BUILT_AT }));
    ' >"$site/preview.json"
  fi

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
}
[[ -n "$remove_pr" ]] || build_site
[[ "$push" == 1 ]] || { echo "==> --no-push: done"; exit 0; }

# Replaces only this run's part of the gh-pages tree in $worktree, then rebuilds /pr/index.json.
apply() {
  if [[ -n "$remove_pr" ]]; then
    rm -rf "$worktree/pr/$remove_pr"
  elif [[ -n "$pr" ]]; then
    rm -rf "$worktree/pr/$pr"
    mkdir -p "$worktree/pr/$pr"
    cp -R "$site/." "$worktree/pr/$pr/"
  else
    find "$worktree" -mindepth 1 -maxdepth 1 ! -name .git ! -name pr -exec rm -rf {} +
    cp -R "$site/." "$worktree/"
  fi
  [[ -d "$worktree/pr" ]] || return 0
  node -e '
    const fs = require("fs"), path = require("path"), dir = process.argv[1], list = [];
    for (const n of fs.readdirSync(dir)) {
      try { list.push(JSON.parse(fs.readFileSync(path.join(dir, n, "preview.json"), "utf8"))); } catch {}
    }
    list.sort((a, b) => b.number - a.number);
    fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(list, null, 2) + "\n");
  ' "$worktree/pr"
}

what="$sha from $source_note"
url="https://davidpn11.github.io/bike-3d-brew/"
if [[ -n "$pr" ]]; then what="preview of PR #$pr ($sha)"; url+="pr/$pr/"; fi
[[ -z "$remove_pr" ]] || what="removal of the PR #$remove_pr preview"

echo "==> Committing to gh-pages"
# Other runs (develop, other PRs' previews) may push in between: refetch and reapply when rejected.
for attempt in 1 2 3 4 5; do
  git -C "$root" worktree remove --force "$worktree" >/dev/null 2>&1 || true
  if git fetch --quiet origin gh-pages 2>/dev/null; then
    # Detached, so it never clashes with a local gh-pages branch checked out elsewhere.
    git worktree add --quiet --detach "$worktree" FETCH_HEAD
  else
    git worktree add --quiet --detach "$worktree" HEAD
    git -C "$worktree" checkout --quiet --orphan gh-pages-publish
    git -C "$worktree" rm -r --quiet --cached --ignore-unmatch . >/dev/null
    find "$worktree" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
  fi
  apply
  git -C "$worktree" add -A
  if git -C "$worktree" diff --cached --quiet; then
    echo "==> gh-pages already up to date ($what)"
    exit 0
  fi
  git -C "$worktree" commit --quiet -m "Publish $what" -m "Source: $source_note ($(git log -1 --format=%H))"
  if git -C "$worktree" push --quiet origin HEAD:refs/heads/gh-pages; then
    echo "==> Published $what: $url"
    exit 0
  fi
  echo "publish-pages: push rejected (attempt $attempt), retrying on the latest gh-pages" >&2
  sleep $((attempt * 5))
done
echo "publish-pages: giving up after 5 attempts" >&2
exit 1
