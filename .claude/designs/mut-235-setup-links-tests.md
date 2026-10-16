# MUT-235 — Test plan

Tests first (auth change). Run under Node 22. Command: `npm --prefix server test` (unit + memory store), `npm --prefix server run test:db` (Postgres contract), then the server CI set (`typecheck`, `lint`, `openapi:check`).

## Unit — `server/src/__tests__/account-setup.test.ts`

- `generateSetupToken` → 43 base64url chars; 1,000 tokens are all distinct.
- `setupLinkState`: valid; expired at exactly `expiresAt` (boundary) and after it; used; superseded (cancelledAt set); invalid for a null record; invalid for a DISABLED user; `used` wins over `expired` when both hold.
- `setupUrl` puts the token in the fragment and never in the path or query.
- `NewPasswordSchema`: 11 chars refused, 12 accepted, 128 accepted, 129 refused, spaces and emoji allowed.

## Store contract — `store-contract-account-setup.ts` (memory + Postgres)

- `issue` cancels the user's earlier open links and leaves other users' links alone.
- `redeem` valid → password hash set, `passwordChangedAt` stamped, lockout cleared, all sessions revoked with reason `password_set`, audit `user.password_set` on every membership org, link `usedAt` set.
- `redeem` twice → second is `refused: used`; expired → `refused: expired`; superseded → `refused: superseded`; unknown digest → `refused: invalid`; DISABLED user → `refused: invalid`, password unchanged.
- Concurrent redeems (Postgres, `Promise.all` of two) → exactly one `redeemed`.
- Concurrent issues for one user (Postgres, `Promise.all` of two) → exactly one open link afterwards (eng review A2).
- `issue` with `lock: true` → passwordHash null and every session revoked (reason `setup_link_lock`), in the same transaction as the link; without `lock`, neither changes.
- A refused redeem writes nothing (hash, sessions, audit all unchanged).
- `users.create` with `passwordHash: null` round-trips as null.

## Routes — `routes-account-setup.test.ts`

- check: valid returns email, locale, purpose, expiresAt; each refusal returns only `state`; it never returns a hash or a user id.
- redeem → 200 `{ email }`; then `POST /v1/sessions` and `POST /v1/device-sessions` with the new password succeed.
- redeem refusals → 410 `SETUP_LINK_UNUSABLE` with `details.state` (used, expired via clock, superseded, invalid).
- policy violation → 422, the link stays usable.
- cross-site (no Origin, foreign Origin) → 403 `CROSS_SITE_REQUEST` on both routes.
- IP budget: request 21 within a minute → 429 with `Retry-After`; the budget is separate from sign-in's.
- AC 2: a provisioned, unredeemed account → `/v1/sessions` and `/v1/device-sessions` both 401 `INVALID_CREDENTIALS`, the same body as a wrong password; the hasher spy shows exactly one verify call in each case.
- AC 5: a cookie session and a device session opened before redeem are both 401 afterwards.

## Admin — `routes-users.test.ts` (rewritten cases)

- create → 201 with `setupLink.url` matching `/setup#<43>`, `expiresAt` 72 h out; the stored `passwordHash` is null; the response has no `initialPassword`.
- create with `setupLinkValidHours: 1` and `720` accepted; `0` and `721` → 422.
- setup-link on a user with a password → purpose RESET; the old password still signs in; no session revoked; an earlier open link is now superseded.
- setup-link on a DISABLED user → 409 `USER_DISABLED`.
- Audit rows: `user.setup_link_issued` (ADMIN) on issue.
- setup-link with `lock: true` (D2): the old password is refused at once, an open cookie session and an open device session are both 401, and the new link still redeems normally afterwards.
- `POST /admin/v1/users/{id}/password` → 404 (route gone).

## Inventory and security

- `no-self-registration.test.ts`: the public operations that touch accounts are exactly the four listed in the brief §4, in both the router and the OpenAPI doc.
- `route-security.test.ts`: `PUBLIC_OPERATIONS` gains the two setup operations; every other check is unchanged.
- `logger.test.ts`: across create, setup-link, check and redeem, no log line contains the token, the URL fragment or the password.

## Scripts

- `scripts/__tests__/users.test.ts`: `create` and `rotate` print the shown-once line, the URL and the expiry; `--valid-hours` is forwarded; `rotate` prints the old-password note; `rotate --lock` sends `lock: true` and prints the signed-out note; no output line looks like a password.
- `seed-demo-account` test: `ensureSeedAccount` issues a link and redeems it, returns a password that signs in, and `keepPassword` still skips both.

## Regression

- Every route test that used `initialPassword` switches to `helpers/provision.ts`. The whole server suite stays green with no assertion weakened.

## Release-QA (`qa/features/portal/account-setup.yaml`, `qa/specs/portal/account-setup.spec.ts`)

Brief §8 scenarios 1–3, tagged `@portal.account-setup.<id>`, each step in `step(...)`.
