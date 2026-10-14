# MUT-209 — Default to Arabic everywhere: the web app and the hosted portal

Status: **PLANNED (2026-10-15)**, branch `feature/mut-209-arabic-default` (own worktree `.claude/worktrees/mut-209-arabic-default`; not part of an epic).
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
