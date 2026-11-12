# MUT-587 — Arabic dates use the Levantine months everywhere

Ticket: MUT-587 (Story, Backlog). Blocks MUT-588 (portal DateField). Relates MUT-448 (Reports Glance, which limited Levantine
months to Reports; this lifts that limit). Phone app: already Levantine (Flutter 0582aead, `levantine_months.dart`); no
phone work.

## Decision (Basel, 2026-11-10/11)

- Every Arabic date that **names a month** uses the Levantine (Syriac-derived) names — كانون الثاني، شباط، آذار … — with
  Latin digits. Locale: `ar-PS-u-nu-latn`.
- Numeric dates stay numeric: `dateStyle: 'medium'` in Arabic renders `07/11/2026` in both `ar` and `ar-PS`; it is not
  changed into a spelled-out date (Basel chose "Keep numbers", 2026-11-11). Those call sites still move to the shared
  locale so they follow one rule, but their output does not change.
- English output is unchanged (`en-US`). `Intl.RelativeTimeFormat` ("قبل 3 أيام") is unchanged.

## Verified output (Node ICU, same CLDR as evergreen browsers)

| options | `ar` today | `ar-PS-u-nu-latn` |
|---|---|---|
| `dateStyle: 'medium'` | 07/11/2026 | 07/11/2026 (no change) |
| `dateStyle: 'long'` | 7 نوفمبر 2026 | 7 تشرين الثاني 2026 |
| `day, month: 'short'` | 7 نوفمبر | 7 تشرين الثاني |
| `weekday, day, month: 'short'` | السبت، 7 نوفمبر | السبت، 7 تشرين الثاني |
| `month: 'short', year` | نوفمبر 2026 | تشرين الثاني 2026 |

`ar-PS` alone gives Arabic-Indic digits (١٥); `-u-nu-latn` is required.

## Design

### 1. One web helper — `src/lib/i18n/core.tsx`

```ts
/** MUT-587: Arabic dates name months the Levantine way (كانون الثاني, not يناير), with Latin digits like every amount. */
export const ARABIC_DATE_LOCALE = 'ar-PS-u-nu-latn';
export function dateLocale(lang: Language): string {
  return lang === 'ar' ? ARABIC_DATE_LOCALE : getLocale(lang);
}
```

`getLocale` stays `'ar'`: numbers, sizes and relative times use it, and changing it would move them. `core.tsx` is shared
by the portal and the website, so both pick it up; no new module.

### 2. Web call sites (only the date formatters; nothing else in these files changes)

| File | Today | Change |
|---|---|---|
| `src/hosted/format/dates.ts` `formatDay`, `formatInstant` | `getLocale` | `dateLocale` (numeric, output unchanged) |
| `src/hosted/format/reportFormat.ts` | own `REPORTS_ARABIC_DATES` | drop the constant, use `dateLocale`; update the MUT-448 comment |
| `src/hosted/data/closeAccount.ts` `closingDayLabel` | `getLocale`, `dateStyle: 'long'` | `dateLocale` |
| `src/hosted/components/groups/GroupMembers.tsx:56` | `getLocale` | `dateLocale` |
| `src/hosted/pages/views/ExpenseGroupDetail.tsx:281-282` | `getLocale` | `dateLocale` |
| `src/hosted/pages/accountant-invite/inviteState.ts` `inviteEnds` | `${locale}-u-nu-latn` (called with a language) | take `Language`, use `dateLocale` |
| `src/hosted/pages/sharing/sharingRules.ts:56,198,199` | `latn()` | `dateLocale`; `latn` stays for `RelativeTimeFormat` (l.75) |
| `src/hosted/pages/client-books/clientBooksRules.ts:210,219,225` | `latn()` | `dateLocale`; drop `latn` if no other use |
| `src/hosted/operator/time.ts:17,22,26` | `latn()` | `dateLocale`; `latn` stays for `RelativeTimeFormat` (l.13) |
| `src/pages/landing/components/mocks/useMockFormat.ts:16` | `formatDateShort(…, getLocale)` | pass `dateLocale(language)` |

