# MUT-173 — Landing: the phone app logs it, the portal shows it

Status: **PLANNED (2026-10-14)**, branch `feature/mut-171-landing` (epic worktree `.claude/worktrees/mut-171-landing`, one worktree for the whole of MUT-171).
Ticket: MUT-173 (Story) · parent epic MUT-171 (landing: hosted, mobile, Malafat). Siblings: MUT-172 (free vs. paid split, merged 8368aa3, In Review), MUT-174 (Malafat section, Backlog, next). Relates to MUT-63 (capture app epic) and MUT-114 (Android prep, In Progress). No `is blocked by` link and none in the prose; MUT-114 only changes the Android package, not what the landing may say.
Tracker: Jira · barmajiyat.atlassian.net · MUT via atlassian-barmajiyat · Backlog = planning allowed when Basel asks (he asked for the whole epic) · finished → In Review after /qa-reconcile.

## 1. Problem and acceptance criteria

The landing never says what the phone app is for, what the hosted portal is for, or where to get the phone app. Since MUT-172 the Get it section says both exist and come with a paid plan, then stops.

| # | AC (ticket) | Proved by |
|---|---|---|
| A1 | New section with the phone-does-entry / portal-does-viewing split stated plainly | `data-part="phone"` after `get-it`; `LandingPage.test.tsx` structure list grows to eight; the EN case reads the title and body for "phone" and "portal" |
| A2 | Store links sourced from config constants, not hardcoded in JSX | the chips read `MOBILE_APP_LINKS` (download-config.ts, since MUT-186) and nothing else; the test swaps the config through `vi.mock` |
| A3 | Missing/placeholder config renders "coming soon", not a broken link | three config states, each a test case: `url` set → store link; `available` with no `url` → plain chip, no link; not `available` → "{platform} coming soon", no link |
| A4 | Section does not claim a reports/analytics feature | an honesty case bans `/report|analytic|dashboard|statistic|chart/i` and `/تقارير|تحليل|إحصاء|رسوم/` in the part; the body names only clients, what they owe and what they paid (the portal's ledger and client views, which exist) |
| A5 | New iOS/Android icons alongside existing PlatformIcons | `AndroidIcon` added to `PlatformIcons.tsx`; the iPhone chip uses the existing `AppleIcon` (D5) |
| A6 | i18n EN/AR; tests added | `landing.phone.*` in both dictionaries; `landingCopy.test.ts` key parity; AR case; QA `@web.landing.phone` EN + AR |
| G | Brand v2 tokens; one idea per section; RTL | the section is a `ChapterSection` (tokens, balance, reveal, flip); logical properties only; the one idea is "the phone logs, the portal shows" |

## 2. Where it goes

The nearest thing built the same way is a chapter: `ChapterSection` (a big line, a short paragraph, one visual). The new section is a fourth chapter placed after Get it, with one addition under the paragraph: the two phone platforms and where each stands.

| File | Change |
|---|---|
| `src/pages/landing/components/ChapterSection.tsx` | One optional prop, `extra?: ReactNode`, rendered after the body inside `.landing-chapter-copy`. Nothing else changes; the three existing chapters pass nothing. (Registry rule: 70%+ overlap → extend, don't duplicate.) |
| `src/pages/landing/components/PhoneSection.tsx` (new) | `<ChapterSection part="phone" title body visual={<HostedDevicesMock />} flip extra={<PhoneExtra />} />`. `PhoneExtra` renders: a hint `<p className="landing-phone-hint">` = `landing.phone.hint` + one inline `<a href={HOSTED_OFFER_URL}>` = `landing.phone.hintLink`; then `<ul className="landing-phone-stores" aria-label={t('landing.phone.storesLabel')}>` with one `<li>` per platform in `PLATFORMS = ['ios','android']`, each decided from `MOBILE_APP_LINKS[platform]`: (a) `url` → `<a className="landing-phone-store" href={url} target="_blank" rel="noopener noreferrer">` icon + `landing.phone.store.<platform>`; (b) `available && !url` → `<span className="landing-phone-store landing-phone-store--plain">` icon + `landing.hostedOffer.platform.<platform>`; (c) `!available` → `<span className="landing-phone-store landing-phone-store--soon">` icon + `landing.hostedOffer.platform.comingSoon`. The names and the coming-soon phrase are the strings `/hosted` already uses for the same facts, so the two pages can never disagree. |
| `src/pages/landing/components/PlatformIcons.tsx` | `AndroidIcon` (the Android robot head, `fill="currentColor"`, `aria-hidden`), same `IconProps` as the others. |
| `src/pages/landing/components/index.ts` | export `PhoneSection`. |
| `src/pages/landing/LandingPage.tsx` | `<PhoneSection />` between `<GetItSection />` and `<FAQSection />`; the docblock's list of parts gains "the phone and the portal". |
| `src/pages/landing/LandingPage.css` | `.landing-phone-hint` (`--text-label`, `--muted`, `margin: var(--space-5) 0 0`, `max-width: 40ch`), its `a` underlined like `.landing-get-it-meta a` (axe link-in-text-block; dims on press with `--landing-press-dim`); `.landing-phone-stores` (`list-style: none; display: flex; flex-wrap: wrap; gap: var(--space-2-5); margin: var(--space-4) 0 0; padding: 0`); `.landing-phone-store` (an `inline-flex` pill, `min-height: 44px`, `gap: var(--space-2)`, `padding-inline: var(--space-3)`, `border: 1px solid var(--border)`, `border-radius: var(--radius-pill)`, `background: var(--surface)`, `color: var(--text)`, `text-decoration: none`); `a.landing-phone-store` hover keeps colour and no underline and sets `border-color: var(--border-strong)` (the global `a:hover` out-ranks a lone class otherwise, TD-122), `:active { scale: var(--press-scale) }` with the `scale var(--duration-press) var(--ease-spring)` transition, `:focus-visible { box-shadow: var(--focus-ring) }`; `--plain` is the same pill without a border colour change; `--soon` is dashed, `--muted`, like `.landing-get-it-option--unavailable`. **Also**: every `.hosted-devices*` rule moves here from `HostedOfferPage.css` (D3), unchanged, including the `≤640px` block that keeps only the phone frame. |
| `src/pages/landing/HostedOfferPage.css` | The `.hosted-devices*` rules removed (they now load with `LandingPage.css`, which `HostedOfferPage.tsx` imports first). No other change. |
| `src/lib/i18n/translations/en.json`, `ar.json` | `landing.phone.title` = "Log it on your phone. See it all in the portal." / "سجّل من هاتفك. وشاهد كل شيء في البوابة."; `body` = "The phone app does one thing: an income or an expense logged in seconds, even with no signal. The hosted portal is where you see it: every client, what they owe and what they've paid, in your browser on any computer." / "تطبيق الهاتف يفعل شيئًا واحدًا: دخل أو مصروف يُسجَّل في ثوانٍ، حتى دون إشارة. أما البوابة المستضافة فهي حيث ترى كل شيء: كل عميل، وما عليه، وما دفعه، في متصفحك على أي حاسوب."; `hint` = "Both come with a hosted account." / "كلاهما يأتي مع حساب مستضاف."; `hintLink` = "See hosted accounts" / "اطّلع على الحسابات المستضافة" (the same words as the Get it CTA and Settings › Businesses: one door, one name); `storesLabel` = "Phone apps" / "تطبيقات الهاتف"; `store.ios` = "iPhone, on the App Store" / "iPhone، على App Store"; `store.android` = "Android, on Google Play" / "Android، على Google Play". The platform names and "{platform} coming soon" are reused from `landing.hostedOffer.platform.*`. |
| `src/pages/landing/__tests__/LandingPage.test.tsx` | structure: eight parts, `phone` after `get-it`; new `describe('LandingPage phone and portal (MUT-173)')`, see §4. `MOBILE_APP_LINKS` is swapped through a hoisted `vi.mock('../../../content/download-config', …)` that spreads the real module and replaces only `MOBILE_APP_LINKS` with a mutable object, the same shape as the `release` mock above it. |
| `src/pages/landing/__tests__/ChapterSection.test.tsx` | one case: `extra` renders inside the copy column after the body; absent by default. |
| `src/pages/landing/__tests__/landingCss.test.ts` | if the press-token case enumerates selectors, `a.landing-phone-store` joins it; the moved `.hosted-devices` rules need no new case. |
| `qa/features/web/landing.yaml` | feature `phone` (§4b), `tier: secondary`. The area's paths already cover `src/pages/landing/**` and `src/content/download-config.ts`. |
| `qa/specs/web/landing.spec.ts` | `@web.landing.phone`, EN then AR (§4). |
| Knowledge files | CHANGELOG; COMPONENT_REGISTRY (`ChapterSection` gains `extra`; `PhoneSection` registered beside `GetItSection`; `PlatformIcons` lists `AndroidIcon`; `HostedDevicesMock` note that its CSS lives in `LandingPage.css`); TEST_PLAN; SYSTEM_OVERVIEW landing row (one clause). No new ADR: the only durable rule (store links on `/`, never on `/hosted`) is MUT-186's 9A, restated in the component docblock. No new debt. |

Nothing in `server/`, the app, the portal, `vite.config.ts`, `netlify.toml` or `download-config.ts` changes. No new dependency. The store URLs stay `null` until Basel fills them in (the ticket says he does, once each listing is live).

## 3. Decisions

- **D1 — A new top-level section after Get it, before the FAQ.** The ticket asks for a new section and MUT-172 explicitly left it to this ticket ("MUT-173 owns the per-platform section"). Order: the privacy band ("On your device. No account.") describes the free apps and must keep reading that way, and the paid half of Get it has just introduced the hosted account and the phone app, so the section that explains those two things follows it. The structure test's list grows from seven to eight; MUT-174 will add a ninth in the same place.
- **D2 — Reuse `MOBILE_APP_LINKS`, no `app-store-config.ts`.** The ticket's "e.g." file does not exist; MUT-186 already added `MOBILE_APP_LINKS` to `download-config.ts` with `available` and `url` fields and a comment naming MUT-173 as the consumer. A second file for the same two facts would drift. Three states fall out of the two fields: a store link when `url` is set, a plain chip when the app exists but no public listing is wanted (`available`, `url: null`, iOS today), "coming soon" when it does not exist (Android today). The "coming soon" and platform strings are `/hosted`'s own, so the two pages agree by construction.
- **D3 — The visual is `HostedDevicesMock`, and its CSS moves to `LandingPage.css`.** The mock is the same client's Owed now on a laptop and on a phone with the caption "Logged on the phone, there on the laptop", which is this section's idea in a picture; `/hosted` keeps using it. Its rules live in `HostedOfferPage.css`, which `/` does not load, so they move (not copy) into `LandingPage.css`, which both pages import. A visitor who goes from Get it to `/hosted` sees the picture twice; accepted, the pages make the same promise.
- **D4 — `ChapterSection` grows an `extra` slot** instead of a new section component with a copied layout. Three callers pass nothing and are untouched.
- **D5 — `AndroidIcon` is new; the iPhone chip uses `AppleIcon`.** The Apple mark is what the App Store badge itself carries; a separate "iOS icon" would be the same glyph. *Flagged for Basel* as a reading of the AC's "iOS/Android icons".
- **D6 — Store links open in a new tab** with `rel="noopener noreferrer"`, like the release-notes link in Get it: they leave the site for a store.
- **D7 — One inline `/hosted` link in the hint.** The section says the apps come with a hosted account; a reader then needs the door. It is the same label and destination as the Get it CTA just above, so it is one door with one name, not a second funnel. The `get-it-paid` QA case counts links inside its own block only, so it stays green.
- **D8 — Copy claims only what ships.** Offline capture ("even with no signal") is in the privacy policy's mobile section and MUT-63; the portal's "every client, what they owe and what they've paid" is its ledger and client views. No reports, no analytics, no price, no platform promise beyond the chips.

## 4. Tests (written first)

| Test | Cases |
|---|---|
| `LandingPage.test.tsx` › structure | eight parts: `… 'get-it', 'phone', 'faq'` |
| `LandingPage.test.tsx` › phone and portal (MUT-173) | (1) EN: `part('phone')` has the heading `landing.phone.title`, its text contains "phone app" and "portal", and the hint's link is named "See hosted accounts" with `href="/hosted"` and no `target`; (2) store link: with `ios.url = 'https://apps.apple.com/…'` the list has a link named "iPhone, on the App Store" with that href, `target="_blank"`, `rel` containing `noopener`; (3) plain chip: with `ios = { available: true, url: null }` the list shows "iPhone" and has no link to a store; (4) coming soon: with `android = { available: false, url: null }` the list shows "Android coming soon" and no link; once `available` with a url, the link appears and the note goes; (5) AR: the heading is the Arabic title and the link is named "اطّلع على الحسابات المستضافة"; (6) honesty: the part's text matches none of `/report|analytic|dashboard|statistic|chart/i`, `/\bprice\b|\/month|checkout|sign ?up|\$\d/i`, and in AR none of `/تقارير|تحليل|إحصاء|رسوم|سعر|اشترك/` |
| `ChapterSection.test.tsx` | `extra` renders after the body inside `.landing-chapter-copy`; nothing extra by default |
| `landingCss.test.ts` | the press enumeration includes `a.landing-phone-store` if it enumerates; no literal scale/opacity (existing) |
| `landingCopy.test.ts` | unchanged; covers `landing.phone.*` parity automatically |
| `release-qa lint` | 0 errors; no new unmapped file |
| QA `@web.landing.phone` | EN and AR: the section is visible after `#get-it`, with the title from the dictionary; the hint's link has `href="/hosted"`; the chips match `MOBILE_APP_LINKS` imported in the spec (a link when `url` is set, else a non-link chip; "coming soon" when not available); every chip is at least 44 px tall; at 375 px in AR no horizontal overflow; axe reports only known violations; screenshot attached |

Gate (Node 22): `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run build`, `release-qa lint`, Playwright `--project=web` landing spec on a built web preview (throwaway config as for MUT-172). No `server/` change, so the server gate is not owed.

## 4b. QA scenarios (release-qa, `qa/features/web/landing.yaml` → `@web.landing.phone`)

| Flow | Steps, as the user would say them | Promised outcome |
|---|---|---|
| Learn what the phone app and the portal each do, and where the phone app stands | Open the landing page, scroll past Get Mutaba3a to the phone section, read it, look at the two platform chips, press "See hosted accounts"; same in Arabic, also at 375 px | The section says the phone logs income and expenses and the portal is where you see clients, what they owe and what they paid; it claims no reports; iPhone shows a store link only when one is configured, otherwise its name; Android says "coming soon" until it is available; the link opens `/hosted` |

## 5. Reuse analysis

| Need | Reused | New |
|---|---|---|
| Section layout, reveal, flip | `ChapterSection` | the `extra` slot |
| The picture | `HostedDevicesMock` (+ its CSS, moved) | — |
| Store availability | `MOBILE_APP_LINKS`, `landing.hostedOffer.platform.*` | `landing.phone.*` (7 keys) |
| `/hosted` path and label | `HOSTED_OFFER_URL`, the "See hosted accounts" words | — |
| Icons | `AppleIcon` | `AndroidIcon` |
| Pill look | `.hosted-device-pill` recipe (44 px, pill radius, surface) | `.landing-phone-store` (landing stylesheet; `/` loads no hosted CSS) |
| Landing QA harness | `openLanding`, `attachScreenshot`, `expectNoHorizontalOverflow`, `expectOnlyKnownAxeViolations` | one test + one feature |

## 6. Scope check

Covers A1–A6 and the guardrail. Conscious inclusion: moving the `.hosted-devices` rules between two landing stylesheets (D3) so the mock can be reused; no behaviour change on `/hosted`. Not in scope: the FAQ (its "runs on phones" answer is about the free web app and stays true); the store URLs themselves (Basel's, per the ticket); any portal reports view (MUT-175); Android publishing (MUT-114); retiring the desktop cards (TD-135, unfiled).

## 7. Follow-ups to note on tickets

- MUT-173: D2 (no new config file; `MOBILE_APP_LINKS` is the config) and D5 (`AppleIcon` for iPhone) are readings of the AC's literal text; recorded in a comment.
- The store URLs are `null` on both platforms until Basel sets them; the landing shows "iPhone" (plain) and "Android coming soon" meanwhile.

Business / product impact
- Every visitor now learns the one thing that makes the paid tier different from the free apps in practice: log on the phone, see it in the portal. Without it, "phone app" in Get it is a name with no job.
- Epic MUT-171's second of three stories; it uses MUT-186's config so the day Basel sets a store URL the landing links it with no code change.
- Risk: copy and chips; the honesty test keeps "reports" out and the three-state test keeps dead links out.

---

# Eng review (/plan-eng-review, 2026-10-14, non-interactive by Basel's instruction: the whole epic runs autonomously)

Target: this plan. Reviewer: Claude (native) + an in-host Plan subagent as the outside voice (Codex not installed). Decision gates were auto-decided on the recommended option and are listed under "Unresolved decisions" for Basel. Search check: no new architectural pattern, infrastructure component or concurrency approach (a chapter, a config-driven list, a CSS move), so no web research was run.

## Scope Challenge

**A. Assess.** Already solving each sub-problem: `ChapterSection` (layout, reveal, flip); `HostedDevicesMock` (the picture) and its `.hosted-devices*` rules (`HostedOfferPage.css:48-128`, `:365-392`); `MOBILE_APP_LINKS` + `landing.hostedOffer.platform.*` (availability and its words); `HOSTED_OFFER_URL`; `AppleIcon`; the `.hosted-device-pill` recipe (44 px pill); `landingCopy.test.ts` parity; `HostedOfferPage.test.tsx:8-19` (the exact `vi.mock` getter pattern for swapping `MOBILE_APP_LINKS`); the landing QA harness. Complexity: 14 files touched (7 source incl. 1 new component, 2 dictionaries, 3 tests, 1 feature file, 1 spec) + knowledge files; 1 new module (`PhoneSection`). TODOS.md: nothing overlaps (its items are payment dates, audit ordering, hosted profiles). Distribution: Netlify builds `main`; no CI change. Minimum change: nothing deferrable without failing an AC; the one conscious extra is the CSS move (D3), which the reuse needs.

**B. Complexity gate** (14 files ≥ 8, 1 new module): structure question, **D1 auto-decided → Original arrangement.** Smaller arrangement considered: fold `PhoneExtra` into `LandingPage.tsx` and skip `PhoneSection` (−1 file). Rejected: the page component is a composition list and every other part is its own component; the chips' three-state logic needs a home that the test can render alone. No cut keeps the Phase 5 feature file and spec, which CLAUDE.md requires. Scope record: feature answers: none proposed; structure: A (Original); accepted scope: §2 as written, amended by R1 below; pending remedies: none.

**C. Findings**

| # | Sev | Conf | Where | Finding | Disposition |
|---|---|---|---|---|---|
| S1 | P1 | 9/10 | plan §2 `HostedOfferPage.css` row (D3) | The `≤640px` block (`HostedOfferPage.css:379-392`) hides the laptop and the caption and keeps only the phone frame. Moved to `LandingPage.css` as planned, it applies on `/` too: on a phone, the chapter whose idea is "the phone logs, the portal shows" would show a phone displaying a client balance and nothing of the portal, the opposite of the words beside it. On `/hosted` that trade is right (the hero's point is "on your phone too"). | **accepted (R1)**: move only the base rules; the `≤640px` overrides stay in `HostedOfferPage.css`, which `/` never loads. The landing adds its own `≤640px` rule scoped to `.landing-chapter .hosted-devices`: the mock leaves `position: absolute`, the laptop becomes full-width and in flow, the phone follows below it centred, the caption stays. `landing.spec.ts:385-386` (`@web.landing.hosted-375`) keeps asserting the phone-only hero on `/hosted` and stays green. |
| S2 | P2 | 9/10 | plan §2 test row | The plan says "a hoisted `vi.mock` … the same shape as the `release` mock". The repo already has the exact shape: `HostedOfferPage.test.tsx:8-19` spreads `importOriginal` and exposes `MOBILE_APP_LINKS` through a getter on a hoisted `apps.links`. Copy it verbatim; a plain spread with a mutable object would freeze the first value. | **accepted**: the plan names the pattern and file. |
| S3 | P3 | 8/10 | plan §2 `PlatformIcons.tsx` row | The Android robot is Google's work under CC BY 3.0; the attribution sentence belongs in the icon's docblock, as it does wherever the mark is reproduced. | **accepted**: docblock carries the attribution line. |
| S4 | P3 | 7/10 | plan §2 hint link | `.landing-phone-hint a` is an unclassed link, so `index.css:83` `a:not([class]):hover` underlines it on hover only; running-text links need a permanent underline (axe link-in-text-block, the `.landing-get-it-meta a` precedent). The plan says so; make the rule explicit: `color: var(--accent-text); text-decoration: underline; text-underline-offset: 0.15em`, hover thickness 2px, `:active { opacity: var(--landing-press-dim) }`, and add `.landing-phone-hint a:active` to `landingCss.test.ts`'s `it.each` of dimming text links (`:95`). | **accepted**. |

Result: **scope accepted as-is** (R1 is an arrangement of the same CSS, not a scope change). MODE = FULL_REVIEW.

## Decision ledger

### R1: the mock on phones, on `/`
Finding: S1, P1, 9/10, plan §2, Claude
Plan baseline: move every `.hosted-devices*` rule, including the `≤640px` block, to `LandingPage.css`
Runtime evidence: `HostedOfferPage.css:379-392` (`.hosted-devices { min-height: 0 }`, laptop + caption `display: none`, phone `position: relative; margin-inline: auto`); `landing.spec.ts:385-386` asserts exactly that on `/hosted` at 375 px; `HostedOfferPage.tsx:108-119` mounts the mock inside `.hosted-hero-layout`; `LandingPage.css:918-921` stacks `.landing-chapter-layout` to one column at the same breakpoint.
Comparison grid:

| Choice | Current plan | A) Phone-only everywhere | B) Base rules shared, each page owns its `≤640px` |
|---|---|---|---|
| What a phone visitor sees on `/` | — | a phone frame with a balance; no portal in the picture | laptop (portal) above, phone below, caption kept |
| `/hosted` at 375 px | unchanged | unchanged | unchanged (its overrides stay in its own file) |
| CSS | 1 move | 1 move | 1 move + ~10 declarations on the landing |

Question D2: On phones, should the landing's copy of the mock keep the laptop?
Header: Mock on phones
Options:
A) Phone-only everywhere ✅ one media block, identical on both pages ✅ nothing new to test ❌ on `/` the picture contradicts the sentence beside it for the device most visitors use.
B) Each page owns its `≤640px` rule (recommended) ✅ the chapter's picture matches its words on phones ✅ `/hosted`'s hero and its QA case are untouched ❌ one more landing rule to keep in step with the mock.
Completeness: A=6/10, B=10/10.
State: approved
Actual answer: B (auto, non-interactive run)
Accepted scope: §2 `LandingPage.css` and `HostedOfferPage.css` rows as amended by S1.

