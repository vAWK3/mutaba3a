# MUT-182: Profile management API — create, rename, set currency and type (design brief)

- **Status:** design, awaiting approval (`/eng-ticket`, 2026-10-14).
- **Epic:** MUT-181 (Users create and manage their own hosted profiles).
- **Branch:** `feature/mut-182-profile-management-api` (worktree `.claude/worktrees/mut-182-profile-management-api`).
- **Builds on:** ADR-037 (decision 1, decision 2, decision 7, and the MUT-39, MUT-65, MUT-120 and MUT-133 amendments), ADR-061 (user-keyed idempotency), ADR-066 (preset selection), and MUT-42 D2.
- **Consumed by:** MUT-183 (portal UI), MUT-184 (Flutter UI), MUT-191 and MUT-192 (Malafat suggestions after a Business profile is created).
- **Owner rulings this plan rests on** (MUT-181 comment 11494; memory `self-service-hosted-profiles-mut-181`):
  - The cap is 6 owned profiles.
  - The type is PERSONAL or BUSINESS, and it only selects the preset.
  - A type change replaces the categories and leaves the affected expenses uncategorized.
  - A user-created profile is **standalone only, never a Malafat organization**.

## 1. Problem and acceptance criteria

Only an operator can create an organization:
- `POST /admin/v1/organizations` and `POST /admin/v1/users` create them.
- `store-guard.ts:37` classifies `organizations.create` as `'operator'`, which every principal is refused.

The only profile a user owns is the MUT-120 personal one. It is marked by `Organization.personalOwnerUserId`, which is `@unique`, so a user can own exactly one.

Acceptance criteria are verbatim from the ticket. Each maps to the tests in §5.

| # | AC | Tests (§5) |
|---|---|---|
| A1 | `POST /v1/profiles {name,type,defaultCurrency,timezone}` creates an org owned by the caller plus its membership. It honours Idempotency-Key and is audited. | C1, C2, R1–R4 |
| A2 | A 7th owned profile gets 409 `PROFILE_LIMIT`. The cap is a config constant, and the personal profile counts toward it. | C3, C4, R5 |
| A3 | Owned profiles of either type accept income, customers, projects and expenses exactly as personal does (MUT-65/MUT-133). | R14, P1, P2 |
| A4 | PATCH for name and currency uses If-Match. A currency change doesn't touch existing records. | C5, R6–R8 |
| A5 | A type change runs in one transaction: null the categoryIds, delete all categories, seed the new preset, and return the count. A preview returns the count. | C6–C9, R9, R10 |
| A6 | PATCH on a profile the caller doesn't own gets 403, and API keys still can't create orgs. | R11, R12, G1 |
| A7 | **Standalone guarantee:** no API key can be issued for an owned profile or reach one, no Malafat bind, no grant to another user, no `provision:user --organization-id`, and `writerOfRecord` is always null. | S1–S6 |
| A8 | `/v1/me` exposes `type`, `owned` and `limits`. | R13 |
| A9 | OpenAPI and the API version are bumped, and `openapi:check` passes. | build gate |
| A10 | ADR-037 is amended to allow a *standalone* owned org, and the route inventory still has no signup, invite or reset route. | N1 |

## 2. Solution

```
POST /v1/profiles  (session · no X-Mutaba3a-Profile · identityIdempotent 'profiles.create')
  ├─ zod: name 1..80 trimmed · type PERSONAL|BUSINESS · defaultCurrency ∈ SUPPORTED_CURRENCIES
  │        · timezone refine(isValidTimezone)                              ──► 422 VALIDATION_FAILED
  ├─ store.organizations.createOwned(user.id, input, MAX_OWNED_PROFILES)  ── ONE transaction ──
  │     lock users row FOR UPDATE · count orgs WHERE owner_user_id = user
  │     ≥ cap ⇒ 'limit'                                                    ──► 409 CONFLICT {reason PROFILE_LIMIT, limit}
  │     insert org {ownerUserId, profileType, slug p-<uuid>, version 1} · insert membership
  ├─ audit USER: organization.created {type, owned:true} + membership.granted
  └─ 201 HostedProfile (the same shape /v1/me lists)

PATCH /v1/profiles/{id}  (session · no profile header · If-Match · body {name?, defaultCurrency?, type?})
  ├─ org = getById(id); not a member ⇒ 404 · member but ownerUserId ≠ caller ⇒ 403 READ_ONLY_PROFILE {reason NOT_OWNER}
  ├─ name/currency ⇒ organizations.updateOwned(id, owner, expectedVersion, patch)   stale ⇒ 409 VERSION_MISMATCH
  ├─ type ≠ current ⇒ organizations.changeProfileType(id, owner, expectedVersion, type, preset(locale), now)
  │     ONE transaction: version check+bump · UPDATE expenses SET category_id=NULL, version+1
  │       WHERE org AND category_id IS NOT NULL (count non-deleted) · DELETE expense_categories WHERE org
  │       · INSERT preset rows
  ├─ audit USER: organization.updated {fields} | organization.type_changed {from,to,uncategorized,deletedCategories,preset}
  │         + SYSTEM expense_category.seeded {preset,count,locale}  (same shape as the lazy seed)
  └─ 200 { profile: HostedProfile, typeChange?: { uncategorizedExpenses, deletedCategories, preset } }

GET /v1/profiles/{id}/type-change?to=PERSONAL|BUSINESS   (preview; owner only; read-only)
  └─ 200 { uncategorizedExpenses, deletedCategories, preset }   (to = current type ⇒ all zeros)
```

### 2.1 Schema: one additive migration, `<ts>_mut182_owned_profiles`

- `enum ProfileType { PERSONAL BUSINESS }` (PATTERNS :2097 gives the enum its own migration).
- New `Organization` columns:
  - `ownerUserId String? @db.Uuid` with an index and `onDelete: Restrict`.
  - `profileType ProfileType?`
  - `version Int @default(1)`
- **`personalOwnerUserId` stays as it is: unique, and still the MUT-120 marker.** It means "this is the account's default personal profile"; `ownerUserId` means "a user owns and controls this". Two columns, because the uniqueness that protects MUT-120 can't sit on a column that allows 6 rows per user.
- CHECK constraints (the invariant lives in the schema, PATTERNS :2080):
  - `(owner_user_id IS NULL) = (profile_type IS NULL)`
  - `personal_owner_user_id IS NULL OR (owner_user_id = personal_owner_user_id AND profile_type = 'PERSONAL')`
