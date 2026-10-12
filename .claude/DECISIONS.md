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
| ADR-038 | A Transaction's paidAt Is Derived From Its Payment Records; Future-Dated Payments Are Rejected; Mark Paid Routes to the Dated Drawer | Active; §5 superseded by ADR-047 | 2026-10 |
| ADR-039 | Payment Records Own an Entry's Payment State; an Edit Never Rewrites It | Active | 2026-10 |
| ADR-040 | Local Queries and Saves Run Offline (networkMode 'always'); Only Network-Bound Queries Wait for a Connection | Active | 2026-10 |
| ADR-041 | The Landing Page Claims Only What Ships: Free During Early Access, Platform Claims Gated on the Release, Capability Copy Built From Code | Active | 2026-10 |
| ADR-042 | A Visitor Sample Session Seeds Only an Empty Database and Leaves Nothing Behind | Active | 2026-10 |
| ADR-043 | Deploys Go Through `make`, Which Refuses to Release From a Tree That Does Not Describe Itself | Active | 2026-10 |
| ADR-044 | Drawers Move on Springs; a Close Is Immediate and Its Exit Is a Snapshot; `motion` Is a Dependency | Active | 2026-10 |
| ADR-047 | The Record Payment Drawer Has One Action, and It Closes the Drawer; Mark Fully Paid Is Removed (Supersedes ADR-038 §5) | Active | 2026-10 |
| ADR-048 | The Unsorted Inbox Is Owned by the User, and Filing Is One Cross-Repository Transaction | Active | 2026-10 |

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
   (D20) instead of adding a mapping migration. **Overridden 2026-10-11
   (MUT-59)**: see the override log below.

**Replaces**: M7 brief decisions 2 ("approval is a state, not a copy of agree")
and 3 ("converting is the wizard's job"). The wizard remains for agreements
without a proposal.

**Override log — decision 5 (MUT-59, 2026-10-11)**:
- *What:* its premise was false. Production rolled the original M7
  (`acb1144`, revision `mutaba3a-api-00003-rvr`) on 2026-10-09, and
  `prisma migrate deploy` never re-runs a recorded migration, so the edit
  never reached it. Production kept the five-value enum, and approving a
  proposal failed.
- *Why it was missed:* the deploy history lived only in Cloud Run.
  `DEPLOYMENT.md` §7 now records it.
- *What replaces it:* the forward repair migration
  `20261011120000_mut59_fee_proposal_enum_repair`. It maps a database that has
  the original M7 to M8's shape, audits every row it touches, refuses rows it
  cannot map, and is a no-op on a fresh database. The edited M7 file stays as
  it is, because fresh databases build from it.
- *Rule from now on:* never edit a migration that has left its branch.
  Ship a forward migration (PATTERNS "Migrations are append-only once merged").

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

**Note 2026-10-12 — MUT-58: §4's shared code is gone too.** `moneyEventRepository`
stayed because three Overview components read it. ADR-036 §3 deleted those
components, and MUT-58 then deleted the repository, `useMoneyEventQueries` and
the money-event types, which had no reader left. This applies §4; it does not
override it. Money events were derived, so no table was involved. The
`moneyEventVersions` sync table is unrelated and stays (§1), and
`noDeadMoneyEventModules.test.ts` asserts it is still in the schema.

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

**Amendment (MUT-42, 2026-10-11)**: closing the expenses domain to Malafat at every door, and decision 7's scopes. Approved by the owner with `.claude/designs/mut-42-hosted-expenses.md`.
- *What changed*:
  - **Session-only scopes.** `expenses:read` and `expenses:write` live in `SESSION_ONLY_SCOPES`. `Scope` is the union, and `parseScopes` (key issuance) refuses them, so the key vocabulary in `SCOPES`, `MALAFAT_REQUIRED_SCOPES` and the published document is unchanged. This replaces the plan for expense scopes to "join the closed SCOPES vocabulary".
  - **`{ read: Domain }` in the store guard.** A domain-scoped read is refused where the principal's column is `none`. Every expense repository method is classified in `expenses`, so Malafat's key can't read an expense even through a future, mis-declared route.
  - **Audit and idempotency don't leak.** `GET /v1/audit` excludes the expense entity types. A session's `Idempotency-Key` is claimed under `s:` + SHA-256(user id, key), so `GET /v1/operations/{key}` can't return it and the two principals never collide.
  - **Receipts have their own table** (`expense_receipts`), on the same bucket and TTL as M6 attachments, because Malafat reads the `attachments` table.
- *Why*: the routes being session-only (decision 7) left four other paths by which a key could see expense data. Each is now closed structurally rather than by a filter on Malafat's queries. A generated canary sweep over every key-readable operation proves it.
- *What it replaces*: the `expenses:*`-in-`SCOPES` note in `writability.ts`, and the brief's "Routes covered" cell for expenses. That cell is now `/v1/expenses*, /v1/expense-categories*, /v1/summaries/expenses`; summaries reads `/v1/summaries/* (except expenses)`.

**Amendment (MUT-43, 2026-10-11)**: the portal as built. The auth-state UX was approved by the owner with `.claude/designs/mut-43-auth-states.md`; "Sign in with Malafat" was rejected outright by the owner the same day and removed from this ADR's alternatives and the brief.
- *What changed*:
  - **The portal's strings are their own dictionaries** (`src/hosted/i18n/{en,ar}.json`: `hosted.*` plus the three `common.*` keys its reused components read, pinned to the app's wording by a test), not a `hosted.*` subtree of the app's files. The app's files contain strings the bundle check bans (Arabic "reset", "create account") and "IndexedDB" copy. Separate files also keep portal copy out of the local bundles. To let shared components' `useT()` work under either provider, `src/lib/i18n` is split into a translation-free `core.tsx` (context, hooks, translator, a controlled `I18nProvider`) and the app's `LanguageProvider`, whose behaviour is unchanged.
  - **The portal is its own TypeScript program** (`tsconfig.hosted.json`; `tsconfig.app.json` excludes `src/hosted`). The app registers its router type globally in `src/router.tsx`, which would type the portal's routes; the split also makes "the app program never sees portal code" structural.
  - **Cursor lists show more, they don't paginate.** The API returns cursors without totals, so the page-numbered `Pagination` is not reused; lists use `useInfiniteQuery` and a "Show more" button. Clients loads the whole directory (pages of 200) so its name search is instant (TD-044).
  - **Dev serves the portal entry for every page** (`vite --mode hosted`), so the dev server never serves the local app from the portal's origin.
  - **One `BroadcastChannel` per tab** sends and listens, so a tab never hears its own sign-out.
