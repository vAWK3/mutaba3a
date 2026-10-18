# MUT-280 — Server: accept AED/SAR/QAR/BHD/OMR, rates from a USD-peg table, `currencies` on `/v1/me`

Epic MUT-278. Epic brief: `.claude/designs/gulf-currencies.md` (approved 2026-10-18), §2, §3, §4a, §5, §6, §7.
Tracker: Jira · barmajiyat · MUT via `mcp__atlassian-barmajiyat__*` · Backlog → **Planned** (this plan) → In Progress → In Review (qa-reconcile) → Done after landed + pushed.
Repo state when planned: mini-crm `main` at `ed6f34a9` (API `1.33.0-mut267`, last ADR-095, last TD-168). Updated during review: MUT-272 merged as `61928c64` (API `1.34.0-mut272`, ADR-096, TD-169), so this ticket's numbers are API `1.35.0-mut280`, ADR-098, TD-170 (ADR-098, not 097: the unmerged MUT-285 branch already wrote ADR-097), renumbered at landing only if something else lands first.

## 1. Neighbourhood

- **Epic siblings.** MUT-279 (phone, Planned) "blocks" this ticket for **release order only** (Basel's comment, 2026-10-18). Build and merge this to local main first: MUT-279's simulator flows need a local server with this code. MUT-281 (portal) is blocked by this ticket. MUT-282/283 (local web) are independent of the server.
- **Scope changes from the comment on MUT-280 (2026-10-18, from MUT-279's eng review):**
  - **Added:** `currencies: string[]` on `GET /v1/me` and the device-session answer, the same pattern as `limits` (MUT-182). The phone offers only codes in this list (MUT-279 D4), so it can ship before this server does.
  - ~~Removed: the analytics contract 1.2.0 bump~~ **Back in scope (Basel, D10, 2026-10-18, correcting comment on MUT-280).** `scripts/__tests__/analytics-taxonomy.test.ts:215-216` pins `docs/analytics/events.json` `currencies` to exactly the server's `SUPPORTED_CURRENCIES`, so the contract bump must land in the same change as `money.ts` (§2f). MUT-279 copies 1.2.0 into the phone after this merges to local main.
- **Related, done:** MUT-228 (ADR-087, `/v1/fx-rates`), MUT-140/119 (per-currency exponents), MUT-182 (`limits` on Me).
- **Landed during planning:** MUT-272 merged to main (`61928c64`) as **API `1.34.0-mut272`**, **ADR-096**, TD-169. This ticket therefore takes **API `1.35.0-mut280`** and **ADR-098** for now, renumbered at landing to whatever is next free. MUT-272's expense currency patch re-parses amounts in the new currency's digits (`expenses/compose.ts`), so the five new codes work there with no extra code.
- **MUT-293** (minimum app version) is related but separate. It doesn't change this plan.
- **Blocker gate:** passed. The only `is blocked by` link is MUT-279, which is release order only (comment above).

## 2. What changes (server only, plus one fixture and one CI path)

### 2a. `server/src/money.ts`
- `SUPPORTED_CURRENCIES = ['ILS', 'USD', 'EUR', 'JOD', 'AED', 'SAR', 'QAR', 'BHD', 'OMR']`. **Append** the new codes so the existing order stays as it is: `/v1/fx-rates` rows, the OpenAPI enum and every `it.each(SUPPORTED_CURRENCIES)` keep their current positions.
- `EXPONENT` gains `AED: 2, SAR: 2, QAR: 2, BHD: 3, OMR: 3`. It is a `Record<Currency, number>`, so the compiler refuses a code with no exponent.
- `MAX_AMOUNT_MINOR` is in minor units. For a 3-decimal currency the ceiling is 999,999,999,999.999, the same as JOD has today. The doc comment gets one clause saying so, and nothing else changes.
- `server/src/import/plan.ts:109` (Malafat project import) uses `isSupportedCurrency`, so it starts accepting the five codes too (AC 1). KWD and GBP stay `UNSUPPORTED_CURRENCY`.
- No migration: every currency column is `VarChar(3)` with no check constraint or enum type (checked against `prisma/schema.prisma` and `migrations/`).

### 2b. `server/src/fx-rates.ts`
```ts
/** Currencies the ECB snapshot prices directly. Every other supported currency must have a USD peg. */
const ECB_CURRENCIES = ['USD', 'EUR', 'ILS'] as const;
export type PeggedCurrency = Exclude<Currency, (typeof ECB_CURRENCIES)[number]>;

/** Units per 1 USD, each set by its central bank (ADR-087 §3, ADR-098). A re-peg is a deploy; docs/fx/pegs.json mirrors this. */
export const USD_PEGS: Readonly<Record<PeggedCurrency, number>> = { JOD: 0.709, AED: 3.6725, SAR: 3.75, QAR: 3.64, BHD: 0.376, OMR: 0.3845 };

export function isPegged(c: Currency): c is PeggedCurrency { return Object.hasOwn(USD_PEGS, c); }

export function crossRates(snapshot: EcbSnapshot, base: Currency): FxRate[] {
  const perUsd: Record<Currency, number> = { USD: 1, EUR: 1 / snapshot.perEur.USD, ILS: snapshot.perEur.ILS / snapshot.perEur.USD, ...USD_PEGS };
  return SUPPORTED_CURRENCIES.map((currency) => ({
    currency,
    rate: currency === base ? 1 : Number((perUsd[currency] / perUsd[base]).toFixed(RATE_DECIMALS)),
    derived: currency !== base && (isPegged(currency) || isPegged(base)),
  }));
}
```
- **Exhaustive by type.** `Record<PeggedCurrency, number>` means a future code added to `money.ts` without a peg (KWD, say) fails `tsc` until someone either gives it a peg or adds it to the ECB fetch. The "no peg, no rate" decision is made in the code, not by accident.
- `JOD_PER_USD` goes away. Its three importers (`schemas.ts`, `fx-rates.test.ts`, `routes-fx-rates.test.ts`) read `USD_PEGS.JOD`.
- **Same numbers as today.** A probe over five ECB snapshots compared all 72 cross pairs, the EUR-anchored table (today) against the per-USD table (above), at 6 decimals: no difference. Pegged↔pegged rates also equal the plain peg ratio. The existing pinned values in `fx-rates.test.ts` (`3.102159`, `0.322356`, `0.287613`, `0.22855`, `1.410437`) **stay unchanged** and work as the regression guard.
- The fetch is unchanged: `base=EUR&symbols=USD,ILS`, the raw ECB figures (brief §3).
- `derived` widens from "exactly one side is JOD" to "not base→base and either side pegged". On every pair that existed before, it gives the same answer. On new pairs, AED↔JOD (pegs only, no ECB figure) is still derived.
- The 503 behaviour is unchanged: with no servable snapshot, `CachedFxRates` refuses before `crossRates` runs, so pegged↔pegged pairs are never served without the provider (AC 4, brief §5).
- Module doc comment and `FxRate` doc: "JOD" becomes "the pegged currencies (`USD_PEGS`)".

### 2c. `server/src/schemas.ts`
- `CurrencySchema` grows automatically (it is `z.enum(SUPPORTED_CURRENCIES)`).
- `FxRateSchema.derived` description, built from the table: `True when either side of the pair is pegged to the US dollar: the ECB publishes no rate for it, so the rate comes from its USD peg (1 USD = 0.709 JOD, 3.6725 AED, 3.75 SAR, 3.64 QAR, 0.376 BHD, 0.3845 OMR)`.
- `MeSchema` gains, next to `limits`:
  ```ts
  /** MUT-280: every currency code this server accepts, in its supported order. Clients offer only codes they also know, and ignore the rest. */
  currencies: z.array(z.string().regex(/^[A-Z]{3}$/)).openapi({ description: '…', example: ['ILS', 'USD', 'EUR', 'JOD', 'AED', 'SAR', 'QAR', 'BHD', 'OMR'] }),
  ```
  - **`string[]`, not `Currency[]`** (ticket wording, kept on purpose). The field exists for forward compatibility. A spec that types it as the enum tells a generated client that the set is closed, and that client would then reject the next code a newer server adds. A free three-letter string with "ignore what you don't know" is the honest contract.
  - **Required in the server's schema, optional for clients.** This server always sends it, so the OpenAPI marks it required, the same as `limits`. Its absence means "a server older than MUT-280", and the phone falls back to the legacy four (MUT-279 D4). The ticket says "optional": that word is the client's view, and the description says so.
  - `DeviceSessionSchema = MeSchema.extend(...)`, so it inherits the field with no extra code.
- `server/src/routes/sessions.ts` `buildMe` returns `currencies: [...SUPPORTED_CURRENCIES]`. Both sign-in surfaces and `GET /v1/me` already go through `buildMe`. No new query, so the cost is about 50 bytes per Me answer.

### 2d. OpenAPI, version, ADR, fixture, CI
- `API_VERSION = '1.35.0-mut280'` (`server/src/app.ts:126`) and the pinned copies in the six `routes-m2/3/4/5/6/8.test.ts` files. Regenerate `server/openapi/openapi.yaml` (`npm --prefix server run openapi:generate`), then `openapi:check`.
- **`src/hosted/api/schema.d.ts` is NOT regenerated in this ticket** (decision D1, §6). A probe that widened the generated `Currency` gave **15 portal type errors in 8 files** (`format/currencies.ts`'s `coversEveryCurrency` guard, `incomeForm.ts`, `IncomeCaptureDrawer`, `ExpenseDrawer`, `ConversionDrawer`, `ProfileCreateDrawer`, `ProfileEditForm`, `data/expenseGroups.ts`). The portal reuses the local app's 4-currency `Currency` type and `currencyExponent`. Fixing those is MUT-281's work (portal list) plus a bit of MUT-282's (`src/lib/utils.ts` exponents). `npm run hosted:types:check` is not run in CI, and it stays red on local main until MUT-281 regenerates the file as its first step.
- **New `docs/fx/pegs.json`**, the shared peg fixture that MUT-282/283's web tests read (the phone needs only *which* currencies are pegged, MUT-279 §3, so it doesn't read the values):
  ```json
  { "source": "server/src/fx-rates.ts USD_PEGS", "unitsPerUsd": { "JOD": 0.709, "AED": 3.6725, "SAR": 3.75, "QAR": 3.64, "BHD": 0.376, "OMR": 0.3845 } }
  ```
  The file is edited by hand. A server test checks it equals `USD_PEGS` in both directions and prints the expected JSON when it doesn't. A generator script for six numbers would be YAGNI; the `openapi:check` pattern exists for a 10k-line file.
- `.github/workflows/server-ci.yml` `paths` gains `docs/fx/**` for both push and pull_request. Otherwise a commit that only edits the fixture would skip the parity test that guards it.
- **ADR-098** (renumbered at landing): "Gulf currencies come from their USD pegs; every currency the ECB doesn't price must have one", extending ADR-087 §3. Contents: the peg table and the central bank behind each rate; cross rates through USD (D3); `derived` = either side pegged; KWD excluded (no fixed rate, D1); the `Record<PeggedCurrency>` exhaustiveness rule; `currencies` on Me as a forward-compatible `string[]`; peg parity through `docs/fx/pegs.json`; release coupling with MUT-279/MUT-281 (§5).

### 2f. Analytics contract 1.2.0 (D10, back in scope)
- `docs/analytics/events.json`: `version` `1.1.0` → `1.2.0`; `currencies` → `["AED", "BHD", "EUR", "ILS", "JOD", "OMR", "QAR", "SAR", "USD"]` (alphabetical, as today). Nothing else changes, and the file keeps its current formatting and line endings, because the phone's copy is pinned byte for byte.
- `scripts/__tests__/analytics-taxonomy.test.ts` `PINNED_VERSIONS`: append `'1.2.0': '<sha256 of the new file>'` and keep the `1.1.0` row (append-only, R2).
- Why here and not in MUT-279: the taxonomy test at `:215-216` compares the contract's currencies with `server/src/money.ts`'s list, so either change alone fails `npm run test:run` and contracts CI.
- Reach: the portal's `src/lib/analytics/contract.ts:56` reads `currencies` as `string[]` at runtime, so it just starts accepting the five codes, with no type change. The phone keeps 1.1.0 until MUT-279 copies 1.2.0 (its fixture + README row + `contractCurrencies`).
- ADR-090 (analytics contract) needs no change: this is a version bump under its rules. CHANGELOG notes it.

### 2e. Knowledge files (after implementation)
CHANGELOG; SYSTEM_OVERVIEW (supported currencies, `/v1/me.currencies`); DECISIONS (ADR-098, and an amendment line on ADR-087 §3 pointing to it); TECH_DEBT (**new TD**: `schema.d.ts` lags the spec until MUT-281, resolved by MUT-281); TEST_PLAN; `server/README.md` or API docs wherever the currency list is written out (grep `ILS, USD, EUR, JOD` / `ILS | USD | EUR | JOD` under `server/` and `docs/` at build time).

## 3. Files

| Kind | File |
|---|---|
| touch | `server/src/money.ts`, `server/src/fx-rates.ts`, `server/src/schemas.ts`, `server/src/routes/sessions.ts`, `server/src/app.ts` |
| regen | `server/openapi/openapi.yaml` |
| new | `docs/fx/pegs.json` (its parity check is a describe block in `fx-rates.test.ts`, review D1) |
| tests touch | `server/src/__tests__/{money,fx-rates,routes-fx-rates,routes-sessions,routes-device-sessions,income-routes,routes-expenses,routes-conversions,routes-profiles}.test.ts`, `routes-m2/3/4/5/6/8.test.ts` (version pin), `server/src/repositories/__tests__/store-contract-expenses.ts` (Postgres round-trip) |
| CI | `.github/workflows/server-ci.yml` (`docs/fx/**`) |
| docs | `.claude/{DECISIONS,CHANGELOG,SYSTEM_OVERVIEW,TECH_DEBT,TEST_PLAN}.md` |
| contract | `docs/analytics/events.json` (1.2.0), `scripts/__tests__/analytics-taxonomy.test.ts` (`PINNED_VERSIONS` row) |
| **not touched** | `src/**` (portal + local web), Prisma schema/migrations, Flutter |

## 4. Tests (TDD, written first). Full list in `mut-280-gulf-currencies-server-tests.md`

- **money:** `parseMoney`/`formatMoney` round trips for AED `1250.50`, SAR `0.5`, QAR `3`, BHD `12.345`, OMR `0.001`. Over-precision is refused: AED `1.234`, BHD `12.3456`. The BHD ceiling `999999999999.999` is accepted and one more fils is refused. `isSupportedCurrency` is true for all nine and false for `KWD`.
- **crossRates, 9×9 matrix** on the fixed snapshot: (a) every rate equals `perUsd[to]/perUsd[from]` computed by hand from the snapshot and the literal peg numbers, not from `USD_PEGS`, so a typo in the table fails; (b) pegged↔pegged equals the plain peg ratio (`AED→SAR = 3.75/3.6725 = 1.021103`, `BHD→OMR = 1.022606`); (c) the `derived` matrix: base AED → 8 derived rows, base USD → exactly the 6 pegged rows, ILS↔EUR↔USD never derived; (d) the existing pinned ILS/USD/EUR/JOD values unchanged.
- **Peg table:** `USD_PEGS` equals the brief's §2 table literally, `isPegged` is true for exactly six codes, and the fixture file equals `USD_PEGS` both ways.
- **Routes:**
  - `GET /v1/fx-rates?base=AED` returns 9 rows in supported order with `derived` true on all except AED; `base=BHD` likewise; `base=KWD` is 422; provider down with an empty cache is still 503 `FX_RATES_UNAVAILABLE` for `base=AED`.
  - `POST /v1/income` with AED `1250.50` → 201, `GET` returns `"1250.50"` / `AED`; BHD `12.345` → 201; BHD `12.3456` and AED `1.234` → 422 `VALIDATION_FAILED`.
  - `POST /v1/expenses` OMR `0.385` → 201.
  - `POST /v1/conversions` AED → BHD with each leg in its own digits → 201.
  - `POST /v1/profiles` `defaultCurrency: 'SAR'` → 201; `PATCH` to `QAR` → 200.
- **Me:** `GET /v1/me`, `POST /v1/sessions` and `POST /v1/device-sessions` each answer `currencies` equal to `SUPPORTED_CURRENCIES` in order, and each answer validates against `MeSchema`/`DeviceSessionSchema`.
- **Postgres (`test:db`):** one store-contract case writes and reads back a BHD expense with `amountMinor 12_345n`, proving the "no migration" claim on the real column.
- **OpenAPI:** `openapi:check` is clean, and the `Currency` enum and the `Me.currencies` property are present (the existing m-series doc tests pin the version).

Command, under Node 22 (TD-054): `npm --prefix server run typecheck && npm --prefix server run lint && npm --prefix server run openapi:check && npm --prefix server test`. CI's `test:db` covers the Postgres case. Root `npm run typecheck` stays green because `schema.d.ts` is untouched (D1).

## 5. Release coupling (Basel sequences releases; this ticket only merges to local main)

1. **MUT-279 (phone) is released and adopted first.** Phones already installed throw on an unknown currency code (brief §6).
2. **This ticket and MUT-281 go out in the same `make release server`.** The portal ships inside the API image (`qa.config.mjs`: the portal's release is the `api-v*` tag). A server that accepts AED next to an old portal would let the phone write AED records that the portal renders with an `undefined` exponent (`NaN`) and can't filter. So **no server release between this merge and MUT-281's merge**, the same rule ADR-088 set for MUT-235/236.
3. The local web tickets (MUT-282/283) are independent.

## 6. Decisions for review

- **D1: `schema.d.ts` regeneration.** Recommended: leave it to MUT-281 (§2d, plus a TD). Alternatives: (B) regenerate here and fix the 15 portal type errors, which pulls MUT-281's list work and part of MUT-282's exponent table into a server ticket; (C) regenerate here and silence the errors with casts, which hides exactly the drift the MUT-183 guard exists to catch.
- **D2: `currencies` typed as `string[]`, required in the server's schema** (§2c), as the ticket says. The alternative, `Currency[]`, would give the portal a tighter type but close the set for every generated client.
- **D3: peg fixture edited by hand, guarded by a test** (§2d). The alternative is a generator script with a `--check` mode.

## 7. QA scenarios (release-QA, CLAUDE.md Phase 5)

This ticket ships no UI, and release-QA covers the `web` and `portal` apps only. MUT-267 set the precedent: a server ticket's user-visible flows are specced as the client tickets' features, and this ticket pins each promise with a route test.

| Scenario | Steps as a person says them | Promise | Where it's automated |
|---|---|---|---|
| `currency.portal-record-qar` | Add income in QAR in the portal | Saved, filterable by QAR | MUT-281 `qa/features/portal/income.yaml`; here, by the `POST /v1/income` route tests |
| `fx.portal-group-peg-label` | Expense group with OMR expenses, ILS profile | "≈ ILS … · 1 OMR = … ILS (USD peg)" | MUT-281 `expense-groups.yaml`; here, by the `derived` matrix and the `base=ILS` route test |
| `ios.capture.gulf-currency-aed` | On the phone, capture an AED expense of 150 | Saved, shown as AED 150.00 | MUT-279 flow, run against this server locally; here, by the `POST /v1/expenses` route test |
| `ios.capture.gulf-bhd-decimals` | Capture BHD 12.345 | Saved with 3 decimals | MUT-279 flow; here, by the BHD route tests |
| `ios.fx.gulf-peg-label` | Profile in ILS, open the rates sheet | AED…OMR listed with "(USD peg)" | MUT-279 flow; here, by `GET /v1/fx-rates?base=ILS` |
| `ios.settings.profile-currency-picker` | Change a profile's currency to SAR | The profile shows SAR, and the picker offered it because `/v1/me.currencies` lists it | MUT-279 flow; here, by the Me and `PATCH /v1/profiles` tests |

**Server files map to those features** when MUT-281 lands. That is how MUT-267/268 did it: server paths go into the portal features' `paths`, so `release-qa lint` shows no new unmapped files. **Local check for MUT-279:** run `npm --prefix server run dev` from a checkout with this merge, then confirm `GET /v1/me` lists nine codes and `GET /v1/fx-rates?base=AED` answers 9 rows, before the phone flows run.

## 8. Quality bar

- **DRY:** one currency list (`SUPPORTED_CURRENCIES`) feeds the enum, the rates and `Me.currencies`. One peg table feeds the rates, the OpenAPI description and the fixture.
- **Testable:** `crossRates` stays a pure function of a snapshot. Every new behaviour is covered by unit or route tests on the in-memory store, plus one Postgres round trip.
- **Scalable / cost:** no new queries, tables, indexes or provider calls. The `/v1/fx-rates` payload grows from 4 rows to 9 (about 300 bytes), and Me grows by about 50 bytes.
- **Constraints:** no DB migration; the API change is additive, apart from the widened enum, which old clients handle through MUT-279's tolerant parsing and the release order; i18n doesn't apply to the server; no deploy and no push.

## 9. Scope check vs the ticket

| AC | Covered by |
|---|---|
| Every money endpoint accepts the five codes; BHD/OMR 3 decimals, AED/SAR/QAR 2; over-precision is `VALIDATION_FAILED` | §2a, the money and route tests |
| `/v1/fx-rates?base=X` returns 9 rows for every X; 9×9 matches the USD route; pegged↔pegged = peg ratio | §2b, the matrix tests |
| `derived` correct for the whole matrix | §2b, the derived-matrix test |
| 503 unchanged | §2b, the route test |
| Server typecheck, lint, openapi:check and test pass | §4 |
| (comment) `currencies` on Me and the device session | §2c, the Me tests |
| (D10, correcting comment) analytics contract 1.2.0 | §2f, test C1 |

**Beyond the ticket, and why:** the `Record<PeggedCurrency>` exhaustiveness rule (cheap, and it prevents a silent wrong rate), `server-ci` watching `docs/fx/**` (otherwise the fixture's guard can be skipped), the Postgres round trip (proves "no migration"). Nothing else.

**What the ticket is missing:** the release coupling with MUT-281 (§5) and the deferred `schema.d.ts` regeneration (D1), which MUT-281 must do first. Both go into a comment on MUT-281.

## Business / product impact
- People who bill in the Gulf can record AED, SAR, QAR, BHD and OMR on the hosted side, with honest "(USD peg)" conversions, using the same single rate provider and no new infrastructure cost.
- First server step of epic MUT-278. It unblocks MUT-279's simulator QA, and through it the phone release, and then MUT-281 (portal).
- Low risk: no migration and additive API fields. The real risk is release order (phone → server+portal together), which §5 states.

## Eng review (plan-eng-review, 2026-10-18)

Target: this plan, `.claude/designs/mut-280-gulf-currencies-server.md` (ticket MUT-280, epic MUT-278; epic brief `.claude/designs/gulf-currencies.md`; tests `mut-280-gulf-currencies-server-tests.md`). Repo main `ed6f34a9`.

### Scope record
feature answers: none proposed (no cuts); structure: B, Smaller arrangement (D1, Basel 2026-10-18); accepted scope: the plan as written, with the peg-fixture parity check as a describe block in `server/src/__tests__/fx-rates.test.ts` instead of a new `fx-pegs-fixture.test.ts` (applied to §3 and the test plan); pending remedies: D2 (schema.d.ts regeneration), D3 (Me.currencies typing). Scope Challenge result: scope accepted as-is.
Factual correction applied (no behaviour change): the fixture's `source` string no longer names an ADR number, which is renumbered at landing.

### Section 1 findings (Architecture)
1. [P1] (9/10) `src/hosted/format/currencies.ts:16` + `src/lib/utils.ts:17`: regenerating `schema.d.ts` gives 15 portal type errors in 8 files (scratch probe). Claude (native). → R2/D2.
2. [P2] (8/10) `server/src/schemas.ts:400`: `limits` is required on `MeSchema`; the ticket calls `currencies` "optional". Claude (native). → R3/D3.
3. [P3] (9/10) `server/src/import/plan.ts:109`: `isSupportedCurrency(row.currency) ? null : 'UNSUPPORTED_CURRENCY'`. The Malafat project import starts accepting the five codes. Factual: required by AC 1. Added a plan.test.ts row (AED project planned as create; KWD still `UNSUPPORTED_CURRENCY`).
4. [P1] (9/10) `qa/qa.config.mjs:57`: the portal ships inside the API image. Factual: §5 already couples MUT-280 with MUT-281.
Existing tests that reject a currency all use GBP (`routes-m2.test.ts:239`, `routes-profiles.test.ts:123`, `routes-expenses.test.ts:201`, `routes.test.ts:117`, `import/__tests__/plan.test.ts:97`, `routes-fx-rates.test.ts:108`). None flips.

## Decision ledger

### R2: regenerate the portal's typed client (`src/hosted/api/schema.d.ts`) in this ticket?
Finding: 1, P1, 9/10, `src/hosted/format/currencies.ts:16`, Claude (native)
Plan baseline: plan §2d/D1 proposes NOT regenerating it here; MUT-281 regenerates it first. Not yet approved.
Runtime evidence: scratch copy of HEAD with `Currency` widened in `schema.d.ts` → `tsc -p tsconfig.hosted.json` reports 15 errors in ConversionDrawer, ExpenseDrawer, IncomeCaptureDrawer, ProfileCreateDrawer, ProfileEditForm, incomeForm.ts, data/expenseGroups.ts, format/currencies.ts. `hosted:types:check` is not in any CI workflow (web-ci runs lint/typecheck/test only). Past server tickets (MUT-182, MUT-228, MUT-267) regenerated `schema.d.ts` in the same commit.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R2 schema.d.ts in MUT-280 | pending (plan proposes A) | not regenerated; MUT-281 regenerates first; TD + MUT-281 comment | regenerated + portal fixed here (HOSTED_CURRENCIES grows, portal types/exponents widened) | regenerated + errors silenced with casts |
| Portal behaviour after MUT-280 merge | n/a | unchanged (4 currencies) | offers 9 currencies (MUT-281 work pulled in) | unchanged, but MUT-183 guard disabled |
| `npm run typecheck` on main | green | green | green | green |
| `hosted:types:check` on main | green | red until MUT-281 | green | green |
| D3 Me.currencies typing | pending | pending | pending | pending |
| Release coupling §5 | plan text | unchanged | unchanged | unchanged |
Question D2:
D2 — Should MUT-280 regenerate the portal's typed API client?
Project/branch/task: mini-crm main, planning MUT-280 (server Gulf currencies), nothing built yet.
ELI10: The portal has a typed copy of the server's API description. When the server's currency list grows, regenerating that copy makes the portal refuse to compile (15 errors in 8 files), because the portal leans on the local app's 4-currency type and a guard that fails on purpose when the list grows. Fixing that is the portal ticket's job (MUT-281). The question is whether this server ticket leaves the copy stale until MUT-281, or drags the portal work in.
Stakes if we pick wrong: Either a server ticket quietly grows into a portal + local-web change, or main carries a stale typed client that another session regenerating it for an unrelated reason trips over.
Recommendation: A because MUT-280 and MUT-281 already must ship in one server release (the portal is inside the API image), so the stale copy only ever lives on local main, and the guard keeps doing its job for MUT-281.
Completeness: A=9/10, B=9/10, C=4/10
Pros / cons:
A) Leave it to MUT-281 (recommended)
  ✅ The server ticket stays server-only; MUT-281 regenerates as its first step and the MUT-183 guard lists exactly what to fix
  ✅ No behaviour change in the portal before its own ticket, QA and review
  ❌ hosted:types:check is red on local main until MUT-281 merges; a TD entry and a MUT-281 comment carry the warning
B) Regenerate and fix the portal here
  ✅ Main never has a stale typed client, matching how MUT-182/228/267 shipped
  ✅ The portal starts offering Gulf currencies one ticket earlier
  ❌ Pulls MUT-281's currency list and part of MUT-282's exponent table into a server ticket, and needs portal QA here (human ~1 day / CC ~1 h)
C) Regenerate and cast the errors away
  ✅ hosted:types:check green and the server ticket stays small (human ~1 h / CC ~10 min)
  ❌ Silences exactly the drift the MUT-183 guard exists to catch, and the casts must be unwound in MUT-281
Net: a short-lived stale file on local main versus a server ticket that becomes a portal ticket.
Header: Portal types
Options:
A) Leave to MUT-281 (recommended)
Don't regenerate src/hosted/api/schema.d.ts here. MUT-281 regenerates it as its first step. Add a TD entry and a comment on MUT-281. hosted:types:check is red on local main until then (it isn't in CI). Human ~10 min / CC ~2 min.
B) Regenerate + fix portal
Regenerate schema.d.ts and fix the 15 portal type errors properly: HOSTED_CURRENCIES grows to nine, the portal stops using the local 4-currency type and exponent table. Pulls MUT-281 scope (and part of MUT-282) into this ticket. Human ~1 day / CC ~1 h.
C) Regenerate + cast
Regenerate schema.d.ts and silence the 15 errors with casts at the boundary. Keeps checks green but hides the drift the MUT-183 guard catches; MUT-281 unwinds the casts. Human ~1 h / CC ~10 min.

