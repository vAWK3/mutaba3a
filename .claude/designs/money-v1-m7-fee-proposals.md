# Money v1 — Milestone 7: fee proposals (negotiations) and the connected-clients overview (design brief)

- **Date:** 2026-10-09 · **Status:** approved by the owner (all four recommended options) and implemented the same day — Mutaba3a `server/` API `1.6.0-m7`; Malafat side in §6 (Malafat `crm-platform/.claude/CHANGELOG.md` "Money v1 Milestone 7")
- **Tickets:** MAL-939 (epic, follow-up), MAL-150 (UX brief, wireframes §2, §4, §11) · **Plan:** `money-v1-api-contract.md` (additive, §M7 to be appended) · **Builds on:** M2 projects and links, M3 agreements, M6 summaries
- **Repo side:** Mutaba3a `server/` (one table, six routes, one optional field on agreement creation, one block on the project summary) and Malafat `crm-platform/apps/web` + `packages/core` i18n (overview list, matter financial card, four routes). **Malafat schema unchanged** (ADR-150 rule 1: Malafat keeps no financial record).
- **Where this file lives:** as for M3–M6 — Confluence is not reachable from the session and Malafat's repo rule 13 forbids new Markdown there; the Malafat side is §6 of this brief.
- **Owner's answers (2026-10-09):** single round · agreed amount prefills the agreement wizard · fixed fee only · the overview lists every connected client.

## 1. Problem and acceptance criteria

Two gaps, both on the way to a fee agreement:

1. **A matter has no financial state before an agreement exists.** The firm proposes an amount, the client approves it or a different figure is agreed, and none of that is recorded anywhere: the matter's Money tab reads "No fee agreement yet" until the wizard runs. The owner wants Mutaba3a to hold the negotiation, so a matter can read *amount proposed → client approved → final amount agreed*, each step marked by hand, and the agreed amount to flow into the agreement wizard.
2. **The Money overview hides connected clients.** The client table is built from the organization summary, so a client that is linked to a Mutaba3a customer but has no receivable or payment yet is folded into a one-line footnote ("3 linked clients have no financial activity yet"). The owner wants every connected client in the table.

Acceptance:

- A Partner can, on a linked matter (or an unlinked one, linking it in the same step): propose an amount; mark the client's approval of that amount; set a final agreed amount; withdraw an open proposal. Each action is a dialog on the matter financial view (both doors: the Money route and the matter page's Money tab), posts once (attemptId → Idempotency-Key), and the view refreshes with Mutaba3a's state.
- Exactly one proposal is open per project at a time (`PROPOSED`, `CLIENT_APPROVED`, `AGREED`); a second create is refused with `409 PROPOSAL_OPEN` naming the open one. Withdrawn and converted proposals stay in history.
- The project summary (`GET /v1/summaries/projects/{id}` and the rows under the customer summary) carries the current proposal, so every surface that renders the summary can show it without a second call.
- "Create agreement" from an approved or agreed proposal opens the existing wizard with the amount and pricing basis filled in; creating the agreement with `feeProposalId` marks the proposal `CONVERTED` and links the agreement. The wizard still asks for VAT treatment, installments and dates — nothing is posted by the proposal itself.
- The overview table lists every linked client. A client without activity shows dashes for the amounts and a neutral "No activity" pill; the fee-status line under the client name lists its open proposals ("M-2026-014 · Proposed ₪10,000"). Sort stays overdue → outstanding/up to date → quiet → name.
- Every M1–M6 test stays green; `openapi:check` green; API version `1.6.0-m7`; Malafat's vendored contract refreshed; i18n parity (en / ar / he) pinned by the money i18n test; all five gates green in both repos.

## 2. API (Mutaba3a `server/`)

All routes use the existing `agreements:read` / `agreements:write` scopes: a proposal is the pre-agreement of an agreement, and adding a scope is a contract change that would force the pilot key to be reissued (M6 decision 7).