`src/lib/utils.ts` `formatDate`/`formatDateShort`/`formatPaymentDate` keep their `locale: string` parameter; the only
caller is the landing mock. Machine-readable `en-CA` formatters (`migrations`, `mapFreeAppBackup`, `dates.ts:89`,
`sharingRules:66,182`) are not display and stay.

### 3. Server — `server/src/dates.ts`

The portal may not import server code and vice versa, so the server keeps its own constant (same value, comment pointing
at the web one):

```ts
/** MUT-587: as the portal's ARABIC_DATE_LOCALE (src/lib/i18n/core.tsx). */
export const ARABIC_DATE_LOCALE = 'ar-PS-u-nu-latn';
```

- `server/src/email/templates/copy.ts` `mailDay` (`'ar'` → constant): the closing-account and trial/billing mails.
- `server/src/billing/checkout.ts` `payPageDay` (`'ar-u-nu-latn'` → constant).
- Period pack: dates are spreadsheet serials with `yyyy-mm-dd` (`xlsx.ts`, `report.ts`), no month names. No change. Note
  this on the ticket (AC2 holds trivially for the pack).
- Everything else on the server formats `en-CA`/`en-US` parts for arithmetic. No change.
- `server/src/receipts/extract/dates.ts` *parses* both name sets from receipts. No change.

### 4. Hand-written copy

- `src/lib/i18n/translations/ar/landing.json:126` privacy `updated`: `آخر تحديث: 7 نوفمبر 2026` → `آخر تحديث: 7 تشرين الثاني 2026`
  (+ `PrivacyPolicyPage.test.tsx:348`).
- `src/content/legal/terms/2026-10-26.ar.json` (`نسخة 26 أكتوبر 2026`) and `2026-10-19.ar.json`: **not changed.** Each
  terms version is a frozen file whose sha256 is in the terms manifest (ADR-102); editing it would change what people
  accepted. The next terms version writes the Levantine name.

### 5. Guard (AC4) — ESLint `no-restricted-syntax`

Web (`eslint.config.js`) and server (`server/eslint.config.*`), for `Intl.DateTimeFormat` and `toLocale(Date|Time)?String`:
refuse a first argument that is `getLocale(...)`, a string/template starting with `ar`, or a `latn(...)` call. Messages
point at `dateLocale` / `ARABIC_DATE_LOCALE`.

Landmine: `no-restricted-syntax` is set per files-block, and two portal blocks already set it to `PORTAL_DECIMAL_SYNTAX`
(`eslint.config.js` ~l.252, ~l.277). A new block would *replace* those for overlapping files. Put the selectors in one
`DATE_LOCALE_SYNTAX` array and spread it into every block that sets the rule, plus a base block for the rest of `src/`.
A `RuleTester`-style fixture test (or a lint run over a fixture file) proves the rule fires.

## Tests (TDD: red first)

- `src/lib/i18n/__tests__/dateLocale.test.ts`: `ar` → `ar-PS-u-nu-latn`, `en` → `en-US`; a formatted 2026-01-15 long
  date in Arabic contains `كانون الثاني` and `2026`, and none of the 12 Gregorian names.
- Update the expectations that hold Gregorian names: `sharingRules.test.ts`, `NewShareLinkDrawer.test.tsx`,
  `PrivacyPolicyPage.test.tsx`, `server/src/email/__tests__/templates.test.ts`, `server/src/billing/__tests__/renewal-mail.test.ts`,
  `server/src/billing/__tests__/checkout.test.ts`.
- Add an Arabic case where a formatter has none: `closeAccount`, `inviteState`, `clientBooksRules`, `operator/time`.
- `formatDay` Arabic stays `07/11/2026` (locks in the "keep numbers" decision).
- Lint guard fixture.

