# MUT-202 — Landing: open in Arabic by default, whatever the system language

Status: **BUILT and reconciled (2026-10-14)**; the qa-reconcile record is at the end of this file, branch `feature/mut-171-landing` (epic worktree; MUT-173 and MUT-174 merged to main from it).
Ticket: MUT-202 (Story) · parent epic MUT-171. Filed from Basel's message mid-epic: "the landing page should default to arabic regardless of system language". No blockers.
Tracker: Jira · barmajiyat.atlassian.net · MUT via atlassian-barmajiyat · finished → In Review after /qa-reconcile.

## 1. Problem and acceptance criteria

`LanguageProvider` (`src/lib/i18n/context.tsx:20-29`) picks the stored choice, else `detectSystemLanguage()` (`core.tsx:68-71`), and writes whatever it picked to `mutaba3a-language` on mount (`:48-50`). The marketing pages mount it through `LandingProviders` (`main.tsx:92-133`), so a visitor with an English system sees English.

| # | AC (ticket) | Proved by |
|---|---|---|
| A1 | With no stored choice and any system language, `/`, `/hosted`, `/privacy`, `/download` render in Arabic, `dir="rtl"` | `LandingProviders.test.tsx` (en-US navigator → `ar`, `rtl`); QA `@web.landing.arabic-default` visits all four in an `en-US` browser |
| A2 | A stored choice still wins; pressing the switch stores it | provider tests (stored `en` wins; `setLanguage` persists); QA: press the switch → English, stored `en`, survives reload |
| A3 | A landing visit without a choice leaves the key unset, so `/app` keeps its system default | provider test (no write on mount when defaulted); QA: after the four pages the key is `null`, and `/app` opens with `lang="en"` in the `en-US` browser |
| A4 | Unit tests; QA case; English-asserting QA cases set English explicitly | below |

## 2. Where it goes

| File | Change |
|---|---|
| `src/lib/i18n/context.tsx` | `LanguageProvider` gains `defaultLanguage?: Language`. Initial language: stored → `defaultLanguage` → `detectSystemLanguage()`. A `chosen` flag starts true when a stored value exists and becomes true on `setLanguage`; the persist effect writes only when `chosen` or when no `defaultLanguage` was given, so the app (no prop) behaves exactly as today, including persisting the detected language on mount. |
| `src/pages/landing/LandingProviders.tsx` | `export const LANDING_DEFAULT_LANGUAGE: Language = 'ar'`; `<LanguageProvider defaultLanguage={LANDING_DEFAULT_LANGUAGE}>`; docblock says why the default is not stored. |
| `src/lib/i18n/__tests__/core.test.tsx` | a new describe for `defaultLanguage`: beats an `en-US` system; a stored `en` beats it; nothing is written on mount; `setLanguage` writes. The two existing "as before" cases stay as they are (the regression guard for the app). |
| `src/pages/landing/__tests__/LandingProviders.test.tsx` (new) | renders a probe under `LandingProviders` with an `en-US` navigator and nothing stored → `ar`, `rtl`, key unset. |
| `qa/specs/web/landing.spec.ts` | a `preferLanguage(page, 'en')` init-script helper (what `openLanding` already does) used by `@web.landing.download`, `.hosted` and `.hosted-slash`, which assert English text; new `@web.landing.arabic-default` with `test.use({ locale: 'en-US' })`. |
| `qa/features/web/landing.yaml` | feature `arabic-default`, `tier: secondary`. |
| Knowledge files | CHANGELOG, COMPONENT_REGISTRY (`LandingProviders`), PATTERNS (a provider default that is not a preference), TEST_PLAN, SYSTEM_OVERVIEW landing row; DECISIONS: **ADR-077** "the marketing site defaults to Arabic; the default is not a stored preference". |

## 3. Decisions

- **D1 — The default is not stored.** The landing and the app share one storage key. Storing the default would switch every visitor's web app to Arabic after one landing visit, which the ticket does not ask for. Only an explicit choice is stored; once stored, both the landing and the app follow it, as today.
- **D2 — All four marketing pages, not only `/`.** They are one site with one header and one language switch; `/hosted` opening in English after an Arabic `/` would read as a bug.
- **D3 — A prop, not a landing-only provider.** The persistence rule is a property of the provider; a prop keeps one provider and leaves the app's call site untouched.
- **D4 — The HTML shell keeps `lang="en"`** (`index.html:2`). The SPA renders nothing before React sets `lang`/`dir`, so there is no visible flash; the shell's link-preview copy is out of scope (ticket).
- **Open question for Basel:** should the web app at `/app` also default to Arabic? Not done here (ticket scope).

## 4. Tests (written first)

Above in §2; QA `@web.landing.arabic-default`: in an `en-US` browser with nothing stored, `/`, `/hosted`, `/privacy`, `/download` each have `html[lang=ar][dir=rtl]` and the key stays `null`; `/app` then opens with `lang="en"`; back on `/`, the switch → English, key `en`, reload stays English.

