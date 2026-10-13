# MUT-77 — Landing: frosted sticky header, restrained motion (Brand v2 re-cut)

Status: PLAN (eng-ticket 2026-10-14) · Epic MUT-74 (Apple-design pass) · Blocker MUT-102 **Done**
Brief: `.claude/designs/landing-apple-redesign.md` L9, L10 and the craft fixes F9–F12. The ticket's
"Re-cut for Brand v2" section wins: L11 type moved to MUT-102, and motion uses the MUT-102 tokens.

## 1. Where the ticket stands against main (8b07277)

Main has moved since the ticket was written. MUT-76, MUT-102, MUT-103 and MUT-104 already closed part of it:

| AC (revised) | State on main | Work left |
|---|---|---|
| Header button only when the hero button is off-screen (IntersectionObserver) | Header is a floating language toggle only | **Build** |
| `prefers-reduced-transparency` → solid bar | No bar | **Build** |
| Every landing button has a pointer-down press state | Hero CTA and get-it cards have hard-coded `:active` (0.97/0.1s, 0.98). The language toggle and FAQ buttons have none | **Tokenise and complete** |
| No `transition: all` | None in landing CSS. `theme.css:533` keeps an **unused** `.transition-all` utility | **Delete the utility** and add a guard test |
| Light-mode hover bug; styles follow `prefers-color-scheme` | Fixed in passing by MUT-76. The hero CTA is `--text` on `--bg` with an opacity hover, and no `[data-theme]` selector is left in landing CSS | **Regression test only** |
| Headlines and body in Brand v2 type, EN and AR | Done by MUT-102, which `brand.spec.ts` checks | **Nothing.** Re-run the existing spec |
| `<title>` follows the active language | `index.html` has a static `<title>متابعة</title>` and no code sets `document.title` | **Build** |
| No overlap at 375 in EN or AR | The fixed toggle overlays the hero | **Fixed by the in-flow sticky bar**, plus a test |
| No negative tracking on Arabic | `:lang(ar) .landing-headline-large { letter-spacing: 0 }` exists | Guard test only |

## 2. Neighbourhood

- **Blocked by MUT-102: Done.** MUT-104 (wordmark, theme-color; In Review) and MUT-103 (token sweep) are **merged to main**. Build on them and do not redo them.
- **MUT-104:** `BrandMark` (`src/components/brand/BrandMark.tsx`) follows the in-app theme and swaps mark/mark-dark. The hosted `Wordmark` (`src/hosted/components/Brand.tsx`) is the same lockup. ADR-073 settles that link previews are built in Arabic at build time, so **leave `index.html`'s `<title>` alone**: it is the no-JS and crawler default.
- **MUT-91** (portal press feedback) and **MUT-165** (spacing guard): the press rule here must use the same tokens (`--press-scale`, `--duration-press`), so MUT-91 can copy it, and must use spacing tokens only.
- **MUT-171..174** (new landing sections) and **MUT-154** (cookieless CTA-click counting): the header CTA is a second CTA. Keep a stable `data-part="header-cta"` so MUT-154 can count it next to `hero`. **No section links** (L9), even though MUT-171 adds sections.
- **MUT-109** (TD-048 RTL direction) touches `:lang()` rules. This plan adds no `dir` or `:lang()` font rules.
- **TD-081:** landing LCP is already +628 ms from the `.otf` files. This ticket must not add JS to the landing chunk's critical path: **no `motion` import on the landing**, and CSS transitions only.

## 3. Plan by file

### 3.1 Shared hooks (`src/hooks/`)
- **`useInView.ts`** (new): `useInView(ref, options?) → boolean | null`.
  - One IntersectionObserver per call, disconnected on unmount.
  - Returns `null` until the first callback, and stays `null` if IntersectionObserver is missing.
  - Callers decide the fallback.
  - No scroll listeners anywhere ("nothing scroll-linked", L10).
- **`useDocumentTitle.ts`** (new): sets `document.title` and restores the previous title on unmount, so the landing → `/privacy` navigation doesn't leak a title.

Both get registered in COMPONENT_REGISTRY.

### 3.2 One source for the device CTA (DRY)
- **`src/pages/landing/useHeroCta.ts`** (new): lift the `CTA` record and the `chooseHeroCta(currentDevice(), release?.hasWindowsBuild !== false)` call out of `HeroSection.tsx`.
- Both `HeroSection` and `LandingHeader` read it, so the header button **always matches** the hero button: same href, icon and label.
- `heroCta.ts` (the pure choice) stays and keeps its tests.
- `useLatestRelease` is called once in `LandingPage` and passed down, to avoid a second fetch. Check first whether the hook already dedupes, and keep whichever is cheaper.

### 3.3 Wordmark: extend, don't duplicate
- Move `Wordmark` from `src/hosted/components/Brand.tsx` to **`src/components/brand/Wordmark.tsx`** with props `{ name: string; markSize?: number; className? }`.
- Hosted re-imports it, passing `t('hosted.brand')`. Its behaviour and tests are unchanged, and `hp-wordmark` styles stay in hosted CSS via `className`.
- The landing passes `t('landing.header.wordmark')`, which reads "Mutaba3a · متابعة" in both languages.
- The import direction stays legal: hosted → components, never components → hosted.

### 3.4 `LandingHeader.tsx` (rewrite)
Props: `{ cta: HeroCtaConfig; showCta: boolean; scrolled: boolean }`.

```
<header class="landing-header" data-scrolled>
  <a href="#top" class="landing-header-brand" aria-label={t('landing.header.home')}><Wordmark/></a>
  <div class="landing-header-actions">
    <LanguageToggle/>                         (existing button; aria-label via i18n, not the hard-coded English)
    <a data-part="header-cta" class="landing-header-cta" data-visible={showCta}>{icon}{short label}</a>
  </div>
</header>
```

**Hidden CTA:**
- It uses `visibility: hidden` and `opacity: 0`. The visibility transition is delayed by the fade duration, so the button leaves the tab order and the accessibility tree.
- No `inert` or `tabIndex` juggling.
- Showing it is an opacity cross-fade over `--duration-toggle` (350 ms).

**Short labels:** new keys `landing.header.cta.{mac,windows,web}` ("Download", "Download", "Open the app" / Arabic). The hint line is dropped in the bar, so it fits at 375.

### 3.5 `LandingPage.tsx` wiring
- `heroCtaRef` is forwarded into `HeroSection`'s primary `<a>`. Then `showCta = useInView(heroCtaRef) === false`, so while it's unknown the button stays hidden.
- A zero-height `#top` sentinel goes before the header, and `scrolled = useInView(topRef) === false` drives the scroll-edge fade.
- `useDocumentTitle(t('landing.meta.title'))`.
- Add one passive no-op `touchstart` listener on the page root (an effect with cleanup). Without it, iOS Safari never applies `:active`, and the press state wouldn't exist on the phones L10 is for.

### 3.6 CSS (`LandingPage.css` / `HeroSection.css`)

**Bar:**
- `position: sticky; top: 0`, in flow.
- Background: `color-mix(in oklab, var(--bg) 72%, transparent)`.
- `backdrop-filter` plus the `-webkit-` prefix, since the Safari 16.2 floor (TD-088) needs it.
- An `@supports not (backdrop-filter…)` fallback and `@media (prefers-reduced-transparency: reduce)` both give a solid `var(--bg)`.
- Hero `padding-top` drops by the bar height, because the bar now takes up space.

