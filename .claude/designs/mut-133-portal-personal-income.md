# MUT-133 — Hosted portal: record income and payments on a personal profile (plan)

Status: **Planned, pending eng review + owner approval** (2026-10-14)
Ticket: MUT-133 (Story, Backlog, no epic). Relates to MUT-93 (Done). Depends on MUT-65 (Done).
Neighbours: MUT-91 (portal after-save feedback, Backlog) owns Undo/success toasts; MUT-85 (local lump-sum payment) is unrelated surface; MUT-175 (portal reports) untouched.

## 1. Problem and acceptance criteria

A personal hosted profile's session already holds `payments: read-write` and `capture:write` (MUT-65), and the server already exposes `POST /v1/income` and `POST /v1/receivables/{id}/settle`. The portal renders no write affordance at all on its income views (hosted-portal.md §7.4), so a freelancer at a desk has to pick up the phone to log income.

AC (from the ticket, plus the owner's 2026-10-14 decisions):

1. On the signed-in user's own personal profile, the portal can **add income** (Received or Owed) from Receivables, Payments and Client detail.
2. It can **record a payment** against an open Owed entry from a Receivables row (Receivables page and Client detail → Receivables tab).
3. After either save, the affected lists and summaries show the new state with no reload.
4. Malafat-fed profiles and non-personal profiles render exactly what they render today: no button, no actions column, the same notice.
5. `ReadOnlyNotice` no longer tells a personal-profile user "This view is read-only" once they can write.
6. Tests prove 1–5.

Owner decisions (2026-10-14):
- **D-scope**: Add income + Record payment. No delete/edit row action.
- **D-undo**: no Undo in this ticket; MUT-91 owns Undo and row highlighting. *(Narrowed by design review 3A: a polite "Saved" status is shown, see §3.8.)* A settle can never be undone through the API anyway (DELETE /v1/income refuses an allocated payment with 409).
- **D-gate**: shown only when `isPersonalDefault`; then `profile.income` (IncomeCaptureRules) shapes the form. This answers Basel's MUT-93 comment: `income` alone is not enough, because Malafat-fed profiles also carry `received: true` since MUT-61, and the ticket keeps them read-only. ADR-066 already records why "writer null" is not "personal".

Out of scope: any `server/` change (none needed — contract verified below), Overview page affordances, Documents, editing/deleting existing entries, Undo, JOD in the filter bar.

## 2. Server contract (verified in code, no change)

| Call | Auth | Notes |
|---|---|---|
| `POST /v1/income` | session, `capture:write`, `Idempotency-Key` required | `kind: received\|owed`, `amount` decimal string, `currency`, `occurredOn` ≤ today, `customerId?`, `projectId?`, `title?`, `notes?`, `dueDate?` (Owed; server defaults EOM_15), `method?` (CASH\|BANK, Received). 201 `IncomeResponse`. |
| `POST /v1/receivables/{id}/settle` | session, `payments:write`, `Idempotency-Key` required | `amount?` (defaults to full outstanding), `paidAt?` ≤ today, `method?`. Only `origin: ADJUSTMENT`; anything else 404. 201 `{ receivable, payment }`. |
| `GET /v1/receivables/{id}` | session, `payments:read` | Fresh outstanding for the settle drawer. |

422 reasons the UI maps (`details.reason`, `details.field`): `AMOUNT_INVALID`, `DATE_INVALID` (field `occurredOn`/`paidAt`), `CUSTOMER_REQUIRED_FOR_OWED`, `CUSTOMER_NOT_FOUND`, `PROJECT_NOT_FOUND`, `PROJECT_CUSTOMER_MISMATCH`, `RECEIVABLE_NOT_OPEN`, `ALLOCATION_EXCEEDS_OUTSTANDING` (`details.outstanding`), `IDEMPOTENCY_KEY_REUSED`. 409 `CONFLICT {reason: VERSION_MISMATCH}` (settle race). 403 `READ_ONLY_PROFILE` (stale UI). 404 (settle on a gone/non-ADJUSTMENT receivable).

`/v1/me` today: `incomeCaptureRulesFor(null) = {received: true, owed: true, customer: 'optional'}`; `isPersonalDefault = personalOwnerUserId === user.id`.

## 3. Design

### 3.1 One gate, pure (`src/hosted/data/incomeAffordances.ts`, new)

```ts
export interface IncomeAffordances {
  kinds: IncomeKind[];          // [] = no Add button
  customer: 'optional' | 'linked-required';
  canSettle: boolean;           // Record payment column
}
export function incomeAffordancesFor(profile: HostedProfile): IncomeAffordances
export function isSettleable(r: Receivable): boolean   // origin === 'ADJUSTMENT' && status not PAID/VOID
```

`kinds` is empty unless `isPersonalDefault && access.capture === 'read-write'` (POST /v1/income stands on the `capture` row, `capture:write`); then it is the subset of `received`/`owed` that `profile.income` allows. `canSettle` = `isPersonalDefault && access.payments === 'read-write' && income.owed` (settle requires `payments:write`; only Owed creates settleable rows). *Eng review SC1 factual correction: the draft gated Add on `access.payments`.* Every view reads this one function, never `isPersonalDefault` directly. Lives in `data/` beside `filters.ts` (pure; `hooks/` is lint-banned in the portal).

### 3.2 Entry points (drawer-first, URL-mirrored)

- **`+ Add income`** primary button in `PageHeader` on Receivables (default kind Owed) and Payments (default kind Received), and in Client detail's header (client prefilled, default Owed). Same button as the empty-state action, like ExpensesList.
- **`Record payment`** button in its own trailing column of `ReceivablesList`, rendered only when `canSettle`, and only on rows where `isSettleable`. A real `<Button variant="secondary" size="sm">` in its own cell, following the MUT-6/82 `RecordPaymentButton` contract (a compact label; accessible name "Record payment, remaining: {outstanding}"). Design review Pass 5 restates this established contract; no new decision was needed. ADR-055 §6 applies: nothing interactive nested, no row-click. The column is added conditionally in the caller's memoised `columns`. **Sticky at narrow widths (design review 8A):** `HostedTable`'s `Column` gains one optional flag, `stickyEnd?: boolean`, which adds a class: `position: sticky; inset-inline-end: 0; background: var(--surface); border-inline-start: 1px solid var(--border)`. The rules are logical properties, so RTL pins the column to the left. The header cell carries a visually hidden "Actions" label. The read-only tables of other profiles never set the flag and are unchanged.
- **Pages own the drawers (eng review R1/D2).** `ReceivablesPage`, `PaymentsPage` and `ClientDetailPage` parse a separate `IncomeDrawerSearch` beside the list filters and mount both drawers. The lists receive `onRecordPayment?(receivableId)` and a header-action slot, never drawer params, so list filter objects and query keys cannot contain drawer fields.
- URL state, parsed in `data/filters.ts` like `parseExpenseDrawer` (as `parseIncomeDrawer`, merged into each page's route search but handed to the page, not the list):
  - `?newIncome=received|owed` opens the add drawer.
  - `?settle=<receivableId>` opens the record-payment drawer.
  - Both are ignored (no drawer rendered) when the gate says no, so a pasted link on a Malafat profile does nothing.
- **Landmine, removed by structure:** `useReceivables`/`usePayments` key on the whole `filters` object (the e0ed4fd bug). Under R1 drawer fields never enter `filters`; a test still asserts that opening and closing the drawer fires no second list GET. `ClientDetailPage.tsx:67`'s field-by-field `setSearch` mapping is untouched because drawer state never travels through it.
- Router: extend `validateSearch` for receivables, payments and client detail (`parseReceivablesPage`, `parsePaymentsPage`, `parseClientDetail` + drawer fields).

### 3.3 `IncomeCaptureDrawer` (`src/hosted/components/IncomeCaptureDrawer.tsx`, new)

The name avoids confusion with the local app's `components/drawers/IncomeDrawer` (lint-banned from the portal anyway). Built on `Drawer` and react-hook-form + zod, following `ConversionDrawer`'s create-only shape.

**Layout (design review 1A, 2026-10-14):** fast path plus "More details", mirroring the local IncomeDrawer (MUT-5). Up front: Kind → Amount → Client → (Owed only) "What was it for?" (title). Behind a "More details" disclosure: Currency, Date, Due date (Owed) or Method (Received), Matter, Notes. When collapsed, it shows a summary line naming the defaults in use, e.g. "USD · today · due 15 Nov". An error in a hidden field opens the disclosure (the local `DETAIL_FIELDS` rule).

Fields:
- Kind: `components/ui/SegmentedControl` (radiogroup, MUT-139; design review 7A) Received | Owed, labelled "Kind" via `aria-labelledby`, showing only `kinds`. Hidden if only one kind.
- Amount (`inputMode="decimal"`, `dir="ltr"`) + currency (`Select` from `components/ui/Input`, never the ui barrel), defaulting to `profile.defaultCurrency`.
- Date (`occurredOn`), defaulting to and capped at `todayInZone(profile.timezone)`, a new pure helper in `src/hosted/format/dates.ts` (eng review R3/D4). The server's `assertNotFuture` uses the profile's zone, not the browser's. The same value drives the schema's not-in-future check. An invalid zone falls back to `todayLocalISO()`.
- Client (`ClientPicker`): required for Owed, optional for Received when `customer === 'optional'`, required when `linked-required` (not reachable today; the rule is honoured anyway). Prefilled from Client detail.
- Matter (`ProjectPicker`), filtered to the client.
- Owed only: title (optional), due date (optional; hint "If empty: the 15th of next month", which is what the server does. No client-side date math, per MUT-65's note).
- Received only: method Cash | Bank via `SegmentedControl` labelled "Method" (7A; default Cash, the server default).
- Notes (optional).

Body built by one pure `toCreateIncomeRequest(values, kind)` (blank strings dropped, never sent as `""`), unit-tested.

### 3.4 `RecordPaymentDrawer` (`src/hosted/components/RecordPaymentDrawer.tsx`, new)

Opens on `?settle=<id>`, reads `GET /v1/receivables/{id}` (new `useReceivable`) so outstanding and status are fresh, not the list's cached row. **Layout (design review 2A, 2026-10-14):** the title carries what's left, matching the local PartialPaymentDrawer: "Record payment · ₪5,000.00 left", with the amount in `<bdi dir="ltr">` and Plex Mono. Under the title is one muted line, client · matter · due date, which wraps and never truncates (long Arabic names). No fact box. Then:
- Amount, defaulting to the outstanding amount, editable for a partial payment, in the receivable's currency (fixed, shown not chosen).
  - **Live amount line (design review 4A):** a `role="status"` line under Amount, mirroring the local PartialPaymentDrawer. It compares `parseAmountInput(typed, { currency })` with the receivable's outstanding, both in minor units (`src/lib/utils`, already imported by the portal; no `Number()`). Equal → "Paid in full" (`--m-mint-ink`). Less → "{left} still owed" (muted). More → "Exceeds what's left ({outstanding})" (`--m-rose-ink`), and Save is blocked. Text that can't be parsed is flagged only after Save is pressed, so a half-typed "1,2" never nags. Amounts go in `<bdi dir="ltr">`.
- Paid on, defaulting to and capped at `todayInZone(profile.timezone)` (R3).
- **Honest note (design review 6A):** a muted line above the footer buttons reads "Check the amount: a recorded payment can't be changed yet." (en/ar). It's true today: `DELETE /v1/income` refuses an allocated payment (409), and personal profiles refuse API keys, so no surface can reverse a settle. A follow-up MUT ticket covers a correction path (server + phone + portal); file it via `/pm-intake` after this review. Remove the note when that ships.
- **Loading (design review 5A):** the drawer opens on click, titled "Record payment"; the amount joins the title once loaded. The portal `Skeleton` stands in for the context line and Amount, and Save stays disabled until the fresh receivable arrives, so no figure ever jumps. While saving, Save reads "Saving…" and the form is disabled.
- Method Cash | Bank via `SegmentedControl` labelled "Method" (7A).

**Always sends the typed `amount`** (eng review R2/D3). Omitting it would let the server settle whatever is outstanding at write time, so a concurrent phone partial would silently turn a 100 received into a 60 recorded. A race instead returns 422 `ALLOCATION_EXCEEDS_OUTSTANDING`: an inline error on Amount quoting `details.outstanding`, and the receivable is re-read. If the receivable comes back PAID/VOID/non-ADJUSTMENT/404: a "nothing left to pay" empty state in the drawer and no form.

### 3.5 Shared pieces (DRY) — smaller arrangement per eng review D1

- The income drawer keeps its own `INCOME_CURRENCIES = ['USD','ILS','EUR','JOD'] as const satisfies readonly Currency[]` and **one amount helper (re-review R5/D1 = A): lenient in, canonical out.** `parseAmountInput(text, { currency })` from `src/lib/utils` turns the text into minor units. It accepts commas, a matching currency symbol and Arabic-Indic digits; null or ≤ 0 is invalid. A typed currency that differs from the field's is an inline error (`amountInputCurrency`, the local rule). The request carries a canonical decimal built from the minor units with exactly the currency's digits (string ops, no `Number()`). Both drawers' live line, schema check and request body use this one helper, so they can never disagree. ExpenseDrawer's strict regex is not reused. Both stay inside `IncomeCaptureDrawer.tsx`, next to its schema. **`ExpenseDrawer`, `expenseApiErrors` and `conversionApiErrors` are not touched** (D1). The duplicated regex and the four portal currency lists go to TECH_DEBT as one extraction item.
- **`src/hosted/components/incomeApiErrors.ts`** (new) carries its own four-line `reasonOf`/`fieldOf`, a third copy that is logged with the same debt item.
- **`incomeApiErrors.ts`**: `applyIncomeApiError` / `applySettleApiError` in the `applyExpenseApiError` shape: field-owned reasons become inline errors, everything else a toast. `READ_ONLY_PROFILE` reuses the §7.4 sentence from `details.writerOfRecord` (`hosted.readOnly.malafat`/`none`), as §7.4 already specifies. 404 / `RECEIVABLE_NOT_OPEN` / `VERSION_MISMATCH` on settle: toast, invalidate, and the drawer re-reads.
- Validation messages are **i18n keys resolved at render**, not the hard-coded English that the expense and conversion schemas pass through to Arabic users today (logged as debt, not fixed here).

### 3.6 Data hooks (`src/hosted/data/incomeQueries.ts`, new)

`useReceivable(profileId, id)`, `useCreateIncome(profileId)`, `useSettleReceivable(profileId)`. On success, invalidate under `profileKey(profileId, …)`: `receivables`, `payments`, `receivable/<id>`, `summary` (organization + customer). Only mounted queries refetch, so a save costs one to four GETs. No `setQueryData`, no `placeholderData` (queries.ts's rule: nothing in the cache ahead of the server).

**Idempotency key lifetime (new pattern, money-safe):** the existing expense/conversion hooks mint `crypto.randomUUID()` inside `mutationFn`, so a retry after a timeout that actually landed records the income twice. Here the key belongs to the drawer attempt. It is minted when the drawer opens and passed into `mutate`. It is re-minted only when the submitted body differs from the last attempt: a changed body is a new intent, and reusing the key would earn `IDEMPOTENCY_KEY_REUSED`. A NETWORK failure followed by Save with the same values reuses the key, and the server replays the first result instead of writing twice. One small helper, `useAttemptKey()` in its own `data/attemptKey.ts`, is unit-tested and recorded in PATTERNS.md. **Per eng review R4/D5 it is adopted in this PR by `useCreateExpense` and `useCreateConversion` too**, ending the double-write on retry there. `ExpenseDrawer` and `ConversionDrawer` also switch their default date to `todayInZone(profile.timezone)`.

`api/client.ts`: add `receivable`, `createIncome`, `settleReceivable` and export the types `CreateIncomeRequest`, `IncomeResponse`, `IncomeKind`, `PaymentMethod`, `SettleReceivableRequest`, `SettleReceivableResponse`. `schema.d.ts` already has them, so `hosted:types:check` is unaffected.

### 3.7 `ReadOnlyNotice`

The personal branch becomes `if (profile.isPersonalDefault && incomeAffordancesFor(profile).kinds.length > 0) return null;`, which is the rule §7.4 already applies to every other writable profile (read-write → no notice). If a personal profile ever loses write rules, it falls through to the existing personal copy, reworded to drop the claim that "the portal is read-only by design": `hosted.readOnly.personal` → "Income on this profile is recorded from the phone app." The Malafat and none branches are byte-for-byte unchanged, and their existing tests stay as they are.

### 3.7b Interaction states (design review Pass 2, 2026-10-14)

```
FEATURE              | LOADING                         | EMPTY                              | ERROR                                  | SUCCESS                         | PARTIAL
---------------------|---------------------------------|------------------------------------|----------------------------------------|---------------------------------|---------------------------
+ Add income button  | n/a (rendered with the page)    | also the Empty-state action on     | n/a                                    | opens drawer (URL ?newIncome=)  | n/a
                     |                                 | Receivables/Payments (personal)    |                                        |                                 |
Add income drawer    | ClientPicker/ProjectPicker show | no clients yet: client optional    | field reasons inline; network/409/403  | drawer closes, list re-reads,   | n/a
                     | their own loading; Save         | for Received; Owed shows the       | → toast (failure variant); form keeps  | polite "Saved · …" status (3A)  |
                     | "Saving…" + form disabled       | required-client error              | its values; retry reuses the key       |                                 |
Record payment btn   | n/a                             | hidden on PAID/VOID/non-ADJUSTMENT | n/a                                    | opens drawer (URL ?settle=)     | n/a
Record payment drawer| opens at once, title "Record    | receivable PAID/VOID/gone →        | GET fails → QueryView error view;      | drawer closes, row re-reads,    | partial amount → "{left}
                     | payment", Skeleton for context  | "Nothing left to pay on this       | 422 exceeds → inline + re-read;        | "Payment recorded · …" (3A)     | still owed" live (4A); row
                     | line + Amount, Save disabled    | entry" + Close (5A)                | 409 → toast + re-read                  |                                 | reads Partly paid after
                     | (5A); saving: "Saving…"         |                                    |                                        |                                 |
```

### 3.7c Focus after save (design review 9A, 2026-10-14)

This follows ADR-055 §6, the local Home rule. **Mechanism (re-review A1):** focus is decided from the settle response *before* the drawer closes, because `useDrawerFocus` gives focus back to the trigger on unmount unless something else already holds it:
1. Response `receivable.status` not PAID (a partial payment): close normally, and the drawer returns focus to the surviving trigger.
2. PAID: move focus to the next row's Record payment (from the rows currently rendered), then close.
3. PAID with no next row: focus the page `h1` (`tabIndex={-1}`), then close.

After an Add income save, focus returns to the `+ Add income` button that opened the drawer. Tests cover all three settle branches, in LTR and RTL order.

### 3.7d Responsive and accessibility (design review Pass 6, 2026-10-14)

- **Narrow tables:** the sticky end action column (8A, §3.2).
- **Touch (10A):** `@media (pointer: coarse) { .hp-row-action .btn-sm { height: 44px; padding-inline: var(--space-4) } }` in `hosted.css`. Drawer inputs and footer buttons already meet 44px. The app's other `btn-sm` controls stay 32px on touch; a TECH_DEBT note covers an app-wide coarse-pointer pass.
- **Focus:** §3.7c (9A). The drawers keep `DrawerFrame`'s focus trap and Escape-to-close.
- **Screen readers:** the row button's accessible name includes the remaining amount (Pass 5 restatement). The live amount line (4A) and the Saved status (3A) are `role="status"` (polite). Failures keep `role="alert"`. Kind and Method are labelled radiogroups (7A).
- **RTL:** amounts in `<bdi dir="ltr">` and amount inputs `dir="ltr"`; the sticky column uses logical properties; the client · matter · due line wraps.

### 3.7e Copy (design review 11A, 2026-10-14)

| Element | en | ar | Key |
|---|---|---|---|
| Header + empty-state action | + Add income | + إضافة دخل | `hosted.income.add` |
| Add drawer title | New income | دخل جديد | `hosted.income.drawerTitle` |
| Add drawer submit | Save income | حفظ الدخل | `hosted.income.save` |
| Row button + payment submit | Record payment | تسجيل دفعة | `hosted.settle.record` |
| Pending submit | Saving… | جارٍ الحفظ… | existing `common.saving` |

These are the local app's terms in sentence case. The payment drawer title follows 2A: "Record payment · {amount} left".

### 3.8 Save confirmation (design review 3A, 2026-10-14; narrow reopen of D-undo)

When a drawer closes, the new entry is often off screen: a Received added from Receivables lands on Payments, and a new Owed can sit below "Show more". A silent save invites double entry. So every successful save shows **one polite status message** in the existing toast slot. `ToastProvider` gains a success variant: mint tokens (`--m-mint` / `--m-mint-ink`), 6 s, no action button. **Mechanism (re-review A2):** the provider always renders an empty polite live region (`role="status"`, `aria-live="polite"`) and fills it on success, because a status region inserted on demand is often not announced. The API stays backward compatible for its five callers: `show(message, tone: 'error' | 'success' = 'error')`. Copy, with the amount in `<bdi dir="ltr">`:
- "Saved · {amount} received from {client}" (or "Saved · {amount} received" when no client)
- "Saved · {amount} owed by {client}"
- "Payment recorded · {amount} from {client}"

No Undo and no row highlight: both stay with MUT-91 (D-undo otherwise unchanged). The failure variant (`role="alert"`) is unchanged. Files: `components/Toast.tsx` (+ test), `hosted.css`, i18n `hosted.income.saved.*`.

## 4. Files

New (D1 smaller arrangement, + D5): `data/incomeAffordances.ts`, `data/incomeQueries.ts`, `data/attemptKey.ts`, `components/IncomeCaptureDrawer.tsx` (schema + `toCreateIncomeRequest` exported from it), `components/RecordPaymentDrawer.tsx`, `components/incomeApiErrors.ts` (all under `src/hosted/`), plus their tests.
Touched: `components/HostedTable.tsx` + `hosted.css` (8A `stickyEnd`), `format/dates.ts` (R3 `todayInZone`), `data/{expenseQueries,conversionQueries}.ts` + `components/{ExpenseDrawer,ConversionDrawer}.tsx` (D5: attempt key + zone date), `api/client.ts`, `data/filters.ts`, `router.tsx`, `pages/views/{ReceivablesList,PaymentsList,ClientDetailPage}.tsx`, `components/ReadOnlyNotice.tsx`, `i18n/{en,ar}.json` (`hosted.income.*`, `hosted.settle.*`, reworded `hosted.readOnly.personal`).
Docs: `hosted-portal.md` §7.4 rewritten (affordances on a personal profile, the gate, URL params); ADR-037 amendment "MUT-133: the portal writes income on the signed-in user's personal profile only"; PATTERNS (attempt-scoped idempotency key, now used by all three portal create hooks; profile-zone today; pages own drawers; personal-only gate); COMPONENT_REGISTRY (2 drawers, gate, `useAttemptKey`, `todayInZone`); TECH_DEBT (one extraction item per D1: the amount regex, four portal currency lists and `reasonOf`/`fieldOf` copies; FilterControls/conversion currency lists lack JOD — fold into TD-117 if it covers it; hard-coded English zod messages in hosted expense/conversion schemas); TEST_PLAN; CHANGELOG; SYSTEM_OVERVIEW (portal income writes).

## 5. Tests (written first; Vitest + RTL via `src/hosted/__tests__/harness.tsx`)

| File | Proves |
|---|---|
| `data/__tests__/incomeAffordances.test.ts` | personal + MUT-65 rules → kinds [received, owed], canSettle; **Malafat-fed (received: true) → none**; writer-null non-personal → none; personal with `access.payments: 'read'` → none; rules owed:false → [received], canSettle false; `isSettleable` across origin × status |
| `data/__tests__/filters.test.ts` (extend) | `newIncome` accepts received/owed only; `settle` accepts a uuid only; list filters exclude drawer params |
| `data/__tests__/attemptKey.test.ts` | `useAttemptKey`: same key on same-body retry, new key on body change, new key after success |
| `components/__tests__/ExpenseDrawer.test.tsx`, `ConversionDrawer.test.tsx` (extend, D5) | NETWORK then Save with the same values resends the same `Idempotency-Key`; editing after a failure sends a new one; default date = `todayInZone(profile.timezone)`; all existing cases stay green |
| `components/__tests__/incomeFormSchema.test.ts` (tests the schema exported from `IncomeCaptureDrawer.tsx`) | Owed without client invalid; Received without client valid when optional; JOD 3 decimals ok, USD 3 decimals invalid; future date invalid; `toCreateIncomeRequest` drops blanks, drops `dueDate`/`title` for Received and `method` for Owed (a kind switch after filling never leaks the other kind's fields) |
| `components/__tests__/IncomeCaptureDrawer.test.tsx` | POSTs `/v1/income` with `X-Mutaba3a-Profile` + `Idempotency-Key`; kind toggle switches fields; prefilled client; `CUSTOMER_REQUIRED_FOR_OWED`/`DATE_INVALID` inline; NETWORK then Save resends the **same** key; a second click while pending sends no second POST; `?newIncome=owed` on rules without `owed` opens with Received only; Arabic labels render with `dir="ltr"` amount input |
| `components/__tests__/RecordPaymentDrawer.test.tsx` | live line: equal → Paid in full, less → still owed with the right figure, more → exceeds + Save disabled, half-typed text silent until Save (4A); reads the receivable; defaults to outstanding + today; full and partial settles both send the typed `amount`; `ALLOCATION_EXCEEDS_OUTSTANDING` inline with the outstanding figure; 404/PAID → "nothing left to pay"; `VERSION_MISMATCH` → toast + re-read; the receivable GET failing shows the QueryView error state, not a form |
| `format/__tests__/format.test.tsx` (extend) | `todayInZone`: zone ahead of the browser, zone behind, exactly at local midnight, invalid zone → `todayLocalISO` fallback (R3) |
| `components/__tests__/Toast.test.tsx` (new, re-review A2) | the polite live region exists before any message; success fills it; error still renders `role="alert"`; the five existing callers compile and keep error tone by default |
| `components/__tests__/HostedTable` cases (extend existing views tests) | a `stickyEnd` column renders the sticky class on `th` and `td`; tables without it are byte-identical (8A) |
| `components/__tests__/incomeAmount` cases (in incomeFormSchema.test.ts, re-review R5) | "1,200" → 120000 → "1200.00"; "₪1,200" in ILS ok; "$5" in ILS → mismatch error; Arabic-Indic "١٬٢٠٠" ok; JOD "1.250" → "1.250"; USD "1.255" invalid; "0" and "-5" invalid |
| `components/__tests__/incomeApiErrors.test.ts` | every reason → field or toast; `READ_ONLY_PROFILE` uses the §7.4 sentence |
| `pages/__tests__/views.test.tsx` (extend) | focus (A1): a full settle focuses the next row's Record payment and keeps it after the refetch, the last row focuses `h1`, a partial keeps the trigger; a server `DATE_INVALID` on a hidden field opens More details (1A); personal: Add on Receivables/Payments/Client detail; Record payment only on open ADJUSTMENT rows; **after settle the list refetches and the row reads Paid** (ticket AC); after add, the new Owed row appears; opening/closing a drawer issues no extra list GET; **Malafat-fed and writer-null non-personal: no button, no actions column, `?newIncome=`/`?settle=` deep links render no drawer, notice text unchanged** |
| `components/__tests__/ReadOnlyNotice` cases in views.test.tsx | personal + writable → no note; Malafat/none unchanged |

Gate (Node 22 via nvm, TD-054): `npm run lint && npm run typecheck && npm run test:run && npm run build`, plus `npm run hosted:types:check`. No `server/` change, so server CI is not needed.

## 6. Quality bar

- **DRY**: one gate function; one `useAttemptKey` for all three portal create hooks (D5); `Drawer`, `ClientPicker`, `ProjectPicker`, `SegmentedTabs`, `Select`, `DecimalAmount`, `useCursorList`, `profileKey` reused; per D1, the amount regex, currency list and `reasonOf`/`fieldOf` are copied locally rather than extracted, so shipped expense/conversion code stays untouched; the extraction is logged in TECH_DEBT. `ExpenseFormFields` is not reused because it is category-bound.
- **Testable**: gate, URL parsing, request building, error mapping and key lifetime are pure or hook-isolated; the views are driven through the real router + query client with a fetch stub.
- **Scalable/cost**: zero new list endpoints; one `GET /v1/receivables/{id}` per settle-drawer open; 1–4 refetches per save (mounted only); no polling; no extra bundle dependency.
- **Constraints**: drawer-first + URL-mirrored (CLAUDE.md); i18n en/ar with RTL (`dir="ltr"` amount inputs, `<bdi>` numbers); no `Number()`/`parseFloat` (portal lint): amounts stay decimal strings; portal import bans respected; ADR-037/066 gate semantics; Malafat-fed stays read-only.

## 7. Risks / open points for review

1. ~~Removing the personal notice vs. a neutral line.~~ **Resolved by design review 12A (2026-10-14): remove it.**
2. `useAttemptKey` is new; if review prefers the existing per-call key, the double-record-on-retry risk returns. Recommend keeping it.
3. A personal profile can't bind Malafat (409 `PERSONAL_PROFILE`), so non-ADJUSTMENT rows shouldn't appear there; `isSettleable` still checks origin so a 404 is never offered.
4. The Owed due date is not computed client-side; the hint text states the server's EOM_15 default.

Business / product impact
- A freelancer on their personal profile can finally log "client owes me" and "client paid" from the desktop portal instead of only from the phone. The portal stops being a viewer for its core user.
- Closes the gap MUT-93 deliberately deferred. Sits beside MUT-63 (phone capture), and the hosted + mobile paid tier (MUT-172) becomes believable: the portal is where you view and fix, the phone is where you log.
- Low risk: no server or contract change, gated to one profile kind, and Malafat-fed books are provably untouched by test.

---

# Eng review (plan-eng-review, 2026-10-14) — target: `.claude/designs/mut-133-portal-personal-income.md`

## Scope record

feature answers: no feature cuts proposed; structure: A "Smaller arrangement" (D1, user answer 2026-10-14); accepted scope: the plan's full feature list (Add income + Record payment, D-scope / D-undo / D-gate unchanged) built as 5 new modules under `src/hosted` (`data/incomeAffordances.ts`, `data/incomeQueries.ts`, `components/IncomeCaptureDrawer.tsx`, `components/RecordPaymentDrawer.tsx`, `components/incomeApiErrors.ts`) plus tests; ExpenseDrawer / expenseApiErrors / conversionApiErrors untouched; duplication logged in TECH_DEBT; pending remedies: R1, R2, R3.

*Scope record amended after D5 (C, 2026-10-14):* D1 reopened narrowly. `src/hosted/data/{expenseQueries,conversionQueries}.ts` and `src/hosted/components/{ExpenseDrawer,ConversionDrawer}.tsx` now adopt `useAttemptKey` and `todayInZone`. The no-extraction choice for the regex, currency lists and `reasonOf`/`fieldOf` is unchanged. New module `data/attemptKey.ts`.

Scope Challenge result: scope accepted as-is (smaller arrangement preserves scope).

## Scope Challenge findings

- **SC1** [P3] (confidence: 9/10) `server/src/auth/writability.ts:52` — `{ domain: 'capture', scopes: ['capture:write'], routes: '/v1/income*', ... session: 'read-write' }` and `server/src/routes/income.ts:41` `requireScope('capture:write')`: POST /v1/income stands on `access.capture`, not `access.payments`. Factual correction applied to §3.1 (Add gated on `access.capture`, settle on `access.payments`). Changes no behaviour on any profile that exists today (both are read-write on a personal profile); no question needed.
- **SC2** (prior learning applied: MUT-44 query-key regression, e0ed4fd, confidence 10/10) — already named in §3.2; superseded structurally if R1 is accepted.
- TODOS cross-reference: TODOS #4 (silent refetch failure after a successful write) is app-local (`src/main.tsx`); the portal renders query errors through `QueryView`, so it does not block this plan. Nothing in TODOS blocks MUT-133.

## Decision ledger

### R1: Who owns drawer state — pages, or the list filter objects
Finding: 1, [P2], confidence 9/10, `src/hosted/pages/views/ClientDetailPage.tsx:67` + `src/hosted/data/queries.ts:93`, reviewer: Claude (plan-eng-review)
Plan baseline: §3.2 as drafted: `?newIncome=` / `?settle=` parsed into each page's search object; "each page splits search into list filters and drawer state" by discipline. Not yet approved.
Runtime evidence: `ClientDetailPage.tsx:67` is `setFilters={(f) => setSearch({ tab, projectId: f.projectId, currency: f.currency, status: f.status, dueFrom: f.dueFrom, dueTo: f.dueTo })}`, which rebuilds the search from named fields, so a `settle` value set through `ReceivablesList`'s `setFilters` is dropped on Client detail and the drawer never opens there. `queries.ts:93` `useCursorList<Receivable>(profileKey(profileId, 'receivables', filters), …)` keys on the whole filters object, so any drawer field that rides in `filters` refetches the list (the e0ed4fd bug).
Comparison grid:
| Choice | Current | A) Pages own drawers | B) Keep plan |
|---|---|---|---|
| R1 drawer state location | in page search, split by discipline (draft) | page-level `IncomeDrawerSearch` parsed beside, never inside, list filters; lists take `onRecordPayment?(id)` and an optional header action; ReceivablesPage / PaymentsPage / ClientDetailPage mount the drawers | drawer params inside list filter objects; stripped before the query key; threaded through ClientDetail's `setFilters` mapping |
| D1 structure | approved: smaller arrangement | unchanged | unchanged |
| R2 settle amount | pending | pending | pending |
| R3 today's date source | pending | pending | pending |
Question D2:
D2 — Should the pages own the two drawers, with the lists only calling back, instead of drawer params riding inside list filters?
Project/branch/task: main, planning MUT-133 (portal add income + record payment on a personal profile).
ELI10: The plan puts "which drawer is open" in the same object as the list's filters. Two things break. On a client's page, the code that rebuilds that object drops anything it doesn't know by name (ClientDetailPage.tsx:67), so "Record payment" would do nothing there. And the list's cache key is the whole filter object (queries.ts:93), so opening a drawer reloads the list underneath, the exact bug MUT-44 shipped and had to fix. If pages own the drawers and the lists just say "record payment for row X", neither can happen.
Stakes if we pick wrong: Record payment silently does nothing on Client detail, and every drawer open flashes a list reload; both are fixable only by remembering a rule.
Recommendation: A because it removes both failure modes structurally instead of relying on a convention that already failed once (e0ed4fd).
Completeness: A=10/10, B=7/10
Pros / cons:
A) Pages own drawers (recommended)
  ✅ Lists never see drawer params, so the query key cannot pick them up and the MUT-44 refetch bug cannot recur
  ✅ Client detail opens the same drawer by construction; no field-by-field mapping to keep in sync
  ❌ Three pages each mount two drawers and parse one extra search object, roughly 30 more lines than B
B) Keep plan
  ✅ Fewer props: the list keeps doing everything itself, matching how ExpensesList mounts its drawer today
  ❌ Correctness depends on stripping drawer fields in each page and on ClientDetail's mapping forwarding them, the same convention that broke in MUT-44
Net: about 30 lines of page wiring buys two bugs that cannot happen, versus a rule every future edit must remember.
Header: Drawer owner
Options:
A) Pages own drawers (recommended)
Lists take onRecordPayment(id) and a header-action slot; ReceivablesPage, PaymentsPage and ClientDetailPage parse a separate IncomeDrawerSearch (newIncome / settle), mount IncomeCaptureDrawer and RecordPaymentDrawer, and pass the callbacks. List filter objects and query keys never contain drawer fields. Tests: no extra list GET on open/close; Record payment works from Client detail's Receivables tab. human ~3h / CC ~10min more than B; low risk; one wiring pattern to maintain.
B) Keep plan
Drawer params live inside each list's filters, are stripped before the query key, and ClientDetailPage's setFilters mapping is extended to forward newIncome and settle. Same tests as A. human/CC effort as planned; medium risk (a convention that already failed in MUT-44); every future search field must remember both rules.

