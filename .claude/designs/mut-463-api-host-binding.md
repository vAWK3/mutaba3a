# MUT-463: the API binds to a chosen host (HOST)

Status: planned + eng-reviewed 2026-10-27 (review record below; decisions D1-D6 answered by Basel). Jira MUT-463 (Task,
no epic). Blocks MAL-1407 (Malafat's harness). Found in the MAL-1400 code review.

## Problem

`server/src/index.ts:223` calls `serve({ fetch: app.fetch, port: config.PORT })` with no hostname, so the API listens on
every interface. In Cloud Run that is required. The local QA copies run with a committed admin token
(`qa-portal-live-admin-token-…`, `qa-portal-selfservice-admin-token-…`), so while they run, anyone on the same Wi-Fi can
call their `/admin/v1/*`. `selfservice-live.mjs:32` already says "the API runs on loopback"; today that is not true.
The same holds for a dev server started from a copy of `server/.env.example`, whose placeholder admin token
(`.env.example:19`) passes `min(32)`.

## Acceptance criteria (from the ticket)

1. With `HOST=127.0.0.1`, the API answers on 127.0.0.1 and refuses connections on the machine's LAN address.
2. Unset, nothing changes: the container and Cloud Run still listen on all interfaces.
3. Config validation rejects an empty or invalid `HOST`.

## Decisions

- **P1. `HOST` takes an IP address only** (`net.isIP(value) !== 0`): `127.0.0.1`, `::1`, `0.0.0.0`, `::`. A name such
  as `localhost` or `my-mac.local` is refused. Node binds a name to the *first* address it resolves to; on macOS
  `localhost` resolves to `::1` first [measured], so `HOST=localhost` would quietly break every client that dials
  `127.0.0.1` (the Stripe CLI forward in `billing-live.mjs`, the portal's `API_ORIGIN`). A machine name binds to the LAN
  address, the opposite of what HOST is for. Message: `HOST: must be an IP address, such as 127.0.0.1`. This is what
  "invalid" means for AC3. The name stays `HOST` (ticket and MAL-1407 use it; review OV-5).
- **P2. Unset means "don't pass a hostname"**, not "pass `0.0.0.0`". Node's default is `::` dual-stack, which is what
  Cloud Run gets today; `0.0.0.0` would drop IPv6. AC2 is kept by omission (`exactOptionalPropertyTypes` is on, so the
  key is left out rather than set to `undefined`).
- **P3. The harnesses keep their `localhost` origins.** `selfservice-live` needs `localhost`: it is the WebAuthn RP ID
  (`127.0.0.1` cannot be one) and the cookie host. Node 22's fetch falls back from `::1` to `127.0.0.1` [measured: 200],
  so the release-QA readiness probe still connects; Chromium is proved by running a passkey spec.
- **P4. New dev setups default to loopback** (review D4, reverses the original D4): `server/.env.example` ships
  `HOST=127.0.0.1` uncommented, with a one-line note: delete it to reach the dev API from a real phone on the LAN.
  Existing `server/.env` files are untouched; the iOS simulator and Android emulator reach the host's loopback anyway.
  The harnesses set HOST in the process env, which beats `--env-file`.
- **P5. One start path** (review D3): `server/src/listen.ts` exports `startServer(fetch, config, onListening)`, the only
  caller of `serve`. index.ts and the socket test both use it, so the test covers the production line.

## Where the code goes

| File | Change |
|---|---|
| `server/src/config.ts` | `HOST: z.string().refine((v) => isIP(v) !== 0, 'must be an IP address, such as 127.0.0.1').optional()` next to `PORT`; `import { isIP } from 'node:net'`; a one-line comment on P1/P2. |
| `server/src/listen.ts` (new) | `startServer(fetch, config: Pick<Config, 'PORT' \| 'HOST'>, onListening)`: `serve({ fetch, port: config.PORT, ...(config.HOST ? { hostname: config.HOST } : {}) }, onListening)`; returns the server. |
| `server/src/index.ts` | `const server = startServer(app.fetch, config, (info) => …)`; the listening log adds `address: info.address`. `stopAccepting: () => server.close()` (index.ts:268) unchanged. |
| `qa/support/selfservice-live.mjs` | `HOST: '127.0.0.1'` in the API's env; the "runs on loopback" comment becomes true. |
| `qa/support/billing-live.mjs` | `HOST: '127.0.0.1'` in the API's env (its origins are already `127.0.0.1`). |
| `server/.env.example` | `HOST=127.0.0.1` under `PORT`, with the P4 opt-out note. |

No route, OpenAPI, migration, portal, i18n or Terraform change (Cloud Run and the CI container smoke test set no HOST;
nothing else reads `process.env.HOST`). No version bump: the API contract is unchanged. `release-qa lint` must report
`server/src/listen.ts` mapped or acceptably unmapped like its server neighbours; check during the build.

## Tests (written first)

`server/src/__tests__/config.test.ts`, new `describe('loadConfig — HOST (MUT-463)')`:
- unset → `config.HOST` undefined.
- `127.0.0.1`, `::1`, `0.0.0.0`, `::` → accepted unchanged.
- `''`, `localhost`, `my-mac.local`, `256.1.1.1`, `127.0.0.1:8787`, `[::1]` → `ConfigError` naming `HOST` (AC3, P1).

`server/src/__tests__/listen.test.ts` (new; real sockets through `startServer`, port 0 so no free-port race):
- `HOST=127.0.0.1`: a request to `127.0.0.1` answers 200 (always runs); a TCP connect to the first non-internal IPv4 from
  `os.networkInterfaces()` gets `ECONNREFUSED` (only this assertion is skipped when there is no non-internal IPv4, with
  the reason in the test name). AC1. The server under test is loopback-bound, so no firewall prompt.
- `HOST` unset: `server.address().address` equals the address a bare `net.createServer().listen(0)` binds (`::` on a
  dual-stack machine), so a default of `0.0.0.0` or any other address fails. No LAN connect (review D5). AC2.

Commands: `npm --prefix server test -- config listen` while iterating, then the server CI set through the heavy queue
under Node 22: `npm --prefix server run typecheck`, `npm --prefix server run lint`, `npm --prefix server run openapi:check`,
`npm --prefix server test`. `node --check qa/support/billing-live.mjs qa/support/selfservice-live.mjs`.

## Release-QA

No user-visible flow. Proof for P3 and AC1 in a real env: `release-qa run --attach --only` one passkey spec on
`portal-selfservice`, and while that env is up: `curl http://127.0.0.1:8791/health` answers, `curl http://<LAN ip>:8791/health`
is refused, `lsof -iTCP:8791 -sTCP:LISTEN` shows `127.0.0.1`. No portal-live run (review D6): billing-live already uses
127.0.0.1 throughout; its one-line change is checked by reading and `node --check`.

## Knowledge files

CHANGELOG (what/why/files); DECISIONS: a short ADR (next free number) for P1, P2 and P4; TEST_PLAN: the two test files;
INFRA: local QA APIs and new dev setups bind loopback via `HOST`. No component, pattern or tech-debt change.

## Out of scope / follow-ups

- Malafat's `qa/mutaba3a.sh` (:8795): MAL-1407 (Idea), "is blocked by" MUT-463. Its AC checks the LAN address is refused,
  which also catches a mini-crm checkout older than this change (where HOST is silently ignored, OV-6).
- Dev APIs already running from an existing `server/.env` keep listening on all interfaces until their owner adds HOST.
- DNS rebinding against loopback QA APIs (see suppressed findings): out of scope.

## Risks

- A shell that exports `HOST` as a machine name would make every `loadConfig` caller (the API, `reconcile.ts`) refuse to
  boot with the P1 message. Intended: loud, names the variable, one-line fix. Not the case on this Mac [measured].
- Chromium's `localhost` fallback (P3) is proved only by the passkey spec run.

---

# Eng review (/plan-eng-review, 2026-10-27)

Target: this plan, `.claude/designs/mut-463-api-host-binding.md` (named in the invocation). Report file: this file.
The gstack design doc lookup returned `basel-main-design-20261026-111558.md`, an unrelated feature; not used.

## Scope Challenge

- **What already exists:** `loadConfig(env)` + `ConfigError` (config.ts:213) is the validation seam; zod `.refine` is
  the house idiom (config.ts `isHttpsOrLocalHttp`); `@hono/node-server` 2.1.4 `serve` already takes `hostname?: string`
  (dist/index.d.mts); `node:net` `isIP` covers validation. Nothing to build beyond one field, one helper, one call site.
- **Minimum change:** config field + `listenOptionsOf` + index.ts call + two harness env lines + `.env.example`. Nothing deferrable.
- **Complexity:** 7 code/test files (config.ts, index.ts, 2 harnesses, .env.example, config.test.ts, new listen.test.ts),
  0 new classes/services; knowledge files excluded as docs. Under the 8/2 gate: complexity questions skipped.
- **Search check:** no new pattern or infrastructure. Search skipped (no Aside/WebSearch needed).
- **TODOS.md:** no entry on host binding (grep host/bind/loopback/0.0.0.0: none relevant).
- **Distribution:** no new artifact.

Reality rows:
- premise-table: `serve` has no hostname (index.ts:223) TRUE; ports 8791/8790 (selfservice-live.mjs:23, billing-live.mjs:24) TRUE; hono `hostname?` (node-server dist/index.d.mts) TRUE; Dockerfile sets no HOST (Dockerfile:25,34) TRUE; Node 22 fetch localhost→127.0.0.1 fallback [measured: probe, 200] TRUE; `isIP` verdicts for all 10 listed values [measured: probe] TRUE; Cloud Run injects no HOST (Google docs, not probed) UNVERIFIED; Chromium happy-eyeballs to 127.0.0.1 UNVERIFIED (build proves it via a passkey spec). unverified=2.
- already-done: no commit since 2026-10-26 touches binding; `git log --all --grep MUT-463` empty; index.ts:223 unchanged.
- surface-check: `npm --prefix server run typecheck|lint|openapi:check`, `npm --prefix server test` (server/package.json:15-29); `release-qa run --attach --only` (release-qa.mjs:28,61). All exist.
- binding-decisions: decision search has no host/bind entry; no ADR on listen address. Plan D1-D4 are new.
- numbers: only ports, read from source [measured: files]. No effort or perf numbers.
- deferred-asks: ticket Scope bullet 4 (Malafat `qa/mutaba3a.sh` sets HOST) is left out with no tracking ticket. Finding 1.
- pr-count: no `.gstack/ship-policy.json`; one local commit/merge (repo forbids push and PRs).

REALITY: premise-table pass 8 premises, unverified=2 server/src/index.ts:223
REALITY: already-done pass no prior binding work server/src/index.ts:223
REALITY: surface-check pass all named commands exist server/package.json:15
REALITY: binding-decisions pass none on listen address server/src/index.ts:223
REALITY: numbers pass ports only, measured qa/support/selfservice-live.mjs:23
REALITY: deferred-asks finding Malafat half untracked .claude/designs/mut-463-api-host-binding.md:87
REALITY: pr-count pass one local merge, no PR CLAUDE.md:1

Findings:
1. [INFORMATIONAL] (confidence: 8/10) plan "Out of scope" (Malafat `qa/mutaba3a.sh` line) — the ticket's Scope bullet
   "Malafat's `qa/mutaba3a.sh` adds `HOST=127.0.0.1` once this ships" has no ticket. MAL-1400 is In Review, so nothing
   carries the change and :8795 stays on all interfaces after this lands. Reviewer: Claude (native).

## Decision ledger

### R1: How the Malafat half gets tracked
Finding: 1, INFORMATIONAL, 8/10, plan Out-of-scope section, reviewer Claude
Plan baseline: original proposal: "File it (or add it to MAL-1400, In Review) when this lands." Undecided which.
Runtime evidence: JQL `project = MAL AND text ~ "MUT-463"` returns nothing; MAL-1400 status In Review.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1 Malafat tracking | unspecified | new MAL Task now, "is blocked by" MUT-463 | comment on MAL-1400 now | nothing now; decide at merge |
| D1-D4, tests | proposed, unchanged | unchanged | unchanged | unchanged |
Question D1:
D1 — Track the Malafat half of MUT-463 now?
Project/branch/task: mini-crm main, planning MUT-463 (API listens on a chosen HOST).
ELI10: The ticket has two halves. This repo adds the HOST setting; Malafat's QA script then has to set HOST=127.0.0.1 for its own Mutaba3a copy on port 8795. Nothing tracks that second half, and MAL-1400 is already In Review, so after this ships Malafat's copy would still be reachable from the Wi-Fi with its committed admin token.
Stakes if we pick wrong: the :8795 exposure that started this ticket stays open with nobody owning it.
Recommendation: A because a blocked MAL ticket shows up in Malafat's backlog the moment MUT-463 lands, while a comment on an In Review ticket gets lost when it closes.
Completeness: A=10/10, B=7/10, C=4/10
Pros / cons:
A) New MAL ticket, blocked by MUT-463 (recommended)
  ✅ Malafat's backlog gets a real item with an owner, unblocked automatically when this merges
  ✅ MAL-1400 can close on its own scope without dragging a cross-repo follow-up along
  ❌ One more small ticket on the board (human: ~5 min / CC: ~1 min to file and link)
B) Comment on MAL-1400
  ✅ No new ticket; the context stays next to the review that found the problem
  ✅ Whoever is reviewing MAL-1400 right now sees it before that ticket closes
  ❌ MAL-1400 is In Review; once it closes, the comment is easy to miss and nothing reminds anyone
