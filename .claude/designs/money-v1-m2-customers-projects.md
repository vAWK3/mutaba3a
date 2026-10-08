# Money v1 — Milestone 2: Customers and projects (design brief)

- **Date:** 2026-10-08 · **Status:** awaiting product-owner approval (CLAUDE.md lifecycle, Phase 1)
- **Tickets:** MUT-25 (epic), MAL-939 (Malafat epic) · **Contract:** `money-v1-api-contract.md` §3 M2 · **Plan:** §3.2–3.3, §10.2–10.3
- **Repo side:** Mutaba3a `server/` only. The Malafat side of M2 (client/matter → customer/project mapping, sync UI) is a separate brief in Confluence under Design Documents, linked from MAL-939.
- **Decisions already taken that bound this brief:** ADR-024/025/026; Money is included for every Malafat tenant (MAL-870, $0 add-on); keys are operator-issued (TD-018 accepted).

## 1. Problem and acceptance criteria

M1 lets a firm connect. Nothing financial can be recorded because the ledger has no parties and no containers: every later object (agreement, installment, receivable, payment) hangs off a **project**, which belongs to a **customer**, which belongs to the organization. M2 creates those two resources with the one property the plan makes non-negotiable: a Malafat client and matter map to exactly one Mutaba3a customer and project, idempotently, so Malafat can retry forever without creating duplicates.

Acceptance (plan §16 M2, restated as tests in `money-v1-m2-customers-projects-tests.md`):

1. A key with `customers:write` creates a customer; one with only `customers:read` gets `403 INSUFFICIENT_SCOPE`. Same for projects.
2. Creating a customer with an `externalReference` that already exists in the organization returns `200` with the existing customer, never a duplicate. Different organization, same `externalId`: independent rows (cross-organization isolation holds).
3. A project carries a single currency from `SUPPORTED_CURRENCIES`; it can be changed only while the project has no posted activity. In M2 nothing can be posted, so the check always passes, but the rule, the store hook and the `409 CONFLICT` / `CURRENCY_LOCKED` response exist and are tested so M3 only flips the hook.
4. `GET` lists paginate with `limit` ≤ 200 and an opaque cursor, filter by `externalId` / `customerId`, and never return another organization's rows.
5. `POST /v1/import/preview` reports `create | link | conflict` per row without writing anything; `POST /v1/import/commit` with the preview token applies it, is idempotent (a re-run links instead of creating), and reports per-row outcomes including failures.
6. Every write appends an audit event; `PATCH` requires `If-Match` and rejects a stale version with `409 CONFLICT`.
7. OpenAPI regenerated and `openapi:check` green; API version `1.1.0-m2`.

## 2. Proposed solution

### 2.1 Data model (Prisma, migration `m2_customers_projects`)

```
customers            projects                      external_references
──────────           ─────────                     ───────────────────
id uuid              id uuid                       id uuid
organization_id      organization_id               organization_id
name                 customer_id → customers       provider        MALAFAT
email?               name                          entity_type     CUSTOMER | PROJECT
phone?               currency  char(3)             entity_id       uuid
notes?               status    ACTIVE | ARCHIVED   external_id     text
status ACTIVE|ARCHIVED archived_at?                created_at
archived_at?         version   int                 UNIQUE (organization_id, provider, entity_type, external_id)
version int          created_at, updated_at        UNIQUE (provider, entity_type, entity_id)
created_at, updated_at  INDEX (organization_id, customer_id)
INDEX (organization_id, created_at, id)   INDEX (organization_id, created_at, id)
```

- **Organization scoping by foreign key**, as in M1: every table carries `organization_id`; every repository method takes it; no route ever reads an organization id from the request.
- **External references are their own table**, not columns on customers/projects: one entity can be referenced by at most one external id per provider (second unique index), a provider other than Malafat can be added without a migration, and the lookup index is the one the import path hits.
- **Uniqueness includes `entity_type`.** The contract doc wrote `(organization, integration, provider, externalId)`; this brief refines it because Malafat clients and matters are different tables whose ids are only accidentally disjoint (both uuids today). The refinement is strictly safer and changes nothing for Malafat. *(Decision 1 for approval.)*
- **Integration id is not part of the key.** A reconnection keeps the integration id (M1), so storing it adds nothing; `provider` is enough.
- **Archive, never delete.** `status` + `archived_at`; an archived project refuses new financial activity from M3 on. Plan §13: nothing financial is deleted. *(Decision 2.)*
- **Customer fields:** `name` required, `email` / `phone` / `notes` optional strings. Malafat already holds the rich client record; the ledger needs a display name and a stable id, nothing more. *(Decision 3: keep it this thin.)*
- **No currency on customers.** Currency is per project (plan §3.3, ADR-004); a customer may have ILS and USD projects.

