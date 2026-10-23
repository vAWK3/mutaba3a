# MUT-388 plan: drop the Gulf currencies, offer ILS, USD, EUR and JOD

Tracker: Jira · barmajiyat · MUT via atlassian-barmajiyat · Backlog = not committed · after /eng-ticket → Planned · /eng-build → In Progress.
Epic: MUT-278. Reverses the Gulf part of MUT-279 (phone), MUT-280 (server) and MUT-281 (portal).
Repos: mini-crm (`~/Work/Barmajiyat/Mutaba3a/mini-crm`) and mutaba3a-flutter (`~/Work/Barmajiyat/Mutaba3a/mutaba3a-flutter/mutaba3a`).
Status: eng-reviewed 2026-10-22. Decisions R1–R4 approved, and this body is rewritten to match them (see the review below).

## What we found (2026-10-22)

- **JOD isn't on Frankfurter either.** The ECB prices only USD and ILS against EUR. JOD stays on its USD peg (0.709, ADR-087 §3). Basel chose to keep JOD.
- **MUT-282 and MUT-283 never landed in code**, although Jira shows both as Done.
  - No `src/lib/currencies.ts` registry exists.
  - The local-app CSV is still the four (`csvValidation.ts:18`).
  - No peg logic in `src/lib/fx`.
  - The local web app only got MUT-281's type widening (804b0375).
- **What's live:**
  - Server: the Gulf codes are in every API tag from `api-v0.3.13` (2026-10-19) to `api-v0.4.1` (2026-10-22).
  - Portal: they're in `HOSTED_CURRENCIES`, and it ships with the server.
  - Phone: they're in 0.1.7 (commit `1c8a5807`, untagged).
- **The database doesn't constrain currency.** Every currency column is `VarChar(3)` with no enum or CHECK, so no migration is needed. It also means nothing rejects existing Gulf rows.
- **Stray Gulf rows on the server:**
  - Reads: nothing validates responses, and `formatMoney` with an unknown exponent returns `amount: ""` (the portal shows "—").
  - Writes: a PATCH that falls back to the stored currency (`expenses/compose.ts:114`, `conversions/compose.ts:64-65`, `routes/inbox.ts:149`) runs `parseMoney` with an undefined exponent and silently mis-scales the amount.
  - Every write reaches `parseMoney` through `agreements/compose.ts:34-38`, which maps `MoneyParseError` → 422 `AMOUNT_INVALID`.
- **The phone already obeys the server's list.**
  - `currenciesFromJson` → `Currency.offeredBy` (`auth.dart:350`, `currency.dart:40-50`) intersects the server's list with the enum.
  - The FX sheet shows only priced codes.
  - `_offeredOrNull` (`capture_providers.dart:1126-1130`) drops a parsed currency the server doesn't offer, together with its amount.
  - Server-row parsing is tolerant: `parse_known.dart`, and the repositories catch `UnknownCurrencyException`.
