# MUT-102 — Brand v2 foundation: tokens, Thmanyah + Plex Mono, and the type scale in every web build

- **Ticket:** MUT-102 (Story, status Backlog) · **Epic:** MUT-101 · **Kit:** `docs/brand/README.md`
- **Blocks:** MUT-103 (app sweep), MUT-106 (invoice PDFs), MUT-77 (landing), MUT-91 (portal). **Blocked by:** none.
- **Settled (memory `brand-v2-decisions`, do not re-open):** AAA light inks canonical · Thmanyah for EN and AR · brand scale everywhere (body 16) · fonts self-hosted and unmodified, licence risk accepted.
- **Reserved:** ADR-058 · TD-079..TD-081 (main tops out at ADR-057 / TD-078 after MUT-89 merged at `b9af895`; re-check before use).
- **Status:** built on `feature/mut-102-brand-foundation` (2026-10-12), then fixed in the `/qa-reconcile` review round; see *Build notes* and *Review round* at the end.

## Problem

`src/styles/theme.css` (ADR-018) is the token file for the web app, the landing page, the desktop app and the portal. It still holds the old look: cool grey, teal, Inter, Source Serif 4, Plex Sans Arabic, a 13px body and 4–16px radii. It also repeats every colour in four blocks (about 430 lines of duplication).

Brand v2 sits in `src/styles/brand/mutaba3a-theme.css` but nothing imports it, and its mapping block covers only about 30 of roughly 90 semantic tokens.

## Facts the plan rests on (checked 2026-10-12)

| Fact | Where | Consequence |
|---|---|---|
| The brand kit is **untracked on main**: `docs/brand/`, `src/styles/brand/`, `src/assets/brand/`, 7 font files, plus MUT-104's icon edits under `public/` | `git status` | A worktree cut from main sees none of it. See **PD0**. |
| The portal's `publicDir` is `src/hosted/public` | `vite.config.ts` `hostedConfig()` | The portal build never sees anything in `public/fonts`. |
| The portal server caches only `/assets/*` as immutable. Everything else gets `Cache-Control: no-store`. | `server/src/app.ts` ~124, ~311–330 | Fonts at a public `/fonts/...` path would re-download (about 1 MB) on every portal load. See **PD1**. |
| Desktop builds with `base: "./"` and has `csp: null` | `vite.config.ts`, `src-tauri/tauri.conf.json` | Bundled assets with relative URLs work offline. |
| PWA precache globs are `js,css,html,ico,png,svg,woff2`: no `otf` | `vite.config.ts` workbox | Thmanyah would never be cached for offline PWA use unless we add it. |
| Light `onPrimary` on `primary` is **4.86:1**; on `primaryHover` it is **7.16:1** | computed from `mutaba3a.tokens.json` | Filled buttons in light mode must use `primary-hover` to reach 7:1. The Flutter app already does this (`primaryText = dark ? primary : primaryHover`). |
| Light `primaryHover` on `lavender` is **5.53:1**; `lavenderInk` on `lavender` is **7.03:1** | same | The selected-nav label uses `lavender-ink`, not purple. |
| Light `ink2` on `canvas` is 7.28, on `surface` 7.64, on `fieldBg` 7.05. Every chip ink on its chip is ≥ 7.00. | same | All muted text maps to `ink2`. The four badge pairs pass AAA. |
| `color: var(--accent)` appears 42 times in CSS (rechecked after MUT-89 merged) and 5 times inline in TSX | grep | With `--accent` mapped to `primary` (4.78:1), that text fails AAA. It needs an `--accent-text` token and a sweep. |
| `--text-*` is used 425 times; `--radius-*` 195 times | grep | Re-point the existing names as aliases; don't rename them (renaming is MUT-103's sweep). |
| TD-048 has grown: **20** `dir="ltr"` sites rely on `:lang(ar){direction:rtl}` beating `dir`. They include:<br>• the amount `<bdi>`s in app and portal (`DecimalAmount`, whose `format.test.tsx:45` pins `dir`);<br>• `OrphanedRecordsDrawer`;<br>• five inputs and containers: the income and payment amount groups, `ExpenseFormFields`, and portal sign-in email and password.<br>`i18n/core.tsx:91` already sets `<html dir>`. | grep | **Eng review D1: only the font half lands here.** The `direction` rule stays; its 20-site audit becomes its own ticket. |
| The portal entry never imports Plex Mono | `src/hosted/main.tsx` | Portal amounts fall back to `ui-monospace` today. |
| `@fontsource/ibm-plex-mono` ships woff2 Latin subsets, already precached, under the OFL licence | `package.json` | Keep Plex Mono on @fontsource (the ticket leaves this to the engineer). The `IBMPlexMono-*.ttf` files in `public/fonts` are for MUT-106's PDFs only. |
| The delivered Serif Display `.otf` files are **byte-identical to the Flutter copies that MUT-105 says came from a third-party site** | `shasum` | This is a licence hygiene gap on MUT-102. See *Ticket gaps*. |
| The QA kit has one app (`web`), axe runs in light mode only, and there is no landing or portal axe spec | `qa/qa.config.mjs`, `qa/specs/web/*` | Three AC lines (landing, portal sign-in, dark mode) need new specs. |

## Decisions

