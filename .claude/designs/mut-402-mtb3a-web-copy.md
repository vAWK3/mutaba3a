# MUT-402 — The landing page, portal, web app and server say MTB3A in English (plan)

- **Epic:** MUT-400 (rename: English always **MTB3A**, Arabic always **متابعة**).
- **Blocked by:** MUT-401, now merged to local main (`2f526a07`).
- **Relates:** MUT-387 (merged), MAL-1305 (Malafat's copy, ships the same day or right after).
- **Status at planning:** Backlog. Planned 2026-10-23.
- **Release:** a web release and an api release on one day (MUT-400).

## What the survey found (2026-10-23)

**User-visible English copy** (translation leaves with "Mutaba3a"):

| File | Hits | Notes |
|---|---|---|
| `src/lib/i18n/translations/en/landing.json` | 22 | 10 outside the privacy policy (meta title, header wordmark, hero/account/get-it/Malafat band/FAQ, footer copyright); 12 inside `privacyPolicy.*` |
| `src/hosted/i18n/en.json` | 20 | `hosted.brand`, connection errors, setup, local footer, analytics consent, Malafat notes, records-file errors |
| `src/lib/i18n/translations/en/settings.json` | 5 | Malafat row title and text, About name, unknown-file error |
| `src/lib/i18n/translations/en/clients.json` | 2 | Malafat suggestions |
| `src/lib/i18n/translations/en/shell.json` | 1 | "Welcome to Mutaba3a" |
| `src/lib/i18n/translations/en/common.json` | 1 | `pageTitle`, "Mutaba3a — {page}" (every tab title) |

**Elsewhere:**
- **Arabic:** the only Latin hit is `ar/landing.json` `header.wordmark`, the bilingual "Mutaba3a · متابعة". `hosted.brand` and `header.wordmarkShort` are already متابعة in Arabic.
- **HTML and manifests:**
  - `hosted.html` `<title>Mutaba3a</title>`.
  - `index.html` and the PWA manifest are already متابعة.
  - The social cards are built from the Arabic hero (ADR-077), with `og:site_name` = the manifest's متابعة, so they need no change.
- **OAuth:** `public/.well-known/oauth-client.json` `client_name`.
- **Server:**
  - `API_TITLE` ("Mutaba3a Financial API", the OpenAPI `info.title`, `server/src/app.ts:164`).
  - Three error messages: `auth/middleware.ts:179`, `routes/account-setup.ts:50` and `routes/sessions.ts:79` say "the Mutaba3a portal".
  - The records export sets no file name. The portal names the download.
- **Download file names (lower case):**
  - `mutaba3a-export-<date>.zip` (`HostedYourDataDrawer.tsx:26`);
  - `mutaba3a-records-<date>.zip` (`YourDataDrawer.tsx:33`);
  - `mutaba3a-backup-v<n>-<date>.json` (`utils/backupDownload.ts:16`, `db/migration-safety.ts:705`);
  - `mutaba3a-<name>-<date>.csv/.json` (`ExportDataModal.tsx:70,88`);
  - `mutaba3a-import-template.csv` (`ImportDataPage.tsx:155`).

  Imports go by extension and content `kind`, never by file name.

**Not user copy, and unchanged by MUT-400's rule:** every remaining TS/TSX hit is a comment, or an identifier such as `X-Mutaba3a-Profile`, `mutaba3a-portal`/`mutaba3a-landing` campaign values, the records `kind`, vite plugin names, `MUTABA3A_*` env names and the seeded "Mutaba3a QA" account.

**Tests and QA specs that assert the old name:**
- unit: `Wordmark.test.tsx`, `craftFixKeys.test.ts` (`settings.about.name`), `oauth-client-live.test.ts`, and whichever portal and auth tests assert copy (found by running the suite);
- QA: `landing.spec.ts` (header link name, title), `portal/shell.spec.ts:119`, `portal/signin.spec.ts:175`, `portal/setup.spec.ts:165` and `web/settings.spec.ts:98-104`.

`web/legal.spec.ts:136` and `PrivacyPolicyPage.test.tsx:103` assert privacy text, which stays.

## Decisions (proposed)

- **D1. The logotype is a component; the lockup composes it.**
  - New `src/components/brand/Logotype.tsx`: a `<span role="img" aria-label="MTB3A">` painted by `Logotype.css` with `mask-image` and `-webkit-mask-image` (`url(../../assets/brand/wordmark.svg)`, so Vite bundles it to `/assets/`) over `background-color: var(--ink)`. It is sized by height. Width comes from `aspect-ratio` (W = 5.104 H).
  - The CSS also carries `@media (forced-colors: active) { background-color: CanvasText; forced-color-adjust: none }` and `@media print { print-color-adjust: exact }`.
  - `BrandName` (exported from `Logotype.tsx`, eng D2) picks the name for a language: `Logotype` in English, live "متابعة" in Thmanyah Serif Display Bold at 1.25 H in Arabic.
  - `Wordmark` keeps its shape (mark + `name`) and takes `gap` from the lockup tokens.
  - The landing header's full lockup is `BrandName en`, a markDot separator, `BrandName ar`, in a flex row. `dir` orders it (LTR puts MTB3A first, RTL puts متابعة first), and the mark always comes first. The phone lockup is `BrandName` for the active language.
  - The portal's `Wordmark` passes `BrandName` for the active language instead of `t('hosted.brand')`.
- **D2. Lockup tokens land here (MUT-401 eng D1).**
  - `mutaba3a.tokens.json` gets a `wordmark` block: `logotypeToMark` 0.40, `gap` 0.60 (×H), `clearSpace` 1 (×H), `minHeight` 12 (px), `aspect` 5.104, `arabicSize` 1.25 (×H), `separator` 0.16 (×H).
  - `mutaba3a-theme.css` mirrors them as `--m-wordmark-*`, and `brand.test.ts` › drift checks both ways.
  - `Logotype.css` reads them. `Wordmark` sets one custom property, `--wordmark-mark` (M), through React's `style` prop, and H follows as `calc(var(--wordmark-mark) * var(--m-wordmark-logotype-to-mark))`. React applies it through the CSSOM, which the portal CSP allows; it is never static `style=` markup. There is no clamp: every mark that carries a name is at least 30 px, so H is at least 12 px (eng review D3). The landing header goes from 24 to 30 px and the portal default from 28 to 30 px. A test pins every Wordmark mark size at ≥ 30 px.
  - The separator dot is the `markDot` token (`--mark-dot`), so it follows the in-app theme.
- **D3. Copy.**
  - Every English leaf above says MTB3A, in running text exactly as the kit says: plain capitals, no wrapper, letter-spacing 0. `common.pageTitle` becomes "MTB3A — {page}", and `hosted.brand` "MTB3A".
  - The Arabic `header.wordmark` key is retired, since the bilingual lockup is markup now. Its English twin goes too. `header.wordmarkShort` is retired in both languages, because `BrandName` covers it.
  - **Static `hosted.html` `<title>` becomes متابعة, not MTB3A.** It shows only before the bundle runs, and the portal opens in Arabic until a person chooses (ADR-077, like `index.html`). This narrows the ticket's "hosted.html title says MTB3A".
  - **The portal sets its own tab title.** Today the portal never sets one, so the static title stays for the whole session (verified: no `document.title` or `useDocumentTitle` under `src/hosted`). The portal root calls the shared `useDocumentTitle(t('hosted.brand'))`, so the tab reads MTB3A in English and متابعة in Arabic. This adds one call; per-page portal titles are out of scope.
- **D4. The privacy policy is the legal exemption.** `landing.privacyPolicy.*` keeps "Mutaba3a" until its next real revision, alongside the dated terms (Basel, MUT-400). The authoring notes, the header comments of `src/content/legal/terms.ts` and `PrivacyPolicyPage.tsx`, say the next version of either text says MTB3A.
- **D5. Guard test** `src/lib/i18n/__tests__/brandName.test.ts`:
  - every leaf in every English translation file (`src/lib/i18n/translations/en/*.json`, `src/hosted/i18n/en.json`) has no `/Mutaba3a/` (case-sensitive, so identifiers in lower case can't appear there anyway), except under `landing.privacyPolicy.`;
  - every Arabic leaf has no `/Mutaba3a|MTB3A/` outside the privacy policy;
  - `hosted.html` and `index.html` titles are متابعة;
  - `client_name` is "MTB3A";
  - the terms files are exempt by path.
  - Server strings are pinned by their own route tests (D7).
- **D6. Download file names** (needs Basel): rename the `mutaba3a-` prefixes to `mtb3a-`, lower case like the domain: `mtb3a-records-<date>.zip`, `mtb3a-export-<date>.zip`, `mtb3a-backup-…`, `mtb3a-<name>-<date>.csv`, `mtb3a-import-template.csv`. They're what a person sees in Downloads. Imports never read the name, so old files still import. The records file's `kind` stays.
- **D7. Server.**
  - `API_TITLE` becomes "MTB3A Financial API". `openapi.yaml` and `schema.d.ts` are regenerated (`openapi:check`).
  - `API_VERSION` gets a patch bump to `1.51.1-mut402`: 1.52.0 is already claimed by MUT-362's branch and MUT-56's plan. The title is the only contract change.
  - Malafat's vendored copy needs no change: its contract test reads `info.version`/`description`, never the title, and MAL-1305 leaves it alone.
  - The three CROSS_SITE messages say "the MTB3A portal". The portal shows its own copy by error code, so these reach API clients only.
- **D8. `client_name` becomes "MTB3A".** Malafat's consent screen reads it at run time (CIMD, MUT-387). `oauth-client-live.test.ts` takes the new value. The release-time live check compares against the committed file, so the web release publishes both together.
- **D9. Licence guardrail (MUT-401).** This ticket ships the outlined logotype, so the written Thmanyah record should be attached before the web release. Per brand-v2 decision 4 it stays a guardrail, not a build blocker. `docs/operations/before-release.md` gets an open operator step, "attach the Thmanyah written OK for the outlined MTB3A logotype", which `make release web` prints.

## Files

| Action | Path |
|---|---|
| add | `src/components/brand/Logotype.tsx` (exports `Logotype` and `BrandName`, eng D2), `Logotype.css`, `__tests__/Logotype.test.tsx` |
| edit | `src/components/brand/Wordmark.tsx` (gap token, `--wordmark-mark`, `DEFAULT_MARK_SIZE` 28 → 30; the name slot is unchanged), `__tests__/Wordmark.test.tsx` |
| edit | `src/pages/landing/components/LandingHeader.tsx` (`BAR_MARK_SIZE` 24 → 30, lockup), `src/pages/landing/LandingPage.css` |
| edit | `src/hosted/components/Brand.tsx`, `src/hosted/hosted.css` (`--wordmark-mark` for the sign-in and sidebar sizes) |
| edit | `src/styles/brand/mutaba3a.tokens.json`, `src/styles/brand/mutaba3a-theme.css`, `src/styles/__tests__/brand.test.ts` (drift) |
| edit | the six English translation files above; `ar/landing.json` (retire `header.wordmark*`) |
| edit | `hosted.html` (title); the portal root (the component under the language provider) calls `useDocumentTitle(t('hosted.brand'))` |
| edit | `public/.well-known/oauth-client.json`, `scripts/__tests__/oauth-client-live.test.ts` |
| edit | `server/src/app.ts` (title, version), `server/src/auth/middleware.ts`, `routes/account-setup.ts`, `routes/sessions.ts`, `server/openapi/openapi.yaml` (regen), `src/hosted/api/schema.d.ts` (regen), the route tests that pin the messages |
| edit (D6) | `HostedYourDataDrawer.tsx`, `YourDataDrawer.tsx`, `utils/backupDownload.ts`, `db/migration-safety.ts`, `ExportDataModal.tsx`, `ImportDataPage.tsx` and their tests |
| add | `src/lib/i18n/__tests__/brandName.test.ts` |
| edit | `src/content/legal/terms.ts`, `src/pages/landing/PrivacyPolicyPage.tsx` (authoring notes) |
| edit | `docs/operations/before-release.md` (D9), `docs/brand/wordmark/README.md` (lockup tokens are live, where the CSS is) |
| edit | `qa/features/web/brand.yaml`, `qa/features/portal/shell.yaml` (new features); `qa/specs/web/brand.spec.ts`, `qa/specs/portal/shell.spec.ts` (new specs); the five specs that assert old copy |
| edit | `.claude/DECISIONS.md` (next free ADR, checked across branches at build time), `CHANGELOG.md`, `COMPONENT_REGISTRY.md` (Logotype, BrandName), `TEST_PLAN.md` |

## Tests (written first)

1. **Logotype** (component): renders `role="img"` named "MTB3A", carries the class the mask CSS targets, and has no text node.
2. **Logotype.css** (node, postcss): the mask URL resolves to `src/assets/brand/wordmark.svg`; both `mask-image` and `-webkit-mask-image` are set; `background-color` is `var(--ink)`; a forced-colors rule sets `CanvasText` with `forced-color-adjust: none`; a print rule sets `print-color-adjust: exact`; height and aspect ratio read `--m-wordmark-*`.
3. **BrandName:** English renders the Logotype; Arabic renders the text متابعة with no logotype.
4. **Landing header:**
   - the link's accessible name is "MTB3A متابعة" in English and "متابعة MTB3A" in Arabic (DOM order follows `dir`);
   - the phone lockup shows only the active language's name;
   - the separator is `aria-hidden`.
5. **Portal Brand:** English shows the Logotype, Arabic the text; switching the language sets `document.title` to MTB3A and back to متابعة.
6. **Drift** (`brand.test.ts`): `--m-wordmark-*` equal the JSON block, both ways.
7. **Guard** (D5): fails on an injected English "Mutaba3a" leaf; passes the privacy keys; fails on Latin in Arabic.
8. **Server:** `GET /openapi.json` title is "MTB3A Financial API" and version is `1.51.1-mut402`; the three CROSS_SITE messages say MTB3A; `openapi:check` is clean.
9. **D6:** each download helper's file name starts `mtb3a-`, and the import accepts a file still named `mutaba3a-…`.
10. **`cimd-document.test.ts`:** `client_name` is "MTB3A".

Run: the touched suites, then the full gate on Node 22. Lint, typecheck, `test:run` and build, plus `npm --prefix server run typecheck`, `lint`, `openapi:check` and `test`.

## QA scenarios (release-qa)

| Feature | Steps | Expect |
|---|---|---|
| `web.brand.mtb3a-name` (secondary) | Open the landing page in English, then Arabic; open the app's Home in English | The header link shows the mark, the MTB3A logotype and متابعة, in that reading order for the page's direction. The tab title reads "MTB3A — …" in English and متابعة in Arabic. No visible "Mutaba3a" in English outside the privacy page. In forced-colors emulation the logotype is still visible. |
| `portal.shell.mtb3a-name` (secondary) | Open sign-in in English, then Arabic; sign in and look at the sidebar | Sign-in and the sidebar show the mark with the MTB3A logotype in English and with متابعة in Arabic. The tab title follows. |

`paths` cover the new brand files, the header and portal Brand, the translations and `hosted.html`. Both specs run once until they pass (`release-qa run --attach --only …`) on a preview build (memory `qa-run-on-preview-builds`).

## Acceptance criteria → plan

| Ticket AC | Covered by |
|---|---|
| Every English string says MTB3A (landing, portal, web app, server) | D3, D7, guard D5, tests 7–8; privacy exempt by D4; social cards are Arabic (no change) |
| Wordmark draws the logotype; mark unchanged | D1, tests 1–5; MUT-401 pins keep the mark |
| `client_name` is "MTB3A" | D8, test 10 |
| Arabic unchanged except embedded Latin | D3 (only `header.wordmark` had it), guard D5 |
| Test fails on "Mutaba3a" in English copy | D5 |
| Legal docs left alone; authoring note | D4 |
| Release-QA features + passing specs | QA scenarios |
| Full gate + server CI gates | Run line |

## Not in scope

- The phone (MUT-403), the stores (MUT-404) and Malafat (MAL-1305).
- Code identifiers, header names, campaign values, env names and the QA seed account (MUT-400).
- Desktop (retired until v2).
- The English OG card: the shipped card is Arabic.

## Eng review (2026-10-23, /plan-eng-review, target: this file)

Prior learning applied: wordmark-one-mask-file (MUT-401 eng D7).

### Scope record

feature answers: D1 = "Rename to mtb3a-" (plan D6 approved); structure: B, smaller arrangement (D2): `Logotype.tsx` exports `Logotype` and `BrandName`, one test file; accepted scope: the plan above with that arrangement; pending remedies: R1.

Scope Challenge result: scope accepted as-is (a smaller file arrangement is not a scope reduction).

## Decision ledger

### R1: The logotype's 12 px minimum vs today's mark sizes
Finding: A1, P1, confidence 9/10. `src/pages/landing/components/LandingHeader.tsx:8` `const BAR_MARK_SIZE = 24;` and `src/components/brand/Wordmark.tsx:5` `const DEFAULT_MARK_SIZE = 28;` (portal sign-in, boot, sidebar). With the kit's H = 0.40 M that gives 9.6 px and 11.2 px, both under the kit's "H ≥ 12 px (M ≥ 30 px); below this, use the mark on its own". The plan's D2 "clamped to the 12 px minimum" contradicts the kit. Reviewer: Claude (plan-eng-review).
Plan baseline: D2 clamps H at 12 px (unapproved).
Runtime evidence: static read of the two constants; `docs/brand/wordmark/README.md` minimum-size row.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R1 small-size rule | clamp H at 12 px (breaks the ratio) | marks become 30 px on the landing header and the portal (H = 12 px exactly), ratio kept everywhere | keep 24/28 px marks, logotype drawn at the 12 px floor (ratio broken below M 30) | keep 24/28 px marks and follow the kit literally: mark alone, no name, in those places |
Question D3:
D3 — How do we meet the logotype's 12 px minimum where the mark is small today?
Project/branch/task: main, MUT-402; the landing header and portal use 24 px and 28 px marks.
ELI10: The kit says the MTB3A logo is 0.4 times the mark's size and never under 12 px tall; below that, show the mark alone. Today the landing header's mark is 24 px and the portal's is 28 px, so the logo would come out 9.6 and 11.2 px: too small to read well. We can make those marks 30 px (logo exactly 12 px, the kit's proportions everywhere), keep the marks and draw the logo larger than the kit's ratio, or drop the name in those places.
Stakes if we pick wrong: a cramped header on phones, a lockup that doesn't match the kit, or the name missing from the header.
Recommendation: A because it keeps the kit's proportions everywhere and costs 6 px of mark in the landing bar, which the 375 px layout check proves
Completeness: A=10/10, B=6/10, C=3/10
Header: Small sizes
Options:
A) Marks to 30 px (recommended)
Landing header mark 24 → 30 px and the portal default 28 → 30 px, so the logotype is exactly 12 px and every lockup follows the kit. The brand layout QA (375 px and 1280 px, English and Arabic, MUT-231's header case) must still pass. (human: ~1h / CC: ~10min)
B) Logo at the 12 px floor
Keep the 24/28 px marks; the logotype never draws under 12 px, so at those sizes it is larger than 0.4 × the mark. The lockup no longer matches the kit there.
C) Mark alone when small
Follow the kit literally: below a 30 px mark, show the mark without the name. The landing header and the portal sign-in lose the name.

