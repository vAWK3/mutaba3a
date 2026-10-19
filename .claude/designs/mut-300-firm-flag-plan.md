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
  - **requested:** "Requested on {date}. Firm features show up here once they're turned on." (no email promise: the server sends no email until MUT-306). It reads `firmRequestedAt` and shows no button.
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

---

# Eng review (plan-eng-review, 2026-10-19)

Target: `.claude/designs/mut-300-firm-flag-plan.md`. Reviewer: Claude (native), gstack v1.91.143.0. Binding decisions: brief `firm-books.md` and ADR-099 (approved 2026-10-19), plus the MUT-299 eng decisions D1–D15.

## Scope Challenge

- **What exists:** `ownedBy`, `identityIdempotent`, `ownedProfileConflict`, `lockOrganization`, the cursor helper, admin audit, the `users.ts` CLI pattern, `.hp-banner-*`, the `UsagePrompt` storage pattern. All are reused (plan §6).
- **Complexity:** about 25 changed files and at least 2 new units (four repository methods, `FirmOnBanner`) [measured: plan §2–§5]. The gate tripped.
- **Scope record:** feature answers: no cuts proposed; structure: A) Original arrangement (Basel, D1, 2026-10-19); accepted scope: plan §2–§5 as written; pending remedies: R1, R2 (below).
- **Reality rows:**
  - REALITY: premise-table pass 9 premises from the survey, each with a file:line in plan §0, unverified=0 .claude/designs/mut-300-firm-flag-plan.md:9
  - REALITY: already-done pass no firm flag or Membership role anywhere on main (`schema.prisma:326-336`) server/prisma/schema.prisma:326
  - REALITY: surface-check pass routes and CLI verbs checked against `admin.ts`, `profiles.ts` and `users.ts` server/src/scripts/users.ts:37
  - REALITY: binding-decisions finding C1–C7 amend brief §11/§12.1 and are listed for ADR-099 .claude/designs/mut-300-firm-flag-plan.md:38
  - REALITY: numbers pass only the org count estimate, tagged [estimated] .claude/designs/mut-300-firm-flag-plan.md:68
  - REALITY: deferred-asks pass AC1–AC5 mapped in plan §7 .claude/designs/mut-300-firm-flag-plan.md:176
  - REALITY: pr-count pass one PR, default policy .claude/designs/mut-300-firm-flag-plan.md:1
- Scope Challenge result: scope accepted as-is.

## Section 1 — Architecture

1. [P1] (confidence: 9/10) `server/src/routes/profiles.ts:51-58` `ownedBy` refuses with `READ_ONLY_PROFILE {reason:'NOT_OWNER'}` unless `profileOwnerOf(org) === user.id`. After `convertToFirm` clears `ownerUserId`, the former owner (now OWNER role) **can no longer rename the profile or change its default currency**. In the portal the row turns read-only (`profileEditability` → `readOnly.firm`), and the only way to rename is an operator. → R1.
2. [P2] (confidence: 8/10) `server/src/routes/admin-users.ts:264-293` grants a membership with no role. Until MUT-306 the operator is the only way to add someone to a firm, and the plan defaults such a grant to BOOKKEEPER with no way to pick OWNER or SUBMITTER. → R2.
3. [P2] (confidence: 9/10) Plan §4 copy "Requested on {date} · we'll email you when it's on" promises email. The server has no outbound email (MUT-299 survey; D14 puts the provider in MUT-306). **Factual correction, no question:** the copy becomes "Requested on {date}. Firm features show up here once they're turned on."
4. No issue: request versus convert races are serialised by `lockOrganization` on both writes; the CHECKs back the invariants.

## Section 2 — Code quality

- No issues found. All four repository methods follow the `createOwned`/`updateOwned` shape (audit inside the transaction). The admin routes follow `admin.ts` conventions (C5).

## Section 3 — Tests

The plan §5 table covers every new branch. The coverage diagram for the proposed code:

```
[+] firm-request route     ├─ 202 / repeat / personal / NOT_BUSINESS / NOT_OWNER / 404 / API key   [planned ★★★]
[+] admin PATCH enable     ├─ 422 none / 409 not member / roles set / no-op / OWNED_PROFILE        [planned ★★★]
[+] admin convert          ├─ clears owner+type / OWNER / cap drop / 409 personal / 409 NOT_OWNED [planned ★★★ + test:db]
[+] DB CHECKs              └─ pair, not-owned                                                     [planned test:db]
[+] /v1/me fields          └─ firm, role, firmRequestedAt (owner only)                            [planned ★★]
[+] portal section/banner  ├─ visibility / offer→requested / error / dismiss persists / LS throws [planned ★★★]
[+] copy guard, CLI        [planned ★★]
GAPS after R1/R2: rename-by-OWNER (if R1 = A), grant --role (if R2 = A)
```