State: approved
Actual answer: A) Pages own drawers (D2, user answer 2026-10-14)
Accepted scope: Lists take `onRecordPayment?(receivableId)` and a header-action slot; ReceivablesPage, PaymentsPage and ClientDetailPage parse a separate `IncomeDrawerSearch` (`newIncome` / `settle`), mount IncomeCaptureDrawer and RecordPaymentDrawer, and pass the callbacks. List filter objects and query keys never contain drawer fields. Tests: no extra list GET on drawer open/close; Record payment works from Client detail's Receivables tab.
History: none

### R2: What the settle drawer sends when the amount equals the outstanding it showed
Finding: 2, [P1], confidence 9/10, `server/src/routes/receivables.ts` settle handler vs plan §3.4, reviewer: Claude (plan-eng-review)
Plan baseline: §3.4 as drafted: "Sends `amount` only when it differs from outstanding, so a full settle survives a concurrent partial." Not yet approved.
Runtime evidence: the settle handler reads `const amountMinor = body.amount ? parseAmount(body.amount, currency) : outstanding;` then `if (amountMinor > outstanding) throw validationError('ALLOCATION_EXCEEDS_OUTSTANDING', …, { outstanding })`. Omitting `amount` records whatever is outstanding *at write time*. If the drawer showed 100 and a phone partial of 40 lands meanwhile, omission records a 60 payment when the person was handed 100: wrong money, silently. Sending 100 is refused with 422, and the person sees the new figure.
Comparison grid:
| Choice | Current | A) Always send amount | B) Keep plan |
|---|---|---|---|
| R2 settle request amount | omitted when typed == shown outstanding (draft) | always sent (the typed amount); 422 ALLOCATION_EXCEEDS_OUTSTANDING → inline error with `details.outstanding`, receivable re-read | omitted when equal; server settles whatever is outstanding then |
| D1 structure | approved: smaller arrangement | unchanged | unchanged |
| R1 drawer owner | approved: pages own drawers (D2) | unchanged | unchanged |
| R3 today's date source | pending | pending | pending |
Question D3:
D3 — Should Record payment always send the amount the person typed, instead of leaving it out when it matches the outstanding figure?
Project/branch/task: main, planning MUT-133 (portal add income + record payment on a personal profile).
ELI10: My draft said: if the amount equals what's owed, leave it out and let the server fill in "everything outstanding". But the server fills that in at the moment it writes. If the phone logged a 40 partial while the drawer was open, the portal would record 60 when the client actually handed over 100, and nobody would be told. Always sending the typed 100 makes the server refuse ("more than what's owed now: 60"), and the person decides.
Stakes if we pick wrong: a payment recorded for a different amount than was received, with no error, which is the worst kind of bug in a money ledger.
Recommendation: A because a refused save the person can see beats a wrong figure nobody notices.
Completeness: A=10/10, B=3/10
Pros / cons:
A) Always send amount (recommended)
  ✅ The ledger only ever records the figure the person typed; a race becomes a visible, correctable refusal
  ✅ Simpler code: no decimal comparison between typed text and the server's outstanding string
  ❌ In the rare race the person gets an inline error and must confirm the new amount, one extra click
