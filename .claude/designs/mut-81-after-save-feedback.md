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
| **D3** | **Each list reports its own settled render; nothing watches a global counter.** *(amended by eng review D3 — the original `useIsFetching()` 1→0 proposal was a race; see Section 1 [P1].)* Every list in scope passes `settled` (`!isLoading && !isFetching`, already returned by its `useQuery`) alongside its ids, and registers/deregisters with the store on mount/unmount. The announcer resolves only once **every registered list** has reported a settled render post-dating the save — so the client profile's two independent queries must both settle before any message can fire. A backstop timer remains for routes with no instrumented list (saving via + Add from `/settings` or `/expenses`): that is a load-bearing path, documented and tested as such, not a safety net. |
| **D4** | **Show is a route + a profile, computed once.** `flashTarget(flash)` (pure) returns the client profile for an entry with a client, else `/income` with the filter model reset so the row cannot be filtered out again. Show switches the active profile first when the save landed in another one, through **`useProfileStore.getState().setActiveProfile` — the raw store, never the `useActiveProfile` wrapper**, whose membership guard (`useActiveProfile.ts:83-88`) silently refuses an id the profiles query has not loaded yet (Section 1 [P2]). Then navigate, and **re-arm** the flash with `messaged: true` so it can never message twice. |
| **D5** | **The tint's life is JS-timed, the fade is CSS, and the clock starts when the row renders.** The store clears `flashIds` 1500 ms after the target row's **first render**, not after `markSaved` — otherwise a Show pressed four seconds into the toast arrives at a row whose tint expired 2.5 s ago (Section 1 [P2]). `rearm` restarts that clock. CSS fades `--accent-subtle` out over the same 1500 ms. Under `prefers-reduced-motion: reduce` the animation is `none` and the tint simply ends with the timer — the AC's "keeps the tint, without the fade". |
| **D6** | **The flash store is never persisted.** `profileStore.ts:32` and `onboardingStore.ts:35` wrap `persist`; `toastStore.ts` does not. This is ephemeral UI state and follows `toastStore` — a `persist` wrapper would resurrect yesterday's tint on reload (Section 1 [P3]). |

## Files

*Merged view after both reviews. Three new files for the mechanism (eng D2), one new component for the
message (design 5B), and reuse of MUT-82's motion primitives (eng D9A) rather than new ones.*

**New:**

| File | What |
|---|---|
| `src/lib/savedFlashStore.ts` | types + pure helpers + zustand, all exported. Pure: `SavedFlash` (carries `clientName` per Test review's untraced-branch fix), `flashTarget(flash)`, `matchesFlash(ids, flash)`, `FLASH_MS = 1500`. Store: `pending`, `flashIds`, `claimed`, `registeredLists`; `markSaved`, `registerList`/`deregisterList`, `reportSettled(listId, ids, settled)`, `resolve()`, `rearm(flash)` (restarts the 1500 ms clock on the row's first render — design D5), `clear()`. **No `persist` wrapper** (eng D6) |
| `src/hooks/useSavedFlash.ts` | `useSavedFlashRows(ids, queryResult) → (id) => boolean` — registers the list, derives `settled` from the query result itself (`!isLoading && !isFetching`, Code quality [P3]) so no caller can get it wrong, intersects ids directly with no content key (Performance [P3]/eng D9 supersession), returns the per-row predicate. Plus `useSavedFlashResolution()` for the announcer |
| `src/components/ui/SavedFlashStrip.tsx` + `.css` | the anchored strip (design 5B) — subject + reason (6A), two-line layout below ~480 px (9A), the 2A locator state when Show still can't find the row, the 4A repeat-save counter, dismiss `×` matching `income-scope-chip-clear`. Replaces `Toast` for this message entirely; `Toast`/`ToastContainer` stay for errors and MUT-82's `PAYMENT_UNDO_GROUP` |
| `src/components/layout/SavedFlashAnnouncer.tsx` | mounted once in `AppShell`: resolves from the settled reports (never a global fetch counter — eng D3), renders the sr-only `role="status"` "Saved" when claimed, or mounts `SavedFlashStrip` when not. Show: raw `useProfileStore.getState().setActiveProfile` (eng D4), computes `flashTarget`, resolves the row's page before navigating (design D8/11A interaction, eng task T2), implements the focus chain (design 10A) **only for the paths ADR-055 §6 doesn't already cover** — i.e. not Home's full-payment slide-out |

**Touched:**

| File | Change |
|---|---|
| `src/lib/motion/rowExit.ts` | generalize the copy/overlay/animate/fade core into `captureElementExit(element, container)` for any `HTMLElement`; keep `captureRowExit` as a thin table-specific wrapper (cell widths, sibling glide) so MUT-82's existing 186-line test suite stays green unchanged (eng D9A) |
| `src/lib/motion/blockExit.ts` *(new, small)* | thin wrapper over `captureElementExit` for a flex-row currency block: siblings resize via CSS transition, no JS glide (eng D9A) |
| `src/components/drawers/IncomeDrawer.tsx` | `markSaved({ kind:'income', ids:[id], clientName, clientId, profileId })` after create and after update, before `closeIncomeDrawer()` |
| `src/components/drawers/PartialPaymentDrawer.tsx` | `markSaved({ kind:'payment', ids:[record.id, transactionId], clientName, clientId, profileId })` after create and after update, **unconditionally** — independent of the optional Home-only `onRecorded` prop (`ClientWorkSection.tsx` and `IncomePage.tsx` call `openPartialPaymentDrawer` with no `onRecorded` at all, confirmed by grep) |
| `src/components/home/HomeNeedsAttention.tsx` | one `useSavedFlashRows` call over the rows that stay + `cn(..., flashed(row.id) && 'row-flash')` for the partial-payment case. In the full-settle branch (`record.amountMinor >= leftMinor`, same branch ADR-055 §6 already guards), **does not call `markSaved`** — the slide-out plus Undo toast is already complete feedback (eng D10A) |
| `src/components/home/HomeRecentPayments.tsx` | `useSavedFlashRows` over `payment.id`, from `useRecentPayments` |
| `src/components/clients/ClientWorkSection.tsx` | `useSavedFlashRows` over `row.id`, from `useIncome`; wire `Pagination` + `QueryFilters.limit` (design 11A: page size 50 as a named constant, control below the table, hidden at one page, filter change resets to page 1) |
| `src/components/clients/ClientPaymentsSection.tsx` | `useSavedFlashRows` over `payment.id`, from `usePaymentsByClient` |
| `src/pages/income/IncomePage.tsx` | `useSavedFlashRows` over `tx.id`, from `useIncome`; same `Pagination` wiring as `ClientWorkSection` |
| `src/components/clients/OwedNowSummary.tsx` | `owedMinor` through a **local** `useTickedAmount` hook (one consumer, eng D2); currency blocks enter/collapse via `blockExit.ts` (design 3A, eng D9A); migrate off the private `isolateLtr` (U+2066 LRI) onto the shared `isolate()` (eng D4/D7b) |
| `src/lib/utils.ts` | export `isolate()` (U+2068 FSI … U+2069 PDI) — the shared home eng D4 approved |
| `src/components/layout/AppShell.tsx` | mount `<SavedFlashAnnouncer />` beside the drawers |
| `src/index.css` | `tr.row-flash` with the 8A leading rail (inset box-shadow, logical inline-start edge) beside the other `.data-table` rules + the reduced-motion guard; `SavedFlashStrip` styles |
| `src/lib/i18n/translations/{en,ar}.json` | `savedFlash.saved`, `savedFlash.incomeSaved`/`savedFlash.paymentRecorded` (design 6A's two subjects), `savedFlash.reasonFilter`/`reasonBusiness`/`reasonPage` (6A's reason set), `savedFlash.show`, `savedFlash.locator` (2A) |
| `src/components/clients/__tests__/OwedNowSummary.test.tsx` | `:65` expects U+2068 FSI, renamed; add the strong-RTL-initial case (eng D5/R8) |

**Not touched:** `ExpenseDrawer`, `RecurringMarkPaidDrawer`, `RetainerDrawer` — the ticket scopes R1 to income and payments. The hosted portal has its own `Drawer` and is MUT-91's job. `Toast`/`ToastContainer`/`toastStore`'s `group` — MUT-82's `PAYMENT_UNDO_GROUP` stays exactly as shipped; MUT-81 never touches the toast layer (design 5B).

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

## MUT-82 and MUT-84 have landed (superseded by the 2026-10-12 re-review below)

`feature/mut-82-home-inline-payment` merged (`ff6225e`, ADR-055) and `feature/mut-84-clients-split-view`
merged (`eba9676`, ADR-050) during this plan's review cycle. The collision this section originally
flagged is resolved by landing, not by sequencing: `PartialPaymentDrawer`, `stores.ts`, `toastStore`,
`ToastContainer`, `HomeNeedsAttention` and `OverviewPage` are now the *real* shape MUT-81 builds on,
not a moving target. See the re-review's Section 1 findings for what that shape already provides.

---

# Eng review — `/plan-eng-review`

**Target (fixed):** this plan, `.claude/designs/mut-81-after-save-feedback.md` · reviewed 2026-10-12 · branch `main`, `9f6a282` → `17045fa`

> Main moved twice during this review (the known `mutaba3a-worktree-main-moves-during-review` pitfall). Re-checked at the end: `92b53e6` touches `src/hosted/**` only and `17045fa` is Makefile/launch.json — MUT-81 touches neither, so no finding is invalidated. `DECISIONS.md` gained only an addendum to an existing ADR and `TECH_DEBT.md` only resolved TD-058/TD-072, so the reserved **ADR-057 / TD-076 / TD-077** are still free (verified with `grep -nE "^#+ ADR-"`, not a bare `ADR-0NN` grep — learning `mutaba3a-adr-numbering-trap`).

## Scope record (Scope Challenge B)

