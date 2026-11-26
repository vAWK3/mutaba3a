# MUT-742: generalise the issuing schema (jurisdiction, pack version, tax-ID scheme, clearance record): PLAN (2026-11-26)

**Status:** plan for approval. Nothing built. Epic MUT-738 (ADR-287). Needs MUT-740 and MUT-741 (both merged, In Review). Answers MUT-667's open question (the customer snapshot carries a country).

## 1. What is true today (read from the code)

- `issued_documents` records no jurisdiction; its `coreVersion` is the only stamp. MUT-741 already stamps `{coreVersion, jurisdiction, packVersion}` in the issue and cancel *audit* entries: this ticket moves the stamp onto the document itself.
- `VarChar(9)`: `issuer_details.vatId`, `customers.taxId`, `issued_documents.allocationNumber`, `expenses.allocationNumber`. The allocation number is a column on the document; there is no clearance record.
- The legal tables (`issued_documents`, `issued_document_lines`, `issued_document_copies`) have `BEFORE UPDATE OR DELETE` triggers (`issuing_refuse_change`) and a `BEFORE TRUNCATE` trigger; counters have `issuing_counter_guard`. The one way past them is `SET LOCAL mutaba3a.issuing_bypass = 'on'` inside the MUT-644 sweep and erase transactions (`repositories/prisma.ts` ~4200-4222), which delete the tables listed in `RETAINED_ISSUING_DOCUMENT_TABLES` and `RETAINED_ISSUING_PROFILE_TABLES`.
- Precedent: MUT-711 added `allocationSource` to the immutable table with `ADD COLUMN` and no backfill ("rows issued before stay NULL").
- Issuer details and customers are mutable tables; the issuer and customer *snapshots* on a document are JSON (no schema).
- The local records file (portal local mode, MUT-325) carries customers (`CUSTOMER` column map, type-checked), not issued documents or issuer details. The memory store's snapshot format is versioned (`CURRENT_STORE_SNAPSHOT_VERSION` = 23, with a comment per bump).

## 2. How existing issued rows stay unchanged (the orchestrator's question)

