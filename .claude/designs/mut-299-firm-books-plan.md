# MUT-299 plan — Design brief + ADR: firm profiles (roles, reading on the portal, payables, close)

Epic MUT-298 · labels firm-v1 · blocks MUT-300..314 · no blockers · Backlog.
Output of this ticket: **documents only**. No production code.
Intake decisions D1–D9: `.claude/designs/firm-books-intake-drafts.md` (Basel, 2026-10-19).

## 0. What the code already gives us (findings)

_Filled from the code survey; file:line references in §0.1._

- **"Firm" already exists as a word.** An operator-provisioned organization (`ownerUserId` null, `personalOwnerUserId` null) is what `/v1/me` calls a firm and lists first. ADR-037's MUT-182 amendment says "BUSINESS is not a firm, a tenant or a shared organization", and an owned profile is "never granted to or provisioned into another user" (`ownedProfileConflict`).
- **Membership is two keys and a timestamp.** No role, no status (`schema.prisma` `Membership`).
- **One writability table, one drift test.** `WRITABILITY_MATRIX` (`server/src/auth/writability.ts`) mirrors `hosted-portal.md` §5 between `writability-matrix` markers; MUT-39's drift test fails if either side changes alone. The session column is the same for every member of an organization.
- **Expenses are session-only and USER-written on every hosted profile**, a Malafat-fed one included (API key: none). `Expense.createdByUserId` already exists, so the submitter "own rows" rule has its column.
- **Receivables are the payables template.** `Receivable` / `Payment` / `PaymentAllocation` / `ReceivableCredit` / `PaymentCounter`; allocation strategies live in `server/src/payments/allocate.ts`; payments reverse, never edit.
- **VAT math exists for receivables** (`server/src/vat.ts`, `VatTreatment`, `vatRateBasisPoints`, net/vat/gross).
- **Setup links exist (MUT-235, ADR-088)** with purposes `SETUP | RESET`. No outbound email anywhere; the operator copies the link.
- **Local mode (ADR-097) runs the same route modules in the browser** over `MemoryLedgerStore`, with a persisted snapshot that has a format version, migrations and a CI shape fingerprint. Any new column the firm work adds must be mirrored there and bump the snapshot format.
- **Portal dictionaries are `ar.json` and `en.json` only.** Hebrew is a reading language (receipts), not a UI language.
- **JoFotara's QR layout is not publicly specified** in anything found so far; one integrator says it carries the clearance reference. ZATCA phase-1 TLV (seller, VAT no., timestamp, total, VAT) is well known.

### 0.1 Code references (survey 2026-10-19, main; paths under `server/src/`)

- **Session auth:** `authenticate()` `auth/middleware.ts:143` → `finishSessionAuth` `:191` → `selectProfile` `:315` (needs `X-Mutaba3a-Profile`, resolves the membership at `:325-329`, sets `writerOfRecord` + `sessionScopesFor` at `:321-322`, installs `principalStoreGuard` at `:200`). Refusals: `requireScope` `:371-378`, `keyOnlyRefusal` `:337-345`, store guard `storeRefusal` `auth/store-guard.ts:243-251` over `STORE_ACCESS` `:37`. Profile-dependent rows: `PROFILE_DEPENDENT_DOMAINS` `writability.ts:102`.
- **`/v1/me`:** `routes/sessions.ts:110-123`, `buildMe` `:234-253` (inlines the Malafat check at `:239-240`), `hostedProfileFor` `serializers.ts:68-90`, `access` built at `:77`. Role and firm flag publish here.
- **Drift test:** `__tests__/writability-drift.test.ts` reads `hosted-portal.md` markers, asserts columns, row order and every cell.
- **Membership:** Prisma `schema.prisma:326-336`, `MembershipRecord` `repositories/ports.ts:1189-1193`, `MembershipRepository` `:1238-1248` (`grant`, `revoke`, `find`, `listByUser`, `listByOrganization`); Prisma `repositories/prisma.ts:379-401`, memory `repositories/memory.ts:506-521`.
- **Operator surface:** `routes/admin.ts` (organizations create/get, keys, audit; **no PATCH organization**), `routes/admin-users.ts` (users, memberships grant `:264` / revoke `:297`, setup link `:327`, disable/enable, sessions revoke). Setup link built by `newSetupLink` `:93-98`, returned in JSON and printed by `scripts/users.ts:56` for the operator to deliver by hand. **No mail library anywhere** (searched twice).
- **Expense reads:** shared filter `expenseWhere` `prisma.ts:1634-1645` (+ `expenseGroupWhere` `:1651`), memory mirror `matchesExpense` `memory.ts:1808`. Not covered by it: `getById` `prisma.ts:1240`, entries feed `prisma.ts:1450-1452` / `memory.ts:1630`, category count `:1562` and raw SQL `:1580`.
- **Readers that produce expense totals:** `GET /v1/summaries/expenses` (`routes/expenses.ts:341`, pages `expenses.list` → `summarizeExpenses` `expenses/summary.ts:24`); group totals `totalsByCurrency` via `totalsOf` (`routes/expense-groups.ts:63`) and excluded totals `:141`; group summary `summarizeGroup` (`expense-groups.ts:255-266`, `expenses/summary.ts:75`). The entries feed lists expenses but doesn't total them. No client-side summing in `src/hosted`.
- **Date floor (ADR-086):** stateless `assertNotTooOld` `agreements/compose.ts:158,168-170`, called from `expenses/compose.ts:35` (PATCH only when the date changes, `:116`), `routes/expenses.ts:150`, `expenses/groups.ts:102`, `income/compose.ts:131`, `inbox/compose.ts:38`, `routes/inbox.ts:212`, `routes/payments.ts:227`. No closed-period concept exists.
- **VAT:** `vat.ts` — `computeVat` `:45-59`, `roundHalfUpDiv` `:39`, `VAT_TREATMENTS`, `BP_SCALE`, `assertRateBasisPoints`. Captured Owed is always `OUT_OF_SCOPE` (`income/compose.ts:106-107`).
- **Audit:** `store.audit.append` (`ports.ts:109-118`); `AuditActorType` `API_KEY | ADMIN | SYSTEM | USER`; expenses record the acting user (`routes/expenses.ts:62-64`); helpers `actorOf` `middleware.ts:437`.
- **Receipts:** `routes/expenses.ts:235-329`; `ExpenseReceipt.expenseId` still required (`schema.prisma:1030`, `ports.ts:1752,1767`) until MUT-255.
- **Local mode is not on main.** It lives on `feature/mut-284-local-mode` (worktree `.claude/worktrees/mut-284-local-mode`): `LocalSnapshotMaps` / `snapshot()` / `restore()` in `repositories/memory.ts`, session seeding `src/hosted/local/mintLocalSession.ts:50-80`, fingerprint test `src/hosted/local/__tests__/format-fingerprint.test.ts` pins Organization, Customer and Receivable only — **Membership is not fingerprinted**.

## 1. Decisions the brief proposes (each needs Basel's approval)

These are the open questions the intake did not settle. The brief recommends one answer each; the alternatives go in its "Rejected options".

