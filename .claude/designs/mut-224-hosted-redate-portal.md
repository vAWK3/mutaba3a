# MUT-224 — Hosted portal: change the date of a saved income entry and a recorded payment

Status: Planned (eng-ticket, 2026-10-15). Portal only (`src/hosted/**` + `qa/`). The blocker, MUT-223 (server API, ADR-083),
is merged to local main as f505f3a.
Tracker: Jira · barmajiyat · MUT · Backlog → Planned → In Progress (eng-build) → In Review (qa-reconcile).

## 1. Problem and what the portal has today

You can't change the date of a saved Owed entry or a recorded payment on the portal. MUT-223 added
`PATCH /v1/income/{id}` and `PATCH /v1/payments/{id}`, both If-Match on `version`, owned profiles only. Facts found
while reading the code. The ticket text assumes some UI that doesn't exist (§5):

- **Receivables list** (`pages/views/ReceivablesList.tsx`): the Owed entries. Columns are Client, Matter, **Due**,
  Amount, Paid, Outstanding, Status, plus a sticky "Record payment" action. There's **no entry-date column** and no
  month grouping anywhere in the portal.
- **Payments list** (`pages/views/PaymentsList.tsx`): every payment, with Received entries and settle payments mixed
  in. The first cell holds an **expander button** (allocations), and a Received column shows `receivedOn`.
- No portal view shows an Owed entry's **paid date**. `Receivable` carries no payment dates, and the API has no
  payments-by-receivable filter.
- Edit-drawer precedent: `ConversionDrawer` (MUT-194). It loads one record, PATCHes at the loaded version, and on 409
  invalidates the query and refills via a reset effect keyed on id + version. `ExpenseDrawer` does *not* refetch on
  409 (MUT-221); we don't copy it.
- URL state: `IncomeDrawerSearch { newIncome, settle }` lives in `data/filters.ts`, and `IncomeDrawerHost` is mounted
  by Receivables, Payments and Client detail.
- `incomeAffordancesFor(profile)` is the only gate for income writes. Owned profiles only, so Malafat-fed and
  writer-null firms get nothing.
- The API client has no `payment(id)`, `updateIncome` or `updatePayment` yet. `request()` already sends `If-Match`.

## 2. Proposed design

**Two URL drawers, one component.**
- `?income=<receivableId>` re-dates an **Owed** entry (Receivables rows) through `PATCH /v1/income/{id}`
  `{occurredOn}`.
- `?payment=<paymentId>` re-dates a **payment** the person captured (Payments rows) through `PATCH /v1/payments/{id}`
  `{receivedOn}`. That covers both Received entries and settle payments, because in the portal a Received entry *is*
  a payment row. `PATCH /v1/payments` accepts every own CAPTURE payment, so the portal never needs
  `PATCH /v1/income` for Received. (Decision D2.)