- **Feature answers:** D1 → **A) Include** — the "Owed now ticks to its new value" animation stays in MUT-81, despite not appearing in any acceptance criterion. R1 ships whole; the shared `OwedNowSummary` is opened once, not twice.
- **Structure:** D2 → **A) Smaller arrangement**.
- **Accepted scope:** the full R1 behaviour (tint on the visible row, "Saved to \<client\> · Show" when it is not visible, Show navigation with profile switch and filter reset, polite "Saved" announcement, reduced motion keeps the tint without the fade, Owed-now tick) across income create/edit and payment create/edit, on Home, the client profile, `/income` and the payments lists. **Three** new files — `src/lib/savedFlashStore.ts` (types + pure helpers + store), `src/hooks/useSavedFlash.ts`, `src/components/layout/SavedFlashAnnouncer.tsx` — with the tick as a local hook inside `OwedNowSummary.tsx`.
- **Pending remedies:** none. All eight decisions (D1–D8) are approved and recorded in the Decision ledger below.
- **Scope EXPANDED after Sections 1–4** by D7/D8: pagination for `ClientWorkSection` and `IncomePage` via the existing `Pagination` component, which was originally dispositioned as out of scope. Count moves from 17 files to ~20, and the ticket now carries a performance fix alongside the feature. Recorded, not re-litigated — D7 is the user's call, made with the tradeoff stated.
- **Scope Challenge result:** scope accepted as-is (a smaller arrangement preserving the same feature set is not a scope reduction; the later D7/D8 expansion is an addition, not a reduction). MODE = FULL_REVIEW.

## Scope Challenge C — findings

| # | Severity | Confidence | Finding |
|---|---|---|---|
| S1 | P3 | 9/10 | `src/hooks/useIncomeQueries.ts:187,201` — `useMarkIncomePaid` and `useRecordIncomePartialPayment` have no production callers (tests only). Dead code that still appears in three page tests' mocks. Outside this ticket; flagged under REPO_MODE collaborative. |
| S2 | P3 | 10/10 | Learning `no-typecheck-script` is stale: `package.json` now has `"typecheck": "tsc --noEmit -p tsconfig.app.json && tsc --noEmit -p tsconfig.hosted.json"` (MUT-35 landed it). Corrected in the learning store. |

Dispositions: S1 — noted, not in scope (no remedy proposed, no decision required). S2 — factual correction, no behaviour change, no decision required.

## 1. Architecture review — findings

**[P1] (confidence: 8/10) plan D3 + `src/hooks/useQueries.ts:246` — the "row is not visible" signal is a race that can fire the message on the page where the row is about to appear.**

D3 proposes: *"The announcer resolves on the first `useIsFetching()` 1→0 transition, with a 1200 ms hard cap as a backstop."* Three things break it:

1. `useIsFetching()` is **global**. It counts every query in the app — `useFxRate`, `useBusinessProfiles`, `useClients`, the lot. On Home five queries are live. A 1→0 transition is therefore governed by unrelated queries, not by the list that matters.
2. The invalidation is **not awaited**: `useQueries.ts:246` reads `onSuccess: () => invalidatePaymentRecordQueries(queryClient)`. Refetches are kicked off and `mutateAsync` resolves immediately after, so the window between `markSaved` and a settled list is real.
3. TanStack Query v5 (`package.json`: `^5.90.16`) has a documented case where `invalidateQueries` during an in-flight initial fetch reuses the in-flight promise and settles with **no trailing refetch** ([TanStack/query#11526](https://github.com/TanStack/query/issues/11526)). `isFetching` reaches 0 while the list still holds pre-save data.

A page with two independent lists makes it concrete: the client profile renders `ClientWorkSection.tsx:70` (`useIncome`) and `ClientPaymentsSection.tsx:32` (`usePaymentsByClient`) as separate queries. A payment saved there must be claimed by whichever settles last.

Failure the user sees: they record a payment on the client profile, the row is there, and a toast still says "Saved to Acme Studio · Show" pointing at the page they are already on. That is the exact confusion the ticket exists to remove, which is why this is P1 rather than a polish note.

**[P2] (confidence: 9/10) `src/hooks/useActiveProfile.ts:83-88` — Show's profile switch silently does nothing when the profiles query has not loaded.**

```
const handleSetActiveProfile = useCallback(
  (id: ActiveProfileId) => {
    // Strict mode: only concrete profile IDs are valid
    if (id !== 'all' && profiles.some((p) => p.id === id)) {
      setActiveProfile(id);
    }
  },
```

The guard refuses any id not in the currently loaded `profiles` array. `useProfileStore.setActiveProfile` (`src/lib/profileStore.ts:35`) has no such guard. Show must go through the raw store, not the hook wrapper, or a cross-profile Show lands on the old profile showing an empty list — a worse outcome than no message at all. Carried as necessary implementation of the approved "Show navigates there" criterion; the already-planned "profile since deleted → `/income` without switching" fallback still stands.

**[P2] (confidence: 8/10) plan D5 — the 1.5 s tint timer starts at save, so a Show pressed later arrives at an untinted row.**

D5 clears `flashIds` 1500 ms after `markSaved`. The toast lives ~6 s. Press Show at second 4 and the tint has been gone for 2.5 s before the route even changes. The plan's `rearm` covers this only if it is specified to **restart** the timer, and to start it when the target list first renders the row rather than at the moment Show is pressed. Carried as necessary implementation of "Show navigates there **with the row highlighted**".

**[P3] (confidence: 10/10) `src/lib/profileStore.ts:32`, `src/lib/onboardingStore.ts:35` — do not wrap the flash store in `persist`.**

Two of the three zustand stores in `src/lib/` are persisted; `toastStore.ts` is not. The flash store is ephemeral UI state — persisting it would resurrect a stale tint on reload, pointing at a row the user saved yesterday. One line in the plan prevents a plausible habit error.

**Distribution architecture:** no new artifact. `AppShell` wraps the root route (`src/router.tsx:34`), so the announcer is global for free; the hosted portal has its own component tree (`src/hosted/shell`) and does not pick this up — that is MUT-91's job, as planned. No CI/CD change, no new bundle.

### Flash lifecycle

```
  IncomeDrawer.onSubmit / PartialPaymentDrawer.handleSubmit
        |
        | await mutateAsync  ──► repo write ──► onSuccess: invalidateQueries (NOT awaited)
        v                                              |
  markSaved({ ids, kind, clientId, profileId })         └──► refetches in flight
        |
        ├──► flashIds = ids ........................ any mounted list tinting those ids, now
        |
        v
  SavedFlashAnnouncer  ◄── settled reports from every registered list
        |
        ├── all registered lists settled, ids seen ──► CLAIMED
        |        └──► sr-only role="status" "Saved"; tint clears 1500ms after the row rendered
        |
        ├── all registered lists settled, ids absent ──► NOT CLAIMED
        |        └──► toast "Saved to <client> · Show"
        |
        └── no list registered (saved from /settings, /expenses…) ──► backstop timer
                 └──► NOT CLAIMED ──► toast   [load-bearing path, not a safety net]

  Show pressed ──► setActiveProfile (raw store) ──► navigate(flashTarget)
                     └──► rearm(flash, { messaged: true }) ──► tint restarts on arrival
```

## Decision ledger

### R1: How the announcer decides the saved row is not on screen
Finding: [P1], confidence 8/10, plan D3 + `src/hooks/useQueries.ts:246`, reviewer: native eng review (Section 1)
Plan baseline: original proposal — resolve on the first global `useIsFetching()` 1→0 transition, with a 1200 ms hard cap. Never separately approved.
Runtime evidence: `useQueries.ts:246` invalidation is not awaited, so refetches are in flight when `markSaved` runs; the client profile renders two independent queries (`ClientWorkSection.tsx:70`, `ClientPaymentsSection.tsx:32`); TanStack Query `^5.90.16`; TanStack/query#11526 documents invalidation during an in-flight fetch settling with no trailing refetch.

Comparison grid:

| Choice | Current (proposed) | A) List-reported settled | B) Keep global isFetching | C) Investigate first |
|---|---|---|---|---|
| R1 resolve signal | global `useIsFetching()` 1→0 | every registered list reports a settled render post-dating the save | unchanged | unchanged, pending |
| R1b backstop (no list on route) | 1200 ms cap, doubles as the primary timer | explicit backstop timer, documented as the load-bearing path for `/settings`, `/expenses` etc., with its own test | unchanged | unchanged, pending |
| R1c lists' wiring | lists pass ids only | lists also pass `settled` (`!isLoading && !isFetching`, already on every list's `useQuery`) | unchanged | unchanged, pending |
| R2 Owed-now tick | approved: include (D1) | include | include | include |
| R3 file arrangement | approved: 3 new files (D2) | 3 new files | 3 new files | 3 new files |
| R4 Show profile switch via raw store | fixed, carried under the approved "Show navigates there" criterion | same | same | same |
| R5 tint timer restarts on arrival | fixed, carried under the approved "with the row highlighted" criterion | same | same | same |
| R6 flash store not persisted | fixed, carried correction | same | same | same |

State: approved
Actual answer: D3 → **A) List-reported settled**
Accepted scope: R1 — the announcer resolves only once every registered list has reported a settled render post-dating the save; R1b — a backstop timer stays, documented and tested as the load-bearing path for routes with no instrumented list (saving via + Add from `/settings`, `/expenses`); R1c — every list in scope passes `settled` (`!isLoading && !isFetching`) alongside its ids, and the announcer gains register/deregister bookkeeping with its own unit tests. R2–R6 carried unchanged.
History: —

## 2. Code quality review — findings

**[P2] (confidence: 10/10) Four private copies of the bidi isolate helper, and two of them are not the same function.**

```
src/components/clients/OwedNowSummary.tsx:23      const isolateLtr = (text: string) => `⁦${text}⁩`;          → U+2066 LRI
src/components/drawers/PartialPaymentDrawer.tsx:43  const FIRST_STRONG_ISOLATE = '⁨';                      → U+2068 FSI
src/components/expenses/RecurringAttentionList.tsx:25  const isolate = (text) => `⁨${text}⁩`;         → U+2068 FSI
src/components/drawers/RecurringMarkPaidDrawer.tsx:45  const isolate = (text) => `⁨${text}⁩`;         → U+2068 FSI
```

