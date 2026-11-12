# MUT-593 plan: Malafat calls /v1 as the person, with a tenant-bound delegated token

**Ticket:** MUT-593 (Backlog), ticket 1 of epic MUT-592, blocks MUT-594, MUT-595, MUT-598 and MAL-1541. No blockers.
**Brief:** `.claude/designs/malafat-delegated-access.md` §4.1, §4.2, §4.7, §4.8, §5, §7. **ADR:** ADR-254, already on main as a design ADR. This ticket adds a "Built" note to it. See R1 about the number.
**Server only.** The portal (MUT-596), phone (MUT-597), member sync and owner rule (MUT-594), Sign in with Malafat (MUT-595) and `/mcp` for the confidential client (MUT-598) are other tickets.

## 0. What exists today (code map, verified)

| Concern | Where |
|---|---|
| `authenticate()`: refuses OAuth bearers on /v1 | `server/src/auth/middleware.ts:190`, refusal at `:204` |
| Route principals come from OpenAPI `security` | `buildRouteAccessIndex` `middleware.ts:126`; `Principal` `auth/writability.ts:20` |
| Profile selection and scopes | `selectProfile` `middleware.ts:425`; `sessionScopesFor` `writability.ts:111`; `profileWriterOf` `:182` |
| Agent bearer auth (the model to copy) | `auth/agent-auth.ts:38` (live grant, user ACTIVE, not closing, feature, rate limits, touch) |
| Authorization server | `oauth/service.ts`: public clients only, `token()` `:203` takes no client authentication, resource pinned to `/mcp` at `:69`, `:139`, `:225`, `:251`, `:301`; rotation and reuse `:243-288` |
| OAuth models | `prisma/schema.prisma`: `OAuthClientKind {DCR,CIMD}` `:1747`, `OAuthClient` `:1754`, `OAuthGrant` `:1798`, `OAuthToken` `:1849` |
| Integration | `Integration` `schema.prisma:632`, `@@unique([provider, externalTenantId])`, so one tenant maps to exactly one organization; routes in `routes/integration.ts` |
| Grant revocation | password `prisma.ts:510`/`:3665`; operator disable and sign-out `operator/actions/accounts.ts:116-155`; feature revoke `operator/actions/features.ts:90` |
| Agent grants list and revoke | `routes/oauth-consent.ts:126`, `:149` (gated by `agent_access`) |
| Audit actor | `actorOf` `middleware.ts:604` |
| Env switch pattern | `ACCOUNTANT_ACCESS` `config.ts:176` → `app.ts:359`; dark-launch 404 table `app.ts:420-430` |
| Per-organization operator action | `POST /v1/operator/firm-requests/{id}/enable` `routes/operator.ts:519` → `operator/actions/firms.ts:93` |
| Contract version | `API_VERSION = '1.108.0-mut565'` `app.ts:348`; pinned in `__tests__/routes-m6.test.ts:343` and `__tests__/payments-correct.test.ts:338` |
| JWT library | `jose` is only a transitive dependency (6.2.13 via the MCP SDK). It must be added as a direct dependency. |

**Simplification the code allows.** `Integration` is unique on `(provider, externalTenantId)`, so a tenant names exactly one profile. The tenant binding becomes one check: the selected profile id must equal the tenant's organization id. That id is resolved once in `authenticate()` from an indexed read.

## 1. Design

### 1.1 Data (one migration, `mut593_delegated_access`)
- `OAuthClientKind += CONFIDENTIAL`.
- `OAuthClient`: `jwksUri String?`, `tokenEndpointAuthMethod String @default("none")` (`none` | `private_key_jwt`), `allowedResources String[]`, `disabledAt DateTime?`.
- `OAuthAuthorizationRequest.tenantId String?` and `OAuthGrant.tenantId String?`, with `@@index([tenantId])` and `@@index([clientId])` on `OAuthGrant`.
- New `OAuthClientAssertion { jti, clientId, expiresAt }` with `@@unique([clientId, jti])`. This is the single-use store for `jti` (Cloud Run runs several instances, so memory is not enough). Expired rows are swept by the existing OAuth cleanup, or lazily on insert.
- `Integration.delegationEnabledAt DateTime?` and `delegationEnabledBy String?`. This is the per-firm switch.
- New `OAuthGrantRevokedReason` values: `integration_disconnected`, `delegation_disabled`, `client_disabled`, `member_removed`. A person's own revoke reuses `user_revoked`.
- **Merging this migration restarts the shared local API.** Tell the orchestrator before merging (memory: warn before merging a migration).

