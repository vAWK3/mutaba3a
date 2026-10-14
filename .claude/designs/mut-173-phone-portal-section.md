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
