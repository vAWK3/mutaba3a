# MUT-120: Every user gets exactly one personal profile, created with the account (design brief)

- **Status:** design, awaiting approval (`/eng-build`, 2026-10-12).
- **Epic:** MUT-63 (Mutaba3a Capture).
- **Branch:** `feature/mut-120-personal-profile` (worktree `.claude/worktrees/mut-120-personal-profile`).
- **Builds on:** ADR-037 (decisions 1 and 7, and the MUT-65 amendment), `hosted-portal.md` §3.1/§6, and MUT-37 provisioning.
- **Consumed by:** MUT-121 (the phone makes Personal the default capture profile).
- **Plan of record:** `/eng-ticket` plus `/plan-eng-review` (2026-10-12), and Jira MUT-120 comment 11080.

## 1. Problem and acceptance criteria

Today a hosted user only sees the firms an operator attached them to. A "personal" profile is only *implied*: an organization with no CONNECTED Malafat integration (`auth/writability.ts:128`). Nothing marks it, nothing limits it to one per user, and `POST /admin/v1/users` requires a firm (`schemas.ts:202`).

Acceptance criteria (from the ticket, as amended in comment 11080):

1. `provision:user`, with or without a firm organization, produces a user with exactly one personal profile.
2. Creating a second personal organization for the same user fails on the unique constraint. Retrying user creation stays idempotent: one transaction, a repeat email gets 409, and no orphan or second personal org is left behind.
3. `POST /v1/integration/bind` against a personal organization is refused.
4. ~~The backfill creates nothing when run a second time.~~ **Cut**, because there are no existing users.
5. `/v1/me` lists the personal profile with `payments`, `customers` and `projects` as `read-write`, plus the explicit marker `isPersonalDefault: true`.
6. The migration is additive, store contract tests (memory and Postgres) cover the change, and every mutation appends an `AuditEvent` with actor `ADMIN`.
7. *(Added in eng review, D5)* An API key cannot be issued for a personal organization.
8. *(Added in eng review, D6)* A personal organization cannot be granted to anyone but its owner. This covers both the grant route and a `POST /admin/v1/users` whose `organizationId` is someone else's personal org.

## 2. Solution

```
POST /admin/v1/users {email, displayName, locale, organizationId?, defaultCurrency?, timezone?}
  ├─ zod: organizationId absent ⇒ defaultCurrency + timezone required ──► 422 VALIDATION_FAILED
  ├─ firm = organizationId ? getById (404) : null;  firm.personalOwnerUserId ⇒ 409 PERSONAL_PROFILE
  ├─ personal = { name: Personal|شخصي by locale, slug: personal-<uuid>, currency/tz: request ?? firm }
  ├─ store.users.create  ── ONE transaction ──►  user · personal org (personalOwnerUserId = user.id)
  │                                               · personal membership · firm membership (if any)
  │     UniqueViolation (email) ⇒ 409 CONFLICT, nothing left behind
  ├─ audit ADMIN: personal org ← organization.created + user.created; firm ← user.created
  └─ 201 { user, memberships: [personal, firm?], personalProfile: {id, name}, initialPassword }
```

### 2.1 Schema: one additive migration `20261012170000_mut120_personal_profile`

`Organization.personalOwnerUserId String? @unique @db.Uuid`, with an FK to `users(id)` (`ON DELETE RESTRICT`). The back-relation is `User.personalProfile`.
- Nullable: every firm org keeps NULL, and Postgres allows many NULLs under a UNIQUE index.
- The unique index *is* the "exactly one per user" guarantee.
- No existing row changes.
- This is a column, not the `Profile` table ADR-037 rejected (DECISIONS.md:1707).

### 2.2 Store ports (`repositories/ports.ts`)