| # | Decision | Status |
|---|---|---|
| **PD0** | **Approved (eng review D3 = A).** **Commit the brand kit as delivered on main before cutting the worktree**, as `chore(brand): MUT-101 — Brand v2 kit as delivered`. It includes `docs/brand/`, `src/styles/brand/`, `src/assets/brand/`, the 7 new font files and the `public/` icon changes (MUT-104's inputs). This unblocks MUT-102, MUT-103, MUT-104 and MUT-106 worktrees in parallel. It is Basel's work in his main checkout, so he commits it or OKs me to. | approved (eng review D3) |
| **PD1** | **Bundle the fonts.** Move the 5 Thmanyah `.otf` files, bytes unchanged, from `public/fonts/` to `src/assets/fonts/`, and reference them by relative `url()` in `@font-face`. Vite emits hashed copies under `assets/` in all three builds. That one mechanism means: the portal gets immutable caching from its existing `/assets/*` rule; the web build gets cache-busting; desktop works offline with `base: "./"`; and no server or plugin copies files between public dirs. The alternative, a shared `/fonts/` path, needs a hosted copy plugin plus a server cache change, and still can't be immutable. This follows the kit's own precedent: `src/assets/brand` marks are "bundled, so all three builds get it". It changes the asset map, and MUT-106 then imports `?url` instead of `/fonts/...`. | approved (eng review D4) |
| **PD2** | **The semantic layer is written once.** `theme.css` maps every semantic token to `var(--m-*)` in a single `:root` block. The `--m-*` primitives already switch across the three selector states (light `:root`; OS dark `:root:not([data-theme="light"])`; forced dark `:root[data-theme="dark"]`). Forced light under OS dark falls through to `:root` because of the `:not()`. A small per-mode block, using the same three selectors, holds only what can't be derived from a single mapping: the shadows, overlay, drawer shadow and `color-scheme`. **theme.css then contains no colour literals at all.** | default |
| **PD3** | **Purple text is `--accent-text: var(--m-primary-hover)`.** Filled buttons use `--accent-solid: var(--m-primary-hover)` (7.16:1). Hover and active states mix toward `--m-ink`, so the contrast rises in both modes. `--accent` stays `--m-primary`, for fills, borders and decoration only. The 42 + 5 `color: var(--accent)` sites move to `--accent-text`, and a guard test forbids the pattern returning. | default (follows the ticket wording and Flutter) |
| **PD4** | **Type scale via aliases.** Add `--text-label/body/headline/title/figure/display` (13/16/20/32/40/56). Re-point the old names: `xs, sm` → label; `base, md, lg` → body; `xl, 2xl` → headline; `3xl, 4xl` → title. `body` uses `--text-body`. h1–h6 use `--font-heading` at weight 700. The old names become deprecated aliases (TD-079), and MUT-103 migrates them. | default |
| **PD5** | **Radii via aliases.** Add `--radius-card/hero/pill`. Re-point `sm` 12, `md` 14, `lg` 18, `xl` → card 24, `2xl` → hero 28, `full` → pill 999. | default |
| **PD6** | **Motion tokens:** `--ease-spring`, `--ease-overshoot`, `--duration-press` 120ms, `--duration-toggle` 350ms, `--duration-nav` 420ms, `--stagger-step` 50ms, `--press-scale` 0.96. `--m-press-scale` and `--m-stagger-rise/blur` are added to the brand CSS from the JSON. Under `prefers-reduced-motion: reduce`, the durations and stagger become 0ms and the scale becomes 1. `physics.ts` (JS springs, MUT-80) is untouched. | default |
| **PD7** | **The brand CSS becomes primitives only.** Delete its "Map onto existing app tokens" block; `theme.css` owns every mapping. Factor `--m-shadow-tint` out of `--m-shadow-card`'s own literals (no new values), so shadows and overlay derive from it. Record both as deviations in the kit README. | default |
| **PD8** | **Fonts load from one CSS file.** `src/styles/brand/fonts.css` holds the 5 Thmanyah `@font-face` rules (`font-display: swap`) and the `@import`s for `@fontsource/ibm-plex-mono` 400/500. `theme.css` imports it, so both entries import only `theme.css` and the portal gains Plex Mono. | default |
| **PD9** | **Preload Thmanyah Sans 400 only** through a small post-order Vite plugin. It finds the emitted asset by its original path (`originalFileNames`, Rollup 4.55) and injects `<link rel="preload" as="font" type="font/otf" crossorigin>` into `index.html` and `hosted.html`. The lookup is a pure, tested function. | default |
| **PD10** | **PWA offline fonts use runtime caching, not precache.** Add a workbox `runtimeCaching` CacheFirst rule for `request.destination === 'font'` (cache `fonts`, max 12 entries). Precaching would push about 1.2 MB onto every service-worker install. With runtime caching, offline works after the first online visit. | default |
| **PD11** | **Placeholder is exempt from 7:1, with a 4.5:1 floor (eng review D7).** `--placeholder: color-mix(in oklch, var(--m-ink2) 85%, var(--m-field-bg))`, which is 5.02:1 light and 4.66:1 dark; a test asserts ≥ 4.5:1 in all 4 states. A placeholder at full `ink2` would read as a typed value, and axe does not check `::placeholder`. The ADR records the exemption. | approved (eng review D7) |

## Where the code goes

Worktree `.claude/worktrees/mut-102-brand-foundation` on `feature/mut-102-brand-foundation`, cut from main after PD0, then `npm ci`.

**New**
- `src/styles/brand/fonts.css`: the `@font-face` rules and the Plex Mono `@import`s (PD8).
- `src/assets/fonts/thmanyah{sans-Regular,sans-Medium,sans-Bold,-serif-display-regular,-serif-display-bold}.otf`: moved, not modified (PD1).
- `src/test/css/brandCss.ts` (eng review D2: one support module). It has two parts:
  - **CSS evaluator:** parses CSS with `postcss`. Given `{os: light|dark, dataTheme: none|light|dark, reducedMotion}`, it evaluates the custom properties on `:root` and resolves `var()` chains. It understands the three selector shapes above and specificity (0,1,0) and (0,2,0). It **throws on any other selector shape** that declares a custom property, which keeps `theme.css` simple.
  - **Colour maths:** OKLCH → sRGB, `color-mix(in oklch, …)`, and WCAG contrast. It self-validates against every `hex` in `mutaba3a.tokens.json`, to ±1 per channel.
- `src/styles/__tests__/brand.test.ts` (`@vitest-environment node`), one file with a `describe` block per contract: `tokens`, `contrast`, `fonts`, `drift` and `accent-text guard` (eng review D2).
- The `brandFontPreload()` plugin and its pure lookup, **inline in `vite.config.ts`** beside `emitHostedEntryAsIndex()`. `scripts/__tests__/vite-config.test.ts` tests them (eng review D2).
- `qa/specs/web/brand.spec.ts`; a `portal` app in `qa/qa.config.mjs` (`npm run dev:hosted`, port 5175, `/v1/**` stubbed to 401 with `page.route`); and `qa/specs/portal/signin.spec.ts`.

**Changed**
- `src/styles/theme.css`, rewritten as layers:
  - `@import`s;
  - font, scale, weight and leading tokens;
  - spacing (unchanged);
  - radii (PD5);
  - motion (PD6);
  - one semantic colour block (PD2/PD3);
  - a per-mode block for shadows, overlay and `color-scheme`;
  - the reduced-motion block;
  - the base styles.

  Also:
  - Remove the `cv02…` `font-feature-settings`.
  - Scope the `:lang()` **font-family** rules to `html:lang(..)`. The `:lang(ar){direction:rtl}` rule is **unchanged** (TD-048 font half only, eng review D1).
  - Fix the header comment.

  Expect about 860 → 350 lines.
- `src/styles/brand/mutaba3a-theme.css`: drop the mapping block; add `--m-shadow-tint`, `--m-press-scale` and `--m-stagger-rise/blur`; update the header (PD6/PD7).
- `src/main.tsx`, `src/hosted/main.tsx`: remove every `@fontsource` import, because fonts now come through `theme.css`. In `LandingLoader`, change `background: var(--bg)` and `color: var(--muted)`, dropping the dead `--color-*` names and the `#070C16` fallback.
- `package.json` / lockfile: uninstall `@fontsource-variable/inter`, `@fontsource-variable/source-serif-4` and `@fontsource/ibm-plex-sans-arabic`. Add `postcss` as a devDependency, pinned to the 8.5.6 that is already in the tree, so no new download.
- `vite.config.ts`: add the preload plugin to both configs and the workbox `runtimeCaching` rule (PD10). Update the `scripts/__tests__/vite-config.test.ts` snapshot if it covers workbox.
- `scripts/check-bundles.ts` + `scripts/bundle-rules.ts` (+ tests): for `dist-web`, `dist-desktop` and `dist-hosted`:
  - the 5 Thmanyah files are present, each matching a source file's sha256;
  - no Inter, Source Serif or Plex Sans Arabic font file is emitted;
  - the entry HTML preloads an emitted Thmanyah Sans 400;
  - every CSS `url()` in **each** dist resolves to a file inside that dist. For `dist-desktop` that is the offline proof. For `dist-web` it is the guard against Netlify's `/* → /index.html 200` fallback silently serving HTML for a missing font. (Eng review Section 1: required proof, carried forward.)

  `bundle-origins.json` is **not touched**.
- TD-048, font half only (eng review D1): no component changes. Fix the `.hero-headline-line { font-family: inherit }` workaround only if it becomes redundant, and leave it otherwise. The direction half is filed as **MUT-109** (epic MUT-101; MUT-102 blocks it). Amend TD-048 to point at MUT-109.
- The `--accent-text` sweep: 42 CSS `color: var(--accent)` and 5 TSX inline sites (PD3).
- `src/hosted/hosted.css`: the `.hp-signin-card h1` (and its RTL rule) uses the heading face at 700 (eng review D5).
- `src/components/examples/ThemeDemo.tsx:169,174,179`: rename the three specimen labels to Thmanyah Serif Display, Thmanyah Sans and IBM Plex Mono. The page is routed at `/theme-demo` (`router.tsx:179`). This documents the approved font change (eng review Section 2, carried forward).
- `scripts/__tests__/vite-config.test.ts`: the web/desktop snapshot (`:34`, "leaves the build exactly as it was") changes **on purpose**, for the new plugin and the workbox `runtimeCaching`. Review the diff and update it deliberately, never with a blind `-u`. Add assertions:
  - the font `runtimeCaching` rule exists with CacheFirst;
  - `globPatterns` still has no `otf`;
  - the hosted plugin list contains `mutaba3a:brand-font-preload`.
- `qa/support/axe.ts`: remove `color-contrast` from `KNOWN_AXE_VIOLATIONS` for every surface that now passes (target: all nine). If a listed AC surface still fails because of a component literal, fix **that literal** here; the broad literal sweep stays in MUT-103.
- Docs and knowledge:
  - `docs/brand/README.md`: the asset map (PD1) and the deviations (PD7).
  - ADR-058, amending ADR-018: brand layer, AAA light, bundled fonts, exemptions.
  - TD-048 amended (font half resolved; the direction half moves to the new ticket); TD-079 (legacy size and radius aliases → MUT-103); TD-080 (input borders `line` on `canvas` = 1.19:1, below 1.4.11 non-text 3:1); TD-081 if the preload or runtime-cache choice leaves a follow-up.
  - `PATTERNS.md` "Design tokens": remove the stale claim that legacy `--color-*` tokens live in `index.css` (they don't), and document the two-layer rule.
  - CHANGELOG, SYSTEM_OVERVIEW, TEST_PLAN, COMPONENT_REGISTRY (only if `ThemeDemo` is registered).

## Build order (TDD; one checkpoint commit per step)

1. **Fonts move + pin (red→green):** `brand.test.ts` › `fonts` pins the 5 sha256 values (the delivered bytes) and asserts the `@font-face` set: family, weight, `swap` and an existing file. Then move the files and write `fonts.css`.
2. **Token harness (red):**
   - `brandCss.ts`, with the colour maths self-tested against the JSON.
   - `brand.test.ts` › `drift`: every `--m-*` oklch, in light and dark, equals the JSON; so do the radii, the type scale, the motion values and the press scale.
   - `brand.test.ts` › `tokens` / `contrast`, which in all four states check:
     - every `var()` resolves;
     - every semantic colour token resolves only to `--m-*`, `color-mix` over `--m-*`, `transparent` or `none`;
     - `theme.css` has zero hex, rgb, hsl or oklch literals;
     - light pairs are ≥ 7:1 and dark pairs ≥ 4.5:1 (list below);
     - radii ∈ {12, 14, 18, 24, 28, 999} px;
     - `--text-body` is 16px;
     - under reduced motion, durations are 0 and press scale is 1.
   - `brand.test.ts` › `names` and › `references`, the regression contract (eng review D6):
     - today's `theme.css` token names are frozen;
     - every no-fallback `var(--x)` in `src` resolves;
     - today's 48 dead refs sit in a shrink-only allowlist.
   - `brand.test.ts` › `contrast` also asserts the placeholder is ≥ 4.5:1 on `input-bg` (eng review D7).
3. **theme.css rewrite (green):** PD2–PD7.
4. **Entries + packages + preload + PWA (green):** PD8–PD10, plus the `check-bundles` extensions and their unit tests.
5. **TD-048 font half (green):** `brand.test.ts` › `tokens` asserts that no `:lang()` font-family rule matches beyond `html`. Playwright asserts that a `<span>` inside the landing `h1` computes Serif Display, in EN and AR.
6. **`--accent-text` sweep + guard (green):** `brand.test.ts` › `accent-text guard` scans `src/**/*.css` and `*.tsx` for `color: var(--accent)`, outside an explicit allowlist.
7. **QA specs (red→green):** `brand.spec.ts`, including the 4-state ThemeToggle `--bg` check and the `:focus-visible` ring (eng review D6); the portal app and sign-in spec, including heading Serif 700 in EN and AR (eng review D5); and the `KNOWN_AXE_VIOLATIONS` edits.
8. **Docs/knowledge commit** (`docs(knowledge)`).

**Text pairs the unit test asserts.** Light needs ≥ 7:1 and dark ≥ 4.5:1:

- `text`, `text-secondary`, `muted` and `muted-2` on each of `bg`, `surface`, `input-bg` and `table-header-bg`;
- `accent-text` and `link` on `bg` and `surface`;
- `on-accent` on `accent-solid`, `accent-solid-hover` and `accent-solid-active`;
- `nav-item-active-text` on `nav-item-active`;
- each `badge-{paid,unpaid,overdue,neutral}-text` on its own bg;
- `success`, `warning`, `error` and `info` on `bg`, `surface` and their own `-subtle`.

## Acceptance criteria → proof

| AC | Proof | Command |
|---|---|---|
| Every semantic token resolves to a Brand v2 value in all four theme states | `brand.test.ts` › `tokens` (4-state evaluator) | `npx vitest run src/styles` (Node 22) |
| Light text pairs ≥ 7:1 | `brand.test.ts` › `contrast` pair list | same |
| Purple text uses primary-hover | `--accent-text`/`--link` resolve to `--m-primary-hover`; `brand.test.ts` › `accent-text guard` | same |
| axe colour-contrast on Home, Clients, Income, a drawer, Settings, landing and portal sign-in, in both modes | `brand.spec.ts` + `signin.spec.ts` loop over `emulateMedia({colorScheme})`; `KNOWN_AXE_VIOLATIONS` loses `color-contrast` | `npx playwright test -c qa/playwright.config.ts` (web on 5173, portal on 5175) |
| Thmanyah Sans renders AR and EN in the app, landing, desktop (offline) and portal | Playwright checks `document.fonts.check('16px "Thmanyah Sans"')` and the body's computed family in EN and AR on `/app`, `/` and portal sign-in. For desktop, `check-bundles` proves the `dist-desktop` `url()`s resolve locally, plus a manual `npm run tauri dev` with the network off and a screenshot. | QA + `npm run test:bundles` |
| Headings use Serif Display 700 | Playwright reads the computed family and weight of the page `h1`/`h2` | QA |
| Amounts use Plex Mono tabular figures | Playwright reads an `owed-now-amount` and a `currency-amount`: family includes IBM Plex Mono, and `font-variant-numeric` includes `tabular-nums` | QA |
| No request goes to a font CDN | Playwright requires every `font` and `stylesheet` request to be same-origin; `check-bundles` origin check | QA + `test:bundles` |
| `test:bundles` passes with `bundle-origins.json` unchanged | `git diff --exit-code scripts/bundle-origins.json` in the gate | `npm run test:bundles` |
| Portal CSP test passes unchanged | `git diff --exit-code server/src/__tests__/portal.test.ts`; suite green | `npm --prefix server test -- portal` |
| Served font files are byte-identical | sha256 pinned in the unit test, and dist = source in `check-bundles` | vitest + `test:bundles` |
| No @fontsource import for Inter, Source Serif 4 or Plex Sans Arabic | `brand.test.ts` › `fonts` reads `package.json` and both entries; `check-bundles` finds no such emitted file | vitest + `test:bundles` |
| Body text is 16px; radii come from the brand scale | unit (tokens) + Playwright (computed `body` font-size) | both |
| Nothing breaks at 375 and 1280, EN and AR, on Home, Clients (split), Income, a drawer and Settings | Playwright, for each width × language × surface: `scrollWidth <= clientWidth` and the drawer box inside the viewport. Screenshots attached for review. | QA |

**Guardrails proof:**
- **RTL:** covered by the EN/AR loops.
- **Reduced motion:** a unit test, plus the existing `drawer-motion.spec.ts`.
- **LCP:** run `vite preview --mode web` with CDP throttling (Fast 3G, 4× CPU), take the median of 5 runs before (main) and after, and record it here. It's reported, not gated.
- **Licence:** Basel's email; tracked, not built.

**Gate** (Node 22, per TD-054): `npx vitest run` · `npm run typecheck` · `npm run lint` (0 errors) · `npm run test:bundles` · `npm --prefix server test` · the QA specs above · `npm run build:desktop`. There is no `test:integration` script.

## Quality bar

- **DRY:**
  - The semantic layer goes from 4 copies to 1 (PD2).
  - Fonts are declared in one file for all builds (PD8).
  - The JSON stays canonical, guarded by the drift test.
  - Aliases avoid a 620-site rename; MUT-103 owns that.
  - It reuses `expectOnlyKnownAxeViolations`, `openFreshApp` and the `check-bundles` structure.
- **Testable:**
  - Token correctness is a pure Node test with no browser: the parser, the evaluator and the colour maths are each self-tested.
  - The browser only proves what needs a browser: rendering, axe and layout.
- **Scalable / cost:**
  - Runtime cost is zero (CSS variables). The CSS shrinks.
  - Font bytes on a first visit go from about 0.3 MB (woff2 subsets) to about 1 MB. The licence forbids conversion and subsetting, so we accept that. Mitigations: preload only 400; `swap`; hashed immutable caching in the portal; a runtime cache for the PWA.
  - The desktop installer drops about 50 @fontsource woff2 files and gains 1.2 MB.
  - No server or CDN cost.
- **Constraints:**
  - RTL; EN and AR.
  - Reduced motion.
  - Licence: files byte-identical, no CDN, no conversion.
  - The CSP is untouched.
  - The origin allowlist is untouched.
  - The drawers-first UX is not affected.
  - i18n: no new strings.

## Risks

1. **Visual density shock.** With body 16 and radius-sm 12, small elements change shape: 16–20px chips become pills, and an 18px custom checkbox in `DeleteAllDataModal` becomes nearly round. The 375/1280 screenshots catch it. Anything beyond "breaks" belongs to MUT-103's density re-tune; record it there.
2. **Serif Display at h4–h6 (16–20px).** A display face at body size may read poorly. The AC says "headings use Serif Display 700" without exception. Build to the AC, show the screenshots, and let Basel decide whether h4–h6 move to Sans 500 (the brand's `headline` role).
3. **No 600 weight.** Thmanyah has 400, 500 and 700, so 87 `--weight-semibold` uses render at 700. That is accepted and the ADR notes it.
4. **AC surfaces may still fail axe** because of component literals (for example the "profile avatar" teal in TD-009's note). Fix those on AC surfaces only, and list each in the PR note.
5. **Merge contention.**
   - MUT-104 edits the same `<head>` of `index.html` and `hosted.html`, so merge main before landing.
   - MUT-89 merged to main mid-review (`b9af895`, "All businesses" on Home and Clients). Cut the worktree from that commit or later. The axe and layout specs then cover the business tags and the switcher.

## Ticket gaps found while planning

- **Serif Display provenance.** `public/fonts/thmanyah-serif-display-*.otf` are byte-identical to the Flutter copies that MUT-105 says came from a third-party site. The licence permits only Thmanyah's official site. MUT-102 should carry the same AC as MUT-105, "re-download from Thmanyah's official site". When the files are swapped, update the sha256 pins once.
- **The ticket under-counts TD-048's blast radius:** 20 `dir="ltr"` sites, not 3. Five of them are inputs that will start typing LTR in Arabic. Eng review D1 split the direction half into its own ticket.
- **Buttons.** The ticket doesn't say that filled buttons must use primary-hover to reach 7:1 (cream on primary is only 4.86:1). PD3 settles it, matching Flutter.
- **The portal never loaded Plex Mono.** PD8 fixes that as a side effect.
- **The asset map changes.** If PD1 is approved, MUT-106's "register from `public/fonts`" becomes `?url` imports from `src/assets/fonts`, and MUT-77's re-cut note "files are in `public/fonts`" is stale. Comment on both.

## Out of scope (owner)

- Literal colours, sizes and radii in components, and density re-tuning: **MUT-103**.
- Favicons, the manifest `theme_color`, the wordmark and OG tags: **MUT-104**.
- PDF fonts and colours: **MUT-106**.
- The landing header, motion and display/title adoption: **MUT-77**.
- Portal press feedback, drawers and after-save: **MUT-91**.
- Netlify immutable headers for `/assets/*`: the same gap exists for JS and CSS today, so it is not this ticket's. Filed as **MUT-108** (eng review D8).

## Business / product impact

- Every web surface (landing, app, portal) and the iPhone app get one recognisable look. Text meets AAA in light mode, which matters for a money tool people read daily.
- It is the gate for the whole Brand v2 epic: MUT-103, MUT-106, MUT-77 and MUT-91 are all blocked on it. It also retires three font packages and four-way token duplication.
- Risk is contained: CSS variables and aliases, with no data or schema change. The remaining licence exposure is Basel's email to Thmanyah before a web release.

---

# Eng review — /plan-eng-review, 2026-10-12

- **Target:** `.claude/designs/mut-102-brand-v2-foundation.md`, the plan above. This file is also the report file.
- Plan decision IDs were renamed `D0–D11` → `PD0–PD11` before the review, so they don't collide with review question numbers `D<N>`. That was a factual rename, with no behaviour change.

## Scope Challenge

**A. Assessment.**
- **What already exists:**
  - brand primitives and the canonical JSON;
  - `check-bundles` and `bundle-rules.ts`;
  - `expectOnlyKnownAxeViolations` and the release-qa kit;
  - `isolate()` (FSI);
  - `ThemeProvider`;
  - `@fontsource/ibm-plex-mono`;
  - `postcss` (in the tree);
  - Vite asset hashing;
  - Workbox `runtimeCaching`. Verified: `urlPattern: ({request}) => request.destination === …`, `workbox-build` types:324.
  - Rollup 4.55 `OutputAsset.originalFileNames`. Verified: `rollup.d.ts:918`.
- **Search:** [Layer 1]. A post-order `transformIndexHtml` that reads `ctx.bundle` is the standard way to preload hashed fonts.
- **Complexity:** about 80–90 files (estimated) and 3 new modules, so the gate tripped.
- **Finding SC1** `[P1] (confidence: 9/10)`: TD-048 has **20** `dir="ltr"` sites, not 8. Evidence:
  - `src/hosted/format/DecimalAmount.tsx:49` `<bdi dir="ltr" className={`hp-amount …`}>`
  - `src/components/drawers/IncomeDrawer.tsx:549` `<div className="input-with-prefix" dir="ltr" data-testid="income-amount-group">`
  - `src/hosted/pages/auth/SignInPage.tsx:145` `dir="ltr"`

  They include five inputs and containers that render RTL in Arabic today. → Settled by D1.

**B. Scope record (post-answer):**
- **Feature answers:** D1 = "Font half now, direction later". The TD-048 font-family half stays in MUT-102. The `direction` half is deferred to a new ticket.
- **Structure:** D2 = B, "Smaller arrangement":
  - one `src/test/css/brandCss.ts`;
  - one `src/styles/__tests__/brand.test.ts` with a `describe` block per contract;
  - `brandFontPreload()` inline in `vite.config.ts`, tested from `scripts/__tests__/vite-config.test.ts`.
- **Accepted scope:** the plan as written (PD2–PD10 feature list), with D1 and D2 applied above.
- **Pending remedies:** PD0, PD1, PD11.

**C. Findings:**
1. SC1 (`[P1]`, 9/10): accepted via D1.
2. SC2, PD0: the brand kit is untracked on main (`[P1]`, 10/10, `git status`). Pending → R1.

## Decision ledger

### R1: Where the untracked Brand v2 kit gets committed (PD0)
- **Finding:** SC2. `[P1] (confidence: 10/10)` `git status` on main. Untracked: `docs/brand/`, `src/styles/brand/`, `src/assets/brand/`, `public/fonts/{thmanyah*,IBMPlexMono*}`. Uncommitted: `M public/icons/*.png`, `M src/hosted/public/favicon.svg`. Deleted: `D public/{head-snippet.html,manifest-snippet.json,mark.svg,mark-dark.svg,icon-*.png,maskable-512.png}` (all added by `350d919 new icons`). Reviewer: Claude (native).
- **Plan baseline:** PD0, original proposal: commit everything as delivered on main before cutting the worktree. Not approved.
- **Runtime evidence:** `git worktree add` from main checks out HEAD only, so untracked files are absent from a new worktree (git semantics). The reorganisation (public/ root → `docs/brand`, `src/assets/brand`, `public/icons`) exists only in the working tree.
- **Comparison grid:**

| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1 kit commit location | untracked/uncommitted on main (pending) | one `chore(brand)` commit on main with every kit file **and** the `public/` icon reorganisation, made by me with a guarded `[ "$(git branch --show-current)" = main ]` command | commit on main only `docs/brand/`, `src/styles/brand/`, `src/assets/brand/` and the 7 font files; icon edits and deletions stay uncommitted for MUT-104 | nothing on main; copy the MUT-102 inputs into the worktree and commit them on `feature/mut-102-brand-foundation` |
| R2 font location (PD1) | pending | pending | pending | pending |
| D1 TD-048 | font half only (D1) | same | same | same |
| D2 layout | smaller arrangement (D2) | same | same | same |

**Question D3:**
D3 — How should Basel's uncommitted Brand v2 kit get into git before MUT-102 starts?
Project/branch/task: MUT-102 Brand v2 foundation, planned from main.
ELI10: The brand files Basel delivered today (docs, the brand CSS, the logo marks, seven font files, and the reorganised icons) exist only as uncommitted changes in the main folder. A new worktree starts from the last commit, so it would not see any of them. The four sibling tickets (MUT-103, 104, 106 and this one) all need the same files.
Stakes if we pick wrong: MUT-102 starts without its inputs, or two branches each add copies of the same files, or the icon reorganisation sits uncommitted where another session can wipe it.
Recommendation: A because one commit on main gives every Brand v2 worktree the same starting point and protects the icon reorganisation from being lost.
Completeness: A=10/10, B=7/10, C=5/10
Pros / cons:
A) Commit whole kit on main (recommended)
  ✅ Every Brand v2 worktree (102/103/104/106) starts from the same committed kit
  ✅ The icon reorganisation is saved in history instead of living only in a working tree
  ❌ Commits MUT-104's icon inputs before MUT-104 starts, so that ticket's diff won't show them
B) Commit only MUT-102 inputs
  ✅ MUT-104's icon changes stay out of this commit and land with their own ticket
  ✅ MUT-102 still gets docs, the brand CSS, the marks and the fonts it needs
  ❌ The icon edits and deletions stay uncommitted in the shared main folder, at risk until MUT-104
C) Copy into the MUT-102 branch
  ✅ Nothing touches main until MUT-102 merges
  ✅ No decision needed about MUT-104's files now
  ❌ MUT-103/104/106 can't start in parallel; each would copy the same files again
Net: one shared starting commit now, against keeping main untouched until each ticket merges.
**Header:** Kit commit
**Options:**
A) Commit whole kit on main (recommended)
I commit, guarded to main: `docs/brand/`, `src/styles/brand/`, `src/assets/brand/`, the 7 new font files, and the `public/` icon edits and deletions, as `chore(brand): MUT-101 — Brand v2 kit as delivered`. Then I cut the MUT-102 worktree from it. Human ~10 min / CC ~2 min.
B) Commit only MUT-102 inputs
I commit, guarded to main: `docs/brand/`, `src/styles/brand/`, `src/assets/brand/` and the 7 font files. The `public/icons` edits, the favicon edit and the `public/` deletions stay uncommitted for MUT-104. Human ~10 min / CC ~2 min.
C) Copy into the MUT-102 branch
Nothing is committed on main. I cut the worktree from HEAD, copy the MUT-102 inputs into it, and commit them on the feature branch. Siblings wait for MUT-102 to merge. Human ~10 min / CC ~2 min.

