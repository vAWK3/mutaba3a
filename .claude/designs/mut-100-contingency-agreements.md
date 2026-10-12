# MUT-100 — Contingency fee agreements (design brief)

> **Status:** approved. The plan below passed `/plan-eng-review`, `/plan-ceo-review` (SCOPE REDUCTION) and an eng re-review on 2026-10-12, with every decision taken by Basel (D1–D10, C1–C2, re-review D1) and 0 unresolved. The three review reports are in `mut-100-contingency-agreements-reviews.md`. Test plan: `mut-100-contingency-agreements-tests.md`.
>
> **Build notes (2026-10-13, `/eng-build`)** — changes forced by the code as it stands today, none of which changes an approved behaviour:
> - **API version `1.16.0-mut100`**, not 1.14.0: MUT-120 took 1.14.0 and MUT-61 took 1.15.0 after this plan was written. The version pins in `routes-m2..m8` move with it.
> - **ADR-059**, not ADR-056: ADR-056 was left unused and 057/058 have landed since; the next number in sequence is used.
> - **Store guard**: `STORE_ACCESS` (`auth/store-guard.ts`) is typed over `LedgerStore`, so the three new methods are classified there as `{ write: 'agreements' }` (the plan did not list the file; nothing compiles without it).
> - **`COMMISSION_LABEL_REQUIRED`** (422): the CEO review's validation row "AWARDED without `commissionLabel` → 422" needs a named reason, because the label is optional for NO_RECOVERY and so cannot be a schema rule.
> - **`Installment.isCommission`** is echoed on the wire (additive), so Malafat can tell the commission line from the upfront installments without reading labels.
> - **Outcome routes answer 200 with `AgreementDetail`** (record and correct), like cancel; the preview answers 200 with `ContingencyOutcomePreview`.
> - **Terms overrides belong to a correction only**: a preview or record in RECORD mode that carries `commissionRateBasisPoints` / `upfrontTreatment` gets 409 `OUTCOME_NOT_RECORDED` (terms change before an outcome through `PATCH /contingency`). Cancelling after an outcome gets 409 `OUTCOME_ALREADY_RECORDED`.
> - **A concurrent loser** of two racing records gets 409 `OUTCOME_ALREADY_RECORDED` when the winner recorded an outcome, else `VERSION_MISMATCH`.
> - `upfrontCountedMinor` takes no `receivablesById` (Q3 wording): the credits map is keyed by the installments' own `receivableId`.

Repo: `~/Work/elMokhtbr/Mutaba3a/mini-crm`, package `server/` (hosted ledger, Hono + zod-openapi, Prisma/Postgres, Memory + Prisma stores behind `LedgerStore`).
Ticket: MUT-100 (Story, parent MUT-25, Backlog). Blocks MAL-1077 (Malafat UI). No blockers.

## Decisions locked

