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
  - New `src/components/brand/Logotype.tsx`: a `<span role="img" aria-label="MTB3A" lang="en">` (`lang` so a screen reader on an Arabic page reads it with the English voice, design review D13) painted by `Logotype.css` with `mask-image` and `-webkit-mask-image` (`url(../../assets/brand/wordmark.svg)`, so Vite bundles it to `/assets/`) over `background-color: currentColor` (design review D6: `--ink` does not exist, so `var(--ink)` would paint nothing; `currentColor` follows `--text`, the link's colour, the dark theme and forced colours, so MTB3A always matches the live Arabic name beside it). It is sized by height. **The box is pinned (design review D9):** `display: inline-block` (aspect-ratio does nothing on an inline span), `flex: none` (the header brand link has `min-width: 0`, so a shrinking item would squash it), `height: H` and `width: calc(H * var(--m-wordmark-aspect))` written out (W = 5.104 H), and `mask-size: 100% 100%`, `mask-repeat: no-repeat`, `mask-position: center`, each with its `-webkit-` twin.
  - The CSS also carries `@media (forced-colors: active) { background-color: currentColor; forced-color-adjust: none }` and `@media print { print-color-adjust: exact }`. **Forced colours follow the text (design review D11):** `currentColor` inherits the forced `LinkText` inside the header link and `CanvasText` elsewhere, so MTB3A is the same colour as the live متابعة beside it; a fixed `CanvasText` would split the two names into different colours.
  - **Print (design review D5, widened by eng re-run R4).** `@media print { .wordmark { color: var(--m-wordmark-print-ink) } }` sets the light-theme ink on the whole lockup whatever the theme. The logotype keeps `background-color: currentColor` and the dot paints `currentColor`, both with `print-color-adjust: exact`, so MTB3A, the dot and متابعة all print in one dark ink on white paper. There is no theme-independent ink primitive today (`--m-ink` is redefined for dark at `mutaba3a-theme.css:74` and `:107`), so the `wordmark` token block adds `printInk` (`#392F4B`, the light `--m-ink`), mirrored as `--m-wordmark-print-ink` and never redefined for dark. The drift test covers it, and a test pins it to the light `ink` hex. No page-wide print reset.
  - **Loading state (design review D4).** The logotype box always has its full height and width before the mask arrives, so nothing shifts. An unloaded mask paints nothing: never a solid ink rectangle (check in Safari and Chrome with the request blocked). `hosted.html` carries `<link rel="preload" as="image" type="image/svg+xml" crossorigin href="./src/assets/brand/wordmark.svg">`, so the hashed file arrives with the CSS. `crossorigin` is required: browsers fetch mask images in CORS mode, and a preload without it is fetched twice. A source test checks that the preload and the CSS mask name the same file; Vite rewrites both to one hashed `/assets/wordmark-*.svg` (`<link href>` is rewritten whatever its `rel`, `node_modules/vite/dist/node/chunks/config.js:23289`, and the 9,620-byte file is above the 4 KB inline limit). The portal QA spec checks that a cold load fetches it once (eng re-run R3). The web app gets no preload (eng re-run R5, accepted in writing): `index.html` serves both the landing and `/app`, so a preload there would cost every app page. A first-time landing visitor has no service worker yet, so MTB3A paints a moment late into its reserved box (nothing shifts); repeat visits come from the PWA precache.
  - `BrandName` (exported from `Logotype.tsx`, eng D2) picks the name for a language: `Logotype` in English, live "متابعة" in Thmanyah Serif Display Bold at 1.25 H in Arabic.
  - **The mark in high contrast (design review D15, Basel chose to fix it here).** Images are not recoloured in forced colours, so the mark's light petals nearly vanish on a black high-contrast canvas (true before this ticket). In `Logotype.css`'s forced-colors block, `.wordmark .wordmark-mark` gets `outline: 1px solid CanvasText` and `outline-offset: 2px` on the image box (no `forced-color-adjust` on the `<img>`: images are never recoloured, so it would do nothing; OV-13). **No border-radius (eng re-run R2):** the mark is a 2×2 arrangement, not a disc; its rose petal reaches the box's bottom-left corner (2, 98), and rounding an `<img>` clips its content. It applies only to marks inside a lockup; standalone marks (boot splash, loader) are out of scope. Normal rendering is unchanged.
  - **Optical alignment (design review D13).** Flex centring centres متابعة by its line box, not its letters. The QA run screenshots the lockup in both languages and compares it with the Wordmark Kit preview (`docs/brand/wordmark/claude-design/Wordmark Kit.dc.html`). If the Arabic name sits high, the fix is one token in the `wordmark` block (`arabicOffset`, ×H, applied as a `translate` on `BrandName ar`), never per-surface margins.
  - `Wordmark` keeps its shape (mark + `name`) and takes `gap` from the lockup tokens.
  - The landing header's full lockup is `BrandName en`, a markDot separator, `BrandName ar`, in a flex row. `dir` orders it (LTR puts MTB3A first, RTL puts متابعة first), and the mark always comes first. The phone lockup is `BrandName` for the active language. **Phone widths (design review D12):** the switch to the single name stays at `max-width: 480px`, as today; at 320 px the English row is about 239 of 288 px and the Arabic about 258, so nothing wraps. The portal phone shell (`hosted.css:443`, 760 px and below) keeps showing no lockup, as today; sign-in and the boot screens still show theirs at every width.
  - **Implementation notes from the eng re-run (outside voice; necessary to build the approved decisions, no new behaviour):**
    - **OV-4, the 480 px switch:** the retired `.landing-wordmark-full`/`-short` rules are replaced by one rule: the lockup marks the other language's `BrandName` and the dot with `wordmark-other`, and `@media (max-width: 480px) { .landing-wordmark .wordmark-other { display: none } }` hides them. Test 13 checks that rule exists; jsdom ignores media queries, so the 320/360 px QA run (D12) proves it renders.
    - **OV-8, where H lives:** H (`--wordmark-h`) is declared on `.wordmark` and on the logotype/`BrandName` element, never on `:root` or a theme selector, because `var()` resolves where the property is declared; on `:root` every surface would get the 30 px fallback. Test 12 checks no `:root` rule declares it.
    - **OV-9, spacing:** the lockup's three name items (MTB3A, dot, متابعة) sit in the `Wordmark` flex row with the 0.60 H gap, which is what the kit asks for (`docs/brand/wordmark/README.md:39`, "0.60 H from each"). No separate dot-spacing token.
    - **OV-10, the literal guard:** `brand.test.ts:1069` ("adds no literal outside src/styles") scans `Logotype.css` outside print rules. The 3 px separator floor becomes a `wordmark` token (`separatorMin`), the dot's radius uses `--radius-pill`, and the system colours (`CanvasText`, `currentColor`) are keywords, not literals; nothing is allowlisted.
    - **OV-11, `hosted.html` `lang`:** it stays `lang="en" dir="ltr"` with the Arabic static title, matching `index.html:2`; the runtime language provider sets `lang`/`dir` once the bundle runs.
    - **OV-12, the preload on phones:** a signed-in reload at 760 px or below never shows a lockup, so Chrome may log "preloaded but not used". Accepted: 9.6 KB, immutable-cached, and sign-in (the cold path) shows the lockup at every width.
  - The portal's `Wordmark` passes `BrandName` for the active language instead of `t('hosted.brand')`.
- **D2. Lockup tokens land here (MUT-401 eng D1).**
  - `mutaba3a.tokens.json` gets a `wordmark` block: `logotypeToMark` 0.40, `gap` 0.60 (×H), `clearSpace` 1 (×H), `minHeight` 12 (px), `aspect` 5.104, `arabicSize` 1.25 (×H), `separator` 0.16 (×H), `separatorMin` 3 (px, design review D10, OV-10), `printInk` `#392F4B` (design review D5).
  - `mutaba3a-theme.css` mirrors them as `--m-wordmark-*`, and `brand.test.ts` › drift checks both ways.
  - `Logotype.css` reads them. `Wordmark` sets one custom property, `--wordmark-mark` (M), through React's `style` prop, written as `` `${markSize}px` `` (a bare number would leave the calc unitless and the logotype at zero height). **M has one source, the `markSize` prop (design review D7):** CSS never sets `--wordmark-mark`, the portal `Wordmark` in `Brand.tsx` takes a `markSize` prop that defaults to 40 (sign-in, setup, terms-update and the boot screens use the default; the sidebar passes 32), and `Logotype.css` reads `var(--wordmark-mark, 30px)` so a `BrandName` outside a `Wordmark` still has a height, and H follows as `calc(var(--wordmark-mark) * var(--m-wordmark-logotype-to-mark))`. React applies it through the CSSOM, which the portal CSP allows; it is never static `style=` markup. There is no clamp: every mark that carries a name is at least 30 px, so H is at least 12 px (eng review D3). The landing header goes from 24 to 32 px, portal sign-in and boot from 28 to 40 px, the sidebar from 28 to 32 px and the `Wordmark` default from 28 to 30 px (design review D3, table below). A test pins every Wordmark mark size at ≥ 30 px.
  - **Mark size per surface (design review D3).** The sizes are pinned so the Arabic name keeps today's size. Every one is at least 30, so eng D3 holds.

    | Surface | M | H (logotype) | Arabic name | Today |
    |---|---|---|---|---|
    | Landing bar | 32 px | 12.8 px | 16 px | 24 px mark, 16 px name |
    | Portal sign-in, setup, terms-update, the three boot screens | 40 px | 16 px | 20 px | 28 px mark, 20 px name |
    | Portal sidebar | 32 px | 12.8 px | 16 px | 28 px mark, 20 px name |
    | `Wordmark` default (anything else) | 30 px | 12 px | 15 px | 28 px |

    `BAR_MARK_SIZE` becomes 32, not 30. On portal sign-in the brand sits one step below the card's h1 "Sign in" (h1 20 px bold; the logotype's caps are 16 px). That is the intended order: the page's task first, the brand as confirmation of the site.
  - **Old lockup CSS is retired (design review D8).** These declarations sit on the same element as the token rules and would fight them by load order, so they are deleted:
    - `LandingPage.css:131` `.landing-wordmark`: `gap`, `font-family`, `font-size`, `font-weight` (keep `display`, `align-items`, `white-space`);
    - `LandingPage.css:145` and `:179`/`:183` `.landing-wordmark-short` and `.landing-wordmark-full`, whole rules (their spans go with `header.wordmark*`);
    - `hosted.css:16` `.hp-wordmark`: `gap`, `font-family`, `font-size`, `font-weight`, `letter-spacing` (keep `display`, `align-items`, `color`);
    - `hosted.css:26` `[dir="rtl"] .hp-wordmark { font-family }`, whole rule;
    - `hosted.css:216` `.hp-side-wordmark`: `font-size` (keep its padding; the `:443` phone rule that hides it stays).

    `BrandName ar` sets its own type on itself, so nothing it inherits can change it: `font-family: var(--font-heading-ar)`, `font-size: calc(1.25 * H)`, `font-weight: var(--weight-bold)` (700, the kit's Bold), `line-height: 1`, `letter-spacing: 0` (negative tracking breaks Arabic joining), and `lang="ar"`. A CSS test reads both files and fails if any deleted declaration is back.
  - The separator dot is the `markDot` token (`--mark-dot`), so it follows the in-app theme. **Its size has a floor (design review D10):** `max(calc(0.16 * H), 3px)`, a kit exception recorded next to the 12 px minimum in `docs/brand/wordmark/README.md` (0.16 H is about 2 px at the landing and sidebar sizes). It is a round `aria-hidden` span (`border-radius: 50%`, `background: var(--mark-dot)`), centred on the logotype box, whose centre is the cap centre (362 of 724 units). In forced colours it paints `currentColor` with `forced-color-adjust: none` (design review D14, amending D10's `CanvasText`), so high contrast still shows a dot between the names, in the same colour as both of them.
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
  - `API_VERSION` gets a patch bump to the next patch after `main`'s version at build time. **Corrected in the eng re-run (outside voice OV-1):** MUT-362 is merged and `server/src/app.ts:173` already reads `1.52.0-mut362`, so today that is `1.52.1-mut402`; `1.51.1` would go backwards. The title is the only contract change. (MUT-56's plan also still names `1.52.0-mut56` and needs the same re-check.)
  - Malafat's vendored copy needs no change: its contract test reads `info.version`/`description`, never the title, and MAL-1305 leaves it alone.
  - The three CROSS_SITE messages say "the MTB3A portal". The portal shows its own copy by error code, so these reach API clients only.
- **D8. `client_name` becomes "MTB3A".** Malafat's consent screen reads it at run time (CIMD, MUT-387). `oauth-client-live.test.ts` takes the new value. The release-time live check compares against the committed file, so the web release publishes both together.
- **D9. Licence guardrail (MUT-401).** This ticket ships the outlined logotype, so the written Thmanyah record should be attached before the web release. Per brand-v2 decision 4 it stays a guardrail, not a build blocker. `docs/operations/before-release.md` gets an open operator step, "attach the Thmanyah written OK for the outlined MTB3A logotype", which `make release web` prints.

## Files

| Action | Path |
|---|---|
| add | `src/components/brand/Logotype.tsx` (exports `Logotype` and `BrandName`, eng D2), `Logotype.css`, `__tests__/Logotype.test.tsx` |
| edit | `src/components/brand/Wordmark.tsx` (gap token, `--wordmark-mark`, `DEFAULT_MARK_SIZE` 28 → 30; the name slot is unchanged), `__tests__/Wordmark.test.tsx` |
| edit | `src/pages/landing/components/LandingHeader.tsx` (`BAR_MARK_SIZE` 24 → 32, design review D3; lockup), `src/pages/landing/LandingPage.css` |
| edit | `src/hosted/components/Brand.tsx` (a `markSize` prop defaulting to 40, so `SignInPage.tsx:140`, `SetupPage.tsx:88`, `TermsUpdatePage.tsx:70` and `BootScreens.tsx:46,73,91` need no change; `HostedShell.tsx:48` passes 32; design review D7), `src/hosted/hosted.css` (never sets `--wordmark-mark`), `src/hosted/components/__tests__/Brand.test.tsx` |
| edit | `src/pages/landing/__tests__/LandingHeader.test.tsx` (`:48`, `:49` and `:83` assert the retired `.landing-wordmark-full`/`-short` spans; rewritten to test 4), `src/components/brand/__tests__/Wordmark.test.tsx:23` (`markSize: 24` is under the 30 px floor) |
| edit | `src/styles/brand/mutaba3a.tokens.json`, `src/styles/brand/mutaba3a-theme.css`, `src/styles/__tests__/brand.test.ts` (drift) |
| edit | the six English translation files above; `ar/landing.json` (retire `header.wordmark*`) |
| edit | `hosted.html` (title); the portal root (the component under the language provider) calls `useDocumentTitle(t('hosted.brand'))` |
| edit | `public/.well-known/oauth-client.json`, `scripts/__tests__/oauth-client-live.test.ts` |
| edit | `server/src/app.ts` (title, version), `server/src/auth/middleware.ts`, `routes/account-setup.ts`, `routes/sessions.ts`, `server/openapi/openapi.yaml` (regen), `src/hosted/api/schema.d.ts` (regen), the route tests that pin the messages |
| edit (D6) | `HostedYourDataDrawer.tsx`, `YourDataDrawer.tsx`, `utils/backupDownload.ts`, `db/migration-safety.ts`, `ExportDataModal.tsx`, `ImportDataPage.tsx` and their tests |
| add | `src/lib/i18n/__tests__/brandName.test.ts` |
| edit | `src/content/legal/terms.ts`, `src/pages/landing/PrivacyPolicyPage.tsx` (authoring notes) |
| edit | `docs/operations/before-release.md` (D9), `docs/brand/wordmark/README.md` (lockup tokens are live, where the CSS is; lines 26 and 65 say `var(--ink)`, which becomes `currentColor`, design review D6); `.claude/DECISIONS.md` ADR-171 item 1 gets the same one-word correction as an amendment line |
| edit | `qa/features/web/brand.yaml`, `qa/features/portal/shell.yaml` (new features); `qa/specs/web/brand.spec.ts`, `qa/specs/portal/shell.spec.ts` (new specs); the five specs that assert old copy |
| edit | `.claude/DECISIONS.md` (next free ADR, checked across branches at build time), `CHANGELOG.md`, `COMPONENT_REGISTRY.md` (Logotype, BrandName), `TEST_PLAN.md` |

## Tests (written first)

1. **Logotype** (component): renders `role="img"` named "MTB3A", carries the class the mask CSS targets, and has no text node.
2. **Logotype.css** (node, postcss): the mask URL resolves to `src/assets/brand/wordmark.svg`; both `mask-image` and `-webkit-mask-image` are set; `background-color` is `currentColor`, and no declaration in the file reads an undefined custom property (every `var(--…)` it uses is defined in `theme.css` or `mutaba3a-theme.css`; the one exemption is `--wordmark-mark`, which is set only from the `markSize` prop and must always be read with its `30px` fallback, OV-3); the forced-colors rules for the logotype and separator selectors keep `currentColor` with `forced-color-adjust: none` and never name `CanvasText` (design review D11; the mark ring's `outline` is the only `CanvasText` in the file, OV-2); a print rule sets `.wordmark { color: var(--m-wordmark-print-ink) }` (which equals the light-theme ink hex) and `print-color-adjust: exact` on the logotype and the dot (eng re-run R4); height and width read `--m-wordmark-*`; the rule sets `display: inline-block`, `flex: none`, and `mask-size: 100% 100%`, `mask-repeat: no-repeat`, `mask-position: center` with their `-webkit-` twins (design review D9).
3. **BrandName:** English renders the Logotype with `lang="en"`; Arabic renders the text متابعة with `lang="ar"` and no logotype (design review D8, D13).
4. **Landing header:**
   - the link's accessible name is "MTB3A متابعة" in English and "متابعة MTB3A" in Arabic (DOM order follows `dir`);
   - the phone lockup shows only the active language's name;
   - the separator is `aria-hidden`.
5. **Portal Brand:** English shows the Logotype, Arabic the text; switching the language sets `document.title` to MTB3A and back to متابعة.
6. **Drift** (`brand.test.ts`): `--m-wordmark-*` equal the JSON block, both ways.
7. **Guard** (D5): fails on an injected English "Mutaba3a" leaf; passes the privacy keys; fails on Latin in Arabic.
8. **Server:** `GET /openapi.json` title is "MTB3A Financial API" and version is the next patch after `main`'s at build time (`1.52.1-mut402` today, OV-1); the three CROSS_SITE messages say MTB3A; `openapi:check` is clean.
9. **D6:** each download helper's file name starts `mtb3a-`, and the import accepts a file still named `mutaba3a-…`.
10. **`cimd-document.test.ts`:** `client_name` is "MTB3A".
11. **Portal preload** (vitest source contract, design review D4, eng re-run R3): `hosted.html` has exactly one `<link rel="preload" as="image" type="image/svg+xml" crossorigin>`; its href resolves to `src/assets/brand/wordmark.svg`, and `Logotype.css`'s mask `url()` resolves to the same file. Runs in `test:run`; no build needed.
12. **Size source** (`Wordmark.test.tsx`, design review D7): the inline `--wordmark-mark` equals `${markSize}px` and the mark `<img>` width/height equal the same `markSize`; `hosted.css` and `LandingPage.css` contain no `--wordmark-mark:` declaration; the portal `Wordmark` renders a 40 px mark by default and `HostedShell`'s sidebar passes 32.
13. **Retired CSS** (node, postcss, design review D8): `.landing-wordmark`, `.hp-wordmark` and `.hp-side-wordmark` declare no `gap`, `font-size`, `font-weight` or `letter-spacing`; `.landing-wordmark-full`, `.landing-wordmark-short` and `[dir="rtl"] .hp-wordmark` no longer exist; the Arabic `BrandName` rule sets `letter-spacing: 0`, `line-height: 1` and the bold weight, and the component renders `lang="ar"`.
14. **Separator** (node, postcss, design review D10): the dot's size is `max(calc(var(--m-wordmark-separator) * H), var(--m-wordmark-separator-min))`, it is round and filled with `var(--mark-dot)`, and a forced-colors rule paints it `currentColor` with `forced-color-adjust: none` (D14).
15. **Mark ring** (node, postcss, design review D15): inside `@media (forced-colors: active)`, `.wordmark .wordmark-mark` has `outline: 1px solid CanvasText` and `outline-offset: 2px`, and sets no `border-radius` or `forced-color-adjust` (eng re-run R2, OV-13); no rule outside that block outlines the mark.

Run: the touched suites, then the full gate on Node 22. Lint, typecheck, `test:run` and build, plus `npm --prefix server run typecheck`, `lint`, `openapi:check` and `test`.

## QA scenarios (release-qa)

| Feature | Steps | Expect |
|---|---|---|
| `web.brand.mtb3a-name` (secondary) | Open the landing page in English, then Arabic; open the app's Home in English | The header link shows the mark, the MTB3A logotype and متابعة, in that reading order for the page's direction. The tab title reads "MTB3A — …" in English and متابعة in Arabic. At 320 and 360 px, in both languages, the header shows the mark and one name with nothing wrapped or overflowing (design review D12). No visible "Mutaba3a" in English outside the privacy page. A screenshot of the lockup in each language sits level with the Wordmark Kit preview (design review D13). In forced-colors emulation (Chrome) the logotype is visible and the same colour as متابعة on the landing link and the portal sign-in (design review D11). The mark shows a thin ring there (D15). |
| `portal.shell.mtb3a-name` (secondary) | Open sign-in in English, then Arabic; sign in at desktop width (above 760 px) and look at the sidebar | Sign-in and the sidebar show the mark with the MTB3A logotype in English and with متابعة in Arabic. The tab title follows. A cold sign-in load requests `wordmark-*.svg` exactly once (the preload is used, not fetched twice; eng re-run R3). This check runs in Chromium only; Safari is not covered (R6). |

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
History: superseded in part by design review D3 (Basel, 2026-10-23): the sizes are now landing 32, portal sign-in/setup/terms-update/boot 40, sidebar 32, default 30. All are still at least 30 px, so this record's floor and its "≥ 30 px" test stand.

Approval readiness: PASS. Checked R1 (Basel, D3 answer 2026-10-23). Scope answers D1 (rename the download names) and D2 (smaller arrangement) are recorded in the scope record.

### Eng re-run (2026-10-23, after design review D3–D15)

Scope record (reused): structure B, smaller arrangement (eng D2), still holds. The design review adds no files or classes, only tests inside the planned test files, so the complexity selector is not re-asked.

### R2: The high-contrast ring's shape (design review D15)
Finding: E1, P1, confidence 9/10. The `src/assets/brand/mark.svg` path `<path d="M2 98 A44 44 0 0 1 46 54 A44 44 0 0 1 2 98 Z" fill="#F499A7">` puts the rose petal's tip at (2, 98), which is 67.9 units from the mark's centre, outside the 50-unit circle. The mark is a 2×2 arrangement of shapes, not a round mark. `border-radius: 50%` on an `<img>` clips the image itself, so D15 as written cuts off the petal tip in high contrast. Reviewer: Claude (plan-eng-review re-run).
Plan baseline: design review D15 (Basel, 2026-10-23): in forced colours, `.wordmark .wordmark-mark` gets `outline: 1px solid CanvasText`, `outline-offset: 1px`, `border-radius: 50%`, `forced-color-adjust: none`.
Runtime evidence: static read of `mark.svg`. CSS: border-radius clips replaced-element content. Not checked in a browser.
Comparison grid:
| Choice | Current (D15) | A | B | C |
|---|---|---|---|---|
| R2 ring shape | round: `border-radius: 50%` on the img, which clips the petal tip | square ring: outline on the img box, no border-radius, `outline-offset: 2px`; nothing clipped | keep D15 as written: round ring, petal tip clipped in high contrast only | no ring: a cream `#FCF6ED` backing square behind the mark in forced colours, so the mark shows as designed |
| D15 scope (lockup marks only, forced colours only, normal rendering unchanged) | approved | unchanged | unchanged | unchanged |
| Test 15 | asserts `border-radius: 50%` | asserts the outline and no `border-radius` | unchanged | asserts the backing colour, no outline |
Question D1:
D1 (eng re-run) — What shape should the high-contrast ring around the mark take?
Project/branch/task: main, MUT-402; the design review's D15 ring around lockup marks in Windows high contrast.
ELI10: In high contrast the mark's light petals nearly vanish, so D15 draws a thin ring around it. D15 makes the ring round by rounding the image's corners. But the mark isn't round: the pink petal's tip reaches the bottom-left corner of its square, and rounding the image cuts that tip off. Only high-contrast users would see it.
Stakes if we pick wrong: high-contrast users see a mark with a clipped petal, or a bright square on a dark screen.
Recommendation: A because a square ring on the image box keeps every petal whole and is the smallest change to the approved D15
Completeness: A=10/10, B=6/10, C=8/10
Header: Ring shape
Options:
A) Square ring (recommended)
In forced colours, outline the image box: `outline: 1px solid CanvasText`, `outline-offset: 2px`, no border-radius, so nothing is clipped. The rest of D15 is unchanged (lockup marks only, forced colours only). Test 15 asserts the outline and the absence of border-radius. (human: ~10min / CC: ~2min)
B) Keep the round ring
Keep D15 as written. The ring is round, but the pink petal's tip is clipped for high-contrast users. No change to the plan or test 15.
C) Cream backing square
No ring: in forced colours the mark gets a cream `#FCF6ED` background, so it shows exactly as designed on its own paper. It shows as a bright square on dark high-contrast themes. Test 15 asserts the backing colour instead. (human: ~10min / CC: ~2min)

