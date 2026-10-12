# MUT-100 — review reports (eng review, CEO review, eng re-review, 2026-10-12)

Kept verbatim from the reviewed plan file; the brief is `mut-100-contingency-agreements.md`.

# Eng review — /plan-eng-review, 2026-10-12

Target: this plan (`scratchpad/mut-100-plan.md`), MUT-100, repo `elMokhtbr/Mutaba3a/mini-crm` package `server/`. Fixed for the whole review.

## Scope record

feature answers: D1 = Cut (drop `OrganizationSummary.counts.awaitingOutcome`; per-matter labels use `ProjectSummary.contingency`); structure: A (Original arrangement, D2 — store keeps `updateContingencyTerms`, `recordOutcome`, `correctOutcome` as separate methods in ports/memory/prisma); accepted scope: the plan above minus the organization-summary count; pending remedies: none.
Scope Challenge result: scope reduced per recommendation (D1). Later expanded by D8 (contingency fee proposals built in MUT-100, plan §11), then reduced again by the CEO review (C1/D2: proposals and D9/D10 deferred).
Factual corrections (no behaviour change): F1 the hosted portal renders no agreements of any type (`src/hosted/api/client.ts:172-230`), so the ticket's "portal shows contingency agreements read-only" line is replaced by "portal figures stay correct; no new view"; F2 "the agreement closes" means outcome recorded and nothing more to bill (no CLOSED status exists: `AgreementStatus { ACTIVE CANCELLED }`, schema.prisma:83).

## Decision ledger

