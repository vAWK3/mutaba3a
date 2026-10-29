Status: BUILT (2026-10-29) on `feature/mut-483-period-totals`, not merged; plan APPROVED by Basel 2026-10-29. Build notes B1–B6 at the end.

# MUT-483 — Hosted API: firm period totals (billed, received, credited) readable with an API key

Plan 2026-10-29. Basel answered D1–D5 on 2026-10-29. An independent eng review the same day found no CRITICAL or HIGH issues; its R1–R12 are folded into the body below, and where they differ, §14 wins. Built the same day; where the build differs from the body, §15 records it.
Branch `feature/mut-483-period-totals` (worktree `.claude/worktrees/mut-483`). API `1.90.0-mut483` (now `1.89.0-mut444`), ADR-227, TD-291.

## 1. Problem and acceptance criteria

Owner ruling 2026-10-27 (Malafat Money overhaul MAL-1410, J5-4): at month end the partner checks the month with the accountant: how much was billed, how much came in, how much was credited. An API key can't read any figure over time today. `/v1/summaries/activity` and `/verdict` are session-only, and Malafat may not add up receivables and payments itself (Malafat ADR-150).

This blocks **MAL-1428** "Month summary" (status Idea). That sheet shows "billed · received · credited · how much owed changed, all from MUT-483" for a chosen month and currency, and "nothing is computed in Malafat".

Scope in: `GET /v1/summaries/period?from&to&currency`, readable with an API key. Per currency it returns `billed` (gross of the receivables posted in the period), `received` (payments received in the period, minus reversals in it), `credited` (credits effective in the period), and the balance at the start and the end.

- **AC1** Billed, received and credited for a month match the statement lines for the same month, summed across customers.
- **AC2** end − start = billed − received − credited (named `closingBalance − openingBalance`; D2).
- **AC3** It needs the `summaries:read` scope.
- **AC4** The OpenAPI contract version is bumped.

## 2. Where the code is today

- **Statement (ADR-217, MUT-478).** In `server/src/statements/build.ts`, `ledgerLines()` decides which lines exist and how each is dated. `buildStatement()` sorts them, folds the lines before `from` into `openingMinor`, cuts the lines after `to`, and computes `totals` and `closingMinor`. It covers one customer in one currency. It reads `receivables.statementSources(org, customer, currency)`: six queries in one REPEATABLE READ (`prisma.ts:1730`, `memory.ts:2042`). The route (`routes/customers.ts:231`) runs `postDueItems` first and needs `payments:read`.
- **Summaries (`routes/summaries.ts`).** `/organization`, `/customers/{id}` and `/projects/{id}` take API keys with `summaries:read`. `/activity` and `/verdict` are `SESSION_ONLY`. `reportRange()` in the same file is the Reports range rule: it defaults to this month, accepts real dates inside the money-date floor and ceiling, refuses with `END_BEFORE_START`, caps at `ACTIVITY_RANGE_MAX_MONTHS` (13), and refuses longer ranges with `RANGE_TOO_LONG`.
- **One definition per figure (ADR-033, ADR-219).** `summaries/compute.ts` holds `countsOn` (MUT-392: a dated-ahead Owed counts from its day, or from when money lands on it), `outstandingOf` and `unallocatedOf`.
- **Corrections:**
  - MUT-480 (ADR-222) voids unposted lines and credits posted receivables with `effectiveDate = today`.
  - MUT-443 (ADR-225) reverses the original. The reversal is dated the correction day in the org timezone; the replacement is a new POSTED payment dated its own `receivedOn`.
  - MUT-444 (ADR-226) credits each old charge's remainder, dated **its own posting date**, reposts on that same date, and releases allocations (`releasedAt`; not lines).
  - MUT-100 outcome correction (`routes/contingency.ts:205`) credits the replaced commission in full dated **today**, voids its line, and posts the new commission on the outcome date (`agreements/outcome.ts:89`).
- **Lazy posting.** DATE installments post with `postingDate = triggerDate` (`postingDateFor`) and retainer charges with their `chargeDate`, whenever a read runs `postDueItems`. `lazyPostingOf` (`auth/middleware.ts:486–496`) posts as the key itself (API_KEY actor, guarded store) for a key, and as SYSTEM on the unguarded store for a session.
- **Local mode.** The portal mounts `PORTAL_ROUTES` (summaries included) over `MemoryLedgerStore` (`src/hosted/local/createLocalApp.ts`).
- **Store guard.** `auth/store-guard.ts` lists every method under `STORE_ACCESS.receivables` (`statementSources: 'read'`).

## 3. What the start and end mean, and why AC2 holds exactly

### 3.1 The lines (ADR-217 §3–4, unchanged)

Whole-customer view, amounts gross:

| Line | Which rows | Date | Debit | Credit |
|---|---|---|---|---|
| CHARGE | receivable, `deletedAt = null`, `countsOn(r, asOf)` | `postingDate` | `grossMinor` | |
| CREDIT | credit on a counted receivable | `effectiveDate` | | `amountMinor` |
| PAYMENT | payment POSTED, or REVERSED with `reversalReason ≠ capture_undo` | `receivedOn` | | `amountMinor` |
| PAYMENT_REVERSAL | payment REVERSED with `reversalReason ≠ capture_undo` (a plain reversal, an owner's MUT-453 reversal, or the original of a MUT-443 correction) | `todayIn(org.timezone, reversedAt ?? updatedAt)` | `amountMinor` | |

Let `B(d)` be the sum of (debit − credit) over the lines dated on or before `d`; this is the statement's balance. For `[from, to]` (inclusive org-local days):

- `openingBalance = B(from − 1)` and `closingBalance = B(to)`.
- `billed = Σ CHARGE`, `credited = Σ CREDIT`, `payments = Σ PAYMENT`, `reversals = Σ PAYMENT_REVERSAL`, each over lines dated in `[from, to]`.
- `received = payments − reversals` and `change = closingBalance − openingBalance`.

```
closingBalance − openingBalance = Σ_{lines in [from,to]} (debit − credit)
                                = billed + reversals − credited − payments
                                = billed − received − credited          (AC2)
```

AC2 is an identity over one line set, so it holds exactly for any mix of events. "Minus those reversed in it" has to mean reversal lines dated in the period, whenever the payment was received. Under the other reading ("received and reversed in the period"), a payment received in March and reversed in April would leave April's `received` unchanged while April's balance rises, and AC2 would fail.

### 3.2 Why the balance, not receivables' outstanding

Over every line, with O the outstanding of counted receivables and U the unallocated amount of POSTED payments:

```
B(∞) = Σ_counted G − Σ credits − Σ_shown payments + Σ_shown reversals
     = Σ_counted G − Σ credits − Σ_POSTED amount
     = Σ_counted G − Σ credits − (Σ live allocations of POSTED payments + U)
     = Σ_counted (G − paid − credited) − U = O − U
```

Each step rests on how the ledger is kept:

- `paid` is the sum of live allocations from POSTED payments. A reversal zeroes them, and MUT-444 rows carry `releasedAt`.
- Money lands only on counted rows: paid > 0 makes `countsOn` true, and a soft-delete refuses a row with money on it.
- Credits land only on counted rows.

So with `to` on or after the last line, `closingBalance` equals the organization summary's `outstanding − unallocated` per currency. Clientless payments are included in both (D4).

Receivables-only outstanding can't satisfy AC2. Over a period, ΔO = billed − credited − (allocations made in the period), and an allocation has no ledger date: it can come weeks after the payment's `receivedOn`. Whenever money sits unallocated or is applied late, ΔO ≠ billed − received − credited by exactly ΔU. A historical U is ill-defined for the same reason.

### 3.3 Each event, traced

| Event | Lines | Period figures |
|---|---|---|
| Unallocated payment P on day d | PAYMENT @d | `payments` and `received` += P in d's period; the balance falls by P (the client's money held). A later allocation makes no line and moves no figure. |
| Plain or owner reversal on day e of P received on d | PAYMENT @d, REVERSAL @e | In one period they net to 0 in `received`. Across periods: +P in d's, −P in e's (`reversals` += P). |
| Capture undo (`capture_undo`) | none | The payment vanishes from d's period retroactively (ADR-217 D2). |
| Captured payment redated (MUT-223) | PAYMENT moves to the new `receivedOn` | It leaves one period and joins another. |
| MUT-443 correction on e: P_old(d) → P_new(d′), d′ ≥ d | PAYMENT P_old @d, REVERSAL @e, PAYMENT P_new @d′ | e's `reversals` += P_old; d′'s `payments` += P_new. If d′ falls in an earlier period, that closed period changes. Moved allocations make no lines. |
| MUT-444 correction on e of a charge G_old posted p, prior credits C | CHARGE G_old @p, CREDIT (G_old − C) @p, CHARGE G_new @p | p's period: `billed` += G_new and `credited` += G_old − C, retroactively (ADR-226 §9). Released payments make no lines. |
| MUT-100 outcome correction on e of a commission G_old (no money on it, `OUTCOME_HAS_PAYMENTS`) | CHARGE G_old @its posting, CREDIT G_old @e, CHARGE G_new @outcomeDate | e's `credited` += G_old; the outcome date's period `billed` += G_new (it can be earlier than e). |
| MUT-480 reduction on e | CREDIT(s) @e; voided unposted lines make none | e's `credited` += amount; `billed` untouched. |
| Credit through `POST /v1/receivables/{id}/credits` | CREDIT @effectiveDate | A key may send any `effectiveDate` (`assertIsoDate`), so a credit can land in a past period. A person's (MUT-453) is ≤ today. |
| Owed (ADJUSTMENT) | CHARGE @postingDate once `countsOn` | Counts from its day, or at once when money lands. A redate moves it between periods; an undo (no money on it) removes it. |
| DATE installment, retainer charge | CHARGE @triggerDate / @chargeDate | Posted by `postDueItems` **before** the read, so a past period never depends on whether anyone read in between. |
| Agreement created back-dated (DATE trigger in the past) | CHARGE @triggerDate | Lands in the past period on creation day. |
| MANUAL installment | CHARGE @the day it is billed | |
| IMMEDIATE installment | CHARGE @max(agreementDate, today) | If dated ahead it counts at once, in that future period's `billed`, and in `closingBalance` only once `to` ≥ its date. |
| Dated-ahead Owed, nothing paid | none until its day | A future period's `billed` grows as days pass. |
| Dated-ahead Owed paid early | CHARGE @future date, PAYMENT @receivedOn | The payment's period shows `received` with no `billed`; the balance dips; the identity holds. |
| Future `receivedOn`; a credit dated before its charge | lines on their own dates | Counted where dated; the identity holds. |
| The organization's timezone changes | every REVERSAL is re-dated by the new zone | A reversal near midnight can move to the adjacent day, and so to another period. |
| Another currency | its own block | Never summed across currencies (ADR-004). |

`countsOn` is evaluated against `asOf` (today in the org timezone), never against `to`, as on the statement and the summaries.

**The general rule (D5 A, R4).** The figures are the ledger as it stands at `asOf`: anything dated into a period changes that period, whenever it was written. The table names the ways: back-dated creation, corrections (MUT-443, MUT-444, MUT-100), captured-payment redates, Owed redates and undos, capture undos, key credits with any `effectiveDate`, and a timezone change. Lazy posting does **not** move a closed period, because it always runs before the read. The ADR and the route description both state this rule.

**In net, not line for line (R6).** A corrected month matches the accountant's books **in net, not line for line**. A MUT-444 correction shows the replaced charge, a credit for it and the repost, all on the original posting date. A MUT-443 correction shows the original payment, its reversal on the correction day and the replacement. The accountant's books may hold only the corrected document. Basel was told this explicitly on 2026-10-29.

## 4. Decisions settled here