| # | Question | Recommendation | Why |
|---|---|---|---|
| B1 | What does the firm switch attach to? | **Firm = an operator-provisioned organization with firm features on.** An owner's request on an *owned* Business profile is fulfilled by the operator **converting** it: ownership moves from the `ownerUserId` column to an OWNER membership role, the profile stops counting toward the cap of 6, and from then on it follows firm rules (shareable; still never keyed unless the operator binds Malafat). | Keeps MUT-182's invariant "owned = standalone, never shared" true by construction instead of punching a hole in `ownedProfileConflict`. One kind of shared organization, not two. |
| B2 | Shape of the flag and the request | `Organization.firmEnabledAt DateTime?` + `firmRequestedAt` / `firmRequestedByUserId`. Admin gains the first organization PATCH (`PATCH /admin/v1/organizations/{id}` with `firmEnabled`), `GET /admin/v1/firm-requests`, and `POST /admin/v1/organizations/{id}/convert-to-firm` (B1). All write `ADMIN` audit events. Published per profile on `/v1/me` via `hostedProfileFor` (`firm: boolean`, `role`). | A column like `ownerUserId`; no new table for one bit and one pending request. |
| B3 | Where do roles live and how are they enforced? | `Membership.role` enum `OWNER | BOOKKEEPER | SUBMITTER`, default `OWNER` (every existing membership keeps today's behaviour). A **second table, the firm role matrix**, in the brief between its own markers, mirrored by a `const` and its own drift test; it applies only when `firmEnabledAt` is set. Row-level rule (submitter edits own unapproved rows) is one helper keyed on `createdByUserId`, not a matrix cell. | Leaves the MUT-39 matrix and its test untouched; role checks compose after it. |
| B4 | Approval state | `Expense.approval` enum `APPROVED | PENDING | REJECTED` (default APPROVED) + `decidedByUserId`, `decidedAt`, `rejectionReason`. A new `approval` option on the shared filter (`expenseWhere` / `matchesExpense`); **every total passes `APPROVED`**: summaries/expenses, group `totalsByCurrency` + excluded totals, group summary. Lists default to all states (bookkeepers see Pending; a submitter sees own rows). The entries feed shows the state, never hides it. A contract test lists the three total paths and fails if a new `totalsByCurrency`-style reader skips the option. | `expenseWhere` also feeds the list, so excluding Pending inside it would hide work from bookkeepers; the option keeps one filter and makes the total paths explicit. |
| B5 | Bills: how do they meet spending totals? | **A bill is a commitment; a bill payment posts a linked expense** (`Expense.billPaymentId`, category and VAT share copied from the bill). Reversing the payment soft-deletes that expense. The bill itself never counts as spend. Staff-reimbursement bills (`kind: STAFF`) post **no** expense on payment, because the out-of-pocket expense already counted when it was approved. | Every existing expense reader (summaries, groups, entries, CSV) sees bill spend with zero changes; double counting is impossible by construction. |
| B6 | Month lock shape | `Organization.closedThroughMonth` (`YYYY-MM`), a single watermark. Closing advances it; reopening lowers it (owner, reason, audited). A new `assertOpenPeriod(org, date)` sits **next to** `assertNotTooOld` at the firm-owned call sites only: `expenses/compose.ts:35`, `routes/expenses.ts:150`, `expenses/groups.ts:102`, `routes/inbox.ts:212` (filing as an expense), plus the new bill, bill-payment and receipt-approve paths. A PATCH that moves a row *out of* a closed month is refused too (check old and new date). Delete of a row dated in a closed month is refused. Income/payments call sites are not locked (Malafat and capture own them; MUT-312 scope). | The ADR-086 floor is stateless, so the mechanism can't be reused, but its call sites are exactly the write seams; one watermark is one comparison and no per-month rows. |
| B7 | Invites and email | Add setup-link purpose `INVITE`; the invite route returns the link (always copyable). Email delivery: **recommend Amazon SES (eu-central-1 or eu-west-1)** behind a `Mailer` port with a no-op adapter when unconfigured; cost at small-firm volume is cents per month. Alternatives Postmark (~$15/mo for 10k) and Resend (~$20/mo for 50k). Prices to re-check on the vendors' pages when the brief is written. | Keeps v3 shippable without email; EU region matches the Sentry-EU data stance. |
| B8 | Shared receipt-reading contract | One `ReceiptSuggestion` shape (field, value, confidence, source: `qr | pdf-text | ocr | vendor`) used by phone (MUT-256), portal PDF/QR (MUT-301) and portal OCR (MUT-304), stored by MUT-255. Extraction rules stay in Dart on the phone and are **ported** to TypeScript for the portal, both run against one shared JSON fixture set (golden tests on both sides). | Two runtimes, one truth: the fixtures. |
| B9 | VAT on expenses | Mirror the receivable columns, all nullable; null = "No VAT recorded". Rounding via `vat.ts`. Bills carry the same columns. | No guessed splits on old rows. |
| B10 | Compliance guard | A test over `ar.json`/`en.json` firm keys rejecting "compliant", "certified", "approved by", "return", "filing" and Arabic equivalents. | D5 enforced by CI, not memory. |
| B11 | Local mode | Firm features are **never** available signed out: local organizations never get `firmEnabledAt`; role defaults to OWNER. MUT-284 is not on main yet, so the rule is "whichever lands second carries the snapshot migration": each child that adds an Organization, Membership, Expense or new-table field adds a snapshot migration + fingerprint update once local mode is on main. MUT-305 also adds a **Membership** fingerprint (missing today). | Keeps "one app" honest without shipping firm UI to local users, and closes the unfingerprinted Membership gap before a role column slips through. |
| B12 | Malafat | Malafat-connected organizations may be firms. API keys get `none` on vendors, receipts, bills and close (as on expenses today). | D1. |

## 2. Brief outline (`.claude/designs/firm-books.md`)

1. Problem, audience, acceptance criteria (MUT-298 outcome; the 9 intake decisions)
2. What exists (§0 of this plan, with references)
3. Firm model: flag, request, conversion of an owned profile (B1, B2)
4. Roles: the firm role matrix (markers + drift test), own-row rule, `/v1/me` publication (B3)
5. Approval (B4) and the list of every total it touches
6. Vendors, receipts and the `ReceiptSuggestion` contract (B8); portal reading pipeline (pdf.js, QR decode, WASM OCR in a worker, lazy chunks, size budgets)
7. VAT on expenses and bills (B9)
8. Payables: Bill, BillPayment, BillAllocation, numbering, aging, staff reimbursements, the posted-expense rule (B5)
9. Month close (B6)
10. Invites, members, email (B7)
11. Data model summary: every new column/table, migration order, indexes, memory-store + snapshot changes (B11)
12. API contracts per child (routes, request/response, error codes, idempotency, If-Match), OpenAPI version plan
13. Security: role escalation, invite abuse, rate limits, audit, cross-org isolation
14. i18n/RTL (ar/en UI; ar/he/en reading), compliance copy guard (B10)
15. QA scenarios per version (release-QA `portal` + Flutter flows), feature ids
16. Test strategy per child (unit, memory store, `test:db`, Playwright, Flutter)
17. Cost: email, OCR model delivery (CDN bytes), storage for receipts
18. Rejected options
19. Order of build and what each child inherits from the brief
20. Records updated with this ticket

Plus `.claude/designs/firm-books-tests.md` (test plan per child, CLAUDE.md Phase 2).

## 3. Research to finish while writing the brief (timeboxed)

- **JoFotara QR payload** — official ISTD/JoFotara documentation. If it carries only a clearance reference, MUT-301 reads ZATCA QR + PDF text only and JoFotara receipts fall back to PDF text/OCR. Record the finding either way.
- **Email pricing** — confirm SES / Postmark / Resend EU-region prices on their own pages.
- **pdf.js + QR decoder bundle sizes** (lazy chunk budget for MUT-301).
- MUT-253 is not finished, so the WASM OCR section states a contract and budget, not an engine.

## 4. Files this ticket writes

- `.claude/designs/mut-299-firm-books-plan.md` (this file, plus the eng review)
- `.claude/designs/firm-books.md` (the brief) and `.claude/designs/firm-books-tests.md`
- `.claude/DECISIONS.md`: **ADR-099** (number re-checked at merge) with override-log rows:
  - minimize-to-core decision 3 → firm profiles only
  - MUT-252 decision 5 → portal reads on the device for firms
  - ADR-037 decision 1 "no invite route" → owner invites into a firm (MUT-306)
  - ADR-037 MUT-182 amendment → an owned profile can be converted to a firm by an operator (B1)
- `.claude/CHANGELOG.md`, `.claude/SYSTEM_OVERVIEW.md` (planned firm capability), `.claude/TEST_PLAN.md` (pointer)
- Jira: a comment per child carrying the contract it inherits; add the missing link **MUT-254 blocks MUT-308** (bills need the vendor table).

## 5. Acceptance criteria → proof

| AC on MUT-299 | Proof |
|---|---|
| Brief covers every story with API contracts and error states | §12 of the brief has a subsection per MUT-300..314 |
| ADR logs the overrides of minimize-to-core decision 3 and MUT-252 decision 5 | ADR-099 + override-log rows |
| Role writability rows written down, drift-test ready | Firm role matrix between markers in §4 of the brief |
| Email-provider decision recorded with cost | §10 + §17 |
| Basel approves the brief | Owner approval recorded on MUT-299 |

## Business / product impact

- Small firms are the paying audience; this brief is the gate that keeps 15 tickets from each inventing their own roles, totals and lock rules.
- Unblocks all of MUT-298 (v1 starts with MUT-300 and MUT-301 the moment it is approved).
- Getting B1, B4 and B5 right now is what prevents the two expensive failures: a role leak between firm members, and money counted twice.

---

# Eng review (plan-eng-review, 2026-10-19)

Target: `.claude/designs/mut-299-firm-books-plan.md` (this file), MUT-299. Reviewer: Claude (native), gstack v1.91.143.0.
Binding decisions in force: intake D1–D9 (`firm-books-intake-drafts.md`, Basel 2026-10-19) and the MUT-300..315 ticket texts, "Approved as drafted" by Basel 2026-10-19.

## Scope Challenge

**What already solves each sub-problem.** Writability matrix + drift test (`server/src/auth/writability.ts:40-57`, `server/src/__tests__/writability-drift.test.ts`); store guard typed over `LedgerStore`, so a new repository method does not compile until classified (`server/src/auth/store-guard.ts:29-37`); receivables/payments/allocations as the payables template (`server/src/payments/allocate.ts:11`); `computeVat`/`roundHalfUpDiv` (`server/src/vat.ts:39,45-59`); setup links (`routes/admin-users.ts:93-98`); org row lock (`repositories/prisma.ts:1534`, `FOR NO KEY UPDATE`); shared expense filter (`prisma.ts:1634-1645`, memory `memory.ts:1808`).

**Minimum change.** This ticket writes documents only. Deferrable inside it: the TypeScript port vs. shared-rules choice for receipt extraction (B8) waits for MUT-253's engine; the JoFotara QR layout is a bounded research item.

**Complexity.** Proposed changed files: plan, brief, brief tests doc, DECISIONS.md, CHANGELOG.md, SYSTEM_OVERVIEW.md, TEST_PLAN.md = 7 files, 0 new classes/services [measured: §4 of this plan]. Under the gate (8 files / 2 classes): complexity selectors skipped.

**Search check.** Period close: vendors split between "reopen to correct" (QuickBooks closing date, Aplos) and "post an adjustment in the current open period" (Odoo); it is a policy choice, not a standard [Layer 1]. Invites: common practice is identical responses whether or not the email has an account and a pending membership the invitee must accept as that email [Layer 1, general knowledge; search returned no authoritative page].

**TODOS cross-reference.** `TODOS.md` items 4–5 are unrelated; nothing blocks this plan.

**Distribution.** No new artifact.

### Reality rows

| Premise | Claim | Receipt | Verdict |
|---|---|---|---|
| P1 | Membership has only userId, organizationId, createdAt | `server/prisma/schema.prisma:326-336` | true |
| P2 | Session scopes depend on writer of record only | `server/src/auth/writability.ts:111` `sessionScopesFor(profileWriter)`; `middleware.ts:322` | true |
| P3 | Store guard knows principal + writer, not role | `server/src/auth/store-guard.ts` `principalStoreGuard(principal, profileWriter)` | true |
| P4 | Expense amounts must be positive | `server/src/expenses/compose.ts:20` `if (minor <= 0n) throw validationError('AMOUNT_INVALID'…` | true |
| P5 | Owned ⇔ profileType set (CHECK) | migration `20261014120000_mut182_owned_profiles/migration.sql:45` | true |
| P6 | No outbound email | survey: no mail lib in `package.json`, `server/package.json`, `server/src` (searched twice) | true |
| P7 | Admin create-user refuses a taken email | `server/src/routes/admin-users.ts:187` | true |
| P8 | `/v1/me` lives in `routes/sessions.ts` | true on main; on `feature/mut-284-local-mode` it moves to `routes/me.ts` (commit 08db750d) | true on main, moving |
| P9 | Local mode not on main | `git merge-base --is-ancestor 282613ef main` → not on main | true |
| P10 | JoFotara QR carries amounts | no official source found | unverified |

unverified=1

REALITY: premise-table finding 10 premises, unverified=1 (JoFotara QR payload) plan §3
REALITY: already-done pass nothing for MUT-298..315 on main or any branch (`git log --all --grep`) .claude/designs/mut-299-firm-books-plan.md:1
REALITY: surface-check finding admin has no organization PATCH; B2 adds it, correctly flagged; `/v1/me` moves to routes/me.ts on the MUT-284 branch server/src/routes/admin.ts:64
REALITY: binding-decisions finding MUT-312's approved "corrections are reversing entries" collides with positive-only expenses (R2) server/src/expenses/compose.ts:20
REALITY: numbers pass every number is a target or estimate, tagged; SES/Postmark/Resend prices [estimated, re-check on vendor pages] plan §1 B7
REALITY: deferred-asks pass MUT-299 ACs all mapped in §5; nothing left out plan §5
REALITY: pr-count pass one PR (docs only), no ship-policy override .gstack/ship-policy.json (absent)

**Scope Challenge findings**
1. [P2] (confidence: 9/10) plan §0.1 — `/v1/me` and route registration move on the unmerged MUT-284 branch (`routes/me.ts`, `PORTAL_ROUTES`). Factual correction: the brief names both locations and says firm children that touch `/v1/me` rebase after MUT-286 lands. No behaviour change, no question.

Scope Challenge result: scope accepted as-is.

## Section 1 — Architecture

1. [P1] (confidence: 9/10) `server/src/auth/writability.ts:111` `export function sessionScopesFor(profileWriter: ProfileWriter)` and `store-guard.ts` `principalStoreGuard(principal, profileWriter)` — B3 adds a role matrix but doesn't say which layer enforces it. If roles live in a separate middleware, the store guard (layer 3) and `/v1/me` `access` keep granting what the scope set grants, so a route that reaches a repository method directly is not role-checked and the portal shows buttons the server refuses. → R1.
2. [P1] (confidence: 9/10) `server/src/expenses/compose.ts:20` `if (minor <= 0n) throw validationError('AMOUNT_INVALID', …)` vs MUT-312's approved text "corrections are new or reversing entries dated in an open month" and B5 "reversing the payment soft-deletes that expense". An expense in a closed month can't be reversed (no negative amounts, no reversal concept), and reversing a bill payment would delete an expense inside a closed month. → R2.
3. [P1] (confidence: 8/10) `server/src/routes/admin-users.ts:187` email is unique per account; setup-link purposes are `SETUP | RESET` (`schema.prisma` `SetupLinkPurpose`). D6 doesn't say what an invite to an email that already has an account does. Minting a setup link there is a password reset any firm owner could trigger (account takeover); answering differently leaks which emails have accounts. → R3.
4. [P2] (confidence: 8/10) plan B3 "default `OWNER` (every existing membership keeps today's behaviour)" — correct while the firm flag is off, but the moment an operator turns firm features on for a multi-member organization (e.g. a Malafat firm), every member becomes an owner who can invite, remove and change roles. → R4.
5. [P2] (confidence: 7/10) plan B6 — closing a month and a write dated in that month can interleave: the write checks `closedThroughMonth` (open), the close commits, the write commits into a now-closed month. `lockOrganization` exists (`repositories/prisma.ts:1534`, `FOR NO KEY UPDATE`) but expense writes don't take it. → R5.
6. [P2] (confidence: 9/10) migration `…mut182_owned_profiles/migration.sql:45` `CHECK (("ownerUserId" IS NULL) = ("profileType" IS NULL))` — B1's conversion must clear `profileType` together with `ownerUserId`, and `:51` makes the built-in personal profile unconvertible. Necessary implementation of B1 as written (type only picks the expense preset at creation, ADR-037 MUT-182 amendment); the brief states both rules. No separate choice.

## Section 2 — Code quality

1. [P1] (confidence: 9/10) `server/src/routes/expenses.ts:138` (POST), `server/src/routes/inbox.ts:212` (file as expense), MUT-255 receipt approve, B5 bill-payment posting — four paths create expenses. Intake D7 (approved) says a submitter's expense is Pending and out of every total when approval is on; that only holds if all four take their initial state from one function (`initialApprovalFor(role, firm)`), otherwise a submitter files from the inbox and skips approval. Necessary implementation of D7: carried into the brief, no question.
2. [P2] (confidence: 8/10) survey: `expenseWhere` doesn't cover `getById` (`prisma.ts:1240`), the entries feed (`prisma.ts:1450-1452`), the category count (`:1562`) and raw SQL (`:1580`). B4 already makes totals opt into `approval: APPROVED`; the brief must also say the category count and raw SQL path are counts of rows, not money, and stay unfiltered, so nobody "fixes" them later. Necessary clarification of D7: no question.

## Section 3 — Tests

The deliverable is a brief, so this section reviews the test strategy the brief must hand to MUT-300..314 (CLAUDE.md Phase 2: `firm-books-tests.md`).

```
CODE PATHS (proposed)                                   USER FLOWS (proposed)
[+] auth: role → scopes → store guard → /v1/me          [+] Owner invites, teammate joins
  ├── [GAP] role × firm route refusal table              ├── [GAP] [→E2E] invite new email → setup link → sign in
  ├── [GAP] firm flag off ⇒ roles inert                  ├── [GAP] [→E2E] invite existing account (R3 outcome)
  └── [GAP] role matrix drift (brief markers ↔ const)     └── [GAP] remove member ends their sessions
[+] expenses: initialApprovalFor + approval filter      [+] Submitter → bookkeeper approval
  ├── [GAP] 4 creation paths × approval on/off           ├── [GAP] [→E2E] pending hidden from totals, shown in list
  └── [GAP] 3 total paths pass APPROVED (contract)       └── [GAP] reject with reason visible to submitter
[+] bills: post payment ⇒ expense; staff ⇒ none         [+] Bill from a receipt, paid in two parts
  ├── [GAP] no double count (bill + payment + expense)   └── [GAP] [→E2E] partial → settled; reversal reopens
  └── [GAP] reversal in closed month (R2 outcome)
[+] close: assertOpenPeriod at every firm write         [+] Close a month, try to edit it
  ├── [GAP] old date AND new date checked on PATCH       ├── [GAP] [→E2E] refused with month named
  └── [GAP] concurrent close vs write (R5 outcome)       └── [GAP] phone outbox shows refused write
[+] i18n: compliance copy guard (B10)
  └── [GAP] banned words in ar/en firm keys
[+] local mode: Membership fingerprint (B11)
  └── [GAP] role column changes snapshot shape

COVERAGE: 0/22 proposed paths tested (all future code) | GAPS: 22 (6 E2E)
```

Required proof carried into `firm-books-tests.md` (each is necessary proof of an approved or pending behavior, not a new policy):
- Role refusal table: one table-driven server test, every firm route × OWNER/BOOKKEEPER/SUBMITTER × firm on/off. Value: protects=role enforcement on every firm write; fails_when=a new firm route skips the role check; why_new=writability tests cover writer-of-record only; seam=none; no_claim=portal hiding buttons.
- Role matrix drift test, same shape as `writability-drift.test.ts`. Value: protects=brief and code agree; fails_when=either side changes alone; why_new=no role table exists; seam=none; no_claim=behaviour.
- Totals contract test listing the three total paths. Value: protects=Pending never counted; fails_when=a new total reader skips the approval option; why_new=no approval state exists; seam=none; no_claim=UI rendering.
- `initialApprovalFor` across the four creation paths. Value: protects=D7 on every path; fails_when=inbox or receipt approve sets APPROVED for a submitter; why_new=new rule; seam=none; no_claim=none beyond protects.
- No-double-count test (bill + payment + posted expense = one spend). Value: protects=summaries; fails_when=a bill itself starts counting; why_new=new model; seam=none; no_claim=FX conversion.
- Memory store + `test:db` parity for every new filter (the MUT-267 pattern). Membership fingerprint once MUT-284 is on main.

Tests made obsolete: none.

## Section 4 — Performance

1. [P3] (confidence: 7/10) B5 bills: aging reads by `(organizationId, status, dueDate)`; receivables already index `[organizationId, dueDate]` (`schema.prisma` `Receivable`). The brief specifies the bills index the same way. Necessary implementation; no question. Scale: tens to low thousands of bills per firm [estimated].
2. [P3] (confidence: 6/10) Medium confidence, verify: B8/MUT-304 browser OCR. Model download size is unbudgeted in the brief; MUT-304 has a time budget only. The brief takes MUT-253's measured size and sets a cached-download ceiling. No question until MUT-253 reports.
3. Approval filter adds one equality to existing `(organizationId, occurredOn)` reads; no index change [estimated]. Month lock reads `closedThroughMonth` from the organization row `selectProfile` already loaded; the R5 lock adds one shared row lock per firm write.

### Dispositions

- Scope Challenge #1: accepted as a factual correction (no behaviour change).
- Section 1 #1: approved, R1/D1. #2: approved, R2/D2. #3: approved, R3/D3. #4: approved, R4/D4. #5: approved, R5/D5. #6: accepted as necessary implementation of B1 (CHECK `organizations_owner_type_check` forces `profileType` null on conversion; personal profile never converts); B1 itself is approved with the brief.
- Section 2 #1: accepted as necessary implementation of intake D7 (approved 2026-10-19): one `initialApprovalFor(role, firm)` used by POST /v1/expenses, inbox file-as-expense, receipt approve and bill-payment posting. #2: accepted as necessary clarification of D7 (row counts stay unfiltered; money totals filter).
- Section 3: required proof above accepted as proof of D1–D5 and D7. The compliance copy guard (B10) and the Membership fingerprint (B11) stay pending with their B-decisions until Basel approves the brief.
- Section 4 #1: accepted as necessary implementation (bills index). #2: noted, waits for MUT-253. #3: no change.

## Outside voice (Claude subagent, native fallback; Codex CLI not installed)

Reviewer: Plan subagent, completed inside the 5-minute timer. Findings (condensed; verified where marked):
- O1 High (verified `writability.ts:104-108`): in a firm with no Malafat link, every session is read-write on customers, projects and payments (and capture, conversions). Roles on expenses only leave a submitter able to create, settle and reverse receivables and read every balance. → R6
- O2 High (verified `prisma.ts:1238-1263`, expense create/update/softDelete are not transactions): B6 puts `assertOpenPeriod` next to `assertNotTooOld` (compose/route layer, before any transaction), which can't satisfy D5's "read under FOR SHARE inside the write". → necessary implementation of D5, no question (below).
- O3 High: an expense posted by a bill payment can be edited or deleted through `/v1/expenses`, and one receipt could become both an expense and a bill. → R7
- O4 High: B5 copies the bill's VAT onto posted expenses while F14 sums VAT on expenses and bills, so a paid bill's VAT counts twice; partial-payment VAT split unspecified. → R8
- O5 High: the owner holds the invite link (D6/D3): opening it lets them set a password for someone else's email, and "sign in" vs "set password" still reveals whether the account exists; a pending User row at invite time squats the email. → R9
- O6 Medium: approve/reject of a row dated in a closed month isn't on the lock list. → necessary implementation of D2, no question (below).
- O7 Medium: `read-write | read | none` can't express "own unapproved rows" or action rights (approve, close, reopen, manage members). → necessary clarification of D1, no question (below).
- O8 Medium: F15 marks closed-month packs "final" while income and payments stay unlocked. → R10
- O9 Medium: AC 1 asks for API contracts for all 15 children five months early; no pilot firm named. → R11
- O10 Low: B10's banned list includes "approved by" and "return", which D7's own approval labels need. → correction of pending B10, no question (below).
- O11 Low: B7 picks an email provider before v3 needs one. → R12 (after R9, which may make it moot).

Recommendation (reviewer): revise the brief for O1–O5 before Basel approves it.

### Outside-voice dispositions without a question

- O2: accepted as necessary implementation of D5. B6 amended: `assertOpenPeriod` lives behind the repository port, inside the write transaction that holds FOR SHARE on the organization row (Prisma), mirrored in the memory store; the stateless `assertNotTooOld` call sites stay as they are. Firm expense create/update/softDelete become transactional in MUT-312.
- O6: accepted as necessary implementation of D2 (an approve or reject edits the row): a decision on a row dated in a closed month is refused like any edit. The close action lists that month's Pending rows before confirming.
- O7: accepted as necessary clarification of D1 (fold roles into the one derivation): the scope vocabulary gains action scopes `expenses:approve`, `close:write`, `members:write`; the "own unapproved rows" rule is a repository-level check (Prisma + memory) named in the brief, because the store guard sees methods, not rows.
- O10: correction of pending B10: phrase-level list ("compliant", "certified", "tax return", "VAT return", "filing", "ZATCA approved" and Arabic equivalents), not single words; "approved" stays allowed for D7.

## Decision ledger

### R1: Where firm roles are enforced
Finding: Section 1 #1, P1, confidence 9/10, `server/src/auth/writability.ts:111`, `server/src/auth/store-guard.ts` `principalStoreGuard(principal, profileWriter)`, reviewer Claude (native).
Plan baseline: B3 (pending owner approval): `Membership.role` + a second "firm role matrix" with its own drift test; enforcement layer unspecified.
Runtime evidence: session scopes come from `sessionScopesFor(profileWriter)` (`writability.ts:111`, called at `middleware.ts:322`); the store guard is built from `(principal, profileWriter)`; `/v1/me` `access` from `sessionAccessFor(domain, writerOfRecord)` (`serializers.ts:77`). None takes a role.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 role enforcement layer | unspecified | role folds into the one derivation: `sessionScopesFor(writer, role)`, store guard gets the role, `/v1/me` access from the same function | separate role middleware after `requireScope`; store guard and `/v1/me` unchanged |
| Role matrix table + drift test (B3) | pending | pending (unchanged) | pending (unchanged) |
| Own-row rule for submitters (B3) | pending | pending (unchanged) | pending (unchanged) |
Question D1:
D1 — Where should firm roles be enforced?
Project/branch/task: main, MUT-299 brief for epic MUT-298 (firm books).
ELI10: Today one function decides what a signed-in person may do on a profile, and three layers read it: the route check, a second guard inside the data layer, and the permissions list the portal gets from /v1/me. Roles (owner, bookkeeper, submitter) need to plug in somewhere. If they plug into that one function, all three layers agree automatically. If they become a separate check, the data-layer guard and the portal's list don't know about roles.
Stakes if we pick wrong: a submitter reaches a write through a path only the data-layer guard covers, or the portal shows buttons the server then refuses.
Recommendation: A because one derivation keeps the three existing layers in agreement by construction, and the drift-test pattern already proves it works here.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Fold into scopes (recommended)
  ✅ Route check, data-layer guard and /v1/me access all read one function, so they can't disagree
  ✅ Fits the existing writability pattern and its drift test; no new enforcement concept to learn
  ❌ Touches sessionScopesFor, the store guard factory and /v1/me together in MUT-305 (human: ~1 day / CC: ~30 min more)
B) Separate role middleware
  ✅ Leaves the existing writability code untouched; role logic sits in one new file
  ✅ Smaller first diff in MUT-305
  ❌ The data-layer guard and the portal's access map stay role-blind, so a second source of truth exists
