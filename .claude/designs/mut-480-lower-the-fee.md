# MUT-480 — Lower an agreement's fee in one atomic call (unbilled installments first, then credits)

Status: BUILT on feature/mut-480-lower-the-fee (2026-10-28; eng-build). Numbers moved at build: API 1.85.0-mut480, ADR-222, TD-281 (MUT-441 took 1.84.0 and ADR-220, MUT-491 ADR-221); snapshot 10; migrations 20261028170000/170100. One deviation, recorded in ADR-222 and TD-281: D8's `raced` is a null from postInstallment plus the trigger's re-read, not a new result type. Planned 2026-10-27; re-checked against main a6ebbbbe on 2026-10-28 ("Revision 2026-10-28" wins where it differs). Jira In Progress.
Tracker: Jira · barmajiyat · MUT via atlassian-barmajiyat · Backlog → Planned → In Progress (eng-build) → In Review (qa-reconcile).

## Revision 2026-10-28 (after MUT-478 merged)

**R1. Post what's due before planning.** The preview and the commit both call `postDueItems` (through `lazyPostingOf`, like `GET /v1/agreements/{id}`, `routes/agreements.ts:129-130`) before they read the installments. Otherwise a DATE installment whose date has arrived counts as "unbilled". The preview then shows a void on something that is about to become a receivable, and the commit would always miss its conditional write and answer `PREVIEW_STALE`.

**R2. The receivables come from the installments.** The open receivables are the live posted installments' `receivableId`s, read with the existing `receivables.getByIds` (one query, no new filter). The effective total reads `creditedMinor` from the same rows, settled ones included.

**R3. Under the lock, check each credited receivable's version, not only its capacity.** The store's `agreements.reduce` takes `expectedReceivableVersions`. A payment landing between the token check and the lock then answers 409 `PREVIEW_STALE`, even when the capacity would still hold, so the "outstanding after" the partner saw is what lands.

**R4. D7: never void every installment of an agreement with nothing billed.** Suppose nothing is posted and the reduction would void every live installment. That's a zero fee, so the answer is 422 `USE_CANCEL` ("cancel the agreement instead"); an ACTIVE agreement with no live installments is a state nothing reads today. Once something is posted, voiding every unbilled installment is AC2 and allowed. (Recommended default; Basel to confirm.)

**R5. D2, made precise.** The one partial installment moves to the smallest gross that is at least its target. That way the installment step never takes off more than asked, and the gap (< 1 minor unit of net) goes to the credit step. `applied < requested` (`roundedBy > 0`) happens only when **no open receivable** can take that leftover, not only when "nothing is posted".

**R6. The numbers are now:**
- API `1.84.0-mut480`;
- `CURRENT_STORE_SNAPSHOT_VERSION` 10 (still "next free at merge");
- ADR-220 and TD-274 onward (DECISIONS stops at 219, TECH_DEBT at 273).

**R7. Credits carry their receivable number.** `credits[].receivableNumber` is the CHG number, required: MUT-478 numbers every posted receivable.

**R8. The statement shows the reason code.** The statement's CREDIT line (`statements/serialize.ts:43`) has `reason` only. Add `reasonCode` (nullable, additive), which is what MUT-478's D7 promised, and update its schema and test.

**R9. Where the QA lives.** It's `qa/features/portal-selfservice/malafat-money-api.yaml` and `qa/specs/portal-selfservice/malafat-money-api.spec.ts` (MUT-478 created both, app `portal-selfservice`), not `qa/features/portal/`. Add feature `reduce` there.

**R10. How to merge.** It adds migrations, so warn the orchestrator and ask the other mini-crm sessions before migrating `mutaba3a_test`. Then:
1. take `/tmp/mutaba3a-locks/mini-crm-main` and merge;
2. `migrate deploy` dev + test, then `prisma generate`;
3. touch `server/src/index.ts` and check `:8787/health`.

This is the recipe that worked for MUT-478.

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

## Eng review 2026-10-28 (/plan-eng-review)
Target: this file (`.claude/designs/mut-480-lower-the-fee.md`), Revision 2026-10-28 included. Base: main a6ebbbbe.

Scope record: feature answers: none proposed; structure: A Original arrangement (D1, Basel 2026-10-28); accepted scope: the plan as written plus Revision R1–R10; pending remedies: E1, E2, E3, E4.

## Decision ledger

