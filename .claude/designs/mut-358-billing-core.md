# MUT-358: Billing core (tables, per-profile entitlement, `billing` on /v1/me, operator grants)

> **Ticket:** MUT-358 (epic MUT-322, `ga-gate`). It blocks MUT-360, MUT-361, MUT-362, MUT-363 and MUT-364.
> **Source design:** `docs/commercial/billing-spike.md` §4 and ADR-160 (Basel, 2026-10-20).
> **Status:** plan, waiting for Basel's approval of P1–P3 (§7).

## 1. Problem and acceptance criteria

The server has no idea who has paid. Every later billing story needs one answer: *is this profile entitled, and why?* This ticket gives that answer and changes no behaviour. Nothing is enforced until MUT-361.

From the ticket:

- [ ] `entitlementOf` has unit tests for each source and state, including:
  - a Firm owner's own profiles;
  - a Malafat-connected profile;
  - an expired grant;
  - every trial boundary (day 14, day 30).
- [ ] A person who once had a paid subscription never resolves to LOCKED.
- [ ] `/v1/me` reports `billing` for each profile, and `openapi:check` passes.
- [ ] Grant and link changes write audit events, and the admin listing shows unlinked Stripe customers.
- [ ] No behaviour changes: every existing test passes.

## 2. Design

### 2.1 Data (Prisma, one migration `mut358_billing_core`)