State: approved
Actual answer: A) Marks to 30 px (recommended), Basel, D3 answer 2026-10-23
Accepted scope: landing header BAR_MARK_SIZE 24 → 30 and Wordmark DEFAULT_MARK_SIZE 28 → 30, so H = 12 px and every lockup keeps the kit's ratio; no clamp; a test pins every Wordmark mark size at ≥ 30 px; the brand layout QA (375/1280, en/ar, MUT-231 header) must pass
History: none

Approval readiness: PASS. Checked R1 (Basel, D3 answer 2026-10-23). Scope answers D1 (rename the download names) and D2 (smaller arrangement) are recorded in the scope record.

## Review body

### Factual corrections (no behaviour change, no question)
- **The portal sets no tab title today** (no `document.title` or `useDocumentTitle` under `src/hosted`), so D3 adds the one `useDocumentTitle(t('hosted.brand'))` call. This was found while drafting and already applied.
- **Portal error text:** the portal never renders a server `message` (no `.message` in `src/hosted` components), so the three CROSS_SITE messages reach API clients only (D7).
- **One spelling for the name:** `Logotype`'s `aria-label` reads one constant, `BRAND_NAME_LATIN = 'MTB3A'` in `src/content/brand.ts` (it is a name, not translated). Copy files write the same capitals, and the guard (D5) keeps them in step.
- **CSP and the size property:** `--wordmark-mark` is set through React's `style` prop (CSSOM, allowed by `default-src 'self'`), never as static `style=` markup in `hosted.html`/`index.html` (D2).

