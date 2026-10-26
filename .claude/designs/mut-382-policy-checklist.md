# MUT-382 — every policy sentence, mapped to code or infra

Ticket AC 1. Paths are in mini-crm unless marked **P** (phone repo, `mutaba3a-flutter/mutaba3a`). Facts checked 2026-10-26
against main `1e3fffa7` and the live GCP project (read-only `gcloud`). ✔ = true today. ⏳ = true once the release step named
in the row has run (the web release waits for it). ? = Basel must confirm before the web release.

## Where your records live (`hostedAccounts`)

| Sentence (short) | Evidence | |
|---|---|---|
| Records on MTB3A's servers in Google Cloud's Tel Aviv region (me-west1) | `server/infrastructure/terraform/variables.tf:6-10` (`region = "me-west1"`); Cloud SQL `mutaba3a-pg` region me-west1 (`gcloud sql instances describe`) | ✔ |
| Our daily backups stay there too | `main.tf` `backup_configuration.location = var.region` on both instances (MUT-382 B4), `tests/cmek.tftest.hcl`. **Today's backups are in `eu`** (`gcloud sql backups list`, 2026-10-23..25) | ⏳ server release + 14 days |
| Each backup kept 14 days; any moment in the last 7 days | `main.tf` `retained_backups` = 14, `transaction_log_retention_days = 7`; `scripts/__tests__/legal-terms.test.ts` backup promise | ✔ |
| Google Cloud encrypts records, receipts and backups where stored | Google-managed encryption: `cmek_stage` defaults to `off` (`variables.tf:55-58`), bucket key only when the KMS key exists (`main.tf:1000-1005`) | ✔ |
| Servers reach the database only over encrypted connections | `ssl_mode = "ENCRYPTED_ONLY"` (`main.tf:157, 227`); live `sslMode ENCRYPTED_ONLY` | ✔ |
| Technical logs kept by Google Cloud for 30 days, may be outside Tel Aviv | `gcloud logging buckets describe _Default --location=global`: 30 days, location global; only the `_Default`/`_Required` sinks exist | ✔ |
| Per sign-in: shortened browser/app description, never the IP | `sessions.userAgent` truncated to 200 chars, no IP column (`schema.prisma:528-551`, `auth/sign-in.ts:25, 191`) | ✔ |
| Per passkey: public key and identifier, never fingerprint or face | `passkeys` columns (`schema.prisma:555-579`): credentialId, publicKey, signCount, transports, deviceType, backedUp, aaguid, name, dates. Biometrics never leave the authenticator (WebAuthn) | ✔ |
| Per email: scrambled address and whether it arrived, 30 days | `email_deliveries.recipientHash` sha256 + status (`schema.prisma:1553-1570`), pruned at 30 days (`server/src/index.ts:88, 243-244`, `prisma.ts:2661`) | ✔ |
| A small team runs it and can technically reach the data | Shared admin token, DB proxy access (`server/scripts/db.sh`), no Data Access logs (plan table #5) | ✔ |
| We look only when asked, to fix a fault, or when the law requires | Procedure: `docs/operations/pilot-runbook.md` §5–6 (no technical control; the wording says so) | ✔ (a promise, not a control) |
| Changes made with admin tools are logged | Admin routes write `audit_events` (actorType ADMIN, actorId null): `server/src/routes/admin.ts:109, 200` | ✔ |
| Error reports to Sentry in the EU | `docs/observability/sentry-rules.json` (EU region, `de`), `server/src/observability/sentry-node.ts` | ✔ |
| Portal/apps usage to PostHog EU only if you agree; website counts anonymously | Portal opted out by default (`src/lib/analytics/posthogConfig.ts:47-53`); phone only when on (**P** `lib/domain/services/analytics/product_analytics.dart:161`); website `cookieless_mode: 'always'` (`posthogConfig.ts:46`) | ✔ |

## Deleting your account and data (`mobileDeletion`)

| Sentence (short) | Evidence | |
|---|---|---|
| Close my account: portal You › Account | `src/hosted/pages/you/YouPage.tsx:24`, `YouAccount.tsx:50`, `src/hosted/i18n/en.json` `closeAccount.menu` | ✔ |
| Phone: the Account tab | **P** `lib/presentation/screens/account/account_tab_screen.dart:82`, `account_shell_screen.dart:51`, `app_en.arb:3039` | ✔ |
| 30 days to keep it; after that we delete it | `server/src/accounts/closure.ts:16-25` (30 × 24 h); hourly purge `main.tf:915`; `DELETE /v1/me/closure` (`closure.ts:11`) | ✔ |
| A shared profile passes to a co-owner; blocked if members but no owner | `server/src/accounts/purge-plan.ts:8-11, 61-75`; 409 `ACCOUNT_CLOSE_BLOCKED` (`routes/account-closure.ts:79`) | ✔ |
| Deleted: account, owned profiles and their records/receipts, sign-ins, passkeys, terms acceptance, Stripe customer | `repositories/prisma.ts:2483-2531`, `prisma-purge-tables.ts:8-68`, bucket prefix emptied `purge-run.ts:154-170`, `customers.del` `purge-run.ts:121-124` | ✔ |
| Records you added to surviving profiles stay, without your name | Creator columns set NULL: `prisma-purge-tables.ts:69-81`, `prisma.ts:2507-2514` | ✔ |
| Kept: history note with a random internal ID | `user.deleted` tombstone, actorType SYSTEM, entityId = user id (`purge-plan.ts:78-98`) | ✔ |
| Kept: invoices at Stripe | The code deletes only the customer (`account-gateway.ts:76-78`); Stripe keeps a deleted customer's invoices (Stripe's own behaviour) | ✔ (Stripe) |
| Kept: do-not-email entry | `email_suppressions` untouched by the purge | ✔ |
| Kept up to 30 days: email log and server logs with the ID or scrambled address | `email_deliveries` pruned at 30 days; log lines carry userId (`purge-run.ts:137`); log bucket 30 days | ✔ |
| Kept: error reports with the internal ID until Sentry's retention ends | `sentry-rules.ts:142` (user reduced to id) | ✔ |
| Kept: Resend's delivery records | Resend's records (US), as the email section says | ✔ |
| Kept: request form or your email to us, deleted within 12 months | Netlify Forms retention: `.claude/INFRA.md:26`; runbook close step (pilot-runbook §6) | ✔ |
| Deleted receipt files recoverable 14 days | Bucket soft delete 14 days (`main.tf:42-43, 985-986`) | ✔ |
| Backups clear 14 days after deletion | `retained_backups` = 14; on-demand backups deleted within 14 days (DEPLOYMENT.md §6, pilot-runbook §4.3) | ✔ |
| iPhone sign-in record can stay in the Keychain until reinstall | **P** `lib/core/secure_storage.dart:16-26` (Keychain survives uninstall on iOS) | ✔ |
| Backups made before version 0.1.13 can hold the app's data | MUT-375 shipped in 0.1.13 (**P** tag `ios/v0.1.13+1`, `lib/data/db/backup_exclusion.dart:10-27`, `AndroidManifest.xml:15-17`) | ✔ |

