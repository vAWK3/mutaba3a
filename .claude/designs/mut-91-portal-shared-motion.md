# MUT-91 — Hosted portal: press feedback, spring drawers, after-save for expenses

**Ticket:** MUT-91 (epic MUT-74). The Brand v2 re-cut on the ticket governs.
**Brief:** `.claude/designs/landing-apple-redesign.md`, decisions HP1, L10, R1 and R2.
**Blocker:** MUT-102 (Done).
**Status when planned:** Backlog. Planned 2026-10-14.

## 1. Problem and acceptance criteria

The hosted portal is a separate build, so the epic's shared interaction decisions don't reach it automatically. After the Brand v2 re-cut, MUT-91 still owns three of them:

- **L10, press feedback:** buttons press in on pointer-down. The numbers come from the MUT-102 motion tokens: `--press-scale` 0.96 and `--duration-press` 120ms. Reduced motion already sets these to 1 and 0ms.
- **R2, spring drawers.**
- **R1, after-save feedback for expenses.** Hosted income is read-only.

The type pairing (L11) and the wordmark were moved to MUT-102 and MUT-104.

**Acceptance criteria (from the ticket):**
1. The portal reuses the shared Drawer and the after-save mechanism rather than copying them.
2. `test:bundles` confirms nothing local-only leaks into the hosted bundle, and vice versa.
3. The MUT-43 auth-state tests still pass unchanged.

## 2. What the code already does (verified 2026-10-14 on main 8b07277)

| Decision | State today | Remaining work |
|---|---|---|
| R2 spring drawers | **Done by MUT-80.** `src/hosted/components/Drawer.tsx` renders the shared `components/ui/drawer/DrawerFrame`. `ExpenseDrawer` and `ConversionDrawer` both use it. | A guard test only. |
| L10 press feedback | **Not built anywhere.** The tokens exist (`theme.css:103-117`), but no rule uses `--press-scale`. `Button.css` has a `translateY(1px)` on `.btn-primary:active` and colour-only `:active` states on the other variants. The portal has 7 raw `<button>`s with no `:active` state. MUT-77 (landing, Backlog) expects to reuse "the shared press-feedback pattern", which doesn't exist yet. | Build it once, shared. |
| R1 after-save | **App only.** It is built from `src/lib/savedFlashStore.ts` (zustand, pure), `src/hooks/useSavedFlash.ts` and `components/layout/SavedFlashAnnouncer` (app router, `profileStore` and `toastStore`). The portal lint bans `hooks/`, `components/layout` and `lib/toastStore` (`eslint.config.js:107-109`). The `.row-flash` CSS is scoped to `.data-table`, but `HostedTable` uses `.table`. The hosted `Toast` is error-only (`role="alert"`, no action). | Move the hook to a build-neutral home, then wire it into the portal's Expenses list. |

## 3. Plan

### 3.1 Press feedback: one shared rule (L10)

- **`src/components/ui/Button.css`:**
  - `.btn` transitions `transform var(--duration-press) var(--ease-spring)`, replacing `transform 0.1s ease`.
  - `.btn:active:not(:disabled)` sets `transform: scale(var(--press-scale))`.
  - Remove `.btn-primary`'s `translateY(1px)`. The colour and shadow changes on `:active` stay.
  - Keep the existing reduced-motion `transform: none` block as a belt-and-braces backstop.
- **`src/index.css`, which both entries import:** add a `.press` utility for controls that aren't a `Button`. It uses the same two tokens, has `:not(:disabled)`, and is placed beside the motion utilities. `.btn` and `.press` share one selector list (`:is(.btn, .press)`), so the numbers live in one rule and are not copied.
- **Portal raw buttons get `className="… press"`:**
  - `UserMenu` (trigger and menu item)
  - `ProfileSwitcher` (trigger and option)
  - `Brand` (language toggle)
  - `PaymentsList` (expand)
  - `SignInPage` (show-password)
  - The sign-in submit already has `.btn`.
- **Effect on the app:** this changes every `Button` in the local app too (decision **D1**). The landing (MUT-77) reuses `.press` for its CTAs later.
- **iOS:** `:active` fires on touch because React attaches a root `touchstart` listener.

### 3.2 After-save for portal expenses (R1)

1. **Move the hook out of `hooks/`.**
   - Move `src/hooks/useSavedFlash.ts` to `src/lib/useSavedFlash.ts`, next to its store, with no logic change.
   - Update its 6 importers: the 5 lists plus `SavedFlashAnnouncer`.
   - Move its test to `src/lib/__tests__/useSavedFlash.test.tsx`.
   - The portal lint already allows `lib/` (except `lib/stores|toastStore|i18n index`), so the portal import is legal with no lint change.
2. **Make the store build-neutral.**
   - Move `flashTarget` and `FlashTarget` (app routes `/clients/$clientId`, `/income`) from `savedFlashStore.ts` into `components/layout/SavedFlashAnnouncer.tsx` (or a sibling `savedFlashTarget.ts`), along with their tests.
   - Widen `SavedFlash.kind` to `'income' | 'payment' | 'expense'`.
   - The app's `messageFor` becomes an exhaustive `switch`. The `expense` case reuses the "no client" income copy only behind a `never` check. Alternative: keep `kind` app-typed and pass the portal's kind through a generic. Decide in eng review.
3. **Generalise the row tint CSS (`src/index.css`).**
   - `.data-table tr.row-flash td` becomes `tr.row-flash > td`, so the app's `DataTable` and the portal's `.table` both match.
   - The accent edge mirrors under `[dir="rtl"]`: today's `inset 3px 0 0` paints the wrong edge in Arabic. This is an app bug found here (decision **D4**).
4. **`HostedTable`:** add an optional `rowClassName?: (row) => string | undefined` and merge it with `clickable`.
5. **`ExpenseDrawer`:**
   - After a successful create, call `useSavedFlashStore.getState().markSaved({ kind: 'expense', ids: [created.id], profileId })`. Use the `Expense` that `mutateAsync` returns.
   - After a successful edit, call it with `ids: [existingExpense.id]`.
   - Delete calls nothing.
   - The call is unconditional and made in the drawer (ADR-057 §4).
6. **`ExpensesList`:**
   - `const flashed = useSavedFlashRows('hosted-expenses', ids, list)`.
   - Pass `rowClassName={(r) => flashed(r.id) ? 'row-flash' : undefined}`.
   - Mount `<SavedExpenseNotice onShow={() => setFilters({})} />` once.
7. **`src/hosted/components/SavedExpenseNotice.tsx` (new, about 40 lines):** the portal's view of the shared store. It is not a copy of the mechanism.
   - **Claimed:** a visually-hidden `role="status"` "Saved".
   - **Not claimed:** an info toast "Expense saved — not shown with these filters", with a **Show** action.
     - Show clears the filters (same page, same profile). The portal profile is in the URL, so there is no profile switch.
     - Show then calls `rearm({ ...pending, messaged: true })`.
   - It ignores a pending save whose `profileId` isn't the current profile.
8. **Hosted `Toast`:**
   - `useToast()` keeps `(message) => void` and gains an optional second argument: `{ tone?: 'error' | 'info'; action?: { label; onClick } }`.
   - `info` renders `role="status"` with a neutral border and an optional `Button variant="ghost" size="sm"`.
   - Existing callers and tests are unchanged.
9. **i18n:** add `hosted.savedFlash.saved`, `.expenseHidden` and `.show` in `src/hosted/i18n/en.json` and `ar.json`; `parity.test.ts` enforces both. The text is isolated for RTL by the existing hosted formatting.

### 3.3 Bundle separation (AC2)

Add rules in `scripts/bundle-rules.ts`, red-first in `scripts/__tests__/check-bundles.test.ts`:

- **`HOSTED_RULES`:** add `app profile store` = `/mutaba3a-active-profile/`. The app's Show switches profiles through `profileStore`, and that must never reach the portal. Also add `app saved-flash routes` = `/\/clients\/\$clientId/`, which proves `flashTarget` stayed app-side.
- **`LOCAL_RULES`:** add `portal stylesheet` = `/\.hp-toast\b/`, which proves `hosted.css` and the portal notice stay out of web and desktop.
- **Bundle cost:** the portal bundle gains `zustand` (about 1 kB gzip). It is not a new origin or a storage API, so no rule trips. This is noted in CHANGELOG.

### 3.4 Not changing

- MUT-43 states S1–S13, the wording and the sign-in layout. The press state is not layout.
- `src/hosted/session/__tests__/auth-states.test.tsx`: **byte-identical**. The gate includes `git diff --exit-code main -- src/hosted/session/__tests__/auth-states.test.tsx`.
- Hosted income stays read-only. MUT-133 owns the personal-profile income affordances.

## 4. Decisions for Basel

- **D1, press-feedback scope.**
  - (A, recommended) One shared rule on `.btn` and `.press`, covering the app, the portal and later the landing.
  - (B) A portal-only scoped rule. It leaves the app without L10, which is the "two products" gap the ticket exists to close.
