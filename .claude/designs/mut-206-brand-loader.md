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
| D5 | **API**: `<BrandLoader size={24 \| 40 \| 64 \| 96} label?={string} delay?={ms} className? />`. The default label is `t('common.loading')`, present in both the app and portal dictionaries. The default delay is **`LOADER_DELAY_MS = 400`**, exported and reused by `CheckingSession` in place of its own `SPINNER_DELAY_MS`. Markup: `<span role="status" aria-label={label} className="brand-loader …">` around `<svg aria-hidden="true" focusable="false" width={size} height={size}>`. During the delay it renders the same `<svg>` **empty** with no role: the same footprint and no announcement. | Sizes are the designed set plus 96 (MUT-207's splash). A typed union stops a sub-24 inline use. `status` and a label is the a11y pattern the portal already uses. An equal footprint means no layout shift. |
| D6 | **Sites** (sizes): full-page `.loading` → 64; section, list and drawer body → 40; `DemoSeedModal` and the import step → 64 (they keep their text); `PageLoader` → 40, centred in `.loading` (its inline `style` is deleted); portal `CheckingSession` → 40 (layout unchanged; MUT-207 reshapes it). **Kept**: the `Button`/`hp-inline-spinner` 16 px inline spinners, the portal `Skeleton`s (they reserve layout, a different job), `ProfileSwitcher`'s skeleton, `BusinessesGate`'s blank root gate, and `LandingLoader` (MUT-207 owns it). | The ticket's split: page and section waits get the brand; inline and skeleton patterns stay. |
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
- Updated: `ClientsPage.test.tsx:456`, `ProjectsPage.test.tsx:238`, `OverviewPage.test.tsx:333,397` assert `findByRole('status', { name: /loading/i })` with fake timers advanced 400 ms. `auth-states.test.tsx:34` is unchanged and must stay green.
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
