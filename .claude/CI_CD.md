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

CD: `make release web` pushes main and Netlify builds the website (dist-web); `make release server` deploys
the API with the portal (dist-hosted) inside its image. The desktop pipeline was retired (MUT-445, ADR-202).
```

---

## GitHub Actions Workflows

### 1. Web CI (`.github/workflows/web-ci.yml`, since 2026-10-16, MUT-24 §C)

Replaces the `ci.yml` this section used to sketch, which never existed. It runs
on pull requests, on pushes to `main` and on manual dispatch. It skips changes
that touch only `server/**` (Server CI covers those), docs or other markdown.
It has one job, `verify`, on Node 22 with the npm cache:

| Step | Fails when |
|------|------------|
| `npm ci --no-audit --no-fund` | the lockfile doesn't install |
| `npm run lint` | any ESLint error |
| `npm run typecheck` | `tsconfig.app.json` or `tsconfig.hosted.json` has a type error |
| `npm run test:coverage` | any Vitest test fails, or coverage falls below `coverage.thresholds` in `vitest.config.ts` (the global floors plus the per-file risk floors) |
| Coverage to the job summary | never fails the job. `scripts/coverage-summary.ts` turns `coverage/coverage-summary.json` into a markdown table (the four totals, then the ten files with the most uncovered lines) and appends it to `$GITHUB_STEP_SUMMARY` |

It builds nothing for release, deploys nothing and pushes nothing. `npm run
build` and `test:bundles` stay local gates (CLAUDE.md Phase 4). Raising the
thresholds is a deliberate edit to `vitest.config.ts` after a coverage gain.
Never lower them to land a change.

---

### 2. Desktop Release Workflow (retired)

The desktop apps were retired by MUT-445 (ADR-202): there is no desktop build, release workflow, updater or GitHub release. The Windows workflow and `deploy.sh` are deleted.

### 3b. Contracts CI (`.github/workflows/contracts-ci.yml`, since 2026-10-17, MUT-147)

Web CI skips `docs/**` and Server CI watches only `server/**`. This one job runs
the Sentry scrub-contract tests and the analytics event-contract tests when
any of these change:

- `docs/observability/**` or `docs/analytics/**`;
- those tests themselves;
- `scripts/sentry-org-*.ts` or `.gitattributes`.

Node 22, `npm ci`, then `npx vitest run` on the three test files. It never deploys and never contacts Sentry or PostHog.

### 3a. Server CI (`.github/workflows/server-ci.yml`, since 2026-10-08)

Runs on pull requests beside Web CI. Scoped by `paths:` to
`server/**`; three jobs, no deploy:

| Job | What it proves |
|-----|----------------|
| `verify` | `npm ci`, `prisma generate`, type-check, lint, `openapi:check`, `prisma migrate deploy` + `npm run test:db` against a `postgres:16-alpine` service container (65 tests) |
| `docker` | `docker build` of the service image; boots it with a dummy `DATABASE_URL` and curls `/health`. Never pushes |
| `terraform` | `terraform fmt -check -recursive`, `init -backend=false`, `validate` on `server/infrastructure/terraform` |

Red `Server CI` = do not run `server/scripts/deploy.sh`. Deploys are
operator-run (see "Hosted API Deployment" below and `server/DEPLOYMENT.md`).

### 3. Web Deploy (Netlify Configuration)

`netlify.toml` builds the website (`npm run build:web && npx tsx scripts/check-bundles.ts --dist dist-web`) and publishes `dist-web`. Its redirects send `/download`, `/download/*`, `/app`, `/app/*` and `/hosted` home (301) before the SPA fallback; `public/sw.js` removes the retired free web app's service worker (MUT-445, ADR-202). The domain move's host-scoped rules are emitted as `_redirects` by `vite.config.ts` (ADR-155).

---

## Quality Gates

### Required Checks for Merge

| Check | Threshold | Blocking |
|-------|-----------|----------|
| **Lint** | No errors | Yes |
| **TypeCheck** | No errors | Yes |
| **Tests** | All passing | Yes |
| **Coverage** | `vitest.config.ts` thresholds: global floors + risk files at 95/100 (MUT-24) | Yes (Web CI) |
| **Build** | Successful | Yes |
| **Bundle Size** | <300KB gzipped | No (warning) |

---

## Environment Variables

### CI/CD Secrets (GitHub)

| Secret | Purpose |
|--------|---------|
| `CODECOV_TOKEN` | Coverage upload token |

### Build-Time Variables

| Variable | Purpose |
|----------|---------|
| `__APP_VERSION__` | Package version |
| `__PORTAL_URL__` | The portal origin the landing links to (website build) |

---

## Deployment Process

### Web Deployment (Automatic)

1. **On PR**: Netlify creates preview deploy
2. **On merge to main**: Netlify deploys to production
3. **URL**: mtb3a.com (the landing, `/privacy`, `/terms`); the free web app at mutaba3a.netlify.app/app is retired (MUT-445)

### Hosted API Deployment (operator, manual)

```bash
cd server
GCP_PROJECT_ID=<project> TF_STATE_BUCKET=<bucket> ./scripts/deploy.sh
```

Runs on the operator's machine (ADR-026): local `docker build` + push →
`prisma migrate deploy` through the Cloud SQL Auth Proxy → Terraform apply →
smoke test, in that order; the service is not rolled if the migration fails.
Production only for now. Full runbook: `server/DEPLOYMENT.md`. Infra:
`server/infrastructure/terraform/`.

### Release Checklist

`make release web` and `make release server` run their own gates and preflight (ADR-043); `docs/operations/before-release.md` lists the open operator steps.

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
| Error tracking | Defined, not wired (MUT-147): Sentry EU org, projects and alerts in `server/infrastructure/sentry`, rules in `docs/observability` (ADR-091) | MUT-148..151 wire the server, portal, landing and phone; never the local app |
| Analytics | PostHog EU (planned, MUT-152) | Landing cookieless; portal and phone opt-in and anonymous; the local app sends nothing (ADR-090) |

### Future Considerations

- **Error tracking**: Sentry with a privacy-focused config (epic MUT-146); errors never go to PostHog (ADR-090)
- **Performance**: Lighthouse CI for web vitals
- **Uptime**: Not needed (static site + CDN)

---

## Local Development

### Prerequisites

```bash
# Node.js 22 (Node 25+ breaks every localStorage test, TD-054)
node --version
```

### Commands

```bash
# Install dependencies
npm install

# Development
npm run dev           # The website on :5173
npm run dev:hosted    # The portal on :5175

# Quality checks
npm run lint          # ESLint
npm run test          # Vitest (watch)
npm run test:run      # Vitest (single run)
npm run test:coverage # Coverage report

# Build
npm run build:web     # → dist-web/
npm run build:hosted  # → dist-hosted/
npm run test:bundles  # build both, then the bundle guard

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

