# MUT-331: Self-service signup, email verification and forgot-password for GA

Status: **Approved by Basel, 2026-10-20 (Q1–Q5 and Q4b, §10).** Planning only; no feature code.
Ticket: MUT-331 · epic MUT-322 (GA gate, label `ga-gate`) · decision record **ADR-159** (Accepted).

**Basel's answers, in one place:**
- **Q1, provider: Resend**, through Barmajiyat's existing account (Malafat's).
- **Q2: verify first.**
- **Q3:** a password is required; a passkey is optional and **suggested as the more secure way** after the first sign-in.
- **Q4:** block disposable addresses, **and accept only business email automatically**. A domain that passes the automatic checks signs up at once. Anything else, **free webmail included (Q4b)**, waits for the operator's approval.
- **Q5: Freelancer by default.**

Q4 adds an approval step, which partly overrides Basel's own 2026-10-19 "no approval step" (MUT-331 comment 12133). The waitlist stays rejected: every verified person gets an account, and some wait for review first.
Tracker: Jira · barmajiyat.atlassian.net · project MUT.
Relates: MUT-235/236 (setup links, ADR-088), MUT-306 + firm-books §10 (invites need email, D10/D14), MUT-115 (passkeys), MUT-112 + ADR-155 (custom domain), MUT-197 (Turnstile pattern), MUT-324/354 + ADR-102 (terms), MUT-300 (firm switch), MUT-332 (billing), MUT-333 (account closing), ADR-024 (residency).

## 1. Problem and acceptance criteria

Accounts are operator-issued only. The rule is ADR-037 §1. The ticket calls it "decision 4" because it was the fourth of Basel's 2026-10-10 decisions that ADR-037 records ("accounts are operator-issued only"). ADR-088 kept it after the setup links. `server/src/__tests__/no-self-registration.test.ts` pins it: the public `/v1` operations are exactly sign-in, device sign-in, the setup-link pair and the public FX snapshot, and no path outside `/admin/` may match `sign-?up|register|invite|forgot|reset`. `scripts/bundle-rules.ts` `HOSTED_RULES` also bans the portal from saying "sign up", "create account", "forgot", "reset password", "invite" and their Arabic forms.

That works for 10 pilot users. It cannot work for GA, whose goal is that anyone can sign up, pay and leave without the operator (MUT-322). Basel decided on 2026-10-19 that GA has **open signup with email verification**: no waitlist and no approval step (MUT-331 comment 12133). The server also has no email provider at all. MUT-306 (firm invites) needs one too, because firm-books D10 says invite links are mailed only to the invited address.

| # | AC (ticket) | Met by |
|---|---|---|
| A1 | Basel has approved the brief and ADR | §10 answers recorded 2026-10-20; ADR-159 Accepted |
| A2 | The build stories are filed under MUT-322, labelled `ga-gate` | §12, filed with Blocks links |

## 2. What already exists (reuse first)

| Need | Exists | How it's reused |
|---|---|---|
| A one-time link that sets a password | ADR-088: `account_setup_tokens` holds an HMAC digest under the session pepper, the token rides in the URL fragment, a link lasts 72 h and works once, and a newer link supersedes an older one. `/v1/account-setup/check` and `/v1/account-setup` are the routes; `/setup` is the page (MUT-236). | Signup and forgot-password both **end on the same `/setup` page and the same redeem**. Only how the link is issued and delivered is new. |
| Terms acceptance | ADR-102 §5: the setup redeem requires `acceptedTermsVersion`, records `terms_acceptances` in the redeem's transaction, and stores `clientRelease` (MUT-354). | A self-signed-up person accepts the terms at the same step as an operator-issued one. Nothing new. |
| A new password's rules | `NEW_PASSWORD_POLICY` (12–128, NIST 800-63B) | Unchanged. |
| Accounts aren't revealed | ADR-037 §4: same 401 body and matched timing, throttle keyed on the normalised email whether or not an account exists | Signup and recovery give the **same 202** for every address (§5). |
| Account creation | `POST /admin/v1/users` creates the user and their personal profile (`personalProfileFor(locale, settings)`) | The SIGNUP redeem calls the same creation path, so a self-signed-up account looks exactly like an operator-issued one. |
| IP limits and the client IP | `SlidingWindowRateLimiter`, `SIGN_IN_POLICY`, `requestClientIp` / `isSamePortalOrigin` (ADR-155 §3, front-door token) | New limiters on the same class; the client IP comes from the front door. |
| Bot check | MUT-197's plan (Turnstile, explicit render in the page language, lazily loaded, verified server-side, fails closed). Planned, **not built**. | The API verifies the token itself. `verifyTurnstile` is written once, server-side, and MUT-197 can reuse it. |
| Hosts | `config/hosts.json` / `HOSTS` (ADR-155); `setupLinkOrigin` | Links in emails use the portal origin, and the sender domain comes from `domain`. Nothing is hardcoded (`no-hardcoded-hosts.test.ts`). |
| Firm tier | MUT-300: `firmEnabledAt` on an owned Business profile, turned on by the operator, requested by the owner | It is the tier boundary (MUT-322). Signup doesn't create firms (§6, Q5). |