Net: a slightly bigger MUT-305 buys one source of truth for permissions instead of two.
Header: Role layer
Options:
A) Fold into scopes (recommended)
Role becomes an input to the one permissions derivation: sessionScopesFor(writer, role), the store guard receives the role, and /v1/me access is computed by the same function. The firm role matrix stays a table in the brief with its own drift test. Effort: human ~1 day / CC ~30 min more in MUT-305. Risk: low, follows the MUT-39 pattern. Maintenance: one place to change.
B) Separate role middleware
A new middleware checks the role after requireScope. The store guard and /v1/me access stay as today. Effort: smallest MUT-305 diff. Risk: medium, the data-layer guard and portal access map ignore roles. Maintenance: two sources of truth.

State: approved
Actual answer: A) Fold into scopes (Basel, D1, 2026-10-19)
Accepted scope: The brief specifies role as an input to the single permissions derivation: `sessionScopesFor(writer, role)`, the store guard factory receives the role, and `/v1/me` access is computed by the same function. The firm role matrix stays a table in the brief between its own markers with its own drift test. MUT-305 implements it. Role matrix contents and the own-row rule stay pending under B3.
History: none

### R2: How a closed month gets corrected
Finding: Section 1 #2, P1, confidence 9/10, `server/src/expenses/compose.ts:20`, reviewer Claude (native).
Plan baseline: MUT-312 as approved ("Approved as drafted", Basel 2026-10-19): "writes dated in a closed month … are refused; corrections are new or reversing entries dated in an open month; owner reopens with a reason (audited)". B5 (pending): "Reversing the payment soft-deletes that expense."
Runtime evidence: `if (minor <= 0n) throw validationError('AMOUNT_INVALID', 'An expense amount must be greater than zero', …)` (`expenses/compose.ts:20`); expenses have edit and soft-delete, no reversal. So an over-recorded expense in a closed month has no "reversing entry", and a bill-payment reversal would soft-delete an expense inside a closed month.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R2 correction model for a closed month | MUT-312: reversing entries in an open month (not implementable for expenses) | Reopen to correct: edits/deletes in a closed month refused; the owner reopens (reason, audited), fixes, closes again. A bill-payment reversal dated in a closed month is refused until reopened. MUT-312 AC reworded | Adjusting entries: a correction expense (`correctsExpenseId`) may be negative and is dated in an open month; a bill-payment reversal posts a negative expense on the reversal date. Every expense reader (summaries, category charts, groups, CSV, phone) handles negative rows. Reopen stays as the owner's escape hatch |
| Reopen with reason, audited (MUT-312) | approved | approved (unchanged) | approved (unchanged) |
| Month lock shape B6 (watermark) | pending | pending (unchanged) | pending (unchanged) |
| Close vs write race (R5) | pending | pending (unchanged) | pending (unchanged) |
Question D2:
D2 — How should a mistake in a closed month be fixed?
Project/branch/task: main, MUT-299 brief for epic MUT-298 (firm books).
ELI10: After a bookkeeper closes March, nothing dated in March can change. The approved ticket said fixes are "reversing entries in an open month", but an expense can only be a positive amount and has no reversal, so that sentence can't be built for expenses. Either the owner reopens March to fix it (QuickBooks-style closing date), or we add correction expenses that may be negative and land in April (Odoo-style adjustment).
Stakes if we pick wrong: with A, an accountant who wants March's report frozen sees it change when the owner reopens; with B, every screen and export that sums expenses must handle negative rows, or totals go wrong.
Recommendation: A because reopen-with-reason is already in MUT-312, it changes no expense reader, and adjusting entries can be added later if accountants ask for them.
Completeness: A=7/10, B=10/10
Pros / cons:
A) Reopen to correct (recommended)
  ✅ Uses the reopen-with-reason flow MUT-312 already has; no new kind of expense row anywhere
  ✅ Every existing total, chart, group and export keeps working unchanged
  ❌ A reopened month's reports change after the accountant saw them; the audit trail is the only record