`components/RedateDrawer.tsx` (new) holds the shared behaviour:
- Read-only summary: amount (DecimalAmount), client, matter, title or note, and for Owed the due date ("stays as it
  is").
- One `<input type="date" max={todayInZone(profile.timezone)}>`.
- Save → PATCH with `ifMatchVersion: String(loaded.version)`.
- On 409: invalidate the entity query and show the conflict message. The reset effect (keyed on id + version,
  ConversionDrawer D6) refills the date with the latest value.
- A 422 (DATE_INVALID) shows inline under the date. 404 shows `Unreachable` with a "no longer available" message.
- On success: close, invalidate the lists and summaries, and let the drawer return focus to the row. This is the same as the income drawers today; the Receivables and Payments lists don't render the MUT-91 row tint (review: factual correction).
- Props: `{ kind: 'owed' | 'payment', profile, id, onClose }`. The hooks are chosen by kind, with no flags inside
  JSX.

```
row click / Enter ─▶ setSearch({ ...filters, income|payment: id }) ─▶ IncomeDrawerHost
  ─▶ RedateDrawer(kind) ─▶ useReceivable | usePayment (staleTime 0)
       save ─▶ PATCH (If-Match = loaded.version)
         ├─ 200 ─▶ invalidate receivables/payments/summary + entity ─▶ markSaved ─▶ close (param cleared)
         ├─ 409 ─▶ invalidate entity ─▶ refill on new version ─▶ conflict notice, stays open
         ├─ 422 ─▶ inline date error
         └─ 404 ─▶ Unreachable ("this entry is no longer available")
```

**Who gets the affordance** (`data/incomeAffordances.ts`, extended rather than branched in views):
- `canRedateOwed(profile, receivable)` = owned and `access.capture === 'read-write'` and `origin === 'ADJUSTMENT'`
  and status not VOID.
- `canRedatePayment(profile, payment, meId)` = owned and `access.payments === 'read-write'` and
  `origin === 'capture'` and `status === 'POSTED'` and `capturedBy?.userId === meId`.
- Malafat-fed, firm and other people's rows get no handler and render exactly as today (AC6).

**Rows** (row-link pattern, MUT-194):
- **Receivables:** `onRowClick` opens `?income=`. The first cell (client or matter) becomes the `row-link` button.
  The Record payment button gets `stopPropagation` so it doesn't also open the drawer.
- **Payments:** the first cell already holds the expander button, and a nested button would be invalid. So
  `HostedTable` gains `linkColumn?: string` (default: the first column) and `canOpen?: (row) => boolean`. Rows that
  can't open get no `clickable` class, no row-link and no handler. Payments points `linkColumn` at `received`. The
  expander and Record payment buttons call `stopPropagation` (R5).
- **Receivables list gains a "Date" column** (`postingDate`, before Due), so a re-dated Owed entry visibly moves.
  This is the only place AC1 can be seen. (Decision D3.)

**Payment lines for a settled entry (R4):** when the `?income=` entry is settled or partly paid, the drawer runs
`usePaymentsForEntry(profileId, customerId, receivableId)`. That is one `GET /v1/payments?customerId=` (first page,
limit 50), keeping payments whose `allocations` name this receivable. Each line shows Received date + amount and
opens `?payment=`. If none are found on that page, a "See Payments" link goes to the client's Payments tab.

**Hooks stay unconditional** (review, code quality): RedateDrawer calls `useReceivable` and `usePayment` every
render, and each gets `enabled` by kind. `useReceivable` gains an `enabled` option.

**Settle note:** reword `hosted.settle.honest` (en + ar) to "You can fix the date later; the amount can't be
changed yet."

## 3. Files

| Area | File | Change |
|---|---|---|
| API client | `src/hosted/api/client.ts` | `payment(profileId, id)` GET; `updateIncome(profileId, id, {occurredOn}, version)`; `updatePayment(profileId, id, {receivedOn}, version)`; export `UpdateIncomeRequest`, `UpdatePaymentRequest` types |
| Queries | `src/hosted/data/incomeQueries.ts` | `usePayment(profileId, id)` (staleTime 0); `useReceivable` gains `enabled`; `usePaymentsForEntry(profileId, customerId, receivableId)` (R4); `useRedateOwed`, `useRedatePayment`. Both invalidate `receivables`, `payments`, `receivable`, `payment`, `summary` (extend `invalidateIncome`) |
| Gate | `src/hosted/data/incomeAffordances.ts` | `canRedateOwed`, `canRedatePayment` |
| URL | `src/hosted/data/filters.ts` | `IncomeDrawerSearch` gains `income?: id`, `payment?: id`; `parseIncomeDrawer` and `splitIncomeDrawer` carry them |
| Drawer | `src/hosted/components/RedateDrawer.tsx` (new) | as §2 |
| Errors | `src/hosted/components/incomeApiErrors.ts` | map PATCH errors: DATE_INVALID → field, CONFLICT/VERSION_MISMATCH → conflict notice, NOT_FOUND → gone |
| Host | `src/hosted/components/IncomeDrawerHost.tsx` | render `RedateDrawer` for `drawer.income` / `drawer.payment` when the gate allows; `key` = id |
| Views | `pages/views/ReceivablesList.tsx`, `PaymentsList.tsx` (and `ClientDetailPage.tsx` wiring) | `onRedate` props → `setSearch({... income/payment})`; Date column; `stopPropagation` on settle |
| Table | `src/hosted/components/HostedTable.tsx` | `linkColumn?: string`, `canOpen?: (row) => boolean` (R5) |
| i18n | `src/hosted/i18n/en.json`, `ar.json` | `hosted.redate.*` (titles, date label, due-stays note, save, conflict, gone, rowLabel), `hosted.receivables.columns.date`, reworded `hosted.settle.honest` |
| QA stub | `qa/support/portalApi.ts` | PATCH `/v1/income/{id}` and `/v1/payments/{id}` with If-Match (409 VERSION_MISMATCH), `version` on stub receivables and payments, `capturedBy`; a `bumpVersion(id)` hook for the conflict spec |
| QA | `qa/features/portal/income.yaml`, `qa/specs/portal/income.spec.ts`, `qa/features/portal/expenses.yaml`, `qa/specs/portal/expenses.spec.ts` | the 7 ticket scenarios (§6) |
| Knowledge | CHANGELOG, COMPONENT_REGISTRY (RedateDrawer, HostedTable.linkColumn), PATTERNS (if any), TEST_PLAN, SYSTEM_OVERVIEW (portal row) | |

No server change; MUT-223 already ships every route this needs.

## 4. Tests (written first)

Unit (vitest, `src/hosted/**/__tests__`):
- `incomeAffordances.test.ts`: `canRedateOwed` and `canRedatePayment`. Owned true. Malafat-fed, firm, VOID,
  REVERSED, integration payment, and someone else's capture are all false.
- `filters.test.ts`: `?income=` / `?payment=` keep a uuid, drop a malformed id; `splitIncomeDrawer` separates them
  from the filters.
- `RedateDrawer.test.tsx`:
  - loads and shows the summary read-only;
  - the date input has `max` set to the profile's today;
  - Save PATCHes with If-Match at the loaded version and the right body key (`occurredOn` vs `receivedOn`);
  - 409 → refetch, the new value refills, the conflict notice shows, and saving again uses the new version;
  - 422 → inline error;
  - 404 → gone state;
  - Owed shows "due date stays as it is";
  - Arabic renders RTL labels.
- `HostedTable.test.tsx`:
  - `linkColumn` puts the row-link in that column; Enter and Space open it; there are no nested buttons;
  - `canOpen` false gives no row-link, no `clickable` class and no click handler;
  - with neither prop, existing tables are unchanged (regression: Expenses and Conversions tests stay green).
- `RedateDrawer.test.tsx` (R4):
  - a settled entry lists only payments whose allocations name it, with their dates, and a line opens `?payment=`;
  - none on the page shows the "See Payments" link;
  - an open (unpaid) entry makes no payments request.
- `ReceivablesList` / `PaymentsList` tests:
  - an owned profile opens `?income=` / `?payment=` on row click and Enter;
  - Record payment and the Payments expander don't open the redate drawer (stopPropagation);
  - a REVERSED payment row can't be opened;
  - a Malafat-fed profile has no `row-link` and no `clickable` class, so it looks unchanged (AC6);
  - the Date column shows `postingDate`.

Commands (Node 22): `npx vitest run src/hosted`, `npm run lint`, `npm run typecheck`, `npm run test:run`,
`npm run build`; then `release-qa run --attach --only <id>` per feature and `release-qa lint`.

## 5. Where the ticket text and the product differ (decisions for review)

- **AC1** "the list shows the new date (in the new month)": no list shows an Owed entry's own date, and there are no
  months. Plan: add a Date column (D3). "New month" then means a date in the previous month.
- **AC2** Received entries live in the Payments list as payments. Plan: the `?payment=` drawer (D2).
- **AC3** "the entry's paid date shows the new date" and "a settled entry's payment line": neither exists in the
  portal. Options in D4.
- **Ticket's "keyboard-reachable using row-link"**: Payments' first cell is taken by the expander, hence `linkColumn`
  (D5).

## 6. QA scenarios (release-QA, `portal` app)

`qa/features/portal/income.yaml` + one tagged test each in `qa/specs/portal/income.spec.ts`. Every feature's `paths`
include `RedateDrawer.tsx` plus the files it exercises:

| id | tier | steps | expect |
|---|---|---|---|
| `redate-owed` | secondary | open an Owed row, pick a date last month, save | the row's Date shows it; Due is unchanged; `?income` cleared |
| `redate-received` | secondary | open a Received payment row, change the date, save | the row's Received shows it |
| `redate-payment` | secondary | settle an Owed entry, open its payment row, change the date, save; reopen the entry | the payment's Received shows the new date; the allocation still points at the entry; the entry's drawer lists the payment with the new date |
| `redate-no-future` | secondary | open an entry, try tomorrow | the picker's max is today; a forced value is refused inline |
| `redate-conflict` | secondary | open an entry, the stub bumps its version, save | conflict notice, the date refills, saving again succeeds |
| `redate-malafat-readonly` | secondary | open a Malafat-fed profile's Receivables and Payments | no row-link and no `?income`/`?payment` drawer, even from a deep link |
| `redate-expense` (expenses.yaml) | secondary | open an expense, change its date, save | the list shows the new date |

## 7. Risks

- **MUT-221** (expense drawer never refetches after 409): don't copy ExpenseDrawer. Follow ConversionDrawer D6.
- **MUT-196** (If-Match from a re-read): send the version the drawer *showed*, never a fresh re-read.
- **Idempotent replays** (ADR-083): the drawer reads the version from GET, never from a create response.
- **A Malafat-fed profile reached by a deep link** renders nothing, the same way `IncomeDrawerHost` already gates
  `?settle`.
- **RTL:** dates via `formatDay`; `<bdi>` around numbers as the lists already do.

---

# Eng review (/plan-eng-review, 2026-10-15)

Target: `.claude/designs/mut-224-hosted-redate-portal.md` (§1–§7 above).

## Scope record
feature answers: none proposed (all 8 ACs + 7 QA scenarios kept); structure: A Original arrangement (D1, 2026-10-15);
accepted scope: plan §3's 18 files, one new component; pending remedies: R2–R5.
Scope Challenge result: scope accepted as-is.

## Decision ledger

### R2: Where a Received entry is re-dated
Finding: Arch #1, P2, conf 9, pages/views/PaymentsList.tsx (Received entries are payment rows; no portal "income row" exists), native.
Plan baseline: `?payment=` for every own capture payment (D2 in §5). The ticket text says "an income row … opens ?income=".
Runtime evidence: Receivables lists only receivables (Owed). Received captures appear only in Payments. PATCH /v1/payments accepts every own POSTED CAPTURE (MUT-223).
Grid: | R2 | pending | A: ?payment= drawer from Payments rows | B: also accept ?income=<paymentId> and route Received through PATCH /v1/income |
State: approved · Actual answer: A) ?payment= from Payments (D2, 2026-10-15) · Accepted scope: Receivables rows (Owed) open ?income= → PATCH /v1/income; Payments rows (own POSTED captures) open ?payment= → PATCH /v1/payments; a note on MUT-224 explains the mapping. · History: none