- *Why*: each came from building or running the portal: the bundle check failed on the app dictionaries, `tsc` failed on the global router type, the API has no totals, and a live run against the real server showed the dev entry and the self-heard sign-out.
- *What it replaces*: brief §7.7's "`hosted.*` namespace in `en.json`/`ar.json`" and §2's reuse of `Pagination`. The rest of §7 stands.

**Amendment (MUT-44, 2026-10-11)**: expense capture as built, per `.claude/designs/mut-44-expense-capture.md` (design review + eng review passes folded in before implementation).
- *What changed*:
  - **The expense form is genuinely shared.** `src/components/expenses/ExpenseFormFields.tsx` holds amount/currency/date/title/category/notes, used by both the local `ExpenseDrawer` and the new hosted one; vendor/client/project are host-supplied slots, not fields, since local's pickers are Dexie-backed and create-capable while hosted's are read-only directory lookups with no server-side vendor concept at all. The extraction left the local drawer's existing test passing unmodified and added new local coverage for the surface nothing exercised before (amount/currency/date/title/category-required/notes).
  - **No new CSS for the hosted drawer.** `src/hosted/components/Drawer.tsx` renders the exact `.drawer`/`.drawer-overlay` classes from the shared `src/index.css` (both builds already import it) rather than the `.hp-drawer` classes the brief originally proposed before this was verified — same interaction and pixels as the local drawer, without importing the lint-banned `components/drawers` path.
  - **The portal's mutation hooks live under `data/`, not `hooks/`.** The lint ban on `(^|/)(db|sync|hooks)(/|$)` matches the literal path segment, not whose hooks they are, so `src/hosted/hooks/` as originally planned failed lint; `data/expenseQueries.ts` is the correction.
  - **Error mapping is explicit and field-owned where possible.** `expenseApiErrors.ts` maps MUT-42's `VALIDATION_FAILED` reasons (`details.reason`, not `error.code`) to `form.setError(field, {type:'manual', message})`; `CONFLICT` and anything unrecognised go to the existing `Toast`. `ExpenseFormFields` now distinguishes a manually-set error from its own generic validation text (`errors.<field>.type === 'manual'`), which it didn't need to before this ticket.
  - **Receipts are a bare cross-origin `PUT`,** not routed through `api/client.ts`'s `request()` (same-origin credentials, `/v1/*` only) — `credentials: 'omit'` makes explicit no cookie reaches the storage bucket. Flagged on MUT-45: its CSP needs the bucket origin in `connect-src` or uploads fail silently once the policy ships.
  - **The default expense date uses a new `todayLocalISO()`** (browser-local calendar date) in `format/dates.ts`, not `toISOString()` — the same UTC-date bug `src/lib/dates.ts`'s `todayLocalISO()` fixed on the local app (MUT-17), now avoided on first appearance in the portal rather than reintroduced.
- *Why*: each correction came from either the plan-design-review/plan-eng-review passes before implementation (field order, error surfacing, loading states, RTL amount input, chrome) or a concrete lint/build failure during it (the `hooks/` path, the `.hp-drawer` CSS assumption).
- *What it replaces*: the brief's §3 "new CSS (`.hp-drawer`, `.hp-drawer-overlay`)" and "`src/hosted/hooks/`" lines; §9's open decision 2 is resolved in favor of `data/`.

**Amendment (MUT-45, 2026-10-11)**: the portal is served, closing decision 10's "hosted-only build target ... served by the API service from the same origin."
- *What changed*:
  - **No custom domain.** §9's "Domain" open decision (external HTTPS load balancer vs. Cloudflare proxy, because Cloud Run domain mapping is unavailable in `me-west1`) is resolved by not doing either, for now. Decision 10 only requires the portal and the API to share one origin; the service's own `run.app` URL already is that one origin at zero extra cost or infrastructure. `PORTAL_ORIGIN` and `TRUSTED_PROXY_HOPS` stay at their MUT-38 defaults (unset / 1): `isSameOriginRequest()`'s fallback to the request's own arrival origin is correct and sufficient without a reverse proxy in front of the service. A branded domain (`api.mutaba3a.app`) is deliberately left for its own follow-up ticket — it was never required by any MUT-45 acceptance criterion, and `server/DEPLOYMENT.md` already called it optional before this ticket existed.
  - **CSP resolves the flag MUT-44 left open.** `default-src 'self'; connect-src 'self' https://storage.googleapis.com; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'`. The one addition to §9's draft policy is the GCS host in `connect-src`: receipt uploads (MUT-44) `fetch()` a `PUT` straight to a v4 signed URL, which `connect-src` governs; `storage.googleapis.com` is `@google-cloud/storage`'s path-styled default host (`virtualHostedStyle` not set in `GcsAttachmentStorage`). Downloads stay exempt — `downloadNavigator.open()` is a top-level navigation, not a `fetch`/XHR.
  - **Serving is one more static-file layer, not a proxy.** The API serves `PORTAL_DIST_DIR` itself: `/assets/*` immutable-cached via `@hono/node-server/serve-static`, any other non-API GET falls back to `index.html` for client-side routing, registered after every API route so a real route always wins and a bad `/v1` or `/admin` path still answers JSON, never the portal shell.
  - **The image bundles the build; nothing in `server/` imports it.** `scripts/deploy.sh` and `server-ci.yml` both run `npm run build:hosted` at the repo root and copy `dist-hosted/` into the Docker build context before `docker build`; the Dockerfile only `COPY`s the already-built output (ADR-024 holds: no frontend source enters the server image).
  - **Terraform is unchanged.** No new resources, no new variables; `terraform plan` is a no-op for this ticket.
- *Why*: the domain choice added a reverse proxy and the exact `PORTAL_ORIGIN`/`TRUSTED_PROXY_HOPS` complexity §9 itself flags as conditional on one existing, for no acceptance criterion that needed it. The CSP gap was a concrete, named risk from the MUT-44 amendment above, not a hypothetical.
- *What it replaces*: §9's "Domain" bullet is resolved (not deferred) in favor of no domain; its "CSP" bullet gains the `connect-src` addition. The ticket text's own citation of "ADR-033" for this architecture is stale — ADR-033 on `main` is an unrelated decision (owed-now definition); this ADR-037 is the correct reference.

