# MUT-145 — Remove document/invoice generation (digital ledger only)

Status: plan (eng-ticket, 2026-10-13). Epic MUT-2. Overrides MUT-13's "gate, don't delete" for invoices only.

## Problem and acceptance criteria (from the ticket)

The app creates invoices, receipts, credit notes and price offers, renders them as PDFs, and locks income entries once a PDF is exported. Mutaba3a is a ledger: it records what happened. It doesn't issue documents. The whole feature goes.

1. No route, nav entry or UI affordance creates, edits, views or links a document.
2. No transaction can be locked for document reasons again. Existing locked transactions become editable.
3. Existing Document/DocumentSequence rows are not silently destroyed (decide and record).
4. The other five optional areas still gate correctly.
5. The hosted portal's attachments (`src/hosted/**/documents`) are untouched.
6. Typecheck, lint and the full unit suite are green.
7. `@react-pdf/renderer` is gone from `package.json` and the bundle.

## Decisions this plan takes (need Basel's OK where marked)

**D1 — Keep the tables (ADR-029). Don't drop them. [approved: eng-review D5 = Retain]**
The ticket's scope says "drop the `documents`/`documentSequences` Dexie tables via a new migration". Its own AC 3 and ADR-029 both forbid that. ADR-029: removing a feature's UI never drops tables, never bumps the schema version and never rewrites rows. Precedent: engagements (MUT-10) and month-close (MUT-14). So:
- no `version(22)`;
- the row types move to `src/db/retained/documentSchema.ts`, typed loosely;
- `retainedDocumentSchema.test.ts` guards that the tables stay and round-trip through `backup.ts`.
ADR-053 (sync tables) is the one precedent for dropping tables. It doesn't fit here: those rows were bookkeeping copies, but issued invoices are user records.

**D2 — Unlock in code, not by migrating rows. [approved: eng-review D6 = Unlock in code]**
The lock exists only as a guard in `transactionRepo.update` / `softDelete` (`repository.ts:372-385`, `:484-492`) plus IncomeDrawer's notice. Deleting the guard unlocks every row at once, with no upgrade step and no rewrite. `lockedAt`, `lockedByDocumentId` and `linkedDocumentId` leave the `Transaction` type. Old rows keep the stale properties, which is inert because nothing reads them. The `linkedDocumentId`/`lockedAt` indexes stay in the v8+ store strings, because changing them would need a version bump (D1). The test: a row seeded with `lockedAt` and `lockedByDocumentId` can be updated and soft-deleted.

**D3 — Profile export/import keep passing the retained rows through.** `ExportDataModal` still writes the profile's `documents`/`documentSequences`. `ImportDataModal` and `ImportDataPage` still restore them into the retained tables. The only change is that import no longer shows a "N documents" count. If we dropped them here, a per-profile export would quietly lose invoices, which breaks AC 3. Typing comes from the retained schema.

**D4 — `BusinessProfile.defaultLanguage` goes too. [approved: eng-review D1 = Include]** It's labelled "Document Language" in both editors, and nothing outside documents reads it. It's set in WelcomeModal, BusinessProfileDrawer, ProfileDetailPage and the seed. The other letterhead fields stay: `nameEn`, `taxId`, `address1/En`, `city/En`, `email`, `phone`, `logo`. `primaryColor` stays for sure, because ProfileBadge, ProfileSwitcher and profileAvatarStyle read it. Whether to trim the profile drawer down to ledger fields is a separate question (follow-up F2).

**D5 — Stored `features.invoices` needs no migration.** `resolveFeatures` already drops unknown keys (`features.ts:43-52`), so a stored `invoices: true` becomes harmless. A test pins this.

**D6 — Delete `public/fonts/` (4.3 MB, 20 TTFs). [approved: eng-review D2 = Include]** Only `features/documents/pdf/fonts.ts` uses them. Nothing in `src`, `public`, `index.html`, `hosted.html` or the Vite config references them. App fonts are the Thmanyah OTFs in `src/assets/fonts`. Every web, desktop and hosted build copies these TTFs, so deleting them shrinks every build. A grep test pins that no source references `/fonts/`.