## 3. Signup flow (GA)

```
Landing CTA / portal sign-in "Create an account"
   │
   ▼
/signup  (portal, Arabic by default)
   email + language (from the page) + Turnstile token
   │  POST /v1/signups   → always 202 {status:"sent"} (same body, same floor time)
   ▼
"Check your email" screen ── "Didn't get it? Send again" (cooldown 60 s)
   │
   ▼  email (person's language): "Finish creating your Mutaba3a account" → <portal>/setup#<token>
/setup  (the MUT-236 page, purpose SIGNUP)
   email shown read-only · new password · ☐ I agree to the terms (ADR-102)
   │  POST /v1/account-setup  (existing route; SIGNUP branch creates the User + personal profile)
   ▼
POST /v1/sessions (signs in, as today) → first-run: Home on the personal profile
   │
   ▼  (billing, MUT-332 decides: trial first or checkout first)
```

What the server does on `POST /v1/signups { email, locale, turnstileToken }`:
1. It checks, in order: same-origin (`isSamePortalOrigin`), the IP limit, Turnstile, the email's shape and length (the sign-in ceiling), the disposable-domain block and the no-MX refusal (§7a), and the per-address limit. It then classifies the domain (§7a). It does this for every address, account or not, so timing doesn't depend on whether an account exists.
2. It looks the email up:
   - **No account:** issue a **SIGNUP** token bound to the *email* (no User row; see the next paragraph). The mail is "finish creating your account".
   - **An account exists:** issue nothing. The mail is "you already have an account", with a sign-in link and a recovery link. The person learns this only by owning the mailbox.
   - **A suppressed address** (hard bounce or complaint): no mail.
3. It answers the same `202 {status:"sent"}` in every case, no earlier than a fixed floor time (§5).

**No User row exists until redemption.** This is the same rule firm-books §10.1 set for invites (D10). Unverified addresses never become accounts. Abuse fills only the token table, which is pruned (§7), and the `users` table and the cap of 6 owned profiles stay clean. Today `AccountSetupToken.userId` is required. The build makes it nullable and adds `email` (normalised), with a CHECK: exactly one of `userId` / `email` is set, and `email` is only allowed on the SIGNUP and (later) INVITE purposes.

**Redeeming a SIGNUP link** (`POST /v1/account-setup`, new branch): in one transaction, re-check that no ACTIVE user holds the email (a racing signup, or the operator creating the same email, wins first: 410 `SETUP_LINK_UNUSABLE` `used`). Then create the User with that email, locale and password, plus the personal profile (the `personalProfileFor` path, with the default currency and timezone the page sends). Set `emailVerifiedAt = now`, record the terms acceptance, claim the link and audit `user.signed_up` (USER).

The user's status comes from the classification stored on the token:
- **`ACTIVE`** for a verified business domain;
- **`PENDING_REVIEW`** otherwise (§7a): webmail, a young domain, or a domain whose checks failed or couldn't be completed.

A session is still not issued: the page signs in through `POST /v1/sessions`, as ADR-088 §5 requires (there is one way to mint a session). Sign-in for a `PENDING_REVIEW` account with the **right** password answers 403 `ACCOUNT_UNDER_REVIEW`, and the portal shows the waiting screen. A wrong password is the usual 401 with matched timing, so nothing is revealed to someone who doesn't hold the password.

**SIGNUP links last 24 hours**, not 72. The person just asked for the link and is waiting for it, and a shorter life shrinks the token table under abuse.

## 4. Forgot-password flow

```
/sign-in "Forgot your password?" → /recover  (email + Turnstile)
   │  POST /v1/account-recovery → always 202 {status:"sent"}
   ▼  email: "Set a new password" → <portal>/setup#<token>  (purpose RESET)
/setup (existing page, RESET copy) → POST /v1/account-setup (existing RESET branch)
```

- An **ACTIVE** account gets a **RESET** link. This is the existing purpose, the existing 72-hour life cut to **1 hour** for self-requested links (operator links keep 72 h), and the existing semantics from ADR-088 §3: *nothing changes until the link is used*. The current password and sessions keep working, so someone who requests a reset for another person's address can't lock them out. Redeeming revokes every session, clears the lockout and audits `user.password_set`, as today.
- A **pending** account (operator-created, password never set) gets a fresh **SETUP** link, so a pilot user who lost Basel's link can recover alone.
- A **DISABLED** account, an unknown address or a suppressed address gets no mail and the same 202.
- **Superseding:** a new link cancels the person's open one (ADR-088 §2). That means anyone can cancel a pending operator link by requesting recovery. This is acceptable because the person receives the new link in the same mailbox. The per-address limit (§7) stops it from being used to flood.
- **A "your password was changed" notice** goes to the account's address after every `user.password_set` and `user.password_changed` (MUT-237). It says when it happened and what to do if it wasn't you. This is now cheap, and it is the standard defence against an attacker who reaches a mailbox.

