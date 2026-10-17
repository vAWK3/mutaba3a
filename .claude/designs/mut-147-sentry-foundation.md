# MUT-147 — Sentry foundation: EU org, projects, alerts and the error-data rules

Epic MUT-146 · Task · blocks MUT-148 (api), MUT-149 (portal), MUT-150 (landing), MUT-151 (phone)
Status of this file: **plan, awaiting Basel's approval** (eng-ticket, 2026-10-17)

## 1. Problem and acceptance criteria (from the ticket)

One shared setup and one shared rulebook, so each surface story only wires in the SDK.

- [ ] A Sentry org in the EU region (de.sentry.io), with one project per surface: `api`, `portal`, `landing`, `capture-app`.
- [ ] New-issue and spike alerts on each project, routed to Basel.
- [ ] Spending cap and spike protection set, so a crash loop can't run up costs.
- [ ] An ADR says why error events may leave me-west1: they carry no firm data, which squares this with ADR-024's residency rule.
- [ ] The same ADR lists the scrubbing rules every surface follows: `sendDefaultPii: false`; no bodies, cookies, `Authorization`, API keys or query strings; no amounts, client names or notes; user context limited to opaque IDs.
- [ ] The same ADR lists the errors that are never reported: expected 4xx `ApiError`s and network-offline failures.
- [ ] Each surface's `SENTRY_DSN` and environment variables are listed in its `.env.example` file and in the deploy docs.
- [ ] The token that uploads source maps and debug symbols is a CI/deploy secret and is never committed.

## 2. What already exists (reuse, don't reinvent)

| Need | Existing precedent | Use |
|---|---|---|
| Decision record for a third-party data processor | **ADR-090** (PostHog), which already points to "the same reasoning as Sentry EU, MUT-147" | ADR-091 copies its shape (Who sends / Rules / Where data goes / Config / Override log). |
| A cross-surface rulebook that tests can enforce | `docs/analytics/events.json` + `docs/analytics/README.md` + `scripts/__tests__/analytics-taxonomy.test.ts` (sha256 pinned per version; Flutter keeps a byte-identical copy and a parity test) | Same pattern: `docs/observability/sentry-rules.json` + `README.md` + `scripts/__tests__/sentry-rules.test.ts`. |
| Privacy-policy wording published surface by surface | `docs/analytics/README.md` § "Privacy policy wording". It already warns that MUT-146 edits `noTracking`, `network` and `sharing`, and today's `noTracking` sentence says the apps use no **crash reporting** | `docs/observability/README.md` carries the approved en/ar sentences; each surface story publishes its own (ADR-090 P3). |
| Infrastructure as code | `server/infrastructure/terraform/` (ADR-026) with a GCS backend; `server-ci.yml` runs `terraform fmt -check`, `init -backend=false` and `validate` | A new root module at `server/infrastructure/sentry/`, same layout, same state bucket under a new prefix; CI validates it too. |
| Secrets | GCP Secret Manager for runtime values; `release.env` (gitignored) for operator release secrets; Netlify env per context; Flutter `.env` via `--dart-define-from-file` | Nothing new, but see the landmine in §4.6. |

## 3. Decisions for Basel

| # | Question | Recommendation | Why |
|---|---|---|---|
| D1 | **Which Sentry org?** wen3flstin-web already uses Sentry (`@sentry/nextjs`), so you may already have an account. The data region is fixed when an org is created. | Create a **new org in the EU region**, e.g. `barmajiyat`, unless the existing org is already EU. This is your step: I can't create accounts. | Mixing projects into a US org would break the residency reasoning in the ADR. |
| D2 | **How are projects, keys and alerts defined?** | **Terraform** (`jianyuan/sentry` provider) in `server/infrastructure/sentry/`. What the provider can't set (billing, org data-scrubbing settings) becomes recorded operator steps with a read-back command. | CLAUDE.md says "never create infra manually". PostHog went through MCP only because no MCP + Terraform path was ready, and it left TODOS #15 behind. Sentry's provider is mature, and the DSNs come out as outputs. |
| D3 | **Rules as ADR prose only, or as a versioned contract with golden fixtures?** | **Contract**: `sentry-rules.json`, holding the deny lists, allowed tags, ignored-error patterns, required SDK options, and "dirty event → scrubbed event" fixtures. Each surface's scrubber test runs the fixtures. | Four scrubbers in three languages (Node, browser TS, Dart) will drift if the only shared source is prose. This is the same pattern Basel approved for analytics. |
| D4 | **Plan and cost cap** | Start on the **Developer (free) plan**, with the pay-as-you-go budget at **$0** (a natural hard cap), spike protection on, and a per-DSN rate limit. Move to Team only if you need more seats or volume. *Check the plan limits at signup.* | Pre-revenue. Overage is dropped, never billed. |

## 4. Plan

### 4.1 ADR-091: Error reports go to Sentry EU from the server, portal, landing and phone; never from the local app

The next free number is 091 (ADR-151 is a deliberate jump; re-check at merge, because ADR-089 collided before). Contents:

1. **Who sends.** `api` (Hono server), `portal` (hosted build), `landing` (the lazy landing chunks only; never `src/main.tsx` or `LandingProviders`, which `/app` shares), `capture-app` (Flutter, iOS + Android, including any extension targets MUT-151 opts in).
   - **Never:** the local web app (`/app`) or desktop. ADR-024 and ADR-090 are unchanged.
   - Unlike analytics, crash reports are **not opt-in** on the portal or phone. They're diagnostics with no content, disclosed in the policy (ADR-090 already chose Sentry partly for this reason).
2. **Residency.** Events go to `de.sentry.io` (Frankfurt). ADR-024's me-west1 rule covers *firm data*. Events are built so they carry none (rules 3–5), so the rule isn't engaged; this is the same reasoning ADR-090 §8 uses. Whenever a rule below fails, the fix is to scrub harder, never to accept the data.
3. **Scrubbing** (from the contract file; every surface enforces it in `beforeSend` / `beforeBreadcrumb` or the Dart equivalent):
   - `sendDefaultPii: false`.
   - Never sent: request and response bodies, cookies, query strings, and the headers `authorization`, `cookie`, `set-cookie`, `x-api-key`, `idempotency-key` and `x-forwarded-for`.
   - Any key in `extra`, `contexts` or breadcrumb `data` whose name contains a deny token (amount, total, balance, name, email, phone, note, description, memo, address, iban, account, token, password, secret, key, pepper, session) is dropped.
   - Exception messages go through the same token redaction. Prisma errors drop `meta` and query parameters.
   - User context is `{ id }` only, an internal opaque UUID: no email, username or IP. `ip_address` is null, and the org setting "Prevent storing IP addresses" is on.
   - Tags are allow-listed: `surface`, `request_id`, `route` (the template, never the raw path), `locale`, `release`, `environment`, `app_build`.
   - Breadcrumbs: no console breadcrumbs. Fetch/XHR/Dio breadcrumbs keep only method, path and status. UI clicks keep only the selector, never the text.
   - Phone: `attachScreenshot` and `attachViewHierarchy` are **false**, because the view hierarchy contains on-screen text, i.e. amounts and names.
   - Off everywhere: Replay, tracing (`tracesSampleRate: 0`), profiling, user feedback widgets and attachments.
4. **Never reported:** `ApiError` with status < 500; offline and network failures (`TypeError: Failed to fetch`, `NetworkError`, Dio `connectionError` / `connectionTimeout` / `receiveTimeout`); `AbortError` and user cancellation; `ResizeObserver loop` noise; errors from browser extensions (inbound filter). Chunk-load errors **are** reported, because they mean a bad deploy.
5. **Environments and releases.** Only production builds get a DSN: the Netlify production context, the API image and portal built by `deploy.sh`, and the fastlane release lanes. Dev, QA, preview and deploy-preview builds have no DSN, so no SDK starts and nothing errors.
   - Release names are `<project>@<version>+<short-sha>`. The phone uses `capture-app@<version>+<build>`.
6. **Source maps and debug symbols** are uploaded at build time and **deleted from the output** before publishing; they're never served publicly.
7. **Tokens.**
   - **(a) Upload token:** an org auth token (`sntrys_…`) with only release/upload scopes. It lives:
     - in Netlify build env as plain `SENTRY_AUTH_TOKEN` (never `VITE_`);
     - in `release.env` or the operator shell for the portal and server;
     - in the fastlane shell env for the phone.
   - **(b) Terraform token:** an admin-scoped token held only in the operator's shell for `terraform apply`.
   - Neither is ever committed or shipped. MUT-149 and MUT-150 make `check-bundles` fail on any `sntrys_` or `sntryu_` string in a bundle.
