# MUT-300 plan — Firm switch: an operator turns firm features on; the owner requests it from the portal

- **Ticket:** MUT-300 (epic MUT-298, label firm-v1). Backlog → In Progress at `/eng-build`.
- **Blocks:** MUT-302 and MUT-305.
- **Blocked by:** MUT-299 (merged to local main `1fea038d`, In Review). The gate passes.
- **Brief:** `.claude/designs/firm-books.md` §3 and §12.1 (approved 2026-10-19), ADR-099.
- **Branch:** `feature/mut-300-firm-flag`, in the epic worktree `.claude/worktrees/mut-298-firm-books`.

## 0. What the code gives us (survey 2026-10-19, paths under `server/src` unless noted)

- **Migrations** are named `YYYYMMDDHHMMSS_mutNNN_desc`. CHECKs are hand-written in `migration.sql` (MUT-182 `…/20261014120000_mut182_owned_profiles/migration.sql:45` `organizations_owner_type_check`, `:51` `organizations_personal_owned_check`).
- **Membership** is `schema.prisma:326-336` with no role. `MembershipRecord` is `repositories/ports.ts:1189-1193`. `toMembership` (`repositories/prisma.ts:1968-1970`) copies fields explicitly. The memory `grant` builds the record by hand (`repositories/memory.ts:514`).
- **Organization** is `ports.ts:21-36`. Prisma returns raw rows with no mapper (`prisma.ts:132`); memory `create` hard-codes the defaults (`memory.ts:192`).
- **There is no `organizations.update` method.** Writes are `createOwned` / `updateOwned` (`ports.ts:206-252`), each with audit inside the transaction (`personal-profile.ts:39-75`).
- **The store guard** is typed so a new repository method fails typecheck until classified (`auth/store-guard.ts:29-35`). Organizations are at `:38-49`, memberships at `:72`. `/admin` runs without a guard (`:273`).
- **`/v1/profiles`:**
  - `ownedBy(user, profileId)` (`routes/profiles.ts:51-58`) answers 404, or 403 `READ_ONLY_PROFILE {reason:'NOT_OWNER'}`.
  - `identityIdempotent` comes from `idempotency.ts:148`; `ifMatch()` from `if-match.ts:13`.
  - `MAX_OWNED_PROFILES = 6` is at `:27`. The cap counts `ownedBy(userId)` (`prisma.ts:141,151`, `memory.ts:237`), so clearing `ownerUserId` drops a converted profile from it.
- **Admin:**
  - `adminAuth` is at `routes/admin.ts:39-48`. Audit is written after the write with `actorType:'ADMIN'` (`:81-89`).
  - `serializeOrganization` is at `serializers.ts:48-60`; `OrganizationSchema` at `schemas.ts:36-51`.
  - No admin route uses If-Match or Idempotency-Key; admin routes are idempotent by construction (grant returns `created`).
- **`/v1/me`:**
  - `buildMe` is at `routes/sessions.ts:234-255`. It loops `memberships.listByUser`, but `hostedProfileFor(org, writer, userId)` (`serializers.ts:68-88`) doesn't receive the membership.
  - Schemas: `HostedProfileSchema` `schemas.ts:327-356`, `MeSchema` `:387-410`.
  - `API_VERSION = '1.36.0-mut293'` (`app.ts:131`). The committed spec is `server/openapi/openapi.yaml` (`scripts/export-openapi.ts --check`). Portal types are `src/hosted/api/schema.d.ts` (`npm run hosted:types`, checked by `scripts/check-hosted-types.ts`).