**Scroll-edge fade:**
- `.landing-header::after` is a token-coloured gradient strip with no border.
- It is `opacity: 0` by default and `1` when `[data-scrolled]`.

**Press rule:** one block, "Press feedback (L10)".
- Filled and bordered buttons get `transform: scale(var(--press-scale))` on `:active` with `transition: transform var(--duration-press) var(--ease-spring)`. Those are the hero CTA, the header CTA, the language toggle, the get-it cards and the FAQ questions.
- Text links (`.hero-cta-alt`, footer and get-it meta links) dim with `opacity` on `:active`.
- The hard-coded 0.97/0.98/0.1s values are replaced.
- The per-file `prefers-reduced-motion` press overrides are removed, because the tokens already zero under reduced motion (theme.css:110).

**Chapter reveal (L10):**
- `.landing-chapter-visual[data-reveal="pending"]` sits at `opacity: 0; translate: 0 var(--m-stagger-rise)`.
- `[data-reveal="done"]` moves to 0/1 over `var(--duration-nav)` (420 ms) with `var(--ease-spring)`, once.

**Delete:** the unused `.transition-all` utility in `theme.css`. `grep` finds no users.

### 3.7 Chapter reveal hook: `src/pages/landing/useRevealOnce.ts`
- It sets `data-reveal="pending"` in a layout effect only when all of these hold:
  - IntersectionObserver exists;
  - reduced motion is off (`usePrefersReducedMotion`);
  - the element is below the viewport at mount.
- On the first intersection it sets `done` and unobserves.
- **Content is never hidden when JS, IntersectionObserver or motion is unavailable**, and never above the fold, so it can't hurt LCP.
- `ChapterSection` calls it on its `<figure>`.

### 3.8 i18n (en + ar)
New keys:
- `landing.meta.title` (EN "Mutaba3a — Track your finances, securely", AR "متابعة — تابع مالك، بأمان");
- `landing.header.{wordmark,home,cta.mac,cta.windows,cta.web}`;
- `landing.langToggle.label` (replaces the hard-coded `aria-label`).

Both languages ship in the same commit, and the parity test covers them.

## 4. Tests (TDD: written first, red then green)

**Vitest** (`npm run test:run`, Node 22 per TD-054):
1. `src/hooks/__tests__/useInView.test.ts`:
   - `null` before the first callback;
   - true/false on stubbed IntersectionObserver entries;
   - disconnects on unmount;
   - `null` when IntersectionObserver is missing.
2. `src/hooks/__tests__/useDocumentTitle.test.ts`: sets the title, updates it on change, restores it on unmount.
3. `src/components/brand/__tests__/Wordmark.test.tsx`: renders the mark and the name. The hosted `Brand.test.tsx` stays green unchanged.
4. `src/pages/landing/__tests__/LandingHeader.test.tsx`:
   - the wordmark is present;
   - the toggle's aria-label comes from i18n in EN and AR;
   - with `showCta=false`, the CTA has `data-visible="false"`;
   - with `true`, it shows and its href equals the hero's for mac, windows and web.
5. `LandingPage.test.tsx` (extend):
   - stub IntersectionObserver: hero CTA intersecting → header CTA hidden; not intersecting → shown;
   - unknown → hidden;
   - `document.title` is the EN title, then the AR title after toggling the language.
6. `useRevealOnce.test.tsx`:
   - pending below the fold, done after an intersection;
   - never pending with reduced motion, without IntersectionObserver, or when the element starts in view.
7. `src/pages/landing/__tests__/landingCss.test.ts` (CSS text guard, the same approach as `src/styles/__tests__/brand.test.ts`):
   - no `transition:\s*all` in landing CSS or `theme.css`;
   - no `[data-theme` selector in landing CSS;
   - every press selector uses `var(--press-scale)` and `var(--duration-press)`, with no literal scale;
   - the header has a `prefers-reduced-transparency` block with an opaque background;
   - `:lang(ar)` headline `letter-spacing: 0`.

**Playwright**: `qa/specs/web/landing.spec.ts` (new), run on a preview build per [[qa-run-on-preview-builds]]:
1. `@web.landing.header-cta`: at load the header CTA is hidden. After scrolling the hero CTA out of view it is visible, with the same href as the hero's. After scrolling back it is hidden again. Uses the real IntersectionObserver.
2. `@web.landing.transparency`: through a CDP `Emulation.setEmulatedMedia` `prefers-reduced-transparency: reduce`, the computed `backdrop-filter` is `none` and the background alpha is 1.
3. `@web.landing.press`: on `mouse.down()` over each button class the computed transform is a scale of 0.96. With `reducedMotion: 'reduce'` it is 1.
4. `@web.landing.hover-light`: with `colorScheme: 'light'` and no `data-theme`, hovering the hero CTA keeps a text/background contrast of at least 4.5.
5. `@web.landing.375`: at 375×812 in EN and AR, the header box doesn't intersect any hero element, `expectNoHorizontalOverflow` passes, and the CTA is visible after scrolling.
6. `@web.landing.title`: `<title>` is EN, then AR after the toggle.
7. `@web.landing.reveal`: the chapter figure reaches opacity 1 after scrolling. With reduced motion it is opacity 1 at load and never pending.
8. Extend `brand.spec.ts` `contrast-landing`: also run axe **scrolled**, with the frosted bar over chapter content, in light and dark.

**Gate:** `npm run lint` · `npm run typecheck` · `npm run test:run` · `npm run build` · `npm run test:bundles`, plus the qa landing and brand specs.

## 5. Quality bar

- **DRY:** one CTA source (`useHeroCta`), one Wordmark, one press rule on tokens, and the existing `usePrefersReducedMotion` reused.
- **Testable:** IntersectionObserver, title and reveal are in hooks with stubbed boundaries. The CSS contracts are text-guarded in Node, and behaviour is checked in a real browser.
- **Scalable / cost:** three observers on the page at most (hero CTA, top sentinel, and one per chapter, which disconnect after revealing). No scroll handlers, no new dependency, and no `motion` on the landing chunk. Bundle change ≈ +1 kB. Watch TD-081: measure LCP once (Fast 3G, 4× CPU, median of 5) against main's figure.
- **Constraints:**
  - i18n EN and AR, with RTL via logical properties (`inset-inline-*`, `padding-inline`).
  - Tokens only, for MUT-103 and MUT-165.
  - Safari 16.2 floor.
  - Reduced motion and reduced transparency respected.
  - No new pattern without a PATTERNS entry. "IntersectionObserver hook instead of scroll listeners" is new, so add it.

## 6. Decisions for review

- **D1, the reveal under reduced motion.** The brief says "cross-fades only", but `theme.css:416` forces every transition to 0.01 ms `!important` under reduced motion.
  - **Recommend:** no hidden state at all under reduced motion; the figure is simply there. This is stricter than a cross-fade and needs no `!important` fight.
  - Alternative: an opacity-only fade that overrides the global rule.
- **D2, header CTA copy at 375.** Use a short label with no hint (recommended) or an icon-only button with an aria-label.
- **D3, move the hosted `Wordmark` to `components/brand`** (recommended) or build a landing-only lockup.
- **D4, title strings.** EN "Mutaba3a — Track your finances, securely" and AR "متابعة — تابع مالك، بأمان", matching MUT-104's D9 headline.

## 7. Knowledge updates owed on build

