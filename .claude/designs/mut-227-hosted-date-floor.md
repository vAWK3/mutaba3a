# MUT-227 — Hosted API: a ten-year floor on money dates

Jira: MUT-227 (Bug, Backlog), relates to MUT-223. Server change, plus one portal message fix (D2).

## 1. Problem and acceptance criteria

The hosted API accepts any valid past `YYYY-MM-DD` for a money date. `0001-01-01`, or 2006 typed for 2026, saves
without a word. Since MUT-223 a settled entry or payment can also be moved there by PATCH, which distorts aging,
`lastPaymentOn` and month views.

Basel's decisions (2026-10-15, on the ticket): the floor is **today − 3660 days in the organization's timezone**, which
mirrors the ten-year ceiling of `assertNotAbsurdDate`. It applies **on create and edit alike**, to **every hosted
money date**, and it answers with the existing **422 `VALIDATION_FAILED` / `reason: DATE_INVALID`** with `field`.

Acceptance criteria (from the ticket):
1. A shared helper rejects a date before today − 3660 (org timezone) with 422 `DATE_INVALID`, `field` set, message
   "`<field>` is more than ten years ago".
2. Every in-scope endpoint applies it on create and on edit. `redateTo` includes it, so both MUT-223 PATCH routes
   inherit it.
3. The boundary is inclusive: today − 3660 is accepted and today − 3661 is rejected. Tests cover both, plus
   `0001-01-01`.
4. Expense list and summary `from`/`to` filters still accept older dates.
5. A row already older than the floor stays readable, and a PATCH that leaves its date alone succeeds.
6. The OpenAPI descriptions mention the floor, the API version is bumped and the server gates pass.
7. DECISIONS.md records the floor.

## 2. Today's date checks (main, e83eec2)

| Endpoint | Field | Today | Auth |
|---|---|---|---|
| `POST /v1/income` (routes/income.ts:54) | occurredOn | iso + not-future | session |
| `PATCH /v1/income/{id}` (income.ts:170) | occurredOn | `redateTo` = iso + not-future | session |
| `POST /v1/receivables/{id}/settle` (receivables.ts:184) | paidAt | iso + not-future | session |
| `PATCH /v1/payments/{id}` (payments.ts:323) | receivedOn | `redateTo` | session |
| `POST /v1/payments` (payments.ts:214) | receivedOn | iso + **ceiling** (`assertNotAbsurdDate`) | **API key (Malafat)**, see D1 |
| `POST /v1/expenses` (expenses.ts:141) | occurredOn | iso only (`expenseDate`) | session |
| `PATCH /v1/expenses/{id}` (`expensePatch`, expenses/compose.ts:90) | occurredOn | iso only | session |
| `POST /v1/conversions` (conversions.ts:68) | occurredOn | iso + not-future | session |
| `PATCH /v1/conversions/{id}` (conversions.ts:139) | occurredOn | iso + not-future | session |
| `POST /v1/inbox`, `PATCH /v1/inbox/{id}` (inbox.ts:99, :130) | occurredOn | iso only (`inboxDate`): no profile, so no timezone | session |
| `POST /v1/inbox/{id}/file-as-income` (inbox.ts:247) | entry.occurredOn | not-future, profile tz | session |
| `POST /v1/inbox/{id}/file-as-expense` (inbox.ts:~180) | entry.occurredOn | none: "filing never stricter than a direct create" | session |
| `GET /v1/expenses`, `GET /v1/expenses/summary` (expenses.ts:93, :334) | from / to | iso only (`expenseDate`) | **must stay iso only** |

## 3. Design

### 3.1 The helper (agreements/compose.ts, beside the ceiling)

```ts
export const DAYS_IN_PAST_LIMIT = 3660;

/** MUT-227: the floor twin of assertNotAbsurdDate — a money date more than ten years back is a typo, not history. */
export function assertNotTooOld(date: IsoDate, today: IsoDate, field: string): void {
  if (compareIsoDates(date, addDays(today, -DAYS_IN_PAST_LIMIT)) < 0)
    throw validationError('DATE_INVALID', `${field} is more than ten years ago`, { field, bound: 'past' });
}
```

It goes next to `assertIsoDate` and `assertNotAbsurdDate` because that is where the date validators already live and
every caller already imports from there. It is a separate constant, not a reuse of `DAYS_IN_FUTURE_LIMIT`: the two
bounds are equal today by decision, not by definition.

`bound` is new and additive (D2). `assertNotFuture` and `assertNotAbsurdDate` gain `bound: 'future'`, so a client
can tell the two refusals apart without redoing date math. `reason` stays `DATE_INVALID`, so the enum doesn't change.

