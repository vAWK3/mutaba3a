# MUT-743: a rules read, so the portal and phone take each country's fields from the server: PLAN (2026-11-26)

**Status:** plan for approval. Nothing built. Epic MUT-738 (ADR-287). Needs the Israel pack (MUT-741, merged) and the stored jurisdiction (MUT-742, merged); both In Review. Relates MUT-570, MUT-646, MUT-573. This is the first piece of the epic that Basel sees (portal and phone), so §6 lists the questions for him.

## 1. What the clients hard-code today (read from the code)

| Client | Israeli assumption | Where |
|---|---|---|
| Portal setup | the dealer types `LICENSED/EXEMPT/COMPANY/NONPROFIT` and their labels (`hosted.invoicing.details.dealer.*`, the letterhead words per language) | `pages/invoicing/InvoicingSteps.tsx:34,186`, `Letterhead.tsx:17-43` |
| Portal setup | five steps, the last one the Tax Authority connection | `setupSteps.ts`, `InvoicingSetupPage.tsx:136,165`, `TaxAuthorityStep` |
| Portal setup | default document language `he`, languages `he/ar/en` | `InvoicingSetupPage.tsx:111`, `InvoicingSteps.tsx:37,267` |
| Portal issue drawer | the five document types, an exempt dealer gets `RECEIPT` and `PAYMENT_REQUEST` only (the same rule the server's pack holds), currency `'ILS'` | `components/IssueDocumentDrawer.tsx:71,98-101,144,251-253,380` |
| Portal issue drawer | the allocation-number panel (manual entry, nine digits) | `IssueDocumentDrawer.tsx:112-216` (reads the preview's `allocation`) |
| Phone (Flutter, `~/Work/Barmajiyat/Mutaba3a/mutaba3a-flutter/mutaba3a`) | `DealerType`, `SetupStep.taxAuthority`, `docTypesFor(exempt)`, `documentLanguages`, default `'he'` | `lib/domain/models/invoicing_setup.dart`, `providers/invoicing_providers.dart:281`, `screens/invoicing/*`, `screens/settings/invoicing/*` |
| Server | the pack already holds currencies, document types (codes, VAT-bearing, tax document), the dealer rule, VAT table, tax-ID check, clearance, retention (MUT-741); `GET /v1/issuing/setup` already says `country`, `liveJurisdictions` (MUT-740) | `jurisdictions/pack.ts`, `routes/issuing.ts` `setupOf` |

## 2. Design

**One read:** `GET /v1/issuing/rules?country=XX` (scope `issuing:read`, the same gate as `GET /v1/issuing/setup`: 404 unless invoicing is on). `country` is optional: absent means the profile's issuer country, else the default country; the query lets the setup's country step ask for a country before anything is saved. Answer:

```
{ country, live,                      // live = INVOICING_JURISDICTIONS includes it AND a pack exists
  rulesVersion,                       // the pack's version, or null when there is no pack
  // present only when live:
  currency: { base, issuing[] },
  languages: { available: ['he','ar','en'], default: 'he' },
  taxId: { scheme, pattern, maxLength, checkDigit },     // how to check a number as it is typed
  dealerTypes: [{ value, labels: {ar,en,he}, issues: [docType…], exemptFromVat }],
  documentTypes: [{ type, code, vatBearing, taxDocument }],
  setupSteps: ['details','logo','defaults','numbering', 'clearance'?],
  clearance: null | { kind: 'IL_ALLOCATION', label: {ar,en,he}, digits: 9, manualEntry: true } }
```

- **The pack gains the data** (`JurisdictionPack`, same strategy-registry pattern, no `if (country)`): `languages`, `dealerTypes` (value, labels, which document types it may issue), `taxId.pattern/maxLength/checkDigit`, `setupSteps`, `clearance.describe`. The Israel pack fills it from today's values; the dealer refusal function and the `issues` list come from one table so they cannot disagree (a contract test asserts it). `IL_PACK.version` becomes `1.1.0` (a rule-data change; the golden hashes don't depend on it).
- **A profile with no live pack** gets `{ country, live: false, rulesVersion: null }`: the clients show the "not available yet" state from this read; the MUT-740 `liveJurisdictions` on `GET /v1/issuing/setup` stays for older clients.
- **Cacheable:** `ETag` from `rulesVersion` + country, `Cache-Control: private, max-age=300`; the portal caches per `(country, rulesVersion)`; the phone stores the last answer so an offline issue still has its fields.
- **Server enforcement is unchanged:** the rules are for showing the right fields; the issue route still refuses what the pack refuses (`EXEMPT_DEALER_TAX_INVOICE`, `CURRENCY_NOT_SUPPORTED`, `VAT_ID_INVALID`).

**Portal (`src/hosted`):** a `useIssuingRules(profileId, country?)` query (`data/issuingQueries.ts`); `InvoicingSteps`/`InvoicingSetupPage` take dealer types, step list, languages and the default language from it; `IssueDocumentDrawer` takes the allowed types (by dealer), the currency and the clearance panel's presence from it; the Tax Authority step shows only when `rules.clearance` exists. The Israeli copy stays (Arabic first, RTL): dealer-type and clearance labels come from the pack's `labels`; the neutral screen strings stay i18n keys in `ar` and `en`; the Tax Authority connect/disconnect screens remain Israel's content, shown when the pack has that clearance. **An Israeli profile's screens look and behave as today** (AC1) and the existing `portal.invoicing.*` flows are the proof.

**Phone:** the same read in the Flutter repo (`InvoicingRules` model, repository call, provider; `DealerType`, `docTypesFor`, `documentLanguages` and the step list read from it, with today's Israeli values as the offline fallback until the first read). It is its own ticket in that repo and its own session; this plan covers the server and the portal.

## 3. Reuse

`PLAN_FEATURES`-style registries are not touched. Reuses: the pack and registry (MUT-741), `setupOf`'s gate and `useIssuingSetup` (portal), the OpenAPI generation (`openapi:generate`, `hosted:types`), `FakeApi` in `qa/support/portalApi.ts`, the label pattern `{ar,en,he}` (`issuing/labels.ts`). No new pattern: one more strategy-registry member.

## 4. TDD and test plan

1. **Pack contract** (`il-pack.contract.test.ts`): the dealer table, `issues` and `refusal` agree for every dealer × document type; `languages`, `taxId` pattern and check digit match `normalizeTaxId`; `setupSteps` includes `clearance` exactly when the pack has one.
2. **Route** (`routes-issuing-rules.test.ts`): Israeli rules answer; `?country=JO` answers `live: false` with no rules; no `country` uses the issuer's, else the default; the same 404/403 gate as setup; `ETag` 304 round trip; an accountant with a grant reads it (like every issuing read).
3. **Portal unit** (`InvoicingSteps.test.tsx`, `IssueDocumentDrawer` tests): dealer options, steps and allowed types follow the rules; with a rules payload that adds a dealer type or removes the clearance step, the screens follow (AC2: no release for a pack field change); `live: false` shows the not-available state.
4. **Release-QA (portal)** features in `qa/features/portal/invoicing.yaml`: `rules-drive-setup` (a pack field change shows up with no portal change), `rules-not-live` (a country with no live pack gets the "not available yet" state from the read), and the existing Israeli flows re-run because the setup and issue screens changed (§5).
5. Commands (queued): `heavy -l "MUT-743 …" -- npx vitest run <files>`, then the server and root suites, `openapi:check`, `hosted:types:check`, `release-qa lint`.

## 5. QA re-runs (only what the change affects)

Re-run: `portal.invoicing.setup`, `.country-not-live`, `.country-locked` (setup reads the rules), and the issue-drawer flows (`portal.invoicing.issue*`, documents-due issue) because the drawer's type list now comes from the read. Skipped, with reasons: the uniform-file, retention, billing and expenses flows (no code they use changes).

## 6. Questions for Basel (recommended option first)

- **Q1. Scope of "neutral wording".** *Recommend:* structure comes from the read (dealer types, steps, document types, languages, currency, tax-ID format, clearance presence) and the Israeli *labels* come from the pack; the portal's Tax Authority screens keep their Israeli copy, shown only for an Israeli-style clearance. Alternative: also move every Israeli sentence (Tax Authority step, allocation panel) into the pack's data now. Bigger, no second country to test it against yet.
- **Q2. Split.** *Recommend:* three pieces, in order: (1) server (pack data, endpoint, OpenAPI), merged on its own; (2) portal, after (1); (3) phone in the Flutter repo as its own ticket and session, after (1). The server piece changes no screen; the portal piece is the user-visible one (it should keep every Israeli screen as it is).
- **Q3. Where the read lives.** One endpoint with an optional `country` (above) versus two (`/rules` for the profile, `/rules/{country}` for the setup's country step). *Recommend:* one.

## 7. Impact, risk, cost

- Server: ~8 files (pack, Israel pack, route, schemas, serializers, OpenAPI), no migration, no infra. Portal: ~8 files plus QA features and i18n keys (ar, en). Phone: ~10 files in the Flutter repo (separate ticket).
- Risk: a screen that changes for Israeli users. Mitigation: AC1 is a test (the current flows, unchanged) and the offline fallback equals today's values; the server keeps enforcing every rule.
- Rollback: no data; an older portal ignores the new endpoint and keeps hard-coding Israel.

## 8. Eng review (fresh read-only reviewer, 2026-11-26): approve with changes. These supersede §2, §4 and §6 where they differ

Spot-checked: no ETag or `If-None-Match` convention exists in `server/src`; `enum DealerType` is a Prisma enum (`schema.prisma:2292`); the portal has 42 `'ILS'` literals outside tests and local mode.

1. **AC2 is reworded (needs Basel's yes).** `DealerType`, the document language and `IssuedDocType` are closed enums in the server types, `schemas.ts`, Prisma (dealer type: a migration) and the clients (the phone's `fromWire` returns null for an unknown dealer type and the whole issuer parse fails). So the read can **filter, relabel and reorder** values from those enums per pack; a genuinely **new** dealer type, language or document type is a server, schema and migration change plus a one-off client release. AC2 becomes: "a pack that removes or relabels a dealer type, document type or setup step, or changes the currency, default language, tax-ID format or clearance, needs no portal or phone release." The test case "adds a dealer type" is dropped.
2. **Payload trimmed to what clients decide on, plus the per-type behaviour they hard-code today.**
   - Drop: `taxId.checkDigit` (the server owns the check; clients get `pattern` and `maxLength` only to mask input), `documentTypes.code` and `taxDocument` (no client shows them), `clearance.digits/manualEntry`, the custom `setupSteps[]` (the server already returns per-step state in `steps`; the portal derives the steps from `clearance` being present).
   - Add: `documentTypes[].{type, vatBearing, takesPayment, hasDueDate, needsCustomer}`; `dealerTypes[].{value, labelKey, issues[], exemptFromVat, defaultType, entryTypes:{owed[], received[]}}` (the drawer's and the phone's `docTypesFor(entry, exempt)` rules, today hard-coded at `IssueDocumentDrawer.tsx:101,121-127,251` and `issued_document.dart:274`); `vat: { perLineExemption }` (the per-line toggle); `currency.base` used wherever the clients now write `'ILS'`.
   - **Currency and offer gates are in scope for the portal:** `'ILS'` is hard-coded in the drawer (`:144,380,451,496-504`), `ManualAllocationPanel.tsx:35`, `incomeAffordances.ts:66`, `RecordPaymentDrawer.tsx:135`, `IncomeCaptureDrawer.tsx:166-178` and the offer-after-save gates (`issueOffers.ts`, `issuedQueries.ts:94-100`); they read `rules.currency.issuing` and the dealer's `exemptFromVat`. Tax-ID masks: the issuer step and the customer form (`customerQueries.ts:56`) read `taxId.pattern`.
   - **Stated out of scope:** the expense allocation panel and its nine digits (`HostedExpenseFields.tsx:188`, `useHostedExpenseForm.ts:70`, the pack's `expense.*`), the billing plan-limit kind `'taxAuthority'` (billing, not rules), receipt scanning.
3. **The pack version stays 1.0.0.** No issuing rule changes (only display data is added), and the version is stamped on every issued document (MUT-742) and pinned by tests; a bump would make the audit trail say a rule changed. The 1.1.0 line is removed.
4. **No ETag.** There is no such convention in this API, and it would need new server code plus 304 handling in the portal and the phone. A plain `Cache-Control: private, max-age=300`; the portal caches per `(profile, country)` for the session.
5. **Labels: portal i18n stays the home of the copy.** The pack supplies a `labelKey` per dealer type (e.g. `IL.LICENSED`); the Arabic and English strings stay in `ar.json`/`en.json` (one reviewed place, Arabic first), so an Israeli profile's screens are byte-identical (AC1 holds trivially). Only the letterhead's per-language paper words (`Letterhead.tsx:17-43`) come from the payload, from the existing `server/src/issuing/labels.ts`. The UI shows the label for its language, `en` as the fallback, never the Hebrew one.
6. **Route semantics.** Same gate as `GET /v1/issuing/setup` (`issuingProfileOf`): a 404 means "invoicing is off or not applicable for this profile" (personal, Malafat-embedded, `via` tokens), not "no rules"; the "not available yet" state appears only when the read answers `live: false`. Accountants and co-owners are admitted as for every issuing read. Country: the query, else `issuer?.country ?? default` (reuse `setupOf`'s expression). Local (signed-out) mode needs nothing: personal profiles 404.
7. **Fallbacks.** The portal and the phone keep today's compiled-in Israeli values and use them on any 404, 5xx or network failure of the read (old server, offline). The phone uses a stored last answer only offline, never when the server answered `live: false`. An old client with the new server is untouched (the endpoint is additive).
8. **QA.** No `rules-drive-setup` recorded flow (the FakeApi is the portal's fake, so it would test the stub): unit and component tests carry that (payloads that remove a dealer type or the clearance step). The `portal.invoicing.country-not-live` feature is extended (same steps, now fed by the read) instead of a new one. `qa/support/portalApi.ts` gets a `GET /v1/issuing/rules` handler (Israel at least), otherwise every invoicing flow breaks. Re-run: `setup`, `setup-hidden`, `country-not-live`, `country-locked`, `issue-invoice`, `payment-request`, `issue-gate`, `credit-note-*`, `to-issue-issue-all`, `offer-after-save`, `issue-as-you-record`, the manual-allocation flows. Skip, with reasons: `uniform-file`, `attach-external`, the starter flows.
9. **Order.** (1) Server, merged and released in a normal `api-v*` first; it changes no screen. (2) Portal, after the server is live. (3) Phone, its own ticket and session in the Flutter repo. If a new `PATTERNS.md` entry is warranted ("a client-read rules payload"), add it with the server piece.
10. **Design approval.** Israeli screens do not change a pixel (data source only); what changes is the state for a profile with no live pack (it already has the Jordan notice in the setup step) and any neutral wording. Question for Basel below: whether that state needs a mockup.

## Questions for Basel (supersede §6)
- **Q1. AC2 wording:** "removes or relabels, not adds" as in item 1 (adding a dealer type needs a migration and a client release). Yes or no.
- **Q2. Portal scope:** *recommended*: setup and issue drawer plus the currency and offer-after-save gates (item 2), so an Israeli profile behaves exactly as now and no `'ILS'` check remains in the issuing flow; alternative: drawer and setup only, leaving the offer gates and the currency checks elsewhere hard-coded (smaller, but a second country would still see Israeli offers).
- **Q3. Mockup for "not available yet":** *recommended*: no new mockup (the setup step already shows the Jordan notice; the drawer shows the same notice); alternative: a desktop and phone mockup first.
- **Q4. Order:** server first and released, then the portal, then the phone ticket (recommended), or server and portal together.

## Business / product impact
- A second country's invoicing screens come from its pack, not from a portal and phone release each time: this is what makes ZATCA or JoFotara a server-side addition plus its registration track.
- Third step of epic MUT-738 (extraction, schema, rules read); unblocks MUT-745 (contract suite) and the paper packs (MUT-744) being tested against real screens.
- Risk/cost framing: some UI refactor now, behind a "looks as today" test, instead of a fork of the setup and issue screens later.