- **State:** approved
- **Actual answer:** A) "Commit whole kit on main (recommended)" (Basel, D3, 2026-10-12)
- **Accepted scope:** The first step of `/eng-build`, before cutting the worktree. In one command guarded by `[ "$(git branch --show-current)" = main ]`, commit `docs/brand/`, `src/styles/brand/`, `src/assets/brand/`, the 7 new `public/fonts` files, and the `public/` icon edits and deletions, as `chore(brand): MUT-101 — Brand v2 kit as delivered`. Then cut `.claude/worktrees/mut-102-brand-foundation` from that commit. Nothing is committed during this review.
- **History:** none

## 1. Architecture review — findings

```
public/fonts (delivered) ──PD1──> src/assets/fonts/*.otf ◄── url() in src/styles/brand/fonts.css
src/styles/theme.css ─@import─> brand/mutaba3a-theme.css   (--m-* primitives × 3 selector states)
        │            └@import─> brand/fonts.css ─@import─> @fontsource/ibm-plex-mono 400/500
        │  one semantic block + per-mode block (shadows, overlay, color-scheme)
        ├─ src/main.tsx ──vite web────> dist-web/assets/*-<hash>.otf      → Netlify (/* → index.html 200 fallback)
        │              ──vite desktop─> dist-desktop/assets/*-<hash>.otf  → Tauri, offline, base "./"
        └─ src/hosted/main.tsx ─vite hosted─> dist-hosted/assets/*-<hash>.otf → Hono: /assets/* immutable, else no-store
brandFontPreload() ─transformIndexHtml(post, ctx.bundle)─> <link rel=preload as=font crossorigin href=…Regular-<hash>.otf>
check-bundles ─> dist hashes == source · every CSS url() resolves (all 3 dists) · preload target exists · no retired fonts
```

