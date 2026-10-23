# MUT-359: Transactional email through Resend (Mailer port, en/ar templates, bounce suppression)

> **Ticket:** MUT-359 (epic MUT-322, label `ga-gate`). Blocks MUT-366 (signup/recovery routes), MUT-306 (invites), MUT-414 (passkey-added mail), MUT-419 (trial mails). Live sending is blocked by MUT-112 (domain live 2026-10-22, see memory `domain-mtb3a-com`).
> **Source design:** `.claude/designs/mut-331-self-service-signup.md` §8 and ADR-159 decision 5. Basel's ticket comments 12321 (DNS in the frontdoor stack) and 12412 (`@mutaba3a.app` is unowned).
> **Status:** planned and eng-reviewed autonomously on Basel's "go" (2026-10-23; review report at the end). Every decision below is **pending Basel's confirmation** (D1–D24, §9), posted on the ticket.

## 1. Problem and acceptance criteria

The server can't send email. Signup and forgot-password (ADR-159) need it, and so do firm invites (MUT-306), passkey notices (MUT-414), trial mails (MUT-419) and the operator's review digest (MUT-367). This ticket builds the mailer and nothing that calls it except the "your password was changed" notice.

| # | AC (ticket) | Met by |
|---|---|---|
| A1 | With `MAILER=memory`, a test sends each template in en and ar and reads it back. The Arabic HTML is `dir="rtl"`, and no mail carries an amount. | §3.3, `email/__tests__/templates.test.ts`, `mailer.test.ts` |
| A2 | The adapter's request to Resend has no tracking options, and `email:check` fails against a domain with tracking on (stubbed API). | §3.4, §3.7, `resend-transport.test.ts`, `email-check.test.ts` |
| A3 | A signed hard-bounce webhook suppresses the address. An unsigned or mis-signed one is refused with 401 and writes nothing. | §3.6, `routes-email-webhook.test.ts`, `svix.test.ts` |
| A4 | The global cap refuses the 501st mail in 24 h and logs `error`. | §3.5, `mailer.test.ts`, store contract `store-contract-email.ts` |
| A5 | The password-changed notice is sent after a setup-link redeem and after `POST /v1/me/password`. | §3.8, `routes-password-notice.test.ts` |
| A6 | **Live:** once MUT-112's domain is verified in Resend, a real mail reaches Gmail and Outlook inboxes (not spam) in both languages. | **Deferred to the end of the run** (Basel, 2026-10-23): needs the Resend domain, DNS apply and the key Basel will provide (§7). Not failed. |
| A7 | Server gate: typecheck, lint, `openapi:check`, tests. | §8 |

Out of scope (ticket): the signup and recovery routes (MUT-366), invites (MUT-306), marketing mail. Also out: the review queue's sending of approve/decline/digest mails (MUT-367); this ticket ships their templates only.

## 2. What already exists (reuse first)

| Need | Exists | Reuse |
|---|---|---|
| A port + adapters behind config, fail-fast config | `billing/stripe/gateway.ts` (StripeGateway port, budgets), `config.ts` zod schema + cross-field refusals | Same shape: `email/` module, `MAILER` enum, refusals in `loadConfig` |
| A signed public webhook | `routes/stripe-billing.ts` (`POST /v1/billing/stripe/webhook`, `security: []`): raw body, signature first, per-IP limiter on failed signatures only, `bodyLimit` | The Resend webhook copies it, under `/v1` too (D19) |
| Durable idempotency for events | `StripeEvent` table, `beginStripeEvent/finishStripeEvent` | Not reused directly: suppression is an upsert keyed on the address, naturally idempotent |
| Repository contract tests on memory + Prisma | `store-contract-*.ts` + `store-memory-*.test.ts` + `store-prisma-*.test.ts` | `store-contract-email.ts` |
| Store guard classification | `auth/store-guard.ts` (every repository method is classified) | `email: { … 'control' }` (request bookkeeping, §3.8) |
| Hosts from one file | `config/hosts.json` → Terraform `domain.tf` locals → Cloud Run env | `MAIL_FROM_ADDRESS = no-reply@<domain>` derived in `domain.tf`; never hardcoded (`no-hardcoded-hosts.test.ts`) |
| Log-match alerts | `monitoring.tf` `stripe_alerts` | An `email_alerts` map (cap reached, provider failing) |
| Secrets created empty, mounted behind a flag | `stripe_secret_key` / `stripe_enabled` | `resend_api_key` / `resend_webhook_secret`, mounted when `mailer = "resend"` |
| Release preflight remote checks | `scripts/preflight.sh` → `terms:check-live` | `email:check` when production.tfvars says `mailer = "resend"` |
| Brand inks | `src/styles/brand/mutaba3a-theme.css` (AAA light inks) | Inline hex in the mail layout (mail clients ignore CSS variables) |
| Brand names | MUT-400: English always "MTB3A", Arabic "متابعة" | From display name per locale |

## 3. Design

### 3.1 Module layout (`server/src/email/`)