State: approved
Actual answer: A) Square ring (recommended), Basel, eng re-run D1 answer 2026-10-23
Accepted scope: in forced colours, `.wordmark .wordmark-mark` gets `outline: 1px solid CanvasText`, `outline-offset: 2px`, no border-radius, `forced-color-adjust: none`; lockup marks only, normal rendering unchanged; test 15 asserts the outline and no border-radius
History: D15 (design review) had `border-radius: 50%`, `outline-offset: 1px`; reopened because the mark's rose petal reaches (2, 98) and would be clipped

### R3: How the portal preload is proven (test 11, design review D4)
Finding: E2, P2, confidence 9/10. Test 11 reads the built `hosted.html`, but nothing in the gate builds the portal: `package.json:11` `"build": "tsc -b && vite build"` builds the web config only, and the portal needs `package.json:14` `"build:hosted": "tsc -b && vite build --mode hosted"`. `test:run` also runs before any build. As written, test 11 fails on a clean checkout or has to be skipped. Reviewer: Claude (plan-eng-review re-run).
Plan baseline: design review D4 (Basel, 2026-10-23): preload with `crossorigin` in `hosted.html`, plus "a build test checks that the built `hosted.html` preloads the same hashed URL the CSS masks with". The behaviour is approved; only how it is proven is open.
Runtime evidence: Vite 7.3.6 rewrites every `<link href>` in HTML with no `rel` filter (`node_modules/vite/dist/node/chunks/config.js:23289` `link: { srcAttributes: ["href"], srcsetAttributes: ["imagesrcset"] }`). The CSS `url()` and the HTML href resolve to the same source file, so they get the same hashed name. `wordmark.svg` is 9,620 bytes, above Vite's default 4,096-byte inline limit (`hostedConfig()` sets none), so it is emitted rather than inlined. The double fetch without `crossorigin` is browser behaviour and is not checked here.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R3 preload proof | vitest reads `dist-hosted/hosted.html` (no build in the gate) | source contract test in `test:run` plus a release-qa network check (one `wordmark-*.svg` request on a cold portal load) | a post-build script run after `build:hosted`, added to the gate and CI | keep test 11 as written |
| D4 behaviour (preload, `crossorigin`, reserved box) | approved | unchanged | unchanged | unchanged |
Question D2:
D2 (eng re-run) — How should the plan prove the portal preloads the logotype correctly?
Project/branch/task: main, MUT-402; test 11 from design review D4.
ELI10: The design review added a preload so the portal's logotype doesn't arrive late. Its test reads the built portal page, but the repo's checks never build the portal (`npm run build` builds only the web app), so the test can't run as written. We can check the source files plus one real-browser check, add a build step, or keep the test and let it break.
Stakes if we pick wrong: a test that fails on every clean checkout, or a preload that quietly double-downloads the file with nothing noticing.
Recommendation: A because the source test runs in the normal suite and the browser check catches the one thing source can't: a mismatched preload fetched twice
Completeness: A=9/10, B=8/10, C=4/10
Header: Preload proof
Options:
A) Source test + QA check (recommended)
Test 11 becomes a vitest source contract: `hosted.html` has exactly one `<link rel="preload" as="image" type="image/svg+xml" crossorigin>`, its href resolves to `src/assets/brand/wordmark.svg`, and `Logotype.css`'s mask `url()` resolves to the same file (Vite rewrites both to one hashed asset, `config.js:23289`). The portal release-qa spec asserts a cold sign-in load requests `wordmark-*.svg` exactly once. (human: ~45min / CC: ~10min)
B) Post-build script
A script checks `dist-hosted/hosted.html` after `npm run build:hosted`, and the gate and CI gain that build step. It proves the real output, but it adds a portal build to every gate run and still can't see a double fetch. (human: ~1.5h / CC: ~20min)
C) Keep test 11
Leave the test reading `dist-hosted`. It fails on a clean checkout, or gets skipped and proves nothing.