### E1: posting checks the installment version it read
Finding: 1, CRITICAL, confidence 9/10, `server/src/repositories/prisma.ts:1426,1459-1460`, native reviewer.
Plan baseline: the plan protects the reduce side only (conditional writes `receivableId IS NULL AND voidedAt IS NULL`); posting is unchanged.
Runtime evidence: `postInstallment` reads the installment outside its transaction (`const current = await this.prisma.installment.findFirst(...)`, :1426), creates the receivable from `current.grossMinor` (:1449), then claims the line with `updateMany({ where: { id: current.id, receivableId: null, voidedAt: null } })` (:1460), with no version check. `applySupplement` changes amounts and bumps `version` (prisma.ts applySupplement, `version: { increment: 1 }`). So a lazy post that read before a reduction committed bills the pre-reduction gross. The same race exists today for supplements.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| E1 posting version guard | none | `version: current.version` in the claim (both stores) + contract race test, in this branch | unchanged; TODO filed |
| E2 reason in token | pending | pending | pending |
| E3 receivable check reuse | pending | pending | pending |
| E4 USE_CANCEL | pending | pending | pending |
Question D2:
D2 — Make posting refuse an installment that changed after it was read?
ELI10: Billing a due installment reads its amount, then claims it a moment later. If a reduction lowers that installment in between, the bill goes out at the old, higher amount and the client owes more than the agreement says. One extra condition on the claim (the version it read) closes it; a lost race then simply posts on the next read.
Stakes if we pick wrong: a client is billed the pre-discount amount while the agreement shows the discount; nobody sees an error.
Recommendation: A because it is a one-line guard per store plus a race test, and MUT-480 makes this race much likelier than supplements did.
Completeness: A=10/10, B=4/10
Header: Posting race
Options:
A) Guard in this branch (recommended)
Add `version: current.version` to postInstallment's claim in prisma.ts and the same check in memory.ts; a lost claim returns null and the line posts on the next read. Contract test on both stores: post races a reduction, the receivable carries the reduced gross. (human: ~3h / CC: ~15min)
B) Leave it, file a TODO
Keep posting as is and record the race in TECH_DEBT. The reduction ships with a known window where a concurrent lazy post bills the old amount.

State: approved
Actual answer: A) Guard in this branch (D2, Basel 2026-10-28)
Accepted scope: `version: current.version` in postInstallment's claim (prisma.ts) and the same check in memory.ts; a lost claim returns null and posts on the next read; contract race test on both stores (post races a reduction → the receivable carries the reduced gross).
History: none

### E2: the reason stays out of the preview token
Finding: 2, INFORMATIONAL, confidence 9/10, plan body "The token hashes `[org, 'agreement-reduce', agreementId, agreement.version, body, …]`" (API section), native reviewer.
Plan baseline: the token hashes the whole body, `reasonCode` and `note` included.
Runtime evidence: MUT-100 review D3 (commit 310ce1b8) took `correctionReason` out of the outcome preview token on purpose: "it is the credit note's text and moves no figure, so a preview with or without it matches the commit", with a route test ("a correction previewed without its reason commits with one"). The reduce token would undo that rule.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| E1 posting version guard | approved A (D2) | approved A (D2) | approved A (D2) |
| E2 reason in token | body incl. reasonCode, note | token hashes `by`/`to` only; reasonCode and note excluded; route test as MUT-100's | unchanged (whole body) |
| E3 receivable check reuse | pending | pending | pending |
| E4 USE_CANCEL | pending | pending | pending |
Question D3:
D3 — Leave the reason code and note out of the preview token?
ELI10: The preview token proves the partner saw the same figures they are committing. The reason and note change no figure. If they are hashed, a partner who previews, then picks a reason or fixes a typo in the note, gets a "stale preview" error for nothing. MUT-100 already decided this for outcome corrections.
Stakes if we pick wrong: Malafat's sheet throws PREVIEW_STALE whenever the reason is chosen after the amount, which is the natural order.
Recommendation: A because it follows the MUT-100 D3 rule and the reason moves no money.
Completeness: A=10/10, B=6/10
Header: Token reason
Options:
A) Exclude the reason (recommended)
The token hashes org, agreement id and version, the amount (`by` or `to`), the installments' (id, version, receivableId, voidedAt) and the receivables' (id, version); not reasonCode or note. Route test: previewed without a reason, committed with one, succeeds; a different amount under the same token is stale. (human: ~1h / CC: ~5min)
B) Keep the whole body
The token keeps hashing reasonCode and note; the preview must be re-run whenever the reason or note changes.

State: approved
Actual answer: A) Exclude the reason (D3, Basel 2026-10-28)
Accepted scope: the token hashes org, agreement id and version, the amount (`by` or `to`), the installments' (id, version, receivableId, voidedAt) and the receivables' (id, version); reasonCode and note are excluded. Route test: previewed without a reason, committed with one, succeeds; a different amount under the same token is stale.
History: none