| Method & path | Scope | Notes |
|---|---|---|
| `POST /v1/fee-proposals` | `agreements:write` + Idempotency-Key | `{ projectId, amount, pricingBasis, proposedOn?, note? }` → `201 FeeProposal`. Currency is the project's. `422 PROJECT_ARCHIVED`; `409 PROPOSAL_OPEN { openProposalId }` while another proposal is open. |
| `GET /v1/fee-proposals?projectId=&customerId=&status=&open=&cursor=&limit=` | `agreements:read` | Keyset-paginated like every list. `open=true` narrows to `PROPOSED \| CLIENT_APPROVED \| AGREED`. |
| `GET /v1/fee-proposals/{id}` | `agreements:read` | |
| `POST /v1/fee-proposals/{id}/approve` | `agreements:write` + Idempotency-Key | `{ approvedOn?, note? }`: `PROPOSED → CLIENT_APPROVED`; the agreed amount is the proposed amount. `409 PROPOSAL_NOT_OPEN { status }` from any other state. |
| `POST /v1/fee-proposals/{id}/agree` | `agreements:write` + Idempotency-Key | `{ amount, agreedOn?, note? }`: `PROPOSED \| CLIENT_APPROVED → AGREED` with an explicit final amount (may equal the proposed one). `409 PROPOSAL_NOT_OPEN` from `WITHDRAWN` / `CONVERTED`. |
| `POST /v1/fee-proposals/{id}/withdraw` | `agreements:write` + Idempotency-Key | `{ reason? }`: any open state → `WITHDRAWN`; idempotent on an already withdrawn one; `409 PROPOSAL_NOT_OPEN` once converted. |
| `POST /v1/agreements` (existing) | — | gains optional `feeProposalId`. The proposal must belong to the same project and be `CLIENT_APPROVED` or `AGREED` (`422 PROPOSAL_NOT_AGREED`, `422 PROPOSAL_PROJECT_MISMATCH`); on success it becomes `CONVERTED` with `agreementId` set, in the same transaction. The amount is **not** forced to match: the wizard prefills it and the Partner may still edit; the proposal keeps its own figures for the record. |
| `GET /v1/summaries/projects/{id}` (existing) | — | `ProjectSummary` gains `proposal: FeeProposalSummary \| null` = the open proposal if any, else the most recent `CONVERTED` one, else null. |

`FeeProposal = { id, projectId, customerId, currency, status, pricingBasis, proposedAmount, proposedOn, note, clientApprovedOn, agreedAmount, agreedOn, agreedNote, withdrawnAt, withdrawnReason, agreementId, version, createdAt, updatedAt }`. `agreedAmount` is `null` while `PROPOSED` or `WITHDRAWN`, the proposed amount after `approve`, the explicit figure after `agree`. `FeeProposalSummary` is the subset `{ id, status, pricingBasis, proposedAmount, agreedAmount, proposedOn, agreementId }`.

