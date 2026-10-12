# MUT-83 — Owed now on Home and Clients always match: test plan

- **Ticket:** MUT-83 (epic MUT-74) · **Brief:** `landing-apple-redesign.md` H2 (approved 2026-10-11) · **ADR:** ADR-049 (reserved) · **TD:** TD-065..066 (reserved)
- **Relevant decisions:** ADR-033 (one Owed now definition), ADR-035 (FX-ranked order), ADR-036 §5 (Home's scope, unchanged), ADR-039 (payment records own payment state)

## What the audit found (2026-10-12)

Home's Owed now is `summarizeOwedByCurrency(transactionRepo.list({ kind: 'income', status: 'unpaid', profileId }))`:
every live, non-archived unpaid income **whose entry belongs to the active business** (`tx.profileId`).

The Clients strip is `combineOwed(clientSummaryRepo.list({ profileId }).map(s => s.owed))`:
for each live client **that belongs to the active business** (`client.profileId`), its unpaid income **in every business**.

The two differ by four kinds of debt, not two:

| # | Debt | Home (business P) | Clients strip (business P) |
|---|---|---|---|
| D1 | entry in P, no client (or its client row is gone) | counted | not counted |
| D2 | entry in P, client archived | counted | not counted |
| D3 | entry in P, live client created in another business Q | counted | not counted (the client is listed under Q) |
| D4 | entry in Q, live client created in P | not counted | counted |

Archived entries count in neither (ADR-033 §2, ADR-036 §5). D1/D2 are what the ticket names. D3/D4 come from clients being shared across businesses (`ClientTypeahead` lists every business's clients), and the brief does not say how to show them. **Open question Q1** below.

## Design (settled parts)

- **One input set.** The Clients list reads the same receivables Home reads (`transactionRepo.list` with Home's filters) and partitions them with a pure helper in `src/db/aggregations.ts`: per listed client, **No client** (no `clientId`, or a `clientId` whose client row no longer exists), **Archived clients**. The strip is `summarizeOwedByCurrency` over the whole set, so it equals Home's by construction, and equals the sum of the rows beneath it.
- **Helper shape for MUT-89.** The helper takes `entries` and `clients` (not a `profileId`), so the "All businesses" lens can pass entries from several businesses later.
- **Extra rows.** Up to two muted rows after every real client, regardless of sort column or direction: "No client · N entries" (N = entries with a balance) and "Archived clients · N" (N = archived clients with a balance). Each shows its Owed now and Overdue per currency. Shown only when non-zero.
- **Each extra row opens a filtered list.** `/income` gains a URL-driven filter (`?client=none|archived`, plus status Unpaid and All time from the link). Income's filter state becomes one URL-mirrored model; with no params the page behaves exactly as today.
- **Search.** While a search is active the list narrows to matching clients, the strip sums what is listed, and the extra rows hide (they are not named clients). Parity is a property of the unfiltered list.
- **No clients but extra debts.** The list shows the strip and the extra rows, not the "No clients" empty state.

## Rules under test

| # | Rule | Level | File |
|---|---|---|---|
| T1 | `partitionOwedNow(entries, clients, today)`: an entry with no client goes to No client; an entry whose client id has no client row goes to No client; an entry of an archived client goes to Archived clients; everything else to its client | unit | `src/db/__tests__/aggregations.test.ts` |
| T2 | The partition's total equals `summarizeOwedByCurrency(entries)` per currency, and equals `combineOwed` of all its parts | unit | same |
| T3 | Archived, deleted, paid and fully received entries count nowhere; overdue splits per bucket via `isOverdueReceivable` | unit | same |
| T4 | Counts: No client counts entries with a balance; Archived clients counts distinct archived clients with a balance | unit | same |
| T5 | Currencies never combine; fixed USD → ILS → EUR order in every bucket | unit | same |
| T6 | **Parity (AC1):** on a Dexie fixture with unassigned, archived-client and archived-entry debts in USD, ILS and EUR (plus another business's entries), the Clients index total equals Home's `summarizeOwedByCurrency(transactionRepo.list(Home's filters))` for every currency | integration (fake-indexeddb) | `src/db/__tests__/clientOwedIndex.test.ts` |
| T7 | The Clients index read returns per-client rows, No client and Archived clients from that one receivables read (AC3) | integration | same |
| T8 | Extra rows sort after every real client for every sort field and both directions (AC2) | unit | `src/components/clients/__tests__/clientIndexRows.test.ts` |
| T9 | ClientsPage renders "No client · N entries" and "Archived clients · N" only when non-zero, muted, at the bottom; the strip includes them | component | `src/pages/clients/__tests__/ClientsPage.test.tsx` |
| T10 | Clicking an extra row navigates to `/income` with `client=none` / `client=archived` | component | same |
| T11 | Search hides the extra rows and the strip sums the matching rows | component | same |
| T12 | No clients but a No-client debt: strip and extra row render, no empty state | component | same |
| T13 | `/income?client=none` lists only unpaid entries with no client (all time); `client=archived` only those of archived clients; no params → today's defaults (this month, All, no client filter) | component | `src/pages/income/__tests__/IncomePage.test.tsx` |
| T14 | Income filter changes write the URL with `replace` (one model, not separate states) | component | same |
| T15 | `transactionRepo.list` supports the client-scope filter (`none` / `archived`), deleted clients counting as none | integration | `src/db/__tests__/transactionRepo*.test.ts` |
| T16 | i18n: every new key exists in `en` and `ar`; Arabic plural forms go through `tp()` where counts are shown | unit | existing i18n completeness test |

Cross-business cases (D3/D4) get tests once Q1 is answered.

## Edge cases

- A client archived after its income was recorded: its debt moves from its row to Archived clients; the strip doesn't change.
- An entry whose `clientId` points to a deleted client row counts under No client (the income list already labels it "No client").
- Unpaid entry with nothing left to pay (received ≥ amount, legacy) counts nowhere and doesn't raise N.
- An archived entry of a live client counts nowhere (ADR-033 §2), on both screens.

## Open question Q1 (blocks D3/D4)

A client created in business A that has income recorded in business B (clients are shared in the income drawer). Today B's Home counts that debt, B's Clients list doesn't show the client, and A's Clients list shows it with B's debt included. Options:

- **A (recommended).** The Clients list of a business counts only that business's entries, the same set Home counts. A client from another business that has entries here is listed here too. Every column on its row counts only this business. The client profile page stays all-businesses.
- **B.** Keep client rows as today (all businesses). The strip uses Home's set, so it always equals Home, but for shared clients the rows don't add up to the strip.
- **C.** Rows count only this business. A third muted row, "Clients from other businesses · N", holds this business's debts of clients created elsewhere. The listed clients don't change.