B) Keep plan
  ✅ A full settle always succeeds on the first click even if a partial landed meanwhile
  ❌ Silently records a different amount than the person received whenever a concurrent partial lands
Net: one extra click in a rare race, versus silently wrong money.
Header: Settle amount
Options:
A) Always send amount (recommended)
The settle request always carries the typed amount (default prefilled with the outstanding figure read on open). 422 ALLOCATION_EXCEEDS_OUTSTANDING shows an inline error on Amount quoting details.outstanding and re-reads the receivable. Test: a full-settle submit sends amount; the 422 path shows the new outstanding. human ~15min / CC ~2min; removes a comparison helper; low risk.
B) Keep plan
Omit amount when the typed value equals the outstanding read on open, so the server settles whatever is outstanding at write time. Needs a decimal comparison of typed text vs the server string. Test: equal amount omits the field. Same effort; risk of silently recording a different amount after a concurrent partial.

State: approved
Actual answer: A) Always send amount (D3, user answer 2026-10-14)
Accepted scope: The settle request always carries the typed amount (prefilled with the outstanding figure read on open). 422 ALLOCATION_EXCEEDS_OUTSTANDING shows an inline error on Amount quoting details.outstanding and re-reads the receivable. Tests: a full-settle submit sends amount; the 422 path shows the new outstanding. No typed-vs-outstanding comparison helper.
History: none