### Section 1 — Architecture
- [P1] (confidence 9/10) `LandingHeader.tsx:8` and `Wordmark.tsx:5`: the 24 and 28 px marks put the logotype under the kit's 12 px minimum. → R1 approved (marks to 30 px).
- Dispositions: A1 accepted (D3).

### Section 2 — Code quality
- No issues found. Reuse: `Wordmark`, `BrandMark`, `useDocumentTitle`, the brand token pipeline and the drift test are extended, not copied. No extraction candidates.

### Section 3 — Tests

```
CODE PATHS                                     USER FLOWS
[+] Logotype / BrandName                       [+] Landing header (en, ar, 375, 1280)
  ├── [PLANNED ★★★] role img "MTB3A", no text     ├── [PLANNED ★★★ →E2E] lockup order by dir, names — web.brand.mtb3a-name
  ├── [PLANNED ★★★] en → logotype, ar → text       └── [PLANNED ★★ →E2E] forced-colors still visible
  └── [PLANNED ★★★] CSS: mask both prefixes,    [+] Portal sign-in + sidebar (en, ar)
        ink, forced-colors, print, tokens         └── [PLANNED ★★★ →E2E] logotype/text, tab title — portal.shell.mtb3a-name
[+] Wordmark: mark ≥ 30 px everywhere (R1)      [+] Downloads
[+] Tokens drift both ways                        └── [PLANNED ★★] names start mtb3a-; old names import
[+] Guard: en no "Mutaba3a" (privacy exempt),
      ar no Latin, titles, client_name
[+] Server: title + version, 3 messages, openapi:check
COVERAGE: every planned path has a planned test | GAPS: 0
```

