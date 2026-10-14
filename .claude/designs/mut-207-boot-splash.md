# MUT-207 — Web app and portal: branded boot splash before the JS runs, handing off to the loader

**Status**: Planned 2026-10-15 (eng review in `mut-206-brand-loader.md`)
**Ticket**: MUT-207 (Story, Backlog). **Blocked by** MUT-203 (kit) and MUT-206 (`BrandLoader`, `LOADER_DELAY_MS`).
**Relates**: MUT-104 (mark assets, theme-color, the `./public` → `/assets` trick; ADR-073), MUT-205 (the iPhone equivalent: "the mark becomes the loader").
**Epic**: MUT-101.

## Problem

`index.html` and `hosted.html` ship an empty `<div id="root">`. Until the bundle downloads, parses and mounts, the page is the browser default: white, even in dark mode. That lasts several seconds on a cold or slow portal load.

Then a second, different screen appears:
- **Portal**: `CheckingSession`, a 28 px mark plus the "Mutaba3a"/"متابعة" text, which moves up 18 px when the spinner appears at 400 ms.
- **Landing, download, privacy and /hosted**: `LandingLoader`, an unlocalised "Loading...".

The iPhone app gets a native splash (MUT-205); the web gets nothing.

## Facts

| Fact | Consequence |
|---|---|
| `PORTAL_CSP` blocks inline `<style>`, parsed `style=""` and inline `<script>`, and allows `img-src 'self' data:`. | Static markup and attributes only, with linked CSS. |
| **QA runs the Vite dev servers** (web :5173, portal :5175). In dev, CSS imported from `main.tsx` arrives through JS, so a splash styled from the entry CSS would be unstyled before JS in dev and in QA. | The splash gets its **own stylesheet linked from the HTML** (D2). Vite serves it as CSS in dev and emits a hashed `/assets/*.css` in build. |
| Vite rewrites `<img src>` and `<source srcset>` in HTML entries. `./src/assets/brand/mark.svg` becomes the **same** hashed `/assets/mark-*.svg` that `BrandMark` imports. | No new asset. The portal caches it immutable, and the web build's service worker precaches it (svg is in the globs). |
| `index.html` serves `/` (landing), `/download`, `/privacy`, `/hosted` (via the `hosted-offer.html` copy) and `/app/`, and it is the desktop build (`base: "./"`). | The splash shows on all of them, which is wanted: the landing currently shows "Loading...". Relative URLs work offline in Tauri. |
| Before JS the stored theme (`mutaba3a-theme`) and language are unknown, and `<html data-theme>` is set in an effect. | The splash follows `prefers-color-scheme` only, the same rule as the static theme-color metas (ADR-073). It has no text. |
| The `mark.svg` / `mark-dark.svg` art fills its 100×100 viewBox. `BrandLoader`'s frame 0 draws the same mark in the inner 100 of a 120 box. | An 80 px `<img>` matches `BrandLoader size={96}` exactly (D4). |

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Static splash in both heads**: `<div id="root"><div class="boot-splash" aria-hidden="true"><picture><source srcset="./src/assets/brand/mark-dark.svg" media="(prefers-color-scheme: dark)"><img class="boot-splash-mark" src="./src/assets/brand/mark.svg" width="80" height="80" alt=""></picture></div></div>`. React's first render replaces it; no code removes it. | Pure HTML and attributes, so it passes the CSP. `<picture>` picks the dark art with no script. The `width`/`height` attributes give the right size even before the CSS arrives. |
| D2 | **`src/styles/brand/boot-splash.css`**, linked from both heads with `<link rel="stylesheet" href="./src/styles/brand/boot-splash.css">`. It is standalone, about 300 B: `.boot-splash { position: fixed; inset: 0; display: grid; place-items: center; background: #FCF6ED }`, an `@media (prefers-color-scheme: dark)` rule with `#221B2D`, and `html { background: … }` for the same two colours so overscroll matches. A test pins both hexes to `tokens.json` `color.canvas`/`colorDark.canvas`. | It works before JS in dev, QA and production. It sits in `src/styles/brand/`, where literal hexes already live (the primitives file), and a test keeps it in step. It costs one tiny render-blocking request, cached immutable on the portal. |
| D3 | **`BootSplash` React component** (`src/components/brand/BootSplash.tsx`) renders the **identical** markup from imported URLs. It replaces `LandingLoader` (`main.tsx:74`) as the Suspense fallback for `/`, `/download`, `/privacy` and `/hosted`. | Static splash → fallback → page, with no visual change until the page itself paints. One component means one place to keep it in step with the HTML, and a test compares them (Tests 3). |
| D4 | **Portal `CheckingSession` becomes "the mark becomes the loader"**, mirroring MUT-205 D4. It renders inside `.boot-splash`: for the first `LOADER_DELAY_MS` it shows `<BrandMark size={80} />` (the same picture, now from `resolvedTheme`); then `<BrandLoader size={96} delay={0} label={t('hosted.auth.checking')} />`, whose frame 0 is the identical mark, so the swap is invisible. The wordmark text leaves the boot screen. `BootUnreachable` keeps its Wordmark and card. | It removes both the 18 px jump and the text that can't be matched pre-JS (unknown font and language). One look across iPhone, portal and web. |
| D5 | **Web app `/app/`**: no app-side change. The static splash shows until `AppShell` mounts (sidebar plus the blank `BusinessesGate`), which is a full-layout replace, so there is no jump to match. | Keeps scope to the ticket. |
| D6 | **The theme before JS is the OS only.** A user who chose the opposite in-app theme sees the OS-coloured splash for the pre-JS moment, then their theme. **Rejected**: an external `boot-theme.js` that reads `localStorage` before paint. It costs a render-blocking request on every load to fix a sub-second, one-colour mismatch, and the portal (a different origin) rarely has a stored theme. | Matches ADR-073's no-JS default for theme-color. |
| D7 | **ADR-080** records D1, D2, D4 and D6. | DECISIONS.md protocol. |

