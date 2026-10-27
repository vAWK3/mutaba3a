# MUT-480 — Lower an agreement's fee in one atomic call (unbilled installments first, then credits)

Status: PLAN (eng-ticket, 2026-10-27). Not built. Jira Backlog → Planned.
Tracker: Jira · barmajiyat · MUT via atlassian-barmajiyat · Backlog → Planned → In Progress (eng-build) → In Review (qa-reconcile).

## Neighborhood
- Epic MUT-25. No formal blockers.
- Blocks **MAL-1424** ("Lower the fee"), which is also blocked by MAL-1415 (Change sheet).
- **MUT-443** (Backlog): "aligned with MUT-443's reason rule" means a reason is required. MUT-443 isn't built, so this ticket defines the reason codes and MUT-443 reuses them (D3).
- **MUT-444** (Backlog): the same credit machinery (`receivables.credit` under a lock). No route overlap.
- **MUT-478** (statement): shows these credits as CREDIT lines with `reasonCode` (its D7).
- Existing tools this composes:
  - `POST /v1/agreements/{id}/supplements` (`routes/agreements.ts:136-236`, `agreements/supplement.ts`): negative only within unposted capacity, and every touched installment must stay > 0;
  - `POST /v1/receivables/{id}/credits` (`routes/receivables.ts:88-139`, `payments/credit.ts`): ≤ outstanding, VAT split at the receivable's frozen rate.

## Where the code is today
- `planSupplement` works in the pricing basis (`amountMinor`) and refuses to take an installment to 0. Voiding is an existing state (`installments.voidedAt`, status VOIDED via `itemStatus`), used by cancel and the contingency correction (`prisma.ts:1566,1590`).
- Credits: `splitCredit` and `checkCredit` are pure. The store's `receivables.credit` re-checks capacity under a row lock and throws `InsufficientCapacity`.
- Preview tokens:
  - agreements hash the body and the rate;
  - payments hash `(id, version)` of the receivables they touch (`payments/preview-token.ts`);
  - outcome hashes its computed figures (PATTERNS "when a figure depends on ledger state").
- Serialize writes to one aggregate with `SELECT … FOR UPDATE` on the agreement row, then version-check (PATTERNS, `correctOutcome`).

## Decisions (D1 and D2 APPROVED by Basel 2026-10-27; the rest recommended defaults)

**D1 — FIXED agreements only.** Retainers are out (the ticket says so), and are refused with 422 `NOT_FIXED`. Contingency is refused with 422 `NOT_FIXED` too, with the existing supplement message ("reduce a contingency upfront with a credit"). MAL-1424 names fixed fees and retainers only. Alternative: allow a CONTINGENCY upfront before the outcome. That's a small extension later if Malafat asks.

**D2 — Exact gross on VAT-exclusive agreements.** The partner types a gross amount, but an installment stores its amount in the pricing basis, and on a VAT-exclusive agreement some gross figures can't be reached (gross = net + round(net × rate)).
- The plan zeroes whole installments (void) and changes at most one installment partially, so there is at most one rounding point.
- Any agora left over moves to the credit step when there is one, so the result is exact.
- When nothing is posted, the preview reports `applied` (what the firm will actually see), which can differ from the request by at most one minor unit, with `roundedBy`.
- VAT-inclusive agreements are always exact.

