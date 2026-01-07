# Mutaba3a Windows Deploy Script
# Run this script on Windows to build and release the Windows version
# Usage: .\deploy.ps1

$ErrorActionPreference = "Stop"

# File paths
$PACKAGE_JSON = "package.json"
$TAURI_CONF = "src-tauri/tauri.conf.json"
$CARGO_TOML = "src-tauri/Cargo.toml"
$RELEASE_DIR = "release"
$CONFIG_FILE = "src/content/download-config.ts"

# GitHub repository info (auto-detected from git remote)
$script:GITHUB_OWNER = ""
$script:GITHUB_REPO = ""

# Release artifacts
$script:RELEASE_MSI_PATH = ""
$script:RELEASE_MSI_NAME = ""
$script:RELEASE_EXE_PATH = ""
$script:RELEASE_EXE_NAME = ""
$script:RELEASE_MSI_CHECKSUM = ""
$script:RELEASE_EXE_CHECKSUM = ""

# Auto-update artifacts
$script:UPDATE_ARCHIVE_PATH = ""
$script:UPDATE_ARCHIVE_NAME = ""
$script:UPDATE_SIGNATURE = ""
$script:UPDATE_MANIFEST_PATH = ""
$script:HAS_UPDATER_SIGNING = $false

# Colors for output
function Write-ColorOutput {
    param(
        [string]$Message,
        [string]$Color = "White"
    )
    Write-Host $Message -ForegroundColor $Color
}

function Write-Success { param([string]$Message) Write-ColorOutput "  [OK] $Message" "Green" }
function Write-Info { param([string]$Message) Write-ColorOutput $Message "Cyan" }
function Write-Warning { param([string]$Message) Write-ColorOutput "  [!] $Message" "Yellow" }
function Write-Error { param([string]$Message) Write-ColorOutput "  [X] $Message" "Red" }

# Get current version from package.json
function Get-Version {
    $content = Get-Content $PACKAGE_JSON -Raw | ConvertFrom-Json
    return $content.version
}

# Increment patch version
function Get-IncrementedPatch {
    param([string]$Version)
    $parts = $Version -split '\.'
    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    $patch = [int]$parts[2] + 1
    return "$major.$minor.$patch"
}

# Update version in all config files
function Update-Version {
    param([string]$NewVersion)

    Write-Info "Updating version to $NewVersion"

    # Update package.json
    $packageContent = Get-Content $PACKAGE_JSON -Raw
    $packageContent = $packageContent -replace '"version": "[^"]*"', "`"version`": `"$NewVersion`""
    Set-Content -Path $PACKAGE_JSON -Value $packageContent -NoNewline

    # Update tauri.conf.json
    $tauriContent = Get-Content $TAURI_CONF -Raw
    $tauriContent = $tauriContent -replace '"version": "[^"]*"', "`"version`": `"$NewVersion`""
    Set-Content -Path $TAURI_CONF -Value $tauriContent -NoNewline

    # Update Cargo.toml (only the package version at the start)
    $cargoContent = Get-Content $CARGO_TOML -Raw
    $cargoContent = $cargoContent -replace '^version = "[^"]*"', "version = `"$NewVersion`"" -replace '(?m)^version = "[^"]*"', "version = `"$NewVersion`""
    Set-Content -Path $CARGO_TOML -Value $cargoContent -NoNewline

    Write-Success "Version updated in all config files"
}

# Detect GitHub owner and repo from git remote
function Get-GitHubRepo {
    $remoteUrl = git remote get-url origin 2>$null
    if (-not $remoteUrl) {
        Write-Error "No git remote 'origin' found"
        return $false
    }

    # Parse GitHub URL (supports both HTTPS and SSH formats)
    if ($remoteUrl -match 'github\.com[:/]([^/]+)/([^/.]+)(\.git)?$') {
        $script:GITHUB_OWNER = $Matches[1]
        $script:GITHUB_REPO = $Matches[2]
        Write-Info "Detected repository: $($script:GITHUB_OWNER)/$($script:GITHUB_REPO)"
        return $true
    }
    else {
        Write-Error "Could not parse GitHub URL from remote: $remoteUrl"
        return $false
    }
}