**A1.** `[P1] (confidence: 9/10)` PD1, font location. Evidence:
- `server/src/app.ts:124` `c.header('Cache-Control', 'no-store');`
- `:311–330` sets immutable only `if (c.req.path.startsWith('/assets/'))`.
- `vite.config.ts` `hostedConfig()` sets `publicDir: "src/hosted/public"`.

→ R2 / D4.

**A2.** `[P2] (confidence: 8/10)` `src/hosted/hosted.css:141` `font-family: var(--font-en);` on `.hp-signin-card h1`, plus `:146` `[dir="rtl"] .hp-signin-card h1 { font-family: var(--font-ar); }`. The portal sign-in heading escapes "Headings use Serif Display 700". → R3 / D5.

**A3.** `[P2] (confidence: 8/10)` `netlify.toml` `from = "/*"  to = "/index.html"  status = 200`. A missing font gets HTML with a 200 and a silent fallback to a system font. Required proof of the accepted contract, carried forward without a question: `check-bundles` resolves CSS `url()`s in all three dists.

No other architecture issues:
- The CSP is unchanged: `default-src 'self'` covers same-origin fonts, and Tauri has `csp: null`.
- No new origin.
- Desktop and web share `src/main.tsx`.
- Distribution: the Tauri bundle carries `dist-desktop` as-is; no release-script change.

### R2: Where the Thmanyah files live and how every build gets them (PD1)
- **Finding:** A1. `[P1] (confidence: 9/10)`. Evidence: `server/src/app.ts:124`, `:311–330`; `vite.config.ts` `hostedConfig()` `publicDir`. Reviewer: Claude (native).
- **Plan baseline:** PD1, original proposal: move the 5 `.otf` files to `src/assets/fonts/` and bundle them. Not approved.
- **Runtime evidence:**
  - The portal's public dir excludes `public/`.
  - The portal serves non-`/assets/` paths with `no-store`.
  - Vite copies imported assets byte-for-byte under hashed names. This is standard Vite asset handling, and the build's `check-bundles` proves it via sha256.
  - Netlify serves `public/` as-is.
  - Desktop uses `base: "./"`.
- **Comparison grid:**

| Choice | Current | A | B | C |
|---|---|---|---|---|
| R2 font location | `public/fonts/` (untracked, now committed per D3); nothing references them | move the 5 `.otf` to `src/assets/fonts/`; relative `url()`; hashed under `/assets/` in all 3 builds; portal immutable via the existing rule; no server change | keep them in `public/fonts/`; `url(/fonts/…)`; a hosted-mode Vite plugin copies them into `dist-hosted/fonts/` and serves them in dev; `server/src/app.ts` adds `Cache-Control: public, max-age=86400` for `/fonts/*` | keep them in `public/fonts/`; a hosted copy plugin; no server change, so the portal re-downloads about 1 MB per full load (`no-store`) |
| Preload href | pending (PD9) | hashed: plugin lookup via `originalFileNames` | static `/fonts/thmanyahsans-Regular.otf` | static `/fonts/thmanyahsans-Regular.otf` |
| MUT-106 PDF registration | — | `?url` import from `src/assets/fonts` | `/fonts/…` | `/fonts/…` |
| R1 kit commit | approved (D3 = A) | same | same | same |
| D1 / D2 | approved | same | same | same |

**Question D4:**
D4 — Where should the Thmanyah font files live so that the app, landing, desktop and portal all load them efficiently?
Project/branch/task: MUT-102 Brand v2 foundation, planned from main.
ELI10: Basel put the fonts in `public/fonts`. The web and desktop builds can serve them from there. The portal can't: it has its own public folder, and its server marks everything outside `/assets/` as never-cache. Moving the same files, byte for byte, into `src/assets/fonts` lets the build stamp them with a version hash and put them under `/assets/` in all three builds. The portal server already caches that path forever.
Stakes if we pick wrong: Either portal users re-download about 1 MB of fonts on every visit, or we add a copy plugin plus a server cache rule, and still can't cache forever because the file names never change.
Recommendation: A because one bundling mechanism serves all three builds with forever-caching and needs no server or copy-plugin code.
Completeness: A=10/10, B=9/10, C=5/10
Pros / cons:
A) Bundle from src/assets/fonts (recommended)
  ✅ All three builds get hashed, cache-forever font files through one mechanism, with no server change
  ✅ Matches the kit's own precedent: the marks in src/assets/brand are bundled for the same reason
  ❌ Moves files Basel placed; the kit README, MUT-106 and MUT-77 notes must say src/assets/fonts
B) Public path + copy plugin + server cache
  ✅ Files stay where Basel put them, and the preload link is a fixed path
  ✅ The portal caches fonts for a day instead of never
  ❌ Adds a copy plugin and a server cache rule; caching can never be immutable, since names never change
C) Public path, no server change
  ✅ Smallest code change, and files stay in public/fonts
  ✅ The web and desktop builds behave the same as A
  ❌ The portal re-downloads about 1 MB of fonts on every full page load (no-store)