C) Decide at merge time
  ✅ Nothing to do today; the build session can file it with the commit hash in hand
  ✅ The follow-up can name the exact merged config message and env line to copy
  ❌ Relies on someone remembering at merge; that is how the half went untracked in the first place
Net: two minutes of ticket hygiene now against the original exposure surviving the fix.
Header: Malafat half
Options:
A) New MAL ticket (recommended)
File a MAL Task now for qa/mutaba3a.sh to set HOST=127.0.0.1, linked "is blocked by" MUT-463. Plan D1-D4 and tests unchanged.
B) Comment on MAL-1400
Add a comment to MAL-1400 (In Review) naming the follow-up. No new ticket. Plan D1-D4 and tests unchanged.
C) Decide at merge
Leave it to the build session to file at merge time. Plan D1-D4 and tests unchanged.

State: approved
Actual answer: A) New MAL ticket (Basel, D1, 2026-10-27)
Accepted scope: file a MAL Task now for qa/mutaba3a.sh to set HOST=127.0.0.1, linked "is blocked by" MUT-463; plan D1-D4 and tests unchanged.
History: none

Scope Challenge result: scope accepted as-is. Dispositions: Finding 1 accepted (D1 A): MAL-1407 filed (Idea), "is blocked by" MUT-463, link read back.

