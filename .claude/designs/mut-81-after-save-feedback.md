# MUT-81 — After saving, show where the entry or payment landed

- **Ticket:** MUT-81 (epic MUT-74) · **Brief:** `landing-apple-redesign.md` decision **R1** (approved 2026-10-11)
- **Builds on:** MUT-8 (Home, ADR-036), MUT-3 (client profile, ADR-033), MUT-83 (`/income` filters as one URL model), MUT-86 (payment drawer, ADR-047), MUT-80 (springs + reduced motion, ADR-044), MUT-5 (income drawer, ADR-039)
- **Reserved:** ADR-057 · TD-076 / TD-077 (ADR-053..056 are taken by the mut-73 and mut-82 lanes; 056 left for MUT-84)
- **Status:** planned, not built

## Problem

After saving income or a payment the drawer closes and the list updates with
no highlight and no message. With a filter active, another profile selected or
a long list, the entry lands out of view — the "entered it and can't find it"
problem.

## R1, restated as behaviour

| | |
|---|---|
| The saved row **is** on screen | soft tint that fades over ~1.5 s; the Owed now figure that changed ticks to its new value; nothing else |
| The saved row **is not** on screen | one short message, "Saved to \<client\> · Show"; **Show** navigates there with the row tinted |
| Screen readers | the tint is announced politely as "Saved" |
| Reduced motion | the tint stays, the fade does not animate |

## Implementation decisions (ADR-057 records D1–D5)

| # | Decision |
|---|---|
| **D1** | **One store, one claim.** A new `savedFlashStore` holds at most one pending save: `{ ids, kind, clientId?, profileId }`. A list that renders any of `ids` **claims** it. Claimed → tint only. Unclaimed when the data settles → the message. Lists never decide anything; they call one hook and read one boolean. |
| **D2** | **A save is identified by every id that represents it.** An income save carries `[transactionId]`. A payment carries `[paymentRecordId, transactionId]` — so on `/income`, where no payment row exists, the **entry** row (whose remaining just changed) is the visible row and no message fires; on the client profile both the payment row and its entry row tint. Honest in every list without any list knowing about payments. |
| **D3** | **"Settled" is a query-idle edge, not a timer guess.** The drawers call `markSaved` *after* `mutateAsync` resolves, which is after `useMutationWithFeedback.onSuccess` has invalidated — so refetching is already in flight. The announcer resolves on the first `useIsFetching()` 1→0 transition, with a 1200 ms hard cap as a backstop. No arbitrary sleep. |
| **D4** | **Show is a route + a profile, computed once.** `flashTarget(flash)` (pure) returns the client profile for an entry with a client, else `/income` with the filter model reset so the row cannot be filtered out again. Show switches the active profile first when the save landed in another one (`useProfileStore.setActiveProfile`), navigates, and **re-arms** the flash with `messaged: true` so it can never message twice. |
| **D5** | **The tint's life is JS-timed, the fade is CSS.** The store clears `flashIds` after 1500 ms; CSS fades `--accent-subtle` out over the same 1500 ms. Under `prefers-reduced-motion: reduce` the animation is `none` and the tint simply ends with the timer — the AC's "keeps the tint, without the fade". |

## Files

**New — the shared mechanism (one place, per the AC):**

| File | What |
|---|---|
| `src/lib/savedFlash.ts` | pure: `SavedFlash` type, `flashTarget(flash)`, `matchesFlash(ids, flash)`, `FLASH_MS = 1500`, `RESOLVE_CAP_MS = 1200` |
| `src/lib/savedFlashStore.ts` | zustand: `pending`, `flashIds`, `claimed`; `markSaved`, `claim(ids)`, `resolve()`, `rearm(flash)`, `clear()` |
| `src/hooks/useSavedFlash.ts` | `useSavedFlashRows(ids: string[]) → (id) => boolean` — claims every rendered id once per id-set, returns the per-row predicate. One hook call per list, so it works inside an existing `rows.map(...)` with no row component extraction |
| `src/components/layout/SavedFlashAnnouncer.tsx` | mounted once in `AppShell`: watches `useIsFetching()`, resolves, renders the sr-only `role="status"` "Saved", or raises the toast with the Show action |
| `src/hooks/useTickedAmount.ts` | rAF count-up for a minor-unit figure; snaps on first value and under reduced motion |

**Touched:**