- CHANGELOG.
- COMPONENT_REGISTRY: `useInView`, `useDocumentTitle`, `Wordmark` moved, `useHeroCta`, `useRevealOnce`.
- PATTERNS: IntersectionObserver over scroll listeners, and the press-feedback token rule.
- TEST_PLAN.
- TECH_DEBT: note `/privacy` and `/download` titles if they're left out. Next free number is TD-120; re-check first.
- No ADR is expected. If D1 takes the alternative, record it in ADR-074.
- `docs/roadmap/ROADMAP.md`, if MUT-74 milestones are tracked there.

---

# Eng review (/plan-eng-review, 2026-10-14)

Target: `.claude/designs/mut-77-landing-header-motion.md` (this file; sections 1–7 above are the original plan, unchanged).

## Scope record

feature answers: none proposed (every item maps to an AC or brief L9/L10); structure: B "Smaller arrangement" (D1, 2026-10-14); accepted scope: the plan above with `useDocumentTitle` inlined as an effect in `LandingPage` (no restore-on-unmount: landing → /privacy is a full page load, `src/main.tsx:79-115`) and `useRevealOnce` folded into `ChapterSection` on top of `useInView(ref, { once: true })`; Wordmark move to `src/components/brand/` and `useHeroCta` kept; pending remedies: R1 (useLatestRelease in-flight dedupe), R2 (reduced-transparency default given Safari), plan §6 D1 (reveal under reduced motion), D2 (header CTA copy), D4 (title strings).

Corrections (no behaviour change, no question):
- §3.6 reveal rise reads a new `--stagger-rise: var(--m-stagger-rise)` alias in `theme.css` (zeroed under reduced motion), not `var(--m-stagger-rise)`: no component outside `src/styles` reads a `--m-*` primitive (grep, 0 hits).
- §3.6 `color-mix(...)` in `LandingPage.css` passes MUT-103's literal guard: `COLOR_LITERAL` (`src/test/css/brandCss.ts:563`) matches `color(`, not `color-mix(`.

## Decision ledger

### R1: De-duplicate the GitHub release fetch on the landing page
Finding: S1, P2, confidence 9/10, `src/hooks/useLatestRelease.ts:30-52,85-95`, reviewer: Claude (Scope Challenge)
Plan baseline: §3.2 calls `useLatestRelease` once in `LandingPage` for hero + header; `GetItSection` keeps its own call.
Runtime evidence: the hook caches in sessionStorage only after the fetch resolves (`setCachedRelease` at :48-52), so on a first visit `HeroSection` (:34) and `GetItSection` (:13) both miss the cache and both call the GitHub API (unauthenticated limit 60/h per IP). With the plan as written: still 2 calls.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 in-flight dedupe | 2 GitHub calls per first visit | module-level in-flight promise in `fetchLatestRelease` → 1 call; one unit test | unchanged: 2 calls (plan keeps it from becoming 3) |
| Structure | B approved (D1) | unchanged | unchanged |
| R2 / §6 D1, D2, D4 | pending | pending | pending |
Question D2:
D2 — Share one in-flight GitHub release request across the landing page?
Project/branch/task: planning MUT-77 on main.
ELI10: On a first visit the hero and the "Get it" section each ask GitHub for the latest release at the same time, because the cache is only written after the first answer comes back. The header button would make it three; the plan already prevents that. Keeping one shared request in flight makes it one.
Stakes if we pick wrong: a visitor behind a shared IP (office, mobile carrier) can hit GitHub's 60 requests/hour limit sooner, and the Windows button logic then falls back.
Recommendation: A because it is ~6 lines plus one test, it halves the landing page's only third-party call, and DownloadPage and the desktop update check share the same fetch.
Completeness: A=10/10, B=7/10
Pros / cons:
A) Dedupe in flight (recommended)
  ✅ One GitHub call per first visit instead of two, across hero, header and Get it
  ✅ Fixes it once in fetchLatestRelease, so every future caller benefits too
  ❌ A small change to a shared hook that the desktop updater banner also reads
B) Leave as is
  ✅ No change outside the landing page; the diff stays strictly on MUT-77's surfaces
  ✅ The plan already stops the header from adding a third call
  ❌ First visits keep making two identical GitHub API calls
Net: six lines and a test buy half the third-party traffic.
Header: Release fetch
Options:
A) Dedupe in flight (recommended)
Module-level in-flight promise in src/hooks/useLatestRelease.ts so concurrent mounts share one fetch; unit test: two concurrent hook mounts → fetch called once. Human ~1h / CC ~5min. Low risk.
B) Leave as is
No change to useLatestRelease; LandingPage still calls it once for hero + header, GetItSection separately (2 calls). Zero effort.

State: approved
Actual answer: A) Dedupe in flight (D2, 2026-10-14)
Accepted scope: module-level in-flight promise in `src/hooks/useLatestRelease.ts` so concurrent mounts share one fetch (cleared on settle, so a failed fetch can be retried); unit test: two concurrent hook mounts → fetch called once. LandingPage still calls the hook once for hero + header.
History: none

### R2: Default bar surface, given Safari ignores prefers-reduced-transparency
Finding: S2, P2, confidence 7/10 (web sources disagree on support; no live Safari probe), plan §3.6 "Bar" bullets, reviewer: Claude (Scope Challenge search)
Plan baseline: frosted by default (`color-mix(in oklab, var(--bg) 72%, transparent)` + `backdrop-filter`); solid `var(--bg)` under `@media (prefers-reduced-transparency: reduce)` and `@supports not (backdrop-filter…)`.
Runtime evidence: unknown in-repo (no bar exists yet). Sources: buildmvpfast 2026 says Safari does not support the media query; web.dev lists unprefixed backdrop-filter at Safari 18. So a Safari user with Reduce Transparency on would still get the frost.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R2 default surface | plan: frosted, 72% base | frosted by default with an 85% base; solid under `reduce` and without backdrop-filter support | solid by default; frost only inside `@media (prefers-reduced-transparency: no-preference)` and `@supports (backdrop-filter…)` |
| Safari + Reduce Transparency | n/a | light frost (85% base) | solid |
| Safari, default settings | n/a | frosted | solid (query unsupported, so never matches) |
| AC "reduced transparency → solid" proof | plan: Playwright CDP in Chromium | unchanged | unchanged |
| R1 | approved A (D2) | unchanged | unchanged |
| §6 D1, D2, D4 | pending | pending | pending |
Question D3:
D3 — Should the header be frosted by default, or solid unless the browser says transparency is welcome?
Project/branch/task: planning MUT-77 on main.
ELI10: The bar blurs the page behind it, and turns solid when the visitor's system asks for less transparency. Chrome reports that setting to web pages; Safari reportedly doesn't. So we either frost by default (Safari visitors who asked for less transparency still see a little blur) or stay solid by default (and Safari visitors, most of the Mac audience the hero targets, never see the frost).
Stakes if we pick wrong: either an accessibility setting is ignored on Safari, or the L9 frosted look never ships to Mac visitors.
Recommendation: A because L9's frosted bar is the approved design, an 85% base keeps text readable even when the setting is ignored, and the gap is Safari's to close.
Completeness: A=9/10, B=9/10
Pros / cons:
A) Frosted, 85% base (recommended)
  ✅ Mac Safari visitors get the frosted bar L9 approved, which is the main audience
  ✅ An 85% base means readable text over any content, even when the setting is ignored
  ❌ Safari users who turned on Reduce Transparency still see a faint frost
