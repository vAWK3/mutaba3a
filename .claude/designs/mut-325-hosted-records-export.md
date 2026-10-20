# MUT-325 — Signed in, download all my records (same records file as local mode)

Status: planned 2026-10-20 (eng-ticket). Epic MUT-322 (pilot gate). Format owner: MUT-286/287 (`src/hosted/local/recordsFile.ts`, `recordsArchive.ts`).
Decisions marked **(D#)** were taken without Basel and are flagged for review in the Jira comment.

## 1. Problem and acceptance criteria

A paying user can't take their data with them. Signed out, Your data offers "Download my records" (a zip of
`records.json` + `receipts/<storageKey>`). Signed in there is no export at all.

- AC1 Signed in, the export of a profile with income, payments, expenses, groups, conversions and receipts restores,
  signed out, into an identical set of records. A parity test covers this.
- AC2 A large profile (10k entries, 200 receipts) exports without timing out; progress is visible; the export can be cancelled.
- AC3 An export is an audited event.
- AC4 Release-QA `@portal.your-data.download-signed-in` passes.

Out: CSV/XLSX accountant pack (MUT-314); importing a file into a hosted account (MUT-290); the phone (ticket is the
portal's Your data; the QA tag is `portal`). Flutter untouched.

## 2. What "the same records file" means here

The local records file is `MemoryLedgerStore.snapshot()` (27 `LocalSnapshotMaps`), JSON with `$map/$date/$bigint`
tags, inside a zip with one STORE entry per READY receipt file. The local app is the server's own route modules over
that store, so a hosted export is "the Postgres rows of one profile, as the memory store would hold them", re-homed to
the local person. Restore, migrations and the format fingerprint stay exactly as MUT-286/287 built them.

## 3. Approach (D1): the server streams JSON + bytes, the portal builds the zip with local mode's code

```
Your data (signed in)                       API (Cloud Run)                          Postgres / GCS
  pick profiles ──► for each profile ──► GET /v1/records-export  (X-Mutaba3a-Profile) ──► paged reads, 500 rows/query
                     decodeRecordsFile ◄── streamed records JSON (gzip)                  re-homed per row
  merge maps (union)                                                                     audit records.exported
  for each READY receipt/attachment ──► GET /v1/records-export/files/{kind}/{id} ──► GCS createReadStream (piped)
  encodeRecordsFile + zipRecordsArchive (the local module, unchanged)  ──► saveBlobAs mutaba3a-export-<date>.zip
```

Why this, not a server-built zip or a background job:

| | Server zip stream | Job + bucket object | **Client-assembled (chosen)** |
|---|---|---|---|
| Same format | second zip writer, parity by test only | same | **`zipRecordsArchive` itself: same by construction** |
| Timeout | one long request; 200 receipts on a slow line can pass Cloud Run's 300 s | none | **many short requests, each well under it** |
| Server memory | bounded if streamed | bounded | **bounded: one 500-row page, one piped file** |
| Progress / cancel | bytes only, no total | polling | **"receipt 37 of 200"; `AbortController`** |
| New infra | none | queue, bucket lifecycle, Terraform (MUT-328 owns `main.tf` now) | **none** |
| Tab memory | none | none | holds the zip once (same ceiling local Download already has) — TD |

Receipt bytes go through the API, not the signed GCS URL: the bucket has no CORS in IaC and downloads today are
top-level navigations (`connect-src` note in `server/DEPLOYMENT.md` §4c), so a `fetch()` of a signed URL is not
known to work. Piping costs Cloud Run egress equal to the file size, once per export.

## 4. Server

### 4.1 Shared records-file module (DRY, D2)
`server/src/records-file/` (imported by the server and by `src/hosted/local/*`, the same way `memory.ts` already is):
- `codec.ts` — the `$map/$date/$bigint` `encode`/`decode`, `RECORDS_FILE_KIND`, `SNAPSHOT_FIELDS`, moved from
  `src/hosted/local/recordsFile.ts` (which keeps its public functions and imports these). Adds a streaming writer
  `writeRecordsFile(write, header, pages)` that emits the identical JSON shape one page at a time.
- `local-person.ts` — `LOCAL_PERSON_EMAIL` moves here; `mintLocalSession.ts` imports it.
- `export.ts` — `profileExportPages(store, { user, organizationId })`: an async generator of `[field, entries]` pages
  over every snapshot field, applying the re-homing rules (4.3).
- File header gains an optional `origin: 'hosted-export'` + `exportedAt` (D5). Top-level, not in `maps`: no format
  version bump, older builds ignore it, the fingerprint test is unaffected.

### 4.2 Port + implementations
`RecordsExportRepository` on `LedgerStore` (`recordsExport`):
- `page(organizationId, field, afterKey, limit)` → `{ entries: [key, record][], nextKey }` for every org-owned field
  (custs, projs, refs, rates, agrs, insts, charges, recs, supps, versions, files, pays, allocs, credits, counters,
  props, exps, expCats, expReceipts, convs, expGroups, groupMarks); keys exactly as `MemoryLedgerStore` keys them
  (`id`; `org:year` for counters; `group:expense` for groupMarks).
- `inboxPage(userId, afterKey, limit)` — the inbox is the person's, not a profile's.
- Memory: filter the maps by `organizationId`, sort by key. Prisma: `findMany({ where: { organizationId }, orderBy: id,
  cursor, take })` per model, each mapped through the same row→record shape the repository's other reads return.
- Store guard: `sessionOnly` (no API key has a person to export for).

### 4.3 Re-homing (what changes between hosted and local)
- `people`: exactly one row, the exporter, with `email = LOCAL_PERSON_EMAIL`, `passwordHash: null`, `failedSignIns 0`,
  `lockedUntil/lastSignInAt null`, status ACTIVE. No other person's email ever leaves (privacy).
- `members`: the exporter's membership in each exported profile, nothing else.
- `orgs`: as stored, except a profile the exporter belongs to but doesn't own (a firm) becomes theirs locally
  (`ownerUserId = exporter`, `profileType = BUSINESS`): local mode's rule is that the local person owns every local
  profile (ADR-097 §2.2), and writes are gated on ownership.
- `ints`: always empty. Integration rows hold Malafat credentials; without one the profile's writer of record is
  null locally, so Malafat-fed income arrives as the person's own records (D4, "an export, not a backup").
- `refs` kept (opaque Malafat ids, no secrets). Audit log, API keys, sessions, idempotency: never (not in the format).
- Other users' ids on rows (e.g. `createdByUserId`) stay as opaque UUIDs.

### 4.4 Routes (`server/src/routes/records-export.ts`, session only, profile-scoped by the existing header)
- `GET /v1/records-export` — one profile's records file (`application/json`, gzip when accepted), streamed with
  Hono's `stream()`, 500 rows per query. Audits `records.exported` (actor USER, entity `organization`) before the
  first byte, metadata `{ formatVersion }`. Header `X-Mutaba3a-Export-Files` = READY file count (for the progress total).
- `GET /v1/records-export/files/{kind}/{id}` — `kind ∈ receipt|attachment`; the READY, undeleted row of this profile;
  streams `AttachmentStorage.read(key)` (new method: GCS `createReadStream`, memory double; local storage throws —
  the routes are not in `PORTAL_ROUTES`, local mode never serves them). 404 for anything else.
- Registered in `createApp` only; `portal-routes-coverage` gets an explicit signed-in-only allowlist.
- OpenAPI regenerated (`openapi:check`); API version bump `-mut325`.

## 5. Portal

- `src/hosted/data/recordsExport.ts` — `exportHostedRecords({ profileIds, signal, onProgress })`: per profile fetch +
  `decodeRecordsFile` (also validates before anything is saved), union the maps, fetch each `backedUpKeys` file
  (4 at a time, size checked against its record), `encodeRecordsFile` with the origin header, `zipRecordsArchive`.
  Returns `{ blob, missingFiles }`. A file that fails twice is left out and counted, as Restore already reports.
- Restore + Download include READY attachments (`files` map) beside receipts (D3): `backedUpKeys`,
  `decodeRecordsArchive`'s file list, still under `receipts/<storageKey>` (keys never collide: different prefixes).
- `HostedYourDataDrawer` (signed in): checklist of the person's profiles (all ticked), a note that this is a copy to keep
  or open signed out — not a backup, it can't be restored into the account — then Download; while running a
  progress bar (`role=progressbar`, "Profile 1 of 2", "Receipt 37 of 200") and Cancel; after, a toast, plus the
  missing-files line when any. `AccountDrawers` renders it when signed in; `UserMenu` gets "Your data" signed in.
- Local Restore confirm says "Exported from your account on {date}" when the file carries the origin header.
- i18n EN + AR (`hosted.yourData.*`), plurals through `useTp`, RTL via logical properties; numbers in `<bdi>`.

## 6. Tests (TDD, written first)

- Server unit: codec round-trip + streaming writer emits JSON equal to `encodeRecordsFile`; re-homing rules (one
  person, no foreign emails, ints empty, firm owned, members only exporter); route auth (no profile header → 400,
  non-member profile → 404, API key → refused), audit row written, files route 404s other-profile/pending/deleted ids;
  paging: never asks the port for more than 500 rows.
- **Parity (AC1)** `src/hosted/local/__tests__/hosted-export-parity.test.ts`: seed through the hosted API (memory store)
  a personal + Malafat-fed firm profile with clients, projects, income received/owed, payments, expenses, groups,
  conversions, receipts (bytes), inbox; export with `exportHostedRecords`; restore into a fresh local backend;
  compare every portal read (lists, summaries, entries, receipts bytes) hosted vs local, field for field, except the
  documented re-homing fields.
- Prisma parity (`test:db`): the Prisma `recordsExport` returns the same keys and record shapes as the memory one for
  the same API-seeded data.
- **Large (AC2)**: 10k entries + 200 receipts exports, progress monotonic to 200/200, Cancel mid-files aborts the
  in-flight fetches and saves nothing.
- Drawer component tests (EN/AR, progress, cancel, missing files). QA spec below.

## 7. QA scenarios (release-QA, `qa/features/portal/your-data.yaml`)

| id | steps (as the user says them) | promise |
|---|---|---|
| `download-signed-in` (core: no) | Signed in, open the account menu › Your data, keep both profiles ticked, Download | progress shows, a `mutaba3a-export-<date>.zip` downloads holding `records.json` (kind `mutaba3a-local-records`, origin `hosted-export`) and the receipt file |
| `download-cancel` | Start a download, press Cancel | progress stops, nothing is saved, Download is offered again |

Spec `qa/specs/portal/your-data.spec.ts`, routes stubbed with `page.route` like the other portal specs.

## 8. Impact, cost, risk
- Cost: one export ≈ 27 × ceil(rows/500) small queries + one GCS read per file; no new storage, no job.
- Tab memory holds the zip (receipts ≤ 10 MB each). TD: stream to disk (File System Access) if accounts outgrow it.
- Abuse: session rate limit applies per request; exports are audited.
- Infra: none (Cloud Run timeout unchanged; MUT-328 owns `main.tf`).
