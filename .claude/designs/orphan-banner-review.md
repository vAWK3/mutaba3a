# Design Brief — Orphaned-records banner: "Review now" fixes the records in place

- **Date:** 2026-10-11
- **Branch / worktree:** `fix/orphan-banner-review` in `.claude/worktrees/orphan-banner-review` (from `main` at d2a050d, which already contains the banner i18n fix 069e9e7)
- **Status:** direction approved by Basel 2026-10-11 through three questions: drawer in place (D1, D2), remove the page auto-open (D2), rows follow the linked client (D5). The remaining decisions follow from those and are listed for review

---

## 1. Problem

`OrphanedRecordsBanner` (mounted in `AppShell`) tells the user that N records have no `profileId`. Its "Review now" action doesn't lead anywhere useful.

| # | Finding (verified 2026-10-11 in the web dev build, `vite --port 5191`) | Consequence |
|---|---|---|
| F1 | "Review now" is a raw `<a href="/settings">`. On the web build the router runs under `basepath: '/app'`. Clicking it from `/app/` did a **full document load** to `http://127.0.0.1:5191/settings` | The page renders (TanStack Router tolerates a path without its basepath), but the URL is outside the PWA `scope: '/app/'` and outside the service worker's `navigateFallbackAllowlist: [/^\/app/]`, so it can't load offline. The in-memory query cache and drawer state are lost. On desktop it's a full reload too |
| F2 | Settings › Data tools only has "Run Check", which reports a count (hardcoded English) | Nothing on the page the banner sends you to can fix the records |
| F3 | `OrphanedRecordsModal` *is* rendered, by `ClientsPage` and `ProjectsPage`, which open it during render whenever an unassigned client/project exists. **Cancel and the backdrop can't close it**: `onClose` sets the flag to false and the next render sets it back to true | It's a trap on two pages, and the only way out is assigning |
| F4 | The modal covers clients *or* projects. `runIntegrityCheck` (the banner's count) also counts income entries (`transactions`) and `expenses` | Unassigned income and expenses can't be fixed anywhere, so the banner never clears for them |
| F5 | The modal and the integrity check each carry their own copy of "unassigned" (`!profileId && !archivedAt`, `!profileId && !deletedAt`) | They can drift, and then the banner and the fix screen disagree |
| F6 | `transactionRepo.update` rejects every field except `archivedAt` on a transaction locked by an exported document (ADR-014) | Assigning a profile to a locked, unassigned income entry throws |

## 2. Acceptance criteria

- [x] "Review now" is a button. Clicking it opens an **Unassigned records** drawer over the current page; the URL doesn't change and the page doesn't reload (web and desktop)
- [x] The drawer lists every record the banner counts, grouped **Clients / Projects / Income / Expenses**, each with its count; empty groups are hidden
- [x] **One active profile:** rows have no per-row picker; one primary action, "Assign all to ‹profile›"
- [x] **Several profiles:** a quick action "Assign all to ‹default›", plus a profile picker on every row and Save
- [x] Each row's picker starts on the profile of its linked client, then its linked project, then the default profile (projects follow their client; clients start on the default)
- [x] On success, the records get their `profileId`, every list refreshes, the banner disappears, the drawer closes and a toast says how many were assigned
- [x] If some rows fail (e.g. a locked income entry, F6), the rest are still saved, the drawer stays open listing only the failed rows, and an inline message says how many couldn't be assigned
- [x] No business profile at all → a message saying to add one first, and no assign actions
- [x] Cancel, the close button, Escape and the overlay close the drawer (Cancel is tested here; the other three come from the shared `Drawer`)
- [x] Clients and Projects no longer open a modal by themselves
- [x] Copy in en + ar from `orphanedRecords.*`; no raw keys; works in RTL

## 3. Decisions

| # | Decision | Why | Alternative rejected |
|---|---|---|---|
| D1 | **"Review now" becomes a button that opens `OrphanedRecordsDrawer`** through `useDrawerStore().openOrphanedRecordsDrawer()`. `AppShell` mounts the drawer like every other global drawer | Drawer-first (CLAUDE.md). No navigation means there's no basepath to get wrong (F1) and no detour through Settings (F2) | Router `Link` to `/settings` plus an assign action in Settings: a second hop, and it overlaps the open `fix/settings-integrity-i18n` worktree |
| D2 | **The drawer replaces `OrphanedRecordsModal`.** The modal, its CSS, its tests and the barrel export are deleted, and `ClientsPage`/`ProjectsPage` stop opening it (F3) | One component per job (COMPONENT_REGISTRY rule). The banner becomes the single entry point, and dismissing it is respected | Keeping the modal for the two pages and making it dismissible |
| D3 | **One definition of "unassigned"** in `src/db/orphanedRecords.ts`: `isOrphaned.{clients,projects,transactions,expenses}` predicates. `runIntegrityCheck` (banner count) and `findOrphanedRecords` (drawer rows) both use them (F5) | The banner count and the drawer's rows can't disagree | Keeping two copies |
| D4 | **`findOrphanedRecords()` returns the unassigned records per table, plus each assigned client's and project's `profileId`** (`clientProfileIds`, `projectProfileIds`) | That's everything the starting-profile rule needs, in one read. Reads `db` directly like its sibling `runIntegrityCheck` | Four list queries from the component |
| D5 | **Starting profile = `startingProfileId(table, record, links, selectableIds) ?? defaultProfileId`**: income and expenses take their client's profile, then their project's; projects take their client's; clients have no link. A linked profile counts only if it's selectable (active), otherwise the row falls back to the default | "Income stays with its client" (approved). Pure, so it's tested at 100% | Always the default profile (what the modal does) |
| D6 | **Default profile = the active profile marked `isDefault`, else the first active profile** | `businessProfiles.list()` already excludes archived profiles; a data set without an `isDefault` flag still gets a usable fallback | No fallback: the quick action would be disabled with no explanation |
| D7 | **Writes go one row at a time through `getRepositories().base.<table>.update(id, { profileId })`**, the same path the modal and every drawer use. A failed row doesn't stop the batch; the hook returns `{ assigned, failedIds }` and **invalidates every query on settle** | A profile change touches every profile-scoped list, the summaries and the banner, so a full refetch is the honest choice for a rare repair action. Per-row failure means one locked entry (F6) can't block the other 99 | One Dexie transaction: the repos open their own and a lock error would roll everything back |
| D8 | **The lock rule stays as it is (F6).** A locked, unassigned income entry fails, stays listed, and is reported | Relaxing ADR-014 ("fill a missing profileId on a locked entry") is a decision about financial immutability, not part of this fix. Flagged as a follow-up (TD-035) | Allowing `profileId` on locked entries without an ADR |
| D9 | **Drawer state lives in `useDrawerStore` (`orphanedRecordsDrawer.isOpen`), not the URL** | Same as the client, project and profile drawers it sits beside | `?orphans=1` deep link: nobody links to a repair screen |
| D10 | **Settings › Data tools is unchanged** | `fix/settings-integrity-i18n` was open on that section while this was built (it has since merged as `DataToolsSection`). Pointing its "Run Check" result at this drawer is a small follow-up | Editing it here and merging into a conflict |

## 4. Components

```
OrphanedRecordsBanner ──click──▶ useDrawerStore.openOrphanedRecordsDrawer()
                                          │
AppShell ── orphanedRecordsDrawer.isOpen ─┴─▶ <OrphanedRecordsDrawer />
                                                 │ useOrphanedRecords()      → findOrphanedRecords()        (src/db/orphanedRecords.ts)
                                                 │ useBusinessProfiles()
                                                 │ startingProfileId()       (pure, src/db/orphanedRecords.ts)
                                                 └ useAssignOrphanedRecords() → getRepositories().base.*.update, invalidate all
runIntegrityCheck (banner count) ── uses ── isOrphaned.* predicates (src/db/orphanedRecords.ts)
```

- `src/db/orphanedRecords.ts`: `OrphanTable`, `isOrphaned`, `findOrphanedRecords`, `startingProfileId`
- `src/hooks/useOrphanedRecords.ts`: `useOrphanedRecords`, `useAssignOrphanedRecords`
- `src/components/drawers/OrphanedRecordsDrawer.tsx` (+ styles in `index.css` next to the banner's)

## 5. Contracts

```ts
type OrphanTable = 'clients' | 'projects' | 'transactions' | 'expenses';
interface OrphanedRecordSet {
  clients: Client[]; projects: Project[]; transactions: Transaction[]; expenses: Expense[];
  clientProfileIds: Record<string, string>;   // assigned clients only
  projectProfileIds: Record<string, string>;  // assigned projects only
  clientNames: Record<string, string>;        // every client, for row labels
}
interface OrphanAssignment { table: OrphanTable; id: string; profileId: string }
interface AssignResult { assigned: number; failedIds: string[] }
```

Error states: no profiles (message, no actions); some rows fail (inline message, those rows stay); nothing left to assign while open (another tab, a sync) → "Every record belongs to a profile." with only Close.

## 6. Impact

- Deleted: `OrphanedRecordsModal.{tsx,css}`, its test, its barrel export, the auto-open code in `ClientsPage`/`ProjectsPage` (the pages keep `useClients(undefined)`/`useProjects(undefined, undefined)`, which their empty-search copy still uses)
- `runIntegrityCheck` behaviour is unchanged (same predicates, now shared)
- No schema change, no Dexie version bump, no sync change (writes take the same `base` path as before)

## 7. i18n

`orphanedRecords.*` is rewritten in en + ar (the old `description.clients/projects`, `assignIndividually`, `or` keys go with the modal) and added to `Translations` so `tsc -b` catches a missing section. Amounts render LTR inside RTL rows (`dir="ltr"` on the amount, PATTERNS "Amounts stay LTR inside RTL text"). Dates use `formatDate(…, getLocale(language))`.

## 8. Cost / infra

None. Client-only, offline.

## 9. Follow-ups (not in this change)

- TD-035: decide whether a locked income entry may have a *missing* `profileId` filled in (ADR-014 exception, like ADR-030 for payments)
- Settings › Data tools (`DataToolsSection`, merged): let a "Run Check" that finds unassigned records offer to open this drawer
- TD-036, where orphans come from: `ClientDrawer.tsx:165` and `ProjectDrawer.tsx:175` offer a "Default profile" option whose value is `''`, which `:66`/`:76` save as `profileId: undefined`, an unassigned record
