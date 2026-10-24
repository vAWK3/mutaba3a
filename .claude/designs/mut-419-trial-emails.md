# MUT-419: Trial emails (3 days left, read-only, 3 days before the lock), en/ar

Epic MUT-322 (pilot-ready). Blocked by MUT-359 (mailer, merged eab9f735) and related to MUT-361 (lapse gate, merged
b62b7961). Uses MUT-358's resolver and MUT-418's trial start. Server only. Planned 2026-10-24 in the self-service
portal run (unattended: every decision below is **pending Basel's confirmation**).

## 1. Problem and acceptance criteria

ADR-160 D3: a 14-day trial with no card, then read-only until day 30, then locked. Someone who never opens the portal
in that time gets no warning before losing write access, and none before the lock. Nothing mails them today.

From the ticket:

- **A1** With `MAILER=memory` and a fixed clock, each stage sends exactly once, and never to a covered, paying or
  suppressed account.
- **A2** Re-running the job on the same day sends nothing new.
- **A3** Both languages are pinned by tests.
- **A4** Server gate: typecheck, lint, `openapi:check`, tests.
- Scope also names an operator dry run: `npm --prefix server run billing:trial-mail -- --dry-run` lists who would get what.

Out of scope: paid-lapse mail (Stripe's dunning covers it), marketing mail, a portal change.

## 2. The stages (one rule, from `trialTimelineOf`)

`stage(now)` is pure, from `trialTimelineOf(trialStartedAt)` (`endsAt` = day 14, `lockAt` = day 30):

| Stage | Window | Mail | Links |
|---|---|---|---|
| `ending-soon` | `endsAt − 3 d ≤ now < endsAt` (day 11–14) | "Your free trial ends within N days" | Add a card → `/?billing=true&step=subscribe` |
| `ended` | `endsAt ≤ now < lockAt − 3 d` (day 14–27) | "Your account is read-only. Your records are safe; subscribe to keep adding them" | Subscribe, Download my records → `/?yourData=true` |
| `locking-soon` | `lockAt − 3 d ≤ now < lockAt` (day 27–30) | "Your account locks within N days. You can still download all your records" | Subscribe, Download my records |

Before day 11 and from day 30 (LOCKED): nothing.

- **D1** A stage is a **window**, not an exact day, and only the **current** stage is sent. A missed day (an outage, mail
  turned on mid-trial) catches up on the next run, and a person never gets a stale mail ("3 days left" on day 20).
  Someone who skipped a stage's window entirely just doesn't get that one.
- **D2** (amended by outside voice R7) `N` is the whole days left, rounded up (1–3), and the copy says **"within N
  days"** ("ends within 3 days"), never "in N days": a deadline warning must not promise more time than there is, and
  "within" stays true for any time of day the job runs. A day count is not a date (ADR-159 §5 forbids dates and
  amounts; `validHours` is the precedent for a count).
- **D3** Idempotency key `trial:<userId>:<stage>` (ticket). The mailer's send log is the record: a second run in the
  window answers `duplicate`. The log keeps 30 days; a stage's window is at most 13 days, so a pruned key can never
  come back into its window.

## 3. Who is mailed

Candidates: people with `status = ACTIVE` and `trialStartedAt` in `(now − 30 d, now − 11 d]`, one indexed-free read on
`users` (`billing.trialMailCandidates`). PENDING_REVIEW people have no trial until approved (MUT-367 D1), so they are
never candidates; DISABLED people are skipped too.

For each candidate: **every profile they are a member of** (`memberProfilesForBilling`), then one `entitlementsFor`
read. (Amended by outside voice R4.) The mail goes out only if **every** one of those profiles is the person's own
(`profileOwnerOf(org) === userId`) and resolves with **source TRIAL**: then the trial alone decides the person's
standing (gate.ts `personStanding` is the best across all their profiles), so "your account is read-only" and "your
account locks" are exactly what the gate will do. Otherwise the person is skipped:

- `STRIPE` (a card is on file: Checkout with a trial is a `trialing` subscription, MUT-418; or a paid one) → skip `paying`;
- `MALAFAT` / `OPERATOR` (pre-billing grants included) → skip `covered`;
- any other profile they belong to that the trial doesn't decide (a firm, someone else's profile, a `NONE` profile
  that is read-only for ever) → skip `other-profiles`: their standing doesn't follow this trial, so the account-wide
  wording would be wrong. They still see the portal's per-profile banners (MUT-361).

When both apply, `paying` wins over `covered`, which wins over `other-profiles`.

The run also pauses (every row skipped `gate-off`) when the lapse gate is off (`BILLING_GATE=false`, outside voice R5):
then nothing goes read-only or locks, so the mails would be false.

Then the address: `store.email.isSuppressed` → skip `suppressed` (the mailer checks it again at send time anyway).

- **D4** The rule is "source TRIAL on an owned profile", not `trialPrompt.welcomeAnswer`: accepting the card step and
  then abandoning Checkout leaves no card, so that person still needs the reminder. The subscription is the truth.
- **D5** A lapsed Stripe payer resolves STRIPE READ_ONLY, never TRIAL, so paid-lapse mail is excluded by the same rule
  (ticket "Scope (out)").
- **D6** The language is the person's `locale` (ADR-077: Arabic by default).

## 4. The run, the job and the operator

New module `server/src/billing/trial-mail.ts`:

- `trialMailStageOf(trialStartedAt, now) → { stage, daysLeft } | null` (pure);
- `planTrialMail(store, now) → TrialMailPlanRow[]` (`{ userId, email, locale, stage, daysLeft, action: 'send' | 'skip', reason? }`);
- `runTrialMail({ store, mailer, logger, now, origin, dryRun }) → { summary, rows }`. A dry run plans only and mails
  nothing. A real run sends each `send` row one at a time and records the outcome (`sent`, `duplicate`, `suppressed`,
  `capped`, `disabled`, `failed`, `refused`).

Doors, following MUT-360's reconcile (`routes/stripe-billing.ts`), in a new `routes/trial-mail.ts`:

- `POST /jobs/v1/billing/trial-mail`: Cloud Scheduler, `X-Job-Token` (the existing `jobAuth` on `/jobs/*`). Answers
  **counts only** (no addresses in Scheduler logs). Always 200 once it ran.
- `POST /admin/v1/billing/trial-mail` `{ dryRun: boolean }`: the operator. Answers counts plus the rows.
- CLI `billing-trial-mail [--dry-run]` in `scripts/users.ts`, npm script `billing:trial-mail`. Prints one line per row
  (`would send|sent|skip <stage> <email> (<reason>)`) and the totals.

Links use the same origin every mail uses (`setupLinkOrigin(PORTAL_ORIGIN, requestUrl)`), so the job's links point at
the portal host, not the Cloud Run URL, wherever `PORTAL_ORIGIN` is set.

- **D7** The scheduler is **Cloud Scheduler on `/jobs`**, as the ticket says ("the same scheduler as MUT-360's nightly
  reconcile"), not MUT-367's in-process timer: Cloud Run throttles CPU between requests, so a daily in-process timer can
  be late or skipped (TD-215). Terraform `google_cloud_scheduler_job.trial_mail`, daily at **10:00 Asia/Jerusalem**
  (a reminder at a waking hour, not the reconcile's 03:30), `attempt_deadline` 280 s, retry 3.
- **D8** (amended by outside voice R5/R6) The job exists only when `mailer = "resend"` **and** `stripe_enabled` **and**
  `billing_gate_enabled`: with mail off every send is `disabled`; without Stripe the Subscribe links lead to a drawer
  the server answers 503; with the gate off the mails would be false. Both doors also answer 503
  `BILLING_NOT_CONFIGURED` without Stripe, like the reconcile. Merging changes nothing in production while mail is off.
- **D9** Always 200 when the run finished, even with some `failed` sends: a retry would only resend the failed ones,
  and the next day's run does that anyway inside the window (≥ 3 days). The mailer already logs every failure. No new
  alert (TD below).
- **D10** No overlap guard: the mailer serializes claims and the key is per person and stage, so two runs at once send
  each mail once. (MUT-360 needed one because reconcile writes the mirror; this only mails.)
- **D11** Trial mails are **outside the per-recipient cap** (`RECIPIENT_CAP_EXEMPT`), like the review outcomes: only
  the server sends them, at most one a day per person, and a stranger requesting signup links for the address must not
  cap away the lock warning. They do count toward the global daily cap, outside the recovery reserve.
- **D12** Sends go one at a time (sequential), not in parallel: the mailer serializes claims anyway, and the run is
  small (people in days 11–30 of a trial). R1: the run stops starting sends after 200 s of elapsed time (measured by
  its own monotonic clock, not the business clock, outside voice R9) and reports `incomplete: true`.
- **D15** (outside voice R10) The job token now also triggers customer mail. A leaked token can only re-run idempotent
  mail; main.tf's comment and ADR-182 say so.
- **D16** (outside voice R11) A real operator run refuses (409 `LINK_ORIGIN_LOOPBACK`) when its links would point at a
  loopback origin (no `PORTAL_ORIGIN`, called through a local proxy) in production. Dry runs still answer.

## 5. Templates (MUT-359 set)

`TEMPLATE_IDS` gains `trial-ending-soon`, `trial-ended`, `trial-locking-soon`; `TemplateVars`:

```ts
'trial-ending-soon': { daysLeft: number; subscribeLink: string };
'trial-ended': { subscribeLink: string; exportLink: string };
'trial-locking-soon': { daysLeft: number; subscribeLink: string; exportLink: string };
```

`copy.ts`, en and ar, the portal's own words where they exist (`hosted.billing.gate.*`, `trialBanner.*`): "free trial /
تجربتك المجانية", "read-only / للقراءة فقط", "Subscribe / اشترك", "Download my records / نزّل سجلاتي", "Add a card /
أضف بطاقة", locks / يُقفَل. Arabic day counts agree with their number (يوم واحد / يومين / 3 أيام). No amount, no
price, no date, no tracking (the layout has no images or pixels; links carry no UTM).

- **D13** The ending-soon mail does not promise "you won't be charged until …": in the trial's last 48 h Checkout
  can't defer the charge (MUT-418 `chargeDeferred`), and the mail is sent in the last 3 days.
- **D14** Wording says "your account", matching the ticket; the portal's banners say "this profile" because they are
  per profile.

## 6. Files

- `server/src/billing/trial-mail.ts` (new): stage rule, plan, run.
- `server/src/email/ports.ts`, `templates/copy.ts`: three templates, cap exemption.
- `server/src/repositories/ports.ts`, `memory.ts`, `prisma.ts`: `billing.trialMailCandidates({ startedAfter, startedBefore })`,
  with `auth/store-guard.ts` (`'operator'`) and the shared `store-contract-billing.ts` (outside voice R8).
- `server/src/routes/trial-mail.ts` (new), `app.ts` (mount, API version), `schemas.ts` (`TrialMailRunSchema`,
  `TrialMailRequestSchema`), `openapi/openapi.yaml` (regenerated).
- `server/src/scripts/users.ts`, `server/package.json` (`billing:trial-mail`).
- `server/infrastructure/terraform/main.tf` (or `email.tf`) + `tests/trial_mail.tftest.hcl`.
- Route-security / public-surface pins, if they enumerate `/jobs` and `/admin` routes.
- Docs: `server/DEPLOYMENT.md` §6f, `docs/operations/before-release.md`, `.claude/` knowledge files.

## 7. Tests (TDD) → acceptance criteria

`server/src/billing/__tests__/trial-mail.test.ts` (MemoryLedgerStore, `MemoryMailTransport` + `createMailer`, fixed clock):

1. `trialMailStageOf` at day 10.9 (null), 11 (ending-soon, 3), 13.5 (ending-soon, 1), 14 (ended), 26.9 (ended),
   27 (locking-soon, 3), 29.9 (locking-soon, 1), 30 (null). (A1)
2. Walking one person's clock from day 0 to 31, a run each day: exactly three mails, one per stage, in order, with
   the right template and key. (A1)
3. Running twice on the same day: second run sends nothing (`duplicate`). (A2)
4. Skips: a `trialing`/active Stripe subscription (paying), an operator grant (covered), a Malafat-connected owned
   profile only… (covered), a suppressed address (suppressed), PENDING_REVIEW and DISABLED people (not candidates). (A1)
5. A lapsed Stripe payer in days 14–30 gets nothing. (scope out)
6. Locale: an `en` person gets English, an `ar` person Arabic. (A3)
7. Dry run: lists the would-send and skipped rows, mails nothing, and a real run afterwards still sends.
8. Mailer `noop`: every row `disabled`, and a later run with mail on still sends (nothing was claimed).

`server/src/email/__tests__/templates.test.ts`: the three new ids join `SAMPLE`/`NUMERIC_VARS`; the existing
per-template checks (en/ar, RTL, only passed links, no amount/currency/date) cover them; plus Arabic day agreement and
the links in each mail. (A3)

`server/src/__tests__/routes-trial-mail.test.ts`: the job route needs the job token (401 without, 503 when jobs are not
configured) and answers counts with no address; the admin route needs the admin token, dry run mails nothing, real run
mails; links use `PORTAL_ORIGIN`. CLI test beside the existing `users` CLI tests.

Terraform: `tests/trial_mail.tftest.hcl` (mocked providers): no job with `mailer = "noop"`; with `resend`, one daily
job at 10:00 Asia/Jerusalem posting to `/jobs/v1/billing/trial-mail` with the job token.

Run: `npm --prefix server run typecheck|lint|openapi:check|test`; root lint + typecheck (the CLI/openapi types reach the
portal's generated schema).

## 8. QA scenarios

Server only: no screen changes, so there is **no release-QA flow** (no `qa/features` entry). The acceptance criteria are
proven by the server tests in §7, which drive the real mailer with the memory transport and a fixed clock. Recorded on
Jira.

What a person sees, for a reviewer:

1. Day 11 of a trial with no card → one mail, "Your free trial ends within 3 days", button **Add a card** → the portal's
   Subscribe step (after sign-in if needed).
2. Day 14 → "Your account is read-only", **Subscribe** and **Download my records**.
3. Day 27 → "Your account locks within 3 days", the same two links.
4. Added a card on day 12 → no further mail.

## 9. Reuse, impact, cost, i18n

- Reuse: `trialTimelineOf`, `resolveEntitlement`/`entitlementsFor`, `memberProfilesForBilling`, `createMailer`,
  `setupLinkOrigin`, `jobAuth`, the reconcile's door pattern, the users CLI.
- Impact: additive. No migration (reads `users.trialStartedAt`). API version 1.61.0-mut419 (two new operator/job
  routes; nothing on `/v1`). Off in production until `mailer = "resend"` (the job isn't created).
- Cost: one `users` read a day, then per candidate 3–4 small reads (memberships, organizations, integrations, billing
  facts). Candidates are only people in days 11–30 of an unpaid trial. Mail volume ≤ 3 per trial person. Cloud
  Scheduler: one more job (free tier covers 3 jobs per billing account; this is the second).
- i18n: en/ar copy in `copy.ts` (no i18n library on the server, MUT-359 precedent).

## 10. Decisions (all pending Basel's confirmation)

D1–D14 above. ADR-182 records the trial-mail rule (stages as windows, trial-decides-the-account eligibility, Cloud Scheduler, the
job token's wider reach).

## 11. Tech debt

- TD-223: no alert on the trial-mail job's failed attempts (the reconcile has one); the mailer logs each failed send.
- TD-224: the candidate read and the per-person reads are N+1 (fine for a daily run over trial people; batch them if
  trials grow to thousands).

## 12. Business / product impact

- A person who never opens the portal is warned before losing write access and before the lock, with a way to pay and
  a way to take their records: fewer surprised, angry ex-trialists, more conversions at day 11.
- Last notification piece of the self-service GA (MUT-322); signup opens only after this exists.
- Cheap and off until mail is on: one daily job, at most three mails per trial.

## 13. Eng review (2026-10-24, /plan-eng-review, unattended)

Target: this plan. No human was available (self-service run rules): every choice below took the recommended option
and is **pending Basel's confirmation**.

### Scope Challenge

- Already exists: `trialTimelineOf` + `resolveEntitlement` (billing/entitlement.ts:51, :103), `entitlementsFor` /
  `memberProfilesForBilling` (billing/coverage.ts:17, :31), `createMailer` claims and idempotency (email/mailer.ts:74),
  `setupLinkOrigin` (auth/account-setup.ts:49), `jobAuth` on `/jobs/*` (app.ts:285), the reconcile's two doors
  (routes/stripe-billing.ts:107-140), the users CLI (scripts/users.ts). Nothing re-implements them.
- Complexity: about 16 changed files and 2 new modules (`billing/trial-mail.ts`, `routes/trial-mail.ts`): the gate trips.
  Structure question (`plan-eng-review-structure`): A) Original arrangement (one rule module, one route module with
  both doors, like stripe-billing.ts) vs B) Smaller arrangement (no route module: both doors added to
  admin-billing.ts and stripe-billing.ts). **Auto-decided A** (recommended: the doors share one handler and one schema;
  splitting them across two unrelated route files couples trial mail to Stripe). Pending Basel.
- Scope record: feature answers none (no cuts proposed); structure A; accepted scope = §2–§7; pending remedies none.
- Result: **scope accepted as-is**.
- TODOS.md: nothing blocks or overlaps this plan.

REALITY: premise-table pass 9 claims, unverified=0 (entitlement.ts:51 trialTimelineOf; coverage.ts:31; mailer.ts:117 claim; review-digest.ts:60 hour key; stripe-billing.ts:118 job path; main.tf:781 scheduler; domain.tf:31 PORTAL_ORIGIN; filters.ts:283 yourData key; router AuthGate.tsx:73 next)
REALITY: already-done pass no trial-mail code on main (git log 97c0c947; grep trial-mail none) server/src/billing/
REALITY: surface-check pass `/jobs/*` jobAuth app.ts:285; `billing-*` CLI verbs scripts/users.ts:51; npm script names package.json:46-54
REALITY: binding-decisions pass ADR-159 §5 no amounts/dates (ports.ts:7), ADR-160 D3 timeline (entitlement.ts:31), ADR-077 Arabic default (copy.ts:6), MUT-418 D14 `/` keeps drawer keys
REALITY: numbers pass 14/30-day timeline from TRIAL_DAYS/TRIAL_LOCK_DAYS [measured: entitlement.ts:31-32]; 3-day lead [ticket]; 280 s deadline [measured: main.tf:790]; mail log 30 d [measured: index.ts:79]
REALITY: deferred-asks pass every ticket ask is planned (three stages, skips, en/ar, dry run, scheduler)
REALITY: pr-count pass one branch, merged locally (run rules), no PR

### Findings and decisions

1. `[P2] (confidence: 8/10) plan §4 D12` — sends run one at a time inside a Cloud Scheduler request whose attempt
   deadline is 280 s (main.tf:790 `attempt_deadline = "280s"`). Resend takes ~0.2–1 s a send, so a few hundred
   reminders on one day could outlive the request; the reconcile stops itself at ~200 s for this reason
   (main.tf:778-779). **R1** add a time budget: stop starting sends after 200 s, report `incomplete: true` and the
   counts; the rest go out on the next run (every window is ≥ 3 days). Options: A) add the budget (recommended,
   Completeness 10/10, CC ~10 min); B) no budget (7/10). **Auto-decided A**, pending Basel.
2. `[P3] (confidence: 7/10) domain.tf:31` — without the front door, Cloud Run has no `PORTAL_ORIGIN`, so the job's
   links use the Cloud Run host it was called on (`setupLinkOrigin`, account-setup.ts:50-53). That host serves the
   portal (and the legacy redirect sends it on once MUT-326 is staged), so the link works. Same behaviour as every
   other mail. **No change**; noted for MUT-326.
3. `[P3] (confidence: 8/10) monitoring.tf` — the reconcile's failed attempts page (main.tf:780); the trial job has no
   alert. Kept as TD-223 (plan §11). **R2** A) TD only (recommended: a missed day catches up inside the window;
   failed sends are logged per mail) B) add an alert policy now. **Auto-decided A**, pending Basel.