State: approved
Actual answer: A) Leave to MUT-281 (D2, Basel 2026-10-18)
Accepted scope: plan §2d as written: `src/hosted/api/schema.d.ts` is not regenerated in MUT-280; MUT-281 regenerates it as its first step; a TD entry records the lag; a Jira comment on MUT-281 says so. The portal is unchanged by this ticket.
History: none

### R3: shape of `currencies` on `Me` / `DeviceSession`
Finding: 2, P2, 8/10, `server/src/schemas.ts:400` (`limits: z.object({...}).openapi('ProfileLimits')`, required), Claude (native)
Plan baseline: plan §2c/D2 proposes `z.array(z.string().regex(/^[A-Z]{3}$/))`, required in the server's schema, described as optional for clients. The ticket comment says "optional `currencies: string[]`". Not yet approved.
Runtime evidence: `buildMe` (`routes/sessions.ts:233`) serves `/v1/me`, `POST /v1/sessions` and `POST /v1/device-sessions`; `DeviceSessionSchema = MeSchema.extend` (`schemas.ts:445`). The phone parses `currencies` tolerantly and treats it as absent from older servers (MUT-279 D4, plan line 232). The portal's `schema.d.ts` is not regenerated here (R2), so the portal sees no change until MUT-281.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R3 element type | pending | string (`^[A-Z]{3}$`) | `Currency` enum | string |
| R3 required in OpenAPI | pending | required (server always sends it) | required | optional |
| Server behaviour | n/a | always sends all nine | always sends all nine | always sends all nine |
| Generated-client effect | n/a | `string[]`; unknown codes pass through | closed union; a newer server's code fails strict generated clients | `string[] \| undefined` everywhere, even though this server always sends it |
| R2 schema.d.ts | approved A | unchanged | unchanged | unchanged |
Question D3:
D3 — How should the spec describe the new `currencies` list on /v1/me?
Project/branch/task: mini-crm main, planning MUT-280 (server Gulf currencies), nothing built yet.
ELI10: The phone reads this list to know which currencies the server accepts, so it never offers one the live server would refuse. The list exists so that future currencies can be added without breaking older apps. If the spec says "only these nine values", a generated client is allowed to reject a tenth one later. If it says "three-letter codes, ignore ones you don't know", it stays honest for the next currency. Separately: this server always sends the list, so the spec can mark it required, while clients still treat it as optional because older servers don't send it.
Stakes if we pick wrong: Typing it as the enum recreates the bug this field exists to avoid (an older client rejecting a newer server's code); marking it optional makes every typed consumer handle "missing" from a server that never omits it.
Recommendation: A because a free three-letter string plus "ignore what you don't know" is the honest forward-compatible contract, and "required" is the truth about this server, same as `limits`.
Completeness: A=9/10, B=6/10, C=8/10
Pros / cons:
A) String codes, required (recommended)
  ✅ Matches the ticket's `string[]` and stays forward compatible for the next currency
  ✅ Required tells the truth about this server; the description says older servers omit it, as `limits` did
  ❌ Typed consumers get `string[]` and must narrow to their own currency type themselves