### E3: the receivable re-check reuses the MUT-100/MUT-130 helpers (factual correction, no question)
Finding: 3, INFORMATIONAL, confidence 9/10, `server/src/repositories/prisma.ts:3196-3202` (`upfrontMoved`), `:3240` (`lockReceivablesInIdOrder`), `:3245` (`settleReceivable`), `:1657` (`asStaleOnLockConflict`), native reviewer.
Plan baseline: R3 (check each credited receivable's version under the lock; a race answers 409 `PREVIEW_STALE`), approved with the plan.
Runtime evidence: `upfrontMoved` already locks receivables in id order and compares versions; `lockReceivablesInIdOrder` is the deadlock-avoiding order payments use; `asStaleOnLockConflict` turns a 40P01/40001 into `stale`.
Correction: build R3 on these. In one transaction, in this order:
1. agreement `FOR UPDATE` + version;
2. installments, with conditional writes;
3. `upfrontMoved` over the credited receivables (renamed `receivablesMoved`; its two contingency callers are updated);
4. per credit, insert the row, then `settleReceivable`, all wrapped like `asStaleOnLockConflict`.

The credits are written inside the reduce transaction, never through `receivables.credit` (its own transaction). The behavior doesn't change, so there's no question.

### E4: a reduction that would void every installment with nothing billed
Finding: 4, INFORMATIONAL, confidence 7/10, Revision R4 (D7), native reviewer.
Plan baseline: R4 recommends 422 `USE_CANCEL`; not yet approved by Basel.
Runtime evidence: `AgreementStatus` is only ACTIVE / CANCELLED (`prisma/schema.prisma:111-114`); no current write leaves an ACTIVE fixed agreement with zero live installments (supplements refuse a zero installment, `agreements/supplement.ts`: "Every touched installment must stay strictly positive"). How every reader treats that state is unverified.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| E1 | approved A (D2) | same | same | same |
| E2 | approved A (D3) | same | same | same |
| E4 all-void, nothing billed | undefined | 422 `USE_CANCEL` | allowed: ACTIVE, zero live installments, totals 0 | allowed and the agreement is cancelled in the same write |
Question D4:
D4 — What happens when a reduction would wipe out the whole fee before anything is billed?
ELI10: If nothing has been billed yet and the partner lowers the fee by all of it, every installment would be voided and the agreement would be worth zero. Today nothing in the app ever leaves an active agreement with no installments, so its screens and totals have never seen that state. Cancelling the agreement already exists and means the same thing.
Stakes if we pick wrong: B leaves an agreement that looks live but bills nothing, in a state no screen was built for; C quietly turns "lower the fee" into "cancel", which the partner did not ask for.
Recommendation: A because it keeps the two actions distinct and creates no new state; Malafat shows "Cancel the agreement instead".
Note: options differ in kind, not coverage — no completeness score.
Header: Fee to zero
Options:
A) Refuse: USE_CANCEL (recommended)
Only when nothing is posted and the reduction would void every live installment: 422 `USE_CANCEL` ("cancel the agreement instead"). Preview and commit both refuse. Route test for it. Once anything is posted, voiding every unbilled installment stays allowed (AC2). (human: ~1h / CC: ~5min)
B) Allow a zero fee
The agreement stays ACTIVE with no live installments and totals 0. Needs a check of every reader (summary, statement, Malafat's matter tab) for that new state.
C) Allow, and cancel it
The same write voids everything and cancels the agreement, with the reduction recorded. "Lower the fee" can then end an agreement.

State: approved
Actual answer: A) Refuse: USE_CANCEL (D4, Basel 2026-10-28)
Accepted scope: only when nothing is posted and the reduction would void every live installment, preview and commit answer 422 `USE_CANCEL` ("cancel the agreement instead"); route test. Once anything is posted, voiding every unbilled installment stays allowed (AC2).
History: R4 recommended this default on 2026-10-28 before the question.

### Outside voice (in-host Plan subagent, 2026-10-28; Codex not installed): corrections that need no question
These follow from approved values, so each is recorded with its evidence and needs no answer:
- **O-F4: R3 covers every posted receivable.** It now version-checks, under the lock, every posted receivable of the agreement that fed the effective total and the token, not only the credited ones. It's one locked SELECT (`receivablesMoved`, id order). R3's stated goal ("the outstanding after the partner saw is what lands") is approved; checking only the credited set leaves AC1 unprotected.
- **O-F6: E1 says how the reduce write treats versions.** The reduce write increments `installment.version` on every amount change and puts the version the planner read in its WHERE. E1 depends on it (`applySupplement` does the same, prisma.ts:1489).
- **O-F8: the preview doesn't claim to write nothing.** Its description must not say "Writes nothing", because R1 runs `postDueItems` first (as `GET /v1/agreements/{id}` does).
- **O-F9: `maximum` is the largest accepted amount.** On `REDUCTION_EXCEEDS_OPEN` it's what would be accepted. With nothing posted that's unbilled minus one minor unit, because the full unbilled amount answers `USE_CANCEL` (E4).
- **O-F10: the scope is a deliberate choice.** The commit's credits are under `agreements:write`, not `payments:write`, the same precedent as the contingency correction. The ADR states this.

