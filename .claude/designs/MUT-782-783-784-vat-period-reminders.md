# MUT-782 / 783 / 784: VAT period reminders and "all receipts sent" (epic MUT-762)

Plan only (2026-11-28). Order: 782 server, then 783 portal, then 784 phone. 783 and 784 are `blocked by` 782 (Backlog); they are planned against 782's contract below and carry `TODO(blocked-by MUT-782)` until it lands. Design assets and the Claude Design brief: `.claude/designs/vat-period/`.

Tracker: Jira · barmajiyat.atlassian.net · MUT via atlassian-barmajiyat · Backlog = not started · finished → In Review (Basel signs off Done).

## What is decided (Basel, 2026-11-28)

- Each client profile carries a VAT period: `MONTHLY`, `BIMONTHLY`, `YEARLY`, `NONE`. Defaults from dealer type (LICENSED 2-monthly, EXEMPT yearly, COMPANY monthly, NONPROFIT none); the accountant can change it per client.
- Email and in-app now; push joins when MUT-780 lands.
- Client taps Done; the accountant confirms or asks for more.

## Facts found in the code that shape the plan

1. **An accountant cannot write through a profile.** ADR-245 d3 refuses every non-GET with `ACCOUNTANT_READ_ONLY` (three layers, the store guard included). So the accountant's two writes (set period, confirm / ask for more) cannot be profile routes. They follow the precedent of `DELETE /v1/clients/{profileId}` (accountants.ts:483): session-only routes under `/v1/clients/{profileId}/…`, authorised by an ACTIVE grant, on the unguarded store, audited on the profile. The client's one write (Done) is a normal owner route on the profile. This needs **ADR-343** (amends ADR-245 d3: "narrow accountant writes live under /v1/clients, never under a profile").
2. **Dealer type is optional.** `dealerType` lives on `IssuerDetails`, which a profile may not have. No issuer details → no default; the period stays unset, nobody is pinged, the desk shows "Set period".
3. **Client = the profile's owners.** Mail goes to the profile's OWNER members; the accountant side is every ACTIVE grant holder (up to 5 per profile), one digest per accountant per day.
4. **A pattern exists.** MUT-767's `runUnclaimedSweep` (keyset pages, `maxPerRun`, per-row try/catch, mail `idempotencyKey`, one digest per accountant per UTC day, job token route, counts only in logs). 782 copies its shape.
5. **Flags.** New dark flag `VAT_PERIOD_REMINDERS` (default false): routes and job answer 404 while off. `ACCOUNTANT_ACCESS` is already on for grants.
6. **Latest ADR is 340**, last migration `20261127230000_mut777_pilot_watch_consent`.

## Open items the tickets did not say (to confirm with Basel or an accountant before build)

- **YEARLY has no stated due date** in the ticket and I could not confirm the statutory date for an exempt dealer's annual filing. Plan: YEARLY pings at the year's end with **no due date in the mail** until confirmed. MONTHLY and BIMONTHLY use the 15th of the next month, 23rd for online filing (pack constant `vat.filingDueDay`, no weekend shift; confirm).
- **Catch-up window.** When the flag turns on, only a period that ended in the last 10 days is announced, so nobody gets a mail for last year.
- **Opt-out.** The client mail carries the existing `/mail-off` page pattern (MUT-535); the accountant's off switch is period `NONE`.
- **Unclaimed provisioned customers are never pinged** (MUT-767 owns them).

---

## MUT-782 Server

### Data (one migration, warn the orchestrator: it restarts the main dev server)

```
enum VatPeriodKind  { MONTHLY BIMONTHLY YEARLY NONE }
enum VatPeriodState { OPEN CLIENT_DONE CONFIRMED MORE_NEEDED }

vat_period_settings   organizationId (PK, CASCADE)  kind VatPeriodKind  setByUserId?  updatedAt
vat_period_records    id  organizationId (CASCADE)  periodKey  state VatPeriodState
                      announcedAt  followUpDueAt  followUpSentAt?
                      doneAt? doneByUserId?  reviewedAt? reviewedByUserId?  note? (200)
                      UNIQUE (organizationId, periodKey)   INDEX (state, followUpDueAt)
```

`periodKey`: `2026-M10` (October), `2026-B5` (September and October; bimonthly numbers run 1 to 6 from January), `2026-Y`. Both tables go in `PURGE_PROFILE_TABLES` (R18). No address or name in audit metadata.

### Where the code goes

