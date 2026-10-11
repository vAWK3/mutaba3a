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
| ADR-021 | Question-First UX Redesign | Active; §1 (navigation) superseded by ADR-034 | 2026-03 |
| ADR-022 | Local Calendar Date as the Basis for Overdue | Active | 2026-10 |
| ADR-023 | Reuse Malafat's OAuth 2.1 Server for Workspace Auth (account clause overridden for the hosted service by ADR-037) | Active | 2026-10 |
| ADR-024 | Override of ADR-005: A Hosted Mutaba3a Service Exists Beside the Local-First App | Active | 2026-10 |
| ADR-025 | Hosted Financial API (Money v1 Option B): Organization-Scoped Ledger Service, Malafat as API-Key Client | Active | 2026-10 |
| ADR-026 | Hosted API Deployment: Terraform Owns the Stack Including the Image Tag, One Local Script Rolls It (Local Build, Local Migrations), One Instance Until TD-017 | Active | 2026-10 |
| ADR-027 | Fee Approval Creates the Agreement (Override of M7 Brief Decisions 2 and 3) | Active | 2026-10 |
| ADR-028 | Attachments Are Download-Only for the Pilot; No Malware Scanner Gates It | Active | 2026-10 |
| ADR-029 | Removing a Feature's UI Never Removes Its Tables | Active | 2026-10 |
| ADR-030 | Overpayment Is Rejected; Locked Transactions Still Accept Payments | Active | 2026-10 |
| ADR-031 | The Updater Signing Key BEDF931CA1D6C777 Is Canonical; a Rotation Ships the New Public Key Before Signing Switches | Active | 2026-10 |
| ADR-032 | Optional Areas Are Per-Feature Switches on Settings, Off by Default, Auto-Enabled Only by Data | Active | 2026-10 |
| ADR-033 | Owed Now Has One Definition; a Client's Payment History Is Reconciled on Read | Active | 2026-10 |
| ADR-034 | The Sidebar Is a Fixed Core of Home, Clients, Income; Optional Areas Append Below; Switching an Area Off Re-Runs the Route Guards (Override of ADR-021 §1) | Active | 2026-10 |
| ADR-035 | Lists May Be Ordered Across Currencies by Today's Rate; Amounts Are Never Shown Converted | Active | 2026-10 |
| ADR-036 | Home Answers Who Owes Me: Owed Now, Needs Attention, Recent Payments; the Forecast Strip Is Deleted | Active | 2026-10 |
| ADR-037 | Hosted Users and Sessions: A Human Principal Beside API Keys, a Hosted-Only Portal Build, One Enforced Writability Matrix (Extends ADR-025; Partial Override of ADR-023) | Active | 2026-10 |

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

**Status**: Active; Key Change 1 (navigation) and the consequence "Clients/Projects become supporting context, not primary navigation" are superseded by ADR-034 (2026-10-11)
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

> **Override note (2026-10-11, ADR-037).** The clause "builds no account
> system, no password storage, and no session of its own" no longer describes
> the hosted service: ADR-037 gives `server/` operator-provisioned users,
> argon2id password hashes and server-side sessions for the hosted portal.
> The rest of this ADR stands — it still governs how the *desktop* app
> authenticates to a Malafat tenant (MUT-28), and no part of ADR-037 touches
> the desktop.

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

## ADR-027: Fee Approval Creates the Agreement (Override of M7 Brief Decisions 2 and 3)

**Status**: Active
**Date**: 2026-10-10 (original record 2026-10-09)
**Note (2026-10-10, MUT-49)**: this file briefly carried two `## ADR-027`
headings. The 2026-10-09 record and its 2026-10-10 override are now one ADR
with two dated sections; ADR-028 and ADR-029 keep their numbers.

### Original record (2026-10-09): Fee Proposals Live in the Hosted Ledger as a Single-Round Pre-Agreement State

Accepted on 2026-10-09 from the owner's answers to the M7 brief; amended by
the override below.

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

### Override (2026-10-10): Fee Approval Creates the Agreement

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

## ADR-028: Attachments Are Download-Only for the Pilot; No Malware Scanner Gates It

**Status**: Active
**Date**: 2026-10-10
**Context**: M6 decision 4 (`.claude/designs/money-v1-m6-summaries-audit-attachments.md`
§5) shipped attachments without a malware scanner because none exists in this
stack, and the handover (§4) left one question to the owner: does the missing
scanner gate the pilot?

**Decision**: No. The pilot runs with attachments as shipped:

1. `POST /v1/attachments/{id}/complete` verifies the object's size and content
   type against what the upload declared; `READY` means "verified size and
   type", not "scanned". The contract's "scanned before READY" wording is
   aspirational until a scanner exists.
2. Malafat offers **download only** (302 to a short-lived signed URL), never
   inline rendering, so a hostile file is never executed in the firm's browser
   by the CRM. Signed URLs expire within `ATTACHMENTS_URL_TTL_SECONDS`.
3. Uploads are Partner-only (ADR-150 decision 3 on the Malafat side, reaffirmed
   2026-10-10): the uploader is the firm's own owner attaching their own
   invoices and receipts, not an untrusted party.
