# MUT-314 — period download: test plan

TDD, server only. `npm --prefix server test`; the Prisma store contract and the Postgres data path under `test:db`.
The numbered groups are the plan's; each names where it lives.

| # | Group | Where |
|---|---|---|
| 1 | Range, pure: `YYYY-MM` parsing; inclusive month ends (Feb 28/29, 30/31); 24 months pass, 25 → PERIOD_RANGE; a future month, a reversed range; the profile's current month at 00:30 on the 1st in Jerusalem; `asOf` in the future, > 24 h back, not a timestamp → AS_OF; the file-name label (one month, a span, a whole-profile link) | `period-pack/__tests__/range.test.ts` |
| 2 | Boundaries end to end: the day before `from`, `from-01`, the last day of `to`, the day after (only the two inside); deleted expenses and undone payments never appear; a span of months; 422s at the mint | `__tests__/routes-period-downloads.test.ts` "2" |
| 3 | Ref stability: the same `asOf` gives the same Refs and file names in the report and the zip; a row logged after it, backdated to the first day, is in neither; without `asOf` the index's Row id still names each file | routes "3" |
| 4 | Money: ILS, USD, EUR `0.00`; JOD `0.000`; 9,999,999,999,999.99 exact; the Summary per currency, never summed | routes "4" |
| 5 | XLSX: a zip of well-formed parts, inline strings only; read back with exceljs (devDependency): numbers and formats, dates, Arabic, Hebrew, emoji; `=1+1` stays text; control characters stripped; RTL only for `ar`; frozen header and autofilter; datetime in the profile's zone. End to end: Arabic sheet names and headers, English for an English person, both sheets with no income | `period-pack/__tests__/xlsx.test.ts`; routes "5" |
| 6 | Receipts zip ↔ report (AC2): every READY receipt of an in-range expense under its Ref, the report's "Receipt files" the same names, MIME-type extensions; out-of-range, deleted and To-review receipts absent; a missing bucket object → `missing`, the rest whole, one error logged | routes "6 + 7" |
| 7 | index.csv: BOM first, CRLF, RFC 4180 quoting, the formula guard on text and never on amounts, headers in the download's language | `period-pack/__tests__/csv.test.ts`; routes "6 + 7" |
| 8 | Access: owner, co-owner, firm member 200; an accountant with an ACTIVE grant 200 through the derived allowlist (no list edit), revoked / another profile / none 404; a stranger 404; LOCKED_OPEN; never lazy-posts (the records export posts the same due item) | routes "8"; `accountant-route-matrix.test.ts` |
| 9 | Ticket: tampered, wrong signature, another pepper, wrong shape, expired (120 s) → null / uniform 404; the ticket's type decides the file; a grant or membership removed between mint and stream → 404; a form post works; no ticket or token in any path or query | `period-pack/__tests__/ticket.test.ts`; routes "9" |
| 10 | Link: both downloads hold only the link's period and profile; without its viewer token, another viewer's, or after a revoke → 404; `SHARE_LINKS` or `PERIOD_DOWNLOADS` off → 404 | routes "10" |
| 11 | Caps and estimates: rows and bytes; over 2 rows → 422 PERIOD_TOO_LARGE `report`, over 10 bytes → `receipts` while the report still mints; the instance's slots full → 429 Retry-After 15, a finished stream frees its slot; the mint budget → 429 | routes "11"; store contract |
| 12 | Streaming and MUT-501: `pullStream` (no enqueue after a cancel, a pull in flight swallowed, a source throwing while stopping, one error log for a real failure, `onSettled` once); a cancel mid-receipt cancels the bucket read, logs no error, frees the slot; a cancel after the last receipt; a storage error after the first bytes errors the stream and logs once; the records export's cancel logs no error | `http/__tests__/pull-stream.test.ts`; routes "12"; `routes-records-export.test.ts` |
| 13 | Read-only: `periodDownloadStoreGuard` refuses writes and the audit append for every kind, lets reads and the feed through; one `period.downloaded` row with no token, IP or row content; a link's row names the link | routes "13" |
| 14 | Performance (AC4): a 1,000-row month (600 expenses, 400 income) sent in < 10 s; 600 × 50 kB receipts start and finish in < 10 s (memory); on Postgres the data path collects 1,000 rows and 600 receipts in < 3 s and ≤ 20 queries | routes "14"; `period-downloads-prisma.test.ts` |
| 15 | Headers: the XLSX type with Content-Length; `application/zip` without; `filename*` for an Arabic profile name; nosniff, no-store, noindex, no Content-Encoding even with `Accept-Encoding: gzip` | routes "15" |

Store contract `repositories/__tests__/store-contract-period-pack.ts` (memory; Prisma under `test:db`): the estimate's
row rules and `asOf`, `listReadyByExpenseIds` (READY, live, this profile's, oldest first), `names` (own ids only).

Also updated: `routes.test.ts` and the other API version assertions (1.103.0-mut314), `route-security.test.ts` (the
mint session-only; the stream and the link mint public), `writability-routes.test.ts` (40 session reads),
`accountant-route-matrix.test.ts` (the mint in the derived allowlist), `routes-share-links.test.ts` (the link paths).

Review fixes (`routes-period-downloads.test.ts` "review fixes"): an accountant's ticket dies when the owner starts
closing; a link's report and index carry no "Logged by", ids or row ids (an owner's keep them); the row cap on the
zip counts expenses; the zip reads only expenses and vendor names; a reused ticket and one from a signed-out session
are the uniform 404. Store contract: `sessions.getById`.

[→E2E] Opening the report in Excel (Windows, Arabic) and Numbers, and the zip in iOS Files, belong to MUT-561..564's
recorded flows.