Commands (Node 22, through the heavy gate): `heavy --light -l "MUT-587 vitest" -- npx vitest run <files> --maxWorkers=3`,
then `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run build`; server: `npm --prefix server run typecheck`,
`lint`, `test`. No OpenAPI change.

## Release-QA (AC5)

`qa/features/portal/dates.yaml` → `levantine-months`: in Arabic, a share link's "until" date, a client-book month heading
and the close-account deletion day read with Levantine months; no Gregorian Arabic name in the page text. One spec in
`qa/specs/portal/dates.spec.ts`, `paths` covering `src/lib/i18n/core.tsx` and the changed formatters. Skipped flows: other
portal flows only move numeric dates (output unchanged), so they don't need a re-run.

## Docs

ADR-252 (amends MUT-448's Reports-only limit; keep-numbers rule; frozen terms keep their words). CHANGELOG, PATTERNS
("Arabic dates: `dateLocale`"), DESIGN.md › RTL one line, TEST_PLAN.

## Cost / scale

Formatting only; no API, data or bundle change beyond a few bytes. Formatter caching unchanged.

---

# Eng review (plan-eng-review, 2026-11-11)

Target: `.claude/designs/mut-587-levantine-dates.md` (this plan, above, unchanged as written before review).

## Scope record
feature answers: none (no cuts proposed); structure: A) Original arrangement (D1, Basel 2026-11-11); accepted scope: the plan as written, ~17 files, no new classes; pending remedies: R1, R2, R3.

## Decision ledger

### R1: Where the release-QA scenario lives
Finding: 1, INFORMATIONAL, confidence 8/10, plan § Release-QA ("`qa/features/portal/dates.yaml` → `levantine-months`"), reviewer: Claude (Scope Challenge, reuse check)
Plan baseline: original proposal: a new area `qa/features/portal/dates.yaml` + `qa/specs/portal/dates.spec.ts`.
Runtime evidence: `qa/features/portal/direction.yaml` is the existing Arabic-presentation area (MUT-109, `direction.spec.ts`); `qa/features/portal/reports-glance.yaml:37` already pins Levantine months for Reports only.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 QA home | new dates.yaml + dates.spec.ts (proposal) | feature `levantine-months` added to direction.yaml + direction.spec.ts | new dates.yaml + dates.spec.ts |
| Scenario content (list/share date, client-book month, close-account day, no Gregorian name) | proposed | unchanged | unchanged |
| R2 Safari check | pending | pending | pending |
| R3 helper signature | pending | pending | pending |
Question D2:
D2 — Where should the Levantine-dates QA scenario live?
Project/branch/task: mini-crm main, MUT-587 plan.
ELI10: The plan makes a new QA area just for this check. The portal already has an area about how Arabic looks (text direction, MUT-109), and Reports already checks its own Levantine months. Putting the new check in the Arabic area keeps all "Arabic looks right" checks in one place and means one fewer file to keep up.
Stakes if we pick wrong: a one-feature area drifts and gets forgotten; it's cheap either way.
Recommendation: A because the existing area already owns Arabic presentation and its spec setup.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Add to direction area (recommended)
  ✅ Reuses direction.spec.ts's Arabic sign-in and page setup, so the new spec is shorter
  ✅ Every Arabic-presentation check lives in one place that release-qa already maps
  ❌ The direction area's title mentions text direction, so its scope grows slightly
B) New dates area
  ✅ Clear, separate name that's easy to find in the catalog
  ❌ A one-feature area with its own spec setup duplicates the direction spec's boilerplate
Net: reuse the existing Arabic area unless you want dates on their own.
Header: D2 QA home
Options:
A) Direction area (recommended)
Add feature `levantine-months` to qa/features/portal/direction.yaml and a test to qa/specs/portal/direction.spec.ts; paths cover src/lib/i18n/core.tsx and the changed formatters. (human: ~1h / CC: ~10 min)
B) New dates area
Create qa/features/portal/dates.yaml and qa/specs/portal/dates.spec.ts as the plan says, with the same scenario and paths. (human: ~1h / CC: ~12 min)

