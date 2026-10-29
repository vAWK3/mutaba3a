# DECISIONS.md — Architectural Decision Records

> **Purpose**: Document all significant architectural and technical decisions.
> **Rule**: Never contradict a decision without explicit override (with date, reason, and replacement).

---

## Decision Index

| ID | Title | Status | Date |
|----|-------|--------|------|
| ADR-001 | Offline-First with IndexedDB | Retired with the local app by ADR-203 (2026-10-26) | 2024-01 |
| ADR-002 | Repository Pattern for Storage Abstraction | Retired with the local app by ADR-203 (2026-10-26) | 2024-01 |
| ADR-003 | Drawer-First UX Pattern | Active | 2024-01 |
| ADR-004 | Multi-Currency as First-Class Citizen | Active | 2024-01 |
| ADR-005 | No Server Backend for MVP | Active | 2024-01 |
| ADR-006 | TanStack Query for Data Fetching | Active | 2024-02 |
| ADR-007 | Zustand for UI State | Active | 2024-02 |
| ADR-008 | URL-Driven Drawer State | Active | 2024-02 |
| ADR-009 | Amounts in Minor Units (Cents) | Active | 2024-02 |
| ADR-010 | Receivable as Transaction Status | Active | 2024-02 |
| ADR-011 | Hybrid Logical Clock for Sync | Superseded by ADR-053 (2026-10-12) | 2024-06 |
| ADR-012 | Operation Log (CRDT-like) for Sync | Superseded by ADR-053 (2026-10-12) | 2024-06 |
| ADR-013 | Local-Only Sync (LAN + File Bundle) | Superseded by ADR-053 (2026-10-12) | 2024-06 |
| ADR-014 | Document Immutability After Export | Active | 2024-08 |
| ADR-015 | Profile-Scoped Expenses | Active | 2024-09 |
| ADR-016 | Tauri for Desktop Distribution | Superseded by ADR-203 (2026-10-26) | 2024-03 |
| ADR-017 | React 19 with TypeScript Strict | Active | 2025-01 |
| ADR-018 | CSS Variables for Theming | Active; amended by ADR-058 (Brand v2, 2026-10-12) | 2024-03 |
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
| ADR-029 | Removing a Feature's UI Never Removes Its Tables (overridden by ADR-053 for the eight sync tables only) | Active | 2026-10 |
| ADR-030 | Overpayment Is Rejected; Locked Transactions Still Accept Payments | Active | 2026-10 |
| ADR-031 | The Updater Signing Key BEDF931CA1D6C777 Is Canonical; a Rotation Ships the New Public Key Before Signing Switches | Superseded by ADR-203 (2026-10-26) | 2026-10 |
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
| ADR-043 | Deploys Go Through `make`, Which Refuses to Release From a Tree That Does Not Describe Itself | Active; 2026-10-12 server-first addendum overridden by ADR-102 (2026-10-19) | 2026-10 |
| ADR-044 | Drawers Move on Springs; a Close Is Immediate and Its Exit Is a Snapshot; `motion` Is a Dependency | Active | 2026-10 |
| ADR-047 | The Record Payment Drawer Has One Action, and It Closes the Drawer; Mark Fully Paid Is Removed (Supersedes ADR-038 §5) | Active | 2026-10 |
| ADR-048 | The Unsorted Inbox Is Owned by the User, and Filing Is One Cross-Repository Transaction | Active | 2026-10 |
| ADR-049 | Each Business's Clients List Counts Only That Business's Entries; Its Owed Now Equals Home's, With "No Client" and "Archived Clients" Rows | Active | 2026-10 |
| ADR-050 | On a Wide Window a Client Opens Beside the Clients List; the URL Stays /clients/:id; Arrows Walk Clients by Visual Direction and the Walk Replaces History | Active | 2026-10 |
| ADR-051 | "All Businesses" Is a Lens on Home and Clients Only; Every Other Screen Works in One Concrete Business (Overrides the Unrecorded April Strict Mode) | Active | 2026-10 |
| ADR-052 | Expenses Needs Attention Is One Row per Recurring Rule; Marking Several Payments Paid Is One All-or-Nothing Write, Each Dated on Its Expected Date | Active | 2026-10 |
| ADR-053 | Device-to-Device Sync Is Retired; Local↔Hosted Sync Is Off the Roadmap (Supersedes ADR-011, ADR-012, ADR-013; Narrow Override of ADR-029) | Active | 2026-10 |
| ADR-058 | Brand v2: `--m-*` Primitives From the Token JSON and One Semantic Map in theme.css; Light Text Clears 7:1; Thmanyah Is Bundled Unmodified (Amends ADR-018) | Active | 2026-10 |
| ADR-069 | Import Writes Expenses Through expenseRepo; a Legacy kind:'expense' Transaction Gets Its Own Minimal Edit Drawer, Not IncomeDrawer | Active | 2026-10 |
| ADR-070 | Hosted Conversions Are Their Own Prisma Model, Create + Read Only, Behind New Hosted-Only UI | Active; §2 superseded by ADR-075 (2026-10-14) | 2026-10 |
| ADR-075 | A Conversion Is Edited With If-Match and Soft-Deleted, Like an Expense; Malafat's Audit Feed Never Lists It (Supersedes ADR-070 §2) | Active | 2026-10 |
| ADR-088 | Operator-Issued One-Time Setup Links Replace Printed Passwords; the Only Public Account Routes Are Sign-In and Redeeming a Link (Partial Override of ADR-037 §1) | Active | 2026-10 |
| ADR-097 | One App — Signed Out, the Portal Runs the Server's Own Routes in the Browser over a Persisted MemoryLedgerStore (Partial Override of ADR-037 §2; Overrides MUT-185 Decision 1) | Active | 2026-10 |
| ADR-099 | Firm Books — Firms Are Flagged Organizations With Roles, Approval, Bills and a Month Lock; Receipts Are Read on the Device (Partial Overrides of ADR-037 Decision 1 and Its MUT-182 Amendment, MUT-252 Decision 5, Minimize-to-Core Decision 3) | Active | 2026-10 |
| ADR-203 | MTB3A Is iOS, Android and the Web Portal: the Desktop Apps and the Free Web App at /app Are Retired (MUT-445) | Active | 2026-10 |

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

**Status**: Superseded by ADR-053 (2026-10-12, MUT-73). The clock existed only to order sync operations; it was deleted with them. Text kept for history.
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

**Status**: Superseded by ADR-053 (2026-10-12, MUT-73). The op-log, its writers and its Dexie table are gone. Text kept for history.
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

**Status**: Superseded by ADR-053 (2026-10-12, MUT-73). Device-to-device sync is retired product-wide, and local↔hosted sync is off the roadmap. Text kept for history.
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

**Status**: Superseded by ADR-067 (MUT-145, 2026-10-13): document generation is retired and no entry is locked any more
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

**Status**: Active; amended by ADR-058 (2026-10-12)
**Date**: 2024-03
**Updated**: 2026-02 (canonical token naming clarified)

> **Amended by ADR-058 (Brand v2, MUT-102).** `theme.css` is still the one token file and the names below still hold, but its colours, faces, sizes and radii now come from the `--m-*` primitives in `src/styles/brand/`, mapped once rather than in four copies; light text clears 7:1 (AAA), not AA. The `index.css` legacy `--color-*` note below is stale: those names are defined nowhere, and the references left are in `brand.test.ts`'s dead-reference allowlist for MUT-103. The implementation snippet shows the pre-Brand-v2 values.
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

The superseded ADRs keep their text in place, so numbers and links stay stable; each one's **Status** line names its replacement.

| ADR | Superseded by | Date | Reason |
|---|---|---|---|
| ADR-011 Hybrid Logical Clock for Sync | ADR-053 | 2026-10-12 | Device sync retired (MUT-73); the clock had no other user |
| ADR-012 Operation Log (CRDT-like) for Sync | ADR-053 | 2026-10-12 | Device sync retired; the op-log and its table were dropped (Dexie v21) |
| ADR-013 Local-Only Sync (LAN + File Bundle) | ADR-053 | 2026-10-12 | Device sync retired product-wide; local↔hosted sync is off the roadmap |
| ADR-070 §2 (and §5's create-only drawer, no JOD) | ADR-075 | 2026-10-14 | MUT-194: a mistaken conversion is fixed or removed, not reversed with a second entry |
| ADR-037 §1, "no … password-reset route" and operator-delivered passwords only | ADR-088 | 2026-10-16 | MUT-235: the operator issues a one-time setup link; the person sets their own password through one public route |
| ADR-037 §2, "no IndexedDB in the portal", no local profiles in the portal, no service worker (brief §2, §7.5) | ADR-097 | 2026-10-18 | MUT-284/285: one app; signed out, the portal keeps local profiles in IndexedDB and runs the server's own routes in the browser |
| MUT-185 epic decision 1, "the local web app stays on the mutaba3a.netlify.app origin" (Jira, not an ADR) | ADR-097 | 2026-10-18 | MUT-284: the app lives at the portal's origin; netlify keeps the landing page and the data-handoff bridge (MUT-291) |
| Minimize-to-core decision 3, "expenses are optional, not core" (MUT-1 intake, not an ADR), for firm profiles only | ADR-099 | 2026-10-19 | MUT-298: on a firm, expenses, vendors and bills are core; personal and freelancer profiles keep expenses optional |
| MUT-252 decision 5, "the portal does not auto-read receipts" (Jira, not an ADR), for firm profiles | ADR-099 | 2026-10-19 | MUT-298: the portal reads PDF text, QR codes and photos on the user's device; no server or LLM reading |
| ADR-037 decision 1, "no signup, invite or password-reset route" (the invite part) | ADR-099 | 2026-10-19 | MUT-306: a firm owner invites by email; the link goes only to the invitee, who accepts as that email |
| ADR-037 MUT-182 amendment, "an owned profile is never granted to or provisioned into another user" | ADR-099 | 2026-10-19 | MUT-300: an operator may convert an owned Business profile into a firm (ownership moves to an OWNER role). **Withdrawn 2026-10-20** (MUT-300 D4: firm features in place, no conversion; sharing decided in v3) |
| MUT-298 intake decision 6, "the invite always yields a copyable link" (Jira, not an ADR) | ADR-099 | 2026-10-19 | MUT-299 D10: the link goes only to the invited email; the owner never sees it |
| ADR-099 §8, "there is no server … reading" (the server part), and MUT-252's on-device-only reading | ADR-199 | 2026-10-26 | MUT-253: on-device engines miss some fields (Android Arabic dates, the browser); our own server re-reads the stored original with self-hosted OCR to fill only the empty fields. No LLM, no third party |
| ADR-199 §1, "the device reads first, always" (the server only fills what the device left empty), and its consequence "the volume is bounded by misses" | ADR-220 | 2026-10-28 | MUT-441, Basel: the server reads every uploaded receipt that has no suggestion yet, for the phone and the portal; device readers (MUT-256, MUT-304) become optional and are decided after it ships. Still self-hosted, no LLM, no third party; fill-absent kept |

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

> **Note (2026-10-12, ADR-053).** Cloud sync will not ship: ADR-053 retired
> device sync and took local↔hosted sync off the roadmap. The OAuth client this
> ADR governs survives, moved to `src/services/oauth/` and
> `src-tauri/src/oauth/`; it has no caller yet (TD-075).

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
  *(Note 2026-10-12: ADR-053 superseded ADR-013 and took local↔hosted sync off
  the roadmap, so that separate ADR will not be written.)*
- **Firm data on the hosted service** is privileged client financial data and
  must be encrypted at rest, regionally resident beside the firm's CRM (GCP
  me-west1, matching Malafat), backed up, and deletable on request.
  *(Note 2026-10-21: "encrypted at rest" with our own key is ADR-164, MUT-381;
  before it, only Google's default encryption.)*

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

**Override note 2026-10-12 — MUT-73 / ADR-053: the eight sync tables drop.**
ADR-053 overrides §1 for `localDevice`, `trustedPeers`, `opLog`, `peerCursors`,
`entityFieldMeta`, `moneyEventVersions`, `conflictQueue` and `syncHistory` only
(Dexie v21), because they hold sync bookkeeping, not user records, and no
shipped screen could open the two record-like ones. The reasoning and the
migration test that replaces §3's retention test are in ADR-053. The note
above is history: `moneyEventVersions` went with the other seven, and
`noSyncModules.test.ts` now asserts it is gone. Every other table remains
under §1.

---

## ADR-030: Overpayment Is Rejected; Locked Transactions Still Accept Payments

**Date**: 2026-10-10
**Status**: Accepted (§1 overpayment stands; §2 locked transactions is moot since ADR-067 removed the lock)
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

**Status**: Active, narrowly overridden by ADR-067: the `invoices` area is retired, five areas remain
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
   or adds rows after the upgrade has already run. *(2026-10-12: sync-bundle
   import was deleted with device sync, ADR-053; the other four remain.)*
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

   > **Override note (2026-10-16, ADR-088, MUT-235).** Accounts are still
   > created, granted, reset and disabled only by the operator, but the
   > operator no longer handles passwords. Creating a user or resetting one
   > issues a one-time setup link, and the person sets their own password
   > through the one public route that redeems it (`POST /v1/account-setup`,
   > plus `…/check`). Still no signup, invite or "forgot password" route:
   > `no-self-registration.test.ts` now pins the public operations to exactly
   > sign-in and that pair.
   >
   > **Override note (2026-10-16, MUT-237).** A signed-in person may also
   > change a password they already know, through `POST /v1/me/password` —
   > authenticated, not public, so it adds nothing to the public-operations
   > pin above and the route name carries no forbidden word
   > (`no-self-registration.test.ts`'s path check). Distinct from a "forgot
   > password" door: the current password is required and checked under the
   > same lockout a wrong sign-in attempt would trip (shared `SignInThrottle`,
   > keyed on the same normalised email). On success it revokes every other
   > session, web and device, keeping the caller's own live, and audits
   > `user.password_changed` (USER), distinct from `user.password_set` (the
   > setup-link path). The wrong-current-password refusal answers `403
   > CURRENT_PASSWORD_WRONG`, never `401`: the session is still valid, and a
   > 401 would trip the portal's generic session-expired handler
   > (`client.ts`'s `unauthorisedHandler`) and sign the person out mid-form.
   >
   > **Fix (2026-10-16, MUT-237 reopened by MUT-238's release QA).** The
   > session check compared `users.passwordChangedAt` with the session's
   > `createdAt`, so the kept session, created before the change, was refused
   > on its next request: on a real clock the caller was signed out too.
   > Sessions now carry `credentialsVerifiedAt`, which is set at sign-in and
   > backfilled from `createdAt`, and the check compares with it.
   > `changePassword` re-stamps only the kept session (same person, still
   > unrevoked) to the change's instant, inside the same `FOR NO KEY UPDATE`
   > transaction. Every other session, and any session a racing sign-in
   > inserts, keeps its sign-in instant and still fails the check, so §7a's
   > race reasoning is unchanged. `createdAt`, `idleExpiresAt` and
   > `absoluteExpiresAt` are untouched, so keeping a session never extends
   > its life. Migration `20261016180000_mut237_session_credentials_verified_at`.
   >
   > **Review fixes (2026-10-16, MUT-238's pre-landing review).** (a) The
   > session check reads the session and then the person in two queries, so a
   > concurrent request on the changing session could see the old stamp and
   > the new `passwordChangedAt` and revoke the kept session. A session that
   > looks stale is now read once more and revoked only if it still is: the
   > change stamps the kept session in the same transaction that moves
   > `passwordChangedAt`, so the re-read sees the stamp. (b) Two changes could
   > each verify the old password before either took the lock, and both
   > answered 204 with both callers signed out. `changePassword` now takes the
   > hash the route verified, and under the lock refuses with
   > `StateConflict('user', 'CREDENTIAL_CHANGED')` (writing nothing) when the
   > stored hash differs or the kept session is no longer the person's live
   > session. The route answers 403 `CURRENT_PASSWORD_WRONG`, which is true
   > (the old password no longer works), and does not count it toward the
   > lockout. This also closes TD-151. (c) `currentPassword` takes sign-in's
   > 1024-character ceiling. API 1.31.1-mut237; no status code or response
   > shape changed. Not done: rotating the kept session's token (TD-158).
2. **A hosted profile is `Membership × Organization`**, not a table. The
   client-side type is `ProfileSource = 'local' | 'hosted'`; the server only
   ever emits `hosted`. **Hosted profile data is a separate dataset from local
   profile data**: no shared ids, no hosted row in Dexie, no op in the op-log,
   no IndexedDB in the portal.

   > **Override note (2026-10-18, ADR-097, MUT-284/285).** "No IndexedDB in the
   > portal" no longer holds: signed out, the portal keeps local profiles in
   > IndexedDB and runs the server's own routes over a persisted
   > `MemoryLedgerStore`. Hosted and local data are still separate datasets,
   > with no shared ids, no hosted row stored locally and no sync.
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

> **Note (2026-10-12, ADR-053).** ADR-013 and the op-log are gone, and
> local↔hosted sync is off the roadmap, so "neither syncs to the other" is now
> permanent rather than a v1 deferral. TD-037 is resolved as moot.

> **Note (2026-10-14, MUT-188).** Decision 1 stands: no signup, invite or
> reset route exists. The portal's sign-in page may link **out** to the
> landing's public `/hosted` offer page ("No account? Request one"), whose
> address is a build-time value (`__HOSTED_OFFER_URL__` from
> `MUTABA3A_PUBLIC_ORIGIN`, the ADR-076 shape). Nothing links **in**:
> `HOSTED_RULES`, the no-self-registration test and the zero-links sign-in
> test are unchanged. `mut-43-auth-states.md` §4 and `hosted-portal.md`
> §7.6 carry the same amendment.

> **Override note (2026-10-20, ADR-159, MUT-331).** Decision 1's "no signup,
> invite or password-reset route" no longer holds for GA. Open signup
> (`POST /v1/signups`, behind `SELF_SIGNUP_ENABLED`) and self-service recovery
> (`POST /v1/account-recovery`) mail ADR-088 setup links. Only verified business
> domains are instant; the rest wait for operator approval. Operator issuance
> stays. Decision 4 (accounts are never revealed) is kept and extended to both
> routes.

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

**Amendment (MUT-61, 2026-10-12)**: decision 7 for the `payments` domain on Malafat-fed profiles. A person may record money they were handed (Received) on a Malafat-fed profile; Malafat allocates it. No write ever goes back into Malafat. Approved by the owner with `.claude/designs/mut-61-malafat-received-capture.md` (eng-reviewed; decisions D1–D4 there).
- *What changed*:
  - **A new matrix row, `capture`** (scope `capture:write`, session-only like `expenses`; API key `none`; session `read-write` on every hosted profile; writer of record USER; routes `/v1/income*`). Its entire write surface is two store methods: `payments.capture` (a POSTED payment, `origin CAPTURE`, and — by its input type — no allocations, replacement or reference) and `payments.undoCapture`. The `payments` row is **unchanged**: on a Malafat-fed profile Owed, settle, credits, allocations, `reverse` and inbox filing as income all stay `READ_ONLY_PROFILE`. Widening `payments` instead was rejected because it would have opened every one of those at once.
  - **`POST /v1/income` and `DELETE /v1/income/{id}` stand on `capture:write`.** What a profile then allows is `incomeCaptureRulesFor(writer)` (`income/compose.ts`): personal → MUT-65's rules; Malafat-fed → `{ received: true, owed: false, customer: 'linked-required' }`. Received there needs a client with a `MALAFAT`/`CUSTOMER` ExternalReference (422 `CUSTOMER_REQUIRED` / `CUSTOMER_NOT_LINKED`); Owed is refused as the payments row's write (`writeRefusal('payments', …)`, 403) before anything else, and the store guard on `receivables.createAdjustment` refuses it again below the route. `GET /v1/me` publishes the same rules per profile as `income`, so no client infers them from `writerOfRecord`.
  - **On ADR-048 decision 4** (no content-resolved route scope): the route's scope stays a static declaration; Owed's extra need is not a second scope picked from the body but a write in another domain, which is exactly what the store guard exists to check. ADR-048's filing split was about the *whole* write depending on the entry's kind; here the floor is fixed and the store guard does its job. Splitting `/v1/income` in two was rejected: it would break the MUT-68 outbox contract for a distinction the guard already enforces.
  - **`Payment.origin` (`INTEGRATION | CAPTURE`) and `Payment.captureSource`.** `origin` is the durable "a person, not Malafat" fact — `createdByUserId` is SetNull when a user goes, and `captureSource` is optional in the MUT-65 contract, so neither can carry it. The migration backfills `CAPTURE` wherever `createdByUserId` is set (MUT-65 income, MUT-66 filing, settle).
  - **Undo is one conditional write** (`UPDATE … WHERE origin = CAPTURE AND createdByUserId = me AND status = POSTED AND allocatedMinor = 0`). The old read-then-`reverse` could unwind an allocation Malafat made in between — `reverse` undoes allocations — the payment-side twin of the race e12a5c2 closed for Owed. Any allocation, full or partial, → 409 `ALREADY_ALLOCATED`.
  - **A captured `projectId` is a hint until the payment has allocations** (D2): `PaymentFilter.projectId` matches a payment's own `projectId` only while it has none; after that only its allocations say where the money went.
  - **The payment view gains** `origin`, `captureSource`, `allocationState`, `projectId` and `capturedBy { userId, displayName }` (D4, for MAL-1097's "who recorded it" — the firm's own staff, resolved once per distinct person on a page); `GET /v1/payments` gains `?origin=` and `?allocationState=` (POSTED only).
- *Why*: a lawyer handed cash could not log it at that moment on their firm's profile; the rule existed to prevent double-counting, and tagging + unallocated + Malafat-allocates prevents it without Mutaba3a ever calling Malafat.
- *What it replaces*: decision 7's "Malafat is the writer of record for payments" now reads "…except a person's own unallocated Received, which Malafat allocates". `customers`, `projects`, `agreements` and receivables stay read-only for sessions on Malafat-fed profiles.
- *Added in /review (2026-10-12)*:
  - **Undo is truthful about who reversed.** A capture the integration reversed answers 409 `REVERSED_BY_MALAFAT` on the person's undo. `already-reversed` (204) is only their own earlier undo, told apart by the reversal reason `capture_undo`, which the key's reverse route now refuses (422 `REASON_RESERVED`).
  - **A named matter fixes the currency on a Malafat-fed profile** (422 `CURRENCY_MISMATCH` with `projectCurrency`): Malafat allocates only within a payment's currency. A client-only capture is not checked, by choice.
  - **`CaptureSource` is registered as itself before routes mount.** The generator takes the first use it meets as the component, and a nullable response use had made the shared component — and so four request bodies — advertise null.
- *Found while building*: `GET /v1/payments?projectId=` lost its project filter from page 2 on — the cursor's `OR` replaced the project's `OR` when both were spread into one `where`. Every OR-shaped condition now goes in `AND` (PATTERNS.md).

**Amendment (MUT-120, 2026-10-12)**: every user is created with exactly one personal profile, explicitly marked. The plan was eng-reviewed (`/plan-eng-review`, D1 to D8) and the brief `.claude/designs/mut-120-personal-profile.md` was approved by the owner.
- *What changed*:
  - **`Organization.personalOwnerUserId` (nullable, `@unique`, FK users ON DELETE RESTRICT).** It is set on a user's one personal organization and null on every firm. The unique index *is* the one-per-user guarantee.
  - **`POST /admin/v1/users` creates the personal organization and its membership** in the same transaction as the user. It is named `Personal`/`شخصي` by locale, gets a random `personal-<uuid>` slug, and takes its currency and timezone from the request, else from the firm.
    - `organizationId` (the firm) becomes optional.
    - With no firm, `defaultCurrency` and `timezone` are required (422).
    - Decision 1 (operator-only accounts) is unchanged: there is still no signup.
  - **`HostedProfile.isPersonalDefault`** in `/v1/me` and the device-session payload, true only on the caller's own personal profile. Clients read it instead of inferring "personal" from `writerOfRecord == null`.
  - **A personal profile belongs to one person and to no external system.** These cases return `409 CONFLICT { reason: 'PERSONAL_PROFILE' }` (`errors.ts` `personalProfileConflict`):
    - granting it to another user;
    - creating a user inside it;
    - issuing it an API key;
    - binding it (`POST /v1/integration/bind`), refused defensively should a key exist.
    It reuses an existing code with a `details.reason` rather than a new code, because a new code is a contract change Malafat maps (`errors.ts:10-13`).
  - **No backfill.** There were no existing users at the time (owner, 2026-10-12).
    - *Superseded 2026-10-13*: one user was provisioned before MUT-120 reached production. `backfillPersonalProfiles` (`scripts/post-roll.ts`) now runs on every deploy (`deploy.sh` step 6). It gives each user lacking one a personal profile built the same way as at account creation. Currency and timezone come from their oldest firm. Users with no firm are skipped and printed.
- *Why*: the capture app (MUT-63) needs a writable default target on every account. Before this, personal income and expenses had nowhere to go unless an operator remembered to hand-build a second organization, and nothing stopped a "personal" org from later being bound to Malafat.
- *Override log*: `hosted-portal.md` §3 says "**Personal vs firm needs nothing new.** A personal hosted profile is an operator-provisioned organization with no Malafat integration and the user as its only member". That is superseded. Personal is now an explicit, unique, provisioning-created marker, not an inference from a missing integration. Writability is untouched: `sessionAccessFor(domain, null)` still decides read-write, and a personal org can never become `MALAFAT`-written, so the two agree by construction. This is still not the `Profile` table this ADR rejected (an "Alternatives" entry): it is one column on `Organization`, and the hosted profile is still the `Membership × Organization` projection.
- *What it replaces*: nothing structural. No new repository method, so no store-guard classification. `organizations.create` and `users.create` were already `operator`.
- *Added in pre-landing review (`/qa-reconcile` + `/review`, D1/D2/D3/D5, 2026-10-12)*:
  - **`/v1/me` order is a contract.** Firm profiles come in membership order, and the caller's personal profile comes last. Both memberships are created in the same instant, so before this the tie fell to random organization ids, and the portal (which opens `profiles[0]`) landed some firm users on their empty personal profile. QA reproduced this on Postgres.
  - **The personal profile's timezone must be an IANA zone** (422 otherwise). The org-create gap is TD-091.
  - **A user's own personal-profile membership cannot be revoked** (409 `PERSONAL_PROFILE`). This resolved TD-089.
  - **API-key authentication itself refuses a key on a personal profile** (409 `PERSONAL_PROFILE`), replacing the bind-only guard, so no key-authed route can reach personal books even through a key planted below the admin API.

**Amendment (MUT-133, 2026-10-14)**: the portal writes income, but only on the signed-in user's own personal profile. Approved by the owner with `.claude/designs/mut-133-portal-personal-income.md` (eng review D1–D5 and re-review R5, design review 1A–12A).
- *Decision*:
  - **One gate**, `incomeAffordancesFor(profile)` (`src/hosted/data/incomeAffordances.ts`): write affordances only when `isPersonalDefault`; Add income stands on `access.capture === 'read-write'` (POST /v1/income is `capture:write`) and Record payment on `access.payments === 'read-write'` plus `income.owed`. Within that, `profile.income` shapes the kinds. The published `income` rules alone are **not** the gate: a Malafat-fed profile has `received: true` since MUT-61, and the portal keeps it read-only; a writer-null firm is not personal (ADR-066).
  - **Two writes, no edits**: Add income (`POST /v1/income`, Received or Owed) and Record payment (`POST /v1/receivables/{id}/settle`, only on `origin: ADJUSTMENT` rows that are not PAID/VOID). No delete/edit, no Undo; MUT-91 owns Undo and row highlighting. A polite "Saved · …" status (an `info` toast in a persistent `aria-live` region) confirms every save, because the new row is often off screen.
  - **Record payment always sends the typed amount.** Omitting it lets the server settle whatever is outstanding at write time, which would silently record less than was received after a concurrent phone partial; the race is a 422 with the new figure instead.
  - **Pages own the drawers**: `?newIncome=received|owed` and `?settle=<id>` are parsed beside, never inside, a list's filters (`splitIncomeDrawer`), so they can't enter a list's query key (the MUT-44 e0ed4fd bug). Deep links are inert where the gate says no.
  - **Retry-safe writes everywhere in the portal**: the Idempotency-Key belongs to the save attempt (`useAttemptKey`), not the click — reused while the body is unchanged — and expenses and conversions adopt it too (D5).
  - **Dates use the profile's calendar** (`todayInZone(profile.timezone)`), matching the server's `assertNotFuture`.
  - **`ReadOnlyNotice` shows nothing on a writable personal profile**; the reworded phone-app sentence remains only as the fallback when the rules offer no income writes.
- *Why*: a freelancer on a personal profile could only log income from the phone; MUT-93 fixed the copy and deferred these affordances to this ticket.
- *Known limit*: a recorded payment cannot be reversed by any session (DELETE /v1/income refuses an allocated payment; personal profiles refuse API keys). The drawer says so; a correction path is a follow-up ticket (TD-126).

**Amendment (MUT-182, 2026-10-14) — a person may create their own standalone profiles.** Approved by the owner with `.claude/designs/mut-182-profile-management-api.md` (eng review D1–D5; epic MUT-181, owner comment 11494). *Overrides* decision 1's "organizations are operator-only" for one narrow case, and the MUT-39 as-built note that `organizations.create` is the only way an organization comes to exist.
- *Decision*:
  - **`POST /v1/profiles`** (session or device session; no `X-Mutaba3a-Profile`; `identityIdempotent`) creates an organization **owned** by the caller plus its membership. `PATCH /v1/profiles/{profileId}` renames it, changes its default currency (records keep their own) and its **type**; `GET /v1/profiles/{profileId}/type-change` previews a type change.
  - **Standalone only, never a Malafat organization** (owner ruling). An owned profile is refused at every door MUT-120 shut on the personal one — no API key issued or accepted (so `/v1/integration/bind` is unreachable), never granted to or provisioned into another user, never revoked from its owner — through one helper, `ownedProfileConflict`: `PERSONAL_PROFILE` on the built-in profile (MUT-120's published reason), `OWNED_PROFILE` on a created one. Malafat-integrated organizations stay operator-provisioned (`npm run provision` + key + bind).
  - **Ownership is a column, not a table** (decision 2 holds): `Organization.ownerUserId` (not unique; ≤ `MAX_OWNED_PROFILES` = 6 per user, the personal one counted, firms not) and `profileType` (`PERSONAL | BUSINESS`, set exactly when owned). `personalOwnerUserId` stays unique and keeps marking the account's built-in personal profile; the migration backfills it as owned + PERSONAL and a CHECK keeps it PERSONAL forever (D2: renamable, never retyped, 409 `DEFAULT_PERSONAL_PROFILE`).
  - **Type only picks the expense preset** (ADR-066 amendment). BUSINESS is not a firm, a tenant or a shared organization.
  - **Writability is unchanged on the server**: an owned profile has no Malafat writer, so MUT-65's writer-null rows already make it read-write. The portal's MUT-133 gate moves from `isPersonalDefault` to `owned`.
  - **Store guard**: the four new organization methods are `sessionOnly`; `organizations.create` stays `operator`. Decision 1's "no signup, invite or password-reset route" is untouched — `/v1/profiles` creates no account and grants nothing to anyone else (`no-self-registration.test.ts` still passes).
  - **`/v1/me`** publishes `owned`, `type`, `version` per profile and `limits`; order is firms, then created profiles (oldest first), then the personal profile last.
- *Why*: a freelancer with a second business had nowhere to record it without an operator.
- *Override log*: replaces "organizations are created only by `/admin` and the scripts" with "…except a person's own standalone profile, created by its owner's session". Date 2026-10-14; reason above; the operator path is unchanged for firms and Malafat tenants.
- *Superseded in part by ADR-163 (MUT-373, 2026-10-21)*: an owned **Business** profile may now be granted to a co-owner, by the operator, with `role: OWNER`; every other grant still refuses.
- *qa-reconcile (2026-10-14, owner answers D1–D7)*: (1) **ownership is `profileOwnerOf(org)` = `ownerUserId ?? personalOwnerUserId`** at every door — the old revision still writes unstamped personal profiles after the migration (the CHECKs pass on NULL by design), post-roll stamps them; (2) the owned-profile writes **audit inside their own transactions**, and a type change records the removed categories and every lost expense→category pair; (3) row locks are `FOR NO KEY UPDATE`, and a type change locks expense rows before category rows.

**Amendment (MUT-183, 2026-10-14) — the portal itself creates and edits owned profiles.** Approved by the owner with `.claude/designs/mut-183-portal-profile-management.md` (eng review D2–D10, design review Issues 1–12 and R1–R8). Builds on MUT-182's API; no server change.
- *Decision*:
  - **`ProfileSwitcher`** gets "+ New profile" (disabled + "N of M" at the cap) and "Manage profiles" below the profile list. The empty-state copy changes from "ask your operator" to "You don't have a profile yet", with a "+ New profile" action — the no-profile and no-session states no longer look alike.
  - **One drawer tree, URL-driven (ADR-008)**: `?newProfile=1` (create), `?manageProfiles=1` (list), `?editProfile=<id>` (one profile's edit pane) — never a route, so there is still no create page. The shell's keys are stripped at every page boundary (`omitShellOverlay`) and merged back on every page-driven search rewrite (`pickShellOverlay`; PATTERNS).
  - **Create** takes name/type/currency/timezone; type has no default and is required (a missed-default type was rejected — a type silently defaults to something the user didn't choose). The 201 response is written straight into the `/v1/me` cache so the new profile appears immediately, with a background refetch reconciling it.
  - **Edit** snapshots `version` at open (`If-Match`); a type change runs an inline confirm step against the server's uncategorized-expense-count preview (`GET /v1/profiles/{id}/type-change`) before sending the PATCH, and refetches expense categories after.
  - **Every create and edit attempt is Idempotency-Key scoped to the attempt**, reusing the key on a retry of the same body (D4/R6), consistent with MUT-133's rule.
- *Why*: MUT-182 shipped the API with no portal surface to use it — a freelancer could create a second business profile only by asking an operator.
- *Known limits, tracked, not built here*: no archive/delete for an owned profile (MUT-193); the portal doesn't remember the last-opened profile across sign-ins, so a newly created profile becomes `/`'s default landing rather than the personal one (MUT-198 / TODOS #14).

---

**Amendment (MUT-115, 2026-10-25)**: passkeys are a second sign-in method beside the password, never instead of it (ADR-159 decision 9: every account keeps a password). Three public operations join sign-in: `POST /v1/passkey-challenges`, `POST /v1/sessions/passkey` and `POST /v1/device-sessions/passkey`; none creates an account, invites anyone or resets a password, and `no-self-registration.test.ts` pins them. A passkey is added only by a signed-in person. A passkey sign-in shares the password's throttle, lockout, single 401 and same-origin rule, and its session is bound to the current password hash. See ADR-190.

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
the primitives themselves. *(2026-10-12: the sync wrapper was deleted with
device sync, ADR-053; the hooks now call `transactionRepo.markPaid` directly,
and `paymentRequestService` remains a caller.)* `src/hooks/useTransactionActions.ts` duplicates the
same dateless pattern this ADR fixes but has no production caller; left alone
here and logged as tech debt (TD-046) rather than deleted as a scope expansion
of a bug-fix ticket. *(2026-10-13, MUT-98: `useMarkIncomePaid` is deleted, not
kept — it had gained no caller since the 2026-10-12 note above, which is
exactly the divergent-path risk ADR-039 names. `useMarkTransactionPaid`
(`useQueries.ts`) stays, still called by `useTransactionActions.ts`.
`paymentRequestService.ts` calls `transactionRepo.markPaid` directly, not
through either hook — this ADR's "paymentRequestService remains a caller"
line above was imprecise about which primitive; `transactionRepo.markPaid`
itself is unaffected by this deletion either way.)*

**Alternatives Considered**: prompting for a date inline on the quick action
(rejected — grows a form into a menu item on four surfaces instead of reusing
the drawer that already has one); allowing future dates (rejected, see above);
deleting `markPaid`/`useMarkTransactionPaid` entirely now that the UI stops
calling them directly (rejected — both have other live callers outside this
ticket's scope: sync replay and the payment-request flow).

*(Amended 2026-10-12, MUT-5 final pass.)* "Future" means the payment's calendar day is after today. A date-only `paidAt` is compared as is. A full timestamp is future only when both its UTC date and its local date are after today (`isFuturePaymentDate` in `repository.ts`). Comparing only the UTC date rejected `new Date().toISOString()` in the evening west of UTC, which broke Mark paid and Record Payment there.

**Addendum (2026-10-12, MUT-65).** The same rule — a payment date is never later than today; backdating is accepted — is now also enforced server-side, on `server/`'s `POST /v1/income` (`occurredOn`) and `POST /v1/receivables/{id}/settle` (`paidAt`): `income/compose.ts`'s `assertNotFuture`. This is the same rule applied to a second surface, not a new decision. It is a genuinely new check, not a reuse of an existing one: `server/`'s own `POST /v1/payments` (Malafat's apiKey-only route) applies `assertNotAbsurdDate` to `receivedOn`, which only rejects a date more than ten years ahead (a typo-sized sanity ceiling) — it does not reject a merely-future date. The design brief for MUT-65 assumed otherwise and cited it as the reused check; verified against the actual code during implementation and corrected here rather than silently shipping a check that doesn't do what the brief said it does. `payments.ts`'s own `receivedOn` validation is unchanged by this correction.

**Override (2026-10-22, MUT-392, ADR-169).** For income `occurredOn` the rule above now applies to Received only: an Owed may be dated up to ten years ahead (`incomeMoneyDate`). Why: an Owed is work logged before its day, not money that moved. Settle's `paidAt`, payments and conversions keep this addendum unchanged.

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
- **The op log** (`syncedTransactionRepo.update`) logs the entry as stored: a payment field only when it really changed (refused or derived), every other requested field with the value written. *(2026-10-12: the op log and its wrapper were deleted with device sync, ADR-053; rules 1–3 live in `transactionRepo.update` and are unchanged.)*

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

**Addendum (2026-10-12)**: Added `make release full`, a third entry point that runs `release-server` then `release-web` as two ordinary prerequisites — server first, so the API a release ships is already live before the frontend that calls it goes out. It reimplements nothing: each half keeps its own preflight, gates, version bump and confirmation, and declining one does not block the other. Desktop stays excluded, per the decision above — raised and confirmed with Basel when `full` was requested, not reopened.

**Overridden (2026-10-19, ADR-102 override log)**: `make release full` now runs `release-web` then `release-server`; web ships the terms text the server release checks for.

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

---

## ADR-049: Each Business's Clients List Counts Only That Business's Entries; Its Owed Now Equals Home's, With "No Client" and "Archived Clients" Rows

**Status**: Active
**Date**: 2026-10-12
**Numbering**: ADR-043 to ADR-048 are reserved by the epic's parallel lanes; this lane holds ADR-049.
**Context**: MUT-83 (epic MUT-74), brief `.claude/designs/landing-apple-redesign.md` decision H2, approved by Basel 2026-10-11. Test plan: `.claude/designs/mut-83-owed-parity-tests.md`.

Home and the Clients list both show an **Owed now** block that looks the same, but they summed different things:
- **Home** (ADR-036 §5) sums every unpaid entry *recorded in* the business (`tx.profileId`).
- **The Clients list** (MUT-7) summed, for each live client *created in* the business (`client.profileId`), that client's unpaid entries *in every business*.

The audit found four kinds of debt behind the gap, not the two the ticket named:
- **D1**: an entry with no client.
- **D2**: an entry of an archived client.
- **D3**: an entry recorded here for a client created in another business. Clients are shared: the income drawer's client picker lists every business's clients.
- **D4**: an entry recorded in another business for a client created here.

Home counted D1 to D3; the Clients strip counted only D4.

**Owner decision (Basel, 2026-10-12, option A, over B "keep rows all-business" and C "a third 'other businesses' row")**: each business's Clients list counts only that business's entries.

**Decision**:
1. **One input set.** The Clients list reads the business's entries through `transactionRepo.list`, the read behind Home's Owed now. It splits them with `partitionOwedNow(entries, clients, today)` (`src/db/aggregations.ts`) into:
   - one group per live client;
   - **No client**: no `clientId`, or one whose client row is gone. `clientScopeOf` is the single definition, shared with the `/income` filter.
   - **Archived clients**.

   The strip's total is `summarizeOwedByCurrency` over the same entries, so it equals Home's per currency by construction. Every entry lands in exactly one part, so the rows add up to the strip (ADR-033 §2). The read is `clientSummaryRepo.listOwedIndex`, and Home is unchanged.
2. **Which clients are listed in business P**:
   - P's own live clients, as before, including ones with no entries;
   - plus live clients created in another business that have at least one entry recorded in P.

   Archived clients are never listed.
3. **Every column on a row counts only P's entries**: owed now, overdue and its oldest age, last payment, and last activity. **The client profile page stays all-businesses**, unchanged.
4. **Two muted rows** sit after every client, whatever the sort column or direction, and each shows only when non-zero:
   - "No client · N entries", where N counts entries with a balance;
   - "Archived clients · N", where N counts archived clients with a balance.

   They are not ranked by ADR-035, which still orders the real clients. Each shows Owed now and Overdue per currency.
5. **Each muted row opens the entries behind it**: `/income?client=none|archived` with status Unpaid over all time, because Owed now has no period. `/income`'s filters become one model mirrored to the URL (`src/lib/incomeSearch.ts`, `useIncomeFilters`), written with `replace`. With no parameters the page behaves as before. A chip names the client scope and clears it.
6. **A search** narrows the list to matching clients. The strip then sums what is listed and the muted rows hide, so parity is a property of the unsearched list.
7. **The helper takes entries and clients, not a business**, so the "All businesses" lens (MUT-89) can pass several businesses' entries in.

**Relation to other ADRs**:
- **ADR-036 is unchanged**: Home's rule is the one the Clients list now follows. Its §5 says the clients index strip "sums only the clients it lists, so the two can differ". That described the MUT-7 list before this ADR; this ADR replaces that description, and nothing in Home's rule.
- **ADR-033 §1** (one helper) and **ADR-035** (ordering the real clients) stand.

**Consequences**:
- For a shared client, a business's row can show less than the client's profile page, which adds up every business. That trade-off was accepted, and TD-065 tracks revisiting it with MUT-89.
- A client created in one business appears in the Clients list of every business where it has an entry.
- Archiving a client moves its debt from its row to Archived clients; the strip doesn't change.
- `clientSummaryRepo.list` keeps its all-business semantics for Insights and Reports.

**Alternatives Considered**:
- **B: keep rows all-business.** The strip would equal Home, but the rows would not add up to it for shared clients.
- **C: a third muted row**, "Clients from other businesses". It is not in the approved brief and hides a client that owes here behind a bucket.
- **Explain the gap on Home** (H2's rejected option).
- **A second query for the strip** (rejected by the ticket: two queries can drift).

---

## ADR-050: On a Wide Window a Client Opens Beside the Clients List; the URL Stays /clients/:id; Arrows Walk Clients by Visual Direction and the Walk Replaces History

**Status**: Active
**Date**: 2026-10-12
**Numbering**: the epic's parallel lanes reserve id ranges; this lane holds ADR-050.
**Context**: MUT-84 (epic MUT-74), brief `.claude/designs/landing-apple-redesign.md` decision C1, approved by Basel 2026-10-11 over "a full page that preserves place on Back" and "leave as is". Test plan: `.claude/designs/mut-84-clients-split-view-tests.md`.

`/clients` and `/clients/$clientId` were sibling routes. Opening a client unmounted the list and Back mounted it again, so working through who owes you was open, check, record, back, next, losing sight of the list each time. Each page rendered its own top bar. The list's search was a `useState`, and its sort was `useSortState`, which writes `?sort=&dir=` with `window.history.replaceState({}, …)` behind the router: the next router navigation rebuilt the URL from the router's own location and dropped the sort.

**Decision**:
1. **One layout route, same URLs.** `/clients` is a layout (`ClientsLayout`) with two children: the index (nothing beside the list) and `$clientId` (`ClientDetailPage`). Deep links, Home's rows, the sidebar and back/forward keep their URLs.
2. **Three arrangements of one tree.** The layout always renders the list pane, then the profile pane; only `data-layout` and `hidden` change:
   - `list`: no client open, the list alone, as before;
   - `split`: a client open on a window at least `BREAKPOINTS.clientsSplit` wide (`src/lib/breakpoints.ts`, 1280 px). The list narrows to a 360 px column (Client and Owed now; the strip and the other columns hide) and the profile takes the rest;
   - `profile`: a client open on a narrower window, the profile alone, as before. The list stays mounted, hidden.

   Resizing across the breakpoint changes attributes only, so it never remounts the profile. Switching clients never remounts the list, so its search, sort and scroll position stay. The columns use logical properties and flex order, so Arabic mirrors them: the list on the right, the profile on the left.
3. **The breakpoint is a named token in JS.** CSS media queries can't read custom properties, so `useIsSplitView()` reads `BREAKPOINTS.clientsSplit` through `matchMedia`, and the stylesheet keys off `data-layout`. The number is written once. 1280 px was measured: at 1200 px with the sidebar expanded, the profile's Work and Payments tables scrolled sideways; at 1280 px they fit.
4. **The layout owns the one top bar**: "Clients" on the list; the open client's name, the Clients breadcrumb and Edit when a client is open, at any width. `ClientDetailPage` renders the profile body only.
5. **The list's search and sort are one URL model** (`clientsSearch.ts`, `useClientsSearch`, the layout route's `validateSearch`), following the MUT-83 pattern. Writes use `replace` and keep the current path. Every client link and walk keeps them (`search: true`). `?sort=&dir=` keep their names, so older links keep their order. This page no longer uses `useSortState`.
6. **The keyboard, on a wide window only.** Arrows follow the screen, not the reading direction:
   - On a client row, ↑/↓ open the previous/next client. Focus moves to its row and the profile follows. The walk stops at either end.
   - Enter on the open client's row, or the arrow pointing at the profile (→ in English, ← in Arabic), moves focus into the profile pane (`role="region"`, "Client profile").
   - In the profile, Escape or the arrow pointing back (← in English, → in Arabic) returns focus to the open client's row. A key that belongs to a control is left alone: a text field, a select, anything inside an open menu, listbox, dialog, tablist, radiogroup or combobox, a button whose popup is open, or an event already handled. A held modifier is never taken (Alt+← is the browser's Back).
   - ↓ in the list's search box focuses the open client's row, or opens the first client.
   - On a narrow window the keys do what they did before.
7. **History.** The first client opened from the list adds a history entry. Walking from one open client to the next replaces it, so Back closes the profile instead of replaying every step. A click on a row or its name is a link and pushes, as it always did.
8. **The muted rows are skipped by the walk** (the small call the ticket left to this lane). "No client" and "Archived clients" are not clients: each opens `/income` filtered, which would leave the page in the middle of a walk, and a row that only took focus without opening anything would break "the profile follows". They stay links in every arrangement, reachable by Tab and opened with Enter or a click. This extends ADR-049 §4 and the MUT-83 pattern "a row that isn't a record never sorts with the records" to the walk.
9. **The selection is announced.** The open client's link has `aria-current="page"` and its row is tinted. A polite status line says "Showing {name}" when the open client changes after the page loaded (a walk, a click, Back). It says nothing on a deep-link load, where the page title already names the client.
10. **Each client gets a fresh profile.** The detail route's `remountDeps` is the client id. Opening another client resets its Work filters and starts at the top, as opening a profile always did. A resize never changes the key.
11. **No motion.** The pane appears in place. ADR-044's springs are for drawers, and a layout that moves on every arrow press would fight a fast walk. Nothing needs reducing.

**Relation to other ADRs**: ADR-003 (drawer-first) is unchanged: the profile is a page, not a create or edit drawer, and every drawer still opens over the whole app. ADR-008 (URL-driven UI state) is applied to the list's search and sort. ADR-033's profile content, ADR-035's ordering and ADR-049's rows are unchanged.

**Consequences**:
- Working through the list is ↓, look, record, ↓, with the list in sight.
- A search or sort changed while a client is open is written into that client's history entry. Back then returns to the list as it was when the first client was opened.
- The list pane stays mounted, and its queries keep running, while a narrow window shows a profile. These are local reads, already cached.
- An e2e spec for the split view was not written: the owner stopped new tests during the epic's merge window (TD-067).

**Alternatives Considered**:
- **A full page that preserves its place on Back** (C1's rejected option).
- **Remount the list per URL, restoring scroll by hand**: more code, and the list would flash on every arrow press.
- **Render the panes differently per width** (an `if (wide)` that returns another tree): a resize would remount the profile, losing what was typed in it.
- **Land on the muted rows and open `/income` with Enter**: the selection would stop following focus on two rows, and ↓ past the last client would leave the page.
- **Wrap at the ends**: Mail doesn't, and a wrap from the last client to the first is easy to miss in a long list.
- **Push a history entry per step**: thirty presses of ↓ would need thirty presses of Back.
- **A CSS media query for the breakpoint**: the width would then live in two places.

---

## ADR-051: "All Businesses" Is a Lens on Home and Clients Only; Every Other Screen Works in One Concrete Business (Overrides the Unrecorded April Strict Mode)

**Status**: Active
**Date**: 2026-10-12
**Numbering**: the epic's parallel lanes reserve ids; lane 3 holds ADR-051 and TD-068 (the review's leftovers).
**Context**: MUT-89 (epic MUT-74), decision S2 of `.claude/designs/landing-apple-redesign.md`. Brief `.claude/designs/mut-89-all-businesses-lens.md`, with owner decisions O1–O7 (Basel, 2026-10-12, all as recommended) and eng review D1–D8. Test plan: `.claude/designs/mut-89-all-businesses-lens-tests.md`.

The pitch is "who owes me across my businesses", but the app showed one business at a time. An "All Profiles" mode existed. Commit `70b5093` ("added vendors page", April 2026) switched it off by hard-coding `isAllProfiles = false` and `showAllProfilesOption = false` in `useActiveProfile.ts`. No ADR recorded that "strict mode". Two facts shaped the design:
- every repository read treats a blank business as "every record", which includes unassigned records and archived businesses' records;
- the 13 screens that read the active business were never designed for several.

**Decision**:
1. **Scope.** "All businesses" applies to the owed screens only: Home (`/`) and the Clients layout (`/clients`, so also a client opened beside the list). Those routes carry `staticData: { owedLens: true }` (TanStack Router's built-in route tagging, D1). Income, Expenses, Documents, Retainers, Insights, Planning and Projects stay per business.
2. **State** (`profileStore`, persisted at version 1):
   - **Fields:**
     - `activeProfileId` is the *working business*, always a concrete id;
     - `allBusinesses` is the lens the user chose;
     - `onOwedScreen` lives in its own unsaved store, `useOwedScreenStore` (§10). `useOwedScreenSync` writes it from the route, in a layout effect called once in AppShell.
   - **Three setters:**
     - `setActiveProfile` is a pick: it turns the lens off;
     - `setWorkingProfile` is a repair or a drill-down: it keeps the lens (D5);
     - `setAllBusinesses` turns the lens on or off (D6).
   - **The lens sticks (O1):** other screens use the working business, and Home shows All again on return.
   - **Migration:** a stored legacy `'all'` migrates to the lens on.
3. **Every other area receives a concrete business.** `useActiveProfile().activeProfileId` and `useProfileFilter()` never return "all", and the `'all'` sentinel is gone from the type and from its checks (D6). Off the owed screens the switcher shows the working business and does not list All (O2).
4. **Two derivations, by purpose:**
   - `useOwedLens()` is called only by Home and Clients. It returns `{ scope, isAll, profilesById }`, and it ignores the route flag so their first frame reads the right businesses with one read (D3).
   - `isAllProfiles` and `showAllProfilesOption` serve the chrome (the switcher, the top bar, the drawers and the Add menus). They also need the owed screen.
   - Both need two or more live businesses (AC1).
5. **All = the switcher's businesses (O3).**
   - The scope is a list of live business ids: `ProfileScope = string | readonly string[]`, on `transactionRepo.list`, `clientRepo.list`, `paymentRecordRepo.listRecent` and `clientSummaryRepo.listOwedIndex`.
   - `scopeToProfile` never matches an unassigned record against a list, and archived businesses' records stay out, as they are out of every business's lists today.
6. **Per currency, never summed, with business tags (O5).**
   - `listOwedIndex` gives each client row `profileIds`: the businesses of its entries in scope, in scope order, else its own business. Home rows carry their entry's business.
   - `BusinessTags` shows one colour-and-name tag per business, and only in All.
   - The muted rows come one per business (`byProfile`, O4), computed with the same `partitionOwedNow`, so the rows still add up to the strip. A click sets that business as the working one (lens kept) and opens `/income` filtered, which then lists exactly what the row counted.
7. **Creating from All asks which business.**
   - The Income drawer requires one: its existing `profileInFastPath` shows the required field, empty and up front (AC4).
   - The Add menus ask through `ProfileQuickPicker`, which is now kept inside the window.
   - The Client and Project drawers keep their visible business select, prefilled with the working business (O7; MUT-57 owns the sidebar New menu).
8. **Nothing reads before the businesses are known.**
   - The lens queries run only once `scope !== undefined`.
   - Home's new-user check waits on `isPending`, because a disabled TanStack Query 5 query is pending but not "loading" (D2). With no business at all the scope is `''`, as before (D4).
   - AppShell's `BusinessesGate` holds every routed page until the businesses have loaded, so no page ever reads with a blank business (D8, one gate rather than one per page, the owner's choice during the build).
   - **Which guard is the guarantee:** the gate is. The per-query `enabled` gate and `scope === undefined` on Home and Clients are screen-level defence for a screen rendered without AppShell (tests, a future embed); they are not a second rule.
9. **Choosing a business is never silently dropped** (pre-landing review, 2026-10-12):
   - MUT-81's "Saved · Show" calls `setWorkingProfile`, so it is not a pick and keeps All on (ADR-057's Show is reconciled here).
   - The Client and Project drawers prefill the business the Add menu's picker returned.
   - The sidebar's New → Income/Expense makes the picked business the working one before opening its list.
   - The Income drawer asks for the business before the client, and offers "Create new" client only once a business is chosen (a hint says so, and so does the error if an unknown client blocks the save), so a client created there is filed in that business, never the default one. The project field stays closed until then for the same reason.
   - The picker is placed from where its menu item was, takes focus (arrow keys, Home, End), gives it back to the menu button on Escape, and closes when focus leaves it.
10. **The route flag is unsaved** (`useOwedScreenStore`): a persisted store writes localStorage on every change, so keeping it in `profileStore` would rewrite the saved choice on each navigation and overwrite one made in another tab.

**Relation to other ADRs**:
- **Overrides** the unrecorded April strict mode.
- **Fulfils ADR-049 §7** (the helper takes entries, not a business). **ADR-049 §3 stands**: the client profile page stays all-businesses.
- **ADR-055 holds:** in All, Owed now and Needs attention still read one query, and the same-frame test also runs in All.
- **ADR-036's Home content and ADR-035's ordering are unchanged.**
- **ADR-050's walk skips** the per-business muted rows like the others.

**Consequences**:
- In All, a shared client's row equals its profile page (both count every business), so TD-065's gap now shows only in one business.
- A cold start mounts the page a few milliseconds later, once the businesses query answers.
- MUT-81 landed first; its "Show" now uses `setWorkingProfile` (§9).
- Leftovers the review recorded rather than fixed are TD-068.
- The hosted portal's switcher is unchanged (HP1 carries no S2).

**Alternatives Considered**:
- A one-shot lens that leaving Home switches off (O1).
- All listed everywhere, navigating to Home (O2).
- All = every record, which brings back unassigned records the orphan banner owns (O3).
- Two aggregate muted rows whose click could show fewer entries than they counted (O4).
- `useActiveProfile` reading the router: every consumer and test would need a router.
- A pathname helper: it duplicates the route tree and must strip the `/app` basepath (D1).
- Five per-page loading gates (D8, at build time).

---

## ADR-052: Expenses Needs Attention Is One Row per Recurring Rule; Marking Several Payments Paid Is One All-or-Nothing Write, Each Dated on Its Expected Date

**Status**: Active
**Date**: 2026-10-12
**Context**: MUT-87 (epic MUT-74), decision E1 of `.claude/designs/landing-apple-redesign.md`, approved by Basel 2026-10-11. The Expenses page's Needs attention list showed one card per missed payment of a recurring rule, each with Mark Paid, Skip, Snooze and Edit recurring rule. Three missed months of server hosting were three identical cards and 12 buttons for one decision. Mark Paid opened a modal that dated the expense **today** unless the user changed the date, so catching up on three months put three expenses on one day. Test plan: `.claude/designs/mut-87-recurring-rows-tests.md`.

**Decision**:
1. **One row per rule.** `groupOccurrencesByRule` (`src/components/expenses/recurringAttention.ts`) is the one pure grouping: rule → its missed payments, oldest first; rows ordered by their oldest payment, then title, then id. The row reads "Server hosting · $80 monthly · Aug, Sep, Oct not marked · $240", with the oldest payment's lateness under the amount ("68d overdue"), as Home's Needs attention says it. `VirtualOccurrenceDisplay` gains `frequency` for "monthly"/"yearly"; occurrence generation is unchanged.
2. **One primary action.** Mark paid opens `RecurringMarkPaidDrawer` (the shared `Drawer`, unchanged), listing the payments, all checked, each with its date and an amount field prefilled with the rule's amount. **Each checked payment becomes one expense dated on its own expected date** (overrides the old modal's default of today). The amount stays editable per payment, keeping the recurring brief's "amount can be edited before confirming"; it is sent only when changed, so `actualAmountMinor` records a real override. The old modal's paid-date and notes fields are dropped (the rule's default notes still apply; the expense stays editable in the ledger).
3. **All or nothing.** `confirmPayments`, `skipOccurrences` and `snoozeOccurrences` (`recurringExpenseService.ts`) loop over the existing single-payment functions inside `recurringOccurrences.runAtomically(work)`, a new repository method. The Dexie implementation is one `rw` transaction over `recurringRules`, `recurringOccurrences` and `expenses`; repository calls inside join it, and a throw rolls every write back. `work` may await only repository calls.
4. **Skip, Snooze and Edit rule live in a ⋯ menu** (`useMenuButton`, ADR-034 §4) and apply to all of the rule's missed payments; Skip asks first. Inside the drawer each payment has its own Skip (asks first) and Snooze. Snoozing is a view of the same drawer (date, quick picks via `Intl.RelativeTimeFormat`), for one payment or, opened from ⋯, for all of them. `RecurringConfirmModal` and `RecurringSnoozeModal` lost their last consumer and are deleted; `RecurringOccurrenceCard` keeps only the read-only form the forecast uses.
5. **The section total shows each non-zero currency side by side**, never combined (ADR-004), in USD → ILS → EUR order like Owed now: `currencyTotals(groups)` over `orderCurrencyAmounts`, rendered by `CurrencyAmounts`. It is computed from the due occurrences only; it does not share `useOverviewTotalsByCurrency` (whose page-level "Total expenses" strip sums the wrong table — reported, not changed here).

**Consequences**: Catching up on a rule is one decision and one write; a failure leaves the rule exactly as it was. Expenses from a catch-up land in the months they belong to, so a month's ledger and by-category totals are right. A user who paid on a different day edits the expense afterwards. Any future multi-row recurring write goes through `runAtomically`.

**Alternatives Considered**: one compact row per month (rejected at approval, E1); keep the four-button cards (rejected, E1); date catch-up expenses today, as the modal did (rejected: the AC asks for each expected date, and today misfiles every month but the current one); drop amount editing to keep the drawer minimal (rejected: removes a capability the recurring brief requires, with no decision to remove it); keep the snooze modal and stack it over the drawer (rejected: two layers, and the drawer's Escape would close the wrong one); open the transaction in the service with `db` directly (rejected: services reach storage only through `getRepositories()`, ADR-002).

---

## ADR-053: Device-to-Device Sync Is Retired; Local↔Hosted Sync Is Off the Roadmap (Supersedes ADR-011, ADR-012, ADR-013; Narrow Override of ADR-029)

**Status**: Active
**Date**: 2026-10-12
**Context**: MUT-73 (epic MUT-2). Brief: `.claude/designs/mut-73-retire-sync.md`, approved by the owner on 2026-10-12 with decisions D1–D12 as recommended. Device sync (LAN pairing and `.msync` bundles, ADR-013, built on ADR-011's HLC and ADR-012's op-log) was broken in ways users could not see:
- transaction creates and edits were never captured (MUT-46);
- payment ops were captured but never applied (MUT-55);
- expenses never synced at all;
- conflicts were counted but no shipped screen could resolve them (the "Review Conflicts" button had no handler).

The phone app is going hosted-only (MUT-63), so nothing on the roadmap needs it. The owner decided on 2026-10-11 to drop it product-wide.

**Decision**:
1. **Device sync is deleted, not repaired.** The following are removed:
   - `src/sync` (HLC, op-log engine, conflict resolver, synced decorators, sync store, bundle encoder and crypto);
   - `src/components/sync` (pairing, bundle export and import, the status chip, the conflict banner, the Settings section);
   - `usePairingSession`;
   - the Tauri `src-tauri/src/sync` module (LAN server, mDNS discovery, pairing, paired-device persistence, bundle crypto, 17 IPC commands);
   - the 15 crates only it used, or that nothing used;
   - the `qrcode.react` dependency.
2. **Local↔hosted sync is off the roadmap, not deferred.** This closes the op-log-over-OAuth path MUT-25 left open, and the "a separate ADR, gated on MUT-27 and TD-015" thread in ADR-023, ADR-024 and ADR-037. MUT-34 decision 1 ("neither syncs to the other in v1") becomes permanent: a local profile and a hosted profile never sync. Moving data between devices is the JSON backup's job, as the landing FAQ already says.
3. **The repository registry has one family.**
   - `getRepositories()` keeps its `{ base }` shape (D6), and `ISyncedRepositories` is gone.
   - The eight call sites that used the decorators now call the base repository: Mark paid (×2), partial payment (×2), payment record create/update/delete, business-profile archive.
   - The decorators wrote the same rows and then appended an op-log entry outside the write's transaction. So the change is invisible on success, and it removes one failure: a failed append could reject a mutation whose payment was already stored, inviting a duplicate.
4. **Dexie v21 drops the eight sync-only tables**: `localDevice`, `trustedPeers`, `opLog`, `peerCursors`, `entityFieldMeta`, `moneyEventVersions`, `conflictQueue`, `syncHistory`.
5. **The Malafat OAuth client stays, moved out of the sync tree.**
   - TypeScript: `src/services/oauth/`, unchanged apart from paths and comments.
   - Rust: `src-tauri/src/oauth/{mod.rs, callback.rs}`.
   - The three commands keep their names and get their own `OAuthState`. The opener plugin and its `*.malafat.app` permission stay.
   - Nothing in the app calls the flow yet; its future is TD-075.
6. **The desktop removes `paired_devices.json` and `paired_devices.tmp`** from its config directory on every launch (`src-tauri/src/retired_sync.rs`). This is best effort: a missing file is success, any other failure is logged and never blocks startup. The file held bearer tokens issued to phones, which now authenticate to nothing.

**Override log — ADR-029 (for these eight tables only).**
- *What:* ADR-029's "deleting a feature's UI never drops a Dexie table".
- *Why it is safe here:*
  - every user record lives in a table v21 does not touch;
  - the eight tables hold sync bookkeeping: device identity, peers that no TS code ever wrote, op-log copies of rows that exist in their own tables, LWW clocks, conflicts and history;
  - the two record-like residues (pre-sync transaction snapshots in `moneyEventVersions`, and received ops that never applied, MUT-55) were never visible in any shipped screen, and their originals live on the device that sent them;
  - every JSON backup saved before the upgrade still contains the rows, and restore skips them.
- *What replaces it, for these tables:* the v21 migration test (`src/db/__tests__/migration-v21.test.ts`). It upgrades a v20 database with op-log rows, a paired peer and an open conflict, and asserts that it opens without error, that the stores are gone, that every user row is unchanged, and that a pre-upgrade backup restores.
- ADR-029 stands for every other table. A future retirement that wants the same exception needs its own explicit override.

**Consequences**:
- About 10,000 lines leave: 33 files, 4,790 lines of TS/TSX, 939 of CSS, 1,780 of TS tests, 2,484 of Rust.
- About 62 KB of minified JS leaves the web and desktop bundles, 16.6 KB of it from `qrcode.react`.
- The desktop no longer opens a plain-HTTP listener on `0.0.0.0` or advertises over mDNS.
- `rustls` is built with `ring` only, from `tauri-plugin-updater`, which installs that provider itself when none is set. `aws-lc-rs` and its C build leave the graph.
- Rollback:
  - a pre-v21 build reopening a v21 database works, because Dexie recreates the stores empty;
  - re-landing after such a rollback needs a later version that re-declares the eight `null`s. Dexie will not re-run v21's drop on a native version it has already passed.
- `scripts/bundle-rules.ts` fails the local bundles if `.msync`, `start_sync_server` or "Export Sync Bundle" ever ships again.
- `noSyncModules.test.ts` fails on any file, import, mock, table, command or crate coming back.

**Alternatives Considered**:
- Fixing sync (MUT-46, MUT-55) (rejected): it repairs a feature the roadmap no longer needs, plus expense sync from scratch.
- Keeping the tables inert under `src/db/retained/` (ADR-029 as written) (rejected): every install would keep an op-log copy of its money and a device row forever, and the ticket's "no leftover sync tables" criterion fails.
- Dropping only the three tables the ticket named (rejected): the other five had no reader left either.
- Flattening `getRepositories()` (rejected for this ticket): it would rewrite 160 call sites in files three parallel lanes are editing.
- Removing the paired-devices file from JavaScript (rejected): it would need a new `fs:allow-remove` capability, and would run only after the UI mounts.

---

## ADR-055: Home Records a Payment in Place: Needs Attention Reads Owed Now's Query, the Payment Drawer Reports What It Recorded, and Undo Deletes That Record

**Status**: Active
**Date**: 2026-10-12
**Numbering**: the epic's parallel lanes reserve ids; this lane holds ADR-055 (ADR-048 went to MUT-66).
**Context**: MUT-82 (epic MUT-74), decision H1 of `.claude/designs/landing-apple-redesign.md`, approved by Basel 2026-10-11. Test plan: `.claude/designs/mut-82-home-inline-payment-tests.md`. Every Needs attention row on Home opened the client's profile, so recording that a client paid took four steps and a page change. H1 settles the behaviour: an always-visible Record payment on each row, the existing drawer opened in place with the remaining amount and today, the row sliding out and Owed now updating in the same frame on save, and a brief Undo that deletes the just-created payment record. This ADR records how that is wired, because three parts change shared contracts.

**Decision**:
1. **Needs attention is selected from the receivables query Owed now reads.** `HomeNeedsAttention` calls `useReceivables({ profileId })`, the same filters and so the same TanStack query as `OverviewPage`'s Owed now, and selects its rows with the pure `selectAttentionReceivables(transactions, today)` (`src/lib/attention.ts`). One refetch notifies both observers in one batch, so the paid row leaves and Owed now changes in the same React commit; two queries resolve in separate tasks and can land in different frames. `transactionRepo.getAttentionReceivables` now calls the same selector, so the rule has one definition. ADR-036 §1's list is unchanged in content and order (overdue or due within 7 days, every currency, oldest due first, ties by client name then id); only its source moves, and Home reads one IndexedDB query fewer.
2. **The payment drawer reports what it recorded.** `openPartialPaymentDrawer({ transactionId, onRecorded? })` carries an optional callback in the drawer store; `AppShell` passes it to `PartialPaymentDrawer`, which calls it with the created `PaymentRecord` after the save and before it closes. Updates and deletes are not reported. Editing a record of the same entry, and returning to the entry's view, keep the callback; opening another entry drops it. A callback in a store is new here: it is the only way a screen can hear from the app-wide drawer it opened, and it is optional, so a drawer opened anywhere else behaves as before.
3. **Undo deletes the record through the repository.** `usePaymentUndo` shows a toast with Undo whose action calls `useDeletePaymentRecord` → `paymentRecordRepo.delete`, which recalculates the entry from the records left. Payment records own the entry's payment state (ADR-039) and paidAt derives from them (ADR-038), so status, remaining and paidAt return exactly to their values before the payment. Nothing is snapshotted or written back.
4. **One Undo at a time, and it outlives the screen.** The toast store gains an optional `group`: a new toast replaces the one showing in its group, so a second payment's Undo replaces the first (the first payment stays recorded). The Undo needs only the record, so it still works after the user leaves Home, and every list refreshes through the usual invalidation. A failed delete says so in an error toast. A toast's timer pauses while the pointer is over it or focus is inside it.
5. **A settled row slides out as a snapshot.** Following ADR-044 §2, the state change is immediate and the exit is presentation: when a row a Home payment settled leaves the list, `captureRowExit` (`src/lib/motion/rowExit.ts`) lays an inert, hidden copy of its last frame over the section and slides it toward the inline end while it fades, on the drawers' spring (`UI_SPRING`, response 0.3, damping 1); the rows after it glide up into the gap. Reduced motion fades the copy over 150 ms and moves nothing. The copy sits over the section, not in the table, so the last row still slides out while the empty state appears. Only rows a Home payment settled animate; a mark the data has answered without removing the row is dropped.
6. **Keyboard and focus.** The client cell becomes a real link to the client (a button opening the entry when there is no client), beside the Record payment button in its own cell, so nothing interactive is nested. A payment that settles a row moves focus to the next row's Record payment (or the section heading) before the drawer closes, since the drawer would otherwise return focus to a button that is about to go. After Undo, the restored row's button takes focus if focus was lost with the toast.

**Consequences**: Paying a client from Home is two taps, with Undo. Owed now and the list can't disagree for a frame. A future screen can offer the same Undo with `usePaymentUndo` (MUT-85's lump-sum payment). If Home's Owed now ever moves off `useReceivables({ profileId })`, the same-frame guarantee goes with it; `HomeNeedsAttention.test.tsx` checks the commit order with a `MutationObserver`. An entry with a received amount no payment record covers (sample data, TD-063 / MUT-60) is already mis-saved by any payment, and Undo restores its record-derived state, not the uncovered number (TD-064). Drawer exit snapshots now strip ids (found here: a drawer opened while another was playing out submitted the snapshot's form).

**Alternatives Considered**:
- Keep `useAttentionReceivables` and patch both caches with `setQueryData` inside one `notifyManager.batch` (rejected: duplicates the repository's derivation in the UI and races the invalidation refetch).
- Snapshot the entry's payment fields and write them back on Undo (rejected: payment records own payment state, ADR-039; deleting the record is exact).
- Stack one Undo toast per payment (rejected: two identical "Undo" buttons with no way to tell them apart).
- Dismiss Undo when Home unmounts (rejected: it disappears exactly when the user has gone to look at the client).
- Keep the departed row mounted for its exit, AnimatePresence-style (rejected for the same reason as ADR-044: two ways to exit, and the empty state would have to wait for the animation).

---

## ADR-057: After a Save, a List Claims Its Own Row; Resolution Is List-Reported Settled, Never a Global Fetch Counter

**Status**: Active
**Date**: 2026-10-12
**Context**: MUT-81 (epic MUT-74), brief `.claude/designs/landing-apple-redesign.md` R1, approved 2026-10-11. Two `/plan-eng-review` passes and one `/plan-design-review` pass: `.claude/designs/mut-81-after-save-feedback.md`. After saving income or a payment, the drawer closed and the list updated with no highlight and no message; with a filter active, another profile selected or a long list, the entry landed out of view with nothing to explain where it went.

**Decision**:
1. **One store holds at most one pending save.** `savedFlashStore` (`src/lib/savedFlashStore.ts`) carries `{ kind, ids, clientId?, clientName?, profileId, messaged? }`. A payment carries `[paymentRecordId, transactionId]`, so a client profile's payment row and its entry row can both claim the same save; an entry carries `[transactionId]`.
2. **A list claims a save by rendering one of its ids, once settled.** `useSavedFlashRows(listId, ids, queryResult)` (`src/hooks/useSavedFlash.ts`) registers the list and reports its own `settled = !isLoading && !isFetching` on every render — derived inside the hook, so no caller can pass `!isLoading` alone and race a refetch still in flight. The store resolves `claimed: true` the moment any registered list's settled ids intersect the pending save; it resolves `claimed: false` only once **every** registered list has reported settled with no match. The original proposal (watch a global `useIsFetching()` counter for 1→0) was rejected mid-review: it counts unrelated queries and, per a documented TanStack Query case, can hit zero while invalidation during an in-flight fetch leaves stale data showing — the false positive this feature exists to prevent.
3. **The tint's clock starts on the row's first render, not at save time.** `markSaved` sets `pending` immediately; the 1.5s `FLASH_MS` fade (`tr.row-flash`, `src/index.css`) only begins once a list actually claims it. `rearm` (used by Show, below) restarts that clock, so a message read a few seconds late still lands on a visibly tinted row. A `BACKSTOP_MS` timer (1200ms) covers a save from a route with no instrumented list at all (e.g. + Add from Settings).
4. **The drawer calls `markSaved` unconditionally.** `ClientWorkSection` and `IncomePage` open `PartialPaymentDrawer` with no `onRecorded` callback at all (grep-confirmed), so the drawer itself is the only place that can know a save happened for those two screens. `IncomeDrawer` and `PartialPaymentDrawer` both capture the client's name from data already in the query cache at save time (`useClients()` / `useTransactionDisplay()`) — never looked up again when the message resolves.
5. **Home's full-payment path is the one exception.** A row a payment fully settles already leaves via `captureRowExit` (ADR-055 §5) with complete feedback — the slide-out and the Undo toast. `HomeNeedsAttention`'s full-settle branch calls `useSavedFlashStore.getState().clear()` right after the drawer's unconditional `markSaved`, before any list can report settled, so the flash never resolves "not visible" under an animation that already told the whole story. Without this, a payment landing outside `useRecentPayments`'s last-10 window would raise a confusing message with nothing left to claim it.
6. **Not claimed → the existing Toast, not a new floating surface.** `SavedFlashAnnouncer` (mounted once in `AppShell`) renders a visually-hidden `role="status" aria-live="polite"` "Saved" when claimed, or raises a `Toast` naming where the save went when not. Show switches the active profile through the raw `profileStore`, **never** `useActiveProfile`'s wrapper (it silently refuses an id its own profiles query has not loaded yet), navigates to the client profile or to `/income` with its filters reset, and re-arms the flash with `messaged: true` so the original message can never fire twice for the same save.
7. **No `persist` wrapper.** Like `toastStore`, unlike `profileStore`/`onboardingStore` — this is ephemeral UI state; resurrecting yesterday's tint on reload would point at the wrong row.

**Consequences**: One mechanism serves every save path in scope (income and payment, create and edit) across five lists (`HomeNeedsAttention`, `HomeRecentPayments`, `ClientWorkSection`, `ClientPaymentsSection`, `IncomePage`) with one hook call each. `OwedNowSummary` migrated its private `isolateLtr` (U+2066 LRI) to the new shared `isolate()` export in `utils.ts` (U+2068 FSI), which `PartialPaymentDrawer` already used privately; `RecurringAttentionList.tsx` and `RecurringMarkPaidDrawer.tsx` keep their own (already-FSI, so not wrong) copies — TD item in `TODOS.md` #6. **Scoped out of this build, disclosed rather than dropped:** the design review's anchored-strip treatment for the message (5B, so it never floats and can say *why* the row is missing), the Owed-now count-up tick, currency-block collapse animation, pagination for the two now-unbounded lists (D7/D8's own addition to this ticket), and a dedicated keyboard-focus chain for the client profile / `/income` / cross-navigation paths (ADR-055 §6 already covers Home's full-payment case). See TD-077 and TD-078.

**Alternatives Considered**:
- Watch `useIsFetching()` globally for the resolve signal (rejected: races invalidation, counts unrelated queries — see point 2).
- Have the message's Show button use `useActiveProfile`'s `setActiveProfile` (rejected: its membership guard silently refuses an id the profiles query has not loaded, landing Show on the old profile with an empty list).
- Build the full anchored strip (design review 5B) in this same build (rejected for scope: none of the ticket's five literal acceptance criteria name a presentation surface, and `Toast` already satisfies all five with a proven, accessible, tested component).

**Amendment (2026-10-14, MUT-91), §8: the portal claims through the same store**
- The hook moves to `src/lib/useSavedFlash.ts`, because the portal lint bans `hooks/`.
- `kind` adds `expense` and `conversion`.
- **The backstop no longer resolves "not claimed" while a registered list is still fetching** (eng review D3). The portal refetches over the network, and 1.2s is not enough. Once the backstop has fired, a list that settled before the save and never re-rendered stops holding resolution.
- **The portal's presentation is its own `SavedNotice`, page-local, not a toast** (D5). It names no cause (D4).
- **Show sets the server `anchor`** (ADR-074) and re-arms only once the page renders with that anchor. Re-arming on the click let the old filters' render resolve "not here" first.
- `settleMessage` marks a save shown when its notice times out, Show is pressed or its page unmounts, and resolves it as not claimed if no list has answered, so a later visit neither re-shows nor re-tints it.
- `MAX_WAIT_MS` (10s) caps how long a list still fetching can hold a save unresolved (review: the portal's fetch has no timeout).
- The portal's `endSession` clears the store with the query cache.
- Show re-arms when the page renders with the new filters (`filtersKey`), not just a new anchor value, so Show works on a list already anchored on that record.

---

## ADR-058: Brand v2: `--m-*` Primitives From the Token JSON and One Semantic Map in theme.css; Light Text Clears 7:1; Thmanyah Is Bundled Unmodified (Amends ADR-018)

**Status**: Active
**Date**: 2026-10-12
**Context**: MUT-102 (epic MUT-101). Basel delivered Brand v2 on 2026-10-12: a token JSON, CSS and Dart derived from it, Thmanyah Sans and Serif Display, and new marks. `theme.css` still carried the old look (cool grey, teal, Inter, Source Serif 4, a 13px body, 4–16px radii) and repeated every colour in four selector blocks; the brand CSS was placed but not imported. Settled before planning (memory `brand-v2-decisions`): AAA light inks canonical; Thmanyah for English and Arabic; the brand type scale everywhere, body 16; fonts self-hosted and unmodified, with the licence risk accepted (written OK from ask@thmanyah.com is a guardrail before a web release, not a blocker). Plan and eng review: `.claude/designs/mut-102-brand-v2-foundation.md` (PD0–PD11, D1–D8); tests: `…-tests.md`.

**Decision**:
1. **Two layers.** `src/styles/brand/mutaba3a-theme.css` holds primitives only (`--m-*`), switching light/dark in ADR-018's three selector states; `mutaba3a.tokens.json` is canonical and `brand.test.ts` › `drift` holds the CSS to it. `theme.css` imports it and `brand/fonts.css`, then maps **every** semantic token once, in one `:root` block. Only shadow strength, the overlay and `color-scheme` need a per-mode block. `theme.css` holds no colour literal (tested). `--m-shadow-tint` was factored out of the delivered card shadow (same values) so shadows and the overlay derive from it.
2. **Light text clears 7:1, dark text 4.5:1.** A Node evaluator checks all four theme states, for two things:
   - **token pairs** (`brand.test.ts` › `contrast`), each composited over both `--bg` and `--surface`;
   - **rendered pairs** (`brand.test.ts` › `rendered pairs`): every rule in `src` that sets both a text colour and an opaque background. Six literal-only CSV pairs sit in a shrink-only list for MUT-103.

   axe checks light and dark in a browser, but at its default AA rule only (`color-contrast`, 4.5:1). Enforcing AAA in the browser is TD-086. `KNOWN_AXE_VIOLATIONS` no longer lists `color-contrast` for any app surface.
   - Purple used as text is `--accent-text` (primary-hover, 7.14:1); `--accent` (primary, 4.77:1) is for fills, borders and decoration only. A guard test forbids `color: var(--accent)`.
   - Filled buttons use `--accent-solid` = primary-hover (cream on primary is only 4.84:1); hover and active mix toward ink, so contrast rises.
   - **Text on the lavender ground uses `--on-accent-subtle`** (lavender-ink, 7.01:1). This covers the selected nav item, chips, count pills, alerts and the open client row; primary-hover on lavender is only 5.52:1. On the open row, every coloured line takes lavender-ink.
   - **Text on a filled status ink uses `--on-status`** (the canvas). This covers danger, success and warning buttons and a completed step. White fails once the inks turn light in dark mode, at about 1.5:1.
   - **Grounds are capped where ink2 keeps 7:1.**
     - `--bg-subtle` is 20% line.
     - The row and nav tints are 10–15% lavender.
     - `--surface-3`, a pressed ground darker than field-bg, carries primary text only.
   - **Blends between colours of different hue mix `in oklab`.** In oklch, lavender-grey and cream meet at pink. A test refuses an oklch blend across more than 30° of hue.
   - **Focus.**
     - Filled buttons (primary, danger, success, warning) take `--focus-ring-on-fill`: an outer ring, set off by a gap of page colour, with `--focus` on `--bg` at 3:1 or more. The inset brand ring paints over a fill and barely shows.
     - A hovered primary button keeps that ring.
     - Focus rules never use a literal colour.
   - **Visited links.** `a:not([class]):visited` styles only unclassed links, so a link styled as a button never turns lavender-ink.
   - **Hovered links (amendment 2026-10-14, TD-122).** The global hover is scoped the same way. `theme.css` sets `a:not([class]):hover { color: var(--link-hover) }` and `index.css` sets `a:not([class]):hover { text-decoration: underline }`. A classed link owns its hover. A control (a button, card, pill, nav or menu item, or row action) keeps its label colour and is never underlined. A classed inline text link declares `color` and `text-decoration: underline` on its own `:hover`. `brand.test.ts` guards both rules.
   - **The one exemption is the placeholder:** 85% ink2 toward field-bg, 5.02:1 light / 4.66:1 dark, floor 4.5:1 (tested). At full ink2 a hint reads as a typed value; axe does not check `::placeholder`.
3. **Faces.** Thmanyah Sans for body text in both scripts, Thmanyah Serif Display for headings at 700, and IBM Plex Mono for figures.
   - **Weights.** Thmanyah ships 400/500/700, so a `--weight-semibold` (600) renders with the Bold file. Plex Mono ships 400/500 here, so a figure is 500. `html` sets `font-synthesis-weight: none`, so a figure that inherits 600 renders the 500 file rather than a faked bold.
   - **Mono fallback.** The mono stack falls back to Thmanyah Sans, so Arabic inside a figure cell keeps the brand face.
   - **Glyph gaps.** Thmanyah has no `tnum` feature and no ₪ glyph. A `tabular-nums` rule in the body face does nothing, and ₪ comes from a system font. Amounts belong in Plex Mono, which has both; moving the remaining ones is MUT-103's job (TD-079).
4. **Thmanyah is bundled from `src/assets/fonts`, byte-identical** to the delivered files (sha256 pinned in `brand.test.ts` and checked in every dist by `check-bundles`), never converted, subset or loaded from a CDN. Vite emits hashed copies under `/assets/` in the web, desktop and portal builds: the portal's existing `/assets/*` rule caches them immutably and the desktop app reads them offline (`check-bundles` proves every CSS `url()` resolves inside each dist). Plex Mono stays on `@fontsource` (OFL woff2).
   - **No font is preloaded.** The ticket asked to preload Thmanyah Sans 400, but the measurement reversed it (D2, the owner's call). Results are on `vite preview` builds of the landing page, at Fast 3G with 4× CPU, median of 5 cold runs:

     | Variant | LCP |
     |---|---|
     | Preload at high priority | 4664 ms |
     | `fetchpriority=low` | 4356 ms |
     | No preload | **3964 ms** |
     | main | 4116 ms |

     CLS was 0.009 in every variant. The app renders on the client, so the preload only took bandwidth from the code that paints; `swap` shows text at once. `check-bundles` flags an entry that preloads a font.
   - **PWA font cache.** The PWA caches fonts on use (CacheFirst, 12 entries) rather than precaching them. The service worker registers after `load`, so the cache fills on the second online load (TD-087).
5. **Scale, radii and motion.** New `--text-label/body/headline/title/figure/display` (13/16/20/32/40/56), `--radius-card/hero/pill`, and motion tokens (`--ease-spring`, `--ease-overshoot`, `--duration-press/toggle/nav`, `--stagger-step`, `--press-scale`), zeroed under `prefers-reduced-motion`. The old `--text-*` and `--radius-*` names stayed as aliases (TD-079) so 620 call sites needed no rename at the time; MUT-103 migrated every one of them and deleted the aliases (see the amendment below).
6. **Regression contract.** Every custom property `theme.css` defined before the rewrite stays defined in all four states (`names`); every no-fallback `var(--x)` in `src` resolves, with the 48 dead references left in a shrink-only allowlist that MUT-103 empties (`references`); the ThemeToggle's Light/Dark/System paint the right canvas under OS light and OS dark (Playwright).
7. **TD-048, font half.** The `:lang()` font rules style `<html>` only, so inline elements inherit (a `<span>` in a heading keeps the heading face). The `direction` half is unchanged and is MUT-109.

**Consequences**:
- One look across landing, app, desktop and portal; the semantic layer went from four copies to one (`theme.css` 862 → 545 lines).
- First-visit font bytes rise, because the licence forbids woff2. Landing LCP still improves: **4116 ms on main → 3964 ms** once the preload is gone (TD-081, resolved). The service-worker precache gets about 0.7 MB lighter.
- The colour system needs `oklch()` and `color-mix()`, which means Safari 16.2 or later (TD-088).
- MUT-106 registers the PDF fonts with `?url` imports from `src/assets/fonts`; the `IBMPlexMono-*.ttf` in `public/fonts` are PDF-only.
- MUT-103 owns the sweep this foundation leaves: legacy aliases, component literals, semibold headings, ad-hoc amount classes and the dead-reference allowlist (TD-079).
- A component colour literal on an acceptance-criteria surface was fixed here when axe caught it (the profile avatar's dead `--color-accent`, the Mac banner button, a global `.text-muted` leak from the CSV preview, the landing get-it links); the rest wait for MUT-103.

**Alternatives Considered**:
- Fonts in `public/fonts` behind a shared path, with a hosted copy plugin and a server cache rule (D4 B): more plumbing, and never immutable since names don't change. Without the server rule (D4 C): the portal re-downloads ~1 MB per load (`no-store`).
- Converting to woff2 or subsetting: forbidden by the licence.
- Keeping the app's 13px density: overridden by Basel (brand scale everywhere).
- A full-ink2 placeholder with no exemption (D7 B): empty fields would look filled.
- Precaching Thmanyah in the service worker: ~1.2 MB on every install.
- Renaming every `--text-*`/`--radius-*` use now: 620 sites, left to MUT-103 behind aliases.

**Amendment — MUT-103's app-wide sweep (2026-10-13, decisions by Basel):**
- **Two more primitives:** `--m-radius-xs` (4px) and a new `--m-text-micro` role path, for the sub-label sizes (bars, swatches, chips, 9–11px text) the original six-step scale had no room for. `radius.xs` and `type.micro` were added to `mutaba3a.tokens.json` first; `brand.test.ts` › `drift` and the px-matches-JSON checks cover both. Every other sub-scale value snapped onto the existing scale instead of growing it further (1–2px radii → `--radius-xs`; 6–10px → `--radius-sm`; 12–14px text → `--text-label`).
- **The aliases are gone.** All 496 call sites across 43 files (including the landing page and the hosted portal, D3) were migrated onto the role names (`xs/sm` → label, `base/md/lg` → body, `xl/2xl` → headline, `3xl/4xl` → title; radius `xl/2xl/full` → card/hero/pill) and the alias declarations were deleted from `theme.css` and `FROZEN_THEME_NAMES`. The duplicate layout block that had crept into `index.css` was confirmed already gone by the time the sweep reached it.
- **Every colour, px radius and px/rem font size outside `src/styles/` now comes from a token.** A new `literals` guard in `brand.test.ts` (`cssLiterals`/`scriptLiterals`, `src/test/css/brandCss.ts`) fails on a hex, a colour function, `white`/`black`, a literal px/rem font-size, or a px radius in any `.css`/`.ts`/`.tsx` file outside `src/styles/`, with a single allowlist (`ALLOWED_LITERAL_FILES`) for user-chosen colours (a business's or an expense category's own colour) and a shrink-only `KNOWN_LITERALS` map that is now empty. An inline `<style>` element in TSX is flagged the same way; the two components that had one (`PlanAssumptionDrawer`, `MonthlyTimeline`) moved their CSS to co-located files.
- **Amounts are on `--font-mono` wherever they weren't already** (the payment drawer, `RecurringOccurrenceCard`, `RecordPaymentButton`, the expenses/unified/currency-summary totals, the landing mock), and a `tabularWithoutMono` check (shrink-only `KNOWN_TABULAR_WITHOUT_MONO`, now empty) fails a `tabular-nums` rule with no mono family in the same rule. Because Plex Mono ships only 400/500, every rule that gained `--font-mono` and asked for `--weight-semibold` or heavier in the same declaration dropped to `--weight-medium` — a per-rule check in `brand.test.ts` catches this (it does not follow the cascade, so a child selector that bumps weight without redeclaring `font-family` needs an eye check too).
- **Density (D5).** `--table-row-height` went 44px → 48px and `.data-table td` now sets `height: var(--table-row-height)` as a floor (padding unchanged); `brand.spec.ts` asserts a Clients row is ≥ 48px at 1280px. `--sidebar-width`, `--topbar-height` and `--drawer-width` are unchanged — the 8-surface screenshot matrix showed no new clipping.
- **One-off formula with a dynamic input:** the landing business-switcher mock's per-item hue fill moved from a literal `hsl(var(--avatar-hue) 55% 46%)` in `LandingPage.css` to a new primitive, `--m-avatar-mock-fill` (`mutaba3a-theme.css`, scheme-invariant), mapped once onto `--landing-mock-avatar-fill` in `theme.css`.
- **Left open, by decision (eng review D2 — not this sweep's scope):** heading weights and roles (`index.css`'s app headings still compute 600 but render Thmanyah's 700 file; the app's heading scale is deliberately smaller than the landing page's) and the user-chosen business colour's ink and hex validation (still a flat white ink and no format check). Both stay on TD-079.

---

## ADR-059: Contingency Fee Agreements: a Commission Is an Installment Posted When the Outcome Is Recorded, With VAT at the Rate on the Outcome Date (Narrow Override of M3 Decision 4)

**Status**: Active
**Date**: 2026-10-13
**Context**: MUT-100 (epic MUT-25; blocks MAL-1077 and the proposal follow-up MUT-107). Litigation firms charge an upfront fee plus a negotiated percentage of what the court or a settlement awards. The ledger had FIXED and RECURRING agreements, both needing their total at creation; the commission is unknown until the case ends. Product rulings (intake, 2026-10-12): bill once on the awarded amount, never per collection; with the upfront credited toward the commission, the firm keeps the upfront when the commission is smaller (no refund); one rate per agreement, editable until the outcome; Malafat is the only writer. Plan reviewed three times (eng, CEO in scope reduction, eng re-review) with every decision taken by Basel: `.claude/designs/mut-100-contingency-agreements.md` and `…-reviews.md`.

**Decision**:
1. **A third agreement type, `CONTINGENCY`**, created through the existing `POST /v1/agreements` with an optional `contingency { commissionRateBasisPoints (1..10000), upfrontTreatment (SEPARATE | CREDITED, no default) }`. The amount is the upfront, scheduled exactly like a fixed fee's installments; a 0 upfront has no installments. The terms are nullable columns on `agreements` (like the RECURRING-only block), guarded by a CHECK. No join table, no new route family: terms and outcome are sub-routes of `/v1/agreements/{id}`, inheriting its writability row, scopes and Malafat's `agreements-service`.
2. **The commission is an installment** (`isCommission = true`) on the agreement, DATE-triggered on the outcome date and posted at once. Receivables, payments, allocations, credits, statuses and lazy-post crash healing all work on it unchanged: a crash between the outcome write and the post heals through `listUnpostedDue`, dated on the outcome date.
3. **VAT on the commission is the rate in force on the outcome date** — a narrow override of M3 Decision 4 (an agreement's frozen rate) for the commission line only. The upfront and supplements of other types keep the frozen rate. Precedent: retainer term changes re-resolve the rate (M5).
4. **The bill.** SEPARATE: billable = award × rate. CREDITED: billable = commission − min(counted upfront, commission). NO_RECOVERY bills nothing. "Counted upfront" is every live upfront installment, posted or not, paid or not, less the credits against them read from the stored credit rows (never re-split), so it matches the firm's credit notes. Half-up rounding as `vat.ts`.
5. **What posts is what was previewed.** The outcome token covers the body, the agreement version, the VAT rate on the outcome date, the counted upfront, the commission and the billable amount, and for a correction the replaced receivable's id and version. A credit or payment that moves any of them is 409 `PREVIEW_STALE`.
6. **A correction credits the old commission in full and posts a new one**, atomically with the void and the new outcome, and may also fix the rate or treatment. Allowed only while the commission is unpaid and uncredited: re-checked in the store under the receivable's row lock, refused as `has_payments` → 409 `OUTCOME_HAS_PAYMENTS`, never a 500. Nothing is deleted.
7. **Summaries keep `kind`.** A contingency agreement is fixed-like (`kind: FIXED`, counts in `agreed`); an additive `ProjectSummary.contingency` carries the terms and outcome state. While an ACTIVE contingency agreement awaits its outcome the project is PENDING, never PAID_IN_FULL.
8. **Migrations:** the enum value alone in one migration, everything that names it in the next (Postgres refuses a new enum value inside the transaction that added it). Audit metadata is typed JSON-only (`JsonObject`) so a bigint can never reach Prisma's `Json` column.

**Consequences**:
- `AgreementType` gains a permanent value and `agreements` gains seven sparse columns (TD-097).
- An older server revision strips the unknown `contingency` field and would create a FIXED agreement silently: never roll back past MUT-100 while Malafat's contingency option is live (runbook in `server/DEPLOYMENT.md` §6, TD-098).
- Fee proposals cannot yet describe a contingency deal; contingency agreements are created directly until MUT-107/MAL-1094. **Resolved on the API side by MUT-107 (ADR-060); MAL-1094 (Malafat UI) is the remaining half.**

**Alternatives considered** (all in the review record):
- A commission receivable written outside the installment model: would need its own posting, healing and status code.
- The agreement's frozen rate for the commission: bills a 2026 judgment at a 2024 rate.
- Recomputing upfront credits with `splitCredit`: can differ by an agora from the issued credit notes (D6).
- One migration with a text-cast CHECK, or no CHECK (D3).
- Terms frozen at the outcome with no correction path (D5): a rate typo would be permanent.

**Amendment — pre-landing review (2026-10-13, `/qa-reconcile` + `/review`, decisions by Basel):**
- **No posting on a voided line** (review D1): `postInstallment` refuses a voided, unposted installment in both stores; on Postgres the posting write also carries `voidedAt IS NULL`. Before, a correction or cancel voiding a commission line could race a lazy read posting it and leave both commissions billed.
- **A correction serializes on the agreement row** (`SELECT … FOR UPDATE`) and voids the replaced line conditionally, as its first write; a line that moved is `stale`, never a 500. A racing loser is `stale` (409), not `has_payments`.
- **Cancel never undoes a recorded outcome**: the store's cancel write carries `outcome IS NULL`; a cancel losing to a concurrent record is 409 `OUTCOME_ALREADY_RECORDED`.
- **The counted upfront is re-checked inside the write** (review D2): the write carries each upfront receivable's id and version, locked and compared in the transaction; a credit landing after the commit computed the bill is 409 `PREVIEW_STALE`. This closes the last gap in decision 5.
- **`correctionReason` is outside the preview token** (review D3): it is the credit note's text and moves no figure, so a preview with or without it matches the commit.
- **Re-review (cycle 2):** compose reads the upfront versions *before* the credits, so a credit between the two reads still makes the write stale; record locks the agreement row first, like correct (one lock order: agreement → upfront receivables → commission); a deadlock or serialization failure in either write (40P01/40001, P2034) is `stale` → 409, not a 500; a correction carries the receivable its replaced line had when composed and is stale if that line posted since; a MANUAL trigger whose line a cancel voided under it is 409 `AGREEMENT_CANCELLED`, not 404.

## ADR-060: Contingency Fee Proposals Carry Only the Proposed Terms — an Approval's Override Lands on the Agreement, Not Back on the Proposal

**Status**: Active
**Date**: 2026-10-13
**Context**: MUT-107 (epic MUT-25), the design kept for the follow-up ticket in MUT-100's plan §11, decisions D9/D10 already locked there. A fee proposal can now carry contingency terms (`commissionRateBasisPoints`, `upfrontTreatment`) so a client approval can create a CONTINGENCY agreement, matching how approval already creates FIXED ones (MUT-40/MAL-943). The brief's one remaining ambiguity: approval already lets an `amount` override replace the proposed figure for the created agreement without rewriting `proposedAmountMinor`; §11 says a `contingency` override works "mirroring" that, but names only one nullable column pair on `fee_proposals`, not a second "agreed" pair the way `agreedAmountMinor` sits beside `proposedAmountMinor`.

**Decision**: `fee_proposals.commissionRateBasisPoints`/`upfrontTreatment` hold the *proposed* terms only, written once at create and never rewritten by approval. An approval's optional `contingency` override is used solely to build the created agreement's terms (`PreviewBody.contingency` → `composePreview` → `agreements.commissionRateBasisPoints`/`upfrontTreatment`, both already existing from MUT-100); it is never written back onto the proposal row. `FeeProposal.contingency` therefore keeps showing the originally proposed terms even after an overridden approval — the agreement itself (`GET /v1/agreements/{id}`) is the record of what was actually agreed, exactly as `agreedAmountMinor` already is for the amount. A `contingency` override sent against a proposal that was never proposed as contingency is refused with 422 `NOT_CONTINGENCY` (reusing the MUT-100 reason) rather than silently creating one.

**Consequences**:
- No second "agreed terms" column pair on `fee_proposals`; the migration stays exactly the one §11 scoped (nullable `commissionRateBasisPoints`/`upfrontTreatment`, CHECK both-or-neither).
- A client reading `FeeProposal.contingency` after an overridden approval sees the original ask, not the final deal — by design; the agreement is the source of truth for the agreed terms, same split as `proposedAmount` vs `agreedAmount`.
- `ApproveProposalInput` (ports.ts) needed no new fields; both stores' `approveProposal` write path is untouched from MUT-100.

**Alternatives considered**:
- A second `agreedCommissionRateBasisPoints`/`agreedUpfrontTreatment` pair on `fee_proposals`, mirroring `agreedAmountMinor` exactly: rejected as unscoped by §11's literal migration line, and redundant with the created agreement already holding the agreed terms.

## ADR-061: Idempotency for `POST /v1/inbox` Is a New User-Keyed Table, Not a Polymorphic Column on the Existing One

**Status**: Active
**Date**: 2026-10-13
**Context**: MUT-131, found while planning MUT-125 (the phone app's offline outbox needs to replay a POST to learn whether it already committed, before deleting a not-yet-confirmed entry — safe only where the server dedupes by `Idempotency-Key`). `/v1/income`, `/v1/expenses` and both `/v1/inbox/{id}/file-as-*` routes already wrap in `idempotent(store, operation)`; the plain `POST /v1/inbox` (MUT-66) never did. `idempotent()` and the backing `IdempotencyKey` model partition every claim by `organizationId` — a required, non-nullable half of its composite primary key, with a hard FK to `Organization` — and the middleware reads `c.get('auth').organization.id`. `POST /v1/inbox` is one of the four plain inbox CRUD routes that are deliberately organization-independent (an unsorted entry belongs to the person, not an org — MUT-66): `authenticate()`'s `finishSessionAuth` only ever sets `c.get('identity')` for these routes, never `c.get('auth')`, so there is no organization to key against.

**Decision**: a new `UserIdempotencyKey` table, the same shape as `IdempotencyKey` but `@@id([userId, key])` with an FK straight to `User` — mirroring how MUT-66 itself solved "a resource that belongs to a person, not an organization": `InboxEntry` is a wholly separate table keyed by `userId`, no `organizationId` column at all, paired with `store-guard.ts`'s `sessionOnly` `MethodAccess` (an API key has no person behind it, so no inbox and no inbox-create claim either). A new `identityIdempotent(store, operation)` middleware mirrors `idempotent()`, partitioned by `c.get('identity').user.id` instead; the claim/in_progress/replay/mismatch state machine itself (`resolveClaim()`) is factored into one shared function both the organization-scoped and user-scoped implementations call, in both `memory.ts` and `prisma.ts`, rather than writing it a fourth time.

**Consequences**:
- Zero change to the 28 existing `idempotent()` call sites or their tests — the org-scoped `IdempotencyKey` table, its composite primary key, and `idempotent()` itself are untouched.
- A purely additive migration (`CREATE TABLE "user_idempotency_keys"`), no backfill — the table starts empty.
- Two idempotency tables exist side by side (`idempotency_keys`, `user_idempotency_keys`) rather than one. Accepted: the alternative (a polymorphic owner column) would have put a nullable-PK problem in front of 28 working call sites to serve a need only one route has today.
- `GET /v1/operations/{key}` (apiKey-only, reads `store.idempotency.get`) is unchanged and does not cover `POST /v1/inbox`'s claims — not asked for by MUT-131's AC, and an API key can't reach an organization-independent route anyway.

**Alternatives considered**:
- Relax `IdempotencyKey.organizationId` to nullable, add a polymorphic `ownerType`/`ownerId` pair: rejected — Postgres composite primary keys can't contain a nullable column, so this would have meant restructuring the primary key every one of the 28 existing callers depends on, to serve a single new caller. No precedent for a polymorphic owner column anywhere in `schema.prisma`; every existing `entityType`/`entityId` pair discriminates which table a row *references*, always alongside a still-required `organizationId`, never as a replacement for it.
- Give `POST /v1/inbox` a dedicated, non-shared dedup mechanism (e.g. a unique constraint on the request body itself): rejected as a second, divergent idempotency implementation instead of reusing the established claim/replay/mismatch contract every other create route already has tests and client expectations built around.

## ADR-062: Expense Totals Sum `db.expenses` and Legacy `kind:'expense'` Transactions Additively, Not as a Replacement

**Status**: Active
**Date**: 2026-10-13
**Context**: MUT-94 (Expenses "Total expenses" strip always ₪0). Since MUT-14, real expense creation writes `db.expenses` only (via `expenseRepo`), but `aggregateTransactionTotals`/`aggregateTransactionTotalsByCurrency`/`aggregateTransactionTotalsWithActivity` (`src/db/aggregations.ts`) still summed `expensesMinor` from `db.transactions`' `kind !== 'income'` rows — always zero for real data, since nothing writes that shape anymore from normal app usage. Reading the full call graph before fixing it turned up that the branch is not actually dead: `src/demo/seedData/transactions.ts` (demo mode) and `ImportDataModal.tsx`/`ImportDataPage.tsx` (CSV/backup import) both still create `kind:'expense'` transactions directly, bypassing `db.expenses` entirely (tracked as TD-105, MUT-138).

**Decision**: every expense-totals reader (`transactionRepo.getOverviewTotals`/`getOverviewTotalsByCurrency`, `projectSummaryRepo.list`/`get`, `InsightsPage`'s monthly trend) now sums `db.expenses` *in addition to* the existing `db.transactions` `kind:'expense'` sum, rather than replacing the transaction-side sum outright. New expense-table filter/sum helpers (`filterExpensesByDateAndCurrency`, `filterExpensesByEntity`, `filterExpensesByEntityAndDate`, `sumExpensesMinor`, `sumExpensesByCurrency` in `src/db/aggregations.ts`) mirror the existing transaction-side ones exactly, operating on `Expense[]`.

**Consequences**:
- Demo seed data and any already-imported legacy expense still counts correctly in totals — no silent data loss for existing users who imported expenses before MUT-138 lands.
- The two sources are table-disjoint (nothing writes both for the same logical expense), so the additive merge cannot double-count.
- This is a totals-level correctness fix, not a fix for the underlying two-table split (TD-105) — imported expenses are still invisible on the `/expenses` ledger page itself, just no longer silently dropped from financial totals. MUT-138 is the follow-up that fixes the write path.

**Alternatives considered**:
- Delete the `kind !== 'income'` branch entirely (it "looks dead" from the UI's normal create flow): rejected after finding Import and demo seed data still depend on it — would have been a regression, not a cleanup.
- Fix only `ExpensesLedgerPage`'s strip (the literal ticket title) and leave `projectSummaryRepo`/`InsightsPage` broken: rejected — same root cause feeds Projects, Project detail, Insights, and Reports; a UI-only patch would have left three more readers silently wrong.

## ADR-063: Settings IA Reorg — Page Order Over Header Merges, Placement Only

**Status**: Active
**Date**: 2026-10-13
**Context**: MUT-139, design brief `.claude/designs/settings-ia-reorg.md`. `/settings` had grown section-by-section: "Enabled currencies" was commented-out dead code since the initial commit, Data/Data Tools and About/Updates/Desktop App read as fragmented, and "Default Currency"/"Default Language" collided between the global page and two per-profile forms. `SettingsPage.a11y.test.tsx` requires every section title to be a flat h2 with zero h3 subheadings, which rules out subheading-based merges as a fix for fragmentation.

**Decision**:
1. **Reorder, don't nest.** New section order: Business Profiles → Language → Theme → Currency → Advanced Features → About → Data → Data Tools. Business Profiles moves to the top since every other section is profile-scoped. Data and Data Tools become the last two sections specifically so their proximity (the original "fragmented" complaint) costs zero visual change — `DataToolsSection` has always rendered outside the `page-content` div's inline `maxWidth: 600`, so moving it would have changed its rendered width; moving About up instead avoids that trade entirely.
2. **Merge only where there is no standalone test to break.** About, Updates and Desktop App merge into one new `AboutSection.tsx` under a single heading — none of the three had a standalone component test (only `SettingsPage.a11y.test.tsx`'s heading-presence list covered them). `DataToolsSection` stays a separate component with its own heading because `DataToolsSection.test.tsx` renders it standalone and asserts that heading directly; merging it into "Data" would have broken a real test for no IA gain, since proximity is already solved by page order.
3. **Restore dead code, don't rebuild it.** The "Enabled currencies" toggle (`handleCurrencyToggle` and its UI) was commented out since the initial commit — the i18n keys already existed in both languages. Restored as-is (USD/ILS only, matching `ProfileDetailPage`'s existing "Allowed Currencies" scope), not expanded to cover every `Currency` value (that's TD-107).
4. **Disambiguate collided labels, don't invent new i18n infrastructure.** "Default Currency"/"Default Language" in `ProfileDetailPage`'s Document Defaults tab and in `BusinessProfileDrawer` are renamed to "Document Currency"/"Document Language". Both files are already entirely non-i18n'd (hardcoded English); a plain string edit matches the existing (pre-existing, untracked) convention in those files rather than introducing one-off i18n keys into an otherwise hardcoded surface.
5. **Two findings from the original design brief were corrected, not implemented, after reading the actual code/tests:** the sidebar `ThemeToggle` and Settings → Theme are a documented, tested, intentional shared-`useTheme()`-state pattern (MUT-79), not a duplicate — dropped from scope. `/settings/import` already has a working "← Back to Settings" button; it just doesn't use the shared `TopBar`/breadcrumb component other Settings sub-routes use — logged as TD-108 rather than forcing a header-component swap (which would have replaced the page's entire custom header, a materially larger and visually different change than the IA-only scope of this ticket).

**Consequences**:
- About gives up the conventional "very bottom" position (common in platform Settings apps) so the Data/Data Tools proximity fix can be zero-visual-change. A deliberate trade, confirmed with Basel during planning.
- `SettingsPage.tsx` shrank from one large file with 10 inline/near-inline sections to 2 extracted components (`AdvancedFeaturesSection`, now also `AboutSection`) plus `DataToolsSection`, following the project's existing split-component convention rather than introducing a new one.
- The manual FX rate entry called for in CLAUDE.md's Settings spec stays unbuilt — explicitly out of scope (needs its own design pass); the Currency section keeps its current title rather than being renamed to "Currency & Exchange Rates" ahead of that feature existing.

**Alternatives considered**:
- Merge Data and Data Tools into one heading (matching the About merge): rejected — `DataToolsSection.test.tsx` asserts a standalone heading; the IA goal (proximity) is already met by page order, so the merge would have bought nothing but test churn.
- Move `DataToolsSection`'s render call inside the `maxWidth: 600` `page-content` div to sit directly after "Data" without reordering About: rejected — this is itself a visual change (width), and the ticket's explicit scope is placement/IA only, not UI.
- Convert `ImportDataPage.tsx` to `TopBar` + breadcrumbs as originally scoped in the design brief: rejected once the actual file was read — it doesn't use `TopBar` at all today, so this would mean replacing its entire custom header, not adding one prop. Logged as TD-108 for a dedicated pass instead.

## ADR-064: Settings Visual Redesign — Materials, Hierarchy and a Reusable SegmentedControl, Verified Against a Real Render

**Status**: Active
**Date**: 2026-10-13
**Context**: MUT-139 follow-up. After the IA reorg (ADR-063), Basel asked for a visual pass: each `.settings-section` was a flat list of bordered-title blocks with no material hierarchy (CLAUDE.md's "cockpit, not CRUD" spec). A wireframe (`.claude/designs/mut-139-settings-visual-redesign-wireframe.html`, built from real Brand v2 tokens) was reviewed and refined twice (merge Preferences+Currency into one card; tighten every subtitle) before implementation.

**Decision**:
1. **`.settings-section` gets real card chrome** (`--surface`, `--border-subtle`, `--radius-card`, `--shadow-1`) instead of a bare bottom-border title — this one shared class change cascades to every section (inline + `AdvancedFeaturesSection` + `AboutSection` + `DataToolsSection`) with no per-file wiring.
2. **Language + Theme + Currency merge into one "Preferences" card** (new `settings.preferences.title`/`description` i18n keys) — a further grouping refinement beyond ADR-063's reorder, decided during the visual pass once the three cards' redundant header/description overhead was visible side by side. The "Currency" group inside it is a plain-text `.settings-subdivider`, never a heading — `SettingsPage.a11y.test.tsx` still requires zero h3s.
3. **New `SegmentedControl` component** (`src/components/ui/SegmentedControl.tsx`) — a single-select radiogroup with a sliding thumb, replacing the ad-hoc button-loops for Language and Theme. First real consumer of the brand's `--ease-spring`/`--duration-toggle` tokens (defined in MUT-102, unused until now). The thumb is positioned by mutating a ref's inline style inside `useLayoutEffect`, not `setState` — measuring DOM geometry needs a laid-out DOM, unavailable at render time, and `react-hooks/set-state-in-effect` is a hard lint error in this repo; `TruncatedTitle.tsx` already established the "position via ref mutation, not state" pattern for exactly this case.
4. **`DataToolsSection` moves inside the `page-content` `maxWidth: 600` container**, wrapped with Data in a new `.settings-family` div that collapses both cards' margins to one tight, deliberate gap. ADR-063 deliberately kept it outside that container to avoid any width change; a real browser screenshot showed the "quieter tint" alone didn't read as nested — it looked like a second full-bleed section. Confirmed with Basel before changing it, since it reverses a prior explicit decision.
5. **Every new card subtitle is a short fragment, not a sentence** (e.g. "Manage who you're billing as.", "Export, import and back up.") — Basel's explicit minimalism note on the wireframe. A dev-facing scope annotation (the FX-rates-not-built note) was cut from the card copy entirely and kept only in the wireframe's own legend; it was never real product copy.
6. **Enabled-currencies toggle buttons use a soft `accent-subtle`/`on-accent-subtle` fill** (`.currency-toggle-on`), not `btn-primary`'s solid fill — a real screenshot showed the solid pills read as visually loud next to the segmented controls' soft pills in the same card. `ProfileBadge` (already used by `ProfileSwitcher`) is reused as the Business Profiles list's no-logo avatar fallback rather than building a new initials component.

**Consequences**:
- Verified against an actual Playwright screenshot (light + dark), not just the wireframe — caught two real defects the wireframe couldn't show (Data Tools' width mismatch, the currency pills' visual weight) before landing.
- `DataToolsSection` gains its first-ever width constraint; this is the one deliberate reversal of an ADR-063 decision, made only after seeing the rendered page.
- `SegmentedControl` is now the established pattern for any future small fixed single-select choice in this app; a second ad-hoc button-loop implementing the same thing should reuse it instead (COMPONENT_REGISTRY).

**Alternatives considered**:
- CSS-only sliding thumb via radio inputs and `:checked` siblings (no JS measurement): rejected — Language/Theme are controlled by existing app state (`useLanguage`/`useTheme`), not local form state, so the control has to be driven by `value`/`onChange` props either way; a measured-thumb approach composes with that directly.
- Leaving Data Tools outside the capped container and accepting it reads as "a separate quieter section" rather than nested: offered to Basel as the status-quo option; he chose to fix the width instead once he saw the screenshot.

## ADR-065: Money-Parsing Functions Require an Explicit `currency` Parameter — No Default

**Status**: Active
**Date**: 2026-10-13
**Context**: MUT-140 added JOD (a 3-decimal/fils currency) alongside USD/ILS/EUR (all 2-decimal). `src/lib/utils.ts`'s `formatAmount`/`parseAmountInput`/`parseAmountToMinor`/`parseCurrencyInput` previously hardcoded a 2-decimal assumption (`/100`, `MINOR_DIGITS = 2`) with no currency parameter at all. The sister Flutter app hit the identical risk shape: it shipped JOD at 2 decimals first (MUT-72) as an accepted shortcut, then needed a dedicated, riskier follow-up ticket (MUT-119) to rework its money codec because the 2-decimal assumption was baked into shared formatting/parsing code with no compiler signal pointing at the call sites that needed fixing.

**Decision**: `parseAmountInput`'s `ParseAmountOptions.currency` and `parseAmountToMinor`/`parseCurrencyInput`'s `currency` parameter are **required, with no default value**. The exponent (2 or 3 decimal places) is derived from the passed currency via `currencyExponent()`, never from a global constant. A caller that omits currency fails to compile; it cannot silently fall back to a 2-decimal assumption the way the pre-MUT-140 code (and the Flutter app's first pass) did.

**Consequences**:
- Every existing call site across the codebase had to be updated to pass its own transaction/entry's currency explicitly (`IncomeDrawer`, `ExpenseDrawer`, `RetainerDrawer`, `PlanAssumptionDrawer`, `recurringAttention.ts`, `paymentEntry.ts`, `csv.ts`, `DocumentDrawer.tsx`) — a larger one-time diff than a defaulted parameter would have required, but it surfaced several genuine pre-existing bugs along the way (hardcoded `/100` conversions in reset/prefill handlers and CSV export that a default would have let continue compiling silently wrong).
- Adding a future 5th currency repeats this same forced-migration shape by design — that is the intended safety property, not a cost to engineer around.
- `amountInputCurrency()` (detects a typed currency symbol/code in free text) still calls `parseAmountInput` internally and must pass *some* currency even though the result's scale is irrelevant to its own logic (it only checks parseability, then reads the token separately via `splitCurrencyToken`) — it passes `'USD'` with a comment explaining why any currency is safe there.

**Alternatives considered**:
- Default `currency` to `'USD'` to minimize the diff: rejected — this is the exact failure mode ADR exists to prevent. A future JOD (or 5th-currency) call site added without passing currency would compile cleanly and silently round wrong, discovered only in production, mirroring the Flutter app's MUT-72→MUT-119 path.
- Keep a global `MINOR_DIGITS = 2` constant and special-case JOD inline at each call site: rejected — reintroduces the global-assumption shape this decision exists to remove, just with more scattered special-casing instead of one per-currency source of truth (`CURRENCY_EXPONENT`/`currencyExponent()`).

---

## ADR-066: A Person's Own Profile Seeds a Personal Expense Preset, Keyed on `personalOwnerUserId`, Not on "No Writer of Record" (Amends MUT-42 D2)

**Status**: Active
**Date**: 2026-10-13
**Context**: MAL-1118 (blocks MUT-143, categories on personal profiles in the iPhone app). MUT-42 D2 seeded the general business preset "on a personal profile", meaning any profile whose writer of record is null. MUT-120 later gave every user one personal organization, marked by `personalOwnerUserId`, and since then writer-null covers two different things: that person's own profile and a firm with no Malafat link. The ticket asked for a household preset for "personal (non-Malafat)" profiles. Seeding runs once, on a profile's first category list, so a wrong selector mis-seeds permanently.

**Decision**:
1. `presetFor({ writerOfRecord, personal }, locale)` picks law-firm when the writer of record is `MALAFAT`, the new **personal** preset when the organization has `personalOwnerUserId`, and general otherwise. A firm without a Malafat link keeps the general preset. A personal organization can never be Malafat-connected (no key can be issued for one, MUT-120), so the order only matters defensively.
2. `PERSONAL_PRESET` (Transportation, Car, Rent, Groceries, Supplies, Gifts, Investments, Projects, Leisure, Other; en/ar) is **server-only**. D2's rule that server presets copy the offline app's does not apply to it: the offline app has no personal profile to give it to, and an unused export there would sit beside `ALL_CATEGORIES`, the offline fallback picker. In place of the parity check, `presets.test.ts` pins its order and translations, and checks every preset's names are distinct under `categoryNameKey` — the production unique key; the Postgres seed uses `skipDuplicates`, so a clash would silently seed one category short rather than fail.
3. No backfill. Personal profiles whose first list ran before this change keep the general list; MUT-143 gives users rename and archive.

**Consequences**:
- The seed audit row's `metadata.preset` gains a third value, `personal`.
- "Personal" now has two meanings in the server and they must not be swapped: MUT-65's writability ("no CONNECTED integration", `ProfileWriter === null`) and MUT-120's own profile (`personalOwnerUserId`). `writability.ts`'s `ProfileWriter` doc comment says so.
- API 1.19.0-mal1118 (route description only).

**Alternatives considered**:
- Key on writer-null, the ticket's literal wording: rejected — a firm with no Malafat link would get Groceries and Gifts instead of Office Rent and Bank Fees, permanently.
- Mirror the personal preset into `src/db/defaultExpenseCategories.ts` to keep D2's parity rule universal: rejected — dead code in the desktop bundle, one careless edit away from the fallback picker.

**Amendment (MUT-182, 2026-10-14)**: the selector is the profile's **type**, not `personalOwnerUserId`: `presetFor({ writerOfRecord, profileType })` → law-firm when Malafat writes, personal when `profileType === 'PERSONAL'` (the MUT-120 profile, now backfilled PERSONAL, or one a person created as personal), general for BUSINESS and every operator firm (type null). Decision 3's "seeds once" now reads **seeds once per type**: changing an owned profile's type (`PATCH /v1/profiles/{id}`) replaces every category — custom and archived ones included — with the new type's preset in the user's language and leaves each expense that had one uncategorized, in one transaction that holds the organization row; the lazy seed takes the same lock, so the two can never leave a mixed set (eng review D3). The owner chose replace over merge.

**Amendment (2026-10-22, Basel)**: the preset *content* for a Malafat-fed firm changes; the selector does not. Basel: "it shouldn't be only LEGAL, it should be general business expenses (legal/accountant only if Malafat connected firm)". `LAW_FIRM_PRESET` (and the offline `LAW_FIRM_CATEGORIES`, kept in parity) is now the general list in its order, then six costs only a law or accounting firm has (Court & Filing Fees, Notary & Service Fees, Experts & Translation, Professional Association Fees, Professional Liability Insurance, Continuing Professional Education), then Other. Malafat serves law and accounting firms and the server can't tell which, so the extras cover both. Every non-Malafat profile still gets the general or personal list; no legal category appears there. The preset name stays `lawFirm` (it is in the API's type-change preview enum). No backfill: the seed runs once, so a firm whose first list ran earlier keeps the legal-only list until someone adds the missing categories.

## ADR-067: Document Generation Is Retired; Its Tables Stay, Its Lock Is Unwound in Code, Its Profile Fields Go (Supersedes ADR-014; Narrow Override of ADR-032 and MUT-13)

**Date**: 2026-10-13
**Status**: Accepted
**Context**: MUT-145 (epic MUT-2). Plan and eng-review ledger: `.claude/designs/mut-145-remove-documents.md` (D1–D15, R1–R4, T1–T3, IA1–IA4).

Mutaba3a records what happened (income, expenses, who owes what). It does not issue documents. MUT-2 had gated invoices/receipts/credit notes/price offers behind the `invoices` optional area (MUT-13, ADR-032). MUT-145 removes the feature outright. Filed receipts (expense attachments, the receipts ZIP) and the hosted portal's `/documents` attachments (ADR-028) are a different feature and stay.

**Decision**:
1. **Code goes, tables stay (applies ADR-029; eng-review D5).** The documents module, pages, drawer, PDF renderer (`@react-pdf/renderer`), numbering, payment-request service, PDF archival, the `invoices` switch and its probe are deleted. `documents`/`documentSequences` stay at schema v21. Their row types live in `src/db/retained/documentSchema.ts`; only indexed and linking keys are typed, and the rest is opaque. The rows still round-trip through backup/restore and the per-profile export/import. No schema bump and no row rewrite.
2. **The lock is unwound in code, not by migration (D6).** It existed only as guards in `transactionRepo.update`/`softDelete`, `isLocked`, `TransactionLockedError` and IncomeDrawer's notice. Deleting them unlocks every legacy-locked entry at once. Stale `lockedAt`/`lockedByDocumentId`/`linkedDocumentId` stay inert in old rows, and the types no longer declare them.
3. **A stored `invoices` key is inert.** `resolveFeatures` already drops unknown keys. `useFeatureNotice` now filters a pending notice through `FEATURE_KEYS`, so a v20 upgrader's banner never shows a raw i18n key (D7).
4. **Stale links land somewhere real (D3).** `/documents`, `/documents/*` and `/settings/profiles/:id` redirect to `/` and `/settings`. The router has no not-found component.
5. **The business profile is ledger-shaped (D1, T1, IA1–IA4).** `businessType`, `defaultLanguage`, `website`, template/VAT/allowed-currency defaults, bank/payment details and the 8 letterhead fields (`taxId`, `address1/En`, `city/En`, `country/En`, `postalCode`) leave the type; old rows keep them. Email becomes optional. The profile is edited only in `BusinessProfileDrawer` (Identity / Money / Contact), and `ProfileDetailPage` is deleted. `nameEn`, `logoDataUrl`, `email`, `phone` and `primaryColor` stay because live screens read them.
6. **No UI claims document generation.** That covers en/ar copy (Settings, welcome, Insights, Data export) and the landing FAQ and privacy text (ADR-041): "documents you generate" became "receipts you attach". The income status "Invoiced" stays: it is a ledger state (billed outside the app).
7. **Profile import is fixed in the same change (MUT-158, approved mid-build).** The dead `ImportDataModal` was the only v2 importer, and it mis-linked rows. `src/db/profileImport.ts` re-mints IDs and remaps every reference in one transaction. It dedupes inside the target profile only (ADR-049), never rewrites a merged-into profile, and matches profiles by id or by a non-empty email on both sides.

**Consequences**: The removal deletes about 17k lines across 105 files and drops a dependency plus 4.3 MB of PDF-only fonts from every build. Guards: `noDeadDocumentModules.test.ts` (paths, names, `@react-pdf`, `/fonts/`, barrels) and `retainedDocumentSchema.test.ts` (tables at v21 and the backup round trip). Follow-ups: TODOS #9 (drop the Tauri fs plugin and `$DOCUMENT` write capability); MUT-106 is obsolete; the per-profile export still omits payment records, expenses and receipts (TD-111).

**Alternatives Considered**: dropping the tables with a v22 migration, as the ticket text first said (rejected: issued invoices are user records, ADR-029); a v22 upgrade clearing the lock fields (rejected: same user outcome with a forced bump and row rewrites); keeping the dead modal as the v2 importer (rejected: unrendered and mis-linking); db-wide duplicate detection on import (rejected: links one business's entries to another's client).

## ADR-068: Currency Conversions Are a New Transaction `kind`, Excluded From P&L by Tightening the Existing Income/Expense Branches, Surfaced on a New Dedicated `/conversions` Page Gated by a 7th Feature Flag

**Status**: Active
**Date**: 2026-10-13
**Renumbered on merge**: this branch's ADR-067 → **ADR-068**, TD-110 → **TD-112**, TD-111 → **TD-113** — MUT-145 (merged to main first) independently claimed ADR-067 and TD-110/TD-111 for the unrelated document-generation removal above.

**Context**: MUT-141 ("log currency conversion events, no balance tracking, no fund-tracing"). The ticket's own text assumed two things that turned out false once the code was read: (1) that `kind==='income'`/`'expense'` aggregation functions already allowlist those kinds explicitly, so a new kind would be excluded "by construction" — in fact 5 of them use `if (kind==='income') {...} else {...}`, where `else` means "anything that isn't income", so a new `'conversion'` kind would have silently inflated expense totals; and (2) that a live "Transactions ledger" exists to add a row to — `/transactions` is a pure redirect to `/income`, and `TransactionsPage.tsx`/`TypeSegment` (the ledger CLAUDE.md describes) are dead code with zero live callers, confirmed via `router.tsx` and a pre-existing project-learnings pitfall note. Income and Expenses have been two separate, purpose-built pages reading different tables since MUT-5/14/83, not a unified ledger.

**Decision**:
1. **New `kind: 'conversion'`** on the existing `Transaction` entity, with new optional `toCurrency`/`toAmountMinor` fields for the destination leg (`currency`/`amountMinor` stay the source leg). No Dexie version bump: `kind` is an already-indexed field (new string values don't need a schema change), and the two new fields are unindexed and never retrofitted onto existing rows (unlike v14's `receivedAmountMinor`, which needed a backfill `.upgrade()` because it changed the meaning of existing rows).
2. **The P&L exclusion is made real by tightening 5 bare `else` branches to `else if (kind === 'expense')`** (`aggregateTransactionTotals`, `aggregateTransactionTotalsByCurrency`, `aggregateTransactionTotalsWithActivity` in `src/db/aggregations.ts`; `calculateForecastKPIs`, `calculateMonthActuals` in `src/lib/aggregations.ts`), matching the one function that already did this correctly (`calculateDailyBalances`). This is additive-safe — it only changes behavior for the new kind — and was checked against ADR-062's documented legacy-expense carve-out (`kind!=='income'` rows from demo seed / CSV import still need to count as expenses) to confirm the tightening doesn't regress that path.
3. **`TxStatus` is not widened.** A conversion has no due date or partial-payment concept, so every conversion row is created with `status: 'paid'`, hardcoded, never shown in the UI — cheaper than teaching every existing `status==='paid'/'unpaid'` switch in the codebase to consider a third value it doesn't expect.
4. **Conversions get their own new dedicated page, `/conversions`**, not a branch inside `IncomePage`/`ExpensesLedgerPage` and not a revival of the dead unified-ledger code — confirmed with Basel after the dead-ledger finding above. This mirrors the Income/Expenses split-by-kind precedent exactly: its own query hook (`useConversionQueries.ts`, wrapping `transactionRepo.list({kind:'conversion'})` with zero repository changes), its own drawer (`ConversionDrawer.tsx`, a third sibling alongside `IncomeDrawer`/`ExpenseDrawer` — a two-currency form doesn't fit either existing drawer's shape), its own row (both amounts + implied rate, since `AmountWithConversion` is built for one amount with an FX tooltip, not two).
5. **A new 7th `FeatureKey`, `'conversions'`**, not an ungated nav entry. The sidebar nav has exactly two tiers — a frozen 3-item core list (ADR-034/MUT-15) or the feature-gated optional list — so showing `/conversions` in the sidebar at all forced this choice; there is no third "ungated but not core" slot. `FEATURE_DATA_PROBES.conversions` is `[]` (never auto-enabled by data), the same empty-probe treatment `insights` already has, for a stronger reason: this is a brand-new `kind` value that cannot exist in any pre-upgrade database, so there is no "existing data hidden behind an off toggle" risk to guard against on first rollout (TD-112 notes the one later risk this reopens: a cross-device backup restore containing real conversion data, imported before the user ever toggles the area on locally).

**Consequences**:
- Every real P&L totals reader that goes through the shared module (`getOverviewTotals`, `getOverviewTotalsByCurrency`, `projectSummaryRepo.list`/`get`, client summary) funnels through the three patched `db/aggregations.ts` functions, so the exclusion is centralized there, not re-implemented per call site. **Caught by qa-reconcile, not by the original build:** `InsightsPage.tsx` computes its own `summaryTotals` independently, with the identical bare-`else` bug duplicated inline rather than calling the shared helpers — fixed in a follow-up commit, TDD, after a repo-wide re-sweep of every `kind === 'income'` call site. `ReportsPage.tsx` has the same inline duplicate but is unreachable dead code (`/reports` redirects to `/insights`, confirmed via `router.tsx`) and was left untouched, consistent with how the ticket's other dead-code discoveries were handled.
- `addMenuActions.ts`'s `AddMenuAction` and `FEATURE_KEYS`/`FEATURE_DATA_PROBES` all gained a 7th member in lockstep — any future optional area follows the same two-list pattern, not a new one.
- CSV export/import/validation (`csv.ts`, `csvValidation.ts`, `ImportDataPage.tsx`) gained `toCurrency`/`toAmount` columns and a `validateConversion` case; only the live `ImportDataPage.tsx` was touched, not the dead `ImportDataModal.tsx`.
- `ImportDataPage.tsx`'s new conversion-import branch uses currency-aware `parseAmountToMinor` for both legs, unlike its income/expense branches above it, which predate MUT-140 (ADR-065) and still hardcode base-100 — logged as TD-112 rather than fixed, since fixing those is unrelated scope.

**Alternatives considered**:
- A fully separate `CurrencyConversion` entity (the ticket's own rejected alternative): would have duplicated the drawer/list/CSV infrastructure this ticket already builds, for something still fundamentally a dated money-movement record.
- A linked Income+Expense pair with an `excludeFromTotals` flag (also the ticket's own rejected alternative): an exclusion-list safety model where every current and future report must remember to check the flag, with the two rows able to drift out of sync independently — the naive version (no flag) would have actively inflated both Income and Expense totals with non-operating cash movement.
- Folding conversion rows into `IncomePage`/`ExpensesLedgerPage` instead of a new page: rejected once the dead-ledger finding surfaced — both pages' query hooks are single-kind by construction, and a conversion row's two-amount shape doesn't fit either page's single-amount-with-tooltip cell.
- Leaving `AddMenuAction`/sidebar nav ungated (no new feature flag): not actually available once the nav's two-tier structure was read — there is no ungated-but-not-core path for a new nav entry.

## ADR-069: Import Writes Expenses Through expenseRepo; a Legacy kind:'expense' Transaction Gets Its Own Minimal Edit Drawer, Not IncomeDrawer

**Status**: Active
**Date**: 2026-10-13
**Context**: MUT-138 (TD-106, follow-up to MUT-94/ADR-062). Since MUT-14, real expense creation writes `db.expenses` only, but `ImportDataModal.tsx`/`ImportDataPage.tsx`'s CSV path still wrote imported expense rows as `kind:'expense'` transactions into `db.transactions`, so they never appeared on `/expenses`. Separately, `ProjectDetailPage.tsx`'s row-click handler for such a legacy row called `openExpenseDrawer({ expenseId: id })` using the transaction's `db.transactions` id, which `ExpenseDrawer` then looked up in `db.expenses` and found nothing.

**Decision**:
1. **CSV import creates expenses via `expenseRepo.create`** (new shared helper `src/utils/csvImport.ts`), resolving categories against the profile-scoped `db.expenseCategories` table instead of the legacy global `db.categories`.
2. **One `profileId` is resolved per CSV import run and threaded through every entity it creates** — clients, projects, income, and expenses alike, not just expenses. The CSV profile selector already required a choice whenever a profile existed; no entity type had ever actually used the selection. Without this, an imported expense would be visible in a profile-scoped view while its sibling client/project/income from the same import silently dropped out (`scopeToProfile`, `src/db/baseQuery.ts`, excludes an unscoped record from any specific-profile or All-businesses view). When no profile exists yet, `resolveImportProfileId()` auto-creates one via `businessProfileRepo.create`, mirroring `WelcomeModal`'s "Skip" action shape (`name: 'Default Profile'`/Arabic equivalent, `defaultCurrency: 'USD'`, `isDefault: true`) — reusing an existing, shipped pattern rather than inventing a new default-profile shape.
3. **A pre-existing legacy `kind:'expense'` transaction is edited through a new, separate `LegacyExpenseEditDrawer`** (+ `legacyExpenseDrawer` store slot), not `IncomeDrawer`. `IncomeDrawer`'s save path (`src/lib/incomeEntry.ts`) hardcodes `kind: 'income'` on every write, so routing a legacy expense through it would silently convert it to income on save — worse than the original no-op bug. The legacy-expense population is capped, not growing, once (1) lands: only demo seed data and anything imported before this fix remains in that shape. The new drawer reuses the shared `ExpenseFormFields` component (already split out for the hosted portal, MUT-44) rather than duplicating form fields, relaxing its `categoryId` to allow empty (a legacy row may have none) while keeping its TS shape a plain `string` so it still satisfies `ExpenseFormFieldsProps<T extends ExpenseFormFieldsShape>` structurally. Currency is widened to USD/ILS/EUR/JOD (MUT-140), with the same amount/currency `superRefine` `ExpenseDrawer`'s own `expenseDrawerFormSchema.ts` uses.
4. **Only the one real, routed call site is fixed.** `ProjectDetailPage.tsx` (routed at `/projects/$projectId`) gets the `LegacyExpenseEditDrawer` fix. `TransactionsPage.tsx` had the identical bug but was dead code — `/transactions` was a redirect-only route to `/income`, and `ImportDataModal.tsx` was never rendered by any live code path. Both were confirmed dead (independently, before MUT-145 merged) and left unfixed; MUT-145 (merged the same day, ADR-067) deleted both outright, porting `ImportDataModal`'s tests onto `ImportDataPage`.

**Consequences**:
- `/expenses` now shows every CSV-imported expense immediately, with the same category/client/project wiring a manually-created expense gets.
- A full CSV import batch (clients, projects, income, expenses) is now internally consistent under profile scoping — it either all belongs to one profile or none of it silently vanishes from a scoped view.
- `LegacyExpenseEditDrawer` is net-new surface area whose population can only shrink: once every `kind:'expense'` transaction a user has is edited or deleted, it has no remaining callers. Not registered as a general-purpose reusable component (COMPONENT_REGISTRY) — it is intentionally a one-off for this transitional population, not a pattern to repeat.
- Merging this branch with MUT-140/MUT-141/MUT-145 (all landed the same day) surfaced two real pre-existing gaps in shared code, fixed as part of this merge rather than left broken: `LegacyExpenseEditDrawer`'s amount-to-input prefill hardcoded `/100` (wrong for JOD's 3 decimals; now `currencyExponent(currency)`), and `ExpenseFormFields.tsx`'s amount input hardcoded `step="0.01"` regardless of currency — which silently blocked saving any 3-decimal JOD amount in both this drawer and the real `ExpenseDrawer` (a step mismatch fails the browser's native HTML5 constraint check before the submit event even fires, so Save does nothing, with no visible error). Step is now computed live from the current currency via `useWatch`.
- `ImportDataModal.tsx`'s identical fix did not survive this merge — MUT-145 deleted the file outright the same day, and its own (separately ported) test coverage moved onto `ImportDataPage.test.tsx`.

**Alternatives considered**:
- Migrating every existing legacy `kind:'expense'` row into `db.expenses` instead of building an edit drawer for the legacy shape: rejected, consistent with ADR-062's established direction — the two sources are read-side reconciled, not merged, and a migration here would need its own id-remapping and FK-rewrite story (receipts, recurring links) that a real `Expense` row carries and a legacy transaction row never did.
- Extending `IncomeDrawer` to branch on `kind` instead of a new component: rejected — `entryFields()`'s hardcoded `kind: 'income'` is load-bearing for every real income save; branching it for a shrinking, legacy-only population adds permanent complexity to a heavily-used, heavily-tested drawer for no ongoing benefit.
- Also fixing or deleting `TransactionsPage.tsx` as part of this ticket: rejected — it's unreachable from any route, so fixing it proves nothing a real user can observe, and MUT-145 (which landed before this branch merged) already owned its deletion.

## ADR-070: Hosted Conversions Are Their Own Prisma Model, Create + Read Only, Behind New Hosted-Only UI — Not a Transaction Kind, Not a Migration of the Local App's Files

**Status**: Active, except §2 ("create + read only") and §5's "create-only" drawer and no-JOD form, which ADR-075 (MUT-194, 2026-10-14) supersedes. The rest stands.
**Date**: 2026-10-13
**Context**: MUT-161 (server-side counterpart to MUT-141/ADR-068, unblocks MUT-159 mobile capture). The ticket's own text assumed two things that turned out false once the code was read: (1) that conversions should be "persisted as a Transaction/MoneyEvent of kind `conversion`" — the hosted server has no such generic table; every other kind (`Expense`, `Receivable`, `Payment`, `Attachment`) is its own first-class Prisma model; and (2) that "the portal's existing `useConversionQueries` / `ConversionDrawer`" should migrate off Dexie onto the new endpoint — those two files (`src/hooks/useConversionQueries.ts`, `src/components/drawers/ConversionDrawer.tsx`) are the **local/offline app's** components, not the hosted portal's; the hosted portal (`src/hosted/**`) has never reused a local hook or drawer (confirmed against the Expense precedent: `src/hosted/components/ExpenseDrawer.tsx` + `src/hosted/data/expenseQueries.ts` are hand-built siblings, not imports). Both corrections were flagged back on the ticket before planning further, the same shape as ADR-068's own corrections to MUT-141's text.

**Decision**:
1. **A new `Conversion` Prisma model** (`server/prisma/schema.prisma`), mirroring `Expense`'s shape minus the link/category fields it doesn't need: `occurredOn`, `amountMinor`/`currency` (source leg), `toAmountMinor`/`toCurrency` (destination leg), `notes`, `createdByUserId`, `createdAt`. This is also what makes "excluded from P&L by construction" literally true — a separate table no summary query (`/v1/summaries/organization`, `/v1/summaries/expenses`) ever touches, not an allowlist that could regress the way ADR-068 had to tighten bare-`else` branches for the local app's shared aggregators.
2. **Create + read only — no `PATCH`/`DELETE`, no `version`/`deletedAt` columns.** Confirmed with Basel before planning further: the ticket's AC never asks for edit/undo, unlike `/v1/expenses` (full CRUD) or `/v1/income`'s undo. A logging mistake is corrected with a new entry. Keeps the Prisma model schema-minimal and the surface MUT-159 (mobile) targets smaller.
3. **Session + device-session only, never an API key** — a new `conversions` row in the writability matrix (`server/src/auth/writability.ts`, `apiKey: 'none'`, `session: 'read-write'`, `writerOfRecord: 'USER'`), identical shape to the `expenses` row. New `conversions:read`/`conversions:write` scopes in `SESSION_ONLY_SCOPES` (`scopes.ts`), classified in the store guard (`store-guard.ts`).
4. **The route ports a validation rule the ticket's own description omitted**: `currency !== toCurrency` (422 `SAME_CURRENCY` on field `toCurrency`), already enforced by the local app's drawer (`src/components/drawers/conversionFormSchema.ts:39-45`) since MUT-141. Found by this ticket's own plan-review pass before any code was written. Without it, the hosted route would have been laxer than the local UI it's meant to match — any client bypassing a drawer (mobile/MUT-159, or a raw API call) could have logged a same-currency "conversion."
5. **New hosted-only UI, not a migration.** `src/hosted/data/conversionQueries.ts`, `src/hosted/components/ConversionDrawer.tsx` (create-only, two amount/currency legs, implied rate), `src/hosted/pages/views/ConversionsList.tsx` — built to the same pattern as the Expense trio. The local app's `useConversionQueries.ts`/`ConversionDrawer.tsx` are untouched. The hosted `ConversionDrawer`'s form schema and currency set (USD/ILS/EUR, no JOD) deliberately match the hosted `ExpenseDrawer`'s own pre-existing scope (TD-117) rather than extending JOD support to one new surface only.
6. **API contract version bumped**: `API_VERSION` (`server/src/app.ts`) `1.19.0-mal1118` → `1.20.0-mut161`, following the established per-contract-change convention (1.15.0-mut61, 1.16.0-mut100, 1.17.0-mut107).

**Consequences**:
- `GET /v1/me`'s `access` map gains a `conversions` key for free — `sessionAccessFor` iterates `WRITABILITY_MATRIX` generically, so no serializer change was needed; nothing reads it yet (the hosted nav/route join the other six sections unconditionally, matching existing behavior — none of them gate on `access` today).
- Regenerating `server/openapi/openapi.yaml` and `src/hosted/api/schema.d.ts` (both MUT-161 ACs) exposed a dormant, unrelated `tsc` failure in `src/hosted/components/ExpenseDrawer.tsx` (JOD added to `Currency` since MUT-140, never caught because nothing had regenerated+typechecked the hosted schema since). This branch's first patch was a one-line type cast; superseded the same day by `7428c63` ("hosted currency fix", landed on `main` independently), which gives `ExpenseDrawer` real JOD support instead — the cast was dropped on rebase (TD-117 narrowed accordingly: conversions is now the one hold-out).
- A regression test (`server/src/__tests__/routes-conversions.test.ts`) asserts a created conversion leaves `/v1/summaries/organization` and `/v1/summaries/expenses` byte-identical — the proof that "excluded by construction" is real, not just believed.

**Alternatives considered**:
- A generic kind column on a shared table, per the ticket's literal text: rejected once reading the schema showed no such table exists; would have meant retrofitting every other kind onto a new shared model instead, a far larger and riskier change than this ticket's scope.
- Migrating the local app's `useConversionQueries.ts`/`ConversionDrawer.tsx` to call the hosted API: not possible as stated — those files are the local/offline app's own Dexie-backed surface, structurally separate from `src/hosted/**`, and must stay Dexie-only per the project's local-first architecture.
- Full CRUD (matching `/v1/expenses`): offered as an explicit choice before planning further; create+read-only chosen since the ticket's AC never asked for edit/undo and a smaller, schema-minimal surface serves MUT-159 better.

## ADR-071: Every Storage Call Outside src/db Goes Through the Provider; Dexie Code Never Calls Back Out; ESLint Enforces It

**Status**: Active
**Date**: 2026-10-13
**Context**: MUT-47 set out to fix two documented-but-unchecked claims: CLAUDE.md's Phase 4 named a `test:integration` script that never existed, and TD-013 listed five objects outside `IRepositoryProvider`. Reading the code showed the seam was much leakier than recorded: the retainer "helpers" wrote Dexie directly, and CSV import, per-business export, "Delete all data", the migration wizard, demo seeding and five more `src/db` helpers (integrity check, orphan finder, backup/restore, cross-business stats, category seeding) were all called around the provider. Nothing enforced ADR-002's "UI never touches Dexie directly", so every new feature could drift it again. Decisions D1–D9 are in `.claude/designs/mut-47-data-layer-reconcile.md`.

**Decision**:
1. **Outside `src/db`, storage is reached only through `getRepositories()`.** No `db`, no repository object, no module whose exports read or write the database. Pure helpers, constants and types beside them stay importable. The single exception is `initDatabase()` in `src/main.tsx`, which opens Dexie and runs migrations before React mounts.
2. **A storage concern that is not one entity gets its own slot.** `dataset` (backup/restore, export/import, legacy and CSV import, wipe, integrity and orphan checks, post-load feature reconcile) and `demoData` (the `?demo=1` seed and the visitor sample). Operations on one entity become methods on that entity's slot (`projectedIncome.match/unmatch/refreshDueStates/markMissed`, `retainerAgreements.getSummary`, `transactions.listNeedsReview/resolveNeedsReview`, `clientSummaries.getCrossProfileStats`, `expenseCategories.seedDefaults`). The provider grows from 18 to 23 slots.
3. **Dexie implementation code may call other Dexie code directly and must never resolve storage through the provider.** `retainerRepo` calls `scheduleGenerator` from create/update/activate/resume; if the generator asked `getRepositories()`, a Dexie write would land schedule rows in whatever source a test or future SQLite build injected. Duties like this are written on the interface ("create/update/activate/resume maintain the projected schedule") so a second implementation knows to do them.
4. **Moves are byte-identical, pinned by characterization tests written against the old call path first.** One deliberate change: `dataset.importLegacyV1` runs its clear and six writes in one transaction (all or nothing; the test is red without it). Rough edges found on the way are TODOS #10–#12, not silent fixes.
5. **ESLint enforces it.** An app-scope `@typescript-eslint/no-restricted-imports` block (`eslint.config.js`) rejects the storage modules and the `db`/repository names outside `src/db` (tests and the hosted portal excluded); `src/__tests__/seamLint.test.ts` proves the rule's shape.

**Consequences**:
- "Every storage call is behind the seam" is now checked by `npm run lint`, not asserted in a comment (the failure mode MUT-35 and MUT-47 each found).
- A new storage module must be added to the lint pattern list, or the rule quietly misses it; the list sits beside the rule with the reason.
- Components lose some direct Dexie conveniences (raw `toArray()` scans); they ask for a named method instead, which a future SQLite source must implement.
- The MigrationWizard's business picker now lists businesses sorted by name (`businessProfiles.list()`), the one visible difference of the move.

**Alternatives considered**:
- *A note in `interfaces.ts` listing what sits outside the seam*: rejected at D2/D4/D5; it would document accidents as decisions and stay unchecked.
- *Rewrite the retainer helpers as services over primitive repository methods*: rejected at D3; `retainerRepo` itself calls the schedule generator, so a service resolving storage through the provider would invert the layering.
- *A guard test grepping for imports* (the repo's `no*Modules` style): rejected at D6 in favour of lint, which flags a bypass in the editor before commit.
- *A `test:integration` script*: rejected at D1; integration tests live beside unit tests, so an alias would be a check that checks nothing new.

---

## ADR-072: Settings "Your Data": One Back Up, One Type-Sniffing Restore; the Data Layer Owns "Exactly One Default Business"

**Status**: Active
**Date**: 2026-10-13
**Context**: MUT-88 (decision S1 in `.claude/designs/landing-apple-redesign.md`; plan and eng review in `.claude/designs/mut-88-settings-five-groups.md`). After MUT-139, Settings still offered two exports ("Export Data" and "Export Backup") and two restores ("Import Data" and "Import Backup"). Delete all data sat in the same card. Its "back up first" step downloaded three CSVs that Restore can't read, and they left out businesses, expenses and receipts. Two Default badges could appear because three writers bypassed the repo's default handling: the demo seed, `importProfileFile` and `restoreFromBackup`. The seed also read "is there a default?" outside its transaction, so a welcome-modal profile created in that gap became a second default.

**Decision**:
1. **Order (Basel, 2026-10-13):** Businesses → General → Features → About → Your data, then Delete all data alone below every card. This keeps ADR-063's spine (Businesses first, data last), not S1's literal order.
2. **Your data has five rows, each once:** Back up · Restore · Export a business · Export receipts · Check data (`YourDataSection`, which replaces the inline Data block and `DataToolsSection`).
   - **Back up** is the whole database. **Export a business** (`ExportDataModal`, per-business CSV/JSON) stays a separate row because it does a different job.
   - **Restore** is one picker. `classifyDataFile` reads the file once and routes it:
     - a full backup → `RestoreBackupModal` (date and record count), then replace;
     - a one-business export or a CSV → `/settings/import`, through a one-slot hand-off (`setPendingImport` / `takePendingImport`) taken once the profiles query has loaded;
     - anything else → an error toast.
3. **`settings.lastBackupAt`** (ISO, on the settings row) is stamped by `backUpNow()`, but only after the file was produced. A restore sets it to the restored backup's own `timestamp`. MUT-90 builds its reminder on this field.
   - **Merged onto MUT-47/ADR-071's seam:** `backUpNow` lives in `src/utils/backupDownload.ts` (the browser-only download helper, not `src/db`) and calls `getRepositories().base.dataset.serializeBackup()` / `.settings.update()`. `YourDataSection` and `RestoreBackupModal` reach `integrityCheck` and `restoreBackup` the same way, never a direct `db/*` import.
4. **Exactly one default business, enforced in the data layer.** There is one rule, `pickDefaultProfileId(profiles, preferId?)`:
   - exactly one active default → keep it;
   - otherwise the caller's `preferId` (a caller making a default flags its row first and passes its id);
   - otherwise, among the active defaults (or every active profile when none is default), a real profile before a `demo_` one, then the earliest `createdAt`;
   - archived profiles never qualify.

   `enforceSingleDefaultProfile` runs inside every writer's own transaction: repo create/update/setDefault/archive, `demoData.seed()` (MUT-47's seam, not a raw `db.transaction` in `src/demo`), `importProfileFile` and `restoreFromBackup`. **Dexie v22** (no schema change) repairs existing devices; like v20 it logs a failure and never throws.
5. **Delete all data** asks for a real backup (`useBackUp`) and then a typed word (`DELETE` / «حذف», trimmed, case-insensitive) instead of a checkbox.

**Amends**: ADR-063 §2 (`DataToolsSection` "stays a separate component"). The component is gone, and its test cases moved to `YourDataSection.test.tsx` case for case, which removes the churn ADR-063 wanted to avoid. Also amends ADR-064 §4 (the `.settings-family` / `.settings-section-nested` pairing is removed).

**Consequences**:
- While any active business exists, one is the default. A client created next to a lone business that was saved as non-default is now assigned to it (`profileAssociation.test.ts` updated). Turning a default off hands it to the best *other* profile.
- `.page-content` is the one full-width scroll area; `.settings-column` caps only the reading width.
- `deleteAllData()` still clears 5 of 24 tables. Filed as **MUT-164**, not fixed here.

**Alternatives considered**:
- S1's literal order (General first, About last): Basel kept ADR-063's spine.
- Dropping the per-business export ("backup only"): loses CSV-to-spreadsheet export and the MUT-158 move-one-business path.
- One Back up button with a format picker: a dialog in front of the most common action.
- Fixing only the seed's race (eng review D2 option B): the restore and the v22 repair could still keep a sample default.
- Repairing in `db.on('ready')`: it blocks every open and reruns forever. A one-time `version(22).upgrade(tx)` is the Dexie-documented place for a data-only fix.

---

## ADR-073: Brand Chrome Comes From One Copy of Each Asset: Full-Bleed Desktop Icons, Portal Icons Bundled From public/, Build-Time Arabic Link Previews, theme-color Follows the In-App Theme

**Status**: Active
**Date**: 2026-10-13
**Context**: MUT-104 wired the Brand v2 icons and browser chrome. Four facts shaped it: the delivered `favicon.svg` (and Claude Design's re-export) styled its shapes by class but shipped no `<style>`, so it rendered solid black; macOS 26 Tahoe puts an app icon with a transparent margin, or the wrong corner shape, in a grey box; the portal server caches only hashed `/assets/*` (everything else is `no-store`); and crawlers run no JavaScript, so a link preview has exactly one language. Plan and decisions D1–D9: `.claude/designs/mut-104-brand-chrome.md`.

**Decision**:
1. **Desktop icons are generated, full-bleed, by `npm run icons:desktop`** (`tauri icon public/icons/icon-1024.png`), for every platform. No padded macOS master (D2): Apple's pre-Tahoe 824/1024 grid is exactly the transparent margin Tahoe boxes in grey. The unused Tauri `android/`/`ios/` sets are deleted (no Tauri mobile target; the phone app is Flutter).
2. **The portal links the web build's `public/` icons as `./public/…`** (D3). `public/` is not the portal's publicDir, so Vite 7 emits them as hashed `/assets/*` files (it never inlines `rel=icon`/`apple-touch-icon` hrefs), which the portal caches immutable. One copy of each icon; `src/hosted/public/favicon.svg` is gone.
3. **`favicon.svg` carries its own light and dark `<style>`** and no C2PA block (editing a signed file leaves a false claim). Any re-export must keep a rule for every class; `brand-head.test.ts` fails otherwise.
4. **Link previews are built at build time, in `vite.config.ts`, for the web build only** (D1): `socialMetaTags(origin)` reads the Arabic landing hero (D4) and points at Claude Design's 1200×630 Arabic card with `summary_large_image` (D9). The origin is `MUTABA3A_PUBLIC_ORIGIN` (default `https://mutaba3a.app`); a non-https value fails the build. Share cards are kept out of the SW precache.
5. **The landing headline is "Track your finances, securely." / "تابع مالك، بأمان."** in both languages (Basel, D9), so the card, the page and the preview text say one thing.
6. **`<meta name="theme-color">` follows the in-app theme** (D6): the heads set one per OS scheme; `syncThemeColorMeta` (called from ThemeProvider's apply effect) paints both with the chosen canvas for an explicit Light or Dark, and restores them for System. Colours come from `tokens.json`.
7. **`BrandMark`** (`src/components/brand/BrandMark.tsx`) picks `mark.svg` or `mark-dark.svg` from `useTheme().resolvedTheme`; the sidebar and the portal `Wordmark` use it.

**Consequences**:
- Every icon href, size and colour in both heads, the manifest and `tauri.conf.json` is pinned by a test (`scripts/__tests__/brand-head.test.ts`, `vite-config.test.ts`).
- Desktop icon art is not machine-checked (no PNG decoder in the repo); a Dock/taskbar look is manual (TD-118, TD-119).
- The web/desktop vite snapshot gained one plugin name (`mutaba3a:social-meta`, web only).

**Alternatives considered**:
- A padded macOS master: right for macOS 12–15, grey-boxed on Tahoe (rejected, D2).
- Copies of the icons in `src/hosted/public` with a byte-equality test: conventional, but duplicated and served `no-store` (rejected, D3).
- Square `og-mark-1200.png` with `summary`: shipped briefly in the plan (D5), superseded when Claude Design delivered the wide card (D9); the square now lives in `docs/brand/`.
- A static theme-color by OS scheme only: mismatched bars when the in-app theme overrides the OS (rejected, D6).

---

## ADR-074: Press Feedback Is the CSS `scale` Property on `.btn` and `.press`, App-Wide; a Ledger List Can Start AT a Record (`anchor`)

**Status**: Active
**Date**: 2026-10-14
**Context**: MUT-91 (epic MUT-74), brief HP1: the portal inherits the shared decisions. L10 press feedback existed nowhere, though MUT-102's `--press-scale`/`--duration-press` tokens did. A portal save can land outside the first 50-row page, where no tint can reach it. Plan and eng review D1–D10: `.claude/designs/mut-91-portal-shared-motion.md`.

**Decision**:
1. **One press rule, app-wide** (D6). `:is(.btn, .press):active:not(:disabled) { scale: var(--press-scale) }` lives in `src/index.css`. Every `Button` in the app and the portal presses. Any other control opts in with `.press`; tabs don't.
2. **The individual `scale` property, never `transform`** (D2). It composes with a control's own transform: the portal's show-password toggle sits on `translateY(-50%)` and would jump. `Button.css` lists `scale` in `.btn`'s own transition; `.press` declares only its own. Reduced motion zeroes the tokens in `theme.css`, not per rule. `pressFeedback.test.ts` fails on any `transform: scale(var(--press-scale))`.
3. **`anchor=<id>` on `GET /v1/expenses` and `GET /v1/conversions`** (D10).
   - The page starts at that record, inclusive, through an `inclusive` flag on the keyset cursor.
   - Filters still apply, and `nextCursor` continues as usual.
   - `anchor` plus `cursor` returns 422.
   - The record is read through the tenant-scoped getter, so another organization's id is a plain 404.
   - `ledgerPageStart` (`server/src/routes/shared.ts`) is the one place both routes use.
   - API 1.21.0-mut91.
   - **A missing anchor is a 404 with `details: { field: 'anchor', reason: 'ANCHOR_NOT_FOUND' }`** (review). The portal's `QueryView` reads any 404 as "the profile is gone", so the reason lets `useAnchoredList` drop a stale anchor (a bookmark, or a delete elsewhere) and show the latest list instead.
4. **Press feedback skips a control greyed out with `aria-disabled="true"`** (review; MUT-169's still-focusable Edit payment), as it skips `:disabled`.

**Consequences**:
- **MUT-77** (landing, built in parallel on `transform: scale`) must move to `scale` or `.press` when it merges; the guard test will say so.
- The portal's Show lands on a tinted row whatever the record's date. An anchored list shows "Showing from a saved entry · Show latest".
- One extra indexed read per anchored request.

**Alternatives considered**:
- `transform: scale()` with per-control compose overrides: rejected (D2). Every positioned control is a regression waiting.
- Portal-only press: rejected (D6). The app and the portal would diverge again.
- Narrowing Show to the saved date with the existing `from`/`to` filters: recommended, but Basel chose the exact server lookup (D10).
- Paging forward up to 5 pages: rejected. Up to 250 rows of reads, and it can still miss.

---

## ADR-075: A Conversion Is Edited With If-Match and Soft-Deleted, Like an Expense; Malafat's Audit Feed Never Lists It (Supersedes ADR-070 §2)

**Status**: Active
**Date**: 2026-10-14
**Context**: MUT-194. ADR-070 §2 made hosted conversions create + read only ("a logging mistake is corrected with a new entry"), and MUT-159 built mobile to match. In use, a mistyped rate or the wrong currency left permanent noise: a reversing conversion plus a corrected one. Separately, `GET /v1/audit` (Malafat's API key) listed `conversion.created`, because the route excluded only `EXPENSE_ENTITY_TYPES`. Plan (eng-reviewed twice, design-reviewed): `~/.gstack/projects/vAWK3-mutaba3a-flutter/MUT-194-plan.md`; brief `.claude/designs/mut-194-conversion-edit-delete.md`.

**Override log (ADR-070 §2)**:
- *Why*: Basel's call (2026-10-14) after MUT-159 shipped; the reversing-entry workaround costs two entries and leaves both in every list.
- *What replaces it*: §1–§3 below. ADR-070 §1, §3, §4 and §6 stand; §5's create-only drawer and USD/ILS/EUR-only form are replaced by §4–§5 below.
- *Date*: 2026-10-14.

**Decision**:
1. **`Conversion` gains `version`, `updatedAt`, `deletedAt`**, declared like Expense's. The migration backfills existing rows to version 1 with `updatedAt = createdAt` (a temporary default, dropped after the backfill so the column matches the schema).
2. **`PATCH /v1/conversions/{id}`** is expense PATCH's contract: `If-Match` on `version`, 409 `VERSION_MISMATCH` with `currentVersion` when stale, 200 with the body. Rules on the merged row (`conversionPatch`, `server/src/conversions/compose.ts`):
   - a currency never travels without its amount (422 `AMOUNT_REQUIRED` on that amount field), because a leg's minor units follow its currency;
   - each amount is parsed in the merged currency's digits;
   - `SAME_CURRENCY` is checked on the merged pair;
   - `occurredOn` is checked against today only when sent (stricter than expense PATCH, consistent with create; a notes-only edit of an old row is never refused).
3. **`DELETE /v1/conversions/{id}`** soft-deletes: 204, 204 again, 404 for an unknown id. Deleted rows leave get and list, and an `anchor` on one is 404 `ANCHOR_NOT_FOUND`. Both routes stay session/device-session only; audited as `conversion.updated {fields, version}` and `conversion.deleted`.
4. **`GET /v1/audit` excludes `SESSION_ONLY_ENTITY_TYPES = [...EXPENSE_ENTITY_TYPES, 'conversion']`**, also when the key asks for `entityType=conversion`.
5. **The portal edits and deletes** (design D6–D8, eng D11): `?conversion=<id>` opens `ConversionDrawer` in edit mode; Save sends both legs at the loaded version; a 409 refetches the conversion and a reset effect keyed on id + version refills the form (the drawer stays open). Delete confirms naming both legs. The form takes JOD with per-leg, currency-aware decimals (closes TD-117). `HostedTable` makes clickable rows keyboard-reachable with a `row-link` button in the first cell.
6. `API_VERSION` 1.22.0-mut182 → **1.23.0-mut194** (planned as 1.22.0; MUT-182 took that number on main first).

**Consequences**:
- The server must deploy before a mobile build that calls PATCH/DELETE (an old server answers 404).
- Phone and portal editing the same conversion both send the version they loaded, so the second writer gets 409 instead of overwriting.
- A queued (not yet confirmed) conversion still can't be edited on the phone; that is MUT-132's snapshot mechanism.
- The conversion drawer deliberately refills on a new version, against the MUT-133 note "never key a form by an entity's version": here a newer version means the save would 409 anyway (see PATTERNS).
- Widening the shared currency filter lets the receivables filter offer JOD too.

**Alternatives considered**:
- Keep create + read only: rejected by the product call above.
- A version re-read at save time (expense edit's mobile behaviour): rejected for conversions (eng D3); If-Match would catch nothing.
- A focusable `<tr>` for keyboard rows (design D8's first text): rejected (eng D11); it loses row semantics or isn't announced as actionable.
- JOD conversions read-only in the portal: rejected (eng D7); web users couldn't fix them.

---

## ADR-076: The Free Web App's "Go hosted" CTA — a Build-Time Portal URL, a localStorage Snooze, and a Web-Only Gate Read at Render Time

**Status**: Active
**Date**: 2026-10-14
**Context**: MUT-187 (epic MUT-185). Free web users never learned hosted exists, and hosted users had no way from the free app to the portal. The CTA needs the portal's address (today the bare Cloud Run `run.app` URL, no custom domain), must ship in the web build only (desktop is retired until v2), must make no network call (ADR-024), and must not crowd the core four (ADR-034). Brief, eng review and design review: `.claude/designs/mut-187-go-hosted-cta.md`; wireframe `mut-187-go-hosted-wireframe.html`.

**Decision**:
1. **The portal URL is a build-time value.** `MUTABA3A_PORTAL_URL` overrides `DEFAULT_PORTAL_URL` in `vite.config.ts` (the Cloud Run service that serves the portal) and is injected as `__PORTAL_URL__`: the URL in the web build, `""` in desktop. `portalUrl()` accepts only a bare https origin, so a bad value fails the build; the check (`assertHttpsOrigin`) is shared with `MUTABA3A_PUBLIC_ORIGIN`. The origin is in `scripts/bundle-origins.json` as a link target, never fetched. MUT-112 (custom domain) changes the default and the allowlist.
2. **The card's dismissal is a per-browser preference in localStorage** (`mutaba3a-go-hosted-dismissed-at`, epoch ms), not the database, so it never travels in backups. It returns after `GO_HOSTED_SNOOZE_DAYS = 30`. A missing, unparseable or future value counts as due, so no stored value can hide it for good; a storage that throws shows the card and lets a dismissal hide it for that tab.
3. **Gates are read at render time through a typeof guard** (`goHostedEnabled()`, `hostedPortalUrl()` in `src/lib/goHosted.ts`). Vitest defines neither constant, so every existing test sees the app without the CTA, and new tests stub them per case. Rollup can't fold a function call, so the desktop bundle keeps the card's never-rendered code (TD-134).
4. **Where it shows**: the sidebar card at the top of the footer (web build, expanded rail, no visitor sample, window ≥ 641 px tall); the "Hosted account" row at the end of Settings › Businesses (web build). Sign-in lives only in the Settings row. Links are plain anchors in a new tab, because the router's `/app` basepath would rewrite `/hosted`.

**Consequences**:
- A deploy to a new portal host is a one-constant (or one-env-var) change plus the allowlist, and the vite-config snapshot shows it.
- A second tab keeps showing the card until it remounts (no storage listener).
- Users who keep the rail collapsed, or whose window is short, meet hosted only in Settings.

**Alternatives considered**:
- Env only, set in `netlify.toml`, no default (eng D2 B): rejected; local and preview builds would lose the sign-in link silently.
- Dismissal in Dexie settings: rejected; it would travel in backups and needs no query.
- Inline `__BUILD_MODE__ === 'web'` checks (foldable): rejected; vitest has no such global, so every test rendering the sidebar or Settings would throw.
- A lavender card or an icon on the collapsed rail (design D2 C, eng D4 B): rejected; they read as an active nav item.

---

## ADR-077: The Marketing Site Defaults to Arabic, as a Default and Not a Stored Preference

**Status**: Active
**Date**: 2026-10-14
**Context**: MUT-202 (epic MUT-171). Basel: "the landing page should default to arabic regardless of system language". `LanguageProvider` chose the stored language, else the system language, and wrote its pick to `mutaba3a-language` on mount. The marketing pages (`/`, `/hosted`, `/privacy`, `/download`, all through `LandingProviders`) and the web app at `/app` share that key on one origin. Brief: `.claude/designs/mut-202-landing-arabic-default.md`.

**Decision**:
1. `LanguageProvider` takes an optional `defaultLanguage`. Order: stored choice → `defaultLanguage` → system language.
2. A `defaultLanguage` is a default, not a preference: nothing is written to storage until someone chooses (the EN/AR switch). Without the prop the provider behaves exactly as before, storing the detected language on mount (the app).
2a. A stored language counts as a choice only alongside `mutaba3a-language-chosen`, which only `setLanguage` writes (the landing's switch, the app's Settings). Before MUT-202 the landing and the app stored whatever they detected, and the app still does, so a bare stored value is not evidence of a choice; with a `defaultLanguage`, the provider ignores it. The app reads the plain key as before.
2b. Storage reads and writes are guarded; where storage throws, the default renders and a choice holds for the visit.
3. `LandingProviders` passes `LANDING_DEFAULT_LANGUAGE = 'ar'`, so every marketing page opens in Arabic, right to left, for a visitor who has not chosen.

**Consequences**:
- A visitor who never chose a language sees the marketing site in Arabic, including one whose browser language was stored earlier by the app or by the old landing; a person's choice (marked) still wins on the site, and the app keeps reading the plain key. Someone who explicitly chose English before MUT-202 has no mark and sees Arabic once, until they press EN again.
- A landing visit no longer decides the app's language; the app keeps detecting the system language until someone chooses.
- The HTML shell still says `lang="en"` until React mounts; nothing renders before then.
- Open: whether the web app should also default to Arabic is Basel's call (not done).

---

**Amendment (2026-10-15, MUT-209)**: Basel: "everything should default to arabic". The rule now covers every surface. One `DEFAULT_LANGUAGE = 'ar'` lives in `src/lib/i18n/core.tsx`; the landing (`LandingProviders`), the web app (`main.tsx`'s `LanguageProvider defaultLanguage`) and the hosted portal (`HostedLanguageProvider`'s fallback, instead of the browser language) use it. The app therefore stops storing a detected language, and a language it stored by detection before no longer counts as a choice (the chosen mark rule). The portal still adopts the signed-in account's locale unless this browser has a choice, and the server now creates an account without `locale` as Arabic (`CreateUserRequest.locale` default `ar`, API 1.24.0-mut209); existing accounts keep their stored locale (a production data change is Basel's call). The portal remembers the last account's locale as a hint (`mutaba3a-portal-account-locale`, never a choice) and adopts it before paint, so an English account never opens in Arabic and flips. A new account without a locale also gets Arabic expense categories (they follow the locale). The Flutter app follows separately in its own repo. Supersedes the consequence "the app keeps detecting the system language until someone chooses".


## ADR-078: Malafat Suggestions in the Web App — Where They Live, How They Are Retired, and One Upsell on Screen

**Status**: Active
**Date**: 2026-10-14
**Context**: MUT-190 (epic MUT-189). Mutaba3a users who run a law or accounting office should hear about Malafat inside the product, without modals, toasts or nags, with an off switch, and with zero Mutaba3a-side telemetry (ADR-024). The free web app already shows the Go hosted card (MUT-187, ADR-076). Brief, eng review and outside voice: `.claude/designs/mut-190-malafat-suggestions-local.md`.

**Decision**:
1. **Moments.** S1: a static "Mutaba3a + Malafat" row in Settings › Businesses with the "Show Malafat suggestions" switch (the row ignores the switch). C1: right after a second or later business is added in the person's own data, the row's line becomes a note about it (session-only flag; never the first business, never in sample or demo data). C2/C3: one card on Clients at `MALAFAT_CLIENT_THRESHOLD` (10) live clients in the working business, else with ≥ 2 live businesses; only beside a non-empty list, never while searching or with a client open beside it.
2. **Links.** Every surface uses `malafatUrl({ locale, medium: 'web-local', content, contact: true })`: MUT-189's CTA contract. Web build only (desktop retired until v2), so no `desktop` medium.
3. **Retiring.** Dismissals are permanent and live on the Dexie settings row (`malafatSuggestions: { off, dismissed }`), like the optional-area switches, and travel with a backup; delete-all-data and the legacy import reset them (accepted). A click on a suggestion's link retires it too (seen and acted on). Retiring the business-added note also retires the second-business card (one event, one suggestion). Writes read the fresh row and write the whole field (the repository replaces nested objects).
4. **One upsell on screen.** While a Malafat suggestion is mounted it holds a slot (`useMalafatMomentStore.claimSlot`) and the Go hosted card renders nothing. A Clients card that is retired leaves nothing else for the rest of that visit.
5. **Copy.** For law firms and accounting offices; Malafat "connects to a Mutaba3a hosted account", never "automatically" or "sync" (the shipped capture stores payments unallocated, MUT-61).

**Consequences**:
- The local app needs no profile-type or Malafat-fed gate: local businesses carry neither (the rule matters for the portal, MUT-191).
- Referrals are counted only once MAL-1153 ships on malafat.app; release after it.
- The Go hosted card can be hidden for a whole Clients visit by a Malafat card; acceptable, it returns on any other screen.
- Retiring either the business-added note or the second-business card retires both (one event). A Clients suggestion retired on a visit leaves no other until the app reloads (session store).
- A failed dismissal write is silent; the suggestion returns next visit (TD-140). Settings writes are not transactional (TD-138).
- "Skip for now" on the welcome dialog creates a placeholder business, so a person who skipped and then adds their real business gets the business-added note. Accepted; flagged to Basel on MUT-190.

**Amendment (2026-10-15, MUT-192 — the phone app, mutaba3a-flutter)**:
- **S1 only.** Settings gains a Malafat section (a link that opens malafat.app in the browser, `utm_medium=ios|android`, `utm_content=settings`, and the account's switch through the same `PATCH /v1/me/malafat-suggestions` with the device session). C1 waits for profile creation in the app (MUT-184); C2 waits for a Clients screen (the only client list is the capture flow's picker, where suggestions are banned).
- **Account-wide eligibility.** Settings is not per-profile, so the section shows when any of the person's profiles is eligible, never for a Malafat customer.
- **No macOS.** The referral contract has no medium for it; the section shows on iOS and Android only.
- **"Malafat" stays Latin in Arabic** in the section, though the app's existing profile badge writes ملفات (left alone).
- The app parses `malafatSuggestions` tolerantly (unknown moments kept as strings; anything malformed is the default), so a server change can never sign anyone out.

**Amendment (2026-10-15, MUT-191 — the hosted portal)**:
- **Stored on the server, per user**, not in the browser: the portal keeps nothing but the language in the browser (hosted-portal.md §7.1), and a server preference follows the account to other browsers and to the phone app (MUT-192). `User.malafatSuggestions` (nullable JSON) is read through `/v1/me` (`user.malafatSuggestions`, resolved to `{ off: false, dismissed: [] }`) and changed with `PATCH /v1/me/malafat-suggestions { off?, dismiss? }`: dismissals are unioned under a row lock so two tabs never lose one; `off` is last-write-wins. Idempotent, so no Idempotency-Key.
- **No audit row.** Firm audit logs are readable by Malafat; a row per dismissal would be a click log of the upsell (telemetry, ADR-024).
- **Who sees it.** A profile is eligible when it is owned, `type === 'BUSINESS'`, not the personal default, and not Malafat-fed (`writerOfRecord === null`). Firms never (they are Malafat tenants). Anyone who belongs to a Malafat-fed firm gets no suggestion anywhere (auto decision D7, flagged to Basel).
- **Where.** S1 is two items at the end of the account menu (after Sign out, which keeps first focus). C1 shows on the new business profile's Overview right after the create drawer lands there, read once on arrival and consumed. C2/C3 sit in Clients' loaded view above the table, hidden while searching; C2 counts `ACTIVE` customers; C3 stays quiet for the rest of a visit in which a business profile was created (C1 spoke for that event).

---

## ADR-079: The Bloom Loader Is a React Port of the Delivered SVG — Token Fills, a JS-Chosen Still Frame, No Lottie Runtime

**Status**: Active
**Date**: 2026-10-15
**Context**: MUT-206 (epic MUT-101). The app and the portal showed five unrelated ring spinners. Brand v2 delivered the bloom loader (MUT-203, `docs/brand/loader/`) as a Lottie JSON (the motion source of truth), a `<mutaba3a-loader>` custom element with inline SMIL, and a Flutter painter. The element reads the OS theme (not ThemeToggle), writes a `<style>` into a shadow root, hard-codes its colours and an English label. The portal CSP is `default-src 'self'` (no inline `<style>`, no `style=""`), the literal guard forbids colour literals and `<style>` in TSX, and SMIL ignores the CSS reduced-motion rule. Brief and reviews: `.claude/designs/mut-206-brand-loader.md`.

**Decision**:
1. **Port, don't ship.** `BrandLoader` renders the delivered SVG in React: `viewBox="-10 -10 120 120"`, four `<path>`s each with an `<animate attributeName="d">`, one group `<animateTransform type="rotate">`, `dur="4.5s"`, the delivered `keyTimes`/`keySplines`/`values` strings (in `bloomLoaderData.ts`). No `lottie-web` (≈250 KB), no custom element. A parity test proves every string against the Lottie JSON.
2. **Fills from tokens.** Four new tokens, `markDot`/`markLavender`/`markRose`/`markPeach` (light dot `#795DBA`, dark dot `#F3E5B0`; peach `#F5AB77`/`#F9B379`), as `--m-mark-*` in the brand CSS's three selector blocks and `--mark-*` in `theme.css`. `BrandLoader.css` paints each piece's class. Light, Dark, System and live OS changes follow `data-theme` through the existing cascade; no `useTheme` call. Recorded under the kit README's Deviations.
3. **The still frame is chosen in JS.** Under `prefers-reduced-motion` (via `usePrefersReducedMotion`) the loader renders no `<animate>` children: the paths hold frame 0, which is the mark, and the label is shown as text. Deterministic and testable, unlike `pauseAnimations()`.
4. **Behaviour.** 400 ms of empty `role="status"` (same footprint) before anything shows; the shown SVG is a fresh element so its SMIL clock starts at frame 0; a 3 s slow caption on full-page waits; a loader chained within 100 ms of a shown one shows at once; sizes are a union (24/40/64/96).

**Consequences**:
- About 6.5 KB of path strings (≈1.5 KB gzipped) in the shared chunk; no dependency.
- A kit change must update `bloomLoaderData.ts` (the parity test fails otherwise) and, for a colour change, the four tokens.
- Three duplicate `@keyframes spin` and five spinner blocks are gone; a test keeps them gone.
- The loader's default label lives in both the app and portal dictionaries (`common.loaderLabel`), kept equal by the portal parity test.

---

## ADR-080: The Web and Portal Boot Splash Is Static HTML Plus a Linked Stylesheet; the Portal's Session Check Is "the Mark Becomes the Loader"; Before JS the Theme Is the OS's

**Status**: Active
**Date**: 2026-10-15
**Context**: MUT-207 (epic MUT-101). Until the bundle mounted, `index.html` and `hosted.html` painted the browser default (white, even in dark mode) for seconds on a cold or slow load, then a second screen: the portal's wordmark lockup (which moved 18 px when its spinner came) or the landing's unlocalised "Loading...". The portal CSP is `default-src 'self'` (no inline style or script). QA runs the Vite dev servers, where CSS imported from `main.tsx` arrives through JS. Before JS neither the stored theme nor the language is known. Brief and reviews: `.claude/designs/mut-207-boot-splash.md`, eng review R1 in `mut-206-brand-loader.md`.

**Decision**:
1. **Static splash in both heads** (D1): `#root` holds a hidden `.boot-splash` with a `<picture>` (the dark mark under `prefers-color-scheme: dark`) around an 80 px `<img>` of the bundled `mark.svg`. Pure HTML and attributes; Vite rewrites the asset URLs to the same hashed files `BrandMark` uses. React's first render replaces it; no code removes it.
2. **Its own linked stylesheet** (D2): `src/styles/brand/boot-splash.css`, about 300 B, linked from both heads, so it styles the first paint in dev, QA and production. It writes the two canvas hexes (it loads before the tokens), and a test pins them to `mutaba3a.tokens.json`. Once ThemeProvider sets `data-theme`, forced-theme rules win in the brand CSS's selector order (DR12).
3. **The portal's session check is "the mark becomes the loader"** (D4, R1): inside `.boot-splash`, `BrandMark` 80 until `bootDelayMs()` (400 ms from page start, DR9), then `BrandLoader` 96 with `delay={0}`, whose frame 0 is the identical mark: no jump, no fade. The wordmark text leaves the boot screen (it can't be drawn before JS); BootUnreachable keeps it. The landing's fallback (`BootSplash`) does the same (DR10).
4. **Before JS the theme is the OS's** (D6). A person who chose the opposite in-app theme sees the OS-coloured splash for the pre-JS moment. Rejected: an external `boot-theme.js` reading `localStorage` before paint (a render-blocking request on every load for a sub-second, one-colour mismatch; the portal, a different origin, rarely has a stored theme). Matches ADR-073's no-JS theme-color default.

**Consequences**:
- One extra render-blocking request of about 300 B (cached immutable on the portal); no JS before first paint; no new asset.
- `BootSplash.tsx` and the two heads must change together (`brand-head.test.ts` compares them); `check-bundles` proves each built entry's splash files ship (or are inlined `data:` URIs, eng review A2).
- The portal's boot screen no longer spells the product name; sign-in and the error screen still do.
- The session check now has a 15 s deadline (DR6): a hung `/v1/me` ends in BootUnreachable with Retry.

---

## ADR-081: Web and API Releases Are Tagged `web-v<x>` / `api-v<x>`, and release-qa Reads Its Baseline From Those Tags

**Status**: Active
**Date**: 2026-10-15
**Context**: release-qa scopes a run to what changed since each app's last release. Its config read the newest `v*` tag, but since ADR-043 the web and API ship through `make release web|server`, which committed `release: web|api v<x>` and created no tag; `v*` tags came only from the desktop pipeline, retired at `v0.0.67`. Every QA plan therefore treated 287 commits as new. The hosted portal ships inside the API image (`server/scripts/deploy.sh` builds `dist-hosted`), not with the Netlify web deploy.

**Decision**:
1. `make release web` tags `web-v<version>` after its push; `make release server` tags `api-v<version>` after `deploy.sh` succeeds (a failed roll leaves no tag). Both push the tag. The desktop keeps plain `v*`.
2. Tagging lives in `scripts/tag-release.sh`. It never moves a tag that already points elsewhere (a "keep version" release), and says so; the baseline then stays at the older commit, which can only widen QA scope, never hide a change.
3. release-qa: web `{ strategy: 'tag', pattern: 'web-v*' }`, portal `pattern: 'api-v*'`.
4. Past releases were backfilled locally with `tag-release.sh --backfill`, each tag dated like its commit.

**Consequences**: `release-qa plan` scopes to real changes again. The backfilled tags exist only in this checkout until pushed (`git push origin --tags`). A release that keeps its version reuses the old tag.

**Alternatives Considered**: release-qa's `commit-grep` strategy on `^release: web v` (Malafat's approach; rejected: tags are also what people and `git describe` read, and a tag survives a reworded commit); one shared tag for web + portal (rejected: they deploy separately, so their baselines differ).

---

## ADR-082: Financial Planning and the Local Retainers Area Are Retired, and Dexie v24 Drops Their Tables (Narrow Override of ADR-029 and ADR-032; Server Retainers Unaffected)

**Status**: Active
**Date**: 2026-10-15
**Context**: MUT-226 (epic MUT-2). Brief: `.claude/designs/mut-226-remove-planning-retainers.md`. Two of the six optional areas (ADR-032) fell outside the client-accounting core:
- **Planning** was a cash projection built from hand-typed assumptions. It read nothing else and nothing read it.
- **Local Retainers** kept a schedule of *expected* payments (`projectedIncome`) and a drawer that matched a received entry to one period. It never created income and no owed, Home, Insights or lens figure counted it.

The owner decided on 2026-10-15 to remove both, quote: "drop data it's ok, remove planning table and local retainers tables and clean up db and table and everything, but don't touch server".

**Decision**:
1. **All code goes.** That covers:
   - the pages, `PlanAssumptionDrawer`, `RetainerDrawer`, `RetainerMatchingDrawer` and `ClientRetainersCard`;
   - `planCalculationService`, `planRepository`, `retainerRepository` (schedule generator and matching) and their hooks;
   - the store slices, the five repository slots and interfaces, the types, the demo seed rows, about 210 i18n keys per locale, and the matching-drawer CSS;
   - the `planning` and `retainers` keys in `FEATURE_KEYS`, the `FeatureKey` union and their probes. Four optional areas remain: expenses, insights, projects, conversions.
2. **Dexie v24 drops the five tables**: `plans`, `planAssumptions`, `planScenarios`, `retainerAgreements`, `projectedIncome`. The same version also:
   - re-declares `transactions` without the `linkedProjectedIncomeId` index;
   - has its upgrade delete that field from every transaction row and remove `features.planning` / `features.retainers` and both keys from `featureNotice` on the settings row.

   An upgrade failure is logged, never thrown, as in v20/v22/v23; the stores drop regardless. Versions 1–23 stay as written. A backup saved before v24 still carries the rows, and restore skips them. A stale `linkedProjectedIncomeId` on a restored old transaction is inert, because nothing reads it.
3. **Old URLs land on Home.** `/planning` and `/retainers` are unconditional `beforeLoad` redirects to `/`, dropping any bookmarked search (ADR-067 §4: the router has no not-found component).
4. **The server's Money v1 retainers are a different feature and are untouched.** That includes:
   - `/v1/retainers*` and lazy posting (`postDueItems` → `RETAINER_CHARGE` receivables);
   - `RetainerCharge`/`RetainerVersion` and the summaries `RETAINER` kind;
   - the hosted portal's generated `schema.d.ts` and `incomeAffordances` non-settleable rule.

   The two systems never exchanged data, since sync was retired by ADR-053.

**Override log — ADR-029 (these five tables only).**
- *What:* "removing a feature's UI never drops a Dexie table".
- *Why:* the owner chose it explicitly, knowing it deletes user records. The rows were plans, assumptions and scenarios typed by hand, and retainer agreements with their generated expectations. No core record (income, payments, clients, projects, expenses, documents) lives in them, and a matched income entry keeps its amount, status and payments.
- *What replaces it, for these tables:* `src/db/__tests__/migration-v24.test.ts`. It upgrades a seeded v23 database and asserts:
  - the upgrade opens without error;
  - the five stores are gone;
  - the link field and its index are gone;
  - the settings keys are cleaned;
  - every other row is unchanged;
  - a pre-v24 backup restores its other tables;
  - the migration-safety snapshot omits the dropped tables.
- ADR-029 stands for every other table. ADR-053 and this ADR are its only two exceptions.

**Override — ADR-032.** The optional-area list shrinks from six to four. The mechanism (switches, probes, the v20 auto-enable, banner, guards) is unchanged.

**Consequences**:
- About 11.8k lines leave (74 files).
- Guards:
  - `src/__tests__/noDeadPlanningRetainerModules.test.ts` covers paths, names, the four-key list and the retired i18n keys in both locales.
  - `migration-v24.test.ts`.
  - `router.gateKeys.test.ts` covers the redirects.
- MUT-219 (Planning CSV) and MUT-222 (retainer schedule panel) are obsolete, and MUT-180's fix went with the code.
- The pattern for retiring an area is now in PATTERNS.md.

**Alternatives Considered**:
- *Keeping the tables as retained types (the ADR-067 default).* Recommended, but the owner declined.
- *A v24 that only drops the stores.* Rejected: it would leave the dead index and flags behind, against the "clean up everything" instruction.
- *Also retiring the server retainers.* Out of scope by instruction; that would be a contract change with Malafat, the writer of record.

## ADR-083: Hosted Re-dating — Date-Only PATCH on Income Entries and Captured Payments, Owner-Only, If-Match

**Status**: Active
**Date**: 2026-10-15
**Context**: MUT-223. A hosted Owed entry (`ADJUSTMENT` receivable) or captured payment kept its date forever; DELETE /v1/income refuses a settled entry, so a payment logged on the wrong day was permanent (TD-126). Expenses and conversions already re-date with If-Match (ADR-075). Basel (2026-10-15): date only; owned profiles only; an Owed entry keeps its stored due date.

**Decision**:
1. `PATCH /v1/income/{id}` `{ occurredOn }` and `PATCH /v1/payments/{id}` `{ receivedOn }`, session or device session, If-Match on the row's existing `version` (no migration). Same contract as ADR-075: stale → 409 `VERSION_MISMATCH` + `currentVersion`; success bumps `version`.
2. Only a profile the person owns (`profileOwnerOf`, ADR-037 MUT-182 amendment) and only a row they captured: an `ADJUSTMENT` receivable they created, or a POSTED `CAPTURE` payment they created (settle writes `CAPTURE`). Everything else is 404. Exception (eng review D2): on a Malafat-fed profile PATCH /v1/payments keeps `payments:write`, which a session there lacks, so it answers 403 `READ_ONLY_PROFILE` before any lookup — the same answer settle gives.
3. The new date passes create's rules: a valid date, not later than the organization's today (ADR-038 server addendum). ADR-086 adds the ten-year floor to those rules (`redateTo` → `pastMoneyDate`).
4. An Owed entry's `dueDate` never moves with its date; moving past it can make an unpaid entry overdue.
5. PATCH /v1/income refuses a payment with allocations (409 `ALREADY_ALLOCATED`, use PATCH /v1/payments): `IncomeStatus` cannot describe it. The check is on the route's read, not in the write (eng review D3): on an owned profile only settle allocates, and only to the payment it creates, since `/v1/payments/{id}/allocations` is API-key only and keys are refused on owned profiles. If owned profiles ever accept keys, move the check into the WHERE.
6. A payment keeps its `PAY-YYYY-NNNN` number when `receivedOn` moves into another year (gap-free numbering beats a matching year). A payment dated before its receivable's posting date is allowed, as settle already allows.
7. Audit `income.owed.redated` / `payment.redated` with `{ from, to, version }`; `GET /v1/audit` excludes them by action (`excludeActions`), because those entity types are Malafat's to read.

**Consequences**: a wrong date is fixable on hosted; a wrong amount still is not (TD-126 remains for that half). `IncomeResponse` gains `version`. Clients must send the version of the row they showed (MUT-196's trap) and refetch on 409 (MUT-221's). An Idempotency-Key replay returns the body stored at the time (pre-landing review, replay decision): one stored before 1.26.0-mut223 has no `version`, and one replayed after a re-date shows the old date and version, so clients take If-Match from GET /v1/receivables/{id} or GET /v1/payments/{id} and treat a missing `version` as "refetch". `version` stays required in the schema; the gap is the deploy window.

**Alternatives Considered**: `capture:write` on PATCH /v1/payments so every refusal is 404 (rejected D2: puts a /v1/payments route under the capture row MUT-61 kept separate, and edits the matrix + brief the drift test pins); a `requireUnallocated` store option (rejected D3: guards a race that cannot occur on owned profiles); re-deriving `dueDate` from the new date (rejected: the server cannot tell a defaulted EOM_15 due date from a chosen one)


**MUT-224 amendment (2026-10-15, portal):** the portal has no single income list, so `?income=` is an Owed entry (Receivables row → PATCH /v1/income) and `?payment=` any payment the person recorded (Payments row → PATCH /v1/payments), Received and settle alike (eng review R2). Receivables gains a Date column so a re-dated entry visibly moves (R3). A settled entry's paid date is shown by scanning the client's first 50 payments for allocations to it, falling back to a link to the client's Payments (R4, TD-145); a server `?receivableId=` filter would be exact. Payments rows link from their Received cell through `HostedTable` `linkColumn`/`canOpen` (R5).

## ADR-084: "Delete All Data" Empties Every Table but Settings; Settings Keep Preferences and Turn the Optional Areas Off

**Status**: Active
**Date**: 2026-10-15
**Context**: MUT-164 (TODOS #10). `deleteAllData()` cleared five of the 19 tables, so businesses, expenses, receipt files and payment records survived a typed-"DELETE" confirmation that promised "all data". The owner answered the ticket's open questions on 2026-10-15: keep preferences, reset features.

**Decision**:
1. `deleteAllData()` (`dataset.wipeAllData`, renamed from `wipeCoreData`) clears **every table in `db.tables` except `settings`**, in one transaction. It enumerates the tables, so a table added later is cleared without editing it. Sample (`demo_`) rows go with everything else.
2. The **settings row stays** with its preferences: enabled and default currencies, `lastBackupAt` (the backup step 1 just made), `malafatSuggestions`. Language and theme live in `localStorage` and are untouched.
3. The **optional areas go back off**: `features = {}` and `featureNotice = []`. The data that switched them on is gone.
4. The modal **refetches every query** (`invalidateQueries()` with no key) and resets the client stores that point at deleted rows: the saved active business, demo mode, and the onboarding walkthrough. With no business left, the welcome flow opens again.
5. The modal says what is kept (`settings.data.deleteModal.kept`).

**Not changed:** `clearDatabase()` still clears the six legacy tables only; it is the legacy (pre-v2) import's replace step, not a user action.

## ADR-085: An Idempotency Fingerprint Compares a JSON Body by Meaning, Not Bytes

**Status**: Active
**Date**: 2026-10-15
**Context**: MUT-199. The middleware fingerprinted `sha256(method\npath\nrawBody)`. The phone widget (Swift `JSONEncoder`: random key order, `/` escaped as `\/`) and the app's replay of the same capture (Dart `jsonEncode`: insertion order) send different bytes under the same key, so a replay after a lost response was refused as `IDEMPOTENCY_KEY_REUSED`. The ticket's alternative was byte-identical encoders on both clients. It was rejected: it fixes one pair of clients, and the next encoder would break it again.

**Decision**:
1. `requestFingerprint` (`server/src/idempotency.ts`) parses a JSON body and re-serialises it with keys sorted at every depth, with no insignificant whitespace and with `JSON.stringify` escaping. Array order and every value still count, and so do the method and the path. A body that isn't JSON counts byte for byte.
2. Numbers pass through a double. The API sends money as decimal strings, so no amount is affected. Two integers above 2^53 that differ only beyond double precision would compare equal; no route takes such a number.
3. **Transition:** keys stored before this change carry the byte fingerprint. On a mismatch the middleware claims again with the byte fingerprint, and a byte-identical replay of an old key still replays. A claim only compares against an existing key, so the second call has no side effect. The fallback can go once every pre-change key is past any client's retry window.
4. API 1.26.3-mut199. The API description says how bodies compare.

## ADR-086: Every Hosted Money Date Has a Ten-Year Floor; DATE_INVALID Says Which Bound It Crossed

**Status**: Active
**Date**: 2026-10-15
**Context**: MUT-227, found in MUT-223's pre-landing review. The hosted API checked money dates for validity and, for income, "not later than today" (ADR-038 server addendum), but had no lower bound. A typo year saved silently, and MUT-223's re-dating (ADR-083) could now move a settled entry decades back. Basel decided the rule on the ticket (2026-10-15); the eng review settled D1 to D4.

**Decision**:
1. **Floor:** a money date earlier than the organization's today − 3660 days (`DAYS_IN_PAST_LIMIT`, `assertNotTooOld`, beside `assertNotAbsurdDate`'s ceiling) is 422 `VALIDATION_FAILED` / `DATE_INVALID`. The floor day itself is accepted. It is a separate constant from the ceiling: the two are equal by decision, not by definition.
2. **Everywhere, create and edit alike:** `POST /v1/income`, settle's `paidAt`, both MUT-223 PATCH routes, `POST /v1/payments` (Malafat's key too: its wizard defaults to today), expense create and patch, conversion create and patch, and both inbox filings. Income-like dates make one call, `pastMoneyDate` (valid, not future, not too old). Expenses keep no future check (filing must refuse exactly where a direct create does, ADR-048).
3. **Not on queries or existing rows:** expense list and summary `from`/`to` stay iso-only (`expenseDate`); a stored date is only checked when a request changes it (expense, conversion and inbox PATCH skip a resent, unchanged date, since the portal sends it on every save), so old rows stay readable and editable; no migration.
4. **Inbox capture is lenient:** an unsorted entry has no profile and so no timezone. Capture and edit check the floor from UTC's yesterday, which is at or before every timezone's today, so capture can never refuse a date filing would accept; filing applies the exact floor.
5. **`details.bound`:** the floor, `assertNotFuture` and `assertNotAbsurdDate` add `bound: 'past' | 'future'`. Additive: the reason enum is unchanged, and a client that ignores it keeps working. The portal (income, settle, expenses, conversions, and MUT-224's re-date drawer; `apiErrorBound`) shows a "more than ten years ago" message on `past`. The phone's matching message (outbox row, File from Recent) is on mutaba3a-flutter `feature/mut-227-date-floor`; until that ships, the phone says "date ahead" for a too-old date, so release the two together.
6. API 1.27.0-mut227.
7. **Corrections keep their date (review D4):** the first `POST /v1/payments` replacing a reversed payment (`replacesPaymentId`, none recorded yet) may keep that payment's `receivedOn`, or a later one, below the floor; a second replacement is floored. The reversal has already committed, so refusing the replacement would leave the money with no payment.

**Consequences**: a typo year in a money date (when it happened or was paid) is caught at the API. Not covered: agreement and fee-proposal dates keep the ceiling only, and an Owed entry's `dueDate` (POST /v1/income, file-as-income), a receivable credit's `effectiveDate` and an installment trigger date have no bound at all, so a `dueDate` of `0001-01-01` still makes an entry overdue since year 1 (follow-up ticket, review D3). Date pickers still allow any past date; the server is the guard.

**Alternatives Considered**: a fixed year or the profile's creation date as the floor (rejected by Basel: a fixed year misses 2006-for-2026, and creation date blocks backfilling older work); a new `DATE_TOO_OLD` reason (rejected: an enum change for every client, where an additive detail does); a filing-only inbox floor (rejected D3: the typo would wait in Unsorted until filing failed).


## ADR-087: The Hosted API Proxies ECB Reference Rates for Display, Derives JOD From the USD Peg, and Caches Per Instance

**Status**: Active
**Date**: 2026-10-15
**Context**: MUT-228, for MUT-229. The phone shows what a USD, EUR or JOD amount is in the target profile's default currency, and the Convert sheet shows the market rate next to the user's own. The server had no rates. The web top bar (MUT-79) calls Frankfurter from the browser, and a second client copying that logic would drift. The ECB reference set has USD and ILS but no JOD; a probe (2026-10-15) showed Frankfurter drops JOD from `symbols=` with a 200 and no error.

**Decision**:
1. `GET /v1/fx-rates?base=` (sessions and device sessions, no API keys, no `X-Mutaba3a-Profile`) answers every supported currency against `base`: units of that currency per 1 `base`, rounded to 6 decimal places, with the ECB `rateDate`, the instance's `fetchedAt` and `source` `live` | `stale`. `base` is required; a missing or unknown one is 422 `VALIDATION_FAILED` like every other validation failure (the ticket's "400" was amended).
2. The server reads Frankfurter (`FX_RATES_URL`, base EUR, symbols USD and ILS) with a timeout (`FX_RATES_TIMEOUT_MS`, 3 s) and a strict body check, and crosses the euro rates for any base (`server/src/fx-rates.ts`). `FX_RATES_URL` must be https (plain http only for a localhost stub), and a redirect is a provider failure, not rates to accept.
3. **JOD** comes from the Central Bank of Jordan's peg, 1 USD = 0.709 JOD, as a constant in code. Every pair with exactly one JOD side is marked `derived`. A re-peg is a deploy. *(Extended by ADR-098, MUT-280: JOD is one of six USD pegs, and `derived` is "either side pegged". Narrowed again by ADR-166, MUT-388: JOD is the only peg; the "either side pegged" rule stays.)*
4. **Display only.** No record stores a rate, and no amount is converted on the server.
5. **Cache in process, per instance**, like the rate limiter (TD-017). A snapshot is fresh for `FX_RATES_TTL_MINUTES` (240). Concurrent misses share one provider call. A failed refresh serves the last snapshot as `stale` and does not call the provider again for 60 s. With nothing cached, the route answers 503 `FX_RATES_UNAVAILABLE`, never a zero rate. So a new instance that starts while the provider is down answers 503 until it is back; the phone keeps its own last copy and shows "as of" (MUT-229). Production runs one instance, so every deploy starts empty: `index.ts` fills the cache once at startup (6b).
6. The refresh runs inline on the request that finds the snapshot expired (at most `FX_RATES_TIMEOUT_MS`, 3 s by default, once per window per instance): a background refresh is unreliable if Cloud Run throttles CPU between requests. Stale-while-revalidate was considered in the pre-landing review and kept out for the same reason.
6a. **Age cap:** a snapshot whose ECB rate date is more than 7 days old, more than a day in the future, or not a calendar date is never served, live or stale. A provider answering with one counts as a failure; a cached one ages out into 503. The ECB's longest gap (Easter) is under 6 days.
6b. **Startup warm-up** (`CachedFxRates.warm()`): a failure is logged but does not start the 60 s backoff, so a deploy-time blip never refuses the first real request without a provider attempt.
7. API 1.28.0-mut228 (renumbered behind MUT-227, which landed first); new error code `FX_RATES_UNAVAILABLE` (503).

**Alternatives rejected**:
- The phone calls Frankfurter itself, like the web: two copies of the provider logic and the JOD derivation.
- Persisting the last snapshot in the database so a cold start can serve stale: a table, a migration and two store implementations for a display-only hint the phone already caches (eng review D3).
- A route-specific 400 for a bad `base`: the only 400 in the API (eng review D2).

## ADR-088: Operator-Issued One-Time Setup Links Replace Printed Passwords; the Only Public Account Routes Are Sign-In and Redeeming a Link

**Status**: Active (partial override of ADR-037 §1)
**Date**: 2026-10-16
**Context**: MUT-235, epic MUT-34. `provision:user` and `rotate:password` printed a password Basel delivered by hand. Until it was used, the operator knew a working password to someone's money, and nobody could ever change their own. Onboarding the first paying hosted users needs something people trust, without opening self-service signup (ADR-037 §1, MUT-185). Decided with Basel on 2026-10-16 (pm-intake); eng review the same day. Design: `.claude/designs/mut-235-setup-links.md`.

**Decision**:
1. **The operator never handles a password.** `POST /admin/v1/users` creates the account with no password (`users.passwordHash` NULL) and returns a one-time setup link. `POST /admin/v1/users/{id}/setup-link` replaces `…/password` for resets. The CLI prints the link once, after a "shown once" line.
2. **A link is a 256-bit token in the URL fragment** (`<portal origin>/setup#<token>`), so it never reaches a request line, a log or a Referer. The store keeps only its HMAC-SHA256 under the session pepper (`sessionDigest`), so rotating the pepper also voids open links. A link lasts 72 hours (`--valid-hours`, 1–720), works once, and a newer link for the same person cancels it (`superseded`). Issuing locks the person's row, so they never hold two open links.
3. **A reset changes nothing until the link is used**: the current password and sessions keep working. **`--lock`** (eng review D2, a suspected takeover) clears the password and revokes every web and device session in the same transaction as the link. Disabling can't stand in for it, because a disabled person's link is refused.
4. **Two public routes, the only ones besides sign-in**: `POST /v1/account-setup/check` (valid → email, locale, purpose, expiry; otherwise only `expired | used | superseded | invalid`) and `POST /v1/account-setup` (a new password of 12–128 characters, NIST 800-63B, no composition rules). Both are same-origin only and share the sign-in IP limiter under their own key. A refused redeem is 410 `SETUP_LINK_UNUSABLE` with `details.state`.
5. **Redeeming claims the link inside the transaction that sets the password**: it clears any lockout, revokes every session (`password_set`) and audits `user.password_set` as the USER. A lost or refused claim writes nothing. Redeeming issues **no session**: the portal signs in through `POST /v1/sessions`, so there is still one way to mint a session.
6. **An account with no password signs in exactly like a wrong password**: `signIn` already verifies against the dummy hash when the stored one is null. That is one argon2 verify and the same 401 body. Pending accounts take the wrong-password path (a failure is recorded), as every existing account already does.
7. Setup links are set in the browser only: `/setup` stays out of `ALLOWED_APPLINKS_PATHS`, so the phone needs no new screen. API 1.29.0-mut235; audit actions `user.setup_link_issued` (ADMIN, metadata purpose / expiresAt / lock) and `user.password_set` (USER) replace `user.password_reset`.
7a. **Review fixes (qa-reconcile, 2026-10-16):** a link points at `PORTAL_ORIGIN` when set, otherwise at the host the operator called, always over https except on a loopback host (`setupLinkOrigin`), because behind Cloud Run the request reaches the server as plain http. Disabling a person cancels their open links in the same transaction, so re-enabling never revives one. `--lock` also stamps `passwordChangedAt`, so the session check refuses a session a racing sign-in inserts after the lock; redeem stamps a fresh instant taken after hashing for the same reason. A successful redeem also clears the in-process sign-in throttle. Sign-in creates its session tied to the hash it verified: the store re-checks that hash and an ACTIVE status under `FOR SHARE` on the person's row, which waits for a concurrent lock or redeem (`FOR NO KEY UPDATE`) to commit, so a sign-in that overlaps a `--lock` is refused rather than handed a session. Issuing a link re-checks ACTIVE under its own row lock, so a disable that lands first can never be followed by a fresh link. The first link is written in the same transaction as the user. `user.password_set` names the link (`linkId`, `purpose`). Rolling back past MUT-235 is forward-only once any password is NULL (DEPLOYMENT.md).
8. **The portal half (MUT-236, 2026-10-16, eng review D1–D3):** `/setup` strips the fragment with the router's `replace` before anything else and keeps the token only in React state (a reload then says the link is incomplete; nothing is stored). The check runs once per token and never refetches. The email is a visible read-only `autocomplete="username"` input, not a hidden field (D2: Safari's AutoFill is unreliable with hidden ones). A redeem that ends without an answer marks the attempt lost; a later 410 `used` then signs in with the typed password before saying the password is probably saved (D3, TD-149), at the cost of at most one counted sign-in attempt. Copy avoids every `HOSTED_RULES` self-service phrase; the rules don't change.

**Alternatives rejected**:
- A temporary password with a forced change at first sign-in: the operator still knows a working password until then, an unused one stays live, and the phone app would need a forced-change state.
- Emailing the link: there is no email provider. Basel delivers links by hand, as before.
- Issuing a session on redeem: a second way to mint one, with its own cookie and CSRF surface.
- Plain SHA-256 of the token (the ticket's wording): the session HMAC is the same cost, one helper instead of two, and stronger.

> **Override note (2026-10-20, ADR-159, MUT-331).** Decision 4's "only public routes" list gains `POST /v1/signups` and `POST /v1/account-recovery`. The "emailing the link" alternative is no longer rejected: self-requested links are mailed through Resend. Both new routes end on this ADR's `/setup` page and redeem; a new SIGNUP purpose is bound to an email, not a user.

**Consequences**: MUT-236 (portal `/setup` page) is served by the same server build, so both ship in one `make release server`, and no server release should go out between their merges. MUT-237/238 (change your own password) reuse `NEW_PASSWORD_POLICY`. Old token rows are never pruned (TD-146).

## ADR-089: One Spacing Scale, the Union, Canonical in the Brand JSON; Sizes Past It Are Named Layout Tokens; Spacing Joins the Literal Guard

**Status**: Active (extends ADR-058 and MUT-103's literal guard)
**Date**: 2026-10-16
**Context**: MUT-165, epic MUT-101. MUT-103 made colours, radii and font sizes token-only, but spacing stayed unguarded: 175 px/rem padding, margin and gap values outside `src/styles` (124 CSS declarations, 51 TSX style-object values). The brand JSON shipped a `space` scale (`[4, 8, 12, 16, 20, 24, 28, 32, 48, 56, 96]`) that nothing read and that disagreed with `theme.css`'s `--space-*` (which has 2, 6, 10, 40 and 64 in about 110 places). Eng review 2026-10-16, decisions D2–D12 in `.claude/designs/mut-165-spacing-guard.md`.

**Decision**:
1. **One scale, the union (D7/D8).** `mutaba3a.tokens.json` `space` is `[2, 4, 6, 8, 10, 12, 16, 20, 24, 28, 32, 40, 48, 56, 64, 96]`. `mutaba3a-theme.css` mirrors it as `--m-space-<n>` in rem (primitives only, PD7). `theme.css`'s `--space-0-5`…`--space-16` read `var(--m-space-<N×4>)`; `--space-0` and `--space-px` stay literal. Web pixel-identical. The Flutter app has no spacing scale, so it is untouched. `brand.test.ts` › `drift` checks the JSON and `--m-space-*` both ways, and › `tokens` checks every `--space-N` reads the N × 4px step.
2. **Sizes past the scale that one component needs are named layout tokens in `theme.css`, not new steps (D5/D6).** `--demo-banner-height` (36px) and `--checkbox-size` (18px) each feed both a size and the offset that clears it. `--landing-section-pad` (112) / `-compact` (80), `--landing-hero-pad-end` (96) and `--landing-page-top` (160) / `-compact` (120) name the landing rhythm, so the app's dense scale stays capped at 64px.
3. **3px snaps to 2px (D4).** The segmented control's track padding and its thumb's top/bottom inset move together to `--space-0-5`; so do the cross-profile badge gap and the Settings icon nudge.
4. **The literal guard covers spacing (D2/D3/D10).** `padding*`, `margin*` (physical and logical), `gap`, `row-gap` and `column-gap` may not hold a non-zero px or rem length outside `src/styles`, negatives, `var()` fallbacks and `calc()` terms included; `0`, `auto`, `%`, `em` and `calc()` over tokens pass. One `var()` hop is followed: a spacing value that reads a custom property a component stylesheet sets to a raw length fails. In TS/TSX, a style-object spacing key given a non-zero number (React renders px) or a string holding a px/rem length fails; values become `'var(--space-N)'` strings in place. `KNOWN_LITERALS` froze the 175 and is empty again.

**Alternatives rejected**:
- px only, CSS only (the ticket's wording): rem and `style={{ gap: 8 }}` would stay open dodges.
- The JSON as delivered as law: about 110 dense-screen sites would snap 1–8px, re-doing MUT-103's density.
- Bigger general steps (`--space-20/24/28/30/40`) for the landing: a 160px step would become legal app padding.
- A `--space-0-75` (3px) step: a scale step for three uses invites the next off-scale request.

**Consequences**: a new spacing value is a `--space-*` step or a named layout token; adding a step means editing the JSON first, then `--m-space-*` (the drift test fails otherwise). rem tokens scale with the reader's browser font size where the px they replaced did not (better for accessibility; the 375px matrix runs at the default size only). `/privacy`'s 160px top room may be stale since MUT-77 (D12 follow-up).

## ADR-151: Release Notes Live in One File; "What's new" Shows What This Browser Has Not Dismissed

**Status**: Active
**Date**: 2026-10-16
**Context**: MUT-24, from `TODO.md`: confirm an update applied. The app had no user-facing release notes. Web tags said only "Release web vX" (ADR-081), and `.claude/CHANGELOG.md` is engineering-facing, English-only and dated rather than versioned. The ticket asked that the notes not be hand-maintained in a second place. Basel chose a root `release-notes.json` (2026-10-16, D1).

**Decision**:
1. **`release-notes.json`** at the repo root maps `x.y.z` to `{ en: string[], ar: string[] }`, with the same number of non-empty lines in each language (`releaseNotesProblems`, tested). It is the only place notes are written.
2. **Three readers**:
   - The web app bundles it (`RELEASE_NOTES`).
   - `make release-web` refuses a bumped version without an entry (`npm run release:notes -- <v>`, between the bump and the build) and commits `release-notes.json` with the version bump (2026-10-20: v0.1.16 shipped without its notes because only the version files were committed, and the dirty tree then broke the server release).
   - `tag-release.sh` writes the English lines into the `web-v*` tag's message, from the file as it stood in the tagged commit.
3. **What shows.** `whats-new-seen-version` (localStorage) is the newest version this browser dismissed. The app shows every entry newer than it and no newer than the running version, newest first. `app-last-known-version` is not used for this, because `handleVersionChange` rewrites it on every start, so a tab closed without dismissing would lose the notes.
4. **Seeding.** Seeded once at start (`seedSeenVersion`):
   - a fresh install gets the running version, so it never sees notes;
   - an upgrade from before this ADR gets the version it came from;
   - unreadable storage means nothing shows.
5. **Dismissal.** Got it, Escape or the backdrop write the running version. Settings › About reopens the newest entry the build includes. A centred modal, not a drawer: a one-time notice, not work on a record.
6. **Notes describe the next version before the bump.** A QA build sets `MUTABA3A_APP_VERSION` to run as that version. The variable is unset in release builds.
7. Desktop is out of scope (retired until v2). The code is build-agnostic.

## ADR-090: Opt-In, Anonymous Product Analytics on the Landing Page, the Portal and the Phone App; the Local App Stays at Zero Telemetry

**Status**: Active (overrides the "no analytics of any kind" wording below; reaffirms ADR-024)
**Date**: 2026-10-17
**Context**: Epic MUT-152, MUT-153. Mutaba3a has users but no revenue, and every roadmap call is a guess without funnel numbers: where landing visitors go, and where phone users drop off between installing and recording their first payment. The privacy promise is the product's differentiator, so Basel asked for analytics that are "opt-in and anonymous". The plan, the decision ledger (P1–P5, D1–D6) and the eng review are in `.claude/designs/mut-153-analytics-adr-taxonomy.md`.

**Decision**:
1. **Who may send.**
   - Landing pages: cookieless, no banner (D1).
   - Hosted portal: opt-in.
   - Phone app (iOS, Android): opt-in.
   - **Never:** the local web app (`/app`) and desktop. ADR-024's "sends no telemetry" holds for them unchanged.
   - **Never:** the hosted API server (MUT-156 closed). Activation events come from the clients:
     - **The phone** creates clients and saves income, expenses and payments.
     - **The portal** saves income and payments (personal profile only, MUT-133) and expenses.

     It never creates clients. *Correction, 2026-10-17 (MUT-153 `/review`):* the plan first said the portal was read-only for money. That was wrong, so Basel re-decided P2: portal and phone both emit.
2. **Errors are Sentry's** (epic MUT-146), never PostHog's: no `$exception`, no exception autocapture (P1).
3. **One contract.** `docs/analytics/events.json` is the only list of events, properties, types and emitters.
   - **The test** (`scripts/__tests__/analytics-taxonomy.test.ts`) refuses:
     - free-text types; `semver` anywhere but `app_version`;
     - banned name tokens (amount, name, email, id, …, matched by whole token);
     - error and failure events; server/web/desktop emitters;
     - unknown keys and extra shared properties.
     - `currency` means one of the contract's top-level `currencies`, which the test checks against the hosted API's `SUPPORTED_CURRENCIES`.
   - **Versioned and pinned.** The file carries a version, and the test pins a sha256 per version (append-only), so content can't change under an unchanged version.
   - **Each surface's guard** (`before_send` or the Flutter equivalent, required) drops anything not in the contract, including SDK `$` properties that could carry identifiers: no URL, path, referrer or screen name on the portal or the phone.
   - **The Flutter repo** keeps a byte-identical copy with a sha256 row and a parity test, the brand-fixture pattern (D2).
4. **Anonymous** means:
   - never `identify()`, `alias()` or `group()`; no person profiles; no super properties beyond the shared three;
   - a random install ID created on opt-in and kept only on the device (on the portal in `localStorage`, never a cookie, because the portal shares its origin with the API);
   - a full reset, `$device_id` included, on opt-out, sign-out or account switch;
   - no amounts, names, free text, account, client or Malafat identifiers; a currency code is allowed;
   - **no location**: the project's GeoIP transformation is off (2026-10-17), and events send `$geoip_disable`;
   - no replay, autocapture, heatmaps, surveys, feature flags or remote config; IPs discarded at ingestion (`anonymize_ips`);
   - **no joining** PostHog data with the hosted database, server logs or Malafat data, and no person-level exports, because exact timestamps could otherwise link an ID to an account.
5. **Opt-in** is off by default, asked once per signed-in person, and the SDK isn't initialised before it. Consent belongs to the person, not the device: sign-out or account switch clears the choice, the ID, the asked flag and the phone's "first open already sent" flag, and sends nothing.
   - Opting out sends one final `analytics_opted_out`: capture it, flush (anything queued while opted in goes with it), opt out, reset.
   - This was D5, Basel's call against the recommendation; the policy says so.
6. **Tracking**, in Mutaba3a's public copy, means following a person across sites, apps or devices, or for advertising. Cookieless visit counting, and an opted-in random ID that is stored only on its device, sent only to PostHog and reset on sign-out, are not tracking by this definition. The landing hero's and privacy band's "No tracking" claims describe the free app and stay (P4).
7. **The public privacy policy changes with each surface** (P3). `docs/analytics/README.md` holds the approved en/ar wording; MUT-154, MUT-155 and MUT-157 each publish theirs with the feature, so the policy is never ahead of what ships.
8. **Where the data goes.** PostHog Cloud **EU** (`eu.posthog.com`), project "Mutaba3a" (id 304889) in the Barmajiyat organization, separate from Malafat's project. No firm data is sent, so ADR-024's residency rule for firm data is not engaged (the same reasoning as Sentry EU, MUT-147).
9. **Configuration.**
   - The key comes from `MUTABA3A_POSTHOG_KEY` on every surface (the web and hosted builds' environment; the Flutter `.env`), and only for production: Netlify's production context, never deploy previews or QA builds. Only a `phc_` key is accepted. No key means no sends and no errors. The host is fixed to `https://eu.i.posthog.com` (MUT-154 A1/A2).
   - The project is configured through the PostHog MCP, and its settings are recorded in INFRA §1, like Netlify Forms. TODOS #15 tracks moving them to the PostHog Terraform provider (D3).
   - **Access** to the project is limited to people Basel grants: an operator step in the PostHog UI.
10. **Landing specifics.**
    - **No country.** Cookieless events carry no country: GeoIP is off, and PostHog #48660 would strip the IP anyway. MUT-154 may propose a coarse country as a contract change.
    - **Where the SDK starts.** Only inside the lazily loaded landing page chunks, never `LandingProviders` or `src/main.tsx`, which `/app` shares.
    - **No referrer from the local app.** A referrer from `/app` is dropped.

**Override log**:
- **What it overrides.** The blanket "no telemetry, analytics, or tracking of any kind" wording in `.claude/SYSTEM_OVERVIEW.md` (principles and constraints), "Analytics: Intentionally none" in `.claude/CI_CD.md`, the README's "No tracking: no analytics" principle and its "will never add trackers or analytics SDKs" line, and the privacy policy's "None of our apps use analytics" sentences.
- **What replaces it.** The README now scopes those promises to the local app. The policy sentences are replaced surface by surface, using the wording in `docs/analytics/README.md`.
- **Not overridden.** ADR-024's guarantee for the desktop/PWA app (no telemetry, nothing leaves the device) and ADR-037's portal/app separation. The local bundles must never contain the SDK (enforced by `test:bundles` in MUT-154).
- **Why.** Funnel numbers are needed for product decisions (MUT-152), and opt-in, anonymous counting keeps the promise people care about: what they enter never leaves without their choice. **Date:** 2026-10-17.

**Alternatives considered**:
- Analytics in the local app too, opt-in: rejected. The free app's "nothing leaves your device" is the brand.
- PostHog for errors too: rejected for Sentry (better symbolication, and crash reports aren't limited to opted-in users).
- **Server-side activation events keyed by a header: rejected** (P2, re-decided 2026-10-17).
  - The portal and the phone can each emit on a confirmed save.
  - A header contract plus de-duplication on idempotent replays was cost without benefit.
- **Portal activation left unmeasured: rejected** (P2 re-decision). Portal-only users would never appear in the activation funnel.
- A consent banner on the landing page: rejected. Cookieless counting needs none, and a banner would lose most of the acquisition data.

**Consequences**:
- Any new event or property is a contract change: bump the version and update the Flutter copy.
- The four surfaces each own a privacy-policy paragraph.
- Opt-in rates can only be estimated against store-console installs, because nothing is sent before consent.

---

## ADR-091: Error Reports Go to a Mutaba3a-Only Sentry EU Org From the Server, Portal, Landing and Phone; Never From the Local App

**Status**: Active (reaffirms ADR-024 and ADR-090; closes ADR-090 rule 2's open half)
**Date**: 2026-10-17
**Context**: Epic MUT-146, MUT-147. Production failures were only found when a user complained: the API logged to pino and nothing else, and the portal, landing pages and Capture app reported nothing. ADR-090 had already decided that errors belong in Sentry, never PostHog. The plan, its decision ledger (R1–R9, D1–D13) and the eng review are in `.claude/designs/mut-147-sentry-foundation.md`.

**Decision**:
1. **Who sends.** One Sentry project per surface:
   - `mutaba3a-api`: the Hono server.
   - `mutaba3a-portal`: the hosted build.
   - `mutaba3a-landing`: `/`, `/download` and `/privacy`, started only inside the lazily loaded landing chunks, never `src/main.tsx` or `LandingProviders`.
   - `mutaba3a-capture-app`: Flutter, iOS + Android.
   - **Never:** the local web app (`/app`) or desktop. ADR-024's "sends no telemetry" holds unchanged.
   - Crash reports are not opt-in (unlike analytics): they carry no content, and the policy discloses them.
2. **Where.** A new, dedicated org in Sentry's **EU region** (`de.sentry.io`, Frankfurt), separate from any other product's org, so region and quota belong to Mutaba3a (R3).
   - **Why this squares with ADR-024's me-west1 rule.** That rule covers *firm data*, and these events are built to carry none (rules 3–5), so it isn't engaged. This is the same reasoning as ADR-090 §8.
   - When a rule fails, the fix is to scrub harder, never to accept the data.
3. **One contract, two files.** `docs/observability/sentry-rules.json` holds the lists. `sentry-fixtures.json` holds dirty-in/clean-out events (R5).
   - **Both are sha-pinned per version** by `scripts/__tests__/sentry-rules.test.ts`.
   - **Who reads what.** The portal and landing may import the rules file. The server and phone embed its lists and test equality. No app ever imports the fixtures: their marker string fails `check-bundles`.
   - **Flutter** keeps byte copies under the brand-fixture pattern (MUT-151).
4. **Scrubbing** (enforced in each surface's `beforeSend` / `beforeBreadcrumb` or the Dart equivalent, and proven by the fixtures):
   - `sendDefaultPii: false`.
   - No request bodies, cookies or query strings. `denyHeaders` are removed.
   - **Keys are matched as whole tokens.** A key is split on snake, kebab, dot and camelCase, and dropped when any token is a deny token. This covers `extra`, `contexts`, breadcrumb `data`, tags and user (R6).
   - **Never touched:** stack frames, `sdk`, `release` and `environment`.
   - **Context exceptions.** `safeContextKeys` (`os.name`, `browser.name`, …) are kept. `device.name` is always dropped.
   - **User and tags.** User is `{ id }` only. Tags are allow-listed.
   - **Breadcrumbs.** No console breadcrumbs. HTTP breadcrumbs keep only the method, the path-only URL and the status.
   - **Messages.** Labelled `key=value` pairs with a deny-token key become `key=[Filtered]`. Unlabelled free text is not caught, so surface code never interpolates user values into thrown messages.
   - **Off everywhere:** tracing, profiling, replay, screenshots and view hierarchy.
5. **Never reported.**
   - Server `ApiError`s below 500.
   - Each surface's `ignoredErrors`: offline, cancellation and browser noise, matched against `<type>: <value>` of the top exception. They use a regex subset that JavaScript and Dart read the same way, with an `ignoreCase` field instead of inline flags (R7).
   - Chunk-load errors are reported.
6. **Infrastructure as code.** `server/infrastructure/sentry/` is its own root module with its own state prefix, so server releases never need the Sentry token (D4).
   - **Keys.** `default_key = false` with one rate-limited key per project (R1).
   - **Origins.** `client_security.allowed_domains` on the portal and landing projects (R2).
   - **Noise and cost.** Browser inbound filters, plus spike protection on all four projects.
   - **Alerts.** New-issue, regression and spike email alerts.
   - **Tests.** `tests/sentry.tftest.hcl` asserts these settings against a mocked provider, in server-ci (R8).
   - **Not in the provider.** The org's own privacy settings (Require Data Scrubber, default scrubbers, Prevent storing IP addresses, sensitive fields = `denyKeyTokens`). `scripts/sentry-org-settings.ts --apply|--check` sets and verifies them (R9).
7. **Cost.** The free Developer plan, with the pay-as-you-go budget at **$0**: overage is dropped, never billed (R4). Move to Team when a second person needs access, or when the quota runs out two months running.
8. **Configuration.** DSNs only in production builds:
   - the Netlify production context;
   - the hosted build in `deploy.sh`;
   - Cloud Run via `terraform_remote_state`;
   - the fastlane release lanes.

   **Two tokens.** An upload-only token goes wherever builds run, never `VITE_`-prefixed and never in the Flutter `.env`, which is compiled into the app. An admin token for `terraform apply` and the settings script stays in the operator's shell.
9. **Disclosure.** Each surface publishes its own privacy-policy sentence and store labels together with the feature (ADR-090 P3). The en/ar draft is in `docs/observability/README.md`.

**Override log**: None. ADR-024 and ADR-090 are reaffirmed. The privacy policy's "none of our apps use … crash reporting" sentence is replaced by the surface stories as each one ships, never ahead of them.

**Alternatives considered**:
- **PostHog for errors**: rejected in ADR-090. Sentry has better symbolication, and crash reports aren't limited to opted-in users.
- **Reusing the existing Sentry org from another project**: rejected (R3). Its region may not be EU, and its quota and alerts would be shared.
- **Sentry config in the GCP Terraform module**: rejected (D4). Every server release would then need the Sentry admin token, and a Sentry outage would block deploys.
- **Substring key matching**: rejected (R6). It strips `filename`, `os.name` and `browser.name`, so reports lose their debug value.
- **Self-hosted Sentry in me-west1**: rejected. It would be a second stateful service to run, for data the rules keep content-free.

**Consequences**:
- Any change to either contract file is a version bump, a new pinned row and a new Flutter copy.
- A new portal or landing origin (MUT-112's custom domain) must be added to the Terraform origin variables, or its errors are dropped silently.
- `sentry_issue_alert` is deprecated in favour of `sentry_alert`; TECH_DEBT tracks the move.

**Amendment (MUT-147 pre-landing review, 2026-10-17)** — Basel's answers D1–D13 in `.claude/designs/mut-147-sentry-foundation.md`; contract 1.0.0 was re-pinned before it merged. These supersede the matching sentences above:
- **Server-side sensitive fields are a curated list (D2).** Sentry's scrubber removes any value *containing* a sensitive field, so `orgSensitiveFields` holds only long, distinctive entries. A test proves none occurs in kept fixture text. It replaces "sensitive fields = `denyKeyTokens`". `--apply` merges with hand-added fields.
- **Every URL-bearing field keeps the path only (D3)**: `request.url` and breadcrumb `url`/`from`/`to`, with no query and no fragment. The portal's `/setup#token` link is the reason.
- **Labelled values cover three forms (D4).** `key=value`, `key: value` and `"key": value` are all caught, through one shared `labelledValuePattern`. `^Prisma` exception values keep their first line only, and the server uses Prisma `errorFormat: 'minimal'`.
- **EU residency is verified, not assumed (D5).**
  - A `sentry_key` postcondition requires `.ingest.de.sentry.io` DSNs.
  - The settings script refuses an org whose `links.regionUrl` isn't `https://de.sentry.io`, before writing.
  - The runbook never falls back to `sentry.io`.
- **Keys are capped per day, not per hour (D6).** api 60, capture-app 60, portal 20, landing 20. The sum over 31 days must fit `monthly_event_quota` (Terraform validates it), so no public DSN can exhaust the shared quota and blind the API.
- **More org switches (D7).** `enhancedPrivacy` on, `allowSharedIssues` off, `require2FA` on, `safeFields` empty. All are applied and drift-checked.
- **Separate token names (D8).** The admin token is `SENTRY_ADMIN_TOKEN`, handed to one command at a time; `SENTRY_AUTH_TOKEN` only ever means the upload token.
- **Stricter settings script (D9).** The script takes only `--apply`/`--check`, with the org from `SENTRY_ORG`. It sends the admin token only to `sentry.io` hosts and prints its target before writing.
- **Frame locals (D10).** `includeLocalVariables: false`; scrubbers drop frame `vars` and leave the rest of the frame untouched.
- **Lowercase compounds (D11).** Compounds such as `username`, `apikey` and `phonenumber` are deny tokens in their own right.
- **Contracts CI (D12).** `contracts-ci.yml` runs the Sentry and analytics contract tests when those files change. `.gitattributes` keeps them LF.
- **Org slug (D13).** The suggested org slug is `mutaba3a`, not the company name.
- **Phone.** The phone starts Sentry only in release builds, with the DSN from fastlane's own `--dart-define`. Its `.env` also feeds `make run`.

**Amendment 2 (MUT-147 pre-landing re-review, 2026-10-17)**: Basel's answers D15–D17. Contract 1.0.0 was re-pinned again before merge.
- **Labelled values (D15).** `labelledValuePattern` has two branches: quoted keys (`"key":value`, compact or spaced) and bare keys (`key=`, `key = `, `key: `) whose value runs to the end of its clause. The scan continues from a harmless label's value, so it can't hide a sensitive one behind it. Surfaces truncate a message to `maxMessageLength` (8,192 characters) before scrubbing, and keys are bounded to 64 characters. Rescanning after harmless labels would otherwise go quadratic; with the cap, the worst case is about 20 ms. A fixed list of leak strings in the contract test must vanish after scrubbing, so the test no longer grades the pattern with itself.
- **Wrong-org guard (D16).** The settings script refuses an org holding any project that isn't `mutaba3a-…`, before writing. An empty org passes, for the first run.
- **Request fields (D17).** `Referer` joins `denyHeaders`, `fragment` joins the deny tokens, and `requestDropFields` (`data`, `cookies`, `query_string`, `fragment`, `env`) puts whole-field drops in the contract.
- **Mechanical fixes.** The admin token is a personal (user) token. Terraform needs `>= 1.9.0` (the quota validation refers to another variable). Requests refuse redirects. The region comparison ignores a trailing slash.

**Amendment 3 (MUT-147 final re-review, cycle 3, 2026-10-18)**: Basel's answers D18–D19, plus regression fixes to D15. Contract 1.0.0 was re-pinned before merge.
- **Nested and cut-off values (D15 fix).**
  - Under a quoted key, a nested `{…`/`[…` value runs to the end of the line, so everything under a sensitive container key is filtered.
  - A quoted string cut off by truncation runs to the end of the line.
  - Under a bare key, a parenthetical doesn't end the value.
- **Domain PII labels (D18).** `client(s)`, `vendor(s)`, `mobile`, `tel`, `mail`, `title` and `reason` are deny tokens. `user` is deliberately not, because it would strip `User-Agent`.
- **URLs in free text (D19).** `urlInTextPattern` cuts the query and fragment off every http(s) URL in exception text, messages and breadcrumb messages before the labelled-value scan.
- **Order of operations.** Truncate, first-line-only, URL strip, labelled values. The contract test's reference scrub must reproduce every fixture.
- **Paginated project lists.** The settings script refuses a paginated project list, because it can't then prove the org is Mutaba3a-only.
- **Not converged.** The review stopped at its three-cycle limit. These cycle-3 changes passed the gate and QA but no fourth review pass.

**Amendment 4 (MUT-147 convergence review, 2026-10-18)**: Contract 1.1.0. 1.0.0 was already merged, so it stays pinned beside the new row (append-only).
- **Money and free-text keys.** `minor`, `reference`, `label` and `metadata` are deny tokens, so `grossMinor` and `netMinor` go. Plurals are listed beside their singulars. Keys also split at letter–digit boundaries, so `email2` and `address2Line` match.
- **Multi-line values.** A container value under a sensitive key runs on through the indented lines below it, so pretty-printed JSON and `util.inspect` output are covered.
- **Messages.** The event message (string, `message.formatted`, `logentry.formatted`) and breadcrumb messages get the same scrub as exception values, and `messageDropFields` (`params`) is dropped from structured messages. `^FormatException` keeps its first line only.
- **Spike alert.** The threshold defaults to 10 an hour, and Terraform rejects one at or above the smallest daily key cap, which the alert could never reach.
- **Runbook.** The Sentry module's `terraform init` reads `backend.production.hcl` instead of a `TF_STATE_BUCKET` the runbook never sets. The tools list says Terraform `>= 1.9`, which the Sentry module requires (the GCP module needs only 1.5).
- **Second review pass (still 1.1.0, re-pinned before merge).**
  - Under a bare key, a `{`/`[` container runs to the end of the line and through the indented lines below it, also after a `util.inspect` prefix (`Set(n) {`, `Map(n) {`, `Client {`, `[Object: null prototype] {`). Before, one-line nesting such as Dart's `{client: {id: c1, display: John Smith}}` stopped at the first `}` and leaked its later siblings.
  - `==` and `===` are not labels, so assertion text is left alone.
  - `firstLineOnlyExceptionTypes` also matches the start of the value, because an obfuscated Flutter build renames `FormatException`.
  - `flutter_error_details.context` and `.information` are always-dropped context keys.
  - Plurals `references`, `labels`, `ibans`, `mobiles`, `usernames`.
- **Third review pass (still 1.1.0, re-pinned before merge; the last fix cycle the review allows).**
  - Quoted keys take `=>` as well as `:` (`util.inspect` Map and URLSearchParams entries) and the same container prefixes as bare keys.
  - A bare key may be followed by `)`, for Dart's `Invalid argument (key): value` and `RangeError (key): value`.
  - Plurals of the lowercase compounds: `phonenumbers`, `emailaddresses`, `apikeys`, `accesstokens`, `refreshtokens`, `sessionids`, `firstnames`, `lastnames`, `fullnames`, `payloads`.
  - Bracketed form keys (`client[name]=…`) are a documented limit.

**Amendment 5 (org choice, 2026-10-22)**: Basel: use the company org **`barmajiyat-ltd`** (EU region, `de`), which owns both Mutaba3a and Malafat. This replaces rule 2's "new, dedicated org" and D13's suggested slug `mutaba3a`.
- **Why R3 is still met.** R3 rejected another product's org because its region might not be EU and its quota and alerts would be shared. `barmajiyat-ltd` is EU, and for now it holds no other product, so Mutaba3a has the quota and alerts to itself. The EU checks (D5) still run on every apply.
- **The Barmajiyat CLAUDE.md already named this org.** The MUT-147 plan was written against the earlier option of a fresh signup and never weighed it.
- **Unchanged.** The team slug, the `mutaba3a-…` project slugs, the scrub contract, the daily caps and the org privacy settings. The wrong-org guard (D16) still refuses any project that isn't `mutaba3a-…`.
- **Before another product joins the org**, TD-198 has to be fixed: the guard would refuse the org, the org-wide privacy settings (`require2FA`, `enhancedPrivacy`, sensitive fields) would apply to that product too, and the free plan's one quota would be split.

**Amendment 6 (MUT-148 build, 2026-10-22)**: the API surface. Basel's answers D1–D5 in `.claude/designs/mut-148-api-sentry.md`.
- **SDK (D2).** `@sentry/node-core/light` 10.76.2, exact pin: errors only, no OpenTelemetry installed, default integrations off (only event filters, function-to-string, linked errors, dedupe, context lines, node context, uncaught exception, unhandled rejection in `strict` mode, which keeps Node 22's crash).
- **One seam.** `server/src/observability/`: `sentry-rules.ts` (the contract embedded, parity-tested), `sentry-scrub.ts` (the pure whole-event scrubber, every surface's fixtures; MUT-149/150 reuse it), `reporter.ts` (`ErrorReporter`, `NOOP_REPORTER`, `runScript`, `shutdownAndFlush`) and `sentry-node.ts`, the only SDK importer. `app-shell.ts` takes the reporter by injection because the portal's local mode bundles it; a root test walks the import graph to prove the local app never reaches `@sentry/`.
- **What reports.** Exactly what `onError` already logs as an error: unknown errors and ApiErrors at `serverReportsStatusAtLeast` (500) or higher, tagged `request_id` and the route template. Pre-roll and post-roll report their crashes (D3 default: no new tag; the frames name the script). `server_name` is fixed to `mutaba3a-api`, because the SDK would otherwise send the host name, which on the operator's laptop is a person's.
- **Release and environment.** `mutaba3a-api@<server package.json version>+<SERVICE_VERSION>`; `SENTRY_ENVIRONMENT` (Terraform sets the environment), defaulting to `NODE_ENV`.
- **Config.** `SENTRY_DSN` is optional and must match the EU DSN shape at boot, the same rule as the Sentry stack's postcondition and `sentry.tf`'s precondition (D5).
- **Infra.** `sentry_enabled` (default false) reads the stack's `dsn` with `terraform_remote_state`, stores `mutaba3a-api-sentry-dsn`, mounts it; `guard_sentry_release` refuses a release that would unmount it, as the Stripe guard does.
- **Proof in production (D4).** `/health` reports `errorReporting: on|off` (API 1.48.0-mut148) and every release smoke checks it; `npm run sentry:smoke` sends one deliberate event.
- **Privacy (D5).** The policy names only the servers as senders until MUT-149..151 ship their surfaces (ADR-090 P3).

**Amendment 7 (hand-made projects, 2026-10-22)**: Basel created two projects in Sentry's UI before the first apply: `mutaba3a-web` for the portal and `mutaba3a-flutter` for the capture app. Terraform adopts them instead of creating `mutaba3a-portal` and `mutaba3a-capture-app`.
- **How.** `local.surfaces` carries each surface's slug and an `adopted` flag. An `import` block (behind `import_hand_made_projects`, default true; the offline tests set it false because a mocked provider can't import) brings the two under Terraform on the next apply. `mutaba3a-api` and `mutaba3a-landing` are still created. Keys, alerts and spike protection are named after the slugs.
- **What import can't do.** `default_key = false` and `default_rules = false` apply only at creation, so the adopted projects keep Sentry's uncapped `Default` key and default alert rule. DEPLOYMENT.md §1.5 step 7 has the operator revoke both; the `mutaba3a-web` Default key's DSN was also pasted outside Sentry.
- **Unchanged.** Every slug still starts `mutaba3a-`, so the settings script's wrong-org guard (D16) holds without change. Surface keys (`portal`, `capture-app`) are unchanged, so the DSN homes in the README stay the same.

**Amendment 8 (first apply, 2026-10-22)**: the first `terraform apply` created the projects, team, keys, filters and spike protection, then failed twice.
- **Alerts → `sentry_alert`.** Every `sentry_issue_alert` create answered 404: Sentry retired the classic issue-alert endpoints in August 2026. The three alerts per project are now `sentry_alert` workflows whose `monitor_ids` is the project's default error monitor (`data "sentry_project_error_monitor"`). Same triggers (`first_seen_event`, `regression_event`; the spike has no trigger and filters on `event_frequency_count` > 10 in 1h) and the same email to issue owners, falling through to all members. TD-159 resolved.
- **No per-key caps (supersedes D6's daily caps).** Sentry accepted the keys but returned no rate limit, and the provider reported an inconsistent result. Basel confirmed in the UI that key rate limits need a paid plan. `sentry_key` sets none; `key_rate_limit_per_day` and `monthly_event_quota` are gone, and the spike threshold need only be positive. Guards left: spike protection and the $0 pay-as-you-go budget. The risk is TD-200.
- **Keys kept.** The four keys from that apply were tainted; `terraform untaint` keeps them (and their DSNs) instead of recreating them.

**Amendment 9 (E33 shares the org, 2026-10-22)**: the settings script refused `barmajiyat-ltd` because it also holds E33's `e33-api` and `e33-flutter`. Basel chose to share the org.
- **Guard.** `scripts/sentry-org-policy.ts` checks an allow-list of product prefixes, `mutaba3a-` and `e33-`, instead of `mutaba3a-` alone. Any other project still stops the script before it writes, naming the project (D16 holds).
- **Org-wide settings.** E33's projects get the same org settings: 2FA required, data scrubber with the curated sensitive fields, no IP storage, Enhanced Privacy, no shared issues. Basel accepted this for E33.
- **Quota.** E33 now shares the free plan's monthly error quota, with no per-key caps on either product (TD-200).
- **Another product** joins only by adding its prefix with the same decision.

**Amendment 10 (the phone, MUT-151, 2026-10-22)**: the Capture app reports to `mutaba3a-flutter`.
- **Start.** Release builds only, with a DSN matching Sentry's EU ingest (`tool/sentry_dsn_pattern.txt` in the Flutter repo, which the release lanes also check). The DSN comes from the Keychain, never `.env`.
- **Errors only.** Sessions, ANR, app-hang and watchdog tracking are off; so are the SDK's HTTP and native auto-breadcrumbs, failed-request events and client reports. Freeze reporting would need its own policy wording.
- **Scrubbing.** A Dart port of the contract scrubber runs as `beforeSend` and `beforeBreadcrumb` and passes every contract fixture. The phone truncates text to 2,048 characters, not 8,192 (the worst case measured 150–300 ms at 8,192 in Dart). If scrubbing throws, a bare report (types, frames, release, allowed tags, `scrub_failed`) is sent instead.
- **Native crashes** skip the Dart scrubber. A project-level Advanced Data Scrubbing rule on `mutaba3a-flutter` is their second layer (INFRA §1).
- **ApiErrors.** Only `serverError` with status 0 (an unreadable reply) or 5xx is reported. Repositories catch errors into `Result`, so unreadable replies are reported explicitly at each site, by endpoint and error type only, never the error's text.
- **User.** The account's internal id. The store answers therefore say crash data is **linked to identity** (App Store) and add **User IDs** (Play).
- **Excluded.** The Share Extension, widgets and Siri intents send nothing (follow-up MUT-395). Superseded by amendment 13.

**Amendment 11 (the portal, MUT-149, 2026-10-23)**: the hosted portal reports to `mutaba3a-web`. Design and Basel's answers: `.claude/designs/mut-149-portal-sentry.md` (eng D1–D6, design D3–D8).
- **Signed in only.** `src/hosted/observability/errorReporting.ts` is in the entry and imports no SDK. It loads `portalSentry.ts`, a lazy chunk and the one portal file that imports `@sentry/browser`, only in `remote` mode (ADR-097 §10). Until the chunk arrives it holds up to 10 window errors, rejections and boundary reports, then replays them (eng R1); signing out stops the SDK and drops them. A build without `MUTABA3A_SENTRY_DSN` compiles the chunk out. Every event is also dropped at send time unless the mode, read live from storage, is still `remote` (review: another tab's sign-out may not reach the gate when a crash screen has replaced the router).
- **SDK 11.** `@sentry/browser` 11.8.0 has no `sendDefaultPii`. The contract's `sendDefaultPii: false` and `includeLocalVariables: false` are spelled out as `dataCollection`: no user info, cookies, bodies or query params; User-Agent is the only header kept. Integrations: global handlers, fetch and history breadcrumbs, linked errors, dedupe, HTTP context. No tracing, replay or feedback.
- **Shared options.** `src/lib/observability/browserSentry.ts` builds the init options from the contract and runs every event and breadcrumb through MUT-148's `scrubEvent`. MUT-150 reuses it. Lint lets it import only `sentry-rules` and `sentry-scrub` from the server, and lets only `portalSentry.ts` load the SDK.
- **ApiErrors.** Every `ApiError` that reaches the window is dropped: the UI owns it, and the server reports its own 5xx. One that reaches a boundary or the router's `onCatch` is a crash, reported with `request_id`.
- **User.** The internal user id only, no org (D5; AC3 amended on Jira). The org is one lookup away from the user id or the `request_id`.
- **Tags.** `surface`; `locale` and `route` (the route id template, never the path) read at send time; `app_build`.
- **Config.** The DSN comes from `deploy.env` (`MUTABA3A_SENTRY_DSN`; no `VITE_` variables). The build refuses a DSN on any host but `SENTRY_INGEST_ORIGIN` (`server/src/observability/sentry-ingest.ts`), the one origin `PORTAL_CSP` adds, so they cannot drift. Release `mutaba3a-portal@<server version>+<sha>`: the portal ships inside the API image.
- **Source maps.** Hidden maps, uploaded by `@sentry/vite-plugin` and then deleted, only when `SENTRY_AUTH_TOKEN` is set (the shell, else Keychain `release-kit` / `barmajiyat/SENTRY_AUTH_TOKEN`, D6). a failed upload fails the build (`errorHandler` throws; the plugin only logs by default), `make release server` stops before committing or pushing on a DSN without the token (deploy.sh checks again), `check-bundles --dist dist-hosted` fails on any `.map`, and the server answers 404 for `*.map`.
- **Crash screens.** A page crash shows the inline `CrashCard` and the shell stays; a frame crash shows `ReloadToContinue` with the `CRASH` stop; a crash above every provider shows a static Arabic-then-English screen. None shows the error's own text.
- **Expired session.** The mode stays `remote` after a session expires, so the sign-in page a returning person lands on still reports crashes, with no user attached. Basel accepted this on 2026-10-23: it is the same person in the same browser, the reports are crash-only, and a crash on the sign-in page is worth knowing about. ADR-097 §10's "signed out" means local mode.
- **Known gap.** Ad blockers that block `*.ingest.sentry.io` lose those reports. A tunnel through our server was weighed and rejected at pilot volume.
- **Bundle rule.** The `HOSTED_RULES` ban on `اشترك` is retired (Basel, 2026-10-23): MUT-362's billing copy (ADR-170) says «الاشتراك», which made `test:bundles` fail on main, and deploy.sh now runs the hosted check.

**Amendment 12 (the landing, MUT-150, 2026-10-24)**: the website's pages report to `mutaba3a-landing`. Design, eng review and Basel's answers: `.claude/designs/mut-150-landing-sentry.md` (D1–D9).
- **Website pages only.** `src/pages/landing/observability/landingErrorReporting.ts` is in the web entry and imports no SDK. `main.tsx` starts it before React renders, and only when `landingRoute(location.pathname)` names a website page (`/`, `/download`, `/privacy`, `/terms`, `/terms/:version`; eng D7, O5). The local app's routes never start it (ADR-024). It loads `landingSentry.ts`, the one landing file that imports `@sentry/browser`, after load + idle (`afterLoadIdle`, shared with PostHog, eng D5). Until then it holds up to 10 window errors, rejections and boundary crashes, then replays them; after the handover the SDK's own handlers own window errors (eng O8).
- **Send-time guards.** Every event is dropped unless the page is still a website page (eng D2: a future in-page navigation into `/app` sends nothing). A page load sends at most 5 reports, counting only events that leave after scrubbing (eng D3, TD-200).
- **Same options as the portal.** `browserSentryOptions('landing')`: no user ever, no tracing, replay or feedback; tags `surface`, `locale`, `route` (the template), `app_build`; the page URL keeps its path, never its query string.
- **Crash screen.** A crash on a website page shows `LandingCrashScreen` in the visitor's language with a Reload button, not the app's English "Your data is safe" fallback (eng D9).
- **Config.** `MUTABA3A_LANDING_SENTRY_DSN` (not `VITE_`), Netlify's production context only, refused unless on `SENTRY_INGEST_ORIGIN`. Release `mutaba3a-landing@<app version>+<COMMIT_REF:7>`; environment from Netlify's `CONTEXT`. Without the DSN the web build defines the gate off, names no `vendor-sentry` chunk and emits no Sentry file at all (eng O2); desktop always gets the "off" defines.
- **Source maps.** Hidden, uploaded to `mutaba3a-landing` and deleted (`sentrySourceMaps`, shared with the portal, eng D4). A Netlify production build with a DSN and no `SENTRY_AUTH_TOKEN` fails, and a failed upload fails the build. Escape for a Sentry outage at release time: remove the DSN from Netlify's production context, redeploy, restore it after.
- **Debug IDs in the local app's files (Basel, eng D6).** With the token set, `@sentry/vite-plugin` 11 writes an inert `_sentryDebugIds` line into every dist-web chunk, the local app's included. It is not the SDK and sends nothing; check-bundles still proves the SDK, the ingest host and any precached Sentry file are absent outside the landing's lazy chunks. Production app chunks therefore differ from QA builds.
- **Bundle guard on Netlify.** `netlify.toml` runs `check-bundles --dist dist-web` after the build (TD-084 for the landing). dist-web may carry the SDK only in `vendor-sentry-*` / `landingSentry-*`, never from the entry graph, never precached (`SENTRY_PRECACHE_IGNORES`), and the ingest host and `docs.sentry.io` are allowed in those chunks only (`PATTERN_SCOPED_ORIGINS`, eng O1).
- **No landing CSP.** The landing serves none (checked live 2026-10-24), so MUT-150's CSP criterion is N/A; a landing CSP would be its own ticket.
- **Privacy copy.** "Our website sends a report when one of its pages crashes or hits an error…" (eng D8: not "fails to load", which it mostly can't report).

**Amendment 13 (the iOS extensions, MUT-395, 2026-10-24)**: the Share Extension, widgets and Siri intents report to `mutaba3a-flutter`. Design and Basel's answers: mutaba3a-flutter `.claude/designs/mut-395-extension-sentry.md` (D1–D6).
- **Own SDK, same version.** sentry-cocoa 8.58.4 (the app's pod version) over SPM, the static `Sentry` product, through the local package `ios/CaptureReporting`, linked into the three extensions and never Runner (D1).
- **Same contract, in Swift.** `CaptureScrub` is a line-for-line port of the app's `event_scrubber.dart`, run by `swift test` against the same pinned contract copy (all 11 fixtures, parity, sha256). `beforeSend` clears the user (D3), tags `surface=capture-app` and `route=share-extension|widgets|intents`, scrubs, and rebuilds the event through `SentryEventDecoder` (SPI); a scrub that can't complete sends the MUT-151 D14 minimal report, never the original.
- **Off by default.** A Run Script phase writes `SentryDSN` into each extension's Info.plist only when the build carries `MUTABA3A_SENTRY_DSN` (Flutter's DART_DEFINES): debug and `SENTRY=off` builds report nothing. Sessions, app-hang, watchdog, performance and network tracking are off; the crash handler is on, and a crash is sent on that extension's next start.
- **Store and privacy.** Each extension's privacy manifest declares crash and diagnostic data, not linked. The store answers (MUT-151) already declare crash data, and the privacy sentence "The iPhone and Android apps send a report when the app crashes…" covers the app's own extensions, so no copy changes.
- **Symbols.** The iOS lane uploads gym's dSYM zip (the extensions' dSYMs) after the existing upload; first exercised on MUT-413's release.
- **Open.** The widget memory budget (D2: under 20 MB peak with Sentry on, else widgets are excluded) and the forced-crash proof per extension (D6) wait for a simulator session with Basel's taps.

## ADR-092: The Phone Sends Its Opt-In Counts Through Its Own Small Dart Client, Not posthog_flutter

**Status**: Accepted (2026-10-17, MUT-157; auto-decided on the recommended option at Basel's request, C1)

**Context**: ADR-090 item 3 requires every surface's guard to drop anything outside the contract, SDK `$` properties included. The phone's published sentence (`docs/analytics/README.md`, Phone app) promises that a note says only the event, its currency and paid flag, the app and library versions, the language, the OS and its version, and phone or tablet. The MUT-157 ticket named posthog_flutter. Reading posthog_flutter 5.55.0 showed:
- Its Dart `beforeSend` runs before the event reaches the native iOS and Android SDKs.
- The native SDKs then add their own properties: device model and manufacturer, timezone, screen size, network carrier, app build and more. No Flutter-side hook can remove them.
- The plugin's pure-Dart engine is an internal API that labels every event "Linux / Desktop".

**Decision**:
1. **The client.** The phone posts PostHog's documented capture API itself: `POST https://eu.i.posthog.com/batch/` through Dio. The code is `lib/domain/services/analytics/` in the Flutter repo.
2. **The guard builds every note.** `guardEvent()` is the only code that makes a note's properties, so the guard isn't a filter on someone else's payload. It emits only:
   - the contract properties;
   - `surface`, `app_version`, `locale`;
   - the random install ID as `distinct_id` and `$device_id`;
   - `$os`, `$os_version`, `$device_type`, `$lib`, `$lib_version`;
   - `$process_person_profile: false` and `$geoip_disable: true`.
3. **Nothing native.** No PostHog SDK, no Info.plist or manifest keys, and nothing initialised before or after opt-in beyond a Keychain record. The install ID exists only between a yes and the next opt-out or sign-out.
4. **Delivery.** A Keychain queue (capped at 200) delivers at once, on connectivity regained and at sign-in. That is what makes the ticket's opt-out order (capture, flush, opt out, reset) hold offline.
5. **Release only.** The key is used only by release builds with a `phc_` key (`kReleaseMode`). Debug and QA builds can't send. Tests and release-QA flows inject a recording transport.

**Override log**:
- **What it overrides.** The MUT-157 ticket's "posthog_flutter" scope line. It does not change ADR-090: the decision is the faithful way to meet its item 3.
- **Date:** 2026-10-17.

**Alternatives considered**:
- **posthog_flutter, plus a PostHog ingestion transformation that drops the extra properties.** Rejected: the data would still leave the phone, and the policy says a note carries only those fields.
- **posthog_flutter's Dart engine forced onto mobile.** Rejected: internal API, and it mislabels the OS.
- **Fewer promises in the policy.** Rejected: the narrow promise is the product's point.

**Consequences**:
- About 300 lines of Dart in place of a dependency. PostHog's capture API is stable and documented.
- No session or feature-flag machinery, which ADR-090 turns off anyway.
- Apple's privacy label lists only what this client sends.

---

## ADR-093: One Newest-First Entries Feed Across a Person's Profiles, Read-Only and Index-Bounded

**Status**: Accepted (2026-10-18, MUT-270; decisions D1–D6 from the eng review, Basel's answers)

**Context**: The phone's Recent showed only what that phone saved plus the Unsorted inbox. Basel wants the phone and the portal always in sync, so Recent must read what each profile holds, whoever logged it. A profile's history was four per-organization lists (`/v1/expenses`, `/v1/payments`, `/v1/receivables`, `/v1/conversions`) with different orders and cursors; merging them on the phone costs 4 requests per profile per page.

**Decision**:
1. **The route.** `GET /v1/entries` is session-only and organization-independent (no `X-Mutaba3a-Profile`), like `/v1/inbox`. An optional, repeatable `profileId` narrows it; any id outside the person's memberships answers 404 `Profile not found`, the same as `selectProfile`. `limit` 1..100, default 20. Items wrap the existing Expense, IncomeResponse and Conversion objects in `{ kind, profileId, createdAt, createdByUserId }` (plus `origin`, `settlesOwedId` and `replacesPaymentId` on received payments and `receiptCount` on expenses). A page is a snapshot: clients cache only the pages they re-read.
2. **What an entry is (D2).** Expenses, received payments, Owed receivables of origin ADJUSTMENT, and conversions. Scheduled installments and retainer charges are not entries, and the feed never lazy-posts, so a read never writes. Deleted rows and capture undos are left out; a payment Malafat reversed stays, as `reversed`.
3. **Order and cursor (D4).** `createdAt desc, id desc` — when each entry was logged — through `pagination.ts`'s (createdAt, id) envelope unchanged. A cross-table UUID collision at the same millisecond on a page boundary would skip one row; accepted.
4. **Queries (D3).** One typed Prisma `findMany` per organization and kind, `limit + 1` rows each, one organization at a time with its 4 kinds in parallel (at most 4 pooled connections per request), merged by the pure `mergeNewestFirst` (`server/src/entries/merge.ts`), which the memory store shares. No raw SQL. The cursor condition is `createdAt <= t AND (createdAt < t OR id < i)`: the equivalent OR-only form made Postgres sort the organization's rows. New indexes `(organizationId, createdAt desc, id desc)` on expenses and conversions and `(organizationId, origin, createdAt, id)` on receivables; payments reuse `(organizationId, createdAt, id)` backwards. A test:db EXPLAIN test pins every query to an ordered index scan.
5. **Income status (D5).** `IncomeStatus` widens to `unallocated | partial | allocated | reversed | open | settled`, derived from the record by `incomeStatusOf`; a fresh capture is still `unallocated`.
6. **Connection pool (D6).** Terraform writes `connection_limit` (`db_pool_size`, 10) into the DATABASE_URL and sets Cloud SQL `max_connections` (`db_max_connections`, 50) explicitly, with a precondition `2 × db_pool_size × max_instances + 10 ≤ db_max_connections` (old and new revisions overlap during a deploy). The secret version is replaced destroy-first (`create_before_destroy` would propagate to the fixed-name instance and secret).

**Alternatives considered**:
- **Every receivable origin, lazy-posting per organization before the read.** Rejected: writes on a GET across every profile, and scheduled rows crowd out what people typed.
- **Raw `unnest … CROSS JOIN LATERAL` SQL, 4 queries total.** Rejected: bypasses Prisma's row types; the first raw list query in the repo.
- **One typed query per kind with `organizationId IN (…)`.** Rejected: Postgres may sort a whole firm's rows per page.
- **A separate `allocationState` field beside `income.status`.** Rejected: two fields that disagree.
- **`kind` in the cursor.** Rejected: a new envelope and sort column for a case that will not occur.

**Consequences**:
- 4 × N small queries per page (N = memberships), at most 4 at once, plus one membership read, one receipt count and, when a capture with money applied is on the page, one allocation read.
- Adding the flag restarts Cloud SQL, and `deploy.sh` step 0's targeted apply would do it implicitly; apply the instance on its own, first, in a quiet window (INFRA.md).
- The phone (MUT-271) reads this feed and parses the widened status; the server deploys first.
- API 1.32.0-mut270.


## ADR-094: Expense Groups Are Date Ranges Whose Members Are Computed When Read; Per-Currency Only, No Server Conversion

**Status**: Active
**Date**: 2026-10-18
**Context**: MUT-267 (epic MUT-266). A person wants a trip (e.g. to Jordan) as one view: every expense dated while away, minus the ones that don't belong, plus a few from before (the flight). Totals overall, per day and per category. Hosted only (portal MUT-268, phone MUT-269), because the phone, where trip expenses are logged, talks to hosted profiles only. Numbered 094 because MUT-270's unmerged branch holds ADR-093.

**Decision**:
1. **A group is a named range on one profile.** `expense_groups`: `startOn`, `endOn` (null = still going), notes, versioned, soft-deleted. It lives in the **expenses** writability domain: `expenses:read|write`, session-only, writer of record USER, and audit entity `expense_group` is hidden from Malafat's key.
2. **Membership is computed when read, never stored.** A member is dated inside the window and not left out, or kept. The window is `startOn..(endOn ?? startOn + 365)`: an open group stops collecting a year after its start (eng re-review R6).
   - `groups.ts` `isGroupMember` is the one rule.
   - Prisma's `expenseGroupWhere` is pinned to it by the shared store contract.
3. **Marks.** `expense_group_overrides` (PK group + expense) holds `excluded` or `included`.
   - Any mark is accepted on any expense of the profile, and the last write wins (D3/D6).
   - A mark survives date changes.
   - "Left out" lists only excluded expenses dated inside the window (design review 22A).
4. **Ranges** are at most 366 days (`GROUP_RANGE_TOO_LONG`). The merged range is checked on PATCH. Changed dates must be within ten years either side of the profile's today: the MUT-227 floor, plus the `DAYS_IN_FUTURE_LIMIT` bound added at pre-landing review. The future bound keeps `windowEnd` in four-digit years; a year-9999 group summary used to 500.
   - A profile holds at most **200** live groups (`GROUP_LIMIT`), bounding the list's per-group aggregates.
   - A PATCH answers 409 on a stale If-Match before validating. A PATCH that changes nothing writes nothing.
   - A repeated identical mark writes no audit row.
   - `groupMembership` without `groupId` is 422 `GROUP_ID_REQUIRED`.
5. **Per currency only.** The summary and the list totals never sum or convert across currencies. ADR-087 #4 stands: the portal and phone convert on the client at today's ECB rate via `/v1/fx-rates`, labelled with its date. Converting at each day's rate is MUT-273, which needs its own override of ADR-087.
6. **The summary's day buckets reconcile with the total.** Series days are zero-filled. Every member dated outside the series gets a sparse `before`/`after` bucket (design review 6A).
7. **List totals reuse the filter.** They are one `groupBy(currency)` aggregate per group over the same `where` as the member list, at most 4 groups at a time (re-review D1, A2).

**Override log (client-accounting core, 2026-10-05 scope decision)**:
- **What it overrides.** That decision keeps expenses optional and outside the three client questions. Expense groups are a deliberate exception that Basel asked for on 2026-10-18.
- **What replaces it.** The exception is confined to the hosted expenses domain: no new sidebar entry (portal: a tab inside Expenses, MUT-268 1A), and no local-app surface.
- **Date:** 2026-10-18.

**Alternatives considered**:
- **Storing membership as rows (a snapshot).** Rejected: expenses logged later would not join.
- **A server-side converted total at today's rate.** Rejected: it contradicts ADR-087 #4 for a figure the client can label honestly.
- **One union scan for list totals.** Rejected: it would be a second copy of the membership logic.
- **Unbounded open groups.** Rejected: a forgotten group would grow every scan forever.

**Consequences**:
- One new pair of tables (additive migration `20261018150000_mut267_expense_groups`), eight routes, and `groupId`/`groupMembership` on `GET /v1/expenses`.
- The list makes one small aggregate per group.
- API 1.33.0-mut267.

## ADR-095: The Portal Derives Group Figures and Mark Verbs Itself; Changes Show at Once and Yield to the Next Load

**Status**: Active
**Date**: 2026-10-18
**Context**: MUT-268 (epic MUT-266) builds the portal on MUT-267's API (ADR-094). The design review (1A–23A) fixed the screens; the API returns per-currency buckets, member pages and marks, but not per-day averages, weekly bars, the action a row offers, or a converted total.

**Decision**:
1. **Derived figures live in one pure module**, `src/hosted/data/expenseGroups.ts`: status, day counts, the in-window test (from the API's `windowEnd`, never re-derived), per day, daily/weekly bars, other-currency days, category rows (Uncategorized last), the picker window, and the ≈ conversion (`rate` = units per 1 base, so divide; minor units rescaled between exponents; rounded half away from zero).
2. **The action → request table is code**, `verbFor` + `VERB_MARK` + `INVERSE_VERB`: Leave out = PUT excluded (in window), Remove = DELETE (kept, outside), Bring back = DELETE, Add = PUT included; Undo runs the inverse verb. Member rows carry no mark, so Undo of a Leave out on an in-window *kept* expense clears to no mark (TD-166).
3. **Changes show at once and yield to the next load.** A pending mark overlays the summary, members and Left out until each read *loads again after the mark settled* — TanStack's `dataUpdateCount`, not a clock, so it never counts twice or flickers back. Marks for one expense are chained so they reach the server in order (the API is last-write-wins). A batch moves every row at once, saves one at a time and refetches once.
4. **One query-key root** (`['p', id, 'expense-groups', …]`) is the whole 8A refetch set; expense writes invalidate it too. FX rates sit outside it.
5. **The ≈ line** appears only when it adds something (two or more currencies, or one that is not the profile's), is hidden while loading or on 503, and says "rate from <date>" when stale (ADR-087 #4 kept: display only, today's rate).

**Alternatives considered**:
- **A batch mark endpoint.** Rejected for v1 by design (12A/13A); revisit if bulk leave-out feels slow.
- **Time-based overlay expiry** (`dataUpdatedAt`). Rejected after the first build: equal timestamps (a fast fake API or a frozen test clock) drop or double a mark.
- **A chart library.** Rejected (18A): two small hand-built components, no dependency.

**Consequences**:
- `SectionTabs`, `DayBars`, `CategoryBars`, `GroupMembers`, `GroupDrawer`, `AddToGroupDrawer`, `InGroupsLine`, `playRowEnter` registered; `Toast` gains an action.
- No API change.

## ADR-096: An Expense's Currency Changes Only Together With Its Amount (the ADR-075 Pair Rule on Expenses)

**Status**: Active
**Date**: 2026-10-18
**Context**: MUT-272 (epic MUT-63). Numbered 096 because MUT-268, merged first, holds ADR-095. Logging an expense in the wrong currency used to mean delete and re-log, which loses the receipts, the links and the history. `PATCH /v1/expenses/{id}` said "Any field but the currency, which never changes", while conversions (ADR-075) and the Unsorted inbox already allowed a currency change with its amount. The phone's Recent edit sheet (MUT-272, phone half) and later the portal (MUT-277) need the server to accept it.

**Decision**:
1. **The pair rule.** `currency` is accepted only with `amount`. A currency alone is 422 `AMOUNT_REQUIRED` (`field: amount`), **even when it equals the stored one** (eng review R1). This is the conversion rule, so one sentence covers both.
2. **The amount is read in the merged currency's digits.** A JOD amount keeps 3 decimals; "1.234" in USD is 422 on `amount`. Nothing is rounded.
3. **A stale version is a 409 before the body's business rules run** (pre-landing review; zod schema validation still runs first, so a schema-invalid body is a 422 whatever its version). The amount is parsed in the row's current currency, which a newer version may have changed: after JOD → USD, a stale JOD-shaped "13.456" used to come back as 422 AMOUNT_INVALID instead of 409 VERSION_MISMATCH. Both `PATCH /v1/expenses/{id}` and `PATCH /v1/inbox/{id}` compare the version first, the order expense groups already use (MUT-267); the store's atomic version check still covers a write that lands after the read.
4. **Audit.** `expense.updated` adds `currency: {from, to}` and `amount: {from, to}` (formatted in each currency) when the currency actually moved, so the original amount is recoverable.
5. **The inbox keeps its own code.** `PATCH /v1/inbox/{id}` still answers `AMOUNT_INVALID` for a changed currency without an amount (eng review R2: no API change for a working route). Only its description now says so.
6. **Nothing stored needs fixing.** Summaries and expense groups (ADR-094) total per currency when read, so a moved expense simply counts under its new currency.

**Alternatives considered**:
- **Refuse only a changed currency** (the inbox's leniency). Rejected: two rules for one money question.
- **Accept a currency alone and keep the minor units.** Rejected: it silently rescales the money (ILS 120.50 → JOD 12.050).
- **Rename the inbox code to `AMOUNT_REQUIRED`.** Rejected for now: no user-visible gain, and an API change.

**Consequences**:
- `UpdateExpenseRequest` gains `currency`; `UpdateExpensePatch` gains `currency` in both stores.
- API 1.34.0-mut272.
- Clients must deploy after the server: the request schema is strict, so an older server answers 422 VALIDATION_FAILED (zod issue: unrecognized key `currency`).
- Clients send `amount`, formatted in the **new** currency's digits, whenever they send `currency`, whatever their changed-fields diff says (ILS 12.50 → USD 12.50 has equal minor units but still needs the amount).
- `AMOUNT_REQUIRED` and `SAME_CURRENCY` are now in the published 422 reasons list.

---

## ADR-097: One App — Signed Out, the Portal Runs the Server's Own Routes in the Browser over a Persisted MemoryLedgerStore (Partial Override of ADR-037 §2; Overrides MUT-185 Decision 1)

**Status**: Active (design; MUT-286..292 build it) — partial override of ADR-037 §2; overrides MUT-185's epic decision 1
**Date**: 2026-10-18
**Context**: Epic MUT-284. The free local web app (Dexie, `mutaba3a.netlify.app/app`) and the hosted portal (`src/hosted`, served by the API) are two apps, so every feature is built twice and the free app can't reach the phone. On 2026-10-18 Basel decided to retire the web app and keep one portal: signed out it works on this device, signed in it is the hosted account, and the screens are the same either way. The one difference, no phone sync, is accented as the hosted + phone upsell. Brief: `.claude/designs/mut-285-portal-local-mode.md`; plan and eng review: `.claude/designs/mut-285-local-mode-plan.md` (owner decisions D1–D3).

**Decision**:
1. **Signed out, the portal's `request()` sends each `Request` to an in-page local backend instead of `fetch`.** The backend is `createLocalApp`: the **same server route modules** (`PORTAL_ROUTES`) over `MemoryLedgerStore`, loaded as a lazy chunk. Figures match signed in and out by construction, not by a copy kept in step. The old Dexie/Transaction model is not ported.
2. **No new auth code.** The local backend seeds an ordinary person, a personal profile in the browser's timezone, and a device session in its own store, and sends `Authorization: Bearer mds_…`. The server's `authenticate()`, `requireScope` and writability matrix run unchanged. The per-request store guard (layer 3) is inactive in the browser, because it needs AsyncLocalStorage. That is safe because the only principal owns every local profile.
3. **Server changes are behaviour-preserving extractions**, landing first:
   - `createApiShell` (the error, validation and requestId shell);
   - `meRoutes` (out of `routes/sessions.ts`, whose argon2 import can't run in a browser);
   - `PORTAL_ROUTES` (one list both apps register, with a coverage test against every portal client path);
   - `MemoryLedgerStore.snapshot()/restore()`.
4. **Node APIs are substituted at build time, never edited.** The hosted build aliases `node:crypto` and `node:async_hooks` for the local chunk and installs a `Buffer` shim. A server-suite test holds the shim byte-identical to `node:crypto`/`Buffer` on every shape the routes use. No server module changes.
5. **Persistence (D1, D2).**
   - One IndexedDB snapshot `{ formatVersion, stateVersion, savedAt, maps }`, written and committed before a mutating response resolves.
   - Idempotency replay records, sessions, setup links, audit events and API keys are never persisted.
   - Ordered migrations upgrade older formats on load. A CI fingerprint of the persisted record types fails an unversioned change. An older tab that finds a newer format refuses to write.
   - Writes take a Web Lock and reload a stale snapshot first; a BroadcastChannel invalidates other tabs.
   - `navigator.storage.persist()`, plus "Download my records" and "Restore from file", protect against eviction.
6. **The app lives at the portal's origin** (MUT-185 decision 1 overridden). `mutaba3a.netlify.app` keeps the landing page and becomes the handoff bridge for existing local data (MUT-291). The web app is retired at least 90 days after the bridge ships (MUT-292).
7. **Receipts** go through the server's own receipt routes, backed by a browser `AttachmentStorage` (Blobs in IndexedDB, `local-blob:` targets). Downloads only: ADR-028's no-preview rule holds, and the CSP is unchanged. **Documents** stay Malafat uploads, so local profiles have none.
8. **One public server route (D3)**: `GET /v1/public/fx-rates`, anonymous and rate-limited per IP, returns the cached ECB snapshot. The local backend's `/v1/fx-rates` reads it through `FxRateSource`, so `crossRates` and the JOD peg run unchanged. Offline, the ≈ line hides.
9. **Modes**:
   - first visit or sign-out → local; sign-in → remote, with a localStorage hint;
   - an expired session shows a choice (Sign in / Continue on this device), never a silent switch;
   - signed in and offline shows an offline state, never local data.
10. **No telemetry signed out** (ADR-024, ADR-090, ADR-091 carried over to local mode): analytics needs a user id; Sentry stays off.

**Alternatives considered** (the brief, §16, gives one line each):
- a hand-written local backend, or extracted pure rules plus a hand-written local router;
- a local-principal middleware;
- running the backend inside the service worker (UI/backend version skew);
- porting the Dexie model;
- a Netlify origin with a proxied API;
- request-log replay instead of migrations;
- hiding the ≈ line signed out.

**Consequences**:
- `MemoryLedgerStore` is now production code for local mode. Its two known differences from Prisma (the expense filter's `unlinked`+`customerId`, receivable `createdAt`) are fixed in MUT-286 with contract cases.
- Every future `ports.ts` record change needs a local-format migration (D1). The fingerprint test enforces it.
- The ADR-037 §2 guards are rewritten, not removed:
  - ESLint portal block and `HOSTED_RULES`: `indexedDB` only in the local chunk, a service worker only for the PWA, Dexie still banned everywhere;
  - `server/src` may never import `src/`.
- Spike (2026-10-18), all within the plan's gates:
  - local chunk 135.7 KB gzip;
  - persist p95 23.6 ms at about 9.8k ledger records;
  - boot restore 40 ms;
  - summary p95 19.4 ms.

  Safari/WebKit was not verified; MUT-286 runs its QA on WebKit.

**Override log — ADR-037 §2 (partial)**: *What*: decision 2 says "no IndexedDB in the portal"; brief §2 rejects local profiles in the portal, and §7.5 says there is no service worker. *Replaced by*: local profiles in the portal when signed out, stored in IndexedDB, plus a PWA service worker (MUT-288). Hosted and local data stay separate datasets: no shared ids, no hosted row stored locally, no sync. *Why*: the owner retired the separate web app (MUT-284). Of §2's reasons against local profiles, two are answered here: the model mapping (the local mode uses the hosted model itself) and Dexie in the bundle (there is none). The third, a shared computer showing local data after sign-out, is accepted: signed-out data is this browser's data, as in the free app, and the marker says so. *Date*: 2026-10-18.

**Override log — MUT-185 decision 1**: *What*: "the local web app stays on the mutaba3a.netlify.app origin", recorded on epic MUT-185 (2026-10-14), not as an ADR. *Replaced by*: the app lives at the portal's origin, and the netlify origin keeps the landing page and the data-handoff bridge (MUT-291). *Why*: one app (MUT-284). The stranded-data risk that motivated decision 1 is handled by the bridge. *Date*: 2026-10-18.

---

## ADR-098: Gulf Currencies Come From Their USD Pegs; Every Currency the ECB Doesn't Price Must Have One

**Status**: Partially superseded by ADR-166 (MUT-388): the five Gulf currencies are removed; the peg table, USD crossing, `derived` rule and `currencies` list stay (extends ADR-087 §3)
**Date**: 2026-10-18
**Context**: MUT-280, epic MUT-278 (brief `.claude/designs/gulf-currencies.md`, approved by Basel 2026-10-18; plan `.claude/designs/mut-280-gulf-currencies-server.md`). People who bill in the Gulf couldn't record AED, SAR, QAR, BHD or OMR. Basel kept Frankfurter (ECB) as the only rate provider and left KWD out (its rate follows an undisclosed basket, so there is no fixed USD rate). Numbered 098 because the unmerged MUT-285 branch already wrote ADR-097.

**Decision**:
1. **Five more currencies.** `SUPPORTED_CURRENCIES` appends AED, SAR, QAR (2 decimals) and BHD, OMR (3 decimals), so existing positions (the OpenAPI enum, `/v1/fx-rates` row order) never move. No migration: every currency column is `VarChar(3)` with no check.
2. **One peg table.** `USD_PEGS` (`server/src/fx-rates.ts`) replaces `JOD_PER_USD`: JOD 0.709, AED 3.6725, SAR 3.75, QAR 3.64, BHD 0.376, OMR 0.3845, each set by its central bank. It is typed `Record<PeggedCurrency, number>`, where `PeggedCurrency` is every supported currency the ECB fetch doesn't price, so a new code with no rate source fails typecheck. A re-peg is a deploy (ADR-087 §3).
3. **Every pair goes through USD.** `rate(base → c) = perUsd[c] / perUsd[base]`. The ECB fetch is unchanged (`base=EUR&symbols=USD,ILS`, the raw figures). Existing ILS/USD/EUR/JOD rates are identical to before (pinned tests unchanged).
4. **`derived` = either side pegged, never base→base.** AED↔JOD has no ECB figure in it and is still derived. Clients show "(USD peg)" on derived rates.
5. **No peg-only rates without the provider.** With nothing servable cached, every base is 503 `FX_RATES_UNAVAILABLE`, pegged ones included: one source of truth for "rates are available".
6. **The server lists its currencies.** `currencies: string[]` (each `^[A-Z]{3}$`, required) on `GET /v1/me`, `POST /v1/sessions` and `POST /v1/device-sessions`, equal to `SUPPORTED_CURRENCIES`. It is a plain string list, not the `Currency` enum, so a client built from today's spec never rejects a code a newer server adds (eng review D3). The phone offers only codes in this list (MUT-279 D4); servers older than MUT-280 omit it.
7. **Peg parity.** `docs/fx/pegs.json` mirrors `USD_PEGS`; a server test checks it both ways, and the web (MUT-282/283) reads it. `server-ci.yml` watches `docs/fx/**`.
8. **Analytics contract 1.2.0** (Basel D10): `docs/analytics/events.json` currencies equal the server list (the taxonomy test pins them), so the bump lands with this change.

**Alternatives rejected**:
- KWD from a second, keyed provider: a second source of truth and its own failure modes (epic D1).
- Fetching `base=USD` from Frankfurter: it divides and rounds before we see the ECB figures.
- Serving pegged↔pegged rates while the provider is down: two meanings of "rates are available".
- `currencies` typed as the `Currency` enum: closes the set in the spec (D3).

**Consequences**:
- API 1.35.0-mut280.
- **The portal's typed client (`src/hosted/api/schema.d.ts`) is not regenerated here** (eng review D2): regenerating it gives 15 portal type errors, because the portal reuses the local app's 4-currency type and exponent table. MUT-281 regenerates it first (TD-170).
- **Release order:** the phone with tolerant parsing (MUT-279) is released and adopted first. Then this change and MUT-281 go out in **one** `make release server`: the portal ships inside the API image, and a portal older than MUT-281 would render AED amounts as NaN.
- The Malafat project import (`import/plan.ts`) accepts the five codes too; KWD and other unknown codes stay `UNSUPPORTED_CURRENCY`.

---

## ADR-099: Firm Books — Firms Are Flagged Organizations With Roles, Approval, Bills and a Month Lock; Receipts Are Read on the Device (Partial Overrides of ADR-037 Decision 1 and Its MUT-182 Amendment, MUT-252 Decision 5, Minimize-to-Core Decision 3)

**Status**: Active (design). MUT-300..314 build it. Basel approved the brief as written, including the design defaults DR1–DR14, on 2026-10-19.
**Date**: 2026-10-19
**Context**: Epic MUT-298. Basel turned "receipts sharing via PDF/OCR + a mini accounting ledger for small firms" into six versions over Nov 2026 – Apr 2027 (intake decisions ID1–ID9). Small firms (law and accounting offices, agencies) are the paying audience; freelancers stay on the lean core. Brief: `.claude/designs/firm-books.md`. Plan, eng review (D1–D15) and design review (DR1–DR14): `.claude/designs/mut-299-firm-books-plan.md`. Tests: `.claude/designs/firm-books-tests.md`.

**Decision**:
1. **A firm is an organization with `firmEnabledAt` set,** enabled by an operator (ID3). The owner asks for it from the portal (MUT-300).
   - Firm features never key off `ProfileType`.
   - ~~An owned Business profile becomes a firm only through an operator **conversion** (B1).~~ **Amended by MUT-300 (D4, see the amendment below):** the operator turns firm features on **in place**; the profile stays owned and its owner is OWNER. The built-in personal profile never gets them.
   - Enabling an operator firm names at least one owner; other existing members become BOOKKEEPER (D4).
2. **Roles fold into the one permissions derivation (D1).**
   - `Membership.role` is `OWNER | BOOKKEEPER | SUBMITTER`, and is inert while the flag is off.
   - `sessionScopesFor(writer, role)` drives `requireScope`, the store guard and `/v1/me` access alike.
   - The firm role matrix in the brief (between `firm-role-matrix` markers, drift-tested) covers **every session domain** (D6). A submitter creates expenses and receipts, edits their own unapproved rows, reads tagging data, and has none on client money or money summaries.
   - New action scopes: `expenses:approve`, `close:write`, `members:write`. The submitter's own-row rule is a repository check (O7).
   - The last owner can't be removed or demoted. A refused role gets the new code `ROLE_NOT_PERMITTED`.
3. **Approval** (ID7) is a per-firm setting, off by default.
   - `initialApprovalFor(role, firm)` sets the state on all four expense-creation paths.
   - Every money total filters `APPROVED`; lists show every state.
   - A rejected expense can be resubmitted (DR9).
4. **Bills mirror receivables (ID9, B5).**
   - A VENDOR bill's payment posts a read-only linked expense (D7).
   - The bill itself never counts as spend.
   - A STAFF bill's payment posts nothing.
   - One receipt files to one record: a DB CHECK on `expenseId`/`billId` (D8).
5. **VAT on expenses and bills** mirrors the receivable columns, and null means "No VAT recorded".
   - The VAT summary uses the **invoice basis**: bills by issue date, plus approved expenses not posted by a bill.
   - A bill's VAT is split across its payments by largest remainder (D9).
6. **Month close is a watermark, `Organization.closedThroughMonth` (B6).**
   - A closed month refuses creates, edits, deletes and decisions on expenses, bills, bill payments, receipt approvals and inbox filing, with the new code `PERIOD_CLOSED`. A PATCH checks the old and new dates.
   - **Corrections need an owner reopen** (reason, audited). There are no negative adjusting expenses (D2; TODOS.md #16 is the upgrade path).
   - The check runs behind the repository port, inside the write transaction, under `FOR SHARE` on the organization row; close and reopen update that row (D5, O2).
   - Close is blocked while the month has pending expenses (DR10).
   - Income, payments, receivables and conversions are not locked, so packs never say "final" (D11).
7. **Invites (MUT-306).**
   - An INVITE token is bound to the email, and **the link is mailed only to that address** (D10). The owner gets the same response for every email (D3).
   - The User row is created on redemption. The membership is pending until accepted.
   - SETUP and RESET are never minted on an existing account through an invite.
   - An outbound email provider behind a `Mailer` port (EU region) is required in v3. MUT-306 picks the vendor against the brief's criteria (D14).
8. **Receipts are read on the device** (ID4): PDF text layer, ZATCA QR, photo OCR (phone, and the portal as WASM). There is no server or LLM reading. *Amended 2026-10-26 by ADR-199: the server may re-read a stored original with self-hosted OCR to fill fields the device left empty; still no LLM.*
   - One `ReceiptSuggestion` contract is shared by phone and portal.
   - The extraction rules are ported to TS and tested against shared fixtures.
   - JoFotara QR decoding waits for the official ISTD guide (its layout is unconfirmed).
9. **The copy reads e-invoices and never issues them** (ID5). A phrase-level guard bans compliance claims in firm strings; MUT-315 researches issuing.
10. **Sequencing**: the brief locks the cross-cutting rules plus full v1 contracts; later children write their own contracts against it (D12). A named pilot firm uses v1–v2 for two weeks before v3–v5 are planned (D13).
11. **Local mode**: firm features never appear signed out. The ticket that lands second (MUT-284 or the firm ticket) carries the snapshot migration; MUT-305 adds a Membership fingerprint.

**Consequences**:
- Firms get roles, approval, payables, VAT and a monthly close without a general ledger. Money can't be counted twice by construction (D7, D8, D9), and a closed month can't gain rows (D5).
- There are two new error codes, `ROLE_NOT_PERMITTED` (403) and `PERIOD_CLOSED` (409), plus `CONFLICT` reasons `LAST_OWNER`, `POSTED_BY_BILL`, `RECEIPT_ALREADY_FILED` and `PENDING_EXPENSES`. Malafat's error mapping must learn them.
- Every firm expense write becomes transactional and takes a shared row lock.
- v3 needs an email provider, DNS records and bounce handling.
- A reopened month's reports can change after the accountant saw them. The audit trail records why.

**Alternatives Considered**:
- Lifting MUT-182's "owned is never shared" rule (rejected: two kinds of shared organization).
- A separate role middleware (rejected: a second source of truth).
- Negative adjusting expenses (deferred: TODOS.md #16).
- A copyable invite link (rejected: owners could claim accounts in others' names).
- Counting VAT on bills and on posted expenses (rejected: double count).
- A double-entry general ledger (rejected, ID9).
- Cloud or LLM receipt reading (rejected, ID4).

**Override log — minimize-to-core decision 3 (partial)**: *What*: "expenses are optional, not core" (MUT-1 intake, 2026-10-05). *Replaced by*: on firm profiles, expenses, vendors and bills are core; personal and freelancer profiles are unchanged. *Why*: firms are the paying audience (MUT-298). *Date*: 2026-10-19.

**Override log — MUT-252 decision 5 (partial)**: *What*: "the portal does not auto-read receipts in v1". *Replaced by*: on firm profiles the portal reads PDF text, QR codes and photos on the user's device (MUT-301, MUT-304). *Why*: firms upload receipts from desktops; reading stays on the device, so MUT-252's privacy rule holds. *Date*: 2026-10-19.

**Override log — ADR-037 decision 1 (partial)**: *What*: "no signup, invite or password-reset route". *Replaced by*: a firm owner may invite by email (MUT-306), the link reaching only the invitee, who accepts as that email. Public signup is still absent, and `no-self-registration.test.ts` is updated deliberately. *Why*: firms need to add their own staff. *Date*: 2026-10-19.

**Override log — ADR-037, MUT-182 amendment (partial)**: *What*: "an owned profile is … never granted to or provisioned into another user". *Replaced by*: an operator may convert an owned Business profile into a firm, after which it follows firm rules. Unconverted owned profiles are unchanged. *Why*: a freelancer's business grows into a firm without starting a new profile. *Date*: 2026-10-19. **Withdrawn 2026-10-20 by the MUT-300 amendment (D4):** v1–v2 neither convert nor share an owned profile, so the MUT-182 rule stands unchanged; v3 decides sharing after the pilot.

**Override log — MUT-298 intake decision 6 (partial)**: *What*: "the invite always yields a copyable setup link". *Replaced by*: the link goes only to the invited email; the owner never sees it (D10). *Why*: an owner holding the link could set a password on someone else's account and probe which emails exist (outside voice O5). *Date*: 2026-10-19.

**MUT-300 amendment (2026-10-20; MUT-300 eng review D1–D6, Basel, 2026-10-19; built on `feature/mut-300-firm-flag`)**:
- **D4, firm features in place (reverses B1 and decision 1's conversion bullet).** The operator sets `firmEnabledAt` on an owned Business profile without touching `ownerUserId` or `profileType`; the owner's membership becomes OWNER. Conversion would have removed income capture, settle and redate from the first pilot owner, since all three key on `owned` (outside voice O1). No convert route; CHECK `organizations_firm_not_personal_check` (`firmEnabledAt IS NULL OR personalOwnerUserId IS NULL`) replaces the planned `firm_not_owned_check`. Sharing an owned firm profile with staff is a **v3 decision after the pilot** (MUT-305/306). The ADR-037 MUT-182 override above is withdrawn.
- **D6, decline.** `DELETE /admin/v1/organizations/{id}/firm-request` (CLI `firm-decline`) clears a pending request, audited `firm.request_declined`; the owner may ask again.
- **D3, operator grants.** No role parameter: a new member of a firm is BOOKKEEPER, OWNER elsewhere (inert). SUBMITTER and extra owners come with MUT-306 invites and MUT-305 role changes.
- **D5, one meaning for "firm".** "Firm" now means "firm features are on". The portal's read-only reason `'FIRM'` became `'OPERATOR'` and its key `hosted.profiles.readOnly.operator` (same text); API docs and the 403 message no longer call a non-owned profile "a firm".
- **C1, the role column lands in MUT-300.** `Membership.role` (`OWNER` default, inert until the flag is on, O10) is written by enable; MUT-305 adds enforcement only.
- **C2/C4, request refusals.** 403 `READ_ONLY_PROFILE {reason: NOT_OWNER}` through the shared `ownedBy` helper (not a 409), and 409 `NOT_BUSINESS` for an owned profile typed PERSONAL; `ALREADY_FIRM` is reachable again under D4.
- **C5, admin conventions.** The admin PATCH and decline take no If-Match or Idempotency-Key: same state is a no-op 200, like every admin route.
- **C6/C7, `/v1/me`.** Profiles gain `firm`, `role` and `firmRequestedAt` (owner only) in API `1.41.0-mut300` (built as 1.37.0, renumbered at the merge after main reached 1.40.0-mut325). The v1 banner copy names no Members page until MUT-306 ships one. The firm block (`enabledAt`, `requestedAt`, `requestedByUserId`) is on `AdminOrganization` only: API-key routes keep the plain `Organization`, because the block names a portal user. That was found at the merge review, where `/v1/integration` had carried it.
- **O3.** A request doesn't bump the profile's `version`, so the owner's open edit form keeps its If-Match.
- **Records export by firm members.** ADR-156 lets any member export a profile. A firm BOOKKEEPER can be created today (`firm-enable` + `grant`), so gating the export by role belongs to MUT-305 (Jira comment 12253), not to this ticket. Roles stay inert until then.
- **Local mode (merge with MUT-286/287/325, 2026-10-20).** A device has no operator: its profiles always have firm features off and nothing requested, and its one person's memberships are all OWNER. The local snapshot format went 1 → 2 with a migration that writes exactly that, the signed-in export writes the same, and the portal hides the firm request signed out.

---

## ADR-100: How the Portal Chooses Local or Remote, and Where the Local Backend Shows (MUT-286 Phase C; Amends ADR-097 §9)

**Status**: Active (amends ADR-097 §9 and the brief's "first visit / no hint → LOCAL", `.claude/designs/mut-285-portal-local-mode.md` §2.6)
**Date**: 2026-10-19
**Context**: MUT-286 Phase C wires ADR-097's local backend into the portal. Three things the brief left open or got wrong surfaced while building it. First, a person signed in before this release has a live cookie but no mode hint, so "no hint → local" would show them an empty device app instead of their account. Second, the portal has no Settings page for "Settings › Your data". Third, the portal's TypeScript program can't type-check the server's route modules (`erasableSyntaxOnly`, zod route generics). Numbered 100 because MUT-299's plan reserves 099.

**Decision**:
1. **Mode hint + one check (`src/hosted/session/mode.ts`, `client.ts send()`).** `mut-mode` in localStorage (`local` | `remote`), wrapped in try/catch. With no hint, the portal asks the server once, `GET /v1/me`: a 200 saves `remote` (a session from before local mode keeps its account), and a 401 saves `local`. Any other answer, or no answer (offline, 5xx), saves nothing and uses the server for that request, so an outage never strands a signed-in person in an empty local app. The check is the one `/v1` request a signed-out person ever makes; everything after it runs in the page (AC4 test: `local/__tests__/no-network.test.ts`). Sign-in and setup set `remote`; sign-out and "Continue on this device" set `local`. `/v1/sessions*` and `/v1/account-setup*` always go to the server.
2. **The session-expired choice is the sign-in page.** It gains "Continue on this device" under its existing "You've been signed out" note, so an expired session offers both doors and never switches by itself. There is no separate SessionExpired screen. Signed out, `/sign-in` skips its "already signed in?" check, which would otherwise find the local person and bounce straight back into the app.
3. **Your data is an account-menu drawer** (`?yourData=true`, `YourDataDrawer`), beside Change password, in local mode only. Restore confirms the record count, replaces everything, and lands on the restored person's first profile.
4. **The lazy chunk is reached through the alias `@mut/local-backend`.** For types, `tsconfig.hosted.json` maps it to `session/localBackendContract.ts`. For code, `vite.config.ts` (hosted) and `vitest.config.ts` map it to `local/index.ts`, which implements that contract and is checked under `tsconfig.hosted-local.json`. ESLint forbids a static import of the alias and any `server/src` import outside `src/hosted/local`, which itself may import only `LOCAL_SERVER_ALLOWLIST`. The server's ESLint forbids importing the app's `src/`.
5. **Signed out, account-only and phone-only UI hides:** sign out, change password, Malafat suggestions (AC5), the usage switch and prompt (no telemetry), the "Hosted" chip and old local-app note, and the store links (the phone can't see this device's records, MUT-186 9A). Expenses and Conversions were hidden from the nav until MUT-287 brought receipts and FX; since MUT-287 (decision 11) the nav is the same in both modes.
6. **Bundle guard:** `indexedDB` is no longer banned in all of `dist-hosted`. It is banned in every file the entry loads statically (`localBackendInEntryGraph`), which proves both that only the lazy local chunk opens IndexedDB and that signed-in pages never download it. Measured 112.7 KB gzip (115.7 KB with MUT-287; jszip is its own lazy chunk, 30.1 KB).
7. **Local route failures go to the browser console** (`consoleLogger`); signed out there is no Sentry or server log.
8. **The client picker adds clients** (Basel, 2026-10-19, resolving TD-172): a typed name no client has gets "Add client: «name»" on a profile the person owns (`canAddClient`), in both modes, so a signed-out person can record money owed. It is the portal's 50th API call (`POST /v1/customers`, already in `PORTAL_ROUTES`).
9. **Pre-landing review fixes** (Basel approved all, 2026-10-19):
   - **Another tab's mode change** (it signed in, or continued on this device) clears this tab's cache and reopens it at `/`, so account and device data never share a screen (`onModeChangedElsewhere`). A tab on sign-in or setup is left alone.
   - **Stop states.** A save the browser refuses (`LOCAL_SAVE_FAILED`) or another tab's newer format (`LOCAL_FORMAT_TOO_NEW`) stops the page: every later request rejects, and the root layout shows "reload to continue" in place of the route. A reload rebuilds memory from disk, so a write that never reached disk can't replay as saved. Restore saves to disk before switching memory.
   - **`LOCAL_UNAVAILABLE`.** A local backend that can't run (storage blocked) gets its own screen with Try again and Sign in, never "Can't reach Mutaba3a".
   - **Download** takes the lock and reloads first if another tab wrote, so the file holds every save on this device.
   - **The minted session is never older than the person**, so a clock that moved back can't lock them out.
   - **The bundle guard** allows IndexedDB only in the chunk that opens `mut-local` (`indexedDbOutsideLocalBackend`).
10. **The matter picker adds matters** (MUT-318, Basel, 2026-10-19; brief `.claude/designs/mut-318-add-matter.md`): a typed name the chosen client has no matter for gets "Add matter: «name»", gated by the same `canAddClient(profile)` (`projects` is profile-dependent exactly like `customers` in `writability.ts`), in both modes; the 51st portal call (`POST /v1/projects`, already in `PORTAL_ROUTES`). A matter needs a client: with none chosen there is no Add row and a hint says why. A new matter opens in the drawer's currency. The portal reuses the local app's client ↔ matter cascade (moved to `src/lib/forms/`), so a picked matter fills its client and a client change empties a matter of another client. Picker inputs are never disabled while a pick saves (read-only, so focus and Enter-held submit survive); the list stays shut meanwhile, so no second pick can race the first. Reconcile (Basel, 2026-10-19): **D1** a hosted drawer holds Save while a picker's Add is in flight (`usePendingPicks`); **D2** a CURRENCY_MISMATCH (Malafat capture vs its matter) is said under Matter, and the expense drawer's USD default is MUT-319, not this ticket.

11. **Expenses, receipts, FX and documents signed out** (MUT-287, Basel, 2026-10-19; plan + eng review `.claude/designs/mut-287-local-expenses-plan.md`, answers D1–D4):
    - **Public FX snapshot:** `GET /v1/public/fx-rates` returns the cached ECB snapshot itself (not cross rates), anonymous, 120/min per address (shared mobile and office addresses; review D8), outside `PORTAL_ROUTES`, its limiter built in `index.ts` and pruned each minute (review D1). The local backend's `PublicFxRateSource` feeds the server's own `CachedFxRates`, so `crossRates`, the JOD peg and the age rules run unchanged, and relays the server's `source`/`fetchedAt` (`EcbSnapshot.upstream`), so stale rates read as stale signed out too (review D7, TD-178 resolved). It is the one request signed-out mode sends after the first-visit check, only while a group's ≈ line asks; the page warms its rate cache before taking the cross-tab lock, so a slow network never holds up a save (review D2), and the last snapshot is remembered in localStorage (`mut-local-fx`) for an hour across page loads (review D8).
    - **Receipt files live in their own database** (D2): `mut-local-blobs`, never a store inside `mut-local`, because `mut-local` already holds MUT-286 data on devices (tag api-v0.3.14) and upgrading it would let an old open tab hang a new one. Files are `{ type, bytes }` (ArrayBuffer), never base64 and never in the snapshot, with a `{ type, size }` record beside each so a size check never loads the bytes (review D11). Routes sign `local-blob:<key>`; the portal's upload and download branch on it.
    - **Two databases, crash-safe by order:** a receipt file is deleted only after its request's snapshot saved (removals staged, flushed inside the same lock); Restore adds the backup's files, saves the records, then sweeps files no live record names (a refused save sweeps the added files back out); boot sweeps too. Live means READY receipts, documents, and a pending upload only while its 15-minute link is valid (review D6).
    - **The records file is a zip** (D3): `records.json` + `receipts/<key>` (READY files only, STOREd); jszip by dynamic import only on Download/Restore; the files are copied under the lock and zipped after it (review D3). A MUT-286 `.json`, or a zip re-made from the folder Safari extracted it into, still restores. The confirm names how many receipt files the file can't supply before anything is replaced (review D4). Receipt files unpack only on Replace and must pass the upload rules (receipt type, <= 10 MB, the declared size; review D5). Held in memory whole (TD-179).
    - **Fingerprint every map** (D4): all 27 `LocalSnapshotMaps` keys, union of field kinds across a fixture filled through the store's own repositories, every nullable field set once (review D10); TD-171 resolved.
    - **Both local databases step aside for upgrades** (review D12): `LocalDatabase` (`local/idb.ts`) closes this tab's connection when a newer build upgrades it (later use → `LocalDatabaseSupersededError` → the reload screen) and rejects a blocked upgrade instead of hanging.
    - **`Buffer` is bound per module, never global:** `scopeServerBufferShim` (vite, hosted) appends `import { bufferShim as Buffer }` to `server/src` modules that use it (imports hoist, so source maps stay exact). A global partial `Buffer` made jszip take its Node path and break; no third-party library should see a stand-in. Amends ADR-097 §2.4 ("installs a Buffer shim before the backend loads").

**Consequences**: Existing release-QA portal specs model a browser that has used an account (`openSignedInPortal` sets `mut-mode=remote` when absent); `qa/specs/portal/local-mode.spec.ts` covers the signed-out side. The portal's client list now grows from the picker (decision 8 below).

---

## ADR-101: Direction Comes From `<html dir>` and the `dir` Attribute Only; a Locale-Formatted Amount Is a Plain `<bdi>` (MUT-109)

**Status**: Active (amends MUT-110's note that a standalone amount uses `<bdi dir="ltr">`)
**Date**: 2026-10-19
**Context**: TD-048's direction half. `theme.css` set `direction` on every `:lang(ar)` and `:lang(en)` element. An author rule beats the `dir` attribute, so every `dir="ltr"` was ignored in Arabic and every `dir="rtl"`/`"auto"` in English. Five CSS files out-ranked `:lang(ar)` to get LTR back. MUT-79 scoped the rule to the root and reverted, because three amount spans flipped: their `dir="ltr"` started working. Brief `.claude/designs/mut-109-rtl-direction.md`, approved by Basel 2026-10-19 with D1–D4.

**Decision**:
1. **No CSS rule sets `direction` on a `:lang()` selector** (both languages, D1). `I18nProvider` sets `<html lang dir>`; direction is inherited.
2. **A locale-formatted amount is a plain `<bdi>`** (`dir=auto`). The Arabic `Intl` currency string starts with RLM, so it resolves right to left, which is the order those amounts already had on screen (`$US 1,300`, `₪ 1,500.00`). This was measured in Chromium before the change.
3. **`dir="ltr"` means content that reads left to right in any language**: emails, passwords, dates, version, invoice and payment numbers, the FX formula, amount inputs and their currency groups.
4. **Expenses' two amounts that were LTR through CSS** (`CurrencyAmounts`, `RecurringAttentionList`) keep `dir="ltr"`, and their CSS workaround goes (D2: zero visible change).
5. **A `dir="ltr"` input or select in the Arabic UI keeps its text on the right** (`:where([dir="rtl"]) :is(input, select)[dir="ltr"]`, 0,1,1, under the income and payment drawers' left-aligned groups), so only the typing order changes (D3).
6. **Every `dir` site is classified** in `src/styles/__tests__/direction.test.ts` (45 on 2026-10-19), and a new one fails until classified.

**Consequences**: The `dir` attribute is the single source of truth, and new LTR content needs no CSS. Arabic before/after on preview builds showed 0 changed pixels on the ticket's eight screens. English `dir="rtl"`/`"auto"` now work: the Arabic business-name input is RTL in the English UI, and a user-typed name takes its own direction. The app still shows two amount orders: standalone (RTL, point 2) and in-sentence (LRI, MUT-110). Picking one is a product follow-up, not this ADR.

## ADR-102: Terms of Service Are Frozen, Versioned Texts; Acceptance Is Recorded at Setup and Re-asked on the Portal (MUT-324)

**Status**: Active (amends ADR-088: a setup-link redeem also records the terms the person accepted; addendum 2026-10-20, MUT-348)
**Date**: 2026-10-19
**Context**: The pilot (epic MUT-322) needs terms of service that a paying person accepts. The terms text ships with the landing page (Netlify, web build) and the version people must accept ships with the API image, two separate deploys. Accounts are operator-issued, so everyone passes a setup link once. Accounts that already have passwords never pass one again. Plan `.claude/designs/mut-324-terms-plan.md` §0 records Basel's answers D1–D12 (2026-10-19).

**Decision**:
1. **Each terms version is a frozen file per language**, `src/content/legal/terms/<YYYY-MM-DD>.<en|ar>.json`. A released file is never edited; a new text is a new version.
   - `/terms` shows the latest; `/terms/<version>` shows that version forever.
   - The English text prevails over the Arabic (D4, the terms say so). The governing law is England & Wales; the contracting party is Barmajiyat Ltd.
2. **The server owns which version people accept**: `server/src/legal.ts` `CURRENT_TERMS`, with the sha256 of the EN and AR files. `scripts/__tests__/legal-terms.test.ts` pins it to the files and to the landing's latest version.
3. **An acceptance is a row**: `terms_acceptances (userId, version, locale, textSha256, surface portal|phone, acceptedAt)`, unique on (userId, version).
   - It is written idempotently: an operator reset after acceptance still works.
   - It **cascades with the person** (D3, the schema's one cascade). Closing an account (MUT-333) removes the record of its agreement.
4. **"Accepted" means the latest accepted version is ≥ the current one** (D10, ISO-date string order). An API rollback, or two revisions answering side by side, never asks again.
5. **Acceptance happens in two places**:
   - The setup redeem requires `acceptedTermsVersion` equal to the current version. The check comes after the link-state check and before hashing; the answer is 409 `TERMS_VERSION_STALE` with `details.current`. The acceptance is recorded in the redeem's transaction.
   - `POST /v1/me/terms-acceptance` (cookie or device session, organization-independent) covers people who are behind. `Me.terms {version, accepted}` drives the portal's Updated-terms step. That step offers a way out (D6): sign out, or write to support to take your records or close the account.
6. **Each person accepts for themselves and, as owner, for the profiles they own** (D2). `user.terms_accepted` is audited on owned profiles only, never on a firm the person is merely a member of.
7. **Only the portal enforces acceptance** (D7). The server does not refuse writes, so installed phone builds keep working (TD-180). The phone's link and update step are MUT-344.
8. **Web first, checked at release** (D11). The web build emits `/legal/terms-versions.json` (version + sha256 per language). The server release refuses a server whose `CURRENT_TERMS` the public site doesn't list with the same fingerprints. Netlify answers every path with the app shell, so a page fetch can't prove the version is live.
   - **Where it runs** (review fix 3, 2026-10-19): `scripts/preflight.sh server` runs `terms:check-live`, so `make release server` refuses before the version bump, commit and push. `server/scripts/deploy.sh` checks again every time (one fetch), so nothing a caller passes can turn the guard off. Only `SKIP_TERMS_CHECK=1` skips it; `SKIP_REMOTE=1` does not (review pass 2). A failure names the HTTP status or the fetch error; only a reachable manifest that lacks the version says "release web first".
9. **The signed-out portal has no terms.** `PortalRouteDependencies.terms` is null, `Me.terms` is null and nothing asks. Acceptances are kept out of `MemoryLedgerStore.snapshot()`, so the shipped local format is unchanged.

**Consequences**:
- Every acceptance can be tied to the exact words accepted, in the language read.
- Bumping the terms means three steps: add the new files and update `CURRENT_TERMS` and its hashes (the pin test fails until they match); release web; then release the server.
- `npm --prefix server run terms:report` (GET /admin/v1/terms-acceptance) lists who is behind, which covers phone-only users until MUT-344 ships.

**Override log (2026-10-19, MUT-324 review fix 2)**: this ADR overrides **ADR-043's 2026-10-12 addendum** ("`make release full` runs `release-server` then `release-web` … server first"). `make release full` is now `release-web release-server`.
- **Why:** server first could never pass decision 8: the server leg refused whenever the terms changed, and web never ran. The server-first reason (the API is live before the frontend that calls it) no longer holds for this split: the portal ships inside the server image, and the web build (landing + local web app) calls no API a server release adds.
- **What replaces it:** web, then server. After a terms bump Netlify must finish building before the server preflight passes, so the server half refuses cleanly (before its bump) and is rerun once the build is live.
- Decided by Basel through the review's must-fix list.

**Addendum (2026-10-20, MUT-348): how strong the acceptance evidence must be.** MUT-324's first review pass left two questions open. Basel decided both on 2026-10-20 (MUT-348 comment 12222).
1. **The evidence is the frozen file plus the release that rendered it.** `textSha256` fingerprints the JSON content file, not the page `TermsPage` builds from it.
   - That's enough: the frozen `/terms/<version>` file, plus the `TermsPage` code at the release that rendered it, show what the person read.
   - Each acceptance should record that release, so it maps to a git tag. Nothing stores it today. **MUT-354** adds a nullable `clientRelease` column to `terms_acceptances`, written per acceptance.
   - Until MUT-354 ships, an acceptance maps to a release only through its `acceptedAt` and the release history. Rows written before it keep `clientRelease` null.
   - We won't hash the rendered text or keep HTML snapshots.
2. **Firm-only members need nothing more for now.** A person who owns no profile gets no `user.terms_accepted` audit row (decision 6). Their `terms_acceptances` row is the only evidence, and it's deleted with the account (decision 3). That matches the published promise.
   - Such a person can't exist during the pilot: every pilot user is an owner (MUT-322), and staff invites only come with firm-v3 roles (MUT-305/306).
   - **MUT-305/306 must revisit this** before the first member who owns no profile is invited, for example with an audit row on the firm or an operator log.
   - No code now.

## ADR-152: Icon Save-Feedback Animation Reuses `motion` and Mirrors Flutter's `MMotion` Curves Byte-for-Byte — No New Runtime

**Status**: Active
**Date**: 2026-10-19
**Context**: MUT-337 (epic MUT-334). The MUT-335 icon set is drawn multi-part specifically so an animation runtime can target one part independently, with a playful preset for personal accounts and a restrained one for firms; MUT-338/339/340 are blocked on this decision. The ticket named Rive as a candidate to evaluate. Two prior decisions already bounded the answer: ADR-044 (MUT-80/82) put this app's motion on the `motion` package (no `lottie-web`, no `gsap`); ADR-079/080 (MUT-203/206) rejected the `lottie-web` *runtime* specifically because the portal CSP (`default-src 'self'`, no `unsafe-inline`) blocks the inline `<style>`/shadow-root markup it needs — not animation in general. The MUT-335 inventory doc's own style sheet already named the mechanism: "their playful/restrained distinction is carried entirely by easing curve and transform… reusing Flutter's existing `MMotion.overshoot` for playful, `MMotion.spring` for restrained." `MMotion` is real, shipping Dart (`mutaba3a/lib/presentation/theme/mutaba3a_theme.dart:74-76`): `spring = Cubic(0.32, 0.72, 0, 1)`, `overshoot = Cubic(0.34, 1.56, 0.64, 1)` — cubic-bezier control points, portable byte-for-byte to CSS/`motion`'s `ease` array/Flutter's `Cubic`. Brief and comparison: `.claude/designs/mut-337-icon-animation-runtime.md`.

**Decision**:
1. **One transform, two curves, not two engines.** `src/lib/motion/iconMotion.ts`'s `playIconFeedback(targets, { preset, reducedMotion })` plays a single scale(0→1) `motionValue` through `ICON_OVERSHOOT_EASE` (playful) or `ICON_RESTRAINED_EASE` (restrained) — the exact same four numbers as `MMotion.overshoot`/`.spring`. The overshoot curve's y > 1 midpoint is what produces the "playful" bounce; the restrained curve stays within [0,1].
2. **Rejected: Rive.** Same shape of reason as ADR-079's `lottie-web` rejection — a new runtime (`rive-react`/`@rive-app/canvas` web, `rive` Flutter package) plus a `.riv` binary asset pipeline, to buy state-machine capability this requirement (swap one of two known curves on a transform) doesn't need. Its WASM runtime would also need a new CSP grant (`'wasm-unsafe-eval'`) `PORTAL_CSP` doesn't have today.
3. **Rejected: CSS keyframes via toggled class.** CSP-clean and viable, but loses interruptibility — a re-trigger before settle restarts from the keyframe's 0%, not the element's live position, unless hand-rolled with FLIP (not built anywhere in this app). `motion`'s `motionValue`/`animate()` already gives this for free (same mechanism `rowEnter`/`rowExit` use) and `playIconFeedback` proves it: a re-trigger `stop()`s the prior play and restarts from its live value.
4. **Caller passes explicit target elements**, never an icon name the function resolves internally — keeps the function decoupled from any one icon's `data-part` vocabulary (MUT-336's codegen already emits `data-part`, not `id`, for exactly this kind of external targeting).
5. **Reduced motion jumps straight to the end state** (scale 1, no overshoot) on either preset, same fallback shape as `REDUCED_MOTION_FADE_SECONDS`/`captureExitSnapshot`.
6. **Scope boundary**: this ticket proves the mechanism (headless, unit-tested — `iconMotion.test.ts` asserts the playful preset's live value genuinely exceeds 1 mid-flight, not just which constant was passed) and records the decision. Wiring it into a real save trigger, in either app, is MUT-338's job — no new UI ships from MUT-337.

**Consequences**:
- No new dependency on either platform; the duration (0.4s, shared by both presets — only the curve differs) is this prototype's placeholder, not yet a Brand v2-reviewed number; MUT-338 may tune it.
- A future change to either platform's curve numbers needs a matching change on the other side — nothing enforces this automatically yet (no parity test exists across the two repos the way `bloomLoaderData.ts`'s does against its Lottie JSON); flagged as a follow-up, not blocking this ticket.
- The Flutter half (`AnimationController` + `CurvedAnimation(curve: MMotion.overshoot | .spring)`) is not built in mini-crm; needs its own mutaba3a-flutter worktree.

---

## ADR-153: GitHub CI Runs Only by Hand; `make release` Reminds the Operator

**Status**: Active (amends MUT-24 §C D2 and TD-019's push/PR triggers for web-ci, server-ci and contracts-ci)
**Date**: 2026-10-20
**Context**: CI on main had been red since 2026-10-19 (MUT-286 made the web typecheck, tests and portal build need `server/node_modules`, which the workflows never installed). Every release push started a run nobody was waiting on. Releases are operator-run from `make release`, where the local gates already run.
**Decision**:
1. `web-ci.yml`, `server-ci.yml` and `contracts-ci.yml` trigger on `workflow_dispatch` only. Run them with `make ci [web|server|contracts|all]`, from the Actions tab, or `gh workflow run <file> --ref main`.
2. `make release web` / `make release server` call `scripts/ci-reminder.sh` just before the deploy confirmation. It prints the last run of that target's workflow on the release branch (result, commit, how far behind HEAD) and the command to start one. It is a reminder, never a gate: it exits 0 when gh is missing, signed out or offline (`SKIP_REMOTE=1`). After a successful push the target prints one more line: run `make ci <target>` on what was just pushed.
3. `build-windows.yml` keeps its GitHub-release trigger. It is the desktop release build, not CI.
**Consequences**: A red main is no longer announced on push. The reminder at release time is the prompt to run CI. Pull requests get no automatic checks.

## ADR-154: Uptime Alerts Page on Two Failed Rounds From Two Regions, by Email + SMS, on a Host Variable (MUT-328)

**Status**: Active (supersedes the optional single `/health` alert from ADR-026's first cut)
**Date**: 2026-10-20
**Context**: Pilot gate (MUT-322). Production's only uptime check had no alert channel. Basel chose email + SMS through Cloud Monitoring channels, with the phone number kept out of the repo (MUT-328 comment, 2026-10-19). The custom domain isn't chosen yet (MUT-112, prepared by MUT-326). There is no staging.
**Decision**:
1. Three uptime checks (`/health`, `/ready`, the portal `/` matched on `id="root"`) live in the API root's `monitoring.tf`, every 300 s from all six regions, on `local.uptime_host`: `var.uptime_host`, else the Cloud Run host. The domain input feeds that local.
2. Each check's policy fires when **more than 1 region** fails for **360 s** (period + 60 s), on `ALIGN_NEXT_OLDER` + `REDUCE_COUNT_FALSE` aligned to the period. One failed round can't page, and two in a row do. Severity is CRITICAL. Cloud SQL disk > 80% and CPU > 90% for 900 s are WARNING.
3. Channels come from `alert_email` and `alert_sms_number` (sensitive, E.164), plus any `alert_notification_channels`. With no channel there are no policies.
4. Firing and closing are proven with an opt-in drill check (`uptime_drill_path`) passed only with `-var`, never by scaling production down.
5. Monitoring changes are applied with a targeted plan (DEPLOYMENT.md §6b), separate from releases.
**Consequences**: Expect about a 6 to 11 minute delay between an outage and the page. A one-region network problem never pages. The close notice depends on Cloud Monitoring's default until the provider is on 6.x (TD-185). Moving the domain may replace the checks (new ids), and their policies follow them.

---

## ADR-155: The Custom Domain Is One Input: `config/hosts.json`, a Cloudflare Worker Front Door, a Front-Door Token, Staged Cut-Over

**Status**: Active (amends DEPLOYMENT.md §4c "PORTAL_ORIGIN intentionally unset" and §5's deferred-domain note; the front-door choice can be overridden, see 2)
**Date**: 2026-10-20
**Context**: MUT-326 (epic MUT-322, blocks MUT-112). The domain isn't chosen, but it must be live before the pilot (Basel, 2026-10-19). On 2026-10-20 Basel listed the apex, the subdomain and the front door as undecided on MUT-112; MUT-326's own text says to pick the cheapest front door that keeps `TRUSTED_PROXY_HOPS` correct. The legacy hosts were hardcoded in vite, the bundle allowlist, the terms release guard, provisioning, Sentry tfvars and the phone. Cloud Run domain mapping isn't offered in me-west1. Brief: `.claude/designs/mut-326-domain-move.md`; adversarial review folded in.
**Decision**:
1. **One file per repo, `config/hosts.json`**, holding `domain` (null until chosen), `portalSubdomain` (`app`), the `legacy` origins and a `stage`: `legacy` → `proxy` (the front door exists; builds unchanged) → `live` (builds, links and the phone use the new hosts) → `redirect` (old-host pages are sent on). `config/hosts.ts` (TS) and the Terraform `locals` (HCL) derive the same values, pinned to the same fixtures. `stage` exists because committing the domain must not re-point the next release before DNS works. `scripts/__tests__/no-hardcoded-hosts.test.ts` fails on our hosts anywhere else, and rehearses `mutaba3a.app` as the domain. The Malafat OAuth `CIMD_CLIENT_ID` keeps its own value.
2. **Front door: a Cloudflare Worker** on `app.<apex>/*` forwarding to the run.app origin (`server/infrastructure/frontdoor`, its own operator-applied stack). This follows Malafat's `malafat-router`. It costs $0 on the Workers free tier, against about $18/month for a Google external HTTPS load balancer, and the certificate is automatic. Apex and `www` are DNS-only to Netlify. Swapping to a load balancer later changes only that stack and where the server reads the client IP.
3. **A front-door token instead of a second hop count.** run.app stays reachable directly for old phones, Malafat and the carry-over, so one `TRUSTED_PROXY_HOPS` can't fit both paths. The Worker sends `x-mutaba3a-front-door: <FRONT_DOOR_TOKEN>` and `x-mutaba3a-client-ip: <CF-Connecting-IP>`, overwriting the caller's copies. The server:
   - takes that IP and judges `Origin` against `PORTAL_ORIGIN` only when the token matches (sha256 digests, `timingSafeEqual`);
   - judges every other request exactly as before.

   The token is Terraform `random_password` in Secret Manager, a `secret_text` binding in the Worker, and mounted by reference in Cloud Run.
4. **The frontdoor stack owns the token secret.** The API stack reads it with a data source, so its plan fails loudly when the frontdoor stack wasn't applied first. The zone and the secret are `prevent_destroy`.
5. **Redirects are staged and 302.**
   - From `live`, Netlify sends `<apex>/app/*` back to netlify.app, where the free web app's IndexedDB is.
   - At `redirect`, Netlify sends the old host's landing pages to the apex.
   - At `redirect`, the server sends direct run.app page visits to the same-origin `/carry-over?next=…` page. It never touches the API, admin, association files, health checks, assets, static files or writes.
   - `PORTAL_LEGACY_REDIRECT` parses only `"true"`/`"false"`.
6. **The phone repo is not edited here.** `npm run domain:plan` prints its exact lines, and it claims both hosts for at least one release.
**Rejected**: a Google external HTTPS LB plus serverless NEG (cost; two hop counts during the transition); a Cloudflare proxied CNAME with an Origin Rule host override (no place to inject the token and client IP that is as testable as a Worker); a hop-count bump (`TRUSTED_PROXY_HOPS=2` would trust a forged `X-Forwarded-For` entry on direct run.app traffic).
**Consequences**:
- While `domain` is null, nothing changes, and the plans and the builds are as before (snapshot masked, tests pin it).
- Past 100k requests/day per Cloudflare account the Worker fails closed until UTC midnight (TD-186).
- Browser-saved passwords don't follow the host: people sign in once on the new host (MUT-112 release note). Google Password Manager affiliation through web↔web `assetlinks.json` statements is left to MUT-112 (it changes the API contract).
- `cloudflare_zone_setting` can't be destroyed from Terraform.

**Amendment (MUT-387, 2026-10-22): the Malafat OAuth client identity moves to `mtb3a.com`, and `mutaba3a.app` is retired.**
- **Why:** decision 1 kept `CIMD_CLIENT_ID` at `https://mutaba3a.app/.well-known/oauth-client.json`, but nobody owns `mutaba3a.app` (no DNS, no whois record, checked 2026-10-21). Basel chose to move the identity, not register the domain. Plan, eng review and decisions D1–D7: `.claude/designs/mut-387-cimd-identity-move.md`.
- **The id is a fixed literal:** `CIMD_CLIENT_ID = 'https://mtb3a.com/.well-known/oauth-client.json'`, never derived from `config/hosts.json`. It is the one exception to decision 1. `OWN_VALUE_FILES` holds only the document, `oauth-client.ts` and `bundle-origins.json`. `cimd-document.test.ts`'s byte-equality case pins the literal to the static document.
- **`mutaba3a.app` is retired:** `RETIRED_HOSTS` in `no-hardcoded-hosts.test.ts` forbids it in every non-prose file. The `mutaba3a.app` rehearsal is gone: once the domain was chosen, it could no longer fail.
- **Serving still depends on infra built from the config:** the zone and `netlify_site_domain_settings.landing`. An apex change must keep `mtb3a.com` bound to the Netlify site and primary (DEPLOYMENT.md §5a, comments in `frontdoor/main.tf`). The vite-config test keeps every stage's `_redirects` and any forced `netlify.toml` rule off the document's path; Malafat refuses a 3xx.
- **The bundle check allows the identity origin in one file only:** `FILE_SCOPED_ORIGINS` in `scripts/bundle-rules.ts` permits it inside `.well-known/oauth-client.json`, never bundle-wide, so a `domain: null` rollback still passes `test:bundles` and nothing else can quietly use the host.
- **Checked live after every web release:** `make release web` runs `npm run release:oauth-client`, which waits for Netlify and fails on a 3xx, non-JSON, a mismatched `client_id` or a stale document.
- **Tripwire:** `no-hardcoded-hosts.test.ts` fails if `config/hosts.json`'s domain stops being the identity's host, so a domain move must decide the identity's fate.
- **What it doesn't change:** Malafat marks every CIMD client outside its allowlist UNVERIFIED (MAL-224), ours included (loopback redirects). Someone can still register `mutaba3a.app` and name a client "Mutaba3a". The move makes the one id we ship ours. Nothing calls the flow yet (TD-075).

**Amendment (2026-10-26, Basel):** a mailbox is not a host. `no-hardcoded-hosts.test.ts` ignores the domain when it follows `@` (`info@mtb3a.com`, MUT-382's contact address in the terms, privacy policy, sign-in pages, `SUPPORT_EMAIL` and `MAIL_REPLY_TO`'s description), because where people write to doesn't move with where the apps are served. A subdomain (`mail.mtb3a.com`) is still a host and still fails.

## ADR-156: Signed In, "Download My Records" Writes the Local-Mode Records File — Built in the Portal From a Streamed Per-Profile Export (MUT-325)

**Date:** 2026-10-20 · **Status:** Accepted (D1–D5 reviewed and accepted by Basel, 2026-10-20; see the members note under Consequences) · **Epic:** MUT-322 (pilot gate) · **Format owner:** MUT-286/287

**Context.** A paying user must be able to leave with their records. Signed out, Your data already writes a versioned records file (a zip of `records.json` — a `MemoryLedgerStore` snapshot — and `receipts/<storageKey>`) and restores it. Signed in there was no export at all.

**Decision.**
1. **Same file, by construction (D1).** The signed-in Download produces exactly the file local mode writes: the portal fetches each chosen profile's `records.json` from `GET /v1/records-export` (X-Mutaba3a-Profile), merges them, fetches each READY receipt's bytes from `GET /v1/records-export/receipts/{id}`, and zips with local mode's own `zipRecordsArchive`. The `$map/$date/$bigint` codec moved to `server/src/records-file/codec.ts`, shared by both sides. Restore, migrations and the format fingerprint are unchanged.
2. **Streamed, not a job (D1).** The server reads a profile 500 rows a query (`RecordsExportRepository`, memory + Prisma with exact per-record selects) and writes the JSON as it is pulled (gzip when accepted), so memory holds one page whatever the profile's size. Receipts are one short request each (4 at a time; a 429 is waited out; a file that fails twice or arrives the wrong size is left out and counted). No request carries the whole export, so Cloud Run's request timeout never applies to it; no queue, bucket object or Terraform is needed. The cost is the zip in the tab's memory, the same ceiling local mode's own Download already has (TD-188).
3. **Re-homed to the device's person (D2).** The file holds one person — the exporter, under `local@device.invalid`, with no password, lockout or sign-in state — and their membership only. A profile they belong to but don't own becomes theirs on the device (BUSINESS, or PERSONAL for someone's personal one): ADR-097 §2.2, the local person owns every local profile. Organization, person and membership rows are copied field by field, so a column added later (ADR-099's roles, firm fields) never reaches a device unasked. No other person's row or email is written; other people's ids on rows stay as opaque UUIDs (locally `capturedBy` reads null for a colleague's capture).
4. **Malafat stays with Malafat (D4).** No integration row (they hold the connection) and no Malafat document (`files`) is written; `refs` (opaque Malafat ids) are kept. On the device the firm has no other writer, so its income arrives as the person's own records. The file is labelled `origin: "hosted-export"` beside `maps` (not a format change), named `mutaba3a-export-<date>.zip`, and both the drawer and the Restore confirm say it is an export, not a backup: nothing restores into an account (MUT-290 is later).
5. **Faithful to what reads show.** Due installments and charges are posted before the export (ADR-037 decision 8), so a device never posts them again with new ids. The export is audited `records.exported` on the profile, as the person.
6. **Signed-in only, a lazy chunk.** The routes are session-only and outside `PORTAL_ROUTES`; local mode never serves them. The portal reaches the export code through the alias `@mut/records-export` (types: `session/recordsExportContract.ts`; code: `src/hosted/local/hostedExport.ts`), loaded only on Download, the same split as `@mut/local-backend`.

**Override log.**

| Overridden | What it said | Replaced by | Why | Date |
|---|---|---|---|---|
| ADR-097 override note ("no shared ids, no hosted row stored locally") | Hosted and local data stay apart | A person may restore their own hosted rows, ids kept, onto a device (§3–4 above) | The pilot gate: a paying user can leave with their records, in the format the free app already reads | 2026-10-20 |
| ADR-028 §2 (downloads are a 302 to a signed URL) | The API never passes bytes on | `GET /v1/records-export/receipts/{id}` streams a receipt as `application/octet-stream`, `Content-Disposition: attachment`, `nosniff` | The portal must read the bytes to zip them, and the bucket has no CORS in IaC; still a download, never rendered | 2026-10-20 |

**Consequences.** MUT-290 (moving a device's records into an account) will meet hosted ids already on devices. A write from another device during a long export can leave the file a moment inconsistent across pages (TD-189). The cap of 6 owned profiles isn't enforced on restore: re-owning firms can leave a device owning more than 6, which only stops it creating new ones.

**Members (Basel, 2026-10-20).** Exporting a profile the person belongs to but doesn't own is accepted only while every user is an owner (the pilot). Before the first member invite (MUT-305/306), export must be limited to profiles the person owns, or to what their firm role allows. MUT-305 carries this as a requirement.

## ADR-157: Restores Go Through a Scratch Copy; a Profile Restore Never Rolls Back Access or Audit (MUT-327)

**Status**: Active
**Date**: 2026-10-20
**Context**: Pilot gate (MUT-322). Backups had never been restored. A pilot user's mistake is far likelier than a lost database, and a whole-database restore costs every other user their recent work. Claude never touches production; Basel runs the drill.
**Decision**:
1. **Every restore reads from a scratch copy first.** That's a backup restored into, or a point-in-time clone to, an instance named `mutaba3a-pg-drill-<stamp>-b|p`. Nothing restores in place, except a whole-database restore from a daily backup (runbook §4.3 A), and that only after an on-demand backup (the undo point) with ingress closed.
2. **One profile is restored on its own** (`scripts/profile-rows.sh restore`), in one transaction:
   - Its rows in every table with an `organizationId` are replaced by the copy's.
   - `api_keys`, `memberships`, `integrations` and `idempotency_keys` keep their live rows, so a restore never re-grants revoked access.
   - `audit_events` are merged, never removed, and a `SYSTEM` `organization.restored` event is appended.
3. **The schema comes from the catalog**, so the tools follow migrations without edits. Profile tables are those with `organizationId`; foreign keys give the order. A copy whose columns differ from live is refused.
4. **The drill's safety is structural.** Every create, change or delete passes `mutate <scratch name>`, which refuses the source and any non-drill name. The copies get their own password for `mutaba3a_api`, so the drill never reads production's.
5. **Until MUT-333, the operator's hard delete** (`purge-user`) deletes only what the person owns. It refuses while they're a member of, or referenced from, someone else's profile: that's MUT-333's decision. A later whole-database restore must replay the purge log (runbook §4.3).
**Consequences**:
- Receipt files aren't in the database backups: the bucket keeps no versions, only the soft-delete window (TD-190).
- A profile restore loses that profile's changes after the restore point, and access changes since then need a manual check.
- Whole-database dumps need Postgres 16 client tools.

---

## ADR-158: Claimed-Save Feedback Rides the Existing Toast/SavedNotice Surface, Not a New Floating Element

**Status**: Active
**Date**: 2026-10-19
**Context**: MUT-338 wires ADR-152's `playIconFeedback` into a real save. The "claimed" path (the saved row is already on screen) had no visible feedback at all before this ticket — only a permanent `sr-only` "Saved" span, because the row itself tints (`useSavedFlashRows`). Making the new icon visible here meant either inventing a new floating UI element with no existing visual home and an un-pinned-down position, or reusing a surface the app already has designed, positioned and tested: the existing Toast (legacy app) / `SavedNotice`'s `NoticeBox` shape (portal), which already handles the sibling "unclaimed" case.

**Decision**: Reuse the existing toast/notice surface for the claimed path too, firing a brief (`FLASH_MS`, matching the row tint's own window) message carrying the icon, instead of a new component. Presented as a 3-way choice to Basel (reuse Toast / new floating chip / leave sr-only-only); **reuse Toast** was chosen.
1. **Legacy app** (`SavedFlashAnnouncer.tsx`): the claimed branch now calls the same `showToast` the unclaimed branch already uses, with `icon: <SaveFeedbackIcon preset="playful" />` and `duration: FLASH_MS`.
2. **Portal** (`SavedNotice.tsx`): no global toast context reaches a page-scoped component cleanly here, so the claimed branch renders a `NoticeBox`-shaped element in place (same `hp-toast hp-toast-info` classes the unclaimed `NoticeBox` already uses), gated by a local flash timer. Built as a render-time state adjustment (`if (claimedVisible && shownFor !== claimedVisible) { setShownFor(...); setFlashVisible(true) }`) rather than `setState` inside a `useEffect` body — the React Compiler / `react-hooks/set-state-in-effect` lint rule flags the latter (cascading-render risk); only the timer that *ends* the flash lives in an effect.
3. **Rejected: a new floating chip.** No existing design pins down where it would sit (not near the row — rows can be anywhere in a long list; not fixed-position — nothing like that exists in the portal today), and it would need its own CSS, review and tests for zero behavioral gain over the already-designed toast surface.

**Consequences**:
- Every claimed save now also produces a transient toast/notice, not just the row tint — slightly more feedback than before, intentionally (that was the point: there was no icon-bearing surface to animate otherwise).
- `SavedNotice`'s `preset: IconFeedbackPreset` prop is resolved once by the page (`ExpensesList.tsx`/`ConversionsList.tsx`, which already hold the full `HostedProfile` via `useProfile()`), not looked up inside `SavedNotice`/`ExpenseDrawer`/`ConversionDrawer` via `useMe()` — those three only ever held `profileId: string`, and adding `useMe()` there would have broken their existing tests (none wrap a `Me` context) for no benefit over a one-line prop threaded from where the data already lives.
- MUT-339/340 (streaks, milestones) inherit this precedent: reuse the existing toast/notice surface for new icon-bearing feedback before inventing new floating UI.

---

**Amendment (2026-10-20, Basel, MUT-338 comment 12272)**: the restrained preset goes to profiles with MUT-300's firm switch on (`firm: true` on `/v1/me`), not to `type === 'BUSINESS'`. A BUSINESS profile without firm features, an operator organization without them, and a server older than 1.41.0-mut300 all play the playful preset. `saveFeedbackPreset` is still the one place the rule lives.


## ADR-159: Open Signup Verifies the Email First and Ends on the Setup-Link Page; Only Business Email Is Instant, the Rest Waits for the Operator; Forgot-Password Mails a RESET Link; Resend Is the One Mailer (Overrides ADR-037 §1's "Operator-Issued Only")

**Status**: Accepted (Basel, 2026-10-20, Q1–Q5 + Q4b in `.claude/designs/mut-331-self-service-signup.md` §10). Overrides ADR-037 §1 and ADR-088's "no signup or forgot-password route" for GA. Supersedes firm-books §10.3 / MUT-299 D14 ("MUT-306 picks the email provider"). Partly overrides Basel's own 2026-10-19 "no approval step" (MUT-331 comment 12133).
**Date**: 2026-10-20
**Context**: GA needs anyone to sign up, pay and leave without the operator (epic MUT-322). Basel decided open signup with email verification on 2026-10-19. The server has no email provider, and firm invites (MUT-306, firm-books D10) need one. The ticket says "ADR-037 decision 4" because "accounts are operator-issued only" was the fourth of Basel's 2026-10-10 decisions that ADR-037's context records. The rule itself is ADR-037 §1. ADR-037 §4 (sign-in doesn't reveal accounts) is **kept** and extended to the new routes.

**Decision**:
1. **Signup verifies the email first (Q2).** `POST /v1/signups {email, locale, turnstileToken}` mails a link. The link opens the existing `/setup` page, where the person sets a password (required) and accepts the terms (ADR-102 §5), and the existing redeem creates the account and the personal profile.
   - No User row exists until redemption: the SIGNUP token is bound to the email, as firm-books D10 binds invites.
   - SIGNUP links last 24 h and work once. Redeeming sets `emailVerifiedAt` and issues no session (ADR-088 §5).
2. **Only business email is instant; everything else waits for the operator (Q4, Q4b).**
   - **Refused outright** (400 `EMAIL_NOT_ACCEPTED`): disposable domains, on a vendored public list, and domains that can't receive mail.
   - **Instant:** a domain that is not free webmail, has MX, resolves, and is ≥ 90 days old by RDAP. The account is `ACTIVE` at once.
   - **Waits for review:** free webmail (Gmail, Outlook, iCloud…), or a domain whose checks fail or can't be completed. The account is created `PENDING_REVIEW`. Signing in with the right password answers 403 `ACCOUNT_UNDER_REVIEW` until the operator approves or declines through `/admin/v1/signup-reviews` or `signups:review`. Both outcomes mail the person, and a decline deletes the empty account.
   - The check is DNS and RDAP only. The server never fetches the domain's website.
3. **Forgot-password reuses ADR-088 unchanged.** `POST /v1/account-recovery {email, turnstileToken}` mails a RESET link (1 h) to an ACTIVE or PENDING_REVIEW account, or a fresh SETUP link to a pending operator-created one. Nothing changes until the link is used. A "your password was changed" notice follows every password set or change.
4. **Accounts are never revealed.** Both routes answer `202 {status:"sent"}` for every address that passes the input-only checks, no earlier than a fixed floor (3 s for signup, 1.5 s for recovery). An existing address gets a "you already have an account" mail instead of a signup link.
5. **Resend is the one mailer (Q1),** through Barmajiyat's existing account, behind a `Mailer` port:
   - Mutaba3a has its own verified domain on the MUT-112 apex, sending from `eu-west-1`, and its own domain-restricted sending key.
   - It sends from `no-reply@<apex>`, with no interim sender domain.
   - Open and click tracking are off, and `email:check` enforces that.
   - Templates are server-rendered in en/ar, with Arabic RTL HTML and plain text.
   - Svix-signed bounce and complaint webhooks suppress the address.
   - Resend stores records in the US, and the privacy policy says so. Money records never enter an email.
   - The same mailer serves MUT-306 invites and the operator's review digest.
6. **Abuse controls.** The server verifies Turnstile and fails closed. Limits: 10/h per IP; 1/min and 5/day per address, whether or not an account exists; a 500/day global send cap, kept below the shared Resend plan's limit. Unredeemed SIGNUP tokens are pruned.
7. **Switches.** `SELF_SIGNUP_ENABLED` (default false) gates signup until GA. Recovery ships as soon as email works, pilot accounts included. Operator issuance stays.
8. **Tier at signup (Q5): Freelancer by default.** Firm comes through MUT-300's request. Signup writes no plan; billing (MUT-332) owns entitlements and the step after the first sign-in, and never charges a PENDING_REVIEW account. With ADR-160's 14-day trial, a reviewed account's trial starts when it becomes `ACTIVE` (approval), not at signup, so time spent waiting for the operator never eats the trial.
9. **Passkeys (Q3).** A password is required at signup. A passkey is optional and suggested as the more secure way, through a dismissible card after the first sign-in, once MUT-115 ships. Passkey-only accounts are out of scope.

**Override log**:

| Overridden | What it said | Replaced by | Why | Date |
|---|---|---|---|---|
| ADR-037 §1 ("decision 4" in MUT-331) | "No signup, invite or password-reset route exists in any environment"; accounts are operator-issued only | Decisions 1, 3 and 7: open signup (switchable) and self-service recovery beside operator issuance | GA requires self-service (MUT-322); Basel's 2026-10-19 decision | 2026-10-20 |
| ADR-088 §4 and the ADR-037 override note | The only public account routes are sign-in and the setup-link pair | Adds `POST /v1/signups` and `POST /v1/account-recovery`; `no-self-registration.test.ts` re-pinned deliberately | Same | 2026-10-20 |
| ADR-088 "Alternatives rejected: emailing the link — there is no email provider" | Links are delivered by hand | Self-requested links are mailed; operator links stay copyable | A provider now exists (decision 5) | 2026-10-20 |
| firm-books §10.3 / MUT-299 D14 | MUT-306 picks the provider | This ADR picks Resend; MUT-306 uses the mailer | Signup and recovery need it first, and before MUT-306 | 2026-10-20 |
| Basel's 2026-10-19 "no waitlist, no approval step" (MUT-331 comment 12133) | Anyone who verifies their email is in | Instant only for verified business domains; webmail and unverified domains wait for operator approval (decision 2). Still no waitlist. | Basel, Q4/Q4b, 2026-10-20: accept business email only, review the rest | 2026-10-20 |
| `HOSTED_RULES` (MUT-37/43 bundle rule) | The portal never says create account / forgot / reset | Those phrases are allowed; "invite" and "subscribe" stay banned until MUT-306 and billing | Signup and recovery pages need the words | 2026-10-20 |

**Rejected**:
- Amazon SES in Tel Aviv. It was recommended for Israeli residency and price; Basel chose reuse of Resend. An SES adapter stays a one-file change.
- Scaleway, Postmark, Mailgun.
- Password-first signup.
- Passkey-at-signup.
- Allowing disposable addresses.
- Accepting webmail instantly.
- Refusing webmail.
- Asking the tier at signup.
- An interim sender on a Barmajiyat or Malafat domain (it looks like phishing and mixes reputations).
- Fetching the domain's website (SSRF).
- Malafat SSO (rejected 2026-10-11).

**Consequences**:
- A new operator-applied `email` Terraform stack (DNS records only). Live sending waits on MUT-112.
- `AccountSetupToken.userId` becomes nullable, with a bound `email`.
- New `users.emailVerifiedAt`, `UserStatus.PENDING_REVIEW`, `signup_reviews` and `email_suppressions`.
- A Resend webhook outside `/v1`.
- The in-process limiters keep TD-017's single-instance assumption.
- The privacy policy names Resend (US records), Cloudflare Turnstile and the RDAP lookup.
- At GA most freelancer signups (webmail) wait for review, about 5 a day at 1,000 users. Moving a webmail provider to instant is a list edit and a recorded decision.
- The phone's "Create an account" link waits on in-app account deletion (MUT-333, App Store 5.1.1(v)).
- Build stories MUT-359, MUT-366..371 (brief §12).
## ADR-160: Billing Is Stripe Billing + Stripe Tax; the Person Pays and Each Profile Is Entitled; Unpaid Trials Lock, Paid Lapses Stay Read-Only (MUT-332)

**Status**: Active (spike decision; built by MUT-358, MUT-360…365)
**Date**: 2026-10-20
**Context**: GA gate (MUT-322). People must be able to pay without the operator. The seller is Barmajiyat Ltd (UK), and the pilot is already billed with Stripe subscriptions made by hand in the dashboard. Malafat firms pay through Malafat (MAL-870). The full comparison, costs and sources are in `docs/commercial/billing-spike.md`.
**Decision** (Basel, 2026-10-20):
1. **Provider: Stripe Billing + Stripe Tax** on the Mutaba3a Stripe account. Barmajiyat Ltd is the seller of record and owns registration and filing (MUT-355). We looked at Paddle, Stripe Managed Payments and Lemon Squeezy as merchants of record and turned them down: the pilot's subscriptions would have had to migrate or couldn't join, Managed Payments still leaves the UAE, Bahrain, Oman and Jordan to us, Lemon Squeezy charges everyone in USD, and they cost more. We revisit Paddle if consumer sales in the Gulf or Jordan become real.
2. **The person pays, and each profile is entitled.** The Stripe Customer is the `User`. A Freelancer subscription covers the person's own profiles. A Firm subscription covers one organization (`firmEnabledAt`, MUT-300) and the owner's own profiles. Coverage is checked in this order: MALAFAT (a CONNECTED integration), OPERATOR (a grant), STRIPE, TRIAL. The tier comes from `product.metadata.tier`, never from the amount.
3. **States are ACTIVE, GRACE, READ_ONLY and LOCKED.**
   - `past_due` is GRACE.
   - A paid subscription that lapses becomes READ_ONLY for good: reads and records export keep working, and nothing is deleted.
   - A trial is 14 days with no card, then 14 days READ_ONLY, then LOCKED. LOCKED leaves only Subscribe and Download my records, and applies only to people who never paid.
4. **One gate.** `SUBSCRIPTION_LAPSED` is enforced in `store-guard.ts` and `authenticate()`, next to READ_ONLY_PROFILE. The `identity` row, `/v1/billing/*` and `GET /v1/records-export*` are always open. Malafat API-key writes are never billing-gated.
5. **Stripe is the source of truth.** Webhooks are idempotent through `StripeEvent`, re-fetch the object rather than trusting the payload, and a nightly reconcile repairs anything missed. Pilot subscriptions are linked by `metadata.mutaba3a_user_id`, so nothing migrates.
6. **Consumer checkout opens country by country** (`config/billing-countries.json`). Anywhere else, checkout needs a business tax ID until Barmajiyat Ltd registers there.
7. **Founder prices are their own Stripe Prices** (`*_founder_*`). A subscription schedule moves each one to the GA list price (`*_list_*`) after its 12-month lock.
8. **Prices reach the site** only when the MUT-332 §6 gate holds (MUT-365).
**Consequences**:
- Stripe's Checkout, Customer Portal and invoices have no Arabic. Our own Arabic Billing page explains everything before the English card form.
- Stripe Tax can't calculate Israel or Jordan, so those take manual tax rates if MUT-355 says tax is due.
- A firm member's own profile isn't covered by the firm's subscription until firm v3 decides otherwise (MUT-305/306).
- The ADR-037 no-self-signup rule is MUT-331's override (ADR-159 on its branch), not this one's.

---

## ADR-161: deploy.sh Step 0 Bootstraps Only on an Empty State; a Pending Terraform Rename Is an Operator Step, Never a Release's Job

**Date**: 2026-10-20
**Status**: Accepted
**Context**: deploy.sh step 0 ran `terraform apply` with four `-target`s on every release so the Artifact Registry repository and the database exist before `docker push` and `prisma migrate deploy`. Terraform refuses a targeted plan that leaves a pending `moved` block out ("Moved resource instances excluded by targeting"). MUT-328 (ADR-154) renamed the uptime check from `health[0]` to `endpoint["health"]` with a `moved` block and was merged "prepared, not applied", so from then on every `make release server` died in step 0 before building anything. api v0.3.16, v0.3.17 and v0.3.18 were committed (v0.3.18 pushed) but never deployed; production stayed on api-v0.3.15. The before-release note presented §6b as optional. CI's Terraform job cannot see this: it has no production state.

**Decision**:
1. Step 0's targeted apply runs only when at least one of its four addresses is missing from `terraform state list` (a first run on an empty project). Otherwise it is skipped and the outputs are read. The logic lives in `server/scripts/lib/tf-bootstrap.sh` so it is testable through a fake `terraform`.
2. A Terraform rename (`moved`) merged to main is applied by the operator step that introduced it (DEPLOYMENT.md §6b for MUT-328), or by step 4's full apply, which has no `-target`. Terraform's suggestion to add the moved addresses to step 0's targets was rejected: it would create monitoring during the bootstrap, before the image exists, and would recur with every future rename.
3. A before-release item whose Terraform blocks the release says so ("BLOCKS this release").
4. §6b's targeted plan names both sides of the move; Terraform 1.15 refuses it otherwise.

**Consequences**:
- A release never performs a state rename by accident, and never stops on one either.
- A first deploy to a new project still bootstraps the registry and database as before.
- The four addresses are listed once, in the helper; renaming any of them is a change to that list and its test.


## ADR-162: Billing Core: One Pure Resolver per Profile, Pre-Billing Grants for Everyone Who Exists, Billing Out of the Local Snapshot and Out of Restores (MUT-358)

**Status**: Active
**Date**: 2026-10-21
**Context**: ADR-160 (MUT-332) decided who pays and what a lapse means. MUT-358 builds the server half that every later billing story reads (MUT-360…365), with nothing enforced until MUT-361. Brief: `.claude/designs/mut-358-billing-core.md`. Basel approved P1–P3 on 2026-10-20 (Jira MUT-358 comment 12273).
**Decision**:
1. **One pure resolver.** `billing/entitlement.ts` `resolveEntitlement(profile, facts, now)` runs seven rules in order: MALAFAT, OPERATOR, STRIPE (covering), TRIAL (running), STRIPE (lapsed), TRIAL (ended), NONE. States are ACTIVE, GRACE, READ_ONLY and LOCKED. The trial is ACTIVE for 14 days from `User.trialStartedAt`, READ_ONLY until day 30, then LOCKED. LOCKED applies only to someone who never paid; `incomplete` and `incomplete_expired` subscriptions never count as paying.
2. **Coverage follows the owner (`profileOwnerOf`).**
   - The owner's subscriptions cover all of the owner's profiles; Firm includes Freelancer.
   - A subscription or grant tied to an organization covers that profile.
     - *Superseded in part by ADR-165 (MUT-360, 2026-10-21)*: a **subscription** tied to an organization covers it only when nobody owns it (an operator firm) or its owner is the payer. Grants are unchanged.
   - `firmEnabledAt` is not read (P3).
3. **`User.trialStartedAt`, not a verification time (P2).** It is null for every operator-issued account; MUT-331's signup sets it through `billing.setTrialStart`.
4. **Pre-billing backfill (P1).** The migration grants every existing user (FREELANCER) and every owner-less operator firm (FIRM), with `reason = 'pre-billing'`. People provisioned later get a grant by hand (`pilot-runbook.md` §1.5).
5. **`/v1/me` reads billing once per call** (`billing.factsFor`: three queries, whatever the profile count). Each profile gets an additive, nullable `billing` field. It is null in the portal's signed-out mode (`PortalRouteDependencies.billing: false`). POST/PATCH `/v1/profiles` omit it.
6. **Store guard.** `billing.factsFor` is `sessionOnly`; every other billing method is `operator`. The admin routes, and from MUT-360 the webhook, write on the unguarded store.
7. **Billing never travels with a profile's data.**
   - The memory store keeps its billing maps out of `snapshot()`, so local format 2 is unchanged.
   - `profile-rows.sh` keeps `billing_subscriptions` and `entitlement_grants` live on restore and leaves them out of export.
8. **Operator surface.**
   - `POST|GET /admin/v1/billing/grants`, `DELETE /admin/v1/billing/grants/{id}` (sets revokedAt, never deletes), `POST /admin/v1/billing/accounts/link` and `GET /admin/v1/billing/accounts`.
   - The CLI verbs are `billing:*` in `users.ts`.
   - Every change is audited (`billing.grant_created|grant_revoked|account_linked`) on each profile it reaches.
**Consequences**:
- MUT-361 can enforce from `/v1/me`'s `billing` and a store-guard rule alone.
- MUT-373 co-owners: coverage follows the one owner `profileOwnerOf` names; a co-owner's own subscription doesn't cover a shared profile yet (TD-193).
- The API is 1.42.0-mut358.

---

## ADR-163: Co-Owners — an Owned Business Profile May Have Up to Three OWNER Members; One Ownership Rule; the Creator Stays (MUT-373) (Partial Overrides of ADR-037's MUT-182 Amendment, MUT-181 Decision 4, ADR-099's Rejected Alternative and Its "Role Is Inert" Rule)

**Status**: Active
**Date**: 2026-10-21
**Context**: Two partners running one small business had no way to keep its books together while each kept a private personal profile. An owned profile could not be granted (409 `OWNED_PROFILE`), and an operator-made firm reads as "nobody's own" in the portal, with income, clients and payments read-only (ADR-066). Basel's intake (2026-10-21): equal partners, Freelancer tier, operator-added in the pilot, the creator removes, a co-owner leaves, records stay. Plan, Apple design pass, design review (DR1–DR14) and eng review ledger (A1, D3, D7, A6, R1, OV1b–OV9): `.claude/designs/mut-373-co-owners-plan.md`.
**Decision**:
1. **A co-owner is an OWNER member of an owned BUSINESS profile.** The creator stays `Organization.ownerUserId` (`profileOwnerOf`), so there is no migration and no local snapshot bump. `canCoOwn(org)` = owned, BUSINESS, not the built-in personal profile.
2. **One rule, `ownsProfile(org, userId, role)`** = `profileOwnerOf(org) === userId || (canCoOwn(org) && role === 'OWNER')` (`server/src/personal-profile.ts`). Every owner gate reads it: PATCH/type-change/firm-request, income and payment re-date, `/v1/me` `owned`, terms acceptance, `updateOwned`'s SQL (`coOwnedBy`). The `canCoOwn` guard is load-bearing: every membership defaults to OWNER (MUT-300), so without it staff of operator and Malafat firms would become owners (outside voice OV1). The role comes from `SessionAuth.membershipRole`, which `selectProfile` already loads (A1).
3. **Adding is operator-only in v1**: `POST /admin/v1/users/{id}/memberships` with `role: OWNER` (`grant:user --role owner`) → `memberships.grantOwner`, under the organization's row lock. At most `MAX_PROFILE_OWNERS = 3`, creator included (DR11). Refused: `PERSONAL_PROFILE`, `NOT_BUSINESS`, `NOT_CO_OWNABLE` (not an owned profile), `OWNER_LIMIT`, `ROLE_CHANGE_NOT_SUPPORTED` (already a member with another role; role changes are MUT-305's, D7), `USER_DISABLED` (a disabled account never takes an owner place; Basel, qa-reconcile D2). A grant without a role still refuses every owned profile. The `membership.granted` audit (role OWNER) commits in `grantOwner`'s transaction, and a confirm of an existing OWNER membership writes it when none exists yet, so pre-roll's "confirm it with `grant:user --role owner`" remedy clears a flagged row (adversarial review 1). An operator revoke of a co-owner records the role (`metadata.role`, `reason: operator`).
4. **Leaving and removing**: `DELETE /v1/profiles/{profileId}/owners/{userId}` (session, Idempotency-Key). Naming yourself leaves; naming a co-owner removes them, and only the creator may (`NOT_CREATOR`). **The creator can't leave** (`CREATOR_CANNOT_LEAVE`, D3; ownership transfer is a follow-up, TD-194). The membership goes; records stay attributed. Audited `membership.revoked`, actor USER, `metadata.reason left|removed` (A6), in `removeOwner`'s transaction.
5. **A shared profile stays BUSINESS**: `updateOwned` returns `co_owned` (409 `CO_OWNED`) under its row lock (OV3).
6. **The cap counts the creator only** (`countOwnedBy` unchanged); co-owned profiles don't use a co-owner's slots (the portal explains it, DR2).
7. **Firm enable keeps every OWNER** (`firmOwnersOf` takes the co-owners), so turning firm features on never demotes a partner.
8. **`/v1/me` and POST/PATCH `/v1/profiles`** carry `owners` (creator first; null on a profile you don't own) and `firmRequestedBy`, from one `memberships.listOwnersOf` read (D1, OV4). API 1.43.0-mut373, additive.
9. **Release safety**: `npm run pre-roll` (deploy.sh step 3, before the roll) stops the deploy when a non-creator OWNER-role membership on an owned profile was never made a co-owner (no `membership.granted` with `role: OWNER`), OV1b. Other roles own nothing and pass. `profile-rows.sh purge-user` refuses a creator whose profile still has co-owners.
10. **Re-dating stays per person** (Basel, qa-reconcile D1): a co-owner re-dates only entries they captured, as before. Owed entries carry `capturedByUserId` so the portal offers re-dating only on your own, as it already did for payments. Undo stays per person too.
11. **Billing** keeps following the creator (`ownedProfilesOf` stays creator-only; TD-193 on MUT-358). Malafat suggestions count only profiles the viewer created (OV9).
**Override log**:
- ADR-037's MUT-182 amendment said an owned profile is "never granted to or provisioned into another user". Replaced by: never, except an operator grant with `role: OWNER` on an owned Business profile. Date 2026-10-21; reason above.
- MUT-181 decision 4 ("no sharing") is replaced for co-owners of Business profiles; invites and staff stay out.
- ADR-099 rejected "lifting MUT-182's 'owned is never shared' rule" because it would create two kinds of shared organization. This keeps one kind: an owned organization whose members carry `Membership.role`. Co-owners are its OWNER members, and MUT-305/306 add BOOKKEEPER/SUBMITTER members to that same organization.
- ADR-099 decision 2 said the role is inert while firm features are off. On an owned Business profile, OWNER now means co-owner, read only through `ownsProfile`.
**Consequences**:
- MUT-374 (phone) reads `owned` and `owners` from `/v1/me`; a removed co-owner's outbox writes now answer 404. `owned` now means "you own it" (creator or co-owner), not "you created it": a client that needs the creator reads `owners[].creator`. The phone should gate Owed re-dating on `capturedByUserId`.
- MUT-333 must decide what happens to a co-owner's records on a shared profile when their account closes (Restrict FKs block the purge today; Jira comment 12287).
- Local mode has one person: a co-owned profile exported to a device keeps only the exporter as owner.
**Alternatives considered**: a separate co-owners table (rejected: a second source of truth beside `Membership.role`); letting any OWNER membership count (rejected: firm staff); transfer now (deferred, D3); per-profile `owners` queries (rejected for one batched read, D1).

---

## ADR-164: Our Own KMS Key for the Database and the Receipts Bucket, via a New Instance Behind an Opt-In Stage (MUT-381)

**Status**: Active
**Date**: 2026-10-21
**Context**: ADR-024 requires firm data to be encrypted at rest. Until now Cloud SQL, the attachments bucket and Secret Manager used only Google's default encryption. The 2026-10-21 privacy review chose "harden + CMEK" and ruled out field-level and end-to-end encryption, which would break server totals, FX, Malafat and the accountant export. Cloud SQL can't add a customer-managed key to an existing instance. Plan and eng review: `.claude/designs/mut-381-cmek.md` (Basel's answers D1–D5).
**Decision**:
1. **One key**, `mutaba3a-data` in key ring `mutaba3a` (me-west1).
   - It is SOFTWARE-protected, rotates every 90 days, and has `prevent_destroy`.
   - Only the Cloud SQL and Cloud Storage service agents are granted on it, on the key itself, never project-wide (`infrastructure/terraform/kms.tf`).
2. **A new instance, `mutaba3a-pg2`, encrypted with the key.** It has the same settings as `mutaba3a-pg`, written out in full and pinned by `tests/cmek.tftest.hcl`. It is filled by restoring a fresh backup of `mutaba3a-pg`; `scripts/cmek-cutover.sh` is the only tool that writes to it.
   - Not a `for_each` over both instances: that would rename the bootstrap targets ADR-161 relies on.
3. **`cmek_stage = off | prepared | active`, default `off` (D3).**
   - `deploy.sh` runs a full apply, so without the stage the first release after the merge would create the key and the instance and re-key the bucket.
   - `prepared` creates everything. `active` moves the DATABASE_URL secret, the Cloud Run volume, the outputs and the Cloud SQL alerts to `mutaba3a-pg2` together.
4. **The bucket gets the key as its default from `prepared` on.** Signed URLs are unchanged, because the storage agent does the encryption. Existing objects are rewritten under the key by hand (DEPLOYMENT.md §6d).
5. **The cutover is a tested script (D1).**
   - The API is closed during the copy, which goes on-demand backup → restore → key check → every table's count compared.
   - Any failure reopens the API on `mutaba3a-pg`.
   - The switch apply runs with `api_ingress = INGRESS_TRAFFIC_INTERNAL_ONLY`, and a second apply reopens it once `verify` sees the new revision serve 100% from pg2 (D2). This closes the gap in which outside requests could reach an old revision still writing to `mutaba3a-pg`.
6. **The restore drill follows the active instance (D4).** CMEK copies stay under the key.
7. **`mutaba3a-pg` stays for 14 days after the cutover**, so its backups cover the window the privacy policy promises. MUT-383 then removes it (D5).
8. **Hardened after the pre-landing review (2026-10-21).**
   - The cutover copies only when terraform state is readable and the serving Cloud Run revision doesn't mount `mutaba3a-pg2`; a state it can't read stops it, never a guess.
   - The freeze is checked, not assumed: a drain wait, the live ingress re-read, and `mutaba3a-pg`'s write counters (`pg_stat_database` rows inserted/updated/deleted) compared before and after the copy, so an UPDATE the row counts can't see still stops it.
   - `deploy.sh` refuses a release whose tfvars stage would move the database, and one that would reopen a closed service (`scripts/lib/release-guard.sh`). The switch happens only through the printed applies, which both pin `cmek_stage=active`; the tfvars edit comes after `verify`.
   - `verify` also checks the DATABASE_URL secret names `mutaba3a-pg2`, because the probes only hit `/health`.
   - A log-match alert pages on any change to a version of `mutaba3a-data` (Admin Activity log).
9. **No KMS Data Access audit logs.** In the shared `malafat-production` project they're a project-wide setting, so they would also log every decrypt of Malafat's tenant keys. Admin Activity logs (every change to the key) are always on.
**Consequences**:
- **What CMEK protects:**
  - the disks and backups Google holds;
  - the ability to make the database, its backups and every receipt unreadable by revoking the key.
- **What it doesn't protect against:**
  - anyone with roles in the project. Malafat's runtime service account holds project-wide KMS, storage, SQL and Secret Manager roles there, so it can read the database credentials, the operator token and the session pepper as well as every receipt (TD-195).
  - Secret Manager and the Terraform state, which keep Google's default encryption.
- **Cloud SQL never re-encrypts on rotation**, so a disabled or destroyed key version takes the API down. Never disable an old version (pilot runbook §5.4). A destroy can be cancelled for 30 days.
- **The cutover costs a short downtime**, measured by `rehearse` before the real run.
- **About $28 once** for the second instance's 14 days, plus cents a month for the key.
- **Ingress is now a variable** (`api_ingress`), which runbook §4.3's emergency close can use too.

---

## ADR-165: Stripe Webhook and Nightly Reconcile: Re-Fetch, Newer Read Wins, Never Unlink, Firm Coverage at Read Time, a Job Token for the Scheduler (MUT-360) (Partial Override of ADR-162 Decision 2)

**Status**: Active
**Date**: 2026-10-21
**Context**: Pilot subscriptions are made by hand in the Stripe dashboard (`pilot-offer.md` §5). MUT-358 created `billing_accounts`, `billing_subscriptions` and `stripe_events`, but nothing wrote them from Stripe, so `/v1/me` couldn't tell who paid. ADR-160 decision 5 said webhooks re-fetch and a nightly reconcile repairs what they miss. A missed or out-of-order webhook must never leave a payer uncovered. Plan, eng review and outside voice: `.claude/designs/mut-360-stripe-webhook.md`. Basel answered D1–D9 on 2026-10-21 (§7 there).
**Decision**:
1. **One routes file (D1).** `server/src/routes/stripe-billing.ts` holds all three doors:
   - `POST /v1/billing/stripe/webhook`: public, Stripe-Signature is the credential;
   - `POST /jobs/v1/billing/stripe-reconcile`: the nightly Cloud Scheduler job, `X-Job-Token`;
   - `POST /admin/v1/billing/stripe/reconcile`: the operator (`npm run billing:reconcile`), `X-Admin-Token`.
   None is in `PORTAL_ROUTES`. `/jobs/` joins `PORTAL_EXCLUDED_PREFIXES`.
2. **A dedicated job token (D2).** Not Google OIDC, and not the admin token. `jobAuth` in `routes/admin.ts` guards `/jobs/*` with a timing-safe compare of `X-Job-Token` against `MUTABA3A_JOB_TOKEN` (Terraform-generated). The job token opens only `/jobs/*`; the admin token doesn't open it. When the token is unset, `/jobs/*` answers 503 `JOBS_NOT_CONFIGURED` before any compare, because two empty buffers pass `timingSafeEqual` (outside voice OV-4). TD-197.
3. **Reconcile lists every subscription (D3).** Stripe can't filter subscriptions by update time, so the ticket's "updated since its last run" is replaced. One `listProducts`, then `listSubscriptions` (`status: 'all'`, 100 a page, `expand: ['data.customer']`), each through the same `syncSubscription` the webhook uses. It prunes `stripe_events` older than 90 days. It always answers 200 with `{ checked, changed, unlinked, errors, pruned }` once it ran, so a Scheduler retry never repeats a finished scan. An in-process guard refuses an overlapping run with 409 `RECONCILE_RUNNING`. TD-196.
4. **`founderUntil` stays null (D4).** MUT-363 reads the subscription schedule and fills it.
5. **The operator's link always wins (D5).** `billing.saveAccount` fills an empty link and never unlinks or relinks. It returns `{ account, linked, conflict }` with `conflict` one of `CUSTOMER_LINKED_ELSEWHERE`, `USER_HAS_ANOTHER_ACCOUNT` or `UNKNOWN_USER`. The account is still written (country, currency), so a conflict is reported, never thrown. The sync logs it at warn; an unlinked account shows in `billing:unlinked`. `linkAccount` still throws `StateConflict` for the operator's own link; the two conventions differ on purpose. A new link writes `billing.account_linked` (SYSTEM, `source: stripe`) on each owned profile in the same transaction.
6. **Only the subscription sync creates billing accounts (D6).** `syncSubscription` is the one creator, with the currency taken from the subscription (ILS or USD). `checkout.session.completed` passes `client_reference_id` into it as the link hint. `customer.updated` refreshes country and link on an existing account (`billing.getAccount`) and is a no-op otherwise.
7. **Two Stripe budgets (D7).** The webhook gateway uses a 4 s timeout and 0 SDK retries; Stripe's own redelivery is the retry. The reconcile gateway uses 10 s and 2 retries.
8. **Firm coverage is checked at read time (D8, D9).** A subscription tied to a profile's organization covers it only when `profile.ownerUserId` is null (an owner-less operator firm) or equals the payer (`subscription.userId`). This lives in `subscriptionCovers` (`billing/entitlement.ts`), so a later `billing link` or ownership change takes effect on the next `/v1/me` with no re-sync. The mirror stores the metadata organization id as-is when it is UUID-shaped and the organization exists; otherwise it stores null and notes `UNKNOWN_ORG`. The payer's own profiles stay covered as before. `billing.subscription_changed` is audited only on profiles the subscription can cover.
9. **Newer read wins.** A Subscription has no updated time of its own, so `stripeUpdatedAt` is the time our request to Stripe was **sent** (a retrieve, or the list page that carried it). `billing.saveSubscription` locks the row (`FOR UPDATE`), returns `stale` and writes nothing when the stored value is later, and otherwise returns `created`, `changed` or `unchanged` with the row. It builds `billing.subscription_changed` inside the transaction, only when a mirrored field changed (`repositories/billing-audit.ts`; `stripeUpdatedAt` alone is not a change). Two racing first inserts retry once on the unique violation.
10. **The Stripe API version is pinned** to `2026-09-30.endive` (`STRIPE_API_VERSION` in `billing/stripe/gateway.ts`, SDK `stripe@23.0.0`). A test ties it to `Stripe.API_VERSION`, so an SDK upgrade that moves it fails until someone decides. The runbook sets the webhook endpoint to the same version. The period end is read from the items (where it lives since `2025-03-31.basil`), falling back to the top-level field; an invoice's subscription is read from either shape.
11. **Gateway errors never reach a logger whole.** Every SDK failure becomes `StripeGatewayError { code, type, requestId, transient }` (transient: a network error, timeout, 429 or 5xx). Logs carry those fields only. `stripe-signature` and `x-job-token` join the logger's `SENSITIVE_KEYS`.
12. **What the webhook answers.**
    - A bad, missing or old signature: 400 `INVALID_SIGNATURE`, nothing stored.
    - An unhandled type or a livemode mismatch: 200, nothing stored.
    - An event already processed: 200 `duplicate`.
    - A mapping error (`UNKNOWN_TIER`, `UNSUPPORTED_CURRENCY`, `NO_PERIOD`) or a non-transient Stripe refusal: 200, the code recorded on the `stripe_events` row and `processedAt` left null, so a redelivery after a metadata fix is handled again.
    - A transient Stripe or database failure: 500, so Stripe redelivers.
13. **Config.** `STRIPE_SECRET_KEY` (`sk_`/`rk_`) and `STRIPE_WEBHOOK_SECRET` (`whsec_`) are set together or not at all; unset, the three routes answer 503 `BILLING_NOT_CONFIGURED`. A live key is refused unless `API_KEY_ENVIRONMENT` is `live`. Terraform mounts both only when `stripe_enabled` (default false); the job token is always mounted.
**Override log**:
- ADR-162 decision 2 said "a subscription or grant tied to an organization covers that profile". Replaced by: a tied **subscription** covers an owner-less operator firm, or a profile its payer owns; grants are unchanged. Why: the organization id is typed by hand in Stripe metadata, so a wrong but real id must not make a stranger's firm paid (D8). Date 2026-10-21. No production subscription existed, so no live coverage changed.
**Consequences**:
- TD-196 (the full list at scale) and TD-197 (a static job token instead of OIDC).
- The pilot cutover follows the ordered checklist in `docs/operations/pilot-runbook.md` §1.7: tag Products, set customer metadata, add the restricted key and the webhook secret, turn on `stripe_enabled`, run `billing:reconcile` once, verify `/v1/me`, then revoke `pre-billing` grants one person at a time. Apply steps: `server/DEPLOYMENT.md` §6e.
- MUT-362's checkout must pass the existing `stripeCustomerId`, or a returning payer gets a second customer that stays unlinked (`USER_HAS_ANOTHER_ACCOUNT`).
- MUT-363 fills `founderUntil`.
- The API is 1.44.0-mut360, additive.

**Review amendments (qa-reconcile, Basel 2026-10-21)** — nine reviewers (checklist, seven specialists, an adversarial
pass and a red team) found that billing could fail open. Accepted fixes:
1. **Nothing is ever frozen "paid".** A deleted customer's subscription is still mirrored (Stripe cancels it); an
   unmappable one (`UNKNOWN_TIER`, `UNSUPPORTED_CURRENCY`, `NO_PERIOD`) still records Stripe's status, period and
   cancel-at-period-end on the stored tier, and its event stays replayable. As a backstop, `resolveEntitlement` counts a
   covering status only until `currentPeriodEnd` + `PERIOD_GRACE_DAYS` (7); after that it reads as a lapse (READ_ONLY,
   never LOCKED). This amends ADR-162's rule 3.
2. **Links can't be lost to a race.** `saveAccount` and `linkAccount` lock the customer's row, then the person's (one
   order, no deadlock), re-read, write `userId` only when linking, and `saveAccount` retries a first-insert race.
3. **Silent failures are loud.** Stripe 401/403 are transient (the webhook answers 500 and Stripe redelivers once the
   key is fixed); a reconcile that couldn't list answers 502 `RECONCILE_FAILED`; reconcile stops at 200 s
   (`TIME_BUDGET`) under the Scheduler's 280 s deadline; log-based alerts watch the operator messages and Scheduler
   failures (the server has no Sentry client, so logs were all there was).
4. **The cutover can be checked.** `GET /admin/v1/billing/status` / `npm run billing:status` show a person's mirror and
   each owned profile's entitlement with and without grants; a pilot grant is revoked only once the latter is
   ACTIVE / STRIPE. A release guard refuses a checkout whose `stripe_enabled` is off while production runs Stripe.
5. **Hardening.** Only failed signatures spend the per-IP webhook budget (Stripe's IPs are shared); a live server
   takes only `rk_live_` keys; a Payment Link's `client_reference_id` never links; a firm tie the payer doesn't own is
   reported (`ORG_NOT_OWNED_BY_PAYER`); lookup keys are cut to the column's 100 characters.
6. **Not changed:** co-owners still don't count for a firm tie (TD-193, pinned by a test); the job token stays (TD-197).

---

## ADR-166: The Hosted API Offers Only ECB-Priced Currencies Plus JOD; the Gulf Five Are Removed (MUT-388) (Partial Override of ADR-098)

**Status**: Active
**Date**: 2026-10-22
**Context**: MUT-388, epic MUT-278 (plan `~/.gstack/projects/vAWK3-mutaba3a-flutter/MUT-388-plan.md`, eng-reviewed with an outside voice). Basel decided to offer only currencies Frankfurter (the ECB) prices, plus JOD, which was supported before ADR-098 and stays on its peg. AED, SAR, QAR, BHD and OMR shipped in `api-v0.3.13` through `api-v0.4.1` and in phone 0.1.7; MUT-282/283 (their local-app half) never landed in code.

**Decision**:
1. **Four currencies.** `SUPPORTED_CURRENCIES` is `ILS, USD, EUR, JOD` again; `USD_PEGS` is `{ JOD: 0.709 }` and `docs/fx/pegs.json` follows. Every reader of the list (`/v1/me.currencies`, sessions, device sessions, import, `/v1/fx-rates`) narrows with it. ADR-098's machinery stays: every pair through USD, `derived` = either side pegged, `currencies` as plain strings. Bringing a currency back is a list and peg edit.
2. **A stored row can outlive its currency.** Columns are `VarChar(3)`, so nothing refuses a Gulf row written while it was supported.
   - **Reads show its real amount.** `money.ts` keeps `RETIRED_EXPONENT` (AED/SAR/QAR 2, BHD/OMR 3) for `formatMoney` only (review D1). A blank amount would have failed every phone build's whole Recent page: the phone keeps the Gulf enum values, and `MoneyCodec` throws on `""`.
   - **Writes refuse it.** `parseMoney` throws `MoneyParseError` when the currency has no supported exponent, which every write already maps to 422 `AMOUNT_INVALID`, so a PATCH that falls back to the stored currency can't rescale the amount (12.345 BHD became 12345). Moving the row to a supported currency with its amount works.
   - **Filing an inbox entry** in a removed code answers 422 `UNSUPPORTED_CURRENCY` (`assertFilableCurrency`, review D2): filing copies the entry's currency outside the request schema.
3. **A release gate, not a migration.** `server/scripts/currency-rows.sh count` lists every live row outside the list, by profile or (for the inbox) user. Its columns are read from the catalog and its list from `money.ts`; `billing_*` is left out and soft-deleted rows don't count. It exits 3 when there are any.
   - It runs through `npm run db:run` before and after the server release.
   - Rows on the operator's own test profiles and users go with `delete-test-profiles` (review D3). It soft-deletes where a table has `deletedAt`, the app's own delete. Elsewhere it hard-deletes only rows nothing points at; otherwise it lists the blockers and changes nothing. It always previews first.
   - Rows on anyone else's profile stop the release for Basel's call (`docs/operations/pilot-runbook.md` §11).
   - **Portal local mode (signed-out, IndexedDB) is outside the gate.** Such rows read back with their amounts (point 2) and refuse a new amount until their currency changes.
4. **The phone keeps its Gulf enum values, unused.** It offers only what `/v1/me.currencies` lists (MUT-279 D4), so the server is the switch; its parity tests become subset checks. Only lists that don't follow the server change there (the iOS FX widget picker, the release notes).
5. **Analytics contract 2.0.0** (four currencies): a removal is a major version (`docs/analytics/README.md`).
6. **Release order:** web, the gate, then `make release server` (the portal ships with it). No phone release is needed for correctness.

**Alternatives rejected**:
- Removing the enum values from the phone: needs tolerant outbox and preset loaders first and rewrites ~10 test files, for no user-visible gain (Basel, D5).
- A new `UNSUPPORTED_CURRENCY` error for the write guard: every write already maps `MoneyParseError` to a 422 (Basel, D2).
- A hand-listed column set for the gate: the catalog can't drift (Basel, D3).
- Converting stray rows to another currency: the amount would be wrong; they are deleted (test profiles) or decided by Basel.

**Consequences**:
- API 1.47.0-mut388. Clients built against 1.35.0+ keep working: `currencies` is a plain string list.
- A Gulf row left on a real profile still reads right but can't take a new amount until its currency changes; the gate keeps that from happening silently.
- ADR-098 §7's "the web (MUT-282/283) reads it" and "server-ci watches docs/fx" were never or are no longer true: MUT-282/283 were not built, and CI is manual (`workflow_dispatch`).

---

## ADR-167: The Receipts Library: A Receipt Belongs to Its Profile and Waits To Review; Approval Files It in One Transaction (MUT-255)

**Status**: Active
**Date**: 2026-10-22
**Context**: Epic MUT-252 (receipt scanning) needs the original saved the moment it is shared, browsable afterwards, and approved into an expense once its fields are checked. Until now `ExpenseReceipt.expenseId` was required (MUT-42), so a receipt could not exist before its expense, and deleting an expense deleted its receipts and their files. Plan, eng review and outside voice: `.claude/designs/mut-255-receipts-library.md`. Basel answered P1–P4 on 2026-10-22.
**Decision**:
1. **A receipt belongs to its profile; its expense is optional.** A stored `filingStatus` (TO_REVIEW / FILED) sits beside the upload status, with a DB CHECK: FILED exactly when there is an expense. MUT-308 widens the CHECK to "or a bill" and adds `billId`; MUT-255 keeps the "already filed" answer in one place (409 `CONFLICT`, `reason: RECEIPT_ALREADY_FILED`, with `details.expenseId` naming where it is filed, so a client whose first 201 was lost can still open the expense). The expense foreign key stays RESTRICT (expenses are only soft-deleted).
2. **Rolling-deploy-safe defaults.** `filingStatus` defaults to FILED and `receivedOn` (the upload day in the profile timezone) to the UTC day, so the previous revision's MUT-44 inserts pass during the deploy. The library route sets both itself.
3. **What was read and what was approved are both kept.** `suggested` is the firm-books brief's `ReceiptSuggestion` (§6.1); unknown fields are dropped, not refused, so a newer reader never breaks approval. `approved` snapshots what approval wrote (minor units, like the suggestion). The edit rate per field is an operator route, `GET /admin/v1/receipts/edit-rates`, counts only.
4. **Approval is one transaction** (`expenseReceipts.fileAsExpense`): lock the receipt, refuse unless READY and To review, insert the expense, then a conditional update files the receipt; zero rows throws so no expense is orphaned. It is idempotent (`Idempotency-Key`). Its checks are POST /v1/expenses's own (`prepareExpenseCreate`). MUT-307's approval and MUT-312's closed month plug in between the lock and the insert.
5. **Hosted only (P1).** `/v1/receipts*` is mounted in `app.ts`, not in `PORTAL_ROUTES`. On the hosted server, deleting an expense sends its READY receipts back to To review (in the expense delete's transaction) and soft-deletes unfinished uploads; signed-out local mode, which has no library, still deletes them all (`PortalRouteDependencies.receiptsLibrary`). Local import keeps To-review receipts and their files. Local format 2 → 3. *(Since MUT-389, on the hosted server only while `RECEIPTS_LIBRARY` is on.)*
6. **Limits (P3, amended in qa-reconcile).** 429 `RATE_LIMITED` with `reason: TOO_MANY_PENDING_UPLOADS` at 20 unfinished uploads per profile in 24 hours (P3 said 422; Basel chose 429 on 2026-10-22 so the key stays free); 30 upload starts a minute per person (429). The idempotency layer now releases a key on any 429, as on a 5xx: nothing was done, so the same request may be sent again with it. A replayed upload start answers the original, so `POST /v1/receipts/{id}/upload-url` re-signs an expired URL.
7. **Filing onto an existing expense** is MUT-389 (P2); see "Extended by MUT-389" below.
8. **Release (P4).** The server change ships to production only together with the first screen that shows the library (MUT-260 or MUT-258). The portal deploys before the server (local format 3). *(Amended by MUT-389: the hold is now the `RECEIPTS_LIBRARY` switch, below.)*

**Extended by MUT-389 (2026-10-22, Basel's answers D2–D5 in `.claude/designs/mut-389-file-receipt-to-existing-expense.md`):**
- **Filing onto an existing expense** (`POST /v1/receipts/{id}/file`, `expenseReceipts.fileOntoExpense`) is decision 4's transaction without the insert. It uses the same receipt lock and conditional update (shared helpers `lockToReviewReceipt` / `markReceiptFiled`). Between them it locks the expense `FOR NO KEY UPDATE` (the row-lock rule at :1961), re-reads it live on the profile, and counts its READY receipts against `MAX_RECEIPTS_PER_EXPENSE` under that lock, so two filings can't both take the last place and none lands on a deleted expense.
- **Filing approves nothing.** `approved` / `approvedAt` / `approvedByUserId` are never written by it. A receipt approved earlier and unlinked by an expense delete keeps that approval (D2). A suggestion sent with the filing replaces the stored one, as approval's does (D4), except on a receipt that keeps an earlier approval: its reading stays, so the edit-rate pair never changes after the fact (qa-reconcile D1, 2026-10-22). The two 404s carry `details.reason` `RECEIPT_NOT_FOUND` / `EXPENSE_NOT_FOUND`; `RECEIPT_ALREADY_FILED` joins the published 409 reasons.
- **Answers** 200 `{ expense: ExpenseDetail, receipt }`: the expense with its receipts, since the expense itself is unchanged (D3). Already filed, even on the requested expense, is decision 1's 409 with `details.expenseId`.
- **Release (replaces decision 8's hold).** `RECEIPTS_LIBRARY` (Terraform `receipts_library_enabled`, default false) mounts `/v1/receipts*` and switches expense delete to unlink; unset, the API behaves as before MUT-255, so main deploys with the library dark (D5). It is turned on with MUT-260 or MUT-258 and left on.
- **Known gap — resolved by MUT-397 (2026-10-24).** The MUT-44 completion now goes through `expenseReceipts.completeOnExpense`, which counts and marks READY under the same expense lock, so completions and filings serialise and an expense ends at exactly 10 READY. Proven by forced-overlap Prisma tests (`store-prisma-receipt-complete-lock.test.ts`, waiters counted transitively through `pg_blocking_pids`).
- **Lock order (MUT-397).** For receipts that sit on an expense: the expense first, then the receipt (`expenses.softDelete`, `completeOnExpense`). Filing locks its receipt first and then the expense, which is deadlock-free only because that receipt has no expense yet, so neither a delete nor a completion can hold it.
- **Invariant (MUT-397).** A PENDING_UPLOAD receipt's `expenseId` never changes: filing needs READY and an unlink touches READY rows only. That is also why the library's own completion (`POST /v1/receipts/{id}/complete`, receipts with no expense) needs no expense lock. A feature that attaches a pending upload to an expense must revisit both.
**Consequences**:
- A deleted expense no longer takes its receipts with it on the hosted server; they reappear under To review (since MUT-389, only while `RECEIPTS_LIBRARY` is on).
- Once a To-review receipt exists, the previous server revision cannot read that row (Prisma P2032): rolling back means rolling forward, or moving the To-review rows aside first (DEPLOYMENT.md).
- The local format number is shared with MUT-302/307/308; whoever lands next takes 4.


## ADR-168: The Entries Feed Also Lists by Money Date, With Index-Bounded Day and Logged-Since Filters (MUT-390)

**Status**: Accepted (2026-10-22, MUT-390; decisions D1–D6 from the eng review, Basel's answers)

**Context**: Recent grouped entries by the day they were logged, so seven entries Basel typed today for seven different dates all sat under "Today" (MUT-391). Recent must group by the day money moved. The feed (ADR-093) only pages by `(createdAt, id)`, and a phone-only regroup would miss an expense logged ahead with a date that has since arrived, or an old entry edited into the window. Basel chose the exact server fix (D4).

**Decision**:
1. **A second order.** `GET /v1/entries?order=occurredOn` lists newest money day first, then newest logged, then id: each kind's own money date (expense and conversion `occurredOn`, received payment `receivedOn`, Owed `postingDate`), so a future-dated entry sorts above today. `order=createdAt` stays the default, byte for byte. All four dates are NOT NULL, so no row lacks one.
2. **Filters, each only with the order whose index bounds it (D5).** `occurredFrom` (money date ≥) with `order=occurredOn`; `occurredBefore` (money date <) with `order=occurredOn`, or with the default order together with `loggedSince`; `loggedSince` (instant ≥, Z or an offset) with the default order. Any other combination answers 422 naming the field: it would walk a firm's whole history to fill its last page. `loggedSince` may reach at most 31 days back (`LOGGED_SINCE_MAX_DAYS`, review fix): it is the index range of the default-order read, so an older value would walk the history too.
3. **Cursor (D1).** The codec lives in `entries/merge.ts`: the default order keeps `pagination.ts`'s `{t, id}` unchanged, the money-date order adds `k: 'o'` and the day. A cursor from the other order answers 422 `field: cursor`, both ways.
4. **Queries.** Same fan-out as ADR-093 (one organization at a time, 4 kinds in parallel). Each bound is its own `AND` entry, so a filter and the cursor on one column never overwrite each other. The money-date cursor is `day <= o AND (day < o OR (createdAt <= t AND (createdAt < t OR id < i)))`, the leading conjunct being the index range. New indexes `(organizationId, occurredOn desc, createdAt desc, id desc)` on expenses and conversions, `(organizationId, receivedOn desc, createdAt desc, id desc)` on payments, `(organizationId, origin, postingDate desc, createdAt desc, id desc)` on receivables; the EXPLAIN test pins each.
5. **Cursors fail as 422, never as a wrong page or a 500 (review).** A cursor whose instant is no date is refused; each store also refuses the other order's cursor (`createdAtCursorOf`, `moneyDateCursorOf`), and the default order leaves malformed cursors to `pagination.ts`, so their error is unchanged byte for byte.
6. **Date edits between pages (D3).** By money date the sort key is editable, so an entry whose date changes between page reads can show twice or be missed until page one is read again. Documented on the route; clients dedupe by id and re-read page one after an edit.

**Alternatives considered**:
- **Regroup on the phone only (D4 B/C).** Rejected by Basel: misses future-dated rows logged over a week ago and dates edited into the window.
- **Freeze pages server-side with the first page's time (D3 B).** Rejected: a field and an `updatedAt` filter on every query, and it still misses rows moved newer than the cursor.
- **Allow every filter with either order.** Rejected: residual-only filters force a whole-history scan on the last page.
- **The same order on `/v1/inbox`.** Not needed: Unsorted is not grouped by day.

**Consequences**:
- Four more indexes on hot insert paths; plain `CREATE INDEX` locks each table for well under a second at pilot size.
- The phone (MUT-391) reads the window with `order=occurredOn&occurredFrom=<cutoff>` and the backdated card with `loggedSince&occurredBefore`, dedupes by id and versions its cache key; the server deploys first.
- Future-dated Owed income is MUT-392.
- API 1.49.0-mut390.

## ADR-169: An Owed May Be Dated Up to Ten Years Ahead and Counts From Its Own Date; Expenses Get the Ten-Year Ceiling (MUT-392)

**Status**: Accepted (2026-10-22, MUT-392; decisions D1–D4 from the eng review, Basel's answers). Amends ADR-038's MUT-65 addendum (income `occurredOn` was past-only) and MUT-223's "an Owed re-date keeps its due date".

**Context**: Basel wants to log money that hasn't moved yet: Owed income dated next month, an expense he'll pay in three days. The server refused any future income date (`pastMoneyDate`), expenses had a floor but no ceiling at all, and the phone's pickers stopped at today. Split out of MUT-390 (its D6).

**Decision**:
1. **The rule by kind.** Owed income may be dated up to ten years after the organization's today (`DAYS_IN_FUTURE_LIMIT`, the ceiling payments and agreements already use) and not more than ten years before it. Received money, settle's `paidAt`, payments and conversions stay past-only: the money has moved. One check, `incomeMoneyDate(raw, kind, today, field)` in `income/compose.ts`, serves `POST /v1/income`, `PATCH /v1/income/{id}` (via `redateTo`, which now takes the kind) and file-as-income.
2. **PATCH checks the shape first, the bounds once the kind is known (D4 of the plan).** A malformed date is 422 before any read; an unknown id with a well-formed future date is 404.
3. **A future Owed counts from its own date, or once money moves (D2; review D1, D2).** `countsOn(r, today) = r.origin !== 'ADJUSTMENT' || r.postingDate <= today || r.paidMinor > 0n || r.creditedMinor > 0n` in `summaries/compute.ts`: until its date, and while no payment or credit has landed on it, an Owed is in no bucket (owed now, overdue, due today, not yet due), not in a matter's posted, paid or credited totals, and adds no customer row or currency block to the organization and customer summaries. On its day it joins them and goes overdue by its due date. Computed on read, so no job runs. Only an Owed: an IMMEDIATE installment on an agreement Malafat dated ahead posts with that future postingDate (`postingDateFor`) and keeps counting at once, as it always has (review amendment; the first cut applied the rule to every origin). Once a payment or credit lands on it, it counts at once, whatever its date, so a payment never drops out of a paid total. GET /v1/receivables keeps its status logic: a future Owed reads by its due date as before (a not-yet-counted status is a follow-up).
4. **A re-date that passes the due date moves it (D3).** When the new date is after the stored due date, the due date becomes EOM_15 of the new date (`dueDateAfterRedate`), in the same versioned write (`redateAdjustment(..., postingDate, dueDate?)`); the audit row adds `dueFrom`/`dueTo`. Every other re-date keeps its due date, as MUT-223 decided.
5. **Expenses get the ceiling (D4).** `expenseOccurredOn` adds `assertNotAbsurdDate`: create, PATCH when the date changes, inbox filing (which now calls the same function) and receipts approval refuse more than ten years ahead with 422 bound future.
5a. **Nothing is refused once money moves; guards on the edges (review D2, D4).** An Owed may be settled before its date, and moved ahead after a settle or part-payment: it then counts from the first payment or credit (decision 3). An explicit `dueDate` on create and file-as-income may not be before `occurredOn` nor past the ten-year ceiling. Inbox capture gets the ten-year ceiling leniently, from UTC's tomorrow, mirroring MUT-227's floor.
6. **Clients follow.** The portal's date `max` and form checks go by kind (Received today, Owed and expenses today + 3660), and say "more than ten years ahead" for the ceiling; its re-date note says where the due date moves. The phone's pickers use one rule, `allowsFutureDate` (expense, or Owed on a profile); a kind switch puts a future date back on today, and Save is blocked for any leftover.

**Alternatives considered**:
- **Count a future Owed at once (D2 B).** Rejected: owed now would include work not yet done.
- **Keep the due date on every re-date (D3 B), or refuse a re-date past it (D3 C).** Rejected: an entry due before its own date reads overdue on its first day; refusing blocks a normal edit.
- **Leave expenses without a ceiling (D4 B).** Rejected: a typo year (2062) saved silently, invisible in every month view.

**Consequences**:
- Every existing total is unchanged: before this no Owed could have a future posting date, and other origins are untouched by `countsOn`.
- **Rejected (review D2): refuse moving a paid Owed ahead (409) and settling a future Owed (422).** Counting once money moves keeps every payment in the paid totals without blocking an edit.
- The Unsorted inbox accepts a future date at capture up to the lenient ten-year ceiling; filing applies the destination's rule.
- The archive guard still counts a future Owed as outstanding: it is work still to be paid.
- The D3 due-date move also fires when an overdue Owed moves to a later past date; clients show `dueDate` from the PATCH response.
- Release the API before the phone: an older API refuses a future Owed with 422, which the phone shows and keeps in its outbox.
- API 1.51.0-mut392.

## ADR-170: Self-Service Billing: Server-Made Checkout on the Person's Own Customer, Refusals Before Stripe, Prices from Stripe Lookup Keys, Countries from a Server File (MUT-362)

**Status**: Active
**Date**: 2026-10-22
**Context**: After MUT-358 (entitlements) and MUT-360 (the Stripe mirror), nobody could start, change or cancel a subscription without the operator. Stripe's hosted pages have no Arabic. Plan, eng review (D1–D9) and design review (DR1–DR13): `.claude/designs/mut-362-self-service-billing.md`.
**Decision**:
1. **Three person-level, session-only routes** in `server/src/routes/billing.ts`, outside `PORTAL_ROUTES` and never billing-gated: `GET /v1/billing` (one read: subscription, trial, catalog, country rules), `POST /v1/billing/checkout-session`, `POST /v1/billing/portal-session`. Ten session requests a minute per person.
2. **A separate write door** (`billing/stripe/checkout-gateway.ts`); MUT-360's read-only `StripeGateway` is unchanged (D1). The one restricted key gains Write on Customers, Checkout Sessions and Customer portal (D2).
3. **The person's own customer** (D3): the linked account's, else one listed by exact email whose `metadata.mutaba3a_user_id` is the person, else created with that metadata and idempotency key `mut362-customer-<userId>`. No `billing_accounts` row is written there (ADR-165 D6 holds: only `syncSubscription` creates one).
4. **Refusals before Stripe**, in this order: a live subscription (`active`, `trialing`, `past_due`, `incomplete`); `unpaid` (pay the open invoice in the portal, D6); `paused` (contact us); no owned profile; all Malafat; all under a no-expiry grant (D5); a person outside the consumer countries (AC2). Each is an existing code plus `details.reason` (the PATTERNS rule), registered in `CONFLICT_REASONS` / `VALIDATION_REASONS`; `BILLING_NOT_CONFIGURED` + `PRICES_NOT_SET`; the one new code is `STRIPE_UNAVAILABLE` (502). A linked customer Stripe no longer has is `BILLING_ACCOUNT_NEEDS_HELP` with an ids-only warn (D7).
5. **Prices are the Stripe catalog**: lookup keys `freelancer_list_{monthly|yearly}_{ils|usd}`, a currency sold only with both prices in that currency and interval, cached ten minutes. ILS for Israel, USD elsewhere.
6. **Countries**: `server/src/billing/billing-countries.json` (`consumerCountries`, `customTaxIdCountries`), parsed at boot. It lives beside the code, not in the repo's `config/`, because the API image's build context is `server/` and only `src/` reaches it. It ships with no consumer country until MUT-355.
7. **Checkout parameters**: `mode=subscription`, `customer_update` address/name auto, `automatic_tax`, `billing_address_collection=required`, `client_reference_id` and `subscription_data.metadata.mutaba3a_user_id`, `locale=auto`, an Arabic + English `custom_text`, `expires_at` one hour, tax IDs required (`if_supported`) for a business outside the consumer list, a required `business_tax_number` field for IL/JO businesses outside it (optional inside).
8. **Return from Checkout** polls `/v1/billing` and `/v1/me` (2 s, up to 30 s); no confirm endpoint (D4). The webhook and reconcile stay the only writers. The Customer Portal's return (`?billing=true&portal=returned`) refetches the same way and stops at the first change (release-QA saw the first read beat the webhook by ~0.7 s).
11. **A Customer Portal cancel is `cancel_at`** (amends MUT-360's mirror): since `2026-02-25.clover` the portal sets `cancel_at` to the period end with `cancel_at_period_end` false, so `cancelAtPeriodEnd` mirrors either; a `cancel_at` past the period renews once more first.
9. **Operator flag** (D9): `GET /admin/v1/billing/status` `countryCheck` flags a linked payer billed outside the consumer countries with no tax ID.
10. **Portal**: Settings › Billing is the account menu's drawer (DR1–DR13), Arabic first; Stripe's English pages come only after our own explanation (AC4).
**Consequences**:
- API 1.52.0-mut362 (MUT-392 holds 1.51.0).
- Nothing is sold until Basel creates the four prices, configures the Customer Portal, widens the key and fills `consumerCountries` (before-release.md); until then the drawer says "Subscriptions open soon" and the POSTs refuse.
- Release-QA drives Stripe's real hosted pages in the sandbox (`portal-live` app, D8 B); TD-201.
- A person's own card path can't run live while the consumer list is empty; TD-202.

**Amendment (2026-10-23, /qa-reconcile review, Basel's answers D1–D4)**:
- **Stripe decides before money moves.** Once the customer is known, the route reads Stripe's own subscriptions for it (`subscriptionsOf`, status all) and applies the refusals again, then expires the customer's other open Checkouts (`expireOpenCheckouts`) before creating one. The mirror alone could be late (a webhook over 30 s, a failed one) or blind (an untagged product), and two tabs could each pay. A live mirror row past its period plus PERIOD_GRACE_DAYS is stale and no longer refuses (the entitlement's own rule).
- **What Billing shows:** `currentSubscription` picks the most current open subscription (active, trialing, past_due, incomplete, unpaid, paused, in that order), never a cancelled row over a live one. `incomplete` is its own "payment pending" panel. A paid entitlement with no row to show still offers Manage billing.
- **Sellable prices** (`sellableFactOf`): recurring every 1 month or 1 year, VAT-exclusive, on a product tagged `tier: freelancer`, with an amount; the session sets `adaptive_pricing: { enabled: false }`. The catalog caches a failure for a minute and makes one Stripe call at a time.
- **D2 Keep the trial:** subscribing during the free trial sets `subscription_data.trial_end` to the person's trial end when that is at least 48 h away (Stripe's minimum); the Subscribe step says when the first charge falls.
- **D3 Tax number on invoices:** on `checkout.session.completed` the sync copies the `business_tax_number` custom field to the customer's `invoice_settings.custom_fields` ("Business tax number") through the write door; a failed copy is an error, so Stripe redelivers. The D9 check counts it as a tax ID.
- **D4 Follow the server:** `GET /v1/billing` carries `coveredProfileIds` (the profiles the person created); the drawer uses it, and tells a co-owner that shared profiles are covered by their creator's plan (TD-193 stays open for co-owner billing).
- **Errors:** a refusal Stripe will repeat (invalid request, permission, authentication, idempotency) is `CONFLICT` + `BILLING_ACCOUNT_NEEDS_HELP`, logged at error level; `resource_missing` blames the linked customer only when Stripe names `customer`; only the rest is `STRIPE_UNAVAILABLE`. The audit after Stripe made a session is best effort (logged), and the customer idempotency key carries a hash of the email and name.

---

## ADR-171: The MTB3A Logotype Is One Outlined SVG, Shipped Once From src/assets/brand and Shown as a Mask Over the Ink (MUT-401)

**Status**: Accepted (2026-10-23, MUT-401; eng review D1–D9, Basel's answers). Epic MUT-400 renames the service MTB3A in English; Arabic stays متابعة.

**Context**: Claude Design drew the Latin logotype by outlining Thmanyah Serif Display Bold. The mark ships as two theme files (`mark.svg`, `mark-dark.svg`) because it is multi-colour. The logotype is one colour, the portal sends a strict CSP on every response including images, and the kit's numbers only mean something if the file's frame is the letters.

**Decision**:
1. **One file, coloured by CSS (D7).** `src/assets/brand/wordmark.svg` is a stencil with one opaque fill of no meaning. MUT-402 shows it with `mask-image` over `var(--ink)`, with `role="img"` + `aria-label`, a forced-colors rule and a print rule. There is no dark file.
2. **One copy (D3).** The SVG lives only in `src/assets/brand/`; `docs/brand/wordmark/` keeps the kit README, the store artwork and the Claude Design pages. A test fails on any `wordmark*.svg` under `docs/brand/`. This narrows MUT-401's "files under docs/brand/wordmark/".
3. **Bytes as delivered, guarded (D4, D8).** No hand edits. `wordmark.test.ts` checks outlines only; no `style`, `class`, event, font or external-link attribute; one opaque fill; no stroke or opacity; a viewBox tight to the ink (within 1% on every edge). A file that fails is re-exported from Claude Design.
4. **Pins (D5, D9).** `src/assets/brand/brand.sha256.json` pins the mark, the nine web icons and the logotype, so "the icon and the mark are unchanged" is tested.
5. **Lockup tokens wait for MUT-402 (D1).** The numbers (H = 0.40 M, gap 0.60 H, clear space 1 H, H ≥ 12 px, W = 5.104 H, Arabic 1.25 H, 0.16 H markDot separator) live in `docs/brand/wordmark/README.md` until the CSS that reads them lands.

**Consequences**: The logotype can't drift from the ink token or from the theme. MUT-402 owns the mask rendering and its accessibility rules. The export's `tokens/` and `favicon.svg` are older than the repo's and are not imported, and its pre-rename `Feature Graphic.dc.html` is left out. The Play feature graphic is kept as 24-bit RGB (Google Play refuses alpha). Licence: Basel reports that Thmanyah confirmed commercial use of the outlined logotype (2026-10-22). The written record is still to be attached, so the guardrail stays open on MUT-402.

**Hardening (MUT-401 review, 2026-10-23)**: the SVG checks are allowlists (elements svg/title/desc/metadata/g/path, a short attribute list per element, metadata holding only the C2PA base64), so kinds nobody listed also fail. The frame check bounds the ink by end and control points. The path parser throws on anything it can't read instead of hanging the suite. The one-copy check matches the logotype's bytes under `docs/brand/`, `public/` and `src/hosted/public/`. The pinned SVGs keep LF through `.gitattributes`.

**Amendment 1 (2026-10-23, MUT-402 design review D6)**: item 1's "over `var(--ink)`" is corrected to "painted in `currentColor`". There is no `--ink` custom property (the app's ink is `--text` = `--m-ink`), so `var(--ink)` would paint nothing. Forced colours name a system colour instead; see ADR-173.

## ADR-173: The Product Is Named MTB3A in English and متابعة in Arabic Through One BrandName, Sized by One markSize, Painted in the Text's Colour (MUT-402)

**Status**: Accepted (2026-10-23, MUT-402). Eng review D1–D3 and R1–R6, design review D3–D15, all Basel's answers. Epic MUT-400. ADR-172 is claimed by the MUT-115 plan.

**Context**: MUT-401 delivered the outlined MTB3A logotype (ADR-171). The landing header, the portal and the server still said "Mutaba3a" in English, and the lockup was live text sized by each surface's own CSS. Arabic is the default language (ADR-077), so the lockup's size has to keep the Arabic name readable. The portal sends a strict CSP and has no service worker.

**Decision**:
1. **One name component.** `src/components/brand/Logotype.tsx` exports `Logotype` (a masked `<span role="img" aria-label="MTB3A" lang="en">`) and `BrandName` (the logotype in English, live متابعة with `lang="ar"` in Arabic). The landing lockup is the active name, the markDot separator and the other name. `dir` orders them, and a phone at 480px or below hides the `.wordmark-other` pieces. Plain spaces between the items keep the link's accessible name two words; flex layout drops them visually.
2. **One size source.** M reaches the CSS only from `Wordmark`'s `markSize`, as `--wordmark-mark` in px, through the CSSOM (the CSP allows it). H = 0.40 M is declared on the lockup and on each name, never on `:root`. The sizes are landing bar 32, portal pages 40, sidebar 32 and default 30: all at least 30, so the logotype is never under its 12px minimum, and the Arabic name keeps its 16/20px. The old lockup gap and type rules are deleted.
3. **Tokens.** The kit's numbers are the `wordmark` block in `mutaba3a.tokens.json`, mirrored as `--m-wordmark-*` with drift tests. The block adds a 3px separator floor (a kit exception) and a print ink that is the light ink in every theme.
4. **Paint.** The logotype is a mask over `background-color: currentColor`. In forced colours the mask opts out of forcing, and `currentColor` is then the unforced ink (Chromium, caught by `web.brand.mtb3a-name`). So the logotype and the dot name the system colour their live text gets: `LinkText` (`VisitedText`) inside a link, `CanvasText` elsewhere. The mark gets a 1px square `CanvasText` ring; never border-radius, because the mark is not a disc. The whole lockup prints in the light ink.
5. **Loading.** The box always has its full size. The portal's `hosted.html` preloads the hashed file with `crossorigin`, because mask images are fetched in CORS mode and a mismatched preload downloads twice; a source contract test pins it. The landing gets no preload: `index.html` also serves `/app`, and the PWA precaches the file. A first landing visit paints MTB3A a moment late into its reserved box.
6. **Copy.** Every English leaf says MTB3A ("an MTB3A", read letter by letter). `brandName.test.ts` fails on an English "Mutaba3a" or Latin in Arabic. The privacy policy is exempt until its next revision, and the dated terms are frozen files; both carry authoring notes. `hosted.html` opens on متابعة, and `PortalTitle` names the tab per language. `client_name` is MTB3A. Downloads are `mtb3a-…`, and imports go by content.
7. **Server.** "MTB3A Financial API", `1.52.1-mut402` (the next patch after main), and "the MTB3A portal" in the three CROSS_SITE_REQUEST messages.

**Consequences**: Only the active language's name changes with the page language; identifiers, storage keys, the records `kind` and campaign values keep "mutaba3a". The `/app` shell still sets no tab title of its own (TD-207). The 375px English bar was already clipped on main and still is (TD-206). The one-request check runs in Chromium only; a Safari double fetch would cost 9.6 KB per cold visit (R6). The phone (MUT-403), the stores (MUT-404) and Malafat (MAL-1305) follow.

## ADR-174: Mail Goes Through One Mailer Port With a Digest-Only Send Log; Resend's Webhook Is Trusted Only for Our Own Domain (MUT-359)

**Status**: Accepted for the build (2026-10-23, MUT-359, autonomous run on Basel's "go"). Decisions D1–D24 in `.claude/designs/mut-359-resend-mailer.md` §9 are **pending Basel's confirmation**. Builds ADR-159 §5.
**Context**: ADR-159 chose Resend, on Barmajiyat's account that Malafat also sends from, behind a `Mailer` port. Production runs one Cloud Run instance (TD-017) that restarts on every deploy. Public routes that mail links (MUT-366) are coming, so mail must be cheap to abuse-limit and must never leak a link into logs.
**Decision**:
1. **One port, four transports.** `server/src/email/`: callers send `{ to, template, locale, vars, idempotencyKey }`; the transport is `resend` (fetch, the mail and nothing else, so no tracking option can ride along), `log` (development), `memory` (tests, QA, `GET /admin/v1/dev-outbox`) or `noop` (default). `log` and `memory` are refused in production; Terraform offers only `noop` and `resend`.
2. **Templates are server-rendered records, en + ar.** Arabic is `<html lang="ar" dir="rtl">`; inline styles, system fonts, AAA inks; links as buttons plus a `<bdi dir="ltr">` copy; no image, pixel or fetched resource; no amount, currency or date (pinned by `templates.test.ts`). The From display name is "MTB3A" in both languages for now (an Arabic display name waits for the live check, TD-210).
3. **The send log is digests only** (`email_deliveries`: sha256 of the idempotency key and of the recipient, template, locale, status). It backs idempotency (a key sends once; a FAILED, UNCERTAIN or crashed-PENDING key may be retried), the global cap (`MAIL_DAILY_CAP`, required with resend, with 10 % reserved for reset and finish-setup mail) and a per-recipient cap (10/24 h, the password notice exempt). A timed-out send is UNCERTAIN and keeps counting. No database lock: the mailer serializes its claims in process, valid while production runs one instance (TD-017). Pruned after 30 days.
4. **Suppression.** `POST /v1/email/resend/webhook` verifies the Svix signature (hand-written, 5-minute tolerance), and only for events sent **from our own mail domain** suppresses the recipients of a Permanent bounce or a complaint. It works whenever its secret is set. Under `/v1` with `security: []`, like the Stripe webhook, so the public-surface pins list it.
5. **Never fails the caller.** `send` returns an outcome (`sent`, `duplicate`, `suppressed`, `refused`, `capped`, `disabled`, `failed`) and throws only on a caller bug. The password notice is awaited after the commit and never changes the answer.
6. **Unowned domains.** The mailer refuses recipients on `mutaba3a.app`, and config refuses it as the sender or reply-to.
7. **Operations.** DNS records live in the frontdoor stack (beside the zone); `email:check` checks DNS without a key (the preflight) and Resend's verification, region and tracking with a separate full-access key (`--api`, the operator). `guard_mailer_release` refuses a release that would switch mail off. Two log-match alerts (cap reached, provider failing) replace mail-based alerting.
**Rejected**: the `resend` and `svix` packages (two small surfaces); an in-memory cap (reset by every deploy); a Postgres advisory lock (one instance; the in-process chain is enough until TD-017 lifts); a route outside `/v1` (it would escape the public-surface pins); a new `email` Terraform stack (Basel's comment: the zone is in frontdoor).
**Consequences**: merging changes nothing in production (`mailer = "noop"`). MUT-366/367/306/414/419 add templates or call `send`; a new template must be added to `TEMPLATE_IDS`, `TemplateVars` and `copy.ts` in both languages or the build fails. Live sending, and the AC that a real mail reaches Gmail and Outlook, wait for Basel's go-live (DEPLOYMENT.md §6f). Follow-ups: TD-208 (unsuppress), TD-209 (reply-to and DMARC mailboxes off the apex), TD-210 (Arabic From name).

**Amendment 1 (2026-10-25, Basel):** mail is sent from a subdomain of the apex, not the apex. Resend's domain is `notify.mtb3a.com`; `config/hosts.json` names it as `mailSubdomain` and everything (the sender, Resend's DKIM and return-path records, `email:check`) derives `<mailSubdomain>.<apex>` from it. DMARC stays on the apex, where it governs the subdomain. The webhook's own-domain filter follows `MAIL_FROM_ADDRESS`, so it needs nothing new. Why: sending reputation stays on the subdomain, away from the apex.

## ADR-175: Signup and Recovery Mail Links That End on the ADR-088 Redeem; Same Answer, Same Floor, Server-Verified Turnstile (MUT-366)

**Status**: Accepted for the build (2026-10-23, MUT-366, unattended run on Basel's "go"). Decisions D1–D18 in `.claude/designs/mut-366-signup-recovery-routes.md` §4 are **pending Basel's confirmation**. Builds ADR-159 §3–§7; amends ADR-037 decision 1 and ADR-088 as ADR-159 allowed.
**Context**: GA needs strangers to create an account and anyone to recover a password without the operator. ADR-037 §4 forbids revealing whether an account exists; ADR-088 §5 allows exactly one way to mint a session.
**Decision**:
1. **Two public routes, both mailing a link.** `POST /v1/signups` (behind `SELF_SIGNUP_ENABLED`, 404 while off, kept in the contract) and `POST /v1/account-recovery` (never behind it). Every link ends on `/setup` and `POST /v1/account-setup`; neither route nor the redeem signs anyone in.
2. **SIGNUP links are bound to an address, not a person.** No user row exists until redeem. The token holds the normalised address and the page's language; CHECKs keep the shape. Issue and redeem serialise per address on a transaction-scoped advisory lock; a new link cancels the address's open ones; a redeem claims only while nobody holds the address, so any number of links yields at most one account. The redeem creates the user, personal profile, membership, trial (D1: the column `billing.setTrialStart` writes, in the same transaction) and terms acceptance at once.
3. **Recovery reuses person links.** RESET for 1 h (ADR-088 §3: nothing changes until used), SETUP for 24 h to an account that never set a password; `mailed` links verify the address when redeemed (`users.emailVerifiedAt`).
4. **The same answer for every address.** `202 {status:"sent"}`, no earlier than a floor (3000 / 1500 ms) on a monotonic clock, mail sent inside the request. Refusals that depend only on the request answer at once: 404 (switch), 403 cross-site, 429 per client address (10/h), 422 body, 403 `CHECK_FAILED`, 429 per email address (1/min, 5/day; counted only after the check, regardless of whether an account exists).
5. **Turnstile is verified by the server and fails closed.** Cloudflare's published test secrets are answered locally (no network in dev, CI, QA); production refuses a test secret and refuses to start without a real one once mail or signup is on.
6. **Seams.** `signupAccountOutcome` decides the new account's status and trial (MUT-367: PENDING_REVIEW with no trial for webmail and unverified domains); the domain screen goes before anything is issued in `POST /v1/signups`.
**Rejected**: creating a pending user at signup (unverified addresses would fill `users`); a Scheduler job for pruning (one instance, the mail log's hourly timer is enough); answering the switch-off with the route absent (the contract would depend on the environment); a session after the SIGNUP redeem (ADR-088 §5).
7. **Code review (before merge).** The Turnstile idempotency key is generated per check, never the client's `X-Request-Id` (one solved token could otherwise be replayed). A recovery link cancels only earlier mailed links, so a stranger's request can't kill the operator's open link; redeeming any link cancels the person's others. Each branch's mail is raced against the floor and finishes in the background, and a store failure in a branch is logged and still answered with the same 202. Turnstile requires the form's exact action. Any server with `MAILER=resend` must name a Turnstile secret, staging included.
**Consequences**: merging changes nothing in production (`mailer = "noop"`, signup off). Recovery goes live with mail, which now also needs the Turnstile secret (before-release.md). The limiters are in process (TD-017). TD-211 (setup copy for SIGNUP until MUT-368); TD-212 resolved before merge. The portal's local snapshot moved to format 4 (`people.emailVerifiedAt`).
## ADR-176: A Received Capture Answers the Profile's Payment Count; the Phone Owns the Milestone Ladder (MUT-340)

**Status**: Accepted (2026-10-23, MUT-340). Basel's M1–M3, eng review R1–R12. ADR-174 is MUT-359's and ADR-175 MUT-366's.

**Context**: MUT-340 celebrates income milestones on the phone. Basel chose the count of payments received (1st, 10th, 50th, 100th, 250th, 500th, 1000th), the same in every currency, played once after the save that crosses it. Nothing on the server exposed a payment count; the `PAY-YYYY-NNNN` number is per year and keeps reversed payments. The phone saves through an outbox, so the count has to come back with the upload, not with Save.

**Decision**:
1. **Counted on write.** `POST /v1/income` (received) answers `receivedCount`, the organization's POSTED payments of every origin, counted in the capture's transaction after the payment counter upsert. That upsert row-locks `(organization, year)`, so concurrent captures get distinct counts.
2. **Fixed by idempotency.** A replay with the same Idempotency-Key answers the stored body, so a retried upload never crosses a milestone twice.
3. **The ladder is the phone's.** The server only reports the count. Which counts are milestones, and whether one was already shown on this install, live in the app.
4. **POST-only schema.** `IncomeCaptureResponse` extends `IncomeResponse`; no other route advertises the field.
5. **Nothing materialized.** No milestone table: one indexed count per Received capture.

**Consequences**: Filing an Unsorted income, Malafat's API-key payments and Siri's direct posts count toward the total but carry no count, so they never trigger a celebration. The count uses the `(organizationId, …)` prefix indexes; a personal profile's payments are in the thousands at most.

## ADR-177: A Logging Streak Is Read From Logged Days; an Entry Is Logged When the Phone Saved It, Within 48 Hours (MUT-339)

**Status**: Accepted (2026-10-23, MUT-339). Basel's S1–S4, eng review R1–R12. ADR-174 is MUT-359's, ADR-175 MUT-366's, ADR-176 MUT-340's.

**Context**: MUT-339 shows a personal profile's streak of consecutive days with at least one entry. Nothing on the server returned entry days, and the phone has no timezone library. The phone saves through an outbox, so the server's own write time can put an offline entry on the next day.

**Decision**:
1. **Read, not stored.** `GET /v1/expenses/streak` works the streak out from `entries.loggedDays`: distinct `(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE tz)::date` over the entries feed's live rows, bounded 400 days back from the request's clock. No streak table while it stays one indexed query.
2. **Logged = createdAt, from the phone within 48 hours.** `capturedAt` on the two create routes becomes `createdAt`, clamped to [now − 48 h, now]. Offline logging lands on its day; nobody backdates a streak beyond two days. The money date (`occurredOn`) never counts.
3. **Instants for the phone.** `aliveUntil` is the end of `lastLoggedOn + 1` in the profile's zone, as UTC, so the phone never does zone math.
4. **Personal books only.** `profileTypeOf(org) === 'PERSONAL' && ownsProfile(...)`; under `/v1/expenses*`, so it stays session-only by the writability matrix.

**Consequences**: A settled Owed creates a payment, so settling counts as logging. A `capturedAt` moves the feed's "logged" order the same way, which is the order Recent already shows. Conversions don't count. Past 400 days the count stops at what fits.

## ADR-178: Business Email Signs Up at Once; Webmail, Relay and Unverified Domains Wait for the Operator (MUT-367)

**Status:** Accepted for the build (2026-10-23, MUT-367, unattended run on Basel's "go"). Decisions D1–D29 in `.claude/designs/mut-367-signup-review-queue.md` §4 are **pending Basel's confirmation**. This builds ADR-159 decision 2 (§7a) on ADR-175's seams.

**Context:** ADR-159 lets anyone sign up. Basel wants business users instantly, hand-approved webmail, and no throwaway addresses.

**Decision:**
1. **A screen on every signup address**, before anything is issued, so its timing never depends on an account. The answer's floor covers the screen's budget too:
   - **Refused**, on the input alone (400 `EMAIL_NOT_ACCEPTED`): disposable (the vendored list) or no-mail (a null MX, or definitely no MX and no address).
   - **Review:** webmail, relay and alias services, and any domain the checks can't pass.
   - **Business:** an MX, a resolving apex or www, and an RDAP registration at least 90 days old.
   - **DNS and RDAP only.** RDAP goes through IANA's bootstrap to the registry and follows no redirect; the server never fetches the domain's website. It asks about the exact domain, never a parent, so free subdomain services wait for review.
   - **Failures:** a lookup error is never a refusal (only ENOTFOUND/ENODATA mean absent); a failing checker means review.
2. **The verdict travels on the SIGNUP token**, and the redeem decides the account: ACTIVE with its trial, or `PENDING_REVIEW` with no trial plus a `signup_reviews` row.
3. **A pending account learns its state only with its password:** 403 `ACCOUNT_UNDER_REVIEW` after a correct, unlocked verify. Every other refusal is the usual 401. It can recover.
4. **Approve and decline are the only ways out.**
   - Each takes a row lock and decides only an undecided review.
   - Approve starts the trial in its own transaction (the column `billing.setTrialStart` writes).
   - Decline hard-deletes the account and its empty personal profile, every setup link and the address's SIGNUP rows. It refuses if anything else holds the account. The review row stays with domain, class and reasons, but no person.
5. **The operator digest** announces unannounced reviews only, at most once per UTC hour, keyed on the hour in the mail log.

**Rejected:**
- Walking RDAP up to a parent (free subdomains would inherit an old parent's age).
- rdap.org's redirector.
- Treating an MX hosted at a webmail provider as webmail (every Google Workspace business would wait).
- A repeated hourly reminder while reviews wait (noise; the CLI lists them).
- Calling `billing.setTrialStart` after the approve commits (a failure between the two would leave an open account with no trial).

**Consequences:**
- Nothing changes in production until signup opens (`self_signup_enabled`) with mail on.
- The disposable list ships as a hand-made seed until the operator runs `email-domains:update` (TD-214).
- A business domain gives unlimited instant trials (TD-213).
- The hourly sweep is in process (TD-215).

## ADR-179: The Portal Shows Only the Self-Service Doors the Server Opens; Turnstile Loads Only on Them; QA Runs Them on a Live API Without Cloudflare (MUT-368)

**Status:** Accepted for the build (2026-10-24, MUT-368, unattended run on Basel's "go"). Decisions D1–D17 (no D10) in `.claude/designs/mut-368-portal-signup-recover.md` §4 are **pending Basel's confirmation**. This builds ADR-159's pages on ADR-175 and ADR-178.

**Context:** the server can mail signup and recovery links and holds webmail signups for review. The portal had no pages for them, and its bundle rules banned their words. Production mail is off until Basel's go-live, so a door shown today would only fail.

**Decision:**
1. **The server names its doors.** `GET /v1/self-service` (public, no account information) returns `{signup, recovery}`. A door is open only where the server really mails links: a mailer other than noop and a Turnstile secret; signup also needs `SELF_SIGNUP_ENABLED`. Sign-in, /signup, /recover and dead setup links read it. An outage reads as both closed.
2. **Two pages, one form.** `/signup` and `/recover` share `EmailLinkForm`: an email, the bot check, one button, then one "Check your email" screen for every address. Refusals stay inline and keep the email. "Send again" goes back to the form after the 60 s budget, because a new link needs a fresh single-use token.
3. **Turnstile loads only on those two forms.** It uses explicit render with the form's action (`signup`/`recover`), the page's language and flexible size. `PORTAL_CSP` names `https://challenges.cloudflare.com` in `script-src` and `frame-src` only. A press made before the check finishes waits for its token; the page never sends without one. The site key is a build value with the always-pass test key as default, and `deploy.sh` refuses a test or missing key once mail is on.
4. **Under review is a screen, never a sign-in.** It shows after a SIGNUP redeem answering `PENDING_REVIEW`, or after sign-in's 403 `ACCOUNT_UNDER_REVIEW` (the right password only). Sign out ends a session someone already has on the browser.
5. **A dead link names its purpose to its holder**, so the page offers /signup or /recover instead of "ask the person who set up your account".
6. **QA runs on a live API without Cloudflare**, in its own app (`portal-selfservice`):
   - the API serves the built portal under the real CSP, from a per-launch DB, with the memory mailer and the fixture domains;
   - Turnstile is a page-routed stand-in that mounts a `challenges.cloudflare.com` frame;
   - each test sends its own client address.

**Consequences:**
- Merging changes nothing a person sees in production until mail goes live: both doors stay closed and sign-in reads as today.
- The go-live adds the Turnstile site key to `deploy.env` (before-release.md).
- The real widget is first seen at go-live (TD-216).
- The doors follow configuration, not mail health (TD-217).
- The ticket's QA paths moved from `qa/features/portal/` to `qa/features/portal-selfservice/`.

## ADR-180: The Trial Asks for a Card Once Per Person, on the Server's Record; Consumers May Buy Everywhere (MUT-418)

**Status:** Accepted for the build (2026-10-24, MUT-418, unattended run on Basel's "go"). Decisions D1–D16 in `.claude/designs/mut-418-trial-start.md` §4 are **pending Basel's confirmation**. Builds on ADR-160 (card-free trial), ADR-170 R-D2 (a card added in the trial keeps it) and ADR-179.

**Context:** a new trial saw no card prompt until it ran out. The prompt has to be once per person (also for webmail signups the operator approves later, who never pass /setup) and honest when nothing can be sold. Separately, Basel decided no business tax ID is needed in any country.

**Decision:**
1. **The step is a Billing drawer step** (`?billing=true&step=welcome`), not a page: "Your 14-day free trial has started", Add a card now (recommended) → Subscribe → Checkout with `trial_end`, Not now → Home. With no price pair: "Subscriptions open soon" and Continue only. It opens only while ≥ 48 h of trial remain (Checkout's `trial_end` minimum).
2. **"Once" is the server's record** (`users.trialPrompt`, `PATCH /v1/me/trial-prompt`, the MUT-191 preference pattern): the first welcome answer wins, the banner snooze is 3 days, both cross-device; no audit row. The answer doubles as the funnel count, since first-run analytics rarely flow (ADR-090 opt-in).
3. **Two openers, one offer per page:** `firstRunPath` after /setup, `TrialWelcomeOpener` for any other first sign-in; showing the step spends the page's offer, so closing it never reopens it before the answer lands.
4. **The trial is the person's:** step and banner read the personal profile's entitlement (TRIAL ACTIVE = no covering subscription).
5. **Consumers everywhere:** `"consumerCountries": "*"`; `GET /v1/billing` says `countries.consumerEverywhere`. Buying For a business always proves it is one (Stripe's tax ID where supported, our required number field in IL/JO); a person never sees the field.
6. **GA list prices** ₪49 / $16 a month, 10× a year, VAT-exclusive, by lookup key. QA's sandbox moved by lookup-key transfer; live is an operator step.

**Consequences:**
- Nothing changes in production until signup opens: operator-issued accounts have no trial, so they never see the step or the banner.
- `/` keeps the drawer keys, so mails (MUT-419) and the lapse gate (MUT-361) can link `/?billing=true&step=subscribe`.
- The privacy sentence for the new usage notes waits on Basel (TD-219); the Flutter contract copy lags (TD-218).

---

## ADR-181: The Lapse Gate Is Enforced Once, at the Door: READ_ONLY Takes Reads Only, LOCKED Only the Records Export; 402 SUBSCRIPTION_LAPSED (MUT-361) (Amends ADR-160 Decision 4)

**Status:** Accepted for the build (2026-10-24, MUT-361, unattended run on Basel's "go"). Decisions D1–D12 and review amendments R1–R9 in `.claude/designs/mut-361-lapse-gate.md` are **pending Basel's confirmation**. Builds on ADR-160 (states), ADR-162 (the resolver) and ADR-180.

**Context:** `/v1/me` reported each profile's entitlement (ACTIVE, GRACE, READ_ONLY, LOCKED) but nothing enforced it. ADR-160 decision 4 put the rule "in `store-guard.ts` and `authenticate()`".

**Override log (ADR-160 decision 4):** *what changed:* the rule lives only at the door (`authenticate()` → `server/src/auth/billing-gate.ts`, rules in `server/src/billing/gate.ts`); the store guard is untouched. *Why:* the store guard sees only repository calls, so a READ_ONLY session could still do work that touches no write method (a presigned upload URL), and it refuses mid-route after the idempotency claim; the door refuses before any work, for cookie and device sessions alike, and is also where LOCKED reads must be refused. *Date:* 2026-10-24.

**Decision:**
1. **Profile-scoped session requests** follow the selected profile's state: ACTIVE and GRACE → anything; READ_ONLY → safe methods only (every POST/PATCH/PUT/DELETE is a write, D5); LOCKED → only `GET /v1/records-export` and `GET /v1/records-export/receipts/:receiptId`.
2. **Organization-independent session routes** are each classified in `PERSON_LEVEL_GATE` (a test fails on an unclassified one): `open` (identity, sessions, password, terms, trial prompt, `/v1/billing/*`, fx, leaving a co-owned profile, D6); `person` (the inbox, `GET /v1/entries`, `POST /v1/profiles`: the person's best standing across their profiles, D4; the feed leaves LOCKED profiles out); `pathProfile` (profile edit, type-change preview, firm request: the profile in the path, members only).
3. **API keys are never gated** (Malafat's coverage is Malafat's). An unmatched route is never gated, so its 404 answers.
4. **The refusal is `SUBSCRIPTION_LAPSED`, HTTP 402** (D2), details `{ profileId (null when the standing refused), state READ_ONLY|LOCKED, source, until }`; `until` is a trial's lock date, else null (D3, instead of the ticket's `since`).
5. **`/v1/me` publishes `billingStanding`** (`open` | `read-only` | `locked`, null where the gate is off), so the portal and the phone never re-derive the person-level rule (D12). Each profile's own gate stays its `billing.state`.
6. **Switch:** `BILLING_GATE` (on unless exactly "false"); Terraform `billing_gate_enabled` (default true) is the operator's kill switch (D7). `createApp` defaults it off so suites with ungranted people keep testing what they test; the gate's suites turn it on.
7. **Operator list:** `GET /admin/v1/billing/uncovered` / `npm run billing:uncovered`: every READ_ONLY or LOCKED profile with an ACTIVE member. Must be empty (or hold only intended lapses) before a release carries the gate.
8. **Portal:** GRACE and READ_ONLY banners above every page of the profile; Add hidden and URL-opened create drawers refused; edit drawers open view-only (fields disabled, Save/Delete gone, receipt Download kept); LOCKED is one full page with Subscribe (only where this person's payment covers the profile) and Download my records; the switcher and account menu stay (D9). A late refusal re-reads `/v1/me`.
9. **For MUT-419:** `trialTimelineOf(trialStartedAt)` (`billing/entitlement.ts`) gives `{ startedAt, endsAt (day 14), lockAt (day 30) }`; the stage is `resolveEntitlement`'s TRIAL state.

**Consequences:**
- One extra `billing.factsFor` (three indexed queries) per gated session request; person-level routes also load the person's memberships (TD-221).
- Released phones map 402 to a retryable error: a refused capture stays in their outbox and lands once the person subscribes. Nobody is gated until self-signup opens (every existing person has a pre-billing grant), so GA's signup opening waits for MUT-364's phone build (D11, before-release.md).
- A co-owner's own subscription still doesn't cover a shared profile (TD-193): the portal tells them to ask its creator.
- API 1.60.0-mut361.

## ADR-183: Vendors Are Saved Per Profile From Every Typed Vendor; Saving Matches Exactly, the Typeahead Fuzzily (MUT-254)

**Status:** Accepted (2026-10-24, MUT-254; Basel's V1/V2). Plan and review amendments A1–A19: `.claude/designs/mut-254-vendors.md`. ADR-182 is held for MUT-253's OCR engine decision.

**Context:** An expense's vendor was free text. Reading receipts (MUT-256/257), firm vendor defaults (MUT-303) and bills (MUT-308) need a vendor the profile remembers, without a vendor page or a merge flow.

**Decision:**
1. **Tables:** `vendors` (canonical name = first spelling, registration number + its digits-only key, phone, email, `lastCategoryId` SET NULL, `lastUsedAt`, version) and `vendor_names` (canonical name and aliases, unique per profile by `nameKey`). `expenses.vendorId` (SET NULL) beside the free text, which stays as typed.
2. **Keys** (`server/src/vendors/keys.ts`): `vendorNameKey` = NFKC, lower case, tashkeel/tatweel removed, أإآٱ→ا, ى→ي, ة→ه, punctuation removed, `-_&` → space, then a leading English "the" and one trailing legal suffix (Latin, Hebrew, Arabic, matched after punctuation), each only while something is left. `registrationKey` = digits only (Arabic-Indic folded), fewer than 5 is none.
3. **Saving matches exactly (V1):** the registration key first, then the name key against names and aliases; a number hit adds the typed name as an alias only when no vendor has it; a name hit fills a missing number, phone or email, never overwriting. No merge. A unique violation retries the whole transaction once (it aborted).
4. **Every writer links** (POST/PATCH `/v1/expenses`, inbox file-as-expense, receipt approve) through `withResolvedVendor`, after every other check; optional `vendorDetails` only help the match. `vendors.touch` runs only after the write committed: `lastUsedAt`, and `lastCategoryId` unless the category is the automatic Other ("Other"/"أخرى"). A refused write moves no default; touch never bumps `version`.
5. **`GET /v1/vendors?q=&limit=`** (session-only, `expenses:read`, max 25): SQL contains-prefilter on `nameKey` (200) plus the 50 most recently used, scored in JS (prefix 1, contains 0.8, similarity ≥ 0.6 capped below 0.8), best name per vendor. Empty q = most recently used. Suggestions only.
6. **Lock order:** touch takes the category KEY SHARE before the vendor row; a profile type change locks expenses, categories, then vendors and clears `lastCategoryId` before deleting categories.
7. **Rolling deploy:** `scripts/backfill-vendors.ts`, run by post-roll on every deploy, links unlinked rows oldest first, re-links rows whose text no longer names their vendor (old revision), unlinks blanked ones, and sets `lastUsedAt` and missing defaults. A link changes neither `version` nor `updatedAt`.
8. **Local mode:** snapshot format 6 with `vendors` and `vendorNames` maps; the records export carries both.
9. **Not audited in v1:** vendor creates and aliases. If audit is added, `'vendor'` joins `EXPENSE_ENTITY_TYPES` so Malafat's key never reads it.

**Consequences:**
- Typos and one-off spellings become vendors and linger in suggestions until a vendor page with merge and delete exists (TD-224).
- The typeahead reads at most 250 name rows per keystroke; profiles with huge vendor lists get prefix/contains hits but fuzzy only among the recent 50 (TD-225).
- API 1.62.0-mut254 (additive: `Expense.vendorId`, `vendorDetails`, `GET /v1/vendors`).

---

## ADR-184: Trial Reminder Mails Are Daily Stage Windows, Sent Only Where the Trial Alone Decides the Account (MUT-419)

**Status:** Accepted for the build (2026-10-24, MUT-419, unattended run on Basel's "go"). Decisions D1–D16 and review amendments R1–R12 in `.claude/designs/mut-419-trial-emails.md` are **pending Basel's confirmation**. Builds on ADR-159 §5 (the mailer), ADR-160 D3 (the timeline), ADR-165 (the `/jobs` door) and ADR-181 (the gate).

**Context:** ADR-160's trial ends at day 14 (read-only) and locks at day 30 whether or not the person opens the portal; nothing told someone who stayed away.

**Decision:**
1. **Three stages, each a window** from `trialTimelineOf`: `ending-soon` (endsAt − 3 d ≤ now < endsAt), `ended` (endsAt ≤ now < lockAt − 3 d), `locking-soon` (lockAt − 3 d ≤ now < lockAt). Only the current stage is sent, so a missed day catches up and a stale stage is never sent (D1). Each is sent once: key `trial:<userId>:<stage>` in the mailer's send log (D3).
2. **"Within N days"**, N = whole days left rounded up (1–3): a deadline mail never promises more time than there is (D2, R7). No amount, price or date.
3. **Who:** ACTIVE people with a trial start in the window, and only when every profile they belong to is their own and resolves source TRIAL, so the trial alone decides their standing (`personStanding`) and "your account is read-only / locks" is exactly what the gate does (R4). Otherwise: `paying` (a Stripe subscription, a card on file included), `covered` (Malafat, operator grant), `other-profiles`; plus `suppressed`, and `gate-off` when `BILLING_GATE` is off (R5).
4. **Doors** like MUT-360's reconcile: `POST /jobs/v1/billing/trial-mail` (Cloud Scheduler, counts only) and `POST /admin/v1/billing/trial-mail` (operator, `dryRun`, rows). Both 503 without Stripe (R6). A real production run refuses loopback links (R11). One person at a time, 200 s budget, then `incomplete` (R1).
5. **Scheduler:** Cloud Scheduler (not an in-process timer, TD-215's lesson), daily 10:00 Asia/Jerusalem, created only with mail, Stripe and the gate all on (D7, D8). The job token now also triggers customer mail; a leaked token can only re-run idempotent mail (D15).
6. Trial mails are outside the per-recipient cap (D11).

**Consequences:**
- Someone in a firm or with mixed coverage gets no mail; the portal's per-profile banners (ADR-181) still tell them.
- A permanently rejected send retries daily within its window (R12, TD-223).
- API 1.63.0-mut419.

## ADR-185: The Carry-Over Maps the Old Web App's Backup on the New Address, Replays It Through a Throwaway Local App, and Lands It Through Restore (MUT-291)

**Status:** Accepted (2026-10-24, MUT-291). Owner decisions D1–D4 and D10, and eng review D1–D9, are Basel's (`.claude/designs/mut-291-carry-over.md` §4, §11). Builds on ADR-097 (local mode), ADR-155 (the staged domain move) and ADR-156/MUT-287 (the records file and Restore).

**Context:** the free web app's records live in IndexedDB on `mutaba3a.netlify.app`, and the run.app portal's signed-out records on run.app. The new address can read neither. Stage `redirect` needs the run.app `/carry-over` page the server already sends visits to.

**Decision:**
1. **One receiver, two senders.** `/carry-over/receive` on the new address takes the free app's own backup (`serializeAllTables`) from the old web origin, or the old address's records file from the old portal origin. Each origin may send only its own kind.
2. **The mapping runs on the receiving side (E1).** `LOCAL_RULES` forbid portal code in `dist-web`, so the old app sends only what it already makes. The mapping lives in `src/hosted/local/carryOver`, which MUT-292 keeps. Nothing in the portal says "Dexie" (R4).
3. **A throwaway local app, then one Restore (E2).** The backup is mapped to ordered ops and replayed through `createLocalApp` over a fresh in-memory store:
   - every server rule runs on every record;
   - no rate limit (R1), and nothing persisted;
   - a 4xx is listed with the API's reason, with its dependants;
   - a 5xx aborts.

   The snapshot and its receipt files then land with `applyRestore`, all or nothing.
4. **A totals gate (E4, R3).** The free app's own rows that arrived must equal the replayed records per profile and currency, and outstanding must equal the organization summary. Otherwise nothing is offered.
5. **The hand-off protocol** (`src/lib/carryOver/protocol.ts`):
   - a popup opened from the click before any await (R2);
   - origins baked from `config/hosts.json` (`__CARRY_OVER__`), never read from the URL;
   - `event.origin` and `event.source` checked, no `'*'`;
   - a 10 s ready timeout on the sender; a 20 s payload timeout and an opener-closed check on the receiver (R8);
   - no COOP on either page, pinned by tests.
6. **The file is the fallback, and a door of its own (E5).** Your data › Restore and the receive page both read the free app's backup file. An installed home-screen app leads with it (R7).
7. **Owner rules:**
   - D1: the old app offers the move on every visit, allows staying, and shows a banner once carried;
   - D2: each business becomes a Business profile, at most five;
   - D3: existing records are replaced after a warning, a download-first and a second confirm;
   - D4: "No client" for Owed with no client, and a project is dropped on a currency mismatch;
   - D10: signed in, the records go to the browser's signed-out space, and the page says so.

**Alternatives considered:** mapping in the old app (refused by `LOCAL_RULES`); POSTs into the live local store (O(n²) saves, half-written on failure); merging snapshots; an iframe (`frame-ancestors 'none'`); a URL-carried payload (too large).

**Consequences:**
- The free app's production build gates `/app` from stage `live` on. Its dev server doesn't, unless `MUTABA3A_CARRY_OVER` says so; `off` turns it off on a build.
- Archived clients and projects arrive active (signed out, the archive routes are read-only).
- 20,000 records replay in 4.3 s in Node (T-P1), with no Web Worker.
- The old app still accepts edits after a carry-over (TD-228), until MUT-292.

**Amendment 1 (2026-10-24, MUT-291 /qa-reconcile review):**
- **v1 answers `done`, `declined` or `failed`.** The receiver sends `failed` whenever the records arrived but couldn't be checked or saved: too large, a refused or failed check, a save that didn't finish. The old page then offers its file at once, and never marks the records carried. The sender takes an answer only after `ready`.
- **The old app reads its backup strictly for the carry-over** (`serializeAllTables({ strict: true })`). A table it can't read fails the carry-over; it is never sent as an empty table and marked carried. The Back up download keeps the lenient read.
- **Amounts use the server's formatter** (`formatMoney`), so a records file with a currency the API has retired (MUT-388) still restores. `server/src/money` joins the local backend's allowlist.
- **Release builds trust only https origins**, each exactly as a browser reports it. Loopback origins are for the QA dev servers only.
- **Failure paths:**
  - A read failure on the old address offers the move instead of leaving (never stranded).
  - A receipt file that won't decode is listed, not fatal.
  - A receipt the rules refuse at complete is deleted again.
- **The replay gives the page back every 40 ms** through a MessageChannel, not every 200 ops on a timer: hidden tabs clamp timers.
- **Still open:** TD-230 (the gate sees only rows the mapper carried), TD-231 (the legacy origins have no end date), TD-232 (sender and receiver versions must ship in order).

## ADR-186: The Landing Asks the Server Whether Signup Is Open; the Privacy Policy Is Revised as Copy, Approved by Basel (MUT-369)

**Status:** Accepted for the build (2026-10-24, MUT-369, unattended run on Basel's "go"). Decisions D1–D17 in `.claude/designs/mut-369-signup-cta-privacy.md` are **pending Basel's confirmation**. **The privacy-policy wording is a draft: Basel must approve it before any release** (before-release.md). Builds on ADR-159 §9, ADR-179 (the doors endpoint), ADR-076/ADR-155 (the build-time portal origin).

**Context:** at GA the landing's way in must become the portal's `/signup`, and the privacy policy must name what signup and mail add (Resend, Cloudflare Turnstile, the DNS/RDAP domain check). MUT-369's ticket said "a build value decides the CTA"; MUT-368 recommended reading its doors endpoint.

**Decision:**
1. **The landing reads `GET /v1/self-service` at runtime** (D1): once per page load, CORS-simple (GET, `credentials: 'omit'`, no custom headers), 3 s timeout. Only `signup: true` opens it; anything else is today's page (D3). The portal origin is still the ADR-076 build value. The CTA can't drift from `SELF_SIGNUP_ENABLED`, and GA needs no web release.
2. **That one route answers `Access-Control-Allow-Origin: *`** (D2), no credentials, no preflight handling. Two public booleans name no account; an allow-list would have to track every landing host during the domain move. Every other route still sends no CORS header (tested). API 1.64.0-mut369.
3. **While open:** hero, bar, Get it's first option and the phone chapter say "Create an account" and open `<portal>/signup?lang=<page language>` in a new tab (D4); the request form stays under "Want us to set it up for you?" (D6); FAQ a1 and the notes drop "no public sign-up". No price, trial length or checkout word (MUT-365 is v3).
4. **The portal honours a link's `?lang`** (D5, D15): read once in `src/hosted/main.tsx` (`takeLinkedLanguage`), taken off the address before the router starts, beating a stored choice for that load and never stored. `linkedLanguageOf` (`src/lib/i18n/linkLanguage.ts`) is the one reader; `legalLanguageOf` re-exports it.
5. **The privacy policy is not pinned or accepted** (unlike the terms, ADR-102), so a revision is a copy edit plus a "Last updated" date, and no terms version changes (D11). This revision is MUT-402 D4's "next real revision": English says MTB3A and the brand guard's exemption is gone (D10).

**Consequences:**
- A home-page visit now makes one GET to our API (disclosed in the policy's network section).
- Adding Sentry tracing to the landing with the portal in `tracePropagationTargets` would force a preflight the server doesn't answer and keep the door closed (D17; comment in `signupDoor.ts`).
- The signup CTA isn't counted in landing analytics (D7, TD-233). Stripe isn't named in the policy yet (D13, TD-234).

---

## ADR-187: Account and Profile Settings Are a Page, Not Menus: the You Page (MUT-425, epic MUT-423)

**Status:** Accepted (2026-10-24, MUT-425; plan `.claude/designs/mut-425-you-page-plan.md`, eng review D1–D9 answered by Basel). The first step of the MUT-423 shell (round 4 variation 3, `.claude/designs/portal-shell-concepts.html`); MUT-426 replaces the sidebar with the pill and the island.

**Context:** the portal's account menu had grown past a popover (billing, Malafat, usage, terms, app links), and the profile switcher was a second popover beside it. Basel chose a calm page with room to grow and no menus anywhere.

**Decision:**
1. **The You page** at `/p/:id/you`, `/you/account` and `/you/app` holds every item of the old `ProfileSwitcher` and `UserMenu`: Profiles (each profile with its kind and cues, New profile at the cap or under the lapse gate, Manage profiles, the local-profiles note), Account (Billing with the trial or lapse state, Your data, Change password, Sign out set apart; signed out: Sign in and Your data) and App (Language and the usage switch; Malafat, Terms and the phone apps; signed out: Language and Terms only). The parts are routes, so the segmented control is `SectionTabs variant="segmented"`: links with `aria-current`, not a radiogroup (D2).
2. **Both popovers are gone** (D1, D2): the sidebar keeps the open profile's name (→ Profiles) and the avatar (→ Account) as links (`YouLinks`) until MUT-426.
3. **A switch keeps the section** through `?from=<section>` (D3, Basel's choice over an in-memory store): the links into the page add it, the part tabs and the drawers keep it, `parseYouSearch` keeps only a known section (twice: TanStack carries raw keys past `validateSearch`). Every profile row, the open one included, goes to `/p/<id>/<from>` or the profile home; never history Back (D4). Profile-less links carry it too (D8).
4. **A profile-less `/you`** (eng D3) so a person with no profile, or on one they lost, still reaches Billing, the password and the language once the menus are gone.
5. **The You page shows on a LOCKED profile** (E1): `ProfileLayout` keeps `LockedScreen` off the You routes, and `LapseBanner` shows the locked words and actions above the page (D7).
6. **Billing's sub-line** is `billingRowOf(me, profile|null, now)`: the person's running trial, else the open profile's lapse state, from `/v1/me` only (D6).
7. **Drawers are unchanged:** each row opens `ProfileDrawers` / `AccountDrawers` by today's URL keys.

**Consequences:**
- The 11 menu-driven QA specs and ~10 unit tests moved to the page under a written regression contract (plan, eng D5); menu roles, Escape-closes and focus-on-open are retired with the popovers.
- `hosted-portal.md` §7.1/§7.2 describe the page; MUT-426 owns the island (it must link with `?from=` and use the profile-less `/you`) and any back affordance.
- Passkeys (MUT-115/415) and Close account (MUT-333) add rows to You › Account.

## ADR-189: Portal Reports — Per-Profile Activity on the Server, Combined and Converted in the Portal, Staged Deterministic Insights (MUT-175)

**Status:** Accepted (2026-10-24, MUT-175). Basel's product calls B1–B9, eng review D1–D6, design review DR1–DR30 and the All-profiles pass DS1–DS5 are in `.claude/designs/mut-175-reports-plan.md`; the copy table (DR28) was approved as written. ADR-181 is MUT-361's; MUT-425 claimed ADR-187 and MUT-333 ADR-188, so this is ADR-189.

**Context:** MUT-292 can't retire the web app's Insights page until the portal has reports, and MUT-322's GA gate lists it. Basel called Reports "a very important screen" meant to bring people back weekly.

**Decision:**
1. **One server read per profile:** `GET /v1/summaries/activity?from&to&bucket=day|month` (in `summaryRoutes`, so `PORTAL_ROUTES` runs it signed out too, ADR-097). It answers per currency (ADR-004): received (POSTED payments by `receivedOn`), spent (expenses by `occurredOn`), zero-filled buckets, the period's categories and received-by-client, a **12-month monthly history ending with `to`'s month**, `dataSince`/`earlierData`, and **days to get paid as the median over fully settled Owed entries whose last payment falls in that window, null below 3** (D2). `summaries:read` + `expenses:read`, session-only like `/v1/summaries/expenses`; defaults to this month; 422 `END_BEFORE_START`, `RANGE_TOO_LONG` (13 months). One batched allocation read, `payments.listAllocationsFor`. In-memory aggregation, like the organization summary (TD-237). API 1.68.0-mut175.
2. **Weeks, combining and converting happen in the portal** (D1): weeks from day buckets with `weekStart` (Monday en, Saturday ar); All profiles fans out one request per profile and adds per currency; the ≈ figure converts at today's ECB rate through `convertTotal` (widened, not copied). Categories merge by name across profiles; clients never merge (DR30). Days to paid across profiles is the median of each profile's median weighted by its entries (the honest figure without shipping every sample).
3. **The stage comes from the data** (B3, DR14): a month counts as complete only if records began by its 7th day; 0 / 1 / 2+ complete months are stages 1 / 2 / 3. Stage 2 is a factual recap of the first complete month; movers, concentration, days to paid, best month, trend and average are stage 3 (DR15 amends B4). Insights always describe the latest complete months and never move with the period shown (DR16). They are deterministic rules with named thresholds, no LLM; changed facts rank first, then kind order (DR29), and a fact seen on 3 earlier visits drops below fresh ones (DR18, `localStorage`, best-effort).
4. **One unit for comparisons** (D3): one currency in view needs no rates; with every rate present it is the base; with one missing, the largest currency in view, labelled "In {currency} only".
5. **One profile by default; one opt-in "All profiles" switch** (DS1–DS5, `?scope=all`): Reports' one exception to MUT-423 D6. Each profile loads on its own; a failed one is named with its own Retry and the rest renders (D4); the error card shows only when nothing loaded (DR10).
6. **One opt-in event**, `report_viewed {period, scope, stage}`, debounced 1 s, never signed out (D6, taxonomy v2.2.0).
7. **Entry point:** a nav item after Overview until MUT-426 moves it to the shell's corner icon (X2, MUT-424 D2). The route stays `/p/$profileId/reports`.

**Consequences:**
- `DayBars` gained opt-in `second` and `future` props in place (D1); characterization tests pinned the single-series chart first and the expense-group release-QA ran before and after (D5). `CategoryBars` gained plain rows, `meta` and `detail`.
- A Year request reads 12 months; Month and Week read the 12 months their history needs. If a profile's year passes ~10k rows, move the aggregation to SQL (TD-241).
- The web Insights CSV is not carried over (plan §9). Basel accepted the loss on 2026-10-25: MUT-292 may retire it, and export comes back when the flows are rethought.
## ADR-188: Closing an Account Is 30 Days of Grace on the User Row, Then an Hourly Hard Delete That Claims First, Passes Shared Profiles On and Anonymizes the Rest (MUT-333, Web Half)

**Status:** Accepted for the build (2026-10-24, MUT-333, unattended run on Basel's "go"). Decisions D1–D20 and review R1–R24 in `.claude/designs/mut-333-close-account.md` are **pending Basel's confirmation**. Basel's own decisions (Jira 12135, 12152, 12293): 30 days' grace then a hard delete, backups age out 14 days later; closing cancels an active Stripe subscription (a Malafat add-on is left alone); `user.terms_accepted` audit rows are purged; records on profiles the person doesn't own are anonymized, not reassigned. Builds on ADR-102 (terms), ADR-160/181 (billing, the lapse gate), ADR-163 (co-owners), ADR-165/170 (Stripe), ADR-174/184 (mail and the job pattern).

**Context:** GA needs self-service account deletion (privacy law; App Store 5.1.1(v) for the phone). The operator did it by hand with `profile-rows.sh purge-user`, which refused shared profiles and records on others' profiles ("MUT-333's decisions").

**Decision:**
1. **The closure lives on the user row** (D18): `closeRequestedAt`, `deleteAfter` (+30 × 24 h), `closeEndedSubscriptionIds`, `purgeStartedAt`, `purgeLastTriedAt`. The auth layer already reads the row, so the grace restriction costs no read.
2. **Grace is a restricted session** (D3, R8): sign-in still works; every other session is revoked at close; a closing session reaches only `GET /v1/me`, `DELETE /v1/me/closure` and sign-out, anything else is **403 `ACCOUNT_CLOSING`** `{ deleteAfter }`. API keys are unaffected. Past `deleteAfter` (or once claimed) the account is gone to the person: sign-in 401, sessions expire (D5). Both closure routes are `open` in the lapse gate.
3. **Billing (D1, R5–R7):** close reads Stripe live, ends `active|trialing` subscriptions at the period end and cancels `past_due|unpaid` ones now, after expiring open checkouts on every customer whose metadata names the person; a Stripe failure reverts what it changed (502, nothing changed). Keep my account turns back on only what the close ended. The purge deletes every such customer.
4. **The hard delete claims first, deletes files last (R1, R2):** per person, a claim under the user-row lock (after which no cancel can win, whatever the clocks), then Stripe, then one transaction (120 s budget, R13), which queues the deleted profiles' bucket prefixes in `storage_purges`; the prefixes are emptied after the commit and at the start of every run.
5. **What happens to each profile (D6, R10, R18):** one the person created alone is deleted with every row; one they created and share passes to a co-owner (active and not closing first); one they created that others belong to with no co-owner (a firm's bookkeepers) blocks the close (409 `ACCOUNT_CLOSE_BLOCKED`) and the purge; anything else keeps the person's records, anonymized: the creator columns are nullable with ON DELETE SET NULL (D7). On surviving profiles the audit keeps a tombstone: the bare user id, metadata cleared, plus `user.deleted` (D8, R3).
6. **The job is always on** (D11): Cloud Scheduler `mutaba3a-account-purge` hourly at :15, `POST /jobs/v1/accounts/purge`; at most 25 people and about 200 s a run; one failure never stops it; skips and failures log `account purge needs the operator`, which alerts. The operator dry-runs with `POST /admin/v1/accounts/purge {dryRun}` / `npm run accounts:purge -- --dry-run`.
7. **Completeness is tested against Postgres itself** (R14): `prisma-purge-tables.ts` names every table; a test:db fails on an unclassified `organizationId` table or user foreign key, and another scans every text/uuid/JSON column after a purge for the person's id, email and name.

**Override log:**

| Overridden | What it said | Replaced by | Why | Date |
|---|---|---|---|---|
| ADR-159 §5 / MUT-359 templates | "No template variable is an amount, a currency or a date" | `account-closing` carries the deletion day (a calendar day, never a money date); the template test allows that one value | The person must know the day their account goes | 2026-10-24 |
| MUT-42 / MUT-161 / MUT-267 schema | `expenses`, `conversions`, `expense_groups.createdByUserId` and `expense_receipts.uploadedByUserId` NOT NULL, RESTRICT | Nullable, ON DELETE SET NULL; the API fields are nullable | Basel's 12293: records stay, anonymized | 2026-10-24 |
| ADR-099 (MUT-300 O8) | `firmRequestedByUserId` RESTRICT and set exactly with `firmRequestedAt` | SET NULL; the CHECK only says requested-by implies requested-at | A pending request outlives its requester | 2026-10-24 |
| MUT-327 runbook / `profile-rows.sh` | purge-user "until MUT-333"; refuses records on others' profiles | The hourly purge is the path; the script stays for the operator's own cases | The decisions it deferred are now made | 2026-10-24 |

**Consequences:**
- The phone half (MUT-371/364 phase) must add Close my account, the closing screen, treat 403 `ACCOUNT_CLOSING` as terminal, and accept null creator ids (its feed already does).
- The restricted Stripe key needs **Write on Subscriptions** (D14); without it close answers 502.
- Co-owners whose shared profile was covered by the closer's subscription get no notice and may lose coverage during the grace (TD-237). `email_suppressions` keep the address (TD-238). `profile-rows.sh purge-user` duplicates part of the purge (TD-239). The purge's per-person text scans are accepted at pilot volume (TD-240).
- The privacy policy's 30-day/14-day promise is now true by code; its "Deleting your account" paragraph still says to email us: Basel rewords it (before-release).

## ADR-190: Passkeys — One Relying Party on the Apex, a Second Sign-In Beside the Password, Bound to It (MUT-115, Web Half)

**Status:** Accepted for the build (2026-10-25, MUT-115, unattended run on Basel's "go"). Basel approved the plan's D1–D12 and DR1–DR12 on 2026-10-23 (`.claude/designs/mut-115-passkeys.md` §11–§12); the build's own choices B1–B14 (§13 there) are **pending Basel's confirmation**. Amends ADR-037 (sign-in methods). Builds on ADR-155 (the custom domain), ADR-159 (self-service), ADR-181 (the lapse gate), ADR-188 (closing accounts).

**Context:** Passwords were the only way in. Passkeys are bound to their relying-party ID for life, so they waited for `mtb3a.com` (MUT-112). The portal is on `app.mtb3a.com`; the iOS app asserts with the apex as its origin.

**Decision:**
1. **RP ID = the apex** (`WEBAUTHN_RP_ID`, Terraform from `config/hosts.json` at stages live/redirect). Origins: `PORTAL_ORIGIN` and `https://<apex>`; the server refuses to start on an origin outside the RP ID. Unset = every passkey route answers 404 and the portal hides passkeys (also on the legacy run.app host, by its build-time RP ID).
2. **Attestation `none`, discoverable credentials, user verification required, ES256 + RS256** (`@simplewebauthn/server` 13.3.3 / `browser` 13.3.0, pinned).
3. **Challenges in Postgres** (`webauthn_challenges`): single-use, 5 minutes, consumed by one conditional UPDATE; a creation challenge is bound to its person, purposes never cross.
4. **One sign-in core:** `signInWithPasskey` in `auth/sign-in.ts` shares `recordSignInFailure` (one counter per email for passwords and passkeys) and `issueSession` (bound to the current password hash; `sessions.passkeyId`). PENDING_REVIEW → 403 `ACCOUNT_UNDER_REVIEW`; a closed account past its deadline → 401 with no failure counted; during the grace it signs in, as with the password. A counter that went backwards is refused and audited once the signature proves genuine.
5. **Adding needs a recent sign-in:** `credentialsVerifiedAt` ≤ 10 minutes, else `currentPassword` through `verifyCurrentPassword` (403 `RECENT_SIGN_IN_REQUIRED` / `CURRENT_PASSWORD_WRONG`). At most 10 (409 `PASSKEY_LIMIT`). Named from the AAGUID's provider or the device; renamable.
6. **Removing a passkey signs out the sessions it opened** (except the caller's), in one transaction. A password change keeps passkeys and revokes sessions exactly as before.
7. **Identity routes:** the five management routes are `open` in the lapse gate and closed to a closing account (ADR-188's 403). The purge deletes passkeys and creation challenges.
8. **Apex AASA:** the landing's `_redirects` proxies the portal's `apple-app-site-association` with a 200, so iOS trusts the apex for `webcredentials`; one source (the server's `APPLE_TEAM_ID`/`APPLE_BUNDLE_ID`).

**Consequences:**
- Release order: web (the AASA rewrite), then server (turns passkeys on), then the phone once Apple's CDN has the apex file.
- MUT-370's suggestion card runs `addPasskeyFlow` (`src/hosted/passkeys/addPasskey.ts`) right after first sign-in, with no step-up. MUT-414's mail plugs into `PasskeyEvents.added`.
- Debt: TD-242 (no "passkey added" mail), TD-243 (no operator tools), TD-244 (drawn icon), TD-245 (seed AAGUID list), TD-246 (a row per challenge).

## ADR-191: Suggest a Passkey After Sign-In — Three Offers, Decided by the Server (MUT-370, Portal Half)

**Status:** Accepted for the build (2026-10-25, MUT-370, unattended run). D1–D11 in `.claude/designs/mut-370-passkey-suggestion.md` §2 are **pending Basel's confirmation**. Builds on ADR-159 (decision 9: password required, passkey suggested), ADR-180 (the trial prompt pattern), ADR-190 (passkeys).

**Context:** MUT-331 Q3 asks for a dismissible "Add a passkey: the more secure way to sign in" after the first sign-in: Not now hides it for 30 days, at most three offers, never once a passkey exists, on the portal and the phone alike.

**Decision:**
1. **The server stores and decides.** `users.passkeyPrompt` JSONB `{notNowCount, hiddenUntil}`, through the passkeys port (not `UserRecord`, so the local snapshot and the records export are untouched). `/v1/me` `user.passkeyPrompt {due, notNowCount, hiddenUntil}`; `due` = no passkey, fewer than 3 Not nows, not hidden. Null where the server offers no passkeys (and in the portal's local mode).
2. **An offer lasts until answered.** Each Not now (`PATCH /v1/me/passkey-prompt`) spends one offer and hides the suggestion 30 days; a Not now while hidden changes nothing (two devices, one offer), under the user row lock. Views are not counted.
3. **Clients add only their own checks:** device support (`passkeySupport()` on the portal) and their first-run order. On the portal MUT-418's trial step comes first; the card then sits on Home under the trial banner.
4. **Adding** runs MUT-115's flow with no password; a stale sign-in hands over to You › Account › Passkeys. Adding or removing a passkey anywhere refreshes `/v1/me`.
5. Pilot and operator-issued accounts follow the same rules.

**Consequences:**
- The phone half reads the same field and calls the same route (no counting logic of its own).
- No analytics events (TD-247). The 30-day and three-offer numbers live on the server; the portal mirrors them only for its optimistic hide (TD-248).

## ADR-192: The Portal Is Four Destinations — Owed, Paid, Spent, Clients — With Every URL Unchanged (MUT-424, epic MUT-423)

**Status:** Accepted (2026-10-25, MUT-424; plan `.claude/designs/mut-424-four-destinations-plan.md`, eng review D1–D3 answered by Basel). The second step of the MUT-423 shell (round 4 variation 3); MUT-426 replaces the interim sidebar with the pill. Supersedes the seven-item sidebar list in `hosted-portal.md` §7.1.

**Context:** seven peer sections (eight with Reports) made the portal read like a dashboard. People come for four things: who owes them, what came in, what went out, and their clients.

**Decision:**
1. **Four destinations:** Owed = `/p/:id` (the overview), Paid = `/payments`, Spent = `/expenses`, Clients = `/clients`. Receivables sits one level in under Owed, Conversions under Paid, Groups under Spent (its existing tabs), Documents and client detail under Clients (MUT-423 D2: unattached documents are a row at the bottom of Clients).
2. **Every URL stays as it is (E1).** The phone's universal links claim `/p/*/expenses` and `/p/*/payments` (MUT-111/113), mail and Stripe land on `/p/:id`, and PostHog page views and bookmarks stay comparable. "One level in" is navigation and wayfinding, not URL nesting, so no redirects are needed: the ticket's "old URLs redirect" line is met by construction.
3. **One map lights the tab (E2):** `destinationOf(pathname)` in `src/hosted/shell/destinations.ts`, pure, keyed by the first segment under `/p/:id`. `NO_DESTINATION` names the pages that light none: `reports` (it opens from its own corner icon, eng R2, MUT-426) and `you` (MUT-425). A test walks every route under `/p/$profileId` and fails on an unmapped one (R3).
4. **Titles follow the tab word (E3):** Overview → Owed, Payments → Paid, Expenses (and its Groups tab) → Spent. Pages one level in keep their names and get a back link (`PageHeader back`); tables keep their content names, except Owed's own list.
5. **The way in is a quiet row list (E4, D1):** `DeeperLinks` at the bottom of Owed, Paid and Clients, outside the page's `QueryView`, with no counts or figures.
6. **Until MUT-426,** Reports stays a link beside the four destinations, outside the "Sections" nav, so nothing reachable becomes unreachable.

**Consequences:**
- MUT-426's pill reuses `DESTINATIONS` and `destinationOf` unchanged; it owns the Reports corner icon. MUT-175's AC 1 ("a Reports section in the portal nav") becomes "opens from the Reports icon".
- The destination links pass `activeOptions={{ exact: true }}`: TanStack adds `aria-current` to any active link, and Owed's bare `/p/:id` is active under every page of the profile.
- The Arabic for Spent (المصروف) awaits Basel's sign-off; the alternative is المصاريف.

## ADR-193: Portal Receipts Show Their Original Inline — Storage Origin in img-src/frame-src, an Inline Download Disposition, and a Shared Expense Form (MUT-260)

**Status:** Accepted (2026-10-25, MUT-260, plan `.claude/designs/mut-260-receipts-portal.md` D1–D12 with eng-review amendments A1–A14). Builds on ADR-167 (the receipts library, MUT-255) and the MUT-45 CSP (§4c of `server/DEPLOYMENT.md`).

**Context:** Receipts shared from the phone wait in the library as To review, and the portal could not see them. Basel chose layout B (a Receipts tab under Expenses, a gallery and a review page) and to show the original inline rather than as a download.

**Decision:**
1. **CSP.** `PORTAL_CSP` names `https://storage.googleapis.com` in `img-src` and `frame-src` (plus `'self'` in `frame-src`, for the dev server's same-origin local driver). Signed URLs are short-lived and on their own origin, so a receipt can't script the portal.
2. **Inline disposition.** `GET /v1/receipts/{id}/download?disposition=inline|attachment` (default `attachment`, so existing callers are unchanged; API `1.71.0-mut260`). `contentDisposition(filename, disposition)` drives both drivers: the GCS `responseDisposition`, and the local token's optional `d` claim (absent = attachment). The response type stays the stored one (PDF, JPEG, PNG). Only the PDF preview and Open full size ask for inline; an image shows from the attachment URL its gallery card already loaded (same query, same bytes).
3. **Local driver.** An inline `/dev/attachments` GET goes without `content-security-policy: sandbox` (a sandboxed PDF won't render in an iframe), and, being a raw Response, without the portal CSP whose `frame-ancestors 'none'` would refuse the frame. Attachments keep the sandbox.
4. **The library being on** is learned from `GET /v1/receipts/counts`: 404 or 503 hides the tab and makes its routes say "not available", never retried; success gives the To-review count.
5. **One expense form.** `components/expenseForm/useHostedExpenseForm` + `HostedExpenseFields` are extracted from `ExpenseDrawer` unchanged and shared by the drawer and the review page; the shared `components/expenses/ExpenseFormFields` gains an optional `hints` prop (the local app passes none).
6. **Prefill** is a pure `suggestionToFormValues(ReceiptSuggestion)`: every source counts, confidence only colours the hint; amounts are split at the currency's exponent as strings; a currency the portal doesn't offer leaves the default currency and an empty amount with "The receipt says …".
7. **Approve** never sends `suggested` (it would replace the stored one), sends no `captureSource`, keys on `{receiptId, body}` per mounted receipt and drops the key on any 4xx (the server stores 4xx answers as final).

**Consequences:**
- Turning the library on in production must be checked on staging first: open an image and a PDF receipt and confirm no CSP violation (runbook §6 deploy table).
- Thumbnails are full-size originals (TD-250).
- Filing onto an existing expense (MUT-389's `/file`) and deleting from the gallery are not in the portal yet.
## ADR-195: The Portal's Chrome Floats Over the Page — the Pill, the You Island and Reports, With Depth-Driven View Transitions (MUT-426, epic MUT-423)

**Status:** Accepted (2026-10-25, MUT-426; plan `.claude/designs/mut-426-floating-shell-plan.md`, eng review D1–D9 answered by Basel). The last step of the MUT-423 shell (round 4 variation 3). Supersedes ADR-192 §6 (the interim Reports link) and the sidebar in `hosted-portal.md` §7.1.

**Context:** the 240 px sidebar took room from every page and read like an admin dashboard; MUT-424 and MUT-425 left it as an interim home for the four destinations and two links into the You page.

**Decision:**
1. **Three glass objects, one DOM.** `HostedShell` renders `nav.hp-chrome` (named for the product, so Reports and the island sit in a landmark; fixed, `z-index: 15`, between the page and `.hp-popover`/toasts/drawers) holding the Reports corner icon, the pill (`nav.hp-pill` "Sections", the four destinations) and the You island, in that DOM order: the reading and keyboard order on both layouts. `html` takes `scroll-padding-block` of the chrome's reserve, so `scrollIntoView`, focus and anchor jumps stop below it. Desktop: Reports top start, pill top centre, island top end. Phone (≤ 760 px): pill and island circle at the bottom, Reports top end. The document still scrolls; the page reserves the chrome's space (top on desktop, both on a phone, plus the safe area through `viewport-fit=cover`), so at rest nothing is hidden.
2. **The portal differs from the local app's MUT-79 "nothing floats over content" on purpose (S4):** the chrome floats only over scrolled content, through fixed `--bg` fade bands rather than a mask.
3. **Glass** is `--hp-glass-bg` (74 % `--surface`), `--hp-glass-edge` and `--hp-lift` (dark values under the three-selector pattern) on `.hp-glass`, solid under `prefers-reduced-transparency` or without `backdrop-filter`.
4. **The island is a link (MUT-425 D4).** Off You it opens You › Profiles with `?from=<section>` and `?back=<this page>` (D7); on You it is `aria-current` and goes to `back` (same profile only: `islandTarget`), else the section, else home. `back` is path-only and parsed against `/p/<id>/<known section>…`, so it cannot leave the portal. Profile switching still keeps the section only. Reports is a section (`SECTION_SEGMENTS`, D8).
5. **The profile colour (D2)** is `ringColorOf(id)`: FNV-1a over the id onto six brand ring colours, each ≥ 3:1 on every surface in its theme. Client only; no API field. Two profiles can share one.
6. **Page motion is TanStack Router view transitions (D6).** `defaultViewTransition` is `{ types }` from the pure `pageMotionOf(prev, next)` (first match wins: same path or first render none; into You island; leaving You back; outside a profile none; another profile fade; deeper forward; shallower back; else fade). It is set only where view-transition types are supported under both our check and router-core 1.144's own (router.js:146): otherwise the router starts untyped transitions on every navigation, drawer opens included. CSS draws each type on `::view-transition-old/new(root)`, mirrored in RTL by keyframe name; `.hp-chrome` is its own transition group and holds still; reduced motion cross-fades. Browsers without types get an instant swap.
7. **No wordmark in the chrome (D3):** it heads You › App; sign-in and the tab title still name the product. **The trial notice is one muted line (D4).** **On a phone the island is ring-only (D5)**, the name in its label, and the bottom bar hides while a page field has focus (D9, `:has()`), for iOS's keyboard.

**Consequences:**
- `YouLinks.tsx`, the sidebar's and phone top bar's CSS, `--hp-sidebar-width` and the keys `hosted.shell.switcher.label`, `hosted.shell.account`, `hosted.billing.trialBanner.endsOn/endsSoon` are gone; `hosted.shell.island` is new. TD-236 is resolved.
- Unit tests reach You through the harness's `openYou(user, part)`; QA through `qa/support/you.ts`'s `openYou` (the island, then the part tab).
- The iOS keyboard behaviour is proven in Chromium only (TD-252).
- Pre-landing review (qa-reconcile, 2026-10-25): leaving You for sign-in or setup starts no slide; the glass, not only its links, takes the pointer; the keyboard rule skips checkboxes, radios, buttons, ranges and file inputs; between 761 and 959 px the island's width is `min(240px, 50vw − 216px)` so a long name never covers the pill (Arabic's pill is about 360 px). Accepted: during a slide the chrome's transition group draws above an open drawer for the slide's 220 ms, because it is its own group.

---

## ADR-194: A Password Change Rotates the Caller's Own Session (MUT-262, TD-158)

**Status:** Accepted (2026-10-25, MUT-262; plan `.claude/designs/mut-262-rotate-token-on-password-change.md`, eng review D1–D4 answered by Basel). Amends ADR-088's MUT-237 change-password rule ("this session stays signed in") to "this session stays signed in under a new token".

**Context:** `POST /v1/me/password` revoked every other session and kept the caller's, so a leaked copy of the changer's own token survived the change.

**Decision:**
1. **Rotate by a new row.** In the change's transaction the kept session is revoked (`password_rotated`) and a new one opens under a new digest with the same kind, user agent, passkey and `absoluteExpiresAt`; idle is `at + idle`, clamped to that deadline. Not a digest swap: the middleware's stale path revokes by the id it read under the old digest, which must not be the session the person keeps. A digest collision aborts the whole change.
2. **Cookie always, device on request (D1/D2).** A cookie session always rotates (204 + Set-Cookie, Max-Age = time left to the absolute deadline). A device session rotates only with `rotateToken: true` and then gets `200 { token }`; otherwise 204 and kept. Shipped MUT-238 builds keep working, and server and phone ship in any order; the ticket's lock-step release (AC7) is replaced. Old builds' gap: TD-251, closed by MUT-293's floor.
3. **Clients ignore a 401 for a credential they no longer hold (D3/D4).** The portal's API client keeps a credential generation (a 401 waits for an in-flight change and counts only if its request was sent under the current generation); the drawer invalidates every query after success. The phone wraps the change and the Keychain write in `ApiClient.rotating`, so a stale `SESSION_EXPIRED` cannot sign it out and wipe it mid-swap (MUT-208's rule).
4. The audit row `user.password_changed` records `metadata.tokenRotated`. API `1.72.0-mut262`.

**Consequences:**
- `sessionLifetime(kind, settings)` in `server/src/auth/sessions.ts` is the one place a session kind's idle/absolute lifetime is computed (sign-in routes and the change).
- A change whose answer is lost leaves the phone on a revoked token: its next request signs it out, and the person signs in with the new password (copy says so). No server-side grace for the old token, by design.


## ADR-196: Per-User Feature Flags Are Operator Grants in Their Own Table, Read Fresh on Every Request (MUT-433, epic MUT-432)

**Status:** Accepted (2026-10-25, MUT-433; plan `.claude/designs/mut-433-user-feature-flags.md`, eng review D1–D5 answered by Basel).

**Context:** Basel wants to choose, person by person, who may connect their own AI agent to MTB3A over MCP (epic MUT-432). Nothing was per-user: firm features are a per-organization operator timestamp (ADR-099), and `EntitlementGrant` (ADR-160) is per-user but billing-typed and read by coverage.

**Decision:**
1. **A `user_feature_grants` table**, one row per person and feature (`@@unique([userId, feature])`, FK cascade to users). A grant after a revoke re-opens the row; the history is in `audit_events`. Not a JSON column on users (no grantedAt/grantedBy, no "who has it" index); not `EntitlementGrant` (a non-billing row would leak into coverage).
2. **Names are a closed set in code** (`server/src/features.ts`: `agent_access`), stored as text so a new flag needs no migration. An unknown name answers 422 `{ field: 'feature' }`. Reads go through the same list (pre-landing review D2): a name removed from code is simply off on `/v1/me` and in holders; the migration that retires it deletes its rows, so a name brought back later starts empty.
3. **Only the operator writes them**: `PUT`/`DELETE /admin/v1/users/{userId}/features/{feature}` (idempotent; in `admin-users.ts` beside disable/enable, D1), `GET /admin/v1/features/{feature}` (holders), CLI `feature:grant|revoke|list`. Admin user responses don't list flags (D2).
4. **Audited on every profile the person is a member of**, firms included (D4), in the operator's admin audit. Integration keys don't see these rows: `user.feature_granted`/`user.feature_revoked` join `SESSION_ONLY_ACTIONS` in `/v1/audit`, because a person's capability flag isn't financial history and Malafat is a separate product (pre-landing review D3). Written in the change's transaction, only when it changed something; two racing grants change it once (ON CONFLICT DO NOTHING, then a conditional re-open; no exception path inside a Postgres transaction).
5. **A signup waiting for review can't be granted one** (409 `USER_PENDING_REVIEW`, D5); a disabled account can (the flag waits until it can sign in); revoke is always allowed.
6. **Read fresh on every request** (`hasFeature`, store guard `activeFor: sessionOnly`, the rest `operator`). `/v1/me` gains `user.features: string[]` (plain strings, sorted). No cache, so a revoke is seen on the next request. The memory store keeps the map out of `snapshot()`/`restore()`: local mode has no flags and its format is unchanged.
7. API `1.73.0-mut433`.

**Deferred:** (a) a person flagged before joining a firm brings an active flag there with no audit row on it; logging active flags when a membership is created belongs with (b) (pre-landing review D4). (b) Firm-owner consent for agent access to firm data. A per-user flag lets a member's agent read every profile that member can see, with no say from the firm owner. Acceptable for the single-person pilot; revisit at MUT-435 (read tools).

**Consequences:**
- MUT-434 owns enforcement (moved there by D3): 403 `FEATURE_NOT_ENABLED` on every MCP/OAuth request, revoking OAuth grants on revoke, and applying the closure and status gates. It must reclassify `features.activeFor` for its MCP principal (Principal is `apiKey | session` today) or read it unguarded.
- One indexed read per `/v1/me`.

## ADR-197: MTB3A Is Its Own OAuth 2.1 Authorization Server for MCP Agents; MTB3A Still Sends Nothing to an LLM (MUT-434, epic MUT-432)

**Status:** Accepted (2026-10-25, MUT-434; plan and eng review `.claude/designs/mut-434-mcp-oauth.md`, decisions D1–D20 answered by Basel).

**Context:** A person with `agent_access` (ADR-196) may connect their own Claude (Claude.ai connector, Claude Code) to MTB3A over MCP. MCP clients sign in with OAuth 2.1 (MCP authorization spec 2026-07-28: CIMD SHOULD, DCR deprecated but supported, RFC 8707 resource MUST, RFC 9207 `iss` SHOULD). The API had only sessions and API keys.

**Decision:**
1. **Clarifies, doesn't override, the MUT-252 rule:** MTB3A never sends data to an LLM. The person brings their own agent; MTB3A only exposes scoped MCP tools to it.
2. **A hand-rolled authorization server on the portal origin** (`PORTAL_ORIGIN` is the issuer; `<issuer>/mcp` the one resource): `server/src/oauth/{protocol,trust,service,tokens,audit}.ts`, public clients only, PKCE S256 only, opaque tokens stored as `sessionDigest` digests (rotating `SESSION_TOKEN_PEPPER` signs agents out). No OAuth library (D9): every rule below is explicit and tested.
3. **Registration: DCR and CIMD** (D2, D18). CIMD documents are fetched with SSRF guards ported from Malafat MAL-176 (https only, public address at connect, no redirects, 5 s, 10 KB, JSON, `client_id` = URL) and stored as `oauth_clients` rows (`kind`, fetch and stale times ≤ 24 h, OV2). Trust shown on consent is keyed on the **redirect host** (claude.ai/claude.com = Claude; loopback = an app on this computer), never the client's name (MAL-224).
4. **Every once-only step is a conditional claim** (D6): a consent decision, a code exchange, a refresh rotation. A replayed code revokes its grant (RFC 6749 §4.1.2).
5. **Idempotent refresh rotation** (D19, replacing D7): the successor pair is `HMAC(OAUTH_DERIVE_KEY, parent ∥ successorId)`; any re-presentation within 30 s returns the identical pair, so retries and races never disconnect an honest client; after 30 s it revokes the grant and warns Sentry.
6. **Tokens are bound to the resource** (D3, normalised OV4); redirects carry `iss` (D4); loopback redirects match on any port (D8); `read write` are advertised and granted up front (D5 — a deliberate deviation from the spec's "minimal scopes_supported" SHOULD, because writing expenses is the epic's purpose and step-up support in Claude.ai is unproven; a read-only grant stays possible and MUT-436 enforces it).
7. **Lifetimes** (D13, OV7): code 60 s, request 30 min, access 1 h, refresh 45 d idle, grant 180 d absolute. Several live grants per client (OV3); a client that ever had a grant is never cleaned up (OV5).
8. **`/mcp` authenticates per request, uncached:** a live grant for this resource, an ACTIVE person whose account isn't gone (else the grant is revoked), no closure in progress, the `agent_access` flag (403 `FEATURE_NOT_ENABLED`, no step-up hint, OV8). Agents get a **fail-closed store guard** (`agentStoreGuard`: only `read`-class methods); MUT-435/436 open each tool's methods deliberately. `/mcp` is stateless (GET/DELETE 405) and has **no tools** in this ticket (D10). Agent tokens are refused on `/v1` (`PRINCIPAL_NOT_ACCEPTED`).
9. **Revocation:** the person (You › Account › Connect Claude), the flag's revoke (in `features.revoke`'s transaction, OV10), a password change (D11), operator disable and sign-out-everywhere (D12), RFC 7009 `/oauth/revoke`. Audited per membership (`user.agent_connected` / `user.agent_disconnected`, session-only on `/v1/audit`); Sentry hears only refresh/code reuse (warning) and forced revokes (info) (D14).
10. **Ships dark:** Terraform `oauth_enabled` (default false) mounts `OAUTH_DERIVE_KEY` (generated) and schedules the nightly `/jobs/v1/oauth/cleanup`. API `1.74.0-mut434`.
11. **The lapse gate (ADR-181) never blocks connecting or disconnecting:** the four `/v1/oauth/*` routes are `open` in `PERSON_LEVEL_GATE`, like passkeys (identity, no record written). What an agent writes is gated per profile at the tool (MUT-436). Found by the live release-QA run, which signs in people with no billing coverage.

**Consequences:**
- Per `/mcp` call: one indexed token lookup, one feature read, a once-a-minute touch.
- The protocol endpoints rate-limit per Cloud Run instance, like sign-in (TD-253).
- Account recovery, operator `rotate:password` and setup-link locks revoke grants in the same transaction (TD-254, resolved by the review fixes).
- Review fixes (2026-10-25): a CIMD `client_id` with an IP-literal host is refused before any fetch (Node skips the DNS lookup guard for IPs); the token endpoint's per-client limit is keyed on client *and* address, and every OAuth limiter is built and pruned in `index.ts`; a used code trips the reuse revoke only after the verifier and redirect match; cleanup keeps a client with a request newer than its cutoff.
- MUT-435 must decide firm-owner consent (ADR-196 deferred) before a read tool reaches firm data.

---

## ADR-198: A Rollback Deploys the Commit's Existing Image, Never Rebuilds, and Never Pushes Over a Tag (MUT-347)

**Status:** Accepted (2026-10-25, MUT-347; plan `.claude/designs/mut-347-terms-guard-env-rollback.md`, D1 = A by Basel; outside-voice findings folded in).

**Context:** `DEPLOYMENT.md` taught `IMAGE_TAG=<old sha> ./scripts/deploy.sh` as the rollback. deploy.sh always rebuilt the working tree, pushed it under that tag (overwriting the old image in Artifact Registry, which has no immutable tags) and ran today's migrations. The terms guard read production's site whatever the environment, and the working tree's terms.

**Decision:**
1. **Tags are never overwritten.** deploy.sh asks the registry first (`release-image deploy-plan`): a free tag builds; a tag holding this clean HEAD, built with the same portal settings, is reused (steps 1–2 skipped); anything else is refused, unlabelled pre-MUT-347 images included. Every build is labelled `org.opencontainers.image.revision=<full sha>`, `dirty=<bool>` and `portal-config=<sha256 of ENVIRONMENT and every MUTABA3A_* build setting>`: the portal bundle bakes those settings in, so a re-run after deploy.env changed must not reuse the old bundle (pre-landing review). `IMAGE_TAG` only names a fresh build.
2. **`ROLLBACK_TO=<sha|api-vX.Y.Z>`** (`make rollback-server SHA=`) deploys the image the commit already has, found by its short-sha tag and checked by its labels (an unlabelled pre-MUT-347 image warns). It builds nothing, migrates nothing (forward-only) and skips post-roll (HEAD's repairs).
3. **Gates, in order:** clean tree; not with `IMAGE_TAG`; not HEAD; older than what serves (an ancestor of the deployed tag's commit; a newer commit would skip its migration, pre-roll and post-roll); the commit's own terms are live (`git show <sha>:server/src/legal.ts`, strict literal parse; pre-MUT-324 commits need `SKIP_TERMS_CHECK=1`); infra drift (`terraform plan -detailed-exitcode` at the deployed `SERVICE_VERSION` must be empty, else the rollback would ship this checkout's infrastructure); the four release guards; the migration gate (database `_prisma_migrations` against the commit's migrations; each DEPLOYMENT.md "Roll back past" count runs, any above 0 refuses; otherwise the operator types the short sha).
4. **The release's own site.** `terms:check-live` and `email:check` resolve hosts for `MUTABA3A_ENVIRONMENT`; with no staging entry in `config/hosts.json`, a staging release stops loudly.

**Consequences:**
- A registry cleanup policy must keep every deployed tag (noted in `main.tf`).
- The hosted portal rolls back with the image; phone builds that need newer endpoints get 404s until roll-forward.
- A rollback is run from a clean checkout whose terraform matches what serves (normally `main` right after the bad release).
- Not yet drilled for real: MUT-327 drill day.

---

## ADR-199: The Server Re-Reads a Receipt With Self-Hosted OCR When the Device Leaves a Field Empty; Still No LLM, No Third Party (Amends ADR-099 §8 and MUT-252's On-Device-Only Reading; Epic MUT-252)

**Status:** Accepted (2026-10-26, Basel chose option B, "self-hosted server fallback", over staying device-only (A) and an LLM reader (C)). The engine and the trigger are decided in the follow-up story; this ADR sets the rules they must meet. *§1 (device first) superseded 2026-10-28 by ADR-220: the server is the reader; §2–§7 stand.*

**Context:** MUT-253 (spike, ADR-182 draft in `mutaba3a-flutter/docs/spikes/mut-253-ocr-engine.md`) picked on-device engines per platform. They pass the 85% amount/date bar on iOS in all three languages, but Android Arabic dates reach 78.6% (Arabic-Indic digits), and tesseract.js alone misses in the browser (MUT-304). Under D5 a missed field opens empty for the person to type. Every receipt's original is already uploaded and stored by us (`expense_receipts`, MUT-255; the inbox attachment, MUT-116), so reading it on our own server adds processing, not a new copy or a new recipient.

**Decision:**
1. **The device reads first, always.** Phone and portal keep their on-device readers (MUT-256, MUT-301, MUT-304). The server never replaces a value the device filled; it only fills fields the device left empty or below its confidence threshold.
2. **Self-hosted only.** The fallback engine runs in our own GCP project and region (a Cloud Run service or job next to the API), from open models we deploy ourselves. No third-party OCR or document API (Google Vision, Textract, Azure and the like) and no LLM, ours or anyone's. The MUT-252 rule as ADR-197 restates it, "MTB3A never sends data to an LLM", stands unchanged.
3. **Only what is already stored.** The input is the stored original of a receipt the person uploaded. Nothing new leaves the device for this. The read happens after the upload, so a receipt captured offline is re-read once it syncs.
4. **The result is a suggestion, never a record.** It comes back as the shared `ReceiptSuggestion` with its own `readerVersion` (`server-ocr-<engine>-<n>`) and per-field confidence, under the same "empty, never wrong-and-confident" rule (MUT-256 AC 2). The person still reviews and approves; nothing is auto-saved.
5. **No new retention.** Raw OCR text is not stored or logged (Sentry and logs get counts and timings, never receipt text). Only the suggested fields are kept, as the device's are.
6. **The licence must be commercial-safe**, for code and weights (no AGPL in the service, no non-commercial weights), checked in the follow-up story.
7. **Ships dark** behind a server flag, off by default, until the engine passes the MUT-253 fixture bar on the fields it is asked to fill.

**Consequences:**
- MUT-304 (portal photo OCR) may shrink: if the server fallback covers the browser's misses, the WASM bundle can be smaller or deferred. MUT-304 is re-planned against this ADR.
- MUT-256's `ReceiptTextRecognizer` gains no server call; the phone reports which fields it left empty when it uploads, and the review screen updates when the server's suggestion arrives.
- Cloud Run CPU (and memory for the model) per re-read; the volume is bounded by misses, not by every receipt. The stored originals stay under CMEK (MUT-381); the service decrypts through the same key path as the API.
- The privacy policy copy (ADR-186) must say receipts may be read on our servers. No new sub-processor is added. Basel approves the wording.

**Alternatives considered:**
- Device-only (A): rejected; Android Arabic dates and the browser stay manual.
- An LLM reader on the server, ours or a vendor's (C): rejected for now; it reverses the MUT-252 promise and adds a sub-processor. MUT-432's own-Claude path stays the way to get LLM reading, on the person's side.
- A third-party OCR API: rejected; it is a new recipient of receipt images.

**Override log — ADR-099 §8 (partial) and MUT-252's on-device-only reading**: *What*: "there is no server or LLM reading". *Replaced by*: the server may re-read a stored original with self-hosted OCR to fill empty fields; LLM reading stays rejected. *Why*: on-device engines miss Android Arabic dates and the browser, and the original is already on our server. *Date*: 2026-10-26.

## ADR-200: An Agent Reaches Only Profiles Its Person Owns or Co-Owns, Through an Explicit Store Allow-List; One Same-Purchase Rule (MUT-435, epic MUT-432)

**Status:** Accepted (2026-10-26, MUT-435; plan and eng review `.claude/designs/mut-435-mcp-read-tools.md`, P1 and D1 answered by Basel).

**Context:** MUT-434 gave `/mcp` sign-in and a fail-closed agent guard with no tools. MUT-435 adds the read tools a person's own Claude needs before it writes (MUT-436). ADR-196 deferred two questions to this ticket: what an agent may read of a firm, and auditing a flag a person brings into a firm.

**Decision:**
1. **Owned or co-owned profiles only (P1).** A tool reaches a profile through `agentProfile` (`server/src/mcp/context.ts`): a membership AND `ownsProfile` (creator, or a co-owner of a Business profile, MUT-373). A firm or Malafat-fed profile the person only belongs to, another person's profile and an unknown id all answer the same `NOT_FOUND`. An owned profile with firm features on is still reachable: its owner is the firm owner. This closes ADR-196 Deferred (a) and (b) for v1: no firm data a member merely belongs to is reachable, so neither firm-owner consent nor audit-on-join is needed until firms are opened to agents (a future ticket).
2. **The agent guard is an explicit allow-list.** `AGENT_STORE_METHODS` (`server/src/auth/store-guard.ts`) names every store method an agent's tools may call; a method's class alone opens nothing, `read` included (tighter than MUT-434's "any `read`-class method"). A test pins the exact set. Tools run inside the `/mcp` request, so every call passes the guard; their tests drive the real `/mcp` with an OAuth token for that reason.
3. **Read tools need the `read` scope**; without it none is registered. Each description ends by telling the agent to show the person what it found before writing (AC3).
4. **One same-purchase rule** (`server/src/expenses/similarity.ts`): same currency, same amount, dated within 3 days either side; a similar vendor (`scoreVendorName` both ways ≥ 0.6) ranks first, then the nearer date. A missing vendor never excludes. `find_similar_expenses` uses it across one profile, or every reachable profile plus the inbox; MUT-437 imports it and must not redefine it.
5. **Reads write nothing.** `list_categories` never seeds the preset (the REST read does); an empty profile answers `[]` with a hint.
6. **Lists page with opaque cursors, at most 50 a page** (vendors: a typeahead of at most 25; look-alikes: 10, from at most 200 candidate rows per source, flagged `truncated`). Amounts are decimal strings in the currency's own digits (JOD 3).
7. **Failures:** an API refusal reaches the agent as `CODE: message {details}`; an input that fails a tool's input schema gets the MCP SDK's own `Input validation error: …` text. Our bugs (a store method the agent guard refused, a result that drifted from the tool's output schema, anything unexpected) go to Sentry tagged `mcp:<tool>` and the agent gets "MTB3A had a problem…". No REST or OpenAPI change, so `API_VERSION` stays `1.74.0-mut434`.

8. **Pre-landing review (Basel, D1–D7, 2026-10-26):** `/mcp` refuses a JSON-RPC batch (an array body, 400 -32600) before any tool runs, since the rate limit counts requests and protocol 2025-06-18 dropped batching (D1); agent reads follow the lapse gate's LOCKED rule — `agentProfile` answers 402 SUBSCRIPTION_LAPSED for a LOCKED profile and the unscoped look-alike search leaves LOCKED profiles out, as `/v1/entries` does; READ_ONLY reads pass (`agentReadRefusal`, through a narrow `GateStore` on the tool context, D2); a test sweeps `tools/list` and calls every tool that takes a profileId with a stranger's profile (D3); a second limiter per person (`agent-user:<userId>`, 240/min) beside the per-connection one, built and pruned in `index.ts` (D4); offset cursors carry their tool and arguments and refuse any other call (D5); the inbox part of the look-alike search stays a capped scan (TD-258, D6); one `readCapped` loop (D7).
   Re-review (2026-10-26): the batch check reads the body once under the SDK's 4 MiB cap (`readRequestBody`, 413) and hands the transport `parsedBody`; the inbox (`list_inbox`, the inbox part of the look-alike search) follows the person's standing like a session's `GET /v1/inbox`: refused only when every profile is LOCKED (`agentPersonReadRefusal`). A refusal from the per-person limiter still spends one per-connection slot (accepted).
9. **Stored text is data:** the server instructions and every read tool's description say names, titles and notes in results are records, never instructions; a prefix/substring vendor match needs both names ≥ 3 characters.

**Consequences:**
- A stored vendor name or note reaches the agent as data. MTB3A never acts on it; the server instructions and tool descriptions keep the person in the loop.
- `find_similar_expenses` reads at most (reachable profiles + inbox) × 2 pages of 100 indexed rows a call.
- MUT-436 adds its write methods to the allow-list, each with a test.

**Alternatives considered:** every membership plus an audit row on join (rejected for v1: firm owners get no say); firm owner opt-in (deferred: new setting and UI); keeping "any `read` method" open (rejected: it would expose `audit.list`, `users.getById` and the like to an agent for no tool).

## ADR-201: An Agent Writes Through the Same Compose Paths, Marked `captureSource: 'mcp'`; Inbox Writes Wait for the Phone (MUT-436, epic MUT-432)

**Status:** Accepted (2026-10-26, MUT-436; plan `.claude/designs/mut-436-mcp-write-tools.md`, P2–P4 and eng review D1–D8 answered by Basel).

**Context:** MUT-435 gave a person's own Claude read tools. The epic's point is writing: logging receipts and statement lines as expenses, asked first, safe to retry.

**Decision:**
1. **`add_expense` takes a required `destination` with no default** (`{ kind: 'profile', profileId }` or `{ kind: 'inbox' }`): a call without it is refused with the instruction to ask the person (AC1). A profile write runs POST /v1/expenses' compose path (`prepareExpenseCreate`, `withResolvedVendor`, `touchExpenseVendor`: the MUT-227 floor, the MUT-392 ceiling, a choosable category, links inside the profile, vendors as typed) and writes `expense.created` as USER with `captureSource: 'mcp'`, the OAuth client and the grant. An inbox write runs POST /v1/inbox's rules with `captureSource: 'mcp'`; the audit row comes at filing (P4).
2. **Expenses keep their capture source** in a new nullable column (`expenses.captureSource`, P3), set by every create path (REST bodies, receipt approval, inbox filing — which copies the entry's source, review D6). Responses use `StoredCaptureSourceSchema` (inputs + `'mcp'`) on Expense and InboxEntry only; requests keep `CaptureSourceSchema`, so no client can claim `'mcp'`. The local records format (MUT-325 export) leaves it out. API `1.75.0-mut436`. The portal's expense drawer shows "Added by Claude" for `'mcp'` (AC5).
3. **Receipts: a signed PUT in two tools** (`start_receipt_upload` → PUT → `complete_receipt_upload`, P2) over `expenses/receipts-compose.ts`, which the routes now share (type and size, room on the expense, the library's per-person and pending caps, the object verified; MUT-56's scan belongs there). To review only where `RECEIPTS_LIBRARY` is on. A client that can't make HTTP requests is told to send the person to MTB3A.
4. **Idempotency:** a required `idempotencyKey` per call, claimed under `a:<sha256(userId, key)>` (review D7, so a retry after a reconnect replays), through `runIdempotent`, the framework-free state machine the Hono middlewares now also run (review D4/R4). A 4xx refusal is stored and replays as itself; 5xx/429 release the key (OV4).
5. **Gates:** the write scope (write tools aren't registered without it); writability through the session's column (`assertAgentMayWrite`, review D2: no `'agent'` principal); the lapse gate per profile (`agentWriteGate`) and per person for the inbox (`agentPersonWriteGate`); the narrow `GateStore` (D8); the agent allow-list gains exactly the methods these tools call.
6. **Inbox writes ship dark:** `MCP_INBOX_WRITES` (Terraform `mcp_inbox_writes_enabled`, default false) leaves `inbox` out of the tool's schema (OV12) until the phone build that decodes an unknown capture source (tolerant `tryFromString`, Flutter `1f866175`) is live in both stores and the minimum build is raised to it (review D3/D5; before-release.md).

7. **Pre-landing review (2026-10-26):** an agent's receipt starts take the library's start budget and 20-pending cap on an expense too (`assertUploadBudget`; the session's expense route unchanged, TD-261); the agent's idempotency key includes the tool (`a:<sha256(user, tool, key)>`), so one key per source document serves the expense and its receipt; a replayed start whose URL expired is signed again; receipt completion audits the OAuth client and grant.

**Consequences:**
- MUT-437 (matching) can file a statement line onto an existing expense through these paths; MUT-438 stays postponed.
- A Claude.ai chat records expenses but can't attach files (TD-259); receipts can't sit on inbox entries (TD-260).
- An unknown `'mcp'` on a pre-MUT-436 phone build: inbox writes stay off until the minimum build is raised.

**Alternatives considered:** an `'agent'` principal with its own matrix column (review D2: rejected, no behaviour change, two sources of truth); file bytes inline in a tool argument (P2: rejected, the model would emit every byte as output); reading the marker from the audit row (P3: rejected, a read per drawer open, hidden from API keys).

---

## ADR-202: Every Agent Expense Write Checks for the Same Purchase First, Under a Per-Person Lock (MUT-437, epic MUT-432)

**Status:** Accepted (2026-10-26, MUT-437; plan `.claude/designs/mut-437-statement-receipt-matching.md`, eng review D1–D18 answered by Basel).

**Context:** MUT-435 shipped the same-purchase rule (`expenses/similarity.ts`, ADR-200) and `find_similar_expenses`; MUT-436's `add_expense` relied on the agent calling it. A card statement and a folder of receipts describe the same purchases, so an agent working through both would record each one twice.

**Decision:**
1. **The server enforces it.** `add_expense` (both destinations) and the new `file_inbox_entry` run, inside the person's write lock: validate (no writes, D17) → `findLookAlikes` across every profile the person owns or co-owns (LOCKED left out) and their inbox (D4) → write. Any look-alike answers `{ outcome: 'matched', expense: null, candidates }`, a normal result (D5): nothing is written (not even a vendor) and the idempotency key is released (the internal `LookAlikesFound` is not an `ApiError`, so `runIdempotent` fails the claim).
2. **The person answers, the agent retries with the same key.** `notDuplicateOf` (≤100 ids, kept out of the fingerprint) lists the look-alikes the person called a different purchase; they are dropped before the top-10 cut, so each retry shows the next ones and a frequent same-price purchase is recorded once all are answered (D3, D12).
3. **The rule is unchanged and shared (AC4):** a different vendor never excludes, it ranks lower and reads `vendorMatch: 'different'` (D2: Arabic/Hebrew receipts against Latin card descriptors). An inbox entry's vendor for ranking is its note's text before " · " (D16). Each look-alike says `hasReceipt` and `canAttachReceipt` (false for an inbox entry).
4. **Reads that cannot miss:** the expense read filters on currency, amount and the ±3-day window in the database (`ExpenseFilter.amountMinor`); the inbox read is `inboxEntries.listMatchCandidates` with a `(userId, occurredOn)` index (TD-258 fixed, D6).
5. **`file_inbox_entry` (D7):** files a captured entry to a chosen profile through `inbox/file-expense.ts` (`prepareInboxExpenseFiling` + `commitInboxExpenseFiling`, shared with POST /v1/inbox/{id}/file-as-expense, D11/D18), keeping the entry's capture source; it is outside `MCP_INBOX_WRITES` (D10), since filing never creates an 'mcp' inbox row, and runs the same check with the entry excluded (D13). Receipts then attach to the expense it returns.
6. **One write at a time per person (D15):** `agentWriteLock.run(userId, fn)` takes `pg_advisory_xact_lock(437, hashtext(userId))` in an interactive transaction (15 s) while `fn` runs on the pool (memory: a per-person promise chain), so two parallel tool calls cannot both pass the check.
7. **Write needs read (D14):** write and receipt tools register only for a grant with both scopes, so a `matched` answer never shows records to a grant that cannot read.
8. **Descriptions** tell the agent to use the purchase date (not the posting date) and, for a foreign charge, the original amount and currency (D8, D9).

**Consequences:**
- MUT-436's `add_expense` output changes to `{ outcome, expense, candidates, replayed }` (unreleased, so no client depended on it).
- Pre-landing review: waiters must not hold pooled connections (a parallel batch starved the lock holder's own queries and stalled the pool). Same-person calls queue in memory (`KeyedQueue`) and at most 3 lock transactions run per instance (`Semaphore`, `repositories/keyed-queue.ts`) before the advisory lock; `store-prisma-agent-lock-pool.test.ts` proves 8 parallel runs finish on a small pool.
- The session's own filing route keeps no look-alike check (out of scope).

**Alternatives considered:** a different vendor excluding (D2: misses transliterated duplicates); a `confirmedNew` boolean (D3: lets the agent skip the question); an error instead of a result (D5: invites "fix and retry"); an in-process per-person queue (D15: Basel chose the database lock so it holds across instances); destination-only search (D4: one purchase in two profiles).

---

## ADR-203: MTB3A Is iOS, Android and the Web Portal: the Desktop Apps and the Free Web App at /app Are Retired (MUT-445)

**Status:** Accepted (2026-10-26, MUT-445; decided by Basel). Supersedes ADR-016 and ADR-031; retires ADR-001 and ADR-002 with the code they governed; folds in MUT-292.

**Context:** MUT-382 removed `/download`, the installer redirects and the About screen's download rows, but left the Tauri app, its release pipeline and update check, and the free local web app at `/app` that shared its code. MUT-292 planned to retire `/app` 90 days after MUT-291's carry-over shipped; the carry-over's sender (the old app's screen) had not shipped.

**Decision:**
1. **No desktop app.** `src-tauri/`, the `desktop` Vite mode, `deploy.sh`/`deploy.ps1`, `scripts/release.ts` and its steps, the Windows workflow, `release.env.example` and the Tauri npm packages are deleted. `make release web` bumps only `package.json` and its lock.
2. **No GitHub release fetch.** `useLatestRelease`, `useCheckForUpdates`, `useTauriUpdater`, the update banner, the sidebar badge and Settings › About's update rows are gone with the app.
3. **No free web app, now (Basel, 2026-10-26).** Everything under `src/` that only the old app reached is deleted, with Dexie and the PWA. The carry-over's sender goes too: **a free user's records stay in that browser, and the only way across is a records file they already saved**, which the portal's Your data › Restore and `/carry-over/receive` still read. Data loss is accepted.
4. **The website is the landing, privacy and terms.** `src/main.tsx` renders those and sends any other path home; Netlify redirects `/app` and `/app/*` to `/` (301). The apex no longer sends `/app` back to the old host.
5. **The old service worker removes itself.** Everyone who opened `/app` (or the landing, which registered the same worker) runs a Workbox worker that serves the old app from cache. `public/sw.js` is now a worker that, when the browser checks for an update, deletes every cache, unregisters and reloads open tabs into the website.

**Consequences:**
- Release-QA's `web` app is the website; shared UI outside `src/hosted` that only the portal renders moved to the portal app's watch. The carry-over app runs the two portal origins only.
- The portal's receiver still accepts the old landing origin as a carry-over source (`carryOverBuild`'s `web`), though nothing sends from it now (TD-262).
- `src/types/index.ts` still declares the local app's record types that nothing reads (TD-263).
- **Amended 2026-10-27 (MUT-445 follow-ups):** TD-262 and TD-263 are resolved. The receiver's only source is the old run.app portal: `CarryOverSource` is `'portal'`, its one payload is a records file, and `?from=web` goes straight to the file picker. `prepareCarryOver` is gone; the receiver reads the posted file with `readRecordsFile`, which still restores a backup saved from the free app. `src/types/index.ts` is deleted: `Currency` lives in `src/lib/utils.ts`, `MalafatMoment` in `src/lib/malafatSuggestions.ts`, `ReceivableLike` is its own shape in `src/lib/dates.ts`.

**Alternatives considered:** keep `/app` until MUT-292's 90 days (Basel: no); keep `/app` as a carry-over-only bridge (Basel: no, delete it entirely).

## ADR-204: The Reports Verdict Is One Server Read Across a Person's Profiles; Firms the Person Owns Count (MUT-447)

**Status:** Accepted (2026-10-26, MUT-447; epic MUT-446). Narrows ADR-189 D5 to per-profile pages. Plan + eng review D1–D12: `.claude/designs/mut-447-verdict-api-plan.md`. Design doc (office hours, APPROVED): `~/.gstack/projects/vAWK3-mutaba3a/basel-main-design-20261026-111558.md`.

**Context:** Reports becomes account-level: a Glance (one row per profile, what you kept, what you're owed) above an Explore layer, on the portal and the Flutter phone in the same stage. Computing the verdict in both clients would write the money rules twice (TypeScript and Dart).

**Decision:**
1. **One read, `GET /v1/summaries/verdict?from&to`**, person-level (no `X-Mutaba3a-Profile`; gate class `person`, like `GET /v1/entries`). Same date rules and errors as `/v1/summaries/activity` (shared `reportRange` + `readActivityWindow`); the client still owns week bounds (MUT-175 D1). Defaults and `asOf` use the base profile's timezone (D12).
2. **Which profiles (D2):** owned + co-owned (`ownsProfile`) + operator firms where the person's membership is OWNER (`verdictProfilesOf`, kind `FIRM`); never a firm they staff. `shared` = more than one OWNER member; shared lines count in full (R6, provisional). This widens R2 for a person's own Reports only; MUT-435 P1 (what an agent may see) is unchanged.
3. **Basis (R1):** cash — POSTED payments by `receivedOn`, expenses by `occurredOn`; kept = Σ received − spent over every included profile (a personal profile is shown as spent; the sum is the same). Totals per currency (ADR-004) plus one figure in `base` (R4: the oldest personal profile's currency, else the oldest included) at today's ECB rates through `convertToBase`.
4. **Owed matches Overview (D3/D7):** due installments post first through `lazyPostingOf` (SYSTEM): on a person-level read it uses `personPostingActorOf` (SYSTEM, and refuses a request with no identity), while `postingActorOf` stays strict, so `unguarded()` stays pinned to `auth/middleware.ts`. LOCKED profiles are dropped (and listed in `unavailable`) before any posting.
5. **FX down (D4):** never a 503 — per-currency figures, converted null (except when everything is already in base), `rates: null`.
6. **Usual (R8, D9, D11):** median kept over the up-to-6 months before a whole calendar month, counting a month only when every included profile was complete in it (the 7th-day rule, or records before the read window); null below 3 months. The 7th-day rule lives in `server/src/summaries/months.ts` and, because `src/hosted` may not import server code, in `src/hosted/data/reports.ts` too — `reportsMonthParity.test.ts` fails the moment they differ (Basel, during build).
7. **Partial failure:** a profile that fails to read is named in `unavailable` with code `SUBSCRIPTION_LAPSED` or `INTERNAL`, and reported through the new `reportError` context function (`app-shell.ts`, which also logs it) unless it is an ApiError below `SENTRY_RULES.serverReportsStatusAtLeast`; the rest answers with `total.partial: true` and `usual: null`.
8. **Local mode:** registered in the local app's organization-independent set (`routes/summaries` added to `LOCAL_SERVER_ALLOWLIST`; it is already in the chunk through `portal-routes`); `send()` warms reference rates before the cross-tab lock for it (MUT-287 D2). Local profiles hold no agreements, so its posting is a no-op (D10).

**Review amendments (2026-10-26, /review in /qa-reconcile; Basel: fix all 1–15):**
- **Retired currencies (MUT-388):** AED/SAR/QAR/BHD/OMR rows can't be parsed, so they are left out of every sum and each profile lists them in `omittedCurrencies` (was a 500).
- **Base and label from the profiles the person holds:** base (R4) and the kept/businessNet label are chosen from every held profile, LOCKED ones included, so a lapsed personal profile doesn't flip the label or the base currency.
- **Usual:** profiles with no records at all don't block a month; null when nobody has records or the answer is partial. Median in bigint minor units, half away from zero.
- **FX:** any rates failure, not only the expected ones, degrades to `rates: null`; unexpected ones are reported. Rates are read in parallel with the profiles.
- **Load:** profiles are read three at a time (`VERDICT_PROFILE_CONCURRENCY`); `shared` comes from one batched `listOwnersOf`. History is flow-only (received, spent).
- **Accepted by design:** operator orgs that aren't firm-enabled count for every default-OWNER member (D2); the GET posts due installments in Malafat-writer firms too (D3); locally posted items persist only on the next write (D10); co-owned profiles count at 100% (R6).

**Consequences:** API 1.76.0-mut447. Each request reads ≈6N+1 times for N profiles in memory (TD-264). Portal Glance (MUT-448) and phone Glance (MUT-449) consume it; Explore (MUT-451/452) waits for the validation gate MUT-450.

**Alternatives considered:** client-side fan-out per profile (rejected at intake: two copies of the money rules); strict owned + co-owned (rejected: Sader Law Firm and pilot firms would vanish); 503 on FX outage; `period`/`at` query; importing the month rule into the portal (refused by the ADR-097 lint guard).

## ADR-205: Reports Glance Lives at /reports, Shows the Verdict As Sent, and Borrows a Profile for the Shell (MUT-448)

**Status:** Accepted (2026-10-26, MUT-448; epic MUT-446).
- Plan, eng review D1–D10, design review DD1–DD11 and the approved copy: `.claude/designs/mut-448-reports-glance.md`.
- It narrows ADR-189 D5 further, as ADR-204 began. One profile's Reports (`/p/:id/reports`) is now the Glance's drill-down.

**Context:** MUT-447 gives one cross-profile verdict. The portal is profile-scoped (MUT-423 D6), and its shell's pill needs a profile.

**Decision:**
1. **Route:** `/reports`, a child of the authed route outside `/p/:id` (like `/you`). The corner icon links there with `?back=<page>` and is lit on both report routes. A second press returns to `back`, using the island's `backOf` check (MUT-426 D7).
2. **Shell profile (D8):** the `back` profile if it is open and `canReadReports`, else the first profile that is both, else the first open one. A locked profile hides the shell's chrome.
3. **Figures as sent:** the portal does no conversion, summing or median. `data/verdict.ts` only picks which figure a line shows. ≈ appears only when other currencies were converted (DD8). Usual appears only on finished months, because the server sends it for the month in progress too (DD1; the phone, MUT-449, needs the same rule).
4. **Freshness (D9):** the query is under no profile's keys, so it refetches on every visit (staleTime 10 s) instead of being invalidated by saves. The default month asks with no dates, and `asOf` is "today" (D4).
5. **All locked (D7):** decided from `/v1/me` (`billingGateOf`), with no request. A late 402 shows the same LockedScreen.
7. **Profiles no total counts (review, Basel):** firms the person staffs are listed under the ledger as link-only rows ("Not in this total") into their own Reports, and a 404 verdict (nothing counted) shows only those rows. The corner icon opens the Glance for everyone, and no profile's Reports becomes unreachable.
6. **Layout (DD7):** one centred 560px column at every width until MUT-451 adds Explore's column. This replaces the ticket's desktop side area.

**Consequences:**
- No release-order step: the portal ships inside the API image (`server/scripts/deploy.sh` builds `dist-hosted`), so `/reports` and `GET /v1/summaries/verdict` always deploy together. The eng review's C2 assumed separate releases and is withdrawn.
- `report_viewed` gains `layer` (taxonomy 2.3.0).
- A new account can step back into empty months: the verdict carries no `dataSince` (D10; MUT-450 observes it).

**Alternatives considered:**
- `/p/:id/reports` as the Glance (breaks existing links).
- No profile in the shell (the pill disappears).
- Invalidating on every save path (D3, superseded).
- A two-column desktop with a placeholder card (DD7).

## ADR-206: A Person Reverses a Payment and Credits What Is Owed, on Rows a Person Recorded (MUT-453)

**Status:** Accepted (2026-10-26, MUT-453; phone half MUT-454). Plan, eng review and Basel's answers D1–D6: `.claude/designs/mut-453-owner-corrections.md`, Jira comment 12699. Resolves TD-126 (the amount half; ADR-083 fixed the date half). Amends ADR-037 decision 7 (MUT-65/MUT-133 amendments) and ADR-083's consequences.

**Context:** On a profile with no Malafat writer, a person could record money but not correct it once applied. The reverse and credit routes took only an API key, and a key never reaches an owned profile, so nobody could. A wrong amount was fixed once in production with a one-off script (2026-10-26).

**Decision:**
1. **Same routes, more principals (D3).** `POST /v1/payments/{id}/reverse` and `POST /v1/receivables/{id}/credits` accept a session or device session besides the key: one handler, the same codes, audited as `actorType` USER or API_KEY (`actorOf`). No new route, code, migration or store method.
2. **Gate (D1):** the session must hold `payments:write`, the same gate as settle. So `/v1/me` `access.payments` is true by construction; a Malafat-fed profile answers 403 `READ_ONLY_PROFILE` before any lookup.
3. **Rows (D2 narrowed by D5):** a session reaches only rows a person recorded: CAPTURE payments and ADJUSTMENT receivables, whoever captured them (co-owners correct each other's). Malafat's own payments, installments and retainer charges answer 404 to a person, as settle does, because a *disconnected* Malafat firm reads as writer-null. The key keeps its full reach.
4. **Feed (D3):** `entries.settledOwedIds` counts only POSTED payments; a reversal keeps its allocation rows as history. `IncomeResponse` gains `reversalReason` and `credited` (additive). API 1.77.0-mut453.
5. **Undo truth (D6):** Undo on a capture someone else reversed reads that reversal's audit actor: USER → 409 `ALREADY_REVERSED`, otherwise `REVERSED_BY_MALAFAT`. Undo on a credited Owed says "paid or credited" (same code `ALREADY_SETTLED`).
6. **Portal:** the entry drawer (`?payment=` / `?income=`) offers Reverse payment, Reduce amount owed and Cancel amount owed (`CorrectionPane`), each with a required reason; gate `owned && writable && payments read-write` (ADR-066 kept). A partner's row opens read-only with corrections; a reversed payment shows its reason; an Owed lists its credits; a fully credited, unpaid entry reads Cancelled. An undone capture stays gone.

**Consequences:**
- Re-dating and Undo stay per person (ADR-163 D10); correcting is per profile, with the audit naming who.
- The empty-reason answer stays the schema's 422; `REASON_REQUIRED` arrives with MUT-443 for both principals.
- When MUT-305/306 give roles scopes, they decide whether BOOKKEEPER/SUBMITTER hold `payments:write`, and with it these corrections.

**Alternatives considered:** new session-only routes (two paths to drift); owner-only gate with a new `/v1/me` field (settle has no such check); any row on the profile (opens a disconnected firm's Malafat ledger); branching Undo's message on the profile's writer (wrong on a disconnected firm).

**Amendment (qa-reconcile, 2026-10-26, Basel):** decision 2 is **owner-only**. A session corrects money only on a profile the person owns (`ownsProfile`: its creator or a co-owner), checked before any lookup; anyone else, a firm's members and a disconnected Malafat firm's included, gets 403 `READ_ONLY_PROFILE {reason: NOT_OWNER}` (`notOwner()`, now shared from `personal-profile.ts` with the profile routes). `/v1/me` stays truthful without a new field: a person may correct exactly where `owned && access.payments === 'read-write'`, which is the portal's gate. Also from the review: a person's reversal is refused (404) when the capture paid anything but person-recorded entries, so it never reopens an installment Malafat's key applied it to; a person's credit `effectiveDate` follows `pastMoneyDate`; the new IncomeResponse fields are optional (pre-1.77.0 replays); the portal starts a new attempt after a 409 and Cancel reports a partial cancel. Override log: replaces decision 2's "anyone whose session holds `payments:write`"; reason: a firm's staff could otherwise reverse any capture through the API.

## ADR-207: The Portal and the Phone Shape the Verdict From One Contract (MUT-449)

**Status:** Accepted (2026-10-26, MUT-449; epic MUT-446). The phone-side plan, eng review D1–D5 and design review PD1–PD16 are in `~/.gstack/projects/vAWK3-mutaba3a/mut-449-phone-glance-plan.md` and in `mutaba3a-flutter` `.claude/designs/mut-449-reports-glance.md`.

**Context:** ADR-204 keeps every money rule on the server. Each client still shapes the verdict for display: it picks the figure each line shows, decides when a figure is ≈, when to show the usual, the "Leaves out" line, and First Run. The portal does this in TypeScript (`src/hosted/data/verdict.ts`, ADR-205), and the phone does it in Dart (`lib/domain/services/glance.dart`). The two can't share code across languages.

**Decision:**
1. **One contract:** `docs/contracts/verdict-glance/*.json` holds verdict answers, each with the Glance it must make. `scripts/verdict-glance-fixtures.ts` writes the files from the portal's `glanceOf`. Cases are added there, never edited by hand.
2. **Both sides assert it:** the portal's `verdict.test.ts` checks every file. The phone copies the folder into `test/fixtures/verdict_glance/` with `tool/sync_verdict_fixtures.sh`, pins the digest in `SOURCE.sha256`, and its `glance_test.dart` checks its Dart `glanceOf` against every case. This is the Sentry scrub contract's vendored-copy pattern (ADR-091).
3. **The phone reads tolerantly:** an unknown kind, label, code or currency maps to a safe meaning or drops only its own block. So a later server enum needs no minimum phone build (the MUT-436 lesson).
4. **Staff only is only a real NOT_FOUND:** an older server without the route also answers NOT_FOUND, and the phone's API client marks that `routeMissing`. The phone shows it as an error, never as "you own nothing".

**Consequences:**
- Changing the Glance's shaping is a two-repo change: re-write the contract here, re-sync the phone, and fix whichever side then fails.
- Formatting stays each client's own: the portal uses `Intl` whole-unit currency formatting, and the phone puts the symbol first in Latin digits. The contract pins the numbers, not the strings.
- Release order: the API with MUT-447 goes live before a phone build with Reports (`docs/operations/before-release.md`). The portal needs no step (ADR-205).

**Alternatives considered:**
- A one-time copy of the portal's `verdictBody` builder: single-currency, and it can't detect drift.
- Phone-only fixtures, with parity left to one live QA flow (Basel chose D5 A).

## ADR-208: Seeded Category Names Follow the Viewer's Language, Worked Out From the Stored Name (MUT-464)

**Status:** Accepted (2026-10-27, MUT-464). Plan and eng review: `.claude/designs/mut-464-category-names-follow-language.md` (D1–D10, Basel's answers D1, D4, D5).

**Context:** a hosted profile's preset categories were written once, in the language of whoever first listed them. A co-owner or member in the other language saw that language for good. The portal's local mode runs the same routes on a `MemoryLedgerStore` in the browser, so a server-side backfill would never reach it.

**Decision:**
1. **Nothing is stored.** Every preset entry has a `key` (`presets.ts`); `presetKeyForName(name)` maps a stored name, in English or Arabic, back to it. `RETIRED_TEMPLATES` keeps the old legal-only list and the personal "Projects" resolving without seeding them. No column, no backfill, no snapshot migration.
2. **The server names it.** `requestLanguage(c)` (`routes/shared.ts`): the first `ar`/`en` tag of `Accept-Language` by quality, else the account locale; it sets `Content-Language` and `Vary`. `displayCategoryNames` shows a seeded name in that language. When two rows are the same entry, only the oldest follows the language and carries `presetKey`; the other keeps its own name.
3. **One entry per profile.** Both stores refuse a new or renamed category whose name is an entry another category already is (409 `CATEGORY_NAME_TAKEN`), under the same organization lock as the `nameKey` index.
4. **Contract.** `ExpenseCategory.presetKey` (derived, nullable) and API 1.78.0-mut464. The portal sends its UI language on every call and keys both category queries on it. MCP `list_categories` uses the account locale. The records export keeps stored names. The automatic Other is `presetKey === 'other'`.

**Consequences:**
- Changing a template's wording means moving the old pair to `RETIRED_TEMPLATES` under the same key; `presets.test.ts` pins that every name maps to one key.
- A person who types a preset name ("Rent") gets a category that follows the language. That is intended.
- The phone shows `user.locale` names until its half ships (separate ticket).

**Alternatives considered:**
- A stored `presetKey` column with a backfill (the first plan): it misses local mode and needs a migration path for every store (Basel chose D4).
- Translating in each client: two more copies of the strings, and the MCP tools would still need one.

## ADR-210: The API Listens Where HOST Says, an IP Address; Unset Keeps Every Interface (MUT-463)

**Status:** Accepted (2026-10-27, MUT-463). Plan and eng review (D1–D6): `.claude/designs/mut-463-api-host-binding.md`. Numbered 210 because MUT-459 and MUT-464 both claim 208 on their branches.

**Context:** `serve()` was called with no hostname, so every copy of the API listened on every interface. Cloud Run needs that. The local QA copies (portal-live :8790, portal-selfservice :8791, Malafat's :8795) run with admin tokens committed to the repo, and `server/.env.example` ships a placeholder token long enough to pass validation, so while any of them ran, anyone on the same network could call `/admin/v1/*`.

**Decision:**
1. **`HOST` is optional and takes an IP address only** (`net.isIP`): `127.0.0.1`, `::1`, `0.0.0.0`, `::`. A name is refused at boot: Node binds a name to its first resolved address, and on macOS `localhost` resolves to `::1` first, which would break every client that dials `127.0.0.1`.
2. **Unset passes no hostname.** Node then binds `::`, every interface over IPv4 and IPv6, as Cloud Run does today. Never default it to `0.0.0.0`, which drops IPv6.
3. **One start path:** `server/src/listen.ts` `startServer` is the only caller of `serve`. `index.ts` and the socket test (`listen.test.ts`) both use it, so the test covers the production call.
4. **Loopback by default where tokens are known:** the QA harnesses set `HOST=127.0.0.1` and keep their `localhost` origins (the passkey RP ID; browsers and Node fall back from `::1` to `127.0.0.1`). `server/.env.example` ships `HOST=127.0.0.1`; deleting it reopens the dev API to a phone on the LAN. Existing `.env` files are untouched.

**Consequences:**
- Production and the CI container smoke test are unchanged (neither sets `HOST`).
- Malafat's harness follows in MAL-1407 (blocked by MUT-463). On a mini-crm checkout older than this, `HOST` is silently ignored, so MAL-1407 checks that the LAN address is refused.
- A shell that exports `HOST` as a machine name stops every `loadConfig` caller with a message naming the variable.

**Alternatives considered:**
- Accepting any host name: `localhost` would bind `::1` only on macOS (P1).
- `LISTEN_HOST`: clearer, but the ticket and MAL-1407 name `HOST` (review OV-5).
- Leaving new dev setups on every interface (the plan's first D4; Basel chose review D4 A).

## ADR-211: The API Refuses the Placeholder Secrets From server/.env.example (MUT-472)

**Status:** Accepted (2026-10-27, MUT-472; found in the MUT-463 review, finding OV-2). Plan: `.claude/designs/mut-472-placeholder-secrets.md`. Basel chose the scope and the QA-token answer.

**Context:** `server/.env.example` ships `replace-with-32-plus-…-from-secret-manager` for `MUTABA3A_ADMIN_TOKEN` and `SESSION_TOKEN_PEPPER` (and, commented out, `OAUTH_DERIVE_KEY`). Each is longer than the 32-character minimum, so a copied example booted. `/admin/v1/*` then answered to a token anyone can read in the repo, from the network too when the `.env` predates MUT-463's `HOST`.

**Decision:**
1. **Every 32-character secret goes through one schema helper,** `secret(name)` in `config.ts`: `MUTABA3A_ADMIN_TOKEN`, `SESSION_TOKEN_PEPPER`, `FRONT_DOOR_TOKEN`, `MUTABA3A_JOB_TOKEN`, `OAUTH_DERIVE_KEY`. It keeps the 32-character minimum and refuses a value starting with `replace-with-` (any case), naming the variable and how to make a real one.
2. **Prefix, not exact strings:** the misspelled admin placeholder and any placeholder added later are covered without a list to keep in step.
3. **The committed QA tokens are not refused**, whatever `HOST` is. Server config would have to list test fixtures; MUT-463 (ADR-210) pins the QA harnesses to 127.0.0.1; the CI smoke container has to bind every interface.

**Consequences:**
- A developer whose `.env` still holds a placeholder gets a boot error and must put real secrets in (`server/README.md` "Run locally" has the one-liner).
- Production is unaffected: Terraform generates every one of these secrets with `random_password`.
- A new secret added to the schema should use `secret(name)`.

**Alternatives considered:**
- Matching the exact `.env.example` strings: misses a fixed typo or a new placeholder.
- Blank values in `.env.example`: a fresh clone then fails on a missing value instead of a placeholder, and the example no longer shows what goes there (left out of this ticket).
- Refusing the QA tokens off loopback: decision 3.
## ADR-212: Operators Are Accounts With a Passkey, Behind One Gate on /v1/operator (MUT-459)

**Status:** Accepted (2026-10-27, MUT-459; epic MUT-458). The plan, eng review D1–D9 and design review 1A–19B are in `.claude/designs/mut-458-operator-console.md`.

**Context:** every operator task ran through the admin token (`MUTABA3A_ADMIN_TOKEN`, Secret Manager) from a laptop with gcloud. The token carries no identity (MUT-367 D15: `decidedBy` is `admin-token`), so it can't back a portal page. Self-service signup is open, and signups wait until the operator is at a terminal.

**Decision:**
1. **An operator is an account with a mark.** The mark is `users.operatorAt`, not a feature flag: flags are product switches that MUT-462 lets operators change, so an operator flag would let one operator mint another. Only the admin token sets the mark: `PUT/DELETE /admin/v1/users/{id}/operator`, and `users.ts operator-grant|operator-revoke`. A grant refuses an account that is PENDING_REVIEW, DISABLED, or has no passkey (409 CONFLICT `OPERATOR_NEEDS_PASSKEY`). `/v1/me` names `user.operator: true` only for an operator; for everyone else the field is absent.
2. **One gate on `/v1/operator/*`.** The routes sit behind the normal /v1 `authenticate()`, so a signed-out caller gets the usual 401 (which says nothing about operators) and the portal signs them in and brings them back. `operatorGate` (`auth/operator-gate.ts`) then answers 404 to a signed-in non-operator, the same as a path that doesn't exist. The routes are cookie-session only: `operatorGate` answers 404 to a device session too (authenticate() admits both as `session`), and no API key gets in. They are organization-independent and open under the lapse gate: a lapse on the operator's own account never locks the console (D2). The mark is read from the user row authenticate() already loaded, so a revoke takes effect on the next request.
3. **Every operator write needs a passkey step-up within 10 minutes; a password never counts (D7).** A write passes only while `sessions.stepUpAt` is under 10 minutes old. Only a passkey sets it: a passkey sign-in creates its session already stamped, and a step-up here stamps it. A password-change rotation starts the new session unstamped (pre-merge review: inferring the proof from `createdAt` let a password change reopen the window). An operator adds, renames or removes a passkey only after a passkey step-up, never on a fresh password sign-in, and keeps at least one (409 `OPERATOR_NEEDS_PASSKEY`, counted inside the removal under the person's row lock so two removals can't race past it). An operator's account can't be closed from the portal (409 `OPERATOR_ACCOUNT`); the CLI removes the mark first. Pre-merge review: otherwise a password could add a passkey and step up with it, or strip every passkey and lock the operator out. Any password change clears `stepUpAt`. The portal's Passkeys drawer tells an operator to confirm with a passkey instead of asking for the password (TD-266). Otherwise it answers 403 `RECENT_SIGN_IN_REQUIRED {method:'passkey', windowMinutes}`. The step-up (`/v1/operator/step-up/options` → `/v1/operator/step-up`) uses a `step_up` challenge bound to the person, with `allowCredentials` set to their passkeys, and verifies through `verifyAssertion`. Any refusal is 403 `PASSKEY_NOT_ACCEPTED`, a cloned counter included. It stamps `stepUpAt`, conditional on the session still being live, and never `credentialsVerifiedAt`: that column guards the password-change revocation (MUT-237/238), and a step-up must not revive a session a lock or a password change just ended. Those two routes are the only writes exempt from the step-up. A step-up is audited (`user.operator_stepped_up`); a cloned authenticator caught there is audited as at sign-in (`user.passkey_counter_regressed`), and a refused one logs a warning.
4. **One action module, two adapters.** `server/src/operator/actions/*.ts` holds each action, taking an `OperatorActor`: the token or `{operator, userId}`. `/admin/v1/*` passes the token; `/v1/operator/*` passes the signed-in operator. Results are therefore the CLI's by construction. Each ticket extracts only what its page uses (D9): MUT-459 does signup reviews, MUT-461 accounts, and MUT-462 billing, flags and firms.
5. **The operator acts as themself, on the unguarded store.** Audit rows keep `actorType: 'ADMIN'` with `actorId` set to the operator's id (the token keeps `null`). `decidedBy` / `grantedBy` store `operator:<id>`; the token keeps `admin-token` / `admin`. The store guard refuses `operator` methods to every principal (ADR-037 decision 7). So the operator routes, like /admin, run on the base store, reached only through `operatorGate`. They are the one session surface allowed to.

**Consequences:**
- Getting started takes two steps: Basel adds a passkey to his account, then runs `live-admin.sh operator-grant <email>` (`docs/operations/before-release.md`). The CLI stays the fallback, unchanged.
- An operator who deletes their last passkey can't act until they add one again. The step-up options answer 409 `OPERATOR_NEEDS_PASSKEY`.
- The OpenAPI spec lists the `/v1/operator` paths, as it already lists `/admin/v1`. Their existence is no secret; their access is.
- `GET /v1/operator/signup-reviews` returns `stepUpUntil`, so the portal can label the confirm "with passkey" before the tap. iOS Safari needs the passkey prompt to come straight from a tap, never from a 403 round trip (design 1A).

**Alternatives considered:**
- A `FEATURES` entry `operator` (no migration), rejected because flags are operator-grantable product switches.
- `/operator/v1/*` with its own 404-for-everything mount (the ticket's first wording). Rejected because it needed an SPA exclusion, a dev-proxy entry, a 401→404 remap and its own CSRF reasoning, and it would hide an expired session as "not found" (outside review O3–O6).
- A password step-up for operators without a passkey. Rejected because it leaves a fresh password sign-in enough to act, weaker than the token it replaces (outside review O1).

## ADR-213: The Operator Console Lives in the Portal, With the Step-Up on the Same Tap (MUT-460)

**Status:** Accepted (2026-10-27, MUT-460; epic MUT-458). Plan §3 MUT-460 and design spec §3b in `.claude/designs/mut-458-operator-console.md`. Builds on ADR-212.

**Context:** MUT-459 gave operators an identity and `/v1/operator/*`, but signups were still reviewed from the CLI. The digest mail named a command, so a signup waited until Basel was at a terminal.

**Decision:**
1. **Inside the portal, outside any profile.** `/operator` (redirects to `/operator/signups`) is an authenticated route rendered in `HostedShell profile={null}`: the You island is the way out, and You › Account › "Operator" (`RowNavLink`, operators only) is the way in. A non-operator gets what every unknown path gets (a redirect home) and the server's gate refuses them regardless. Signed out, the portal runs on the device (local mode) and AuthGate never asks for a sign-in, so the route sends a signed-out visitor to `/sign-in?next=/operator/signups` itself (AuthGate's `RedirectToSignIn`, now exported): the digest link works from a browser that isn't signed in. `OperatorLayout` is a title plus `SectionTabs` with counts; MUT-461/462 add Accounts and Firms tabs.
2. **The step-up runs on the tap that says it will.** The list GET's `stepUpUntil` decides the confirm's label at render: fresh (more than 30 s left) acts directly; stale reads "Approve with passkey" and the same tap runs options → the system sheet → `/v1/operator/step-up` → the action (`src/hosted/operator/stepUp.ts`). A 403 on a direct action never starts the sheet by itself (iOS Safari needs a user gesture): the confirm offers "Confirm with passkey" instead. A cancelled sheet changes nothing and says nothing; a refused passkey, no passkey on the account (link to Passkeys) or a failure says so in the row. A step-up made on the page is remembered by `OperatorStepUpProvider`, so the next action acts directly before the list is read again. `useOperatorRun` / `OperatorConfirm` are what MUT-461/462 reuse.
3. **Decisions read like the CLI's, in the row.** Rows reuse the passkey row recipe; chips map every signup-screen reason code to ar/en words (unknown codes shown raw, `dir=ltr`). A decision whose mail didn't go stays as a warning with a `CopyField` (and Send again, after an approval); 409 ALREADY_DECIDED (or a 404) says "Already decided" and re-reads the list; 409 NOT_EMPTY says the account has records.
4. **The digest links to the page.** With `PORTAL_ORIGIN` set, `review-digest` carries a "Review signups" button to `<PORTAL_ORIGIN>/operator/signups`; the CLI line stays as the fallback. Sign-in with `?next=/operator…` makes the passkey the primary button, so the digest flow is one passkey prompt (a passkey sign-in opens the step-up window, ADR-212).

**Consequences:**
- The CLI stays, unchanged. The digest names both.
- The list reads one page of 200 (the server's maximum). A queue that long is not expected; paging can come with MUT-461's accounts list if it ever is.
- Release-QA: `portal-selfservice/operator.yaml` (four features) on the live API with Chromium's virtual authenticator; the operator paths moved from the stubbed `portal` app's watch to `portal-selfservice`'s.

**Alternatives considered:**
- A step-up sheet opened from the 403 (the plan's first `OperatorStepUpSheet`). Rejected in design review (1A): the system prompt must come straight from a tap, and the label should say a passkey is coming.
- A separate operator app or route tree outside `authedRoute`. Rejected: sign-in, `next`, the shell and the language already work here.

## ADR-214: Mails Carry Static Art Served by the Portal; the Mail Frame Is a Mood Band, a Chip and a Headline (MUT-468)

**Status**: Accepted (2026-10-27, MUT-468, epic MUT-466; Basel's intake, plan and eng-review answers D1–D3, R1–R2).
**Context**: Every transactional mail used one plain frame (ADR-174, the MUT-359 brief §3.3/§8.4: "no images, no pixels, nothing fetched"). Self-service signup made those mails the first thing a customer sees after the landing page; Basel asked for colour, our icons and illustrations. Claude Design produced the kit (MUT-467, frame 1b "full-bleed").
**Decision**:
1. **Override log (replaces the MUT-359 brief §8.4 "no images, nothing fetched", 2026-10-27).** A mail may show pictures, only static, versioned PNGs from `<PORTAL_ORIGIN>/mail/v1/`: the same URL for every recipient, no query string, no per-person part, so a picture can't act as a tracking pixel. `templates.test.ts` allows `<img>` only from that path and only files `look.ts` names; every picture has alt text and a size, and every mail still reads fully with images off. ADR-159 §5 (no amounts, currencies or money dates) is unchanged.
2. **The art is served by the portal, not the website** (eng review D2). The files live in `src/hosted/public/mail/v1/` and ship in the API image with the code that points at them; `app.ts` caches hits under `/mail/` immutably like `/assets/`, and a miss still falls to the SPA shell, `no-store`. Reason: mtb3a.com answered 401 on every path on 2026-10-26, and a website release can lag the API's. `v1` is never rewritten; changed art goes in a new folder.
3. **The frame**: each customer mail has a look (`server/src/email/templates/look.ts`: mood, header art, chip). The mood tints a band behind the wordmark and art; the card rises out of it with the chip and an `<h1>` headline; a hidden inbox preview line opens the body. The operator digest stays plain. Inline styles only, no `<style>` block (no phone-specific sizes).
4. **Copy** (Basel D2 at planning): the kit's shape (headline, preview line, body, one button, note) with its sample facts corrected; subjects unchanged word for word. The passkey name and the deletion day sit in a details panel and in the text part.
5. **Footer** (Basel D3): the password line, "sent to <recipient>", and a Privacy link from the new `WEBSITE_ORIGIN` (Terraform, stage live; optional). Production with `MAILER=resend` refuses to start without `PORTAL_ORIGIN`.
6. **Contrast**: the secondary ink `#564E68` misses 7:1 on the mood tints (6.3–7.0), so it appears only on the white card and the canvas; tints carry ink-coloured text. `TEXT_PAIRS` and a test enforce it.
**Consequences**: one release carries art and frame together; a portal outage takes the art down with the product it belongs to. Regression contract (eng review D3): the MUT-359 template rules stay unchanged; no golden snapshots. Client checks (Gmail, Apple Mail, Outlook) are by hand with `npm --prefix server run mail:preview -- --send <inbox> --yes`; mail is live in production, so they run right after the release that ships the frame (before-release.md), with a server rollback if a client renders it broken. Known: the opaque art shows as pale squares in Gmail and Outlook dark mode.
**Amendment (2026-10-27, Basel's Apple Mail check):** Apple Mail repainted the live mails dark around the opaque art, because `color-scheme: light` is a preference, not an opt-out. Every mail now declares `light only` (the `color-scheme` and `supported-color-schemes` metas, and inline on the body and the outer table), which Apple Mail and iOS Mail honour: they show the light design in dark mode. Gmail's and Outlook's dark modes ignore any opt-out; MUT-484 (transparent art, chip tile as a cell) is the fix there.
**Amendment (2026-10-28, MUT-484):** the served art moves to `mail/v2` (`MAIL_ART_PATH`), re-exported from the kit with transparent backgrounds. Headers keep the kit's halo, a thin outline in the band colour that shows as a pale sticker edge in dark mode (Basel's call). Chips keep their round tile with transparent corners: a small pastel circle in dark mode, not an HTML tile cell (supersedes the MUT-484 plan's D2/D5). v1 is never rewritten and is pinned by SHA-256 in `look.test.ts`. Brief: `.claude/designs/mut-484-transparent-mail-art.md`.
**Alternatives considered:**
- Art on the website (mtb3a.com/mail/v1), the intake's first answer. Rejected at eng review: separate release, separate outage.
- Inline CID attachments: heavier mails, and some clients list them as attachments.
- Golden HTML snapshots of all 28 mails: rewritten by every copy edit.

## ADR-215: The Operator's Accounts: One Action Module, Never Your Own Account, the Reset Link Shown Once (MUT-461)

**Status:** Accepted (2026-10-27, MUT-461; epic MUT-458). Plan §3 MUT-461 and design spec §3b (17A, 3A, 4A, 5A, 12A) in `.claude/designs/mut-458-operator-console.md`. Builds on ADR-212 (decision 4) and ADR-213.

**Context:** the account actions (lookup, disable/enable, sign out everywhere, the setup link) lived as closures inside `admin-users.ts`, with the token hardcoded as the actor. The console needs them with the operator as the actor, plus an account view the CLI never had.

**Decision:**
1. **Extracted, not rewritten.** `server/src/operator/actions/accounts.ts` holds the actions; `/admin/v1/users` and `/v1/operator/accounts` are adapters (ADR-212 decision 4). The admin route tests pass unchanged; a parity test compares the two answers and audit trails row for row.
2. **Never your own account (E10, widened).** The console refuses every account action on the operator's own account with 409 `OWN_ACCOUNT`, not only disable and sign out: a reset with lock would sign them out too, and their own password is You › Account's. The portal shows the rows inert with the reason. The CLI is unchanged.
3. **Every action is audited.** Sign out everywhere now writes `user.sessions_revoked` `{revoked, agentGrantsRevoked}`, for the token too (the AC: "every action … audited with the operator's id"). Like `user.agent_disconnected`, it is a security event about the person, so it is one of `SESSION_ONLY_ACTIONS`: API keys' `/v1/audit` (Malafat) never lists it (/qa-reconcile D1, Basel). Disable answers the admin `{user}` plus `sessionsRevoked` / `agentGrantsRevoked`, so the result can say what it ended.
4. **A missing account is `NOT_FOUND` with `details.reason ACCOUNT_NOT_FOUND`,** not a new error code: `QueryView`'s `notFound` slot shows "No such account", and its `/v1/me` refetch also covers a revoked operator (design 3A). Search never 404s: no match is 200 `{account:null}`.
5. **The reset link is shown once, in the page's state.** It never enters a query, the URL or a toast, and leaving the page discards it (design 12A). The portal asks for 24 hours (the CLI's default stays 72) with "Lock the current password" on by default.
6. **The account view counts what an action would end:** `activeSessionCount` (`sessions.countLiveForUser`: unrevoked, neither deadline passed, either kind) and `agentGrantCount` (live grants). Last sign-in is `users.lastSignInAt`, so no new column (the plan's `sessions.lastCreatedAt` wasn't needed).

**Consequences:**
- The design's "Disabled ‹date›" banner shows no date: no column records when an account was disabled (TD-269).
- MUT-462 adds the Billing and Features groups to the same page, from the same action-module pattern.

**Alternatives considered:**
- A new `ACCOUNT_NOT_FOUND` error code. Rejected: a reason on `NOT_FOUND` says the same, and every client already handles 404.
- Allowing a reset link on your own account without `lock`. Rejected: the console isn't where you manage your own account, and one rule is easier to trust.

---

## ADR-216: The Operator's Billing Grants, Feature Flags and Firm Requests: Three More Action Modules, Never Your Own Account (MUT-462)

**Status:** Accepted (2026-10-27, MUT-462; epic MUT-458's last step). Plan §3 MUT-462 and design spec §3b (5A, 14A, 15A, 16A) in `.claude/designs/mut-458-operator-console.md`. Builds on ADR-212 (decision 4), ADR-213 and ADR-215.

**Context:** billing grants (MUT-358), per-user flags (MUT-433) and firm requests (MUT-300) were CLI-only, written as closures in `admin-billing.ts`, `admin-users.ts` and `admin.ts` with the token as the actor (`actorId null`, `grantedBy 'admin'`).

**Decision:**
1. **Extracted, not rewritten.** `server/src/operator/actions/{billingGrants,features,firms}.ts` hold the actions; the admin routes and `/v1/operator` are adapters. The admin suites (`billing-routes`, `user-features`, `routes-admin-firm`) pass unchanged; parity tests compare the console's answers and audit rows with the CLI's.
2. **The operator is the actor.** Grants record `grantedBy operator:<id>` and audit `actorId <id>`; flags the same; the firm repository already took an audit actor (`FirmAudit.actorId`), so `setFirm` / `declineFirmRequest` needed no port change, only a non-null actor.
3. **The console's grants cover a person.** `POST /v1/operator/accounts/{userId}/billing-grants` grants the person's own profiles (the `userId` target), and the account page lists that person's grants, revoked ones included. A one-profile grant (`organizationId`) stays a CLI action; revoking from an account only reaches that account's grants (another's is 404).
4. **Never your own account (E10, as ADR-215).** Granting yourself coverage or a flag answers 409 `OWN_ACCOUNT`; the rows show inert with the reason.
5. **The flag list comes from the server.** The account view carries `availableFeatures` (`FEATURES`), so a new flag shows in the console with no portal change (by its code until it has words). Turning a flag on acts at once; turning one off confirms first.
6. **Firm requests:** `GET /v1/operator/firm-requests` (as the admin list) and `GET …/{organizationId}` (the request plus the profile's members with role and status, for the owner picker: outside finding O7). Enable and decline act only on a pending request; otherwise 404 with `details.reason FIRM_REQUEST_NOT_FOUND`. An owned Business profile keeps its owners (MUT-300 D4); an operator firm's owners are chosen from its active members.

**Consequences:**
- Declining a firm request sends no mail (none exists): the owner sees the offer again on the profile. The design's "we tell the requester" became "its owner can ask again".
- `admin.ts`'s firm decline now adds `details.reason FIRM_REQUEST_NOT_FOUND` to its 404 (additive).
- Enable checks the request is pending and then switches, in two steps (TD-270).

**Alternatives considered:**
- Granting a profile (`organizationId`) from the console. Rejected for now: the account page is about a person, and profile-level grants are rare operator fixes.
- A copy of `FEATURES` in the portal. Rejected: the server's list is the one list.

## ADR-218: A Project's Figures Are in Its Own Currency; a Matter's Other-Currency Owed Counts in Its Own Block (MUT-488)

**Status:** Accepted (2026-10-27, MUT-488). Applies ADR-004.

**Context:** an Owed can be captured in any currency on any matter (`income/compose.ts` checks the currency only for a Received under `linked-required`). The customer and project summaries built a matter's figures from all its receivables and formatted the sum in the matter's currency.

**Decision:**
1. **A project's figures count only receivables in the project's currency:** posted, paid, credited, buckets and status, on `GET /v1/summaries/projects/{id}` and on the project rows of the customer summary. The wire keeps one currency per project.
2. **In the customer summary, a matter's Owed in another currency counts in that currency's block,** like an Owed with no matter: in the block's totals and status, with no project row there. A currency with only such an Owed still gets a block (unless the Owed is dated ahead, MUT-392).
3. So the customer summary, the organization summary and the customer statement (MUT-478) give the same figure per customer and currency.

**Consequences:** the project summary doesn't show a matter's Owed in another currency, and the matter's status ignores it (TD-273).

**Alternatives considered:**
- One block per currency on the project summary. Rejected for now: it changes the shape Malafat and the phone read, for a case only an Owed can create. TD-273 records how to add it without a break.
- Refusing an Owed whose currency differs from its matter's. Rejected: a person may agree a fee in another currency on the same matter, and money keeps the currency it was agreed in.

## ADR-219: A Customer's Overdue-Since Date Reads the Same Rule as the Overdue Bucket (MUT-482)

**Status:** Accepted (2026-10-27, MUT-482; Basel's eng-review answers D1–D3). Applies ADR-033 (one definition per figure) and ADR-004.

**Context:** Malafat's Money overview sorts its chase list by how long each client has been late. Malafat may not derive dates or money from receivables (Malafat ADR-150), so the summaries must say it.

**Decision:**
1. **`oldestOverdueDueDate` and `daysOverdue`** on each customer row of the organization summary and each currency block of the customer summary: the earliest due date among the receivables counted in that `overdue`, and the whole days from it to `asOf`. Both null exactly when `overdue` is 0. MUT-470's `oldestOverdueOn` name is not used (closed as a duplicate).
2. **One rule:** `dayBucketOf(receivable, today)` in `summaries/compute.ts` decides which day bucket a receivable falls in, or none; `bucketize` and `oldestOverdueDueDate` both read it, so the date and the amount can't disagree.
3. **No new reads:** both are computed over the lists each summary already loads.
4. A part-paid overdue receivable keeps its date (it is still late); paid or credited in full, it no longer counts.

**Consequences:** the organization-level currency block and project rows carry no date yet; each can be added the same way as an additive field.

**Alternatives considered:**
- A separate loop beside `bucketize`, checked by a property test. Rejected (D2): the rule would be written twice.
- A date field inside `Buckets`. Rejected: an amount struct shared by every project figure and test, for a value only two rows need.

## ADR-217: The Customer Statement Is Computed per Request, and Receivables Are Numbered CHG-YYYY-NNNN (MUT-478)

**Status:** Accepted (2026-10-27, MUT-478; epic MUT-25). Plan: `.claude/designs/mut-478-customer-statement.md`. Unblocks Malafat's client ledger card (MAL-1425).

**Context:** Malafat's client money page becomes a ledger card (כרטסת): dated debit and credit lines with a running balance. Malafat may not add up a balance itself (Malafat ADR-150), and receivables had no reference a partner could reconcile by.

**Decision:**
1. **Receivable numbers are CHG-YYYY-NNNN** (Basel, D1), gap-free per organization and year of `postingDate`, from a `receivable_counters` row taken inside the posting transaction, exactly as payments' PAY- numbers (`payments/numbering.ts` holds both). Every receivable is numbered, an Owed included. The migration backfills existing rows in (postingDate, postedAt, id) order, and a BEFORE INSERT trigger numbers whatever the previous revision inserts during the roll, so the NOT NULL never refuses the old image (PATTERNS: never a constraint the previous image can't satisfy; dropped later, TD-272); the portal's local mode numbers a device's receivables the same way (snapshot format 8 → 9) and the hosted export carries the counters.
2. **The statement is computed, never stored.** `receivables.statementSources` reads the customer's rows in one currency (six queries on Prisma, none per row); the pure `statements/build.ts` orders them, folds what lies before `from` into the opening balance, cuts after `to`, runs the balance and slices a page. Computing the whole period on every request is what keeps `openingBalance`, `totals` and `closingBalance` identical on every page and the running balance continuous (D3, D4).
3. **Which lines count:** a charge counts when the summary counts it (`countsOn`), so with no project and no period the closing balance equals the customer summary's outstanding − unallocated (AC1). Credits are their own lines; a reversed payment shows its PAYMENT line and a PAYMENT_REVERSAL dated by the reversal's day in the organization timezone. A capture the person undid (`capture_undo`) is left out entirely (D2). Nothing else is netted away.
4. **Order:** (date, created, kind rank, id), stable on every call; a payment before its own reversal on the same day. Charges are dated by `postingDate`, credits by `effectiveDate`, payments by `receivedOn`.
5. **A project statement** shows the project's charges and credits and payments as their allocations there, dated by the payment's `receivedOn`. Unallocated money appears only on the whole-customer statement (D8).
6. **The route** is `GET /v1/customers/{customerId}/statement`, scope `payments:read`, open to API keys, sessions and device sessions like the other reads, so local mode serves it too (D9). Contract 1.83.0-mut478.

**Consequences:**
- A MUT-444 correction reposts on the original posting dates, so its reposted charge sorts before the credit dated today. The balance moves by exactly the difference (AC3), but the lines read "charge, …, credit", not "credit then repost" as the ticket's wording suggests.
- Past ~20k lines for one customer the per-request pass gets slow (TD-271).
- PAYMENT lines carry the PAY- number; the receipt number arrives with MUT-481.

**Alternatives considered:**
- A stored ledger table maintained on every write. Rejected: a second source of truth for money that every writer would have to keep in step.
- SQL window functions for the running balance. Rejected for now: local mode runs the memory store, so the JavaScript pass is needed anyway; it is the TD-271 upgrade path.
- One sequence with no year (CHG-000123). Rejected by Basel: unlike PAY- numbers.

## ADR-220: The Server Is the Receipt Reader (Amends ADR-199; MUT-441, Epic MUT-252)

**Status:** Accepted (2026-10-28, Basel; MUT-441 plan and eng review R-D1, R-D2, R3–R10, D1–D7). Plan `.claude/designs/mut-441-server-ocr.md`, benchmark `.claude/designs/mut-441-bench.md`. Built, merged dark (`server_ocr_enabled = false`); API 1.84.0-mut441.

**Override log (ADR-199):**
- **What changes:** ADR-199 §1, "the device reads first, always; the server only fills what the device left empty", becomes: **the server reads every uploaded receipt that has no suggestion yet**, from the phone and the portal. The phone's Scan button (a Flutter ticket) only captures, straightens, cleans and uploads in grayscale (D4); it does no OCR.
- **Why:** the device engines miss the bar where it matters (MUT-253: Android Arabic dates 78.6%; the browser alone misses more, MUT-304), two device engines are two rule sets to keep in step, and every original is already stored on our server, so reading it there adds processing, not a recipient. On the synthetic set the server reaches the bar in all three languages with no wrong-and-confident field.
- **What replaces it:** this ADR. ADR-199 §2–§7 (self-hosted, only what is stored, a suggestion never a record, no new retention, commercial-safe licences, ships dark) stand unchanged.
- **Date / who:** 2026-10-28, Basel.

**Decision:**
1. **Trigger (D1, R-D2, R8).** `complete` sets `readStatus = PENDING` in its own UPDATE and asks a `ReadDispatcher` to read (best effort; a failed enqueue is logged and the sweep catches it). Production uses Cloud Tasks; dev, tests and release-QA run the read in process (`InlineDispatcher`; config refuses it in production and staging). **One job route**, `POST /jobs/v1/receipts/read`: `{receiptId}` reads that receipt (a task), no body is the 5-minute Scheduler sweep, which only re-asks with tasks named `<receiptId>-<attempt>` and gives up (FAILED `exhausted`) after 3 attempts or 30 minutes from the first claim (`readFirstClaimedAt`; a receipt never claimed is never given up on by time, MUT-441 review). The route takes **only a Google-signed OIDC token** (audience = the API's URL, email = the queue's or the sweep's own service account), never the shared `X-Job-Token`, which would open `/jobs/v1/accounts/purge` to anyone who could read a task's headers. A 90 s lease (over the 60 s dispatch deadline) stops double reads; every end state answers 2xx.
2. **The reader** is `receipt-ocr`, our own Cloud Run service (`server/ocr`, Python: RapidOCR PP-OCRv5 on ONNX Runtime beside Tesseract 5 ara/heb/eng fast; pypdfium2 for text-layer PDFs). **Decode caps (R3):** 40 MP checked from the header before decoding, 2 PDF pages and a rasterised-size cap, a 30 s deadline, one read per instance; too big or undecodable is a terminal FAILED `unreadable`. Cold start is min 0 instances plus `startup_cpu_boost` (R4); `min_instances = 1` is the upgrade if pilots find the first read slow.
3. **Sandbox and egress lock (R9).** The service's account holds no roles; only the API's account may invoke it; non-root, read-only filesystem, models baked in. Direct VPC egress `ALL_TRAFFIC` into its own subnet with no Cloud NAT, no default route and a deny-all egress rule at priority 0; a tftest asserts all three. The API calls it with an ID token for its URL; a local http sidecar takes none.
4. **Extraction in the API, in TypeScript (D2)**, pure functions under `server/src/receipts/extract/`; a field under 0.6 confidence stays empty (AC2). **JOD rule (Basel confirmed, 2026-10-28):** a receipt that names no currency at all, not even an unsupported one, and prints three or more amounts that all have three decimals is read as JOD (confidence 0.8); a receipt naming any currency is never guessed, and one three-decimal amount is not enough.
5. **Fill-absent, both ways (R7).** The server fills only the fields the stored suggestion lacks; approve, file and `PATCH …/suggestion` likewise add only absent fields and never replace a server-read one. A read that adds nothing to a full suggestion is SKIPPED. A deleted, FILED or null-uploader receipt is SKIPPED (F5, F8): a late read writes nothing.
6. **Gating (D3).** A deploy-level kill switch (`SERVER_OCR`, Terraform `server_ocr_enabled`, default false) **and** a per-user `receipt_reading` grant (operator console, ADR-216). Granting it queues that person's unread To-review receipts once (R5); nobody else's receipts are read.
7. **No text kept or logged.** The sidecar logs counts and timings only and has no Sentry SDK; on the API every failure on the read path is rethrown as `OcrReadError(code)` with a fixed message and no `cause` (R10 #3). Only the suggested fields are stored (`readFailReason` holds a code).
8. **Scope.** QR codes (ZATCA, Israeli e-invoices) are deferred to **MUT-490** (R-D1). **MUT-256** (phone reader) and **MUT-304** (browser OCR) are decided after this ships (D7). **Licences (AC7):** Basel accepted LGPL-2.1 for FFmpeg (inside opencv) and GEOS (inside shapely), dynamically linked; the CI check passes exactly those two and refuses AGPL and OpenRAIL revenue caps.
9. **Deploy order (D6).** The first production apply that creates any of it comes **after MUT-487** moves the stack to its own project; every resource is named from `project_id`, so nothing is created in `malafat-production` only to be moved.

**Consequences:**
- Wire: receipts carry `reading: pending | done | failed | null`; uploads take an optional `capture: scanned | photo` (the phone's Scan skips the perspective step). The portal's review page polls while pending and fills only untouched fields (AC8).
- Every receipt from a granted person costs a read (about $0.11–0.74 per 1,000 at list price, depending on Cloud Run's real speed), not only misses as ADR-199 expected; nothing while idle.
- The privacy policy says receipts may be read on our own servers by software we run (AC9; wording approved by Basel on 2026-10-28).
- Open debt: TD-275 (readerVersion per suggestion), TD-276 (gallery doesn't poll), TD-277 (extractor untuned on real receipts; Hebrew bar provisional), TD-278 (Cloud Run speed and cold start unmeasured until MUT-487).

**Alternatives considered:**
- Keep the device first and the server as fallback (ADR-199 as written). Rejected by Basel: two device engines that miss the bar, and the phone would still need an engine per platform.
- Sweep only, no Cloud Tasks (D1 B). Rejected: 1–5 minutes before fields fill.
- `X-Job-Token` on tasks (F2's first remedy). Superseded by R8: the shared token in task headers widens every job route.
- Extraction inside the Python service (D2 B). Not taken: rules split from the rest of the stack; raw text crosses to the API in memory only and is never stored or logged.
- An LLM or a third-party OCR API. Rejected, as in ADR-199.

## ADR-221: A New Expense's Receipts Upload in Its Edit Drawer After Save (MUT-491)

**Status:** Accepted (2026-10-28, MUT-491; epic MUT-252). Plan and eng review: `.claude/designs/mut-491-receipt-on-create.md`. ADR-220 is reserved by MUT-441.

**Context:** the portal's expense receipt routes need an expense, so the new-expense drawer offered no receipts. The first plan uploaded inside the create drawer after the POST and toasted failures. The review found a double-create window (the attempt key resets when the create resolves, before uploads start), late `onClose`/`markSaved` after the drawer was gone, edits lost during the upload, and the failure toast stacked on the Saved notice.

**Decision:**
1. **Files wait in the browser** (`QueuedReceipts`) until Save; nothing is sent before the expense exists, so Cancel leaves nothing behind. No To-review detour (D1).
2. **After the create, the drawer becomes the new expense's edit drawer** (Basel, D5): the expense is seeded in the cache, `onCreated(id)` moves the list to `?expense=<id>`, and the same drawer instance's `ReceiptUploader` uploads the files as `incoming`. All landed and the form not dirty: close with Saved. Any failed: stay open with the failure inline on that file (Upload again, Remove), never a toast.
3. **Save is one guarded step** from the click until the create settles (a ref, not just the disabled button). Saved is marked when the drawer closes, never while it is open, and nothing closes or flashes after it unmounts.
4. **One upload function** (`uploadReceiptFile`, D3) for the library and the drawer: delete the PENDING row after a failed PUT, or after a complete refused with a 4xx; keep it after a 5xx or a lost answer. Its own module, since receiptQueries.ts imports expenseQueries.ts.
5. **A drawer attach refreshes the Receipts tab** (D4), and a failed one too.
6. **`ReceiptPickButton` + `QueuedReceipts`, not a two-mode uploader** (D6): the uploader's hooks need an expense id.

**Consequences:** a new expense with receipts briefly shows its edit drawer before closing. The edit drawer's picker takes several files too. A failed row whose name is now READY under a new receipt shows READY.

**Alternatives considered:**
- Upload inside the create drawer with a mounted guard, a saving lock, a read-only form and a deferred Saved mark. Rejected (D5): more states to guard than the flip removes.
- Upload as To-review receipts first, then file them. Rejected: orphans on Cancel, and the library is off in local mode and behind `RECEIPTS_LIBRARY`.
- One `ReceiptUploader` with live and queued modes. Rejected (D6): its hooks would run with an empty expense id.

## ADR-222: Lowering a Fixed Fee Is One Planned Write: Unbilled First, Then Credits (MUT-480)

**Status:** Accepted (2026-10-28, MUT-480; epic MUT-25; blocks MAL-1424). Plan and eng review: `.claude/designs/mut-480-lower-the-fee.md` (D1–D9, E1–E4, O1–O5, R1–R10; Basel approved every decision 2026-10-27/28). ADR-220 and ADR-221 went to MUT-441 and MUT-491, and API 1.84.0 to MUT-441, so this is ADR-222 and 1.85.0-mut480.

**Context:** a partner giving a discount or forgiving part of a fee needed two tools (a negative supplement within the unposted capacity, then credits receivable by receivable), and Malafat may not split amounts itself (ADR-150). The installments store their amount in the pricing basis, so on a VAT-exclusive fee some gross figures can't be reached.

**Decision:**
1. **`POST /v1/agreements/{id}/reduce/preview` and `/reduce`** (FIXED only; retainers and contingency 422 `NOT_FIXED`, D1). Body: exactly one of `by` (gross to take off) or `to` (the new effective total), `reasonCode` (`DISCOUNT | GOODWILL | ENTERED_BY_MISTAKE | CLIENT_DISPUTE | OTHER`; OTHER needs a note, 422 `REASON_REQUIRED`), `note?`, `previewToken`.
2. **Effective total** = live installments' gross − credits on their receivables (D5). `GET /v1/agreements/{id}` (and every `AgreementDetail`) shows `credited` and `effectiveTotal` (O2; null for a retainer).
3. **The plan is pure** (`agreements/reduce.ts` `planReduction`): unbilled installments latest first, whole ones voided, at most one lowered partly; then the open receivables, latest posting date first, credited with `splitCredit` at each receivable's frozen rate (D6). On VAT-exclusive fees the partial installment lands on the smallest reachable gross at or above its target (`amountForGrossAtLeast`); the gap (< one net minor unit) is `roundedBy`, never a stray credit (D5 amends D2). `applied = 0` is 422 `AMOUNT_INVALID`. With nothing posted, voiding everything is 422 `USE_CANCEL` and the largest accepted reduction is one minor unit less (D4, O-F9).
4. **Due items post before planning** (R1), as on any read, so "unbilled" is literal.
5. **The token covers the amount and the ledger** (agreement version, every installment's version/receivable/void, every posted receivable's version), **not the reason** (E2, MUT-100's rule).
6. **One write** (`agreements.reduce`, both stores): agreement row lock and version; every posted receivable the plan read version-checked in id order (`receivablesMoved`, formerly `upfrontMoved`, R3/O-F4/E3); conditional installment writes on the version read (a miss rolls back everything); credits inserted and settled; totals; a `REDUCTION` supplement row whose `amount` is the pricing-basis change (≤ 0) beside `appliedGross` and `credited` (O3). Any move answers 409 `PREVIEW_STALE`, nothing written.
7. **Posting claims on the version it read** (E1): `postInstallment` takes `expectedVersion` (the lazy poster passes the version it listed, the manual trigger the version it read); a lost claim returns null and the line posts on the next read. The manual trigger tells the cases apart by re-reading: voided by a reduction → 409 `INSTALLMENT_VOIDED`, changed → 409 `VERSION_MISMATCH` (retry), cancelled → `AGREEMENT_CANCELLED` (O4).
8. **Audit:** one `agreement.reduced` (requested, applied, roundedBy, before/after effective total and outstanding) plus one `receivable.credited` per credit with `source: REDUCTION` (O5).
9. **Credits carry `reasonCode`** (nullable column; `CREDIT_REASON_CODES` in `payments/credit.ts`, `CreditReasonCodeSchema` exported for MUT-443). `POST /v1/receivables/{id}/credits` accepts it optionally (MAL-1424's retainer path), and the statement's CREDIT line shows it (R8).
10. **The commit's credits sit under `agreements:write`**, not `payments:write`, as the contingency correction's do (O-F10).

**Consequences:** two migrations (`20261028170000` adds the enum value alone; `20261028170100` the nullable/defaulted columns); local snapshot format 10. `SupplementSchema.distribution` gains `REDUCTION` (Malafat's client must accept it, noted on MAL-1424). A post that loses its claim waits for the next read instead of billing a stale amount, which also closes the same race supplements had.

**Alternatives considered:**
- A leftover agora as a credit (D2 as first approved). Rejected (D5): it only fires when the reduction is below the unbilled amount, where AC1 forbids credits.
- Allow a zero fee, or cancel in the same write (D4 B/C). Rejected: a state no reader was built for, or "lower" silently becoming "cancel".
- A typed `raced` result from `postInstallment` (the plan's D8 wording). Built as null plus the trigger's re-read instead: same answers, without changing a return type 30 callers and tests read (TD-281).

## ADR-223: A Payment's Receipt Number Is a Label, Kept Through a Correction (MUT-481)

**Status:** Accepted (2026-10-28, MUT-481; epic MUT-25; blocks MAL-1420's receipt field and MAL-1422's payment sheet). Plan and review: `.claude/designs/mut-481-receipt-number.md` (D1–D7, R1–R10; Basel approved D5 on 2026-10-28).

**Context:** firms issue the legal receipt (קבלה) in registered invoicing software. Malafat records the payment and wants the receipt's number on it, so the ledger reads "Receipt 2041". The payment's `reference` already holds the transfer reference.

**Decision:**
1. **`payments.receiptNumber`** (VARCHAR 64, nullable, indexed with the organization). Set on `POST /v1/payments`, returned on every payment read and on the statement's PAYMENT and PAYMENT_REVERSAL lines (D4), filterable with `?receiptNumber=` (exact, trimmed; blank ignored).
2. **A label, not a document:** not unique (D2); trimmed, 1–64 characters, no control characters, any script; checked in the handler so a bad value is 422 `RECEIPT_NUMBER_INVALID` (D3, R6).
3. **A correction keeps it** (D1): with `replacesPaymentId`, leaving the field out carries the reversed payment's number, `null` clears it, a value replaces it (`carriedReceiptNumber`, which MUT-443 reuses). A replay is deterministic: a reversed payment's number never changes. The OpenAPI description warns that always sending `null` clears it on every correction.
4. **Set later** (D5, Basel): `PUT /v1/payments/{id}/receipt-number`, API key only (sessions refused, R7), `If-Match` without an idempotency key (R1: the fingerprint ignores headers and stores 4xx answers); POSTED only (409 `ALREADY_REVERSED`); the same value again answers 200 with no new version, so a retry after a lost response succeeds. The store tells a reversed payment from a stale version by re-reading (R3). Audits `payment.receipt_number_set` with from/to.
5. **Malafat-fed payments only** (D6): capture, settle and inbox write null; `CreatePaymentInput.receiptNumber` is required so every writer says so (R4). The PUT refuses a payment a person recorded with 422 `RECEIPT_NUMBER_NOT_ALLOWED`, so its owner's re-date keeps its version (pre-landing review).
6. **Pre-landing review fixes:** the PUT answers a same-value request with 200 before checking the version, so a retry that carries the version first read succeeds; Prisma's write and read-back share one transaction; invisible marks (zero-width, direction marks, BOM) are dropped before trimming so an exact search still matches, and control characters are checked on the trimmed value.

**Consequences:** migration `20261028190000` (additive); local snapshot format 11; API 1.86.0-mut481; the portal's generated types regenerated (they had also missed MUT-480's fields).

**Alternatives considered:**
- Put the number in `reference`. Rejected by the ticket: it holds the transfer reference.
- Unique per organization. Rejected (D2): the reversed payment and its correction share the number.
- Create and correct only (D5 B). Rejected by Basel: a number known after recording would need a reversal and a re-record.

## ADR-224: A Fee Proposal Is a Stored Draft Agreement, Approved With the Full Body (MUT-479)

**Status:** Accepted (2026-10-28, MUT-479; epic MUT-25; blocks MAL-1426, supersedes MAL-1094). Plan and review: `.claude/designs/mut-479-proposal-full-approve.md` (D1–D6, Basel approved D3 on 2026-10-27; review R1–R10).

**Context:** a proposal held one amount, and approving offered ONCE or equal INSTALLMENTS. A partner proposing a 30/70 split with a stage "on judgment", a monthly retainer or a contingency deal had to withdraw the proposal and create the agreement separately, so the history said "withdrawn" instead of "approved".

**Decision:**
1. **One draft union** (D1): `AgreementDraft` is `{ kind: FIXED | CONTINGENCY }` + the `POST /v1/agreements` body, or `{ kind: RETAINER }` + the `POST /v1/retainers` body, less the project (the proposal's), the agreement date (proposedOn, then approvedOn) and the currency (the project's). The type comes from `kind` alone; each variant is strict, so another kind's fields are refused. Each kind is composed by its own composer (`composePreview`, `composeRetainerPreview`), never a fork of their rules.
2. **The proposal stores it** (D2): `fee_proposals.draft` (JSONB, `{ schemaVersion: 1, … }`, wire strings only, pre-fill only, never re-composed after create) and `agreementType` (FIXED by default, backfilled CONTINGENCY where terms are set; a CHECK keeps RECURRING free of contingency terms). `POST /v1/fee-proposals` takes `draft` instead of amount/pricingBasis/contingency (both: 422 `DRAFT_CONFLICT`; neither: `AMOUNT_REQUIRED`) and composes it on proposedOn, so a draft that could never approve is refused when saved. proposedAmount derives from it: the fixed total, the contingency upfront, or the retainer's monthly amount.
3. **Retainers stay out of `proposed`** (D3, Basel): the organization summary's per-currency `proposed` sums one-off amounts only; a retainer proposal is still on its customer's row (with `agreementType: RECURRING` and its monthly amount) and in `counts.openProposals`.
4. **The full approve has its own preview and token** (D4, R5): `POST /v1/fee-proposals/{id}/approve/preview` answers the agreement or retainer preview by kind, with a token over `[org, 'proposal-approve', id, version, resolved approvedOn, agreement, rate]` (so an omitted date crossing midnight is stale). `approve` takes `{ agreement, previewToken }` (422 `PREVIEW_TOKEN_REQUIRED` without one, 409 `PREVIEW_STALE`, 409 `PROPOSAL_NOT_OPEN` at both). The legacy `{ amount, schedule, contingency }` form is unchanged, refuses a retainer proposal with 422 `DRAFT_REQUIRED` (R1), and mixing forms is `DRAFT_CONFLICT`.
5. **The approved agreement is the body** (D5): the partner may edit the draft at approval; agreedAmount derives from the body; the `fee_proposal.approved` audit records `agreementType` and `draftChanged` (null when the proposal had no draft).
6. **A retainer approve shows its charges** (R2): `ApproveFeeProposalResponse.charges` (empty for FIXED and CONTINGENCY); `retainer.created` carries `feeProposalId`. The retainer's compose and create moved to `retainers/create.ts`, shared with `POST /v1/retainers` (behaviour unchanged, guarded by the untouched retainer suites).
7. **No in-place edit of a stored draft** (D6): withdraw and re-propose, or edit at approval (TD-282).
8. **Pre-landing review:** an edit at approval keeps the proposal's kind and pricing basis (422 `AGREEMENT_TYPE_MISMATCH`, `PRICING_BASIS_MISMATCH`, at preview and approve), so the proposal's `agreementType`, `pricingBasis` and contingency columns never contradict the agreement it made (as the legacy form's `NOT_CONTINGENCY`). The legacy form refuses any proposal that carries a draft with `DRAFT_REQUIRED` (not only a retainer one), so an older client can't approve a 30/70 draft as an equal split; and a `previewToken` sent with it is `DRAFT_CONFLICT`.

**Consequences:** migration `20261028200000_mut479_proposal_drafts` (additive); local snapshot format 12; API 1.87.0-mut479. The approve keeps the existing posting model: the agreement and the approval in one transaction, IMMEDIATE installments and due charges right after, healed by lazy posting.

**Alternatives considered:**
- Count one retainer month in `proposed` (D3). Rejected: still a mixed figure.
- Re-use the agreement or retainer token at approve. Rejected: it doesn't cover the proposal, its version or the approval date.
- A PATCH on the draft now (D6). Deferred until MAL-1414 asks for it.

## ADR-225: Correcting a Payment Is One Write: the Reversal and Its Replacement Together (MUT-443)

**Status:** Accepted (2026-10-28, MUT-443; epic MUT-25; blocks MAL-1367). Plan and review: `.claude/designs/mut-443-correct-payment.md` (D1–D9, eng review R1–R12; Basel chose D1 B and the R10 rulings on 2026-10-28).

**Context:** a correction was `POST /v1/payments/{id}/reverse`, then `POST /v1/payments` with `replacesPaymentId`. A dropped connection in between left the payment reversed with nothing recorded in its place, and the client's balance wrong.

**Decision:**
1. **One call, one write.** `POST /v1/payments/{id}/correct` (idempotent `payments.correct`, API key only, payments:write) and its preview (payments:read). `PaymentRepository.correct` reverses the original on the version previewed and records the replacement (`replacesPaymentId`) in one transaction, or writes nothing: no reversal, no payment, no number. The response is `{ reversed, payment }` (D6).
2. **Lock order (R1).** Postgres takes the original's row (the conditional update, `status = POSTED AND version = expected`), then the year counter, then every receivable released or paid, in id order, once: after the payment row, the order a plain create already uses, so a correction and a create can't deadlock. The memory store (and so local mode) checks everything first and then writes, with no await in between (R7). `reverse` and `create` share their internals with it.
3. **The replacement may re-pay what the original paid.** Its pool is the eligible receivables plus the ones the original paid, as they would read once released (`releaseAllocations`); validation and suggestion run on that pool, and over-allocation is refused with the receivable named. The balances run over the same receivables as they are now, so *before* is the ledger now and *after* is after the correction; a receivable only released keeps its row (R2). Unallocated money stays on the new payment.
4. **The token** hashes the original's id and version, the resolved body (amount, date, method, reference, notes, receipt number, sorted allocations) and the (id, version) of every receivable in the pool. The reason is outside it (R5). A stale token, and a store-level race (InsufficientCapacity, LockConflict, a POSTED original at another version), are 409 `PREVIEW_STALE` (R4).
5. **A reversed original is 409 `PAYMENT_NOT_POSTED`** (D2, R12): the same state reverse calls `ALREADY_REVERSED`, and the allocation preview answers as a 422. Its details carry `reversedAt` and `replacedByPaymentId`, so Malafat recovers from a lost response under any key; any 4xx is stored under its Idempotency-Key, so a retry after a refusal needs a new key (R3).
6. **The reason** (D1 B): `reasonCode` from `CREDIT_REASON_CODES`, required on correct and checked in the handler (missing, or OTHER without a note, is 422 `REASON_REQUIRED`). It is stored on the original as `reversalReasonCode` (new nullable column) and shown on the payment and on the statement's PAYMENT_REVERSAL line (`reasonCode`); `reversalReason` keeps the text (the note, or the code). The plain reverse route stays free text (D8, TD-284).
7. **What may be corrected:** only a POSTED payment the key recorded; a person's capture is 422 `PAYMENT_NOT_CORRECTABLE` (D4). The customer and currency are the original's. `reference`, `notes` and `receiptNumber` left out keep the original's, `null` clears, a value replaces (R10, the MUT-481 rule). `allocations` (may be `[]`) or `strategy` is required, so a date-only correction never silently unallocates (R6). An archived customer is 422 `CUSTOMER_ARCHIVED`; a correction that changes nothing is 422 `NOTHING_TO_CORRECT`; due items post first (R10).
8. **The date floor (D3, R11).** The corrected payment may keep the original's `receivedOn`, or move it later, even below the ten-year floor; earlier and below the floor is refused. ADR-086's exemption rested on "the reversal already committed", which is no longer true here; the rule stays for its own reason: the correction replaces the original's own record, so the original's date is not a new back-dated entry.
9. **Dates on the statement (R8).** The reversal is dated the correction day (its `reversedAt` in the organization's timezone), as a plain reversal is. The replacement is stamped one millisecond later, so on the same day its line sorts after the reversal's.
10. **Audit (D5, R9):** `payment.corrected` on the original (replacement id and number, reason code and note, amount/date/method from → to, receipt number and whether it carried, allocations released and made, unallocated); `payment.recorded` on the replacement with `replacesPaymentId`; `receivable.settled` only for a receivable whose status changes. No separate `payment.reversed`.

11. **Pre-landing review fixes:** the Prisma correction runs with a 15 s transaction limit (5 s to start), and one that still outlasts it (P2028, rolled back whole) is 409 `PREVIEW_STALE`, not a 500. A `note` equal to the reserved `capture_undo` is 422 `REASON_RESERVED`, since the statement and activity read that reason as a person's own undo and hide the payment. A second replacement through `POST /v1/payments` with `replacesPaymentId` is still accepted, as before this ticket (TD-286).

**Consequences:** migration `20261028210000_mut443_payment_reversal_reason_code` (additive); local snapshot format 13; API 1.88.0-mut443. Prisma's `createPaymentTx` and `reverse` are now built from small transaction helpers that `correct` composes. No session route (D9).

**Alternatives considered:**
- Keep the two calls and make the second retryable. Rejected: the window between them is the bug.
- D1 A: the code only in `reversalReason` text. Rejected by Basel: Malafat couldn't tell a code from a note.
- Move a payment to another client or currency in the same call. Out of scope.
