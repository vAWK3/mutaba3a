# MUT-104 — Brand v2 icons and browser chrome

Status: planned + eng-reviewed 2026-10-13 (D1–D7, ledger below) · Epic MUT-101 · Relates MUT-77 (landing header wordmark — not here)
Blockers: none (MUT-102 Done). Jira: Backlog.

## Problem (verified against main a48f72d)

| Surface | Today |
|---|---|
| `index.html`, `hosted.html` | SVG favicon only. No PNG fallback, no apple-touch-icon, no theme-color. |
| `public/favicon.svg` (+ hosted copy) | **Broken as delivered**: the tile is `<rect class="t">` with no `<style>`, so it renders **black** (`rsvg-convert` sample at the tile edge = `#000000`). It also carries a C2PA manifest blob (~7.8 KB of 8.2 KB). |
| PWA manifest (`vite.config.ts`) | `theme_color` / `background_color` `#070C16`; `includeAssets` lacks the PNG favicons and apple-touch. Not covered by any test (the web snapshot reduces plugins to names). |
| `src-tauri/icons/*` | January set (navy tile, teal check). Unused leftovers: `android/`, `ios/`, the 383 KB `icon-1024.png`. |
| Sidebar (`SidebarNav.tsx:186-195`) | `<img src="/icons/icon-512.png">`, same in light and dark. |
| Portal `Wordmark` (`src/hosted/components/Brand.tsx`) | Text only. Used by `HostedShell`, `SignInPage`, `BootScreens`. |
| Landing social meta | None. Landing and app share `index.html` (landing at `/`, app at `/app/`). |

Delivered art facts that shape the plan:
- `icon-1024.png` is full-bleed (rounded tile edge to edge, transparent corners). Apple's macOS grid wants the tile at 824 px inside 1024 (100 px margin). Used as-is, the Dock icon is ~24% larger than every neighbour.
- PNG tile colour is `#FBF1D8` (not the canvas `#FCF6ED`). `mark-dark.svg` swaps the orange to `#F9B379` and the purple dot to butter `#F3E5B0`.
- `og-mark-1200.png` is **square** 1200×1200, not the 1.91:1 card most platforms show large.

## Plan

### 1. Heads (static HTML)
- `index.html`: SVG favicon + `favicon-32.png` + `favicon-16.png` + `apple-touch-icon` + two `theme-color` metas (`#FCF6ED` light, `#221B2D` dark, by `media`). **No manual `<link rel="manifest">`**: VitePWA injects it in the web build, and the desktop build has no manifest (a manual link would 404 there).
- `hosted.html`: same icons and theme-color. No manifest (portal has no PWA by design).
- Portal files (R2/D3): `hosted.html` links `./public/favicon.svg`, `./public/favicon-32.png`, `./public/favicon-16.png` and `./public/apple-touch-icon.png`, the single copies. `public/` is not the portal's publicDir, so Vite 7 emits them as hashed `/assets/*` files, which the portal server caches immutable. An HTML comment says why. `src/hosted/public/favicon.svg` is deleted.

### 2. Fix `public/favicon.svg` (the only copy after R2)
- Add `<style>`: tile `#FBF1D8` (matches the PNG set); under `@media (prefers-color-scheme: dark)` tile `#221B2D` and the mark's orange/purple switch to `mark-dark.svg`'s fills. Shapes and geometry unchanged.
- If Claude Design's corrected `favicon.svg` (prompt: `mut-104-claude-design-prompt.md`) arrives before the build, use it after the same test passes; otherwise make this fix in code.
- Strip the C2PA manifest from this file only: editing the SVG invalidates its signed claim, so keeping it would ship a false provenance record. `mark.svg` / `mark-dark.svg` stay byte-for-byte as delivered.
- Note: an SVG favicon follows the browser/OS scheme, not the in-app toggle — that is how every browser renders favicons. Safari ignores SVG favicons and uses the PNGs (light tile, readable on both).

### 3. PWA manifest
- Export `PWA_MANIFEST` and `PWA_INCLUDE_ASSETS` from `vite.config.ts` (same pattern as `PWA_WORKBOX`), so they are testable.
- `theme_color` / `background_color` = `#FCF6ED`; `includeAssets` += `favicon-16.png`, `favicon-32.png`, `apple-touch-icon.png`.

### 4. Desktop icons (R1/D2: full-bleed as delivered)
- npm script `icons:desktop`: `tauri icon public/icons/icon-1024.png` (all platforms from the delivered full-bleed art), then delete the unused `src-tauri/icons/android/`, `ios/` and the stale January `icon-1024.png` (no Tauri mobile target; the phone app is Flutter).
- No macOS master and no shell script. On this macOS 26.2 Mac, the Dock is checked after a local build as verification only; a grey box gets reported back, not fixed with a new variant.
- `tauri.conf.json` icon list unchanged.

