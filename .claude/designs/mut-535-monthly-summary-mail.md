# MUT-535: the monthly summary mail — plan

Epic MUT-528 (D10, build order step 6). Story status: Backlog. No blockers: MUT-531 (switch to yearly) is live in api-v0.18.0.
Plan written 2026-11-21 on branch `claude/interesting-swirles-03d6c9` (from main 144e3c0d); eng review R1–R17 folded in
(§9). **Not built. Waiting for Basel's approval of this plan, the mail copy (§7) and the privacy-policy change (§7c).**

## 1. What the ticket asks (acceptance criteria → where this plan covers it)

| # | Acceptance criterion | Covered by |
|---|---|---|
| AC1 | On the 1st, every paying or trialling person gets one mail, ar + en in their language, per profile or combined: last month's money in, still owed, overdue, **per currency**, linking to the profile's overview | D1–D4, D12, §3, §7 |
| AC2 | Same numbers as the portal's overview and Reports Glance | D5: one shared reader; the verdict route refactored onto it |
| AC3 | Off with one link and in You › Account; off by default for Malafat-covered profiles | D6–D8 |
| AC4 | After a monthly payer's 2nd payment, the "Switch to yearly" line | D9: MUT-531's own rule, moved out of the route |
| AC5 | Nothing sent for a profile with no entries that month | D10 |
| AC6 | Amounts in mails: decide against ADR-159 §5 | D11 → **ADR-260** (Basel's yes, Jira comment 13353) + privacy policy (§7c) |
| AC7 | Tests and a release-QA flow on the memory mailer | §5, §6 |

## 2. Decisions

- **D1 One combined mail per person**, not one per profile: a block per qualifying profile, each with its own "Open
  <profile>" link to `/p/<id>` (the overview). One mail a month per person, whatever they hold.
- **D2 Who gets it (R2): the person who pays or trials.** A person gets the mail when their *own* billing facts cover
  at least one profile today: their own Stripe subscription (ACTIVE or GRACE), their own running trial, a live
  operator grant to them, or a Malafat link on a profile they own. The candidate query reads exactly those facts
  (keyset by userId). Their mail then covers every profile they hold in the verdict's set (owned, co-owned, firms where
  their membership is OWNER) whose entitlement today is ACTIVE or GRACE. READ_ONLY, LOCKED and paused profiles are left
  out. So: a co-owner who doesn't pay gets no mail of their own (the payer's mail shows the shared profile); two
  paying co-owners each see the same block. An Accountant-plan-only payer gets nothing (their client books aren't
  their profiles). Also skipped: closing accounts and suppressed addresses. (Built first skipping unverified
  addresses, R7; Basel dropped that on 2026-11-22, TD-315: operator-made pilot accounts are mailed too.)
- **D3 The month (R6).** The calendar month before the run's month in Asia/Jerusalem. Dates in MTB3A are calendar dates,
  so the month's range is the same for every profile; the profile's timezone only decides its *today*. The run is at
  **14:00 Jerusalem (12:00 UTC)**, when the 1st has begun in every zone down to UTC−12; a profile whose today is still
  in the reported month is left for the next day's run. Owed and overdue are as of the profile's today, and the mail
  says "as of {1 December}".
- **D4 The figures per profile, per currency (ADR-004):** *Came in* = POSTED payments by receivedOn in the month
  (Reports' "Received"); *Still owed* = outstanding over open income (the overview's "Owed"); *Overdue* = its overdue
  part, with the number of overdue entries once per profile (R8: `owedOf` counts across currencies). Never converted,
  never summed across currencies; several currencies on one line, sorted by code. No converted total. Retired
  currencies (MUT-388) are left out through the verdict's own filter.
