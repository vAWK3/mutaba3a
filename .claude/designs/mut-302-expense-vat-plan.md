# MUT-302 — VAT on expenses: plan

**Ticket:** MUT-302 (Story, Backlog, label `firm-v2`), epic MUT-298 (Firm books).
**Blockers:** MUT-299 Done, MUT-300 Done. The pilot gate (D13) holds back v3–v5 only; this is v2.
**Blocks:** MUT-303 (vendor learning prefills VAT), MUT-308 (bills), MUT-313 (VAT summary).
**Inherits:** brief `firm-books.md` §7 (B9, D9, DR14), §11 (data model row), §12 (contract row); ADR-099.
**Repos:** mini-crm (server, portal, local mode, QA) and mutaba3a-flutter (phone capture). Status: planned, not built.

---

## 1. What the ticket asks (acceptance criteria)

| AC | Proven by |
|---|---|
| AC1 An expense with a rate stores net/VAT/gross that add up exactly, rounded like receivables | `expense-vat.test.ts` (pure), route tests, the shared case table run on server, portal and phone (§6) |
| AC2 Old expenses keep working and read "No VAT recorded" | migration leaves every row null; route test on a pre-existing row; local 13 → 14 migration test; QA `expenses.vat` step |
| AC3 Non-firm profiles see no new required field | `vat` is optional on the wire; portal and phone render the row only when `profile.firm`; component tests both ways |
| AC4 Summaries keep per-currency gross totals unchanged for existing data | `amountMinor` stays the gross and nothing in `summary.ts`/groups/Glance changes; a regression test sums a VAT and a non-VAT expense |
| AC5 Server, portal, phone tests; OpenAPI bump; Release-QA (web and phone) | §6, §7 |

Scope out (ticket): VAT returns (MUT-313), reverse charge beyond the existing `VatTreatment` values.

## 2. What exists (reuse)

- `server/src/vat.ts`: `computeVat`, `roundHalfUpDiv`, `assertRateBasisPoints`, `VAT_TREATMENTS`. An expense's amount is what was paid, so it is always `VAT_INCLUSIVE`.
- `server/src/schemas.ts:1484` `VatTreatmentSchema`; `AmountSchema` (formatted strings on the wire, like `Installment.net/vat/gross`).
- `prepareExpenseCreate` (`server/src/expenses/compose.ts:127`) is the one gate for every create path: `POST /v1/expenses`, receipt approve (`routes/receipts.ts:295`), the MCP write tool (`mcp/write-tools.ts:184`). `expensePatch` (:163) is the one gate for PATCH.
- `ReceiptSuggestion` already carries `vatMinor` and `vatRateBasisPoints` (server reader MUT-441, extract.ts:53). `suggestionToFormValues` (`src/hosted/lib/receiptSuggestion.ts`) ignores them today ("no VAT UI").
- `/v1/me` profile `firm: boolean` (serializers.ts:95–117). Phone: `HostedProfile.firm` (`lib/domain/models/auth.dart:315`).
- Local snapshot migrations chain (`src/hosted/local/migrations/index.ts`, now 13); MUT-254's `addVendors` (5 → 6) is the exact shape for adding expense columns.
- Phone: MUT-254's vendor field is the template end to end (draft field, `money_event` column, outbox dispatch, `_SupersededAttempt`, Details row). MUT-351 is the firm-gate template.

## 3. Data model

Migration `server/prisma/migrations/2026MMDD_mut302_expense_vat/`:

```prisma
model Expense {
  ...
  /// MUT-302 (ADR-229): all three null = "No VAT recorded", never a guessed split.
  vatTreatment       VatTreatment?
  /// Frozen on the row: the receipt's rate for STANDARD_RATED, 0 for the other treatments.
  vatRateBasisPoints Int?
  netMinor           BigInt?
  vatMinor           BigInt?
}
```

Raw-SQL CHECKs in the same migration:
- `expenses_vat_all_or_none`: `vatTreatment`, `vatRateBasisPoints`, `netMinor` and `vatMinor` are all null or all set.
- `expenses_vat_adds_up`: `netMinor + vatMinor = amountMinor` when set.
- `expenses_vat_zero_unless_standard`: `vatTreatment <> 'STANDARD_RATED'` implies `vatMinor = 0 AND vatRateBasisPoints = 0`.
- `expenses_vat_standard_rate`: `vatTreatment <> 'STANDARD_RATED' OR vatRateBasisPoints BETWEEN 1 AND 10000` (outside voice OV6).