- `Organization.personalOwnerUserId: string | null`
- `CreateOrganizationInput.personalOwnerUserId?: string | null`
- `CreateUserInput.organizationId?: string` (now optional) and `personal: { name; slug; defaultCurrency; timezone }` (required, because every user gets one).
- `UserRepository.create` returns `{ user, memberships: MembershipRecord[], personalOrganization }`. `memberships` lists the personal membership first, then the firm's.

No new repository method, so `store-guard.ts` needs no new classification (`organizations.create` and `users.create` are already `operator`).

### 2.3 Routes

| Route | Change |
|---|---|
| `POST /admin/v1/users` | as diagrammed above |
| `POST /admin/v1/users/{id}/memberships` | org has `personalOwnerUserId` and it isn't this user ⇒ 409 `CONFLICT` `{reason:'PERSONAL_PROFILE'}` |
| `POST /admin/v1/organizations/{id}/api-keys` | personal org ⇒ 409 `CONFLICT` `{reason:'PERSONAL_PROFILE'}` |
| `POST /v1/integration/bind` | `keyAuth(c).organization.personalOwnerUserId` set ⇒ 409 `CONFLICT` `{reason:'PERSONAL_PROFILE'}` (defensive, since no key can exist after row 3) |
| `GET /v1/me`, `POST /v1/device-sessions` | `buildMe` adds `isPersonalDefault: org.personalOwnerUserId === user.id` from the row it already loads, so no extra query |
| `GET /admin/v1/organizations/{id}` | `Organization` gains `personalOwnerUserId` (nullable) |

### 2.4 API contracts and error states

- `CreateUserRequest`: `organizationId` becomes optional, and optional `defaultCurrency` (Currency) and `timezone` are added.
  - When `organizationId` is absent, both are required; otherwise the request is a 422.
  - When it is present, they override the firm's values.
- `CreateUserResponse` gains `personalProfile: { id, name }`.
- `HostedProfile` gains `isPersonalDefault: boolean` (required).
- `Organization` gains `personalOwnerUserId: string (uuid) | null`.
- **No new error code.** `CONFLICT` with `details.reason = 'PERSONAL_PROFILE'` is reused, because `errors.ts:10-13` says a new code is a contract change that Malafat maps.
- `provision:user`:
  - `--organization-id` becomes optional;
  - new `--currency` and `--timezone` flags;
  - it prints `personal <id> <name>`.

## 3. Reuse analysis

- The `users.create` `$transaction` is extended, not duplicated.
- `translate()` already maps P2002 to `UniqueViolation`.
- `expenses/presets.ts`'s `{name, nameAr}` is the precedent for a localized server-generated name.
- `sessionAccessFor(domain, null)` already returns read-write for a personal org (MUT-65), so the writability matrix is unchanged.
- `serializeOrganization` and `serializeMembership` are reused.
- No UI component, so `COMPONENT_REGISTRY` is unchanged.

## 4. Impact

- Every user created from now on has a personal profile.
  - `/v1/me` returns one more profile.
  - The phone (MUT-121) reads `isPersonalDefault`; until it ships, the app ignores the unknown key.
  - The portal (`src/hosted`) lists profiles from `/v1/me`, and its types are regenerated (`npm run hosted:types`).
- Existing tests that pin the exact membership or profile list change on purpose (`routes-users.test.ts:68`, `store-contract-users.ts`, `inbox-isolation.test.ts`).
- Override log: `hosted-portal.md:63` ("Personal vs firm needs nothing new") and the implicit definition personal = `writerOfRecord` null are superseded by the explicit marker. They are recorded as an ADR-037 amendment.

## 5. i18n

The org name is `Personal` / `شخصي`, chosen by `User.locale`. The slug is ASCII (`personal-<uuid>`), because `slugify` strips Arabic. The server has no other user-facing strings.

## 6. Cost and infra

One extra org row and one membership row per user, written inside the existing transaction. `/v1/me` stays at 2 queries per membership, an N+1 that predates this ticket and is negligible at pilot scale. No new infrastructure. The migration is forward-only and runs through `deploy.sh`.
