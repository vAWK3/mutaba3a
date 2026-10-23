# MTB3A wordmark — kit

The service is written **MTB3A** in English, always in capitals. In Arabic it is always **متابعة**. The mark and the app icon don't change. Epic MUT-400; this kit is MUT-401. Plan and review: `.claude/designs/mut-401-mtb3a-wordmark.md`.

Delivered 2026-10-23 from the Brand v2 Claude Design project (`Wordmark Kit.dc.html`).

Decision numbers below are the plan's eng-review answers (eng D1–D9, recorded as ADR-171) unless marked "plan".

## Files

| File | Where | What it is |
|---|---|---|
| `wordmark.svg` | `src/assets/brand/` | The logotype. The only copy: it ships from there, and `wordmark.test.ts` fails if its bytes, or any SVG named wordmark or MTB3A, turn up under `docs/brand/`, `public/` or `src/hosted/public/`. |
| `feature-graphic-en-1024x500.png` | `docs/brand/wordmark/store/` | The English Play feature graphic. MUT-404 uploads it. Not shipped from this repo. Flattened to 24-bit RGB on 2026-10-23, because Google Play refuses a feature graphic with an alpha channel. Every pixel was already opaque, so no pixel changed. A test keeps it 1024 × 500 with no alpha. |
| `Wordmark Kit.dc.html` | `docs/brand/wordmark/claude-design/` | The Claude Design page the kit was built in: the lockup previews (mark + MTB3A, mark + متابعة, bilingual; LTR, RTL, light, dark), the numbers below and the screenshot header template. Reference only. Open it in Claude Design, not from here. It loads Thmanyah from the jsDelivr package Brand v2 bans (unversioned) and IBM Plex Mono from Google Fonts, and it needs `support.js`, `image-slot.js` and `wordmark/wordmark.svg`, none of which is kept in this folder. Never ship or import it. Nothing under `docs/` reaches a build; the Vite dev server can still open it on localhost. |

**Still to come from Claude Design (for MUT-404):** the page that produced the English feature graphic, and an Arabic feature graphic. The export's `Feature Graphic.dc.html` was the pre-rename page ("Mutaba3a" in Bitter, "Income, expenses and invoices", an Invoices chip), so it was left out.

Not taken from the export: its `tokens/` and `icons/web/favicon.svg` predate the AAA inks, the mark tokens and the spacing union; the repo's files stay canonical. The duplicate feature graphic under `icons/android/` is an older render. The `Wordmark Kit.html` bundle embeds Thmanyah converted to `.woff2`, which the licence forbids, so it never comes into the repo.

## The logotype

- **Origin:** outlined from Thmanyah Serif Display Bold (the face of the live Arabic name), glyphs M, T, B, 3 and A at 1000 units per em, font kerning on, +30 units (0.03 em) tracking. The letter shapes are otherwise untouched.
- **Licence:** Basel reports that Thmanyah confirmed commercial use of the outlined logotype (2026-10-22). The written record is still to be attached, so the licence guardrail (plan D7) stays open on MUT-402, the ticket that ships the file. The fonts themselves stay unmodified and self-hosted as before.
- **Frame:** `viewBox="0 0 3695 724"`, tight to the ink. M, T, B and A sit on y 12–712, so the cap height is 700 units. Only the 3 overshoots, 12 units above and below (y 0–724), so the frame's height comes from the 3 alone. Every ratio below uses the viewBox height, **H** = 724 units; a re-export that changes the 3 changes H.
- **Fill:** one opaque fill on each of the 5 paths. The colour has no meaning: MUT-402 shows the file as a CSS mask painted in `currentColor` (there is no `--ink` token; design review D6), so it follows the text colour, the theme and any ink change. There is no dark file.
- **Bytes as delivered:** the C2PA manifest stays, and nobody edits the file. A file that fails `wordmark.test.ts` is re-exported from Claude Design with plain `fill` attributes (eng D4). The file is pinned in `src/assets/brand/brand.sha256.json`; a deliberate replacement updates the pin in the same commit.

## Lockups

M is the mark size (its width and height). H is the logotype height (the viewBox height).

