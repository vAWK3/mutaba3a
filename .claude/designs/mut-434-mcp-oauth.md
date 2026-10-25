# MUT-434 — OAuth 2.1 sign-in for MCP clients, with a Connect Claude page

**Epic:** MUT-432 (log receipts and card statements from your own Claude) · **Blocked by:** MUT-433 (merged 8fd4ec85, In Review) · **Blocks:** MUT-435, MUT-436
**Status:** plan, eng review pending · **Date:** 2026-10-25 · **ADR:** 197 (renumber at merge) · **API:** 1.74.0-mut434

## 1. Problem and acceptance criteria

The API knows two credentials: a person's session (cookie or `mds_` device bearer) and an organization API key. MCP clients — Claude.ai custom connectors, Claude Desktop, Claude Code — speak OAuth 2.1 with PKCE and register themselves. Until there is an authorization server, the agent half of the epic has no way in.

From the ticket, plus comment 12648 (moved from MUT-433 review D3):

| # | Acceptance criterion |
|---|---|
| AC1 | A Claude.ai custom connector and Claude Code (`claude mcp add --transport http`) both complete sign-in end to end. |
| AC2 | A user without `agent_access` gets a clear refusal at consent, not a broken flow. |
| AC3 | Revoke on the You page ends the agent's access on its next call. |
| AC4 | Reusing a refresh token revokes the grant (the MUT-262 family of rules). |
| AC5 | Rate-limited like the other auth routes; Sentry and audit on grant and revoke. |
| AC6 | Every MCP/OAuth request by a user without `agent_access` fails 403 `FEATURE_NOT_ENABLED`, checked per request with `hasFeature` (no cache). |
| AC7 | Revoking `agent_access` (`feature:revoke`) also revokes that user's grants. |
| AC8 | MCP enforcement applies the closure gate and the user-status check, so a closing or disabled account loses agent access at once. |

Guardrails: reuse the MUT-262 rotation rule and the ADR-023 lessons; no tokens in logs; the MUT-361 lapse gate applies to agent writes.

## 2. Where it lives

One origin does everything: `PORTAL_ORIGIN` (`https://app.mtb3a.com`) serves `/v1`, the SPA, and now the issuer, the MCP resource and the consent page. No CORS-with-credentials, no second host, no `no-hardcoded-hosts` exception.

The reference implementation is Malafat's MAL-176/178 OAuth server (`Malafat/dev/web/crm-platform/apps/web/src/features/oauth`). It has run against Claude.ai since 2026-09. We port its **pure domain rules and its lessons**, not its code (different repo, Next.js, tenant-per-schema):

- CIMD-only registration blocked every real MCP client; DCR was needed (2026-09-20).
- Trust is keyed on the **redirect host**, never on the self-declared `client_name` (MAL-224): an attacker can register as "Claude", but cannot collect a code delivered to `claude.ai`.
- A 30-second refresh-reuse grace window, so a client that lost a refresh response on bad wifi is not disconnected as a thief.
- The authorization-code lifetime is set explicitly to 60 s.

### Flow

```
Claude ──► POST /mcp (no token) ─► 401  WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/mcp"
Claude ──► GET  /.well-known/oauth-protected-resource[/mcp]   ─► { resource: <origin>/mcp, authorization_servers: [<origin>] }
Claude ──► GET  /.well-known/oauth-authorization-server       ─► RFC 8414 metadata (S256 only, auth method none)
Claude ──► POST /oauth/register  (DCR, public, IP-limited)    ─► { client_id: mcl_… }
Browser ─► GET  /oauth/authorize?client_id&redirect_uri&code_challenge&state&scope&resource
              validate (bad client/redirect → error PAGE, never a redirect) → store AuthorizationRequest (10 min)
           ─► 302 /connect/approve?request=<id>                       (portal page, same origin)
Portal  ─► GET  /v1/oauth/requests/:id     (session)  → client name, trust, redirect host, scopes, agentAccess
Portal  ─► POST /v1/oauth/requests/:id/decision {approve|deny}  (session, same-origin CSRF)
              approve: grant (user, client, scopes) + code (60 s, one use)  → { redirectTo: redirect_uri?code&state }
              deny / no agent_access: → { redirectTo: redirect_uri?error=access_denied&state }
Portal  ─► location.assign(redirectTo)      (fetch + navigation, so CSP form-action 'self' never applies)
Claude ──► POST /oauth/token grant_type=authorization_code (code, code_verifier, redirect_uri, client_id)
           ─► { access_token: mat_… (1 h), refresh_token: mrt_… (30 d, rotating), scope, token_type: Bearer }
Claude ──► POST /mcp  Authorization: Bearer mat_…  → authenticateAgent → MCP server (no tools until MUT-435)
```

## 3. Server plan

### 3.1 New module `server/src/oauth/` (pure; unit-tested without Hono or a store)

| File | Contents |
|---|---|
| `scopes.ts` | `OAUTH_SCOPES = ['read', 'write']`, parse/validate; no `scope` → both (see D7). Kept separate from the API-key vocabulary in `auth/scopes.ts` and never published as key scopes. |
| `pkce.ts` | `verifyS256(verifier, challenge)`, verifier syntax (43–128 chars, unreserved set). `plain` is unrepresentable. RFC 7636 Appendix B vector test. |
| `redirect-uri.ts` | Registration rule: `https:` with no fragment, or loopback `http://127.0.0.1|[::1]|localhost:<port>/…` (RFC 8252). No custom schemes in v1. Request rule: **exact string match** against the client's registered list. |
| `client-registration.ts` | DCR request validation (RFC 7591): `redirect_uris` 1–5, `token_endpoint_auth_method` must be `none` (or absent), `grant_types` ⊆ {authorization_code, refresh_token}, `client_name` ≤ 100 chars and stripped of control/bidi characters, unknown fields ignored. |
| `client-trust.ts` | `KNOWN_CLIENT_REDIRECT_HOSTS = ['claude.ai', 'claude.com']` (a code constant, as in Malafat). Verdict `VERIFIED` / `LOOPBACK` (an app on this computer, e.g. Claude Code) / `UNVERIFIED`, computed per request from the redirect URI actually in play. |
| `discovery.ts` | `authorizationServerMetadata(origin)` and `protectedResourceMetadata(origin)`, ported from Malafat's builders. |
| `tokens.ts` | Prefixes `mcl_` (client id), `mac_` (code), `mat_` (access), `mrt_` (refresh); 32 random bytes each; digest = `sessionDigest(SESSION_TOKEN_PEPPER, token)`, so rotating the pepper signs agents out too. TTLs: code 60 s, request 10 min, access 1 h, refresh 30 d sliding, capped at a 90-day grant lifetime (D8). `REFRESH_REUSE_GRACE_MS = 30_000`. |
| `service.ts` | The state machine over the store port: `register`, `startAuthorization`, `decide`, `exchangeCode`, `refresh`, `revokeToken`, `revokeGrant`, `revokeAllForUser(userId, reason)`. Takes `now` and the store, so every rule is tested on the memory store. |

**Refresh rotation (AC4).** Each refresh creates a new token row and marks the old one `rotatedAt`/`replacedById` — a new row, as in MUT-262 D1. When an already-rotated token is presented again:
- **Within 30 s** of its rotation and its successor is unused: revoke the successor and issue a fresh pair from it (the lost-response retry).
- **Otherwise** (outside the window, or the successor was already used): revoke the **whole grant**, reason `refresh_reuse`, and answer `invalid_grant`. This is the theft signal, and the one place we `captureMessage` to Sentry.

Presenting a code twice revokes everything issued from that code (RFC 6749 §4.1.2).

**Access-token validation reads the grant on every call**, so revocation never waits for the 1-hour TTL (AC3/AC7/AC8). It is one Prisma query (token → grant → client, user) plus `hasFeature`.

### 3.2 Storage — Prisma migration `2026102xxxxxxx_mut434_oauth`

Forward-only, with the revert SQL in a header comment, as usual.

- `oauth_clients`: `id` (`mcl_…`), `clientName`, `redirectUris text[]`, `createdAt`, `lastUsedAt?`. No user FK: DCR is unauthenticated.
- `oauth_authorization_requests`: `id uuid`, `clientId` FK, `redirectUri`, `codeChallenge`, `scopes text[]`, `state` (≤ 500), `resource?`, `createdAt`, `expiresAt`, `decidedAt?`, `userId?` FK users cascade.
- `oauth_grants`: `id uuid`, `userId` FK cascade, `clientId` FK, `scopes text[]`, `createdAt`, `expiresAt` (absolute 90 d), `lastUsedAt?`, `revokedAt?`, `revokedReason?`. Index `(userId)`. At most one live grant per (user, client): re-consenting revokes the old one (reason `replaced`).
- `oauth_codes`: `codeDigest @unique`, `grantId` FK cascade, `requestId`, `codeChallenge`, `redirectUri`, `expiresAt`, `consumedAt?`.
- `oauth_tokens`: `tokenDigest @unique`, `grantId` FK cascade, `kind ACCESS|REFRESH`, `createdAt`, `expiresAt`, `rotatedAt?`, `replacedById?`, `revokedAt?`. Index `(grantId)`.

Store port: an `OAuthRepository` in `ports.ts`, `memory.ts` and `prisma.ts`. **store-guard classification:** the protocol methods are called from the public `/oauth/*` routes and from `authenticateAgent`, which run on the raw store (as `authenticate` does today). `listGrantsForUser` and `revokeGrantForUser` are `sessionOnly`; `revokeAllForUser` is `operator`.

Purge: `prisma-purge-tables.ts` gets `oauth_grants.userId: 'delete'` and `oauth_authorization_requests.userId: 'delete'`; the catalog test enforces it. Codes and tokens go with the grant by cascade. Clients are anonymous and stay.

Housekeeping: the nightly `/jobs` run deletes expired requests and codes, and tokens of revoked or expired grants older than 7 days. Clients unused for 30 days with no live grant are deleted.

### 3.3 Routes

| Route | File | Auth | Notes |
|---|---|---|---|
| `GET /.well-known/oauth-authorization-server`, `GET /.well-known/oauth-protected-resource[/mcp]` | `routes/well-known.ts` | public | Mounted always (today the group mounts only with `appAssociation`). `Access-Control-Allow-Origin: *`, no credentials. |
| `POST /oauth/register` | `routes/oauth.ts` | public | JSON. `oauth-register:<ip>` 10/hour. 201 RFC 7591 body. |
| `GET /oauth/authorize` | `routes/oauth.ts` | public | Validation errors that make the redirect untrusted → a plain error page (en+ar, no redirect). Others → redirect with `error=`. `oauth-authorize:<ip>` 30/min. |
| `POST /oauth/token` | `routes/oauth.ts` | public (PKCE) | `application/x-www-form-urlencoded`; RFC 6749 error bodies only (`invalid_grant`, `invalid_request`, …), never our own context; `Cache-Control: no-store`. `oauth-token:<client>` 60/min and `<ip>` 120/min. CORS `*`. |
| `POST /oauth/revoke` | `routes/oauth.ts` | public | RFC 7009; always 200. |
| `GET /v1/oauth/requests/:id` | `routes/oauth-consent.ts` | session, org-independent | `{ client: { name, trust, redirectHost }, scopes, agentAccess }`. 404 when expired, decided or unknown. |
| `POST /v1/oauth/requests/:id/decision` | `routes/oauth-consent.ts` | session, org-independent | `{ decision: 'approve' \| 'deny' }` → `{ redirectTo }`. Approve without `agent_access` → 403 `FEATURE_NOT_ENABLED` (the page shows its refusal and offers "Back to Claude", which posts `deny`). Idempotency: deciding twice → 409. |
| `GET /v1/oauth/grants` | `routes/oauth-consent.ts` | session, org-independent | The person's live grants: client name, trust, scopes, connectedAt, lastUsedAt. Hidden (403) without the flag. |
| `DELETE /v1/oauth/grants/:id` | `routes/oauth-consent.ts` | session, org-independent | Revoke (reason `user`). 404 if it isn't theirs. Allowed even without the flag, so a person can always disconnect. |
| `POST\|GET\|DELETE /mcp` | `routes/mcp.ts` | `mat_` bearer | `@modelcontextprotocol/sdk` `WebStandardStreamableHTTPServerTransport`, stateless (no session id), JSON responses. `src/mcp/server.ts` `createMcpServer(agent)` registers **no tools** in this ticket; MUT-435 adds them there. |

`/v1/oauth/*` are **not** in `CLOSING_OPEN_ENDPOINTS`, so a closing account cannot consent.

`/oauth/*` and `/.well-known/*` stay out of the OpenAPI document. They are standards endpoints described by the metadata, like `/health`. The `/v1/oauth/*` routes go into OpenAPI as usual, and `openapi:check` covers them.

### 3.4 `authenticateAgent` (`server/src/auth/agent-auth.ts`), on `/mcp` only

In order, per request, uncached:
1. A `mat_` bearer is present and well-formed. Otherwise 401 with `WWW-Authenticate: Bearer resource_metadata="…", error="invalid_token"`.
2. Token → unrevoked, unexpired; grant → unrevoked, unexpired. Otherwise 401 `invalid_token`.
3. User: `status === 'ACTIVE'` and not `isAccountGone`. Otherwise 401, and the grant is revoked (`account_changed`), mirroring `validateSessionRecord`.
4. `user.closure` set → 403 via `closingRefusal` (AC8).
5. `hasFeature(rawStore, userId, 'agent_access')` → else 403 `FEATURE_NOT_ENABLED` (AC6). This reads the raw store, exactly as `authenticate` reads the raw store, so the `features.activeFor: 'sessionOnly'` seam (comment 12648) needs no reclassification.
6. Rate limit `agent:<grantId>` 120/min.
7. Set `c.var.agent = { user, grant, scopes }` and `storeGuard = principalStoreGuard('agent', null)`.

