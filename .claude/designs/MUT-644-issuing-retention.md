# MUT-644 — Keep issued documents 7 years after an account closes: the retention sweep and the owner's copy

Status: **Built 2026-11-25** under Basel's standing go-ahead (away; plan not separately approved). ADR-277. Server + portal copy + privacy copy + phone copy. Epic MUT-566.

## Problem

When an account closes, the account purge (MUT-333, ADR-188) deletes the profiles it owns with every record, but MUT-568 (ADR-260 decision 2) leaves the issuing tables behind: issued documents and the business details printed on them are legal records the business must keep. Nothing deletes them afterwards, and nobody can get a copy once the account is gone.

## Acceptance criteria (ticket)

1. A closed profile's documents survive the purge and are deleted by the sweep after the retention date (test with a clock).
2. The close-account screen tells the owner their issued documents are kept 7 years.
3. (Scope) An operator path to give a former owner their archive (PDFs + the uniform file, MUT-569).
4. (Scope) The privacy policy says this.

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Retention date:** a closed profile's issuing rows may be deleted from 1 January of the 8th year after the calendar year of its newest document, i.e. 7 full years after the end of that tax year. "Newest" is the latest `documentDate` of its issued documents and the Israel date of its latest payment-request cancellation. One constant, `ISSUING_RETENTION_YEARS = 7` (`server/src/issuing/retention.ts`). The year boundary is taken in UTC: UTC midnight on 1 January is 02:00 in Israel, so the sweep is never early. | The ticket's decision. Israeli bookkeeping rules count 7 years from the end of the tax year. **Open for the lawyer** (start date). |
| D2 | **"Closed" = the profile row is gone.** A profile id that still holds issuing rows but has no `organizations` row (deleted by the account purge, or a declined signup's profile). A live profile is never swept, however old its documents. | The purge deletes the profile row and leaves the issuing rows, which hold no foreign keys (ADR-260). No new column needed. |
| D3 | **Runs inside the hourly account purge** (`runAccountPurge`), after the share-link viewer sweep, like that sweep (MUT-382): at most 25 profiles a run, a failure logged and never stopping the purge, nothing in a dry run. The purge summary gains `issuingProfilesSwept`. The operator can also run or dry-run it alone: `POST /admin/v1/issuing/retention/sweep { dryRun }`. | No new Cloud Scheduler job or Terraform. 25 a run is the purge's own cap (D11). |
| D4 | **One transaction per profile**, through the trigger's sanctioned bypass (`SET LOCAL mutaba3a.issuing_bypass = 'on'`): re-checks inside the transaction that the profile still doesn't exist and is still due, deletes from the 9 retained tables (`RETAINED_ISSUING_TABLES` in `prisma-purge-tables.ts`, pinned against `PURGE_PROFILE_TABLES_EXEMPT`), and writes the audit row. | `SET LOCAL` lasts only for that transaction; a re-check makes a stale list harmless. |
| D5 | **Audit: a new table `issuing_retention_events`** (`organizationId`, `action` `SWEPT` or `ARCHIVE_EXPORTED`, `metadata` JSON, `createdAt`), no foreign keys, kept indefinitely. Metadata holds counts, dates and the operator's support reference, never a name or address. Exempt from the purge (`PURGE_PROFILE_TABLES_EXEMPT`). | `audit_events.organizationId` is a foreign key to `organizations`; the profile is already gone. A retention log needs to outlive the rows it records. |
| D6 | **The owner's copy is an operator path, not a self-service one.** `GET /admin/v1/issuing/retained?query=` finds closed profiles still held (by VAT number or name, with their document count, newest date and deletion date); `POST /admin/v1/issuing/retained/{organizationId}/archive { reference }` returns a zip: `originals/` each document's signed original as kept (MUT-641), `copies/` a freshly signed copy of every document never produced, and `uniform-file/OPENFRMT-….zip` the uniform file of all its documents (MUT-569, the same builder as the portal's download). A live profile is refused (409 `PROFILE_NOT_CLOSED`: its owners download their own). `npm run issuing:retained` wraps both. Each export writes `ARCHIVE_EXPORTED`. | After the purge there is no account to sign in to and no address on file we can trust: the operator checks who is asking (as for a two-step reset) and sends the zip over a channel they choose. **Not mailed by the server:** a mail never carries a money record (ADR-159 §5). |
| D7 | **Copy.** Close-account (portal and phone) "Kept" always says: "If you issued invoices or receipts with MTB3A, they and the business details printed on them are kept for 7 years after the end of the year of the last one, as tax law requires, and then deleted. Write to us if you need a copy." The privacy policy's deletion section says the same. | The close screen does not know which profiles issued documents (`/v1/me` carries no such fact), and the conditional sentence is true for everyone. |
| D8 | **Erasure requests do not shorten the 7 years.** A request to erase is answered with everything else deleted and the issued documents kept until their date (a legal obligation to keep records). **Open for the lawyer.** | The ticket's open question; recorded, not decided by code. |
| D9 | API 1.138.0-mut644 (the purge summary field and the admin routes). Migration `20261125120000_mut644_issuing_retention_events` (one new table, additive). | |

## Component diagram

```
Cloud Scheduler (hourly) ──► POST /jobs/v1/accounts/purge ──► runAccountPurge
                                                                 ├─ drainStorage, share-link viewers
                                                                 ├─ runIssuingRetentionSweep(now)      ◄── POST /admin/v1/issuing/retention/sweep
                                                                 │     store.issuingRetention.listClosed({ newestBefore })
                                                                 │     store.issuingRetention.sweep(id, newestBefore, at)  [one tx, bypass, SWEPT row]
                                                                 └─ the account purge itself (deletes profiles; issuing rows stay)

operator ──► GET  /admin/v1/issuing/retained?query=        store.issuingRetention.listClosed / getClosed
         └─► POST /admin/v1/issuing/retained/{id}/archive   store.issuing.inRange + originals + signed copies + buildUniformFile
                                                            store.issuingRetention.record(ARCHIVE_EXPORTED)
```

## Error states

- Archive: 404 `NOT_FOUND` (no issuing rows under that id), 409 `CONFLICT { reason: PROFILE_NOT_CLOSED }`, 503 `SIGNING_NOT_CONFIGURED` / `SIGNING_UNAVAILABLE` when a copy has to be signed and can't be, 422 for a missing reference.
- Sweep: a profile that fails is logged (`issuing retention sweep failed`) and the run goes on; the next run retries.

## Reuse

`buildUniformFile` / `uniformFileReport` / `uniformFileZip` (MUT-569), the PDF renderer and signer deps (`IssuedPdf`, MUT-640/641), `documentNumberLabel`, the purge's job + admin door pattern (MUT-333), `adminClient` in `scripts/users.ts`, fflate's `zipSync`.

## i18n

Portal `hosted.closeAccount.keepsIssued` (ar first, en); phone `closeAccountKeepsIssued` (ar formal, en); privacy `landing.privacyPolicy.mobileDeletion.body` (ar, en) and its updated date. The archive's report follows the uniform file's `lang` (Hebrew by default, the Tax Authority's language).

## Cost / infra

No new job or service. One small table. The sweep reads one aggregate query an hour.

## Impact

- Purge summary gains a field (additive). Portal types regenerated.
- A big business with many never-produced documents makes a slow archive (one signature each): TD-331. The archive is handed over by hand: TD-332.

## QA scenarios

- `portal.account.close-keeps-issued`: From You › Account choose Close my account → the drawer's Kept section says issued invoices and receipts are kept for 7 years and how to get a copy (English and Arabic).
- Server proof (vitest + test:db, not recorded): AC1 with a clock across both stores; the archive route's zip; the purge run calls the sweep.

## Test plan

- `issuing/__tests__/retention.test.ts`: `retentionEndsOn` / `sweepCutoff` (year boundaries, a cancellation newer than every document, null).
- `store-contract-issuing-retention.ts` (memory + Prisma): a business profile issues documents → its owner closes and is purged → the rows survive and the profile is listed as closed → `sweep` before the date refuses (`not_due`), after it deletes every retained row and writes `SWEPT` → a live profile is refused (`not_closed`); `record` writes `ARCHIVE_EXPORTED`.
- `accounts/__tests__/purge-run` (existing file): the run sweeps due profiles, not in a dry run, and a failing sweep never stops the purge.
- `routes-issuing-retention.test.ts`: list, archive zip contents (originals, copies, uniform file), 409 for a live profile, 404, the job/admin sweep route.
- `prisma-purge-tables` unit: `RETAINED_ISSUING_TABLES` equals the "kept 7 years" exemptions.
- Portal: `CloseAccountDrawer.test.tsx` shows the sentence. Privacy: `PrivacyPolicyPage.test.tsx`.
- Phone: `account_close_test.dart` shows the sentence.

## Open questions (lawyer, Basel)

1. Is the start date right: 7 years after the end of the tax year of the newest document (not of each document, not of the account's closing)?
2. Erasure requests vs the duty to keep records (D8).
3. Is the operator handing the zip over a channel of their choosing, after checking identity, acceptable, or should the server send a time-limited link?