From intake (2026-10-12): bill once on the awarded amount; with CREDITED the firm keeps the upfront when commission < upfront; one rate per agreement, editable until outcome; Mutaba3a = hosted API, Malafat is the only writer.
From planning (2026-10-12, user):
- **D1 Commission VAT = rate in force on the outcome date**, frozen on the commission installment/receivable. Narrow override of M3 Decision 4 (supplements keep the agreement's frozen rate). Precedent: retainer term changes re-resolve the rate (`routes/retainers.ts:204`).
- **D2 Correction = credit the old commission receivable in full + post a new one**, atomically. Nothing deleted.
Engineering calls (mine):
- **D3 The commission is an installment** on the agreement (`isCommission = true`, trigger `DATE` on `outcomeDate`). Everything downstream — receivables, payments, allocations, credits, attachments, statuses, lazy-post crash healing — already works on installments. `DATE` makes `postingDateFor` return the outcome date, so a crash between the outcome write and the post heals through `listUnpostedDue` with the right date.
- **D4 Endpoints live under `/v1/agreements*`**: preview/create gain an optional `contingency` object; outcome + terms are sub-routes. Inherits the writability matrix row (`/v1/agreements*`), scopes and the Malafat `agreements-service` shape. No new route family.
- **D5 Contingency terms are nullable columns on `agreements`**, mirroring the RECURRING-only block (startMonth, billingDay, …). No join table.
- **D6 Summaries keep `kind`**: a contingency agreement is fixed-like (`kind: 'FIXED'`, counts in `agreed`); an additive `contingency` object carries rate, treatment, outcome state.

## 1. Data model — two migrations (R1/D3)

- Migration 1 `2026101218xxxx_mut100_agreement_type_contingency`: only `ALTER TYPE "AgreementType" ADD VALUE 'CONTINGENCY';` (a new enum value cannot be used in the transaction that adds it).
- Migration 2 `2026101218yyyy_mut100_contingency_terms` (sorts after 1): everything below.
- `CREATE TYPE "UpfrontTreatment" AS ENUM ('SEPARATE','CREDITED');`, `CREATE TYPE "ContingencyOutcome" AS ENUM ('AWARDED','NO_RECOVERY');`
- `agreements` (all nullable, CONTINGENCY only): `commissionRateBasisPoints INT`, `upfrontTreatment`, `outcome`, `outcomeDate VARCHAR(10)`, `awardedAmountMinor BIGINT`, `outcomeNote TEXT`, `outcomeRecordedAt TIMESTAMP(3)`.
- `installments`: `isCommission BOOLEAN NOT NULL DEFAULT false`.
- Raw-SQL CHECK: `type <> 'CONTINGENCY' OR (commissionRateBasisPoints BETWEEN 1 AND 10000 AND upfrontTreatment IS NOT NULL)`.
- Never edit an applied migration (MUT-59 lesson). Release note: verify `CONTINGENCY` exists in prod `pg_enum` after deploy.

## 2. Pure domain — new `src/agreements/contingency.ts`

- `commissionMinor(awardedMinor, rateBp)` = `roundHalfUpDiv(awarded × rate, 10000)` (vat.ts rule: half-up, symmetric).
- `upfrontCountedMinor({ installments, receivablesById, creditsByReceivableId, pricingBasis })` = Σ live, non-commission installments' `amountMinor` − Σ credits on their posted receivables **in the pricing basis**, read from the stored credit rows via `receivables.listCredits` (VAT_INCLUSIVE: Σ `amountMinor`; VAT_EXCLUSIVE: Σ `netMinor`) — R4/D6, never recomputed. Unposted / unpaid upfront still counts.
- `planOutcome({ outcome, treatment, awardedMinor, rateBp, upfrontCountedMinor })` → `{ commissionMinor, appliedUpfrontMinor, billableMinor }`. SEPARATE: billable = commission. CREDITED: applied = min(counted, commission), billable = commission − applied. NO_RECOVERY: zeros.
- `assertCommissionRate(bp)` → integer 1..10000 else 422 `COMMISSION_RATE_INVALID`.
- VAT on billable: `computeVat({ amountMinor: billable, pricingBasis, treatment: agreement.vatTreatment, rateBasisPoints: rateOn(outcomeDate) })`.

## 3. Create (extend existing)

- `AgreementPreviewRequestSchema` + optional `contingency: { commissionRateBasisPoints, upfrontTreatment }` (both required inside). `installments` minItems 1 → 0; FIXED keeps its rule through `splitInstallments` → `NO_INSTALLMENTS` (422, same code, detail now a reason instead of zod issues).
- `composePreview` (`agreements/create.ts`): with `contingency`, `amount ≥ 0`; amount 0 ⇒ `installments` must be `[]` and the schedule is skipped; amount > 0 ⇒ the normal schedule. Wire response echoes `type` + `contingency`.
- `createAgreementFromPreview`: `type` from the preview (hard-coded `'FIXED'` at `create.ts:66` today) + contingency columns. Fee-proposal approval passes FIXED unchanged.
- Preview token unchanged (covers body incl. `contingency` + rate).
- `cancel` (`routes/agreements.ts:265`): allow CONTINGENCY under the FIXED rule (nothing posted) **and** no outcome. Supplements (`:155`): refuse CONTINGENCY with `NOT_FIXED` (message updated). Changing the upfront amount after create is out of scope (credit it instead).

## 4. New routes in `routes/agreements.ts` (apiKey only, `agreements:write` for writes)

| Route | Notes |
|---|---|
| `PATCH /v1/agreements/{id}/contingency` | `If-Match`, body `{ commissionRateBasisPoints?, upfrontTreatment? }`; 422 `NOT_CONTINGENCY`, `CHANGE_NOTHING_CHANGED`; 409 `AGREEMENT_CANCELLED`, `OUTCOME_ALREADY_RECORDED`, `VERSION_MISMATCH`. Audit `agreement.contingency_terms_changed {from,to}`. |
| `POST /v1/agreements/{id}/outcome/preview` | `agreements:read`. Body `{ outcome, awardedAmount?, outcomeDate, note?, commissionLabel, dueDate?, correctionReason? }`. Returns `mode: RECORD|CORRECT`, commission, upfrontCounted, billable {amount,net,vat,gross}, vatRateBasisPoints, postingDate, dueDate, `replaces` (old installment/receivable) when correcting, `previewToken` over `[org,'outcome',id,agreement.version,body,rate,upfrontCountedMinor,commissionMinor,billableMinor,(replaced receivable id + version)]` (R2/D4: ledger-state inputs make a stale preview a 409, never a silent different posting). |
| `POST /v1/agreements/{id}/outcome` | Idempotency-Key + previewToken. 409 `OUTCOME_ALREADY_RECORDED` (points to /correct), `PREVIEW_STALE`. |
| `POST /v1/agreements/{id}/outcome/correct` | Idempotency-Key + previewToken; `correctionReason` required (becomes the credit's reason — caller-localized, no server i18n). Optional `commissionRateBasisPoints` / `upfrontTreatment` fix wrong terms in the same transaction (R3/D5; also accepted by the preview in CORRECT mode; audit records old and new terms). 409 `OUTCOME_NOT_RECORDED`, `OUTCOME_HAS_PAYMENTS` (commission receivable has paid or credited > 0; details name it). |

Validation: AWARDED needs `awardedAmount > 0` (`AMOUNT_INVALID`); NO_RECOVERY forbids it (422 `AMOUNT_INVALID`, `field: awardedAmount`); `outcomeDate` ≥ agreementDate and ≤ today (`OUTCOME_DATE_INVALID`); `commissionLabel` 1–80 (from Malafat, localized, like `newInstallment.label`); `VAT_RATE_MISSING` when billable > 0, standard-rated and no rate on outcomeDate. Posting date = outcomeDate; due = `dueDate ?? dueDateFor(outcomeDate, agreement.paymentTerms)` via `installmentDueDate`.
Audit: `agreement.outcome_recorded`, `agreement.outcome_corrected`, `installment.posted`, `receivable.credited` (as the credit flow does). Outcome events carry the figures behind the bill (CEO C2/D3): outcome, awarded, rateBasisPoints, upfrontTreatment, commission, upfrontCounted, billable {amount, net, vat, gross}, vatRateBasisPoints, commission receivableId; a correction adds the replaced receivableId and the old and new figures and terms. A route test pins each event's metadata. Money values in the metadata are canonical decimal strings via `formatMoney` and rates are integers, matching every existing audit payload (`create.ts` `gross: formatMoney(...)`); never raw minor-unit `bigint`s, which Prisma's `Json` column cannot serialize (eng re-review A5).

## 5. Store — `repositories/ports.ts`, `memory.ts`, `prisma.ts`

- Types: `AgreementType` + `'CONTINGENCY'`; `AgreementRecord`/`CreateAgreementInput` + contingency fields; `InstallmentRecord`/`CreateInstallmentInput` + `isCommission`.
- `AuditEventInput.metadata` becomes `Record<string, JsonValue>` (shared `JsonValue` type) so a `bigint` or `Date` in any audit payload is a typecheck error for both stores (eng re-review R9/D1); fix any caller the typecheck flags.
- `updateContingencyTerms(org, id, input, expectedVersion)` → `UpdateResult`.
- `recordOutcome(org, id, { outcome fields, commissionInstallment | null, totals, expectedVersion })` — one transaction: outcome columns, commission installment, agreement totals, version bump.
- `correctOutcome(org, id, { …same, credit: { receivableId, amountMinor, reason, effectiveDate } | null, voidInstallmentId | null })` — one transaction: full credit on the old receivable (refuse if paid/credited > 0 inside the txn), void old installment, write new outcome + installment, totals, version. **Highest-risk method.** Returns the store's existing `UpdateResult`-style discriminated result (`kind: 'ok' | 'not_found' | 'stale' | 'has_payments'`, as `applySupplement` callers already check `result.kind`); the in-transaction `InsufficientCapacity` from the credit is caught inside the store and returned as `has_payments`, which the route maps to 409 `OUTCOME_HAS_PAYMENTS` — never a 500 (CEO Section 2; required by the ticket AC). Store contract test: a payment allocated between preview and write → `has_payments`, nothing written.
- Posting reuses `postInstallment` after the transaction (as create does); `listUnpostedDue` heals a crash.
- Contract suite `repositories/__tests__/store-contract-mut100.ts` + `store-memory-mut100.test.ts` + `store-prisma-mut100.test.ts` (skips without `MUTABA3A_TEST_DATABASE_URL`).

## 6. Summaries — `summaries/compute.ts`, `routes/summaries.ts`

- `routes/summaries.ts:148`: load installments for FIXED **or CONTINGENCY** ACTIVE agreements.
- `projectFigures`: `fixed` selection and `agreedMinor` include CONTINGENCY; `fixedStatus(…, awaitingOutcome)` returns `PENDING` instead of `PAID_IN_FULL` while an ACTIVE contingency agreement has no outcome (paid upfront ≠ paid in full). `pending` {count, amount} unchanged (no fabricated amount).
- Wire: `ProjectSummary.contingency: { agreementId, commissionRateBasisPoints, upfrontTreatment, outcome: 'AWAITING'|'AWARDED'|'NO_RECOVERY', awarded: string|null } | null` (the project's ACTIVE contingency agreement; latest if several — `agreed` still sums all).
- ~~`OrganizationSummary.counts.awaitingOutcome`~~ — cut at D1 (no consumer; additive later).

## 7. Contract

- `schemas.ts`: Agreement `type` enum + `CONTINGENCY` (`:684`, list filter `:730`), `contingency` nullable sub-object (serializer mirrors `retainer`, `serializers.ts:170`), new request/response schemas, ProjectSummary `contingency`. `kind` unchanged. (No org-summary count — D1.)
- `app.ts` description: add 422 reasons `COMMISSION_RATE_INVALID`, `NOT_CONTINGENCY`, `OUTCOME_DATE_INVALID`; 409 reasons `OUTCOME_ALREADY_RECORDED`, `OUTCOME_NOT_RECORDED`, `OUTCOME_HAS_PAYMENTS`.
- `API_VERSION` (`app.ts:97`) `1.13.0-mut66` → `1.14.0-mut100`. `npm run openapi:generate`; root `npm run hosted:types` (CI does not run `hosted:types:check` — run it by hand).
- Malafat does not runtime-validate Mutaba3a responses (`AgreementSchema` is OpenAPI-doc only), so the new enum value ships first safely; re-vendoring is MAL-1077's job.

## 8. Hosted portal

No new view: the portal renders no agreements of any type (`src/hosted/api/client.ts:172-230`). It reads project summaries only; this design adds no project status value, so `StatusBadge` and `hosted.status.project.*` stay complete. Regenerate types; no new strings (en/ar only there).

## 9. Tests — TDD, written first

1. `src/agreements/__tests__/contingency.test.ts` (pure): the four AC examples; half-up rounding (33.33 % × 100.01); credits reduce counted in both pricing bases; unposted upfront counts; upfront 0; rate bounds 0/1/10000/10001; NO_RECOVERY zeros.
2. `src/summaries/__tests__/compute.test.ts`: contingency-only → kind FIXED, agreed = upfront; awaiting outcome + upfront paid → PENDING (not PAID_IN_FULL); after AWARDED → OUTSTANDING; hearing FIXED + contingency → agreed sums both, figures independent.
3. `src/__tests__/routes-mut100.test.ts` (per-file `harness()`/`firm()` like `routes-m3.test.ts`): create both treatments; upfront 0 with `[]`; FIXED with `[]` still `NO_INSTALLMENTS`; AC examples end to end (₪23,600 / ₪21,830 / nothing / NO_RECOVERY); **VAT change**: 17 % from 2024-01-01, 18 % from 2025-01-01, agreement 2024-06-01, outcome 2026-10-01 → upfront at 17 %, commission at 18 %; second outcome 409; terms after outcome 409; correct while unpaid → old receivable fully credited + old installment VOID + new posted; correct after a payment 409 `OUTCOME_HAS_PAYMENTS`; stale preview after a terms change; idempotent replay; session write → 403 `READ_ONLY_PROFILE`; cancel before outcome (nothing posted) ok; supplement → `NOT_FIXED`; crash heal: unposted commission posts on the next read dated outcomeDate; future / pre-agreement outcomeDate refused; audit events present.
4. Store contract suite (memory always, Prisma under `test:db`): correctOutcome all-or-nothing on a stale version and when the receivable gained a payment between preview and write.
5. Added by the eng review (all approved): **regression contract (R5/D7)** — every existing server suite passes unchanged; FIXED with `installments: []` → 422 `details.reason = NO_INSTALLMENTS` (route test); compute FIXED + RETAINER mix → kind FIXED, monthly set, agreed = FIXED sum. **R2/D4** — credit on the upfront between preview and record → 409 PREVIEW_STALE. **R3/D5** — correction fixes the rate (20 % → 25 %) and flips the treatment, audit carries old and new terms. **R4/D6** — pure row: two upfront credits whose recomputed split differs by 1 → counted uses the stored nets. **Correction matrix** — AWARDED→NO_RECOVERY (credit, void, nothing posted), NO_RECOVERY→AWARDED (no credit, new line), CREDITED-with-zero-billable→AWARDED larger award. **Concurrency** — two records racing: one wins, the other 409. **R1/D3** — both migrations apply in order on `test:db`.
6. Added by the CEO review (required proof of the approved validation contract): AWARDED with `awardedAmount` 0, negative or with 3 decimals → 422 `AMOUNT_INVALID`; NO_RECOVERY carrying `awardedAmount` → 422; AWARDED without `commissionLabel` → 422; a 20.5 % rate (2050 bp) is accepted and rounds half-up; a payment allocated inside the correction window → 409 `OUTCOME_HAS_PAYMENTS`, never 500 (Section 2).

Verify: `cd server && npm run typecheck && npm run lint && npm test && npm run test:db && npm run openapi:check`; root `npm run hosted:types:check && npm test`.

## 10. Knowledge (MUT lifecycle)

`.claude/designs/mut-100-contingency-agreements.md` + `-tests.md` (this plan is the draft; MUT requires user approval of the brief); ADR-056 (D1–D3, with the M3 Decision 4 override logged); CHANGELOG, SYSTEM_OVERVIEW, TEST_PLAN, PATTERNS (outcome-as-installment), `server/README.md` API list.

## 11. Fee proposals for contingency deals — DEFERRED (CEO C1/D2): not built in MUT-100; design kept for the follow-up ticket

- `fee_proposals` (migration 2): nullable `commissionRateBasisPoints`, `upfrontTreatment` (CHECK: both set or both null).
- `POST /v1/fee-proposals`: optional `contingency: { commissionRateBasisPoints, upfrontTreatment }`; with it, `amount` is the proposed upfront and may be `0` (FIXED keeps `> 0`).
- `POST /v1/fee-proposals/{id}/approve`: `amount` is the agreed upfront (`≥ 0` for a contingency proposal); optional `contingency` override records the agreed terms, mirroring how `amount` already overrides the proposed amount; `schedule` becomes optional and is required only when the agreed upfront is `> 0` (422 `SCHEDULE_REQUIRED`). Approval builds the preview body with `contingency` and calls `composePreview` + `createAgreementFromPreview` with type CONTINGENCY in the same transaction (existing `approveProposal` option). Agreed terms are audited on `fee_proposal.approved`.
- `FeeProposal`, `FeeProposalSummary` and the customer row's open proposals echo `contingency` (rate + treatment) so Malafat can show "₪1,500 + 20 %".
- `CurrencySummary.proposed` adds a contingency proposal's proposed upfront; the commission never counts (R7/D9). Test: one fixed + one contingency proposal.
- Tests: propose contingency (upfront 1500 and 0); approve with and without a terms override; approve upfront 0 without a schedule; upfront > 0 without a schedule → 422 `SCHEDULE_REQUIRED`; FIXED approve unchanged (regression contract R5 covers routes-m8); one open proposal per project still enforced across types.

## Risks

1. `correctOutcome` atomicity (credit + void + new installment + totals) — contract-tested on both stores.
2. Enum `ADD VALUE` in a migration transaction — keep the value unused in that migration; verify in prod after deploy.
3. FIXED `installments: []` error detail changes from zod issues to `details.reason = NO_INSTALLMENTS` — Malafat already keys on `details.reason`.
4. Two contingency agreements on one project — summary shows the latest ACTIVE; documented, not prevented.