| File | Change |
|---|---|
| `server/src/jurisdictions/pack.ts`, `il/vat-periods.ts` (new), `il/index.ts` | `vat.periods`: `defaultKind(dealer)`, `endedPeriods(kind, today)`, `label`, `dueDate(kind, key)`; pure, no I/O. Beside `il/dealers.ts` |
| `server/prisma/schema.prisma` + migration | above |
| `server/src/repositories/ports.ts`, `memory.ts`, `prisma.ts` | `store.vatPeriods`: `settingOf`, `setKind`, `announce` (insert-if-absent, returns true only when inserted), `dueForFollowUp`, `markDone`, `review`, `currentFor(orgId)`, `statesFor(orgIds[])` (one query, no N+1), `sweepRows` (keyset) |
| `server/src/vat-periods/run.ts` (new) | `runVatPeriodSweep` copied from the unclaimed sweep's shape |
| `server/src/routes/vat-period-sweep.ts` (new) | `POST /jobs/v1/vat-periods/sweep`, job token, 404 while the flag is off |
| `server/src/routes/vat-periods.ts` (new) | client and accountant routes below |
| `server/src/routes/accountants.ts` | `/v1/clients` rows gain `vat` (additive) |
| `server/src/email/ports.ts`, `templates/copy.ts`, `look.ts`, `scripts/mail-preview.ts` | templates `vat-period-client` (`reminder` var for the follow-up) and `vat-period-accountant-digest`, ar and en |
| `server/src/config.ts`, `.env.example`, `app.ts` | `VAT_PERIOD_REMINDERS` |
| `server/src/schemas.ts`, OpenAPI | schemas; `openapi:check` |
| `.claude/DECISIONS.md` | ADR-343 |

### Routes (all 404 while the flag is off)

| Route | Who | Does |
|---|---|---|
| `GET /v1/profiles/{profileId}/vat-periods/current` | owner member | the open period or `null`: `{ periodKey, label, due, state, note }` |
| `POST /v1/profiles/{profileId}/vat-periods/{periodKey}/done` | owner member (not an accountant, not a read-only lapsed profile) | `OPEN` or `MORE_NEEDED` → `CLIENT_DONE`; a repeat is 200 and changes nothing |
| `PUT /v1/clients/{profileId}/vat-period` `{ kind }` | ACTIVE accountant | sets the period; applies from the next period; past records untouched |
| `POST /v1/clients/{profileId}/vat-periods/{periodKey}/review` `{ decision: CONFIRMED \| MORE_NEEDED, note? }` | ACTIVE accountant | `OPEN` or `CLIENT_DONE` → the decision; `MORE_NEEDED` sets `followUpDueAt = now + 5d`, resets `followUpSentAt` |
| `GET /v1/clients` | accountant | each row gains `vat: { kind, periodKey, label, due, state, note } \| null` from `statesFor` |

State machine: `OPEN → CLIENT_DONE → CONFIRMED`; `CLIENT_DONE → MORE_NEEDED → CLIENT_DONE`; accountant may confirm straight from `OPEN`. `CONFIRMED` is terminal. Anything else is 409 `VAT_PERIOD_STATE`. Audit: `vat_period.announced`, `.client_done`, `.confirmed`, `.more_needed`, `.kind_set`.

### The sweep (daily, Jerusalem morning, Cloud Scheduler)

```
for each profile with >=1 ACTIVE grant and a claimed owner (keyset pages, maxPerRun):
  kind = setting ?? defaultKind(dealerType) ; NONE or unset -> skip
  key  = latest ended period (org timezone), ended <= 10 days ago, else skip
  announce(org, key) inserted ?  mail each owner (vat-period-client)  + tally for each ACTIVE accountant
  else if state OPEN|MORE_NEEDED and followUpDueAt <= now and followUpSentAt null -> follow-up mail, mark sent
then ONE digest per accountant (idempotencyKey vat-digest:{accountant}:{utc day}): how many announced, how many still waiting
```

`announce` is the idempotency: a second run inserts nothing, so mails nothing. A mail failure is per-row, logged with counts only, and retried by the follow-up. Cost: one keyset scan of profiles that have a grant (small), one mail per owner per period, no per-row N+1 (`statesFor`, batched settings).

### Tests first (Red then Green)

| Test | Proves |
|---|---|
| `jurisdictions/__tests__/vat-periods.test.ts` | period keys and end dates for each kind across a year edge; defaults by dealer; due date; leap and zone edge |
| `vat-periods/__tests__/run.test.ts` | one ping per period, none mid-period; each kind on its own schedule; `NONE` and unset never; second run sends nothing; catch-up window; unclaimed customer skipped; 40 clients one digest; follow-up at +5d once and stops at `CLIENT_DONE` |
| `repositories/__tests__/store-contract-vat-periods.ts` (memory and Prisma) | `announce` insert-if-absent under a race; `statesFor` batch; transitions; purge removes rows |
| `__tests__/routes-vat-periods.test.ts` | client Done only on own open period, repeat is a no-op; accountant confirm needs ACTIVE grant (revoked and other accountant 404); a read-only accountant cannot reach the profile route; flag off is 404; `MORE_NEEDED` re-opens the follow-up; period change leaves past records |
| `email/__tests__/templates.test.ts` | ar and en copy, Levantine months, due date line, no due date for YEARLY |
| Run | `npm --prefix server test -- vat-period`, `typecheck`, `lint`, `openapi:check`; then the **root suite** (src/hosted/local imports server code); `test:db` in CI |

### Release-QA