### 5. BrandMark (shared component)
- `src/components/brand/BrandMark.tsx`: `<img>` of `mark.svg` or `mark-dark.svg` (bundled imports → hashed `/assets/*.svg`, cached by the portal) chosen by `useTheme().resolvedTheme`, so Light / Dark / System (incl. live OS change) all follow ThemeToggle. Decorative (`alt=""`); the parent link/heading carries the name. Props: `size`, `className`.
- Both SVGs are 8.1 KB, above Vite's 4 KB inline limit, so they ship as files: `check-bundles` (scans js/css/html/json) never sees the C2PA namespace, and the portal CSP (`img-src 'self' data:`) allows them.
- Sidebar: replace the PNG `<img>` with `<BrandMark size={28} className="brand-mark" />`; `متابعة` text unchanged; collapsed shows the mark only.
- Portal `Wordmark`: renders `BrandMark` + the existing `hosted.brand` text as a lockup (`.hp-wordmark` becomes `inline-flex` with a gap). Import by direct path, never a barrel (portal bundle rule).

### 6. Social preview (web build only; D1 arrangement, R3/D4 Arabic, R4/D5 square)
- In `vite.config.ts`, beside `emitHostedEntryAsIndex`: an exported pure `socialMetaTags({ origin, title, description, … })` and a `mutaba3a:social-meta` plugin (`transformIndexHtml`). The plugin is added only when `buildMode === "web"`; desktop and portal get no tags.
- Builder: fails fast on a non-`https` origin, normalises the trailing slash, HTML-escapes copy.
- Copy from `ar.json` at build time: `og:title` = `landing.hero.headlineLine1` + " " + `headlineLine2`; `og:description` = `landing.hero.subheadline`; `og:site_name` متابعة; `og:locale` ar_AR, `og:locale:alternate` en_US.
- Image: `<origin>/og-mark-1200.png`, `og:image:width` 1200, `og:image:height` 1200, `og:image:alt`; `twitter:card summary` with matching `twitter:title`, `twitter:description`, `twitter:image`. `og:type website`, `og:url` = origin + `/`.
- Origin: `MUTABA3A_PUBLIC_ORIGIN` env, default `https://mutaba3a.app` (same pattern as `DEFAULT_DEV_API_ORIGIN`; it's already on the bundle-origins allowlist). Documented in `.env.example`.
- New TD: a designed 1200×630 card, then `summary_large_image`. The designer ask is `.claude/designs/mut-104-claude-design-prompt.md`.

### 7. theme-color follows the in-app theme (R5/D6)
- Static metas in both heads are the no-JS default (`#FCF6ED` light, `#221B2D` dark, by `media`).
- `src/lib/theme/`: a DOM-only helper `syncThemeColorMeta(theme)`, called from the ThemeProvider's existing apply effect. An explicit Light or Dark sets both metas to that canvas; System restores light/dark. Hexes come from `tokens.json` (`color.canvas.hex`, `colorDark.canvas.hex`). It does nothing if the metas are absent, and calls no setState. App and portal both get it through the shared provider.

## Tests (written first)

| File | Proves |
|---|---|
| `scripts/__tests__/vite-config.test.ts` (new `describe('brand chrome (MUT-104)')`) | Manifest colours equal `tokens.json` `color.canvas.hex`; every manifest icon and include asset exists in `public/` with PNG IHDR dimensions equal to its `sizes`; includes favicons + apple-touch. Web/desktop snapshot updated **once, deliberately** (new plugin name). |
| `scripts/__tests__/brand-head.test.ts` | Both heads link svg + 32 + 16 + apple-touch; `index.html` hrefs resolve in `public/` and `hosted.html` hrefs resolve to `public/` files via `./public/`, with PNG IHDR sizes matching; theme-color metas equal the light/dark canvas from tokens; no manual manifest link; `src/hosted/public/favicon.svg` is gone; **every `class` used in `favicon.svg` has a style rule** (the black-tile regression), a dark-scheme rule exists, and there is no C2PA. |
| `scripts/__tests__/vite-config.test.ts` › `social meta (MUT-104)` | Absolute `og:image` from origin; slash normalisation; rejects `http:`/garbage; escapes `<"&`; copy equals the `ar.json` keys; `twitter:card summary` with 1200×1200; the plugin is present in web and absent in desktop/hosted. |
| `src/lib/theme/__tests__/themeColorMeta.test.ts` | Explicit Dark under OS light: both metas `#221B2D`; explicit Light: both `#FCF6ED`; System restores light/dark; values equal `tokens.json`; no metas present → no throw. |
| `src/components/layout/__tests__/SidebarNav.brand.test.tsx` (R6/D7) | Regression contract: the brand link goes to `/` with accessible name متابعة; expanded shows the name and the mark; collapsed hides the name and keeps the mark; the mark follows the theme. |
| `src/hosted/components/__tests__/Brand.test.tsx` (R6/D7) | Regression contract: `Wordmark` renders the `hosted.brand` text in EN and AR, with a decorative mark (`alt=""`). |
| `src/components/brand/__tests__/BrandMark.test.tsx` | Light → `mark.svg`; Dark → `mark-dark.svg`; System follows `matchMedia` and switches on its `change`; decorative alt. |
| `src-tauri` icon check (in `brand-head.test.ts` or own file) | Every `tauri.conf.json` bundle icon exists; PNG dims match filenames; `android/`, `ios/` gone. |
| QA catalog `qa/features/web/brand.yaml` + `qa/features/portal/*` | New: favicon light/dark tab, mark follows Light/Dark/System, manifest icons, OG tags present in the built `dist-web/index.html`. |

Commands: `npm run lint && npm run typecheck && npm run test && npm run build && npm run test:bundles` (Node 22 via nvm — see memory).

## Manual verification (cannot be automated here)
- macOS Dock + `.dmg`: `npm run tauri build` locally, screenshot the Dock beside Finder/Safari.
- Windows taskbar + MSI/NSIS: from the `build-windows.yml` CI artifact on a Windows machine — **Basel**.
- iOS Add to Home Screen: iOS Simulator Safari against a local `vite preview`.
- OG debugger: needs the deployed public URL (opengraph.xyz / LinkedIn Post Inspector). Claude cannot deploy, so this AC closes after Basel's next web release.

## Knowledge updates
ADR (next free — verify, expected ADR-071): social meta at build time from translations + `MUTABA3A_PUBLIC_ORIGIN`; macOS icon master padded to Apple's grid; favicon C2PA stripped. CHANGELOG, COMPONENT_REGISTRY (`BrandMark`), TEST_PLAN, TECH_DEBT (OG image shape if square kept; Windows check pending), `docs/brand/README.md` asset map (desktop row no longer "January set", OG wired, favicon fix), `.env.example`.

## Out of scope
Landing header wordmark (MUT-77). iPhone app icons (MUT-105). Token sweep (MUT-103).

---

# Eng review (plan-eng-review, 2026-10-13)

Target: `.claude/designs/mut-104-brand-chrome.md` (the plan above, unchanged as drafted). Reviewer: Claude (native). Outside voice: Codex not installed.

## Scope record
feature answers: no cuts proposed; structure: B "Smaller arrangement" (D1, Basel, 2026-10-13); accepted scope: all six plan areas unchanged; the social-meta tag builder and its `transformIndexHtml` plugin live in `vite.config.ts` beside `emitHostedEntryAsIndex`, exported for tests like `PWA_WORKBOX` (no `scripts/social-meta.ts`); desktop regeneration is an npm script, with a shell file only if a separate macOS master survives R1; pending remedies: R1 (macOS icon master), R2 (portal icon delivery), R3 (OG language), R4 (OG image shape), R5 (theme-color follows the in-app toggle).
Scope Challenge result: scope accepted as-is (the smaller arrangement keeps scope).

## Scope Challenge findings
1. [P1] (confidence: 7/10) plan §4 "Build a macOS master … `-resize 824x824 … -extent 1024x1024`": macOS 26 Tahoe puts an app icon that has a transparent margin, or that doesn't match its squircle, inside a grey box (9to5Mac 2025-08-08, heise 11075561, Xojo forum 86527). This Mac runs macOS 26.2, and the app's floor is Apple Silicon, so most users are likely on Tahoe. The padded master would probably cause the grey box the AC is meant to avoid. Current runtime: the January `.icns` (navy, full canvas), not checked on Tahoe. Reviewer: Claude.
2. [P2] (confidence: 9/10) plan §1 "copy … into `src/hosted/public/`": prior learning applied, mutaba3a-portal-cache-only-assets (confidence 10/10, from 2026-10-12): the portal server sends `no-store` on everything except `/assets/*`. Vite 7.3.6 bundles `<link rel="icon|apple-touch-icon">` hrefs as hashed files and never inlines them (`node_modules/vite/dist/node/chunks/config.js:23833`, `noInlineLinkRels`). So `hosted.html` could link one source copy and get immutable caching, with no duplicates. Reviewer: Claude.
3. Search check: `tauri icon` 2.11.2 supports `-o/--output` (probed); `transformIndexHtml` is a Vite built-in hook [Layer 1]; Icon Composer `.icon` → `Assets.car` (Liquid Glass) needs Xcode's `actool`, and no source confirms Tauri can bundle it, so it is not in scope [Layer 1, deferred].
4. TODOS.md: nothing open blocks or overlaps this plan.

## Decision ledger

### R1: macOS icon master
Finding: Scope 1, P1, confidence 7/10, plan §4, Claude
Plan baseline: original proposal: an 824/1024 padded master for `.icns`; the full-bleed delivered art for everything else.
Runtime evidence: the January set ships today. Tahoe grey-box behavior is sourced, not reproduced on this Mac (unknown for this art).
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1 macOS `.icns` source | padded 824 master (proposal) | decided by a Dock test on this Mac during the build: three variants, screenshots, Basel picks; remedy stays pending until then | full-bleed delivered art, single `tauri icon` call | padded 824 master as planned |
| Windows/other icons | full-bleed delivered | unchanged | unchanged | unchanged |
| R2–R5 | pending | pending | pending | pending |
Question D2: see the AskUserQuestion of the same number (copied verbatim when sent).
Header: macOS icon
Options:
A) Test on Tahoe first (recommended)
Build the .app three times: delivered full-bleed, full-bleed with opaque corners (tile colour), padded 824. Screenshot the Dock on this macOS 26.2 Mac, then you pick. Bounded to those three variants; the pre-Tahoe look stays your check. Human ~2h / CC ~30min.
B) Full-bleed as delivered
One `tauri icon public/icons/icon-1024.png` call for every platform. Likely right on Tahoe if its corners don't trip the grey box; about 24% oversized next to pre-Tahoe Dock icons. Human ~15min / CC ~5min.
C) Padded master as planned
The 824/1024 master for `.icns`. Right on macOS 12–15; sourced reports say Tahoe boxes it in grey. Human ~30min / CC ~10min.