- **D2, conversions.**
  - The portal has a second write since HP1 was written: `ConversionDrawer` (MUT-141/161). Same mechanism, about 6 lines plus 2 tests.
  - (A, recommended) A follow-up ticket, because the ticket names expenses only.
  - (B) Include it.
- **D3, portal Show behaviour.** Clear the filters on the same page (recommended), rather than navigating anywhere.
- **D4, RTL edge of the row tint.** It is an app bug in the rule this plan generalises anyway.
  - (A, recommended) Fix it here.
  - (B) File it separately.

## 5. Test plan (TDD: red first). Details go in `mut-91-portal-shared-motion-tests.md` at build time.

| AC / decision | Test | File |
|---|---|---|
| AC1 drawer | The hosted `Drawer` renders `DrawerFrame` (data-attr or class from the frame). No other file under `src/hosted` declares `role="dialog"` (source scan). | `src/hosted/components/__tests__/Drawer.test.tsx` |
| AC1 after-save | Create → the POST returns `e2` → the refetched list holds `e2` → its row has `row-flash`, there is a status "Saved", and no toast. | `src/hosted/pages/__tests__/ExpensesList.test.tsx` |
| AC1 after-save | Create under a category filter that excludes it → info toast "Expense saved…" (`role="status"`) → **Show** clears the search → the row is tinted → no second toast. | same |
| AC1 after-save | Edit a visible row → it is tinted, no toast. Delete → no tint, no toast. | same |
| AC1 after-save | A pending save from another profile is ignored by the notice. | `SavedExpenseNotice.test.tsx` |
| AC1 reuse | A portal file importing `lib/useSavedFlash` lints clean; `hooks/useSavedFlash` still errors. | `scripts/__tests__/hosted-lint.test.ts` |
| Move safety | The existing `savedFlashStore`, `useSavedFlash`, `SavedFlashAnnouncer` and `savedFlashKeys` suites pass after the move. Only the import paths change. | existing |
| Toast | The error toast is unchanged (`role="alert"`). The info toast has `role="status"` and fires its action. | `src/hosted/components/__tests__/Toast.test.tsx` (new) |
| L10 | CSS contract: `:is(.btn, .press):active:not(:disabled)` uses `scale(var(--press-scale))`, the transition uses `var(--duration-press)`, and no `translateY(1px)` is left in `Button.css`. | `src/styles/__tests__/brand.test.ts` (existing token-resolver harness) |
| L10 | Every `<button>` the signed-in shell and the sign-in page render has `btn` or `press`. | `src/hosted/pages/__tests__/views.test.tsx` and a sign-in test |
| AC2 | The new rules are red on a fixture string and green on clean text. A full `npm run test:bundles` passes. | `scripts/__tests__/check-bundles.test.ts` |
| AC3 | `auth-states.test.tsx` is unchanged and green. | gate |
| i18n | en/ar parity for `hosted.savedFlash.*`. | `src/hosted/i18n/__tests__/parity.test.ts` |
| Browser | On a hosted preview build: press scale on pointer-down (Playwright `mouse.down()` plus `getComputedStyle`), the row tint after save, and the toast plus Show in EN and AR. Also check the app's `Button` press in the web build. | throwaway config ([[qa-run-on-preview-builds]]) |

**Gate (Node 22, TD-054):** `npm run lint && npm run typecheck && npm run test:run && npm run build && npm run test:bundles`. The `server/` tree is untouched.

## 6. Knowledge updates (at build)

- **DECISIONS:** amend ADR-057 with §8: "the portal claims through the same store; the hook lives in `lib/`; `flashTarget` is app-side". Add an ADR (next free, re-check; ADR-074 at planning) for shared press feedback: `.btn`/`.press`, token-driven, applies to the app and the portal, and MUT-77 consumes it.
- **PATTERNS:** "Press feedback: `Button` or `.press`; never a per-component `:active` transform."
- **COMPONENT_REGISTRY:** the new location of `useSavedFlashRows`, `.press`, the `HostedTable.rowClassName` prop and the hosted `Toast` info tone.
- **TECH_DEBT:** a new TD (next free, re-check; TD-120 at planning). After Show, a portal expense outside the first 50-row page still isn't visible. This is the same limit as TD-078's pagination item; cross-link it.
- **CHANGELOG, TEST_PLAN, SYSTEM_OVERVIEW:** the portal now has after-save and press feedback.

## 7. Cost and scale

- **No new API calls.** The tint rides the refetch that the existing `invalidateExpenses` already triggers.
- **One store subscription per list.**
- **Bundle cost:** the portal gains about 1 kB gzip (zustand). The CSS change is a few rules.

---

# /plan-eng-review — 2026-10-14

**Target:** `.claude/designs/mut-91-portal-shared-motion.md` (this file), reviewed on main 8b07277.

## Scope record

feature answers: no feature cuts proposed; structure: B, Smaller arrangement (D1, answered 2026-10-14); accepted scope: the plan as written, except `flashTarget`/`FlashTarget` stay in `src/lib/savedFlashStore.ts` (only `kind` widens) and `SavedFlashAnnouncer` changes only its import path; the hosted bundle rule for app route strings still runs; pending remedies: F1, F2, F3, F5.

Scope Challenge result: scope accepted as-is (smaller arrangement preserves every feature).

## Scope Challenge findings

- **F1 [P1] (confidence: 9/10)** `src/hosted/hosted.css:168`. The line `transform: translateY(-50%);` on `.hp-password-toggle` centres the sign-in show-password toggle. Plan §3.1 gives `.press` `transform: scale(var(--press-scale))` on `:active` and adds `press` to this toggle. On press, the scale replaces the translate, so the toggle drops by half its height. MUT-43's sign-in layout must stay unchanged. Plan §3.1 also lets the `.btn` and `.press` rules share `transition` across `Button.css` and `index.css`. A second `transition` shorthand would override the first wholesale (folded into F1). Reviewer: Claude (native).
- **F2 [P1] (confidence: 9/10)** `src/lib/savedFlashStore.ts`, in `markSaved`. The timer `backstopTimer = setTimeout(() => { set((state) => (state.pending === flash && state.claimed === null ? { claimed: false } : {})); }, BACKSTOP_MS);` with `BACKSTOP_MS = 1200` resolves "not claimed" at 1.2 s, even while a registered list is still fetching. Local Dexie refetches are fast. The portal's refetch is an HTTP round trip: up to 50 rows, plus the summary invalidation. On a slow connection that can exceed 1.2 s. The user then gets a false "not shown" message and no tint on the row that does arrive. Reviewer: Claude (native).
- **F3 [P2] (confidence: 8/10)** `src/hooks/useSavedFlash.ts`: `const settled = !query.isLoading && !query.isFetching;`. A failed refetch counts as settled. TanStack keeps the last data, so the old ids never match. The plan's copy "Expense saved — not shown with these filters" then states a cause that isn't true. TODOS.md #4 already records failed refetches as silent. Reviewer: Claude (native).
- **F5 [P2] (confidence: 7/10)** `src/hosted/components/Toast.tsx`: `const ToastContext = createContext<(message: string) => void>(() => {});`. The provider is mounted once above the router (`HostedApp.tsx:19`). Plan §3.2.8 puts the Show action into that global toast. Its closure holds `ExpensesList`'s `setFilters` (`useReplaceSearch()`, `router.tsx:137`), so it can outlive the page by up to 6 s. One slot also means an error toast silently replaces the notice. Reviewer: Claude (native).
- **Factual check (no question):** the plan's hosted rule `/\/clients\/\$clientId/` will not false-positive. The portal's own route is `/clients/$customerId` (`src/hosted/router.tsx:97`). No file under `src/hosted` declares `role="dialog"` today, so the AC1 source-scan test is sound. MUT-104 is merged (`cdb7022`), so `Brand.tsx` has no open-branch conflict, and no open branch touches the files this plan moves.
- **Prior learning applied:** `mutaba3a-partialpaymentdrawer-onrecorded-home-only` (confidence 10/10, from 2026-10-12). The plan already calls `markSaved` unconditionally inside `ExpenseDrawer`, not through an optional callback.

## Decision ledger