State: approved
Actual answer: A) Direction area (D2, Basel 2026-11-11)
Accepted scope: feature `levantine-months` in qa/features/portal/direction.yaml and its test in qa/specs/portal/direction.spec.ts, paths covering src/lib/i18n/core.tsx and the changed formatters; no dates.yaml/dates.spec.ts.
History: none

### R3: Who decides the Arabic date locale in `src/lib/utils.ts`
Finding: 2, INFORMATIONAL, confidence 8/10, `src/lib/utils.ts:264` `export function formatDate(isoString: string, locale: string = 'en-US')` / `:282` `formatDateShort(isoString: string, locale: string = 'en-US')`, reviewer: Claude (Section 2 Code quality, red flag 2 information leakage)
Plan baseline: original proposal: keep the `locale: string` parameter; the one caller (`useMockFormat.ts:16`) passes `dateLocale(language)`.
Runtime evidence: `formatDate` and `formatPaymentDate` have no production caller (only `src/lib/__tests__/utils.test.ts:361-396`); `formatDateShort` has one (`useMockFormat.ts:16`). The plan's lint guard sees `toLocaleDateString(locale)` with a variable and cannot tell whether that variable came from `getLocale`, so a future `formatDateShort(x, getLocale(language))` passes lint and prints يناير.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R3 helper signature | `locale: string`, caller picks | `language: Language`; helper calls `dateLocale` itself (formatDate, formatPaymentDate, formatDateShort) | `locale: string`, caller passes `dateLocale(language)` |
| Lint guard (plan § 5) | proposed | unchanged | unchanged |
| R1 QA home | approved: direction area (D2) | unchanged | unchanged |
| R2 Safari check | pending | pending | pending |
Question D3:
D3 — Should the shared date helpers take a language instead of a locale string?
Project/branch/task: mini-crm main, MUT-587 plan.
ELI10: Three small helpers in src/lib/utils.ts format dates, and the caller tells them which locale to use. If they took the language ("ar" or "en") instead, they would pick the Levantine locale themselves, and nobody could hand them plain "ar" by mistake. The lint guard can't catch that mistake when the locale arrives as a variable.
Stakes if we pick wrong: a later screen built on these helpers could quietly show يناير again without any test or lint failing.
Recommendation: A because it puts the rule inside the helper, where the guard's blind spot is.
Completeness: A=10/10, B=7/10
Pros / cons:
A) Helpers take a language (recommended)
  ✅ The Levantine rule lives inside the helper, so no caller can pass the wrong locale
  ✅ Closes the one gap the lint guard can't see (a locale passed in as a variable)
  ❌ Changes three exported signatures and the five existing utils tests that pass 'en-US'/'ar'
B) Keep locale strings
  ✅ Smallest diff: one argument changes at the one production caller
  ❌ The helpers still accept any locale, so plain 'ar' can come back through a variable
Net: a slightly bigger diff now buys a helper that can't be misused.
Header: D3 Helper API
Options:
A) Take a language (recommended)
formatDate, formatPaymentDate and formatDateShort take `language: Language` and call dateLocale inside; useMockFormat passes language; utils.test.ts cases move from locale strings to 'en'/'ar' and assert the Levantine name for 'ar'. (human: ~45 min / CC: ~8 min)
B) Keep locale strings
Leave the three signatures as they are; useMockFormat passes dateLocale(language). The guard does not cover locale variables. (human: ~10 min / CC: ~2 min)

State: approved
Actual answer: A) Take a language (D3, Basel 2026-11-11)
Accepted scope: formatDate, formatPaymentDate and formatDateShort in src/lib/utils.ts take `language: Language` and call dateLocale inside; useMockFormat passes language; utils.test.ts cases move to 'en'/'ar' and assert the Levantine name for 'ar'.
History: none

