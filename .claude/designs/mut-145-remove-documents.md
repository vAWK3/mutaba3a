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
| `src/types/index.ts` | Remove `Document`, `DocumentItem`, `DocumentType`, `DocumentStatus`, `DocumentLanguage`, `DocumentSequence`, `DocumentFilters`, `DocumentDisplay`, `TemplateId`. **Keep `PaymentMethod`**: `PaymentRecord.method` (`:433`) uses it. Remove `Transaction.linkedDocumentId/lockedAt/lockedByDocumentId`. Remove `BusinessProfile.website/defaultTemplateId/defaultTaxRate/allowedCurrencies/bankName/bankBranch/bankAccountNumber/bankIban/paymentNotes`, the 8 letterhead-only fields `taxId/address1/address1En/city/cityEn/country/countryEn/postalCode` (T1) and `defaultLanguage` (D4). Remove `'invoices'` from `FeatureKey`. |
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
| `src/pages/transactions/TransactionsPage.tsx` | **Delete the file** (R4, approved D8). It's unrouted: `/transactions` redirects to `/income` (`router.tsx:67-76`), and nothing imports it. The redirect stays. |
| `src/components/drawers/IncomeDrawer.tsx` | Delete `isLocked`, the `useDocument` lookup, the locked notice and "view document" link (`:148-160`), and any disabled-when-locked props. |
| `src/pages/settings/ProfileDetailPage.tsx` | **Delete the page** (IA1). The tab and field removals below are superseded, because the drawer becomes the only editor. Original note kept for history: delete the Numbering, Document Defaults and Payment Details tabs, plus the 8 letterhead-only fields on the Info tab (T1, approved D12). **`defaultCurrency` lives on the Document Defaults tab and is core** (`lib/incomeEntry.ts:131` reads it), so move it into Profile Info as "Default currency". If only one tab is left, drop the tab strip. |
| `src/components/drawers/BusinessProfileDrawer.tsx`, `src/components/modals/WelcomeModal.tsx` | Drop `defaultLanguage` (D4). Drawer: also drop the 8 letterhead-only inputs (T1, approved D12): `taxId`, `address1`, `address1En`, `city`, `cityEn`, `country`, `countryEn`, `postalCode`. Keep `nameEn`, `logoDataUrl`, `email`, `phone` and `primaryColor`, which all have live readers. |
| `src/components/modals/ExportDataModal.tsx` (live, `SettingsPage.tsx:410`), `src/pages/settings/ImportDataPage.tsx` (live, `/settings/import`) | Retype the documents pass-through from the retained schema (D3) and remove the "documents" count from the import stats UI. |
| `src/components/modals/ImportDataModal.tsx` | **Delete** (T3, approved D13). It has no renderer; only the barrel `modals/index.ts:4` and its tests reference it. Move its 17 test cases to a new `src/pages/settings/__tests__/ImportDataPage.test.tsx`. |
| `src/demo/visitorSample.ts` | Remove `db.documents` from the seeded-tables list (the sample no longer writes any). **Keep** it in `ownDataTables()`: a person with only legacy invoices still "has data", per ADR-042. |
| `src/lib/features/useFeatures.ts:95` (R3, approved D7) | `useFeatureNotice` returns `featureNotice` filtered through `FEATURE_KEYS`. `FeatureNoticeBanner` already returns null on an empty list (`:20`). This stops a stored `'invoices'` from rendering a raw i18n key. |
| Settings → Optional features list | Becomes five rows. It's driven by `FEATURE_KEYS`, so no component change is expected. Check the `FeatureNoticeBanner` copy. |