- The backfill runs in the same SQL: `UPDATE organizations SET owner_user_id = personal_owner_user_id, profile_type = 'PERSONAL' WHERE personal_owner_user_id IS NOT NULL`. It is deterministic, so it needs no post-roll step. Every write path from now on sets the new columns:
  - `users.create`'s personal organization
  - `post-roll.createPersonalProfile`
- Operator firms keep `ownerUserId = null` and `profileType = null`. Their behaviour is unchanged.

### 2.2 Store ports (`ports.ts`), memory + Prisma, store-guard

| Method | Guard class | Notes |
|---|---|---|
| `organizations.createOwned(ownerUserId, input, cap)` → `{kind:'created', organization, membership} \| {kind:'limit', count}` | `sessionOnly` | One tx. Takes a row lock on the user, so two concurrent creates at 5 can't both pass |
| `organizations.countOwnedBy(userId)` | `sessionOnly` | Used by `/v1/me` limits |
| `organizations.updateOwned(id, ownerUserId, expectedVersion, patch)` → `UpdateResult<Organization>` | `sessionOnly` | `updateMany where {id, ownerUserId, version}`: the owner check is enforced in the query too |
| `organizations.changeProfileType(id, ownerUserId, expectedVersion, type, preset, at)` → `UpdateResult<{organization, uncategorized, deletedCategories}>` | `sessionOnly` | One tx (no `store.transaction` exists, so atomicity lives in the repo method, as in `inboxEntries.fileAsExpense`) |
| `organizations.typeChangeImpact(id)` → `{uncategorizedExpenses, deletedCategories}` | `sessionOnly` | Two `count`s |

`organizations.create` stays `'operator'`. The operator routes and decision 1 are unchanged.

### 2.3 One door for "owned" (PATTERNS :2080)

`ownedProfileConflict(org, message)` replaces the four inline `personalOwnerUserId` checks and keys on `ownerUserId`:
- `reason: 'PERSONAL_PROFILE'` when the org is the MUT-120 default. This keeps the public reason code for existing admin tooling and tests.
- `reason: 'OWNED_PROFILE'` otherwise.

| Site | Today | After |
|---|---|---|
| `routes/admin.ts:150` issue API key | `personalOwnerUserId` | `ownerUserId` ⇒ 409 |
| `auth/middleware.ts:232` key reaches org | `personalOwnerUserId` | `ownerUserId` ⇒ 409, so `/v1/integration/bind` is unreachable |
| `routes/admin-users.ts:122` provision into org | `personalOwnerUserId` | `ownerUserId` ⇒ 409 |
| `routes/admin-users.ts:235` grant to another user | `personalOwnerUserId ≠ user` | `ownerUserId ≠ user` ⇒ 409 |
| `routes/admin-users.ts:263` revoke owner's own membership | `personalOwnerUserId = user` | `ownerUserId = user` ⇒ 409 |
| `scripts/post-roll.ts:50` pick the oldest *firm* | `personalOwnerUserId: null` | `ownerUserId: null` |

### 2.4 What stays personal-specific (deliberately)

- `isPersonalDefault` stays true only on the MUT-120 profile. Flutter's `Me.personalProfile` (`auth.dart:214`) and `default_capture_profile.dart` depend on there being exactly one.
- **The preset selector moves from "personal" to "type".** `presetFor({writerOfRecord, personal})` becomes `presetFor({writerOfRecord, profileType})` with this precedence:
  1. MALAFAT ⇒ lawFirm
  2. `PERSONAL` ⇒ personal
  3. otherwise ⇒ general (BUSINESS and operator firms)
  
  The MUT-120 profile is `PERSONAL` after the backfill, so its seeding is unchanged. `backfill-personal-expense-categories.ts:48` filters on `profileType: 'PERSONAL'`.

### 2.5 Writability: no server change, one portal change

- **Server:** `sessionAccessFor` already keys on `profileWriter === null` (MUT-65). An owned profile has no Malafat binding, because the guards in §2.3 make one impossible, so it is already read-write for customers, projects and payments, and income rules are `{received, owed}`. A1–A3 hold on the server with no writability edit.
- **Portal:** the MUT-133 gate `incomeAffordancesFor` (`src/hosted/data/incomeAffordances.ts:32`) and `ReadOnlyNotice.tsx:19` key on `isPersonalDefault`. They switch to `owned`, so a Business profile gets Add income and Record payment (A3). This is the only client edit in this ticket. The profile-management UI is MUT-183.
- **Flutter:** no change needed. It treats a profile with no writer as personal for capture (`auth.dart:185`), and the new fields are additive.

### 2.6 `/v1/me` and the `HostedProfile` contract (additive)

- `HostedProfile` gains:
  - `owned: boolean`
  - `type: 'PERSONAL' | 'BUSINESS' | null` (null on operator firms)
  - `version: number`, which is the If-Match value
- `Me` gains `limits: { ownedProfiles: number, maxOwnedProfiles: number }`.
- **Order (the MUT-120 contract, :1837) is extended, not broken:**
  1. operator firms
  2. owned BUSINESS and extra PERSONAL profiles, by `createdAt`
  3. the `isPersonalDefault` profile last
  
  Side effect: a user with no firm now opens their first owned business profile instead of Personal, because the portal opens `profiles[0]`. See R-4.

### 2.7 API contracts and error states

