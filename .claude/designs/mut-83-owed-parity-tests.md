# MUT-83 — Owed now on Home and Clients always match: test plan

- **Ticket:** MUT-83 (epic MUT-74) · **Brief:** `landing-apple-redesign.md` H2 (approved 2026-10-11) · **ADR:** ADR-049 · **TD:** TD-065, TD-066
- **Relevant decisions:** ADR-033 (one Owed now definition), ADR-035 (FX-ranked order), ADR-036 §5 (Home's scope, unchanged), ADR-039 (payment records own payment state)

## What the audit found (2026-10-12)

Home's Owed now is `summarizeOwedByCurrency(transactionRepo.list({ kind: 'income', status: 'unpaid', profileId }))`:
every live, non-archived unpaid income **whose entry belongs to the active business** (`tx.profileId`).

Before MUT-83 the Clients strip was `combineOwed(clientSummaryRepo.list({ profileId }).map(s => s.owed))`:
for each live client **that belongs to the active business** (`client.profileId`), its unpaid income **in every business**.

The two differed by four kinds of debt, not two:

| # | Debt | Home (business P) | Clients strip (business P), before |
|---|---|---|---|
| D1 | entry in P, no client (or its client row is gone) | counted | not counted |
| D2 | entry in P, client archived | counted | not counted |
| D3 | entry in P, live client created in another business Q | counted | not counted (the client was listed under Q) |
| D4 | entry in Q, live client created in P | not counted | counted |

Archived entries count in neither (ADR-033 §2, ADR-036 §5). D1/D2 are what the ticket names. D3/D4 come from clients being shared across businesses (`ClientTypeahead` lists every business's clients).

**Q1 (answered by the owner 2026-10-12, option A):** each business's Clients list counts only that business's entries. It lists the clients created in that business (even with no entries) plus clients created elsewhere that have at least one entry recorded there. Every column counts only that business's entries. The client profile page stays all-businesses.

## Design

- **One input set.** `clientSummaryRepo.listOwedIndex` reads the business's entries through `transactionRepo.list` (the read behind Home) and splits them with `partitionOwedNow(entries, clients, today)` in `src/db/aggregations.ts`: one group per live client, **No client** (no `clientId`, or one whose client row is gone), **Archived clients**. `total` is `summarizeOwedByCurrency` over the same entries, so it equals Home's by construction, and the parts add up to it.
- **Helper shape for MUT-89.** The helper takes `entries` and `clients`, not a business, so the "All businesses" lens can pass several businesses' entries.
- **Muted rows.** Up to two rows after every client, whatever the sort: "No client · N entries" (N = entries with a balance) and "Archived clients · N" (N = archived clients with a balance), each with Owed now and Overdue per currency, shown only when non-zero.
- **Each muted row opens a filtered list.** `/income?client=none|archived&status=unpaid&dateFrom=2000-01-01&dateTo=2100-12-31`. Income's filters (period, status, search, client scope) are one model in the URL (`src/lib/incomeSearch.ts`, `useIncomeFilters`), written with `replace`. With no parameters the page behaves as before. A chip names the client scope and clears it.
- **Search.** A search narrows the list to matching clients; the strip sums what is listed and the muted rows hide.
- **No clients but muted debts.** The strip and the muted rows show, not the "No clients" empty state.
- **Cache.** The read is keyed `['clientSummaries', 'owedIndex', …]`, so every write that refreshes client summaries refreshes it.

## Rules under test

| # | Rule | Level | File |
|---|---|---|---|
| T1 | `clientScopeOf`: none for no client or a gone client row, archived for an archived client, undefined for a live one | unit | `src/db/__tests__/aggregations.test.ts` |
| T2 | `owedNowRemaining`: the balance of a live unpaid income; 0 for paid, expense, deleted, archived, over-received | unit | same |
| T3 | `partitionOwedNow`: No client and Archived clients buckets with their counts; every live entry of a live client grouped; total = `summarizeOwedByCurrency` of the same entries; parts add up to the total; empty input | unit | same |
| T4 | **Parity (AC1):** on a Dexie fixture with unassigned, deleted-client, archived-client, archived-entry and shared-client (D3/D4) debts in USD, ILS and EUR across two businesses, `listOwedIndex(P).total` equals Home's figure for each business, and the rows plus the muted rows add up to it | integration (fake-indexeddb) | `src/db/__tests__/clientOwedIndex.test.ts` |
| T5 | Archiving a client moves its debt to Archived clients and keeps the total equal to Home's | integration | same |
| T6 | Listing: own live clients (even with no entries) plus other businesses' clients with an entry here; archived clients never | integration | same |
| T7 | D3/D4: a shared client's debt, payments and activity count only in the business they were recorded in | integration | same |
| T8 | Search narrows the client rows only; total and muted rows unchanged | integration | same |
| T9 | `transactionRepo.list({ clientScope })` returns exactly the entries behind each muted row's figure | integration | same |
| T10 | `toOwedBucketRows` shows only non-zero buckets, No client first, overdue split per currency; `orderClientIndex` puts them after every client for every sort field and direction (AC2) | unit | `src/components/clients/__tests__/clientIndexRows.test.ts` |
| T11 | ClientsPage: muted rows only when non-zero, after the clients, muted class, labels with counts, amounts per currency; last under any sort; the strip includes them; clicking navigates to `/income` with `owedEntriesSearch`; the label is a link; a search hides them and the strip sums the matches; no clients but a No-client debt shows the strip and the row, not the empty state | component | `src/pages/clients/__tests__/ClientsPage.test.tsx` |
| T12 | `parseIncomeSearch` / `mergeIncomeSearch` / `resolveIncomeFilters` / `owedEntriesSearch`: unknown values dropped, both period ends or neither, numeric search read as text, cleared filters removed, defaults = this month, All, no search, every client | unit | `src/lib/__tests__/incomeSearch.test.ts` |
| T13 | `useIncomeFilters` on a real memory router: reads the URL, writes a change keeping the other filters without a history entry, drops a cleared filter | hook | `src/hooks/__tests__/useIncomeFilters.test.tsx` |
| T14 | IncomePage: no parameters → this month, every status, every client; a link's client scope, status and period are applied; the chip names the scope and clears it; tabs write to the URL; an empty scoped list says nothing matched | component | `src/pages/income/__tests__/IncomePage.test.tsx` |
| T15 | i18n: the chip keys exist in en and ar (`{name}` kept); the row labels have every plural form (en one/other, ar six forms) | unit | `src/lib/i18n/__tests__/owedIndexKeys.test.ts` |
| T16 | e2e: with a client entry and a no-client entry, Home's and Clients' Owed now are equal; the No client row opens `/income?client=none` with one row and a chip that clears it; axe on both pages adds no rule, and the muted row and chip pass `color-contrast` | e2e | `e2e/owed-parity.spec.ts` |

## Edge cases

- A client archived after its income was recorded: its debt moves from its row to Archived clients; the strip doesn't change (T5).
- An entry whose `clientId` points to a deleted client row counts under No client (the income list already labels it "No client") (T1, T4).
- An unpaid entry with nothing left to pay (received ≥ amount, legacy) counts nowhere and doesn't raise N (T3).
- An archived entry of a live client counts nowhere, on both screens (T3, T4).
- A client created here with debts only in another business is listed as settled here, with no last payment or activity from the other business (T7).
