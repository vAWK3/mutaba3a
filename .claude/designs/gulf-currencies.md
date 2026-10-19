# Gulf currencies (AED, SAR, QAR, BHD, OMR) and any-base conversion

Status: **Approved by Basel 2026-10-18.** Phone ships first (no server flag); local base = active profile's default currency; the JOD gaps are fixed in the local-entry ticket. Jira keys in §10.

## 1. Problem and decisions already made

People who bill in the Gulf can't record their money in its own currency: the app knows USD, ILS, EUR and JOD only. Conversion is also partial. The local app only ever converts USD and EUR into ILS, and the server's rates (MUT-228, ADR-087) cover the same four currencies.

Basel's decisions (2026-10-18, this session):

| # | Decision |
|---|---|
| D1 | Add **AED, SAR, QAR, BHD, OMR**. **KWD is out** for now: its value follows an undisclosed basket, so it has no fixed USD rate, and we don't add a second rate provider yet. |
| D2 | **Frankfurter (ECB) stays the only rate provider.** The five Gulf currencies come from their fixed USD rates (pegs), the way JOD already does (ADR-087 §3). |
| D3 | **Cross pairs go through USD.** ILS↔AED = (ILS per USD) ÷ (AED per USD). |
| D4 | **Surfaces:** server + API, hosted portal, local web app, Flutter phone. Tauri desktop stays retired; it gets nothing beyond what the shared web code gives it. |
| D5 | **Local app:** Gulf currencies in entry forms and CSV, **and** converted views use any base currency and include every supported currency (JOD too), not just USD/EUR into ILS. |

## 2. The currencies

| Code | Minor-unit digits | Peg (units per 1 USD) | Set by |
|---|---|---|---|
| AED | 2 | 3.6725 | Central Bank of the UAE |
| SAR | 2 | 3.75 | Saudi Central Bank |
| QAR | 2 | 3.64 | Qatar Central Bank |
| BHD | **3** | 0.376 | Central Bank of Bahrain |
| OMR | **3** | 0.3845 | Central Bank of Oman |
| JOD (existing) | 3 | 0.709 | Central Bank of Jordan |

The 3-digit currencies need nothing new in money handling: MUT-140/MUT-119 made decimals per-currency on the server (`server/src/money.ts`), on the web (`src/lib/utils.ts`) and on the phone (`Currency.fractionDigits`). One leftover still assumes 2 digits and ₪: `formatAmountShort` at `src/lib/utils.ts:44`.

## 3. How a rate is computed (D2 + D3)

One rule everywhere: every currency has a **units-per-USD** value.

```
ECB snapshot (EUR base: USD, ILS)          pegs (fixed, in code)
        │                                        │
        ▼                                        ▼
perUsd = { USD: 1, EUR: 1/eurUsd, ILS: ils/usd, JOD: 0.709, AED: 3.6725, SAR: 3.75, QAR: 3.64, BHD: 0.376, OMR: 0.3845 }
        │
        ▼
rate(from → to) = perUsd[to] / perUsd[from]          (units of `to` per 1 `from`)
```