- **Regression risk (CRITICAL to keep):** the existing brand layout QA (`web.brand.layout`, 375/1280, en/ar) and the MUT-231 header check must pass with the 30 px mark. They are listed as required runs, not new tests.
- **Test plan artifact:** `~/.gstack/projects/vAWK3-mutaba3a/` (written at Required outputs).
- **Tests made obsolete:** the old `Wordmark.test.tsx` text-name case is replaced; the `landing.spec.ts` link-name assertions are rewritten.

### Section 4 — Performance
- No issues found. One new asset, about 9.6 KB (8 KB of it the C2PA manifest), is emitted to `/assets/`, cached immutable and precached by the PWA. There are no new requests per page beyond that one file.

### NOT in scope
- MUT-403, MUT-404 and MAL-1305.
- Per-page portal tab titles: one brand title only.
- Email templates (MUT-359, not built), which should use MTB3A when they land.
- Desktop (retired).

### What already exists
- `Wordmark`/`BrandMark` (MUT-104), `useDocumentTitle` (MUT-77), the token JSON → CSS drift test (MUT-102), `wordmark.svg` and its pins (MUT-401), and the release-time OAuth document check (MUT-387).

### Failure modes
- **Mask URL not bundled or blocked:** the logotype is blank. Covered by the CSS test (URL resolves to the asset) and the QA specs (visible).
- **Forced colors:** the logotype vanishes. Covered by the forced-colors rule, the CSS test and the QA step.
- **Printing:** dropped with background graphics. Covered by the print rule and the CSS test.
- **Old name left in copy:** the guard fails CI.
- **Critical gaps:** 0.

