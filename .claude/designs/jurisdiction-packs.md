# Jurisdiction packs: invoicing rules by the issuer's country (DRAFT, 2026-11-26)

**Status:** APPROVED by Basel 2026-11-27 (MUT-739). MUT-740 to MUT-743 are built on it. Epic and tickets are filed in Jira (see the end). Written from a read of the code and tickets on 2026-11-26 (main 41d8ea9a).

## 1. Problem

Issuing (epic MUT-566) was built for Israel only, and Israel is built into every layer: ILS-only currency, the Israeli VAT table, the Tax Authority's document codes, Israeli legal forms (`DealerType`), 9-digit ID columns, the allocation number as a column on `issued_documents`, gap-free numbering, Instruction 18B signing, the uniform file, 7-year retention, Asia/Jerusalem. Nothing records the issuer's country: `Organization` and `IssuerDetails` have none, and the issuer's `vatId` is only checked as `^\d{9}$`. With `INVOICING_FOR_ALL` on, any business anywhere with nine digits could issue an Israeli 18% tax invoice. Other countries (Saudi Arabia, Jordan; the product already reads ZATCA QR codes and sells in Gulf currencies) will have different rules and clearance systems. Every open ticket (MUT-667, 656, 670, 671, 725..728) adds more Israel-direct code.

## 2. Acceptance criteria

- A profile has an issuer country; issuing follows that country's pack, and a country with no live pack cannot issue (clear message, no Israeli document by accident).
- Israel behaves exactly as today (same documents, numbers, PDFs, uniform file), proven by the existing suite and fixtures.
- A new country is a new pack plus its registration work: no change to the core, no portal or phone release for field changes.
- Every issued document records the jurisdiction and the pack version it was issued under.

## 3. Design

**Source of the country:** `IssuerDetails.country` (ISO 3166-1 alpha-2), chosen at invoicing setup, backfilled `IL`, locked after the first issued document. Not the billing country, locale or currency. The customer's country is a separate field.

**Pack interface** (`server/src/jurisdictions/<cc>/`): currencies and conversion for tax; tax-ID scheme and validator (issuer and customer); issuer legal forms; document types, codes and which are tax documents; dated VAT table and treatments (exempt, zero-rated export, reverse charge); numbering strategy; clearance hook (pre-issue, returns a reference); required fields, legends and QR; signing; retention years; export or report format; labels and default language.

**Core keeps:** the immutable INSERT-only record, the transaction, idempotency, copies, the PDF engine, the retention framework, money in minor units.

**Schema (one migration, before the first real production document):** `jurisdiction` and `jurisdictionPackVersion` on `issued_documents`; `taxId` + `taxIdScheme` wider than 9; a generic clearance record (kind, reference, source), `allocationNumber` kept as Israel's projection; country in issuer and customer snapshots. The INSERT-only triggers and the retention bypass (ADR-260) must be respected by the migration.

**Gating:** `INVOICING_JURISDICTIONS=IL` so a pack ships dark; the plan feature `taxAuthority` becomes a neutral `clearance`; Starter's manual allocation generalises to a manual clearance reference.

**Rules as data:** rates and thresholds stay dated tables per pack; the pack version is stamped on each document; a review date per pack.

**Clients:** a rules read (`GET /v1/issuing/rules`) gives the portal and phone each pack's required fields, labels and document types.

## 4. Reuse analysis

`compose.ts` (parameterise, not replace), the allocation hook (ADR-264), `coreVersion` (model for pack version), `israel/*` (becomes the IL pack), PDF engine and styles, `INVOICING_FOR_ALL` and `PLAN_FEATURES`. No new pattern beyond a strategy registry (PATTERNS: Strategy).

## 5. Impact and cost

Touches `server/src/issuing/**`, `server/src/israel/**`, `routes/issuing.ts`, `routes/documents-due.ts`, `schemas.ts`, Prisma schema, OpenAPI, portal invoicing setup and issue drawer, phone issuing. Rollback past the schema migration is roll-forward only once documents exist. No new infra. Per-country registration is a separate, non-code track with long lead times.

## 6. ADR draft (number at merge; ADR-284 and ADR-285 are taken by Starter, so this is ADR-287 and the entity-structure ADR is ADR-286)

**ADR-287 (proposed): Invoicing Rules Live in Jurisdiction Packs Chosen by the Issuer's Country.** Context as §1. Decision as §3: the issuer's country selects a pack that owns tax-ID, VAT, document types, numbering, clearance, required fields, signing, retention and export; the core stays country-neutral; a country without a live pack cannot issue; documents record jurisdiction and pack version. Israel becomes the first pack by a behaviour-preserving move. Amends ADR-260 decisions 3, 6 and 7 (numbering, statutory VAT table, ILS only) from "the core's rules" to "the Israel pack's rules". Extends ADR-264, ADR-273 and ADR-282. Rejected: per-country forks of the issuing core; deriving the country from billing country or currency; adding country checks inline where each new ticket needs them.

## 7. Sequence

0. This brief and ADR approved; guard the any-country gap before `INVOICING_FOR_ALL` goes on; hold MUT-667's plan.
1. Issuer country, backfill `IL`, refuse no-pack countries.
2. Behaviour-preserving IL pack extraction.
3. Schema generalisation.
4. Rules endpoint and client reads.
5. Paper packs for ZATCA phase 2 and JoFotara to validate the interface (rewrite of MUT-315), then MUT-667 on the pack.
6. Contract tests and golden fixtures per pack.
Re-home the Israel-only backlog (MUT-651, 654, 655, 656, 696) under the IL pack.

## 8. QA scenarios (release-qa, portal)

1. Setting up invoicing asks for the business's country; Israel is preselected; after the first document the country is read-only. Expect: country shown locked.
2. A profile whose country has no live pack opens invoicing setup and sees it isn't available there yet; no issue button works. Expect: no document created.
3. An Israeli profile issues a tax invoice exactly as before. Expect: same number, PDF and allocation behaviour as the existing `portal.invoicing.*` flows.
4. Field requirements shown in the issue drawer come from the server's rules for the profile's country.

Each becomes a feature in `qa/features/portal/invoicing-jurisdiction.yaml` with a spec in `qa/specs/portal/`.

## 9. i18n

Pack labels and legends in he/ar/en per pack; portal strings stay keyed, Arabic first. No Hebrew in the portal beyond issued-document content (portal is ar/en only).