LRI forces left-to-right; FSI takes direction from the first strong character. For an amount inside an Arabic sentence they usually render the same, so the divergence is invisible until the isolated text starts with a strong RTL character — which is exactly what MUT-81 introduces, because "Saved to {client}" isolates a **client name**, and an Arabic client name under LRI reverses against the sentence it sits in.

`src/lib/utils.ts:61` already owns this vocabulary — `const BIDI_MARKS = /[‎‏؜‪-‮⁦-⁩]/g;` strips the same isolate range from pasted input. So the destination exists and needs no new module.

MUT-81 adds the fifth call site, so this is the moment the divergence is either fixed or doubled down on. Resolved as R7 below.

**[P3] (confidence: 8/10) `useSavedFlashRows(ids, settled)` will re-report on every render.** All five lists build the ids argument inline (`rows.map(r => r.id)`), a fresh array each render, so an effect keyed on it fires every time. Not an infinite loop — the lists subscribe to `flashIds`, which these writes do not change — but it is redundant store traffic on a hot path. The hook must derive a stable key (`ids.join('|')`) for its effect dependency, and `reportSettled` must be idempotent per `(listId, key, saveId)`. Necessary implementation of the approved R1c contract; carried, no separate decision.

**[P3] (confidence: 9/10) The `settled` expression would be written five times.** `!isLoading && !isFetching` repeated per list is five chances to write `!isLoading` alone and silently reintroduce the race D3 just removed. The hook should take the query result (`{ isLoading, isFetching }`) and compute `settled` itself, so no list can get it wrong. Necessary implementation of R1c; carried, no separate decision.

**Diagrams:** none of the touched files carries an inline ASCII diagram today, so nothing is stale. `src/lib/savedFlashStore.ts` is the one new unit complex enough to earn one — the flash lifecycle diagram from Section 1 belongs in its header comment.

## Decision ledger (continued)

### R7: The bidi `isolate` helper — extract, or add a fifth copy
Finding: [P2], confidence 10/10, `OwedNowSummary.tsx:23` / `PartialPaymentDrawer.tsx:43` / `RecurringAttentionList.tsx:25` / `RecurringMarkPaidDrawer.tsx:45`, reviewer: native eng review (Section 2)
Plan baseline: not addressed. The plan's edge-case list says only "the client name in the message is wrapped in an FSI/PDI isolate", with no home named — which as written means a fifth private copy.
Runtime evidence: four authored first-party definitions, quoted above; two distinct codepoints (U+2066 vs U+2068); `src/lib/utils.ts:61` already owns the bidi range. No generated or vendored copies involved.
Rubric accounting (option B): implementation lines removed ~3, added ~7, **saved ≈ −4** — this grows the diff slightly. The benefit is reliability (one convention, the divergent copy eliminated), not line count. Blast radius of a shared failure: one pure string function with no dependencies; a break shows as mis-ordered bidi text, never a crash.

Comparison grid:

| Choice | Current | A) Extract + migrate all four | B) Extract + migrate the two MUT-81 already opens | C) TODO it, add a fifth copy |
|---|---|---|---|---|
| R7 helper home | four private copies | `isolate()` exported from `src/lib/utils.ts` | `isolate()` exported from `src/lib/utils.ts` | still four, plus a fifth in the announcer |
| R7b LRI/FSI divergence | live, invisible until an RTL-initial string | gone | gone (`OwedNowSummary` is already open for the tick) | live, and now reachable via Arabic client names |
| R7c files touched beyond MUT-81 | — | +2 (`RecurringAttentionList`, `RecurringMarkPaidDrawer`) | 0 | 0 |
| R7d follow-up owed | — | none | TODOS.md entry for the two recurring-expense copies | TODOS.md entry for all four |
| R1–R6 | approved as recorded | unchanged | unchanged | unchanged |

State: approved
Actual answer: D4 → **"Extract + migrate the two MUT-81 opens"** (grid column B; the option was listed first in the question, so the letter differs from the grid — matched by label)
Accepted scope: R7 — export `isolate()` (U+2068 FSI … U+2069 PDI) from `src/lib/utils.ts`. R7b — migrate `OwedNowSummary.tsx:23` off its U+2066 LRI copy (the file is already open for the Owed-now tick) and use the shared helper for MUT-81's new "Saved to {client}" string. R7c — zero files touched outside MUT-81's existing blast radius; `RecurringAttentionList.tsx:25` and `RecurringMarkPaidDrawer.tsx:45` stay as they are. R7d — a TODOS.md entry is owed for those two remaining FSI copies. R1–R6 carried unchanged.
History: —

## 3. Test review

**Framework:** vitest + `@testing-library/react` (`vitest.config.ts`), Playwright for e2e (`playwright.config.ts`). Gate: `npm run lint` · `npm run typecheck` · `npm run test:run` · `npm run build` · `npm run test:e2e`, all under Node 22 (TD-054 — Homebrew node 26 on PATH breaks every localStorage test).

**Test-surfaced design gap (carried, no decision):** the announcer needs the client's *name* for "Saved to {client}". The plan had it looking the name up with `useClient(clientId)` at resolve time — an unresolved branch, because a pending lookup leaves the message with a blank name. The drawers already hold the name (`PartialPaymentDrawer` has `transaction.clientName`; shaped transaction rows carry `clientName` throughout, e.g. `IncomePage.tsx:222`). **The flash carries `clientName` captured at save time**; no query, no pending branch. Necessary implementation of the approved message behaviour.

**Third consumer of `OwedNowSummary` (noted edge):** `ClientsPage.tsx` renders it too, so saving while on `/clients` ticks the strip *and* raises "Saved to Acme · Show", because the clients list renders client rows, not entry rows — nothing can claim a transaction id there. Mildly odd to see the number move while being told where it went, but it is honest: the saved row genuinely is not on screen. Accepted as designed; listed in the Test Plan as an edge to eyeball.

### Coverage diagram

```
CODE PATHS                                                  USER FLOWS
[+] src/lib/savedFlashStore.ts  (new)                       [+] Save with the row on screen
  ├── markSaved()                                             ├── [GAP] Home: income lands in Needs attention
  │   ├── [GAP] first save sets pending + flashIds            ├── [GAP] Client profile: payment tints BOTH
  │   └── [GAP] second save replaces the first                │                 its payment row and its entry row
  ├── reportSettled(listId, ids)                              └── [GAP] Owed now ticks to the new figure
  │   ├── [GAP] no pending            → no-op               [+] Save with the row off screen
  │   ├── [GAP] report predates save  → ignored               ├── [GAP] [→E2E] /income, date filter excludes it
  │   ├── [GAP] ids intersect pending → claimed               ├── [GAP] Show resets filters, row tinted
  │   ├── [GAP] all registered settled→ resolve               ├── [GAP] saved into another profile
  │   └── [GAP] idempotent per (listId,key,saveId)            └── [GAP] Show switches profile, lands tinted
  ├── register/deregisterList()                             [+] No instrumented list on the route
  │   └── [GAP] deregister of the last unsettled list          └── [GAP] + Add from /settings → backstop → toast
  ├── resolve()                                             [+] Accessibility
  │   ├── [GAP] claimed   → announce only                     ├── [GAP] polite "Saved", announced once
  │   └── [GAP] messaged  → never messages twice              └── [GAP] [→E2E] reduced motion: tint, no fade
  ├── rearm() [GAP] restarts the tint clock                 [+] Internationalisation
  ├── backstop timer [GAP] LOAD-BEARING, not a safety net     ├── [GAP] Arabic client name not reversed (R7b)
  ├── flashTarget() [GAP] client vs /income vs profile gone   └── [GAP] en + ar keys present with {client}
  └── matchesFlash() [GAP]                                  [+] Interruptions
[+] src/hooks/useSavedFlash.ts  (new)                         ├── [GAP] navigate away before resolve
  └── useSavedFlashRows()                                     ├── [GAP] Show pressed 4s later, tint restarts
      ├── [GAP] settled false → no report                     └── [GAP] two saves in a row → one message only
      └── [GAP] stable ids key → no duplicate report
[+] SavedFlashAnnouncer.tsx  (new)                          [+] Existing behaviour at risk
  ├── [GAP] claimed → sr-only role="status"                   └── [REGRESSION] OwedNowSummary LRI → FSI
  └── [GAP] not claimed → toast + Show
      └── [GAP] profile gone → /income, no switch
[+] OwedNowSummary.tsx  (local useTickedAmount)
  ├── [★★★ TESTED] per-currency amounts — OwedNowSummary.test.tsx:24,38,46,52
  ├── [★★  TESTED] bidi isolate — :60  ← asserts U+2066; R7b changes it
  ├── [GAP] no tick on first render
  ├── [GAP] ticks old → new on change
  ├── [GAP] reduced motion snaps
  └── [GAP] rAF cancelled on unmount

COVERAGE: 5/36 paths tested (14%)  |  Code paths: 5/24 (21%)  |  User flows: 0/12 (0%)
QUALITY: ★★★:4 ★★:1 ★:0  |  GAPS: 31 (3 E2E, 0 eval, 1 REGRESSION)
```

Legend: ★★★ behavior + edge + error | ★★ happy path | ★ smoke check · [→E2E] needs integration test

**LLM/eval scope:** none. This ticket touches no prompt, model call, or tool definition.

## Decision ledger (continued)

### R8: Regression contract for the `OwedNowSummary` LRI → FSI change (REGRESSION RULE)
Finding: [REGRESSION], confidence 10/10, `src/components/clients/__tests__/OwedNowSummary.test.tsx:65`, reviewer: native eng review (Section 3)
Plan baseline: R7b approved (D4) — migrate `OwedNowSummary` to the shared FSI helper. The regression contract for the existing assertion was never settled.
Runtime evidence: `OwedNowSummary.test.tsx:65` reads `expect(screen.getByText(/overdue$/).textContent).toContain('⁦$500⁩');` — the literal U+2066 LRI. Its `it(...)` is named "keeps amounts left-to-right inside right-to-left text", so it pins the LRI semantic on purpose. Line 42 strips `[⁦-⁩]`, which covers both codepoints, so only line 65 breaks.
Behaviour to preserve: an amount stays visually whole and reads left-to-right inside an RTL sentence.
Intentional change: the codepoint only, U+2066 LRI → U+2068 FSI. For an amount string ("$500", "₪4,200") there is no strong directional character, so FSI falls back to LTR and renders identically — the user-visible behaviour for amounts does not change. FSI differs only for a strong-RTL-initial string, which is precisely MUT-81's new client-name case and the reason for the migration.