8. **Alerts.** Each project alerts by email to Basel on: a new issue, a regression, and a spike (the same issue more than N times in an hour).
9. **Privacy policy and store labels** change with each surface (ADR-090 P3). `docs/observability/README.md` holds the approved en/ar wording.

The override log is short. It reaffirms ADR-024 and records that today's "no crash reporting" sentence in `noTracking` will be replaced by the surface stories, never by this ticket.

### 4.2 `docs/observability/sentry-rules.json` (contract v1.0.0) + `docs/observability/README.md`

- **JSON keys:**
  - `version`, `surfaces` (exactly the four), `region`
  - `sdk` (required option values)
  - `denyHeaders`, `denyKeyTokens`, `allowedTags`, `allowedUserKeys` (`["id"]`)
  - `ignoredErrors` (per surface: regex strings)
  - `fixtures`: about six `{ name, surface, input, expected }` pairs: a server event with body, cookie, auth header, query string and an `amount` in `extra`; a portal fetch breadcrumb with a query string; a Dio breadcrumb with a body; a user object carrying an email; a Prisma error with `meta`; an exception message holding a client name.
- **README:** who sends; the rules in prose; how to change the contract (bump the version and add the sha row; Flutter copies it); the **privacy wording** per surface (en + ar), coordinated with `docs/analytics/README.md`; **store disclosures** (Apple: Diagnostics › Crash Data and Other Diagnostic Data, not linked, not tracking; Google: App info and performance › Crash logs and Diagnostics, collected, not shared, required); the **token handling** table.

### 4.3 `server/infrastructure/sentry/` (new Terraform root module)

| File | Contents |
|---|---|
| `versions.tf` | `jianyuan/sentry` (pin the latest 0.x at build time), `backend "gcs" {}` |
| `main.tf` | `provider "sentry" { base_url = "https://de.sentry.io/api/" }`. `sentry_team.mutaba3a`. Four `sentry_project`s (platforms `node`, `javascript-react`, `javascript-react`, `flutter`; `default_rules = false`). One `sentry_key` each with `rate_limit_window`/`rate_limit_count`. `sentry_project_spike_protection` × 4. `sentry_project_inbound_data_filter` (browser extensions, localhost, web crawlers, legacy browsers) on portal and landing. `sentry_issue_alert` × 3 per project (new issue, regression, frequency spike), sending email to the member looked up from `var.alert_member_email`. |
| `variables.tf` | `organization`, `alert_member_email`, `spike_threshold_per_hour` (default 50), `key_rate_limit_per_hour` (map) |
| `outputs.tf` | `dsn` per project (sensitive), project slugs |
| `production.tfvars.example`, `backend.hcl.example`, `.gitignore` | Same as the GCP module. State prefix `mutaba3a-sentry/production`. |

- The token comes from `SENTRY_AUTH_TOKEN` in the operator's shell, never a tfvar.
- Resource shapes (the issue-alert v2 schema, the spike-protection resource) are checked against the pinned provider's docs at build time.
- **Not in Terraform:**
  - billing (pay-as-you-go budget $0);
  - the org security settings: Require Data Scrubber, Require default scrubbers, Prevent storing IP addresses, plus org-wide sensitive fields mirroring `denyKeyTokens`.

  These are recorded operator steps, each with a `curl` read-back of `GET /api/0/organizations/<org>/`.

`.github/workflows/server-ci.yml`: the `terraform` job validates both modules (a matrix over the two directories).

### 4.4 Docs and env files

- `server/DEPLOYMENT.md` gets a new **§1.5 Sentry (one-time)**:
  1. Sign up in the EU region.
  2. Set billing and the org security settings.
  3. Create the two tokens.
  4. Run `terraform init -backend-config=…` and `apply`.
  5. Read the settings back.
  6. Copy each DSN to its home (§4.5).
- `.claude/INFRA.md` §1 gets an "Error reporting (ADR-091)" table (host, status, settings, keys, defined in) and an §2 note. CI_CD.md's monitoring row changes to "Defined; surfaces wire in MUT-148..151".

### 4.5 Where each DSN and token lives (documented here; consumed by the surface stories)

| Surface | DSN | Upload token | Consumed by |
|---|---|---|---|
| api | Secret Manager `mutaba3a-api-sentry-dsn` → Cloud Run env `SENTRY_DSN` (Terraform, in the GCP module) | none (Node uploads not needed; source is in the image, or use `sentry-cli` in `deploy.sh`) | MUT-148 |
| portal | `VITE_SENTRY_DSN` in the **hosted** build env (`deploy.sh` step 1) | `SENTRY_AUTH_TOKEN` in `release.env` / operator shell | MUT-149 |
| landing | `VITE_SENTRY_DSN` in Netlify's **production context only** | `SENTRY_AUTH_TOKEN` in Netlify build env (not `VITE_`) | MUT-150 |
| capture-app | `SENTRY_DSN` in Flutter `.env` (compiled in; a DSN is public by design) | `SENTRY_AUTH_TOKEN` in the **fastlane shell env, never `.env`** | MUT-151 |

`.env.example` files get commented entries: root (`VITE_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` build-only); `server/.env.example` (`SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`); `release.env.example` (`SENTRY_AUTH_TOKEN`); the Flutter `.env.example` (`SENTRY_DSN`, plus the warning).

### 4.6 Landmine recorded in the ADR and both `.env.example` files

The Flutter `.env` is passed to `--dart-define-from-file`, so **every value in it is compiled into the app binary**. A `SENTRY_AUTH_TOKEN` placed there ships to every phone. The same applies to any `VITE_`-prefixed variable on the web.

## 5. Tests (TDD: written first, red, then green)

`scripts/__tests__/sentry-rules.test.ts` (Vitest, run with `npm run test:run`):

1. The contract parses; it has no unknown keys; `version` is semver.
2. It's pinned: the sha256 of the file matches `PINNED_VERSIONS[version]` (append-only).
3. `surfaces` is exactly `api, portal, landing, capture-app`, and never `web`, `desktop` or `app`.
4. `sdk` requires `sendDefaultPii: false`, `tracesSampleRate: 0`, replay off, `attachScreenshot: false` and `attachViewHierarchy: false`.
5. `denyKeyTokens` holds at least the ADR minimum set; `denyHeaders` holds at least authorization, cookie and x-api-key.
6. Every fixture's `expected`: has no deny header (case-insensitive), no `request.data`, `cookies` or `query_string`; its `user` keys ⊆ `allowedUserKeys`; its tags ⊆ `allowedTags`; and no key in it contains a deny token.
7. Every fixture's `input` *does* contain something forbidden, so each fixture proves something.
8. Every `ignoredErrors` pattern compiles as a RegExp, and every surface has an entry.

Terraform: `terraform fmt -check -recursive`, `terraform init -backend=false` and `terraform validate` in `server/infrastructure/sentry` (locally and in server-ci).

Release-QA: **none.** No user-visible flow changes in this ticket. The surface stories carry the QA scenarios (for example "landing sends zero Sentry requests on `/app`"). `release-qa lint` must stay clean.

Gate (Node 22): `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run build`, plus the Terraform checks above.

## 6. Done-ness and who does what

- **Claude (`/eng-build`):** everything in §4–5 on `feature/mut-147-sentry-foundation` in a worktree, plus the one-file Flutter change (`.env.example`) on its own branch in the Flutter repo. Merged to local main, not pushed.
- **Basel (operator; Claude may not create accounts or run `terraform apply`):** EU signup, billing at $0, the org security settings, two tokens, `terraform apply`, and the read-back.
- **The ticket moves to In Review** after merge, and to **Done** once Basel's apply and read-back confirm four projects, alerts and spike protection. INFRA's "Status" row records the date.

## 7. Impact

- **Unblocks:** MUT-148..151. The web scrubber should live once in `src/lib/observability/` (first of MUT-149/150 to build it; the other reuses it).
- **Cost:** $0/month on the Developer plan; overage is dropped.
- **Risk:** the main risk is the provider's resource-schema churn; it's pinned, and CI validates it.

---

# Eng review (plan-eng-review, 2026-10-17)