Net: one bundling path with forever-caching, against keeping Basel's file location at the cost of extra plumbing or portal bandwidth.
**Header:** Font location
**Options:**
A) Bundle from src/assets/fonts (recommended)
Move the 5 Thmanyah .otf files (bytes unchanged) to src/assets/fonts and reference them by relative url() in fonts.css. They emit hashed under /assets/ in web, desktop and portal, and the portal's existing rule caches them immutably. The preload uses the plugin lookup. Update the kit README asset map and comment on MUT-106 (`?url` import) and MUT-77. Human ~2h / CC ~10 min.
B) Public path + copy plugin + server cache
Keep them in public/fonts with url(/fonts/…). Add a hosted-mode Vite plugin that copies them into dist-hosted/fonts and serves them in dev. Add `Cache-Control: public, max-age=86400` for /fonts/* in server/src/app.ts, with a server test. The preload link is static. Human ~4h / CC ~20 min.
C) Public path, no server change
Keep them in public/fonts and add only the hosted copy plugin. The portal serves fonts with no-store, so they re-download about 1 MB on every full load. Human ~3h / CC ~15 min.

- **State:** approved
- **Actual answer:** A) "Bundle from src/assets/fonts (recommended)" (Basel, D4, 2026-10-12)
- **Accepted scope:**
  - Move the 5 Thmanyah `.otf` files, bytes unchanged, from `public/fonts/` to `src/assets/fonts/`. Reference them by relative `url()` in `src/styles/brand/fonts.css`. They emit hashed under `/assets/` in all three builds, and the portal's existing `/assets/*` rule caches them immutably.
  - The preload href comes from the `brandFontPreload()` lookup via `originalFileNames`.
  - Update the `docs/brand/README.md` asset map.
  - Comment on MUT-106 (register with `?url` imports from `src/assets/fonts`) and MUT-77 (the files moved).
  - No server change.
- **History:** none

### R3: The portal sign-in heading face (A2)
- **Finding:** A2. `[P2] (confidence: 8/10)` `src/hosted/hosted.css:141` `font-family: var(--font-en);` and `:146` `[dir="rtl"] .hp-signin-card h1 { font-family: var(--font-ar); }`. Reviewer: Claude (native).
- **Plan baseline:** the original proposal is silent. The AC "Headings use Serif Display 700" is proved only on app `h1`/`h2`.
- **Runtime evidence:** `.hp-signin-card h1` sets its family explicitly, so the base `h1 { font-family: var(--font-heading) }` rule in `theme.css` never applies to it. The portal sign-in heading is the portal's only `h1` on the sign-in page (MUT-43 layout).
- **Comparison grid:**

| Choice | Current | A | B |
|---|---|---|---|
| R3 portal sign-in heading face | Thmanyah Sans via `--font-en` / `--font-ar`, weight 600 (renders 700) | `.hp-signin-card h1` → `var(--font-heading)`, RTL → `var(--font-heading-ar)`, weight `--weight-bold`; the portal spec asserts Serif Display 700 in EN and AR | unchanged; the heading AC is proved on app + landing only; the portal heading is noted for MUT-91 |
| R1 / R2 / D1 / D2 | approved | same | same |

**Question D5:**
D5 — Should the portal's sign-in heading switch to the new serif heading face in this ticket?
Project/branch/task: MUT-102 Brand v2 foundation, planned from main.
ELI10: Every heading is meant to use the new Thmanyah Serif Display at bold weight. The portal's sign-in card overrides its heading to use the body font instead, so after this ticket it would show the new body font, not the new heading font. The fix is two lines in the portal stylesheet, plus a check in the portal test.
Stakes if we pick wrong: The one page every portal user sees first doesn't match the app's and landing page's headings, and the acceptance criterion is only true for two of three products.
Recommendation: A because it is a two-line change that makes the heading criterion true in every build, and MUT-43's layout and wording stay untouched.
Completeness: A=10/10, B=7/10
Pros / cons:
A) Serif heading on portal sign-in (recommended)
  ✅ The acceptance criterion holds in the app, landing and portal, proved in EN and AR by the portal spec
  ✅ Two lines of CSS; MUT-43's sign-in layout, states and wording are unchanged
  ❌ Touches a portal file MUT-91 also edits, so the two must merge in order
B) Leave it for MUT-91
  ✅ MUT-102 doesn't touch portal component styles at all
  ✅ MUT-91 can decide portal typography in one pass with its other portal work
  ❌ The portal sign-in heading ships in the body font, unlike every other heading
Net: two lines now for a consistent first impression, against leaving all portal component styling to MUT-91.
**Header:** Portal heading
**Options:**
A) Serif heading on portal sign-in (recommended)
In src/hosted/hosted.css, `.hp-signin-card h1` uses `var(--font-heading)` and the RTL rule uses `var(--font-heading-ar)`, at `--weight-bold`. qa/specs/portal/signin.spec.ts asserts the computed family is Thmanyah Serif Display at weight 700, in EN and AR. Human ~20 min / CC ~3 min.
B) Leave it for MUT-91
hosted.css is unchanged. The heading AC is proved on the app and landing only, and the plan notes the portal sign-in heading as MUT-91 scope with a Jira comment. Human ~5 min / CC ~1 min.

- **State:** approved
- **Actual answer:** A) "Serif heading on portal sign-in (recommended)" (Basel, D5, 2026-10-12)
- **Accepted scope:** `src/hosted/hosted.css`:
  - `.hp-signin-card h1` uses `font-family: var(--font-heading)` and `font-weight: var(--weight-bold)`;
  - `[dir="rtl"] .hp-signin-card h1` uses `var(--font-heading-ar)`;
  - `qa/specs/portal/signin.spec.ts` asserts that the computed family starts with "Thmanyah Serif Display" and that the weight is 700, in EN and AR.
- **History:** none

## 2. Code quality review — findings

**CQ1.** `[P2] (confidence: 9/10)` `src/components/examples/ThemeDemo.tsx:169` `<h3 …>Source Serif 4 — The quick brown fox jumps</h3>`, `:174` `Inter — …`, and `:179` `IBM Plex Sans Arabic — …`. The page is routed at `/theme-demo` (`src/router.tsx:179`), so after the change the labels name faces that are gone. **Carried forward** without a question, as the documentation of the approved font change: rename the labels.

**CQ2.** `[P2] (confidence: 9/10)` The layout tokens are defined twice, with identical values:
- `src/styles/theme.css:76–80` `--sidebar-width: 240px; --topbar-height: 56px; --drawer-width: 480px; --table-row-height: 44px;`
- `src/index.css:15–18` (which wins, because it is imported later).

No change in MUT-102, since the values are identical. TD-079 records it, so MUT-103's density re-tune edits one copy.

**CQ3.** `[P2] (confidence: 8/10)` The `--accent-text` guard must match `color:` only as a whole property, with `(?<![-\w])color\s*:\s*var\(--accent\)`. It must not match `border-color`, `--accent-text` or `--accent-solid`, and it covers the TSX inline form `color: 'var(--accent)'`. Required proof detail of the approved PD3, carried forward.

**CQ4.** `[P3] (confidence: 7/10)` The alias collapse means `xs` and `sm` are both 13, and `base`, `md` and `lg` are all 16, so some label/value contrast goes. This was accepted by Basel's brand-scale decision (memory `brand-v2-decisions` #3). Not re-opened; risk 1 and TD-079 cover it.

Dispositions: CQ1 carried forward; CQ2 recorded in TD-079 (no code change); CQ3 carried forward; CQ4 no change (prior decision).

## 3. Test review

Framework: Vitest (jsdom default, `// @vitest-environment node` per file) plus Playwright via release-qa (`qa/`). `CLAUDE.md` has no `## Testing` command section; commands come from `package.json`. Existing tests read: `scripts/__tests__/check-bundles.test.ts` (rule and origin units) and `scripts/__tests__/vite-config.test.ts` (web/desktop snapshot, hosted assertions).

```
CODE PATHS                                                   USER FLOWS
[+] src/styles/theme.css (rewrite)                           [+] Landing EN/AR × light/dark
  ├── semantic map × 4 states       [GAP] brand›tokens          ├── [GAP][→E2E] Thmanyah renders, no CDN request
  ├── per-mode shadows/overlay/scheme [GAP] brand›tokens        ├── [GAP][→E2E] axe color-contrast
  ├── reduced-motion token block    [GAP] brand›tokens          └── [GAP][→E2E] h1 + inner <span> = Serif 700 (TD-048 font half)
  ├── html:lang() font scope        [GAP] brand›tokens       [+] App Home/Clients split/Income/drawer/Settings
  ├── h1–h6 = Serif Display 700     [GAP][→E2E]                 ├── [GAP][→E2E] × EN/AR × 375/1280: no overflow
  └── names every component uses    [GAP] CRITICAL → R4         ├── [GAP][→E2E] × light/dark: axe color-contrast
[+] brand/mutaba3a-theme.css == tokens.json [GAP] brand›drift   └── [★★ TESTED] full axe, light: home/clients/income/settings specs
[+] brand/fonts.css + src/assets/fonts  [GAP] brand›fonts    [+] Theme toggle Light→Dark→System (forced vs OS)
[+] entries: no retired @fontsource      [GAP] brand›fonts      ├── [★★ TESTED] data-theme attribute: ThemeToggle.test.tsx
[+] vite.config.ts                                              └── [GAP][→E2E] CSS tokens follow it → R4
  ├── brandFontPreload lookup hit/miss/dev [GAP] vite-config [+] Portal sign-in EN/AR × light/dark
  ├── web/desktop snapshot          [★★ TESTED] update on purpose ├── [GAP][→E2E] fonts, heading 700 (D5), axe
  ├── hosted plugin list            [★★ TESTED] :49–53            └── [GAP][→E2E] /v1 stubbed 401 → sign-in renders
  └── workbox font runtimeCaching   [GAP] vite-config        [+] Desktop offline
[+] check-bundles: hashes, url()s (×3), preload, retired     │   └── [GAP] manual tauri dev + url() proof
      [GAP] check-bundles.test (pure fns) + test:bundles     [+] PWA offline after first visit
      origins                       [★★★ TESTED] :47–56      │   └── [GAP] unit config assert + one manual offline check
[+] accent-text guard               [GAP] brand›guard        [+] Error: font missing → silent fallback
[+] hosted.css sign-in h1 (D5)      [GAP][→E2E] portal spec       └── covered by url()-resolve + document.fonts.check

COVERAGE: 4/27 paths tested today (15%) | planned tests close every GAP except the 2 manual checks
QUALITY: ★★★:1 ★★:3 ★:0 | GAPS: 23 (13 E2E)
```
Legend: ★★★ behavior + edge + error | ★★ happy path | ★ smoke | [→E2E] needs a browser

**T1.** `[P1] (confidence: 9/10)` **Regression risk: no test catches a token that the 4→1 rewrite drops.** Evidence: 48 `var(--…)` references without a fallback point at tokens defined nowhere today, for example:
- `src/components/ui/ProfileContextChip.css` → `--foreground`, `--surface-alt`;
- `src/components/filters/SearchInput.tsx` → `--color-text-muted`;
- `src/components/ui/RowActionsMenu.css` → `--danger`;
- `src/components/ui/ErrorBoundary.css` → `--color-bg-base`.

The scan was a python sweep of `src/**/*.{css,ts,tsx}`, excluding tests, matching definitions `--x:`, `'--x':` and `setProperty('--x'` against references `var(--x)`. Today nothing would fail if the rewrite lost `--shadow-inset` or `--input-border-hover`. → R4 / D6.

**T2.** `[P2] (confidence: 9/10)` PD11 placeholder contrast, computed as OKLCH mixes:
- `ink2` 70% toward `field-bg` = **3.61:1**, which fails even AA;
- 80% = 4.49:1;
- full `ink2` = 7.04:1.

The plan's "mix toward field-bg" needs a floor. → R5 / D7.

**Computed for the record:** `--accent-solid-hover`, `primary-hover` mixed with `ink` (85/75%), gives `on-primary` 7.72 / 8.12:1 in light and 9.09 / 9.48:1 in dark. PD3's hover and active states hold AAA.

### R4: Regression contract for the theme.css rewrite (T1)
- **Finding:** T1. `[P1] (confidence: 9/10)`, as above. Reviewer: Claude (native).
- **Plan baseline:** the original proposal proves only the ACs: token values in 4 states, contrast, fonts, axe and layout. Its "every `var()` resolves" check covers references *inside theme.css* only.
- **Runtime evidence:** 48 dead references exist today, with no test. `ThemeToggle.test.tsx` proves the `data-theme` attribute, not that CSS follows it.
- **Comparison grid:**

| Choice | Current | A | B | C |
|---|---|---|---|---|
| R4 regression contract | none | (1) **names test:** every custom property defined in today's `theme.css` is still defined after the rewrite (list frozen in `brand.test.ts`); (2) **reference guard:** every no-fallback `var(--x)` in `src/**/*.{css,ts,tsx}` resolves to a definition, with today's 48 dead refs in an explicit shrink-only allowlist that MUT-103 burns down; (3) **Playwright:** ThemeToggle Light→Dark→System under OS light and OS dark makes the computed `--bg` equal the expected canvas in each of the 4 states, and a `:focus-visible` button has a non-`none` box-shadow | (1) names test only | none beyond the AC tests |
| Intentional changes | — | colours, faces, sizes, radii and shadows, plus the `--accent-text` sweep, all as approved | same | same |
| R1–R3, D1, D2 | approved | same | same | same |
| R5 placeholder | pending | pending | pending | pending |

**Question D6:**
D6 — How should we prove the theme rewrite doesn't silently break styling that components rely on?
Project/branch/task: MUT-102 Brand v2 foundation, planned from main.
ELI10: theme.css goes from four copies of every colour to one. If the rewrite forgets a token, say the inset shadow, every component that uses it quietly loses that style, and no test notices. Today there are already 48 references to tokens that don't exist anywhere; each one fails silently today. The fuller contract freezes the list of token names, blocks any new reference to a missing token (allowing the 48 known ones, which MUT-103 cleans up), and checks in a real browser that the theme switch still changes the colours in all four light/dark states.
Stakes if we pick wrong: A dropped token ships as a missing border, shadow or colour on some screen. Nobody notices until a user does, and the next dead reference joins the silent 48.
Recommendation: A because it is the only option that catches a dropped or misspelled token anywhere in the app, and it turns the 48 silent failures into a shrinking, owned list.
Completeness: A=10/10, B=6/10, C=3/10
Pros / cons:
A) Names + reference guard + browser (recommended)
  ✅ Catches a dropped token, a misspelt token and a broken theme switch, each with its own failing test
  ✅ Freezes the 48 dead references as a shrink-only list that MUT-103 must empty
  ❌ The reference scanner needs care (runtime-set vars, var() fallbacks), about 60 more test lines
B) Names test only
  ✅ Catches any token the rewrite drops, with a 10-line frozen-list test
  ✅ No scanner, no allowlist upkeep
  ❌ New dead references and typos keep failing silently, and the theme switch is never proved in a browser
C) AC tests only
  ✅ No extra tests beyond what the ticket already demands
  ✅ The fastest path to green
  ❌ A dropped token ships unnoticed; the 48 dead references stay invisible
Net: one scanner plus a browser check now, against trusting the rewrite to keep every name by hand.
**Header:** Regression proof
**Options:**
A) Names + reference guard + browser (recommended)
`brand.test.ts`:
- **names:** freeze every custom-property name defined in today's `theme.css`; each must still be defined after the rewrite.
- **reference guard:** every no-fallback `var(--x)` in `src/**/*.{css,ts,tsx}` (tests excluded) must resolve to a definition from CSS, a TSX `'--x'` key or `setProperty`. Today's 48 dead refs sit in a shrink-only allowlist, and the test also fails if an allowlisted ref becomes defined (forcing its removal). MUT-103 empties the list.

Playwright: under OS light and OS dark, ThemeToggle Light/Dark/System gives the expected computed `--bg` in all 4 states, and a `:focus-visible` button has a box-shadow ring. Human ~4h / CC ~20 min.
B) Names test only
`brand.test.ts` freezes today's `theme.css` custom-property names and requires each to stay defined after the rewrite. No reference scanner and no browser theme-switch check. Human ~45 min / CC ~5 min.
C) AC tests only
Only the tests the ticket's acceptance criteria require. A dropped token or a new dead reference is caught only if axe or a layout check happens to notice it. Human 0 / CC 0.

- **State:** approved
- **Actual answer:** A) "Names + reference guard + browser (recommended)" (Basel, D6, 2026-10-12)
- **Accepted scope:**
  - **`brand.test.ts` › `names`:** a frozen list of every custom-property name defined in today's `theme.css`. Each must still be defined after the rewrite.
  - **`brand.test.ts` › `references`:** every no-fallback `var(--x)` in `src/**/*.{css,ts,tsx}` (tests excluded) resolves to a definition: a CSS `--x:`, a TSX `'--x'` key or `setProperty('--x'`. Today's 48 dead refs sit in a shrink-only allowlist, and the test fails if an allowlisted ref becomes defined.
  - **Playwright:** under OS light and OS dark, ThemeToggle Light/Dark/System gives the expected computed `--bg` in all 4 states, and a `:focus-visible` button has a non-`none` box-shadow.
  - **Jira:** comment on MUT-103 that emptying the allowlist is its job.
- **History:** none

### R5: Placeholder contrast floor (PD11, T2)
- **Finding:** T2. `[P2] (confidence: 9/10)`. Computed from the OKLCH primitives:
  - `ink2` 70% toward `field-bg`: 3.61:1;
  - 80%: 4.49:1;
  - 85%: **5.02:1 light / 4.66:1 dark**;
  - 90%: 5.62 / 5.06;
  - full `ink2`: 7.04:1.

  Reviewer: Claude (native).
- **Plan baseline:** PD11, original proposal: the placeholder is exempt from 7:1 and mixes `ink2` toward `field-bg`, with no floor stated. Not approved.
- **Runtime evidence:** axe's `color-contrast` rule does not evaluate `::placeholder`, so no browser test would catch a too-faint placeholder.
- **Comparison grid:**

| Choice | Current | A | B |
|---|---|---|---|
| R5 placeholder colour | `#9CA3AF` (old palette) | `color-mix(in oklch, var(--m-ink2) 85%, var(--m-field-bg))`: ≥ 4.5:1 on `--input-bg` in both modes, asserted in `brand.test.ts`; exempt from 7:1, recorded in ADR-058 | `var(--m-ink2)`: 7.04:1, no exemption; placeholders look like typed values |
| R1–R4, D1, D2 | approved | same | same |

**Question D7:**
D7 — How dark should placeholder text in empty fields be?
Project/branch/task: MUT-102 Brand v2 foundation, planned from main.
ELI10: Placeholder text is the grey hint in an empty field, like "Client name". The brand asks for very high contrast (7:1) on text. If placeholders are that dark, they look like something the user already typed. The plan's softer mix had no lower limit, and one version of it measured 3.6:1, too faint even for the basic standard. Pinning the mix at 85% gives about 5:1 in light and 4.7:1 in dark: clearly a hint, still readable, and checked by a test.
Stakes if we pick wrong: Too faint, and people with low vision can't read the hints. Too dark, and people think a field is already filled in and skip it.
Recommendation: A because it keeps hints distinguishable from typed values while a test guarantees they never drop below the 4.5:1 baseline.
Completeness: A=10/10, B=8/10
Pros / cons:
A) Softer hint with a 4.5:1 floor (recommended)
  ✅ Hints read as hints, and a unit test holds them at ≥ 4.5:1 in light and dark
  ✅ The one exemption from 7:1 is written down in ADR-058, not hidden
  ❌ Placeholders miss the brand's 7:1 target, the only text that does
B) Full-contrast placeholder
  ✅ Every text colour meets 7:1, with no exemption to document
  ✅ The simplest token mapping: placeholder = ink2
  ❌ Empty fields look pre-filled; hint text and typed text share one colour