## 1. Architecture review

```
env HOST ──> loadConfig (zod: isIP ≠ 0, else ConfigError "HOST: must be an IP address…")
                │
                ▼
        listenOptionsOf(config) ── HOST set ──> { port, hostname: HOST } ──> serve() binds HOST only
                │
                └──────────── unset ─────────> { port }  ───────────────> serve() binds Node default (:: dual-stack)
```

Probes on this Mac [measured]: a server bound to 127.0.0.1 refuses a connect to the LAN IPv4 (ECONNREFUSED); a server
on Node's default (`::`) accepts it; Node 22 `fetch('http://localhost:<port>')` reaches a 127.0.0.1-only server (200).
So the release-QA readiness probe (Node) survives D3; Chromium is still proved only by the build's passkey spec run.

Failure mode per new path: a harness that forgets HOST keeps today's exposure (visible in `lsof`, covered by the manual
check); a bad HOST fails boot loudly with the variable named (config tests). No silent failure.

No issues found.

## 2. Code quality review

`listenOptionsOf` sits beside `loadConfig` (config.ts), the one place that reads env; index.ts keeps no logic. Edge
values (`' 127.0.0.1'`, `[::1]`, `host:port`) are all rejected by `isIP` [measured]. No issues found.

## 3. Test review

Framework: Vitest (`server/vitest.config.ts`, `npm --prefix server test`).