New reasons: 409 `PROPOSAL_OPEN`, `PROPOSAL_NOT_OPEN`; 422 `PROPOSAL_NOT_AGREED`, `PROPOSAL_PROJECT_MISMATCH` (plus the existing `PROJECT_ARCHIVED`). Audit actions: `fee_proposal.created`, `fee_proposal.client_approved`, `fee_proposal.agreed`, `fee_proposal.withdrawn`, `fee_proposal.converted` (entity type `fee_proposal`; the conversion also appears on the agreement's `agreement.created` metadata).

## 3. Status vocabulary (computed here, never by the client)

| Status | Meaning on screen | Terminal |
|---|---|---|
| `PROPOSED` | Amount proposed to the client; awaiting their answer | no |
| `CLIENT_APPROVED` | The client approved the proposed amount; it is the agreed amount | no (can still move to `AGREED` or `WITHDRAWN`, or convert) |
| `AGREED` | A final amount was set by hand (same as or different from the proposed one) | no (can withdraw or convert) |
| `CONVERTED` | A fee agreement was created from it | yes |
| `WITHDRAWN` | Withdrawn by the firm, or the client declined | yes |

"Open" = `PROPOSED | CLIENT_APPROVED | AGREED`. The `ProjectSummary.status` vocabulary of M6 is unchanged: a project with an open proposal and no agreement still reads `NONE` with `kind: NONE` — the proposal block beside it is what the UI reads. Malafat renders these words; it never derives a state.

## 4. Data model and storage

- `fee_proposals` (new): `id, organizationId, projectId, customerId, currency, status, pricingBasis, proposedAmountMinor (BIGINT), proposedOn (VarChar 10), note?, clientApprovedOn?, clientApprovalNote?, agreedAmountMinor?, agreedOn?, agreedNote?, withdrawnAt?, withdrawnReason?, agreementId? (@unique), requestId?, version, createdAt, updatedAt`. Indexes `(organizationId, projectId)`, `(organizationId, customerId)`, `(organizationId, createdAt, id)`. "One open proposal per project" is serialised by the **project row lock** (`SELECT … FOR UPDATE` in the create transaction, the pattern of the payment counters): Prisma cannot declare a partial unique index, so the schema and the migration would drift. The repository raises `UniqueViolation('fee_proposals.open_per_project')` and the route answers `409 PROPOSAL_OPEN` (memory store: same check on its map).
- Amounts are minor units in the project currency, serialized as canonical decimal strings (`money.ts`), the convention of every other table. Dates are organization-timezone calendar dates (`dates.ts`); `proposedOn` / `approvedOn` / `agreedOn` default to today.
- `FeeProposalRepository` on `LedgerStore`: `create`, `getById`, `list(filter, page)`, `findOpenByProject`, `transition(organizationId, id, expectedStatuses, patch, at)` (one conditional update that returns `not_found | wrong_status | ok`), `markConverted(…, agreementId)` used inside the agreement-creation transaction. Memory and Prisma implementations, both under the store-contract tests.
- Migration `20261009_m7_fee_proposals` (Prisma); `prisma migrate deploy` through `scripts/db.sh migrate` on release, as today.

## 5. Decisions (recorded for review)

1. **Single round, three verbs.** One proposed amount, one approval, one final amount. A counter-offer is recorded by `agree` with the counter figure; a declined proposal is `withdraw` with a reason. The audit trail is the history; no offers table (owner's answer 1).
2. **Approval is a state, not a copy of `agree`.** "Client approved" and "agreed at ₪X" are different facts the firm wants to read back; both end in an agreed amount the wizard can use.
3. **Converting is the wizard's job.** Agreeing posts nothing. The wizard opens with `?matter=&proposal=` and prefills amount and pricing basis; VAT, installments and dates stay the Partner's choices (owner's answer 2). The server marks `CONVERTED` only when the agreement is actually created, so a proposal can never read "converted" without an agreement behind it.
4. **Fixed fee only.** A proposal is one total amount in the project currency; the wizard's retainer branch does not read it (owner's answer 3). A `kind` field is deliberately not added; if retainer proposals are wanted later, adding `kind: FIXED | RECURRING` with a default is additive.
5. **One open proposal per project, enforced in the store's create transaction.** A second proposal while one is open is a mistake nine times out of ten; the tenth withdraws first. Proposals are allowed while an agreement already exists (a later-phase fee), and conversion then creates a new fixed-fee agreement, never a supplement.
6. **No amend route.** A mistyped proposal is withdrawn and re-proposed; both stay in history. A `PATCH` with If-Match is additive if the owner wants it (listed under out of scope).
7. **Scopes reused** (`agreements:*`): no key reissue, no scope vocabulary change.
8. **The overview lists linked clients, not every client** (owner's answer 4). Unlinked clients stay behind "Show linking", which keeps the table a financial list and the sync table the set-up tool.

## 6. Malafat side (same brief)

### 6.1 Overview (`/admin/money`, wireframe §2)

- `getMoneyOverview` builds a row for **every linked client** (from the sync view), then merges the organization summary's customer figures into the rows that have them. `MoneyOverviewView` gains `activeClients` (rows with figures) and each row gains `hasActivity` and `proposals: Array<{ matterId, matterNumber, status, amount, currency }>` (open proposals of the client's linked matters). `linkedWithoutActivity` is removed (it is now visible in the table).
- Open proposals come from one `GET /v1/fee-proposals?open=true` listing (paged to the end), joined to matters by `projectId` through the sync view's links.
- Rendering: amounts "—" and a neutral outline pill "No activity" (`overview.summary.noActivity`) when `figures` is empty; the activity line reads "{linked} connected clients · {active} with financial activity"; the fee-status line under the client name lists its open proposals as small pills ("M-2026-014 · Proposed ₪10,000" / "Agreed ₪9,000"), each linking to the matter's financial page. Sort: overdue → outstanding/up to date → quiet → name (`compareRows` extended with the quiet rank).

### 6.2 Matter financial view (both doors: `/admin/money/clients/[c]/matters/[m]` and the matter page's Money tab)

- A **Fee negotiation card** above the agreements, present when the matter has an open proposal **or** has no agreement yet:
  - no proposal: "No amount proposed yet" · **Propose amount** (secondary) beside the existing **Add agreement** (primary).
  - `PROPOSED`: "Proposed ₪10,000 · VAT-exclusive · 9 Oct 2026 · awaiting the client" (+ note) · **Mark client approved** · **Set agreed amount** · **Withdraw**.
  - `CLIENT_APPROVED` / `AGREED`: "Agreed ₪9,000 · client approved 10 Oct" (with "proposed ₪10,000" when different) · **Create agreement** (primary, → wizard `?matter=&proposal=`) · **Set agreed amount** (only from `CLIENT_APPROVED`) · **Withdraw**.
  - `CONVERTED` / `WITHDRAWN`: not a card; visible in History (M6 audit) and, for a converted one, as "from proposal ₪9,000" under the agreement row.
- **Unlinked matter:** the "no financial record" state gains **Propose amount** beside **Add agreement**; the propose dialog then asks for the currency (office currency preselected, as the sync table does) and the service links the matter first (`linkMatter`), then proposes. One dialog, one post from the browser.
- Dialogs (`fee-proposal-dialogs.tsx`, same conventions as `TriggerInstallmentDialog` / `CreditReceivableDialog`): Propose (amount via `MoneyInput`, pricing basis segment, date defaulting to today, note), Approve (date, note; shows the amount being approved), Agree (amount prefilled with the proposed one, date, note), Withdraw (reason, destructive). All mint an `attemptId` on open and send it as the Idempotency-Key; errors through `describeMoneyFailure` with the new reasons in words.
- **Wizard prefill:** `/admin/money/agreements/new?matter=&proposal=` loads the proposal through the service, fills the fixed draft's amount and pricing basis, shows "From proposal ₪9,000 · agreed 10 Oct" above the amount, and sends `feeProposalId` with the create. A missing or non-agreed proposal is ignored (plain wizard) — never an error page.
- `MatterFinancialView` gains `proposal: Mutaba3aFeeProposal | null` (the open one). The project summary already carries `proposal` for the tiles.

### 6.3 Module layout

| Piece | Path |
|---|---|
| Service | `features/money/application/proposals-service.ts` — `getOpenProposal(matterId)`, `listOpenProposals()`, `proposeFee(matterId, { currency?, amount, pricingBasis, proposedOn?, note?, attemptId })`, `approveProposal`, `agreeProposal`, `withdrawProposal`, `getProposalForWizard(proposalId, matterId)` |
| Routes (Partner-only, each with `route.spec.ts`, errors via `moneyErrorResponse`) | `POST api/admin/money/matters/[matterId]/proposals`, `POST api/admin/money/proposals/[proposalId]/{approve,agree,withdraw}` |
| Client | `mutaba3a-client.ts`: `createFeeProposal`, `listFeeProposals`, `getFeeProposal`, `approveFeeProposal`, `agreeFeeProposal`, `withdrawFeeProposal`; `createAgreement` body accepts `feeProposalId` |
| Types / schemas | `domain/types.ts` (`Mutaba3aFeeProposal`, `FeeProposalStatus`, summary block), `domain/schemas.ts` (request bodies, response schemas for the specs), `MUTABA3A_CONFLICT_REASONS` / `MUTABA3A_VALIDATION_REASONS` extended |
| UI | `features/money/ui/fee-proposal-card.tsx`, `fee-proposal-dialogs.tsx`; `matter-financial.tsx` mounts the card; `overview-summary.tsx` and `summaries-service.ts` for §6.1; `agreement-wizard.tsx` + page for the prefill |
| i18n | `money.proposals.*`, `money.enums.proposalStatus.*`, `money.overview.summary.{noActivity,connected}`, reasons `PROPOSAL_OPEN`, `PROPOSAL_NOT_OPEN`, `PROPOSAL_NOT_AGREED`, `PROPOSAL_PROJECT_MISMATCH` — en, with ar / he drafts flagged for native review as in wireframe §11 |

### 6.4 Vocabulary (en / ar / he drafts)

| Status | en | ar | he |
|---|---|---|---|
| `PROPOSED` | Proposed · awaiting client | مقترح · بانتظار العميل | הוצע · ממתין ללקוח |
| `CLIENT_APPROVED` | Client approved | وافق العميل | הלקוח אישר |
| `AGREED` | Agreed | متفق عليه | סוכם |
| `CONVERTED` | Agreement created | أُنشئت الاتفاقية | נוצר הסכם |
| `WITHDRAWN` | Withdrawn | مسحوب | בוטל |
| (overview) | No activity | لا نشاط | אין פעילות |

Pills are neutral outlines with explicit text (wireframe §11); no colour carries meaning.

## 7. Out of scope

Multi-round offers / counter-offer rows; retainer (monthly) proposals; amending an open proposal in place (`PATCH`); proposals that convert into a supplement of an existing agreement; a cross-client "proposals pipeline" page; client-facing approval (a link the client clicks); PDF fee quotes; the Mutaba3a local app (`src/`) — the hosted ledger only.