Comparison grid:

| Choice | Current | A) Assert the new codepoint | B) Assert the behaviour, not the codepoint |
|---|---|---|---|
| R8 amount-isolate assertion | `toContain('⁦$500⁩')` (U+2066) | `toContain('⁨$500⁩')` (U+2068), test renamed | matches either isolate pair via regex |
| R8b new RTL-name coverage | none | added: a strong-RTL-initial string is not forced LTR | added: same |
| R8c what a future codepoint change does | breaks the test | breaks the test (intentional tripwire) | passes silently |
| R1–R7 | approved as recorded | unchanged | unchanged |

State: approved
Actual answer: D5 → **A) Assert the new codepoint**
Accepted scope: R8 — update `OwedNowSummary.test.tsx:65` to expect `'⁨$500⁩'` (U+2068 FSI) and rename the `it(...)` from "keeps amounts left-to-right inside right-to-left text" to say the amount stays whole, so the intentional change is self-documenting in the diff. R8b — add a case proving a strong-RTL-initial string (an Arabic client name) is not forced left-to-right. R8c — the assertion stays an intentional tripwire: a silent revert to LRI fails the suite. R1–R7 carried unchanged.
History: —

## 4. Performance review — findings

**[P3] (confidence: 9/10) The `ids.join('|')` stable key from Section 2 allocates on every settled render of an unbounded list — and it is not needed.**

Two lists in scope are All Time by default, so "unbounded" is a real shape, not a hypothetical:

```
src/components/clients/ClientWorkSection.tsx:38   const DEFAULT_FILTERS: WorkFilters = { ...getDateRangePreset('all'), ... }
src/lib/incomeSearch.ts:94                        return { client, status: 'unpaid', ...getDateRangePreset('all') };
```

`getDateRangePreset('all')` is `2000-01-01 … 2100-12-31` (`utils.ts:304-308`), and `incomeSearch.ts:94` is the MUT-83 client-scope link — one click from the Clients index. A client with 2,000 entries means joining 2,000 ids (~40 KB of string) on every settled render.

It is also unnecessary. The store does not need a content key: it only needs two answers, and both are cheap.
- **Did this list see the saved row?** `pending.ids` holds at most two ids, so `ids.includes(pendingId)` with early exit answers it in one scan and zero allocation.
- **Have I already counted this list for this save?** Key the idempotence on **`(listId, saveId)`**, which is O(1). Keying on ids content was wrong anyway: `claimed` is monotonic, so a second report with different ids is harmless to re-evaluate.

**This supersedes the stable-key remedy in Section 2's [P3].** The hook passes the array straight through; no `join`, no `Set`, no content key. Simpler and allocation-free. Necessary implementation of the approved R1c contract; carried, no separate decision.

**No other performance impact.** MUT-81 adds zero queries, zero reads and zero writes to Dexie — it rides invalidations that already happen. The tint is one `background-color` CSS animation on a single `<tr>` for 1.5 s (a paint, not a composite, but one row). The Owed-now tick is ~400 ms of rAF mutating one text node. No N+1, no new indexes, no caching change.

**Unbounded lists — pulled INTO scope by D7.** Those two All Time defaults render every matching row with no pagination or virtualization. CLAUDE.md's guardrail — "Ledger scaling later: pagination or virtualization; default hard cap = This month" — is honoured by `/income`'s own default (`incomeSearch.ts:40`, `DEFAULT_PERIOD = 'this-month'`) but not by the client profile's work list or the client-scope deep link. Originally flagged as pre-existing and out of scope; **D7 → "Build it now in MUT-81"** brings it in. Approach settled as R9 below.

## TODOS / follow-ups

| # | Item | Disposition |
|---|---|---|
| T-a | The two remaining FSI `isolate` copies (`RecurringAttentionList.tsx:25`, `RecurringMarkPaidDrawer.tsx:45`) migrate to the shared `src/lib/utils.ts` helper | TODOS.md entry — owed by the approved D4 scope (R7d), no separate decision |
| T-b | `useMarkIncomePaid` / `useRecordIncomePartialPayment` are dead production code | D6 → **filed in Jira as [MUT-98](https://barmajiyat.atlassian.net/browse/MUT-98)** at the user's direction, rather than TODOS.md |
| T-c | Unbounded All Time lists vs the CLAUDE.md pagination guardrail | D7 → **build it now in MUT-81**; approach in R9 |

## Decision ledger (continued)

### R9: How to bound the two All Time lists, now that D7 put them in scope
Finding: [P3 → promoted by D7], confidence 9/10, `ClientWorkSection.tsx:38` and `incomeSearch.ts:94`, reviewer: native eng review (Section 4)
Plan baseline: out of scope (Section 4 as originally written). D7 reversed that; the *approach* was never settled, and the three candidates differ in whether they change what the user sees.
Runtime evidence: `getDateRangePreset('all')` = `2000-01-01 … 2100-12-31` (`utils.ts:304-308`). `src/components/ui/Pagination.tsx` exists, is exported from the `ui` barrel, and has **zero UI callers** — built and never wired up. `QueryFilters.limit` already threads through `useIncome` → `transactionRepo.list`. No virtualization dependency is installed; `motion@13.4.4` is animation only (ADR-044).
Note: this expansion cuts against D2's rationale (keep the surface small while MUT-82 is live on five shared files). Recorded, not re-litigated — D7 is the user's call.

Comparison grid:

| Choice | Current | A) Paginate with the existing component | B) Cap the default range | C) Virtualize |
|---|---|---|---|---|
| R9 bounding mechanism | none | `Pagination` + `QueryFilters.limit`, both already present | default range becomes This month on both paths | new windowing dependency |
| R9b what the user can still reach | everything, all at once | everything, in pages | this month until they widen the DateRangeControl | everything, windowed |
| R9c product decision required | — | no | **yes** — the client profile stops answering "what did I do for them?" in full by default | no |
| R9d new dependency / ADR | — | none | none | yes — new dep, DECISIONS entry (ADR-044 precedent) |
| R9e reuse | — | wires up a built-but-unused component | reuses `getDateRangePreset` | none |
| R1–R8 | approved as recorded | unchanged | unchanged | unchanged |

State: approved
Actual answer: D8 → **A) Paginate with the existing component**
Accepted scope: R9 — wire `src/components/ui/Pagination.tsx` into `ClientWorkSection` and `IncomePage`, backed by the `QueryFilters.limit` that already reaches `transactionRepo.list`. R9b — everything reachable today stays reachable; no product change. R9d — no new dependency, no ADR. Page size lives in a named constant, not a literal (CLAUDE.md: no magic numbers). Page resets to 1 whenever the filter model changes.
History: Section 4 originally dispositioned this as noted/pre-existing/not-in-scope; D7 reopened it as accepted implementation scope; D8 settled the mechanism.

### R9 ↔ R1 integration: a saved row can land on page 2

Pagination and the after-save flash now interact, and this is the one genuinely new risk the D7 expansion introduced.

Both lists sort `occurredAt desc`. A newly created entry dated today lands on page 1, so the common path is unaffected. But a **back-dated** entry — or an edit to an older one — can land on page 3, where no list can claim it. The flash then correctly reports "not visible" and shows "Saved to … · Show". Show resets the filters and page to 1, and the row still is not there. The user pressed the button that promised to take them to it and arrived somewhere else, with `messaged: true` correctly suppressing a second message. That is a worse failure than the one the ticket set out to fix.

**Required behaviour:** the pagination wiring exposes `ensureVisible(id)`. On arrival with an armed flash, the list resolves which page holds that id under the current sort and filters, and opens that page rather than page 1.

**Bounded fallback:** if `ensureVisible` cannot be answered cheaply from the repository (it needs a count of rows ordered before the id under the active filters), `/eng-build` opens a TECH_DEBT entry and Show falls back to page 1 with the message text still naming the client. It must not loop, must not re-message, and must not silently land on the wrong page without the fallback being recorded.

This is necessary implementation of two already-approved contracts — "Show navigates there with the row highlighted" (AC) and R9's pagination — so it is carried, not re-asked. It is the item to watch during build.

**Approval readiness (first pass): PASS.** R1/R1b/R1c → D3. R2 → D1. R3 → D2. R4/R5/R6 → carried as necessary implementation of acceptance criteria already in the ticket, no separate approval required. R7/R7b/R7c/R7d → D4. R8/R8b/R8c → D5. R9/R9b/R9d → D7 (inclusion) + D8 (mechanism). T-b → D6, filed as MUT-98. No remedy is accepted without its own answer.

---

# Re-review — 2026-10-12, after MUT-82 and MUT-84 merged

Between the design review above and this re-run, `feature/mut-82-home-inline-payment` (`ff6225e`, ADR-055)
and `feature/mut-84-clients-split-view` (`eba9676`, ADR-050) both merged to `main`. Both touch files this
plan touches. Per Recovery routing ("Late change or missing work"), verified against the actual landed
code rather than against the plans that preceded it.

**Numbering re-verified** (`mutaba3a-adr-numbering-trap`: heading grep, not a bare `ADR-0NN` grep):
ADR-057 still free (`ADR-055` is the highest real heading; `ADR-056` is an unclaimed gap). **TD-076 was
taken** by an unrelated craft-fix ticket while this review was in progress — reservation bumped to
**TD-077 / TD-078**.

## 1 (continued). Architecture review — findings from the landed code

**[Reuse, not a defect] `src/lib/motion/presets.ts` already exports `UI_SPRING` and `REDUCED_MOTION_FADE_SECONDS`** (MUT-82). Design decision 7A's "durations become named constants beside the physics" is already done — MUT-81 imports these, it does not invent new ones. Removes work from the design review's D-T2.