### Parallelization
Sequential implementation: one module tree, and the server change is small.

## Implementation Tasks

- [ ] **T1 (P1, human: ~2h / CC: ~20min)** — brand — `Logotype`/`BrandName`, `Logotype.css`, lockup tokens and drift, `Wordmark` gap and 30 px marks (R1)
  - Verify: `npx vitest run src/components/brand src/styles/__tests__/brand.test.ts`
- [ ] **T2 (P1, human: ~2h / CC: ~15min)** — copy — the English translations, the Arabic `header.wordmark*` retirement, `hosted.html` title, portal `useDocumentTitle`, the guard test (D3–D5)
  - Verify: `npx vitest run src/lib/i18n`
- [ ] **T3 (P1, human: ~1h / CC: ~10min)** — server — title, `1.51.1-mut402`, three messages, OpenAPI regen (D7)
  - Verify: `npm --prefix server run typecheck && npm --prefix server run lint && npm --prefix server run openapi:check && npm --prefix server test`
- [ ] **T4 (P2, human: ~1h / CC: ~10min)** — downloads — `mtb3a-` prefixes plus the old-name import test (D6, eng D1)
- [ ] **T5 (P1, human: ~3h / CC: ~30min)** — release-qa — the two new features and specs, plus the five rewritten specs, run until they pass on a preview build
  - Also run: the `web.brand.layout` regression