B) Solid unless allowed
  ✅ No visitor who asked for less transparency ever sees blur, in any browser
  ✅ The readable state is the default, which is the safer failure mode
  ❌ Safari never matches the query, so Mac visitors always get a plain solid bar
Net: honour L9's look on Safari, or honour an OS setting Safari doesn't report.
Header: Bar surface
Options:
A) Frosted, 85% base (recommended)
Background color-mix(in oklab, var(--bg) 85%, transparent) + backdrop-filter (with -webkit-); solid var(--bg) under prefers-reduced-transparency: reduce and @supports not backdrop-filter. Same CDP test. No extra effort.
B) Solid unless allowed
Background var(--bg) by default; frost only inside @media (prefers-reduced-transparency: no-preference) and @supports (backdrop-filter). Same CDP test plus a no-preference case. No extra effort.

State: approved
Actual answer: A) Frosted, 85% base (D3, 2026-10-14)
Accepted scope: bar background `color-mix(in oklab, var(--bg) 85%, transparent)` + `backdrop-filter` and `-webkit-backdrop-filter`; solid `var(--bg)` under `@media (prefers-reduced-transparency: reduce)` and `@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))`; Playwright CDP proof in Chromium as planned. Known gap, accepted: Safari users with Reduce Transparency see the 85% frost.
History: none

Scope Challenge result: scope accepted as-is (the smaller arrangement preserves scope).

### R3: Chapter reveal under reduced motion (plan §6 D1)
Finding: A1, P2, confidence 9/10, `src/styles/theme.css:416-424` (`transition-duration: 0.01ms !important` on `*` under reduced motion) vs brief L10 "prefers-reduced-motion → cross-fades only", reviewer: Claude (Architecture)
Plan baseline: §3.7 "never pending with reduced motion": the figure is simply visible; §6 D1 recommends this.
Runtime evidence: the global reduced-motion rule makes any CSS transition effectively instant; a CSS cross-fade would need its own `!important` override. Drawers get their reduced-motion fade from `motion`'s JS `animate` (`src/components/ui/drawer/drawerMotion.ts:51`), which the landing chunk deliberately does not import (TD-081 LCP).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R3 reveal, reduced motion | n/a (no reveal yet) | no hidden state: figure visible at load, no animation | opacity-only 150 ms fade (REDUCED_MOTION_FADE_SECONDS value as a CSS token), overriding the global rule with a scoped `!important` |
| Reveal, motion allowed | plan: rise + fade, 420 ms spring | unchanged | unchanged |
| R1, R2, structure | approved | unchanged | unchanged |
| §6 D2, D4 | pending | pending | pending |
Question D4:
D4 — With reduced motion on, should chapter images simply be there, or fade in?
Project/branch/task: planning MUT-77 on main.
ELI10: With motion allowed, each chapter picture rises and fades in once as you scroll to it. People who turn on Reduce Motion shouldn't get the rise. The brief said "cross-fades only", but the app's global reduced-motion rule already makes every CSS transition instant, so a fade would need a special override. The other option is to show the pictures with no animation at all.
Stakes if we pick wrong: either a small fight with the global accessibility rule in CSS, or a slight departure from the brief's wording.
Recommendation: A because nothing moving is the strictest reading of reduced motion, it needs no `!important` override, and it matches how the global rule already treats everything else on the page.
Completeness: A=9/10, B=9/10
Pros / cons:
A) Visible, no animation (recommended)
  ✅ No hidden state at all for reduced-motion users, so content can never get stuck invisible
  ✅ No !important override of the global reduced-motion rule in theme.css
  ❌ Departs from the brief's literal "cross-fades only" wording for this one element
B) Opacity-only fade
  ✅ Matches the brief's wording, and drawers already fade the same way under reduced motion
  ✅ Still no movement, only a 150 ms opacity change
  ❌ Needs a scoped !important to beat theme.css:416, a pattern the app avoids everywhere else
Net: brief wording versus not fighting the global accessibility rule.
Header: Reduced motion
Options:
A) Visible, no animation (recommended)
Under prefers-reduced-motion the chapter figure is never set to pending; it renders visible with no transition. Test: reduced-motion load → opacity 1, never pending. No extra effort.
B) Opacity-only fade
Under reduced motion the figure starts at opacity 0 (no translate) and fades in over 150 ms, via a scoped !important transition-duration override. Test: reduced motion → no transform, opacity reaches 1. Human ~1h / CC ~10min.

State: approved
Actual answer: A) Visible, no animation (D4, 2026-10-14)
Accepted scope: under `prefers-reduced-motion: reduce` the chapter figure is never set to pending and renders visible with no transition; Vitest (never pending) + Playwright `@web.landing.reveal` (opacity 1 at load). Record the deviation from L10's "cross-fades only" wording in CHANGELOG.
History: none

### R4: Header CTA copy at narrow widths (plan §6 D2)
Finding: C1, P3, confidence 8/10, plan §3.4 "Short labels", reviewer: Claude (Code Quality)
Plan baseline: new keys `landing.header.cta.{mac,windows,web}` with short text ("Download" / "Open the app"), icon + label, no hint line, at every width.
Runtime evidence: the hero CTA labels are "Download for Mac" / "تحميل لـ Mac" / "Open the web app" (`en.json`/`ar.json` `landing.hero.ctaMac/ctaWindows/ctaWeb`); at 375 the bar must also hold the wordmark and the EN|ع toggle.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R4 header CTA content | plan: icon + short label | icon + short label at all widths (3 new keys × 2 languages) | icon + full hero label (reuse existing keys) above 480 px; icon-only with the full label as aria-label at ≤480 px |
| R1–R3, structure | approved | unchanged | unchanged |
| D4 title strings (R5) | pending | pending | pending |
Question D5:
D5 — What should the header's download button say?
Project/branch/task: planning MUT-77 on main.
ELI10: Once you scroll past the hero, a small button appears in the top bar. On a phone the bar also holds the logo and the language switch, so the hero's full "Download for Mac" won't fit. Either the bar button always says a short word with the platform icon ("Download"), or it reuses the full hero label on wide screens and drops to just the icon on phones.
Stakes if we pick wrong: a cramped or wrapping bar at 375, or an icon-only button some visitors won't read as "download".
Recommendation: A because one short label reads the same at every width, the Apple/Windows/browser icon already says which platform, and it's three keys rather than two layouts.
Completeness: A=9/10, B=9/10
Pros / cons:
A) Short label always (recommended)
  ✅ Same button at every width, so there is one layout to test at 375 and 1280
  ✅ The platform icon beside "Download" already says Mac or Windows
  ❌ Adds three new copy keys per language for Basel to approve
B) Full label, icon on phones
  ✅ Reuses the hero's existing keys, so no new copy is needed
  ✅ Wide screens show exactly the hero's wording
  ❌ Icon-only on phones is ambiguous and needs a second layout and test case
Net: three new strings buy one simple, readable button everywhere.
Header: Header CTA
Options:
A) Short label always (recommended)
Icon + landing.header.cta.{mac,windows,web} ("Download" / "تحميل", "Open the app" / "افتح التطبيق") at all widths. Test: 375 EN/AR no overlap. No extra effort.
B) Full label, icon on phones
Icon + existing landing.hero.cta* label above 480 px; icon-only button with aria-label = full label at ≤480 px. Tests: both widths, accessible name. Human ~1h / CC ~10min.

