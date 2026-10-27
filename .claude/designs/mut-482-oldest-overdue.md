# MUT-482 — The oldest overdue due date per customer in the summaries

**Platforms:** API only (consumer: Malafat MAL-1366). No portal UI, no Flutter.
**Jira:** MUT-482 (Story, epic MUT-25), Backlog → Planned. Blocks MAL-1366 (Idea, under MAL-1410).

## Neighborhood
- **MUT-470** (Backlog, filed 10:15 the same day) is the same field with an older name (`oldestOverdueOn`), org summary only, no `daysOverdue`. MUT-482 is the later owner ruling (J5) and covers more. **Close MUT-470 as a duplicate of MUT-482** (D1). Its one extra AC is kept here: the date follows the same overdue rule as the `overdue` bucket, so the two never disagree.
- **MUT-488** (merged 8efa7edf): the customer summary now totals a matter's other-currency Owed in that currency's block. This plan builds on that: a block's oldest date comes from the same receivables its buckets come from.
- **MUT-478** (In Review, branch unmerged, API 1.81.0-mut478): also touches the summaries and bumps API_VERSION. No overlap in code; take the next free version at merge.
- **MUT-483** (Backlog): firm period totals, a different endpoint. No overlap.
- **TD-103** (MUT-129): the customer summary already runs about 3P + A queries. This ticket adds none.
- Malafat ADR-150: Malafat may not do money arithmetic or work out dates from receivables, so the API supplies the date and the day count.

