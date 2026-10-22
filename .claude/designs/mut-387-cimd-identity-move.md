# MUT-387 — Move the Malafat OAuth client identity (CIMD) to mtb3a.com

Tracker: Jira · barmajiyat · MUT via atlassian-barmajiyat · Backlog is plannable · finished → In Review (qa-reconcile)
Parent: MUT-25 (In Progress). Blocked by: MUT-112 (Jira says Backlog; see gate below).

## Blocker gate
MUT-112's Jira status lags. Its comments and a live check show what MUT-387 needs is already done:
- `config/hosts.json` is `domain: mtb3a.com`, `stage: live` (released web v0.1.18 / api 5119667b).
- `curl -sI https://mtb3a.com/.well-known/oauth-client.json` → **200, `content-type: application/json`, no redirect** (Netlify, checked 2026-10-22).
- `https://mtb3a.com/icons/icon-192.png` → 200 (the new `logo_uri` resolves).
MUT-112's open items (phone release, dropping the legacy link host, stage `redirect`, release note) don't affect this ticket. **Gate passes on evidence.**

## Neighbours
- MUT-112 (domain move, runs §5a), MUT-326 (ADR-155, In Review: built the hosts guard and `OWN_VALUE_FILES`), MUT-28 findings (`.claude/designs/mut-28-oauth-client-findings.md`), TD-075 (the OAuth client has no caller).
- MUT-188 kept `https://mutaba3a.app` in `bundle-origins.json` only because of this identity.
- No other open ticket touches the CIMD files. Nothing to dedupe.

## Changes (mini-crm, one branch)