### 3.2 One composite for "a past money date" (income/compose.ts)

Six call sites repeat `assertIsoDate` + `assertNotFuture`: income create, settle, both re-dates, both conversion
writes and income filing. They collapse into one function:

```ts
/** A money date that has already happened: valid, not later than today, not more than ten years back (MUT-227). */
export function pastMoneyDate(raw: string, today: IsoDate, field: string): IsoDate
```

`redateTo` becomes `pastMoneyDate(raw, todayFor(organization, now), field)`. Its other callers are unchanged.

### 3.3 Per call site

- **Income create, settle, conversion create and patch**: swap to `pastMoneyDate`. The conversion PATCH validates
  `conversionDate` in `conversionPatch`, then not-future in the route (conversions.ts:139). That route line becomes
  `pastMoneyDate(patch.occurredOn, todayFor(organization, now), 'occurredOn')`, so the pure patch builder stays
  timezone-free and every income-like site makes the same single call (review D1).
- **Re-dates**: inherit the floor through `redateTo`.
- **`POST /v1/payments`**: `assertNotTooOld` beside the existing ceiling, unless D1 says otherwise.
- **Expenses**: create calls `assertNotTooOld(expenseDate(body.occurredOn), today, 'occurredOn')`.
  `expensePatch(existing, body, today)` gains `today` and applies the floor only when `occurredOn` is sent.
  `expenseDate` itself stays iso-only because the list and summary filters use it (AC 4).