### F1: how press feedback scales a control
Finding: F1, P1, confidence 9/10, src/hosted/hosted.css:168, Claude (native)
Plan baseline: plan §3.1, `:is(.btn, .press):active:not(:disabled) { transform: scale(var(--press-scale)) }`, with transitions declared in both Button.css and index.css (original proposal, unapproved)
Runtime evidence: `.hp-password-toggle` is centred with `transform: translateY(-50%)` (hosted.css:168); `.btn` declares a `transition` shorthand listing `transform 0.1s ease` (Button.css:11-15); index.css:1300-1340 re-declares the `.btn-*` variants (legacy duplicate, no transition)
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| F1 press property | no press scale anywhere | individual CSS `scale: var(--press-scale)` on `:is(.btn, .press):active:not(:disabled)`; `.btn` transition list swaps `transform 0.1s ease` for `scale var(--duration-press) var(--ease-spring)` in Button.css; `.press` gets its own `transition: scale …` in index.css; no other element's `transform` is touched | `transform: scale(...)` as planned, plus a hand-written compose override for each control that already has a transform (today `.hp-password-toggle`: `translateY(-50%) scale(...)`) |
| F2 backstop | pending | pending | pending |
| F3 copy/error | pending | pending | pending |
| F5 notice lifecycle | pending | pending | pending |
| D1 structure | approved B | B | B |
Question D2:
D2 — Press feedback: use the CSS `scale` property, or `transform: scale()` with per-control overrides?
Project/branch/task: main, planning MUT-91 press feedback (L10) for the app and portal buttons.
ELI10: The plan makes buttons shrink a little when pressed, written as `transform: scale(...)`. But a button can only have one `transform` value. The sign-in page's show-password toggle already uses `transform` to stay vertically centred, so pressing it would make it jump down. Modern CSS has a separate `scale` property that stacks on top of `transform` instead of replacing it.
Stakes if we pick wrong: with B, every future control that has a transform needs its own override, or it jumps when tapped; the sign-in toggle is the one known today.
Recommendation: A because the platform property composes with any existing transform, so there is nothing to remember per control (Safari 14.1+, inside ADR-058's Safari 16.2 floor).
Completeness: A=10/10, B=7/10
Pros / cons:
A) CSS `scale` property (recommended)
  ✅ Composes with existing transforms, so the sign-in toggle and any future positioned control press without moving
  ✅ One rule, token-driven; Button.css owns the `.btn` transition list, so no shorthand collision with index.css
  ❌ jsdom doesn't compute `scale`, so the proof is the CSS contract test plus a Playwright pointer-down check
B) `transform: scale()` + per-control overrides
  ✅ Matches the plan text and the older `transform` habit in Button.css
  ❌ Each control with its own transform needs a compose override; a missed one jumps on press (regression magnet)
Net: A costs nothing extra and removes a whole class of press-jump bugs.
Header: Press property
Options:
A) CSS scale property (recommended)
`scale: var(--press-scale)` on `:is(.btn, .press):active:not(:disabled)`; Button.css `.btn` transition lists `scale var(--duration-press) var(--ease-spring)` (replacing `transform 0.1s ease`) and drops `.btn-primary:active`'s translateY(1px); index.css `.press` declares only its own scale transition. Existing transforms (sign-in toggle) untouched. Proof: CSS contract test + Playwright mouse.down() on the toggle asserting its bounding box doesn't move. Human ~1h / CC ~5min.
B) transform + overrides
Keep `transform: scale(var(--press-scale))`; add `.hp-password-toggle.press:active { transform: translateY(-50%) scale(var(--press-scale)) }` and any future equivalents by hand; transitions as planned. Human ~1h / CC ~5min, plus ongoing per-control vigilance.

State: approved
Actual answer: A) CSS scale property (recommended) — D2, answered 2026-10-14
Accepted scope: `scale: var(--press-scale)` on `:is(.btn, .press):active:not(:disabled)`; Button.css `.btn` transition lists `scale var(--duration-press) var(--ease-spring)` replacing `transform 0.1s ease`, and `.btn-primary:active` drops `translateY(1px)`; index.css `.press` declares only its own scale transition; no existing `transform` touched. Proof: CSS contract test + Playwright mouse.down() on the sign-in toggle asserting its bounding box does not move.
History: none

### F2: when the "not claimed" backstop may fire
Finding: F2, P1, confidence 9/10, src/lib/savedFlashStore.ts (markSaved backstop), Claude (native)
Plan baseline: plan §3.2 reuses the store unchanged apart from `kind` (D1 B); backstop fires at BACKSTOP_MS = 1200 regardless of lists (original behaviour, unapproved for the portal)
Runtime evidence: `backstopTimer = setTimeout(() => { set((state) => (state.pending === flash && state.claimed === null ? { claimed: false } : {})); }, BACKSTOP_MS);` — no check of registered lists; the comment says it exists for "a save from /settings' + Add, which has no list on screen"
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| F2 backstop | fires at 1.2s whatever lists are doing | at 1.2s resolve false only if no registered list is mid-fetch (none registered, or all settled); a list still fetching resolves the save on its own settled report (app and portal) | store unchanged; `markSaved` gains an optional `backstopMs`, portal passes a longer value (e.g. 5000) | unchanged |
| F1 press property | approved A (D2) | A | A | A |
| F3 copy/error | pending | pending | pending | pending |
| F5 notice lifecycle | pending | pending | pending | pending |
| D1 structure | approved B | B | B | B |
Question D3:
D3 — After-save backstop: stop it firing while a list is still loading, or give the portal a longer timer?
Project/branch/task: main, planning MUT-91 after-save feedback (R1) for portal expenses.
ELI10: After you save, the app waits for the list to reload and then either highlights the new row or says "saved, here's where". A safety timer gives up after 1.2 seconds and shows the "here's where" message. That timer exists for screens with no list at all. In the local app the list reloads in milliseconds, but the portal reloads over the internet, so on a slow connection the timer gives up before the row arrives: the user sees a wrong message and the row never lights up.
Stakes if we pick wrong: portal users on slow connections get a false "not shown" message after most saves and no highlight (C); B only moves the cliff to a longer delay.
Recommendation: A because the store already knows which lists are mid-fetch; letting them finish fixes the cause for both builds with one small change and two store tests.
Completeness: A=10/10, B=7/10, C=3/10
Pros / cons:
A) Wait for fetching lists (recommended)
  ✅ No false message at any network speed; the backstop still covers screens with no list, its documented purpose
  ✅ App behaviour unchanged in practice (Dexie settles well under 1.2s) and pinned by existing store tests
  ❌ Touches the shared store, so the app's store suite needs two new cases (list mid-fetch at backstop; list settles later)
B) Longer portal timer
  ✅ Store logic untouched; the change is one optional parameter
  ❌ Still wrong past the new limit, and a longer wait delays the honest message on screens with no list
C) Leave as is
  ✅ Zero work
  ❌ Portal users on slow links get a false message and no tint
Net: A fixes the real race once; B and C keep a timing cliff.
Header: Backstop timing
Options:
A) Wait for fetching lists (recommended)
At BACKSTOP_MS the store resolves claimed:false only when no registered list currently reports settled=false; otherwise the next settled report resolves it (claim or no-match). Tests: savedFlashStore.test.ts adds "list mid-fetch at 1.2s, settles at 3s with the id → claimed true, no false message" and "list mid-fetch, settles without the id → claimed false then". Human ~2h / CC ~10min.
B) Longer portal timer
`markSaved(flash, { backstopMs })` optional; ExpenseDrawer passes 5000; app call sites unchanged. One test for the option. Human ~1h / CC ~5min.
C) Leave as is
No change; document as TD. Human 0 / CC 0.

State: approved
Actual answer: A) Wait for fetching lists (recommended) — D3, answered 2026-10-14
Accepted scope: at BACKSTOP_MS the store resolves claimed:false only when no registered list currently reports settled=false; otherwise the next settled report resolves it (claim or no-match). Applies to app and portal. Tests in savedFlashStore.test.ts: "list mid-fetch at 1.2s, settles at 3s with the id → claimed true, no false message" and "list mid-fetch, settles without the id → claimed false then"; existing store tests stay green unchanged.
History: none

### F3: what the portal's "not claimed" message says
Finding: F3, P2, confidence 8/10, src/hooks/useSavedFlash.ts (`const settled = !query.isLoading && !query.isFetching;`), Claude (native)
Plan baseline: plan §3.2.7/§3.2.9 copy "Expense saved — not shown with these filters" (original proposal, unapproved)
Runtime evidence: a failed refetch is settled with stale ids, so it resolves "not claimed"; the portal's `QueryView` already replaces an errored view with the Unreachable card and Retry (`QueryView.tsx:37-46`, PATTERNS "A view in error renders no data"); other unclaimed causes are pagination past 50 rows and a filter that excludes the row
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| F3 message copy | n/a (planned "not shown with these filters") | neutral "Expense saved" + Show (ar: "تم حفظ المصروف" + "عرض"); names no cause; shown even when the list is in error, since it confirms the write succeeded | keep "not shown with these filters" |
| F1 press property | approved A (D2) | A | A |
| F2 backstop | approved A (D3) | A | A |
| F5 notice lifecycle | pending | pending | pending |
| D1 structure | approved B | B | B |
Question D4:
D4 — The portal's "saved but not visible" message: neutral wording, or blame the filters?
Project/branch/task: main, planning MUT-91 after-save feedback for portal expenses.
ELI10: When a saved expense doesn't appear in the list, the plan's message says your filters are hiding it. But there are three possible reasons: a filter, the expense being older than the first 50 rows, or the list failing to reload. In the third case the portal already shows a "can't reach the server" card, so a message about filters would be wrong. A neutral "Expense saved · Show" is true in all three cases, and it tells the user the save worked so they don't enter it twice.
Stakes if we pick wrong: with B, users are told filters hide an expense when the network failed, or when it's simply on page 2.
Recommendation: A because it is true in every case and matches the app's own "Saved to <client> · Show" wording style.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Neutral "Expense saved" (recommended)
  ✅ True for filters, pagination and refetch failure alike; no extra state plumbing in the shared hook
  ✅ During a network failure it confirms the write landed, which avoids the double entry TODOS.md #4 describes
  ❌ Doesn't tell the user why the row is missing; Show clearing the filters is the only hint