- **CLI:** `scripts/users.ts` calls the admin HTTP API: `COMMANDS` `:37`, `COMMAND_HANDLERS` `:171`, the `grant` sample `:197-202`. Tests are in `scripts/__tests__/users-cli.test.ts`.
- **Portal:**
  - `ProfilesManageDrawer.tsx` rows are buttons that open the edit form (`ProfileEditForm`), with no per-row secondary actions (`:110-147`).
  - `useMe()` is at `src/hosted/session/me.tsx:45`, keyed `ME_KEY=['me']`.
  - i18n is nested (`hosted.profiles.*` at `src/hosted/i18n/en.json:529`).
  - Dismissal precedents: `UsagePrompt` (localStorage, per user, `analytics/portalAnalytics.ts:21,72-96`) and Malafat suggestions (server, `User.malafatSuggestions`).
- **Release-QA:** `qa/features/portal/profiles.yaml` has ids edit, type-change, create and limits. Specs live in `qa/specs/portal/profiles.spec.ts` with the `FakeApi` (`qa/support/portalApi.ts:376`).
- **Phone:** freezed/json_serializable with no `disallowUnrecognizedKeys` (searched `lib/` and `build.yaml`), so additive `/v1/me` fields are safe. The portal parse is a cast (`src/hosted/api/client.ts:219`).
- **Local mode (MUT-284)** is not on main. Whichever lands second carries the snapshot migration for the new Organization and Membership fields (brief §11).

## 1. Corrections to the brief this plan makes (each is noted in ADR-099's MUT-300 amendment)

