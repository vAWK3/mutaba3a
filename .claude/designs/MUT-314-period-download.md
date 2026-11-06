# MUT-314 — Download a period: an Excel report and a receipts zip, for owner, accountant and share link (plan, rev 2)

Epic MUT-558. Repo: mini-crm (`server/`). Built on MUT-559 (local main 69436d7d, In Review) and **MUT-560 (being built on `feat/mut-560-share-links`; must merge first)**.
Claims (renumbered at build): **ADR-248**, **API 1.102.0-mut560 → 1.103.0-mut314**, **no migration** (MUT-557 holds 246/1.101.0, MUT-560 247/1.102.0, MUT-575 249/1.104.0).
Tracker: Jira · barmajiyat · MUT via atlassian-barmajiyat · Backlog → Planned (transition 2) by /eng-ticket; /eng-build → In Progress; finished → In Review.

**Rev 2 (2026-11-06)** folds in Basel's answers (MUT-314 comment 13235) and the UI decisions (epic comment 13236: AP3, SL3, AW3):
- **Two separate downloads instead of one zip:** an **Excel report** (one XLSX: Expenses, Income, Summary) and **Receipts (zip)** (receipt files named by Ref, plus a small index).
- The "include receipts" toggle is gone. The 500 MiB cap applies to the receipts zip. Each download has its own size estimate.
- The accountant portal's download follows the current filter (AW3), so the mint takes the filter's month range.
- Ranges stay whole calendar months, at most 24, no future months; a link uses its own period.
- Kept: mint → ticket → stream, and the shared quiet-cancel stream helper.

## Build notes (2026-11-06, `feat/mut-314-period-download`)