B) Currency enum, required
  ✅ The portal (once MUT-281 regenerates) gets a tight `Currency[]` with no narrowing
  ❌ Closes the set in the spec, so a generated client built today may reject a code a newer server adds
C) String codes, optional
  ✅ The spec mirrors how clients must read it (absent from servers older than MUT-280)
  ❌ Every typed consumer handles undefined from a server that always sends the list, unlike `limits`
Net: forward compatibility and an honest "always sent" versus a tighter type today.
Header: Me.currencies
Options:
A) String codes, required (recommended)
`currencies: string[]` (each `^[A-Z]{3}$`), required in MeSchema and DeviceSession. Description: every code this server accepts, in order; clients offer only codes they know and ignore the rest; servers older than MUT-280 omit it. Human ~15 min / CC ~3 min.
B) Currency enum, required
`currencies: Currency[]`, required. Tighter type for typed consumers; the spec closes the set, so strict generated clients may reject a code a newer server adds. Human ~15 min / CC ~3 min.
C) String codes, optional
`currencies?: string[]`, optional in the spec even though this server always sends it. Mirrors the client's view; typed consumers handle undefined. Human ~15 min / CC ~3 min.

State: approved
Actual answer: A) String codes, required (D3, Basel 2026-10-18)
Accepted scope: plan §2c as written: `currencies: z.array(z.string().regex(/^[A-Z]{3}$/))`, required in `MeSchema` (inherited by `DeviceSessionSchema`), described as every code this server accepts in its order, clients offer only codes they know and ignore the rest, servers older than MUT-280 omit it. `buildMe` returns `[...SUPPORTED_CURRENCIES]`. Tests R10/R11.
History: none

