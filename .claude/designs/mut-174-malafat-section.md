# MUT-174 — Landing: "fully integrated with Malafat", for lawyers and accountants

Status: **BUILT and reconciled (2026-10-14)**; the qa-reconcile record is at the end of this file, branch `feature/mut-171-landing` (epic worktree `.claude/worktrees/mut-171-landing`; MUT-173 merged to main c4ed50d from the same worktree).
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

## Outside voice (native fallback, Claude Plan subagent on Opus; Codex not installed)

Provider: codex not installed → native in-host fallback (first attempt stopped on a model rate limit before reading anything; re-run on Opus). Outside coverage: **unavailable** (no external provider). Ten findings, all accepted; three verified independently before acceptance (O3 allowlist, O4 contract text on MUT-189, O10 production version).

| # | Sev | Finding | Disposition |
|---|---|---|---|
| O1 | High | "Mutaba3a is already inside it" restates MUT-25's idea ("a money module in Malafat") without its words, over-claims (a firm on Malafat does not get Mutaba3a without operator setup), and the AR pronoun binds to مكتبك ("inside your office"); أصلًا is colloquial. | **accepted (R2)**: title uses `/hosted`'s fact, "connects"; honesty bans "inside / built into / part of Malafat" |
| O2 | High | The body says a payment logged in Mutaba3a lands in Malafat with no qualifier, three bands after "No account… nothing is sent anywhere". Only the phone app with a hosted account on a Malafat-linked profile does it (the portal offers no capture there; the free app never connects). | **accepted (R3)**: "With a hosted account, a payment you log in the Mutaba3a phone app…"; a test asserts the band names the hosted account |
| O3 | High | `https://malafat.app` is a new origin in `dist-web`; `scripts/bundle-origins.json` does not list it, so `npm run test:bundles` fails; the gate omitted `test:bundles`. | **accepted (verified)**: add it to `local`; `test:bundles` joins the gate; note for MUT-191 (`hosted` list) |
| O4 | Med-High | MUT-189's contract is `/<locale>/contact?topic=mutaba3a&…` with `utm_medium ∈ web-local|desktop|portal|ios|android` and `utm_content ∈ settings|business-profile|client-threshold|second-business`; the plan invented `landing`/`landing-section` and untyped strings. | **accepted (R4, verified)**: typed unions = the contract + an explicit `'landing'`/`'landing-section'` extension, recorded as an amendment comment on MUT-189 (MAL-1153's recognition must learn it); `topic` first |
| O5 | Medium | "Waiting for the matter it belongs to" misdescribes MUT-61 (the client is required; the matter is a hint; what waits is allocation); AR ملف means *profile* in this product and is the name Malafat; "Nothing to type twice" reads like sync. | **accepted (R3)** |
| O6 | Medium | Honesty regexes drop MUT-173's `chart`/`إحصاء|رسوم` and miss auto-/seamless/instant/real-time, AR verb forms of زامن, and آلي. | **accepted**: shared `BANNED_CLAIMS_EN/AR` constants in the test file, reused by the phone block |
| O7 | Medium | `--focus-ring` is an inset ring in `--m-focus`; on the ink band it is ~3:1 (light) and ~2:1 (dark), failing 1.4.11; the planned rule only restated the global one. | **accepted**: `.landing-band-link:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; box-shadow: none }`; QA tabs to the link and checks the outline colour equals the link colour |
| O8 | Low-Med | Undoing `.landing-privacy-body`'s 0.8 opacity on the link line works only by source order; `readColours` reads the link's own transparent background. | **accepted**: the link line has its own class (`.landing-malafat-link-line`: margin + font-size tokens, incl. the ≤640 `--text-body` step), never `landing-privacy-body`; QA compares the link colour with the section's background |
| O9 | Low | ~370-character body packs seven claims into a band designed for two lines; "contingency"/"matter" are legal-only for an accountants framing. | **accepted (R3)**: two sentences |
| O10 | Low | Production record in INFRA/DEPLOYMENT is stale (ced04f7). | **verified, no change to the plan**: production `/health` reports `eb4a9c8` (current main, 2026-10-14), which carries MUT-61/100/107; INFRA's record gets a one-line correction in the knowledge step |

