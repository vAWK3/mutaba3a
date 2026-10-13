# MUT-107 — Contingency fee proposals: propose upfront + rate, approval creates the agreement

Epic: MUT-25. Blocked by MUT-100 (merged to local main `061693b`, Jira In Review — blocker clear). Blocks MAL-1094 (Malafat proposal UI, Idea).

Design is not new: this is MUT-100 plan §11 (`.claude/designs/mut-100-contingency-agreements.md:116-123`), deferred by the MUT-100 CEO review (C1/D2) because MAL-1077 excluded it, with two decisions already locked in that review:

- **D9** — `CurrencySummary.proposed` adds a contingency proposal's upfront only; the commission never counts.
- **D10** — `ApproveFeeProposalRequest.schedule` becomes optional, required only when the agreed upfront is `> 0` (422 `SCHEDULE_REQUIRED`, also for FIXED — an intentional, reviewed regression).

This brief turns §11 into concrete files. No new design questions except one flagged below (point 6).

## Problem

Since M8, approving a fee proposal is how every agreement is born (MUT-40/MAL-943) — except CONTINGENCY, which MUT-100 can only create directly (`POST /v1/agreements`), with no client-approval record. `fee_proposals` has no columns to describe "₪1,500 now plus 20% of the award."

## Scope (in) — exactly the MUT-100 §11 list

1. `fee_proposals`: nullable `commissionRateBasisPoints`, `upfrontTreatment` (CHECK both-or-neither).
2. `POST /v1/fee-proposals`: optional `contingency`; with it, `amount` is the proposed upfront and may be 0.
3. `POST /v1/fee-proposals/{id}/approve`: `amount` is the agreed upfront (`≥ 0` for a contingency proposal); optional `contingency` override; `schedule` optional, required only when the agreed upfront `> 0`. Approval builds the preview body with `contingency` and calls the existing `composePreview` + `createAgreementFromPreview(..., { approveProposal })`, which already derives `type: CONTINGENCY` from `body.contingency` (`agreements/create.ts:181`) — **no change needed there**.
4. `FeeProposal`, `FeeProposalSummary`, and the customer row's open-proposal echo carry `contingency` (rate + treatment).
5. `CurrencySummary.proposed` — **zero code change**: it already sums `proposedAmountMinor` (`routes/summaries.ts:64`), which is the upfront for a contingency proposal by construction (point 2). Confirmed by reading the reducer; only a test is needed (one fixed + one contingency proposal).

## Files to touch

### 1. Schema + migration