- **Two phone parity tests pin mini-crm's docs:**
  - `currency_test.dart:161-175` checks that `isUsdPegged` equals the keys in `pegs.json`.
  - `analytics_contract_test.dart:76-82` checks that `Currency.values` equals `contractCurrencies`.

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **The server's list is the switch.** Keep the per-USD cross rates, "derived if either side is pegged", `USD_PEGS` (now `{ JOD }`), the portal's derived-flag peg label, the phone's tolerance for unknown codes, MUT-352's single-line symbol box, and the neutral Arabic peg label. | It's all correct for JOD alone. Bringing a currency back is a server change. |
| D2 (R2, R3) | **A data gate run before and after the server deploy.** `server/scripts/currency-rows.sh` is read-only and runs via `npm run db:run`. It finds every currency column from `information_schema` (billing tables excluded) and counts values outside the list grepped from `SUPPORTED_CURRENCIES` in `server/src/money.ts`. Found rows: any on Basel's test/operator profiles (a list he names before release night) are deleted in the same `db:run` session. Any on another profile **stops the release** for Basel's call. | v0.4.1 accepts Gulf writes until the deploy finishes, so only the after-deploy run is definitive. Stray rows read blank and can't be edited. |
| D3 (R1) | **`parseMoney` refuses a currency with no exponent**: it throws the existing `MoneyParseError`, which every write already turns into 422 `AMOUNT_INVALID`. `formatMoney` is unchanged. | It closes the silent mis-scale with no new error class or code. |
| D4 | **Release order: web → D2 gate → server (API + portal).** This follows the pilot-gate decision and ADR-102 `release-full`. The phone ships in its next normal build; no phone release is forced. | `release-server` pushes main, so Netlify deploys the web anyway. Order isn't needed for phone correctness. |
| D5 (R4) | **Phone: the five enum values stay, unused.** The parity tests become subset checks. Only the not-server-driven lists change: the FX widget picker and the fastlane release notes. No tolerant-loader work and no enum shrink. | The server list already hides them everywhere on the phone. This is the smaller, safer change (Basel, D5). |
| D6 | **Analytics contract 2.0.0** (four currencies) in `docs/analytics/events.json`. Append its sha256 to `PINNED_VERSIONS`; the phone pins 2.0.0. | `docs/analytics/README.md:135-136`: a removal is a major version. |
| D7 | **ADR-166** partly overrides ADR-098: the Gulf five are removed, the peg table keeps JOD, the phone keeps them dormant, and §7's "web reads it / server-ci watches docs/fx" lines are corrected. ADR-087 §3 gets an "extended, then narrowed" note. | DECISIONS.md conflict rule. |
| D8 | **QA:** delete the flows that exist only for the Gulf currencies. Move the 3-decimal and "pick a non-default currency" coverage to JOD. | The local QA server will refuse Gulf codes. |
| D9 | **Jira:** MUT-279/280/281 close as Done with a "superseded by MUT-388" comment once MUT-388 ships. MUT-352 stays. MUT-282/283 get a comment that they were never built, flagged as a Done-gate process gap. MUT-278's summary is renamed. | Housekeeping. |

## Changes

### 1. mini-crm: server (`feature/mut-388-drop-gulf-currencies`, worktree)

- `server/src/money.ts:13-17`: the four codes and their exponents.
- `money.ts:56-59` `parseMoney`: `if (exponent === undefined) throw new MoneyParseError(\`${currency} is not a supported currency\`)` (D3).
- `server/src/fx-rates.ts:10-37`: `USD_PEGS = { JOD: 0.709 }` and the comments. `PeggedCurrency` narrows to `'JOD'` on its own.
- `server/src/schemas.ts:675-684, 1181-1192`: comments only; the values are generated.
- `server/src/app.ts:154`: `API_VERSION` → `1.47.0-mut388` (renumbered if something lands first). Update the pins in `routes-m2…m8.test.ts`.
- `npm --prefix server run openapi:generate` → `server/openapi/openapi.yaml`.
- `server/README.md:158`.
- New `server/scripts/currency-rows.sh` (D2), with the header comment style of `profile-rows.sh`. It prints table/column/value/organizationId/count, and has a `--delete-test-profiles <uuid,…>` mode that runs as one transaction and supports `--dry-run`.
- Tests:
  - `money.test.ts`: four codes; the Gulf codes are unsupported; `parseMoney('12.345', 'AED' as Currency)` throws `MoneyParseError`.
  - `fx-rates.test.ts`: `PEGS = {JOD}`; 4×4 grid; only JOD pairs derived; pegs.json parity stays.
  - `routes-fx-rates.test.ts`: four rows; `?base=JOD` gives 3 derived; `?base=AED` → 422.
  - `income-routes`, `routes-conversions`, `routes-expenses`, `routes-profiles`: the Gulf blocks go; a write in AED → 422.
  - New route test: a PATCH `{amount}` on a stored AED expense (seeded directly in the store) → 422 `AMOUNT_INVALID`, and the row is unchanged.
  - `import/plan.test.ts`: AED → `UNSUPPORTED_CURRENCY`.
  - `store-contract-expenses.ts:62-67`: BHD → JOD.
  - The script gets a `test:db` case: seeded Gulf rows are counted, and the delete mode removes only the listed profiles' rows.

### 2. mini-crm: portal, local app and landing page (same branch)