State: approved
Actual answer: A) Short label always (D5, 2026-10-14)
Accepted scope: icon + `landing.header.cta.{mac,windows,web}` ("Download" / "تحميل", "Open the app" / "افتح التطبيق") at all widths; Playwright 375 EN/AR no-overlap. Implementation note (no behaviour choice): the button's accessible name is the full hero label (`aria-label={t(label)}`), which contains the visible word (WCAG 2.5.3 label-in-name), so a screen reader hears "Download for Mac", not a bare "Download".
History: none

### R5: Page title strings (plan §6 D4)
Finding: C2, P3, confidence 9/10, `index.html:12` (`<title>متابعة</title>`, static) and no `document.title` writer in `src/`, reviewer: Claude (Code Quality)
Plan baseline: `landing.meta.title` EN "Mutaba3a — Track your finances, securely", AR "متابعة — تابع مالك، بأمان" (MUT-104 D9 headline); `index.html` stays `متابعة` as the no-JS default (ADR-073).
Runtime evidence: the tab reads "متابعة" in both languages today.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R5 title text | "متابعة" always | brand + headline: EN "Mutaba3a — Track your finances, securely", AR "متابعة — تابع مالك، بأمان" | brand only: EN "Mutaba3a", AR "متابعة" |
| index.html default | "متابعة" | unchanged | unchanged |
| R1–R4, structure | approved | unchanged | unchanged |
Question D6:
D6 — What should the browser tab say on the landing page?
Project/branch/task: planning MUT-77 on main.
ELI10: The tab title will follow the page's language. It can be just the product name, or the name plus the headline you approved in MUT-104. Search results and bookmarks show this text, so the headline version tells strangers what the product does; the name-only version is shorter in a crowded tab bar.
Stakes if we pick wrong: a vaguer search snippet and bookmark name, or a long tab title that gets cut off.
Recommendation: A because the title is what search and bookmarks show a stranger, and the approved headline says what Mutaba3a does in four words.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Name + headline (recommended)
  ✅ Bookmarks and search results say what the product does, not just its name
  ✅ Reuses the headline already approved in MUT-104, so no new copy to sign off
  ❌ Longer titles get cut off in a crowded tab bar after the brand name
B) Name only
  ✅ Shortest possible tab, matching the sidebar's plain brand name
  ✅ Identical to today's Arabic title, so only the English side changes
  ❌ A stranger seeing the bookmark or a search result learns nothing about the product
Net: a descriptive title for strangers versus a tidy tab for regulars.
Header: Page title
Options:
A) Name + headline (recommended)
landing.meta.title EN "Mutaba3a — Track your finances, securely", AR "متابعة — تابع مالك، بأمان". Test: title follows the language toggle. No extra effort.
B) Name only
landing.meta.title EN "Mutaba3a", AR "متابعة". Same test. No extra effort.

State: approved
Actual answer: A) Name + headline (D6, 2026-10-14)
Accepted scope: `landing.meta.title` EN "Mutaba3a — Track your finances, securely", AR "متابعة — تابع مالك، بأمان", set by an inline effect in `LandingPage`; `index.html` unchanged; test: title follows the language toggle (Vitest + `@web.landing.title`).
History: none

### R6: Regression contract for the shared release fetch (REGRESSION RULE, follows R1)
Finding: T1, P1 (CRITICAL: existing behaviour at risk with zero coverage), confidence 10/10, `src/hooks/useLatestRelease.ts:55` `fetchLatestRelease` (callers: `useLatestRelease` → HeroSection, GetItSection, DownloadPage; `src/hooks/useCheckForUpdates.ts:102`), reviewer: Claude (Test review)
Plan baseline: R1 approved (D2): in-flight promise dedupe + one test "two concurrent mounts → fetch called once".
Runtime evidence: `ls src/hooks/__tests__` has no useLatestRelease or useCheckForUpdates test; the sessionStorage cache (:30-52), the error path and the update check's use of the same fetch are untested today.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R6 regression contract | no tests | full contract: (1) cache hit → no fetch; (2) two concurrent mounts → one fetch, both get the release; (3) a rejected fetch → both callers get the error, `isLoading` false, and the next call fetches again; (4) `useCheckForUpdates` still calls `fetchLatestRelease` once per check and sees a fresh result after a prior settle | only R1's test (2) |
| Intended change | n/a | concurrent callers share one request | same |
| R1 dedupe | approved A | unchanged | unchanged |
Question D7:
D7 — How much of the release fetch should be pinned by tests before we change it?
Project/branch/task: planning MUT-77 on main.
ELI10: The fetch we're de-duplicating also feeds the Download page and the desktop app's "update available" check, and it has no tests today. If the shared request gets stuck after a failure, visitors could see no download button and the desktop app could stop noticing updates. We can pin the four things that must keep working, or test only the new sharing.
Stakes if we pick wrong: a silent break in the desktop update check or the download buttons that no test catches.
Recommendation: A because the fetch has two unrelated consumers and zero tests, and the failure-retry case is exactly where an in-flight cache usually breaks.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Full contract (recommended)
  ✅ Pins the cache, the sharing, the failure retry and the update check before touching them
  ✅ Catches the classic in-flight bug: a rejected promise cached forever, so no retry ever happens
  ❌ About four tests in a new file for a hook the ticket only touches lightly
B) Sharing test only
  ✅ Smallest addition, testing exactly the behaviour this ticket adds
  ✅ Keeps the test diff focused on MUT-77
  ❌ A stuck-after-failure regression or a broken update check would ship unnoticed
Net: four tests protect two unrelated features that share this fetch.
Header: Fetch tests
Options:
A) Full contract (recommended)
New src/hooks/__tests__/useLatestRelease.test.ts: cache hit → no fetch; concurrent mounts → one fetch; reject → error to both, isLoading false, next call refetches; useCheckForUpdates path still fetches per check after settle. Human ~2h / CC ~15min.
B) Sharing test only
One test: two concurrent useLatestRelease mounts → fetch called once. Human ~30min / CC ~5min.

State: approved
Actual answer: A) Full contract (D7, 2026-10-14)
Accepted scope: new `src/hooks/__tests__/useLatestRelease.test.ts`, written red before the dedupe: (1) sessionStorage cache hit → no fetch; (2) two concurrent mounts → one fetch, both get the release; (3) rejected fetch → both callers get the error, `isLoading` false, the next call fetches again; (4) `useCheckForUpdates` → `fetchLatestRelease` still fetches per check after a prior settle. Intended change: concurrent callers share one request.
History: none

## Review sections

### 1. Architecture
- `[P2] (9/10) src/styles/theme.css:416`: the global reduced-motion rule conflicts with L10 "cross-fades only" for the reveal. Disposition: accepted A (D4, R3).
- Suppressed (4/10): the sticky bar covering anchor targets. `#get-it` is a section with 112px top padding (`GetItSection.tsx:17`) and its heading lands below a ~56px bar. Implementation still checks `#get-it` in `@web.landing.375`.
- Failure path: IntersectionObserver missing → `useInView` stays `null` → header CTA hidden. The hero CTA and Get it section still offer the download, so the failure is visible to no one and harms no one. Covered by Vitest.

