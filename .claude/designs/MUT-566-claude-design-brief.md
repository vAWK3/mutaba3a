# Claude Design brief — Mutaba3a invoicing (epic MUT-566)

Paste everything below the line into Claude Design, in the Mutaba3a Brand v2 project.

---

You are designing the illustration, icon and motion assets for **issuing invoices in MTB3A (متابعة)**, the Brand v2 project you already have. Businesses in Israel will issue tax invoices, invoice-receipts, receipts and credit notes from the web portal and the iPhone/Android app. These are professionals at work. The tone is **formal, calm and trustworthy**: no confetti, no mascots, no jokes. In copy, Arabic is formal MSA and Hebrew is formal Hebrew.

## Ground rules for every asset

- **Brand v2 only.** Use the existing palette primitives, stroke weights, corner radii and illustration language from the Brand v2 project: the same family as the save-confirmation moment (MUT-626) and the accountant-sharing scenes. Introduce no new colours.
- **The paper is the exception.** Wherever an *invoice document* appears inside an illustration, draw it as white paper with **black or blue ink only**, because those are the only print colours the product allows. Everything around the paper stays in the brand palette.
- **Light and dark.** Deliver every asset in both themes. The document paper stays white in dark mode.
- **Right to left.** Arabic and Hebrew are first-class languages, and English is the third. Anything with direction (arrows, a sheet sliding in, lines of "text" on a page, a stamp moving across) needs an RTL version, or must be direction-neutral. Mark which assets are which.
- **No words inside artwork.** Use abstract grey bars for text and abstract digits only where a number is the point (e.g. "1043"). The app adds real copy around the art.
- **Accessibility.** The art is decorative (the app labels it), so contrast matters for shapes only. Every motion has a **reduced-motion still frame**.
- **Motion format.** We have **no Lottie runtime**. For each motion, deliver:
  - a still keyframe sequence (start, key poses, end) as SVG;
  - a motion spec: durations, easing (the brand's spring, critically damped, no overshoot), and what moves by how much;
  - an MP4/GIF reference loop.

  We rebuild the motion natively in CSS (portal) and Flutter (app), exactly as we did for the save-confirmation moment.
- **Exports.**
  - Illustrations and scenes: SVG, plus PNG at @1x/@2x/@3x.
  - Icons: SVG on a 24 px grid with a 2 px stroke, matching our M-icon family (`MChevronIcon`, `MForwardIcon`…).
  - Naming: `invoicing-<asset>-<light|dark>[-rtl].svg`.

## The assets

### 1. Setup introduction — three spot illustrations (needed first)
Shown as three cards the first time someone opens Invoicing, about 120 × 96 px, one per card:
1. **What you can issue.** A fan of four document sheets (tax invoice, invoice-receipt, receipt, credit note), each with its own sequence number tab.
2. **Issued documents are final.** One document sheet with a closed seal or lock, and a second, smaller sheet (the credit note) beside it that "answers" it. It must not look like an error.
3. **Allocation numbers.** A document sheet whose number field is being filled from a small official-looking emblem (abstract: a circle and a check, **not** the Tax Authority's real logo or any government mark).

### 2. "Letterhead ready" — motion (needed first)
Played once when setup completes. The letterhead preview (a white sheet with a logo slot, name lines, a title line and three grey lines) has five numbered regions that tick off one by one. Ready moment:
- the last tick lands;
- the sheet settles with a tiny lift and a soft shadow;
- a single check appears in the corner.

Total ≤ 1.2 s. Still frame: the settled sheet with the check.

### 3. "Document issued" — motion
After the person issues a document (it gets its permanent number):
- the sheet's number area receives a **stamp** with the number (use "1043");
- the sheet slides into a stack of earlier documents.

≤ 1.4 s. Second, quieter variant **"Sent"**: the sheet folds into an envelope or a share arrow, ≤ 1 s. Both need RTL (the stack and the slide follow the reading direction).

### 4. Document-type icons (24 px, M-icon family)
- Tax invoice: a sheet with a "%" mark.
- Tax invoice-receipt: a sheet with "%" and a small check.
- Receipt: a sheet with a check.
- Credit note: a sheet with a return arrow (mirrored in RTL).
- Allocation-number badge: a small seal shape that sits next to a number.

### 5. Empty states (about 160 × 120 px)
- **No documents yet.** An empty tray with one blank sheet hovering above it.
- **Attach an invoice you issued elsewhere.** A sheet from outside (slightly different, greyer paper) with a paperclip joining a Received entry card.
- **Bulk import drop zone.** A tidy pile of sheets above an open tray, with a downward arrow. It needs an "active" (drag-over) state: the tray glows in the brand accent and the pile lifts.

### 6. "Reading your invoices" — looping motion (bulk import with OCR)
A sheet with a soft scan line passing over it; grey text bars turn into neat table rows beside it. It loops seamlessly every 2.4 s. Still frame: a half-scanned sheet.

### 7. Tax Authority connection — two states (about 160 × 120 px)
- **Waiting for approval:** the business's sheet and an abstract official emblem, joined by a dotted line, with a small clock.
- **Connected:** the line becomes solid, with a small check.

Use no real government logos, flags or the SHAAM mark.

### 8. "Issue a receipt or invoice?" — small inline icon (24 px)
Shown in the confirmation after someone saves income: a coin or banknote turning into a sheet. M-icon family.

## Priority and delivery
1. Assets 1 and 2 are in the product now (MUT-646) and have empty space reserved for them.
2. Assets 3 and 4 are next (the issuing screens, MUT-570/573).
3. Assets 5–8 follow (MUT-647/648/649, MUT-571).

Deliver each batch as an export bundle like the MUT-626 one (SVGs, PNGs, the motion specs, and reference videos), with a one-page sheet showing every asset in light, dark and RTL.
