# MUT-140 — Add JOD as a supported currency for income and expense entry

> **Status:** Plan approved for build
> **Date:** 2026-10-13
> **Jira:** MUT-140 (Story, Backlog → Planned)
> **Blocks:** MUT-141 (currency conversion logging) — that feature needs this
> per-currency exponent rework to handle its JOD-side amounts correctly.

---

## Ground-truth findings (read the code before planning the code)

1. **`Currency` is duplicated, not shared, between client and server**: `src/types/index.ts` (`'USD' | 'ILS' | 'EUR'`) and `server/src/money.ts` (`SUPPORTED_CURRENCIES = ['ILS','USD','EUR']`). No shared package — this is already the repo's existing pattern, not something to "fix" here.

2. **The real risk is decimal precision, not the currency list.** JOD is a 3-decimal currency (1 JOD = 1000 fils). Every other currency here is 2-decimal. The sister Flutter app hit this exact shape of bug: MUT-72 shipped JOD at 2 decimals as an accepted shortcut, then needed a dedicated follow-up (MUT-119) to rework its money codec because the 2-decimal assumption was baked into shared formatting/parsing code used everywhere. This repo has the identical risk:
   - `server/src/money.ts` already does this right — `EXPONENT: Record<Currency, number>` is per-currency. Just needs `JOD: 3` added.
   - `src/lib/utils.ts` does **not** do this right — `formatAmount`'s `Intl.NumberFormat` call hardcodes `maximumFractionDigits: 2` and divides by `100`; `parseAmountInput`'s core arithmetic (`whole * 100 + cents`) is hardcoded base-100 **even when `maxDecimals: Infinity` is passed** (callers that already "allow" unlimited decimals still silently round to 2 — confirmed by existing test `parseAmountInput('100.999', { maxDecimals: Infinity })).toBe(10100)`, i.e. rounds to 101.00). This is the actual bug surface.

3. **`parseAmountInput`/`parseAmountToMinor`/`parseCurrencyInput` take no currency parameter today.** Callers: `IncomeDrawer.tsx` (zod refine ×2, line 295), `ExpenseDrawer.tsx` (lines 236, 263, via `parseAmountToMinor`), `RetainerDrawer.tsx` (3 call sites), `PlanAssumptionDrawer.tsx` (line 142), `recurringAttention.ts` (line 130), `paymentEntry.ts` (line 32). Making parsing currency-aware means threading a currency/exponent through every one of these — this is the shared-code, non-additive change the ticket's own description already called out.

4. **Settings currency-gating is dead code, not a real mechanism — ticket AC needs correcting.** `SettingsPage.tsx:322-339`'s "Enabled currencies" toggle is entirely JSX-commented-out, and `handleCurrencyToggle` itself is commented out too. Worse: `IncomeDrawer`'s currency `<Select>` (line 669) maps directly over the hardcoded `CURRENCIES` constant, **not** `settings.enabledCurrencies` — so even if the toggle were live, it doesn't gate anything today. EUR is proof: it's a full `Currency` member and selectable in Income entry right now, with zero Settings involvement.
   - **MUT-139 is actively in progress** (uncommitted changes already in `SettingsPage.tsx`, `ProfileDetailPage.tsx`, `ImportDataPage.tsx` today) and its own plan explicitly restores that toggle **USD/ILS-only**, logging the EUR gap as accepted tech debt — not something to extend for JOD.
   - **Decision (confirmed during planning):** drop the Settings-gating acceptance criterion. JOD joins the hardcoded currency lists directly, exactly how EUR behaves today. Zero file overlap with MUT-139's in-flight work. The Jira ticket's AC will be corrected to match (see "Ticket reconciliation" below).

5. **`ExpenseDrawer`'s `currencyOptions` prop is already hardcoded to `['USD', 'ILS']`** (excludes EUR, a pre-existing gap, not something this ticket fixes) — JOD joins this array too, without touching the EUR gap.