B) "Not shown with these filters"
  ✅ Explains the most common cause in one phrase
  ❌ False after a failed refetch or for a row past the first page; a message that is wrong some of the time erodes trust
Net: a slightly less specific message that is always true beats a specific one that is sometimes wrong.
Header: Message copy
Options:
A) Neutral "Expense saved" (recommended)
Keys `hosted.savedFlash.expenseSaved` = "Expense saved" / "تم حفظ المصروف" and `hosted.savedFlash.show` = "Show" / "عرض"; the notice also shows while the list is in error. ExpensesList test asserts the exact copy and that it appears after a create excluded by a category filter. Human ~15min / CC ~2min.
B) "Not shown with these filters"
Plan's original key `hosted.savedFlash.expenseHidden` with the filters wording. Human ~15min / CC ~2min.

State: approved
Actual answer: A) Neutral "Expense saved" (recommended) — D4, answered 2026-10-14
Accepted scope: keys `hosted.savedFlash.expenseSaved` = "Expense saved" / "تم حفظ المصروف" and `hosted.savedFlash.show` = "Show" / "عرض" (plus `hosted.savedFlash.saved` for the polite status); no filters wording; the notice also shows while the list is in error. ExpensesList test asserts the exact copy after a create excluded by a category filter.
History: none

### F5: where the portal's "Expense saved · Show" notice lives
Finding: F5, P2, confidence 7/10, src/hosted/components/Toast.tsx (`const ToastContext = createContext<(message: string) => void>(() => {});`, provider at HostedApp.tsx:19), Claude (native)
Plan baseline: plan §3.2.7–8, extend the global hosted ToastProvider with an info tone and action (original proposal, unapproved)
Runtime evidence: the provider sits above the router and keeps one slot (`setMessage` replaces), lives 6s (`TOAST_MS = 6000`), role="alert" with error styling; ExpensesList's `setFilters` is `useReplaceSearch()` bound to the expenses route (router.tsx:137)
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| F5 notice home | n/a | `SavedExpenseNotice` renders its own `role="status"` notice inside ExpensesList (classes `hp-toast hp-toast-info`, a Button for Show, 6s timer); unmounts with the page, so Show can't run after navigation; hosted `Toast.tsx` untouched | extend global `ToastProvider` with `{ tone, action }` as planned, plus `SavedExpenseNotice` dismisses its toast on unmount |
| F1 press property | approved A (D2) | A | A |
| F2 backstop | approved A (D3) | A | A |
| F3 message copy | approved A (D4) | A | A |
| D1 structure | approved B | B | B |
Question D5:
D5 — Should the "Expense saved · Show" notice live on the Expenses page, or in the portal's global toast?
Project/branch/task: main, planning MUT-91 after-save feedback for portal expenses.
ELI10: The portal has one global pop-up slot, built only for errors. The plan widens it to carry the "Expense saved · Show" notice too. But Show's button remembers the Expenses page's filter controls. If you leave the page within six seconds and click Show, it acts on a page you have already left. An error pop-up would also silently replace the notice. Rendering the notice inside the Expenses page means it disappears with the page, and the error pop-up stays exactly as MUT-43 built it.
Stakes if we pick wrong: with B, a stale Show can act after navigation unless the dismiss-on-unmount wiring is right, and the error toast's tested contract changes.
Recommendation: A because its lifetime matches the page that owns Show, and the error toast and its tests stay untouched.
Completeness: A=9/10, B=9/10
Pros / cons:
A) Notice on the Expenses page (recommended)
  ✅ Can't outlive its page, so Show never acts on a page you left; no cleanup wiring to get wrong
  ✅ Hosted Toast.tsx, its role="alert" contract and its callers stay byte-identical
  ❌ If an unrelated error toast fires within the same 6s, the two can sit in the same corner (rare: errors here come from sign-out or downloads)
B) Extend the global toast
  ✅ One toast slot for the whole portal, so two pop-ups can never overlap
  ❌ Changes a MUT-43 component's API and needs dismiss-on-unmount plus a stale-closure test to be safe
Net: A keeps lifetimes simple and leaves MUT-43 untouched; B trades that for a single slot.
Header: Notice home
Options:
A) Notice on the Expenses page (recommended)
New `src/hosted/components/SavedExpenseNotice.tsx` renders `<div class="hp-toast hp-toast-info" role="status">` + Button "Show"; `.hp-toast-info` modifier in hosted.css (neutral border, no error icon); auto-hides after 6s; tests: shows on unclaimed, Show clears filters and rearms, gone after unmount. Hosted Toast.tsx unchanged, no Toast.test.tsx needed. Human ~2h / CC ~10min.
B) Extend the global toast
`useToast()(message, { tone: 'info', action })`, info renders role="status"; SavedExpenseNotice dismisses on unmount; new Toast.test.tsx for both tones + a stale-closure test. Human ~3h / CC ~15min.

State: approved
Actual answer: A) Notice on the Expenses page (recommended) — D5, answered 2026-10-14 (sent label "Notice on Expenses page (recommended)", same description)
Accepted scope: new `src/hosted/components/SavedExpenseNotice.tsx` rendering `<div class="hp-toast hp-toast-info" role="status">` + Button "Show"; `.hp-toast-info` modifier in hosted.css (neutral border, no error icon); auto-hides after 6s; tests: shows on unclaimed, Show clears filters and rearms, gone after unmount. Hosted `Toast.tsx` unchanged; no Toast.test.tsx. Plan §3.2.8 (Toast extension) is dropped.
History: none

Scope Challenge dispositions: F1 accepted (D2 A), F2 accepted (D3 A), F3 accepted (D4 A), F5 accepted (D5 A). Mechanics carried under D1 B without a new question: `SavedFlash.kind` widens to include `'expense'`; the app announcer's `messageFor` handles `'expense'` explicitly with the generic `savedFlash.saved` copy (the app never marks one), so no income copy is misattributed.

## Section 1: Architecture review

- **A1 [P2] (confidence: 8/10)** `src/components/ui/Button.css:89-93`. Today `.btn-primary:active:not(:disabled)` sets `transform: translateY(1px)`, and the other variants change colour only. The plan's open item §4 D1 decides whether press feedback ships in the shared `Button` (app + portal + later landing) or portal-only. Blast radius: every `Button` in the local app (about 100+ call sites) gains a 0.96 press. The tokens already neutralise this under reduced motion (`theme.css:111-117`). This is a product/scope call. Reviewer: Claude (native).
- **A2 [P3] (confidence: 9/10)** `src/hosted/components/ConversionDrawer.tsx`. The portal has a second write, which HP1 predates (plan §4 D2). The ticket names expenses only. Reviewer: Claude (native).
- Data flow: the after-save path is shown below. No new network calls; no auth or data-access change (expenses API unchanged).

```
ExpenseDrawer submit ──► create/update mutateAsync ──► onSuccess: invalidateExpenses (fire-and-forget refetch)
        │                                                          │
        └─► markSaved({kind:'expense', ids:[id], profileId}) ◄─────┘ (after mutateAsync resolves; drawer closes)
                     │
     savedFlashStore: pending, claimed=null, backstop armed (fires only if no list mid-fetch, D3)
                     │
  ExpensesList useSavedFlashRows ── reports (ids, settled) every render
        ├─ ids ∋ saved id ──► claimed=true ─► row-flash on <tr> 1.5s + sr-only "Saved"
        └─ settled, no match ─► claimed=false ─► SavedExpenseNotice "Expense saved · Show" (page-local, D5)
                                                    └─ Show ─► setFilters({}) ─► refetch ─► rearm(messaged) ─► tint
```

### A1: press feedback scope (plan §4 D1)
Finding: A1, P2, confidence 8/10, src/components/ui/Button.css:89-93, Claude (native)
Plan baseline: plan §4 D1 recommends (A) shared rule (original proposal, unapproved)
Runtime evidence: no `--press-scale` consumer exists; app and portal both render the same `Button` (`src/hosted/**` imports `components/ui/Button` in 7 files)
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| A1 press scope | no press scale; primary nudges 1px | shared: every `Button` (app + portal) and every `.press` control presses with the D2 `scale` rule | portal-only: rule scoped under the portal shell (`.hp-shell`/sign-in root); app buttons unchanged |
| F1 press property | approved A (D2) | A | A (scoped) |
| F2/F3/F5 | approved A (D3/D4/D5) | A | A |
| A2 conversions | pending | pending | pending |
Question D6:
D6 — Press feedback for every button (app + portal), or the portal only?
Project/branch/task: main, planning MUT-91 L10 press feedback.
ELI10: The portal uses the same Button component as the local app. If press feedback goes into that shared component, every button in the desktop and web app also gets the small press-in, which is what "one product" means. If it is scoped to the portal, the portal will feel more responsive than the main app until MUT-77 or another ticket adds it there.
Stakes if we pick wrong: B leaves the app and portal feeling different, the "two products" gap this ticket exists to close; A changes the feel of ~100 app buttons in one go.
Recommendation: A because L10 is a shared decision (HP1), the tokens already handle reduced motion, and MUT-77 can then reuse `.press` instead of inventing its own.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Every button (recommended)
  ✅ App, portal and later landing press the same way from one token-driven rule
  ✅ MUT-77 inherits `.press` for its CTAs; no second implementation
  ❌ A visible change across the whole local app ships under a portal ticket; CHANGELOG and ADR must say so