## Section 4 — Performance

- No issues found. `/v1/me` adds no query (the membership is already loaded). The listing is one indexed-by-PK scan of a small table [estimated].

## Decision ledger

### R1: Renaming a profile after it becomes a firm
Finding: Section 1 #1, P1, confidence 9/10, `server/src/routes/profiles.ts:51-58` (`ownedBy` → `READ_ONLY_PROFILE NOT_OWNER` unless `profileOwnerOf(org) === user.id`), reviewer Claude (native).
Plan baseline: plan §3.1 `convertToFirm` clears `ownerUserId` (B1, brief §3.1); nothing says who edits a firm's name or currency afterwards.
Runtime evidence: after conversion `profileOwnerOf` returns null, so `PATCH /v1/profiles/{id}` refuses everyone, and the portal shows the row read-only (`profileEditability` → `readOnly.firm`).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 who renames a firm | operator only (implicit) | MUT-300 lets a firm's OWNER role PATCH name and default currency (type stays refused); the portal edit form opens for firm OWNERs | Defer to MUT-305: rename and currency for OWNER arrive through the role derivation (a `profiles:write` action for OWNER), added to MUT-305's AC; until then the operator renames |
| D1 one permissions derivation (MUT-299) | approved | approved (A adds a one-off role check in `ownedBy` before the derivation exists) | approved (unchanged) |
Question D2:
D2 — After an operator turns an owned profile into a firm, who can rename it?
Project/branch/task: feature/mut-300-firm-flag, MUT-300 firm switch.
ELI10: Converting a profile to a firm moves its ownership from "this person owns it" to "this person is the firm's OWNER". The rename and currency edit today check the first kind of ownership, so after conversion nobody but the operator can rename it. We can let the OWNER role edit it now with a small special check, or wait for MUT-305, where roles get one proper permissions system (D1), and add it there.
Stakes if we pick wrong: either a firm owner is stuck asking us to fix a typo in their firm's name for a few weeks, or we add a second permissions check that MUT-305 has to undo.
Recommendation: B because D1 says roles go through one derivation; a one-off check now would be the second source of truth D1 rejected, and only operator-converted pilot firms are affected until MUT-305.
Completeness: A=9/10, B=7/10
Pros / cons:
A) Fix in MUT-300
  ✅ A firm owner can rename their firm and change its currency from day one
  ✅ Small change: one condition in `ownedBy` and the portal's editability rule
  ❌ A role check outside the D1 derivation, which MUT-305 then has to fold in (human: ~half day / CC: ~20 min now, plus rework)
B) Defer to MUT-305 (recommended)
  ✅ Rename for OWNER arrives through the one permissions derivation, with no throwaway code
  ✅ Only pilot firms the operator converts are affected meanwhile, and the operator can rename on request
  ❌ Until MUT-305 lands, a firm owner can't rename their firm without asking
Net: a few weeks of operator renames versus a temporary second permissions path.
Header: Firm rename
Options:
A) Fix in MUT-300
In MUT-300, `ownedBy` also accepts a member whose role is OWNER on a firm (`firmEnabledAt` set) for name and default-currency edits; a type change stays refused for firms. The portal's `profileEditability` opens the edit form for firm OWNERs. Tests for both. Effort: human ~half day / CC ~20 min. Risk: low. Maintenance: MUT-305 folds the check into the derivation.
B) Defer to MUT-305 (recommended)
MUT-300 leaves firm profiles read-only to members, as today for operator-provisioned firms. MUT-305's AC gains "a firm OWNER can rename the firm and change its default currency", delivered through the role derivation (Jira comment). Until then the operator renames on request. Effort: none now. Risk: low. Maintenance: none.

State: approved
Actual answer: B) Defer to MUT-305 (Basel, D2, 2026-10-19)
Accepted scope: MUT-300 leaves firm profiles read-only to members. MUT-305's AC gains "a firm OWNER can rename the firm and change its default currency", through the role derivation (Jira comment on MUT-305). The operator renames on request until then. Ceiling: firm owners can't rename until MUT-305; upgrade trigger: MUT-305 lands.
History: 2026-10-19, made moot by R3/D4: with no conversion the owner keeps rename and currency. The MUT-305 AC note is no longer needed for owned firms; it still applies to operator-provisioned firms.

