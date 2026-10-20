# MUT-326 — Prepare the domain move so the chosen domain is one input

Epic MUT-322 (pilot gate). Blocks MUT-112. Relates MUT-291, MUT-113, MUT-115, MUT-347, MUT-328.
Status: design, 2026-10-20. ADR-155.

## 1. Problem

The domain isn't chosen yet, but it must be live before the pilot. Today our two temporary
hosts are written into code, tests, scripts, Terraform examples and the phone app:

- landing: `https://mutaba3a.netlify.app`
- portal and API: `https://mutaba3a-api-t5bzsudmja-zf.a.run.app`

MUT-112's inventory, together with this ticket's sweep (§3), turned up 20 places in this repo and
6 in the phone repo. Every day on run.app adds more to carry over later: saved passwords,
universal links, `__Host-` cookies, and, since api-v0.3.14, signed-out local-mode data in
IndexedDB.

## 2. Acceptance criteria (from the ticket) → where they're met

| AC | Met by |
|---|---|
| A test fails if any origin is hardcoded outside the single config | `scripts/__tests__/no-hardcoded-hosts.test.ts` (§5.3) |
| `terraform plan` with a placeholder domain shows only additions | `frontdoor` stack (§5.6): every resource is new. Offline proof in `frontdoor/tests/*.tftest.hcl`; on the day, `scripts/check-tf-plan.ts --only-create` on the real plan |
| The carry-over is written down and its test plan drafted | §7 (built in MUT-112 or MUT-291, whichever lands first) |
| MUT-112 is updated to "pick the domain, apply, release" | Jira comment and description edit when this lands |

## 3. Inventory: every place a host is baked in, and what it reads after this ticket