Also confirmed by the outside voice: no test or QA case locates `.landing-privacy-band`; axe has no issue with two labelled bands; use `useLanguage().language`, **not** `getLocale` (returns `en-US`); nothing else builds UTM links.

Cross-model tension: none. The native pass found S1–S4; the outside voice found the copy, allowlist and contract problems the native pass missed.

## Amended plan (supersedes the §2 rows named below; §3 decisions D3/D4 read with these)

- **Dictionary row (R2/R3):**
  - `landing.malafat.title` = "Run a law firm or accounting office on Malafat? Mutaba3a connects to it." / "مكتبك يعمل على Malafat؟ متابعة متّصلة به."
  - `body` = "Malafat keeps each firm's fee proposals and agreements, and what every client owes and has paid. With a hosted account, a payment you log in the Mutaba3a phone app reaches Malafat under its client, unallocated, for the firm to apply to what's owed." / "يحفظ Malafat عروض أتعاب كل مكتب واتفاقياته، وما على كل عميل وما دفعه. ومع حساب مستضاف، تصل الدفعة التي تسجّلها في تطبيق متابعة على الهاتف إلى Malafat باسم العميل، غير مخصَّصة، ليخصّصها المكتب لما هو مستحق."
  - `link` = "See Malafat" / "اطّلع على Malafat" (unchanged).
- **`malafatLinks.ts` row (R4):** `type MalafatMedium = 'web-local' | 'desktop' | 'portal' | 'ios' | 'android' | 'landing'`; `type MalafatContent = 'settings' | 'business-profile' | 'client-threshold' | 'second-business' | 'landing-section'`; `malafatUrl({ locale, medium, content, contact? })`: `contact: true` → `/<locale>/contact?topic=mutaba3a&utm_source=…` (the MUT-189 contract, for MUT-190/191); without it → `/<locale>?utm_source=…` (the landing). Query order fixed: `topic` (when present), `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`.
- **`scripts/bundle-origins.json`:** `"https://malafat.app"` added to `local`.
- **CSS row (O7/O8):** link line `<p className="landing-malafat-link-line">` (no `landing-privacy-body`): `margin: var(--space-5) 0 0; font-size: var(--text-headline)`, and `--text-body` at ≤640 px; `.landing-band-link` as planned plus `:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; box-shadow: none }`.
- **Tests (O2/O6):** `BANNED_CLAIMS_EN = /report|analytic|dashboard|statistic|chart|\bprice\b|checkout|sign ?up|\$\d|\b(sync\w*|automatic\w*|auto-\w+|seamless\w*|instant\w*|real[- ]time)\b|\b(module|core|engine)\b|inside|built into|part of malafat/i`, `BANNED_CLAIMS_AR = /تقارير|تحليل|إحصاء|رسوم|سعر|اشترك|زامن|تلقائ|آلي|بداخل/`; the Malafat block asserts the body names "hosted account" / "حساب مستضاف" and "phone app" / "تطبيق متابعة على الهاتف"; the phone block's honesty case reuses the constants. Structure test renamed to nine parts.
- **QA (O7/O8):** the link's colour equals the section's computed `background-color`'s contrast partner (`--bg`) and is ≥4.5:1 against the section background (`contrast()` from `brandCss`); Tab to the link and assert `outline-style: solid` and `outline-color` = the link's colour, in light and dark.
- **Gate:** adds `npm run test:bundles`.

## Final planning decisions

TODOS.md updates: none. Approval readiness: PASS — R1 (factual), R2–R3 (factual copy corrections against shipped behaviour), R4 (D2 auto: typed contract + explicit landing extension recorded on MUT-189), O3/O6/O7/O8 factual. Actual answers: D1 structure B (auto), D2 contract extension A (auto).