### 2. Code quality
- `[P3] (8/10)` plan §3.4: header CTA copy. Disposition: accepted A (D5, R4); accessible name = full hero label.
- `[P3] (9/10) index.html:12`: title strings. Disposition: accepted A (D6, R5).
- Shared code: Wordmark move (hosted `Brand.tsx:9` + landing, 2 callers; SidebarNav keeps its collapsed-aware inline lockup, which differs in behaviour) and `useHeroCta` (HeroSection + LandingHeader, 2 callers). Both approved under the D1 structure.

### 3. Tests
Framework: Vitest (`npm run test:run`, Node 22) + Playwright release-qa (`qa/specs/web`).

```
CODE PATHS                                              USER FLOWS
[+] src/hooks/useLatestRelease.ts (dedupe, R1/R6)       [+] Scroll past hero → header CTA
  ├── [GAP→R6] cache hit, no fetch                        ├── [GAP] [→E2E] appears / same href / hides on scroll back
  ├── [GAP→R6] concurrent → 1 fetch                       └── [GAP] [→E2E] 375 EN/AR no overlap, no h-scroll
  ├── [GAP→R6] reject → error both, retry next          [+] Language toggle
  └── [GAP→R6] useCheckForUpdates path                    └── [GAP] title EN→AR (Vitest + E2E)
[+] src/hooks/useInView.ts                              [+] Press feedback
  ├── [GAP] null before first entry / no IO               ├── [GAP] [→E2E] mousedown → scale 0.96 per button class
  ├── [GAP] true/false on entries                         └── [GAP] [→E2E] reduced motion → scale 1
  └── [GAP] once: unobserve after first true; cleanup   [+] Accessibility settings
[+] useHeroCta (lift of HeroSection CTA)                  ├── [GAP] [→E2E] reduced transparency (CDP) → solid
  └── [★★★ TESTED] mac/windows/web choice — HeroSection.test.tsx:102-120, heroCta.test.ts
[+] LandingHeader                                         ├── [GAP] [→E2E] light OS hover contrast ≥ 4.5
  ├── [GAP] showCta false → data-visible=false            └── [GAP] [→E2E] axe scrolled, light + dark
  ├── [GAP] href === hero href (3 devices)              [+] Chapter reveal
  └── [GAP] toggle aria-label via i18n EN/AR               ├── [GAP] [→E2E] scroll → opacity 1
[+] ChapterSection arming                                 └── [GAP] [→E2E] reduced motion → visible at load
  ├── [GAP] below fold + IO + motion → pending → done
  └── [GAP] reduced motion / no IO / in view → never pending
[+] Wordmark (moved)
  └── [★★ TESTED] hosted Brand.test.tsx (must stay green unchanged)
[+] CSS contracts (landingCss.test.ts)
  └── [GAP] no transition:all, no [data-theme, press tokens, reduced-transparency + @supports, :lang(ar) tracking 0

COVERAGE: 2/24 paths tested today (8%) | every GAP has a planned test in §4 or R6
QUALITY: ★★★:1 ★★:1 | GAPS: 22 (11 E2E)
```
Value cards for the critical paths are in the Test Plan artifact. No test retired. No LLM/eval scope.
Dispositions: T1 / R6 accepted A (D7); everything else is required proof of approved behaviour (§4 plus D1–D7), with no new choice.

### 4. Performance
- `[P2] (9/10) useLatestRelease.ts:85-95`: duplicate GitHub calls. Disposition: accepted A (D2, R1).
- `[P3] (5/10, medium confidence, verify)`: `backdrop-filter` on a sticky bar repaints on every scroll frame and can jank low-end Android GPUs ([web.dev](https://web.dev/articles/backdrop-filter?hl=en)). The plan's LCP measurement step is extended: also scroll the 4× CPU throttle trace once and look for long frames. No new choice; this is the plan's own measurement.
- Observers: at most 2 page-level plus 3 chapter observers, and the chapter ones disconnect once revealed. No scroll handlers. No `motion` import on the landing (TD-081).

### R7: TODO candidate: language-following titles on /privacy and /download
Finding: TODO-1, P3, confidence 9/10, `src/main.tsx:93-115` (PrivacyPolicyPage, DownloadPage mount with no title writer) + `index.html:12`, reviewer: Claude (Final planning decisions)
Plan baseline: §7 said "TECH_DEBT: note /privacy and /download titles if they're left out"; R5 scopes titles to `/` only.
Runtime evidence: both pages show "متابعة" in English.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R7 /privacy + /download titles | "متابعة" always | TODOS.md item 13 (What/Why/Pros/Cons/Context/Depends) | not tracked | built in MUT-77: two keys × 2 languages + the same inline effect in each page + one test each |
| R5 landing title | approved A | unchanged | unchanged | unchanged |
Question D8:
D8 — Track language-following tab titles for /privacy and /download?
Project/branch/task: planning MUT-77 on main.
ELI10: MUT-77 makes the landing page's tab title follow the language. The privacy and download pages will still say "متابعة" in English. The ticket's AC covers only the landing page, so this is either a note for later, nothing, or a few extra lines now.
Stakes if we pick wrong: a small inconsistency English visitors see on two secondary pages, or a little scope creep on MUT-77.
Recommendation: A because it's outside the AC (scope creep is a defect here), and a TODO keeps it from being forgotten.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Add to TODOS.md (recommended)
  ✅ Keeps MUT-77 to its acceptance criteria while the gap stays written down
  ✅ The future fix is obvious: copy the landing's three-line effect
  ❌ English visitors keep seeing an Arabic tab title on two pages for now
B) Skip
  ✅ No bookkeeping for a cosmetic issue on low-traffic pages
  ✅ Nothing changes in MUT-77's diff or the TODO list
  ❌ Likely forgotten until someone files it as a bug
C) Build it now
  ✅ All three public pages behave the same the day MUT-77 ships
  ✅ Tiny: two keys in two languages, two effects, two tests (human ~1h / CC ~10min)
  ❌ Goes beyond the ticket's AC, which this workflow treats as scope creep
Net: a written note versus a tiny out-of-scope change.
Header: Other titles
Options:
A) Add to TODOS.md (recommended)
Append TODOS.md item 13 with What/Why/Pros/Cons/Context/Depends; no code in MUT-77.
B) Skip
No TODO, no code.
C) Build it now
Add privacy/download meta.title keys (EN+AR), an inline document.title effect in PrivacyPolicyPage and DownloadPage, one Vitest each. Human ~1h / CC ~10min.