| Case | Response |
|---|---|
| Missing or invalid field, bad zone (TD-091), unsupported currency | 422 `VALIDATION_FAILED {field}` |
| Missing Idempotency-Key on POST | 422 `IDEMPOTENCY_KEY_REQUIRED` |
| Replay with the same key and body | the original 201 |
| Same key, different body | 422 `IDEMPOTENCY_KEY_REUSED` |
| Cap reached | 409 `CONFLICT {reason:'PROFILE_LIMIT', limit:6}` |
| Not a member of `{id}` | 404 `NOT_FOUND` (existence isn't leaked) |
| Member but not owner | 403 `READ_ONLY_PROFILE {reason:'NOT_OWNER'}` |
| If-Match missing | 422 |
| If-Match stale | 409 `VERSION_MISMATCH {currentVersion}` |
| API-key or device-session principal on create | API key: `PRINCIPAL_NOT_ACCEPTED` (route `security` is session and device session) |
| PATCH `type` equal to the current type | No wipe, `typeChange` omitted, version still bumped only if other fields changed |
| Empty PATCH body | 422 |

The API version goes to **`1.22.0-mut182`**: `app.ts:114`, plus the four hard-coded test strings. Also regenerate `openapi.yaml` and `src/hosted/api/schema.d.ts` (`hosted:types`).

## 3. Reuse

- Route shape: `routes/expense-categories.ts`, which uses `SESSION_ONLY`, If-Match, `versionMismatch`, and the audit helper.
- Idempotency: `identityIdempotent(store, 'profiles.create')` (ADR-061 / MUT-131, as `POST /v1/inbox` uses it).
- Org-independent routing: add the keys to `ORGANIZATION_INDEPENDENT_ROUTES` (`sessions.ts:31`).
- Atomic org + membership: the `users.create` tx (`prisma.ts:138`).
- Presets: `presetFor` and the `seed` row builder. The seed insert is shared with `changeProfileType`, so there's one row builder.
- Validators: `CurrencySchema`, `isValidTimezone` (`dates.ts:16`), and the slug style from `personal-profile.ts:14`.
- `HostedProfile` serialization: build it in a single `hostedProfileFor(org, writer, user)` used by `/v1/me`, POST and PATCH, so the three can't drift.

## 4. Impact

- **Docs and decisions:**
  - ADR-037 gets a MUT-182 amendment:
    - Decision 1: a session may create a *standalone* org it owns. Users, memberships for others, and API keys stay operator-only.
    - Decision 2: still Membership × Organization; ownership is a column.
    - hosted-portal.md :223 is rewritten to match.
  - ADR-066 is amended: "seeds once" now reads "seeds once per type; a type change replaces the set".
  - TD-018 is partly reversed (self-serve *standalone* orgs exist now).
  - hosted-portal.md §5 matrix gets a `profiles` row (session read-write, API key none), and the drift test updates with it.
  - No new ADR number; these are amendments.
- **Tests that change:**
  - `store-contract-users.ts`: the personal org now carries owner and type.
  - `routes-sessions.test.ts`: new fields and order.
  - `presets.test.ts`
  - `post-roll.test.ts`
  - `route-security.test.ts` and `writability-routes.test.ts` lists
  - The four API_VERSION strings
  - Portal: `incomeAffordances.test.ts`, `views.test.tsx`
- **Clients:**
  - Portal: the gate switch only.
  - Flutter: additive fields, no change.
  - MUT-183 and MUT-184 consume `version`, `owned`, `type`, `limits` and the preview.

## 5. Test plan (TDD: written first, red, then green)

**Store contract, memory + Postgres (`store-contract-profiles.ts`)**
- C1: createOwned writes the org with owner, type and version 1, plus the membership.
- C2: A user's personal org from `users.create` has `ownerUserId = id` and `PERSONAL`.
- C3: The 6th create succeeds; the 7th returns `limit` (personal counted).
- C4: Two concurrent creates at count 5 ⇒ exactly one is created (Postgres).
- C5: `updateOwned` returns updated, stale, not_found, and not_found when the owner is wrong.
- C6: `changeProfileType` nulls `categoryId` on live and soft-deleted expenses, bumps their version, and returns the live count.
- C7: It deletes custom and archived categories and seeds the preset rows.
- C8: Stale version ⇒ nothing changed (atomicity).
- C9: An operator firm (owner null) ⇒ not_found.

**Routes (`routes-profiles.test.ts`)**
- R1: POST 201 HostedProfile shape.
- R2: Replay with the same key ⇒ same body; the key reused with a different body ⇒ 422.
- R3: Bad name, currency or zone ⇒ 422.
- R4: Audit rows are written.
- R5: 7th ⇒ 409 PROFILE_LIMIT.
- R6: Rename.
- R7: Currency change leaves existing projects and expenses alone.
- R8: Stale If-Match ⇒ 409.
- R9: Type change response counts, and `GET /v1/expense-categories` returns the new preset in the user's locale.
- R10: Preview equals the actual counts; `to` equal to the current type ⇒ zeros.
- R11: Firm member ⇒ 403 NOT_OWNER; non-member ⇒ 404.
- R12: API-key principal ⇒ refused.
- R13: `/v1/me` `owned`, `type`, `version`, `limits`, the order, and `isPersonalDefault` only on the MUT-120 profile.
- R14: On an owned BUSINESS profile, the session can create a customer and a project, `POST /v1/income` (received + owed) works, settle works, and expense create works.

**Standalone guarantee (`routes-owned-profiles-standalone.test.ts`)**
- S1: The admin issue-key call on an owned BUSINESS profile ⇒ 409 OWNED_PROFILE.
- S2: A key on that profile, inserted directly into the store, ⇒ refused at authentication.
- S3: `/v1/integration/bind` is unreachable.
- S4: `grant:user` to another user ⇒ 409.
- S5: `provision:user --organization-id` with the owned profile ⇒ 409; revoking the owner's membership ⇒ 409.
- S6: `writerOfRecord` is null in `/me`.

**Guards, drift and inventory**
- G1: `store-guard.test.ts` classifies every new method; `organizations.create` is still `operator`.
- N1: `no-self-registration.test.ts` stays green.
- `writability-drift` passes with the `profiles` row.
- `presets.test.ts`: the type selector.
- `post-roll.test.ts`: new personal profiles carry owner and type, and the firm choice skips owned orgs.

**Portal**
- P1: `incomeAffordances.test.ts`: an owned BUSINESS profile gets kinds and canSettle; a writer-null operator firm still doesn't.
- P2: `ReadOnlyNotice` doesn't show the read-only notice on owned profiles.

**Commands (Node 22):**
- Server: `npm --prefix server run typecheck && npm --prefix server run lint && npm --prefix server run openapi:check && npm --prefix server test`.
- `test:db` runs against the `mutaba3a-test-pg` scratch container (port 54329), after `prisma migrate deploy` and `prisma:generate`.
- Root: `npm run lint && npm run typecheck && npm run test:run && npm run build && npm run hosted:types:check`.

## 6. Cost, scale, infra

- Create: 1 lock + 1 count + 2 inserts.
- Type change: one `updateMany` bounded by the profile's expenses, one `deleteMany` (≤ a few dozen rows), and one ~16-row insert.
- `/v1/me` keeps its N+1 over memberships. N is at most 6 plus firms, so it isn't worth fixing here.
- One additive migration and no new infrastructure or environment variables. `MAX_OWNED_PROFILES = 6` is a module constant in `server/src/profiles/compose.ts`, following the `MAX_RECEIPTS_PER_EXPENSE` convention. It is a product limit, not deploy configuration.
- i18n: server-side preset names are already en/ar; new user-facing copy belongs to MUT-183/184.

## 7. Risks

- **R-1** Changing the type deletes categories that a concurrent `POST /v1/expenses` just validated. Its insert then fails the foreign key. Map Prisma P2003 on `expenses.category_id` to 422 `VALIDATION_FAILED {field:'categoryId'}`, not a 500.
- **R-2** A replay of an expense create cached before the type change returns a `categoryId` that no longer exists. Clients refetch categories after a type change (MUT-183/184 AC), so this is acceptable.
- **R-3** Deleting a user who owns profiles is blocked by `Restrict`. Account deletion is a manual operator process today (privacy policy: email), so the operator removes those organizations first. This gets documented in `server/DEPLOYMENT.md`.
- **R-4** The portal's default landing changes from Personal to a user's first business profile once they create one. It is in the MUT-182 order contract; MUT-183 may override it with "last opened".

---

# Eng review (`/plan-eng-review`, 2026-10-14)

**Target:** this brief (`.claude/designs/mut-182-profile-management-api.md`). It is also the report file.

## Scope record

feature answers: no cuts were proposed, because every component maps to AC A1–A10.
structure: B, Smaller arrangement (D1, answered 2026-10-14).
accepted scope: the §2 features unchanged, with this layout:
- `server/src/routes/profiles.ts` is the only new module and exports `MAX_OWNED_PROFILES = 6`.
- `hostedProfileFor` lives in the existing `server/src/serializers.ts`, shared by `/v1/me`, POST and PATCH.
- There is no `server/src/profiles/compose.ts`.

pending remedies: R1, R2.
Scope Challenge result: scope accepted as-is.

## Factual corrections (no behavior change, no question)

- **FC1, §2.7 error table.** The create route's `security` is `SESSION_ONLY = [{session}, {deviceSession}]` (`routes/expense-categories.ts:22`), so **device sessions may create and patch**. MUT-184 (Flutter) depends on this. Only API-key principals are refused. The brief's row said "API-key or device-session principal on create", which was wrong.
- **FC2, §2.4.** `scripts/backfill-personal-expense-categories.ts:48` stays keyed on `personalOwnerUserId`. It is a one-off MAL-1137 fix-up, and new PERSONAL-type profiles are seeded with the current preset, so changing its filter would change nothing. The bullet that proposed editing it is withdrawn.
- **FC3, §3.** The "Reuse" line for `hostedProfileFor` now reads `serializers.ts` (per D1).

## Decision ledger

### R1: Can the account's default personal profile (MUT-120) change type?
Finding: SC-1, P2, confidence 9/10, brief §2.1 (Claude review).
- The brief's CHECK constraint `personal_owner_user_id IS NULL OR (owner_user_id = personal_owner_user_id AND profile_type = 'PERSONAL')` forbids the MUT-120 profile from ever being BUSINESS.
- Epic MUT-181 says only "users can change a profile's type". It doesn't say whether that includes the default personal profile.
- Flutter `Me.personalProfile` (`auth.dart:214`) and `default_capture_profile.dart` treat that profile as "Personal".

Plan baseline: the original proposal locks it implicitly through the CHECK constraint. No approval yet.
Runtime evidence: there is no type column today. `isPersonalDefault` is computed at `routes/sessions.ts:142`.

Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| R1 default-personal type | implicit lock (CHECK), unapproved | locked to PERSONAL. PATCH `type` on it ⇒ 409 CONFLICT `{reason:'DEFAULT_PERSONAL_PROFILE'}`; rename and currency allowed; CHECK kept; test asserts the 409 and an unchanged category set | changeable like any owned profile. The CHECK drops its `profile_type` clause; a BUSINESS-typed profile can stay `isPersonalDefault`; test asserts the reseed works on it |
| R2 org-row lock | pending | pending | pending |

Question D2:
D2 — Can the account's built-in Personal profile be switched to Business?
Project/branch/task: MUT-182 plan; every hosted user already has one built-in Personal profile (MUT-120) that the phone treats as its default.
ELI10: Users will be able to flip a profile between Personal and Business, which swaps its expense categories. The question is whether that applies to the built-in Personal profile every account starts with, or only to profiles the user creates. If the built-in one can become Business, the phone's "Personal" default would point at a business profile.
Stakes if we pick wrong: Lock it when users need it, and they create a new Business profile instead (cheap). Allow it, and the phone's default "Personal" capture target silently files into business categories.
Recommendation: A because the built-in profile's whole meaning is "personal", and a user who wants a business just creates one (cap 6).
Completeness: A=9/10, B=8/10
Pros / cons:
A) Lock built-in to Personal (recommended)
  ✅ The phone's default Personal capture target always means personal spending, no surprises
  ✅ A database CHECK enforces it, so no code path can flip it by accident
  ❌ A user who wants their only profile to be Business must create a second one
