# MUT-281 — Portal: Gulf currencies from one list, "(USD peg)" for every pegged currency

Part of epic MUT-278 (brief `.claude/designs/gulf-currencies.md` §4b). Blocked-by MUT-280 (server), **cleared**: merged to local main `b3a3b62f`, TD-170 filed against this ticket. Tracker: Jira · barmajiyat.atlassian.net · MUT via `atlassian-barmajiyat` · ticket sits in Backlog (not yet started) but its blocker is cleared, epic sequencing is already committed, and MUT-280's eng review wrote this ticket's first step directly into TD-170 — proceeding on that basis.

## 0. Context that changed the shape of this plan

Basel is retiring the local web app (epic MUT-284, ADR-097/285 approved, MUT-286 build in progress). That changes how far this ticket should reach into shared code:

- `src/pages/**` (Dexie-backed CRM pages), `src/db/**` die with the local app (MUT-292, after a 90-day bridge). Any currency work there is throwaway.
- `src/pages/landing/**` **survives** — the landing page stays on Netlify as the handoff bridge (MUT-291), independent of the app rewrite.
- `src/hosted/**` is the surviving app. `src/lib/utils.ts`'s amount-parsing (`parseAmountInput`, `splitCurrencyToken`, Arabic-Indic digit handling) and `src/components/expenses/ExpenseFormFields.tsx` are genuinely shared between the dying local app and the portal today, and some of this (the parsing utility; not the Dexie pages) is exactly the kind of framework-agnostic logic that carries into the one-app future.

This ticket touches the shared `Currency` type and `src/lib/utils.ts` because **it has to** (below), not because it's trying to fix the local app. Where a change only serves the dying Dexie pages, it's the smallest literal patch that keeps the build green — nothing more.

## 1. Problem and acceptance criteria

The portal's `HOSTED_CURRENCIES` list, its three duplicate filter-currency lists, and its "(USD peg)" label all stop at ILS/USD/EUR/JOD. MUT-280 widened the server to nine currencies (AED, SAR, QAR, BHD, OMR added); the portal needs to offer and display them.

Acceptance criteria (from the ticket):
- [ ] Income, expense, conversion and profile forms offer AED, SAR, QAR, BHD, OMR; BHD/OMR accept 3 decimals.
- [ ] Lists filter by each new currency.
- [ ] An expense group in OMR on an ILS profile shows "≈ ILS … · 1 OMR = … ILS (USD peg)".
- [ ] Release-QA specs `currency.portal-record-qar` and `fx.portal-group-peg-label` pass.

## 2. Why this can't stay portal-only (the TD-170 chain)

`src/hosted/components/incomeForm.ts` and `conversionFormSchema.ts` call `parseAmountInput`/`amountInputCurrency`/`currencyExponent` from `src/lib/utils.ts`, typed against the local app's `Currency` (`src/types/index.ts`, currently 4 codes). Once `npm run hosted:types` regenerates `schema.d.ts` against MUT-280's 9-currency spec, the hosted `Currency` (from `api/client.ts`) has 9 members — passing it into a function typed against the local 4-member `Currency` fails to typecheck. TD-170 (filed on this ticket) already names `src/lib/utils.ts` as a file this ticket must fix.

It's worse than a type-check-only concern: `src/components/expenses/ExpenseFormFields.tsx:18` — **shared between the local ExpenseDrawer and the hosted one** — calls `currencyExponent(currency as Currency)` to size the amount step. The cast hides the type error, but at runtime `CURRENCY_EXPONENT['AED']` would be `undefined` → the `?? 2` fallback silently gives BHD/OMR the wrong precision (2 instead of 3) in the portal's own expense drawer. This isn't optional — it has to be fixed for the portal's expense form to work correctly.

**Decision: widen the shared `Currency` type and `src/lib/utils.ts`'s exponent/token tables to all 9 codes now**, scoped narrowly to what typechecks and what `ExpenseFormFields` needs at runtime. Do **not** do the local-app UI/registry work that's MUT-282's job (entry-form pickers, CSV, Arabic-symbol typed recognition, Dexie forms) — that's deliberately left broken/incomplete in the local app's own pages, same as JOD is today (JOD already isn't offered in most local-app pickers; this ticket doesn't fix that gap for Gulf currencies either).