**Stays (not documents):** the income status "Invoiced" (a ledger state; `qa/specs/web/income.spec.ts` covers it), the hosted portal's `/documents` attachments, and the `/documents*` exclusion in `server/src/routes/well-known.ts`.

## Sequencing

Not formally blocked. But **MUT-140 (JOD, In Review, branch `feat/mut-140-jod-currency`, unmerged)** edits the same files: `DocumentDrawer`, `DocumentFormPage`, `DocumentPdf`, `LineItemsTable`, `pdf.test`, `IncomeDrawer` (it extracts `incomeFormSchema.ts`), `ProfileDetailPage` and `types/index.ts`. **Land MUT-140 first, then cut the MUT-145 worktree from that main.** Its commit 2e3a5b4 (document currency) is then deleted along with everything else. This needs a fresh worktree at `.claude/worktrees/mut-145-remove-documents`, branch `feat/mut-145-remove-documents`. Tag `pre-mut-145` on main first, as the ticket asks.

## Change map

### Delete outright
| Area | Paths |
|---|---|
| Feature module | `src/features/documents/**` (components, hooks, pdf, utils, `__tests__/pdf.test.ts`, `__tests__/totals.test.ts`) |
| Pages | `src/pages/documents/**` (DocumentsPage, DocumentFormPage 1,487 LOC, DocumentDetailPage, index) |
| Drawer | `src/components/drawers/DocumentDrawer.tsx` + export in `drawers/index.ts` |
| Modal | `src/components/modals/PdfDownloadChoiceModal.tsx` (+ export, CSS) |
| Services | `src/services/paymentRequestService.ts`, `src/services/pdfArchival.ts`, exports in `services/index.ts`, `services/__tests__/paymentRequestService.test.ts` |
| Repo | `documentRepo`, `documentSequenceRepo`, `DocumentLockedError`, `lockAfterExport` in `src/db/repository.ts`; `IDocumentRepository`, `IDocumentSequenceRepository` + `documents`/`documentSequences` on the repo bundle in `src/db/interfaces.ts`; wiring in `src/db/provider.ts:62-63`; `db/__tests__/documentRepo.test.ts` |
| Hooks | the 16 document hooks in `src/hooks/useQueries.ts:514-760` (+ their cases in `useQueries.test.tsx`) |
| Store | `documentDrawer` / `openDocumentDrawer` / `closeDocumentDrawer` in `src/lib/stores.ts` (+ `stores.test.ts` cases) |
| Icon | `DocumentIcon`, if `grep` shows no consumer left after the row actions go |
| Demo | `src/demo/seedData/documents.ts` + wiring in `seedData/index.ts`, `demo/index.ts`, `demo/types.ts` (`documents` stat), `DemoSeedModal` list item and stat |
| Test util | `createMockDocumentItem` in `src/test/utils.tsx`; `defaultLanguage` in its profile factory |
| Dependency | `@react-pdf/renderer` in `package.json` + lockfile (`npm uninstall`) |
| Assets | `public/fonts/` (D6) |
| i18n | `documents.*`, `documentGuard.*`, `nav.documents`, `transactions.hasDocument`, `demo.modal.item.documents`, `demo.stats.documents`, `settings.features.items.invoices.*`, any `featureNotice` copy that names invoices, in **both** `en.json` and `ar.json` |