### R3: Which calendar "today" the drawers use for the default date and the not-in-the-future limit
Finding: 3, [P2], confidence 9/10, `src/hosted/format/dates.ts:21` vs `server/src/agreements/compose.ts:141`, reviewer: Claude (plan-eng-review)
Plan baseline: §3.3 as drafted: "Date (`occurredOn`, `max=today` in the profile's timezone via the existing `format/dates` helpers)". That claim is wrong: no such helper exists. Not yet approved.
Runtime evidence: the portal's only helper is `export function todayLocalISO(now: Date = new Date())`, built from `now.getFullYear()/getMonth()/getDate()`, the **browser's** calendar. The server checks `assertNotFuture(occurredOn, today)` with `today = todayFor(organization, now)` → `todayIn(organization.timezone, now)`, the **profile's** calendar; a miss is 422 `DATE_INVALID`. `HostedProfile.timezone` is on the wire. A person whose browser is ahead of the profile's zone (travelling east, or a Jerusalem profile used from Dubai after midnight) gets a default date the server refuses. A browser behind the zone has a `max` that blocks a date the server would accept.
Comparison grid:
| Choice | Current | A) Profile's zone | B) Browser calendar |
|---|---|---|---|
| R3 "today" source | browser-local `todayLocalISO()` (only helper that exists) | new `todayInZone(timeZone, now)` in `src/hosted/format/dates.ts` (`Intl.DateTimeFormat('en-CA', { timeZone })`), fed `profile.timezone`, used for both drawers' default date, `max`, and the schema's future check | keep `todayLocalISO()` like ExpenseDrawer; server 422 `DATE_INVALID` mapped to an inline error |
| D1 structure | approved: smaller arrangement | unchanged | unchanged |
| R1 drawer owner | approved: pages own drawers (D2) | unchanged | unchanged |
| R2 settle amount | approved: always send (D3) | unchanged | unchanged |
Question D4:
D4 — Should the drawers compute "today" in the profile's timezone, the same calendar the server checks against?
Project/branch/task: main, planning MUT-133 (portal add income + record payment on a personal profile).
ELI10: The server refuses income dated "in the future", and it decides what today is by the profile's timezone (e.g. Asia/Jerusalem). The portal only knows the browser's date. When those differ around midnight or while travelling, the drawer prefills a date the server rejects, or its date picker blocks a date the server would accept. A ten-line helper that asks the browser "what's the date in Asia/Jerusalem right now?" makes both sides agree.
Stakes if we pick wrong: near midnight or abroad, saving a payment fails with a confusing "date can't be in the future" on a date the person never changed.
Recommendation: A because the client must use the same rule as the server it is predicting, and the helper is tiny and pure.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Profile's zone (recommended)
  ✅ The default date, the date picker's max and the server's check all use one calendar, so a default never gets refused
  ✅ Pure helper with an injectable `now`, unit-tested across zones and midnight boundaries without touching the UI
  ❌ ExpenseDrawer and ConversionDrawer keep the browser-local default (D1 leaves them untouched), so portal drawers briefly differ; logged as debt