**Pilot accounts benefit at once.** Every operator-issued account can recover alone once this ships, with no migration. Their `emailVerifiedAt` stays null until they first redeem a mailed link. Nothing gates on it in v1. It exists for billing receipts and invites to read later.

## 5. Accounts are still never revealed (ADR-037 §4 kept)

- Both public routes answer one body, `202 {status:"sent"}`, for every address. Validation errors that depend only on the input itself (a malformed email, a disposable domain, a missing Turnstile token) may answer 400/403, because they reveal nothing about accounts.
- **Timing.** The "exists" and "doesn't exist" branches do different work: they send different mail, or none. Each route therefore answers no earlier than a fixed floor measured from the request's start, set above the work's p99:
- `/v1/signups`: `SIGNUP_RESPONSE_FLOOR_MS`, default 3000 ms. It covers the domain check (2 s budget) plus the send.
- `/v1/account-recovery`: `RECOVERY_RESPONSE_FLOOR_MS`, default 1500 ms.

The domain check runs for every address, so it never splits the branches. The mail is sent inside the request, before the floor, because Cloud Run throttles CPU after the response, so sending after it isn't reliable (TD-017 keeps one instance). A send that takes longer than the floor is logged, and the answer is still the same 202.
- Rate limits key on the normalised email whether or not an account exists, as the sign-in throttle does.

## 6. The tier at signup (Q5)

- Signup creates a person and their **personal profile**. That is all an operator-issued account gets today.
- The tier is **Freelancer by default** (Basel, Q5). Firm features stay behind MUT-300's switch: the owner adds a Business profile and presses "Request firm features", and the operator turns them on. Until firm books v1 ships, firms pay the Freelancer price (MUT-322).
- **What billing (MUT-332) gets:** a new account in a state its entitlements define. This brief fixes only the handover. After the first sign-in, the portal reads `Me` and, if billing says the account needs a plan, shows billing's step (trial or checkout, MUT-332 decides). Signup writes no plan column. The plan's owner is billing's entitlement model, so the two can't disagree. This is posted on MUT-332.
- **ADR-160's trial (MUT-332, merged 2026-10-20):** 14 days with no card, then read-only, then locked. For a `PENDING_REVIEW` account the trial starts at approval, not at signup.
- **Malafat-fed firms** never sign up. They come through the operator and Malafat (ADR-025/037), and billing marks them "covered by Malafat" (MUT-332). If such a person uses `/signup` with their address, they get the "you already have an account" mail.

## 7. Abuse controls

| Control | Where | Default (env-overridable) |
|---|---|---|
| Turnstile | `/signup` and `/recover` forms. The **server** verifies the token (`siteverify`, 5 s timeout, fails closed: 403 `CHECK_FAILED`). The widget is explicit-render, in the page language, and lazily loaded on first approach (MUT-197 D2/R2). | `TURNSTILE_SECRET` (Secret Manager); `__TURNSTILE_SITE_KEY__` build value, using Cloudflare's always-pass test key outside production (MUT-197 D4) |
| Per-IP limit | both routes, through `requestClientIp` (front door) | 10 requests/hour/IP |
| Per-address limit | both routes, keyed on the normalised email whether or not an account exists | 1 mail/60 s, 5 mails/24 h per address |
| Global send cap | the mailer | 500 mails/24 h. Beyond it the mailer refuses (still 202), logs `error` and pages the operator through the existing uptime alert channel. This protects the sending reputation and the bill. |
| Disposable addresses and business-email check | `/v1/signups` only (recovery always works) | §7a (Q4, Q4b) |
| Bounce and complaint suppression | provider webhook → `email_suppressions` (address, reason, at). A suppressed address gets no mail. | Hard bounce and complaint suppress. A soft bounce doesn't. |
| Token pruning | daily: delete unredeemed SIGNUP tokens 7 days after expiry | Also closes TD-146 for SIGNUP rows. Other purposes are kept for audit. |
| Signup switch | `SELF_SIGNUP_ENABLED` (default `false`). While off, `/v1/signups` answers 404 and `/signup` shows "Accounts are by request for now" with a link to the landing `/hosted` form. **Recovery is not behind the switch**: it ships to pilot users as soon as email works. | Basel turns it on at GA. |