**Rollback hazard (OV2):** add a MUT-302 entry to `ROLLBACK_HAZARDS` (`server/src/scripts/rollback-check.ts:27`), count `SELECT count(*) FROM expenses WHERE "vatTreatment" IS NOT NULL`. The consequence: an older revision PATCHes `amountMinor` on a VAT row, and `expenses_vat_adds_up` refuses it with a 500. Add the matching "Roll back past" row in `server/DEPLOYMENT.md` §6 and a `rollback-check.test.ts` case (PATTERNS: rollback hazard entry, MUT-444).

**No `grossMinor` column (proposed D3).** The gross is `amountMinor`. A second copy is a second truth the CHECK must chase on every amount edit. The wire still returns `gross`. The brief §7 lists `grossMinor`, so this amends it.

No new index: nothing filters on VAT until MUT-313. MUT-313 will scan by `(organizationId, occurredOn)`, which exists.

## 4. API contract (API `1.92.0-mut302`, minor bump: additive)

Request, on `CreateExpenseRequest`, `UpdateExpenseRequest` and (by `.extend`) `ApproveReceiptRequest`:

```ts
vat?: { treatment: VatTreatment; rateBasisPoints: number /* 0..10000 int */ } | null
```

- **Create:** absent or `null` → no VAT recorded. An object → the server computes `computeVat({ amountMinor, pricingBasis: 'VAT_INCLUSIVE', treatment, rateBasisPoints })`.
- **PATCH (D4):**
  - Absent keeps the treatment and rate. If `amount` or `currency` changes, net and VAT are recomputed from the new gross in the same write, so the CHECK never sees a stale split.
  - `null` clears all four columns.
  - An object sets them. Without `amount`, the split is computed from the row's existing amount. With `amount` (and `currency`), it is computed from the new amount in the new currency's digits (OV10).
- **Rate rules:** STANDARD_RATED needs `rateBasisPoints` 1..10000; 0 is refused with `VALIDATION_FAILED` `VAT_RATE_INVALID` (field `vat.rateBasisPoints`), since a 0 % standard rate is ZERO_RATED. The other treatments ignore the sent rate and store 0, as `computeVat` already does.
- **Who may send it (D2):** any profile. The server does not check `firm`. The UI is firm-only. A non-firm client that never sends `vat` sees no change, and refusing on non-firm would break phone outbox replays queued before an operator turned firm features off.