Section 1 dispositions: finding 1 accepted (D2, A); finding 2 accepted (D3, A); findings 3 and 4 factual, applied.

### Section 2 findings (Code quality)
1. [P3] (8/10) plan §2b proposed `return c in USD_PEGS;`. `in` also walks the prototype chain. It is safe for `Currency` values but not explicit. Factual: changed to `Object.hasOwn(USD_PEGS, c)` (server targets ES2023, `server/tsconfig.json:3-4`).
No other issues. One list and one peg table feed everything, there is no duplicated logic, and `crossRates` stays pure.
Dispositions: finding 1 factual, applied.

### Section 3 Test review
Framework: Vitest (`npm --prefix server test`), Postgres `test:db` in CI.
```
CODE PATHS                                              USER FLOWS (via MUT-279 / MUT-281)
[+] server/src/money.ts                                 [+] Phone captures AED 150 / BHD 12.345
  ├── parseMoney: 2-dp new codes      [GAP→M1,M3]         └── [GAP→R5–R7 route tests; flow in MUT-279]
  ├── parseMoney: 3-dp new codes      [GAP→M2,M3,M4]    [+] Phone rates sheet "(USD peg)"
  ├── isSupportedCurrency             [GAP→M5]            └── [GAP→R1,R2; flow in MUT-279]
  └── existing ILS/USD/EUR/JOD        [★★★ money.test]  [+] Phone offers SAR in profile picker
[+] server/src/fx-rates.ts                                └── [GAP→R10,R11; flow in MUT-279]
  ├── crossRates per-USD table        [GAP→F2,F3]       [+] Portal QAR income / OMR group label
  │   └── existing pins unchanged     [★★★ F5 kept]       └── [GAP→R5; flows in MUT-281]
  ├── derived: either side pegged     [GAP→F4]          [+] Error states
  ├── USD_PEGS / isPegged             [GAP→F6]            ├── [GAP→R6] over-precision → 422
  ├── fixture parity                  [GAP→P1]            ├── [GAP→R3] base=KWD → 422
  └── 503 with nothing cached         [★★★ routes-fx-rates; GAP→R4 base=AED]
[+] server/src/schemas.ts + routes/sessions.ts            └── [★★★ existing] provider down → 503
  └── Me/DeviceSession currencies     [GAP→R10,R11]
[+] server/src/import/plan.ts:109     [GAP→R13]
[+] Postgres VarChar(3) round trip    [GAP→D1 →E2E-ish, test:db]
COVERAGE today: 0/14 new paths (all new) | planned: 14/14 at ★★★ or ★★ | existing behaviour pinned by F5 + existing suites
```
Every GAP has a planned test in `mut-280-gulf-currencies-server-tests.md`, each with a value card in the QA artifact. The regression contract (existing ILS/USD/EUR/JOD rates unchanged, F5) carries forward from the epic brief §3 "Same numbers as today" (approved by Basel 2026-10-18), so no new question was needed. Tests made obsolete: none. The JOD-only `derived` test is rewritten, not retired.
Test Plan artifact: `~/.gstack/projects/vAWK3-mutaba3a/basel-main-eng-review-test-plan-20261018-211545.md`.
Dispositions: no new choices; all gaps are required proof of approved behaviour.