- `src/hosted/format/currencies.ts:10` `HOSTED_CURRENCIES` back to four, plus `npm run hosted:types` → `schema.d.ts`.
- `src/hosted/data/expenseGroups.ts:248`: comment.
- Portal tests:
  - Delete the BHD/AED cases in `ExpenseDrawer.test.tsx:290-357`, `incomeForm.test.ts:47-53` and `ConversionDrawer.test.tsx:352-366`.
  - Flip `ProfileCreateDrawer`/`ProfilesManageDrawer` and `filters.test.ts:63-67` to assert the Gulf codes are absent.
  - `expenseGroups.test.ts:304-325`: rewrite with JOD + EUR.
  - `ExpenseGroups.test.tsx:244-257`: delete.
- Local app (undoing 804b0375):
  - `src/types/index.ts:2`
  - `src/lib/utils.ts:12-26, 115-133`
  - `currencyAmounts.ts:21-25`
  - `db/aggregations.ts:36-40, 339-343, 518`
  - `ExpensesLedgerPage.tsx:136`
  - The no-op casts in four local drawers
  - Tests: `utils.test.ts:83-89, 282-311`, `aggregations*.test.ts`, `landingCopy.test.ts:22`
- Landing page: `landingCopy.ts:14-18`; `en/landing.json` and `ar/landing.json:110-115`.
- QA:
  - Delete `portal/expense-groups.yaml` `gulf-peg-label` with its spec and the OMR fixture.
  - Rewrite `portal/income.yaml` `currency-qar` as `currency-jod`.
  - `qa/support/portalApi.ts:26, 248`.

### 3. mini-crm: docs (same branch, first commit, so the phone can copy)

- `docs/fx/pegs.json` → `{ "JOD": 0.709 }`.
- `docs/analytics/events.json`: 2.0.0 with four currencies, plus the `PINNED_VERSIONS` row (D6).
- `.claude/DECISIONS.md`: ADR-166 (D7).
- `.claude/CHANGELOG.md`: a new entry.
- `.claude/SYSTEM_OVERVIEW.md`: API-version row.
- `.claude/TEST_PLAN.md`: a MUT-388 table.
- `.claude/TECH_DEBT.md`: a TD-170 note.
- `docs/commercial/pilot-offer.md` (:61, 67, 112, 159) and `hosted-request-reply.md` (:18, 43, 84): four currencies.
- `docs/operations/pilot-runbook.md`: the D2 gate as a release step.

### 4. mutaba3a-flutter (`feature/mut-388-drop-gulf-currencies`, worktree, after #3 is on mini-crm main)

1. Re-copy `test/fixtures/fx/pegs.json` and `test/fixtures/analytics/events.json` byte for byte, and update their READMEs (sha256).
2. `analytics_contract.dart:7-22`: `contractVersion` 2.0.0, the sha256, and `contractCurrencies` = the four.
3. Parity tests become subset checks:
   - `analytics_contract_test.dart:76-82`: every contract currency is a `Currency` value.
   - `currency_test.dart:161-175`: every server peg key is `isUsdPegged`, and JOD's rate matches.
4. `ios/CaptureWidgets/FxIntents.swift:20-24` `CurrencyEntity.all` → the four. `FxDisplayTests.swift:21` → `["EUR","JOD"]`.
5. `ios/fastlane/metadata/{release_notes.txt, en-GB, ar-SA}`:5: stop advertising the Gulf currencies.
6. QA:
   - Delete `gulf-currency-aed` (capture.yaml + flow) and `gulf-peg-label` (fx.yaml + flow).
   - `gulf-bhd-decimals` → `jod-decimals` (a JOD 3-decimal capture flow).
   - `account.yaml` `profile-currency-picker`: four codes, picks JOD.
   - `unknown-currency-tolerated` stays manual.
7. No change to `currency.dart`, the l10n names, `share_text_parser.dart`, the loaders or the generated code (D5).

## Tests that prove each acceptance criterion