Response, on `Expense` (and so on `ExpenseDetail`, `ExpensePage`, `ApproveReceiptResponse`, the feed's expense entries):

```ts
vat: { treatment: VatTreatment; rateBasisPoints: number; net: Amount; vat: Amount; gross: Amount } | null
```

Nested and nullable (proposed D5), so "No VAT recorded" is `vat === null`. Receivables use flat fields because their VAT is never absent; here absence is the main state.

Malafat: expenses are session-only (`/v1/integration` never reads them), so no contract note. OpenAPI regenerated, `openapi:check`, `src/hosted/api/schema.d.ts` regenerated.

## 5. Changes by file

### Server (mini-crm `server/`)
- `prisma/schema.prisma` and the migration (§3).
- `src/expenses/vat.ts` (new, pure): `expenseVat(amountMinor, input | null | undefined) → ExpenseVatColumns` (all four `null` when there is no input) and `assertExpenseVatInput`. PATCH re-splits by calling `expenseVat(newAmount, { treatment, rate })` from the row, so no separate recompute function is needed (OV11). It all wraps `computeVat`; no new rounding.
- `src/expenses/compose.ts`:
  - `ExpenseCreateBody` gains `vat`.
  - `prepareExpenseCreate` spreads `expenseVat(...)`.
  - `expensePatch` (compose.ts:147) handles the PATCH cases of D4.
- `src/repositories/ports.ts`: `ExpenseRecord`, `CreateExpenseInput` and `UpdateExpensePatch` gain the four fields. On `CreateExpenseInput` they are **required `| null`**, so inbox filing (`inbox/file-expense.ts`), MCP creates and every other caller must set them, and no record is ever missing the keys (OV7).
- `src/repositories/prisma.ts` and `memory.ts`:
  - Pass the fields through.
  - `memory.ts` asserts the same three invariants as the CHECKs (the local mode has no Postgres).
  - `CURRENT_STORE_SNAPSHOT_VERSION` 13 → 14.
- `src/repositories/prisma-records-export.ts`: the four columns.
- `src/schemas.ts`:
  - `ExpenseVatInputSchema`, `ExpenseVatSchema`.
  - `vat` on Create/Update/Expense.
  - `ApprovedReceiptFields` unchanged (proposed D7).
- `src/serializers.ts` `serializeExpense`: `vat` block, formatted with `formatMoney` in the expense's currency.
- `src/app.ts`: `API_VERSION = '1.92.0-mut302'` (or the next free minor at build).
- `src/mcp/*`: the read tools don't use `serializeExpense` and keep their own shapes, without VAT for now. The write tool (`write-tools.ts:184`) doesn't take `vat` (D8) and writes the four columns as null (OV8).
- `src/inbox/file-expense.ts`: no change; inbox filing records no VAT.

### Local mode (portal signed out)
- `src/hosted/local/migrations/index.ts`: `addExpenseVat` 13 → 14 sets the four fields null on every `exps` row; register `{ from: 13, to: 14 }`.
- The format-fingerprint and records-file round-trip tests pick up the new shape.

### Portal (`src/hosted/`)
- `lib/expenseVat.ts` (new, pure):
  - `vatPreview(amount: string, currency, treatment, rateBasisPoints) → { net, vat } | null`, in BigInt over minor-unit digits, half-up, the same as `computeVat`. The portal may not import server code (ESLint guard), hence a port held to the server by the shared case table (§6).
  - `percentToBasisPoints("17.5") → 1750` and the reverse, as string work: up to 2 decimals, 0–100. Input goes through `normalizeNumerals` (`src/lib/utils.ts:135`) first, so Arabic-Indic digits work (OV10).
- `components/expenseForm/useHostedExpenseForm.ts`:
  - Values gain `vatTreatment: '' | VatTreatment` and `vatRate: string` (a percent).
  - The schema refines: a rate is required, and 0 < rate ≤ 100, when the treatment is STANDARD_RATED.
  - `createExpenseBody` sends `vat` only when a treatment is chosen.
  - A new `updateExpenseVat(existing, values)` sends `vat` on PATCH only when it changed: `null` when cleared, never when untouched (D4). "Changed" compares treatment and basis points, not the typed text ("17.5" = "17.50", OV10).
  - **Firm gate on the body (OV1):** `createExpenseBody(values, { firm })` drops `vat` when `firm` is false. Receipt Review runs on every profile and would otherwise send a VAT that a personal profile never saw.
- `components/expenseForm/ExpenseVatRow.tsx` (new), the DR14 collapsed row:
  - Closed, it reads "No VAT recorded", or "VAT 17 % · ₪ 14.53" when set.
  - Open, it shows the treatment `Select` (ui/Input) and the rate input, with net and VAT read-only from `vatPreview`.
  - A "Remove VAT" link sets the treatment back to none.
  - Uses the DESIGN.md disclosure-row pattern and `<bdi>` amounts (ADR-101).
- `components/expenseForm/HostedExpenseFields.tsx`:
  - Renders `ExpenseVatRow` when `firm` is true (a new prop).
  - `ExpenseDrawer` and `pages/views/ReceiptReview.tsx` pass `profile.firm`.
- `lib/receiptSuggestion.ts` `suggestionToFormValues`:
  - Takes `{ firm }`. On a non-firm profile it maps no VAT. `ReceiptReview.tsx:167`, and the late-suggestion path (`useLateSuggestion`, ~:319), pass `profile.firm` (OV1).
  - Maps a `vatRateBasisPoints` of 1–10000 to `vatTreatment: 'STANDARD_RATED'` + `vatRate`, and adds the hint field `'vat'`. A suggested rate of 0 prefills nothing and only hints, consistent with D6's no-guessing rule (OV5).
  - A `vatMinor` without a rate is not turned into a rate (proposed D6). The hint shows the read VAT amount next to the empty rate, so the person sees it, and nothing is guessed.
  - The header comment's "VAT … ignored" line is updated.
- `i18n` ar + en (portal is ar/en only): `hosted.expenses.vat.{row,none,summary,treatment,rate,ratePercentSuffix,net,vat,remove,errors.rateRequired,errors.rateInvalid}` and the four treatment names. Arabic first.
- `expenseApiErrors.ts`: map `VAT_RATE_INVALID` to the rate field.

### Phone (mutaba3a-flutter `mutaba3a/`)
- `lib/data/repositories/expense_repository.dart`:
  - `ExpenseEntry` gains a nullable `ExpenseVat` parsed from `vat`. The parse is hand-written and tolerant: an unknown treatment reads as "VAT recorded" without the treatment name, never a throw (review finding 4). A hand-written parse also avoids the json_serializable enum trap (finding 5).
  - `create` sends `vat` when set.
  - `update` passes it through. The edit sheet does not set it (below).
- `lib/domain/expense_vat.dart` (new, pure): the same `vatPreview` and percent ↔ basis-points as the portal, over `BigInt`. Its test pins about 10 inline golden cases taken from the server table, not a hand-copied versioned file (OV11, a scope cut).
- `CaptureDraft` (`capture_providers.dart:734`) gains `vatTreatment` and `vatRateBasisPoints`, with `copyWith`. They are cleared when the target profile changes (beside the category and vendor reset at :1278), when the target is not a firm, and when the kind is not an expense. `save()` writes VAT only for a firm expense, so it never follows a draft to a personal profile or to Unsorted, where the inbox branch would drop it (OV3).
- Drift `money_event` gains `vat_treatment TEXT NULL` and `vat_rate_bp INTEGER NULL`. Schema 10 → 11, with a migration step.
- `outbox_uploader.dart:929` dispatches them. `_SupersededAttempt` (~:985) carries them, so an edited unconfirmed row never replays the old VAT under the old key (the MUT-254 trap).
- `details_sheet.dart` gets a VAT row after Vendor, expense + firm profile only (lookup as `capture_screen.dart:452`). It is collapsed "No VAT recorded"; expanding shows the treatment chips and the rate, with net and VAT read-only.
- **Edit of a saved expense:** no editable VAT in v1 (D9). The edit sheet (`recent_actions.dart:826` `_showAmountNoteSheet`) shows a read-only line, "VAT 17 % · 17.00", when the expense has VAT (D9b, approved). The server's D4 recompute keeps the split exact when the amount changes, and the line re-reads the response.
- **Receipt suggestions:** the phone prefills nothing from suggestions today, so nothing to carry (the ticket's suggestion line is the portal's).
- `app_en.arb` / `app_ar.arb`: `expenseVat*` keys, with U+2066/U+2069 isolates around amounts (MUT-229).

## 6. Tests (written first, per CLAUDE.md TDD)

**Shared case table:** `server/src/__tests__/fixtures/expense-vat-cases.json`, about 30 rows `{ amountMinor, currencyExponent, treatment, rateBasisPoints, netMinor, vatMinor }`, generated from `computeVat`. They include half-up ties, 1 minor unit, JOD 3 digits, 10000 bp, and non-standard treatments.
- The server test generates and asserts it.
- The portal test (`src/hosted/lib/__tests__/expenseVat.test.ts`) reads the same file, since it is in the same repo.
- The phone test (`test/domain/expense_vat_test.dart`) pins about 10 inline golden cases taken from that table (half-up tie, 1 minor unit, 10000 bp, a non-standard treatment).

**Server (`npm --prefix server test`, plus `test:db` for the CHECKs):**
- `expenses/vat.test.ts`:
  - Property test: for random gross 1..10^9 and rate 1..10000, `net + vat = gross`, and `vat` equals `computeVat`.
  - Non-standard treatments store 0 and 0.
  - STANDARD with rate 0 → `VAT_RATE_INVALID`.
- `routes-expenses.test.ts`:
  - Create with and without `vat`.
  - PATCH amount recomputes; PATCH `vat: null` clears; PATCH absent keeps; PATCH currency + amount recomputes in the new digits.
  - The response shape.
  - A pre-existing row (inserted without VAT) reads `vat: null` (AC2).
  - Regression (review finding 3): PATCH the amount, then currency + amount, then the date of a no-VAT row. Each answers 200 and keeps `vat: null`.
  - PATCH with `vat` alone splits the existing amount. PATCH with `vat` + `amount` + `currency` splits the new amount in the new digits (OV10).
- MCP write-tool test: a create leaves the four columns null (OV8).
- `rollback-check.test.ts`: the MUT-302 hazard row (OV2).
- `routes-receipts.test.ts`: approve with `vat` stores it.
- `expenses-summary.test.ts`: a VAT expense and a plain one, same currency → the total is the sum of the gross amounts (AC4).
- `test:db` (`prisma.expense-vat.db.test.ts`): each CHECK refuses a raw insert that breaks it. The migration applies over a database that already holds expenses.
- `writability-drift`: untouched (no new scope).
- `openapi:check`.

**Local mode (`npm run test:run`):** `migrations.test.ts` 13 → 14 fills nulls; `format-fingerprint.test.ts` updated; `parity.test.ts` covers create with VAT through the local app.

**Portal:**
- `expenseVat.test.ts` (case table, percent parsing: `"17"`, `"17.5"`, `"0"`, `"100.01"`, `"abc"`).
- `receiptSuggestion.test.ts`: a rate prefills; VAT without a rate only hints; a rate of 0 only hints (OV5); a non-firm profile maps no VAT (OV1).
- `ReceiptReview.test.tsx`: approving on a personal profile, with a suggestion that has a rate, sends no `vat` (OV1, AC3).
- `ExpenseVatRow.test.tsx`:
  - Collapsed reads "No VAT recorded".
  - Expanding and choosing STANDARD + 17 shows net and VAT.
  - Remove clears it.
  - An Arabic render places the amounts in `<bdi>`.
- `ExpenseDrawer.test.tsx`: a non-firm profile has no VAT row (AC3); a firm edit leaves `vat` off the PATCH when untouched.

**Phone (`flutter test --concurrency=2`):**
- `expense_vat_test.dart` (golden cases).
- `expense_repository_test.dart`: parse with and without `vat`, and with an unknown treatment.
- The outbox superseded-attempt test with VAT.
- The `details_sheet` widget test (firm vs non-firm).
- A `capture_providers` test: VAT clears when the profile changes, or when the target becomes non-firm or Unsorted (OV3).
- The edit-sheet widget test: the read-only VAT line (D9b).

## 7. Release-QA

| Feature | App | Steps (as the person says them) | Expect |
|---|---|---|---|
| `portal.expenses.vat` | portal | On a firm profile, add an expense of 117, open VAT, choose Standard 17 %, save, reopen | It reads VAT 17 % with net 100.00 and VAT 17.00 |
| `portal.expenses.vat-none-personal` | portal | On a personal profile, open Add expense | There is no VAT row |
| `portal.expenses.vat-from-receipt` | portal | Review a receipt the reader read with a 17 % rate | The VAT row opens prefilled at 17 % |
| `ios.capture.vat` | phone | On the QA Fixture firm profile, capture an expense of 117, open Details, set Standard 17 %, save, then open it from Recent | Its edit sheet reads "VAT 17 % · 17.00" |

- `paths` cover `src/hosted/components/expenseForm/**`, `src/hosted/lib/expenseVat.ts`, `server/src/expenses/vat.ts` and the phone files.
- Specs are tagged `@portal.expenses.vat…` in `qa/specs/portal/expenses.spec.ts`, and the phone flow is `integration_test/qa/capture_vat_test.dart`, with the firm turned on by `qa/scripts/firm-on-qa-fixture.sh`.
- Each runs once to green; `release-qa lint` is clean.

## 8. Build order and verification

1. **mini-crm, one branch `feature/mut-302-expense-vat`:** server (tests → migration → compose → schemas → serializer → OpenAPI), then local mode, then portal, then QA.
   - Gates, under Node 22 through the heavy queue:
     - `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run build`
     - `npm --prefix server run typecheck|lint|openapi:check`, `npm --prefix server test`, `test:db`
   - Warn the orchestrator before merging: a Prisma migration restarts :8787.
2. **Flutter, one branch after the API version lands on local main:** model → drift 11 → outbox → Details row → l10n → tests → `ios.capture.vat`.
3. **Release order (review finding 1, OV4):** `api-v*` with `1.92.0-mut302` is **deployed to production** (`make release server`) before the phone build is submitted to either store, not merely merged to local main. The portal ships with the API, so it is not exposed. Both request schemas are `.strict()`, so an older API answers 400 to the key. The phone sends `vat` only when it is set.

## 9. Quality bar

- **DRY:** one VAT rule (`computeVat`) on the server. The portal and phone carry a display-only preview held to it by one case table. The server is the only writer of net and VAT; a client never sends them.
- **Testable:** `expenses/vat.ts`, `lib/expenseVat.ts` and `domain/expense_vat.dart` are pure. Routes are tested over the memory store; the CHECKs over Postgres.
- **Scalable / cost:**
  - Four nullable columns and no index; Postgres adds nullable columns without a rewrite.
  - No extra reads per write: the rate comes in the body, not from `vat_rates`.
  - The response grows by one small object per expense.
- **Constraints:**
  - Money keeps its currency (amounts formatted in the expense's own currency, never summed across).
  - Arabic first and RTL (`<bdi>`, ar keys first).
  - Drawer-first.
  - DESIGN.md disclosure row.
  - The firm check reads `profile.firm`, never ProfileType (firm epic rule).
  - Release-QA ready.
  - Knowledge files: ADR-229, CHANGELOG, SYSTEM_OVERVIEW (expense VAT), PATTERNS (shared case table across repos, if new), TEST_PLAN, and the brief §7 amended (no `grossMinor`; the split helper moves to MUT-308).

## 10. Decisions (Basel, 2026-10-29: every recommended default approved)

| Plan ID | Review Q | Decision | Answer |
|---|---|---|---|
| scope | D1 | The phone half stays in MUT-302: two branches, mini-crm first | Keep in MUT-302 |
| D1 | D2 | The server computes net and VAT; clients send treatment and rate only | Server computes |
| D3 | D3 | No `grossMinor` column; gross = `amountMinor` (overrides brief §7) | No gross column |
| D10 | D4 | The largest-remainder split helper moves to MUT-308 (overrides the MUT-302 Jira comment) | Move to MUT-308 |
| D9b | D5 | The phone edit sheet shows a read-only VAT line; no editable VAT on edit | Read-only line on edit |
| D2 | D6 | `vat` is accepted on any profile; only the UI is firm-gated | Accept on any profile |
| D5 | D7 | Nested `vat` object, nullable, on request and response | Nested vat object |
| D4, D6, D7, D8, D11 | D8 | As written below | Accept all five |

The proposals as originally written follow.

- **D1 Server computes; clients never send net or VAT.** The receipt's printed VAT can differ by one minor unit from half-up on the gross. *Alternative:* accept a client `vatAmount` within ±1 minor unit. *Default:* compute only, same as receivables, so MUT-313's totals are reproducible.
- **D2 `vat` accepted on any profile; the UI is firm-only.** See §4.
- **D3 No `grossMinor` column.** See §3.
- **D4 PATCH absent = keep and recompute on an amount change; `null` = clear.**
- **D5 Nested `vat` object, nullable, on request and response.**
- **D6 A read VAT amount without a rate only hints.** No back-solving a rate from amounts.
- **D7 `ApprovedReceiptFields` stays as is.** Measuring the reader's VAT accuracy is a follow-up, if wanted.
- **D8 The MCP write tool doesn't take `vat` in this ticket.**
- **D9 The phone edit sheet has no VAT field in v1.** Capture only; the server keeps the split right.
- **D10 The largest-remainder split helper moves to MUT-308, its only caller.** The MUT-302 Jira comment assigned it here; building it now has no caller (YAGNI).
- **D11 The rate is typed by the person (or read from the receipt), not taken from the profile's `vat_rates`.** Input VAT is the vendor's rate, and a firm may have no output rate set.

---

# Eng review (2026-10-29, /plan-eng-review)

**Target:** this plan. **Reviewer:** Claude (native). The outside voice ran as an independent Plan agent, because Codex isn't installed.

## Scope Challenge

- **Size:** about 22 changed files across two repos. There are 4 new pure modules (`expenses/vat.ts`, `lib/expenseVat.ts`, `ExpenseVatRow.tsx`, `domain/expense_vat.dart`) and 2 migrations (Prisma, drift), plus local format 13 → 14. The complexity gate trips (8+ files).
- **Already solved:** `computeVat` covers all the math. The approve route inherits `vat` through `CreateExpenseRequestSchema.extend` (schemas.ts:3510). The feed, inbox, approve and list responses all go through `serializeExpense` (serializers.ts:696, routes/inbox.ts:211, routes/receipts.ts:310/342, routes/expenses.ts:127/172/198), so one serializer change reaches all of them.
- **Already done?** No MUT-302 commits on main (`git log --grep MUT-302`), and no VAT on `Expense` (schema.prisma:1221–1263).
- **Deferrable without blocking the ACs:** the phone half could be its own child ticket, the way MUT-115 and MUT-333 split web and phone halves. The ticket's AC5 names phone tests and a phone Release-QA, so splitting moves that AC rather than cutting it.

**Reality rows**
- `REALITY: premise-table pass` — 9 premises checked, unverified=1 (the phone outbox's handling of a 400 on replay; the outside voice is asked). schema.prisma:1221, vat.ts:45, schemas.ts:3245/3339/3369/3510.
- `REALITY: already-done pass` — no hit for MUT-302 or Expense VAT on main d2d67656.
- `REALITY: surface-check pass` — POST/PATCH `/v1/expenses` (routes/expenses.ts:184) and receipt approve (routes/receipts.ts:295) exist; `GET /v1/settings/vat` exists, but the plan does not use it (D11).
- `REALITY: binding-decisions finding` — brief §7 lists a `grossMinor` column (plan D3 drops it) and the MUT-302 Jira comment assigns the largest-remainder helper here (plan D10 moves it). Both need Basel's override; ADR-099 DR14 is kept as approved.
- `REALITY: numbers pass` — "about 22 files" and "about 30 case rows" are `[estimated]`; no performance number is claimed.
- `REALITY: deferred-asks finding` — the ticket's "receipt suggestions carry VAT when read" is covered for the portal only; the phone prefills nothing from suggestions today (`receipts_library_repository.dart:152–157`, display only). The VAT split helper is deferred to MUT-308 (D10).
- `REALITY: pr-count pass` — two branches (mini-crm, then Flutter), as every cross-repo ticket here; no extra gate.
- `REALITY: transaction-semantics n/a` — no driver, pool or transaction change; columns and CHECKs only.

## Findings

1. **[CRITICAL] (9/10) server/src/schemas.ts:3339 `.strict()` — release order.** A phone build that sends `vat` to an API older than 1.92 gets a 400 on every VAT expense: both request schemas are strict (`.strict()` at :3339 and :3369). **Fix (required, no choice):** the API ships before any phone build that sends `vat`, and the phone sends the key only when VAT is set. Write this into §8 and the Flutter PR description.
2. **[CRITICAL] (8/10) Plan §7 `ios.capture.vat` expect — the outcome is not observable.** The plan's expect says "the Recent row's expense reads the VAT", but §5 adds no VAT display anywhere on the phone after save (D9 has no VAT field on the edit sheet). A spec cannot end on that outcome. → **D9b**, approved (review D5): a read-only VAT line on the edit sheet, and the expect now reads it.
3. **[CRITICAL] (8/10) Regression: PATCH on an expense without VAT.** Existing PATCHes (amount, currency + amount, date) must keep `vat` null and succeed under the new CHECKs. **Required proof, added to §6:** a route test that PATCHes the amount of a pre-existing no-VAT row and asserts 200 with `vat: null`. Also a `test:db` test that the migration applies over existing rows. This regression contract preserves current behaviour exactly; nothing intended changes.
4. **[INFORMATIONAL] (8/10) Prior learning applied: flutter-capturesource-strict-decode (10/10, 2026-10-25).** The phone decodes some enums strictly (`CaptureSource.fromString` throws). `vat.treatment` must decode with a tolerant parse: an unknown value reads as "VAT recorded" without the treatment name, never a throw that blanks the feed. Folded into §5 Phone.
5. **[INFORMATIONAL] (8/10) Prior learning applied: flutter-enum-needs-build-runner (10/10, 2026-10-26).** A json_serializable `VatTreatment` enum needs `build_runner` re-run, or `toJson` writes null. Folded into §5 Phone. A hand-written parse avoids it.
6. **[INFORMATIONAL] (7/10) src/hosted/lib/receiptSuggestion.ts:9 says VAT is "not form fields (no VAT UI, the epic's decision) and are ignored".** The comment becomes false; §5 already updates it. No choice.
7. **[INFORMATIONAL] (7/10) Three VAT previews (TS server, TS portal, Dart).** Rubric: the server and portal cannot share code (`src/hosted` ⊄ `server/src`, ESLint guard), and Dart cannot share with TS. The case table is the practical shared contract, and only the server writes amounts. Accepted as planned, no extraction.

**Performance (Section 4):** No issues found. There are no new queries; `prepareExpenseCreate` gains no lookup, because the rate comes in the body (D11). Four nullable columns are added with no rewrite on Postgres 11+. The response grows by about 120 bytes per expense with VAT `[estimated]`.

## Business / product impact
- Firms can record the VAT they paid on each expense, which is what they reclaim. Until now an expense was one gross number, so the accountant re-keyed every receipt.
- This is v2 of MUT-298 and runs before the pilot gate. It unblocks MUT-303 (vendor prefills VAT), MUT-308 (bills carry VAT) and MUT-313 (the VAT summary for the accountant).
- Low risk: additive, nullable and firm-gated in the UI. Existing totals are untouched because the amount stays the gross.

---

## Outside voice (independent Plan agent; Codex not installed)

The agent read the plan and the code; its recommendation was "approve with changes". It made 12 findings, and every one was folded into the plan. They were all fixes to approved contracts (AC3, the CHECKs, release order) or plan corrections, so none needed a new decision:

| # | Sev | Finding | Disposition |
|---|---|---|---|
| OV1 | P1 | Receipt Review (`ReceiptReview.tsx:167`) runs on every profile, so a read rate would save hidden VAT on a personal profile (breaks AC3) | Fixed: `firm` gates `suggestionToFormValues`, the late-suggestion path and `createExpenseBody`; portal test added |
| OV2 | P1 | No rollback hazard: an older revision PATCHing a VAT row's amount hits the CHECK and answers 500 | Fixed: a `ROLLBACK_HAZARDS` entry, a DEPLOYMENT.md §6 row and a test (§3) |
| OV3 | P1 | Phone draft VAT survives a profile change and could reach a personal profile, or Unsorted where the inbox drops it | Fixed: cleared on profile, firm or kind change; `save()` writes VAT only for a firm expense; test added |
| OV4 | P1 | Strict schemas + a phone sending `vat` to an older production API = 422 on every replay | Fixed: production deploy of 1.92 gates the store submission (§8.3) |
| OV5 | P2 | A suggested rate of 0 would prefill an unsavable STANDARD form | Fixed: a 0 rate only hints (D6 rule) |
| OV6 | P2 | The CHECKs don't require STANDARD to have a 1–10000 rate | Fixed: `expenses_vat_standard_rate` + memory store |
| OV7 | P2 | Optional input fields leave keys missing in memory/local records | Fixed: required `| null` on `CreateExpenseInput` |
| OV8 | P2 | The plan wrongly said MCP read tools use `serializeExpense` | Corrected; MCP create test added |
| OV9 | P2 | The phone shows no VAT after save | Already resolved by D9b (review D5) |
| OV10 | P2 | PATCH `vat` without/with amount unstated; "changed" by string; Arabic-Indic digits | Fixed in D4, the portal form and tests; `normalizeNumerals` |
| OV11 | P2 | `recomputeExpenseVat` is redundant; the phone case-file machinery is heavy | Fixed: dropped; the phone pins about 10 inline golden cases |
| OV12 | P2 | `expensePatch` is at compose.ts:147; the VAT the portal shows comes from the server reader (extract.ts:52–53) | Corrected; at build, the QA "from receipt" fixture must carry a rate |

Verified clean by the agent: every other expense write goes through `createExpenseRow` (prisma.ts:3209) or never touches amounts. Records-export columns are type-checked. No other branch competes for snapshot 14 or drift 11.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|---|---|---|---|---|---|
| Eng review | /eng-ticket MUT-302 | plan before build | 1 | DONE | 7 native (3 critical, all fixed or decided) |
| Outside voice | default-on | independent challenge | 1 (native Plan agent) | DONE | 12 (4 P1, 8 P2), all folded in |
| Design review | not run | DR14 was approved with the brief | 0 | — | — |

- **VERDICT:** APPROVED WITH CHANGES. Ready for /eng-build once committed.
- **MODE:** scope accepted as-is (the phone half stays); one scope cut (the phone case-table file → inline goldens).
- **OUTSIDE COVERAGE / CROSS-MODEL:** native Plan agent, same model family. Codex is not installed, so this is not a cross-model check.
- **Decisions:** D1–D8 of this review are approved by Basel (2026-10-29, all recommended), recorded in §10.
- **Test plan artifact:** `~/.gstack/projects/vAWK3-mutaba3a/basel-feature-mut-302-expense-vat-eng-review-test-plan-20261029-184743.md`.
- **Brief overrides to record at build:** firm-books §7 (no `grossMinor`; the split helper moves to MUT-308) and ADR-099; the next ADR is ADR-229.

**UNRESOLVED DECISIONS:**
NO UNRESOLVED DECISIONS