**[P2] (confidence: 9/10) `src/lib/motion/rowExit.ts:174` `captureRowExit` is typed for `HTMLTableRowElement` and assumes table semantics (cell-width pinning, sibling rows gliding into a gap) — design decision 3A's currency-block collapse needs the same copy/overlay/animate/fade core for a `<div>` in a flex row, where siblings resize rather than glide.** Resolved as D9.

**[P1] (confidence: 9/10) `src/components/home/HomeNeedsAttention.tsx:97-120` — a full payment's row leaves via `captureRowExit` (ADR-055 §5), and the flash mechanism's "not visible → show a message" rule would otherwise fire a false "Saved to X · Show" directly under a slide-out that already told the complete story.** It only avoids this today by accident: `HomeRecentPayments` (mounted alongside) usually claims the id, but only while the payment is within `useRecentPayments`'s last-10 window — an older client's payment, or a session with 10+ other recent payments, falls outside it and produces the false positive. Resolved as D10.

**[Confirmed, not a new finding] `PartialPaymentDrawer`'s `onRecorded` callback is Home-only** — `grep` confirms `ClientWorkSection.tsx` and `IncomePage.tsx` call `openPartialPaymentDrawer({ transactionId: row.id })` with no `onRecorded` at all. This verifies rather than changes the plan's D3: `markSaved` must live unconditionally inside the drawer, never piggybacked on the optional Home-specific callback `usePaymentUndo` already owns.

**[Confirmed, narrows a prior approval] ADR-055 §6 already implements most of design decision 10A for Home's full-payment path** — `settledAt`/`neighbourAction`/`focusIsLost` fallback chain, tested in a 337-line suite. 10A's three-step chain is still needed, but only for: partial payments on Home (focus never moves, nothing to chain), and every path ADR-055 doesn't cover — the client profile, `/income`, and cross-navigation via Show. No new decision; this narrows D-T5's scope and removes duplicate work from it.

## Decision ledger (continued)

### D9: Reuse MUT-82's row-exit animation for the currency-block collapse, or write a parallel one
Finding: [P2], confidence 9/10, `src/lib/motion/rowExit.ts:174`, reviewer: native eng re-review (Section 1)
Plan baseline: design decision 3A approved "tick to zero, then leaves" with no implementation mechanism named.
Runtime evidence: `rowExit.ts` is 198 lines, typed `HTMLTableRowElement`, with a tested 186-line suite (`rowExit.test.ts`, MUT-82). `copyRow`'s cell-width pinning and `followersOf`/`glideIntoGap`'s sibling-glide are table-specific; `placeOver`, `slideOut`, `fadeOut` operate on any `HTMLElement` already.

Comparison grid:

| Choice | Current | A) Generalize into a shared primitive | B) Separate `blockExit.ts` | C) Drop the collapse animation |
|---|---|---|---|---|
| D9 exit mechanism | none (3A has no implementation) | `captureElementExit` core, `captureRowExit`/`captureBlockExit` thin wrappers | independent copy of the same idea | `display:none` once ticked to zero |
| D9b risk to MUT-82's tests | — | must keep `rowExit.test.ts`'s 186 lines green through the extraction | zero — untouched | zero — untouched |
| D9c future callers (MUT-85 lump-sum payment) | — | get the exit primitive for free | would need a third copy | n/a |
| D9d reopens 3A | — | no | no | yes — undoes 3A's explicit "give the best moment a beat" choice |
| D1–D8 | approved as recorded | unchanged | unchanged | unchanged |

State: approved
Actual answer: D9 → **A) Generalize rowExit into a shared element-exit primitive**
Accepted scope: extract the copy/overlay/animate/fade core into `captureElementExit(element, container)` for any `HTMLElement`; `captureRowExit` becomes a thin wrapper adding cell-width pinning and sibling glide; a new thin `captureBlockExit` (or equivalent) in `src/lib/motion/blockExit.ts` serves 3A's flex-row currency blocks, where siblings resize via CSS transition rather than a JS glide. `rowExit.test.ts`'s existing 186 lines must stay green through the extraction — a build-time regression gate, not a new test requirement.
History: —

### D10: Stop a false "Saved to X · Show" from firing when a Home payment correctly removes its own row
Finding: [P1], confidence 9/10, `src/components/home/HomeNeedsAttention.tsx:97-120`, reviewer: native eng re-review (Section 1)
Plan baseline: design decision 2A (Show never dead-ends) and eng D3 (list-reported settled) did not anticipate a row whose *correct, expected* absence should never be reported as "not visible."
Runtime evidence: ADR-055 §5's `captureRowExit` fires exactly when `record.amountMinor >= leftMinor` (`HomeNeedsAttention.tsx:98-104`), the same branch that already drives focus-chain and slide-out. `useRecentPayments` is capped at the last 10 (confirmed in Section 1 of the first eng review); a payment outside that window has no mounted list that can claim it.

Comparison grid:

| Choice | Current | A) rowExit-settled saves skip the flash | B) Rely on HomeRecentPayments | C) Suppress the message on all of Home |
|---|---|---|---|---|
| D10 trigger | implicit (relies on list intersection) | explicit: the branch that fires `captureRowExit` does not call `markSaved` | none — implicit | route-level suppression |
| D10b false-positive risk | present, bounded only by the last-10 window | eliminated by construction | present or bounded by the last-10 window | eliminated, over-broad |
| D10c cost to a genuinely useful Home message (e.g. a stale-filter income save) | — | none — only the rowExit branch is affected | none | **lost** — silences a case this ticket exists to cover |
| D1–D9 | approved as recorded | unchanged | unchanged | unchanged |

State: approved
Actual answer: D10 → **A) rowExit-settled saves skip the flash mechanism entirely**
Accepted scope: in `HomeNeedsAttention.tsx`'s `onRecordPayment` handler, the full-settle branch (`record.amountMinor >= leftMinor`) — the same branch ADR-055 §5/§6 already guards — does not call `markSaved`. The partial-payment branch (row stays) still calls it, and every payment recorded from `ClientWorkSection`, `ClientPaymentsSection` or `IncomePage` is unaffected.
History: —

## 3 (continued). Test review — the landed code's regression surface

`rowExit.test.ts` (186 lines, MUT-82) and `HomeNeedsAttention.test.tsx` (337 lines, MUT-82) are the two
suites D9/D10's implementation must keep green, not extend speculatively — per the Test value bar, a
behavior-preserving extraction is proven by the existing suite passing, not by a new near-duplicate test.
New coverage this re-review requires:

- `captureElementExit`/`captureRowExit`/`captureBlockExit`: one unit test proving `captureRowExit`'s output
  is unchanged pre/post-extraction (same cell-width pinning, same glide), plus new unit tests for
  `captureBlockExit` (flex sibling resize, reduced-motion fade, no layout → nothing captured).
- `HomeNeedsAttention`, full payment: **no** `markSaved` call — assert via a spy that `savedFlashStore.markSaved`
  is never invoked when `record.amountMinor >= leftMinor`, alongside the existing slide-out assertions.
- `HomeNeedsAttention`, partial payment: `markSaved` **is** called, row tints (unaffected by D10).
- Integration: a payment outside `useRecentPayments`'s last-10 window, recorded from Home as a full payment
  — assert no "Saved to X · Show" message appears (the regression D10 exists to prevent; this is the one
  case the pre-D10 design would have gotten wrong).

## 4 (continued). Performance review — the landed code

No new finding. D9A's extraction is a refactor of existing animation code (same cost, same call graph);
D10A removes a `markSaved` call on one branch, which is strictly less work than the plan had before.

**Approval readiness (re-review): PASS.** D9 and D10 each cite their own answer above; D1–D8 carried unchanged (no new evidence reopened them).

## NOT in scope

- **Expense, retainer and recurring drawers' after-save feedback** — the ticket scopes R1 to income and payments. Deferred because widening it would change which ACs apply.
- **The hosted portal** — it has its own `Drawer` and component tree (`src/hosted/`); MUT-91 owns porting R1 there.
- **The two remaining FSI `isolate` copies** in `RecurringAttentionList.tsx:25` and `RecurringMarkPaidDrawer.tsx:45` — D4 chose the narrower migration, so these stay and carry a TODOS.md entry.
- **Deleting the dead mark-paid hooks** — filed as **MUT-98** (Jira), done.
- **Virtualization** — D8 chose pagination, so no new dependency and no ADR.
- **MUT-82's toast `group`, Undo and row-exit animation** — landed as ADR-055. MUT-81 reuses the motion primitives (D9) and skips the flash mechanism entirely for the one branch ADR-055 already completes (D10); it never touches `PAYMENT_UNDO_GROUP` or the Undo flow itself.
- **MUT-84's split view** — `ClientsLayout.css` gives the profile column `flex: 1; min-width: 0` beside a fixed 22.5rem list column, so at common desktop widths the profile column stays well above the 9A breakpoint. Not reopening Pass 6; noted as a build-time check, not a design gap.

## What already exists

Reused as-is, not rebuilt:

| Existing | Used for |
|---|---|
| `Toast` / `ToastContainer` (`ToastContainer.tsx:43`) | the "Saved to … · Show" message — already `role="status"`, `aria-live="polite"`, already supports `{ action: { label, onClick } }`. No new message component |
| `--accent-subtle` (`theme.css:120`, `:256`) | the row tint, defined in both light and dark |
| `usePrefersReducedMotion` | the reduced-motion branch for the tint and the tick |
| `useProfileStore` (`profileStore.ts:35`) | Show's profile switch — the raw store, deliberately not the guarded `useActiveProfile` wrapper |
| `useIncomeFilters` / `mergeIncomeSearch` (MUT-83) | Show's filter reset on `/income` |
| `src/lib/utils.ts:61` `BIDI_MARKS` | establishes `utils.ts` as the bidi home for the extracted `isolate()` |
| **`src/components/ui/Pagination.tsx`** | **built, exported from the `ui` barrel, zero UI callers.** D8 wires it up rather than writing new paging |
| `QueryFilters.limit` | already threads `useIncome` → `transactionRepo.list`; pagination needs no repository change |

