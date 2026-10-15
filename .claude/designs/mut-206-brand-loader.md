# MUT-206 — Web app and portal: the bloom loader replaces the page and section spinners

**Status**: Planned 2026-10-15 (eng review at the end, covering MUT-203/206/207)
**Ticket**: MUT-206 (Story, Backlog). **Blocked by** MUT-203 (the kit JSONs this plan's parity test reads).
**Blocks**: MUT-207. **Relates**: MUT-104 (BrandMark, ADR-073), MUT-204 (the same loader on iPhone), MUT-91 (portal motion), MUT-103 (In Review: token sweep; touches the same CSS files).
**Epic**: MUT-101 · Kit: `docs/brand/loader/` (MUT-203).

## Problem

The app and the portal show five unrelated rings:
- `.spinner` (24 px, `index.css:3279`)
- `.hp-spinner` (20 px, `hosted.css:49`)
- `.demo-spinner` (48 px)
- the import step's 48 px ring
- an unused `.table-spinner`

Lazy routes show an unlocalised "Loading..." (`router.tsx:14` `PageLoader`, with an inline style). Only the portal's `CheckingSession` waits 400 ms before showing anything. Brand v2 has a designed loader: the bloom, the mark folding into drops and blooming back over a 4.5 s loop.

## Facts (main 3c5282a, checked 2026-10-15)

| Fact | Where | Consequence |
|---|---|---|
| The delivered `mutaba3a-loader.js` is an inline-SMIL SVG in a custom element. Its `theme="auto"` reads the OS, not ThemeToggle. It writes a `<style>` into a shadow root, and its label is English `aria-label="Loading"` (`role="progressbar"`). | kit | Port the SVG into React (D1); don't ship the element. |
| `brand.test.ts › literals` fails any TSX with a whole-string colour (`fill="#BCABF1"`) or a `<style>` element. `KNOWN_LITERALS` is empty. | `src/test/css/brandCss.ts:602` | The fills must come from CSS (D2). |
| The petal colours aren't tokens. Only `#795DBA` exists (`--m-primary`, light). | `mutaba3a.tokens.json`, `brand/mutaba3a-theme.css` | Add four `mark*` tokens (D2). |
| The global reduced-motion rule (`theme.css:419`) zeroes **CSS** animations; **SMIL `<animate>` ignores it**. `usePrefersReducedMotion` exists (`src/hooks/`, PATTERNS:1750). | | The still frame is chosen in JS (D3). |
| `PORTAL_CSP` = `default-src 'self'` with no `style-src` or `script-src`. It blocks inline `<style>`, parsed `style=""` and inline scripts. It allows SVG presentation attributes, SMIL and bundled CSS. React's `style` prop goes through the CSSOM, which is allowed, but we don't need it. | `server/src/app.ts:99` | Sizes go in SVG `width`/`height` attributes and colours in bundled CSS: safe in every build. |
| Keyframes match across JSON, JS and Dart (MUT-203 check). | | A parity test against the kit JSON (D4). |
| Tests pin the current markup: `.spinner` at `ClientsPage.test.tsx:456`, `ProjectsPage.test.tsx:238`, `OverviewPage.test.tsx:333,397`. The portal S1 label "Checking your session" appears after 400 ms (`auth-states.test.tsx:34`). | | Update the four; S1 keeps passing. |
| There is no bundle-size budget. `check-bundles` checks strings, origins and fonts. | `scripts/check-bundles.ts` | Size goes in the review as a number (the SVG data is about 6 KB raw, about 1.5 KB gzipped), not as a new gate. |

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **`src/components/brand/BrandLoader.tsx`**: a React port of the delivered SVG. `viewBox="-10 -10 120 120"`, four `<path>`s each with an `<animate attributeName="d">`, and a group `<animateTransform type="rotate">`. `dur` is 4.5 s, with the delivered `keyTimes`/`keySplines`/`values` strings. The path data lives in `bloomLoaderData.ts` beside it. **No `lottie-web`** (about 250 KB) and no custom element. | It is the same motion, ships zero runtime, and passes the CSP. It follows ThemeToggle through CSS (D2). It sits beside `BrandMark` (ADR-073). |
| D2 | **Colours from tokens.** `tokens.json` gains `color.markDot/markLavender/markRose/markPeach` (light `795DBA BCABF1 F499A7 F5AB77`) and `colorDark.*` (`F3E5B0 BCABF1 F499A7 F9B379`). `brand/mutaba3a-theme.css` gains `--m-mark-*` in its three selector blocks (oklch with hex comments, like its neighbours), and `theme.css` maps `--mark-dot/-lavender/-rose/-peach` (PD2). `BrandLoader.css` sets `.brand-loader-dot { fill: var(--mark-dot) }` and so on. The kit README records it under **Deviations** ("mark fills promoted to tokens"). | It passes the literal guard. Light, dark, System and live OS changes all follow `data-theme` through the existing three-selector cascade, so **no `useTheme` call is needed**, and the brandCss evaluator can prove the colours in all four theme states. |
| D3 | **Reduced motion**: `usePrefersReducedMotion()` → render **no** `<animate>`/`<animateTransform>` elements; the paths hold frame 0 (the mark). | SMIL ignores the CSS rule. Rendering no animation children is deterministic and testable, unlike `pauseAnimations()` timing. Frame 0 is the mark, so reduced-motion users see the logo. |
| D4 | **Parity test** (`bloomLoaderData.test.ts`) reads `docs/brand/loader/mutaba3a-loader.json` and checks, per piece: `keyTimes` = Lottie `t`/270; every `values` path's numbers = the Lottie `v`/`i`/`o` turned into absolute cubic control points; `keySplines` = the Lottie `o`/`i` easing handles; and the rotation keys. It also checks that the class order matches the JSON fill order. | The JSON is the source of truth (MUT-203). Drift fails CI. |
| D5 | **API**: `<BrandLoader size={24 \| 40 \| 64 \| 96} label?={string} delay?={ms} className? />`. The default label is `t('common.loaderLabel')` (DR13), added to both the app and portal dictionaries. The default delay is **`LOADER_DELAY_MS = 400`**, exported and reused by `CheckingSession` in place of its own `SPINNER_DELAY_MS`. Markup: `<span role="status" aria-label={label} className="brand-loader …">` around `<svg aria-hidden="true" focusable="false" width={size} height={size}>`. During the delay it renders the same `<svg>` **empty** with no role: the same footprint and no announcement. The placeholder and the shown SVG carry different `key`s (`"wait"` / `"on"`), so React mounts a **fresh** `<svg>` when the loader appears. An inline SVG's SMIL timeline starts when that element is inserted, so reusing the placeholder would start the loop 0.4 s in (eng review A1). | Sizes are the designed set plus 96 (MUT-207's splash). A typed union stops a sub-24 inline use. `status` and a label is the a11y pattern the portal already uses. An equal footprint means no layout shift. |
| D6 | **Sites** (sizes): full-page `.loading` → 64; section, list and drawer body → 40; `DemoSeedModal` and the import step → 64 (they keep their text); `PageLoader` → 64 (DR2), centred in `.loading` (its inline `style` is deleted); portal `CheckingSession` → 40 (layout unchanged; MUT-207 reshapes it). **Kept**: the `Button`/`hp-inline-spinner` 16 px inline spinners, the portal `Skeleton`s (they reserve layout, a different job), `ProfileSwitcher`'s skeleton, `BusinessesGate`'s blank root gate, and `LandingLoader` (MUT-207 owns it). | The ticket's split: page and section waits get the brand; inline and skeleton patterns stay. |
| D7 | **CSS deleted**: `.spinner` and `@keyframes spin` (index.css), `.hp-spinner` and `hp-spin`, `.demo-spinner` and its duplicate `spin`, `.import-step-importing .spinner` and its duplicate `spin`, and the dead `.table-spinner`/`table-spin`. `.loading` stays (the centring box). | No orphans; three duplicate `@keyframes spin` disappear. |
| D8 | **ADR-079** records D1–D3 (port, token fills, JS-chosen still frame, no Lottie runtime). | DECISIONS.md protocol. |

