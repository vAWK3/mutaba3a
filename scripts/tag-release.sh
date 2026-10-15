#!/usr/bin/env bash
#
# Tags a web or API release so release-qa can find the last one.
#
#   scripts/tag-release.sh web 0.1.7          # tag HEAD web-v0.1.7
#   scripts/tag-release.sh api 0.3.9 --push   # tag HEAD api-v0.3.9 and push the tag
#   scripts/tag-release.sh --backfill         # tag every past `release: <app> v<x>` commit
#
# release-qa (qa/qa.config.mjs) scopes a QA run to what changed since the newest
# `web-v*` tag (web app) or `api-v*` tag (API + hosted portal, which ship
# together through `make release server`). The desktop pipeline keeps its own
# plain `v*` tags.
#
# A tag that already points at another commit is never moved — that happens
# when a release keeps its version — and the script says so instead.

set -euo pipefail

C_GREEN=$'\033[0;32m'; C_YELLOW=$'\033[1;33m'; C_RED=$'\033[0;31m'; C_NC=$'\033[0m'

APPS_PATTERN='web|api'
RELEASE_SUBJECT_RE="^release: ($APPS_PATTERN) v[0-9]"

usage() {
  printf '%susage: %s <web|api> <version> [--push] | --backfill%s\n' "$C_RED" "$0" "$C_NC" >&2
  exit 2
}

# tag_commit <app> <version> <commit> [push]
tag_commit() {
  local app="$1" version="$2" commit="$3" push="${4:-}"
  local tag="${app}-v${version}"
  local existing

  if existing=$(git rev-parse -q --verify "refs/tags/${tag}^{commit}"); then
    if [[ "$existing" != "$(git rev-parse "$commit")" ]]; then
      printf '%s→ %s already points at %s — not moving it%s\n' \
        "$C_YELLOW" "$tag" "$(git rev-parse --short "$existing")" "$C_NC" >&2
      return 0
    fi
  else
    # Dated like the release commit, so `git tag --sort=-creatordate` (how
    # release-qa picks the baseline) orders backfilled tags correctly.
    GIT_COMMITTER_DATE="$(git log -1 --format=%cI "$commit")" \
      git tag -a "$tag" -m "Release ${app} v${version}" "$commit"
    printf '%s✓ tagged %s at %s%s\n' "$C_GREEN" "$tag" "$(git rev-parse --short "$commit")" "$C_NC"
  fi

  if [[ "$push" == "--push" ]]; then
    git push origin "refs/tags/${tag}"
  fi
}

backfill() {
  local sha subject app version
  while IFS=$'\t' read -r sha subject; do
    [[ "$subject" =~ ^release:\ (web|api)\ v([0-9][0-9A-Za-z.+-]*)$ ]] || continue
    app="${BASH_REMATCH[1]}"
    version="${BASH_REMATCH[2]}"
    tag_commit "$app" "$version" "$sha"
  done < <(git log --reverse -E --grep="$RELEASE_SUBJECT_RE" --format=$'%H\t%s')
}

case "${1:-}" in
  --backfill)
    backfill
    ;;
  web|api)
    [[ -n "${2:-}" ]] || usage
    tag_commit "$1" "$2" HEAD "${3:-}"
    ;;
  *)
    usage
    ;;
esac