## 1. Architecture review
- **[P1] (9/10) plan §2** — the mock's phone rule on `/` → R1 (accepted).
- Boundaries: one new component, one slot on an existing one, two stylesheets, two dictionaries; no router, app, portal or server. The config read is a module constant; the only runtime dependence is `useT`.
- Data flow: none beyond render. Diagram of the chip decision, which is the one branch:

```
MOBILE_APP_LINKS[platform]
  ├─ url set ──────────────► <a target=_blank> "iPhone, on the App Store"   (A2)
  ├─ available, url null ──► <span> "iPhone"                               (A3: no dead link)
  └─ not available ────────► <span --soon> "Android coming soon"           (A3)
```
- One production failure per new path: Basel sets a store `url` before the listing is public → the store shows "not available" (a 404 outside the site). No code can verify a store listing; the ticket makes the URL Basel's and the plan keeps it `null` until then. Not silent (the store says so), not ours to handle. Second: a translation key missing in one language → `useT` renders the key; `landingCopy.test.ts` parity catches it before merge.
- Distribution: Netlify builds `main`; no CI, bundle or deploy change. No new artifact.

Dispositions: A1 accepted (R1).

## 2. Code quality review
- Organisation: `PhoneSection` beside `GetItSection`; the chip logic is a `PLATFORMS.map` with one three-way branch, rendered and tested through the page. Extracting `storeState(link)` as a pure function would add a module for three lines with one caller; rejected under the rubric (no second caller, no net saving).
- Shared code: `ChapterSection.extra` is the one extraction, with two verified callers' worth of layout already in the component (`ChapterSection.tsx:46-66`) and one new caller. The alternative, a copied chapter layout in `PhoneSection`, would duplicate 20 lines and the reveal effect. Net: −20 lines, one optional prop.
- **[P2] (9/10) plan §2 test row** — mock pattern (S2) → accepted.
- **[P3] (8/10)** icon attribution (S3) → accepted. **[P3] (7/10)** hint link rule + CSS test (S4) → accepted.
- Error handling: none needed; no state, no I/O.
- Diagrams: the `LandingPage.tsx` docblock's part list is the page's diagram; the plan updates it.