### Edit
| File | Change |
|---|---|
| `src/types/index.ts` | Remove `Document`, `DocumentItem`, `DocumentType`, `DocumentStatus`, `DocumentLanguage`, `DocumentSequence`, `DocumentFilters`, `DocumentDisplay`, `TemplateId`. **Keep `PaymentMethod`**: `PaymentRecord.method` (`:433`) uses it. Remove `Transaction.linkedDocumentId/lockedAt/lockedByDocumentId`. Remove `BusinessProfile.website/defaultTemplateId/defaultTaxRate/allowedCurrencies/bankName/bankBranch/bankAccountNumber/bankIban/paymentNotes` and `defaultLanguage` (D4). Remove `'invoices'` from `FeatureKey`. |
| `src/db/retained/documentSchema.ts` (new) | Retained `Document` and `DocumentSequence` row types: ids, profile/client keys, dates, `deletedAt`, plus `Record<string, unknown>` for the rest. Uses the ADR-029 header. |
| `src/db/database.ts` | `documents!`/`documentSequences!` tables typed from the retained module. No version change. The v20 upgrade comment still names invoices as history; leave it. |
| `src/db/repository.ts`, `src/db/interfaces.ts` | Delete the transaction lock guard in `update` and `softDelete`. Also delete `isLocked` (interface `:113`, `:203`) and `TransactionLockedError`, since only the guard throws it. |
| `src/hooks/useMutationWithFeedback.ts:81-86`, `IncomeDrawer.tsx:368` | Delete the "locked by document" error-message branches. |
| `src/db/migration-safety.ts` | Keep `documents`/`documentSequences` in `ALL_TABLES` (retained, backed up). Delete the v8 `exportCount` check (`:448-463`). |
| `src/lib/features/features.ts` | Remove `'invoices'` from `FEATURE_KEYS` and `FEATURE_DATA_PROBES`. `PROBED_TABLES` follows automatically. |
| `src/router.tsx` | Delete the 4 `/documents` routes (`:130-160`) and their lazy imports. The router has **no** `notFoundComponent` (`createRouter` at `:368`), so a bookmarked or restored `/documents/…` URL would hit TanStack's bare default. Replace the four routes with one legacy route, `/documents/$`, whose `beforeLoad` does `redirect({ to: '/' })`. That's the same destination `requireFeature` already uses when an area is off. Test it in `router.gateKeys.test.ts`. |
| `src/components/layout/SidebarNav.tsx` | Delete the `/documents` nav item (`:71`). |
| `src/components/layout/AppShell.tsx` | Unmount `<DocumentDrawer />` (`:7`, `:144`). |
| `src/components/clients/ClientWorkSection.tsx` | Delete the view-linked and create-document row actions (`:110-130`) and the `openDocumentDrawer` destructure. |
| `src/pages/transactions/TransactionsPage.tsx` | Delete Generate Invoice / View Invoice actions and the linked-document icon button (`:259-296`). |
| `src/components/drawers/IncomeDrawer.tsx` | Delete `isLocked`, the `useDocument` lookup, the locked notice and "view document" link (`:148-160`), and any disabled-when-locked props. |
| `src/pages/settings/ProfileDetailPage.tsx` | Delete the Numbering, Document Defaults and Payment Details tabs. **`defaultCurrency` lives on the Document Defaults tab and is core** (`lib/incomeEntry.ts:131` reads it), so move it into Profile Info as "Default currency". If only one tab is left, drop the tab strip. |
| `src/components/drawers/BusinessProfileDrawer.tsx`, `src/components/modals/WelcomeModal.tsx` | Drop `defaultLanguage` (D4). |
| `src/components/modals/ExportDataModal.tsx`, `ImportDataModal.tsx`, `src/pages/settings/ImportDataPage.tsx` | Retype the documents pass-through from the retained schema (D3) and remove the "documents" count from the stats UI. **Note:** two import paths already duplicate each other. Don't fix that here (it's debt; see F4). |
| `src/demo/visitorSample.ts` | Remove `db.documents` from the seeded-tables list (the sample no longer writes any). **Keep** it in `ownDataTables()`: a person with only legacy invoices still "has data", per ADR-042. |
| `src/lib/features/useFeatures.ts:95` (R3, approved D7) | `useFeatureNotice` returns `featureNotice` filtered through `FEATURE_KEYS`. `FeatureNoticeBanner` already returns null on an empty list (`:20`). This stops a stored `'invoices'` from rendering a raw i18n key. |
| Settings → Optional features list | Becomes five rows. It's driven by `FEATURE_KEYS`, so no component change is expected. Check the `FeatureNoticeBanner` copy. |