Target: `.claude/designs/mut-147-sentry-foundation.md` (this file, §1–7 above are the original plan, unchanged).

## Scope record

feature answers: D1 keep Terraform (A), D2 keep scrub contract (A), D3 Flutter `.env.example` line moves to MUT-151 (B); structure: D4 A, original arrangement (separate root module `server/infrastructure/sentry/`); accepted scope: §4 as written, minus the Flutter `.env.example` edit (MUT-147 documents the Flutter DSN and token rule in `docs/observability/README.md` and leaves a Jira comment on MUT-151); pending remedies: R1, R2, R3, R4.

Scope Challenge result: scope reduced per recommendation (one cross-repo edit moved to MUT-151).

## Scope Challenge findings

Evidence: provider docs read 2026-10-17 (`jianyuan/terraform-provider-sentry` docs/resources: project.md, key.md, organization.md, index.md; resource list includes `project_spike_protection`, `all_projects_spike_protection`, `issue_alert`, `key`, `project_inbound_data_filter`).

1. [P2] (confidence 9/10) §4.3 table, `main.tf` row: "Four `sentry_project`s (... `default_rules = false`). One `sentry_key` each". Provider `project.md`: "`default_key` (boolean): creates a default key on project creation." Unless `default_key = false`, each project gets a second, un-rate-limited key. → R1.
2. [P2] (confidence 8/10) §4.3 does not use `client_security.allowed_domains` (provider `project.md`: "origin URLs Sentry accepts events from"). The portal and landing DSNs are public in their bundles, so anyone can post events to them and use up the plan's monthly quota (D4 caps spend, which turns abuse into lost real errors). → R2.
3. [P3] (confidence 9/10) §4.3 lists `sentry_project_spike_protection` × 4; the provider also has `sentry_all_projects_spike_protection`. Same approved behavior (spike protection on all four), so this is a mechanism note, not a choice: the build uses whichever validates with the pinned provider version. No question.
4. [P3] (confidence 5/10, medium, verify at build) §4.3 `base_url = "https://de.sentry.io/api/"`. The provider documents the `https://[hostname]/api/` format and defaults to `https://sentry.io/api/`; whether an EU org's org-scoped calls need `de.sentry.io` or work through `sentry.io` is unverified. Build step: `terraform plan` against the real org; keep whichever host plans cleanly; record it in INFRA. No question.
5. Factual correction (no behavior change) §3 D2 "Why" column: PostHog went MCP-first because in MUT-153 D3 Basel chose MCP + INFRA following the Netlify Forms precedent, and the PostHog provider's coverage of project settings was unconfirmed, not because "no MCP + Terraform path was ready".
6. Open from §3: D1 (which Sentry org) and D4 (plan and cost cap) are operator/product decisions not yet answered. → R3, R4.

## Decision ledger

### R1: Turn off each project's automatic default key
Finding: 1, P2, confidence 9/10, §4.3 `main.tf` row, reviewer: plan-eng-review (Claude)
Plan baseline: original proposal: four `sentry_project` (default_rules = false) + one `sentry_key` each with rate limits; `default_key` unspecified (provider default creates one).
Runtime evidence: provider docs/resources/project.md: "`default_key` (boolean): creates a default key on project creation. Only takes effect on creation"; key.md: `rate_limit_count`, `rate_limit_window`, `dsn` map. Not applied anywhere yet.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 default key per project | unspecified (provider creates one) | `default_key = false`; only the managed, rate-limited `sentry_key` exists; a test-free `terraform plan` shows exactly 4 keys | leave default; each project has 2 keys, the default one has no rate limit |
| R2 DSN origin allow-list | pending | pending | pending |
| R3 Sentry org | pending | pending | pending |
| R4 plan and cost cap | pending | pending | pending |
Question D5:
D5 — Turn off the automatic default key on each Sentry project?
Project/branch/task: main, planning MUT-147 (Sentry foundation).
ELI10: When Terraform creates a Sentry project, Sentry also creates a default DSN key for it unless told not to. Our plan adds its own key per project with a rate limit. Without `default_key = false` every project ends up with two working keys, and the extra one has no rate limit, so the cost guard can be bypassed by anyone who finds it (or by a story that copies the wrong DSN).
Stakes if we pick wrong: a second, uncapped DSN per project; a crash loop through it eats the monthly quota.
Recommendation: A because it is one line per project and keeps exactly one rate-limited key.
Completeness: A=10/10, B=5/10
Pros / cons:
A) default_key = false (recommended)
  ✅ Exactly one DSN per project, the rate-limited one that Terraform outputs and the stories wire in
  ✅ One line per project, and `terraform plan` shows four keys, so a stray key is visible in review
  ❌ Only applies at creation, so the order matters: set it before the first apply, never after
B) Keep the provider default
  ✅ No change to the plan, and a ready DSN exists even if the managed key resource fails
  ❌ Two live DSNs per project; the un-rate-limited one sidesteps the cost guard and confuses wiring
Net: one line per project removes a duplicate, uncapped key.
Header: Default key
Options:
A) default_key = false (recommended)
Set default_key = false on all four sentry_project resources so the managed sentry_key (with rate_limit_window/count) is the only DSN. Must be in place before the first apply. (human ~10 min / CC ~1 min)
B) Keep provider default
Leave default_key unset; each project keeps Sentry's auto-created key alongside the managed one. No change. (human 0 / CC 0)

State: approved
Actual answer: A) default_key = false (recommended), Basel, D5 answer 2026-10-17
Accepted scope: `default_key = false` on all four `sentry_project` resources, set before the first apply; the managed rate-limited `sentry_key` is the only DSN per project.
History: none

### R2: Restrict the browser DSNs to their own origins
Finding: 2, P2, confidence 8/10, §4.3 (no `client_security` on any project), reviewer: plan-eng-review (Claude)
Plan baseline: original proposal: no origin restriction on any project (Sentry default accepts any origin).
Runtime evidence: provider docs/resources/project.md: "`client_security` (attributes): origin URLs Sentry accepts events from. Contains `allowed_domains` (set of strings)". Known origins today: landing `https://mutaba3a.netlify.app` (INFRA §1; `mutaba3a.app` has no DNS), portal = the Cloud Run `run.app` URL (`MUTABA3A_PORTAL_URL` default in vite.config.ts; `scripts/bundle-origins.json`). Server and Flutter events carry no browser Origin header.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 default key per project | approved: `default_key = false` (D5) | unchanged | unchanged |
| R2 DSN origin allow-list | none: any origin accepted | `client_security.allowed_domains` on `portal` and `landing` from a variable (`landing_origins`, `portal_origins`), production values in `production.tfvars`; `api` and `capture-app` stay `*`; README tells MUT-112 to add the custom domain | no restriction; rely on per-key rate limits only |
| R3 Sentry org | pending | pending | pending |
| R4 plan and cost cap | pending | pending | pending |
Question D6:
D6 — Only accept browser error reports from our own sites?
Project/branch/task: main, planning MUT-147 (Sentry foundation).
ELI10: The portal and landing DSNs are baked into public JavaScript, so anyone can copy them and send fake errors. Sentry can be told to accept events only from listed website origins. Without it, junk events count against the monthly quota; once the quota is gone, real errors are either dropped or billed as overage, depending on the cost cap still to be decided (R4). The server and phone app don't send a browser origin, so they stay open.
Stakes if we pick wrong: open, the quota can be burned by anyone; restricted, a forgotten domain (e.g. when mutaba3a.app gets DNS) silently drops real errors from that domain.
Recommendation: A because the origins are already listed in bundle-origins.json and the domain move (MUT-112) already has to touch every origin list.
Completeness: A=9/10, B=6/10
Pros / cons:
A) Restrict portal and landing (recommended)
  ✅ Copied DSNs can't burn the quota, so real portal and landing errors keep arriving all month
  ✅ Origins come from a Terraform variable, so the MUT-112 domain move is a one-line tfvars change
  ❌ If the custom domain ships without updating the variable, errors from it are dropped silently
B) No origin restriction
  ✅ Nothing to keep in sync when domains change, and no way to drop real events by mistake
  ❌ Anyone with the public DSN can fill the free quota with junk; rate limits only slow them down
Net: a variable to keep in sync versus a quota anyone can drain.
Header: DSN origins
Options:
A) Restrict portal and landing (recommended)
Set client_security.allowed_domains on the portal and landing projects from variables landing_origins/portal_origins (production.tfvars holds today's Netlify and Cloud Run origins); api and capture-app accept any origin; INFRA and the MUT-112 note say to add the custom domain. (human ~30 min / CC ~3 min)
B) No origin restriction
Leave client_security unset on every project; per-key rate limits are the only guard against abuse. (human 0 / CC 0)

