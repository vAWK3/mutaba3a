# MUT-326 — Prepare the domain move so the chosen domain is one input

Epic MUT-322 (pilot gate). Blocks MUT-112. Relates MUT-291, MUT-113, MUT-115, MUT-347, MUT-328.
Status: built, 2026-10-20. ADR-155. The adversarial review is folded in (§12).

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
| `terraform plan` with a placeholder domain shows only additions | The `frontdoor` stack (§5.6). A real offline `terraform plan` on the placeholder fixture says **16 to add, 0 to change, 0 to destroy**, all creates. `frontdoor/tests/frontdoor.tftest.hcl` pins the resources. On the day, the runbook's `jq` one-liner over the real plan must print nothing. The API stack's change is the in-place Cloud Run env of a normal release, applied by `deploy.sh` |
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
| Netlify legacy-host redirects | none | web build emits `_redirects` from `HOSTS` per stage (D5) |
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
  `stage`, and `legacy` (today's two origins). `stage` runs `legacy` → `proxy` → `live` →
  `redirect`. It separates "the domain is known", which the front-door Terraform keys on, from
  "the domain is live", which builds, links and the phone key on. Without that split,
  committing the domain would re-point the next release before DNS works. It's JSON so
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
- **D5 — Redirects are staged and use 302.**
  - **Server, stage `redirect`:** `PORTAL_LEGACY_REDIRECT=true`. A direct (non-front-door)
    `GET`/`HEAD` page visit gets a 302 to the **same-origin** `/carry-over?next=<path+query>`.
    That page reads this origin's local records before anything leaves. Never redirected:
    `/v1/*`, `/admin/*`, `/health`, `/ready`, `/openapi.json`, `/.well-known/*`, `/assets/*`,
    static files (a dot in the last segment), writes, and `/carry-over` itself.
  - **Netlify, from stage `live`:** `<apex>/app` and `/app/*` go back to netlify.app. The
    landing links to `/app` relatively, and the free web app's data is there until MUT-291.
  - **Netlify, at stage `redirect`:** the old host's landing pages (`/`, `/download`,
    `/privacy`, `/terms`, `/terms/*`) go to the apex. Never `/app/*`, its assets or the service
    worker.
  - **Why 302:** a cached 301 would make rollback impossible for anyone who already followed it.
  - **Why it waits:** the carry-over page doesn't exist until MUT-112/291 builds it, so the
    runbook moves to stage `redirect` only after that.
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
  - `stage` is `legacy` exactly when `domain` is null.
- `resolveHosts(config, env)` → `{ environment, domain, stage, landingOrigin, portalOrigin, legacy, redirectLegacy, allOrigins, appLinkHosts, frontDoor }`.
- `HOSTS` is the resolved production config, built at import. The stage decides `landingOrigin` and `portalOrigin` (legacy before `live`). `frontDoor.portalOrigin` is the new portal origin from stage `proxy` on, and is what the server's `PORTAL_ORIGIN` gets.

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
`vite.config.ts` reads `HOSTS`. A `domainMoveRedirects()` web plugin emits `_redirects` from
`netlifyRedirects(HOSTS)` (empty before stage `live`). `check-bundles.ts` merges
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
  - `random_password` and the Secret Manager secret (`prevent_destroy`) and its version;
  - `cloudflare_zone` (`prevent_destroy`) plus zone settings: SSL strict, always HTTPS, TLS ≥ 1.2, browser check and email obfuscation off, security level low. Edge challenges would answer JSON clients and the AASA fetcher with HTML;
  - DNS records: the apex as a flattened CNAME to `apex-loadbalancer.netlify.com` and `www` as a CNAME to the Netlify site (both DNS-only), and `app` AAAA `100::` (proxied);
  - the Worker script (`worker/front-door.js`) and its route `app.<domain>/*`;
  - `netlify_site_domain_settings` (apex primary, `www` alias).

  Offline `terraform test` uses mock providers.
- No plan-checking script: the review cut it, and the runbook's `jq` one-liner over
  `terraform show -json` does the job.
- **Sentry stack** unions `HOSTS.allOrigins` into `allowed_domains`.

### 5.7 Worker (`server/infrastructure/frontdoor/worker/front-door.js`)
The Worker proxies to the run.app origin with `redirect: 'manual'`, so the server's 302 and
`Set-Cookie` pass through untouched.
- It overwrites exactly the two `x-mutaba3a-front-door` / `x-mutaba3a-client-ip` headers.
  Other `x-mutaba3a-*` headers, such as `X-Mutaba3a-Profile`, pass through.
- It drops `Host`, sends no `x-forwarded-host` (the review cut it as a future spoofable
  input), and never gives a GET or HEAD a body.
- It fails closed (503) when unconfigured.
- It's plain ESM, tested by vitest with a fake `fetch`.

## 6. Cut-over order (runbook in `server/DEPLOYMENT.md` §5a)

