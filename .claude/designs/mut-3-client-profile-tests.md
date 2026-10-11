# Test Plan — MUT-3: one-page client profile

- **Date:** 2026-10-11
- **Companion:** `.claude/designs/mut-3-client-profile.md`
- **Framework:** Vitest 4 + jsdom + fake-indexeddb; TZ pinned `Asia/Jerusalem`
- **Baseline (2026-10-11, `feature/mut-1-client-core` at 0c57247):** 130 files, 2,149 passed, 5 skipped, 0 failed

Order is red → green per block. Date-sensitive tests pin the clock with `vi.useFakeTimers({ shouldAdvanceTime: true })` + `vi.setSystemTime`.

## T1 — `summarizeOwedByCurrency` (`src/db/__tests__/aggregations.test.ts`) — 100% branch

- [ ] Empty input → `[]`
- [ ] One unpaid USD entry → `[{ USD, owed = amount, overdue = 0 }]`
- [ ] Partial entry counts only the remaining balance (`amount − received`)
- [ ] Paid entry, expense, soft-deleted and archived entries contribute nothing
- [ ] Overdue portion = remaining of rows with `dueDate < today`; due-today is **not** overdue (ADR-010); no due date is never overdue
- [ ] Two currencies stay separate, never summed; order USD → ILS → EUR regardless of input order
- [ ] A currency whose entries net to 0 owed is omitted
- [ ] Over-received (received > amount) clamps to 0, not negative

## T2 — `listByClient` (`src/db/__tests__/paymentRecords.test.ts`, extends the 7 existing)

- [ ] Existing 7 tests unchanged and green; every record row carries `source: 'record'`
- [ ] Income created as Received (status `paid`, `receivedAmountMinor = amount`, no records) → one `source: 'entry'` row: id `entry:<txId>`, amount = full amount, `paidAt = tx.paidAt`, title + currency from the entry
- [ ] Entry with no `paidAt` falls back to `occurredAt`
- [ ] Records covering the whole received amount → no extra entry row (no double count)
- [ ] Records covering part of a paid entry → one entry row for the uncovered remainder only
- [ ] Unpaid entry with no records and no received amount → no row
- [ ] Soft-deleted entry → neither its records nor an entry row
- [ ] Entry rows obey `currency`, `dateFrom`/`dateTo` and `limit` like record rows, and sort with them by `paidAt` desc
- [ ] Timestamped `paidAt` on the `dateTo` day is included (calendar-date comparison, D12)

## T3 — Invalidation (`src/hooks/__tests__/…`)

- [ ] `useMarkIncomePaid` success invalidates the `['paymentRecords']` prefix (spy on `queryClient.invalidateQueries`)
- [ ] `useMarkTransactionPaid` success invalidates the `['paymentRecords']` prefix
- [ ] `useDeleteIncome` / `useUpdateIncome` success invalidate it too (an entry's title or deletion changes payment rows)

## T4 — Row shaping (`src/components/clients/__tests__/clientProfileRows.test.ts`)

- [ ] `toWorkRow` copies date/title/project/amount/currency; `remainingMinor` set **only** when partial
- [ ] Overdue unpaid row → `overdueDays` set, `dueInDays` undefined; future due → `dueInDays`; due today → `dueInDays = 0`
- [ ] Paid row → no overdue/due fields; `isReceivable` false
- [ ] Missing title stays `undefined` (the cell renders the "Untitled" key)

## T5 — `OwedNowSummary` (`src/components/clients/__tests__/OwedNowSummary.test.tsx`)

- [ ] One block per currency, amount formatted in that currency
- [ ] Overdue line shown in the danger style when > 0; "Nothing overdue" when 0
- [ ] Empty list → "Nothing owed"
- [ ] Amounts are LTR-isolated (`dir="ltr"`)

## T6 — `ClientDetailPage` (`src/pages/clients/__tests__/ClientDetailPage.test.tsx`, rewritten)

Header / question 2
- [ ] No tab buttons in the DOM; header, Work and Payments sections render together
- [ ] Owed Now shows USD and ILS separately from mixed receivables; overdue portion distinguished
- [ ] Owed Now ignores the work-list filters (change date range → hero unchanged)
- [ ] Owed Now hero uses the largest amount class on the page

Work / question 1
- [ ] Row shows date, title, amount+currency, status; partial row shows "Remaining" + remaining amount; unpaid row does not
- [ ] Project tag shown when set (link while projects is on, text while off — MUT-16); absent when unset
- [ ] Untitled entry renders the untitled label, not an empty cell
- [ ] Row click opens the income drawer in edit mode
- [ ] Date range / status / search are passed to `useIncome` as one filter object
- [ ] No work at all → one primary action → `openIncomeDrawer({ mode: 'create', defaultClientId: 'client-1' })`
- [ ] Filtered to nothing → "No entries match" + Clear filters, no add action; Clear filters restores defaults
- [ ] Record payment button on unpaid + partial rows only, remaining (not full) amount, opens `openPartialPaymentDrawer({ transactionId })` (MUT-6)
- [ ] Invoice actions off/on (MUT-13); Mark paid only on unpaid rows

Payments / question 3
- [ ] Rows show date, amount+currency, "for" title, notes; newest first as returned
- [ ] Record row click → `editPaymentRecord({ transactionId, paymentRecordId })`
- [ ] Entry row click → income drawer for that entry; notes cell shows "Recorded on the entry"
- [ ] No payments → `transactions.partialPayment.noPayments`

Other
- [ ] Retainers card off/on (MUT-13); + Project hidden while projects is off (MUT-16)
- [ ] `useProjects` is never called (MUT-23)

## T7 — Release gate

- [ ] `npm run lint` — no new errors over baseline
- [ ] `npx tsc -b` green
- [ ] `npx vitest run` — 0 failures
- [ ] `npm run test:tz` green
- [ ] `npm run build` succeeds
- [ ] Browser check on seeded data, English and Arabic: three sections visible without scrolling sideways, amounts LTR in Arabic, Mark paid refreshes Payments and Owed Now