## Where the code is today
- `server/src/routes/summaries.ts`
  - org summary: one `receivables.list(OPEN)` for the firm, then each customer row runs `bucketize(recs.filter(customerId), today)` in memory (l.69–77).
  - customer summary: a block's buckets = its projects' `projectFigures` buckets (receivables in the project currency) + `outsideRows` in that currency (no project, or another currency than the project's, MUT-488) (l.125–137).
- `server/src/summaries/compute.ts` `bucketize` (l.50): OPEN, `countsOn`, outstanding > 0, then `dueDate < today` is overdue.
- `server/src/schemas.ts` `CustomerSummaryRowSchema` (l.2590), `CustomerCurrencySummarySchema` (l.2723).
- `server/src/dates.ts` `daysBetween` (l.72) already exists.
- Local mode (`src/hosted/local/`) runs these same routes in the browser, so it gets the fields at no cost.

## Decisions (D1 and D2 approved by Basel 2026-10-27; the rest are the reviewed defaults)
- **D1 — names.** Use MUT-482's: `oldestOverdueDueDate: IsoDate | null` and `daysOverdue: integer ≥ 1 | null`. Both null together. Close MUT-470 as a duplicate.
- **D2 — one overdue rule.** Pull the per-receivable classification out of `bucketize` into `dayBucketOf(r, today): 'overdue' | 'dueToday' | 'notYetDue' | null` (null = settled, doesn't count yet, or nothing outstanding). `bucketize` and a new `oldestOverdueDueDate(receivables, today)` both call it. The date and `overdue > 0` then can't disagree. `Buckets` itself is not changed: a date in an amount struct would touch every `projectFigures` and `toEqual` test and the project wire for no gain.
- **D3 — customer summary set.** A block's date is computed over all of the customer's receivables in that block's currency. That is exactly the union its buckets are built from (projects in that currency + `outsideRows` in that currency), because every receivable falls into one of the two. The tests assert the invariant (D2) on this endpoint too, so a future split of the sets can't drift quietly.
- **D4 — partial payment.** A receivable that is part paid and still overdue keeps its date (it is still late). Paid or credited in full, it drops out (AC2). A reversed payment that reopens it brings the date back.
- **D5 — scope.** The fields go on the org summary's customer rows and the customer summary's currency blocks only. Not on the org-level currency block and not on project rows: the ticket doesn't ask for them, and they can be added later as additive fields.
- **D6 — contract.** Additive fields, minor API_VERSION bump (next free at merge; `1.82.0-mut482` against today's `1.81.0-mut462`). No migration, no store snapshot bump (nothing stored changes).

## API
`GET /v1/summaries/organization` → `currencies[].customers[]` gains:
```
oldestOverdueDueDate: "2026-06-01" | null   // earliest dueDate among this customer's OPEN, counting, overdue receivables in this currency
daysOverdue: 148 | null                     // daysBetween(oldestOverdueDueDate, asOf)
```
`GET /v1/summaries/customers/{id}` → `currencies[]` gains the same two fields.
The route descriptions say: same rule as `overdue`; null exactly when `overdue` is 0; counted in the organization's timezone against `asOf`.

## Files
Two commits: first the behaviour-preserving `bucketize` → `dayBucketOf` refactor, with the existing `describe('buckets')` suite (`compute.test.ts:10-35`) unchanged as its regression contract; then the feature (eng review R1).
- `server/src/summaries/compute.ts`: `dayBucketOf`, `oldestOverdueDueDate`; `bucketize` refactored onto `dayBucketOf` (behaviour unchanged).
- In the org route, filter a customer's receivables once (`summaries.ts:70`) and pass the same array to `bucketize` and `oldestOverdueDueDate` (eng review R2).
- `server/src/routes/summaries.ts`: an `overdueSinceWire(date, today)` helper → `{ oldestOverdueDueDate, daysOverdue }`, spread into the org row and the customer block; two description lines.
- `server/src/schemas.ts`: an `overdueSinceFields` const (documented), added to `CustomerSummaryRowSchema` and `CustomerCurrencySummarySchema` only, never to `bucketFields` (`schemas.ts:2582`), which the org-level block and project rows share (D5).
- `server/src/app.ts`: API_VERSION bump.
- `server/openapi/openapi.yaml` (`npm --prefix server run openapi:generate`), `src/hosted/api/schema.d.ts` (`npm run hosted:types`).
- `docs/` Malafat-facing API notes, if the summaries are described there (check `docs/architecture` at build time).

## Tests (written first)
- `server/src/summaries/__tests__/compute.test.ts`:
  - `dayBucketOf`: overdue / dueToday / notYetDue / null for SETTLED, outstanding 0, and a future-dated ADJUSTMENT not yet counting (MUT-392);
  - `oldestOverdueDueDate`: earliest of several; ignores due today, not yet due, settled, fully credited; a part-paid overdue keeps its date; empty → null;
  - property: over a mixed fixture, `oldestOverdueDueDate(rs) === null` ⇔ `bucketize(rs).overdue === 0n`.
- `server/src/__tests__/routes-m6.test.ts` (it already seeds overdue installments with a fixed clock), new `describe('MUT-482 oldest overdue')`, with `h.clock.now = new Date('2026-10-27T10:00:00Z')` (the harness default is 2026-10-20, `routes-m6.test.ts:26`):
  - **AC1:** receivables due 1 Jun and 1 Sep, clock 27 Oct → row and customer block report `2026-06-01`, `daysOverdue` 148;
  - **AC2:** settle June in full → `2026-09-01`, 56; a part payment on June leaves `2026-06-01`;
  - **AC3:** a customer whose only Owed is not yet due, and a fully settled customer → both null; the row's `overdue` is "0.00";
  - multi-currency: ILS overdue since June, USD since September → each block has its own date; MUT-488 case: a USD Owed on an ILS matter appears in the customer's USD block date;
  - **AC4:** in the test only, wrap the `MemoryLedgerStore` in a `Proxy` that counts repository calls (no production seam). Read the org summary for a firm with 1 customer and then 5 overdue customers: the count doesn't grow with the customer count. (eng review R3, D3 = A).
- **AC5:** API_VERSION bumped; `openapi:check` passes after the regenerate (the yaml's `info.version` comes from API_VERSION).
- Local-mode parity (`src/hosted/local/__tests__/parity.test.ts`) passes unchanged; add one overdue receivable to its fixture so the new fields are compared.

Verify through `heavy`, under Node 22: `npm --prefix server run typecheck`, `lint`, `openapi:check`, `test`; root `npm run test:run` (parity) and `npm run typecheck` (schema.d.ts). CI runs `test:db`.

## Release-QA
Feature `overdue-since` in `qa/features/portal/malafat-money-api.yaml` (MUT-478 creates the file; whichever lands first creates it), `tier: extended`, `paths: server/src/summaries/compute.ts, server/src/routes/summaries.ts`.
- Steps: with the QA integration key, seed a client with Owed due 1 Jun and 1 Sep, read the organization summary, settle June, read again.
- Expect: `2026-06-01` then `2026-09-01`, `daysOverdue` counted against `asOf`.
Spec in `qa/specs/portal/malafat-money-api.spec.ts`, Playwright `request`, tagged `@portal.malafat-money-api.overdue-since`. Malafat's MAL-1366 specs cover the screen.

## Knowledge
- ADR (next free): "A customer's overdue-since date comes from the same rule as the overdue bucket (`dayBucketOf`)".
- PATTERNS: classify a receivable once (`dayBucketOf`); every figure that depends on overdue reads it.
- CHANGELOG, TEST_PLAN, SYSTEM_OVERVIEW (summaries section, one line).
- No TD added. TD-103 unchanged.

## Scope check
Covers all 5 ACs, plus MUT-470's "same rule" AC. Out of scope: org-level and project-level dates (D5), any portal or phone display.
Gaps in the ticket:
- it doesn't say what a part-paid overdue receivable does (D4: keeps its date);
- it doesn't say whether the customer summary's date includes a matter's other-currency Owed (D3: yes, in its own currency, per MUT-488);
- MUT-470 duplicates it (D1).

## Business / product impact
- Malafat's Money overview can put the client who has been late longest at the top ("overdue since 1 Jun · 148 days") from its one organization-summary call, with no arithmetic in Malafat (ADR-150) and no call per client across 300+ clients.
- It is the only API blocker on MAL-1366, the first screen of the Money overhaul (MAL-1410).
- Small, additive, no migration: low release risk, and it ships with whichever API release comes next.

## Eng review (plan-eng-review, 2026-10-27)
Scope Challenge: 4 source files changed (`compute.ts`, `summaries.ts`, `schemas.ts`, `app.ts`) plus 2 generated files, and no new classes or services. That is under the complexity gate, so scope is accepted as-is.

Findings:
- R1 [INFORMATIONAL] (confidence 7/10) `server/src/summaries/compute.ts:50`: moving `bucketize` onto `dayBucketOf` changes a core money helper that the org, customer and project summaries and the verdict all read. The existing `describe('buckets')` suite (`compute.test.ts:10-35`: overdue / due today / not yet due, settled, MUT-392 future Owed) is the regression contract and stays unchanged. Make the refactor its own commit. **Folded in.**
- R2 [INFORMATIONAL] (confidence 6/10) `server/src/routes/summaries.ts:70` `bucketize(recs.filter((r) => r.customerId === customerId), today)`: filter once and pass the same array to both helpers. **Folded in.**
- R3 [INFORMATIONAL] (confidence 7/10): AC4 has no existing query-count harness (no `queryCount` / counting store in `server/src`). A test-only `Proxy` over `MemoryLedgerStore` gives a real regression check with no production seam. **Folded in.**
- D3 verified (confidence 8/10): `summaries.ts:126` `outsideRows` (`projectId === null || r.currency !== projectCurrency.get(r.projectId)`) plus `summaries.ts:308` `inCurrency` (`r.currency === project.currency`) together cover every receivable of the customer in a block's currency, so the date and `overdue` come from the same set.
- Not a finding: the retired `/app` had an "oldest overdue" on Clients (MUT-7, e252957d; the `clients.index.oldestOverdue` i18n key survives). The portal could show this field later. That is a separate ticket, not this one.

Reality:
- REALITY: premise-table pass, unverified=0: daysBetween exists (`dates.ts:72`), countsOn rule (`compute.ts:45`), schemas (`schemas.ts:2590`, `:2723`), local mode reuses the routes (`src/hosted/local/createLocalApp.ts`).
- REALITY: already-done pass: there are no commits for MUT-482, MUT-470 or oldestOverdue on the server; the last summaries change is MUT-488 d2b8de9f (`server/src/routes/summaries.ts`).
- REALITY: surface-check pass: `openapi:generate`, `openapi:check` (`server/package.json:28-29`) and `hosted:types` (`package.json:25`) all exist.
- REALITY: binding-decisions pass: the recent decisions (MUT-484/471/463/464/458) don't touch the summaries; ADR-004 and ADR-150 hold.
- REALITY: numbers pass: 148 and 56 days, 1 Jun and 1 Sep to 27 Oct 2026 [measured: python date diff].
- REALITY: deferred-asks pass: all 5 ACs are covered. The org-level and project-level dates are left out because the ticket doesn't ask for them (D5).
- REALITY: pr-count pass: one branch, two commits (refactor, then feature), local merge (no PRs in this repo's flow).

Outside voice (Codex not installed; native subagent, read-only): no CRITICAL findings. It confirmed D3 (confidence 9), D4 (`ReceivableStatus` is only OPEN | SETTLED, `ports.ts:603`; a reversal decrements `paidMinor`, `memory.ts:2008`), `daysBetween` ≥ 1 with no DST issue, and that local mode and parity pick the fields up (`parity.test.ts:117-118`). Folded in: the test clock must be 27 Oct; the fields stay out of `bucketFields`. It also noted that `client.ts:47` re-exports `CustomerSummaryRow`, so `schema.d.ts` must be regenerated (already planned), and that whoever lands second must merge `malafat-money-api.yaml`, not overwrite it. It challenged R3 (a pinned call count is brittle) and D2 (the refactor is more than needed). Both go to Basel below.

## Decision ledger
### D1: field names and MUT-470
Plan baseline: MUT-482's names; close MUT-470 as a duplicate. State: approved. Actual answer: A (Basel, 2026-10-27). Accepted scope: `oldestOverdueDueDate` + `daysOverdue`; MUT-470 closed as a duplicate. Options: A) MUT-482 names, close MUT-470 (recommended); B) MUT-470's `oldestOverdueOn`, keep MUT-470 as the ticket.
### D2: how the one overdue rule is shared
Plan baseline: refactor `bucketize` onto `dayBucketOf`. State: approved. Actual answer: A (Basel, 2026-10-27). Accepted scope: the `dayBucketOf` refactor in its own commit, with the bucket tests unchanged. Options: A) `dayBucketOf` refactor, with the existing bucket tests as the guard (recommended); B) a standalone 8-line loop plus a property test that it agrees with `bucketize`, leaving `bucketize` untouched.
### D3: AC4 proof depth
Plan baseline: a test-only counting `Proxy`. State: approved. Actual answer: A (Basel, 2026-10-27). Accepted scope: an org-summary call count that is equal for 1 and 5 overdue customers, with no pinned absolute count. Options: A) a scaling assertion: the org summary's store-call count is the same for 1 and 5 overdue customers, with no pinned absolute count (recommended); B) no test; the helpers are pure and take no store, so AC4 holds by construction.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|---|---|---|---|---|---|
| Eng review | /eng-ticket MUT-482 | plan before build | 1 | CLEAR | 3 informational, folded in (R1–R3); 3 decisions approved (D1–D3) |
| Outside voice | default-on | independent challenge | 1 (native subagent; Codex not installed) | CLEAR | 0 critical; 2 challenges, settled by Basel's D2/D3 answers |

VERDICT: CLEARED for /eng-build MUT-482.
OUTSIDE COVERAGE: native Claude subagent only, no cross-model review.

NO UNRESOLVED DECISIONS