### R2: Choosing a role when the operator adds someone to a firm
Finding: Section 1 #2, P2, confidence 8/10, `server/src/routes/admin-users.ts:264-293` (membership grant takes no role), reviewer Claude (native).
Plan baseline: plan §3.1, "a grant into a firm defaults to BOOKKEEPER".
Runtime evidence: the admin grant and `users.ts grant` take only an organization. Roles are not enforced until MUT-305 (D1). Invites with a role arrive in MUT-306. The pilot gate (D13) puts v3 after the pilot.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R2 role on operator grant | none; firm grant defaults to BOOKKEEPER (plan) | Admin grant and `users.ts grant --role` accept an optional role for new memberships (default BOOKKEEPER in a firm, OWNER elsewhere), audited | Keep the plan: no role parameter; firm grants are BOOKKEEPER; SUBMITTER and extra OWNERs come with MUT-306 invites and MUT-305 role changes |
| R1 firm rename deferred | approved (D2) | approved (unchanged) | approved (unchanged) |
Question D3:
D3 — Should the operator be able to pick a role when adding someone to a firm, before invites exist?
Project/branch/task: feature/mut-300-firm-flag, MUT-300 firm switch.
ELI10: Until MUT-306 builds invites, an operator adds people to a firm with the existing "grant access" command, which has no role. The plan makes such people bookkeepers. Roles don't change what anyone can do until MUT-305 anyway, and the pilot only uses v1–v2 features. So a role picker now mostly sets values nobody acts on yet.
Stakes if we pick wrong: either extra API and CLI surface to maintain for a few weeks, or someone added before MUT-305 starts with the wrong role and needs a change later.
Recommendation: B because roles have no effect until MUT-305 and MUT-306 brings role-aware invites, so a picker now is surface without a user.
Completeness: A=9/10, B=8/10
Pros / cons:
A) Add a role option
  ✅ The operator can set SUBMITTER or a second OWNER right away
  ✅ Role values are right from the start, with no fix-up when MUT-305 starts enforcing
  ❌ A new admin and CLI parameter, plus tests, for a value with no effect yet (human: ~half day / CC: ~20 min)
B) Keep bookkeeper default (recommended)
  ✅ No new admin surface; MUT-306's invite carries the role the proper way
  ✅ Nothing changes for any user until MUT-305 enforces roles
  ❌ Anyone the operator adds before MUT-306 starts as BOOKKEEPER and may need a role change later
Net: a picker for values that do nothing yet, versus a possible later fix-up.
Header: Grant role
Options:
A) Add a role option
`POST /admin/v1/users/{userId}/memberships` and `users.ts grant` accept an optional `role` for a new membership (default BOOKKEEPER in a firm, OWNER elsewhere), audited as `membership.granted` with the role. Effort: human ~half day / CC ~20 min. Risk: low. Maintenance: a parameter to keep.
B) Keep bookkeeper default (recommended)
No role parameter. A new membership in a firm is BOOKKEEPER, and OWNER elsewhere (inert). SUBMITTER and extra OWNERs come with MUT-306 invites and MUT-305 role changes. Effort: none. Risk: low. Maintenance: none.

State: approved
Actual answer: B) Keep bookkeeper default (Basel, D3, 2026-10-19)
Accepted scope: The plan stands: no role parameter on the admin grant or the CLI. A new membership in a firm is BOOKKEEPER, and OWNER elsewhere (inert). Tested in the admin firm tests.
History: none

## Outside voice (Claude Plan subagent, native fallback; Codex CLI not installed)

Completed inside the 5-minute timer with 10 findings, verified where marked:
- **O1 Critical (verified)** Converting removes far more than rename. The portal's income affordances need `profile.owned` (`src/hosted/data/incomeAffordances.ts:31-38,62-66`: Add income, settle, redate), and the server's redate is gated by `isOwnProfile` (`server/src/routes/income.ts:172`, `payments.ts:334`). The owned-profile refusals for API keys, Malafat bind and grant also stop firing. The first converted pilot owner would lose income entry. D2 was decided on rename alone. → **R3**, which reopens B1 and D2.
- **O2 High** Convert followed by disable leaves an orphan org (no owner, no type, no firm). → dissolved by R3 = A.
- **O3 High (verified, `ProfileEditForm.tsx:25-27`)** `requestFirm` bumping `version` makes the owner's own next Save in the same pane return 412. → accepted as a correction (below).
- **O4 Medium (verified, `schemas.ts:350` "null on a firm")** "Firm" already means "a non-owned org" in the contract and the portal. A new `firm: boolean` gives the word two meanings. → **R4**.
- **O5 Medium** Two operator verbs (enable vs convert) for one intent; the `owned` column in the listing is always true. → dissolved by R3 = A.
- **O6 Medium** A request can't be declined, so it stays "Requested" forever. → **R5**.
- **O7 Medium** Double idempotency on firm-request (`identityIdempotent` + an idempotent write). → disposition below.
- **O8 Low** Migration FK style: needs `ON UPDATE CASCADE` and an explicit named relation. → accepted as a correction.
- **O9 Low** `firm_not_owned_check` misses an unstamped MUT-120 personal profile. → folded into R3.
- **O10 Low** `DEFAULT 'OWNER'` backfills every existing membership as OWNER. → disposition below.

