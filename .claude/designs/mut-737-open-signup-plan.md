# MUT-737: open sign-up: no email review, everyone starts on Starter, onboarding offers Try Solo

Status: **APPROVED with every default answer (Basel, 2026-11-27); not built.** Epic MUT-701. Supersedes the review parts of ADR-178 (MUT-367). Builds on
ADR-284 (Starter, no new no-card trials, the one-time Solo trial offer) and ADR-288 (the Solo trial Checkout).

```
Tracker: Jira · barmajiyat.atlassian.net · MUT · Backlog = not committed · finished → In Review
```

## 0. What already exists (so this ticket is small)

| Ticket line | State on main |
|---|---|
| Everyone starts on Starter | **Done** with `STARTER_PLAN` on: no trial on any sign-up branch (`auth/self-service.ts:66`), approval and Malafat sign-in start none (ADR-284 d7) |
| Malafat sign-in accounts on Starter | **Done** (row 6 of the resolver) |
| First-run Try Solo / Stay on Starter (portal) | **Built, dark**: `pages/onboarding/SoloTrialStep.tsx` behind `SOLO_TRIAL_CHECKOUT` and the server's `plan.soloTrialOffer` (`SOLO_TRIAL_OFFER_SINCE`); records "offered" once |
| Phone first run | **Built**: a plain Starter step (`welcome_screen.dart` `_StarterStep`); the trial is web-only (MUT-731 Q7) |
| MUT-418's "trial started" step | Not shown with no trial (ADR-284) |
| **Every verified sign-up ACTIVE** | **Not done**: webmail / young / unverified domains still go `PENDING_REVIEW` |
| Release today's pending accounts | Not done |
| Operator queue hidden, history read-only; digest retired | Not done |
| PostHog events for the choice | Not done (only MUT-418's `trial_card_prompt_*` exist) |
| Terms / privacy drafts without the review | Not done: `docs/legal/drafts/privacy-policy-2026-11-25.*.json` still describe the review and its mails |

## 1. Acceptance criteria

1. With `OPEN_SIGNUP` on (Q1), a redeemed SIGNUP link opens an ACTIVE account for every domain class that passed the screen (business, webmail, relay, unverified): a Gmail sign-up signs in right after setting its password, on Starter.
2. The screen's **refusals stay**: disposable and no-mail domains are still 400 `EMAIL_NOT_ACCEPTED`. Turnstile, per-IP and per-address limits and verification by link stay. `SELF_SIGNUP_ENABLED` stays the master switch.
3. The domain classification is kept as a risk signal only: recorded on the `user.signup` audit entry's metadata (`domainClass`, `reasons`) and shown on the operator's account page; never a gate.
4. No new `signup_reviews` rows. The operator's Signups page shows the history read-only (no Approve / Decline), and its nav entry moves under the account list's filter. The hourly review digest stops (no unannounced reviews will exist; the timer is removed).
5. A one-off operator script releases everyone still `PENDING_REVIEW`: ACTIVE, on Starter (no trial), the existing "your account is ready" mail, an audit `user.signup_released` and an operator log line each. Dry run by default.
6. First run: portal shows Try Solo (recommended, primary) / Stay on Starter for a new account (the built step); phone keeps its Starter step (Q3). PostHog: `onboarding_plan_shown { surface }`, `onboarding_plan_chosen { choice: 'solo' | 'starter', surface }`.
7. Terms and privacy drafts (MUT-732) no longer describe a review of sign-ups or its mails.
8. ADR supersedes ADR-178 decisions 1 (the review branch), 2 (PENDING_REVIEW outcome), 4 and 5.
9. QA flows: webmail sign-up → Starter home; first run Try Solo; first run Stay on Starter.

## 2. Design

### 2.1 Server

- `auth/self-service.ts` `signupAccountOutcome(link, at, { starter, openSignup })`: with `openSignup`, every link → `{ status: 'ACTIVE', trialStartsAt: starter ? null : at, review: null }`. Off → today's branches exactly.
- Config `OPEN_SIGNUP` (`true|false`, default false; Terraform `open_signup`), validated: refused at boot when `OPEN_SIGNUP` is on and `STARTER_PLAN` is off (an open door with a free 14-day Business trial for any Gmail address is TD-213's abuse case; Q1).
- `routes/account-setup.ts:250`: passes the flag; writes the classification into the `user.signup` audit metadata (it already has `link.domainClass` / `domainReasons`). No column needed.
- `email/review-digest.ts`: `createReviewDigest` not started when `OPEN_SIGNUP` is on (`index.ts:143,396`); the module stays for history until the cleanup ticket.
- `routes/admin-signup-reviews.ts`, `operator/actions/signupReviews.ts`: approve/decline answer `409 SIGNUP_REVIEW_RETIRED` when the flag is on; `list` keeps working.
- `scripts/users.ts` gains `release-pending-signups [--apply]`: lists PENDING_REVIEW accounts with their review rows; `--apply` runs the existing `store.signupReviews.approve` per row (its row lock, its single transaction) with `trialStartsAt: null` (Starter), then the existing approval mail (`resendApproval` path). Prints counts; exit 1 on any failure (re-runnable: approve only decides undecided rows).
- `auth/sign-in.ts`: `ACCOUNT_UNDER_REVIEW` stays (an account the script hasn't reached yet still gets a truthful answer).
- No change to the Starter resolver.

### 2.2 Portal

- `pages/operator/OperatorSignupsPage.tsx`: with `GET /v1/self-service`'s new `openSignup: true`, the actions column is gone and a one-line header shows "History". `AccountStatusBadge` unchanged.
- `OperatorAccountPage.tsx`: shows the domain class from the audit metadata ("Webmail") as a plain chip.
- `SoloTrialStep.tsx`: fire the two analytics events (shown once; chosen on each button). `docs/analytics/events.json` minor bump.
- `SOLO_TRIAL_CHECKOUT` stays the trial's own switch (it needs `PLAN_CHECKOUT`): until then a new account sees no first-run plan step on the web. With MUT-737 alone, open sign-up works with no Try Solo (Q2).
- `pages/auth/UnderReviewNotice.tsx`, `SetupPage.tsx` review branch: kept (an unreleased account may still exist); removed in the cleanup ticket.

### 2.3 Phone

Nothing required: the phone never shows the review (it signs in through the same API; `ACCOUNT_UNDER_REVIEW` handling stays). Its Starter step gains the same two analytics events with `surface: 'phone'` (in MUT-706's phone branch). Q3 covers Try Solo on the phone.

### 2.4 Legal drafts (MUT-732, unpublished)

Edit `docs/legal/drafts/privacy-policy-2026-11-25.{ar,en}.json`: remove "are reviewed by our team before the account opens; we keep the domain and the reason…" and "a notice that we're reviewing your sign-up and then its outcome"; keep the domain checks sentence as "to refuse disposable addresses". Terms drafts: checked, no review wording found. Published with MUT-732.

## 3. API contracts

- `GET /v1/self-service` (public, additive): `openSignup: boolean`.
- `POST /admin/v1/signup-reviews/{userId}/approve|decline`: `409 SIGNUP_REVIEW_RETIRED` with the flag on.
- No change to the signup or setup endpoints' shapes.

## 4. Error states

| Case | Behaviour |
|---|---|
| A link issued before the flag, redeemed after | Opens ACTIVE (the outcome is decided at redeem) |
| The release script fails halfway | Re-run: only undecided rows are approved; mails keyed per review, never twice |
| Mail off in the environment | Accounts released; `mail: skipped` printed; operator can "Send again" (MUT-459) |
| Abuse spike from webmail | Rate limits and Turnstile; operator can still lock an account (`users --lock`); turning `OPEN_SIGNUP` off restores the review for new sign-ups |

## 5. Migrations

**None.** `signup_reviews` and `UserStatus.PENDING_REVIEW` stay (history and the rollback path). The cleanup ticket may drop them later.

## 6. Tests (written first)

1. `self-service.test.ts`: outcome per domain class × `openSignup` × `starter`.
2. `config.test.ts`: `OPEN_SIGNUP` without `STARTER_PLAN` refused.
3. Route `account-setup`: Gmail link → ACTIVE, Starter, audit metadata carries the class; disposable still refused at signup.
4. Route `admin-signup-reviews`: retired with the flag; list works.
5. Script: dry run lists; apply approves, mails once, idempotent on re-run.
6. Digest not scheduled with the flag (index wiring test).
7. Portal: Signups page read-only; `SoloTrialStep` fires both events.

## 7. QA scenarios (release-QA, `qa/features/portal-selfservice/*.yaml`)

| id | Steps | Outcome |
|---|---|---|
| `portal-selfservice.signup-webmail-starter` | Sign up with a gmail.com address, open the link, set a password | Home; Billing says Starter |
| `portal-selfservice.first-run-try-solo` (needs `SOLO_TRIAL_CHECKOUT`; FakeApi) | New account › Try Solo | Address step, then Checkout |
| `portal-selfservice.first-run-stay-starter` | New account › Stay on Starter | Home on Starter; the step never shows again |
| `portal.operator.signups-history` | Operator › Signups | History only, no Approve / Decline |

## 8. Dependencies

- `STARTER_PLAN` on (MUT-731, built, dark) — required by the config guard.
- Try Solo needs `PLAN_CHECKOUT` + `SOLO_TRIAL_CHECKOUT` (MUT-702 Part B, built, dark).
- MUT-732 publishes the edited legal drafts.
- Accountant channel (MUT-762..773): provisioned customers are created by the accountant, not through sign-up; they are not affected, but confirm their first-run step (Q4).

## 9. Knowledge updates

New ADR (supersedes ADR-178 d1 review branch, d2 PENDING_REVIEW outcome, d4, d5; TD-213 resolved by Starter). CHANGELOG, TEST_PLAN, before-release (order: `STARTER_PLAN` on → run `release-pending-signups --apply` → `OPEN_SIGNUP` on), SYSTEM_OVERVIEW (self-service section), `docs/analytics/events.json`.

## 10. Questions only Basel can answer

1. **Own switch or tied to Starter?** A separate `OPEN_SIGNUP` flag (recommended, refused without `STARTER_PLAN`), or open sign-up whenever `STARTER_PLAN` is on? [Default: separate flag.]
2. **Open sign-up before Try Solo can be bought?** If `STARTER_PLAN` goes on before `PLAN_CHECKOUT`, new accounts get no Try Solo step and can never get the one-time trial later (Q7 on MUT-731: offered only at onboarding). Hold `OPEN_SIGNUP` until the trial is live, or accept that early sign-ups miss it? [Default: turn `STARTER_PLAN`, `PLAN_CHECKOUT`, `SOLO_TRIAL_CHECKOUT` and `OPEN_SIGNUP` on together.]
3. **Try Solo on the phone:** MUT-737 says portal **and** phone, but MUT-731 Q7/Q4 keep the trial web-only and the phone sells nothing. Keep the phone's plain Starter step (the trial appears on the first web visit)? [Default: yes.]
4. **Accountant-provisioned customers** (MUT-762+) and pilot testers (MUT-751): do they see the Try Solo step, or skip it? [Default: skip it; they have their own Welcome.]
5. **Released pending accounts:** get the one-time Solo trial offer on their first web visit (they are "new" but older than `SOLO_TRIAL_OFFER_SINCE`)? [Default: no, per Q7 "accounts that exist before release never get it".]
