# MUT-280 test plan: Gulf currencies on the server

Plan: `mut-280-gulf-currencies-server.md`. TDD: every case below is written red before the code it covers. Run under Node 22 (TD-054).

## Unit: `server/src/__tests__/money.test.ts`
| # | Case | Expect |
|---|---|---|
| M1 | `parseMoney('1250.50','AED')`, `('0.5','SAR')`, `('3','QAR')` | 125050n, 50n, 300n; `formatMoney` gives `1250.50`, `0.50`, `3.00` |
| M2 | `parseMoney('12.345','BHD')`, `('0.001','OMR')` | 12345n, 1n; formats `12.345`, `0.001` |
| M3 | `parseMoney('1.234','AED')`, `('12.3456','BHD')` | `MoneyParseError` (more than 2 / 3 digits) |
| M4 | BHD ceiling `999999999999.999` / `1000000000000.000` | accepted / refused |
| M5 | `isSupportedCurrency` | true for all nine; false for `KWD`, `aed`, `` |
| M6 | `currencyExponent` | the §2 table, literally |

## Unit: `server/src/__tests__/fx-rates.test.ts` (fixed snapshot `{USD 1.1208, ILS 3.4769}`)
| # | Case | Expect |
|---|---|---|
| F1 | `it.each(SUPPORTED_CURRENCIES)` for each base: nine rows in order, base at `{rate 1, derived false}` | (existing case, now covering 9) |
| F2 | 9×9: each rate equals `round6(perUsd[to]/perUsd[from])`, with `perUsd` built **in the test** from the snapshot and literal pegs | all 72 equal |
| F3 | pegged↔pegged equals the plain ratio: AED→SAR 1.021103, BHD→OMR 1.022606, JOD→AED `round6(3.6725/0.709)` | equal |
| F4 | `derived` matrix: `base !== c && (pegged(base) || pegged(c))`, using a literal pegged set in the test | every cell; base AED: 8 derived; base USD: exactly the 6 pegged; {ILS, USD, EUR} pairs never |
| F5 | Existing pins unchanged: USD→ILS 3.102159, ILS→USD 0.322356, ILS→EUR 0.287613, ILS→JOD 0.22855, JOD→USD 1.410437 | unchanged (regression guard) |
| F6 | `USD_PEGS` equals `{JOD 0.709, AED 3.6725, SAR 3.75, QAR 3.64, BHD 0.376, OMR 0.3845}`; `isPegged` is true for exactly those six | equal |
| F7 | `FrankfurterSource` still asks `base=EUR&symbols=USD,ILS` | (existing case, kept) |

## Unit: `server/src/__tests__/fx-rates.test.ts`, describe "peg fixture" (review D1: no separate file)
| # | Case | Expect |
|---|---|---|
| P1 | `docs/fx/pegs.json` `unitsPerUsd` deep-equals `USD_PEGS` (same keys both ways, same values) | equal; on failure the message prints the expected JSON |

## Routes (in-memory store)
| # | File | Case | Expect |
|---|---|---|---|
| R1 | `routes-fx-rates.test.ts` | `?base=AED` | 200, 9 rows in supported order, `derived` true except AED |
| R2 | 〃 | `?base=BHD`, `?base=ILS` | BHD: 8 derived; ILS: derived exactly on the 6 pegged rows |
| R3 | 〃 | `?base=KWD` | 422 `VALIDATION_FAILED` |
| R4 | 〃 | provider down, empty cache, `?base=AED` | 503 `FX_RATES_UNAVAILABLE` |
| R5 | `income-routes.test.ts` | POST AED `1250.50`, then GET | 201; reads back `"1250.50"`, `AED` |
| R6 | 〃 | POST BHD `12.345` / BHD `12.3456` / AED `1.234` | 201 / 422 / 422 `VALIDATION_FAILED` |
| R7 | `routes-expenses.test.ts` | POST OMR `0.385` | 201, `"0.385"` |
| R8 | `routes-conversions.test.ts` | POST AED `100.00` → BHD `10.250` | 201, each leg in its own digits |
| R9 | `routes-profiles.test.ts` | POST `defaultCurrency: 'SAR'`; PATCH to `QAR` | 201; 200 with `QAR` |
| R10 | `routes-sessions.test.ts` | `GET /v1/me` and `POST /v1/sessions` | `currencies` equals `[...SUPPORTED_CURRENCIES]`; body parses with `MeSchema` |
| R11 | `routes-device-sessions.test.ts` | `POST /v1/device-sessions` | `currencies` present and equal; body parses with `DeviceSessionSchema` |
| R13 | `import/__tests__/plan.test.ts` | a PROJECT row in AED vs KWD | AED planned as `create`; KWD `conflict` / `UNSUPPORTED_CURRENCY` (eng review finding 3) |
| R12 | `routes-m2/3/4/5/6/8.test.ts` | version pins | `1.35.0-mut280` (or the renumbered version at landing) |

## Integration (Postgres, `npm --prefix server run test:db`, CI)
| # | File | Case | Expect |
|---|---|---|---|
| D1 | `repositories/__tests__/store-contract-expenses.ts` | create and read back a BHD expense `amountMinor 12_345n` | same row; proves `VarChar(3)` needs no migration |

## Analytics contract (D10)
| # | File | Case | Expect |
|---|---|---|---|
| C1 | `scripts/__tests__/analytics-taxonomy.test.ts` (existing cases) | events.json 1.2.0 with nine currencies; `PINNED_VERSIONS['1.2.0']` = its sha256 | the pin, latest-version and currencies-equal-`SUPPORTED_CURRENCIES` cases all pass; red if money.ts and events.json disagree |

## Contract
- `npm --prefix server run openapi:check` is clean. The generated spec has the 9-value `Currency` enum, `Me.currencies` (array of string, required), and the new `derived` description.
- Not in this ticket: `npm run hosted:types:check` (red until MUT-281, plan D1 and a TD).

## Gate
`npm --prefix server run typecheck && npm --prefix server run lint && npm --prefix server run openapi:check && npm --prefix server test`, plus root `npm run typecheck` (stays green, `src/**` untouched) and `npx vitest run scripts/__tests__/analytics-taxonomy.test.ts` (Node 22).
