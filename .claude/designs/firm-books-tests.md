# Firm books — test plan (MUT-299, epic MUT-298)

The brief is `.claude/designs/firm-books.md`. Each child ticket writes these tests **first** (TDD, CLAUDE.md Phase 2), at the layer named. Every money rule runs on **both stores**: the memory store unit test plus the `test:db` Postgres test, the MUT-267 parity pattern.

How to read the value cards:
- `protects` is the behaviour the test guards.
- `fails_when` is the credible regression it catches.
- `why_new` is why existing coverage misses it.
- `seam` is any production hook the test needs.
- `no_claim` is what green does not prove.

## 1. Cross-cutting contract tests (written once, extended by each child)

| Test | Layer | Owner ticket | Value |
|---|---|---|---|
| **Firm role matrix drift** — parse `firm-books.md` between `firm-role-matrix` markers and compare it to the role `const`, cell by cell | server unit | MUT-305 | protects=brief and code agree; fails_when=either side changes alone; why_new=no role table today; seam=none; no_claim=behaviour |
| **Role refusal table** — every firm route × OWNER/BOOKKEEPER/SUBMITTER × firm on/off; expect allowed or 403 `ROLE_NOT_PERMITTED` | server integration (memory) | MUT-305, then every route ticket adds rows | protects=role enforcement on every write and read; fails_when=a new firm route skips the role scopes; why_new=writability tests cover the writer of record only; seam=none; no_claim=portal button hiding |
| **One derivation** — `/v1/me` `access` equals what `requireScope` and the store guard enforce for each role | server unit | MUT-305 | protects=D1; fails_when=the access map and the guard disagree; why_new=new input; seam=none; no_claim=UI |
| **Firm flag off ⇒ roles inert** — a non-firm organization with a SUBMITTER role value behaves exactly as today | server integration | MUT-305 | protects=existing profiles unchanged; fails_when=role leaks into non-firm orgs; why_new=new column; seam=none; no_claim=local mode |
| **Totals contract** — the three total paths (summaries/expenses, group totals + excluded totals, group summary) all pass `approval: APPROVED`; a listing helper fails if a new `totalsByCurrency`-style reader skips it | server unit + test:db | MUT-307 | protects=Pending never counted; fails_when=a new total reader omits the option; why_new=no approval state today; seam=none; no_claim=charts |
| **`initialApprovalFor` × four creation paths** — POST expense, inbox file-as-expense, receipt approve, bill-payment posting × approval on/off × role | server integration | MUT-307 (+ MUT-255/308 rows) | protects=ID7 on every path; fails_when=a path sets APPROVED for a submitter; why_new=new rule; seam=none; no_claim=none beyond protects |
| **Period lock everywhere** — every write in §9.2 dated inside `closedThroughMonth` gets 409 `PERIOD_CLOSED`; a PATCH checks the old and new dates; income, payments and conversions are not locked | server integration (memory + test:db) | MUT-312 (rows added by 307/308) | protects=closed month unchanged; fails_when=a write path forgets the check or only checks the new date; why_new=no lock today; seam=none; no_claim=UI wording |
| **Close vs in-flight write** — two Postgres connections: a write holding FOR SHARE, and a close waiting; the write after the close is refused | test:db | MUT-312 | protects=D5; fails_when=the check runs outside the transaction; why_new=no lock today; seam=none; no_claim=memory store |
| **No double count** — bill + payment + posted expense sum to one spend; a STAFF bill payment posts nothing; a reversal removes the posted expense | server integration + test:db | MUT-308, MUT-311 | protects=spending totals; fails_when=a bill counts as spend or a staff bill posts; why_new=new model; seam=none; no_claim=FX |
| **Posted expense read-only** — PATCH/DELETE on an expense with `billPaymentId` returns 409 `POSTED_BY_BILL` | server integration | MUT-308 | protects=D7; fails_when=the expense routes forget the guard; why_new=new column; seam=none; no_claim=UI label |
| **One receipt, one record** — the DB CHECK and a 409 on second filing, as expense then bill and as bill then expense | test:db + memory | MUT-255/308 | protects=D8; fails_when=the CHECK is dropped or the memory store lacks the rule; why_new=new column; seam=none; no_claim=UI |
| **VAT split exactness** — for random bill VAT and payment splits, the shares sum to the bill's VAT exactly (largest remainder) | server unit (table + property) | MUT-302/308 | protects=D9; fails_when=per-payment rounding drifts by a minor unit; why_new=new rule; seam=none; no_claim=summary UI |
| **VAT summary basis** — a paid bill's VAT counts once, by bill issue date; posted expenses are excluded; unrecorded VAT is counted separately | server integration | MUT-313 | protects=D9; fails_when=posted expenses are summed too; why_new=new summary; seam=none; no_claim=accountant acceptance |
| **Compliance copy guard** — firm keys in `ar.json`/`en.json` contain none of the banned phrases; "approved" is allowed | unit (scripts) | first ticket adding firm strings (MUT-300) | protects=ID5 copy line; fails_when=someone writes "VAT return" or "compliant"; why_new=no guard today; seam=none; no_claim=phone ARB files (add rows when MUT-306/310 add strings) |
| **Membership fingerprint** — local snapshot shape includes Membership | portal unit | MUT-305, once MUT-284 is on main | protects=ADR-097 D1 for the new column; fails_when=role is added without a snapshot migration; why_new=Membership isn't fingerprinted today; seam=none; no_claim=migration correctness |