- **Inbox capture and patch**: no profile, so no timezone (inbox/compose.ts's doc comment, ADR-022).
  `inboxDate(value, now)` checks against **UTC today − 1 day**. Every timezone's today is at least UTC today − 1, so
  this floor is never stricter than the one filing applies. `0001-01-01` is still refused at capture, where the phone
  can show it, instead of at filing.
- **Inbox filing**: income filing swaps to `pastMoneyDate`. Expense filing adds `assertNotTooOld` with the profile's
  today, the same as a direct expense create. That keeps "filing never stricter than a direct create" (ADR-048) true
  in both directions.

### 3.4 Existing rows (AC 5)

There is no migration. The floor is checked only on a value the request sends. An expense PATCH without
`occurredOn`, or an inbox PATCH without it, never re-checks the stored date. Filing an inbox entry captured before
the deploy with an ancient date is refused: that is the point, and the entry stays intact to be corrected.

### 3.5 Contract

- `API_VERSION` 1.26.0-mut223 → **1.27.0-mut227** (app.ts:115).
- Field descriptions mention the floor on all the request schemas above. The top-level 422 note in `openapi.yaml`
  documents `details.bound` (`past` | `future`) on `DATE_INVALID`.
- Regenerate with `npm --prefix server run openapi:generate`, then `npm run hosted:types`.

## 4. Reuse (DRY)

`assertNotTooOld` is the floor twin of `assertNotAbsurdDate`, and `pastMoneyDate` replaces six hand-paired checks.
Both reuse `addDays` and `compareIsoDates` from dates.ts and `todayFor` / `todayIn` from existing code. Nothing new
is copied.

## 5. Scale and cost

Pure date arithmetic, with no reads and no new queries. One extra `todayFor` call on the expense routes.

## 6. Tests (written first)

Unit tests (`income/__tests__/compose.test.ts`; agreements compose tests for `assertNotTooOld`):
- `assertNotTooOld`: today − 3660 passes, today − 3661 throws `DATE_INVALID` with `{ field, bound: 'past' }`,
  and `0001-01-01` throws.
- `assertNotFuture` and `assertNotAbsurdDate` now carry `bound: 'future'`.
- `pastMoneyDate`: invalid → DATE_INVALID; future → bound future; too old → bound past; today and the floor day pass.
- `inboxDate`: UTC today − 3661 passes (lenient), and `0001-01-01` throws.
- `expensePatch`: without `occurredOn` there is no check, and an ancient `occurredOn` throws.

Route tests, one refusal plus one boundary pass per group, each in its existing file:
- `income-routes.test.ts` (POST /v1/income)
- `receivables-settle.test.ts` (paidAt)
- `income-redate.test.ts` (both PATCHes)
- `routes-m4.test.ts` (POST /v1/payments, per D1)
- `routes-expenses.test.ts`: create and patch; GET `?from=2001-01-01` still 200; PATCH title on a seeded 2001 row
  still 200
- `routes-conversions.test.ts` (create and patch)
- `inbox-routes.test.ts` (capture lenient vs ancient)
- `inbox-filing.test.ts`: both file routes refuse an entry older than the profile's floor, and the entry survives

Portal (D2): `incomeApiErrors.test.ts` covers DATE_INVALID with `bound: past` → `dateTooOld`; future or missing
bound → `dateFuture`, unchanged.

Gates (Node 22, TD-054):
- Server: `npm --prefix server run typecheck`, `lint`, `openapi:check`, `npm --prefix server test`
- Root: `npm run lint`, `typecheck`, `test:run`, `build`

## 7. QA scenarios (release-qa)

The catalog has no API app, and `server/**` isn't watched (MUT-223 §7). The portal change in D2 is a watched path:
- **portal / income: "A date ten years back is refused with the right message."** Open Add income, type a date in
  2001, save. The date field says it is more than ten years ago, not "later than today". The spec stubs `/v1/income`
  with 422 `DATE_INVALID` + `bound: past`, as the portal specs already do.

## 8. Decisions for Basel (eng review) — all resolved, see Decision ledger

- **D1: `POST /v1/payments` is API-key only.** Malafat is its writer of record, so a floor there would refuse
  Malafat's own historical payments.
- **D2: the clients show the wrong message.** The portal maps every income or settle `DATE_INVALID` to "The date
  can't be later than today". The phone shows "date ahead" (`captureFailedDateAhead`, `recentFileDateAhead`), but its
  MUT-162 auto-retry is bounded to dates near today, so a too-old date fails once and does not loop.
- **D3:** inbox capture's lenient UTC floor (§3.3) instead of filing-only.

## 9. Risks

- MUT-224 (portal re-date drawer) is being planned in a parallel session and will touch `incomeApiErrors.ts`. D2's
  edit there is three lines; whichever merges second rebases.
- The Malafat repo may validate `receivedOn` differently. D1 decides whether that matters.

# Eng review (/plan-eng-review, 2026-10-15)

Target: `.claude/designs/mut-227-hosted-date-floor.md` (this file, §1 to §9 above). Report file: this file.

## Scope record
feature answers: no cuts proposed (D1 in §8, the Malafat `POST /v1/payments` question, resolved by evidence:
Malafat's payment wizard defaults `receivedOn` to today, uses `allowPastDates disallowFutureDates`, and maps
`DATE_INVALID` to a generic message, so the floor costs Malafat nothing and also protects its users; kept in scope);
structure: A, Original arrangement (review D1, answered 2026-10-15); accepted scope: §3 as written; pending remedies: R1 (§8 D2), R2 (§8 D3).

Scope Challenge result: scope accepted as-is.

## Scope Challenge findings
1. [P2] (confidence: 9/10) src/hosted/components/incomeApiErrors.ts:60-61 and :83 — `if (reason === 'DATE_INVALID') { return { fields: [{ field: ..., key: 'hosted.income.errors.dateFuture' }] }`: after the floor, a too-old date on income or settle reads "The date can't be later than today". The phone does the same (`failure_reason_label.dart:38` → `captureFailedDateAhead`, `:58` → `recentFileDateAhead`). Reviewer: Claude. → R1.
2. [P3] (confidence: 8/10) server/src/inbox/compose.ts:31-33 — `export function inboxDate(value: string): IsoDate { return assertIsoDate(value, 'occurredOn'); }`: capture has no profile and so no timezone. A filing-only floor lets `0001-01-01` sit in Unsorted until filing fails. Reviewer: Claude. → R2.

## Decision ledger

### R1: The rejection tells the client which bound failed, and the portal shows the right message
Finding: Scope Challenge #1, P2, confidence 9/10, src/hosted/components/incomeApiErrors.ts:60-61, :83, Claude
Plan baseline: original proposal §3.1 (`details.bound`) + §6 portal test + §7 QA scenario, listed as open D2 in §8; not approved
Runtime evidence: incomeApiErrors.ts maps every income/settle DATE_INVALID to `hosted.income.errors.dateFuture` ("The date can't be later than today" / "لا يمكن أن يكون التاريخ بعد اليوم"); expenses and conversions map to `dateInvalid` ("Enter a valid date"), which stays truthful. Phone: retry is bounded to UTC today ±1 (`outbox_uploader.dart` isOrgDayBehind) so no loop, but the final label says "ahead".
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1 server error says which bound | no: `{ reason: DATE_INVALID, field }` | `details.bound: 'past' \| 'future'` on all three date checks, documented in openapi.yaml | same as A | no change |
| R1 portal income + settle message | "can't be later than today" for every DATE_INVALID | branches on `bound`: past → new `hosted.income.errors.dateTooOld` (en + ar), else `dateFuture`; incomeApiErrors.test.ts rows; portal release-qa feature + spec | unchanged now | unchanged now |
| Phone message (other repo) | "date ahead" | not decided here (follow-up asked at TODO stage) | same | same |
| R2 inbox capture floor | pending | pending | pending | pending |
| D1 structure | approved A | approved A | approved A | approved A |
Question D2:
D2 — Should the 422 say which end of the range failed, and should the portal use it now?
Project/branch/task: main, planning MUT-227 (ten-year floor on hosted money dates).
ELI10: Today the only date error the portal ever gets is "too late", so it always says "The date can't be later than today". After this ticket a typo like 2006 also comes back as the same error code, and the portal would tell the person their 2006 date is in the future. Adding one extra field to the error (`bound: past` or `future`) lets the screen say the right thing.
Stakes if we pick wrong: a person who typed 2006 is told the date is in the future, retypes the same thing, and gets stuck or files a support message.
Recommendation: A because the server field is additive (no new reason, Basel's decision holds) and the portal fix is three lines plus two strings; leaving it for later ships a wrong message.
Completeness: A=9/10, B=6/10, C=4/10
Pros / cons:
A) Add bound + fix portal (recommended)
  ✅ Income and settle in the portal say "more than ten years ago" in English and Arabic from day one
  ✅ Clients branch on a field, never redo the ten-year date math themselves, so the rule lives only on the server
  ❌ Touches portal code that the MUT-224 session is also editing; whichever merges second rebases incomeApiErrors.ts
B) Add bound only, fix clients later
  ✅ Server-only diff, no portal paths, no release-qa spec owed by this ticket
  ✅ Clients can adopt bound whenever MUT-224 or MUT-225 lands
  ❌ Until then the portal says "later than today" for a 2006 typo, a visibly wrong message
