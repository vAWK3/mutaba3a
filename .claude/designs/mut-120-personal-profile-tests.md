# MUT-120: test plan

TDD: each row is written red first, then made green. AC numbers refer to `mut-120-personal-profile.md` §1.

## Store contract: `repositories/__tests__/store-contract-users.ts` (memory and Postgres)

| # | Case | AC |
|---|---|---|
| S1 | With a firm org: returns the user, the personal org (`personalOwnerUserId = user.id`, with the given name, slug, currency and timezone), and memberships `[personal, firm]`; `listByUser` has 2 | 1, 6 |
| S2 | Without a firm org: the personal org plus 1 membership | 1 |
| S3 | `organizations.create({…, personalOwnerUserId: user.id})` a second time raises `UniqueViolation` | 2 |
| S4 | A duplicate email raises `UniqueViolation`, and the second personal org (`getBySlug`) does not exist (rollback) | 2 |
| S5 | An unknown firm org raises `ForeignKeyViolation`, with no user and no personal org left behind | 2 |
| S6 | Firm orgs have `personalOwnerUserId: null` | 6 |

The other contract suites (`sessions`, `inbox`, `expenses`) and `sign-in.test.ts` gain a `personal` input. Their behaviour is unchanged.

## Routes: `__tests__/routes-users.test.ts`

| # | Case | AC |
|---|---|---|
| R1 | With a firm: 201, `memberships` = personal + firm, `personalProfile.name` = `Personal`, and the personal org inherits the firm's currency and timezone | 1 |
| R2 | `locale: 'ar'` names the profile `شخصي` | 1 |
| R3 | No firm, with `defaultCurrency` and `timezone`: 201 with one membership | 1 |
| R4 | No firm and no currency or timezone: 422 `VALIDATION_FAILED`, and no user is created | 1 |
| R5 | Request currency and timezone override the firm's values | 1 |
| R6 | Retrying the same email gives 409, and the user still has exactly one personal org (no second org with the marker) | 2 |
| R7 | Audit: the personal org gets `organization.created` and `user.created` (ADMIN); the firm gets `user.created` (ADMIN) | 6 |
| R8 | Granting user B a membership of A's personal org gives 409 `CONFLICT` `reason: PERSONAL_PROFILE`; granting it to A again gives 200 with `created: false` | 8 |
| R9 | `POST /admin/v1/users` with `organizationId` = someone's personal org gives 409, and no user is created | 8 |

## Routes: admin orgs, bind, /v1/me

| # | File | Case | AC |
|---|---|---|---|
| A1 | `routes.test.ts` | Issuing an API key on a personal org gives 409 `PERSONAL_PROFILE`; firm orgs are unchanged | 7 |
| A2 | `routes.test.ts` | `GET /admin/v1/organizations/{id}` shows `personalOwnerUserId` (the owner for personal, null for a firm) | 6 |
| B1 | `routes.test.ts` | Bind with a key whose org is personal gives 409 `PERSONAL_PROFILE`. The key is planted through the store, because the route now refuses to issue one. | 3 |
| M1 | `routes-sessions.test.ts` | `/v1/me` sets `isPersonalDefault: true` only on the caller's own personal org; on it, `access.customers/projects/payments` are `read-write`; a firm gets `false` | 5 |
| M2 | `routes-device-sessions.test.ts` | The device-session payload carries the same marker | 5 |

## CLI: `scripts/__tests__/users-cli.test.ts`

| # | Case |
|---|---|
| C1 | `create` without `--organization-id`, with `--currency` and `--timezone`, posts no `organizationId` and prints `personal <id> Personal` |

## Intentional changes to existing tests

- `routes-users.test.ts:68`: `memberships` now includes the personal membership.
- `store-contract-users.ts`: the creation test asserts `memberships` instead of `membership`.
- `inbox-isolation.test.ts`: any exact profile or membership count gains the personal one.
- Anything else that breaks on the extra profile is listed in the CHANGELOG entry.

## Commands

- `cd server && npm run lint && npm run typecheck && npm test && npm run openapi:check && npm run build`
- `MUTABA3A_TEST_DATABASE_URL=postgresql://mutaba3a:mutaba3a@localhost:54329/mutaba3a_test_mut120 npm run test:db`, after `prisma migrate deploy` against that database.
- Repo root: `npm run hosted:types:check` and `npm run typecheck`.