### O1: the VAT-exclusive rounding gap (reopens D2)
Finding: outside voice 1, High; plan R5 and D2 vs AC1.
Plan baseline: D2 (approved by Basel 2026-10-27, Jira comment 12812): a leftover agora goes into the credit step when there is one, otherwise `roundedBy` ≤ 1.
Runtime evidence:
- A partial installment (the only rounding point) exists only when `by < unbilled`; at or above unbilled every unbilled installment is voided.
- So the leftover-to-credit rule only fires in the AC1 case. There it writes a lone 0.01 credit, which AC1 forbids ("changes only unbilled installments") and which shows as a CREDIT line on the statement.
- When `by` is below one gross step, nothing changes at all.
Reason for reopening: a concrete contradiction with AC1 that wasn't visible when D2 was approved.
Comparison grid:
| Choice | Current | A Apply | B Keep | C Investigate | D Defer |
|---|---|---|---|---|---|
| O1 rounding gap | leftover → credit, else roundedBy | never a credit: always `roundedBy` (≤ 1 minor unit), and `applied = 0` → 422 `AMOUNT_INVALID` | D2 as approved (stray 0.01 credit; AC1 test exempts VAT-exclusive) | check whether a second unbilled installment can absorb the agora exactly, then return | build with D2; revisit at qa-reconcile |
| O2–O5 | pending | pending | pending | pending | pending |
Question D5:
D5 — On VAT-exclusive fees, should the leftover agora still become a credit?
ELI10: On a VAT-exclusive fee, some gross amounts can't be reached exactly (gross = net + rounded VAT). Your rule was: if part of the fee is billed, put the leftover 0.01 into a credit so the total is exact. But the leftover only appears when the reduction is smaller than the unbilled part. In that case the ticket says only unbilled installments change, so the rule writes a stray 0.01 credit the ticket forbids, and it shows on the client's statement.
Stakes if we pick wrong: B puts 0.01 credit lines on statements and breaks AC1; A means the preview sometimes says "rounded by 0.01" instead of being exact.
Recommendation: A because a ≤ 0.01 gap the preview shows beats a phantom credit on the ledger, and it keeps AC1 true.
Completeness: A=9/10, B=6/10, C=7/10, D=4/10
Header: Rounding gap
Options:
A) Apply: no stray credit (recommended)
The installment step never credits a leftover. On VAT-exclusive agreements the preview and commit report `applied` and `roundedBy` (≤ 1 minor unit) whenever the gross can't be hit exactly. A reduction that would apply 0 answers 422 `AMOUNT_INVALID`. Pure table tests for both. Amends D2 (Jira note). (human: ~1h / CC: ~10min)
B) Keep D2 as approved
The leftover moves into a 0.01 credit on the latest open receivable. AC1's test exempts VAT-exclusive standard-rated agreements.
C) Investigate exactness first
Bounded: check whether nudging a second unbilled installment by one net unit always reaches the exact gross. Nothing changes until I come back with the answer.
D) Defer this change
Build with D2 as written and decide at qa-reconcile.

State: approved
Actual answer: A) Apply: no stray credit (D5, Basel 2026-10-28)
Accepted scope: the installment step never credits a leftover; on VAT-exclusive agreements preview and commit report `applied` and `roundedBy` (≤ 1 minor unit) when the gross can't be hit exactly; `applied = 0` answers 422 `AMOUNT_INVALID`; pure table tests for both; D2 amended (Jira note).
History: D2 approved 2026-10-27 (Jira 12812) as the baseline.

### O2: the agreement detail shows the effective total
Finding: outside voice 2, High, `server/src/agreements/create.ts:110-117`, `serializers.ts` agreement serializer.
Plan baseline: `to` measures the effective total (D5), which only the reduce preview returns.
Runtime evidence: after an AC2 reduction, `agreement.grossMinor` is still the sum of live installments, posted credited ones at full gross included. So `GET /v1/agreements/{id}` doesn't show the `to` the partner typed. Credits made through `POST /receivables/{id}/credits` also count toward D5 and appear in no supplement row.
Comparison grid:
| Choice | Current | A Apply | B Keep | C Investigate | D Defer |
|---|---|---|---|---|---|
| O2 effective total on detail | absent | `credited` + `effectiveTotal` added to the agreement detail (additive), from the posted receivables' `creditedMinor` | preview only | ask Malafat (MAL-1424/1413) which figure the Money tab shows, then return | follow-up ticket |
Question D6:
D6 — Show the effective total (fee minus credits) on the agreement itself?
ELI10: "Lower the fee to 9,000" measures against the fee minus everything already credited. The agreement screen today shows only the installments' total, which keeps counting a billed installment at full price even after part of it was credited. So after the partner lowers the fee to 9,000, the agreement still says 10,000.
Stakes if we pick wrong: Malafat's Money tab shows a fee that disagrees with what the partner just typed, and Malafat can't compute it itself (ADR-150).
Recommendation: A because two additive fields fix it at the source for one extra read the detail route already makes.
Completeness: A=9/10, B=5/10, C=7/10, D=4/10
Header: Effective total
Options:
A) Apply: add to the detail (recommended)
`GET /v1/agreements/{id}` and the reduce response gain `credited` and `effectiveTotal` (gross), computed from the posted receivables' `creditedMinor` (one `getByIds`). Additive OpenAPI change; route test. (human: ~2h / CC: ~10min)
B) Keep: preview only
The effective total stays visible only in the reduce preview.
C) Investigate with Malafat
Confirm which figure MAL-1413's Money tab shows before adding fields; nothing changes meanwhile.
D) Defer to a follow-up
Ship without it and file a MUT ticket.

State: approved
Actual answer: A) Apply: add to the detail (D6, Basel 2026-10-28)
Accepted scope: `GET /v1/agreements/{id}` and the reduce response gain `credited` and `effectiveTotal` (gross) from the posted receivables' `creditedMinor` (one `getByIds`); additive OpenAPI change; route test.
History: none

