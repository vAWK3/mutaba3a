# MUT-740: the issuer's country, and no issuing where no pack is live (PLAN, 2026-11-26)

Epic MUT-738, ADR-287 decisions 1 and 4 (Proposed). Not built. Server and portal in this repo; the phone is the Flutter repo (a follow-up, see §8).

## 1. Problem and acceptance criteria

Nothing records a profile's country, and the issuer's VAT number is only checked as `^\d{9}$`, so once `INVOICING_FOR_ALL` is on, any business anywhere can issue an Israeli tax invoice. This must land before that flag goes on in production.

- A profile whose country has no live pack cannot save issuer details or issue, and sees why.
- An Israeli profile issues exactly as today.
- The country is read-only after the first issued document.
- An invalid Israeli VAT number is refused on the issuer.
- OpenAPI and `schema.d.ts` regenerated; release-QA feature and a passing portal spec.

## 2. Technical choices (my picks; each is the simplest that meets the criteria)

1. **`issuer_details.country`** `VARCHAR(2) NOT NULL DEFAULT 'IL'` with `CHECK (country ~ '^[A-Z]{2}$')`. One additive migration; every existing profile reads `IL`. Not on `Organization` (ADR-287: it belongs to the issuing setup, and locking is per issuer).
2. **`INVOICING_JURISDICTIONS`**: env, comma-separated ISO codes, default `IL`, parsed and validated in `config.ts` (like `INVOICING_FOR_ALL`), passed as an app dep and read from the request context (`c.get('invoicingJurisdictions')`). Terraform variable `invoicing_jurisdictions` (default `"IL"`), set only when it differs.
3. **One tiny module `server/src/issuing/jurisdictions.ts`**: `parseLiveJurisdictions`, `isLive`, `assertLive` (throws 422 `JURISDICTION_NOT_LIVE` with `details.country`, `details.live`). MUT-741 later grows this into the pack registry; nothing here pre-empts it.
4. **Where it is enforced:** `PUT /v1/issuer` (a non-live country is refused, so none is ever stored) and the issue and preview routes (the issuer's stored country must be live, defence in depth for a country removed from the list later). The read routes and the setup status stay open so the portal can explain.
5. **Lock:** `PUT /v1/issuer` that changes the country when any document counter has `next > start` is 409 `COUNTRY_LOCKED` (the same test the numbering step uses: `store.issuing.counters`). No new store method.
6. **Israeli checksum:** for `country = IL`, the request's `vatId` goes through `normalizeTaxId` (already used for customers) and the normalized 9 digits are stored; failure is 422 `VAT_ID_INVALID`. Already-saved details are not touched until re-saved. Checked: Narabnd's 517108775 passes.
7. **Compatibility:** `country` is optional on the request (create: `IL`; replace: keeps the current one), so shipped phone builds that send no country keep working while `IL` is the only live country. Response `country` is additive and required.
8. **Setup status** (`GET /v1/issuing/setup`, `setupOf`) gains `country` and `liveJurisdictions`, so the portal and phone learn the live list from the server, never hardcoding it.
9. **Both stores:** Prisma and the memory store (`repositories/memory.ts`), serializer, OpenAPI, `schema.d.ts`. Portal local mode has no issuing.

## 3. Portal change (needs Basel's look): the Business details step

The details step (`InvoicingSteps.tsx`) gains a **Country** select above the VAT number, using the billing picker's list (`BILLING_COUNTRY_CODES`, region first, Israel first; names in the reader's language).

- **No default**, like billing's DR11: nobody is put on the wrong tax rules by a guess. A profile that already has details shows its country.
- **Israel:** the form is as today (VAT-number hint unchanged).
- **Any other country:** a quiet notice under the select, «Invoicing isn't available for businesses in <country> yet», and Save is disabled. Nothing is stored.
- **After the first document:** the select is disabled with the same lock icon pattern as the numbering step.
- Arabic first, RTL; strings keyed in `ar.json` and `en.json`; no new component (Select, hint and the existing notice recipe).

Wireframe: `.claude/designs/MUT-740-wireframe.html` (desktop and phone width, three states).

## 4. Test plan (TDD, red first)

- `issuing/__tests__/jurisdictions.test.ts`: parse (default, case, junk, empty), `isLive`, `assertLive`.
- `config` test: `INVOICING_JURISDICTIONS` default and invalid values fail fast.
- `routes-issuing-setup.test.ts`: create with no country is `IL`; non-live country 422; replace keeps country; change after a document 409 `COUNTRY_LOCKED`; invalid Israeli VAT 422 `VAT_ID_INVALID`; valid number normalized; setup status carries `country` and `liveJurisdictions`.
- `routes-issuing.test.ts`: an issuer stored with a country no longer live cannot issue or preview.
- Migration test (existing migration harness): existing rows read `IL`; CHECK refuses `il` and `ISR`.
- Portal `InvoicingSteps.test.tsx`: select shown with no default for new, shown for existing; non-Israel disables Save and shows the notice; locked state.
- Release-QA: features in `qa/features/portal/invoicing.yaml` (three scenarios from the brief), specs in `qa/specs/portal/invoicing.spec.ts`; `release-qa lint` clean.

## 5. Impact

Files: `server/prisma/schema.prisma` + one migration, `config.ts`, `app-shell.ts`/`app.ts`/`index.ts` (the dep), `issuing/jurisdictions.ts`, `routes/issuing.ts`, `schemas.ts`, `serializers.ts`, `repositories/ports.ts`, `prisma.ts`, `memory.ts`, `openapi.yaml`, `src/hosted/api/schema.d.ts`, `InvoicingSteps.tsx`, `setupSteps.ts`, i18n, Terraform `variables.tf` and `main.tf` (+ plan test), `.env.example`, docs. Migration is additive (rollback is harmless: the column can stay). No change to issued documents, numbering, PDFs or the uniform file.

## 6. i18n

New keys under `hosted.invoicing.details.country*` in ar and en: label, placeholder, the not-available notice (country name interpolated), the locked hint, the VAT-number invalid error. Arabic first.

## 7. Cost and infra

None beyond the env var. No extra queries on hot paths (the issuer is already loaded by the issue routes).

## 8. Out of scope and follow-ups

- The phone's country field (Flutter repo): a follow-up ticket; shipped phones keep working through the `IL` default.
- The pack interface (MUT-741), schema generalisation (MUT-742), the rules endpoint (MUT-743).
- Turning `INVOICING_FOR_ALL` on (Basel's call, after this ships).

## 9. Docs to update on landing

CHANGELOG, SYSTEM_OVERVIEW (issuing section), TEST_PLAN, `docs/operations/before-release.md` (migration + the new env), `server/README.md` env table, API version bump with its pins.

## 10. QA scenarios (release-qa, portal)

1. Setting up invoicing asks for the country (no default); choosing Israel keeps the form as today. Expect: details save and the step is done.
2. Choosing another country shows that invoicing isn't available there yet and Save is disabled. Expect: nothing saved.
3. An Israeli profile with a document issued sees its country locked. Expect: select disabled.
4. An invalid Israeli VAT number is refused with a clear error. Expect: nothing saved.