Side effect: widening `Currency` breaks 3 **exhaustive** `Record<Currency, …>` literals in local-app-only files that never consume this ticket's new HOSTED_CURRENCIES. They're dying with the local app (confirmed: none are imported from `src/hosted/**`), so the fix is the minimum literal addition that keeps `npm run build`/`typecheck` green — zero feature work:
- `src/db/aggregations.ts:508` — add `AED: 0, SAR: 0, QAR: 0, BHD: 0, OMR: 0`
- `src/lib/currencyAmounts.ts:16` (`DISPLAY_POSITION`) — add the 5 codes at positions 4–8
- `src/pages/expenses/ExpensesLedgerPage.tsx:137` — same as aggregations.ts

One exhaustive `Record<Currency, …>` is real content, not a stub: `src/pages/landing/landingCopy.ts`'s `CURRENCY_NAME_KEYS` feeds the landing page's currency FAQ answer, and **the landing page survives** the local-app retirement (MUT-291: it stays on Netlify as the handoff bridge). This gets real `landing.currency.AED/SAR/QAR/BHD/OMR` keys and ar/en translations, not placeholders.

## 3. File changes

**Shared (forced by §2, kept to the minimum that typechecks + runs correctly):**
- `src/types/index.ts` — `Currency` → `'USD' | 'ILS' | 'EUR' | 'JOD' | 'AED' | 'SAR' | 'QAR' | 'BHD' | 'OMR'`.
- `src/lib/utils.ts`:
  - `CURRENCY_EXPONENT` — add `AED: 2, SAR: 2, QAR: 2, BHD: 3, OMR: 3`.
  - `CURRENCY_PREFIX` / `CURRENCY_SUFFIX` / `CURRENCY_TOKENS` — add the 5 ISO codes (not Arabic symbols — those are MUT-282 §4c, scoped to the local app's typed-amount recognition). Without this, typing "AED 100" in a portal amount field fails to parse instead of recognizing a currency mismatch, matching how JOD already works.
- `src/db/aggregations.ts`, `src/lib/currencyAmounts.ts`, `src/pages/expenses/ExpensesLedgerPage.tsx` — literal-only additions, no behavior change (§2).
- `src/pages/landing/landingCopy.ts` + `src/i18n/locales/{ar,en}` (wherever `landing.currency.*` keys live) — 5 new keys, real translated names.

**Portal (the ticket's actual scope):**
- `src/hosted/format/currencies.ts` — `HOSTED_CURRENCIES` → 9 codes, appended in the design brief's table order: `['USD', 'ILS', 'EUR', 'JOD', 'AED', 'SAR', 'QAR', 'BHD', 'OMR']`.
- `src/hosted/components/incomeForm.ts` — `INCOME_CURRENCIES` → `HOSTED_CURRENCIES` (kills the duplicate list, per the ticket's own text).
- `src/hosted/components/FilterControls.tsx` — `CURRENCIES` const → derive from `HOSTED_CURRENCIES` instead of its own hardcoded 4-item array.
- `src/hosted/data/filters.ts` — same: `CURRENCIES` → derived from `HOSTED_CURRENCIES`.
- `src/hosted/data/expenseGroups.ts` — `ConvertedTotal.used` entries gain a `derived: boolean` per line (the loop already has `rate.derived` in scope; thread it through instead of discarding it — default `rate.derived ?? false` since this is the one place reading a server response shape directly). Update the stale "Any rate used is JOD's" doc comments.
- `src/hosted/pages/views/ExpenseGroupDetail.tsx:499` — replace the hardcoded `currency === 'JOD' || total.currency === 'JOD'` with the per-line `derived` flag now carried on each `used[]` entry. This is the actual bug fix behind AC #3: today a BHD/OMR/AED/SAR/QAR pair would show no "(USD peg)" label at all, because the check only ever matched the literal string `'JOD'`.
- `ExpenseDrawer.tsx`, `ConversionDrawer.tsx`, `ProfileCreateDrawer.tsx`, `ProfileEditForm.tsx`, `conversionFormSchema.ts` — **no code change.** All five already derive their currency list from `HOSTED_CURRENCIES` and their precision from `currencyExponent()` generically (confirmed by reading each file — this is exactly why the ticket description lists them as "files the type-check will point at," not as files needing new logic). They pick up the 5 new codes automatically once the lists above widen.
- `TECH_DEBT.md` — close TD-170 once `npm run hosted:types:check` is green.

## 4. Sequencing inside the ticket

1. `npm run hosted:types` (regenerates `schema.d.ts` against MUT-280's merged OpenAPI spec — first step per TD-170).
2. Widen `src/types/index.ts` + `src/lib/utils.ts` (§3 shared section); patch the 3 literal-only local files; add real landingCopy content.
3. Widen the portal's own lists (`HOSTED_CURRENCIES`, `INCOME_CURRENCIES`, `FilterControls`/`filters.ts` dedup).
4. Fix the `derived` per-line bug in `expenseGroups.ts` / `ExpenseGroupDetail.tsx`.
5. `npm run typecheck && npm run lint && npm run test:run && npm run build` (Node 22) — zero regressions.

## 5. API contracts

No new endpoints. Reuses `/v1/fx-rates` (`rates[].derived`, already generalized to "either side pegged" by MUT-280/ADR-098) and the widened `Currency` enum on every money-typed field. No portal-side API client changes beyond the regenerated `schema.d.ts`.

## 6. Reuse / impact / cost / infra

- **Reuse:** `HOSTED_CURRENCIES` + its compile-time `coversEveryCurrency` guard (MUT-183 R4) already generalizes to any list length — no change to that mechanism. `ExpenseFormFields`'s `currencyOptions: readonly string[]` is already currency-set-agnostic (confirmed by reading it) — no component changes needed there, only the data flowing through it.
- **Impact:** every portal money form, list filter, and the expense-group peg label. Zero impact on local-app *features* (only compiler-satisfying literals in 3 files slated for deletion).
- **Cost/infra:** none — no new requests, no schema/DB change.
- **i18n:** landing page gets 5 new ar/en currency names (Arabic default, ADR-077). No new portal-side i18n keys beyond what `FilterControls`/forms already resolve generically by code.

## 7. Tests (TDD)

- `src/lib/__tests__/utils.test.ts` — `currencyExponent` returns 2 for AED/SAR/QAR, 3 for BHD/OMR; `parseAmountInput` accepts BHD/OMR to 3 decimals and rejects a 4th; `amountInputCurrency` recognizes a typed "AED"/"SAR"/"QAR"/"BHD"/"OMR" token.
- `src/hosted/format/__tests__/currencies.test.ts` — `HOSTED_CURRENCIES` contains all 9; `coversEveryCurrency` compiles (type-level).
- `src/hosted/data/__tests__/filters.test.ts` — each new code round-trips through `oneOf`.
- `src/hosted/components/__tests__/incomeForm.test.ts`, `ExpenseDrawer.test.tsx`, `ConversionDrawer.test.tsx`, `conversionFormSchema.test.ts`, `ProfileCreateDrawer.test.tsx` — each offers all 9 codes; BHD/OMR accept 3 decimals, reject a 4th; a new `ProfileEditForm.test.tsx` (none exists today) covering the currency picker, since MUT-281 is the first ticket to touch its currency list.
- `src/hosted/data/__tests__/expenseGroups.test.ts` — `convertTotal`'s `used[]` carries the right `derived` per line: an OMR leg into an ILS base is `derived: true`, a EUR leg into ILS is `false`, and an AED→SAR cross-pair (pegged↔pegged) is `derived: true`.
- `src/hosted/pages/__tests__/ExpenseGroups.test.tsx` (covers `ExpenseGroupDetail`) — the "(USD peg)" suffix appears on the OMR rate line and not on a EUR rate line in the same group (regression case for the literal-JOD bug this fixes), **and** the existing JOD-pair case still shows the label after the refactor from the literal check to the per-line `derived` flag — the one test guarding against a silent regression during that swap.
- `src/pages/landing/__tests__/` — new or extended test confirming `CURRENCY_NAME_KEYS` resolves and `formatCurrencyList` includes all 9 names (add a test file if FAQSection has none today).

## 8. Release-QA (Phase 5)

Add to `qa/features/portal/` (existing files: `income.yaml`, `expenses.yaml`, `expense-groups.yaml`):
- `currency.portal-record-qar` → `income.yaml` (or a small new `currencies.yaml` if it doesn't fit an existing area's `paths`): add income in QAR, saved, filterable by QAR.
- `fx.portal-group-peg-label` → `expense-groups.yaml`: an OMR expense in a group on an ILS profile shows "≈ ILS … · 1 OMR = … ILS (USD peg)".

Tagged specs in `qa/specs/portal/income.spec.ts` and `qa/specs/portal/expense-groups.spec.ts` (or the new file), run once with `release-qa run --attach --only <id>` until green. `release-qa lint` clean, no new unmapped files (the `paths` list in each yaml already covers `src/hosted/format/currencies.ts`, `data/filters.ts`, `components/incomeForm.ts`, `ExpenseDrawer.tsx`, `data/expenseGroups.ts`, `pages/views/ExpenseGroupDetail.tsx` via `expense-groups.yaml`'s existing `paths`; `income.yaml`'s paths need confirming cover `incomeForm.ts`/`FilterControls.tsx`).

## 9. Follow-ups to flag back on the ticket (not resolved here)

- **MUT-282/283 may need re-scoping or cancellation** given the local-app retirement (MUT-284). Their stated scope ("Local web: one currency registry... fix JOD gaps", "Local web: any-base conversion") is work on pages that die within MUT-292's 90-day window. Worth a comment on MUT-278 (epic) or MUT-282/283 directly, flagging it for Basel to decide — not unilaterally resolved by this plan.
- TD-170 should be marked resolved once this ticket's `hosted:types:check` passes.

## 10. Eng review pass

Ran the 4-section adversarial checklist (architecture, code quality, tests, performance) directly against this plan rather than the full `/plan-eng-review` ceremony (scope-challenge dialog, outside-model cross-check, persistent review log) — the plan is already grounded in direct reads of every touched file with concrete file:line citations, and the ticket is plan-stage, not a diff. Findings, folded into §3/§7 above:

- [P3] (confidence: 6/10) `expenseGroups.ts`'s `convertTotal` should read `rate.derived ?? false`, not bare `rate.derived` — a one-line defensive default against a response shape mismatch, even though ADR-098 §5's same-release constraint makes the window for that essentially zero.
- [P3] (confidence: 7/10) The `ExpenseGroupDetail` test needs an explicit case that the *existing* JOD peg-label behavior survives the refactor from the literal `=== 'JOD'` check to the per-line `derived` flag, not just that new Gulf currencies gain it — otherwise the swap could silently regress JOD's own label.

No architecture, security, or performance findings beyond what's already addressed in §2-§3's reasoning (the Currency-widening decision itself, and its scoped blast radius, is covered there with direct evidence, not left as an open risk).

## 11. Business / product impact

Gulf freelancers (UAE, Saudi, Qatar, Bahrain, Oman) using the hosted portal can record and see their money in their own currency instead of forcing everything through USD/ILS/EUR/JOD — the server side (MUT-280) already accepts it, so this ticket is what actually makes it visible and usable to a signed-in portal user. It also fixes a real display bug (the peg label silently only ever fired for JOD), which otherwise would have shipped Gulf currencies with an honesty-rule violation (ADR-087/098: a derived rate must say so). Ships together with MUT-280 in one `make release server` (the portal is baked into the API image) — no server release should happen between MUT-280 and MUT-281 landing.