### Tests (TDD order: write and update these first, watch them go red, then delete code)
New and changed assertions that prove each AC:
- **AC1:** `router.gateKeys.test.ts` has no `/documents` route. `SidebarNav.features.test.tsx` shows no Documents entry with every flag on. `ClientDetailPage.test.tsx` shows no invoice actions for an income row that has `linkedDocumentId`. `TransactionsPage` and `ImportDataModal` are on the guard's GONE list. New `src/__tests__/noDeadDocumentModules.test.ts`: a glob-and-grep guard, following `noDeadExpenseModules.test.ts` and `noDeadMoneyEventModules.test.ts`. It fails if `src/features/documents`, `src/pages/documents`, `DocumentDrawer`, `@react-pdf` or `/fonts/` reappear anywhere outside `src/hosted/`.
- **AC2:** `transactionRepo.test.ts` seeds a row with `lockedAt` and `lockedByDocumentId`; `update` succeeds and `softDelete` succeeds. These replace the existing "locked" tests. `IncomeDrawer.locked.test.tsx` is rewritten: a legacy-locked row opens fully editable with no notice. Rename it `IncomeDrawer.legacyLock.test.tsx`.
- **AC3:** new `retainedDocumentSchema.test.ts`: both tables exist in `db.tables`, and rows round-trip `serializeAllTables` → `restoreFromBackup`. `ImportExportModals.test.tsx` (ExportDataModal block): a profile export includes the profile's document rows. New `src/pages/settings/__tests__/ImportDataPage.test.tsx` (the 17 ported cases plus AC3): importing a file with `documents`/`documentSequences` restores them into the retained tables, and the stats line doesn't name documents.
- **AC4:** `features.test.ts` has `FEATURE_KEYS` = the five, and `resolveFeatures({invoices:true, expenses:true})` gives `{expenses:true, …}` with no `invoices` key. Update `featureDataProbes`, `reconcile`, `gatingDataSafety`, `routeGuard`, `leaveDisabledArea`, `FeatureNoticeBanner`, `migration-v20` (seeds documents and expects invoices auto-enabled, so drop that expectation and keep the other areas'), `settingsRepo` and `useAddMenuActions` mocks.
- **AC5:** none of `src/hosted/**` changes. `git diff --stat main -- src/hosted server` must be empty. The existing hosted suites run in the full suite.
- **AC7:** `noDeadDocumentModules.test.ts` checks `package.json`. After `npm run build`, run `grep -r "react-pdf" dist-web dist-desktop` and expect no hits.
- Also update: `OrphanedRecordsDrawer.test.tsx`, `RecordPaymentButton.test.tsx`, `paymentRecords.test.ts`, `migration-safety.test.ts` (drop the exportCount case), `migration-v21.test.ts` (fixture only), `stores.test.ts`, `useQueries.test.tsx`, `IncomeDrawer.test.tsx`.

Gate (use Node 22 via nvm, see memory): `npm run lint && npm run typecheck && npm run test:run && npm run build` (`test:integration` does not exist, TD-054 / MUT-47), plus `make qa`'s web income spec on a preview build, to confirm "Invoiced" still works.

## IA changes (apple-design review, approved 2026-10-13: "all of them")

The cuts leave the business profile with two editors for one object and an invoice-era field order. These four changes fix that:

- **IA1: edit profiles in the drawer; retire `ProfileDetailPage`.** `SettingsPage.tsx:266` `onEdit` and the profile link at `:246` call `openBusinessProfileDrawer({ mode: 'edit', profileId })`; edit mode already exists in the store (`stores.ts:101-106`) and the drawer (`BusinessProfileDrawer.tsx:89-107`). Delete `src/pages/settings/ProfileDetailPage.tsx` (844 LOC). Replace route `/settings/profiles/$profileId` (`router.tsx:169`) with a legacy redirect to `/settings`. Update `SidebarNav.features.test.tsx:329` and add the page to the `noDeadDocumentModules` GONE list. *Why:* Familiarity: one object, one container. It also follows CLAUDE.md's drawer-first rule.
- **IA2: "Document Currency" becomes "Default currency".** The drawer field sets the default for new income (`lib/incomeEntry.ts:131`). Move the label to an i18n key in `en.json` and `ar.json`.
- **IA3: drop `businessType`.** Its values, exempt/authorized/company/lawyer, are the VAT status that chose the invoice type. Only the editors, WelcomeModal (`:47`) and the seed read it. Remove it from the type, the drawer, WelcomeModal, the seed and test/utils. Rows are untouched.
- **IA4: email becomes optional, and the drawer is regrouped.** Schema `email: z.string().email().optional().or(z.literal(''))`. Drawer order:
  - **Identity:** logo, name, English name, colour
  - **Money:** default currency
  - **Contact (optional):** email, phone
  - **Make default** toggle

  Consumers that must handle a missing email: `SettingsPage.tsx:255` and `ExportDataModal.tsx:337` render nothing instead of an empty line. **Import guard (critical):** `ImportDataPage.tsx:99` matches `p.email === data.profile?.email`. It must match by email only when both are non-empty, or two email-less profiles would collide and an import would merge into the wrong business. Test both cases in `ImportDataPage.test.tsx`.

Scope note: "disregard documents completely" was read as **no document remnants in any UI or label**. The retained tables (R1/D5) and the backup/export row pass-through stay; they protect data, they don't surface documents.

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
- ~~F2~~: moved into scope as T1 (D12), with corrected fields.
- **F3 (TODOS.md, D10):** Drop the Tauri `fs` plugin and the `$DOCUMENT/Mutaba3a/**` write capability. `pdfArchival` was its only user, so dropping it is least privilege. It touches `Cargo.toml`, `lib.rs` and `capabilities/default.json`, so it needs a desktop build to verify.
- ~~F4~~: moved into scope as T3 (D13). The modal was dead, so it's deleted and its tests are ported.
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

State: approved
Actual answer: A) Delete file, eng-review D8, 2026-10-13
Accepted scope: Grid column A: delete src/pages/transactions/ (TransactionsPage.tsx, 314 LOC); list it in noDeadDocumentModules GONE; /transactions → /income redirect stays; note on MUT-145. No TransactionsPage row-actions test.

