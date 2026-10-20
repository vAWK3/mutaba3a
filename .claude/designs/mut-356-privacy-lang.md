# MUT-356 — Landing: /privacy honours ?lang, like /terms

> Ticket: MUT-356 (relates to MUT-344, MUT-324). Found during MUT-344's reconcile.
> mini-crm worktree `confident-sutherland-0f5b75`; Flutter worktree under
> `mutaba3a-flutter/mutaba3a/.claude/worktrees/`.

## Problem

The phone's Settings › Privacy policy row opens `<site>/privacy`. The landing ignores
`?lang` there, so the page opens in the landing's stored language, Arabic by default
(ADR-077). An English phone user reads the Arabic policy. `/terms` already honours
`?lang` (MUT-324 review fix 1, ADR-102): it picks the text's language, is never stored,
and an unknown value is ignored.

## Acceptance criteria (from the ticket)

1. `/privacy?lang=en` shows English and `/privacy?lang=ar` Arabic, whatever the stored
   language; the stored choice is unchanged afterwards.
2. An unknown `?lang` falls back to the landing's normal language rule.
3. Phone: Settings › Privacy policy opens `/privacy?lang=en` in English, `?lang=ar` in Arabic.
4. Release-QA: the `@web.legal.*` privacy spec and `ios.settings.terms-link` pass.

## Plan

### Landing (mini-crm)

| File | Change |
|---|---|
| `src/content/legal/language.ts` (new) | `LegalLanguage = 'en' \| 'ar'` and `legalLanguageOf(search)`: lifted from `termsLanguageOf` (same body), shared by both legal pages. |
| `src/content/legal/terms.ts` | Drops `termsLanguageOf`; `TermsLanguage` becomes an alias of `LegalLanguage`. |
| `src/pages/landing/TermsPage.tsx` | Imports `legalLanguageOf` instead. No behaviour change. |
| `src/lib/i18n/context.tsx` | `useTIn(language)`: a translator over the app dictionaries for `language`, or the page's `t` when null. Memoised. Both dictionaries are already in the landing bundle, so this costs no bytes. |
| `src/pages/landing/PrivacyPolicyPage.tsx` | Takes `search`; the policy text (title, updated, intro, sections) comes from `useTIn(legalLanguageOf(search))`, and `LegalPage` gets `textLanguage` so the text carries its own `lang`/`dir`. The chrome (header, footer, back link) stays in the page language, exactly like `/terms?lang`. |
| `src/main.tsx` | Passes `window.location.search` to `PrivacyPolicyPage`, as it does for `TermsPage`. |

Nothing is written to storage: `useTIn` only reads dictionaries.

### Portal

No portal surface links to `/privacy` today (`grep -ri privacy src/hosted` finds none;
the portal only links the terms through `termsHref`). Nothing to change, and adding a
privacy link is out of scope. Recorded so the reconcile doesn't look for one.

### Phone (mutaba3a-flutter)

| File | Change |
|---|---|
| `lib/domain/services/legal_links.dart` | `privacyUri({required String languageCode})` adds `?lang=<code>`, like `termsUri`. |
| `lib/presentation/screens/settings/settings_screen.dart` | Passes `localeProvider`'s language code. |
| `test/domain/services/legal_links_test.dart` | Expects `/privacy?lang=en`. |
| `integration_test/qa/settings_terms_link_test.dart` | Privacy expects `?lang=en`; after switching to Arabic, taps Privacy again and expects `?lang=ar`. |
| `qa/features/ios/settings.yaml` (`terms-link`) | Steps and `expect` name `/privacy?lang=en`, then `?lang=ar` in Arabic. |

## Tests (TDD)

- `src/content/legal/__tests__/language.test.ts`: `en`, `ar` → themselves; absent, empty,
  `fr`, `EN` → null; other params ignored.
- `src/pages/landing/__tests__/PrivacyPolicyPage.test.tsx`:
  - stored `ar` + `?lang=en` → English h1 and sections; the text wrapper is `lang=en dir=ltr`;
    `<html dir>` stays `rtl`; `localStorage` still `ar`.
  - stored `en` + `?lang=ar` → Arabic text, `lang=ar dir=rtl`.
  - `?lang=fr` → the stored language, no `lang` wrapper.
- Flutter unit test above; flow test above.

## QA scenarios (release-QA)

- **web `legal.privacy-linked-language`** (new, `qa/specs/web/legal.spec.ts`): with the site in
  Arabic, open `/privacy?lang=en` → English policy, left to right; open `/privacy?lang=ar` with
  the site in English → Arabic, right to left; open `/privacy` → the site's own language is
  unchanged; `/privacy?lang=fr` → the site's language.
- **ios `settings.terms-link`** (updated): Privacy opens `/privacy?lang=en`, and `?lang=ar` after
  switching to Arabic.

## Risk / cost

None of note: two small pure functions and one hook; no new requests, no bundle growth, no
storage writes. The landing's footer link to `/privacy` from a `?lang` page doesn't carry the
language on, same as `/terms` today (out of scope).