### R1: migration shape for the new enum value
Finding: #A1, P1, confidence 8/10, plan §1 ("`ALTER TYPE "AgreementType" ADD VALUE 'CONTINGENCY';` — not used anywhere else in this migration" and "Raw-SQL CHECK: `type <> 'CONTINGENCY' OR (…)`" in the same migration), reviewer: Claude (native).
Plan baseline: one migration `2026101218xxxx_mut100_contingency_agreements` holding ADD VALUE, two CREATE TYPEs, the columns and the CHECK (original proposal, unapproved).
Runtime evidence: existing migrations are one SQL file each applied by `prisma migrate deploy` (server/prisma/migrations/*); Postgres rejects a newly added enum value inside the transaction that added it ("unsafe use of new value"). Whether Prisma wraps this file in a transaction: believed yes on Postgres, not probed here.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1 migration shape | one file: ADD VALUE + types + columns + CHECK | two files: (1) ADD VALUE only, (2) types + columns + CHECK | one file, CHECK compares `type::text <> 'CONTINGENCY'` | one file, no CHECK (app validation only) |
| DB-level invariant (rate + treatment required for CONTINGENCY) | CHECK, unapproved | CHECK | CHECK | none |
| Other choices (R2 token) | pending | pending | pending | pending |
Question D3:
D3 — How should the migration add the CONTINGENCY enum value?
Project/branch/task: Mutaba3a mini-crm on main, MUT-100 plan review, Section 1.
ELI10: The plan adds a new agreement type and, in the same database migration, a safety rule that mentions that new type. Postgres won't let a migration use an enum value it only just added in the same transaction, and Prisma runs each migration as one transaction. As written, the production deploy would stop at this migration.
Stakes if we pick wrong: a failed migration blocks the deploy; working around it by hand in production is how MUT-59 happened.
Recommendation: A because two plain migrations are the boring, standard fix and keep the database-level rule.
Completeness: A=10/10, B=9/10, C=6/10
Pros / cons:
A) Two migrations (recommended)
  ✅ Each file is plain SQL with no tricks, and the enum value is committed before anything uses it
  ✅ Keeps the CHECK constraint, so a CONTINGENCY row without a rate cannot exist in the database
  ❌ Two migration folders for one feature, so deploy order matters (Prisma applies them in name order)
B) One migration, text cast in CHECK
  ✅ A single file, and the CHECK still protects the data at the database level
  ✅ Avoids the enum literal, so Postgres accepts it inside one transaction
  ❌ The `type::text` cast is a subtle trick a future editor may "clean up" and break the deploy
C) One migration, no CHECK
  ✅ Simplest migration, with no enum-literal issue at all
  ✅ Application validation already refuses a missing rate or treatment
  ❌ Nothing at the database level stops a bad row from a future code path or a manual fix
Net: a second migration folder versus a clever cast versus giving up the database guard.
Header: Migration
Options:
A) Two migrations
File 1 `…_mut100_agreement_type_contingency`: only `ALTER TYPE "AgreementType" ADD VALUE 'CONTINGENCY'`. File 2 `…_mut100_contingency_terms`: the two new enums, the agreement columns, `installments.isCommission` and the CHECK. (human: ~15min / CC: ~2min)
B) One migration, text cast
One file as planned, with the CHECK written as `"type"::text <> 'CONTINGENCY' OR (…)` so it never references the new enum value. (human: ~10min / CC: ~1min)
C) One migration, no CHECK
One file without the CHECK; the rate and treatment invariants live only in route validation and the store. (human: ~5min / CC: ~1min)

State: approved
Actual answer: A) Two migrations (D3, user, 2026-10-12)
Accepted scope: File 1 `…_mut100_agreement_type_contingency` holds only `ALTER TYPE "AgreementType" ADD VALUE 'CONTINGENCY'`; file 2 `…_mut100_contingency_terms` holds the two new enums, the agreement columns, `installments.isCommission` and the CHECK, named so it sorts after file 1. Plan §1 amended.
History: none

### R2: what the outcome preview token covers
Finding: #A2, P2, confidence 8/10, plan §4 ("`previewToken` over `[org,'outcome',id,agreement.version,body,rate]`") vs plan §2 (`upfrontCountedMinor` = upfront amounts − credits on their receivables); `repositories/ports.ts` `credit(...)`: "Appends a credit and moves credited_minor / status atomically" on the receivable only, so the agreement version does not move; reviewer: Claude (native).
Plan baseline: token over org, kind, agreement id, agreement version, body, VAT rate (original proposal, unapproved).
Runtime evidence: the existing agreement token covers body + rate only because a fixed agreement's figures are a pure function of those (`routes/agreements.ts` create: `verifyPreviewToken(token, [organization.id, 'agreement', body, preview.vatRateBasisPoints])`). The outcome figures also depend on ledger state (credits; for a correction, the old commission receivable's payments).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R2 token inputs | org, kind, id, version, body, rate | + upfrontCountedMinor, commissionMinor, billableMinor, and for a correction the replaced receivable id + its version | unchanged |
| Behaviour when an upfront credit lands between preview and write | posts the recomputed amount, which can differ from the preview | 409 PREVIEW_STALE, Malafat re-previews | posts the recomputed amount silently |
| R1 migration | approved A (D3) | approved A (D3) | approved A (D3) |
Question D4:
D4 — Should the outcome preview token also cover the figures it shows?
Project/branch/task: Mutaba3a mini-crm on main, MUT-100 plan review, Section 1.
ELI10: Before recording an award, the lawyer sees a preview, e.g. "bill ₪18,500 + VAT", and confirms. The plan's token only notices changes to the agreement itself. But with "upfront counts toward the commission", the figure also depends on credits on the upfront fee, and a credit doesn't change the agreement. If someone credits the upfront in between, the ledger would post a different amount from the one the lawyer approved, without saying so.
Stakes if we pick wrong: the client is billed an amount nobody saw or approved, and it only surfaces when someone reconciles.
Recommendation: A because the ledger's rule is that what you preview is what gets posted, and this keeps it with three more values in a hash.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Token covers the figures (recommended)
  ✅ Any change that alters the bill, including credits and payments, forces a fresh preview
  ✅ Matches how PREVIEW_STALE already works for VAT-rate changes, so Malafat handles it already
  ❌ A rare extra round trip when a credit lands between preview and confirm
B) Keep the token as planned
  ✅ Slightly simpler token, with no extra inputs to keep in sync
  ✅ The posted figure is still computed correctly from the current ledger
  ❌ The posted figure can differ from the previewed one with no error and no warning
Net: one more stale-preview case versus silently posting an unseen amount.
Header: Token
Options:
A) Token covers figures
Mint and verify the outcome token over the body, rate and version plus upfrontCountedMinor, commissionMinor, billableMinor and, when correcting, the replaced receivable id and version; any difference → 409 PREVIEW_STALE. Add a route test: credit the upfront between preview and record → 409. (human: ~30min / CC: ~3min)
B) Keep as planned
Token over org, kind, id, version, body and rate only; record and correct recompute from the current ledger and post that result. (human: 0 / CC: 0)

State: approved
Actual answer: A) Token covers figures (D4, user, 2026-10-12)
Accepted scope: The outcome token is minted and verified over org, 'outcome', agreement id, agreement version, body, VAT rate, upfrontCountedMinor, commissionMinor, billableMinor and, when correcting, the replaced receivable id and its version; any difference returns 409 PREVIEW_STALE. Route test: a credit on the upfront between preview and record returns 409 PREVIEW_STALE. Plan §4 amended.
History: none

### R3: fixing wrong terms after an outcome
Finding: #Q1, P2, confidence 7/10, plan §4 (`PATCH /v1/agreements/{id}/contingency`: "409 … `OUTCOME_ALREADY_RECORDED`"; `/outcome/correct` reuses the stored rate and treatment), reviewer: Claude (native).
Plan baseline: terms editable only before an outcome; a correction changes outcome fields only (original proposal, unapproved).
Runtime evidence: none (new behaviour); D2 (user) approved correction as "credit old, post new".
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R3 terms at correction | not changeable once an outcome exists | `/outcome/correct` (and its preview) accept optional `commissionRateBasisPoints` / `upfrontTreatment`, written in the same correctOutcome transaction, audited | unchanged; wrong terms after an outcome need a cancel-free workaround (credit + a separate FIXED agreement) |
| PATCH /contingency after outcome | 409 OUTCOME_ALREADY_RECORDED | unchanged (409) | unchanged (409) |
| Correction guard (unpaid, uncredited commission) | approved D2 | unchanged | unchanged |
| R1, R2 | approved D3, D4 | unchanged | unchanged |
Question D5:
D5 — Can a correction also fix the commission rate or upfront treatment?
Project/branch/task: Mutaba3a mini-crm on main, MUT-100 plan review, Section 2.
ELI10: Once an award is recorded, the plan locks the terms (the % and whether the upfront counts). A correction can change the award amount but not the terms. If the lawyer typed 20% when the contract says 25%, and only notices at the verdict, there is no way to fix it inside this feature, even though nothing has been paid yet.
Stakes if we pick wrong: a firm under-bills a real case, or works around it with a fake extra agreement that muddies the matter's history.
Recommendation: A because it reuses the correction the user already approved and keeps the same unpaid-only safety rule.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Correction can fix terms (recommended)
  ✅ One audited step fixes both a wrong award and wrong terms while the commission is unpaid
  ✅ No new endpoint: two optional fields on the correction and its preview, in the same transaction
  ❌ The correction body grows, and the audit event must record old and new terms
B) Terms stay locked
  ✅ Simplest rule to explain: terms freeze at the outcome, full stop
  ✅ No extra fields on the correction request or preview
  ❌ A typo in the rate becomes permanent once the outcome is recorded, unless it's worked around
Net: two optional fields versus a dead end for a plausible typo.
Header: Terms fix
Options:
A) Correction fixes terms
`POST /outcome/preview` (mode CORRECT) and `POST /outcome/correct` accept optional `commissionRateBasisPoints` and `upfrontTreatment`; correctOutcome writes them with the new outcome in one transaction; audit `agreement.outcome_corrected` records old and new terms; tests for a rate fix and a treatment flip. (human: ~1h / CC: ~5min)
B) Terms stay locked
No change: terms are editable only before an outcome; a correction changes outcome fields only. (human: 0 / CC: 0)

State: approved
Actual answer: A) Correction fixes terms (D5, user, 2026-10-12)
Accepted scope: `POST /outcome/preview` (mode CORRECT) and `POST /outcome/correct` accept optional `commissionRateBasisPoints` and `upfrontTreatment`; correctOutcome writes them with the new outcome in one transaction; audit `agreement.outcome_corrected` records old and new terms; tests for a rate fix and a treatment flip. PATCH /contingency after an outcome stays 409. Plan §4 amended.
History: none

### R4: where the upfront credits come from
Finding: #Q2, P3, confidence 8/10, plan §2 ("VAT_EXCLUSIVE: net of the credit via the existing `splitCredit`") vs `repositories/ports.ts:786-790` (`CreditInput { amountMinor; netMinor; vatMinor; reason; effectiveDate; requestId }`), reviewer: Claude (native).
Plan baseline: recompute each upfront receivable's credited amount in the pricing basis with `splitCredit(creditedMinor, treatment, rate)` (original proposal, unapproved).
Runtime evidence: every credit row stores its own net/vat split at the moment it was issued; `receivables.listCredits(organizationId, receivableId)` returns those rows. A recomputed split of the summed gross can round differently from the sum of the stored splits.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R4 credited-in-basis source | `splitCredit` over the receivable's `creditedMinor` | Σ stored `CreditRecord.netMinor` (VAT_EXCLUSIVE) or Σ `amountMinor` (VAT_INCLUSIVE) via `receivables.listCredits`, one call per posted upfront receivable (≤ 60, typically 1) | unchanged |
| Behaviour approved in the ticket ("credits on upfront receivables reduce the amount counted") | fixed | fixed | fixed |
| R1–R3 | approved D3, D4, D5 | unchanged | unchanged |
Question D6:
D6 — Should the upfront credit be read from the stored credit rows instead of recomputed?
Project/branch/task: Mutaba3a mini-crm on main, MUT-100 plan review, Section 2.
ELI10: When the upfront counts toward the commission, any discount (credit) on the upfront lowers what counts. The plan recomputes that discount's before-VAT part from the total credited. But each credit already saved its exact before-VAT and VAT split when it was issued. Recomputing can come out one agora different from what the credit note actually said.
Stakes if we pick wrong: the commission bill is off by an agora from the firm's own credit notes, which makes reconciliation look wrong.
Recommendation: A because the stored split is what the firm actually issued, and the read path already exists.
Completeness: A=10/10, B=8/10
Pros / cons:
A) Read stored credit rows (recommended)
  ✅ Matches the credit notes exactly, with no second rounding of an already-rounded figure
  ✅ Uses the existing `receivables.listCredits`, so there's no new store method
  ❌ One extra query per posted upfront receivable, usually one and never more than 60
B) Recompute with splitCredit
  ✅ No extra query: it works from the receivable's `creditedMinor` alone
  ✅ Simple to write in the pure module, with no list to load
  ❌ Can differ by one minor unit from the stored credits when several credits round differently
Net: one small query versus an occasional one-agora mismatch.
Header: Credit source
Options:
A) Read stored credit rows
`upfrontCountedMinor` subtracts Σ stored `netMinor` (VAT_EXCLUSIVE) or Σ `amountMinor` (VAT_INCLUSIVE) from `receivables.listCredits` for each posted upfront receivable; pure-test row with two credits whose recomputed split differs by 1. (human: ~20min / CC: ~2min)
B) Recompute with splitCredit
Keep the plan: `splitCredit(receivable.creditedMinor, treatment, rate)` per posted upfront receivable. (human: 0 / CC: 0)

State: approved
Actual answer: A) Read stored credit rows (D6, user, 2026-10-12)
Accepted scope: `upfrontCountedMinor` subtracts Σ stored `netMinor` (VAT_EXCLUSIVE) or Σ `amountMinor` (VAT_INCLUSIVE) from `receivables.listCredits` for each posted upfront receivable; pure-test row with two credits whose recomputed split differs by 1. Plan §2 amended.
History: none

### R5: regression contract for existing agreement and summary behaviour
Finding: #T1, CRITICAL regression, confidence 9/10, `server/src/schemas.ts:637` (`installments: z.array(InstallmentSpecSchema).min(1).max(MAX_INSTALLMENTS)`) relaxed to min(0) by plan §3; the only empty-list coverage is pure (`agreements/__tests__/schedule.test.ts:60` → `NO_INSTALLMENTS`); plan §3/§6 also touch `create.ts:66` (fee-proposal approval path) and `compute.ts:109-116`; reviewer: Claude (native).
Plan baseline: plan §3 says FIXED keeps its rule through `splitInstallments` → `NO_INSTALLMENTS` "(422, same code, detail now a reason instead of zod issues)"; no regression contract approved.
Runtime evidence: today a FIXED preview with `installments: []` fails schema validation (422 VALIDATION_FAILED with zod issues in details); Malafat's wizard never sends an empty list (`agreement-wizard-model.ts` `fixedDraftProblems` pushes "installments" when the list is empty). FIXED/RETAINER/NONE figures are ★★★ in `compute.test.ts`; a FIXED+RETAINER mix on one project is untested.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R5 FIXED with `installments: []` | 422, zod issues in details | 422, `details.reason = NO_INSTALLMENTS` (intentional change), new route test asserts it | 422 with the identical zod issue, kept by a schema refinement that applies min(1) unless `contingency` is present; route test asserts the issue is unchanged |
| Preserved behaviour (both options) | all routes-m2..m8, compute, schedule, store-contract (memory + Prisma), writability-drift, route-security suites green | same, unchanged | same, unchanged |
| New regression test (both options) | none | compute: FIXED + RETAINER mix → kind FIXED, monthly set, agreed = FIXED sum | same |
| R1–R4 | approved D3–D6 | unchanged | unchanged |
Question D7:
D7 — Which regression contract should guard the existing agreement behaviour?
Project/branch/task: Mutaba3a mini-crm on main, MUT-100 plan review, Section 3.
ELI10: To allow a contingency agreement with a ₪0 upfront, the plan loosens a rule that says every agreement needs at least one installment. For ordinary fixed agreements the request is still refused when the list is empty, but the error looks slightly different. Nothing tests that today. Whichever option you pick, every existing test suite must pass unchanged, and a new test pins the case that has no coverage.
Stakes if we pick wrong: an unnoticed change to a refusal Malafat might depend on, or a clever schema rule that is easy to break later.
Recommendation: A because Malafat never sends an empty list, so the cleaner error is a harmless improvement, and the new test pins it.
Completeness: A=10/10, B=10/10
Pros / cons:
A) Accept the clearer error (recommended)
  ✅ FIXED and CONTINGENCY share one plain schema, and the refusal now names its reason
  ✅ A new route test pins the new response, so it can't drift unnoticed again
  ❌ The 422 detail shape changes for an input that only a buggy client would send
B) Keep the exact old error
  ✅ Byte-for-byte the same 422 for FIXED, with no client-visible change at all
  ✅ A test proves the zod issue is identical before and after
  ❌ A conditional schema refinement that is harder to read and easier to break later
Net: a cleaner, pinned refusal versus a perfectly preserved one behind a schema trick.
Header: Regression
Options:
A) Accept clearer error
Contract: every existing server suite passes unchanged; intentional change: FIXED with `installments: []` returns 422 with `details.reason = NO_INSTALLMENTS`; new tests: that route case, plus compute FIXED + RETAINER mix (kind FIXED, monthly set, agreed = FIXED sum). (human: ~30min / CC: ~3min)
B) Keep exact old error
Contract: every existing server suite passes unchanged and FIXED with `[]` returns the identical zod issue, via a schema refinement (min(1) unless `contingency` is present); new tests: that route case asserting the issue, plus the compute mix test. (human: ~1h / CC: ~6min)

State: approved
Actual answer: A) Accept clearer error (D7, user, 2026-10-12)
Accepted scope: Regression contract: every existing server suite (routes-m2..m8, compute, schedule, store contracts on memory + Prisma, writability-drift, route-security) passes unchanged; intentional change: FIXED with `installments: []` returns 422 VALIDATION_FAILED with `details.reason = NO_INSTALLMENTS`; new tests: that route case, and compute FIXED + RETAINER mix (kind FIXED, monthly set, agreed = FIXED sum). Plan §9 amended.
History: none

### R6: TODO — fee proposals that create contingency agreements
Finding: #TODO1, P3, confidence 9/10, `agreements/create.ts:66` (`type: 'FIXED'` on the create path that `POST /v1/fee-proposals/{id}/approve` also uses) and `FeeProposal` (single `proposedAmount`, `ApproveSchedule` ONCE | INSTALLMENTS); reviewer: Claude (native).
Plan baseline: out of scope for MUT-100 ("Fee proposals that create contingency agreements — follow-up", ticket Scope (out)).
Runtime evidence: since M8 an approved proposal creates a FIXED agreement in the same transaction; a proposal carries one amount and cannot express upfront + rate + treatment.
What: let a fee proposal carry contingency terms (upfront, rate, treatment) and have approval create a CONTINGENCY agreement.
Why: M8 made client approval the normal way an agreement is born (MUT-40/MAL-943); contingency deals would be the one fee type that skips it.
Pros: one negotiation flow for every fee type; the client-approval record exists for contingency deals too.
Cons: touches the proposal schema, approve route, Malafat proposal dialogs and the overview's Proposed figure (what is "proposed" for an unknown commission?).
Context: MUT-100 ships direct creation only; start from `routes/fee-proposals.ts` approve and `createAgreementFromPreview`'s new `type` parameter.
Depends on / blocked by: MUT-100.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R6 fee-proposal contingency | out of scope, no record | TODOS.md entry (paired with a MUT ticket per this board's convention) | not recorded | built in MUT-100 |
| MUT-100 scope | approved per D1/D2 | unchanged | unchanged | grows by the proposal flow |
Question D8:
D8 — Record "fee proposals that create contingency agreements" as a TODO?
Project/branch/task: Mutaba3a mini-crm on main, MUT-100 plan review, TODOS.
ELI10: Since M8, the usual way a fee agreement is born is that the client approves a fee proposal, which creates the agreement automatically. A proposal only holds one fixed amount, so it can't describe "₪1,500 now plus 20% of the award". MUT-100 lets lawyers create contingency agreements directly, but not through the proposal flow. This asks whether to write that gap down for later.
Stakes if we pick wrong: the gap gets forgotten, and contingency deals stay the one fee type without a client-approval record.
Recommendation: A because it's a real, known gap with a clear starting point, and the TODO keeps it from being lost.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Add to TODOS.md (recommended)
  ✅ The known gap is written down with its starting point and its MUT-100 dependency
  ✅ Fits this repo's TODOS.md format, which pairs each entry with a ticket
  ❌ One more open item on a backlog that already has several
B) Skip
  ✅ Keeps TODOS.md short, since the Jira ticket's Scope (out) already mentions it
  ✅ No extra entry to keep in sync with Jira
  ❌ A note inside a closed ticket's description is easy to lose after MUT-100 ships
C) Build it now in MUT-100
  ✅ Contingency deals get client approval from day one, matching the M8 flow
  ✅ No follow-up ticket to schedule later
  ❌ Roughly doubles MUT-100 and drags proposal dialogs and the Proposed figure into it
Net: a written follow-up versus a quieter backlog versus a much larger ticket.
Header: TODO 1
Options:
A) Add to TODOS.md
Append a TODOS.md entry (What / Why / Pros / Cons / Context / Depends on: MUT-100) and offer a paired MUT ticket at the end of planning. (human: ~10min / CC: ~1min)
B) Skip
No TODOS.md entry; the ticket's Scope (out) line is the only record. (human: 0 / CC: 0)
C) Build it now in MUT-100
Add contingency terms to fee proposals and make approval create a CONTINGENCY agreement inside MUT-100. (human: ~2 days / CC: ~1h)

State: approved
Actual answer: C) Build it now in MUT-100 (D8, user, 2026-10-12)
Accepted scope: Fee proposals can carry contingency terms (upfront, rate, treatment) and approving one creates a CONTINGENCY agreement in the same transaction; built inside MUT-100. No TODOS.md entry. Design and review of this addition follow as a late change (plan §11); its own new choices are asked separately.
History: none

### R7: what "Proposed" counts for a contingency proposal
Finding: #L1 (late change from D8), P2, confidence 9/10, `routes/summaries.ts:64` (`proposed: fmt(props.reduce((sum, p) => sum + p.proposedAmountMinor, 0n))`) and `:55` (customer row lists each open proposal's `amount`); reviewer: Claude (native).
Plan baseline: none (new with D8); prior user decision 2026-10-10: the overview strip is Owed | Overdue | Proposed and Proposed counts PROPOSED fee proposals only.
Runtime evidence: `proposed` sums `proposedAmountMinor`; a contingency proposal's commission has no amount until an outcome exists.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R7 `CurrencySummary.proposed` for a contingency proposal | n/a (type does not exist) | adds its proposed upfront only | adds nothing |
| Customer row open proposal | amount | amount = upfront, plus `contingency` echo (rate, treatment) | amount = upfront, plus `contingency` echo (rate, treatment) |
| Commission ever counted in Proposed | n/a | never (unknown until outcome) | never |
| R1–R6 | approved D3–D8 | unchanged | unchanged |
Question D9:
D9 — What should the overview's "Proposed" figure count for a contingency proposal?
Project/branch/task: Mutaba3a mini-crm on main, MUT-100 plan review, late change (fee proposals, D8).
ELI10: The Money overview shows a "Proposed" total: money in open proposals the client hasn't approved yet. A contingency proposal has a known upfront (₪1,500) and an unknown commission (20% of a future award). Either way the commission is never added, because there's no amount to add. The question is whether the known ₪1,500 counts toward Proposed.
Stakes if we pick wrong: Proposed either looks smaller than the real pipeline, or quietly mixes a partial figure in with full ones.
Recommendation: A because ₪1,500 really is proposed money, and the row already shows "+ 20%" so nobody reads it as the whole deal.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Count the upfront (recommended)
  ✅ Proposed stays an honest sum of real proposed amounts, with no invented commission
  ✅ The customer row shows "₪1,500 + 20%", so the partial nature is visible where it matters
  ❌ A firm with many ₪0-upfront deals sees a small Proposed figure despite a large pipeline
B) Count nothing
  ✅ Proposed stays a fixed-fee figure, with no partial contingency amounts mixed in
  ✅ Simpler to explain: Proposed is money with a known total
  ❌ A real ₪1,500 the client is being asked to approve disappears from the strip
Net: an honest partial sum versus a fixed-fee-only figure.
Header: Proposed
Options:
A) Count the upfront
`CurrencySummary.proposed` adds a contingency proposal's proposed upfront; the commission never counts; the customer row's proposal carries `contingency` (rate, treatment). Summary test row with one fixed and one contingency proposal. (human: ~20min / CC: ~2min)
B) Count nothing
`CurrencySummary.proposed` skips contingency proposals; they still appear on the customer row with upfront + `contingency`. Summary test row as above. (human: ~20min / CC: ~2min)

State: approved
Actual answer: A) Count the upfront (D9, user, 2026-10-12)
Accepted scope: `CurrencySummary.proposed` adds a contingency proposal's proposed upfront; the commission never counts; the customer row's proposal carries `contingency` (rate, treatment). Summary test row with one fixed and one contingency proposal. Plan §11 amended.
History: none

### R8: regression contract for approve without a schedule
Finding: #L2 (late change from D8), CRITICAL regression, confidence 9/10, `server/src/schemas.ts:1258` (`schedule: ApproveScheduleSchema,` required) made optional by plan §11; reviewer: Claude (native).
Plan baseline: plan §11 ("`schedule` becomes optional and is required only when the agreed upfront is `> 0` (422 `SCHEDULE_REQUIRED`)"); D7 approved the same principle for `installments: []` only, so this case is not covered by an exact prior approval.
Runtime evidence: today a FIXED approve without `schedule` fails schema validation (422 with zod issues); routes-m8 always sends a schedule (`ONCE` helper at routes-m8.test.ts:64), so the missing-schedule case is untested.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R8 FIXED approve without `schedule` | 422, zod issues | 422 `details.reason = SCHEDULE_REQUIRED` (intentional change), route test | unchanged: `schedule` stays required for every proposal; a ₪0-upfront contingency approval sends `ONCE` and it creates no installment |
| Contingency approve, upfront 0 | n/a | `schedule` omitted | `schedule` sent and unused |
| Preserved behaviour | routes-m8 suite green | unchanged (R5 contract) | unchanged (R5 contract) |
| R1–R7 | approved D3–D9 | unchanged | unchanged |
Question D10:
D10 — On approval, should `schedule` become optional (needed only when there is an upfront)?
Project/branch/task: Mutaba3a mini-crm on main, MUT-100 plan review, late change (fee proposals, D8).
ELI10: Approving a proposal today requires a payment schedule, i.e. when the fee is due. A contingency deal with a ₪0 upfront has nothing to schedule. Making the schedule optional is the honest shape, but an ordinary fixed approval sent without a schedule would then get a slightly different error than today. This is the same trade-off you accepted in D7, for a different field.
Stakes if we pick wrong: either a quiet change to an existing refusal, or an API that demands a due date it then ignores.
Recommendation: A because it is the same call as D7: a clearer, pinned error for an input only a buggy client sends.
Completeness: A=10/10, B=9/10
Pros / cons:
A) Optional, clearer error (recommended)
  ✅ The request says what it means: no upfront, no schedule
  ✅ A new route test pins the FIXED refusal, which is untested today
  ❌ The 422 detail for a FIXED approve without a schedule changes from zod issues to a reason
B) Keep it required
  ✅ No change at all to any existing approve request or error
  ✅ No new validation reason to document
  ❌ A ₪0-upfront approval must send a due date that does nothing, which confuses API readers
Net: the same clarity-versus-zero-change trade as D7, for the approve schedule.
Header: Schedule
Options:
A) Optional, clearer error
`ApproveFeeProposalRequest.schedule` becomes optional; required when the agreed upfront is > 0 (422 `SCHEDULE_REQUIRED`, also for FIXED); route tests: FIXED approve without schedule → 422 reason, contingency ₪0 approve without schedule → 201; every routes-m8 test passes unchanged. (human: ~20min / CC: ~2min)
B) Keep it required
`schedule` stays required for every approval; a ₪0-upfront contingency approval sends one and it creates no installment; route test for that case. (human: ~15min / CC: ~2min)

State: approved
Actual answer: A) Optional, clearer error (D10, user, 2026-10-12)
Accepted scope: `ApproveFeeProposalRequest.schedule` becomes optional; required when the agreed upfront is > 0 (422 `SCHEDULE_REQUIRED`, also for FIXED); route tests: FIXED approve without schedule → 422 reason, contingency ₪0 approve without schedule → 201; every routes-m8 test passes unchanged. Plan §11 already states this; regression contract extended.
History: none

Approval readiness: PASS — R1 (D3), R2 (D4), R3 (D5), R4 (D6), R5 (D7), R6 (D8), R7 (D9), R8 (D10); scope selectors D1, D2. Every accepted remedy cites its own answer; no deferrals; nothing pending.

## Review findings and dispositions

- Scope Challenge: S1 org-wide awaiting-outcome count → cut (D1). F1 portal renders no agreements → factual correction. F2 no CLOSED status → factual correction. Structure → original arrangement (D2).
- Section 1 Architecture: [P1] (8/10) A1 enum value used in its own migration → R1 accepted (D3). [P2] (8/10) A2 token blind to upfront credits → R2 accepted (D4). [P3] (7/10) A3 backdated outcome due at once → no change (plan's `dueDate` override). [P2] (9/10) L1 Proposed for contingency proposals (late change) → R7 accepted (D9).
- Section 2 Code quality: [P2] (7/10) Q1 wrong terms unfixable after an outcome → R3 accepted (D5). [P3] (8/10) Q2 recomputed credit split → R4 accepted (D6).
- Section 3 Tests: CRITICAL (9/10) T1 FIXED `installments: []` untested → R5 accepted (D7). CRITICAL (9/10) L2 FIXED approve without schedule untested → R8 accepted (D10). 26 coverage gaps, all assigned to planned tests (§9, §11). Test plan: `~/.gstack/projects/vAWK3-malafat/basel-main-eng-review-test-plan-20261012-133643.md`.
- Section 4 Performance: no issues (per-agreement installment load is existing; outcome preview bounded at ≤ 60 credit reads, typically 1; no org-summary query after D1).
- Outside voice: unavailable (Codex CLI not installed; native fallback needs TaskOutput, absent in this session).

## NOT in scope

- Per-collection billing (a % of each amount actually received) — user chose bill-once on the award (intake).
- Rate tiers by stage; refunds of the upfront; statutory fee caps — intake rulings.
- Trust/escrow handling of award money; awards in another currency — separate domains.
- Create/edit UI in the Mutaba3a app; any hosted-portal agreement view (F1: the portal shows none today).
- Changing the upfront amount after creation — supplements stay refused on CONTINGENCY; a credit reduces it, and further fees are separate FIXED agreements.
- Organization-summary awaiting-outcome count — cut at D1; additive later.
- The Malafat UI — MAL-1077.

## What already exists (reused, not rebuilt)

Installments + `postInstallment` + `listUnpostedDue` (posting and crash healing), receivables, payments/allocations, `receivables.credit` + `listCredits`, preview tokens (`preview-token.ts`), idempotency (`idempotency.ts`), If-Match (`if-match.ts`), the writability row `/v1/agreements*`, `splitInstallments`, `computeVat` + `roundHalfUpDiv`, `createAgreementFromPreview` with `approveProposal`, `projectFigures`/`fixedStatus`, the per-milestone store contract suite pattern, the OpenAPI export script and `hosted:types`. New: `agreements/contingency.ts` (pure) and three store methods.

## Diagrams

```
Contingency agreement lifecycle
  create (upfront 0..n installments) ──► AWAITING ──PATCH terms (If-Match)──► AWAITING
                                           │  cancel (nothing posted) ──► CANCELLED
                                           ├─ record AWARDED ──► commission line (DATE=outcomeDate) ──► receivable
                                           │                       billable 0 (CREDITED ≥ commission) ──► no line
                                           └─ record NO_RECOVERY ──► no line
  AWARDED / NO_RECOVERY ──correct (commission unpaid & uncredited; may fix terms)──►
        credit old receivable in full · void old line · new outcome · new line (if billable > 0)

Fee proposal (D8)
  PROPOSED {upfront, rate, treatment} ──approve {agreed upfront, terms?, schedule if upfront > 0}──►
        APPROVED + CONTINGENCY agreement (same transaction)      ──withdraw──► WITHDRAWN
```

Inline diagram candidate: `agreements/contingency.ts` header (the SEPARATE vs CREDITED arithmetic).

## Failure modes

| Path | Realistic failure | Handling / test | User sees |
|---|---|---|---|
| Migrations | enum value used in its own transaction | split (D3); `test:db` applies both | loud deploy failure avoided |
| Record | crash after the transaction, before posting | `listUnpostedDue` posts the DATE line on the next read; store test | nothing missing |
| Record / correct | credit or payment lands after the preview | token covers figures (D4) → 409 PREVIEW_STALE; in-txn guard → 409 OUTCOME_HAS_PAYMENTS | "preview again" / clear refusal |
| Record | no VAT rate on the outcome date | 422 VAT_RATE_MISSING | clear error |
| Record | two concurrent records | version check → one wins, other 409; route test | clear refusal |
| Approve | upfront > 0 without schedule | 422 SCHEDULE_REQUIRED (D10); route test | clear error |
| Deploy | prod lacks the enum value (MUT-59 class) | release note: check `pg_enum`; first insert would fail loudly | loud, not silent |

Critical gaps: 0.

## Worktree parallelization strategy

| Step | Modules touched | Depends on |
|---|---|---|
| A. Pure domain | `server/src/agreements/` (new `contingency.ts` + tests) | — |
| B. Data + store | `server/prisma/`, `server/src/repositories/` | — |
| C. Agreement routes + contract | `server/src/routes/`, `server/src/schemas.ts`, `server/src/serializers.ts`, `server/src/agreements/create.ts` | A, B |
| D. Summaries | `server/src/summaries/`, `server/src/routes/summaries.ts` | B |
| E. Fee proposals | `server/src/routes/fee-proposals.ts`, `schemas.ts` | C |
| F. Contract export | `server/openapi/`, `src/hosted/api/` | C, D, E |

Lane A: A (independent). Lane B: B → D. Then C → E → F sequentially (C and E share `schemas.ts`). Launch A + B; merge both; then D, C, E, F. All lanes run in a fresh worktree off Mutaba3a `main` (the main checkout has another session's uncommitted MUT-81 work).

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific
finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~30min / CC: ~3min)** — prisma — Split the migration in two
  - Surfaced by: Architecture — A1 / R1 (D3)
  - Files: `server/prisma/migrations/…_mut100_agreement_type_contingency/`, `…_mut100_contingency_terms/`, `server/prisma/schema.prisma`
  - Verify: `npm run test:db` on a fresh Postgres
- [ ] **T2 (P1, human: ~1h / CC: ~6min)** — agreements — Outcome token over the shown figures
  - Surfaced by: Architecture — A2 / R2 (D4)
  - Files: `server/src/routes/agreements.ts`, `server/src/agreements/contingency.ts`
  - Verify: route test "credit on the upfront between preview and record → 409 PREVIEW_STALE"
- [ ] **T3 (P1, human: ~2h / CC: ~10min)** — agreements + store — Correction can fix rate and treatment
  - Surfaced by: Code quality — Q1 / R3 (D5)
  - Files: `server/src/routes/agreements.ts`, `server/src/schemas.ts`, `server/src/repositories/{ports,memory,prisma}.ts`
  - Verify: route tests for a rate fix and a treatment flip; audit carries old and new terms
- [ ] **T4 (P2, human: ~30min / CC: ~3min)** — agreements — Upfront credits from stored rows
  - Surfaced by: Code quality — Q2 / R4 (D6)
  - Files: `server/src/agreements/contingency.ts`
  - Verify: pure test with two credits whose recomputed split differs by 1
- [ ] **T5 (P1, human: ~1h / CC: ~5min)** — tests — Regression contract for agreements and approvals
  - Surfaced by: Tests — T1 / R5 (D7) and L2 / R8 (D10)
  - Files: `server/src/__tests__/routes-mut100.test.ts`, `server/src/summaries/__tests__/compute.test.ts`
  - Verify: FIXED `[]` → 422 NO_INSTALLMENTS; FIXED approve without schedule → 422 SCHEDULE_REQUIRED; FIXED + RETAINER mix; every existing suite green
- [ ] ~~**T6 (P1, human: ~1 day / CC: ~45min)** — fee proposals — Contingency proposals and approval~~ — DEFERRED by CEO C1/D2 to the follow-up ticket; not MUT-100 work
  - Surfaced by: TODOS — R6 (D8), R7 (D9), R8 (D10)
  - Files: `server/src/routes/fee-proposals.ts`, `server/src/routes/summaries.ts`, `server/src/schemas.ts`, store files, migration 2
  - Verify: §11 tests; Proposed = fixed + contingency upfront
- [ ] **T7 (P2, human: ~20min / CC: ~2min)** — summaries — Drop the org-wide count from the plan
  - Surfaced by: Scope Challenge — S1 (D1)
  - Files: none (do not add `counts.awaitingOutcome`)
  - Verify: `openapi.yaml` diff has no `awaitingOutcome`

## Unresolved decisions

None.

## Completion summary

- Step 0: Scope Challenge — scope reduced per recommendation (D1); later expanded by D8
- Architecture Review: 4 issues found (A1, A2, A3, L1)
- Code Quality Review: 2 issues found (Q1, Q2)
- Test Review: diagram produced, 26 gaps identified (all assigned to planned tests) plus 2 regression contracts (T1, L2)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 1 item proposed to user (built now, D8)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (CLI not installed; native fallback lacks TaskOutput)
- Parallelization: 2 lanes, 2 parallel / 4 sequential
- Lake Score: 6/6 = answers picking a 10/10 option / answers scored for Completeness (D3, D4, D5, D6, D7, D10)

Suppressed findings (appendix): none below confidence 5.

# CEO review — /plan-ceo-review, 2026-10-12

Target: this plan (`scratchpad/mut-100-plan.md`), MUT-100. Review depth: implementation-ready. Mode: SCOPE REDUCTION (D1 of this pass, user, 2026-10-12; helper line "Mode: SCOPE REDUCTION; approved decisions: eng-review D1-D10 (R1-R8, scope D1/D2)."). Governing approvals: eng-review scope D1, D2 and R1–R8 (D3–D10) above, unchanged.

Pre-review audit: Mutaba3a local `main` is 544 files ahead of `origin/main`; another session merged MUT-81 to `main` today; MUT-100's files are the hottest in the repo (app.ts 21, ports.ts 17, openapi.yaml 17, schemas.ts 16, prisma.ts 16, memory.ts 16 touches in 30 days) and MUT-89 is in flight in a worktree. A stash on `main` belongs to another session (left alone).
Landscape: Clio bills contingency matters from a recorded settlement/award (validates bill-once-on-award); contingency tools net advanced case costs before the percentage (not in this plan); NY ethics opinion matches the CREDITED rule (credit when commission exceeds retainer, no refund below), Albunio v. City of New York shows crediting depends on the agreement's wording (validates the required, no-default treatment choice).
0A: real problem = litigation firms cannot record their most common fee; do-nothing cost = biggest fees invisible and commissions missed when judgments land. The plan models it directly; it still depends on someone remembering to record the outcome.

## CEO decision ledger

| ID and owner | Contract and evidence | Current | Proposed | Status | Exact approval and scope |
|---|---|---|---|---|---|
| C1 (Claude) | Contingency fee proposals (plan §11) built in MUT-100 per eng R6/D8; MAL-1077 (only consumer) Scope (out) lists "fee proposals for contingency deals"; touches routes/fee-proposals.ts, schemas.ts, summaries, migration 2; brings R7/D9 and R8/D10 with it | deferred (C1/D2) | — | approved | D2 (CEO pass), user, 2026-10-12: A) Defer to follow-up — plan §11, R7/D9 and R8/D10 leave MUT-100 for a TODOS.md entry and a MUT follow-up ticket paired with a Malafat UI ticket; their approved designs are kept as the follow-up's starting point. MUT-100 keeps the core. Delivery-scope change only; eng R6/D8's build-now is superseded for MUT-100. |
| C2 (Claude, Section 8) | Plan §4 names audit events `agreement.outcome_recorded` / `agreement.outcome_corrected` without their metadata; `upfrontCountedMinor` depends on credits that can change later, so rows alone cannot reconstruct a past bill | metadata carries the figures (C2/D3) | — | approved | D3 (CEO pass), user, 2026-10-12: A) Record the figures — outcome_recorded/corrected metadata carries outcome, awarded, rate, treatment, commission, upfrontCounted, billable split, VAT rate and receivable ids (correction: old and new figures and terms); a route test pins each. Plan §4 amended. |

Approval readiness: PASS — C1 (D2, CEO pass) and C2 (D3, CEO pass); mode by D1 (admin, approves no remedy); inherited eng approvals R1–R5 (D3–D7) unchanged; eng R6–R8 (D8–D10) superseded for MUT-100 delivery by C1/D2 and kept as the follow-up's design. Required-implementation corrections applied without new approval: correctOutcome typed `has_payments` result (Section 2, ticket AC) and validation proof rows (Section 6, approved request contract).

## currentDecision (C1)
Commitment comparison:
| Commitment | Source/approval or pending | Current | A | B |
|---|---|---|---|---|
| Contingency fee proposals (plan §11) | R6/D8 approved build-now | in MUT-100 | deferred: TODOS.md entry + a MUT follow-up ticket | stays in MUT-100 |
| Proposed counts the upfront (R7/D9) | approved | in MUT-100 | moves with the deferred item | stays |
| Approve `schedule` optional (R8/D10) | approved | in MUT-100 | moves with the deferred item | stays |
| MAL-1077 scope | ticket text | excludes contingency proposals | unchanged | must grow to include the proposal UI (ticket amendment) |
| Core (create, record, correct, summaries, D3/D4/D5/D6/D7) | approved | in MUT-100 | unchanged | unchanged |

Question: D2 — C1: Should contingency fee proposals move out of MUT-100 into a follow-up ticket?
Project/branch/task: Mutaba3a mini-crm on main, MUT-100 plan, CEO review in SCOPE REDUCTION mode.
ELI10: You chose to build "propose a contingency deal, the client approves, the agreement is created" inside this ticket. The Malafat ticket that will use this API (MAL-1077) explicitly leaves that proposal flow out. So as planned, the server would ship a proposal feature nobody can click. Deferring it keeps this ticket to the core: create, record the award, bill. The proposal flow would then ship later as its own pair of tickets, server and UI together.
Stakes if we pick wrong: keeping it either ships an unused API or forces MAL-1077 to grow; deferring means contingency deals skip client approval until the follow-up ships.
Recommendation: A because the only consumer excludes it, and splitting lets the API and its UI land together instead of months apart.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Defer to follow-up (recommended)
  ✅ MUT-100 shrinks to the core and lands sooner on the most conflict-prone files
  ✅ The proposal API ships together with the Malafat UI that calls it, as one reviewable pair
  ❌ Until the follow-up ships, contingency deals are created directly and skip the client-approval record
B) Keep in MUT-100
  ✅ Every fee type supports client approval from the first release
  ✅ Honours your D8 call without re-planning anything
  ❌ MAL-1077 must grow to include the proposal UI, or the API sits unused until it does
Net: a smaller ticket now with a paired follow-up versus the full flow now with a bigger Malafat ticket.
Header: Proposals
A) Defer to follow-up (recommended)
Move plan §11, R7/D9 and R8/D10 to a TODOS.md entry and a MUT follow-up ticket (paired with a Malafat UI ticket); MUT-100 keeps the core. Effort S, low risk; no implementation work in MUT-100 for proposals.
B) Keep in MUT-100
Build plan §11 with D9 and D10 as approved; amend MAL-1077 to add the contingency proposal UI. Effort L, medium risk; reuses the approve transaction and composePreview.

## currentDecision (C2)
Commitment comparison:
| Commitment | Source/approval or pending | Current | A | B |
|---|---|---|---|---|
| Audit metadata for outcome_recorded / outcome_corrected | pending (C2) | event names only | outcome, awarded, rateBasisPoints, upfrontTreatment, commission, upfrontCounted, billable (amount/net/vat/gross), vatRateBasisPoints, commission receivableId; correction adds the replaced receivableId, old and new figures and old and new terms | event names plus ids only |
| Terms change audit (`contingency_terms_changed {from,to}`) | plan §4 | from/to terms | unchanged | unchanged |
| Route test asserting the metadata | pending (C2) | none | yes, one row per event | none |
| All other approvals (eng D3–D7, CEO C1) | approved | unchanged | unchanged | unchanged |

Question: D3 — C2: Should the outcome audit events record the figures behind the bill?
Project/branch/task: Mutaba3a mini-crm on main, MUT-100 plan, CEO review Section 8 (observability).
ELI10: Every money action is written to an audit log. The plan logs that an outcome was recorded or corrected, but not the numbers that produced the bill. One of those numbers, how much upfront counted toward the commission, can change later when credits are issued. So if a client disputes the bill weeks later, nobody can show how ₪21,830 was reached at the moment it was billed.
Stakes if we pick wrong: a billing dispute can't be answered from the system, and support has to recompute it by hand from a ledger that has since moved.
Recommendation: A because it makes the audit trail answer the one question disputes ask, at the cost of a few extra fields in a JSON blob that already exists.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Record the figures (recommended)
  ✅ A dispute is answered from one audit row: the award, rate, credited upfront, VAT and the bill
  ✅ Corrections keep both the old and new figures, so the history explains itself without recomputation
  ❌ Slightly larger audit rows, and the metadata shape becomes something tests must pin
B) Ids only
  ✅ Smallest audit payload, matching some existing events that log ids and amounts only
  ✅ No metadata contract for tests to maintain over time
  ❌ The counted-upfront figure at billing time is lost once later credits change it
Net: a self-explaining audit trail versus a smaller one that can't answer a dispute.
Header: Audit
A) Record the figures (recommended)
outcome_recorded/corrected metadata carries outcome, awarded, rate, treatment, commission, upfrontCounted, billable split, VAT rate and receivable ids (correction: old and new figures and terms); a route test pins each. Effort S, low risk; reuses store.audit.append.
B) Ids only
Audit events carry agreement, installment and receivable ids only; figures are derived from rows when needed. Effort S, low risk; zero extra implementation work.

## TODOS.md entry (C1/D2 — apply in the MUT-100 worktree, not on the shared `main` checkout)

```markdown
## N. Contingency fee proposals: propose upfront + rate, approval creates the agreement — ticketed as MUT-107 (UI: MAL-1094)

**What:** Let a fee proposal carry contingency terms (upfront, commission rate, upfront treatment) and have approval create a CONTINGENCY agreement in the same transaction. Design already reviewed: MUT-100 plan §11, eng decisions D9 (Proposed counts the upfront only) and D10 (approve `schedule` optional, required only when the upfront > 0, 422 SCHEDULE_REQUIRED).

**Why:** Since M8 a client's approval is how a fee agreement is born (MUT-40/MAL-943); without this, contingency deals are the one fee type created directly with no client-approval record.

**Pros of fixing:** One negotiation flow for every fee type; the approval record exists for contingency deals too.

**Cons / cost / risk:** Touches the proposal schema, the approve route, `CurrencySummary.proposed`, and needs the Malafat proposal dialogs (a paired MAL ticket) so the API is not shipped unused.

**Context:** Deferred from MUT-100 by the CEO review on 2026-10-12 because MAL-1077, the only consumer, excludes it. Start at `server/src/routes/fee-proposals.ts` approve and `createAgreementFromPreview`'s `type` parameter added by MUT-100.

**Depends on / blocked by:** MUT-100 (the CONTINGENCY type) and a paired Malafat proposal-UI ticket.
```

## CEO review outputs

### Section findings and dispositions
- S1 Architecture: no decision-needing issues; rollback hazard reported under S9.
- S2 Error & Rescue: 7 codepaths mapped; 1 GAP (`InsufficientCapacity` escaping `correctOutcome` as a 500) → fixed in plan §5 as required implementation of the ticket AC.
- S3 Security: no issues; 5 threats assessed, all mitigated or equal to existing agreement writes.
- S4 Data flow & edge cases: 5 interaction edge cases and 3 ordering pairs mapped; 0 unhandled.
- S5 Code quality: no issues.
- S6 Tests: eng coverage map stands; 6 validation proof rows added to plan §9 item 6 (required by the approved request contract).
- S7 Performance: no issues.
- S8 Observability: 1 gap → C2 approved (D3): outcome audit events carry the bill's figures.
- S9 Deployment: 1 risk flagged (old revision strips `contingency` → silent FIXED) → rollback runbook below.
- S10 Trajectory: reversibility 4/5; 2 debt items (sparse type-specific agreement columns; permanent enum value).
- S11 Design: SKIPPED (no UI scope).
- Outside voice: unavailable (Codex CLI not installed; native fallback lacks TaskOutput).

### NOT in scope (CEO pass)
- Deferred: contingency fee proposals with eng D9/D10 (C1/D2) — the only consumer (MAL-1077) excludes them; ship later as a server + UI pair. TODOS.md text above, to apply in the MUT-100 worktree.
- Rejected in this pass: none. Earlier: org-wide awaiting-outcome count (eng D1).
- Unchanged from the eng list: per-collection billing, rate tiers, refunds, statutory caps, trust/escrow, foreign-currency awards, Mutaba3a app UI, portal agreement view, changing the upfront amount after creation.
- Noted, not proposed (REDUCTION mode): advanced case-cost netting before the percentage; a Malafat prompt to record the award when a litigation matter is decided.

### What already exists
As listed in the eng review: installments, posting and crash healing, receivables, credits with stored splits, preview tokens, idempotency, If-Match, the writability row, `splitInstallments`, `computeVat`, `createAgreementFromPreview`, `projectFigures`, the store contract-suite pattern, OpenAPI export and `hosted:types`.

### Dream state delta
This plan delivers the middle column of the 0C diagram minus proposals: a contingency deal can be recorded, billed from the award at the right VAT, corrected and explained from its audit trail. Still missing for the 12-month ideal: client approval of contingency deals (deferred, C1), an outcome prompt from litigation data (Malafat side), case-cost netting, and any client-facing view.

### Error & Rescue Registry
| Codepath | Failure | Class / reason | Rescued | User sees |
|---|---|---|---|---|
| composePreview (contingency) | bad rate, negative upfront, [] with amount > 0 | 422 COMMISSION_RATE_INVALID / AMOUNT_INVALID / NO_INSTALLMENTS | Y | field-level error |
| PATCH /contingency | wrong type, after outcome, stale | 422 NOT_CONTINGENCY · 409 OUTCOME_ALREADY_RECORDED · VERSION_MISMATCH | Y | clear refusal |
| POST /outcome/preview | no VAT rate, bad date or amount | 422 VAT_RATE_MISSING · OUTCOME_DATE_INVALID · AMOUNT_INVALID | Y | clear error |
| POST /outcome | stale preview, second record, key reuse | 409 PREVIEW_STALE · OUTCOME_ALREADY_RECORDED · IDEMPOTENCY_KEY_REUSED | Y | "preview again" / refusal |
| POST /outcome/correct | no outcome, commission paid or credited | 409 OUTCOME_NOT_RECORDED · OUTCOME_HAS_PAYMENTS | Y | refusal pointing to credits |
| store.correctOutcome | credit InsufficientCapacity inside txn | typed `has_payments` → 409 (fixed, S2) | Y | refusal, never 500 |
| postInstallment after txn | process dies | healed by listUnpostedDue | Y | nothing missing on next read |

### Failure Modes Registry
```
  CODEPATH              | FAILURE MODE                         | RESCUED? | TEST? | USER SEES?          | LOGGED?
  ----------------------|--------------------------------------|----------|-------|---------------------|--------
  migrations            | enum value used in its own txn       | Y (D3)   | Y     | n/a (deploy)        | Y
  record                | crash before post                    | Y        | Y     | nothing missing     | Y (audit on post)
  record / correct      | credit or payment after preview      | Y (D4)   | Y     | 409, preview again  | Y
  record                | no VAT rate on outcome date          | Y        | Y     | 422                 | Y
  record                | concurrent records                   | Y        | Y     | 409                 | Y
  correct               | InsufficientCapacity inside txn      | Y (S2)   | Y     | 409                 | Y
  rollback              | old revision strips `contingency`    | runbook  | N     | silent FIXED        | N  ← mitigated by runbook (no code path reachable before MAL-1077)
```
CRITICAL GAPS: 0 (the rollback row is an operational hazard with a runbook, reachable only by rolling Mutaba3a back after MAL-1077 ships).

### Diagrams
1. System architecture — Section 1 diagram (chat transcript) and the eng report's lifecycle diagram.
2. Data flow with shadow paths — Section 4 diagram.
3. State machine — eng report "Contingency agreement lifecycle".
4. Error flow:
```
  request ─► zod ─422─► caller
     └─► compose/plan ─422 (reason)─► caller
           └─► token ─409 PREVIEW_STALE─► caller
                 └─► store txn ─stale/has_payments─► 409 ─► caller
                       └─► post ─crash─► next read heals ─► 201 on retry/replay
```
5. Deployment sequence:
```
  worktree off main ─► tests (unit, route, store memory+Prisma, test:db) ─► openapi:generate + hosted:types
   ─► user: deploy.sh on test (migrate 1, migrate 2, image) ─► smoke + pg_enum check ─► deploy.sh on live ─► same checks
   ─► MAL-1077 re-vendors 1.14.0-mut100
```
6. Rollback flowchart:
```
  problem after deploy ─► any CONTINGENCY row? ── no ─► redeploy previous image (columns stay, harmless)
                                               └─ yes ─► Malafat contingency option live? ── yes ─► hide it in Malafat first
                                                                                         └─► roll forward with a fix (preferred)
```

### Stale Diagram Audit
No ASCII diagrams exist in the touched server files (`agreements/*.ts`, `routes/agreements.ts`, `summaries/compute.ts`, `repositories/ports.ts`). New one proposed: the SEPARATE vs CREDITED arithmetic header in `agreements/contingency.ts` (eng report).

## Implementation Tasks (CEO pass)
Synthesized from this review's findings. Each task derives from a specific
finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T8 (P1, human: ~1h / CC: ~5min)** — store — Typed `has_payments` result from correctOutcome
  - Surfaced by: Section 2 — InsufficientCapacity escaping as a 500
  - Files: `server/src/repositories/ports.ts`, `memory.ts`, `prisma.ts`, `server/src/routes/agreements.ts`
  - Verify: store contract test (memory + Prisma) and route test → 409 OUTCOME_HAS_PAYMENTS, nothing written
- [ ] **T9 (P2, human: ~1h / CC: ~3min)** — tests — Validation proof rows
  - Surfaced by: Section 6 — approved request contract lacked tests
  - Files: `server/src/__tests__/routes-mut100.test.ts`
  - Verify: award 0/negative/3-dec → 422; NO_RECOVERY with award → 422; missing label → 422; 2050 bp accepted
- [ ] **T10 (P2, human: ~1h / CC: ~5min)** — agreements — Outcome audit metadata carries the figures
  - Surfaced by: Section 8 — C2 (D3)
  - Files: `server/src/routes/agreements.ts`
  - Verify: route test asserts each event's metadata (record and correct)
- [ ] **T11 (P3, human: ~10min / CC: ~1min)** — docs — Apply the deferred TODO and file its follow-up ticket
  - Surfaced by: Step 0G — C1 (D2)
  - Files: `TODOS.md` (in the MUT-100 worktree)
  - Verify: entry present with the follow-up ticket key

## Rollback runbook (CEO Section 9)
1. Before any CONTINGENCY row exists: redeploy the previous Mutaba3a image; the new columns and enum value stay and are harmless.
2. After CONTINGENCY rows exist: prefer roll-forward. If a rollback is unavoidable, first hide the Contingency option in Malafat (an older revision drops the unknown `contingency` field and would create a FIXED agreement silently).
3. Post-deploy checks each environment: `CONTINGENCY` in `pg_enum`; `/openapi.json` reports `1.14.0-mut100`; `npm run smoke` passes.

## CEO Completion Summary
```
  +====================================================================+
  |            MEGA PLAN REVIEW — COMPLETION SUMMARY                   |
  +====================================================================+
  | Mode selected        | SCOPE REDUCTION                             |
  | System Audit         | main 544 files ahead of origin; hottest     |
  |                      | files collide with parallel MUT work        |
  | Step 0               | REDUCTION; contingency proposals deferred   |
  |                      | (C1/D2); core kept                          |
  | Section 1  (Arch)    | 0 issues found                              |
  | Section 2  (Errors)  | 7 error paths mapped, 1 GAP (fixed)         |
  | Section 3  (Security)| 0 issues found, 0 High severity             |
  | Section 4  (Data/UX) | 5 edge cases mapped, 0 unhandled            |
  | Section 5  (Quality) | 0 issues found                              |
  | Section 6  (Tests)   | Diagram produced (eng), 0 gaps open         |
  | Section 7  (Perf)    | 0 issues found                              |
  | Section 8  (Observ)  | 1 gap found (C2, approved)                  |
  | Section 9  (Deploy)  | 1 risk flagged (runbook)                    |
  | Section 10 (Future)  | Reversibility: 4/5, debt items: 2           |
  | Section 11 (Design)  | SKIPPED (no UI scope)                       |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (13 items)                          |
  | What already exists  | written                                     |
  | Dream state delta    | written                                     |
  | Error/rescue registry| 7 rows, 0 CRITICAL GAPS                     |
  | Failure modes        | 7 total, 0 CRITICAL GAPS                    |
  | TODOS.md updates     | 1 item (text in plan; applied in worktree)  |
  | Scope proposals      | 1 deferral proposed, 1 deferred             |
  | CEO plan             | skipped by mode                             |
  | Outside voice        | codex, unavailable                          |
  | Lake Score           | 1/1 recommendations chose complete option   |
  | Diagrams produced    | 6 (arch, data flow, state, error, deploy,   |
  |                      | rollback)                                   |
  | Stale diagrams found | 0                                           |
  | Unresolved decisions | 0                                           |
  +====================================================================+
```

### Unresolved Decisions
None.

# Eng re-review — /plan-eng-review, 2026-10-12 (after the CEO pass)

Target: this plan (`scratchpad/mut-100-plan.md`), MUT-100, fixed for this pass. Server code unchanged since the first eng review (`git log caa801f..HEAD -- server` is empty).

## Re-review scope record

feature answers: none (no cuts proposed); structure: A (Original arrangement — reuses eng D2 from the first pass today, an exact prior answer for this plan); accepted scope: the plan as amended by the CEO review (C1 deferral, C2 audit figures, typed `has_payments`, validation proof rows); pending remedies: none.
Scope Challenge result: scope accepted as-is.
Factual corrections: F3 scope-record wording updated (above, eng Scope record); F4 `/qa` test plan refreshed with the CEO additions.

## Re-review decision ledger

### R9: guard against non-JSON audit metadata
Finding: #A5, P1, confidence 8/10, `repositories/ports.ts:92` (`metadata?: Record<string, unknown>;`), `repositories/prisma.ts:262-270` (`metadata: … as Prisma.InputJsonValue`), `repositories/memory.ts:355-358` (`this.events.push(record)` with no serialization); route tests run on MemoryLedgerStore; reviewer: Claude (native).
Plan baseline: CEO C2/D3 adds money figures to outcome audit metadata; this pass pins them as `formatMoney` strings (factual, approved C2 implementation). No guard approved for the class.
Runtime evidence: a `bigint` in metadata is accepted by the type and by the memory store (tests green) and fails in Prisma's JSON serialization in production; every existing payload already uses decimal strings, so nothing current is affected.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R9 guard for the class | none: type is `Record<string, unknown>`; memory store stores objects as-is | type `metadata` as JSON values (`Record<string, JsonValue>`), so a `bigint` is a typecheck error in every caller | memory store JSON round-trips metadata on append, so route tests fail like Prisma would | no guard; rely on the formatMoney convention and review |
| New outcome events use decimal strings | approved (C2 + this pass) | unchanged | unchanged | unchanged |
| Other approvals (eng D3–D7, CEO C1–C2) | approved | unchanged | unchanged | unchanged |
Question D1:
D1 — How should the ledger stop non-JSON values from reaching audit metadata?
Project/branch/task: Mutaba3a mini-crm on main, MUT-100 eng re-review, Section 1.
ELI10: The new outcome audit events carry money figures. Inside the ledger, money is a special big-integer type that the production database's JSON column can't store. The test database is an in-memory stand-in that stores anything, so a mistake here passes every test and only fails in production. The plan already says to write the figures as text, like every existing event. This asks whether to also put a guard in place, so the next event can't make the same mistake.
Stakes if we pick wrong: recording an award returns a 500 in production even though the outcome was saved, and the lawyer retrying gets "already recorded".
Recommendation: A because a type error catches the mistake at compile time in every caller, for both stores, with no runtime cost.
Completeness: A=10/10, B=9/10, C=6/10
Pros / cons:
A) JSON-typed metadata (recommended)
  ✅ The compiler rejects a bigint or Date in any audit payload before a test even runs
  ✅ Protects both stores and every future event, not just the two this ticket adds
  ❌ Any existing caller passing a non-JSON value must be fixed in the same change (believed none)
B) Memory store round-trips JSON
  ✅ Route tests fail exactly the way Prisma would, so the in-memory stand-in matches production
  ✅ Also catches values the type system can't see, such as undefined inside nested objects
  ❌ Only catches the mistake when a test exercises that event, not at compile time
C) No guard
  ✅ No change to shared repository code in this ticket
  ✅ The new events already use decimal strings, so the immediate bug is avoided
  ❌ The next audit event with a raw money value repeats the trap with green tests
Net: a compile-time guard versus a test-time guard versus relying on convention.
Header: Audit guard
Options:
A) JSON-typed metadata (recommended)
Change `AuditEventInput.metadata` in `ports.ts` to JSON values only (`Record<string, JsonValue>` with a shared `JsonValue` type); fix any caller that fails typecheck; `npm run typecheck` is the proof. Effort S, low risk.
B) Memory store round-trips JSON
`MemoryLedgerStore.audit.append` stores `JSON.parse(JSON.stringify(metadata))` and throws on bigint like Prisma; route tests for the outcome events prove it. Effort S, low risk.
C) No guard
Keep `Record<string, unknown>`; rely on the `formatMoney` convention and the C2 route tests asserting string figures. Effort S, zero implementation work.

State: approved
Actual answer: A) JSON-typed metadata (D1, eng re-review, user, 2026-10-12)
Accepted scope: Change `AuditEventInput.metadata` in `ports.ts` to JSON values only (`Record<string, JsonValue>` with a shared `JsonValue` type); fix any caller that fails typecheck; `npm run typecheck` is the proof. Plan §5 amended.
History: none

Approval readiness: PASS — R9 (D1, eng re-review); structure reuses eng D2 (first pass); inherited approvals unchanged: eng R1–R5 (D3–D7), CEO C1 (D2) and C2 (D3); eng R6–R8 superseded for MUT-100 delivery by CEO C1. Factual corrections (F3, F4, A5 money format, Q3–Q5 wording) change no approved behaviour.

## Re-review findings and dispositions
- Scope Challenge: scope accepted as-is; structure from eng D2; F3 and F4 corrected.
- Section 1 Architecture: [P1] (8/10) A5 bigint audit metadata passes memory-store tests and fails on Prisma → instance fixed as approved C2 implementation (decimal strings); class guarded by R9 (D1, JSON-typed metadata). Proposal coupling fully removed by C1; no dangling references.
- Section 2 Code quality: [P3] (9/10) Q3 `upfrontCountedMinor` lacked the credits input → corrected. [P3] (8/10) Q4 typed result aligned to the `UpdateResult` `kind` style → corrected. [P3] (8/10) Q5 NO_RECOVERY-with-award reason unnamed → `AMOUNT_INVALID`, `field: awardedAmount`.
- Section 3 Tests: 0 unplanned gaps; R5/D7 regression contract carries forward; `/qa` test plan refreshed (F4).
- Section 4 Performance: no issues.
- Outside voice: unavailable (Codex CLI not installed; native fallback lacks TaskOutput).

## Re-review failure-mode delta
| Path | Realistic failure | Handling / test | User sees |
|---|---|---|---|
| Outcome audit | a raw bigint in metadata (passes memory tests, Prisma throws after the commit) | decimal strings (C2) + JSON-only type (R9) caught by `npm run typecheck` | nothing; the error cannot ship |
Critical gaps: 0.

## Re-review parallelization
Unchanged: R9 lands in Lane B (`server/src/repositories/`), before C. Lane A: pure domain. Lane B: data + store (+ R9) → summaries. Then routes → contract export.

## Implementation Tasks (eng re-review)
Synthesized from this review's findings. Each task derives from a specific
finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T12 (P1, human: ~30min / CC: ~3min)** — store — JSON-only audit metadata type
  - Surfaced by: Section 1 — A5 / R9 (D1)
  - Files: `server/src/repositories/ports.ts` (and any caller the typecheck flags)
  - Verify: `npm run typecheck` green; a deliberate bigint in a test payload fails typecheck
_No new tasks from Section 2 (plan wording corrected in place), Section 3 or Section 4._

## Re-review completion summary
- Step 0: Scope Challenge — scope accepted as-is
- Architecture Review: 1 issue found (A5)
- Code Quality Review: 3 issues found (Q3, Q4, Q5; wording corrections)
- Test Review: delta diagram produced, 0 unplanned gaps
- Performance Review: 0 issues found
- NOT in scope: unchanged from the CEO pass
- What already exists: unchanged
- TODOS.md updates: 0 items proposed
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable
- Parallelization: 2 lanes, 2 parallel / 4 sequential (unchanged)
- Lake Score: 1/1 (D1)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | clean | mode: SCOPE_REDUCTION, 0 critical gaps |
| Outside Review | codex via `/plan-eng-review` (x2) and `/plan-ceo-review` | Independent 2nd opinion | 3 | unavailable | CLI not installed; native fallback unavailable; no completed external review |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 129 | issues_open | 4 issues, 0 critical gaps (this re-review; all resolved: A5 via R9/D1, Q3–Q5 corrected) |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | not applicable (server-only ticket) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not run |

- **OUTSIDE COVERAGE:** codex, plan-review phase, attempted three times today (eng, CEO, eng re-review), unavailable each time (CLI not installed; native fallback lacks TaskOutput); no completed external review.
- **VERDICT:** CEO CLEARED. Eng Review ISSUES OPEN (4 findings in this re-review, every one resolved into the plan; open status records mapped work). eng review required

NO UNRESOLVED DECISIONS
