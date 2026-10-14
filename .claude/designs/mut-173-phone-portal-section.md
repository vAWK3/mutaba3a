# MUT-173 — Landing: the phone app logs it, the portal shows it

Status: **BUILT (2026-10-14)**, branch `feature/mut-171-landing` (epic worktree `.claude/worktrees/mut-171-landing`, one worktree for the whole of MUT-171).
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
| `src/pages/landing/components/PhoneSection.tsx` (new) | `<ChapterSection part="phone" title body visual={<HostedDevicesMock />} flip extra={<PhoneExtra />} />`. `PhoneExtra` renders: a hint `<p className="landing-phone-hint">` = `landing.phone.hint` + one inline `<a href={HOSTED_OFFER_URL}>` = `landing.phone.hintLink`; then `<ul className="landing-phone-stores" aria-label={t('landing.phone.storesLabel')}>` with one `<li>` per platform in `PLATFORMS = ['ios','android']`, each decided from `MOBILE_APP_LINKS[platform]`: (a) `url` → `<a className="landing-phone-store" href={url} target="_blank" rel="noopener noreferrer">` icon + `landing.phone.store.<platform>` (the only state that looks like a control: a bordered pill); (b) `available && !url` → `<span className="landing-phone-platform">` icon + `landing.hostedOffer.platform.<platform>` + a muted `landing.phone.withAccount` ("with your hosted account"), plain text, no pill (O4: a chip shaped like a button that does nothing is a dead control); (c) `!available` → `<span className="landing-phone-platform landing-phone-platform--soon">` icon + `landing.hostedOffer.platform.comingSoon`, plain muted text. The names and the coming-soon phrase are the strings `/hosted` already uses for the same facts, so the two pages can never disagree about availability. |
| `src/pages/landing/components/PlatformIcons.tsx` | `IosIcon` (an outlined phone, stroke like `BrowserIcon`) and `AndroidIcon` (the Android robot head, `fill="currentColor"`; docblock carries Google's CC BY 3.0 attribution line), both `aria-hidden`, same `IconProps` as the others (O10: `AppleIcon` already means "Download for Mac" one section above, and the AC asks for new iOS/Android icons). |
| `src/pages/landing/components/index.ts` | export `PhoneSection`. |
| `src/pages/landing/LandingPage.tsx` | `<PhoneSection />` between `<GetItSection />` and `<FAQSection />`; the docblock's list of parts gains "the phone and the portal". |
| `src/pages/landing/LandingPage.css` | `.landing-phone-hint` (`--text-label`, `--muted`, `margin: var(--space-5) 0 0`, `max-width: 40ch`), its `a` underlined like `.landing-get-it-meta a` (axe link-in-text-block; dims on press with `--landing-press-dim`); `.landing-phone-stores` (`list-style: none; display: flex; flex-wrap: wrap; gap: var(--space-2-5); margin: var(--space-4) 0 0; padding: 0`); `.landing-phone-store` (an `inline-flex` pill, `min-height: 44px`, `gap: var(--space-2)`, `padding-inline: var(--space-3)`, `border: 1px solid var(--border)`, `border-radius: var(--radius-pill)`, `background: var(--surface)`, `color: var(--text)`, `text-decoration: none`); `a.landing-phone-store` hover keeps colour and no underline and sets `border-color: var(--border-strong)` (the global `a:hover` out-ranks a lone class otherwise, TD-122), `:active { scale: var(--press-scale) }` with the `scale var(--duration-press) var(--ease-spring)` transition, `:focus-visible { box-shadow: var(--focus-ring) }`; `.landing-phone-platform` is plain `inline-flex` text with the icon (`gap: var(--space-2)`, `min-height: 44px` so the row keeps the tap rhythm, `color: var(--text)`); `--soon` and the `withAccount` hint are `--muted` at `--text-label`. **Also (D3, amended by R1/O1/O2)**: the mock's base rules move here from `HostedOfferPage.css:48-128` (`.hosted-devices`, `.hosted-devices .landing-mock`, laptop, chrome, screen, phone, client, caption; **not** `.hosted-devices-field`, which is the request form's fieldset), **appended at the end of the file** so they keep winning over `.landing-mock` (`:374`) and the `≤640px` `.landing-mock { padding }` (`:942`) by source order as they do today; the two frame rules are written `.hosted-devices .hosted-devices-laptop` / `.hosted-devices .hosted-devices-phone` (0,2,0) so position stops mattering (O2). `.hosted-devices` gains `width: 100%; max-width: 560px` (O1: inside the flex `figure.landing-chapter-visual` a box whose children are all absolute has intrinsic width 0; on `/hosted` a grid item at `width: 100%` is what stretch already gave it; the cap also keeps laptop and phone together in the 641–900 px single column). Then the landing's own `≤640px` rule, scoped `.landing-chapter .hosted-devices`: `position: static; min-height: 0; display: grid; gap: var(--space-4); justify-items: center`; `.landing-chapter .hosted-devices .landing-mock { position: static }`; laptop `width: 100%`; caption `position: static; max-width: none` (R1/O3: the portal half of the picture and its gloss stay on phones). |
| `src/pages/landing/HostedOfferPage.css` | The base `.hosted-devices*` rules (`:47-128`) removed; the `≤640px` block (`:379-392`) **stays** (it is the hosted hero's own choice to show the phone frame only; `@web.landing.hosted-375` asserts it) and `.hosted-devices-field` stays. No other change. |
| `src/lib/i18n/translations/en.json`, `ar.json` | `landing.phone.title` = "Log it on your phone. See it all in your hosted account." / "سجّل من هاتفك. شاهد كل شيء في حسابك المستضاف." (O9: the visitor has met "hosted account" in Get it and on `/hosted`; no third name for one thing, and no sentence-initial "و"); `body` = "The phone app is for logging: an income or an expense in seconds, even with no signal. The portal, your hosted account in a browser, is where you see it all: every client, what they owe and what they've paid, on any computer." / "تطبيق الهاتف للتسجيل: دخل أو مصروف في ثوانٍ، حتى دون إشارة. أما البوابة، أي حسابك المستضاف في المتصفح، فهي حيث ترى كل شيء: كل عميل، وما عليه، وما دفعه، على أي حاسوب." (O3: "is for logging", not "does one thing", so it does not contradict `/hosted`'s "your phone and your laptop show the same numbers"; the ticket's word "portal" is introduced once, defined); `hint` = "Both come with a hosted account." / "كلاهما يأتي مع حساب مستضاف."; `hintLink` = "See hosted accounts" / "اطّلع على الحسابات المستضافة" (the same words as the Get it CTA and Settings › Businesses: one door, one name); `storesLabel` = "Phone apps" / "تطبيقات الهاتف"; `store.ios` = "iPhone, on the App Store" / "iPhone، على App Store"; `store.android` = "Android, on Google Play" / "Android، على Google Play"; `withAccount` = "with your hosted account" / "مع حسابك المستضاف". The platform names and "{platform} coming soon" are reused from `landing.hostedOffer.platform.*`. |
| `src/pages/landing/__tests__/LandingPage.test.tsx` | structure: eight parts, `phone` after `get-it`; new `describe('LandingPage phone and portal (MUT-173)')`, see §4. `MOBILE_APP_LINKS` is swapped exactly as `HostedOfferPage.test.tsx:8-19` does it: a hoisted `apps.links` object exposed through a `get MOBILE_APP_LINKS()` getter on a `vi.mock` that spreads `importOriginal`, reset in `beforeEach` (S2/O5: a factory returning the object captures one reference and every later reassignment is lost). The honesty case strips `[data-part="devices-mock"]` before matching, as `HostedOfferPage.test.tsx:40-44` does (O8: the mock's sample amounts are not prices). |
| `src/pages/landing/__tests__/ChapterSection.test.tsx` | one case: `extra` renders inside the copy column after the body; absent by default. |
| `src/pages/landing/__tests__/landingCss.test.ts` | `['a.landing-phone-store:active', 'LandingPage.css']` joins the press `it.each` (`:70-74`); `.landing-phone-hint a:active` joins the dim `it.each` (`:95`) (O6). The moved `.hosted-devices` rules need no new case. |
| `qa/features/web/landing.yaml` | feature `phone` (§4b), `tier: secondary`. The area's paths already cover `src/pages/landing/**` and `src/content/download-config.ts`. The expectation is worded for what runs today (O7): iPhone is named without a link, Android says coming soon; the store-link branch is proved by the unit test. |
| `qa/specs/web/landing.spec.ts` | `@web.landing.phone`, EN then AR (§4). The spec imports `MOBILE_APP_LINKS` and asserts each platform's state from it (a store link when `url` is set, else plain text; coming soon when not available), so it keeps passing the day Basel sets a URL; when a store link exists it also gets the press (`scale` 0.96) and hover (colour kept) checks the `press`/`hover-light` cases run on the other controls (O6). The hint link is checked for its permanent underline. On `/` at 375 px the laptop and caption stay visible (R1), while `@web.landing.hosted-375` keeps asserting the phone-only hero on `/hosted`. |
| Knowledge files | CHANGELOG; COMPONENT_REGISTRY (`ChapterSection` gains `extra`; `PhoneSection` registered beside `GetItSection`; `PlatformIcons` lists `AndroidIcon`; `HostedDevicesMock` note that its CSS lives in `LandingPage.css`); TEST_PLAN; SYSTEM_OVERVIEW landing row (one clause). No new ADR: the only durable rule (store links on `/`, never on `/hosted`) is MUT-186's 9A, restated in the component docblock. No new debt. |

Nothing in `server/`, the app, the portal, `vite.config.ts`, `netlify.toml` or `download-config.ts` changes. No new dependency. The store URLs stay `null` until Basel fills them in (the ticket says he does, once each listing is live).

## 3. Decisions

- **D1 — A new top-level section after Get it, before the FAQ.** The ticket asks for a new section and MUT-172 explicitly left it to this ticket ("MUT-173 owns the per-platform section"). Order: the privacy band ("On your device. No account.") describes the free apps and must keep reading that way, and the paid half of Get it has just introduced the hosted account and the phone app, so the section that explains those two things follows it. The structure test's list grows from seven to eight; MUT-174 will add a ninth in the same place.
- **D2 — Reuse `MOBILE_APP_LINKS`, no `app-store-config.ts`.** The ticket's "e.g." file does not exist; MUT-186 already added `MOBILE_APP_LINKS` to `download-config.ts` with `available` and `url` fields and a comment naming MUT-173 as the consumer. A second file for the same two facts would drift. Three states fall out of the two fields: a store link when `url` is set, a plain chip when the app exists but no public listing is wanted (`available`, `url: null`, iOS today), "coming soon" when it does not exist (Android today). The "coming soon" and platform strings are `/hosted`'s own, so the two pages agree by construction.
- **D3 — The visual is `HostedDevicesMock`, and its base CSS moves to `LandingPage.css`; each page owns its `≤640px` rule.** The mock is the same client's Owed now on a laptop and on a phone with the caption "Logged on the phone, there on the laptop", which is this section's idea in a picture; `/hosted` keeps using it. Its base rules live in `HostedOfferPage.css`, which `/` does not load, so they move (not copy) into `LandingPage.css`, which both pages import, appended last and with the frame rules at (0,2,0) so the cascade does not depend on where they sit (O2), and with a width on the root so a flex figure gives it room (O1). The hosted hero's phone-only rule at `≤640px` stays in `HostedOfferPage.css`; on `/` the chapter keeps laptop, phone and caption at every width (R1/O3), because a phone visitor must still see the portal half of the picture. A visitor who goes from Get it to `/hosted` sees the picture twice; accepted, the pages make the same promise. The picture shows the phone displaying a balance, which is `/hosted`'s "same numbers everywhere" promise; the copy therefore says the phone "is for logging", not that it does nothing else (O3). A phone frame with an entry form would be a new mock, not a reuse, and is *flagged for Basel* as an option, not built.
- **D4 — `ChapterSection` grows an `extra` slot** instead of a new section component with a copied layout. Three callers pass nothing and are untouched.
- **D5 — `IosIcon` and `AndroidIcon` are new.** `AppleIcon` already means "Download for Mac" one section above, so the same glyph for "iPhone" 200 px away would put one icon on two products (O10); the AC asks for new iOS/Android icons. The iOS glyph is an outlined phone in `BrowserIcon`'s stroke style; the Android glyph is the robot head with Google's CC BY 3.0 attribution in the docblock (S3).
- **D9 — Only a store link looks like a control.** The ticket's AC3 models the "coming soon" state on `GetItSection`'s Windows note, a sentence, not a bare name (O4). So state (b), the app exists but no public listing is configured (iPhone today), renders the name with "with your hosted account" beside it as plain text, and state (c) renders "{platform} coming soon" as plain text; neither is a pill. *Flagged for Basel*: the alternative is two states only (a link, or "coming soon"), which would say "iPhone coming soon" while `/hosted` says iPhone is available.
- **D6 — Store links open in a new tab** with `rel="noopener noreferrer"`, like the release-notes link in Get it: they leave the site for a store.
- **D7 — One inline `/hosted` link in the hint.** The section says the apps come with a hosted account; a reader then needs the door. It is the same label and destination as the Get it CTA just above, so it is one door with one name, not a second funnel. The `get-it-paid` QA case counts links inside its own block only, so it stays green.
- **D8 — Copy claims only what ships.** Offline capture ("even with no signal") is in the privacy policy's mobile section and MUT-63; the portal's "every client, what they owe and what they've paid" is its ledger and client views. No reports, no analytics, no price, no platform promise beyond the chips.

## 4. Tests (written first)

| Test | Cases |
|---|---|
| `LandingPage.test.tsx` › structure | eight parts: `… 'get-it', 'phone', 'faq'` |
| `LandingPage.test.tsx` › phone and portal (MUT-173) | (1) EN: `part('phone')` has the heading `landing.phone.title`, its text contains "phone app" and "portal", and the hint's link is named "See hosted accounts" with `href="/hosted"` and no `target`; (2) store link: with `ios.url = 'https://apps.apple.com/…'` the list has a link named "iPhone, on the App Store" with that href, `target="_blank"`, `rel` containing `noopener`; (3) plain: with `ios = { available: true, url: null }` the list shows "iPhone" and "with your hosted account", and has no link to a store; (4) coming soon: with `android = { available: false, url: null }` the list shows "Android coming soon" and no link; once `available` with a url, the link appears and the note goes; (5) AR: the heading is the Arabic title and the link is named "اطّلع على الحسابات المستضافة"; (6) honesty, with `[data-part="devices-mock"]` stripped first: the part's text matches none of `/report|analytic|dashboard|statistic|chart/i`, `/\bprice\b|\/month|checkout|sign ?up|\$\d/i`, and in AR none of `/تقارير|تحليل|إحصاء|رسوم|سعر|اشترك/` |
| `ChapterSection.test.tsx` | `extra` renders after the body inside `.landing-chapter-copy`; nothing extra by default |
| `landingCss.test.ts` | `a.landing-phone-store:active` in the press `it.each`; `.landing-phone-hint a:active` in the dim `it.each`; no literal scale/opacity (existing) |
| `landingCopy.test.ts` | unchanged; covers `landing.phone.*` parity automatically |
| `release-qa lint` | 0 errors; no new unmapped file |
| QA `@web.landing.phone` | EN and AR: the section is visible after `#get-it`, with the title from the dictionary; the hint's link has `href="/hosted"` and a permanent underline; each platform's state matches `MOBILE_APP_LINKS` imported in the spec (a store link when `url` is set, which then also presses to 0.96 and keeps its colour on hover; else the name as plain text; "coming soon" when not available); every store link is at least 44 px tall; the laptop, phone and caption of the mock are all visible, also at 375 px in AR with no horizontal overflow; axe reports only known violations; screenshot attached |

Gate (Node 22): `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run build`, `release-qa lint`, Playwright `--project=web` landing spec on a built web preview (throwaway config as for MUT-172). No `server/` change, so the server gate is not owed.

## 4b. QA scenarios (release-qa, `qa/features/web/landing.yaml` → `@web.landing.phone`)

| Flow | Steps, as the user would say them | Promised outcome |
|---|---|---|
| Learn what the phone app and the portal each do, and where the phone app stands | Open the landing page, scroll past Get Mutaba3a to the phone section, read it, look at the two platform lines, press "See hosted accounts"; same in Arabic, also at 375 px | The section says the phone logs income and expenses and your hosted account's portal is where you see clients, what they owe and what they paid; it claims no reports; today iPhone is named with "with your hosted account" and no link, and Android says "coming soon" (a store link appears only once one is configured); the laptop-and-phone picture stays whole on a phone; the link opens `/hosted` |

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

- MUT-173: D2 (no new config file; `MOBILE_APP_LINKS` is the config), D9 (three states; the plain state says "iPhone, with your hosted account" rather than "coming soon") and D3's picture (the phone shows a balance; an entry-form phone mock would be new work) are readings of the AC's literal text; recorded in a comment.
- The store URLs are `null` on both platforms until Basel sets them; the landing shows "iPhone, with your hosted account" and "Android coming soon" meanwhile.

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

## Outside voice (native fallback, Claude Plan subagent; Codex not installed)

Provider: codex not installed → native in-host fallback. Outside coverage: **unavailable** (no external provider). Ten findings and their dispositions:

| # | Sev | Finding | Disposition |
|---|---|---|---|
| O1 | Critical | `.hosted-devices` has no width and all its children are absolute; inside the flex `figure.landing-chapter-visual` its intrinsic width is 0, so the laptop (72% of 0, `overflow: hidden`) vanishes and the caption wraps one character per line. The plan's QA case would not catch it. | **accepted (R2, factual)**: `width: 100%; max-width: 560px` on `.hosted-devices`; the QA case asserts laptop, phone and caption visible |
| O2 | High | The moved rules win over `.landing-mock` (`LandingPage.css:374`, `:942`) only by source order; the plan named no insertion point. "No other change" to `HostedOfferPage.css` was false: the `≤640px` block mixes mock and table rules, and the glob would have moved `.hosted-devices-field` (the form's fieldset). | **accepted (R2, factual)**: append at the end of `LandingPage.css`, frame rules at (0,2,0), `.hosted-devices-field` stays; with R1 the `≤640px` block stays whole in `HostedOfferPage.css` |
| O3 | High | The picture shows the phone displaying a balance while the copy said the phone "does one thing"; on phones the moved rules would hide the laptop and the caption. | **accepted (R1 already; R3 copy)**: "is for logging" instead of "does one thing"; the landing keeps laptop and caption at every width; an entry-form phone mock is flagged for Basel, not built |
| O4 | High | AC3 models "coming soon" on a sentence; a bordered 44 px pill reading "iPhone" that does nothing is a dead control, and it is what ships with today's config. | **accepted (R4)**: D9, only a store link is a pill; the plain state adds "with your hosted account"; flagged in §7 |
| O5 | Medium | "Same shape as the `release` mock" is the wrong model; a factory returning the object captures one reference. | **accepted**: §2 names `HostedOfferPage.test.tsx:8-19`'s getter mock (same as S2) |
| O6 | Medium | `landingCss.test.ts:70-74` does enumerate press selectors; the QA press/hover cases enumerate controls by hand and the plan added neither for the chips. | **accepted**: both unit enumerations gain the new selectors; the QA case presses and hovers a store link whenever one exists |
| O7 | Medium | With both URLs `null`, the browser can never exercise the store-link branch; the yaml promised an outcome QA cannot observe. | **accepted**: yaml worded for what runs today; the link branch is the unit test's; the spec derives from the config import so it follows a future URL |
| O8 | Low | The honesty regex would match the aria-hidden mock's sample amounts; passes today only because the samples are ILS. | **accepted**: strip `[data-part="devices-mock"]` first, as `HostedOfferPage.test.tsx:40-44` does |
| O9 | Low | "Portal" is a third name for the thing the visitor knows as "hosted account"; the AR title opened a sentence with "و". | **accepted (R3)**: title says "hosted account"; the body defines "portal" once; the "و" is gone |
| O10 | Low | `AppleIcon` already means "Download for Mac" one section above; the AC asks for new iOS/Android icons. | **accepted**: `IosIcon` (outlined phone) added; D5 rewritten |

Checked and found honoured by the outside voice: tokens only, no `Button.css` on `/`, the structure list, `get-it-paid` link counts scoped to its block, `landing.yaml` paths, the `extra` slot's safety with the reveal, no reports/analytics claim, no price words, no desktop work, `/hosted` still links no store.

Cross-model tension: none; the native pass had found S1 (= O3's phone half) and the outside voice found O1/O2, which the native pass missed.

### R2: the mock's CSS move (O1, O2)
Finding: O1 Critical 9/10, O2 High 8/10, plan §2, subagent
Plan baseline: move every `.hosted-devices*` rule unchanged, insertion point unspecified
Runtime evidence: `LandingPage.css:349-353` (`.landing-chapter-visual { display: flex; justify-content: center }`), `:374-385` (`.landing-mock { width: 100%; max-width: 440px; padding }`), `:942-944`; `HostedOfferPage.css:48-58` (no width on `.hosted-devices`; children absolute), `:10-15` (grid on `/hosted` stretches it), `:219-223` (`.hosted-devices-field` is the form's), `:383` (the file's own comment on doubling selectors for order).
Factual corrections that change only where and how the same declarations are written, plus one width. No question.
State: approved
Accepted scope: §2 `LandingPage.css` and `HostedOfferPage.css` rows as amended.

### R3: copy (O3, O9)
Finding: O3 High 7/10, O9 Low 5/10, plan §2 dictionary row, subagent
Plan baseline: "does one thing", "portal" as the section's name, AR title with sentence-initial "و"
Runtime evidence: `landing.hostedOffer.hero.sub` ("your phone and your laptop show the same numbers"); `landing.getIt.paid.lead` ("a hosted account and the phone app"); `/hosted` throughout says "hosted account"; `HostedDevicesMock.tsx:53-55` shows a balance on the phone.
Wording only; the behaviour (state the split, one link, no price) is the ticket's. No question.
State: approved
Accepted scope: the dictionary row as amended.

### R4: the plain state (O4)
Finding: O4 High 7/10, plan A3/D2, subagent
Plan baseline: three states, the plain state a bordered pill reading only "iPhone"
Runtime evidence: `GetItSection.tsx:40-43` (the AC's model renders a sentence); `download-config.ts:56-59` (iOS `available: true, url: null` today); `HostedOfferPage.tsx:33-41` (`/hosted` renders "iPhone" as available).
Comparison grid:

| Choice | Current plan | A) Two states: link or "coming soon" | B) Three states; only the link is a pill, the plain state says "with your hosted account" |
|---|---|---|---|
| iPhone today | a pill that does nothing | "iPhone coming soon" while `/hosted` says it is available | "iPhone · with your hosted account", plain text |
| Android today | "Android coming soon" pill | same words, plain | same words, plain |
| When Basel sets a URL | link pill | link pill | link pill |

Question D3: What should the landing say about a phone app that exists but has no public store link yet?
Header: Plain state
Options:
A) Two states ✅ one fewer branch and one fewer string ✅ exactly the AC's words ❌ contradicts `/hosted` about iPhone until a URL is set.
B) Three states, plain text with a hint (recommended) ✅ true today and the day a URL lands ✅ nothing button-shaped that does nothing ❌ one more string and one more test case.
Completeness: A=7/10, B=10/10.
State: approved
Actual answer: B (auto, non-interactive run)
Accepted scope: D9; §2 `PhoneSection.tsx` and dictionary rows as amended.

## Final planning decisions

TODOS.md updates: none proposed. The one deferred idea (an entry-form phone mock, O3) is a copy/visual option for Basel on the ticket, not debt.

Approval readiness: PASS — R1 (D2 auto B), R2 (factual), R3 (factual), R4 (D3 auto B), S2/S3/S4, O5–O8, O10 applied to the working plan. Checked IDs: R1–R4; actual answers: D1 structure A (auto), D2 B (auto), D3 B (auto).

## NOT in scope
- An entry-form phone mock (new work; the reuse of `HostedDevicesMock` with honest copy is the plan; Basel's call).
- The store URLs (Basel sets them per the ticket); the FAQ; the portal reports view (MUT-175); Android publishing (MUT-114); retiring the desktop cards (TD-135, unfiled).

## What already exists
- `ChapterSection`, `HostedDevicesMock` (+ `.hosted-devices*` rules), `MOBILE_APP_LINKS`, `landing.hostedOffer.platform.*`, `HOSTED_OFFER_URL`, the `.hosted-device-pill` recipe, `HostedOfferPage.test.tsx`'s getter mock and mock-stripping helper, the landing QA harness, `landing.yaml`.

## Failure modes
| Path | Failure | Handling | User sees |
|---|---|---|---|
| Store `url` set to a listing that is not public | the store's own "not available" page | none possible in code; URL is Basel's, `null` until live | the store's message (not silent) |
| A `landing.phone.*` key missing in one language | raw key rendered | `landingCopy.test.ts` parity fails before merge | n/a |
| `.hosted-devices` rules inserted before `.landing-mock` | laptop padded/440 px, phone padding changes at ≤640 on both pages | appended last + (0,2,0) frame rules; QA phone case asserts all three parts visible; `hosted-375` unchanged | n/a |
No critical gaps (every failure is caught by a test or is not silent).

Worktree parallelization: Sequential implementation, no parallelization opportunity (one component, one stylesheet, two dictionaries).

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above.

- [ ] **T1 (P1, human: ~2h / CC: ~10min)** — LandingPage.css / HostedOfferPage.css — Move the mock's base rules to the end of `LandingPage.css` at (0,2,0), add `width: 100%; max-width: 560px`, keep the `≤640px` block and `.hosted-devices-field` in `HostedOfferPage.css`, add the landing's own `≤640px` stacking rule
  - Surfaced by: Scope Challenge S1 (R1); Outside voice O1, O2 (R2)
  - Files: `src/pages/landing/LandingPage.css`, `src/pages/landing/HostedOfferPage.css`
  - Verify: `@web.landing.phone` (laptop/phone/caption visible at 375), `@web.landing.hosted-375` unchanged
- [ ] **T2 (P1, human: ~1h / CC: ~5min)** — PhoneSection — Three states where only the store link is a pill; plain state carries "with your hosted account"
  - Surfaced by: Outside voice O4 (R4)
  - Files: `src/pages/landing/components/PhoneSection.tsx`, `LandingPage.css`, `en.json`, `ar.json`
  - Verify: `LandingPage.test.tsx` cases (2)–(4)
- [ ] **T3 (P2, human: ~30min / CC: ~3min)** — Copy — "is for logging"; title says "hosted account"; body defines "portal" once; AR title without the leading "و"
  - Surfaced by: Outside voice O3, O9 (R3)
  - Files: `en.json`, `ar.json`
  - Verify: `LandingPage.test.tsx` case (1), (5); honesty case
- [ ] **T4 (P2, human: ~30min / CC: ~3min)** — Tests — getter mock as in `HostedOfferPage.test.tsx`; strip the mock before honesty matching; press/dim enumerations in `landingCss.test.ts`; QA presses/hovers a store link when one exists and checks the hint underline
  - Surfaced by: S2/O5, O6, O8
  - Files: `src/pages/landing/__tests__/LandingPage.test.tsx`, `landingCss.test.ts`, `qa/specs/web/landing.spec.ts`
  - Verify: `npx vitest run src/pages/landing`; the QA case
- [ ] **T5 (P3, human: ~20min / CC: ~2min)** — PlatformIcons — `IosIcon` (outlined phone) and `AndroidIcon` with the CC BY 3.0 attribution in its docblock
  - Surfaced by: S3, O10
  - Files: `src/pages/landing/components/PlatformIcons.tsx`
  - Verify: render in `LandingPage.test.tsx` (chips carry an `svg[aria-hidden]`)
- [ ] **T6 (P3, human: ~15min / CC: ~2min)** — landing.yaml — `phone` feature worded for what runs today
  - Surfaced by: Outside voice O7
  - Files: `qa/features/web/landing.yaml`
  - Verify: `release-qa lint`
_No new tasks from Performance review._

## Unresolved decisions that may bite you later
Auto-decided on the recommended option (non-interactive run), for Basel to confirm or reverse:
- D1 — structure: original arrangement (a `PhoneSection` component; no smaller arrangement keeps Phase 5).
- D2 — on `/` at ≤640 px the mock keeps laptop, phone and caption (`/hosted` stays phone-only).
- D3 — three chip states; the plain state reads "iPhone · with your hosted account", not "coming soon".
- Open option, not a decision: an entry-form phone mock instead of the balance mock (new work).

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is (4 findings: S1 P1, S2 P2, S3 P3, S4 P3; all accepted)
- Architecture Review: 1 issue found (R1)
- Code Quality Review: 3 issues found (S2, S3, S4)
- Test Review: diagram produced, 11 gaps identified (all planned)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 3 in this review (auto-decided, listed for Basel)
- Outside voice: provider codex not installed; native fallback (Claude Plan subagent) completed, 10 findings, all accepted; outside coverage unavailable
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 3/3 = answers picking a 10/10 option / answers scored for Completeness

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | not run | — |
| Outside Review | native fallback (Claude Plan subagent); codex not installed | Independent 2nd opinion | 1 | unavailable (native fallback completed) | 10 findings, 10 accepted |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN (all mapped to tasks T1–T6) | 15 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | not run | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | not run | — |

- **OUTSIDE COVERAGE:** provider codex, phase plan-review, not installed → native fallback completed with 10 findings (no external coverage credit).
- **VERDICT:** ENG REVIEWED — issues all mapped to tasks; ready to implement with T1–T6 folded into the plan above. eng review required (status issues_open, mapped work).

**UNRESOLVED DECISIONS:**
- D1 structure: original arrangement (auto)
- D2 mock on phones on `/`: keep laptop + caption (auto)
- D3 plain chip state: three states with "with your hosted account" (auto)