Net: a readable but distinct hint with one documented exemption, against no exemption at the cost of empty fields looking filled.
**Header:** Placeholder
**Options:**
A) Softer hint with a 4.5:1 floor (recommended)
`--placeholder: color-mix(in oklch, var(--m-ink2) 85%, var(--m-field-bg))`. `brand.test.ts` asserts ≥ 4.5:1 against `--input-bg` in all 4 states. ADR-058 records the placeholder as the only exemption from 7:1. Human ~15 min / CC ~2 min.
B) Full-contrast placeholder
`--placeholder: var(--m-ink2)`, 7.04:1 on `field-bg`. No exemption; the contrast test includes the placeholder in the 7:1 light-pair list. Human ~5 min / CC ~1 min.

- **State:** approved
- **Actual answer:** A) "Softer hint with a 4.5:1 floor (recommended)" (Basel, D7, 2026-10-12)
- **Accepted scope:**
  - `--placeholder: color-mix(in oklch, var(--m-ink2) 85%, var(--m-field-bg))`.
  - `brand.test.ts` › `contrast` asserts `placeholder` on `input-bg` is ≥ 4.5:1 in all 4 states.
  - ADR-058 records the placeholder as the only exemption from 7:1.
- **History:** none

## Test Plan artifact
Saved: `~/.gstack/projects/vAWK3-mutaba3a/basel-main-eng-review-test-plan-20261012-145926.md`. It has no pending test decisions.

Section 3 dispositions:
- T1: accepted (D6 = A).
- T2: accepted (D7 = A).
- The web/desktop config snapshot is updated on purpose (carried forward).

## 4. Performance review — findings

