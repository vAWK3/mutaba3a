#!/bin/bash

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# File paths
PACKAGE_JSON="package.json"
TAURI_CONF="src-tauri/tauri.conf.json"
CARGO_TOML="src-tauri/Cargo.toml"
RELEASE_DIR="release"

# GitHub repository info (auto-detected from git remote)
GITHUB_OWNER=""
GITHUB_REPO=""

# --- Release secrets (mac notarization + updater signing) ---
RELEASE_ENV_FILE="./release.env"
UPDATER_PRIVATE_KEY_FILE="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/mutaba3a.key}"

load_release_env() {
    # Load env vars from local file (not committed)
    if [[ -f "$RELEASE_ENV_FILE" ]]; then
        # shellcheck disable=SC1090
        source "$RELEASE_ENV_FILE"
        echo -e "  ${GREEN}✓${NC} Loaded release env from ${CYAN}$RELEASE_ENV_FILE${NC}"
    else
        echo -e "  ${YELLOW}⚠${NC} No ${CYAN}$RELEASE_ENV_FILE${NC} found. mac notarization may fail."
        echo -e "    Create it with APPLE_SIGNING_IDENTITY / APPLE_ID / APPLE_TEAM_ID / APPLE_PASSWORD."
        echo -e "    Also add TAURI_SIGNING_PRIVATE_KEY and TAURI_SIGNING_PRIVATE_KEY_PASSWORD for updates."
    fi
}

