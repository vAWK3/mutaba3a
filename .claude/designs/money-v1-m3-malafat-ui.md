# Money v1 — Milestone 3, Malafat side: VAT settings, fee-agreement wizard, matter financial detail (design brief)

- **Date:** 2026-10-08 · **Status:** implemented the same day (see Malafat `crm-platform/.claude/CHANGELOG.md` "Money v1 Milestone 3")
- **Tickets:** MAL-939 (epic), MAL-150 (UX brief) · **Mutaba3a side:** `money-v1-m3-agreements-installments-vat.md` rev. 2, API `1.2.0-m3`
- **Repo side:** Malafat `crm-platform/apps/web` + `packages/core` i18n only. **No schema change** (ADR-150 rule 1: no ledger, no amounts, no statuses in the tenant schema).
- **Where this file lives:** Malafat's repo rule 13 forbids new Markdown under `apps/` or `.claude/designs/`, and its design briefs belong in Confluence (Design Documents). Confluence is not reachable from this session, so the brief sits with the other Money v1 artifacts (`money-v1-{repository-audit,api-contract,m1-proposal}.md`, which ADR-150 already cites) until it is moved. The wireframes it implements are `crm-platform/.claude/designs/assets/mal150-money-wireframes.html` §4, §5 and the route map in §1.
- **Bounded by:** ADR-150 (+ M2 addendum), MAL-870 (Money included), the Mutaba3a contract §4 "Malafat-side client obligations", DESIGN.md.

## 1. Problem and acceptance criteria

Mutaba3a M3 made obligations possible: effective-dated VAT rates, fixed-fee agreements split into installments, basic retainers, and the receivables they post. Nothing in Malafat can yet create or show any of it; the Money section stops at "linked / not linked". This milestone gives the Partner the three surfaces the Mutaba3a brief (§2.6) named as Malafat obligations:

1. **VAT settings** on Settings › Money: the firm's standard rate with its effective-date history, and a form to add a later rate. `PUT /v1/settings/vat`, `GET /v1/vat-rates`.
2. **Fee-agreement wizard** (`/admin/money/agreements/new?matter=`): Type → Terms → Review, for a fixed fee (installments by percent or amount, triggers, payment terms, per-installment VAT treatment) and for a monthly retainer (basic form). The review step shows what **Mutaba3a** computed (`/v1/agreements/preview`, `/v1/retainers/preview`), and the `previewToken` and the `Idempotency-Key` are minted when that step renders (contract §4).
3. **Matter financial detail** (`/admin/money/clients/[clientId]/matters/[matterId]`, and the same component as a Partner-only **Money tab** on the matter page): agreements with totals, installments with status and "Mark as payable" for manual ones, retainer charges, posted receivables, supplements, cancel. Every figure and status is Mutaba3a's.

Acceptance:

- A Partner sets a VAT rate; the history shows it; the same date with a different rate is refused with Mutaba3a's reason (`RATE_ALREADY_SET`) in words.
- The wizard creates exactly what the review step showed; a rate change between review and create surfaces as `PREVIEW_STALE` in words with a "review again" action; a double click or a retried request cannot create two agreements (same `attemptId` → same Idempotency-Key).
- Installment and receivable statuses on screen are the ones Mutaba3a returned; Malafat computes no status, no due date and no total (ADR-150). Where the wireframe shows a sum that Mutaba3a does not yet return (M6 summaries), the tile shows Mutaba3a's per-agreement totals and counts instead, never a Malafat-computed sum.
- A negative supplement that exceeds unposted capacity is refused with the posted receivables named (`requiresAdjustment`), as wireframe §5e specifies.
- Every new `/api/admin/money/*` route is Partner-only (403 for every other role before touching Mutaba3a), has a `route.spec.ts`, and maps `MoneyConnectionError` reasons through `moneyErrorResponse` (no generic failure text).
- The vendored contract test covers every new client call; the i18n parity test covers every enum value and reason the UI can render; `openapi:generate`, `check:api-contract`, `i18n:check`, ESLint and the Money suites are green.

## 2. Proposed solution

### 2.1 Data flow (no local state)