State: approved
Actual answer: C) Build it now (D8, 2026-10-14)
Accepted scope: in MUT-77: `privacyPolicy.meta.title` / `download.meta.title` keys (EN + AR; exact copy follows R5's "<brand> — <page>" shape, set at build), an inline `document.title` effect in `PrivacyPolicyPage` and `DownloadPage` following the language, one Vitest each (title EN, then AR after a language change). Recorded as a deliberate extension beyond the ticket's AC (user's choice); note it in the Jira comment and CHANGELOG.
History: none

### R8: TODO candidate: Safari ignores prefers-reduced-transparency (accepted gap from D3)
Finding: TODO-2, P3, confidence 7/10, plan §3.6 bar + R2, reviewer: Claude (Final planning decisions)
Plan baseline: R2 approved A: Safari users with Reduce Transparency see the 85% frost.
Runtime evidence: web sources (buildmvpfast 2026) say Safari does not support the query; not probed live.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R8 tracking the Safari gap | untracked | TECH_DEBT.md entry (next free TD, re-checked at build) with a "re-test when Safari ships the query" trigger, written in MUT-77's knowledge commit | not tracked |
| R2 bar surface | approved A | unchanged | unchanged |
Question D9:
D9 — Write down the Safari reduced-transparency gap so it gets re-checked?
Project/branch/task: planning MUT-77 on main.
ELI10: You chose the frosted bar knowing Safari doesn't tell web pages about Reduce Transparency. When Safari adds that, our CSS will start working there with no change, but someone should confirm it. This project tracks known gaps like that in TECH_DEBT.md, not TODOS.md.
Stakes if we pick wrong: an accepted accessibility gap that nobody remembers to re-check.
Recommendation: A because accepted accessibility gaps belong in the project's debt ledger with a clear trigger, and the build already writes knowledge files.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) TECH_DEBT entry (recommended)
  ✅ The gap and its re-check trigger live where the project tracks every other known gap
  ✅ No extra work: MUT-77's knowledge commit already touches TECH_DEBT.md
  ❌ One more open TD entry in a ledger that is already long
B) Skip
  ✅ Nothing to maintain; the CSS starts working by itself when Safari adds the query
  ✅ Keeps the debt ledger shorter
  ❌ Nobody verifies that Safari's eventual support actually makes the bar solid
Net: one ledger line keeps an accepted accessibility gap visible.
Header: Safari gap
Options:
A) TECH_DEBT entry (recommended)
Add a TECH_DEBT.md entry in MUT-77's knowledge commit: Safari ignores prefers-reduced-transparency; accepted in D3; re-test the bar in Safari when the query ships.
B) Skip
No entry.

State: approved
Actual answer: A) TECH_DEBT entry (D9, 2026-10-14)
Accepted scope: a TECH_DEBT.md entry in MUT-77's knowledge commit (next free TD number, re-checked at build): Safari ignores `prefers-reduced-transparency`; accepted in D3; trigger: re-test the bar in Safari when the query ships.
History: none

Approval readiness: PASS. Checked R1 (D2), R2 (D3), R3 (D4), R4 (D5), R5 (D6), R6 (D7), R7 (D8), R8 (D9) and structure (D1). Every accepted remedy cites its own answer, and no deferral is open.


## Approved amendments to the plan (this is what /eng-build implements)

These override §3–§7 where they differ:
1. **Structure (D1):**
   - New units are `src/hooks/useInView.ts` (with a `{ once }` option), `src/pages/landing/useHeroCta.ts`, and `Wordmark` moved to `src/components/brand/Wordmark.tsx`.
   - There is no `useDocumentTitle` and no `useRevealOnce`. The title is an inline effect in `LandingPage`; the reveal arming lives in `ChapterSection` on top of `useInView`.
2. **Release fetch (D2, D7):**
   - Add an in-flight promise dedupe in `fetchLatestRelease`, cleared on settle.
   - Add a new `src/hooks/__tests__/useLatestRelease.test.ts`, written red first, with the four-case contract from R6.
3. **Bar surface (D3):**
   - Default to the `color-mix(in oklab, var(--bg) 85%, transparent)` frost, with `backdrop-filter` and `-webkit-backdrop-filter`.
   - Go solid under `prefers-reduced-transparency: reduce` and when `backdrop-filter` is unsupported.
4. **Reduced motion (D4):** chapter figures are never pending and are visible at load. Log the deviation from L10's wording in CHANGELOG.
5. **Header CTA (D5):**
   - Short label keys `landing.header.cta.{mac,windows,web}` at all widths.
   - The accessible name is the full hero label.
6. **Titles (D6, D8):**
   - Landing: EN "Mutaba3a — Track your finances, securely", AR "متابعة — تابع مالك، بأمان".
   - `/privacy` and `/download` follow the same "<brand> — <page>" shape, each with an inline effect and a Vitest.
   - This is a deliberate extension beyond the AC; note it in the Jira comment and CHANGELOG.
7. **Tokens:**
   - Add a `--stagger-rise: var(--m-stagger-rise)` alias in `theme.css`, zeroed under reduced motion.
   - Components never read `--m-*` directly.
8. **Debt (D9):** add a TECH_DEBT entry for the Safari reduced-transparency gap.
9. **Performance check:** the LCP measurement also scrolls the 4× CPU trace once to look for long frames from `backdrop-filter`.

## NOT in scope
- **Section links in the bar:** L9 rules them out, even after MUT-171 adds sections.
- **Moving `motion` (JS springs) onto the landing:** CSS transitions only, to protect TD-081 LCP.
- **The app's other `document.title` surfaces (`/app/*`):** not public pages, and not in the ticket.
- **Removing the global reduced-motion `!important` rule in `theme.css:416`:** it is app-wide and correct.
- **CTA click counting:** belongs to MUT-154. This ticket only keeps a stable `data-part="header-cta"` hook.
- **SidebarNav's inline brand lockup:** its collapsed state behaves differently, so it does not adopt `Wordmark`.

## What already exists
- `BrandMark` (`src/components/brand/BrandMark.tsx`) and the hosted `Wordmark` (`src/hosted/components/Brand.tsx:9`): `Wordmark` is reused by moving it, not rebuilt.
- `chooseHeroCta` / `secondaryHeroLink` (`src/pages/landing/heroCta.ts`): reused unchanged inside `useHeroCta`.
- `usePrefersReducedMotion` (`src/hooks/usePrefersReducedMotion.ts`): reused by the reveal arming.
- Motion tokens `--press-scale`, `--duration-press`, `--duration-nav`, `--duration-toggle` and `--ease-spring` (`src/styles/theme.css:100-117`): reused. The reduced-motion zeroing is already there.
- The MUT-103 literal guard (`src/styles/__tests__/brand.test.ts`) and the `qa/support/brand.ts` helpers (`expectNoHorizontalOverflow`, `SCHEMES`), plus `expectOnlyKnownAxeViolations`: reused by the new tests.

## Diagram: header CTA and edge-fade state
```
mount ──> useInView(heroCtaRef) ─┬─ null (no IO yet / no IO support) ──> header CTA hidden (visibility:hidden, opacity 0)
                                 ├─ true  (hero CTA on screen)        ──> hidden
                                 └─ false (hero CTA scrolled away)     ──> visible (opacity cross-fade, --duration-toggle)
mount ──> useInView(#top sentinel) ─┬─ true/null ──> no edge fade
                                    └─ false     ──> [data-scrolled] ::after gradient visible
ChapterSection mount ──> reduced motion? ─ yes ─> visible, never pending
                         └ no ─> IO missing? ─ yes ─> visible
                                 └ no ─> starts in viewport? ─ yes ─> visible
                                         └ no ─> data-reveal=pending ──(first intersect, once)──> done (rise+fade 420ms)
```

## Failure modes
| Path | Realistic failure | Test | User sees |
|---|---|---|---|
| Header CTA | IntersectionObserver unsupported or slow | Vitest null → hidden | Bar without a CTA; hero and Get it still offer it. Harmless |
| Release fetch | GitHub fails or rate-limits (60/h/IP) | R6 (3): error to both callers, retry next | Web-app fallback CTA (existing behaviour) |
| Release fetch | A rejected promise gets cached forever | R6 (3) | Would have left Windows CTA logic stuck. Caught by the test |
| Reveal | Arming runs for an in-view element | Vitest + E2E | A flash or a hidden figure. Caught |
| Frosted bar | Safari ignores reduced transparency | Manual (TD entry, D9) | An 85% frost. Accepted |
| Frosted bar | Contrast over busy content | Axe scrolled, light + dark | Caught by E2E |