### O3: what a REDUCTION supplement row holds
Finding: outside voice 3, Medium, `routes/agreements.ts:211`, `schemas.ts:1955`, `schema.prisma:986`.
Plan baseline: D4: `amountMinor` is the gross reduced (negative), `distribution = REDUCTION`, plus `reasonCode` and `creditedMinor`.
Runtime evidence:
- Existing rows hold `amountMinor` in the pricing basis (net on VAT-exclusive).
- `resultingAmountMinor` is set to the new agreement amount, which is also pricing basis.
- `SupplementSchema.distribution` is a closed `z.enum`, and `effectiveDate` is NOT NULL with no field for it in the body.
Comparison grid:
| Choice | Current | A Apply | B Keep | C Investigate | D Defer |
|---|---|---|---|---|---|
| O3 row shape | gross in `amountMinor` | `amountMinor` = pricing-basis change to installments (≤ 0, like other rows), `resultingAmountMinor` as today, new `creditedMinor` + `appliedGrossMinor` (gross), `effectiveDate` = today (org), enum widening noted on MAL-1424 | plan as written | read Malafat's client for the enum switch first | follow-up |
Question D7:
D7 — Make the reduction's history row add up like the other supplement rows?
ELI10: Each fee change leaves a row in the agreement's history. Existing rows store the change on the same basis as the fee (net on VAT-exclusive fees). The plan stored the reduction as gross in that same column, so one list would mix two bases and "amount" and "resulting amount" wouldn't add up. The fix keeps the column consistent and adds two clear gross fields (applied, credited). It also dates the row today and warns Malafat that the distribution list gains a value.
Stakes if we pick wrong: Malafat's history shows numbers that don't add up, and a strict client could break on the new REDUCTION value.
Recommendation: A because the row reconciles with its neighbours and the gross figures are still there, named.
Completeness: A=9/10, B=5/10, C=7/10, D=4/10
Header: History row
Options:
A) Apply: consistent row (recommended)
`amountMinor` = the pricing-basis change to the installments (≤ 0), `resultingAmountMinor` = the new agreement amount (as today), new columns `appliedGrossMinor` and `creditedMinor`, `effectiveDate` = today in the org's calendar. A comment on MAL-1424 notes `distribution` gains REDUCTION. (human: ~2h / CC: ~10min)
B) Keep the plan's row
Gross in `amountMinor`; the list mixes bases.
C) Investigate Malafat's client
Check how Malafat's generated client handles an unknown `distribution` before deciding; nothing changes meanwhile.
D) Defer
Build as planned; fix in a follow-up.

State: approved
Actual answer: A) Apply: consistent row (D7, Basel 2026-10-28)
Accepted scope: REDUCTION row: `amountMinor` = pricing-basis change to the installments (≤ 0), `resultingAmountMinor` = new agreement amount, new columns `appliedGrossMinor` and `creditedMinor`, `effectiveDate` = today (org calendar); comment on MAL-1424 that `distribution` gains REDUCTION.
History: none

### O4: a lost posting race is told apart from a void (reopens E1's wording)
Finding: outside voice 5, Medium, `server/src/repositories/prisma.ts:1465-1470`, `server/src/routes/installments.ts:42,49-52`.
Plan baseline: E1 (D2): "a lost claim returns null and posts on the next read".
Runtime evidence: the manual trigger route maps a null result to 404 `NOT_FOUND` unless the line is voided. A line voided by a reduction answers 409 `AGREEMENT_CANCELLED` "The agreement is cancelled" while the agreement is still ACTIVE.
Comparison grid:
| Choice | Current | A Apply | B Keep | C Investigate | D Defer |
|---|---|---|---|---|---|
| O4 race result | null (→ 404 on the manual trigger) | `postInstallment` returns `{ kind: 'raced' }` on a version loss → 409 `VERSION_MISMATCH` (retry); a reduction-voided line → 409 reason `INSTALLMENT_VOIDED` | null, as approved in E1 | list every caller of postInstallment first | follow-up |
Question D8:
D8 — When billing loses the race to a reduction, should the manual "bill now" button get a retry, not a "not found"?
ELI10: Your earlier answer added a check so billing never uses an old amount. When billing loses that race, the code returns "nothing". The manual "bill now" endpoint reads "nothing" as "no such installment", which is false. Separately, if a reduction voided the installment, the endpoint says "the agreement is cancelled", which is also false.
Stakes if we pick wrong: Malafat shows "not found" or "agreement cancelled" on a live agreement after a reduction.
Recommendation: A because a distinct result costs a few lines and gives the right, retryable answer.
Completeness: A=10/10, B=5/10, C=7/10, D=4/10
Header: Race answer
Options:
A) Apply: distinct answers (recommended)
`postInstallment` gets a `raced` outcome (both stores). The manual trigger answers 409 `VERSION_MISMATCH` (retry) for it, and 409 with reason `INSTALLMENT_VOIDED` (not "agreement cancelled") for a line a reduction voided. The lazy poster skips raced lines. Route tests. (human: ~2h / CC: ~10min)
B) Keep null
E1 as answered: the manual trigger can answer 404 or "cancelled" after a reduction.
C) Investigate callers
List every postInstallment caller and its null handling first; nothing changes meanwhile.
D) Defer
Ship with null; fix in a follow-up.

State: approved
Actual answer: A) Apply: distinct answers (D8, Basel 2026-10-28)
Accepted scope: `postInstallment` returns a `raced` outcome on a version loss (both stores); the manual trigger answers 409 `VERSION_MISMATCH` for it and 409 reason `INSTALLMENT_VOIDED` for a line a reduction voided; the lazy poster skips raced lines; route tests. Supersedes E1's "returns null" wording.
History: E1 approved 2026-10-28 (D2) with "a lost claim returns null".

