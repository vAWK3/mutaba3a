# CLAUDE.md — Project Intelligence & Engineering Standards

> **This file is the single source of truth for all AI-assisted development in this project.**
> Claude MUST read this file at the start of every session and follow all instructions precisely.

---

## 🧭 WHAT THIS REPO IS (2026-10-27)

MTB3A (Arabic **متابعة**; English is always "MTB3A", ADR-173) tracks who owes a freelancer or a small firm money, what came in and what went out, per currency. It runs on **iOS, Android and the web portal**. The desktop apps and the free local web app at `/app` are retired (MUT-445, ADR-203); device sync is retired (ADR-053). `.claude/SYSTEM_OVERVIEW.md` holds the detail; sections there that describe Dexie, the `/app` routes or the desktop app are history.

| Part | Where | Ships as |
|---|---|---|
| **Portal** (the web app) | `src/hosted/**`, `vite --mode hosted` | `app.mtb3a.com` |
| **API** | `server/` (Hono, Prisma, Postgres, OpenAPI) | Cloud Run (`api-v*` tags) |
| **Website** | `src/main.tsx`, `src/pages/landing/**`: the landing, `/privacy`, `/terms` | Netlify, `mtb3a.com` (`web-v*` tags) |
| **Phone app** | the Flutter repo (`mutaba3a-flutter`), not here | App Store, Google Play |

`src/lib/**` and `src/components/**` hold what the portal and the website share. The portal may not import server code (`src/hosted` ⊄ `server/src`, an ESLint guard), and the website build carries no portal code.

### The portal's two modes (ADR-097, ADR-100)
- **Signed in:** every read and write goes to the API.
- **Signed out:** the same portal runs on this device. The server's own Hono routes run in the browser over IndexedDB (`src/hosted/local/`, a lazy chunk). Records leave the device only as a file (Your data › Download and Restore). Nothing moves signed-out records into an account (MUT-290, won't do).

### Non-negotiable rules
- **Drawer-first:** no "create pages". Adding and editing happen in drawers over the page.
- **Arabic first, right to left** (ADR-077): every surface opens in Arabic until the person chooses. All user-facing text goes through i18n keys; the portal is Arabic and English.
- **Money keeps its currency** (ADR-004): store the original amount in minor units with its currency, total per currency by default, and when converting, show the base currency and the rate's source and date.
- **Owed** is income not yet fully paid; overdue is owed past its due date. Paying keeps the income's own date; the payment carries its own.
- **UI work** follows `DESIGN.md` (which component, colour role and type style each portal pattern uses).

### Portal routes (`src/hosted/router.tsx`)
- Pages that need no sign-in: `/sign-in`, `/signup`, `/recover`, `/setup`, `/carry-over`, `/carry-over/receive`, `/welcome` (MUT-513; a first visit to `/` shows the same welcome).
- Under a profile, `/p/$profileId`: `/` (overview), `/receivables`, `/payments`, `/clients`, `/clients/$customerId`, `/expenses` (with `/groups` and `/receipts`), `/conversions`, `/documents`, `/reports`.
- Also `/reports` (the Glance across profiles, ADR-204), `/capture`, `/connect/approve`.

---

## 🧠 SELF-MANAGED KNOWLEDGE SYSTEM

Claude is responsible for maintaining its own project memory to prevent contradictions and regressions.

### Knowledge Files (Claude must maintain these)

.claude/
├── SYSTEM_OVERVIEW.md
├── DECISIONS.md
├── CHANGELOG.md
├── COMPONENT_REGISTRY.md
├── PATTERNS.md
├── TECH_DEBT.md
├── TEST_PLAN.md
└── INFRA.md

### Design & Roadmap Documentation (Authoritative Source)

docs/
├── README.md
├── admin-panel/
│ ├── 01-VISION.md
│ ├── 02-ARCHITECTURE.md
│ ├── 03-DATA-MODELS.md
│ ├── 04-UI-UX-DESIGN.md
│ ├── 05-FEATURES.md
│ └── 06-SECURITY.md
├── architecture/
│ └── SYSTEM-ARCHITECTURE.md
└── roadmap/
└── ROADMAP.md

Claude MUST consult `docs/` before implementing any feature, fix, or enhancement:
1. Before any new feature: read `docs/admin-panel/05-FEATURES.md`
2. Before architecture decisions: check `docs/admin-panel/02-ARCHITECTURE.md` + `docs/architecture/SYSTEM-ARCHITECTURE.md`
3. Before UI work: follow `DESIGN.md` (which component, colour role and type style each pattern uses in the portal) and `docs/admin-panel/04-UI-UX-DESIGN.md`
4. Before data model changes: consult `docs/admin-panel/03-DATA-MODELS.md`
5. Before starting any phase: reference `docs/roadmap/ROADMAP.md`
6. Before security-related work: read `docs/admin-panel/06-SECURITY.md`
7. After completing a roadmap milestone: update `docs/roadmap/ROADMAP.md`