## 2. Per-ticket tests (minimum set; each eng-ticket may add)

### MUT-300 · firm flag (as built 2026-10-20; MUT-300 eng review D3–D6)
- Request: owned BUSINESS → 202; repeat (same or new key) → the first request, one audit row; no version bump (O3); built-in personal → 409 `PERSONAL_PROFILE`; owned PERSONAL → 409 `NOT_BUSINESS`; not owner → 403 `READ_ONLY_PROFILE NOT_OWNER`; already a firm → 409 `ALREADY_FIRM`; API key → 403.
- Enable **in place** (D4): an owned Business profile stays owned and its owner is OWNER; an operator firm with no owner named → 422; named owner not a member → 409 `NOT_A_MEMBER`; built-in personal → 409 `PERSONAL_PROFILE` (and the DB CHECK); others become BOOKKEEPER; same state → no-op, no audit. No convert route.
- Decline (D6): clears the request, audited; nothing pending → 404; the owner may ask again.
- `/v1/me` shows `firm`, `role` and `firmRequestedAt` (owner only); audit actions are written.
- Portal: the edit pane's request section (offer / requested / hidden); the DR5 banner shows once and stays dismissed.
- Release-QA: `portal.profiles.firm-request`, `portal.shell.firm-enabled-banner`.

### MUT-301 · portal PDF + QR
- Fixtures: text PDFs (ar/he/en), ZATCA QR images and PDFs, a malformed QR, a scanned PDF with no text layer.
- A ZATCA TLV decode is exact; a malformed QR is ignored without error; a missing field is omitted, never guessed.
- No network during reading (fetch spy).
- The reader chunk isn't in the main bundle (build-manifest test).
- Release-QA: `receipts.pdf-prefill`, `receipts.zatca-qr`, `receipts.unreadable`.

### MUT-302 · VAT on expenses
- Net/VAT/gross add up for exclusive and inclusive treatments.
- An old expense reads "No VAT recorded".
- A non-firm profile shows no VAT row.
- Release-QA: `expenses.vat`.

### MUT-303 · vendor learning
- The third receipt from the same registration no. prefills currency and VAT.
- An edit becomes the new default.
- Profile isolation.

### MUT-304 · portal OCR
- Amount and date hit rates within 5 points of the phone reader on the MUT-253 fixtures.
- Works offline once the model is cached.
- The page stays interactive while reading (worker).

### MUT-305 · roles
- §1 matrix, refusal table and one-derivation tests.
- Last owner: demote and remove both refused.
- A submitter reads only their own expenses and gets no summaries.
- Release-QA: `members.last-owner`, `roles.submitter-nav`.

### MUT-306 · invites
- The response shape is identical for a new and an existing email.
- No User row exists before redemption.
- An existing account never gets SETUP/RESET.
- Expired, used and revoked invites → 410 with state.
- Rate limit.
- Removing a member ends their sessions for that firm.
- `no-self-registration.test.ts` is updated deliberately.
- Release-QA: `members.invite`, `members.accept` (portal + flutter).

### MUT-307 · approval
- §1 totals and creation tests.
- A decision needs the If-Match header.
- Rejecting needs a reason.
- Resubmit after reject → PENDING (DR9).
- A decision in a closed month → 409.
- Turning the setting off leaves PENDING rows pending.
- Release-QA: `approval.flow`, `approval.reject-resubmit`.

### MUT-308/309/310/311 · bills
- §1 double-count, read-only, receipt and VAT-split tests.
- Allocation oldest-due-first.
- Over-allocation → 422.
- Aging buckets per currency.
- The phone outbox shows `PERIOD_CLOSED`.
- Staff bills for out-of-pocket approved expenses only.
- Release-QA: `bills.from-receipt`, `bills.we-owe`.

### MUT-312 · close
- §1 lock and race tests.
- Close only the next month.
- Close blocked by PENDING rows (DR10).
- Reopen is owner-only, needs a reason, and is audited.
- Release-QA: `close.refuse-and-reopen`, `close.blocked-pending`.

### MUT-313 · VAT summary
- §1 basis test.
- Per currency, never summed across currencies.
- Release-QA: `vat.summary`.

### MUT-314 · accountant pack
- Every row with a receipt has its file in the zip, and vice versa.
- UTF-8 BOM on the CSV.
- Arabic and Hebrew survive.
- A 1,000-row month in under 10 s.
- The wording has no "final".
- Release-QA: `pack.download`.

## 3. Commands

- Portal and shared: `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run build` (Node 22, TD-054).
- Server: `npm --prefix server run typecheck`, `npm --prefix server run lint`, `npm --prefix server run openapi:check`, `npm --prefix server test`, and `test:db` in CI.
- Flutter (MUT-306/310 phone parts): `flutter test` plus the iOS Simulator release-QA flows.
