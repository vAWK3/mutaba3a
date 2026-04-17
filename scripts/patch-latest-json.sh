#!/usr/bin/env bash
#
# Hotfix: patch an already-published latest.json on a GitHub release so it only
# advertises platforms we actually ship signed artifacts for.
#
# Background: v0.0.57's latest.json ships with darwin-universal and
# darwin-x86_64 entries that both point at the arm64 tarball. Intel Macs and
# Windows users hit check() and get "Update failed" because there is no real
# artifact behind those keys. Keeping only darwin-aarch64 makes the Tauri
# updater return "no update" on unsupported platforms (silent) instead of
# throwing.
#
# Usage:
#   scripts/patch-latest-json.sh [tag]        # defaults to v<package.json version>
#   scripts/patch-latest-json.sh v0.0.57 -y   # skip interactive confirmation
#
# Requires:
#   - gh CLI, authenticated with write access to the release repo
#   - jq

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

TAG=""
AUTO_YES=0

for arg in "$@"; do
    case "$arg" in
        -y|--yes) AUTO_YES=1 ;;
        -*) echo "Unknown flag: $arg" >&2; exit 2 ;;
        *) TAG="$arg" ;;
    esac
done

if [[ -z "$TAG" ]]; then
    if [[ ! -f package.json ]]; then
        echo -e "${RED}Error:${NC} no tag given and package.json not found in CWD." >&2
        exit 1
    fi
    TAG="v$(node -p "require('./package.json').version")"
fi

command -v gh >/dev/null 2>&1 || { echo -e "${RED}Error:${NC} gh CLI not installed (brew install gh)" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo -e "${RED}Error:${NC} jq not installed (brew install jq)" >&2; exit 1; }

gh auth status >/dev/null 2>&1 || { echo -e "${RED}Error:${NC} gh is not authenticated. Run 'gh auth login'." >&2; exit 1; }

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

echo -e "${CYAN}Patching latest.json on release ${TAG}${NC}"
echo

# Resolve the repo once so every gh call can be explicit about -R and doesn't
# depend on git auto-detection from whatever directory we happen to be in.
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
if [[ -z "$REPO" ]]; then
    echo -e "${RED}Error:${NC} could not detect repo via gh. Run this from the git repo root, or" >&2
    echo -e "       set it explicitly:  REPO=owner/name $0 $TAG" >&2
    exit 1
fi
# Allow override via env for safety / CI.
REPO="${REPO_OVERRIDE:-$REPO}"

echo -e "  repo: ${CYAN}$REPO${NC}"
echo

gh -R "$REPO" release view "$TAG" >/dev/null 2>&1 || {
    echo -e "${RED}Error:${NC} release $TAG not found on $REPO." >&2
    exit 1
}

gh -R "$REPO" release download "$TAG" --pattern latest.json -D "$tmp_dir"

src="$tmp_dir/latest.json"
if [[ ! -s "$src" ]]; then
    echo -e "${RED}Error:${NC} latest.json on release $TAG is missing or empty." >&2
    exit 1
fi

echo "Current manifest:"
jq . "$src"
echo

# Keep only platforms we actually have a correct artifact for.
# Right now that's just darwin-aarch64 (arm64 mac tarball).
jq '{
  version,
  notes,
  pub_date,
  platforms: (.platforms | with_entries(select(.key == "darwin-aarch64")))
}' "$src" > "$tmp_dir/latest.patched.json"

if ! jq -e '.platforms."darwin-aarch64".signature' "$tmp_dir/latest.patched.json" >/dev/null; then
    echo -e "${RED}Error:${NC} patched manifest has no darwin-aarch64 entry with a signature." >&2
    echo "Nothing safe to publish. Aborting." >&2
    exit 1
fi

echo -e "${YELLOW}Patched manifest (to be uploaded):${NC}"
jq . "$tmp_dir/latest.patched.json"
echo

if [[ "$AUTO_YES" -ne 1 ]]; then
    read -r -p "Upload this as latest.json on $TAG (--clobber)? [y/N] " confirm
    case "$confirm" in
        y|Y|yes|YES) ;;
        *) echo "Aborted."; exit 0 ;;
    esac
fi

# gh uses the source filename as the asset name, so publish from a file
# literally named latest.json to overwrite the existing asset.
mv -f "$tmp_dir/latest.patched.json" "$tmp_dir/latest.json"
gh -R "$REPO" release upload "$TAG" "$tmp_dir/latest.json" --clobber

echo -e "${GREEN}Done.${NC} Verify at: $(gh -R "$REPO" release view "$TAG" --json url -q .url)"