### Knowledge Update Protocol

Before making ANY change, Claude MUST:
1. Read ALL files in `.claude/`
2. Read `SYSTEM_OVERVIEW.md`
3. Check `DECISIONS.md`
4. Check `COMPONENT_REGISTRY.md`
5. Check `PATTERNS.md`

After completing ANY change, Claude MUST:
1. Update `CHANGELOG.md` (date, what, why, files)
2. Update `SYSTEM_OVERVIEW.md` if features/capabilities/architecture changed
3. Update `DECISIONS.md` if a new decision was made
4. Update `COMPONENT_REGISTRY.md` if reusable components changed/added
5. Update `PATTERNS.md` if a new pattern was introduced
6. Update `TECH_DEBT.md` if debt introduced/resolved
7. Update `TEST_PLAN.md` with coverage updates

### Conflict Prevention Rules
- NEVER contradict `DECISIONS.md` without explicit override log (why, what replaces it, date)
- NEVER duplicate functionality (check `COMPONENT_REGISTRY.md` first)
- NEVER introduce new patterns if existing in `PATTERNS.md` fits
- If conflict exists between code and documented decisions, STOP and flag it

---

## 🏗️ FEATURE DEVELOPMENT LIFECYCLE

Every new feature MUST follow this lifecycle.

### Phase 1: Design
Before writing implementation code:
1. Write Design Brief: `.claude/designs/<feature-name>.md`
   - problem + acceptance criteria
   - proposed solution + component diagram
   - API contracts + error states
   - reuse analysis (COMPONENT_REGISTRY)
   - impact analysis
   - i18n/l10n considerations
   - cost implications
   - infra requirements
2. Get explicit user approval before proceeding

### Phase 2: Test Plan & TDD
1. Write Test Plan: `.claude/designs/<feature-name>-tests.md`
2. Write tests first (Red)
3. Implement (Green)
4. Refactor (keep Green)

### Phase 3: Implementation
- Clean, production-ready code
- Run ALL tests locally
- Verify zero regressions

### Phase 4: Verification
Run locally, under Node 22 (Node 25+ breaks every localStorage test, TD-054):
```bash
npm run lint
npm run typecheck
npm run test:run
npm run build
```

`test:run` is the whole Vitest suite once (unit and the portal's local-mode integration tests, over fake IndexedDB, live side by side; `npm run test` is watch mode).
Changes under `server/` also run what server CI runs: `npm --prefix server run typecheck`, `npm --prefix server run lint`, `npm --prefix server run openapi:check` and `npm --prefix server test`. CI additionally runs `test:db` against Postgres (see `.github/workflows/server-ci.yml`); TODOS #8 is a known audit-ordering flake there.

No task is “done” until all pass.

### Phase 5: Release-QA coverage (every new feature)
Every new feature is specced so the `/release-qa` skill can test it on **web** (Playwright, recorded video). Engine and format: `~/.claude/skills/release-qa/SKILL.md`.
1. The design brief carries a **QA scenarios** section: each user-visible flow, its steps as the user would say them, and the outcome it promises.
2. Each scenario becomes a feature in `qa/features/<app>/<area>.yaml` (`web` for the app, `portal` for `src/hosted/**`): `id`, `title`, `tier`, `steps`, `expect`, and `paths` that cover the new code. `tier: core` only if everyone is broken when it breaks.
3. Automate it: one `test` per feature in `qa/specs/<app>/<area>.spec.ts`, tagged `@<app>.<area>.<id>`, every user-visible action wrapped in `step(...)`, ending on the `expect` outcome. Run it once until it passes (`release-qa run --attach --only <id>`); a spec that has never passed is not done. `manual: true` only when it genuinely cannot be automated.
4. `release-qa lint` reports no errors and no new unmapped files.

⸻

📐 CODE STANDARDS & DESIGN PATTERNS

Clean Code Principles
	•	Single responsibility
	•	DRY, KISS, YAGNI
	•	Meaningful naming
	•	Small functions (~20 lines)
	•	No magic numbers/strings
	•	Explicit over implicit

Engineering Patterns (document in PATTERNS.md)
	•	Repository, Factory, Strategy, Observer/Event, Adapter
	•	Dependency Injection
	•	CQRS where it adds value
	•	Circuit breaker for external calls

Code Organization

src/
├── components/
├── services/
├── repositories/
├── models/
├── utils/
├── config/
├── middleware/
├── i18n/
│ └── locales/
├── infrastructure/
│ ├── terraform/
│ └── docker/
└── tests/
   ├── unit/
   ├── integration/
   ├── e2e/
   └── fixtures/

Component Reusability Rules
	•	Check COMPONENT_REGISTRY + codebase before creating anything new
	•	If 70%+ overlap: extend existing component
	•	Register every reusable component
	•	Components require docs + tests + usage example

⸻

☁️ CLOUD NATIVE & INFRASTRUCTURE AS CODE

Cloud Native Principles
	•	12-factor
	•	Containerized
	•	Stateless processes
	•	Disposable
	•	Dev/prod parity
	•	Logs as streams
	•	Health checks: /health and /ready

IaC
	•	ALL infra in code (Terraform/Pulumi/CDK; decision in DECISIONS.md)
	•	IaC lives in src/infrastructure/
	•	Review plan/preview before apply
	•	Remote state
	•	Parameterized environments

Docker Standards

FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
USER node
EXPOSE 3000
HEALTHCHECK CMD curl -f http://localhost:3000/health || exit 1
CMD ["node", "dist/index.js"]


⸻

🔐 ENVIRONMENT VARIABLES & CONFIGURATION

Rules
	•	Never hardcode secrets/URLs/ports/env-specific values
	•	.env.example committed; real .env ignored
	•	Validate env at startup; fail fast

Config pattern

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  API_KEY: z.string().min(1),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DEFAULT_LOCALE: z.string().default('en'),
});