### Outside-voice dispositions without a question
- **O3:** accepted as a correction of the plan's own bug. `requestFirm` doesn't bump `version`; it isn't a field edit. The request section renders from fresh `useMe()`, not the pane's opened copy. Test: request, then Save in the same pane, succeeds.
- **O7:** kept for house consistency (every session POST under `/v1/profiles` uses `identityIdempotent`). Proof added: a replay with the same key returns the stored 202; a new key returns the same `requestedAt` with no second audit row.
- **O8:** accepted as necessary implementation. `@relation("FirmRequests")` on User and Organization; `ADD CONSTRAINT … _fkey … ON DELETE RESTRICT ON UPDATE CASCADE`, matching existing FKs; `prisma migrate diff` shows no drift.
- **O10:** noted for ADR-099. Roles are read only when the firm flag is set (brief §4.1), and enabling always rewrites roles. The bulk OWNER default on never-enabled orgs is inert, and MUT-305's last-owner logic runs only on firms.

### R3: Turn on firm features without converting an owned profile
Finding: Outside voice O1 (Critical, verified) plus O2, O5 and O9, `src/hosted/data/incomeAffordances.ts:31-38,62-66`, `server/src/routes/income.ts:172`, `server/src/routes/payments.ts:334`, reviewer Claude subagent. Reopens B1 (brief §3.1, approved 2026-10-19) and D2 (R1, approved), on new evidence: conversion removes income capture, settle and redate, not only rename.
Plan baseline: brief §3.1/ADR-099 decision 1: an owned Business profile becomes a firm by operator **conversion**, which clears `ownerUserId`. D2: rename-after-convert deferred to MUT-305.
Runtime evidence: every income affordance in the portal and the server's redate need `owned` / `isOwnProfile`. A converted profile loses Add income, settle and redate the day it converts. The API-key, Malafat-bind and grant refusals for owned profiles stop applying.
Comparison grid:
| Choice | Current | A | B | C | D |
|---|---|---|---|---|---|
| R3 how an owned profile gets firm features | conversion clears ownership (B1) | **Enable in place:** the operator sets `firmEnabledAt` on the owned Business profile; it stays owned, the owner's membership is OWNER, every owned-keyed gate keeps working. No convert route. One verb, `firm-enable`, works for owned and operator orgs (owned: the owner is OWNER automatically). CHECK `firmEnabledAt IS NULL OR personalOwnerUserId IS NULL`. Sharing an owned profile (conversion) moves to v3 and is decided after the pilot | Keep conversion and fix every owned-keyed gate in MUT-300 (income affordances, redate, switcher labels, API-key and grant refusals) | Investigate: bounded list of every `owned` / `profileOwnerOf` gate, then decide | Defer this proposal only |
| D2 rename after convert | approved: defer to MUT-305 | moot: owner keeps rename (no conversion) | approved (unchanged) | approved (unchanged) | approved (unchanged) |
| D3 grant default role | approved | approved (unchanged) | approved (unchanged) | approved (unchanged) | approved (unchanged) |
Question D4:
D4 — Should firm features turn on for an owned Business profile without converting it?
Project/branch/task: feature/mut-300-firm-flag, MUT-300 firm switch.
ELI10: The brief said an owned Business profile becomes a firm by moving ownership from the person to an OWNER role. The second reviewer showed that almost everything a person can do on their own profile checks "you own it": adding income, settling, fixing dates. Converting would take all of that away from the first pilot owner the day we switch them on. v1 and v2 firm features (reading receipts, VAT) are used by that one owner anyway; sharing with staff only starts in v3. So we can simply switch firm features on while the profile stays theirs, and decide how to share an owned profile in v3, after the pilot.
Stakes if we pick wrong: the first pilot firm loses income entry in the portal, or v3 inherits a sharing question we could have answered with real usage.
Recommendation: A because it keeps every existing owner capability, removes the convert route, the orphan state and the second operator verb, and v1–v2 need no sharing.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Apply: enable in place (recommended)
  ✅ The owner keeps income capture, settle, redate and rename; nothing they rely on changes
  ✅ One operator verb for every profile, no convert route, no orphan state after disable
  ❌ Sharing an owned profile with staff isn't solved yet; v3 (MUT-305/306) must decide it after the pilot