State: approved
Actual answer: A) Restrict portal and landing (recommended), Basel, D6 answer 2026-10-17
Accepted scope: `client_security.allowed_domains` on the `portal` and `landing` projects from variables `landing_origins` / `portal_origins` (production values in `production.tfvars`: today's Netlify and Cloud Run origins); `api` and `capture-app` accept any origin; INFRA and a MUT-112 note say to add the custom domain.
History: ELI10 reworded before sending so it did not assume R4's cap.

### R3: Which Sentry org holds the four projects
Finding: 6 (open §3 D1), operator/product decision, reviewer: plan-eng-review (Claude)
Plan baseline: original proposal: a new EU-region org (e.g. `barmajiyat`) unless the existing org is already EU; Basel signs up (Claude can't create accounts).
Runtime evidence: `/Users/basel/Work/elMokhtbr/wen3flstin-web/package.json:63` has `"@sentry/nextjs": "^10.69.0"`, so a Sentry account and org likely exist; its region and plan are unknown. Malafat has no Sentry. Sentry's data region is fixed when an org is created; the free plan's error quota is per org.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 default key per project | approved (D5) | unchanged | unchanged |
| R2 DSN origin allow-list | approved (D6) | unchanged | unchanged |
| R3 Sentry org | undecided | new dedicated EU-region org (e.g. `barmajiyat`) created by Basel from his existing Sentry login; Terraform `organization` variable points at it | reuse the wen3flstin org, only if it is EU region; shares its quota, members and alert noise |
| R4 plan and cost cap | pending | pending | pending |
Question D7:
D7 — A new EU Sentry org for Mutaba3a, or reuse the wen3flstin one?
Project/branch/task: main, planning MUT-147 (Sentry foundation).
ELI10: wen3flstin-web already uses Sentry, so you probably have an account and an org. A Sentry org's data region is chosen when it is created and can't be changed, and the free plan's monthly error allowance belongs to the org, so every project in it shares one bucket. A fresh EU org keeps Mutaba3a's error data in Frankfurt, its own quota, and its own alerts. Reusing works only if that org is already EU, and then a noisy wen3flstin week can use up Mutaba3a's errors.
Stakes if we pick wrong: a US org breaks the residency reasoning in the ADR; a shared org lets another product's errors crowd out Mutaba3a's.
Recommendation: A because region and quota both need to belong to Mutaba3a, and creating a second org from the same login is a two-minute step for you.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) New dedicated EU org (recommended)
  ✅ Data stays in Sentry's Frankfurt region by construction, matching what ADR-091 promises
  ✅ Its own free quota, members and alerts, so another product's error spike can't hide Mutaba3a's
  ❌ One more org to log into, and a second free-plan seat limit if someone else ever needs access
B) Reuse the wen3flstin org (if EU)
  ✅ No new signup, one place to look at errors for every project you run
  ❌ Shared quota and alerts with an unrelated product; invalid outright if that org is US region
Net: a two-minute signup buys Mutaba3a its own region guarantee and quota.
Header: Sentry org
Options:
A) New dedicated EU org (recommended)
Basel creates a new org in the EU (Frankfurt) region from his Sentry login, e.g. slug `barmajiyat`; MUT-147's Terraform `organization` variable and INFRA name it; wen3flstin stays where it is. (human ~5 min / CC 0)
B) Reuse the wen3flstin org (if EU)
Basel confirms the existing org's region is EU; the four Mutaba3a projects go into it, sharing its quota, members and alerts. If it is US, this option is void and A applies. (human ~5 min / CC 0)

State: approved
Actual answer: A) New dedicated EU org (recommended), Basel, D7 answer 2026-10-17
Accepted scope: Basel creates a new EU (Frankfurt) region org from his Sentry login (e.g. slug `barmajiyat`); the Terraform `organization` variable and INFRA name it; the wen3flstin org is untouched.
History: none

### R4: Sentry plan and cost cap
Finding: 6 (open §3 D4), product/cost decision, reviewer: plan-eng-review (Claude)
Plan baseline: original proposal: Developer (free) plan, pay-as-you-go budget $0, spike protection on, per-key rate limits.
Runtime evidence: third-party pricing pages only (Sentry's own page not reached, 2026-10-17): Developer free, 1 user, about 5,000 errors/month; Team about $26/month, more users, about 50,000 errors/month; events over quota and budget are not accepted. Verify on Sentry's pricing page at signup. Mutaba3a is pre-revenue (user profile memory).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 default key per project | approved (D5) | unchanged | unchanged |
| R2 DSN origin allow-list | approved (D6) | unchanged | unchanged |
| R3 Sentry org | approved: new EU org (D7) | unchanged | unchanged |
| R4 plan and cost cap | undecided | Developer (free) plan, pay-as-you-go budget $0 (overage dropped, never billed), spike protection on all projects, per-key rate limits; move to Team when a second person needs access or the quota runs out two months running | Team plan from day one, pay-as-you-go budget $0, same spike protection and rate limits |
Question D8:
D8 — Start Sentry on the free plan with a $0 overage cap?
Project/branch/task: main, planning MUT-147 (Sentry foundation).
ELI10: Sentry's free Developer plan gives one user about 5,000 errors a month (third-party figures, check at signup). Team is about $26 a month for more users and about ten times the errors. Setting the pay-as-you-go budget to $0 means anything over the quota is dropped, never billed, and spike protection stops one crash loop from eating the month. You are pre-revenue and the only person who reads alerts today.
Stakes if we pick wrong: free with $0 can drop real errors late in a bad month; Team costs about $312 a year before anyone else needs a seat.
Recommendation: A because one reader and four small surfaces fit the free quota, and the upgrade trigger is written down.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Free plan, $0 overage (recommended)
  ✅ Costs nothing, and a crash loop or abuse can never produce a bill, only dropped events
  ✅ Upgrade trigger is recorded in INFRA, so moving to Team is a deliberate step, not a surprise
  ❌ One seat only, and in a bad month real errors after the quota are dropped until it resets
B) Team plan, $0 overage
  ✅ More seats and about ten times the error quota, so a bad month is far less likely to drop errors
  ✅ Room to add a collaborator or a contractor without changing plans later
  ❌ About $26 a month ($312 a year) spent before revenue, for headroom nobody uses yet
Net: free now with a written upgrade trigger versus paying for headroom up front.
Header: Plan and cap
Options:
A) Free plan, $0 overage (recommended)
Developer (free) plan; pay-as-you-go budget $0 so overage is dropped; spike protection on all projects; per-key rate limits; INFRA records the upgrade trigger (a second person needs access, or the quota runs out two months running). Verify plan limits at signup. (human ~5 min / CC 0)
B) Team plan, $0 overage
Team plan (about $26/month, verify at signup) from the start; pay-as-you-go budget $0; same spike protection and rate limits. (human ~5 min / CC 0; about $312/year)

State: approved
Actual answer: A) Free plan, $0 overage (recommended), Basel, D8 answer 2026-10-17
Accepted scope: Developer (free) plan; pay-as-you-go budget $0 (overage dropped, never billed); spike protection on all projects; per-key rate limits; INFRA records the upgrade trigger (a second person needs access, or the quota runs out two months running); plan limits verified at signup.
History: none

Scope Challenge dispositions: finding 1 → R1 approved (D5); finding 2 → R2 approved (D6); findings 3, 4 and 5 recorded as notes (no behavior change); finding 6 → R3 approved (D7), R4 approved (D8).

## Section 1: Architecture

- [P1] (confidence 8/10) §4.2: "JSON keys: ... `fixtures`: about six `{ name, surface, input, expected }` pairs". `server/Dockerfile:10-12`: "copied into this build context as `dist-hosted/` ... This stage never imports frontend source"; the image is built from `server/`, so server runtime code cannot read `docs/`. The portal and landing can import JSON at build time, and doing so would bundle the dirty fixture events. → R5.
- Note A2 (no question): §4.5 api row says "Terraform, in the GCP module" without a mechanism. With separate states (D4), MUT-148's route is a `terraform_remote_state` data source reading the Sentry state's `dsn` output from the same GCS bucket; no Sentry token is needed at deploy time.
- Note A3 (no question, MUT-148): `.github/workflows/server-ci.yml:13` triggers on `'server/**'` only; when a server test reads the contract, add `'docs/observability/**'`.
- Note A4 (no question, build-time): §4.3 routes alerts via `var.alert_member_email` (needs a member lookup). On a one-seat org, the issue-owners-then-all-members target reaches the same person with no email in tfvars; the build uses what the pinned provider supports and INFRA records it.

