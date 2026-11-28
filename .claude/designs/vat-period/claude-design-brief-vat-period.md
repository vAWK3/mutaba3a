# Claude Design brief: MTB3A VAT period and "all receipts sent" (2026-11-28)

Paste everything below the line into Claude Design, in the **Mutaba3a Brand v2** project, and attach the zip `mtb3a-vat-period-2026-11-28.zip`.

---

You are designing the **illustrations, icons and motion**, and polishing the **layout**, for one MTB3A (متابعة) feature: at the end of each VAT period, the accountant and the client are reminded, the client says "all receipts sent", and the accountant confirms or asks for more.

**Who sees this:** accountants and their small-business clients in Palestine and Israel. Arabic first, right to left; English second. People at work, often on a phone between tasks. This is a monthly chore; we want it to feel finished, not nagging.

**The feeling:** calm, clear, trustworthy, a little warm. A colleague who says "all set, thanks", never a scolding deadline. "More needed" is a polite ask, never an error. No confetti. Nothing childish, nothing salesy.

## What the feature does (so the art fits)

1. A period ends (every month, every 2 months, or yearly, per client). The accountant and the client each get a reminder.
2. The client opens MTB3A, sees one line "VAT · Jan – Feb · Mar 23" and taps **Done** (all receipts sent).
3. The accountant's desk shows each client with a state: **Waiting for client**, **Client sent**, **Confirmed**, **More needed**.
4. The accountant taps **Confirm**, or **Ask for more** with a short note. The client sees the result and can tap Done again.

Open `wireframes/index.html`: it is the structure we want. Switch language and state at the top. Keep the structure; improve the visual design, spacing and hierarchy. Copy is in `copy/copy.md`; it is minimal on purpose, so **do not add words, hints or explainer sentences**.

## Ground rules

- **Brand v2 only.** Match the scenes in `reference/illustrations/`: rounded 3 px strokes, the **nuqta** (peach dot) as the one recurring accent, soft lavender fills. Colours come from `reference/tokens/mutaba3a-theme.css`. Scenes may use only three roles: field background, primary ink, peach-strong. Our generator turns them into CSS variables, so avoid raw hex outside those roles.
- **No words or real numbers inside the art.** Grey bars for text. The app writes the copy.
- **No real marks.** No government or Tax Authority emblem, no Claude or Anthropic logo. Use abstract stand-ins (a circle with a check for "the authority").
- **Right to left.** Anything that points or moves in a direction ships a second drawing `<name>-rtl.svg` (we never mirror in CSS). Say which scenes are direction-neutral and need none.
- **One drawing, two layouts.** Scenes are drawn at **160 × 160**; the portal uses them at about 120 × 96 and the phone at 160 × 160. Keep the focal shape in the middle 96 × 96 so it survives both crops.
- **Colour never carries meaning alone.** Each state has a word and a glyph (below). Roles: waiting = neutral, client sent = lavender, confirmed = mint, more needed = butter (a "notice" tone, never rose).
- **Motion.** We have no Lottie runtime; we rebuild motion in CSS and Flutter. For each motion deliver: start, key poses and end frames as SVG; a spec table (part, property, from, to, start, duration, easing); an MP4 or GIF reference. Honour reduced motion: a static end frame.
- **Sizes.** Icons 24 px, 2 px stroke, matching our M-icon family. Portal drawer 480 px wide; phone 375 px; also check 375 × 667 (small phone).
- **Accessibility.** Art is decorative; the app labels it. Contrast matters for shapes only.
- **UI rules** are in `reference/DESIGN.md` (drawer-first, banners, rows, chips, one colour one meaning). Follow them; do not invent new patterns.

## What to deliver (put in `deliver/`, same names)

### A. Scenes (SVG, 160 × 160, plus `-rtl` where direction matters)

| File | Where | What it shows |
|---|---|---|
| `receipts-sent` (+rtl) | the client's Done sheet on the phone, and the portal's "recorded" moment | a small stack of receipts handed to the accountant's folder; the nuqta rides on the top receipt |
| `period-confirmed` | the client sees "Confirmed" | the folder closed, a quiet check, the nuqta settled |
| `more-needed` (+rtl) | the client sees "Your accountant needs more" | the stack with one empty slot, a gentle gap, not a missing-item alarm |
| `desk-all-clear` | the accountant desk when every client is confirmed | an orderly row of closed folders, calm |
| `period-unset` | the period drawer when a client has no period yet | a calendar page with the nuqta on one day, inviting a choice |

### B. Icons (SVG, 24 px, 2 px stroke)

`vat-period` (calendar with a corner fold), `receipts-stack`, `state-waiting` (clock), `state-client-sent` (stack with an arrow into a folder; **needs -rtl**), `state-confirmed` (check in a circle), `state-more-needed` (stack with a plus), `ask-more` (speech bubble with a plus). The four state glyphs sit inside the status chip next to the word.

### C. Motion (spec table + SVG poses + MP4/GIF)

1. **Done:** the receipts slide into the folder (about 350 ms), the lid closes, a check settles, the chip cross-fades from "Waiting" to "Client sent" (about 200 ms). Total under 700 ms.
2. **Confirm (accountant):** the chip changes to Confirmed; the desk row gets our existing saved-row tint flash (`.row-flash`, do not redraw it).
3. **More needed:** the empty slot appears with a soft pulse, once.
4. Reduced motion: each ends on its static final pose.

### D. Layout polish (HTML, desktop and phone, Arabic first)

Take `wireframes/index.html` and return a refined version: the accountant desk with period and state columns and the client drawer (Confirm, Ask for more with a note, the period select); the client home group inside the "Waiting" lane; the phone client card and Done sheet; the phone accountant list and review sheet. Show light and dark, Arabic and English, and the four states. Keep money off every screen (nothing here is a total).

### E. A short README

List every file, which are direction-neutral, and anything you were unsure about.

## Out of scope

Email design (the mail uses our existing layout), push notifications, the settings and plan screens, anything about issuing documents.