require_release_env() {
    local missing=()

    [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]] && missing+=("APPLE_SIGNING_IDENTITY")
    [[ -z "${APPLE_ID:-}" ]] && missing+=("APPLE_ID")
    [[ -z "${APPLE_TEAM_ID:-}" ]] && missing+=("APPLE_TEAM_ID")
    [[ -z "${APPLE_PASSWORD:-}" ]] && missing+=("APPLE_PASSWORD")

    if (( ${#missing[@]} > 0 )); then
        echo -e "${RED}Error: Missing required mac notarization env vars:${NC} ${missing[*]}"
        echo ""
        echo -e "${YELLOW}Fix:${NC} create ${CYAN}$RELEASE_ENV_FILE${NC} with:"
        echo -e "  export APPLE_SIGNING_IDENTITY='Developer ID Application: Your Company (TEAMID)'"
        echo -e "  export APPLE_ID='you@example.com'"
        echo -e "  export APPLE_TEAM_ID='TEAMID'"
        echo -e "  export APPLE_PASSWORD='app-specific-password'"
        echo ""
        exit 1
    fi
}

# Check if updater signing is configured
check_updater_signing() {
    if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
        echo -e "  ${YELLOW}⚠${NC} TAURI_SIGNING_PRIVATE_KEY not set - auto-update signing disabled"
        echo -e "    To enable: add TAURI_SIGNING_PRIVATE_KEY and TAURI_SIGNING_PRIVATE_KEY_PASSWORD to release.env"
        return 1
    fi
    echo -e "  ${GREEN}✓${NC} Updater signing key configured"
    return 0
}

# Get current version from package.json
get_version() {
    grep '"version"' "$PACKAGE_JSON" | head -1 | sed 's/.*"version": "\([^"]*\)".*/\1/'
}

# Increment patch version
increment_patch() {
    local version=$1
    local major=$(echo "$version" | cut -d. -f1)
    local minor=$(echo "$version" | cut -d. -f2)
    local patch=$(echo "$version" | cut -d. -f3)
    local new_patch=$((patch + 1))
    echo "$major.$minor.$new_patch"
}

# Update version in all config files
update_version() {
    local new_version=$1

    echo -e "${BLUE}Updating version to ${GREEN}$new_version${NC}"

    # Update package.json
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$new_version\"/" "$PACKAGE_JSON"
    else
        sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$new_version\"/" "$PACKAGE_JSON"
    fi

    # Update tauri.conf.json
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$new_version\"/" "$TAURI_CONF"
    else
        sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$new_version\"/" "$TAURI_CONF"
    fi

    # Update Cargo.toml (only the package version, not dependencies)
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' "s/^version = \"[^\"]*\"/version = \"$new_version\"/" "$CARGO_TOML"
    else
        sed -i "s/^version = \"[^\"]*\"/version = \"$new_version\"/" "$CARGO_TOML"
    fi

    echo -e "${GREEN}Version updated in all config files${NC}"
}

# Detect GitHub owner and repo from git remote
detect_github_repo() {
    local remote_url
    remote_url=$(git remote get-url origin 2>/dev/null || echo "")

    if [[ -z "$remote_url" ]]; then
        echo -e "${RED}Error: No git remote 'origin' found${NC}"
        return 1
    fi

    # Parse GitHub URL (supports both HTTPS and SSH formats)
    # HTTPS: https://github.com/owner/repo.git
    # SSH: git@github.com:owner/repo.git
    if [[ "$remote_url" =~ github\.com[:/]([^/]+)/([^/.]+)(\.git)?$ ]]; then
        GITHUB_OWNER="${BASH_REMATCH[1]}"
        GITHUB_REPO="${BASH_REMATCH[2]}"
        echo -e "${CYAN}Detected repository: ${BOLD}$GITHUB_OWNER/$GITHUB_REPO${NC}"
        return 0
    else
        echo -e "${RED}Error: Could not parse GitHub URL from remote: $remote_url${NC}"
        return 1
    fi
}

# Check prerequisites for GitHub release
check_release_prerequisites() {
    echo -e "${BLUE}Checking release prerequisites...${NC}"
    echo ""

    # Check if gh CLI is installed
    if ! command -v gh &> /dev/null; then
        echo -e "${RED}Error: GitHub CLI (gh) is not installed${NC}"
        echo ""
        echo -e "${YELLOW}Install it with:${NC}"
        echo -e "  ${CYAN}brew install gh${NC}"
        echo ""
        echo -e "Then authenticate with:"
        echo -e "  ${CYAN}gh auth login${NC}"
        exit 1
    fi
    echo -e "  ${GREEN}✓${NC} GitHub CLI (gh) installed"

    # Check if gh is authenticated
    if ! gh auth status &> /dev/null; then
        echo -e "${RED}Error: GitHub CLI is not authenticated${NC}"
        echo ""
        echo -e "${YELLOW}Authenticate with:${NC}"
        echo -e "  ${CYAN}gh auth login${NC}"
        exit 1
    fi
    echo -e "  ${GREEN}✓${NC} GitHub CLI authenticated"

    # Detect GitHub repository
    if ! detect_github_repo; then
        exit 1
    fi
    echo -e "  ${GREEN}✓${NC} Repository detected"

    # Check git working tree status (warn but don't fail)
    if [[ -n $(git status --porcelain 2>/dev/null) ]]; then
        echo -e "  ${YELLOW}⚠${NC} Working tree has uncommitted changes (will be committed)"
    else
        echo -e "  ${GREEN}✓${NC} Working tree clean"
    fi

    echo ""
    echo -e "${GREEN}All prerequisites satisfied${NC}"
    echo ""
}

# Tag and push to GitHub
tag_and_push() {
    local version=$1
    local tag="v$version"

    echo -e "${BLUE}Preparing git tag and push...${NC}"

    # Add all changes
    git add .

    # Commit if there are changes (don't fail if nothing to commit)
    if [[ -n $(git status --porcelain 2>/dev/null) ]]; then
        git commit -m "Release $tag" || true
        echo -e "  ${GREEN}✓${NC} Changes committed"
    else
        echo -e "  ${CYAN}→${NC} No changes to commit"
    fi

    # Pull latest changes first (in case other platform deployed)
    echo -e "  ${CYAN}→${NC} Pulling latest from origin main..."
    git pull --rebase origin main 2>/dev/null || true

    # Push to main
    echo -e "  ${CYAN}→${NC} Pushing to origin main..."
    git push origin main
    echo -e "  ${GREEN}✓${NC} Pushed to main"

    # Check if tag already exists locally or remotely - skip if so (allows parallel deploys)
    if git tag -l | grep -q "^$tag$" || git ls-remote --tags origin | grep -q "refs/tags/$tag$"; then
        echo -e "  ${YELLOW}→${NC} Tag '$tag' already exists - skipping tag creation"
    else
        # Create annotated tag
        git tag -a "$tag" -m "Release $tag"
        echo -e "  ${GREEN}✓${NC} Created tag $tag"

        # Push tag
        git push origin "$tag"
        echo -e "  ${GREEN}✓${NC} Pushed tag to origin"
    fi

    echo ""
}

# Find the DMG artifact after build
find_dmg_artifact() {
    local dmg_path=""

    echo -e "${BLUE}Locating DMG artifact...${NC}"

    # Search for DMG files in Tauri build output
    # Tauri v2 places DMGs in: src-tauri/target/release/bundle/dmg/
    # For universal builds: src-tauri/target/universal-apple-darwin/release/bundle/dmg/
    local search_paths=(
        "src-tauri/target/universal-apple-darwin/release/bundle/dmg"
        "src-tauri/target/release/bundle/dmg"
    )

    for search_path in "${search_paths[@]}"; do
        if [[ -d "$search_path" ]]; then
            # Find the most recent DMG file
            dmg_path=$(find "$search_path" -name "*.dmg" -type f -print0 2>/dev/null | xargs -0 ls -t 2>/dev/null | head -1)
            if [[ -n "$dmg_path" && -f "$dmg_path" ]]; then
                break
            fi
        fi
    done

    # If not found in specific paths, do a broader search
    if [[ -z "$dmg_path" || ! -f "$dmg_path" ]]; then
        dmg_path=$(find src-tauri/target -name "*.dmg" -type f -print0 2>/dev/null | xargs -0 ls -t 2>/dev/null | head -1)
    fi

    if [[ -z "$dmg_path" || ! -f "$dmg_path" ]]; then
        echo -e "${RED}Error: No DMG file found in build output${NC}"
        echo -e "${YELLOW}Expected location: src-tauri/target/**/bundle/dmg/*.dmg${NC}"
        exit 1
    fi

    # Validate file is non-empty
    if [[ ! -s "$dmg_path" ]]; then
        echo -e "${RED}Error: DMG file is empty: $dmg_path${NC}"
        exit 1
    fi

    echo -e "  ${GREEN}✓${NC} Found: $dmg_path"
    echo "$dmg_path"
}

# Prepare release artifacts
prepare_release_artifacts() {
    local version=$1
    local source_dmg=$2

    echo -e "${BLUE}Preparing release artifacts...${NC}"

    # Create release directory
    mkdir -p "$RELEASE_DIR"

    # Clean filename for release
    local release_dmg="mutaba3a-v${version}-macos-universal.dmg"
    local release_dmg_path="$RELEASE_DIR/$release_dmg"
    local checksum_file="$RELEASE_DIR/mutaba3a-v${version}-macos-universal.sha256"

    # Copy DMG to release folder
    cp "$source_dmg" "$release_dmg_path"
    echo -e "  ${GREEN}✓${NC} Copied DMG to $release_dmg_path"

    # Generate SHA256 checksum
    local checksum
    checksum=$(shasum -a 256 "$release_dmg_path" | awk '{print $1}')
    echo "$checksum" > "$checksum_file"

    echo -e "  ${GREEN}✓${NC} Generated SHA256 checksum"
    echo ""
    echo -e "${CYAN}SHA256:${NC} $checksum"
    echo ""

    # Return paths via global variables (bash doesn't support multiple returns well)
    RELEASE_DMG_PATH="$release_dmg_path"
    RELEASE_DMG_NAME="$release_dmg"
    RELEASE_CHECKSUM_PATH="$checksum_file"
    RELEASE_CHECKSUM="$checksum"
}

# Create tar.gz archive for Tauri updater (required format)
create_update_archive() {
    local version=$1
    local source_dmg=$2

    echo -e "${BLUE}Creating update archive for Tauri updater...${NC}"

    local archive_name="mutaba3a-v${version}-macos-universal.tar.gz"
    local archive_path="$RELEASE_DIR/$archive_name"

    # Create tar.gz from the DMG
    tar -czf "$archive_path" -C "$(dirname "$source_dmg")" "$(basename "$source_dmg")"

    if [[ ! -f "$archive_path" ]]; then
        echo -e "${RED}Error: Failed to create update archive${NC}"
        return 1
    fi

    echo -e "  ${GREEN}✓${NC} Created $archive_path"

    # Return path via global variable
    UPDATE_ARCHIVE_PATH="$archive_path"
    UPDATE_ARCHIVE_NAME="$archive_name"
}

# Sign artifact for Tauri updater
sign_update_artifact() {
    local artifact_path=$1

    if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
        echo -e "  ${YELLOW}⚠${NC} Skipping signing - no private key configured"
        UPDATE_SIGNATURE=""
        return 0
    fi

    echo -e "${BLUE}Signing update artifact...${NC}"

    # Use Tauri CLI to sign the artifact
    local signature
    signature=$(npx @tauri-apps/cli signer sign "$artifact_path" --private-key "$TAURI_SIGNING_PRIVATE_KEY" --password "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" 2>/dev/null)

    if [[ -z "$signature" ]]; then
        echo -e "${RED}Error: Failed to sign artifact${NC}"
        return 1
    fi

    echo -e "  ${GREEN}✓${NC} Artifact signed"

    UPDATE_SIGNATURE="$signature"
}

# Generate latest.json manifest for Tauri updater
generate_update_manifest() {
    local version=$1
    local tag="v$version"

    echo -e "${BLUE}Generating update manifest (latest.json)...${NC}"

    local manifest_path="$RELEASE_DIR/latest.json"
    local pub_date
    pub_date=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    local archive_url="https://github.com/$GITHUB_OWNER/$GITHUB_REPO/releases/download/$tag/$UPDATE_ARCHIVE_NAME"

    # Create the manifest
    cat > "$manifest_path" << EOF
{
  "version": "$version",
  "notes": "Release $tag",
  "pub_date": "$pub_date",
  "platforms": {
    "darwin-universal": {
      "signature": "$UPDATE_SIGNATURE",
      "url": "$archive_url"
    },
    "darwin-x86_64": {
      "signature": "$UPDATE_SIGNATURE",
      "url": "$archive_url"
    },
    "darwin-aarch64": {
      "signature": "$UPDATE_SIGNATURE",
      "url": "$archive_url"
    }
  }
}
EOF

    if [[ ! -f "$manifest_path" ]]; then
        echo -e "${RED}Error: Failed to create update manifest${NC}"
        return 1
    fi

    echo -e "  ${GREEN}✓${NC} Created $manifest_path"

    UPDATE_MANIFEST_PATH="$manifest_path"
}

# Update website download config file
update_download_config() {
    local version=$1
    local tag="v$version"

    echo -e "${BLUE}Updating website download config...${NC}"

    local config_file="src/content/download-config.ts"
    local config_dir="src/content"

    # Ensure directory exists
    mkdir -p "$config_dir"

    # Calculate file size in MB
    local file_size_bytes
    if [[ "$OSTYPE" == "darwin"* ]]; then
        file_size_bytes=$(stat -f%z "$RELEASE_DMG_PATH")
    else
        file_size_bytes=$(stat -c%s "$RELEASE_DMG_PATH")
    fi
    local file_size_mb
    file_size_mb=$(echo "scale=2; $file_size_bytes / 1048576" | bc)
    local file_size="~${file_size_mb} MB"

    local min_macos="${MIN_MACOS:-macOS 12+}"

    # Read existing Windows config if present
    local win_file_size=""
    local win_sha256=""
    local win_exe_sha256=""

    if [[ -f "$config_file" ]]; then
        # Extract existing Windows values using sed (BSD grep doesn't support -P Perl regex)
        win_file_size=$(sed -n "/windows:/,/}/s/.*fileSize: '\([^']*\)'.*/\1/p" "$config_file" 2>/dev/null | head -1 || echo "")
        win_sha256=$(sed -n "/windows:/,/}/s/.*sha256: '\([^']*\)'.*/\1/p" "$config_file" 2>/dev/null | head -1 || echo "")
        win_exe_sha256=$(sed -n "/windows:/,/}/s/.*exeSha256: '\([^']*\)'.*/\1/p" "$config_file" 2>/dev/null | head -1 || echo "")
    fi

    # Write config file with URL template structure
    cat > "$config_file" << 'EOFSTART'
// Download config with URL templates - version fetched dynamically from GitHub
// Static fields (fileSize, sha256, fallbackVersion) are updated by deploy.sh / deploy.ps1
export const DOWNLOAD_CONFIG = {
EOFSTART

    cat >> "$config_file" << EOF
  githubOwner: '$GITHUB_OWNER',
  githubRepo: '$GITHUB_REPO',
  allReleasesUrl: 'https://github.com/$GITHUB_OWNER/$GITHUB_REPO/releases',
  // Fallback version used when GitHub API fails (rate-limited, offline, etc.)
  fallbackVersion: '$version',

  getReleaseNotesUrl: (version: string) =>
    \`https://github.com/$GITHUB_OWNER/$GITHUB_REPO/releases/tag/v\${version}\`,

  mac: {
    fileSize: '$file_size',
    minVersion: '$min_macos',
    sha256: '$RELEASE_CHECKSUM',
    getDownloadUrl: (version: string) =>
      \`https://github.com/$GITHUB_OWNER/$GITHUB_REPO/releases/download/v\${version}/mutaba3a-v\${version}-macos-universal.dmg\`,
  },

  windows: {
    fileSize: '$win_file_size',
    minVersion: 'Windows 10+',
    sha256: '$win_sha256',
    exeSha256: '$win_exe_sha256',
    getMsiUrl: (version: string) =>
      \`https://github.com/$GITHUB_OWNER/$GITHUB_REPO/releases/download/v\${version}/mutaba3a-v\${version}-windows-x64.msi\`,
    getExeUrl: (version: string) =>
      \`https://github.com/$GITHUB_OWNER/$GITHUB_REPO/releases/download/v\${version}/mutaba3a-v\${version}-windows-x64-setup.exe\`,
  },
};
EOF

    if [[ ! -f "$config_file" ]]; then
        echo -e "${RED}Error: Failed to write download config${NC}"
        exit 1
    fi

    echo -e "  ${GREEN}✓${NC} Updated $config_file"
}

# Create GitHub release or upload to existing
create_github_release() {
    local version=$1
    local tag="v$version"

    echo -e "${BLUE}Creating GitHub release...${NC}"

    # Build list of artifacts to upload
    local artifacts=("$RELEASE_DMG_PATH" "$RELEASE_CHECKSUM_PATH")

    # Add update manifest and archive if they exist
    if [[ -n "${UPDATE_MANIFEST_PATH:-}" && -f "$UPDATE_MANIFEST_PATH" ]]; then
        artifacts+=("$UPDATE_MANIFEST_PATH")
    fi
    if [[ -n "${UPDATE_ARCHIVE_PATH:-}" && -f "$UPDATE_ARCHIVE_PATH" ]]; then
        artifacts+=("$UPDATE_ARCHIVE_PATH")
    fi

    # Check if release already exists - upload to it if so (allows parallel deploys)
    if gh release view "$tag" &> /dev/null; then
        echo -e "  ${YELLOW}→${NC} Release '$tag' already exists - uploading Mac artifacts..."
        gh release upload "$tag" "${artifacts[@]}" --clobber
        echo -e "  ${GREEN}✓${NC} Mac artifacts uploaded to existing release"
    else
        # Create release with auto-generated notes
        gh release create "$tag" \
            --title "$tag" \
            --generate-notes \
            "${artifacts[@]}"
        echo -e "  ${GREEN}✓${NC} Release created with Mac artifacts"
    fi

    echo ""
}

# Print release URLs
print_release_urls() {
    local version=$1
    local tag="v$version"

    local release_url="https://github.com/$GITHUB_OWNER/$GITHUB_REPO/releases/tag/$tag"
    local download_url="https://github.com/$GITHUB_OWNER/$GITHUB_REPO/releases/download/$tag/$RELEASE_DMG_NAME"
    local checksum_url="https://github.com/$GITHUB_OWNER/$GITHUB_REPO/releases/download/$tag/mutaba3a-v${version}-macos-universal.sha256"

    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  GitHub Release Published! $tag${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo -e "${BOLD}Release Page:${NC}"
    echo -e "  ${CYAN}$release_url${NC}"
    echo ""
    echo -e "${BOLD}Direct Download (DMG):${NC}"
    echo -e "  ${CYAN}$download_url${NC}"
    echo ""
    echo -e "${BOLD}Checksum File:${NC}"
    echo -e "  ${CYAN}$checksum_url${NC}"
    echo ""
    echo -e "${BOLD}SHA256 Checksum:${NC}"
    echo -e "  ${CYAN}$RELEASE_CHECKSUM${NC}"
    echo ""
    echo -e "${GREEN}----------------------------------------${NC}"
    echo -e "${BOLD}Copy this URL into your website button:${NC}"
    echo ""
    echo -e "  ${CYAN}$download_url${NC}"
    echo ""

    # Show auto-update info if manifest was created
    if [[ -n "${UPDATE_MANIFEST_PATH:-}" ]]; then
        echo -e "${GREEN}----------------------------------------${NC}"
        echo -e "${BOLD}Auto-Update Manifest:${NC}"
        local manifest_url="https://github.com/$GITHUB_OWNER/$GITHUB_REPO/releases/download/$tag/latest.json"
        echo -e "  ${CYAN}$manifest_url${NC}"
        echo ""
        echo -e "${BOLD}Update Archive:${NC}"
        local archive_url="https://github.com/$GITHUB_OWNER/$GITHUB_REPO/releases/download/$tag/$UPDATE_ARCHIVE_NAME"
        echo -e "  ${CYAN}$archive_url${NC}"
        echo ""
    fi

    echo -e "${GREEN}----------------------------------------${NC}"
}

# Build macOS and publish to GitHub
build_and_release_mac() {
    local version=$1

     # Load & validate Apple notarization env vars
    load_release_env
    require_release_env

    # Check prerequisites first
    check_release_prerequisites

    # Check if updater signing is available
    local has_updater_signing=false
    if check_updater_signing; then
        has_updater_signing=true
    fi

    # Build macOS app
    build_mac

    # Find the built DMG
    local dmg_path
    dmg_path=$(find_dmg_artifact | tail -1)

    # Prepare release artifacts
    prepare_release_artifacts "$version" "$dmg_path"

    # Create update archive and manifest for auto-updates (if signing configured)
    if [[ "$has_updater_signing" == "true" ]]; then
        create_update_archive "$version" "$RELEASE_DMG_PATH"
        sign_update_artifact "$UPDATE_ARCHIVE_PATH"
        generate_update_manifest "$version"
    else
        echo -e "  ${YELLOW}⚠${NC} Skipping auto-update artifacts (no signing key)"
    fi

    # Update website download config (auto-generates src/content/download-config.ts)
    update_download_config "$version"

    # Tag and push (includes updated download config)
    tag_and_push "$version"

    # Create GitHub release
    create_github_release "$version"

    # Print URLs
    print_release_urls "$version"

    # Confirm website update
    echo -e "${GREEN}✓ Website download page updated with v$version metadata${NC}"
}

# Deploy web to main branch
deploy_web() {
    echo -e "${BLUE}Deploying web version to main...${NC}"

    # Build the web version
    npm run build

    # Git operations
    git add .
    git commit -m "Release v$1 (web)" || true
    git push origin main

    echo -e "${GREEN}Web version v$1 deployed to main${NC}"
}

# Build Tauri for Mac
build_mac() {
    echo -e "${BLUE}Building Tauri for macOS...${NC}"

    # Check if on macOS
    if [[ "$OSTYPE" != "darwin"* ]]; then
        echo -e "${YELLOW}Warning: Building macOS app on non-macOS system may not work${NC}"
    fi

    npm run tauri build -- --target universal-apple-darwin 2>/dev/null || npm run tauri build

    echo -e "${GREEN}macOS build complete!${NC}"
    echo -e "Build output: ${BLUE}src-tauri/target/release/bundle/${NC}"
}

# Build Tauri for Windows
build_windows() {
    echo -e "${BLUE}Building Tauri for Windows...${NC}"

    # Check if cross-compilation tools are available
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo -e "${YELLOW}Cross-compiling for Windows from macOS...${NC}"
        echo -e "${YELLOW}Note: You may need to install the Windows target:${NC}"
        echo -e "${YELLOW}  rustup target add x86_64-pc-windows-msvc${NC}"
    fi

    npm run tauri build -- --target x86_64-pc-windows-msvc 2>/dev/null || {
        echo -e "${RED}Windows build failed. If cross-compiling, ensure you have:${NC}"
        echo -e "${RED}  1. rustup target add x86_64-pc-windows-msvc${NC}"
        echo -e "${RED}  2. Required Windows SDK and linker${NC}"
        echo -e "${YELLOW}Consider building on Windows or using GitHub Actions for Windows builds${NC}"
        exit 1
    }

    echo -e "${GREEN}Windows build complete!${NC}"
    echo -e "Build output: ${BLUE}src-tauri/target/x86_64-pc-windows-msvc/release/bundle/${NC}"
}

# Main menu
main() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}       Mutaba3a Deploy Script          ${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""

    # Get and display current version
    local current_version=$(get_version)
    local new_version=$(increment_patch "$current_version")

    echo -e "Current version: ${YELLOW}$current_version${NC}"
    echo -e "Next version:    ${GREEN}$new_version${NC}"
    echo ""

    # Ask about version bump
    echo -e "${BLUE}Version options:${NC}"
    echo "  1) Auto-increment patch ($current_version -> $new_version)"
    echo "  2) Enter custom version (for major/minor updates)"
    echo "  3) Keep current version"
    echo ""
    read -p "Select version option [1-3]: " version_choice

    case $version_choice in
        1)
            update_version "$new_version"
            current_version="$new_version"
            ;;
        2)
            read -p "Enter new version (e.g., 1.0.0): " custom_version
            if [[ ! "$custom_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
                echo -e "${RED}Invalid version format. Use X.Y.Z${NC}"
                exit 1
            fi
            update_version "$custom_version"
            current_version="$custom_version"
            ;;
        3)
            echo -e "${YELLOW}Keeping current version: $current_version${NC}"
            ;;
        *)
            echo -e "${RED}Invalid option${NC}"
            exit 1
            ;;
    esac

    echo ""
    echo -e "${BLUE}Deploy options:${NC}"
    echo "  1) Deploy to main (web)"
    echo "  2) Build Tauri for macOS"
    echo "  3) Build Tauri for Windows"
    echo -e "  4) ${GREEN}Build macOS + Publish GitHub Release (DMG)${NC}"
    echo "  5) Cancel"
    echo ""
    read -p "Select deploy option [1-5]: " deploy_choice

    case $deploy_choice in
        1)
            deploy_web "$current_version"
            ;;
        2)
            build_mac
            ;;
        3)
            build_windows
            ;;
        4)
            build_and_release_mac "$current_version"
            ;;
        5)
            echo -e "${YELLOW}Cancelled${NC}"
            exit 0
            ;;
        *)
            echo -e "${RED}Invalid option${NC}"
            exit 1
            ;;
    esac

    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}       Deploy complete! v$current_version${NC}"
    echo -e "${GREEN}========================================${NC}"
}

# Run main
main