B) Keep conversion, fix every gate now
  ✅ The brief's model stands: a firm is never "owned" by one person
  ✅ v3 sharing works on day one of v3 without another decision
  ❌ Rewrites income, redate, switcher and refusal gates now for a sharing need v1–v2 don't have (human: ~1 week / CC: ~3 hours)
C) Investigate before choosing
  ✅ A full list of owned-keyed gates before any decision
  ✅ Bounded to this review; nothing else changes
  ❌ The list is already clear enough to decide; it delays the build
D) Defer this proposed change only
  ✅ No brief change now
  ✅ Nothing else in the plan changes
  ❌ The plan still converts and breaks income for the first pilot owner
Net: switch firm features on in place now; decide how an owned profile is shared in v3, with pilot evidence.
Header: Firm on owned
Options:
A) Apply: enable in place (recommended)
The operator sets `firmEnabledAt` on an owned Business profile without touching ownership; the owner's membership is OWNER. Remove the convert route, the `firm_not_owned_check` and the `NOT_OWNED`/`OWNED_PROFILE` refusals. Replace them with CHECK `firmEnabledAt IS NULL OR personalOwnerUserId IS NULL` (the built-in personal profile is never a firm; covers O9). One verb, `firm-enable` (`PATCH /admin/v1/organizations/{id}`), for owned and operator orgs: `ownerUserIds` is required for operator orgs and ignored for owned ones, whose owner is OWNER. D2 becomes moot. Brief §3.1 and ADR-099 decision 1 are amended; sharing an owned profile becomes a v3 decision, recorded on MUT-305/306. Effort: smaller than the plan. Risk: low. Maintenance: lower.
B) Keep conversion, fix every gate now
Keep conversion and, in MUT-300, move every owned-keyed gate (income affordances, redate, switcher labels, API-key, bind and grant refusals) to "owned OR firm OWNER". Effort: human ~1 week / CC ~3 hours. Risk: medium. Maintenance: medium.
C) Investigate before choosing
List every `owned` / `profileOwnerOf` / `isOwnProfile` gate with file:line, then decide; this row stays pending. Effort: ~1 hour. Risk: delay. Maintenance: none.
D) Defer this proposed change only
Leave the plan converting; this row stays open. Effort: none. Risk: high, the pilot owner loses income entry. Maintenance: none.

State: approved
Actual answer: A) Apply: enable in place (Basel, D4, 2026-10-19)
Accepted scope: The operator sets `firmEnabledAt` on an owned Business profile without touching ownership; the owner's membership is OWNER. Removed: the convert route and its CLI verb, `firm_not_owned_check`, and the `NOT_OWNED`/`OWNED_PROFILE` refusals on enable. Added: CHECK `organizations_firm_not_personal_check` (`firmEnabledAt IS NULL OR personalOwnerUserId IS NULL`). One verb, `PATCH /admin/v1/organizations/{id}` (`firm-enable`/`firm-disable` in the CLI): `ownerUserIds` is required for operator orgs and ignored for owned ones. D2 is moot. Brief §3.1 and ADR-099 decision 1 are amended (sharing an owned profile becomes a v3 decision, after the pilot); Jira notes on MUT-305/306.
History: none