C) Do nothing extra
  ✅ Smallest diff; Basel's "keep DATE_INVALID" read in its narrowest sense
  ✅ No contract change at all for Malafat or the phone
  ❌ No client can ever tell the two refusals apart without duplicating the date rule
Net: one additive field plus a three-line portal fix buys a truthful message now, against a smaller server-only diff.
Header: Bound field
Options:
A) Add bound + fix portal (recommended)
Server: assertNotTooOld, assertNotFuture and assertNotAbsurdDate add details.bound ('past' / 'future'), documented in the openapi.yaml 422 note. Portal: incomeApiErrors.ts maps bound past to new key hosted.income.errors.dateTooOld (en + ar) for income and settle; incomeApiErrors.test.ts rows; a portal release-qa feature + passing spec. Effort human ~2h / CC ~15min. Risk: rebase against MUT-224.
B) Add bound only, fix clients later
Server: details.bound as in A, documented. Portal and phone keep their current messages; MUT-224/MUT-225 or a follow-up adopt bound. Effort human ~1h / CC ~5min. Risk: wrong portal message until then.
C) Do nothing extra
No bound field. The portal keeps saying "later than today" for any DATE_INVALID on income and settle. Effort none. Risk: permanent wrong message unless clients duplicate the ten-year rule.

State: approved
Actual answer: A) Add bound + fix portal (review D2, answered 2026-10-15)
Accepted scope: server: assertNotTooOld, assertNotFuture and assertNotAbsurdDate add details.bound ('past' / 'future'), documented in the openapi.yaml 422 note; portal: incomeApiErrors.ts maps bound past to new key hosted.income.errors.dateTooOld (en + ar) for income and settle, with incomeApiErrors.test.ts rows and a portal release-qa feature + passing spec. Phone message not decided here.
History: none

### R2: Inbox capture refuses an ancient date at capture, not only at filing
Finding: Scope Challenge #2, P3, confidence 8/10, server/src/inbox/compose.ts:31-33, Claude
Plan baseline: original proposal §3.3 (lenient UTC floor at capture and inbox PATCH, exact floor at both filings), listed as open D3 in §8; not approved. Filing floor itself is in ticket scope.
Runtime evidence: `inboxDate` is iso-only by design ("an unsorted entry has no organization yet", inbox/compose.ts:22-30); filing-as-income checks not-future in the profile's timezone (routes/inbox.ts:247); filing-as-expense checks nothing (routes/inbox.ts:184-186 comment: "filing must be refused in exactly the places a direct create is").
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R2 floor at inbox capture + PATCH | none (iso only) | refuse before UTC today − 1 − 3660 (never stricter than any profile's floor) | none (iso only) |
| Floor at both filings (ticket scope) | none | profile-timezone floor, as §3.3 | same |
| R1 bound + portal | approved A | approved A | approved A |
| D1 structure | approved A | approved A | approved A |
Question D3:
D3 — Should an Unsorted capture refuse a date like 0001-01-01 right away, or only when it is filed?
Project/branch/task: main, planning MUT-227 (ten-year floor on hosted money dates).
ELI10: An Unsorted entry has no profile yet, so the server cannot know which timezone's "today" to measure ten years from. We can still refuse obvious typos at capture by measuring from a day earlier than any timezone could be, which is never stricter than the real check later. Or we wait until the person files it into a profile, and refuse then.
Stakes if we pick wrong: with filing-only, the phone happily queues a 0001 entry and the person only finds out days later when filing fails, then has to edit it.
Recommendation: A because the person learns about the typo while they are still looking at it, and the one-day slack provably never rejects what filing would accept.
Completeness: A=9/10, B=6/10
Pros / cons:
A) Lenient floor at capture (recommended)
  ✅ 0001-01-01 is refused at the moment of capture, when the person still remembers what they meant
  ✅ UTC today − 1 is at or before every timezone's today, so capture never refuses what filing accepts
  ❌ inboxDate gains a `now` argument and one more boundary to test, beside the exact filing check