State: approved
Actual answer: A) Source test + QA check (recommended), Basel, eng re-run D2 answer 2026-10-23
Accepted scope: test 11 becomes a vitest source contract (one preload link with `as="image"`, `type="image/svg+xml"`, `crossorigin`; its href and `Logotype.css`'s mask `url()` resolve to the same `src/assets/brand/wordmark.svg`); the `portal.shell.mtb3a-name` spec asserts a cold sign-in load requests `wordmark-*.svg` exactly once; no portal build is added to the gate
History: design review D4 specified a test reading the built `hosted.html`

### Outside voice (eng re-run): factual corrections and carried-forward implementation
OV-1 (API version), OV-2 and OV-3 (test 2 scope), OV-4 (480 px rule), OV-8 (where H lives), OV-9 (spacing matches the kit), OV-10 (literal guard), OV-11 (`hosted.html` lang), OV-12 (unused preload on phones, accepted) and OV-13 (no `forced-color-adjust` on the img) change no approved behaviour. They are recorded in D1, D2, D7 and the Tests list without a question. OV-5, OV-6 and OV-7 are new choices: R4–R6.

### R4: Printing the lockup in the dark theme (outside voice OV-5)
Finding: OV-5, P2, confidence 8/10. Design D5 paints only the logotype with `--m-wordmark-print-ink` and adds no page-wide reset. In a dark-theme printout the live متابعة beside it keeps the dark `--text` (#F4EEE4, `mutaba3a-theme.css:74`) and nearly vanishes on white paper, so the two names print in different colours. Reviewer: Claude Plan subagent (outside voice), checked by the parent against `mutaba3a-theme.css:74`.
Plan baseline: design review D5 (Basel, 2026-10-23): light ink for the logotype in print, no page-wide print reset.
Runtime evidence: static read; not printed.
Comparison grid:
| Choice | Current (D5) | A | B |
|---|---|---|---|
| R4 print colour | logotype in light ink; Arabic name and dot follow the theme (light on paper in dark) | the whole lockup: `@media print { .wordmark { color: var(--m-wordmark-print-ink) } }`; the logotype keeps `currentColor` with `print-color-adjust: exact`, so MTB3A, the dot and متابعة all print in the light ink | keep D5 as approved |
| No page-wide print reset (D5) | approved | unchanged | unchanged |
| `printInk` token (D5) | approved | unchanged | unchanged |
Question D3:
D3 (eng re-run) — In a dark-theme printout, should the whole lockup print in the light ink, not just MTB3A?
Project/branch/task: main, MUT-402; design review D5's print rule.
ELI10: D5 makes MTB3A print in dark ink even when the page is in the dark theme. But متابعة and the dot next to it still use the dark theme's near-white text, so on white paper they almost disappear while MTB3A prints fine. Setting the print ink on the whole lockup prints both names and the dot the same.
Stakes if we pick wrong: a printed dark-theme page shows MTB3A next to an invisible Arabic name.
Recommendation: A because one colour rule on the lockup keeps both names printing together and is simpler than D5's logotype-only background rule
Completeness: A=10/10, B=6/10
Header: Print colour
Options:
A) Whole lockup (recommended)
In print, `.wordmark` gets `color: var(--m-wordmark-print-ink)`; the logotype keeps `background-color: currentColor` with `print-color-adjust: exact`, so MTB3A, the dot and متابعة all print in the light-theme ink. Still no page-wide reset. Test 2's print assertion moves to the `.wordmark` rule. (human: ~15min / CC: ~3min)
B) Keep D5
Only MTB3A prints in the light ink. In a dark-theme printout متابعة and the dot stay near-white on paper.