```
Browser (Partner)                 apps/web (server)                              Mutaba3a
────────────────                  ─────────────────                              ────────
Settings › Money › VAT card  ──►  GET/PUT /api/admin/money/vat                ──► GET /v1/vat-rates · PUT /v1/settings/vat
Wizard step 3 renders        ──►  POST /api/admin/money/{agreements,retainers}/preview ──► POST /v1/{agreements,retainers}/preview
  (mints attemptId once)     ──►  POST /api/admin/money/{agreements,retainers}        ──► POST /v1/{agreements,retainers}  Idempotency-Key = malafat-agreement-{tenant}-{attemptId}
Matter financial page (RSC)  ──►  agreements-service.getMatterFinancial         ──► GET /v1/projects?externalId · GET /v1/agreements?projectId · GET /v1/agreements/{id} · GET /v1/retainers/{id}/charges · GET /v1/receivables?projectId
  Mark as payable dialog     ──►  POST /api/admin/money/installments/{id}/trigger ──► POST /v1/installments/{id}/trigger
  Supplement dialog          ──►  POST /api/admin/money/agreements/{id}/supplements ──► POST /v1/agreements/{id}/supplements
  Cancel                     ──►  POST /api/admin/money/agreements/{id}/cancel · POST /api/admin/money/retainers/{id}/cancel
Client financial page (RSC)  ──►  agreements-service.getClientFinancial         ──► GET /v1/customers?externalId · GET /v1/agreements?customerId · GET /v1/receivables?customerId
  VAT treatment select       ──►  PUT /api/admin/money/clients/{id}/vat-treatment ──► PATCH /v1/customers/{id} (If-Match)
```

The matter → project and client → customer lookups go through Mutaba3a's external references on every request (M2 addendum: no mirror table). Pages are server components; mutations are small client components that `router.refresh()` afterwards, the M1/M2 pattern.

### 2.2 Module layout

