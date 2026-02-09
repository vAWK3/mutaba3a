# CI_CD.md — Continuous Integration & Deployment

> **Purpose**: Document CI/CD pipeline configuration and deployment processes.
> **Context**: Offline-first app with zero server costs; CI/CD focuses on quality gates.

---

## Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CI Pipeline                                     │
│                                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │  Lint    │───>│   Test   │───>│  Build   │───>│ Artifacts│              │
│  │ (ESLint) │    │ (Vitest) │    │  (Vite)  │    │  Upload  │              │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘              │
│       │               │               │                │                    │
│       ▼               ▼               ▼                ▼                    │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│  │ TypeCheck│    │ Coverage │    │ Bundle   │    │  Preview │              │
│  │   (tsc)  │    │  Report  │    │  Size    │    │  Deploy  │              │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              CD Pipeline                                     │
│                                                                              │
│         Web (PWA)                        Desktop (Tauri)                    │
│  ┌──────────────────┐           ┌────────────────────────────┐             │
│  │                  │           │                            │             │
│  │  Netlify Deploy  │           │  ┌──────┐    ┌──────────┐ │             │
│  │  (Automatic)     │           │  │macOS │    │ Windows  │ │             │
│  │                  │           │  │ DMG  │    │ MSI/EXE  │ │             │
│  │  - dist-web/     │           │  └───┬──┘    └────┬─────┘ │             │
│  │  - Preview on PR │           │      │            │       │             │
│  │  - Prod on main  │           │      └─────┬──────┘       │             │
│  │                  │           │            ▼              │             │
│  └──────────────────┘           │    GitHub Releases        │             │
│                                 │    (Manual trigger)       │             │
│                                 └────────────────────────────┘             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## GitHub Actions Workflows

### 1. CI Workflow (`.github/workflows/ci.yml`)

```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npx tsc --noEmit

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run test:coverage
      - uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
          fail_ci_if_error: false

  build-web:
    runs-on: ubuntu-latest
    needs: [lint, test]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build:web
      - uses: actions/upload-artifact@v4
        with:
          name: dist-web
          path: dist-web/

  build-desktop:
    runs-on: ubuntu-latest
    needs: [lint, test]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build:desktop
      - uses: actions/upload-artifact@v4
        with:
          name: dist-desktop
          path: dist-desktop/
```

---

### 2. Desktop Release Workflow (`.github/workflows/release-desktop.yml`)

```yaml
name: Release Desktop

on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Version (e.g., 0.0.49)'
        required: true

jobs:
  build-macos:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - uses: actions-rs/toolchain@v1
        with:
          toolchain: stable
      - run: npm run tauri build
        env:
          TAURI_PRIVATE_KEY: ${{ secrets.TAURI_PRIVATE_KEY }}
          TAURI_KEY_PASSWORD: ${{ secrets.TAURI_KEY_PASSWORD }}
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
      - uses: actions/upload-artifact@v4
        with:
          name: macos-bundle
          path: src-tauri/target/release/bundle/

  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - uses: actions-rs/toolchain@v1
        with:
          toolchain: stable
      - run: npm run tauri build
        env:
          TAURI_PRIVATE_KEY: ${{ secrets.TAURI_PRIVATE_KEY }}
          TAURI_KEY_PASSWORD: ${{ secrets.TAURI_KEY_PASSWORD }}
      - uses: actions/upload-artifact@v4
        with:
          name: windows-bundle
          path: src-tauri/target/release/bundle/

  release:
    needs: [build-macos, build-windows]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
      - uses: softprops/action-gh-release@v1
        with:
          tag_name: v${{ github.event.inputs.version }}
          name: Release v${{ github.event.inputs.version }}
          files: |
            macos-bundle/**/*.dmg
            windows-bundle/**/*.msi
            windows-bundle/**/*.exe
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

### 3. Web Deploy (Netlify Configuration)

**`netlify.toml`**:
```toml
[build]
  command = "npm run build:web"
  publish = "dist-web"

[build.environment]
  NODE_VERSION = "20"

# SPA routing - all /app/* routes to index.html
[[redirects]]
  from = "/app/*"
  to = "/app/index.html"
  status = 200

# Download redirects to GitHub releases
[[redirects]]
  from = "/download/mac"
  to = "https://github.com/vAWK3/mutaba3a/releases/latest/download/mutaba3a-macos-universal.dmg"
  status = 302

[[redirects]]
  from = "/download/windows"
  to = "https://github.com/vAWK3/mutaba3a/releases/latest/download/mutaba3a-windows-x64.msi"
  status = 302

# Preview deploys for PRs
[context.deploy-preview]
  command = "npm run build:web"