Genuinely new, because nothing comparable exists (verified by grep — the only `highlight` in `src/` is `EntityTypeahead`'s keyboard cursor): the flash store and its claim mechanism, and the Owed-now tick.

## Failure modes

| # | Path | Realistic production failure | Covered by | What the user sees |
|---|---|---|---|---|
| F1 | resolve | spurious "Saved to X · Show" on the page the row is already on | D3's settled-report + integration test on the client profile's two lists | a wrong but harmless toast — visible, not silent |
| F2 | backstop | save from `/settings` or `/expenses` via + Add, no list registers | explicit test; this is a load-bearing path, not a safety net | the message, which is correct |
| F3 | Show → profile | the switch no-ops because the profiles query had not loaded | raw store (D4/R4) + cross-profile integration test | lands on an empty list — visible |
| F4 | Show → page | **back-dated row sits on page 2+; Show opens page 1** | `ensureVisible(id)` required; bounded fallback with a TECH_DEBT entry if it cannot be answered cheaply | **silent if the requirement is skipped** — the user arrives on the wrong page and no second message fires. Required test + required fallback, so not a critical gap as planned. The one thing to watch during build |
| F5 | tint clock | the 1.5 s tint expires during a slow route change | D5 — the clock starts on first render, `rearm` restarts it | no tint on arrival; still the right page — degrades visibly |
| F6 | i18n | Arabic client name reverses inside the message | R7b's FSI migration + R8b's strong-RTL-initial test | reversed text — visible |

**Critical gaps flagged: 0.** Every failure mode has a test or visible error handling. F4 is the only one that *becomes* silent if its requirement is dropped, which is why it carries both a required assertion and a required recorded fallback.

## Worktree parallelization strategy

| Step | Modules touched | Depends on |
|------|----------------|------------|
| 1. Flash core (store, hook, announcer) | `src/lib`, `src/hooks`, `src/components/layout` | — |
| 2. `isolate()` extraction + Owed-now tick | `src/lib/utils`, `src/components/clients` | — |
| 3. Pagination wiring | `src/components/clients`, `src/pages/income` | 2 (shares `components/clients`) |
| 4. Drawer `markSaved` wiring | `src/components/drawers` | 1 |
| 5. List wiring + announcer mount + i18n + CSS | `src/components/{home,clients}`, `src/pages/income`, `src/components/layout`, `src/lib/i18n` | 1, 3 |

**Parallel lanes:** `Lane A: step 1 → step 4` · `Lane B: step 2 → step 3 (shared src/components/clients)`.
**Execution order:** Launch A + B. Merge both. Then step 5.
**Conflict flags:** `src/components/clients` is shared by steps 2, 3 and 5 — keep it in one lane. `src/components/drawers` and `src/components/home` collide with the live `feature/mut-82-home-inline-payment` worktree; **land MUT-82 first and merge main in before step 4 or step 5 starts.**

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific
finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~3h / CC: ~20min)** — savedFlash core — Build the store on list-reported settled renders, not a global fetch counter
  - Surfaced by: Architecture review — [P1] plan D3 + `src/hooks/useQueries.ts:246`, resolved by D3
  - Files: `src/lib/savedFlashStore.ts`, `src/hooks/useSavedFlash.ts`
  - Verify: `npm run test:run -- savedFlash` — claim, resolve-claimed vs unclaimed, second save replaces first, idempotent per `(listId, saveId)`, backstop fires with zero registered lists
- [ ] **T2 (P1, human: ~2h / CC: ~15min)** — Show navigation — Resolve the flashed row's page before navigating
  - Surfaced by: R9 ↔ R1 integration — F4, the one path that goes silent if skipped
  - Files: `src/components/layout/SavedFlashAnnouncer.tsx`, `src/components/clients/ClientWorkSection.tsx`, `src/pages/income/IncomePage.tsx`
  - Verify: integration test — back-date an entry on a multi-page client, press Show, assert the opened page contains the tinted row; if `ensureVisible` is not cheap, assert the fallback and open a TECH_DEBT entry
- [ ] **T3 (P2, human: ~45min / CC: ~5min)** — Show profile switch — Use the raw `useProfileStore`, never the `useActiveProfile` wrapper
  - Surfaced by: Architecture review — [P2] `src/hooks/useActiveProfile.ts:83-88` silently refuses an unloaded id
  - Files: `src/components/layout/SavedFlashAnnouncer.tsx`
  - Verify: integration test — save into profile B while profile A is active, press Show, assert the active profile changed and the row is tinted
- [ ] **T4 (P2, human: ~30min / CC: ~5min)** — Tint lifetime — Start the 1.5 s clock on first render and restart it on `rearm`
  - Surfaced by: Architecture review — [P2] plan D5
  - Files: `src/lib/savedFlashStore.ts`
  - Verify: fake-timer unit test — press Show 4 s after the message, assert the tint is present on arrival
- [ ] **T5 (P2, human: ~45min / CC: ~5min)** — bidi — Export `isolate()` (FSI) from `src/lib/utils.ts`, migrate `OwedNowSummary` off LRI
  - Surfaced by: Code quality review — [P2] four copies, two codepoints; resolved by D4
  - Files: `src/lib/utils.ts`, `src/components/clients/OwedNowSummary.tsx`, `src/components/layout/SavedFlashAnnouncer.tsx`
  - Verify: `npm run test:run -- OwedNowSummary` — `:65` expects U+2068, renamed per D5, plus the strong-RTL-initial case
- [ ] **T6 (P2, human: ~1 day / CC: ~45min)** — Pagination — Wire the existing `Pagination` into `ClientWorkSection` and `IncomePage`
  - Surfaced by: Performance review — unbounded All Time lists; pulled in by D7, mechanism set by D8
  - Files: `src/components/clients/ClientWorkSection.tsx`, `src/pages/income/IncomePage.tsx`
  - Verify: page size from a named constant; filter change resets to page 1; `npm run test:run` + the e2e list specs
- [ ] **T7 (P2, human: ~1h / CC: ~10min)** — Flash carries the client name — Capture `clientName` at save time instead of querying at resolve time
  - Surfaced by: Test review — untraced branch, a pending `useClient` leaves the message with a blank name
  - Files: `src/lib/savedFlashStore.ts`, `src/components/drawers/IncomeDrawer.tsx`, `src/components/drawers/PartialPaymentDrawer.tsx`
  - Verify: unit test — the message names the client with no client query mounted
- [ ] **T8 (P3, human: ~20min / CC: ~3min)** — savedFlash core — Drop the `ids.join('|')` key; intersect directly and key idempotence on `(listId, saveId)`
  - Surfaced by: Performance review — [P3] O(N) allocation on All Time lists
  - Files: `src/hooks/useSavedFlash.ts`, `src/lib/savedFlashStore.ts`
  - Verify: unit test asserts no content key is built; a 2,000-row list reports settled without allocating a joined string
- [ ] **T9 (P3, human: ~10min / CC: ~2min)** — TODOS.md — Record the two remaining FSI `isolate` copies
  - Surfaced by: D4 accepted scope R7d
  - Files: `TODOS.md`
  - Verify: entry names `RecurringAttentionList.tsx:25` and `RecurringMarkPaidDrawer.tsx:45`

## Unresolved decisions

None. D1–D8 are all answered and recorded.

## Suppressed findings (appendix — below the confidence bar)

- **(confidence: 4/10) `IncomeDrawer.tsx:332-334` — `markSaved` on a create could read an id off a falsy result.** The existing code guards with `if (duplicateFromId && newTx)`, which reads as distrust of the return value. Verified against the source: `transactionRepo.create` is `Promise<Transaction>` (`repository.ts:348`) and `paymentRecordRepo.create` is `Promise<PaymentRecord>` (`interfaces.ts:331`), both non-nullable, so the existing guard is defensive rather than load-bearing. Suppressed from the main report. Build note only: write the flash as `if (newTx?.id)` so a save that succeeded can never surface as a failure through a TypeError in the success path.

## Completion summary

- Step 0: Scope Challenge — **scope accepted as-is** (later expanded by D7/D8, which is an addition, not a reduction)
- Architecture Review: **4** issues found
- Code Quality Review: **3** issues found
- Test Review: diagram produced, **31** gaps identified
- Performance Review: **1** issue found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: **3** items proposed to user (1 → TODOS.md, 1 → Jira MUT-98, 1 → built in this ticket)
- Failure modes: **0** critical gaps flagged
- Unresolved decisions: **0** in this review
- Outside voice: provider codex, **unavailable** — not installed; the native subagent fallback was not run because this session's operating instructions bar Agent dispatch unless the user asks, and a skill cannot grant itself that exception
- Parallelization: **2** lanes, **2** parallel / **1** sequential
- Lake Score: **5/7** = answers picking a 10/10 option (D1, D3, D5, D7, D8) / answers scored for Completeness (D1, D3, D4, D5, D6, D7, D8). D2 carried a kind-note, not a score.

# Design review — `/plan-design-review`

**Target:** this plan · 2026-10-12 · branch `main` @ `17045fa` · no `DESIGN.md`; calibrated against `src/styles/theme.css` (canonical since TD-011) and epic MUT-74's brief.
**Visual artifact:** `.claude/designs/mut-81-after-save-wireframe.html` — HTML state wireframe built from the real tokens, at the user's request in place of generated mockups. Theme and reduced-motion toggles, tint replay, and the competing message treatments side by side.

## Approved design decisions