4. Test gap `[P2] (confidence: 8/10) plan §7` — no test pins the daily-run rounding (job at 10:00, trial started at
   10:30: day 11's run is outside the window, day 12's says 3 days). **R3** add it as rows of the stage table test.
   Auto-decided include (recommended), pending Basel.
5. Test gap `[P2] (confidence: 7/10) plan §7` — the time budget (R1) needs a test: a clock that advances past 200 s
   mid-run stops sending, reports `incomplete`, and the next run sends the rest once. Included with R1.

Architecture: findings 2, 3. Code quality: no issues found (one rule module, one door module, no new pattern beyond
MUT-360's). Tests: findings 4, 5. Performance: finding 1; the per-candidate reads are N+1 (4 small reads each) over
people in days 11-30 of an unpaid trial only [estimated: tens at pilot scale], TD-224.

### Test coverage diagram

```
CODE PATHS                                              USER FLOWS
[+] billing/trial-mail.ts                               [+] Trial person, no card
  ├── trialMailStageOf()                                  ├── [PLANNED ★★★] day 11 "ends in 3 days" + Add a card
  │   ├── before day 11 / from day 30 → null              ├── [PLANNED ★★★] day 14 read-only + Subscribe + Download
  │   ├── ending-soon / ended / locking-soon              ├── [PLANNED ★★★] day 27 "locks in 3 days"
  │   └── daysLeft rounding (R3)                          └── [PLANNED ★★★] adds a card on day 12 → nothing more
  ├── planTrialMail()                                   [+] Operator
  │   ├── candidates: ACTIVE only, window only            ├── [PLANNED ★★] dry run lists, mails nothing
  │   ├── source TRIAL on an owned profile → send         └── [PLANNED ★★] real run from the CLI
  │   ├── STRIPE → paying, MALAFAT/OPERATOR → covered   [+] Scheduler
  │   └── suppressed address → skip                       ├── [PLANNED ★★★] same day twice → duplicate only
  └── runTrialMail()                                      └── [PLANNED ★★] no token 401, jobs off 503
      ├── dryRun → no send
      ├── outcomes sent/duplicate/disabled/failed
      └── time budget → incomplete (R1)
[+] email templates ×3 en/ar                            [PLANNED ★★★] existing per-template table + day agreement
[+] terraform trial_mail job                            [PLANNED ★★] tftest noop → none, resend → one daily job
COVERAGE (planned): 100% of new paths have a planned test; no E2E (server only, no UI), no eval.
```

### NOT in scope

- Paid-lapse mail (Stripe dunning), marketing mail, a "you are locked" mail (ticket lists three stages only).
- A portal change: the links reuse MUT-362/418 drawer keys.
- An alert on the job (TD-223).

### Failure modes

| Path | Failure | Covered by | User sees |
|---|---|---|---|
| Scheduler → job | mail provider down | mailer `failed` per send; next day retries inside the window | a reminder a day late |
| Scheduler → job | request outlives 280 s | R1 budget stops at 200 s, `incomplete` | the rest a day later |
| plan | DB unreachable | the route throws 500, Scheduler retries (retry 3) | nothing, retried |
| send | address suppressed / capped | skipped / `capped` logged | no mail (correct for suppressed) |
| mail off (noop) | every send `disabled` | test 8; no claim, so turning mail on sends | nothing until mail is on |

No critical gaps (every failure is either retried or logged).

Worktree parallelization: sequential implementation, no parallelization opportunity.

### Decision ledger

- D-structure: original arrangement (A). Auto-decided, pending Basel.
- R1: time budget 200 s (A). Auto-decided, pending Basel.
- R2: alert deferred to TD-223 (A). Auto-decided, pending Basel.
- R3: rounding rows in the stage test. Auto-decided, pending Basel.

Approval readiness: PASS (D-structure, R1, R2, R3: unattended-run defaults per the run rules, pending Basel).

### Outside voice (Claude Plan subagent, native fallback; Codex is not installed)

Completed inside the five-minute window. Nine findings; dispositions (all auto-decided per the run rules, **pending
Basel**):

| # | Sev | Finding | Disposition |
|---|---|---|---|
| R4 | High | Owned-TRIAL eligibility ignores the gate's best-standing rule: a trial person in a covered firm keeps writing, yet would get "read-only" / "locks" (gate.ts:73 `personStanding`) | **Accepted**: mail only when every profile the person belongs to is their own TRIAL profile; else skip `other-profiles` (§3) |
| R5 | Medium | `BILLING_GATE=false` (main.tf:629) makes the mails false | **Accepted**: rows skip `gate-off`; the job needs `billing_gate_enabled` (D8) |
| R6 | Medium | Without Stripe the links lead to a 503 drawer | **Accepted**: job needs `stripe_enabled`; doors 503 without Stripe (D8) |
| R7 | Medium | Rounding up overstates time left | **Accepted**: "within N days" wording (D2) |
| R8 | Low-Med | Store guard and store contract tests missing from the file list | **Accepted** (§6) |
| R9 | Low | Budget test vs the fixed business clock | **Accepted**: separate elapsed-time source (D12) |
| R10 | Low | The job token's reach grows | **Accepted**: comment + ADR-182 (D15) |
| R11 | Low | A loopback-proxied operator run would mail localhost links in bulk | **Accepted**: refuse a real run in production when links would be loopback (D16) |
| R12 | Low | A `rejected` send (Resend 4xx) retries daily and warns | **Rejected for now**: plain-address validation and bounce suppression catch nearly all of these first; noted under TD-223 |

Cross-model tension: none; the subagent's claims about the code were checked (gate.ts:73, store-guard.ts:270,
main.tf:776, email.tf:127-131) and hold.

Tests added by these: a trial person who is also a member of an operator firm (skip `other-profiles`); an owned
second profile with its own org grant (skip `covered`); gate off (all `gate-off`); no Stripe (503); loopback refusal;
the store contract for `trialMailCandidates`; Terraform: no job without Stripe or with the gate off.

Approval readiness: PASS (D-structure, R1-R3 and R4-R11 accepted, R12 rejected; unattended-run defaults pending Basel).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | native Plan subagent (Codex not installed) | Independent 2nd opinion | 1 | unavailable (native fallback completed) | 9 findings: 8 accepted, 1 rejected |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open (all mapped to accepted plan work) | 5 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — (server only) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** Codex not installed (`CODEX_MODE: not_installed`); native Claude Plan subagent completed within the timer. No external-provider coverage.
- **VERDICT:** Eng review run; every finding resolved into plan work with unattended defaults pending Basel. Ready to implement.

NO UNRESOLVED DECISIONS