### T1: Trim BusinessProfile letterhead-only fields (was TODO F2)
Finding: follow-up promoted to scope. Corrected evidence (grep, 2026-10-13): letterhead-only, read only by BusinessProfileDrawer, ProfileDetailPage, the demo seed and test/utils: `taxId`, `address1`, `address1En`, `city`, `cityEn`, `country`, `countryEn`, `postalCode`. **Not letterhead-only**: `nameEn` (ProfileSwitcher, ProfilePickerModal, SettingsPage, Export/Import), `logoDataUrl` (avatar in ProfileQuickPicker, ProfileContextChip, ProfileSwitcher, ProfilePickerModal, SettingsPage), `email`/`phone` (export/import, SettingsPage), `primaryColor` (ProfileBadge).
Comparison grid:
| T1 | Current | A Trim the 8 letterhead-only fields | B Back to TODOS.md |
|---|---|---|---|
| Fields removed (type + both editors + seed + test util) | none | taxId, address1, address1En, city, cityEn, country, countryEn, postalCode | none |
| nameEn, logoDataUrl, email, phone, primaryColor | kept | kept (live readers) | kept |
| Rows | n/a | untouched; stale props inert (same as R2) | n/a |
Question D12:
D12 — Build-now letterhead trim: remove only the 8 fields with no reader outside invoices?
Header: Letterhead
Options:
A) Trim 8 fields (recommended)
B) Back to TODOS.md

State: approved
Actual answer: A) Trim 8 fields, eng-review D12, 2026-10-13
Accepted scope: Remove taxId, address1, address1En, city, cityEn, country, countryEn, postalCode from BusinessProfile type, BusinessProfileDrawer, ProfileDetailPage, demo seed, test/utils. Keep nameEn, logoDataUrl, email, phone, primaryColor. Rows untouched.
History: D9 answered "C) Build it now" for "nameEn, taxId, address1/En, city/En, logo". Reopened because that list was wrong: nameEn and logoDataUrl have live readers outside invoices, and country/countryEn/postalCode were missed.

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

State: approved
Actual answer: A) Add to TODOS.md, eng-review D10, 2026-10-13
Accepted scope: TODOS.md entry only: remove tauri-plugin-fs (Cargo.toml:28, lib.rs:12, package.json @tauri-apps/plugin-fs) and fs:allow-mkdir/allow-write capabilities, verified by a desktop build.

