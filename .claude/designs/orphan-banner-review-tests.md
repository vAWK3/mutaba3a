# Test Plan — Orphaned-records banner: "Review now" fixes the records in place

- **Date:** 2026-10-11
- **Companion:** `.claude/designs/orphan-banner-review.md`
- **Framework:** Vitest 4 + jsdom + fake-indexeddb (real Dexie, like the deleted modal test)
- **Baseline (2026-10-11, `fix/orphan-banner-review` at d2a050d):** 134 files, 2,206 passed, 5 skipped, 0 failed

Order is red → green per block.

## T1 — `src/db/__tests__/orphanedRecords.test.ts` (unit, real Dexie) — 100% branch

`findOrphanedRecords`
- [ ] Empty database → four empty lists and empty link maps
- [ ] Returns the unassigned client, project, income entry and expense; skips assigned ones
- [ ] Skips archived clients/projects and soft-deleted transactions/expenses (same rules as `runIntegrityCheck`)
- [ ] `clientProfileIds` / `projectProfileIds` hold every **assigned** client/project, never an unassigned one
- [ ] Agrees with `runIntegrityCheck().orphanedRecords` on the same fixture (same ids per table)

`startingProfileId` (pure)
- [ ] Client → `undefined` (no link)
- [ ] Project → its client's profile; no client or unassigned client → `undefined`
- [ ] Income entry and expense → client's profile first, then project's, then `undefined`
- [ ] A linked profile that isn't selectable (archived, deleted) → falls through to the next link / `undefined`

## T2 — `src/db/__tests__/integrityCheck.test.ts` (existing, unchanged)

- [ ] All existing cases stay green after `runIntegrityCheck` switches to the shared `isOrphaned` predicates

## T3 — `src/components/drawers/__tests__/OrphanedRecordsDrawer.test.tsx` (component, real Dexie)

- [ ] Groups: Clients / Projects / Income / Expenses headings with counts; an empty group isn't rendered; rows show client/project names, income/expense title (or fallback), date and amount
- [ ] **One profile:** no per-row picker; "Assign all to ‹name›" writes `profileId` on all four kinds, closes the drawer (store `isOpen` false) and toasts the count
- [ ] **Several profiles:** each row's picker starts on the linked client's profile, else the default; changing one row and pressing Save writes each row's own choice
- [ ] **Several profiles:** "Assign all to ‹default›" ignores the per-row pickers and writes the default everywhere
- [ ] **Partial failure:** a locked income entry fails, the other rows are saved, the drawer stays open listing only the locked row, and the "couldn't be assigned" message shows
- [ ] **No profiles:** the "add a profile first" message, no assign or Save button
- [ ] **Nothing left:** "Every record belongs to a profile." and no assign actions
- [ ] Cancel closes the drawer without writing anything
- [ ] Arabic: title and actions come from `ar.json`, no raw `orphanedRecords.` key, no "Translation missing" warning

## T4 — `src/components/layout/__tests__/OrphanedRecordsBanner.test.tsx` (extend)

- [ ] Existing en/ar copy cases: "Review now" is now a **button** (role `button`), not a link
- [ ] The banner renders no `<a href>` at all
- [ ] Clicking "Review now" sets `useDrawerStore().orphanedRecordsDrawer.isOpen` to true and doesn't change `window.location`

## T5 — `src/lib/__tests__/stores.test.ts` or the drawer test (store)

- [ ] `openOrphanedRecordsDrawer` / `closeOrphanedRecordsDrawer` toggle `orphanedRecordsDrawer.isOpen`

## T6 — Pages (extend `ClientsPage.test.tsx`, `ProjectsPage.test.tsx`)

- [ ] With an unassigned client (`useClients` returns one), `ClientsPage` renders no dialog
- [ ] With an unassigned project (`useProjects` returns one), `ProjectsPage` renders no dialog

## T7 — Locale copy (`src/lib/features/__tests__/i18nParity.test.ts` pattern, in the drawer test)

- [ ] en and ar carry the same `orphanedRecords.*` keys; `{count}` / `{profile}` placeholders are present where the code fills them

## Verification

`npm run lint`, `npx tsc -b`, `npx vitest run` (full suite; compare with the baseline above).
Manual, in the browser pane against the web dev build: banner → drawer opens over `/app/` with no reload and no URL change; assign all → banner gone. RTL pass in Arabic.