State: approved
Actual answer: B "Full-bleed as delivered" (D2, Basel, 2026-10-13)
Accepted scope: `npm run icons:desktop` = `tauri icon public/icons/icon-1024.png`, then delete the unused `src-tauri/icons/android`, `ios` and stale `icon-1024.png`. No macOS master and no shell script. The Dock is checked on this Tahoe Mac as manual verification only (a grey box gets reported back, not a new variant).
History: none

### R2: portal icon delivery
Finding: Scope 2, P2, confidence 9/10, plan §1, Claude (prior learning mutaba3a-portal-cache-only-assets)
Plan baseline: original proposal: copy `favicon-16/32.png` + `apple-touch-icon.png` into `src/hosted/public/`, with a byte-equality test; `favicon.svg` stays duplicated there.
Runtime evidence: the portal serves `src/hosted/public` files with `no-store` (server/src/app.ts). Vite 7.3.6 emits `<link rel=icon|apple-touch-icon>` hrefs as hashed, never-inlined files (config.js:23833).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R2 portal icon files | copies in `src/hosted/public` + byte test (proposal) | `hosted.html` links `./public/favicon*.{svg,png}` and `./public/apple-touch-icon.png`, the one copy the web build already serves. `public/` is not the portal's publicDir, so the portal build emits them as hashed `/assets/*` files (cached immutable). An HTML comment says why. `src/hosted/public/favicon.svg` is deleted. Test: every `hosted.html` icon href resolves under `public/` | copies + byte-equality test, as planned |
| R1 | approved B | unchanged | unchanged |
| R3–R5 | pending | pending | pending |
Header: Portal icons
Options:
A) Link single public/ copy (recommended)
hosted.html links ./public/favicon*.{svg,png} and ./public/apple-touch-icon.png. public/ is not the portal's publicDir, so the portal build emits them as hashed /assets/* files (cached immutable); an HTML comment says why. Delete src/hosted/public/favicon.svg. Test: every hosted.html icon href resolves under public/. Human ~30min / CC ~5min.
B) Copies + byte-equality test
Copy favicon-16/32.png and apple-touch-icon.png into src/hosted/public beside the existing favicon.svg copy; a test asserts every copy is byte-equal to public/. Served no-store by the portal. Human ~30min / CC ~5min.