### 2.2 Routes (all under `/v1`, Bearer key, scopes as listed)

| Method & path | Scope | Idempotency | Behaviour |
|---|---|---|---|
| `POST /customers` | `customers:write` | `Idempotency-Key` required | Body `{ name, email?, phone?, notes?, externalReference?: { provider, externalId } }`. If `externalReference` matches an existing customer → `200` existing (not updated). Else `201`. |
| `GET /customers` | `customers:read` | — | `?externalId=&provider=&status=&limit=&cursor=`; `{ items, nextCursor }`, ordered by `createdAt, id`. |
| `GET /customers/{id}` | `customers:read` | — | `404 NOT_FOUND` for another organization's id (never 403: ids are not enumerable across organizations). |
| `PATCH /customers/{id}` | `customers:write` | `If-Match: <version>` required | Partial update of name/email/phone/notes. Stale version → `409 CONFLICT` `{ reason: "VERSION_MISMATCH", currentVersion }`. |
| `POST /customers/{id}/archive` | `customers:write` | `Idempotency-Key` | Archives the customer **and refuses if any project is ACTIVE** (`409 CONFLICT`, `reason: "HAS_ACTIVE_PROJECTS"`). Idempotent on an archived customer (`200`). |
| `POST /projects` | `projects:write` | `Idempotency-Key` | Body `{ customerId, name, currency, externalReference? }`. Customer must exist in the organization and be ACTIVE (`422 VALIDATION_FAILED` otherwise, with `details.field = "customerId"`). External-reference idempotency as for customers; a match whose `customerId` differs from the body → `409 CONFLICT` `{ reason: "CUSTOMER_MISMATCH" }`. |
| `GET /projects`, `GET /projects/{id}` | `projects:read` | — | `?customerId=&externalId=&provider=&status=&currency=` |
| `PATCH /projects/{id}` | `projects:write` | `If-Match` | name; `currency` only while `store.projects.hasPostedActivity(id)` is false, else `409 CONFLICT` `{ reason: "CURRENCY_LOCKED" }`. `customerId` is immutable (`422`). |
| `POST /projects/{id}/archive` | `projects:write` | `Idempotency-Key` | Archive; idempotent. (From M3: refused while receivables are outstanding.) |
| `POST /import/preview` | `customers:write` + `projects:write` | — (read-only) | Body `{ provider, rows: [...] }` (≤ 500 rows). Returns per-row `{ index, action: "create"|"link"|"conflict", entityType, externalId, existingId?, reason?, warnings[] }` and a `previewToken`. Writes nothing. |
| `POST /import/commit` | both write scopes | `Idempotency-Key` + `previewToken` | Re-evaluates every row against current state (the token only proves the caller saw a preview of **these rows**: `sha256(organization, provider, canonical rows)`; a token for different rows → `409 CONFLICT` `{ reason: "PREVIEW_STALE" }`). Applies customer rows then project rows, each in its own transaction; returns per-row `{ index, outcome: "created"|"linked"|"failed", id?, reason? }` and totals. A re-run with the same rows yields all `linked`. |

Row shape: `{ entityType: "CUSTOMER", externalId, name, email?, phone? }` or `{ entityType: "PROJECT", externalId, name, currency, customerExternalId }`. Project rows resolve their customer by external id against the organization **or** the same batch (customer rows are applied first).

Preview/commit row rules:

| Situation | Preview | Commit |
|---|---|---|
| external id unknown | `create` | `created` |
| external id already linked, same type | `link` (+ warning `NAME_DIFFERS` if the names differ; the ledger name is **not** overwritten) | `linked` |
| project row whose customer external id is in neither the organization nor the batch | `conflict` `UNKNOWN_CUSTOMER` | `failed` `UNKNOWN_CUSTOMER` |
| project already linked but to a different customer | `conflict` `CUSTOMER_MISMATCH` | `failed` |
| project linked, currency in the row differs | `conflict` `CURRENCY_DIFFERS` | `failed` (currency changes go through `PATCH`, where the lock rule lives) |
| unsupported currency, empty name, duplicate external id inside the batch | `conflict` `VALIDATION` | `failed` |
| linked entity is ARCHIVED | `link` + warning `ARCHIVED` | `linked` (not reactivated) |

Non-transactional across rows on purpose (contract: "reports partial failures per row"): a 400-row import that fails on row 212 keeps 211 linked rows, and the next run links them again at no cost. *(Decision 4.)*

Error-code additions: none. All new conditions use existing codes with `details.reason` (`VERSION_MISMATCH`, `CURRENCY_LOCKED`, `CUSTOMER_MISMATCH`, `HAS_ACTIVE_PROJECTS`, `PREVIEW_STALE`, `INTEGRATION_NOT_CONNECTED`). The `reason` vocabulary is published in the OpenAPI description, the way scopes and codes are.