B) Adjusting entries
  ✅ Closed months never change; fixes land in the open month the way accountants post adjustments
  ✅ Bill-payment reversals work in any month without reopening
  ❌ Negative expenses ripple through summaries, category charts, groups, CSV and the phone (human: ~1 week / CC: ~2 hours more)
Net: A is the smaller honest rule; B is the accountant-grade rule at the cost of touching every expense reader.
Header: Close fixes
Options:
A) Reopen to correct (recommended)
Writes, edits and deletes dated in a closed month are refused. To fix one, the owner reopens the month with a reason (audited), corrects it, and closes again. A bill-payment reversal dated in a closed month is refused until that month is reopened. MUT-312's AC changes from "corrections are reversing entries" to "corrections need a reopen". Effort: none beyond MUT-312. Risk: low. Maintenance: none new.
B) Adjusting entries
A correction expense may be negative when it names the expense it corrects (correctsExpenseId) and is dated in an open month. A bill-payment reversal posts a negative expense on the reversal date. Summaries, category charts, groups, CSV and the phone app all handle negative rows. Reopen stays as the owner's escape hatch. Effort: human ~1 week / CC ~2 hours more across MUT-308/312 and every expense reader. Risk: medium. Maintenance: every future expense reader must handle negatives.

State: approved
Actual answer: A) Reopen to correct (Basel, D2, 2026-10-19)
Accepted scope: The brief specifies: writes, edits and deletes dated in a closed month are refused; to fix one, the owner reopens the month with a reason (audited), corrects it and closes again; a bill-payment reversal dated in a closed month is refused until that month is reopened. MUT-312's AC wording changes from "corrections are new or reversing entries dated in an open month" to "corrections need a reopen" (Jira comment on MUT-312 with the brief). Expenses stay positive-only. Ceiling: a reopened month's reports can change after the accountant saw them; upgrade to adjusting entries (option B) when an accountant or auditor asks for frozen months. Month lock shape (B6) and the close race (R5) stay pending.
History: none