| Piece | Path | Notes |
|---|---|---|
| Types | `features/money/domain/types.ts` | `Mutaba3a{VatRate,Agreement,Installment,Supplement,Receivable,RetainerCharge,AgreementPreview,RetainerPreview}`, enums (`VatTreatment`, `PricingBasis`, `PaymentTerms`, `TriggerType`, `ItemStatus`, `Distribution`), request types, and the view types `MoneyVatView`, `MatterFinancialView`, `ClientFinancialView`. `Mutaba3aCustomer`/`Mutaba3aProject` gain `vatTreatment` |
| Client | `features/money/application/mutaba3a-client.ts` | + `PUT`/`PATCH`, `If-Match`; methods `listVatRates`, `setVatRate`, `previewAgreement`, `createAgreement`, `listAgreements`, `getAgreement`, `addSupplement`, `cancelAgreement`, `triggerInstallment`, `previewRetainer`, `createRetainer`, `listRetainerCharges`, `cancelRetainer`, `listReceivables`, `getCustomer`, `patchCustomer`. `MoneyConnectionError` gains `validationReason` (Mutaba3a's 422 `details.reason`) and `details` (the raw `details`, for `requiresAdjustment`); the conflict vocabulary gains the four M3 reasons |
| Error mapping | `features/money/application/error-response.ts` | passes `validationReason` and `requiresAdjustment` through to the browser; new reason `not_linked` → 409 `MONEY_NOT_LINKED` |
| VAT service | `features/money/application/vat-service.ts` | `getVat`, `setVatRate` |
| Agreements service | `features/money/application/agreements-service.ts` | `resolveMatterLink` / `resolveClientLink` (external reference lookups), `getMatterFinancial`, `getClientFinancial`, `previewFixedAgreement`, `createFixedAgreement`, `previewRetainer`, `createRetainer`, `addSupplement`, `cancelAgreement`, `triggerInstallment`, `cancelRetainer`, `setClientVatTreatment`. Idempotency keys derived from `(tenant, attemptId)` |
| Money display | `features/money/ui/money-amount.tsx` (`<MoneyAmount amount currency />`, `formatMoneyAmount`) | Formats Mutaba3a's canonical decimal **string** with `Intl.NumberFormat` (string input, so no float round-trip), `<bdi dir="ltr">`, tabular numerals, Western numerals for Arabic. UX brief D7's `Money` |
| Money input | `features/money/ui/money-input.tsx` (`<MoneyInput>`, `normaliseMoneyInput`) | Text input, `dir="ltr"`, `inputMode="decimal"`, accepts `,`/`.` and spaces, emits the canonical string with the currency's exponent or `null`. Never rounds. UX brief D7's `MoneyInput` |
| Status badge | `features/money/ui/item-status-badge.tsx` | `ItemStatus` → neutral badge, red only for `OVERDUE` (colour carries one meaning, DESIGN.md) |
| VAT card | `admin/money/settings/_components/vat-settings.tsx` | current rate, history, add-rate form (percent → basis points) |
| Wizard | `admin/money/agreements/new/page.tsx` + `_components/agreement-wizard.tsx` (+ `fixed-fee-terms.tsx`, `retainer-terms.tsx`, `review-step.tsx`) | Same shell as the invite wizard (numbered circles, one card, Back / Continue). Unlinked matter → a link step first (reuses `POST /api/admin/money/sync/matters/{id}`) |
| Matter financial | `admin/money/clients/[clientId]/matters/[matterId]/page.tsx` + `features/money/ui/matter-financial.tsx` | The one implementation; also rendered by the matter page's Partner-only `money` tab |
| Client financial | `admin/money/clients/[clientId]/page.tsx` + `features/money/ui/client-financial.tsx` | Matters & arrangements table, VAT-treatment select, Add agreement links |
| Routes | `api/admin/money/vat`, `api/admin/money/agreements{,/preview,/[agreementId]/supplements,/[agreementId]/cancel}`, `api/admin/money/installments/[installmentId]/trigger`, `api/admin/money/retainers{,/preview,/[agreementId]/cancel}`, `api/admin/money/clients/[clientId]/vat-treatment` | each with `route.spec.ts`; Partner only |
| i18n | `money.json` en/ar/he: `vat.*`, `wizard.*`, `financial.*`, `enums.*`, `reasons.*`, `sync.conflicts.*` (+4) | parity test extended |

### 2.3 Screens

**VAT card (Settings › Money).** Current rate ("18 % since 1 Jan 2026") or "No rate set — standard-rated agreements will be refused until one is". History table (rate, effective from, added). Form: rate in percent (0–100, up to two decimals, converted to basis points as an integer in the browser — a rate, not money), effective date (DatePickerCalendar, default today, past allowed). Same date + same rate → "already set" notice; same date + different rate → `RATE_ALREADY_SET` copy. Rendered only when connected.

**Wizard.** Entry from the matter financial page, the client financial page and the Money tab ("Add agreement"). Server page loads the matter, its client, its Mutaba3a link (`GET /v1/projects?externalId=`), the current VAT rate (for the treatment hint), and the office default currency.
- *Not linked:* a card "This matter is not linked to Mutaba3a yet" with the currency picker and "Link matter" (M2 route), then the wizard.
- *Step 1 — Type:* Fixed fee / Monthly retainer (radio cards).
- *Step 2A — Fixed fee:* amount (`MoneyInput`), agreement date (default today), pricing basis (segment), VAT treatment (select: "Default for this client and matter" = omit, or the four), payment terms (select, default EOM), description, installments table (label, % or amount with a basis toggle, trigger Immediate / On date / Manual, date for `DATE`, optional per-installment treatment and terms). Inline hint under the table: entered rows total vs 100 % / amount — **display only**, the Continue button stays enabled and Mutaba3a is the validator (wireframe §5b note).
- *Step 2B — Retainer:* monthly amount, start month (select of the 24 months around today), pricing basis, VAT treatment, billing day (1–28), payment terms (default EOM), end month (optional), description. Preview block fetched from Mutaba3a on Continue (not debounced live: one call when the step is left, and again on the review step; simpler and the token is minted where it is used).
- *Step 3 — Review:* calls the preview route on render; shows Mutaba3a's totals, per-installment net / VAT / gross / due date / status (or the retainer's monthly figures, charges due now, next charge date), and the rate used. `attemptId` is minted once per wizard session and reused across retries. Create → toast → redirect to the matter financial page. A `PREVIEW_STALE` or `VALIDATION_FAILED` answer renders under the review with its reason in words and a "Review again" action that re-fetches the preview (new token, same attemptId).