### T3: Import paths (was TODO F4)
Finding: corrected evidence. `ImportDataModal.tsx` (805 LOC) has no renderer; only `modals/index.ts:4` exports it, and only `ImportExportModals.test.tsx` uses it (17 `it` cases). The live path is `ImportDataPage.tsx` (562 LOC) at `/settings/import` (`router.tsx:174-177`), which has **zero** tests. The two share identical modes (`create`/`legacy`/CSV). With one live caller, a shared import function fails the shared-code rubric (needs 2 verified callers).
Comparison grid:
| T3 | Current | A Delete dead modal, port tests to the page | B Extract shared function anyway | C Back to TODOS.md |
|---|---|---|---|---|
| ImportDataModal | dead, 805 LOC | deleted (+ barrel export) | kept, calls new helper | kept |
| Import tests | 17 on the dead modal; page untested | the 17 cases rewritten against ImportDataPage (incl. AC3 documents pass-through) | tests stay on modal; page still untested | unchanged |
| New module | none | none | `src/services/profileImport.ts` | none |
Question D13:
D13 — Replace "merge the import paths" with "delete the dead modal and move its tests to the live page"?
Header: Import path
Options:
A) Delete modal, port tests (recommended)
B) Extract shared function
C) Back to TODOS.md

State: approved
Actual answer: A) Delete modal, port tests, eng-review D13, 2026-10-13
Accepted scope: Delete ImportDataModal.tsx + barrel export; rewrite its 17 cases as src/pages/settings/__tests__/ImportDataPage.test.tsx incl. AC3 documents pass-through into retained tables; ExportDataModal (live, SettingsPage.tsx:410) keeps its describe block.
History: D11 answered "C) Build it now" ("merge onto one import function"). Reopened because one path turned out to be dead and the live one is untested.

Approval readiness: PASS. R1 (D5), R2 (D6), R3 (D7), R4 (D8), T1 (D12, reopened from D9), T2 (D10), T3 (D13, reopened from D11), scope D1–D4. Every accepted remedy cites its own answer.

## Review sections

**Scope Challenge.** Findings: R1 [P1] (confidence 10/10) ticket "drop the tables" vs ADR-029 → Retain. R2 [P1] (confidence 10/10) `repository.ts:373,:487` lock → Unlock in code. Result: scope accepted as-is, plus approved additions D1–D3, R4, T1, T3.

**1. Architecture.** [P2] (confidence 9/10) `src/lib/features/useFeatures.ts:95` `notice: data?.featureNotice ?? []`: a stored retired key renders as a raw i18n key in `FeatureNoticeBanner.tsx:22`. Dispositions: R3 accepted (D7). Nothing touches auth or the network. The hosted portal is untouched, which the empty `git diff -- src/hosted server` check proves.

**2. Code quality.** [P2] (confidence 10/10) `router.tsx:67-76`: TransactionsPage is unrouted but planned for editing → R4 accepted (D8, delete). [P2] (confidence 10/10) `modals/index.ts:4`: `ImportDataModal` has no renderer, while the live `ImportDataPage` has no tests → T3 accepted (D13). [P3] (confidence 10/10) the letterhead list in the D9 brief was wrong (`nameEn` and `logoDataUrl` have live readers) → corrected, T1 accepted (D12). Shared-code rubric: a shared import helper was rejected because only one live caller exists.

**3. Tests.** Framework: Vitest (`vitest.config.ts`), plus Playwright `qa/`. Gate: `npm run test:run`.