B) Portal only
  ✅ Smallest blast radius; the local app looks exactly as before
  ❌ The app and portal diverge again, and a later ticket must lift the scope, a second pass over the same rule
Net: A is the honest version of a shared decision; B postpones the app half.
Header: Press scope
Options:
A) Every button (recommended)
Rule on `:is(.btn, .press)` globally (Button.css + index.css per D2); ADR records that L10 now covers the app; Playwright check on one app button (web build) and the portal. Human ~0.5h / CC ~3min beyond D2.
B) Portal only
Rule scoped `:is(.hp-shell, .hp-signin) :is(.btn, .press):active…` in hosted.css; app untouched; ADR records portal-only. Human ~0.5h / CC ~3min.

State: approved
Actual answer: A) Every button (recommended) — D6, answered 2026-10-14
Accepted scope: the D2 rule applies globally on `:is(.btn, .press)` (Button.css + index.css); the ADR records that L10 now covers the local app as well as the portal; Playwright check on one app button (web build) and on the portal; CHANGELOG calls out the app-wide visual change.
History: none

### A2: portal conversions after-save (plan §4 D2)
Finding: A2, P3, confidence 9/10, src/hosted/components/ConversionDrawer.tsx, Claude (native)
Plan baseline: plan §4 D2 recommends (A) follow-up ticket (original proposal, unapproved)
Runtime evidence: ConversionDrawer is the portal's second write (`ConversionsList.tsx` renders it); MUT-91's ticket text and HP1 name expenses only
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| A2 conversions | no after-save | out of MUT-91; file a follow-up story under epic MUT-74 (or MUT-34) to wire ConversionDrawer/ConversionsList to the same store and notice | in MUT-91: `kind:'conversion'`, ConversionDrawer markSaved, ConversionsList rowClassName + notice (generalised `SavedNotice` with a message prop) + 2 tests; ticket AC updated |
| A1 press scope | approved A (D6) | A | A |
| F1–F5 | approved | A | A |
Question D7:
D7 — Portal currency conversions: add after-save feedback now, or file a follow-up?
Project/branch/task: main, planning MUT-91 after-save feedback for portal writes.
ELI10: When the design brief was written, saving an expense was the portal's only write. Since then the portal also logs currency conversions (MUT-141/161). The same highlight-or-message behaviour would take a few lines there too, but the ticket only asks for expenses. Doing it now means the notice must be general rather than expense-only; doing it later means a small separate ticket.
Stakes if we pick wrong: A leaves conversions without feedback until the follow-up lands; B widens a ticket whose acceptance criteria name expenses only, so qa-reconcile flags it unless the ticket is updated.
Recommendation: A because MUT-91's acceptance criteria are expenses-only, and a one-line follow-up keeps the build matched to the ticket.
Completeness: A=8/10, B=10/10
Pros / cons:
A) Follow-up ticket (recommended)
  ✅ MUT-91 stays matched to its acceptance criteria; qa-reconcile has nothing to flag
  ✅ The notice can stay expense-specific and simple; the follow-up generalises it with a real second caller
  ❌ Conversions stay silent after save until the follow-up ships
B) Include now
  ✅ Every portal write gets the same feedback in one pass (human ~3h / CC ~15min more)
  ❌ Scope beyond the ticket; needs a ticket edit, and the notice becomes generic now
Net: same end state; A sequences it behind a ticket boundary, B pulls it in.
Header: Conversions
Options:
A) Follow-up ticket (recommended)
After this review, file a MUT story "Portal conversions show where a saved conversion landed" (relates to MUT-91, MUT-161) with the same AC shape; MUT-91 builds expenses only. Human ~10min / CC ~2min.
B) Include now
Add `'conversion'` kind, wire ConversionDrawer + ConversionsList, generalise SavedExpenseNotice into `SavedNotice({ message })`, 2 tests in ConversionsList.test.tsx, update MUT-91's AC. Human ~3h / CC ~15min.

State: approved
Actual answer: B) Include now — D7, answered 2026-10-14 (against the recommendation)
Accepted scope: add `'conversion'` kind; `ConversionDrawer` calls markSaved with the created `Conversion` id (create only; it has no edit); `ConversionsList` passes `rowClassName` and mounts the notice; `SavedExpenseNotice` becomes `SavedNotice({ message })` in `src/hosted/components/SavedNotice.tsx` (keys `hosted.savedFlash.expenseSaved` and `hosted.savedFlash.conversionSaved` = "Conversion saved" / "تم حفظ التحويل"); 2 tests in ConversionsList.test.tsx (visible → tint; filtered out → notice + Show); MUT-91's ticket gets an AC/scope note for conversions. Verified: `createConversion` returns `Conversion` (api/client.ts:248-249); ConversionsList already has `setFilters({})` for clear (line 91).
History: none

Section 1 dispositions: A1 accepted (D6 A, every button); A2 accepted (D7 B, conversions included).

## Section 2: Code quality review

- **Q1 [P2] (confidence: 8/10)** `src/index.css:2139-2141`. The rule `.data-table tr.row-flash td:first-child { box-shadow: inset 3px 0 0 var(--accent); }` puts the accent on the left edge of the first cell. In RTL the first cell is the rightmost, so the bar is drawn on that cell's inner left side, mid-row. The plan generalises this selector for the portal (§3.2.3) and asks about the mirror (§4 D4). Reviewer: Claude (native).
- **Q2 [P3] (confidence: 7/10)** `src/index.css:1300-1340`. These lines re-declare `.btn-primary/.btn-secondary/.btn-danger/.btn-ghost` beside `Button.css`. This duplicate is pre-existing and does not affect the press rule (no `transform` or `transition` there). Out of scope; noted under NOT in scope as MUT-103 sweep territory. No question.
- Moving the hook (`src/hooks/useSavedFlash.ts` → `src/lib/useSavedFlash.ts`) is a pure move. The 6 importers and the test change paths only. The portal lint already permits it: the patterns are `(^|/)(db|sync|hooks)(/|$)` and `(^|/)lib/(stores|toastStore)` (eslint.config.js:107-109). No question.

### Q1: the row tint's accent edge in RTL (plan §4 D4)
Finding: Q1, P2, confidence 8/10, src/index.css:2139-2141, Claude (native)
Plan baseline: plan §4 D4 recommends (A) fix here (original proposal, unapproved)
Runtime evidence: `.data-table tr.row-flash td:first-child { box-shadow: inset 3px 0 0 var(--accent); }`, with no `[dir="rtl"]` override in index.css
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| Q1 RTL edge | accent on the left of the first cell in both directions | `[dir="rtl"] tr.row-flash > td:first-child { box-shadow: inset -3px 0 0 var(--accent) }` in the same generalised rule; covers app and portal | leave; file a bug |
| A1/A2/F1–F5 | approved | unchanged | unchanged |
Question D8:
D8 — Fix the highlight bar so it sits on the correct edge in Arabic?
Project/branch/task: main, planning MUT-91 after-save row tint for the app and portal.
ELI10: When a saved row lights up, a thin purple bar marks its leading edge. The CSS draws that bar on the left of the first cell. In Arabic the first cell is on the right, so the bar lands in the middle of the row instead of at its start. This plan already rewrites that exact CSS rule so the portal's table matches it, so mirroring it for right-to-left is a one-line addition.
Stakes if we pick wrong: B ships the portal's new tint with the same misplaced bar for every Arabic user, and the app keeps it.
Recommendation: A because the rule is already being edited and RTL is a day-one requirement in CLAUDE.md.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Mirror it here (recommended)
  ✅ The tint reads correctly in Arabic in both builds from the first portal release
  ✅ One extra declaration in a rule this plan already touches; no new file
  ❌ A small app-visible fix rides on a portal ticket; CHANGELOG must name it
B) Leave it, file a bug
  ✅ Keeps the diff to strictly what HP1 names
  ❌ Arabic users get a mid-row bar in the brand-new portal tint, and the fix becomes a separate pass over the same rule