| Step | Stage | What happens |
|---|---|---|
| 0. Pick and buy | `proxy` | Set `domain` in `config/hosts.json`, commit, run `npm run domain:plan`. No build changes |
| 1. DNS | `proxy` | Frontdoor stack plan, which shows only creates (the `jq` check), then apply. Set the registrar's nameservers to Cloudflare's |
| 2. Certificates | `proxy` | Cloudflare's for `app.` is automatic. Netlify issues the apex one once DNS resolves to it |
| 3. Proxy | `proxy` | `make release server`, same build. Cloud Run gets `PORTAL_ORIGIN` and `FRONT_DOOR_TOKEN` **before** anyone is sent to the new host, so sign-in throttling never sees a shared Cloudflare address. Check with `curl` and a sign-in through `app.<apex>` |
| 4. Live | `live` | `make release web`, then `make release server` (the terms guard reads the apex). Re-apply Sentry |
| 5. Phone release with both hosts | `live` | `.env` and the link host move; the old host stays in the entitlements and manifest for at least one release |
| 6. Redirects | `redirect` | Only after the carry-over ships: web and server releases |
| Rollback | | Each step's undo is in the runbook. Step the stage back and release; 302s aren't cached. Undo the API stack before ever destroying the frontdoor stack |

## 7. Carry-over of signed-out local-mode data (written down here; built in MUT-112 or MUT-291)

There are two moves, and both use one mechanism, the **origin handoff bridge** (MUT-285 §11 /
MUT-291):

| Move | Old origin | Data | New origin |
|---|---|---|---|
| A (MUT-291) | `mutaba3a.netlify.app/app` | free web app's Dexie DB | portal local mode, new host |
| B (MUT-112) | run.app portal | portal local-mode store (since api-v0.3.14) | portal local mode, `app.<domain>` |

**Mechanism.**
1. The old origin serves a bridge page: `/app/bridge` on Netlify (A), `/carry-over` on run.app
   (B). The server already sends every direct page visit there at stage `redirect`, and never
   redirects the page itself (`LEGACY_CARRY_OVER_PATH`). MUT-112 builds the page in the portal.
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
7. **When the bridge triggers.** At stage `redirect` every old-host page visit lands on
   `/carry-over?next=…` first. With local data, it shows the offer. With none, it calls
   `location.replace(PORTAL_ORIGIN + next)` at once. Nobody who didn't visit during an
   earlier window is stranded.
8. **Message hygiene.**
   - Use an explicit `targetOrigin`, never `'*'`, and check `event.source === window.opener`.
   - Neither page may send COOP `same-origin`, which nulls `opener`; pin this with a header test.
   - Send the payload as a transferable `ArrayBuffer`/`Blob`, not a JSON string.
   - The receiver accepts exactly the two legacy origins (A and B). It shows counts and asks
     before writing, and never silently overwrites a non-empty store: merge, or refuse with a
     message. Anything on netlify.app, the landing included, shares the trusted origin, so
     the receiver validates every record as Restore does.

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
| `scripts/__tests__/hosts.test.ts` | parse errors per field; resolve per stage; `allOrigins` and `appLinkHosts` during the transition; a stage and domain that disagree are refused; fixtures shared with Terraform |
| `scripts/__tests__/hosts-cli.test.ts` | `domainPlan()` lists every consumer; phone lines carry both hosts; `get` values |
| `scripts/__tests__/no-hardcoded-hosts.test.ts` | AC1; plus a self-test that the pattern catches a planted literal |
| `scripts/__tests__/vite-config.test.ts` (updated) | defaults equal `HOSTS`; `netlifyRedirects` per stage: empty before live, `<apex>/app*` back from live, landing paths only at redirect (never `/app`) |
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

## 12. Adversarial review (2026-10-20), and what changed

| Finding | Disposition |
|---|---|
| Committing the domain re-points every release before DNS works | **Fixed:** `stage` (D1) |
| `<apex>/app` would open an empty free web app | **Fixed:** Netlify sends it back to netlify.app from `live` (D5) |
| A 302 to the new host makes the client-side carry-over check impossible | **Fixed:** the redirect goes to the same-origin `/carry-over?next=` page (D5, §7.7) |
| `PORTAL_LEGACY_REDIRECT="false"` would read as true under `z.coerce.boolean` | **Fixed:** an enum of "true"/"false", tested |
| A pilot-wide sign-in lockout between the web release and the token | **Fixed:** the runbook gives Cloud Run the token (step 3) before anyone is sent there (step 4) |
| Worker header handling | **Fixed:** two exact names, Profile passes, no GET body, `secret_text`, no `x-forwarded-host`, fail closed |
| Cloudflare edge features (browser check, email obfuscation) can break JSON, AASA and phone traffic | **Fixed:** zone settings |
| The free-tier ceiling fails closed and is shared per account | **Deferred:** TD-186; the account is a deliberate tfvars choice |
| Saved passwords don't carry over in browsers | **Deferred:** stated in the runbook. Web↔web `assetlinks.json` affiliation is an API contract change for MUT-112. The phone keeps both hosts |
| Terraform lifecycle: destroy on a typo, Registrar import, CI matrix, staging lookup, metadata-only data source | **Fixed:** `prevent_destroy`, an import note, the matrix, `lookup`, and `data google_secret_manager_secret` |
| The Netlify apex target | **Fixed:** `apex-loadbalancer.netlify.com` |
| Fixtures naming `mutaba3a.app` would trip the guard on cut-over day | **Fixed:** scrubbed, plus a `mutaba3a.app` rehearsal in the guard test (CIMD exempt) |
| "Only additions" honesty | Stated in §2: the frontdoor plan is creates only; the API stack's change is a normal release's in-place Cloud Run update |
| A front-door smoke test in `deploy.sh` | **Added** |
| The service worker answers `/` on netlify.app, so the landing redirect never fires for app users | Accepted: those visitors still get the landing, with a canonical pointing at the apex |
| Cut the `check-tf-plan` script and `x-forwarded-host` | **Cut** |
| Cut the Netlify provider | **Kept:** MUT-112's AC requires no console edits |