## Who else handles your data (`sharing`)

| Sentence (short) | Evidence | |
|---|---|---|
| Google Cloud hosts servers and receipts | `main.tf` (Cloud Run, Cloud SQL, GCS) | ✔ |
| Cloudflare carries connections and runs Turnstile | `server/infrastructure/frontdoor`, `auth/turnstile.ts:65` | ✔ |
| Resend sends our emails | `server/src/email` (MUT-359) | ✔ |
| Stripe: name, email, random internal ID; card and billing on Stripe's page | `billing/stripe/checkout-gateway.ts:115-119, 150`; Checkout Session `billing/checkout.ts:204-211` | ✔ |
| Sentry EU; Netlify + Akismet; PostHog EU | as above; `netlify.toml`, `.claude/INFRA.md` | ✔ |
| info@mtb3a.com mail kept by Microsoft, which hosts our mailbox | Basel, 2026-10-26: info@mtb3a.com is a Microsoft account (not in code) | ✔ |
| Profiles we set up for a Malafat organization share records; yours never do | Only operator-provisioned profiles get keys (`routes/admin.ts:189`); owned and personal profiles are never bound (`schema.prisma:172-181`); scopes `auth/scopes.ts:45-60` | ✔ |

## Keeping the mobile apps secure (`security`)