Net: a one-line correctness fix in a rule already open for editing.
Header: RTL tint edge
Options:
A) Mirror it here (recommended)
Add `[dir="rtl"] tr.row-flash > td:first-child { box-shadow: inset -3px 0 0 var(--accent); }` next to the generalised rule; Playwright check in AR on the portal (and app) that the bar's x is at the row's right edge. Human ~20min / CC ~3min.
B) Leave it, file a bug
No CSS mirror; file a MUT bug for the RTL tint edge. Human ~10min / CC ~2min.

State: approved
Actual answer: A) Mirror it here (recommended) — D8, answered 2026-10-14
Accepted scope: `[dir="rtl"] tr.row-flash > td:first-child { box-shadow: inset -3px 0 0 var(--accent); }` beside the generalised rule; Playwright check in AR (portal and app) that the bar sits at the row's right edge; CHANGELOG names the app-visible fix.
History: none

Section 2 dispositions: Q1 accepted (D8 A); Q2 not in scope (no question, pre-existing); hook move is mechanics under D1 B.

## Section 3: Test review

Framework: Vitest + Testing Library (unit and integration), Playwright for browser checks (throwaway preview config, per [[qa-run-on-preview-builds]]). Gate per CLAUDE.md under Node 22.

```
CODE PATHS                                                        USER FLOWS
[+] src/lib/savedFlashStore.ts                                    [+] Portal: record an expense
  ├── markSaved / tryResolve       [★★★ TESTED] savedFlashStore.test.ts   ├── [GAP→planned] visible → row tint + "Saved" status   ExpensesList.test
  ├── backstop, no lists           [★★★ TESTED] existing                   ├── [GAP→planned] filtered out → "Expense saved" + Show → filters cleared → tint
  ├── backstop, list mid-fetch     [GAP→D3] 2 new store cases              ├── [GAP→planned] edit visible row → tint, no notice
  └── kind 'expense'|'conversion'  [GAP→planned] type-level + notice tests ├── [GAP→planned] delete → nothing
[+] src/lib/useSavedFlash.ts (moved)                                       ├── [GAP→planned] save fails (422/409) → existing error path, no markSaved   ExpenseDrawer.test (extend)
  └── settled/report/flashed       [★★★ TESTED] useSavedFlash.test (path)  └── [GAP→planned] refetch fails → Unreachable card + "Expense saved" (D4)
[+] SavedNotice.tsx (new)                                         [+] Portal: log a conversion
  ├── claimed → sr-only "Saved"    [GAP→planned]                           ├── [GAP→D7] visible → tint                       ConversionsList.test
  ├── unclaimed → notice + Show    [GAP→planned]                           └── [GAP→D7] filtered out → notice + Show
  ├── other profile → ignored      [GAP→planned]                  [+] Press feedback (L10)
  ├── messaged → no repeat         [GAP→planned]                           ├── [GAP→D2] pointer-down on portal Button + sign-in toggle; toggle box doesn't move  [→E2E]
  └── unmount → gone, no Show      [GAP→D5]                                ├── [GAP→D6] pointer-down on an app Button (web build)                                 [→E2E]
[+] HostedTable rowClassName       [GAP→planned] via ExpensesList          └── [GAP→planned] reduced motion → no scale (tokens; existing brand.test covers --press-scale:1)
[+] ExpenseDrawer / ConversionDrawer markSaved [GAP→planned]       [+] RTL
[+] CSS: :is(.btn,.press):active scale, transitions [GAP→D2] contract test   └── [GAP→D8] AR tint bar at row's right edge  [→E2E]
[+] CSS: tr.row-flash > td + RTL mirror  [GAP→D8] contract + E2E   [+] AC2/AC3
[+] bundle-rules (2 hosted, 1 local) [GAP→planned] check-bundles.test     ├── [GAP→planned] npm run test:bundles green
[+] portal lint allows lib/useSavedFlash [GAP→planned] hosted-lint.test   └── [★★★ TESTED] auth-states.test.tsx byte-identical (git diff --exit-code)

COVERAGE (after plan): all listed paths have a planned ★★+ test; today 6/29 covered by existing suites.
GAPS: 23, all closed by the plan's test table plus D2/D3/D5/D7/D8 accepted proofs (4 [→E2E] browser checks).
```

Value cards for the new tests are in the Test Plan Artifact. Regression rule: the app's five after-save lists, `SavedFlashAnnouncer`, the store's existing cases and every app `Button` are at risk from the hook move (D1), the backstop change (D3) and the press rule (D6). Their regression contracts are already approved in those answers: the existing suites stay green with only import paths changed, two store cases are added, a CSS contract test covers the press rule, and Playwright pointer-down runs on app and portal. No new test-policy choice is pending.

Tests made obsolete: none. `src/hooks/__tests__/useSavedFlash.test.tsx` moves to `src/lib/__tests__/` and is not retired.

Section 3 dispositions: no new choices; all gaps map to approved remedies.

## Section 4: Performance review

No issues found. No new queries. The tint rides the refetch that `invalidateExpenses` / `invalidateConversions` already trigger. `scale` animates on the compositor, like `transform`. One zustand subscription per list. The portal bundle gains zustand (about 1 kB gzip); scale is n/a for requests/s.

## Outside Voice

Outside voice unavailable. `codex` is not installed (preflight `CODEX_MODE: not_installed`), and the native fallback needs TaskOutput/TaskStop, which this session does not expose. Coverage is recorded as unavailable (`gstack-review-log`, outside_status unavailable). This is missing coverage, not a clean result.

## Final planning decisions

### T1: portal saves past the first loaded page (TODO candidate)
Finding: T1, P3, confidence 9/10, src/hosted/data/expenseQueries.ts:19 (`const PAGE_LIMIT = 50;`), Claude (native)
Plan baseline: plan §6 adds a TECH_DEBT entry (next free TD, cross-linked to TD-078)
Question D9: TODO: a saved expense or conversion past the first 50 rows stays out of view even after Show. Track it where? (A Add to TODOS.md / B Skip: TECH_DEBT covers it (recommended) / C Build it now)
State: approved
Actual answer: C) Build it now — D9, answered 2026-10-14 (against the recommendation)
Accepted scope: Show must land on a tinted row even when the saved record falls outside the first loaded page; mechanism pending D10. The plan's TECH_DEBT entry for this limit is dropped once built.
History: none

### T1-mech: how Show reaches a row outside the first page
Finding: T1, follows D9
Plan baseline: D9 C (build now), mechanism unapproved
Runtime evidence: the server lists expenses newest `occurredOn` first with an opaque cursor (`server/src/routes/expenses.ts:93-101`) and accepts `from`/`to` day filters. The portal's `ExpensesPageSearch` and `ConversionsPageSearch` both carry `from`/`to` (`src/hosted/data/filters.ts:93-126`). The created `Expense`/`Conversion` returned by the POST has its date.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| T1 Show target | clear filters (D5) | Show replaces the filters with `{ from: date, to: date }` of the saved record (other filters cleared); `SavedFlash` gains optional `occurredOn`; one bounded read; residual only if >50 records share that day (Show more still works) | Show clears filters, then calls `fetchNextPage` until the id appears or 5 pages (250 rows) are loaded | new server lookup (e.g. `GET /v1/expenses?around=<id>` returning the page holding it), OpenAPI bump, server tests, portal wiring for both lists |
| F1–F5, A1, A2, Q1 | approved | unchanged | unchanged | unchanged |
Question D10:
D10 — Show for a row outside the first page: narrow to the saved date, page forward, or add a server lookup?
Project/branch/task: main, planning MUT-91 after-save Show on the portal.
ELI10: The list loads 50 rows at a time, newest first. A back-dated save can sit on page 2, out of reach. The cheapest fix is to have Show filter the list to the saved record's own date: that day's records fit on one page, the row loads and lights up, and a date chip shows why the list is short. Alternatives are loading more pages until it appears, or building a new server endpoint that finds the right page.
Stakes if we pick wrong: B can spend 5 reads and still miss; C adds server, API-contract and deploy work to a front-end ticket.
Recommendation: A because the server already supports day filters, so one read lands the row with no API change.
Completeness: A=9/10, B=7/10, C=10/10
Pros / cons:
A) Narrow to the saved date (recommended)
  ✅ One bounded read, no server or OpenAPI change; works the same for expenses and conversions
  ✅ The visible date filter explains the short list, and the user can clear it in one click
  ❌ Show no longer means "clear filters"; more than 50 records on one day still needs Show more
B) Page forward up to 5
  ✅ Keeps "clear filters" semantics and the full list in view
  ❌ Up to 5 sequential reads (250 rows) and can still miss older saves
C) Server lookup
  ✅ Exact for any date or volume
  ❌ API contract bump, server tests and a server deploy for a UX nicety (human ~1.5 days / CC ~1.5h)
