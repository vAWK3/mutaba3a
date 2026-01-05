#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# File paths
PACKAGE_JSON="package.json"
TAURI_CONF="src-tauri/tauri.conf.json"
CARGO_TOML="src-tauri/Cargo.toml"

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

# Deploy web to main branch
deploy_web() {
    echo -e "${BLUE}Deploying web version to main...${NC}"

    # Build the web version
    npm run build

    # Git operations
    git add .
    git commit -m "Release v$1 (web)"
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
    echo "  4) Build Tauri for macOS + Windows"
    echo "  5) All (deploy web + build all platforms)"
    echo "  6) Cancel"
    echo ""
    read -p "Select deploy option [1-6]: " deploy_choice

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
            build_mac
            build_windows
            ;;
        5)
            deploy_web "$current_version"
            build_mac
            build_windows
            ;;
        6)
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