- **S1 One definition, by construction (AC1).** The statement's line rule is extracted into one exported classifier, which the statement and the period totals both read (§6). The period totals are the same entries, summed.
- **S2 Org-wide in one pass, no per-customer loop.** Whole-customer lines don't depend on other customers: a charge and its credits belong to one receivable, and a payment's lines carry its full amount. So `ledgerEntries` over the organization's rows is the union of each customer's statement lines, plus clientless payment lines (D4). Summing needs no sort.
- **S3 Period.** `from` and `to` are inclusive org-local days, validated by `reportRange()`. Both are optional and default to this month: `to` defaults to the **last day of this month**, not today, so lines dated later this month count (R11). Real dates within the money-date bounds, else 422 `DATE_INVALID`. `to` before `from` is 422 `END_BEFORE_START`. More than 13 calendar months is 422 `RANGE_TOO_LONG`. The cap isn't there for cost: the read covers the whole history either way (§7). It keeps one Reports range rule, and a year fits.
- **S4 Currency.** `currency` is optional and validated by `CurrencySchema` (422 `VALIDATION_FAILED`). With `?currency=` the response has exactly one block, all zeros if nothing exists. Without it, there is one block per currency with a line in the period or a non-zero opening or closing balance, sorted by code. A currency settled long ago with no activity gets no block of zeros.
- **S5 Lazy posting first (R7).** `postDueItems` runs through `lazyPostingOf`, as on the statement and the org summary. A **key posts as itself** (API_KEY actor, through the guarded store); only a session or device session posts as SYSTEM. Validation runs first, so a refused request writes nothing.
- **S6 Auth and scope.** Security is `[{ apiKey }, { session }, { deviceSession }]` with `requireScope('summaries:read')`, the same as `/v1/summaries/organization` (AC3); without the scope, 403 `INSUFFICIENT_SCOPE`. It is per-organization: it needs `X-Mutaba3a-Profile` for sessions and is not in `SUMMARY_ORGANIZATION_INDEPENDENT_ROUTES`. The MUT-361 lapse gate applies as on every read.
- **S7 Local mode gets it.** There is no portal UI. The route lives in `summaryRoutes`, which local mode mounts, and the memory store implements the method. No record field changes, so the local snapshot format stays at 13.
- **S8 `change` is returned.** MAL-1428 shows "how much owed changed" and may compute nothing (D2).
- **S9 `asOf` and `timezone` are returned**, so a client can say what the day boundaries and the dated-ahead rule were measured against.
- **S10 No new index or migration.** The reads filter on `organizationId`, the leading column of an existing index on each table: `receivables(organizationId, customerId)`, `receivable_credits(organizationId, receivableId)`, `payments(organizationId, customerId)`. `currency` is a residual filter.
- **S11 Two documented differences from neighbours (R12).** The ADR names both; neither is changed.
  - The period refuses an inverted range with `END_BEFORE_START`, as `/activity` and `/verdict` do. The statement uses `PERIOD_INVALID` for the same case. This route is a summary, so it takes the summaries rule.
  - `?currency=` with no data returns one block of zeros here. `/summaries/organization` returns an empty `currencies` list. A month sheet that asked for ILS should get ILS zeros.

## 5. Decisions (answered by Basel 2026-10-29)