### Section 4 Performance
No issues found. No new queries: `buildMe` adds a constant array. `/v1/fx-rates` builds a 9-entry table per request from the cached snapshot (O(81) arithmetic at most), the payload grows by about 300 bytes, and provider calls are unchanged.

### Outside voice
Codex CLI is not installed (`CODEX_MODE: not_installed`). The native fallback needs TaskOutput, which this session doesn't have, so the outside voice is **unavailable** (logged). No cross-model coverage.

### NOT in scope
- Portal currency list, peg labels and `schema.d.ts` regeneration: MUT-281 (D2).
- Local web registry and any-base conversion: MUT-282/283.
- Analytics contract 1.2.0: MUT-279 (D8 there).
- Serving pegged↔pegged rates while the provider is down: rejected by the epic (§5), and 503 stays simple.
- Minimum app version: MUT-293.

### What already exists
`SUPPORTED_CURRENCIES` / `EXPONENT` / `parseMoney` (MUT-140/119) are reused as they are. `crossRates`, `CachedFxRates` and `FrankfurterSource` (MUT-228) are reused; only the table construction changes. `buildMe` (MUT-182 pattern) is reused for all three Me surfaces. The `openapi:check` pattern is reused for the spec.

### Failure modes
| Path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| Peg table | typo in a peg (3.6275 for 3.6725) | F2 uses literal numbers, F6, P1 | test failure, never prod |
| derived | old JOD-only rule left in place | F4 matrix | test failure |
| New code with no peg (future KWD) | added to money.ts only | `Record<PeggedCurrency>` fails tsc | build failure |
| Server released before MUT-281 | portal renders AED with undefined exponent (NaN) | §5 release rule (process) | NaN amounts in the portal; not caught by tests, which is why §5 is a hard rule |
| Server released before phones adopt MUT-279 | old phone throws on AED | §5 release order, MUT-279 | list fails to load on old phones (process) |
Critical gaps: 0 (both release risks are process gates that Basel sequences, and both are written into §5 and the ADR).