## Implementation

1. **Tokens** (D2): `tokens.json`, `brand/mutaba3a-theme.css` (the three blocks), and `theme.css` semantic map; kit README Deviations line.
2. `src/components/brand/bloomLoaderData.ts`: `export const BLOOM_PIECES = [{ cls: 'dot', keyTimes, keySplines, values: string[] }, …]` in the JSON's layer order (tr, tl, bl, br) and `BLOOM_ROTATION`. The strings are copied from the delivered JS; `values[0]` is the still frame.
3. `src/components/brand/BrandLoader.tsx` and `BrandLoader.css`, following D1/D3/D5. The delay is a `setTimeout` in an effect, cleared on unmount, and skipped when `delay === 0`. Import `usePrefersReducedMotion` from `src/hooks/` (allowed: the portal ESLint ban applies only to files under `src/hosted/**`).
4. **Sites** (D6): replace `<div className="spinner" />` with `<BrandLoader size={…} />` in each one:
   - Pages: ClientDetail, Settings, ProjectDetail, Overview, Insights, Reports, Clients, Projects, Retainers, ClientWorkSection, Planning.
   - Drawers: Client, Project, Income, Expense, Conversion, LegacyExpenseEdit, Retainer, PlanAssumption, BusinessProfile, PartialPayment, OrphanedRecords, and RetainerMatching ×2.
   - Portal drawers: Conversion and Expense.
   - Also: DemoSeedModal, ImportDataPage, `router.tsx` `PageLoader`, and the portal `BootScreens` `CheckingSession`.
5. Delete the CSS (D7).
5b. **ImportDataPage copy** (eng review R4, D5 answer C): move every hard-coded user-visible string in `src/pages/settings/ImportDataPage.tsx` to en/ar keys under `settings.import.*`, with real Arabic copy. Test: `src/pages/settings/__tests__/ImportDataPage.copy.test.tsx` renders the idle step under `ar` and finds the Arabic heading, and a static guard fails on any Latin-letter JSX text node in the file (only file-extension tokens like `.json`/`.csv` are exempt).
6. Knowledge files: COMPONENT_REGISTRY (BrandLoader entry and layout index), PATTERNS ("Waits use BrandLoader; inline button spinners and skeletons don't"), DECISIONS (ADR-079), CHANGELOG, TEST_PLAN.

## Tests (TDD: written first)

- `src/components/brand/__tests__/bloomLoaderData.test.ts`: D4 parity, plus `values[0] === values[last]` for every piece (a seamless loop).
- `src/components/brand/__tests__/BrandLoader.test.tsx`:
  1. After 400 ms (fake timers) there is `role="status"` named "Loading..." (en) or "جارٍ التحميل..." (ar). Before that there is no status, but the `<svg>` has the same width and height.
  2. `delay={0}` shows at once; `label` overrides the name.
  3. Reduced motion (spy `matchMedia` for the reduce query) → no `animate`/`animateTransform` elements, and each path's `d` equals `values[0]`. Otherwise there are 4 `animate` and 1 `animateTransform`, with `dur="4.5s"`.
  4. Unmounting during the delay leaves no timer.
  5. No `style` attribute anywhere in the output (CSP).
- `src/test/css/brand.test.ts`: the evaluator resolves `--mark-dot/-lavender/-rose/-peach` to the token hexes in all four theme states (OS light/dark × data-theme none/light/dark). The literal guard stays green.
- Updated: `ClientsPage.test.tsx:456`, `ProjectsPage.test.tsx:238`, `OverviewPage.test.tsx:333,397` assert `findByRole('status', { name: /loading/i })` with **real timers**. `findBy*` waits up to 1000 ms, and the loader appears at 400 ms. Fake timers would also freeze fake-indexeddb and TanStack Query in these page tests (eng review Q1). `auth-states.test.tsx:34` is unchanged and must stay green.
- `src/components/brand/__tests__/BrandLoader.test.tsx` › `old spinners are gone`: read `src/**/*.css` with `fs` and `import.meta.glob`-free `node:fs` globbing (as `brandCss.ts` does), and assert that no `.spinner`, `.hp-spinner`, `.demo-spinner` or `.table-spinner` selector, and no `@keyframes (spin|hp-spin|table-spin)`, remains.

Commands (Node 22): `npm run lint && npm run typecheck && npm run test:run && npm run build && npm run test:bundles`.

## QA scenarios (release-QA)

`qa/features/web/brand.yaml` (paths gain `src/components/brand/BrandLoader.*`, `bloomLoaderData.ts`, `src/router.tsx`):
- **`loader-slow-route`**: *open Reports while its code is slow to download.* The Playwright route delays the `ReportsPage-*.js` chunk by 2 s. Expect nothing for 0.4 s, then the bloom loader with name "Loading..." in light and in dark (`colorScheme`), then Reports. With `reducedMotion: 'reduce'` the loader has no `animate` children.
- axe runs on the loader screen in light and dark.

`qa/features/portal/signin.yaml` (paths gain `src/components/brand/BrandLoader.*`):
- **`boot-slow-session`**: *open the portal while the session check is slow.* The route delays `/v1/me` by 3 s. Expect the wordmark; after 0.4 s the bloom loader named "Checking your session"; then sign-in. No CSP violation in the console (`page.on('console')` filtered for `Content Security Policy`).

Specs: `qa/specs/web/brand.spec.ts` (`@web.brand.loader-slow-route`) and `qa/specs/portal/signin.spec.ts` (`@portal.signin.boot-slow-session`), each run once until it passes.

## Cost and scale

No dependency. About 6 KB of SVG path strings, about 1.5 KB gzipped, enter the shared chunk once and are used by both the app and the portal. SMIL runs on the compositor-light path and only while a loader is mounted. It removes three duplicate keyframes and five CSS blocks.

## Build notes

- Worktree `.claude/worktrees/mut-206` on `feature/mut-206-brand-loader`, from main after MUT-203.
- **MUT-103 (In Review)** sweeps literals out of the same CSS files (`index.css`, `hosted.css`). Merge or rebase onto it first if it lands before this does. The deletions here don't conflict in intent.

## Design review amendments (/plan-design-review, 2026-10-15)

Decisions approved one by one in the design review. The full record is in `mini-crm/.claude/designs/mut-206-brand-loader.md` › Design review.

