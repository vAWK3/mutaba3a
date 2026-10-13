# Claude Design prompt — MUT-104 brand chrome assets

Paste everything below the line into Claude Design, in the Brand v2 project:
https://claude.ai/design/p/160fbfa7-b0c8-4e1a-b348-44dca983aa81?file=Mutaba3a+Brand+v2.dc.html

---

You are extending the **Mutaba3a Brand v2** kit in this project (`Mutaba3a Brand v2.dc.html` and its `support.js`). Use only what's already in the kit: the four-shape mark (`mark.svg` / `mark-dark.svg`), the palette, Thmanyah Serif Display / Thmanyah Sans, and IBM Plex Mono. Don't invent new colours, shapes or type.

I need two assets. Deliver each as a downloadable file with the exact filename given.

## 1. Social share card: `og-card-ar-1200x630.png` (required)

This is the preview that shows up when someone pastes `mutaba3a.app` into WhatsApp, X, LinkedIn, Facebook or iMessage. It replaces a plain square image of the mark.

**Format**
- 1200 × 630 px PNG, sRGB, no transparency, **under 300 KB** (WhatsApp skips larger images).
- Keep every piece of text and the mark inside a centred **1100 × 560 safe area**. X crops to 2:1 and some apps round the corners.

**Content**
- Arabic, laid out right to left. The mark sits at the reading start (the right side).
- Product name: **متابعة**
- Headline, two lines, exactly as on the landing page:
  - اعرف من يدين لك.
  - وأبقِ ذلك لك وحدك.
- Optional small footer in Plex Mono: `mutaba3a.app`
- Nothing else: no screenshots, no device frames, no feature lists.

**Style**
- Background: canvas `#FCF6ED`.
- Headline: Thmanyah Serif Display 700 in ink `#392F4B`. The name and any secondary text: Thmanyah Sans in ink `#392F4B` or ink2 `#564E68`. All text must clear 7:1 contrast on the canvas.
- Use the light mark as delivered (`mark.svg` fills: `#BCABF1`, `#F499A7`, `#F5AB77`, dot `#795DBA`). Don't recolour or redraw it.
- It must still read at thumbnail size (about 300 px wide in WhatsApp): the name and the first headline line must stay legible there.

**Also deliver (optional):** `og-card-en-1200x630.png`, the same card in English, laid out left to right with the mark on the left: "Mutaba3a", "Know who owes you." / "Keep it to yourself."

## 2. Fixed favicon: `favicon.svg` (required)

The delivered `favicon.svg` is broken. The tile is `<rect class="t" width="100" height="100" rx="22">`, but the file has no `<style>`, so browsers paint the tile **black**.

Please re-export it:
- Keep the same geometry: `viewBox="0 0 100 100"`, the tile `rx="22"`, and the mark group `translate(17 17) scale(.66)` with the same four paths.
- Add an embedded `<style>`:
  - **Light** (the default): tile `#FBF1D8`, which matches the delivered PNG favicons and app icons; mark fills as in `mark.svg`.
  - **Dark**, inside `@media (prefers-color-scheme: dark)`: tile `#221B2D`, with the mark fills from `mark-dark.svg` (orange `#F9B379`, dot `#F3E5B0`; lavender and pink unchanged).
- Make the mark's fills classes too, so the dark media query can switch them. Don't leave them as `fill=""` attributes.
- Plain SVG: **no `<metadata>` / C2PA block**, and under 2 KB.
- Check it at 16 px and 32 px on both a light and a dark browser tab bar.

## Hand-off

Reply with the files, plus a one-line note per file giving its pixel size and byte size. Also confirm the contrast ratio you measured for the card's headline.