### R2: Checking Safari as well as Chromium
Finding: 3, INFORMATIONAL, confidence 6/10 (medium confidence, verify this is actually an issue), plan § Verified output ("Node ICU, same CLDR as evergreen browsers"), reviewer: Claude (Section 3 Test review)
Plan baseline: original proposal: vitest unit tests (Node ICU) + one release-QA spec, which runs Chromium desktop only (`qa/qa.config.mjs:39` `formFactors: ['desktop']`).
Runtime evidence: Node and Chromium output measured (`ar-PS-u-nu-latn` → 7 تشرين الثاني 2026). Safari/iOS output is unverified. If a browser lacked `ar-PS` data, Intl would quietly fall back to `ar` and print نوفمبر with no error.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R2 Safari check | none (proposal) | one manual check in desktop Safari of a share-link date and the close-account day in Arabic, noted on MUT-587 at qa-reconcile | none |
| R1 QA home | approved: direction area (D2) | unchanged | unchanged |
| R3 helper signature | approved: language (D3) | unchanged | unchanged |
Question D4:
D4 — Check the Levantine months once in Safari too?
Project/branch/task: mini-crm main, MUT-587 plan.
ELI10: Our tests run in Node and Chrome, which both print تشرين الثاني. Safari (and every iPhone browser) uses Apple's own copy of the date data. If that copy lacked the Palestinian Arabic locale, the browser would quietly print نوفمبر instead, with no error. A one-minute look in Safari settles it.
Stakes if we pick wrong: iPhone and Mac Safari users could keep seeing Gregorian month names while every test passes.
Recommendation: A because it costs a minute and covers the browser our tests can't run.
Completeness: A=10/10, B=7/10
Pros / cons:
A) One manual Safari check (recommended)
  ✅ Covers Safari and iOS, which use Apple's date data rather than Chrome's
  ✅ Costs about a minute at qa-reconcile; no new tooling or WebKit project
  ❌ Manual, so it isn't repeated automatically on later releases
B) No Safari check
  ✅ Nothing extra to do; CLDR has shipped ar-PS for years in all major engines
  ❌ A silent fallback in Safari would go unnoticed until a user reports it
Net: a one-minute manual look versus trusting Safari's data blind.
Header: D4 Safari check
Options:
A) Manual Safari check (recommended)
At qa-reconcile, open the portal in desktop Safari in Arabic and confirm a share-link date and the close-account day read with Levantine months; note the result on MUT-587. (human: ~5 min / CC: n/a, manual)
B) No Safari check
Rely on Node unit tests and the Chromium release-QA spec only. (human: 0 / CC: 0)

State: approved
Actual answer: A) Manual Safari check (D4, Basel 2026-11-11)
Accepted scope: at qa-reconcile, open the portal in desktop Safari in Arabic, confirm a share-link date and the close-account day read with Levantine months, and note the result on MUT-587.
History: none

## Outside voice (Claude Plan subagent, native fallback; Codex not installed)
Completed within the five-minute limit, VERDICT: FINDINGS. 8 findings: (1 High) release-notes.json 0.3.4 Arabic note says «7 نوفمبر 2026»; (2 High) lint deny-list misses ternaries, variable templates and locale variables; (3 Medium) the plan's reason to keep getLocale is false: on Node 22 / ICU 78 `ar` and `ar-PS-u-nu-latn` match for NumberFormat, RelativeTimeFormat, DisplayNames, ListFormat, Collator (re-verified by parent, same session); (4 Medium) `${dateLocale}-u-nu-latn` throws "Invalid language tag" (re-verified); (5 Medium) utils.ts must import from ./i18n/core, not ./i18n; formatDate/formatPaymentDate have no production caller; (6 Medium) QA skip reason false: expense-group chart, group weekdays, invite end date change; (7 Low) lint fixture under src/ fails npm run lint; (8 Low) ADR-252 may be taken by parallel worktrees mut-589/590.
Factual corrections, no question: F7 — the guard's proof runs ESLint programmatically (Linter / overrideConfig) in a test, not a violating fixture file under src/; F8 — take the next free ADR number at commit time, not a fixed 252.

