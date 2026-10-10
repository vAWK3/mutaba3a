# DECISIONS.md — Architectural Decision Records

> **Purpose**: Document all significant architectural and technical decisions.
> **Rule**: Never contradict a decision without explicit override (with date, reason, and replacement).

---

## Decision Index

| ID | Title | Status | Date |
|----|-------|--------|------|
| ADR-001 | Offline-First with IndexedDB | Active | 2024-01 |
| ADR-002 | Repository Pattern for Storage Abstraction | Active | 2024-01 |
| ADR-003 | Drawer-First UX Pattern | Active | 2024-01 |
| ADR-004 | Multi-Currency as First-Class Citizen | Active | 2024-01 |
| ADR-005 | No Server Backend for MVP | Active | 2024-01 |
| ADR-006 | TanStack Query for Data Fetching | Active | 2024-02 |
| ADR-007 | Zustand for UI State | Active | 2024-02 |
| ADR-008 | URL-Driven Drawer State | Active | 2024-02 |
| ADR-009 | Amounts in Minor Units (Cents) | Active | 2024-02 |
| ADR-010 | Receivable as Transaction Status | Active | 2024-02 |
| ADR-011 | Hybrid Logical Clock for Sync | Active | 2024-06 |
| ADR-012 | Operation Log (CRDT-like) for Sync | Active | 2024-06 |
| ADR-013 | Local-Only Sync (LAN + File Bundle) | Active | 2024-06 |
| ADR-014 | Document Immutability After Export | Active | 2024-08 |
| ADR-015 | Profile-Scoped Expenses | Active | 2024-09 |
| ADR-016 | Tauri for Desktop Distribution | Active | 2024-03 |
| ADR-017 | React 19 with TypeScript Strict | Active | 2025-01 |
| ADR-018 | CSS Variables for Theming | Active | 2024-03 |
| ADR-019 | i18n with Context + Intl APIs | Active | 2024-04 |
| ADR-020 | Vitest for Testing | Active | 2024-05 |
| ADR-021 | Question-First UX Redesign | Active | 2026-03 |
| ADR-022 | Local Calendar Date as the Basis for Overdue | Active | 2026-10 |
| ADR-023 | Reuse Malafat's OAuth 2.1 Server for Workspace Auth | Active | 2026-10 |
| ADR-024 | Override of ADR-005: A Hosted Mutaba3a Service Exists Beside the Local-First App | Active | 2026-10 |
| ADR-025 | Hosted Financial API (Money v1 Option B): Organization-Scoped Ledger Service, Malafat as API-Key Client | Active | 2026-10 |
| ADR-026 | Hosted API Deployment: Terraform Owns the Stack Including the Image Tag, One Local Script Rolls It (Local Build, Local Migrations), One Instance Until TD-017 | Active | 2026-10 |
| ADR-027 | Fee Approval Creates the Agreement (Override of M7 Brief Decisions 2 and 3) | Active | 2026-10 |

---

## ADR-001: Offline-First with IndexedDB

**Status**: Active
**Date**: 2024-01
**Context**: Target users include freelancers in regions with unreliable internet and privacy-conscious users who distrust cloud storage.

**Decision**: Use IndexedDB (via Dexie.js) as the primary data store. The app must function fully without any network connection.

**Consequences**:
- All data lives locally in the browser/app
- No server infrastructure costs
- Sync becomes a separate, explicit feature
- Data portability requires export/import mechanisms
- Large datasets may hit IndexedDB storage limits (~50MB+ depending on browser)

**Alternatives Considered**:
- SQLite via WebAssembly: Too complex for MVP, revisit for Tauri
- LocalStorage: Size limits (5MB), no indexing
- Cloud-first with offline cache: Violates privacy principles

---

## ADR-002: Repository Pattern for Storage Abstraction

**Status**: Active
**Date**: 2024-01
**Context**: Want to potentially migrate from IndexedDB to SQLite (via Tauri) without rewriting business logic.

**Decision**: All database access goes through repository interfaces (`clientRepo`, `projectRepo`, `transactionRepo`, etc.). UI never touches Dexie directly.

**Consequences**:
- Clean separation between storage and business logic
- Can swap storage implementation without changing components
- Slightly more code than direct Dexie access
- Must maintain repository API surface

**Implementation**:
```typescript
// src/db/repository.ts exports all repos
export const clientRepo = {
  list(includeArchived?: boolean): Promise<Client[]>,
  get(id: string): Promise<Client | undefined>,
  create(data: Omit<Client, 'id' | 'createdAt' | 'updatedAt'>): Promise<Client>,
  update(id: string, data: Partial<Client>): Promise<void>,
  archive(id: string): Promise<void>,
  delete(id: string): Promise<void>,
};
```

---

## ADR-003: Drawer-First UX Pattern

**Status**: Active
**Date**: 2024-01
**Context**: Goal is a "cockpit" feel, not a traditional CRUD website with full-page forms.

**Decision**: All create/edit operations happen in slide-in drawers from the right side. No dedicated "create" or "edit" pages.