### Tests (TDD order: write and update these first, watch them go red, then delete code)
New and changed assertions that prove each AC:
- **AC1:** `router.gateKeys.test.ts` has no `/documents` route. `SidebarNav.features.test.tsx` shows no Documents entry with every flag on. `ClientDetailPage.test.tsx` and a TransactionsPage row-actions test show no invoice actions for an income row that has `linkedDocumentId`. New `src/__tests__/noDeadDocumentModules.test.ts`: a glob-and-grep guard, following `noDeadExpenseModules.test.ts` and `noDeadMoneyEventModules.test.ts`. It fails if `src/features/documents`, `src/pages/documents`, `DocumentDrawer`, `@react-pdf` or `/fonts/` reappear anywhere outside `src/hosted/`.
- **AC2:** `transactionRepo.test.ts` seeds a row with `lockedAt` and `lockedByDocumentId`; `update` succeeds and `softDelete` succeeds. These replace the existing "locked" tests. `IncomeDrawer.locked.test.tsx` is rewritten: a legacy-locked row opens fully editable with no notice. Rename it `IncomeDrawer.legacyLock.test.tsx`.
- **AC3:** new `retainedDocumentSchema.test.ts`: both tables exist in `db.tables`, and rows round-trip `serializeAllTables` → `restoreFromBackup`. `ImportExportModals.test.tsx`: a profile export includes the profile's document rows, and an import restores them.
- **AC4:** `features.test.ts` has `FEATURE_KEYS` = the five, and `resolveFeatures({invoices:true, expenses:true})` gives `{expenses:true, …}` with no `invoices` key. Update `featureDataProbes`, `reconcile`, `gatingDataSafety`, `routeGuard`, `leaveDisabledArea`, `FeatureNoticeBanner`, `migration-v20` (seeds documents and expects invoices auto-enabled, so drop that expectation and keep the other areas'), `settingsRepo` and `useAddMenuActions` mocks.
- **AC5:** none of `src/hosted/**` changes. `git diff --stat main -- src/hosted server` must be empty. The existing hosted suites run in the full suite.
- **AC7:** `noDeadDocumentModules.test.ts` checks `package.json`. After `npm run build`, run `grep -r "react-pdf" dist-web dist-desktop` and expect no hits.
- Also update: `OrphanedRecordsDrawer.test.tsx`, `RecordPaymentButton.test.tsx`, `paymentRecords.test.ts`, `migration-safety.test.ts` (drop the exportCount case), `migration-v21.test.ts` (fixture only), `stores.test.ts`, `useQueries.test.tsx`, `IncomeDrawer.test.tsx`.

Gate (use Node 22 via nvm, see memory): `npm run lint && npm run typecheck && npm run test:run && npm run build` (`test:integration` does not exist, TD-054 / MUT-47), plus `make qa`'s web income spec on a preview build, to confirm "Invoiced" still works.

## Knowledge updates
- **ADR-065**: "Documents are removed. Their code goes, their tables stay, and the lock is unwound in code." It's a narrow override of ADR-032 (invoices switch) and of MUT-13's gate-don't-delete, and it applies ADR-029.
- Mark ADR-032's invoices row superseded.
- CHANGELOG, SYSTEM_OVERVIEW (feature list, routes), COMPONENT_REGISTRY (remove DocumentDrawer, LineItemsTable, SplitWorkspace, BusinessProfileCard, PdfDownloadChoiceModal), TEST_PLAN.
- TECH_DEBT: resolve whichever TD items exist for documents; add F4 if it isn't tracked yet.
- `docs/admin-panel/05-FEATURES.md` and `docs/roadmap/ROADMAP.md`: strike invoices.

## Scale / cost
Pure deletion. It adds no reads. It removes the documents queries and one probe scan per upgrade/restore. Bundle: `@react-pdf/renderer` (lazy chunk) and 4.3 MB of TTFs leave every build. The retained tables cost a few hundred bytes per install, per ADR-029.

## Follow-ups (not this ticket)
- **F1:** Close MUT-106 (invoice PDFs in Brand v2) as Won't Do. Its subject is gone.
- **F2:** Trim BusinessProfile letterhead fields (`nameEn`, `taxId`, addresses, `logo`) if the profile should be ledger-only. That's a product call.
- **F3:** Drop the Tauri `fs` plugin and the `$DOCUMENT/Mutaba3a/**` write capability. `pdfArchival` was its only user, so dropping it is least privilege. It touches `Cargo.toml`, `lib.rs` and `capabilities/default.json`, so it needs a desktop build to verify.
- **F4:** `ImportDataModal` and `ImportDataPage` duplicate the import logic.
- **MUT-9** (optional client statement export) can no longer assume a PDF renderer. It'll be CSV, or it'll need a renderer added back.

---

# Eng review (/plan-eng-review, 2026-10-13)

Target: `.claude/designs/mut-145-remove-documents.md` (this file). Report file: this file.
Design-doc check found `basel-main-design-20260524-100930.md` (recording-flow redesign). It's unrelated, so this plan is the design of record.
Prior learning applied: mutaba3a-typecheck-script-now-exists (confidence 10/10, from 2026-10-12). The gate uses `test:run`; `test:integration` doesn't exist.
Prior learning applied: mutaba3a-portal-cache-only-assets (confidence 10/10, from 2026-10-12). The portal has its own publicDir (`src/hosted/public`), so deleting `public/fonts/` can't affect it.

## Scope record

Feature answers: eng-review D1 (defaultLanguage) = Include; D2 (public/fonts) = Include; D3 (legacy `/documents/$` redirect) = Include. Structure: D4 = A, Original arrangement. The user first answered "Pause", then corrected it in chat to "original arrangement". A smaller layout was checked anyway: each retained feature has its own retention test file (`retainedMonthCloseSchema.test.ts`), and guard tests follow `src/__tests__/noDead*Modules.test.ts`, so there's no smaller layout.
Accepted scope: the change map as written, plus D4, D6 and the legacy redirect. Files are named per repo convention: `src/db/retained/documentSchema.ts`, `src/db/__tests__/retainedDocumentSchema.test.ts`, `src/__tests__/noDeadDocumentModules.test.ts`.
Pending remedies: R1, R2, R3.
Scope Challenge result: scope accepted as-is (MODE: FULL_REVIEW).

Factual corrections (no behavior change): the gate command is `npm run test:run`; the guard test is `noDeadDocumentModules.test.ts`.

## Decision ledger

### R1: Fate of the `documents` / `documentSequences` tables
Finding: 1, P1, confidence 10/10, ticket scope bullet "Drop the documents/documentSequences Dexie tables ... via a new migration" vs `.claude/DECISIONS.md:1059` ADR-029 "Deleting a feature's UI ... never drops a Dexie table, never regresses or bumps the schema version". Reviewer: Claude (native).
Plan baseline: plan D1 proposes retain (unapproved). The ticket text proposes drop.
Runtime evidence: `database.ts:157`+ declares both stores in every version v1–v21. `backup.ts:21` serializes every table in `db.tables`. Precedent: `src/db/retained/engagementSchema.ts`, `monthCloseSchema.ts`.
Comparison grid:
| Choice | Current | A Retain | B Drop |
|---|---|---|---|
| R1 tables | live, read by documents UI | kept, types in `src/db/retained/documentSchema.ts`, retention test | `version(22)` with `documents: null, documentSequences: null` |
| Schema version | 21 | 21 (unchanged) | 22 |
| ADR | ADR-029 | applies ADR-029 | new ADR overriding ADR-029 (like ADR-053) |
| Data-loss guard (AC3) | n/a | rows stay; backup round-trips them | needs an export-first step before the drop (CSV or JSON of invoices) |
| R2, R3 | pending | pending | pending |
Question D5:
D5 — Keep or drop the documents tables?
Header: Tables
Options:
A) Retain (recommended)
B) Drop with v22

