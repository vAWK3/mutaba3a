# MUT-37 — operator-only user accounts (test plan)

Companion to `hosted-portal.md` §3 (approved 2026-10-11) and the "Re-cut after MUT-36" section on MUT-37. Written before implementation. All paths are under `server/`.

## Scope

**In scope:**
- `users` and `memberships` tables (migration `…_mut37_users_memberships`, additive).
- `UserRepository` and `MembershipRepository` on `LedgerStore`, implemented for memory and Prisma.
- argon2id hashing (`@node-rs/argon2` 2.2.1) behind a `PasswordHasher` port, with parameters validated in `config.ts`.
- Seven admin routes behind `X-Admin-Token`.
- One operator CLI, `src/scripts/users.ts`, exposed as `npm run provision:user`, `grant:user`, `revoke:user`, `rotate:password`, `disable:user` and `enable:user`.

**Out of scope:**
- Sessions, sign-in, lockout and the `USER` audit actor (MUT-38).
- The writability matrix and the profile header (MUT-39).

### Admin routes

| Method & path | Body | Success | Errors |
|---|---|---|---|
| `POST /admin/v1/users` | `{ email, displayName, locale?, organizationId }` | `201 { user, memberships: [1], initialPassword }` | 404 org; 409 email in use; 422 |
| `GET /admin/v1/users?email=` | — | `200 { users: [0 or 1] }` (email normalised before lookup) | 422 |
| `GET /admin/v1/users/{userId}` | — | `200 { user, memberships }` | 404 |
| `POST /admin/v1/users/{userId}/memberships` | `{ organizationId }` | `201 { membership, created: true }`, or `200 { …, created: false }` when the membership already exists | 404 user or org |
| `DELETE /admin/v1/users/{userId}/memberships/{organizationId}` | — | `200 { removed }` | 404 user |
| `POST /admin/v1/users/{userId}/password` | — | `200 { user, password }` (one-time) | 404 |
| `POST /admin/v1/users/{userId}/disable` · `…/enable` | — | `200 { user }`; idempotent | 404 |

**Audit.** Every mutation is audited with actor `ADMIN` (`actorId` null) on each organization the user belongs to after the mutation. For a membership removal, that means the organization being removed.

| Action | Extra |
|---|---|
| `user.created` | metadata: `email`, `displayName` |
| `membership.granted` | — |
| `membership.revoked` | — |
| `user.password_reset` | — |
| `user.disabled` | — |
| `user.enabled` | — |

A user with no memberships has no organization to audit to. That mutation is logged at info level with the user id only.

## Unit (pure): `src/auth/__tests__/users.test.ts`

**`normalizeEmail`:**
- Trims whitespace.
- Lower-cases.
- Applies NFKC: a full-width `ｅ` becomes `e`.
- Is idempotent.

**`generateOneTimePassword`:**
- Returns 24 characters from the base64url alphabet.
- 1,000 calls produce 1,000 distinct values.

**`createArgon2Hasher`:**
- Output is a `$argon2id$v=19$m=…,t=…,p=…$` PHC string carrying the configured parameters.
- `verify` is true for the right password and false for a wrong one.
- Two hashes of the same password differ (salted).

## Config: `src/__tests__/config.test.ts` (new)

- **Defaults:** `ARGON2_MEMORY_KIB` 19456, `ARGON2_TIME_COST` 2, `ARGON2_PARALLELISM` 1.
- **Minimums are refused at boot:** memory 19455, time cost 1 and parallelism 0 each raise `ConfigError` naming the variable.
- **Accepted:** values above the minimums.

## Storage contract: `store-contract-users.ts` (memory + Postgres)

**Users:**
- `users.create` returns the user and its first membership, both stamped `createdAt`.
- `passwordChangedAt` equals `at`, `status` is `ACTIVE`, and `failedSignIns` is 0.
- A second user with the same (normalised) email raises `UniqueViolation`.
- An unknown `organizationId` raises `ForeignKeyViolation`, and leaves no user behind (the transaction rolls back).
- `getById` and `findByEmail` return the row; an unknown id or email returns `null`.
- `setPassword` replaces the hash, stamps `passwordChangedAt`, resets `failedSignIns` to 0 and `lockedUntil` to null. An unknown id returns `null`.
- `setStatus` toggles between `ACTIVE` and `DISABLED`. An unknown id returns `null`.