```
CODE PATHS                                              USER FLOWS (operator)
[+] server/src/config.ts  HOST                          [+] QA env up (selfservice / billing)
  ├── unset → undefined           [GAP→planned ★★★]       ├── [GAP→planned] API on 127.0.0.1, LAN refused (manual + spec run)
  ├── IP literal → accepted       [GAP→planned ★★★]       └── [GAP→planned] [→E2E] passkey spec via localhost origin
  └── empty / name / bad → error  [GAP→planned ★★★]     [+] Cloud Run boot, HOST unset
[+] listenOptionsOf                                       └── [GAP→planned] binds Node default (see R2)
  ├── HOST set → hostname         [GAP→planned]
  └── unset → no hostname         [GAP→planned, see R2]
[+] index.ts serve(...)           covered through listenOptionsOf + socket test

COVERAGE (planned): 7/7 paths have a planned test | existing tests: 0/7 (new behaviour)
```

Correction (necessary proof of AC1, no question): in `listen.test.ts` only the LAN-refused assertion may skip when the
machine has no non-internal IPv4; "answers on 127.0.0.1" always runs.

Findings:
2. [INFORMATIONAL] (confidence: 7/10) plan Tests section, "unset → `listenOptionsOf(config)` has no `hostname` key" —
   this asserts the helper's shape. The regression it is meant to stop (someone defaulting HOST to `0.0.0.0`, which
   drops IPv6 on Cloud Run) is not caught by the planned LAN-connect socket test either, because `0.0.0.0` still
   accepts IPv4 LAN connects. Reviewer: Claude (native).

