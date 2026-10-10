# CHANGELOG.md — Change History

> **Purpose**: Track all significant changes to the codebase.
> **Rule**: Update this file after completing any change.

---

## Format

```markdown
## [Version] - YYYY-MM-DD

### Added
- New features

### Changed
- Changes to existing functionality

### Fixed
- Bug fixes

### Removed
- Removed features

### Technical
- Refactoring, dependencies, infrastructure
```

---

## [Unreleased] - 2026-10-10 — MUT-6: "Record payment" becomes a primary row action

**Scope:** `src/components/ui/RecordPaymentButton.{tsx,css}` (new) + `index.ts`,
`src/components/drawers/PartialPaymentDrawer.tsx`, `src/db/repository.ts`,
`src/hooks/useQueries.ts`, `src/lib/i18n/translations/{en,ar}.json`,
`src/pages/{clients/ClientDetailPage,income/IncomePage,projects/ProjectDetailPage}.tsx`,
7 test files (2 new), `.claude/{DECISIONS,COMPONENT_REGISTRY,TECH_DEBT,TEST_PLAN}.md`,
`TODOS.md`.

### Added
- **`RecordPaymentButton`** — the payment affordance is now a button on the row
  with the remaining balance on it, at all four surfaces: ClientDetailPage
  (receivables and transactions tabs), IncomePage, ProjectDetailPage. It owns
  the single gate (`income && paymentStatus !== 'paid' && remaining > 0`) that
  previously existed as three different inline conditions, one of which was
  missing entirely — the client receivables tab offered "Record payment" on
  settled rows. Props-in, no store import, matching the rest of `components/ui`.
- Overpayment guard in `paymentRecordRepo.create`/`.update`, inside the
  existing `rw` block so concurrent writes cannot both pass (**ADR-030**).
- i18n keys `transactions.partialPayment.{amountMustBePositive,overpayment}` in
  en and ar.

### Changed
- The payment drawer opens with the full remaining balance prefilled, so
  settling in full is one confirm; the field is still editable down to a
  partial amount, and empty when there is nothing left to pay.
- Its two hardcoded English validation strings are now translated.
- The row actions column was a fixed 40–48px sized for a kebab alone; it is now
  shrink-to-fit, so the added button cannot squeeze the amount column.
- **Behaviour reversal (ADR-030 override log):** overpayment was allowed and
  clamped, documented by two passing tests. It is rejected now, and those tests
  are rewritten to assert rejection.
- Payments on a `lockedAt` transaction keep working — that was true only by
  accident before (the recalc bypasses the lock guard); it is now named in a
  comment and pinned by a test. The `['archivedAt']` allowlist is untouched.