**Memberships:**
- `grant` is idempotent: `created: true` the first time, `false` after, and the original `createdAt` is kept.
- `grant` with an unknown user or organization raises `ForeignKeyViolation`.
- `revoke` returns `true` once and `false` after.
- `listByUser` and `listByOrganization` reflect grants and revokes. `find` returns the membership or `null`.
- Isolation: memberships of organization A never appear in B's list.

## Routes: `src/__tests__/routes-users.test.ts`

**Create:**
- Returns 201 with the normalised email, one membership in the given organization, and a 24-character `initialPassword`.
- The stored hash verifies against `initialPassword`, and the response never contains the hash.
- 409 when the email is reused in any case or spacing (`Partner@Firm.ps ` vs `partner@firm.ps`).
- 404 for an unknown organization, with no user created.
- 422 for a bad email, an empty display name, or a locale outside `en|ar`.
- `locale` defaults to `en`.

**Read:**
- `GET ?email=` finds the user regardless of case and spacing, and returns an empty list for an unknown email.
- `GET /{userId}` returns the user and its memberships; 404 when unknown.

**Memberships:**
- A grant to a second organization returns 201 `created: true`. Granting again returns 200 `created: false`.
- 404 for an unknown user or organization.
- Removal returns `removed: true` then `false`. 404 for an unknown user.

**Password and status:**
- An operator password reset returns a new 24-character password.
  - The old one no longer verifies and the new one does.
  - `passwordChangedAt` advances to the injected clock.
- Disable sets `DISABLED` and is idempotent; a repeated call still returns 200.
- Enable restores `ACTIVE`.

**Audit:**
- Every mutation above appends exactly the event in the table to each member organization, with actor `ADMIN`.
- `GET /admin/v1/organizations/{id}/audit` shows it.
- A reset on a user with zero memberships appends nothing and still returns 200.

**Auth:** every route answers 401 `ADMIN_UNAUTHORIZED` without `X-Admin-Token`, and with a wrong one.

**No secret in logs:**
- The app runs with a pino logger writing to an in-memory stream at `trace` level.
- The test drives create, reset, grant, disable and enable.
- Assertions: the log text contains neither `initialPassword`, the reset `password`, nor any `$argon2id$` substring.

## No self-registration: `src/__tests__/no-self-registration.test.ts`

- Every route registered on `createApp(...)` (`app.routes`), and every path in the generated OpenAPI document, is checked.
- Any path outside `/admin/` that matches `/sign-?up|register|invite|forgot|reset/i` fails the test. The failure message names the offending path.
- A guard asserts the inventory is non-empty, so the test cannot pass vacuously.

## CLI: `src/scripts/__tests__/users-cli.test.ts`

`runUsersCommand(argv, { fetch: app.request-backed fetch, url, token, out })` runs against the in-process app:
- `create --email --name --organization-id` prints the user id and the one-time password exactly once, after a "shown once" line.
- `grant --email --organization-id` resolves the email through `GET ?email=` and grants.
- `revoke --email --organization-id` removes the membership.
- `rotate --email` prints a new password once.
- `disable --email` and `enable --email` print the resulting status.
- Without a token, or with an unknown email, it exits non-zero with the server's error code and prints no secret.

## Contract and gates

- `openapi.yaml` is regenerated: the seven paths and the new schemas, with `API_VERSION` at `1.8.0-mut37`. `npm run openapi:check` is green.
- Server gates: `npm run lint`, `npm run typecheck`, `npm test`, and `npm run test:db` against an isolated database `mutaba3a_test_mut34` in the shared test container.
- Root gates are unaffected (no `src/` change). They are run once anyway to show zero regressions.