B) Allow switching it
  ✅ Users with no personal spending can repurpose their one starter profile directly
  ✅ One rule for every owned profile, with no special case in the API
  ❌ isPersonalDefault and type can disagree, confusing Flutter's Personal default and the portal
Net: a small special case (A) buys a stable meaning for the account's default profile.
Header: Personal lock
Options:
A) Lock built-in to Personal (recommended)
The MUT-120 profile stays PERSONAL. PATCH type on it returns 409 CONFLICT reason DEFAULT_PERSONAL_PROFILE; rename and currency still work. The CHECK constraint is kept. A test asserts the 409 and that its categories are untouched.
B) Allow switching it
The MUT-120 profile can become BUSINESS like any owned profile. The CHECK drops its profile_type clause, so isPersonalDefault can be true on a BUSINESS profile. A test asserts the reseed works on it. Flutter/portal must cope with a Business-typed default.

State: approved
Actual answer: A, "Lock built-in to Personal (recommended)" (D2, answered 2026-10-14)
Accepted scope: The MUT-120 default profile is locked to PERSONAL.
- PATCH with `type` on it returns 409 CONFLICT `{reason:'DEFAULT_PERSONAL_PROFILE'}`. Rename and currency still work.
- The §2.1 CHECK constraint is kept as written.
- Test R15: the 409 is returned, and the profile's category set and version are unchanged.
History: none