### 7a. Business email only; everything else waits for the operator (Q4, Q4b)

Basel, 2026-10-20: block disposable addresses, and accept only business email automatically. A domain whose checks pass signs up at once. Anything else waits for the operator's approval, and free webmail is "anything else" (Q4b).

**Refused outright** (400 `EMAIL_NOT_ACCEPTED` with `details.reason`; it depends only on the input, so it reveals nothing about accounts):
- `disposable`: the domain is on the vendored disposable list (`server/src/email/domains/disposable.txt`, from the public CC0 `disposable-email-domains` list, refreshed by `npm --prefix server run email-domains:update`, with the date and source commit in the header).
- `no-mail`: the domain has no MX record and no A/AAAA fallback, so it can't receive the verification mail.

**Classified, for every other address**, by `classifyEmailDomain(domain)` behind a `DomainChecker` port (adapters: `dns` in production; `fixture` in tests and QA, a fixed table of example domains):

| Result | Rule | Outcome at redeem |
|---|---|---|
| `webmail` | On the vendored free-webmail list (`free-webmail.txt`: gmail.com, outlook.com, hotmail.com, live.com, icloud.com, yahoo.com, proton.me and the like, plus the regional ones Basel adds) | `PENDING_REVIEW` |
| `business` | Not webmail, **and** an MX record, **and** the apex or `www.` resolves (A/AAAA), **and** RDAP shows the domain was registered ≥ 90 days ago | `ACTIVE`, instant |
| `business-unverified` | Not webmail, but any check fails, times out (2 s total) or can't be answered (some ccTLDs have no RDAP) | `PENDING_REVIEW` |

- The check uses **DNS and RDAP only**. The server never fetches the domain's website, which would be an SSRF door to arbitrary hosts. RDAP gets the domain name only, never the address.
- Results are cached in memory for 24 h per domain.
- The result and its reasons (e.g. `["rdap-age-12d"]`) are stored on the SIGNUP token and copied to the review row. The operator sees why.

**The review queue:**
- `signup_reviews (userId, domain, classification, reasons[], createdAt, decidedAt, decision, decidedBy)`.
- The operator surface follows ADR-037 §1's pattern:
  - `GET /admin/v1/signup-reviews?state=pending`;
  - `POST /admin/v1/signup-reviews/{userId}/approve|decline`;
  - `npm --prefix server run signups:review`, which lists and decides.
- **Approve:** status → `ACTIVE`; the person gets "Your Mutaba3a account is ready" with a sign-in link. Audited `user.signup_approved` (ADMIN).
- **Decline:** the account and its empty personal profile are hard-deleted (nothing was ever written). The person gets "We couldn't open your account", with the support address. Audited `user.signup_declined` on the operator log, since the profile is gone. The address may sign up again later.
- **Operator alert:** each new review item mails `OPERATOR_ALERT_EMAIL` (the mailer, at most one digest an hour), so the 2-working-day support promise (MUT-322) is reachable.
- **Waiting is safe:** a `PENDING_REVIEW` person can use recovery (they own the mailbox), but can't sign in on the portal or phone. Billing never charges a pending account. Accounts never wait silently: the waiting screen says what happens next and when.
- **Expected load:** most freelancers use webmail, so at GA most signups land in the queue. At ~150 signups a month (the 1,000-user estimate) that is about 5 a day, each a one-line approve. If the queue becomes the bottleneck, Basel can move a webmail provider to instant from the list, with no code change. That is a reversible, recorded decision.

The limiters are in process, like sign-in's. That holds while `max_instances = 1` (TD-017). A second instance would need a shared store for every limiter, not just these.

## 8. Email: provider, sender domain, templates (Q1)

### 8.1 What we will send (volume)

| Mail | When |
|---|---|
| Finish creating your account (SIGNUP) | each signup request |
| You already have an account | a signup request for an existing address |
| Set a new password (RESET) / Finish setting up (SETUP) | each recovery request |
| Your password was changed | each password set or change |
| Firm invite (MUT-306) | each invite, after the pilot |

That is about 1–2 mails per person per month in steady state, plus signups. **The estimate:** 10 users ≈ 30/month; 100 users ≈ 300/month; 1,000 users ≈ 3,000/month (assuming ~150 signups/month at that size, plus abuse attempts the caps bound). Stripe sends its own receipts.

### 8.2 Providers compared

Sources checked 2026-10-20: AWS's SES endpoint list (Tel Aviv is listed), Resend's regions page, and the vendors' pricing pages as reported by third-party trackers. Prices are approximate; re-check them on the day the account is opened.