### R4: One meaning for "firm"
Finding: Outside voice O4, Medium, confidence 9/10 (verified): `server/src/schemas.ts:350` ("null on a firm"), `src/hosted/data/profileRules.ts:16,19` (reason `'FIRM'` = any non-owned, non-Malafat profile), i18n key `hosted.profiles.readOnly.firm` ("Set up for you by your account administrator."), reviewer Claude subagent.
Plan baseline: brief §12.1 and plan §3.2: `/v1/me` gains `firm: boolean`.
Runtime evidence: the user-facing copy never says "firm"; only identifiers and one schema doc do. After D4 an owned profile can have firm features, so "firm = not owned" is already wrong.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R4 vocabulary | "firm" = non-owned org (internal) and, new, = firm features on | Keep the new field `firm` (matches brief, ADR, Jira); rename the legacy internals: reason `'FIRM'` → `'OPERATOR'`, key `readOnly.firm` → `readOnly.operator` (same text), schema doc "null on a firm" → "null on a profile you don't own" | Name the new field `firmFeatures` and leave the legacy internals as they are |
| R3 enable in place | approved (D4) | approved (unchanged) | approved (unchanged) |
Question D5:
D5 — "Firm" already names "a profile you don't own" inside the code. Which name changes?
Project/branch/task: feature/mut-300-firm-flag, MUT-300 firm switch.
ELI10: Inside the code, "firm" has meant "a profile an administrator set up for you". Users never see that word; they see "Set up for you by your account administrator." Now "firm" also means "firm features are on", and after D4 an owned profile can be a firm too. Keeping two meanings will confuse whoever builds the next 14 tickets. We either rename the old internal uses (the new field keeps the name the brief, ADR and Jira already use), or give the new field a different name.
Stakes if we pick wrong: a future check reads `reason === 'FIRM'` thinking it means firm features, and shows or hides the wrong thing.
Recommendation: A because the new meaning is the one every document and ticket uses, and the old one is three internal identifiers with no user-facing text change.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Rename the old internals (recommended)
  ✅ "firm" means one thing everywhere: brief, ADR, Jira, API and code agree
  ✅ No user-visible change; the portal text stays "Set up for you by your account administrator"
  ❌ Touches `profileRules.ts`, two dictionaries, one schema doc line and their tests (human: ~1 hour / CC: ~10 min)
B) Name the new field firmFeatures
  ✅ No legacy identifiers change
  ✅ The new field's name is unambiguous on its own
  ❌ The brief, ADR and 15 Jira comments say `firm`, and the code keeps the old meaning around to confuse later tickets
Net: rename three internal identifiers now, or carry two meanings through 14 tickets.
Header: Firm naming
Options:
A) Rename the old internals (recommended)
Keep `/v1/me` `firm: boolean`. Rename the portal reason `'FIRM'` → `'OPERATOR'` and the key `hosted.profiles.readOnly.firm` → `hosted.profiles.readOnly.operator` (same Arabic and English text), and change the `schemas.ts:350` doc to "null on a profile you don't own". Update the tests. Effort: human ~1 hour / CC ~10 min. Risk: low. Maintenance: lower.
B) Name the new field firmFeatures
`/v1/me` gains `firmFeatures: boolean` instead of `firm`; the legacy `'FIRM'` reason, key and doc stay. Brief, ADR and Jira notes are updated to the new name. Effort: small. Risk: low. Maintenance: two meanings of "firm" remain in code.

State: approved
Actual answer: A) Rename the old internals (Basel, D5, 2026-10-19)
Accepted scope: `/v1/me` keeps `firm: boolean`. Portal reason `'FIRM'` → `'OPERATOR'` (`profileRules.ts`); key `hosted.profiles.readOnly.firm` → `hosted.profiles.readOnly.operator` with the same ar/en text; `schemas.ts:350` doc → "null on a profile you don't own"; tests updated.
History: none

### R5: Declining a firm request
Finding: Outside voice O6, Medium, confidence 8/10, plan §3.1 (`requestFirm` sets the pair; only enabling clears it), reviewer Claude subagent.
Plan baseline: plan §3.1–§3.3 have no decline path; a request stays until enabled.
Runtime evidence: none yet (new feature). Without a decline, the owner's section reads "Requested on {date}" forever and the operator listing keeps stale rows.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R5 decline | none | `DELETE /admin/v1/organizations/{id}/firm-request` and CLI `firm-decline --org` clear the pair, audited `firm.request_declined`. The owner sees the offer again and may re-request | No decline. The operator leaves unwanted requests in the listing; the ADR notes the limitation |
| R3 enable in place | approved (D4) | approved (unchanged) | approved (unchanged) |
Question D6:
D6 — Should the operator be able to decline a firm request?
Project/branch/task: feature/mut-300-firm-flag, MUT-300 firm switch.
ELI10: An owner taps "Request firm features" and sees "Requested on 3 November". If we decide not to switch them on (not a fit for the pilot, a duplicate profile, a mistake), nothing clears it, so they see "Requested" forever and our list of requests fills with stale rows. A decline clears it, records why in the audit log, and lets them ask again later.
Stakes if we pick wrong: owners wait on a request nobody will act on, or a few lines of code we didn't need.
Recommendation: A because a request with no way to say no leaves the owner waiting indefinitely, and the fix is one route and one CLI verb.
Completeness: A=9/10, B=6/10
Pros / cons:
A) Add decline (recommended)
  ✅ The owner never waits on a request nobody will act on; the offer comes back
  ✅ The operator's listing shows only live requests
  ❌ One more admin route, CLI verb and tests (human: ~2 hours / CC: ~10 min)