### 1.2 Confidential client (`server/src/oauth/`)
- New `client-assertion.ts`: `verifyClientAssertion(assertion, client, { tokenEndpoint, now, store, fetchJwks })` per RFC 7523.
  - `iss = sub = client_id`.
  - `aud` must be the token endpoint or the issuer.
  - `exp` at most 5 minutes ahead; `iat` and `nbf` are honoured.
  - `jti` must be single-use (insert into `OAuthClientAssertion`; a unique conflict means `invalid_client`).
  - Algorithms are limited to `RS256`, `PS256` and `ES256`; no `none`, no `HS*`.
  - Uses `jose` `createRemoteJWKSet` with a 10-minute cache, a refetch on an unknown `kid`, a 5 s timeout, and an https-only, SSRF-guarded fetch reusing `trust.ts`'s CIMD fetch guards.
- `protocol.ts`: add `v1ResourceUrl(issuer)` beside `mcpResourceUrl`.
- `service.ts`:
  - The single `this.resource` becomes `allowedResourcesFor(client)`. A public client (DCR or CIMD) keeps `[mcp]`, so today's behaviour is unchanged. A confidential client gets `client.allowedResources`, which is `[v1]` here; MUT-598 adds `mcp`.
  - `authorize`: accepts `resource=<origin>/v1` for a confidential client only, and records `tenant` (custom parameter `malafat_tenant`, required for a confidential client) on the request.
  - Consent (`oauth-consent.ts` decide) refuses with `access_denied` unless all of these hold: the global switch is on, the tenant's integration is CONNECTED, delegation is enabled for it, and the person is a member of that organization. The grant is created with `tenantId`. There is at most one live grant per (user, client, tenant); a new consent revokes the previous one with reason `superseded`, reusing the existing reason if there is one.
  - `token()`: a confidential client **must** send `client_assertion_type=…jwt-bearer` plus `client_assertion`, on both `authorization_code` and `refresh_token`. A public client must not. A client that is disabled or has `MALAFAT_DELEGATION` off answers `invalid_client`. Rotation and reuse detection are unchanged (ADR-197 §5): a reused refresh token revokes the grant.
  - `authenticateAccess(token, now, expectedResource)`: the resource becomes a parameter. `/mcp` passes `mcp`, so a `/v1` token is refused there automatically; `/v1` passes `v1`.
- `DCR` (`/oauth/register`) can never create a CONFIDENTIAL client. A test guards this.
- Registration and disable are done through an operator script, `server/src/scripts/oauth-confidential-client.ts`, with `register --name --jwks-uri --resource v1` and `disable --client-id`. Disabling revokes every grant of the client in one transaction. The steps go in `docs/operations/before-release.md`.

### 1.3 The `delegated` principal (`server/src/auth/`)
- `writability.ts`: `Principal = 'apiKey' | 'session' | 'delegated'`. `buildRouteAccessIndex` maps a `delegated` security requirement to `delegated`.
- New `delegated-auth.ts`, `authenticateDelegated(c, bearer, options)`. It reuses the person checks shared with `agent-auth.ts`, extracted into `grantPerson()` so they are not copied:
  1. `MALAFAT_DELEGATION` is on.
  2. `authenticateAccess(bearer, now, v1)` succeeds.
  3. The client is CONFIDENTIAL and not disabled.
  4. The user is ACTIVE and not closing.
  5. `findByProviderAndTenant(MALAFAT, grant.tenantId)` is CONNECTED with `delegationEnabledAt` set.
  6. It returns `SessionIdentity` plus `via: { clientId, tenantId, organizationId }`.
  
  If any check fails, the answer is 401 UNAUTHENTICATED (`reason: delegation_ended`), so Malafat knows to reconnect.
