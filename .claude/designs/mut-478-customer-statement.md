# MUT-478 — Customer statement (ledger card) with a running balance, and receivable numbers

Status: PLAN (eng-ticket, 2026-10-27). Not built. Jira Backlog → Planned.
Tracker: Jira · barmajiyat · MUT via atlassian-barmajiyat · Backlog → Planned (this skill) → In Progress (eng-build) → In Review (qa-reconcile).

## Neighborhood
- Epic MUT-25 (Mutaba3a as Malafat's money core). No formal blockers.
- Blocks **MAL-1425** (client money page as a כרטסת), and through it MAL-1427 (export the ledger).
- **MUT-481** (Backlog): `receiptNumber` on payments, shown on PAYMENT lines. Not a blocker: this ticket ships PAYMENT lines with `paymentNumber` (`PAY-YYYY-NNNN`) and leaves `receiptNumber` to MUT-481, which adds it as an additive field on the line.
- **MUT-444** (Backlog): agreement correction (credit in full, repost). Nothing to build here for it: its credits and reposts are ordinary CREDIT and CHARGE rows, so they show up as such. The AC "a MUT-444 correction shows as full credits then reposts" is proved with a hand-built ledger (credit in full + new receivable) until MUT-444 lands.
- **MUT-480** (lower the fee) adds `reasonCode` on credits. If MUT-480 merges first, CREDIT lines carry it; otherwise MUT-480 adds it to the line (D7).
- **MUT-9** (the app's own statement export): out of scope.
- **MUT-453** (owner reverse/credit): reversal keeps allocation rows (`prisma.ts:2742`), which is what the project statement's reversal lines read.

## Where the code is today
- `GET /v1/summaries/customers/{customerId}` (`server/src/routes/summaries.ts:92-136`): `postDueItems`, then `listAll` over receivables and POSTED payments for the customer, buckets via `summaries/compute.ts` (`bucketize`, `countsOn`, `unallocatedOf`). The statement has to agree with this figure (AC1), so it reuses `countsOn` and `outstandingOf`.
- Receivables: `Receivable` (`schema.prisma:930`) has no number. Created at three places in `repositories/prisma.ts`: `:1436` installment post (which also posts a contingency commission, through `postInstallment`), `:1602` retainer charge, and `:3279` `createAdjustmentTx`. In memory they're created once, at `memory.ts:2097`.
- Payment numbers: `PaymentCounter` + `payments/numbering.ts` (`PAY-YYYY-NNNN`, year of `receivedOn`, gap-free, counter upsert in the posting transaction, `prisma.ts:3255`).
- Credits: `ReceivableCredit` (`receivableId`, `amountMinor`, `reason`, `effectiveDate`). There's no per-customer read today; `listCredits` is per receivable.
- Payment reversal: `status REVERSED`, `reversedAt` (instant), `allocatedMinor` zeroed, allocation rows kept.
- Local mode runs `MemoryLedgerStore` in the browser (`src/hosted/local/index.ts:47`). Its snapshot format is versioned (`LOCAL_FORMAT_VERSION`, `src/hosted/local/migrations`), and the hosted export selects explicit columns (`repositories/prisma-records-export.ts`).
- `API_VERSION = '1.80.0-mut461'` (`server/src/app.ts:270`).

## Decisions (D1 APPROVED by Basel 2026-10-27; D2–D9 recommended defaults)

**D1 — Receivable number format: `CHG-YYYY-NNNN`**, gap-free per organization and year of `postingDate`, from its own counter row in the posting transaction (same as payments). Backfill orders by `(postingDate, postedAt, id)` within each organization and year. Alternative: one sequence with no year (`CHG-000123`). Rejected because it reads differently from `PAY-`. Every receivable gets a number, including a personal profile's Owed (the ticket says every receivable).

**D2 — A capture the person undid (`reversalReason = capture_undo`, MUT-61) is left out of the statement**, both its PAYMENT and REVERSAL lines. It was a mistake taken back, not money that came and went. Every other reversal shows both lines (the ticket's "nothing is netted away"). They net to zero either way, so AC1 holds both ways.

**D3 — The statement is computed in memory per request, then paged.** The store returns the customer's rows for one currency in a fixed number of queries (no N+1). A pure `buildStatement()` orders them, folds the lines before `from` into the opening balance, cuts after `to`, runs the balance, and slices the page after the cursor. Running balance across pages and an `openingBalance` that belongs to the period (not the page) both fall out of computing the whole period every time. Cost: the same as the customer summary, which already loads all of a customer's receivables and payments. A customer with 1,000 lines is about 4 queries and a few hundred KB in memory. TD row: move to SQL window functions if one customer passes ~20k lines.

**D4 — `totals` and `closingBalance` belong to the period, not the page.** Every page returns the same `openingBalance`, `totals` and `closingBalance`, and only `lines` and `nextCursor` change. Malafat's totals row reads them once. The ticket's paging AC reads that way, but confirm.

**D5 — Which rows count.** CHARGE: receivables with `deletedAt` null that `countsOn(r, asOf)` (an Owed dated ahead appears on its day, as in the summary). PAYMENT: payments with this customer and currency, POSTED or REVERSED (D2 aside). With no `to`, lines dated after `asOf` are included (a future-dated posting, a payment with a future `receivedOn`), so the closing balance equals the summary's figure, which counts them too.

**D6 — Line dates and the tie-break.** CHARGE = `postingDate`; CREDIT = `effectiveDate`; PAYMENT = `receivedOn`; PAYMENT_REVERSAL = the organization calendar date of `reversedAt` (`todayFor(org, reversedAt)`). Sort `(date, createdAt, kindRank, id)`, where the reversal line's `createdAt` is `reversedAt` and `kindRank` keeps a PAYMENT before its own REVERSAL on the same day. Line `id` is the source row id (receivable, credit, payment, allocation), and the reversal line's id is `<paymentId>:reversal`. The cursor encodes the sort key of the last line returned.

**D7 — The credit reason on a line is `reason` (free text) plus `reasonCode` when the row has one.** `reasonCode` is MUT-480's column. If MUT-480 isn't merged yet, this ticket returns `reason` only and MUT-480 adds `reasonCode` to the line.

**D8 — Project statement.** It covers the project's receivables and their credits, plus one PAYMENT line per allocation to those receivables, dated by the payment's `receivedOn` and carrying only the allocated amount. A reversed payment adds a REVERSAL line per allocation. A payment's own `projectId` with no allocation (a capture's "matter") doesn't put it on the project statement, which matches the ticket: unallocated money appears only in the whole-customer statement.

**D9 — Auth:** API key, session and device session, scope `payments:read` (as `GET /v1/receivables`). It's a read, so local mode gets it for free, and the portal can use it later without another contract change.

## API
`GET /v1/customers/{customerId}/statement?currency=ILS&projectId=&from=&to=&limit=200&cursor=`
- 422 `VALIDATION` when `currency` is missing or `from > to`. 404 for an unknown customer or another organization's. 422 `PROJECT_NOT_FOUND` when `projectId` isn't this customer's project (same code as fee proposals).
- Response (`CustomerStatementSchema`):
  `{ customerId, currency, projectId|null, from|null, to|null, asOf, openingBalance, totals: {debit, credit}, closingBalance, lines: StatementLine[], nextCursor|null }`
- `StatementLine` is a discriminated union on `kind`:
  - Common fields: `id`, `kind`, `date`, `number|null`, `projectId|null`, `debit`, `credit`, `runningBalance`.
  - **CHARGE:** `receivableId`, `origin` = `{type: INSTALLMENT, agreementId, position, of} | {type: RETAINER_CHARGE, agreementId, serviceMonth} | {type: CONTINGENCY_FEE, agreementId} | {type: ADJUSTMENT, title}`, plus `dueDate`, `net`, `vat`, `gross`, `outstanding`, `status`, `daysOverdue|null`.
  - **CREDIT:** `receivableId`, `receivableNumber`, `reason`, `reasonCode|null` (D7).
  - **PAYMENT:** `paymentId`, `method`, `reference|null`, `unallocated` (whole-customer statement only), `allocated` (project statement).
  - **PAYMENT_REVERSAL:** `paymentId`, `paymentNumber`, `reason`.
- `number` is the receivable number on a CHARGE, the payment number on PAYMENT and REVERSAL lines, and null on a CREDIT.
- `status` and `daysOverdue` come from the same helper `serializeReceivable` uses, against `asOf`.
- `GET /v1/receivables` and every receivable read gain `number` (additive).

## Files
Server (`server/`):
- `prisma/schema.prisma` + migration `2026xxxx_mut478_receivable_numbers`:
  - `receivables.number VARCHAR` with `@@unique([organizationId, number])`.
  - A `receivable_counters(organizationId, year, next)` table.
  - The backfill runs in SQL in the same migration: `ROW_NUMBER() OVER (PARTITION BY "organizationId", left("postingDate",4) ORDER BY "postingDate","postedAt",id)`, then counters seeded from the max, then `SET NOT NULL`.
  - Migration test: an existing database with receivables across two years and two orgs gets unique, ordered numbers.
- `src/payments/numbering.ts` → generalise to `ledgerNumber(prefix, year, seq)`; `paymentNumber` and new `receivableNumber` call it (DRY, one rule).
- `src/repositories/prisma.ts`: one `nextReceivableNumberTx(tx, org, postingDate)` called at the three receivable creation sites (`:1436`, `:1602`, `:3279`). A future-dated posting takes its number from its own year's sequence. `memory.ts`: the same through one helper used by its single creation path. Contract test: every creation path yields a number, and the numbers are gap-free.
- `src/repositories/ports.ts`: `ReceivableRecord.number`. New `receivables.statementSources(orgId, customerId, currency, projectId?)` returns `{ receivables, credits, payments, allocations, installmentsByReceivable, chargesByReceivable }`, at most 6 queries in Prisma and none of them per row. It gets a memory twin and a contract test shared by both stores.
- `src/statements/build.ts` (new, pure, no store, no clock): `buildStatement({ rows, view: {from, to, projectId, asOf}, page: {limit, cursor} })` → the response figures. Table-driven tests (PATTERNS "money math is pure and tabular").
- `src/routes/customers.ts` (or a new `routes/statements.ts` registered beside it): the route, `postDueItems` first (as summaries), then `statementSources` → `buildStatement` → serialize.
- `src/schemas.ts`: `CustomerStatementQuerySchema`, `CustomerStatementSchema`, `StatementLineSchema`; `ReceivableSchema.number`. `src/serializers.ts`: `serializeReceivable` gains `number`.
- `src/app.ts`: `API_VERSION = '1.81.0-mut478'` (or the next free minor at merge) plus the description bullet. Update the pinned version literals in the route tests, then `npm run openapi:generate`.
- `repositories/prisma-records-export.ts`: select `receivables.number`.

Local mode (`src/hosted/local/`):
- `MemoryLedgerStore` snapshot gains `receivable.number` and the counter map. Bump `CURRENT_STORE_SNAPSHOT_VERSION` (`server/src/repositories/memory.ts:201`, currently 8; `LOCAL_FORMAT_VERSION` follows it) to the next free number at merge, because MUT-480 and MUT-479 bump it too. Add a migration that numbers existing receivables in the same order as the SQL backfill. Update `format-fingerprint.test.ts` and the `everyRecord` helper, and check the `parity.test.ts` and hosted-export parity tests.

## Tests (written first)
Unit, `npm --prefix server test -- statements receivable-numbers`:
- `src/statements/__tests__/build.test.ts` (tables):
  - opening + debits − credits = closing for random periods;
  - each running balance follows from the line before;
  - order is stable on equal dates;
  - a page boundary carries the balance across, and every page has the same opening balance and totals;
  - `from` folds earlier lines into the opening balance, and `to` cuts later ones;
  - REVERSAL comes after its PAYMENT on the same day;
  - a capture undo is excluded (D2);
  - a project view shows allocations only (D8).
- `src/__tests__/customer-statement.route.test.ts` (in-memory store, `createApp`), one test per acceptance criterion:
  - AC1: closing = summary outstanding − unallocated, over a fixture with installments, a retainer, an Owed, a future-dated Owed, credits, a partial payment, an unallocated payment and a reversal;
  - AC2: the period identity;
  - AC3: a MUT-444-shaped correction (credit in full + new receivable) moves the balance by exactly the difference;
  - AC4: a reversed payment's two lines net to zero;
  - AC5: a payment split across two projects;
  - AC6: 422 without a currency, 404 for another organization's customer;
  - AC7: unique numbers after a backfill;
  - AC8: 1,000 lines across 5 pages, identical order on a second run;
  - an API key from another organization gets 404.
- Store contract (`repositories/__tests__/`): `statementSources` returns the same thing from both stores, and receivable numbers are gap-free across concurrent posts (Postgres `test:db`).
- Local mode: the format migration numbers old snapshots, and a records file from the previous format imports.

Verify: `npm --prefix server run typecheck && npm --prefix server run lint && npm --prefix server run openapi:check && npm --prefix server test`, then root `npm run typecheck && npm run test:run` (local-mode tests). Run all of them through `heavy`, under Node 22.

## Release-QA
No Mutaba3a UI. Add `qa/features/portal/malafat-money-api.yaml` (area `malafat-money-api`) mapping `server/src/statements/**` and the route. Feature `statement` covers: seed a customer with charges, a credit, a payment and a reversal, call the statement with the QA API key, and expect the lines and balances. The spec is `qa/specs/portal/malafat-money-api.spec.ts`, using Playwright `request` against the QA API with the seed's integration key. If the QA seed has no integration key fixture, adding one is build step 1. Malafat's own `web.money.client-ledger` (MAL-1425) covers the screen.

## Knowledge
- ADR-217 (ADR-216 went to MUT-462): receivable numbers `CHG-YYYY-NNNN` and the statement as a computed read (D1, D3, D4, D6).
- PATTERNS: "a ledger is computed, never stored: one pure builder over the source rows".
- TD row: in-memory statement past ~20k lines.
- CHANGELOG, TEST_PLAN, and SYSTEM_OVERVIEW (API surface).

## Scope check
Covers all 9 ACs. Not included: PDF/CSV export (MUT-9, MAL-1427), Mutaba3a UI, mixed-currency statements, `receiptNumber` (MUT-481).
Gap found: the ticket says "the receipt number (see the receipt-number ticket)" on PAYMENT lines. That arrives with MUT-481, not here (noted in Neighborhood).

## Business / product impact
- Malafat can show a partner the balance a client actually owes, line by line, in the shape their accountant reconciles against. Today that's three lists Malafat isn't allowed to add up (Malafat ADR-150).
- It's the centrepiece of the Money overhaul (MAL-1410): it unblocks MAL-1425 and, through it, the ledger export (MAL-1427).
- Low risk: it's a read plus an additive number. The one migration (the backfill) is tested on a copy of history before release.