- **D5 Same numbers (AC2, R8, R9).** Extract the verdict route's per-profile read (post due items, read the month's
  payments and expenses, read open income, `summarizeActivity`, `owedOf`, and the retired-currency filter
  `supportedOnly`, exported) into `server/src/summaries/profile-figures.ts › readProfileFigures(store, organization,
  range, now, posting)`. The verdict route calls it (a pure refactor: its tests stay green unchanged), and so does the
  job, with its own posting door `{ store: unguarded, actor: SYSTEM }` (no request context). A parity test runs the
  verdict route and the job on the same profile and compares the strings. The mail matches the Glance exactly; it
  matches the overview except for a retired currency, which the overview still lists. A **dry run doesn't post** due
  installments (it writes nothing), so its figures can lag by posting; it says so in its output. If any of a person's
  profiles fails to read, that person isn't mailed in this run (the monthly key would make a mail with a hole final);
  the next day's run retries.
- **D6 The preference** on the person: `User.monthlySummaryMail` (nullable text): NULL = default, `OFF`, or `ON_ALL`
  (include Malafat-covered profiles). One nullable column, one migration (warn the orchestrator before the merge: it
  restarts :8787).
- **D7 Malafat default (AC3, R5).** Default (NULL): Malafat-covered profiles are left out, every other qualifying profile
  is in; a person whose only qualifying profiles are covered gets nothing. You › Account's switch shows *on* when the
  person would get a mail; turning it *off* writes `OFF`; turning it *on* writes NULL, or `ON_ALL` when the default would
  send nothing (only covered profiles). The opt-out page's "Turn it back on" does the same.
- **D8 One link off (R3, R4, R13).** Each mail's footer link opens the public portal page `/mail-off#<token>` (the token
  in the fragment: never in a request log). The page shows one button, **Turn off the monthly summary**; scanners that
  open links, even ones running scripts, never press it. The button POSTs `POST /v1/mail-preferences/monthly-summary
  {token, on: false}` (same-origin and IP rate limit, like the other public token routes), then offers "Turn it back
  on". The token is HMAC-SHA256 over `mail-off:v1:<userId>`, keyed by HKDF from `SESSION_TOKEN_PEPPER`; it doesn't
  expire, and does nothing but this switch. Rotating the pepper voids old links; the page then says "This link no
  longer works. Turn it off in You › Account." (documented in INFRA). Mail clients' own unsubscribe button (RFC 8058
  headers) is left out: it would put the token in a URL path, and the ticket's one link is met without it.
- **D9 Switch-to-yearly line (AC4, R10).** Move `yearlySwitchLine` (+ `stayOfferRuns`) from `routes/billing.ts` into
  `billing/yearly-switch-line.ts`, called by Billing and the mail: monthly list price, active, not cancelling, not
  paused, no stay offer running, ≥ 2 paid invoices. Only a person with a monthly list-price subscription costs Stripe
  reads (catalog once per run, paid-invoice count cached). With no Stripe on the server, or Stripe failing, or no
  saving to name, the line is left out and the mail still goes; the job never answers 503 for want of Stripe. The line
  names the yearly saving in the subscription's currency (ADR-260 covers that amount) and links to
  `/?billing=true&step=switch`.
- **D10 No entries, no block (AC5, R15).** A profile is in the mail only if it has an income, payment or expense dated
  in the month (from the reads D5 already makes: open income's posting dates, the month's payments and expenses; no new
  query) and at least one non-zero figure. No qualifying block → no mail.
- **D11 Amounts → ADR-259.** "The monthly summary mail names a person's amounts: per profile and per currency, what came
  in last month, what is still owed and what is overdue, as Reports and the overview show them, and the yearly saving
  of D9; never converted, never a client's name or a single entry." Overrides ADR-159 §5 for this template only, like
  ADR-237/243. `ports.ts`'s header and the templates test's pin gain the exception. The privacy policy changes with it
  (§7c, R12): it promises today that our emails never include amounts.