State: approved
Actual answer: A) Whole lockup (recommended), Basel, eng re-run D3 answer 2026-10-23
Accepted scope: `@media print { .wordmark { color: var(--m-wordmark-print-ink) } }`; the logotype keeps `background-color: currentColor` with `print-color-adjust: exact`; the dot paints `currentColor` in print with `print-color-adjust: exact`; so MTB3A, the dot and متابعة print in the light-theme ink; no page-wide reset; test 2's print assertion targets the `.wordmark` rule
History: design review D5 painted only the logotype in print ink

### R5: The landing page's first visit (outside voice OV-6)
Finding: OV-6, P3, confidence 8/10. D1 says the web app needs no preload because its PWA precaches the file. A first-time landing visitor has no service worker yet, so on that visit the mask is fetched only when React renders the header, and MTB3A paints a moment after the bar. Reviewer: Claude Plan subagent (outside voice), checked by the parent: `index.html` serves both the landing and `/app` (one SPA entry; the social-meta plugin transforms that one file, `vite.config.ts:169-172`), and only the landing header renders a lockup.
Plan baseline: design review D4 (Basel): reserved box everywhere; preload on the portal only; the web app's precache noted.
Runtime evidence: static read; first-visit timing not measured.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R5 landing first visit | unstated: late paint on first visit, no preload | accept it in writing: box reserved (D4), so nothing shifts; repeat visits come from the precache | `<link rel="preload" … crossorigin>` in `index.html` too | React 19 `preload()` (react-dom) called when the landing header module loads |
| Portal preload (D4, R3) | approved | unchanged | unchanged | unchanged |
Question D4:
D4 (eng re-run) — Should the landing page also preload the logotype for first-time visitors?
Project/branch/task: main, MUT-402; the landing header lockup on a visitor's first load.
ELI10: On someone's very first visit to the landing page, the browser hasn't cached the logotype file yet, so MTB3A appears a moment after the rest of the header. Its space is already reserved, so nothing jumps. A preload would fix it, but the landing and the web app share one HTML file, so every app page would also download it and the browser would warn that it went unused.
Stakes if we pick wrong: a brief late paint of the brand for new visitors, or a wasted download and console warning on every app page.
Recommendation: A because the box is already reserved, repeat visits hit the cache, and a shared-file preload costs every app page for a first-visit-only gain
Completeness: A=8/10, B=7/10, C=7/10
Header: Landing preload
Options:
A) Accept, in writing (recommended)
The plan states that first-time landing visitors see MTB3A paint a moment late into its reserved box (no shift), and repeat visits come from the PWA precache. No new code. (human: ~5min / CC: ~1min)
B) Preload in index.html
Add the same `crossorigin` preload to `index.html` plus a source test like test 11. First visits paint on time, but every `/app` page also downloads the file once and Chrome logs "preloaded but not used". (human: ~30min / CC: ~5min)
C) React preload() in landing
Call `preload()` from react-dom when the landing header's module loads, so only the landing asks for it. It starts the fetch only slightly before render, so the gain is small, and it adds a runtime call to test. (human: ~30min / CC: ~5min)