### R3: An invite to an email that already has an account
Finding: Section 1 #3, P1, confidence 8/10, `server/src/routes/admin-users.ts:187` (email unique per account) and `SetupLinkPurpose { SETUP RESET }` (`server/prisma/schema.prisma`), reviewer Claude (native).
Plan baseline: intake D6 (approved): "The owner invites by email with a role; the invite always yields a copyable setup link; email delivery when a provider is chosen." MUT-306 (approved as drafted): invite "creating a pending user and a setup link through the existing account-setup flow (MUT-235)". Existing-account case unspecified.
Runtime evidence: a setup link sets the account's password (`routes/account-setup.ts`, ADR-088). For an existing account that is a password reset. Email uniqueness makes "does this email have an account" observable if the invite answers differently.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R3 invite to an existing account | unspecified | One invite link for every invite, bound to the email: a new person sets a password through it; an existing account signs in as that email and accepts. Membership is pending until accepted. Same response either way | Existing account: membership granted at once, they see a notice; new person: setup link. Responses differ | Existing account: invite refused, the operator adds them; new person: setup link. Responses differ |
| Never mint SETUP/RESET for an existing account | implied by ADR-088 | yes | yes | yes |
| Invite rate limit, expiry, revoke (MUT-306) | approved | approved (unchanged) | approved (unchanged) | approved (unchanged) |
| Email provider (B7) | pending | pending (unchanged) | pending (unchanged) | pending (unchanged) |
Question D3:
D3 — What happens when a firm owner invites an email that already has a Mutaba3a account?
Project/branch/task: main, MUT-299 brief for epic MUT-298 (firm books).
ELI10: An invite gives the new person a link to set their password. If that email already belongs to someone, sending them a set-password link would let any firm owner reset a stranger's password, so we must never do that. We also shouldn't answer differently depending on whether the email exists, or owners could probe who uses Mutaba3a. The cleanest fix is one kind of invite link for everyone: new people set a password through it, existing people sign in and click Accept.
Stakes if we pick wrong: a firm owner can take over someone's account, or anyone with owner rights can check which emails have accounts.
Recommendation: A because it closes both the takeover and the email-probing hole and asks the existing person's consent before they join a firm.
Completeness: A=9/10, B=6/10, C=5/10
Pros / cons:
A) One link, accept to join (recommended)
  ✅ No password is ever set on an existing account through an invite, so no takeover path
  ✅ The owner sees the same "Invite sent" and link whether or not the email has an account
  ❌ Adds an invite token, a pending membership state and an Accept screen on portal and phone (human: ~2 days / CC: ~1 hour more)
B) Grant existing accounts at once
  ✅ Existing users land in the firm with no extra step
  ✅ Least new UI; reuses today's membership grant
  ❌ Joins someone to a firm without consent, and the different response tells the owner the email has an account
C) Refuse, operator adds them
  ✅ Smallest build; the operator path already exists
  ✅ No consent question because a human checks each case
  ❌ The refusal itself reveals the account exists, and owners need the operator for common cases