- **D12 Sending inside the mail cap (R1).** Production allows 90 mails in any 24 h for everything (`mail_daily_cap`,
  Resend's free plan, shared with Malafat), 10% of it kept for recovery mail. So the job **never spends the day's
  budget**: each run sends at most `MONTHLY_SUMMARY_DAILY_SENDS` (default 40), one at a time, and stops (`incomplete`)
  at its budget or at the first `capped`. The job runs on **days 1–7** of the month, so the free plan carries up to
  about 280 people a month; the idempotency key `monthly-summary:<userId>:<YYYY-MM>` makes each later day pick up
  where the last stopped. `docs/operations/before-release.md` says to compare the paying + trialling count with that
  before switching it on, and to move to a paid Resend plan (and raise both numbers) when it nears 250. (No
  `sentKeys` read: at this size the mailer's `duplicate` answer is enough, R14.)
- **D13 Off by default in production.** Terraform `monthly_summary_mail_enabled` (default `false`); the Scheduler job
  (`0 14 1-7 * *`, Asia/Jerusalem, `attempt_deadline` 280 s, 200 s run budget) exists only with `mailer == "resend"`
  and the switch on. Basel's operator step: a dry run (`npm --prefix server run billing:monthly-summary-mail -- --dry-run`),
  then the switch. No new alert (the other mail jobs have none, R16); the run logs its counts.
- **D14 Not in this ticket:** the phone app's own switch (the mail's link and the portal work for phone users).
  Proposed as a Flutter follow-up. No product-analytics events (R17): the switch and the page are counted in the
  server's logs only.

## 3. Where the code goes

Server (`server/src/`):
- `summaries/profile-figures.ts` (new): `readProfileFigures` (D5); `summaries/verdict.ts` exports `supportedOnly`;
  `routes/summaries.ts` verdict handler calls `readProfileFigures`.
- `billing/yearly-switch-line.ts` (new): moved from `routes/billing.ts`.
- `billing/monthly-summary.ts` (new, pure): `summaryMonthOf(now)`, `profileBlockOf(figures, month)`,
  `mailProfilesOf(preference, profiles)` (D7), skip reasons.
- `billing/monthly-summary-mail.ts` (new): `runMonthlySummaryMail(options)` shaped like `comeback-mail.ts` (rows, counts,
  dry run, time and send budgets, `incomplete`).
- `routes/monthly-summary-mail.ts` (new): `POST /jobs/v1/billing/monthly-summary-mail` (job token, counts only) and
  `POST /admin/v1/billing/monthly-summary-mail` (`dryRun`, rows); the loopback-link refusal of the come-back mail.
- `routes/mail-preferences.ts` (new, public): `POST /v1/mail-preferences/monthly-summary {token, on}`.
  `routes/sessions.ts`: `PATCH /v1/me/monthly-summary-mail {on}` (joins the organization-independent routes);
  `/v1/me` gains `monthlySummaryMail: { on } | null` (null in local mode).
- `email/mail-off-token.ts` (new): sign and verify (timing-safe).
- `email/ports.ts`: template `monthly-summary` + its vars, exempt from the per-recipient cap (job only, once a month).
- `email/templates/layout.ts`: `sections?: { title, details, link }[]` (one tinted panel per profile) and an optional
  opt-out line in the footer. `copy.ts`: `monthlySummary` (§7); months via `ARABIC_LOCALE` (Levantine, ADR-253);
  amounts **and profile names** isolated in Arabic (`⁨…⁩`).
- `repositories/ports.ts` + memory + Prisma: `billing.monthlySummaryCandidates({ after, limit })`,
  `users.setMonthlySummaryMail`. `prisma/schema.prisma` + one migration.
- `config.ts`: `MONTHLY_SUMMARY_DAILY_SENDS` (default 40). `schemas.ts`, OpenAPI regen, CLI
  `billing:monthly-summary-mail [-- --dry-run]`.
- `infrastructure/terraform/{main,variables}.tf`: the switch, the job, the env var; a tftest like the come-back's.
- Route pins: `no-self-registration.test.ts`, `route-security.test.ts`, ADR-088's public-route list (R11).

Portal (`src/hosted/`): `pages/you/YouAccount.tsx` `RowSwitch` (optimistic, reverts on error); new public page
`pages/mail-off/` + the router's public list; i18n ar + en; `api/schema.d.ts` regenerated; local mode keeps the row
hidden (signed-in only) and the parity tests list the new routes as account-only.

Website: the privacy policy's "Emails we send" paragraph, ar + en (§7c), and its page test.

Docs and knowledge: ADR-260, CHANGELOG, SYSTEM_OVERVIEW (mail jobs), TEST_PLAN, PATTERNS (signed opt-out link),
INFRA (pepper rotation voids opt-out links), CLAUDE.md public routes (`/mail-off`), `docs/operations/before-release.md`.

## 4. Cost and scale

Per mailed person: one billing-facts read, one profiles read, then per qualifying profile the verdict's reads for one
month (as if they opened Reports once). Stripe only for monthly list-price payers (D9). One Resend mail per person a
month, inside D12's budget. Up to ~280 people a month on the free Resend plan; past that, a paid plan and two numbers.

## 5. Tests (written first)

- `monthly-summary.test.ts` (pure): month boundaries; a UTC−8 profile on the 30th is deferred; a block per currency;
  empty and all-zero profiles left out (AC5); D7 default / OFF / ON_ALL with covered and uncovered profiles.
- `monthly-summary-mail.test.ts` (memory store + memory mailer): one mail per person with every qualifying profile;
  trialist in; co-owner who doesn't pay out; Accountant-only payer out; READ_ONLY / LOCKED / paused out; unverified,
  suppressed, opted-out, closing skipped; a profile read failure → person not mailed; dry run sends and posts nothing;
  second run → duplicates; send budget and first `capped` → `incomplete`; yearly line after 2 paid invoices, hidden
  without Stripe, on a Stripe failure, or with no saving.
- `profile-figures` parity with the verdict route (AC2); verdict's existing tests unchanged.
- `mail-off-token.test.ts`: round trip, tampered, wrong purpose. Routes: job token, admin dry run, public off/on (bad
  token, rate limit, origin), PATCH /v1/me, `/v1/me` field.
- Templates: both languages render every block; amounts and names isolated in Arabic; the ADR-159 pin allows exactly
  this template. Portal: the switch, `/mail-off`. Privacy page test updated. `test:db`: the candidates query, the
  migration. Terraform tftest: job absent by default.

## 6. Release-QA (portal, memory mailer)

`qa/features/portal/monthly-summary.yaml` + `qa/specs/portal/monthly-summary.spec.ts`:
- `monthly-summary-mail`: seeded profile with ₪ and $ income and payments last month; operator run; the dev outbox mail
  shows the same Came in / Owed / Overdue as Reports and the overview; its link opens that overview.
- `monthly-summary-off-link`: open the mail's link, press Turn off → "turned off"; the next run skips the person.
- `monthly-summary-account-switch`: You › Account switch off and on, persisted.
- `monthly-summary-yearly-line`: a monthly payer with 2 paid invoices gets the line; its link opens Switch to yearly.

## 7. Copy (needs Basel's approval)

Amounts and profile names are isolated left-to-right inside Arabic (ADR-101). Months are Levantine (ADR-253). The labels
reuse the portal's words: المستلَم (Reports' Received), المستحق (Owed), المتأخر (Overdue).