### R5: Split the contract into runtime rules and test-only fixtures
Finding: Section 1 P1, confidence 8/10, §4.2 + server/Dockerfile:10-12, reviewer: plan-eng-review (Claude)
Plan baseline: original proposal (§4.2, D2 approved): one `docs/observability/sentry-rules.json` holding the lists, SDK options and fixtures; sha-pinned; Flutter byte copy.
Runtime evidence: Dockerfile builds from `server/` only; vite can import repo JSON into bundles; nothing exists yet.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1–R4 | approved (D5–D8) | unchanged | unchanged |
| D2 contract exists | approved (A) | unchanged | unchanged |
| R5 contract layout | one file with lists + fixtures | two files: `sentry-rules.json` (lists, tags, ignored errors, SDK options; small, safe to import into web bundles) and `sentry-fixtures.json` (test-only); both sha-pinned under one contract version; rule written in README and ADR: server and Flutter embed the lists in code and a test asserts equality with the JSON; web may import `sentry-rules.json` but never the fixtures (MUT-149/150 `check-bundles` asserts no fixture marker string) | one file; README rule: no surface imports the JSON at runtime; every surface embeds its lists in code and tests equality |
Question D9:
D9 — Split the scrub contract into runtime rules and test-only fixtures?
Project/branch/task: main, planning MUT-147 (Sentry foundation).
ELI10: The contract has two jobs: the deny lists that the running scrubbers use, and the "dirty event in, clean event out" examples that only tests use. The server image can't read files outside server/, and if the portal or landing imports one combined file, the dirty examples (fake emails, fake amounts) end up in the public JavaScript. Two files let the web import the small rules file directly while fixtures stay test-only; one file means every surface copies the lists into code and a test checks they match.
Stakes if we pick wrong: one imported combined file ships fake PII fixtures to every browser and bloats the bundle; copy-everywhere means four hand-copied lists to keep equal.
Recommendation: A because the web can use the rules as-is, and the fixture rule is one bundle check.
Completeness: A=10/10, B=8/10
Pros / cons:
A) Two files (recommended)
  ✅ Portal and landing import the real lists, so they can't drift from the contract at all
  ✅ Fixtures never reach a bundle, and a check-bundles marker makes that fail CI if someone tries
  ❌ Two pinned hashes per version and two files for Flutter to copy (MUT-151)
B) One file, never imported at runtime
  ✅ One file and one hash, the simplest contract to version
  ❌ All four surfaces hand-copy the lists into code; equality tests catch drift, but only in tests
Net: one extra file lets the web use the contract directly and keeps fixtures out of bundles.
Header: Contract layout
Options:
A) Two files (recommended)
sentry-rules.json (lists, allowed tags, ignored errors, SDK options) + sentry-fixtures.json (test-only), both sha-pinned under one version; README/ADR: server and Flutter embed lists and test equality, web may import the rules file but never fixtures (MUT-149/150 check-bundles asserts a fixture marker is absent). (human ~1h / CC ~5 min)
B) One file, never imported at runtime
Keep a single sentry-rules.json with fixtures; README/ADR: no surface imports it at runtime; each surface embeds its lists in code and a test asserts equality with the JSON. (human ~30 min / CC ~3 min)

State: approved
Actual answer: A) Two files (recommended), Basel, D9 answer 2026-10-17
Accepted scope: `docs/observability/sentry-rules.json` (lists, allowed tags, ignored errors, SDK options; importable by web bundles) + `docs/observability/sentry-fixtures.json` (test-only), both sha-pinned under one contract version; README and ADR say: server and Flutter embed the lists in code and a test asserts equality with the JSON; web may import the rules file, never the fixtures (MUT-149/150 `check-bundles` asserts a fixture marker string is absent).
History: none

Section 1 dispositions: P1 → R5 approved (D9); notes A2, A3, A4 recorded for MUT-148 and the build.

## Section 2: Code quality

- [P1] (confidence 8/10) §4.1 rule 3: "Any key in `extra`, `contexts` or breadcrumb `data` whose name contains a deny token (amount, total, balance, name, email, phone, note, description, memo, address, iban, account, token, password, secret, key, pepper, session) is dropped." Substring matching on `name` and `key` also hits `filename`, `hostname`, `os.name`, `browser.name`, `runtime.name`, `keyboard`, `monkey`; `contexts` holds Sentry's own os/browser/runtime/device contexts. Over-redaction loses the debug data the project exists for, and `device.name` (for example "Basel's iPhone") is a person's name that a "keep SDK contexts" exception would wrongly let through. Precedent: ADR-090 §3 matches banned names "by whole token" for the same reason. → R6.
- Note C1 (no question): §4.1 rule 3 says "Exception messages go through the same token redaction". Messages are free text, not keys, so token-matching a message only catches labelled values ("amount=120"). The ADR states that limit plainly; the real guard for messages is server rule 4 (only 5xx and unknown errors are sent) plus surface code never interpolating user values into thrown messages.

### R6: Whole-token key matching, scoped, with an explicit safe list
Finding: Section 2 P1, confidence 8/10, §4.1 rule 3, reviewer: plan-eng-review (Claude)
Plan baseline: original proposal: drop any key in extra/contexts/breadcrumb data whose name *contains* a deny token.
Runtime evidence: no scrubber exists yet; ADR-090 §3 (DECISIONS.md) uses whole-token matching for banned analytics names.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1–R5 | approved (D5–D9) | unchanged | unchanged |
| R6 key-matching rule | substring "contains" anywhere in extra/contexts/breadcrumb data | key split into tokens (snake, kebab, dot, camelCase); dropped when any token is a deny token; applies to `extra`, `contexts`, breadcrumb `data`, tags and user; never to `exception.values[].stacktrace` frames, `sdk`, `release`, `environment`; rules file carries `safeContextKeys` (`os.name`, `os.version`, `browser.name`, `browser.version`, `runtime.name`, `runtime.version`, `device.family`, `device.model`) and `alwaysDropContextKeys` (`device.name`, `user.*` beyond `id`); fixtures prove both (a frame `filename` and `os.name` survive; `device.name` and `client_name` go) | keep substring matching as written; accept that `filename`, `os.name`, etc. get dropped |
Question D10:
D10 — Match deny words as whole tokens, and protect Sentry's own debug fields?
Project/branch/task: main, planning MUT-147 (Sentry foundation).
ELI10: The plan drops any field whose name *contains* words like "name" or "key". That also wipes `filename` in stack traces, the OS and browser name, and random words like "keyboard", so error reports lose the details you need to fix the bug. Matching whole words (split `client_name` into `client` + `name`) still drops `client_name`, keeps `filename`, and lets us list the few Sentry fields that are safe (`os.name`) and the one that is not (`device.name`, often "Basel's iPhone").
Stakes if we pick wrong: substring matching ships reports with no file names or OS info; a careless "keep SDK fields" exception would leak device names.
Recommendation: A because it is the rule ADR-090 already uses, and fixtures prove both directions.
Completeness: A=10/10, B=5/10
Pros / cons:
A) Whole tokens + safe list (recommended)
  ✅ Stack frames and OS/browser/runtime info survive, so a report still says where and on what it broke
  ✅ `device.name` is dropped explicitly, closing the leak a blanket SDK-context exception would open
  ❌ Each surface needs a tokenizer (snake, kebab, dot, camelCase); fixtures pin its behavior
B) Keep substring matching
  ✅ Simplest rule to implement in three languages; anything near a deny word is gone
  ❌ Strips `filename`, `os.name`, `browser.name` and more, so many reports lose their key debug fields
Net: whole-token matching keeps reports useful without loosening what is dropped.
Header: Key matching
Options:
A) Whole tokens + safe list (recommended)
Tokenize keys (snake/kebab/dot/camelCase), drop on any deny token in extra, contexts, breadcrumb data, tags and user; never touch stack frames, sdk, release, environment; rules file adds safeContextKeys (os/browser/runtime name+version, device family+model) and alwaysDropContextKeys (device.name); fixtures prove a frame filename and os.name survive and device.name and client_name go. (human ~2h / CC ~10 min)
B) Keep substring matching
Rule stays "key contains a deny token" across extra, contexts and breadcrumb data, as §4.1 says; no safe list. (human 0 / CC 0)