### R2: How AC2 (unset = today's binding) is proved
Finding: 2, INFORMATIONAL, 7/10, plan Tests section, reviewer Claude
Plan baseline: original proposal: shape assertion (no `hostname` key) + socket test "unset → LAN connect succeeds".
Runtime evidence: Node default bind on this Mac is `::` [measured]; LAN connect succeeds on `::` and would also succeed on `0.0.0.0`.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R2 AC2 proof | shape assertion + LAN connect | socket test: unset HOST binds the same address as a bare `net` server's default (`::` here), plus LAN connect; shape assertion dropped | keep plan as written |
| R1 | approved (D1 A) | unchanged | unchanged |
| AC1/AC3 tests, D1-D4 | proposed | unchanged | unchanged |
Question D2:
D2 — Prove "unset HOST changes nothing" by the bound address instead of the helper's shape?
Project/branch/task: mini-crm main, planning MUT-463 (API listens on a chosen HOST).
ELI10: When HOST is not set, the API must listen exactly where it does today, on every address, IPv4 and IPv6. The plan checks that the helper leaves out the hostname and that a LAN connection works. Neither notices if someone later "fixes" the default to 0.0.0.0, which quietly turns off IPv6 in Cloud Run. Checking the address the socket actually bound to, against Node's own default, catches that.
Stakes if we pick wrong: a future default to 0.0.0.0 passes CI and production silently loses IPv6 listening.
Recommendation: A because it tests the real socket, catches the 0.0.0.0 regression, and stays correct on machines without IPv6 by comparing with Node's own default.
Completeness: A=10/10, B=7/10
Pros / cons:
A) Assert bound address (recommended)
  ✅ Fails if the default ever changes to 0.0.0.0 or anything else, which is the regression that matters for Cloud Run
  ✅ Survives refactors of listenOptionsOf because it checks the socket, not the object shape
  ❌ One extra socket in the test file (human: ~15 min / CC: ~2 min)
B) Keep plan as written
  ✅ Already written into the plan; no change to the test list at all
  ✅ The shape assertion is quick to read and needs no network
  ❌ Misses the 0.0.0.0 regression and breaks on a harmless refactor of the helper
Net: one socket assertion buys the only guard on Cloud Run's IPv6 default.
Header: AC2 proof
Options:
A) Assert bound address (recommended)
In listen.test.ts, with HOST unset, assert server.address().address equals a bare net server's default address, and keep the LAN connect check; drop the shape assertion. Other tests and D1-D4 unchanged.
B) Keep plan as written
Keep the shape assertion (no hostname key) and the LAN connect check. Other tests and D1-D4 unchanged.

State: approved
Actual answer: A) Assert bound address (Basel, D2, 2026-10-27)
Accepted scope: in listen.test.ts, with HOST unset, assert server.address().address equals a bare net server's default address and keep the LAN connect check; drop the shape assertion. Other tests and D1-D4 unchanged.
History: none

