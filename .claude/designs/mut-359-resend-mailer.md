# MUT-359: Transactional email through Resend (Mailer port, en/ar templates, bounce suppression)

> **Ticket:** MUT-359 (epic MUT-322, label `ga-gate`). Blocks MUT-366 (signup/recovery routes), MUT-306 (invites), MUT-414 (passkey-added mail), MUT-419 (trial mails). Live sending is blocked by MUT-112 (domain live 2026-10-22, see memory `domain-mtb3a-com`).
> **Source design:** `.claude/designs/mut-331-self-service-signup.md` §8 and ADR-159 decision 5. Basel's ticket comments 12321 (DNS in the frontdoor stack) and 12412 (`@mutaba3a.app` is unowned).
> **Status:** planned and built autonomously on Basel's "go" (2026-10-23). Every decision below is **pending Basel's confirmation** (D1–D16, §9), posted on the ticket.

## 1. Problem and acceptance criteria

The server can't send email. Signup and forgot-password (ADR-159) need it, and so do firm invites (MUT-306), passkey notices (MUT-414), trial mails (MUT-419) and the operator's review digest (MUT-367). This ticket builds the mailer and nothing that calls it except the "your password was changed" notice.

| # | AC (ticket) | Met by |
|---|---|---|
| A1 | With `MAILER=memory`, a test sends each template in en and ar and reads it back. The Arabic HTML is `dir="rtl"`, and no mail carries an amount. | §3.3, `email/__tests__/templates.test.ts`, `mailer.test.ts` |
| A2 | The adapter's request to Resend has no tracking options, and `email:check` fails against a domain with tracking on (stubbed API). | §3.4, §3.7, `resend-transport.test.ts`, `email-check.test.ts` |
| A3 | A signed hard-bounce webhook suppresses the address. An unsigned or mis-signed one is refused with 401 and writes nothing. | §3.6, `routes-email-webhook.test.ts`, `svix.test.ts` |
| A4 | The global cap refuses the 501st mail in 24 h and logs `error`. | §3.5, `mailer.test.ts`, store contract `store-contract-email.ts` |
| A5 | The password-changed notice is sent after a setup-link redeem and after `POST /v1/me/password`. | §3.8, `routes-password-notice.test.ts` |
| A6 | **Live:** once MUT-112's domain is verified in Resend, a real mail reaches Gmail and Outlook inboxes (not spam) in both languages. | **Operator step** (§7): needs the Resend domain, DNS apply and the real key. Not done in this build (no live sending allowed). |
| A7 | Server gate: typecheck, lint, `openapi:check`, tests. | §8 |

Out of scope (ticket): the signup and recovery routes (MUT-366), invites (MUT-306), marketing mail. Also out: the review queue's sending of approve/decline/digest mails (MUT-367); this ticket ships their templates only.

## 2. What already exists (reuse first)

| Need | Exists | Reuse |
|---|---|---|
| A port + adapters behind config, fail-fast config | `billing/stripe/gateway.ts` (StripeGateway port, budgets), `config.ts` zod schema + cross-field refusals | Same shape: `email/` module, `MAILER` enum, refusals in `loadConfig` |
| A signed public webhook outside the auth middleware | `routes/stripe-billing.ts`: raw body, signature first, per-IP limiter on failed signatures only, `bodyLimit` | The Resend webhook copies it (path outside `/v1`, so `authenticate()` never sees it) |
| Durable idempotency for events | `StripeEvent` table, `beginStripeEvent/finishStripeEvent` | Not reused directly: suppression is an upsert keyed on the address, naturally idempotent |
| Repository contract tests on memory + Prisma | `store-contract-*.ts` + `store-memory-*.test.ts` + `store-prisma-*.test.ts` | `store-contract-email.ts` |
| Store guard classification | `auth/store-guard.ts` (every repository method is classified) | `email: { … 'operator' }` (only server-side code calls it, never a request-scoped principal) |
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
routes/email-webhook.ts  POST /webhooks/email/resend
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
  | { status: 'refused'; reason: 'UNOWNED_DOMAIN' }  // D7
  | { status: 'capped' }                      // global cap reached (logged at error)
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

### 3.5 Global cap and idempotency (D2)

A Postgres table, so the cap survives Cloud Run scaling to zero and restarts:

```prisma
model EmailDelivery {
  id             String   @id @default(uuid()) @db.Uuid
  keyDigest      String   @unique @db.VarChar(64)   // sha256(idempotencyKey): no address or token stored
  template       String   @db.VarChar(40)
  locale         String   @db.VarChar(5)
  status         String   @db.VarChar(16)           // PENDING | SENT | FAILED
  providerId     String?  @db.VarChar(100)
  error          String?  @db.VarChar(200)
  createdAt      DateTime
  finishedAt     DateTime?
  @@index([createdAt])
  @@map("email_deliveries")
}
```

`email.claimDelivery({ keyDigest, template, locale, at, since, cap })` runs in one transaction under `pg_advisory_xact_lock(<fixed key>)`:
1. a row with `keyDigest` exists and is `SENT` or `PENDING` → `duplicate`; `FAILED` → re-claimed (status back to PENDING) so a retry can send;
2. count rows with `createdAt >= since` and status ≠ `FAILED` ≥ `cap` → `capped`;
3. insert `PENDING` → `claimed`.
Then `finishDelivery(id, { providerId } | { error })`. Rows older than 30 days are pruned by `pruneDeliveries(before)`, called hourly from `index.ts`'s prune timer. The cap is `MAIL_DAILY_CAP` (default 500, min 1). The 501st mail in a rolling 24 h answers `capped` and logs `error` `'mail cap reached; nothing sent'` with `{ cap, template }` (the alert matches that message).

Suppression is checked **before** the claim, so a suppressed address never spends the cap.

### 3.6 Suppression and the webhook (D10, D12)

```prisma
model EmailSuppression {
  email      String   @id                      // normalizeEmail()
  reason     String   @db.VarChar(16)          // HARD_BOUNCE | COMPLAINT
  eventId    String   @db.VarChar(100)         // svix-id of the event that suppressed it
  createdAt  DateTime
  @@map("email_suppressions")
}
```

`POST /webhooks/email/resend` (outside `/v1`; `/webhooks/` joins `PORTAL_EXCLUDED_PREFIXES`):
1. `MAILER_NOT_CONFIGURED` 503 when no `RESEND_WEBHOOK_SECRET`.
2. `bodyLimit` 64 KB.
3. Verify svix: headers `svix-id`, `svix-timestamp`, `svix-signature`; signed content `${id}.${timestamp}.${rawBody}`; key = base64-decode of the secret after `whsec_`; any `v1,<base64>` entry matching in constant time; timestamp within ±5 min. Failure → **401 `INVALID_WEBHOOK_SIGNATURE`** (new code), spends the per-IP failed-signature budget (`EMAIL_WEBHOOK_POLICY.ipPerMinute = 60`), writes nothing.
4. Parse JSON. `email.bounced` with `data.bounce.type === 'Permanent'` → suppress each `data.to[]` address as `HARD_BOUNCE`; `email.complained` → `COMPLAINT`. Anything else → 200 `ignored`. Upsert keeps the first row (idempotent on redelivery). Answer `200 { received: true, result: 'suppressed' | 'ignored' }`.
5. A database failure is a 500 so Svix redelivers.

`mailer.send` checks `email.isSuppressed(normalizeEmail(to))` and returns `suppressed` (info log, no address in the log; the user id or template only).

### 3.7 `npm --prefix server run email:check` (D4)