B) No decline
  ✅ The smallest MUT-300
  ✅ Few requests are expected during the pilot
  ❌ A declined owner sees "Requested" forever, and stale rows pile up in the listing
Net: one small route versus owners left waiting.
Header: Decline
Options:
A) Add decline (recommended)
`DELETE /admin/v1/organizations/{organizationId}/firm-request` (admin) and CLI `firm-decline --org <id>` clear `firmRequestedAt`/`firmRequestedByUserId`, audited `firm.request_declined`; 404 when there's no pending request. The portal shows the offer again. Effort: human ~2 hours / CC ~10 min. Risk: low. Maintenance: low.
B) No decline
Requests stay until enabled; the operator ignores unwanted ones; ADR-099's MUT-300 amendment notes the limitation. Effort: none. Risk: low. Maintenance: none.

State: approved
Actual answer: A) Add decline (Basel, D6, 2026-10-19)
Accepted scope: `DELETE /admin/v1/organizations/{organizationId}/firm-request` and CLI `firm-decline --org <id>` clear the request pair, audited `firm.request_declined`; 404 when nothing is pending. The portal shows the offer again; the owner may re-request. Tests in the admin firm tests and the CLI tests.
History: none

### Approval readiness and the changes this review makes to the plan

Approval readiness: PASS. Checked:
- D1 (structure), R1/D2 (now moot under D4), R2/D3, R3/D4, R4/D5, R5/D6.
- Corrections without a question: Section 1 #3 (copy), O3 (no version bump; fresh `useMe`), O7 (idempotency proof), O8 (FK style), O10 (ADR note).

The build follows these over plan §1–§5 where they differ:
- **No conversion (D4).** Drop `convertToFirm`, its route, its CLI verb and `firm_not_owned_check`. Add CHECK `organizations_firm_not_personal_check` (`"firmEnabledAt" IS NULL OR "personalOwnerUserId" IS NULL`).
- **Enable on an owned Business profile in place.** `setFirm` on an owned org ignores `ownerUserIds`; the owner's membership becomes OWNER. On an operator org, `ownerUserIds` is required as before.
- **Decline (D6):** the `organizations.declineFirmRequest(id, at, audit)` repository method (`operator`), the route `DELETE /admin/v1/organizations/{id}/firm-request`, and the CLI verb `firm-decline`.
- **`requestFirm` doesn't bump `version` (O3).** The request section renders from `useMe()`.
- **Requested copy:** "Requested on {date}. Firm features show up here once they're turned on."
- **Vocabulary (D5):** `'FIRM'` → `'OPERATOR'`, `readOnly.firm` → `readOnly.operator`, and the `schemas.ts:350` doc reworded.
- **Migration FK (O8):** `@relation("FirmRequests")` and `ON DELETE RESTRICT ON UPDATE CASCADE`; `prisma migrate diff` is clean.
- **Plan corrections C2 and C3 are superseded.** The firm-request refusals stay (404 / 403 NOT_OWNER / 409 PERSONAL_PROFILE / 409 NOT_BUSINESS). The enable refusals are now 404 / 409 NOT_A_MEMBER / 422 (operator org with no owner named) / 409 PERSONAL_PROFILE (built-in personal profile).
- **Brief and ADR-099 amendments for the build:**
  - §3.1 (no conversion in v1; sharing an owned profile is a v3 decision)
  - §11 (role column in MUT-300)
  - §12.1 (routes as above)
- **Jira:** notes on MUT-305/306 (sharing an owned firm profile is decided in v3) and on MUT-300 (plan summary).

## NOT in scope
- **Converting or sharing an owned profile:** v3, after the pilot (D4).
- **A firm OWNER renaming an operator-provisioned firm:** MUT-305 (R1 history).
- **A role on the operator grant:** MUT-306 invites (D3).
- **Email notification of a decision:** no provider until MUT-306 (D14).

## What already exists
`ownedBy`, `identityIdempotent`, `ownedProfileConflict`, `lockOrganization`, the cursor helper, admin audit, the `users.ts` command pattern, `.hp-banner-info`, and the `UsagePrompt` localStorage pattern are all reused.

## Failure modes
| Path | Failure | Covered by | User sees |
|---|---|---|---|
| request | double tap | repository idempotent + `identityIdempotent` | one "Requested" |
| request then save | 412 from a version bump | no bump (O3) + test | the save succeeds |
| enable on the built-in personal profile | firm on a personal profile | route 409 + DB CHECK | operator gets a clear error |
| decline with nothing pending | — | 404 | operator gets a clear error |
| banner storage blocked | localStorage throws | try/catch + test | the banner shows; dismiss works in-session |