Dispositions (sections 1-3): Finding 2 accepted (D2 A); plan Tests section amended; free-port note corrected (PORT=0 can't pass loadConfig, config.ts:30).

## 4. Performance review

Boot-time only: one `isIP` call and one listen. No per-request path. No issues found.

## Outside voice (native fallback)

Codex CLI not installed (`CODEX_MODE: not_installed`); a Plan subagent ran the challenge and completed in 198 s, within the
5-minute limit. Its report: 0 Critical, 0 High, 3 Medium, 5 Low. Summary by number (OV-n):

- OV-1 Medium: tests never exercise index.ts:223; `listen.test.ts` calls `serve` itself, so dropping the spread in
  index.ts passes CI. Fix: one exported start function used by both.
- OV-2 Medium: D4 leaves the dev server on all interfaces while `server/.env.example:19` commits a 32+ char placeholder
  admin token that passes `min(32)` [verified]. Fix: ship `HOST=127.0.0.1` uncommented in `.env.example`.
- OV-3 Medium: the unset-HOST socket test is the suite's first wildcard bind; with the macOS application firewall on
  [verified: `socketfilterfw --getglobalstate` = enabled] or in a sandbox, binding `::` and dialing the LAN IP can prompt
  or fail. The LAN connect adds nothing over D2's address check.
- OV-4 Low: free-port-then-rebind is racy; override `port: 0` after the spread and read `server.address().port`.
- OV-5 Low: an exported `HOST` (machine name) would also break non-listening `loadConfig` callers
  (`server/src/scripts/reconcile.ts:44`); consider `LISTEN_HOST`.
- OV-6 Low: on a mini-crm checkout older than this change, `HOST` is silently dropped by `z.object`; MAL-1407 must check
  the bound address, not assume.
- OV-7 Low: the `portal-live` spec run proves nothing about D3 (billing-live is already all-127.0.0.1) and needs the
  Stripe key; keep only the selfservice passkey run plus curl/lsof.
- OV-8 Low: an ADR is more ceremony than one optional field needs.

Resolved without a question:
- OV-4: correction (same behaviour, less racy): the test passes a port of 0 to the start function directly instead of
  a closed free port. Folded into R3's accepted scope if R3 is applied.
- OV-5: rejected. The ticket names `HOST`, and Basel's D1 answer filed MAL-1407 with `HOST=127.0.0.1`; renaming would
  contradict that approved text. No shell here exports HOST [measured: printenv empty]; the failure is loud.
- OV-6: already covered: MAL-1407's first AC requires `curl <LAN ip>:8795/health` to be refused, which fails on a stale
  checkout.
- OV-8: rejected. CLAUDE.md requires a DECISIONS.md entry for each new decision; the ADR stays a few lines.

### R3: One start function for index.ts and the test (OV-1)
Finding: OV-1, Medium, 9/10, server/src/index.ts:223 `const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {`, reviewer Claude subagent
Plan baseline: `listenOptionsOf(config)` exported from config.ts; index.ts spreads it; listen.test.ts calls `serve` directly.
Runtime evidence: index.ts has top-level side effects (Prisma connect, timers) and cannot be imported in a test.
Comparison grid:
| Choice | Current | A | B | C | D |
|---|---|---|---|---|---|
| R3 start path | test calls `serve` itself | new `server/src/listen.ts` `startServer(fetch, config, onListening)` used by index.ts and the test; `listenOptionsOf` internal to it | keep | investigate | defer |
| R1, R2, D1-D4 | approved / proposed | unchanged | unchanged | unchanged | unchanged |
Question D3: see the AskUserQuestion payload "D3 — Start the server through one shared function?" (same text).
Header: Start path
Options:
A) Apply this change (recommended)
Add server/src/listen.ts with startServer(fetch, config, onListening) wrapping serve + hostname; index.ts and listen.test.ts both call it; the test passes port 0 (OV-4).
B) Keep current value
Test calls serve with listenOptionsOf directly; index.ts line covered only by the manual lsof check.
C) Investigate before choosing
Time-boxed (10 min) look at importing index.ts behind a flag; no change approved.
D) Defer this change only
Leave R3 open as an unresolved decision; build proceeds with B's shape.

State: approved
Actual answer: A) Apply this change (Basel, D3, 2026-10-27)
Accepted scope: server/src/listen.ts startServer(fetch, config, onListening) wraps serve + hostname; index.ts and listen.test.ts both call it; the test passes port 0 (OV-4).
History: none

### R4: Dev server default (OV-2, reopens plan D4)
Finding: OV-2, Medium, 8/10, server/.env.example:19 `MUTABA3A_ADMIN_TOKEN=replace-with-32-plus-ryandom-characters-from-secret-manager`, reviewer Claude subagent
Plan baseline: D4 (proposed): `.env.example` documents `# HOST=127.0.0.1` commented out; dev listens on all interfaces.
Runtime evidence: the placeholder is 61 chars, passes `min(32)` (config.ts:32). Existing `server/.env` files are not touched by either option.
Comparison grid:
| Choice | Current | A | B | C | D |
|---|---|---|---|---|---|
| R4 dev default | `# HOST=127.0.0.1` commented | `HOST=127.0.0.1` uncommented in `.env.example`, comment says delete it to reach the API from a phone on the LAN | keep D4 | investigate | defer |
| R1-R3, D1-D3 | as recorded | unchanged | unchanged | unchanged | unchanged |
Question D4: see the AskUserQuestion payload "D4 — New dev setups listen on 127.0.0.1 by default?" (same text).
Header: Dev default
Options:
A) Apply this change (recommended)
Ship HOST=127.0.0.1 uncommented in server/.env.example with a one-line opt-out note. Existing .env files unchanged.
B) Keep current value
Keep D4: HOST commented out in .env.example; dev listens on all interfaces.
C) Investigate before choosing
Ask whether anyone tests a real phone against a dev API on the LAN; no change approved.
D) Defer this change only
Leave R4 open; build uses D4 as written.

