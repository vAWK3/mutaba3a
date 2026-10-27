# MUT-479 — Approve a fee proposal with a full agreement body (any schedule, retainer, contingency)

Status: PLAN (eng-ticket, 2026-10-27). Not built. Jira Backlog → Planned.
Tracker: Jira · barmajiyat · MUT via atlassian-barmajiyat · Backlog → Planned → In Progress (eng-build) → In Review (qa-reconcile).

## Neighborhood
- Epic MUT-25. No formal blockers.
- Blocks **MAL-1426** (proposals with any schedule), which is also blocked by MAL-1414 (agreement sheet v2). It supersedes MAL-1094 (contingency proposals, won't do).
- History:
  - M7/M8 fee proposals: `.claude/designs/money-v1-m7-fee-proposals.md`, M8 §6 (approve creates the agreement in one transaction);
  - MUT-107 contingency proposals: `.claude/designs/mut-107-contingency-fee-proposals.md`.
- The organization summary's `proposed` figure and each customer row's open proposals (`routes/summaries.ts:38-90`) read proposals, so a retainer proposal changes them (D3).

## Where the code is today
- `POST /v1/fee-proposals` (`routes/fee-proposals.ts:41-108`) stores `pricingBasis`, `proposedAmountMinor`, `note`, and optional contingency terms. One open proposal per project.
- `POST /v1/fee-proposals/{id}/approve` (`:153-220`):
  - takes `amount` and `schedule ONCE|INSTALLMENTS`, which `approveInstallments` turns into equal shares;
  - builds a `PreviewBody`, then `composePreview` → `createAgreementFromPreview(…, { approveProposal })`;
  - has no preview token.
- `store.agreements.create` takes `approveProposal` for any agreement type and refuses the whole create when the proposal is no longer PROPOSED (`prisma.ts:1389-1396`), so the "approved together or not at all" guarantee already covers retainers.
- Retainer creation lives inline in `routes/retainers.ts:109-157`: a local `compose()`, `store.agreements.create({type: 'RECURRING'})`, then `generateCharges`. The body is `RetainerPreviewRequestSchema` (`schemas.ts:2126`), and the token is `[org, 'retainer', body, rate]`.
- Fixed and contingency bodies are `AgreementPreviewRequestSchema` (custom installments, `percentBasisPoints`, triggers IMMEDIATE/DATE/MANUAL, per-installment VAT treatment, payment terms, due-date overrides).

## Decisions (D3 APPROVED by Basel 2026-10-27; the rest recommended defaults)

**D1 — "The same body as POST /v1/agreements" means one discriminated `AgreementDraft`,** because retainers have their own body today.
- `{ kind: 'FIXED' | 'CONTINGENCY', …AgreementPreviewRequest minus projectId, agreementDate }`, or `{ kind: 'RETAINER', …RetainerPreviewRequest minus projectId, agreementDate }`.
- The project is the proposal's, and the agreement date is `approvedOn`, so the VAT rate in force that day applies (D18 of M8, unchanged).

**D2 — The proposal stores the draft.**
- `fee_proposals.draft JSONB NULL` holds the canonical draft.
- `fee_proposals.agreementType AgreementType NOT NULL DEFAULT 'FIXED'`. The backfill sets `CONTINGENCY` where `commissionRateBasisPoints` isn't null.
- `POST /v1/fee-proposals` accepts `draft` as an alternative to `amount`/`pricingBasis`/`contingency`.
  - When `draft` is given, those fields are derived: `proposedAmountMinor` = fixed total, contingency upfront, or retainer monthly; `pricingBasis` and the contingency columns follow the draft.
  - Sending both forms is 422 `DRAFT_CONFLICT`.
- The draft is validated at create by composing it, with `agreementDate = proposedOn`, so a draft that could never approve is refused when it's saved, not when the client agrees.
- `GET` returns `draft` (null for older proposals) and `agreementType`.

**D3 — A retainer proposal isn't added to the `proposed` total.** The organization summary's per-currency `proposed` stays a sum of one-off amounts (fixed totals and contingency upfronts), because adding a monthly amount to them gives a number that means nothing.
- Retainer proposals still appear in the customer row's `proposals` list, with `agreementType: 'RECURRING'` and their monthly amount.
- `counts.openProposals` counts them.
- Alternative: count one month. Rejected because the sum is still a mixed figure.

**D4 — The full-body approve has its own preview and token.**
- `POST /v1/fee-proposals/{id}/approve/preview` with `{ approvedOn?, agreement: AgreementDraft }` returns the agreement preview (the same wire shape as `/v1/agreements/preview` or `/v1/retainers/preview`, by kind) plus a `previewToken`.
- The token hashes `[org, 'proposal-approve', proposalId, proposal.version, approvedOn, agreement, rate]`.
- `approve` accepts `{ approvedOn?, note?, agreement, previewToken }`. A token mismatch is 409 `PREVIEW_STALE`, and a proposal that isn't open is 409 `PROPOSAL_NOT_OPEN` (both at preview and at approve).
- The old `{ amount, schedule, contingency }` form is unchanged and takes no token. Mixing the two forms is 422 `DRAFT_CONFLICT`.

**D5 — The approved amount is the draft's.** `agreedAmountMinor` = fixed total, contingency upfront, or retainer monthly amount, the same derivation as D2. The partner may edit the draft at approval: the approve body is the agreement that's made, and the stored draft only pre-fills it. The audit event records both, so a change at approval is visible.

**D6 — No PATCH on a proposal's draft in this ticket.** The ticket asks for a stored draft that "Client agreed" reopens. Editing an open proposal is either withdraw-and-repropose or the edit at approval (D5). If MAL-1414 needs in-place edits, that's a follow-up (`PATCH` with `If-Match`).

## Files
- `server/src/retainers/create.ts` (new). Extract the route's `compose()` and the create block into `composeRetainerPreview(store, org, body, today)` and `createRetainerFromPreview(store, org, actor, body, preview, today, now, { approveProposal })`. `routes/retainers.ts` calls them, with no behaviour change, proved by the existing retainer tests passing untouched (DRY with D4).
- `server/src/proposals/draft.ts` (new):
  - `AgreementDraft` types;
  - `draftToPreviewBody(draft, projectId, agreementDate)`, which routes to `composePreview` or `composeRetainerPreview`;
  - `agreedAmountOf(draft)`;
  - `proposalTokenParts(...)`.
  - These are pure apart from the compose call. Unit-tested.
- `server/src/routes/fee-proposals.ts`:
  - create accepts `draft` (D2);
  - new `approve/preview`;
  - `approve` branches on `agreement` vs `schedule`. Both end in `createAgreementFromPreview` or `createRetainerFromPreview` with `approveProposal`.
  - Audit `fee_proposal.approved` gains `agreementType` and `draftChanged`.
- `server/src/schemas.ts`: `AgreementDraftSchema` (union, reusing the existing request schemas via `.omit`), `ApproveFeeProposalPreviewRequest/Response`, the approve request union, and `FeeProposalSchema.draft`/`agreementType`. All additive.
- `server/src/routes/summaries.ts`: the `proposed` sum skips RECURRING (D3). Each customer row's proposal carries `agreementType`.
- `server/src/repositories/{ports,prisma,memory}.ts`: the `FeeProposalRecord.draft`/`agreementType` fields, and create persists them.
- `prisma/schema.prisma` + migration `mut479_proposal_drafts`: two columns and the backfill. A CHECK that RECURRING has null contingency columns (extends MUT-107's CHECK).
- `server/src/app.ts`: bump `API_VERSION` (next free minor `-mut479`) and add the description bullet. Update the pinned literals, then `openapi:generate`.
- Local mode: snapshot fields, and a bump of `CURRENT_STORE_SNAPSHOT_VERSION` (`memory.ts:201`) to the next free number at merge, with a migration (`agreementType` derived as in SQL, `draft` null), and the fingerprint and `everyRecord` tests. `prisma-records-export.ts` selects the new columns.

## Tests (written first)
- `proposals/__tests__/draft.test.ts`: `agreedAmountOf` per kind, `draftToPreviewBody` per kind, and stable token parts.
- `__tests__/fee-proposals-full-approve.test.ts`, one per acceptance criterion:
  - AC1: a 30/70 split with the second stage MANUAL approves into exactly those installments, the first posted and the MANUAL one pending;
  - AC2: a retainer proposal approves into a retainer whose `startMonth` is the draft's, and charges due by today have posted;
  - AC3: a draft edited after the preview → 409 `PREVIEW_STALE`, and an approved or withdrawn proposal → 409 `PROPOSAL_NOT_OPEN` at both preview and approve;
  - AC4: the version is pinned.
- Further tests:
  - the stored draft round-trips on `GET`;
  - a draft that can't be composed is refused at create (e.g. percentages not summing to 100%);
  - `DRAFT_CONFLICT` for mixed forms;
  - the legacy ONCE/INSTALLMENTS approve still passes (the existing `routes-m8` tests untouched);
  - a contingency draft approves into CONTINGENCY with its terms;
  - idempotent replay;
  - two approves racing → one agreement (store contract, Postgres);
  - the organization summary's `proposed` excludes a retainer proposal but lists it on the customer row (D3).
- The retainer extraction: the existing `routes-m5` retainer tests pass unchanged.

Verify through `heavy`, under Node 22: the server typecheck, lint, `openapi:check` and test; `test:db`; root `test:run`.

## Release-QA
Feature `proposal-any-schedule` in `qa/features/portal/malafat-money-api.yaml`:
- Create a proposal with a 30/70 draft, preview the approve, approve it.
- Expect the agreement's two installments (one posted, one MANUAL pending) and the proposal APPROVED, linked.
- Then the same for a retainer draft.

The spec uses Playwright `request` with the QA integration key. MAL-1426 covers the screens.

## Knowledge
- ADR (next free): "A proposal is a stored draft agreement; approving takes the full body with a preview token; retainers stay out of the proposed total" (D1–D5).
- PATTERNS: "one draft union, each kind's own composer" (no fork of the agreement rules).
- CHANGELOG, TEST_PLAN, and SYSTEM_OVERVIEW (API).
- TD row for D6 if MAL-1414 asks for in-place edits.

## Scope check
Covers all 4 ACs and every scope bullet.
Gaps the ticket left open: where a retainer proposal's amount goes in the summary (D3), and editing a stored draft (D6, out of scope).
The ticket says "posts its first due installment in one transaction (ADR-027)". The existing path writes the agreement and the approval in one transaction and posts IMMEDIATE installments right after, healed by lazy posting if a crash falls between. This ticket keeps that path rather than changing the posting model.

## Business / product impact
- A partner proposes any real fee arrangement (a 30/70 split, a fee "when the work is done", a monthly retainer, a contingency deal). When the client agrees, it becomes that agreement exactly, and the history says "approved", not "withdrawn and recreated".
- It unblocks MAL-1426 in the Money overhaul (MAL-1410), and lets Malafat drop its separate contingency-proposal path (MAL-1094).
- Low risk: it's additive (the old approve form keeps working), and the retainer extraction is guarded by the existing retainer suite.
