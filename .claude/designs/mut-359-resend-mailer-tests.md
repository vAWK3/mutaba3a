# MUT-359 test plan: transactional email through Resend

Design: `mut-359-resend-mailer.md`. Run on Node 22: `npm --prefix server test`; the Prisma half also with `npm --prefix server run test:db` (local Postgres :54329). Terraform: `terraform init -backend=false && terraform test` in `server/infrastructure/frontdoor` and `server/infrastructure/terraform`.

Written first (red), then the code (green).

## Unit

| File | Cases | AC |
|---|---|---|
| `server/src/email/__tests__/templates.test.ts` | every id in `TEMPLATE_IDS` renders en and ar; ar html starts `<!doctype html><html lang="ar" dir="rtl">`, en `lang="en" dir="ltr"`; subject/text/html non-empty; vars are HTML-escaped (`<script>` in a link); the link appears in text and inside `<bdi dir="ltr">` in html; no `<img`, no `<style`, no `<script`; no currency code or symbol in any rendering; no digit in the copy except declared count vars; Arabic subject contains Arabic letters, English none | A1 |
| `server/src/email/__tests__/svix.test.ts` | Svix's published example (secret, id, timestamp, body, signature) verifies at its own timestamp; wrong secret, tampered body, tampered id → false; timestamp 6 min old or 6 min ahead → false; a list `v1,bad v1,good` verifies; missing header → false; a `whsec_` secret that isn't base64 → false | A3 |
| `server/src/email/__tests__/resend-transport.test.ts` | body keys are exactly `from,to,subject,html,text,reply_to` (no tracking/tags/headers); `to` is an array of one; `Authorization: Bearer`, `Idempotency-Key` is the 64-hex digest; 4xx/5xx → `MailTransportError` with status and Resend's error name; abort after the timeout → `MailTransportError('timeout')` | A2 |
| `server/src/email/__tests__/mailer.test.ts` | memory transport: each template × locale sent and read back from the outbox with the expected from (`MTB3A <…>` / `متابعة <…>`) and reply-to; suppressed address → `suppressed`, nothing delivered, cap not spent; `@mutaba3a.app` → `refused`; cap 500: 500 sent, 501st `capped`, an `error` log `mail cap reached; nothing sent`; a mail 24 h + 1 ms old no longer counts; same key twice → second `duplicate`; transport throws → `failed`, logged at error, the key can be re-sent; Resend 429 → `failed` with `'mail provider rate-limited'`; per-recipient cap → `capped`, `warn`; security templates still send inside the reserve; an invalid `to` (`a@b.com, c@d.com`, CRLF) → `refused` `INVALID_ADDRESS`; noop → `disabled`, one `warn` across two sends | A1, A4 |
| `server/src/email/__tests__/password-notice.test.ts` | `first` picks "set" copy; never throws when the mailer returns `failed` or throws | A5 |
| `server/src/__tests__/config.test.ts` (added) | `MAILER` defaults to noop; noop + `SELF_SIGNUP_ENABLED=true` refused; `log`/`memory` refused in production; `resend` without each of its four values refused; `MAIL_FROM_ADDRESS` on `mutaba3a.app` refused; `MAIL_DAILY_CAP` default 500 | D13, D14 |
| `server/src/scripts/__tests__/email-check.test.ts` | DNS mode (no key): all records present → ok; missing DKIM / return-path MX / SPF / DMARC each fail. API mode, stubbed Resend + resolver: all good → exit 0 and the ok line; `open_tracking: true` fails; `click_tracking` missing fails; a record `pending` fails; region `us-east-1` fails; domain absent fails; no `_dmarc` TXT fails; no key → fails with the Keychain hint | A2 |

## Integration (routes, memory store)

| File | Cases | AC |
|---|---|---|
| `server/src/__tests__/routes-email-webhook.test.ts` (`POST /v1/email/resend/webhook`) | an event sent from another domain (Malafat's) → `ignored`, nothing written; the webhook works with only `RESEND_WEBHOOK_SECRET` set (MAILER=noop); signed `email.bounced` Permanent → 200 `suppressed`, the address is suppressed (normalized), a later `send` returns `suppressed`; `Transient` → `ignored`, nothing written; `email.complained` → suppressed as COMPLAINT; unsigned → 401 `INVALID_WEBHOOK_SIGNATURE`, nothing written; signed with another secret → 401, nothing written; replay of the same event → 200, still one row; no secret configured → 503 `MAILER_NOT_CONFIGURED`; 61 bad signatures from one IP → 429 | A3 |
| `server/src/__tests__/routes-password-notice.test.ts` | redeem a SETUP link → one `password-changed` mail to the person, in their locale, `first` copy, sign-in link on the portal origin; `POST /v1/me/password` → one "changed" mail; a transport that throws leaves the 200/204 unchanged | A5 |
| `server/src/__tests__/dev-outbox.test.ts` | memory mailer + development → `GET /admin/v1/dev-outbox` lists mails, `?to=` filters, needs the admin token; resend/noop mailer → 404; the published OpenAPI has no `/admin/v1/dev-outbox` | D11 |
| `server/src/__tests__/no-self-registration.test.ts`, `route-security.test.ts` | the pinned public operations now include `POST /v1/email/resend/webhook` (D19) | — |
| `server/src/scripts/__tests__/release-guard.test.ts` (added) | `guard_mailer_release`: checkout `mailer = "noop"` while the service mounts `RESEND_API_KEY` → refused; `SKIP_MAILER_GUARD=1` → allowed; `resend` → allowed; service not found → allowed | D22 |

## Store contract (memory + Prisma)

`server/src/repositories/__tests__/store-contract-email.ts`, run by `store-memory-email.test.ts` and `store-prisma-email.test.ts`:
- `suppress` then `isSuppressed` true; a second `suppress` keeps the first reason and event;
- `claimDelivery` → claimed; same digest → duplicate; after `finishDelivery(error)` the same digest is re-claimed;
- with `cap: 2`, the third distinct claim inside the window → capped; a claim whose `since` excludes the old rows → claimed;
- `pruneDeliveries(before)` removes older rows and returns the count;
- a PENDING row older than `staleBefore` is re-claimed, with `createdAt` reset;
- per-recipient: with `perRecipient: 2`, a third claim for the same recipient digest → capped (`scope: 'recipient'`), another recipient → claimed;
- reserve: with `total: 10, reservedForSecurity: 2`, the 9th non-security claim is capped while a security claim still succeeds up to 10;
- a concurrent claim with the same key digest → duplicate (unique violation), never an error.

## Terraform

- `frontdoor.tftest.hcl`: no `resend_dkim_value` → no email records; with it → four DNS-only records with the right names/contents under the placeholder apex; MX on `send.` points at the chosen region.
- `terraform/tests/email.tftest.hcl`: default `mailer = "noop"` → `MAILER=noop`, no Resend env, secrets exist; `mailer = "resend"` with a domain → secrets mounted, `MAIL_FROM_ADDRESS = no-reply@placeholder.example`, `MAIL_REPLY_TO` set; `resend` with no domain → precondition error.

## Regression

Full server suite and root suite on Node 22. Known flakes: TD-173 boot-slow-session; MUT-372 backfill leak in records-export parity and store-prisma-profiles.