State: approved
Actual answer: A) Accept, in writing (recommended), Basel, eng re-run D4 answer 2026-10-23
Accepted scope: the plan states that first-time landing visitors see MTB3A paint a moment late into its reserved box (no shift) and repeat visits come from the PWA precache; no preload in `index.html`; no new code
History: none

### R6: Which engines the one-request check covers (outside voice OV-7)
Finding: OV-7, P3, confidence 6/10 (medium: Safari's CORS mode for `-webkit-mask-image` was not checked). R3's QA check that a cold sign-in fetches `wordmark-*.svg` once runs only in Chromium: `qa/playwright.config.ts:18` uses `devices['Desktop Chrome']` for every app, and only Chromium is installed. If Safari fetched the mask without CORS, the `crossorigin` preload would make it download twice there. Reviewer: Claude Plan subagent (outside voice), checked by the parent against the QA config.
Plan baseline: R3 (Basel, eng re-run D2): source contract test plus a one-request QA check.
Runtime evidence: QA config read; Safari behaviour unknown.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R6 engine coverage | unstated (Chromium, implicitly) | state "Chromium only" in the plan; a Safari double fetch would cost 9.6 KB once per cold visit, then the immutable cache | add a WebKit Playwright project for this one portal check (installs WebKit, a new QA project) |
| R3 source test + Chromium check | approved | unchanged | unchanged |
Question D5:
D5 (eng re-run) — Should the "fetched once" check also run in Safari's engine?
Project/branch/task: main, MUT-402; R3's QA network check on portal sign-in.
ELI10: The check that the portal downloads the logotype only once runs in Chrome's engine, because release QA only runs Chrome. Safari might handle the preload differently and download the file twice. That would cost 9.6 KB once per new visitor before the cache takes over, and nothing would break visibly.
Stakes if we pick wrong: a silent extra 9.6 KB download in Safari, or new QA infrastructure for one check.
Recommendation: A because the worst case is one small cached download, and adding a WebKit project to release QA is a bigger change than this ticket
Completeness: A=8/10, B=9/10
Header: Engine coverage
Options:
A) Chromium only, stated (recommended)
The plan states the one-request check is Chromium-only and that a Safari double fetch, if it exists, costs 9.6 KB once per cold visit. No new QA project. (human: ~5min / CC: ~1min)
B) Add a WebKit project
Add a WebKit Playwright project to `qa/playwright.config.ts` and run the one-request check there too. Covers Safari, but installs WebKit and adds a second engine to release QA for one check. (human: ~2h / CC: ~20min)