- **DR1 Placement (D3 → A).** A new `.loading--section` modifier on drawer bodies, section lists (`ClientWorkSection`, `RetainerMatchingDrawer` ×2, `ClientsPage`, `ProjectsPage`, `RetainersPage`) and portal drawers aligns the loader to the **top**: `align-items: flex-start`, `min-height: 120px`, `padding-block: var(--space-8)`. Full-page `.loading` (ClientDetail, Settings, ProjectDetail, Overview, Insights, Reports, Planning, `PageLoader`) gets `min-height: 50vh` and stays centred. `DemoSeedModal` and the import step put the loader above their text with `gap: var(--space-4)`. These are token values only (the literal guard holds). Test: a CSS evaluator assertion that `.loading` has `min-height: 50vh` and `.loading--section` has `align-items: flex-start`.
- **DR2 Route loader size (D4 → A).** `router.tsx` `PageLoader` renders `BrandLoader size={64}` inside the full-page `.loading` box, the same size and spot as the page loaders that follow it, so route download plus data load reads as one wait. D6's site list is updated.
- **DR3 Enter and exit (D5 → A).** When the delay ends, `BrandLoader` fades in through a `.brand-loader--enter` class: `opacity` 0 → 1 over a new motion token `--duration-fade: 150ms` (in `theme.css` beside `--duration-press`, and zeroed in the same reduced-motion block) with `var(--ease-spring)`. A loader that lives 50 ms barely registers. Content replacing a `.loading` box enters with a 150 ms (`--duration-fade`) opacity fade, a shared `.content-enter` class in `index.css` and `hosted.css`. `delay={0}` (CheckingSession, BootSplash hand-offs) never fades in. The global reduced-motion rule already zeroes these durations. Tests: the shown loader has `.brand-loader--enter` and the `delay={0}` loader does not; the evaluator resolves `--duration-fade` to 150ms normally and 0ms under reduced motion.
- **DR5 Long-wait caption (D7 → A).** `BrandLoader` gains `slowCaption?: string`. After `LOADER_SLOW_MS = 3000` (exported, counted from mount, delay included), a `<span class="brand-loader__caption">` fades in (`--duration-fade`) 16 px under the SVG. It is absolutely positioned (`position: absolute; inset-block-start: calc(100% + var(--space-4))`), so the mark never moves. Full-page sites (and `PageLoader`) pass `t('common.loadingSlow')` = "Still loading…" / "ما زلنا نحمّل…". Section and drawer sites pass nothing. New keys in the app and portal dictionaries (parity test). Tests: no caption before 3000 ms; the caption at 3000 ms; the SVG's bounding box is unchanged.
- **DR7 Reduced motion shows a word (D9 → A).** When `usePrefersReducedMotion()` is true, `BrandLoader` (every size) renders its `label` as visible text in the DR5 caption slot from the moment it appears, then `slowCaption` at 3000 ms if set. There are no `<animate>` children and no fade. Test 3 is extended: under reduced motion the visible caption equals the label ("Loading" / "جارٍ التحميل") on first render after the delay.
- **DR8 Loader only when empty (D10 → A).** Rule (added to PATTERNS beside "pending vs loading", PATTERNS:2051): a site shows `BrandLoader` only when there is no data yet (TanStack `isPending`, or a Dexie live query's `undefined`). Background refetches (`isFetching` with data) keep the content. Audit every site in D6 against it. Regression test: in `ClientsPage.test.tsx`, after the list renders, invalidate the query, then the rows stay and no `status` named Loading appears.
- **DR11 Chained waits skip the delay (D13 → A).** `BrandLoader.tsx` keeps module-level `let lastShownLoaderHiddenAt = -Infinity`. When a loader that was **shown** (past its delay; placeholders don't count) unmounts, it records `performance.now()`. A `BrandLoader` mounting within `LOADER_CHAIN_MS = 100` of that shows immediately, with no delay and no `.brand-loader--enter` fade. An exported `__resetLoaderChainForTests()` is used only by tests. Tests (fake timers): A shown → unmount → B mounts 50 ms later → B's `status` is present on its first render without the enter class; B mounting 150 ms later waits 400 ms; a placeholder-only A doesn't chain.
- **DR13 One label, no dots (D15 → A).** `BrandLoader`'s default `label` is a new key, `common.loaderLabel` = "Loading" / "جارٍ التحميل", in both `src/lib/i18n/translations/{en,ar}.json` and `src/hosted/i18n/{en,ar}.json` (the parity test covers it). This matches the iPhone's `loading` key. `common.loading` ("Loading..." drawer titles) is unchanged. Where this brief says "named Loading...", read "named Loading": Tests 1, the updated page tests (`/loading/i` still matches) and the QA `loader-slow-route` expectation.
- **DR14 Persistent status, text injected (D16 → A).** This supersedes D5's markup. `BrandLoader` renders `<span role="status" class="brand-loader …">` **from mount**, empty during the delay and with no `aria-label`. At show time a text child is set: the label (`common.loaderLabel` or the `label` prop) as a visually hidden `<span class="visually-hidden">`, or as the visible caption when DR7 (reduced motion) shows it, never both. At 3 s it is replaced by the `slowCaption` text (DR5), which is also announced. The `<svg>` stays `aria-hidden` and keyed (A1). Tests: the status element exists before the delay with empty text; after the delay its `textContent` is "Loading" / "جارٍ التحميل"; there is no `aria-label`; under reduced motion the text appears once (not duplicated); at 3 s the text is the slow caption. The page tests (T3) use `findByRole('status')` with `toHaveTextContent(/loading/i)`, because `status` takes its name from the author, not the content. A11y QA: the axe run plus a manual NVDA check on Windows (Chrome) that "Loading" is spoken on a throttled Reports open.
- **DR16 Desktop RTL/LTR check (D18 → A).** `web.brand.loader-slow-route` also runs at a 1440×900 viewport in `ar` (RTL, sidebar on the right) and `en` (LTR). It asserts the loader's centre equals the centre of `.page-content`'s visible box ±1 px for the route loader and then the page loader (D4: same spot), and that the loader isn't mirrored (`getComputedStyle(svg).transform === 'none'`).
<!-- DR-END -->

# Eng review (/plan-eng-review, 2026-10-15) — target: the Loader & Splash plan set

Target (fixed): `mini-crm/.claude/designs/mut-203-loader-splash-kit.md`, `mutaba3a-flutter/mutaba3a/.claude/designs/mut-204-bloom-loader.md`, `mut-205-launch-splash.md`, `mini-crm/.claude/designs/mut-206-brand-loader.md` (this file), `mut-207-boot-splash.md`. This file is the report file for the set. The Flutter briefs get their accepted amendments and a copy of the terminal report.

## Scope Challenge

Scope record: feature answers: none proposed (no cuts); structure: A Original arrangement (D1, user answer 2026-10-15); accepted scope: the five plans as written, file arrangement unchanged; pending remedies: R1 (CheckingSession reshape), R2 (golden vs painter tests).

Verified while preparing (factual corrections, no behavior change):
- `flutter_native_splash` 2.4.8 (pub.dev): the image is treated as @4x; Android 12 is 1152×1152 in a 768 px circle without a background and 960×960 in 640 px with one; `web: false` and dev-dependency-only use are supported. MUT-205's Facts hold, and the pin is 2.4.8.
- Vite 7.3.6 rewrites `source[srcset]` and `img[src]` in HTML entries (`node_modules/vite/dist/node/chunks/config.js:23294-23296`). MUT-207 D1 holds.
- The app targets iPhone and iPad (`TARGETED_DEVICE_FAMILY = "1,2"`, `project.pbxproj:671`). Launch images are point-sized, so the 144 pt mark holds on iPad. iPad QA stays out of scope (iPhone first).

## Decision ledger

### R1: Portal CheckingSession becomes "the mark becomes the loader" (MUT-207 D4)
Finding: S1, P2, confidence 8/10, `src/hosted/pages/auth/BootScreens.tsx:19-21` (`<Wordmark />` + `{slow && <span className="hp-spinner" …/>}`), reviewer: plan-eng-review (Claude).
Plan baseline: MUT-207 D4 as drafted (not yet approved). Ticket MUT-207 AC: "Mounting React replaces the splash with no visible jump of the mark".
Runtime evidence: the S1 screen today is the 28 px mark + "Mutaba3a"/"متابعة" text in Thmanyah, centred as a lockup; when the spinner appears at 400 ms the lockup moves up 18 px (`.hp-center` gap 16 + spinner 20). Before JS, neither the font nor the language is known, so a static splash cannot reproduce the lockup.
Comparison grid:
| Choice | Current | A Mark-only boot screen | B Keep the wordmark |
|---|---|---|---|
| R1 CheckingSession look | wordmark lockup + 20 px ring after 400 ms | the 80 px mark centred, which blooms in place after 400 ms; no text | wordmark lockup kept; bloom loader (40) under it after 400 ms |
| Splash → React hand-off | n/a (no splash) | identical mark, same spot, no jump | the static mark jumps to the lockup's mark position, and the text appears |
| MUT-207 AC "no visible jump" | n/a | met | not met (AC amended to "no colour flash") |
| R2 test approach | pending | pending | pending |
Question D2:
D2 — Should the portal's "checking your session" screen drop the Mutaba3a name and show only the mark?
Project/branch/task: mini-crm main; MUT-207 (boot splash) with MUT-206's loader.
ELI10: Before the portal's code loads, we can paint the logo mark but not the name: we don't yet know the language or have the font. Today, once the code loads, the portal shows the mark with the name beside it. So the static logo would jump sideways when the real screen appears. If the checking screen shows just the mark, the same mark stays put and simply starts to bloom, like the iPhone launch. The name still shows on the sign-in and error screens.
Stakes if we pick wrong: keep the name and every portal load shows a visible jump from the splash to the lockup; drop it and the 0.4 to 3 s checking screen carries no brand name.
Recommendation: A Mark-only boot screen because it is the only arrangement that meets the ticket's no-jump criterion, and it matches the iPhone app's launch.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Mark-only boot screen (recommended)
  ✅ The splash mark and the checking-screen mark are the same picture in the same place, so loading feels like one continuous motion
  ✅ Same behaviour as the iPhone launch (MUT-205 D4), so web and app look like one product
  ❌ The checking screen no longer spells out "Mutaba3a"; the name appears only once sign-in or the portal shows
B) Keep the wordmark
  ✅ The name stays visible on the checking screen, as it is today
  ✅ Smaller diff in BootScreens.tsx (human: ~1h / CC: ~5 min less)
  ❌ The static splash mark visibly jumps into the lockup when React mounts, so the ticket's AC must be relaxed
Net: a continuous, jump-free load against keeping the brand name on a screen most users see for under a second.
Header: Boot screen
Options:
A) Mark-only boot screen
CheckingSession shows the 80 px mark centred in .boot-splash; after 400 ms BrandLoader (96) takes its place and blooms; no text. BootUnreachable keeps the Wordmark. Meets the no-jump AC. (human: ~2h / CC: ~10 min)
B) Keep the wordmark
CheckingSession keeps the wordmark lockup and puts BrandLoader (40) under it after 400 ms. The splash mark jumps to the lockup on mount; MUT-207's AC changes to "no colour flash". (human: ~1h / CC: ~5 min)