**Principal `'agent'`** is added to `writability.ts`. In `storeRefusal` it **fails closed**: only `read`-class methods pass, and `sessionOnly`/write/domain methods refuse with `PRINCIPAL_NOT_ACCEPTED`. MUT-435 and MUT-436 widen it per method, deliberately and with tests. This ticket opens no data.

`/v1/*` `authenticate` explicitly refuses a `mat_`/`mrt_` bearer with `PRINCIPAL_NOT_ACCEPTED`, rather than letting it fall through to `INVALID_API_KEY`.

**Lapse gate seam (guardrail):** `agentWriteGate(c, organizationId)` in `auth/billing-gate.ts` reuses `standingOf` + `standingRefuses(standing, 'POST')` → 402 `SUBSCRIPTION_LAPSED`. It is unit-tested here and called by MUT-436's write tools. There are no writes in 434.

### 3.5 Revocation hooks

| Event | Effect on grants | Where |
|---|---|---|
| You › Connect Claude › Revoke | that grant, `user` | `DELETE /v1/oauth/grants/:id` |
| `feature:revoke agent_access` (CLI or admin route) | all of the user's grants, `feature_revoked`, **in the same transaction** as the feature revoke | `features.revoke` in memory/prisma, when `feature === 'agent_access'` (AC7) |
| Operator disable | all, `disabled` | `admin-users.ts` beside `sessions.revokeAllForUser` |
| Operator `revoke:sessions` | all, `operator` (D5) | `admin-users.ts`, `scripts/users.ts` |
| Password change (MUT-237/262) | all, `password_changed` (D5) | `routes/sessions.ts`, inside the change transaction |
| Account closure starts | none needed: blocked per request (step 4); purge cascades | — |
| User deleted / purged | cascade | FK |

### 3.6 Audit, Sentry, logs (AC5)

- **Audit:** `user.agent_connected` (client name, trust, scopes) and `user.agent_disconnected` (reason). They fan out to each of the person's memberships, as `user.feature_granted` does; a person with no memberships gets `logger.info` only. Both join `SESSION_ONLY_ACTIONS` so API keys never see them.
- **Sentry:** add `captureMessage(level, message, tags)` to `ErrorReporter` (`observability/reporter.ts`, plus the noop and Sentry adapters). Call it on refresh reuse (`warning`) and on revoke-by-feature/disable (`info`); unexpected errors already flow through `onError`. See D6.
- **Logs:** add `code`, `code_verifier`, `access_token`, `refresh_token`, `client_secret` and `state` to `SENSITIVE_KEYS` in `logger.ts`. The access log already records the path without the query, and Sentry already strips query strings. Test: a token request logged at debug carries no secret.

### 3.7 Config and wiring

- `app.ts`: mount `oauthRoutes`, `oauthConsentRoutes` and `mcpRoutes`; add `/oauth/` and `/mcp` to `PORTAL_EXCLUDED_*`; `organizationIndependent` += the four `/v1/oauth` routes; `API_VERSION = '1.74.0-mut434'`.
- `config.ts`: the issuer = `PORTAL_ORIGIN`. When it is unset (local dev), `/.well-known/oauth-*` and `/oauth/*` answer 503 `OAUTH_NOT_CONFIGURED` instead of guessing a host.
- `errors.ts`: `FEATURE_NOT_ENABLED` (403) and `OAUTH_NOT_CONFIGURED` (503) in the envelope enum.
- Dependency: `@modelcontextprotocol/sdk` pinned to the version Malafat runs (^1.29). No OAuth library (D1).

## 4. Portal plan (`src/hosted/**`)

- **Feature read:** `src/hosted/session/features.ts` → `useHasFeature('agent_access')` over `useMe().user.features`.
- **Consent page:** route `/connect/approve` under `authedRoute`, profile-less, in `router.tsx`; page `src/hosted/pages/connect/ConsentPage.tsx` on `AuthLayout`.
  - Shows the client name with `dir="auto"`, a trust line (verified Claude / "an app on this computer" / an unverified warning with the redirect host shown), and what `read` and `write` allow in plain words.
  - Buttons: Allow / Deny.
  - Without the flag: a refusal ("Connecting Claude isn't turned on for your account. Ask MTB3A support.") plus "Back to Claude", which sends `access_denied` (AC2).
  - An expired or used request shows a "Start again from Claude" state.
  - In local mode (`useIsLocalMode()`), it sends the visitor to `/sign-in?next=<href>` itself, because `AuthGate` never redirects in local mode.
  - `/v1/oauth` is added to `ALWAYS_REMOTE` in `client.ts`.
- **You › Account row "Connect Claude"**: shown only with the flag; it opens a drawer via the URL key, following the four steps in `filters.ts`, `AccountDrawers.tsx` and `YouAccount.tsx`. `ConnectClaudeDrawer.tsx` contains:
  - the MCP URL (`<origin>/mcp`) in a new **`CopyField`** (none exists; it is added to `COMPONENT_REGISTRY`);
  - two short how-tos: Claude.ai → Settings → Connectors → Add custom connector; Claude Code → `claude mcp add --transport http mtb3a <url>`;
  - a **Connected apps** list: name, trust, scopes, connected/last-used dates, and Revoke with the inline confirm from `PasskeysDrawer`, then a toast and a list invalidation.

  This is D3: one drawer holds both the Connect page and Connected apps.
- **Data:** `src/hosted/data/oauthQueries.ts`; API calls in `client.ts`; regenerate `schema.d.ts`.
- **i18n:** `hosted.connect.*` in `en.json` and `ar.json`, Arabic default; the parity test enforces both. The command line and URL are rendered `dir="ltr"`.
- **Test gap from research:** `safeNext` with a `next` that carries `?request=…` through `navigate({ to })`; add the test.

## 5. Tests (TDD: written first) and how each AC is proven

| AC | Proof |
|---|---|
| AC1 | (a) `server/src/__tests__/oauth-flow.test.ts`: memory store, the whole protocol: discovery → register → authorize → decision → token → `/mcp initialize` → refresh, with a real S256 pair. (b) The release-QA live spec `portal-selfservice/connect.spec.ts` drives the same flow in a browser against the local API (consent clicked in the page, token exchange by `fetch`). (c) **Hand checks** with real Claude.ai (needs the deployed origin) and Claude Code (against local `:8787`): `manual: true`, owed before release, listed in `docs/operations/before-release.md`. |
| AC2 | Server: decision approve without the flag → 403; deny → `access_denied` redirect. Portal: `ConsentPage.test.tsx` refusal state; QA `portal.connect.refused`. |
| AC3 | Server: revoke, then the next `/mcp` call → 401. Portal: `ConnectClaudeDrawer.test.tsx` revoke; QA `portal.connect.revoke`. |
| AC4 | `oauth/service.test.ts`: rotate; reuse within grace → new pair and the successor revoked; reuse after grace → grant revoked and `invalid_grant`; successor already used → grant revoked; code reuse → its tokens revoked. |
| AC5 | Rate-limit tests per route (429 + `Retry-After`); audit rows on connect and disconnect; `captureMessage` on reuse; logger redaction test. |
| AC6 | `/mcp` with the flag revoked between two calls → 403 on the second (no cache); consent/grants list without the flag → 403. |
| AC7 | `features.revoke('agent_access')` → grants revoked in the same transaction (memory + `test:db` Prisma); route and CLI both. |
| AC8 | Closing user → 403 on `/mcp`; disabled user → 401 and grant revoked; purge removes grants (catalog test). |

Plus: pure-module unit tests (PKCE vector, redirect rules incl. `claude.ai.evil.example`, DCR validation, trust verdicts, metadata shape); `mat_` on `/v1` → `PRINCIPAL_NOT_ACCEPTED`; the agent store guard refuses a `sessionOnly` method; the authorize error page never redirects to an unregistered URI.

Commands (through the heavy-gate queue, Node 22): `npm --prefix server test`, `npm --prefix server run test:db`, `npm --prefix server run typecheck lint openapi:check`, then `npm run lint typecheck test:run build` for the portal, and `release-qa run --attach --only <ids>` + `release-qa lint`.

**QA scenarios** (`qa/features/portal/connect.yaml` on the FakeApi; `qa/features/portal-selfservice/connect.yaml` live):
1. `portal.connect.row-hidden`: without the flag, You › Account has no Connect Claude row.
2. `portal.connect.url`: with the flag, the drawer shows the MCP URL and Copy copies it.
3. `portal.connect.approve`: from an authorize link, sign in, Allow, land on the client's redirect with a code (live).
4. `portal.connect.refused`: without the flag, the consent page refuses and "Back to Claude" returns `access_denied`.
5. `portal.connect.revoke`: a connected app is listed; Revoke confirms inline and removes it.
6. `portal.connect.real-clients`: Claude.ai and Claude Code connect (`manual: true`).

## 6. Quality bar

- **DRY:** reuses `sessionDigest`/pepper, `SlidingWindowRateLimiter` and `requestClientIp`, `closingRefusal`/`isAccountGone`, `hasFeature`, `standingOf`, the audit fan-out, `AuthLayout`, `YouRows`, the inline-confirm pattern and the Drawer. New and registered: `CopyField`. Protocol rules come from Malafat's tested domain modules.
- **Testable:** every protocol rule lives in pure `oauth/*` functions or in `service.ts` over the store port, with `now` injected; routes are thin.
- **Scalable / cost:** per MCP call, one indexed token lookup with its joins, one feature read, and a throttled `lastUsedAt` touch (once a minute, as sessions do). Tables are small and indexed by digest or user; nightly cleanup bounds growth. No third-party calls (no CIMD fetch). The rate limiter is per instance, a known limitation shared with sign-in.
- **Security:** S256 only; exact redirect match; codes single-use, 60 s, bound to the redirect and challenge; opaque tokens stored as digests; refresh rotation with reuse detection; `no-store`; no tokens in logs or Sentry; trust by redirect host; the consent page has `frame-ancestors 'none'` already (clickjacking).
- **Constraints:** Arabic default and RTL; hosted portal only (not the local app or Flutter, per the epic); per-user flag; closure, status and lapse gates; API contract versioned; forward-only migration; release-QA coverage.

## 7. Decisions for review

