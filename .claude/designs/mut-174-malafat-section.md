# MUT-174 — Landing: "fully integrated with Malafat", for lawyers and accountants

Status: **PLANNED (2026-10-14)**, branch `feature/mut-171-landing` (epic worktree `.claude/worktrees/mut-171-landing`; MUT-173 merged to main c4ed50d from the same worktree).
Ticket: MUT-174 (Story) · parent epic MUT-171 (landing: hosted, mobile, Malafat). Siblings: MUT-172 (merged), MUT-173 (merged). Relates to MUT-25 (shared money core, In Progress: not to be claimed), MUT-61 / MUT-123 (Received capture on Malafat profiles, Done), MUT-100 / MUT-107 (contingency agreements and proposals, In Review; the ticket counts them as shipped), MUT-189 (the in-app Malafat upsell, next epic). No `is blocked by` link and none in the prose.
Tracker: Jira · barmajiyat.atlassian.net · MUT via atlassian-barmajiyat · Backlog = planning allowed when Basel asks (he asked for the whole epic) · finished → In Review after /qa-reconcile.

## 1. Problem and acceptance criteria

The landing never mentions Malafat, although Malafat's Money section runs on this hosted API in production and a firm's partner can log a payment in Mutaba3a that Malafat then allocates. `/hosted` says "Connected to Malafat, for lawyers and accountants" in one table cell and nothing more.

| # | AC (ticket) | Proved by |
|---|---|---|
| A1 | New section, framed for both lawyers and accountants per Basel's direction | `data-part="malafat"` after `phone`; `LandingPage.test.tsx` structure list grows to nine; the EN case reads "law firm" and "accounting office", the AR case "مكاتب المحاماة" and "مكاتب المحاسبة" |
| A2 | Copy describes only shipped Malafat capability, not the in-progress MUT-25 spike | the body names fee proposals and agreements (incl. contingency), retainers, what each client owes and paid, and a payment logged in Mutaba3a landing in Malafat for the firm to match (MUT-61/123); an honesty case bans `/report|analytic|dashboard|statistic/i`, `/\bprice\b|checkout|sign ?up|\$\d/i`, `/\bsync|automatic/i` (allocation is the firm's act, not automatic) and `/module|core|engine/i` (MUT-25's words) in EN, and `/تقارير|تحليل|سعر|اشترك|مزامنة|تلقائي/` in AR |
| A3 | i18n EN/AR; tests added | `landing.malafat.*` in both dictionaries (`landingCopy.test.ts` parity), the AR case, `malafatLinks.test.ts`, QA `@web.landing.malafat` EN + AR |
| G | Brand v2 tokens; one idea per section; RTL | the band reuses `.landing-privacy-band` (tokens only, logical properties); the one idea is "connected to Malafat" |

## 2. Where it goes

The nearest thing built the same way is the privacy band: a dark, centred band with one heading and one paragraph, which `/hosted` already reuses by class for its "your records come with you" band (`HostedOfferPage.tsx:133-140`). The Malafat section is a third band: heading, paragraph, one link.