**D1 — A MUT-444 correction inside the figures.**
- A: as the statement. The replaced charge stays in `billed`, its repost is billed too, and the correction credit is in `credited`. AC1 holds by construction. A corrected month's `billed` and `credited` both grow by the replaced amount, and the net is right.
- B: net out superseded charges and every credit on them (the matter figures' rule, ADR-226 §8). This breaks AC1.
- C: A, plus an informational `corrected` figure.

> **Basel: A** (as the statement). He was told that a corrected month then matches the accountant's books in net, not line for line (§3.3, R6).

**D2 — Names of the start and end figures.**
- A: `openingBalance` / `closingBalance` plus `change`. These are the statement's names for exactly this quantity, summed.
- B: the ticket's `outstandingAtStart/End`. This clashes with `outstanding` on `/summaries/organization`, which is receivables only.

> **Basel: A.** AC2 reads `closingBalance − openingBalance = change = billed − received − credited`.

**D3 — Received breakdown.**
- A: `received` only.
- B: `received` plus `payments` (PAYMENT lines in the period) and `reversals` (PAYMENT_REVERSAL lines in the period), with `received = payments − reversals`.

> **Basel: B.** `reversals` includes the reversal of every reversed payment dated in the period: a plain reversal (a bounced cheque), an owner's reversal (MUT-453), and **the original of a MUT-443 correction** (dated the correction day). A capture undo is in neither figure. A month in which an earlier payment bounced or was corrected can show a small or negative `received`; the two parts explain it without Malafat computing anything.

**D4 — Payments with no client (MUT-65 Received captured without a client, `customerId = null`).** These appear on no statement.
- A: include them in `payments`, `reversals`, `received` and the balances.
- B: leave them out.

> **Basel: A** (include). `closingBalance` (with `to` on or after the last line) then equals `/v1/summaries/organization` `outstanding − unallocated`, which counts them. AC1 reads "Σ statements + clientless payment lines". It is exact on every Malafat-fed profile, which can't hold a clientless payment: there a Received capture needs a client Malafat has linked, otherwise 422 `CUSTOMER_REQUIRED` (`routes/income.ts:41`, `income/compose.ts:58`), and a Malafat-fed payment always carries a customer (R9). A per-period "received without a client" figure is out of scope.

**D5 — Closed months still move.**
- A: accept and document.
- B: a month-close snapshot (a stored figure, its own ticket and Malafat UI).

> **Basel: A.** The independent reviewer agreed. The general rule is in §3.3 and goes into the ADR and the route description: "Figures are the ledger as it stands at `asOf`; anything dated into a period changes it."

## 6. Reuse: what is extracted and shared

New `server/src/statements/lines.ts`. `build.ts` imports it without changing behaviour; R1's legacy-equivalence test proves this, not only the existing suite.

```ts
/** ADR-217 §3: a charge is on the statement (and in every period figure) when the summary counts it and it isn't deleted. */
export function isStatementCharge(r: Pick<ReceivableRecord, 'deletedAt' | 'origin' | 'postingDate' | 'paidMinor' | 'creditedMinor'>, asOf: IsoDate): boolean
/** POSTED, or REVERSED by anything but the person's own undo (ADR-217 D2). */
export function isStatementPayment(p: Pick<PaymentRecord, 'status' | 'reversalReason'>): boolean
/** A reversal's instant (reversedAt, else updatedAt) and its day in the organization timezone (ADR-217 D6). */
export function reversalInstantOf(p: Pick<PaymentRecord, 'reversedAt' | 'updatedAt'>): Date
export function reversalDateOf(p: Pick<PaymentRecord, 'reversedAt' | 'updatedAt'>, timezone: string): IsoDate
/** The whole-customer line set, undecorated: the one classifier the statement and the period totals read. */
export function ledgerEntries<R extends ChargeRow, C extends CreditRow, P extends PaymentRow>(
  rows: { receivables: readonly R[]; credits: readonly C[]; payments: readonly P[] },
  view: { asOf: IsoDate; timezone: string },
): LedgerEntry<R, C, P>[]   // { id, kind, date, atMs, rank, currency, debitMinor, creditMinor, source }
```

- **Line identity and order** are unchanged and pinned by `lines.test.ts` (R10).
  - Ids: CHARGE = receivable id, CREDIT = credit id, PAYMENT = payment id, REVERSAL = `${paymentId}:reversal` (on a project statement `${allocationId}:reversal`).
  - `atMs`: charge, credit and payment = `createdAt`; reversal = `reversalInstantOf`.
  - `rank`: CHARGE 0, CREDIT 1, PAYMENT 2, REVERSAL 3.
  - Cursor: base64url of `{ d, t, r, id }` = (date, atMs, rank, id).
- **`build.ts` `ledgerLines`.**
  - Whole-customer branch: `ledgerEntries(...)`, then each entry is decorated into a `SortedLine` (origin, status, daysOverdue, projectId, unallocated, which are statement-only).
  - Project branch: keeps its allocation lines, built with `isStatementCharge`, `isStatementPayment` and `reversalDateOf`.
- **New `server/src/statements/period.ts`** (pure, no store, no clock). One pass: before `from` adds to opening, inside `[from, to]` adds to its kind's total, after `to` is ignored. `closingMinor` is opening + flows in production (AC2 by construction). The tests compute it independently (R1).

  ```ts
  export interface PeriodTotals { currency: string; openingMinor: bigint; billedMinor: bigint; creditedMinor: bigint; paymentsMinor: bigint; reversalsMinor: bigint; closingMinor: bigint }
  export function summarizePeriod(entries: readonly LedgerEntry[], period: { from: IsoDate; to: IsoDate }, currency: string | null): PeriodTotals[]
  ```
- **Serializer.** `serializePeriodSummary` goes in `statements/serialize.ts`, formatting with `formatMoney`.
- **Route.** `routes/summaries.ts` reuses `reportRange`, `lazyPostingOf` + `postDueItems` and `todayFor`.
- **Not reused: `summaries/activity.ts`.** Its "received" counts POSTED payments only (a reversed payment vanishes from its own month), which is the session Reports' definition. The ADR names the difference: the period's `received` is ledger-dated, and reversals count on their own day.

**Store.** Add `ReceivableRepository.periodSources(organizationId: string, currency: string | null): Promise<PeriodSourceRows>`, beside `statementSources`.

- **What it returns:** the organization's non-deleted receivables, the credits on them, and every payment of any status, clientless included (D4).
- **Prisma:** three `findMany` calls with narrow `select`s in one `$transaction([...], { isolationLevel: 'RepeatableRead' })`.
  - receivables: `id, customerId, currency, origin, postingDate, grossMinor, paidMinor, creditedMinor, deletedAt, createdAt`
  - credits: `id, receivableId, amountMinor, effectiveDate, createdAt`
  - payments: `id, customerId, currency, amountMinor, receivedOn, status, reversalReason, reversedAt, updatedAt, createdAt`
- **Memory:** the same filters.
- **Not read:** allocations and installments.
- **Guard:** `store-guard.ts` gets `periodSources: 'read'`.

**Observability (R5).** The route logs one structured line, `summaries.period`, with `rows: { receivables, credits, payments }`, `postingMs`, `readMs`, `sumMs` and `currencies`, (no Sentry span: build note B2). TD-291's trigger is read off these. No amounts and no ids beyond the organization's.

## 7. Cost (R5)

- **Per request:** the existing `postDueItems` (the same work as `/summaries/organization`), then 3 reads in one snapshot, then one O(n) pass with no sort. No per-customer or per-row query.
- **Runtime:** the API runs on Cloud Run at 1 vCPU / 512 Mi with `cpu_idle = true` (`server/infrastructure/terraform/main.tf:562–565`), so CPU is billed only while requests run.
- **Realistic cost.** Rows are Prisma objects with BigInt fields, roughly 0.5–1 KB of heap each, and deserialization dominates.

  | Lines | Read + sum | Transient heap |
  |---|---|---|
  | ~1k (most firms) | ~20–50 ms | negligible |
  | ~10k | ~100–250 ms | ~10–20 MB |
  | ~100k | ~1–2.5 s | ~100–200 MB |

  At ~100k lines, a few concurrent requests on a 512 Mi instance are the real limit, not CPU time.
- **Compared with TD-271:** the statement reads one customer × currency, sorts and pages, and runs per page. This read covers the whole organization unsorted and runs once per month-summary view. The range doesn't change the cost, because the opening balance needs every earlier line.
- **TD-291 (new, Open): the period read loads the organization's whole history per request.**
  - Trigger: p95 of `readMs + sumMs` on the `summaries.period` log line over 500 ms, or `rows` total over 50k for any organization.
  - Upgrade path: one Postgres aggregate per currency (`SUM(...) FILTER (WHERE date < $from)`, and for each kind `FILTER (WHERE date BETWEEN $from AND $to)`). Both rules are plain SQL expressions:
    - `countsOn` is `origin <> 'ADJUSTMENT' OR "postingDate" <= $asOf OR "paidMinor" > 0 OR "creditedMinor" > 0`.
    - The reversal's local day is `(COALESCE("reversedAt", "updatedAt") AT TIME ZONE $tz)::date`.
  - The §9 property test proves the SQL path equals the JS path, and the JS path stays for local mode. The alternative is a cached opening balance per (organization, currency, month) keyed on a ledger version.
- **Infra:** none. No new service, job, queue, index or migration.

## 8. API contract

`GET /v1/summaries/period?from=2026-10-01&to=2026-10-31&currency=ILS`, tag Summaries. Example response:

```json
{
  "from": "2026-10-01", "to": "2026-10-31", "asOf": "2026-10-29", "timezone": "Asia/Jerusalem",
  "currencies": [
    { "currency": "ILS",
      "openingBalance": "600.00",
      "billed": "2680.00", "credited": "1050.00",
      "received": "420.00", "payments": "720.00", "reversals": "300.00",
      "change": "1210.00",
      "closingBalance": "1810.00" }
  ]
}
```

- **Schemas** (`server/src/schemas.ts`):
  - `PeriodSummaryQuerySchema`: `from?` and `to?` (`IsoDateSchema`, described as `ActivitySummaryQuerySchema` does) and `currency?` (`CurrencySchema`).
  - `PeriodCurrencyTotalsSchema`: every amount an `AmountSchema` string, signed (balances, `change` and `received` may be negative).
  - `PeriodSummarySchema` (`.openapi('PeriodSummary')`).
- **Description.** The contract carries the definitions:
  - `billed` = gross of the statement's CHARGE lines dated in the period.
  - `credited` = CREDIT lines by `effectiveDate`.
  - `payments` = PAYMENT lines by `receivedOn`. `reversals` = PAYMENT_REVERSAL lines by the reversal's day in the organization timezone, including the original of a corrected payment. `received = payments − reversals`.
  - A person's own undone capture counts nowhere. A payment with no client counts.
  - `openingBalance` / `closingBalance` = what clients owe net of money received and not yet applied: the statement's balance, summed across clients, plus clientless payments.
  - `change = closingBalance − openingBalance = billed − received − credited`.
  - `to` defaults to the last day of this month, not today, so `closingBalance` then includes lines dated later this month (R11). With `to` on or after the last line, `closingBalance` equals `/v1/summaries/organization` `outstanding − unallocated`.
  - Due items are posted first.
  - "Figures are the ledger as it stands at asOf: anything dated into a period — a back-dated entry, a correction, a redate, a credit — changes that period." (D5, R4)
  - `?currency=` with no data returns one block of zeros (R12).
- **Errors:**
  - 401
  - 403 `INSUFFICIENT_SCOPE` (`required: summaries:read`)
  - 402 `SUBSCRIPTION_LAPSED` (the gate)
  - 422 `DATE_INVALID` / `END_BEFORE_START` / `RANGE_TOO_LONG` (reused, with `field`)
  - 422 `VALIDATION_FAILED` for an unknown currency

  No new reason.
- **Version and types:** `API_VERSION = '1.90.0-mut483'` plus a description bullet (AC4). Then `npm --prefix server run openapi:generate` (`server/openapi/openapi.yaml`) and `npm run hosted:types` (`src/hosted/api/schema.d.ts`). Malafat's client re-vendors the contract (noted on MAL-1428).

## 9. Test plan (written first, TDD)

**R1 step 0, before any extraction: `server/src/statements/__tests__/legacy-equivalence.test.ts`.**
- Copy today's `ledgerLines` / `buildStatement` / `compareLines` verbatim into the test as `legacyBuildStatement`.
- Over 500 seeds of R2 organizations (each customer × currency, with and without a project, random `from`/`to`, page sizes 1–50 walked to the end), assert that the extracted `buildStatement` returns identical output: every line (all fields, `id`, `atMs`, `rank`), `openingMinor`, `totals`, `closingMinor` and every `nextCursor` (encoded).
- The copy is deleted only when ADR-217's line rule changes on purpose.

**R2: random organizations come from real writes.** A seeded (mulberry32, as in `agreements/__tests__/correct-terms.test.ts`) driver over `MemoryLedgerStore`, through the domain functions the routes use, never a free row generator. It runs:
- agreements: fixed with DATE, IMMEDIATE and MANUAL lines, retainers, contingency with outcome and outcome correction;
- Owed (dated ahead too), pay with explicit allocations and with a strategy, allocate later, reverse, capture and undoCapture;
- credits (key, any `effectiveDate`), MUT-480 reduce, MUT-443 correct, MUT-444 correct;
- Owed and capture redate, Owed soft-delete;
- clientless captures; 1–6 customers; 1–3 currencies;
- a clock advanced between writes, with reversal instants landing near local midnight.

**Unit, `statements/__tests__/period.test.ts`.**
- One table row per §3.3 event, including the MUT-100 outcome correction, the timezone change and the block rule (S4: `?currency=` with no rows returns one zero block).
- Property tests over 500 R2 seeds with random `[from, to]` in or around the data:
  1. **AC2, computed independently (R1).** `expectedClosing = Σ (debit − credit) over entries dated ≤ to` and `expectedOpening = Σ over entries dated < from`, each computed directly from the entries, never as opening + flows. Assert `closingMinor === expectedClosing`, `openingMinor === expectedOpening`, `closing − opening === billed − (payments − reversals) − credited`, and `change` likewise.
  2. **AC1.** Per currency, `billed`, `credited`, `payments`, `reversals`, opening and closing equal Σ over customers of the legacy statement builder (`legacyBuildStatement`, not the extracted one), split by line kind, plus the clientless payment lines.
  3. **Continuity.** `opening(from) = closing(from − 1)`, and consecutive months add up to their range.
  4. **Anchor.** `closing` with `to` ≥ the last line equals `Σ bucketize(...).outstanding − unallocatedOf(...)` over the store's own rows, which is the org summary.

**Unit, `statements/__tests__/lines.test.ts` (R10).**
- The four predicates, including the `reversedAt ?? updatedAt` fallback.
- Pinned ids (`${paymentId}:reversal`, and `${allocationId}:reversal` on a project statement).
- `atMs` (createdAt for charge, credit and payment; the reversal instant for a reversal) and ranks.
- The cursor encoding round-trip of (date, atMs, rank, id) against a literal base64url string.

**Additions to `build.test.ts` (R1):**
- A reversal at 22:30 UTC dated the next local day in Asia/Jerusalem.
- A REVERSED payment with `reversedAt` null dated by `updatedAt`.
- Reversal line ids on a project statement.
- A soft-deleted receivable is never a line.

**Route, `server/src/__tests__/period-summary.route.test.ts`** (memory store, `createApp`, fixed clock):
- **AC1:** a year-long fixture written through the real routes, both corrections included. Each month's `/v1/summaries/period` equals Σ `/v1/customers/{id}/statement?from&to` over the customers, plus the clientless payment.
- **AC2:** the identity and `change` on every month.
- **AC3:** a key without `summaries:read` gets 403. A key, a session and a device session with it get 200. Another organization's rows never appear.
- **AC4:** `info.version` is `1.90.0-mut483`.
- **Validation:** `DATE_INVALID` (2026-02-30), `END_BEFORE_START`, `RANGE_TOO_LONG`, an unknown currency, the month defaults (`to` = month-end, R11), and a refused request posts nothing.
- **Lazy posting:** a due DATE installment and a retainer charge appear in their own month on the first read. The posting audit actor is the key (API_KEY) for a key and SYSTEM for a session (R7).
- **Log line:** `summaries.period` carries the row counts.

**Store contract, `store-contract-mut483.ts`** plus `store-memory-mut483.test.ts` and `store-prisma-mut483.test.ts` (Postgres `test:db`):
- Only non-deleted receivables, their credits, payments of every status (clientless included), the currency filter, and another organization excluded.
- Both stores give the same `ledgerEntries` for the same ledger.
- A released MUT-444 allocation changes nothing.

**Existing pins to update (R8):**
- `server/src/__tests__/writability-routes.test.ts`: the `lazyPostingOf` call-site list (~line 315) gains a fifth `routes/summaries.ts`, and the `LAZY` table (~line 343) gains `['GET /v1/summaries/period', () => '/v1/summaries/period', { installment: 1, charge: 1 }]`.
- `server/src/__tests__/route-security.test.ts`: `SESSION_OPERATIONS` (~line 199, sorted) gains `GET /v1/summaries/period`, and `DEVICE_SESSION_OPERATIONS` follows from it.
- The version literals in `routes-m2..m8`, `payments-correct`, `fee-proposals-full-approve` and `agreement-correct.route` tests.
- The store-guard exhaustiveness test covers `periodSources`.

**Local mode:** one test in `src/hosted/local/__tests__` that the route answers over the memory store.

**Verify.** Everything runs through `~/Work/tools/heavy-gate/heavy`, Node 22, one job at a time:
- server: `npm --prefix server run typecheck`, `lint`, `openapi:check`, `npm --prefix server test`;
- root: `npm run lint`, `typecheck`, `test:run`, `build`;
- release-QA: `period-totals`, and re-run the existing `statement` and `agreement-correct` features (R8), since `build.ts` is refactored and the version pin moves.

## 10. QA scenarios (release-QA)

**New feature.** `period-totals` in `qa/features/portal-selfservice/malafat-money-api.yaml`, with paths `server/src/statements/period.ts`, `server/src/statements/lines.ts` and `server/src/routes/summaries.ts`. The area's `paths` already holds `server/src/statements/**`. There is one test in `qa/specs/portal-selfservice/malafat-money-api.spec.ts`, tagged `@portal-selfservice.malafat-money-api.period-totals`, playing Malafat with `fetch` against the live dev API.

**Dates.** The spec reads `asOf` first. M is that month and P is the month before. Everything in M is dated M-01 or today, both inside M.

**Fees are stated as gross** (R3):
- Each is VAT-inclusive at 18 %, except the corrected one, which becomes VAT-exclusive (₪1,000 net = ₪1,180 gross).
- Each fee is its own agreement:
  - **A-last:** ₪1,000, one DATE line on P-05.
  - **A-fee:** ₪1,000, one IMMEDIATE line, agreement dated M-01. It posts today, which is in M.
  - **B-fee:** ₪500, one DATE line on M-01.
- Payments name explicit `allocations` (or `[]`). The MUT-443 correction sends explicit `allocations`. The MUT-444 correction places released payments by its own oldest-first rule, and none are live by then.

```yaml
  - id: period-totals
    title: Malafat reads a month's billed, received and credited, and they add up to how much owed changed
    tier: secondary
    # MUT-483 (ADR-227): GET /v1/summaries/period with the integration key. Malafat's "Month summary" sheet is MAL-1428.
    paths:
      - server/src/statements/period.ts
      - server/src/statements/lines.ts
      - server/src/routes/summaries.ts
    steps:
      - Malafat sets up a firm with two clients at 18 % VAT
      - Last month, client A is billed ₪1,000 (VAT included) on its own agreement and pays ₪400 against it
      - This month, A is billed a ₪1,000 fee (VAT included) on its own agreement and B ₪500 (VAT included)
      - B gets a ₪50 credit and pays ₪300 with nothing applied; A pays ₪200 against its fee and the payment bounces
      - B pays ₪100 against its charge and Malafat corrects it to ₪120, applied to the same charge
      - Malafat corrects A's fee from ₪1,000 VAT-inclusive to ₪1,000 VAT-exclusive
      - Malafat reads this month's totals in ILS, then last month's, then each client's statement for this month
      - Malafat reads the totals with a key that lacks summaries:read, with to before from, and reads the contract version
    expect:
      - Billed, credited, payments and reversals for this month equal both clients' statement lines for the month, added up (AC1)
      - Closing minus opening equals billed minus received minus credited, and equals change; this month's opening equals last month's closing (AC2)
      - "This month: opening ₪600, billed ₪2,680, credited ₪1,050, payments ₪720, reversals ₪300 (the bounce and the corrected original), received ₪420, change ₪1,210, closing ₪1,810"
      - "Last month: billed ₪1,000, received ₪400, credited ₪0, opening ₪0, closing ₪600"
      - The key without summaries:read gets 403 INSUFFICIENT_SCOPE, and to before from gets 422 END_BEFORE_START (AC3)
      - The contract version reads 1.90.0-mut483 (AC4)
```

**Arithmetic check for M** (re-checked by the reviewer under these assumptions):
- billed = A-fee ₪1,000 + its repost ₪1,180 + B-fee ₪500 = ₪2,680.
- credited = ₪50 + A-fee's correction credit ₪1,000 = ₪1,050.
- payments = 300 + 200 + 100 + 120 = ₪720.
- reversals = 200 + 100 = ₪300, so received = ₪420.
- By balance: A owes 600 + 1,180 = 1,780; B owes 500 − 50 − 120 − 300 unallocated = 30; the total is ₪1,810 = 600 + 2,680 − 1,050 − 420.

**Version pins (R3, R8).** The existing `agreement-correct` feature's expect line ("…the contract version reads 1.89.0-mut444", yaml ~line 153) and its spec assertion (`expect(doc.info.version).toBe('1.89.0-mut444')`, spec ~line 563) move to `1.90.0-mut483`.

Run `release-qa run --attach --only period-totals` until it passes, re-run `statement` and `agreement-correct`, and finish with `release-qa lint` clean.

## 11. Files

**Server:**
- `statements/lines.ts` (new): predicates and `ledgerEntries`.
- `statements/build.ts`: reads `lines.ts`, behaviour unchanged.
- `statements/period.ts` (new).
- `statements/serialize.ts`: `serializePeriodSummary`.
- `repositories/ports.ts`: `PeriodSourceRows`, `periodSources`.
- `repositories/memory.ts`, `repositories/prisma.ts`.
- `auth/store-guard.ts`.
- `schemas.ts`: three schemas.
- `routes/summaries.ts`: the route and its log line (no span, B2).
- `app.ts`: version and bullet.
- `openapi/openapi.yaml`: regenerated.

**Server tests:**
- new: `statements/__tests__/{legacy-equivalence,period,lines}.test.ts`, the R2 driver, `__tests__/period-summary.route.test.ts`, `repositories/__tests__/store-{contract,memory,prisma}-mut483*`;
- edited: `statements/__tests__/build.test.ts` (R1 cases), `__tests__/writability-routes.test.ts` (~315, ~343), `__tests__/route-security.test.ts` (~199), and the version pins in `routes-m2..m8`, `payments-correct`, `fee-proposals-full-approve` and `agreement-correct.route` tests.

**Root:**
- `src/hosted/api/schema.d.ts` (`hosted:types`);
- the local-mode test;
- `qa/features/portal-selfservice/malafat-money-api.yaml` (new feature, plus the `agreement-correct` version line ~153);
- `qa/specs/portal-selfservice/malafat-money-api.spec.ts` (new test, plus the version pin ~563).

**Knowledge:**
- **ADR-227** "Period totals are the statement's lines summed across the organization". It records:
  - S1–S11 and the D1–D5 answers;
  - the §3.2 algebra;
  - the general rule (D5) and "in net, not line for line" (R6);
  - the difference from `/activity`'s received;
  - R12's two documented differences.
- **TD-291.**
- **PATTERNS:** amend "a ledger is computed, never stored" with "a period figure is the ledger's own lines summed through the one classifier; an extraction is proven against a frozen copy of the old builder (R1)".
- CHANGELOG, SYSTEM_OVERVIEW (API surface), TEST_PLAN, and docs/roadmap if a Money milestone line exists.

## 12. Impact, i18n, cost, infra

- **Impact:** a read, plus a pure refactor of the statement's classifier, proven against a frozen copy. No migration, no snapshot format change. The only write is the existing lazy posting.
- **i18n:** none. API only, with no user-facing strings; Malafat renders the labels.
- **Cost:** CPU per request (§7), nothing while idle.
- **Infra:** none.

## 13. Scope check

Covers AC1–AC4.

Not included:
- a portal or phone screen (local mode serves the route, but there is no UI);
- VAT splits of billed and credited;
- per-client rows (the statement has them);
- `receivedWithoutClient` (R9);
- a month-close snapshot (D5 B);
- the TD-291 SQL path.

## 14. Eng review 2026-10-29 (independent reviewer; no CRITICAL or HIGH)

| # | Finding | Disposition |
|---|---|---|
| R1 | The tests checked the code against itself: AC1 compared the extracted builder with itself, and AC2's closing was opening + flows. | **Accepted.** A frozen `legacyBuildStatement` copy, asserted identical (lines, ids, atMs, rank, cursors) over 500 seeds before extraction. Closing and opening are computed independently from entries. Build cases added for a reversal near midnight, the `updatedAt` fallback, project reversal ids and a deleted receivable (§9). |
| R2 | A free row generator can make ledgers the system never produces. | **Accepted.** Random organizations are built by driving `MemoryLedgerStore`'s real writes, including both corrections, redates and soft-deletes (§9). |
| R3 | The QA numbers depended on unstated agreement shapes and VAT bases. | **Accepted.** Last month's charge is its own agreement; the corrected fee is its own single-IMMEDIATE agreement dated M-01; every fee is stated as gross; corrections use explicit allocations or their rule; version pins added to the files list. The reviewer re-checked: billed 2,680, credited 1,050, payments 720, reversals 300, received 420, change 1,210, closing 1,810 (§10). |
| R4 | D5 listed cases rather than a rule. | **Accepted.** The general rule is stated in §3.3, §8 and the ADR. Rows added: the MUT-100 outcome correction, back-dated creation, captured-payment redates, key credits with any `effectiveDate`, and a timezone change. |
| R5 | The cost numbers were optimistic, and TD-291's trigger was unmeasurable. | **Accepted.** Numbers restated for 1 vCPU / 512 Mi with `cpu_idle`, and Prisma BigInt rows. Added a `summaries.period` log line and Sentry span with rows and durations. TD-291 notes that `countsOn` and the reversal's local day are plain SQL expressions (§6, §7). |
| R6 | "Reads the way the accountant books it" overclaims. | **Accepted.** Dropped. The plan and ADR say a corrected month matches the accountant's books in net, not line for line, which Basel was told explicitly (§3.3, D1). |
| R7 | S5 said a key posts as SYSTEM. | **Accepted, fixed.** A key posts as itself (API_KEY, guarded store); only a session posts as SYSTEM (`auth/middleware.ts:486–496`). A route test asserts the actor (§4 S5, §9). |
| R8 | The files list missed pinned tests and the QA re-run. | **Accepted.** Added `writability-routes.test.ts` (call-site list ~315, `LAZY` ~343), `route-security.test.ts` `SESSION_OPERATIONS` (~199), the spec and yaml version pins, and re-runs of `statement` and `agreement-correct` (§9, §10, §11). |
| R9 | D4 needed evidence that Malafat firms have no clientless payments. | **Accepted.** Cited `CUSTOMER_REQUIRED` on Malafat-fed profiles (`routes/income.ts:41`, `income/compose.ts:58`). `receivedWithoutClient` is skipped as out of scope (D4, §13). |
| R10 | Nothing pinned the line identity the cursor relies on. | **Accepted.** `lines.test.ts` pins the cursor encoding (date, atMs, rank, id), `${id}:reversal` ids and the atMs rules (§6, §9). |
| R11 | The default closing could be read as today. | **Accepted.** The contract says `to` defaults to the last day of this month, so the default closing includes lines dated later this month (S3, §8). |
| R12 | Two silent differences from neighbours. | **Accepted, kept and documented** in S11 and the ADR: `END_BEFORE_START` here vs `PERIOD_INVALID` on the statement; `?currency=` with no data returns one zero block here vs an empty list on `/summaries/organization`. |

## 15. Build notes (2026-10-29)

None of these changes what Malafat sees: the route, its query, its response and its errors are exactly §8.

| # | Where | What and why |
|---|---|---|
| B1 | R2 driver (`statements/__tests__/ledger-driver.ts`) | Malafat's writes go through the real HTTP routes with an integration key. A person's writes (Owed, captures with and without a client, undo, redates, voiding an Owed) are session-only routes, and one profile can't take both a key and a session write (an owned profile refuses keys; a Malafat-fed one refuses Owed and clientless captures). So the driver calls the very store methods those routes call, with the routes' guards (`dueDateAfterRedate`, nothing allocated before a capture redate, nothing paid or credited before a void). Rows still come only from real write methods. A test asserts every kind of write happened across the 500 seeds. |
| B2 | Observability (R5) | The structured `summaries.period` log line is built (rows, `postingMs`, `readMs`, `sumMs`, currencies; no amounts). The Sentry span is not: the API's Sentry is errors only (`tracesSampleRate: 0`, ADR-091), and `routes/summaries.ts` also runs in the portal's browser bundle, which must never import the SDK (ADR-024). A span would record nothing. TD-291's trigger is read off the log line (a log-based metric in Cloud Logging). `summaryRoutes` takes an optional logger (`PortalRouteDependencies.logger`); local mode passes none. |
| B3 | Frozen copy (R1) | `legacyBuildStatement` lives in `statements/__tests__/legacy-build.ts`, imported by both `legacy-equivalence.test.ts` and `period.test.ts` (AC1 compares against it), rather than copied into each test. It is the verbatim pre-extraction builder from a80d998a. |
| B4 | `lines.ts` | `LedgerEntry` also carries `customerId` (null for a clientless payment) and, on a CREDIT, its `receivable`, so the statement decorates without a lookup and AC1's per-customer split needs no join. `LINE_RANK` and `StatementLineKind` moved there; `build.ts` re-exports the type. The narrow row types are `Ledger{Receivable,Credit,Payment}Row` in `ports.ts`. |
| B5 | `build.ts` project statement | Its charges and credits come from `ledgerEntries` over the project's receivables (no payments); payments stay allocation lines built with `isStatementPayment` and `reversalDateOf`. The whole-customer statement decorates every entry. Proven identical to the frozen copy over 500 seeds; a mutation of the classifier fails the test. |
| B6 | Pins | `writability-routes.test.ts` also counts the session reads (38 → 39). The store contract additionally pins the exact field set of each narrow row, and that a MUT-444 correction's released allocation leaves the payment lines unchanged while the balance still equals outstanding − unallocated. |

## 16. Pre-landing review 2026-10-29

No CRITICAL or HIGH. The build.ts refactor was compared line by line with a80d998a (no behaviour change), `legacy-build.ts` is verbatim, and the QA numbers were recomputed and hold.

| # | Finding | Disposition |
|---|---|---|
| P1 | Prisma `periodSources` is checked by one DB-gated fixture only | Accepted: the full server suite ran with `MUTABA3A_TEST_DATABASE_URL` on `mutaba3a_test_mut483` (5,947/5,947), and CI `test:db` runs it before release. |
| P2 | A retired currency (AED, SAR, QAR, BHD, OMR) can appear as a block outside the published `Currency` enum | Same as `/v1/summaries/organization` today; kept consistent, recorded in ADR-227 §Consequences and TD-292. |
| P3 | One bound alone defaults the other to this month (`?to=` in the past → 422 END_BEFORE_START; an old `?from=` → 422 RANGE_TOO_LONG) | `reportRange` is shared with Reports; kept, documented in ADR-227 for Malafat (send both bounds). |
| P4 | Every call reads the whole history | TD-291 (accepted). |
| P5 | Plan still named a Sentry span | Fixed above (B2). |
| P6 | A QA run crossing midnight on a month's last day dates the reversals into the next month | Accepted; the spec runs well inside a month. |