- **D1 — Hand-rolled AS vs `@node-oauth/oauth2-server`.** Recommend **hand-rolled**. It's narrow (public clients, two grant types), the repo already hand-rolls opaque tokens, the library is Express-shaped, and Malafat's adapter documents three silent-default footguns (client secret required, 300 s codes, PKCE exemption).
- **D2 — DCR only in v1; CIMD later.** Recommend **DCR only**. Both target clients support it (Malafat's experience), and CIMD adds an SSRF-guarded fetcher. Metadata leaves CIMD unadvertised, and a TD records it.
- **D3 — One "Connect Claude" drawer on You › Account** holding the URL, how-tos and Connected apps, vs a separate Connected apps row. Recommend **one drawer**.
- **D4 — No tools in `/mcp` this ticket.** The transport and auth ship and a connector shows as connected with zero tools; MUT-435 adds tools. Alternative: one harmless `whoami` tool to make AC1 tangible. Recommend **zero tools** (no scope creep; the agent guard opens nothing).
- **D5 — Password change and operator revoke-sessions also revoke agent grants.** Recommend **yes**: "sign out everywhere" should include agents, matching MUT-262's intent.
- **D6 — Reading "Sentry on grant and revoke".** Recommend: audit rows for every grant and revoke; Sentry `captureMessage` only for security-relevant ones (refresh reuse, revoked by feature or disable), so Sentry isn't a log of ordinary use.
- **D7 — No `scope` requested → grant `read write`.** The consent screen lists what each allows. Per-scope checkboxes are not in v1.
- **D8 — Lifetimes:** access 1 h, refresh 30 d sliding, grant capped at 90 d absolute (reconnect quarterly), code 60 s, request 10 min.

## 8. Impact and follow-ups

- **ADR-197:** an OAuth 2.1 authorization server for MCP clients on the portal origin. It also records the epic's clarification of MUT-252: MTB3A sends nothing to an LLM; the person brings their own agent.
- **TD:**
  - CIMD support.
  - A shared rate limiter across instances (existing debt, now on more routes).
  - Firm-owner consent for agent access (ADR-196 deferred, decided at MUT-435).
- **Knowledge files:** CHANGELOG, SYSTEM_OVERVIEW (new auth principal), PATTERNS (agent principal fails closed), COMPONENT_REGISTRY (CopyField), TEST_PLAN, `docs/operations/before-release.md` (hand checks; grant `agent_access` to sader@basel.ps after the server release).
- **Not in scope:** tools (435/436), matching (437), per-profile scoping, an app directory, Flutter, and the local web app.

## Business / product impact

- This is the door for the epic's promise: Basel hands his own Claude a receipts folder and a statement, and rows land in MTB3A without typing. Without it, MUT-435–437 have nothing to plug into.
- It sits under epic MUT-432 and unblocks MUT-435 (read tools) and MUT-436 (write tools). It's off for everyone but flagged users, so it ships dark.
- Risk is contained: the flag defaults off, every call is re-checked against the flag, revoking is immediate, and MTB3A spends nothing on any LLM.

---

# Eng review — 2026-10-25 (`/plan-eng-review`, target: this file)

**Scope record (Scope Challenge B):** feature answers: none proposed (scope matches the ticket's ACs); structure: B — smaller arrangement (D1, answered 2026-10-25); accepted scope: the plan above with `server/src/oauth/` as `protocol.ts` (scopes, PKCE, redirect rules, DCR validation, discovery), `trust.ts`, `service.ts`, and every `/oauth/authorize` error redirected to the portal page `/connect/approve?error=<code>` (no server-rendered HTML); pending remedies: S1–S7, plan decisions D1, D3–D8.

**Scope Challenge findings** (evidence: current MCP authorization spec, revision 2026-07-28, fetched from modelcontextprotocol.io; repo reads):
1. S1 [P1] (confidence 9/10) plan §7 D2 — the current spec says AS "**SHOULD** support Client ID Metadata Documents" and "Dynamic Client Registration is deprecated"; the plan builds only the deprecated path. Claude's docs list both as supported.
2. S2 [P1] (confidence 9/10) plan §3.3 — spec: clients "**MUST**" send `resource` on authorize and token requests and servers "**MUST** validate that access tokens were issued specifically for them"; the plan makes `resource` optional and binds no audience. Spec also says AS "**SHOULD** include the `iss` parameter in authorization responses" (RFC 9207); the plan omits it.
3. S3 [P2] (confidence 8/10) plan §7 D7 — spec: `scopes_supported` "is intended to represent the minimal set of scopes necessary for basic functionality", with more scopes through step-up (403 `insufficient_scope`). The plan advertises and defaults to `read write`.
4. S4 [P1] (confidence 8/10) plan §3.1 — refresh rotation and code exchange are not specified as atomic; two concurrent refreshes with one token can both read it unrotated and mint two successors; two code exchanges can both succeed.
5. S5 [P1] (confidence 8/10) plan §3.1 — the 30 s grace re-issue revokes the legitimate client's successor; the plan doesn't say what happens when that revoked successor is presented later. Without "presenting a superseded token revokes the grant", a thief who replays inside the window keeps a working chain.
6. S6 [P2] (confidence 7/10) plan §3.1 `redirect-uri.ts` — exact string match on loopback redirects. RFC 8252 §7.3 / OAuth 2.1 require the AS to accept any port on a loopback redirect, since native clients bind an ephemeral port.
7. S7 [P3] — resolved by D1 (structure B): authorize errors render on the portal page.

## Decision ledger

### S1: client registration (CIMD alongside DCR)
Finding: 1, P1, confidence 9/10, plan §7 D2, reviewer: Claude (plan-eng-review)
Plan baseline: D2 proposal (unapproved): DCR only; CIMD deferred to a TD.
Runtime evidence: no AS exists today. Spec 2026-07-28: CIMD SHOULD, DCR MAY + deprecated. Claude's connector docs list DCR and CIMD as supported. Malafat ships a tested SSRF-guarded fetcher (`features/oauth/domain/cimd-url.ts`, `application/cimd-fetcher.ts`).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| S1 registration | DCR only (proposal) | DCR + CIMD: URL client_id fetched with SSRF guards (https, public IP at connect, no redirects, 5 s, 10 KB, JSON, client_id = URL), cached ≤ 24 h by HTTP headers, `client_id_metadata_document_supported: true` | DCR only; CIMD as TD |
| S2–S6, D1, D3–D8 | pending | pending | pending |
Question D2:
D2 — Support CIMD client registration as well as DCR?
Project/branch/task: MUT-434 OAuth sign-in for MCP clients, planned on main.
ELI10: Before Claude can sign in, it has to tell us who it is. The old way (DCR) is Claude posting a form to register itself. The new way (CIMD) is Claude giving us a web address where its details live, which we fetch. The current MCP spec marks the old way deprecated and recommends the new way. Fetching a web address someone else hands us is risky, so it needs guards.
Stakes if we pick wrong: DCR only works today but builds on a deprecated path that clients will drift away from. CIMD done carelessly lets attackers make our server fetch internal addresses.
Recommendation: A, because the ticket already names CIMD, the spec recommends it, and Malafat's guarded fetcher can be ported with its tests (human: ~2 days / CC: ~45 min).
Completeness: A=10/10, B=7/10
Pros / cons:
A) DCR + CIMD (recommended)
  ✅ Follows the current spec's preferred path; Claude.ai and Claude Code can use whichever they prefer
  ✅ No unauthenticated register endpoint is needed for CIMD clients, so fewer anonymous rows
  ❌ Adds an outbound fetch from the API, an SSRF surface that needs the full guard set and tests
B) DCR only
  ✅ Smallest build; no outbound HTTP from the API at all
  ✅ Both target clients still accept DCR today
  ❌ Builds only the path the spec deprecated; CIMD becomes debt we already know we'll pay
Net: about 45 CC minutes of ported, tested guards buys the spec's recommended path now.
Header: Registration
Options:
A) DCR + CIMD (recommended)
Accept both: DCR at /oauth/register, and https URL client_ids fetched with Malafat's SSRF guards (https only, public-IP check at connect, no redirects, 5 s timeout, 10 KB cap, JSON only, client_id must equal URL), cached up to 24 h; advertise client_id_metadata_document_supported. Effort human ~2 days / CC ~45 min.
B) DCR only
Keep the plan's D2: DCR only, CIMD written down as a TD. No outbound fetch. Effort: none beyond the plan.

State: approved
Actual answer: A) DCR + CIMD (recommended), D2 answered 2026-10-25
Accepted scope: Accept both: DCR at /oauth/register, and https URL client_ids fetched with Malafat's SSRF guards (https only, public-IP check at connect, no redirects, 5 s timeout, 10 KB cap, JSON only, client_id must equal URL), cached up to 24 h; advertise client_id_metadata_document_supported. Lands in `server/src/oauth/trust.ts` (URL rules) + a fetcher in `oauth/service.ts` deps, with every rejection path tested via injected lookup/request.
History: none

### S2a: token audience (RFC 8707 `resource`)
Finding: 2, P1, confidence 9/10, plan §3.3 (`/oauth/authorize` row: "resource?"), reviewer: Claude
Plan baseline: original proposal: `resource` optional, must equal the MCP URL if present; no audience stored on tokens.
Runtime evidence: spec 2026-07-28: clients "MUST" send `resource` on authorize and token; servers "MUST validate that access tokens were issued specifically for them". Today there's one resource (`<origin>/mcp`).
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| S2a audience | optional, unbound | `resource` stored on request, grant and tokens; a mismatch at authorize/token → `invalid_target`; absent → default to `<origin>/mcp` and recorded; `/mcp` rejects a token whose audience ≠ its canonical URI (401) | same, but absent → `invalid_request` (strict) | keep proposal |
| S1 | approved A (D2) | unchanged | unchanged | unchanged |
| S2b, S3–S6, D1, D3–D8 | pending | pending | pending | pending |
Question D3:
D3 — Bind every token to the MCP address it was issued for?
Project/branch/task: MUT-434 OAuth sign-in for MCP clients, planned on main.
ELI10: When Claude asks for a token, it should say which server it'll use it on (the "resource"). The spec says our server must only accept tokens that were issued for it. The plan accepts the field but never records it, so a token can't prove where it belongs. Today that's harmless with one server, but it's a MUST in the spec, and a second resource later would silently accept the wrong tokens.
Stakes if we pick wrong: Strict mode could break an older client that omits the field. Doing nothing leaves a spec MUST unmet and the door open for confused-deputy token reuse later.
Recommendation: A, because it meets the MUST and stays forgiving to clients that omit the field (human: ~3 h / CC: ~10 min).
Completeness: A=10/10, B=9/10, C=6/10
Pros / cons:
A) Bind, default when absent (recommended)
  ✅ Every token carries its audience and /mcp checks it on every call, which meets the spec MUST
  ✅ Clients that omit `resource` still connect, defaulted to our one MCP URL and recorded
  ❌ One more column on three tables and one more comparison per request
B) Bind, strict
  ✅ The cleanest reading of the spec; a client that omits the field is told exactly what's wrong
  ✅ Same audience check on /mcp as A
  ❌ An older or buggy client fails sign-in outright, with a confusing error inside Claude
C) Keep proposal
  ✅ No extra work or columns
  ✅ Fine while there is exactly one resource
  ❌ Leaves a spec MUST unmet and no audience on tokens to check later
Net: ten CC minutes to meet the spec without risking client breakage.
Header: Audience
Options:
A) Bind, default when absent (recommended)
Store `resource` on request, grant and tokens; mismatch → invalid_target; absent → default to <origin>/mcp (recorded); /mcp rejects tokens whose audience isn't its canonical URI with 401. Effort human ~3 h / CC ~10 min.
B) Bind, strict
Same binding and /mcp check, but an absent `resource` at authorize or token → invalid_request. Effort human ~3 h / CC ~10 min.
C) Keep proposal
`resource` optional and checked only if present; nothing stored, no audience check on /mcp. No extra effort.

State: approved
Actual answer: A) Bind, default when absent (recommended), D3 answered 2026-10-25
Accepted scope: Store `resource` on request, grant and tokens; mismatch → invalid_target; absent → default to <origin>/mcp (recorded); /mcp rejects tokens whose audience isn't its canonical URI with 401. Tests: mismatch at authorize and token; absent defaults; token with a foreign audience → 401 on /mcp.
History: none

### S2b: RFC 9207 `iss` in authorization responses
Finding: 2, P2, confidence 9/10, plan §2 flow ("redirect_uri?code&state"), reviewer: Claude
Plan baseline: original proposal: redirect carries `code` and `state` only.
Runtime evidence: spec 2026-07-28: AS "SHOULD include the `iss` parameter in authorization responses, including error responses"; if included, "MUST advertise ... `authorization_response_iss_parameter_supported`"; a future revision expects MUST.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| S2b iss | absent | `iss=<issuer>` on every redirect (code and error), metadata `authorization_response_iss_parameter_supported: true` | keep proposal |
| S1, S2a | approved A (D2, D3) | unchanged | unchanged |
| S3–S6, D1, D3–D8 | pending | pending | pending |
Question D4:
D4 — Add the issuer (`iss`) to every redirect back to Claude?
Project/branch/task: MUT-434 OAuth sign-in for MCP clients, planned on main.
ELI10: When we send the browser back to Claude with a code, we can also stamp it with our own name (the issuer). Claude checks the stamp, so a code from a lookalike server can't be passed off as ours ("mix-up attack"). The spec says SHOULD today and expects MUST soon. It's one extra query parameter and one metadata flag.
Stakes if we pick wrong: Skipping it now means a forced change when the spec flips to MUST, and Claude can't detect a mix-up today.
Recommendation: A, because it's a couple of lines, the spec is moving to MUST, and it closes a known attack class (human: ~1 h / CC: ~5 min).
Completeness: A=10/10, B=7/10
Pros / cons:
A) Add `iss` (recommended)
  ✅ Clients can reject a code that came from a different authorization server
  ✅ Ready for the spec's announced SHOULD→MUST upgrade with no later change
  ❌ The issuer string must exactly match the metadata's, so a test must pin both together
B) Keep proposal
  ✅ Nothing to build or test
  ✅ Today's clients still connect without it
  ❌ Mix-up attacks stay undetectable and a spec change is already on the calendar
Net: five CC minutes for a spec-ready, mix-up-safe redirect.
Header: Issuer
Options:
A) Add iss (recommended)
Every authorize redirect (code and error) carries iss=<issuer>; metadata sets authorization_response_iss_parameter_supported: true; a test pins the redirect iss to the metadata issuer. Effort human ~1 h / CC ~5 min.
B) Keep proposal
Redirects carry code/state (or error/state) only; no metadata flag. No extra effort.

State: approved
Actual answer: A) Add iss (recommended), D4 answered 2026-10-25
Accepted scope: Every authorize redirect (code and error) carries iss=<issuer>; metadata sets authorization_response_iss_parameter_supported: true; a test pins the redirect iss to the metadata issuer.
History: none