State: approved
Actual answer: A) Apply this change (Basel, D4, 2026-10-27)
Accepted scope: server/.env.example ships HOST=127.0.0.1 uncommented with a one-line opt-out note; existing .env files unchanged. Supersedes plan D4 (now P4).
History: none

### R5: LAN connect in the unset-HOST test (OV-3, reopens part of D2's test)
Finding: OV-3, Medium, 7/10, server/src/scripts/__tests__/cmek-cutover.test.ts:110 `await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));` (every existing socket test binds loopback), reviewer Claude subagent
Plan baseline: D2 A (approved): unset-HOST test asserts the bound address equals Node's default AND keeps the LAN connect.
Runtime evidence: application firewall enabled on this Mac [measured]; the address check alone catches the 0.0.0.0 regression D2 targets.
Comparison grid:
| Choice | Current | A | B | C | D |
|---|---|---|---|---|---|
| R5 unset-HOST LAN connect | kept (D2 A) | dropped; address check stays | keep | investigate | defer |
| D2 address check | approved | unchanged | unchanged | unchanged | unchanged |
Question D5: see the AskUserQuestion payload "D5 — Drop the LAN connect from the unset-HOST test?" (same text).
Header: LAN check
Options:
A) Apply this change (recommended)
Drop the LAN connect from the unset-HOST test; keep the bound-address check (D2). AC1's LAN-refused check stays (it dials a loopback-bound server).
B) Keep current value
Keep both the address check and the LAN connect, as D2 A approved.
C) Investigate before choosing
Run the probe under the heavy gate to see whether the firewall prompts; no change approved.
D) Defer this change only
Leave R5 open; build keeps D2 A as approved.

State: approved
Actual answer: A) Apply this change (Basel, D5, 2026-10-27)
Accepted scope: drop the LAN connect from the unset-HOST test; keep the bound-address check (D2); AC1 LAN-refused check stays.
History: D2 A approved the LAN connect alongside the address check (2026-10-27); reopened for OV-3's firewall evidence.

### R6: portal-live spec run (OV-7)
Finding: OV-7, Low, 8/10, qa/support/billing-live.mjs:27 `const API_ORIGIN = \`http://127.0.0.1:${API_PORT}\`;`, reviewer Claude subagent
Plan baseline: Release-QA section: run one passkey spec on portal-selfservice AND one spec on portal-live.
Runtime evidence: billing-live's API, portal and Stripe forward all use 127.0.0.1 already.
Comparison grid:
| Choice | Current | A | B | C | D |
|---|---|---|---|---|---|
| R6 portal-live run | planned | dropped; billing-live's one-line change verified by reading plus `node --check` | keep | investigate | defer |
| selfservice passkey run, curl/lsof | planned | unchanged | unchanged | unchanged | unchanged |
Question D6: see the AskUserQuestion payload "D6 — Skip the portal-live spec run?" (same text).
Header: portal-live run
Options:
A) Apply this change (recommended)
Drop the portal-live run. Keep the portal-selfservice passkey spec plus curl and lsof checks.
B) Keep current value
Also run one portal-live spec (Stripe sandbox key, stripe CLI, a heavy-queue slot).
C) Investigate before choosing
Check whether the Stripe key is in the Keychain first; no change approved.
D) Defer this change only
Leave R6 open; the build session decides.

State: approved
Actual answer: A) Apply this change (Basel, D6, 2026-10-27)
Accepted scope: drop the portal-live run; keep the portal-selfservice passkey spec plus curl and lsof checks; billing-live checked by reading and node --check.
History: none

Outside-voice dispositions: OV-1 accepted (D3 A), OV-2 accepted (D4 A), OV-3 accepted (D5 A), OV-4 folded into R3,
OV-5 rejected (binding D1 text), OV-6 covered by MAL-1407's AC, OV-7 accepted (D6 A), OV-8 rejected (CLAUDE.md rule).
Plan body rewritten to the approved values (P1-P5; D1-D4 of the original plan renamed P1-P4, P4 reversed by review D4).

Approval readiness: PASS — R1 (D1 A), R2 (D2 A), R3 (D3 A), R4 (D4 A), R5 (D5 A), R6 (D6 A); all answers from Basel in this session, 2026-10-27.

## NOT in scope

