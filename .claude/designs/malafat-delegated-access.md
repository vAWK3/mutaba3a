# Malafat runs every MTB3A feature through the lawyer's own access

**Status:** approved by Basel on 2026-11-12, with decisions D1–D11 and defaults DF1–DF3. Epic **MUT-592** (MUT-593..598); Malafat's side **MAL-1538** (MAL-1539..1544).
**ADR:** ADR-254 (re-check the number at merge; 253 was the highest on any worktree when written). Overrides part of ADR-245 (who may share a profile) and extends ADR-197 (a second kind of OAuth client).
**Related:** ADR-023 (MTB3A as an OAuth client of Malafat's tenant server), ADR-037 (writability matrix), ADR-099 and `firm-books.md` (firm roles), ADR-197 and `mut-434-mcp-oauth.md` (MTB3A's own authorization server), ADR-245/249/251 (accountants), ADR-247 (share links), ADR-248 (period downloads), ADR-220 (server reads receipts).

---

## 1. Problem

Malafat's backend calls MTB3A with one **organization API key**. That key reaches the legal ledger (customers, matters, agreements, receivables, payments, summaries, audit: 72 routes) and nothing else. Everything a *person* does is session-only by design (MUT-42 D4): expenses, receipts and their reading, expense groups, conversions, received-money capture, accountant access, share links, period downloads, the inbox, the Claude connector (about 80 routes).

So a Malafat firm owner who wants their expenses, receipts or accountant has to leave Malafat for the MTB3A portal, and on a Malafat-fed profile some of it can't be done at all: the profile has no owner (`ownsProfile`, `personal-profile.ts`), so nobody can invite an accountant or make a share link.

Basel's goals (2026-11-12):
1. Every MTB3A feature is available inside Malafat. A firm owner never has to switch.
2. Securely: no single secret that opens every lawyer's books.
3. No duplicate work: the logic is built once, on the MTB3A server.
4. The MTB3A portal and phone app still work on the firm's books for quick, purely financial things.

## 2. Acceptance criteria

- AC1. A Malafat user can, from Malafat's own screens, do everything the MTB3A portal does on their firm's books that their firm role allows: expenses, receipts (with server reading), groups, conversions, recording money received, approvals and month close, accountant invites, share links, period downloads.
- AC2. Malafat does this with a token that belongs to **that person**, never with the organization key. A leaked organization key opens none of these features.
- AC3. Every permission check that applies in the portal applies to Malafat's calls unchanged: membership, firm role, write rules, billing, features, accountant and share-link rules.
- AC4. The same person signs in to the MTB3A portal and app with **Sign in with Malafat** and sees the same firm books, plus their own personal and created profiles.
- AC5. Malafat's token never reaches the person's own profiles (personal, freelance, business). Only profiles bound to that Malafat tenant.
- AC6. Firm members and their roles come from Malafat. MTB3A shows them and never edits them for a Malafat firm.
- AC7. A Malafat firm's PARTNERs are its owners: they can invite accountants and make share links.
- AC8. The legal ledger (customers, matters, agreements, receivables, allocations) stays Malafat's to write. The portal and app read it.
- AC9. A person can see and revoke Malafat's access from MTB3A. Every write Malafat makes is audited as that person, via Malafat.
- AC10. Ships dark. The operator enables it per firm.
- AC11. Claude users get MTB3A money tools through Malafat's own connector. One connector, no tool code written twice.

## 3. Decisions (Basel, 2026-11-12)