| | **Amazon SES, Tel Aviv (`il-central-1`)** | **Resend** (Barmajiyat already uses it for Malafat) | **Scaleway TEM** (France) | **Postmark** | **Mailgun EU** |
|---|---|---|---|---|---|
| Where data sits | **Israel**, the same country as our Cloud SQL (`me-west1`, ADR-024). The HTTPS API is available there; SMTP isn't, and we don't need SMTP. | Sends from Ireland (`eu-west-1`), but account data, logs and metadata are **stored in the US** (Resend docs) | EU (France) | US only; no EU region | EU (Germany), chosen at signup |
| Cost at 10 / 100 / 1,000 users | ≈ $0.01 / $0.03 / $0.30 a month ($0.10 per 1,000). No free tier. | $0 / $0 / $0–20 (free: 3,000 a month **but 100 a day**, so a signup burst at 1,000 users hits the cap; Pro $20 for 50k) | €0 / €0 / ≈ €0.70 (300 a month free, then €0.25 per 1,000) | $15 / $15 / $15 (10k plan; the free 100 a month is a test tier) | $0 / $0–15 / $15 (free 100 a day; Basic $15 for 10k) |
| Setup work | **The most.** It's a new vendor: an AWS account under Barmajiyat Ltd, a DPA, IAM, the Terraform `aws` provider, a domain identity with Easy DKIM, a custom MAIL FROM, and **leaving the sandbox** (200 a day and verified recipients only until AWS approves; about a day, needs the live site). Bounces arrive through SNS → an HTTPS endpoint that verifies SNS signatures. | **The least.** Barmajiyat's account, DPA and Malafat's patterns (`RESEND_WEBHOOK_SECRET`, svix-signed webhooks) already exist. A separate team or domain keeps Mutaba3a's sending reputation apart from Malafat's. | Moderate. A new vendor; webhooks via Scaleway Topics & Events. | Low | Low |
| Bounce and complaint webhooks | SNS (signed) | Yes (signed) | Yes | Yes | Yes |
| Arabic RTL | Provider-neutral: we render the HTML ourselves (§8.4) | same | same | same | same |
| New sub-processor in the privacy policy | Amazon Web Services (Israel) | Resend (US storage, EU sending); already Malafat's | Scaleway (France) | Postmark (US) | Mailgun (EU) |

**Decision (Basel, Q1, 2026-10-20): Resend, through Barmajiyat's existing account.** Below is the recommendation as it was put to him (SES), kept for the record.