B) Floor at filing only
  ✅ Keeps inboxDate exactly as ADR-022 wrote it: no timezone guessing of any kind at capture
  ✅ One rule at one moment, measured in the real profile's timezone
  ❌ A typo waits in Unsorted until filing is refused, which is later and more confusing for the person
Net: a provably safe early refusal against keeping capture free of any date judgment.
Header: Inbox floor
Options:
A) Lenient floor at capture (recommended)
inboxDate(value, now) refuses a date before (UTC today − 1) − 3660 with DATE_INVALID, bound past, at POST /v1/inbox and PATCH /v1/inbox/{id}; both filings apply the exact profile-timezone floor. Tests: lenient boundary passes, ancient refused, filing refuses and keeps the entry. Effort human ~1h / CC ~10min.
B) Floor at filing only
inboxDate stays iso-only; both filings apply the exact profile-timezone floor and keep the entry on refusal. Tests: filing refuses and keeps the entry. Effort human ~30min / CC ~5min.

State: approved
Actual answer: A) Lenient floor at capture (review D3, answered 2026-10-15)
Accepted scope: inboxDate(value, now) refuses a date before (UTC today − 1) − 3660 with DATE_INVALID, bound past, at POST /v1/inbox and PATCH /v1/inbox/{id}; both filings apply the exact profile-timezone floor and keep the entry on refusal. Tests: lenient boundary passes, ancient refused, filing refuses and keeps the entry.
History: none

### R3: TODO: the phone says "date ahead" for a too-old date
Finding: TODO review, P3, confidence 9/10, mutaba3a-flutter lib/presentation/widgets/failure_reason_label.dart:38 (`case 'validationFailed:DATE_INVALID': return willRetry ? l10n.captureWaitingForProfileDay : l10n.captureFailedDateAhead;`) and :58 (`recentFileDateAhead`), Claude
Plan baseline: R1 approved A explicitly left the phone message undecided ("Phone message not decided here").
Runtime evidence: the phone's MUT-162 retry (`outbox_uploader.dart` isOrgDayBehind) only retries dates within UTC today ±1, so a too-old date fails once without looping; its final label is "date ahead". With R1 the server sends `details.bound: 'past'`, which the phone can branch on.
What: the phone shows a "more than ten years ago" message when `details.bound == 'past'`, for an outbox row and for File from Recent.
Why: after MUT-227 a typo like 2006 gets the wrong reason on the phone.
Pros: a truthful message on the phone, matching the portal (R1).
Cons: a separate repo, release and store build; small (two labels, two l10n strings in en + ar, two tests).
Context: start at failure_reason_label.dart:38 and :58; `ApiError` already exposes `reason` and `field`, and `details` needs reading for `bound`.
Depends on / blocked by: MUT-227 server deploy (bound must exist).
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R3 phone too-old message | "date ahead" | follow-up MUT ticket for mutaba3a-flutter, blocked by MUT-227 | nothing filed | built inside MUT-227 in the flutter repo |
| R1, R2, D1 | approved | unchanged | unchanged | unchanged |
Question D4:
D4 — File a follow-up so the phone stops calling a 2006 typo "date ahead"?
Project/branch/task: main, planning MUT-227 (ten-year floor on hosted money dates).
ELI10: The portal fix is in this ticket now, but the phone app is a separate codebase. When the server refuses an old date, the phone shows its "this date is ahead" message, which is wrong. The server will now say which end failed, so the phone only needs to read that and pick the right words.
Stakes if we pick wrong: phone users who mistype a year see a message that points them the wrong way.
Recommendation: A because it is a small, separate-repo change with its own release, and it keeps this ticket to one repo.
Completeness: A=9/10, B=4/10, C=9/10
Pros / cons:
A) Add follow-up ticket (recommended)
  ✅ The fix is tracked in Jira (MUT, Backlog) and linked to MUT-227, so it ships with the next phone release
  ✅ MUT-227 stays one repo, one branch, one review
  ❌ The phone keeps the wrong message until that ticket ships