### Worktree parallelization
Sequential implementation, no parallelization opportunity (one module, `server/`).

## Implementation Tasks
- [ ] **T1 (P1, human: ~2h / CC: ~15min)** — server money/fx — five codes, `USD_PEGS`, per-USD `crossRates`, either-side `derived`, `docs/fx/pegs.json` with parity block in fx-rates.test.ts
  - Surfaced by: plan §2a/§2b, D1 (smaller arrangement)
  - Files: server/src/money.ts, server/src/fx-rates.ts, docs/fx/pegs.json, server/src/__tests__/{money,fx-rates,routes-fx-rates}.test.ts
  - Verify: `npm --prefix server test` (Node 22)
- [ ] **T2 (P1, human: ~1h / CC: ~10min)** — schemas/Me — `currencies` string[] required on Me (D3), derived description, API 1.35.0-mut280, openapi regen
  - Surfaced by: Section 1 finding 2 (D3)
  - Files: server/src/schemas.ts, server/src/routes/sessions.ts, server/src/app.ts, server/openapi/openapi.yaml, routes-sessions/device-sessions/m2–m8 tests
  - Verify: `npm --prefix server run openapi:check && npm --prefix server test`
- [ ] **T3 (P2, human: ~1h / CC: ~10min)** — route + import + Postgres coverage — R5–R9, R13, D1
  - Surfaced by: Section 1 finding 3; Section 3
  - Files: income-routes, routes-expenses, routes-conversions, routes-profiles tests, import/__tests__/plan.test.ts, store-contract-expenses.ts
  - Verify: `npm --prefix server test`; `test:db` in CI