## Implementation

1. `src/styles/brand/boot-splash.css` (D2).
2. `index.html` and `hosted.html`: add the `<link>` after the theme-color metas, and the splash markup inside `#root`. Add an HTML comment citing MUT-207 and the CSP.
3. `src/components/brand/BootSplash.tsx` (D3), with `markUrl`/`markDarkUrl` imports as in `BrandMark`. `main.tsx`: `LandingLoader` becomes `BootSplash`.
4. `src/hosted/pages/auth/BootScreens.tsx` `CheckingSession` (D4). It imports `LOADER_DELAY_MS` from `BrandLoader` and drops its own constant (MUT-206 already pointed it there).
5. `scripts/check-bundles.ts`: for each built entry HTML (web, desktop, hosted), the `#root .boot-splash` markup is present, and its `<img src>`, `<source srcset>` and stylesheet `href` resolve to files inside the dist. Same shape as the existing "every CSS `url()` resolves" rule.
6. Knowledge files: COMPONENT_REGISTRY (BootSplash), PATTERNS ("First paint is the boot splash; keep `BootSplash.tsx` and the HTML in step"), DECISIONS (ADR-080), CHANGELOG, TEST_PLAN, and the kit README asset map (the splash consumer).

## Tests (TDD: written first)

`scripts/__tests__/brand-head.test.ts` (extend; JSDOM over the raw HTML):
1. Both heads link `./src/styles/brand/boot-splash.css` (the file exists), and `#root` holds exactly one `.boot-splash[aria-hidden=true]` with a `<source media="(prefers-color-scheme: dark)" srcset=…mark-dark.svg>` and an `<img src=…mark.svg width=80 height=80 alt="">`. Both files exist.
2. There is no `style` attribute and no inline `<style>`/`<script>` in either head's body (CSP).
3. **In step**: rendering `<BootSplash />` (via `react-dom/server` `renderToStaticMarkup`) gives the same element tree, classes and attributes as the HTML splash, ignoring the asset URL prefix.
4. `boot-splash.css` holds exactly the canvas hexes from `tokens.json`: light outside the media query, dark inside it.

`src/hosted/pages/auth/__tests__/BootScreens.test.tsx` (new, or extend `auth-states.test.tsx`):
5. Before 400 ms: one decorative `img` (the mark), no `status`, and the container is `.boot-splash`. At 400 ms: `status` named "Checking your session" or "جارٍ التحقق من جلستك", and the img is gone. Under reduced motion the status is still present, with no `animate` children (MUT-206).
6. `auth-states.test.tsx:34-42` stays green. If it asserts the wordmark text in S1, update it to D4 and say so in the PR.

`scripts/check-bundles.ts` rule (Implementation 5), exercised by `npm run test:bundles`.

## QA scenarios (release-QA)

- **`web.brand.boot-splash`** (`qa/specs/web/brand.spec.ts`): *open the app on a slow connection.* With a Playwright context set to `javaScriptEnabled: false` and `colorScheme` light, then dark, load `/app/` and `/`. Expect the canvas colour (`getComputedStyle(body or .boot-splash).backgroundColor`) to equal the token, the mark to be visible with its centre at the viewport centre (±1 px), and `naturalWidth > 0`.
- **`portal.signin.boot-splash`** (`qa/specs/portal/signin.spec.ts`): the same check on the portal root. Then, **hand-off**: in a JS-enabled context with `/v1/me` delayed 3 s, the mark's bounding box once React mounts equals the JS-disabled box (±1 px). After 0.4 s the bloom loader is named "Checking your session". There is no CSP console error.
- Update `portal.signin.boot-slow-session` (added by MUT-206) to D4: the mark first, then the bloom in place, no wordmark text.
- axe runs on the portal boot screen in light and dark.

## Cost and scale

One extra request of about 300 B, render-blocking but tiny, and cached immutable on the portal. The mark SVG is shared with `BrandMark` (one cached file). There is no JS added before first paint. It removes the "Loading..." text loader.

## Build notes

- Worktree `.claude/worktrees/mut-207` on `feature/mut-207-boot-splash`, cut after MUT-206 merges.
- Check `hosted-offer.html` (a copy of the built `index.html`) contains the splash. It should, with no extra work.
- The desktop build: `npm run build:desktop`, then open `dist-desktop/index.html` from disk with JS off to see the splash render from relative URLs.
