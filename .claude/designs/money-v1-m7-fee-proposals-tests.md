# Money v1 — Milestone 7 test plan

Companion to `money-v1-m7-fee-proposals.md`. Written before implementation.

## Unit (pure)

| File | Cases |
|---|---|
| `src/proposals/__tests__/transitions.test.ts` | the transition table: `approve` only from `PROPOSED`; `agree` from `PROPOSED` and `CLIENT_APPROVED`; `withdraw` from every open state, idempotent on `WITHDRAWN`, refused on `CONVERTED`; `convert` only from `CLIENT_APPROVED` / `AGREED`; agreed amount after `approve` equals the proposed amount; after `agree` equals the explicit figure; `isOpen` |
| `src/summaries/__tests__/compute.test.ts` (+) | `currentProposal`: the open one wins over a converted one; the latest converted when none is open; null otherwise |

## Storage contract (`store-contract-m7.ts`, memory + Postgres)

- `feeProposals.create / getById / list` (filters projectId, customerId, status, open; keyset pagination; organization isolation).
- `findOpenByProject`; a second open proposal for the same project raises `UniqueViolation` (partial unique index in Postgres, map check in memory).
- `transition` is conditional on the current status and bumps `version`; `markConverted` sets `CONVERTED` + `agreementId` and refuses a non-agreed proposal.

## Routes (`routes-m7.test.ts`)

- Create: 201 with the project's currency and `proposedOn` defaulting to today; 422 `PROJECT_ARCHIVED`; 409 `PROPOSAL_OPEN` naming the open id; idempotent replay returns the stored body; 403 without `agreements:write`; cross-organization project → 422 (not found as a validation failure, like agreements).
- Approve → `CLIENT_APPROVED`, `agreedAmount` = proposed, audit `fee_proposal.client_approved`; from `AGREED` → 409 `PROPOSAL_NOT_OPEN { status: AGREED }`.
- Agree with a lower figure from `PROPOSED` and from `CLIENT_APPROVED`; amount validation (canonical decimal, currency digits, > 0); 409 from `WITHDRAWN`.
- Withdraw from each open state; second withdraw is 200 unchanged; from `CONVERTED` → 409.
- Agreement create with `feeProposalId`: proposal becomes `CONVERTED` with `agreementId`; the agreement's audit metadata names the proposal; 422 `PROPOSAL_NOT_AGREED` while `PROPOSED`; 422 `PROPOSAL_PROJECT_MISMATCH` for another project's proposal; a failed agreement create leaves the proposal untouched (transaction).
- List: `?open=true`, `?projectId=`, `?customerId=`, `?status=`; pagination; other organization sees nothing.
- Project summary carries `proposal` (open, then converted, then null); customer summary rows carry it too.
- Contract: the six new paths and the `feeProposalId` property in `openapi.yaml`; version `1.6.0-m7`; `openapi:check` green.

## Malafat

- `mutaba3a-client.test.ts` + contract test: the six new calls and `createAgreement` with `feeProposalId` resolve against the vendored contract.
- `proposals-service.test.ts`: `proposeFee` on an unlinked matter links first (currency required → validation error without it) then creates; on a linked matter never calls link; `approve` / `agree` / `withdraw` pass the attemptId as the idempotency key; `getProposalForWizard` returns null for a missing, withdrawn, converted or other-matter proposal.
- `summaries-service.test.ts`: every linked client becomes a row; rows without figures carry `hasActivity: false`, `figures: []`; figures merge for the ones in the summary; open proposals join to the right rows via the matter links; `compareRows` ranks overdue → outstanding/up to date → quiet → name; `notSetUp` counts unlinked clients only.
- `agreement-wizard-model.test.ts`: `fixedDraftFromProposal` fills amount and pricing basis and leaves the rest of the initial draft intact.
- Routes: `route.test.ts` for the four routes — role matrix (Partner only), body validation (amount, pricingBasis, currency when linking, reason length), Mutaba3a 409 / 422 mapped through `moneyErrorResponse` with `details.reason` preserved.
- `money-i18n.test.ts`: `enums.proposalStatus` covers every status; the four new reasons are present in en / ar / he; `overview.summary.noActivity` and the renamed activity line exist in all three.
- Gates in both repos: lint, typecheck, unit tests, build; `pnpm openapi:generate` committed on the Malafat side; `npm run openapi:check` on the Mutaba3a side.