| AC | Proof |
|---|---|
| No Gulf rows survive in production | `currency-rows.sh` before and after the deploy; output pasted into Jira (D2) |
| `/v1/me.currencies` = four; fx-rates prices four; JOD derived | `routes-sessions` / `routes-device-sessions` (follow `SUPPORTED_CURRENCIES`), `routes-fx-rates.test.ts`, `fx-rates.test.ts` |
| A Gulf write → 422 | the route tests, `import/plan.test.ts`, and the stored-AED PATCH test (D3) |
| An installed 0.1.7 phone works and offers four | Unit: the existing `offeredBy` tests. **Manual live check:** build `1c8a5807` on the "Mutaba3a QA" sim against a local server on the branch; the currency picker shows four; a share-sheet "AED 50" drops the currency |
| Portal and landing show four | portal unit tests + the `currency-jod` spec; the landing en/ar key test |
| Phone: no Gulf offered anywhere; tolerance holds | subset parity tests, `FxDisplayTests`, `ios.capture.jod-decimals`, `ios.account.profile-currency-picker`; `release-qa lint` |
| Gulf QA flows removed or rewritten; lint clean in both repos | `release-qa lint` both repos; `release-qa release --only ios.capture.jod-decimals,ios.account.profile-currency-picker`; `release-qa run --only portal.income.currency-jod` |

The ticket's AC "the phone build has no Gulf codes left" is replaced by "the phone offers no Gulf currency anywhere" (D5). Update the ticket text.

Commands:
- mini-crm, under Node 22: `npm run lint && npm run typecheck && npm run test:run && npm run build`, then `npm --prefix server run typecheck && npm --prefix server run lint && npm --prefix server run openapi:check && npm --prefix server test`, plus `test:db` and `npm run hosted:types:check`.
- Flutter: `flutter analyze && flutter test`, then `release-qa lint` and the flows above. These need the shared "Mutaba3a QA" simulator, so use `--wait`.

## Constraints and guardrails

- **Hosted-only phone:** the outbox and Idempotency-Key path is unchanged.
- **i18n:** en and ar are edited together. The Arabic peg label stays neutral.
- **Shared checkouts:**
  - Build in worktrees; merge under `/tmp/mutaba3a-locks/{mini-crm,flutter}-main`.
  - The flutter main checkout has someone else's uncommitted `CLAUDE.md`, so don't touch it.
  - Run `env -u APPLE_TEAM_ID` for the API and release-qa.
- **Cost:** none.
- **Scale:** n/a. The gate runs `COUNT` per column, by hand.

## Out of scope

- Other ECB currencies (GBP, CHF, TRY…).
- Removing JOD.
- MUT-273.
- A "retired currency" display table.
- Removing the dormant phone enum values (D5).
- Foreign-dinar parsing (Kuwaiti and Iraqi still read as JOD, as before MUT-279).


## QA scenarios

| Scenario | Steps, as the user would say them | Promise | Catalog id |
|---|---|---|---|
| Add income in JOD | Open Receivables, + Add income, More details, check the currency list, choose JOD, type 1,250.505, pick a client, save, filter by JOD then USD | The list offers USD, ILS, EUR, JOD only; it saves 1250.505 JOD and the filter finds it | `portal.income.currency-jod` |
| JOD in a trip group | Open a group with JOD and USD expenses | The ≈ line names ILS at today's ECB rate and labels the JOD rate "(USD peg)" | `portal.expense-groups.currencies-converted` (existing) |
| Phone capture in JOD | Capture an expense, pick JOD, type 3 decimals | It saves at 3 decimals | `ios.capture.jod-decimals` (Flutter) |
| Phone profile currency | Account › a profile › Currency | The picker offers the four codes; JOD saves | `ios.account.profile-currency-picker` (Flutter) |

The gate (`currency-rows.sh`) and the 0.1.7 live check are operator steps, not catalog flows: runbook §11 and the
MUT-388 acceptance criteria.

## Review amendments (/qa-reconcile + /review, 2026-10-22, Basel)

- **D1:** a stored Gulf row reads back with its real amount. `RETIRED_EXPONENT` in `money.ts` is display only. A blank amount failed the phone's whole Recent page, because the phone keeps the Gulf enum values and `MoneyCodec` throws on `""`.
- **D2:** filing an inbox entry in a removed currency answers 422 `UNSUPPORTED_CURRENCY`.
- **D3:** the gate counts only live rows and names the inbox user.
  - `delete-test-profiles` soft-deletes where a table has `deletedAt` and hard-deletes only unreferenced rows; otherwise it lists the blockers and changes nothing.
  - It takes `--user-id` for the inbox and always previews first.
- **D4:** the removed Gulf tests are kept removed (gate RH-1): each has a refusal test or an existing JOD equivalent.
- **Portal local mode** stays outside the gate. Its rows read correctly and refuse a new amount.