## Section 1: Architecture review

- [P3] (confidence: 8/10) `server/src/repositories/prisma.ts:1109-1117`. The lazy seed is `if ((await tx.expenseCategory.count({ where: { organizationId } })) > 0) return false;` followed by `createMany({... skipDuplicates: true })`. Its preset is chosen *outside* the transaction (`routes/expense-categories.ts:57`). Suppose a type change (§2 `changeProfileType`) runs on a profile that has never been listed while the first `GET /v1/expense-categories` is in flight. The lazy seed can then insert the **old** type's preset. `skipDuplicates` only dedups identical names, so the profile ends up with a mixed set. The window is narrow, but the result is permanent. See R2.
- No other architecture issues. Ownership is enforced inside the update query (`updateMany where {id, ownerUserId, version}`). A non-member gets 404, so profile existence never leaks. The migration order is: add columns → backfill UPDATE → add CHECK. That order is required work for §2.1, not a choice.

### R2: Serialize category seeding with a type change
Finding: A-1, P3, confidence 8/10, `server/src/repositories/prisma.ts:1109-1117` (Claude review).
Plan baseline: the original proposal has no lock between `expenseCategories.seed` and `changeProfileType`.
Runtime evidence: `seed` counts, then inserts with `skipDuplicates`. Its comment (:1112) covers two seeds of the *same* preset racing, not two different presets.

Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| R1 default-personal type | approved: locked (D2) | locked (D2), unchanged | locked (D2), unchanged |
| R2 seed vs type change | no lock, mixed preset possible | `SELECT id FROM organizations WHERE id = $1 FOR UPDATE` as the first statement in both `expenseCategories.seed` and `changeProfileType`. A seed waiting on the lock then sees the new rows and returns false. A Postgres test races the two calls and asserts a single preset. | no lock; the narrow race is recorded as a TD entry |

Question D3:
D3 — Lock the profile row so a type change and the first category load can't mix two presets?
Project/branch/task: MUT-182 plan, the type-change transaction in the Prisma store.
ELI10: A profile's categories are created the first time anyone opens the category list. If a user switches the profile's type at the very same moment that first list loads, both can insert categories, and the profile ends up with half personal and half business categories for good. Locking the profile's row for the few milliseconds each write takes makes one wait for the other.
Stakes if we pick wrong: Skip the lock and a rare user gets a permanently mixed category list that only a manual DB fix cleans up. The lock costs one indexed row lock per seed.
Recommendation: A because the fix is one SQL line in two places, and the failure it prevents is permanent and silent.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Lock the profile row (recommended)
  ✅ The two writers serialize, so a profile can never hold two presets at once
  ✅ Proven by one Postgres race test, reusing the C4 concurrency harness
  ❌ Adds a row lock to the lazy seed, which runs only once per profile ever
B) Accept the race, log debt
  ✅ No change to the existing seed code path that MUT-42 shipped
  ✅ The window is milliseconds wide and needs a never-listed profile
  ❌ When it hits, the mixed category set is permanent and invisible to the user
Net: one line of SQL versus a rare, permanent and silent data defect.
Header: Seed lock
Options:
A) Lock the profile row (recommended)
Both expenseCategories.seed and changeProfileType begin with SELECT id FROM organizations WHERE id = $1 FOR UPDATE inside their transactions. A Postgres test races a seed against a type change and asserts exactly one preset remains. The memory store needs no change (single-threaded).
B) Accept the race, log debt
No lock. Add a TECH_DEBT entry describing the mixed-preset race on never-listed profiles and its manual DB fix.

State: approved
Actual answer: A, "Lock the profile row (recommended)" (D3, answered 2026-10-14)
Accepted scope:
- `expenseCategories.seed` (Prisma) and `changeProfileType` each start with `SELECT id FROM organizations WHERE id = $1 FOR UPDATE` inside their transactions.
- Test C10 (Postgres) races a seed against a type change and asserts exactly one preset remains.
- No memory-store change.
History: none

Section 1 dispositions: A-1 accepted (R2/D3).

## Section 2: Code quality review

- [P2] (confidence: 9/10) Brief §2, PATCH flow. The plan calls two store methods in sequence:
  - `name/currency ⇒ organizations.updateOwned(id, owner, expectedVersion, patch)`
  - `type ≠ current ⇒ organizations.changeProfileType(id, owner, expectedVersion, type, …)`

  Both take the same `expectedVersion` from one `If-Match`. A body like `{name, type}` therefore fails:
  - The first call bumps the version.
  - The second sees it as stale and returns 409. The rename has already committed, so the request half-applies and still reports failure.

  See R3.
- Otherwise clean. `ownedProfileConflict` gives one door for owned-profile guards (PATTERNS :2080). `hostedProfileFor` has one home (D1). Error reasons reuse the CONFLICT and VALIDATION_FAILED conventions (`errors.ts:74-77`).

### R3: Make PATCH /v1/profiles/{id} atomic across name, currency and type
Finding: CQ-1, P2, confidence 9/10, brief §2 PATCH flow (Claude review).
Plan baseline: the original proposal uses two store methods sharing one expectedVersion, which is non-atomic.
Runtime evidence: n/a (proposed code). Existing PATCH routes (`customers.ts:155`, `expense-categories.ts:88`) each make exactly one versioned store call per request.

Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| R1 default-personal type | approved: locked (D2) | unchanged | unchanged |
| R2 seed lock | approved: lock (D3) | unchanged; the merged method also takes the lock | unchanged |
| R3 PATCH atomicity | two calls, one version, half-apply possible | one store method `organizations.updateOwned(id, owner, expectedVersion, {name?, defaultCurrency?, type?}, preset, at)`. One tx: lock, version check, field updates, and (if type changes) uncategorize + delete + reseed; one version bump. `changeProfileType` disappears as a separate port. Test R16: `{name, type}` in one PATCH applies both with a single version bump. | keep two methods; the route rejects a body mixing `type` with other fields (422 `VALIDATION_FAILED {reason:'TYPE_CHANGE_ALONE'}`); test asserts the 422 |