| # | File | Change |
|---|---|---|
| 1 | `src/services/oauth/oauth-client.ts` | `CIMD_CLIENT_ID = 'https://mtb3a.com/.well-known/oauth-client.json'`. Doc comment: a fixed literal in code (never derived from `config/hosts.json`); serving it still depends on the apex staying bound to the Netlify site (row 8). |
| 2 | `public/.well-known/oauth-client.json` | `client_id` (byte-equal to #1), `client_uri: https://mtb3a.com`, `logo_uri: https://mtb3a.com/icons/icon-192.png`. Redirect URIs unchanged. |
| 3 | `src/services/oauth/__tests__/oauth-client.test.ts` | `CONFIG.clientId` uses the imported `CIMD_CLIENT_ID` instead of a literal (today it's a stale `…/oauth-client` without `.json`). The file then names no host → **leaves `OWN_VALUE_FILES`**. |
| 4 | `src/services/oauth/__tests__/cimd-document.test.ts` | Header comment points at `CIMD_CLIENT_ID` instead of spelling the URL → **leaves `OWN_VALUE_FILES`**. New case: `client_uri` and `logo_uri` share `CIMD_CLIENT_ID`'s origin (would have caught a half-edited document). |
| 5 | `scripts/bundle-origins.json` | `local`: replace `https://mutaba3a.app` with `https://mtb3a.com`. Redundant with `HOSTS.allOrigins` today, but needed whenever the config stops naming `mtb3a.com`: rollback row 3 of §5a sets `domain: null`, and `test:bundles` would then fail on `dist-web/.well-known/oauth-client.json` (`check-bundles.ts:39,44`). Say so in `$comment` so nobody removes it as a duplicate. |
| 6 | `scripts/__tests__/no-hardcoded-hosts.test.ts` | (a) `OWN_VALUE_FILES` shrinks to `oauth-client.json`, `oauth-client.ts` and `bundle-origins.json` (this file no longer names the domain once the rehearsal goes); comment rewritten (identity is a fixed literal on mtb3a.com, ADR-155 amendment). Own-value files keep today's whole-file domain exemption (D7: no exact-origin special case). (b) New `RETIRED_HOSTS = ['mutaba3a.app']` (subdomains included via `hostPattern`) forbidden in every scanned file, own-value files included; this file exempts itself because it holds the list. This is AC3 as a test. (c) Delete the `mutaba3a.app` rehearsal (D6: rewritten it could never fail); a comment points at `cimd-document.test.ts`'s byte-equality case as what pins the literal. |
| 7 | `scripts/__tests__/vite-config.test.ts` | New: for every stage (`legacy`, `proxy`, `live`, `redirect`), no `netlifyRedirects()` line's source matches the path of `CIMD_CLIENT_ID` on its origin, and no `netlify.toml` `[[redirects]]` rule with `force = true` matches it. Keyed on the `CIMD_CLIENT_ID` origin, not the config apex, so it still holds after a future apex move. |
| 8 | `server/DEPLOYMENT.md` §5a "What doesn't move" | Correct the claim (D5): the id is a fixed literal, but serving it is **not** config-independent. The Cloudflare zone (`main.tf:58`) and Netlify's `custom_domain`/`domain_aliases` (`main.tf:136-141`) are built from `local.domain`. So an apex change must keep `mtb3a.com` attached to the Netlify site (as an alias or a manual step) and keep its zone. The apex must stay the primary domain: with `www` as primary, Netlify 301s the apex and Malafat refuses it. The apex record must stay DNS-only (`proxied = false`, `main.tf:82`) with no Worker route or redirect rule. Rollback rows 1–2 and the planned Cloudflare-account split take the document offline until the zone is back. That only affects a sign-in nothing calls (TD-075). |
| 8b | `server/infrastructure/frontdoor/main.tf` | Host-free comments (D3, moved by D5): on `netlify_site_domain_settings.landing` (`main.tf:136`), that the apex must remain the site's primary custom domain because Malafat fetches the OAuth client document from it (`src/services/oauth/oauth-client.ts`) and refuses a 3xx; a short pointer on the zone and the apex record (DNS-only). The hosts guard scans `.tf`, so no host literals. `terraform plan` stays 0/0/0. |
| 9 | `server/README.md` | Store-review seed example `review@mutaba3a.app` → `review@mtb3a.com` (prose only; see open item O2). |
| 10 | `.claude/` knowledge | DECISIONS: **ADR-155 amendment** (identity moved to mtb3a.com as a fixed literal; `mutaba3a.app` retired and guarded). CHANGELOG entry. PATTERNS §2581 (own-value list shrinks; retired hosts are guarded too). TEST_PLAN rows for #4, #6, #7. COMPONENT_REGISTRY line 2009 unchanged (names the constant, not the value). TD-075 gets a line: identity moved, still no caller. (SYSTEM_OVERVIEW 254/410/430 and CI_CD 263 describe the landing host, not the identity: cut per D1, noted on MUT-112 instead.) |

**Malafat (crm-platform), separate small commit on its own branch, cut from `origin/main`** (local `main` is 60 commits ahead; branching from it would drag them into this change)
- `apps/web/.env.example:145` example → `https://app.mtb3a.com`.
- `apps/web/src/features/money/application/__tests__/mutaba3a-client.test.ts:37` trailing-slash fixture → a neutral `https://api.example.test///`. The test is about slash trimming, not our host.
- No code change on Malafat's side: `cimd-fetcher.ts` fetches whatever URL the client presents, and the trust check (`client-trust.ts`, MAL-224) keys on the redirect host. Loopback is always UNVERIFIED, before and after.

**Operator check (Basel, after the web release)**
- For each tenant schema (loop the way Malafat's schema tooling does), SELECT first and report counts: `SELECT id, created_at FROM <schema>.oauth_clients WHERE client_id = 'https://mutaba3a.app/.well-known/oauth-client.json';`.
- No shipped build ever presented this id (TD-075), so any row found was created by someone else presenting it. That is why the check is worth running. Delete only after reviewing the counts; the delete cascades grants, codes and tokens.

## Tests (TDD order) and commands
Red first: #6(b) fails on today's tree (`oauth-client.json`, `oauth-client.ts`, both tests and `bundle-origins.json` name `mutaba3a.app`). #4's new origin case passes today but would catch a half edit. #7 passes today (a regression guard by design, the ticket asks for it).
Then #1–#5 turn #6 green.

```bash
nvm use 22 && npx vitest run src/services/oauth scripts/__tests__/no-hardcoded-hosts.test.ts scripts/__tests__/vite-config.test.ts
npm run lint && npm run typecheck && npm run test:run && npm run build && npm run test:bundles
```
Malafat: `pnpm --filter @law-crm/web test -- src/features/money/application/__tests__/mutaba3a-client.test.ts` (package name per `apps/web/package.json:2`).

## Acceptance criteria → proof
| AC | Proof |
|---|---|
| `curl -sI https://mtb3a.com/.well-known/oauth-client.json` 200, JSON, no redirect | Already true today. Re-run after `make release web`, plus `curl -s … \| jq -r .client_id` equals the URL. #7 keeps it redirect-free. |
| `client_id` equals that URL; `cimd-document.test.ts` passes | #2 + existing byte-equality case + new origin case |
| No code/config names `mutaba3a.app` except historical prose | #6(b) `RETIRED_HOSTS` guard (prose exempt by the existing `PROSE` rule). The guard's own list names it; qa-reconcile should read that as the guard, not a violation. |
| `no-hardcoded-hosts` passes with `mtb3a.com` in `config/hosts.json` | #6 (config already says `mtb3a.com`) |

## Release / ordering
One `make release web`, no server or phone release. The new document and the new constant ship in the same Netlify deploy. Before that deploy the apex serves the old document, whose `client_id` doesn't match its URL. Nothing presents the new id before the deploy, and nothing presents any id at all (TD-075). No shipped build ever presented the old id (TD-075), so nothing in users' hands changes.
Release-QA: no user-visible flow, no new files. `release-qa lint` must stay clean; no new feature YAML. (This is a Task, not a feature, so Phase 5 does not apply.)

## Quality bar
- DRY: tests import `CIMD_CLIENT_ID` instead of re-spelling it, which removes two exemptions. One literal in code, one in the document, one in the allowlist. The test pins all three to each other.
- Testable: everything is file/pure-function checks, no network.
- Scalable / cost: static file on Netlify; zero runtime cost.
- Constraints: ADR-155 (hosts only in config) kept, with the identity as its one documented exception. No i18n strings. No API contract change.

## Open items for Basel
- **O1 (threat framing).** Moving the id doesn't stop someone registering `mutaba3a.app` and calling their client "Mutaba3a". Under MAL-224, Malafat labels every non-allowlisted CIMD client UNVERIFIED and shows its redirect host, ours included (loopback). What the move does fix: the one id we ship is on a domain we own, and old `oauth_clients` rows can't be re-pointed. That's still worth doing. Just don't expect it to change what the consent screen shows.
- **O2 (store-review account).** If production has a reviewer account at `review@mutaba3a.app`, its address is on a domain we don't own. Harmless today (no reset or email flow), but MUT-359 (Resend transactional email) would send mail to whoever registers `mutaba3a.app`. Changing the stored address is an operator step outside this ticket; worth a line on MUT-359.

## Business / product impact
- Closes a brand-and-security liability: the only OAuth identity Mutaba3a ships points at a domain anyone can register. After this it points at a domain we own.
- Part of MUT-25 (Mutaba3a ↔ Malafat). Not on the pilot gate (MUT-322). It retires the last `mutaba3a.app` reference, so the domain move can end with a guard instead of a footnote.
- Cost: one web release, ~10 small file edits, comments only in Terraform (plan 0/0/0).

---
# Eng review (plan-eng-review, 2026-10-22)

Target: this plan (MUT-387). Report file: this file.

## Scope record
feature answers: D1 = "Cut them" (SYSTEM_OVERVIEW/CI_CD landing rows leave MUT-387; note on MUT-112); structure: D2 = A "Original arrangement"; accepted scope: plan rows 1–10 minus the cut rows, plus the Malafat cleanup commit; pending remedies: none at scope time.
Scope Challenge result: scope reduced per recommendation (one doc cut).

## Scope Challenge findings
- S1 [P3] (confidence: 9/10) Malafat `apps/web/package.json:2` `"name": "@law-crm/web"` — plan named `--filter web`. Factual correction applied (no behavior change).

## 1. Architecture review
- A1 [P2] (confidence: 8/10) `server/infrastructure/frontdoor/main.tf:82` `proxied = false` (the apex record): the identity only works while the apex is DNS-only to Netlify. If someone later proxies the apex, adds a Worker route on `mtb3a.com/*` (today only `${local.portal_host}/*`, main.tf:128) or adds a Cloudflare redirect rule, a 3xx or HTML page sits in front of the document and Malafat refuses it (`cimd-fetcher.ts:171`). Plan test #7 covers Netlify rules only. → R1.
- A2 (no remedy) Threat framing O1 stays an open note for Basel: Malafat's `client-trust.ts` (MAL-224) marks every non-allowlisted CIMD client UNVERIFIED, ours included.
Dispositions: A1 → R1 pending (D3). A2 → noted, no change.

## 2. Code quality review
- Q1 [P2] (confidence: 8/10) Plan row 6(d) proposes `new URL(CIMD_CLIENT_ID).hostname` unchanged under a rehearsed config. The rehearsal swaps the config object passed to `findings()`, not the module the constant lives in, so the assertion can't fail. The fixed-literal property is already pinned by `cimd-document.test.ts` "declares a client_id byte-equal to the URL it is published at" (`expect(loadDocument().client_id).toBe(CIMD_CLIENT_ID)`) against a static JSON file: deriving the constant from `HOSTS` breaks it at the next apex move. → R2.
- Q2 [P3] (confidence: 7/10) Row 6(b) implementation note (part of approved #6, no question): exempt only the exact origin `https://mtb3a.com` followed by `/`, `"` or end of line; `app.mtb3a.com` or `www.mtb3a.com` in an own-value file must still fail. `hostPattern` (no-hardcoded-hosts.test.ts:35) matches subdomains, so strip the exact-origin occurrences before matching rather than widening the regex.
Dispositions: Q1 → R2 pending (D4). Q2 → folded into row 6 as an implementation note.

## 3. Test review
Framework: Vitest (`package.json:26` `"test:run": "vitest run"`), Node 22.
```
CODE PATHS                                              STATIC ARTIFACTS
[+] src/services/oauth/oauth-client.ts                  [+] public/.well-known/oauth-client.json
  └── CIMD_CLIENT_ID literal                              ├── [★★★ TESTED] client_id == CIMD_CLIENT_ID — cimd-document.test.ts
      ├── [★★★ TESTED] https/no port/no hash — cimd-doc   ├── [GAP→row 4] client_uri/logo_uri share the id's origin
      └── used by oauth-flow.ts:67 (no caller, TD-075)    └── [★★★ TESTED] redirect_uris == ports
[+] scripts/__tests__/no-hardcoded-hosts.test.ts        [+] Netlify redirects (vite.config.ts:285, netlify.toml)
  ├── [★★★ TESTED] legacy + domain hosts outside config   ├── [GAP→row 7] no rule at any stage moves the CIMD path
  ├── [GAP→row 6b] retired mutaba3a.app anywhere          └── netlify.toml `/*` → /index.html is a 200 rewrite, not forced: allowed
  └── (row 6b dropped per D7; whole-file exemption kept)  [+] check-bundles allowlist
                                                          └── [★★ TESTED] test:bundles fails on an unlisted origin
USER FLOWS: none (no caller; desktop retired). Live: AC1 curl after `make release web` (manual).
COVERAGE after plan: all changed paths covered; 0 E2E, 0 eval.
```
Value cards:
- row 4: protects=document's client_uri/logo_uri on the id's origin; fails_when=a half-edited doc keeps mutaba3a.app; why_new=byte-equality checks client_id only; seam=none; no_claim=URLs resolve live
- row 6(c): protects=no file names mutaba3a.app (AC3); fails_when=anyone re-adds it; why_new=current guard only forbids configured hosts; seam=none; no_claim=prose
- row 6(b): protects=own-value exemption limited to the id origin; fails_when=app.mtb3a.com hardcoded in oauth-client.ts; why_new=exemption today is whole-domain; seam=none; no_claim=none beyond protects
- row 7: protects=no 3xx in front of the CIMD path at any stage; fails_when=a redirect rule covers /.well-known; why_new=vite-config tests only check listed landing paths; seam=none; no_claim=Cloudflare-side redirects (see R1)
Tests to retire: none (row 6(d)'s mutaba3a.app rehearsal is rewritten, not retired).
Dispositions: gaps folded into rows 4, 6, 7 (approved scope). No new policy.

## 4. Performance review
No issues found. Static file on Netlify; Malafat fetches it once per authorization (scale: zero today, TD-075).

## Decision ledger
### R1: Guard the apex DNS dependency (A1)
Finding: A1, P2, 8/10, server/infrastructure/frontdoor/main.tf:82, native reviewer
Plan baseline: row 8 DEPLOYMENT.md note only
Runtime evidence: apex record `proxied = false`; Worker route only on the portal host (main.tf:128)
Question D3: Guard the apex DNS setting the identity now depends on? (A comment + doc, recommended; B doc only)
State: approved
Actual answer: A) "Comment + doc (recommended)" (D3)
Accepted scope: row 8 names main.tf's apex record; new row 8b adds a host-free comment at the apex record. No Terraform behavior change.
### R2: Rehearsal hostname assertion (Q1)
Finding: Q1, P2, 8/10, plan row 6(d), native reviewer
Plan baseline: rehearsal asserts findings empty and `new URL(CIMD_CLIENT_ID).hostname` unchanged
Runtime evidence: rehearsal swaps only the config object passed to findings(); the constant can't change in-test
Question D4: Drop the hostname assertion from the guard rehearsal? (A drop, recommended; B keep)
State: approved
Actual answer: A) "Drop it (recommended)" (D4)
Accepted scope: row 6(d) rehearses a placeholder apex, asserts no findings, comments that cimd-document byte-equality pins the literal.
History (R1): reopened by outside-voice finding 1 (verified: `main.tf:136-141` binds Netlify `custom_domain = local.domain`). D3's DNS-record comment was the wrong target. Now superseded by R3.
History (R2): reopened by outside-voice finding 3 (verified: placeholder rehearsal can never fail). Superseded by R4.
### R3: Runbook claim + comment target (outside voice 1)
Finding: OV1, High, 9/10 after verification, server/infrastructure/frontdoor/main.tf:136-141, Claude Plan subagent
Plan baseline: R1 (D3) row 8 "stays whatever the config says" + comment on the apex DNS record
Runtime evidence: zone `name = local.domain` (main.tf:58), Netlify domain settings from `local.domain` (main.tf:136-141); `www` 301s to the apex today (live curl)
Question D5: Fix the runbook claim and move the Terraform warning to the resource that binds mtb3a.com? (A Apply, recommended; B Keep; C Investigate; D Defer)
State: approved
Actual answer: A) "Apply (recommended)" (D5)
Accepted scope: row 8 corrected (serving depends on the zone, Netlify binding, apex as primary, DNS-only record); row 8b comments on netlify_site_domain_settings.landing plus pointers on the zone and apex record. Terraform plan 0/0/0.
### R4: Rehearsal case (outside voice 3)
Finding: OV3, Medium, 9/10, scripts/__tests__/no-hardcoded-hosts.test.ts:95-98, Claude Plan subagent
Plan baseline: R2 (D4) placeholder rehearsal without hostname assertion
Runtime evidence: with domain placeholder.example nothing in the repo matches; result is always []
Question D6: Delete the mutaba3a.app rehearsal instead of rewriting it? (A delete, recommended; B keep D4 rewrite; C investigate; D defer)
State: approved
Actual answer: A) "Apply: delete it (recommended)" (D6)
Accepted scope: rehearsal deleted; comment points at cimd-document byte-equality; the guard file leaves OWN_VALUE_FILES.
### R5: Exact-origin exemption 6(b) (outside voice 2, part)
Finding: OV2, High (strategic), 7/10, plan row 6(b), Claude Plan subagent
Plan baseline: own-value files checked against the domain except the exact identity origin
Runtime evidence: the protected code has no caller (`oauth-flow.ts:80` connectWorkspace is called by nothing; TD-075)
Question D7: Drop the narrow identity-origin exemption (row 6(b))? (A drop, recommended; B keep; C investigate TD-075; D defer)
State: approved
Actual answer: A) "Apply: drop 6(b) (recommended)" (D7)
Accepted scope: whole-file exemption kept for the three own-value files; RETIRED_HOSTS and the redirect test stay.

Approval readiness: PASS (D1, D2, D3→superseded by D5, D4→superseded by D6, D5, D6, D7; each cites its own answer)

## Outside voice
Codex not installed → native fallback: Claude Plan subagent, completed in about 2m46s, within the five-minute timer (timer stopped). Outside coverage: unavailable (native only).
Findings and dispositions:
1. High, apex binding is config-driven (main.tf:136-141) → verified, D5 Apply.
2. High, permanent machinery for uncalled code → partly accepted: D7 drops 6(b). Row 7 (the ticket asks for it) and 6(b)-retired-hosts (AC3) stay. TD-075 delete-vs-keep stays Basel's open call (he chose move).
3. Medium, rehearsal can't fail → verified, D6 Apply.
4. Medium, row 5 reason too narrow (rollback `domain: null`) → factual correction applied to row 5.
5. Low, Release text contradicts TD-075 → corrected (no shipped build presented the id); operator check reframed.
6. Low, AC3 vs the guard's own literal → AC row notes the guard's list is the guard, not a violation.
7. Low, operator check per schema, SELECT-first → applied.
8. Low, Malafat branch base 60 ahead → applied (branch from origin/main; verified `git rev-list --count origin/main..main` = 60). The scope-creep half is rejected: the ticket lists both Malafat files.
9. Low, test #7 low value → kept: the ticket explicitly asks for it; it doesn't cover the Terraform failure, which D5 documents instead.

## NOT in scope
- Deleting the uncalled OAuth client (TD-075): Basel chose move over delete; still TD-075's call.
- SYSTEM_OVERVIEW/CI_CD landing rows (D1): note on MUT-112.
- Changing the production store-review account's email (O2): operator step; note on MUT-359.
- Malafat trust allowlist for our client: loopback redirects can never be VERIFIED under MAL-224.

## What already exists
- `cimd-document.test.ts` byte-equality case pins the literal against the static JSON (reused as the fixed-literal guard).
- `no-hardcoded-hosts.test.ts` `hostPattern`/`findings` (reused for RETIRED_HOSTS).
- `netlifyRedirects` + its vite-config tests (extended by row 7).
- `check-bundles.ts` merges `HOSTS.allOrigins` (why row 5 is redundant today).

## Failure modes
| Path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| CIMD fetch | a redirect rule covers `/.well-known/*` | row 7 test | Malafat refuses (`redirect_not_allowed`), no caller today |
| CIMD fetch | apex unbound from Netlify after a domain change | row 8 runbook + 8b comment (no test) | 404 → `fetch_failed`; not silent to an operator following §5a |
| Build | `domain: null` rollback drops mtb3a.com from the allowlist | row 5 explicit entry | `test:bundles` stays green |
Critical gaps: 0 (the untested Terraform path is documented and has no live caller).

## Worktree parallelization strategy
Sequential implementation, no parallelization opportunity (one module in mini-crm; the Malafat edit is two lines on its own branch).

## Implementation Tasks
- [ ] **T1 (P1, human: ~30min / CC: ~5min)** — tests — Red: add RETIRED_HOSTS, shrink OWN_VALUE_FILES, delete the rehearsal, add the cimd origin case and the redirect test
  - Surfaced by: Test review gaps rows 4/6/7; D6, D7
  - Files: scripts/__tests__/no-hardcoded-hosts.test.ts, src/services/oauth/__tests__/cimd-document.test.ts, scripts/__tests__/vite-config.test.ts
  - Verify: `npx vitest run scripts/__tests__ src/services/oauth` red on the retired-host case only
- [ ] **T2 (P1, human: ~20min / CC: ~3min)** — oauth — Green: move the literal, the document and the allowlist entry
  - Surfaced by: plan rows 1–3, 5; OV4
  - Files: src/services/oauth/oauth-client.ts, public/.well-known/oauth-client.json, src/services/oauth/__tests__/oauth-client.test.ts, scripts/bundle-origins.json
  - Verify: full gate under Node 22 + `npm run test:bundles`
- [ ] **T3 (P2, human: ~30min / CC: ~5min)** — docs/infra — Correct DEPLOYMENT §5a, comment main.tf, README, ADR-155 amendment, knowledge files
  - Surfaced by: A1, OV1 (D5)
  - Files: server/DEPLOYMENT.md, server/infrastructure/frontdoor/main.tf, server/README.md, .claude/{DECISIONS,CHANGELOG,PATTERNS,TEST_PLAN,TECH_DEBT}.md
  - Verify: `terraform -chdir=server/infrastructure/frontdoor fmt -check`; no-hardcoded-hosts green
- [ ] **T4 (P2, human: ~10min / CC: ~2min)** — Malafat — Neutral fixture + env example on a branch from origin/main
  - Surfaced by: ticket scope; OV8
  - Files: apps/web/.env.example, apps/web/src/features/money/application/__tests__/mutaba3a-client.test.ts
  - Verify: `pnpm --filter @law-crm/web test -- src/features/money/application/__tests__/mutaba3a-client.test.ts`
- [ ] **T5 (P3, Basel)** — release + operator — `make release web`, AC1 curl + jq, per-schema SELECT-first check
  - Surfaced by: AC1; OV5/OV7
  - Verify: `curl -s https://mtb3a.com/.well-known/oauth-client.json | jq -r .client_id` equals the URL

## Completion summary
- Step 0: Scope Challenge — scope reduced per recommendation (D1)
- Reality rows: 7/7 tier-1 rows emitted, 0 unverified premises
- Architecture Review: 1 issue found (A1)
- Code Quality Review: 2 issues found (Q1, Q2)
- Test Review: diagram produced, 3 gaps identified (folded into rows 4, 6, 7)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed (follow-ups go to Jira: MUT-112 note, MUT-359 note)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex unavailable (not installed); native Claude Plan subagent completed, 9 findings, 3 decisions (D5–D7)
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 6/7 answers picked the 10/10 or highest-scored recommended option (D7 picked 8/10 over 9/10 by design)

REALITY: premise-table pass blocker evidence live curl 200 + config/hosts.json:6 stage live
REALITY: already-done pass 0 commits mention MUT-387; CIMD files untouched since 2026-10-21 (git log)
REALITY: surface-check finding Malafat filter name corrected (apps/web/package.json:2); test:bundles exists (package.json:31)
REALITY: binding-decisions pass Basel chose move over register (MUT-112 comment 12325); ADR-155 amended, not contradicted
REALITY: numbers pass 60 commits ahead measured (git rev-list); file counts estimated
REALITY: deferred-asks pass every ticket scope item planned; SYSTEM_OVERVIEW rows were never asked for
REALITY: pr-count pass one mini-crm branch + one Malafat branch (two repos, unavoidable)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | native Claude Plan subagent (codex not installed) | Independent 2nd opinion | 1 | unavailable (native completed) | 9 findings, 3 decisions |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN (all resolved into the plan) | 6 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review, unavailable (not installed); native Claude Plan subagent completed within five minutes, 9 findings, no outside credit.
- **VERDICT:** no review CLEAR; eng review findings are all resolved into the plan (issues_open = mapped work). Ready to implement with /eng-build.

NO UNRESOLVED DECISIONS