B) Browser calendar
  ✅ Matches the two existing portal drawers exactly, no new helper
  ❌ Around midnight or abroad the prefilled date is refused by the server, and the person sees an error on a field they never touched
Net: ten lines of pure helper versus an intermittent, confusing refusal on the money path.
Header: Today source
Options:
A) Profile's zone (recommended)
Add todayInZone(timeZone, now) to src/hosted/format/dates.ts (Intl.DateTimeFormat 'en-CA' with timeZone), fed profile.timezone; both new drawers use it for the default date, the input max, and the schema's not-in-future check. Unit tests: zone ahead of / behind the browser, the midnight boundary, an invalid zone falling back to todayLocalISO. Expense/conversion drawers stay browser-local, logged in TECH_DEBT. human ~1h / CC ~5min; low risk.
B) Browser calendar
Both new drawers use the existing todayLocalISO() for default and max, like ExpenseDrawer; a server 422 DATE_INVALID becomes an inline error on the date field. No new helper. human/CC effort nil; intermittent refusals near midnight or across zones.

State: approved
Actual answer: A) Profile's zone (D4, user answer 2026-10-14)
Accepted scope: Add `todayInZone(timeZone, now)` to `src/hosted/format/dates.ts` (Intl.DateTimeFormat 'en-CA' with timeZone), fed `profile.timezone`; both new drawers use it for the default date, the input max, and the schema's not-in-future check. Unit tests: zone ahead of / behind the browser, the midnight boundary, an invalid zone falling back to `todayLocalISO`. Expense/conversion drawers stay browser-local, logged in TECH_DEBT.
History: none

### R4: TODO — make the existing Expense and Conversion drawers retry-safe and profile-zone-dated
Finding: 4, [P2], confidence 8/10, `src/hosted/data/expenseQueries.ts` `useCreateExpense` (`mutationFn: (body) => api.createExpense(profileId, body, crypto.randomUUID())`) and `src/hosted/data/conversionQueries.ts` `useCreateConversion` (same), reviewer: Claude (plan-eng-review)
Plan baseline: §3.6 says "Back-porting it to expenses/conversions goes to TECH_DEBT, not this ticket"; D1 keeps those files untouched. Destination (TECH_DEBT only vs TODOS.md vs this PR) not approved.
Runtime evidence: both hooks mint a fresh Idempotency-Key inside `mutationFn`, so Save → timeout (write landed) → Save again records the expense or conversion twice. Both drawers default dates with browser-local `todayLocalISO()` (R3's skew), and expenses have no server future-date check, so only the double-write is money-affecting.
Comparison grid:
| Choice | Current | A) Add to TODOS.md | B) TECH_DEBT only | C) Build now |
|---|---|---|---|---|
| R4 where the back-port lives | plan: TECH_DEBT entry | TECH_DEBT entry + TODOS.md item #13 with What/Why/Context | TECH_DEBT entry only | change both hooks and drawers in this PR (reopens D1) |
| D1 structure | approved: smaller arrangement | unchanged | unchanged | reopened: touches expense/conversion files |
| R1 / R2 / R3 | approved | unchanged | unchanged | unchanged |
Question D5:
D5 — Where should "make the expense and conversion drawers retry-safe" live: TODOS.md, TECH_DEBT only, or this PR?
Project/branch/task: main, planning MUT-133 (portal add income + record payment on a personal profile).
ELI10: The new income drawers keep one save key per attempt, so a retry after a dropped connection can't record twice. The expense and conversion drawers that already shipped make a new key on every click, so a flaky network can create a duplicate expense. D1 said don't touch those files in this ticket. The question is only where the follow-up gets written down.
Stakes if we pick wrong: a known double-write on the expense path either sits unnoticed in a debt file or bloats this ticket's diff.
Recommendation: A because TODOS.md is what the next planning session reads, and it keeps D1's clean diff.
Note: options differ in kind, not coverage. No completeness score.
Pros / cons:
A) Add to TODOS.md (recommended)
  ✅ Shows up where follow-ups are picked from, with the exact files, the failure and the helper to reuse
  ✅ Keeps this PR free of edits to shipped expense/conversion code, as D1 chose
  ❌ The double-write risk on expenses stays live until someone picks up the item