State: approved
Actual answer: A "Link single public/ copy" (D3, Basel, 2026-10-13)
Accepted scope: column A of the grid. `hostedConfig().publicDir` stays `src/hosted/public` (it may now be empty; Vite tolerates that). The existing vite-config assertion is unchanged. Verify `dist-hosted` emits hashed icon files and that `test:bundles` passes.
History: none

## Section 1 — Architecture findings
1. [P2] (confidence: 9/10) plan §6 "Copy comes from the translation files": no language is named. `index.html:7` `<title>متابعة</title>` sits under `<html lang="en">`. Crawlers run no JS, so the card has exactly one language. → R3
2. [P2] (confidence: 9/10) `public/og-mark-1200.png` is "PNG image data, 1200 x 1200" (`file`). `summary_large_image` and Facebook/LinkedIn large cards are 1.91:1, so a square image is cropped or shown as a small thumbnail. → R4
3. [P3] (confidence: 8/10) `docs/brand/head-snippet.html` theme-color uses `media="(prefers-color-scheme: …)"` only, while `src/lib/theme/context.tsx:73-82` sets an explicit `data-theme`. A forced Dark under OS light paints a cream Safari tab bar or PWA title bar over the dark app. → R5
4. Note, no decision: `/app/*` shares `index.html`, so it carries the OG tags too; harmless. Desktop and portal builds get none (the plugin is gated on `buildMode === "web"`).