**P1.** `[P2] (confidence: 9/10)` First-visit font bytes rise.
- **Today:** `dist-web/assets` holds **40 woff2 files, 892 KB**. The browser fetches only the subsets a page needs (estimated ~0.35 MB).
- **After:** Thmanyah Sans 400/500/700 + Serif Display 700 = 241,292 + 242,116 + 242,808 + 247,296 = **973,512 bytes**, plus Plex Mono's Latin woff2. That is about **+0.65 MB on a first visit**.
- The licence forbids woff2 conversion and subsetting, and Basel accepted that cost (memory `brand-v2-decisions` #4).
- The plan's mitigations stand: preload 400 only, `swap`, hashed immutable caching in the portal, and the LCP before/after record.
- Disposition: accepted, no change.

**P2.** `[P3] (confidence: 9/10)` The service-worker install gets **lighter**. Today all 40 woff2 (892 KB) sit in the precache manifest (`dist-web/sw.js`: 40 `woff2` entries). After, only Plex Mono's woff2 remain precached, and Thmanyah is cached at runtime on first use (PD10). Net precache drops by roughly 0.7 MB. Info only.

**P3.** `[P3] (confidence: 7/10)` `netlify.toml` has no `[[headers]]` block, so hashed `/assets/*` (JS, CSS and now fonts) are revalidated on every visit. Each is a 304 round-trip, not a re-download. This predates the ticket. → TODO question D8.

No N+1, memory or unbounded-cache issues: CSS custom properties and `color-mix` resolve at style time, and the runtime font cache is capped (12 entries).

## Outside voice
`CODEX_MODE: not_installed`. The native fallback needs TaskOutput and TaskStop. TaskOutput isn't available in this session, so: **outside voice unavailable**, logged as `codex-plan-review` `unavailable`. No cross-model tension to resolve.

## TODOS.md decisions

### R6: TODO: immutable cache headers for hashed `/assets/*` on Netlify (P3)
- **Finding:** P3. `[P3] (confidence: 7/10)` `netlify.toml`: only `[build]` and `[[redirects]]` blocks, no `[[headers]]`. Reviewer: Claude (native).
- **Plan baseline:** listed under "Out of scope". Not approved as work.
- **Runtime evidence:** Netlify's default for static files is a revalidating cache (platform default; not probed live here). Every hashed asset costs a conditional request per page load.
- **Comparison grid:**

| Choice | Current | A | B | C |
|---|---|---|---|---|
| R6 Netlify `/assets/*` caching | revalidated each load (pre-existing) | TODO item #7 in `TODOS.md` (P3) | no TODO; keep the out-of-scope note only | build in MUT-102: `[[headers]] for = "/assets/*"` → `Cache-Control: public, max-age=31536000, immutable` |
| R1–R5, D1, D2 | approved | same | same | same |

**Question D8:**
D8 — Should we track a follow-up to let browsers cache the web build's hashed files forever?
Project/branch/task: MUT-102 Brand v2 foundation, planned from main.
ELI10: Every file the web build produces under /assets/ has a fingerprint in its name, so it never changes. Today Netlify still makes the browser ask "has this changed?" on every visit, once per file. With the new fonts, that's a few more of those checks per page. One header rule would let browsers skip them. The problem existed before this ticket and also affects every JavaScript and CSS file.
Stakes if we pick wrong: Either a small, known speed-up gets forgotten, or the brand ticket picks up a hosting change that affects every file the app serves.
Recommendation: A because it is cheap and worth doing, but it changes caching for every asset, not just fonts, so it deserves its own small change and check.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Add to TODOS.md (recommended)
  ✅ The speed-up is recorded with its exact fix, so it isn't lost
  ✅ The brand diff stays free of hosting changes that affect every JS/CSS file
  ❌ Repeat visitors keep paying one revalidation round-trip per asset until someone picks it up
B) Skip
  ✅ No new item to track; a 304 per asset is cheap enough
  ✅ Nothing changes in hosting or in this plan
  ❌ The cheap fix stays undocumented, and the next person rediscovers it
C) Build it in MUT-102
  ✅ Repeat visits stop revalidating fonts, JS and CSS right away
  ✅ Four lines in netlify.toml, verifiable with one curl after deploy
  ❌ Widens a brand ticket into a hosting change for every asset, with its own rollout risk
Net: write it down for later, against ignoring it or folding a site-wide caching change into the brand work.
**Header:** Asset cache
**Options:**
A) Add to TODOS.md (recommended)
Add item 7 to TODOS.md: "Immutable cache headers for hashed /assets/* on Netlify", with What/Why/Pros/Cons/Context/Depends-on, the exact `[[headers]]` block, and P3. No change to MUT-102's scope. Human ~10 min / CC ~2 min.
B) Skip
No TODO. The out-of-scope note in the plan stays as the only record. Human 0 / CC 0.
C) Build it in MUT-102
Add `[[headers]] for = "/assets/*"` with `Cache-Control = "public, max-age=31536000, immutable"` to netlify.toml in MUT-102, and verify the header with curl on the next deploy preview. Human ~30 min / CC ~5 min.