State: approved
Actual answer: A) Mark-only boot screen (D2, user answer 2026-10-15)
Accepted scope: MUT-207 D4 as written. CheckingSession renders inside `.boot-splash`: the 80 px `BrandMark` for `LOADER_DELAY_MS`, then `BrandLoader size={96} delay={0}` with the `hosted.auth.checking` label; no wordmark text. BootUnreachable keeps the Wordmark. MUT-207's no-jump AC stands, with its tests 5 and 6 and the `portal.signin.boot-splash` hand-off check.
History: none

### R2: How MUT-204 proves the loader draws correctly (golden files vs assertions)
Finding: T1, P2, confidence 8/10, `mut-204-bloom-loader.md` D6 ("**No golden files.** The tests assert geometry and colours directly") versus ticket MUT-204 AC ("widget golden tests at 24/40/64 in both themes"), reviewer: plan-eng-review (Claude). The planned tests 1–3 check `bloomShapeAt`/`bloomAngleAt` and the palette, but nothing checks that `paint()` applies them: the delivered `canvas..scale(size.width / 120)..translate(60, 60)..rotate(...)..translate(-50, -50)` could be wrong and every planned test would still pass.
Plan baseline: MUT-204 D6 as drafted (not approved): painter maths only, no goldens. The ticket AC asks for goldens.
Runtime evidence: the repo has no golden tests and no `flutter_test_config.dart` (Flutter map, §7). `flutter_test`'s `paints` matcher is not public API.
Comparison grid:
| Choice | Current | A Maths + pixel probes | B Golden files | C Maths only |
|---|---|---|---|---|
| R2 render proof | none (plan drafted C) | `BloomPainter` rendered to an image in-test (`PictureRecorder` → `toImage`) at 120 px, frame 0, both themes: each piece's centroid pixel equals its palette colour, and a corner pixel is transparent | `matchesGoldenFile` PNGs at 24/40/64 × light/dark × frames 0/135 (12 files) | no render check |
| Catches a wrong transform or colour in paint() | n/a | yes | yes | no |
| New infra | n/a | none | golden files plus a `flutter_test_config.dart` tolerance comparator | none |
| Ticket AC wording | goldens | amended to "rendered pixel probes" | as written | amended |
| R1 boot screen | approved A (D2) | unchanged | unchanged | unchanged |
Question D3:
D3 — How should the iPhone loader's drawing be proven correct: pixel checks, golden image files, or maths only?
Project/branch/task: mutaba3a-flutter main; MUT-204 (bloom loader widget).
ELI10: The plan tests the loader's numbers (where each petal is at each moment, and its colours) but never looks at what actually gets drawn. If the code that scales and rotates the drawing were wrong, the tests would still pass while the screen showed a broken loader. Golden files (saved reference screenshots) would catch it, but this repo has none, and they break when the rendering engine changes. A middle path draws the loader into an image inside the test and checks a few pixel colours.
Stakes if we pick wrong: maths only can ship a mis-drawn loader with green tests; goldens add 12 binary files that fail on Flutter upgrades for reasons unrelated to our code.
Recommendation: A Maths + pixel probes because it catches the same transform and colour bugs goldens would, with no new test infrastructure or binary files to maintain.
Completeness: A=9/10, B=9/10, C=7/10
Pros / cons:
A) Maths + pixel probes (recommended)
  ✅ Renders the real painter and checks a pixel per petal, so a wrong scale, rotate or colour fails the test
  ✅ No golden PNGs and no comparator config; stable across Flutter upgrades because it samples centroids, not edges
  ❌ Probes only frame 0, so a mid-animation drawing bug relies on the keyframe maths tests (human: ~1h / CC: ~10 min)
B) Golden files
  ✅ Exactly what the ticket's AC says; a reviewer can open the PNGs and see the loader
  ✅ Covers every pixel at three sizes, two themes and two frames
  ❌ Introduces golden infra to a repo with none; antialiasing changes on Flutter upgrades break it (human: ~3h / CC: ~25 min)
C) Maths only
  ✅ Smallest test set; the plan as drafted
  ❌ A broken transform or palette wiring inside paint() ships with green tests
Net: A buys the bug-catching of goldens without their upkeep; B is literal to the AC; C leaves a real gap.
Header: Loader proof
Options:
A) Maths + pixel probes
Keep the maths tests (1–3) and add a render test: BloomPainter to an image at 120 px, frame 0, light and dark; each petal's centroid pixel equals its palette colour and a corner pixel is transparent. Amend MUT-204's AC. (human: ~1h / CC: ~10 min)
B) Golden files
Keep the maths tests and add 12 matchesGoldenFile PNGs (24/40/64 × light/dark × frames 0 and 135) plus a flutter_test_config.dart tolerance. The ticket AC stays. (human: ~3h / CC: ~25 min)
C) Maths only
The plan as drafted: geometry, palette and loop tests only, no render check. Amend MUT-204's AC. (human: 0 / CC: 0)

State: approved
Actual answer: A) Maths + pixel probes (D3, user answer 2026-10-15)
Accepted scope: MUT-204 keeps tests 1–3 and adds a render test. `BloomPainter` at frame 0 is painted through `PictureRecorder` into a 120×120 image (`toImage` + `toByteData(rawRgba)`), in the light and dark palettes. Each of the four petals' centroid pixels equals its palette colour, and the (2, 2) corner pixel is fully transparent. No golden files and no `flutter_test_config.dart`. MUT-204's AC is amended on the ticket ("golden tests" becomes "rendered pixel probes at frame 0, both themes").
History: none