Net: A gets there in one cheap read using filters the API already has.
Header: Show target
Options:
A) Narrow to the saved date (recommended)
`SavedFlash.occurredOn?` set by ExpenseDrawer/ConversionDrawer from the POST/PATCH result; Show calls `setFilters({ from: occurredOn, to: occurredOn })` then `rearm`; tests: back-dated save excluded by page size → Show → URL has from=to=date → row tinted. Human ~2h / CC ~10min.
B) Page forward up to 5
Show clears filters, then a loop `fetchNextPage` (max 5) until the id renders; tests with a paginated stub. Human ~3h / CC ~15min.
C) Server lookup
New server query param + repository method + OpenAPI 1.x bump + server tests + portal wiring. Human ~1.5 days / CC ~1.5h.

State: approved
Actual answer: C) Server lookup — D10, answered 2026-10-14 (against the recommendation)
Accepted scope: a server `anchor` query param on `GET /v1/expenses` and `GET /v1/conversions` that returns the page starting at that record (inclusive), plus OpenAPI/API_VERSION bump, server tests, and portal wiring for both lists (detail in Amendments §E3). Verified shape: keyset cursors `(occurredOn, id)` newest first, predicates at `server/src/repositories/prisma.ts:1262,1275` and `memory.ts:1491,1509`; `getById(organizationId, id)` is tenant-scoped (`ports.ts:1317,1373`); shared store-contract suites `store-contract-expenses.ts` / `store-contract-conversions.ts` run against memory and Prisma. Implementation choice recorded, not asked: the page is **anchored at** the saved record (it is the first row, older rows follow, a "Show latest" chip clears it), not centred, because centring needs a backward cursor the API does not have.
History: none

Final planning dispositions: T1 accepted (D9 C, build now) with mechanism D10 C (server anchor).

## Approval readiness

Checked: D1 (structure B), D2 (F1 A), D3 (F2 A), D4 (F3 A), D5 (F5 A), D6 (A1 A), D7 (A2 B), D8 (Q1 A), D9 (T1 C), D10 (T1-mech C). Each accepted remedy cites its own answer. Regression contracts are carried in D1/D2/D3/D6 accepted scope. No deferrals open.
Approval readiness: PASS

---

# Amendments from the eng review (authoritative; they override §1–§7 above where they differ)

**Scope now (from D1–D10):** press feedback app-wide, plus after-save for portal expenses **and conversions**, with a server `anchor` so Show always lands on the row. The ticket's AC gets a scope note for conversions and the anchor (D7, D10).

### E1. Press feedback (D2, D6)
- Use `scale: var(--press-scale)` on `:is(.btn, .press):active:not(:disabled)`. Never use `transform`.
- `Button.css` `.btn` transition: `scale var(--duration-press) var(--ease-spring)` replaces `transform 0.1s ease`. Remove `.btn-primary:active` `translateY(1px)`.
- `index.css`: `.press { transition: scale var(--duration-press) var(--ease-spring); }`, plus the shared `:active` rule.
- Add `press` to the 7 portal raw buttons (§3.1). The sign-in toggle keeps its `translateY(-50%)`.
- Applies to every app and portal Button. The ADR says so; CHANGELOG calls out the app-wide visual change.

### E2. After-save store and hook (D1, D3)
- Move the hook to `src/lib/useSavedFlash.ts` (path-only change for 6 importers and the test). `flashTarget` stays in the store.
- `SavedFlash.kind` becomes `'income' | 'payment' | 'expense' | 'conversion'`. Add optional `anchorId?: string` (the record id Show anchors on; for the portal it equals `ids[0]`). The app's `messageFor` handles the two new kinds with `savedFlash.saved`.
- **Backstop:** at `BACKSTOP_MS` the store resolves `claimed:false` only when no registered list currently reports `settled === false`. Otherwise the next settled report resolves it. Add 2 store cases.
- The `useSavedFlashRows` contract is unchanged.

### E3. Server `anchor` (D10)
- **`server/src/schemas.ts`:** `ListExpensesQuerySchema` and `ListConversionsQuerySchema` gain `anchor: uuid.optional()`. Its description reads: "Start the page at this record, inclusive. Filters still apply. Not with `cursor`."
- **`server/src/repositories/ports.ts`:** `ExpenseCursor` and `ConversionCursor` gain `inclusive?: boolean`.
- **`prisma.ts:1262,1275` and `memory.ts:1491,1509`:** use `id: { lte }` / `<=` when `inclusive`.
- **`server/src/routes/expenses.ts`, `conversions.ts`:**
  - `anchor` together with `cursor` returns 422 `VALIDATION_FAILED` (field `anchor`).
  - An anchor id is loaded with `getById(organization.id, anchor)`. Not found or in another organization returns 404 `NOT_FOUND`, so no cross-tenant existence leak.
  - The cursor becomes `{ occurredOn, id, inclusive: true }`.
  - `nextCursor` behaves as today, exclusive.
- **API version and spec:**
  - `server/src/app.ts` `API_VERSION` becomes `1.21.0-mut91`. The MUT-161 qa found this bump being missed.
  - Regenerate the OpenAPI spec (`openapi:check`) and `src/hosted/api/schema.d.ts`.
- **Tests:**
  - `store-contract-expenses.ts` and `store-contract-conversions.ts`: an inclusive cursor returns the anchor first, with a same-day tie on id. These run on memory and on Prisma (`test:db`).
  - `routes-expenses.test.ts` and `routes-conversions.test.ts`:
    - the anchor is the first item, and `nextCursor` continues older;
    - filters still apply;
    - anchor plus cursor returns 422;
    - an unknown id returns 404;
    - an anchor from another org returns 404.
  - `route-security.test.ts`: still green.
- **Cost:** one extra indexed `getById` per anchored request, and only when Show is clicked.

### E4. Portal wiring (D4, D5, D7, D8, D10)
- **`src/hosted/data/filters.ts`:**
  - `ExpensesPageSearch` and `ConversionsPageSearch` gain `anchor?: string`, parsed as a uuid, else dropped.
  - `isNarrowed` counts it.
- **`expenseQueries.ts` and `conversionQueries.ts`:** the first page sends `anchor`; later pages send `cursor` only. `anchor` is part of the query key.
- **`HostedTable`:** add `rowClassName?`.
- **`ExpenseDrawer`:** create and edit call `markSaved({ kind:'expense', ids:[id], profileId, anchorId:id })`. **`ConversionDrawer`** does the same on create, with kind `'conversion'`. Delete calls nothing.
- **`src/hosted/components/SavedNotice.tsx` (new, D5/D7):**
  - It takes the props `{ kind, message }` and the list's `setFilters`.
  - **Claimed:** a sr-only `role="status"` "Saved".
  - **Not claimed, for this kind and profile:** a page-local `<div class="hp-toast hp-toast-info" role="status">` showing "Expense saved" or "Conversion saved", with a Show `Button`.
  - **Show:** `setFilters({ anchor: anchorId })` (other filters cleared), then `rearm({...pending, messaged:true})`.
  - It hides after 6 s and unmounts with the page.
- **Anchored list:** shows a chip "Showing from a saved entry · Show latest" that clears `anchor`.
- **`hosted.css`:** add `.hp-toast-info` (neutral border, no error icon) and the chip style.
- **i18n, en/ar** (`parity.test` enforces them):
  - `hosted.savedFlash.saved`
  - `.expenseSaved` = "Expense saved" / "تم حفظ المصروف"
  - `.conversionSaved` = "Conversion saved" / "تم حفظ التحويل"
  - `.show` = "Show" / "عرض"
  - `.anchored` = "Showing from a saved entry" / "عرض ابتداءً من القيد المحفوظ"
  - `.showLatest` = "Show latest" / "عرض الأحدث"
- **`src/index.css`:** `tr.row-flash > td` (generalised from `.data-table`). Add `[dir="rtl"] tr.row-flash > td:first-child { box-shadow: inset -3px 0 0 var(--accent); }`.

### E5. Bundle separation (AC2), unchanged from §3.3
The hosted rules cover `mutaba3a-active-profile` and `/clients/$clientId`; the local rule covers `.hp-toast`. Rules are added red-first in `check-bundles.test.ts`.

### E6. Gate
- **Root:** `npm run lint && npm run typecheck && npm run test:run && npm run build && npm run test:bundles` (Node 22).
- **Server:** `npm --prefix server run typecheck && npm --prefix server run lint && npm --prefix server run openapi:check && npm --prefix server test`.
- **Postgres:** `test:db` runs in CI for the Prisma store contract. Run it locally if a Postgres is available.
- **MUT-43 guard:** `git diff --exit-code main -- src/hosted/session/__tests__/auth-states.test.tsx`.

### E7. Knowledge (replaces §6 where different)
- **DECISIONS:**
  - New ADR (next free; ADR-074 at review time): L10 press feedback is app-wide, via the `scale` property, through `.btn`/`.press`.
  - Amend ADR-057 with §8: the portal claims through the same store; the backstop waits for fetching lists; Show anchors through the server `anchor` param.
  - Append the API change to the hosted API ADR trail (ADR-037 lineage).