| # | Brief said | Plan does | Why |
|---|---|---|---|
| C1 | `Membership.role` arrives with MUT-305 (§11) | **MUT-300 adds the role column**, sets it on enable and convert, and publishes it on `/v1/me`. MUT-305 adds enforcement (scopes, store guard, own-row rule, last-owner refusals on member routes). | Enable names owners and others become BOOKKEEPER (D4), and convert makes the former owner OWNER. Both write roles. |
| C2 | firm-request: 409 `CONFLICT NOT_OWNER` (§12.1) | 403 `READ_ONLY_PROFILE {reason:'NOT_OWNER'}` via the existing `ownedBy` helper | Same answer as every other owned-profile route (`profiles.ts:51-58`) |
| C3 | 409 `ALREADY_FIRM` | Dropped: unreachable | An owned profile can't be a firm; conversion clears ownership |
| C4 | Only "owned BUSINESS" | Adds 409 `CONFLICT {reason:'NOT_BUSINESS'}` for an owned non-default PERSONAL profile; the built-in personal profile keeps `PERSONAL_PROFILE` | MUT-182 lets a created profile be typed PERSONAL |
| C5 | Admin PATCH and convert take If-Match / Idempotency-Key | Neither: idempotent by construction, like every admin route (same state → no-op 200; a second convert → 409 `NOT_OWNED`) | Admin convention (`admin.ts`, `admin-users.ts`) |
| C6 | `/v1/me` gains `firm: boolean` and `role` | Also `firmRequestedAt: string \| null` (set only for the profile's owner) | The portal must show "Requested" across reloads |
| C7 | DR5 banner: "Invite your team in Firm › Members" | v1 copy points only at what exists: "Firm features are on for {profile}. New tools show up here as they're released." MUT-306 changes the line to name Members. | Members ships in v3 |

## 2. Data model (migration `2026101912xxxx_mut300_firm_flag`)

```sql
CREATE TYPE "MembershipRole" AS ENUM ('OWNER','BOOKKEEPER','SUBMITTER');
ALTER TABLE "memberships" ADD COLUMN "role" "MembershipRole" NOT NULL DEFAULT 'OWNER';
ALTER TABLE "organizations"
  ADD COLUMN "firmEnabledAt" TIMESTAMP(3),
  ADD COLUMN "firmRequestedAt" TIMESTAMP(3),
  ADD COLUMN "firmRequestedByUserId" UUID REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_firm_request_pair_check"
  CHECK (("firmRequestedAt" IS NULL) = ("firmRequestedByUserId" IS NULL));
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_firm_not_owned_check"
  CHECK ("firmEnabledAt" IS NULL OR "ownerUserId" IS NULL);
```

- The header comment follows house style; it is forward-only and ships the DROPs to revert.
- **`firm_not_owned_check`** makes "an owned profile is never a firm" true in the database (B1). Enable on an owned profile is refused before SQL, and the CHECK is the backstop.
- **`ON DELETE RESTRICT`** on the requester, like `ownerUserId`. Users are never hard-deleted today, and `SET NULL` would break the pair CHECK.
- **No index.** The firm-request listing scans organizations, of which there are tens to hundreds [estimated]. Revisit when the listing is slow.

## 3. Server

### 3.1 Repository (ports, Prisma, memory, store guard)

| Method | Access | Behaviour |
|---|---|---|
| `organizations.requestFirm(id, userId, at, audit)` | `sessionOnly` | Locks the org row (`lockOrganization`). If `firmRequestedAt` is already set, returns the org unchanged (idempotent, no new audit). Otherwise sets the request fields, bumps `version`, and writes audit `firm.requested`. |
| `organizations.setFirm(id, { enabled, ownerUserIds }, at, audit)` | `operator` | Locks the org row. **Enable:** every named owner must be a member, otherwise `NotAMember`. Sets `firmEnabledAt`, clears the request pair, sets named members OWNER and all others BOOKKEEPER, bumps `version`, audits `firm.enabled` with `{ ownerUserIds }`. **Disable:** clears `firmEnabledAt` and leaves roles alone (inert), audits `firm.disabled`. Same state → no-op, no audit. |
| `organizations.convertToFirm(id, at, audit)` | `operator` | Locks the org row. Requires `ownerUserId` non-null and `personalOwnerUserId` null, otherwise `NotConvertible('PERSONAL_PROFILE' \| 'NOT_OWNED')`. Sets `ownerUserId = null`, `profileType = null` and `firmEnabledAt = at`, clears the request pair, sets the former owner OWNER (the only member of an owned profile), bumps `version`, audits `firm.converted` with `{ formerOwnerUserId }`. |
| `organizations.listFirmRequests({ cursor, limit })` | `operator` | `firmRequestedAt IS NOT NULL AND firmEnabledAt IS NULL`, ordered by `(firmRequestedAt, id)`, using the existing cursor helper (`pagination.ts`). |
| `MembershipRecord.role` | | `toMembership` and memory `grant` carry `role`. `grant` defaults to OWNER, which is inert until firm; a grant into a firm defaults to BOOKKEEPER. |

- Each write audits inside its own transaction (the MUT-182 qa-reconcile D2 rule).
- The memory store mirrors every method. Its `organizations.create` default gains the three null fields.

### 3.2 Routes

- `POST /v1/profiles/{profileId}/firm-request`:
  - lives in `routes/profiles.ts`, listed in `PROFILE_ORGANIZATION_INDEPENDENT_ROUTES`
  - `security: SESSION_ONLY`, `identityIdempotent(store,'profiles.firmRequest')`
  - ownership through `ownedBy` (C2)
  - refusals: `personalOwnerUserId` set → 409 `PERSONAL_PROFILE`; type not BUSINESS → 409 `NOT_BUSINESS` (C4)
  - **202** `{ firmRequest: { requestedAt } }`
- `GET /admin/v1/firm-requests` (`routes/admin.ts`): 200 `{ data: [{ organizationId, name, requestedAt, requestedByUserId, requestedByEmail, owned }], nextCursor }`.
- `PATCH /admin/v1/organizations/{organizationId}` with body `{ firmEnabled: true, ownerUserIds: [uuid, ≥1] } | { firmEnabled: false }`:
  - 200 `{ organization }` (serializer below)
  - 404
  - 409 `CONFLICT {reason:'OWNED_PROFILE'}` via `ownedProfileConflict`: convert first
  - 409 `CONFLICT {reason:'NOT_A_MEMBER', userIds}`
  - 422 when enable names no owner
- `POST /admin/v1/organizations/{organizationId}/convert-to-firm`: 200 `{ organization }`; 404; 409 `PERSONAL_PROFILE` / `NOT_OWNED`.
- `serializeOrganization` and `OrganizationSchema` gain `firm: { enabledAt, requestedAt, requestedByUserId }`. The admin detail route also returns `members: [{ userId, email, role }]` (from `listByOrganization` + users).
- `/v1/me`:
  - `hostedProfileFor(org, writer, userId, membership?)` adds `firm: firmEnabledAt != null`, `role: firm ? membership.role : null` and `firmRequestedAt: owned ? firmRequestedAt : null` (C6).
  - `buildMe` passes the membership it already holds.
  - `POST` and `PATCH /v1/profiles` pass none (owned profiles are never firms → `role: null`).
- `HostedProfileSchema` gains `firm`, `role` (nullable enum) and `firmRequestedAt` (nullable datetime), documented "additive since 1.37.0-mut300" (the `MeSchema.currencies` precedent).
- `API_VERSION` → `1.37.0-mut300` (renumber at merge if MUT-284/286 bumps first). Regenerate `openapi.yaml` and `schema.d.ts`.

### 3.3 CLI (`scripts/users.ts`)

New commands, all through the admin API:
- `firm-requests`: lists pending requests.
- `firm-enable --org <id> --owner <email>[,<email>]`: resolves emails with `userByEmail`.
- `firm-disable --org <id>`
- `firm-convert --org <id>`

Each prints one line, like `grant`. Add the npm aliases in `server/package.json` and tests in `users-cli.test.ts`.

## 4. Portal (`src/hosted`)

- **API and data:**
  - `api.requestFirm(profileId)` in `api/client.ts`; it sends an Idempotency-Key, like profile create.
  - A hook `useRequestFirm` in `data/profiles.ts` (or the existing profile mutations file) that invalidates `ME_KEY` on success.
- **The request section (DR1)** sits in `ProfileEditForm`, shown only when `owned && type === 'BUSINESS' && !isPersonalDefault`:
  - **offer:** heading "Use this profile for a firm", one line of what that means, and a "Request firm features" button
  - **requested:** "Requested on {date} · we'll email you when it's on". It reads `firmRequestedAt` and shows no button.
  - **error:** an inline `.hp-banner-error`
  - No modal. The button is a `press` button with a spinner while in flight.
- **The banner (DR5)** is a new `FirmOnBanner` on the Overview, shown when `profile.firm`:
  - It uses `.hp-banner-info` and carries a dismiss button with an aria-label.
  - **The dismissal lives in localStorage**, keyed `mutaba3a-firm-banner:{userId}:{profileId}`, read and written inside try/catch (the `UsagePrompt` precedent). Losing the key only shows the banner once more, and it needs no server round trip.
  - The copy follows C7.
- **i18n:** new keys `hosted.profiles.firm.{title,body,request,requested,error}` and `hosted.firm.banner.{text,dismiss}` in `ar.json` and `en.json`, Arabic first. Layout uses logical properties.
- **Compliance copy guard** (first firm strings, brief §14): `scripts/__tests__/firm-copy-guard.test.ts` scans `hosted.firm.*` and `hosted.profiles.firm.*` in both dictionaries for the banned phrases.

## 5. Tests (written first)

| Test | File | Proves |
|---|---|---|
| firm-request matrix: owned BUSINESS 202; a repeat returns the same body with one audit row; personal default 409 `PERSONAL_PROFILE`; owned PERSONAL 409 `NOT_BUSINESS`; non-owner 403 `NOT_OWNER`; non-member 404; API key 403 | `server/src/__tests__/routes-profiles-firm.test.ts` | AC2, AC3 |
| enable/disable: no owner 422; owner not a member 409; others become BOOKKEEPER; disable keeps roles; same state no-op with no audit; owned profile 409 `OWNED_PROFILE`; audit rows | `server/src/__tests__/routes-admin-firm.test.ts` | AC1 |
| convert: clears `ownerUserId` and `profileType`; the owner becomes OWNER; the cap count drops by one; personal 409; second convert 409 `NOT_OWNED` | same file + `test:db` variant | B1, CHECKs |
| **Postgres CHECKs:** the pair CHECK and `firm_not_owned_check` reject bad rows; convert passes `owner_type_check` | `server/src/__tests__/db/firm-flag.db.test.ts` (`test:db`) | DB backstops |
| `/v1/me`: `firm`, `role` (null when not a firm), `firmRequestedAt` (owner only); additive (existing fields unchanged) | `routes-sessions.test.ts` (new cases) | AC4 |
| memory/Prisma parity for the four new methods | the existing store-contract suite | both stores |
| CLI commands and output lines | `scripts/__tests__/users-cli.test.ts` | operator path |
| ProfileEditForm firm section: shown only for an owned BUSINESS profile; offer → requested; error | `src/hosted/components/__tests__/ProfileEditForm.firm.test.tsx` | AC2, AC3 |
| FirmOnBanner: shown for firm profiles; dismiss persists per user and profile; localStorage throwing still renders | `src/hosted/components/__tests__/FirmOnBanner.test.tsx` | DR5 |
| copy guard | `scripts/__tests__/firm-copy-guard.test.ts` | ID5 |
| Release-QA `@portal.profiles.firm-request` and `@portal.shell.firm-enabled-banner` | `qa/features/portal/profiles.yaml` (+ `shell.yaml`), `qa/specs/portal/*.spec.ts` with `FakeApi.me()` extended | AC5 |

**Commands (Node 22):**
- `npm --prefix server run typecheck`, `npm --prefix server run lint`, `npm --prefix server run openapi:check`, `npm --prefix server test`
- `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run build`
- `npm run hosted:types` (check)
- `release-qa run --attach --only firm-request,firm-enabled-banner`; `release-qa lint`

## 6. Quality bar

- **DRY:** reuse `ownedBy`, `identityIdempotent`, `ownedProfileConflict`, `lockOrganization`, the cursor helper, `.hp-banner-*` and the `UsagePrompt` storage pattern. No new component family.
- **Cost:** `/v1/me` gains three fields and no queries, since `buildMe` already has the membership. Admin listing is one query.
- **Security:**
  - Only the profile's owner can request, and the request writes nothing but a timestamp.
  - Enabling is operator-only.
  - The DB CHECK keeps owned profiles out of firm state.
  - Malafat API keys never reach these routes (session-only and admin-only).
- **Local mode:** firm fields never become true signed out (no admin there). Snapshot migration per brief §11 when MUT-284 lands.
- **Knowledge files:**
  - CHANGELOG
  - ADR-099 amendment (C1–C7)
  - COMPONENT_REGISTRY (`FirmOnBanner`)
  - TEST_PLAN
  - INFRA (none)
  - hosted-portal.md: the `/v1/me` profile fields

## 7. Acceptance criteria → proof

| AC | Proof |
|---|---|
| Operator turns firm on/off; each change audited | admin firm tests + CLI tests |
| Owner of a Business profile requests once; repeat idempotent; portal shows "Requested" | firm-request tests + ProfileEditForm test + release-QA `firm-request` |
| Personal profiles and non-owners never see the request | firm-request matrix + ProfileEditForm visibility test |
| `/v1/me` reports the flag; OpenAPI + `openapi:check` | sessions tests + `openapi:check` |
| ar/en strings, RTL, release-QA feature + passing spec | i18n keys, copy guard, two passing tagged specs |

## Business / product impact

- The firm switch is the entitlement every other firm feature checks. Nothing in MUT-298 can ship to a customer without it.
- It also gives an owner a way to ask in-app, which feeds the pilot-firm gate (D13): the first requests are the pilot candidates.
- Risk is contained: an operator decides every enable, and a database CHECK keeps owned profiles out of firm state.