Gate (Node 22): lint, typecheck, `test:run`, build, `test:bundles`, `release-qa lint`, the landing QA spec on a built preview.

## 4b. QA scenarios

| Flow | Steps | Promised outcome |
|---|---|---|
| A visitor with an English browser lands on the site | Open `/`, `/hosted`, `/privacy`, `/download` with an English system language; open the web app; come back and press EN | Every marketing page is in Arabic, right to left; the web app still opens in English; pressing EN switches to English and it stays English after a reload |

## 5. Eng review (native, compact; the pre-landing review of the diff stands in for the outside voice on a change this size)

Scope: 3 source files, 2 test files + QA + catalogue; no new module beyond a test. Complexity gate not tripped (< 8 files incl. knowledge? 7 code/test files; knowledge files excluded by the rubric). Findings:
- S1 (P2, 9/10): the persist effect runs on mount; a naive `defaultLanguage` would write `ar` to the shared key and flip the app (D1). Accepted: the `chosen` flag.
- S2 (P2, 8/10): three QA cases assert English after opening a marketing page with no stored language; they would turn red. Accepted: `preferLanguage(page, 'en')`.
- S3 (P3, 7/10): `@web.brand.contrast-landing` and `@web.brand.link-hover` will now run the landing in Arabic. Their assertions are language-agnostic (axe, class selectors), so they stay green and now cover the Arabic page, which is what most visitors will see. No change.
- Performance: none. Failure mode: a browser where storage throws (private mode) — `localStorage.getItem` already runs unguarded in `getInitialLanguage` today; unchanged behaviour, not widened.

Business / product impact
- Every first visit to the marketing site is in Arabic, the product's primary market, without touching what returning visitors chose or what the web app shows.


---

# qa-reconcile record (2026-10-14, non-interactive)

Branch `feature/mut-171-landing` vs `main` (7b67a64, which carries MUT-173/174). Reviewer: Claude + an independent in-host reviewer on the diff (Opus).

| Criterion (ticket) | In plan? | In code? | Verdict |
|---|---|---|---|
| No stored choice + any system language → Arabic, rtl, on `/`, `/hosted`, `/privacy`, `/download` | yes | `LandingProviders` `defaultLanguage="ar"`; `LanguageProvider` | MET (core + `LandingProviders.test` + QA `@web.landing.arabic-default` in an en-US browser, all four pages) |
| A stored choice still wins; the switch stores it | yes | `setLanguage` stores the language and the chosen mark | MET (DRIFT, conscious: only a *marked* choice wins; a language the app or the pre-MUT-202 landing stored by detection doesn't, because Basel's "regardless of system language" would otherwise fail for every earlier visitor) |
| A landing visit leaves the key unset; `/app` keeps its system default | yes | nothing stored while defaulted | MET (unit + QA: key `null` after the four pages; `/app` opens `en` and stores it as before) |
| Unit tests; QA case; English-asserting QA cases set English | yes | as listed; `@web.brand.type` (English) now chooses English before the landing step | MET |

Pre-landing review findings and what changed:
1. **P2, fixed** — a stored `en` written by detection (the app always; the landing before this change) would have kept those visitors in English. A separate `mutaba3a-language-chosen` mark, written only by `setLanguage`, now distinguishes a choice; the landing ignores an unmarked value; the app reads the plain key as before. Unit tests for both, and the QA case now proves the landing stays Arabic after `/app` stored `en`. Consequence recorded in ADR-077: someone who explicitly chose English before MUT-202 sees Arabic once, until they press EN.
2. **P3, fixed** — the `LandingProviders` docblock had slid onto the constant; reordered.
3. **P3, fixed** — the QA case now polls that `/app` stores its detected language (the app's behaviour, unchanged).
4. **P3, fixed** — unit cases for an invalid stored value and `afterEach(vi.restoreAllMocks)` in the new describe.
5. **P3, fixed** — storage reads/writes are guarded (`readStorage`/`writeStorage`); storage is read once per mount; a test proves the provider renders and switches when storage throws.
6. **Product notes, not changed (for Basel):** `index.html` keeps `lang="en"` (D4); the `LandingLoader` "Loading..." text in `main.tsx` is English; the hosted portal has its own language key and still follows the system language; whether `/app` should default to Arabic is open.

Gate (Node 22): lint 0 errors (6 pre-existing warnings); typecheck clean; i18n/landing/download/content suites 29 files / 341 tests; `test:bundles` passes; `release-qa lint` no errors; Playwright (built web preview): the whole landing spec + `@web.brand.type` + `@web.brand.contrast-landing` + `@web.brand.link-hover` = 32 passed. Full `test:run`: the first run had 8 failures in unrelated suites (IncomeDrawer, Home, portal drawers) while the reviewer ran vitest in the same worktree; those 7 files pass in isolation (151 tests); the clean full run is in the merge commit.

**Verdict: PASS.** Jira → In Review.