| # | Question | Decision |
|---|---|---|
| D1 | How Malafat users sign in to MTB3A | **Sign in with Malafat** is a sign-in method on one ordinary MTB3A account, beside password and passkey. Not a second kind of account. |
| D2 | Who manages firm members and roles | **Malafat syncs them** through the organization key. MTB3A shows them read-only on a Malafat firm. |
| D3 | Role mapping | **PARTNER → OWNER, OFFICE_ADMIN → BOOKKEEPER, ASSOCIATE and INTERN → SUBMITTER.** |
| D4 | Same email already has an MTB3A account | **Sign in to MTB3A once to link.** Never link by email alone. |
| D5 | Billing of profiles a person creates themselves | **Normal MTB3A rules**: 14-day trial, then a plan. The firm profile stays covered by Malafat (`EntitlementSource` MALAFAT). |
| D6 | Legal ledger in the portal and app | **Read-only there; edit in Malafat.** Today's write rules are unchanged. |
| D7 | A synced member who has never opened MTB3A | **A pending seat.** The account is made at their first Sign in with Malafat. |
| D8 | Consent | **One short screen inside the first link**, revocable in MTB3A. |
| D9 | Malafat's token and the person's own profiles | **Never.** Firm profiles only. |
| D10 | Rollout | **Dark, then per firm by the operator.** Sader's office is the pilot. |
| D11 | Claude connector | **Malafat's MCP forwards MTB3A's tools** with the person's delegated token. |

Defaults (all three confirmed by Basel, 2026-11-12):
- DF1. A person who signs up through Malafat skips MTB3A's signup review: their firm is a known, paying Malafat customer and Malafat verified the address.
- DF2. A password change or "sign out everywhere" in MTB3A also revokes Malafat's access, as it does for Claude (ADR-197 §9). Malafat asks the person to reconnect, which is one tap through Sign in with Malafat.
- DF3. Removing a member in Malafat ends their access at once: the sync removes the membership and revokes that person's Malafat tokens for that tenant.

## 4. Design

### 4.1 Two directions of OAuth, both already half-built

```
           Sign in with Malafat (MTB3A is the client; ADR-023 direction)
 Person ─────────────────────────────────────────────────────────►  Malafat tenant OAuth server
   │                                                                (office.malafat.app)
   │  portal / phone session                                               │
   ▼                                                                       │
 MTB3A API  ◄──── /v1 + /mcp with the person's delegated token ──── Malafat backend
 (one server,       (Malafat is the client; ADR-197 server)          (stores per-person
  one database)                                                        refresh tokens)
   ▲
   └──── organization API key: legal-ledger sync + member sync (unchanged + one route)
```

- **Sign in with Malafat** (MTB3A → Malafat). MTB3A is an OAuth client of the tenant's own server, exactly as the retired desktop app was (ADR-023): PKCE S256, `state`, tenant resolved from the subdomain. The person names their office once (its Malafat address; remembered on the device). MTB3A reads `sub`, the verified email and the tenant from Malafat's userinfo. **Malafat dependency:** a userinfo endpoint and MTB3A's redirect URIs registered (MAL ticket).
- **Delegated access** (Malafat → MTB3A). Malafat becomes a **confidential client** of MTB3A's own authorization server (ADR-197), the first one: registered by the operator, authenticating with `private_key_jwt` (Malafat holds the private key in its KMS; MTB3A stores only the public JWKS URL). It asks for `resource=<origin>/v1` (and `<origin>/mcp` for D11). MTB3A today issues only public clients and only the `/mcp` resource; both widen here, behind the same code paths.

### 4.2 A new principal: `delegated`