| Model | Columns | Notes |
|---|---|---|
| `BillingAccount` | `id`, `userId?` (unique), `stripeCustomerId` (unique), `country?` (ISO-2), `currency` (ILS\|USD), `createdAt`, `updatedAt` | One per paying person. **`userId` is null for an unlinked Stripe customer** (MUT-360 stores those; `billing link` fills it). |
| `BillingSubscription` | `id`, `billingAccountId`, `stripeSubscriptionId` (unique), `tier` (FREELANCER\|FIRM), `organizationId?`, `status` (Stripe's string), `currentPeriodEnd`, `cancelAtPeriodEnd`, `priceLookupKey`, `founderUntil?`, `stripeUpdatedAt`, `createdAt`, `updatedAt` | A mirror of Stripe; MUT-360 writes it. Only this ticket's tests write it here. |
| `EntitlementGrant` | `id`, `userId?`, `organizationId?` (CHECK: exactly one is set), `tier`, `reason` (1–200 chars), `expiresAt?`, `grantedBy` (text), `createdAt`, `revokedAt?` | Operator comps, plus the pre-billing backfill (P1). |
| `StripeEvent` | `id` (`evt_…`), `type`, `receivedAt`, `processedAt?`, `error?` | **Table only.** MUT-360 adds its repository methods (YAGNI). |
| `User.trialStartedAt` | `DateTime?` | **Null means no trial**: every operator-issued account. MUT-331's signup sets it at email verification (P2). |

Indexes:
- `billing_subscriptions(billingAccountId)` and `billing_subscriptions(organizationId)`;
- `entitlement_grants(userId)` and `entitlement_grants(organizationId)`.

### 2.2 The resolver: `server/src/billing/entitlement.ts` (pure, no I/O)

```ts
type EntitlementState = 'ACTIVE' | 'GRACE' | 'READ_ONLY' | 'LOCKED';
type EntitlementSource = 'MALAFAT' | 'OPERATOR' | 'STRIPE' | 'TRIAL' | 'NONE';
interface Entitlement { state; source; tier: 'FREELANCER' | 'FIRM' | null; until: string | null }

resolveEntitlement(input: CoverageInput, now: Date): Entitlement
```

`CoverageInput` is everything that can cover one profile:
- `malafatConnected`;
- the grants on the profile and on its owner;
- the Firm subscriptions tied to the profile;
- the owner's own subscriptions;
- the owner's `trialStartedAt`.

The owner is `profileOwnerOf(organization)`, so an operator-provisioned firm has no owner.

The rules run in order, and the first that matches wins:

1. **MALAFAT:** a CONNECTED Malafat integration → `ACTIVE`, tier null.
2. **OPERATOR:** an unrevoked grant whose `expiresAt` is null or in the future → `ACTIVE`, the grant's tier, `until = expiresAt`.
3. **STRIPE, covering:** take the best of the subscriptions that cover the profile:
   - a Firm subscription with `organizationId` = this profile;
   - the owner's Freelancer subscriptions;
   - the owner's Firm subscriptions, since Firm includes Freelancer for the owner's own profiles.

   Stripe status maps as: `active` and `trialing` → ACTIVE (`until = currentPeriodEnd`); `past_due` → GRACE. Ranking: ACTIVE > GRACE; ties go to FIRM, then to the later `currentPeriodEnd`.
4. **TRIAL, running:** `trialStartedAt + 14 days > now` → `ACTIVE`, tier FREELANCER, `until` = the end of the trial.
5. **STRIPE, lapsed:** one of those subscriptions has status `unpaid`, `canceled`, `incomplete_expired` or `paused` → `READ_ONLY`, for good. `until` is null.
6. **TRIAL, ended:** `trialStartedAt` is set and nobody ever paid.
   - Before day 30 → `READ_ONLY`, `until` = the lock date.
   - From day 30 → `LOCKED`.
7. **NONE:** otherwise → `READ_ONLY`, `until` null. This is an operator-issued account with no coverage. It is **never LOCKED**, because LOCKED is only for trials (D3).

**"Ever paid"** means any subscription of the owner's, or one tied to the profile, whose status isn't `incomplete` or `incomplete_expired`. An `incomplete` subscription (checkout still in progress) is ignored completely.

`firmEnabledAt` (MUT-300) **isn't read here**. Coverage depends on the subscription, not the flag, so this ticket doesn't wait for MUT-300's branch. Whether firm features *need* the Firm tier is MUT-363's business.

Constants: `TRIAL_DAYS = 14`, `TRIAL_READ_ONLY_DAYS = 14`, in `billing/entitlement.ts`.

### 2.3 Loading: `server/src/billing/coverage.ts`

`entitlementsFor(store, organizations, now): Map<orgId, Entitlement>` loads in **three queries per call**, however many profiles there are:

1. `store.billing.subscriptionsCovering({ ownerUserIds, organizationIds })`: subscriptions whose account's `userId` is one of the owners, or whose `organizationId` is one of the profiles;
2. `store.billing.grantsCovering({ ownerUserIds, organizationIds })`;
3. `store.users.trialStartsFor(ownerUserIds)`.

The Malafat status is already loaded by `buildMe`, so it's passed in rather than queried again.

### 2.4 `GET /v1/me`

Each `profiles[]` entry gains `billing: { state, source, tier, until } | null`. It's **null where billing doesn't apply**, which is the portal's local (signed-out) mode, the same way `terms` is.

`PortalRouteDependencies` gains `billing: boolean`:
- `createApp` passes `true`;
- `createLocalApp` passes `false`.

`meRoutes(store, terms, billing)`, and `buildMe` takes the same flag (device sign-in calls it too).

The schema: `BillingEntitlementSchema` is inline and nullable, like `terms`, so the generated portal type keeps the null (the review-pass-2 lesson in `schemas.ts`). The field is additive: today's portal and phone ignore it.

API version: `1.41.0-mut358` (from `1.40.0-mut325`).

### 2.5 Store guard

There's a new `billing` repository on `LedgerStore`, implemented in `memory.ts` and `prisma.ts`. In `STORE_ACCESS`:
- `subscriptionsCovering` and `grantsCovering` are `read`: `/v1/me` runs them as the person, and they return nothing about other people beyond what the person's own profiles need.
- `createGrant`, `revokeGrant`, `listGrants`, `linkAccount` and `listAccounts` are `operator`.

`users.trialStartsFor` is `read`.

### 2.6 Operator surface (admin API + CLI), every write audited

| Route | Does | Audit |
|---|---|---|
| `POST /admin/v1/billing/grants` `{ userEmail? \| userId? \| organizationId?, tier, reason, expiresAt? }` | Grants coverage | `billing.grant_created` |
| `DELETE /admin/v1/billing/grants/{grantId}` | Sets `revokedAt` (never deletes) | `billing.grant_revoked` |
| `GET /admin/v1/billing/grants?userId=&organizationId=&active=` | Lists grants | — |
| `POST /admin/v1/billing/accounts/link` `{ stripeCustomerId, userId \| userEmail }` | Links a customer to a person; refuses if either side is already linked elsewhere (409) | `billing.account_linked` |
| `GET /admin/v1/billing/accounts?linked=false` | Lists unlinked Stripe customers | — |

**Where audit rows land:** `AuditEvent.organizationId` is required. A user-level event is written on **each profile the person owns**, as `termsAcceptedAudit` does. An organization-level event goes on that organization. `actorType: ADMIN`.

**The CLI** is `server/src/scripts/billing.ts`, `npm run billing -- <command>`. It follows `users.ts` and reuses its exported `adminClient`. Commands:
- `grant --email|--organization-id --tier --reason [--expires]`;
- `revoke --grant-id`;
- `grants [--email|--organization-id]`;
- `link --customer cus_… --email`;
- `unlinked`.

### 2.7 The pre-billing backfill (P1)

The migration inserts **one OPERATOR grant per existing user** and **one per existing organization without an owner** (operator-provisioned firms):
- `reason = 'pre-billing'`;
- no expiry;
- tier FREELANCER for users, FIRM for those organizations;
- `grantedBy = 'migration:mut358'`.

So when MUT-361 starts enforcing, nobody who exists today goes read-only. The pilot runbook revokes a person's pre-billing grant once their Stripe subscription is linked.

## 3. Reuse

- `profileOwnerOf` (personal-profile.ts) gives the owner.
- `buildMe`'s existing Malafat lookup gives the MALAFAT source.
- The `terms` nullable-inline pattern is reused for the schema and for local mode.
- `adminAuth`, `adminClient` and the `users.ts` CLI shape are reused for the operator surface.
- `termsAcceptedAudit`'s fan-out over owned profiles is reused for audit rows.
- Nothing in `COMPONENT_REGISTRY.md` applies; it has no UI.

## 4. Impact

- **Schema:** 4 tables, 2 enums and 1 column. The backfill touches every user and every firm organization, so it's O(users + orgs) rows. That's small: hundreds today.
- **`/v1/me`:** +3 queries per call, whatever the number of profiles. `buildMe` already does 2 queries per profile.
- **Contract:** additive. The local mode gets a `billing: null` field.
- **MUT-331:** P2 replaces the `emailVerifiedAt` that I suggested on MUT-331 (comment 12261) with `User.trialStartedAt`. I'll update that comment.
- **MUT-300:** not touched (§2.2).

## 5. i18n, cost and infra

- **i18n:** none. No user-visible strings; MUT-361 and MUT-362 bring the copy.
- **Cost:** no external calls; Stripe isn't contacted.
- **Infra:** a migration only. No env vars or secrets; those are MUT-360's.

## 6. Tests (TDD), commands and QA

**`server/src/billing/__tests__/entitlement.test.ts`** (pure, written first), one case per rule:
- Malafat wins over everything.
- An active grant; an expired grant falls through; a revoked grant falls through.
- A Freelancer subscription covers the owner's personal and business profiles, but not a firm the owner is only a member of.
- A Firm subscription covers its organization *and* the payer's own profiles.
- `past_due` → GRACE.
- Two subscriptions: ACTIVE beats GRACE, and FIRM beats FREELANCER on a tie.
- Trial boundaries:
  - day 0 and day 13.99 → ACTIVE;
  - day 14 → READ_ONLY with `until` = day 30;
  - day 29.99 → READ_ONLY;
  - day 30 → LOCKED.
- **Paid then canceled, with an old trial → READ_ONLY, never LOCKED** (AC2).
- `incomplete` is ignored; with only an `incomplete_expired` subscription and an ended trial past day 30 → LOCKED (never paid).
- No owner and no coverage → READ_ONLY with source NONE.

**Coverage and routes** (memory store, `server/src/__tests__/billing-*.test.ts`):
- `/v1/me` reports `billing` per profile, and `null` from the local-mode app.
- `entitlementsFor` makes 3 store calls for N profiles.
- Admin grant, revoke, link, link conflict (409) and the unlinked listing.
- An audit row lands on every profile the person owns.
- The CLI parses its commands and calls the right routes (fake fetch).
- Store-guard classification: the `STORE_ACCESS` map is exhaustive by type; the existing guard test covers it.

**Prisma** (`test:db`):
- the repository's covering queries;
- the CHECK constraint (exactly one target);
- the backfill migration grants every pre-existing user and every owner-less organization.

**Commands** (Node 22, TD-054):
- `npm --prefix server run typecheck`, `lint`, `openapi:check`, `test`; and `test:db` against local Postgres;
- at the root: `npm run typecheck`, `npm run test:run` (the portal type regenerates from OpenAPI).

**Release-QA:** **no user-visible flow** in this ticket. The `billing` field has no UI until MUT-361 and MUT-362, whose briefs carry the QA scenarios (`qa/features/portal/billing.yaml`). `release-qa lint` must show no new unmapped files: map `server/src/billing/**` and the new route and script to the existing server/API feature group, or mark them `manual: true` with that reason.

## 7. Decisions for Basel

- **P1. Backfill pre-billing grants for everyone who exists today** (recommended), so MUT-361 can't put a current user into read-only. The alternative is no backfill: then every pilot user must be linked to Stripe or granted by hand before MUT-361 ships.
- **P2. `User.trialStartedAt` (null = no trial), not `emailVerifiedAt`.** Operator-issued accounts never trial; MUT-331's signup sets it. It keeps "when did the trial start" apart from "is the email verified".
- **P3. Firm coverage ignores `firmEnabledAt`.** A Firm subscription covers its organization whether or not the flag is on. MUT-363 decides what the flag needs.