### R4: the link's vocabulary (O4)
Question D2: Should the landing link use MUT-189's contract as-is, or extend it with a landing value?
Options: A) Extend with `'landing'`/`'landing-section'`, typed, recorded on MUT-189 (recommended) ✅ Malafat can tell landing referrals from in-app ones ✅ the in-app contract is unchanged ❌ MAL-1153 must learn two more values. B) No UTM on the landing link ✅ nothing to amend ❌ landing referrals invisible to Malafat. Completeness: A=10/10, B=6/10. Actual answer: A (auto, non-interactive run). State: approved.

## NOT in scope
- A Malafat mock or logo; the in-app moments (MUT-189); MUT-25's spike; any change to `/hosted`.
- MUT-189's pitch text says payments flow "automatically"; MUT-190's plan must reconcile that with the shipped unallocated capture (flagged, not changed here).

## Failure modes
| Path | Failure | Handling | User sees |
|---|---|---|---|
| malafat.app drops `/<locale>` | Malafat 404 | one constant; not silent | Malafat's 404 |
| new origin not allowlisted | `test:bundles` fails | allowlist entry + gate | n/a |
| copy drifts into a claim | honesty test fails | shared banned-claims constants | n/a |
No critical gaps.

Worktree parallelization: Sequential implementation, no parallelization opportunity.

## Implementation Tasks
- [ ] **T1 (P1, human: ~1h / CC: ~5min)** — copy — title and two-sentence body per R2/R3, EN/AR. Verify: LandingPage.test Malafat block.
- [ ] **T2 (P1, human: ~1h / CC: ~5min)** — `malafatLinks.ts` typed per R4 + unit test; MUT-189 amendment comment. Verify: malafatLinks.test.
- [ ] **T3 (P1, human: ~10min / CC: ~1min)** — `bundle-origins.json` local += malafat.app. Verify: `npm run test:bundles`.
- [ ] **T4 (P2, human: ~45min / CC: ~5min)** — CSS link line + focus outline (O7/O8). Verify: landingCss.test, QA focus step light/dark.
- [ ] **T5 (P2, human: ~30min / CC: ~3min)** — shared banned-claims constants (O6), hosted-account assertion (O2). Verify: LandingPage.test.
- [ ] **T6 (P3, human: ~10min / CC: ~1min)** — INFRA production record → eb4a9c8 (O10).

## Unresolved decisions that may bite you later
- D1 — structure: no `Band` component; the band classes are reused inline (auto).
- D2 — the landing link extends MUT-189's UTM vocabulary with `landing`/`landing-section` (auto); MAL-1153 must recognise them.

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is (4 findings, all accepted)
- Architecture Review: 1 issue found (R1)
- Code Quality Review: 2 issues found (S2, S4)
- Test Review: diagram produced, 10 gaps identified (all planned)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written (§5)
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 2 in this review (auto-decided, listed for Basel)
- Outside voice: provider codex not installed; native fallback (Claude Plan subagent, Opus) completed, 10 findings, all accepted; outside coverage unavailable
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 1/1

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | not run | — |
| Outside Review | native fallback (Claude Plan subagent, Opus); codex not installed | Independent 2nd opinion | 1 | unavailable (native fallback completed) | 10 findings, 10 accepted |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN (all mapped to tasks T1–T6) | 3 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | not run | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | not run | — |

- **OUTSIDE COVERAGE:** provider codex, phase plan-review, not installed → native fallback completed with 10 findings (no external coverage credit).
- **VERDICT:** ENG REVIEWED — issues mapped to tasks; ready to implement with the amended plan. eng review required (status issues_open, mapped work).

**UNRESOLVED DECISIONS:**
- D1 structure: band classes reused inline, no Band component (auto)
- D2 landing link extends MUT-189's UTM vocabulary (auto)


---

# qa-reconcile record (2026-10-14, non-interactive)

Branch `feature/mut-171-landing` vs `main` (c4ed50d, which carries MUT-173). Reviewer: Claude + an independent in-host reviewer on the diff (Opus; ran the landing/content suites and typecheck).