**Amendment (MUT-64, 2026-10-12)**: a device session — the same human principal as a portal session, carried as a bearer token instead of a cookie, for a native app that can't hold a cookie. Approved with `.claude/designs/mut-64-device-sessions.md`.
- *What changed*:
  - **A second bearer-token shape, not a second auth system.** `mds_<43-char base64url secret>` (vs. an API key's `mut_<env>_<prefix>_<secret>`) lets `authenticate()` route a presented bearer token to the API-key or device-session verifier by prefix — never by trying one and falling back to the other. Both are hashed with the same `sessionDigest(SESSION_TOKEN_PEPPER, token)` HMAC as a cookie session, so pepper rotation signs out every device too.
  - **One `sessions` table, not two.** `SessionRecord`/`CreateSessionInput` gain `kind: 'cookie' | 'device'`. Reusing the table — rather than a parallel `deviceSessions` table — means `revokeAllForUser` (already called from the operator's password-reset, disable, and explicit "sign out everywhere" routes) revokes device sessions for free, with zero changes to `admin-users.ts`.
  - **Device sessions are the `'session'` `Principal`, unchanged.** `writability.ts` and `store-guard.ts` needed no changes — both were already principal-agnostic, keying off the string `'session'` rather than how the session was authenticated. This is what makes a device session get "exactly the portal session's access (including expenses), never an API key's" true without a new matrix column.
  - **CSRF/same-origin enforcement stays cookie-only**, structurally: it lives only in `authenticate()`'s cookie branch, and a device-session bearer token never reaches that branch. A native app has no `Origin`/`Sec-Fetch-Site` signal comparable to a browser's.
  - **Full session parity, not an expenses-only allowlist.** The ticket's scope-in text names `GET /v1/me` and the AC names expenses specifically, but this decision's own wording ("exactly the portal session's access") means a device session reaches every route a cookie session does. The OpenAPI `security` array for every such route (13 files) gains `{ deviceSession: [] }` as an alternative to `{ session: [] }`, so the published contract doesn't undersell what the server actually does.
  - **`POST /v1/device-sessions`** (public, mirrors `POST /v1/sessions` minus the CSRF gate) and **`DELETE /v1/device-sessions/current`** (`deviceSession`-only, organization-independent like `GET /v1/me`) are new routes in `server/src/routes/device-sessions.ts`. Both share the cookie route's `SignInThrottle` and IP rate limiter instances, so a locked-out account is locked out from both surfaces.
  - **The credential-verification core is one function, not two copies.** `auth/sign-in.ts`'s `signIn()` — dummy-hash timing, throttle/lockout, audit — is shared by both sign-in routes; the cookie route was refactored to call it rather than left as the thing the new route copies. Audit rows for both kinds now carry `metadata: { sessionKind }`, so an operator investigating a suspected-compromised device token can tell which channel a sign-in came from.
  - **Device-session lifetime**: 30-day idle, 180-day absolute (`DEVICE_SESSION_IDLE_DAYS`/`DEVICE_SESSION_ABSOLUTE_DAYS`, optional on `SessionSettings`, defaulted so existing test harnesses and deployments don't need updating) — longer than a cookie session's 120-minute/12-hour pair, because capture happens days apart.
  - **An expired or revoked device token answers `SESSION_EXPIRED`**, matching the existing cookie-session convention, not a literal `UNAUTHENTICATED` — read as the ticket's intended rejection *class* (a 401, not an authenticated request), not a mandated code string.
- *Why*: MUT-63 (Mutaba3a Capture) needs native sign-in and this reuses ADR-037's already-shipped investment (users, passwords, sessions, writability) rather than opening a second account system — considered and rejected opening a Firebase-Auth spike instead, since ADR-037 decision 1's "no signup/invite/reset route" invariant and ADR-024's data-residency stance would both have to be re-litigated for no corresponding gain at this user scale (owner decision, 2026-10-12).
- *What it replaces*: nothing in decisions 1–10 changes; this is a new transport for decision 3's "a human principal... carried as a bearer token instead of a cookie" (previously only described for the hypothetical, now built).

**Amendment (MUT-65, 2026-10-12)**: decision 7's writability matrix gains a per-profile dimension on three rows, so a personal hosted profile can write its own ledger instead of staying permanently read-only. Approved by the owner with `.claude/designs/mut-65-personal-profile-income.md`.
- *What changed*:
  - **`customers`, `projects` and `payments`' session column is now a function of the profile, not a matrix constant.** `sessionAccessFor(domain, profileWriter)` returns `'read-write'` when `profileWriter === null` (a personal profile) and the matrix's static `'read'` when it is `'MALAFAT'`; `PROFILE_DEPENDENT_DOMAINS` names exactly these three. Every other row, and the API-key column on every row, is unchanged — a Malafat-fed profile is exactly as read-only on these three as before.
  - **`sessionScopesFor(profileWriter)` and `mayWriteFor(principal, domain, profileWriter)`** replace the static `sessionScopes()`/`mayWrite()` at the two points that compute a session's actual access: `selectProfile()` (the scopes a session's token carries for the request) and `store-guard.ts`'s `storeRefusal` (the layer below the routes). The static functions are kept, unmodified, because nothing else depended on per-profile awareness.
  - **Two routes gain a second principal.** `POST /v1/customers` and `POST /v1/projects` declare `security: [{ apiKey: [] }, { session: [] }]`; a session's `externalReference` is refused (a session has no external system to reference). `PATCH`/`archive` on both stay apiKey-only — the ticket's AC only asked for create. Two new, wholly session-only routes land alongside: `POST /v1/income` (Received or Owed, written directly — no agreement, no allocation preview) and `POST /v1/receivables/{id}/settle` (one payment, one allocation, no preview token).
  - **`GET /v1/me`'s `access` map is now computed per organization** (`sessionAccessFor` over each membership's own `writerOfRecord`) instead of once from a static `sessionAccess()`.
  - **hosted-portal.md §5's matrix cell for these three rows** gets the literal, fixed suffix `` `read; read-write on a personal profile` `` (not a parser/grammar — an explicit, reviewed choice); the drift test asserts the literal string plus `sessionAccessFor(domain, null) === 'read-write'` directly.
- *Why*: MUT-34/this ADR built the hosted service and portal but left every personal (non-Malafat) profile permanently read-only — the exact freelancer-with-no-firm-behind-them user the "personal profile" concept (hosted-portal.md §3.1) was named for, but never wired to a write path. MUT-63 (phone capture) cannot ship for that user without it.
- *What it replaces*: nothing structural — the three-layer enforcement shape (scopes, route `security`, store guard) is exactly decision 7's, now parameterized by profile on three rows instead of being uniform across all ten.
- **Deviation found during implementation, not anticipated by the brief**: `Receivable.getById`/`list`/etc. now exclude a soft-deleted (`ADJUSTMENT`, voided) row — correct for every normal reader, but it meant the new `DELETE /v1/income/{id}` undo route could not re-confirm ownership on a *repeat* call against an already-voided row (its own idempotency check needs to see what every other reader must not). `ReceivableRepository.getByIdIncludingDeleted` was added for that one caller; every other reader is untouched.

---

## ADR-038: A Transaction's paidAt Is Derived From Its Payment Records; Future-Dated Payments Are Rejected; Mark Paid Routes to the Dated Drawer

**Status**: Active
**Date**: 2026-10-11
**Context**: MUT-18. `transactionRepo.markPaid` and `recordPartialPayment`
hardcoded `paidAt` to the instant the user clicked, with no way to say the
money arrived earlier — reconciling a payment on a different day than it was
received recorded the wrong date and could bucket it in the wrong month on any
report grouped by `paidAt`. Separately, `recalculateReceivedAmount` (the
function every payment write funnels through) stamped the transaction's own
`paidAt` with `tx.paidAt || now` when a transaction crossed into fully paid —
wrong even for the already-dated path (`PartialPaymentDrawer`'s date field),
because it ignored the payment records it had just summed and used the
recalculation instant instead. A fourth UI entry point, `PartialPaymentDrawer`'s
"Mark fully paid" shortcut, called a separate dateless mutation
(`useMarkTransactionPaid`) and silently discarded whatever date the form's own
date field held.

**Decision**:
1. **`recalculateReceivedAmount` derives `paidAt` from the payment records it
   just summed** — the latest (lexicographically greatest, consistent with how
   records are already sorted) non-deleted record's `paidAt`, falling back to
   `now` only when no record carries a date. This is the single function every
   payment-completing write passes through (`paymentRecordRepo.create`,
   `.update`, `.delete`, and `markPaid`'s already-covered branch), so the fix
   applies uniformly rather than per call site.
2. **`markPaid(id, opts?: { paidAt?: string })` and
   `recordPartialPayment(id, amountMinor, opts?: { paidAt?: string })`** accept
   an optional date, defaulting to today; `useMarkIncomePaid` takes
   `{ id, paidAt? }` to match. `markPaid`'s already-fully-covered branch now
   delegates to `recalculateReceivedAmount` instead of carrying its own copy of
   the status/paidAt-setting logic.
3. **A payment cannot be future-dated.** `paymentRecordRepo.create` and
   `.update` reject `paidAt` (compared by calendar date only — a same-day
   timestamp from `nowISO()` is not future) later than today, and the
   `PartialPaymentDrawer` form surfaces this as a translated inline error
   before the mutation fires. Rejected rather than allowed: a received payment
   dated in the future does not correspond to anything that happened, and
   silently accepting one is far more likely to be a typo (wrong year) than a
   deliberate entry.
4. **The four "Mark Paid" row-menu quick actions (Income, Transactions,
   Project detail, Client work section) open `PartialPaymentDrawer` instead of
   firing `markPaid` directly.** Every one of those surfaces already shows a
   `RecordPaymentButton` next to the same row's "Mark Paid" menu item doing
   materially the same thing with no date control — the quick action was a
   second, inferior way to write the same `PaymentRecord` row. Routing it to
   the drawer (prefilled with the full remaining balance, so settling in full
   is still one confirm) removes that duplicate path outright rather than
   growing a date picker into four more menu items.
5. *(Superseded 2026-10-12 by ADR-047: the shortcut is removed, and the date lives in the form again.)* **`PartialPaymentDrawer`'s "Mark fully paid" shortcut now submits through
   `useCreatePaymentRecord` with the form's own `dateInput`**, lifted from
   `PaymentForm` into the drawer so both the shortcut and the explicit submit
   button record under the same chosen date. `useMarkTransactionPaid` is no
   longer called from this component.

**Consequences**: Every UI path that can mark income paid now accepts a
backdated date, and a transaction's `paidAt` always reflects the payment that
actually completed it rather than when any write happened to run. `markPaid`
and `useMarkIncomePaid`/`useMarkTransactionPaid` are kept as repository/hook
primitives — `synced-repository.ts`'s sync wrapper and `paymentRequestService`
still have legitimate reasons to flip a transaction to paid without going
through this drawer — so this decision narrows *where the UI calls them*, not
the primitives themselves. `src/hooks/useTransactionActions.ts` duplicates the
same dateless pattern this ADR fixes but has no production caller; left alone
here and logged as tech debt (TD-046) rather than deleted as a scope expansion
of a bug-fix ticket.

**Alternatives Considered**: prompting for a date inline on the quick action
(rejected — grows a form into a menu item on four surfaces instead of reusing
the drawer that already has one); allowing future dates (rejected, see above);
deleting `markPaid`/`useMarkTransactionPaid` entirely now that the UI stops
calling them directly (rejected — both have other live callers outside this
ticket's scope: sync replay and the payment-request flow).

*(Amended 2026-10-12, MUT-5 final pass.)* "Future" means the payment's calendar day is after today. A date-only `paidAt` is compared as is. A full timestamp is future only when both its UTC date and its local date are after today (`isFuturePaymentDate` in `repository.ts`). Comparing only the UTC date rejected `new Date().toISOString()` in the evening west of UTC, which broke Mark paid and Record Payment there.

**Addendum (2026-10-12, MUT-65).** The same rule — a payment date is never later than today; backdating is accepted — is now also enforced server-side, on `server/`'s `POST /v1/income` (`occurredOn`) and `POST /v1/receivables/{id}/settle` (`paidAt`): `income/compose.ts`'s `assertNotFuture`. This is the same rule applied to a second surface, not a new decision. It is a genuinely new check, not a reuse of an existing one: `server/`'s own `POST /v1/payments` (Malafat's apiKey-only route) applies `assertNotAbsurdDate` to `receivedOn`, which only rejects a date more than ten years ahead (a typo-sized sanity ceiling) — it does not reject a merely-future date. The design brief for MUT-65 assumed otherwise and cited it as the reused check; verified against the actual code during implementation and corrected here rather than silently shipping a check that doesn't do what the brief said it does. `payments.ts`'s own `receivedOn` validation is unchanged by this correction.

---

## ADR-039: Payment Records Own an Entry's Payment State; an Edit Never Rewrites It

**Status**: Active
**Date**: 2026-10-11
**Context**: MUT-5 (epic MUT-1). Brief: `.claude/designs/mut-5-income-fast-path.md`, decision P2. Approved by Basel on 2026-10-11 as eng-review choice R2 = A.

Before MUT-5, every income-drawer save rewrote the payment fields:
- a paid entry was sent `paidAt: now`, so retitling it moved its payment date to today (Home's Recent payments, the client's Last payment);
- an unpaid entry was sent `receivedAmountMinor: undefined`, which Dexie treats as a delete, so retitling a part-paid entry erased what had been received;
- `transactionRepo.update` wrote whatever it was given and never recalculated.

Mark paid, Record payment and partial payments all write `PaymentRecord`s, so most paid income is record-backed.

**Decision**:
1. **An entry with live payment records gets its `status`, `paidAt` and `receivedAmountMinor` from them** (`recalculateReceivedAmount`, ADR-030).
   - The income drawer never writes those three fields for such an entry.
   - Its status switch is read-only, with a hint to manage the payments from the client page.
2. **`transactionRepo.update` enforces this for every caller.** An update that touches the amount, the currency or any of `status` / `paidAt` / `receivedAmountMinor` reads the live records in one Dexie transaction. When the entry has records:
   - `status`, `paidAt` and `receivedAmountMinor` are stripped from the update and re-derived;
   - a currency change is rejected with `PaymentRecordError`, so recorded payments can't silently move into another currency;
   - an amount change below the recorded total is rejected (ADR-030: no overpayment). An unchanged amount is not checked, so a legacy entry with more recorded than its total can still be retitled;
   - after the write, a changed amount or stripped payment state recalculates. An unpaid entry cut to exactly the recorded total becomes paid; a paid entry raised above it is owed the difference.

   Updates that touch none of these take the old path, with no extra read. *(Amended 2026-10-11 by the pre-landing review: the first version only guarded amount changes, so a form writing status before its records loaded, or a currency edit, slipped past.)*
3. **For an entry without records, the drawer owns payment state, but only on a real status change** (`buildIncomeUpdate` in `src/lib/incomeEntry.ts`):

   | Transition | Write |
   |---|---|
   | paid → paid | keeps the original `paidAt` |
   | unpaid → unpaid | leaves `paidAt` and `receivedAmountMinor` **absent** from the write (never `undefined`) |
   | unpaid → paid | paid now, in full |
   | paid → unpaid | clears both |

**Consequences**: editing can no longer move a payment date or erase a received amount, and an amount edit can't leave status disagreeing with the records. The income drawer mirrors the rules so users get a translated reason, not a refusal: it waits for the records to load, shows status and currency read-only on a record-backed entry, and toasts when the repository still refuses (records changed in another window). Any other caller now gets `PaymentRecordError` for a currency change on a record-backed entry, including the invoice-sync path in `paymentRequestService`, which updates linked unpaid entries from a document. The drawer check for a too-low amount exists only to show a translated field message; the repository stays the source of truth.

When a cut makes the entry fully paid, `paidAt` is the latest record's date, because `recalculateReceivedAmount` derives it from the records (ADR-038, MUT-18).

*(Amended 2026-10-11 by the adversarial re-review.)* Two callers wrote payment state the way rule 2 now refuses, and both follow it:
- **Record Payment on a payment request** (`recordPaymentForRequest`) wrote `status: 'paid'` through `update`, so a part-paid receivable stayed unpaid while its document showed paid. It calls `markPaid`, which records the balance still owed.
- **`updatePaymentRequestWithTransaction`** (no callers yet) updates the linked receivable before the document, so a refused currency change leaves both untouched.
- **The op log** (`syncedTransactionRepo.update`) logs the entry as stored: a payment field only when it really changed (refused or derived), every other requested field with the value written.

One gap remains, ticketed: an entry saved as Received in the drawer still has no record (TD-029 → MUT-60). Until it does, it follows rule 3, not rule 1.

**Alternatives Considered**:
- Fixing only the drawer, the "draft P2" rule (rejected): Received → Invoiced on a Mark-paid entry would still orphan its records, and amount edits would leave status stale.
- Folding all of TD-029 into MUT-5, records on create plus a backfill (rejected): it needs a Dexie upgrade, which the ticket scopes out.
- A separate bug ticket (rejected): the edit path is exactly the code MUT-5 restructures.

---

## ADR-040: Local Queries and Saves Run Offline (networkMode 'always'); Only Network-Bound Queries Wait for a Connection

**Status**: Active
**Date**: 2026-10-11
**Context**: Found by the MUT-5 adversarial re-review. TanStack Query's default `networkMode: 'online'` pauses queries and mutations while `navigator.onLine` is false. The app is local-first: every query and mutation in the main app reads or writes IndexedDB (Dexie). Offline, the income drawer's Save, every other save and every list that had not loaded sat paused until the network returned, in a desktop app meant to work without one. Proven with `onlineManager.setOnline(false)`: a local `fetchQuery` and a mutation never settled.

**Decision**:
1. The main app's `QueryClient` is built by `createAppQueryClient()` (`src/lib/queryClient.ts`) with `networkMode: 'always'` for queries and mutations.
2. A query that really goes to the network declares `networkMode: 'online'` itself. Today that is only the live FX rate (`useFxRate`), which shows its cached rate (`placeholderData`) while it waits.
3. The hosted portal keeps its own client (`createPortalQueryClient`) on the default, because every portal query is a server call.

**Consequences**: offline, local reads and saves behave exactly as online. A future network-backed hook in the main app has to opt into `'online'` (or handle its own failures); otherwise it fails fast offline and retries per its `retry` setting.

**Alternatives Considered**:
- `'offlineFirst'` (rejected): it runs the first attempt but pauses retries offline, so a transient IndexedDB failure would hang instead of retrying.
- Setting `networkMode` per hook (rejected): dozens of hooks, and a new one would silently get the pausing default.

---

## ADR-041: The Landing Page Claims Only What Ships: Free During Early Access, Platform Claims Gated on the Release, Capability Copy Built From Code

**Status**: Active
**Date**: 2026-10-11
**Numbering**: ADR-039 and ADR-040 are taken on `feature/mut-1-client-core` (MUT-5), which is not merged yet; this ADR skips them so the merges don't collide.
**Context**: MUT-75 (epic MUT-74), brief `.claude/designs/landing-apple-redesign.md` L1–L3, L7, L12, approved by Basel 2026-10-11. The landing page offered "Buy for Mac — $49" and "Buy Desktop App" while every buy button linked to the free GitHub download (no purchase flow exists), promised a "Universal (Intel + Apple Silicon)" Mac build when `deploy.sh` builds arm64 only, linked Windows downloads to a release (v0.0.65) with no Windows installer, and named EUR in one place and USD/ILS in another.

**Decision**:
1. **The story**: the page leads with the job and privacy together — "Know who owes you. Keep it to yourself." — then one idea per chapter (client page, two-tap payment, many businesses), privacy said once, Get it, a six-question FAQ.
2. **Price**: free during early access, and the price is announced before it changes. No "Buy" or price on the page until a purchase flow exists.
3. **Platform claims follow the release**: the Mac download says Apple Silicon. A download is offered only when the latest release carries it (`ReleaseInfo.hasWindowsBuild`); otherwise the page says the installer isn't in this release. While the release is unknown the stable redirect is offered.
4. **Capability copy is built from code where code is the source of truth**: the currency answer comes from an exhaustive `Record<Currency, string>`, and the mock-ups use the app's own i18n labels (`clients.profile.owedNow`, `transactions.partialPayment.recordPayment`, …) so a renamed button renames the landing page too.

**Consequences**: Adding a currency without naming it on the landing page fails to compile. A release without a platform's installer changes the page by itself. Adding pricing later is a new decision, not a copy edit.

**Alternatives Considered**: keep $49 and build checkout (rejected for now: a separate ticket, and the page would stay false meanwhile); no price talk at all (rejected: "free during early access" sets the expectation honestly).

---

## ADR-042: A Visitor Sample Session Seeds Only an Empty Database and Leaves Nothing Behind

**Status**: Active
**Date**: 2026-10-12
**Context**: MUT-78 (epic MUT-74), brief L8, approved by Basel 2026-10-11. The landing page sent visitors to the internal demo tool (`/app?demo=1`): a Welcome dialog over an Activate Demo Mode dialog, then an empty Clients list. The demo tool also switches optional areas on and announces them as "your existing data", and leaves its data in place until someone resets it.

**Decision**:
1. **Entry**: the landing page's web-app link is `/app/clients?sample=1`. `enterVisitorSample()` seeds the sample (the same generator as the internal demo, `announceFeatures: false`) **only when the database has none of the person's own clients, projects, entries, expenses or documents**; an empty business profile (e.g. from "Skip for now") doesn't count. Otherwise it changes nothing and the app opens on their data.
2. **Session**: a `localStorage` record (`mutaba3a-sample-session`) holds the sample business it opened on, the optional areas the seed switched on, and `startedAt`. A second visit with a live session reuses the sample; a session whose sample rows are gone is dropped and the sample seeds again.
3. **Opening**: the sample business with the most clients owing is selected; no dialog opens (the Welcome dialog waits while the sample is prepared); one in-flow bar says it is sample data.
4. **Leaving** ("Start with your own"): remove every `demo_` row **and every row created after `startedAt`** in the session tables (business profiles, clients, projects, entries, payment records, expenses, documents, retainers) — the database held none of the person's data when the session began, so anything newer was added while looking around. Rows with an older `createdAt` (a restored backup) survive. Switch off exactly the areas the sample switched on. If the visitor added anything, the bar asks first and names the count; otherwise it leaves in one tap. Then the first run.
5. The internal demo (`?demo=1`) keeps its own behaviour.

**Consequences**: The sample can never mix with real data on entry, and leaving restores a first-run database. A visitor who types real data into the sample and then chooses "Start with your own" is warned that it goes too. Importing a backup during a session keeps the backup's rows on leaving.

**Alternatives Considered**: start empty with the sample optional (rejected by Basel: an empty app doesn't show the value the page just promised); keep the demo flow and fix its bugs (rejected: an internal tool's confirm dialog as a visitor's first sight); delete only `demo_` rows on leaving (rejected: rows the visitor added to a sample business would be orphaned on a profile that no longer exists).

---

## ADR-043: Deploys Go Through `make`, Which Refuses to Release From a Tree That Does Not Describe Itself

**Status**: Active
**Date**: 2026-10-12
**Context**: Requested by Basel. The two rollouts had no common front door. The web deploy lived in `deploy.sh`'s interactive menu as `deploy_web`, which ran `git add .` — committing whatever happened to be dirty under a "Release vX (web)" message — and always incremented the patch. The server deploy was `server/scripts/deploy.sh`, correct but only reachable by remembering to export `GCP_PROJECT_ID` and `TF_STATE_BUCKET` first. Nothing checked that the branch was `main`, that parked worktrees and unmerged branches were not quietly excluded from the release, or that `node_modules` matched the lockfile. The project habitually keeps one worktree per epic and several unpushed commits on local `main`, so "what is actually in this release" is a real question, not a theoretical one.

**Decision**:
1. **`make release web`** and **`make release server`** are the two entry points. A root `Makefile` owns the ordering; it does not reimplement any rollout. `server/scripts/deploy.sh` still performs the server rollout, and the app-version write still comes from `deploy.sh`'s `update_version`, sourced rather than copied.
2. **`scripts/preflight.sh <web|server>` runs first and is the gate.** It fails the release — before anything is built, committed, pushed or rolled — on: a merge/rebase in progress or conflicted files; not on the release branch; an unclean working tree; a local branch not merged into it; an extra worktree still checked out; being behind `origin`; a `node` major other than 22 (TD-054); `node_modules` staler than `package-lock.json`. Per target it also checks the deploy mechanism and credentials: `netlify.toml` and push access for web; gcloud + ADC, docker daemon, terraform, cloud-sql-proxy, the state bucket's readability and the tfvars file for server. Every escape hatch is a named variable (`ALLOW_DIRTY`, `ALLOW_UNMERGED`, `ALLOW_WORKTREES`, `ALLOW_NODE_MAJOR`, `SKIP_REMOTE`), so overriding a check is a deliberate, visible act.
3. **The version is asked for, never assumed.** `scripts/bump-version.sh` prompts patch / minor / major / custom / keep, showing the resulting number for each. The app bump moves `package.json`, `package-lock.json`, `tauri.conf.json`, `Cargo.toml` and `Cargo.lock` together — the lock included, because the web release never builds Rust and a drifting lock is what broke v0.0.65's Windows build.
4. **Where the server deploy points is derived, then verified.** `GCP_PROJECT_ID` defaults to `project_id` in `<environment>.tfvars` and `TF_STATE_BUCKET` to the backend of the last `terraform init`; preflight re-derives both and fails on a project mismatch. `deploy.env` (git-ignored, template committed) is for overriding, not for first-time setup.
5. **The release commit names only the release.** `git add` lists the version files explicitly; it is never `git add .`. The gates (lint, typecheck, tests, openapi/API-type contracts, build, bundle guard) run before the irreversible step, and a single confirmation — which fails closed when there is no terminal — stands in front of the push or the roll.

**Consequences**: A release cannot be cut from a tree that does not describe itself, and both deploys answer the same questions in the same order. Parked epic worktrees now block a release until removed or explicitly allowed, which is the point — their work is not in it. `make release web` immediately exposed TD-057. Desktop (DMG, notarization, GitHub release) stays with `npm run release`; folding it in is a later decision.

**Alternatives Considered**: npm scripts instead of a Makefile (rejected: `package.json` is the frontend's, and the server deploy is not a frontend concern); extend `deploy.sh`'s menu (rejected: its `git add .` and fixed patch bump are the behaviour being replaced, and the file already carries the desktop pipeline); checks inside each `deploy.sh` (rejected: the two would drift, and the checks are most useful before `make` even starts a build).

---

## ADR-044: Drawers Move on Springs; a Close Is Immediate and Its Exit Is a Snapshot; `motion` Is a Dependency

**Status**: Active
**Date**: 2026-10-12
**Numbering**: ADR-043 was taken on main (release front door) while this ticket was in flight.
**Context**: MUT-80 (epic MUT-74), brief `.claude/designs/landing-apple-redesign.md` R2 (and HP1: the hosted portal inherits it), approved by Basel 2026-10-11. The shared drawer slid in on a CSS keyframe and had no exit: on Cancel, Escape or Save it vanished in one frame. It could not be dragged or caught mid-motion, and it had no focus trap. Callers close drawers by resetting a store (`{ isOpen: false, mode: 'create' }`), which unmounts the drawer at once.

**Decision**:
1. **One shared frame.** `DrawerFrame` (`src/components/ui/drawer/`) holds the shell, motion, drag and focus behaviour. The local `Drawer` and the hosted portal's `Drawer` are thin wrappers. The portal may import `components/ui` but not `components/drawers`.
2. **A close is immediate; the exit is presentation.** `onClose` stays synchronous (Escape, ✕, overlay), and callers keep unmounting whenever they like. When a visible drawer unmounts, it clones its overlay and panel, with the typed values, picked options and scroll positions copied. The clone is `inert` and `aria-hidden` with `pointer-events: none`. It springs out along the drawer's own edge from the live position and velocity, and is then removed. A microtask checks that the original really left the document, which skips StrictMode's rehearsal.
3. **Drag to dismiss is the one live exit.** After 10px a horizontal press becomes a 1:1 drag (`setPointerCapture`; grab point kept; rubber band past open, constant 0.55); a vertical one leaves the gesture to scrolling. On release, momentum is projected (`(v/1000)·0.998/(1−0.998)`) and past half the width dismisses. The drawer itself commits a drag dismiss: it springs out with the release velocity and calls `onClose` once off-screen, so a press mid-exit catches it from where it is. Drags don't start on form fields, editable content, horizontally scrolling regions or `[data-drawer-no-drag]`.
4. **Springs.** Apple's response/damping ratio map to stiffness `(2π/response)²` and damping `4πζ/response` at mass 1. Every drawer move is response 0.3 and damping 1.0: an overshoot would pull the panel off its screen edge.
5. **Reduced motion.** Moves become 150ms opacity cross-fades, while a drag still tracks the person's own pointer. **No layout, no motion:** a panel with no width (jsdom, not rendered) neither enters nor leaves a snapshot.
6. **Focus.** The trigger is the element focused when the drawer first renders. On mount, focus moves to the dialog unless a field autofocused. Tab and Shift+Tab wrap at the ends (a keydown handler on the panel, so a modal opened on top keeps its focus). On a real unmount, focus returns to the trigger unless something else has taken it.
7. **`motion@13.4.4`, pinned exactly** (the newest release at least two weeks old on 2026-10-12). Only the vanilla `animate` and `motionValue` are used, never the `motion.div` component, and styles are written imperatively from motion values. Web build cost: the entry chunk grows from 193.93 to 216.51 kB gzip (+22.6 kB); `npm run test:bundles` passes.

**Consequences**: Every drawer, present and future, gets the motion without changes at its call site, and no exit can show reset or reloading content. A close by Save, Cancel or Escape cannot be caught: the record is already saved and the store already closed. The panel carries no inline `transform` at rest, so `position: fixed` descendants keep the viewport as their containing block. Generic physics (`src/lib/motion/physics.ts`) is ready for the payment and after-save stories.

**Alternatives Considered**: keep the live tree mounted for its exit (AnimatePresence) — rejected: every store resets on close, so the exiting drawer re-renders with reset state (an edit title turning into "New", a deleted record into a loading state), and each mount site would need wrapping; make Escape/✕/overlay closes interruptible by deferring `onClose` until the exit ends — rejected: the store would say "open" for 300ms, and a shortcut that reopens a drawer in that window would be closed by the late `onClose`; CSS-only exit — rejected in the brief (no drag, not interruptible); hand-written spring integrator — rejected in the brief in favour of `motion`, which the payment and after-save stories reuse.

---

## ADR-047: The Record Payment Drawer Has One Action, and It Closes the Drawer; Mark Fully Paid Is Removed (Supersedes ADR-038 §5)

**Status**: Active
**Date**: 2026-10-12
**Context**: MUT-86 (epic MUT-74). Brief: `.claude/designs/landing-apple-redesign.md`, decision P1, approved by Basel 2026-10-11. Test plan: `.claude/designs/mut-86-payment-drawer-tests.md`.

`PartialPaymentDrawer` had two footer actions for one outcome. "Mark Fully Paid" recorded the remaining balance, exactly as Record Payment did with its prefilled amount, but it dropped anything typed in Notes. ADR-038 §5 had lifted the date into the drawer only so that this shortcut could use it. The two buttons also ended differently: Mark Fully Paid closed the drawer, while Record Payment cleared the form and stayed open on an empty amount. Separately, an edit opened before the entry's records had loaded mounted as a create form under the title "Edit Payment", so pressing its button recorded a second payment.

**Decision**:
1. **One primary action.** The footer is Cancel and Record Payment (Update Payment when editing). Mark Fully Paid and its `markFullyPaid` key are removed. ADR-038 §5 is superseded, and the date state moves back into the form. Settling in full stays one confirm, because the amount is prefilled with the remaining balance (MUT-6, ADR-038 §4).
2. **A save closes the drawer**, whether the payment settles the entry or not. H1 (the Home row slides out on save) and R1 (show where it landed) both need the drawer closed afterwards. Update still returns to the entry's create view, as before.
3. **The live line and the field errors read one classification.** `describePaymentAmount` (`src/lib/paymentEntry.ts`) uses MUT-5's strict parser. The answer ("Paid in full", "₪1,775 still owed") and an overpayment show as the user types. Unreadable text, zero, or another currency's symbol show only after Record is pressed, so a half-typed "1,2" never nags. The repository stays the source of truth (ADR-030, ADR-038). The drawer checks first only to say why in the user's language.
4. **The drawer and the repository share one future-date rule.** `isFuturePaymentDate` moves unchanged from `repository.ts` to `lib/dates.ts` and takes an optional `today`. An emptied date is refused too, with `validation.dateRequired`.
5. **An edit waits for its record.** While an edit is requested and the records are still loading, the drawer shows its spinner, and the form is keyed on the found record.
6. **Nothing to record means no form.** With nothing left in create mode, the drawer says "Paid in full", lists the history and offers Close.

**Consequences**:
- The landing page's "Paid? Two taps." stays true: open, then Record Payment, with today's date.
- Notes are never lost on the way to a full payment.
- MUT-82 opens the drawer as it is today and gets the remaining amount and today's date. Its Undo needs the created record. `useCreatePaymentRecord` already returns it, and an `onRecorded` callback can pass it out at that point.
- After Update Payment, the drawer lands on the entry's create view, which is one tap from recording another payment. That was true before, but the prefilled single button makes it more prominent. It is a follow-up, not part of this decision.

**Alternatives Considered**:
- Keep Mark Fully Paid and pass the notes to it (rejected): two buttons for one outcome is the defect P1 names.
- Keep the drawer open after a partial payment so the history updates (rejected): H1 and R1 show the result where it landed, not inside the drawer.
- Show every amount error live (rejected): grouped amounts pass through unreadable states while they are being typed.

---

## ADR-048: The Unsorted Inbox Is Owned by the User, and Filing Is One Cross-Repository Transaction

**Status**: Active
**Date**: 2026-10-12
**Numbering**: drafted as ADR-044; renumbered on merge because MUT-80 took 044 and MUT-86 took 047 while this ticket was in flight.
**Context**: MUT-66. Capture has to be able to outrun the decision "which business is this for?" — that stall is the thing most likely to break MUT-63's "log it in seconds" promise. But every hosted row in this schema — `Customer`, `Project`, `Expense`, and since MUT-65 `Payment`/`Receivable` — hangs off an `Organization`, and the whole request pipeline (`X-Mutaba3a-Profile` resolution, the per-profile writability guard, every `WHERE organizationId = ?`) assumes an organization is resolved before a repository call happens. There was structurally nowhere to put money that has no organization yet.

**Decision**:
1. **`InboxEntry` is owned by `User` and carries no `organizationId` and no FK to `Organization` or `Membership`.** It is the first user-owned row shape server-side. The absence is the feature, not an omission: revoking a user's last membership cannot cascade into their inbox because there is no edge to cascade along, so the ticket's "removing a user's last membership does not delete their inbox" is true by construction rather than by a guard or a cleanup job. A DMMF test fails if a later edit adds such a column.
2. **The coarse capture `kind` (`INCOME`/`EXPENSE`) is not MUT-65's `received`/`owed`.** The finer distinction only means something once a client is — or deliberately is not — in the picture, and an unsorted entry never carries one. So Received/Owed, and every `customerId`/`projectId`/`title`/`dueDate`, are supplied at filing time. `kind` itself is fixed at capture, the convention `Expense.currency` already uses.
3. **Capture does not reject a future date; filing applies whatever the destination route already applies — no more.** "Later than today" is only answerable in some organization's timezone, and capture has no organization, so the question is deferred to filing. At filing it is answered by the *destination's own existing rule*: `POST /v1/income` refuses a future date (MUT-65's `assertNotFuture`), so `file-as-income` does; `POST /v1/expenses` has never had such a check, so `file-as-expense` does not. The brief assumed MUT-42 had one and it does not — found during MUT-66's reconciliation. Filing is deliberately not made stricter than the door beside it: the same expense must not be accepted directly and refused through the inbox. Whether `POST /v1/expenses` *should* reject future dates is a separate question against MUT-42, not something for this ticket to decide by side effect. ADR-022's history is a record of what guessing a timezone costs.
4. **Filing is two routes, not one.** `requireScope` is a static per-route declaration (ADR-037 decision 5); the scope a filing needs (`expenses:write` vs `payments:write`) depends on the entry's own kind, which is only known after loading it. A single route would need a scope resolved from request content, which is exactly what MUT-38/39 built this discipline to avoid. Calling the wrong one is `409 ENTRY_KIND_MISMATCH`.
5. **The two `file*` repository methods are the store's only cross-repository transactions.** The entry is *claimed* by a delete inside the transaction — which proves ownership and kind and holds the row lock until commit — before the financial row is written. Two concurrent filings of one entry therefore produce exactly one record, and a financial write that throws rolls the delete back with it. The memory store simulates this by removing the entry synchronously before any await and restoring it on failure.
6. **Filing keeps the existing `{ write: Domain }` guard classification of the record it creates**, while plain capture gets a new `'sessionOnly'` `MethodAccess` case — the first that is neither "any principal" nor a per-organization domain. This is what makes both writability ACs true with no inbox-specific logic: filing as an expense lands on any profile the person belongs to (expenses is profile-independent), filing as income is refused `READ_ONLY_PROFILE` on a Malafat-fed one (payments is one of MUT-65's three profile-dependent rows). No new `Domain` and no new scope were minted.
7. **The four CRUD routes declare no scope and name no profile**, joining `ORGANIZATION_INDEPENDENT_ROUTES` beside `GET /v1/me`. Adding an `inbox` `Domain` was rejected: `GET /v1/me` emits `access` per hosted profile, so every profile would carry an identical redundant `inbox` entry for a resource that is not profile-scoped at all.
8. **No `Idempotency-Key` on capture; both filing routes require one.** Filing is organization-scoped, so the existing `idempotency_keys` table and its session namespacing apply unmodified. Capture has no `auth.organization` to key under, and nothing in the AC asks for it — a scoped, deliberate departure from ADR-025 decision 5, which was written for the organization-scoped ledger. `POST /v1/sessions` and the `/admin/v1/users*` routes are the existing precedent.

**Consequences**: MUT-68 and MUT-69 are unblocked — the keypad has an "unsorted" target to save to and a list to file from. The inbox is invisible to every summary by construction (no summary module references the table), asserted both behaviourally and by reading the sources. `countByUser` gives support a per-user figure without ever listing contents. `ExpenseRepository.create`'s row insert moved into `createExpenseRow(tx, …)` so it can be composed; MUT-65's `createPaymentTx`/`createAdjustmentTx` were already built for this and are reused unchanged.

**Alternatives Considered**: a nullable `organizationId` on `Expense`/`Payment`/`Receivable` (rejected: MUT-65 loosened *client/matter* columns, which keeps the row inside an organization; teaching every reader of a ledger table to handle a null organization is a far larger and riskier change, and it reintroduces the FK that must be absent for the membership AC to hold structurally); keying the table `(userId, organizationId?)` (rejected for the same reason one level down); one filing route with a content-derived scope (rejected, decision 4); an `inbox` matrix domain (rejected, decision 7).