Server-only: API-level feature in `qa/features/portal/` is carried by 783's spec; 782 adds a route-pin test (`routes-vat-periods.test.ts` pins the access table).

---

## MUT-783 Portal (TODO(blocked-by MUT-782): consumes the routes above)

| File | Change |
|---|---|
| `src/hosted/api/client.ts` | `getCurrentVatPeriod`, `markVatPeriodDone`, `setClientVatPeriod`, `reviewVatPeriod`; `HostedClientRow.vat` type |
| `src/hosted/data/vatPeriodQueries.ts` (new) | `useCurrentVatPeriod(profileId)` (5 min stale, enabled only signed in and not on this device), mutations that invalidate it and `/v1/clients` |
| `src/hosted/pages/home/VatPeriodGroup.tsx` (new) | a group in `WaitingLane` (HomeTodo.tsx:68), under To issue, same row recipe as `OverdueGroup`: period label, due day, one **Done** button; `CLIENT_DONE` / `CONFIRMED` / `MORE_NEEDED` show as a quiet line. No money. Counts toward the calm-line test |
| `src/hosted/pages/client-books/VatBadge.tsx` (new, extends `DeskBadge`'s rule: the word on a colour) | four states, roles per `DESIGN.md`: waiting = neutral, done by client = info/accent, confirmed = success, more needed = warning |
| `ClientBooksPage.tsx`, `CustomerDrawer.tsx`, `ClientBookPage.tsx` | period column and chip on the desk; a **VAT period** drawer by URL key `?vatPeriod=<profileId>`: period select (3 kinds + none), the open period, Confirm and **Ask for more** (note), no drawer on a drawer: panes swap |
| `src/hosted/i18n/*` | ar and en keys; Levantine months through `getLocale`; minimal copy |
| `src/hosted/analytics` | `vat_period_done`, `vat_period_reviewed` through the existing portal analytics (release-only) |
| `.claude/COMPONENT_REGISTRY.md`, `DESIGN.md` | register `VatBadge`, `VatPeriodGroup`; add the chip colour roles |
| `qa/features/portal/accountant-vat-period.yaml`, `qa/specs/portal/accountant-vat-period.spec.ts` | scenarios below; `release-qa lint` clean |

Tests: component tests for the group (open, done, confirmed, more-needed, error, loading, local mode hides it), badge states with words, drawer (confirm, ask with note, period change), rtl snapshot, a11y (live region announces the state change). Local mode: the group never renders (no accountant on this device).

QA scenarios: (1) client sees the open period on home, taps Done once, sees it recorded; (2) accountant sees the client turn "done" on the desk, confirms; (3) accountant asks for more with a note, client sees it and taps Done again; (4) accountant changes a client's period.

## MUT-784 Phone (TODO(blocked-by MUT-782); also build after MUT-773 merges: it owns the desk the chips go on)

Repo `~/Work/Barmajiyat/Mutaba3a/mutaba3a-flutter/mutaba3a`. Existing seams: `lib/data/repositories/client_books_repository.dart`, `lib/domain/models/client_book.dart` (+ freezed), the desk from MUT-773.

- Regenerate the API client from the OpenAPI the server exposes; add `VatPeriod` and `VatPeriodState` to `client_book.dart`; repository methods for the four calls.
- Client home: a card with the period and **Done** (one tap, haptic, the state line after). Accountant desk: state chip on each client row; row tap → bottom sheet with Confirm and **Ask for more** (note field above the pinned primary, keyboard-safe as the phone banner rule says); period sheet.
- RTL: any directional art ships its `-rtl` drawing (no CSS mirror). 375 px and QA iPhone Small (SE) checked.
- Tests: repository and state-machine unit tests; widget tests for the card, chip and both sheets; release QA on iOS through `release-qa` on the shared QA simulators (wait for the device lock, at most 2 booted).

## Self-review (no /plan-eng-review skill is installed here, so this is my own adversarial pass)

- **Biggest risk:** the accountant write path. If it were built on the profile routes it would 403; if built loosely it would let any grant holder write. Mitigation: ADR-343, grant check in one place, tests for revoked and other-accountant 404.
- **Wrong-mail risk:** a period rule error mails real clients. Mitigation: pure pack functions with year-edge tests, flag dark, catch-up window, operator dry run can reuse the mail-preview script.
- **Scope kept out:** push, filing, per-client deadline overrides, weekend shift, owner-set period.
- **Covers every acceptance criterion** of 782, 783, 784. Added beyond the tickets: dark flag, catch-up window, ADR-343, accountant may confirm from OPEN, unset-period handling. These should be noted on MUT-782.

## Business / product impact

- Accountants stop chasing receipts by hand each period, and clients get one clear ask at the right time. It makes the accountant channel (epic MUT-762) something an accountant opens every period, not once.
- Sits after the desk (MUT-768) and sweep (MUT-767) and before push (MUT-780); it is the first recurring reason for an accountant to return.
- Risk: mail to real clients on a wrong date. Contained by the dark flag and the 10-day window.