### R3: Show the Owed entry's own date in the Receivables list
Finding: Arch #2, P2, conf 9, ReceivablesList.tsx columns (Due only), native.
Plan baseline: add a Date column (`postingDate`) before Due (D3).
Grid: | R3 | pending | A: add Date column | B: no column; the new date is visible only inside the drawer |
State: approved · Actual answer: A) Add the Date column (D3, 2026-10-15) · Accepted scope: ReceivablesList gains 'Date' (postingDate via formatDay) before Due, en + ar; shows on Receivables and Client detail's Receivables tab. · History: none

### R4: AC3 "the entry's paid date shows the new date"
Finding: Arch #3, P2, conf 9, no paid-date UI exists; Receivable has no payment dates; no payments-by-receivable API filter, native.
Plan baseline: open (D4).
Grid: | R4 | pending | A: the ?income= drawer for a settled entry lists its payments by scanning GET /v1/payments?customerId (first page, 50), each line opening ?payment= | B: no new read; AC3 is met by the payment's Received date and its allocation line in Payments; note it on the ticket | C: server filter ?receivableId= (new server work, own ticket) |
State: approved · Actual answer: A) Scan client payments (D4, 2026-10-15) · Accepted scope: for a settled or partly paid Owed entry the ?income= drawer runs one GET /v1/payments?customerId=<client> (first page, limit 50), lists payments whose allocations name the entry with Received date and amount, each a button opening ?payment=; if none on that page, a 'See Payments' link to the client's Payments tab. · History: none