| File | Change |
|---|---|
| `src/components/drawers/IncomeDrawer.tsx` | `markSaved({ kind:'income', ids:[id], clientId, profileId })` after create and after update, before `closeIncomeDrawer()` |
| `src/components/drawers/PartialPaymentDrawer.tsx` | `markSaved({ kind:'payment', ids:[record.id, transactionId], clientId: transaction.clientId, profileId: transaction.profileId })` after create and after update — MUT-82's inline Record payment inherits this for free |
| `src/components/home/HomeNeedsAttention.tsx` | one `useSavedFlashRows` call + `cn(..., flashed(row.id) && 'row-flash')` |
| `src/components/home/HomeRecentPayments.tsx` | same, over `payment.id` |
| `src/components/clients/ClientWorkSection.tsx` | same, over `row.id` |
| `src/components/clients/ClientPaymentsSection.tsx` | same, over `payment.id` |
| `src/pages/income/IncomePage.tsx` | same, over `tx.id` |
| `src/components/clients/OwedNowSummary.tsx` | `owedMinor` through `useTickedAmount` (the overdue line does not tick) |
| `src/components/layout/AppShell.tsx` | mount `<SavedFlashAnnouncer />` beside the drawers |
| `src/index.css` | `tr.row-flash` beside the other `.data-table` rules + the reduced-motion guard |
| `src/lib/i18n/translations/{en,ar}.json` | `savedFlash.saved`, `savedFlash.savedTo`, `savedFlash.savedNoClient`, `savedFlash.show` |

**Not touched:** `ExpenseDrawer`, `RecurringMarkPaidDrawer`, `RetainerDrawer` — the ticket scopes R1 to income and payments. The hosted portal has its own `Drawer` and is MUT-91's job.

## Reuse (checked against COMPONENT_REGISTRY)

- The message is an existing `Toast` — already `role="status"` / `aria-live="polite"`, already supports `{ action: { label, onClick } }` (the duplicate-income undo uses it). No new message component.
- `cn`, `formatAmount`, `usePrefersReducedMotion`, `useProfileStore`, `useIncomeFilters`/`mergeIncomeSearch` (MUT-83) all exist and are used as-is.
- Nothing like the flash/claim mechanism exists today (grep: the only `highlight` in the codebase is the typeahead's). It is genuinely new, hence the ADR.

## Tests (TDD — `mut-81-after-save-feedback-tests.md` lists them as rules)

- **unit** — `flashTarget` for client / no-client / other-profile; `matchesFlash`; store: claim, resolve claimed vs unclaimed, second save replaces the first, `flashIds` clear at 1500 ms (fake timers), re-arm never messages twice; `useTickedAmount` counts, snaps on mount, snaps under reduced motion, cancels its rAF on unmount; i18n keys non-empty in en **and** ar with `{client}` kept
- **component** — `useSavedFlashRows` claims each id once and tints only flashed ids; `SavedFlashAnnouncer` claimed → live region, no toast / unclaimed → toast with Show / Show switches profile, navigates and re-arms; `OwedNowSummary` ticks on change
- **integration** (fake-indexeddb, real repo, memory router) — the three AC paths: visible row on Home tints with no toast; an income create filtered out on `/income` raises the message and Show clears the filters and lands on the tinted row; a save into another profile switches profile on Show; a payment on the client profile tints both its payment row and its entry row; reduced motion keeps the class with `animation-name: none`
- **e2e** — save with a filter active → message → Show → tinted row; axe on the flashed state (known `color-contrast` only)

Commands (Node 22 — Homebrew node 26 breaks the localStorage tests, TD-054):
`npm run lint` · `npm run typecheck` · `npm run test:run` · `npm run build` · `npm run test:e2e`

## Scope, cost, perf

- No schema change, no new query, no extra read — the mechanism rides the invalidation that already happens. One small zustand store; the claim effect is O(rows) on a stable id key.
- The Owed-now **tick** is in R1 and in the ticket's Proposed solution but is **not** in the acceptance criteria. It is in scope here, kept to one small hook used by one component; it is the first thing to drop if the ticket needs trimming.

## Edge cases

- Delete (and MUT-82's Undo) never flash — `markSaved` fires only on create and update.
- Two saves in a row: the second replaces the first; only one message can ever be showing.
- Arabic: the client name in the message is wrapped in an FSI/PDI isolate; the tint is a background, so RTL needs nothing.
- The row lands under the closing drawer (MUT-80 spring exit): the tint is applied on render, so it is already there when the drawer clears.
- A save into a profile that was since deleted: Show falls back to `/income` without switching.

## Known collision — MUT-82 is in flight

`feature/mut-82-home-inline-payment` (test plan committed, implementation starting) touches
`PartialPaymentDrawer`, `stores.ts`, `toastStore` (adds `group`), `ToastContainer`,
`HomeNeedsAttention` and `OverviewPage` — five of them also touched here. Its plan's D7
explicitly defers the highlight to MUT-81.

**Recommended:** land MUT-82 first, then build MUT-81 on top of it. MUT-81's touch on
`HomeNeedsAttention` is then one hook call and one `className`, and its message can adopt
MUT-82's toast `group` so an Undo and a "Saved to …" never stack.