### S3: which scopes to advertise and grant (merges plan D7)
Finding: 3, P2, confidence 8/10, plan §7 D7 ("No `scope` requested → grant `read write`"), reviewer: Claude
Plan baseline: D7 proposal (unapproved): advertise `read write`; no scope → both; no per-scope choice on consent.
Runtime evidence: spec 2026-07-28: `scopes_supported` "is intended to represent the minimal set of scopes necessary for basic functionality", more via step-up (403 `insufficient_scope` → client re-authorizes). Whether Claude.ai performs step-up re-authorization reliably is unverified (no source found). The epic exists to write expenses.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| S3 scopes | D7 proposal: advertise + default `read write` | Advertise `read write` in `scopes_supported` and the 401 `scope=`; no scope → both; consent lists both; write tools (MUT-436) still answer 403 `insufficient_scope` for a read-only grant; deviation from "minimal" recorded in ADR-197 | Advertise `read` only; `write` only by step-up (403 `insufficient_scope` scope="read write" → re-consent); a first connection is read-only |
| S1, S2a, S2b | approved A (D2–D4) | unchanged | unchanged |
| S4–S6, D1, D3–D6, D8 | pending | pending | pending |
Question D5:
D5 — Ask for read and write up front, or read first and write later?
Project/branch/task: MUT-434 OAuth sign-in for MCP clients, planned on main.
ELI10: The spec prefers servers to advertise the smallest permission set (read) and have the client come back for more (write) only when it needs it. That's "step-up": the first time Claude tries to save an expense, it gets "need write", reopens the browser, and you approve again. It's tidier for security, but every user approves twice, and I couldn't confirm Claude.ai handles step-up reliably. The whole point of this epic is writing expenses.
Stakes if we pick wrong: Read-first could leave Claude stuck mid-task if its step-up is shaky. Both-up-front grants write to someone who only wanted to look.
Recommendation: A, because writing is the core use and step-up support in Claude.ai is unproven. Write is still a separate scope, so a read-only grant stays possible and MUT-436 enforces it (human: ~same / CC: ~same).
Note: options differ in kind, not coverage. No completeness score.
Pros / cons:
A) Both up front (recommended)
  ✅ One consent and Claude can save expenses at once, which matches what the epic promises
  ✅ No dependence on Claude.ai's unverified step-up behavior
  ❌ Deviates from the spec's "minimal scopes_supported" SHOULD, so the ADR has to say why
B) Read first, write by step-up
  ✅ Follows the spec's least-privilege SHOULD exactly
  ✅ An agent that only looks never holds write
  ❌ Every real user approves twice, and a client that mishandles step-up can't write at all
Net: one consent and a proven path, against strict least privilege that may stall writes.
Header: Scopes
Options:
A) Both up front (recommended)
Advertise read+write in scopes_supported and the 401 scope=; no scope requested → both; consent lists both; MUT-436 write tools still return 403 insufficient_scope to a read-only grant; ADR-197 records the deviation from the minimal-scopes SHOULD.
B) Read first, write by step-up
Advertise read only; write granted only after a 403 insufficient_scope (scope="read write") triggers re-consent; the first connection is read-only.

State: approved
Actual answer: A) Both up front (recommended), D5 answered 2026-10-25 (also settles plan D7)
Accepted scope: Advertise read+write in scopes_supported and the 401 scope=; no scope requested → both; consent lists both; MUT-436 write tools still return 403 insufficient_scope to a read-only grant; ADR-197 records the deviation from the minimal-scopes SHOULD.
History: none

### S4: single-use codes and refresh tokens under concurrency
Finding: 4, P1, confidence 8/10, plan §3.1 ("Each refresh creates a new token row and marks the old one `rotatedAt`"), reviewer: Claude
Plan baseline: original proposal: rotation and code consumption described, atomicity unspecified.
Runtime evidence: the repo's precedent for single-use claims is conditional writes (`idempotency-claim.ts`, MUT-262's rotation inside the password-change transaction, `prisma.ts:414-426`). Without one, two requests reading the same unrotated row both succeed.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| S4 atomic consume | unspecified | Conditional claim: `UPDATE … SET consumedAt/rotatedAt = now WHERE id = ? AND consumedAt/rotatedAt IS NULL`, proceed only when 1 row changed, and mint successors in the same transaction; the loser takes the reuse path (S5/grace). Memory store mirrors it; tests fire two exchanges/refreshes with `Promise.all` on memory and under `test:db` | `SELECT … FOR UPDATE` row lock inside a transaction, then check and write |
| S1–S3 | approved A (D2–D5) | unchanged | unchanged |
| S5, S6, D1, D3–D6, D8 | pending | pending | pending |
Question D6:
D6 — How do we make codes and refresh tokens strictly single-use?
Project/branch/task: MUT-434 OAuth sign-in for MCP clients, planned on main.
ELI10: A code or a refresh token must work exactly once. If Claude retries a request at the same moment, or a thief races the real client, two requests can both read "not used yet" and both win, which hands out two token chains. The plan says "single use" but not how it's enforced. Either the database flips "used" in one conditional step and only one request sees it change, or we lock the row while checking.
Stakes if we pick wrong: Without one of these, a raced code or refresh token mints a second live chain that reuse detection never sees.
Recommendation: A, because it matches how this repo already claims single-use rows, needs no lock waits, and the loser falls straight into reuse detection (human: ~4 h / CC: ~15 min).
Note: options differ in kind, not coverage. Both meet the same contract with the same race tests; no completeness score.
Pros / cons:
A) Conditional claim (recommended)
  ✅ One statement decides the winner; no lock is held, so no request waits on another
  ✅ Same idiom as the repo's idempotency claims, so the memory store mirrors it easily
  ❌ The "1 row changed" check must be in every consume path or the race reopens silently
B) Row lock (FOR UPDATE)
  ✅ Familiar check-then-write code inside one transaction
  ✅ Also serialises the lastUsedAt touch on the same row
  ❌ Holds a lock per refresh, and the memory store has no real lock to mirror it in tests
Net: same guarantee; A is lock-free and already this repo's idiom.
Header: Single-use
Options:
A) Conditional claim (recommended)
UPDATE … WHERE consumedAt/rotatedAt IS NULL, proceed only on 1 row changed, successors minted in the same transaction, loser goes to the reuse path; memory store mirrors it; Promise.all race tests on memory and test:db. Effort human ~4 h / CC ~15 min.
B) Row lock (FOR UPDATE)
SELECT … FOR UPDATE in a transaction, then check and write; same race tests. Effort human ~4 h / CC ~15 min.

State: approved
Actual answer: A) Conditional claim (recommended), D6 answered 2026-10-25
Accepted scope: UPDATE … WHERE consumedAt/rotatedAt IS NULL, proceed only on 1 row changed, successors minted in the same transaction, loser goes to the reuse path; memory store mirrors it; Promise.all race tests on memory and test:db.
History: none

### S5: what a superseded refresh token means (grace-window hole)
Finding: 5, P1, confidence 8/10, plan §3.1 ("Within 30 s of its rotation and its successor is unused: revoke the successor and issue a fresh pair from it"), reviewer: Claude
Plan baseline: original proposal: 30 s grace re-issue; outside the window or successor used → revoke grant. The case "a successor that was revoked by a grace re-issue is presented later" is unspecified.
Runtime evidence: a client uses its refresh token about once an hour (access TTL 1 h), so its successor is almost always "unused" inside the 30 s window. A thief replaying inside the window gets the fresh pair; the real client later presents its revoked successor. Malafat's equivalent (`oauth-model.ts:55,366`) treats out-of-window reuse as compromise.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| S5 superseded token | unspecified | Keep the 30 s grace; a token revoked with reason `superseded` (by a grace re-issue) that is presented again → revoke the whole grant (`refresh_reuse`), `invalid_grant`, Sentry warning. Tests: thief-in-window then real client → grant dead, thief's pair dead | No grace: any presentation of an already-rotated token → revoke the grant at once |
| S1–S4 | approved A (D2–D6) | unchanged | unchanged |
| S6, D1, D3–D6, D8 | pending | pending | pending |
Question D7:
D7 — What happens when a token cancelled by the retry grace comes back?
Project/branch/task: MUT-434 OAuth sign-in for MCP clients, planned on main.
ELI10: The plan gives a 30-second grace: if Claude's refresh reply got lost on bad wifi and it retries with the old token, we cancel the reply it never got and send a fresh one. The hole: if a thief replays a stolen token in those 30 seconds, the thief gets the fresh pair, and the real Claude's token is the one cancelled. The plan never says what happens when that cancelled token shows up later. Either that moment kills everything (so the thief loses too), or we drop the grace and kill on any reuse.
Stakes if we pick wrong: Leave it open and a thief inside the window keeps a working chain. No grace at all disconnects honest users on flaky networks.
Recommendation: A, because it keeps the bad-wifi forgiveness and still kills a stolen chain the moment the real client comes back (human: ~2 h / CC: ~10 min).
Completeness: A=10/10, B=9/10
Pros / cons:
A) Superseded comes back → revoke grant (recommended)
  ✅ Honest retries inside 30 s still work, so flaky wifi doesn't disconnect anyone
  ✅ A thief who raced the window is cut off the moment the real client refreshes
  ❌ The thief has a window of up to one access-token lifetime (1 h) before detection
B) No grace at all
  ✅ Simplest rule: any reuse kills the grant immediately, with no window
  ✅ No superseded state to track or test
  ❌ A lost refresh response disconnects the user, who then has to reconnect Claude by hand
Net: keep forgiveness for retries while making a raced theft self-destruct.
Header: Grace hole
Options:
A) Superseded comes back → revoke grant (recommended)
Keep 30 s grace; a grace re-issue revokes the old successor with reason superseded; presenting a superseded token later revokes the whole grant (refresh_reuse), answers invalid_grant, Sentry warning; tests cover thief-in-window then real client. Effort human ~2 h / CC ~10 min.
B) No grace at all
Any presentation of an already-rotated refresh token revokes the grant at once; drop REFRESH_REUSE_GRACE_MS. Effort human ~1 h / CC ~5 min.

State: approved
Actual answer: A) Superseded comes back → revoke grant (recommended), D7 answered 2026-10-25
Accepted scope: Keep 30 s grace; a grace re-issue revokes the old successor with reason superseded; presenting a superseded token later revokes the whole grant (refresh_reuse), answers invalid_grant, Sentry warning; tests cover thief-in-window then real client.
History: none

### S6: loopback redirect port matching
Finding: 6, P2, confidence 7/10, plan §3.1 (`redirect-uri.ts`: "Request rule: **exact string match**"), reviewer: Claude
Plan baseline: original proposal: exact string match for every redirect, loopback included.
Runtime evidence: RFC 8252 §7.3 says the AS "MUST allow any port to be specified at the time of the request for loopback IP redirect URIs"; OAuth 2.1 draft carries the same rule. ADR-023 shows the cost when a server matches loopback ports exactly: Mutaba3a's own client had to register four fixed ports for Malafat. Whether Claude Code reuses one registered port is unverified.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| S6 loopback | exact match | For `http://127.0.0.1`, `http://[::1]` and `http://localhost` redirects, match scheme, host and path exactly and ignore the port; every other redirect stays exact. Tests: port differs → accepted; host/path differs → refused; `127.0.0.1.evil.example` → refused | keep exact match everywhere |
| S1–S5 | approved A (D2–D7) | unchanged | unchanged |
| D1, D3–D6, D8 | pending | pending | pending |
Question D8:
D8 — Accept any port on a localhost redirect (Claude Code)?
Project/branch/task: MUT-434 OAuth sign-in for MCP clients, planned on main.
ELI10: Claude Code signs in by opening a tiny web server on your own computer at a random port and asking us to send the browser back there. The plan only accepts the exact address registered earlier, port included. If Claude Code picks a different port next time, sign-in fails. The OAuth rules for apps on your computer say the server must accept any port on a localhost address. Nobody else can receive a redirect sent to your own machine.
Stakes if we pick wrong: Exact matching can break Claude Code reconnects at random. Loose matching done sloppily could let a lookalike host slip through.
Recommendation: A, because the standard requires it for loopback and the match stays exact on scheme, host and path (human: ~2 h / CC: ~10 min).
Completeness: A=10/10, B=7/10
Pros / cons:
A) Any port on loopback (recommended)
  ✅ Follows RFC 8252, so Claude Code reconnects whatever port it picks
  ✅ Only loopback hosts relax; https redirects like claude.ai stay exact
  ❌ One more branch in the redirect matcher, which needs lookalike-host tests
B) Exact match everywhere
  ✅ One rule for every redirect; nothing to reason about
  ✅ Fine if Claude Code always re-registers or reuses its port
  ❌ Breaks the RFC rule; a Claude Code port change shows up as a failed sign-in
Net: ten CC minutes to make Claude Code sign-in reliable, per the standard.
Header: Loopback
Options:
A) Any port on loopback (recommended)
For http://127.0.0.1, http://[::1] and http://localhost redirects, match scheme, host and path exactly and ignore the port; all other redirects stay exact; tests for port change, host/path change and lookalike hosts. Effort human ~2 h / CC ~10 min.
B) Exact match everywhere
Keep exact string matching for all redirects, loopback included. No extra effort.

State: approved
Actual answer: A) Any port on loopback (recommended), D8 answered 2026-10-25
Accepted scope: For http://127.0.0.1, http://[::1] and http://localhost redirects, match scheme, host and path exactly and ignore the port; all other redirects stay exact; tests for port change, host/path change and lookalike hosts.
History: none

**Scope Challenge result:** scope accepted as-is (structure B is a smaller arrangement, not a reduction). Dispositions: S1 accepted (D2), S2a accepted (D3), S2b accepted (D4), S3 accepted (D5, settles plan D7), S4 accepted (D6), S5 accepted (D7), S6 accepted (D8), S7 resolved by D1.