4. The scanner pipeline (Cloud Storage → object-finalize event → scan → status
   on the attachment row, with a `QUARANTINED` outcome the UI must render) is a
   **post-pilot follow-up**, to be ticketed before general availability. Until
   then no code path may add inline rendering or a preview.

**Alternatives Considered**: gate the pilot on a scanner (rejected: weeks of
infrastructure for a pilot whose only uploaders are the firm's Partners); drop
attachments from the pilot (rejected: documents on payments were a stated pilot
runbook item); client-side scanning in the browser (rejected: no trustworthy
option, and it protects the wrong party).

**Consequences**: handover §4 item closed; TEST_PLAN "Still manual" documents
items stay as written; a follow-up ticket for the scanner is owed on MUT-25 /
MAL-939 before GA.

---

## ADR-029: Removing a Feature's UI Never Removes Its Tables

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


**Addendum 2026-10-10 — MUT-14: user *files* get an export before their UI goes.**
§2 rejected a bespoke export because the generic backup covers every table.
That holds for rows. It does not hold for user-uploaded files stored as
base64 in a row (`receipts.data`): a JSON backup is not a usable way to get
one's receipts back. Rule: when a removed UI was the only way to *view or
download* user files, ship a plain file export first (MUT-14: Settings › Data
tools › Export receipts, one ZIP with `<profile>/<month>/<file>`), then delete.
Rows still stay (ADR-029 §1): `monthCloseStatuses` keeps its retained schema in
`src/db/retained/monthCloseSchema.ts` with a retention test, like engagements.

---

## ADR-030: Overpayment Is Rejected; Locked Transactions Still Accept Payments

**Date**: 2026-10-10
**Status**: Accepted
**Context**: MUT-6 (epic MUT-1)

**Context**: MUT-6 promotes "Record payment" from a kebab entry to the most
clicked button in the product, and its acceptance criteria require deciding and
documenting two behaviours that the code had never decided on purpose.

1. **Overpayment.** `paymentRecordRepo.create` validated a positive amount, an
   existing transaction and `kind === 'income'` -- nothing else. A payment
   larger than the balance was stored, and `recalculateReceivedAmount` clamps
   `remainingAmountMinor` with `Math.max(0, ...)` and marks paid on
   `sum >= amountMinor`, so the excess existed in the database with no surface
   able to show it.
2. **Locked transactions.** Payments on a `lockedAt` transaction succeeded, but
   only by accident: `recalculateReceivedAmount` writes `db.transactions.update`
   directly and never reaches `transactionRepo.update`'s lock guard
   (`repository.ts:349`). No test covered it.

**Decision**:

1. **Overpayment is rejected.** `sum(other non-deleted records) + newAmount >
   tx.amountMinor` throws `PaymentRecordError`. The data model has no credit or
   refund concept, so storing an excess can only be wrong or invisible, and it
   was both. The guard lives once, in `paymentRecordRepo.create` and `.update`,
   so `transactionRepo.recordPartialPayment` inherits it through its delegation
   (`repository.ts:417`) rather than carrying a second copy. The sum is read
   **inside** the existing `db.transaction('rw', ...)` block, or two concurrent
   creates would both read the same pre-state and both pass. The message starts
   with `Payment amount` so `getErrorMessage`
   (`useMutationWithFeedback.ts:85`) routes it to the user verbatim; the drawer
   checks the same rule first to show a translated inline message.
2. **Locked transactions accept payments.** `lockedAt` exists for ADR-014
   document immutability and protects the *invoice facts* -- amount, currency,
   client, date. `receivedAmountMinor` / `status` / `paidAt` are payment
   tracking, and an invoiced receivable being paid is the normal flow.
   `transactionRepo.update`'s allowlist stays `['archivedAt']`: widening it
   would relax the lock for every caller, including the generic edit drawer,
   which is exactly what ADR-014 exists to prevent. Instead
   `recalculateReceivedAmount` is named in a comment as the sanctioned
   payment-side writer, and a test asserts a payment on a locked transaction
   succeeds and flips status to `paid`.

**Override log**: this reverses previously documented behaviour. Overpayment
was allowed and clamped, and two passing tests said so on purpose --
`paymentRecords.test.ts` `describe('overpayment')` ("should allow overpayment
and still mark as paid") and `partialPayment.test.ts` ("should mark as paid
when payment exceeds remaining amount"). Both are rewritten to assert
rejection, dated 2026-10-10, under MUT-6.

**Consequences**: A user who types more than the balance is stopped rather than
silently storing an unrepresentable number. Any future genuine overpayment or
refund needs a data model that does not exist yet -- it is not a tweak to this
guard. Legacy rows whose `receivedAmountMinor` already exceeds `amountMinor`
(the `migratedNote` imports) are untouched: their remaining is 0, so the button
is hidden and no new record can be added to them.

**Alternatives Considered**: allowing overpayment and showing the excess
(rejected -- it needs new UI on the row and in the drawer for a case that is
almost always a typo, and still has nowhere honest to put the money); guarding
only the drawer's path and leaving `recordPartialPayment` permissive (rejected
-- one rule, one place; a bypass flag is how the two paths drift); blocking
payments on locked transactions (rejected -- it would make every invoiced
receivable unpayable, which is the opposite of the lock's purpose).

---

## ADR-031: The Updater Signing Key BEDF931CA1D6C777 Is Canonical; a Rotation Ships the New Public Key Before Signing Switches

**Status**: Active
**Date**: 2026-10-10
**Context**: MUT-49 (epic MUT-48). On 2026-10-05 commit `ae9fb1c` changed
`plugins.updater.pubkey` in `src-tauri/tauri.conf.json` to minisign key
`AB7B64537B1DE22C`, with a message saying the config was catching up to the
key in use. The evidence says otherwise. Every signer that has ever produced
a published artifact is `BEDF931CA1D6C777`: the signatures in the published
v0.0.63 `latest.json` (both `darwin-aarch64` and `windows-x86_64`), the key
the operator-run macOS release signs with, and the GitHub Actions secret
`TAURI_SIGNING_PRIVATE_KEY` (set 2026-04-17, before v0.0.63). The `AB7B`
private key never signed a published release and is not configured anywhere
the pipeline signs from (full audit on MUT-49). Had v0.0.64 shipped with the
`AB7B` public key while both signers kept using `BEDF`, no later release
could have been verified by that build.

**Decision**:
1. `BEDF931CA1D6C777` is the canonical updater signing key. The public key
   compiled into the app, the macOS release signer and the CI secret are the
   same pair. The config is restored to the pre-`ae9fb1c` value.
2. `src/lib/__tests__/updater-config.test.ts` pins the configured public key
   to that value and asserts the key id from the key bytes (line 2, bytes
   2..10), not from the "untrusted comment" line. It is friction against an
   accidental edit, not proof that artifacts were signed with it; the
   signer-vs-config check runs in shell at release time (MUT-51).
3. A real rotation, if one is ever needed (a compromised private key), has a
   fixed order: generate the new pair; store the private half in both
   `release.env` and the CI secret; ship one transitional release that is
   **signed with the old key** and **embeds the new public key**; only then
   switch signing to the new key. The transitional release is necessary, not
   sufficient: Tauri verifies against one compiled-in key, so any client that
   skips the transitional release (offline, or simply late) is stranded once
   signing switches. A rotation therefore also needs either a long window
   with no further releases, or an explicit decision that laggards reinstall.
4. Exactly one private key is kept for signing, in the operator's release
   configuration and in the CI secret; any stale key material is removed
   (tracked on MUT-49) and the release-time check in MUT-51 proves the
   signer matches the compiled-in key.

**Consequences**:
- The revert is backward-compatible: `ae9fb1c` is not an ancestor of
  `v0.0.63`, and the tag's `tauri.conf.json` decodes to `BEDF931CA1D6C777`,
  so no shipped build embeds `AB7B...`.
- The 2026-10-05 CHANGELOG entry is annotated as withdrawn; its claim that
  installed clients must reinstall no longer applies.
- `deploy.sh` still only warns when the signing key is not configured; MUT-51
  makes it a hard requirement and adds the signer-vs-config check (TD-022).

**Alternatives Considered**:
- Keep `AB7B...` and switch the signers to it: rejected. Every installed
  client (v0.0.63 and earlier) trusts `BEDF`, the CI secret is `BEDF`, and
  nothing justified a rotation; it would have required the transitional
  release in decision 3 for no benefit.
- Treat the mismatch as a rotation and ask all users to reinstall: rejected;
  it is what the 2026-10-05 note proposed, and it trades a one-line revert
  for every user losing in-app updates once.

---

## ADR-032: Optional Areas Are Per-Feature Switches on Settings, Off by Default, Auto-Enabled Only by Data

**Status**: Active
**Date**: 2026-10-10
**Context**: MUT-12 (epic MUT-2). The 2026-10-05 intake kept invoices,
retainers, expenses, insights, planning and projects as *optional*; the
gating stories (MUT-13/14/15/16) need one switchboard. Brief:
`.claude/designs/mut-12-advanced-features-toggle.md` (eng-reviewed, outside
voice folded in).

**Decision**:
1. **One typed map on the settings row.** `Settings.features?: Partial<Record<FeatureKey, boolean>>`,
   keys `invoices | retainers | expenses | insights | planning | projects`
   (`src/lib/features/features.ts` `FEATURE_KEYS`). Optional on the row so
   pre-v20 rows and imported backups resolve; `settingsRepo.get()` returns a
   `ResolvedSettings` with every key present. Adding or removing an area is
   one key plus its probe and i18n strings.
2. **Off by default. Data, and only data, switches an area on by itself.**
   The Dexie v20 upgrade and `reconcileFeaturesWithData()` turn on every area
   that has user rows (archived rows count; soft-deleted do not; insights owns
   no data and is never auto-enabled). Nothing ever turns an area *off*
   automatically. The reconcile runs on upgrade, after backup restore, data
   import, demo seeding and sync-bundle import, because each of those rewrites
   or adds rows after the upgrade has already run.
3. **The user is told once, by a dismissible banner, not a toast.** The
   auto-enabled keys are stored in `Settings.featureNotice`; `FeatureNoticeBanner`
   in `AppShell` shows them with a link to Settings and clears the notice only
   on explicit dismiss. (The brief's first cut was a toast; the outside review
   pointed out a 3-second toast on the first launch after an upgrade, beside
   the welcome and migration modals, is "told" only technically.)
4. **Two read paths, one resolver.** Components read `useFeatureEnabled(key)` /
   `useFeatureFlags()` (TanStack cache); router `beforeLoad` guards read
   `readFeatureFlags()` straight from the repository. Nobody reads
   `settings.features` directly. Every path that writes features outside the
   hook must invalidate `['settings']` or reload.
5. **Suppliers is not a separate area.** Vendors are the expenses module's
   table (`Expense.vendorId`), so `vendors` rows switch *expenses* on and the
   ticket's seventh toggle is folded into expenses. MUT-14 deletes the
   `/suppliers` view; MUT-16's "gate suppliers" item is satisfied by the
   expenses toggle.
6. **An auto-enable can never brick the app.** The v20 upgrade body is
   try/caught (log and continue): there is no pre-migration backup
   (`checkAndPrepareForMigration` backs up after Dexie opens), so a throwing
   upgrade would fail every launch with no recovery UI.

**Alternatives Considered**: seven loose booleans (rejected by the ticket);
a `localStorage` "told" flag (rejected: the notice is a consequence of a data
event and must survive devices and restarts with the data); auto-enabling in
`initDatabase()` on every start (rejected: would re-enable an area the user
turned off; the upgrade + explicit reconcile points are enabling-only *at the
moment data arrives*); a separate `suppliers` key as the ticket listed
(rejected, decision 5).

**Addendum 2026-10-10 — MUT-13 gating pattern.** The first gated areas
(invoices/documents, retainers) fixed the pattern every later gate follows:
`requireFeature(key)` on the route (redirect home before the lazy chunk
loads), an entry in `SidebarNav`'s `optionalItems` (the "More" section),
and `useFeatureEnabled` at every entry point on other pages. Repository
guards never read a flag: a document lock holds whether invoices is on or
off (and, since MUT-13, for delete as well as update; payments stay allowed),
and the drawer only changes how it *explains* the lock. Items whose only
action deep-links into a gated area (home attention retainer items) are
removed while the area is off rather than left to bounce. The sidebar's final
grouping stays MUT-15's decision; MUT-16 appends to the same section.

**Addendum 2026-10-10 — MUT-14: expenses gated; recorded money stays visible.**
Expenses became the second gated area: `/expenses` behind `requireFeature`,
eight legacy expense paths redirect to it, Expenses in the sidebar's "More"
section. Decision taken here for every area: **expenses already recorded stay
visible on Home, client and project pages while the switch is off** (they are
real money; hiding them would misstate totals); only *create* entry points
(`+ Add`, the top bar menu, duplicate-as-expense) follow the switch, and edit
paths from existing rows stay open. Pruning rule after the first collapse:
remove code with zero surviving references **and** no feature whose only entry
point was on a deleted page — the category seeder was such a feature and was
restored; the receipt-upload chain was the reverse case and was removed.

**Addendum 2026-10-10 — MUT-16: insights, planning and projects gated; the
three project collisions resolved.** The last three areas follow the MUT-13
pattern unchanged (route guard, "More" entry, flag-aware entry points). Two
decisions taken here apply to every optional *field* and *flow*, not just
pages: (1) **the switch never clears a hidden field's data** — the income,
expense and retainer drawers stop rendering the project group while projects
is off but keep the form value, so an edit round-trips `projectId` untouched;
form rules that apply when the field is visible (the client→project cascade)
still apply when it is hidden, because they are about the data, not the
area; (2) **onboarding
adapts in the overlay, not the store** — `OnboardingOverlay` completes the
project step with no entity while projects is off, leaving the store's
`client → project → income` order and completion rule alone (no persisted
state migration; a user who turns projects on later has a completed step).
A component that *acts* on an area being off, rather than merely hiding an
entry, waits for `useFeaturesLoaded()`: the flags read `false` while the
settings row loads, and acting on that would misfire for exactly the users
the v20 probe switches an area on for. The client profile's Projects tab is removed while off because its only
actions are deep links into the gated area and project creation (the MUT-13
rule); work-list project names are text and stay. `/reports` and
`/transactions` stay unconditional redirects: a chain of redirects is still
one render-free hop.

**Consequences**: MUT-13/16 gate routes with `readFeatureFlags()` and sidebar
entries with `useFeatureEnabled`; MUT-15 reads `useFeatureFlags()` for the
secondary nav group and the `+ Add` menu. Projects off by default collides
with onboarding (client → project → income), the `+ Add → Project` entry and
the income drawer's project field; those become flag-aware in MUT-15/16 (see
brief §12). `clearDatabase()` clearing only five tables is pre-existing debt
the reconcile now makes visible (TD-023).

---

## ADR-033: Owed Now Has One Definition; a Client's Payment History Is Reconciled on Read

**Status**: Active
**Date**: 2026-10-11
**Context**: MUT-3 (epic MUT-1), which also delivers the MUT-4 Payments UI.
Brief: `.claude/designs/mut-3-client-profile.md` (approved by Basel
2026-10-11). The client profile answers "how much do they owe me?" and "when
did they pay, and for what?". The audit found both answers wrong before any
UI work: the old header's per-currency figures were always zero
(`clientSummaryRepo.get` never returns them) and converted everything to one
ILS sum, and `paymentRecordRepo.listByClient` omitted every income saved as
**Received** in the income drawer, which writes `status: 'paid'` and
`receivedAmountMinor` but no `PaymentRecord`.

**Decision**:
1. **Owed Now is `summarizeOwedByCurrency(transactions, today)`**
   (`src/db/aggregations.ts`): the remaining balance (`amount − received`,
   clamped at 0) of every unpaid, non-deleted, **non-archived** income, one
   entry per currency with a non-zero balance, in fixed USD → ILS → EUR order,
   with the overdue part split out by `isOverdueReceivable` (ADR-010 /
   ADR-022). Currencies are never combined. The client profile, the clients
   index (MUT-7) and home (MUT-8) use this one helper.
2. **Archived income does not count toward Owed Now**, because the lists
   beneath the figure hide archived rows and a hero number must add up to what
   is listed. `clientSummaryRepo` and the overview totals still count archived
   rows; aligning them is TD-030, for MUT-7/MUT-8.
3. **`listByClient` returns payments, not just payment records**: every
   non-deleted `PaymentRecord` of the client's live income, plus one row per
   income whose effective received amount (`amount` when paid, else
   `receivedAmountMinor`) exceeds what its records cover. That row carries
   the uncovered amount, is dated `paidAt ?? occurredAt`, has id
   `entry:<transactionId>` and `source: 'entry'`; record rows carry
   `source: 'record'`. No Dexie version bump, no migration.
4. **A payment row opens what owns it**: a record opens the payment drawer in
   edit mode (`editPaymentRecord`, which also offers delete); an entry row
   opens the income entry.
5. **Any income or transaction write invalidates the payment lists**
   (`invalidatePaymentRecordLists`, in `useQueries.ts` beside the keys it
   owns), because Mark paid writes a record and a retitled, re-dated or deleted
   entry changes its rows.

**Consequences**: Question 3 includes the most common way people log a paid
job, for every write path past and future, with no data rewrite. The cost is
that "payments" and "payment records" differ: code that needs only records
(the payment drawer's history) keeps `listByTransaction`. The write-side fix
(record a payment when income is saved as Received, plus a backfill) is
TD-029; once it lands, entry rows simply stop appearing and this read path
needs no change.

**Alternatives Considered**: writing a `PaymentRecord` on create-as-received
plus a v21 backfill (rejected for this ticket — it touches the income drawer's
save path, MUT-5's area, and its received→invoiced edit path clears
`receivedAmountMinor` while records would survive, so it needs its own
design); showing records only, as MUT-4 specified literally (rejected —
silently wrong for question 3); fixing `clientSummaryRepo.get` to return
per-currency fields for the hero (rejected — no overdue split, and it counts
archived rows the page hides).

---

## ADR-034: The Sidebar Is a Fixed Core of Home, Clients, Income; Optional Areas Append Below; Switching an Area Off Re-Runs the Route Guards (Override of ADR-021 §1)

**Status**: Active
**Date**: 2026-10-11
**Context**: MUT-15, the last ticket of epic MUT-2. MUT-13/14/16 had already moved
every optional area into a conditional "More" section, leaving the core as
Home, Income | Clients under two headers. The 2026-10-05 intake made Clients
the primary workspace (the product answers three questions per client) and
Projects an optional tag. ADR-021 §1 still fixed the navigation as "Home,
Income, Expenses, Insights | Clients, Projects | Settings" with Clients and
Projects as "supporting context". Brief:
`.claude/designs/mut-15-sidebar-core-four.md` (owner-approved, D1–D5).

**Override log**: replaces ADR-021 Key Change 1 and its consequence "Clients/
Projects become supporting context, not primary navigation". Why: the intake
re-centred the product on clients; what replaces it: decision 1 below. The
rest of ADR-021 (the renames, the question-first framing, deprecations) stands.

**Decision**:
1. **The core is a constant.** `SidebarNav` renders Home, Clients, Income first,
   in that order, in one group with **no header**, and nothing about it
   depends on a flag. Optional areas render below it in "More" (only while at
   least one is on, order Expenses, Documents, Retainers, Insights, Planning,
   Projects); Settings stays pinned in the footer and is never gated. Because
   flags read `false` while settings load and optional rows only ever appear
   below the core, toggling or loading cannot move a core entry.
2. **Both `+ Add` menus share one action list.** `visibleAddMenuActions(flags)`
   (`components/layout/addMenuActions.ts`) decides what the sidebar **New**
   menu and the top bar **Add** menu offer and in which order: Income, Client,
   then Expense (expenses on) and Project (projects on). Same rule as the nav:
   core first, optional appended. Each menu keeps its own labels and click
   behaviour (TD-032 records that they differ).
3. **Switching an area off re-runs the route guards.** `useLeaveDisabledArea()`
   (in `AppShell`) calls `router.invalidate()` on any on→off transition after
   the first load; the open route's `requireFeature` gate then redirects home
   with `replace`, exactly as a deep link to a disabled area does (ADR-032 §4).
   There is no second route-to-area table. Switching on, the first load, and
   unrelated settings writes leave the router alone. No toast.
4. **Menu buttons follow the WAI-ARIA menu-button pattern** through one hook,
   `useMenuButton` (focus the first item on open, arrows/Home/End, Escape
   returns focus, Tab and outside clicks close).

**Alternatives Considered**: keeping a "Main" header over the core (rejected,
D1: a header over the only core group labels nothing); a route-prefix → area
table in the sidebar that navigates by itself (rejected, D3: a second source
of truth beside the router guards); only re-ordering each menu (rejected, D2:
leaves the gating duplicated); keeping both menus' keyboard handling as it
was (rejected, D5: the sidebar menu declared `role="menu"` and ignored arrows).

**Consequences**: a fresh install shows exactly Home, Clients, Income, Settings.
A gated page left open in a second window lands on Home when that window's
settings query refetches. `docs/ux-redesign/UX-REDESIGN-SPEC.md` §4 is
historical. The collapsed rail's toggles are in normal flow (they were
absolutely positioned without a containing block and floated at the window's
edges). Onboarding's indicator lists only the steps the user walks (TD-027).

---

## ADR-035: Lists May Be Ordered Across Currencies by Today's Rate; Amounts Are Never Shown Converted

**Status**: Active
**Date**: 2026-10-11
**Context**: MUT-7 (epic MUT-1). The clients index's default order is "owed
now, descending", and clients owe in different currencies. A client owing
$5,000 cannot be ranked against one owing ₪12,000 without either a conversion
or an arbitrary rule. The old comparator added raw minor units across USD, ILS
and EUR, which is wrong on both counts. ADR-004 forbids *silent* conversions
"that could mislead users". Basel chose this option over "main currency first"
and "rank by lateness" (brief `.claude/designs/mut-7-clients-who-owes-me.md`
§5, 2026-10-11).

**Decision**:
1. **A list may be *ordered* by an amount converted at today's rate**, using
   the same `useFxRate` rates `AmountWithConversion` already uses for its
   tooltips. No converted figure is displayed. Every amount on screen stays in
   its own currency, one line per currency.
2. **The ordering is disclosed**: the column header's tooltip reads "Ordered
   by today's exchange rate. Amounts are never converted."
3. **No rate, no guess.** The rank key is a tuple: [ILS-converted total over
   the currencies that have a rate, then the raw amount of each currency that
   has none, in USD → ILS → EUR order]. An amount without a rate ranks after
   every amount with one (`owedRank`, `src/components/clients/clientIndexRows.ts`).
4. **Only owed-now ordering needs this.** The overdue column orders by days
   late, and payment and activity columns order by date. Each of those
   comparisons is currency-free.
5. Ties fall back to name A–Z, then id, so a re-render never reshuffles equal
   rows.

**Relation to ADR-004**: this refines it rather than overriding it. ADR-004's
rules are about *displayed* totals (per-currency by default; a converted view
must show its rates). A ranking displays no total, and its basis is disclosed
on the header.

**Consequences**: the order can change when the rate moves, which is the
honest answer to "who owes me most" across currencies. Tests pin the order
at fixed rates and show it flipping when the dollar's rate changes. Any future
list that needs a cross-currency order reuses `owedRank`'s tuple rule, not a
new one.

**Alternatives Considered**: rank by the profile's default currency, then the
others (rejected — a client owing only ₪ always sorts below anyone owing $);
rank by lateness instead of size (rejected — it departs from the ticket and
answers a different question, which the Overdue column's own sort already
answers); a hidden sum of raw minor units (the old behaviour; wrong).

---

## ADR-036: Home Answers Who Owes Me: Owed Now, Needs Attention, Recent Payments; the Forecast Strip Is Deleted

**Status**: Active
**Date**: 2026-10-11
**Context**: MUT-8 (epic MUT-1), brief `.claude/designs/mut-8-home-owed-attention-payments.md`, approved by Basel 2026-10-11. Home, the only eagerly loaded route, answered "Am I okay?" with a forecast strip, month actuals, a guidance attention feed and recent transactions. That contract came from `docs/ux-redesign/UX-REDESIGN-SPEC.md` §6 and `.claude/designs/insights-reintegration.md` §2. The 2026-10-05 minimization says the product answers three questions; Home now answers exactly those.

**Decision**:
1. **Home is three blocks, in order:**
   - **Owed now** (`OwedNowSummary` over `summarizeOwedByCurrency` of every receivable in the active profile).
   - **Needs attention** (`getAttentionReceivables`: overdue or due within 7 days, every currency, oldest due first).
   - **Recent payments** (the last 10 via `paymentRecordRepo.listRecent`, ADR-033 rows).

   Every row opens its client profile, or the entry when it has no client.
2. **Nothing else lives on Home.** That means no forecasting, no month actuals and no expenses.
3. **`PredictiveKpiStrip`, `MonthActualsRow`, `AttentionFeed` and `KpiCard`/`KpiStrip` are deleted**, with their tests, CSS and i18n keys. Basel chose this over moving the forecast to Insights and over keeping the code unused. The money-event read side they leave without a consumer is pruned by MUT-58 (TD-034). Its tables stay (ADR-029).
4. **A brand-new install that skipped onboarding sees one action, Add income.** Whether the user is new is decided only after the clients and entries queries have answered; until then Home shows a spinner. Otherwise onboarding and the empty state flash on every load.
5. **Home's Owed now counts every receivable in the profile.** That includes income with no client and income of archived *clients*; it excludes archived *entries*, per ADR-033. The clients index strip sums only the clients it lists, so the two can differ by exactly those debts. Home is where money owed must never be hidden, and its Needs attention list includes the same rows.

**Supersedes**: the Home contract in `docs/ux-redesign/UX-REDESIGN-SPEC.md` §6 (KPI strip of received/unpaid/expenses/net, mixed attention items) and `.claude/designs/insights-reintegration.md` §2 ("Home: Am I okay?"). Both now carry a "Superseded by ADR-036" note. No ADR is overridden: ADR-021 names Home but never defined its content.

**Consequences**: Home reads four queries instead of about six, and its eager chunk no longer carries the forecast components. The "Will I make it?" forecast is no longer in the product; reintroducing it means a new ticket, not reverting this one. The guidance feed's USD/ILS-only blind spot (EUR never appeared) goes with it.

**Alternatives Considered**:
- Move the forecast strip and month actuals to Insights, an optional area (rejected by Basel: the leanest result was preferred).
- Remove them from Home but keep the code (rejected: dead code).
- Reshape `AttentionFeed` to the new list (rejected: its guidance engine is month-bound and USD/ILS-only, while `getAttentionReceivables` already was the right list).

---

## ADR-037: Hosted Users and Sessions — A Human Principal Beside API Keys, a Hosted-Only Portal Build, One Enforced Writability Matrix

**Status**: Active (extends ADR-025; partial override of ADR-023 for the
hosted service; ADR-013 untouched) — approved by the owner with
`.claude/designs/hosted-portal.md` on 2026-10-11 (MUT-36)
**Date**: 2026-10-11
**Context**: Epic MUT-34. Money v1's only principal is Malafat's organization
API key (ADR-025 §2–3); a firm partner has no way to see the firm's money on
Mutaba3a. The owner decided on 2026-10-10: a profile has a source (`local` or
`hosted`); neither syncs to the other; on a hosted profile income,
receivables and payments are read-only (Malafat is writer of record) and
expenses are writable server-side; accounts are operator-issued only; "sign in
with Malafat" is not v1 because MUT-28's client is a desktop loopback client
and gives no hosted web login. Full design, cost and test strategy:
`.claude/designs/hosted-portal.md`.

**Decision**:

1. **A human principal exists on the hosted service.** `User` (operator-
   provisioned, email + argon2id password hash, `ACTIVE | DISABLED`) and
   `Membership` (user ↔ organization, access/no-access). Users are created,
   granted, reset and disabled only through `/admin/v1/users*` behind
   `MUTABA3A_ADMIN_TOKEN` and `npm run` wrappers. **No signup, invite or
   password-reset route exists in any environment**; a route-inventory test
   and a bundle test assert it.
2. **A hosted profile is `Membership × Organization`**, not a table. The
   client-side type is `ProfileSource = 'local' | 'hosted'`; the server only
   ever emits `hosted`. **Hosted profile data is a separate dataset from local
   profile data**: no shared ids, no hosted row in Dexie, no op in the op-log,
   no IndexedDB in the portal.
3. **Sessions are server-side records behind an httpOnly cookie on the API's
   own origin.** `__Host-mut_session; Secure; HttpOnly; SameSite=Strict;
   Path=/`; a 32-byte random token stored as
   `HMAC-SHA256(SESSION_TOKEN_PEPPER, token)`; idle (default 120 min) and
   absolute (default 12 h) expiry; sign-out revokes the record server-side;
   rotating the pepper (Secret Manager, Terraform-generated) signs everyone out.
   Non-GET session requests must be same-origin (`Sec-Fetch-Site` / `Origin`).
   The server keeps no CORS.
4. **Sign-in does not reveal accounts.** Unknown email and wrong password give
   the same `401 INVALID_CREDENTIALS` with matched timing (dummy argon2 verify);
   throttling and lockout key on the normalised email string whether or not an
   account exists; a real account's lockout is written to `User.lockedUntil`
   and to each member organization's audit log.
5. **Routes declare accepted principals in the OpenAPI `security` field, and
   one `authenticate()` middleware enforces that same declaration.** A request
   carrying both an API key and a session cookie is refused. Every `/v1` route
   must declare `security` and call `requireScope` — a test enforces it, closing
   today's opt-in gap.
6. **ADR-025 §2 is amended for sessions only.** An API key still implies its
   organization and no API-key request accepts an organization id. A session
   selects one of its memberships per request with `X-Mutaba3a-Profile`;
   a non-member, unknown or malformed id answers `404`, exactly like a
   cross-organization id today.
7. **One writability matrix, enforced three times.** The table in the brief
   (§5, between `writability-matrix` markers) is mirrored as a `const` in
   `server/src/auth/writability.ts`; a drift test fails if they diverge. It
   generates a session's effective scopes, maps a refused session write to
   `403 READ_ONLY_PROFILE { domain, writerOfRecord }`, and drives a
   per-request store guard whose method classification is compiler-exhaustive
   over `LedgerStore`, so a write cannot be added below the routes without
   being classified. Expense routes accept sessions only, so Malafat's key
   cannot reach them with any scope set.
8. **Lazy posting during a session read is a system act.** Due installments
   and retainer charges posted by a session's read run on the unguarded store
   with actor `SYSTEM`. API-key behaviour is unchanged.
9. **Audit gains actor `USER`.** A published enum change: Malafat's vendored
   contract is refreshed, and its parser confirmed tolerant, before any session
   can write an audit row.
10. **The portal is a hosted-only build target of this repo** (`vite build
    --mode hosted` → `dist-hosted/`), served by the API service from the same
    origin. It reuses the design system and i18n/RTL kit, and is forbidden by
    lint from importing `src/db`, `src/sync`, the local hooks, shell or
    drawers. It shows hosted profiles only. A bundle test proves the `web` and
    `desktop` builds contain no portal code and the portal contains no Dexie.

**ADR-013 is untouched.** Nothing in this decision writes the op-log, reads
it, or gives it a remote peer; local and hosted profiles share no data, so
there is nothing to sync. Making the hosted service a sync target remains a
separate ADR gated on MUT-27 and TD-015 (ADR-024). TD-037 records that the
op-log has no `profileId` concept at all, so profile-selective sync is not
even expressible today.

**ADR-024's guarantee is demonstrated, not asserted**: the desktop/PWA bundles
are checked to contain none of the portal's endpoints, cookie name or headers,
and no new network origins; Dexie schema, profile types, profile store,
switcher and `src/sync/` are not edited.

**Override log — ADR-023 (partial)**: *What*: its clause "builds no account
system, no password storage, and no session of its own". *Why*: the owner's
2026-10-10 decision that tenants sign in to a hosted web portal with
operator-issued accounts, while MUT-28's OAuth client is a desktop public
client on a loopback redirect and cannot provide a hosted web login. *What
replaces it*: decisions 1, 3 and 4 above, for the hosted service only.
ADR-023 otherwise stays Active for the desktop's Malafat connection. *Date*:
2026-10-11. **TD-018** stays Accepted with corrected wording (users are
operator-provisioned like keys; "Mutaba3a keeps no account system" no longer
holds).

**Consequences**:
- `server/` gains three tables (`users`, `memberships`, `sessions`), five error
  codes (`INVALID_CREDENTIALS`, `SESSION_EXPIRED`, `PRINCIPAL_NOT_ACCEPTED`,
  `READ_ONLY_PROFILE`, `CROSS_SITE_REQUEST`), a cookie security scheme, one
  secret (`SESSION_TOKEN_PEPPER`) and a minor API version.
- Route handlers move from a closed-over store to a per-request `c.var.store`
  and from `auth.apiKey.id` to `actorOf(auth)` — one mechanical refactor.
- The service must keep `max_instances = 1` (TD-017): sign-in throttling and
  lockout counters are in process, like the API-key limiter.
- The portal ships with the API image; a custom domain needs a load balancer or
  proxy in front of the one service (MUT-45), because `__Host-` cookies require
  the page and the API to share an origin.
- MUT-35's registry is not the portal's data path; TD-013's "upgrade when
  MUT-43 lands" note moves to "when a second implementation is injected".

**Alternatives Considered**:
- *Repoint the existing app through the MUT-35 provider*: the hosted ledger
  (agreements, installments, posted receivables, allocations, VAT, credits)
  does not map to `Transaction`/`PaymentRecord` without inventing data; ~17 of
  20 repository slots would throw; the shell opens Dexie before React mounts;
  the registry cannot swap in production. Rejected.
- *Show in-browser local profiles inside the portal*: the sign-in would not
  protect them on a shared machine, and the portal would carry Dexie and the
  op-log. Rejected.
- *Bearer tokens in browser storage*: one XSS becomes account takeover.
  Rejected.
- *A BFF holding Malafat's all-scope key*: read-only would depend on the BFF,
  not the server. Rejected.
- *Cross-site cookie with CORS, or a Netlify proxy*: unreliable under
  third-party cookie blocking; a non-`me-west1` edge on firm data (ADR-024
  residency). Rejected.
- *Sign in with Malafat (OAuth) for the web*: no hosted web client exists, and
  the owner deferred it. Revisit with MAL-870.
- *A server `Profile` table*: a second id for the same organization, with
  nothing to hold in v1. Rejected.

**Amendment (MUT-39, 2026-10-11)**: decision 7's third layer, as built.
- *What changed*:
  - The guard lives in the store, not in a `c.var.store`. Every route factory
    receives `requestScopedStore(store)`, a proxy that reads the current
    request's guard through Hono `contextStorage`, so the consequence
    "handlers move to a per-request `c.var.store`" did not happen.
  - Store methods have a fourth class, `operator` (provisioning), which is
    refused under every guard.
  - Lazy posting goes through `lazyPostingOf(c, store)`, the one caller of
    `unguarded()`.
- *Why*: the proxy reaches helpers that are handed the store as well as
  handlers, without a 58-handler edit. It is also the only form in which "no
  route can opt out" holds structurally. `operator` keeps decision 1
  ("accounts are operator-issued") true below the routes, not just at them.
  Pairing the actor and the store in one function means a session's catch-up
  can never be attributed to a key, and a key's never runs unguarded.
- *What it replaces*: the "`c.var.store`" consequence above, and the brief's
  `guardStore(store, matrix, principal)` wording (§5 now carries an "As
  built" note).
- Decisions 1–10 are otherwise unchanged.