`authenticate()` gains a third principal beside `apiKey` and `session`: a bearer token issued to a confidential client for `/v1`. It resolves to **the person** (`SessionAuth`'s user) plus a `via` (`{ clientId, tenantId }`).

- Everything below the principal is the session path: `selectProfile`, `sessionScopesFor(writer, role)`, the firm role matrix, the store guard, the billing gate, features, accountant and share-link rules. Nothing per feature changes (AC3).
- **Tenant binding (D9, AC5).** `selectProfile` admits a delegated request only on a profile whose CONNECTED integration names the token's tenant. Every other profile answers the uniform 404 PROFILE_NOT_FOUND, the same as not being a member. `/v1/me` under a delegated token lists only those profiles, and no `clients` (accountant desk) or own-profile fields.
- **Routes a delegated token never reaches:** `/v1/me/password`, passkeys, sessions and device sessions, account closure and purge, billing checkout and portal, OAuth grants and consent, operator and admin, `/v1/records-export` of personal data. A route opts in by declaring the `delegated` principal in its OpenAPI `security` (the same mechanism that declares `apiKey` today), so the default is **refuse** and the allowed list is visible in the contract.
- **Audit (AC9).** Writes are audited as `actorType USER`, the person's id, with `metadata.via = 'malafat'`. The audit feed shows "Rana (via Malafat)".
- **Rate limits.** Per person and per client, as for sessions; the organization key's limits are unchanged.

### 4.3 Accounts, linking and pending seats

One MTB3A account per person (D1). A new `external_identities` table: `{ provider: MALAFAT, tenantId, subject, userId?, email, createdAt, linkedAt }`, unique on `(provider, tenantId, subject)`. A person in two Malafat firms has two rows pointing at one account.

First Sign in with Malafat:
1. No row, no MTB3A account on that email → create the account (ACTIVE, D5 trial on its personal profile, DF1 no review), link the row, claim pending seats.
2. No row, an MTB3A account on that email → "Sign in to MTB3A once to connect" (password or passkey), then link (D4). Never by email alone.
3. A linked row → signed in.

Every route ends on the consent screen the first time (D8): "Malafat can read and add to the books of *Sader Law Office* as you. It can't see your own profiles." One button. Shown again only after a revoke.

**Pending seats (D7).** The member sync (4.4) may name a Malafat user who has no MTB3A account. Their membership is stored against the `external_identities` row (no `userId` yet). The first Sign in with Malafat claims it in the same transaction that creates or links the account. No account, no personal profile and no mail until then.

### 4.4 Member sync and owners (D2, D3, AC6, AC7)

`PUT /v1/integration/members` on the organization key (scope `integration:write`, idempotent): the full list `{ subject, email, role: PARTNER | OFFICE_ADMIN | ASSOCIATE | INTERN }[]`. The server diffs it: adds, changes roles, removes. A removal revokes that person's delegated tokens for the tenant (DF3).

- Turning on delegation for a Malafat firm also sets `firmEnabledAt` (firm features, ADR-099). Roles map by D3.
- **Owner rule (overrides part of ADR-245).** `ownsProfile` today says a Malafat-fed profile has no owner. New: on a Malafat firm, an OWNER-role member owns it. This is what lets PARTNERs invite accountants and make share links, from Malafat or the portal. `canCoOwn` stays as it is for profiles people create; the change is one branch in `ownsProfile`, the one rule every owner gate reads.
- In MTB3A, `members` is read-only on a Malafat firm for everyone. "Managed in Malafat" replaces the invite and role controls.
- Accountants stay per person and pay for themselves (ADR-251). Inviting one is free for the firm.

### 4.5 What each side does (D6)

On a Malafat firm, through **either** Malafat (delegated) or the portal and app (session):
- expenses, receipts (upload, server reading, review, move), expense groups, vendors, conversions, recording money received, approvals, month close, accountant access, share links, period downloads, summaries, the feed.

Through **Malafat only** (organization key, unchanged): customers, matters, agreements, fee proposals, installments, retainers, receivables, payment allocation, credits, VAT settings, import. The portal and app read them.

No route changes its writer of record. The writability matrix and the firm role matrix already split along this line.

### 4.6 The Claude connector (D11)

Malafat's MCP server forwards MTB3A's tools rather than re-implementing them: it lists MTB3A's `/mcp` tools under its own connector and forwards each call with the person's delegated token for resource `<origin>/mcp`. Tool code lives once, in MTB3A (MUT-435/436). The person's `agent_access` feature still applies. A person who also connects MTB3A's own connector directly sees their own profiles there, and only the firm through Malafat's.

### 4.7 Revocation, in one place each

| Event | Effect |
|---|---|
| Person revokes "Malafat" in MTB3A › You › Connected apps | All their delegated grants for that tenant end. |
| Person removed from the firm in Malafat | Membership removed, tokens for that tenant revoked (DF3). |
| Firm disconnects Malafat (`/v1/integration/disconnect`) | Every delegated grant for the tenant ends. Profiles stay. |
| Password change, sign out everywhere, operator disable | All delegated grants end (DF2). |
| Operator turns the firm's switch off | New tokens refused, existing ones end. |
| Malafat's client key rotated or client disabled | Every token for that client ends. |

### 4.8 Rollout (D10)

- Global switch `MALAFAT_DELEGATION` (default off; on in dev and the QA live API), as `ACCOUNTANT_ACCESS` was.
- Per firm: an operator action on the organization ("Malafat features"), audited. Off → delegated tokens for that tenant are refused, and Sign in with Malafat still signs a person in to their own profiles.
- Pilot: Sader's office, then firms one at a time.

## 5. API contract (additions)

- `POST /oauth/token` accepts `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer` for confidential clients; `resource` may be `<origin>/v1` for a confidential client only.
- `PUT /v1/integration/members` (key, `integration:write`).
- `GET /v1/me/connected-apps`, `DELETE /v1/me/connected-apps/{grantId}` (session only).
- `GET /v1/auth/malafat/start?tenant=`, `GET /v1/auth/malafat/callback`, `POST /v1/auth/malafat/link` (session-less; link needs the MTB3A sign-in proof).
- Operator: `POST /v1/operator/organizations/{id}/malafat-delegation` `{ enabled }`.
- Every route that Malafat may call on a person's behalf declares `delegated` in its OpenAPI `security`. The contract is the list (AC3).

Errors: existing codes. A delegated call on a profile outside the tenant is 404 PROFILE_NOT_FOUND. A refused route is 401 PRINCIPAL_NOT_ACCEPTED. Link conflicts: 409 IDENTITY_LINKED_ELSEWHERE (new; the Malafat identity is already linked to a different account).

## 6. Reuse

- Authorization server, token storage, rotation, revocation, audit: ADR-197's `server/src/oauth/*`. New: confidential-client auth and the `/v1` resource.
- Permissions: `selectProfile`, `sessionScopesFor`, the firm role matrix, store guards. New: one principal and the tenant binding.
- Sign-in UI: the portal's sign-in doors and the phone's (MUT-371).
- Malafat side: its existing OAuth server and MCP server; a TypeScript client generated from `server/openapi/openapi.yaml`.

Nothing in receipts, accountants, share links, downloads, approvals or billing is rebuilt.

## 7. Security review (focus of ticket 1)

- **Key compromise:** the organization key can sync members but cannot mint person tokens. Adding a fake member gives that member nothing until a real Malafat sign-in claims the seat, and the Malafat identity is the tenant server's to prove.
- **Malafat backend compromise:** an attacker gets stored refresh tokens. Bounded by: tenant binding (firm books only, never own profiles), `private_key_jwt` (stolen tokens are useless without the signing key in Malafat's KMS), refresh rotation with reuse detection (ADR-197 §5), per-firm switch, global client disable.
- **Account takeover by email:** never linked by email (D4).
- **Confused deputy between tenants:** a token carries one tenant; a profile bound to another tenant answers 404.
- **Privilege by sync:** roles map only from Malafat's four roles; no role grants operator or billing routes; owner powers apply only to that firm.
- **Default refuse:** routes opt in to `delegated`. A new route is closed to Malafat until it declares it.
- **Telemetry:** none from the API (ADR-236); Sentry gets refresh-reuse warnings as for agents.

## 8. Impact

- `ownsProfile` change touches every owner gate: profile edits, accountants, share links, firm settings. Tests per gate on a Malafat firm.
- Billing: unchanged rules. A Malafat member's own profiles are ordinary (D5). `COVERED_BY_MALAFAT` refusals in checkout keep their meaning.
- Purge: a closing account's `external_identities` rows and delegated grants are deleted; a firm's purge removes pending seats.
- Phone: Sign in with Malafat on the sign-in doors; "Connected apps" in You.
- Portal local mode (signed out): unaffected.

## 9. i18n

New strings, Arabic first, ar + en: "Sign in with Malafat", "Your Malafat office address", the consent screen, "Connected apps", "Managed in Malafat", "(via Malafat)" in audit and history, link conflict and revoked messages. Keep "الملف" for matter (memory: matter label).

## 10. Cost

No new infrastructure. One table, one index on grants by tenant, a few routes. The per-request tenant check is one indexed read already cached with the profile.

## 11. Tickets (to file after approval)

Epic (MUT): Malafat runs every MTB3A feature through the lawyer's own access.

| # | Repo | Ticket | Blocks |
|---|---|---|---|
| 1 | MTB3A server | Delegated principal: confidential client (`private_key_jwt`), `/v1` resource, tenant binding, opt-in `delegated` security, audit via, revocation table 4.7, global and per-firm switches | all |
| 2 | MTB3A server | Member sync on the key, pending seats, D3 role map, Malafat-firm owner rule (ADR-245 override log) | 5, 8 |
| 3 | MTB3A server | Sign in with Malafat: external identities, link flow (D4), signup through Malafat (D5, DF1), seat claim | 4, 5 |
| 4 | MTB3A portal | Sign in with Malafat door, link and consent screens, You › Connected apps, "Managed in Malafat" on members | |
| 5 | Flutter | Sign in with Malafat on the sign-in doors, Connected apps | |
| 6 | MTB3A server | `/mcp` resource for the confidential client (D11) | 10 |
| 7 | Malafat (MAL) | Userinfo for MTB3A (sub, verified email, tenant); register MTB3A's redirect URIs | 3 |
| 8 | Malafat (MAL) | Push members and roles on change and nightly | |
| 9 | Malafat (MAL) | Connect flow, refresh-token store in KMS, generated MTB3A client | 10–12 |
| 10 | Malafat (MAL) | Money screens round 1: expenses and receipts (server reading) | |
| 11 | Malafat (MAL) | Money screens round 2: accountants, share links, period downloads | |
| 12 | Malafat (MAL) | Money screens round 3: approvals, month close; MCP forwarding of MTB3A tools | |

## 12. QA scenarios

Portal (`qa/features/portal/malafat-delegation.yaml`; Malafat's own QA covers its screens):
1. **First sign-in creates an account.** Open sign-in, choose Sign in with Malafat, enter the office address, approve on Malafat, approve the consent screen → the overview shows the firm profile and a personal profile.
2. **Existing account links.** Same with an email that has an MTB3A account → asked to sign in to MTB3A → after it, the same account shows the firm profile beside its own.
3. **Partner invites an accountant from the portal** on a Malafat firm → the invite is sent; an ASSOCIATE sees no invite control.
4. **Submitter adds an expense** on the firm in the portal → it appears in their own list only; the Overview shows no firm totals.
5. **Legal ledger is read-only** on a Malafat firm → no edit on a client or agreement; a note says it's edited in Malafat.
6. **Revoke Malafat** in You › Connected apps → the row disappears; (server test) the next delegated call fails.
7. **Members are managed in Malafat** → the members list shows roles with "Managed in Malafat" and no controls.

Server (contract and unit, no UI): tenant binding on every opted-in route; refused routes; owner rule per gate; sync diff and DF3; seat claim race; refresh reuse; each row of the revocation table.

## 13. Open questions for Malafat

- Does the tenant server already issue a userinfo response with a verified email? If not, ticket 7 adds it.
- Does Malafat already keep a KMS key it can sign `private_key_jwt` with?
- Malafat's role change events: push on change, or only a nightly sync? The brief asks for both.