| # | Decision |
|---|---|
| **1A** | **The row leads, the figure follows.** The tint starts immediately; the Owed-now tick begins ~120 ms later and resolves inside the tint's window. Cause before consequence — the two no longer compete for the eye. |
| **2A** | **Show never dead-ends.** If the row still is not on screen after Show, the message persists and renames itself to locate the row: "Furniture Co. · Catalogue photography · 28 Sep — page 3 of 7", and pressing it again jumps there. Degrades to naming the date when the position cannot be resolved. This is the design counterpart of eng failure mode F4. |
| **3A** | **A cleared currency gets a beat.** A currency reaching zero ticks down, holds, then its block collapses out; a new currency fades in and ticks up from zero. Clearing the last one resolves into "Nothing owed" rather than swapping to it. |
| **4A** | **Repetition is answered once, not every time.** The second consecutive save landing outside the current filter replaces the per-save message with one persistent line — "2 entries saved outside this filter — Show all" — counting up and staying until dismissed or the filter changes. |
| **5B** | **The message is an anchored strip, not a floating toast.** It sits in flow directly above the list it describes, `--accent-subtle` on an `--accent-muted` border. Honours brief decision A1 ("Nothing floats over content"), which MUT-79 shipped, and has the width to say *why* the row is missing. |
| **6A** | **Two subjects plus a reason clause.** "Income saved to {client}" / "Payment recorded for {client}", create and edit collapsed, plus a closed reason set: "— outside this filter", "— in {business}", "— page {n}". Action stays "Show". |
| **7A** | **One motion vocabulary: `motion` + `physics.ts`.** Tint, tick, 1A's stagger, 3A's collapse and 5B's strip all animate through `motion@13.4.4` and `springFromResponse`, per ADR-044 §4/§7 — whose Consequences already earmarked those physics for "the payment and after-save stories". Reduced motion follows ADR-044 §5: the tint still holds (the ticket's AC), then leaves on a 150 ms cross-fade instead of vanishing. Durations become named constants beside the physics. |
| **8A** | **Tint plus a leading rail.** The `--accent-subtle` wash is joined by a 3 px inline-start rail in solid `--accent` (inset box-shadow) that holds the full window. The wash alone was indistinguishable from the 15 existing `--accent-subtle` selected states and too faint to catch peripherally. Logical edge, so it mirrors in RTL. |
| **9A** | **Two lines below ~480 px.** Wide: message inline-start, Show inline-end. Narrow: subject and client on line one (client may ellipsis), reason on line two in `--muted` at `--text-sm`, Show full-width beneath at 44 px. Height bounded at two rows plus the button. |
| **10A** | **Focus follows the save.** Chain: original trigger if it still exists → the saved row itself (focusable for this purpose) → the strip's Show button. Must be reconciled with MUT-82's D12, which defines its own chain for a row leaving Needs attention. |
| **11A** | **Pagination spec.** Page size 50 as a named constant. Control inside the card below the table, separated by a `--border-subtle` rule: "1–50 of 312" inline-start, prev/next at 44 px inline-end. Hidden entirely at one page. Any filter change resets to page 1. |

Carried as mechanics of the above, no separate decision: the strip is the live region (`role="status" aria-live="polite"`) carrying the full 6A message, while the claimed path keeps a separate visually-hidden polite "Saved" so the two paths never both announce; the strip's dismiss is a 44 px × at the inline end, matching the existing `income-scope-chip-clear` pattern; the client name inside the strip uses the shared FSI `isolate()` from eng-review D4; and a first-ever entry replaces the `EmptyState` with one tinted row.

## Information hierarchy — the after-save moment

```
  t=0ms     drawer springs out along its own edge          (ADR-044 §2, unchanged)
  t=0ms     ROW: rail appears + wash at full strength      <- FIRST. the subject.
  t=120ms   FIGURE: Owed now begins counting               <- SECOND. the consequence.
  t≤1500ms  wash fades to transparent, rail holds
  t=1500ms  rail leaves (150ms cross-fade under reduced motion)

  if the row was never on screen:
  t=settle  STRIP appears above the list, in flow          <- FIRST. it owns the moment.
            "Income saved to Furniture Co. — outside this filter"   [Show] [×]
            2nd consecutive off-screen save -> collapses to the 4A counter
```

## Interaction state table

| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Row tint + rail | n/a (local write) | first entry replaces `EmptyState`; the single row carries it | save error uses the existing error toast | 1A staged, 8A rail | partial payment keeps the row, tint still fires |
| Strip | n/a | n/a | n/a | 6A subject + reason | 4A counter from the 2nd consecutive off-screen save |
| Strip after Show | n/a | n/a | row still not visible → 2A locator, never silence | dismisses on arrival when the row is visible | 2A degrades to naming the date |
| Owed-now tick | holds the previous figure | "Nothing owed" | n/a | 1A, +120 ms | 3A: block collapses out / fades in |
| Pagination | n/a | hidden at one page | n/a | 11A, "1–50 of 312" | filter change resets to page 1 |

## NOT in scope

- **Expense, retainer and recurring drawers** — the ticket scopes R1 to income and payments; applying the strip there is a separate design pass.
- **The hosted portal** — MUT-91 owns porting these decisions; it has its own `Drawer` and component tree.
- **Replacing `Toast` app-wide** — 5B introduces the anchored strip for *this* message only. Whether other transient messages should follow is a bigger question than this ticket.
- **Tablet and intermediate widths** — 9A specifies one breakpoint at ~480 px. Anything between that and desktop inherits the wide layout untested.
- **`--duration` / `--ease` tokens in `theme.css`** — 7A routes motion constants to `physics.ts`, which is where ADR-044 already put them. No token debt created, so no cleanup owed.

## What already exists

| Existing | Used for |
|---|---|
| `src/styles/theme.css` | every colour and spacing value in these decisions; `--accent-subtle`, `--accent-muted`, `--accent`, `--muted`, `--text-sm`, `--border-subtle` all already defined in both themes |
| `src/lib/motion/physics.ts` + `motion@13.4.4` | 7A's entire motion vocabulary — ADR-044 built it and named this ticket as its consumer |
| `src/components/ui/Pagination.tsx` | 11A — built, exported, zero callers until now |
| `income-scope-chip-clear` (`IncomePage`) | the strip's dismiss affordance pattern |
| `isolate()` (eng-review D4, `src/lib/utils.ts`) | the client name inside the strip |
| `EmptyState` | the first-entry transition |
| `Toast` / `ToastContainer` | **no longer used by this ticket** — 5B replaces it with the anchored strip. It stays for error messages, which legitimately interrupt. |

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific
finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **D-T1 (P1, human: ~1.5 days / CC: ~1h)** — SavedFlashStrip — Build the anchored strip component (5B, 6A, 9A, 4A)
  - Surfaced by: Pass 4 — the floating toast contradicts brief decision A1, shipped by MUT-79
  - Files: `src/components/ui/SavedFlashStrip.tsx` + `.css`, `src/components/layout/SavedFlashAnnouncer.tsx`, `src/lib/i18n/translations/{en,ar}.json`
  - Verify: renders in flow above the list; two-line layout below 480 px; 44 px targets; `role="status"`; 6A subject and reason strings present in en and ar
- [ ] **D-T2 (P1, human: ~1 day / CC: ~45min)** — motion — Route tint, tick, stagger, collapse and strip through `motion` + `physics.ts` (7A)
  - Surfaced by: Pass 5 — ADR-044 §4/§7 and its Consequences name this ticket
  - Files: `src/lib/motion/`, `src/lib/savedFlashStore.ts`, `src/components/clients/OwedNowSummary.tsx`, `src/index.css`
  - Verify: no CSS keyframe and no hand-rolled rAF remain; reduced motion holds the tint then cross-fades in 150 ms per ADR-044 §5
- [ ] **D-T3 (P1, human: ~4h / CC: ~20min)** — SavedFlashStrip — Implement the 2A locator state so Show never dead-ends
  - Surfaced by: Pass 2 — the design counterpart of eng failure mode F4
  - Files: `src/components/ui/SavedFlashStrip.tsx`, `src/lib/savedFlashStore.ts`
  - Verify: back-date an entry on a multi-page client, press Show, assert the strip persists and names the page or the date
- [ ] **D-T4 (P2, human: ~3h / CC: ~20min)** — OwedNowSummary — Currency block enter and collapse with the tick (3A)
  - Surfaced by: Pass 2 — a save can make a whole block appear or vanish
  - Files: `src/components/clients/OwedNowSummary.tsx`
  - Verify: clearing the last receivable in a currency ticks to zero, holds, collapses, and resolves into "Nothing owed"
- [ ] **D-T5 (P2, human: ~2h / CC: ~15min)** — focus — Implement the 10A focus chain and reconcile it with MUT-82's D12
  - Surfaced by: Pass 6 — ADR-044 §6 returns focus to a trigger that may no longer exist
  - Files: `src/components/layout/SavedFlashAnnouncer.tsx`, `src/components/home/HomeNeedsAttention.tsx`
  - Verify: keyboard-only run — full payment from a row, assert focus lands on the row or the Show button, never on `<body>`
- [ ] **D-T6 (P2, human: ~45min / CC: ~10min)** — row tint — Add the 8A leading rail
  - Surfaced by: Pass 5 — the wash alone is identical to 15 existing selected states
  - Files: `src/index.css`
  - Verify: rail renders on the inline start, mirrors under `dir="rtl"`, holds the full window while the wash fades
- [ ] **D-T7 (P2, human: ~4h / CC: ~25min)** — pagination — Apply the 11A visual spec to both lists
  - Surfaced by: Pass 7 — D7/D8 added pagination with no visual specification
  - Files: `src/components/clients/ClientWorkSection.tsx`, `src/pages/income/IncomePage.tsx`, `src/index.css`
  - Verify: page size is a named constant; control hidden at one page; filter change resets to page 1; 44 px targets at 375 px

## TODOS.md updates

None. No decision was deferred, and the only debt this review could have created — motion durations with no token home — is resolved by 7A routing them to `physics.ts`, where ADR-044 already keeps the project's motion constants.

## Completion Summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | no DESIGN.md; theme.css + MUT-74 brief      |
  | Step 0               | 4/10 initial; all 7 dimensions, wireframes  |
  | Pass 1  (Info Arch)  |  5/10 →  10/10 after fixes                  |
  | Pass 2  (States)     |  4/10 →  10/10 after fixes                  |
  | Pass 3  (Journey)    |  3/10 →   9/10 after fixes                  |
  | Pass 4  (AI Slop)    |  6/10 →  10/10 after fixes                  |
  | Pass 5  (Design Sys) |  4/10 →  10/10 after fixes                  |
  | Pass 6  (Responsive) |  3/10 →   9/10 after fixes                  |
  | Pass 7  (Decisions)  | 1 resolved, 0 deferred (2 closed as mechanics)|
  +--------------------------------------------------------------------+
  | NOT in scope         | written (5 items)                           |
  | What already exists  | written                                     |
  | TODOS.md updates     | 0 items proposed                            |
  | Approved Mockups     | 0 generated — HTML wireframe instead        |
  | Decisions made       | 11 added to plan                            |
  | Decisions deferred   | 0                                           |
  | Overall design score |  3/10 →   9/10                              |
  +====================================================================+