### 7a. The mail

**English**
- Subject: `Your {November} in MTB3A`
- Preview: `What came in, what's still owed, and what's overdue.`
- Headline: `{November 2026} at a glance`
- Intro: `Here's last month in your books, as MTB3A shows it today.`
- One panel per profile, titled with its name:
  - `Came in during {November}`: `₪12,400 · $900`
  - `Still owed`: `₪3,200 · $450`
  - `Overdue`: `₪1,100 · $200 (3 entries)`, or `Nothing overdue`
  - Link: `Open {profile name}`
- Yearly line (D9 only): `Switch to yearly and save {₪58} a year.` Link: `Switch to yearly`
- Outro: `Amounts stay in the currency you recorded them in; nothing is converted. Still owed and overdue are as of {1 December 2026}.`
- Footer: `Don't want this monthly email? Turn it off. You can turn it back on in You › Account.`

**Arabic**
- Subject: `{تشرين الثاني} في متابعة`
- Preview: `ما وصلك، وما زال مستحقًا لك، وما تأخّر.`
- Headline: `{تشرين الثاني 2026} باختصار`
- Intro: `هذا ما جرى في دفاترك الشهر الماضي، كما تعرضه متابعة اليوم.`
- One panel per profile, titled with its name:
  - `المستلَم في {تشرين الثاني}`: `₪12,400 · $900`
  - `المستحق`: `₪3,200 · $450`
  - `المتأخر`: `₪1,100 · $200 (3 قيود)`، أو `لا شيء متأخر`
  - Link: `افتح {اسم الملف}`