What choosing Resend means for the build:
- **Its own domain and key.** Mutaba3a sends from its own verified domain on the apex, with sending region `eu-west-1`. That gives it its own domain reputation, separate from Malafat's tenant domains. Its API key has `sending_access` restricted to that domain, so neither product's key can send as the other.
- **Credentials:** `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET` live in Secret Manager under Mutaba3a names, in the API's Terraform. Webhooks are svix-signed, the same pattern Malafat verifies.
- **The daily limit is the account's, and the account is shared.** Before the signup switch goes on, the operator confirms the Barmajiyat Resend plan covers both products' volume (the free plan's 100 a day would be shared with Malafat). The global send cap (§7) defaults to 500 a day and is set below the plan's limit.
- **Residency, stated honestly:** messages go out from Ireland, but Resend stores account data, logs and metadata in the US. The privacy policy's hosted section names Resend, says what it receives (the address, the message and its delivery events) and that its records sit in the US under Resend's DPA. "Your records stay in Tel Aviv" stays true for money records: an email carries a link, never amounts.
- **No tracking:** open and click tracking are switched off on the Mutaba3a domain in Resend. `npm --prefix server run email:check` reads the domain through Resend's API and fails if tracking is on, if DKIM, SPF or DMARC aren't verified, or if the region isn't `eu-west-1`. The release preflight runs it whenever `MAILER=resend`.
- **There is no sandbox to leave**, so §8.5 step 4 falls away. The domain is verified in Resend once its DNS records are in.
- The `Mailer` port keeps the provider reversible. An SES adapter is a later, single-file change if residency ever needs Israel.

**Recommendation as asked: Amazon SES in Tel Aviv.**
- It is the only candidate that keeps the email address and message log in Israel. That matches the promise the hosted section of the privacy policy makes (data sits in Tel Aviv).
- It is the cheapest at every size.
- It has no daily cap once out of the sandbox.

The cost is half a day of operator setup and a sandbox exit. The setup is a one-time cost; the residency gap would be permanent. **Runner-up: Resend.** It is fastest to set up and Barmajiyat already uses it, but it stores data in the US and its free tier caps at 100 mails a day. The `Mailer` port (§8.3) means swapping later is one adapter, so this choice is reversible.

**Credentials (had SES been chosen):** the eng-ticket would prefer **workload identity federation** (a Cloud Run service-account OIDC token → `AssumeRoleWithWebIdentity` on a send-only IAM role). That means no long-lived AWS key exists anywhere. The fallback is a send-only IAM access key in Secret Manager, rotated by Terraform.

### 8.3 Shape in the server

- A `Mailer` port (firm-books §10.3) with `send({ to, template, locale, vars, idempotencyKey })` and these adapters:
  - `resend` in production (Q1);
  - `log` in dev, which writes the rendered mail to the log with the link;
  - `memory` in tests and QA, read through `GET /admin/v1/dev-outbox`, which exists only when `NODE_ENV !== 'production'` and is behind the admin token;
  - `noop` when unconfigured, which logs `warn` once.
- `MAILER=resend|log|memory|noop`. Production refuses to start with `noop` when `SELF_SIGNUP_ENABLED=true` (fail fast, CLAUDE.md config rules).
- `POST /webhooks/email/<provider>` sits outside `/v1`, verifies the provider's signature and writes `email_suppressions`. It is not a public `/v1` operation, so the inventory test stays about `/v1`.
- Templates are TypeScript functions `(locale, vars) → { subject, text, html }` in `server/src/email/templates/`. The server has no i18n layer (precedent: `PERSONAL_PROFILE_NAME`), and these are server-generated strings, so a per-locale record is enough. A test pins that every template has `en` and `ar`.

### 8.4 Arabic and RTL templates

- One language per mail: the page's language at signup or recovery, otherwise the account's `locale`. Arabic is the default (ADR-077).
- Every mail has a `text` part and a minimal `html` part: `<html lang="ar" dir="rtl">`, inline styles, system fonts (no web fonts, which mail clients block anyway), and the brand's AAA inks.
- Amounts and dates never appear. The link is wrapped in `<bdi dir="ltr">` for the copy-paste fallback (ADR-101's bidi rule).
- **No open or click tracking, ever.** Tracking would rewrite the `/setup#<token>` link through the provider's redirect host and load a pixel, against the no-tracking promise. Tracking is off in the provider config and asserted by a test on the adapter's request.
- The mail is plain enough to read the same in Gmail, Outlook and Apple Mail in both directions. QA renders both languages (§11).

### 8.5 Sender domain and how it sequences with MUT-112

We can't send from `*.run.app` or `mutaba3a.netlify.app`, because we don't control their DNS. Sending from a Barmajiyat or Malafat domain was rejected: a mail from another brand's domain asking you to set a Mutaba3a password is exactly what phishing looks like, and it would mix reputations. So **live email needs the apex from MUT-112**:

1. **Build** (stories S1–S3) can merge before the domain exists. `MAILER=log` and `SELF_SIGNUP_ENABLED=false` mean nothing sends. The sender is computed from `config/hosts.json` `domain`, and it is `null` until then.
2. **MUT-112 lands** (a pilot gate, so before GA). The apex is in the Cloudflare zone that the `frontdoor` stack owns (ADR-155 §4).
3. **Email DNS:** the operator adds the domain in Resend (region `eu-west-1`, tracking off). A new operator-applied Terraform stack `server/infrastructure/email` writes the records Resend gives into the Cloudflare zone: the DKIM TXT, the `send.<apex>` MX + SPF for the return path, and `_dmarc.<apex>` (`p=none` with a report address; it moves to `quarantine` after 30 clean days). The records are passed in as variables, so no provider credential sits in Terraform. The From is `Mutaba3a <no-reply@<apex>>`, with Reply-To set to the support address (MUT-322: support by email).
4. **Verify:** Resend verifies the domain, and `email:check` passes.
5. **Recovery goes live:** `MAILER=resend`. Pilot users can now recover alone.
6. **GA:** billing is live (MUT-332) and MUT-333's close-account works. Then `SELF_SIGNUP_ENABLED=true` and the landing CTA switches (S4).

`before-release.md` gets each operator step (the memory rule: unapplied infra steps go there).

## 9. Passkeys (Q3), terms, the pilot, the phone

- **Passkeys (Q3, Basel 2026-10-20): a password is required, and a passkey is optional and actively suggested.** Signup always sets a password, so GA never waits on MUT-115 or WebAuthn. Once MUT-115 ships (after MUT-112), the first sign-in after signup shows a dismissible card: "Add a passkey: the more secure way to sign in. Your password still works." It offers **Add a passkey** (MUT-115's registration) or **Not now**. Dismissing hides it for 30 days; it's offered at most three times, and never once a passkey exists. The same card appears once for pilot and operator-issued accounts after MUT-115 ships. Story S6. Passkey-only accounts stay out of scope, because the password is required.
- **Terms:** accepted at `/setup` (ADR-102 §5) for every purpose, with `clientRelease` (MUT-354). The `/signup` form adds one line, "You'll accept the terms when you set your password", linking `/terms`. There is no second checkbox. **Privacy policy:** a new hosted-section paragraph names Resend (whose records sit in the US) and Cloudflare Turnstile, says what each receives, and says that signup looks the address's domain up in public DNS and registry (RDAP) records. That is copy only; the terms text doesn't change, so no version bump.
- **Pilot accounts:** unchanged. Operator creation (`provision:user`, setup links) stays for support, for Malafat-fed firms and for the pilot itself. During the pilot the landing still shows the `/hosted` request form (MUT-186). At GA its CTA becomes "Create an account" (S4), and the request form stays for firms that want help.
- **`HOSTED_RULES` and the no-self-registration test** are changed deliberately, not bypassed. The portal may now say "create account", "forgot", "reset password" and their Arabic forms. "invite" stays banned until MUT-306, and "subscribe" until billing. The test's public-operations pin becomes the new exact list (adding `POST /v1/signups` and `POST /v1/account-recovery`), and the path regex check gets the two new paths as named, reviewed exceptions. A third new test asserts that `/v1/signups` answers 404 while the switch is off.
- **The phone (Flutter):** the sign-in screen gets "Forgot your password?" (opens `<portal>/recover` in the in-app browser) and, at GA, "Create an account" (opens `/signup`). **App Store guideline 5.1.1(v)** requires an app that lets people create an account to let them delete it in the app, so the create link waits for MUT-333's close-account in the phone. The recovery link doesn't.

## 10. Decisions for Basel (one at a time)

| Q | Decision | Recommended | Answer |
|---|---|---|---|
| Q1 | Email provider | Amazon SES, Tel Aviv | **Resend**, through Barmajiyat's account (§8.2) |
| Q2 | Verify before or after the password | Verify first: the email link leads to set-password (reuses `/setup`) | **Verify first** |
| Q3 | Passkeys at signup | No; a password at signup, passkeys after sign-in per MUT-115 | **Password required; passkey optional and suggested as more secure after the first sign-in** (§9, S6) |
| Q4 | Disposable-email policy | Block a vendored public list at signup only | **Block the list, and accept only business email automatically; anything else waits for operator approval** (§7a) |
| Q4b | Free webmail | Goes to operator approval | **Operator approval** |
| Q5 | Tier at signup | Freelancer by default; Firm via MUT-300's request | **Freelancer by default** |

Decided in this brief without a question (flag any you disagree with):
- no User row until redemption;
- SIGNUP links last 24 h, self-requested RESET links 1 h;
- a fixed response floor;
- the per-IP and per-address limits and the 500/day global cap;
- recovery isn't behind the signup switch;
- the "password changed" notice;
- no tracking in mail;
- no interim sender domain;
- route names `/v1/signups` and `/v1/account-recovery`.

## 11. QA scenarios (release-qa, `portal` app; per CLAUDE.md Phase 5)

The `memory` mailer plus `GET /admin/v1/dev-outbox` lets a spec read the mail and follow its link. Turnstile uses Cloudflare's always-pass test key; the "refused" case uses the always-fail test key.

| Feature id (`qa/features/portal/signup.yaml`, `recover.yaml`) | Steps, as the user would say them | Promised outcome |
|---|---|---|
| `signup.create` (core) | Open /signup with no language chosen, type a new email, pass the check, press Continue; open the mail's link; type a password, tick the terms, press Create account | The page is Arabic and RTL; "Check your email" shows; the mail is in Arabic; /setup shows the email read-only; you land on Home of your personal profile, signed in. The same in English. |
| `signup.existing-email` | Sign up with an address that already has an account | The same "Check your email" screen; the mail says you already have an account, with sign-in and recovery links; no second account exists |
| `signup.expired-link` | Open a signup link after 24 h | "This link has expired", with "Send a new link"; no password form |
| `signup.check-refused` | Sign up when the bot check fails | "The check didn't pass, try again"; the email stays typed |
| `signup.disposable` | Sign up with a throwaway-domain address | "Please use a permanent work email address"; no mail sent |
| `signup.business-instant` | Sign up with an address on a domain that passes the checks (fixture domain), finish /setup | Signed in straight away on Home |
| `signup.review-webmail` (core) | Sign up with a webmail address (fixture `gmail.com`), finish /setup; the operator approves the review; sign in | After /setup: "We're reviewing your account. We'll email you within 2 working days." Sign-in shows the same screen. The approval mail arrives, and sign-in lands on Home. In English and Arabic. |
| `signup.review-declined` | Same, but the operator declines | The decline mail arrives with the support address; sign-in with that email is refused like any unknown account |
| `signup.no-mail-domain` | Sign up with an address whose domain has no mail server (fixture) | "This address can't receive email"; no mail sent |
| `signup.rate-limited` | Press "Send again" twice inside a minute | "Please wait a minute before asking again" |
| `signup.closed` | Open /signup while signup is off | "Accounts are by request for now", linking to the landing request form |
| `signup.375` | `signup.create` at 375 px in Arabic | Nothing is clipped or overflows (MUT-165 spacing guard) |
| `recover.reset` (core) | On sign-in press "Forgot your password?", type your email, pass the check; open the mail's link; set a new password | You are signed in with the new password; another browser signed in before is signed out; a "password changed" mail arrives |
| `recover.unknown` | Recover an address with no account | The same confirmation screen; no mail in the outbox |
| `recover.pending-account` | Recover an operator-created account that never set a password | A setup mail arrives; the link sets the first password |
| `passkey.suggest` (after MUT-115) | Sign in for the first time after signup | The "Add a passkey" card shows; Not now hides it; adding one stops it showing |
| Phone `ios.signin.recover-link` | On the app's sign-in screen tap "Forgot your password?" | The portal's /recover page opens in the in-app browser, in the app's language |

## 12. Build stories (filed 2026-10-20 under MUT-322, label `ga-gate`, with Blocks links)

| # | Story | Blocked by |
|---|---|---|
| S1 · MUT-359 | Server: transactional email with Resend. `Mailer` port and adapters (`resend`, `log`, `memory` + dev outbox, `noop`), templates in en/ar, the svix-signed bounce/complaint webhook → `email_suppressions`, the global send cap, the "password changed" notice, `email:check`, the `email` Terraform stack (DNS records only), runbook and before-release steps | MUT-112 (for the live-sending AC only) |
| S2 · MUT-366 | Server: signup and recovery routes. SIGNUP purpose (email-bound token, User on redeem, `emailVerifiedAt`), recovery issuing RESET or SETUP, Turnstile verify, limits, response floors, signup switch, token pruning, the test and OpenAPI changes, audit `user.signed_up` | S1 |
| S3 · MUT-367 | Server + operator: business-email check and the review queue. Disposable and webmail lists with an update script, the `DomainChecker` port (DNS + RDAP; fixture adapter), the `PENDING_REVIEW` status and the 403 `ACCOUNT_UNDER_REVIEW` sign-in answer (portal + device), `signup_reviews`, admin routes + `signups:review` CLI, approve/decline mails, the operator digest mail | S2 |
| S4 · MUT-368 | Portal: `/signup`, `/recover`, sign-in links, `/setup` SIGNUP copy, the under-review screen, first-run, the lazy Turnstile widget, `HOSTED_RULES` revision, bundle origin + CSP, en/ar copy, QA specs `signup.*` and `recover.*` | S3 |
| S5 · MUT-369 | Landing + privacy: the GA CTA switch (build value), privacy-policy processors (Resend with US storage, Cloudflare Turnstile), what the domain check sends to RDAP, `/hosted` copy | S4 |
| S6 · MUT-370 | Portal + phone: suggest a passkey after the first sign-in (dismissible card, at most 3 times, hidden once a passkey exists) | MUT-115, S4 |
| S7 · MUT-371 | Phone: "Forgot your password?" now, and "Create an account" once in-app account deletion exists; the under-review answer at sign-in; iOS QA flows | S4, MUT-333 (create link only) |

S1 (MUT-359) also **blocks MUT-306**, because invites need the mailer. This replaces firm-books D14's "MUT-306 picks the provider": ADR-159 picks it now, against the same criteria.

## 13. Impact, cost, i18n, infra

- **Cost:** email rides Barmajiyat's Resend plan. Mutaba3a's ~3,000 a month at 1,000 users is within the $20 Pro plan, and the free plan's 100 a day is shared with Malafat (operator check, §8.2). Turnstile and RDAP are free. Operator time: about 5 one-line approvals a day at GA (§7a).
- **Infra:** a new `server/infrastructure/email` stack (operator-applied). New secrets: `TURNSTILE_SECRET`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`. New env: `MAILER`, `SELF_SIGNUP_ENABLED`, `SIGNUP_RESPONSE_FLOOR_MS`, `RECOVERY_RESPONSE_FLOOR_MS`, `OPERATOR_ALERT_EMAIL`, `DOMAIN_CHECK=dns|fixture`, limit overrides.
- **i18n:** all copy en/ar, Arabic by default, RTL at 375 px. Mail templates have both languages, pinned by a test.
- **Security:** no new session path. Every link still goes through the ADR-088 redeem. Tokens are in the fragment, digested under the pepper. Accounts are never revealed (§5). An auth change, so tests come first.
- **Not in scope:** changing your email address (follow-up), passkey-only accounts, SSO (Malafat SSO rejected 2026-10-11), marketing mail, invites (MUT-306), billing (MUT-332).

Cross-links: MUT-367 relates to MUT-358 (billing entitlements: never charge a PENDING_REVIEW account). MUT-368 relates to MUT-362 (the billing step after the first sign-in). MUT-115 and MUT-333 block MUT-370 and MUT-371 respectively.