### R5: Make Payments rows keyboard-reachable
Finding: Arch #4, P2, conf 9, HostedTable.tsx:61-64 (row-link always wraps the first cell; onRowClick applies to every row), PaymentsList.tsx:89-103 (first cell is the expander button), native.
Plan baseline: `linkColumn` on HostedTable (D5).
Runtime evidence: a nested button would be invalid. onRowClick has no per-row opt-out, and REVERSED or other people's rows must not open. The expander and Record payment buttons would also bubble into the row click.
Grid: | R5 | pending | A: HostedTable gains `linkColumn` + `canOpen(row)`; inner buttons stopPropagation | B: no table change; a per-row "Change date" button in an end column on both lists |
State: approved · Actual answer: A) Extend HostedTable (D5, 2026-10-15) · Accepted scope: HostedTable gains linkColumn?: string and canOpen?: (row) => boolean; PaymentsList links 'received'; the expander and Record payment buttons stopPropagation; HostedTable tests cover both props. · History: none


Approval readiness: PASS (D1 structure A; R2–R5 each A, AskUserQuestion answers 2026-10-15. The hooks-unconditional
note and the dropped `markSaved` are factual corrections, not policy changes.)

## Review findings by section

**Scope Challenge:** 18 files, 1 new component. No smaller layout keeps the ACs (D1 = original).