### R3: social card language
Finding: Section 1 #1, P2, confidence 9/10, plan §6, Claude
Plan baseline: original proposal: copy from `landing.hero.*` keys; language unspecified.
Runtime evidence: there is no OG meta today. The landing picks en/ar from localStorage or `navigator.language` (`src/lib/i18n/core.tsx:69`); crawlers get the static HTML.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R3 card language | unspecified | Arabic: `ar.json` hero copy, `og:locale ar_AR`, alternate `en_US` | English: `en.json` hero copy, `og:locale en_US`, alternate `ar_AR` | Bilingual title (`متابعة · Mutaba3a`), English description, `og:locale en_US`, alternate `ar_AR` |
| R1, R2 | approved | unchanged | unchanged | unchanged |
| R4, R5 | pending | pending | pending | pending |
Header: Card language
Options:
A) Arabic (recommended)
Card copy from ar.json hero keys (headline lines + subheadline), og:locale ar_AR with alternate en_US.
B) English
Card copy from en.json hero keys, og:locale en_US with alternate ar_AR.
C) Bilingual title
Title 'متابعة · Mutaba3a' plus the English headline; English subheadline as description; og:locale en_US with alternate ar_AR.

State: approved
Actual answer: A "Arabic" (D4, Basel, 2026-10-13)
Accepted scope: `og:title` = `ar` `landing.hero.headlineLine1` + " " + `headlineLine2`; `og:description` = `ar` `landing.hero.subheadline`; `og:site_name` متابعة; `og:locale` ar_AR, `og:locale:alternate` en_US; `twitter:*` mirror these. Test: the tags equal `ar.json` values.
History: none

### R4: social image shape
Finding: Section 1 #2, P2, confidence 9/10, `public/og-mark-1200.png`, Claude
Plan baseline: original proposal: `og:image` = `og-mark-1200.png` (1200×1200); `twitter:card` unspecified.
Runtime evidence: the delivered OG image is square; there is no 1.91:1 asset.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R4 image + card | square, card type unspecified | square as delivered, `twitter:card summary`, `og:image:width/height` 1200/1200 | derive `public/og-card-1200x630.png` from the delivered art (`magick og-mark-1200.png -resize 630x630 -background '#FBF1D8' -gravity center -extent 1200x630`; a layout change only, no redraw), `twitter:card summary_large_image`, width/height 1200/630; square kept as an extra `og:image` | square + `summary` now; log a TD and ask the designer for a 1200×630 card with the wordmark and tagline |
| R1–R3 | approved | unchanged | unchanged | unchanged |
| R5 | pending | pending | pending | pending |
Header: OG image
Options:
A) Derived wide card (recommended)
Derive public/og-card-1200x630.png (mark resized to 630, extended on #FBF1D8 to 1200x630; no redraw); twitter:card summary_large_image; og:image width/height 1200/630; square kept as a second og:image. Human ~30min / CC ~5min.
B) Square, small card
og:image = og-mark-1200.png with width/height 1200/1200 and twitter:card summary. Human ~10min / CC ~2min.
C) Square now, ask designer
Ship the square with twitter:card summary; log a TD and ask the designer for a 1200x630 card with wordmark and tagline. Human ~10min / CC ~2min, plus design time.

State: approved
Actual answer: C "Square now, ask designer" (D5, Basel, 2026-10-13)
Accepted scope: `og:image` = `<origin>/og-mark-1200.png`, `og:image:width` 1200, `og:image:height` 1200, `og:image:alt` (Arabic product name), `twitter:card summary`, `twitter:image` the same. New TD: a designed 1200×630 card (wordmark + tagline), then switch to `summary_large_image`. No derived image ships.
History: none

### R5: theme-color follows the in-app theme
Finding: Section 1 #3, P3, confidence 8/10, `src/lib/theme/context.tsx:73-82`, Claude
Plan baseline: original proposal: two static metas by `prefers-color-scheme` (`#FCF6ED` / `#221B2D`).
Runtime evidence: there is no theme-color meta today. The ThemeProvider sets or removes `data-theme` on `<html>` and is used by the app and the portal (`src/hosted/HostedApp.tsx:18`).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R5 theme-color behavior | OS scheme only (static metas) | static metas as the no-JS default. The ThemeProvider's apply effect also rewrites both metas' `content`: an explicit Light or Dark sets both to that canvas; System restores light/dark. Canvas hexes are read from `tokens.json` (`color.canvas.hex`, `colorDark.canvas.hex`), not re-typed. Unit test in `src/lib/theme/__tests__` | static metas only, as planned |
| R1–R4 | approved | unchanged | unchanged |
Header: theme-color
Options:
A) Follow the in-app switch (recommended)
Keep the static metas as the no-JS default; ThemeProvider's apply effect rewrites both metas' content (explicit Light/Dark: both = that canvas; System: restore light/dark). Hexes read from tokens.json. Unit test in src/lib/theme/__tests__. Human ~1h / CC ~10min.
B) OS setting only
Two static theme-color metas by prefers-color-scheme, as in docs/brand/head-snippet.html. Human ~5min / CC ~1min.