### R3: TODO: the Android splash hand-off size (MUT-205 D7)
Finding: TODO-1, P3, confidence 9/10, `mut-205-launch-splash.md` D7 ("accept a size difference at the Android hand-off. On Android 12 the mark is 1152 px / 4 = 125 dp, not 144"), reviewer: plan-eng-review (Claude).
Plan baseline: MUT-205 lists it under "Follow-ups (not in this ticket)", with no tracker item.
Runtime evidence: `android12.png` is 1152×1152 with a 500 px mark (125 dp); `splash.png` is 768 @4x with a 576 px mark (144 pt). Android isn't shipped (capture-app decisions: iOS first).
Comparison grid:
| Choice | Current | A File a Jira follow-up | B Skip | C Build it now |
|---|---|---|---|---|
| R3 Android hand-off size | untracked note in the brief | MUT Task under the Android epic: per-platform `kSplashMarkBox` (125 dp on Android 12+) plus an emulator check | nothing tracked | MUT-205 picks the box per platform now and adds an Android test |
Question D4:
D4 — Should the Android splash size mismatch get a Jira follow-up?
Project/branch/task: mutaba3a-flutter main; MUT-205 (launch screen).
ELI10: On Android 12 and newer, the system draws the launch logo a bit smaller (125 instead of 144 points) than iPhone does. The app's own splash copies the iPhone size, so on Android the logo would grow slightly when the app takes over. Android isn't shipped yet, so the plan leaves this for the Android work.
Stakes if we pick wrong: skip it and the first Android build ships a visible logo jump; build it now and iPhone-first work grows for a platform nobody uses yet.
Recommendation: A File a Jira follow-up because the fix belongs with the Android epic's device testing, and a ticket keeps it from being forgotten.
Completeness: A=9/10, B=6/10, C=10/10
Pros / cons:
A) File a Jira follow-up (recommended)
  ✅ The gap is tracked where Android work is planned, with the exact numbers (125 dp vs 144 pt) written down
  ✅ MUT-205 stays iPhone-focused and ships sooner
  ❌ Android still has the jump until the follow-up lands (human: ~10 min / CC: ~2 min)
B) Skip
  ✅ No extra ticket to manage
  ❌ The mismatch lives only in a design brief and is likely forgotten when Android starts
C) Build it now
  ✅ No Android jump from day one
  ❌ Adds platform branching and an Android emulator check to an iPhone-first ticket (human: ~2h / CC: ~15 min)
Net: track it cheaply now, or pay for unused Android polish today.
Header: Android splash
Options:
A) File a Jira follow-up
New MUT Task (Backlog, relates MUT-205): per-platform splash mark box on Android 12+ (125 dp), with an emulator check. MUT-205's scope is unchanged. (human: ~10 min / CC: ~2 min)
B) Skip
Leave it as a note in the MUT-205 brief only. Nothing tracked.
C) Build it now
MUT-205 sets kSplashMarkBox per platform (iOS 180, Android 12+ 156.25) and adds a widget test for the Android value. (human: ~2h / CC: ~15 min)

State: approved
Actual answer: A) File a Jira follow-up (D4, user answer 2026-10-15)
Accepted scope: file one MUT Task (Backlog, relates MUT-205): a per-platform splash mark box on Android 12+ (125 dp visible mark, 156.25 dp painter box), with an emulator check. MUT-205's scope is unchanged.
History: none

### R4: TODO: ImportDataPage copy is not localised
Finding: TODO-2, P3, confidence 9/10, `src/pages/settings/ImportDataPage.tsx:451` (`<h3>Importing data...</h3>`) and 11 more hard-coded English strings (`:225 Import Data`, `:242`, `:269`, `:355`, `:360`, `:380`, `:428`, `:452`, `:462`, `:489`), reviewer: plan-eng-review (Claude). MUT-206 puts the new loader beside line 451.
Plan baseline: MUT-206 replaces only the spinner at that site.
Runtime evidence: the page has 12 `t()` calls but about 12 English literals. TD-112 and TD-113 already track other ImportDataPage debt (precision, no tests). No TD covers its copy.
Comparison grid:
| Choice | Current | A Add as TD-141 | B Skip | C Build it now |
|---|---|---|---|---|
| R4 ImportDataPage copy | untracked | TD-141 in `.claude/TECH_DEBT.md` (this repo's debt list, beside TD-112/113): localise the page's 12 strings in en/ar | nothing tracked | MUT-206 localises all 12 strings plus ar/en keys |
Question D5:
D5 — Should the untranslated text on the Import Data page be recorded as tech debt?
Project/branch/task: mini-crm main; MUT-206 touches this page's loading step.
ELI10: The Import Data settings page shows about a dozen English phrases even when the app is in Arabic, like "Importing data..." next to where the new loader goes. It's not caused by the loader work, but the loader change sits right beside it. The page already has two other debt items recorded.
Stakes if we pick wrong: skip it and Arabic users keep seeing English on this page with no record; fold it into MUT-206 and a branding ticket grows into a translation pass on a page with no tests.
Recommendation: A Add as TD-141 because it's real, page-wide debt that fits beside TD-112/113, and keeping it out of MUT-206 keeps the loader change reviewable.
Completeness: A=9/10, B=5/10, C=10/10
Pros / cons:
A) Add as TD-141 (recommended)
  ✅ Recorded next to the page's other debt, so whoever fixes TD-113 (tests) can localise in the same pass
  ✅ MUT-206 stays a branding change with a clean diff
  ❌ Arabic users still see the English phrases until someone picks it up (human: ~10 min / CC: ~2 min)
B) Skip
  ✅ No bookkeeping
  ❌ A known i18n gap on a live settings page goes unrecorded
C) Build it now
  ✅ The page is fully bilingual when the loader lands
  ❌ About 24 new translation keys on an untested page, inside a branding ticket (human: ~3h / CC: ~20 min)
Net: record it beside its sibling debt now, or widen MUT-206 into translation work.
Header: Import copy
Options:
A) Add as TD-141
New TD-141 in .claude/TECH_DEBT.md: ImportDataPage's ~12 hard-coded English strings need en/ar keys; pair with TD-113's tests. MUT-206 scope unchanged. (human: ~10 min / CC: ~2 min)
B) Skip
Nothing recorded; MUT-206 scope unchanged.
C) Build it now
MUT-206 also moves all ~12 ImportDataPage strings to en/ar translation keys. (human: ~3h / CC: ~20 min)

State: approved
Actual answer: C) Build it now (D5, user answer 2026-10-15)
Accepted scope: MUT-206 moves every hard-coded user-visible string in `src/pages/settings/ImportDataPage.tsx` (about 12–15 sites: headings, paragraphs, the select placeholder, the importing, complete and failed steps) to en/ar keys under the page's existing `settings.import.*` namespace, with real Arabic copy, not English placeholders. Proof: a new `src/pages/settings/__tests__/ImportDataPage.copy.test.tsx` renders the page's idle step under `ar` and finds the Arabic heading, plus a guard that the file has no JSX text node made of Latin letters (the only allowed exception is a file-extension token such as `.json`/`.csv`). No TD is filed. TD-113 (no flow tests) stays open: this adds copy coverage only.
History: none

