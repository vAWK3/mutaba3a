# MUT-172 — Landing: state the free vs. paid split, with the CTA to `/hosted`

Status: **BUILT and reconciled (2026-10-14)**, branch `feature/mut-185-go-hosted` (epic worktree). Review ledger and the qa-reconcile record are at the end of this file. Branch `feature/mut-185-go-hosted` (epic worktree, after MUT-188).
Ticket: MUT-172 (Story) · parent epic MUT-171 (landing) · the third CTA door of epic MUT-185 ("a CTA in the sidebar, in Settings › Profiles, or on the landing page"). Blocked by MUT-186 (merged to local main a7d5068, Jira In Review → gate passes). Siblings under MUT-171: MUT-173 (phone + portal section, Backlog, unplanned), MUT-174 (Malafat section, Backlog). Basel's re-cut comment (2026-10-14): the CTA links to the `/hosted` page and its request form, not `mailto:`.
Tracker: Jira · barmajiyat.atlassian.net · MUT via atlassian-barmajiyat · Backlog = planning allowed · finished → In Review after /qa-reconcile.

## 1. Problem and acceptance criteria

`GetItSection` tells every visitor everything is free. It never says that a hosted account and the phone app are paid, or how to ask for one.

| # | AC (ticket) | Proved by |
|---|---|---|
| A1 | Free-tier copy (Web/Mac/Windows) stays accurate and unchanged in meaning | `landing.getIt.{free,freeNote,mac,windows,webApp,…}` untouched; existing `LandingPage.test.tsx` Get it cases pass unchanged; the new block adds "The apps above stay free." |
| A2 | New copy states hosted + mobile are paid, with a "Contact us" CTA (no price, no checkout) | new Get it case: the paid block names the hosted account and the phone app, says they come with a paid plan, and its one CTA is a link to `HOSTED_OFFER_URL`; the honesty cases (no `$49`, no "Buy", no Arabic شراء) still pass; a new assertion bans "price", "/month", "checkout", "sign up" in the block |
| A3 | i18n keys for EN and AR, RTL-correct | `landing.getIt.paid.*` in `en.json`/`ar.json`; `landingCopy.test.ts` key parity covers them; the new AR case renders under `dir="rtl"` |
| A4 | Existing GetItSection tests updated; new coverage for the paid-vs-free copy | `LandingPage.test.tsx` "LandingPage Get it" block gains three cases (EN block + CTA, AR block, honesty words); QA `@web.landing.get-it-paid` |
| G | Brand v2 tokens; "one idea per section" (MUT-75 brief L7) | the block lives **inside** `get-it` (no eighth part; the structure test's seven-part list is unchanged); tokens only |

## 2. Where it goes

The nearest thing built the same way is the Get it section itself: a centred section with a free line, three option cards, and a meta line. The paid block is a fourth element at the end of the same section, in the same `landing-container`.

| File | Change |
|---|---|
| `src/pages/landing/components/GetItSection.tsx` | After `.landing-get-it-meta`, a `<div className="landing-get-it-paid" data-part="get-it-paid">` with one lead `<p>` (`paid.lead`), one hint `<p>` (`paid.hint`) and `<a href={HOSTED_OFFER_URL} className="landing-get-it-paid-cta">` (`paid.cta`). No heading and no card: the section's one idea is "how to get it", and this is its second half (outside voice O7). The docblock changes from "free during early access" to "free apps first, then the paid hosted account". **Not** `btn btn-secondary`: the landing never imports `Button.css` (only `/hosted` does), so those classes would be unstyled on `/` (eng review R1). `HOSTED_OFFER_URL` is imported from `download-config.ts` beside `DOWNLOAD_URLS`/`WEB_APP_URL` (same import line). A plain anchor, same tab: `/hosted` is a landing-internal page served by the same origin (D3). Nothing else in the component changes. |
| `src/pages/landing/LandingPage.css` | `.landing-get-it-paid`: `margin: var(--space-10) auto 0; max-width: 48ch; display: grid; gap: var(--space-3); justify-items: center;` (the same width as `.landing-get-it-note`; no border, no surface). `.landing-get-it-paid-lead` at `--text-body`, `--weight-semibold`, `--text`; `.landing-get-it-paid-hint` at `--text-label`, `--muted`; both `margin: 0`. The CTA gets `min-height: 44px` (the landing's tap-target rule, `@web.landing.375`; outside voice O6). `.landing-get-it-paid-cta` is a landing-native button modelled on `.hero-cta-primary` (HeroSection.css): `inline-flex`, `padding: var(--space-3) var(--space-6)`, `border-radius: var(--radius-card)`, `background: var(--text)`, `color: var(--bg)`, `text-decoration: none`, `transition: scale var(--duration-press) var(--ease-spring), opacity 0.15s ease`; `:hover` keeps colour and `text-decoration: none` and dims with `var(--landing-hover-dim)` (the global `a:hover` out-ranks a lone class otherwise, MUT-77); `:active { scale: var(--press-scale) }`; `:focus-visible { box-shadow: var(--focus-ring) }`. `landingCss.test.ts` bans literal scale/duration/opacity values, so tokens only. Logical properties only; nothing directional. |
| `src/lib/i18n/translations/en.json`, `ar.json` | `landing.getIt.paid.lead` = "Unlike the apps above, a hosted account and the phone app come with a paid plan." / "على خلاف التطبيقات أعلاه، يأتي الحساب المستضاف وتطبيق الهاتف مع خطة مدفوعة."; `paid.hint` = "Your records on our servers, on every device you sign in on. Tell us what you need and we'll reply with an offer." / "سجلّاتك على خوادمنا، على كل جهاز تسجّل الدخول منه. أخبرنا بما تحتاجه ونردّ عليك بعرض."; `paid.cta` = "See hosted accounts" / "اطّلع على الحسابات المستضافة" (the same words as Settings › Businesses, `settings.profile.hosted.cta`). The lead states the split without a permanence claim, so the existing "Free during early access" line keeps its meaning (A1; outside voice O2). No "checkout", "card" or platform name: the honesty regex bans the first, and "every device you sign in on" is the account's property, not a promise about Android (O5). |
| `src/pages/landing/__tests__/LandingPage.test.tsx` | In "LandingPage Get it": (1) EN: `part('get-it-paid')` contains "Unlike the apps above" and "paid plan"; the CTA is a link named "See hosted accounts" with `href="/hosted"` and no `target`, and it is the block's only link; the free line "Free during early access" is still in `get-it`; (2) AR: the CTA is named "اطّلع على الحسابات المستضافة" and the lead contains "خطة مدفوعة" (direction is already covered by the language test); (3) honesty: the block's text matches none of `/\bprice\b|\/month|checkout|sign ?up|\$\d|android|ios\b/i` and the Arabic none of `/سعر|اشترك|إنشاء حساب/`. The seven-part structure test is untouched and must stay green. |
| `qa/features/web/landing.yaml` (new) | **Resolves TD-130** (D6; a reasonable fix, not a forced one: MUT-188 was accepted with the lint's pre-existing errors cited): `app: web`, `area: landing`, area paths `src/pages/landing/**` and `src/content/download-config.ts` only (no translations file: every string edit would otherwise map to all 13 features; `home.yaml` scopes the same way). One feature per existing tag (`header-cta`, `transparency`, `press`, `hover-light`, `375`, `title`, `reveal`, `privacy-bar`, `download`, `hosted`, `hosted-375`, `hosted-slash`), titles from the spec's test names; `download` carries its own `paths: [src/pages/download/**]`; `tier: secondary` (tertiary for `title` and `hosted-slash`); `legacy` only where the spec names the ticket (`MUT-77` for the bar/motion cases, `MUT-186` for the three hosted cases; none for `hover-light` and `download`). Plus the new `get-it-paid`, `tier: secondary` like `hosted` (the form converts; the landing block only points at it). |
| `qa/specs/web/landing.spec.ts` | `@web.landing.get-it-paid`, EN then AR: `openLanding`, scroll `#get-it` into view, the paid block is visible with the heading from the dictionary, its CTA is the only link in the block, it presses (`scale` 0.96) and keeps its label colour with no underline on hover (the two checks `@web.landing.press`/`hover-light` run on the other landing controls; S2), click it → URL is `/hosted` and the hosted page's hero title is visible. Screenshot attached (`attachScreenshot`) like the other landing cases. |
| `.claude/TECH_DEBT.md` | TD-130 → Resolved (MUT-172). |
| Knowledge files | CHANGELOG, COMPONENT_REGISTRY (`GetItSection` entry), TEST_PLAN, SYSTEM_OVERVIEW landing row (one clause). No new ADR: no decision outlives the ticket. |

Nothing in `server/`, the app, the portal, `vite.config.ts` or `download-config.ts` changes. No new dependency.

## 3. Decisions

- **D1 — CTA label is "See hosted accounts", not the literal "Contact us".** Basel's re-cut moved the CTA's target from `mailto:` to the `/hosted` page, which explains the trade first and ends in the request form. A button that says "Contact us" and opens an explainer page breaks the promise of its own label; "See hosted accounts" is what the app's Settings row already says for the same destination (MUT-187), so a person who meets both sees one door. The body copy keeps the ticket's intent in words: "Tell us what you need and we'll reply with an offer." *Flagged for Basel* as a departure from the AC's literal wording.
- **D2 — Inside Get it, not a new section.** MUT-75 L7 fixes the landing at seven one-idea parts and `LandingPage.test.tsx` pins the list. The ticket says "update/extend the Get it area". A nested `data-part="get-it-paid"` is addressable in tests and QA without becoming an eighth top-level part. MUT-173's phone/portal section is a separate ticket and is not pre-empted here.
- **D3 — Same tab, plain anchor to `HOSTED_OFFER_URL`.** The landing and `/hosted` share an origin and chrome (`LandingHeader`/`LandingFooter`); a new tab would be a second copy of the same site. MUT-187's new-tab rule was for links that leave a running app.
- **D4 — "Phone app", no platform names, and no "on your phone" promise.** `MOBILE_APP_LINKS` has iOS available and Android not; the ticket says "iOS/Android app" but naming Android as a paid product it can't yet install is a claim the page can't keep (the same honesty rule as `/hosted`, 9A). The hint says "on every device you sign in on" (the account's property) rather than "on your phone" (O5). MUT-173 owns the per-platform section and availability chips.
- **D5 — The free copy is untouched**, including the Mac and Windows cards, because A1 says so. Desktop is being retired until v2 (Basel, 2026-10-14; TD-135) and the landing still advertises it, but that is a separate, unfiled retirement ticket. This ticket states the split in the paid lead ("Unlike the apps above…") so it is unambiguous without adding a permanence claim ("stay free") that the early-access line and the retirement would both contradict (O2).
- **D6 — Catalogue the whole landing spec, not only the new tag.** `release-qa lint` fails on 12 pre-existing `@web.landing.*` tags with no feature (TD-130). CLAUDE.md Phase 5 (committed to main as a4b9e90 on 2026-10-14; the branch merged it before this build) asks the lint to report no errors. MUT-188 passed with the pre-existing errors cited, so this is a reasonable TD-130 fix taken here because the ticket touches the landing anyway, not a forced one. It is mechanical (titles from the spec) and called out as a conscious inclusion.

## 4. Tests (written first)

| Test | Cases |
|---|---|
| `src/pages/landing/__tests__/LandingPage.test.tsx` → "LandingPage Get it" | EN paid block: "Unlike the apps above", "paid plan", the only link "See hosted accounts" → `/hosted`, no `target`; the early-access line still present; AR paid block: "خطة مدفوعة", link "اطّلع على الحسابات المستضافة" → `/hosted`; honesty: the block matches none of the banned EN/AR words (price, /month, checkout, sign up, $, android, ios; سعر, اشترك, إنشاء حساب); the existing structure test (seven parts) and honesty tests stay as they are |
| `src/pages/landing/__tests__/landingCopy.test.ts` | unchanged; covers `landing.getIt.paid.*` parity automatically |
| `release-qa lint` | 0 errors after `landing.yaml`; no new unmapped file under `src/pages/landing/**` |
| QA `@web.landing.get-it-paid` | EN and AR: block visible, CTA named from the dictionary, presses to 0.96 and keeps its colour on hover, click lands on `/hosted` with its hero title visible |

Gate (Node 22): `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run build`, `release-qa lint`, Playwright `--project=web` landing spec on a built web preview. No `server/` change, so the server gate is not owed.

## 4b. QA scenarios (release-qa, `qa/features/web/landing.yaml` → `@web.landing.get-it-paid`)

| Flow | Steps, as the user would say them | Promised outcome |
|---|---|---|
| Learn what is free and what is paid, then ask | Open the landing page, scroll to "Get Mutaba3a", read the lines under the three apps, press "See hosted accounts"; same in Arabic | The lines say that, unlike the apps above, a hosted account and the phone app come with a paid plan, and that we reply with an offer; the button opens the `/hosted` page in the same tab, where the request form is |

## 5. Reuse analysis

| Need | Reused | New |
|---|---|---|
| Section, container, headline tokens | `GetItSection`, `LandingPage.css` | one block's CSS |
| `/hosted` path | `HOSTED_OFFER_URL` (`download-config.ts`) | — |
| Button look | the `.hero-cta-primary` recipe (tokens, press, hover dim) | `.landing-get-it-paid-cta` (same recipe; `Button.css` is not loaded on `/`) |
| CTA words | `settings.profile.hosted.cta` (same strings, landing namespace) | `landing.getIt.paid.*` |
| Landing QA harness | `openLanding`, `attachScreenshot`, `ar` | one test + `landing.yaml` |

## 6. Scope check

Covers A1–A4 and the guardrail. Conscious additions: D6 (`landing.yaml` for the whole spec, resolves TD-130) because the Phase 5 gate cannot otherwise pass. Not in scope: a price, checkout or signup (ticket); platform names for the phone app (MUT-173); retiring the desktop cards (unfiled retirement ticket, TD-135); any change to `/hosted` itself.

## 7. Follow-ups to note on tickets

- MUT-172: D1 label and D4 wording are departures from the AC's literal text; recorded in a comment.
- Desktop retirement: still no ticket; the landing's Mac/Windows cards and `/download` keep advertising it (TD-135).

Business / product impact
- The landing page is the funnel's widest door: every visitor now learns that a hosted account exists, that it is paid, and how to ask, without a price or a checkout, which is the sales-assisted model Basel chose.
- Epic MUT-185's three doors (sidebar, Settings, landing) all lead to the same `/hosted` request form; after this only the conditional MUT-197 remains.
- Risk: one block of copy and one link; the structure and honesty tests keep the page's seven-part story and its no-price promise intact.

---

# Eng review (/plan-eng-review, 2026-10-14, non-interactive by Basel's instruction)

Target: this plan. Reviewer: Claude (native) + an in-host Plan subagent as the outside voice (Codex not installed). Decision gates were auto-decided on the recommended option and are listed under "Unresolved decisions" for Basel.

## Scope Challenge

**A. Assess.** Already solving each sub-problem: `GetItSection` + `LandingPage.css` (section, container, cards); `HOSTED_OFFER_URL`; `.hero-cta-primary` (the landing's button recipe); `landingCopy.test.ts` parity; the landing QA harness (`openLanding`, `attachScreenshot`). Complexity: 9 files touched (2 source, 2 dictionaries, 1 test, 1 new feature file, 1 spec, TECH_DEBT + knowledge), 0 new modules or services. Search check: no new pattern. TODOS.md: nothing overlaps. Distribution: Netlify builds `main`; no CI change.

**B. Complexity gate** (9 files ≥ 8): structure question, **auto-decided → Original arrangement** (no module is added; there is nothing smaller that keeps the feature file and the spec, which Phase 5 requires).

**C. Findings**

| # | Sev | Conf | Where | Finding | Disposition |
|---|---|---|---|---|---|
| S1 | P1 | 9/10 | plan §2 `className="btn btn-md btn-secondary"` | `Button.css` is imported only by `HostedOfferPage.tsx:3` and `HostedRequestForm.tsx:3`; `LandingPage.tsx` imports `LandingPage.css` only. On `/` the classes are unstyled until a visitor has loaded `/hosted`'s chunk. | **accepted (R1, factual)**: a landing-native `.landing-get-it-paid-cta` built from the `.hero-cta-primary` recipe |
| S2 | P3 | 8/10 | plan §2 QA | `@web.landing.press` and `@web.landing.hover-light` enumerate controls by hand (`heroCta`, `.landing-lang-toggle`, `a.landing-get-it-option`, header CTA); the new CTA would not be checked by them. | **accepted**: the new `@web.landing.get-it-paid` case asserts press (`scale` 0.96) and hover (colour kept, no underline) on the CTA itself, the same two checks |

Result: **scope accepted as-is**. MODE = FULL_REVIEW.

## Decision ledger

### R1: CTA styling on the landing
Finding: S1, P1, 9/10, plan §2, Claude
Plan baseline: original proposal, `btn btn-md btn-secondary`
Runtime evidence: `grep Button.css src/pages/landing` → `HostedOfferPage.tsx:3`, `HostedRequestForm.tsx:3` only; `HeroSection.css:60-90` `.hero-cta-primary` (ink fill, hover dim, press scale, focus ring); PATTERNS: "the landing keeps its own selectors because its controls are not `Button`s".
Factual correction with one necessary change: no alternative keeps the ticket's CTA styled on `/` without either importing `Button.css` into the landing chunk (new stylesheet for one control) or the landing recipe. The recipe is the repo's own rule. No question.
State: approved
Accepted scope: `.landing-get-it-paid-cta` in `LandingPage.css` as specified in §2.

Approval readiness: PASS — R1 factual; S2 proof of approved behaviour.

## 1. Architecture review
- **[P1] (9/10) plan §2** — unstyled `btn` classes on the landing → R1.
- Boundaries: one component, one stylesheet, two dictionaries; no router, no app, no portal, no server. `/hosted` is reached by a plain same-origin anchor, exactly as `/privacy` and `/download` are from the footer.
- Data flow: none at runtime (static copy + one href). One production failure: `/hosted` is not deployed yet on Netlify (verified 2026-10-14) while this lands first → the CTA would 404 until the next deploy. Both ship in the same `main` push, so the window is zero in practice; noted in the ticket comment.

Dispositions: A1 accepted (R1).

## 2. Code quality review
- No shared-code extraction: the CTA recipe is 12 declarations; extracting a shared landing button class across `HeroSection.css` and `LandingPage.css` would couple two files for two callers with different padding and icon slots. Rejected (rubric: no net saving).
- Error handling: none needed (no state).
- **[P3] (8/10)** QA enumerations miss the new control → S2 accepted.

Dispositions: Q1 accepted (S2).

## 3. Test review
Framework: Vitest + Playwright QA (CLAUDE.md).

```
CODE PATHS                                                   USER FLOWS
[+] GetItSection.tsx                                         [+] Learn free vs paid, then ask
  └── paid block (always rendered)                             ├── [GAP→new] EN: block, "stay free", "paid plan", CTA → /hosted — LandingPage.test
      ├── [GAP→new] CTA href = HOSTED_OFFER_URL, no target      ├── [GAP→new] AR: block, CTA, rtl — LandingPage.test
      └── [★★★ TESTED] seven-part structure unchanged — T1      ├── [GAP→new][→E2E] click lands on /hosted hero — @web.landing.get-it-paid
[+] LandingPage.css .landing-get-it-paid(-cta)                 ├── [GAP→new][→E2E] press scale + hover keeps colour — same case
  ├── [★★★ TESTED] no literal scale/opacity — landingCss.test   └── [★★★ TESTED] no price/Buy/$49 on main — honesty cases (+ new banned words)
  └── [GAP→new] hover keeps colour, no underline — QA          [+] Catalogue
[+] en/ar landing.getIt.paid.*                                 └── [GAP→new] release-qa lint 0 errors, landing.yaml maps 13 tags
  └── [★★★ TESTED] key parity — landingCopy.test
COVERAGE (before build): 4/12 (33%) | after the planned tests: 12/12
QUALITY: ★★★:4 | GAPS: 8 (2 E2E)
```
Legend: ★★★ behavior + edge + error | ★★ happy path | ★ smoke | [→E2E] integration

Value cards: LandingPage paid block (protects=the split is stated and the CTA points at /hosted; fails_when=copy or href regress; why_new=no test reads the block; seam=none). Honesty words (protects=no price/checkout/signup claim in the block, EN+AR; fails_when=copy drifts; why_new=existing honesty cases ban `$49`/Buy only; seam=none). QA get-it-paid (protects=the real page's CTA reaches /hosted with press and hover like every landing control; fails_when=CSS not loaded, route broken; why_new=jsdom has no stylesheets; seam=none). Regression rule: the seven-part structure test and the existing Get it cases stay untouched. Tests made obsolete: none.

Test gaps identified: 8, all planned.

## 4. Performance review
No issues found. Static copy; the landing chunk grows by one block of CSS.

## Outside voice (native fallback, Claude Plan subagent; Codex not installed)

Provider: codex not installed → native in-host fallback. Outside coverage: **unavailable**. Ten findings and their dispositions:

| # | Sev | Finding | Disposition |
|---|---|---|---|
| O1 | Critical | The plan's honesty regex bans `checkout` while `paid.body` says "no checkout". | **accepted (R2, factual)**: copy drops "no card, no checkout"; the ticket's "no price, no checkout" is a property of the design, not copy |
| O2 | High | "The apps above stay free." is a permanence claim that contradicts "Free during early access" and A1. | **accepted (R2)**: the lead says "Unlike the apps above, … come with a paid plan"; no "stay free" |
| O3 | High | CLAUDE.md Phase 5 was on `main` (a4b9e90) but not on the branch; "only honest way" overstated. | **accepted (factual)**: main merged into the branch before the build; D6 reworded as a reasonable TD-130 fix |
| O4 | Medium | `landing.yaml` paths: translations at area level map every string edit to 13 features; `download` needs `src/pages/download/**`. | **accepted**: no translations path; `download` gets its own `paths` |
| O5 | Medium | "on your phone" repeats the Android claim D4 avoids. | **accepted**: "on every device you sign in on" |
| O6 | Medium | `btn-md` is 40 px; the landing insists on 44 px targets. | **accepted**: `min-height: 44px` on the landing-native CTA (R1 already replaced `btn-*`) |
| O7 | Medium | A boxed sub-section with h3 + two paragraphs + button is an eighth section in disguise. | **accepted (R3)**: no heading, no card; one lead, one hint, one CTA, same width as the free note |
| O8 | Low | `.btn` reaches `/` only through the app's import graph. | agrees with R1 (landing-native class; no `Button.css` dependency) |
| O9 | Low | Tiers and `legacy` guessed. | **accepted**: `get-it-paid` secondary; `legacy` only where known |
| O10 | Low | Docblock drift, duplicate `dir` assertion, misnamed key. | **accepted**: docblock updated; `dir` assertion dropped; keys are `lead`/`hint`/`cta` |

Cross-model tension: none; the native pass and the subagent agree on R1. The subagent caught O1–O3, which the native pass missed.

### R2: paid-block copy (O1, O2, O5)
Finding: O1 Critical 9/10, O2 High 9/10, O5 Medium 8/10, plan §2, subagent
Plan baseline: original copy (title/free/body)
Runtime evidence: `en.json` `landing.getIt.free` "Free during early access." + `freeNote` "We'll tell you before that changes"; `HostedOfferPage.test.tsx:149` bans `/checkout/i`; `MOBILE_APP_LINKS.android.available === false`.
Factual corrections that change wording only; the behaviour (state the split, one CTA, no price) is the ticket's. New copy in §2. No question.
State: approved
Accepted scope: `landing.getIt.paid.{lead,hint,cta}` as in §2.

### R3: block shape (O7)
Finding: O7 Medium 7/10, plan §2, subagent
Plan baseline: boxed block with h3, two paragraphs, CTA
Runtime evidence: MUT-75 L7 (one idea per section); `.landing-get-it-note` is the section's existing 48ch muted paragraph.
Comparison grid:

| Choice | Current | A) Box with h3 | B) Lead + hint + CTA, no box |
|---|---|---|---|
| R3 shape | box | heading competes with the section's h2; a card competes with the three option cards | same copy, same CTA, no new hierarchy |
| A2 stated, CTA present, tests | fixed | same | same |

Question D1: Box with heading, or two lines and a button?
Header: Block shape
Options:
A) Box with h3 ✅ visually separated from the free cards ✅ scannable ❌ a second heading and a fourth card inside a one-idea section.
B) Lead + hint + CTA, no box (recommended) ✅ reads as the second half of "how to get it" ✅ no new hierarchy, 12 declarations of CSS ❌ less visual weight for the funnel's door (the CTA button carries it).
Completeness: A=10/10, B=10/10.
State: approved
Actual answer: B (auto, non-interactive run)
Accepted scope: §2 as amended.

Approval readiness (re-run after Outside Voice): PASS — R1 (factual), R2 (factual), R3 (D1 auto B), S2 and O4/O6/O9/O10 applied to the working plan.

## NOT in scope
- Retiring the Mac/Windows cards (unfiled desktop-retirement ticket, TD-135).
- Platform names and store availability for the phone app (MUT-173).
- Any change to `/hosted` (MUT-186 merged), to prices or to signup (ticket).

## What already exists
- `GetItSection.tsx`, `LandingPage.css` `.landing-get-it-*`; `.hero-cta-primary` recipe (`HeroSection.css:60-90`); `HOSTED_OFFER_URL`; `landingCopy.test.ts` parity; `qa/specs/web/landing.spec.ts` helpers; `qa/features/web/home.yaml` as the feature-file shape.

## Failure modes
| Path | Failure | Handling | User sees |
|---|---|---|---|
| CTA click before `/hosted` is deployed | 404 from Netlify's SPA fallback → the app shell | none needed: both land in one push | n/a in practice |
| Dictionary key missing in one language | parity test fails at build | — | — |
Critical gaps: 0.

## Worktree parallelization strategy
Sequential implementation, no parallelization opportunity.

## Implementation Tasks
- [ ] **T1 (P1, human: ~1h / CC: ~5min)** — GetItSection + CSS — paid block, landing-native CTA class, EN/AR keys — Surfaced by: ticket A1–A3, R1 — Files: GetItSection.tsx, LandingPage.css, en.json, ar.json — Verify: `npx vitest run src/pages/landing`
- [ ] **T2 (P1, human: ~45min / CC: ~5min)** — tests — three Get it cases (EN, AR, honesty) — Surfaced by: Test review — Files: LandingPage.test.tsx — Verify: same
- [ ] **T3 (P1, human: ~1h / CC: ~8min)** — QA catalogue — `landing.yaml` (13 features) + `@web.landing.get-it-paid` with press/hover — Surfaced by: D6, S2 — Files: qa/features/web/landing.yaml, qa/specs/web/landing.spec.ts — Verify: `release-qa lint`; Playwright `--project=web` landing on a built preview
- [ ] **T4 (P2, human: ~20min / CC: ~3min)** — docs — TD-130 resolved, CHANGELOG, registry, TEST_PLAN, SYSTEM_OVERVIEW — Verify: grep
_No new tasks from Performance review._

## Unresolved decisions that may bite you later
Auto-decided in this non-interactive run; overturn before /eng-build if wrong:
- D1: CTA label "See hosted accounts" instead of the AC's literal "Contact us".
- D4: "phone app" without naming iOS/Android.
- D6: cataloguing the 12 pre-existing landing tags (resolves TD-130) inside this ticket.
- R3/D1: the paid block is two lines and a button, not a boxed sub-section with a heading.

## Suppressed findings (appendix)
- (4/10) `.landing-get-it-note` has `margin-bottom: var(--space-10)` and the paid block adds `margin-top: var(--space-10)` after the meta line; the section may read long on phones. Visual check in QA at 375.

## qa-reconcile (2026-10-14)

Three sources: ticket MUT-172 (A1–A4 + guardrail), this plan (as amended by the eng review and the outside voice), the diff of the four MUT-172 commits (e01edd5, 343fcc7, 8d83d8e + the brief).

| Criterion | In plan? | In code? | Verdict |
|---|---|---|---|
| A1 free-tier copy unchanged in meaning | yes (D5) | `landing.getIt.{free,freeNote,mac,windows,webApp,…}` untouched; test "leaves the free line in place" | MET |
| A2 hosted + mobile stated as paid, CTA, no price, no checkout | yes (D1, D4, R2) | `get-it-paid` lead + hint; one link "See hosted accounts" → `/hosted`; block-scoped honesty ban | MET, with **conscious drift**: the CTA says "See hosted accounts", not "Contact us" (D1); "phone app", not "iOS/Android" (D4) |
| A3 EN + AR, RTL-correct | yes | `landing.getIt.paid.{lead,hint,cta}`; parity test; AR unit + QA cases | MET |
| A4 tests updated / new coverage | yes | three new Get it cases; QA `@web.landing.get-it-paid` EN/AR on a built preview (2/2) | MET |
| Guardrail: Brand v2 tokens, one idea per section | yes (D2, R3) | tokens only (`landingCss.test` contract); nested `data-part`, seven parts unchanged | MET |
| D6 `landing.yaml` (plan, not ticket) | yes | 13 features; `release-qa lint` 0 errors; TD-130 resolved | conscious addition |

Scope creep: none beyond D6 (declared). Gaps: none. Gate (Node 22): lint 0 errors (6 pre-existing warnings), typecheck clean, 304 files / 4326 tests, build ok (one pre-existing esbuild warning about `@media` inside `:has()` in a shared stylesheet, present before this branch), `release-qa lint` 0 errors, QA 2/2. Code review (medium): 0 correctness findings, 2 low notes (shared landing button recipe rejected in the eng review; page-wide honesty regex left as a follow-up). Browser check on the worktree dev server: the block renders under the three cards with the ink button, EN.

Verdict: **PASS** (D1, D4, D6, R3 auto-decided; Basel to confirm or overturn).

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is
- Architecture Review: 1 issue found
- Code Quality Review: 1 issue found
- Test Review: diagram produced, 8 gaps identified (all planned)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 4 in this review (D1 label, D4 wording, D6 catalogue, R3 shape; all auto-decided, Basel to confirm)
- Outside voice: codex not installed → native Claude subagent (in-host), completed with 10 findings; outside coverage unavailable
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 1/1 (R3 → B 10/10)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | native fallback (codex not installed), `/plan-eng-review` | Independent 2nd opinion | 2 | unavailable (in-host completed, issues_found) | 10 findings, 1 overlapping, 9 new, all folded in |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 2 | ISSUES OPEN | 10 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** provider codex, phase plan-review, unavailable (not installed); native in-host fallback completed with 10 findings (O1–O10), dispositions above.
- **CROSS-MODEL:** same harness, model identity unknown. Overlap: O8=R1. New from the subagent: O1–O7, O9, O10.
- **VERDICT:** Eng review ISSUES OPEN (every finding mapped to T1–T4; four auto-decisions await Basel) — eng review required

**UNRESOLVED DECISIONS:**
- D1: CTA label "See hosted accounts" instead of the AC's literal "Contact us" — auto-decided, confirm or overturn
- D4: "phone app", no platform names, "every device you sign in on" — auto-decided, confirm or overturn
- D6: `qa/features/web/landing.yaml` catalogues all 13 landing tags (resolves TD-130) — auto-decided, confirm or overturn
- R3: two lines and a button, no boxed sub-section — auto-decided B, confirm or overturn