export const config = envSchema.parse(process.env);

Secrets management
	•	Use cloud secrets manager
	•	Never log secrets
	•	Rotate regularly; design for rotation
	•	Document vars in .env.example and README

⸻

🌍 INTERNATIONALIZATION (i18n) & MULTILINGUAL SUPPORT

Rules
	•	All user-facing strings via i18n keys
	•	Locale-aware formatting (Intl)
	•	RTL supported from day one
	•	ICU MessageFormat

⸻

💰 COST OPTIMIZATION
	•	Smallest resources that meet perf
	•	Auto-scaling
	•	Cache at every layer
	•	Budgets + alerts
	•	Pagination for list endpoints
	•	Index DB queries; document indexes

⸻

🧪 TESTING STANDARDS
	•	Test pyramid: unit 70%, integration 20%, e2e 10%
	•	TDD mandatory
	•	Every function: happy + edge + error
	•	Isolation, mock boundaries only
	•	Coverage: 80% min; 100% for critical logic
	•	Regression suite must pass before completion

⸻

📝 GIT & CHANGE MANAGEMENT

Commit format:

<type>(<scope>): <short description>

<body — what and why>

<footer — breaking changes, refs>

Branch strategy:
	•	main, develop, feature/, fix/, infra/

⸻

🚨 CLAUDE’S MANDATORY WORKFLOW CHECKLIST

Before starting ANY task:

□ Read all files in .claude/
□ Read SYSTEM_OVERVIEW.md
□ Check COMPONENT_REGISTRY.md
□ Check PATTERNS.md
□ Check DECISIONS.md
□ Check docs/roadmap/ROADMAP.md
□ Check relevant docs/admin-panel specs
□ Re-validate the "What this repo is" section at the top of this CLAUDE.md

Before considering ANY task complete:

□ Clean code principles followed
□ Env vars externalized
□ i18n keys used
□ Component registry updated
□ Design doc created (new features)
□ TDD followed
□ All tests pass (unit + integration + existing)
□ Lint passes
□ Build succeeds
□ Typecheck passes
□ Release-QA: feature in qa/features/<app>/*.yaml with paths covering the new code, a passing tagged spec in qa/specs/<app>/, release-qa lint clean
□ CHANGELOG updated
□ SYSTEM_OVERVIEW updated (if needed)
□ DECISIONS/PATTERNS/TECH_DEBT/TEST_PLAN updated (if needed)
□ No regressions


⸻

🚫 DEPLOYMENT & GIT RESTRICTIONS

Claude is NOT allowed to:
	•	deploy (firebase/gcloud/terraform apply/pulumi up/etc)
	•	push to remote (git push, force push, PR creation)

Claude CAN:
	•	create branches locally
	•	stage + commit locally
	•	run tests/builds/lint locally
	•	prepare configs/scripts + document exact commands for the user

⸻

⚠️ ABSOLUTE RULES — NEVER BREAK THESE
	1.	Never skip TDD
	2.	Never hardcode env-specific values
	3.	Never duplicate components (reuse/extend)
	4.	Never contradict DECISIONS without override log
	5.	Never call task done without running required checks
	6.	Never introduce new pattern without documenting
	7.	Never create infra manually
	8.	Never commit secrets
	9.	Never skip knowledge updates
	10.	Never merge with failing tests
	11.	Never auto-deploy
	12.	Never auto-push

---

## 💾 Disk-space gate: 20 GB free before any worktree or work

Before creating a git worktree or starting any work in this repo (installs, builds, test runs, simulators, Docker, code changes), check free space on the root volume:

```bash
df -g / | awk 'NR==2 {print $4}'
```

If it prints a number **under 20** (GB), do not create the worktree and do not start. Stop, tell the user how much is free, and ask them to free space first. Start only once free space is 20 GB or more, or the user explicitly says to go ahead anyway. This also applies before spawning sessions or subagents.