### R5: TODO: the Flutter repo's CLAUDE.md is stale about release-QA
Finding: TODO-3, P3, confidence 9/10, `mutaba3a-flutter/mutaba3a/CLAUDE.md:25` ("**`qa/` is not set up in this repo yet.**") and `:27` (`API_BASE_URL`), reviewer: plan-eng-review (Claude).
Plan baseline: neither Flutter plan touches CLAUDE.md.
Runtime evidence: commit `e7f90c05 chore(qa): set up release-qa kit for iOS Simulator` set `qa/` up; `qa/qa.config.mjs` and `lib/core/env.dart` use `MUTABA3A_API_BASE_URL`.
Comparison grid:
| Choice | Current | A Fix in MUT-204 | B Skip | C File a Jira task |
|---|---|---|---|---|
| R5 CLAUDE.md QA lines | stale (says qa/ missing; wrong define name) | MUT-204's first commit corrects CLAUDE.md lines 25-27 (qa/ exists since e7f90c05; the define is `MUTABA3A_API_BASE_URL`) | stays stale | separate MUT Task |
Question D6:
D6 — Should the Flutter repo's outdated instructions about release-QA be corrected as part of MUT-204?
Project/branch/task: mutaba3a-flutter main; MUT-204 is the next feature to add QA flows.
ELI10: The Flutter repo's instructions file still says the QA kit isn't set up (it was, two commits ago) and names a settings variable that was renamed. Anyone following it, human or AI, would try to set QA up again or use the wrong variable. MUT-204 is the next ticket that writes QA flows, so it's the natural place to fix two lines.
Stakes if we pick wrong: skip it and the next session wastes time re-running release-qa init or wiring the wrong define; fold it in and MUT-204's diff carries a two-line doc fix.
Recommendation: A Fix in MUT-204 because it's two lines the ticket's own QA work depends on, and a separate ticket costs more than the fix.
Completeness: A=10/10, B=5/10, C=9/10
Pros / cons:
A) Fix in MUT-204 (recommended)
  ✅ The instructions are right before the first new QA flow is written against them
  ✅ Costs two lines in a commit that already touches qa/ (human: ~5 min / CC: ~1 min)
  ❌ A doc change rides along in a feature branch
B) Skip
  ✅ MUT-204's diff stays code-only
  ❌ Every future session reads that QA isn't set up and may re-run init
C) File a Jira task
  ✅ Keeps the doc fix separately reviewable
  ❌ A ticket's overhead for two lines, and it stays wrong until someone picks it up
Net: a two-line fix now versus leaving wrong instructions in place.
Header: CLAUDE.md fix
Options:
A) Fix in MUT-204
MUT-204's first commit updates CLAUDE.md lines 25-27: qa/ exists (e7f90c05), and the define is MUTABA3A_API_BASE_URL. (human: ~5 min / CC: ~1 min)
B) Skip
Leave CLAUDE.md as is.
C) File a Jira task
New MUT Task for the two-line CLAUDE.md correction; MUT-204 unchanged. (human: ~10 min / CC: ~2 min)

State: approved
Actual answer: A) Fix in MUT-204 (D6, user answer 2026-10-15)
Accepted scope: MUT-204's first commit updates `mutaba3a-flutter/mutaba3a/CLAUDE.md` lines 25–27: `qa/` is set up (e7f90c05), so drop the "not set up yet / release-qa init" instruction, and the dart define is `MUTABA3A_API_BASE_URL`.
History: none

Approval readiness: PASS. Checked R1 (D2 answer A), R2 (D3 answer A), R3 (D4 answer A), R4 (D5 answer C), R5 (D6 answer A); scope record D1 answer A. The corrections A1, A2 and Q1 change no behaviour and are recorded as corrections. No remedy is pending.

## Section 1: Architecture

```
iPhone cold launch                              Web / portal cold load
──────────────────                              ──────────────────────
iOS LaunchScreen.storyboard                     index.html / hosted.html
 (canvas + 144 pt mark, light/dark)              #root > .boot-splash (picture: mark / mark-dark by OS)
        │ first Flutter frame                     boot-splash.css (linked, CSP-safe, works in dev)
        ▼                                                │ React createRoot().render replaces #root
SplashScreen (MUT-205)                                   ▼
 BloomPainter frame 0, 180 pt box ── 400 ms ──▶  portal: CheckingSession (R1=A)
 Mutaba3aLoader(delay 0) blooms in place           BrandMark 80 ── 400 ms ──▶ BrandLoader 96 (fresh svg)
        │ auth + app-lock settle                  landing: BootSplash (Suspense fallback) → page
        ▼                                         /app/: AppShell (full replace)
/capture (or /sign-in, /lock)
Page/section waits: Mutaba3aLoader(64|40, delay 400)   Page/section waits: BrandLoader(64|40, delay 400)
Motion source of truth: docs/brand/loader/*.json (MUT-203) ──parity tests──▶ Dart table, SVG data
```

- `[P2] (confidence: 6/10) mut-206-brand-loader.md D5 — "During the delay it renders the same <svg> empty"`. An inline SVG's SMIL timeline starts when the element is inserted, so animations added to the reused placeholder would start 0.4 s into the loop. Medium confidence; verify this is actually an issue in Safari and Chrome. **Correction applied (A1):** key the placeholder and shown SVGs differently, so a fresh element mounts. This doesn't change behaviour: the plan intends the loop to start at frame 0.
- `[P3] (confidence: 7/10) mut-207-boot-splash.md Implementation 5 — "resolve to files inside the dist"`. Vite inlines assets under `assetsInlineLimit` (4 KB); `mark.svg` is 8,103 B only because of its C2PA blob. **Correction applied (A2):** the rule also accepts `data:` URIs.
- `[P3] (confidence: 8/10) sequencing`: MUT-206 edits `index.css`/`hosted.css`, which MUT-103 (In Review) also sweeps, and MUT-204/205 sit beside MUT-208 (In Progress; it edits `app_router_redirect_test.dart`). Already covered by both briefs' build notes, so no new action.

Production failure per new path:
- **iOS launch screen cache**: after an app update, iOS can show the old (white) launch screen until the cache refreshes. There is no in-app handling; the MUT-205 QA step deletes the app first. Users see a one-time stale frame, not an error.
- **boot-splash.css missing or a broken hash**: the 80 px mark renders unstyled at the top left. Caught pre-release by the check-bundles rule.
- **`/v1/me` hangs**: the loader keeps blooming until the existing AuthGate query errors, which shows BootUnreachable as today.

Dispositions: A1 corrected; A2 corrected; A3 covered by the existing build notes.

## Section 2: Code quality