State: approved
Actual answer: A) Retain, eng-review D5, 2026-10-13
Accepted scope: Grid column A: tables kept at v21, row types in src/db/retained/documentSchema.ts, retainedDocumentSchema.test.ts (exist + backup round-trip), ADR-065 applies ADR-029, ticket comment that the drop bullet is superseded.

### R2: How locked transactions get unlocked
Finding: 2, P1, confidence 10/10, `src/db/repository.ts:373` `if (existing.lockedAt) {` and `:487` `if (existing?.lockedAt) {`; AC2 says "unlocked by the migration". Reviewer: Claude (native).
Plan baseline: plan D2 proposes unlock in code (unapproved).
Runtime evidence: the lock is enforced only by those two guards, by `IncomeDrawer.tsx:148` `isLocked`, and by error text in `useMutationWithFeedback.ts:82`. No other reader of `lockedAt` exists outside the documents module.
Comparison grid:
| Choice | Current | A Unlock in code | B v22 upgrade clears fields |
|---|---|---|---|
| R2 unlock | guard blocks edit/delete | delete guard, `isLocked`, `TransactionLockedError`, drawer notice; rows untouched | same code deletion, plus `version(22).upgrade` sets `lockedAt`/`lockedByDocumentId` to undefined |
| Row rewrites | none | none | every locked row rewritten |
| Schema version | 21 | 21 | 22 (forced even if R1 = Retain) |
| Regression contract | n/a | normal update/softDelete unchanged; a row seeded with `lockedAt` updates and soft-deletes; drawer shows no notice | same, plus a migration-v22 test |
| R1, R3 | pending | pending | pending |
Question D6:
D6 — Unlock locked entries in code or by migration?
Header: Unlock
Options:
A) Unlock in code (recommended)
B) v22 clears lock fields