| Where | Before | After |
|---|---|---|
| `vite.config.ts` `DEFAULT_PUBLIC_ORIGIN` (og tags, canonical, the portal's terms and "request one" links) | literal netlify | `HOSTS.landingOrigin` |
| `vite.config.ts` `DEFAULT_PORTAL_URL` (the free web app's portal sign-in link) | literal run.app | `HOSTS.portalOrigin` |
| `scripts/bundle-origins.json` (bundle allowlist) | both literals | literals removed; `check-bundles.ts` adds `HOSTS.allOrigins` |
| `server/src/scripts/check-terms-live.ts` (release guard) | literal netlify default | required `MUTABA3A_PUBLIC_ORIGIN`; `preflight.sh` and `deploy.sh` pass `hosts get landingOrigin` |
| `server/scripts/provision-account.sh` default URL | literal run.app | `hosts get portalOrigin` |
| Cloud Run env `PORTAL_ORIGIN`, `FRONT_DOOR_TOKEN`, `PORTAL_LEGACY_REDIRECT` | not set | Terraform `domain.tf`, from `config/hosts.json` |
| Front door: DNS, certificate, proxy | none | new `server/infrastructure/frontdoor/` stack, from `config/hosts.json` |
| Netlify legacy-host redirects | none | web build emits `_redirects` from `HOSTS` once `redirectLegacy` is on |
| Sentry allowed origins (`sentry/production.tfvars.example`) | both literals in tfvars | Sentry stack adds `HOSTS` origins itself; tfvars lists only extras |
| `.env.example` comments | literals | point at `config/hosts.json` |
| Test fixtures (`guard.test.ts`, `landingAnalytics.test.ts`, vite-config snapshot, `smoke` examples) | literals | `HOSTS` or neutral example hosts |
| AASA / assetlinks (`server/src/routes/well-known.ts`) | host-free already (MUT-111) | unchanged; served on every host that reaches the service |
| `__Host-` cookie, CSP `'self'` | host-free already | unchanged; a cookie is per origin, so users sign in once on the new host (MUT-112 release note) |
| CORS | none (ADR-033) | none |
| Malafat OAuth `CIMD_CLIENT_ID` (`mutaba3a.app`) | own value | **unchanged on purpose** (ticket scope) |
| Malafat's `malafat-web-mutaba3a-api-url` secret | run.app | unchanged: run.app keeps answering the API forever. Optional switch in the runbook |
| **Phone (other repo):** `.env` `MUTABA3A_API_BASE_URL`, `MUTABA3A_PORTAL_BASE_URL`, `MUTABA3A_PUBLIC_ORIGIN`; `AssociatedDomains.xcconfig` `MUTABA3A_LINK_HOST`; `AndroidManifest.xml` hosts ×3; `strings.xml` `asset_statements` | run.app / netlify | documented, not edited here. `npm run domain:plan` prints the exact lines; runbook step 6 |

Email links: the server sends no email. The only link it mints is the account-setup link
(`setupLinkOrigin`), and that follows `PORTAL_ORIGIN`, so it moves to the new host once
Terraform sets it.

## 4. Decisions

- **D1 — One file: `config/hosts.json`, per environment.** Its fields are `domain` (the one
  input, `null` until chosen), `portalSubdomain` (`"app"`, the shape decided 2026-10-12),
  `redirectLegacy` (a later stage switch, §6), and `legacy` (today's two origins). It's JSON so
  that TypeScript (vite, scripts, tests), Terraform (`jsondecode(file())`) and shell (through the
  CLI) all read the same bytes. `config/hosts.ts` turns it into resolved values. That is the
  only place deriving `https://app.<domain>` lives in TypeScript; Terraform repeats the same
  three lines in `locals`, and both are tested against the same fixture.
- **D2 — The front door is a Cloudflare Worker, like Malafat's `malafat-router`.** The ticket
  said to pick the cheapest option that keeps `TRUSTED_PROXY_HOPS` correct, and the comparison
  favours Cloudflare:

  | | Google external HTTPS LB + serverless NEG | Cloudflare Worker (chosen) |
  |---|---|---|
  | Cost | ~$18/month forwarding rule plus data | $0 (free tier: 100k requests/day; Workers Paid is $5/month) |
  | Precedent | Malafat moved off it | Malafat runs on it |
  | Client IP during the transition | two paths (run.app direct, LB) need different hop counts | Worker hands the IP over explicitly (D3) |
  | Certificate | Google-managed cert resource | Cloudflare Universal SSL, automatic |

  Basel's 2026-10-20 comment on MUT-112 lists the front door as undecided. This ADR makes the
  ticket's call, and it can be overridden. Swapping to a load balancer later changes only the
  `frontdoor` stack and D3's header source.
- **D3 — Transition-safe client IP and origin: a front-door token, not a hop count.** During the
  transition, run.app stays reachable directly, because old phone builds, Malafat and the
  carry-over still need it. One `TRUSTED_PROXY_HOPS` can't be right for both paths: the
  front-door path has one more hop, and on the direct path that extra hop count would trust a
  forged `X-Forwarded-For` entry. So:
  - The Worker sends `x-mutaba3a-front-door: <token>` and `x-mutaba3a-client-ip: <CF-Connecting-IP>`,
    overwriting anything the caller sent.
  - The server treats a request as "via the front door" only when the token matches (a
    constant-time compare). For those requests the client IP is the Worker's header and the
    expected origin is `PORTAL_ORIGIN`.
  - Every other request behaves exactly as it does today: `X-Forwarded-For` with
    `TRUSTED_PROXY_HOPS` = 1, and the request's own origin.
  - With no `FRONT_DOOR_TOKEN` set, which is the case until the domain exists, behaviour is
    byte-for-byte today's.

  The token comes from Terraform `random_password` in Secret Manager, the same pattern as
  `SESSION_TOKEN_PEPPER`.
- **D4 — Who owns what.** The `frontdoor` stack owns the token, its secret, the zone, the DNS
  records, the Worker, its route and the Netlify custom domain. The main stack only reads the
  secret by name (a data source, so its plan fails loudly if the front door wasn't applied
  first), grants the API's service account access, and sets the env vars. This keeps the
  ticket's order: DNS → certificate → proxy → app release → redirect.
- **D5 — Legacy redirects are a separate, later switch (`redirectLegacy`), and use 302.**
  - **Server:** once `PORTAL_LEGACY_REDIRECT` is on, a direct (non-front-door) `GET`/`HEAD`
    for a portal page gets a 302 to `PORTAL_ORIGIN` + path + query. Never redirected:
    `/v1/*`, `/admin/*`, `/health`, `/ready`, `/openapi.json`, `/.well-known/*`, `/assets/*`,
    and the paths in `LEGACY_HOST_KEEPS`, which MUT-112 extends with the carry-over page.
  - **Netlify:** the web build emits host-scoped `_redirects` for the landing pages only (`/`,
    `/download`, `/privacy`, `/terms`, `/terms/*`). The free web app under `/app/*`, its
    assets and the service worker stay on netlify.app: its IndexedDB data lives on that origin
    until MUT-291's bridge (§7).
  - **Why 302:** a cached 301 would make rollback impossible for anyone who already followed it.
  - **Why it waits:** redirecting run.app before the carry-over ships would strand signed-out
    local-mode data, so the runbook turns it on only after MUT-112/291's carry-over is live.
- **D6 — Netlify keeps netlify.app answering.** Its docs say the subdomain "will always work
  even if you set up a custom domain"; there is no automatic redirect. That's what makes the
  MUT-291 bridge on `mutaba3a.netlify.app/app` possible after the move.
- **D7 — The phone repo isn't edited here.** It has its own release train. The runbook and
  `domain:plan` give the exact lines. A phone-side guard test like §5.3 is a follow-up in that
  repo.

## 5. Components

### 5.1 `config/hosts.json` + `config/hosts.ts`
- `parseHostsConfig(raw)` validates and throws a message naming the bad field. The rules:
  - `domain` is a bare lowercase hostname or `null`.
  - `portalSubdomain` is one DNS label.
  - `legacy.*` are https origins.
  - `redirectLegacy` requires a domain.
- `resolveHosts(config, env)` → `{ environment, domain, landingOrigin, portalOrigin, legacy, redirectLegacy, allOrigins, appLinkHosts, frontDoor }`.
- `HOSTS` is the resolved production config, built at import.

### 5.2 `scripts/hosts.ts` CLI (tsx) + `npm run domain:plan`
- `get <landingOrigin|portalOrigin|domain>` prints one value, for shell scripts.
- `plan [--domain <apex>] [--env production]` is the dry run. It prints, per consumer, the value
  now and the value with the domain set: web build, Netlify `_redirects`, bundle allowlist,
  Cloud Run env, front-door inputs, Sentry origins, phone `.env` / xcconfig / manifest /
  strings.xml lines (both hosts during the transition), Malafat secret, uptime checks.
  `domainPlan()` is a pure function, unit-tested.

### 5.3 Guard test
It reads `git ls-files` and skips docs (`*.md`, `.claude/**`, `docs/**`) and `config/hosts.json`.
It fails on any `mutaba3a…` `*.a.run.app` / `*.netlify.app` host, on either legacy host, or on the
configured domain once one is set.

### 5.4 Web build
`vite.config.ts` reads `HOSTS`. A `legacyRedirects()` web plugin emits `_redirects` from
`netlifyLegacyRedirects(HOSTS)` (empty unless `redirectLegacy`). `check-bundles.ts` merges
`HOSTS.allOrigins` into both allowlists.

### 5.5 Server
- `config.ts` adds two variables:
  - `FRONT_DOOR_TOKEN` (≥ 32 chars; requires `PORTAL_ORIGIN`).
  - `PORTAL_LEGACY_REDIRECT` (boolean; requires `FRONT_DOOR_TOKEN`).
- `auth/sessions.ts` adds `isViaFrontDoor`, `requestClientIp` and `expectedPortalOrigin`, and the
  four `clientIp` call sites and three `isSameOriginRequest` call sites use them.
- `app.ts` adds the legacy-host redirect middleware (D5).
- No API contract change, no version bump.

### 5.6 Terraform
- **Main stack, `domain.tf`.** It holds `var.hosts_file` and the locals `public_landing_origin`,
  `public_portal_origin`, `public_portal_host` and `front_door_enabled`, plus the token secret
  data source and the IAM member. In `main.tf`, one `dynamic "env"` adds `PORTAL_ORIGIN` and
  `PORTAL_LEGACY_REDIRECT`, and one adds `FRONT_DOOR_TOKEN` from the secret. Both are empty
  while the domain is `null`, so today's plan shows no change. The output is
  `public_portal_origin`. MUT-328's uptime checks should use `local.public_portal_host`.
- **Frontdoor stack.** Providers: cloudflare `~> 5`, google `~> 5`, random, netlify. Resources
  are count-gated on the domain:
  - `random_password` and the Secret Manager secret and version;
  - `cloudflare_zone` plus zone settings (SSL strict, always HTTPS, TLS ≥ 1.2);
  - DNS records: apex and `www` CNAME to the Netlify site (DNS-only), `app` AAAA `100::` (proxied);
  - the Worker script (`worker/front-door.js`) and its route `app.<domain>/*`;
  - `netlify_site_domain_settings` (apex primary, `www` alias).

  Offline `terraform test` uses mock providers.
- **`scripts/check-tf-plan.ts`** reads `terraform show -json` output. It fails on any delete or
  replace. `--only-create` fails on anything but create or no-op, and `--allow-update <addr>`
  whitelists the Cloud Run service.
- **Sentry stack** unions `HOSTS.allOrigins` into `allowed_domains`.

### 5.7 Worker (`server/infrastructure/frontdoor/worker/front-door.js`)
The Worker proxies to the run.app origin with `redirect: 'manual'`, so the server's 302 and
`Set-Cookie` pass through untouched. It sets the two `x-mutaba3a-*` headers, drops any copies
the caller sent, and sends `x-forwarded-host`. It's plain ESM, tested by vitest with a fake
`fetch`.

## 6. Cut-over order (runbook in `server/DEPLOYMENT.md` §5a)

| Step | What happens |
|---|---|
| 0. Pick and buy | Set `domain` in `config/hosts.json`, commit, run `npm run domain:plan` |
| 1. DNS | Frontdoor stack plan, which shows only creates (`check-tf-plan --only-create`), then apply. Set the registrar's nameservers to Cloudflare's. Wait until the zone is active |
| 2. Certificates | Cloudflare's edge certificate for `app.` is automatic. Netlify issues the apex one once DNS resolves. Verify both with `curl` |
| 3. Proxy | `curl https://app.<domain>/health`, `/ready` and both `/.well-known` files through the Worker |
| 4. Web release | `make release web`: canonical, og tags and terms links on the apex |
| 5. Server release | `make release server`: the hosted build points at the new hosts; Cloud Run gets `PORTAL_ORIGIN` and `FRONT_DOOR_TOKEN`; the terms guard reads the apex |
| 6. Phone release with both hosts | `.env` and the link host move to the new host; the old host stays in the entitlements and manifest for at least one release |
| 7. Redirects | Only after MUT-112/291's carry-over is live: `redirectLegacy: true`, then web and server releases |
| Rollback | Each step's undo is in the runbook. Before step 7, nothing old stops working. From step 7 on, set `redirectLegacy: false` and release (302s aren't cached) |

## 7. Carry-over of signed-out local-mode data (written down here; built in MUT-112 or MUT-291)

There are two moves, and both use one mechanism, the **origin handoff bridge** (MUT-285 §11 /
MUT-291):

| Move | Old origin | Data | New origin |
|---|---|---|---|
| A (MUT-291) | `mutaba3a.netlify.app/app` | free web app's Dexie DB | portal local mode, new host |
| B (MUT-112) | run.app portal | portal local-mode store (since api-v0.3.14) | portal local mode, `app.<domain>` |

**Mechanism.**
1. The old origin serves a bridge page: `/app/bridge` on Netlify (A), `/carry-over` on run.app
   (B, added to `LEGACY_HOST_KEEPS` so the redirect skips it).
2. The bridge reads the local data and serialises it in the existing **Download my records**
   format (portal local mode's backup file, MUT-287). For A, it first maps the records through
   `createLocalApp`, per MUT-285 §11.
3. It opens `https://app.<domain>/carry-over/receive` and waits for a `ready` message. It checks
   `event.origin` against `HOSTS.portalOrigin`, which is baked in at build time, never read from
   the URL.
4. It posts the payload. The receiver checks `event.origin` against the legacy origin baked
   into its own build, then runs the existing **Restore** path. Restore validates every record
   and lists the ones it can't map instead of dropping them.
5. The receiver acks with counts and per-currency totals. The bridge shows them and marks the
   old copy as carried. It doesn't delete the old copy: deletion stays a separate, explicit
   user action, kept for at least 90 days (MUT-292).
6. **Fallback.** A blocked popup, a missing ack after 10 s, or a different browser leads to
   "Download my records" on the old host and "Restore" on the new one.
7. **When the bridge triggers.** Signed-out pages on the old origin check for local data
   before the redirect stage. With data, they show the carry-over offer. With none, they
   continue to the new host.

**Draft test plan.**

| Level | Case |
|---|---|
| Unit | The payload round-trip matches the backup fixture byte for byte |
| Unit | Origin checks: a wrong sender origin is ignored, a wrong target origin is never posted to, a missing `ready` falls back after the timeout |
| Unit | Receiver idempotency: the same payload twice adds nothing the second time (`Idempotency-Key` derived from local ids, as in MUT-290) |
| Unit | Move A: Dexie fixture → API shapes, including the unmappable list and JOD rows flagged (TD-112) |
| Integration | The receiver restores into a fresh local store; counts and per-currency totals equal the source |
| Release-QA `web.bridge` | Old web app with data → records arrive in the portal with matching counts |
| Release-QA `portal.carry-over` | run.app local records → the new host shows the same Overview totals. Two origins on localhost (two ports) |
| Release-QA `portal.carry-over-fallback` | Popup blocked → download on the old host, restore on the new host → same totals |
| Manual (operator, day 7) | One real browser with run.app local data carried to the live domain |

## 8. Tests (this ticket)

| File | Proves |
|---|---|
| `config/__tests__/hosts.test.ts` | parse errors per field; resolve with and without a domain; `allOrigins` and `appLinkHosts` during the transition; `redirectLegacy` without a domain is refused |
| `scripts/__tests__/hosts-cli.test.ts` | `domainPlan()` lists every consumer; phone lines carry both hosts; `get` values |
| `scripts/__tests__/no-hardcoded-hosts.test.ts` | AC1; plus a self-test that the pattern catches a planted literal |
| `scripts/__tests__/check-tf-plan.test.ts` | create-only passes; delete, replace and unlisted updates fail; `--allow-update` |
| `scripts/__tests__/vite-config.test.ts` (updated) | defaults equal `HOSTS`; `netlifyLegacyRedirects` empty, then host-scoped rules for landing paths only (never `/app`) |
| `server/src/auth/__tests__/front-door.test.ts` | token match is constant-time and exact; client IP from the header only with the token; forged headers without it are ignored; expected origin per path; no token configured → today's behaviour |
| `server/src/__tests__/config.test.ts` (extended) | `FRONT_DOOR_TOKEN` needs `PORTAL_ORIGIN`; the redirect needs the token |
| `server/src/__tests__/legacy-redirect.test.ts` | 302 for a portal page on the direct path; never for the API, well-known, health, assets or front-door requests; off by default |
| `server/infrastructure/frontdoor/worker/front-door.test.ts` | header overwrite, `redirect: manual`, body and method pass-through |
| `server/infrastructure/terraform/tests/domain.tftest.hcl` | `null` domain → no env, no IAM; placeholder → env and IAM present |
| `server/infrastructure/frontdoor/tests/frontdoor.tftest.hcl` | `null` → zero resources; placeholder → the expected records, route and settings |

## 9. QA scenarios (release-QA)

There's nothing user-visible while `domain` is `null`: the builds are byte-for-byte the same,
which the snapshot and the guard test pin. The cut-over is verified by the runbook's operator
checks, `curl` against the live hosts, which no local QA can stand in for. The carry-over
scenarios (`web.bridge`, `portal.carry-over`, `portal.carry-over-fallback`) belong to the
ticket that builds it. New files are mapped in `release-qa` as infrastructure, not features.

## 10. Cost

$0 until the domain is set. After that: the domain itself, about $10–40 a year depending on
the TLD; Cloudflare free plan and Worker free tier; Netlify custom domain free. The Workers
Paid upgrade at $5/month is needed only past 100k portal requests a day (TD).

## 11. i18n

No new UI strings. The carry-over UI (§7) is in Arabic and English, RTL, in the ticket that
builds it.