- **State:** approved
- **Actual answer:** Other: "file it in jira" (Basel, D8, 2026-10-12). This is the intent of A (track it, don't build it in MUT-102), with Jira as the destination instead of `TODOS.md`.
- **Accepted scope:**
  - Created as **MUT-108** (Task, Low), linked "relates to" MUT-102.
  - No `TODOS.md` edit.
  - No change to MUT-102's scope.
- **History:** none

Approval readiness: PASS. Accepted remedies, each with its own answer:
- R1 (D3 = A);
- R2 (D4 = A);
- R3 (D5 = A);
- R4 (D6 = A);
- R5 (D7 = A);
- R6 (D8 = Other, "file it in jira", filed as MUT-108);
- scope D1 (font half only, direction half filed as MUT-109);
- structure D2 (smaller arrangement).

Carried forward without a question, as required proof or documentation of approved behaviour:
- A3: `url()` resolution in all 3 dists;
- CQ1: ThemeDemo labels;
- CQ3: the guard regex;
- the deliberate `vite-config` snapshot update.

## NOT in scope
- **TD-048 direction half:** MUT-109. The brand diff stays visual-only and reversible (D1).
- **Netlify immutable `/assets/*` headers:** MUT-108. This predates the ticket and affects every asset (D8).
- **Emptying the 48 dead-`var()` allowlist:** MUT-103's sweep. MUT-102 only freezes it (D6).
- **Duplicate layout tokens** (`theme.css` vs `index.css`): recorded in TD-079 for MUT-103's density re-tune (CQ2).
- **h4–h6 in Serif Display at 16–20px:** built to the AC. Basel judges the screenshots (risk 2).
- **Input-border non-text contrast** (`line` on `canvas` 1.19:1): TD-080. Not an AC.

## What already exists (reused, not rebuilt)
- `src/styles/brand/mutaba3a-theme.css` and `mutaba3a.tokens.json` are the primitives and the canonical values. They are reused; PD7 only trims the mapping block.
- `scripts/check-bundles.ts` and `bundle-rules.ts` are extended (fonts, `url()`s, preload), not replaced. The origin allowlist is untouched.
- `qa/support/axe.ts` `expectOnlyKnownAxeViolations` is reused for the dark-mode loops; only the known list shrinks.
- `vite.config.ts` `emitHostedEntryAsIndex()` is the precedent for an inline plugin (D2).
- `@fontsource/ibm-plex-mono` is kept, and now reaches the portal through `fonts.css`.
- Workbox `runtimeCaching` and Rollup `originalFileNames` are verified built-ins (Layer 1).
- No shared-code extraction was proposed or accepted.

## Failure modes

| New path | Realistic failure | Test / handling | User sees |
|---|---|---|---|
| `fonts.css` → `/assets/*.otf` | the file is renamed or missing; Netlify answers 200 with `index.html` | `check-bundles` resolves every `url()` (A3); Playwright `document.fonts.check` | a system-font fallback; caught in CI, not silent |
| `brandFontPreload()` | the asset lookup misses after a rename | the plugin throws at build time; `check-bundles` asserts the preload target exists | build fails loudly |
| one semantic block × 4 states | a token works under OS dark but not under forced dark | `brand.test.ts` 4-state evaluator + Playwright ThemeToggle `--bg` (D6) | wrong colours; caught in CI |
| the 4→1 rewrite | a token components use is dropped | `brand.test.ts` › `names` + `references` (D6) | missing border, shadow or colour; caught in CI |
| PWA runtime font cache | the rule is misconfigured, so offline falls back to system fonts | `vite-config.test.ts` asserts the rule; one manual offline check | system font offline; config is tested |
| bundled fonts in the portal | the cache rule doesn't match | the existing `/assets/*` immutable rule (`server/src/app.ts:311–330`), unchanged | extra downloads only |

**Critical gaps:** 0.

## Worktree parallelization strategy

| Step | Modules touched | Depends on |
|---|---|---|
| Kit commit (D3) | main: `docs/`, `src/styles/brand/`, `src/assets/brand/`, `public/` | — |
| Tokens | `src/styles/`, `src/test/css/` | Kit commit |
| Fonts + build plumbing | `src/assets/fonts/`, `src/styles/brand/`, `vite.config.ts`, `scripts/`, entries, `package.json` | Kit commit |
| Component sweep | `src/components/`, `src/pages/`, `src/hosted/` (CSS only) | Tokens (`--accent-text` must exist) |
| QA specs | `qa/` | Tokens + Fonts |

Tokens and Fonts both edit `src/styles/theme.css` (the `@import`s and the font tokens), and the routine is one fresh worktree per ticket (memory `apple-design-pass-state`). **Sequential implementation, no parallelization opportunity.** Order: Kit commit → Tokens → Fonts → Component sweep → QA specs.

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; check each box as you ship.

- [ ] **T1 (P1, human: ~10min / CC: ~2min)**: repo, commit the Brand v2 kit on main before cutting the worktree.
  - Surfaced by: Scope Challenge, SC2 / R1 (D3).
  - Files: `docs/brand/`, `src/styles/brand/`, `src/assets/brand/`, `public/fonts/{thmanyah*,IBMPlexMono*}`, the `public/` icon edits and deletions.
  - Verify: `git show --stat HEAD` on main; `git worktree add` sees `src/styles/brand/`.
- [ ] **T2 (P1, human: ~2h / CC: ~10min)**: fonts, bundle Thmanyah from `src/assets/fonts`.
  - Surfaced by: Architecture, A1 / R2 (D4).
  - Files: `src/assets/fonts/*.otf` (moved), `src/styles/brand/fonts.css`, `docs/brand/README.md`, Jira comments on MUT-106 and MUT-77.
  - Verify: `brand.test.ts` › `fonts` (sha256 pins); `npm run test:bundles` (dist == source in 3 dists).
- [ ] **T3 (P1, human: ~4h / CC: ~20min)**: tests, the regression contract.
  - Surfaced by: Test review, T1 / R4 (D6).
  - Scope: the frozen token-name list; the no-dead-`var()` guard with a shrink-only allowlist of the 48; the Playwright 4-state ThemeToggle `--bg` check and the `:focus-visible` ring; a Jira comment on MUT-103.
  - Files: `src/test/css/brandCss.ts`, `src/styles/__tests__/brand.test.ts`, `qa/specs/web/brand.spec.ts`.
  - Verify: `npx vitest run src/styles` (Node 22); QA web project.
- [ ] **T4 (P2, human: ~20min / CC: ~3min)**: portal, sign-in heading in Serif Display 700.
  - Surfaced by: Architecture, A2 / R3 (D5).
  - Files: `src/hosted/hosted.css`, `qa/specs/portal/signin.spec.ts`, `qa/qa.config.mjs` (portal app).
  - Verify: the portal QA project in EN and AR.
- [ ] **T5 (P2, human: ~15min / CC: ~2min)**: tokens, the placeholder at 85% `ink2` with a 4.5:1 floor.
  - Surfaced by: Test review, T2 / R5 (D7).
  - Files: `src/styles/theme.css`, `brand.test.ts` › `contrast`, ADR-058.
  - Verify: `npx vitest run src/styles`.
- [ ] **T6 (P2, human: ~1h / CC: ~8min)**: build, `check-bundles` resolves CSS `url()`s in all 3 dists.
  - Surfaced by: Architecture, A3 (carried forward).
  - Files: `scripts/check-bundles.ts`, `scripts/bundle-rules.ts`, `scripts/__tests__/check-bundles.test.ts`.
  - Verify: `npm run test:bundles`; a unit test with a missing-file fixture.
- [ ] **T7 (P2, human: ~30min / CC: ~5min)**: build, the deliberate `vite-config` snapshot update.
  - Surfaced by: Test review (snapshot `:34`).
  - Add asserts: the font `runtimeCaching` is CacheFirst; `globPatterns` has no `otf`; the hosted plugins include `mutaba3a:brand-font-preload`.
  - Files: `scripts/__tests__/vite-config.test.ts` (+ snapshot).
  - Verify: `npx vitest run scripts`.
- [ ] **T8 (P2, human: ~45min / CC: ~5min)**: tokens, the `--accent-text` guard regex and the 42 + 5 sweep.
  - Surfaced by: Code quality, CQ3.
  - Files: `brand.test.ts` › `accent-text guard`, the component CSS/TSX.
  - Verify: the guard fails on an injected `color: var(--accent)` and passes on `border-color`.
- [ ] **T9 (P3, human: ~5min / CC: ~1min)**: docs, the ThemeDemo specimen labels name the new faces.
  - Surfaced by: Code quality, CQ1.
  - Files: `src/components/examples/ThemeDemo.tsx`.
  - Verify: visit `/theme-demo`.
- [ ] **T10 (P3, human: ~10min / CC: ~2min)**: knowledge, amend TD-048 (font half resolved, direction → MUT-109) and note the duplicate layout tokens in TD-079.
  - Surfaced by: Scope D1, Code quality CQ2.
  - Files: `.claude/TECH_DEBT.md`.
  - Verify: read back.

## Unresolved decisions
None. D1–D8 are all answered.

## Completion summary
- Step 0: Scope Challenge: **scope reduced per recommendation** (D1: TD-048 direction half → MUT-109).
- Architecture Review: 3 issues found (A1, A2, A3).
- Code Quality Review: 4 issues found (CQ1–CQ4).
- Test Review: diagram produced, 23 gaps identified (the planned tests close all but 2 manual checks), plus 2 findings (T1, T2).
- Performance Review: 3 issues found (P1–P3).
- NOT in scope: written.
- What already exists: written.
- TODOS.md updates: 1 item proposed. Basel chose to file it in Jira instead: MUT-108.
- Failure modes: 0 critical gaps flagged.
- Unresolved decisions: 0 in this review.
- Outside voice: Codex not installed; the native fallback is unavailable (no TaskOutput in this session); logged as unavailable.
- Parallelization: 5 steps, 0 parallel / 5 sequential (the Tokens and Fonts steps share `theme.css`).
- Lake Score: 5/6. D3, D4, D5, D6 and D7 picked 10/10 options; D1 picked 8/10. D2 and D8 differ in kind.

## Suppressed findings (appendix: below the confidence bar)
- (4/10) Thmanyah Sans line metrics may clip Arabic descenders in fixed-height rows (`--table-row-height: 44px`). Not verified: no rendering probe. The 375/1280 AR screenshots will show it.
- (4/10) Hono `serveStatic`'s MIME map may lack `font/otf`, so it would serve `application/octet-stream`. Browsers still load fonts without `nosniff`. Not probed; check once with `curl -I` on the portal.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex (plan-review, via `/plan-eng-review`) | Independent 2nd opinion | 1 | unavailable | Codex not installed; no native fallback (TaskOutput missing) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN (all mapped to tasks) | 12 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase: unavailable (not installed; the native fallback needs TaskOutput, which is absent). No outside findings.
- **VERDICT:** no review is CLEAR. The Eng Review is ISSUES OPEN: its 12 findings are dispositioned and mapped to T1–T10, with nothing unresolved. Eng review required.

NO UNRESOLVED DECISIONS

---

# Build notes — /eng-build, 2026-10-12

Commits on `feature/mut-102-brand-foundation` (from main `530aec2`), in plan order: fonts move + pin → token harness → `theme.css` rewrite → entries, preload, PWA and `check-bundles` → `--accent-text` sweep → AC-surface fixes → QA specs → knowledge. Every unit's tests were written first and seen failing for the right reason.

**Numbers used:** ADR-058; TD-079 (MUT-103's sweep), TD-080 (border non-text contrast), TD-081 (landing LCP), TD-082 (portal sign-in `region`), TD-083 (phone-width layout).

**Found during the build (beyond the plan):**
- **Dead references were 49, not 48.** One more had arrived since the review. The avatar fix below removed `--color-accent`, so the allowlist is 48 again.
- **Amounts were not in Plex Mono.** The plan's proof read `owed-now-amount` and `currency-amount`, but neither set a face (only table `.amount-cell`s did). `--font-mono` was added to the three shared amount components (owed-now at weight 500: Plex Mono ships no 700, so bold would be faked), and the spec checks Home, Income and Clients amounts. The ~40 ad-hoc amount classes are TD-079 / MUT-103. `currency-amount` only renders in the recurring-expenses list (an optional area), so the spec reads the core surfaces' amounts instead.
- **Axe, with contrast enforced, found component problems on AC surfaces**, fixed per the plan (literal on an AC surface → fix it here):
  - the profile avatar's dead `var(--color-accent)` (white on nothing, 1.04:1; TD-009's "profile avatar");
  - the Mac banner button (white on the dark-mode accent);
  - a global `.text-muted` leaking from `CSVValidationPreview.css` (slate #94a3b8, italic, app-wide once the chunk loads);
  - the landing get-it links (`link-in-text-block`: purple next to purple-grey ink is under 3:1 apart).
- **Headings that ask for semibold** compute 600 but are drawn with Serif Display's Bold file (risk 3). The spec checks weight ≥ 600 and that the 700 face is loaded.
- **The `vite-config` snapshot was already failing on main**: the release bumps to 0.0.66/0.0.67 changed the embedded version. While updating it on purpose, the version is masked so the next release doesn't break it.
- **Phone width was already broken on main** (TD-083): the sidebar never collapses, Income is ~680px wide, drawers are 480px. Measured on a main build; the layout spec annotates those two overflows and fails on any other. Screens for review: 375/1280 × EN/AR attached to the QA run.
- **Axe on a moving drawer** reads washed-out colours; `expectOnlyKnownAxeViolations` now waits until no dialog carries inline opacity/transform and no finite animation is running.
- **Dev-server QA was flaky** (Vite optimising deps broke lazy chunks under 4 workers); the QA runs used `vite preview` builds via a gitignored throwaway config.

**Guardrails, measured:**
- **LCP** (landing, `vite preview`, Fast 3G 1444/675 kbps, 562.5 ms RTT, 4× CPU, 5 cold runs; LCP element = the subheadline): main 4088, 4088, 4116, 4116, 4204 → **median 4116 ms**; Brand v2 4716, 4716, 4744, 4756, 4824 → **median 4744 ms** (+628 ms). Font bytes by then: 180 KB → 236 KB. Reported, not gated → TD-081.
- **PWA offline:** after one online visit the `fonts` cache holds four Thmanyah faces, and an offline reload renders Thmanyah Sans.
- **Reduced motion:** unit-tested tokens; `drawer-motion.spec.ts` passes.
- **Desktop offline:** `check-bundles` proves every `dist-desktop` CSS `url()` resolves locally and the preload is relative. The manual `npm run tauri dev` with the network off was **not run**.
- **Licence:** the Serif Display files are still the copies MUT-105 flags as third-party; re-download from Thmanyah's official site and re-pin `THMANYAH_SHA256` once.

# Review round — /qa-reconcile + gstack /review, 2026-10-12

**What the reviewers ran:** five specialists (testing, maintainability, performance, design, simplification), a red team, and an in-host adversarial pass. Codex isn't installed, so there was no outside model.

**The headline finding:** the 7:1 light-text AC held for token pairs but not for the rules components render. The browser axe check is AA only, so it passed 5.52:1 purple-on-lavender everywhere.

**Owner decisions:**
- **D1 = "Blockers + regressions":** fix everything this branch caused or that breaks an AC surface; defer the app-wide sweeps.
- **D2 = "Drop the preload":** this reverses the ticket's "preload Thmanyah Sans 400" guardrail. LCP medians: high-priority preload 4664 ms, low 4356 ms, none 3964 ms; main 4116 ms.

**Fixed (with tests, each red first):**
- new tokens `--on-accent-subtle`, `--on-status` and `--focus-ring-on-fill`;
- about 40 component rules;
- avatars, through `profileAvatarStyle()`;
- the Clients pane focus ring;
- oklab blends and capped tints;
- no faked bold;
- index.css no longer sets the body face; the mono stack falls back to Thmanyah; `:visited` scoped;
- a CSS syntax error;
- pins moved to one JSON;
- the preload removed.

**Deferred** (TD-079 → MUT-103, TD-084–088):
- amounts to mono, for `tnum` and ₪;
- AAA in the browser;
- the PWA first-visit cache;
- the Safari 16.2 floor;
- heading sizes;
- user colour inks;
- bundle checks on the ship paths;
- Serif Display provenance.

**Advisory, not applied:**
- `postcss.list.comma` could replace the harness's own `splitTopLevel`;
- hex/rgb parsing stays, because the rendered-pairs check reads literals.