| File | Change |
|---|---|
| `src/content/malafatLinks.ts` (new) | `MALAFAT_SITE_URL = 'https://malafat.app'` and `malafatUrl({ locale, medium, content, path? })` → `${MALAFAT_SITE_URL}/${locale}${path ? '/' + path : ''}?utm_source=mutaba3a&utm_medium=<medium>&utm_campaign=malafat-upsell&utm_content=<content>` (+ `topic` when given), built with `URLSearchParams`. The UTM vocabulary is MUT-189's (`utm_source=mutaba3a`, `utm_campaign=malafat-upsell`, `utm_medium` per surface, `utm_content` per placement); the landing is `medium: 'landing'`, `content: 'landing-section'`, no path. MUT-190/191 reuse it with `path: 'contact'` and `topic: 'mutaba3a'` (the epic's CTA) instead of writing a second builder. `malafat.app/en` and `/ar` answer 200 today (checked 2026-10-14). |
| `src/content/__tests__/malafatLinks.test.ts` (new) | locale in the path; every UTM parameter; `path` + `topic` appended for the in-app surfaces; nothing else leaks into the query. |
| `src/pages/landing/components/MalafatSection.tsx` (new) | `<section data-part="malafat" aria-labelledby="malafat-title" className="landing-section landing-privacy-band landing-malafat">` → `.landing-container`: `<h2 id="malafat-title" className="landing-privacy-title">` = `landing.malafat.title`; `<p className="landing-privacy-body">` = `landing.malafat.body`; `<p className="landing-privacy-body landing-malafat-link-line"><a className="landing-band-link" href={malafatUrl(...)} target="_blank" rel="noopener noreferrer">` = `landing.malafat.link`. The locale comes from the language context (`useLanguage()`), the same source `useT` reads. |
| `src/pages/landing/components/index.ts`, `LandingPage.tsx` | export; `<MalafatSection />` between `<PhoneSection />` and `<FAQSection />`; docblock list gains "Malafat". |
| `src/pages/landing/LandingPage.css` | `.landing-malafat .landing-privacy-title { max-width: 28ch }` (the title is longer than the privacy band's four words); `.landing-malafat-link-line { margin-block-start: var(--space-5); opacity: 1 }` (the link must not inherit the body's 0.8 dim: contrast); `.landing-band-link { color: var(--bg); text-decoration: underline; text-underline-offset: 0.15em }`, `:hover { color: var(--bg); text-decoration-thickness: 2px }` (a classed link, so the global `a:not([class]):hover` does not apply, TD-122), `:active { opacity: var(--landing-press-dim) }`, `:focus-visible { outline: none; box-shadow: var(--focus-ring) }`. Tokens only. |
| `src/lib/i18n/translations/en.json`, `ar.json` | `landing.malafat.title` = "Run a firm on Malafat? Mutaba3a is already inside it." / "مكتبك على Malafat؟ متابعة بداخله أصلًا."; `body` = "For law firms and accounting offices on Malafat: fee proposals and agreements, including contingency fees and retainers, and what every client owes and has paid, all in the firm's own Malafat workspace. A payment logged in Mutaba3a lands in Malafat, waiting for the matter it belongs to. Nothing to type twice." / "لمكاتب المحاماة ومكاتب المحاسبة على Malafat: عروض الأتعاب واتفاقياتها، بما فيها أتعاب النجاح والأتعاب الشهرية، وما على كل عميل وما دفعه، كله في مساحة المكتب على Malafat. دفعة تُسجَّل في متابعة تصل إلى Malafat بانتظار الملف الذي تخصّه. لا شيء يُكتب مرتين."; `link` = "See Malafat" / "اطّلع على Malafat". "Malafat" stays in Latin letters in Arabic, as `/hosted`'s table cell has it. |
| `src/pages/landing/__tests__/LandingPage.test.tsx` | structure: nine parts, `malafat` after `phone`; new `describe('LandingPage Malafat (MUT-174)')`, see §4. |
| `src/pages/landing/__tests__/landingCss.test.ts` | `.landing-band-link:active` joins the dim `it.each`. |
| `qa/features/web/landing.yaml` | feature `malafat` (§4b), `tier: secondary`. Area paths already cover `src/pages/landing/**`; `src/content/malafatLinks.ts` is added to the area's `paths`. |
| `qa/specs/web/landing.spec.ts` | `@web.landing.malafat`, EN then AR (§4). |
| Knowledge files | CHANGELOG; COMPONENT_REGISTRY (`MalafatSection`; `malafatLinks` under content config; the band classes' third user); TEST_PLAN; SYSTEM_OVERVIEW landing row (one clause). No new ADR: the UTM vocabulary is MUT-189's decision, recorded there; the builder only implements it. |

Nothing in `server/`, the app, the portal, `/hosted` or `vite.config.ts` changes. No new dependency.

## 3. Decisions

- **D1 — A band, not a chapter, and no `Band` component (smaller arrangement).** A chapter needs a picture; a Malafat picture would be a new mock of another product's screen, which the ticket does not ask for and which would drift from Malafat's real UI. The band is the landing's existing one-idea-no-picture shape, and `/hosted` already reuses its classes inline, so `MalafatSection` does the same. Extracting a `Band` component for three 8-line callers (privacy, hosted, Malafat) was considered and rejected under the shared-code rubric: the saving is ~10 lines and the hosted copy has its own ids; noted as a cheap cleanup if a fourth band appears.
- **D2 — Placement after the phone chapter, before the FAQ.** The three paid-tier sections (Get it's paid half, the phone chapter, Malafat) read in a row; the FAQ closes. Nine parts; the structure test pins it.
- **D3 — One link, to malafat.app's localized home, in a new tab, with MUT-189's UTM parameters.** The AC asks for no CTA; a section about another product with no door would be a dead end for the reader it targets. The link leaves the site, so a new tab (the same rule as the store links and the release notes). The destination is the localized home page, not `/contact`: a landing visitor is learning, not asking; MUT-190/191's in-app moments are the ones that send a known firm to `/contact?topic=mutaba3a`. The builder is shared so that both use one vocabulary (`utm_source=mutaba3a`, `utm_campaign=malafat-upsell`), which is what MAL-1153 will recognise. No Mutaba3a-side measurement (ADR-024).
- **D4 — Copy claims only what ships, and never "automatic".** MUT-61/123: a Received payment logged on a Malafat profile is stored unallocated for Malafat to allocate, so the copy says it "lands in Malafat, waiting for the matter it belongs to", not that it is matched automatically. Fee proposals/agreements, contingency, retainers, per-client owed/paid are the live Money section (M3–M8, MUT-100/107 per the ticket). No reports, no price, no "sync", and none of MUT-25's words (module, core, engine, shared). "Mutaba3a is already inside it" describes the shipped arrangement (Malafat's Money section is this API) without the spike's architecture claims; *flagged for Basel* as the one line that characterises the relationship.
- **D5 — "Law firms and accounting offices"**: Basel's framing (intake memory), not derived from code; kept verbatim in spirit, EN and AR.
- **D6 — The link's locale follows the page language**, from the same language context `useT` reads; `malafat.app/en` and `/ar` both exist.

## 4. Tests (written first)

| Test | Cases |
|---|---|
| `src/content/__tests__/malafatLinks.test.ts` | `malafatUrl({ locale: 'ar', medium: 'landing', content: 'landing-section' })` = `https://malafat.app/ar?utm_source=mutaba3a&utm_medium=landing&utm_campaign=malafat-upsell&utm_content=landing-section`; `en` → `/en`; with `path: 'contact', topic: 'mutaba3a'` → `/en/contact?topic=mutaba3a&utm_…`; the query holds exactly those keys |
| `LandingPage.test.tsx` › structure | nine parts: `… 'phone', 'malafat', 'faq'` |
| `LandingPage.test.tsx` › Malafat (MUT-174) | (1) EN: `part('malafat')` has the h2 `landing.malafat.title`, the body mentions "law firm" and "accounting office", and its only link is named "See Malafat" with `href` = `malafatUrl({ locale: 'en', … })`, `target="_blank"`, `rel` containing `noopener`; (2) AR: the h2 is the Arabic title, the link's href has `/ar`, the body mentions "المحاماة" and "المحاسبة"; (3) honesty: EN matches none of `/report|analytic|dashboard|statistic/i`, `/\bprice\b|checkout|sign ?up|\$\d/i`, `/\bsync|automatic/i`, `/module|core|engine/i`; AR none of `/تقارير|تحليل|سعر|اشترك|مزامنة|تلقائي/` |
| `landingCss.test.ts` | `.landing-band-link:active` dims with the token; no literal opacity (existing) |
| `landingCopy.test.ts` | unchanged; covers `landing.malafat.*` parity |
| `release-qa lint` | 0 errors; no new unmapped file |
| QA `@web.landing.malafat` | EN and AR: the band is visible after the phone chapter with the title from the dictionary; the link's href is `malafatUrl` for that locale with `target="_blank"`; the link keeps its colour on hover and is underlined; at 375 px no horizontal overflow and `dir` as expected; the band passes axe (light and dark) with only known violations; screenshot attached. The link is not followed (it leaves the site). |

Gate (Node 22): `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run build`, `release-qa lint`, Playwright `--project=web` landing spec on a built web preview (the MUT-173 throwaway config). No `server/` change.

## 4b. QA scenarios (release-qa, `qa/features/web/landing.yaml` → `@web.landing.malafat`)

| Flow | Steps, as the user would say them | Promised outcome |
|---|---|---|
| Learn that Mutaba3a is connected to Malafat | Open the landing page, scroll past the phone chapter to the dark Malafat band, read it, hover "See Malafat"; same in Arabic, also at 375 px | The band says it is for law firms and accounting offices on Malafat, names fee proposals and agreements (incl. contingency and retainers) and that a payment logged here lands in Malafat waiting for its matter; claims nothing automatic and no reports; the link points at malafat.app in the page's language with Mutaba3a's referral tags and opens in a new tab |

## 5. Reuse analysis

| Need | Reused | New |
|---|---|---|
| Band layout and tokens | `.landing-privacy-band`, `.landing-privacy-title`, `.landing-privacy-body` | `.landing-malafat` title width, `.landing-band-link` |
| UTM vocabulary | MUT-189's decision | `malafatLinks.ts` (shared with MUT-190/191) |
| Language | the i18n language context | — |
| Landing QA harness | `openLanding`, `attachScreenshot`, `expectNoHorizontalOverflow`, `expectOnlyKnownAxeViolations`, `readColours` | one test + one feature |

## 6. Scope check

Covers A1–A3 and the guardrail. Conscious inclusions: the link and its builder (D3; the AC asks for no CTA, so this is the one addition beyond the letter of the ticket, taken because MUT-190/191 need the same builder next). Not in scope: any change to `/hosted`'s band or table cell; the in-app moments (MUT-189); a Malafat mock or logo; MUT-25's spike.

## 7. Follow-ups to note on tickets

- MUT-174: D3 (a link with MUT-189's UTM vocabulary, to the localized home page) and the title's "Mutaba3a is already inside it" line are readings for Basel to confirm.
- MUT-190/191: reuse `malafatUrl` with `path: 'contact'`, `topic: 'mutaba3a'`.

Business / product impact
- Lawyers and accountants already on Malafat learn that Mutaba3a is the money side of a workspace they use; firms not yet on Malafat get a door to it, tagged so Malafat can count the referral once MAL-1153 lands.
- Closes epic MUT-171's third story; the link builder is the first piece of MUT-189.
- Risk: copy only, one outbound link; the honesty test keeps "automatic", reports and MUT-25's words out.

---

# Eng review (/plan-eng-review, 2026-10-14, non-interactive by Basel's instruction)

Target: this plan. Reviewer: Claude (native) + an in-host Plan subagent as the outside voice (Codex not installed). Gates auto-decided on the recommended option and listed under "Unresolved decisions". Search check: no new architectural pattern (a band, a URL builder), so no web research.

## Scope Challenge

**A. Assess.** Already solving each sub-problem: `.landing-privacy-band/-title/-body` (the band; `/hosted` reuses them inline, `HostedOfferPage.tsx:133-140`); `useLanguage()` (locale; `FAQSection.tsx:61`); `URLSearchParams` (the query); `landingCopy.test.ts` parity; the landing QA harness and `readColours`. Complexity: 13 files touched (5 source incl. 2 new modules, 2 dictionaries, 3 tests incl. 1 new, 1 feature file, 1 spec) + knowledge files. TODOS.md: nothing overlaps. Distribution: Netlify builds `main`; no CI change. Minimum change: the link and its builder are the one addition beyond the AC's letter (D3, conscious).

**B. Complexity gate** (13 files ≥ 8, 2 new modules): structure question, **D1 auto-decided → Smaller arrangement** (no `Band` component; `MalafatSection` reuses the band classes inline as `/hosted` does; `malafatLinks.ts` stays a module because MUT-190/191 import it next). Scope record: feature answers: none proposed; structure: B (Smaller); accepted scope: §2; pending remedies: none.

**C. Findings**

| # | Sev | Conf | Where | Finding | Disposition |
|---|---|---|---|---|---|
| S1 | P2 | 8/10 | §2 CSS row | `.landing-privacy-body` is `opacity: 0.8`; a link inside it would inherit the dim and lose contrast on the ink band. | **accepted** (already in §2): the link line is `opacity: 1`; QA asserts the link's colour equals `--bg` |
| S2 | P2 | 8/10 | §4 honesty regex | `/module|core|engine/i` has no word boundaries and would match "score" or "encore" in a future rewrite. | **accepted**: `/\b(module|core|engine)\b/i` |
| S3 | P3 | 6/10 | D2 | Two ink bands on one page (privacy at part 5, Malafat at part 8), three parts apart. | **accepted as a note for Basel**: the band is the landing's no-picture shape; a chapter would need a Malafat mock (D1) |
| S4 | P3 | 7/10 | §2 `malafatLinks.ts` | `URLSearchParams` encodes `-` and `_` unchanged but would encode a space; the vocabulary has none. `topic` must come first in the query for MUT-190's `?topic=` prefill readability (MAL-1123 reads it by name, so order is cosmetic). | **accepted**: `topic` first, then the four UTM keys, in a fixed order the test pins |

Result: **scope accepted as-is** (B is an arrangement, not a scope cut). MODE = FULL_REVIEW.

## Decision ledger

### R1: the band's link on the ink background (S1)
Runtime evidence: `LandingPage.css:705-711` (`.landing-privacy-body { opacity: 0.8 }`), `:681-685` (band `background: var(--text); color: var(--bg)`); `index.css:83` (`a:not([class]):hover` only).
Factual; no question. State: approved. Accepted scope: `.landing-malafat-link-line { opacity: 1 }`, `.landing-band-link { color: var(--bg) }` with its own hover.

## 1. Architecture review
- Boundaries: one component, one content module, two dictionaries; no router, app, portal, server. The link is a plain outbound `<a>`; no fetch, no telemetry (ADR-024).
- Data flow: `useLanguage().language` → `malafatUrl` → `href`. Diagram: `language ──► malafatUrl({locale, medium:'landing', content:'landing-section'}) ──► https://malafat.app/<locale>?utm_…`.
- One production failure: malafat.app drops its `/<locale>` paths → the link 404s on Malafat's side. Today both answer 200; the builder has one constant to change. Not silent (Malafat's 404 page). Second: a `landing.malafat.*` key missing in one language → parity test fails before merge.
- Distribution: none new.
Dispositions: A1 accepted (R1).

## 2. Code quality review
- Organisation: `malafatLinks.ts` beside `download-config.ts` under `src/content/` (public links config, the repo's home for them); `MalafatSection.tsx` beside `PrivacyBand.tsx`.
- Shared code: the band markup is now in three places (privacy, hosted, Malafat), 8 lines each. Extraction rejected under the rubric (D1): three callers, ~10 lines saved, the hosted copy carries its own ids and `data-part`; revisit at a fourth.
- **[P2] (8/10)** regex boundaries (S2) → accepted. **[P3] (7/10)** query order (S4) → accepted.
- Error handling: none needed.
Dispositions: Q1 (S2), Q2 (S4) accepted.

## 3. Test review
Framework: Vitest + Playwright QA.

```
CODE PATHS                                                   USER FLOWS
[+] malafatLinks.ts                                          [+] Learn Mutaba3a is connected to Malafat
  ├── [GAP→new] locale path en/ar — malafatLinks.test          ├── [GAP→new] EN: band after phone, words, one link — LandingPage.test
  ├── [GAP→new] four UTM keys, fixed order — malafatLinks.test ├── [GAP→new] AR: title, /ar link, words — LandingPage.test
  └── [GAP→new] path + topic for in-app surfaces — same         ├── [GAP→new][→E2E] link colour = --bg, underlined, _blank — @web.landing.malafat
[+] MalafatSection.tsx                                         ├── [GAP→new][→E2E] 375 AR no overflow; axe light/dark — same case
  ├── [GAP→new] h2/body/link attrs — LandingPage.test           └── [★★★ TESTED] no Buy/$49/Universal — existing honesty cases
  └── [GAP→new] honesty EN/AR incl. automatic/sync/MUT-25 words [+] Catalogue
[+] LandingPage.css .landing-band-link, .landing-malafat         └── [GAP→new] release-qa lint 0 errors; `malafat` feature
  ├── [★★★ TESTED] no literal opacity/scale — landingCss.test
  └── [GAP→new] :active dims by token — landingCss.test it.each
[+] en/ar landing.malafat.*  └── [★★★ TESTED] parity — landingCopy.test
[+] structure  └── [★★★ TESTED→updated] nine parts — LandingPage.test
COVERAGE (before build): 4/14 (29%) | after the planned tests: 14/14
QUALITY: ★★★:4 | GAPS: 10 (2 E2E)
```
Value cards: URL builder (protects=MUT-189's vocabulary in one place; fails_when=a key or the locale path drifts; why_new=new module; seam=none). Honesty (protects=no automatic/sync/reports/price/MUT-25 claim; fails_when=copy drifts; why_new=new section; seam=none). QA malafat (protects=the real band's link is readable on ink and leaves in a new tab; fails_when=opacity inherited, class dropped; why_new=jsdom has no stylesheets; seam=none). Tests made obsolete: none. Test gaps identified: 10, all planned. Test plan artifact: §4/§4b of this brief (non-interactive run).

## 4. Performance review
No issues found. Static copy, one `<a>`.