Built to rev 2. Where the code asked for a choice, the one closest to the plan's intent:
1. **Numbering:** ADR-248 and contract 1.103.0-mut314 (the plan's 247/1.102.0 went to MUT-560); merged after MUT-575 and MUT-557, the contract carries 1.106.0-mut557 (the higher version wins).
2. **The stream's guard** is `periodDownloadStoreGuard(kind)` (`auth/store-guard.ts`), not `accountantStoreGuard`: the
   rows come from `entries.list`, classed `sessionOnly`, which the accountant guard refuses. It is the same
   `readOnlyStoreGuard` with `entries.list` named (as MUT-560 names it for links); a link's stream keeps
   `shareLinkStoreGuard`. Every write is still 403 READ_ONLY_PROFILE for every kind.
3. **The audit row** goes through the base store handed to the routes (as the link routes' `linkStore`), not a new
   `unguarded()` call site.
4. **Name lookups** are one batched port method, `periodPack.names(org, {customers, projects, vendors, users})` (one
   query per kind asked for), beside `periodPack.estimate`: "one query each per download" with no N+1.
5. **Income** holds POSTED received payments: a capture undo and a correction's reversal are both left out, of the
   sheet and the estimate alike (as the link's summary leaves reversed payments out).
6. **A receipt that fails after its first bytes** went out can't be taken back: the stream errors (no central
   directory). Before its first byte (null, a throw, 30 s idle) it is skipped and listed `missing`.
7. **Receipts uploaded after `asOf`** are left out too, so both downloads name the same files.
8. **A whole-profile link** has no `from`: its files are `…-to_YYYY-MM…`, and the Summary's From reads "First record".
9. **Source** reads MTB3A or Malafat (Arabic: متابعة, ملفات), since English is always "MTB3A" (ADR-173); file names keep
   `mutaba3a-` (D24).
10. **Content-Disposition** carries an ASCII fallback that drops what it can't spell, plus the UTF-8 `filename*`.
11. **The stream re-check** refuses a person who is closing their account (any closure), as `finishSessionAuth` does.
12. **The stream body** is validated per content type (JSON or form) and parsed once; a missing ticket is 422.
13. **The language:** the mint's `lang`, else the person's locale; a link's, else Accept-Language (Arabic default).
14. The ticket's HMAC is domain-separated (`period-download:<payload>`) from every other use of the session pepper.
15. **Operator step (not applied):** `server/infrastructure/terraform/main.tf` sets the API's `timeout = "900s"`; it
    takes effect on the next `terraform apply`.
16. **Review fixes:** see ADR-248 decision 11 (closing owner in `clientAccess`, a link's files without ids or
    "Logged by", the row cap on the zip, tickets bound to their session and single use).

## Status and blockers
- The ticket is in Backlog. Basel answered the plan questions (13235). Where the buttons go is settled by the wireframes (13236): this ticket is server-only.
- The formal blockers MUT-312 (month close) and MUT-313 (VAT summary) are in Backlog, and bills don't exist in the schema yet. They block only the **firm-only extras**, which are deferred (D12). Recommended: move the 312/313 "blocks" links to a follow-up, "Firm extras in the period report".
- MUT-560 is a hard build dependency: its `shareLinkAccess`, the `SHARE_LINKS` flag table and the link routes file. MUT-559 is merged.
- MUT-501 (the records export logs an error when a download is cancelled) is fixed here, because both routes share one cancel-safe stream helper (D9).

## Core decision: the server builds both files and streams them, in two steps (shape A)

**Shape A (chosen): the server builds each download.**
- One module, `src/period-pack/`, turns (profile, month range, language, asOf) into rows. From those rows it writes either:
  - the **report** (`.xlsx`), or
  - the **receipts zip**, with each receipt streamed from the bucket and `index.csv` written last.
- Nothing is stored on the server.
- **Two steps per download:**
  1. A **mint**, authenticated the caller's usual way, returns a short-lived signed **ticket** for one download type, plus that download's size estimate.
  2. A **stream** route takes the ticket in a POST body and sends the file as an attachment.
- The portal submits a hidden form, so the browser's own downloader writes to disk. The phone `dio.download`s straight to a file. No token goes in any URL.
- Three callers, three thin mints, one stream route, one row collector, two writers.

**Shape B (rejected): each client builds the files from API data.**
- The portal (owner, accountant and link pages share one TypeScript module) and the phone (Dart) would each need an XLSX writer, the column list, Arabic headers, money formatting, Ref numbering and receipt naming. That is red flag 8 (hand-synced column lists) and red flag 6 (two ways to export).
- The phone has no zip or XLSX package. The portal's jszip builds the whole zip in memory, which fails on large receipt sets.
- Network cost is the same either way (about $0.12/GB).

**Depth:** shape A hides period rules, access re-checks, money formatting, localisation, XLSX encoding, Ref numbering, receipt naming, caps and streaming behind a mint and `POST …/stream`.

```
 owner/co-owner ─┐  GET /v1/period-downloads/ticket?type=report|receipts&from=YYYY-MM&to=YYYY-MM&lang&asOf
 accountant ─────┤      (session or device bearer + X-Mutaba3a-Profile; accountant admitted by MUT-559's derived allowlist)
                 │
 link visitor ───┤  POST /v1/share-links/download-ticket {viewerToken, type, lang, asOf?}  → shareLinkAccess()
                 │
                 ▼  200 {type, ticket, expiresAt, filename, estimate}
   client ──────►  POST /v1/period-downloads/stream  (form or JSON body: ticket [+ viewerToken for links])
                    verify HMAC + exp → re-check access → collect rows (same order, same asOf) →
                    type=report:   build period.xlsx in memory → send (Content-Length)
                    type=receipts: stream receipts/<Ref>-<n>.<ext> one at a time → index.csv → central directory
```

## Data
No schema change, no migration, no new storage.
- **Rows:** `store.entries.list([orgId], {order:'occurredOn', occurredFrom, occurredBefore})`, paged at 200. This is the `/v1/entries` feed with its live-row rules, so "an expense" and "a received payment" mean exactly what Recent shows. Rows with `createdAt > asOf` are dropped (see Ref stability).
- **Lookups** (one query each per download):
  - categories via `displayCategoryNames(rows, lang)` (MUT-464);
  - customers;
  - projects;
  - vendors: the canonical name when the expense has a `vendorId`, otherwise the typed vendor.
- **Receipts:** a new batched port method, `expenseReceipts.listReadyByExpenseIds(orgId, expenseIds)`.
  - One query per page. It returns READY, not-deleted receipts with `id, expenseId, mimeType, sizeBytes, storageKey, createdAt`.
  - Implemented in the memory and Prisma stores, with a STORE_ACCESS `read` row.
  - The report needs only the metadata (names and counts). The zip also reads the bytes with `storage.read(key)`, which returns a stream.
- **Estimates:** a new port method, `periodPack.estimate(orgId, from, to, asOf)`. Indexed aggregates only:
  - report: `{expenses, income}`;
  - receipts: `{receipts, receiptBytes}`, receipts joined to in-range live expenses, `sum(sizeBytes)`.
- **Ticket** (stateless): base64url JSON, then `.`, then `sessionDigest(pepper, payload)`.
  - Payload: `{v:1, type:'report'|'receipts', kind:'member'|'accountant'|'link', org, sub (userId | viewerId), from, to, asOf, lang, exp, n}`.
  - `sessionDigest` is HMAC-SHA256 with the session pepper. Verified with `timingSafeEqual`. TTL 120 s.

### Range (`src/period-pack/range.ts`, pure)
- **Owner and accountant:** `from` and `to` as `YYYY-MM`, inclusive whole months.
  - `to ≥ from`, a span of at most 24 months, and `to` no later than the current month in the profile timezone (`todayFor`).
  - Days run from the 1st of `from` to the last day of `to`; `occurredBefore` is the first day after.
  - The accountant portal's filter months are passed as-is (AW3).
  - The filter's type (expense or income) does not change the report: it always holds both sheets (D21).
- **Link:** the range comes only from `shareLinkAccess(viewerToken).range`; the caller can't pass one.
- **Money dates:** an expense's `occurredOn`, a payment's `receivedOn`.

### Ref stability across the two downloads (D22)
- Refs (`E0001`…, `I0001`…) number rows oldest first within the range, by money date, then `createdAt`, then `id`. Both downloads must give the same row the same Ref, so receipts match report rows.
- Each mint takes an optional `asOf` (an ISO timestamp, no later than now and at most 24 h back; default now), and the ticket pins it. Rows logged after `asOf` are left out of both downloads.
- A client passes the same `asOf` to both mints from one screen: the moment it showed the period. An entry added in between then can't shift the numbering.
- What can still drift: a row deleted, or moved to another date, between the two downloads. It is rare, and the zip's `index.csv` carries each file's row Id, date and amount, so the zip stands on its own.

## Access
| Caller | Mint | Re-check at stream |
|---|---|---|
| Owner / co-owner / member | Session or device bearer with `X-Mutaba3a-Profile`. The route is tagged `requireScope('expenses:read','payments:read','attachments:read')`. | `resolveProfileAccess(store, userId, orgId)`: the membership still exists and the user isn't closing their account. |
| Accountant | The same route. MUT-559 D1 derives the allowlist from those tags, so no list edit is needed. The mint is a GET, so it passes the method gate. | The same function: the ACTIVE grant still exists. |
| Link visitor | `POST /v1/share-links/download-ticket {viewerToken, type}` → `shareLinkAccess`. Answers are MUT-560's uniform 404 or 401 SHARE_VIEW_EXPIRED. | The stream body also carries `viewerToken`. `shareLinkAccess` runs again, and its viewer id and range must equal the ticket's. |

- **`resolveProfileAccess`** is extracted from `selectProfile` (auth/middleware.ts:399–434: `namedMembership` and `namedClient`, minus the header read). Every request and the stream re-check share it.
- **Read-only:** the stream sets `accountantStoreGuard()` for every kind. The audit row goes through `unguarded(store)`.
- **Plan lapse:** the mint joins `LOCKED_OPEN_ENDPOINTS` (billing/gate.ts:25) beside the records export. The stream and link routes are public, outside the gate.
- **Never lazy-posts:** a download is a read, whoever asks.
- **Flag:** a third row in MUT-560's flag table, `PERIOD_DOWNLOADS` (env; default false in prod, true in dev and QA). The link mint needs both `SHARE_LINKS` and `PERIOD_DOWNLOADS`. When off, the routes answer 404 before authentication.
- **Limits:**
  - 30 mints per subject per hour.
  - A per-instance semaphore of 3 concurrent streams (429 RATE_LIMITED with Retry-After 15). Report streams take a slot too, but finish in under a second.
  - Report: `PERIOD_PACK_MAX_ROWS` 20,000.
  - Receipts zip: `PERIOD_PACK_MAX_RECEIPT_BYTES` 500 MiB.
  - Both caps are checked at mint from the estimate. Over a cap: 422 VALIDATION_FAILED, reason `PERIOD_TOO_LARGE`, with `{type, limit, estimate}`. The client tells the person to pick a shorter period (13235).

## Routes (new `src/routes/period-downloads.ts`; the link mint goes in MUT-560's `src/routes/share-links.ts`; OpenAPI regenerated)
| Method | Path | Auth | Result |
|---|---|---|---|
| GET | `/v1/period-downloads/ticket?type=report\|receipts&from=YYYY-MM&to=YYYY-MM&lang=ar\|en&asOf=` | session or device bearer, profile header | 200 `{type, ticket, expiresAt, filename, estimate}`. 422 for the range, `asOf` or size. 404 for the profile. 429. |
| POST | `/v1/share-links/download-ticket` `{viewerToken, type, lang?, asOf?}` | public (viewer token) | The same body; the range comes from the link. MUT-560's 404 and 401. |
| POST | `/v1/period-downloads/stream` (`application/json` or `application/x-www-form-urlencoded`: `ticket`, `viewerToken?`) | public (ticket) | See the response headers below. 404 (uniform) for a bad, expired or no-longer-authorised ticket. 429 when the instance is full. |

Stream response headers:
- **report:** `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` with `Content-Length`;
- **receipts:** `application/zip`, chunked, no `Content-Length`;
- **both:** `Content-Disposition: attachment; filename*=UTF-8''…`, `X-Content-Type-Options: nosniff`, no gzip.

Other route rules:
- Tokens travel in bodies only: no ticket or viewer token in any path or query (MUT-559 D3, extended).
- A form POST to the stream needs no cookie, so there is no CSRF surface.
- Audit row `period.downloaded` at stream start: `{type, kind, from, to, rows, receiptFiles?, shareLinkId?}`. No token, no IP.

## File formats

### 1. Excel report: `mutaba3a-<profile>-<YYYY-MM>[_<YYYY-MM>].xlsx`
- **Sheets:** Expenses, Income, Summary. Headers are in the downloader's language (`lang`: the app language on the phone and portal; a link page can pass its own). An Arabic download gets `<sheetView rightToLeft="1">`.
- **Expenses** (oldest first): Ref, Date, Vendor, Description, Category, Client, Project, Currency, Amount, Net, VAT, VAT rate %, VAT treatment, Notes, Receipts (count), Receipt files (`E0001-1.pdf; E0001-2.jpg`), Logged by, Logged at, Id.
- **Income** (received payments, oldest first): Ref, Date received, Client, Project, Currency, Amount, Method, Reference, Receipt number, Notes, Source (Mutaba3a / Malafat), Logged by, Logged at, Id.
- **Summary:** profile name, period from and to, generated at (profile timezone), and per currency: expense count, gross, net, VAT; income count and total. Never summed across currencies.
- **"Receipt files"** comes from receipt metadata (the same naming function the zip uses), so it names the files the receipts zip will hold.
- **Encoding:** our own minimal SpreadsheetML writer (`xlsx.ts`, about 200 lines), zipped with `fflate.zipSync`.
  - Parts: `[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, and `xl/styles.xml` (bold header, money formats `0.00`/`0.000` by currency exponent, a `yyyy-mm-dd` date style).
  - One `xl/worksheets/sheetN.xml` per sheet.
  - Text is written as `inlineStr`: no shared-strings table, and inline strings are never formulas (D17).
  - Amounts are numeric cells via `formatMoney` (money.ts:86, bigint-exact). Dates are serial numbers.
  - XML is escaped, and XML-illegal control characters are stripped.
  - The header row is frozen, with an autofilter and column widths from the spec.
- **Size:** built in memory. 20,000 rows ≈ 10 MB of XML, a few MB zipped.

### 2. Receipts (zip): `mutaba3a-<profile>-<YYYY-MM>[_<YYYY-MM>]-receipts.zip`
- `receipts/<Ref>-<n>.<ext>` uses STORE (the files are already compressed). They are streamed from the bucket one at a time in Ref order. `n` follows the receipt's `createdAt` within its row. `<ext>` comes from the MIME type (`pdf`, `jpg`, `png`, `heic`…), never from the uploader's file name (D19).
- **`index.csv`** is written **last** (DEFLATE), so its Status column is exact. One line per receipt:
  - columns: File, Ref, Date, Vendor, Currency, Amount, Status (`ok` / `missing`), Row id;
  - headers in the download's language;
  - UTF-8 BOM, RFC 4180, CRLF, and a formula-injection guard on text cells (D17).
- A receipt that can't be read is listed as `missing`; the rest of the zip is whole.
- UTF-8 entry names (general-purpose flag bit 11). No ZIP64: the 500 MiB cap keeps every zip far below 4 GiB.
- **Zip library:** add `fflate` 0.8.x to `server/package.json`. It is MIT, has zero dependencies, is about 30 kB, and supports streaming `Zip` with `ZipPassThrough` and `ZipDeflate`, data descriptors and UTF-8 names. The report uses its `zipSync`.

### CSV (D23)
- The report is XLSX only; there are no `expenses.csv` or `income.csv` downloads. Basel's 13236 replaced the CSV + XLSX pack with an "Excel report", and no consumer needs the CSVs: no import path and no test reads them.
- The one CSV is the zip's `index.csv`, written with `csv.ts`. The ticket's AC wording ("CSV + XLSX", "UTF-8 BOM for CSV") should be updated to match. The BOM rule still holds for `index.csv`.

## Streaming (`src/period-pack/stream.ts` + shared `src/http/pull-stream.ts`)
- **`pullStream(source, {onError, onCancel})`** replaces `streamOf` in `records-export.ts`.
  - `cancel()` sets a `cancelled` flag, and `pull` never enqueues after it.
  - An error thrown after a cancel is swallowed and logged at `info` ("download cancelled").
  - A real failure before a cancel is still logged with `logger.error`, and the stream ends with `controller.error` (MUT-501 AC1–3).
  - Used by the records export and the receipts zip. The report is a single buffer and needs no pull loop.
- **Receipts zip, one receipt at a time:** `pull` passes one fflate `ondata` chunk at a time to the controller, so memory holds at most one bucket read chunk (≤ 1 MiB) plus fflate's buffer. On cancel: `reader.cancel()` on the current bucket stream, then `zip.terminate()`.
- **Failures:**
  - A receipt read that returns null, throws, or sits idle for 30 s: the file is skipped and listed `missing` in `index.csv`, and `logger.error` fires once per zip with the count.
  - A database failure while collecting rows comes before the first byte, so the client gets a normal 5xx JSON.
  - A failure after streaming started: `controller.error`. The central directory is never written, so the client sees a broken download, not a zip that looks whole.
- **Cloud Run:** the API service's request timeout goes from the default 300 s to **900 s** (`server/infrastructure/terraform/main.tf`, `timeout = "900s"`). 500 MiB at 0.6 MB/s (about 5 Mbit/s) fits.
- **Memory:** the 512 MiB limit stays.
  - Per receipts stream: the rows plus one chunk.
  - Per report: rows (~20 MB) plus XML (~10 MB) at the cap.
  - 3 streams together stay around 100 MB.

## Telemetry
- The API has no PostHog client. Each client sends `period_downloaded` after the mint returns 200, through its own telemetry gate (MUT-561..564).
  - Properties: `surface` (`portal_owner`, `portal_accountant`, `link_page`, `phone_owner`, `phone_accountant`), `type` (`report` / `receipts`), `kind`, `months`, and a row-count bucket.
  - No ticket, token or profile id goes in the event.
- The server's own record is the `period.downloaded` audit row.

## Split (D1)
This ticket is **server only**: the mint routes, the stream route, the row collector, the XLSX and zip writers, the MUT-501 fix and the terraform timeout. Where the buttons go is settled by Basel's wireframe picks (13236):
- MUT-562: the accountant portal's "Client books" desk (layout C, downloads follow the filter, AW3), and the link page's two downloads, Excel report and Receipts (zip) (SL3).
- MUT-564: the accountant phone's "Client books" tab, Excel for the report and a zip for receipts (AP3), through the share sheet (`share_plus`, a new dependency there).
- MUT-561 and MUT-563: the owner's downloads, wherever the wireframes put them.

MUT-314's ACs "Release-QA spec on web and phone" and "`period_downloaded`" move with the buttons.

## Files
- **New:**
  - `src/period-pack/range.ts` (months and `asOf`, pure);
  - `columns.ts` (sheet and column spec with en/ar headers, plus the index columns);
  - `rows.ts` (collects rows, lookups and receipt metadata for a range; assigns Refs and file names);
  - `xlsx.ts`, `csv.ts` (index only), `ticket.ts` (mint and verify);
  - `access.ts` (ticket → access re-check per kind);
  - `receipts-zip.ts` (zip assembly);
  - `index.ts` (`mintTicket`, `verifyTicket`, `estimate`, `buildReport`, `streamReceipts`);
  - `src/http/pull-stream.ts`;
  - `src/routes/period-downloads.ts`.
- **Changed:**
  - `src/routes/records-export.ts`: `streamOf` → `pullStream` (MUT-501).
  - `src/routes/share-links.ts` (MUT-560): `POST /v1/share-links/download-ticket`.
  - `src/auth/middleware.ts`: extract `resolveProfileAccess` from `selectProfile`.
  - `src/repositories/ports.ts`, `memory.ts`, `prisma.ts`: `expenseReceipts.listReadyByExpenseIds` and `periodPack.estimate`. `src/auth/store-guard.ts`: STORE_ACCESS rows (`read`).
  - `src/billing/gate.ts`: `LOCKED_OPEN_ENDPOINTS`.
  - `src/app.ts`: registration, the flag-table row, `API_VERSION` `1.102.0-mut314`.
  - `src/config.ts`: `PERIOD_DOWNLOADS`, `PERIOD_PACK_MAX_ROWS`, `PERIOD_PACK_MAX_RECEIPT_BYTES`, `PERIOD_PACK_CONCURRENCY`.
  - `src/schemas.ts`.
  - `server/package.json` and the lock file: `fflate`.
  - `server/infrastructure/terraform/main.tf`: the API service's `timeout = "900s"` (applied on the next deploy).
  - OpenAPI (`npm run openapi:generate`) and `npm run hosted:types`.
- **Docs:** ADR-247 in `.claude/DECISIONS.md`: server-built downloads, ticket download, two download types with a shared `asOf`, index written last, caps. This brief goes on the build branch as `.claude/designs/MUT-314-period-download.md`, and its test plan as `.claude/designs/MUT-314-period-download-tests.md`.

## Tests (TDD; `npm --prefix server test`, `test:db` for the Prisma methods)
1. **Range (pure):** `YYYY-MM` parsing; inclusive month ends (Feb 28/29, 30/31); a 24-month span passes, 25 → 422; a future `to` → 422; the profile timezone at a month boundary; `asOf` in the future or more than 24 h back → 422.
2. **Boundaries end to end:** entries on the last day before `from`, on `from-01`, on the last day of `to`, and on the day after. Only the two inside appear. Deleted expenses and undone payments never appear.
3. **Ref stability:** the report and the zip minted with the same `asOf` give identical Refs and file names. An entry logged after `asOf` (even when backdated into the range) is in neither. Without a shared `asOf`, the index's Row id still identifies each file.
4. **Money:** ILS, USD and EUR as `12.50`, JOD as `12.500`, large amounts exact (bigint); the Summary never sums across currencies.
5. **XLSX:**
   - the file opens as a zip, and each part is well-formed XML;
   - parsed back by a test-only reader (an `exceljs` devDependency), it gives the expected cells: numeric amounts with the right format, date cells, Arabic, Hebrew and emoji text intact;
   - `rightToLeft="1"` only for `ar`; headers in the right language;
   - a cell like `=1+1` stays text; control characters are stripped;
   - the report holds both sheets whatever the client's type filter.
6. **Receipts zip ↔ report (AC2):**
   - every READY receipt of an in-range expense is in the zip under its row's Ref, and the report's "Receipt files" names the same files;
   - every file in `receipts/` has exactly one line in `index.csv`;
   - receipts of out-of-range or deleted expenses, and To-review receipts (no expense), are absent;
   - a missing bucket object → `index.csv` says `missing`, the rest of the zip is whole, and one error is logged.
7. **index.csv:** the BOM comes first; quoting and CRLF; formula guard on text, not on amounts; headers in the download's language.
8. **Access matrix:**
   - owner, co-owner and member get 200;
   - an accountant with an ACTIVE grant gets 200 through the derived allowlist, with no list edit;
   - a revoked grant, another profile, or no grant gets 404;
   - a LOCKED or lapsed owner still gets 200;
   - a download never lazy-posts.
9. **Ticket:**
   - a tampered payload, wrong signature, expired ticket (fake clock), or another kind's subject → uniform 404;
   - the type in the ticket decides the response;
   - access revoked between mint and stream (grant, membership, link) → 404;
   - a link ticket with another viewer's token → 404;
   - OpenAPI has no ticket or token in any path or query.
10. **Link:** both downloads hold only the link's range and only that profile; with `SHARE_LINKS` or `PERIOD_DOWNLOADS` off → 404.
11. **Caps and estimates:**
    - the report estimate counts rows; the receipts estimate sums bytes;
    - a report over 20,000 rows → 422 PERIOD_TOO_LARGE (`type: report`);
    - receipts over 500 MiB → 422 (`type: receipts`), while the report for the same range still mints;
    - a 4th concurrent stream → 429 with Retry-After;
    - the 31st mint in an hour → 429.
12. **Streaming and MUT-501:**
    - a cancel mid-receipt and a cancel during `index.csv` → no enqueue after the cancel, no error log, the bucket stream cancelled;
    - a storage error mid-zip → one error log;
    - the records export's cancel test (MUT-501 AC3) on the shared helper.
13. **Read-only:** inside the stream, a repository write throws 403, for every kind. The audit row is written through the base store, and its metadata has no token, IP or row content.
14. **Performance (AC4):**
    - a 1,000-row month (600 expenses, 400 income) in the memory store: the report mints and is fully sent in < 10 s on CI (expected < 1 s);
    - the receipts zip with 600 × 50 kB starts streaming in < 10 s (expected < 1 s) and finishes in < 10 s;
    - a `test:db` run of the data path (no bytes): < 3 s and ≤ 20 queries.
15. **Headers:** the XLSX MIME type with `Content-Length`; `application/zip` chunked; `Content-Disposition` with `filename*` for an Arabic profile name; `nosniff`; `Cache-Control: no-store`; `X-Robots-Tag: noindex`; no `Content-Encoding`.

No recorded release-QA flow here (server only, as for MUT-559 and MUT-560). Recorded web and phone flows come with MUT-561..564. Checks before merge, through the heavy queue: `typecheck`, `lint`, `openapi:check`, `test`, `test:db`.

## Scale and cost
- **Queries:** each mint runs 1–2 indexed aggregates. Each stream runs about 5 feed pages, 5 receipt batches and 4 lookups per 1,000 rows. No N+1. Two downloads read the rows twice (about 15 cheap queries); that's accepted, since the alternative is storing state.
- **CPU:** a 1,000-row XLSX takes tens of ms. A STORE zip only computes a CRC (about 1 GB/s).
- **Egress:** the report is a few hundred kB. The zip costs its receipts' bytes (~$0.12/GB; a 50 MB month ≈ $0.006). Reading the bucket from the same region is free.
- **Phone data:** each download's estimate is known before it starts. The report alone is small; the receipts are a separate, deliberate tap.
- No new infrastructure, no stored files, no cron. One terraform setting (the timeout).

## Out of scope
- Buttons, flows, the share sheet, progress UI, release-QA flows and `period_downloaded` events (MUT-561..564).
- Firm extras: bills, bill payments, receivables, the VAT summary, and "closed through {month}" marking. They come in a follow-up after MUT-312/313 and bills; the sheet list is open for them.
- Owed and conversions sheets (13235: not for now).
- Account-code mapping and package-specific formats (the ticket's out-of-scope).
- CSV versions of the report (D23).
- To-review receipts with no expense, Malafat documents, and the records file (MUT-325 is unchanged).
- Emailed, scheduled or resumable downloads (HTTP Range).

## Decisions (auto)
- **D1 Split:** MUT-314 is server-only. The buttons go to MUT-561..564, placed per the wireframe picks (13236).
- **D2 Shape A**, server-built downloads: one implementation for three clients; no XLSX or zip code on the phone; no whole zip held in browser memory.
- **D3 Two steps (mint, then stream), with a stateless signed ticket in a POST body:** native downloaders, an estimate before any bytes move, nothing in URLs, nothing stored.
- **D4 One stream route; one mint per caller kind; one ticket type per download type** (`report`, `receipts`).
- **D5 Access is checked again at stream time** (ticket TTL 120 s): a revoke between mint and stream still wins.
- **D6 The link stream body carries the viewer token** and calls `shareLinkAccess` again, which keeps MUT-560's single door.
- **D7 The mint is a GET tagged with `expenses/payments/attachments:read`,** so MUT-559's derived allowlist admits accountants.
- **D8 In the zip, `index.csv` comes last,** so each file's Status is exact. A missing receipt degrades one line, not the whole zip.
- **D9 MUT-501 is folded in:** one cancel-safe `pullStream` helper serves the records export and the receipts zip.
- **D10 `fflate` for zips** (the receipts zip streamed, the XLSX container with `zipSync`), plus our own minimal XLSX writer.
- **D11 Months only** (`YYYY-MM`, inclusive), a span of at most 24, never past the current month (13235). A link uses its own period.
- **D12 Firm extras are deferred.** A follow-up ticket takes the MUT-312/313 links.
- **D13 Caps:** the report at 20,000 rows; the receipts zip at 500 MiB; 3 streams per instance; 30 mints per subject per hour; Cloud Run timeout 900 s.
- **D14 A plan lapse never blocks a download** (LOCKED_OPEN).
- **D15 A download never lazy-posts.**
- **D16 A sibling flag, `PERIOD_DOWNLOADS`,** in MUT-560's flag table.
- **D17 Formula safety:** XLSX uses inline strings only, and `index.csv` text cells get the OWASP guard.
- **D18 Telemetry is sent by the clients after the mint, with `type`;** the server writes the audit row.
- **D19 A receipt's extension comes from its MIME type,** never from the uploader's file name.
- **D20 No migration:** tickets are stateless, and estimates are aggregates.
- **D21 The report always holds both sheets.** The client's filter sets only the months (AW3), not the expense or income type: an accountant files both, and one file shape keeps the phone, portal and link page identical.
- **D22 A shared `asOf`, pinned in each ticket,** keeps Refs identical across the two downloads. `index.csv` carries the Row id as a fallback.
- **D23 No CSV report:** the XLSX is the report, and the only CSV is the zip's `index.csv`. The ticket's AC wording should change from "CSV + XLSX" to "Excel report + receipts zip with a CSV index".
- **D24 Download names:** the report is `mutaba3a-<profile>-<YYYY-MM>[_<YYYY-MM>].xlsx`, Basel's zip pattern with `.xlsx`. The receipts zip is the same with a `-receipts` suffix, so the two don't collide in one folder.

## Questions for Basel
None that block the build. All earlier questions are answered (13235, 13236). For Basel to glance at:
- the `-receipts` suffix on the zip name (D24);
- `index.csv` as the zip's index file name and columns (File, Ref, Date, Vendor, Currency, Amount, Status, Row id).

## Review notes (plan-eng-review, auto-decided; re-run for rev 2)

**Architecture**
- Design-twice: shape A (server-built) vs shape B (client-built). A is still chosen. The split into two downloads adds a `type` to the ticket, not a new module boundary.
- New risk from the split: two downloads must agree on Refs. Fixed by sharing `asOf` (D22), with the Row id in `index.csv` as the fallback.
- Red flags:
  - (2) information leakage: Ref numbering and file naming live only in `rows.ts`, used by both writers. Column specs live only in `columns.ts`.
  - (4) pass-through: none.
  - (6) two ways: `streamOf` is replaced, and `resolveProfileAccess` is extracted, not copied.
  - (7) importable internals: `period-pack/index.ts` is the only export, and an eslint `no-restricted-imports` rule blocks deep imports.
  - (8) hand-synced lists: the report's "Receipt files" and the zip's names come from one function, and the accountant allowlist is derived.
  - None remain.
- Security: tokens in bodies only; HMAC with a timing-safe compare; TTL 120 s; uniform 404; the read-only guard for every kind; formula safety; extensions from the MIME type.

**Code quality**
- Reuses `entries.list`, `displayCategoryNames`, `formatMoney`, `todayFor`, `storage.read`, `sessionDigest`, the limiters, `accountantStoreGuard`, `unguarded`, `requireScope` with the derived allowlist, `LOCKED_OPEN_ENDPOINTS`, MUT-560's flag table and `shareLinkAccess`.
- Extractions: `pullStream` (2 callers) and `resolveProfileAccess` (2 callers).
- No new error code.

**Tests**
- Every branch maps to tests 1–15. Tests 3, 6, 9 and 12 are the regression net.
- [→E2E] Opening the report in Excel (Windows, Arabic) and Numbers, and the zip on iOS Files, belong to MUT-561..564's recorded flows.

**Performance**
- Indexed, paged reads; no N+1. The report is small and in memory, bounded by the row cap. The zip is streamed with bounded memory.
- The one large cost is receipt egress, which grows with the bytes and is the same in either shape.

**Failure modes**
| Path | Realistic failure | Handling | User sees |
|---|---|---|---|
| mint | range too large for one download | 422 PERIOD_TOO_LARGE with `type` | "pick a shorter period" (UI story) |
| stream start | grant revoked after the mint | 404 | "no longer available" |
| receipts zip | a bucket object is missing | `index.csv` line marked `missing`, error log | the zip opens; the index says missing |
| receipts zip | the client cancels | quiet stop, bucket read cancelled | nothing (MUT-501) |
| receipts zip | the instance restarts mid-download | stream cut, no central directory | a failed download; retry |
| receipts zip | a slow phone needs more than 900 s | Cloud Run cuts the request | a failed download; the estimate is shown beforehand |
| two downloads | an entry added between them | shared `asOf` leaves it out of both | consistent Refs |
| two downloads | a row deleted or re-dated between them | Row id in `index.csv` | a file whose Ref matches no row is still traceable |

No silent failure is left without a test.

**Outside voice:** unavailable (codex isn't installed), as for MUT-559 and MUT-560.

VERDICT: ENG CLEARED (auto-decided), rev 2. Ready for /eng-build MUT-314 once MUT-560 merges.

## Business / product impact
- The accountant, signed in or holding a link, gets a period's books as one Excel file, with the receipts as a separate zip that matches it row by row. This replaces WhatsApp screenshots and is the core payoff of the accountant epic (MUT-558).
- One server build serves the portal, the link page and the phone, so MUT-561..564 only add two buttons. It also closes MUT-501's noisy production error.
- Cost and risk are contained: no stored files, egress that grows only with receipt bytes, a dark-launch flag, and read-only access at the data layer.