Critical gaps: 0.

## Worktree parallelization strategy
Sequential implementation, no parallelization opportunity (one ticket, the server and portal parts depend on the same contract).

## Implementation Tasks
- [ ] **T1 (P1, human: ~1 day / CC: ~1 hour)** — server — migration, repository methods (`requestFirm`, `setFirm`, `declineFirmRequest`, `listFirmRequests`, role on Membership), store-guard classification, memory mirror
  - Surfaced by: plan §2–§3.1, D4, D6, O3, O8
  - Files: server/prisma/*, server/src/repositories/{ports,prisma,memory}.ts, server/src/auth/store-guard.ts
  - Verify: `npm --prefix server test`, `test:db`
- [ ] **T2 (P1, human: ~1 day / CC: ~45 min)** — server — routes (firm-request, admin enable/disable, decline, listing), `/v1/me` fields, schemas, OpenAPI, API_VERSION
  - Surfaced by: plan §3.2, D4–D6
  - Files: server/src/routes/{profiles,admin,sessions}.ts, serializers.ts, schemas.ts, app.ts, server/openapi/openapi.yaml
  - Verify: `npm --prefix server run openapi:check`
- [ ] **T3 (P2, human: ~2 hours / CC: ~15 min)** — CLI — `firm-requests`, `firm-enable`, `firm-disable`, `firm-decline`
  - Surfaced by: plan §3.3, D6
  - Files: server/src/scripts/users.ts, server/package.json
  - Verify: users-cli tests
- [ ] **T4 (P1, human: ~1 day / CC: ~45 min)** — portal — request section, `FirmOnBanner`, the `'OPERATOR'` rename, i18n, `schema.d.ts`, copy guard
  - Surfaced by: plan §4, D5, O3
  - Files: src/hosted/{api/client.ts,components/ProfileEditForm.tsx,components/FirmOnBanner.tsx,pages/views/OverviewPage.tsx,data/profileRules.ts,i18n/*.json,api/schema.d.ts}, scripts/__tests__/firm-copy-guard.test.ts
  - Verify: `npm run test:run`, `npm run typecheck`
- [ ] **T5 (P1, human: ~2 hours / CC: ~20 min)** — release-QA — `firm-request` and `firm-enabled-banner` features and passing specs
  - Surfaced by: AC5
  - Files: qa/features/portal/*.yaml, qa/specs/portal/*.spec.ts
  - Verify: `release-qa run --attach --only …`
- [ ] **T6 (P2, human: ~1 hour / CC: ~10 min)** — docs — ADR-099 MUT-300 amendment, brief §3.1/§11/§12.1, CHANGELOG, COMPONENT_REGISTRY, hosted-portal.md profile fields, Jira notes
  - Surfaced by: D4, D5, plan §6

## Completion summary
- **Step 0:** scope accepted as-is (structure D1 = original arrangement)
- **Reality rows:** 7/7, 0 unverified
- **Findings:**
  - Architecture Review: 3 issues found
  - Code Quality Review: 0 issues found
  - Test Review: diagram produced, 0 gaps after the decisions
  - Performance Review: 0 issues found
- **Outputs:** NOT in scope written; What already exists written; TODOS.md updates: 0 items proposed
- **Failure modes:** 0 critical gaps flagged
- **Unresolved decisions:** 0 in this review
- **Outside voice:** Claude Plan subagent (native fallback; Codex not installed), completed, 10 findings, all dispositioned
- **Parallelization:** 1 lane, 0 parallel / 1 sequential
- **Lake Score:** 0/3. No option scored 10/10; the picks were D2 7/10 (now moot), D3 8/10 and D6 9/10. D4 and D5 are kind choices, so they aren't scored.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | Claude Plan subagent, native fallback (Codex CLI not installed) | Independent 2nd opinion | 42 | unavailable (external); in-host completed | 10 findings, all dispositioned |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 44 | ISSUES OPEN | 3 issues, 0 critical gaps (all resolved by D2–D6) |
| Design Review | `/plan-design-review` | UI/UX gaps | 10 | not run for this plan (DR1/DR5 come from the MUT-299 design review) | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** plan-review phase. Codex is unavailable (CLI not installed). The native Claude subagent completed with 10 findings, one Critical (O1), which reopened B1 and D2. It is not external coverage.
- **CROSS-MODEL:** not applicable; no completed external review.
- **VERDICT:** Eng review ISSUES OPEN: every finding has an approved remedy or a recorded correction. Ready for `/eng-build MUT-300`. Eng review required before clearing.

NO UNRESOLVED DECISIONS