Net: A costs an accept step and a token table; B and C each leave a privacy hole.
Header: Existing accounts
Options:
A) One link, accept to join (recommended)
Every invite issues one link bound to the invited email (new INVITE purpose, never SETUP/RESET on an existing account). A new person sets a password through it. An existing account signs in as that email and accepts; the membership is pending until then and the invite can be declined. The owner gets the same response and copyable link either way. Effort: human ~2 days / CC ~1 hour more in MUT-306. Risk: low. Maintenance: one invite token lifecycle.
B) Grant existing accounts at once
An existing account gets the membership immediately and sees a notice; a new person gets a setup link. Effort: smallest. Risk: medium, joins without consent and the response reveals the account exists. Maintenance: low.
C) Refuse, operator adds them
An invite to an existing account is refused and the operator adds the membership; a new person gets a setup link. Effort: smallest. Risk: medium, the refusal reveals the account exists. Maintenance: operator load.

State: approved
Actual answer: A) One link, accept to join (Basel, D3, 2026-10-19)
Accepted scope: The brief specifies: every invite issues one link bound to the invited email, under a new INVITE purpose; SETUP/RESET is never minted on an existing account through an invite. A new person sets a password through the link. An existing account signs in as that email and accepts (or declines); the membership is pending until accepted. The owner gets the same response and a copyable link either way. MUT-306 gains the invite token lifecycle, the pending membership state and an Accept screen on portal and phone (Jira comment on MUT-306 with the brief). Rate limit, expiry and revoke as approved in MUT-306; email provider (B7) stays pending.
History: none

### R4: Roles members get when firm features are turned on
Finding: Section 1 #4, P2, confidence 8/10, plan §1 B3 "default `OWNER` (every existing membership keeps today's behaviour)", reviewer Claude (native).
Plan baseline: B3 (pending owner approval): role column default OWNER for every membership.
Runtime evidence: operator-provisioned organizations can have many members (`admin-users.ts:264` grant), Malafat firms included; no role exists today, so today every member has the same full session rights on expenses (`writability.ts` `expenses` row: session read-write).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R4 roles at the moment firm features turn on | B3: everyone OWNER | The operator names at least one owner when enabling; every other existing member becomes BOOKKEEPER (same expense rights as today, no member management) | Everyone stays OWNER; owners demote others afterwards |
| Last-owner rule: the last owner can't be removed or demoted (new) | none | yes | yes |
| Role column default for non-firm organizations | OWNER (inert while firm off) | OWNER, inert (unchanged) | OWNER, inert (unchanged) |
| R1 enforcement layer | approved (D1) | approved (unchanged) | approved (unchanged) |
Question D4:
D4 — When an operator turns firm features on for an organization that already has several members, what role does each member get?
Project/branch/task: main, MUT-299 brief for epic MUT-298 (firm books).
ELI10: Today everyone in an organization has the same rights. Roles only start to matter when firm features are switched on. If everyone becomes an owner at that moment, every existing member can invite strangers, remove colleagues and change roles. If the operator names the owner when switching it on, everyone else keeps the expense rights they have today as bookkeepers, without the power to manage people. Either way the last owner can never be removed or demoted, so a firm can't lock itself out.
Stakes if we pick wrong: a junior member of a law firm wakes up able to remove the partners and invite outsiders into the books.
Recommendation: A because it keeps every member's current rights on expenses and gives member management only to the person the firm asked us to make owner.
Completeness: A=9/10, B=6/10
Pros / cons:
A) Operator names owners (recommended)
  ✅ Nobody gains the power to invite or remove people they didn't have before
  ✅ Bookkeeper keeps exactly today's expense rights, so nothing breaks for existing members
  ❌ The enable step needs an owner picker in the admin route and CLI (human: ~half day / CC: ~15 min more)
B) Everyone starts as owner
  ✅ No extra input when the operator enables firm features
  ✅ Owners can demote others themselves right after
  ❌ Until someone demotes them, every member can invite, remove and re-role others
Net: one extra field at enable time versus a window where everyone holds owner powers.
Header: Initial roles
Options:
A) Operator names owners (recommended)
Enabling firm features requires the operator to name at least one owner (admin route and CLI). Every other existing member becomes BOOKKEEPER, which keeps today's expense rights but no member management. The last owner can never be removed or demoted. Non-firm organizations keep the inert OWNER default. Effort: human ~half day / CC ~15 min more in MUT-300/305. Risk: low. Maintenance: none.
B) Everyone starts as owner
Every existing member becomes OWNER when firm features turn on; owners adjust roles afterwards. The last owner can never be removed or demoted. Non-firm organizations keep the inert OWNER default. Effort: none extra. Risk: medium, a window where every member manages people. Maintenance: none.

State: approved
Actual answer: A) Operator names owners (Basel, D4, 2026-10-19)
Accepted scope: The brief specifies: enabling firm features requires the operator to name at least one owner (admin route and CLI, MUT-300); every other existing member becomes BOOKKEEPER, which keeps today's expense rights and has no member management; the last owner can never be removed or demoted (MUT-305/306). Non-firm organizations keep the inert OWNER column default. Jira comments on MUT-300 and MUT-305 with the brief.
History: none

### R5: Closing a month while someone is saving into it
Finding: Section 1 #5, P2, confidence 7/10, plan §1 B6 and `server/src/repositories/prisma.ts:1534` `SELECT id FROM organizations WHERE id = … FOR NO KEY UPDATE`, reviewer Claude (native).
Plan baseline: B6 (pending): `assertOpenPeriod(org, date)` next to `assertNotTooOld` at the firm write call sites; concurrency unspecified. R2 (approved, D2): writes in a closed month are refused; reopen to correct.
Runtime evidence: expense writes don't lock the organization row today; `lockOrganization` is used for caps (e.g. expense groups, `prisma.ts:1286`). In Postgres an UPDATE of the organization row takes a lock that conflicts with `FOR SHARE` but `FOR SHARE` locks don't conflict with each other.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R5 close vs in-flight write | unspecified | Firm writes that the lock checks run in a transaction that takes `FOR SHARE` on the organization row and reads `closedThroughMonth` under it; closing updates that row, so a close waits for in-flight writes and later writes see the new month. Firm organizations only | No lock: a write that read "open" a moment before the close can still commit into the closed month; the brief documents it and the audit trail shows it |
| R2 reopen-to-correct | approved (D2) | approved (unchanged) | approved (unchanged) |
| Month lock shape B6 (watermark) | pending | pending (unchanged) | pending (unchanged) |
Question D5:
D5 — Should closing a month wait for saves that are already in progress?
Project/branch/task: main, MUT-299 brief for epic MUT-298 (firm books).
ELI10: A bookkeeper clicks "Close March" at the same instant a colleague saves a March expense. Without coordination, the save checked "March is open" a millisecond earlier and lands in March after it closed. With a shared lock on the firm's record, saves still run side by side, but the close waits for them to finish, and any save after the close sees March as closed.
Stakes if we pick wrong: a closed month quietly gains an expense the accountant never saw, and the "closed" promise is broken in exactly the case nobody tests by hand.
Recommendation: A because the shared lock is one extra statement per firm save, saves don't block each other, and the closed-month promise becomes true instead of nearly true.
Completeness: A=9/10, B=5/10
Pros / cons:
A) Shared lock on save (recommended)
  ✅ A closed month can never gain a row after the close commits
  ✅ Saves still run in parallel with each other; only a close waits for them
  ❌ Every firm expense, bill and payment write runs inside a transaction with one extra row lock (human: ~half day / CC: ~20 min more in MUT-312)
B) Accept the race
  ✅ No change to how expense writes run today
  ✅ Simplest MUT-312
  ❌ A save in flight during the close can land in the closed month, visible only in the audit trail
Net: one shared row lock per firm save makes "closed" mean closed.
Header: Close race
Options:
A) Shared lock on save (recommended)
In firm organizations, every write the month lock checks runs in a transaction that takes FOR SHARE on the organization row and reads closedThroughMonth under that lock. Closing or reopening updates that row, so it waits for in-flight writes, and later writes see the new value. The memory store needs nothing (single-threaded). A test:db concurrency test proves it. Effort: human ~half day / CC ~20 min more in MUT-312. Risk: low. Maintenance: low.
B) Accept the race
No lock. A write that read "open" just before the close can commit into the closed month; the brief documents the window and the audit trail shows the write. Effort: none. Risk: medium, the closed-month guarantee has a gap. Maintenance: none.

State: approved
Actual answer: A) Shared lock on save (Basel, D5, 2026-10-19)
Accepted scope: The brief specifies: in firm organizations, every write the month lock checks runs in a transaction that takes FOR SHARE on the organization row and reads `closedThroughMonth` under that lock; closing or reopening updates that row, so it waits for in-flight writes and later writes see the new value; the memory store needs nothing; MUT-312 carries a `test:db` concurrency test proving it. Month lock shape (B6) stays pending owner approval with the brief.
History: none