### P-D1: authorization-server implementation (plan §7 D1)
Finding: plan decision, reviewer: plan author; Section 1 Architecture
Plan baseline: D1 proposal (unapproved): hand-rolled AS in `server/src/oauth/`.
Runtime evidence: no OAuth dependency in `server/package.json`. Malafat uses `@node-oauth/oauth2-server` ^5.3 behind a Next adapter (`oauth-server.ts`), whose comments record three silent defaults it had to override (client secret required by default, 300 s code lifetime, PKCE exemption scope). The repo already hand-rolls opaque tokens and digests (`auth/sessions.ts`).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| P-D1 AS implementation | hand-rolled (proposal) | Hand-rolled: `oauth/protocol.ts` + `service.ts` over the store port, opaque `mat_`/`mrt_` tokens, RFC test vectors | `@node-oauth/oauth2-server` with a Hono adapter and a model over the store port, overriding its defaults |
| S1–S6 | approved (D2–D8) | unchanged | unchanged |
| P-D3, P-D4, P-D5, P-D6, P-D8, R1 | pending | pending | pending |
Question D9:
D9 — Write the OAuth server ourselves, or use the oauth2-server library?
Project/branch/task: MUT-434 OAuth sign-in for MCP clients, planned on main.
ELI10: We need code that hands out and checks sign-in tokens. We can write the narrow piece we need ourselves (two kinds of token exchange, public clients only) or use the library Malafat uses. The library brings its own rules, and Malafat's notes show three places where its defaults were quietly less safe than what we want. It also expects an Express-style server, while ours is Hono. Our decisions above (grace-hole rule, conditional claims, audience, iss, CIMD) are custom either way.
Stakes if we pick wrong: Hand-rolled bugs are ours to find. A library's hidden defaults can silently weaken security, as Malafat found.
Recommendation: A, because the surface is small, every rule we approved is custom anyway, and the repo already hand-rolls tokens this way (human: ~3 days / CC: ~1.5 h).
Note: options differ in kind, not coverage. No completeness score.
Pros / cons:
A) Hand-rolled (recommended)
  ✅ Every rule (grace hole, conditional claim, audience, iss) is explicit in our code and tests
  ✅ No Express adapter on Hono, and no library defaults to audit and override
  ❌ We own protocol correctness, so the RFC vectors and negative tests have to be thorough
B) oauth2-server library
  ✅ Battle-tested grant handling and error mapping from a maintained package
  ✅ Same library as Malafat, so its lessons carry over directly
  ❌ Needs a Hono adapter plus overrides for its unsafe defaults, and our custom rules still sit beside it
Net: a small, fully explicit protocol in our idiom, against a library we'd mostly be overriding.
Header: AS build
Options:
A) Hand-rolled (recommended)
oauth/protocol.ts + trust.ts + service.ts over the store port; opaque mat_/mrt_ tokens digested with the session pepper; RFC 7636 vectors and negative tests for every rule. Effort human ~3 days / CC ~1.5 h.
B) oauth2-server library
Add @node-oauth/oauth2-server, write a Hono adapter and a model over the store port, override code lifetime, client-secret and PKCE defaults, and layer the approved custom rules on top. Effort human ~3 days / CC ~1.5 h.

State: approved
Actual answer: A) Hand-rolled (recommended), D9 answered 2026-10-25
Accepted scope: oauth/protocol.ts + trust.ts + service.ts over the store port; opaque mat_/mrt_ tokens digested with the session pepper; RFC 7636 vectors and negative tests for every rule.
History: none

### P-D4: what /mcp serves in this ticket (plan §7 D4)
Finding: plan decision, reviewer: plan author; Section 1 Architecture
Plan baseline: D4 proposal (unapproved): transport and auth only, zero tools; MUT-435 adds tools.
Runtime evidence: MUT-435's scope (Jira) lists the six read tools; the agent store guard (plan §3.4) opens no data in 434. AC1 needs "complete sign-in end to end", which `initialize` + `tools/list` (empty) proves.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| P-D4 /mcp content | zero tools (proposal) | Zero tools: `initialize`, `ping`, `tools/list` → []; server name/version only | One read-only `whoami` tool (display name, profile count) so a person can see the connection work in chat |
| S1–S6, P-D1 | approved | unchanged | unchanged |
| P-D3, P-D5, P-D6, P-D8, R1 | pending | pending | pending |
Question D10:
D10 — Ship /mcp with no tools yet, or one harmless "who am I" tool?
Project/branch/task: MUT-434 OAuth sign-in for MCP clients, planned on main.
ELI10: This ticket is the door, not the furniture. After sign-in, Claude will show MTB3A as connected, but it can't do anything until MUT-435 adds tools. A tiny "who am I" tool would let you type "who am I in MTB3A?" and see your name, which proves the whole chain works. It also means this ticket starts reading user data, which the next ticket is meant to own with its ownership rules.
Stakes if we pick wrong: Zero tools makes the hand check less satisfying. A whoami tool slips data access into a ticket whose guard is meant to open nothing.
Recommendation: A, because it keeps this ticket's guard fully closed and MUT-435 is next. The hand check can confirm "connected, 0 tools" plus a token refresh (human: ~0 / CC: ~0).
Note: options differ in kind, not coverage. No completeness score.
Pros / cons:
A) Zero tools (recommended)
  ✅ The agent principal opens nothing, so the security review of data access stays in MUT-435
  ✅ No scope creep; MUT-435 lands tools on a transport that's already proven
  ❌ The hand check shows "connected" but nothing you can ask Claude to do yet
B) One whoami tool
  ✅ End-to-end proof in plain chat: Claude answers with your name from MTB3A
  ✅ Gives MUT-435 a working tool pattern to copy
  ❌ Opens a person-level read through the agent guard a ticket early, outside MUT-435's ownership tests
Net: a closed door that's provably openable, against a demo that leaks one ticket's scope into another.
Header: MCP tools
Options:
A) Zero tools (recommended)
/mcp answers initialize, ping and tools/list (empty) with server name and version; the agent store guard opens nothing; MUT-435 registers tools in src/mcp/server.ts.
B) One whoami tool
Add a read-only whoami tool returning the person's display name and profile count, widening the agent guard for those two reads with tests.

State: approved
Actual answer: A) Zero tools (recommended), D10 answered 2026-10-25
Accepted scope: /mcp answers initialize, ping and tools/list (empty) with server name and version; the agent store guard opens nothing; MUT-435 registers tools in src/mcp/server.ts.
History: none

### P-D5a: password change disconnects agents (plan §7 D5, first half)
Finding: plan decision, reviewer: plan author; Section 1 Architecture (security boundary)
Plan baseline: D5 proposal (unapproved): password change revokes all agent grants (`password_changed`).
Runtime evidence: MUT-237/262: a password change revokes the person's other sessions and rotates the kept one (`routes/sessions.ts:312-313`, ADR-194). Agent grants are a separate table, so nothing touches them today.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| P-D5a password change | no effect on grants (proposal: revoke) | Revoke all of the person's live grants (`password_changed`) inside the password-change transaction; audit `user.agent_disconnected`; test | Leave grants alone; the person revokes from You › Connect Claude |
| S1–S6, P-D1, P-D4 | approved | unchanged | unchanged |
| P-D5b, P-D3, P-D6, P-D8, R1 | pending | pending | pending |
Question D11:
D11 — Should changing your password disconnect your connected Claude?
Project/branch/task: MUT-434 OAuth sign-in for MCP clients, planned on main.
ELI10: Today, changing your password signs out every other device. That's what people expect after a scare ("someone has my password"). A connected Claude is another device holding a key. If the password change doesn't cut it off, an attacker who connected their own Claude with your stolen password keeps access after you change it. The cost: you reconnect your own Claude after every password change.
Stakes if we pick wrong: Leaving grants alone means a password reset doesn't evict an attacker's agent. Revoking means one extra reconnect for honest users.
Recommendation: A, because a password change is the user's "kick everyone out" button and an attacker's agent must not survive it (human: ~2 h / CC: ~10 min).
Completeness: A=10/10, B=6/10
Pros / cons:
A) Revoke on password change (recommended)
  ✅ A password reset evicts every agent, including one an attacker connected
  ✅ Matches what the person expects from "sign out other devices" since MUT-237
  ❌ Honest users reconnect Claude after each password change
B) Leave grants alone
  ✅ Changing a password never interrupts a working Claude connection
  ✅ Revoke stays one tap away on the You page
  ❌ An attacker's connected agent survives the victim's password change
Net: one reconnect for the honest user, against an attacker's agent outliving a reset.
Header: Password
Options:
A) Revoke on password change (recommended)
Revoke all of the person's live grants (reason password_changed) in the same transaction as the password change; audit user.agent_disconnected; test it. Effort human ~2 h / CC ~10 min.
B) Leave grants alone
Password change doesn't touch agent grants; revocation only from You › Connect Claude, the feature flag, disable or purge. No extra effort.

State: approved
Actual answer: A) Revoke on password change (recommended), D11 answered 2026-10-25
Accepted scope: Revoke all of the person's live grants (reason password_changed) in the same transaction as the password change; audit user.agent_disconnected; test it.
History: none

### P-D5b: operator "revoke sessions" disconnects agents (plan §7 D5, second half)
Finding: plan decision, reviewer: plan author; Section 1 Architecture
Plan baseline: D5 proposal (unapproved): `POST /admin/v1/users/{id}/sessions/revoke` and the `revoke:sessions` CLI also revoke grants (`operator`).
Runtime evidence: today that route calls `store.sessions.revokeAllForUser(user.id, 'operator', now)` (`admin-users.ts:612`); the CLI calls the route (`scripts/users.ts:527`). Operator disable (`admin-users.ts:491`) already revokes grants under the plan (§3.5, not in question).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| P-D5b operator revoke-sessions | sessions only (proposal: + grants) | Also revoke all live grants (`operator`) in the same call; response counts both; audit; test | Sessions only; to cut an agent the operator uses `feature:revoke agent_access` (which revokes grants per AC7) |
| S1–S6, P-D1, P-D4, P-D5a | approved | unchanged | unchanged |
| P-D3, P-D6, P-D8, R1 | pending | pending | pending |
Question D12:
D12 — Should the operator's "sign this person out everywhere" also cut their Claude?
Project/branch/task: MUT-434 OAuth sign-in for MCP clients, planned on main.
ELI10: You have an operator command that signs a person out of every device, for example when their account looks compromised. It doesn't know about connected agents yet. If it stays sessions-only, you'd also have to remember to revoke the agent flag to cut a connected Claude. If it covers agents too, one command does everything, but the person's own Claude reconnects with one click, without needing the flag to be re-granted.
Stakes if we pick wrong: Sessions-only leaves a compromised account's agent working until you remember the second command.
Recommendation: A, because "sign out everywhere" should mean everywhere, and revoking grants (not the flag) lets the honest owner simply reconnect (human: ~1 h / CC: ~5 min).
Completeness: A=10/10, B=7/10
Pros / cons:
A) Include agents (recommended)
  ✅ One operator command fully evicts a compromised account, agents included
  ✅ The flag stays granted, so the honest owner just reconnects Claude
  ❌ An operator who meant "sessions only" now also disconnects the person's agent
B) Sessions only
  ✅ Keeps today's meaning of the command exactly
  ✅ Agents are cut with the separate, explicit feature:revoke command
  ❌ Two commands for a full eviction; forgetting the second leaves the agent live
Net: one command that really means "everywhere", at the cost of an extra reconnect.
Header: Operator
Options:
A) Include agents (recommended)
revoke-sessions (route and CLI) also revokes all live grants with reason operator in the same call; the response reports both counts; audited and tested. Effort human ~1 h / CC ~5 min.
B) Sessions only
revoke-sessions stays sessions-only; operators cut agents with feature:revoke agent_access (which revokes grants per AC7). No extra effort.

State: approved
Actual answer: A) Include agents (recommended), D12 answered 2026-10-25
Accepted scope: revoke-sessions (route and CLI) also revokes all live grants with reason operator in the same call; the response reports both counts; audited and tested.
History: none

### P-D8: token and grant lifetimes (plan §7 D8)
Finding: plan decision, reviewer: plan author; Section 1 Architecture (bounds)
Plan baseline: D8 proposal (unapproved): code 60 s, authorization request 10 min, access 1 h, refresh 30 d sliding idle, grant 90 d absolute.
Runtime evidence: the epic's core use is a **monthly** card statement plus receipts (MUT-432). A refresh idle limit of 30 days expires right at a monthly cadence (a 31-day month, or a late statement). Device sessions use 30 d idle / 180 d absolute (`DEFAULT_DEVICE_IDLE_DAYS`/`ABSOLUTE_DAYS`, `auth/sessions.ts`).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| code / request / access | 60 s / 10 min / 1 h (proposal) | 60 s / 10 min / 1 h | 60 s / 10 min / 1 h |
| refresh idle | 30 d (proposal) | 30 d | 45 d |
| grant absolute | 90 d (proposal) | 90 d | 180 d (same as device sessions) |
| S1–S6, P-D1, P-D4, P-D5a/b | approved | unchanged | unchanged |
| P-D3, P-D6, R1 | pending | pending | pending |
Question D13:
D13 — How long should a Claude connection last without being used?
Project/branch/task: MUT-434 OAuth sign-in for MCP clients, planned on main.
ELI10: Claude's key renews itself every time it's used. If it isn't used for a while, it expires and you reconnect. The plan expires it after 30 days unused and forces a reconnect every 90 days regardless. You'll mostly use this once a month for the card statement, so 30 days can expire right before you need it, every month. 45 days unused and a 180-day hard limit (the same as the phone app's sessions) fits a monthly habit. Short-lived pieces (1-hour access token, 60-second code) stay as planned.
Stakes if we pick wrong: Too short and you reconnect nearly every statement. Too long and a forgotten connection stays alive longer.
Recommendation: B, because the use is monthly and the phone app already lives with 180 days. Revocation is instant anyway, since every call re-checks the grant and the flag (human: ~0 / CC: ~0).
Note: options differ in kind, not coverage. No completeness score.
Pros / cons:
A) 30 d idle / 90 d cap (plan)
  ✅ A forgotten connection dies sooner, shrinking how long a stolen refresh token works
  ✅ Quarterly reconnect re-confirms consent regularly
  ❌ Monthly users hit an expired connection about as often as they use it