Reads `RESEND_CHECK_API_KEY` (a full-access key from the operator's Keychain, `release-kit` service) — the production key is sending-only and domain-restricted and can't read domains. The domain is `MAIL_DOMAIN` or `npm --prefix .. run hosts -- get domain`. It:
- lists domains and finds the one named; missing → fail;
- `status === 'verified'`, `region === 'eu-west-1'`, every record `status === 'verified'` (DKIM, SPF MX/TXT);
- `open_tracking === false` and `click_tracking === false`; a missing field fails (Resend must say it is off);
- resolves `_dmarc.<domain>` TXT and requires a `v=DMARC1` record (Resend doesn't verify DMARC);
- prints one `[email] …` line per failure, exits 1 on any, 0 with `[email] ok: <domain> verified in eu-west-1, tracking off, DMARC present`.
The API client and resolver are injected; tests use stubs. Preflight runs it when `server/infrastructure/terraform/production.tfvars` sets `mailer = "resend"` (`SKIP_EMAIL_CHECK=1` skips with a warning).

### 3.8 Password-changed notice (A5, D8)

After the redeem commits (`routes/account-setup.ts`) and after `changePassword` commits (`routes/sessions.ts`), the route awaits `sendPasswordNotice(mailer, { id, email, locale }, { first, signInLink, at })`:
- `first` = the link's purpose was `SETUP` and the person had no password before; otherwise "changed";
- `signInLink` = `settings.portalOrigin ?? new URL(c.req.url).origin` + `/`;
- `idempotencyKey` = `password-notice:${userId}:${at.toISOString()}`;
- it never throws: any non-`sent` outcome is logged (`warn` for suppressed/refused/disabled is `debug`, `failed`/`capped` already logged by the mailer). The HTTP response is unchanged.

The mailer is a new optional `AppDependencies.mailer` (default: a `noop` mailer), passed to `accountSetupRoutes` and `sessionRoutes`.

### 3.9 Config (`config.ts`)

| Var | Rule |
|---|---|
| `MAILER` | `resend|log|memory|noop`, default `noop` |
| `SELF_SIGNUP_ENABLED` | `'true'|'false'`, default false. Only read here for the boot refusal; MUT-366 gates routes on it |
| `MAIL_FROM_ADDRESS` | email; required for `resend` |
| `MAIL_REPLY_TO` | email; required for `resend` (D6) |
| `RESEND_API_KEY` | `re_…`; required for `resend` |
| `RESEND_WEBHOOK_SECRET` | `whsec_…`; required for `resend` |
| `MAIL_DAILY_CAP` | int ≥ 1, default 500 |
| `OPERATOR_ALERT_EMAIL` | optional email (MUT-367's digest goes there) |

Refusals: `noop` + `SELF_SIGNUP_ENABLED=true` (ticket); `memory` or `log` with `NODE_ENV=production` (D14); `resend` without its four values; `MAIL_FROM_ADDRESS` on a domain in `UNOWNED_DOMAINS` (D7).

For `log`/`memory`/`noop` without `MAIL_FROM_ADDRESS`, the from is `no-reply@example.invalid` (never sent anywhere).

### 3.10 Terraform (operator-applied, D1)

- **frontdoor** (Basel's comment 12321): `cloudflare_dns_record.email_dkim` (TXT `resend._domainkey.<apex>`), `email_return_path_mx` (MX `send.<apex>` → `feedback-smtp.<region>.amazonses.com`, priority 10), `email_return_path_spf` (TXT `send.<apex>` `v=spf1 include:amazonses.com ~all`), `email_dmarc` (TXT `_dmarc.<apex>` `v=DMARC1; p=none; rua=mailto:<dmarc_report_address>`), all DNS-only, created only when `resend_dkim_value` is set (default null = nothing). Variables: `resend_dkim_value`, `resend_sending_region` (default `eu-west-1`), `dmarc_report_address`. Tests in `frontdoor.tftest.hcl`.
- **terraform** (API stack): `mailer` (`noop` default | `log` | `resend`); `MAILER` env always; `MAIL_FROM_ADDRESS = no-reply@<domain>` from `domain.tf` when a domain is set; `mail_reply_to` variable → `MAIL_REPLY_TO`; secrets `mutaba3a-api-resend-api-key` and `…-resend-webhook-secret` created empty always, mounted only when `mailer = "resend"`; a precondition refuses `resend` without a domain or a reply-to; `mail_daily_cap` → `MAIL_DAILY_CAP`; `operator_alert_email` → `OPERATOR_ALERT_EMAIL`. Log-match alerts `email_alerts` (cap reached; provider failing) when `mailer = "resend"` and alerting is on. Tests in a new `tests/email.tftest.hcl`.

### 3.11 OpenAPI and versions

New operation `POST /webhooks/email/resend` (tag `Email`, `security: []`), new error codes `INVALID_WEBHOOK_SIGNATURE` (401) and `MAILER_NOT_CONFIGURED` (503). The dev outbox is not in the published document (it's never mounted where the document is generated, D11). `API_VERSION` → `1.54.0-mut359`; regenerate `server/openapi/*`. The info description's "no signup, invite or self-service password reset exists" sentence stays true until MUT-366; a sentence about email notices is added.

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

1. Resend (Barmajiyat account): add domain `mtb3a.com`, region **eu-west-1**, **open and click tracking off**.
2. Copy the DKIM value into `server/infrastructure/frontdoor/production.tfvars` (`resend_dkim_value`, `dmarc_report_address`), plan, apply. Wait for Resend to verify.
3. Create a **sending-only** API key restricted to `mtb3a.com` → Secret Manager `mutaba3a-api-resend-api-key`. Create the webhook (`https://app.mtb3a.com/webhooks/email/resend`, events `email.bounced`, `email.complained`) → its signing secret to `mutaba3a-api-resend-webhook-secret`.
4. Put a full-access key in the Keychain for `email:check` (`RESEND_CHECK_API_KEY`); run `npm --prefix server run email:check`.
5. Confirm the Barmajiyat Resend plan covers both products (the free plan's 100/day is shared with Malafat); keep `mail_daily_cap` below it.
6. Check production for users at `@mutaba3a.app` (Basel's comment 12412) and move them to `@mtb3a.com`.
7. Set `mailer = "resend"`, `mail_reply_to`, `operator_alert_email` in the API tfvars; release.
8. A6: send yourself each language (Gmail, Outlook) and confirm inbox, not spam.

## 8. Gates

Root: `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run build`. Server: `typecheck`, `lint`, `openapi:check`, `test`, `test:db` (local Postgres :54329). Terraform: `terraform test` in `frontdoor` and `terraform`. `release-qa lint`.

## 9. Decisions (all pending Basel's confirmation)

| # | Decision | Why |
|---|---|---|
| D1 | Email DNS records go in the **frontdoor** stack, not a new `server/infrastructure/email` stack | Basel's comment 12321 (newer than ADR-159's "new stack"); the zone already lives there |
| D2 | The global cap and idempotency are a **Postgres send log** (`email_deliveries`, digests only), serialized by an advisory lock, pruned after 30 days | Cloud Run scales to zero; an in-memory counter would reset and let the cap be exceeded |
| D3 | No new dependencies: Resend over `fetch`, svix verification hand-written (HMAC-SHA256, tested on Svix's published vector) | Two small HTTP/HMAC surfaces; keeps the image and supply chain small |
| D4 | `email:check` uses a separate full-access key (`RESEND_CHECK_API_KEY`) from the operator's Keychain, fails closed without it, and treats a missing tracking field as "on" | The production key is sending-only and can't read domains |
| D5 | From name per locale: "MTB3A" (en), "متابعة" (ar); address `no-reply@<apex>` from `config/hosts.json` via Terraform | MUT-400 naming; ADR-159's no-hardcoded sender |
| D6 | Reply-To is `MAIL_REPLY_TO`, required for `resend`; the tfvars example uses the portal's current support address until a mailbox on the apex exists | Ticket: "Reply-To the support address"; the only support address today is `SUPPORT_EMAIL` in `src/hosted/terms.ts` |
| D7 | The mailer refuses recipients (and a sender) on unowned domains (`mutaba3a.app`) | Basel's comment 12412: anyone could register it and receive account mail |
| D8 | The password notice is awaited after the commit, with a 5 s transport timeout; failures are logged and never change the response; one template with a `first` flag ("is set" vs "was changed") | Deterministic tests, bounded latency; a first setup isn't a "change" |
| D9 | Cap and provider failures alert through Cloud Monitoring log-match policies, not email | The cap would block an alert mail |
| D10 | Only permanent bounces and complaints suppress; transient bounces are ignored. No unsuppress command yet (TD) | Resend's own semantics; YAGNI until a real false positive |
| D11 | `GET /admin/v1/dev-outbox` exists only for `MAILER=memory` outside production, behind the admin token, outside the published OpenAPI, with an optional `?to=` filter | Ticket; keeps production's surface unchanged |
| D12 | The webhook answers 401 `INVALID_WEBHOOK_SIGNATURE` (new code) and 503 `MAILER_NOT_CONFIGURED`; failed signatures are rate-limited per IP | Ticket asks 401 (Stripe's stays 400) |
| D13 | `MAILER` defaults to `noop` in config and Terraform; `SELF_SIGNUP_ENABLED` is added now only for the boot refusal | Merging changes nothing in production |
| D14 | `log` and `memory` are refused when `NODE_ENV=production` | `log` would write setup-link tokens into Cloud Logging; `memory` would silently drop mail |
| D15 | Transport timeout 5 s, no automatic retry | A blind retry could double a mail; the idempotency key makes a manual retry safe |
| D16 | The send log stores `sha256(idempotencyKey)`, template, locale and status only — never the address or body; Resend gets the same digest as its `Idempotency-Key` | Least data; callers may put an email in their key |

## 10. Business / product impact

- Unblocks self-service recovery for pilot users (MUT-366) and, with MUT-367/368, open signup at GA; also invites (MUT-306), passkey notices (MUT-414) and trial mails (MUT-419).
- Sits on the GA gate (epic MUT-322): no mail, no self-service, and every password problem stays an operator ticket.
- Risk is bounded: merging changes nothing until the operator turns `mailer = "resend"` on, and a hard daily cap and suppression protect the shared Resend account's reputation (Malafat sends from it too).