**Matter financial detail.** Header: matter number · title · client · currency · legal status (context only). Actions: Open matter, Add agreement, (per active fixed agreement) Add supplementary agreement, Cancel agreement (only while nothing is posted; otherwise hidden and explained), (per active retainer) Cancel retainer. Tiles: the active fixed agreement's contractual amount / net / VAT / gross as Mutaba3a returned them, plus "n posted receivables · n overdue" counts. Sections: Agreements (type, date, net, VAT, gross, pricing, treatment, status; supplements listed under their agreement), Installments (label, net, gross, trigger, due date, status, "Mark as payable" on `MANUAL` + `PENDING`), Retainer charges (service month, charge date, gross, due, status), Receivables (origin, posting date, due date, gross, outstanding, status). "Mark as payable" opens a review dialog showing the installment's Mutaba3a figures and an optional due date, then triggers. Supplement dialog: direction, amount, effective date, description, distribution (`LAST_UNPOSTED` / `PRORATE_UNPOSTED` / `NEW_INSTALLMENT` with the new installment's label and trigger); on `SUPPLEMENT_EXCEEDS_UNPOSTED` the dialog renders the safeguard copy with capacity, shortfall and the posted receivables. Payments, documents and history sections of wireframe §4 are M4/M6.

**Money tab on the matter page.** Partner-only tab `money` rendering `<MatterFinancial>` with a link to the full Money page. Not shown to other roles (the tab list is built server-side; the Money routes refuse them anyway).

**Client financial detail.** Header: client · client number · Linked / Not set up. "VAT treatment for this client" select (`PATCH /v1/customers/{id}` with `If-Match`, so a concurrent change is refused as `VERSION_MISMATCH` and the page reloads). Matters & arrangements table: matter, arrangement (Fixed fee + "n of m installments posted" / Retainer "monthly amount · terms" / No agreement), agreed (fixed: Mutaba3a's gross; retainer: blank by rule), status from the matter's receivables (worst of: any `OVERDUE` → Overdue; any `DUE` or `PARTIALLY_PAID` → Outstanding; agreements but no open receivable → Up to date; none → No agreement) — a **label chosen from Mutaba3a statuses, not a computed balance** — and Add agreement / View links. Paid, Remaining and payments arrive with M4; outstanding and overdue totals with M6 summaries. The §3c Money card on the client page is deferred with them.

### 2.4 Reuse

`Button`, `Input`, `Label`, `Badge`, `SelectWithOptions`, `RadioGroup`, `Card`, `DatePickerCalendar`, `Modal`, `useToast`, the ai-connections `ConfirmDialog`, `FeatureGatePage gate="money"`, `requireApiSession` / `requireApiWriteAccess` / `parseRequestBody`, `moneyErrorResponse`, `formatDate`, the invite wizard's step-indicator markup, the M2 link-matter route, `sync-service` loaders (`loadMatter`, `loadClient` exported). New: `MoneyAmount`, `MoneyInput`, `ItemStatusBadge` (registered).

### 2.5 Impact

- M1/M2 behaviour unchanged. `SyncTable` gains a "Finances" link on linked matters and clients (the door to the new pages).
- The matter page gains one conditional tab; the tab's data loads only when `tab=money`.
- `openapi/openapi.yaml`: 11 new routes (additive).
- RBAC matrix §19: new rows, still Partner-only.

### 2.6 i18n, cost, infra

- All strings in `money.json` (en authored; ar/he authored by the agent, flagged for native review like M1/M2). Amounts via `Intl.NumberFormat` with Western numerals; dates via `formatDate`; `<bdi dir="ltr">` around every amount and matter number.
- Cost: each matter financial render makes 3 + (agreements) Mutaba3a calls; bounded by the matter's agreements (rarely more than two). Client page: 3 calls + one per agreement for installment counts. No caching, per ADR-150 (never a cached balance).
- Infra: none. No migration, no release step.

## 3. Decisions

1. **No sums in Malafat.** Where the wireframe shows a total Mutaba3a does not return until M6 (currently due, remaining, outstanding), the UI shows Mutaba3a's per-agreement totals and item counts. Adding decimal strings in Malafat, even exactly, would make a balance Malafat computed, which ADR-150 forbids and M6 makes unnecessary.
2. **Idempotency keys come from a browser-minted `attemptId`.** The review step mints a UUID once; every create/trigger/supplement/cancel request carries it, and the server derives `malafat-{action}-{tenant}-{attemptId}`. A retry after a timeout therefore replays Mutaba3a's stored outcome. `GET /v1/operations/{key}` (M4) is the planned reconciliation; until then the UI tells the Partner to reload the matter page after a timeout.
3. **One implementation, two doors** for the matter financial view: the Money route and the matter page's Partner-only tab render the same server component, as the UX brief did for clients.
4. **Linking happens in the wizard** when the matter is not yet linked (one click, M2 route). Auto-linking on client/matter creation remains deferred: the wizard and the sync table together catch every unlinked matter at the moment it matters.
5. **Client financial page is a status table, not a ledger.** Its status column picks a label from Mutaba3a's receivable statuses; its figures are Mutaba3a's agreement totals. Payments, remaining and outstanding columns wait for M4/M6; the §3c card on the client page waits with them.
6. **Retainer preview is fetched on step change, not debounced live.** Fewer Mutaba3a calls; the token is minted where it is consumed (review).
7. **Validation is Mutaba3a's.** The wizard shows a display-only reconciliation hint and never blocks Continue on its own arithmetic (wireframe §5b note); every Mutaba3a `details.reason` has a sentence in `money.reasons.*`.
