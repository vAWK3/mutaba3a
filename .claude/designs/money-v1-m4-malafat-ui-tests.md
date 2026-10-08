# Money v1 — Milestone 4, Malafat side: test plan

Companion to `money-v1-m4-malafat-ui.md`. Written before the routes and UI.

## Unit

| File | Cases |
|---|---|
| `features/money/application/__tests__/payments-service.test.ts` | context: customer, currencies with open balances (office currency first), matters by project; list payments with matter labels; `getPayment`; `getClientPayment` refuses (not_found) a payment of another customer; preview in both forms never sends the client id; record / allocate / reverse / credit derive `malafat-{action}-{tenant}-{attemptId}` and forward bodies; operations → COMPLETED / PENDING / UNKNOWN; not connected → `not_connected`; unlinked → `not_linked` |
| `features/money/ui/__tests__/payment-wizard-model.test.ts` | draft → preview body (new and `paymentId` modes); allocation inputs → `[{receivableId, amount}]` dropping empty rows; strategy result fills inputs; corrected-payment prefill; problems: amount, date, method |
| `features/money/__tests__/money-i18n.test.ts` | + `ALREADY_REVERSED`, the 13 M4 reasons, `paymentMethod`, `allocationStrategy`, `paymentStatus` enums, every `payments.*` key in all three locales (parity) |
| `features/money/contract/__tests__/mutaba3a-contract.test.ts` | 1.3.0-m4; every M4 path the client calls; `/v1/payments` query params; Payment / Allocation / Credit / Operation fields; enums |

## Routes (`api/admin/money/payments/__tests__/route.test.ts`)

- 403 for OFFICE_ADMIN / ASSOCIATE / INTERN on all seven verbs with no service call; 401 unauthenticated; a read-only Partner can read a payment and an operation but cannot write.
- Preview accepts `{clientId, currency, amount}` and `{paymentId}` forms, refuses mixed or extra keys, unknown strategy, >200 allocations.
- Record requires the 64-char token and an attemptId; method enum; `replacesPaymentId` optional; 201.
- Allocations: ≥1 allocation, token, attemptId; 200. Reverse: reason 1–500; 200. Credit: amount, reason, optional date; 201. Operations: unknown action → 400; outcome passthrough.
- Error mapping: `not_linked` → 409 `MONEY_NOT_LINKED`; conflict `ALREADY_REVERSED` → 409 with `conflictReason`; validation `CREDIT_EXCEEDS_OUTSTANDING` → 422 with `validationReason` and `details.remote.outstanding`; unknown → 500.

## Manual (runbook)

Record one payment on the pilot firm against a posted receivable, confirm the receivable shows Paid on the matter page, reverse it from the detail page, confirm it shows Due again and the payment shows Reversed; record a corrected payment and confirm both links. RTL check of the Allocate table.