**1. Architecture**
- `[P2] (conf 9) pages/views/PaymentsList.tsx`: there is no "income row". Received entries are payment rows → R2: `?payment=` drawer.
- `[P2] (conf 9) pages/views/ReceivablesList.tsx`: no entry-date column, so AC1 can't be seen → R3: Date column.
- `[P2] (conf 9)`: no paid date or payment line exists for an entry, and there's no API filter → R4: a bounded client-payments scan.
- `[P2] (conf 9) components/HostedTable.tsx:61-64`: row-link is first-cell-only and all-rows; Payments' first cell is the expander → R5: `linkColumn` + `canOpen`.
Dispositions: all accepted (A).

**2. Code quality**
- `[P3] (conf 8)` Factual correction: RedateDrawer must call `useReceivable` and `usePayment` unconditionally (rules of hooks), gated by `enabled`. `useReceivable` gains `enabled`.
- `[P3] (conf 8)` Factual correction: drop `markSaved`. Neither income list renders the row tint, so follow `IncomeCaptureDrawer` (close + focus).
- `[P3] (conf 7)` `IncomeDrawerHost` precedence when several params are present: `settle` → `newIncome` → `income` → `payment`. The first match renders and the rest are ignored, as today.
Dispositions: corrections folded in; no new policy.

