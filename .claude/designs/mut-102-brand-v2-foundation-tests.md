# MUT-102 — test plan

Plan: `.claude/designs/mut-102-brand-v2-foundation.md` (PD0–PD11, eng review D1–D8).
Gate runs on Node 22 (TD-054): `npx vitest run` · `npm run typecheck` · `npm run lint` · `npm run test:bundles` ·
`npm --prefix server test` · QA specs · `npm run build:desktop`. There is no `test:integration` script.

## Unit (Vitest, `@vitest-environment node`)

### `src/test/css/brandCss.ts` (support module; self-tested in `brand.test.ts` › `harness`)
| Case | Kind |
|---|---|
| OKLCH → sRGB hex matches every `hex` in `mutaba3a.tokens.json` within ±1 per channel (light + dark) | happy |
| `color-mix(in oklch, A p%, B)` with one percentage, both percentages, and `transparent` | happy + edge |
| achromatic input (C = 0) takes the other colour's hue | edge |
| WCAG contrast: black/white = 21, equal colours = 1, translucent fg composited over bg | happy + edge |
| evaluator: `:root` vs `:root:not([data-theme="light"])` under `@media (prefers-color-scheme: dark)` vs `:root[data-theme="dark"]`, all 6 (os × data-theme) combinations | happy |
| evaluator: later rule of equal specificity wins; higher specificity beats later `:root` | edge |
| evaluator throws on any other selector that declares a custom property, and on `!important` custom properties | error |
| `var()` resolution: chains, fallbacks, unresolved → throws with the token name, cycles → throws | happy + error |
| local `@import`s are followed; package `@import`s are recorded, not followed | happy |

### `src/styles/__tests__/brand.test.ts`
- **fonts** — the 5 Thmanyah files in `src/assets/fonts` match the pinned sha256 of the delivered bytes; `public/fonts` no longer holds them; `fonts.css` declares exactly Sans 400/500/700 + Serif Display 400/700, each `font-display: swap`, each `url()` resolving to an existing file; Plex Mono 400/500 come from `@fontsource`; `package.json` and both entries carry no Inter, Source Serif 4 or Plex Sans Arabic import; `theme.css` imports `fonts.css`.
- **drift** — every `--m-*` colour in light and dark equals the JSON `oklch`; radii, type scale, motion curves/durations, press scale and stagger rise/blur equal the JSON.
- **tokens** (4 states: OS light, OS dark, forced light under OS dark, forced dark under OS light) — every custom property resolves; every semantic colour resolves only to `--m-*`, a `color-mix` over `--m-*`, `transparent` or `none`; `theme.css` has no hex/rgb/hsl/oklch literal; radii ∈ {12, 14, 18, 24, 28, 999}px; `--text-body` = 16px; `--font-en`/`--font-ar` start with Thmanyah Sans, `--font-heading(-ar)` with Thmanyah Serif Display, `--font-mono` with IBM Plex Mono; reduced motion → durations/stagger 0ms and press scale 1; `:lang()` font-family rules match only `html` (TD-048 font half); no `font-feature-settings` on `html`.
- **contrast** — light ≥ 7:1, dark ≥ 4.5:1 for the pair list in the plan; `--placeholder` on `--input-bg` ≥ 4.5:1 in all 4 states (D7).
- **names** — every custom property `theme.css` defined before the rewrite (frozen list) is still defined (D6).
- **references** — every no-fallback `var(--x)` in `src/**/*.{css,ts,tsx}` (tests excluded) resolves to a CSS `--x:`, a TSX `'--x'` key or `setProperty('--x'`; dead refs ⊆ shrink-only allowlist and allowlist ⊆ dead refs (D6).
- **accent-text guard** — `(?<![-\w])color\s*:\s*['"]?var\(--accent\)` finds nothing in `src/**/*.{css,tsx}`; the regex itself matches `color: var(--accent)` / `color: 'var(--accent)'` and not `border-color: var(--accent)`, `color: var(--accent-text)` or `--accent-solid` (CQ3).

### `scripts/__tests__/vite-config.test.ts`
- web/desktop snapshot updated **on purpose** (new preload plugin + workbox `runtimeCaching`), diff reviewed.
- font `runtimeCaching` rule exists, `CacheFirst`, cache `fonts`, max 12 entries, matches `request.destination === 'font'` only.
- `globPatterns` has no `otf`.
- the hosted plugin list contains `mutaba3a:brand-font-preload`.
- No build preloads a font (the preload plugin was dropped in the review round, D2: it cost ~700 ms of LCP).

### `scripts/__tests__/check-bundles.test.ts`
- `cssUrls()` extracts `url()`s (quoted, unquoted, skips `data:` and fragments).
- `unresolvedUrls()` reports a `url()` with no file in the dist (missing-file fixture) and passes a resolving one, relative to the CSS file.
- `fontProblems()` flags a retired family file (Inter / SourceSerif / IBMPlexSansArabic), a missing or altered Thmanyah file (sha256 ≠ the pins in `src/assets/fonts/thmanyah.sha256.json`), and an entry HTML that preloads a font.

## Browser (release-qa Playwright, `qa/`)

### `qa/specs/web/brand.spec.ts` (new `qa/features/web/brand.yaml`)
- axe with `color-contrast` enforced on Home, Clients (split), Income, the income drawer, the payment drawer, Settings and the landing page, in light and dark (`emulateMedia`).
- Thmanyah Sans: `document.fonts.check('16px "Thmanyah Sans"')` and the computed body family, EN and AR, on `/app` and `/`.
- Headings: computed family Serif Display and weight 700 on the page `h1`/`h2`; a `<span>` inside the landing `h1` computes Serif Display in EN and AR (TD-048 font half).
- Amounts: `owed-now-amount` / `currency-amount` family includes IBM Plex Mono and `font-variant-numeric` has `tabular-nums`.
- No font or stylesheet request leaves the origin.
- Body computed font-size is 16px.
- ThemeToggle Light → Dark → System under OS light and under OS dark: computed `--bg` equals the expected canvas in all 4 states; a `:focus-visible` button has a non-`none` box-shadow (D6).
- 375 × 1280 × EN/AR × {Home, Clients split, Income, a drawer, Settings}: `scrollWidth <= clientWidth`, drawer box inside the viewport; screenshots attached.

### `qa/specs/portal/signin.spec.ts` (new `portal` app, `vite --mode hosted` on 5175, `/v1/**` stubbed 401)
- sign-in renders; body Thmanyah Sans; heading Serif Display 700 in EN and AR (D5); axe color-contrast in light and dark; no off-origin font request.

### Existing
- `qa/support/axe.ts` `KNOWN_AXE_VIOLATIONS` loses `color-contrast` on every surface that now passes.
- `drawer-motion.spec.ts` keeps passing (reduced motion guardrail).

## Added in the review round
- `brand.test.ts` › `rendered pairs`: every rule's own colour/background pair, in 4 states; shrink-only `KNOWN_LITERAL_PAIRS`.
- Hue-drift, focus, font-placement, mono-weight, synthesis, visited and avatar-colour guards; see `.claude/TEST_PLAN.md` (MUT-102 review round).

## Manual
- Desktop offline: `npm run tauri dev` with the network off — text renders in Thmanyah (screenshot). `check-bundles` proves the `dist-desktop` `url()`s resolve locally.
- PWA offline after one online visit (runtime font cache).
- Landing LCP before (main) / after: `vite preview --mode web`, Fast 3G + 4× CPU, median of 5 — reported, not gated.