Critical gaps (no test, no handling, and silent): **0**.

## Worktree parallelization strategy
Sequential implementation, no parallelization opportunity. The ticket touches one surface (landing) plus two small shared seams, and the project rule is one fresh worktree per ticket (`.claude/worktrees/mut-77-landing-header` on `feature/mut-77-landing-header`).

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code; tick each box as it ships.

- [ ] **T1 (P1, human: ~2h / CC: ~15min)**: release fetch. Pin the contract, then dedupe in flight.
  - Surfaced by: Test review T1 / R6 (D7) and Scope S1 / R1 (D2)
  - Files: `src/hooks/__tests__/useLatestRelease.test.ts` (new), `src/hooks/useLatestRelease.ts`
  - Verify: `npx vitest run src/hooks/__tests__/useLatestRelease.test.ts`. Red before the change, green after.
- [ ] **T2 (P2, human: ~3h / CC: ~20min)**: `useInView` and the `Wordmark` move.
  - Surfaced by: Scope D1 structure
  - Files: `src/hooks/useInView.ts`, `src/components/brand/Wordmark.tsx`, `src/hosted/components/Brand.tsx`, plus tests
  - Verify: the new Vitest files, with hosted `Brand.test.tsx` unchanged and green.
- [ ] **T3 (P2, human: ~1 day / CC: ~40min)**: the header, CTA, bar surface and press rule.
  - Surfaced by: §3.4–§3.6, plus R2 (D3), R4 (D5) and the `--stagger-rise` correction
  - Files: `LandingHeader.tsx`, `LandingPage.tsx`, `HeroSection.tsx`, `useHeroCta.ts`, `LandingPage.css`, `HeroSection.css`, `FAQSection.css`, `theme.css` (`.transition-all` removed, `--stagger-rise` added), `en.json`, `ar.json`
  - Verify: `landingCss.test.ts`, `LandingHeader.test.tsx`, `LandingPage.test.tsx`.
- [ ] **T4 (P2, human: ~2h / CC: ~15min)**: the chapter reveal.
  - Surfaced by: R3 (D4)
  - Files: `ChapterSection.tsx`, `LandingPage.css`
  - Verify: Vitest arming cases, plus `@web.landing.reveal`.
- [ ] **T5 (P2, human: ~1h / CC: ~10min)**: titles.
  - Surfaced by: R5 (D6) and R7 (D8)
  - Files: `LandingPage.tsx`, `PrivacyPolicyPage.tsx`, `DownloadPage.tsx`, `en.json`, `ar.json`
  - Verify: page tests check the title in EN, then in AR.
- [ ] **T6 (P2, human: ~1 day / CC: ~40min)**: the QA spec and the extended brand axe check.
  - Surfaced by: Test review diagram
  - Files: `qa/specs/web/landing.spec.ts` (new), `qa/specs/web/brand.spec.ts`
  - Verify: the qa run on a preview build ([[qa-run-on-preview-builds]]).
- [ ] **T7 (P2, human: ~1h / CC: ~10min)**: knowledge files and measurement.
  - Surfaced by: §7, D4 (CHANGELOG deviation), D8 (scope note), D9 (TD entry), and the Performance check
  - Files: `.claude/CHANGELOG.md`, `COMPONENT_REGISTRY.md`, `PATTERNS.md`, `TEST_PLAN.md`, `TECH_DEBT.md`
  - Verify: LCP median of 5 plus a scroll trace, both recorded.

## Unresolved decisions
None.

## Completion summary
- Step 0, Scope Challenge: scope accepted as-is. The smaller arrangement preserves scope (D1).
- Architecture review: 1 issue found (R3).
- Code quality review: 2 issues found (R4, R5).
- Test review: diagram produced, 1 gap identified (R6, a regression contract). All 22 new paths map to planned tests.
- Performance review: 2 issues found (R1, and the backdrop-filter scroll cost at medium confidence).
- NOT in scope: written.
- What already exists: written.
- TODOS.md updates: 2 items proposed. D8 was built now; D9 went to a TECH_DEBT entry instead of TODOS.md.
- Failure modes: 0 critical gaps flagged.
- Unresolved decisions: 0 in this review.
- Outside voice: codex, unavailable (CLI not installed; the native fallback needs `TaskOutput`, which this session lacks).
- Parallelization: 1 lane, sequential.
- Lake Score: 4/4 answers scored for Completeness picked the 10/10 or top-scored option (D2, D3, D5, D7).

## Suppressed findings (appendix)
- (4/10) The sticky bar covering anchor targets. `#get-it` section padding (112px) clears a ~56px bar (`GetItSection.tsx:17`). Still checked in `@web.landing.375`.
- (4/10, Scope) `color-mix` tripping the MUT-103 literal guard. Disproved: `COLOR_LITERAL` (`src/test/css/brandCss.ts:563`) doesn't match `color-mix(`.
- Stale design doc: gstack's design-doc finder returned `basel-main-design-20260524-100930.md` ("Recording Flow Redesign", May 2026). It is unrelated to MUT-77 and was ignored.

## Build deviations (eng-build, 2026-10-14)
These changes were made during the build. Each one either follows from an approved decision or fixes a bug the new tests found.
- **`useDocumentTitle` extracted after all.** D1 inlined it while the landing page was its only caller. D8 added `/privacy` and `/download`, which makes three callers, so it is a hook again.
- **`useHeroCta` is called in both `HeroSection` and `LandingHeader`**, not once in `LandingPage` and passed down. §3.2 said to keep whichever is cheaper. With R1's in-flight dedupe both calls share one GitHub request, and the hero keeps its no-props API and tests.
- **`LandingHeader` owns the `#top` sentinel and the scroll-edge state.** `PrivacyPolicyPage` renders the bar too. `showCta` defaults to true there, because that page has no hero.
- **The hover bug's new form was fixed (found by `@web.landing.hover-light`).** The global `a:hover` out-ranks single-class controls. The landing controls now hold their hover colours, and the app-wide rule is TD-122 (task chip offered).
- **The 375 wordmark was clipped under the switch (found by the screenshot review).** Below 480px the wordmark shows the active language's name (`landing.header.wordmarkShort`). The spec now checks clipping and overlap inside the bar.
- **The language switch's accessible name** is its visible letters plus a screen-reader-only `landing.langToggle.label` (WCAG 2.5.3). The plan's `aria-label` would have hidden the letters from its name.
- **The brand link has no `landing.header.home` key.** Its name is the wordmark text.
- **Not done: the T7 LCP measurement and scroll trace.** They were skipped at Basel's instruction to keep the gate to lint, typecheck and the OpenAPI check.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex (`/plan-eng-review` outside voice) | Independent 2nd opinion | 22 | unavailable | CLI not installed; native fallback lacks TaskOutput |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 20 | issues_open (all resolved) | 6 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 3 (latest 2026-10-12, other ticket) | clean (not for this plan) | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase: unavailable (not installed). No in-host fallback ran. This review has no outside coverage.
- **VERDICT:** ENG REVIEW done, with all 9 decisions answered (D1–D9) and 0 critical gaps; status is issues_open because the findings became accepted work, not because anything is blocked. Ready to implement. A design review is recommended (UI and motion work); eng review is required and done.

NO UNRESOLVED DECISIONS
