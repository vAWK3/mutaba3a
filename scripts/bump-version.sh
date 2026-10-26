#!/usr/bin/env bash
#
# Interactive version bump.
#
#   scripts/bump-version.sh web      # website version: package.json + lock
#   scripts/bump-version.sh server   # API version: server/package.json + lock
#
# Asks for patch / minor / major / custom / keep, then writes the new version
# to every manifest that must agree. It does NOT commit — the caller decides
# what lands in the release commit.
#
# Non-interactive:
#   BUMP=patch|minor|major|keep scripts/bump-version.sh web
#   BUMP=custom BUMP_VERSION=1.2.3 scripts/bump-version.sh web

set -euo pipefail

MODE="${1:-}"
case "$MODE" in
  web|server) ;;
  *) echo "usage: $0 <web|server>" >&2; exit 2 ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

C_GREEN=$'\033[0;32m'; C_YELLOW=$'\033[1;33m'; C_CYAN=$'\033[0;36m'
C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'; C_RED=$'\033[0;31m'; C_NC=$'\033[0m'

if [[ "$MODE" == "web" ]]; then
  MANIFEST="package.json"
  LABEL="website"
else
  MANIFEST="server/package.json"
  LABEL="API service"
fi

CURRENT="$(node -p "require('./$MANIFEST').version")"

next_version() {
  local bump="$1"
  local major minor patch
  IFS=. read -r major minor patch <<<"$CURRENT"
  case "$bump" in
    major) echo "$((major + 1)).0.0" ;;
    minor) echo "${major}.$((minor + 1)).0" ;;
    patch) echo "${major}.${minor}.$((patch + 1))" ;;
  esac
}

# Prefer the controlling terminal so the prompt still works when stdin is a
# pipe (`make` recipes, `npm run`). /dev/tty can exist and still refuse to
# open, so probe by opening it rather than by testing the path.
if { exec 3</dev/tty; } 2>/dev/null; then TTY_IN=1; else TTY_IN=""; fi

# Read one line, falling back to stdin where there is no terminal. The
# trailing \r guard keeps this working on CRLF-terminated input.
read_line() {
  local __var="$1" __line
  if [[ -n "$TTY_IN" ]]; then
    IFS= read -r __line <&3 || return 1
  else
    IFS= read -r __line || return 1
  fi
  printf -v "$__var" '%s' "${__line%$'\r'}"
}

# Everything the operator reads goes to stderr: ask()'s stdout is the answer.
ask() {
  {
    printf '\n%sVersion — %s%s\n' "$C_BOLD" "$LABEL" "$C_NC"
    printf '  current: %s%s%s\n\n' "$C_CYAN" "$CURRENT" "$C_NC"
    printf '  %s1%s  patch   %s → %s%s%s   %sbug fixes, no behaviour change%s\n' \
      "$C_YELLOW" "$C_NC" "$CURRENT" "$C_GREEN" "$(next_version patch)" "$C_NC" "$C_DIM" "$C_NC"
    printf '  %s2%s  minor   %s → %s%s%s   %snew features, backwards compatible%s\n' \
      "$C_YELLOW" "$C_NC" "$CURRENT" "$C_GREEN" "$(next_version minor)" "$C_NC" "$C_DIM" "$C_NC"
    printf '  %s3%s  major   %s → %s%s%s   %sbreaking change%s\n' \
      "$C_YELLOW" "$C_NC" "$CURRENT" "$C_GREEN" "$(next_version major)" "$C_NC" "$C_DIM" "$C_NC"
    printf '  %s4%s  custom  %sexact X.Y.Z%s\n' "$C_YELLOW" "$C_NC" "$C_DIM" "$C_NC"
    printf '  %s5%s  keep    %sstay on %s%s\n\n' "$C_YELLOW" "$C_NC" "$C_DIM" "$CURRENT" "$C_NC"
  } >&2

  local answer
  while true; do
    printf '%sYour choice [1-5]: %s' "$C_BOLD" "$C_NC" >&2
    if ! read_line answer; then
      printf '\n%sNo answer (not a terminal) — set BUMP=patch|minor|major|keep instead.%s\n' \
        "$C_RED" "$C_NC" >&2
      exit 1
    fi
    case "$answer" in
      1) echo patch;  return ;;
      2) echo minor;  return ;;
      3) echo major;  return ;;
      4) echo custom; return ;;
      5) echo keep;   return ;;
      *) printf '%sPick 1, 2, 3, 4 or 5.%s\n' "$C_RED" "$C_NC" >&2 ;;
    esac
  done
}

BUMP="${BUMP:-}"
if [[ -z "$BUMP" ]]; then
  BUMP="$(ask)"
fi

case "$BUMP" in
  keep)
    printf '%sKeeping %s at %s%s\n' "$C_YELLOW" "$MANIFEST" "$CURRENT" "$C_NC"
    exit 0
    ;;
  custom)
    NEW="${BUMP_VERSION:-}"
    if [[ -z "$NEW" ]]; then
      printf '%sNew version (X.Y.Z): %s' "$C_BOLD" "$C_NC" >&2
      read_line NEW || { printf '\n%sNo answer — set BUMP_VERSION=X.Y.Z instead.%s\n' "$C_RED" "$C_NC" >&2; exit 1; }
    fi
    ;;
  patch|minor|major)
    NEW="$(next_version "$BUMP")"
    ;;
  *)
    echo "unknown BUMP: $BUMP (use patch|minor|major|custom|keep)" >&2
    exit 2
    ;;
esac

if [[ ! "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  printf '%sInvalid version "%s" — use X.Y.Z%s\n' "$C_RED" "$NEW" "$C_NC" >&2
  exit 1
fi

# `npm version` only rewrites the root package's own "version" field (that's
# why it's used over sed — see the comment below), so the dependency tree
# node_modules holds is still exactly what it was. But it does touch
# package-lock.json's mtime, and preflight.sh treats a lockfile newer than
# node_modules/.package-lock.json as stale deps. Without this, every release
# permanently "stales" node_modules for the next run, forcing a needless
# `npm ci` before preflight will even look at anything else.
refresh_install_stamp() {
  local dir="$1"
  [[ -d "$dir/node_modules" && -f "$dir/package-lock.json" ]] || return 0
  cp "$dir/package-lock.json" "$dir/node_modules/.package-lock.json"
}

if [[ "$MODE" == "server" ]]; then
  ( cd server && npm version "$NEW" --no-git-tag-version --allow-same-version --ignore-scripts >/dev/null )
  refresh_install_stamp server
  printf '%s✓%s server/package.json + server/package-lock.json → %s%s%s\n' "$C_GREEN" "$C_NC" "$C_GREEN" "$NEW" "$C_NC"
  exit 0
fi

npm version "$NEW" --no-git-tag-version --allow-same-version --ignore-scripts >/dev/null
refresh_install_stamp .
printf '%s✓%s package.json + package-lock.json → %s%s%s\n' "$C_GREEN" "$C_NC" "$C_GREEN" "$NEW" "$C_NC"
