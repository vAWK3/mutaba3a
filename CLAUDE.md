Here’s a revised CLAUDE.md that keeps your “Project Intelligence & Engineering Standards” template, but injects the original mini-rm product/UX/architecture spec as the authoritative project layer (routes, AppShell, drawers-first UX rule, offline-first repo, schema, build order, perf guardrails, etc.) pulled from the attached file.  ￼

# CLAUDE.md — Project Intelligence & Engineering Standards

> **This file is the single source of truth for all AI-assisted development in this project.**
> Claude MUST read this file at the start of every session and follow all instructions precisely.

---

## 🧭 PROJECT-SPEC FIRST (MINI-RM) — AUTHORITATIVE IMPLEMENTATION TARGET

This repository implements a **desktop-first mini resource manager** (mini-rm) that feels like a tool, not a website.

### Non-negotiable UX rule
- **No “create pages.” Everything is drawer-first** so the app feels like a cockpit, not CRUD.  [oai_citation:1‡CLAUDE.md](sediment://file_00000000257c71f497b73d6e8f34d399)

### Rendering + state boundaries (MVP)
- **SPA/PWA** (server irrelevant for MVP)
- **Local-first data** in IndexedDB now (Dexie), with a **Repo abstraction**
- **UI state** (filters, drawers) stored in **URL + lightweight store**
- **Derived totals** computed in Repo (preferred) or memoized selectors  [oai_citation:2‡CLAUDE.md](sediment://file_00000000257c71f497b73d6e8f34d399)

### Suggested stack
- React + Vite
- TanStack Router (or React Router)
- TanStack Query
- Dexie (IndexedDB)
- Later: swap Repo to SQLite in Tauri  [oai_citation:3‡CLAUDE.md](sediment://file_00000000257c71f497b73d6e8f34d399)

---

## 🗺️ ROUTES (MVP)

- / → Overview
- /projects → Projects index
- /projects/:projectId → Project detail
- /clients → Clients index
- /clients/:clientId → Client detail
- /transactions → Transactions ledger
- /reports → Reports
- /settings → Settings  [oai_citation:4‡CLAUDE.md](sediment://file_00000000257c71f497b73d6e8f34d399)

---

## 🧱 APP SHELL (ALWAYS MOUNTED)

### AppRoot providers
- RepoProvider(repo)
- QueryClientProvider
- AppUIProvider (drawer state, toasts)
- Router  [oai_citation:5‡CLAUDE.md](sediment://file_00000000257c71f497b73d6e8f34d399)

### AppShell composition

AppShell
├─ SidebarNav
├─ TopBar
├─ MainViewport
└─ GlobalOverlays
├─ TransactionDrawerController
├─ ProjectDrawerController
└─ ClientDrawerController

### SidebarNav
- Fixed left navigation; Settings pinned at bottom
- Active state + keyboard friendly
- Collapsible sections later, not MVP  [oai_citation:7‡CLAUDE.md](sediment://file_00000000257c71f497b73d6e8f34d399)

### TopBar
- Sticky in content
- Page title + breadcrumb only on detail pages
- Primary CTA: **+ Add (menu)**  [oai_citation:8‡CLAUDE.md](sediment://file_00000000257c71f497b73d6e8f34d399)

### GlobalOverlays URL mirroring (deep linkable)
- Edit drawer: `?tx=<id>`
- Create drawer: `?newTx=income|expense|receivable&clientId=&projectId=`  [oai_citation:9‡CLAUDE.md](sediment://file_00000000257c71f497b73d6e8f34d399)

---

## 🧩 SHARED UI COMPONENTS (COCKPIT KIT)

### Filters (reusable)
- DateRangeControl (presets: This month, Last month, This year, Custom)
- CurrencyTabs (USD, ILS, optional All Converted)
- TypeSegment (All | Income | Receivable | Expense)
- StatusSegment (All | Paid | Unpaid | Overdue)
- SearchInput (client/project/note; debounce ~200ms)  [oai_citation:10‡CLAUDE.md](sediment://file_00000000257c71f497b73d6e8f34d399)

Perf rule:
- Filters update a **single FiltersModel** object and push to URL (replaceState), not multiple setStates.  [oai_citation:11‡CLAUDE.md](sediment://file_00000000257c71f497b73d6e8f34d399)

### Tables
- DataTable(columns, rows, rowKey, onRowClick)
- CellAmount(amountMinor, currency)
- CellStatus(status, dueDate, paidAt)
- RowActionsMenu  [oai_citation:12‡CLAUDE.md](sediment://file_00000000257c71f497b73d6e8f34d399)

Perf rule:
- Tables receive **already-shaped rows**, not raw transactions computed per cell.  [oai_citation:13‡CLAUDE.md](sediment://file_00000000257c71f497b73d6e8f34d399)

### Summary blocks
- KpiRow
- InlineStat
- AttentionList  [oai_citation:14‡CLAUDE.md](sediment://file_00000000257c71f497b73d6e8f34d399)

---

## 📄 SCREEN SPECS (MVP BEHAVIOR)

### Overview (/)
- Top controls: DateRange (default This month), Currency tabs
- KPI cards: Paid Income, Unpaid Receivables, Expenses, Net
- Needs attention: overdue + due next 7 days
- Recent activity (last 10)
- Row click opens TransactionDrawer edit  [oai_citation:15‡CLAUDE.md](sediment://file_00000000257c71f497b73d6e8f34d399)

### Transactions ledger (/transactions) “truth table”
- Filters: date, currency, type, status, search
- Row click opens TransactionDrawer edit (`?tx=`)  [oai_citation:16‡CLAUDE.md](sediment://file_00000000257c71f497b73d6e8f34d399)

### Projects (/projects) + detail (/projects/:id)
- Index columns: project, client, field, paid, unpaid, expenses, net, last activity
- Detail: tabs (Summary, Transactions, Notes optional), +Add prefilled with project  [oai_citation:17‡CLAUDE.md](sediment://file_00000000257c71f497b73d6e8f34d399)

### Clients (/clients) + detail (/clients/:id)
- Index columns: client, active projects, paid, unpaid, last payment, last activity
- Detail: tabs (Summary, Projects, Receivables, Transactions)
- Receivables focus: due, days overdue, mark paid  [oai_citation:18‡CLAUDE.md](sediment://file_00000000257c71f497b73d6e8f34d399)

### Reports (/reports)
- Presets: month/year/by project/by client/expenses by category/unpaid aging
- Export CSV (MVP)
- Converted toggle only if FX configured  [oai_citation:19‡CLAUDE.md](sediment://file_00000000257c71f497b73d6e8f34d399)

### Settings (/settings)
- Enabled currencies, default currency tab
- FX settings (manual rates) for converted reports
- Data export/import  [oai_citation:20‡CLAUDE.md](sediment://file_00000000257c71f497b73d6e8f34d399)

---

## 🗃️ DATA MODEL (OFFLINE-FIRST, MULTI-CURRENCY)

### Core entities
- Client
- Project
- Transaction  [oai_citation:21‡CLAUDE.md](sediment://file_00000000257c71f497b73d6e8f34d399)

### Represent “unpaid income”
- Do **not** invent a second object.
- Receivable = Transaction with `kind=income` and `status=unpaid`.  [oai_citation:22‡CLAUDE.md](sediment://file_00000000257c71f497b73d6e8f34d399)

### Currency rules (non-negotiable)
1. Always store original amount + currency
2. Reports are per-currency by default
3. “All Converted” is optional and must clearly show base currency + FX source/date  [oai_citation:23‡CLAUDE.md](sediment://file_00000000257c71f497b73d6e8f34d399)

### Minimal schema (SQLite-friendly; also maps to IndexedDB tables)
(Keep the semantics exactly; storage engine can vary.)  [oai_citation:24‡CLAUDE.md](sediment://file_00000000257c71f497b73d6e8f34d399)

### Receivable logic
- receivable: `kind='income' && status='unpaid'`
- overdue: receivable && due_date < today
- mark paid:
  - set status='paid'
  - set paid_at = now
  - keep occurred_at as earned/issued date  [oai_citation:25‡CLAUDE.md](sediment://file_00000000257c71f497b73d6e8f34d399)

---

## 🧱 REPOSITORY API (STORAGE-AGNOSTIC CONTRACT)

UI never touches SQL directly; UI uses Repo interface so we can swap Dexie → SQLite later.  [oai_citation:26‡CLAUDE.md](sediment://file_00000000257c71f497b73d6e8f34d399)

---

## 🧾 FX “ALL (CONVERTED)” RULES (HONEST CONVERSIONS)

- Enable only when base currency selected and rates exist
- Pick one conversion convention and never mix
- Rows may show original amount + converted amount + FX rate effective date
- MVP shortcut: for “This month”, use latest rate that month unless per-day exists  [oai_citation:27‡CLAUDE.md](sediment://file_00000000257c71f497b73d6e8f34d399)

---

## 🧱 BUILD ORDER (FASTEST PATH)

1. Repo + schema + seed
2. Transactions ledger + TransactionDrawer
3. Projects index/detail
4. Clients index/detail
5. Overview (totals + attention)
6. Reports presets (reuse query + group)  [oai_citation:28‡CLAUDE.md](sediment://file_00000000257c71f497b73d6e8f34d399)

---

## 🚀 PERFORMANCE GUARDRAILS

- Pre-shape rows in useMemo before passing to tables
- Column defs stable via useMemo([])
- Filter state stored as one object + URL sync to avoid rerender storms
- Ledger scaling later: pagination or virtualization; default hard cap = This month  [oai_citation:29‡CLAUDE.md](sediment://file_00000000257c71f497b73d6e8f34d399)

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
3. Before UI work: follow `docs/admin-panel/04-UI-UX-DESIGN.md`
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

`test:run` is the whole Vitest suite once (unit and Dexie integration tests live side by side; `npm run test` is watch mode).
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
□ Re-validate mini-rm Project-Spec First section in this CLAUDE.md

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