State: approved
Actual answer: A) Chromium only, stated (recommended), Basel, eng re-run D5 answer 2026-10-23
Accepted scope: the plan states the one-request check is Chromium-only and that a Safari double fetch, if it exists, costs 9.6 KB once per cold visit; no WebKit project
History: none

Approval readiness (eng re-run): PASS. Checked R2 (D1), R3 (D2), R4 (D3), R5 (D4), R6 (D5), all Basel's answers of 2026-10-23. The OV-1–4 and OV-8–13 corrections cite the approved decisions they implement (D1, D2, D7, D10, D12, R2).

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
- One new asset, about 9.6 KB (8 KB of it the C2PA manifest), is emitted to `/assets/` and cached immutable. The web app's PWA precaches it. **Corrected in design review D4:** the portal build (`hostedConfig()` in `vite.config.ts`) has no PWA, so the portal fetches it on first render; `hosted.html` preloads it (D1, loading state). There are no new requests per page beyond that one file.

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

- [ ] **T1 (P1, human: ~2h / CC: ~20min)** — brand — `Logotype`/`BrandName`, `Logotype.css`, lockup tokens and drift, `Wordmark` gap and the per-surface mark sizes 32/40/32/30 (R1, design review D3)
  - Verify: `npx vitest run src/components/brand src/styles/__tests__/brand.test.ts`
- [ ] **T2 (P1, human: ~2h / CC: ~15min)** — copy — the English translations, the Arabic `header.wordmark*` retirement, `hosted.html` title, portal `useDocumentTitle`, the guard test (D3–D5)
  - Verify: `npx vitest run src/lib/i18n`
- [ ] **T3 (P1, human: ~1h / CC: ~10min)** — server — title, next patch after `main`'s `API_VERSION` (`1.52.1-mut402` today, OV-1), three messages, OpenAPI regen (D7)
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

## Design review (2026-10-23, /plan-design-review, target: this file)

Prior learning applied: wordmark-one-mask-file (MUT-401 eng D7). Its `var(--ink)` wording was wrong: `--ink` does not exist (D6).

- **Scope:** all 7 passes over the landing header lockup and the portal lockup (sign-in, setup, terms-update, boot screens, sidebar).
- **System audit:** no `DESIGN.md`; the system is the brand v2 kit (`docs/brand/README.md`), `mutaba3a.tokens.json` and the Wordmark Kit (`docs/brand/wordmark/README.md`).
- **Mockups:** none. The design binary has no OpenAI key; the review worked from code measurements.
- **Outside voice:** codex is not installed. An in-host Claude subagent reviewed the plan and the code and completed: 1 critical, 4 high and 6 medium findings. C1 and M4 were checked against the code before they were raised (`theme.css:150`; `vite.config.ts:406` vs `:495`).

### Passes

| Pass | Before | After | What changed |
|---|---|---|---|
| 1 Information architecture | 6 | 9 | Per-surface mark sizes; brand one step below the sign-in h1 (D3) |
| 2 Interaction states | 4 | 9 | Loading: reserved box and preload (D4); print in light ink (D5) |
| 3 Journey | 8 | 9 | No new issue; storyboard recorded below |
| 4 AI slop | 9 | 9 | No issues. Header is Persuade, portal is Operate; no hard rejection; the look is the existing brand v2 |
| 5 Design system | 4 | 9 | `currentColor` (D6), one size source in px (D7), old CSS retired (D8), mask box pinned (D9), separator floor (D10) |
| 6 Responsive and a11y | 5 | 9 | Forced colours follow the text (D11), 480 px pinned plus 320/360 QA (D12), `lang` and optical check (D13) |
| 7 Decisions | | | 2 resolved (D14 dot colour, D15 mark ring), 0 deferred |

Not 10: no mockup was rendered (P1, P4), and the Arabic optical offset is known only after the D13 screenshot (P5, P6).

### Decisions (design review)

| # | Finding | Decision |
|---|---|---|
| D3 | H1: one 30 px size shrinks the Arabic name | Pin per surface: landing 32, portal sign-in/setup/terms-update/boot 40, sidebar 32, default 30 |
| D4 | M4: the portal has no PWA, so the mask loads late | Reserve the box, never paint an ink rectangle, preload with `crossorigin` in `hosted.html` |
| D5 | M3: dark-theme print loses the logotype | `printInk` token, light ink in `@media print` on the whole lockup (eng re-run R4) |
| D6 | C1: `var(--ink)` does not exist | `currentColor`; README and ADR-171 corrected |
| D7 | H2: two sources for M, unitless value | `markSize` prop only, written in px, `var(--wordmark-mark, 30px)` fallback |
| D8 | H3: old lockup CSS fights the tokens | Delete list; `BrandName ar` sets its own type and `lang="ar"` |
| D9 | H4: mask box under-specified | `inline-block`, `flex: none`, explicit width/height, mask size/repeat/position with `-webkit-` twins |
| D10 | M1: 2 px separator | `max(0.16H, 3px)`, round, kit exception recorded |
| D11 | M2: forced colours split the names | `currentColor` with `forced-color-adjust: none`; emulation check |
| D12 | M5: phone widths unspecified | 480 px pinned; QA at 320/360; portal phone shell stays brandless |
| D13 | M6: Arabic sits by line box; no `lang="en"` | Screenshot against the kit, `arabicOffset` token only if needed; `lang="en"` on the logotype |
| D14 | New from D11: the dot alone stays `CanvasText` | The dot uses `currentColor` too |
| D15 | M2 note: the mark fades in high contrast | Fixed here: a 1 px `CanvasText` ring on lockup marks in forced colours (square, per eng re-run R2) |