```

---

## Quality Gates

### Required Checks for Merge

| Check | Threshold | Blocking |
|-------|-----------|----------|
| **Lint** | No errors | Yes |
| **TypeCheck** | No errors | Yes |
| **Tests** | All passing | Yes |
| **Coverage** | 60% minimum | No (warning) |
| **Build** | Successful | Yes |
| **Bundle Size** | <300KB gzipped | No (warning) |

---

## Environment Variables

### CI/CD Secrets (GitHub)

| Secret | Purpose |
|--------|---------|
| `TAURI_PRIVATE_KEY` | Tauri update signing key |
| `TAURI_KEY_PASSWORD` | Tauri key password |
| `APPLE_CERTIFICATE` | macOS code signing cert (base64) |
| `APPLE_CERTIFICATE_PASSWORD` | Cert password |
| `APPLE_SIGNING_IDENTITY` | Signing identity name |
| `APPLE_ID` | Apple Developer account |
| `APPLE_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | Apple team ID |
| `CODECOV_TOKEN` | Coverage upload token |

### Build-Time Variables

| Variable | Web | Desktop | Purpose |
|----------|-----|---------|---------|
| `__APP_VERSION__` | Yes | Yes | Package version |
| `__BUILD_MODE__` | Yes | Yes | 'web' or 'desktop' |
| `TAURI_PLATFORM` | No | Yes | Tauri platform identifier |

---

## Deployment Process

### Web Deployment (Automatic)

1. **On PR**: Netlify creates preview deploy
2. **On merge to main**: Netlify deploys to production
3. **URL**: mutaba3a.app/app/

### Desktop Release (Manual)

1. **Trigger**: Manual workflow dispatch in GitHub
2. **Input**: Version number (e.g., 0.0.49)
3. **Process**:
   - Build macOS (.dmg) on macos-latest
   - Build Windows (.msi, .exe) on windows-latest
   - Create GitHub release with artifacts
4. **Auto-update**: Tauri apps check for updates on launch

### Release Checklist

```markdown
- [ ] Update version in package.json
- [ ] Update CHANGELOG.md
- [ ] Create git tag: `git tag v0.0.X`
- [ ] Push tag: `git push origin v0.0.X`
- [ ] Trigger desktop release workflow
- [ ] Verify GitHub release artifacts
- [ ] Test auto-update on existing install
- [ ] Update landing page if needed
```

---

## Cost Optimization

### Current Costs: $0/month

| Service | Cost | Notes |
|---------|------|-------|
| GitHub Actions | $0 | Free for public repos |
| Netlify | $0 | Free tier (100GB bandwidth) |
| Code Signing | ~$99/year | Apple Developer only |

### Scaling Considerations

- **GitHub Actions**: 2000 minutes/month free
- **Netlify**: 100GB bandwidth free, then $19/month
- **No server costs**: Static hosting only

---

## Monitoring

### Current Monitoring

| Aspect | Tool | Status |
|--------|------|--------|
| Build status | GitHub Actions | Active |
| Deploy status | Netlify | Active |
| Error tracking | None | Planned |
| Analytics | None | Intentionally none (privacy) |

### Future Considerations

- **Error tracking**: Consider Sentry with privacy-focused config
- **Performance**: Lighthouse CI for web vitals
- **Uptime**: Not needed (static site + CDN)

---

## Local Development

### Prerequisites

```bash
# Node.js 20+
node --version  # v20.x.x

# Rust (for Tauri)
rustc --version  # 1.70+

# Optional: Tauri CLI
cargo install tauri-cli
```

### Commands

```bash
# Install dependencies
npm install

# Development
npm run dev           # Default (auto-detect)
npm run dev:web       # Web mode
npm run dev:desktop   # Desktop mode (Tauri)

# Quality checks
npm run lint          # ESLint
npm run test          # Vitest (watch)
npm run test:run      # Vitest (single run)
npm run test:coverage # Coverage report

# Build
npm run build:web     # → dist-web/
npm run build:desktop # → dist-desktop/
npm run tauri build   # Full desktop bundle

# Preview
npm run preview:web   # Serve dist-web/
```

---

## Troubleshooting

### Common CI Failures

| Issue | Cause | Fix |
|-------|-------|-----|
| Lint errors | Code style | Run `npm run lint` locally |
| Type errors | TypeScript | Run `npx tsc --noEmit` |
| Test failures | Breaking change | Check test output |
| Build failure | Dependency issue | Clear cache, reinstall |

### Netlify Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| 404 on routes | SPA redirect missing | Check netlify.toml |
| Old content | CDN cache | Clear cache in dashboard |
| Build timeout | Dependencies | Check build command |

### Tauri Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Signing failed | Missing secrets | Check GitHub secrets |
| Build failed | Rust version | Update Rust toolchain |
| Update failed | Bad signature | Regenerate signing key |