### Fixed
- **Stale balances after a payment (MUT-6 AC #5, a live defect).**
  `invalidatePaymentRecordQueries` never invalidated the income keys, so
  `/income` and the client Receivables tab kept showing an old status and
  remaining amount for up to the 60s staleTime right after a payment was saved.
  Adds `['income']`, `['receivables']`, `['incomeOverviewTotals']` and
  `['incomeAttentionReceivables']` — the set `markPaid` already invalidated.
- **The Overview KPI strip and attention feed went stale after every write**
  (found in QA reconciliation). Money-event views are *derived* —
  `moneyEventRepository` recomputes them from transactions, expenses and
  projected income on every read and never writes — so nothing invalidated
  their keys as a side effect. The one helper that listed them,
  `useInvalidateMoneyEvents`, had **zero callers anywhere in the app**, so the
  home page served pre-write numbers after recording a payment, creating
  income, marking paid, adding an expense or changing a retainer.
  `invalidateMoneyEventQueries` is now exported from `useMoneyEventQueries.ts`
  (beside the keys it owns, so the list still exists once) and called by all
  four write paths: `useQueries`, `useIncomeQueries`, `useExpenseQueries`,
  `useRetainerQueries`. Pre-existing and app-wide, not caused by MUT-6; fixed
  here at the owner's request because the payment path is where it cost most.
- **The payment date defaulted to the UTC date, not the local one** (AC #4,
  found in QA reconciliation). `PartialPaymentDrawer` computed "today" with
  `new Date().toISOString().split('T')[0]`, which ADR-022 forbids: a user in
  New York recording a payment at 20:30 on 15 March was handed **16 March**,
  and one in Jerusalem after midnight was handed yesterday. It now uses
  `todayISO()` like every other drawer. Pinned by two faked instants that
  straddle midnight in opposite directions, so the test is honest in both
  `Asia/Jerusalem` and `npm run test:tz`.

### Technical
- **TD-021** recorded: `invalidateIncomeQueries` and
  `invalidatePaymentRecordQueries` keep overlapping key lists. The eng review
  deliberately chose the in-place fix over extracting a shared helper.
- TODOS 3–5 from the eng review: payment-record sync ops are captured but
  `ops-engine.ts` can never apply them (MUT-55); a failed refetch after a
  successful write is silent app-wide; "Mark paid" and "Record payment" are now
  two-click duplicates that disagree about the date (decide after MUT-18).
- Pre-existing and untouched: the 18 `ExpensesLedgerPage` test failures.
---

## [Unreleased] - 2026-10-10 — MUT-49: updater public key restored to BEDF931CA1D6C777

**Scope:** `src-tauri/tauri.conf.json`, `src/lib/__tests__/updater-config.test.ts` (new), `.claude/DECISIONS.md` (ADR-031, ADR-027 merge, index), `.claude/TECH_DEBT.md` (TD-022), `.claude/TEST_PLAN.md`, `.claude/PATTERNS.md`, `.claude/CI_CD.md`, `.github/workflows/build-windows.yml`. Epic MUT-48.

### Fixed
- `plugins.updater.pubkey` is back to the pre-`ae9fb1c` value, byte-identical to
  `~/.tauri/mutaba3a.key.pub`. The 2026-10-05 rotation pointed the app at a key
  (`AB7B64537B1DE22C`) whose private half never signed a published release
  and is not configured anywhere the pipeline signs from. Every real signer
  (the macOS release signer, the CI secret, the v0.0.63 signatures) is
  `BEDF931CA1D6C777`. No shipped build embeds the wrong key
  (`ae9fb1c` is not an ancestor of `v0.0.63`), so the revert is
  backward-compatible.

### Added
- `src/lib/__tests__/updater-config.test.ts`: pins the configured public key
  to the canonical base64 string and asserts the key id from the key bytes
  (line 2, bytes 2..10), printing both fingerprints on mismatch. Written red
  against the `AB7B...` config, green after the revert.
- ADR-031: the key is canonical; a real rotation ships the new public key in a
  release signed by the old key before signing switches, and that transitional
  release is necessary, not sufficient (late clients still reinstall).
- TD-022: the release-time guards deferred to MUT-51.
- `.claude/CI_CD.md`: the Tauri troubleshooting row no longer says to
  regenerate the signing key on a bad signature (that is how `ae9fb1c`
  happened); the updater secret names now match the real workflow. The
  Windows workflow's "latest.json not found" hint points at `./deploy.sh`, and
  the workflow runs `updater-config.test.ts` against the release tag before
  `tauri build`, so the guard executes on the path that compiles the key into
  the Windows build. The macOS script's test gate is MUT-51 (TD-022).

### Technical
- `.claude/DECISIONS.md` carried two `## ADR-027` headings (the 2026-10-09
  fee-proposal record and its 2026-10-10 override). They are now one ADR-027
  with two dated sections; ADR-028 and ADR-029 keep their numbers because
  CHANGELOG, TEST_PLAN, TECH_DEBT and the designs cite them. The `## ADR-XXX`
  inside the Decision Template is the template, not a placeholder to fill.
- Release-time checklist for the ticket's acceptance criteria 3 and 4 lives
  on MUT-49; the shell signer-vs-config check and the dead
  `UPDATER_PRIVATE_KEY_FILE` declaration in `deploy.sh` are handed to MUT-51.

---

## [Unreleased] - 2026-10-10 — MUT-16: insights, planning and projects are gated behind their switches

Brief `.claude/designs/mut-16-gate-insights-planning-projects.md` (+ test
plan), eng review §8, outside voice §9. ADR-032 addendum. Five commits, one
per build-order step (router, nav, client profile, drawers, onboarding).

### Added
- `/insights`, `/planning`, `/projects` and `/projects/$projectId` carry
  `beforeLoad: requireFeature(key)`: a deep link while the area is off
  redirects home before the lazy chunk loads. `/reports` → `/insights` and
  `/transactions` → `/income` stay unconditional (AC 3), proven by the new
  `legacyRedirectsCore` test with every area off.
- Sidebar: Insights, Planning and Projects leave the main/workspace sections
  for "More" (after Expenses, Documents, Retainers). A fresh install shows
  Home, Income, Clients, Settings. `+ Add → Project` (sidebar and top bar)
  renders only while projects is on.
- Client profile: the Projects tab, its body and both **+ Project** buttons
  render only while projects is on; an active projects tab falls back to
  Summary. Project names on the work list stay as text (AC 4).
- Income and expense drawers: the optional project field hides while
  projects is off; form state is untouched, so editing an entry that carries a
  `projectId` saves it unchanged (D3).
- Onboarding: while projects is off the overlay completes the project step
  itself (no entity), so a new install runs client → income (D4).
- `RetainerDrawer`'s project picker follows the switch too (review #2).
- `useFeaturesLoaded()` in `lib/features/useFeatures.ts`: whether the
  settings row has been read; the onboarding skip waits for it (review #1).
- Tests: router gates (+4), gate keys (30: each gated route reads its own
  key), legacy core redirects (2), sidebar (+3), client profile (+2), income
  drawer (+3), expense drawer project field (3), retainer drawer project
  field (2), onboarding overlay (6). Suite: 123 files, 2067 passed, 5 skipped.

### Fixed (outside review, brief §9)
- The onboarding project-step skip no longer fires while the settings row is
  still loading, so a projects-on user mid-onboarding keeps their step.
- A project created during onboarding before the area was switched off is no
  longer attached to the income step through a hidden field.
- `ClientDetailPage` reads `visibleTab` in every tab comparison.

### Removed
- `useOnboardingDrawerSuccess` (zero callers; the drawers call
  `completeStep` directly).

### Decided
- Projects off hides; the switch never clears: `Transaction.projectId` is
  kept through an edit while the field is hidden. The client→project cascade
  still clears a tag that no longer matches the chosen client, visible or
  not (D3, review #4).
- The onboarding store's completion rule (`client`, `project`, `income`)
  stays; the overlay auto-completes the step rather than the store learning
  about flags (D4). The indicator still shows three steps (TD-027).

### Not done here
- The sidebar's final grouping and the `+ Add` menu's shape (MUT-15).
- No `suppliers` work: folded into expenses by MUT-12, view deleted by MUT-14.

---

## [Unreleased] - 2026-10-10 — MUT-14: expenses collapse to one gated ledger; MUT-20 fixed

Brief `.claude/designs/mut-14-collapse-expenses.md` (+ test plan), eng
review §9, outside voice §10 (twelve findings, all dispositioned before the
prune commit). ADR-029 and ADR-032 addenda. Safety tag before deletion:
`mut-14-pre-expenses-collapse`.

### Removed (one commit per page)
- `ExpensesPage` (profiles), `ProfileExpensesPage`, `ReceiptsPage` (+ its
  match components), `ExpensesOverviewPage`, `ExpensesForecastPage`,
  `VendorsPage`, `MonthCloseChecklistPage` (+ `ClosedMonthWarning`),
  `SuppliersPage` and the `/suppliers` route, the orphan
  `RecurringRuleDrawer` and `BulkUploadDrawer`. Their eight paths redirect to
  `/expenses`.
- Pruned by the consumer rule: forecasting (`forecastCalculations.ts`,
  `useExpenseForecast`, yearly / all-profile totals), receipt matching
  (`matchingAlgorithm.ts`, suggestion and bulk-upload hooks and helpers,
  `receiptRepo.linkToExpense`), month close (`monthCloseRepo` and hooks;
  the **table stays**, typed in `src/db/retained/monthCloseSchema.ts`),
  vendor management (`mergeVendors`, `addAlias`, `isSameVendor`,
  `findBestVendorMatch`), the `linkReceiptId` drawer chain, and 216 orphaned
  i18n leaves (`suppliers.*`, `monthClose.*`, `receipts.*`, most of
  `expenses.*`) in en and ar.

### Added
- **Export receipts** in Settings › Data tools: one ZIP with
  `<profile>/<YYYY-MM>/<file>` for every uploaded receipt, built by the
  tested `buildAllReceiptsArchive`; `receipts.count()` for the row count.
  Shipped before the receipts pages were deleted (ADR-029 addendum).
- `/expenses` gated by `requireFeature('expenses')`; Expenses moved from the
  main sidebar section to "More"; `+ Add → Expense`, the top bar's New
  expense and duplicate-as-expense on the project page follow the switch.
- Ledger: **Edit recurring rule** on recurring rows and on projected
  occurrence cards (the only management entry point was on a deleted page);
  receipt-count badge on rows; the two links to deleted routes are gone.
- `ExpenseDrawer` seeds the default categories for a profile that has none
  (the seeding button lived on a deleted page).
- Tests: ledger (+1), zip export (3), router gates (+1), legacy redirects (8),
  sidebar (+2), no-dead-modules guard, retained month-close schema (3),
  backup round-trip data safety (2); i18n parity for `expenses` en/ar.

### Fixed
- **The Settings backup import now reconciles optional areas.** MUT-12 wired
  the reconcile into `migration-safety.ts`'s restore only; the Settings page
  uses `src/db/backup.ts`, which is now covered too (found by the new
  round-trip test).
- **`useFeatureEnabled` no longer imports the `hooks/useQueries` barrel**;
  page tests that mock that barrel wholesale (IncomePage) broke the moment
  the top bar read a flag. The settings query is declared inside the features
  module with the same `['settings']` key.
- **MUT-20:** the 18 failing `ExpensesLedgerPage` tests. Root cause: the
  page renders its no-profile state without an active profile and the test
  never provided one. Fixed by mocking `useActiveProfile` (a test fix, not a
  product change; nothing renders the ledger against a real profile row).

### Decided
- Expenses already recorded stay visible on Home, client and project pages
  while the area is off; only create entry points follow the switch (D9).
- Receipts are exportable, not viewable, after this ticket; vendors stay
  viewable and creatable through the ledger and the drawer.

---

## [Unreleased] - 2026-10-10 — MUT-13: invoices/documents and retainers are gated behind their switches

Brief `.claude/designs/mut-13-gate-invoices-retainers.md` (+ test plan), eng
review §8, outside voice §9. First consumer of the MUT-12 switchboard;
ADR-032 addendum records the gating pattern. Jira MUT-13 under MUT-2.

### Added
- **`requireFeature(key, to = '/')`** (`src/lib/features/routeGuard.ts`): a
  router `beforeLoad` that reads the flag through the repository and throws a
  redirect before the lazy page chunk is requested. Applied to `/documents`,
  `/documents/new`, `/documents/$documentId`, `/documents/$documentId/edit`
  and `/retainers` in `src/router.tsx`.
- **Sidebar "More" section** (`nav.sections.optional`): Documents and
  Retainers appear only while their areas are on; hidden when both are off.
  Core sections untouched (MUT-15 owns the final grouping).
- **Client profile entry points**: *Generate invoice* / *View invoice* row
  actions on income rows (invoices on) in both the Receivables and
  Transactions tabs, mirroring the legacy `/transactions` action;
  **`ClientRetainersCard`** on the Summary tab (retainers on) with New
  retainer and View all.
- **Locked income entry** (`IncomeDrawer`): a notice naming the locking
  document, Save and Delete disabled; *View document* while invoices is on,
  "turn on Invoices in Settings" while it is off. The repository guard is
  unchanged and still the source of truth.
- **Home attention feed** leaves projected-retainer items out while retainers
  is off (their only action deep-links to `/retainers`).
- i18n en + ar: `nav.sections.optional`, `clients.detail.retainers.*`,
  `drawer.income.locked.*`. `.drawer-notice` styles.
- **Create invoice from an income entry really links it:** `openDocumentDrawer`
  takes `linkTransactionId`; the drawer prefills currency, client and one line
  from the entry and links it on create, so the row flips to *View invoice*.
- `defaultPendingComponent: PageLoader` on the router, so a reload or deep link
  into a gated route shows the loader while the flag is read instead of a
  blank first paint.
- Tests: route guard (5), router gates (10), sidebar (4), client profile entry
  points (5), locked drawer (5), attention feed (2), data safety + auto-enable
  end to end (2), repository delete-lock (1).

### Fixed
- **`transactionRepo.softDelete` now honours the document lock** (it only
  guarded `update`); the drawer's disabled Delete is no longer the only guard.
- The home KPI strip (`PredictiveKpiStrip`) no longer counts projected
  retainer income while the Retainers area is off.
- The lock error toast no longer says "unlock the document first".

### Notes
- Lock contract, now stated: details immutable, payments allowed (row menu),
  delete refused, archive allowed. Toggling writes only the settings row;
  documents, sequences and retainers are untouched (tested). Auto-enable on
  upgrade is MUT-12's.
- The legacy `/transactions` page keeps its own ungated *Generate invoice*
  item; the route redirects to `/income`, so it is unreachable (TD-025).

---

## [Unreleased] - 2026-10-10 — MUT-12: per-feature Advanced toggle in Settings, off by default (Dexie v20)

Brief `.claude/designs/mut-12-advanced-features-toggle.md` (+ test plan),
eng-reviewed with an outside-voice pass; ADR-032 (numbered ADR-030 on the branch; renumbered at merge because main's MUT-6 took ADR-030). Jira MUT-12 under MUT-2.
Nothing is gated yet — MUT-13/14/16 consume the switches.

### Added
- **Settings › Advanced features**: one `Switch` per optional area —
  invoices, retainers, expenses, insights, planning, projects — all off on a
  fresh install (`pages/settings/AdvancedFeaturesSection.tsx`).
- **`Settings.features`** (typed partial map) and **`Settings.featureNotice`**
  on the settings row; `settingsRepo.get()` now returns `ResolvedSettings`
  with every key present. `src/db/defaultSettings.ts` holds the one default
  row used by the repository and `initDatabase()`.
- **`src/lib/features/features.ts`** (pure): `FEATURE_KEYS`, `DEFAULT_FEATURES`,
  `resolveFeatures`, `withFeature`, data probes, `reconcileFeaturesWithData`
  and the swallowing `reconcileFeaturesAfterDataLoad`.
- **`src/lib/features/useFeatures.ts`**: `useFeatureEnabled`, `useFeatureFlags`,
  `useSetFeatureEnabled`, `useFeatureNotice` (React) and `readFeatureFlags()`
  for router `beforeLoad` guards.
- **Dexie v20** (no schema change): the upgrade switches on every area that
  already has data and records a notice; try/caught so it can never block
  open. Same reconcile after backup restore, data import (both legacy import
  flows and the profile import modes), demo seeding and sync-bundle import.
- **`FeatureNoticeBanner`** in `AppShell`: tells the user once which areas were
  switched on for their data, links to Settings, clears on dismiss.
- **`Switch`** UI component (`role="switch"`, keyboard, RTL via logical
  properties). i18n `settings.features.*` in en + ar.
- Tests: 8 new files (features, probes, reconcile, hooks, migration v20,
  Switch, section, banner) + extended settingsRepo, migration-safety and
  ImportExportModals tests; i18n parity test for the new keys.

### Decided
- `suppliers` is folded into `expenses` (vendors are the expenses module's
  table); the ticket's seventh toggle is not shipped (ADR-032 §5).
- Archived rows count as data for auto-enable; soft-deleted rows do not;
  projects have no soft delete so any row counts.

### Technical
- `MiniCrmDatabase` takes an optional database name so the v20 upgrade is
  tested on a real v19 → v20 open.
- `ISettingsRepository.get()` returns `ResolvedSettings` (a subtype; no caller
  changes).

---

## [Unreleased] - 2026-10-10 — Money v1 pilot decisions: download-only attachments accepted, Office Admin excluded; epic bookkeeping (MUT-25 / MAL-939)

**Scope:** `.claude/DECISIONS.md` (ADR-028 + index), `.claude/designs/money-v1-m6-summaries-audit-attachments.md` §5, `.claude/designs/money-v1-handover.md` §4. No code.

### Summary
- **ADR-028:** M6 decision 4 accepted for the pilot — attachments stay download-only, `READY` means verified size and type, the scanner pipeline is a post-pilot follow-up to ticket before GA.
- **Office Admin does not get access to Money** (owner, 2026-10-10): recorded against MAL-870 and as an ADR-150 addendum in Malafat; Mutaba3a's handover §4 updated to match.
- **Jira:** MUT-40, MUT-41, MAL-940…943 → Done; spikes MUT-26, 27, 29, 30, 31, 32 and MAL-869, 871 closed as answered by ADR-024/025 and ADR-150; MUT-28 and MAL-870 left open; MUT-25 and MAL-939 → In Progress (pilot).
- **Worktrees:** `.claude/worktrees/money-v1-m8` and branch `feature/money-v1-m8` removed in both repositories (merged: Mutaba3a e7754f3, Malafat 1477e55f5).

---

## [Unreleased] - 2026-10-10 — MUT-10 / MUT-11: delete the two unreachable modules (`src/`)

Epic MUT-2 (strip to the core). Branch `feature/mut-2-strip-core`; tag
`pre-mut-10-11` marks the state before either removal. One commit per ticket so
each reverts independently.

### Removed
- **Engagements (MUT-10)** — 11,192 lines: three routes (`/engagements`,
  `/engagements/new`, `/engagements/$engagementId/edit`), `src/pages/engagements`,
  `src/features/engagements` (wizard, PDF generator, autosave hook, presets,
  repository), and the `engagements.*`, `nav.engagements` and orphaned
  `nav.newMenu.engagement` i18n keys from both locales. No navigation entry had
  pointed at any of it.
- **Money answers (MUT-11)** — 3,180 lines: the `/money-answers` route,
  `src/pages/money-answers`, `DayDetailDrawer` and its two drawer-store actions
  (the page was the only caller), the Insights "Cash Flow Timeline" link into
  the deleted route, the already-unreferenced landing `MoneyAnswersSection`, and
  the `moneyAnswers`, `nav.moneyAnswers`, `landing.moneyAnswers` and
  `insights.cashFlowTimeline` i18n keys.

### Changed
- `src/db/database.ts` takes the `Engagement` / `EngagementVersion` row types
  from the new `src/db/retained/engagementSchema.ts` instead of the deleted
  feature directory. The version snapshot is modelled as opaque JSON — nothing
  interprets it any more.
- Renamed the shared money-event surface off the deleted page's name:
  `useMoneyAnswersQueries` → `useMoneyEventQueries`, `moneyAnswersQueryKeys` →
  `moneyEventQueryKeys`, `useInvalidateMoneyAnswers` → `useInvalidateMoneyEvents`,
  `MoneyAnswersFilters` → `MoneyEventFilters`.

### Kept deliberately
- The Dexie `engagements` and `engagementVersions` tables, at the same schema
  version. Deleting UI must never delete user records (ADR-029). The generic
  backup in `src/db/backup.ts` walks `db.tables`, so retaining the tables keeps
  any rows a user holds exportable and restorable with no new export path.
- `src/db/moneyEventRepository.ts` and the `MoneyEvent` type family: shared with
  `PredictiveKpiStrip`, `MonthActualsRow` and `AttentionFeed` on the Overview
  page, so MUT-11's "remove only if exclusively used here" condition failed.
- The `moneyEventVersions` table — unrelated to the deleted page; it is the
  transaction sync op-log.

### Added
- `src/db/__tests__/retainedSchema.test.ts` — four tests that fail if a later
  change drops the retained tables or stops backing them up.

### Technical
- Dexie schema version unchanged; no table dropped, no migration added.
- Typecheck clean. Lint went from 18 errors / 75 warnings to 0 errors / 18
  warnings — the deleted modules owned every remaining lint error, which closes
  most of MUT-22.
- Unit suite: 2,029 passing before and after, plus the 4 new tests. The 18
  failures in `ExpensesLedgerPage.test.tsx` are pre-existing and untouched.
- Bundle: JS 3,396 KB → 3,152 KB (−244 KB, −7.2%) across 48 → 45 chunks;
  precache 11,902 KiB → 11,647 KiB.

---

## [Unreleased] - 2026-10-10 — Money v1 Milestone 8: approval creates the agreement; the overview carries proposals (`server/`, API `1.7.0-m8`)

Brief `money-v1-m8-overview-ia.md` (design-reviewed D1–D13, eng-reviewed
D14–D20; HTML wireframe beside it). Jira MUT-40, MUT-41 under MUT-25. Replaces
the M7 lifecycle: nothing from M1–M7 is deployed, so the M7 migration is edited
in place rather than mapped (D20).

### Changed
- **Fee proposal lifecycle** is `PROPOSED → APPROVED | WITHDRAWN`
  (`src/proposals/transitions.ts`). `CLIENT_APPROVED`, `AGREED`, `CONVERTED`,
  `POST …/agree`, `agreedOn` / `agreedNote` and the `feeProposalId` field of
  `POST /v1/agreements` are gone; `currentProposal` prefers the open one, else
  the latest APPROVED. Reasons `PROPOSAL_NOT_FOUND`, `PROPOSAL_NOT_AGREED`,
  `PROPOSAL_PROJECT_MISMATCH` retired.
- **`POST /v1/fee-proposals/{id}/approve`** now creates the fixed-fee agreement
  (D5): body `{ amount, approvedOn?, schedule: ONCE { dueOn } | INSTALLMENTS
  { count 2–60, firstDueOn }, note? }`; the agreement is dated `approvedOn`
  so the VAT rate in force on that date applies (D18, `422 VAT_RATE_MISSING`
  names the date); ONCE posts one IMMEDIATE installment due on `dueOn`;
  INSTALLMENTS splits the amount into equal minor-unit shares (remainder on
  the first), posts the first now and DATE-triggers the rest one month apart
  with the day clamped (D15 B). The store transaction writes the agreement and
  moves the proposal to APPROVED (`agreedAmountMinor`, `clientApprovedOn`,
  `clientApprovalNote`, `agreementId`) or refuses the whole create
  (`StateConflict` → `409 PROPOSAL_NOT_OPEN`). Returns `{ proposal, agreement }`.
  Audit `fee_proposal.approved` (with `agreementId`, `schedule`).
- **Organization summary** (D17): `CustomerSummaryRow.proposals[]`
  (`{ proposalId, projectId, amount, proposedOn }`), `CurrencySummary.proposed`
  and `counts.openProposals`; the currency and customer sets include customers
  that only have PROPOSED proposals, so a proposals-only firm gets a block.
- **Archive** (`POST /v1/projects/{id}/archive`) is refused with
  `409 PROPOSAL_OPEN { openProposalId }` while a proposal is open (D19).
- **Lazy posting heals IMMEDIATE installments** (D16):
  `AgreementRepository.listUnpostedDue` also returns unposted, non-voided
  IMMEDIATE installments on ACTIVE agreements (MANUAL excluded), so a crash
  between agreement create and the posting step is repaired on the next read
  or by `npm run reconcile`; `installment.posted` audits `trigger` from the
  installment.
- API version `1.7.0-m8`; `openapi/openapi.yaml` regenerated.

### Technical
- `src/agreements/create.ts` (new, D14): `composePreview`, `PreviewBody`,
  `createAgreementFromPreview`, `agreementDetail`, `paidMap` lifted out of
  `routes/agreements.ts` and shared with the approve route. `POST /v1/agreements`
  behaviour unchanged (`routes-m3.test.ts` untouched and green).
- Tests: `src/__tests__/routes-m8.test.ts` (approve ONCE / INSTALLMENTS incl.
  remainder, month clamp and lazy posting of #2; 409 / 422 / validation /
  scope / cross-org; `VAT_RATE_MISSING` by date; summary proposals and
  proposals-only currency; archive refusal; healed IMMEDIATE installment;
  contract), `routes-m7.test.ts` trimmed to the surviving routes,
  `transitions.test.ts` rewritten, `store-contract-m8.ts` (+ memory / Prisma
  runners) replaces `store-contract-m7.ts`. 304 unit tests; 342 with Postgres.
- `e2e/money-v1.e2e.mts` gains the M8 section (19 checks: proposal → approval →
  receivable → summary, installments, security edges); 103 checks pass against
  a local Postgres with Malafat's updated client.
- Prisma: `FeeProposalStatus` enum and `fee_proposals` columns edited in the
  M7 migration (`20261009120000_m7_fee_proposals`); local databases need
  `prisma migrate reset` or a fresh database (the test suite ran against
  `mutaba3a_test_m8`).

---

## [Unreleased] - 2026-10-10 — MUT-35: the repository seam becomes real (`src/db/`)

Epic MUT-34 (hosted Mutaba3a). Eng-reviewed 2026-10-10 (`/plan-eng-review`,
11 findings, 0 critical gaps). Scope reduced during review: the React context
layer was cut as an abstraction with no consumer (D1), so CLAUDE.md's AppShell
`RepoProvider(repo)` gap stays open. No behaviour change — the suite's
pass/fail counts are unchanged apart from the 9 new provider tests.

### Added
- **`src/db/provider.ts`** — the data-access seam. A frozen, module-scoped
  registry exposing `{ base, synced }`, with `getRepositories()`,
  `setRepositories()` (refused in production builds) and `resetRepositories()`.
  Module-scoped rather than a React context because Dexie migrations run inside
  `db.open()` before React mounts.
- `satisfies` conformance on 21 base repositories and 8 synced decorators.
  Renaming or deleting a repository method now fails `npm run typecheck`.
- `npm run typecheck` (`tsc --noEmit -p tsconfig.app.json`). The repo had no
  such script despite CLAUDE.md Phase 4 mandating it; typechecking only
  happened inside `npm run build`.
- `ISyncedRepositories` and `IPaymentRecordRepository` in `interfaces.ts`.
- `src/db/__tests__/provider.test.ts` — 9 tests covering default resolution,
  reference stability, injection, reset isolation and the production guard.

### Fixed
- **7 drifted repository interfaces corrected to describe reality.** Every case
  was an interface declaring something the implementation never had:
  `transactionRepo.delete` (it soft-deletes), `receiptRepo.getByExpense`,
  `vendorRepo.findByName` (it matches by alias), `monthCloseRepo.set`,
  `retainerRepo.delete`, `projectedIncomeRepo.{getBySource,getByPeriod,create,delete}`,
  and `IExpenseRepository` missing `getYearlyTotals` / `getAllProfilesTotals` /
  `getReceiptCount` while typing `list` as `Expense[]` instead of
  `ExpenseDisplay[]`. Three `create` parameter types were also wrong. No runtime
  behaviour was added to satisfy an aspirational signature.

### Fixed (QA reconciliation, 2026-10-10)
- **Settings could not be saved.** `useUpdateSettings` passed
  `settingsRepo.update` as a bare method reference; `update` calls `this.get()`,
  and TanStack invokes `mutationFn` with its own `this`, so it threw
  `this.get is not a function`. With no `onError` on the mutation it failed
  silently — changing the default currency from Settings never persisted.
  Pre-existing (`acb1144:useQueries.ts:442` had the same shape), surfaced
  because the refactor touched the line. Now a closure, which binds `this` and
  keeps resolution lazy. **This is the one deliberate behaviour change in
  MUT-35**, accepted rather than preserving a silent data-loss bug.

### Changed
- `useRetainerQueries` also routes through the provider (nine consumers total).
  Without it the `retainerAgreements` and `projectedIncome` slots had zero
  callers, so a future `setRepositories` swap would have left retainer screens
  reading Dexie while everything else moved — a half-local view with no error.
- Removed a provider test that asserted a tautology (it could not fail for the
  reason its comment claimed), rather than leave it posing as coverage.
- Eight consumers now resolve through the provider: the four query hooks,
  `paymentRequestService`, `recurringExpenseService`, `lib/zipExport.ts` and
  `useIssueAndDownload.tsx`. Each call site keeps the family it used before
  (`base` → `base`, `synced` → `synced`), so which mutations capture a sync op
  is unchanged.
- Mock wiring updated in `useIncomeQueries.test.tsx` and
  `useRecurringExpenseQueries.test.tsx` — assertions untouched. `vi.mock`
  intercepts imports, so the barrel had to become the interception point.

### Technical
- `TECH_DEBT.md` TD-013 corrected: it claimed the Dexie implementation
  satisfied the interfaces, which nothing checked. Applying the check found the
  7 drifts above.
- `TODOS.md`: recorded that most transaction mutations bypass the sync op-log
  and never sync between devices, and that expenses never sync at all. Both
  pre-existing, both preserved here.
- Known gap `gstack-shortcut(dec-5f2c2123)`: `synced.*` is bound to the Dexie
  singletons at module load and does not follow `setRepositories`. Upgrade when
  MUT-43 injects a hosted source.

---

## [Unreleased] - 2026-10-09 — Money v1 Milestone 7: fee proposals (negotiations) (`server/`, API `1.6.0-m7`)

Brief `money-v1-m7-fee-proposals.md` (+ `-tests.md`), approved by the owner on
2026-10-09 (single round · agreed amount prefills the wizard · fixed fee only ·
overview lists every connected client). Additive; closes the gap before a fee
agreement exists.

### Added
- **Fee proposals** (`src/proposals/transitions.ts`, `src/routes/fee-proposals.ts`):
  `POST /v1/fee-proposals` (project currency, `proposedOn` defaults to today,
  409 `PROPOSAL_OPEN` while one is open on the project), `GET /v1/fee-proposals`
  (`projectId`, `customerId`, `status`, `open=true|false`, keyset pages),
  `GET /v1/fee-proposals/{id}`, `POST …/approve` (PROPOSED → CLIENT_APPROVED,
  agreed amount = proposed), `POST …/agree` (PROPOSED | CLIENT_APPROVED →
  AGREED with an explicit amount), `POST …/withdraw` (any open state →
  WITHDRAWN, idempotent). Scopes reused: `agreements:read` / `agreements:write`.
  Audit `fee_proposal.{created,client_approved,agreed,withdrawn,converted}`.
- **Conversion**: `POST /v1/agreements` accepts `feeProposalId` (outside the
  preview token); the store marks the proposal CONVERTED with `agreementId` in
  the agreement's transaction (`StateConflict` → 409 `PROPOSAL_NOT_OPEN` on a
  race); 422 `PROPOSAL_NOT_FOUND` / `PROPOSAL_PROJECT_MISMATCH` /
  `PROPOSAL_NOT_AGREED` before it.
- **Project summary** gains `proposal` (`FeeProposalSummary | null`: the open
  one, else the latest converted one), on `GET /v1/summaries/projects/{id}` and
  the customer summary's project rows.
- Table `fee_proposals` (migration `20261009120000_m7_fee_proposals`); one open
  proposal per project is serialised by the project row lock in
  `PrismaLedgerStore.feeProposals.create`, mirrored by the memory store.
- `PATCH /v1/projects/{id}` refuses a currency change (409 `CURRENCY_LOCKED`)
  while a proposal is open.

### Changed
- API version `1.6.0-m7`; `openapi/openapi.yaml` regenerated (new tag "Fee
  proposals", reasons `PROPOSAL_OPEN`, `PROPOSAL_NOT_OPEN`, `PROJECT_NOT_FOUND`
  (already raised by the preview, now published), `PROPOSAL_NOT_FOUND`,
  `PROPOSAL_NOT_AGREED`, `PROPOSAL_PROJECT_MISMATCH`).

### Technical
- Tests: `src/proposals/__tests__/transitions.test.ts` (state table, agreed
  amount, current proposal), `store-contract-m7.ts` (memory always, Postgres
  with `MUTABA3A_TEST_DATABASE_URL`), `src/__tests__/routes-m7.test.ts` (7
  cases: create / open conflict / approve + agree / withdraw / conversion /
  lists + summaries / contract). Earlier milestones' version pins bumped.
  Lint, typecheck, 299 unit tests, build, `openapi:check` green. The Postgres
  contract suite could not run in the authoring session (no database); CI's
  `server-ci.yml` runs it.
- Operator action on release: `deploy.sh` applies the migration (handover §2).

## [Unreleased] - 2026-10-08 — First production deploy: Cloud Run rejected the `PORT` env; smoke CLI hardened (`server/`)

The first `scripts/deploy.sh` run against `malafat-production` created Cloud
SQL, the secrets, the service account and migrated the database, then failed
at `google_cloud_run_v2_service.api` with `Error 400 … reserved env names were
provided: PORT`. Downstream, `terraform output -raw service_url` had nothing
to print and `npm run smoke -- --url ""` crashed with
`Failed to parse URL from /health`.

### Fixed
- `server/infrastructure/terraform/main.tf`: removed the `PORT=8787` env
  entry. Cloud Run injects `PORT` from `container_port` and refuses templates
  that set it; `config.PORT` reads the injected value (default 8787 locally).
  Comment on the `ports` block records why.
- `server/src/smoke.ts` + `server/src/scripts/smoke.ts`: new exported
  `parseBaseUrl` validates `--url` before any request (empty → names the
  `terraform output` cause and the recovery; relative or non-http → "must be
  an absolute http(s) URL"); the CLI exits 2 with that one line instead of an
  undici stack trace. `runSmoke` uses the same validation.
- `server/scripts/deploy.sh`: fails with a red `[deploy]` line naming the
  recovery (re-run) when the full apply leaves no `service_url`, instead of
  calling the smoke script with an empty URL.

### Changed
- `server/DEPLOYMENT.md`: new §2.1 "If a step fails" (what each step leaves
  behind, re-run is the recovery, the `-target` warnings are expected, the
  PORT error verbatim); §3 echoes the URL and stops on a missing output; §1.1
  records that production is in `malafat-production`.
- `.claude/INFRA.md`: project choice recorded; Deployed table notes the
  2026-10-08 partial apply (database and secrets exist, service pending the
  re-run).

### Technical
- Tests: `src/__tests__/smoke.test.ts` +3 (`parseBaseUrl` accept/strip,
  empty, relative/non-http). Lint, typecheck, 180 unit tests, build green;
  `terraform fmt -check` green. `terraform validate` could not run in the
  session (provider registry unreachable); CI's `terraform` job covers it.
- Operator action: pull and re-run `./scripts/deploy.sh`; then §3–§5.
## [Unreleased] - 2026-10-09 — Database access through the Cloud SQL proxy (`server/scripts/db.sh`)

### Added
- `scripts/db.sh <migrate|status|psql|proxy>` with npm shortcuts `db:migrate`, `db:migrate:status`, `db:psql`, `db:proxy`: reads the instance connection name and local URL from `terraform output` (so only `TF_STATE_BUCKET` is needed), opens `cloud-sql-proxy` on 127.0.0.1:5440 for the one command and stops it on exit. `migrate` is `prisma migrate deploy` (forward-only); `status` is read-only and does not fail on pending migrations; `proxy` waits for Ctrl-C and prints the local URL for other tools. With `DATABASE_URL` set no proxy is started, so the same commands serve local development. Same mechanics as `deploy.sh`'s own migration step, which is unchanged: a normal release still needs none of this.

### Changed
- `DEPLOYMENT.md` §6 day-2 rows and `README.md` point at the shortcuts; the handover's deployment section now says that `deploy.sh` migrates by itself and when the by-hand path applies.

## [Unreleased] - 2026-10-08 — Money v1 end-to-end run; two fixes it found (`server/`, API `1.5.1-m6`)

### Fixed
- **Supplement with a new IMMEDIATE installment never posted.** `POST /v1/agreements/{id}/supplements` with `distribution: NEW_INSTALLMENT` and `trigger.type: IMMEDIATE` created the installment but left it PENDING with no receivable: creation posts IMMEDIATE installments inline and lazy posting only handles DATE triggers. The route now posts it as creation does, audits `installment.posted` (with the supplement id) and answers with the posted state. `routes-m3.test.ts` covers it.
- **`POST /v1/retainers/{id}/cancel` answered with the fixed-fee detail shape** (`agreement` + empty `installments`/`supplements`). It now returns the retainer charges view (`agreement`, `versions`, `charges`), the same shape as `GET …/charges` and `POST …/changes` and the shape Malafat's published contract already declared. The cancelled final month (prorated or credited) is visible in the response.

### Added
- `server/e2e/money-v1.e2e.mts` — the end-to-end run over HTTP: Malafat's own Mutaba3a client (`features/money/application/mutaba3a-client.ts`, loaded from a Malafat checkout) driving a running server through provisioning, M1 bind, M2 customers / projects / import / PATCH, M3 VAT / fixed fee / installments / supplement / retainer, M5 change preview and apply, cancel preview and PRORATE cancel with credit, M4 allocation preview, payment, replay, operations lookup, allocate later, reversal, credit, corrected payment, M6 summaries (invariants `outstanding = overdue + dueToday + notYetDue`, equality with open receivables and with the customers' rows, unallocated vs POSTED payments), audit, attachments-not-configured, reconcile, disconnect — plus the security edges: forged key, narrow scopes, cross-organization 404s, same-tenant second binding, idempotency reuse, stale `If-Match`, forged preview tokens, token required for a crediting cancel. **84 checks, all passing** against Postgres 16.
- `server/e2e/attachments.e2e.mts` — attachments in process on the real Postgres store with `MemoryAttachmentStorage`: create → PUT → complete (incomplete / size and type mismatch / idempotent complete) → list (pending hidden) → download (TTL, filename) → delete (object removed, 404 after), scope and cross-organization refusals, every rule reason, audit trail. **34 checks, all passing.**
- `npm run smoke` (with the admin token) and `npm run reconcile` / `-- --dry` were run against the same database.

### Technical
- API version `1.5.1-m6`; `openapi/openapi.yaml` regenerated; Malafat's vendored contract refreshed to it.
- The e2e scripts are `.mts` outside `src/`, so lint and typecheck do not cover them; `tsx` runs them.

## [Unreleased] - 2026-10-08 — Money v1 Milestone 6: summaries, audit listing, attachments (`server/`)

Brief `money-v1-m6-summaries-audit-attachments.md`, decided by the engineering
owner under the "complete the epic" instruction. API version `1.5.0-m6`;
additive. Closes the Money v1 server epic (M1–M6).

### Added
- **Summaries** (`src/summaries/compute.ts`, `src/routes/summaries.ts`):
  `GET /v1/summaries/organization[?currency=]`, `/customers/{id}`,
  `/projects/{id}`. Computed on read from OPEN receivables and POSTED payments:
  exact day buckets (`outstanding = overdue + dueToday + notYetDue`),
  unallocated funds, last payment date, and statuses — customer `SETTLED /
  OVERDUE / OUTSTANDING / UP_TO_DATE`, fixed project `PENDING / OUTSTANDING /
  PARTIALLY_PAID / OVERDUE / PAID_IN_FULL` (never `PAID_IN_FULL` while an
  installment is pending), retainer `UP_TO_DATE / OUTSTANDING / OVERDUE /
  CANCELLED / SETTLED`, `NONE` without agreements. Retainer `monthly` is the
  gross of the terms in force (M5 versions). Scope `summaries:read`.
- **Audit listing** `GET /v1/audit?entityType=&entityId=&action=&cursor=&limit=`
  (scope `audit:read`), keyset-paginated like every list;
  `AuditRepository.list`; index `(organizationId, entityType, entityId,
  createdAt)`.
- **Attachments** (`src/attachments/{rules,storage}.ts`,
  `src/routes/attachments.ts`): `POST /v1/attachments/uploads` (PDF / JPEG /
  PNG ≤ 10 MB, exactly one of customerId / projectId / paymentId, 201 with a
  V4 signed PUT URL), `POST /v1/attachments/{id}/complete` (verifies the
  object's size and type: `UPLOAD_INCOMPLETE` / `UPLOAD_MISMATCH`),
  `GET /v1/attachments?…`, `GET /v1/attachments/{id}/download` (signed URL
  with a safe `Content-Disposition`), `DELETE /v1/attachments/{id}` (soft
  delete + object removal). Object key `org/{organizationId}/{attachmentId}`,
  never the filename. `AttachmentStorage` port with `GcsAttachmentStorage`
  (`@google-cloud/storage`, signBlob through the service account) and
  `MemoryAttachmentStorage` (tests). Config `ATTACHMENTS_BUCKET` (optional →
  503 `ATTACHMENTS_NOT_CONFIGURED`), `ATTACHMENTS_URL_TTL_SECONDS` (900).
  Audit `attachment.uploaded`, `attachment.deleted`.
- **Terraform:** private bucket (uniform access, public access prevention),
  `roles/storage.objectAdmin` on it and `roles/iam.serviceAccountTokenCreator`
  on the service account for itself, `storage` + `iamcredentials` APIs, the two
  env vars on Cloud Run, output `attachments_bucket`.
- **Schema + migration `20261008230000_m6_attachments_audit_index`.**
- **Published reasons:** 422 `UPLOAD_INCOMPLETE`, `UPLOAD_MISMATCH`,
  `ATTACHMENT_TARGET_REQUIRED`, `ATTACHMENT_TARGET_AMBIGUOUS`,
  `MIME_TYPE_UNSUPPORTED`, `FILE_TOO_LARGE`, `FILENAME_INVALID`,
  `ATTACHMENT_NOT_READY`; error code `ATTACHMENTS_NOT_CONFIGURED` (503).
- **Tests:** 315 (M6: compute 7, rules 3, store contract 2 × memory +
  Postgres, routes-m6 5).

### Not done (brief §5.4, §7)
- No malware scan before `READY`; `complete` checks size and type only. A
  scanner on bucket events is the follow-up; the UI downloads, never renders
  inline.

---

## [Unreleased] - 2026-10-08 — Money v1 Milestone 5: retainer changes, proration, cancel preview, reconcile script (`server/`)

Brief `money-v1-m5-retainer-changes.md`, decided by the engineering owner under
the "complete the epic" instruction. API version `1.4.0-m5`; additive
(`RetainerChargesResponse.versions`, `RetainerCharge.version`,
`Agreement.retainer.cancelEffectiveDate`, `FinalMonth` gains `PRORATE`).

### Added
- **Versions, not edits:** `retainer_versions` appends a version per change;
  version 1 is synthesized from the agreement row (no backfill).
  `generateCharges` prices each service month from the version in force for it
  (`src/retainers/terms.ts`), honours a per-version billing day and end month,
  and stamps `retainer_charges.version`. Charges already generated keep their
  terms.
- **Routes:** `POST /v1/retainers/{id}/changes/preview` (previous vs next terms
  at the VAT rate in force on the effective month, `changed`,
  `firstChargedMonth`, `chargesKept`, token), `POST /v1/retainers/{id}/changes`
  (201, idempotent; token covers body + agreement version + latest version +
  rate), `POST /v1/retainers/{id}/cancel/preview` (final month under FULL /
  PRORATE / WAIVE, posted charge, credit with `limitedByPayments`,
  `stoppedFrom`, `outstandingAfter`); `POST /v1/retainers/{id}/cancel` accepts
  `PRORATE` and an optional `previewToken`, required whenever a credit is
  created (422 `PREVIEW_TOKEN_REQUIRED`). Audit `retainer.changed`;
  `receivable.credited` with `source: RETAINER_CANCEL`.
- **Proration** (`src/retainers/proration.ts`): `amount × days ÷ daysInMonth`,
  half-up, days = the cancellation day inclusive; VAT computed on the prorated
  amount at the version's rate. A posted final month is adjusted by a credit
  (WAIVE: the outstanding; PRORATE: the difference), never above the
  outstanding — what was paid is not refunded; earlier credits are not credited
  twice.
- **Reconcile script:** `npm run reconcile [-- --dry]` walks every organization
  (`organizations.list()`), posts due installments and charges in its timezone,
  prints a per-organization summary; for cron / Cloud Scheduler (README).
- **Published reasons:** 422 `CHANGE_EFFECTIVE_INVALID`,
  `CHANGE_NOTHING_CHANGED`, `FINAL_MONTH_INVALID`, `PREVIEW_TOKEN_REQUIRED`;
  409 `AGREEMENT_CANCELLED` on changing or previewing a cancelled retainer.
- **Schema + migration `20261008220000_m5_retainer_versions_proration`.**
- **Tests:** 295 (M5: terms 7, proration 6, schedule +1, store contract 3 ×
  memory + Postgres, routes-m5 8 incl. the reconcile script).

---

## [Unreleased] - 2026-10-08 — Money v1 Milestone 4: payments, allocations, reversals, credits, operations lookup (`server/`)

All eight decisions of `money-v1-m4-payments-allocations.md` approved as
proposed. API version `1.3.0-m4`; additive (receivables gain `credited`).

### Added
- **Pure money math:** `src/payments/allocate.ts` (outstanding = gross − paid −
  credited; explicit-set validation that never adjusts; `OLDEST_FIRST` and
  `SETTLE_MATTERS` suggestions; resulting balances per receivable, project and
  customer), `src/payments/credit.ts` (credit VAT split at the receivable's
  frozen rate, `net + vat = credit`; capacity check), `src/payments/numbering.ts`
  (`PAY-YYYY-NNNN`), `src/payments/preview-token.ts` (token over the allocation
  set **and** the `(id, version)` of every eligible receivable — decision 2).
- **Schema + migration `20261008205727_m4_payments_allocations_credits`:**
  `payments` (number unique per organization, `allocatedMinor`, status
  POSTED/REVERSED, reversal fields, `replacesPaymentId`), `payment_allocations`,
  `receivable_credits` (append-only), `payment_counters` (per organization and
  year, row-locked in the posting transaction); `receivables.creditedMinor`.
- **Store:** `PaymentRepository` (create / allocate / reverse / list / replacedBy)
  and `ReceivableRepository.{getByIds, listEligible, credit, listCredits}`,
  `IdempotencyRepository.get`. Postgres locks each receivable (`FOR UPDATE`),
  checks capacity under the lock and recomputes `status` from the sums; a race
  the token did not catch surfaces as `InsufficientCapacity` → 409
  `PREVIEW_STALE`. The memory store's `seedPaid` test hook is gone.
- **Routes:** `POST /v1/allocations/preview` (new payment or `{ paymentId }`),
  `POST /v1/payments`, `GET /v1/payments`, `GET /v1/payments/{id}`,
  `POST /v1/payments/{id}/allocations`, `POST /v1/payments/{id}/reverse`,
  `POST /v1/receivables/{id}/credits`, `GET /v1/receivables/{id}/credits`,
  `GET /v1/operations/{idempotencyKey}`. Audit actions `payment.recorded`,
  `payment.allocated`, `payment.reversed`, `receivable.settled`,
  `receivable.credited`.
- **Published reasons:** 422 `ALLOCATION_EXCEEDS_PAYMENT`,
  `ALLOCATION_EXCEEDS_OUTSTANDING`, `ALLOCATION_DUPLICATE`,
  `RECEIVABLE_NOT_FOUND`, `RECEIVABLE_NOT_OPEN`, `RECEIVABLE_CUSTOMER_MISMATCH`,
  `PAYMENT_NOT_POSTED`, `NO_UNALLOCATED_FUNDS`, `CREDIT_EXCEEDS_OUTSTANDING`,
  `REPLACES_NOT_REVERSED`, `REPLACES_CUSTOMER_MISMATCH`, `CUSTOMER_NOT_FOUND`;
  409 `ALREADY_REVERSED`; preview warning `NO_ELIGIBLE_RECEIVABLES`.

### Changed
- `itemStatus` takes `creditedMinor`: credits count towards `PAID` but never
  read as `PARTIALLY_PAID` (a credited, unpaid item stays `DUE` / `OVERDUE`).
  Installment and charge statuses, `countOutstandingByProject` (archive guard)
  and receivable `outstanding` all subtract credits.
- `GET /v1/operations/{key}` is `PENDING | COMPLETED | 404`, not `FAILED`
  (decision 7): a key released by a 5xx is reusable.

### Technical
- Tests: 268 (28 files), +88: `payments/__tests__/{allocate,credit,numbering}`,
  `store-contract-m4.ts` (memory + Postgres, incl. 12 concurrent numbered
  creates and a sums-equal-rows sequence), `routes-m4.test.ts`; the M3
  receivable-status test now records a real payment. Postgres 16 ran locally
  for the contract suite. `openapi:check` green; ESLint and `tsc` clean.

---

## [Docs] - 2026-10-08 — Money v1 Milestone 4 design brief and test plan (proposed)

### Added
- `.claude/designs/money-v1-m4-payments-allocations.md` and `…-tests.md`:
  payments with allocations previewed before posting (OLDEST_FIRST /
  SETTLE_MATTERS suggestions, balance-covering preview token), unallocated
  funds allocated later, whole-payment reversal with `replacesPaymentId`,
  append-only credits against posted receivables (the adjustment M3
  reserved), `PAY-YYYY-NNNN` numbering, `GET /v1/operations/{key}`. Eight
  decisions await the product owner before Phase 2. No `server/` change.

---

## [Docs] - 2026-10-08 — Money v1 Milestone 3, Malafat side: design brief and test plan

### Added
- `.claude/designs/money-v1-m3-malafat-ui.md` and `…-tests.md`: the Malafat
  obligations of the M3 brief (§2.6) — VAT settings card, fee-agreement wizard
  with the preview step, matter and client financial detail — designed and
  implemented the same day in the Malafat repo (`crm-platform/.claude/
  CHANGELOG.md` "Money v1 Milestone 3"). Kept here with the other Money v1
  cross-repo artifacts because Malafat's repo rule forbids new Markdown and
  Confluence was not reachable from the session. No `server/` change.

---

## [Unreleased] - 2026-10-08 — Money v1 Milestone 3: agreements, installments, VAT, retainers, receivables (`server/`)

Approved with amendments (brief rev. 2: VAT treatment per payable item with
project/customer defaults; due dates default to end of month with the
payment-terms vocabulary; retainers in basic form). API version `1.2.0-m3`;
additive, M1/M2 routes unchanged except the project currency lock and the
archive guard promised in M2.

### Added
- **Pure money math:** `src/vat.ts` (basis points, half-up `bigint` rounding,
  exclusive/inclusive bases, four treatments), `src/agreements/schedule.ts`
  (installments split the contractual amount in its basis, per-item VAT, last
  absorbs the remainder, 1–60 items), `src/agreements/status.ts`
  (`PENDING / DUE / OVERDUE / PARTIALLY_PAID / PAID / VOID`), `src/dates.ts`
  (organization-timezone "today", ISO date arithmetic, `dueDateFor` with
  `IMMEDIATE | EOM | EOM_15 | EOM_30 | EOM_45 | EOM_60`),
  `src/retainers/schedule.ts` (chargeable service months, 120-month bound),
  `src/preview-token.ts` (generic, canonical JSON, bigint-safe).
- **Schema + migration `20261008192015_m3_agreements_installments_vat`:**
  `vat_rates` (append-only, effective-dated), `agreements` (FIXED/RECURRING,
  frozen rate, totals, terms, retainer fields), `installments`,
  `retainer_charges` (unique per agreement + month), `receivables`
  (created only when posted; `paid_minor` reserved for M4),
  `agreement_supplements`; `vatTreatment` on customers and projects.
  Amounts are `BIGINT`; calendar dates are ISO strings.
- **Routes:** `GET /v1/vat-rates`, `PUT /v1/settings/vat`;
  `POST /v1/agreements/preview`, `POST /v1/agreements`, `GET /v1/agreements`,
  `GET /v1/agreements/{id}`, `POST …/{id}/supplements`, `POST …/{id}/cancel`;
  `POST /v1/installments/{id}/trigger`; `POST /v1/retainers/preview`,
  `POST /v1/retainers`, `GET /v1/retainers/{id}/charges`,
  `POST /v1/retainers/{id}/cancel`, `POST /v1/retainers/reconcile`;
  `GET /v1/receivables`, `GET /v1/receivables/{id}`.
- **Lazy posting** (`src/agreements/posting.ts`): dated installments and
  retainer charges post when their date has arrived, on every read that
  renders agreements or receivables and on reconcile; idempotent in the store
  (receivable + marker in one transaction, unique charge per month).
- **Preview tokens freeze the rate:** a VAT-rate change between preview and
  create is `409 PREVIEW_STALE`.
- **Supplements** (`src/agreements/supplement.ts`): last-unposted / prorate /
  new installment; negative only within unposted capacity, otherwise
  `422 SUPPLEMENT_EXCEEDS_UNPOSTED` with `requiresAdjustment` naming the
  posted receivables.
- Published `details.reason` vocabularies for 409 and 422 in the API
  description (`CONFLICT_REASONS`, `VALIDATION_REASONS`).
- **Tests (79 new, 196 total, 22 files):** unit (dates, VAT table, schedule,
  status, retainer schedule, token), M3 storage contract on memory and
  Postgres, `routes-m3.test.ts` (VAT rates, preview/create/stale token/rate
  change, treatment chain, validation reasons, idempotent create + audit,
  lazy posting across a timezone midnight, manual triggers, receivable
  statuses in two timezones with seeded payments, filters, supplements in
  all three distributions, cancel rules, currency lock + archive guard,
  retainers preview/create/reconcile/cancel FULL vs WAIVE, contract).

### Changed
- `projects.hasPostedActivity` is now "has an agreement"; `POST /v1/projects/{id}/archive`
  refuses with `409 PROJECT_HAS_OUTSTANDING`. `MemoryLedgerStore.markProjectPosted`
  removed (`seedPaid` added for M4-shaped tests).
- `openapi/openapi.yaml` regenerated (3990 lines).

### Technical
- Verification: typecheck, lint, `npm run test:db` (196), `openapi:check`.
- Deferred to M4/M5 (brief rev. 2): payments and allocations, credits/
  adjustments against posted receivables, retainer amendments and proration,
  invoice numbering, summaries.

---

## [Unreleased] - 2026-10-08 — M3 design brief + test plan (agreements, installments, VAT)

### Added
- `.claude/designs/money-v1-m3-agreements-installments-vat.md` — fixed-fee
  agreements, installments, effective-dated VAT, lazy posting of dated
  installments, supplements within unposted capacity, cancel while nothing is
  posted, receivables with server-computed statuses. Seven decisions for
  product-owner approval; no code until approved.
- `.claude/designs/money-v1-m3-agreements-installments-vat-tests.md`.

---

## [Unreleased] - 2026-10-08 — `npm run openapi:json` for Malafat's vendored contract

### Added
- `server/src/scripts/export-openapi.ts --json` (`npm run openapi:json`):
  prints the contract as JSON inside a `_vendored` envelope (source, git
  commit, sha256 of the YAML). Malafat keeps that output at
  `apps/web/src/features/money/contract/mutaba3a-openapi.json`, and its
  contract test fails when the Malafat client calls anything not in it. Refresh
  the copy whenever `openapi.yaml` changes.

---

## [Unreleased] - 2026-10-08 — Money v1 Milestone 2: customers, projects, external references, import (`server/`)

Approved by the product owner the same day (all six decisions in the brief).
API version `1.1.0-m2`; everything additive, M1 untouched.

### Added
- **Schema + migration `20261008152452_m2_customers_projects`:** `customers`,
  `projects` (one currency each, `version` for optimistic concurrency,
  ACTIVE/ARCHIVED, never deleted) and `external_references` (unique per
  organization + provider + entity type + external id; one per entity per
  provider). Keyset indexes on `(organizationId, createdAt, id)`.
- **Routes:** `POST/GET /v1/customers`, `GET/PATCH /v1/customers/{id}`,
  `POST /v1/customers/{id}/archive`; the same for `/v1/projects`;
  `POST /v1/import/preview` and `POST /v1/import/commit`. Scopes
  `customers:*` / `projects:*` (import needs both write scopes). Creation
  with an `externalReference` is idempotent (200 existing, never a
  duplicate) and requires a CONNECTED integration; `PATCH` needs
  `If-Match: <version>`; a project's currency is locked once anything is
  posted (`hasPostedActivity`, always false until M3); archiving a customer
  with active projects is refused.
- **`src/pagination.ts`:** opaque `(createdAt, id)` cursors, `limit` 1–200
  default 50, shared by every list.
- **`src/import/plan.ts`:** the pure planner preview and commit share
  (`create | link | conflict` per row, reasons `UNKNOWN_CUSTOMER`,
  `CUSTOMER_MISMATCH`, `CURRENCY_DIFFERS`, `VALIDATION:<detail>`, warnings
  `NAME_DIFFERS`, `ARCHIVED`; 500-row cap). `src/import/preview-token.ts`:
  sha256 proof that commit carries the previewed rows, verified in constant
  time, never stored.
- **`src/if-match.ts`** middleware; `src/routes/shared.ts` (error response
  sets, connected-integration guard, page helpers, reference batch lookup).
- **Published `details.reason` vocabulary** for 409 CONFLICT
  (`VERSION_MISMATCH CURRENCY_LOCKED CUSTOMER_MISMATCH HAS_ACTIVE_PROJECTS
  PREVIEW_STALE INTEGRATION_NOT_CONNECTED`) in the OpenAPI description.
- **Tests (52 new, 117 total, 13 files):** `pagination.test.ts`,
  `import/__tests__/plan.test.ts`, `preview-token.test.ts`, the M2 storage
  contract (`store-contract-m2.ts`, run by memory and Postgres), and
  `routes-m2.test.ts` (scope matrix, idempotency, external-reference
  idempotency, pagination, If-Match, archive rules, currency lock, import
  preview/commit/re-run/partial failure/isolation, contract check).

### Changed
- `LedgerStore` gains `customers`, `projects`, `externalReferences`; both
  implementations updated. `MemoryLedgerStore.markProjectPosted()` is a test
  hook for the M3 currency lock.
- `openapi/openapi.yaml` regenerated (2036 lines); `openapi:check` green.
- `money-v1-api-contract.md` §3 M2 marked implemented (with the entity-type
  refinement of external-id uniqueness); the M2 brief status → implemented.

### Technical
- Verification: typecheck, lint, `npm run test:db` (117, Postgres 16),
  `openapi:check`. Migration generated with `prisma migrate dev` and applied
  with `migrate deploy`; production picks it up through `deploy.sh`'s proxy
  step, no runbook change.
- Debt: TD-020 (import `loadState` reads linked entities one by one; bounded
  by the 500-row cap, batch it when M3 adds more lookups).

---

## [Unreleased] - 2026-10-08 — M2 design brief + test plan; TD-018 accepted

### Added
- `.claude/designs/money-v1-m2-customers-projects.md` — Milestone 2 design
  brief (customers, projects, external references, import preview/commit,
  pagination, optimistic concurrency). Six decisions listed for product-owner
  approval; no code until approved (CLAUDE.md lifecycle).
- `.claude/designs/money-v1-m2-customers-projects-tests.md` — the test plan
  that lands first once approved.

### Changed
- `TECH_DEBT.md` TD-018 → **Accepted**: keys stay operator-issued, no
  self-serve (product-owner decision; Malafat records the same in its
  ADR-150 addendum together with MAL-870: Money included for every tenant as a
  $0 Stripe add-on).

---

## [Unreleased] - 2026-10-08 — Deploy path revised: production only, everything local except hosting (ADR-026 rev. 2)

### Changed
- Product-owner direction after the first deploy artifacts landed on `main`:
  no staging for now, and nothing runs in GCP that can run on the operator's
  machine — build with the local Docker daemon and push, like Malafat's
  `pnpm release`.
- `server/scripts/deploy.sh` — no environment argument (production; a later
  `ENVIRONMENT=staging` still works), `docker build --platform linux/amd64`
  + `docker push` from the operator's daemon, `prisma migrate deploy` run from
  `server/` through the **Cloud SQL Auth Proxy** on `127.0.0.1:5440`, then
  `terraform apply -var image_tag`, then smoke. Checks for every tool up front.
- `server/infrastructure/terraform` — the Cloud Run migration job and the
  Cloud Build API are gone; `environment` defaults to `production`,
  `db_availability` to `REGIONAL`; new outputs `proxy_port` and the sensitive
  `local_database_url` for operator-side migrations and psql.
- `server/Dockerfile` — back to a single runtime image (the `migrate` target
  existed only for the job); `openssl` kept for Prisma on musl.
- `.github/workflows/server-ci.yml` — builds the one image; still never pushes.
- `server/DEPLOYMENT.md`, `server/README.md`, `.claude/INFRA.md`, ADR-026,
  TEST_PLAN, CI_CD, TECH_DEBT (TD-019 wording), M1 proposal — rewritten for
  the production-only, local-build flow.

### Removed
- `server/cloudbuild.yaml`, `server/infrastructure/terraform/staging.tfvars.example`.

### Technical
- Verification: `npm run typecheck`, `npm run lint`, `npm run test:db`
  (65 tests), `npm run openapi:check`, `terraform fmt -check` + `validate`.

---

## [Unreleased] - 2026-10-08 — Money v1 M1: the hosted API becomes deployable (TD-019, ADR-026)

### Added
- `server/infrastructure/terraform/` — Terraform for one environment of the
  hosted API: Cloud SQL Postgres 16 (db `mutaba3a`, user `mutaba3a_api`),
  Secret Manager secrets with Terraform-generated values (database URL, admin
  token), a least-privilege service account, Artifact Registry, a Cloud Run
  **job** for `prisma migrate deploy`, the Cloud Run **service** with probes,
  Cloud SQL volume and secret-backed env, public invoker, and an uptime check
  with an optional alert. `environment` selects `-staging`/`test` keys vs
  production/`live` keys. `max_instances` is validated to 1 (TD-017).
- `server/scripts/deploy.sh` — the operator rollout: Cloud Build (or local
  Docker) builds both images tagged with the git SHA, a targeted apply points
  the migration job at the new image, the job runs and is waited on, the full
  apply rolls the service with `SERVICE_VERSION=<sha>`, then the smoke test
  runs. The service stays on the old revision if migrations fail.
- `server/cloudbuild.yaml` — builds `mutaba3a-api` and `mutaba3a-api-migrate`
  from the two Dockerfile targets.
- `server/src/smoke.ts` + `src/scripts/smoke.ts` (`npm run smoke`) —
  post-deploy checks over an injected `fetch`: health (+ expected version),
  readiness, contract, three auth rejections, and with `MUTABA3A_ADMIN_TOKEN`
  the M1 exit criterion end to end (provision → issue key → validate → revoke
  → revoked key rejected). Never prints a secret. 5 tests in
  `src/__tests__/smoke.test.ts` run it against the in-memory app.
- `.github/workflows/server-ci.yml` — on every change under `server/`:
  type-check, lint, `openapi:check`, unit + route tests, the Postgres contract
  suite against a `postgres:16` service container, both Docker builds with a
  `/health` probe of the runtime image and a Prisma CLI check of the migrate
  image, `terraform fmt -check` + `validate`. Resolves TD-019.
- `server/DEPLOYMENT.md` — the operator runbook: prerequisites, staging,
  proof, provisioning the first firm, wiring Malafat (`malafat-web-mutaba3a-api-url`),
  production, day-2 operations, the ticket-closure table and what comes next.
- `.claude/INFRA.md` — created (CLAUDE.md listed it; it did not exist).

### Fixed
- `server/Dockerfile` — the migration story was broken: `npm prune --omit=dev`
  removed the Prisma CLI from the runtime image, so the documented
  `npx prisma migrate deploy` job would have tried to download it at run time.
  The Dockerfile now has a `migrate` target (full dependency tree, no app code,
  `CMD node_modules/.bin/prisma migrate deploy`) beside `runtime`, and both
  stages install `openssl` for Prisma's musl engines. `.dockerignore` added.

### Changed
- `server/README.md` — Deploy section points at Terraform, `deploy.sh` and
  `DEPLOYMENT.md`; Verify lists `npm run smoke` and CI.
- `.claude/designs/money-v1-m1-proposal.md` — deployment steps replaced by the
  shipped artifacts; acceptance table updated (implementation merged to main).

### Technical
- Malafat side (same day, its own changelog): `MUTABA3A_API_URL` is mounted
  from the secret `malafat-web-mutaba3a-api-url` in `release.ts`, listed as
  required by the secrets gate, with a release step to create it first.
- Verification: `npm run typecheck`, `npm run lint`, `npm run test:db`
  (65 tests, 7 files, Postgres 16), `npm run openapi:check`,
  `terraform fmt -check` + `terraform validate` (google 5.45.2, random 3.6.3).
  The Docker builds could not be run in the authoring environment (no daemon);
  CI builds them on the first push.

---

## [Unreleased] - 2026-10-08 — Money v1 Milestone 1: hosted Mutaba3a API (`server/`)

### Added
- `server/` — a standalone npm package (`@mutaba3a/api`): the hosted,
  organization-scoped financial API that Malafat's Money section calls
  (MUT/MAL Money v1, Option B; ADR-024/025). Hono + zod-openapi, Prisma 6 on
  Postgres, pino, vitest. Own lockfile, lint, Dockerfile and README.
- Milestone 1 surface: `GET /health`, `GET /ready`, `GET /v1/integration`
  (validate key; organization, masked key, scopes, missing scopes, binding),
  `POST /v1/integration/bind` (idempotent tenant binding, ORGANIZATION_MISMATCH
  on conflict), `POST /v1/integration/disconnect` (preserves history, revokes
  the calling key), and operator provisioning under `/admin/v1/*` behind
  `MUTABA3A_ADMIN_TOKEN` (organizations, API keys shown once, revoke, audit).
- Cross-cutting: API-key auth (format, sha256 storage, constant-time compare,
  live/test environment split, revocation, expiry), closed scope vocabulary,
  per-key sliding-window rate limit with `X-RateLimit-*`/`Retry-After`,
  `Idempotency-Key` middleware (replay / reuse-rejection / in-progress),
  append-only audit, standard error envelope with stable codes, request ids,
  decimal-safe `Money` (bigint minor units, string on the wire).
- Prisma migration `20261008093850_m1_control_tables`: organizations,
  api_keys, integrations, audit_events, idempotency_keys.
- Generated contract `server/openapi/openapi.yaml` with `openapi:generate` /
  `openapi:check`; `provision` CLI.
- Tests: 59 (money, keys/scopes, rate limiter, LedgerStore contract against
  memory and Postgres, route tests covering every auth failure code, scope
  enforcement, idempotency, binding conflicts, disconnect, isolation).
- Design artifacts: `.claude/designs/money-v1-repository-audit.md`,
  `money-v1-api-contract.md`, `money-v1-m1-proposal.md`.

### Changed
- `eslint.config.js` ignores `server/` (it has its own config).
- `.claude/DECISIONS.md`: ADR-024 overrides ADR-005 (MUT-30); ADR-025 records
  the hosted-API architecture (MUT-32). ADR-013 is unchanged.

### Technical
- The desktop/PWA app (`src/`) is untouched; it imports nothing from
  `server/`. Local-only operation remains a permanently supported mode.
- `server/.npmrc` sets `legacy-peer-deps` to work around an npm 10.9 arborist
  crash (`edgesOut`) when resolving zod 4 peer ranges.
- Debt: TD-017 (per-instance rate limiter), TD-018 (operator-only
  provisioning; no self-serve accounts), TD-019 (no CI for `server/`).

---

## [Unreleased] - 2026-10-05 — Updater signing key rotation

### Changed
- Rotated the Tauri updater public key in `src-tauri/tauri.conf.json` to the
  keypair with minisign fingerprint `AB7B64537B1DE22C` (was `BEDF931CA1D6C777`).
  The matching private key is what `deploy.sh` and `build-windows.yml` sign
  release artifacts with, via `TAURI_SIGNING_PRIVATE_KEY`.
- Consequence: builds already installed in the field carry the old public key,
  so they will reject updates signed with the new private key. Clients on an
  older build need a manual reinstall to rejoin the update channel.
- **Withdrawn 2026-10-10 (MUT-49, ADR-031).** The premise above was false: the
  v0.0.63 signatures, the macOS release signer and the CI secret are all
  `BEDF931CA1D6C777`; the `AB7B64537B1DE22C` private half never signed a
  release and is not configured in the pipeline. The key was restored on
  2026-10-10; no reinstall is needed.

---

## [Unreleased] - 2026-10-05 — MUT-28 OAuth client for Malafat workspaces

### Added
- PKCE S256 helpers (`src/sync/transport/oauth-pkce.ts`), verified against the
  RFC 7636 Appendix B test vector. `plain` is not implemented.
- Malafat authorization-code client (`oauth-client.ts`): RFC 8414 discovery,
  authorize URL, callback parsing, code exchange, refreshing.
- Flow orchestrator (`oauth-flow.ts`): connect, refresh, disconnect. Owns the
  guarantee that revoked consent clears a token and never application data.
- Token storage port (`src/services/tokenStore.ts`), keyed per workspace origin
  so one lawyer can serve two firms.
- Published CIMD document at `public/.well-known/oauth-client.json`, with a test
  that re-states Malafat's own validation rules against the shipped artifact.
- Rust loopback callback listener (`src-tauri/src/sync/oauth_callback.rs`) plus
  `bind_oauth_callback` / `await_oauth_callback` / `cancel_oauth_callback`.
  Binds 127.0.0.1 only, serves exactly one redirect, releases its port on every
  exit path.
- `tauri-plugin-opener`, scoped to `https://*.malafat.app/*`, to open the
  authorize page in the system browser rather than the webview.

### Fixed
- Declared `tempfile` as a `[dev-dependency]`. The Rust test target had never
  compiled, so 14 pre-existing tests had never run. They pass (see TD-016).

### Technical
- 79 new assertions; `cargo test --lib` 24 passed, `vitest` 2024 passed.
- Verified empirically that Vite ships `public/.well-known/` into `dist-web`.
- Findings: `.claude/designs/mut-28-oauth-client-findings.md`. Three Malafat-side
  policy gaps (MCP gate, missing money scopes, one-grant-per-user vs a
  multi-device desktop app) are recorded on MAL-870 and MUT-28.
- New decision: ADR-023. ADR-005 and ADR-013 remain Active and unoverridden —
  that is MUT-30's job and gates any cloud sync shipping.

---

## [Unreleased] - 2026-10-05

### Fixed
- **Overdue computed five different ways, all off by a day in some timezone** (MUT-17)
  - `/income`'s Overdue tab badge counted items due today as overdue while the
    repository's `overdue` filter excluded them: the badge said 1 and the list
    it opened showed 0. Three screens gave three answers for the same row.
  - Root cause: three duplicate helpers derived "today" as
    `new Date().toISOString().split('T')[0]` — the **UTC** date. In
    Asia/Jerusalem 00:00–03:00 local that is yesterday (overdue items
    under-reported); in America/New_York after ~20:00 it is tomorrow (items due
    today reported overdue).
  - `getDaysUntil` parsed its argument as UTC midnight and compared against
    local midnight, so it was one day off for every timezone west of UTC. Its
    tests passed only because the dev machine is UTC+3; they failed 3/3 under
    `TZ=America/New_York`.
  - **New records got the wrong default date**: `IncomeDrawer`,
    `ExpenseDrawer`, `RetainerDrawer` and `RecurringRuleDrawer` seed from
    `todayISO()`, so a Jerusalem user adding income at 01:00 got it dated
    yesterday.
  - `getAttentionReceivables` derived its 7-day bound via `toISOString()` on a
    local-shifted `Date`, so the window was a day off west of UTC.
  - `ClientDetailPage`'s transactions tab classified overdue as
    `daysUntilDue < 0` without checking the row was unpaid income, so a paid
    invoice or an expense with a past due date rendered as overdue.
  - Files: added `src/lib/dates.ts` + `src/lib/__tests__/dates.test.ts`;
    changed `src/lib/utils.ts`, `src/lib/aggregations.ts`,
    `src/db/repository.ts`, `src/pages/income/IncomePage.tsx`,
    `src/pages/clients/ClientDetailPage.tsx`,
    `src/components/transactions/TransactionStatusCell.tsx`,
    `vitest.config.ts`, `package.json`.
  - Test status: 50 new tests in `dates.test.ts`, green from UTC-10 to UTC+14.
    Full suite Asia/Jerusalem 22 → 21 failures, America/New_York 29 → 25. All
    remaining failures pre-existing and separately ticketed (MUT-19, MUT-20,
    and 4 out-of-scope UTC sites).

### Added
- **`src/lib/dates.ts`**: canonical date-only logic — `todayLocalISO`,
  `daysBetweenLocal`, `daysUntilDue`, `isOverdueReceivable`, `daysOverdue`,
  `isDueSoon`, `isValidDateOnly`. Pure predicates taking `today` explicitly;
  `Date.UTC`-based day ordinals so arithmetic is exact across DST. See ADR-022.
- **Timezone-pinned tests**: `vitest.config.ts` sets `TZ` (default
  `Asia/Jerusalem`) so date tests are deterministic; `npm run test:tz` runs the
  suite under `America/New_York`. Previously results depended on the
  developer's machine and 7 timezone bugs were invisible.
- **Boundary tests** on `IncomePage`: due today is not overdue, due yesterday
  is. Suite clock pinned to 2026-03-14, the instant its fixtures were always
  written against (closes most of MUT-21).

### Technical
- Removed the private `formatLocalDate` duplicate from `src/lib/utils.ts` and
  the private `todayISO` copy from `src/db/repository.ts`.
- `getDaysUntil` is now a one-line delegate, kept for display-only call sites
  (Insights/Reports CSV columns, `ProjectDetailPage`, `TransactionsPage`).
- Zero inline overdue expressions remain in `repository.ts` or
  `aggregations.ts`.

---

## [Unreleased] - 2026-03-14

### Changed
- **ProjectDrawer Profile Selector**: Profile selector now displays when at least one profile exists (changed from requiring 2+ profiles)
  - Updated condition from `profiles.length > 1` to `profiles.length > 0` in `src/components/drawers/ProjectDrawer.tsx:167`
  - Makes profile association explicit and visible even for single-profile users
  - Aligns with UX principle of making profile relationships transparent
  - Added 5 comprehensive tests for profile selector behavior in `ProjectDrawer.test.tsx`:
    - Shows selector when one profile exists
    - Shows selector when multiple profiles exist
    - Allows selecting a profile
    - Pre-populates with active profile
    - Hides selector when no profiles exist
  - Files changed: `ProjectDrawer.tsx`, `ProjectDrawer.test.tsx`
  - Test status: 13 passing (2 skipped)

### Added
- **Partial Payments UI Integration**: Fully integrated partial payment functionality into income tables across the application
  - Added `PaymentStatusBadge` component to display payment status with percentage for partial payments
  - Exported `PaymentStatusBadge` from `src/components/ui/index.ts`
  - Updated `transactionRepo.list()` to compute `paymentStatus` and `remainingAmountMinor` for all income transactions
  - Income tables now show:
    - Payment status badge (Paid, Partial X%, Unpaid)
    - Received amount display for partial payments
    - "Record Payment" action in row menu for unpaid income
    - Visual indication of payment progress
  - Updated pages:
    - `/income` (IncomePage.tsx) - main income ledger
    - `/projects/:id` (ProjectDetailPage.tsx) - project transactions tab
    - `/clients/:id` (ClientDetailPage.tsx) - receivables tab and transactions tab
  - Added comprehensive tests in `IncomePage.test.tsx`:
    - PaymentStatusBadge rendering
    - Partial payment display
    - Record payment action availability
    - Payment status calculations
  - All translations (en, ar) already in place for partial payment UI
  - Removed completed TODO item

### Fixed
- **Timezone Bug in Recurring Expense Calculations**: Fixed `shouldRuleOccurInMonth` in `forecastCalculations.ts` to use consistent year/month numeric comparison instead of Date object comparison, which was causing incorrect results in UTC+ timezones
- **untilDate End Mode**: Fixed end date logic to properly exclude months where the occurrence day would fall after the end date

### Added
- **Recurring Source Badge**: Expenses generated from recurring rules now display a "Recurring" badge next to the title
  - Added `.recurring-badge` CSS styling in `index.css`
  - Added translation keys `expenses.fromRecurring` and `expenses.recurringBadge`
- **Profile Mode Indicator**: Expenses page now shows explicit "All Profiles" vs "Current Profile" toggle
  - Added `.expenses-mode-indicator` and `.expenses-mode-button` styles
  - Added translation keys for profile mode UI
  - Now shows all available profiles as buttons for quick switching
- **Profile-Specific Tools Card**: Shows explanatory message when in All Profiles mode about features that require a specific profile
- **Delete Action**: Added delete action to expense row actions menu with confirmation dialog
  - Special confirmation message for expenses from recurring rules
- **Keyboard Shortcuts**: Added keyboard shortcuts to expenses page
  - `N` - Open new expense drawer
  - `/` - Focus search input
  - `Esc` - Close drawer (already handled by Drawer component)
- **Profile-Aware Routing**: Clicking a profile button now navigates to `/expenses/profile/$profileId`
  - Deep-linkable profile URLs
  - URL reflects current profile context

### Changed
- **Duplicate Button**: Now properly prefills expense data (amount, currency, vendor, category, title) when duplicating
- **Multi-Currency Group Totals**: `ExpenseGroupedView` now shows separate totals per currency instead of summing all currencies
- **SearchInput Component**: Now uses `forwardRef` and exposes `focus()` method via ref

### Fixed
- **GAP 1**: Delete action now available in row actions menu
- **GAP 2**: Duplicate button now prefills expense data correctly
- **GAP 3**: Page mode is now explicit with visible toggle
- **GAP 4**: Profile selection now navigates to profile-specific URL
- **GAP 6**: Multi-currency group totals now show separate amounts per currency
- **GAP 10**: Recurring source badge now identifies expenses generated from rules

### Technical
- Changed `GroupedExpenses` interface from `totalMinor: number` to `totalsByCurrency: Record<string, number>`
- Added `.expense-title-cell` wrapper for title cell content
- Added `SearchInputRef` type export from filters
- Added `useNavigate` hook for profile-based routing

---

## [Previous] - 2026-03-13

### Added
- **Income Query Hooks (`useIncomeQueries.ts`)**: New dedicated hooks for income-specific queries
  - `useIncome(filters)`: Fetch income transactions with optional filters (pre-filters by kind='income')
  - `useIncomeById(id)`: Fetch a single income transaction
  - `useReceivables(filters)`: Fetch unpaid income (receivables) with optional overdue filter
  - `useIncomeTotals()`: Fetch income totals for overview displays
  - `useAttentionReceivables()`: Fetch receivables needing attention
  - `useCreateIncome()`, `useUpdateIncome()`: Create/update income transactions
  - `useMarkIncomePaid()`: Mark income as paid (replaces deprecated `useMarkTransactionPaid`)
  - `useRecordIncomePartialPayment()`: Record partial payments
  - `useDeleteIncome()`, `useArchiveIncome()`, `useUnarchiveIncome()`: Lifecycle mutations

### Changed
- **IncomePage**: Migrated from `useTransactions` to `useIncome` and `useMarkIncomePaid`
- **ClientDetailPage**: Migrated receivables tab from `useTransactions` to `useReceivables`, mark paid to `useMarkIncomePaid`
- **ProjectDetailPage**: Migrated mark paid from `useMarkTransactionPaid` to `useMarkIncomePaid`
- **TransactionsPage**: Migrated mark paid from `useMarkTransactionPaid` to `useMarkIncomePaid` (keeps `useTransactions` for mixed view)
- **RetainerMatchingDrawer**: Migrated from `useTransactions` to `useIncome` for paid income lookup

### Technical
- **Deprecated `useTransactions`**: Added deprecation notice; kept for legacy mixed views until next release
- **Deprecated `useMarkTransactionPaid`**: Added deprecation notice; use `useMarkIncomePaid` instead
- Proper query key separation for income queries vs generic transaction queries
- Income hooks automatically invalidate both income-specific and legacy transaction caches for backwards compatibility

---

- **Insights Reintegration (Phase 1 & 2)**:
  - **Phase 1: Data Contracts & Aggregation Functions**
    - New forecast types: `ForecastKPIs`, `AmountByCurrency`, `ForecastOptions`, `MonthActuals`, `AttentionItem` in `src/types/index.ts`
    - Pure aggregation functions in `src/lib/aggregations.ts`:
      - Date utilities: `getTodayISO`, `getMonthRange`, `getDaysInMonth`, `daysBetween`, `isDateInRange`
      - Amount utilities: `zeroAmounts`, `addAmount`, `subtractAmount`
      - Transaction grouping: `getTransactionEffectiveDate`, `groupTransactionsByDay`, `groupTransactionsByMonth`
      - Forecast calculations: `calculateForecastKPIs`, `calculateMonthActuals`, `calculateRunningBalance`
      - Attention helpers: `findOverdueUnpaidIncome`, `findUnpaidIncomeDueSoon`, `findUnpaidIncomeMissingDueDate`
    - 60 unit tests for aggregation functions in `src/lib/__tests__/aggregations.test.ts`
    - Terminology update per ADR-010: "receivables" → "unpaid income", "projections" → "projected retainer"
  - **Phase 2: Home Page Components**
    - `PredictiveKpiStrip` component: 3 forecast KPI cards (Will I Make It?, Cash on Hand, Coming/Leaving)
    - `AttentionFeed` component: Severity-sorted attention items with max 5 items, collapsible
    - `MonthActualsRow` component: Collapsible summary of received/unpaid/expenses/net
    - `InfoIcon` in icons
    - Updated `OverviewPage` to use new components (current-month only, no date range selector)
    - i18n translations for all new components (English and Arabic)
    - CSS styles for all new components
  - **Phase 3: Insights Page Enhancement**
    - Added Cash Flow Timeline link to Insights Summary tab
    - Links to `/money-answers` page for dedicated timeline view with its own date picker
    - i18n translations for timeline link and hint text (English and Arabic)
    - Removed inline period toggle and inclusion toggles to avoid conflicts with Insights date range
  - **Phase 4: Polish, Responsiveness, Testing, Documentation**
    - **Responsive Design**:
      - Added mobile breakpoint (480px) for attention-feed, actuals-row, kpi-card-forecast
      - Stack layouts and reduced padding on small screens
      - Hidden currency tabs on mobile in actuals-row (uses localStorage default)
    - **Accessibility Improvements**:
      - AttentionFeed: semantic `<ul>`/`<li>` with role="list"/role="listitem"
      - Added aria-label on attention list container
      - Added aria-hidden="true" on decorative icons
      - Added aria-label on action buttons for screen readers
      - Added aria-expanded on expand/collapse toggle buttons
    - **Component Documentation**:
      - Updated COMPONENT_REGISTRY.md with new Home components section
      - Documented PredictiveKpiStrip, AttentionFeed, MonthActualsRow, QuickSummaries, InfoIcon
      - Added props tables, usage examples, and accessibility notes
      - Updated Component Ownership table
    - **Integration Tests**:
      - 47 new tests for Home components in `src/components/home/__tests__/`
      - AttentionFeed.test.tsx: rendering, accessibility, severity styling, actions, currency display
      - PredictiveKpiStrip.test.tsx: currency tabs, help tooltips, value display, Coming/Leaving card
      - MonthActualsRow.test.tsx: expand/collapse, localStorage persistence, currency tabs, color coding

### Fixed
- **Desktop app update mechanism**:
  - Fixed `deploy.sh` signature extraction - was including full CLI output instead of just the base64 signature in `latest.json`, breaking Tauri's auto-updater
  - Added version change detection (`handleVersionChange()` in `src/lib/platform.ts`) - clears update-related localStorage caches when app version changes, ensuring users who install a new DMG see the correct version (macOS preserves app data across installs)

### Added
- **Migration Safety Layer** (`src/db/migration-safety.ts`):
  - Automatic pre-migration backups to prevent data loss during schema updates
  - Post-migration validation to detect missing fields (profileId, receivedAmountMinor)
  - Auto-fix capability for common migration issues
  - Backup storage in separate IndexedDB database (`mutaba3a_backup`)
  - Recovery functions: `restoreFromBackup()`, `importBackupFromFile()`
  - Validation functions: `validateMigration()`, `autoFixMigrationIssues()`
  - Export functions: `downloadBackup()`, `exportCompleteBackup()`
  - Migration event logging for audit trail
  - Keeps last 3 backups automatically, cleans up older ones
  - Tests: 16 tests in `src/db/__tests__/migration-safety.test.ts`
  - Integrated into `initDatabase()` - runs automatically on app startup
  - `repairDatabase()` function for manual recovery

- **AmountWithConversion component**: New UI component that displays single-currency amounts with hover tooltip showing ILS-converted value using live FX rates from Frankfurter API
  - Used in transaction tables where each row has a single currency
  - Shows original currency with hover tooltip displaying approximate ILS conversion and FX rate source (Live/Cached)
  - Graceful degradation: shows plain amount if FX rate unavailable

### Changed
- **Multi-currency display reintegration**: Updated all transaction-related pages to use unified currency display components
  - **TransactionsPage**: Uses `AmountWithConversion` for individual transaction amounts with hover conversion
  - **OverviewPage**: Uses `AmountWithConversion` in recent activity and needs attention sections
  - **ClientDetailPage**: Uses `AmountWithConversion` in transaction tables and recent activity
  - **ProjectDetailPage**: Uses `AmountWithConversion` in transaction tables
  - **IncomePage**: Uses `CurrencySummaryPopup` for summary totals, `AmountWithConversion` for rows
  - **ExpensesLedgerPage**: Uses `CurrencySummaryPopup` for summary totals, `AmountWithConversion` for rows
- ILS is now the default display currency with hover tooltips showing conversion breakdown

### Changed
- **IncomeDrawer Refactor (TransactionDrawer → IncomeDrawer)**:
  - Renamed `TransactionDrawer` to `IncomeDrawer` for clarity
  - Replaced type selector (Income/Receivable/Expense) with status selector (Earned/Invoiced/Received)
  - New status model maps: Earned → unpaid, Invoiced → unpaid, Received → paid
  - Added contextual profile handling:
    - Single profile users: profile hidden
    - Multi-profile users: profile shown as compact chip
    - "All Profiles" mode: shows profile quick picker
  - Added `ProfileContextChip` component for drawer profile display
  - Added `ProfileQuickPicker` component for fast profile selection
  - Added `useProfileAwareAction` hook for profile-checking before actions
  - Updated `useDrawerStore` with `incomeDrawer` state (legacy `transactionDrawer` aliased)
  - Updated SidebarNav to use profile-aware actions
  - Added i18n keys for income drawer status labels (en/ar)
  - Migrated tests from TransactionDrawer.test.tsx to IncomeDrawer.test.tsx

### Added
- **Partial Payments Support**:
  - Added `receivedAmountMinor` field to Transaction for tracking partial payments
  - Added `PaymentStatus` type ('unpaid' | 'partial' | 'paid')
  - Database schema v14 with migration for existing transactions
  - `transactionRepo.recordPartialPayment()` method to record incremental payments
  - Updated `transactionRepo.getDisplay()` to compute `paymentStatus` and `remainingAmountMinor`
  - `PaymentStatusBadge` component (`src/components/ui/PaymentStatusBadge.tsx`)
  - `PartialPaymentDrawer` component with quick-fill buttons (25%, 50%, 100%)
  - `useRecordPartialPayment` mutation hook
  - i18n keys for partial payment UI in en.json and ar.json

- **URL-Persisted Sorting**:
  - `useSortState` hook (`src/hooks/useSortState.ts`) for URL-based sort state management
  - ClientsPage and ProjectsPage now persist sort field/direction in URL params
  - Sort state survives page refresh and navigation

- **First-Run Onboarding**:
  - `useOnboardingStore` (`src/lib/onboardingStore.ts`) - Zustand store with localStorage persistence
  - `OnboardingOverlay` component with step-based guided setup
  - `OnboardingStepIndicator` component for visual progress
  - 3-step flow: Add Client → Create Project → Record Income
  - Auto-advances when drawers complete entity creation
  - Skip option persists in localStorage
  - i18n keys for onboarding UI in en.json and ar.json

- **Multi-Profile with "All Profiles" Lens**:
  - Added `profileId` field to `Client`, `Project`, `Transaction` types for profile isolation
  - Database schema v13 with migration to assign existing records to default profile
  - `ProfileStore` (`src/lib/profileStore.ts`) - Zustand store for active profile state
  - `useActiveProfile` hook (`src/hooks/useActiveProfile.ts`) - Business logic for profile context
  - `useProfileFilter` hook - Helper for query filtering
  - "All Profiles" option in ProfileSwitcher when 2+ profiles exist
  - `ProfileBadge` component (`src/components/ui/ProfileBadge.tsx`) - Visual indicator for profile
  - `ProfilePickerModal` (`src/components/modals/ProfilePickerModal.tsx`) - Profile selection for creation flows
  - Updated drawer stores to support `defaultProfileId` parameter
  - Updated pages (Overview, Clients, Projects, Expenses) to respect profile context
  - i18n keys: `profileSwitcher.allProfiles`, `profile.select`, `profile.selectPrompt`, `profile.badge.viewingAll` (en/ar)

- **UX Redesign Phase 4 - Insights Page** (`src/pages/insights/InsightsPage.tsx`):
  - New consolidated Insights page at `/insights` replacing Reports redirect
  - Preset tabs: Summary, Clients, Projects, Expenses, Unpaid
  - Summary tab: Paid income, unpaid receivables, expenses, net calculation
  - Clients tab: Client list with paid income and unpaid breakdown
  - Projects tab: Project list with received, unpaid, expenses, net columns
  - Expenses tab: Expenses by project breakdown
  - Unpaid tab: Aging buckets (current, 1-30d, 31-60d, 60+d overdue)
  - Date range filter (period control)
  - Currency mode selector (USD, ILS, Both)
  - CSV export for each preset tab
  - Tests: 21 tests in `src/pages/insights/__tests__/InsightsPage.test.tsx`
  - i18n: Added `insights.title` and `insights.tabs.*` keys (en/ar)
  - CSS: Added `.insights-tabs`, `.insights-tab`, `.insights-section` styles

### Fixed
- **i18n**: Added missing `transactions.columns.description` key (en: "Description", ar: "الوصف")

### Changed
- **Router**: `/insights` route now uses dedicated InsightsPage instead of redirecting to ReportsPage

### Deprecated
- **MoneyAnswersPage** (`src/pages/money-answers/`): Marked as deprecated with JSDoc comments. Route redirects to `/insights`. Code kept for reference.
- **ReportsPage** (`src/pages/reports/`): Marked as deprecated with JSDoc comments. Route redirects to `/insights`. Code kept for reference.

### Added
- **UX Redesign Specification**:
  - Created `docs/ux-redesign/UX-REDESIGN-SPEC.md` - Authoritative spec for question-first UX redesign
  - Created `docs/ux-redesign/IMPLEMENTATION-PLAN.md` - 4-phase implementation breakdown with ~100 actionable tasks
  - Product direction shift: entity-first CRM → question-first cash flow workspace
  - New navigation structure: Home, Income, Expenses, Insights | Clients, Projects | Settings
  - Deprecation plan for Documents, Retainers, Engagements, standalone Reports/Money Answers

### Added
- **UX Redesign Phase 2.3 - Expenses Page** (`src/pages/expenses/ExpensesLedgerPage.tsx`):
  - New question-first expenses ledger page at `/expenses`
  - View toggles: List (default), By Category, By Project
  - Expenses summary strip showing total expenses
  - Category grouping with subtotals
  - Project grouping with subtotals
  - Transaction-based filtering (kind='expense')
  - Connects to TransactionDrawer for edit with default kind='expense'
  - Empty state with "Add Expense" action
  - Tests: 15 tests in `src/pages/expenses/__tests__/ExpensesLedgerPage.test.tsx`
  - Profile-based expense system moved to `/expenses/profiles` route

- **EmptyState Component Enhancement** (`src/components/ui/EmptyState.tsx`):
  - Added `hint` prop as alias for `description`
  - Added `actionLabel` and `onAction` props as convenience alternatives to `action` object
  - Maintains backwards compatibility with existing `description` and `action` props

- **UX Redesign Phase 3.1 - Clients List Redesign** (`src/pages/clients/ClientsPage.tsx`):
  - Added "Received" column showing paid income totals per client
  - Added summary strip with total clients count, total received, total unpaid
  - CurrencySummaryPopup for multi-currency display (USD/ILS/EUR)
  - Tests: 16 tests in `src/pages/clients/__tests__/ClientsPage.test.tsx`
  - i18n: Added `clients.columns.received` and `clients.summary.*` keys

- **UX Redesign Phase 3.3 - Projects List Redesign** (`src/pages/projects/ProjectsPage.tsx`):
  - Added columns: Received, Expenses, Net
  - Net calculation: received - expenses per project
  - Visual indicator for negative net projects (color-coded cells)
  - Summary strip with totals: projects count, received, unpaid, expenses, net
  - Tests: 23 tests in `src/pages/projects/__tests__/ProjectsPage.test.tsx`
  - i18n: Added `projects.columns.received` and `projects.summary.*` keys
  - CSS: Added `.projects-summary-strip`, `.net-cell.positive/.negative` styles

### Changed
- **UX Redesign Phase 1 Complete** (Navigation + Routes + i18n + Add Menu + Titles):
  - **Sidebar restructured** with question-first navigation sections (Main, Workspace, System)
  - **New routes**: `/income`, `/expenses`, `/insights` created
  - **Legacy redirects added**:
    - `/transactions` → `/income`
    - `/reports` → `/insights`
    - `/money-answers` → `/insights`
  - **Navigation items removed** from sidebar: Documents, Retainers, Engagements, Money Answers
  - **Global Add Menu simplified**: Removed Document option from TopBar add menu (now only: Income, Expense, Project, Client)
  - **Page title updated**: Overview page title changed from "Overview" to "Home" (en: "Home", ar: "الرئيسية")
  - **i18n labels** updated in en.json and ar.json with new nav keys
  - Files changed:
    - `src/router.tsx` - Added redirects for legacy routes
    - `src/components/layout/SidebarNav.tsx` - Already restructured with new nav sections
    - `src/components/layout/TopBar.tsx` - Removed Document from add menu
    - `src/lib/i18n/translations/en.json` - Updated overview.title to "Home"
    - `src/lib/i18n/translations/ar.json` - Updated overview.title to "الرئيسية"

---

## [0.0.51] - 2026-03-13

### Fixed
- **Desktop App Update System**:
  - Re-enabled UpdateBanner component in AppShell
  - Fixed translation interpolation syntax (changed `{{var}}` to `{var}` to match i18n system)
  - UpdateBanner now properly shows when updates are available in Tauri desktop app
  - Users see update notifications with download progress and restart prompts

### Added
- **Update Banner Tests**:
  - `src/components/__tests__/UpdateBanner.test.tsx` (11 tests) - Full coverage for update banner states
  - `src/hooks/__tests__/useTauriUpdater.test.ts` (8 tests) - Hook behavior and API tests

### Technical
- Test count increased from 337 to 356 (19 new tests for update system)
- All 356 tests passing (5 skipped)
- Files changed:
  - `src/components/ui/UpdateBanner.tsx` - Uncommented and improved implementation
  - `src/components/layout/AppShell.tsx` - Re-enabled UpdateBanner import and usage
  - `src/lib/i18n/translations/en.json` - Fixed interpolation syntax in updateBanner keys
  - `src/lib/i18n/translations/ar.json` - Fixed interpolation syntax in updateBanner keys

---

## [0.0.50] - 2026-02-09

### Added
- **Reports Feature (TD-002 Resolved)**:
  - Full Reports page at `src/pages/reports/ReportsPage.tsx`
  - 5 report presets: Summary, By Project, By Client, Expenses by Project, Unpaid Aging
  - Date range filter (This Month, Last Month, This Year, All Time, Custom)
  - Currency mode selector (USD, ILS, Both)
  - CSV export for all report types
  - Route activated in `router.tsx`

- **Error Boundaries (TD-008 Resolved)**:
  - `ErrorBoundary` component for app-level error catching
  - `InlineErrorBoundary` for drawer-level errors
  - CSS styling for error fallback states

- **Database Schema v12**:
  - Added compound index `[baseCurrency+quoteCurrency]` on fxRates table (TD-012 resolved)

- **Test Coverage Expansion**:
  - `src/db/__tests__/expenseRepo.test.ts` (37 tests) - Expense, category, receipt, vendor, monthClose repos
  - `src/db/__tests__/retainerRepo.test.ts` (26 tests) - Retainer, projected income, schedule generator, matching
  - `src/components/__tests__/TransactionDrawer.test.tsx` (12 tests)
  - `src/components/__tests__/ClientDrawer.test.tsx` (10 tests)
  - `src/components/__tests__/ProjectDrawer.test.tsx` (10 tests)

- **E2E Testing Infrastructure (TD-004)**:
  - Playwright test framework configured (`playwright.config.ts`)
  - E2E test files created:
    - `e2e/navigation.spec.ts` - Page navigation tests
    - `e2e/transaction.spec.ts` - Transaction CRUD tests
    - `e2e/settings.spec.ts` - Settings page tests
  - npm scripts: `test:e2e`, `test:e2e:ui`

- **Accessibility Testing Infrastructure (TD-009)**:
  - axe-core/playwright installed for automated a11y testing
  - `e2e/accessibility.spec.ts` - Tests for WCAG compliance on all main pages

- **Pagination Infrastructure (TD-005)**:
  - `Pagination` component at `src/components/ui/Pagination.tsx`
  - `ChevronLeftIcon` and `ChevronRightIcon` icons
  - Pagination CSS styles with RTL support

- **SQLite Migration Preparation (TD-013)**:
  - Created `src/db/interfaces.ts` with TypeScript interfaces for all repositories
  - 19 repository interfaces defined for complete data layer abstraction
  - `IRepositoryProvider` factory interface for platform-based implementation selection
  - Exported interfaces from `src/db/index.ts`

### Fixed
- Fixed missing required fields in test data (BusinessProfile, Receipt)
- Fixed unused variable warning in retainerRepo.test.ts

### Technical
- Test count increased from 246 to 337 (91 new tests)
- All 337 tests passing (5 skipped)
- TD-002, TD-008, TD-012 resolved
- **Sync Feature Audit (TD-003 Updated)**:
  - Verified bundle export/import sync is fully working
  - All sync modals wired in AppShell (Export, Import, Pairing)
  - `initializeSync()` called on app load
  - SyncSection component displayed in Settings
  - Updated TD-003 status: bundle sync working, live LAN sync needs Tauri verification

---

## [0.0.49] - 2026-02-09

### Added
- **Comprehensive Test Coverage for Main Flows**:
  - `src/db/__tests__/transactionRepo.test.ts` (37 tests) - Full CRUD, filtering, totals, overdue/attention logic
  - `src/db/__tests__/clientRepo.test.ts` (22 tests) - CRUD operations and client summaries
  - `src/db/__tests__/projectRepo.test.ts` (24 tests) - CRUD operations and project summaries
  - `src/db/__tests__/settingsRepo.test.ts` (16 tests) - Settings, FX rates, categories
  - `src/db/__tests__/aggregations.test.ts` (27 tests) - Pure aggregation functions
- Extended `src/test/utils.tsx` with new factory functions:
  - `createMockTransaction`, `createMockProject`, `createMockCategory`, `createMockFxRate`
  - Helper functions: `createMockIncome`, `createMockExpense`, `createMockReceivable`, `createMockOverdueReceivable`
  - Date utilities: `getRelativeDate`, `getRelativeTimestamp`

### Changed
- Updated `TEST_PLAN.md` with current coverage status
- Updated `TECH_DEBT.md`:
  - TD-001 status changed to "In Progress" with updated coverage information
  - Added TD-012 for fxRateRepo.getLatest() missing compound index bug

### Technical
- Test coverage improved from ~3% to ~40%
- All 246 tests passing (2 skipped due to missing compound index)
- Repository layer now has ~85% test coverage
- Tests cover: transactions, clients, projects, documents, business profiles, settings, categories, aggregations

---

## [0.0.48] - 2026-02-09

### Added
- Created `.claude/SYSTEM_OVERVIEW.md` - comprehensive system documentation
- Created `.claude/DECISIONS.md` - architectural decision records
- Created `.claude/COMPONENT_REGISTRY.md` - reusable component catalog
- Created `.claude/PATTERNS.md` - code patterns and conventions
- Created `.claude/CHANGELOG.md` - this file
- Created `.claude/TECH_DEBT.md` - technical debt tracking
- Created `.claude/CI_CD.md` - CI/CD pipeline documentation
- Added h5, h6 heading styles to index.css for completeness

### Changed
- Updated `DECISIONS.md` ADR-018 with canonical token naming clarification
- Updated `PATTERNS.md` with Design Token Patterns section (token quick reference, button styling, focus styles, dark mode support)
- Updated `TECH_DEBT.md` with TD-011 for design system inconsistencies (now resolved)

### Fixed
- **Design System Unification (TD-011 - Resolved)**:
  - Phase 1: Added deprecation notices to legacy CSS variables in index.css
  - Phase 2: Removed dead `.landing-btn--*` classes from LandingPage.css, removed inline fallback values from 12 landing page CSS files
  - Phase 3: Migrated 39+ CSS files from legacy tokens to canonical tokens (`--font-size-*` → `--text-*`, `--font-weight-*` → `--weight-*`, `--shadow-sm/md/lg` → `--shadow-1/2/3`)
  - Phase 4: Standardized focus styles to use `box-shadow: var(--focus-ring)` instead of `outline` across 7 files; updated line-height to use `--leading-tight` (kept compact heading sizes for app UI)

### Technical
- Formalized project knowledge management system
- Design system now has single source of truth: `theme.css` for canonical tokens
- All focus-visible styles use `box-shadow: var(--focus-ring)` for consistency
- App headings use compact sizes (h1: 20px, h2: 18px, h3: 16px, h4: 14px) for data-dense cockpit UI
- Landing page headings use larger theme.css scale for marketing emphasis
- Fixed missed token migration in SplitWorkspace.css (`--shadow-lg` → `--shadow-3`)

---

## [0.0.47] - Previous

### Added
- Engagement letter feature (task/retainer types)
- PDF generation for engagement letters
- Profile-scoped engagements

### Changed
- Engagement schema to support profileId

---

## [0.0.46] - Previous

### Fixed
- Payment matching UI improvements
- Cache issues with service worker

---

## [0.0.44] - Previous

### Added
- Web release automation
- Service worker improvements

---

## [0.0.43] and Earlier

*Historical releases - see git log for details.*

---

## Migration Notes

### v0.0.48
- No database schema changes
- No breaking API changes

### v0.0.47
- Database schema v10: Added `profileId` to engagements table
- Migration: Existing engagements assigned to default profile

### v0.0.44
- Database schema v9: Added engagement tables

---

## Version History Summary

| Version | Date | Highlights |
|---------|------|------------|
| 0.0.48 | 2026-02-09 | System documentation |
| 0.0.47 | 2026-02 | Engagement letters |
| 0.0.46 | 2026-01 | Payment UI fixes |
| 0.0.44 | 2026-01 | Web release |
| 0.0.40 | 2025-12 | Retainer matching |
| 0.0.35 | 2025-11 | Document immutability |
| 0.0.30 | 2025-10 | Expense tracking |
| 0.0.25 | 2025-09 | Document generation |
| 0.0.20 | 2025-08 | Sync foundation |
| 0.0.15 | 2025-07 | Multi-profile support |
| 0.0.10 | 2025-06 | Desktop (Tauri) |
| 0.0.5 | 2025-05 | Core MVP |
| 0.0.1 | 2025-04 | Initial release |
