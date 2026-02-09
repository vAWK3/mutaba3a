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