```
CODE PATHS                                              USER FLOWS
[+] db/repository.ts transactionRepo                    [+] Edit a legacy-locked income entry
  ├── update(): guard removed                             └── [GAP→planned] IncomeDrawer.legacyLock.test.tsx
  │   ├── [★★★ TESTED] normal update (transactionRepo.test) [+] Stale /documents link
  │   └── [GAP→planned] row with lockedAt updates          └── [GAP→planned] router.gateKeys.test.ts redirect
  └── softDelete(): guard removed                      [+] Settings → Import profile file
      └── [GAP→planned] row with lockedAt deletes          └── [GAP→planned] ImportDataPage.test.tsx (17 ported + AC3)
[+] db/database.ts retained tables                     [+] Settings → Export profile
  └── [GAP→planned] retainedDocumentSchema.test.ts         └── [★★ TESTED→extend] ImportExportModals (Export block)
[+] lib/features (5 keys)                              [+] Upgrader with pending notice
  ├── [★★★ TESTED→update] features/reconcile/probes        └── [GAP→planned] FeatureNoticeBanner ['invoices']
  └── [GAP→planned] resolveFeatures drops 'invoices'   [+] Profile editors (Info tab only)
[+] guard: noDeadDocumentModules.test.ts                   └── [★★ TESTED→update] ClientDetailPage / profile tests
  └── [GAP→planned] GONE paths, @react-pdf, /fonts/

COVERAGE after plan: every changed path has a planned ★★/★★★ test. GAPS left unplanned: 0
```
Regression contract (approved with R2): normal update and softDelete behave unchanged; legacy-locked rows become editable and deletable; nothing else changes.

**4. Performance.** No issues found. This is pure deletion: the v20/restore probe loses one table scan, a lazy react-pdf chunk goes, and 4.3 MB of TTFs leave every build.

**Outside voice.** Unavailable: the Codex CLI isn't installed, and the native fallback needs TaskOutput, which this session doesn't have. No clean-review credit is claimed.

## NOT in scope
- Hosted portal `/documents` attachments (ADR-028), a different feature.
- The other 5 optional areas and the gating framework, beyond removing the `invoices` key.
- Tauri fs plugin removal: TODOS.md #9 (D10). It needs a desktop build.
- Clearing stale `lockedAt`/`linkedDocumentId` from rows and dropping their v8+ indexes: rejected by D6 / ADR-029.
- MUT-106 (invoice PDFs in Brand v2): obsolete, to be closed as Won't Do.

## What already exists
- `src/db/retained/engagementSchema.ts`, `monthCloseSchema.ts` and their retention tests: the exact pattern R1 follows.
- `src/__tests__/noDeadExpenseModules.test.ts`, `noDeadMoneyEventModules.test.ts`: the guard-test pattern.
- `resolveFeatures` already drops unknown stored keys (`features.ts:43-52`), so no settings migration is needed.
- `requireFeature`'s redirect-to-Home is the destination the legacy `/documents/$` route reuses.
- `backup.ts` already serializes every table, so retention satisfies AC3 with no new export.

## Failure modes
| Path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| Legacy-locked entry | a guard left in some other write path still throws | legacyLock + transactionRepo tests | clear error toast (but tested away) |
| Retained tables | a later cleanup nulls the stores | retainedDocumentSchema.test.ts | nothing (silent data loss) → guarded by test |
| Import old export | file with documents fails the import | ImportDataPage.test.tsx AC3 case | clear import error |
| Pending notice | raw key in banner | FeatureNoticeBanner case | handled (hidden) |
| Profile fields removed | a hidden reader of `taxId`/address breaks | typecheck (app + hosted tsconfig) | build fails, not users |
Critical gaps: 0.

## Worktree parallelization strategy
Sequential implementation, no parallelization opportunity. `src/types/index.ts`, `repository.ts` and `useQueries.ts` are shared by every lane, and the UI deletions depend on the type removals.

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above.

- [ ] **T1 (P1, human: ~2h / CC: ~15min)**: db: retained schema module + retention test (R1)
  - Files: src/db/retained/documentSchema.ts, src/db/database.ts, src/db/__tests__/retainedDocumentSchema.test.ts
  - Verify: `npx vitest run src/db/__tests__/retainedDocumentSchema.test.ts`
