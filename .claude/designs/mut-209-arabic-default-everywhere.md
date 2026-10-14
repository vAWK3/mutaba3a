# MUT-209 — Default to Arabic everywhere: the web app and the hosted portal

Status: **BUILT and reconciled (2026-10-15)**; the qa-reconcile record is at the end of this file, branch `feature/mut-209-arabic-default` (own worktree `.claude/worktrees/mut-209-arabic-default`; not part of an epic).
Ticket: MUT-209 (Story). Basel, 2026-10-15: "everything should default to arabic". Builds on MUT-202 (ADR-077: the marketing site's Arabic default; only a language a person chose beats it). No blockers.

## 1. Acceptance criteria

| # | AC | Proved by |
|---|---|---|
| A1 | `/app` with no chosen language opens in Arabic in an English browser; a choice in Settings sticks | QA `@web.settings.arabic-default`; provider tests (MUT-202's) |
| A2 | The portal with no chosen language opens in Arabic; a choice sticks | `HostedLanguageProvider.test` (default `ar` in an `en-US` browser); QA `@portal.signin.arabic-default` |
| A3 | A language stored by detection does not count as a choice | MUT-202's `mutaba3a-language-chosen` mark (app); the portal already stores only explicit choices |
| A4 | Unit tests; QA on web and portal; English-assuming specs choose English | as below |

## 2. Where it goes

| File | Change |
|---|---|
| `src/lib/i18n/core.tsx` | `export const DEFAULT_LANGUAGE: Language = 'ar'` — one constant for every surface; bundle-safe (the portal already imports `core`) |
| `src/lib/i18n/context.tsx`, `index.ts` | re-export `DEFAULT_LANGUAGE` |
| `src/pages/landing/LandingProviders.tsx` | `LANDING_DEFAULT_LANGUAGE = DEFAULT_LANGUAGE` (kept as the landing's named export) |
| `src/main.tsx` | the app's `<LanguageProvider defaultLanguage={DEFAULT_LANGUAGE}>`; the app now behaves like the landing: nothing stored until a person chooses; a detected language stored before today does not count (ADR-077's rule) |
| `src/hosted/i18n/HostedLanguageProvider.tsx` | `storedChoice() ?? DEFAULT_LANGUAGE` instead of the browser language. After sign-in it still adopts the account's locale unless the browser has a choice (unchanged) |
| `server/src/schemas.ts` | `CreateUserRequestSchema.locale` defaults to `'ar'` (was `'en'`): a new account the operator creates without `--locale` is Arabic, so the portal stays Arabic after sign-in. Existing accounts keep their stored locale (no data change). OpenAPI regenerated, `API_VERSION` → `1.24.0-mut209` |
| `qa/support/app.ts` | `openFreshApp` chooses English once (init script that sets `mutaba3a-language=en` + the chosen mark only when no choice exists), so every English spec keeps its English labels and `switchToArabic` still wins across navigations |
| `qa/specs/web/settings.spec.ts` + `settings.yaml` | `@web.settings.arabic-default`: an `en-US` browser with nothing chosen opens `/app` in Arabic (`lang=ar`, `dir=rtl`, the Arabic welcome), skips in Arabic, picks English in Settings, reload stays English |
| `qa/specs/portal/signin.spec.ts` + the portal catalogue | `@portal.signin.arabic-default`: an `en-US` browser with nothing chosen gets the Arabic sign-in |
| Knowledge | CHANGELOG, DECISIONS (ADR-077 amended: every surface; ADR-037's portal language note), SYSTEM_OVERVIEW, TEST_PLAN, COMPONENT_REGISTRY (`LandingProviders`, `DEFAULT_LANGUAGE`), server `openapi` + version table |

## 3. Decisions

- **D1 — One `DEFAULT_LANGUAGE`** in `lib/i18n/core` for the landing, the app and the portal.
- **D2 — The app stops storing a detected language** (it now has a default), exactly as the landing did in MUT-202. People who use the app in English and never pressed a language control see Arabic once and pick English in Settings; that is the stated rule.
- **D3 — New accounts default to Arabic on the server; existing accounts are not migrated.** A production data change is Basel's call (flagged on the ticket). The operator can still pass `--locale en`.
- **D4 — The Flutter app** gets the same rule in its own repo (separate ticket, MUT-192's repo).

## 4. Tests (written first)

- `core.test.tsx`: `DEFAULT_LANGUAGE === 'ar'`.
- `HostedLanguageProvider.test.tsx`: with nothing stored and an `en-US` browser the portal is Arabic; the existing adopt/persist cases stay.
- `LandingProviders.test.tsx`: unchanged (now via the shared constant).
- Server: a user created without `locale` is `ar` (and its personal profile gets the Arabic name); `openapi:check` clean.
- QA as above; all existing web and portal specs still pass with `openFreshApp` choosing English.

Gate (Node 22): lint, typecheck, `test:run`, build, `test:bundles`, `release-qa lint`; server: `typecheck`, `lint`, `openapi:check`, `test`.

Business / product impact
- Every Mutaba3a surface greets a new person in Arabic, the primary market, while anyone who picks English keeps it.


---

# qa-reconcile record (2026-10-15, non-interactive)

Branch `feature/mut-209-arabic-default` vs `main` (3c5282a). Reviewer: Claude + an independent in-host reviewer on the diff (Opus). The plan's own review was compact (native only); the pre-landing review stood in for the outside voice on a change this size.

| Criterion | In plan? | In code? | Verdict |
|---|---|---|---|
| `/app` with nothing chosen opens Arabic in an English browser; a Settings choice sticks | yes | `main.tsx` `defaultLanguage={DEFAULT_LANGUAGE}` | MET (QA `@web.settings.arabic-default`; `@web.landing.arabic-default` now asserts `/app` Arabic; provider tests) |
| The portal with nothing chosen opens Arabic; a choice sticks | yes | `HostedLanguageProvider` fallback, account-locale hint | MET (provider tests; QA `@portal.signin.arabic-default` incl. EN → reload) |
| A detected stored language is not a choice | yes | ADR-077 mark (app); portal stores only choices | MET |
| Tests + QA; English specs choose English | yes | `openFreshApp`, `createWrapper` on the default path, `chooseLanguage()` in 11 test files, 3 portal test files | MET |

Scope creep: none. DRIFT, conscious: the server's new-account default (`ar`), so the portal stays Arabic after sign-in for new accounts.

Pre-landing review, 11 findings, no P1. Fixed: (1) **an English-locale account saw the portal in Arabic and flipped to English on every load**: the adopted account locale is now remembered as a hint (`mutaba3a-portal-account-locale`, never a choice; a choice still beats it), adopted in a layout effect, and adopted at sign-in before navigating (tested); (2) the unit-test wrapper now runs the production path (`defaultLanguage`, English for tests), and 11 test files seed a language with `chooseLanguage()` instead of a bare key; (4) the portal QA case stubs `/v1`, uses steps and proves EN sticks; (5)(6) doc comments; (7) the QA helper uses `LANGUAGE_KEYS`; (9) OpenAPI publishes "Defaults to ar", the CLI example says Arabic by default; (11) duplicate imports merged. Accepted and recorded: (3) existing English users of the web app (and desktop copies) see Arabic once, including anyone who chose English before the mark existed (D2, Basel's rule); (8) the constant test is thin (the wiring is proved by QA); (9b) a new account created without a locale also gets Arabic expense categories (follows the locale, intended); (10) the HTML shells still say `lang="en"` (out of scope by the ticket), and `RecurringOccurrenceCard` formats dates without a locale (pre-existing).

Gate (Node 22): lint 0 errors; typecheck; full `test:run` 314 files / 4416 tests; `test:bundles`; `release-qa lint` clean; server: typecheck, lint, `openapi:check`, `test` 1746 and `test:db` 112 files / 1913 tests; QA: the whole web + portal suites (76 passed; failures: `@web.landing.375` ×4 from main's header Sign in link, `@web.clients.owed-now-parity` MUT-178, and `@web.brand.layout` ×4 at 375 px, traced to the Settings "Hosted account" row (MUT-187) overflowing on phones, already on main and not caused here), then 18/18 affected cases after the review fixes.

**Verdict: PASS.** Jira → In Review.
