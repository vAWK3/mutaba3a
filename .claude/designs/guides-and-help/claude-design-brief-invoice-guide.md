# Claude Design brief: the "Issue your first invoice" guide art (2026-11-28)

Paste everything below the line into Claude Design, in the **Mutaba3a Brand v2** project. It adds one guide to the set already delivered (`mtb3a-guides-and-help-2026-11-27`), so attach that delivery's `assets/illustrations/source/` as the reference, and `reference/briefs/MUT-566-claude-design-brief.md` for the invoice-document family.

---

You are drawing the illustrations for one more MTB3A (متابعة) guide, in the same set and the same hand as the `guide-tax-*` and `guide-accountant-*` scenes you already delivered. The guide teaches a freelancer or small business how to **issue a first invoice** (tax invoice, receipt or credit note) from the portal. Arabic first, right to left.

## Ground rules (unchanged from the first brief)

- Brand v2 only, rounded 3 px strokes, the nuqta as the one peach accent. **Three colours only**: field background, primary ink, peach-strong. No words and no real numbers in the art: grey bars for text, abstract marks for amounts.
- No real marks. No government emblem; the "authority" stays the circle with a check.
- Sizes: the **hero 120 × 96**, each **step 160 × 160 with its subject inside the central 120 × 96** (the portal list shows it at about 120 wide, the phone at 160). Draw the set as one story.
- **Right to left.** Anything that points or progresses in a direction ships `<name>-rtl.svg`. For any scene that is truly direction-neutral, say so in the overview and we will list it as neutral. Never mirror in CSS.

## The scenes

Use the invoice-document family from the MUT-566 brief (the fan of sheets: tax invoice, invoice-receipt, credit note) so this guide reads as the same product as the issuing screens.

- **`guide-invoice-hero`** (120 × 96): a finished sheet with a few grey lines and a small seal, a second sheet fanned behind it.
- **`guide-invoice-1`: finish the setup.** A short checklist of five rows; the first rows are ticked and the nuqta sits on the current row. Progress runs from the reading start, so it needs a `-rtl` drawing.
- **`guide-invoice-2`: press "Issue a document".** A button shape, highlighted, with a blank sheet rising out of it. Likely direction-neutral; say so if it is.
- **`guide-invoice-3`: client, type and lines.** One sheet: a client chip at the top, a row of three small sheet types with one chosen, and two grey line rows with a plus beneath. Columns follow the reading direction, so draw `-rtl`.
- **`guide-invoice-4`: check and issue.** The same sheet complete, totals block at the foot, the nuqta settling on the corner as the sheet closes with a small lock. It must read as **final**, calm, not as a warning.

## Motion

None new. The guide drawer uses the existing `website-entrance` motion; give each step a still.

## What to send back

One SVG per scene named exactly as above (`assets/illustrations/source/<name>.svg` and `<name>-rtl.svg`), the three colours only, plus the overview page with light and dark, LTR and RTL side by side, as before. State which scenes are direction-neutral.