| Rule | Value | Notes |
|---|---|---|
| Logotype height | **H = 0.40 M** | Mark 96 → logotype 38.4 px tall, 196 px wide. Centred on the mark vertically. |
| Aspect ratio | **W = 5.104 H** | From the 3695 × 724 viewBox. Size the mask box by height only. |
| Gap, mark to name | **0.60 H** (0.24 M) | The same for MTB3A and متابعة. |
| Arabic name | **font-size 1.25 H** | Live text, Thmanyah Serif Display Bold, line-height 1, so متابعة reads the same size as MTB3A. |
| Bilingual separator | **0.16 H dot** in **markDot**, at least **3 px** | Between the two names, 0.60 H from each. It scales with H (6 px at H = 38.4 px) and uses the theme-aware `markDot` token, never a fixed hex. **Kit exception (MUT-402 design D10):** never under 3 px, since 0.16 H is about 2 px at the web's 12.8 px logotype. |
| Clear space | **1 H** on all sides | Nothing else (text, edges, other logos) inside it. |
| Minimum size | **H ≥ 12 px** (M ≥ 30 px) | Below this, use the mark alone. The logotype alone must also be at least 12 px tall. |

**Order.** Lockups are built in code from `mark.svg` and `wordmark.svg`, with no baked lockup files. The order follows `dir`. The mark always comes first in reading order. In the bilingual lockup, LTR puts MTB3A first and RTL puts متابعة first.

These numbers are tokens (MUT-402): the `wordmark` block in `src/styles/brand/mutaba3a.tokens.json`, mirrored as `--m-wordmark-*` in `mutaba3a-theme.css`, with drift cases in `brand.test.ts`. The CSS that reads them is `src/components/brand/Logotype.css`. The web's sizes: landing bar M = 32, portal sign-in, setup, terms-update and boot M = 40, portal sidebar M = 32, `Wordmark` default M = 30.

## Running text

When "MTB3A" appears inside a sentence:

| Rule | Value |
|---|---|
| Font | The sentence's own face: Thmanyah Sans in body and UI text, Thmanyah Serif Display in titles. Never the logotype, never Plex Mono. |
| Weight | The sentence's weight. No bold or colour to make it stand out; in a bold heading it is bold. |
| Letter-spacing | **0.** Plain capitals typed as M-T-B-3-A, with no wrapper element, so i18n strings stay plain text. |
| Case | Always all caps. Never "Mtb3a" or "mtb3a". The digit is a 3, never a letter. |
| Arabic | Arabic sentences always write **متابعة**, never MTB3A. |

Examples: "Track income and expenses with MTB3A, then export a monthly summary in one tap." / "تابع دخلك ومصروفاتك مع متابعة، وصدّر ملخّص الشهر بلمسة واحدة."

The drawing's own tracking (+0.03 em) applies only if a heading-sized live string of the name survives MUT-402. In that case MUT-402 turns it into a token.

## How the web renders it (MUT-402)

`src/components/brand/Logotype.tsx` and `Logotype.css`:

- **Logotype:** a `<span role="img" aria-label="MTB3A" lang="en">` with `mask-image` and `-webkit-mask-image` (100% 100%, no repeat, centred) over `background-color: currentColor`. Its box is `inline-block`, unshrinkable and sized by H, so a late mask shifts nothing.
- **BrandName:** the logotype in English, live متابعة (`lang="ar"`, Serif Display Bold at 1.25 H, untracked) in Arabic.
- **Size:** M reaches the CSS only from `Wordmark`'s `markSize`, as `--wordmark-mark` in px. H is declared on the lockup and each name, never on `:root`.
- **Forced colours:** the mask opts out of forcing and names the system colour its live text gets: `LinkText` (`VisitedText`) inside a link, `CanvasText` elsewhere. `currentColor` would be the unforced ink there. The mark gets a 1 px square `CanvasText` ring; it is not a disc, so it is never rounded.
- **Print:** the whole lockup prints in the light ink (`--m-wordmark-print-ink`) whatever the theme.
- **Portal preload:** `hosted.html` preloads the file with `crossorigin`, because the portal has no service worker.

## Store artwork (MUT-404)

- **Play feature graphic:** `store/feature-graphic-en-1024x500.png`, 1024 × 500. Line: "Income and expenses — in one calm place."
- **Screenshot header style:** store frame 1290 × 2796, logotype height H = 64 px (the kit sizes the mask box, so the cap height is about 62 px), headline 112 px, 160 px top margin, in Arabic and English. The template is in `claude-design/Wordmark Kit.dc.html`.