# Check prerequisites for GitHub release
function Test-ReleasePrerequisites {
    Write-Info "Checking release prerequisites..."
    Write-Host ""

    # Check if gh CLI is installed
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        Write-Error "GitHub CLI (gh) is not installed"
        Write-Host ""
        Write-Warning "Install it from: https://cli.github.com/"
        Write-Host ""
        Write-Host "Then authenticate with:"
        Write-Host "  gh auth login"
        exit 1
    }
    Write-Success "GitHub CLI (gh) installed"

    # Check if gh is authenticated
    $authStatus = gh auth status 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error "GitHub CLI is not authenticated"
        Write-Host ""
        Write-Warning "Authenticate with:"
        Write-Host "  gh auth login"
        exit 1
    }
    Write-Success "GitHub CLI authenticated"

    # Detect GitHub repository
    if (-not (Get-GitHubRepo)) {
        exit 1
    }
    Write-Success "Repository detected"

    # Check git working tree status
    $gitStatus = git status --porcelain 2>$null
    if ($gitStatus) {
        Write-Warning "Working tree has uncommitted changes (will be committed)"
    }
    else {
        Write-Success "Working tree clean"
    }

    Write-Host ""
    Write-ColorOutput "All prerequisites satisfied" "Green"
    Write-Host ""
}

# Build Tauri for Windows
function Build-Windows {
    Write-Info "Building Tauri for Windows..."
    Write-Host ""

    npm run tauri build

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Windows build failed"
        exit 1
    }

    Write-Success "Windows build complete!"
    Write-Info "Build output: src-tauri/target/release/bundle/"
}

# Find MSI artifact after build
function Find-MsiArtifact {
    Write-Info "Locating MSI artifact..."

    $searchPath = "src-tauri/target/release/bundle/msi"
    if (Test-Path $searchPath) {
        $msiFile = Get-ChildItem -Path $searchPath -Filter "*.msi" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($msiFile) {
            Write-Success "Found: $($msiFile.FullName)"
            return $msiFile.FullName
        }
    }

    # Broader search
    $msiFile = Get-ChildItem -Path "src-tauri/target" -Filter "*.msi" -Recurse | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($msiFile) {
        Write-Success "Found: $($msiFile.FullName)"
        return $msiFile.FullName
    }

    Write-Error "No MSI file found in build output"
    Write-Warning "Expected location: src-tauri/target/release/bundle/msi/*.msi"
    exit 1
}

# Find NSIS (EXE) artifact after build
function Find-ExeArtifact {
    Write-Info "Locating NSIS EXE artifact..."

    $searchPath = "src-tauri/target/release/bundle/nsis"
    if (Test-Path $searchPath) {
        $exeFile = Get-ChildItem -Path $searchPath -Filter "*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($exeFile) {
            Write-Success "Found: $($exeFile.FullName)"
            return $exeFile.FullName
        }
    }

    # Broader search in nsis folder
    $exeFile = Get-ChildItem -Path "src-tauri/target" -Filter "*.exe" -Recurse | Where-Object { $_.DirectoryName -like "*nsis*" } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($exeFile) {
        Write-Success "Found: $($exeFile.FullName)"
        return $exeFile.FullName
    }

    Write-Warning "No NSIS EXE file found (optional)"
    return $null
}