### O5: each reduction credit gets its own audit event
Finding: outside voice 7, Medium, `server/src/routes/contingency.ts:213-222`, `routes/audit.ts:51`.
Plan baseline: one audit event, `agreement.reduced` (the ticket's wording).
Runtime evidence: the outcome correction, which also writes credits inside an agreement write, emits `receivable.credited` per credit (`source: 'OUTCOME_CORRECTION'`, `agreementId`) besides its agreement event. A receivable's audit trail would otherwise miss reduction credits.
Comparison grid:
| Choice | Current | A Apply | B Keep | C Investigate | D Defer |
|---|---|---|---|---|---|
| O5 per-credit audit | `agreement.reduced` only | `agreement.reduced` + one `receivable.credited` per credit (`source: 'REDUCTION'`, `agreementId`) | `agreement.reduced` only | check the operator console's audit views first | follow-up |
Question D9:
D9 — Should each credit a reduction writes also show in that receivable's audit trail?
ELI10: The ticket says the reduction writes one audit event on the agreement. But every other place that credits a charge also logs on the charge itself, so someone looking at one charge's history sees why its balance dropped. Without it, a reduction's credits are invisible from the charge's side.
Stakes if we pick wrong: an operator investigating a charge sees its balance drop with no event explaining it.
Recommendation: A because it matches the outcome-correction precedent; the "one event" in the ticket still holds for the reduction itself.
Completeness: A=9/10, B=6/10, C=7/10, D=4/10
Header: Credit audit
Options:
A) Apply: log each credit (recommended)
Keep the single `agreement.reduced`, and add one `receivable.credited` per credit with `source: 'REDUCTION'` and `agreementId`, like the outcome correction. Route test counts the events. (human: ~30min / CC: ~5min)
B) Keep one event
Only `agreement.reduced`, as the ticket words it.
C) Investigate consumers
Check the operator console's audit views first; nothing changes meanwhile.
D) Defer
Ship with one event; add later.

State: approved
Actual answer: A) Apply: log each credit (D9, Basel 2026-10-28)
Accepted scope: keep one `agreement.reduced`, plus one `receivable.credited` per credit with `source: 'REDUCTION'` and `agreementId`; route test counts the events.
History: none

Approval readiness: PASS. Checked: E1 (D2), E2 (D3), E3 (factual correction), E4 (D4), O1 (D5), O2 (D6), O3 (D7), O4 (D8), O5 (D9), and the O-F4/F6/F8/F9/F10 corrections (each follows from an approved value).

## Review body (eng review 2026-10-28)

### Section findings
- **Scope Challenge:** the scope is accepted as-is (D1: original layout). No new architectural pattern; every concurrency tool is an existing PATTERNS entry (agreement `FOR UPDATE` + version, conditional installment writes, id-ordered receivable locks, preview tokens over balances) [Layer 1].
- **Architecture:** 3 issues: E1 (posting race, CRITICAL 9/10), E4 (a zero fee, 7/10), O2 (effective total not visible, outside voice).
- **Code quality:** 4 issues: E2 (reason in the token), E3 (reuse the existing lock helpers), O3 (the supplement row's basis), O4 (null mis-mapped by the manual trigger).
- **Tests:** 5 gaps closed by tests below. The plan had no test for R1 lazy posting, R3/O-F4 receivable moves, R8 the statement `reasonCode`, the O1 rounding table, or the E1/O4 posting race.
- **Performance:** no issues. Per request: `postDueItems` (existing, org-wide), `listInstallments` (1), `receivables.getByIds` (1). Inside the transaction: per credit one insert + `settleReceivable`, with K ≤ the agreement's installments, typically under 24. No new index: installments are read by `agreementId`, receivables by id.

### Flow
```
POST /reduce/preview|/reduce (API key)
  → mustGet agreement → FIXED? (422 NOT_FIXED) → ACTIVE? (409 AGREEMENT_CANCELLED)
  → postDueItems (R1)
  → listInstallments + receivables.getByIds(posted)  ──► effective total, unbilled, outstanding
  → resolve by|to (D5) → validate reason (commit only: reasonCode required; OTHER needs note)
  → planReduction (pure)
       unbilled latest-first: void whole / one partial (smallest gross ≥ target; gap → roundedBy, O1)
       then credits latest-open-first (splitCredit)
       refusals: AMOUNT_INVALID (incl. applied 0) · REDUCTION_EXCEEDS_OPEN{maximum} · USE_CANCEL (E4)
  → preview: token(org, id, version, by|to, installments(id,version,receivableId,voidedAt), receivables(id,version))  [no reason, E2]
  → commit: token match? else 409 PREVIEW_STALE
       tx: agreement FOR UPDATE + version
           → installment writes WHERE receivableId IS NULL AND voidedAt IS NULL AND version = read (bump version, O-F6)
           → receivablesMoved(all posted, id order) (R3, O-F4) → credits: insert + settleReceivable
           → totals, version++, REDUCTION supplement row (O3)
           any miss / lock conflict → stale → 409 PREVIEW_STALE
       audit: agreement.reduced + receivable.credited per credit (O5)
postInstallment (existing, E1/O4): claim WHERE … AND version = read → else { kind: 'raced' }
```

### Test coverage (planned; nothing is built)
```
CODE PATHS                                              USER FLOWS (Malafat "Lower the fee" sheet)
[+] agreements/reduce.ts planReduction                  [+] Preview → commit
  ├── [GAP→T] VAT-incl / excl / zero / exempt / mixed     ├── [GAP→T] AC1 below unbilled: installments only
  ├── [GAP→T] boundary on an installment edge             ├── [GAP→T] AC2 above unbilled: voids + credits
  ├── [GAP→T] gap → roundedBy, never a credit (O1)        ├── [GAP→T] reason chosen after preview (E2)
  ├── [GAP→T] applied 0 → AMOUNT_INVALID (O1)             └── [GAP→T] double submit → one write (idempotent)
  ├── [GAP→T] nothing unbilled / nothing posted          [+] Error states
  └── [GAP→T] all void, nothing posted → USE_CANCEL (E4)  ├── [GAP→T] 422 REDUCTION_EXCEEDS_OPEN {maximum} (O-F9)
[+] routes/agreements.ts reduce + preview               ├── [GAP→T] 422 REASON_REQUIRED / missing reasonCode
  ├── [GAP→T] due DATE line billed before planning (R1)   ├── [GAP→T] 422 NOT_FIXED (retainer, contingency)
  ├── [GAP→T] by vs to same plan                          ├── [GAP→T] 409 AGREEMENT_CANCELLED / 404 other org
  ├── [GAP→T] detail shows credited/effectiveTotal (O2)   └── [GAP→T] 409 PREVIEW_STALE (payment after preview)
  └── [GAP→T] audit: 1 agreement.reduced + N credited (O5)
[+] store agreements.reduce (both stores, contract)     [+] Manual trigger after a reduction (O4)
  ├── [GAP→T][→E2E test:db] races postInstallment (E1)    ├── [GAP→T] raced → 409 VERSION_MISMATCH
  ├── [GAP→T][→E2E test:db] races a payment allocation    └── [GAP→T] voided by reduction → 409 INSTALLMENT_VOIDED
  └── [GAP→T] receivable moved, not credited → stale (O-F4)
[+] statements/serialize.ts CREDIT line reasonCode (R8)  [GAP→T]
[+] memory.ts snapshot v10 migration + fingerprint       [GAP→T] (existing everyRecord test extended)
[+] postInstallment existing behavior                     [★★★ TESTED] store-contract-mut100 (voided line never posts) — kept green
COVERAGE: 0/27 planned paths built (plan review). Every path has a named test in Implementation Tasks.
```
Tests to retire: none.

### NOT in scope
- Refunds of money already paid (ticket scope out; over the open amount answers 422).
- Retainers and contingency (D1; 422 `NOT_FIXED`).
- Malafat's sheet (MAL-1424 owns it, and it's blocked on MAL-1415 too).
- MUT-443's payment-correction reasons: this ticket only exports `CreditReasonCodeSchema` for it.