### R6: Do firm roles cover client money, not just expenses?
Finding: Outside voice O1, High, confidence 9/10 (verified), `server/src/auth/writability.ts:104-108` `return profileWriter === null ? 'read-write' : 'read';`, reviewer Claude subagent (native fallback).
Plan baseline: B3 (pending) + MUT-305 (approved as drafted): roles cover expenses, vendors, receipts, bills and close; "roles on Malafat-owned domains (customers, agreements and payments stay as today)" out of scope. D1 (approved): roles fold into the one derivation.
Runtime evidence: with no Malafat writer, every session is read-write on customers, projects, payments; capture and conversions are read-write for every session; summaries readable by every session.
Comparison grid:
| Choice | Current | A | B | C | D |
|---|---|---|---|---|---|
| R6 role coverage | expense-side domains only | The firm role matrix has a row for every session domain. OWNER and BOOKKEEPER keep today's rights everywhere. SUBMITTER: create expenses and receipts, edit own unapproved rows, read categories, vendors, customers and projects (to tag), none on payments, receivables, capture, conversions and money summaries; sees own expenses only | Keep: roles on expense-side domains only; a submitter keeps today's full rights on client money in non-Malafat firms | Investigate before MUT-305: settle the submitter's visibility with a pilot firm, bounded to one conversation; nothing else changes | Defer this proposal only; B3 stays as drafted, row unresolved |
| D1 single derivation | approved | approved (unchanged) | approved (unchanged) | approved (unchanged) | approved (unchanged) |
| O7 action scopes + own-row repo check | accepted (D1) | accepted (unchanged) | accepted (unchanged) | accepted (unchanged) | accepted (unchanged) |
| R4 initial roles | approved (D4) | approved (unchanged) | approved (unchanged) | approved (unchanged) | approved (unchanged) |
Question D6:
D6 — Should firm roles also limit who can touch client money (receivables, payments, income), not just expenses?
Project/branch/task: main, MUT-299 brief for epic MUT-298 (firm books).
ELI10: In a firm that isn't connected to Malafat, anyone signed in can today create and settle what clients owe, record payments and log income. The plan put roles only on the expense side, so a "submitter" who is only meant to hand in receipts could still record or reverse a client payment and see every client's balance. Giving the role table a row for every area closes that gap: owners and bookkeepers keep today's rights, submitters only hand in expenses and receipts and see their own.
Stakes if we pick wrong: a junior submitter can reverse a client's payment or read every client balance in a firm that thinks roles protect it.
Recommendation: A because the plan's own promise is "no role leak between firm members", and this is the largest leak; it costs one more set of rows in the same table D1 already approved.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Apply this change (recommended)
  ✅ A submitter can't create, settle or reverse anything a client owes, in any firm
  ✅ Same table and same derivation D1 approved; one more drift-tested row per domain
  ❌ MUT-305 grows: every session domain gets role cells and refusal tests (human: ~2 days / CC: ~45 min more)
B) Keep this row's current value
  ✅ MUT-305 stays as drafted, expense-side only
  ✅ Malafat-fed firms are unaffected either way, because Malafat already owns those rows
  ❌ In non-Malafat firms a submitter keeps full rights on client money and every balance
C) Investigate before choosing
  ✅ A pilot firm says what submitters should see before we fix it in the table
  ✅ Bounded to one conversation before MUT-305 starts; nothing else changes
  ❌ The brief can't be approved with a known open leak, so MUT-305 waits on it
D) Defer this proposed change only
  ✅ Keeps the brief moving; the row stays visible as unresolved
  ✅ Nothing else in the plan changes
  ❌ MUT-305 may build expense-only roles and need rework later
Net: A closes the biggest leak inside the table you already approved, at the cost of a bigger MUT-305.
Header: Role coverage
Options:
A) Apply this change (recommended)
The firm role matrix has a row for every session domain. OWNER and BOOKKEEPER keep today's rights everywhere. SUBMITTER may create expenses and receipts, edit own unapproved rows, read categories, vendors, customers and projects for tagging, and has none on payments, receivables, capture (income), conversions and money summaries; a submitter sees only their own expenses. MUT-305 AC widens to every domain. Effort: human ~2 days / CC ~45 min more. Risk: low. Maintenance: one table.
B) Keep this row's current value
Roles cover expenses, vendors, receipts, bills and close only, as drafted; in non-Malafat firms a submitter keeps today's full rights on customers, projects, payments, capture and conversions. Effort: none. Risk: high, role leak on client money. Maintenance: none.
C) Investigate before choosing
Before MUT-305 starts, settle what a submitter may see and do with one pilot firm (one conversation). Nothing else changes; this row stays pending until then. Effort: one conversation. Risk: MUT-305 waits. Maintenance: none.
D) Defer this proposed change only
Leave this row unresolved and visible; B3 and MUT-305 stay as drafted for now. Effort: none now. Risk: rework if MUT-305 builds expense-only roles. Maintenance: an open item.

State: approved
Actual answer: A) Apply this change (Basel, D6, 2026-10-19)
Accepted scope: The brief's firm role matrix has a row for every session domain. OWNER and BOOKKEEPER keep today's rights everywhere. SUBMITTER may create expenses and receipts, edit own unapproved rows, read categories, vendors, customers and projects for tagging, and has none on payments, receivables, capture (income), conversions and money summaries; a submitter sees only their own expenses. MUT-305's AC widens to every domain (Jira comment on MUT-305 with the brief). D1, O7 and D4 unchanged.
History: none

### R7: Can people edit an expense that a bill payment posted?
Finding: Outside voice O3 (first half), High, confidence 8/10, plan §1 B5 "a bill payment posts a linked expense (`Expense.billPaymentId` …)" and `server/src/routes/expenses.ts:168` (PATCH) / `:207` (DELETE), reviewer Claude subagent.
Plan baseline: B5 (pending): bill payment posts a linked expense; reversal soft-deletes it. R2 (approved, D2): reversal in a closed month refused until reopened.
Runtime evidence: PATCH and DELETE on `/v1/expenses/{id}` accept any live expense of the profile today; no "system-owned" concept exists.
Comparison grid:
| Choice | Current | A | B | C | D |
|---|---|---|---|---|---|
| R7 posted expenses | editable like any expense | Read-only through `/v1/expenses`: PATCH/DELETE on a row with `billPaymentId` are refused (409, names the bill); changes go through the bill or its payment (reverse and re-pay). The portal shows it as "From bill …" | Keep editable; drift between bill payments and spend is possible | Investigate: bounded check of how MUT-308 would sync edits back to the payment; nothing else changes | Defer this proposal only |
| Receipt to expense-or-bill exclusivity (R8) | pending | pending (unchanged) | pending (unchanged) | pending (unchanged) | pending (unchanged) |
| R2 reopen-to-correct | approved | approved (unchanged) | approved (unchanged) | approved (unchanged) | approved (unchanged) |
Question D7:
D7 — Should an expense that was created by paying a bill be locked against direct edits?
Project/branch/task: main, MUT-299 brief for epic MUT-298 (firm books).
ELI10: When a firm pays a vendor bill, the plan writes a matching expense so every report already counts it. If someone then edits or deletes that expense directly, the bill still says "paid 500" while spending shows 300 or nothing. Locking those generated expenses means the only way to change them is through the bill: reverse the payment and pay again.
Stakes if we pick wrong: spending and bills disagree, and the "money is never counted twice or lost" promise breaks on an ordinary edit.
Recommendation: A because it keeps bill payments and spending equal by construction with one refusal rule on two routes.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Apply this change (recommended)
  ✅ Bill payments and spending can never drift apart
  ✅ One rule on two existing routes, plus a "From bill" label in the portal and phone
  ❌ Fixing a wrong amount takes a reverse-and-repay instead of a quick edit (human: ~half day / CC: ~15 min in MUT-308/309)
B) Keep this row's current value
  ✅ Every expense keeps behaving the same, with no special case
  ✅ No extra label or refusal to build
  ❌ A direct edit silently makes spending disagree with the bill
C) Investigate before choosing
  ✅ Checks whether edits could flow back into the payment instead of being refused
  ✅ Bounded to MUT-308 planning; nothing else changes
  ❌ Leaves the no-double-count rule open while the brief is approved
D) Defer this proposed change only
  ✅ Keeps the brief moving with the row visible as open
  ✅ No other plan change
  ❌ MUT-308 may ship without the protection
Net: one refusal rule keeps bills and spending equal; the cost is a reverse-and-repay for corrections.
Header: Posted expenses
Options:
A) Apply this change (recommended)
An expense with a billPaymentId is read-only through /v1/expenses: PATCH and DELETE are refused with 409 naming the bill. To change it, reverse the bill payment and record it again. Portal and phone show it as "From bill …". Effort: human ~half day / CC ~15 min in MUT-308/309. Risk: low. Maintenance: low.
B) Keep this row's current value
Posted expenses stay editable like any other; bills and spending can drift after a direct edit. Effort: none. Risk: high, silent mismatch. Maintenance: none.
C) Investigate before choosing
In MUT-308 planning, check whether expense edits could update the bill payment instead of being refused; nothing else changes and this row stays pending. Effort: one planning pass. Risk: rule open meanwhile. Maintenance: none.
D) Defer this proposed change only
Leave this row unresolved and visible; B5 stays as drafted. Effort: none now. Risk: MUT-308 ships unprotected. Maintenance: an open item.

