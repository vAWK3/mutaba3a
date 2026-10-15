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
5. `scripts/check-bundles.ts`: for each built entry HTML (web, desktop, hosted), the `#root .boot-splash` markup is present, and its `<img src>`, `<source srcset>` and stylesheet `href` resolve to files inside the dist **or are `data:` URIs**. Vite inlines assets under `assetsInlineLimit` (4 KB). `mark.svg` is a file today only because of its 7.8 KB C2PA blob; a cleaned mark would be inlined (eng review A2). Same shape as the existing "every CSS `url()` resolves" rule.
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

## Design review amendments (/plan-design-review, 2026-10-15)

Decisions approved one by one in the design review. The full record is in `mini-crm/.claude/designs/mut-206-brand-loader.md` › Design review.

- **DR3 (D5 → A), applied here.** CheckingSession's swap from `BrandMark` to `BrandLoader delay={0}`, and BootSplash's swap, never fade (identical picture). Test 5 asserts no `.brand-loader--enter` on that loader.
- **DR5 Long-wait caption (D7 → A).** CheckingSession passes `slowCaption={t('hosted.auth.connectingSlow')}` = "Still connecting…" / "ما زلنا نتصل…" (new portal keys). The static pre-JS splash has no text (the language is unknown). Test 5 is extended: the caption appears at 3000 ms and the mark's box is unchanged. QA `boot-slow-session` uses a 4 s `/v1/me` delay to see it.
- **DR6 Boot timeout (D8 → A).** `src/hosted/session/me.tsx` `meQuery` (already `retry: false`) becomes `queryFn: ({ signal }) => api.me({ signal: AbortSignal.any([signal, AbortSignal.timeout(ME_TIMEOUT_MS)]) })`, with `ME_TIMEOUT_MS = 15_000` (the iPhone's `Env.requestTimeout`). `api.me` forwards `signal` to the existing `request()` option (`client.ts:112/175`). A timeout is a non-401 error, so `AuthGate` renders the existing `BootUnreachable` with Retry; `SignInPage`'s `useQuery(meQuery)` inherits it too. Tests (fake timers, a never-resolving `fetch` mock): at 14.9 s CheckingSession still shows; at 15 s BootUnreachable shows; Retry refetches. Check that the client turns the `TimeoutError` into an `ApiError` (status 0), not an unhandled rejection.
- **DR7 (D9 → A), applied here.** Under reduced motion CheckingSession's loader shows "Checking your session" / "جارٍ التحقق من جلستك" as visible text when it appears at 400 ms, then "Still connecting…" at 3 s. The QA spec's `reducedMotion: 'reduce'` run asserts the visible text.
- **DR9 Boot delay counts from page start (D11 → A).** CheckingSession's still-mark phase lasts `bootDelayMs() = Math.max(0, LOADER_DELAY_MS - performance.now())`, an exported pure helper in `BootScreens.tsx`, instead of a fixed 400 ms. On a slow load it is 0 and the mark blooms the moment React mounts (frame 0 is the mark, so there is still no jump). On a fast load it is unchanged. In-content loaders keep 400 ms from mount. DR5's 3 s caption still counts from mount; that wasn't part of this decision. Tests: `bootDelayMs` with a mocked `performance.now()` of 100 → 300, 400 → 0, and 2500 → 0; CheckingSession with `now = 2500` shows the loader on first render.
- **DR10 Landing fallback blooms (D12 → A).** `BootSplash` renders the static mark (identical to the HTML splash) and, after `bootDelayMs()` (DR9), swaps to `BrandLoader size={96} delay={0}` with no fade, so the still frame is identical. No slow caption on landing. It renders inside `LandingProviders` (`src/pages/landing/LandingProviders.tsx`: Theme and Language), so `useT` and the label resolve. Test 3 (BootSplash ≡ HTML) compares the **first render only**, with that carve-out noted in the test. A new test: with `performance.now()` at 2500, `BootSplash` shows the `status` loader on its first render.
- **DR12 Boot background follows the app theme after load (D14 → A).** `boot-splash.css` keeps its `prefers-color-scheme` rule for pre-JS paint, and adds `:root[data-theme="dark"] .boot-splash, :root[data-theme="dark"] { background: #221B2D }` and `:root[data-theme="light"] .boot-splash, :root[data-theme="light"] { background: #FCF6ED }`. These mirror the selector order of `brand/mutaba3a-theme.css:59/88`, so a forced theme beats the media query. Once ThemeProvider sets `data-theme`, CheckingSession's background, `BrandMark` (`resolvedTheme`) and `BrandLoader` (`data-theme` fills) come from the same theme. D6 (pre-JS follows the OS) is unchanged. Test 4 becomes four states (OS light/dark × data-theme none/opposite), each asserting the background hex equals the token for the effective theme.
- **DR14 (D16 → A), applied here.** CheckingSession's container is `.boot-splash` **without** `aria-hidden` (only the static HTML splash has it). The test asserts `container.closest('[aria-hidden="true"]') === null` and that the `status` gets "Checking your session" / "جارٍ التحقق من جلستك" as text content when the loader shows.
- **DR18 Boot mark stays a fixed 80 px (D20 → A).** Confirms D1 and D4 as a design decision: an 80 px static mark, and `BrandLoader size={96}` (inner mark 80 px) in CheckingSession and BootSplash, on every viewport. The phone web mark is deliberately calmer than the iPhone's 144 pt launch mark.
<!-- DR-END -->

# Design review (/plan-design-review, 2026-10-15)

The full review (passes, storyboard, litmus, tasks DT1–DT11) is in `mut-206-brand-loader.md`. This brief's approved amendments are DR3, DR5–DR7, DR9, DR10, DR12, DR14 and DR18, listed above under **Design review amendments**.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex via `/plan-eng-review`; Claude subagent via `/plan-design-review` | Independent 2nd opinion | 2 | eng: unavailable; design: in-host subagent completed, codex unavailable | design subagent: 11 findings (9 accepted into decisions, 2 suppressed as contradicted by code or docs) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN (all resolved into the plan) | 7 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR | score: 4/10 → 9/10, 18 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex unavailable (not installed) in both the eng and design phases. The design phase ran one native Claude subagent (in-host), which is not counted as external coverage.
- **VERDICT:** DESIGN CLEARED (every rated pass is 9+ and no decisions are unresolved). The eng review completed with all 7 findings folded in. Its logged status is ISSUES OPEN because the count is recorded, not because anything is outstanding. Ready to implement: MUT-203, then (MUT-204 → MUT-205) in parallel with (MUT-206 → MUT-207).

NO UNRESOLVED DECISIONS