# Prepare release artifacts
function Prepare-ReleaseArtifacts {
    param(
        [string]$Version,
        [string]$SourceMsi,
        [string]$SourceExe
    )

    Write-Info "Preparing release artifacts..."

    # Create release directory
    if (-not (Test-Path $RELEASE_DIR)) {
        New-Item -ItemType Directory -Path $RELEASE_DIR | Out-Null
    }

    # Process MSI
    $releaseMsiName = "mutaba3a-v$Version-windows-x64.msi"
    $releaseMsiPath = Join-Path $RELEASE_DIR $releaseMsiName
    Copy-Item $SourceMsi $releaseMsiPath
    Write-Success "Copied MSI to $releaseMsiPath"

    # Generate SHA256 for MSI
    $msiHash = (Get-FileHash $releaseMsiPath -Algorithm SHA256).Hash.ToLower()
    $msiChecksumFile = Join-Path $RELEASE_DIR "mutaba3a-v$Version-windows-x64.msi.sha256"
    Set-Content -Path $msiChecksumFile -Value $msiHash -NoNewline
    Write-Success "Generated SHA256 checksum for MSI"

    $script:RELEASE_MSI_PATH = $releaseMsiPath
    $script:RELEASE_MSI_NAME = $releaseMsiName
    $script:RELEASE_MSI_CHECKSUM = $msiHash

    Write-Host ""
    Write-Info "MSI SHA256: $msiHash"
    Write-Host ""

    # Process EXE if available
    if ($SourceExe) {
        $releaseExeName = "mutaba3a-v$Version-windows-x64-setup.exe"
        $releaseExePath = Join-Path $RELEASE_DIR $releaseExeName
        Copy-Item $SourceExe $releaseExePath
        Write-Success "Copied EXE to $releaseExePath"

        # Generate SHA256 for EXE
        $exeHash = (Get-FileHash $releaseExePath -Algorithm SHA256).Hash.ToLower()
        $exeChecksumFile = Join-Path $RELEASE_DIR "mutaba3a-v$Version-windows-x64-setup.exe.sha256"
        Set-Content -Path $exeChecksumFile -Value $exeHash -NoNewline
        Write-Success "Generated SHA256 checksum for EXE"

        $script:RELEASE_EXE_PATH = $releaseExePath
        $script:RELEASE_EXE_NAME = $releaseExeName
        $script:RELEASE_EXE_CHECKSUM = $exeHash

        Write-Host ""
        Write-Info "EXE SHA256: $exeHash"
        Write-Host ""
    }
}

# Update website download config file
function Update-DownloadConfig {
    param([string]$Version)

    $tag = "v$Version"
    Write-Info "Updating website download config..."

    # Ensure directory exists
    $configDir = Split-Path $CONFIG_FILE -Parent
    if (-not (Test-Path $configDir)) {
        New-Item -ItemType Directory -Path $configDir | Out-Null
    }

    # Calculate file size in MB
    $fileSizeBytes = (Get-Item $script:RELEASE_MSI_PATH).Length
    $fileSizeMb = [math]::Round($fileSizeBytes / 1MB, 2)
    $fileSize = "~$fileSizeMb MB"

    # Build URLs
    $msiUrl = "https://github.com/$($script:GITHUB_OWNER)/$($script:GITHUB_REPO)/releases/download/$tag/$($script:RELEASE_MSI_NAME)"
    $exeUrl = ""
    if ($script:RELEASE_EXE_NAME) {
        $exeUrl = "https://github.com/$($script:GITHUB_OWNER)/$($script:GITHUB_REPO)/releases/download/$tag/$($script:RELEASE_EXE_NAME)"
    }
    $releaseNotesUrl = "https://github.com/$($script:GITHUB_OWNER)/$($script:GITHUB_REPO)/releases/tag/$tag"
    $allReleasesUrl = "https://github.com/$($script:GITHUB_OWNER)/$($script:GITHUB_REPO)/releases"

    # Read existing Mac config if present
    $macFileSize = ""
    $macMinVersion = "macOS 12+"
    $macSha256 = ""
    $macDownloadUrl = ""

    if (Test-Path $CONFIG_FILE) {
        $existingContent = Get-Content $CONFIG_FILE -Raw
        if ($existingContent -match "mac:[\s\S]*?fileSize: '([^']*)'") { $macFileSize = $Matches[1] }
        if ($existingContent -match "mac:[\s\S]*?minVersion: '([^']*)'") { $macMinVersion = $Matches[1] }
        if ($existingContent -match "mac:[\s\S]*?sha256: '([^']*)'") { $macSha256 = $Matches[1] }
        if ($existingContent -match "mac:[\s\S]*?downloadUrl: '([^']*)'") { $macDownloadUrl = $Matches[1] }
    }

    # Write config file with new structure
    $configContent = @"
// Auto-generated by deploy.sh / deploy.ps1 - DO NOT EDIT MANUALLY
export const DOWNLOAD_CONFIG = {
  version: '$Version',
  releaseNotesUrl: '$releaseNotesUrl',
  allReleasesUrl: '$allReleasesUrl',

  mac: {
    fileSize: '$macFileSize',
    minVersion: '$macMinVersion',
    sha256: '$macSha256',
    downloadUrl: '$macDownloadUrl',
  },

  windows: {
    fileSize: '$fileSize',
    minVersion: 'Windows 10+',
    sha256: '$($script:RELEASE_MSI_CHECKSUM)',
    msiUrl: '$msiUrl',
    exeUrl: '$exeUrl',
    exeSha256: '$($script:RELEASE_EXE_CHECKSUM)',
  },
};
"@

    Set-Content -Path $CONFIG_FILE -Value $configContent -NoNewline
    Write-Success "Updated $CONFIG_FILE"
}