B) TECH_DEBT only
  ✅ Keeps one ledger for debt; no new TODOS.md entry to maintain
  ❌ TECH_DEBT is long (TD-001..119) and is not the list follow-ups are picked from, so this one is easy to lose
C) Build now
  ✅ Closes the expense double-write in the same PR, reusing useAttemptKey and todayInZone the moment they exist
  ❌ Reopens D1: touches MUT-44/161 files and their tests, which widens review and regression surface
Net: the same fix either way; the choice is visibility versus diff size.
Header: Retry TODO
Options:
A) Add to TODOS.md (recommended)
Write TODOS.md #13 (What/Why/Pros/Cons/Context/Depends on: MUT-133 landing useAttemptKey + todayInZone) and keep the TECH_DEBT entry the plan already lists. No code change to expense/conversion here. human ~10min / CC ~2min.
B) TECH_DEBT only
Keep only the TECH_DEBT entry the plan lists; no TODOS.md item. human/CC nil.
C) Build now
In this PR, switch useCreateExpense/useCreateConversion to useAttemptKey and both drawers to todayInZone, with retry tests; reopens D1. human ~2h / CC ~15min; touches shipped code.

State: approved
Actual answer: C) Build now (D5, user answer 2026-10-14)
Accepted scope: In this PR, switch `useCreateExpense` / `useCreateConversion` to the attempt-scoped key and both drawers' default date to `todayInZone(profile.timezone)`, with retry tests. Reopens D1 narrowly: `expenseQueries.ts`, `conversionQueries.ts`, `ExpenseDrawer.tsx`, `ConversionDrawer.tsx` (and their tests) are now touched. D1's no-extraction choice for the regex/currency lists/`reasonOf` still stands. Necessary consequence: `useAttemptKey` has three callers, so it lives in `src/hosted/data/attemptKey.ts`, not `incomeQueries.ts`.
History: none

Approval readiness: PASS — D1 (structure, answer A "Smaller arrangement"), R1/D2 (A), R2/D3 (A), R3/D4 (A), R4/D5 (C, which narrowly reopens D1 and is recorded in the scope record). The regression contract (Malafat-fed + non-personal untouched) is carried forward from ticket AC4 / D-gate (2026-10-14). The four test additions in Section 3 are required proof of planned behaviour.

## Review body

### Section dispositions
- Architecture: R1 [P2] accepted (D2 A).
- Code quality: R2 [P1] accepted (D3 A); R3 [P2] accepted (D4 A).
- Tests: 4 gaps closed as required proof (double-click Save, kind-switch field isolation, owed deep link without owed rights, receivable-load error); D5 adds expense/conversion retry tests. Coverage diagram in chat; QA artifact at `~/.gstack/projects/vAWK3-mutaba3a/basel-main-eng-review-test-plan-20261014-014236.md`.
- Performance: no issues (1 GET per settle-drawer open; 1–4 mounted refetches per save over ≤50-row pages).
- TODO: R4 built now (D5 C).

### NOT in scope
- Delete/edit of existing income rows (D-scope: owner chose Add + Record only).
- Undo after save (D-undo: MUT-91 owns portal after-save feedback; settle cannot be undone by the API anyway).
- Overview page affordances and Documents (the ticket lists read views; Overview has no row list to act on).
- Extracting the amount regex, the currency lists and `reasonOf`/`fieldOf` (D1; one TECH_DEBT item).
- JOD in the portal filter bar / conversion drawer (pre-existing, TD-117 territory).
- Any `server/` change (contract verified sufficient in §2).

### What already exists (reused, not rebuilt)
- Server: `POST /v1/income`, `POST /v1/receivables/{id}/settle`, `GET /v1/receivables/{id}`, `incomeCaptureRulesFor`, `sessionAccessFor` (MUT-65/61) — used as is.
- Portal: `Drawer` (DrawerFrame), `ClientPicker`, `ProjectPicker`, `SegmentedTabs`, `Select` (ui/Input), `DecimalAmount`, `HostedTable` (column added by caller, no change), `useCursorList`, `profileKey`, `QueryView`, `useToast`, `PageHeader` action slot, `parseExpenseDrawer` pattern, `applyExpenseApiError` shape.
- Rebuilt locally per D1 (3–4 lines each): currency-aware amount regex, currency list, `reasonOf`/`fieldOf`.

### Diagram — write paths
```
 Receivables/Payments/ClientDetail page  (owns IncomeDrawerSearch: newIncome | settle)
        │ incomeAffordancesFor(profile) ──► kinds=[]? ──► no button, no column, drawers never mount
        │                                └─► kinds/canSettle ──► "+ Add income" / row "Record payment"
        ▼                                                         │ onRecordPayment(id)
 IncomeCaptureDrawer ──toCreateIncomeRequest──► useCreateIncome(attemptKey) ──POST /v1/income
 RecordPaymentDrawer ──useReceivable(GET)──► form(amount typed, paidAt≤todayInZone)
                     ──useSettleReceivable(attemptKey)──► POST /v1/receivables/{id}/settle
        │ 201 → invalidate p/<id>/{receivables,payments,receivable/<id>,summary} → mounted lists re-read
        │ 4xx → incomeApiErrors: field reason → inline | READ_ONLY_PROFILE → §7.4 sentence | else toast
        │ NETWORK → same attemptKey on unchanged retry → server replays, never double-writes
```

### Failure modes
| Path | Realistic failure | Handling / test | User sees |
|---|---|---|---|
| Add income | timeout after the write landed, user retries | attempt key reuse (attemptKey.test, drawer test) | one entry, no duplicate |
| Add income | browser date ahead of profile zone | `todayInZone` default + max (format test) | a date the server accepts |
| Add Owed | no client | client-side required + 422 `CUSTOMER_REQUIRED_FOR_OWED` inline | inline error on Client |
| Settle | phone partial lands meanwhile | always-send amount → 422 `ALLOCATION_EXCEEDS_OUTSTANDING` inline + re-read | "more than owed now: X" |
| Settle | receivable paid/voided/gone | GET → "nothing left to pay"; settle 404 → toast + invalidate | clear empty state |
| Settle | concurrent settle race | 409 `VERSION_MISMATCH` → toast + re-read | refreshed figure |
| Any write | profile flipped to Malafat (stale UI) | 403 `READ_ONLY_PROFILE` → §7.4 sentence toast | why it can't be changed |
| Post-save refetch | refetch fails | `QueryView` error state on the list | visible error, not stale silence |
Critical gaps (no test + no handling + silent): **0**.