Question D4:
D4 — One PATCH should rename and change type together, or refuse the mix?
Project/branch/task: MUT-182 plan, PATCH /v1/profiles/{id} store design.
ELI10: The plan saves a profile edit with two separate database calls that both check the same version number. If someone renames a profile and switches its type in one save, the first call bumps the version, the second thinks the data is stale and fails, and the rename is already saved. The user sees an error for something that half happened.
Stakes if we pick wrong: Clients (portal, Flutter) get an error after a partial write, and their form state stops matching the server.
Recommendation: A because one versioned write per request is how every other PATCH in this server works, and it removes the half-apply case entirely.
Completeness: A=10/10, B=8/10
Pros / cons:
A) One atomic store method (recommended)
  ✅ Any combination of name, currency and type commits together or not at all
  ✅ Matches the existing one-versioned-call-per-PATCH shape in customers and categories
  ❌ The single store method is bigger, since it holds the reseed branch as well
B) Refuse mixed bodies
  ✅ Keeps the two small store methods the brief proposed
  ✅ The type change stays a visibly separate, deliberate action
  ❌ MUT-183/184 forms must send two requests and handle a 409 between them
Net: A removes the failure; B makes clients work around it.
Header: PATCH atomicity
Options:
A) One atomic store method (recommended)
organizations.updateOwned takes {name?, defaultCurrency?, type?} plus the preset and does everything in one transaction with one version bump (including the D3 lock and the reseed when type changes). changeProfileType is not a separate port. Test R16 asserts a {name, type} PATCH applies both atomically.
B) Refuse mixed bodies
Keep updateOwned and changeProfileType as two ports. The route returns 422 VALIDATION_FAILED reason TYPE_CHANGE_ALONE when type is sent with any other field. A test asserts the 422.

State: approved
Actual answer: A, "One atomic store method (recommended)" (D4, answered 2026-10-14)
Accepted scope: `organizations.updateOwned(id, ownerUserId, expectedVersion, {name?, defaultCurrency?, type?}, preset, at)` is the single store call for PATCH. It runs one transaction:
1. the D3 org-row lock
2. the version check
3. the field updates
4. when `type` changes: uncategorize, delete and reseed
5. one version bump

`changeProfileType` is no longer a separate port; §2.2's table row is superseded. Test R16: a `{name, type}` PATCH applies both, and the version rises by exactly 1.
History: none

Section 2 dispositions: CQ-1 accepted (R3/D4).

## Section 3: Test review

Framework: Vitest. Server: `npm --prefix server test` (memory) plus `test:db` (Postgres, `MUTABA3A_TEST_DATABASE_URL`). Portal: `npm run test:run`. Every proposed test below carries over from brief §5 or was approved in D2–D4. No new test policy was introduced.

```
CODE PATHS                                                   USER FLOWS (API clients: portal, Flutter)
[+] POST /v1/profiles (routes/profiles.ts)                    [+] Create a business profile
  ├── zod name/type/currency/zone ── [PLANNED ★★★] R3          ├── [PLANNED ★★★] 201 + appears in /v1/me — R1, R13
  ├── identityIdempotent ─────────── [PLANNED ★★★] R2          ├── [PLANNED ★★★] double-submit → same 201 — R2
  ├── createOwned tx                                          └── [PLANNED ★★★] 7th → 409 PROFILE_LIMIT — R5
  │   ├── user row lock + count ─── [PLANNED ★★★] C3, C4 (race, PG)
  │   ├── limit → 409 ───────────── [PLANNED ★★★] R5          [+] Edit a profile
  │   └── org + membership insert ─ [PLANNED ★★★] C1           ├── [PLANNED ★★★] rename / currency — R6, R7
  └── audit ─────────────────────── [PLANNED ★★ ] R4           ├── [PLANNED ★★★] stale tab → 409 VERSION_MISMATCH — R8
[+] PATCH /v1/profiles/{id}                                   ├── [PLANNED ★★★] rename + type in one save — R16
  ├── not member → 404 / not owner → 403 ── [PLANNED ★★★] R11 └── [PLANNED ★★★] built-in Personal type → 409 — R15
  ├── default personal + type → 409 ─────── [PLANNED ★★★] R15
  └── updateOwned tx (D3 lock, D4 single method)              [+] Change type (destructive)
      ├── stale → 409 ───────────── [PLANNED ★★★] C5, R8       ├── [PLANNED ★★★] preview count == actual — R10
      ├── fields only ───────────── [PLANNED ★★★] R6, R7       ├── [PLANNED ★★★] new preset listed after — R9
      └── type change                                         └── [PLANNED ★★★] concurrent first list → one preset — C10
          ├── uncategorize (live + soft-deleted) ─ [PLANNED ★★★] C6
          ├── delete custom + archived ─────────── [PLANNED ★★★] C7
          ├── reseed in locale ─────────────────── [PLANNED ★★★] C7, R9
          └── atomic on stale ──────────────────── [PLANNED ★★★] C8
[+] GET /v1/profiles/{id}/type-change ── [PLANNED ★★★] R10
[+] ownedProfileConflict (5 sites) ───── [PLANNED ★★★] S1–S5 + existing MUT-120 tests (regression, below)
[+] presetFor(type) ──────────────────── [PLANNED ★★★] presets.test.ts rows
[+] /v1/me owned/type/version/limits/order ─ [PLANNED ★★★] R13
[+] post-roll createPersonalProfile owner/type + firm pick ─ [PLANNED ★★] post-roll.test.ts (PG)
[+] expense create FK race (P2003 → 422) ── [PLANNED ★★] R17 (store-level: dangling categoryId ⇒ 422, not 500)
[+] migration backfill of existing MUT-120 rows ── [PLANNED, manual] M1
[+] portal incomeAffordancesFor(owned) ── [PLANNED ★★★] P1 ; ReadOnlyNotice ── [PLANNED ★★] P2
[+] owned BUSINESS profile writes (income/customer/project/expense/settle) ── [PLANNED ★★★] R14 [→E2E-ish route chain]

COVERAGE (planned): 34/34 paths have a planned ★★ or better test | GAPS: 0 after the R17 + M1 additions
```

**Regression contract (carried forward, IRON RULE).** Five guards move from `personalOwnerUserId` to `ownerUserId`. Every MUT-120 behaviour on the *default personal* profile is preserved and is already pinned by existing tests, which must pass **unchanged**, apart from the additive `/v1/me` fields:
- `routes-users.test.ts` (8): PERSONAL_PROFILE on grant, provision-into and revoke.
- `routes.test.ts` (6): "personal profiles are never bound, keyed…", reason `PERSONAL_PROFILE`.
- `routes-sessions.test.ts` (5): one `isPersonalDefault`, personal last.
- `store-contract-users.ts`: unique personal; it gains owner/type asserts.