**D3 — Reason codes:** `DISCOUNT`, `GOODWILL`, `ENTERED_BY_MISTAKE`, `CLIENT_DISPUTE`, `OTHER`. `reasonCode` is required and `note` (≤ 500) is optional. `OTHER` without a note is 422 `REASON_REQUIRED`, the code MUT-443 names.
- Credits get a nullable `reasonCode` column (null on older credits). `reason` text stays required on the row: it holds the note, or the code when there's no note.
- `POST /v1/receivables/{id}/credits` accepts an optional `reasonCode` too, so a retainer month credited from the ledger (MAL-1424's retainer path) carries one. This is additive.

**D4 — The agreement keeps a record of the reduction, in its supplements list.**
- Each reduction writes an `AgreementSupplement` row with negative `amountMinor` (the gross reduced) and `distribution = REDUCTION`, a new enum value added in its own migration (PATTERNS "a new enum value gets its own migration").
- The row also carries `reasonCode` and `creditedMinor` (the part that became credits).
- `GET /v1/agreements/{id}` therefore shows the history, and the audit event `agreement.reduced` points at the row.
- Alternative: audit only. Rejected because the agreement detail is where Malafat's matter Money tab reads history (MAL-1413).

**D5 — `to` is a new effective total**, where effective total = Σ live installments' gross − Σ credits on the agreement's receivables. Then `by = effective − to`.
- `to ≥ effective` is 422 `AMOUNT_INVALID` (not a reduction).
- `by ≤ 0` is 422 `AMOUNT_INVALID`.
- `by > unbilled + outstanding` is 422 `REDUCTION_EXCEEDS_OPEN`, with `{unbilled, outstanding, maximum}`.

**D6 — Order.** First the unbilled (live, unposted) installments, latest position first. Then the open posted receivables of this agreement, latest `postingDate` first (then position). Credits are dated today in the organization's calendar.

## API
- `POST /v1/agreements/{agreementId}/reduce/preview`. Scope `agreements:read`, API key. Writes nothing.
- `POST /v1/agreements/{agreementId}/reduce`. Scope `agreements:write`, API key, `idempotent(store, 'agreements.reduce')`, with `previewToken`.
- Body: `{ by?: Amount, to?: Amount }` (exactly one; 422 otherwise), plus `reasonCode` and `note?`.
- The preview returns:
  - `installments[]`: `{id, position, label, before: {amount, net, vat, gross}, after: {…} | null(voided)}`;
  - `credits[]`: `{receivableId, receivableNumber?, amount, net, vat}`;
  - `requested`, `applied`, `roundedBy`;
  - `outstanding: {before, after}` (this agreement's) and `effectiveTotal: {before, after}`;
  - `previewToken`.
- The commit returns the agreement detail, plus the supplement row and the created credits.
- Errors:
  - 404 for an unknown agreement;
  - 422 `NOT_FIXED`, `AMOUNT_INVALID`, `REDUCTION_EXCEEDS_OPEN`, `REASON_REQUIRED`;
  - 409 `AGREEMENT_CANCELLED`;
  - 409 `PREVIEW_STALE` (token mismatch, or a capacity/version race under the lock).
- The token hashes `[org, 'agreement-reduce', agreementId, agreement.version, body, installments (id, version, receivableId, voidedAt) sorted, receivables (id, version) sorted]`. A payment or credit landing in between, or a lazy post, bumps something and makes the token stale.

## Files
- `server/src/agreements/reduce.ts` (new, pure). `planReduction({ byGrossMinor, pricingBasis, rateBasisPoints, unposted[], openReceivables[] })` returns `{ ok, installmentChanges, voids, credits, appliedMinor, roundedByMinor }` or a refusal. It uses `computeVat` for the installment amount, with the installment's own `vatTreatment` and the agreement's frozen rate, the same as `planSupplement` (inverse via `roundHalfUpDiv`, then re-check gross), and `splitCredit` for credits. Table tests:
  - VAT-inclusive vs exclusive;
  - zero-rated and exempt installments;
  - the reduction lands exactly on an installment boundary;
  - the agora moves to the credit step;
  - nothing is posted;
  - nothing is unbilled;
  - more than is open;
  - mixed VAT treatments per installment.
- `server/src/routes/agreements.ts`: the two routes, beside supplements. Shared validation goes in one `loadReducible(store, org, id)` (`mustGet`, FIXED, ACTIVE).
- `server/src/repositories/ports.ts` + `prisma.ts` + `memory.ts`: `agreements.reduce(org, id, { expectedVersion, installmentUpdates, voidIds, credits[], supplement }, at)`, one transaction.
  - Lock the agreement `FOR UPDATE` and check its version (otherwise `stale`).
  - Update installments with conditional writes (`receivableId IS NULL AND voidedAt IS NULL`). A miss returns `stale` (PATTERNS "a void and a post race").
  - For each credit, lock the receivable and check capacity (otherwise `InsufficientCapacity`), then insert the credit, bump the sums and re-settle via `settleReceivable`.
  - Recompute the agreement totals from the live installments, bump the version and insert the supplement row.
  - It returns a typed result, never an escaping exception (PATTERNS).
  - Contract tests run on both stores, including a race with `postInstallment` and a race with a payment allocation (Postgres `test:db`, `Promise.allSettled`).
- `prisma/schema.prisma` + two migrations:
  - (a) `ALTER TYPE "SupplementDistribution" ADD VALUE 'REDUCTION'` on its own;
  - (b) `agreement_supplements.reasonCode`, `agreement_supplements.creditedMinor BigInt default 0`, and `receivable_credits.reasonCode VARCHAR(32) NULL`.
- `server/src/schemas.ts`:
  - new: `ReduceRequestSchema`, `ReducePreviewResponseSchema`, `ReduceResponseSchema`, and `CreditReasonCodeSchema` (exported for MUT-443);
  - additive: `CreditSchema.reasonCode`, `SupplementSchema.reasonCode`/`credited`, `CreditRequestSchema.reasonCode?`.
- `server/src/serializers.ts`: credit and supplement serializers.
- `server/src/app.ts`: bump `API_VERSION` (next free minor `-mut480`) and add the description bullet. Update the pinned literals, then `openapi:generate`.
- Local mode: the snapshot gains `credit.reasonCode` and the supplement fields. Bump `CURRENT_STORE_SNAPSHOT_VERSION` (`memory.ts:201`) to the next free number at merge (MUT-478 and MUT-479 bump it too) with a default-filling migration, and update the fingerprint and `everyRecord` tests. `prisma-records-export.ts` selects the new columns.

## Tests (written first)
- `agreements/__tests__/reduce.test.ts`: the pure tables above.
- `__tests__/agreement-reduce.route.test.ts`, one per acceptance criterion:
  - AC1: below unbilled, only installments change, and no credit is written;
  - AC2: above unbilled, every unbilled installment is voided and the rest is credited latest first;
  - AC3: more than open → 422 `REDUCTION_EXCEEDS_OPEN` with the figures;
  - AC4: a missing reason code is 422, and `OTHER` with no note is 422 `REASON_REQUIRED`;
  - AC5: a payment after the preview → 409 `PREVIEW_STALE`;
  - AC6: the version is pinned.
- Further route tests:
  - idempotent replay posts once;
  - one audit event `agreement.reduced` with before/after;
  - `to` and `by` give the same plan;
  - retainer and contingency → 422 `NOT_FIXED`;
  - cancelled → 409;
  - another organization's agreement → 404;
  - the customer summary's outstanding drops by exactly `applied` minus what came off unbilled-not-yet-due.
- Store contract tests as above.

Verify through `heavy`, under Node 22: the server typecheck, lint, `openapi:check` and test; `test:db` in CI; root `test:run` for local mode.

## Release-QA
Feature `reduce` in `qa/features/portal/malafat-money-api.yaml` (MUT-478 creates the file; whichever lands first creates it). The steps:
- Seed a 3-installment agreement with the first posted and partly paid.
- Preview a reduction above the unbilled amount, then commit it.
- Expect the voided installments, a credit with `reasonCode`, and the outstanding after.

The spec uses Playwright `request` with the QA integration key. Malafat's MAL-1424 specs cover the sheet.

## Knowledge
- ADR (next free): "Lowering the fee is one planned write: unbilled first, then credits; exact gross via a single rounding point" (D2, D4, D6).
- PATTERNS: the gross-to-pricing-basis inverse with the rounding point named.
- CHANGELOG, TEST_PLAN.
- Comment on MUT-443 that its reasons reuse `CreditReasonCodeSchema`.

## Scope check
Covers all 6 ACs. Out of scope: refunds, retainers, contingency (D1).
Gaps in the ticket:
- the ticket says installments go "to zero", but the model forbids a zero installment, so they're voided (same meaning, existing state);
- the ticket doesn't say where the reduction is recorded (D4);
- the gross rounding on VAT-exclusive agreements (D2).

## Business / product impact
- A partner gives a discount or forgives part of a fee in one action, and the client's balance is right immediately. Today it takes two tools, and Malafat isn't allowed to split the amount itself (ADR-150).
- It unblocks MAL-1424 in the Money overhaul (MAL-1410), and retires Malafat's "Credit a receivable" modal.
- Risk: it's money arithmetic on posted figures. It's contained by pure tested planning, one locked transaction and a balance-hashing preview token.