State: approved
Actual answer: A) Unlock in code, eng-review D6, 2026-10-13
Accepted scope: Grid column A: delete guards (repository.ts:373,:487), isLocked, TransactionLockedError, useMutationWithFeedback branch, IncomeDrawer notice; drop 3 fields from Transaction type; no row rewrites, no schema bump. Regression contract: normal update/softDelete unchanged; a row seeded with lockedAt+lockedByDocumentId updates and soft-deletes; drawer opens editable with no notice.

### R3: Stale `invoices` key in a pending feature notice
Finding: 3, P2, confidence 9/10. `src/lib/features/useFeatures.ts:95` `notice: data?.featureNotice ?? [],` returns the stored list unfiltered. `src/components/layout/FeatureNoticeBanner.tsx:22` `notice.map((key) => t(\`settings.features.items.${key}.label\`))`. A v20 upgrader who never dismissed the banner has `featureNotice: ['invoices', ...]`. Once the plan removes that i18n key, the banner prints the raw key `settings.features.items.invoices.label`. If invoices was the only entry, a banner shows that names nothing real. Reviewer: Claude (native).
Plan baseline: the plan doesn't cover this (it says "check the FeatureNoticeBanner copy").
Runtime evidence: `mergeNotice` (`features.ts:149`) filters by `FEATURE_KEYS` on write only. No read-side filter.
Comparison grid:
| Choice | Current | A Filter on read | B Leave |
|---|---|---|---|
| R3 notice | raw stored keys | `useFeatureNotice` filters `featureNotice` through `FEATURE_KEYS`; banner hides when the result is empty | unchanged; stale key renders raw |
| Test | none | `FeatureNoticeBanner.test.tsx`: stored `['invoices']` gives no banner; `['invoices','expenses']` names Expenses only | none |
| R1, R2 | pending | pending | pending |
Question D7:
D7 — Filter retired keys out of the feature notice?
Header: Notice
Options:
A) Filter on read (recommended)
B) Leave as is