B) 45 d idle / 180 d cap (recommended)
  ✅ Survives a monthly statement cycle with room to spare, so you rarely reconnect
  ✅ Matches device sessions (180 d absolute), one mental model for "how long am I signed in"
  ❌ An unused, forgotten connection lives up to 45 days before expiring
Net: fewer pointless reconnects for a monthly habit; revocation stays instant either way.
Header: Lifetimes
Options:
A) 30 d idle / 90 d cap (plan)
Code 60 s, request 10 min, access 1 h, refresh 30 days idle (sliding), grant 90 days absolute.
B) 45 d idle / 180 d cap (recommended)
Code 60 s, request 10 min, access 1 h, refresh 45 days idle (sliding), grant 180 days absolute, matching device sessions.

State: approved
Actual answer: B) 45 d idle / 180 d cap (recommended), D13 answered 2026-10-25
Accepted scope: Code 60 s, request 10 min, access 1 h, refresh 45 days idle (sliding), grant 180 days absolute, matching device sessions.
History: none

**Section 1 (Architecture):** no new defects beyond the Scope Challenge findings. Plan decisions resolved: P-D1 hand-rolled (D9), P-D4 zero tools (D10), P-D5a password change revokes grants (D11), P-D5b operator revoke-sessions includes grants (D12), P-D8 45 d / 180 d (D13).

### P-D6: what "Sentry on grant and revoke" means (plan §7 D6, AC5)
Finding: plan decision, reviewer: plan author; Section 2 Code quality (observability)
Plan baseline: D6 proposal (unapproved): audit rows for every grant and revoke; add `captureMessage` to `ErrorReporter`, used only for security-relevant events (refresh reuse = warning; revoked by feature/disable/operator/password = info).
Runtime evidence: `ErrorReporter` (`observability/reporter.ts:12`) has only `captureException`; the server sends Sentry no messages or breadcrumbs today. AC5 says "Sentry and audit on grant and revoke".
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| P-D6 Sentry use | errors only | Add `captureMessage(level, message, tags)` (+ noop/Sentry adapters, scrubbed tags: reason, client trust; never tokens/ids beyond grant id); call on refresh reuse (warning) and on forced revokes (info); ordinary connect/disconnect → audit + `logger.info` only | `captureMessage` (info) on every connect and every revoke as well as reuse |
| S1–S6, Section 1 decisions | approved | unchanged | unchanged |
| P-D3, R1 | pending | pending | pending |
Question D14:
D14 — Which agent events go to Sentry?
Project/branch/task: MUT-434 OAuth sign-in for MCP clients, planned on main.
ELI10: The ticket says "Sentry and audit on grant and revoke". Every connect and disconnect is already written to the audit log. Sentry is where you get pinged about problems. If every normal connect lands in Sentry, it fills with routine noise and real alerts drown. The plan sends Sentry only the events that might mean trouble: a reused refresh token (possible theft) and forced disconnects (flag revoked, account disabled, password changed, operator).
Stakes if we pick wrong: Too much and Sentry is noise. Too little and a theft signal never pages anyone.
Recommendation: A, because Sentry should carry signals, not a usage log, and the audit already records every grant and revoke (human: ~2 h / CC: ~10 min).
Note: options differ in kind, not coverage. No completeness score.
Pros / cons:
A) Security events only (recommended)
  ✅ A refresh-reuse warning stands out in Sentry instead of hiding among routine connects
  ✅ Every grant and revoke is still fully recorded in the audit log, which satisfies traceability
  ❌ Reads AC5's "Sentry on grant" as covered by audit plus errors, which needs noting at reconcile
B) Every connect and revoke
  ✅ Matches AC5's wording literally, so reconcile has nothing to explain
  ✅ Sentry shows a timeline of agent activity next to errors
  ❌ Routine connects add Sentry noise and quota use for no alerting value
Net: Sentry for signals and audit for the record, against a literal reading of the AC.
Header: Sentry
Options:
A) Security events only (recommended)
Add captureMessage to ErrorReporter (noop + Sentry adapters, scrubbed tags); warning on refresh reuse, info on forced revokes (feature, disable, password, operator); ordinary connect/disconnect go to audit + logger.info only. Effort human ~2 h / CC ~10 min.
B) Every connect and revoke
Same captureMessage addition, also called (info) on every connect and every user revoke, plus the reuse warning. Effort human ~2 h / CC ~10 min.

State: approved
Actual answer: A) Security events only (recommended), D14 answered 2026-10-25
Accepted scope: Add captureMessage to ErrorReporter (noop + Sentry adapters, scrubbed tags); warning on refresh reuse, info on forced revokes (feature, disable, password, operator); ordinary connect/disconnect go to audit + logger.info only.
History: none

### P-D3: where Connect Claude and Connected apps live (plan §7 D3)
Finding: plan decision, reviewer: plan author; Section 2 Code quality (UI organisation)
Plan baseline: D3 proposal (unapproved): one You › Account row "Connect Claude" opening one drawer with the MCP URL (CopyField), how-tos for Claude.ai and Claude Code, and the Connected apps list with inline-confirm Revoke.
Runtime evidence: every You › Account row opens a drawer through a URL key (`YouAccount.tsx`, `AccountDrawers.tsx:24-60`, `filters.ts:299-327`); PasskeysDrawer (`PasskeysDrawer.tsx`) is the list + inline-confirm model. The ticket names "a Connect Claude page" and "Connected apps on the You page".
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| P-D3 UI placement | proposal: one drawer | One row → one `ConnectClaudeDrawer`: URL + Copy, two how-tos, Connected apps section (empty state "No apps connected yet") | Two rows → two drawers: "Connect Claude" (URL + how-tos) and "Connected apps" (list + Revoke) |
| S1–S6, P-D1/4/5a/5b/6/8 | approved | unchanged | unchanged |
| R1 | pending | pending | pending |
Question D15:
D15 — One "Connect Claude" drawer, or separate "Connect Claude" and "Connected apps" rows?
Project/branch/task: MUT-434 OAuth sign-in for MCP clients, planned on main.
ELI10: On the You page, the account section gets new rows (shown only if you have the flag). One option: a single "Connect Claude" row whose drawer shows the address to paste into Claude, short how-tos, and below them the apps you've connected with a Revoke button. The other: two rows, one to connect and one to see and revoke connections. With one agent product, one place is simpler, since you connect and disconnect in the same spot.
Stakes if we pick wrong: Two rows clutter a page Basel wants minimal. One drawer could hide revoke if it isn't clearly labelled.
Recommendation: A, because there's one agent today and Basel's You-page direction is minimal (MUT-423). The Connected apps section keeps Revoke visible right where you connected (human: ~same / CC: ~same).
Note: options differ in kind, not coverage. No completeness score.
Pros / cons:
A) One drawer (recommended)
  ✅ Connect and disconnect live in one place, with one row on a deliberately minimal You page
  ✅ One drawer, one URL key and one test file, reusing the PasskeysDrawer row pattern
  ❌ If more agent products arrive, "Connect Claude" becomes a misleading name for the list
B) Two rows, two drawers
  ✅ "Connected apps" reads as a general place, ready for non-Claude agents later
  ✅ Each drawer does one job, which suits small screens
  ❌ Two flagged rows and two drawer keys for a single-product feature
Net: one tidy place for a one-agent feature, against naming ahead for agents that don't exist yet.
Header: You page
Options:
A) One drawer (recommended)
One You › Account row "Connect Claude" (flag-gated) → ConnectClaudeDrawer with MCP URL + Copy, Claude.ai and Claude Code how-tos, and a Connected apps section with inline-confirm Revoke and an empty state.
B) Two rows, two drawers
Two flag-gated rows: "Connect Claude" → URL + how-tos drawer; "Connected apps" → list + inline-confirm Revoke drawer.

State: approved
Actual answer: A) One drawer (recommended), D15 answered 2026-10-25
Accepted scope: One You › Account row "Connect Claude" (flag-gated) → ConnectClaudeDrawer with MCP URL + Copy, Claude.ai and Claude Code how-tos, and a Connected apps section with inline-confirm Revoke and an empty state.
History: none

### Q1: log redaction keys (plan §3.6)
Finding: Section 2, P2, confidence 9/10, plan §3.6 ("add `code`, `code_verifier`, `access_token`, `refresh_token`, `client_secret` and `state` to `SENSITIVE_KEYS`"), reviewer: Claude
Plan baseline: original proposal: add bare `code` and `state` (and four token keys) to `SENSITIVE_KEYS`.
Runtime evidence: `server/src/logger.ts:12` redacts by exact key at depths 0–3: `const SENSITIVE_KEYS = ['authorization', 'cookie', … 'x-job-token'];`. `server/src/routes/billing.ts:265` logs a Stripe error code: `logger.warn({ code: err.code, type: err.type, stripeRequestId: err.requestId, requestId }, 'billing catalog unavailable; prices hidden');`. A bare `code` key would redact that, and any future error-code field, to `[redacted]`.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| Q1 redaction keys | 12 keys, no OAuth | Add only `code_verifier`, `access_token`, `refresh_token`, `client_secret`, `authorization_code`; the OAuth routes never log request bodies or query strings (codes and state never reach a logger); `logger.test.ts` adds the new keys and pins that `{ code: 'x' }` stays visible | Plan as written: also add bare `code` and `state` |
| S1–S6, all plan decisions | approved | unchanged | unchanged |
| R1 | pending | pending | pending |
Question D16:
D16 — Which log fields do we blank out for OAuth?
Project/branch/task: MUT-434 OAuth sign-in for MCP clients, planned on main.
ELI10: Our logs blank out any field with a sensitive name, like "password" or "token". The plan also adds the plain names "code" and "state" because OAuth uses them. But the billing code already logs Stripe's error as a field called "code" (billing.ts:265), and blanking it would hide why billing broke. The safer fix: blank only names that can't mean anything else (code_verifier, access_token, refresh_token, client_secret, authorization_code), and make sure the OAuth routes never log the request body at all.
Stakes if we pick wrong: Bare "code" hides real error codes in production logs. Too narrow a list could leak an OAuth code if a body ever got logged.
Recommendation: A, because it keeps billing's error codes readable and closes the leak at its source by never logging OAuth bodies (human: ~1 h / CC: ~5 min).
Completeness: A=10/10, B=6/10
Pros / cons:
A) Specific keys + no body logging (recommended)
  ✅ Billing and any future `code` fields stay readable when production breaks
  ✅ Codes and state never reach a logger, so redaction isn't the only line of defence
  ❌ Relies on OAuth routes never logging bodies, so a test must pin that
B) Add bare code and state
  ✅ Belt and braces: any field named code or state is blanked wherever it appears
  ✅ Nothing to remember about body logging
  ❌ Silently blanks billing's Stripe error code (billing.ts:265) and every future error-code field
Net: readable error codes plus no-body logging, against a blunt filter that hides real diagnostics.
Header: Log keys
Options:
A) Specific keys + no body logging (recommended)
Add code_verifier, access_token, refresh_token, client_secret, authorization_code to SENSITIVE_KEYS; OAuth routes never log bodies or query strings; logger.test.ts pins the new keys and that { code } stays visible. Effort human ~1 h / CC ~5 min.
B) Add bare code and state
Add code, state, code_verifier, access_token, refresh_token, client_secret as the plan says, accepting that billing.ts:265's Stripe code becomes [redacted]. Effort human ~30 min / CC ~5 min.

State: approved
Actual answer: A) Specific keys + no body logging (recommended), D16 answered 2026-10-25
Accepted scope: Add code_verifier, access_token, refresh_token, client_secret, authorization_code to SENSITIVE_KEYS; OAuth routes never log bodies or query strings; logger.test.ts pins the new keys and that { code } stays visible.
History: none

**Section 2 (Code quality):** findings Q1 (accepted, D16) and Q2 [P3] (confidence 7/10) plan §3.3 "deciding twice → 409": the consent page must disable Allow/Deny while a decision is in flight and, on 409, re-fetch the request and show the "already handled — start again from Claude" state. This is necessary implementation of the approved 409 contract; no new policy, so no question. Plan decisions P-D6 (D14) and P-D3 (D15) resolved.