```
email/
  ports.ts               Mailer port, MailTransport port, template ids, SendInput/SendResult
  mailer.ts              createMailer(): render → refuse unowned domain → suppression → cap/idempotency claim → transport → finish
  templates/
    index.ts             TEMPLATES registry: id → { en, ar } renderers; renderMail(id, locale, vars)
    layout.ts            html/text frame: <html lang dir>, inline styles, escape(), linkBlock() with <bdi dir="ltr">
    copy.ts              per-template en/ar strings (one record per template)
  transports/
    resend.ts            fetch POST https://api.resend.com/emails (timeout, Idempotency-Key, no tracking fields)
    log.ts               logs subject + text (with the link) at info
    memory.ts            bounded outbox (last 200), read by the dev outbox
    noop.ts              warns once, sends nothing
  svix.ts                verifySvixSignature(secret, headers, rawBody, now) — HMAC-SHA256, 5 min tolerance, constant-time
  resend-webhook.ts      parse a verified event → suppression intents (hard bounce, complaint)
  password-notice.ts     sendPasswordNotice(mailer, person, { first, signInLink, at }) — never throws
routes/email-webhook.ts  POST /v1/email/resend/webhook
routes/dev-outbox.ts     GET /admin/v1/dev-outbox (mounted only for MAILER=memory outside production)
scripts/email-check.ts   npm run email:check
```

### 3.2 The port

```ts
type MailTemplateId = 'finish-signup' | 'account-exists' | 'reset-password' | 'finish-setup' | 'password-changed'
  | 'account-under-review' | 'account-ready' | 'account-declined' | 'review-digest';
interface SendInput<T extends MailTemplateId> { to: string; template: T; locale: UserLocale; vars: TemplateVars[T]; idempotencyKey: string }
type SendResult =
  | { status: 'sent'; id: string }            // transport accepted it (Resend message id, or a local id)
  | { status: 'duplicate' }                   // the same idempotencyKey was already sent; nothing re-sent
  | { status: 'suppressed' }                  // hard bounce / complaint on file
  | { status: 'refused'; reason: 'UNOWNED_DOMAIN' | 'INVALID_ADDRESS' }  // D7; one plain address only (no list, no CRLF)
  | { status: 'capped'; scope: 'global' | 'recipient' }  // §3.5
  | { status: 'disabled' }                    // MAILER=noop
  | { status: 'failed'; error: string };      // transport error/timeout (logged at error)
interface Mailer { readonly kind: MailerKind; send<T>(input: SendInput<T>): Promise<SendResult> }
interface MailTransport { readonly kind: MailerKind; deliver(mail: RenderedMail & { to; from; replyTo?; idempotencyKey }): Promise<{ id: string }> }
```