State: approved
Actual answer: A) Apply this change (Basel, D7, 2026-10-19)
Accepted scope: The brief specifies: an expense with a `billPaymentId` is read-only through `/v1/expenses`; PATCH and DELETE are refused with 409 naming the bill; to change it, reverse the bill payment and record it again; portal and phone label it "From bill …" (MUT-308/309/310). Receipt exclusivity (R8) stays pending.
History: none

### R8: One receipt, one record
Finding: Outside voice O3 (second half), High, confidence 8/10, MUT-309 (approved as drafted) "Create a bill from a To-review receipt or by hand" and MUT-255 approve route "creates the expense and links the receipt", reviewer Claude subagent.
Plan baseline: MUT-255 (approved): a receipt is approved into an expense. MUT-309 (approved): a receipt can become a bill. Nothing says a receipt can't do both.
Runtime evidence: `ExpenseReceipt.expenseId` is required today (`schema.prisma:1030`); MUT-255 makes it optional; no bill link exists yet.
Comparison grid:
| Choice | Current | A | B | C | D |
|---|---|---|---|---|---|
| R8 receipt targets | unspecified | A receipt is filed into exactly one record: an expense or a bill, never both. Enforced by a database CHECK (at most one of `expenseId`, `billId` set) and a 409 on the second filing. Unlinking (deleting the record) frees it | Keep unspecified: one receipt could back an expense and a bill, counting the purchase twice | Investigate: bounded check in MUT-309 planning whether a firm ever needs one receipt on two records; nothing else changes | Defer this proposal only |
| R7 posted expenses read-only | approved (D7) | approved (unchanged) | approved (unchanged) | approved (unchanged) | approved (unchanged) |
Question D8:
D8 — Can one receipt be filed as both an expense and a bill?
Project/branch/task: main, MUT-299 brief for epic MUT-298 (firm books).
ELI10: A receipt in the To-review queue can be turned into an expense (MUT-255) or into a vendor bill (MUT-309). If nothing stops it, the same receipt can be turned into both, and the purchase is counted twice: once as the expense and again when the bill is paid. A database rule that a receipt points to at most one of the two closes that.
Stakes if we pick wrong: one shared receipt doubles a purchase in every report.
Recommendation: A because a single database check makes the double count impossible, and no real firm files one purchase as both a paid expense and an unpaid bill.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Apply this change (recommended)
  ✅ The database itself refuses the second filing, so no code path can double count
  ✅ Deleting the expense or bill frees the receipt to be filed again
  ❌ One more CHECK and a 409 path in MUT-255/309 (human: ~2 hours / CC: ~10 min)
B) Keep this row's current value
  ✅ No extra constraint to build or test
  ✅ Maximum flexibility for odd cases
  ❌ A receipt filed twice doubles the purchase silently
C) Investigate before choosing
  ✅ Confirms with real firm usage before forbidding anything
  ✅ Bounded to MUT-309 planning; nothing else changes
  ❌ The double-count hole stays open while the brief is approved
D) Defer this proposed change only
  ✅ Keeps the brief moving with the row visible
  ✅ No other plan change
  ❌ MUT-309 may ship without the rule
Net: one CHECK constraint versus a silent double count.
Header: Receipt filing
Options:
A) Apply this change (recommended)
A receipt is filed into exactly one record, an expense or a bill, never both. A database CHECK allows at most one of expenseId and billId, and a second filing gets 409. Deleting the record frees the receipt. Effort: human ~2 hours / CC ~10 min in MUT-255/309. Risk: low. Maintenance: none.
B) Keep this row's current value
Nothing stops a receipt from backing both an expense and a bill. Effort: none. Risk: high, silent double count. Maintenance: none.
C) Investigate before choosing
In MUT-309 planning, check whether any firm needs one receipt on two records; this row stays pending. Effort: one planning pass. Risk: hole open meanwhile. Maintenance: none.
D) Defer this proposed change only
Leave this row unresolved and visible. Effort: none now. Risk: MUT-309 ships without the rule. Maintenance: an open item.

State: approved
Actual answer: A) Apply this change (Basel, D8, 2026-10-19)
Accepted scope: The brief specifies: a receipt is filed into exactly one record, an expense or a bill, never both; a database CHECK allows at most one of `expenseId` and `billId`; a second filing gets 409; deleting the record frees the receipt (MUT-255 and MUT-309; Jira comments with the brief).
History: none

### R9: Which VAT counts in the VAT summary
Finding: Outside voice O4, High, confidence 9/10, plan §1 B5 "category and VAT share copied from the bill" and MUT-313 (approved as drafted) "VAT on approved expenses and bills (input)", reviewer Claude subagent.
Plan baseline: B5 (pending): the posted expense carries the bill's VAT share. MUT-313 (approved): input VAT = VAT on approved expenses and bills.
Runtime evidence: no expense VAT exists yet (MUT-302 adds it); `computeVat` / `roundHalfUpDiv` (`server/src/vat.ts:39,45-59`) round half-up per amount, so splitting a bill's VAT across partial payments by rounding each part can miss the total by a minor unit.
Comparison grid:
| Choice | Current | A | B | C | D |
|---|---|---|---|---|---|
| R9 VAT summary basis | expenses and bills both count (double for a paid bill) | Invoice basis: input VAT = VAT on bills (by bill issue date) + VAT on approved expenses that did not come from a bill. Posted expenses still show their VAT share but are excluded from the summary. A bill's VAT is split across its payments by largest remainder so the shares add up to the bill's VAT exactly | Keep as drafted: input VAT = VAT on approved expenses and on bills; a paid bill's VAT counts twice; no split rule | Investigate: ask one accountant per market (IL, PS, JO, SA) which basis their filings use (invoice or payment), bounded to before MUT-313; nothing else changes | Defer this proposal only |
| Summary labelled "for your accountant, not a return" (MUT-313) | approved | approved (unchanged) | approved (unchanged) | approved (unchanged) | approved (unchanged) |
| R7 posted expenses read-only | approved (D7) | approved (unchanged) | approved (unchanged) | approved (unchanged) | approved (unchanged) |
Question D9:
D9 — When a vendor bill is paid, which record's VAT goes into the VAT summary?
Project/branch/task: main, MUT-299 brief for epic MUT-298 (firm books).
ELI10: A paid bill shows up twice in the data: the bill itself, and the expense its payment created. Both carry the same VAT, so the summary as drafted counts it twice. We have to pick one. Invoice basis counts the bill's VAT on the bill's date, which is how VAT invoices are usually claimed. Payment basis counts it when the money actually leaves. Either way, a bill paid in parts must split its VAT so the parts add up to the exact total.
Stakes if we pick wrong: the accountant gets an input-VAT figure that's too high (double counted) or in the wrong month.
Recommendation: A because input VAT is normally claimed from the tax invoice's date, and the bill is that invoice; this is my reading of common practice in these markets, not checked with an accountant, so C is a reasonable choice if you want it confirmed first.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Apply: invoice basis (recommended)
  ✅ A paid bill's VAT counts once, in the month of the tax invoice
  ✅ Unpaid bills still count, matching how an input-VAT claim usually works
  ❌ The summary and the spending view use different dates for the same purchase, which needs one line of copy (human: ~half day / CC: ~15 min in MUT-302/313)
B) Keep this row's current value
  ✅ No change to the drafted MUT-313 text
  ✅ Nothing new to explain
  ❌ Every paid bill's VAT is counted twice
C) Investigate before choosing
  ✅ An accountant per market confirms the basis before it's built
  ✅ Bounded to before MUT-313 starts (v5, April); nothing else changes
  ❌ The double count stays in the approved text until then
D) Defer this proposed change only
  ✅ Keeps the brief moving with the row visible
  ✅ MUT-313 is five months away
  ❌ The drafted rule double counts if built as written
Net: pick one basis now to kill the double count; invoice basis is the usual one, an accountant can confirm.
Header: VAT basis
Options:
A) Apply: invoice basis (recommended)
Input VAT = VAT on bills, dated by the bill's issue date, plus VAT on approved expenses that did not come from a bill. Expenses posted by bill payments still show their VAT share but are left out of the summary. A bill's VAT is split across its payments by largest remainder so the shares add up exactly. MUT-313's AC is reworded. Effort: human ~half day / CC ~15 min. Risk: low. Maintenance: low.
B) Keep this row's current value
Input VAT = VAT on approved expenses and on bills, as drafted; a paid bill's VAT is counted twice. Effort: none. Risk: high, wrong figure. Maintenance: none.
C) Investigate before choosing
Before MUT-313, ask one accountant per market (IL, PS, JO, SA) which basis their filings use; this row stays pending. Effort: a few conversations. Risk: wrong text stays until then. Maintenance: none.
D) Defer this proposed change only
Leave this row unresolved and visible; MUT-313 stays as drafted. Effort: none now. Risk: double count if built as written. Maintenance: an open item.

State: pending
Actual answer: unanswered
Accepted scope: none
History: none
