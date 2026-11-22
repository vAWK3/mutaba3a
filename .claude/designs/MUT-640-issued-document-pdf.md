# MUT-640 — Issued-document PDF in Hebrew, Arabic and English (three styles)

Status: **Planned 2026-11-22 (autonomous overnight run, Basel's standing approval)** · Epic MUT-566 · Server only · Builds on MUT-568 (`feature/mut-568-issuing-core`)

## Problem

One PDF for every issued document, used by the portal, the phone, email and links. Hebrew, Arabic and English, mixed directions inside one document, text that extracts in reading order, no missing glyphs. Three styles the business chooses (Professional, Modern, Minimal; more later), black or blue ink only (canvas https://claude.ai/artifact/EevXQWU3AyFvJxugLTGrNC).

## Acceptance criteria (ticket + comments)

1. The three-script gate passes for every style × he/ar/en: zero `.notdef` glyphs, every word extractable, mixed lines in reading order.
2. Fixture PDFs per style and language are written for a human look and match the approved designs.
3. Black and blue ink both render; no other colour appears.
4. A business with a logo and full details shows them; one without a logo lays out cleanly.
5. (comment) All three styles × he/ar/en pass the gate; a document issued in Modern still renders in Modern after the profile switches style.

## Design

**Engine (ported from Malafat, ADR-168 lessons):** `server/src/pdf/engine/` ← `crm-platform/packages/pdf/src/engine/*` (font registry, per-character font coverage, text runs, layout utils, types; ~430 lines), adapted to this repo's font folder. `@digicole/pdfmake-rtl@2.1.2` with Malafat's patch converted to `patch-package` format (`server/patches/`), `@pdf-lib/fontkit`. Pure Node; fits the Cloud Run image. Every PDF declares its direction; `rtl` on every table; no letter-spacing on RTL; numbers, VAT ids, dates and amounts are kept as LTR runs.

**Fonts** (`server/assets/fonts/pdf/`, all SIL OFL, licences beside them), one family set per style, as on the canvas:
- Professional: Frank Ruhl Libre (Hebrew + Latin), Noto Naskh Arabic
- Modern: IBM Plex Sans, IBM Plex Sans Hebrew, IBM Plex Sans Arabic
- Minimal: Assistant (Hebrew + Latin), Noto Sans Arabic
- Fallback for every style: IBM Plex Sans Hebrew (Hebrew, Latin and ₪), so a character a style's fonts lack never draws a box.

**Styles registry:** `server/src/issuing/pdf/styles.ts` maps a style key to a layout function `(model, ink) → pdfmake docDefinition`. `professional.ts`, `modern.ts`, `minimal.ts`. An unknown key (a style added later and rolled back) falls back to Professional. The document's own `style` and `ink` (snapshotted at issue) choose the layout, never the profile's current setting (AC5).

**Model:** `server/src/issuing/pdf/model.ts` turns an `IssuedDocumentRecord` (+ optional logo bytes, copy label, draft flag) into plain view data: labels in the document's language (`labels.ts`: he/ar/en, formal), the Hebrew legal title as a second line on Arabic and English documents (D-PDF1 below), formatted amounts (`₪` placement per language), dates DD/MM/YYYY, line rows, totals, payment details, allocation number, the credit note's original number, the receipt's invoice number, "מקור"/"העתק" (or "טיוטה" watermark for a preview), page x of y, the footer "Issued with MTB3A".

**Routes** (session, `issuing:*`):
- `POST /v1/issued-documents/{id}/pdf` — produces a copy: records it (channel in the body), idempotent, returns `application/pdf` labelled original/copy. Owner only (a write).
- `GET /v1/issued-documents/{id}/pdf` — a view copy labelled "העתק", records nothing; accountants may call it.
- `POST /v1/issued-documents/preview/pdf` — the draft PDF with the "טיוטה" watermark; nothing written.
Logo: `IssuerDetails.logoAttachmentId` read through the attachment storage; null until MUT-646 adds the upload (renders cleanly without).

**Docker:** copy `patches/` before `npm ci` (postinstall `patch-package`), copy `assets/fonts/` into the runtime image.

## Decisions taken autonomously (log for Basel)

- **D-PDF1:** Arabic and English documents carry the Hebrew legal title ("חשבונית מס") as a second line until the accountant answers MUT-567 Q.
- **D-PDF2:** GET renders a view copy ("העתק") without counting it; only POST (download, email, share) produces a counted copy. The first counted copy is the original.
- **D-PDF3:** A4 portrait; table header repeats on every page; totals on the last page.
- **D-PDF4:** dates DD/MM/YYYY in all three languages (Israeli practice); amounts with two decimals and the ₪ sign after the number in he/ar, before it in en.

## Tests (TDD)

- Port `pdf-inspection.ts` (pdf-lib + pdfjs-dist, dev only): `.notdef` count, text items with x positions.
- `server/src/issuing/pdf/__tests__/gate.test.ts`: 3 styles × 3 languages over a three-script corpus (Hebrew document with a Latin customer, Arabic with a Hebrew customer, English with an Arabic customer; mixed line descriptions; ₪ amounts; VAT ids) → zero `.notdef`, every word extractable, reading order on mixed lines (AC1, AC5); writes `server/.pdf-e2e/<style>-<lang>.pdf` (gitignored) for a human look (AC2).
- Ink: the content streams use only black/blue fill/stroke (plus white) for each ink (AC3).
- Logo present vs absent renders (AC4); style snapshot: a Modern document renders Modern after the profile changes (AC5).
- Routes: POST records copies 0,1,… with labels; GET records nothing; preview has the watermark text; accountant GET 200, POST 403.

## Out of scope

Email sending (MUT-570/573), logo upload (MUT-646), customer VAT number/address on the PDF until MUT-642 snapshots them.

## Business / product impact

- The business's own document, in its language and style, from the first issued invoice: the thing customers pay for.
- Unblocks the portal and phone issue flows (MUT-570, MUT-573) and sending.
- Cost: pure Node rendering, no Chromium, no new infrastructure.