State: approved
Actual answer: A) Filter on read, eng-review D7, 2026-10-13
Accepted scope: Grid column A: useFeatureNotice filters featureNotice through FEATURE_KEYS; banner hidden when empty; FeatureNoticeBanner.test.tsx cases ['invoices'] → no banner, ['invoices','expenses'] → Expenses only.

### R4: TransactionsPage.tsx is dead code the plan proposes to edit
Finding: 4, P2, confidence 10/10. `src/router.tsx:67-76`: `// Transactions route (legacy redirect to /income)` ... `throw redirect({ to: '/income', ...})`. `grep -rn "pages/transactions" src` finds no importer outside the file itself. The plan's change map edits `TransactionsPage.tsx:259-296` and proposes a new row-actions test for it. Reviewer: Claude (Section 2, Code Quality).
Plan baseline: edit the file (ticket bullet "Remove the ... row actions in ClientWorkSection.tsx and TransactionsPage.tsx").
Runtime evidence: there's no `src/pages/transactions/__tests__/`; the page renders nowhere.
Comparison grid:
| Choice | Current | A Delete file | B Edit as ticket says |
|---|---|---|---|
| R4 TransactionsPage | 314 LOC, unrouted | delete `src/pages/transactions/`; add its path to `noDeadDocumentModules` GONE list; `/transactions` redirect stays | strip the invoice actions; write a new row-actions test for a page users can't reach |
Question D8:
D8 — Delete the unrouted TransactionsPage instead of editing it?
Header: Dead page
Options:
A) Delete file (recommended)
B) Edit as ticket says

State: pending
Actual answer: unanswered
Accepted scope: none

### T1: TODO F2, trim BusinessProfile letterhead fields
Finding: follow-up. `nameEn`, `taxId`, `address1/En`, `city/En`, `logo` only fed invoice letterheads; `primaryColor` is live (ProfileBadge).
Comparison grid: | T1 | not tracked | A Add to TODOS.md | B Skip | C Build now |
Question D9:
D9 — Track the letterhead-field trim?
Header: F2 fields
Options:
A) Add to TODOS.md (recommended)
B) Skip
C) Build it now

State: pending
Actual answer: unanswered
Accepted scope: none

### T2: TODO F3, drop the Tauri fs plugin and $DOCUMENT write capability
Finding: follow-up. `src-tauri/capabilities/default.json` grants `fs:allow-write` on `$DOCUMENT/Mutaba3a/**`; its only JS consumer is `src/services/pdfArchival.ts:87`, which this plan deletes. Removing it is least privilege, but it needs Cargo.toml, lib.rs and a desktop build.
Comparison grid: | T2 | not tracked | A Add to TODOS.md | B Skip | C Build now |
Question D10:
D10 — Track removing the unused desktop file-write permission?
Header: F3 fs perm
Options:
A) Add to TODOS.md (recommended)
B) Skip
C) Build it now

State: pending
Actual answer: unanswered
Accepted scope: none

### T3: TODO F4, ImportDataModal and ImportDataPage duplicate import logic
Finding: follow-up. Both files carry their own `documents?`/`documentSequences?` file shape and import loop (`ImportDataModal.tsx:29-36`, `ImportDataPage.tsx:24-31`).
Comparison grid: | T3 | not tracked | A Add to TODOS.md | B Skip | C Build now |
Question D11:
D11 — Track merging the two import paths?
Header: F4 import
Options:
A) Add to TODOS.md (recommended)
B) Skip
C) Build it now

State: pending
Actual answer: unanswered
Accepted scope: none