State: approved
Actual answer: A) Whole tokens + safe list (recommended), Basel, D10 answer 2026-10-17
Accepted scope: keys are tokenized (snake, kebab, dot, camelCase) and dropped when any token is a deny token, in `extra`, `contexts`, breadcrumb `data`, tags and user; stack frames, `sdk`, `release` and `environment` are never touched; `sentry-rules.json` adds `safeContextKeys` (os/browser/runtime name + version, device family + model) and `alwaysDropContextKeys` (`device.name`, `user.*` beyond `id`); fixtures prove a frame `filename` and `os.name` survive and `device.name` and `client_name` are dropped.
History: none

Section 2 dispositions: P1 → R6 approved (D10); note C1 recorded (ADR states the limit of message redaction).

## Section 3: Test review

Framework: Vitest (CLAUDE.md Phase 4, `npm run test:run`); Terraform checks via `terraform fmt/validate` (server-ci).

```
CODE PATHS (proposed)                                           COVERAGE
[+] docs/observability/sentry-rules.json + sentry-fixtures.json
  ├── shape: known keys only, semver version                    [★★★ planned] test 1
  ├── pin: sha256 of BOTH files per version (R5)                [★★★ planned] test 2 (extend to two files)
  ├── surfaces == api, portal, landing, capture-app             [★★★ planned] test 3
  ├── sdk options (pii off, traces 0, replay off, no screenshot,
  │   no view hierarchy)                                        [★★★ planned] test 4
  ├── deny minimum sets (tokens, headers)                       [★★★ planned] test 5
  ├── allowedTags contain no deny token                         [GAP] → add row to test 5
  ├── safeContextKeys ∩ alwaysDropContextKeys = ∅, device.name
  │   only in alwaysDrop (R6)                                   [GAP] → add row to test 5
  ├── fixtures: expected has nothing forbidden                  [★★★ planned] test 6 (token-based per R6)
  ├── fixtures: input has something forbidden                   [★★★ planned] test 7
  ├── fixtures: R6 both directions present (frame filename and
  │   os.name kept; device.name, client_name, clientName dropped) [GAP] → add to test 6
  ├── fixture marker string only in fixtures file (R5)          [GAP] → add to test 2
  └── ignoredErrors compile + every surface has an entry        [★★ planned] test 8 (JS only; Dart dialect → R7)
[+] server/infrastructure/sentry (Terraform)
  ├── fmt + validate                                            [★★ planned] CI matrix
  └── default_key=false ×4, allowed_domains on portal/landing
      only, spike protection, 3 alerts per project              [GAP] → R8
USER FLOWS: none in this ticket (no user-visible change; surface stories own QA scenarios)
COVERAGE (planned): 10/14 paths with ★★+ before gaps; 4 gaps (2 required proof of R5/R6, added; 2 new choices R7, R8)
```

Required proof added without a question (exact approved behavior): allowedTags/deny-token row and safe/drop disjointness row (R6), R6 two-direction fixtures (R6), fixture-marker row (R5). Tests made obsolete: none.

### R7: Keep ignored-error patterns to regex syntax both JS and Dart read the same way
Finding: Section 3 gap, confidence 7/10, §5 test 8 "Every `ignoredErrors` pattern compiles as a RegExp", reviewer: plan-eng-review (Claude)
Plan baseline: original proposal: each pattern must compile as a JavaScript RegExp; nothing about Dart.
Runtime evidence: none yet; Flutter (MUT-151) will compile the same strings with Dart's `RegExp`, whose dialect differs in places (inline flags such as `(?i)` are not JS; JS-only features such as the `v` flag syntax are not Dart).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1–R6 | approved (D5–D10) | unchanged | unchanged |
| R7 regex dialect rule | JS-compile check only | test 8 also rejects non-portable syntax: inline flags `(?i)`/`(?m)`, lookbehind `(?<=`/`(?<!`, named groups `(?<name>`, `\p{`, backreferences; case-insensitivity is a per-pattern `"ignoreCase": true` field, not a flag; README documents the subset | JS-compile only; MUT-151 finds out if Dart reads a pattern differently |
Question D11:
D11 — Limit ignored-error patterns to regex syntax JS and Dart both read the same way?
Project/branch/task: main, planning MUT-147 (Sentry foundation).
ELI10: The "never report" list (offline errors, aborted requests) is written as regex patterns that the server and web read with JavaScript and the phone reads with Dart. The two languages mostly agree, but not on things like inline case flags or lookbehind. A pattern that works in JS and quietly fails in Dart means the phone keeps sending offline noise, or drops a real error. A small test can reject the risky syntax up front.
Stakes if we pick wrong: the phone and web ignore different errors, and nobody notices until Sentry fills with offline noise from phones.
Recommendation: A because it is one test row and a README paragraph now, against a silent cross-language mismatch later.
Completeness: A=10/10, B=7/10
Pros / cons:
A) Portable subset, tested (recommended)
  ✅ One list of patterns means the same thing on all four surfaces, proven before any SDK is wired
  ✅ Case-insensitivity becomes an explicit field, so no one relies on a flag Dart reads differently
  ❌ Pattern authors can't use lookbehind or named groups; rarely needed for error-message matching
B) JS compile check only
  ✅ Nothing extra in MUT-147; patterns can use any JavaScript regex feature
  ❌ A pattern that misbehaves in Dart is only found in MUT-151, or in production as phone noise
Net: one test row now prevents the phone and web from ignoring different errors.
Header: Regex subset
Options:
A) Portable subset, tested (recommended)
Test 8 rejects inline flags, lookbehind, named groups, \p{ and backreferences; ignoredErrors entries carry an optional "ignoreCase": true field instead of flags; README documents the subset. (human ~30 min / CC ~3 min)
B) JS compile check only
Test 8 only checks each pattern compiles as a JavaScript RegExp and every surface has an entry, as §5 says. (human 0 / CC 0)

State: approved
Actual answer: A) Portable subset, tested (recommended), Basel, D11 answer 2026-10-17
Accepted scope: test 8 rejects inline flags, lookbehind, named groups, `\p{` and backreferences; `ignoredErrors` entries carry an optional `"ignoreCase": true` field instead of flags; README documents the subset.
History: none

### R8: Plan-time Terraform tests for the settings this review approved
Finding: Section 3 gap, confidence 7/10, §5 "Terraform: `terraform fmt -check -recursive`, `terraform init -backend=false` and `terraform validate`", reviewer: plan-eng-review (Claude)
Plan baseline: original proposal: fmt + validate only (locally and in the server-ci matrix).
Runtime evidence: `.github/workflows/server-ci.yml:115` pins Terraform `1.9.8`; local Terraform is `v1.15.4`. Native `terraform test` with `mock_provider` exists from Terraform 1.7, so both can run it without a Sentry token or network. The repo has no `.tftest.hcl` today (a new pattern for PATTERNS.md).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1–R7 | approved (D5–D11) | unchanged | unchanged |
| R8 Terraform proof | fmt + validate | add `server/infrastructure/sentry/tests/sentry.tftest.hcl` with `mock_provider "sentry"` and `command = plan` runs asserting: exactly 4 projects, each `default_key = false` (R1); `client_security.allowed_domains` set on portal and landing only (R2); spike protection covers all four (R4); 3 issue alerts per project; rate limits set on every key; server-ci matrix runs `terraform test`; PATTERNS.md records the pattern | fmt + validate only; these settings are checked by reading the diff |
Question D12:
D12 — Add plan-time Terraform tests for the Sentry settings we just approved?
Project/branch/task: main, planning MUT-147 (Sentry foundation).
ELI10: `terraform validate` only checks the files are well-formed. It would not notice if someone later deletes `default_key = false`, drops the origin allow-list, or removes spike protection. Terraform has a built-in test runner that can fake the Sentry provider (no token, no network) and assert those settings on the plan. It runs in CI next to validate.
Stakes if we pick wrong: a later edit quietly re-opens an uncapped key or the public DSN, and only a careful reviewer would catch it.
Recommendation: A because these are exactly the cost and abuse guards this review added, and the test costs no token or network.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Add terraform test (recommended)
  ✅ CI fails if default_key, the origin allow-list, spike protection, alerts or rate limits are removed
  ✅ Runs offline with a mocked provider, so CI needs no Sentry token or account
  ❌ A new test pattern in the repo (one .tftest.hcl, a PATTERNS.md entry) to learn and maintain