B) Skip
  ✅ No extra ticket for a rare case (a ten-year typo on the phone)
  ✅ Nothing to coordinate across repos
  ❌ The wrong message stays on the phone indefinitely
C) Build it now in this ticket
  ✅ The portal and the phone get the right message in the same release window
  ✅ No follow-up to remember
  ❌ Spreads MUT-227 across two repos, two branches and an App Store build
Net: a tracked small follow-up against widening this ticket into the flutter repo.
Header: Phone message
Options:
A) Add follow-up ticket (recommended)
File a MUT Story/Bug (Backlog) for mutaba3a-flutter: branch on details.bound == 'past' in failure_reason_label.dart (outbox row + File from Recent), new en + ar strings, two widget tests; linked blocked-by MUT-227.
B) Skip
File nothing; the phone keeps "date ahead" for any DATE_INVALID.
C) Build it now in this ticket
Add the flutter change to MUT-227's scope: same work as A, done on a mutaba3a-flutter branch alongside the server branch.

State: approved
Actual answer: C) Build it now in this ticket (review D4, answered 2026-10-15)
Accepted scope: the flutter change joins MUT-227: branch on details.bound == 'past' in failure_reason_label.dart (outbox row + File from Recent), new en + ar strings, widget tests, on a mutaba3a-flutter branch alongside the server branch. Detailed in §10.
History: none

Approval readiness: PASS. Checked D1 structure (review D1 answer A), R1 (review D2 answer A), R2 (review D3 answer A), R3 (review D4 answer C). Regression contract carried from the ticket's approved AC 4 (expense filters keep old dates) and AC 5 (old rows readable, PATCH without a date succeeds), plus §3.4 (a refused filing keeps the entry).

## 10. Phone lane (mutaba3a-flutter), added by review D4

Repo `/Users/basel/Work/elMokhtbr/Mutaba3a/mutaba3a-flutter/mutaba3a`, its own branch `feature/mut-227-date-floor`.
- `lib/core/api/api_client.dart:213-219` (`_mapError`): read `details['bound']` beside `reason` and `field`, and pass it to
  `ApiError.validationFailed`.
- `lib/core/errors.dart`: `ApiError.bound` (String?). `failureCode` (line 149) returns
  `validationFailed:DATE_INVALID:past` when `reason == 'DATE_INVALID' && bound == 'past'`. Every other code is
  unchanged, so stored rows and today's `validationFailed:DATE_INVALID` case keep working.
- `lib/presentation/widgets/failure_reason_label.dart`: a new case `validationFailed:DATE_INVALID:past` maps to
  `l10n.captureFailedDateTooOld`. `localizeFileFailure` (line 55) returns `l10n.recentFileDateTooOld` when
  `error.bound == 'past'`, before today's date-ahead branch.
- `lib/domain/services/outbox_uploader.dart` `isOrgDayBehind`: return false when `error.bound == 'past'`. This is
  defensive: the UTC ±1 window already excludes such dates, and the test pins it.
- `lib/presentation/l10n/app_en.arb` and `app_ar.arb`: `captureFailedDateTooOld` and `recentFileDateTooOld`, then
  regenerate l10n.
- Tests: `test/core/api_client_test.dart` (422 with `bound` maps it),
  `test/presentation/widgets/failure_reason_label_test.dart` (both new labels, old code unchanged), and an
  `isOrgDayBehind` row.