# Tag and push to GitHub
function Invoke-TagAndPush {
    param([string]$Version)

    $tag = "v$Version"
    Write-Info "Preparing git tag and push..."

    # Check if tag already exists remotely
    $existingTags = git ls-remote --tags origin 2>$null | Select-String "refs/tags/$tag$"
    if ($existingTags) {
        Write-Error "Tag '$tag' already exists on remote"
        Write-Host ""
        Write-Warning "To release this version, you must either:"
        Write-Host "  1. Delete the existing release and tag on GitHub"
        Write-Host "  2. Use a different version number"
        Write-Host ""
        Write-Host "To delete the remote tag:"
        Write-Host "  git push origin --delete $tag"
        Write-Host "  gh release delete $tag --yes"
        exit 1
    }

    # Add all changes
    git add .

    # Commit if there are changes
    $gitStatus = git status --porcelain 2>$null
    if ($gitStatus) {
        git commit -m "Release $tag"
        Write-Success "Changes committed"
    }
    else {
        Write-Info "No changes to commit"
    }

    # Push to main
    Write-Info "Pushing to origin main..."
    git push origin main
    Write-Success "Pushed to main"

    # Create annotated tag
    git tag -a $tag -m "Release $tag"
    Write-Success "Created tag $tag"

    # Push tag
    git push origin $tag
    Write-Success "Pushed tag to origin"
    Write-Host ""
}

# Create GitHub release
function New-GitHubRelease {
    param([string]$Version)

    $tag = "v$Version"
    Write-Info "Creating GitHub release..."

    # Check if release already exists
    $existingRelease = gh release view $tag 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Error "Release '$tag' already exists on GitHub"
        Write-Host ""
        Write-Warning "To overwrite, first delete the existing release:"
        Write-Host "  gh release delete $tag --yes"
        exit 1
    }

    # Build list of assets to upload
    $assets = @($script:RELEASE_MSI_PATH)
    $msiChecksumFile = Join-Path $RELEASE_DIR "mutaba3a-v$Version-windows-x64.msi.sha256"
    $assets += $msiChecksumFile

    if ($script:RELEASE_EXE_PATH) {
        $assets += $script:RELEASE_EXE_PATH
        $exeChecksumFile = Join-Path $RELEASE_DIR "mutaba3a-v$Version-windows-x64-setup.exe.sha256"
        $assets += $exeChecksumFile
    }

    # Create release with auto-generated notes
    gh release create $tag --title $tag --generate-notes @assets

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create GitHub release"
        exit 1
    }

    Write-Success "Release created successfully"
    Write-Host ""
}

# Print release URLs
function Write-ReleaseUrls {
    param([string]$Version)

    $tag = "v$Version"
    $releaseUrl = "https://github.com/$($script:GITHUB_OWNER)/$($script:GITHUB_REPO)/releases/tag/$tag"
    $msiDownloadUrl = "https://github.com/$($script:GITHUB_OWNER)/$($script:GITHUB_REPO)/releases/download/$tag/$($script:RELEASE_MSI_NAME)"

    Write-Host ""
    Write-ColorOutput "========================================" "Green"
    Write-ColorOutput "  GitHub Release Published! $tag" "Green"
    Write-ColorOutput "========================================" "Green"
    Write-Host ""
    Write-Host "Release Page:"
    Write-ColorOutput "  $releaseUrl" "Cyan"
    Write-Host ""
    Write-Host "Direct Download (MSI):"
    Write-ColorOutput "  $msiDownloadUrl" "Cyan"
    Write-Host ""
    Write-Host "MSI SHA256 Checksum:"
    Write-ColorOutput "  $($script:RELEASE_MSI_CHECKSUM)" "Cyan"
    Write-Host ""

    if ($script:RELEASE_EXE_PATH) {
        $exeDownloadUrl = "https://github.com/$($script:GITHUB_OWNER)/$($script:GITHUB_REPO)/releases/download/$tag/$($script:RELEASE_EXE_NAME)"
        Write-Host "Direct Download (EXE):"
        Write-ColorOutput "  $exeDownloadUrl" "Cyan"
        Write-Host ""
        Write-Host "EXE SHA256 Checksum:"
        Write-ColorOutput "  $($script:RELEASE_EXE_CHECKSUM)" "Cyan"
        Write-Host ""
    }

    Write-ColorOutput "----------------------------------------" "Green"
    Write-Host "Copy this URL into your website button:"
    Write-Host ""
    Write-ColorOutput "  $msiDownloadUrl" "Cyan"
    Write-Host ""
    Write-ColorOutput "----------------------------------------" "Green"
}