- [ ] **T2 (P1, human: ~2h / CC: ~15min)**: repo: unwind the transaction lock (R2)
  - Files: src/db/repository.ts, src/db/interfaces.ts, src/hooks/useMutationWithFeedback.ts, src/components/drawers/IncomeDrawer.tsx, IncomeDrawer.legacyLock.test.tsx, transactionRepo.test.ts
  - Verify: `npx vitest run src/db/__tests__/transactionRepo.test.ts src/components/drawers`
- [ ] **T3 (P2, human: ~30min / CC: ~5min)**: features: filter retired notice keys (R3)
  - Files: src/lib/features/useFeatures.ts, FeatureNoticeBanner.test.tsx
  - Verify: `npx vitest run src/components/layout/__tests__/FeatureNoticeBanner.test.tsx`
- [ ] **T4 (P2, human: ~15min / CC: ~2min)**: pages: delete unrouted TransactionsPage (R4)
  - Files: src/pages/transactions/, noDeadDocumentModules GONE list
  - Verify: `npm run typecheck`
- [ ] **T5 (P2, human: ~2h / CC: ~15min)**: profile: drop defaultLanguage + 8 letterhead fields (D1, T1)
  - Files: src/types/index.ts, BusinessProfileDrawer.tsx, ProfileDetailPage.tsx, WelcomeModal.tsx, demo/seedData/profile.ts, test/utils.tsx
  - Verify: `npm run typecheck && npx vitest run src/pages/settings src/components/drawers`
- [ ] **T6 (P2, human: ~4h / CC: ~30min)**: import: delete dead ImportDataModal, port 17 tests to ImportDataPage (T3)
  - Files: src/components/modals/ImportDataModal.tsx, modals/index.ts, ImportExportModals.test.tsx, src/pages/settings/__tests__/ImportDataPage.test.tsx
  - Verify: `npx vitest run src/pages/settings src/components/modals`
- [ ] **T7 (P2, human: ~20min / CC: ~3min)**: router: legacy `/documents/$` → `/` (D3)
  - Files: src/router.tsx, src/__tests__/router.gateKeys.test.ts
  - Verify: `npx vitest run src/__tests__/router.gateKeys.test.ts`
- [ ] **T9 (P2, human: ~3h / CC: ~25min)**: profile IA: drawer-only editing, Default currency label, drop businessType, optional email + regroup, import email guard (IA1–IA4)
  - Files: SettingsPage.tsx, BusinessProfileDrawer.tsx, router.tsx, ProfileDetailPage.tsx (delete), WelcomeModal.tsx, ImportDataPage.tsx, ExportDataModal.tsx, types/index.ts, en.json, ar.json, SidebarNav.features.test.tsx
  - Verify: `npm run typecheck && npx vitest run src/pages/settings src/components/drawers src/components/layout`
- [ ] **T8 (P2, human: ~15min / CC: ~2min)**: assets: delete public/fonts/ (D2) with a guard assertion
  - Files: public/fonts/, src/__tests__/noDeadDocumentModules.test.ts
  - Verify: `npm run build && ! grep -rq react-pdf dist-web`

## Completion summary
- Step 0: Scope Challenge: scope accepted as-is (with approved additions)
- Architecture Review: 1 issue found
- Code Quality Review: 3 issues found
- Test Review: diagram produced, 1 gap identified (live import page untested → T3)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 3 items proposed to user (1 added, 2 built now)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (CLI not installed; native fallback lacks TaskOutput)
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 9/9 = every answer scored for Completeness picked the 10/10 option (D5, D6, D7, D8, D12, D13 plus the 3 corrected re-asks counted once each)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex via `/plan-eng-review` | Independent 2nd opinion | 1 | unavailable | CLI not installed |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 5 issues, 0 critical gaps (all resolved by approved remedies) |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable (not installed); no native fallback run (TaskOutput not available). Missing coverage, not clean.
- **VERDICT:** Eng review complete with every finding resolved by an approved remedy; status issues_open means mapped work, not open questions. No reviews CLEAR; eng review required by the dashboard's rule until a clean re-run.

NO UNRESOLVED DECISIONS