1. **No `UPDATE` ever touches `issued_documents`.** New columns are added with `ADD COLUMN … NOT NULL DEFAULT 'IL'` / `'1.0.0'`: in Postgres 11+ that is a catalog-only change (the default is stored as the column's "missing value", rows are not rewritten and no trigger fires), and the old rows read back `IL` and `1.0.0`. The defaults stay (see decision D1).
2. Widening a `VarChar` is also catalog-only and touches no row. It happens only on **mutable** tables (`issuer_details.vatId`, `customers.taxId`); `issued_documents.allocationNumber` stays `VarChar(9)` (it is Israel's projection; other countries' references go in the clearance record).
3. The new clearance table is **new**: no old row is copied or rewritten. Old Israeli documents keep their number in `allocationNumber`; readers derive an Israeli clearance from that column when a document has no clearance row.
4. Proof (tests, §5): a migration test applies the migrations up to the previous one on a scratch database, inserts documents, lines and copies, takes an md5 of every pre-existing column of every row, applies this migration, and compares: identical. Then `UPDATE`/`DELETE` on a document still raise `issued documents are immutable`, the new table refuses them too, and the MUT-644 sweep and erase delete the new table's rows with their document.

## 3. Design

**One migration** `server/prisma/migrations/<ts>_mut742_issuing_jurisdiction/migration.sql`, additive:
- `issued_documents`: `jurisdiction VARCHAR(2) NOT NULL DEFAULT 'IL'` (+ CHECK `^[A-Z]{2}$`), `jurisdictionPackVersion VARCHAR(16) NOT NULL DEFAULT '1.0.0'`.
- `issued_document_clearances` (new, INSERT-only like the other legal tables, no foreign keys per MUT-644): `id`, `organizationId`, `documentId`, `kind VARCHAR(32)` (Israel: `IL_ALLOCATION`), `reference VARCHAR(128)`, `source VARCHAR(16)` (`API`/`MANUAL`), `createdAt`; unique `(documentId, kind)`; the same `BEFORE UPDATE OR DELETE` and `BEFORE TRUNCATE` triggers via `issuing_refuse_change`. Added to `RETAINED_ISSUING_DOCUMENT_TABLES` (deleted by the sweep and the erase).
- `issuer_details`: `vatId` to `VarChar(32)`; `vatIdScheme VARCHAR(16) NOT NULL DEFAULT 'IL_TAX_ID'`.
- `customers`: `taxId` to `VarChar(32)`; `taxIdScheme VARCHAR(16) NULL` (backfilled `IL_TAX_ID` where `taxId` is set: customers are mutable); `country VARCHAR(2) NULL` (null = the issuer's country).

**Pack:** `taxId.scheme` (`'IL_TAX_ID'`) joins the pack interface; `documentTypes`/`clearance` unchanged. `IL_PACK.version` stays `1.0.0`.

**Code (server):**
- `repositories/ports.ts`: `IssuedDocumentRecord` + `IssueDocumentInput` gain `jurisdiction`, `jurisdictionPackVersion`, `clearances` (list of `{kind, reference, source}`); `IssuerDetailsRecord/Input` gain `vatIdScheme`; `CustomerRecord/Input` gain `taxIdScheme`, `country`.
- `repositories/prisma.ts` and `memory.ts` (both stores, one contract suite): write and read the new fields; the Israeli allocation is written to **both** `allocationNumber` (projection, API unchanged) and a clearance row `IL_ALLOCATION`; a reader (`clearancesOf(document)`) returns the rows, or the one derived from `allocationNumber` for an old document.
- `routes/issuing.ts`: the issue stamps `pack.country` and `pack.version` on the document (the MUT-741 audit stamp stays); the issuer and customer **snapshots** gain `country` and `vatIdScheme`/`taxIdScheme` (a customer's `country` only when set), old snapshots read as the issuer's country; `PUT /v1/issuer` writes `vatIdScheme = pack.taxId.scheme`; `routes/customers.ts` writes `taxIdScheme` from the default pack when a tax ID is set (TD-349 covers the default pack).
- `schemas.ts`/`serializers.ts`: `IssuedDocument` gains `jurisdiction` and `jurisdictionPackVersion` (additive; `allocationNumber` unchanged); OpenAPI regenerated (`openapi.yaml`, `src/hosted/api/schema.d.ts`), API version bump. No `^\d{9}$` pattern changes (TD-350, MUT-743).
- Local mode: `CustomerRecord` gains `taxIdScheme` and `country`, so the `CUSTOMER` column map and the records file carry them; `CURRENT_STORE_SNAPSHOT_VERSION` 23 → 24 with a comment line; restoring an older file defaults them (`taxIdScheme` null, `country` null).
- Exports: the uniform file still reads `allocationNumber` and the nine-digit IDs (unchanged); the retention archive and operator listing are checked for the new fields.

## 4. Decisions (recommended option first)

- **D1. Keep the column defaults.** The new code always writes explicit values. A rolled-back API image (which doesn't know the columns) inserts documents without them and gets `IL` / `1.0.0`, which is correct while Israel is the only live country; dropping the defaults would make a rollback fail every issue. The hazard goes in `before-release.md`: after a second country goes live, never roll the API back past this migration.
- **D2. The clearance record is a table**, not two more columns: ZATCA has a UUID, a hash and a QR, JoFotara its own, so one document may need several rows. Israeli documents dual-write for now; the clearance list is not exposed in the API until MUT-743/MUT-667 need it.
- **D3. Customer `country` and `taxIdScheme` columns land now** (the ticket asks for them, and the snapshot needs a source), written only by `taxIdScheme` today; the customer form and API for `country` wait for MUT-667/743. Alternative: snapshot fields only, no customer columns: smaller, but the customer's country would have nowhere to come from.
- **D4. Merge timing.** mini-crm main is being frozen for the next release (orchestrator): the migration is built and verified on the branch and merged only after Basel's yes and the release is out (or he picks otherwise).

## 5. TDD and test plan

Red first, then green:
1. **Migration test** (`repositories/__tests__/migration-mut742.test.ts`, Postgres, like `migration-mut182`): apply migrations to the previous one, insert document/lines/copies/counters/customers/issuer rows, md5 each pre-existing column, apply this migration; rows identical, `jurisdiction = 'IL'`, `jurisdictionPackVersion = '1.0.0'` on old documents; triggers on `issued_documents` still refuse UPDATE/DELETE/TRUNCATE; the new table refuses them; a `SET LOCAL mutaba3a.issuing_bypass='on'` delete works; customers with a tax ID get `IL_TAX_ID`.
2. **Store contract** (`store-contract-issuing*.ts`, both stores): a new document carries jurisdiction, pack version and an `IL_ALLOCATION` clearance equal to `allocationNumber`/`allocationSource`; an old-shape record (no clearance rows) derives it; a retry returns the same; the sweep and erase delete the clearance rows (`store-contract-issuing-retention.ts`, plus the Postgres sweep test).
3. **Routes**: the issued document's response and snapshots carry the new fields; the issuer save sets the scheme; a customer with a tax ID gets its scheme; the uniform file bytes unchanged (the MUT-741 golden test stays green: its documents don't touch these columns).
4. **Local mode**: records-file export/import round trip with the new customer fields; restoring a v23 file works; `store-records-export-parity` stays green.
5. `openapi:check`, `hosted:types` diff is additive only; `release-qa lint`.
Commands (queued): `heavy -l "MUT-742 …" -- npm --prefix server run test:db -- <migration and store files>` against `MUTABA3A_TEST_DATABASE_URL` (needs the local test Postgres on :54329; the orchestrator is asked first), then the full server suite.

## 6. Coordination (machine)

- Prisma client: my worktree gets its **own** copy of `@prisma/client` and `.prisma` (real directories, not links to main's), generated from my schema there; the shared client is never touched. After the merge the orchestrator runs the dev-DB migrate and the single shared `prisma generate`, as with MUT-740.
- Test database: a scratch database on the test Postgres, dropped after; asked before use.

## 7. Impact, risk, cost, scope

- ~25 files: migration, schema, two stores, ports, issuing and customer routes, serializers, schemas, OpenAPI, memory snapshot version, tests, docs. Portal and phone untouched (additive API fields). No infra, no cost.
- Risk: the immutable tables. Mitigation: catalog-only DDL, the md5 migration test, triggers re-tested, additive and default-safe rollback. QA re-record: none (no user-visible change; the existing flows read the same fields).
- Scope: AC1 (rows unchanged, IL) §2/§5.1; AC2 (triggers and sweep) §5.1/§5.2; AC3 (rollback hazard in before-release.md) D1; AC4 (OpenAPI, schema.d.ts, records and uniform-file exports) §3/§5.3-5.5. Not in scope: customer `country` UI/API, the clearance list in the API, widening the nine-digit API patterns (TD-350), a second pack.

## 8. Eng review (fresh read-only reviewer, 2026-11-26): approve with changes, folded in

Verified by the reviewer: the triggers, the bypass and the MUT-711 precedent are as §1 says; Postgres is 16, so `ADD COLUMN … NOT NULL DEFAULT` is catalog-only and fires no trigger; widening `VARCHAR(9)` is metadata-only; `ADD CONSTRAINT CHECK` scans under a lock without firing triggers (acceptable at today's row count; use `NOT VALID` then `VALIDATE`); `issuer_details` has no trigger; snapshots are `z.record(string, unknown)`, so new keys pass through and readers must treat a missing `country`/scheme as the issuer's.

**Corrections to the plan**
1. **Rollback hazard (D1 was mis-described).** An old API image inserts documents fine (the defaults hold). The real hazard is the new table: the old sweep and erase don't know it, so they delete `issued_documents` and leave clearance rows behind, silently, with no FK and no bypass failure, and the operator listing never shows them (a retention and erasure breach). So: a `ROLLBACK_HAZARDS` entry in `server/src/scripts/rollback-check.ts` (migration `_mut742_`, count of clearance rows) plus the matching `DEPLOYMENT.md` §6 row (`rollback-check.test.ts` requires the doc and the query text identical), not only a line in `before-release.md`. Documents issued under an old image get no clearance row: the derived read covers them.
2. **Registering a new legal table** (if it is built): `['issued_document_clearances','documentId']` in `RETAINED_ISSUING_DOCUMENT_TABLES` before `issued_documents` (the test keeps that one last), a `PURGE_PROFILE_TABLES_EXEMPT` entry starting "kept 7 years from each document", and the table added to the INSERT-only assertions in `store-prisma-issuing.test.ts`.
3. **Dual-write rule:** the clearance row is written in the same transaction as the document, after the replay check, only when `allocationNumber` is non-null, with the same source (API or MANUAL, MUT-711); a retry returns the existing document and adds nothing; the memory store mirrors it, one contract test for both.
4. **Local mode:** bumping the snapshot to 24 needs a step `{from: 23, to: 24}` in `src/hosted/local/migrations/index.ts` (it throws without one), the `memory.ts` version comment, and the hand-kept fingerprint in `format-fingerprint.test.ts`; `migrations.test.ts` and `recordsFile.test.ts` pin the version.
5. **Migration test:** old rows go in by raw SQL (as `store-prisma-issuing.test.ts` does); the harness is `migration-mut735.test.ts` (scratch database, apply up to the previous migration, then this one). The new migration's timestamp must sort after `20261127130000_mut740_issuer_country`.
6. **Also:** `prisma generate` in the worktree's own client copy; `openapi.yaml`, `schema.d.ts`, `hosted:types`; the `IssuedDocument` zod schema and serializer (`serializers.ts` ~855-880); update the `versionStamp` comment ("until MUT-742"); verify `issuing-retention.ts` selects named columns; leave a TD-350 pointer near `Number(issuer.vatId)` (`issuing.ts`), which is NaN-prone for a non-numeric ID.
7. **Widening has no consumer yet** (every reader still assumes nine digits): say so.

**Scope options for Basel (the reviewer recommends A)**
- **A. Trimmed (recommended):** on `issued_documents` add `jurisdiction` and `jurisdictionPackVersion`; on `issuer_details` widen `vatId` and add `vatIdScheme`; widen `customers.taxId`; snapshots gain the issuer's `country` and `vatIdScheme`. Defaults kept (rollback-safe: no new legal table, so no orphan hazard). **Deferred, with a comment on each ticket:** the clearance table to MUT-743 (its first reader, which can migrate it cleanly: adding a table later is as cheap and as safe as now), and the customer `country`/`taxIdScheme` columns to MUT-667/743 (mutable table, can be added any time; no local-mode snapshot bump now). Removes corrections 1-4 above and the local-mode step. The only thing that is *cheapest before the first production document* (the immutable table's columns) is all in.
- **B. As the ticket reads:** everything in §3 plus corrections 1-6 (clearance table with its retention, rollback-gate and dual-write work; customer columns with the local-mode step). Larger, more risk, no consumer yet.

## Business / product impact
- Makes the first real production document the last one stamped without a country: from here every issued document says which country's rules it was issued under, and a ZATCA or JoFotara reference has a place to live.
- Second step of epic MUT-738 after the pack extraction; unblocks MUT-743 (rules read), MUT-745 (contract suite) and MUT-667's customer-country question.
- Cost framing: one additive migration now, while the legal tables hold almost no rows, instead of a hazardous one after real invoices exist.