- [ ] **T6 (P2, human: ~30min / CC: ~5min)** — docs — `client_name`, legal authoring notes, `before-release.md` licence step, ADR (next free number), CHANGELOG, COMPONENT_REGISTRY, TEST_PLAN

### Unresolved decisions
None in this review.

### Completion summary
- Step 0, Scope Challenge: scope accepted as-is (smaller arrangement, D2).
- Reality rows: tier-1 rows checked:
  - premise-table: unverified 0; every survey claim was read in the code.
  - already-done: none.
  - surface-check: the npm scripts exist.
  - binding-decisions: MUT-400 rules and MUT-401 eng D1/D7 are honoured.
  - numbers: the 24/28/30 px sizes were measured in the code.
  - deferred-asks: the narrowed `hosted.html` title (D3).
  - pr-count: one branch.
- Architecture review: 1 issue found.
- Code quality review: 0 issues found.
- Test review: diagram produced, 0 gaps.
- Performance review: 0 issues found.
- NOT in scope: written.
- What already exists: written.
- TODOS.md updates: 0 items proposed.
- Failure modes: 0 critical gaps flagged.
- Unresolved decisions: 0 in this review.
- Outside voice: codex unavailable (not installed). The native Claude Plan subagent did not finish within the 5-minute timer and was stopped, so there is no outside coverage.
- Parallelization: 1 lane, sequential.
- Lake Score: 3/3 recommended answers (D1 and D2 scored by kind).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex (unavailable) → in-host Claude Plan subagent | Independent 2nd opinion | 51 | unavailable (timed out) | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 54 | ISSUES OPEN | 1 issue, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 11 | — (not run for MUT-402) | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review: unavailable (not installed). The in-host Claude Plan subagent did not finish within the 5-minute timer, so there is no outside coverage for this review.
- **VERDICT:** No review is CLEAR. ENG: ISSUES OPEN (1 finding, resolved by R1), ready to implement. A design review is suggested, because the lockup changes the landing header and portal chrome. Eng review required.

NO UNRESOLVED DECISIONS