- Release-QA: a scenario in `qa/features/ios/capture.yaml` ("A ten-year-old date is refused with the right
  message"). It is `manual: true` only if the simulator date picker cannot reach a date ten years back.
- Coordination: the MUT-225 session has an untracked `.claude/designs/mut-225-redate-phone.md` in that repo, and
  MUT-225 will also touch date errors. Whichever merges second rebases.
- Gates: `flutter analyze` and `flutter test`. A deploy order constraint is not needed: without `bound` the phone
  falls back to today's messages.

## Review findings by section

**Architecture:** No issues found. The `bound` detail is additive, so old clients ignore it. Malafat parses only
`reason` and `field` (`payments-service.ts`), and a too-old date falls outside the phone's MUT-162 retry window. The
portal is served by the same server, so they deploy together.
Dispositions: none needed.

**Code quality:** One factual correction, no question needed. §3.3 had the conversion PATCH hand-pairing
`assertNotTooOld` + `assertNotFuture`, which contradicts approved D1. It is corrected to `pastMoneyDate`.
Dispositions: corrected under D1.

**Tests:** see the diagram below. All gaps are covered by planned tests, and no existing test needs changing: the
DATE_INVALID assertions use `toMatchObject` (income-routes.test.ts:179, receivables-settle.test.ts:184,
income-redate.test.ts:194/213, income/__tests__/compose.test.ts:144/197), so an added `bound` field passes.
Dispositions: required proof of approved behavior, carried without a question.

**Performance:** No issues found. Pure date arithmetic, with no reads and no queries.

## Test coverage diagram

```
CODE PATHS                                               USER FLOWS
[+] agreements/compose.ts                                [+] Portal: Add income dated 2001
  ├── assertNotTooOld()                                    ├── [GAP→planned] "more than ten years ago" (en/ar) — portal QA spec
  │   ├── [GAP→planned] floor day passes                   └── [★★ TESTED] future date → "later than today" — incomeApiErrors.test.ts
  │   ├── [GAP→planned] floor−1 throws, bound past       [+] Portal: Settle with paidAt 2001
  │   └── [GAP→planned] 0001-01-01 throws                  └── [GAP→planned] dateTooOld on paidAt — incomeApiErrors.test.ts
  ├── assertNotFuture()/assertNotAbsurdDate()            [+] Phone: capture dated 2006
  │   └── [GAP→planned] carry bound future                 ├── [GAP→planned] outbox row label "too old", no retry
[+] income/compose.ts                                      └── [GAP→planned] File from Recent label "too old"
  ├── pastMoneyDate()                                    [+] Old data
  │   ├── [GAP→planned] invalid / future / too old / ok    ├── [GAP→planned] expense PATCH title on 2001 row → 200
  └── redateTo() → pastMoneyDate                           └── [GAP→planned] GET /v1/expenses?from=2001-01-01 → 200
      └── [★★★ TESTED] future refusal — income-redate:194
[+] inbox/compose.ts inboxDate(value, now)
  ├── [GAP→planned] UTC today−3661 passes (lenient)
  └── [GAP→planned] 0001-01-01 refused
[+] routes (one refusal + one floor-day pass per group)
  ├── POST /v1/income, settle, PATCH income/payments   [GAP→planned]
  ├── POST /v1/payments (API key)                       [GAP→planned]
  ├── expenses create/patch, conversions create/patch   [GAP→planned]
  └── inbox capture/patch, file-as-income/-expense      [GAP→planned, entry survives refusal]

COVERAGE today: 2/24 paths (8%), planned: 24/24
QUALITY after plan: unit ★★★ on helpers, route ★★ per group | GAPS remaining: 0 | E2E: portal + phone QA scenarios
```

## NOT in scope
- Date-picker minimums in the portal and on the phone: the server is the guard (ticket scope out).
- Agreement, fee-proposal and due dates: they keep the ceiling only (ticket scope out).
- Expense list and summary `from`/`to` filters: they are queries, not money dates (ticket AC 4).
- Migrating or flagging existing rows older than the floor (ticket AC 5).
- The local web app (Dexie): no server write path.

## What already exists
- `assertNotAbsurdDate` and `DAYS_IN_FUTURE_LIMIT` (agreements/compose.ts:152-156): the ceiling twin. Reused as the
  model, not modified beyond `bound`.
- `assertNotFuture` and `redateTo` (income/compose.ts:118-140): wrapped by `pastMoneyDate`.
- `todayFor` and `todayIn`, `addDays` and `compareIsoDates` (dates.ts): all the date arithmetic.
- The phone's `failureCode` convention (errors.dart:149) and its MUT-162 window: extended, not rebuilt.

## Failure modes
| New path | Realistic failure | Test / handling | User sees |
|---|---|---|---|
| Floor in a route | Off-by-one at the boundary (exclusive vs inclusive) | floor-day pass + floor−1 refusal per group | clear 422 |
| Org timezone | Floor measured in UTC instead of the profile's zone | route tests use a non-UTC org fixture at the boundary | clear 422 |
| Inbox capture | Lenient floor stricter than filing for some zone | unit test at UTC today−3661 passes | n/a |
| Expense filters | `expenseDate` gains the floor by mistake | GET `?from=2001-01-01` → 200 | silent empty list if broken; covered |
| Phone | `failureCode` change breaks stored rows | label test keeps `validationFailed:DATE_INVALID` | clear label |
No critical gaps: every failure has a planned test, and each one surfaces as a clear error.

## Worktree parallelization strategy
| Step | Modules touched | Depends on |
|------|----------------|------------|
| S1 server floor + bound | server/src (agreements, income, expenses, inbox, routes, app.ts, schemas.ts), server/openapi | — |
| S2 portal message | src/hosted (components, i18n, api/schema.d.ts), qa/ | S1 (regenerated types) |
| S3 phone message | mutaba3a-flutter lib/, test/, qa/ | S1 contract only (field name `bound`) |

Lane A: S1 → S2 (one mini-crm worktree). Lane B: S3 (mutaba3a-flutter worktree).
Execution order: launch A and B together, since B needs only the agreed field name. Merge A, then B.
Conflict flags: S2 touches `incomeApiErrors.ts`, which MUT-224 also edits. S3 touches the phone's date errors,
which MUT-225 also handles.

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or
Codex, and tick each box as it ships.

- [ ] **T1 (P1, human: ~3h / CC: ~20min)** — server — Add `assertNotTooOld`, `pastMoneyDate` and `bound`, then wire every in-scope site
  - Surfaced by: Ticket AC 1-3, review D1, §3.3 correction
  - Files: server/src/agreements/compose.ts, income/compose.ts, expenses/compose.ts, inbox/compose.ts, routes/{income,receivables,payments,expenses,conversions,inbox}.ts
  - Verify: `npm --prefix server test` (Node 22)
- [ ] **T2 (P1, human: ~2h / CC: ~15min)** — server tests — Unit and route tests from §6 and the diagram, written first
  - Surfaced by: Test review diagram
  - Files: server/src/income/__tests__/compose.test.ts, server/src/__tests__/{income-routes,receivables-settle,income-redate,routes-m4,routes-expenses,routes-conversions,inbox-routes,inbox-filing}.test.ts
  - Verify: `npm --prefix server test`
- [ ] **T3 (P1, human: ~1h / CC: ~10min)** — inbox — `inboxDate(value, now)` lenient floor plus exact filing floors
  - Surfaced by: R2 (review D3)
  - Files: server/src/inbox/compose.ts, server/src/routes/inbox.ts
  - Verify: inbox-routes and inbox-filing tests
- [ ] **T4 (P1, human: ~1h / CC: ~5min)** — contract — API 1.27.0-mut227, field descriptions, 422 `bound` note, regenerate
  - Surfaced by: Ticket AC 6, R1
  - Files: server/src/app.ts, server/src/schemas.ts, server/openapi/openapi.yaml, src/hosted/api/schema.d.ts
  - Verify: `npm --prefix server run openapi:check`, `npm run typecheck`
- [ ] **T5 (P2, human: ~2h / CC: ~15min)** — portal — `dateTooOld` on income and settle, with en + ar strings, tests and a QA spec
  - Surfaced by: R1 (review D2)
  - Files: src/hosted/components/incomeApiErrors.ts, src/hosted/i18n/{en,ar}.json, src/hosted/components/__tests__/incomeApiErrors.test.ts, qa/features/portal/*.yaml, qa/specs/portal/*.spec.ts
  - Verify: `npm run test:run`, `release-qa run --attach --only <id>`, `release-qa lint`
- [ ] **T6 (P2, human: ~3h / CC: ~20min)** — phone — `bound` parsing, the too-old labels, l10n, tests and a QA scenario
  - Surfaced by: R3 (review D4)
  - Files: see §10
  - Verify: `flutter analyze`, `flutter test`
- [ ] **T7 (P2, human: ~1h / CC: ~10min)** — knowledge — ADR addendum and the knowledge files
  - Surfaced by: Ticket AC 7, CLAUDE.md protocol
  - Files: .claude/DECISIONS.md, CHANGELOG.md, PATTERNS.md (date-bound helpers), TEST_PLAN.md
  - Verify: read-through

## Unresolved decisions
None.

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is
- Architecture Review: 0 issues found
- Code Quality Review: 1 issue found (factual correction under D1)
- Test Review: diagram produced, 22 gaps identified (all planned)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 1 item proposed to user (R3, built in this ticket)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (CLI not installed; native fallback needs TaskOutput, absent in this session)
- Parallelization: 2 lanes, 2 parallel / 1 sequential within lane A
- Lake Score: 0/3 = no option scored 10/10; all three answers (D2 A, D3 A, D4 C) took the highest-scored option (9/10)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex via `/plan-eng-review` | Independent 2nd opinion | 1 | unavailable | CLI not installed; no native fallback (no TaskOutput) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open (all resolved into tasks) | 23 issues (1 code quality + 22 planned test gaps), 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable (codex CLI not installed). No outside findings; missing coverage, not a clean pass.
- **VERDICT:** no review CLEAR (Eng Review is issues_open: its findings are planned work T1 to T7, none left open); eng review required → satisfied by this run's resolved decisions; ready to implement.

NO UNRESOLVED DECISIONS