| Criterion (ticket) | In plan? | In code? | Verdict |
|---|---|---|---|
| New section framed for both lawyers and accountants | yes (D5) | `MalafatSection.tsx`; EN title "a law firm or accounting office", AR title "مكتب المحاماة أو المحاسبة" | MET (after fix 1; the first build's Arabic named neither) |
| Copy describes only shipped Malafat capability, not MUT-25 | yes (D4, amended R2/R3) | copy; `BANNED_CLAIMS_*` + `MONEY_CORE_*` (EN, AR with diacritics stripped); capture claim names a hosted account linked to the firm's Malafat and the phone app; production verified at eb4a9c8 | MET (DRIFT, flagged: the ticket's scope line says money moves in "automatically"; the shipped capture stores the payment unallocated for the firm, so the copy says that instead) |
| i18n EN/AR; tests added | yes | `landing.malafat.*` (parity), unit (EN/AR, honesty, self-test, builder), CSS, QA `@web.landing.malafat` EN/AR | MET |
| Guardrails: Brand v2, one idea, RTL | yes | band classes reused, tokens only, `landingCss.test` (dim, focus ring), QA 375 EN/AR with `dir` | MET |

Scope creep: none beyond the plan's conscious inclusions (the link and its builder, D3; the allowlist entry, O3).

Pre-landing review findings and what changed:
1. **P1, fixed** — the Arabic band named neither lawyers nor accountants (title "مكتبك", body "كل مكتب"), so A1 failed in Arabic and no test caught it. Title now "هل يعمل مكتب المحاماة أو المحاسبة لديك على Malafat؟ متابعة يتّصل به."; the AR test asserts المحاماة and المحاسبة in the heading.
2. **P2, fixed** — the capture claim dropped the Malafat-linked condition (self-service and personal hosted profiles never reach Malafat). EN "With a hosted account linked to your firm's Malafat, …", AR "ومع حساب مستضاف مربوط بـ Malafat مكتبك، …"; both tested.
3. **P2, fixed** — the QA feature and spec were uncommitted; committed with this record after passing.
4. **P2, fixed** — the dark-mode QA step read the link colour mid-transition (global `a { transition: color }`); it now emulates reduced motion for those reads.
5. **P2, fixed** — the honesty regexes missed automated/automation/realtime/pricing/per month/sign-up/currency amounts and, in Arabic, singular/plural forms and any word carrying a diacritic; the AR list also false-positived on رسوم (fees) and آليّة. Rebuilt with `bare()`, a self-test of the slipped spellings and the allowed ones.
6. **P3, fixed** — the MUT-25 words now apply to the Malafat block only (`MONEY_CORE_*`), so future phone copy can say "inside the portal".
7. **P3, fixed** — AR gender/register: "متابعة يتّصل به" (masculine, as the privacy policy treats the product) and a proper هل question (folded into 1).
8. **P3, fixed** — the link announces the new tab (`common.opensInNewTab`, visually hidden); the landing's other new-tab links (release notes, store links) still don't, a project-wide follow-up.
9. **P3, fixed** — the QA copy check now asserts Arabic terms in Arabic.
10. **P3, fixed** — the AR test asserts "غير مخصَّصة".

Gate (Node 22), on the tree before the review fixes: lint 0 errors (6 pre-existing warnings), typecheck, `test:run` 306 files (one test failed once under parallel Playwright load, then 306/306 = 4355 passed on a clean rerun), build, `test:bundles` (passes with malafat.app allowlisted), `release-qa lint` no errors, Playwright landing spec 21/21. After the review fixes: landing/content suites 15 files / 268 tests, Playwright `@web.landing.malafat` + `@web.landing.phone` EN/AR 4/4, lint and typecheck (see the commit). Browser pane: the Arabic band at 1280 checked by eye (title wraps cleanly, ؟ after Malafat in reading order, link underlined on ink).

**Verdict: PASS.** Readings for Basel are on the ticket: the link (not in the AC) with the landing UTM extension, the band reuse, and the "automatically" drift. Jira → In Review.