State: approved
Actual answer: A "Follow the in-app switch" (D6, Basel, 2026-10-13)
Accepted scope: column A. A DOM-only helper (no setState, so the react-hooks v7 set-state-in-effect rule isn't tripped) is called from the existing apply effect. If no theme-color meta exists, it does nothing.
History: none

Note (2026-10-13, Basel's request mid-review): the designer ask for R4 is written as `.claude/designs/mut-104-claude-design-prompt.md`. It requests the Arabic 1200×630 card (English optional) and a corrected `favicon.svg`. R4's accepted scope is unchanged until Basel says otherwise: the square ships now, and a TD tracks the card.

## Section 2 — Code quality findings
1. [P3] (confidence: 9/10) Shared code: `BrandMark` has two verified callers, `src/components/layout/SidebarNav.tsx:186-195` (`<img className="brand-mark" src="/icons/icon-512.png">`) and `src/hosted/components/Brand.tsx:5-7` (text-only `Wordmark`). Same behavior: pick the mark by resolved theme. Destination `src/components/brand/BrandMark.tsx`; the portal imports it by direct path, never a barrel. About +25 implementation lines, −10 removed. Accepted as the plan's own scope; no extra decision.
2. Note: `SidebarNav.tsx:186` `aria-label="متابعة"` is hard-coded, not i18n. Pre-existing and out of scope; left as is.
3. Note: `tokens.json` imported at runtime by the theme-color helper costs a little bundle size. Named JSON imports tree-shake per top-level key (`color`, `colorDark`), about 2–3 KB. Acceptable; no decision.
No new decisions from Section 2.

## Section 3 — Test review
Regression risk (IRON RULE): the plan rewrites the sidebar brand link and the portal `Wordmark`, and **no existing test covers either** (`grep` over `*.test.ts(x)` for brand-mark / brand-name / Wordmark / hosted.brand finds nothing). → R6

### R6: regression contract for the brand link and Wordmark
Finding: Section 3, CRITICAL regression coverage, confidence 9/10, `SidebarNav.tsx:184-201`, `Brand.tsx:5-7`, Claude
Plan baseline: original proposal: "existing tests updated" (none exist).
Runtime evidence: the sidebar brand is `<Link to="/" aria-label="متابعة">`, and its name span is hidden when collapsed. `Wordmark` renders `t('hosted.brand')` with the class `hp-wordmark`, in HostedShell, SignInPage and BootScreens.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R6 regression contract | none | Preserve: the brand link goes to `/` with accessible name متابعة; collapsed hides the name text and keeps the mark; `Wordmark` still renders the `hosted.brand` text (EN and AR), with the mark marked decorative. Intentional change: the PNG becomes `BrandMark`. Tests: `SidebarNav` brand tests (expanded and collapsed) + `Brand.test.tsx` | Rely on the QA catalog (Playwright) only; no unit regression tests |
| R1–R5 | approved | unchanged | unchanged |
Header: Regression
Options:
A) Unit tests pin contract (recommended)
Preserve: brand link to / with accessible name متابعة; collapsed hides name, keeps mark; Wordmark renders hosted.brand text (EN + AR) with a decorative mark. Intentional change: PNG to BrandMark. Tests: SidebarNav brand tests (expanded + collapsed) + Brand.test.tsx. Human ~1h / CC ~10min.
B) QA catalog only
No unit regression tests; rely on the Playwright QA catalog entries for the sidebar and portal sign-in. Human ~0 / CC ~0 extra.

State: approved
Actual answer: A "Unit tests pin contract" (D7, Basel, 2026-10-13)
Accepted scope: column A, written red-first before the components change.
History: none

### Coverage diagram (planned code paths vs planned tests)
```
CODE PATHS                                              USER FLOWS
[+] vite.config.ts                                      [+] Browser tab
  ├── PWA_MANIFEST colours = tokens canvas  [★★★ PLAN]    ├── [★★ PLAN] favicon light tile / dark tile (QA catalog) [→E2E]
  ├── manifest icons + includeAssets exist,               └── [★★ PLAN] Safari PNG fallback (manual)
  │   IHDR = sizes                           [★★★ PLAN]  [+] Install
  ├── socialMetaTags()                                    ├── [MANUAL] iOS Add to Home Screen → apple-touch (Simulator)
  │   ├── https origin ok / http + garbage throw [★★★]    └── [★★ PLAN] PWA manifest served with new colours (dist check)
  │   ├── trailing slash normalised           [★★★]     [+] Theme switch
  │   └── escapes < " &                       [★★★]       ├── [★★★ PLAN] mark Light/Dark/System + live OS change
  └── plugin only when buildMode=web          [★★★]       └── [★★★ PLAN] theme-color follows Light/Dark/System
[+] index.html / hosted.html                            [+] Sharing
  ├── icon links resolve, sizes match         [★★★]       └── [MANUAL] OG debugger after deploy (Basel)
  ├── theme-color metas = tokens              [★★★]     [+] Desktop
  └── no manual manifest link                 [★★ ]       ├── [MANUAL] macOS Dock on Tahoe (local build)
[+] favicon.svg every class styled, dark rule [★★★]       └── [MANUAL] Windows taskbar + MSI/NSIS (Basel, CI artifact)
[+] BrandMark (resolvedTheme → svg)           [★★★]
[+] syncThemeColorMeta (explicit/system/absent) [★★★]
[+] SidebarNav brand link (R6 contract)       [★★★]
[+] Wordmark lockup EN/AR (R6 contract)       [★★★]
[+] tauri.conf icons exist + dims; android/ios gone [★★]
COVERAGE (planned): 15/15 automated code paths; user flows 4/9 automated, 5 manual by nature
GAPS: none automatable left; 5 manual checks listed under Manual verification
```
Value cards:
- favicon class/style test. Value: protects=every class in favicon.svg has a style rule and a dark rule; fails_when=the delivered black-tile bug returns; why_new=nothing parses the SVG today; seam=none
- manifest test. Value: protects=manifest colours equal tokens and icons exist at their declared size; fails_when=a colour drifts or an icon is renamed; why_new=the web snapshot reduces plugins to names; seam=PWA_MANIFEST export (precedent PWA_WORKBOX)
- social meta tests. Value: protects=absolute https og:image, escaped Arabic copy, web-only injection; fails_when=origin is relative or http, copy breaks HTML, or desktop gets tags; why_new=new code; seam=exported builder (D1)
- theme-color test. Value: protects=bar colour follows explicit theme; fails_when=sync is removed or System doesn't restore; why_new=new code; seam=none
- R6 regression tests. Value: protects=home link, accessible name, collapsed state, portal name; fails_when=the BrandMark swap drops any of them; why_new=no test covers them today; seam=none
Tests made obsolete: none. The `vite.config` web/desktop snapshot is updated once, deliberately (new plugin name in web only; desktop is unchanged unless the plugin list differs).
Section 3 dispositions: R6 approved (D7). No other gaps.