### What already exists (reused, not rebuilt)
- `computeVat`, `roundHalfUpDiv` (vat.ts); `splitCredit`, `checkCredit` (payments/credit.ts); the shape of `planSupplement` (agreements/supplement.ts).
- `postDueItems` + `lazyPostingOf` (agreements/posting.ts, auth/middleware.ts); `receivables.getByIds`.
- `upfrontMoved` (renamed `receivablesMoved`), `lockReceivablesInIdOrder`, `settleReceivable`, `isLockConflict` (prisma.ts).
- `previewToken` (preview-token.ts); `idempotent` middleware; the outcome correction's audit precedent (routes/contingency.ts:213-222).

### Failure modes
| Path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| Preview → commit | payment lands in between | token over receivable versions + `receivablesMoved` | 409 `PREVIEW_STALE`, re-preview |
| Commit vs lazy post | post read the old amount | E1 version guard, O4 `raced` | no wrong bill; the post retries on the next read |
| Commit vs allocation | deadlock on receivable rows | id-order locks + `isLockConflict` → stale | 409, retry |
| VAT-exclusive gross | can't hit the exact gross | O1 `roundedBy` in the preview | "rounded by 0.01" shown before commit |
| Double submit | network retry | `idempotent(store, 'agreements.reduce')` | one reduction |
| Old snapshot restored | missing reasonCode fields | snapshot v10 default-filling migration | restore works |
No silent failure without a test: **0 critical gaps**.

### Worktree parallelization strategy
Sequential implementation, no parallelization opportunity. Every step meets in `server/src/repositories` and `server/src/routes/agreements.ts`.

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above. Effort assumes features ~30x and tests ~50x human ÷ CC.

- [ ] **T1 (P1, human: ~3h / CC: ~15min)**: repositories: version guard and `raced` outcome on `postInstallment`.
  - Surfaced by: E1 (D2), O4 (D8).
  - Files: server/src/repositories/prisma.ts, memory.ts, ports.ts, routes/installments.ts, agreements/posting.ts.
  - Verify: store contract (both stores) + `test:db` race; route tests for 409 `VERSION_MISMATCH` / `INSTALLMENT_VOIDED`.
- [ ] **T2 (P1, human: ~1d / CC: ~30min)**: agreements: pure `planReduction`.
  - Surfaced by: D2 as amended by O1 (D5), E4 (D4), O-F9.
  - Files: server/src/agreements/reduce.ts, agreements/__tests__/reduce.test.ts.
  - Verify: table tests, including an exhaustive gross-inverse sweep over amounts 1..20000 at 1700/1800 bp.