`send` never throws for an expected outcome; callers (MUT-366's 202 routes, the notice) branch on `status` or ignore it. A thrown error means a bug.

`TemplateVars` is a typed map: links are strings the caller builds (MUT-366 knows the token; this ticket only knows the portal origin). **No template var is an amount, currency or date** (pinned by a type test and a runtime scan, §3.3).

### 3.3 Templates (en + ar, ADR-159 §5, brief §8.4)

`(locale, vars) → { subject, text, html }`, server-rendered, no i18n library (precedent `PERSONAL_PROFILE_NAME`).

- `html`: `<!doctype html><html lang="ar" dir="rtl">` for Arabic, `lang="en" dir="ltr"` for English; inline styles only; system font stack; ink `#392F4B`, secondary `#564E68`, link `#4D387E`, surface `#FFFCF7`; no images, no pixels, no web fonts, no `<style>` dependence.
- Every interpolated value is HTML-escaped. Links render as a button-styled `<a>` plus the raw URL in `<bdi dir="ltr">` for copy-paste (ADR-101).
- `text`: the same message, link on its own line.
- Unknown locale never reaches here (the port's type is `UserLocale`); Arabic is the default wherever a caller has no locale (ADR-077).
- Tests: every template id has both locales; Arabic html has `dir="rtl"` and `lang="ar"`; no `<img`, no `http` other than the provided links; escaping; no currency code/symbol and no digit runs in the copy other than vars the template declares as counts (`review-digest.pending`, `reset-password.validHours`).

| Id | Vars | Used by |
|---|---|---|
| `finish-signup` | `link` | MUT-366 |
| `account-exists` | `signInLink`, `recoverLink` | MUT-366 |
| `reset-password` | `link`, `validHours` | MUT-366 |
| `finish-setup` | `link`, `validHours` | MUT-366 (recovery of a pending operator-created account) |
| `password-changed` | `first: boolean`, `signInLink` | this ticket (§3.8) |
| `account-under-review` | — | MUT-367 |
| `account-ready` | `signInLink` | MUT-367 |
| `account-declined` | `supportAddress` | MUT-367 |
| `review-digest` | `pending`, `command` | MUT-367 (to `OPERATOR_ALERT_EMAIL`) |

### 3.4 Transports

- **resend**: `POST https://api.resend.com/emails`, `Authorization: Bearer RESEND_API_KEY`, `Idempotency-Key: <sha256 of the caller's key>`, body `{ from, to: [to], subject, html, text, reply_to }` and nothing else (a test asserts the exact key set: no `tracking`, `open_tracking`, `click_tracking`, `tags`, `headers`). Tracking is a domain setting in Resend; `email:check` asserts it (§3.7). Timeout 5 s (AbortSignal), no retries (the callers are interactive; a retry would double a mail if the first actually landed — Resend's idempotency key makes a later manual retry safe). Non-2xx → `MailTransportError(status, Resend's error name)`, never the response body in logs beyond `name`/`message`.
- **log**: `logger.info({ mail: { to, template, locale, subject, text } }, 'mail (log transport)')`. Dev only (D14).
- **memory**: keeps the last 200 rendered mails in order; `list({ to? })`, newest last.
- **noop**: `logger.warn` once per process, `disabled`.

### 3.5 Global cap, per-recipient cap and idempotency (D2, D17, D18)

A Postgres table, so the counts survive restarts and deploys (production runs exactly one instance, TD-017, but every deploy starts a fresh one):

```prisma
model EmailDelivery {
  id             String   @id @default(uuid()) @db.Uuid
  keyDigest      String   @unique @db.VarChar(64)   // sha256(idempotencyKey)
  recipientDigest String  @db.VarChar(64)           // sha256(normalizeEmail(to)): counts per address without storing it
  template       String   @db.VarChar(40)
  locale         String   @db.VarChar(5)
  status         String   @db.VarChar(16)           // PENDING | SENT | FAILED
  providerId     String?  @db.VarChar(100)
  error          String?  @db.VarChar(200)
  createdAt      DateTime
  finishedAt     DateTime?
  @@index([createdAt])
  @@index([recipientDigest, createdAt])
  @@map("email_deliveries")
}
```

`email.claimDelivery({ keyDigest, recipientDigest, template, locale, at, since, staleBefore, limits })`, with `limits = { total, reservedForSecurity, perRecipient, security: boolean }`:
1. A row with `keyDigest` that is `SENT`, or `PENDING` and newer than `staleBefore` (10 min) → `duplicate`. A `FAILED` row, or a `PENDING` one older than that (a crash mid-send), is re-claimed: status back to `PENDING` and `createdAt = at`, so it counts again (outside voice #11).
2. Count rows since `since` (24 h) with status ≠ `FAILED`. Non-security mail is `capped` at `total − reservedForSecurity`; security mail (`reset-password`, `finish-setup`, `password-changed`) may use the whole `total` (outside voice #1).
3. Count the recipient's rows since `since`; at `perRecipient` → `capped` with `scope: 'recipient'`.
4. Insert `PENDING` → `claimed`. A unique violation on `keyDigest` (a concurrent claim) → `duplicate`.

No lock (outside voice #6): with one instance, two claims racing past the count can overshoot by a mail or two during a deploy, which is harmless for an abuse cap. Then `finishDelivery(id, { providerId } | { error })`. Rows older than 30 days are pruned by `pruneDeliveries(before)`, hourly from `index.ts`'s prune timer.

Config: `MAIL_DAILY_CAP` (**required** with `resend`, outside voice #1: the operator sets it below the shared plan's real limit; 500 elsewhere), `MAIL_SECURITY_RESERVE` (default 10 % of the cap, rounded up), `MAIL_RECIPIENT_DAILY_CAP` (default 10). The global cap logs `error` `'mail cap reached; nothing sent'` with `{ scope: 'global', cap, template }` (the alert matches it); the per-recipient cap logs `warn` `'mail recipient cap reached'` (abuse, not an outage). Suppression is checked **before** the claim, so a suppressed address never spends the cap.

The Resend transport maps 429 to `MailTransportError('rate_limited')`, logged as `'mail provider rate-limited'` (shared account: the quota may be Malafat's too), apart from `'mail provider failed'` (outside voice #10).

### 3.6 Suppression and the webhook (D10, D12, D19, D20)

```prisma
model EmailSuppression {
  email      String   @id                      // normalizeEmail()
  reason     String   @db.VarChar(16)          // HARD_BOUNCE | COMPLAINT
  eventId    String   @db.VarChar(100)         // svix-id of the event that suppressed it
  createdAt  DateTime
  @@map("email_suppressions")
}
```

`POST /v1/email/resend/webhook` (outside voice #3: the Stripe precedent is `/v1/billing/stripe/webhook`, a `security: []` route under `/v1`, so both public-surface pin tests list it; the ticket's `/webhooks/email/resend` would have slipped past them):
1. `MAILER_NOT_CONFIGURED` 503 when no `RESEND_WEBHOOK_SECRET`. The secret alone turns the webhook on, whatever `MAILER` says (outside voice #2: Resend's endpoint sees the shared account's events from the moment it exists).
2. `bodyLimit` 64 KB.
3. Verify svix: headers `svix-id`, `svix-timestamp`, `svix-signature`; signed content `${id}.${timestamp}.${rawBody}`; key = base64-decode of the secret after `whsec_`; any `v1,<base64>` entry matching in constant time; timestamp within ±5 min. Failure → **401 `INVALID_WEBHOOK_SIGNATURE`** (new code), spends the per-IP failed-signature budget (`EMAIL_WEBHOOK_POLICY.ipPerMinute = 60`), writes nothing.
4. Parse JSON. **Only events whose `data.from` address is on `MAIL_FROM_ADDRESS`'s domain count** (outside voice #2: the Resend account is shared with Malafat; its bounces and complaints must not suppress Mutaba3a mail or put Malafat's customers in our table). Then `email.bounced` with `data.bounce.type === 'Permanent'` → suppress each `data.to[]` as `HARD_BOUNCE`; `email.complained` → `COMPLAINT`. Anything else → 200 `ignored`. The upsert keeps the first row (idempotent on redelivery). Answer `200 { received: true, result: 'suppressed' | 'ignored' }`.
5. A database failure is a 500 so Svix redelivers.

`mailer.send` checks `email.isSuppressed(normalizeEmail(to))` and returns `suppressed` (info log with the template, never the address).

### 3.7 `npm --prefix server run email:check` (D4, D21)

Two checks, so the release preflight never needs a key that can send as Malafat (outside voice #9):
- **DNS** (no key): `resend._domainkey.<apex>` TXT has a `p=` key; `send.<apex>` has the Resend MX and a `v=spf1 … include:amazonses.com` TXT; `_dmarc.<apex>` has `v=DMARC1`. The preflight runs this when production.tfvars sets `mailer = "resend"`.
- **API** (`--api`, ticket AC): with `RESEND_CHECK_API_KEY` (a full-access key the operator keeps in the Keychain, never on the server) it lists domains, finds the apex, and requires `status === 'verified'`, `region === 'eu-west-1'`, every record `verified`, and `open_tracking === false` and `click_tracking === false` (a missing field fails: Resend must say it is off). Without the key, `--api` fails with the Keychain hint. The operator runs it once at go-live and after any change in Resend; the preflight runs it too when the key is present in the environment.

The domain comes from `MAIL_DOMAIN` or `npm --prefix .. run hosts -- get domain`. Output is one `[email] …` line per failure, exit 1 on any, else `[email] ok: …`. The API client and resolver are injected; tests use stubs.

### 3.8 Password-changed notice (A5, D8)

After the redeem commits (`routes/account-setup.ts`) and after `changePassword` commits (`routes/sessions.ts`), the route awaits `sendPasswordNotice(mailer, { id, email, locale }, { first, signInLink, at })`:
- `first` = the person had no password before (an operator-created account's first setup); otherwise "changed";
- `signInLink` = `settings.portalOrigin ?? new URL(c.req.url).origin` + `/`;
- `idempotencyKey` = `password-notice:${userId}:${at.toISOString()}`;
- it never throws: any non-`sent` outcome is logged at debug (`failed`/`capped` are already logged by the mailer). The HTTP response is unchanged.

The mailer is a new optional `AppDependencies.mailer` (default: a `noop` mailer), built from the **base** store in `index.ts` / tests and passed to `accountSetupRoutes` and `sessionRoutes`. The `email` repository's methods are classified `'control'` in the store guard (bookkeeping a request needs, outside voice #13), so even a request-scoped store could send; a test pins that the notice is delivered through a request.

### 3.9 Config (`config.ts`)

| Var | Rule |
|---|---|
| `MAILER` | `resend|log|memory|noop`, default `noop` |
| `SELF_SIGNUP_ENABLED` | `'true'|'false'`, default false. Only read here for the boot refusal; MUT-366 gates routes on it |
| `MAIL_FROM_ADDRESS` | email; required for `resend` and whenever `RESEND_WEBHOOK_SECRET` is set (the webhook's domain filter) |
| `MAIL_REPLY_TO` | email; required for `resend` (D6) |
| `RESEND_API_KEY` | `re_…`; required for `resend` |
| `RESEND_WEBHOOK_SECRET` | `whsec_<base64>`; required for `resend`, allowed alone |
| `MAIL_DAILY_CAP` | int ≥ 1; required for `resend`, default 500 otherwise |
| `MAIL_SECURITY_RESERVE` | int ≥ 0 and < cap; default ceil(10 % of the cap) |
| `MAIL_RECIPIENT_DAILY_CAP` | int ≥ 1, default 10 |
| `OPERATOR_ALERT_EMAIL` | optional email (MUT-367's digest goes there) |

Refusals: `noop` + `SELF_SIGNUP_ENABLED=true` (ticket); `memory` or `log` with `NODE_ENV=production` (D14); `resend` without its values; a from address or reply-to on a domain in `UNOWNED_DOMAINS` (D7).

For `log`/`memory`/`noop` without `MAIL_FROM_ADDRESS`, the from is `no-reply@example.invalid` (never sent anywhere).

### 3.10 Terraform (operator-applied, D1)

- **frontdoor** (Basel's comment 12321): `cloudflare_dns_record.email` for each of DKIM (TXT `resend._domainkey.<apex>`), the return-path MX (`send.<apex>` → `feedback-smtp.<region>.amazonses.com`, priority 10), the return-path SPF (TXT `send.<apex>` `v=spf1 include:amazonses.com ~all`) and DMARC (TXT `_dmarc.<apex>` `v=DMARC1; p=none`, plus `; rua=mailto:<address>` only when `dmarc_report_address` is set — an address off the apex needs that domain's authorization record, outside voice #8). All DNS-only, created only when `resend_dkim_value` is set (default null = nothing). Variables: `resend_dkim_value`, `resend_sending_region` (default `eu-west-1`), `dmarc_report_address` (default null). Tests in `frontdoor.tftest.hcl`.
- **terraform** (API stack): `mailer` (`noop` default | `resend`; `log` and `memory` can't boot under the stack's `NODE_ENV=production`, outside voice #4); `MAILER` env always; `MAIL_FROM_ADDRESS = no-reply@<domain>` from `domain.tf` when a domain is set; `mail_reply_to` → `MAIL_REPLY_TO`; `mail_daily_cap` → `MAIL_DAILY_CAP`; `operator_alert_email` → `OPERATOR_ALERT_EMAIL`; secrets `mutaba3a-api-resend-api-key` and `…-resend-webhook-secret` created empty always and mounted only when `mailer = "resend"`; a precondition refuses `resend` without a domain, a reply-to or a cap. Log-match alerts `email_alerts` (global cap reached; provider failing or rate-limited) when `mailer = "resend"` and alerting is on. Tests in a new `tests/email.tftest.hcl`.
- **Release guard** (outside voice #5): `guard_mailer_release` in `server/scripts/lib/release-guard.sh`, like Sentry's: a checkout whose production.tfvars doesn't say `mailer = "resend"` while the service mounts `RESEND_API_KEY` is refused (`SKIP_MAILER_GUARD=1` to switch mail off on purpose). Tests in `release-guard.test.ts`; preflight lists it.

### 3.11 OpenAPI and versions

New operation `POST /v1/email/resend/webhook` (tag `Email`, `security: []`), added to the pinned public lists in `no-self-registration.test.ts` and `route-security.test.ts`. New error codes `INVALID_WEBHOOK_SIGNATURE` (401) and `MAILER_NOT_CONFIGURED` (503). The dev outbox is not in the published document (it's never mounted where the document is generated, D11). `API_VERSION` → `1.54.0-mut359`; regenerate `server/openapi/*`. The info description's "no signup, invite or self-service password reset exists" sentence stays true until MUT-366; a sentence about email notices is added.

## 4. Tests (TDD order; detail in `mut-359-resend-mailer-tests.md`)

1. `email/__tests__/templates.test.ts` — both locales, rtl, escaping, no money, no images.
2. `email/__tests__/svix.test.ts` — Svix's documented vector, wrong secret, tampered body, old/future timestamp, multiple signatures, missing headers.
3. `email/__tests__/resend-transport.test.ts` — exact body keys, headers, timeout, error mapping (stubbed fetch).
4. `email/__tests__/mailer.test.ts` — memory transport: every template en/ar sent and read back; suppressed; unowned domain; cap 500 → 501st capped + error log; duplicate key; FAILED re-claim; noop disabled + warn once.
5. `repositories/__tests__/store-contract-email.ts` (+ memory + prisma runners) — suppression upsert, claim/duplicate/cap/finish/prune.
6. `__tests__/routes-email-webhook.test.ts` — signed hard bounce suppresses; transient ignored; complaint suppresses; unsigned/mis-signed 401 + nothing written; 503 unconfigured; rate limit.
7. `__tests__/routes-password-notice.test.ts` — redeem sends `password-changed` (first) in the person's locale; `/v1/me/password` sends "changed"; a failing transport doesn't change the 200/204.
8. `__tests__/dev-outbox.test.ts` — mounted for memory outside production, admin token required, 404 otherwise.
9. `__tests__/config.test.ts` additions — the refusals in §3.9.
10. `scripts/__tests__/email-check.test.ts` — tracking on fails; missing tracking field fails; unverified record fails; wrong region fails; no DMARC fails; all good passes.
11. Terraform: `frontdoor.tftest.hcl` email records; `email.tftest.hcl` mailer off by default / resend mounts secrets / needs a domain.

Command: `npm --prefix server test` (Node 22); Prisma half with `npm --prefix server run test:db`.

## 5. Impact

- **Data:** two new tables, one migration (`20261023120000_mut359_email`), additive. No backfill.
- **Behaviour on merge:** none in production. `mailer` defaults to `noop`, so the only change is a `warn` at boot and the password notice resolving to `disabled`.
- **Cost:** Resend is Barmajiyat's existing account. ~1–2 mails per person per month; the 500/day cap bounds abuse. One indexed insert + count per mail.
- **Security:** setup links never reach logs in production (`log` refused there). The webhook writes only after a valid signature. The send log stores digests, not addresses.
- **i18n:** every template en + ar, Arabic RTL, pinned by a test.
- **Privacy:** Resend receives the address, subject and body (US storage); no money record ever enters a mail. The privacy-policy paragraph is MUT-369.

## 6. QA scenarios (release-qa, CLAUDE.md Phase 5)

This ticket is **server-only with no user-visible flow** in the portal or web app: it adds a port, adapters, templates, a webhook and a notice mail. `server/src/**` is outside every release-qa app's `watch` (`qa/qa.config.mjs`), so there are no unmapped files and no new feature yaml. The scenarios are proven by server tests instead:

| Scenario | Steps (as a person would say them) | Promised outcome | Proof |
|---|---|---|---|
| password-notice.setup | Finish setting up through a setup link | A "your password is set" mail arrives in your language | `routes-password-notice.test.ts` (memory outbox) |
| password-notice.change | Change your password in the account menu | A "your password was changed" mail arrives | same |
| bounce.suppress | A mail hard-bounces | No further mail goes to that address | `routes-email-webhook.test.ts` + `mailer.test.ts` |

The portal-visible flows that will read the outbox (`signup.*`, `recover.*` in MUT-331 §11) land with MUT-368, reading `GET /admin/v1/dev-outbox` against a `MAILER=memory` server.

## 7. Operator steps (→ `docs/operations/before-release.md`, `server/DEPLOYMENT.md` §6f)

Basel (coordinator message, 2026-10-23): the live Resend setup waits until the end of the run. He will supply the API key, or reuse the Barmajiyat/Malafat one. Nothing in this build reads or uses any existing Resend key.

1. **Privacy first** (outside voice #7): MUT-369's privacy-policy paragraph (Resend as a processor, US storage) is live before step 6.
2. Resend (Barmajiyat account): add domain `mtb3a.com`, region **eu-west-1**, **open and click tracking off**.
3. Copy the DKIM value into `server/infrastructure/frontdoor/production.tfvars` (`resend_dkim_value`, optionally `dmarc_report_address`), plan, apply. Wait for Resend to verify.
4. Create a **sending-only** API key restricted to `mtb3a.com` → Secret Manager `mutaba3a-api-resend-api-key` (or Basel's chosen key).
5. Put a full-access key in the Keychain for `email:check --api` (`RESEND_CHECK_API_KEY`); run `npm --prefix server run email:check -- --api`.
6. Confirm the Barmajiyat Resend plan covers both products (the free plan's 100/day is shared with Malafat); set `mail_daily_cap` below it.
7. Check production for users at `@mutaba3a.app` (Basel's comment 12412) and move them to `@mtb3a.com`.
8. Decide the Reply-To (`mail_reply_to`): the portal's support address today is `info@malafat.app`, so replies would land in Malafat's inbox (outside voice #8). A mailbox on the apex (e.g. Cloudflare Email Routing) is a follow-up (TD).
9. Go live in one release: create the Resend webhook (`https://<portal host>/v1/email/resend/webhook`, events `email.bounced`, `email.complained`) → its signing secret to `mutaba3a-api-resend-webhook-secret`; set `mailer = "resend"`, `mail_reply_to`, `mail_daily_cap`, `operator_alert_email` in the API tfvars; release. (Creating the webhook earlier would make Svix retry 503s and possibly disable the endpoint, outside voice #2.)
10. A6 (deferred to the end of the run): send yourself each language (Gmail, Outlook) and confirm inbox, not spam.

## 8. Gates

Root: `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run build`. Server: `typecheck`, `lint`, `openapi:check`, `test`, `test:db` (local Postgres :54329). Terraform: `terraform test` in `frontdoor` and `terraform`. `release-qa lint`.

## 9. Decisions (all pending Basel's confirmation)

| # | Decision | Why |
|---|---|---|
| D1 | Email DNS records go in the **frontdoor** stack, not a new `server/infrastructure/email` stack | Basel's comment 12321 (newer than ADR-159's "new stack"); the zone already lives there |
| D2 | Caps and idempotency are a **Postgres send log** (`email_deliveries`, digests only), without a lock; a deploy-time overshoot of a mail or two is accepted | Counts must survive restarts and deploys; one instance (TD-017) makes a lock unnecessary (eng review) |
| D3 | No new dependencies: Resend over `fetch`, svix verification hand-written (HMAC-SHA256, tested on Svix's published vector) | Two small HTTP/HMAC surfaces; keeps the image and supply chain small |
| D4 | `email:check --api` uses a separate full-access key (`RESEND_CHECK_API_KEY`) from the operator's Keychain, fails without it, and treats a missing tracking field as "on" | The production key is sending-only and can't read domains |
| D5 | From name per locale: "MTB3A" (en), "متابعة" (ar); address `no-reply@<apex>` from `config/hosts.json` via Terraform | MUT-400 naming; ADR-159's no-hardcoded sender |
| D6 | Reply-To is `MAIL_REPLY_TO`, required for `resend`; its value is the operator's go-live choice (§7 step 8) | Ticket: "Reply-To the support address"; the only support address today is on Malafat's domain |
| D7 | The mailer refuses recipients (and config refuses a sender or reply-to) on unowned domains (`mutaba3a.app`) | Basel's comment 12412: anyone could register it and receive account mail |
| D8 | The password notice is awaited after the commit, with a 5 s transport timeout; failures are logged and never change the response; one template with a `first` flag ("is set" vs "was changed") | Deterministic tests, bounded latency; a first setup isn't a "change" |
| D9 | Cap and provider failures alert through Cloud Monitoring log-match policies, not email | The cap would block an alert mail |
| D10 | Only permanent bounces and complaints suppress; transient bounces are ignored. No unsuppress command yet (TD) | Resend's own semantics; YAGNI until a real false positive |
| D11 | `GET /admin/v1/dev-outbox` exists only for `MAILER=memory` outside production, behind the admin token, outside the published OpenAPI, with an optional `?to=` filter | Ticket; keeps production's surface unchanged |
| D12 | The webhook answers 401 `INVALID_WEBHOOK_SIGNATURE` (new code) and 503 `MAILER_NOT_CONFIGURED`; failed signatures are rate-limited per IP | Ticket asks 401 (Stripe's stays 400) |
| D13 | `MAILER` defaults to `noop` in config and Terraform; `SELF_SIGNUP_ENABLED` is added now only for the boot refusal | Merging changes nothing in production |
| D14 | `log` and `memory` are refused when `NODE_ENV=production`; Terraform's `mailer` accepts only `noop` and `resend` | `log` would write setup-link tokens into Cloud Logging; `memory` would silently drop mail; the stack always runs production |
| D15 | Transport timeout 5 s, no automatic retry; Resend 429 is its own error and log line | A blind retry could double a mail; the idempotency key makes a manual retry safe; a shared-account rate limit isn't an outage |
| D16 | The send log stores `sha256(idempotencyKey)` and `sha256(address)`, template, locale and status only, never the address or body; Resend gets the key digest as its `Idempotency-Key` | Least data; callers may put an email in their key |
| D17 | A per-recipient cap (`MAIL_RECIPIENT_DAILY_CAP`, default 10/24 h) in the mailer, under MUT-366's route limits | Eng review (outside voice #1): one address can't burn the global cap |
| D18 | 10 % of the global cap is reserved for security mail (reset, finish-setup, password notice); `MAIL_DAILY_CAP` has no default under `resend` | Eng review (outside voice #1): a flood of signups can't stop recovery mail; the operator sets the cap from the real plan |
| D19 | The webhook lives at `POST /v1/email/resend/webhook` (not the ticket's `/webhooks/email/resend`) and is pinned in both public-surface tests | Eng review (outside voice #3): the Stripe webhook is under `/v1` too; the pins only see `/v1` |
| D20 | The webhook ignores events not sent from `MAIL_FROM_ADDRESS`'s domain, and works whenever its secret is set | Eng review (outside voice #2): the Resend account and its webhooks are shared with Malafat |
| D21 | `email:check` has a keyless DNS mode (the preflight's) and an `--api` mode (the ticket's tracking/region check, run by the operator) | Eng review (outside voice #9): no full-access key on every release |
| D22 | A `guard_mailer_release` refuses a release that would switch mail off (`SKIP_MAILER_GUARD=1` to mean it) | Eng review (outside voice #5): production.tfvars is per checkout |
| D23 | Going live waits for MUT-369's privacy paragraph (§7 step 1); DMARC `rua` is optional; the Reply-To mailbox and an apex mailbox (Email Routing) are a follow-up | Eng review (outside voice #7, #8) |
| D24 | The four MUT-367 templates ship now, as the ticket lists them; MUT-367 may revise their copy | Ticket scope (outside voice #12 suggested leaving them out) |

## 10. Business / product impact

- Unblocks self-service recovery for pilot users (MUT-366) and, with MUT-367/368, open signup at GA; also invites (MUT-306), passkey notices (MUT-414) and trial mails (MUT-419).
- Sits on the GA gate (epic MUT-322): no mail, no self-service, and every password problem stays an operator ticket.
- Risk is bounded: merging changes nothing until the operator turns `mailer = "resend"` on, and a hard daily cap and suppression protect the shared Resend account's reputation (Malafat sends from it too).

## 11. Eng review (`/plan-eng-review`, 2026-10-23, autonomous)

Target: this plan. No human was available (Basel's "go"); every choice below took the recommended option and is recorded as **pending Basel's confirmation** (D17–D24 in §9).

**Step 0, Scope Challenge:** scope accepted as-is. The ticket names every component; nothing deferrable without failing an AC. Complexity: ~30 files, ~6 new units (port, mailer, 4 transports, webhook route, outbox route, email:check, repository) — over the 8-file gate, but no smaller arrangement keeps the ticket's adapters, webhook, cap, check and Terraform; the original arrangement stands (auto-decided).

**Reality rows:**
- REALITY: premise-table finding — "the Stripe webhook is outside /v1" was false (`server/src/routes/stripe-billing.ts:22` `STRIPE_WEBHOOK_PATH = '/v1/billing/stripe/webhook'`); "Cloud Run scales to zero" was wrong for production (`max_instances` = 1, `min_instances = 1` in the example tfvars). Both corrected (D2, D19). unverified=0.
- REALITY: already-done pass — `git log main -- server/src/email` empty; no mailer exists (`grep -rn Resend server/src` = 0).
- REALITY: surface-check pass — Resend send body/Idempotency-Key, domain GET fields (`open_tracking`, `click_tracking`, `region`, `records[].status`), `email.bounced` `data.bounce.type: "Permanent"` and Svix signing were read from resend.com/docs and docs.svix.com; the Svix example signature was recomputed locally (`rAvfW3dJ…tD0=`).
- REALITY: binding-decisions pass — ADR-159 §5 kept; Basel's comment 12321 (DNS in frontdoor) and 12412 (unowned domain) honored; coordinator 2026-10-23: no Resend key read, A6 deferred.
- REALITY: numbers pass — 500/day cap and 100/day free plan from ADR-159 §6 and brief §8.2 [estimated, operator confirms the plan]; per-recipient 10 and reserve 10 % [estimated].
- REALITY: deferred-asks finding — the ticket's `/webhooks/email/resend` path and "new email stack" changed (D19, D1); A6 deferred to the end of the run. All listed in the Jira comment.
- REALITY: pr-count pass — one branch, merged locally (Basel's recipe).

**Section 1, Architecture:**
- [P1] (9/10) webhook vs shared account — events from Malafat's sends would suppress our users. Accepted → D20.
- [P1] (8/10) global cap is one bucket — a signup flood blocks recovery mail. Accepted → D17, D18.
- [P2] (9/10) `stripe-billing.ts:22` — the webhook path premise was wrong; a `/webhooks/` route escapes both pin tests. Accepted → D19.
- [P2] (8/10) per-checkout tfvars can switch mail off silently. Accepted → D22.
- [P2] (8/10) Terraform `log` can't boot under `NODE_ENV=production` (`main.tf` env). Accepted → D14.
- [P2] (7/10) go-live before the privacy paragraph. Accepted → D23.
Dispositions: all accepted (auto-decided, pending Basel).

**Section 2, Code quality:**
- [P2] (8/10) a crashed send leaves a PENDING row that blocks its key and counts forever. Accepted → §3.5 stale re-claim.
- [P2] (7/10) `to` isn't validated; a list or CRLF in `to` would reach Resend. Accepted → `refused: INVALID_ADDRESS`.
- [P3] (7/10) store-guard class `'operator'` would refuse sends through a request-scoped store. Accepted → `'control'`.
- [P3] (6/10) the advisory lock is new machinery for one instance. Accepted → removed (D2).
Dispositions: all accepted.

**Section 3, Tests:**

```
CODE PATHS                                         USER FLOWS
[+] email/mailer.ts send()                          [+] Set password via link → notice mail
  ├── invalid / unowned address → refused             └── [GAP→planned] routes-password-notice.test.ts
  ├── suppressed → suppressed                       [+] Change password → notice mail
  ├── claim: duplicate / capped(global|recipient)     └── [GAP→planned] same
  │   └── stale PENDING / FAILED re-claim           [+] Hard bounce → no more mail
  ├── transport ok → sent → finish                    └── [GAP→planned] routes-email-webhook + mailer
  ├── transport 429 / error / timeout → failed      [+] Malafat bounce → ignored
  └── noop → disabled (warn once)                     └── [GAP→planned] routes-email-webhook
[+] svix.ts verify (vector, tamper, skew, list)
[+] routes/email-webhook.ts (503, 401, 429, from filter, permanent/transient/complaint, replay)
[+] email-check.ts (dns mode, api mode, no key)
[+] config refusals; release guard; terraform plans
COVERAGE (planned): every path above has a ★★★ test in the test plan; 0 existing tests cover new code.
REGRESSION: account-setup and change-password route tests must keep their statuses with the default noop mailer (CRITICAL, carried as-is).
```
Gaps were all planned tests; added: Malafat-event filter, stale PENDING, per-recipient, reserve, 429, invalid address, release guard, DNS mode. Test plan updated.

**Section 4, Performance:** one indexed count (≤ cap rows/24 h) plus a per-recipient indexed count and one insert per mail; webhook is O(recipients). Hourly prune. The notice adds at most the 5 s timeout to two rare routes. No issues found.

**Outside voice:** Codex not installed; native fallback (Claude Plan subagent) completed inside the 5-minute window with 13 findings. Accepted: #1–#11, #13. Kept as ticket scope: #12 (D24). Cross-model: the native review and the subagent agreed on the cap and validation; the subagent alone caught the shared-webhook and the `/v1` premise.

**NOT in scope:** signup/recovery routes (MUT-366), review queue mail sending (MUT-367), portal pages and specs (MUT-368), privacy copy (MUT-369), invites (MUT-306), an unsuppress command, a mailbox on the apex (Email Routing), live sending (end of run).

**Failure modes:** Resend down → `failed`, logged, alert, password change still succeeds (not silent). Cap reached → `capped`, error log, alert. Webhook secret wrong → 401s, Svix retries, signature-failure logs. DNS not verified → `email:check` fails the preflight. None silent and untested; 0 critical gaps.

**Parallelization:** sequential implementation, no parallelization opportunity (one module chain: port → store → mailer → routes → infra).

## Implementation Tasks
- [ ] **T1 (P1, human: ~1d / CC: ~1h)** — email core — port, templates, transports, mailer with caps and validation. Verify: `npm --prefix server test -- email`
- [ ] **T2 (P1, human: ~4h / CC: ~30min)** — store — migration, memory + Prisma `email` repository, contract tests. Verify: `npm --prefix server run test:db -- email`
- [ ] **T3 (P1, human: ~4h / CC: ~30min)** — routes — `/v1/email/resend/webhook` (from filter), dev outbox, password notice, pins, OpenAPI. Verify: route tests + `openapi:check`
- [ ] **T4 (P2, human: ~4h / CC: ~30min)** — ops — config refusals, email:check (dns/api), Terraform (frontdoor + API), release guard, preflight, runbook, before-release. Verify: `terraform test`, release-guard tests

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is
- Reality rows: 7/7 emitted, 0 unverified premises (2 corrected)
- Architecture Review: 6 issues found
- Code Quality Review: 4 issues found
- Test Review: diagram produced, 8 gaps identified (all added to the plan)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written (§2)
- TODOS.md updates: 0 proposed (follow-ups go to TECH_DEBT: unsuppress command, apex mailbox)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review (all auto-decided; D1–D24 await Basel's confirmation)
- Outside voice: Claude Plan subagent (native fallback; Codex not installed), completed
- Parallelization: 1 lane, 0 parallel / 4 sequential
- Lake Score: N/A (no scored questions)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | native fallback (Codex not installed) | Independent 2nd opinion | 1 | unavailable (in-host completed) | 13 findings, 12 accepted, 1 kept as ticket scope |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open (all mapped to tasks) | 10 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex not installed; in-host Plan subagent completed (no external-provider coverage).
- **VERDICT:** Eng review findings all folded into the plan; ready to implement (decisions pending Basel's confirmation).

NO UNRESOLVED DECISIONS
