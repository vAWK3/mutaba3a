# MUT-646 — Invoicing setup and onboarding (portal and phone)

Status: **Planned 2026-11-22 (overnight run, Basel's standing approval)** · Epic MUT-566 · Builds on MUT-568, MUT-640, MUT-642 · Wireframe: round 3 variant 2 ("steps light up the paper")

## As built (ADR-263)

- Progress lives in its own `issuing_setup` row (logoId, numberingAnsweredAt, introSeenAt, defaultsSavedAt), not on `issuer_details`: the logo, numbering and intro can come before the details.
- The defaults have their own route, `PUT /v1/issuer/defaults` (If-Match); `PUT /v1/issuer` keeps them.
- The logo id is snapshotted in the document's `issuer` JSON (`logoId`); no column on `issued_documents`. Upload is checked by magic bytes, structure and a trial print.
- Portal path `/p/:id/you/invoicing` (the You convention, like Sharing).

## Acceptance criteria (ticket)

1. A new invoicing profile can't issue until business details and numbering are complete; the button explains why.
2. Each checklist item saves on its own and the progress updates.
3. The letterhead preview reflects style, ink and logo as they change.
4. Phone and portal both complete setup; release-qa flows for each.

## Server (mini-crm) — split as its own commit

- **Data** (`issuer_details`, migration `mut646_issuer_setup`): `defaultLanguage VARCHAR(2) default 'he'`, `paymentTermsDays INT NULL`, `bankDetails TEXT NULL`, `footerNote TEXT NULL`, `numberingAnsweredAt TIMESTAMPTZ NULL`, `introSeenAt TIMESTAMPTZ NULL`. `ink` / `documentStyle` become settable.
- **Logo, immutable**: new append-only `issuer_logos (id uuid, organizationId, contentType, bytes BYTEA ≤ 256 KB, sha256, createdAt)`; `issuer_details.logoAttachmentId` → renamed use `logoId` (same column, points at `issuer_logos.id`). `PUT /v1/issuer/logo` (raw `image/png` | `image/jpeg`, ≤ 256 KB, sniffed magic bytes) → new row + issuer.logoId; `DELETE /v1/issuer/logo` clears the pointer (rows kept: issued documents still print their logo). `GET /v1/issuer/logo` serves the current one (the portal preview). Issued documents snapshot `issuer.logoId`; the PDF renderer loads the snapshot's logo (fixes `logo: null` in routes/issuing.ts). No blob storage, no cost.
- **PUT /v1/issuer** accepts `ink` (BLACK|BLUE), `documentStyle` (styles registry keys), `defaultLanguage`, `paymentTermsDays` (0–365), `bankDetails` (≤ 300), `footerNote` (≤ 300). Same If-Match rules.
- **Numbering answer**: `PUT /v1/issuing/numbering { alreadyIssuing: boolean, starts?: { [docType]: number } }` — sets starting numbers (D3 rules, HAS_DOCUMENTS) and `numberingAnsweredAt`. Idempotent.
- **Setup status**: `GET /v1/issuing/setup` → `{ steps: { details, logo, defaults, numbering, taxAuthority }: 'done' | 'todo' | 'later', canIssue, missing: ['DETAILS' | 'NUMBERING'], introSeen }`; `POST /v1/issuing/setup/intro-seen`.
- **Hard gate (S1-a)**: `POST /v1/issued-documents` (and preview/pdf stays open) → 409 `CONFLICT` reason `ISSUING_SETUP_INCOMPLETE` with `details.missing` until details + numbering. Existing MUT-568/640 tests set numbering in their harness helper.
- Accountant grant: reads only (existing writability matrix: issuing:write excluded).
- Signed-out format: issuing is hosted only (no PORTAL_ROUTES change) — confirm.

## Portal

- Route `/p/:id/settings/invoicing` (Settings › Profile › Invoicing), shown when `features.invoicing` and a business profile.
- First visit: three formal cards (what is issued; issued documents are final, corrected by credit note; allocation numbers once connected) → "Begin" → POST intro-seen.
- Variant 2 layout: left a checklist of 5 steps with progress "2 of 5 complete"; right a **live letterhead** (HTML/CSS, not the PDF) that lights up each part as its step is completed — name/number/address block, logo slot, style typeface, ink colour.
- Step 1 business details: legal name, dealer type, number (MUT-642 `completeNumber` + `/v1/business-lookup` prefill), address, city, phone, email. Step 2 logo (file pick, PNG/JPEG ≤ 256 KB). Step 3 defaults (style segmented, ink black/blue, language, prices include VAT, payment terms, bank details, footer). Step 4 numbering question. Step 5 Tax Authority: one line, "Later" (MUT-571).
- Each step saves on its own (its own mutation), progress re-reads `GET /v1/issuing/setup`.
- Copy en + ar (formal MSA).
- QA: `portal.invoicing.setup` (new feature file `qa/features/portal/invoicing.yaml`): intro → details via lookup → logo → defaults change preview → numbering → canIssue; plus `portal.invoicing.setup-gate` (missing numbering → issue refused, banner explains).

## Phone (Flutter)

- Settings › Profile › Invoicing (only with the feature): intro cards, then one growing sheet (direction B) with the five steps and a compact letterhead preview at the top; same API.
- release-qa: `ios.invoicing.setup` flow on the shared "QA iPhone".
- Separate commit in mutaba3a-flutter after the server lands on main.

## Out

Tax Authority connection itself (MUT-571); issuing UI (MUT-570/573).

## Business / product impact

- No invoice goes out missing the details the law requires; the first issue is a guided five-minute setup, not a support call.
- Unblocks MUT-570 (portal issue) and MUT-573 (phone issue): both gate on `canIssue`.