6. **`formatAmountShort` and `formatCurrencyInput` have zero callers anywhere in `src`.** Dead code. Not touched by this ticket (confirmed via repo-wide grep) — no need to fix their already-broken EUR handling (`formatAmountShort`'s symbol map is `currency === 'USD' ? '$' : '₪'`, silently wrong for EUR/JOD, but unreachable).

---

## File-level plan

### 1. `server/src/money.ts`
- Add `'JOD'` to `SUPPORTED_CURRENCIES`.
- Add `JOD: 3` to `EXPONENT`.
- No other change needed — `parseMoney`/`formatMoney`/`currencyExponent` are already per-currency; this file is the reference implementation for what `utils.ts` needs to become.

### 2. `src/types/index.ts`
- `Currency = 'USD' | 'ILS' | 'EUR' | 'JOD'`.

### 3. `src/lib/utils.ts` (the core rework)
- Add a client-side `CURRENCY_EXPONENT: Record<Currency, number>` (mirrors `server/src/money.ts`'s `EXPONENT` — kept duplicated, matching the existing client/server duplication pattern, not shared).
- `formatAmount`: replace hardcoded `minimumFractionDigits: 0, maximumFractionDigits: 2` with `maximumFractionDigits: CURRENCY_EXPONENT[currency]` (keep `minimumFractionDigits: 0` so whole amounts still don't show trailing zeros); replace `/ 100` with `/ 10 ** CURRENCY_EXPONENT[currency]`. Formatter cache key already includes currency, no change needed there.
- `parseAmountInput`: add a **required** `currency` field to `ParseAmountOptions` — no default. (Plan-review finding: a default of `'USD'` would let a future JOD call site compile without passing currency and silently round to 2 decimals instead of 3 — exactly the bug class this ticket exists to kill. Required-field + every call site updated below closes that gap at compile time.) Replace `MINOR_DIGITS = 2` hardcoding in the whole/cents/roundUp arithmetic with `const exponent = CURRENCY_EXPONENT[currency]`; generalize `whole * 100 + cents + roundUp` to `whole * 10 ** exponent + cents + roundUp` with `cents`/`roundUp` sized to `exponent` digits instead of 2. `maxDecimals` derives from the currency's exponent instead of the flat literal `2`.
- `parseAmountToMinor` / `parseCurrencyInput`: add a required `currency: Currency` parameter (no silent default — every caller must be explicit, which is the compile-time safety net that prevents the next currency addition from repeating this exact bug).
- `amountInputCurrency` / `CURRENCY_TOKENS`: add `JOD` to the token map and the `CURRENCY_PREFIX`/`CURRENCY_SUFFIX` regex alternation (no common symbol for JOD, just the code token, same treatment as `EUR`/`USD`).
- `formatAmountShort`, `formatCurrencyInput`: **not touched** (dead code, confirmed above).

### 4. Caller updates (signature change ripples here)
- `IncomeDrawer.tsx`: `CURRENCIES` const → add `'JOD'`; zod enum same; the two `.refine()` calls (lines 74-75) and the parse at line 295 need the selected currency passed into `parseAmountInput`/`parseAmountToMinor`.
- `ExpenseDrawer.tsx`: zod enum already includes nothing to change (already `z.enum(['USD','ILS','EUR'])` — EUR already allowed by schema, just never offered in the UI list); add `'JOD'` to the `currencyOptions={['USD', 'ILS']}` prop (line 434); update the two `parseAmountToMinor(data.amount)` calls (lines 236, 263) to pass `data.currency`.
- `RetainerDrawer.tsx`, `PlanAssumptionDrawer.tsx`: update their `parseAmountToMinor(...)` calls to pass their transaction's currency explicitly. These stay USD/ILS in practice (retainers/plan assumptions aren't in this ticket's scope), so behavior is unchanged — this is purely satisfying the new required parameter.
- `recurringAttention.ts`, `paymentEntry.ts`: same — thread the relevant transaction's currency into the existing `parseAmountInput` calls.

### 5. `src/utils/csvValidation.ts`
- Add `'JOD'` to `VALID_CURRENCIES`.

### 6. Tests (TDD — write/update first)
- `server/src/__tests__/money.test.ts`: JOD round-trips `parseMoney`/`formatMoney` at 3 decimals; rejects a 4th fractional digit; existing ILS/USD/EUR 2-decimal behavior unchanged.
- `src/lib/__tests__/utils.test.ts`: this is where the real regression risk lives.
  - New `formatAmount(amountMinor, 'JOD')` cases at 3 decimals.
  - New `parseAmountInput(value, { currency: 'JOD' })` cases accepting a 3rd decimal, rejecting a 4th.
  - **Explicitly re-assert the existing USD/ILS/EUR cases still hold** after the arithmetic generalizes from base-100 to base-`10**exponent` — this is the regression gate for AC "Existing USD/ILS/EUR entries, totals, and CSV round-trips are unaffected."
  - Fix/re-verify the `maxDecimals: Infinity` rounding tests (line 230-233) now that the rounding math is exponent-driven rather than hardcoded `MINOR_DIGITS = 2` — confirm USD still rounds to 2dp in that path and add the JOD equivalent rounding to 3dp.
- `src/components/drawers/__tests__/IncomeDrawer.test.tsx` / `ExpenseDrawer.test.tsx` (if they exist — check first): JOD selectable, 3-decimal amount accepted, 4th decimal rejected.
- `src/utils/__tests__/csvValidation.test.ts` (if it exists): JOD row validates.

---

## Ticket reconciliation (plan vs. committed AC)

The approved Jira description's AC #5 — *"A profile must enable JOD in Settings (enabledCurrencies) before it appears as an entry option"* — describes a gating mechanism that doesn't functionally exist for any currency today (finding #4 above). Per the office-hours-style scoping done alongside this plan: **drop that AC**, JOD becomes directly selectable in the Income/Expense drawers exactly like EUR is today. I'll edit the Jira description to replace that AC with "JOD is directly selectable, with no Settings precondition (matching EUR's current behavior)" before moving the ticket to Planned.

---

## Quality bar

- **DRY/reuse:** no new abstraction — extends the exact per-currency-exponent pattern `server/src/money.ts` already established; client and server intentionally stay separately-maintained constants, matching existing duplication, not a new shared package (out of proportion to this ticket).
- **Testable:** every change is pure-function arithmetic/formatting with existing unit test files to extend; no network, no DB.
- **Scalable:** no data-shape change, no migration, no new indexes — `Currency` is a TS union, not a DB-enforced enum anywhere found.
- **Cost:** zero new dependencies, zero new runtime cost.
- **Constraints honored:** CLAUDE.md currency rules (store original amount + currency, per-currency reporting) — untouched, since scope explicitly excludes FX conversion for JOD.

---

## Plan review (eng-manager pass)

- **Architecture:** one finding, folded into the plan above — `ParseAmountOptions.currency` must be required, not defaulted to `'USD'` (a default would let a future call site silently round JOD to 2dp instead of failing to compile).
- **Code quality:** no shared-code extraction warranted between client (`src/lib/utils.ts`) and server (`server/src/money.ts`) — they already duplicate `Currency`/`SUPPORTED_CURRENCIES` independently with no existing bridge; mirroring the server's established per-currency pattern on the client is correct, building a shared package is not proportionate to this ticket.
- **Tests:** regression rule applies — the `parseAmountToMinor`/`parseCurrencyInput` signature change (adding a required `currency` param) is a risk to every existing USD/ILS/EUR caller (`IncomeDrawer`, `ExpenseDrawer`, `RetainerDrawer`, `PlanAssumptionDrawer`, `recurringAttention.ts`, `paymentEntry.ts`) and must ship with explicit re-assertions that their behavior is unchanged, in the same change, not after. `ExpenseDrawer` has no existing general test file — JOD/currency coverage there is net-new, not an extension. No E2E/eval tier needed; this is unit-test territory (pure parsing/formatting + form validation, no multi-service flow).
- **Performance:** no concerns — no DB access, no loops over collections, pure arithmetic/formatting.
- **Verdict:** sound after the one architecture fix above (applied to this doc).

## Business / product impact

Closes a real gap for a freelancer accounting tool serving a market with real Jordanian-dinar billing relationships — without it, a user invoicing or paying in JOD has to misrepresent those amounts in a currency they aren't actually using. It also retires a specific, previously-identified risk (the Flutter app's exact 2-decimal-then-rework path) before it repeats itself in this codebase, and it directly unblocks MUT-141 (currency conversion logging), which depends on this same per-currency precision fix to handle JOD-side conversion amounts correctly.
