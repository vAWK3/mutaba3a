# Money v1 — Milestone 8: a collections-first overview and approval that creates the payable (design brief)

- **Date:** 2026-10-10 · **Status:** design-reviewed (D1–D13) and eng-reviewed (D14–D20); **implemented 2026-10-10** on `feature/money-v1-m8` in both repositories (Mutaba3a server: API `1.7.0-m8`, 342 tests incl. Postgres; Malafat: 226 Money tests; end-to-end 103/103 with Malafat's client against the M8 server). Not pushed, not merged, not deployed: operator steps are the handover's. Open: native ar/he review of the new strings; manual 375px LTR/RTL pass; Malafat has no caller for project archive yet, so D19's "withdraw first" copy waits.
- **Scope:** Malafat `/admin/money` overview (`overview-summary.tsx`, `page.tsx`), a new `/admin/money/link` view, the matter financial view's approve dialog; Mutaba3a `server/` fee-proposal lifecycle and `CurrencySummary`.
- **Wireframe:** `money-v1-m8-overview-wireframe.html` (same folder): three screens, state switcher (populated / no open proposals / nothing linked / loading / unreachable / proposals failed), LTR and RTL with Arabic drafts. The wireframe is the visual reference for every item below.
- **Supersedes:** M7 brief decisions 2 ("approval is a state, not a copy of agree") and 3 ("converting is the wizard's job"); M7 §6.1 overview rendering where it conflicts.
- **Jira:** MAL-939 (Malafat), MUT-25 (Mutaba3a server). Tickets listed in §9.

## 1. Problem and acceptance criteria

The overview opened with three 24px tiles inside a card, then setup controls, then a table padded with unlinked clients. The numbers shouted louder than the clients to chase, Unallocated held a headline slot it does not deserve, and the proposed-but-not-approved pipeline had no figure. Separately, a fee proposal produced no debt until a Partner ran the agreement wizard, so "the client said yes, record their payment" was two screens away.

Acceptance:

1. The overview's first scan lands on the client table; the three figures read as one quiet line.
2. The third figure is **Proposed**: Mutaba3a's `CurrencySummary.proposed`, the sum of `PROPOSED` fee proposals whose project is in the selected currency. The row pills are the same proposals, delivered in the same summary response (`CustomerSummaryRow.proposals`), so with no filter applied the pills add up to the figure by construction; pills for proposals on projects without a linked matter still count toward the figure and are listed under the client without a matter link (D17).
3. Unallocated does not appear anywhere on the overview (tile or row line); it stays on the client page and the payment detail.
4. Linking lives at `/admin/money/link`; the overview lists linked clients only and carries one line "N clients not linked · Link clients".
5. "Client approved" opens a dialog (final amount, approval date, one payment or installments, due date / first due date) and, on confirm, creates the agreement in Mutaba3a dated `approvedOn`: the first installment posts as a receivable at once, later installments post on their dates (D15 B). The matter view then shows the agreement's receivable row with **Record payment** as its primary action, and a toast "Fee of ₪X approved · ₪Y due {date}" (X = agreed total, Y = first installment; D15 B copy correction).
6. The overview is one Mutaba3a call (`GET /v1/summaries/organization`); if it fails the whole-page error card shows with Retry. There is no partial state (D17 retired D10).
7. Approve failures the dialog must handle inline, keeping its values: `PROPOSAL_NOT_OPEN` (409), `VAT_RATE_MISSING` (422, names the date, links to Money › Settings), `CUSTOMER_ARCHIVED` / `PROJECT_ARCHIVED` (422), validation (D18).
8. Archiving a project with an open proposal is refused (`422 PROPOSAL_OPEN`); Malafat's matter archive flow shows "Withdraw the open fee proposal first" (D19).
9. Under 640px, each client is a two-line tappable row (name + red Overdue; Outstanding · last payment · status).
10. The currency switch appears only when more than one currency has a non-zero figure (owed, overdue or proposed; D13 + OV-F2).

## 2. Decisions (D-numbers from the review)

| # | Decision | Why |
|---|----------|-----|
| D2 | Page job = **who owes me** (collections first). | Mirrors MUT-1 ("what I did, what I'm owed, what they paid") and the silence-first home (MAL-566). |
| D3 | Figures as an **inline stat strip**: 12px muted label, 16px semibold tabular value, thin dividers, no cards; currency segment at the row end. The "Receivables" card is removed. | Scannable without competing with the table; red Overdue carries the urgency alone. |
| D4 | **Proposed = `PROPOSED` only.** | Owner: "proposed means open; client approved converts it to a payable". |
| D5 | Approval **creates the payable**, through a dialog asking final amount (prefilled), approval date, one payment vs installments, due date / schedule. | One click short of "record payment" without guessing due dates. |
| D6 | **Unallocated leaves the overview entirely.** | Owner: client page only. |
| D7 | Linking moves to **`/admin/money/link`**; overview = linked clients + one footer line. | Setup is per client, not per day. |
| D8 | Label **Proposed · معروض · מוצע** — the status word. | Strip, pill and matter card say the same thing. |
| ~~D10~~ | ~~Partial page when only the proposals call fails.~~ Superseded by D17: the overview is one call, so there is no partial state. | The figure and the pills share one source. |
| D11 | After approve: **stay on the matter view**, proposal card becomes the receivable row, Record payment primary, toast. | Closes the loop on the same screen. |
| D12 | **Two-line rows under 640px**, whole row ≥56px tappable. | Phone is for catching up (MAL-853). |
| D13 | **Currency segment hidden** with one currency; a tab per currency with any non-zero figure. | A one-tab control is dead UI. |
| D9 | Wireframe skeleton approved. | — |
| D14 | Original file arrangement: new `agreements/create.ts`, `stat-strip.tsx`, `link/page.tsx`. | Reusable pieces get their own files and registry entries. |
| D15 | Approve in installments posts the **first installment now, the rest on their dates** (M3 convention). | Owed grows as installments fall due; same behaviour as wizard-made agreements. |
| D16 | `listUnpostedDue` also returns unposted IMMEDIATE installments, so the lazy path and reconcile heal a crash between create and post. | Cheap healing of a silent gap that approve makes common. |
| D17 | Open proposals travel **inside the organization summary** (`CustomerSummaryRow.proposals`, `CurrencySummary.proposed`); overview makes one call; D10 retired. | One source for figure and pills; less code in both repos. |
| D18 | Agreement dated `approvedOn`; `VAT_RATE_MISSING` / archived errors shown inline with a link to Money › Settings. | Truthful date; no dead-end dialog. |
| D19 | Archive is refused while a proposal is open (`422 PROPOSAL_OPEN`). | Mirrors the outstanding-receivables rule; no stale Proposed. |
| D20 | Edit the M7 migration in place; dev databases reset. | Nothing deployed; no data to map. |
| OV-F6 (recorded trade-off) | A client who approves and pays the whole fee the same day produces a receivable for installment 1 and an unallocated remainder visible only on the client page. | Accepted consequence of D15 B + D6; a later "paid in full today" option on the dialog can remove it. |

## 3. Information architecture

```
/admin/money (overview)                       /admin/money/link (setup)
├─ h1 Money · "Connected to {org}"            ├─ breadcrumb Money › Link clients
├─ StatStrip: Owed | Overdue | Proposed [ILS|USD]   ├─ "24 clients, 18 linked · 41 matters, 33 linked"
├─ "As of {date}"                             ├─ search · currency for new links · Link all
├─ toolbar: search · Status filter            └─ sync table (today's SyncTable, unchanged behaviour)
├─ client table (linked clients only)
│   client [+ Proposed pills] · legal · matters ▾ · outstanding · overdue · last payment · status · View
└─ "N clients not linked · Link clients"
```

First / second / third: red Overdue cells and badges → client names → the strip. The strip is deliberately fourth.

Sort unchanged from M7: overdue → outstanding/up to date → quiet → name. Status filter loses `not_linked` (those rows are gone) and keeps all / quiet / customer statuses.

## 4. Interaction states

| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| StatStrip | three skeleton bars under the labels | all `₪0`, Proposed muted | whole-page error card (summary failed) | figures; Overdue red when ≠ 0 | none: one call (D17) |
| Currency segment | hidden | hidden | hidden | shown only when >1 currency has a non-zero owed/overdue/proposed figure (D13) | — |
| Client table | two skeleton rows | nothing linked → dashed card "No clients linked to Mutaba3a yet" + **Link clients** primary | hidden behind the error card | rows; "No activity yet" badge for linked-quiet clients; pills from `row.proposals` | — |
| Search / filter | — | "No clients match" (existing `overview.filters.noResults`) + Clear | — | "Showing N of M" aria-live | — |
| Footer link line | hidden | hidden (empty card has the CTA) | hidden | "N clients not linked · Link clients"; hidden when N = 0 | shown |
| Approve dialog | Approve button busy label | — | inline, values kept: `PROPOSAL_NOT_OPEN`; `VAT_RATE_MISSING` with the date and a link to Money › Settings; `CUSTOMER_ARCHIVED` / `PROJECT_ARCHIVED`; field validation (amount > 0, count 2–60) (D18) | closes; agreement receivable row replaces the proposal card; toast "Fee of ₪X approved · ₪Y due {date}" | — |
| Matter archive (Malafat) | — | — | `PROPOSAL_OPEN` → "Withdraw the open fee proposal first" + link to the matter's Money tab (D19) | archived | — |
| /admin/money/link | skeleton table | "Every client is linked" + link back to Money | error card + Retry | rows; Link / Linked · {currency} | — |

## 5. Journey storyboard

| Step | User does | Feels | Supported by |
|---|---|---|---|
| 1 | Opens Money | "anything red?" | strip with red Overdue; overdue rows first |
| 2 | Taps an overdue client | focused | client page (existing) |
| 3 | Records the payment | relief | payment wizard (existing) |
| 4 | Back to Money | "did it land?" | figures re-read from Mutaba3a; row badge flips |
| A1 | Opens a matter with a proposal | expectant | fee-proposal card (M7) |
| A2 | Mark client approved | "is it owed now?" | D5 dialog creates the receivable |
| A3 | Dialog closes | done; wants to record payment | receivable row, Record payment primary, toast (D11) |

## 6. Mutaba3a API (server/, 1.6.0-m7 → 1.7.0-m8)

Nothing is deployed (handover §0), so the M7 lifecycle is replaced rather than versioned.

| Change | Detail |
|---|---|
| `FeeProposalStatus` | `PROPOSED \| APPROVED \| WITHDRAWN`. `CLIENT_APPROVED`, `AGREED`, `CONVERTED` removed; `POST …/agree` removed; the **route** schema `AgreementCreateRequest` loses `feeProposalId` (the store input `CreateAgreementInput.feeProposalId` stays: it is the approve path's mechanism, F1). `proposals/transitions.ts`: verbs `approve \| withdraw`, `allowedFrom(approve) = [PROPOSED]`, `currentProposal` prefers the open one, else the latest `APPROVED`; header diagram rewritten. M7 migration edited in place (D20); `agreedOn`/`agreedNote` dropped, `clientApprovedOn` kept as the approval date. |
| `POST /v1/fee-proposals/{id}/approve` | Body `{ amount, approvedOn?, schedule: { kind: 'ONCE', dueOn } \| { kind: 'INSTALLMENTS', count, firstDueOn }, note? }`. Validation: `amount` > 0 in the project currency; `approvedOn` ISO, not absurd (default today); `count` integer 2..`MAX_INSTALLMENTS` (60); due dates ISO, may precede `approvedOn` (same as agreement `dueDate` overrides today; an instantly overdue receivable is the firm's statement of fact). Composition (new `agreements/create.ts`): `agreementDate = approvedOn` (D18, so the VAT rate in force on that date applies, `VAT_RATE_MISSING` otherwise); treatment from `pricingBasis`; installments: ONCE → one `IMMEDIATE` with `dueDate = dueOn`; INSTALLMENTS → amounts split by the approve route into equal minor-unit shares with the remainder on the first (`splitInstallments` has no equal-shares mode), installment 1 `IMMEDIATE` with `dueDate = firstDueOn`, installments 2..n `DATE` at `clampDay(addMonths(monthOf(firstDueOn), k), day)` with `dueDate` = trigger date (D15 B). Then `composePreview` → `createAgreementFromPreview(store, org, actor, body, preview, { feeProposalId })`: the store transaction creates agreement + installments and transitions the proposal `PROPOSED → APPROVED` with `agreedAmountMinor`, `clientApprovedOn = approvedOn`, `agreementId`, or throws `StateConflict` → `409 PROPOSAL_NOT_OPEN`; IMMEDIATE posting and `postDueItems` follow as in `POST /v1/agreements`. Returns `{ proposal, agreement: AgreementDetail }`. Errors: `409 PROPOSAL_NOT_OPEN`, `422 PROJECT_ARCHIVED`, `422 CUSTOMER_ARCHIVED`, `422 VAT_RATE_MISSING { date }`, validation. Audit: `fee_proposal.approved` (agreedAmount, approvedOn, agreementId) then `agreement.created` (with `feeProposalId`) then `installment.posted`. Idempotent via `Idempotency-Key`. Scope `agreements:write`. |
| `POST /v1/agreements` | Behaviour unchanged (regression contract: `routes-m3.test.ts:89-170`); body loses `feeProposalId`; implementation moves into `createAgreementFromPreview`. |
| `AgreementRepository.listUnpostedDue` | also returns unposted, non-voided `IMMEDIATE` installments on ACTIVE agreements (MANUAL stays excluded); `postDueItems` audits `trigger: installment.triggerType`; `postingDateFor` already returns today for a past agreement date, so a healed IMMEDIATE installment posts today with its own `dueDateOverride` when set (approve-created ones always have one) (D16, OV-F5). Store-contract m8 test. |
| `GET /v1/summaries/organization` | `CustomerSummaryRow` gains `proposals: [{ proposalId, projectId, amount, proposedOn }]` (PROPOSED proposals on projects in the block currency); `CurrencySummary` gains `proposed: Amount` (their sum) and `counts.openProposals`. The currency set and each block's customer set widen to include customers that only have PROPOSED proposals (OV-F2), so a proposals-only firm gets a block. ADR-150 holds: Malafat renders, never sums (D17). |
| `POST /v1/projects/{id}/archive` | `409 PROPOSAL_OPEN { openProposalId }` while a PROPOSED proposal exists on the project (D19; 409 like the existing `PROJECT_HAS_OUTSTANDING` refusal, `PROPOSAL_OPEN` is already a CONFLICT reason). |
| `GET /v1/fee-proposals?open=true` | `open` now means `PROPOSED`. Still used by the matter financial view. |
| `ProjectSummary.proposal` | unchanged shape; `agreementId` set once `APPROVED`. |
| Version | `API_VERSION` and `openapi.yaml` → `1.7.0-m8`; Malafat's vendored contract follows. |

Reconcile script gains the healed IMMEDIATE case for free through `postDueItems`; `GET /v1/summaries/projects/{id}` is unaffected.

## 7. Malafat side

| Layer | Change |
|---|---|
| Routes | `app/(authenticated)/admin/money/page.tsx` renders `OverviewSummary` only; new `admin/money/link/page.tsx` mounts `SyncTable` + `useLinkActions` with breadcrumb. |
| UI | new `features/money/ui/stat-strip.tsx` (`StatStrip({ stats, segment? })`, registered in COMPONENT_REGISTRY); `overview-summary.tsx` drops the Tiles, the Receivables card, the sync summary/currency/Link all toolbar, the unallocated row line and unlinked rows; adds the footer link line and the `<640px` two-line row branch (`ClientRowCompact`). |
| Service | `summaries-service.ts`: `getMoneyOverview` makes one Mutaba3a call plus the sync view; pills come from `row.proposals` joined to matters by `projectId` (a proposal whose project has no linked matter still lists under the client, without a matter link); `currencies[].proposed` and `counts.openProposals` pass through; linked clients only; `listOpenProposalsByProject` is no longer used here (D17). `proposals-service.ts`: `approveProposal(matterId, { amount, approvedOn, schedule, attemptId })`; `agreeProposal` and the wizard prefill (`getProposalForWizard`, `?proposal=`) removed. Matter archive flow maps `PROPOSAL_OPEN` (D19). |
| Contract | `features/money/contract` vendored OpenAPI → 1.7.0-m8; `OPEN_FEE_PROPOSAL_STATUSES = ['PROPOSED']`; `CONVERTIBLE_FEE_PROPOSAL_STATUSES` removed. |
| Dialogs | `fee-proposal-dialogs.tsx`: "Mark client approved" becomes the approve dialog of wireframe screen 3 (final amount, approved on, One payment / Installments radio, due date or count + first due date, monthly implied); inline errors per D18 with a link to `/admin/money/settings`, values kept; "Set agreed amount" removed; Withdraw unchanged. |
| Matter view | `fee-proposal-card.tsx` renders only for `PROPOSED`; `matter-financial.tsx:205` reads `summary.proposal.status === "APPROVED"` for the "from proposal" line; after approve the agreement's receivable row shows with Record payment as its primary button; toast `money.proposals.approvedToast` = "Fee of {total} approved · {first} due {date}". |
| i18n | new keys `money.overview.strip.{owed,overdue,proposed}`, `money.overview.notLinkedLine`, `money.link.*` (title, breadcrumb, allLinked), `money.proposals.approve.{title,finalAmount,finalHint,approvedOn,howPay,once,installments,dueOn,count,firstDueOn,effect,confirm,vatMissing,settingsLink}`, `money.proposals.approvedToast`, `money.reasons.PROPOSAL_OPEN` (archive wording); remove `overview.summary.{receivables,totalOutstanding,notYetDue,unallocated,unallocatedPayments}` and `enums.proposalStatus.{CLIENT_APPROVED,AGREED,CONVERTED}`. ar/he drafts in the wireframe; native review stays an open follow-up. |
| Tests | `overview-rows.test.ts` (linked-only; pills from `row.proposals`; unlinked-matter proposal listed without link), `summaries-service.test.ts` (one call; proposals-only currency block), `stat-strip.test.tsx` (segment hidden rules incl. proposed), `proposals-service.test.ts` (approve payload ONCE/INSTALLMENTS, 409/422 propagation), dialog test for inline `VAT_RATE_MISSING` rendering, contract test against 1.7.0-m8, i18n parity. Mutaba3a: `routes-m8.test.ts` (approve ONCE/INSTALLMENTS, equal split remainder, month clamp, 409 from APPROVED/WITHDRAWN, 422 VAT_RATE_MISSING/archived, idempotent replay, audit order, summary `proposed` + rows + proposals-only currency, archive refusal), `store-contract-m8.ts` (PROPOSED → APPROVED in the create transaction; `listUnpostedDue` returns unposted IMMEDIATE), `transitions.test.ts` rewritten; `routes-m3.test.ts` untouched and green. |

Design tokens (crm-platform/DESIGN.md): strip labels `stone-500`, values `--foreground` with `tabular-nums`, dividers `--border`, Overdue `--destructive`, segment and inputs `--radius-sm`, dialog `--radius-lg`, no shadows. Phone row ≥56px, full-row target.

## 8. NOT in scope

- A cross-client proposals pipeline page (M7 §7 still applies); the figure plus pills is the whole pipeline surface.
- Unallocated nudges anywhere outside the client page (owner's call, D6).
- Multi-round offers, retainer proposals, client-facing approval links, PDF quotes (M7 §7).
- Office Admin access to Money (MAL-870).
- Malware scan on attachments, native ar/he review (handover §4; separate tickets).
- Flutter: `/api/admin/money/*` stays in `openapi.yaml`; no mobile client work. The <640px layout is the web app on a phone.

## 9. Tickets (created 2026-10-10, barmajiyat.atlassian.net)

**MUT-25 (Mutaba3a server)**
- MUT-40 — M8: fee proposal lifecycle `PROPOSED → APPROVED | WITHDRAWN`; approve creates the agreement in one transaction (API 1.7.0-m8).
- MUT-41 — M8: `CurrencySummary.proposed` and `counts.openProposals` for the organization summary.

**MAL-939 (Malafat)**
- MAL-940 — Money overview: StatStrip replaces the tiles; Proposed as the third figure; Unallocated removed from the overview.
- MAL-941 — Money overview: linked clients only; `/admin/money/link` holds the sync table; footer line.
- MAL-942 — Money overview: currency segment rules (incl. proposed); phone two-line rows. (Partial state removed by D17.)
- MAL-943 — Fee proposals: approve dialog creates the agreement (D15 B, D18 errors); receivable row + Record payment; remove agree/convert paths and wizard prefill; archive `PROPOSAL_OPEN` reason (D19); contract bump to 1.7.0-m8.

Order: MUT-40 → MUT-41 → MAL-943 (contract) → MAL-940 → MAL-941 → MAL-942. Ticket descriptions updated 2026-10-10 after the eng review.

Follow-ups already noted in the handover, not yet ticketed: native ar/he review of `money.json`; attachment malware scan.

## What already exists (reuse)

`Segment`, `Badge` (variants destructive/success/secondary/outline), `MoneyAmount`, `formatIsoDate`, `DebouncedInput`, `SelectWithOptions`, `ConfirmDialog`, `SyncTable` + `useLinkActions` (moved, not rewritten), `buildOverviewRows`/`filterOverviewRows`, `fee-proposal-dialogs.tsx` (Withdraw kept), M3 agreement service and installment scheduling on the server, the M6 audit listing for history.

## Implementation Tasks

Synthesized from this review's findings. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~3d / CC: ~2h)** — Mutaba3a `server/` — Replace the fee-proposal lifecycle; approve creates the agreement atomically (MUT-40)
  - Surfaced by: D4, D5
  - Files: `server/src/schemas.ts`, `server/src/routes/fee-proposals.ts`, `server/src/routes/agreements.ts`, store `FeeProposalRepository`, migration, `server/openapi/openapi.yaml`, `server/src/app.ts` (API_VERSION), `routes-m8.test.ts`
  - Verify: `cd server && npm test`; contract tests; openapi check
- [ ] **T2 (P1, human: ~1d / CC: ~30min)** — Mutaba3a `server/` — `CurrencySummary.proposed` + `counts.openProposals` (MUT-41)
  - Surfaced by: D4, ADR-150
  - Files: `server/src/schemas.ts`, `server/src/routes/summaries.ts`, summary service, `routes-m6.test.ts`
  - Verify: `npm test`; e2e script run
- [ ] **T3 (P1, human: ~2d / CC: ~1h)** — Malafat overview — StatStrip, Proposed figure, Unallocated removed (MAL-940)
  - Surfaced by: D3, D4, D6, D8, Pass 5
  - Files: `features/money/ui/stat-strip.tsx`, `_components/overview-summary.tsx`, `summaries-service.ts`, `money.json` ×3, `COMPONENT_REGISTRY.md`
  - Verify: `pnpm test`, `pnpm lint`, `pnpm typecheck`; i18n parity test
- [ ] **T4 (P1, human: ~1.5d / CC: ~45min)** — Malafat overview — linked-only rows, `/admin/money/link`, footer line (MAL-941)
  - Surfaced by: D7
  - Files: `admin/money/link/page.tsx`, `overview-summary.tsx`, `overview-rows.ts`, `money.json` ×3
  - Verify: `overview-rows.test.ts`; manual: Link all preview still works from the new route
- [ ] **T5 (P2, human: ~1.5d / CC: ~45min)** — Malafat overview — partial state, segment rules, phone rows (MAL-942)
  - Surfaced by: D10, D12, D13, Pass 2, Pass 6
  - Files: `summaries-service.ts`, `stat-strip.tsx`, `overview-summary.tsx` (`ClientRowCompact`)
  - Verify: `summaries-service.test.ts` partial case; `stat-strip.test.tsx`; manual at 375px LTR + RTL
- [ ] **T6 (P1, human: ~3d / CC: ~1.5h)** — Malafat matter view — approve dialog creates payable; receivable row + Record payment; remove agree/convert; contract 1.7.0-m8 (MAL-943)
  - Surfaced by: D5, D11
  - Files: `fee-proposal-dialogs.tsx`, `fee-proposal-card.tsx`, `matter-financial.tsx`, `proposals-service.ts`, `agreement-wizard.tsx` + page (remove prefill), `features/money/contract/**`, `money.json` ×3
  - Verify: `proposals-service.test.ts`, contract test, `pnpm test`; manual: approve → row → Record payment
- [ ] **T7 (P2, human: ~2h / CC: ~10min)** — Knowledge files — CHANGELOG, SYSTEM_OVERVIEW, DECISIONS (override of M7 decisions 2–3), COMPONENT_REGISTRY (StatStrip), TEST_PLAN in both repos
  - Surfaced by: CLAUDE.md knowledge protocol
  - Verify: files updated in the same commits

_No new tasks from Pass 4 (AI slop)._

## Completion Summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | DESIGN.md present (brand + crm-platform); UI scope: overview, link view, approve dialog |
  | Step 0               | 3/10; focus: IA-first, then all 7           |
  | Pass 1  (Info Arch)  | 3/10 → 10/10 after fixes (D2, D3, D6, D7)   |
  | Pass 2  (States)     | 6/10 → 9/10 after fixes (D10)               |
  | Pass 3  (Journey)    | 6/10 → 9/10 after fixes (D11)               |
  | Pass 4  (AI Slop)    | 9/10 → 9/10 (no issues)                     |
  | Pass 5  (Design Sys) | 8/10 → 8/10 (tokens mapped; no decisions)   |
  | Pass 6  (Responsive) | 5/10 → 9/10 after fixes (D12)               |
  | Pass 7  (Decisions)  | 1 resolved (D13), 0 deferred                |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (6 items)                           |
  | What already exists  | written                                     |
  | TODOS.md updates     | 0 items proposed (follow-ups already in handover §4) |
  | Approved Mockups     | 1 HTML wireframe generated, 1 approved (D9) |
  | Decisions made       | 12 added to plan                            |
  | Decisions deferred   | 0                                           |
  | Overall design score | 3/10 → 8/10                                 |
  +====================================================================+
```

Plan is design-complete. Run `/design-review` after implementation for visual QA.

## Approved Mockups

| Screen/Section | Mockup Path | Direction | Notes |
|---|---|---|---|
| Overview, link view, approve dialog | `/Users/basel/Work/elMokhtbr/Mutaba3a/mini-crm/.claude/designs/money-v1-m8-overview-wireframe.html` | HTML wireframe, stone palette, no cards | State switcher and RTL toggle inside the file; 375px panel is screen 1b |

## Engineering review (2026-10-10, `/plan-eng-review`)

Target: this brief (fixed). Repos: Mutaba3a `server/` at `acb1144`, Malafat `crm-platform/apps/web` at `180e5c93d`.

### Scope record
feature answers: no cuts proposed (feature list fixed by design decisions D2–D13); structure: A (Original arrangement, D14); accepted scope: new `server/src/agreements/create.ts` (`createAgreementFromPreview`), new `features/money/ui/stat-strip.tsx`, new `admin/money/link/page.tsx`, all other work as edits to existing files per §6–§7; pending remedies: none at this point.

### Scope Challenge findings
- F1 (factual correction, confidence 9/10) `server/src/repositories/prisma.ts:439-446`, `memory.ts:522-527` — the atomic "create agreement + transition proposal" already exists behind `agreements.create({ feeProposalId })`. §6 should read: the **route** field `feeProposalId` on `POST /v1/agreements` is removed; the **store** input stays and becomes the approve path's mechanism (allowed `from` → `PROPOSED`, target → `APPROVED`, patch adds `agreedAmountMinor`, `clientApprovedOn`). No decision needed; applied to §6 below.

Scope Challenge result: scope accepted as-is.

## Decision ledger

### R1: How approve's `INSTALLMENTS` schedule posts receivables
Finding: F2, P1, confidence 9/10, `server/src/agreements/posting.ts:32` (`listUnpostedDue` posts only DATE installments whose date ≤ today) and `server/src/routes/agreements.ts:158-163` (IMMEDIATE posts at create); reviewer: Claude (plan-eng-review).
Plan baseline: §6 says "installments from `schedule`" without naming trigger types; D5 approved the dialog fields; D11 approved "record a payment straight away" after approve.
Runtime evidence: a DATE installment has no receivable until its date arrives, so Owed would stay 0 and a payment recorded right after approval would be unallocated. Verified by reading the two files above.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 trigger for ONCE | unspecified | IMMEDIATE, `dueDate` = `dueOn` | IMMEDIATE, `dueDate` = `dueOn` |
| R1 trigger for INSTALLMENTS | unspecified | all IMMEDIATE, each with `dueDate` = `clampDay(addMonths(firstDueOn, k))` | first IMMEDIATE, rest DATE at their due dates |
| Owed after approve | — | full agreed amount (summary buckets by due date: `notYetDue`) | first installment only |
| D5 dialog fields, D11 landing | approved | unchanged | unchanged |
Question D15:
D15 — When a fee is approved in installments, does the client owe all of it now or one piece at a time?
Project/branch/task: Mutaba3a server, approve route (MUT-40), M8 brief §6.
ELI10: Mutaba3a only counts money as "owed" once an installment is posted as a receivable. Today future-dated installments post on their date. If approve uses that, a 3-installment fee shows nothing as owed until the first due date, and a payment recorded the same day has nothing to land on. Posting every installment at approval makes the whole fee owed immediately, with the summary already separating "overdue" from "not yet due".
Stakes if we pick wrong: either the strip under-reports what clients owe and early payments go unallocated, or the strip shows money the firm never meant to chase yet.
Recommendation: A because the owner's rule is "approval = liability to pay", and D11 needs a receivable to exist the moment the dialog closes.
Completeness: A=10/10, B=7/10
Pros / cons:
A) Post every installment at approval, due dates set per installment (recommended)
  ✅ Owed reflects the full agreed fee at once; "not yet due" carries the future installments, overdue only turns red past each due date
  ✅ Record payment works immediately against the first (or any) installment; the lazy-posting path has nothing left to do for this agreement
  ❌ Owed grows by the whole fee on approval day, which some firms may read as aggressive
B) Post the first installment now, the rest on their dates (M3 convention)
  ✅ Matches how wizard-created agreements behave today, so the two paths stay identical
  ✅ Owed grows gradually as installments fall due
  ❌ A client who pays two installments early produces an unallocated payment until the next posting; the strip under-reports the agreed debt
Net: A matches the approval-creates-the-debt model; B matches existing agreements.
Header: Posting
Options:
A) Post all at approval (recommended)
All installments IMMEDIATE with per-installment due dates; Owed = full fee from day one.
B) First now, rest on date
First installment IMMEDIATE; later ones DATE-triggered, posting when due.

State: approved
Actual answer: B) First now, rest on date (D15, 2026-10-10)
Accepted scope: approve composes installments as: ONCE → one IMMEDIATE installment with `dueDate` = `dueOn`; INSTALLMENTS → installment 1 IMMEDIATE with `dueDate` = `firstDueOn`, installments 2..n DATE-triggered at `clampDay(addMonths(monthOf(firstDueOn), k), day)` with `dueDate` equal to the trigger date, posting through the existing lazy/reconcile path. Amount split via `splitInstallments` equal shares. Owed after approve = first installment; the rest appear as they fall due. D5 dialog fields and D11 landing unchanged.
History: none

### R2: An IMMEDIATE installment left unposted by a crash between create and post
Finding: F4, P2, confidence 8/10, `server/src/routes/agreements.ts:158-163` (IMMEDIATE posting loop runs after `store.agreements.create` committed, outside any transaction) and `server/src/repositories/ports.ts:621` ("DATE installments whose trigger date ≤ today, not posted" — `listUnpostedDue` never returns IMMEDIATE ones); reviewer: Claude (plan-eng-review). Pre-existing since M3; M8 makes approve the main path that creates agreements, so the window matters more.
Plan baseline: no handling specified; the brief reuses the create block as-is through `createAgreementFromPreview` (D14).
Runtime evidence: a process crash or lost connection after line ~148 (create) and before line ~160 (postInstallment) leaves an ACTIVE agreement whose first installment has `receivableId = null` and `triggerType = IMMEDIATE`; `postDueItems` and `npm run reconcile` skip it, so the client never reads as owing. Idempotent replay of the same request returns the stored 201 without re-posting. Verified by reading the files; not reproduced.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R2 healing of unposted IMMEDIATE | none | `listUnpostedDue` also returns unposted IMMEDIATE installments on ACTIVE agreements; lazy path + reconcile post them with `postingDate` = agreement date | posting moved inside the create transaction in both stores | unchanged |
| D15 posting semantics | approved B | unchanged | unchanged | unchanged |
| Create route behaviour on the happy path | posts IMMEDIATE at once | unchanged | unchanged (now atomic) | unchanged |
Question D16:
D16 — If the server dies right after creating an agreement but before posting its first installment, who fixes it?
Project/branch/task: Mutaba3a server, `createAgreementFromPreview` (MUT-40), shared by `POST /v1/agreements` and approve.
ELI10: Creating the agreement and posting its first receivable are two separate writes. If the process dies between them, the agreement exists but the client owes nothing, and nothing ever revisits it because the daily catch-up only looks at date-triggered installments. It has been like this since M3; approve just makes it the common path.
Stakes if we pick wrong: a rare crash silently hides a fee from every figure until someone notices by hand.
Recommendation: A because it is a one-line widening of an existing query that both the lazy read path and the nightly reconcile already run, with a store-contract test to prove it.
Completeness: A=9/10, B=10/10, C=3/10
Pros / cons:
A) Let the existing catch-up also post unposted IMMEDIATE installments (recommended)
  ✅ `listUnpostedDue` gains `OR triggerType = IMMEDIATE` on ACTIVE agreements; first read of the day or the reconcile job heals the gap automatically
  ✅ Small change in memory + Prisma stores, covered by a store-contract test; no transaction restructuring
  ❌ The gap exists until the next read or reconcile, so a figure can lag by up to a day
B) Post inside the create transaction
  ✅ No window at all: agreement and first receivable commit together or not at all
  ✅ Replays and crashes can never produce a half-created agreement
  ❌ Moves `postInstallment` and its audit into both stores' create transactions; larger change to tested M3 code (human: ~1 day / CC: ~1 h)
C) Leave as is
  ✅ Zero work now
  ✅ The window is milliseconds wide in practice
  ❌ A silent, invisible failure with no healing path, on the route that now creates most agreements
Net: A heals cheaply with a short lag; B closes the window fully at more cost; C accepts a silent failure.
Header: Crash gap
Options:
A) Widen the catch-up query (recommended)
`listUnpostedDue` also returns unposted IMMEDIATE installments; lazy path and reconcile post them. Store-contract test.
B) Post inside the transaction
Create + first posting atomic in both stores. Larger change to M3 code.
C) Leave as is
No change; accept the silent window.

State: approved
Actual answer: A) Widen the catch-up query (D16, 2026-10-10)
Accepted scope: `AgreementRepository.listUnpostedDue` (ports.ts:621) also returns unposted, non-voided IMMEDIATE installments on ACTIVE agreements, in both memory and Prisma stores; `postDueItems` posts them with `postingDate` from `postingDateFor` (agreement date) and audits `installment.posted` with `trigger: 'IMMEDIATE'`; store-contract test (m8) proves an unposted IMMEDIATE installment is returned and a posted one is not; `routes-m3` create tests stay green (happy path still posts at create, so the catch-up finds nothing).
History: none

### Outside voice (native Claude subagent, Plan agent; Codex not installed → outside coverage unavailable)
Nine findings, all verified against code by the parent reviewer: OV-F1 (two fetches for one figure; D10 partial state hides a number the summary delivered), OV-F2 (summary currency set ignores proposal-only currencies, `summaries.ts:39`), OV-F3 (approve can hit `VAT_RATE_MISSING` `compose.ts:77` / `CUSTOMER_ARCHIVED`; `agreementDate` unspecified), OV-F4 (copy "₪X now owed" and AC2 wrong under D15 B), OV-F5 (D16 scope misdescribes `posting.ts:40` audit and `postingDateFor` for IMMEDIATE; MANUAL must stay excluded), OV-F6 (D15 B + D6: same-day full payment leaves an unallocated remainder visible only on the client page), OV-F7 (schedule validation: past due dates, `count` bounds, `splitInstallments` has no equal-shares mode, `interval` dead surface), OV-F8 (dev-only mapping migration wasted/incomplete; must null agreed fields), OV-F9 (archived projects keep inflating Proposed). Decisions: R3–R6 below. Corrections applied without a question (mechanics of approved contracts): OV-F4, OV-F5, OV-F6 (recorded trade-off), OV-F7, and the OV-F2 currency-set widening under MUT-41.

### R3: One call or two for the Proposed figure and the row pills (reopens D10 on new evidence)
Finding: OV-F1 + OV-F2, High, confidence 9/10, `summaries-service.ts:20` (`Promise.all([getOrganizationSummary, getMoneySync, listOpenProposalsByProject])`), `summaries.ts:39` (currency set from receivables + payments only); reviewer: outside voice, verified by Claude.
Plan baseline: D10 approved "partial page: Proposed shows '— Couldn't load · Retry' when the proposals call fails"; §6 puts `proposed` in `CurrencySummary`.
Runtime evidence: with `proposed` in the summary, the strip figure arrives with Owed/Overdue; only the pills come from the second call. D10's partial state would hide a figure the server delivered. A currency with proposals but no receivables gets no block today, so its `proposed` is unreachable.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| Where open proposals travel | second call `GET /v1/fee-proposals?open=true` | inside the summary: `CustomerSummaryRow.proposals: [{ proposalId, projectId, amount, proposedOn }]` + `CurrencySummary.proposed`, `counts.openProposals` | unchanged second call + `CurrencySummary.proposed` |
| Currency blocks | receivables + payments | + customers with PROPOSED proposals | + customers with PROPOSED proposals |
| D10 partial state | approved | retired: one call, one error state | kept, but the Proposed figure stays visible; only pills hide |
| `listOpenProposalsByProject`, `MAX_LIST_PAGES`, `proposalsError` | exist / planned | removed from the overview path (matter view keeps its own `listFeeProposals` query) | kept |
Question D17:
D17 — Should the overview read proposals from the summary call instead of a second request?
Project/branch/task: Mutaba3a `GET /v1/summaries/organization` (MUT-41) and Malafat `getMoneyOverview` (MAL-940/942).
ELI10: The strip total now comes from the summary, but the little "Proposed ₪10,000" pills under client names still come from a second request. Two requests for one fact means they can disagree, and the "couldn't load" state we designed would hide a number that actually arrived. If the summary carries each client's open proposals, there is one request, one error state, and the server owns the whole picture (ADR-150).
Stakes if we pick wrong: either a strip and pills that can drift apart plus an extra state to build and test, or a slightly larger summary payload.
Recommendation: A because it deletes work (the partial state, the page walk, `proposalsError`) and makes the strip-equals-pills promise true by construction.
Completeness: A=10/10, B=7/10
Pros / cons:
A) Proposals ride inside the summary rows; retire D10's partial state (recommended)
  ✅ `CustomerSummaryRow.proposals[]` + `CurrencySummary.proposed`; Malafat renders pills from the same payload as the strip, so they cannot disagree
  ✅ One Mutaba3a call for the overview, one error card; T5's partial-state work and `listOpenProposalsByProject` disappear from the overview path
  ❌ Summary payload grows by one small array per customer with open proposals; a contract change Malafat must follow in the same release (already true for `proposed`)
B) Keep two calls; show the figure, hide only the pills on failure
  ✅ Smaller server change: only `proposed` and the currency set
  ✅ Keeps the existing list walk untouched
  ❌ Two sources for one fact; the partial state still has to be built and explained
Net: A simplifies both repos and retires a design state; B keeps the current shape.
Header: One call
Options:
A) Proposals inside the summary (recommended)
Summary rows carry open proposals; overview makes one call; D10 partial state retired.
B) Keep the second call
Only `proposed` added to the summary; pills still from `GET /v1/fee-proposals?open=true`; partial state hides pills only.

State: approved
Actual answer: A) Proposals inside the summary (D17, 2026-10-10)
Accepted scope: `CustomerSummaryRow` gains `proposals: [{ proposalId, projectId, amount, proposedOn }]` (PROPOSED only, project currency = block currency); `CurrencySummary` gains `proposed` (sum of those amounts) and `counts.openProposals`; the summary's currency and customer sets widen to include customers with PROPOSED proposals (OV-F2). Malafat `getMoneyOverview` drops `listOpenProposalsByProject`; pills render from `row.proposals` joined to matters by `projectId` via the sync view; D10's partial state, `proposalsError` and the wireframe "Proposals failed" state are retired; the whole-page error card covers any summary failure. The matter financial view keeps its own `listFeeProposals({ projectId, open: true })` query.
History: D10 (design review) approved the partial state on the assumption that the figure and the pills shared one source; superseded by D17 on OV-F1/OV-F2 evidence.

### R4: Approve's agreement date and the VAT-rate failure path
Finding: OV-F3, Medium, confidence 9/10, `server/src/agreements/compose.ts:74-78` (`VAT_RATE_MISSING` when no rate is in force on the agreement date), `compose.ts` `loadAgreementContext` (`CUSTOMER_ARCHIVED`), `fee-proposals.ts:46-88` (create never checks a rate); reviewer: outside voice, verified by Claude.
Plan baseline: §6 "VAT treatment from `pricingBasis`, current VAT rate"; §4 approve dialog errors list only `PROPOSAL_NOT_OPEN` and validation.
Runtime evidence: the composer reads the rate in force on `agreementDate`; a firm that proposed before setting any VAT rate gets 422 at approve time with no dialog path.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| `agreementDate` for approve | unspecified | `approvedOn` (rate in force on that date) | today (rate in force today) |
| `VAT_RATE_MISSING` in the dialog | unhandled | inline error "No VAT rate is set for {date}" + link to Money › Settings; dialog stays open | same |
| `CUSTOMER_ARCHIVED` / `PROJECT_ARCHIVED` | unhandled | inline error, dialog stays open | same |
| D15 B posting | approved | unchanged | unchanged |
Question D18:
D18 — Which date is the agreement dated, and what happens when no VAT rate exists for it?
Project/branch/task: Mutaba3a approve route (MUT-40) and Malafat approve dialog (MAL-943).
ELI10: Approving builds a real agreement, and agreements carry a date that decides which VAT rate applies. The dialog has an "Approved on" field, which can be backdated. If the firm never set a VAT rate, or backdates before its first rate, the server refuses, and today the dialog would just show a generic error.
Stakes if we pick wrong: a Partner is stuck in a dialog with no way out, or an agreement is dated differently from the approval the client gave.
Recommendation: A because the agreement should be dated when the client agreed, and the error needs a door to the settings page.
Completeness: A=10/10, B=9/10
Pros / cons:
A) Agreement dated on `approvedOn`; rate errors point to settings (recommended)
  ✅ The agreement's date matches the approval the firm recorded, including backdated ones, so history reads truthfully
  ✅ `VAT_RATE_MISSING`, `CUSTOMER_ARCHIVED`, `PROJECT_ARCHIVED` render inline with the date named and a link to Money › Settings; the dialog keeps its values
  ❌ A backdated approval before the first VAT rate fails until a rate covering that date is entered
B) Agreement dated today
  ✅ Fewer failures: today's rate almost always exists once Money is set up
  ✅ Simpler rule to explain
  ❌ A fee the client approved last month is dated today, which misstates when the agreement began
Net: A is truthful and handles the error; B avoids one failure at the cost of accuracy.
Header: Agreement date
Options:
A) Date = approvedOn + settings link (recommended)
Rate in force on approvedOn; 422s shown inline with a link to Money › Settings.
B) Date = today
Rate in force today; same inline error handling.

State: approved
Actual answer: A) Date = approvedOn + settings link (D18, 2026-10-10)
Accepted scope: approve composes the agreement with `agreementDate = approvedOn` (default today), so the VAT rate in force on `approvedOn` applies; `VAT_RATE_MISSING`, `CUSTOMER_ARCHIVED` and `PROJECT_ARCHIVED` propagate as 422 with their reason; the Malafat approve dialog renders them inline (date named for the VAT case) with a link to `/admin/money/settings`, keeps its field values and stays open; i18n keys `money.reasons.VAT_RATE_MISSING` etc. reused or added; route test covers the 422 and the dialog test covers the inline rendering.
History: none

### R5: Open proposals on archived projects
Finding: OV-F9, Low, confidence 8/10, `server/src/routes/projects.ts:199-221` (archive route; no check on open proposals), `routes-m3.test.ts:369` (archive is refused while receivables are outstanding); reviewer: outside voice, verified by Claude.
Plan baseline: none; `proposed` sums every PROPOSED proposal.
Runtime evidence: archiving a project leaves its proposal PROPOSED; the new figure would count it indefinitely.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| Archive with an open proposal | allowed | refused `422 PROPOSAL_OPEN` (like outstanding receivables) | allowed; proposal auto-withdrawn with reason `PROJECT_ARCHIVED` | allowed; sum excludes archived projects |
| Proposed figure | counts all PROPOSED | exact by construction | exact by construction | filtered at read |
Question D19:
D19 — What happens to an open proposal when its matter's project is archived?
Project/branch/task: Mutaba3a `POST /v1/projects/{id}/archive` and the `proposed` total (MUT-41).
ELI10: Archiving a matter in Malafat archives its Mutaba3a project. If a fee proposal is still open on it, the Proposed figure keeps counting money nobody will chase. Mutaba3a already refuses to archive a project with unpaid receivables; the same rule can cover open proposals, or the archive can withdraw the proposal for you, or the total can just skip archived projects.
Stakes if we pick wrong: a stale number in the strip, or a surprising refusal when archiving.
Recommendation: A because it mirrors the existing receivables rule and keeps the ledger honest without hidden side effects.
Completeness: A=10/10, B=9/10, C=7/10
Pros / cons:
A) Archive refused while a proposal is open (recommended)
  ✅ Same shape as the existing "archive refused while receivables are outstanding" rule; the Partner withdraws first, deliberately
  ✅ No read-time filtering; the figure is exact by construction
  ❌ One more reason an archive can be refused; Malafat's archive flow must show it
B) Archive withdraws the proposal automatically
  ✅ Archive always succeeds; history records the withdrawal reason
  ✅ Figure exact by construction
  ❌ A side effect nobody asked for; a mis-click archive loses the negotiation record's open state
C) Exclude archived projects from the sum
  ✅ No change to archive behaviour
  ✅ Smallest change
  ❌ A PROPOSED proposal on an archived project becomes invisible yet still blocks a new proposal on that project
Net: A is explicit and consistent; B is convenient; C hides state.
Header: Archive
Options:
A) Refuse archive while open (recommended)
`422 PROPOSAL_OPEN` from the archive route; Malafat shows the reason.
B) Auto-withdraw on archive
Archive withdraws the proposal with reason PROJECT_ARCHIVED.
C) Exclude from the sum
Read-time filter only.

State: approved
Actual answer: A) Refuse archive while open (D19, 2026-10-10)
Accepted scope: `POST /v1/projects/{id}/archive` answers `422 PROPOSAL_OPEN { openProposalId }` while a PROPOSED proposal exists on the project (same shape as the outstanding-receivables refusal); routes-m8 test covers it; Malafat's matter archive flow maps the reason to an inline message ("Withdraw the open fee proposal first") with a link to the matter's Money tab. The `proposed` sum needs no archived-project filter.
History: none

### R6: How the dev databases move to the new enum
Finding: OV-F8, Low, confidence 8/10, `prisma/migrations/20261009120000_m7_fee_proposals/migration.sql:2` (`CREATE TYPE "FeeProposalStatus" AS ENUM (...)`), handover §0 (nothing deployed); reviewer: outside voice, verified by Claude.
Plan baseline: §6 "dev data migration: CLIENT_APPROVED/AGREED → PROPOSED; CONVERTED → APPROVED".
Runtime evidence: Postgres cannot drop enum values in place; a mapping migration needs a type swap and must also null `agreedAmountMinor`, `clientApprovedOn`, `agreedOn` for rows mapped back to PROPOSED (else `feeProposalAmount` shows the agreed figure on a PROPOSED pill).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| Migration shape | M7 creates the five-value enum | edit the M7 migration in place to the three-value enum; dev databases `prisma migrate reset` | new `m8` migration: type swap + row mapping + null agreed fields |
| Deployed databases affected | none | none | none |
Question D20:
D20 — Rewrite the M7 migration or add a mapping migration?
Project/branch/task: Mutaba3a `server/prisma/migrations` (MUT-40).
ELI10: Nothing is deployed, so no real database holds the old five states. We can either change the M7 migration file itself (and reset local databases), or write a second migration that converts old rows. The second is more work and only matters for throwaway dev data.
Stakes if we pick wrong: low; either a few minutes of dev-database resets, or an extra migration with its own edge cases.
Recommendation: A because no deployed data exists and a mapping migration is work to protect data nobody keeps.
Completeness: A=10/10, B=10/10
Pros / cons:
A) Edit the M7 migration; reset dev databases (recommended)
  ✅ One migration describes the table as it will ship; no dead enum values in history
  ✅ No mapping edge cases to test
  ❌ Anyone with M7 applied locally must `prisma migrate reset` (the e2e scripts recreate everything anyway)
B) Add an m8 mapping migration
  ✅ Dev databases upgrade in place
  ✅ Exercises the type-swap pattern once, in case it is needed later
  ❌ Extra migration and tests for data with no owner
Net: A is cheaper; B is safer for data that does not exist.
Header: Migration
Options:
A) Edit M7 in place (recommended)
Three-value enum in the M7 migration; dev databases reset.
B) New m8 mapping migration
Type swap, row mapping, null agreed fields.

State: approved
Actual answer: A) Edit M7 in place (D20, 2026-10-10)
Accepted scope: `prisma/migrations/20261009120000_m7_fee_proposals/migration.sql` and `schema.prisma` define `FeeProposalStatus` as `PROPOSED | APPROVED | WITHDRAWN`; columns `clientApprovedOn` → kept as `approvedOn` semantics (rename optional), `agreedOn`/`agreedNote` dropped from the M7 migration; developers reset local databases (`prisma migrate reset`); no m8 migration.
History: none

Approval readiness: PASS — R1 (D15 B), R2 (D16 A), R3 (D17 A, supersedes D10), R4 (D18 A), R5 (D19 A), R6 (D20 A); OV-F4/F5/F6/F7 and the OV-F2 currency-set widening applied as mechanics of approved contracts (D4, D15, D16, D17, MUT-41); F1 factual correction needs no approval; shared helper `createAgreementFromPreview` and new files approved under D14 A; Prisma enum migration, `currentProposal` and Malafat `CONVERTED` → `APPROVED` edits are mechanics of D5 (design review) and the contract bump; D15 regression contract = existing `routes-m3.test.ts:89-170` coverage carried forward unchanged.

## Eng review sections

### 1. Architecture (5 issues)
- [P1] (confidence 9/10) `server/src/agreements/posting.ts:32`, `routes/agreements.ts:158-163` — installment posting semantics for approve were unspecified. **D15 B:** first installment IMMEDIATE, rest DATE.
- [P2] (8/10) `routes/agreements.ts:158-163`, `repositories/ports.ts:621` — IMMEDIATE posting runs outside the create transaction and nothing heals a crash in between. **D16 A:** widen `listUnpostedDue`.
- [High] (9/10, outside voice) `summaries-service.ts:20`, `summaries.ts:39` — two calls for one figure; proposals-only currencies get no block. **D17 A:** proposals inside the summary; currency/customer sets widened; D10 retired.
- [Medium] (9/10, outside voice) `compose.ts:74-78` — approve inherits `VAT_RATE_MISSING` / archived errors; agreement date unspecified. **D18 A.**
- [Low] (8/10, outside voice) `routes/projects.ts:199-221` — archive leaves proposals open. **D19 A.**
Security: approve keeps `agreements:write` + Idempotency-Key, same as agreement create; cross-organization reads still 404 through `mustGet`. Distribution: no new artifact; server image and Malafat release as today.
Dispositions: all five accepted (D15, D16, D17, D18, D19).

```
approve(proposalId, body)
  ├─ validate body (amount>0, dates, count 2..60) ── 422 VALIDATION
  ├─ mustGet(proposal) ── 404
  ├─ status ≠ PROPOSED ── 409 PROPOSAL_NOT_OPEN
  ├─ build installments (ONCE | INSTALLMENTS: equal split, remainder first; 1=IMMEDIATE, 2..n=DATE monthly clamped)
  ├─ composePreview(agreementDate=approvedOn) ── 422 PROJECT_ARCHIVED | CUSTOMER_ARCHIVED | VAT_RATE_MISSING
  ├─ createAgreementFromPreview(..., { feeProposalId })
  │    └─ store.agreements.create  [TX: agreement + installments + proposal PROPOSED→APPROVED]  ── StateConflict → 409
  │    └─ audit fee_proposal.approved, agreement.created
  │    └─ post IMMEDIATE installments (crash here → healed by D16 on next read/reconcile)
  │    └─ postDueItems
  └─ 200 { proposal, agreement }
```

### 2. Code quality (4 issues)
- Shared code (approved D14): extract `createAgreementFromPreview` from `routes/agreements.ts:105-165`. Callers: existing create route (`agreements.ts:105`) and the new approve route (proposed). Estimate: ~55 lines removed from the route, ~70 added in `agreements/create.ts`, approve adds ~15 instead of ~60 → ~30 implementation lines saved; tests grow by one file. Blast radius: both agreement-creating routes; covered by `routes-m3` (unchanged) and `routes-m8`.
- [P2] (9/10) `proposals/transitions.ts:8-14` — header state diagram becomes stale; rewrite with the three-state table. Mechanics of D5.
- [P2] (9/10, outside voice OV-F5) `posting.ts:40` hardcodes `trigger: 'DATE'` in the audit; use `installment.triggerType`. Mechanics of D16.
- [P2] (8/10, outside voice OV-F7) schedule validation and equal-split rule were unstated; now in §6. `interval` field dropped. Mechanics of D5/D15.
- [Low] (8/10, outside voice OV-F8) migration shape. **D20 A.**
Error handling: approve dialog inline errors (D18); matter archive reason (D19); `routes-m3` regression contract carried forward.
Dispositions: D14 (prior), D20 accepted; three mechanics items applied.

### 3. Tests
Framework: vitest in both repos (`npm test` server with Postgres runners via `test:db`; `pnpm test` Malafat).

```
CODE PATHS                                                      USER FLOWS
[+] server/src/routes/fee-proposals.ts approve                  [+] Approve → owed → paid
  ├── [GAP] ONCE: one IMMEDIATE, dueDate=dueOn                    ├── [GAP] [→E2E] propose → approve (ONCE) → receivable → record payment → Up to date (extend server/scripts e2e)
  ├── [GAP] INSTALLMENTS: equal split, remainder first, month clamp├── [GAP] approve in 3 installments → Owed = first share; reconcile posts #2 on its date
  ├── [GAP] 409 from APPROVED / WITHDRAWN                          ├── [GAP] double-click approve → one agreement (idempotent)
  ├── [GAP] 422 VAT_RATE_MISSING / PROJECT_ARCHIVED / CUSTOMER_ARCHIVED   ├── [GAP] approve with no VAT rate → inline error + settings link, values kept
  ├── [GAP] idempotent replay returns stored outcome               └── [GAP] archive matter with open proposal → "Withdraw first"
  └── [GAP] audit order approved → agreement.created → installment.posted
[+] server/src/agreements/create.ts createAgreementFromPreview  [+] Overview
  └── [★★★ TESTED] via routes-m3.test.ts:89-170 (create, replay, IMMEDIATE posting) — regression contract, keep green
[+] server/src/agreements/posting.ts postDueItems               ├── [GAP] strip Proposed = Σ row pills (fixture with 2 clients, 1 unlinked-matter proposal)
  ├── [★★ TESTED] DATE installments due — store-contract-m3      ├── [GAP] proposals-only currency gets a block and a tab
  └── [GAP] unposted IMMEDIATE healed; MANUAL excluded (D16)      ├── [GAP] single currency → no segment; all-zero currency → no tab
[+] server/src/routes/summaries.ts organization                 ├── [★★ TESTED] search/status filter — overview-rows.test.ts:76-113
  ├── [GAP] proposed + counts.openProposals per currency          ├── [GAP] footer "N not linked" → /admin/money/link → link → count drops
  ├── [GAP] CustomerSummaryRow.proposals (PROPOSED only)          └── [GAP] 375px two-line rows, row tap opens client (LTR + RTL) — manual
  └── [GAP] customer with proposals only appears in the block
[+] server/src/routes/projects.ts archive
  └── [GAP] 422 PROPOSAL_OPEN while PROPOSED exists (D19)
[+] server/src/proposals/transitions.ts
  └── [GAP] three-state table; currentProposal prefers open, else latest APPROVED (rewrite transitions.test.ts)
[+] malafat summaries-service.getMoneyOverview
  ├── [★★ TESTED] rows from sync + summary — summaries-service.test.ts
  └── [GAP] pills from row.proposals; unlinked-matter proposal listed without link
[+] malafat proposals-service.approveProposal
  └── [GAP] ONCE / INSTALLMENTS payload; attemptId → Idempotency-Key; 409/422 propagate
[+] malafat ui/stat-strip.tsx
  └── [GAP] segment rules (D13 incl. proposed); Overdue red when ≠ 0
[+] malafat ui/fee-proposal-dialogs.tsx approve
  └── [GAP] fields per schedule kind; inline VAT_RATE_MISSING with link; values kept on error
[+] malafat contract test
  └── [GAP] approve body shape; agree + createAgreement(feeProposalId) calls removed; version 1.7.0-m8

COVERAGE: 4/27 paths tested (15%)  |  Code paths: 3/20  |  User flows: 1/7
QUALITY: ★★★:1 ★★:3  |  GAPS: 23 (1 E2E)
Legend: ★★★ behavior + edge + error  |  ★★ happy path  |  ★ smoke check  |  [→E2E] = needs integration test
```

Tests obsolete (retire at implementation, see Test Plan artifact): `routes-m7` approve→CLIENT_APPROVED, `/agree`, conversion via `POST /v1/agreements`; `store-contract-m7` convert cases; `transitions.test` agree rows; Malafat `proposals-service.test` agree + `getProposalForWizard`; contract test agree/`feeProposalId` lines; `overview-rows.test` unlinked-row expectation.
Regression (CRITICAL): `routes-m3.test.ts:89-170` unchanged and green after the helper extraction; `routes-m5/m6` unaffected.
Test Plan artifact: `~/.gstack/projects/vAWK3-mutaba3a/basel-main-eng-review-test-plan-20261010-130850.md` (updated after D17–D20).
Dispositions: all gaps are required proof of approved behaviour (D5, D13–D19); no new test policy was needed.

### 4. Performance (0 issues)
`GET /v1/summaries/organization` adds one keyset-paged `feeProposals.list({ status: 'PROPOSED' })` walk per call (hundreds of rows at most for a firm); it already full-scans OPEN receivables and POSTED payments the same way, so the shape is unchanged. Malafat's overview drops from three upstream calls to two (summary + sync view). No N+1 introduced; approve runs one transaction plus the existing posting loop.

### NOT in scope (eng additions)
- Making agreement create + first posting a single transaction (D16 chose healing over atomicity).
- A "paid in full today" option on the approve dialog (recorded trade-off OV-F6; revisit after pilot).
- Mapping migration for old proposal rows (D20: none deployed).

### What already exists (eng)
Store-level atomic conversion (`prisma.ts:437-446`, `memory.ts:522-527`), `composePreview`, `postingDateFor`, `installmentDueDate`, `postDueItems`, `idempotent()` middleware, `dates.ts` `addMonths`/`clampDay`/`monthOf`, `splitInstallments` (by amount), `routes-m3` regression coverage, Malafat `ApproveProposalDialog`, `Segment`, `SyncTable`, `useLinkActions`, `MoneyAmount`, i18n reason keys.

### Failure modes
| Path | Failure | Handling | User sees |
|---|---|---|---|
| approve | crash after agreement create, before posting | D16 healing on next read/reconcile; idempotent replay returns 200 | figure lags until next read; no silent loss |
| approve | no VAT rate on approvedOn | 422 VAT_RATE_MISSING | inline error + settings link (D18) |
| approve | concurrent approve/withdraw | store conditional transition → 409 | dialog shows "no longer open" |
| summary | Mutaba3a unreachable | whole-page error card + Retry | clear error |
| archive | open proposal | 422 PROPOSAL_OPEN | "Withdraw first" (D19) |
Critical gaps: 0.

### Worktree parallelization
| Step | Modules touched | Depends on |
|---|---|---|
| S1 server lifecycle + approve + listUnpostedDue + archive (MUT-40) | `server/src/{routes,agreements,proposals,repositories,schemas}`, prisma | — |
| S2 server summary proposals (MUT-41) | `server/src/routes/summaries.ts`, schemas | S1 (status enum) |
| S3 Malafat link view + linked-only rows (MAL-941) | `app/admin/money`, `features/money/ui`, i18n | — |
| S4 Malafat StatStrip + phone rows + segment (MAL-940/942 UI) | `features/money/ui`, `app/admin/money` | S3 (same file `overview-summary.tsx`) |
| S5 Malafat contract bump + approve dialog + summary wiring (MAL-943, MAL-940 data) | `features/money/{contract,application,ui}` | S1, S2, S4 |
Lanes: **A:** S1 → S2 (server). **B:** S3 → S4 (Malafat UI, contract-independent). Launch A + B; merge both; then S5. Conflict flag: `overview-summary.tsx` is touched by S3, S4 and S5, so B stays sequential and S5 waits.

## Implementation Tasks (eng review)
Synthesized from the findings above; supersedes the design-review task list where they overlap.

- [ ] **T1 (P1, human: ~3d / CC: ~2h)** — server — MUT-40: three-state lifecycle, approve route composing the agreement (D15 B, D18), `createAgreementFromPreview` extraction (D14), `listUnpostedDue` widening + audit trigger fix (D16, OV-F5), archive refusal (D19), M7 migration edited (D20), transitions diagram, OpenAPI 1.7.0-m8
  - Surfaced by: Architecture 1–2, 4–5; Code quality 1–3, 5
  - Files: `server/src/routes/fee-proposals.ts`, `routes/agreements.ts`, `routes/projects.ts`, `agreements/create.ts` (new), `agreements/posting.ts`, `proposals/transitions.ts`, `repositories/{ports,prisma,memory}.ts`, `schemas.ts`, `serializers.ts`, `prisma/schema.prisma`, `prisma/migrations/20261009120000_m7_fee_proposals/migration.sql`, `app.ts`, `openapi/openapi.yaml`
  - Verify: `npm run typecheck && npm test && npm run test:db && npm run openapi:check`; `routes-m3.test.ts` unchanged
- [ ] **T2 (P1, human: ~1d / CC: ~40min)** — server — MUT-41: `CustomerSummaryRow.proposals`, `CurrencySummary.proposed`, `counts.openProposals`, widened currency/customer sets (D17, OV-F2)
  - Surfaced by: Architecture 3
  - Files: `server/src/routes/summaries.ts`, `schemas.ts`, `__tests__/routes-m8.test.ts`
  - Verify: `npm test`; e2e script asserts `proposed` and a proposals-only currency block
- [ ] **T3 (P1, human: ~2d / CC: ~1h)** — server tests — `routes-m8.test.ts`, `store-contract-m8.ts`, rewritten `transitions.test.ts`; retire the m7 cases listed in the Test Plan
  - Surfaced by: Test review gaps (server rows)
  - Verify: `npm test && npm run test:db`
- [ ] **T4 (P1, human: ~1.5d / CC: ~45min)** — Malafat — MAL-941: `/admin/money/link`, linked-only rows, footer line
  - Surfaced by: design D7; Test review (footer flow)
  - Files: `app/(authenticated)/admin/money/link/page.tsx`, `_components/overview-summary.tsx`, `features/money/ui/overview-rows.ts`, `money.json` ×3
  - Verify: `pnpm test`; manual Link all from the new route
- [ ] **T5 (P1, human: ~2d / CC: ~1h)** — Malafat — MAL-940 + MAL-942 UI: `StatStrip` (registered), Unallocated removed, segment rules incl. proposed (D13), phone two-line rows (D12)
  - Surfaced by: design D3/D6/D12/D13; Test review (strip rows)
  - Files: `features/money/ui/stat-strip.tsx` (new), `overview-summary.tsx`, `money.json` ×3, `.claude/COMPONENT_REGISTRY.md`
  - Verify: `stat-strip.test.tsx`; manual 375px LTR + RTL
- [ ] **T6 (P1, human: ~3d / CC: ~1.5h)** — Malafat — MAL-943 + MAL-940 data: contract 1.7.0-m8, `approveProposal` (ONCE/INSTALLMENTS), approve dialog with inline D18 errors + settings link, receivable row + Record payment + toast copy (D15 B), `summary.proposal.status === "APPROVED"`, pills from `row.proposals`, archive `PROPOSAL_OPEN` reason, remove agree/convert/prefill
  - Surfaced by: Architecture 3–5; Code quality error handling
  - Files: `features/money/contract/**`, `domain/types.ts`, `application/{mutaba3a-client,proposals-service,summaries-service}.ts`, `ui/{fee-proposal-dialogs,fee-proposal-card,matter-financial,agreement-wizard}.tsx`, matter archive flow, `money.json` ×3
  - Verify: contract test, `proposals-service.test.ts`, dialog test, `pnpm lint && pnpm typecheck && pnpm test`
- [ ] **T7 (P2, human: ~1d / CC: ~30min)** — e2e — extend `server/scripts` e2e run with propose → approve (ONCE and 3 installments) → payment → reconcile posts installment 2; assert summary `proposed`
  - Surfaced by: Test review [→E2E]
  - Verify: run against a disposable Postgres per `server/README.md` "Verify"
- [ ] **T8 (P2, human: ~2h / CC: ~10min)** — knowledge files — CHANGELOG, SYSTEM_OVERVIEW, DECISIONS (override of M7 d2/d3 + D15–D20), COMPONENT_REGISTRY (StatStrip), TEST_PLAN, handover §4 in both repos; MAL-939 epic comment
  - Surfaced by: CLAUDE.md protocol
  - Verify: files updated in the same commits

_No new tasks from Performance review._

### Unresolved decisions
None in this review.

### Suppressed findings (appendix)
- (confidence 4/10) `listAll` full scans in `summaries.ts:36-37` could grow slow for firms with thousands of open receivables; pre-existing, no scale data. Not promoted.

### Completion summary (eng review)
- Step 0: Scope Challenge — scope accepted as-is (structure: original arrangement, D14)
- Architecture Review: 5 issues found (all decided: D15–D19)
- Code Quality Review: 4 issues found (D14 prior, D20; 3 mechanics applied)
- Test Review: diagram produced, 23 gaps identified (1 E2E), all mapped to tasks
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed (Mutaba3a TODOS.md: no pending items; nothing deferred needs a TODO beyond the recorded OV-F6 trade-off in §8)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: Codex not installed; native Claude Plan subagent completed (9 findings, all resolved: D17–D20 + mechanics); outside coverage unavailable
- Parallelization: 2 lanes (A server S1→S2, B Malafat UI S3→S4), then S5 sequential
- Lake Score: 5/7 = answers picking a 10/10 option (D14 n/a kind; D15 chose 7/10; D16 9/10; D17, D18, D19, D20 chose 10/10) / answers scored for Completeness

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | native Claude Plan subagent via `/plan-eng-review` (Codex not installed) | Independent 2nd opinion | 1 | issues_found (source in-host; outside_status unavailable) | 9 findings, all resolved |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open (all mapped to tasks) | 9 issues + 23 test gaps, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 (logged under the Malafat project) | clean | score: 3/10 → 8/10, 12 decisions (D10 since superseded by D17) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

**OUTSIDE COVERAGE:** Codex unavailable (not installed); native in-host Plan subagent completed the plan-review phase with 9 findings (OV-F1–F9), resolved through D17–D20 and recorded mechanics. No external-model coverage.

**VERDICT:** DESIGN + ENG CLEARED — ready to implement in the order MUT-40 → MUT-41 → MAL-943 → MAL-940 → MAL-941 → MAL-942 (lanes in "Worktree parallelization"). Eng status is "issues_open" only because findings map to tasks T1–T8; none are unresolved.

NO UNRESOLVED DECISIONS
