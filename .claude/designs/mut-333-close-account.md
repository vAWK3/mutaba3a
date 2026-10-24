# MUT-333 — Close my account and delete its data (web half: server + portal)

Epic MUT-322 (ga-gate). Blockers MUT-373 (co-owners) and MUT-360 (Stripe mirror) are both on main.
Scope here: the server and the hosted portal. The phone half (Flutter) is built later, with MUT-371/MUT-364, against the API contract in §7.
Tracker: Jira · barmajiyat.atlassian.net · MUT via atlassian-barmajiyat · finished web half → **In Review** (web half), phone half stays open on this ticket.

Numbers: **ADR-188**, **TD-237..**, **API 1.65.0-mut333**, migration `20261024210000_mut333_account_closure`.
(ADR-187/TD-236 are MUT-425's, unmerged; ADR-182 is earmarked for MUT-253.)

## 0. What Basel already decided (binding)

- 30 days' grace, then a hard delete; backups age out 14 days later (Jira 12135, memory pilot-readiness).
- Lapsed payment is not closing: nothing is deleted until the person explicitly closes (12135).
- **An active Stripe subscription is cancelled by closing.** A Malafat add-on is left alone (it is on Malafat's Stripe) (12135).
- `user.terms_accepted` audit rows naming the person are purged everywhere; `terms_acceptances` cascade (12152).
- Records the person entered on a profile they don't own (co-owned, firm, Malafat-fed) are **anonymized**, not reassigned: the creator columns become nullable with SET NULL; "nobody else is credited" (12293).
- Malafat-fed profiles and operator firms keep their ADR-066 rules: only the person's membership goes.
- MUT-361: the close routes are `open` in `PERSON_LEVEL_GATE` — a locked person can close.

## 1. Problem and acceptance criteria

A person can't close their account; during the pilot the operator does it by hand (`profile-rows.sh purge-user`). GA needs self-service (privacy law; App Store 5.1.1(v) for the phone).

AC (ticket + comments):
1. Portal (this half) and phone (later) have **Close my account**: offered "Download my records" first, then the password again.
2. The account enters a 30-day grace: the person can sign in only to cancel. Then the server hard-deletes the user, their owned profiles and every record in them, their receipts in storage, their sessions. The audit trail keeps only a tombstone.
3. Profiles shared through Malafat or an operator firm are not deleted; only the membership goes. A co-owned profile is never deleted with one account.
4. After the hard delete **no row or object for the user remains**; a test checks every table with a user or organization foreign key.
5. **No `user.terms_accepted` audit row naming the person remains** on any profile.
6. **Cancelling during the grace period restores everything.**
7. Release-QA: `@portal.account.close` (+ cancel, + locked person) pass; iOS flow in the phone half.

## 2. Decisions (D1..D20 — pending Basel's confirmation)

- **D1 — Billing: closing schedules the cancel, the purge finishes it** (revised by R5/R6/R7). At close, every mirrored subscription of the person's Stripe customer that is live (`active|trialing|past_due|unpaid`) and not already ending is set to `cancel_at_period_end = true`; the ids are kept on the closure. Cancelling the closure turns back on only those (never one the person had ended themselves). The hard delete deletes the Stripe customer (`customers.del`), which ends anything still running at once. No refund is automated (Basel refunds by hand in Stripe). *Why not cancel immediately:* "cancelling restores everything" (AC6) is then impossible without a new checkout. *Why not require them to cancel first:* a locked or confused person would be stuck; Basel's comment says closing cancels it. If Stripe can't be reached at close → **502 STRIPE_UNAVAILABLE**, nothing changes, they retry.
- **D2 — Strong confirmation = the password** (ticket: "re-enter their password"). Wrong password → 403 `CURRENT_PASSWORD_WRONG`, counted toward the same lockout as sign-in (the change-password rule, shared helper). The drawer also shows the email being closed.
- **D3 — Grace is a restricted session, not a status** (revised by R8: a second `POST /v1/me/closure` while closing gets 403 `ACCOUNT_CLOSING`; D17 is withdrawn). The user row gets `closeRequestedAt`, `deleteAfter` (+ the D1 subscription ids); `status` stays ACTIVE. Sign-in still works during grace. Every session request except `GET /v1/me`, `DELETE /v1/me/closure`, `DELETE /v1/sessions/current`, `DELETE /v1/device-sessions/current` answers **403 `ACCOUNT_CLOSING`** `{ deleteAfter }`. API keys are unaffected (Malafat's firms keep working). At close every *other* session (web and devices) is revoked (`account_closing`); the closing one stays so the person sees the closing page.
- **D4 — No records export during grace.** "Sign in only to cancel" (ticket). Download comes *before* closing (the drawer offers it); someone who forgot cancels, downloads, closes again (a new 30 days).
- **D5 — After `deleteAfter` the account is gone to the person:** sign-in answers the usual 401 INVALID_CREDENTIALS, sessions expire, cancel can't be reached. `deleteAfter = closeRequestedAt + 30 × 24 h`.
- **D6 — A profile the person created that has co-owners passes to a co-owner** (target qualified by R10) (membership `createdAt`, then user id) at the hard delete, audited `organization.owner_transferred` (SYSTEM). It is never deleted. The new owner's billing then covers it (coverage follows `profileOwnerOf`). The owned-profile cap (6) is not checked on a transfer (only creation checks it). Decided at purge time, so a co-owner who leaves during grace changes the outcome, and a cancel leaves everything as it was.
- **D7 — Anonymize, per Basel (12293):** on profiles that survive, `expenses.createdByUserId`, `expense_receipts.uploadedByUserId`, `conversions.createdByUserId`, `expense_groups.createdByUserId` become **nullable, ON DELETE SET NULL**; `expense_receipts.approvedByUserId` and `payments.createdByUserId` already are; `receivables.createdByUserId` (no FK) is nulled by the purge; `organizations.firmRequestedByUserId` becomes SET NULL and its pair CHECK relaxes to "requested-by implies requested-at". The API's `createdByUserId`/`uploadedByUserId` become nullable (contract change, additive for readers that accept null; the phone must, §7). The portal shows no creator today, so no UI string is needed.
- **D8 — Audit tombstone** (corrected by R3: metadata *does* carry email/name in `user.created`). Rows on deleted profiles go with them. On surviving profiles the person's rows stay, naming only their user id (no person row remains); one SYSTEM `user.deleted` row is added per surviving profile they were a member of. Every `user.terms_accepted` row naming them is deleted, everywhere (12152). No audit metadata carries an email or name today (checked).
- **D9 — What stays outside the profiles** (widened by R4/R14): `email_suppressions` (a bounce/complaint only ever stops mail; deleting it would re-mail a complainer), `email_deliveries` (digests only, pruned at 30 days), `stripe_events` (event ids only). Deleted: `signup_reviews` linked to the person, `account_setup_tokens`, `inbox_entries`, `user_idempotency_keys`, `sessions`, `memberships`, `entitlement_grants` (cascade), `billing_accounts` + `billing_subscriptions`, `terms_acceptances` (cascade).
- **D10 — The mail.** New template `account-closing` (en/ar, the account's locale), sent after the commit: "We'll delete your MTB3A account and its records on <date>. Until then, sign in to cancel." Button: Sign in (the portal's sign-in). The date is `deleteAfter` as a long calendar date in the person's personal-profile timezone (fallback UTC). This amends MUT-359's "no date in any mail" rule (ADR-159 §5 is about money records): **a deletion date may appear; never a money date, amount or currency** (ADR-188 override log). No mail on cancel; no reminder before the delete.
- **D11 — The hard-delete job runs hourly**, so the deletion happens within an hour of `deleteAfter` and the mail's date stays true. Cloud Scheduler `mutaba3a-account-purge` → `POST /jobs/v1/accounts/purge` (job token), always present (no switch: closing is a promise). Operator: `POST /admin/v1/accounts/purge {dryRun}` and `npm --prefix server run accounts:purge [-- --dry-run]`. 200 s budget (`incomplete`), at most **25 people per run** (a bug can't wipe the base in one go; the rest wait an hour), one person's failure never stops the run.
- **D12 — Per-person order** (superseded by R1/R2; kept for history): (1) re-read and re-check "closing and due"; (2) Stripe: delete the customer (a missing customer is done); (3) storage: delete the prefix `org/<id>/` of each profile being deleted; (4) one DB transaction that locks the user row, re-checks due, transfers (D6), anonymizes (D7), deletes (D9), writes the tombstones (D8). Stripe failure → that person is skipped (`stripe-failed`) and retried next hour; a Stripe customer with Stripe unconfigured → skipped (`stripe-unavailable`). Every skip logs `account purge needs the operator`, which alerts.
- **D13 — Portal.** "Close my account" is the account menu's last account item (danger tone), opening a drawer on `?closeAccount=true` (drawer-first). While closing, `AuthGate` shows a full closing page (precedent: `TermsUpdatePage`) with the date, **Keep my account** (cancel) and Sign out. Hidden signed-out (local mode).
- **D14 — Stripe key scope:** the restricted key needs **Write on Subscriptions** (it has Write on Customers since MUT-362). Operator step.
- **D15 — Legal text untouched.** The privacy policy already says 30 days + backups 14 days later. Its "Deleting your account and data" section still says "email us"; changing it is Basel's wording (before-release step), not this ticket's.
- **D16 — `profile-rows.sh purge-user` stays** as the operator's manual tool for edge cases; its header points at the server purge.
- **D17 — WITHDRAWN (R8).** ~~Idempotent close~~: `POST /v1/me/closure` while already closing answers 200 with the existing closure (after the password check); it never extends the date.
- **D18 — The closure lives on the user row** (`closeRequestedAt`, `deleteAfter`, `closeEndedSubscriptionIds text[]`, CHECK both-or-neither, index on `deleteAfter`): the auth layer already reads the user on every request, so the restriction costs no extra read.
- **D19 — Purge-run safety rail** (status condition dropped by R9): a person is purged only if `deleteAfter <= now` **and** `closeRequestedAt <= now − 30 d` (both columns must agree), status ACTIVE, and the transaction's re-check passes.
- **D20 — Phone half** is documented here (§7) and built with MUT-371/364. Jira moves to "In Review — web half"; nothing new is filed.

## 3. Design

### 3.1 Server — data (migration `20261024210000_mut333_account_closure`)
- `users`: `closeRequestedAt timestamptz NULL`, `deleteAfter timestamptz NULL`, `closeEndedSubscriptionIds text[] NOT NULL DEFAULT '{}'`; CHECK `(closeRequestedAt IS NULL) = (deleteAfter IS NULL)`; index on `deleteAfter` (partial `WHERE deleteAfter IS NOT NULL`).
- D7 nullability + `ON DELETE SET NULL` on `expenses.createdByUserId`, `expense_receipts.uploadedByUserId`, `conversions.createdByUserId`, `expense_groups.createdByUserId`, `organizations.firmRequestedByUserId`; firm pair CHECK relaxed.
- Every other FK to `users` stays RESTRICT (a table the purge forgets fails the transaction loudly instead of cascading silently).

### 3.2 Server — store
- `UserRecord.closure: { requestedAt, deleteAfter, endedSubscriptionIds } | null`.
- `users.requestClosure({ userId, at, deleteAfter, endedSubscriptionIds, exceptSessionId, audit })` → the updated user (or the existing closure, D17); revokes other sessions in the same transaction. Guard `{ write: 'identity' }`.
- `users.cancelClosure({ userId, at, audit })` → the closure that ended, or null when none / already due (`deleteAfter <= at`). Guard `{ write: 'identity' }`.
- New `accountPurge` repository (all `operator`): `listDue(at, limit)`, `planOf(userId, at)` → `PurgePlan { userId, deleteProfileIds, transfers[{organizationId, toUserId}], leaveProfileIds, stripeCustomerId, counts }`, `purge(userId, at)` → `PurgeOutcome` (`purged` | `not-due`). Memory + Prisma, one store contract suite.
- Prisma purge: explicit ordered `deleteMany` per profile table (child → parent), the user-only tables, the anonymizing updates, the user. `PURGE_PROFILE_TABLES` and `PURGE_USER_COLUMNS` are exported constants; a test:db reads `information_schema`/`pg_constraint` and **fails when a table with `organizationId`, or any FK to `users`, is not classified** (AC4 future-proofing), and a second test seeds a person across profiles and checks the catalog afterwards (AC4/AC5).

### 3.3 Server — domain and routes
- `server/src/accounts/closure.ts`: `GRACE_DAYS = 30`, `closureDeadline(at)`, `CLOSING_OPEN_ENDPOINTS`, `closingRefusal(user)`, `liveSubscriptionsToEnd(subs)`.
- `server/src/accounts/purge-run.ts`: `runAccountPurge({ store, stripe, storage, logger, now, dryRun, budgetMs, maxPeople })` → `{ summary, rows }` (like `runTrialMail`).
- `server/src/auth/current-password.ts`: `verifyCurrentPassword()` extracted from `POST /v1/me/password` (throttle, lockout, audit), reused by close.
- `routes/account-closure.ts`: `POST /v1/me/closure {password}` → 200 `{ closure }`; `DELETE /v1/me/closure` → 200 `{ billingNeedsAttention }` (true when a subscription couldn't be turned back on; the portal then points to Billing). Organization-independent; `PERSON_LEVEL_GATE` `open`.
- `routes/account-purge.ts`: `POST /jobs/v1/accounts/purge` (counts only) and `POST /admin/v1/accounts/purge {dryRun}` (rows).
- Middleware (`finishSessionAuth`): the closing restriction before profile selection and the lapse gate. `validateSessionRecord` + `signIn`: past `deleteAfter` = gone (D5).
- `/v1/me`: `user.closure` (`{ requestedAt, deleteAfter } | null`, additive).
- Stripe: `CheckoutGateway.setCancelAtPeriodEnd(subscriptionId, value)` and `deleteCustomer(customerId)` (missing customer = success).
- Storage: `AttachmentStorage.removePrefix(prefix)` (GCS `deleteFiles({prefix})`, memory, local disk).
- Mail: `account-closing` template; the template test's date rule gets one named exemption.
- Error codes: `ACCOUNT_CLOSING` 403.
- CLI: `accounts:purge` verb in `scripts/users.ts`.
- Terraform: `google_cloud_scheduler_job.account_purge` hourly (`15 * * * *`), tftest; log alert `account purge needs the operator` in `monitoring.tf`.

### 3.4 Portal
- `components/CloseAccountDrawer.tsx` (`?closeAccount=true`, `AccountDrawers`): what goes (your profiles and records, receipts, sessions, the subscription), what stays (profiles shared with you or your firm: only your access goes; a business profile you share passes to your co-owner), "Download my records first" (opens Your data), the email shown, password field (show/hide), danger submit "Close my account". Errors: wrong password banner, 502 Stripe banner, unreachable.
- `pages/auth/AccountClosingPage.tsx` in `AuthGate`, before the terms gate: "Your account will be deleted on <date>", Keep my account (→ DELETE, then me refetch, toast "Your account stays open"; when `billingNeedsAttention`, a note pointing to Billing), Sign out.
- UserMenu item (signed in only). i18n en/ar under `hosted.closeAccount.*`. RTL at 375 px (logical CSS only).
- api client: `closeAccount`, `keepAccount`; `schema.d.ts` regenerated.
- Interaction with MUT-425 (unmerged, deletes `UserMenu`): if it lands first, the entry moves to `YouAccount`'s Account part as a danger row; the drawer and URL key are unchanged.

## 4. Reuse

`Drawer`, `Button`, password field shape from `ChangePasswordDrawer`, `useAccountDrawers`, `TermsUpdatePage` gate pattern, `runTrialMail` job/admin/CLI shape, `trialMailRoutes` door pattern, `Mailer`, `memberProfilesForBilling`, `listOwnersOf`, `revokeSessionsOf`, MUT-360 `wrapped()` Stripe error mapping, `profile-rows.sh` purge ordering logic (ported, not shelled out).

## 5. Cost and scale
One indexed query per hour when nobody is due. Purge per person: one Stripe call, one bucket listing per owned profile, one transaction (≈40 `deleteMany`, each on an `organizationId` index). The closing restriction reads nothing extra (user row already loaded).

## 6. QA scenarios (release-QA, portal FakeApi; recorded)
- `portal.account.close` (core-adjacent → `secondary`): From the account menu choose Close my account → the drawer shows what goes and what stays and offers Download my records → wrong password shows a banner → the right password closes it → the closing page shows the date with Keep my account and Sign out.
- `portal.account.close-cancel`: A closing account signs in → sees the closing page → Keep my account → back on the home page with a toast; the menu works again.
- `portal.account.close-locked`: A LOCKED person (locked screen) opens the account menu → Close my account → closes → the closing page.
- `portal.account.close-arabic-phone`: the drawer and the closing page in Arabic, RTL, 375 px, no sideways scroll.
- Server proof (vitest + test:db, not recorded): AC4/AC5/AC6 and D6/D7/D11/D12.

## 7. Phone half (MUT-371/MUT-364 phase) — what the phone must do
1. **Settings › Close my account** (iOS + Android, en/ar/RTL): explain what goes/stays (same copy as the portal), offer "Download my records" first (the existing export or a link to the portal's Your data), ask for the password, call `POST /v1/me/closure {password}` with the device session. 200 → show the closing screen. 403 `CURRENT_PASSWORD_WRONG` → banner (counts toward lockout). 502 `STRIPE_UNAVAILABLE` → "try again". 429 → wait.
2. **Closing screen:** when `GET /v1/me` has `user.closure != null`, show only: the deletion date (`closure.deleteAfter`, local date), **Keep my account** → `DELETE /v1/me/closure` (200 `{ billingNeedsAttention }`; true → "turn your subscription back on in Billing" with the portal link), and Sign out (`DELETE /v1/device-sessions/current`).
3. **403 `ACCOUNT_CLOSING`** on any other call: terminal for the outbox (like 402 `SUBSCRIPTION_LAPSED`, never retried), re-read `/v1/me`, show the closing screen. Other devices are signed out at close (401 → sign-in → closing screen).
4. Accept **null** `createdByUserId` (expenses, conversions, expense groups, entries feed) and `uploadedByUserId` (receipts) from API 1.65.0-mut333 on.
5. After the deletion the account no longer signs in (401 INVALID_CREDENTIALS); clear local data on 401 as today.
6. iOS release-QA flow: close → closing screen → keep. Apple 5.1.1(v) is satisfied by step 1 in-app; MUT-371's "Create an account" waits on it.

## 8. Test plan (TDD)
Server (`npm --prefix server test`, `test:db` on an isolated DB `mutaba3a_mut333`):
- `accounts/__tests__/closure.test.ts`: deadline, live subscriptions to end, closing refusal endpoints.
- `routes/__tests__/account-closure.test.ts`: close (wrong password 403 + lockout count; success 200, other sessions revoked, mail sent with date in en/ar, Stripe scheduled, audit); idempotent; cancel restores (subs resumed, closure null); closing session refused 403 ACCOUNT_CLOSING except the open four; locked person closes (gate on); after deadline sign-in 401 and session expired; Stripe failure 502 nothing changed; local-mode app has no route.
- `accounts/__tests__/purge-run.test.ts`: dry run changes nothing; due person purged; not-due skipped; co-owned transfer; firm/Malafat membership left with anonymized records; Stripe customer deleted / missing / failing; storage prefixes removed; budget/cap; one failure doesn't stop the run.
- store contract `store-contract-account-closure.ts` (memory + Prisma): request/cancel/listDue/plan/purge semantics, memory "no value anywhere names the user" scan.
- `__tests__/prisma-account-purge-catalog.test.ts` (test:db): every org/user table classified; a seeded person leaves nothing behind.
- gate: closure routes `open` (existing classification test covers new routes).
- templates: `account-closing` sample; date exemption.
- `jobs`/admin routes + CLI parsing; terraform test.
Portal (`npm run test:run`): `CloseAccountDrawer.test.tsx`, `AccountClosingPage.test.tsx`, UserMenu item, AuthGate ordering.

## 9. Impact
- API contract 1.65.0-mut333 (additive except the D7 nullability). Migration is additive + relaxing.
- Operator steps: Stripe key Write on Subscriptions (D14); the purge Scheduler job appears on the next terraform apply; first run with `accounts:purge -- --dry-run`; Basel's privacy wording (D15).
- i18n: en/ar portal strings + mail copy.

## 10. Eng review (plan-eng-review + outside voice, 2026-10-24) — R1..R17, all pending Basel's confirmation

Unattended run: every recommendation taken. Outside voice: native Plan subagent (Codex CLI not installed). Evidence is static reads of the named files.

- **R1 (High) — Claim before any external call; storage after the commit.** Per person: (a) short transaction, user row `FOR UPDATE`: closing, `deleteAfter <= now` → set `purgeStartedAt = now` (kept on later attempts) and `purgeLastTriedAt = now`. `cancelClosure` is a conditional update `WHERE deleteAfter > now AND purgeStartedAt IS NULL`, so after a claim a cancel can never win, whatever the instances' clocks say. (b) Stripe deletes (R5). (c) The purge transaction decides transfers, deletes and anonymizes, and inserts one `storage_purges(organizationId, queuedAt)` row per deleted profile. (d) After the commit, and at the start of every run, each queued prefix `org/<id>/` is deleted from the bucket and its row removed. A crash anywhere leaves a retryable state; a profile that survives (a grant or transfer in the window) never loses files, and a deleted profile's files always go.
- **R2 (High) — Cancel/purge race** is closed by R1's claim (the claim and the cancel serialize on the user row).
- **R3 (High) — Audit scrub.** On surviving profiles, every audit row whose `actorId` or `entityId` is the person, or whose metadata names their id, keeps its action, time and ids but loses its `metadata` (set NULL); `user.created` carries `{ email, displayName }` (`routes/admin-users.ts:234`) and `billing.account_linked` carries the Stripe customer. `user.terms_accepted` rows are still deleted outright. The idempotency rows of surviving profiles whose stored response names the person are deleted.
- **R4 (High) — SIGNUP tokens by address.** `account_setup_tokens` are deleted `WHERE userId = $id OR (purpose = 'SIGNUP' AND email = $email)` — the rule `signupReviews.decline` already uses (`repositories/prisma.ts:2181`).
- **R5 (High) — Stripe beyond the mirror.** At purge, the customers deleted are: the mirrored one, plus every customer `findOrCreateCustomer` could have made — listed by the person's email and kept only where `metadata.mutaba3a_user_id` is the person (never another person's customer). At close, `expireOpenCheckouts` runs on each, so no checkout can be paid during grace.
- **R6 (Medium-High) — Close is compensating, read live.** Close lists the live subscriptions from Stripe (not the mirror): `active|trialing` without `cancel_at_period_end`/`cancel_at` are set to end at the period end; `past_due|unpaid` are cancelled at once (R7). Any Stripe failure reverts the ones already changed and answers 502 `STRIPE_UNAVAILABLE`; then the DB closure commits with the ids; if the DB write fails the Stripe changes are reverted. A failed revert logs `account closure needs the operator` (alerted).
- **R7 (Medium) — `past_due`/`unpaid` subscriptions are cancelled immediately at close** (cancel_at_period_end would not stop Stripe retrying the open invoice during grace). They are not restored by Keep my account; the response's `billingNeedsAttention` is then true.
- **R8 (Medium) — D17 withdrawn.** Only `GET /v1/me`, `DELETE /v1/me/closure` and the two sign-outs pass during grace.
- **R9 (Medium) — The purge is status-agnostic** (a DISABLED closing account is still deleted on time).
- **R10 (Medium) — Transfer target:** among the profile's other OWNER members, prefer ACTIVE and not closing, then not closing, then the closing one with the latest `deleteAfter`; ties by membership `createdAt`, then id. Any co-owner means a transfer, never a delete.
- **R11 (Medium) — Co-owners' coverage.** The drawer warns the closer when a profile they share is covered by their subscription; the coverage gap for the co-owners during grace is **TD** (no mail to co-owners in this ticket).
- **R12 (Medium) — Webhook race.** `saveAccount` gets `createIfMissing` (false when the customer is deleted), so a late `customer.subscription.deleted` can never recreate a purged account; the purge locks the person's `billing_accounts` rows first.
- **R13 (Medium) — Transaction budget and fairness.** The purge transaction gets an explicit `{ timeout: 120 s, maxWait: 10 s }`; `listDue` orders by `purgeLastTriedAt NULLS FIRST, deleteAfter`, so 25 failing people can't starve the rest.
- **R14 (Medium) — The leftover test scans values, not just keys.** The seeded test:db test scans every text/varchar/uuid/jsonb/text[] column of every table for the person's id, email and (unique) display name, besides the classification test.
- **R15 (Medium) — Nullability vs shipped phones: no gate needed.** Flutter's `FeedEntry.createdByUserId` is already `String?` (`lib/domain/models/feed_entry.dart:146,175`), and no Flutter model decodes `uploadedByUserId`; the null values a purge produces don't break shipped builds (static read).
- **R16 (Low) —** Trial-mail candidates exclude closing people; the portal's query client re-reads `/v1/me` on 403 `ACCOUNT_CLOSING` too (`queryClient.ts:24`); the mail's date is that of `deleteAfter + 1 h` (the job's worst lag) in the person's zone.
- **R17 (Low) — Kept as decided:** `email_suppressions` keep the address (D9, Basel to confirm against AC4's wording); future non-owner members of an owned profile (MUT-305 staff) lose only their membership — the classification test fails if MUT-305 adds a table this purge doesn't know.

Schema additions from R1/R13: `users.purgeStartedAt`, `users.purgeLastTriedAt` (nullable), table `storage_purges (organizationId uuid PK, queuedAt)` (no FK: the profile is gone).

Business / product impact
- GA can be sold without the operator deleting accounts by hand, and the published privacy promise (30 days, terms record included) becomes true by code.
- Unblocks the phone half (Apple 5.1.1(v)) and with it MUT-371's in-app "Create an account".
- Risk framed: irreversible deletion is guarded by a 30-day grace, a re-check inside the transaction, a 25-per-run cap, an operator dry run and catalog tests.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|---|---|---|---|---|---|
| Eng review | /plan-eng-review (from /eng-ticket) | irreversible data deletion, billing, auth | 1 | CLEAR (unattended, recommendations taken) | 17 (R1–R17), 5 High folded in |
| Outside voice | native Plan subagent | Codex CLI not installed | 1 | completed | 16, all folded into R1–R17 |

VERDICT: ready to build with R1–R17 applied; every D and R is pending Basel's confirmation.

**UNRESOLVED DECISIONS:**
- D1–D20 and R1–R17 await Basel's confirmation (unattended run; recommended options taken).