The one intended difference: those same refusals now also fire on non-default owned profiles, with reason `OWNED_PROFILE` (S1–S5).

**Additions from this review:**
- **R17.** `server/src/__tests__/routes-expenses.test.ts`, new row: an expense create whose `categoryId` row is deleted between validation and insert returns 422 `VALIDATION_FAILED {field:'categoryId'}`, not 500. Simulate it by deleting the category in the store before the insert; on the memory store, use the FK check. Value: protects=a type change racing an expense create never 500s; fails_when=P2003 is not translated; why_new=no FK-race test exists; seam=none.
- **M1 (manual, recorded in the PR).** On the `mutaba3a-test-pg` scratch DB:
  1. Migrate to the pre-MUT-182 head.
  2. Create a user with `provision:user`.
  3. Run `prisma migrate deploy`.
  4. Assert the personal org has `owner_user_id = personal_owner_user_id` and `profile_type = 'PERSONAL'`.
  
  This can't be an automated test, because the new CHECK constraint forbids the pre-state once migrated.

Tests made obsolete: none.

Section 3 dispositions: no new choices. R17 and M1 are required proof of the approved R-1 and §2.1 behaviour.

## Section 4: Performance review

No issues found.
- Create costs one lock, one count and two inserts.
- A type change costs one `updateMany` over the profile's expenses (indexed on `category_id`, `schema.prisma:936`), one `deleteMany` of at most a few dozen rows, and a ~16-row insert.
- `/v1/me` adds one `countOwnedBy`. Its existing N+1 is at most 6 owned profiles plus firms.
- The D3 lock serializes only writers on a single org row.

Section 4 dispositions: none.

## Outside voice

Outside voice is unavailable: `CODEX_MODE: not_installed`. The native fallback needs TaskOutput, which this session doesn't have, so this is missing coverage, not a clean review. Logged as `codex-plan-review` with `outside_status: unavailable`.

## TODO choices

### R4: TODO, archive or delete an owned profile (cap lock-in)
Finding: TODO-1, P3, confidence 8/10, epic MUT-181 Scope (out) "Archiving or deleting a profile" plus brief §2.2 cap (Claude review). With a cap of 6 and no way to remove a profile in v1, a user who creates throwaway profiles hits the cap permanently and needs an operator DB fix.
Plan baseline: out of scope per the MUT-181 owner ruling. No follow-up is recorded.
Runtime evidence: none exists (no delete path for organizations anywhere).

Comparison grid:

| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1–R3 | approved (D2–D4) | unchanged | unchanged | unchanged |
| R4 archive/delete follow-up | not recorded | add a TODOS.md entry, and file a MUT ticket under MUT-181 via `/pm-intake` | skip; nothing recorded | build archive in MUT-182 now (expands the approved scope against the owner's out-of-scope ruling) |

Question D5:
D5 — Record a follow-up for archiving/deleting owned profiles?
Project/branch/task: MUT-182 plan; MUT-181 put archive and delete out of scope for v1.
ELI10: Users can create up to 6 profiles but can't remove any in v1. Someone who makes a few test profiles is stuck at the cap for good, and only an operator editing the database can free a slot. This asks whether to write that down as follow-up work now.
Stakes if we pick wrong: Skip it and the first user who hits the cap becomes a support ticket with no product answer.
Recommendation: A because it costs nothing now and keeps the owner's v1 cut intact while making the gap visible.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Add TODO + ticket (recommended)
  ✅ The cap lock-in is visible in TODOS.md and on the MUT-181 board before users hit it
  ✅ Respects the owner's v1 cut: nothing is built now
  ❌ One more backlog item to groom
B) Skip
  ✅ Backlog stays lean; revisit only if a user complains
  ✅ No ticket churn for a scenario that may never happen
  ❌ The first stuck user needs a manual DB fix with no tracked plan
C) Build it now
  ✅ Closes the gap before launch, so nobody can get stuck at the cap
  ✅ Shares the transaction and guard code being written in this ticket anyway
  ❌ Reverses the owner's out-of-scope ruling and grows MUT-182 materially
Net: write it down now (A), or build it now against the v1 cut (C).
Header: Archive TODO
Options:
A) Add TODO + ticket (recommended)
Add a TODOS.md entry (What/Why/Pros/Cons/Context/Depends on MUT-182) and file a MUT Story under MUT-181 via /pm-intake. Nothing built now.
B) Skip
Record nothing. Revisit only if a user reports being stuck at the cap.
C) Build it now
Add archive (and the cap excluding archived) to MUT-182 scope. Reverses the MUT-181 out-of-scope ruling; needs new tests and an ADR note.

State: approved
Actual answer: A, "Add TODO + ticket (recommended)" (D5, answered 2026-10-14)
Accepted scope: TODOS.md #13 was added, and MUT-193 was filed under MUT-181 (Backlog; MUT-182 blocks MUT-193). Nothing was built in MUT-182.
History: none

Approval readiness: PASS. R1 (D2 A), R2 (D3 A), R3 (D4 A) and R4 (D5 A) each cite their own answer from 2026-10-14. The scope record is D1 B. The regression contract is carried forward unchanged (existing MUT-120 tests).

## NOT in scope