### Interaction states

| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Logotype (all surfaces) | Box reserved at full size, nothing painted until the mask arrives; preloaded on the portal (D4) | n/a: always the same name | Mask blocked: an empty box of the right size, the accessible name still "MTB3A", the Arabic name and the mark still shown | Mask in `currentColor` | Dark theme follows `--text`; forced colours follow the text (D11); print uses light ink (D5) |
| Landing lockup | Mark is an `<img>` with width/height, so it holds its space | n/a | n/a | Mark, MTB3A, dot, متابعة in `dir` order | Phones at 480 px and below: mark plus the active language's name (D12) |
| Portal lockup | Same as the logotype | n/a | n/a | Mark at 40 px on sign-in and boot, 32 px in the sidebar | 760 px and below: the shell shows no lockup, as today |

### Journey storyboard

| Step | User does | User feels | Plan specifies |
|---|---|---|---|
| 1 | An Arabic reader opens the landing page | "Same place, same name" | متابعة at today's 16 px, the mark first (D3) |
| 2 | An English reader opens it | "The name is MTB3A, I can say it" | Logotype at H 12.8, then متابعة (D1, D3) |
| 3 | Opens portal sign-in, cold | "This is the real site" | Brand at M 40 without pop-in or shift (D3, D4), one step below "Sign in" |
| 4 | Signs in, works at a desk | Brand recedes | Sidebar lockup at 32 (D3) |
| 5 | Uses high contrast or a screen reader | Nothing is missing | One colour across the lockup, ring on the mark, each name read in its own language (D11, D13–D15) |
| 6 | Prints a page in the dark theme | The printout is complete | Light ink in print (D5) |

### NOT in scope (design)

- A brand in the portal's phone top bar (D12): a layout change beyond the rename.
- Standalone marks outside a lockup (boot splash, loader) in high contrast (D15 covers lockups only).
- Per-page portal tab titles (already out of scope, D3).

### What already exists

- `Wordmark` and `BrandMark` (`src/components/brand/`), reused with a `markSize` prop.
- The `markDot` token, `--text`/`--m-ink` theming and the `resolvedTheme` mark switch.
- The 480 px and 760 px breakpoints in `LandingPage.css` and `hosted.css`.
- The bar's 12 px padding already meets the 1 H clear space; the phone tap targets stay 44 px.

### TODOS.md updates

None. The one candidate, the mark in high contrast, Basel chose to build here (D15).

### Implementation tasks (design review)

- [ ] **T7 (P1, human: ~2h / CC: ~15min)** — brand — `Logotype.css`: `currentColor`, the pinned box, the forced-colours block (logotype, dot, square mark ring per R2), whole-lockup print ink (R4), the separator floor as a token, the `lang` attributes, H declared on `.wordmark` and the logotype only, the literal guard green (D6, D8–D11, D13–D15; eng re-run R2, R4, OV-2/3/8/10/13)
  - Files: `src/components/brand/Logotype.tsx`, `Logotype.css`, `__tests__/Logotype.test.tsx`
  - Verify: `npx vitest run src/components/brand` (tests 2, 3, 13–15)
- [ ] **T8 (P1, human: ~1h / CC: ~10min)** — brand — one size source: `markSize` in px, the portal `Brand.tsx` prop (default 40, sidebar 32), sizes 32/40/32/30, the retired CSS and its replacement 480 px `.wordmark-other` rule; update `LandingHeader.test.tsx`, `Brand.test.tsx`, `Wordmark.test.tsx` (D3, D7, D8, D12; OV-4)
  - Files: `Wordmark.tsx`, `LandingHeader.tsx`, `LandingPage.css`, `src/hosted/components/Brand.tsx`, `hosted.css`, tests
  - Verify: tests 12 and 13
- [ ] **T9 (P1, human: ~45min / CC: ~10min)** — portal — the `hosted.html` preload and its source contract test; the one-request QA check; the corrected performance note (D4, eng re-run R3)
  - Verify: test 11 in `npx vitest run src/components/brand`; the `portal.shell.mtb3a-name` spec on a preview build
- [ ] **T10 (P2, human: ~1h / CC: ~10min)** — tokens and docs — `printInk` (and `arabicOffset` only if D13 needs it) in the token block and drift test; README lines 26 and 65; ADR-171 amendment; the separator exception (D5, D6, D10, D13)
  - Verify: `npx vitest run src/styles/__tests__/brand.test.ts`
- [ ] **T11 (P1, human: ~1h / CC: ~15min)** — release-qa — 320/360 px runs in both languages, the desktop-width sidebar step, forced-colours emulation, the screenshot against the kit (D11–D13, D15)
  - Verify: `release-qa run --attach --only mtb3a-name` on a preview build

## Design Review Completion Summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | no DESIGN.md; brand v2 kit + tokens; lockups |
  | Step 0               | 6/10; all 7 dimensions                       |
  | Pass 1  (Info Arch)  | 6/10 → 9/10 after fixes                      |
  | Pass 2  (States)     | 4/10 → 9/10 after fixes                      |
  | Pass 3  (Journey)    | 8/10 → 9/10 after fixes                      |
  | Pass 4  (AI Slop)    | 9/10 → 9/10 after fixes                      |
  | Pass 5  (Design Sys) | 4/10 → 9/10 after fixes                      |
  | Pass 6  (Responsive) | 5/10 → 9/10 after fixes                      |
  | Pass 7  (Decisions)  | 2 resolved, 0 deferred                       |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (3 items)                            |
  | What already exists  | written                                      |
  | TODOS.md updates     | 0 items proposed (D15 built here)            |
  | Approved Mockups     | 0 generated, 0 approved (no OpenAI key)      |
  | Decisions made       | 13 added to plan (D3–D15)                    |
  | Decisions deferred   | 0                                            |
  | Overall design score | 4/10 → 9/10                                  |
  +====================================================================+