- `authenticate()` at `:204`: an OAuth bearer goes to `authenticateDelegated`. If the route does not declare `delegated`, the answer is `principalNotAccepted()` (403 today, see R2). After that it runs the **existing** `finishSessionAuth` path: `selectProfile`, `sessionScopesFor`, store guard, billing gate, features. No per-feature code.
- `selectProfile`: when `identity.via` is set, the named profile must equal `via.organizationId` and the person must hold a membership there. Otherwise the answer is the uniform 404 PROFILE_NOT_FOUND, the same as not being a member. The accountant fallback (`namedClient`) is skipped under `via`.
- Rate limits: `delegated:<grantId>` and `delegated-user:<userId>` with the session's per-minute limit. Keys use the organization key's own limits, unchanged.
- **Audit `via`.** `actorOf` stays `USER` and the person's id. A request-scoped `auditVia` is set by `authenticateDelegated`, and the delegated store guard decorates every `AuditEventInput` that passes through it (`audit.append` and transaction `audit` arrays) with `metadata.via = 'malafat'`. Because this is done in one place, no route has to remember it. Fallback if the guard cannot see transaction audits: stamp in the two audit writers (memory and Prisma) from the same request context. Decide this during the build with the test in §2.

### 1.4 Routes and contract
- Register an OpenAPI security scheme, `delegated` (http bearer, description "Malafat acting as the person; tenant-bound"), at `app.ts:761-797`.
- A shared constant, `PERSON_OR_MALAFAT = [{ session: [] }, { deviceSession: [] }, { delegated: [] }]`, goes in a shared `routes/security.ts` beside `OWN`.
- **Opt in the brief's §4.5 list in this ticket** so Malafat's generated client (MAL-1541) has the full contract: expenses, receipts (upload, read, review, move), expense groups, vendors, conversions, capture (money received), approvals, month close, accountant access, share links, period downloads, summaries and the feed. Legal-ledger routes stay `apiKey` plus session as they are, because Malafat already has them through its key.
- `/v1/me` opts in. Under `via`, `buildMe` lists only `via.organizationId` and omits `clients`, `clientBooks`, `operator` and `billingStanding` (the person's own billing).
- **Never** delegated: `/v1/me/password`, passkeys, `/v1/sessions*`, device sessions, account closure and purge, billing checkout and portal, `/v1/oauth/*` and consent, `/v1/me/connected-apps`, operator and admin, records export. This is enforced by a test in `route-security.test.ts` that matches these path prefixes against `delegated` in the contract, so a later opt-in by mistake fails CI.
- New, session only:
  - `GET /v1/me/connected-apps` returns live CONFIDENTIAL-client grants: `{ grantId, clientName, tenantDisplayName, scopes, createdAt, lastUsedAt }`. Agent grants stay at `/v1/oauth/grants` (R5).
  - `DELETE /v1/me/connected-apps/{grantId}` revokes every live grant of that user, client and tenant (`user_revoked`). It is audited as `user.connected_app_revoked`. It answers 404 if the grant is not theirs.
- New operator route: `POST /v1/operator/organizations/{id}/malafat-delegation` `{ enabled }`. It uses `operatorGate` with passkey step-up and is audited ADMIN `organization.malafat_delegation_enabled|disabled`. Turning it off revokes the tenant's grants (`delegation_disabled`). It refuses with 409 `NOT_MALAFAT_FED` if the organization has no CONNECTED integration.
- Dark launch: with `MALAFAT_DELEGATION=false`, the connected-apps routes and the operator route answer 404 (`app.ts:420` table), and the token endpoint refuses confidential clients.
- `config.ts`: `MALAFAT_DELEGATION: z.enum(['true','false']).default('false')`. It is on in `.env.example` for dev and in the QA live API env.
- Contract: `API_VERSION = '1.109.0-mut593'`, the two pinned tests, and `npm --prefix server run openapi:check`.

### 1.5 Revocation table (§4.7)

Each row is enforced twice: a revoke in the same transaction as the event, so a later re-enable does not bring the tokens back, and a per-call check, so the next call fails even if the revoke is missed.

| Event | Revoke (in the event's transaction) | Per-call check that also ends it |
|---|---|---|
| Person revokes in Connected apps | `user_revoked` for (user, client, tenant) | grant not live |
| Member removed (today's member-removal route; MUT-594's sync reuses the same helper) | `member_removed` for (user, tenant) | membership check in `selectProfile` |
| `/v1/integration/disconnect` | `integration_disconnected` for the tenant | integration not CONNECTED |
| Password change, operator sign-out-everywhere, operator disable (DF2) | existing all-grants revoke. Verify it is not filtered to `/mcp`; extend it if it is. | grant not live, user not ACTIVE |
| Per-firm switch off | `delegation_disabled` for the tenant | `delegationEnabledAt` null |
| Client disabled (script) | `client_disabled` for the client | `client.disabledAt` |

New store-port helpers: `revokeGrantsForTenant(tenantId, reason)`, `revokeGrantsForClient(clientId, reason)` and `revokeGrantsForUserTenant(userId, tenantId, reason)`. They are added to both the memory and Prisma stores and covered by `store-contract-oauth.ts`.

## 2. Tests (TDD: these are written first, red, then made green)

Unit tests run on the memory store (`npm --prefix server test`); `test:db` covers the Prisma half.

- `oauth/__tests__/client-assertion.test.ts`:
  - valid ES256 and RS256 assertions
  - wrong `aud`, `iss`, `sub` and expired assertion
  - `alg: none` and `HS256` refused
  - replayed `jti`
  - unknown `kid` triggers a refetch
  - JWKS host is http or private-IP
- `oauth/__tests__/service.test.ts` (extend):
  - a public client asking for the `/v1` resource gets `invalid_target`
  - a confidential client without an assertion gets `invalid_client`, on both code and refresh
  - an assertion signed by another key gets `invalid_client`
  - refresh rotation, and reuse revoking the grant (ADR-197 §5)
  - a disabled client gets `invalid_client`
  - DCR can never produce CONFIDENTIAL
- `__tests__/routes-delegated.test.ts` (new; the harness extends `helpers/oauth-agent.ts` with `confidentialClient()` holding a local key pair served from a stub JWKS):
  - **AC1:** a delegated call on an opted-in route (create expense) on the firm profile gives 201, and the audit row has `actorType USER`, the person's id and `metadata.via = 'malafat'`.
  - **AC1:** the same token on the person's personal profile and on a business profile they own gives 404 PROFILE_NOT_FOUND.
  - **AC1:** the same token on `/v1/me/password`, `/v1/sessions/current`, checkout, `/v1/oauth/grants` and `/v1/me/connected-apps` gives PRINCIPAL_NOT_ACCEPTED.
  - `/v1/me` under the token lists one profile and no `clients` or `operator`.
  - Firm-role parity: a SUBMITTER's delegated call is refused where their session call is refused (the scopes table is shared).
  - **AC2:** the organization key used as a client assertion, as a bearer on a delegated-only route, and on `/oauth/token` cannot mint a token. A `/v1` delegated token on `/mcp` gives 401.
  - **AC3:** one test per row of §1.5. For each, the call before the event succeeds and the next call fails.
  - Switches: global off gives 401 on the token and 404 on connected-apps; the per-firm switch off gives 401 and its grants are revoked; switching it on again does not revive them.
  - Connected apps: the list shows only Malafat grants; DELETE of someone else's grant gives 404.
- `auth/__tests__/middleware.test.ts`: `buildRouteAccessIndex` maps `delegated`; `selectProfile` under `via`.
- `__tests__/route-security.test.ts`: the never-list carries no `delegated`; every route with `delegated` also carries `session`. Malafat never gets a route a person can't use.
- `repositories/__tests__/store-contract-oauth.ts`: the three revoke helpers, the jti uniqueness, and the grant `tenantId`.

**Commands** (Node 22 from nvm; heavy work goes through the queue):
`heavy --light -l "MUT-593 server tsc" -- npm --prefix server run typecheck`, then `npm --prefix server run lint`, `npm --prefix server run openapi:check`, and `heavy -l "MUT-593 server tests" -- npm --prefix server test`. Root `npm run typecheck` checks the generated client types. `test:db` runs in CI.

**Release-QA:** there is no user-visible flow in this ticket. The portal scenarios in brief §12 belong to MUT-596. New server files must be mapped in `qa/features/portal-selfservice/connect.yaml` `paths` (it already maps `server/src/oauth`), and `release-qa lint` must show no new unmapped files.

## 3. Quality bar
- **DRY:** one principal reuses the whole session path. `grantPerson()` is shared with agent auth. The revoke helpers are shared with MUT-594. Route opt-in uses a single constant.
- **Testable:** assertion verification is a pure function with JWKS fetching injected. The clock and store are injected, as in `OAuthService`.
- **Scalable and cost:** each delegated request adds one indexed integration read (`@@unique(provider, externalTenantId)`) on top of the token lookup. JWKS is cached for 10 minutes, so there is roughly one fetch per 10 minutes per instance. There is one `jti` insert per token call (refresh about once an hour per lawyer). No new infrastructure.
- **Constraints:** default refuse; telemetry gated (ADR-236; Sentry warns on refresh reuse as for agents); no secrets in the repo, because MTB3A stores only the JWKS URL; nothing user-facing, so no i18n.

## 4. Self-run eng review (risks folded in)

**Basel, 2026-11-12:** R4 decided: only an operator disable revokes; a key rotation does not. R5 decided: Connected apps shows Malafat grants only. The full §4.5 opt-in list ships in this ticket.
- **R1 ADR number collision.** Local `main` has ADR-254 for this epic (553948bc). The unmerged `feature/mut-589-move-saved-expense` also writes ADR-254. MUT-589 must renumber to ADR-255 when it merges. This ticket adds a "Built (MUT-593)" note to ADR-254 and takes no new number.
- **R2 Error code.** The ticket says "401 PRINCIPAL_NOT_ACCEPTED", but `errors.ts:32` maps it to **403** everywhere. Keep 403 and correct the ticket text. Changing it would break existing clients.
- **R3 "Sign out everywhere."** No person-facing endpoint for it exists; only operator sign-out does. DF2 is met by password change, operator sign-out and operator disable. Don't add an endpoint in this ticket.
- **R4 Key rotation versus compromise.** Revoking every token on a routine JWKS key rotation would force every lawyer to reconnect. Recommendation: rotation is a JWKS change only, so assertions signed with a retired key fail at the next refresh, and access tokens last at most 1 hour. Compromise means the operator disables the client, which ends every token on the next call. This narrows the ticket row "client disabled or key rotated".
- **R5 Connected apps scope.** List Malafat grants only. Agents keep their `agent_access`-gated `/v1/oauth/grants`, so the portal's agent UI does not change. Merging the two lists is a later portal decision.
- **R6 Tenant forged at authorize.** A compromised Malafat could name any tenant. Consent checks that the person is a member of that tenant's organization, so it can only pick among firms the person already belongs to (brief §7).
- **R7 SSRF via JWKS URI.** Only the operator registers it, and it goes through the https and public-IP guard anyway.
- **R8 Clock skew on assertions.** Allow ±60 s leeway; `jti` rows live until `exp` plus leeway.
- **R9 The never-list goes stale.** The route-security test reads path prefixes, so a new route under `/v1/me/password*` or `/v1/operator*` is caught without editing the test.

## 5. Out of scope (other tickets)
Member sync, pending seats, the D3 role map and the owner rule (MUT-594); Sign in with Malafat and `external_identities` (MUT-595); portal consent copy and Connected apps UI (MUT-596); phone (MUT-597); the `/mcp` resource for the confidential client (MUT-598); Malafat's KMS and client (MAL-1541).

Business / product impact
- Malafat can act for each lawyer on the firm's books with that lawyer's own permissions. This is the security foundation that lets every MTB3A money feature appear inside Malafat without one key that opens every firm.
- Ticket 1 of epic MUT-592. It unblocks MUT-594, MUT-595 and MUT-598 and Malafat's MAL-1541 to MAL-1544 money screens. Pilot: Sader's office.
- Ships dark (global and per-firm switches). The risk is bounded by tenant binding, `private_key_jwt` and refresh-reuse detection.