## Section 4 — Performance
No issues found.
- Runtime: `BrandMark` is one 8.1 KB SVG request per theme, cached (web: precached by the SW `globPatterns` svg; portal: immutable `/assets/*`). The first switch to dark fetches `mark-dark.svg` once; the desktop app reads it locally.
- The theme-color sync is two `setAttribute` calls per theme change.
- Build: the social-meta plugin reads `ar.json` once per web build. The `tokens.json` named import is about 2–3 KB in the app bundle (Section 2 note 3).
- Social card: the square PNG is 51.7 KB.

## Outside voice
Codex CLI not installed (`command -v codex` empty). The native fallback needs TaskOutput/TaskStop, which this session doesn't declare → outside voice **unavailable**. No coverage claimed.

## TODOS.md
No TODOS.md items proposed. Follow-ups go to `.claude/TECH_DEBT.md` per repo convention: the designed 1200×630 OG card (R4), and the Windows taskbar/installer check pending Basel.

## What already exists
- `PWA_WORKBOX` export + `scripts/__tests__/vite-config.test.ts`: the pattern for `PWA_MANIFEST` and `socialMetaTags` (reused).
- `emitHostedEntryAsIndex` (vite.config.ts:17): the in-config plugin pattern (reused).
- `useTheme().resolvedTheme` (`src/lib/theme/context.tsx`): drives `BrandMark` (reused; no new theme state).
- `tokens.json` + `brand.test.ts` drift check: the colour source of truth (reused for manifest, metas, theme-color).
- `tauri icon` CLI 2.11.2: generates every desktop icon (reused; no custom pipeline).
- `scripts/bundle-origins.json` already allows `https://mutaba3a.app`.

## NOT in scope
- Landing header wordmark: MUT-77 (L9) uses the same `mark.svg`.
- iPhone app icons: MUT-105, Flutter repo.
- Liquid Glass `.icon` / `Assets.car` for Tahoe: needs Xcode's `actool`; Tauri support unconfirmed.
- A designed 1200×630 card: requested from Claude Design; TD until it lands.
- i18n of the sidebar's hard-coded `aria-label="متابعة"`: pre-existing.

## Failure modes
| Path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| favicon.svg | style lost on re-export → black tile | class/style test | caught in CI |
| portal icon links | Vite stops bundling `./public/…` hrefs (upgrade) | brand-head href test + `dist-hosted` check in build verification | broken favicon; caught at build |
| social meta | `MUTABA3A_PUBLIC_ORIGIN` set to http or a typo | builder throws (build fails fast) + `test:bundles` origin allowlist | build fails, not a broken card |
| BrandMark | theme context missing (rendered outside the provider) | `useTheme` throws today; both callers sit inside ThemeProvider | dev error, not silent |
| theme-color sync | metas absent (custom HTML) | helper does nothing; test covers it | OS-default bar |
| desktop icons | Tahoe grey box on full-bleed art | manual Dock check | visible in manual QA |
Critical gaps (untested + unhandled + silent): 0.

## Worktree parallelization
Sequential implementation, no parallelization opportunity: one feature branch in one worktree (one worktree per ticket). The heads, manifest and social meta all touch `vite.config.ts` and the two HTML files, and BrandMark/theme-color share `src/lib/theme`.