Dispositions: Q1 (S2) accepted, Q2 (S3) accepted, Q3 (S4) accepted.

## 3. Test review
Framework: Vitest + Playwright QA (CLAUDE.md Phase 4/5).

```
CODE PATHS                                                      USER FLOWS
[+] PhoneSection.tsx                                            [+] Learn what the phone and the portal each do
  ├── [GAP→new] title/body/hint + /hosted link — LandingPage.test  ├── [GAP→new] EN: section after Get it, words, link — LandingPage.test
  ├── [GAP→new] url set → store link, _blank, noopener             ├── [GAP→new] AR: title + link name — LandingPage.test
  ├── [GAP→new] available + null → plain chip, no link             ├── [GAP→new][→E2E] chips follow config; 44px; /hosted — @web.landing.phone
  ├── [GAP→new] unavailable → "coming soon", no link               ├── [GAP→new][→E2E] 375 AR no overflow; laptop kept on / — same case
  └── [GAP→new] honesty: no reports/price words EN+AR              └── [★★★ TESTED] no Buy/$49/Universal on main — existing honesty cases
[+] ChapterSection.extra                                         [+] Catalogue
  └── [GAP→new] renders after body; absent by default — ChapterSection.test   └── [GAP→new] release-qa lint 0 errors; `phone` feature
[+] LandingPage.css (.landing-phone-*, .hosted-devices base + landing ≤640)
  ├── [★★★ TESTED] no literal scale/opacity; token dims — landingCss.test
  └── [GAP→new] .landing-phone-hint a:active dims — landingCss.test it.each
[+] HostedOfferPage.css (≤640 overrides stay)
  └── [★★★ TESTED] phone-only hero at 375 — @web.landing.hosted-375 (unchanged)
[+] en/ar landing.phone.*
  └── [★★★ TESTED] key parity — landingCopy.test
[+] LandingPage structure
  └── [★★★ TESTED→updated] eight parts in order — LandingPage.test
COVERAGE (before build): 5/16 (31%) | after the planned tests: 16/16
QUALITY: ★★★:5 | GAPS: 11 (2 E2E)
```
Legend: ★★★ behavior + edge + error | ★★ happy path | ★ smoke | [→E2E] integration