- **TECH_DEBT:** no pagination TD (D9 built it). One residual is noted in the ADR: more than 50 records older than the anchor still need Show more, which is by design.
- **PATTERNS:** "Press feedback: Button or `.press`, `scale` not `transform`". "List anchors: `anchor` param = inclusive keyset start".
- **COMPONENT_REGISTRY:** `SavedNotice`, `HostedTable.rowClassName`, `.press`, and the new `useSavedFlash` path.

## NOT in scope
- **The legacy `.btn-*` duplicates in `src/index.css:1300-1340`.** They are pre-existing, and the press rule doesn't depend on them. They belong to the MUT-103 sweep.
- **Centring the anchored page with newer rows above it.** That needs a backward cursor, and the "Show latest" chip covers it.
- **App after-save for expenses** (the app's own expense drawer). It isn't in HP1 or this ticket.
- **TODOS.md #4, an app-wide surface for failed refetches.** The portal's QueryView already covers its own lists.

## What already exists
- **`DrawerFrame`** (`src/components/ui/drawer/`, MUT-80): the portal's `Drawer` already wraps it. R2 is reused, not rebuilt, so AC1's drawer half needs only a guard test.
- **`savedFlashStore` and `useSavedFlashRows`** (MUT-81, ADR-057): reused as-is apart from the backstop fix (D3) and the kind union. Only the presentation (`SavedNotice`) is portal-specific, because the app's announcer depends on app-only routing, profile and toast stores that the portal lint forbids.
- **Brand v2 motion tokens** `--press-scale` / `--duration-press` (MUT-102), with reduced-motion zeroing in `theme.css:111-117`: reused, no new numbers.
- **The portal `QueryView` Unreachable card**: it already handles failed refetches, which D4's neutral copy relies on.
- **Keyset cursors and the tenant-scoped `getById`**: `anchor` is a predicate flag on top of them, not a new query path.

## Failure modes

| New path | Realistic failure | Test / handling | User sees |
|---|---|---|---|
| Press `scale` | an element already has a `scale` property and gets overridden | CSS contract test; no current element uses `scale` (grep) | brief size change on press only |
| Backstop waits for lists | a registered list never settles (stuck fetch) | TanStack fetch eventually errors, and the error counts as settled; store test | message after the fetch resolves or fails, never silence-forever while mounted |
| `SavedNotice` | save from another profile tab | profileId guard + test | nothing (correct) |
| `anchor` server | anchor id from another org | 404 test, tenant-scoped `getById` | portal falls back to the Unreachable/NotFound handling for that list; Show latest clears it |
| `anchor` server | anchor deleted between save and Show | 404 test | as above; the chip clears it |
| `anchor` + filters | anchor doesn't match the remaining filters | Show clears all filters first; route test that filters still apply | list starts at its key position without the row (only if the user re-adds filters) |
| Deploy skew | portal sends `anchor` to an older server | the portal and API ship in one deploy (server serves `portal.distDir`); zod would reject an unknown param with 422 → Unreachable card | no silent failure |

Critical gaps (untested and silent): none.

## Worktree parallelization strategy

| Step | Modules touched | Depends on |
|------|----------------|------------|
| S1 press feedback | src/components/ui, src/index.css, src/hosted/shell + pages/auth + components (classes) | — |
| S2 store/hook move + backstop | src/lib, src/hooks, src/components (import paths) | — |
| S3 server anchor | server/src (schemas, repositories, routes, tests), openapi spec | — |
| S4 portal wiring | src/hosted (api schema.d.ts, data, components, pages, i18n), src/index.css | S2, S3 |
| S5 bundle rules + knowledge | scripts/, .claude/ | S1, S4 |

Lane A runs S1. Lane B runs S2 then S4. Lane C runs S3. Launch A, B (S2) and C together. Merge C, then finish S4 in lane B. Then S5.
Conflict flags: S1 and S4 both edit `src/index.css`, in separate rules; sequence the merge. Per Basel's routine ([[feedback-one-worktree-per-repo-per-epic]] and apple-design-pass-state), the build runs in **one** worktree, sequentially, in this order: S3 → S2 → S1 → S4 → S5.

## Implementation Tasks
Synthesized from this review's findings. Each task comes from a specific finding above.

- [ ] **T1 (P1, human: ~1h / CC: ~5min)**: press: `scale`-based `:is(.btn,.press):active` rule, transitions, 7 portal `press` classes
  - Surfaced by: F1 (hosted.css:168), D2, D6
  - Files: src/components/ui/Button.css, src/index.css, src/hosted/shell/UserMenu.tsx, ProfileSwitcher.tsx, src/hosted/components/Brand.tsx, src/hosted/pages/views/PaymentsList.tsx, src/hosted/pages/auth/SignInPage.tsx
  - Verify: CSS contract test in brand.test.ts; Playwright pointer-down (sign-in toggle box unchanged; app + portal Button scale 0.96)
- [ ] **T2 (P1, human: ~2h / CC: ~10min)**: store backstop waits for fetching lists, plus the hook move to lib/
  - Surfaced by: F2 (savedFlashStore.ts backstop), D1, D3
  - Files: src/lib/savedFlashStore.ts, src/lib/useSavedFlash.ts (moved), 6 importers, src/lib/__tests__/
  - Verify: `npx vitest run src/lib src/components/layout src/components/home src/components/clients src/pages/income`
- [ ] **T3 (P1, human: ~1.5d / CC: ~1.5h)**: server `anchor` on expenses and conversions lists
  - Surfaced by: T1/D9, D10
  - Files: server/src/schemas.ts, repositories/ports.ts, prisma.ts, memory.ts, routes/expenses.ts, routes/conversions.ts, app.ts (API_VERSION), store-contract-expenses.ts, store-contract-conversions.ts, routes-expenses.test.ts, routes-conversions.test.ts, OpenAPI spec
  - Verify: server typecheck, lint, openapi:check, test (+ test:db where available)
- [ ] **T4 (P1, human: ~1d / CC: ~45min)**: portal after-save for expenses and conversions with `SavedNotice` and anchor chip
  - Surfaced by: F3/F5, D4, D5, D7, D10
  - Files: src/hosted/api/schema.d.ts, data/filters.ts, data/expenseQueries.ts, data/conversionQueries.ts, components/HostedTable.tsx, ExpenseDrawer.tsx, ConversionDrawer.tsx, SavedNotice.tsx (new), pages/views/ExpensesList.tsx, ConversionsList.tsx, hosted.css, i18n/en.json, ar.json
  - Verify: `npx vitest run src/hosted`; parity test; `git diff --exit-code main -- src/hosted/session/__tests__/auth-states.test.tsx`
- [ ] **T5 (P2, human: ~20min / CC: ~3min)**: generalise `tr.row-flash > td` and mirror the bar in RTL
  - Surfaced by: Q1 (index.css:2139-2141), D8
  - Files: src/index.css
  - Verify: Playwright in AR on portal and app
- [ ] **T6 (P2, human: ~1h / CC: ~5min)**: bundle rules (2 hosted, 1 local), red-first
  - Surfaced by: AC2, D1
  - Files: scripts/bundle-rules.ts, scripts/__tests__/check-bundles.test.ts
  - Verify: `npm run test:bundles`
- [ ] **T7 (P2, human: ~1h / CC: ~10min)**: knowledge files, plus the ticket scope note on MUT-91
  - Surfaced by: D6, D7, D10
  - Files: .claude/DECISIONS.md, PATTERNS.md, COMPONENT_REGISTRY.md, CHANGELOG.md, TEST_PLAN.md, SYSTEM_OVERVIEW.md
  - Verify: qa-reconcile

## Unresolved decisions
None.

## Completion summary
- Step 0: Scope Challenge: scope accepted as-is (D1 smaller arrangement; later answers D7/D9/D10 widened scope at Basel's choice)
- Architecture Review: 2 issues found (A1, A2)
- Code Quality Review: 2 issues found (Q1, Q2)
- Test Review: diagram produced, 23 gaps identified, all mapped to approved tests
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 1 item proposed to user (built now, D9)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (CLI not installed; native fallback lacks TaskOutput)
- Parallelization: 3 lanes possible, 2 parallel / 1 sequential; built sequentially in one worktree per Basel's routine
- Lake Score: 7/8 = answers picking a 10/10 option (D2, D3, D4, D6, D7, D8, D10) / answers scored for Completeness (D9 unscored)

## Suppressed findings (appendix)
- (confidence 4/10) jsdom-free proof of `:active` on iOS Safari. React's root `touchstart` listener should enable `:active` on touch. Unverified on a device; worth one iPhone tap during QA.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex `/plan-eng-review` outside voice | Independent 2nd opinion | 22 | unavailable | codex CLI not installed; native fallback lacks TaskOutput |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 21 | issues_open | 4 issues, 0 critical gaps (all resolved: D1–D10) |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 for MUT-91 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable (CLI not installed). The native fallback is unavailable (no TaskOutput). No outside findings.
- **VERDICT:** Eng Review issues_open; every finding has an approved remedy (D1–D10) and no decision is pending, so it's ready to build per the Amendments. A design review is optional for the new notice and the anchor chip. Eng review required.

NO UNRESOLVED DECISIONS