- [ ] **T4 (P2, human: ~30min / CC: ~5min)** — CI + knowledge — server-ci `docs/fx/**`, ADR (next free, extends ADR-087), TD for schema.d.ts lag (D2), CHANGELOG/SYSTEM_OVERVIEW/TEST_PLAN; Jira comment on MUT-281
  - Surfaced by: D2; plan §2d/§2e
  - Files: .github/workflows/server-ci.yml, .claude/*.md
- [ ] **T5 (P1, human: ~20min / CC: ~3min)** — analytics contract 1.2.0 (D10) — events.json currencies + version, `PINNED_VERSIONS` row, same commit as money.ts
  - Surfaced by: late change from the MUT-279 session (taxonomy test `:215-216`)
  - Files: docs/analytics/events.json, scripts/__tests__/analytics-taxonomy.test.ts
  - Verify: `npx vitest run scripts/__tests__/analytics-taxonomy.test.ts` under Node 22, and root `npm run test:run`
  - Verify: root `npm run typecheck` stays green; `npm --prefix server run lint`

### Completion summary
- Step 0: Scope Challenge — scope accepted as-is (smaller arrangement, D1)
- Architecture Review: 4 issues found (2 decided, 2 factual)
- Code Quality Review: 1 issue found (factual)
- Test Review: diagram produced, 14 gaps identified (all planned)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (CLI not installed; native fallback needs TaskOutput)
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 2/2 (D2 A=9/10 and D3 A=9/10, both the highest score offered)

### R4: analytics contract 1.2.0 back in MUT-280 (late change, 2026-10-18)
Finding: [P1] (10/10) `scripts/__tests__/analytics-taxonomy.test.ts:215-216` `expect([...(contract.currencies as string[])].sort()).toEqual([...SUPPORTED_CURRENCIES].sort());`. Changing `money.ts` without the contract fails the root suite. This review missed it. Reported by the MUT-279 session.
Plan baseline: removed from MUT-280 by the 2026-10-18 Jira comment (MUT-279 D8).
State: approved
Actual answer: Basel chose to put the bump back in MUT-280 (D10, 2026-10-18, decided in the MUT-279 session; correcting comment on MUT-280).
Accepted scope: §2f and test C1; T5.
History: D8 (MUT-279) had moved it to the phone ticket; superseded by D10.

Approval readiness: PASS (R2 → D2 answer A; R3 → D3 answer A; R4 → Basel's D10; scope record → D1 answer B; factual items need no approval)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run (scope set by the approved epic brief) |
| Outside Review | codex via `/plan-eng-review` | Independent 2nd opinion | 41 | unavailable | Codex CLI not installed; native fallback needs TaskOutput, absent here |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 40 | ISSUES OPEN | 20 issues, 0 critical gaps (2 decided D2/D3, 3 factual applied, 14 test gaps planned; late change R4: contract 1.2.0 back in scope per Basel's D10) |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | no UI in this ticket |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not applicable |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable (CLI not installed; native fallback capability missing). No cross-model coverage.
- **VERDICT:** no review CLEAR. Eng review complete with every decision answered (D1 B, D2 A, D3 A) and Approval readiness PASS; status is issues_open because the findings map to planned work, not because anything is undecided. Ready for `/eng-build MUT-280`.

NO UNRESOLVED DECISIONS