- [ ] **T3 (P1, human: ~1d / CC: ~30min)**: store `agreements.reduce`, one transaction.
  - Surfaced by: R3, E3, O-F4, O-F6, O3 (D7).
  - Files: prisma.ts, memory.ts, ports.ts, prisma/schema.prisma, 2 migrations.
  - Verify: contract tests on both stores; Postgres races with `postInstallment` and an allocation.
- [ ] **T4 (P1, human: ~1d / CC: ~30min)**: routes: preview + commit.
  - Surfaced by: R1, E2 (D3), O5 (D9), O-F8.
  - Files: routes/agreements.ts, schemas.ts, serializers.ts.
  - Verify: `__tests__/agreement-reduce.route.test.ts`, one test per AC plus the gaps above.
- [ ] **T5 (P1, human: ~2h / CC: ~10min)**: detail `credited` / `effectiveTotal`.
  - Surfaced by: O2 (D6).
  - Files: routes/agreements.ts, serializers.ts, schemas.ts.
  - Verify: a route test after an AC2 reduction shows `effectiveTotal` = `to`.
- [ ] **T6 (P2, human: ~2h / CC: ~10min)**: credit `reasonCode` on the credit route + the statement CREDIT line.
  - Surfaced by: D3, R8.
  - Files: routes/receivables.ts, statements/serialize.ts, schemas.ts.
  - Verify: the statement route test asserts `reasonCode`.
- [ ] **T7 (P2, human: ~2h / CC: ~15min)**: local mode + version wiring.
  - Snapshot v10 migration, records export columns, `API_VERSION` 1.84.0-mut480, `openapi:generate`.
  - Surfaced by: R6.
  - Verify: root `test:run`; `openapi:check`.
- [ ] **T8 (P2, human: ~3h / CC: ~20min)**: release-QA feature `reduce`.
  - Surfaced by: R9.
  - Files: qa/features/portal-selfservice/malafat-money-api.yaml, qa/specs/portal-selfservice/malafat-money-api.spec.ts.
  - Verify: `release-qa run --attach --only reduce`.
- [ ] **T9 (P2, human: ~1h / CC: ~10min)**: knowledge files and tickets.
  - Knowledge: ADR-220 (D2 as amended, D4/O3, E4, the `agreements:write` scope O-F10), PATTERNS (gross inverse; post-claim version guard), CHANGELOG, TEST_PLAN.
  - Jira: comments on MUT-443 (CreditReasonCodeSchema) and MAL-1424 (REDUCTION enum, `effectiveTotal`).
  - Surfaced by: O3, O-F10.

### Reality rows
REALITY: premise-table pass 14 claims checked against code, unverified=1 (E4's readers of a zero-installment agreement, made moot by D4) server/src/repositories/prisma.ts:1459
REALITY: already-done pass no MUT-480 code on local main; the branch sits at main a6ebbbbe .claude/designs/mut-480-lower-the-fee.md:3
REALITY: surface-check pass the routes are new; the reused helpers exist (getByIds, upfrontMoved, postDueItems) server/src/repositories/ports.ts:982
REALITY: binding-decisions finding D2 (Basel 2026-10-27) amended by D5 with an explicit reopen record; D1 untouched .claude/designs/mut-480-lower-the-fee.md:300
REALITY: numbers pass API 1.83.0→1.84.0, snapshot 9→10, ADR 219→220, TD 273→274 [measured: app.ts:270, memory.ts:203, DECISIONS.md, TECH_DEBT.md]
REALITY: deferred-asks pass all 6 ACs covered; MAL-1424 retainer path uses the credit route's optional reasonCode (T6) server/src/routes/receivables.ts:92
REALITY: pr-count pass one branch, one local merge (no PRs; pushing is not allowed in this repo) .claude/designs/mut-480-lower-the-fee.md:44
REALITY: transaction-semantics pass no driver/pool change; new writes use the existing interactive-transaction idiom server/src/repositories/prisma.ts:1436

### Completion summary
- Step 0, Scope Challenge: scope accepted as-is.
- Reality rows: 8/8 applicable rows emitted; 1 unverified premise (made moot by D4).
- Architecture Review: 3 issues found.
- Code Quality Review: 4 issues found.
- Test Review: diagram produced; 5 gaps identified.
- Performance Review: 0 issues found.
- NOT in scope: written.
- What already exists: written.
- TODOS.md updates: 0 items proposed. The supplement posting race E1 fixes is fixed here, so there's no TODO.
- Failure modes: 0 critical gaps flagged.
- Unresolved decisions: 0 in this review.
- Outside voice: in-host Plan subagent, completed. Codex is not installed, so there's no external-provider coverage. 10 findings: 5 approved changes (D5–D9) and 5 corrections.
- Parallelization: 0 lanes; sequential.
- Lake Score: 8/8 answers picked the 10/10 or highest-scored option (D2–D9).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | native fallback (Plan subagent; Codex not installed) | Independent 2nd opinion | 1 | unavailable (in-host completed) | 10 findings, 5 approved changes, 5 corrections |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open (all mapped to tasks) | 12 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — (server only) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** Codex isn't installed, so there's no external provider. An in-host Plan subagent completed inside the 5-minute window with 10 findings. Native coverage only.
- **VERDICT:** ENG REVIEW ISSUES OPEN. All 12 are resolved into approved tasks T1–T9 and none needs another answer, so it's ready to implement against this revised plan.

NO UNRESOLVED DECISIONS
