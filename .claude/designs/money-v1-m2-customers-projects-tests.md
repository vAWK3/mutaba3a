# Money v1 — Milestone 2 test plan

Companion to `money-v1-m2-customers-projects.md`. Written before implementation (CLAUDE.md Phase 2). Numbers in brackets are the brief's acceptance criteria.

## Unit (no I/O)

| File | Cases |
|---|---|
| `src/__tests__/pagination.test.ts` | cursor round-trips `(createdAt, id)`; tampered cursor → `VALIDATION_FAILED`; `limit` default 50, max 200, 0/negative/non-integer rejected; page boundary with equal `createdAt` resolved by `id` |
| `src/import/__tests__/plan.test.ts` | every row of the brief's preview/commit table: unknown → create; linked same type → link (+ `NAME_DIFFERS` warning, name never overwritten); unknown customer in org and batch → `UNKNOWN_CUSTOMER`; customer in the same batch resolves; linked to another customer → `CUSTOMER_MISMATCH`; currency differs → `CURRENCY_DIFFERS`; unsupported currency / empty name / duplicate external id in batch → `VALIDATION`; archived link → warning `ARCHIVED`; 501 rows → rejected; order of outcomes matches input order |
| `src/import/__tests__/preview-token.test.ts` | same rows in different order → different token (rows are positional); same rows, different organization → different token; token verification is constant-time compare |

## Storage contract (`store-contract.ts`, run by memory and Postgres)

| Case | Pins |
|---|---|
| create customer / project, get by id, list ordered by `(createdAt, id)` | [4] |
| list is organization-scoped: two organizations, same names, never cross | [4] isolation |
| external reference unique per `(organization, provider, entityType, externalId)`: second insert → `UniqueViolation`; same externalId with other `entityType` → allowed; same externalId in another organization → allowed | [2], decision 1 |
| one external reference per entity: second provider ref for the same entity allowed, second MALAFAT ref → `UniqueViolation` | |
| `findByExternalId` returns the entity and its reference | [2] |
| optimistic update: `update(id, expectedVersion)` increments version, returns null on mismatch, never partially applies | [6] |
| archive customer / project: sets status + `archivedAt`; idempotent; `countActiveProjects(customerId)` | decision 2 |
| `hasPostedActivity(projectId)` is false for every project in M2 (the M3 hook) | [3] |
| filters: `customerId`, `externalId`+`provider`, `status`, `currency` | [4] |
| cursor pagination across 250 rows with `limit` 100 → 3 pages, no gaps, no repeats | [4] |

## Routes (`src/__tests__/routes-m2.test.ts`, in-memory app)

| Area | Cases |
|---|---|
| Scopes | `customers:read` key → `403 INSUFFICIENT_SCOPE` on `POST /customers` with `details.required = "customers:write"`; same matrix for projects, archive, import (import needs both write scopes; one missing → 403 naming the missing one) |
| Create customer | `201` with serialized shape (no `organizationId` on the wire); `Idempotency-Key` missing → `422 IDEMPOTENCY_KEY_REQUIRED`; replay same key+body → same body, `Idempotent-Replayed: true`; external reference already present → `200` existing, no duplicate, no audit `customer.created`; external reference when integration not CONNECTED → `409 CONFLICT` `reason INTEGRATION_NOT_CONNECTED`; invalid email → `422` |
| Get / list customers | own id → `200`; other organization's id → `404`; malformed uuid → `422`; `?externalId=` filter; `?status=ARCHIVED`; pagination headers/body `{ items, nextCursor }`; `limit=201` → `422` |
| Patch customer | missing `If-Match` → `422`; stale → `409 CONFLICT` `{ reason: "VERSION_MISMATCH", currentVersion }`; success increments `version` and appends `customer.updated` with the changed fields in metadata |
| Archive customer | with an ACTIVE project → `409 HAS_ACTIVE_PROJECTS`; after archiving the project → `200`; second archive → `200` unchanged; audit `customer.archived` once |
| Create project | `201`; unknown `customerId` → `422` with `details.field`; archived customer → `422`; unsupported currency → `422`; external reference match with different `customerId` → `409 CUSTOMER_MISMATCH`; match with same customer → `200` existing |
| Patch project | name ok; `currency` change while `hasPostedActivity` false → `200`; with the hook forced true (test double) → `409 CURRENCY_LOCKED`; `customerId` in body → `422` |
| Import preview | writes nothing (store counts unchanged); per-row actions match `plan.ts` table; returns `previewToken`; 501 rows → `422` |
| Import commit | token for other rows → `409 PREVIEW_STALE`; happy path creates customers before projects and links project rows to batch customers; re-run → all `linked`; one failing row does not roll back earlier rows; `Idempotency-Key` replay returns the stored outcome without re-applying; audit has one `import.committed` event with totals plus per-entity `created` events |
| Isolation | two organizations with identical external ids: each sees only its own in every list/get/import |
| OpenAPI | `/openapi.json` lists every new path; `openapi:check` passes after `openapi:generate`; `info.version` is `1.1.0-m2`; the `reason` vocabulary appears in the description |

## Regression

- Every M1 test stays green unchanged (65 today).
- `npm run smoke` unchanged; `npm run test:db` includes the new contract cases against Postgres 16.

## Not automated

- Malafat-side mapping and sync UI (separate brief).
- Import performance at the 500-row cap against Cloud SQL: one manual run from the runbook's proxy, recorded in `TEST_PLAN.md`.