### Worktree parallelization strategy
| Step | Modules touched | Depends on |
|---|---|---|
| S1 helpers | src/hosted/format, src/hosted/data (attemptKey, incomeAffordances, filters) | — |
| S2 API + hooks | src/hosted/api, src/hosted/data (incomeQueries) | S1 |
| S3 drawers + error map | src/hosted/components | S1, S2 |
| S4 pages + router + notice + i18n | src/hosted/pages, src/hosted/router.tsx, src/hosted/components/ReadOnlyNotice, src/hosted/i18n | S3 |
| S5 expense/conversion adoption (D5) | src/hosted/data (expense/conversion queries), src/hosted/components (Expense/Conversion drawers) | S1 |
| S6 knowledge + docs | .claude/*, hosted-portal.md | S4, S5 |
Lane A: S1 → S2 → S3 → S4 (shared src/hosted/data and components). Lane B: S5 after S1 (touches different files in the same directories). Execution: S1, then A and B together, merge, then S6. Conflict flag: both lanes edit under `src/hosted/data` and `src/hosted/components`, on disjoint files. Per the one-worktree-per-repo rule, run them sequentially in one worktree unless Basel says otherwise.

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~1h / CC: ~5min)** — format/dates — Add `todayInZone(timeZone, now)` with invalid-zone fallback
  - Surfaced by: Code quality — R3 (`src/hosted/format/dates.ts:21` is browser-only)
  - Files: src/hosted/format/dates.ts, src/hosted/format/__tests__/format.test.tsx
  - Verify: `npx vitest run src/hosted/format`
- [ ] **T2 (P1, human: ~1h / CC: ~5min)** — data/attemptKey — `useAttemptKey` (reuse on unchanged body, re-mint on change/success)
  - Surfaced by: Plan §3.6 + R4/D5
  - Files: src/hosted/data/attemptKey.ts, src/hosted/data/__tests__/attemptKey.test.ts
  - Verify: `npx vitest run src/hosted/data`
- [ ] **T3 (P1, human: ~1h / CC: ~5min)** — data/incomeAffordances — gate on `access.capture` (Add) / `access.payments` (settle) + `isSettleable`
  - Surfaced by: Scope Challenge — SC1
  - Files: src/hosted/data/incomeAffordances.ts + test
  - Verify: Malafat-fed `received:true` case returns no kinds
- [ ] **T4 (P1, human: ~3h / CC: ~15min)** — RecordPaymentDrawer — always send typed amount; map ALLOCATION_EXCEEDS_OUTSTANDING inline + re-read
  - Surfaced by: Code quality — R2
  - Files: src/hosted/components/RecordPaymentDrawer.tsx, incomeApiErrors.ts, tests
  - Verify: `npx vitest run src/hosted/components`
- [ ] **T5 (P1, human: ~3h / CC: ~15min)** — pages — pages own both drawers via `IncomeDrawerSearch`; lists take `onRecordPayment` + header slot
  - Surfaced by: Architecture — R1 (`ClientDetailPage.tsx:67`, `queries.ts:93`)
  - Files: src/hosted/pages/views/{ReceivablesList,PaymentsList,ClientDetailPage}.tsx, src/hosted/data/filters.ts, src/hosted/router.tsx, views.test.tsx
  - Verify: no extra list GET on drawer toggle; Record payment from Client detail tab
- [ ] **T6 (P2, human: ~2h / CC: ~15min)** — Expense/Conversion — adopt `useAttemptKey` + `todayInZone` default
  - Surfaced by: TODO — R4/D5
  - Files: src/hosted/data/{expenseQueries,conversionQueries}.ts, src/hosted/components/{ExpenseDrawer,ConversionDrawer}.tsx + tests
  - Verify: retry with same values sends the same Idempotency-Key; existing suites green
- [ ] **T7 (P2, human: ~1h / CC: ~5min)** — tests — the four Section 3 additions
  - Surfaced by: Test review — double-click, kind switch, owed deep link, receivable-load error
  - Files: IncomeCaptureDrawer.test.tsx, RecordPaymentDrawer.test.tsx, incomeFormSchema.test.ts
  - Verify: `nvm use 22 && npm run test:run`

### Unresolved decisions
None.

### Completion summary
- Step 0: Scope Challenge — scope accepted as-is (smaller arrangement, D1; narrowly reopened by D5)
- Architecture Review: 1 issue found
- Code Quality Review: 2 issues found
- Test Review: diagram produced, 4 gaps identified
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 1 item proposed to user (built now, D5 C)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (CLI not installed; native fallback needs TaskOutput, absent in this session)
- Parallelization: 2 lanes, 1 parallel / 1 sequential (recommended sequential in one worktree)
- Lake Score: 3/3

### Suppressed findings (appendix)
- (confidence 4/10) A personal profile's receivables list could contain non-ADJUSTMENT rows if an integration was ever bound. MUT-120 refuses binding with 409 `PERSONAL_PROFILE`, so this looks unreachable. `isSettleable` checks origin anyway.
- (confidence 4/10) Default kind per page (Owed on Receivables, Received on Payments) may surprise someone who adds Received from Receivables and sees no new row there. This is a UX taste call for /plan-design-review.
  - *Design review note:* settled by 3A. The polite "Saved" status names where the entry went, so a Received added from Receivables is never a silent save.

---

# Design review (plan-design-review, 2026-10-14) — target: `.claude/designs/mut-133-portal-personal-income.md`

Visual reference (HTML wireframe with real Brand v2 tokens, light/dark/RTL): `.claude/designs/mut-133-portal-income-wireframe.html`, updated to the reviewed plan.

## Design decisions (each individually approved, 2026-10-14)
| # | Decision | Answer | Plan section |
|---|---|---|---|
| 1 | Add income field order | 1A fast path (Kind, Amount, Client, What for) + More details with defaults summary | §3.3 |
| 2 | Record payment hierarchy | 2A title "Record payment · {amount} left", muted context line, no fact box | §3.4 |
| 3 | Save confirmation | 3A polite "Saved · …" status (toast success variant, role=status, no Undo) | §3.8 |
| 4 | Live amount feedback | 4A "Paid in full / {left} still owed / Exceeds what's left" line | §3.4 |
| 5 | Settle drawer loading | 5A opens at once, Skeleton, Save disabled | §3.4, §3.7b |
| 6 | Mistake recovery | 6A honest footer note + follow-up MUT ticket for a correction path | §3.4 |
| 7 | Choice controls | 7A `SegmentedControl` radiogroup for Kind and Method | §3.3, §3.4 |
| 8 | Narrow tables | 8A sticky end action column (`HostedTable` `stickyEnd`) | §3.2 |
| 9 | Focus after save | 9A ADR-055 §6 rule | §3.7c |
| 10 | Touch targets | 10A 44px row action on coarse pointers | §3.7d |
| 11 | Copy | 11A New income / Save income / Record payment | §3.7e |
| 12 | Personal notice | 12A remove (resolves §7 risk 1) | §3.7, §7 |
Restated without a new decision: the row button is `variant="secondary" size="sm"` with the remaining amount in its accessible name (MUT-6/82 `RecordPaymentButton` contract).

## NOT in scope (design)
- Undo and new-row highlighting after save: MUT-91 (D-undo; 3A adds only a polite status).
- A correction/reversal path for recorded payments: follow-up ticket (6A); server work.
- Tailored empty-state body copy for personal profiles: the existing copy plus the + Add income action is sufficient.
- App-wide coarse-pointer sizing for every `btn-sm`: TECH_DEBT note (10A scoped to the portal row action).
- Reusing the local `RecordPaymentButton` component itself: it is typed to local `TransactionDisplay` and local i18n; the portal matches its contract instead.

## What already exists (design)
Brand v2 tokens (`--m-*`, ADR-058); `DrawerFrame` via portal `Drawer`; `SegmentedControl` (MUT-139); `Button` variants/sizes; portal `Skeleton`/`QueryView`/`Empty`; `ToastProvider` (extended, not replaced); the local IncomeDrawer fast path (MUT-5) and PartialPaymentDrawer live line and title (wording copied); ADR-055 §6 focus rule; `RecordPaymentButton` contract (MUT-6/82).

## Implementation Tasks (design review)
Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **DT1 (P1, human: ~2h / CC: ~10min)** — IncomeCaptureDrawer — fast path + More details with summary line and error auto-open
  - Surfaced by: Pass 1 — decision 1A
  - Files: src/hosted/components/IncomeCaptureDrawer.tsx + test
  - Verify: hidden-field error opens the disclosure; summary names the defaults
- [ ] **DT2 (P1, human: ~2h / CC: ~10min)** — RecordPaymentDrawer — title with what's left, context line, live amount line, honest note, skeleton
  - Surfaced by: Pass 1/2/3 — 2A, 4A, 5A, 6A
  - Files: src/hosted/components/RecordPaymentDrawer.tsx + test, i18n
  - Verify: `npx vitest run src/hosted/components`
- [ ] **DT3 (P1, human: ~1h / CC: ~5min)** — Toast — success variant (role=status, mint), saved copy
  - Surfaced by: Pass 2 — 3A
  - Files: src/hosted/components/Toast.tsx + test, hosted.css, i18n
  - Verify: success uses role=status; failure keeps role=alert
- [ ] **DT4 (P2, human: ~1h / CC: ~5min)** — HostedTable — `stickyEnd` column flag + coarse-pointer 44px row action
  - Surfaced by: Pass 6 — 8A, 10A
  - Files: src/hosted/components/HostedTable.tsx, hosted.css
  - Verify: wireframe behaviour at 375px LTR/RTL; other tables unchanged
- [ ] **DT5 (P2, human: ~1h / CC: ~10min)** — pages — ADR-055 §6 focus resolution after settle; Add income returns focus to its button
  - Surfaced by: Pass 6 — 9A
  - Files: src/hosted/pages/views/{ReceivablesList,ClientDetailPage}.tsx, views.test.tsx
  - Verify: three settle focus branches tested
- [ ] **DT6 (P2, human: ~30min / CC: ~3min)** — drawers — SegmentedControl for Kind/Method; copy keys per 11A
  - Surfaced by: Pass 5/7 — 7A, 11A
  - Files: both drawers, src/hosted/i18n/{en,ar}.json
  - Verify: radiogroup roles in tests; Arabic strings present
- [ ] **DT7 (P3, human: ~15min / CC: ~3min)** — follow-up — file the payment-correction ticket via /pm-intake
  - Surfaced by: Pass 3 — 6A
  - Files: none (Jira)
  - Verify: MUT ticket exists and is linked to MUT-133

### Design Completion Summary
```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | no DESIGN.md; Brand v2 kit used; UI scope: 2 drawers, 3 pages, notice |
  | Step 0               | 5/10, all 7 dimensions, HTML wireframe      |
  | Pass 1  (Info Arch)  | 4/10 → 8/10 after fixes                    |
  | Pass 2  (States)     | 3/10 → 9/10 after fixes                    |
  | Pass 3  (Journey)    | 5/10 → 9/10 after fixes                    |
  | Pass 4  (AI Slop)    | 9/10 → 9/10 (no issues)                    |
  | Pass 5  (Design Sys) | 6/10 → 9/10 after fixes                    |
  | Pass 6  (Responsive) | 4/10 → 9/10 after fixes                    |
  | Pass 7  (Decisions)  | 2 resolved, 0 deferred                     |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (5 items)                           |
  | What already exists  | written                                     |
  | TODOS.md updates     | 0 items proposed (follow-up via /pm-intake) |
  | Approved Mockups     | 0 generated (HTML wireframe instead)        |
  | Decisions made       | 12 added to plan                            |
  | Decisions deferred   | 0                                           |
  | Overall design score | 3/10 → 8/10                                 |
  +====================================================================+
```
Plan is design-complete. Run /design-review after implementation for visual QA.

### Design unresolved decisions
None.


---

# Eng re-review (plan-eng-review, 2026-10-14, after design review) — target: `.claude/designs/mut-133-portal-personal-income.md`

Scope record: structure covered by exact prior approval D1 (smaller arrangement, narrowly reopened by D5). The extra touched files `components/Toast.tsx` and `components/HostedTable.tsx` are approved by design answers 3A and 8A. No new structure question. Scope Challenge result: scope accepted as-is.

## Re-review findings recorded without a question (mechanism corrections, approved behaviour unchanged)
- **A1** [P2] (confidence 9/10) `src/components/ui/drawer/useDrawerFocus.ts`: `if (active && active !== document.body) return; if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus(...)`. On close, the drawer restores focus to the trigger, so §3.7c's "resolve once the list re-reads" runs too late: the trigger is refocused, then removed by the refetch, and focus falls to `<body>`. **Correction:** decide from the settle response *before* closing, as ADR-055 does. `receivable.status === 'PAID'` → focus the next row's Record payment (or the `h1`) from the current rows, then close; the drawer sees focus already outside and doesn't restore. A partial payment closes normally, and focus returns to the surviving trigger. 9A's outcome is unchanged.
- **A2** [P2] (confidence 7/10) `src/hosted/components/Toast.tsx:31` `{message && (<div className="hp-toast" role="alert">`. The region exists only while a message shows. A dynamically inserted `role="status"` is often not announced. **Correction:** `ToastProvider` always renders an empty polite live region (`role="status"`, `aria-live="polite"`) and fills it for success. Failures keep the existing `role="alert"` element. The API stays backward compatible for its five callers (ReceiptUploader, ExpenseDrawer, ConversionDrawer, DocumentsList, useSignOut): `show(message, tone: 'error' | 'success' = 'error')`. 3A's outcome is unchanged.

## Decision ledger (re-review)

### R5: Which amount text the drawers accept, and what they send
Finding: 5, [P1], confidence 9/10, `src/lib/utils.ts:185` `parseAmountInput` vs `server/src/money.ts:46` `parseMoney` (`DECIMAL_RE`), reviewer: Claude (plan-eng-review re-review)
Plan baseline: §3.3/§3.5 validate the amount with ExpenseDrawer's strict regex `^\d+(\.\d{1,exponent})?$` and send the typed text. Design 4A computes the live line with `parseAmountInput`, which also accepts "1,200", "$100" and "100 NIS". Not reconciled.
Runtime evidence: `parseAmountInput` strips group commas and currency tokens (`splitCurrencyToken`, `AMOUNT_PATTERN … replace(GROUP_SPACES, ',')`). The server's `parseMoney` throws `"… is not a canonical decimal amount"` for anything but `-?\d+(\.\d+)?`. So "1,200" would show "₪3,800.00 still owed" live but fail the strict regex on Save, or, if sent, come back 422 AMOUNT_INVALID.
Comparison grid:
| Choice | Current | A) Lenient in, canonical out | B) Strict everywhere |
|---|---|---|---|
| R5 accepted amount text | strict regex on submit, lenient live line (inconsistent) | `parseAmountInput` for live line and submit; reject a typed currency that differs (`amountInputCurrency`, the local rule); send a canonical decimal built from the minor units | strict regex for both; live line silent until the text is strict-valid; "1,200" is an inline error |
| D1–D5, design 1A–12A | approved | unchanged | unchanged |
Question D1:
D1 — Should the income drawers accept "1,200" and "₪500" like the local app, or only plain "1200.00"?
Project/branch/task: main, eng re-review of MUT-133 after the design review.
ELI10: The live "still owed" line (4A) uses the app's friendly parser, which reads "1,200" or "₪500". The Save validation in the plan only accepts plain "1200.00", and the server only accepts plain decimals. So someone types "1,200", sees "₪3,800.00 still owed", presses Save and gets "Invalid amount". One rule has to win for both the line and the Save.
Stakes if we pick wrong: the drawer contradicts itself on the money field, or people get rejected for typing numbers the way they write them.
Recommendation: A because it matches the local app people already use, and the server still only ever receives a canonical decimal.
Completeness: A=10/10, B=8/10
Pros / cons:
A) Lenient in, canonical out (recommended)
  ✅ "1,200", "1200" and "₪1,200" all work, as in the local PartialPaymentDrawer and IncomeDrawer
  ✅ One parse feeds the live line, validation and the request, so they can never disagree
  ❌ Needs a small minor-units → canonical-decimal formatter and tests for commas, symbols and JOD's 3 decimals
B) Strict everywhere
  ✅ No conversion step; the text typed is exactly the text sent
  ❌ Commas and symbols are rejected in the portal but accepted in the app, so the two disagree on the same field
Net: one forgiving parser shared with the app versus a stricter field that behaves differently from it.
Header: Amount input
Options:
A) Lenient in, canonical out (recommended)
One helper in the income drawer module: parseAmountInput(text, { currency }) → minor (null = invalid); a typed currency different from the field's is an inline error (amountInputCurrency, local rule); the request carries a canonical decimal built from the minor units with exactly the currency's digits (string ops, no Number()). The live line, the schema check and the body all use it. Tests: "1,200", "₪1,200" in ILS, "$5" in ILS (mismatch), JOD "1.250", too many decimals. human ~1h / CC ~5min.
B) Strict everywhere
Use ExpenseDrawer's strict regex for validation and the live line (silent until strict-valid); send the typed text. Tests: "1,200" shows an inline error; the live line stays silent for it. human ~15min / CC ~2min.

State: approved
Actual answer: A) Lenient in, canonical out (re-review D1, user answer 2026-10-14)
Accepted scope: One helper in the income drawer module: `parseAmountInput(text, { currency })` → minor units (null = invalid; ≤ 0 = invalid). A typed currency different from the field's is an inline error (`amountInputCurrency`, the local rule). The request carries a canonical decimal built from the minor units with exactly the currency's digits (string ops, no `Number()`). The live line, the schema check and the body all use it. Tests: "1,200", "₪1,200" in ILS, "$5" in ILS (mismatch), Arabic-Indic "١٬٢٠٠", JOD "1.250", too many decimals, zero/negative.
History: none

Approval readiness (re-review): PASS — R5 (re-review D1, answer A). A1 and A2 are mechanism corrections under approved 9A/3A. Prior D1–D5 and design 1A–12A are unchanged.

## Re-review body
- Architecture: A1, A2 (corrections recorded).
- Code quality: R5 accepted.
- Tests: 4 proof groups added (Toast live region, HostedTable stickyEnd, amount helper cases, focus timing + More details auto-open). QA artifact extended.
- Performance: no issues.
- Outside voice: codex unavailable (CLI not installed; no TaskOutput for the native fallback).
- TODOs: none new.
- Failure modes added: focus lost after a full settle (now prevented by A1, tested); a silent status announcement (A2, tested); a live line contradicting Save (R5, tested). Critical gaps: 0.

### Implementation Tasks (re-review)
- [ ] **RT1 (P1, human: ~1h / CC: ~5min)** — income drawers — one amount helper: lenient parse, currency-mismatch check, canonical decimal out
  - Surfaced by: Code quality — R5
  - Files: src/hosted/components/IncomeCaptureDrawer.tsx (exported helper), RecordPaymentDrawer.tsx, incomeFormSchema tests
  - Verify: `npx vitest run src/hosted/components`
- [ ] **RT2 (P1, human: ~1h / CC: ~5min)** — RecordPaymentDrawer/pages — decide focus from the settle response before close
  - Surfaced by: Architecture — A1
  - Files: src/hosted/components/RecordPaymentDrawer.tsx, src/hosted/pages/views/ReceivablesList.tsx, views.test.tsx
  - Verify: focus survives the refetch in the test
- [ ] **RT3 (P2, human: ~45min / CC: ~5min)** — Toast — persistent polite region + backward-compatible tone parameter
  - Surfaced by: Architecture — A2
  - Files: src/hosted/components/Toast.tsx, Toast.test.tsx
  - Verify: the five existing callers unchanged; region present before the message

### Re-review completion summary
- Step 0: Scope Challenge — scope accepted as-is (structure covered by D1; design answers cover the extra files)
- Architecture Review: 2 issues found (corrections)
- Code Quality Review: 1 issue found
- Test Review: diagram updated, 4 gaps identified
- Performance Review: 0 issues found
- NOT in scope: unchanged
- What already exists: unchanged (+ `parseAmountInput`, `amountInputCurrency`, `normalizeNumerals`)
- TODOS.md updates: 0 items proposed
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable
- Parallelization: unchanged (sequential in one worktree)
- Lake Score: 1/1

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex via `/plan-eng-review` (auto) | Independent 2nd opinion | 19 | unavailable | CLI not installed; native fallback unavailable |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 18 | ISSUES OPEN | 7 issues, 0 critical gaps (re-review after design; all resolved: R5 + A1/A2 + 4 test gaps) |
| Design Review | `/plan-design-review` | UI/UX gaps | 4 | CLEAR (FULL) | score: 3/10 → 8/10, 12 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable in both eng runs today (CLI not installed). No outside findings. Missing coverage, not clean.
- **VERDICT:** DESIGN CLEARED. Eng Review is ISSUES OPEN only by the dashboard rule (findings were found and every one is resolved into the plan); eng review required. The plan is decision-complete (eng D1–D5 + R5, design 1A–12A) and ready for `/eng-build MUT-133`.

NO UNRESOLVED DECISIONS