### R4: Change getLocale itself instead of adding dateLocale
Finding: O3, INFORMATIONAL (Medium), confidence 9/10, `src/lib/i18n/core.tsx:63` `return lang === 'ar' ? 'ar' : 'en-US';`, reviewer: outside voice (Claude subagent), re-verified by parent
Plan baseline: original proposal § 1: keep getLocale = 'ar'; add dateLocale(lang) = 'ar-PS-u-nu-latn' for dates only; keep the latn() helpers for relative times.
Runtime evidence: Node 22 / ICU 78: `ar` vs `ar-PS-u-nu-latn` give identical output for currency, unit (kB), RelativeTimeFormat, DisplayNames (PS, IL, JO, JOD), ListFormat and dateStyle medium; only month names differ. `new Intl.DateTimeFormat('ar-PS-u-nu-latn-u-nu-latn')` throws. getLocale has 20+ callers (NumberFormat, ListFormat, PluralRules, Collator, DisplayNames). Safari output unverified (R2 covers a manual Safari look).
Comparison grid:
| Choice | Current | A | B | C | D |
|---|---|---|---|---|---|
| R4 where the Arabic locale is decided | proposal: new dateLocale beside getLocale | getLocale('ar') returns 'ar-PS-u-nu-latn'; no dateLocale; delete the 3 latn() helpers (sharingRules, clientBooksRules, operator/time) and inviteState's template; getLocaleFromLanguage (utils.ts:10) delegates to getLocale | keep the proposal (dateLocale + latn) | investigate first (bounded: Safari check of numbers + DisplayNames) | defer |
| R2 Safari check | approved: manual Safari look (D4) | extends to one number and one country name too | unchanged | unchanged | unchanged |
| R1 QA home | approved (D2) | unchanged | unchanged | unchanged | unchanged |
| R3 utils helpers take a Language | approved (D3) | helpers call getLocale | helpers call dateLocale | unchanged | unchanged |
| R5 guard shape | pending | pending | pending | pending | pending |
Question D5:
D5 — Change getLocale itself instead of adding a separate date locale?
Project/branch/task: mini-crm main, MUT-587 plan.
ELI10: The plan kept the portal's general Arabic locale as plain "ar" and added a second one just for dates, because it assumed switching would change how numbers look. The outside reviewer tested that, and I re-ran it: numbers, currencies, file sizes, "3 days ago", country names and lists come out identical; only month names change. So one switch in one place fixes every date, now and later. The three little "Latin digits" helpers become redundant and must go, because stacking them on the new locale makes an invalid tag that crashes the page.
Stakes if we pick wrong: keeping two locales means every future date call has to pick the right one, and a lint rule has to police it forever.
Recommendation: A because one locale with no second helper can't be picked wrong, and the evidence shows nothing else moves.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Change getLocale (recommended)
  ✅ Every date call, current and future, gets Levantine months with no new helper to remember
  ✅ Deletes three duplicate latn() helpers and the getLocaleFromLanguage copy instead of adding code
  ❌ Touches the locale behind every Arabic number, so Safari must be checked once for numbers too
B) Keep separate dateLocale
  ✅ Only date output can change, so number formatting is untouched even in untested browsers
  ❌ Two locales side by side; a later date call can pick the wrong one, and latn() keeps the crash trap
C) Investigate first
  ✅ Checks Safari numbers and country names before deciding, removing the one unverified risk
  ❌ Holds the plan for a manual check that R2 already schedules at qa-reconcile
D) Defer
  ✅ Builds the plan as written now and revisits the locale design later
  ❌ Ships the two-locale design and the guard it needs, then likely undoes both
