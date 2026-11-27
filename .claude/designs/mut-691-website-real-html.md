# MUT-691 — The website serves its pages as real HTML to search engines

Epic MUT-690 (public help centre). Planned 2026-11-27 with `/eng-ticket`. **Plan only, no code.** Status when planned: Backlog, no `is blocked by` links. It blocks MUT-692 (help shell) and so every help page. Absorbs MUT-547 (robots + sitemap) and the WO-2 part of MUT-552; MUT-552's version file (WV-3), CSP (WX-4) and Sentry DSN (WE) stay there.

## What exists today (verified in the code)

- The website is one Vite SPA, `vite build --mode web` → `dist-web`. `src/main.tsx` routes by hand: `/`, `/privacy`, `/terms`, `/terms/:version` (`landingRoute`, `src/pages/landing/marketingPath.ts`). Anything else runs `window.location.replace("/")`.
- `netlify.toml` ends with `/* → /index.html 200`, so every unknown path answers 200 with the shell (a soft 404). `/robots.txt` and `/sitemap.xml` fall through to the shell too.
- `index.html` has a `<title>` only. `socialMeta()` injects Open Graph tags for the home page in Arabic only (crawlers run no JavaScript, so a card has one language; MUT-104). `withPageMeta()` (swap title, OG tags, add canonical) exists and is tested but nothing calls it.
- Language is client state: `LanguageProvider` (Arabic by default, stored on choice) and a `?lang` link override on the legal pages that is never stored (`src/lib/i18n/linkLanguage.ts`, MUT-356). There is no per-language URL, so hreflang is impossible today.
- Deploys: `make release web` / `make deploy web` → `scripts/netlify-deploy.sh` → `release-gate web mini-crm web` (clean checkout of local main, built locally through the heavy queue with netlify.toml's build command, Netlify draft smoked, then production smoked). Netlify Git builds are off. The smoke list is in `release/gate.config.mjs`; `/privacy` and `/terms` expect `<div id="root">`.
- Gate rules this ticket must satisfy (`~/Work/tools/release-gate/docs/web-release-standard.md`): **WO-1** robots.txt allows crawling and names the sitemap, every sitemap URL returns 200. **WO-2** every sitemap page has a title, a meta description, a canonical URL on the production host, OG tags, and hreflang for each locale in the gate config (`locales: ['ar','en']`).
- `scripts/check-bundles.ts` / `bundle-rules.ts` guard `dist-web`: no portal strings, allowed origins, and **`bootSplashProblems` requires every built entry HTML to open `#root` with the boot splash**. A prerendered page fails that rule as written.
- `config/hosts.json` is the only place hosts may be written (`no-hardcoded-hosts` test). Telemetry is runtime-gated to the production host (ADR-236), so a build visited on 127.0.0.1 sends nothing.
- Dependencies present: React 19.2, Vite 7, `@playwright/test` (browsers are installed locally for release-QA), `tsx`, `jsdom`.

## Decisions to take (recommendation first)

**D1 How pages become real HTML. Decided: A (the snapshot).** It is a technical choice with no visible difference for a visitor, so it is taken by default on 2026-11-27 under the rule that plans take the recommended option unless a UI, flow or journey choice is involved. Basel can still override it before the build.
- **A (recommended): a build-time browser snapshot.** After `vite build`, a script serves `dist-web`, opens each page in headless Chromium (fresh context, light colour scheme, telemetry off by host), saves the rendered HTML to `dist-web/<path>/index.html`, and fails the build if any page lacks its text or touches a third-party origin. The client still takes over with `createRoot` (no hydration). Why: zero refactor of the landing and legal pages, which read `window`, `localStorage`, `matchMedia` and device hints while rendering; the same code path users see; works for any page the help shell adds. Cost: Chromium becomes part of the local release build (it already is on this Mac for release-QA); about 30 to 60 s added; a missing browser fails loudly, never ships unrendered pages.
- **B: real server rendering** (`react-dom/static` in a Vite SSR build, then `hydrateRoot`). No browser, deterministic, faster, proper hydration. But every landing component must become SSR-safe first, a refactor with real regression risk on the pages that carry signups. Keep as a later step if build time or flakiness bites.
- **C: static HTML only for new help pages.** Leaves the landing and legal pages unrendered; rejected because the Arabic home page is part of the goal.

**D2 One URL per language (hreflang needs it).** Arabic stays at the root (`/`, `/privacy`, `/terms`, `x-default` = Arabic). English goes under `/en/…` (`/en/`, `/en/privacy`, `/en/terms`). Hebrew (`/he/…`) is added by the help stories, not here, but the structures take any locale. The language in the path wins over a stored preference and is never stored, the same rule `?lang` already follows on the legal pages. `?lang` keeps working for the apps' links (MUT-356); its canonical is the path form.

**D3 A real 404.** Remove the catch-all rewrite. Netlify serves a static `404.html` with status 404 for anything that is not a file. Every route has a real file: `/terms/<version>` is prerendered for each released version in the terms manifest (frozen documents, so they exist at build time). Existing redirects (`/download`, `/app`, `/hosted`) and `_redirects` stay. `main.tsx`'s `location.replace("/")` stays only as a client-side fallback.

**D4 One page registry feeds everything.** `src/pages/landing/seo/pages.ts` lists each page once: path template, languages that exist, title and description i18n keys, whether it is in the sitemap. The prerender script, the sitemap, the head builder and `landingRoute` (the "one list of website pages", MUT-150 D7) all read it, so a page cannot ship without its tags. The MUT-692 shell adds help pages by adding registry entries.

## Plan

Layers and files (new unless marked):

1. **Registry and head builder (pure, tested first).**
   - `src/pages/landing/seo/pages.ts`: the registry (D4).
   - `src/pages/landing/seo/head.ts`: from `(page, language, origin)` returns title, description, canonical, the full hreflang set (self, every alternate, `x-default`), `og:*` and `twitter:*` including `og:locale` per language. Extends `socialMetaTags` / `withPageMeta` in `vite.config.ts` (move shared logic into this module; keep the Arabic share card image for every language, an English card is out of scope). Throws on a non-https origin as today.
   - i18n keys for each page's title and description in `src/lib/i18n/translations/{ar,en}` (run `scripts/check-i18n-keys.ts`).
2. **Routing by path language.** Modify `marketingPath.ts` (`landingRoute` returns route and language, strips the `/en` prefix), `src/main.tsx` and `LandingProviders.tsx` (initial language from the path, not stored), reusing `linkLanguage.ts`.
3. **Generated files.** A Vite plugin `mutaba3a:seo-files` (next to `legalTermsManifest` in `vite.config.ts`, or in `scripts/` and imported) emits `robots.txt` (allow all, `Sitemap:` line), `sitemap.xml` (every registry page marked in-sitemap, `xhtml:link` alternates, origin from `HOSTS.landingOrigin`) and `404.html`. Terms versions are prerendered but left out of the sitemap.
4. **Prerender.** `scripts/prerender-web.ts` (run by `tsx`): static-serve `dist-web`, loop registry × languages with a small concurrency, fail on any request outside the local origin, write `dist-web/<path>/index.html` with the per-page head from step 1 and real `lang` and `dir` on `<html>`. `package.json`: `build:web` = `tsc -b && vite build --mode web && tsx scripts/prerender-web.ts`, so `netlify.toml`'s command and the gate pick it up with no further wiring.
5. **Guards.** `scripts/bundle-rules.ts` / `check-bundles.ts`: the shell `index.html` must still open with the splash; prerendered pages are checked instead for the head set (one title, description, self canonical, reciprocal hreflang, one `h1`), the existing forbidden-string rules applied to the HTML, and sitemap parity (every sitemap URL is a file, every registry page is in `dist-web`). Tests in `scripts/__tests__`.
6. **Hosting.** `netlify.toml`: drop the `/* → /index.html 200` rule and keep the security headers; `release/gate.config.mjs`: add smoke checks for `/robots.txt` (text `Sitemap:`), `/sitemap.xml`, `/en/` (text `lang="en"`), `/privacy` still `<div id="root">`, and an unknown path expecting 404.
7. **Docs and operator step.** ADR in `.claude/DECISIONS.md` (prerender by snapshot, path languages, real 404), `CHANGELOG`, `SYSTEM_OVERVIEW` (website section), `TEST_PLAN`, `TECH_DEBT` (no hydration; legacy host duplicate), and `docs/operations/before-release.md`: verify the domain in Search Console and submit the sitemap after the first release.

## Tests (write first)

Run with Node 22 and through `~/Work/tools/heavy-gate/heavy`: `npm run lint`, `npm run typecheck`, `npx vitest run scripts/__tests__ src/pages/landing` (affected files while iterating), `npm run build:web`, `npx tsx scripts/check-bundles.ts --dist dist-web`, then `make deploy-check`.

| Criterion | Cases |
|---|---|
| Real text in the source | the prerendered `/` and `/en/` contain their hero text and one `h1` with scripts not run; `<html lang dir>` match the language |
| Unknown path is a 404 | a built `404.html` exists; no catch-all rewrite in `netlify.toml` (test reads the file); every registry route has a file |
| Canonical, title, description, OG per page and language | head builder: Arabic and English for each page; hreflang is reciprocal and includes `x-default`; non-https origin throws; no host outside `HOSTS` |
| Sitemap and robots | XML-escaped, alternates present, only in-sitemap pages, origin from `HOSTS`; robots names the sitemap and allows crawling |
| No portal code, no guard regression | `LOCAL_RULES` over every prerendered file; the shell still opens with the splash; the prerender fails when a page makes a third-party request |
| Language by path | `/en/privacy` renders English without storing it; `/privacy?lang=en` still works and does not store |
| Release-QA (web) | `qa/features/web/seo.yaml` plus `qa/specs/web/seo.spec.ts`: `web.seo.rendered-without-js` (a no-JavaScript context shows the Arabic home text), `web.seo.sitemap-and-robots`, `web.seo.unknown-404`, `web.seo.english-url` (the `/en/` page shows English and links its Arabic alternate); each wrapped in `step(...)`, `release-qa lint` clean |

## Quality bar

- **DRY:** one registry, one head builder; `socialMetaTags` and `withPageMeta` are extended, not copied; the language rule is the existing link-language rule.
- **Scalable:** build time grows linearly with pages × languages (about 1 s a page, a few in parallel); the help centre's roughly 50 pages stay under a minute.
- **Cost:** Netlify is static; no new service; the only new cost is build time.
- **Constraints met:** the website bundle still carries no portal code (guard extended, not relaxed); Arabic first and right to left; hosts only from `config/hosts.json`; telemetry still off for the snapshot by host and checked by the no-third-party-request rule; UI copy is untouched (meta text is not interface copy).

## Risks and what the ticket missed

1. **The legacy host still serves pages.** At stage `live`, `mutaba3a.netlify.app` answers the same pages. Canonical tags point to the apex, which handles duplicates; a `noindex` for the old host (WO-3) is not solvable in netlify.toml alone. Tracked as TD, resolved by the `redirect` stage of the domain move.
2. **The boot-splash guard** has to be reshaped (step 5); easy to miss.
3. **Hebrew and the gate:** `release/gate.config.mjs` lists locales `ar, en`; the help stories add `he`, and the gate (outside this repo) must accept a locale that only some pages have. Confirm with the gate before MUT-692 ships Hebrew.
4. **No hydration:** the client replaces the snapshot on load. Verify there is no visible jump (screenshot comparison in the QA spec); hydration is the follow-up if there is.
5. **Terms versions** are prerendered from the manifest; a new version must be in the manifest before build (it already must be, for the server preflight).

## Scope check against the ticket

All six acceptance criteria are covered: real HTML (step 4), 404 (D3), per-page tags (step 1), sitemap, robots and hreflang (step 3), bundle guard (step 5), release-QA flow (tests). Search Console verification is the operator step in step 7. Nothing beyond the ticket except the gate smoke list, which the gate rules require.

## Business / product impact

- Without this, every help page would be invisible to anything that does not run JavaScript, and Google would see unknown paths as live pages; the help centre could not be found.
- It sits first in epic MUT-690 and unblocks the help shell (MUT-692), structured data (MUT-693) and all three content clusters. It also clears two gate rules (WO-1, WO-2) that today flag the website.
- Risk is contained: static hosting, no runtime change for visitors, and a build that fails loudly instead of shipping pages without text.