- **Same numbers as today.** The server now crosses through EUR (`perEur[JOD] = perEur.USD × 0.709`). Going through USD gives identical results; it is just the same math stated the way D3 says it. We keep **fetching EUR-based ECB rates** (`base=EUR&symbols=USD,ILS`), because those are the raw ECB figures. Asking Frankfurter for `base=USD` would make it divide and round before we see them.
- **`derived`** (API field, phone's `isDerived`) is true when the pair isn't base→base and **either side is pegged**. Today's rule, "exactly one side is JOD", doesn't fit once AED↔JOD is possible: a rate made only of pegs, with no ECB figure in it, is still derived.
- **A re-peg is a deploy** (ADR-087 §3, unchanged). The peg table lives in code, one per runtime: server `fx-rates.ts`, web `src/lib/currencies.ts`, phone `Currency`. A parity test checks the copies against each other (§7).
- **Honesty rule (CLAUDE.md FX rules):** a converted figure shows the ECB rate date and, when the pair is derived, "(USD peg)". The portal's expense-group detail already does this for JOD (`ExpenseGroupDetail.tsx:499`); it generalises to any pegged currency.

## 4. Design per surface

### 4a. Server + API (blocks everything else)

- `money.ts`: `SUPPORTED_CURRENCIES` and `EXPONENT` gain the five codes. The DB columns are `VarChar(3)` with no check constraints, so **no migration**.
- `fx-rates.ts`: replace `JOD_PER_USD` with `USD_PEGS: Record<PeggedCurrency, number>`, rebuild `crossRates` on the per-USD table above, and widen `derived`.
- `schemas.ts`: the `Currency` enum grows. The `derived` description stops naming JOD and lists the pegs from the table.
- OpenAPI regenerated; version **1.34.0** (currently 1.33.0-mut267, renumbered if something lands first).
- `docs/analytics/events.json` `currencies` grows; contract **1.2.0** (the phone mirrors it in `analytics_contract.dart`).
- No change to `/v1/fx-rates`'s shape: it already answers "every supported currency against `base`".

### 4b. Hosted portal

- `HOSTED_CURRENCIES` (`src/hosted/format/currencies.ts`) becomes the only list. The copies in `FilterControls.tsx:12`, `data/filters.ts:13` and `incomeForm.ts:24` derive from it, and the compile-time API check (MUT-183 R4) keeps it equal to the server enum.
- `ExpenseDrawer.tsx`'s precision check is already currency-aware since JOD; it reads digits from the registry instead of special-casing JOD.
- Expense groups (MUT-266/268): `expenseGroups.ts:239` and `ExpenseGroupDetail.tsx:499` stop testing `=== 'JOD'` and ask "is either side pegged?".

### 4c. Local web app: registry and entry

- **New `src/lib/currencies.ts`**: `CURRENCIES` (ordered), and per code its `exponent`, `pegPerUsd?` and display order. `Currency` in `src/types/index.ts` derives from it. Display names come from `Intl.DisplayNames` and symbols from `Intl.NumberFormat`, so ar/en need no translation strings.
- About 15 hardcoded lists move onto it: `incomeFormSchema.ts:6`, `expenseDrawerFormSchema.ts:18`, `expenseFormSchema.ts:21` (**missing JOD today**), `BusinessProfileDrawer.tsx:28` (**missing JOD today**), `conversionFormSchema.ts`, `csvValidation.ts:18`, `csv.ts`, `currencyAmounts.ts:16`, `utils.ts:17` (exponents), `utils.ts:105-116` (typed-amount prefixes and suffixes), `aggregations.ts`, `ExpensesLedgerPage.tsx`, and the currency tabs/filters.
- **Typed-amount recognition** (`utils.ts:105`) learns the codes, plus the Arabic symbols people actually type: د.إ, ر.س, ر.ق, د.ب, ر.ع. ر.س and ر.ق are distinct, so nothing becomes ambiguous.
- Dexie stores currency as a string: **no schema bump**.
- `landingCopy.ts` lists the currencies: update the copy (ar + en).

### 4d. Local web app: any-base conversion (D5)

- `src/lib/fx/fxService.ts` stops asking for one pair at a time (`?base=USD`). It makes **one** call, `base=EUR&symbols=USD,ILS`, builds the per-USD table with the pegs, and caches the **snapshot** in `localStorage`. Cache key and staleness stay as they are, with a one-time cache migration, so offline still works.
- `useFxRate(from, to)` keeps its signature and reads the cached snapshot, so callers don't change. A new `useFxSnapshot()` serves views that convert many currencies at once.
- **Which base:** the **active profile's default currency**, falling back to `settings.defaultBaseCurrency` (stored today, read by nothing). This matches the phone, which converts into the target profile's default currency (MUT-229).
- `CurrencySummaryPopup` takes `Record<Currency, number>` instead of three `usd/ils/eurAmountMinor` props. It lists every non-zero currency and shows the unified total in the base currency, but only when every currency it adds up has a rate (MUT-24 C rule kept).
- `FxRateReadout` (top bar) shows 1 unit of each of the person's *used* currencies in the base currency, not a fixed $/€ → ₪.
- `clientIndexRows.ts:34` `RANK_CURRENCIES` (ADR-035 ranking) covers every currency and ranks in the base currency. ADR-035's "no rate, no guess" order follows the registry's display order.
- ADR-004 and ADR-035 still hold: amounts stay in their own currency, and a converted figure is always labelled as one.

### 4e. Flutter phone

- `Currency` enum gains five values with symbols, `fractionDigits` and names (`currency_names.dart`, `app_ar.arb`/`app_en.arb`), and `captureOrder` grows.
- `fx_rates.dart:112` `isDerived` becomes "either side pegged".
- `analytics_contract.dart` `contractCurrencies` matches contract 1.2.0.
- **Tolerant parsing (release-critical, §6):** the repositories call `Currency.fromCode`, which **throws** on an unknown code (`income_repository.dart:38/80/92`, `expense_repository.dart:44`, `inbox_repository.dart:43`, `conversion_repository.dart:38-39`, `auth.dart:278`). They should skip or flag a record in a currency this build doesn't know instead of failing the whole list, so the next currency we add can't break installed phones.

## 5. API contracts and error states

- `Currency` enum: `ILS | USD | EUR | JOD | AED | SAR | QAR | BHD | OMR`.
- Money strings: BHD and OMR accept up to 3 decimals; AED, SAR and QAR up to 2. A fourth or third decimal respectively is the existing `VALIDATION_FAILED` (MoneyParseError), with no new code.
- `GET /v1/fx-rates?base=AED` → 9 rows; `derived: true` on every row except AED's own (AED is pegged, so every pair through it is). Base USD → `derived` true on the 6 pegged rows only.
- Provider down with nothing cached → 503 `FX_RATES_UNAVAILABLE` (unchanged). Pegged↔pegged pairs could in principle be served without the provider. **Not doing that**: one source of truth for "rates are available", and 503 stays simple.
- Local app offline with no cached snapshot: converted views fall back to per-currency lines only, as today. Never a zero rate.

## 6. Release order (needs Basel's sequencing)

The phones people have installed today **break on an unknown currency** (§4e): if someone records AED income on the portal, their phone's income list throws. So:

1. **Phone first:** tolerant parsing + the five currencies, released and adopted.
2. **Server + portal** after it: the API starts accepting the codes.
3. The local web app is independent: it never talks to the server, so it can ship any time.

**Decided (Basel, 2026-10-18): phone first, no server flag.** The rejected alternative was a server flag (`EXTRA_CURRENCIES_ENABLED`) flipped after the phone release: a flag and two code paths to remove later.

## 7. Tests (TDD, per ticket)

- **Server:** `crossRates` against a fixed snapshot for every base (9 × 9), checking (a) pegged↔ECB equals the hand-computed USD route, (b) pegged↔pegged equals the peg ratio, (c) `derived` matrix. `parseMoney`/`formatMoney` for BHD/OMR 3-digit and AED 2-digit, plus over-precision rejection. OpenAPI check.
- **Peg parity:** one JSON fixture (`docs/fx/pegs.json`, generated from server code) that the web and phone test suites both load and compare against their own tables, so a re-peg that misses a runtime fails CI.
- **Web:** registry-driven schema tests (each form accepts every code), typed-amount parsing with the Arabic symbols, `formatAmountShort` for each digit count, fxService snapshot cache + offline fallback + cache migration, `CurrencySummaryPopup` with mixed currencies and a missing rate, ADR-035 ranking in a non-ILS base.
- **Portal:** the derived "(USD peg)" label for AED/BHD groups, and the filter list derived from `HOSTED_CURRENCIES`.
- **Phone:** enum/codec round trips, `isDerived` matrix, a list containing an unknown currency loads its other records.

## 8. QA scenarios (release-QA, Phase 5)

| id | App | Steps as a person says them | Promise |
|---|---|---|---|
| `currency.record-aed-income` | web | Add income, pick AED, type 1,250.50, save | The ledger shows AED 1,250.50 |
| `currency.bhd-three-decimals` | web | Add an expense in BHD, type 12.345 | Saved and shown with 3 decimals; 12.3456 is refused |
| `currency.arabic-symbol-typed` | web | Type "500 ر.س" in an amount field | The currency switches to SAR |
| `fx.any-base-summary` | web | Profile default AED; income in USD, ILS and SAR; open the totals popup | Total in AED, each line in its own currency, rate date shown, "(USD peg)" on derived lines |
| `fx.offline-snapshot` | web | Load rates, go offline, reload | Converted total still shown, marked as cached with its date |
| `currency.portal-record-qar` | portal | Add income in QAR in the portal | Saved, filterable by QAR |
| `fx.portal-group-peg-label` | portal | Expense group with OMR expenses, ILS profile | "≈ ILS … · 1 OMR = … ILS (USD peg)" |
| `currency.phone-capture-aed` | flutter | Capture income in AED | Uploaded and shown in AED |
| `currency.phone-unknown-code` | flutter | A record in a currency this build lacks reaches the phone | The list loads; that record shows as unsupported |

## 9. Reuse, impact, cost, infra

- **Reuse:** per-currency exponents (MUT-140/119), `/v1/fx-rates` and its cache (MUT-228), `HOSTED_CURRENCIES` + compile-time check (MUT-183), the phone's `FxRates` crossing. The one new component is the web registry `src/lib/currencies.ts`; it replaces lists rather than adding a parallel one.
- **Impact:** every money form, filter and CSV on three clients; the analytics contract; OpenAPI. No DB migration, no Dexie bump.
- **Cost / infra:** none. Same provider, same request count. The local app makes *fewer* requests (one snapshot instead of one per pair).
- **i18n:** names and symbols come from `Intl` on the web and from ARB on the phone. Arabic is the default (ADR-077). Arabic-Indic digits are already handled by the amount parser.

## 10. Tickets (epic MUT-278, filed 2026-10-18)

| Key | Ticket | Links |
|---|---|---|
| MUT-279 | Phone: tolerant currency parsing + Gulf currencies (contract 1.2.0) | blocks MUT-280: releases first (§6) |
| MUT-280 | Server: Gulf currencies + USD-peg table; ADR (next free number) extends ADR-087 | blocks MUT-281; relates MUT-228 |
| MUT-281 | Portal: Gulf currencies from one list, peg labels generalised | blocked by MUT-280 |
| MUT-282 | Local web: currency registry + Gulf entry + JOD gaps | blocks MUT-283; independent of the server |
| MUT-283 | Local web: any-base conversion from one ECB snapshot | blocked by MUT-282 |

## 11. Answers (Basel, 2026-10-18)

1. Release order (§6): **phone first, no server flag.**
2. Local base currency (§4d): **the active profile's default currency**, falling back to `settings.defaultBaseCurrency`.
3. The two JOD gaps (local expense form, business profile drawer) are **fixed inside ticket 3**.