### R1: regression contract for existing auth paths the plan changes
Finding: Section 3, CRITICAL (IRON RULE), confidence 9/10, plan §3.4–3.5 and §3.7, reviewer: Claude
Plan baseline: the plan lists new tests but no regression assertions for the existing paths it edits.
Runtime evidence: existing suites cover the paths at risk: `src/__tests__/user-features.test.ts` (MUT-433 revoke), `routes-sessions.test.ts` + `routes-password-notice.test.ts` (MUT-237/262 password change), `src/auth/__tests__/middleware.test.ts` (bearer routing), `well-known-routes.test.ts` (AASA/assetlinks mount), `portal.test.ts` + `portal-routes-coverage.test.ts` (SPA fallback), `logger.test.ts`, and the admin-users route tests (disable, revoke-sessions).
Behavior to preserve / intentional changes:
| Path | Preserve | Intentional change |
|---|---|---|
| `features.revoke` | revoke audit rows and 404-on-race (MUT-433 D1) unchanged | `agent_access` revoke also revokes grants in the same transaction |
| password change | kept session rotated, others revoked, notice mail (MUT-237/262) unchanged | grants revoked `password_changed` (D11) |
| admin disable / revoke-sessions | sessions revoked and existing response fields unchanged | grants revoked; revoke-sessions response adds a grants count (additive) (D12) |
| `/v1` authenticate | `mut_` API keys, `mds_` device tokens and cookies behave exactly as today | `mat_`/`mrt_` bearer → `PRINCIPAL_NOT_ACCEPTED` |
| `/.well-known` | AASA + assetlinks byte-identical when `appAssociation` is set, and 404 when it isn't | OAuth metadata documents always served |
| SPA fallback | every existing portal path still serves the SPA; `/v1`, `/admin`, `/jobs` excluded as today | `/oauth/*`, `/mcp` excluded; `/connect/approve` served by the SPA |
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 coverage form | none planned | Extend each existing suite above with named assertions for its "preserve" and "intentional change" columns (no new regression file) | One new `src/__tests__/oauth-regression.test.ts` asserting all rows |
| all prior choices | approved | unchanged | unchanged |
Question D17:
D17 — Where do the regression checks for the existing sign-in paths go?
Project/branch/task: MUT-434 OAuth sign-in for MCP clients, planned on main.
ELI10: This ticket edits code that already works: feature revoke, password change, operator sign-out, how the API reads bearer tokens, the /.well-known files the phone app needs, and which paths the portal serves. Each needs a test proving today's behavior survives, plus the intended new behavior. That's required either way. The only question is where those tests live: in each existing test file next to the behavior they protect, or gathered in one new file.
Stakes if we pick wrong: Scattered tests are easy to find per behavior. One file makes the ticket's blast radius visible in one place but drifts from the code it guards.
Recommendation: A, because a regression assertion belongs next to the behavior it guards, where the next person editing that path will see it (human: ~4 h / CC: ~20 min).
Note: options differ in kind, not coverage. Both assert every row in the table; no completeness score.
Pros / cons:
A) Extend existing suites (recommended)
  ✅ Each assertion sits beside the behavior it protects, so future edits there trip it
  ✅ Reuses each suite's fixtures, with no new harness to build
  ❌ The ticket's regression surface is spread over about seven files, so review has to collect it
B) One regression file
  ✅ The whole blast radius of MUT-434 reads in one place at review time
  ✅ Easy to point qa-reconcile at a single file
  ❌ Duplicates fixtures from seven suites and drifts away from the code it guards
Net: same assertions; A keeps them where future editors will trip over them.
Header: Regression
Options:
A) Extend existing suites (recommended)
Add named preserve + intentional-change assertions to user-features, routes-sessions, routes-password-notice, middleware, well-known-routes, portal / portal-routes-coverage, logger and the admin-users route tests. Effort human ~4 h / CC ~20 min.
B) One regression file
Create src/__tests__/oauth-regression.test.ts covering every row of the table with its own fixtures. Effort human ~4 h / CC ~20 min.

State: approved
Actual answer: A) Extend existing suites (recommended), D17 answered 2026-10-25
Accepted scope: Add named preserve + intentional-change assertions to user-features, routes-sessions, routes-password-notice, middleware, well-known-routes, portal / portal-routes-coverage, logger and the admin-users route tests, one per row of the R1 table.
History: none

**Section 3 (Tests): coverage diagram** (proposed code, all paths new; ★ ratings are for the planned tests)

```
CODE PATHS                                                   USER FLOWS
[+] oauth/protocol.ts                                        [+] Connect from Claude.ai / Claude Code
  ├── PKCE S256 verify ── [★★★ PLANNED] RFC 7636 vector + bad    ├── [★★★ PLANNED] approve → code → token → /mcp initialize
  ├── redirect rules ──── [★★★ PLANNED] https/loopback/any-port,  │     (oauth-flow.test.ts + live portal-selfservice spec) [→E2E]
  │                        lookalike hosts (S6)                   ├── [MANUAL] real Claude.ai + Claude Code hand checks
  ├── DCR validation ──── [★★★ PLANNED] caps, auth method, bidi   ├── [★★★ PLANNED] no flag → refusal page → access_denied
  └── discovery ───────── [★★  PLANNED] metadata shape, iss flag  ├── [★★★ PLANNED] expired/used request → "start again"
[+] oauth/trust.ts                                               ├── [★★  PLANNED] double-click Allow → 409 → "already handled"
  ├── verdict ─────────── [★★★ PLANNED] claude.ai/.com, loopback,  └── [★★  PLANNED] local mode → /sign-in?next=… (query kept)
  │                        unverified                         [+] You › Connect Claude
  └── CIMD fetch ──────── [★★★ PLANNED] every SSRF rejection via   ├── [★★  PLANNED] row hidden without flag
                           injected lookup/request (S1)           ├── [★★  PLANNED] URL shown, Copy copies
[+] oauth/service.ts                                             ├── [★★★ PLANNED] revoke inline confirm → gone → next /mcp 401
  ├── authorize ───────── [★★★ PLANNED] bad client/redirect →      └── [★★  PLANNED] empty state
  │                        portal error page, never a redirect   [+] Error states
  ├── decide ──────────── [★★★ PLANNED] approve/deny/409/no flag   ├── [★★★ PLANNED] each /connect/approve?error= code renders
  ├── exchangeCode ────── [★★★ PLANNED] verifier, redirect,        └── [★★  PLANNED] 429 on register/authorize/token
  │                        resource (S2a), reuse, race (S4)
  ├── refresh ─────────── [★★★ PLANNED] rotate, grace, superseded → revoke (S5), race (S4)
  └── revoke* ─────────── [★★★ PLANNED] user, feature, disable, password, operator
[+] auth/agent-auth.ts ── [★★★ PLANNED] no/bad token 401 + WWW-Authenticate, audience,
                           disabled, closing 403, flag 403 uncached, rate limit
[+] routes/mcp.ts ─────── [★★  PLANNED] initialize/ping/tools/list empty [→E2E via flow test]
[~] regression (R1) ───── [★★★ PLANNED] seven existing suites extended

COVERAGE (planned): 34/35 paths with ★★+ tests; 1 manual (real-client hand checks)
GAPS: 0 automated gaps after D2–D17; manual hand checks owed before release
```

Test value cards (critical paths):
- Value: protects=a code or refresh token mints exactly one chain; fails_when=the 1-row-changed check is dropped; why_new=no OAuth today; seam=none; no_claim=multi-instance timing beyond Postgres row semantics (test:db)
- Value: protects=superseded refresh token revokes the grant; fails_when=grace re-issue stops marking superseded; why_new=new rule (D7); seam=none (clock injected via service now); no_claim=none beyond protects
- Value: protects=CIMD fetch refuses private IPs/redirects/oversize; fails_when=a guard is removed; why_new=new outbound fetch; seam=injected lookup/request (Malafat's pattern, production passes none); no_claim=real DNS rebinding timing
- Value: protects=revoke ends access on the next call; fails_when=validation caches the grant; why_new=new principal; seam=none; no_claim=none beyond protects

Tests made obsolete: none. Section 3 dispositions: R1 accepted (D17); every other test requirement is required proof of approved choices.

**Section 4 (Performance):** no issues found. Per `/mcp` call: one indexed token-digest lookup joined to grant/client/user, one `user_feature_grants` read (uncached by design, MUT-433 D6), a once-a-minute `lastUsedAt` touch. Scale: one flagged user today; per-call cost is constant in data size. CIMD fetches are bounded (5 s, 10 KB, 24 h cache per instance, authorize rate limit 30/min/IP). Nightly cleanup bounds table growth. No loops over unbounded queries.

## Outside voice (Claude Plan subagent, native fallback: Codex CLI not installed; completed inside the 5-minute window)

Findings (verbatim summary): 1 High: grace + conditional claim lets one honest client's concurrent refreshes revoke its own grant. 2 High: CIMD approved but no storage model behind the client foreign keys. 3 Medium: one live grant per (user, client) clashes with CIMD. 4 Medium: no canonical form for `resource`. 5 Medium: deleting DCR clients strands connectors; FK onDelete unstated. 6 Medium: CIMD path unexercised by the live spec; hand checks don't record which path ran. 7 Medium: 10-minute request may expire during sign-in. 8 Low: /mcp refusals lack a pinned WWW-Authenticate answer. 9 Low: SDK/zod v4 compatibility unchecked; GET /mcp undefined. 10 Low: AC7 couples features repo to OAuth tables, unstated. 11 Low (strategic): defer CIMD. Recommendation: revise before building because of 1 and 2.

Parent verification: 1 confirmed by tracing S4's loser path into S5's grace re-issue (the same client keeps either response). 2 confirmed: §3.2 FKs `clientId` → `oauth_clients.id` (`mcl_…`) with CIMD clients only in an in-memory cache. 3–10 plausible as stated. 11 reopens S1 (D2) on new cost evidence.

### OV11: keep CIMD in this ticket (reopens S1)
Finding: outside voice 11, Low/strategic, plan ledger S1 (D2); reviewer: Claude Plan subagent
Plan baseline: S1 approved A (DCR + CIMD), D2.
Runtime evidence: outside voice findings 2, 3 and 6 are CIMD costs D2 didn't price (storage model, multi-grant keying, live-spec coverage). Spec 2026-07-28 keeps CIMD at SHOULD and DCR at MAY (deprecated); Claude supports both today.
Comparison grid:
| Choice | Current | A Include | B Defer | C Cut | D Hold |
|---|---|---|---|---|---|
| CIMD in MUT-434 | included (D2) | stays, and OV2/OV3/OV6 are asked next | moved to a follow-up ticket; DCR only now; OV2/OV3/OV6 become follow-up scope | dropped, DCR only, no follow-up | stop and discuss |
| all other approvals | approved | unchanged | unchanged | unchanged | unchanged |
Question D18:
D18 — Keep CIMD in this ticket now that its full cost is visible?
Project/branch/task: MUT-434 OAuth sign-in for MCP clients, planned on main.
ELI10: You approved supporting both ways Claude can register (the old form-post and the newer web-address way, CIMD). The second reviewer found that CIMD needs more than I priced: its own row in the clients table, a decision on how many connections one client may hold, and its own live test. That's maybe another 30 CC minutes. Deferring it keeps this ticket smaller, and Claude still works through the old way today.
Stakes if we pick wrong: Include adds work to an already large ticket. Defer means a second auth ticket later, touching the same tables again.
Recommendation: A, because the spec recommends CIMD, the extra storage work is small and one-time, and doing it now avoids a second migration on these tables (human: ~1 day more / CC: ~30 min more).
Note: options differ in kind, not coverage; no completeness score.
Pros / cons:
A) Include (recommended)
  ✅ Meets the spec's recommended path in the same migration, so the clients table is designed once
  ✅ The CIMD storage fix (OV2) also gives a shared cache across instances
  ❌ The ticket grows again: one more column set, a keying decision and one more live-spec case
B) Defer
  ✅ A smaller first ticket; DCR alone proves AC1 with both clients today
  ✅ OV2/OV3/OV6 move out of the critical path
  ❌ A second auth migration and review later, on tables that will hold live grants by then
C) Cut
  ✅ Smallest possible scope; no outbound fetch ever
  ✅ Nothing to maintain for a path no client needs today
  ❌ Builds only the deprecated path, with no plan to leave it
D) Hold
  ✅ Lets us talk through the trade-off before committing either way
  ✅ No other choices change while held
  ❌ The remaining outside-voice questions about CIMD wait
Net: about 30 more CC minutes now, against a second migration on live tables later.
Header: CIMD scope
Options:
A) Include (recommended)
Keep CIMD in MUT-434 (D2 stands); the next questions settle its storage (OV2), grant keying (OV3) and live-spec case (OV6).
B) Defer
Move CIMD to a follow-up ticket; MUT-434 ships DCR only; OV2/OV3/OV6 become that ticket's scope.
C) Cut
Drop CIMD with no follow-up; DCR only.
D) Hold
Stop here and discuss CIMD before deciding.

State: approved
Actual answer: A) Include (recommended), D18 answered 2026-10-25
Accepted scope: Keep CIMD in MUT-434 (D2 stands); OV2/OV3/OV6 settle its storage, grant keying and live-spec case.
History: S1 approved A (D2) on 2026-10-25; reopened for the costs outside voice found.