- `[P3] (confidence: 8/10) mut-206-brand-loader.md Tests — "fake timers advanced 400 ms"` in page tests that run fake-indexeddb and TanStack Query; fake timers there can stall promises. **Correction applied (Q1):** use real timers and `findByRole`.
- `[P3] (confidence: 9/10) src/pages/settings/ImportDataPage.tsx:451 — <h3>Importing data...</h3>` plus ~12 more English literals beside a MUT-206 site → **R4, D5 answer C: localise the page in MUT-206.**
- `[P3] (confidence: 9/10) mutaba3a-flutter/mutaba3a/CLAUDE.md:25 — "qa/ is not set up in this repo yet."` (stale since e7f90c05) and `:27` `API_BASE_URL` (renamed) → **R5, D6 answer A: fix in MUT-204's first commit.**
- Shared code: the 400 ms delay exists once per runtime (`MMotion.loaderDelay` in Dart, `LOADER_DELAY_MS` in TS, replacing the portal's `SPINNER_DELAY_MS`). A cross-language extraction doesn't apply, and no other extraction candidate was found.

Dispositions: Q1 corrected; R4 approved (C); R5 approved (A).

## Section 3: Tests

```
CODE PATHS                                             USER FLOWS
[+] mutaba3a_loader.dart (MUT-204)                     [+] iPhone waits
  ├── keyframes vs JSON        [★★★ PLANNED] T1          ├── [★★★ PLANNED] slow categories → loader → list (ios.brand.loader-slow-list) [→E2E]
  ├── loop seam / frame0=mark  [★★★ PLANNED] T2-3        └── [MANUAL] Reduce Motion still mark (unit T5 covers logic)
  ├── paint() transform/colour [★★★ PLANNED] T9 probes (R2)
  ├── delay / dispose          [★★★ PLANNED] T6, T8    [+] iPhone launch
  └── reduce motion / l10n     [★★★ PLANNED] T5, T7      ├── [★★★ PLANNED] slow /me → splash → bloom → Capture (ios.launch.splash-handoff) [→E2E]
[+] SplashScreen + native config (MUT-205)               └── [MANUAL] native frame, light/dark (pre-Flutter, can't automate)
  ├── colours / centre / 400 ms [★★★ PLANNED] T1-4
  └── yaml / storyboard / v31   [★★ PLANNED] T5-7      [+] Web and portal waits
[+] BrandLoader + data (MUT-206)                         ├── [★★★ PLANNED] slow Reports chunk (web.brand.loader-slow-route) [→E2E]
  ├── parity vs JSON           [★★★ PLANNED]             └── [★★★ PLANNED] slow /v1/me (portal.signin.boot-slow-session) [→E2E]
  ├── delay / key / dispose    [★★★ PLANNED]
  ├── reduced motion / no style[★★★ PLANNED]           [+] First paint
  ├── token colours 4 states   [★★★ PLANNED]             ├── [★★★ PLANNED] JS-off web/portal splash (web.brand.boot-splash, portal.signin.boot-splash) [→E2E]
  └── old spinner CSS gone     [★★ PLANNED]              └── [★★★ PLANNED] hand-off box equality (portal) [→E2E]
[+] ImportDataPage copy (R4)   [★★ PLANNED] ar heading + Latin-literal guard
[+] Boot splash (MUT-207)
  ├── heads markup / CSP       [★★★ PLANNED] brand-head 1-2
  ├── BootSplash ≡ HTML        [★★★ PLANNED] brand-head 3
  ├── css hexes = tokens       [★★ PLANNED] brand-head 4
  ├── CheckingSession phases   [★★★ PLANNED] BootScreens 5-6
  └── built heads resolve      [★★★ PLANNED] check-bundles rule (data: URIs too)

COVERAGE: 27/29 paths have planned tests | 2 manual (native launch frame, iOS Reduce Motion toggle)
QUALITY: mostly ★★★ | GAPS: 1 found and closed (paint() render proof → R2 pixel probes)
```

- `[P2] (confidence: 8/10) mut-204-bloom-loader.md D6 — "No golden files"`: nothing proved `paint()`. **R2, D3 answer A: pixel probes added (test 9); MUT-204's AC is amended on Jira.**
- LLM/eval scope: none.
- Test Plan artifact: `~/.gstack/projects/vAWK3-mutaba3a/basel-main-eng-review-test-plan-20261015-010443.md`.

Dispositions: R2 approved (A).

## Section 4: Performance

No issues found. Each loader runs one 60 fps ticker (iPhone) or one SMIL timeline (web), only while it is mounted, and none runs under reduced motion. The web data is about 6 KB raw (about 1.5 KB gzipped) in the shared chunk, and boot-splash.css is about 300 B (cached immutable on the portal). The iPhone splash PNGs aren't bundled.

## Outside voice

Unavailable: the Codex CLI isn't installed, and the native fallback needs TaskOutput, which this session lacks. Logged as `codex-plan-review` `unavailable`. No outside coverage is claimed.

## NOT in scope
- An Android per-platform splash size → a MUT follow-up Task (R3).
- An external `boot-theme.js` honouring an explicit in-app theme before JS: rejected (MUT-207 D6).
- iOS PWA `apple-touch-startup-image` sets: the manifest `background_color` covers Android PWA.
- The portal `Skeleton`s, button spinners and `BusinessesGate`: kept (MUT-206 D6).
- iPad-specific QA: iPhone first.
- ImportDataPage flow tests (TD-113) stay open; R4 adds copy coverage only.

## What already exists
- `BrandMark`/`Wordmark` (MUT-104, ADR-073): the mark asset pipeline, reused for the splash `<img>` and CheckingSession.
- `usePrefersReducedMotion` (PATTERNS:1750): the reduced-motion source for SMIL.
- The brandCss evaluator (`src/test/css/brandCss.ts`): proves the new `--mark-*` tokens in four theme states.
- `check-bundles.ts` "url() resolves" rule: the model for the boot-splash asset rule.
- MUT-208's `integration_test/qa/support.dart`: `coldStart(dio:)` for both iPhone QA flows.
- The delivered `mutaba3a_loader.dart` and `mutaba3a-loader.js`: ported, not rewritten.

## Worktree parallelization

| Step | Modules touched | Depends on |
|------|----------------|------------|
| MUT-203 kit | mini-crm docs/brand | — |
| MUT-204 loader | flutter lib/presentation/{widgets,theme,l10n,screens}, test/, integration_test/qa | MUT-203 |
| MUT-205 splash | flutter ios/, android/, lib/presentation/{screens/splash,routes}, assets/splash | MUT-204 |
| MUT-206 loader | mini-crm src/components/brand, src/pages, src/components/drawers, src/hosted, src/styles, i18n | MUT-203 |
| MUT-207 splash | mini-crm index.html, hosted.html, src/styles/brand, src/components/brand, src/hosted/pages/auth, scripts | MUT-206 |

Lane A (flutter): MUT-204 → MUT-205. Lane B (mini-crm): MUT-206 → MUT-207. Execution: land MUT-203, then launch A and B in parallel (different repos, no shared files). Conflict flags: MUT-206 vs MUT-103 (CSS files); MUT-205 vs MUT-208 (router tests).

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above.

- [ ] **T1 (P2, human: ~20 min / CC: ~3 min)** — BrandLoader — key the placeholder and shown `<svg>` apart so SMIL starts at frame 0
  - Surfaced by: Architecture — A1
  - Files: src/components/brand/BrandLoader.tsx, __tests__/BrandLoader.test.tsx
  - Verify: `npm run test:run -- BrandLoader`; manual Safari and Chrome look at the first bloom
- [ ] **T2 (P3, human: ~20 min / CC: ~3 min)** — check-bundles — accept `data:` URIs in the boot-splash asset rule
  - Surfaced by: Architecture — A2
  - Files: scripts/check-bundles.ts
  - Verify: `npm run test:bundles`
- [ ] **T3 (P3, human: ~30 min / CC: ~5 min)** — page tests — real timers + `findByRole` for the loader
  - Surfaced by: Code quality — Q1
  - Files: ClientsPage.test.tsx, ProjectsPage.test.tsx, OverviewPage.test.tsx
  - Verify: `npm run test:run`
- [ ] **T4 (P2, human: ~3h / CC: ~20 min)** — ImportDataPage — localise all user-visible strings (en/ar) with a copy test and a Latin-literal guard
  - Surfaced by: Code quality — R4 (D5 C)
  - Files: src/pages/settings/ImportDataPage.tsx, src/lib/i18n/translations/{en,ar}.json, src/pages/settings/__tests__/ImportDataPage.copy.test.tsx
  - Verify: `npm run test:run -- ImportDataPage`
- [ ] **T5 (P2, human: ~1h / CC: ~10 min)** — Mutaba3aLoader — rendered pixel-probe test (both palettes)
  - Surfaced by: Tests — R2 (D3 A)
  - Files: test/presentation/widgets/mutaba3a_loader_test.dart
  - Verify: `flutter test test/presentation/widgets/mutaba3a_loader_test.dart`
- [ ] **T6 (P3, human: ~5 min / CC: ~1 min)** — Flutter CLAUDE.md — correct the qa/ and define lines in MUT-204's first commit
  - Surfaced by: Code quality — R5 (D6 A)
  - Files: mutaba3a-flutter/mutaba3a/CLAUDE.md
  - Verify: read-through
- [ ] **T7 (P3, human: ~10 min / CC: ~2 min)** — Jira — file the Android splash-size follow-up and amend MUT-204's AC (goldens → pixel probes)
  - Surfaced by: TODO — R3 (D4 A); Tests — R2
  - Files: none (Jira MUT)
  - Verify: the ticket exists and links MUT-205; MUT-204 has the AC comment

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is (D1 Original arrangement; R1 approved A)
- Architecture Review: 3 issues found (A1, A2 corrected; A3 already covered)
- Code Quality Review: 3 issues found (Q1 corrected; R4, R5 approved)
- Test Review: diagram produced, 1 gap identified (R2, closed with pixel probes)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 3 items proposed to user (R3 Jira follow-up, R4 build now, R5 build now)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (CLI not installed; no TaskOutput for the native fallback)
- Parallelization: 2 lanes, 2 parallel / MUT-203 first, then sequential within each lane
- Lake Score: 2/4 (D5 and D6 picked 10/10 options; D3 and D4 picked 9/10)

# Design review (/plan-design-review, 2026-10-15) — target: the Loader & Splash plan set

Target: MUT-204, MUT-205, MUT-206 and MUT-207 briefs, reviewed against the delivered Claude Design file `Loader & Splash.dc.html` and its reference renders. The art is fixed; this review covered behaviour. Mode: all 7 passes, text only, no AI mockups (D1). Outside voice: one independent Claude subagent (D2); Codex isn't installed. Each approved fix is written into its brief's **Design review amendments** section (DR1–DR18).

## System audit
- There is no DESIGN.md. The Brand v2 kit (`docs/brand/README.md`, `mutaba3a.tokens.json`, `brand/mutaba3a-theme.css`, PATTERNS) is the design system, and the delivered Claude Design file is the visual source.
- UI scope: launch and boot screens and every page, section and drawer loading state on iPhone, web and portal.
- Verified while reviewing: `/splash` uses `builder:` with `CupertinoPageTransitionsBuilder` (`mutaba3a_theme.dart:352-355`), so Capture slid in sideways. `.loading` is a padded flex box with no min-height (`index.css:3271`). The portal `meQuery` has `retry: false` but no fetch timeout (`me.tsx:15-20`, `client.ts:112,175`). RTL flips are opt-in classes only (`index.css:3303`), so the loader is never mirrored. Flutter `liveRegion` announces on iOS and Android (api.flutter.dev, `SemanticsProperties.liveRegion`). The landing fallback renders inside `LandingProviders` (Theme and Language).
- Suppressed reviewer findings: "the splash can reappear mid-session" (`AppLockChecking` is constructor-only, and `AuthAuthenticating` recurs only during sign-in, which stays on `/sign-in`); "liveRegion doesn't announce on iOS" (contradicted by the Flutter docs).

## Litmus scorecard (classifier: OPERATE, loading states; boot splash is brand-first)
```
  Check                                    Claude(sub)  Primary  Consensus
  1. Brand unmistakable in first screen?   YES          YES      CONFIRMED
  2. One strong visual anchor?             YES          YES      CONFIRMED
  3. Scannable by headlines only?          n/a          n/a      no headlines
  4. Each section has one job?             YES          YES      CONFIRMED
  5. Cards actually necessary?             none used    none     CONFIRMED
  6. Motion improves hierarchy/atmosphere? YES          YES      CONFIRMED
  7. Premium without decorative shadows?   YES          YES      CONFIRMED
  Hard rejections triggered:               0            0
```

## Passes
| Pass | Before | After | Decisions | Remaining gap |
|---|---|---|---|---|
| 1 Information architecture | 6 | 9 | D3 placement (DR1), D4 route loader 64 (DR2) | none material |
| 2 Interaction states | 4 | 9 | D5 fades (DR3), D6 splash fade (DR4), D7 3 s caption (DR5), D8 portal 15 s timeout (DR6), D9 reduced-motion word (DR7), D10 loader only when empty (DR8) | error screens reuse the existing ones (by design) |
| 3 Journey | 6 | 9 | D11 boot delay from page start (DR9), D12 landing fallback blooms (DR10), D13 chained waits (DR11) | the DR5 caption counts from mount, not page start (not decided; low impact) |
| 4 AI slop | 10 | 10 | none | none |
| 5 Design system | 7 | 9 | D14 boot theme (DR12), D15 one label (DR13) | no DESIGN.md (the kit serves) |
| 6 Responsive & a11y | 5 | 9 | D16 persistent live region (DR14), D17 splash label (DR15), D18 iPad + desktop RTL checks (DR16) | NVDA check is manual |
| 7 Decisions | | | D19 launch 144 pt (DR17), D20 boot 80 px (DR18) | 0 unresolved |

Storyboard (Pass 3, after fixes):
```
STEP | USER DOES                     | USER FEELS        | PLAN SPECIFIES
1    | taps icon / opens URL         | anticipation      | canvas + mark from the first frame; VoiceOver hears "Mutaba3a" (DR15)
2    | waits 0.4 s+                  | "is it working?"  | the mark blooms in place; slow loads bloom at once (DR9, DR10)
3    | waits 3 s+                    | doubt             | "Still connecting…" / "Still loading…" (DR5); portal Retry at 15 s (DR6)
4    | data ready                    | relief            | 150 ms cross-fade; the splash dissolves into the app (DR3, DR4)
5    | web route → page data         | continuity        | same size and spot, no blank gap (DR2, DR11)
6    | Reduce Motion on              | clarity           | still mark + visible "Loading" (DR7)
```

## NOT in scope
- AI mockups: the art is delivered, with real renders (D1).
- A slow caption timed from page start: not decided; the caption counts from mount.
- An Android launch size: the MUT follow-up from eng review R3.
- New error screens: the existing BootUnreachable and site error states are reused.

## What already exists
- Brand v2 tokens and the three-selector theme cascade (reused for the mark fills and `--duration-fade`).
- `BrandMark`/`Wordmark`, `usePrefersReducedMotion`, `MMotion`, the `appTitle` l10n key, `BootUnreachable` with Retry, and `.loading`.

## TODOS
None remain. Every gap found was approved into scope (D3–D20).

## Design Implementation Tasks
- [ ] **DT1 (P2, human: ~2h / CC: ~15 min)** — loaders, both platforms — placement rules and route loader 64 (DR1, DR2). Files: the MUT-204 sites, `index.css`/`hosted.css` `.loading`/`.loading--section`, `router.tsx`. Verify: site tests and the CSS evaluator.
- [ ] **DT2 (P2, human: ~3h / CC: ~20 min)** — loaders — fade in and cross-fade out, plus `MMotion.loaderFade` / `--duration-fade` (DR3). Verify: the opacity tests.
- [ ] **DT3 (P2, human: ~1h / CC: ~10 min)** — iPhone router — fade pages on the four top-level routes (DR4). Verify: the router test.
- [ ] **DT4 (P2, human: ~2h / CC: ~15 min)** — loaders and splash — the 3 s slow caption and its keys (DR5). Verify: the caption tests and the QA delays (4 s).
- [ ] **DT5 (P2, human: ~1h / CC: ~10 min)** — portal — the `meQuery` 15 s timeout leading to BootUnreachable (DR6). Verify: the fake-timer test.
- [ ] **DT6 (P2, human: ~1h / CC: ~10 min)** — loaders — the reduced-motion visible label (DR7). Verify: the reduced-motion tests and the QA `reducedMotion` run.
- [ ] **DT7 (P2, human: ~1h / CC: ~10 min)** — sites — the loader-only-when-empty audit and regression tests (DR8).
- [ ] **DT8 (P2, human: ~1.5h / CC: ~10 min)** — boot — the page-start delay, the BootSplash bloom and the boot theme rules (DR9, DR10, DR12). Verify: the `bootDelayMs` tests and Test 4 × 4 states.
- [ ] **DT9 (P2, human: ~1h / CC: ~10 min)** — BrandLoader — chained-wait skip (DR11).
- [ ] **DT10 (P2, human: ~1.5h / CC: ~10 min)** — a11y — the persistent live region, `loaderLabel`, the splash `appTitle` label (DR13–DR15). Verify: the status tests and a manual NVDA check.
- [ ] **DT11 (P3, human: ~1h / CC: ~10 min)** — tests — the iPad 507×1024 window case and Playwright 1440×900 RTL/LTR (DR16).

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