# Build Windows and publish to GitHub
function Invoke-BuildAndRelease {
    param([string]$Version)

    # Check prerequisites first
    Test-ReleasePrerequisites

    # Build Windows app
    Build-Windows

    # Find the built artifacts
    $msiPath = Find-MsiArtifact
    $exePath = Find-ExeArtifact

    # Prepare release artifacts
    Prepare-ReleaseArtifacts -Version $Version -SourceMsi $msiPath -SourceExe $exePath

    # Update website download config
    Update-DownloadConfig -Version $Version

    # Tag and push (includes updated download config)
    Invoke-TagAndPush -Version $Version

    # Create GitHub release
    New-GitHubRelease -Version $Version

    # Print URLs
    Write-ReleaseUrls -Version $Version

    # Confirm website update
    Write-ColorOutput "[OK] Website download page updated with v$Version metadata" "Green"
}

# Main menu
function Main {
    Write-Host ""
    Write-ColorOutput "========================================" "Cyan"
    Write-ColorOutput "    Mutaba3a Windows Deploy Script" "Cyan"
    Write-ColorOutput "========================================" "Cyan"
    Write-Host ""

    # Get and display current version
    $currentVersion = Get-Version
    $newVersion = Get-IncrementedPatch -Version $currentVersion

    Write-Host "Current version: " -NoNewline
    Write-ColorOutput $currentVersion "Yellow"
    Write-Host "Next version:    " -NoNewline
    Write-ColorOutput $newVersion "Green"
    Write-Host ""

    # Ask about version bump
    Write-ColorOutput "Version options:" "Cyan"
    Write-Host "  1) Auto-increment patch ($currentVersion -> $newVersion)"
    Write-Host "  2) Enter custom version (for major/minor updates)"
    Write-Host "  3) Keep current version"
    Write-Host ""
    $versionChoice = Read-Host "Select version option [1-3]"

    switch ($versionChoice) {
        "1" {
            Update-Version -NewVersion $newVersion
            $currentVersion = $newVersion
        }
        "2" {
            $customVersion = Read-Host "Enter new version (e.g., 1.0.0)"
            if ($customVersion -notmatch '^\d+\.\d+\.\d+$') {
                Write-Error "Invalid version format. Use X.Y.Z"
                exit 1
            }
            Update-Version -NewVersion $customVersion
            $currentVersion = $customVersion
        }
        "3" {
            Write-Warning "Keeping current version: $currentVersion"
        }
        default {
            Write-Error "Invalid option"
            exit 1
        }
    }

    Write-Host ""
    Write-ColorOutput "Deploy options:" "Cyan"
    Write-Host "  1) Build Tauri for Windows (local only)"
    Write-Host "  2) " -NoNewline
    Write-ColorOutput "Build Windows + Publish GitHub Release (MSI + EXE)" "Green"
    Write-Host "  3) Cancel"
    Write-Host ""
    $deployChoice = Read-Host "Select deploy option [1-3]"

    switch ($deployChoice) {
        "1" {
            Build-Windows
        }
        "2" {
            Invoke-BuildAndRelease -Version $currentVersion
        }
        "3" {
            Write-Warning "Cancelled"
            exit 0
        }
        default {
            Write-Error "Invalid option"
            exit 1
        }
    }

    Write-Host ""
    Write-ColorOutput "========================================" "Green"
    Write-ColorOutput "    Deploy complete! v$currentVersion" "Green"
    Write-ColorOutput "========================================" "Green"
}

# Run main
Main