B) fmt + validate only
  ✅ Nothing new; matches how the GCP module is checked today
  ❌ The guards this review added can be deleted in a later PR with nothing failing
Net: one offline test file locks in the guards this review added.
Header: Terraform test
Options:
A) Add terraform test (recommended)
server/infrastructure/sentry/tests/sentry.tftest.hcl with mock_provider "sentry" and plan-mode runs asserting 4 projects with default_key=false, allowed_domains on portal and landing only, spike protection on all four, 3 alerts per project, rate limits on every key; server-ci matrix runs terraform test; PATTERNS.md entry. (human ~2h / CC ~10 min)
B) fmt + validate only
Keep §5 as written: terraform fmt -check, init -backend=false and validate, locally and in the server-ci matrix. (human 0 / CC 0)

State: approved
Actual answer: A) Add terraform test (recommended), Basel, D12 answer 2026-10-17
Accepted scope: `server/infrastructure/sentry/tests/sentry.tftest.hcl` with `mock_provider "sentry"` and plan-mode runs asserting 4 projects with `default_key = false`, `allowed_domains` on portal and landing only, spike protection on all four, 3 issue alerts per project, rate limits on every key; the server-ci matrix runs `terraform test`; PATTERNS.md records the pattern.
History: none

Section 3 dispositions: gaps for R5/R6 proof added as required work; R7 approved (D11); R8 approved (D12). Test plan artifact written to the gstack project dir.

## Section 4: Performance

No issues found. The contract test reads two small JSON files once per run. Terraform plans a few dozen resources. Runtime cost (scrubbing each event) belongs to the surface stories and is bounded by small event objects. Rate-limit defaults are variables; with the free quota of about 5,000 errors a month, the build sets per-key limits near 60 events an hour for landing and portal and 120 for api and capture-app, recorded in INFRA, and spike protection handles bursts beyond that (scale: unknown real error rate today; revisit after a month of data).

Section 4 dispositions: none.

## Outside voice

Codex CLI not installed (`CODEX_MODE: not_installed`); the native fallback needs a `TaskOutput` tool this session does not have, so outside coverage is **unavailable** (logged). No clean-review credit from it.

## TODOS.md

### R9: TODO for the Sentry org security settings that Terraform cannot hold
Finding: Scope Challenge evidence (provider `organization.md` and `project.md` expose no data-scrubbing, IP-scrubbing or sensitive-field settings), reviewer: plan-eng-review (Claude)
Plan baseline: approved plan keeps them as operator steps with a `curl` read-back recorded in INFRA (D1, §4.3).
Runtime evidence: provider docs read 2026-10-17; no setting in code today.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1–R8 | approved (D5–D12) | unchanged | unchanged | unchanged |
| R9 TODO for org security settings | none | add TODOS #16: move Require Data Scrubber, default scrubbers, Prevent storing IP addresses and org sensitive fields into code when the provider supports them (or a checked script), so drift is caught | no TODO; INFRA's read-back command is the only check | build now in MUT-147: a small `scripts/sentry-org-settings.ts` that PUTs and verifies the settings via the API with the admin token |
Question D13:
D13 — Add a TODO to bring Sentry's org privacy settings into code later?
Project/branch/task: main, planning MUT-147 (Sentry foundation).
ELI10: The Terraform provider can't set Sentry's org-wide privacy switches (require the data scrubber, never store IP addresses, extra sensitive field names). The plan has you flip them once by hand and records a command that reads them back. If someone turns one off in the UI later, nothing notices. A TODO keeps that gap visible until the provider supports it; a script now would close it but adds code that calls Sentry's admin API.
Stakes if we pick wrong: a switched-off IP setting quietly starts storing visitor IPs in the EU org.
Recommendation: A because the gap is real but rare, and the read-back command already exists.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Add TODOS #16 (recommended)
  ✅ The provider gap stays on the list with what, why and where to start, like PostHog's #15
  ✅ No extra code now; the INFRA read-back covers the first apply
  ❌ Drift between read-backs is still possible until the TODO is done
B) Skip, no TODO
  ✅ Nothing to track; INFRA already documents the settings and the read-back
  ❌ The only guard is remembering to rerun the read-back, which nobody will
C) Build a settings script now
  ✅ Settings are applied and verified by code, closing the drift gap today
  ❌ New script against Sentry's admin API in MUT-147, more scope and an admin token to run it
Net: write the gap down now; close it when the provider can.
Header: Org settings TODO
Options:
A) Add TODOS #16 (recommended)
Add TODOS.md #16 (What, Why, Pros, Cons, Context, Depends on) for moving the four org security settings into code once the Sentry provider supports them, or a verified script. (human ~10 min / CC ~2 min)
B) Skip, no TODO
No TODO; INFRA's operator steps and curl read-back are the only record. (human 0 / CC 0)
C) Build a settings script now
MUT-147 adds scripts/sentry-org-settings.ts that sets and verifies the four org settings through Sentry's API using the operator's admin token, documented in DEPLOYMENT §1.5. (human ~3h / CC ~15 min)

State: approved
Actual answer: C) Build a settings script now, Basel, D13 answer 2026-10-17 (against the recommendation A)
Accepted scope: MUT-147 adds `scripts/sentry-org-settings.ts` (run with `tsx`) that sets and verifies the four org security settings (Require Data Scrubber, default scrubbers, Prevent storing IP addresses, org sensitive fields = `denyKeyTokens` from `sentry-rules.json`) through Sentry's org API, using the operator's admin token from `SENTRY_AUTH_TOKEN`; `--apply` writes then verifies, `--check` only verifies and exits non-zero on drift; documented in DEPLOYMENT §1.5 and INFRA. TDD: `scripts/__tests__/sentry-org-settings.test.ts` with `fetch` mocked at the boundary. No TODOS entry.
History: none

Approval readiness: PASS. Checked R1 (D5 A), R2 (D6 A), R3 (D7 A), R4 (D8 A), R5 (D9 A), R6 (D10 A), R7 (D11 A), R8 (D12 A), R9 (D13 C); scope D1 A, D2 A, D3 B, D4 A. Required proof added without a question cites R5 and R6.

## Approved amendments to §3–§6 (the plan to build)

- §3 D1–D4 resolved: new EU org (R3), Terraform (D1), two-file contract (D2 + R5), free plan with $0 overage (R4).
- §4.1 rule 3 now reads: keys are tokenized (snake, kebab, dot, camelCase) and dropped on any deny token in `extra`, `contexts`, breadcrumb `data`, tags and user; stack frames, `sdk`, `release`, `environment` are never touched; `safeContextKeys` and `alwaysDropContextKeys` (device.name) live in the rules file (R6). Message redaction catches labelled values only; the ADR says so (note C1).
- §4.1 rule 4 adds: `ignoredErrors` use a portable regex subset with an `ignoreCase` field (R7).
- §4.2: two files, `sentry-rules.json` (importable) and `sentry-fixtures.json` (test-only), both pinned; server and Flutter embed lists and test equality; web never imports fixtures (R5).
- §4.3: `default_key = false` on all projects (R1); `client_security.allowed_domains` on portal and landing from `landing_origins` / `portal_origins` (R2); spike protection on all four (either resource, note 3); alert target per note A4; `base_url` checked by a real `terraform plan` (note 4); `tests/sentry.tftest.hcl` with a mocked provider, run in CI (R8).
- §4.4: DEPLOYMENT §1.5 step 2 becomes `npx tsx scripts/sentry-org-settings.ts --apply`, and the read-back becomes `--check` (R9).
- §4.5: api DSN reaches Secret Manager in MUT-148 via `terraform_remote_state` (note A2); MUT-148 adds `docs/observability/**` to server-ci paths (note A3). Flutter row: documented in README only; the `.env.example` line and warning move to MUT-151 (D3).
- §5 tests: add the R5/R6 rows, the R7 portability row, the Terraform test (R8) and the settings-script test (R9).
- §6: the operator step list now runs the settings script instead of clicking the four settings.

## NOT in scope