### OV1: concurrent refresh by one honest client (reopens S5; refines S4's loser path)
Finding: outside voice 1, High, confidence 8/10 (parent-verified by trace), ledger S4 (D6) + S5 (D7); reviewer: Claude Plan subagent
Plan baseline: S4 approved A (conditional claim; loser → reuse path). S5 approved A (grace re-issue marks the winner's successor `superseded`; a superseded token presented later revokes the grant).
Runtime evidence: the same client firing two refreshes at once: the winner mints S1; the loser (inside 30 s, S1 unused) supersedes S1 and mints S2; if the client stores S1, its next refresh presents a superseded token → grant revoked + false theft alert. Tokens are stored as digests only, so the server can't hand back S1's plaintext to the loser.
Comparison grid:
| Choice | Current | A Apply | B Keep | C Investigate | D Defer |
|---|---|---|---|---|---|
| OV1 rotation under retry/race | S5: grace re-issue supersedes the successor | **Idempotent rotation:** the successor pair is derived, not random: `token = prefix + base64url(HMAC(OAUTH_DERIVE_KEY, parentPlaintext ∥ successorId))`, with `successorId` stored on the parent at claim. Any re-presentation of the parent within 30 s re-derives and returns the **identical** pair (no new chain, nothing superseded). After 30 s, re-presentation → revoke grant (`refresh_reuse`). The `superseded` state from S5 is removed. Tests: concurrent pair returns identical tokens; thief-in-window shares the chain and is cut at the next rotation; after-window reuse revokes | S5 as approved | Spend ≤ 30 min checking how Claude.ai/Claude Code retry refreshes; S5 stays approved meanwhile | leave OV1 unresolved for the build |
| S4 conditional claim | approved A | unchanged (still decides the one winner that writes `successorId`) | unchanged | unchanged | unchanged |
| all other approvals | approved | unchanged | unchanged | unchanged | unchanged |
Question D19:
D19 — Make refresh retries return the same tokens instead of new ones?
Project/branch/task: MUT-434 OAuth sign-in for MCP clients, planned on main.
ELI10: The second reviewer found a flaw in the rule you approved in D7. If Claude sends the same refresh twice at once (common with parallel tool calls), the second request cancels the first one's new token and hands out another. If Claude kept the cancelled one, its next refresh looks like theft, and we disconnect you and raise a false alarm. The fix: make the renewed token computable from the old one plus a server secret, so a retry within 30 seconds gets exactly the same token back. Nothing is cancelled, races are harmless, and a thief who replays in the window just shares the chain that dies at the next renewal. Reuse after 30 seconds still kills the grant.
Stakes if we pick wrong: Keeping D7 as-is means honest users get randomly disconnected, with false theft alerts.
Recommendation: A, because it removes the self-disconnect and keeps theft detection, with one less token state to track (human: ~4 h / CC: ~20 min).
Completeness: A=10/10, B=5/10, C=6/10, D=4/10
Pros / cons:
A) Apply: idempotent rotation (recommended)
  ✅ Concurrent or retried refreshes get identical tokens, so no honest client can revoke itself
  ✅ Simpler state: the superseded status and its special case disappear
  ❌ Needs one more server secret (OAUTH_DERIVE_KEY) in config, rotation docs and before-release steps
B) Keep S5 as approved
  ✅ No change to an approved design; random tokens throughout
  ✅ Thief-in-window still detected when the real client returns
  ❌ About half of concurrent refreshes disconnect an honest user and fire a false Sentry theft warning
C) Investigate client retry behavior first
  ✅ Learns whether Claude actually sends parallel refreshes before changing anything
  ✅ Bounded to 30 minutes; S5 stays approved meanwhile
  ❌ Client behavior can change at any time, so a "no" today still leaves the race open
D) Defer
  ✅ Build proceeds on the approved design now
  ✅ Can be revisited after the first hand checks
  ❌ Ships a known self-disconnect bug into an auth server
Net: one derived-token rule fixes the race and simplifies the state machine.
Header: Rotation
Options:
A) Apply: idempotent rotation (recommended)
Successor pair derived via HMAC(OAUTH_DERIVE_KEY, parentPlaintext ∥ successorId); re-presentation within 30 s returns the identical pair; after 30 s → revoke grant (refresh_reuse) + Sentry warning; S5's superseded state removed; race, thief-in-window and after-window tests. Effort human ~4 h / CC ~20 min.
B) Keep S5 as approved
Keep the grace re-issue that supersedes the successor and revokes on its later presentation (D7).
C) Investigate client retry behavior first
Up to 30 minutes reading Claude.ai/Claude Code refresh behavior; S5 stays approved; return with findings.
D) Defer
Leave OV1 unresolved; build on S5 as approved and revisit later.

State: approved
Actual answer: A) Apply: idempotent rotation (recommended), D19 answered 2026-10-25 (supersedes S5's superseded-state design; S5's intent — a raced theft dies — is kept)
Accepted scope: Successor pair derived via HMAC(OAUTH_DERIVE_KEY, parentPlaintext ∥ successorId); re-presentation within 30 s returns the identical pair; after 30 s → revoke grant (refresh_reuse) + Sentry warning; S5's superseded state removed; race, thief-in-window and after-window tests. OAUTH_DERIVE_KEY is a new required secret (config.ts validation, Secret Manager, before-release.md).
History: S5 approved A (D7); reopened on outside-voice finding 1.

### OV2: storage for CIMD clients
Finding: outside voice 2, High, confidence 9/10 (parent-verified: plan §3.2 `oauth_clients.id` "`mcl_…`" with FKs from requests, grants and codes; S1's accepted scope caches CIMD metadata "up to 24 h" in memory), reviewer: Claude Plan subagent
Plan baseline: §3.2 as written + S1 accepted scope (in-memory cache).
Runtime evidence: CIMD client_ids are https URLs with no `oauth_clients` row, so the FKs have nothing to point at; an in-memory cache is per Cloud Run instance.
Comparison grid:
| Choice | Current | A Apply | B Keep | C Investigate | D Defer |
|---|---|---|---|---|---|
| OV2 CIMD storage | in-memory only, no row | `oauth_clients.id` becomes text (`mcl_…` for DCR, the URL for CIMD); add `kind DCR\|CIMD`, `metadataFetchedAt`, `metadataExpiresAt` (from cache headers, capped at 24 h); a CIMD client is upserted on first authorize and re-fetched when expired; the DB row replaces the in-memory cache | as written | ≤ 30 min sketching alternatives (separate `oauth_cimd_clients` table) | unresolved |
| all other approvals | approved | unchanged | unchanged | unchanged | unchanged |
Question D20:
D20 — Store CIMD clients as rows in the same clients table?
Project/branch/task: MUT-434 OAuth sign-in for MCP clients, planned on main.
ELI10: When Claude registers the new way, its ID is a web address, and the plan only keeps what it fetched in memory for a day. But connections, sign-in requests and codes all point at a row in the clients table, and a web-address client has no row. The fix: give it a row too, with the address as its ID, a type (old-style or web-address), and when we last fetched its details. Every server instance then shares the same cached copy instead of each fetching on its own.
Stakes if we pick wrong: Without rows, the first CIMD sign-in fails on a database constraint.
Recommendation: A, because one table with a kind column keeps every foreign key simple, and the cache becomes shared and durable (human: ~3 h / CC: ~15 min).
Completeness: A=10/10, B=2/10, C=5/10, D=2/10
Pros / cons:
A) Apply: rows with kind + fetch times (recommended)
  ✅ Every FK points at one table whichever way the client registered
  ✅ The metadata cache is shared across Cloud Run instances and survives restarts
  ❌ The client id column holds both short ids and URLs, so it needs a length cap and tests
B) Keep as written
  ✅ No schema change from the plan
  ✅ Nothing new to migrate
  ❌ The first CIMD authorization breaks on a foreign key
C) Investigate a separate table
  ✅ Might keep URL ids out of the DCR table
  ✅ Bounded to 30 minutes
  ❌ Two client tables means two FK targets or a polymorphic key everywhere
D) Defer
  ✅ No change now
  ✅ Build can start on DCR parts
  ❌ CIMD, which you just kept in scope, can't work until this is decided
Net: one table, one FK target, a shared cache.
Header: CIMD rows
Options:
A) Apply: rows with kind + fetch times (recommended)
oauth_clients.id text (mcl_… or the URL, capped at 2048), kind DCR|CIMD, metadataFetchedAt, metadataExpiresAt (cache headers, ≤ 24 h); CIMD clients upserted on first authorize, re-fetched when expired; replaces the in-memory cache. Effort human ~3 h / CC ~15 min.
B) Keep as written
mcl_ ids only, CIMD metadata in memory; FKs unchanged.
C) Investigate a separate table
Up to 30 minutes sketching a separate CIMD clients table; return with a recommendation.
D) Defer
Leave CIMD storage unresolved for now.

State: approved
Actual answer: A) Apply: rows with kind + fetch times (recommended), Basel "go" 2026-10-25 (accepting all listed recommendations)
Accepted scope: oauth_clients.id text (mcl_… or the URL, capped at 2048), kind DCR|CIMD, metadataFetchedAt, metadataExpiresAt (cache headers, ≤ 24 h); CIMD clients upserted on first authorize, re-fetched when expired; replaces the in-memory cache.
History: none

### OV3–OV10: remaining outside-voice items (batched at Basel's request)
Basel asked to stop the one-at-a-time questions ("this has been going on too long") and accepted all eight listed recommendations with "go" (2026-10-25). Each row is its own approved choice; option A = Apply in the four-option menu.

| ID | Finding (outside voice #, severity) | Approved change (State: approved, answer: "go") |
|---|---|---|
| OV3 | 3, Medium: one live grant per (user, client) clashes with CIMD | Allow several live grants per client; no `replaced` revoke on re-consent; each grant listed separately in Connected apps |
| OV4 | 4, Medium: no canonical `resource` form | Normalise before comparing: lowercase scheme and host, drop default port, strip one trailing slash, no fragment; tests for each variant |
| OV5 | 5, Medium: deleting DCR clients strands connectors | Never delete a client that ever had a grant; GC only never-used clients after 30 d; grant → client FK `onDelete: Restrict` |
| OV6 | 6, Medium: CIMD path unexercised | Live portal-selfservice spec gains a CIMD case (static metadata document served on loopback for the test); hand checks record which registration path Claude.ai and Claude Code used |
| OV7 | 7, Medium: request may expire during sign-in | Authorization request lifetime 30 min (was 10) |
| OV8 | 8, Low: /mcp refusals unpinned | `FEATURE_NOT_ENABLED` and closing refusals answer 403 with the JSON envelope and `WWW-Authenticate: Bearer error="invalid_token"`-free headers (no `scope`, no `insufficient_scope`), so clients don't loop into step-up; tests pin headers and body |
| OV9 | 9, Low: SDK compatibility | Before building, confirm the pinned `@modelcontextprotocol/sdk` version works with zod 4.6.5 and exports `WebStandardStreamableHTTPServerTransport` (one zod copy in the lockfile); GET `/mcp` answers 405 in stateless JSON mode |
| OV10 | 10, Low: AC7 coupling unstated | Stated decision: `features.revoke('agent_access')` calls the OAuth repository's `revokeAllForUser` inside the same store transaction (memory and Prisma); recorded in ADR-197 and PATTERNS |

**Cross-model tension:** the outside voice and the native review agreed on the plan's direction; it found two High gaps the native review missed (OV1, OV2), both now fixed. No remaining disagreement.

## Approved changes to the plan (consolidated; these override §1–§8 above)

- **Structure (D1):** `server/src/oauth/` = `protocol.ts`, `trust.ts`, `service.ts`; `/oauth/authorize` errors redirect to `/connect/approve?error=<code>`; no server HTML.
- **Registration (D2, D18, OV2):** DCR + CIMD; CIMD fetched with Malafat's SSRF guards; CIMD clients are rows in `oauth_clients` (`kind`, `metadataFetchedAt`, `metadataExpiresAt`); `client_id_metadata_document_supported: true`.
- **Audience (D3, OV4):** `resource` stored on request, grant and tokens, normalised; mismatch → `invalid_target`; absent → default `<origin>/mcp`; `/mcp` checks audience.
- **Issuer (D4):** `iss` on every authorize redirect; `authorization_response_iss_parameter_supported: true`.
- **Scopes (D5):** advertise and default `read write`; ADR-197 records the deviation from minimal `scopes_supported`.
- **Single use (D6):** conditional claims for codes and refresh tokens; race tests on memory and `test:db`.
- **Rotation (D19, replaces D7's superseded state):** idempotent rotation with `OAUTH_DERIVE_KEY`; identical pair within 30 s; reuse after 30 s revokes the grant + Sentry warning.
- **Loopback (D8):** any port on `127.0.0.1`/`[::1]`/`localhost`, exact scheme/host/path.
- **Build (D9):** hand-rolled, no OAuth library. **Tools (D10):** none in 434.
- **Revocation (D11, D12):** password change and operator revoke-sessions also revoke grants.
- **Lifetimes (D13, OV7):** code 60 s, request **30 min**, access 1 h, refresh 45 d idle, grant 180 d absolute.
- **Sentry (D14):** `captureMessage` for refresh reuse (warning) and forced revokes (info) only.
- **UI (D15):** one You › Account "Connect Claude" drawer with URL, how-tos and Connected apps.
- **Logs (D16):** redact only `code_verifier`, `access_token`, `refresh_token`, `client_secret`, `authorization_code`; OAuth routes never log bodies.
- **Regression (D17):** named preserve/change assertions in seven existing suites.
- **Grants (OV3):** several live grants per client. **Clients (OV5):** never delete a client that had a grant; FK Restrict.
- **QA (OV6):** live CIMD case; hand checks record the registration path. **Refusals (OV8):** pinned 403 shape. **SDK (OV9):** compatibility check first; GET `/mcp` 405. **AC7 wiring (OV10):** same-transaction revoke, documented.
- **Consent page (Q2):** buttons disabled while deciding; 409 → "already handled".

Approval readiness: PASS — S1(D2), S2a(D3), S2b(D4), S3(D5), S4(D6), S5→OV1(D7→D19), S6(D8), P-D1(D9), P-D4(D10), P-D5a(D11), P-D5b(D12), P-D8(D13), P-D6(D14), P-D3(D15), Q1(D16), R1(D17), OV11(D18), OV2–OV10 (Basel "go", 2026-10-25).