```

Plan is design-complete. Run /design-review after implementation for visual QA.

### Unresolved Decisions

None.

## Eng review re-run (2026-10-23, after design review D3–D15)

Prior learning applied: no-ink-token-use-currentcolor (confidence 10/10, from 2026-10-23).

**Scope:** the design review's additions (D3–D15). The structure answer (B, smaller arrangement) is reused; the design review added no files or classes.

**Reality rows (design delta):**
- REALITY: premise-table pass, unverified=1 (Safari mask CORS mode, R6). Receipt: `qa/playwright.config.ts:18`.
- REALITY: already-done pass. No `Logotype*` file exists; `main` moved by 2 doc commits since `53d5b78e`. Receipt: `src/components/brand/Wordmark.tsx:21`.
- REALITY: surface-check finding. `npm run build` does not build the portal. Receipt: `package.json:11` vs `:14`. Resolved by R3.
- REALITY: binding-decisions finding. `API_VERSION` on `main` is `1.52.0-mut362`, so the plan's `1.51.1` is stale. Receipt: `server/src/app.ts:173`. Corrected by OV-1.
- REALITY: numbers pass. 9,620 bytes measured (`ls -la`); the 239/288 px phone widths are [estimated] and proven by the D12 QA run. Receipt: `src/assets/brand/wordmark.svg`.
- REALITY: deferred-asks pass. No new ticket asks.
- REALITY: pr-count pass. One branch.

**Section 1, Architecture**
- [P1] (confidence 9/10) `src/assets/brand/mark.svg`: `<path d="M2 98 A44 44 0 0 1 46 54 A44 44 0 0 1 2 98 Z">` puts the petal tip at (2, 98), outside a 50-unit circle, so D15's `border-radius: 50%` would clip it. Approved fix: R2, a square ring.
- Dispositions: E1 accepted (D1).

**Section 2, Code quality.** No new issues. Factual corrections:
- the portal `Wordmark` defaults to 40, and only `HostedShell.tsx:48` passes 32;
- the existing tests that pin the retired classes are `LandingHeader.test.tsx:48,49,83`, `Brand.test.tsx:33,41` and `Wordmark.test.tsx:23`.

**Section 3, Tests**
- [P2] (confidence 9/10) `package.json:11` `"build": "tsc -b && vite build"` builds only the web app, so test 11 as written could not run. Approved fix: R3.
- Dispositions: E2 accepted (D2).

```
CODE PATHS (design delta)                              USER FLOWS
[+] Logotype.css                                       [+] Landing header
  ├── [PLANNED ★★★] mask, box, currentColor  (t2)        ├── [PLANNED →E2E] en/ar order, 320/360 px (QA)
  ├── [PLANNED ★★ ] forced colours: logotype, dot, ring  ├── [PLANNED →E2E] forced-colours colour match (QA)
  │                 (t2, t14, t15) + QA emulation         └── [PLANNED →E2E] screenshot vs kit (QA, D13)
  ├── [PLANNED ★★ ] print ink on .wordmark (t2, R4)    [+] Portal sign-in
  └── [PLANNED ★★ ] retired CSS + 480 px rule (t13)       ├── [PLANNED →E2E] one wordmark request, Chromium (R3/R6)
[+] Wordmark / Brand.tsx                                  └── [PLANNED →E2E] sidebar at desktop width
  ├── [PLANNED ★★★] markSize → px, defaults 30/40 (t12)
  └── [GAP→fixed ] old class tests rewritten (Files)
[+] hosted.html preload
  └── [PLANNED ★★ ] source contract (t11, R3)
COVERAGE: every delta path has a planned test; forced colours, print and engine CORS are browser-only (QA or manual)
```

Tests made obsolete: `LandingHeader.test.tsx:48,49,83` (rewritten to test 4) and `Wordmark.test.tsx:23` (24 px is under the floor).

**Section 4, Performance.** No issues. One 9.6 KB immutable asset. The preload is used on the portal's cold path, and the unused-preload warning on phones is accepted (OV-12).

**Outside voice:** Claude Plan subagent (codex not installed). It completed in 2.5 minutes, within the 5-minute timer, with 13 findings (1 critical, 4 high, 5 medium, 3 low). OV-1–4 and OV-8–13 were recorded as corrections. OV-5, OV-6 and OV-7 were decided as R4, R5 and R6.

**Failure modes (delta):**
- **Mask blocked:** the box is reserved and empty, and the accessible name stays (tested).
- **Preload and CSS name different files:** caught by test 11.
- **Safari double fetch:** silent, about 9.6 KB once per cold visit, accepted (R6).
- **H declared on `:root`:** every lockup renders at 30 px; caught by test 12 (OV-8).

None is silent with no test and no handling, apart from the accepted R6 case. **0 critical gaps.**

**Parallelization:** sequential implementation, no parallelization opportunity. The CSS, components and tests share `src/components/brand`.

**NOT in scope (re-run):** a WebKit QA project (R6); a landing preload (R5).

**Unresolved decisions:** none.

**Completion summary (re-run):**
- Step 0: scope accepted as-is (structure B reused).
- Reality rows: 7/7 tier 1 rows emitted, 1 unverified premise (Safari CORS).
- Architecture review: 1 issue found.
- Code quality review: 0 issues found.
- Test review: diagram produced, 1 gap identified.
- Performance review: 0 issues found.
- NOT in scope: written.
- What already exists: unchanged from the design review.
- TODOS.md updates: 0 items proposed.
- Failure modes: 0 critical gaps flagged.
- Unresolved decisions: 0 in this review.
- Outside voice: in-host Claude Plan subagent, completed (codex not installed), 13 findings.
- Parallelization: 1 lane, sequential.
- Lake Score: 3/5 (D1 and D2 picked the 10/10 option; D3 picked the 10/10 option; D4 and D5 took 8/10 options).

## Build notes (2026-10-23, /eng-build, branch feature/mut-402-mtb3a-web-copy)

Where the build differs from the text above, and why:
- **Forced colours (D11, D14):** the plan's `currentColor` with `forced-color-adjust: none` failed its own QA check. Opted out of forcing, `currentColor` is the unforced ink in Chromium, so MTB3A came out plum beside a LinkText-blue متابعة. The logotype and the dot now name the system colour their live text gets: `LinkText` (`VisitedText`) inside a link, `CanvasText` elsewhere. The approved outcome (one colour across the lockup) holds and is tested in both QA specs.
- **The default M (D7, OV-3):** `var(--wordmark-mark, 30px)` would trip the literal guard through `--wordmark-h`, so the fallback is derived from tokens: `--m-wordmark-min-height / --m-wordmark-logotype-to-mark` (= 30px).
- **The link's accessible name:** the lockup's items are inline spans, so the name read "MTB3Aمتابعة". Plain spaces between them fix it; flex layout drops whitespace-only text, so nothing shifts.
- **Grammar:** English says "an MTB3A" (read letter by letter), in 7 places.
- **QA tab-title step:** the /app shell sets no tab title (TD-207), so `web.brand.mtb3a-name` checks `common.pageTitle` on /download instead of the app's Home.
- **Portal title:** `PortalTitle` sets `document.title` with its own effect, because the portal may not import the app's hooks (hosted-portal.md §8, lint).
- **Found, older than this:** the 375px English landing bar clips the lockup when the header button shows (TD-206; 110px in 90px on main, 105px here).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex not installed → in-host Claude Plan subagent | Independent 2nd opinion | 56 | completed in host (no external provider) | 13 findings, 1 critical (all dispositioned) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 60 | ISSUES OPEN | 2 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 14 | CLEAR | score: 4/10 → 9/10, 13 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase: unavailable (not installed). The native Claude Plan subagent completed with 13 findings. That is in-host coverage, not external. Design phase: the in-host Claude subagent completed earlier today (11 findings).
- **VERDICT:** DESIGN CLEARED. ENG: ISSUES OPEN (2 findings, both resolved by R2 and R3; the outside voice's 13 are resolved or decided), ready to implement. Eng review required.

NO UNRESOLVED DECISIONS