Value cards: three-state chips (protects=no dead store link, ever; fails_when=a null url renders an `<a>`, or an unavailable platform loses its note; why_new=no test reads the landing's chips; seam=none). Honesty words (protects=no reports/analytics/price claim, EN+AR; fails_when=copy drifts; why_new=existing cases ban Buy/$49 only; seam=none). `extra` slot (protects=the chips sit in the copy column under the body; fails_when=a refactor drops the slot; why_new=new prop; seam=none). QA phone (protects=the real page's chips, 44 px targets, the laptop kept on `/` at 375 while `/hosted` stays phone-only; fails_when=CSS move or breakpoint rule regresses; why_new=jsdom has no stylesheets; seam=none). Regression rule: the hosted-375 case, the get-it-paid case and the free Get it cases stay untouched. Tests made obsolete: none.

Test plan artifact: not written to `$GSTACK_STATE_ROOT` (non-interactive run); §4 and §4b of this brief are the test plan `/qa-reconcile` reads.

Test gaps identified: 11, all planned.

## 4. Performance review
No issues found. Static markup; the landing chunk grows by one component, one icon and ~60 lines of CSS, of which ~80 lines leave `HostedOfferPage.css` (loaded on `/hosted` only), so `/hosted` loads the same bytes and `/` a few more.