- Malafat's harness: MAL-1407, blocked by MUT-463.
- Existing `server/.env` files: untouched; their owners add HOST if they want loopback.
- Host-header checks against DNS rebinding of loopback QA APIs: low risk (tokens are in a private repo), separate work if wanted.
- Renaming to `LISTEN_HOST`: rejected (OV-5).

## What already exists

- `loadConfig(env)` + `ConfigError` (config.ts:213) and zod `.refine` (config.ts `isHttpsOrLocalHttp`): reused for validation.
- `@hono/node-server` 2.1.4 `serve({ hostname })`: reused; no new dependency.
- `node:net` `isIP`: standard library.
- Loopback socket test pattern: `cmek-cutover.test.ts:110`.
- New: `server/src/listen.ts` (one function, review D3), because index.ts can't be imported in a test.

## Failure modes

| Path | Realistic failure | Covered by | User-visible |
|---|---|---|---|
| HOST set, valid | index.ts stops passing HOST | listen.test.ts via startServer (D3) | n/a (CI fails) |
| HOST set, invalid | typo `127.0.0.1:8791` | config.test.ts table | boot refuses, names HOST |
| HOST unset | default changed to 0.0.0.0 | listen.test.ts bound-address check (D2) | n/a (CI fails) |
| QA env | Chromium can't reach 127.0.0.1 via localhost | passkey spec run | spec fails loudly |
| Malafat env | stale mini-crm ignores HOST | MAL-1407 AC (LAN refused) | QA check fails |

Critical gaps: 0.

## Worktree parallelization strategy

Sequential implementation, no parallelization opportunity (one module, about 8 files).

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~1h / CC: ~10min)** — server — Add `startServer` in `server/src/listen.ts` and call it from index.ts
  - Surfaced by: Outside voice OV-1 (D3 A)
  - Files: server/src/listen.ts, server/src/index.ts, server/src/__tests__/listen.test.ts
  - Verify: `npm --prefix server test -- listen`
- [ ] **T2 (P1, human: ~30min / CC: ~5min)** — server tests — AC2 proved by bound address, no LAN connect, port 0
  - Surfaced by: Test review finding 2 (D2 A), OV-3 (D5 A), OV-4
  - Files: server/src/__tests__/listen.test.ts
  - Verify: `npm --prefix server test -- listen`
- [ ] **T3 (P1, human: ~10min / CC: ~2min)** — config — `HOST=127.0.0.1` uncommented in `.env.example` with opt-out note
  - Surfaced by: OV-2 (D4 A)
  - Files: server/.env.example
  - Verify: read; `npm --prefix server run dev` from a fresh copy listens on 127.0.0.1 (`lsof`)
- [ ] **T4 (P2, human: ~10min / CC: ~2min)** — qa — Release-QA proof on portal-selfservice only
  - Surfaced by: OV-7 (D6 A)
  - Files: qa/support/selfservice-live.mjs, qa/support/billing-live.mjs
  - Verify: `release-qa run --attach --only <passkey spec id>`, curl/lsof checks, `node --check` both harnesses

## Completion summary

- Step 0: Scope Challenge — scope accepted as-is
- Reality rows: 7/7 applicable rows emitted, 2 unverified premises
- Architecture Review: 0 issues found
- Code Quality Review: 0 issues found
- Test Review: diagram produced, 1 gap identified
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex not installed; native Plan subagent completed (in-host), 8 findings (3 Medium, 5 Low)
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 2/2 (D1, D2 scored; both picked the 10/10 option)

Suppressed findings (confidence 3-4):
- (4/10) A loopback-only QA API is still reachable by DNS rebinding from a page the developer visits; exploiting it needs
  the committed admin token, which lives in a private repo. Listed in NOT in scope.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | `/plan-eng-review` outside voice, native Plan subagent (codex not installed) | Independent 2nd opinion | 76 | issues_found (in-host; outside_status unavailable) | 8 findings: OV-1/2/3/7 accepted, OV-4 folded, OV-6 covered, OV-5/8 rejected |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 81 | issues_open | 1 issue, 0 critical gaps (resolved: D2 A) |
| Design Review | `/plan-design-review` | UI/UX gaps | 20 | not applicable to this plan (no UI) | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex unavailable (CLI not installed); native Plan subagent completed in 198 s within the 5-minute limit; no external-provider coverage.
- **VERDICT:** Eng Review ISSUES OPEN in the log's terms (1 test gap found, approved and folded into the plan); no CRITICAL findings, all 6 decisions answered. Ready to implement with the amended plan.

NO UNRESOLVED DECISIONS