- Yearly line: `انتقل إلى الاشتراك السنوي ووفّر {₪58} في السنة.` Link: `انتقل إلى السنوي`
- Outro: `تبقى المبالغ بالعملة التي سجّلتها بها، دون أي تحويل. المستحق والمتأخر كما هما في {1 كانون الأول 2026}.`
- Footer: `لا تريد هذه الرسالة الشهرية؟ أوقفها. ويمكنك إعادتها من أنت › الحساب.`

### 7b. Portal

- You › Account row: `Monthly summary email` / `الملخّص الشهري بالبريد`; sub `On the 1st: what came in and what's owed` /
  `في أول كل شهر: ما وصلك وما زال مستحقًا لك`.
- `/mail-off`: title `Turn off the monthly summary?` / `إيقاف الملخّص الشهري؟`; button `Turn it off` / `أوقفه`; done
  `The monthly summary is off.` / `أُوقف الملخّص الشهري.`; button `Turn it back on` / `أعِد تشغيله`; broken link
  `This link no longer works. You can turn it off in You › Account.` / `لم يعد هذا الرابط يعمل. يمكنك إيقافه من أنت › الحساب.`

### 7c. Privacy policy ("Emails we send"), replacing one sentence

- Today (en): `Our emails never include amounts or your records, and we don't track whether you open them or click their links.`
- New (en): `Once a month, while you pay or try MTB3A, we email you a summary of the month before: per profile and per currency, what came in, what's still owed and what's overdue. You can turn it off with the link in it or in You › Account. Our other emails never include amounts or your records, and we don't track whether you open any of them or click their links.`
- Today (ar): `لا تتضمن رسائلنا أبدًا أي مبالغ أو سجلات، ولا نتتبّع فتحك لها أو نقرك على روابطها.`
- New (ar): `ومرة كل شهر، ما دمت مشتركًا في متابعة أو تجرّبها، نرسل إليك ملخّصًا للشهر السابق: لكل ملف وبكل عملة، ما وصلك وما زال مستحقًا لك وما تأخّر. يمكنك إيقافه من الرابط الذي فيه أو من أنت › الحساب. أما رسائلنا الأخرى فلا تتضمن أبدًا أي مبالغ أو سجلات، ولا نتتبّع فتحك لأيٍّ منها أو نقرك على روابطها.`

The policy change ships with the website (`web-v*`) before the job is switched on (before-release.md).

## 8. Business / product impact

- The epic's main retention lever (D10): every payer and trialist sees, each month, the money MTB3A tracked for them
  without opening the app; monthly payers get the yearly offer at the moment it's most credible.
- Last buildable story of MUT-528 (MUT-536 waits for 100 payers).
- Ships dark (Terraform switch off), inside the free Resend plan up to ~280 people a month; one small migration.

## 9. Eng review (2026-11-21), folded in

R1 mail cap → D12. R2 recipients → D2. R3 one-click headers → dropped, D8. R4 scanners → button, D8. R5 turning back
on → D7. R6 zones → D3. R7 unverified → D2. R8 parity + per-currency count → D4, D5. R9 posting door, dry run,
partial reads → D5. R10 Stripe-less and null saving → D9. R11 route pins → §3. R12 privacy → D11, §7c. R13 pepper
rotation → D8. R14 `sentKeys` → dropped, D12. R15 entries from existing reads → D10. R16 no alert → D13. R17 events,
Arabic names → D14, §3.