## Implementation Tasks
- [ ] **T1 (P1, human: ~1h / CC: ~10min)** — heads/favicon — Write `brand-head.test.ts` red; fix `public/favicon.svg` (styles, dark rule, strip C2PA) or drop in the Claude Design file; wire `index.html` + `hosted.html` (`./public/…`, comment); delete `src/hosted/public/favicon.svg`
  - Surfaced by: Problem table (black tile) + R2/D3
  - Files: public/favicon.svg, index.html, hosted.html, src/hosted/public/favicon.svg, scripts/__tests__/brand-head.test.ts
  - Verify: `npm run test:run -- brand-head`; `npm run build:hosted` emits hashed icons
- [ ] **T2 (P1, human: ~1h / CC: ~10min)** — manifest — Export `PWA_MANIFEST` / `PWA_INCLUDE_ASSETS`; colours `#FCF6ED`; add favicons + apple-touch; tests red first
  - Surfaced by: plan §3
  - Files: vite.config.ts, scripts/__tests__/vite-config.test.ts
  - Verify: `npm run test:run -- vite-config`
- [ ] **T3 (P1, human: ~2h / CC: ~15min)** — social meta — `socialMetaTags` + `mutaba3a:social-meta` plugin (web only, Arabic, square, `summary`), `MUTABA3A_PUBLIC_ORIGIN` in `.env.example`; snapshot update
  - Surfaced by: D1, R3/D4, R4/D5
  - Files: vite.config.ts, scripts/__tests__/vite-config.test.ts (+ snapshot), .env.example
  - Verify: tests + `grep og: dist-web/index.html`; `npm run test:bundles`
- [ ] **T4 (P1, human: ~1h / CC: ~10min)** — R6 regression tests — `SidebarNav.brand.test.tsx`, `Brand.test.tsx` written green against current code first
  - Surfaced by: R6/D7
  - Files: src/components/layout/__tests__/SidebarNav.brand.test.tsx, src/hosted/components/__tests__/Brand.test.tsx
  - Verify: pass before and after T5
- [ ] **T5 (P1, human: ~2h / CC: ~15min)** — BrandMark — Component + tests; swap into SidebarNav and Wordmark; CSS lockup
  - Surfaced by: plan §5, Section 2 #1
  - Files: src/components/brand/BrandMark.tsx (+ test), SidebarNav.tsx, src/hosted/components/Brand.tsx, src/hosted/hosted.css, src/index.css
  - Verify: unit tests; preview in light/dark/system, both builds
- [ ] **T6 (P2, human: ~1h / CC: ~10min)** — theme-color — `syncThemeColorMeta` + test; call from the ThemeProvider apply effect
  - Surfaced by: R5/D6
  - Files: src/lib/theme/themeColorMeta.ts, context.tsx, __tests__/themeColorMeta.test.ts
  - Verify: unit test; Safari tab tint with a forced theme
- [ ] **T7 (P1, human: ~1h / CC: ~10min)** — desktop icons — `icons:desktop` npm script, regenerate, delete android/ios/stale 1024; icon existence/dims test; local `tauri build`, Dock screenshot
  - Surfaced by: R1/D2
  - Files: package.json, src-tauri/icons/**, scripts/__tests__/brand-head.test.ts
  - Verify: test + Dock screenshot on macOS 26.2
- [ ] **T8 (P2, human: ~1h / CC: ~15min)** — QA + knowledge — QA catalog entries (web + portal), ADR, CHANGELOG, COMPONENT_REGISTRY, TEST_PLAN, TECH_DEBT (OG card, Windows check), docs/brand/README.md
  - Surfaced by: Knowledge updates + TODOS section
  - Files: qa/features/web/brand.yaml, qa/features/portal/*, .claude/*.md, docs/brand/README.md
  - Verify: lint, typecheck, test, build, test:bundles (Node 22)

Approval readiness: PASS. R1 (D2), R2 (D3), R3 (D4), R4 (D5), R5 (D6), R6 (D7); structure D1. Every accepted remedy cites its own answer.

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is (smaller arrangement, D1)
- Architecture Review: 3 issues found (R3, R4, R5)
- Code Quality Review: 1 issue found (shared BrandMark, accepted in scope) + 2 notes
- Test Review: diagram produced, 1 gap identified (R6 regression contract)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed (2 TECH_DEBT follow-ups)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (CLI not installed; native fallback tools not declared)
- Parallelization: 1 lane, 0 parallel / 8 sequential
- Lake Score: 4/5 (D2, D3, D6, D7 picked the higher-completeness or recommended option; D5 picked 7/10)


## Suppressed findings (appendix)
- (confidence: 4/10) Chrome may apply the page CSP `img-src` to favicon fetches. The portal CSP allows `'self'`, and the icons are same-origin `/assets/*`, so there is no impact expected. Unverified, kept for audit.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex (`/plan-eng-review` outside voice) | Independent 2nd opinion | 1 | unavailable | CLI not installed; native fallback tools not declared |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN (all resolved by D1–D7) | 4 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable (not installed); no native fallback ran. Missing coverage, not clean.
- **VERDICT:** no review CLEAR: the 4 issues found were all resolved by Basel's answers (D1–D7) and folded into the plan. Ready to implement with /eng-build; eng review required status stays ISSUES OPEN by definition (issues_found > 0).

NO UNRESOLVED DECISIONS