- Flutter `.env.example` line and warning: moved to MUT-151 (D3); a Jira comment on MUT-151 records it.
- Wiring any SDK, scrubber code, source-map upload or privacy-policy publishing: MUT-148..151.
- Moving PostHog settings to Terraform: existing TODOS #15, unrelated to this build.
- Billing (pay-as-you-go budget $0): an operator step in Sentry's UI; no API in the provider or this script.

## What already exists

- ADR-090 + `docs/analytics/*` + `scripts/__tests__/analytics-taxonomy.test.ts`: reused as the shape for ADR-091, the README and the pinned-contract test (rebuilt for Sentry, not shared code: different content and rules).
- `server/infrastructure/terraform/` + server-ci terraform job: reused layout, backend and CI job (now a matrix).
- `server/DEPLOYMENT.md`, `.claude/INFRA.md`: extended, not replaced.

## Diagram

```
operator shell (SENTRY_AUTH_TOKEN admin)          Sentry EU org (de.sentry.io)
  terraform apply  server/infrastructure/sentry ─▶  team, 4 projects (default_key=false),
        │  state: gs://<bucket>/mutaba3a-sentry       4 keys (rate-limited) ─▶ dsn outputs
        │                                              spike protection, 3 alerts/project,
        │                                              allowed_domains (portal, landing)
  tsx scripts/sentry-org-settings.ts --apply|--check ▶ org: scrubber on, defaults on,
        │   (reads docs/observability/sentry-rules.json)   no IP storage, sensitive fields
        ▼
  DSNs ─▶ MUT-148 (remote_state → Secret Manager) · MUT-149 hosted build env
         · MUT-150 Netlify production env · MUT-151 Flutter .env
CI: web-ci → sentry-rules.test.ts, sentry-org-settings.test.ts
    server-ci → terraform fmt/validate/test (matrix: terraform, sentry)
```

## Failure modes

| Path | Realistic failure | Covered by | User-visible? |
|---|---|---|---|
| terraform apply | wrong `base_url` for the EU org (note 4) | real `terraform plan` before apply; DEPLOYMENT §1.5 | operator sees the error |
| terraform apply | a later edit drops default_key/allowed_domains/spike protection | `terraform test` in CI (R8) | no; CI fails |
| settings script | token lacks org:write, or API field renamed | `--apply` verifies by reading back and exits non-zero; test covers mismatch | operator sees the error |
| settings script | someone turns IP storage back on in the UI | `--check` exits non-zero when rerun | silent until rerun (accepted: no scheduler in scope) |
| contract | rules loosened without a version bump | sha pin test | no; CI fails |
| contract | non-portable regex added | R7 test row | no; CI fails |

Critical gaps (no test, no handling, silent): 0. The UI-drift row is silent between runs but has a check command.

## Worktree parallelization strategy

Sequential implementation, no parallelization opportunity: one worktree (`feature/mut-147-sentry-foundation`); the contract, script, Terraform module and docs are small and share the ADR and README.

## Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific finding above.

- [ ] **T1 (P1, human: ~3h / CC: ~15min)**: contract: write `sentry-rules.json` + `sentry-fixtures.json` and the pinned test first (red), with R5/R6/R7 rows
  - Surfaced by: Sections 1–3, R5, R6, R7
  - Files: docs/observability/sentry-rules.json, docs/observability/sentry-fixtures.json, scripts/__tests__/sentry-rules.test.ts
  - Verify: `npm run test:run -- sentry-rules` (Node 22)
- [ ] **T2 (P1, human: ~1 day / CC: ~20min)**: Terraform module with R1/R2/R4 guards and a mocked-provider test
  - Surfaced by: Scope Challenge 1–4, R1, R2, R4, R8
  - Files: server/infrastructure/sentry/{versions,main,variables,outputs}.tf, production.tfvars.example, backend.hcl.example, .gitignore, tests/sentry.tftest.hcl, .github/workflows/server-ci.yml
  - Verify: `terraform fmt -check -recursive && terraform init -backend=false && terraform validate && terraform test`
- [ ] **T3 (P1, human: ~3h / CC: ~15min)**: org settings script, test first
  - Surfaced by: R9
  - Files: scripts/sentry-org-settings.ts, scripts/__tests__/sentry-org-settings.test.ts
  - Verify: `npm run test:run -- sentry-org-settings`
- [ ] **T4 (P2, human: ~3h / CC: ~15min)**: ADR-091, README (rules, regex subset, privacy wording en/ar, store disclosures, token table), INFRA, DEPLOYMENT §1.5, CI_CD, env examples, knowledge files
  - Surfaced by: §4.1, §4.4–4.6, notes A2–A4, C1
  - Files: .claude/DECISIONS.md, docs/observability/README.md, .claude/INFRA.md, server/DEPLOYMENT.md, .claude/CI_CD.md, .env.example, server/.env.example, release.env.example, .claude/{CHANGELOG,PATTERNS,TEST_PLAN,SYSTEM_OVERVIEW}.md
  - Verify: `npm run lint && npm run typecheck && npm run test:run && npm run build`; `release-qa lint` clean
- [ ] **T5 (P2, human: ~10min / CC: ~2min)**: Jira comment on MUT-151 (Flutter `.env.example` line + warning) and notes for MUT-148 (remote_state, server-ci paths) and MUT-149/150 (fixture marker check, never `VITE_` tokens)
  - Surfaced by: D3, notes A2, A3, R5
  - Files: none (Jira)
  - Verify: comments read back on the tickets

## Unresolved decisions

None.

## Completion summary

- Step 0: Scope Challenge — scope reduced per recommendation (Flutter line moved to MUT-151)
- Architecture Review: 1 issue found (R5)
- Code Quality Review: 1 issue found (R6)
- Test Review: diagram produced, 4 gaps identified (2 required proof added, R7, R8)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 1 item proposed to user (built now instead, R9)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (CLI not installed; native fallback lacks TaskOutput)
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 7/9 = answers picking a 10/10 option (D1, D2, D5, D9, D10, D11, D12) / answers scored for completeness (also D3 at 9/10 and D6 at 9/10, both the recommended option)

## Build notes (eng-build, 2026-10-17)

Deviations from the approved plan, each forced by what the code or provider actually allows:

1. **Alerts are three resources** (`sentry_issue_alert.new_issue`, `.regression` and `.spike`, each `for_each` over the surfaces), not one resource keyed by kind. `terraform validate` sees an unknown kind per instance and rejects a condition object that could hold "zero or several" conditions. Behavior is unchanged: three alerts per project.
2. **`sentry_issue_alert` is deprecated** in provider 0.15.8 in favour of `sentry_alert`, which needs workflow monitor ids per project. It is kept, and TD-159 records the move.
3. **Inbound filters**: browser-extensions, localhost and web-crawlers. `legacy-browsers` is left out because it needs explicit subfilters. Portal and landing target current browsers.
4. **Project slugs carry the `mutaba3a-` prefix** (`mutaba3a-api`, …), matching the GCP naming rule. The contract's `surfaces` and the `surface` tag keep the bare names.
5. **No `SENTRY_AUTH_TOKEN` line in `release.env.example`.** That file is the desktop signing file, and `make release server` never reads it. The portal's upload token is documented as the operator shell, and MUT-149 decides whether deploy.sh reads a git-ignored file.
6. **Settings script split** into `scripts/sentry-org-policy.ts` (logic, tested) and `scripts/sentry-org-settings.ts` (CLI), following `coverage-summary-format.ts` / `coverage-summary.ts`.
7. **`denyKeyTokens` grew beyond the ADR minimum**: plurals, plus `card`, `auth`, `ip`, `payload`, `params`, `args` and `meta`. `meta` and `query` cover the Prisma `meta` and query rule as key tokens. `app.app_name` joins `safeContextKeys`, because the `name` token would otherwise drop the SDK's app context.

## Suppressed findings (appendix)

None below confidence 5.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run for MUT-147 |
| Outside Review | codex (`/plan-eng-review` outside voice) | Independent 2nd opinion | 36 | unavailable | CLI not installed; native fallback lacks TaskOutput |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 35 | ISSUES OPEN (resolved in plan) | 6 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | not applicable: no UI in MUT-147 |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not run |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable (not installed); no outside findings; no clean credit.
- **VERDICT:** Eng review complete with all 6 issues resolved into approved plan changes (R5–R8) plus 4 Scope Challenge choices (R1–R4) and 1 TODO choice built now (R9); status stays issues_open by the log's definition (issues found, all mapped to tasks). Ready to implement.

NO UNRESOLVED DECISIONS