- **Archive/delete owned profiles.** Ruled out of v1 by MUT-181. Follow-up: MUT-193 / TODOS #13 (D5).
- **Profile-management UI.** That is MUT-183 (portal) and MUT-184 (Flutter). This ticket only switches the portal's MUT-133 income gate to `owned` (AC A3).
- **Linking a user-owned profile to Malafat later.** The owner ruled standalone-only. A firm that wants Malafat gets a separately provisioned org, and owned-profile data is not migrated.
- **Fixing `/v1/me` N+1.** It is bounded at 6 owned profiles plus firms.
- **Editing a profile's timezone.** Owner ruling: the timezone is set at creation.
- **Flutter changes.** The new `/v1/me` fields are additive. Flutter's "writer-null ⇒ personal UI" (`auth.dart:185`) is MUT-184's to revisit for Business profiles (MUT-163's category-first File flow).

## What already exists (reused, not rebuilt)

- Session route shape, `SESSION_ONLY`, If-Match, `versionMismatch` and audit: `routes/expense-categories.ts`, `if-match.ts`, `routes/shared.ts:83`.
- User-keyed idempotency: `identityIdempotent` (`idempotency.ts:105`, ADR-061), as `POST /v1/inbox` uses it.
- Org-independent routing: `ORGANIZATION_INDEPENDENT_ROUTES` (`routes/sessions.ts:31`).
- Atomic org + membership create: the `users.create` transaction (`prisma.ts:138`).
- Writability for writer-null profiles: `sessionAccessFor` (MUT-65). No change needed.
- Presets and the seed row builder: `expenses/presets.ts`, plus `expenseCategories.seed`. `updateOwned` reuses the row builder.
- Validators: `CurrencySchema`, `isValidTimezone` (`dates.ts:16`).
- One door for refusals: `personalProfileConflict` (`errors.ts:74`) generalised into `ownedProfileConflict`.

## Diagrams

The create and PATCH flows are in §2, with PATCH amended by D4 into one `updateOwned` transaction:

```
PATCH /v1/profiles/{id}
  member? ──no──► 404
  owner?  ──no──► 403 READ_ONLY_PROFILE {NOT_OWNER}
  default personal && type? ──yes──► 409 DEFAULT_PERSONAL_PROFILE   (D2)
  updateOwned tx: FOR UPDATE org row (D3) → version check ──stale──► 409 VERSION_MISMATCH
                  → set name/currency → [type changed?] uncategorize → delete cats → seed preset
                  → version += 1  (once, D4) → commit → audit → 200
```

Inline diagram to keep in code: `updateOwned` in `prisma.ts` gets a short comment block listing the transaction steps in order.

## Failure modes

| Path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| POST create | double-tap on a slow network | identityIdempotent, R2 | the same 201, one profile |
| POST create | two devices create at 5/6 | user row lock, C4 | one 201, one clear 409 PROFILE_LIMIT |
| PATCH | stale tab saves an old version | If-Match, R8 | 409, and the client refetches |
| PATCH type | a seed races the type change | D3 lock, C10 | one coherent category set |
| PATCH type | an expense create races the category delete | P2003 → 422, R17 | a 422 on categoryId, re-pick the category |
| PATCH type | `{name,type}` half-applies | D4 single tx, R16 | atomic, never a partial write |
| Owned profile | API key or bind attempted by an operator script | ownedProfileConflict, S1–S5 | 409 OWNED_PROFILE (operator) |
| Migration | pre-existing personal org not backfilled | ordered SQL + CHECK, M1 | migration fails loudly rather than silently |

Critical gaps (no test, no handling and silent): **0**.

## Worktree parallelization strategy

Sequential implementation, no parallelization opportunity. Schema, store ports, guards and routes form one dependency chain in `server/`. The portal gate switch depends on the regenerated `schema.d.ts`.

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~1h / CC: ~10min)**: server/repositories: lock the default personal profile's type
  - Surfaced by: Scope Challenge, R1/D2 (CHECK vs "users can change type")
  - Files: `server/prisma/migrations/<ts>_mut182_owned_profiles/migration.sql` (CHECK kept), `server/src/routes/profiles.ts` (409 DEFAULT_PERSONAL_PROFILE)
  - Verify: R15 in `routes-profiles.test.ts`
- [ ] **T2 (P1, human: ~1h / CC: ~10min)**: server/repositories: org-row lock in `expenseCategories.seed` and `updateOwned`
  - Surfaced by: Architecture, A-1 / R2 / D3 (`prisma.ts:1109-1117`)
  - Files: `server/src/repositories/prisma.ts`
  - Verify: C10 under `npm --prefix server run test:db`
- [ ] **T3 (P1, human: ~3h / CC: ~20min)**: server/repositories: one atomic `organizations.updateOwned` (name, currency, type + reseed, one version bump)
  - Surfaced by: Code Quality, CQ-1 / R3 / D4
  - Files: `server/src/repositories/ports.ts`, `memory.ts`, `prisma.ts`, `server/src/auth/store-guard.ts`, `server/src/routes/profiles.ts`
  - Verify: R16, C5–C9 (memory + Postgres)
- [ ] **T4 (P2, human: ~30min / CC: ~5min)**: server/routes: map P2003 on `expenses.category_id` to 422
  - Surfaced by: Test review, R17 (brief R-1)
  - Files: `server/src/repositories/prisma.ts` (`translate`), `server/src/__tests__/routes-expenses.test.ts`
  - Verify: R17
- [ ] **T5 (P2, human: ~30min / CC: ~10min)**: migration: manual backfill check on the scratch DB
  - Surfaced by: Test review, M1
  - Files: none (PR note)
  - Verify: M1 steps against `mutaba3a-test-pg`
- [ ] **T6 (P3, human: ~15min / CC: ~2min)**: docs: TODOS #13 and MUT-193 for archiving (done during review)
  - Surfaced by: TODO, R4/D5
  - Files: `TODOS.md`
  - Verify: already applied

_No new tasks from Performance._ The full feature build (§2) is the ticket itself; T1–T5 are the review's amendments to it.

## Unresolved decisions

None.

## Completion summary

- Step 0: Scope Challenge — scope accepted as-is (structure B, D1).
- Architecture Review: 1 issue found (A-1, accepted).
- Code Quality Review: 1 issue found (CQ-1, accepted).
- Test Review: diagram produced, 2 gaps identified (R17, M1), both added as required proof.
- Performance Review: 0 issues found.
- NOT in scope: written.
- What already exists: written.
- TODOS.md updates: 1 item proposed to user (accepted, #13 / MUT-193).
- Failure modes: 0 critical gaps flagged.
- Unresolved decisions: 0 in this review.
- Outside voice: codex, unavailable (CLI not installed; native fallback needs TaskOutput, absent).
- Parallelization: 1 lane, 0 parallel / 1 sequential.
- Lake Score: 3/3. D2, D3 and D4 each picked the 10/10 or highest-scored option. D1 and D5 had no score.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex via `/plan-eng-review` | Independent 2nd opinion | 24 (project-wide) | unavailable | CLI not installed |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 24 (project-wide; 1 for this plan) | ISSUES OPEN (all resolved: mapped work) | 4 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 4 (other plans) | — for this plan | backend ticket; UI is MUT-183/184 |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable (not installed). There was no native substitute, so there is no outside coverage for this plan.
- **VERDICT:** Eng Review complete. Every finding is accepted and mapped to tasks T1–T5, and nothing is unresolved, so the plan is ready to implement. The status reads ISSUES OPEN only because the findings are mapped work.

NO UNRESOLVED DECISIONS