| Sentence (short) | Evidence | |
|---|---|---|
| Password only as a secure hash | argon2id (`server/src/auth/users.ts:2, 39-46`) | ✔ |
| Session in iPhone Keychain or Android encrypted storage | **P** `lib/core/secure_storage.dart:16-26`, `auth_service.dart:268` | ✔ |
| Phone's own encryption; left out of iCloud and Google backups from 0.1.13 | **P** OS file protection; `backup_exclusion.dart`, `allowBackup="false"` | ✔ |
| App Lock, biometrics stay on device; no camera/contacts/location | unchanged sentences (MUT-324 checklist) | ✔ |

## Error reports (`errorReports`)

| Sentence (short) | Evidence | |
|---|---|---|
| We remove amounts, names, notes, contact details, request contents, IP, anything typed | Shared deny-list `server/src/observability/sentry-rules.ts:10-80`; browser `beforeSend` `src/lib/observability/browserSentry.ts:40-53, 78-82`; phone `sendDefaultPii` false (**P** `error_reporting.dart:54, 60`) | ✔ |
| Native app crashes: Sentry's own scrubbing | **P** `error_reporting.dart:14-17`; org `dataScrubber`, `scrubIPAddresses: true` in `docs/observability/sentry-rules.json:189` | ✔ `scripts/sentry-org-settings.ts --check` against `barmajiyat-ltd` (de.sentry.io), run by Basel 2026-10-26: "privacy settings match" |
| Account only as a random internal ID | `sentry-rules.ts:142`, `sentry-scrub.ts:163` | ✔ |
| iPhone share extension, widgets and Siri shortcuts report too | **P** `ios/ShareExtension/ShareViewController.swift:25`, `CaptureWidgetsBundle.swift:9`, `CaptureIntentsExtension.swift:18`, `ExtensionReporting.swift:55` | ✔ |
| Never screenshots | **P** `attachScreenshot` false | ✔ |

## No ads, no tracking (`noTracking`)

| Sentence (short) | Evidence | |
|---|---|---|
| Logs 30 days: arrival, what it asked, success | Request log line: requestId, method, path, status, durationMs (`server/src/app.ts:282-285`); bucket 30 days | ✔ |
| Our own log lines never include your IP | No IP in the line; pino has no request serializer (`logger.ts:12-58`) | ✔ |
| Google Cloud's request record has the connecting address, usually Cloudflare's | Cloud Run request logs; front door `server/infrastructure/frontdoor` (the legacy run.app host still answers directly) | ✔ |
| IP used briefly in memory for rate limits, and passed to Turnstile | `requestClientIp` (`auth/sessions.ts:88-95, 146-150`), in-memory limiters (`rate-limit.ts:4-8`), Turnstile `remoteip` (`self-service.ts:147`) | ✔ |

## Elsewhere

- `email`: the closing notice (`email/ports.ts:87`) and the passkey-added notice (`:92`) added. ✔
- `usageAnalytics`: the website sends page address, referrer, campaign tags and device type (`src/lib/analytics/guard.ts:37-53`). ✔
- `contact`, `hostedRequest`: info@mtb3a.com (B2). ✔ The mailbox exists, a Microsoft account (Basel, 2026-10-26).
- Free apps: the policy no longer names them (plan #13). Basel, 2026-10-26: only iOS, Android and the web are supported, so `/download`, its installer redirects (old links land on `/`) and the free app's Mac/Windows download rows in Settings › About are removed. ✔