Net: the evidence removed the reason for two locales; one switch is simpler and safer.
Header: D5 Locale
Options:
A) Change getLocale (recommended)
getLocale('ar') returns 'ar-PS-u-nu-latn' (constant ARABIC_LOCALE in core.tsx); no dateLocale; delete latn() in sharingRules, clientBooksRules, operator/time and the template in inviteState; getLocaleFromLanguage delegates to getLocale; the Safari check (R2) also looks at one number and one country name. (human: ~2h / CC: ~20 min)
B) Keep dateLocale
Keep the plan's § 1: dateLocale beside getLocale ('ar'), latn() helpers stay for relative times. (human: ~3h / CC: ~25 min)
C) Investigate first
Before deciding, check in desktop Safari that one currency amount and the PS country name are identical under 'ar' and 'ar-PS-u-nu-latn'; then return to this question. No code changes until then. (human: ~10 min / CC: n/a)
D) Defer
Leave this proposal unresolved and keep § 1 as the working design for now; revisit after build. (human: 0 / CC: 0)

State: answered
Actual answer: A) Change getLocale (D5, Basel 2026-11-11)
Accepted scope: getLocale('ar') = ARABIC_LOCALE 'ar-PS-u-nu-latn'; no dateLocale; latn() helpers and inviteState's template removed; getLocaleFromLanguage delegates.
History: none

### R5: Guard shape (decided by default: Basel said "continue", recommended option taken)
With one locale there is no "wrong helper" to police; the guard only stops a hand-written Arabic locale. ESLint
`no-restricted-syntax` on `Intl.DateTimeFormat` / `Intl.RelativeTimeFormat` / `toLocale(Date|Time)?String` refuses a first
argument that is (directly or as a ternary branch) a string literal starting with `ar`, or a template literal containing
`-u-nu-` (the stacked-tag crash). Locale *variables* are out of reach of a lint; the getLocale unit test and the Arabic
cases per formatter are the backstop (accepted gap, outside-voice O2). Server gets the same selectors, pointing at
`ARABIC_LOCALE` in `server/src/dates.ts`. Proof: a vitest that runs ESLint programmatically (F7), no fixture under src/.

## Build spec (final, after review)

1. `src/lib/i18n/core.tsx`: `export const ARABIC_LOCALE = 'ar-PS-u-nu-latn'`; `getLocale('ar')` returns it.
   `src/lib/utils.ts` `getLocaleFromLanguage` delegates to `getLocale` (import from `./i18n/core`); `formatDate`,
   `formatPaymentDate`, `formatDateShort` take `language: Language` and call `getLocale` (D3); landing mock passes language.
2. Remove `latn()` in `sharingRules.ts`, `clientBooksRules.ts`, `operator/time.ts` → `getLocale(language)`; `inviteEnds`
   takes a `Language` and uses `getLocale`; `reportFormat.ts` drops `REPORTS_ARABIC_DATES`.
3. Unchanged call sites (`formatDay`, `formatInstant`, `closeAccount`, `GroupMembers`, `ExpenseGroupDetail`) pick it up
   through getLocale; no edit beyond tests.
4. Server: `ARABIC_LOCALE` in `server/src/dates.ts`; `mailDay` and `payPageDay` use it.
5. Copy: privacy `updated` in `ar/landing.json`; the 0.3.4 Arabic release note (O1) if it names a Gregorian month; frozen
   terms files untouched.
6. Lint guard (R5) web + server, with an ESLint-programmatic test.
7. QA: feature `levantine-months` in `qa/features/portal/direction.yaml` + spec in `direction.spec.ts` (D2); its steps also
   cover the expense-group chart day labels and the invite end date (O6). Manual Safari look at one date, one amount and
   one country name in Arabic, noted on MUT-587 at qa-reconcile (D4/D5).
8. ADR: next free number at commit time (F8).
