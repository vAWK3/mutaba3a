# MUT-557 — Israeli supplier invoices: read, keep and flag the allocation number (מספר הקצאה)

Status: PLAN (2026-11-06), decisions D1–D4 + D6 approved by Basel (Jira comment 13228).
Tracker: Jira · barmajiyat · MUT via atlassian-barmajiyat · Backlog → Planned → In Progress (eng-build) → In Review (qa-reconcile).
Repos: mini-crm (server + portal), mutaba3a-flutter (phone). Epic MUT-298. Relates MUT-490 (QR, sidecar half absorbed here), MUT-441, MUT-566/572/574 (v2 issuing).
Numbers at plan time: API 1.99.0-mut534 → 1.100.0-mut557; ADR-245; TD-306+; local snapshot 15 → 16. Re-check at branch time.

## Acceptance criteria (ticket)
1. A supplier invoice with a printed or QR allocation number is reviewed with the number filled in.
2. The user can type in or correct the number during review; an invalid format is refused with a clear message.
3. An ILS tax invoice above the threshold with no number shows the flag in review and in Recent.
4. The number appears in the API, the portal, the phone and the records export.

## Decisions
- D1 Column on the expense: `expenses.allocationNumber VARCHAR(9) NULL`. Normalize: strip spaces/dashes → exactly 9 digits, else 422 ALLOCATION_NUMBER_INVALID. null clears. No check digit.
- D2 Label-anchored read only: labels מספר הקצאה / מס' הקצאה / מס׳ הקצאה / Allocation No(.) / Allocation number / رقم التخصيص; the 9 digits on the label row or the next row. Never a bare 9-digit number (ח.פ/ע.מ collide with REGISTRATION_NUMBER). Rule confidence 0.9.
- D3 Not in SUGGESTION_FIELDS. Instead `isCompleteSuggestion` treats the read as incomplete when currency=ILS, vatMinor>0, net ≥ threshold(date) and allocationNumber absent → the server read runs for those only. SERVER_READER_GENERATION unchanged (no re-read of old receipts).
- D4 Flag computed by the server, never stored: `allocationNumberMissing` = Business profile && ILS && vatMinor>0 && netMinor ≥ threshold(occurredOn) && !allocationNumber. ReceiptDetail gets `allocationNumberExpected` (same rule on the suggestion/current values). Dated threshold table in one shared module (reused by MUT-572):
  2024-05-05 ₪25,000 · 2025-01-01 ₪20,000 · 2026-01-01 ₪10,000 · 2026-06-01 ₪5,000 (before VAT; by invoice date; before the first date → not required).
- D5 Copy: "No allocation number. You may not be able to claim back the VAT without it." (en, ar). No compliance words (firm-copy-guard).
- D6 QR now: add QR decoding to the OCR sidecar (zxing-cpp, Apache-2.0; page image or first 2 PDF pages; caps + egress lock from MUT-441; payloads in memory, never logged) returning `qr: string[]`. Server: a QR parser registry; the Israeli parser fills allocationNumber with source 'qr' only if real samples show a format carrying it. Bench evidence today: 0/54 real receipts carry an allocation number; only data QR = JoFotara TLV. ZATCA/JoFotara parsers stay in MUT-490.

## Server (mini-crm/server/src)
- `israel/allocation-number.ts` (new, pure): ALLOCATION_THRESHOLDS, thresholdOn(date), allocationNumberRequired({profileType,currency,occurredOn,netMinor,vatMinor}), normalizeAllocationNumber(raw).
- receipts/extract: keywords.ts ALLOCATION set; fields.ts readAllocationNumber (skip buyer rows; not REGISTRATION); extract.ts field line; merge.ts fill separately + completeness rule (D3); qr/ parser registry + israel.ts (gated on samples).
- ports.ts ReceiptSuggestion.allocationNumber, ExpenseRecord/CreateExpenseInput/UpdateExpensePatch; schemas.ts ReceiptSuggestionSchema, ExpenseSchema (+allocationNumberMissing), Create/UpdateExpenseRequestSchema, ReceiptDetail (+allocationNumberExpected).
- expenses/compose.ts prepareExpenseCreate/expensePatch; repositories prisma.ts + memory.ts; inbox/file-expense.ts + MCP writers default null.
- routes: expenses POST/PATCH, receipts approve (field flows via CreateExpenseRequest).
- serializers.ts serializeExpense (+flag; needs profileType of the org — already on request context), serializeExpenseReceipt.
- Migration `…_mut557_expense_allocation_number`. Records export select + codec; snapshot 16 (portal local migration 15→16 fills null, `addExpenseVat` pattern).
- app.ts API_VERSION; openapi:generate; hosted:types. ADR-245.
- OCR sidecar (server/ocr/app): QR decode + `qr` in read response; LICENSES.md + check_licenses; privacy test (no payload in logs); bench reports QR hit rate.