**Consequences**:
- Context is preserved when editing (list stays visible)
- Faster perceived interaction (no page transitions)
- Must manage drawer state carefully (URL sync, keyboard, mobile)
- Complex forms may feel cramped on mobile

**URL Pattern**:
- Edit drawer: `?tx=<id>` (transaction), `?client=<id>`, `?project=<id>`
- Create drawer: `?newTx=income&clientId=<id>&projectId=<id>`

---

## ADR-004: Multi-Currency as First-Class Citizen

**Status**: Active
**Date**: 2024-01
**Context**: Target market (Israel/MENA region) commonly deals in multiple currencies (USD, ILS, EUR).

**Decision**:
1. Always store original `amountMinor` + `currency` together
2. Reports show per-currency totals by default
3. "All Converted" view is optional and must clearly show FX rates used

**Consequences**:
- No silent currency conversions that could mislead users
- UI must handle displaying amounts in multiple currencies
- FX rate management becomes a feature (manual or imported)
- Summary calculations more complex (can't just sum amounts)

**Implementation**:
```typescript
interface Transaction {
  amountMinor: number;  // Amount in cents/agorot
  currency: Currency;   // 'USD' | 'ILS' | 'EUR'
}

// Totals computed per-currency
interface OverviewTotalsByCurrency {
  USD: OverviewTotals;
  ILS: OverviewTotals;
  EUR: OverviewTotals;
}
```

---

## ADR-005: No Server Backend for MVP

**Status**: Active
**Date**: 2024-01
**Context**: Privacy-first approach, zero ongoing infrastructure costs.

**Decision**: The MVP is a pure SPA/PWA with no server backend. All data stored client-side.

**Consequences**:
- Zero server costs
- No authentication system needed
- No data recovery if user clears browser
- Must provide export/backup mechanism
- Multi-device sync requires P2P or file transfer

**Future Override Conditions**:
- If adding collaborative features (shared workspaces)
- If adding cloud backup as opt-in feature

---

## ADR-006: TanStack Query for Data Fetching

**Status**: Active
**Date**: 2024-02
**Context**: Need consistent data fetching, caching, and mutation patterns.

**Decision**: Use TanStack Query (React Query v5) for all data fetching from repositories.

**Consequences**:
- Automatic caching and deduplication
- Consistent loading/error states
- Optimistic updates for better UX
- DevTools for debugging
- Learning curve for team

**Configuration**:
```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,      // 1 minute
      retry: false,              // Offline-first, no retry
      refetchOnWindowFocus: true,
    },
  },
});
```

---

## ADR-007: Zustand for UI State

**Status**: Active
**Date**: 2024-02
**Context**: Need lightweight state management for UI concerns (drawers, toasts, demo mode).

**Decision**: Use Zustand for non-server UI state. TanStack Query handles server/repository state.

**Consequences**:
- Simple API, minimal boilerplate
- Easy to create multiple small stores
- No Redux-like complexity
- Clear separation: Zustand = UI, Query = Data

**Stores**:
- `useDrawerStore()` - Drawer open/close state
- `useDemoStore()` - Demo mode state
- `toastStore` - Toast notifications
- `useSyncStore()` - Sync connection state

---

## ADR-008: URL-Driven Drawer State

**Status**: Active
**Date**: 2024-02
**Context**: Drawers should be deep-linkable and support browser back/forward.

**Decision**: Drawer open state is driven by URL search params, not just component state.

**Consequences**:
- Deep links work (share link to edit a transaction)
- Browser back button closes drawer
- Requires careful URL manipulation
- Must coordinate with Zustand for complex cases

**Implementation**:
```typescript
// Open transaction drawer
navigate({ search: { tx: transactionId } });

// Close drawer
navigate({ search: {} });
```

---

## ADR-009: Amounts in Minor Units (Cents)

**Status**: Active
**Date**: 2024-02
**Context**: Floating-point arithmetic causes rounding errors in financial calculations.

**Decision**: Store all monetary amounts as integers in minor units (cents, agorot).

**Consequences**:
- No floating-point errors
- Must convert for display (`amountMinor / 100`)
- Must convert from input (`parseFloat(input) * 100`)
- Consistent across all entities

**Convention**:
```typescript
// Field naming
amountMinor: number;      // 1999 = $19.99
rateMinor: number;        // Per-unit price
subtotalMinor: number;    // Before tax
totalMinor: number;       // Final amount

// Display helper
formatAmount(1999, 'USD'); // → "$19.99"
```

---

## ADR-010: Receivable as Transaction Status

**Status**: Active
**Date**: 2024-02
**Context**: Need to track unpaid income without creating a separate entity.

**Decision**: A "receivable" is just a Transaction with `kind='income'` and `status='unpaid'`. No separate Receivable entity.

**Consequences**:
- Simpler data model
- Receivables computed from transactions
- "Mark as Paid" just updates status
- Overdue logic: `status='unpaid' && dueDate < today`
- **Amendment 2026-10 (ADR-022)**: "today" here means the user's **local
  calendar date**, not the UTC date. An item due today is NOT overdue. Use the
  helpers in `src/lib/dates.ts`; never reimplement this comparison inline.

**Queries**:
```typescript
// Get all receivables
const receivables = transactions.filter(
  tx => tx.kind === 'income' && tx.status === 'unpaid'
);

// Get overdue receivables
const overdue = receivables.filter(
  tx => tx.dueDate && tx.dueDate < today
);
```

---

## ADR-011: Hybrid Logical Clock for Sync

**Status**: Active
**Date**: 2024-06
**Context**: P2P sync requires ordering operations from different devices.

**Decision**: Use Hybrid Logical Clock (HLC) for operation ordering. Combines physical time with logical counter.

**Consequences**:
- Consistent ordering across devices
- Handles clock drift gracefully
- Can determine causality
- Must maintain HLC state locally

**Implementation**:
```typescript
interface HLC {
  ts: number;       // Physical timestamp (ms)
  counter: number;  // Logical counter
  nodeId: string;   // Device ID for tie-breaking
}
```

---

## ADR-012: Operation Log (CRDT-like) for Sync

**Status**: Active
**Date**: 2024-06
**Context**: Need to sync changes between devices without central server.

**Decision**: Maintain an append-only operation log. Operations are the unit of sync.

**Consequences**:
- Can reconstruct state from operations
- Conflict detection via HLC comparison
- Storage grows with operations (need compaction strategy)
- Supports offline-to-online scenarios

**Operation Types**:
- CRUD: `create`, `update`, `delete`
- Domain: `archive`, `mark_paid`
- Sync: `resolve_conflict`, `create_version`

---

## ADR-013: Local-Only Sync (LAN + File Bundle)

**Status**: Active
**Date**: 2024-06
**Context**: Must sync without cloud involvement for privacy.

**Decision**: Support two sync methods:
1. **WiFi (LAN)**: Direct device-to-device via mDNS discovery
2. **File Bundle**: Encrypted `.msync` files transferred manually

**Consequences**:
- No cloud infrastructure
- User controls when/how sync happens
- More complex UX than automatic cloud sync
- Must handle NAT, firewalls for LAN sync

**Security**:
- Device pairing requires physical presence
- Bundle files encrypted with user passphrase
- Ed25519 keys for device identity

---

## ADR-014: Document Immutability After Export

**Status**: Active
**Date**: 2024-08
**Context**: Exported documents (invoices) should not be editable for audit compliance.

**Decision**: Lock documents after first PDF export. Linked transactions also locked.

**Consequences**:
- Audit trail preserved
- Cannot "fix" mistakes on exported documents
- Must create credit notes for corrections
- User education needed

**Implementation**:
```typescript
// On first export
document.lockedAt = now();
document.exportCount += 1;

// Linked transactions
for (const txId of document.linkedTransactionIds) {
  transaction.lockedAt = now();
  transaction.lockedByDocumentId = document.id;
}
```

---

## ADR-015: Profile-Scoped Expenses

**Status**: Active
**Date**: 2024-09
**Context**: Users with multiple businesses need separate expense tracking.

**Decision**: Expenses belong to a BusinessProfile, not to the global app.

**Consequences**:
- Each profile has its own expense categories
- Expense reports scoped to profile
- More complex data model
- Enables multi-business accounting

---

## ADR-016: Tauri for Desktop Distribution

**Status**: Active
**Date**: 2024-03
**Context**: Need native desktop app for better UX and PDF archival.

**Decision**: Use Tauri 2.x for desktop builds (macOS, Windows).

**Alternatives Considered**:
- Electron: Too heavy (100MB+ bundle)
- Neutralino: Less mature
- Native (Swift/C#): Separate codebases

**Consequences**:
- Rust backend (small footprint)
- Same React frontend
- File system access for PDF archival
- Auto-updater via GitHub releases
- ~15MB bundle size

---

## ADR-017: React 19 with TypeScript Strict

**Status**: Active
**Date**: 2025-01
**Context**: Need modern React features and type safety.

**Decision**: Use React 19 with TypeScript in strict mode.

**Consequences**:
- Latest React features (hooks, concurrent mode)
- Full type safety catches bugs early
- Stricter code but higher quality
- Some third-party libs may lag behind

**tsconfig**:
```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

---

## ADR-018: CSS Variables for Theming

**Status**: Active
**Date**: 2024-03
**Updated**: 2026-02 (canonical token naming clarified)
**Context**: Need dark mode and potential custom themes.

**Decision**: Use CSS custom properties (variables) for all colors and spacing.

**Consequences**:
- Easy theme switching (just swap variables)
- No runtime JS for theming
- Can't use CSS-in-JS libraries easily
- Must maintain design tokens

**Canonical Token File**: `src/styles/theme.css`

This is the authoritative source for all design tokens. It includes:
- Light/dark mode via `prefers-color-scheme` media queries
- Manual override via `[data-theme]` selectors
- Full accessibility (WCAG AA contrast, focus rings, reduced motion)

**Canonical Token Naming** (use these, not legacy names):

| Category | Canonical Pattern | Legacy (Deprecated) |
|----------|------------------|---------------------|
| Typography | `--text-sm`, `--text-base`, `--text-lg` | `--font-size-sm`, `--font-size-base` |
| Weights | `--weight-normal`, `--weight-medium`, `--weight-semibold` | `--font-weight-normal`, `--font-weight-medium` |
| Colors | `--text`, `--muted`, `--accent`, `--surface` | `--color-text`, `--color-primary`, `--color-bg-elevated` |
| Spacing | `--space-1` through `--space-16` (rem) | Same names but px values in index.css |
| Shadows | `--shadow-1`, `--shadow-2`, `--shadow-3` | `--shadow-sm`, `--shadow-md`, `--shadow-lg` |
| Focus | `--focus-ring` (box-shadow) | `outline` approach |

**Note**: `src/index.css` contains legacy `--color-*` mappings for backwards compatibility.
New development MUST use canonical tokens from `theme.css`. See TECH_DEBT.md TD-011 for migration plan.

**Implementation**:
```css
/* Canonical tokens (theme.css) */
:root {
  --bg: #F6F8FA;
  --surface: #FFFFFF;
  --text: #0B1220;
  --accent: #1D8A84;
  --space-4: 1rem;  /* 16px */
  --text-base: 0.8125rem;  /* 13px */
  --weight-medium: 500;
}
```

---

## ADR-019: i18n with Context + Intl APIs

**Status**: Active
**Date**: 2024-04
**Context**: Support English and Arabic (RTL).

**Decision**: Use React Context for language state, Intl APIs for formatting.

**Consequences**:
- No heavy i18n library
- Type-safe translation keys
- RTL support via `dir` attribute
- Must maintain translation objects manually

**Implementation**:
```typescript
const { t, direction, formatCurrency, formatDate } = useLanguage();

// Usage
t('clients.title')               // → "Clients" or "العملاء"
formatCurrency(1999, 'USD')      // → "$19.99" or "١٩٫٩٩ $"
```

---

## ADR-020: Vitest for Testing

**Status**: Active
**Date**: 2024-05
**Context**: Need fast unit testing compatible with Vite.

**Decision**: Use Vitest for unit and integration tests.

**Alternatives Considered**:
- Jest: Slower, needs Vite adapter
- Cypress: Overkill for unit tests

**Consequences**:
- Fast execution (native Vite)
- Compatible with Testing Library
- Same config as Vite
- Less ecosystem than Jest (but growing)

---

## ADR-021: Question-First UX Redesign

**Status**: Active
**Date**: 2026-03
**Context**: The app evolved into an entity-first mini CRM (clients/projects/transactions/documents) but the core user need is simpler: fast answers about cash flow. Users need to know what they received, what's unpaid, and what they spent, not manage a pipeline or document system.

**Decision**: Transform the product from entity-first software to question-first financial UX.

**Key Changes**:
1. **New Navigation**: Home, Income, Expenses, Insights | Clients, Projects | Settings
2. **Renamed Routes**: Overview → Home, Transactions → Income, Reports/Money Answers → Insights
3. **Deprecated from UX**: Documents, Retainers, Engagements, standalone Reports page
4. **Mental Model**: Layer 1 = Money (income/expenses/unpaid), Layer 2 = Context (clients/projects), Layer 3 = Answers (home/insights)

**Consequences**:
- Sharper product identity: "cash flow tool" not "mini CRM"
- Faster user comprehension (question-first vs entity-first)
- Clients/Projects become supporting context, not primary navigation
- Documents feature preserved in code but hidden from nav (can reintroduce later)
- Existing drawer-first, URL-driven, offline-first architecture preserved

**Implementation**:
- Phase 1: Navigation and labeling cleanup
- Phase 2: Home, Income, Expenses page redesign
- Phase 3: Clients and Projects repositioning
- Phase 4: Insights consolidation

**Reference**: `docs/ux-redesign/UX-REDESIGN-SPEC.md`, `docs/ux-redesign/IMPLEMENTATION-PLAN.md`

---

## ADR-022: Local Calendar Date as the Basis for Overdue

**Status**: Active
**Date**: 2026-10
**Context**: ADR-010 defined overdue as `status='unpaid' && dueDate < today` but never defined "today". Five sites had each reimplemented the comparison, and three duplicate helpers derived "today" as `new Date().toISOString().split('T')[0]` — the **UTC** date. The result was contradictory numbers on the product's core question (MUT-17):

- `/income`'s Overdue tab badge counted items due today as overdue while the repository's `overdue` filter excluded them, so the badge said 1 and the list it opened showed 0.
- In Asia/Jerusalem between 00:00 and 03:00 local, "today" was yesterday, so genuinely overdue items were not reported.
- In America/New_York after ~20:00 local, "today" was tomorrow, so items due today were reported overdue.
- `getDaysUntil` parsed its argument as UTC midnight and compared against local midnight, returning a value one day off for every timezone west of UTC. Its tests passed only because the development machine was UTC+3.

**Decision**: All date-only logic lives in `src/lib/dates.ts`, with two invariants:

1. **"Today" is the user's local calendar date.** Derived from `getFullYear/getMonth/getDate`, never from `toISOString()`. `todayLocalISO()` is the only function in the codebase that reads the clock for this purpose.
2. **Day arithmetic goes through a `Date.UTC`-based day ordinal.** Subtracting local `Date` objects is unsafe across DST: a calendar day is 23 or 25 hours, so dividing milliseconds by 86,400,000 yields 0.958 or 1.042 and truncates to the wrong integer. Asia/Jerusalem observes DST, so this is a live concern.

Every predicate takes `today` as an explicit argument, which keeps it pure and timezone-independent.

**Consequences**:
- One definition of overdue; the badge can never disagree with the list.
- `isOverdueReceivable` and `isDueSoon` partition receivables, so Home's two lists cannot double-count or drop a row.
- New records get the user's actual date. The four drawers seed from `todayISO()`, so a Jerusalem user adding income at 01:00 previously got it dated yesterday.
- Tests must pin the timezone. `vitest.config.ts` sets `TZ` (default `Asia/Jerusalem`); `npm run test:tz` runs the suite west of UTC. Without this, date bugs are invisible on a UTC+n machine.

**Scope**: receivable date logic only. `toISOString()` remains correct for instants — HLC timestamps, sync bundles, backup filenames, `nowISO()`. Do not blanket-replace it.

**Not covered**: `ProjectedIncome` overdue in `retainerRepository.ts` and recurring-expense occurrence states are separate entities with their own semantics. Both still carry a private UTC-based `todayISO()` (`retainerRepository.ts:29`, `recurringExpenseService.ts:32`) — tracked as TD-014.

**Reference**: `src/lib/dates.ts`, `src/lib/__tests__/dates.test.ts`, MUT-17

---

## Superseded Decisions

*None yet. When a decision is replaced, move it here with override date and reason.*

---

## Decision Template

```markdown
## ADR-XXX: [Title]

**Status**: Active | Superseded | Deprecated
**Date**: YYYY-MM
**Context**: [Why this decision was needed]

**Decision**: [What was decided]

**Consequences**:
- [Positive and negative outcomes]
- [Trade-offs made]

**Alternatives Considered**:
- [Option 1]: [Why rejected]
- [Option 2]: [Why rejected]
```

---

## ADR-023: Reuse Malafat's OAuth 2.1 Server for Workspace Auth

**Status**: Active
**Date**: 2026-10
**Context**: MUT-28, under epic MUT-25. Connecting Mutaba3a to a Malafat
workspace needs authentication, and Mutaba3a has no account system. Malafat
already runs a per-tenant OAuth 2.1 authorization server (CIMD registration,
PKCE, rotating refresh tokens, user-revocable grants) built for MCP clients.

**Decision**: Mutaba3a authenticates as a public OAuth client of the tenant's
own subdomain. It builds no account system, no password storage, and no session
of its own. The tenant is the origin — Malafat resolves the firm from the
subdomain before any token lookup, so there is no tenant parameter.

Supporting choices, each with a test that pins it:
- PKCE S256 only. `plain` is not implemented, so a downgrade is unrepresentable.
- Loopback redirect on a pre-registered fixed port, because the server matches
  `redirect_uris` exactly and an ephemeral port fails closed.
- The authorize page opens in the system browser, never the webview — an
  embedded user-agent can read the user's Malafat session.
- State is compared in one place (TypeScript), not in both the Rust listener
  and the frontend.

**Consequences**:
- No auth subsystem to build, own or secure.
- Mutaba3a inherits Malafat's revocation semantics, including that a revoked
  grant must degrade to local-only without touching local data.
- Mutaba3a inherits Malafat's scope vocabulary, which has no money scopes yet;
  adding them is a Malafat product decision (MAL-870).
- A fixed-port redirect means a port collision is a user-visible failure, which
  is why four ports are registered rather than one.

**Alternatives Considered**:
- Own account system: months of work, and a second credential store holding
  privileged data. Rejected.
- Device-code flow: no consent-screen branding, worse UX on a machine that has
  a browser. Rejected.
- Embedded webview for authorize: forbidden by OAuth 2.1 BCP. Rejected.

**Does NOT supersede**: ADR-005 (No Server Backend) and ADR-013 (Local-Only
Sync) remain Active and in conflict with cloud sync. Overriding them is MUT-30's
job and must happen before any cloud sync ships. This ADR covers only how a
client authenticates when that work is approved.

---

## ADR-024: Override of ADR-005 — A Hosted Mutaba3a Service Exists Beside the Local-First App

**Status**: Active (partial override of ADR-005; ADR-013 unchanged)
**Date**: 2026-10-08
**Context**: MUT-30 required an explicit override before any cloud work
landed. The MUT/MAL Money v1 plan, confirmed by the product owner on
2026-10-08 after the repository audit (`.claude/designs/money-v1-repository-audit.md`),
chose MUT-25 **Option B**: a hosted, organization-scoped Mutaba3a financial
API that Malafat calls with an API key.

**What changes**: ADR-005's "no server backend" no longer describes the whole
product. A server-side service now exists in `server/` (own package, own
Postgres, own deploy). ADR-005's *reasoning* is preserved as a guarantee rather
than an architecture rule:

- **The desktop/PWA app is unchanged.** It stores nothing outside the device,
  sends no telemetry, and works with no network. Nothing in `src/` imports
  `server/`, and `server/` imports nothing from `src/` yet.
- **Local-only mode is a permanently supported mode**, not a transition state.
  A freelancer who never touches the hosted service loses nothing.
- **ADR-013 (local-only sync) stays Active.** The hosted service is not a sync
  target for the desktop in this decision. Making it one is a separate ADR,
  gated on MUT-27 (op-log transport) and TD-015 (durable tokens).
- **Firm data on the hosted service** is privileged client financial data and
  must be encrypted at rest, regionally resident beside the firm's CRM (GCP
  me-west1, matching Malafat), backed up, and deletable on request.

**What replaces it**: ADR-025 below.

**Why not the standing recommendation (Option A)**: the audit recommended A
(ledger inside Malafat's tenant schema). The product owner chose B so that
Mutaba3a remains the single owner of the financial domain and can serve
customers other than Malafat with the same API (plan rules MUT-1, MUT-2, G7).
The cost accepted with that choice: a second stateful service, its own
credential vault on the Malafat side, and duplicated encryption/residency
controls. Recorded so the trade is never re-litigated by accident.

---

## ADR-025: Hosted Financial API (Money v1 Option B)

**Status**: Active
**Date**: 2026-10-08
**Context**: MUT-32 "Decide the architecture". Plan sections 2, 10, 11, 13, 14.

**Decision**:

1. **Package** — `server/` is a standalone npm package (`@mutaba3a/api`),
   Node 22, TypeScript strict, Hono + `@hono/zod-openapi`, Prisma 6 on
   Postgres, pino. It has its own lockfile, lint, tests and Dockerfile. The
   root frontend toolchain ignores it (`eslint.config.js` globalIgnores).
2. **Tenancy** — every row belongs to an `Organization`; every request is
   authenticated by an organization-scoped API key and never carries an
   organization id as input. Cross-organization reads are impossible by
   construction, and the route tests assert it.
3. **Credentials** — `mut_<env>_<prefix8>_<secret43>`; the service stores
   `prefix` and `sha256(key)` only; lookup by unique prefix, constant-time hash
   compare; `live` and `test` keys are accepted only by the matching
   deployment; scopes are a closed, published, non-hierarchical vocabulary
   (`src/auth/scopes.ts`); revocation and expiry are checked on every request,
   uncached. Keys are issued by an operator through `/admin/v1/*` behind
   `MUTABA3A_ADMIN_TOKEN` until a Mutaba3a account system exists (TD-018).
4. **Contract** — OpenAPI 3.1 generated from the zod route definitions and
   committed at `server/openapi/openapi.yaml`; `npm run openapi:check` fails
   when code and spec drift (same discipline as Malafat ADR-033). Errors are
   always `{ error: { code, message, details?, requestId } }` with codes from
   `src/errors.ts`.
5. **Idempotency** — every state-changing POST requires `Idempotency-Key`;
   `(organization, key)` is unique; same fingerprint replays, different
   fingerprint is rejected, 5xx releases the key (plan §14.2).
6. **Money** — `bigint` minor units with a per-currency exponent internally,
   canonical decimal strings on the wire, no `number` ever holds an amount
   (`src/money.ts`). This is ADR-009 generalised; the desktop's `/100` stays
   as-is until it adopts the shared module.
7. **Storage port** — routes depend on `LedgerStore` (`src/repositories/ports.ts`);
   Prisma and in-memory implementations run the same contract test suite.
8. **Audit** — append-only `audit_events`; no update/delete path exists in
   application code.
9. **Deploy** — Cloud Run service + Cloud SQL + Secret Manager, migrations as
   a separate job (`prisma migrate deploy`), never at container start.
   Nothing in the repo deploys itself.

**Consequences**:
- Milestones M2–M6 of the plan add financial tables and routes to this
  service; none of them change the desktop app.
- Malafat stores the key encrypted per tenant and calls `/v1/*` server-side
  only (plan MAL-4).
- The in-process rate limiter is per instance (TD-017); a shared store is
  required before the service scales horizontally.

**Alternatives Considered**: Option A (ledger in Malafat's tenant schema,
shared money-core package) — recommended by the audit, rejected by the
product owner for ownership reasons (ADR-024). Option C (embed the web
build) — rejected in MUT-25 for design/RTL/session mismatch.

---

## ADR-026: Hosted API Deployment — Terraform Owns the Stack, One Local Script Rolls It

**Status**: Active (rev. 2, same day: production only, nothing runs in GCP that
can run on the operator's machine)
**Date**: 2026-10-08
**Context**: ADR-025 §9 named the topology (Cloud Run + Cloud SQL + Secret
Manager, migrations outside container start) but nothing in the repo could
produce it, and the runtime image could not even run migrations (Prisma CLI
pruned). Malafat's practice: Terraform modules exist but real deploys are
`gcloud run deploy` from `release.ts` with images **built locally and pushed**,
tenant migrations are **operator-run from a workstation through the proxy**, and
there is a documented history of hand-mounted secrets being wiped (MAL-388).
The product owner's direction for Mutaba3a: no staging for now, and no Cloud
Build, no migration job, nothing in GCP that the operator's machine can do.

**Decision**:

1. **Terraform owns every resource, including the running image tag.**
   `server/infrastructure/terraform/` declares Cloud SQL, secrets, the service
   account and its IAM, Artifact Registry, the service, the public invoker and
   the uptime check. `image_tag` is a variable; the service's `SERVICE_VERSION`
   is that tag. No `gcloud run deploy` outside Terraform, so nothing can be
   unmounted by a later apply.
2. **Production only.** `environment` defaults to `production` (`live` keys).
   The variable still accepts `staging` so an environment can be added later
   with its own tfvars and state prefix, but none exists and none is planned.
3. **Secrets are generated by Terraform** (`random_password`) and written as
   secret versions; they live in state and in Secret Manager only, never in
   tfvars or the repo. The operator reads the admin token with
   `gcloud secrets versions access`; `local_database_url` is a sensitive output
   for operator-side migrations and psql. Rotation is `-replace=` + redeploy.
4. **`scripts/deploy.sh` is the only rollout path and runs on the operator's
   machine**: `docker build --platform linux/amd64` with the local daemon,
   `docker push` to Artifact Registry, `prisma migrate deploy` from `server/`
   through the Cloud SQL Auth Proxy, `terraform apply -var image_tag`, smoke
   test. The migration runs before the service rolls; a failed migration
   leaves the old revision serving. No Cloud Build, no Cloud Run job.
5. **One image.** The Dockerfile has a single pruned runtime target; the
   Prisma CLI lives in the operator's `server/node_modules`, which is where
   migrations run. Migrations never run at container start.
6. **One instance** (`max_instances = 1`, Terraform validation) until TD-017
   replaces the in-process rate limiter. `min_instances = 1`.
7. **Public ingress, application auth.** Cloud Run IAM allows `allUsers`;
   every request is authenticated by the service (API key or admin token).
8. **Region `me-west1`**, same as Malafat (ADR-024 residency). The GCP project
   may be dedicated or Malafat's; names are prefixed so both work. Custom domain
   deferred (Cloud Run domain mapping is unavailable in `me-west1`).

**Consequences**:
- A deploy needs a workstation with Docker, `cloud-sql-proxy`, `terraform`,
  `gcloud` and node; CI (`server-ci.yml`) only validates (type-check, tests,
  image build, `terraform validate`) and never pushes.
- The operator's machine must build `linux/amd64`; on Apple Silicon that is
  Docker's cross-build, slower on the first run.
- Horizontal scaling is a code change (TD-017), not a tfvars change.
- The lock file is not committed from the authoring environment (it was
  generated from a filesystem mirror); the first operator `terraform init`
  creates it, and it should then be committed with hashes for both
  `linux_amd64` and the operators' platforms (`terraform providers lock`).

**Alternatives Considered**: Cloud Build + a Cloud Run migration job (rev. 1 of
this ADR, replaced the same day: two more GCP moving parts for work a laptop
does in minutes, and the owner wants the fewest cloud dependencies); gcloud-only
scripts like Malafat's `release.ts` (rejected: the REPLACE-semantics incidents
are exactly what a declarative owner prevents); a GitHub Actions deploy
workflow with Workload Identity (deferred: deploys stay operator-run and the
GitHub repo holds no GCP credentials); a tfvars admin token (rejected: a secret
in a tfvars file on a laptop is worse than one in a private, versioned state
bucket).


---

## ADR-027: Fee Proposals Live in the Hosted Ledger as a Single-Round Pre-Agreement State

**Date**: 2026-10-09
**Status**: Accepted (owner's answers to the M7 brief, 2026-10-09)

**Context**: Before a fee agreement exists a matter has no financial state in
Money v1: the firm's proposed amount, the client's approval and the figure
finally agreed were recorded nowhere. The owner wants Mutaba3a to hold that
negotiation so a matter reads "proposed → client approved → agreed", and the
agreed amount to flow into the agreement wizard.

**Decision**: A `FeeProposal` row per project in the hosted ledger (`server/`),
with five states — `PROPOSED`, `CLIENT_APPROVED` (agreed at the proposed
amount), `AGREED` (explicit final amount), `CONVERTED` (an agreement was
created from it, `POST /v1/agreements` with `feeProposalId`), `WITHDRAWN`
(firm withdrew or client declined). Single round: no offers table; the audit
trail is the history. One open proposal per project, serialised by the project
row lock. Agreeing posts nothing; converting is the wizard's job, and the
server marks `CONVERTED` only inside the agreement's transaction. Fixed fee
only; the existing `agreements:*` scopes are reused so no key is reissued.
Malafat renders the states and stores nothing (ADR-150 on its side).

**Consequences**: Four new verbs and one optional field on an existing route
(additive, `1.6.0-m7`). A counter-offer is recorded by `agree`; an amended
typo is withdraw + re-propose. Retainer proposals, an amend route and
proposals that convert into supplements are listed follow-ups, each additive.

**Alternatives Considered**: Multi-round offers with counter rows (rejected by
the owner: roughly double the UI for a record the audit trail already keeps);
auto-creating a one-installment agreement on agree (rejected: posts a
receivable the moment the figure is agreed, before VAT and installments are
chosen); storing the proposal on the Malafat matter (rejected: ADR-150 keeps
every financial record in Mutaba3a, and the owner asked for Mutaba3a to hold
it); a partial unique index for "one open per project" (rejected: Prisma
cannot declare it, so the schema and the migration would drift).

---

## ADR-027: Fee Approval Creates the Agreement (Override of M7 Brief Decisions 2 and 3)

**Status**: Active
**Date**: 2026-10-10
**Context**: M7 recorded the negotiation (`PROPOSED → CLIENT_APPROVED | AGREED
→ CONVERTED`) but produced no debt until the Partner ran the agreement wizard,
so "the client said yes, record their payment" was two screens away. The owner's
rule (design review 2026-10-10, D4/D5): *proposed means open; client approval is
the client's liability to pay.* Malafat's Money overview needed a "Proposed"
figure that could only mean money not yet approved.

**Decision**:
1. Three states: `PROPOSED → APPROVED | WITHDRAWN`. Approval creates the
   fixed-fee agreement in the same store transaction, dated `approvedOn`
   (D18); the dialog chooses one payment or monthly installments (D5).
2. Posting follows the M3 convention (D15 B): the first installment posts at
   approval, later ones on their dates through the lazy path. Owed grows as
   installments fall due.
3. The agreement-creation path is one helper, `agreements/create.ts`, shared
   by `POST /v1/agreements` and the approve route (D14); the store's atomic
   "create + transition proposal" from M7 is reused with the new statuses.
4. `listUnpostedDue` also heals unposted IMMEDIATE installments (D16); archive
   is refused while a proposal is open (D19); the organization summary carries
   each customer's open proposals and their total so Malafat renders both from
   one call (D17, ADR-150 on the Malafat side).
5. Nothing from M1–M7 was deployed, so the M7 migration was edited in place
   (D20) instead of adding a mapping migration.

**Replaces**: M7 brief decisions 2 ("approval is a state, not a copy of agree")
and 3 ("converting is the wizard's job"). The wizard remains for agreements
without a proposal.

**Alternatives Considered**: posting every installment at approval (rejected
by the owner: Owed would jump by the whole fee on approval day); a second
request for the overview's proposal pills (rejected: two sources for one
figure and a partial-failure state to build); posting inside the create
transaction instead of healing (deferred: larger change to tested M3 code for a
window the catch-up closes within a day); auto-withdrawing proposals on archive
(rejected: a side effect nobody asked for).

---

## ADR-028: Removing a Feature's UI Never Removes Its Tables

**Date**: 2026-10-10
**Status**: Accepted
**Context**: MUT-10, MUT-11 (epic MUT-2)

**Context**: Epic MUT-2 deletes product surface that no navigation entry
reaches. Two of those modules had touched storage very differently. Engagements
owned real Dexie tables (`engagements`, `engagementVersions`) that a user could
in principle hold rows in — the routes existed, only the nav entry was missing.
Money answers owned none: its `MoneyEvent` records are derived from
transactions, expenses and projected income on every read, and the repository
never writes.

**Decision**: Deleting a feature's UI is a source-code change only. It never
drops a Dexie table, never regresses or bumps the schema version, and never
rewrites a row.

1. Tables whose UI is gone are **retained**, with their row types relocated to
   `src/db/retained/`. The module carries a comment saying why it exists and
   that nothing interprets the rows any more; shapes that no longer have a
   consumer to keep them honest (the engagement version snapshot) are modelled
   as opaque JSON rather than a stale copy of the old form.
2. The export obligation is already met by `src/db/backup.ts`, which serializes
   every table in `db.tables` generically and is reachable from Settings → Data
   tools. Retaining the table is therefore sufficient; a per-feature export path
   is not needed. Dropping the table is what would break the backup.
3. A test guards the retention. `src/db/__tests__/retainedSchema.test.ts` fails
   if the tables leave the schema or stop round-tripping through backup and
   restore, so the guarantee survives the next person who reads `engagements`
   as dead weight.
4. Shared code is identified before deletion, not after. `moneyEventRepository`
   stayed because the Overview page's KPI strip, actuals row and attention feed
   depend on it; what was removed instead was the deleted page's *name* from the
   shared surface, so nothing is called after a screen that no longer exists.

**Consequences**: A removal leaves a small, inert, tested residue in `src/db/`
rather than a clean grep. That residue is the point: the acceptance criterion
"no hits outside deliberately retained schema definitions" is satisfied by the
carve-out, not in spite of it. The cost of a stale table is a few hundred bytes
per install; the cost of a dropped one is unrecoverable user data.

**Alternatives Considered**: dropping the tables with a schema bump (rejected —
irreversible for anyone holding rows, and the removal's whole value is
maintenance cost, not storage); shipping a bespoke engagement export before
deleting (rejected once the generic backup was found to cover every table
already); keeping the full 200-line engagement type to describe retained rows
faithfully (rejected — no consumer left to keep it accurate, so it would rot
into a lie); deleting `moneyEventRepository` with the page (rejected — three
mounted Overview components import it).