**3. Tests**
```
CODE PATHS                                         USER FLOWS
[+] RedateDrawer(kind)                             [+] Fix an Owed date ........ [GAP→redate-owed, RTL]
  ├─ load (useReceivable|usePayment) [GAP→unit]   [+] Fix a Received date ..... [GAP→redate-received]
  ├─ save 200 → invalidate+close [GAP→unit]        [+] Fix a settle payment .... [GAP→redate-payment]
  ├─ 409 → refetch+refill+notice [GAP→unit+QA]     [+] Stale edit .............. [GAP→redate-conflict]
  ├─ 422 → inline [GAP→unit]  404 → gone [GAP]     [+] No future date .......... [GAP→redate-no-future]
  └─ settled → payment lines / fallback [GAP→unit] [+] Malafat-fed unchanged .... [GAP→redate-malafat-readonly]
[+] HostedTable linkColumn/canOpen [GAP→unit; regression: Expenses/Conversions tests]
[+] canRedateOwed/canRedatePayment [GAP→unit]      [+] Expense re-date ......... [GAP→redate-expense]
[+] filters ?income/?payment [GAP→unit]
COVERAGE: 0/17 today (new code); 17/17 specified in §4/§6 at ★★★
```
Artifact: `~/.gstack/projects/vAWK3-mutaba3a/basel-main-eng-review-test-plan-20261015-190935.md`. Tests to retire: none.

**4. Performance:** No issues. RedateDrawer reads one record (staleTime 0, the conflict rule needs it fresh). R4 adds
one paged read (limit 50), only when a settled entry's drawer opens. Saves invalidate existing prefixes only.

**Outside voice:** unavailable (Codex CLI not installed; native fallback lacks TaskOutput/TaskStop). Logged.

**TODOS.md:** none proposed.

## NOT in scope
- Changing amount, client, matter or note; reversing a payment (TD-126).
- A server `GET /v1/payments?receivableId=` filter (R4 option C, not chosen).
- After-save row tint on the income lists (would need flash wiring in both lists; not asked for).

## What already exists
`ConversionDrawer` 409/refill pattern, `useAttemptKey` (not needed for PATCH), `incomeAffordancesFor`, `IncomeDrawerHost`,
`HostedTable` row-link, `todayInZone`, `formatDay`, `DecimalAmount`, `request()` If-Match, and the portal QA stub (gains two PATCH routes).

## Failure modes
| Path | Failure | Covered | User sees |
|---|---|---|---|
| Save | edited elsewhere (409) | unit + redate-conflict | conflict notice, refilled date |
| Save | deleted/undone elsewhere (404) | unit | "no longer available" |
| Open | deep link on Malafat-fed or someone else's row | unit + QA | nothing opens |
| R4 scan | payment beyond the first 50 | unit (fallback) | "See Payments" link |
Critical gaps: 0.

## Worktree parallelization strategy
Sequential implementation, no parallelization opportunity (one module, `src/hosted`, plus its QA stub).

## Implementation Tasks
- [ ] **T1 (P2, human ~2h / CC ~15m)** — HostedTable — `linkColumn` + `canOpen` with tests (R5). Files: components/HostedTable.tsx (+test). Verify: `npx vitest run src/hosted/components`
- [ ] **T2 (P2, human ~3h / CC ~20m)** — RedateDrawer payment lines + fallback (R4). Files: RedateDrawer.tsx, incomeQueries.ts. Verify: RedateDrawer tests
- [ ] **T3 (P2, human ~30m / CC ~3m)** — Receivables Date column (R3). Files: ReceivablesList.tsx, en/ar.json. Verify: list tests + redate-owed
- [ ] **T4 (P3, human ~10m / CC ~2m)** — Note on MUT-224: the ?income/?payment mapping (R2), the Date column (R3) and how AC3 is met (R4).

## Unresolved decisions
None.

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is
- Architecture Review: 4 issues found
- Code Quality Review: 3 issues found
- Test Review: diagram produced, 17 gaps identified (all new code, all specified)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (CLI not installed)
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 2/2 (D3 and D4 picked their highest-coverage approved option; D1, D2, D5 differ in kind)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex via `/plan-eng-review` | Independent 2nd opinion | 1 | unavailable | CLI not installed; no coverage |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open (all resolved) | 7 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | not run; UI work (drawer, Date column), consider before build |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable (CLI not installed). No coverage.
- **VERDICT:** Eng Review: 7 issues, all resolved in the plan (D1–D5 approved, 3 factual corrections). Ready to implement. A design review is optional for the drawer UI.

NO UNRESOLVED DECISIONS