## Portal (mini-crm/src/hosted)
- receiptSuggestion.ts maps allocationNumber; HostedExpenseFields + useHostedExpenseForm (field, validation message); ReceiptReview "needed" hint when allocationNumberExpected; ExpenseDrawer field; ExpensesList badge. i18n en/ar.

## Phone (mutaba3a-flutter/lib)
- receipts_library_repository.dart ReceiptSuggestionFields; expense_repository.dart ExpenseEntry (+allocationNumber, allocationNumberMissing), create/patch bodies; feed_entry.dart FeedExpense cache.
- receipt_prefill.dart ReviewField.allocationNumber; receipt_review_sheet.dart row (mark needed when expected); expense_form_sheet.dart field; recent_row.dart RecentBadge when missing. ARB en/ar.

## Tests (first)
- allocation-number.test.ts: threshold table boundaries (₪4,999.99 / ₪5,000 on 2026-06-01; ₪9,000 on 2026-05-31; 2024-05-04), USD, Personal, vat 0, net null; normalize (spaces, dashes, 8/10 digits, letters).
- extract tests: he/ar/en labels; next-row; ח.פ adjacent not taken; no label → none; buyer rows skipped.
- merge tests: D3 completeness rule (big ILS+VAT without number → incomplete; small → complete).
- store contract (memory + prisma) for the column; route tests 422 / null clears / approve carries; serializer flag; export parity; snapshot migration.
- sidecar: QR fixture decode, malformed QR ignored, privacy (no payload logged).
- Phone QA (release-qa, "QA iPhone"): receipts.yaml scenario "reading prefills the allocation number" (seeded reading); recent.yaml scenario "₪6,000 net ILS expense with VAT shows the badge → add number → badge gone". Flows in integration_test/qa/.
- Real samples (Basel, ~/Work/Barmajiyat/Mutaba3a/receipt-bench/allocation-2026/) pass in the bench before In Review.

## Out of scope
Requesting/checking numbers with the Tax Authority (MUT-572/574), issuing, document type capture, profile country, ZATCA/JoFotara parsers (MUT-490).

## Eng review amendments (2026-11-06, /plan-eng-review)
- A1 (F1) `serializeExpense(e)` has no profile context today (serializers.ts:574) and is called from 6 places, incl. the multi-profile entries feed (serializers.ts:719, which Recent uses). Make it `serializeExpense(e, ctx: { profileType })` — a REQUIRED param so a forgotten caller fails to compile; `EntryContext` gains `profileTypes: ReadonlyMap<orgId, ProfileType>`; `serializeExpenseReceipt` gets the same ctx for `allocationNumberExpected`. The flag rule lives only in `israel/allocation-number.ts`.
- A2 (F2) `isCompleteSuggestion` (merge.ts:50) also drives `markBacklogPending` (prisma.ts:2405, memory.ts:2805). With D3, never-read To-review ILS receipts ≥ threshold with VAT become backlog candidates → each reads once (bounded: readStatus NONE only; DONE receipts are never re-picked). Accepted as D3's cost; covered by a store-contract test in both stores. Profile type is not part of this rule (reading cost only).
- A3 (F3) Deploy order: OCR sidecar (QR) first; the API treats a missing `qr` in the read response as `[]`, so either order works. Test for it.
- A4 (F4) Flag needs vatTreatment, netMinor and vatMinor all non-null (same guard as serializeExpenseVat, serializers.ts:597).

## GSTACK REVIEW REPORT
| Review | Trigger | Why | Runs | Status | Findings |
|---|---|---|---|---|---|
| Eng review | /plan-eng-review | Plan for MUT-557 before build | 1 | done (compact) | 4 amendments (A1–A4), 2 decisions (R1, R2) |
| Outside voice | default-on | second model | 0 | not run (skipped for time; missing coverage) | — |

Decisions: R1 = net ≥ threshold (₪5,000.00 counts), also for MUT-572 (Basel 2026-11-06). R2 = duplicate-number warning deferred → TODO for MUT-506's duplicate guard.
VERDICT: ready to build.
NO UNRESOLVED DECISIONS