```

Overall is the lowest rated pass: 3/10 before (Passes 3 and 6), 9/10 after (Passes 3 and 6).
Pass 3 holds at 9 because the 4A counter's behaviour across sessions and reloads is unspecified.
Pass 6 holds at 9 because 9A defines one breakpoint, leaving tablet widths on the inherited wide layout, and the rail's dark-mode contrast is unverified against a rendered surface.

## Implementation Tasks — consolidated after the 2026-10-12 re-review

**Supersedes** the eng review's T1–T9 and the design review's D-T1–D-T7 above: those two lists were written
nine minutes apart against a codebase that then moved twice (MUT-82, MUT-84 merged). This is the one list
to build from. Historical lists are kept for the record, not for building.

- [ ] **F1 (P1, human: ~3h / CC: ~20min)** — savedFlash core — Build the store on list-reported settled renders, not a global fetch counter (supersedes T1)
  - Surfaced by: Architecture review [P1] — `useIsFetching()` races TanStack invalidation (TanStack/query#11526)
  - Files: `src/lib/savedFlashStore.ts`, `src/hooks/useSavedFlash.ts`
  - Verify: claim/resolve/idempotent-per-(listId,saveId); backstop fires with zero registered lists
- [ ] **F2 (P1, human: ~1 day / CC: ~45min)** — motion — Generalize `rowExit.ts` into `captureElementExit` + thin `captureRowExit`/`captureBlockExit`; route the tint, tick, stagger and strip through the already-exported `UI_SPRING`/`REDUCED_MOTION_FADE_SECONDS` (supersedes T5 and design D-T2; the constants no longer need inventing — they exist in `presets.ts`)
  - Surfaced by: this re-review D9 — `rowExit.ts` is a tested, table-typed exit primitive MUT-82 already shipped
  - Files: `src/lib/motion/rowExit.ts`, `src/lib/motion/blockExit.ts` (new), `src/lib/savedFlashStore.ts`, `src/components/clients/OwedNowSummary.tsx`
  - Verify: `rowExit.test.ts`'s existing 186 lines stay green through the extraction; new `blockExit` unit tests
- [ ] **F3 (P1, human: ~2h / CC: ~15min)** — Home — Full-payment branch must not call `markSaved` (new — supersedes nothing, this risk didn't exist before MUT-82 landed)
  - Surfaced by: this re-review D10 — a row that correctly leaves via `captureRowExit` must not be reported as "not visible"
  - Files: `src/components/home/HomeNeedsAttention.tsx`
  - Verify: spy-assert `markSaved` is never called in the `record.amountMinor >= leftMinor` branch; integration test for a payment outside `useRecentPayments`'s last-10 window
- [ ] **F4 (P1, human: ~1.5 days / CC: ~1h)** — SavedFlashStrip — Build the anchored strip (5B, 6A, 9A, 4A, 2A) (supersedes D-T1 and D-T3)
  - Surfaced by: Design Pass 4 — the floating toast contradicts brief decision A1
  - Files: `src/components/ui/SavedFlashStrip.tsx` + `.css`, `src/components/layout/SavedFlashAnnouncer.tsx`, `src/lib/i18n/translations/{en,ar}.json`
  - Verify: two-line layout below 480 px; 44 px targets; `role="status"`; back-dated-row locator state; repeat-save counter
- [ ] **F5 (P1, human: ~2h / CC: ~15min)** — Show navigation — Resolve the flashed row's page before navigating; switch profile via the raw store (supersedes T2, T3)
  - Surfaced by: eng F4 failure mode + `useActiveProfile.ts:83-88`'s silent-refusal guard
  - Files: `src/components/layout/SavedFlashAnnouncer.tsx`
  - Verify: back-dated entry on a multi-page client → Show opens the containing page; cross-profile save → Show switches profile
- [ ] **F6 (P2, human: ~2h / CC: ~15min)** — focus — Implement the narrowed 10A chain for client profile / `/income` / cross-navigation **only** — Home's full-payment path is already ADR-055 §6 (supersedes D-T5, scope reduced)
  - Surfaced by: this re-review — ADR-055 §6 already solves the Home case more precisely than 10A's generic chain
  - Files: `src/components/layout/SavedFlashAnnouncer.tsx`
  - Verify: keyboard-only run on the client profile and `/income`; Home's existing focus tests untouched
- [ ] **F7 (P2, human: ~3h / CC: ~20min)** — OwedNowSummary — Currency block enter/collapse via `blockExit` + tick (3A) (supersedes D-T4)
  - Surfaced by: Design Pass 2 — a save can make a whole currency block appear or vanish
  - Files: `src/components/clients/OwedNowSummary.tsx`
  - Verify: clearing the last receivable in a currency ticks to zero, holds, collapses, resolves into "Nothing owed"
- [ ] **F8 (P2, human: ~45min / CC: ~5min)** — bidi — Export `isolate()` (FSI) from `utils.ts`, migrate `OwedNowSummary` off LRI (supersedes T5-bidi, D-T nothing — new in design but same work as eng T5)
  - Surfaced by: Code quality [P2] — four copies, two codepoints; regression contract D5
  - Files: `src/lib/utils.ts`, `src/components/clients/OwedNowSummary.tsx`, `src/components/ui/SavedFlashStrip.tsx`, `OwedNowSummary.test.tsx`
  - Verify: `:65` expects U+2068, renamed; strong-RTL-initial case added
- [ ] **F9 (P2, human: ~1 day / CC: ~45min)** — pagination — Wire `Pagination` into `ClientWorkSection` and `IncomePage` per the 11A spec (supersedes T6 and D-T7)
  - Surfaced by: Performance review — unbounded All Time lists; D7 (scope)/D8 (mechanism)/11A (visual spec)
  - Files: `src/components/clients/ClientWorkSection.tsx`, `src/pages/income/IncomePage.tsx`, `src/index.css`
  - Verify: page size 50 as a named constant; hidden at one page; filter change resets to page 1; 375px targets
- [ ] **F10 (P2, human: ~1h / CC: ~10min)** — Flash carries the client name at save time, not a query at resolve time (supersedes T7)
  - Surfaced by: Test review — untraced branch, a pending `useClient` leaves the message blank
  - Files: `src/lib/savedFlashStore.ts`, `src/components/drawers/IncomeDrawer.tsx`, `src/components/drawers/PartialPaymentDrawer.tsx`
  - Verify: message names the client with no client query mounted
- [ ] **F11 (P3, human: ~20min / CC: ~3min)** — savedFlash core — Derive `settled` from the query result inside the hook; no content key, direct id intersection (supersedes T8)
  - Surfaced by: Performance [P3] — `ids.join('|')` allocates on every settled render of an unbounded list
  - Files: `src/hooks/useSavedFlash.ts`
  - Verify: unit test asserts no joined-string key is built; idempotent per `(listId, saveId)`
- [ ] **F12 (P3, human: ~10min / CC: ~2min)** — TODOS.md — Record the two remaining FSI `isolate` copies (supersedes T9)
  - Surfaced by: D4 accepted scope R7d
  - Files: `TODOS.md`

_No new tasks from Performance review (re-review pass) — D9/D10 reduce work rather than adding it._

## Design artifacts

| Screen/Section | Artifact | Direction | Notes |
|---|---|---|---|
| After-save states, all paths | `.claude/designs/mut-81-after-save-wireframe.html` | Anchored strip over floating toast; tint plus leading rail; staged motion | Built from real `theme.css` tokens. Carries light/dark, reduced motion, 375 px and the pagination treatment. No AI mockups generated — user chose HTML wireframes. |

## Unresolved Decisions

None. All 11 issues raised in this review were individually decided.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex via `/plan-eng-review` + design voices | Independent 2nd opinion | 9 | UNAVAILABLE | not installed; native fallback not dispatched (session policy) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 8 | ISSUES OPEN | 41 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 3 | CLEAR | score: 3/10 → 9/10, 11 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review and design phases, **unavailable** on both, re-checked this run. The CLI is not installed, and the native in-host fallback was not dispatched because this session forbids Agent spawning without an explicit user request. No outside findings exist for this plan in either phase. Missing coverage, not a clean result.
- **RE-REVIEW NOTE (2026-10-12):** `feature/mut-82-home-inline-payment` (ADR-055) and `feature/mut-84-clients-split-view` (ADR-050) merged to `main` between the design review and this eng re-run. Verified against the landed code, not the plans that preceded it: two new findings (D9 — reuse MUT-82's row-exit animation rather than writing a parallel one; D10 — a row that correctly leaves Home via `captureRowExit` must not be reported by the flash mechanism as "not visible", which the prior design would have gotten wrong for a payment outside `useRecentPayments`'s last-10 window), both resolved. One prior decision (design 10A, focus chain) narrowed — ADR-055 §6 already solves it for Home's full-payment path. ADR/TD numbering re-verified: **ADR-057** still free; **TD-076 was taken** by an unrelated ticket mid-review, reservation moved to **TD-077/078**. The three partial task lists (eng T1–T9, design D-T1–D-T7) are superseded by the consolidated **F1–F12** list in this plan's final "Implementation Tasks" section — build from that one.
- **VERDICT:** ENG + DESIGN REVIEWED, ISSUES OPEN — 41 findings across both reviews, 2 added and resolved in this re-run, 0 critical gaps, 0 unresolved decisions. Not CLEAR (eng review is required and currently issues-open by definition of having mapped tasks); ready to build against the consolidated F1–F12 list. Re-run `/plan-eng-review` again only if the branch moves further before `/eng-build` starts — check `git log --oneline -5` against this report's commit first.

NO UNRESOLVED DECISIONS


