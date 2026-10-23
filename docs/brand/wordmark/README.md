# MTB3A wordmark — kit

The service is written **MTB3A** in English, always in capitals. In Arabic it is always **متابعة**. The mark and the app icon don't change. Epic MUT-400; this kit is MUT-401. Plan and review: `.claude/designs/mut-401-mtb3a-wordmark.md`.

Delivered 2026-10-23 from the Brand v2 Claude Design project (`Wordmark Kit.dc.html`).

## Files

| File | Where | What it is |
|---|---|---|
| `wordmark.svg` | `src/assets/brand/` | The logotype. The only copy: it ships from there, and `wordmark.test.ts` fails if a `wordmark*.svg` appears anywhere under `docs/brand/`. |
| `feature-graphic-en-1024x500.png` | `docs/brand/wordmark/store/` | The English Play feature graphic. MUT-404 uploads it. Not shipped from this repo. |
| `Wordmark Kit.dc.html`, `Feature Graphic.dc.html` | `docs/brand/wordmark/claude-design/` | The Claude Design pages the kit was built in: the lockup previews (mark + MTB3A, mark + متابعة, bilingual; LTR, RTL, light, dark), the numbers below and the store templates. Reference only. Open them in Claude Design: they load Thmanyah from the jsDelivr package Brand v2 bans, and they point at `wordmark/wordmark.svg`, which isn't kept here. Never ship or import them. |

Not taken from the export: its `tokens/` and `icons/web/favicon.svg` predate the AAA inks, the mark tokens and the spacing union; the repo's files stay canonical. The duplicate feature graphic under `icons/android/` is an older render. The `Wordmark Kit.html` bundle embeds Thmanyah converted to `.woff2`, which the licence forbids, so it never comes into the repo.

## The logotype

- **Origin:** outlined from Thmanyah Serif Display Bold (the face of the live Arabic name), glyphs M, T, B, 3 and A at 1000 units per em, font kerning on, +30 units (0.03 em) tracking. The letter shapes are otherwise untouched.
- **Licence:** Thmanyah confirmed the outlined logotype is fine for commercial use (Basel, 2026-10-22). That closes the guardrail the plan raised (D7); the fonts themselves stay unmodified and self-hosted as before.
- **Frame:** `viewBox="0 0 3695 724"`, tight to the ink. Cap height is 700 units; B and 3 overshoot 12 units above and below and stay inside. Every ratio below uses the viewBox height, **H** = 724 units.
- **Fill:** one opaque fill on each of the 5 paths. The colour has no meaning: MUT-402 shows the file as a CSS mask over `var(--ink)`, so it follows the theme and any ink change. There is no dark file.
- **Bytes as delivered:** the C2PA manifest stays, and nobody edits the file. A file that fails `wordmark.test.ts` is re-exported from Claude Design with plain `fill` attributes (D4). The file is pinned in `src/assets/brand/brand.sha256.json`; a deliberate replacement updates the pin in the same commit.

## Lockups

M is the mark size (its width and height). H is the logotype height (the viewBox height).

| Rule | Value | Notes |
|---|---|---|
| Logotype height | **H = 0.40 M** | Mark 96 → logotype 38.4 px tall, 196 px wide. Centred on the mark vertically. |
| Aspect ratio | **W = 5.104 H** | From the 3695 × 724 viewBox. Size the mask box by height only. |
| Gap, mark to name | **0.60 H** (0.24 M) | The same for MTB3A and متابعة. |
| Arabic name | **font-size 1.25 H** | Live text, Thmanyah Serif Display Bold, line-height 1, so متابعة reads the same size as MTB3A. |
| Bilingual separator | **0.16 H dot** in **markDot** | Between the two names, 0.60 H from each. It scales with H (6 px at H = 38.4 px) and uses the theme-aware `markDot` token, never a fixed hex. |
| Clear space | **1 H** on all sides | Nothing else (text, edges, other logos) inside it. |
| Minimum size | **H ≥ 12 px** (M ≥ 30 px) | Below this, use the mark alone. The logotype alone must also be at least 12 px tall. |

**Order.** Lockups are built in code from `mark.svg` and `wordmark.svg`, with no baked lockup files. The order follows `dir`. The mark always comes first in reading order. In the bilingual lockup, LTR puts MTB3A first and RTL puts متابعة first.

These numbers become tokens in MUT-402, with the CSS that first reads them (eng review D1): a `wordmark` block in `mutaba3a.tokens.json`, `--m-wordmark-*` primitives, and a drift case.

## Running text

When "MTB3A" appears inside a sentence:

| Rule | Value |
|---|---|
| Font | The sentence's own face. In the product that is always Thmanyah Sans: never the logotype, never Plex Mono. |
| Weight | The sentence's weight. No bold or colour to make it stand out; in a bold heading it is bold. |
| Letter-spacing | **0.** Plain capitals typed as M-T-B-3-A, with no wrapper element, so i18n strings stay plain text. |
| Case | Always all caps. Never "Mtb3a" or "mtb3a". The digit is a 3, never a letter. |
| Arabic | Arabic sentences always write **متابعة**, never MTB3A. |

Examples: "Track income and expenses with MTB3A, then export a monthly summary in one tap." / "تابع دخلك ومصروفاتك مع متابعة، وصدّر ملخّص الشهر بلمسة واحدة."

The drawing's own tracking (+0.03 em) applies only if a heading-sized live string of the name survives MUT-402. In that case MUT-402 turns it into a token.

## What MUT-402 must add when it renders the logotype

- `mask-image` and `-webkit-mask-image` over `background-color: var(--ink)`, sized by height.
- `role="img"` with `aria-label="MTB3A"` on the masked element.
- `@media (forced-colors: active)`: paint it `CanvasText` with `forced-color-adjust: none`, or it vanishes in Windows high-contrast mode.
- A print rule, so the logotype isn't dropped along with background graphics.
- The lockup tokens above.

## Store artwork (MUT-404)

- **Play feature graphic:** `store/feature-graphic-en-1024x500.png`, 1024 × 500. Line: "Income and expenses — in one calm place."
- **Screenshot header style:** store frame 1290 × 2796, logo 64 px cap height, headline 112 px, 160 px top margin, in Arabic and English. The template is in `claude-design/Wordmark Kit.dc.html`.