- `server/prisma/schema.prisma:838-867` (`model FeeProposal`) — add:
  ```prisma
  commissionRateBasisPoints Int?
  upfrontTreatment          UpfrontTreatment?
  ```
  (Reuses the `UpfrontTreatment` enum MUT-100 already created — no new enum. Prisma doesn't model CHECK constraints here, matching how the `agreements` CONTINGENCY CHECK is raw-SQL-only, not in schema.prisma.)
- New migration `server/prisma/migrations/<ts>_mut107_contingency_fee_proposals/migration.sql`:
  ```sql
  -- MUT-107: contingency terms on fee proposals (the proposed upfront lives in the existing proposedAmountMinor).
  ALTER TABLE "fee_proposals" ADD COLUMN "commissionRateBasisPoints" INTEGER,
  ADD COLUMN "upfrontTreatment" "UpfrontTreatment";

  ALTER TABLE "fee_proposals" ADD CONSTRAINT "fee_proposals_contingency_terms_check"
    CHECK (("commissionRateBasisPoints" IS NULL) = ("upfrontTreatment" IS NULL));
  ```
  Run `npx prisma migrate dev` (or the repo's documented equivalent) to regenerate the client, not a hand-rolled migration id — follow whatever `npm run` script MUT-100's migrations used.

### 2. Ports (`server/src/repositories/ports.ts`)

- `FeeProposalRecord` (ports.ts:1133-1157): add `commissionRateBasisPoints: number | null; upfrontTreatment: UpfrontTreatment | null;`.
- `CreateFeeProposalInput` (ports.ts:1159-1169): add `commissionRateBasisPoints?: number; upfrontTreatment?: UpfrontTreatment;` (both present or both absent, enforced by the route).
- `ApproveProposalInput` — **unchanged** (see point 6, the one flagged decision).
- Import `UpfrontTreatment` from `../agreements/contingency.js` (already imported there for `AgreementRecord`).

### 3. Repositories

- `server/src/repositories/prisma.ts` — `feeProposals.create` (~line 508-519): the `tx.feeProposal.create({ data: { ...input, ... } })` already spreads `input`, so the new optional fields pass through to Prisma as-is (`undefined` → column stays `NULL`). No code change beyond what the spread already does — verify, don't rewrite.
- `server/src/repositories/memory.ts` — `feeProposals.create` (~line 618-637): currently `{ id, ...input, status: 'PROPOSED', ... }`. Make the two new fields explicit nulls when absent, matching the agreements-record pattern at memory.ts:706 (`commissionRateBasisPoints: commissionRateBasisPoints ?? null`): `commissionRateBasisPoints: input.commissionRateBasisPoints ?? null, upfrontTreatment: input.upfrontTreatment ?? null`.
- `agreements.create`'s `approveProposal` block in both stores (prisma.ts:572-579, memory.ts:719-731) — **unchanged** (point 6).

### 4. Domain validation reuse (no new module)

`server/src/agreements/contingency.ts` already exports `isCommissionRate` and `COMMISSION_RATE_RULE` — reuse both in the route, exactly as `agreements/create.ts:151-154` does and as `routes/contingency.ts:4` already imports them (`import { COMMISSION_RATE_RULE, isCommissionRate } from '../agreements/contingency.js';` — same relative path applies from `routes/fee-proposals.ts`). No new validation module.

### 5. Schemas (`server/src/schemas.ts`)

- `CreateFeeProposalRequestSchema` (1360-1369): add `contingency: ContingencyTermsSchema.optional()`.
- `ApproveFeeProposalRequestSchema` (1404-1413): change `schedule: ApproveScheduleSchema` → `schedule: ApproveScheduleSchema.optional()`; add `contingency: ContingencyTermsSchema.optional()`.
- `FeeProposalSchema` (1352-1377): add `contingency: ContingencyTermsSchema.nullable()`.
- `FeeProposalSummarySchema` (1380-1382): add `contingency: ContingencyTermsSchema.nullable()`.
- `CustomerSummaryProposalSchema` (1319-1321): add `contingency: ContingencyTermsSchema.nullable()`.
- Error-reason union (~560-628): add `'SCHEDULE_REQUIRED'` under a new `// MUT-107` comment block. Reuse the existing `'NOT_CONTINGENCY'` and `'COMMISSION_RATE_INVALID'` reasons already in the union (added by MUT-100) — no duplicates.

### 6. Serializers (`server/src/serializers.ts`)

- `serializeFeeProposal` (402-423) and `serializeFeeProposalSummary` (425-428): both add
  ```ts
  contingency: p.commissionRateBasisPoints === null ? null : { commissionRateBasisPoints: p.commissionRateBasisPoints, upfrontTreatment: p.upfrontTreatment! },
  ```

### 7. Route (`server/src/routes/fee-proposals.ts`)

**Create** (lines 51-93): after computing `proposedAmountMinor`, branch on `body.contingency`:
```ts
const contingency = body.contingency ?? null;
if (contingency && !isCommissionRate(contingency.commissionRateBasisPoints)) {
  throw validationError('COMMISSION_RATE_INVALID', `contingency.${COMMISSION_RATE_RULE}`, { field: 'contingency.commissionRateBasisPoints' });
}
if (contingency ? proposedAmountMinor < 0n : proposedAmountMinor <= 0n) {
  throw validationError('AMOUNT_INVALID', contingency ? 'the upfront (amount) must not be negative' : 'amount must be positive', { field: 'amount' });
}
```
(replaces the current unconditional `if (proposedAmountMinor <= 0n) ...`). Pass `commissionRateBasisPoints: contingency?.commissionRateBasisPoints, upfrontTreatment: contingency?.upfrontTreatment` into the `store.feeProposals.create(...)` call. Add `pricingBasis`/`proposedAmount`/`contingency` fields to the `fee_proposal.created` audit metadata (mirror MUT-100's `agreement.created` pattern at `create.ts:95`).

**Approve** (lines 154-193):
```ts
const isContingency = current.commissionRateBasisPoints !== null;
const agreedAmountMinor = parseAmount(body.amount, currency);
if (isContingency ? agreedAmountMinor < 0n : agreedAmountMinor <= 0n) {
  throw validationError('AMOUNT_INVALID', isContingency ? 'the agreed upfront (amount) must not be negative' : 'amount must be positive', { field: 'amount' });
}
if (body.contingency && !isContingency) {
  throw validationError('NOT_CONTINGENCY', 'contingency override given for a proposal that was not proposed as contingency', { field: 'contingency' });
}
if (body.contingency && !isCommissionRate(body.contingency.commissionRateBasisPoints)) {
  throw validationError('COMMISSION_RATE_INVALID', `contingency.${COMMISSION_RATE_RULE}`, { field: 'contingency.commissionRateBasisPoints' });
}
if (agreedAmountMinor > 0n && !body.schedule) {
  throw validationError('SCHEDULE_REQUIRED', 'schedule is required when the agreed amount is greater than 0', { field: 'schedule' });
}
const previewBody: PreviewBody = {
  projectId: current.projectId,
  amount: body.amount,
  pricingBasis: current.pricingBasis,
  agreementDate: approvedOn,
  paymentTerms: 'EOM',
  installments: body.schedule ? approveInstallments(body.schedule, agreedAmountMinor, currency, today) : [],
  ...(isContingency ? { contingency: { commissionRateBasisPoints: body.contingency?.commissionRateBasisPoints ?? current.commissionRateBasisPoints!, upfrontTreatment: body.contingency?.upfrontTreatment ?? current.upfrontTreatment! } } : {}),
};
```
Audit metadata (`fee_proposal.approved`, line 190): add `schedule: body.schedule?.kind ?? null` (was unconditional `body.schedule.kind`) and, when `isContingency`, the agreed `commissionRateBasisPoints`/`upfrontTreatment`.

### 8. Summary echo (`server/src/routes/summaries.ts`)

- Line 55 (`ownProposals` map): add `contingency: p.commissionRateBasisPoints === null ? null : { commissionRateBasisPoints: p.commissionRateBasisPoints, upfrontTreatment: p.upfrontTreatment }`.
- `proposed` at line 64 — unchanged (point 5).
- Project-level `FeeProposalSummarySchema` serialization (`routes/summaries.ts:182`, via `serializeFeeProposalSummary`) — gets `contingency` for free once point 6 lands.

### 9. OpenAPI contract

Run `npm run openapi:check` after the schema changes; regenerate if the repo's workflow requires committing a generated spec file (check how MUT-100 handled this — its branch bumped `OpenAPI 1.16.0-mut100` per memory). Bump to the next contract version for MUT-107.

### 10. `server/README.md`

Follows the exact pattern of the MUT-100 line already there (line 107, "MUT-100: the same `POST /v1/agreements(/preview)` with `contingency {...}`..."): add a MUT-107 line documenting that `POST /v1/fee-proposals(/{id}/approve)` now accepts the same `contingency` shape, `schedule` is optional on approve (required only when the agreed upfront is `> 0`), and approval creates a CONTINGENCY agreement through the existing path. Required by the CLAUDE.md knowledge-update protocol (§ Self-Managed Knowledge System) — also update `CHANGELOG.md`, `SYSTEM_OVERVIEW.md` (API surface grew), and `.claude/DECISIONS.md` (ADR-059's "until MUT-107/MAL-1094" caveat is now resolved on the API side — note MAL-1094 is still the pending UI half) after implementation.

## 6. Open decision: does an approval's `contingency` override persist back onto the `fee_proposals` row?

The MUT-100 §11 scope line adds exactly **one** nullable column pair to `fee_proposals` (not a second "agreed" pair, unlike `agreedAmountMinor` which already exists separately from `proposedAmountMinor`). Recommendation: **no new column** — the single pair holds the *proposed* terms, set at creation and never rewritten by approval. An approval's `contingency` override flows only into the newly created **Agreement** (which already has its own `commissionRateBasisPoints`/`upfrontTreatment` from MUT-100), exactly like today: `FeeProposal.contingency` after approval still echoes what was originally proposed, and the agreement (`GET /v1/agreements/{id}`, already shipped) is the source of truth for what was actually agreed. This keeps the migration to the literal §11 scope and avoids an extra write-site in two stores for a field with no named consumer. Flagging this because it's the one place the brief could be read either way — confirm before implementation, or treat silence as acceptance of this reading.

## Acceptance criteria (from the ticket, unchanged)

- Propose a contingency deal with upfront ₪1,500 and with ₪0.
- Approve with and without a terms override; the created agreement carries the agreed terms.
- Approve a ₪0-upfront proposal without a schedule → 201.
- Approve with upfront > 0 and no schedule → 422 `SCHEDULE_REQUIRED`, including for FIXED.
- Proposed with one fixed (₪10,000) and one contingency (₪1,500 + 20%) proposal = ₪11,500.
- One open proposal per project is still enforced across both types (already type-agnostic — point 6 of the research, no change needed, `repositories/prisma.ts:508-519`).
- Every existing `routes-m7`/`routes-m8` test passes unchanged (they always send `schedule`, per `routes-m7.test.ts:64`).

## Tests (TDD — written first)

New file `server/src/__tests__/routes-mut107.test.ts` (per-file harness, matching `routes-mut100.test.ts`'s style):
1. Propose contingency, upfront ₪1,500 → 201, `contingency` echoed.
2. Propose contingency, upfront ₪0 → 201.
3. Propose contingency with an out-of-range rate (0, 10001) → 422 `COMMISSION_RATE_INVALID`.
4. Propose contingency with a negative upfront → 422 `AMOUNT_INVALID`; FIXED propose with ₪0 still 422 `AMOUNT_INVALID` (regression).
5. Approve a contingency proposal with no override → agreement carries the originally proposed terms.
6. Approve a contingency proposal with a `contingency` override → agreement carries the overridden terms; `FeeProposal.contingency` (per point 6's decision) still shows the original proposed terms.
7. Approve a ₪0-upfront contingency proposal without `schedule` → 201, no installments, agreement `type: CONTINGENCY`.
8. Approve a contingency proposal with upfront > 0 and no `schedule` → 422 `SCHEDULE_REQUIRED`.
9. Approve a FIXED proposal with no `schedule` → 422 `SCHEDULE_REQUIRED` (the reviewed regression, R8/D10).
10. Approve a FIXED proposal with a `contingency` override → 422 `NOT_CONTINGENCY`.
11. One open proposal per project still refuses a second regardless of type mix (409 `PROPOSAL_OPEN`).
12. `GET /v1/summaries/organization`: one FIXED (₪10,000) + one CONTINGENCY (₪1,500 upfront) proposal on two different projects → `proposed` = ₪11,500; customer row for the contingency one carries `contingency: { commissionRateBasisPoints, upfrontTreatment }`.
13. Store-contract test (`store-contract-m8.ts` or a new `store-contract-mut107.ts`, memory + Prisma under `test:db`): `feeProposals.create` persists and round-trips `commissionRateBasisPoints`/`upfrontTreatment`; the DB CHECK rejects one-set-one-null via a raw insert (Prisma `test:db` only).
14. Full regression: `routes-m7.test.ts` and `routes-m8.test.ts` pass unchanged.
15. Edge case (no new code expected, confirm as a regression guard): a contingency approve with agreed upfront `0` but a `schedule` sent anyway — `approveInstallments` builds a 0-amount installment, which the existing `scheduleOrThrow` path should already refuse with `NON_POSITIVE_INSTALLMENT` (the same guard that protects every other agreement type). If it doesn't, that's a real gap this ticket must close, not a pre-existing one to ignore.

Verify: `cd server && npm run typecheck && npm run lint && npm test && npm run test:db && npm run openapi:check`.

## Business / product impact

Closes the one gap in M8's "approval creates the agreement" model (MUT-40/MAL-943): contingency deals — likely the highest-value engagements a firm takes (litigation, recovery work) — currently skip the client-approval record entirely. Sits under MUT-25 (shared money core) and unblocks MAL-1094, the paired Malafat proposal-UI ticket that was the reason MUT-100 deferred this; shipping both together is what makes the CONTINGENCY type usable from the product the firm's staff actually opens, not just the direct API.