Precondition for any `externalReference` or import call: the organization's integration for `provider` is `CONNECTED`; otherwise `409 CONFLICT` `{ reason: "INTEGRATION_NOT_CONNECTED" }`. A disconnected firm can still read, and can create unreferenced customers by hand through a future console, but cannot link to a tenant it is not bound to.

### 2.3 Component diagram

```
routes/customers.ts ─┐                                   ┌─ repositories/ports.ts
routes/projects.ts  ─┼─ requireScope · idempotent · ifMatch ─┼─ CustomerRepository
routes/import.ts    ─┘      (auth/middleware, idempotency)   ├─ ProjectRepository
        │                                                    └─ ExternalReferenceRepository
        ├─ import/plan.ts   pure: rows + current state → per-row plan (preview and commit share it)
        ├─ pagination.ts    cursor encode/decode (createdAt,id) — new, reusable for every later list
        ├─ serializers.ts   serializeCustomer / serializeProject (+ externalReference)
        └─ schemas.ts       CustomerSchema, ProjectSchema, ImportRowSchema, ImportPreviewSchema, PageSchema(T)
repositories/memory.ts · repositories/prisma.ts   both implement the three new repositories
repositories/__tests__/store-contract.ts          one suite, run by memory + Postgres
```

New middleware: `ifMatch()` (reads `If-Match`, exposes the expected version to the handler; missing header → `422 VALIDATION_FAILED`). New pure module: `import/plan.ts`, the single place that decides `create | link | conflict`; preview calls it and returns, commit calls it and executes. `previewToken` = `sha256(organizationId | provider | canonicalJson(rows))`, verified by recomputation, never stored.

### 2.4 Reuse (COMPONENT_REGISTRY / existing server code)

| Reused | From |
|---|---|
| `apiKeyAuth`, `requireScope`, `idempotent`, `ApiError`, `errorResponses` | M1 |
| `SUPPORTED_CURRENCIES`, `isSupportedCurrency` | `src/money.ts` |
| Audit append pattern, serializer style, `UniqueViolation` mapping | M1 routes/repositories |
| Contract test harness (`store-contract.ts` + memory/prisma runners) | M1 |
| Smoke (`src/smoke.ts`) gains no steps in M2; the admin round trip still proves the deploy |

Nothing from the desktop app is imported (ADR-024: `server/` imports nothing from `src/`). The desktop's `Client`/`Project` shapes informed the field list only.

### 2.5 Impact analysis

- M1 routes, tables and tests are untouched; the migration is additive.
- `API_VERSION` → `1.1.0-m2`; `openapi.yaml` grows additively (rule: additive ships freely).
- Scopes already exist (`customers:*`, `projects:*`), so keys issued in M1 need no re-issue; `GET /v1/integration`'s `missingScopes` is unchanged.
- The store port grows three repositories; `MemoryLedgerStore` and `PrismaLedgerStore` both change; the contract suite grows ~15 cases.
- No infrastructure change: `deploy.sh` runs the new migration through the proxy like any other.

### 2.6 Malafat obligations created by M2 (for the Malafat brief, not built here)

1. Map Client → Customer and Matter → Project, `externalId` = Malafat's own uuid, `provider = "MALAFAT"`. *(Decision 5: confirm this is the mapping; the alternative, one project per client with matters as references, is rejected here because the plan's agreements and currency live on matters.)*
2. Matters have no currency (audit §3). The sync UI must ask for it per matter on first link, defaulting to `OfficeSetting.currency`.
3. Use `import/preview` + `commit` for the initial link of existing clients/matters; use `POST /customers` / `POST /projects` with `externalReference` for new ones as they are created in Malafat.
4. Generate the client from `openapi.yaml` and add the contract test the M1 test plan already requires.

### 2.7 i18n, cost, infrastructure

- i18n: none server-side; `reason` strings are machine codes for Malafat to translate.
- Cost: three small tables; list endpoints are bounded (`limit` ≤ 200, import ≤ 500 rows). Indexes above cover every query path.
- Infra: one migration; no new GCP resources; no change to Terraform.

## 3. Decisions requested before build

1. External-id uniqueness includes `entityType` (refines the contract doc).
2. Archive instead of delete, with "customer with active projects cannot be archived".
3. Customer stays thin: name + optional email/phone/notes.
4. Import commit is per-row (partial success reported), capped at 500 rows, preview token proves "same rows", not "same world".
5. Malafat mapping: Client → Customer, Matter → Project; currency asked per matter at link time.
6. Scope for M2 excludes any "delete" or "merge customers" operation; a merge is an M3+ question once money hangs off projects.

Approve all six (or amend) and Phase 2 starts: `money-v1-m2-customers-projects-tests.md` is already written; tests land first (Red), then the store, routes and OpenAPI.
