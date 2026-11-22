# MUT-642 — A customer's VAT number and address, with a registry lookup

Status: **Planned 2026-11-22 (overnight run, Basel's standing approval)** · Epic MUT-566 · Builds on MUT-568 (merged) and MUT-640

## Problem

An issued tax invoice prints the customer's VAT or company number and address, and the allocation API sends `Customer_VAT_Number` (MUT-572). Customers hold only name, email and phone. Basel: adding a customer must be the easiest step: type the number, get the details.

## Acceptance criteria (ticket + 2026-11-22 comment)

1. A customer saved with a VAT number and address returns them; an invalid number is refused (check digit).
2. A document issued after this lands carries both in its customer snapshot; earlier documents are unchanged.
3. A v20 signed-out backup restores into v21 (the format moved on to 20 with MUT-535).
4. (comment) Typing a 9-digit number looks it up: companies and nonprofits fill name and registered address; a dissolved or struck-off one shows a warning; a sole dealer is not found (typed by hand).

## Design

- **Data:** `Customer.taxId VARCHAR(9)` and `address TEXT`, both nullable (migration `mut642_customer_tax_id`). `CustomerRecord`, create/update inputs and patches, Prisma and memory stores, records export columns, customer schemas and serializers (optional, Malafat-visible), import routes untouched (not in their CSV).
- **Validation:** `server/src/israel/tax-id.ts` `isValidIsraeliId(n)`: 9 digits (shorter ones left-padded), the Israeli ID check digit (alternating weights 1/2, digit sums, total divisible by 10). 422 `VALIDATION_FAILED` reason `TAX_ID_INVALID`.
- **Lookup:** `GET /v1/business-lookup?number=` (session, any business profile; not gated on `invoicing`): validates, then asks data.gov.il CKAN `datastore_search` with `filters` on the company number (resource `f004176c-b85f-4542-8901-7b3176f9a054`, ica_companies) and, for 58-prefixed numbers, the nonprofits registry (`be5b7935-3922-45d4-9638-08871b17ec95`). Returns `{ kind: 'company'|'nonprofit', name, nameEn, status, active, address }`, 404 `NOT_FOUND` reason `NOT_IN_REGISTRY` (a sole dealer), 502 `REGISTRY_UNAVAILABLE` on timeout (2.5 s). Cached in memory 24 h per number (LRU 1,000). The base URL and resource ids in config (`DATA_GOV_IL_*`), the fetcher injected so tests never call the network. Rate limited per person.
- **Snapshot:** issuing (`routes/issuing.ts`) adds `taxId` and `address` to the customer snapshot; the PDF model already prints them (MUT-640).
- **Signed-out format:** `CURRENT_STORE_SNAPSHOT_VERSION` 20 → 21 with a local migration that adds nothing (the fields are optional), so a v20 backup restores (AC3).
- **Portal:** the customer drawer gets "VAT or company number" (with the lookup: typing 9 digits fills empty name/address, shows the registry name and a dissolved warning) and "Address". Release-qa portal flow.

## Out (follow-up ticket)

Scanning a certificate or an invoice to fill a customer; a known vendor; phone contacts (the phone flows, MUT-573).

## Business / product impact

- The fastest way to a correct invoice: the customer's legal name and address from one number.
- Unblocks the allocation number (MUT-572) and complete PDFs.
