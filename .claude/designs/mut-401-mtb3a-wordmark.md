# MUT-401 — MTB3A wordmark and name typography (plan)

Epic: MUT-400 (rename: English always **MTB3A**, Arabic always **متابعة**; the icon and the mark don't change).
Blocks: MUT-402 (web), MUT-403 (phone), MUT-404 (stores). Relates: MUT-101 (Brand v2).
Status at planning: Backlog, no blockers. Planned 2026-10-22.

## Two halves

1. **Design (Basel, in Claude Design project 160fbfa7…).** Produces the files in "What to export" below. Not code.
2. **Import (engineering, this repo).** Commits the export, pins it with tests and writes the spec (lockup tokens moved to MUT-402, eng review D1). No surface changes: wiring the logotype into the landing page and portal is MUT-402.

Nothing in the import can start until the export exists. This session could not read the Claude Design project: the design tool only runs inside `/design-sync`. So this plan doesn't assume anything about the drawing itself.

## What to export from Claude Design (the hand-off contract)

| File | Purpose | Notes |
|---|---|---|
| `wordmark.svg` | Latin logotype "MTB3A", one file for both themes | **Outlines only** (no `<text>`, no fonts). One opaque fill, any colour: it is used as a CSS mask, and the ink comes from CSS (eng review D7). No dark variant. **Frame:** viewBox runs from cap height to baseline and from the first to the last ink, zero padding; the overshoot of B and 3 stays inside (eng review D8). |
| Lockup spec (numbers) | Logotype cap height vs. mark size, gap, clear space, minimum sizes | README numbers now, tokens in MUT-402 (D3); not baked lockup files. |
| Running-text rule | Font, weight, all caps, display letter-spacing | A README rule (D4). |
| `feature-graphic-en-1024x500.png` (+ its `.dc.html` source) | Play feature graphic template | Kit only; MUT-404 uses it. |
| Screenshot header style (`.dc.html` or PNG reference) | Header treatment for store frames | Kit only; MUT-404 uses it. |
| Lockup previews (PNG): mark + MTB3A, mark + متابعة, bilingual, LTR and RTL, light and dark | Review artefact | Kit only. |

The Arabic name is **not** redrawn. It stays live text in Thmanyah Serif Display, as today (D2).

## Decisions

- **D1. Where files live.**
  - The shipping SVG goes to `src/assets/brand/wordmark.svg`, next to `mark.svg` (one file, D5). Once MUT-402 imports them they're bundled, so the portal serves them from its cached `/assets/`, as ADR-073 and MUT-104 already do for the mark. Until then nothing bundles them (OV-11). An export under Vite's 4 KB `assetsInlineLimit` would be inlined as a `data:` URL, which `img-src 'self' data:` allows; the C2PA manifest normally keeps the file above that.
  - Everything that doesn't ship goes to `docs/brand/wordmark/`: the spec README, store templates, previews and Claude Design sources.
  - This narrows the ticket's "files under `docs/brand/wordmark/`". It keeps one copy of each shipping file, so MUT-402 imports it rather than copying it, and the copies can't drift. Approved by Basel (eng review D3); a comment on MUT-401 records it.
- **D2. Only the Latin logotype is a drawn asset. Lockups are composed in code.**
  - Today's `Wordmark` is `BrandMark` plus a name node. It keeps that shape: MUT-402 passes the logotype `<img>` as `name`.
  - The mark keeps its own theme-aware files, and the bilingual order follows `dir` (flex), so no per-direction lockup files exist.
  - Arabic stays live text, so there is no new Arabic asset.
- **D3. Lockup proportions are written down here; they become tokens in MUT-402 (eng review D1).**
  - MUT-401 records them in `docs/brand/wordmark/README.md`: logotype height relative to the mark, gap, clear space (as a multiple of logotype height), and minimum logotype height in px.
  - MUT-402 adds the `wordmark` block to `mutaba3a.tokens.json`, the `--m-wordmark-*` primitives and the drift case, together with the CSS that first reads them.
- **D4. Running text.**
  - Copy writes "MTB3A" as plain capitals in the surrounding face, with no wrapper markup. i18n strings can't carry per-word styling, and Thmanyah Sans has the Latin caps and the digit 3. The figure stack (`--m-font-num`) applies only to figure cells, so the "3" can't fall back to Plex Mono in prose.
  - The display letter-spacing from the design is recorded in the README. MUT-402 turns it into a token if any heading-sized live string of the name remains once the logotype is used.
- **D5. One file, coloured by CSS (eng review D7, replaces "two colour files").** `wordmark.svg` is a stencil: MUT-402 shows it as `mask-image` over `background-color: var(--ink)`, so it follows the in-app theme and any ink change with no second file. MUT-402 owns the rendering rules this needs: `role="img"` with an `aria-label` ("MTB3A"), `@media (forced-colors: active)` painting it `CanvasText` with `forced-color-adjust: none`, and a print rule so it isn't dropped with background graphics. `-webkit-mask-*` is included for Safari. The portal CSP allows it (`img-src 'self' data:` covers mask URLs).
- **D6. Delivered bytes stay as delivered.** Claude Design stamps a C2PA manifest into its SVG exports. `mark.svg` ships with it, so the wordmark does too. No minifying or re-saving.
- **D7. Thmanyah licence.** If the logotype is outlined from Thmanyah glyphs, that may count as "modification", which the licence forbids. Add it to the pending ask@thmanyah.com request (brand-v2 decision 4). It's a guardrail, not a blocker, and the decision isn't re-argued here. If Basel draws the letters from scratch, the point is moot. The README records which it was.
- **D8. Phone app.** The Flutter app shows no wordmark today and has no `flutter_svg`. MUT-401 adds nothing there, and MUT-403 needs no logotype work (note to add on MUT-403).

## Files

| Action | Path |
|---|---|
| add | `src/assets/brand/wordmark.svg` (delivered bytes) |
| add | `src/styles/__tests__/wordmark.test.ts` |
| add | `docs/brand/wordmark/README.md` (spec: lockups, lockup numbers, min sizes, clear space, RTL/LTR order, running-text rule, licence note) |
| add | `docs/brand/wordmark/store/*`, `docs/brand/wordmark/previews/*`, `docs/brand/wordmark/source/*` |
| edit | `docs/brand/README.md` (asset map rows; the Typography section links the running-text rule) |
| edit | `.claude/DECISIONS.md` (next free ADR: D1, D2, D4), `CHANGELOG.md`, `TEST_PLAN.md` |

No change to `qa/features/web/brand.yaml`: its `paths` already cover `src/assets/brand/**`. The QA spec that sees the logotype on screen belongs to MUT-402. MUT-401 itself has no user-visible flow, because nothing renders the files yet.

## Tests (written first)

`src/styles/__tests__/wordmark.test.ts`:

1. `wordmark.svg` exists and parses as SVG, with a `viewBox`; `wordmark-dark.svg` does not exist (one file, D5).
2. **Outlines only:** no `<text>`, `<tspan>`, `<font>`, `@font-face` or `font-family`. This proves the "3" can't fall back to another face and that no font travels in the file.
3. **Safe to serve under the portal CSP** (`server/src/app.ts:150` sends `default-src 'self'` on every response, the SVG included): no `<script>`, `<foreignObject>`, `on*` attributes, `<style>`, `style="…"` or `class` attributes, and no `href`/`xlink:href` other than `#fragment`. `<metadata>` (C2PA) is allowed. If an export fails this, Basel re-exports it from Claude Design with plain `fill` attributes; nobody hand-edits the file (eng review D4).
4. **One opaque fill:** every shape's effective fill (resolved through `<svg>`/`<g>` inheritance) is the same opaque colour; a shape with none fails. Any colour is fine, because the mask uses only the shape. `url(#…)`, `currentColor`, `none`, `fill-opacity`/`opacity` below 1, gradients, `<use>`, `<mask>`, `<clipPath>` and `<pattern>` fail: a partly transparent stencil would print the ink at partial strength (OV-1, D7). No strokes.
5. *(Retired by D7: there is no dark file to compare.)*
6. **Pinned bytes:** sha256 of `wordmark.svg`, like the Thmanyah pins, so a re-save or re-export shows up in review.
7. **The mark and the app icon are unchanged:** sha256 pins for `src/assets/brand/mark.svg`, `mark-dark.svg`, `public/favicon.svg`, `public/favicon-16/32/48.png`, `public/apple-touch-icon.png` and `public/icons/{icon-192,icon-512,maskable-512,icon-1024}.png`. `brand-head.test.ts:171` only checks that the mark files exist, so an export that drops its own copy over them would otherwise pass (eng review D5, D9). A deliberate change updates the pin in the same commit.
8. **One copy only:** no `wordmark*.svg` anywhere under `docs/brand/`. `docs/brand/wordmark/source/` keeps only Claude Design sources (`.dc.html`, `support.js`); the exported SVGs are moved into `src/assets/brand/`, not copied (OV-3, enforcing D3/R1).
9. **Tight frame:** the path coordinates (absolute and relative commands parsed; on-curve points sit at the extremes in outlined letters) touch all four viewBox edges within 1% and never leave it, so README ratios apply to the file as drawn (eng review D8).

Tests 2–4 parse each file with jsdom (as `brand-head.test.ts` does) and skip the inside of `<metadata>`, so the C2PA base64 can't cause false hits (OV-12). Fills are normalised before comparing (case, 3-digit hex, `rgb()`), so one colour written two ways still counts as one fill.

Run: `npx vitest run src/styles/__tests__/wordmark.test.ts`, then the full gate on Node 22: `npm run lint && npm run typecheck && npm run test:run && npm run build`.

## Acceptance criteria → plan

| Ticket AC | Covered by |
|---|---|
| Latin logotype SVG, light and dark | One file used as a mask serves both themes (D5/D7); tests 1, 4 |
| The "3" doesn't fall back to Plex Mono | Test 2 (outlines only); D4 for running text |
| Lockups incl. bilingual, RTL/LTR order | D2 + README spec + previews |
| Minimum sizes and clear space | D3: README now, tokens in MUT-402 |
| Running-text rule | D4 + README |
| Store templates | `docs/brand/wordmark/store/` |
| Committed in the kit, asset map updated | D1 (narrowed: shipping SVGs in `src/assets/brand/`), `docs/brand/README.md` |
| Icon and mark unchanged | Test 7 (sha256 pins on the two mark files and the nine web icon files) |

## Not in scope

- Rendering the logotype anywhere (MUT-402).
- Phone strings (MUT-403).
- Store assets (MUT-404).
- An English OG card: the shipped card is Arabic.
- Malafat (MAL-1305).

## Eng review (2026-10-22, /plan-eng-review, target: this file)

### Scope record

feature answers: D1 = "Defer to MUT-402" (lockup tokens, drift case and `--m-wordmark-*` move to MUT-402); structure: A, Original arrangement (D2); accepted scope: the plan above with D3 narrowed to README-only numbers; pending remedies: R1, R2, R3.

Scope Challenge result: scope reduced per recommendation.

### Factual corrections (no behaviour change, no question)

- **Import route.** This session can't read the Claude Design project: `DesignSync` only runs inside `/design-sync`. Basel exports the files from Claude Design and drops them into `docs/brand/wordmark/source/` (or the build session imports them through the claude_design MCP after `/design-login`, per memory `brand-v2-claude-design-source`). The build session moves (not copies) the two SVGs, bytes unchanged, into `src/assets/brand/`; `source/` keeps only the Claude Design sources (OV-3, test 8).
- **Premise fix.** "Existing `brand-head.test.ts` pins on `mark.svg`" was wrong: `scripts/__tests__/brand-head.test.ts:171` only checks that the files exist. See R3.

## Decision ledger

### R1: Ship the SVGs from src/assets/brand/, not docs/brand/wordmark/
Finding: S1, P2, confidence 8/10, MUT-401 AC "Files are committed under docs/brand/wordmark/" vs plan D1; reviewer: Claude (plan-eng-review)
Plan baseline: plan D1 (unapproved): shipping SVGs in `src/assets/brand/`, kit-only files in `docs/brand/wordmark/`
Runtime evidence: `mark.svg` ships from `src/assets/brand/` (BrandMark.tsx:2) and the portal caches only bundled `/assets/*` (learning mutaba3a-portal-cache-only-assets); `qa/features/web/brand.yaml:17` maps `src/assets/brand/**`
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 shipping SVG location | ticket AC: docs/brand/wordmark/ | src/assets/brand/ (one copy), note the narrowed AC on MUT-401 | docs/brand/wordmark/ master + byte copy in src/assets/brand/ with a sha256 equality test |
| R2 SVG styling rule | pending | pending | pending |
| R3 mark pins | pending | pending | pending |
Question D3:
D3 — Where do the two shipping wordmark SVGs live?
Project/branch/task: main, MUT-401 brand-kit import; the ticket says "files under docs/brand/wordmark/".
ELI10: The ticket asked for the new logo files to sit in the brand kit folder (docs/brand/wordmark/). But the web build can only bundle files from src/, and the portal only caches bundled files. The mark already lives in src/assets/brand/. So either the shipping SVGs live there once, or they live in both places with a test that keeps the copies identical.
Stakes if we pick wrong: two copies can drift and the landing page shows an old logo, or the ticket's wording is not met literally.
Recommendation: A because one copy cannot drift, and it matches how mark.svg already ships
Note: options differ in kind, not coverage — no completeness score.
Header: SVG location
Options:
A) One copy in src/assets (recommended)
The two SVGs live only in src/assets/brand/, next to mark.svg. docs/brand/wordmark/ keeps the spec, previews, store templates and Claude Design sources, and the asset map points to src/assets/brand/. A comment on MUT-401 records that the AC is narrowed. (human: ~10min / CC: ~2min)
B) Kit master plus copy
The SVGs live in docs/brand/wordmark/ as the master, with byte-identical copies in src/assets/brand/ and a sha256 test that fails when they differ. Meets the AC literally; two files to replace on every re-export. (human: ~30min / CC: ~5min)

State: approved
Actual answer: A) One copy in src/assets (recommended), Basel, D3 answer 2026-10-22
Accepted scope: the two SVGs live only in src/assets/brand/; docs/brand/wordmark/ holds spec, previews, store templates and Claude Design sources; the asset map points to src/assets/brand/; a comment on MUT-401 records the narrowed AC
History: none

### R2: The SVGs carry no style attributes, classes or <style>
Finding: A1, P1, confidence 6/10 after OV-6 (was 9/10; browsers differ on whether the response CSP applies inside an SVG shown through `<img>`, so verify), server/src/app.ts:150 `"default-src 'self'; ... img-src 'self' data:; ..."` and :183 `c.header('Content-Security-Policy', PORTAL_CSP);` on every response, so an SVG fetched from the portal is its own document under that CSP; reviewer: Claude (plan-eng-review)
Plan baseline: test 3 bans `<style>` but not `style="…"` attributes or class-based styling; D6 forbids editing delivered bytes, so a failing file has no stated fix
Runtime evidence: mark.svg and mark-dark.svg use only `fill="#…"` attributes, no style or class (probe: grep, 0 hits); portal CSP has no style-src, so inline styles fall back to default-src 'self' and are blocked
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 SVG location | pending | pending | pending |
| R2 SVG styling rule | bans `<style>` only; fix undefined | test 3 also bans `style=` and `class=`; a failing export is re-exported with presentation attributes, never hand-edited | keep test 3 as written |
| R3 mark pins | pending | pending | pending |
Question D4:
D4 — Ban inline styles in the wordmark SVGs and re-export on failure?
Project/branch/task: main, MUT-401 test 3 guards the SVGs against the portal's security policy.
ELI10: The portal sends a strict security header (CSP) with every file, including images. An SVG that colours its letters with a style attribute or a <style> block gets those styles blocked when the portal serves it, so the logo turns black, only on the portal. The plan's test catches <style> blocks but not style attributes. It also says never to edit the delivered file, so it does not say what to do when the export breaks the rule.
Stakes if we pick wrong: the portal header shows a black or invisible logo in dark mode while the landing page looks fine.
Recommendation: A because the mark already uses plain fill attributes, and the fix stays inside the design tool, which keeps the bytes as delivered
Completeness: A=10/10, B=6/10
Header: SVG styles
Options:
A) Ban styles, re-export (recommended)
Test 3 also fails on any style="…" attribute or class attribute. If the Claude Design export uses them, Basel re-exports with plain fill attributes; nobody hand-edits the file. (human: ~15min / CC: ~2min)
B) Keep test 3 as is
Test 3 only bans <style> elements. A style-attribute export would pass the test and render unstyled on the portal. (no effort)

State: approved
Actual answer: A) Ban styles, re-export (recommended), Basel, D4 answer 2026-10-22
Accepted scope: test 3 also fails on any style="…" attribute or class attribute; a failing Claude Design export is re-exported with plain fill attributes, never hand-edited
History: none

### R3: Pin the mark files' bytes
Finding: T3, P2, confidence 9/10, scripts/__tests__/brand-head.test.ts:171 `for (const asset of [MARK, MARK_DARK]) expect(existsSync(repoPath(asset)), asset).toBe(true);` checks existence only; AC "The app icon and the mark are unchanged"; reviewer: Claude (plan-eng-review)
Plan baseline: AC table cites brand-head.test.ts as the guard (incorrect)
Runtime evidence: no test pins mark.svg or mark-dark.svg bytes (probe: grep for sha256 near mark.svg, 0 hits)
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 SVG location | pending | pending | pending |
| R2 SVG styling rule | pending | pending | pending |
| R3 mark pins | existence only | wordmark.test.ts also pins sha256 of mark.svg and mark-dark.svg | rely on review, no pin |
Question D5:
D5 — Add byte pins for mark.svg and mark-dark.svg?
Project/branch/task: main, MUT-401 must leave the mark unchanged.
ELI10: A Claude Design export of the lockups can include its own copy of the mark. Dropping that folder in could overwrite mark.svg with a slightly different file, and nothing would fail: today's tests only check the mark file exists. Two hash pins make any change to the mark fail loudly, so it has to be a deliberate edit.
Stakes if we pick wrong: the mark changes quietly across the web app, portal and boot splash during a logo import that was meant to leave it alone.
Recommendation: A because the ticket explicitly promises the mark is unchanged, and two hash lines prove it
Completeness: A=10/10, B=5/10
Header: Mark pins
Options:
A) Pin the mark (recommended)
wordmark.test.ts also checks the sha256 of src/assets/brand/mark.svg and mark-dark.svg against pinned values, so an accidental overwrite fails CI. Updating the mark later means updating the pin in the same commit. (human: ~10min / CC: ~2min)
B) No pin
Leave mark protection to code review. The AC's "mark unchanged" has no automated check. (no effort)

State: approved
Actual answer: A) Pin the mark (recommended), Basel, D5 answer 2026-10-22
Accepted scope: wordmark.test.ts also pins the sha256 of src/assets/brand/mark.svg and mark-dark.svg; changing the mark later updates the pin in the same commit
History: none

## Outside voice (Claude Plan subagent, native fallback; Codex not installed)

The reviewer finished within the 5-minute limit: 12 findings (3 High, 6 Medium, 3 Low). Dispositions:

| # | Sev | Finding | Disposition |
|---|---|---|---|
| OV-1 | High | Test 4 passes when a shape has no fill (renders `#000`) or a fill sits on `<g>`/`<svg>` | **Required proof of the approved "one fill each, from the tokens" contract; applied.** Test 4 resolves each shape's effective fill through `<svg>`/`<g>` inheritance, fails when a shape has none, and rejects `url(#…)`, `currentColor`, `none`, `fill-opacity`/`opacity`, gradients, `<use>`, `<mask>`, `<clipPath>` and `<pattern>`. |
| OV-2 | High | Exported fill may be `rgb()`/`oklch()`/3-digit hex or off by rounding; "re-export only" can deadlock | Question R4 |
| OV-3 | High | The import route copies SVGs from `docs/brand/wordmark/source/`, recreating the two copies R1 rejected | **Required proof of R1; applied.** `source/` keeps only Claude Design sources (`.dc.html`, `support.js`); the SVGs are moved into `src/assets/brand/`, not copied. Test 8: no `wordmark*.svg` anywhere under `docs/brand/`. |
| OV-4 | Medium | Lockup ratios depend on what the viewBox covers | Question R5 |
| OV-5 | Medium | One SVG used as a CSS mask would replace the two colour files | Question R6 |
| OV-6 | Medium | Whether the response CSP blocks inline style in an SVG shown through `<img>` varies by browser | **Factual correction.** R2's finding drops to confidence 6/10 ("verify"); the ban stays (approved D4) because it is cheap and also keeps the SVG portable. The build session checks the Claude Design export setting on a throwaway export before calling an import blocked. |
| OV-7 | Medium | "App icon unchanged" has no automated check (favicons, `public/icons/*`) | Question R7 |
| OV-8 | Medium | No gate on MUT-402 for the Thmanyah licence answer | **Rejected:** brand-v2 decision 4 makes the ask@thmanyah.com reply a guardrail, not a blocker. Kept as a guardrail: the README records "drawn from scratch / outlined from Thmanyah", and the MUT-402 plan must read it. |
| OV-9 | Medium | Committing and pinning SVGs before their first consumer causes re-export churn | Question R8 |
| OV-10 | Low | MUT-401 blocks MUT-403, but D8 says MUT-403 needs no logotype | Tracker housekeeping, offered at hand-off (not a plan change) |
| OV-11 | Low | D1's "bundled, served from cached /assets/" is untrue until MUT-402 imports the files; under 4 KB Vite inlines a `data:` URL | **Factual correction; applied to D1.** |
| OV-12 | Low | Tests 2/3 should parse, not text-match, and skip `<metadata>` | **Required proof quality; applied.** Tests parse with jsdom (as `brand-head.test.ts` does) and skip the inside of `<metadata>`. |

## Decision ledger (outside voice)

### R8: Commit the shipping SVGs and their tests in MUT-401 (whole-candidate scope)
Finding: OV-9, Medium, outside voice (Claude Plan subagent); the plan's Files table commits `src/assets/brand/wordmark*.svg` + `wordmark.test.ts` in MUT-401, while nothing imports them until MUT-402
Plan baseline: Include in MUT-401 (plan Files table; scope record)
Runtime evidence: `qa/features/web/brand.yaml:17` already maps `src/assets/brand/**`; no importer of a wordmark SVG exists (grep)
Comparison grid:
| Choice | Current | A Include | B Defer | C Cut | D Hold |
|---|---|---|---|---|---|
| R8 SVGs + tests 1–8 in MUT-401 | Include | MUT-401 commits the SVGs and tests 1–8 | MUT-401 lands README, previews, store templates, sources and test 7 (mark pins); SVGs + tests 1–6, 8 move to MUT-402 | no committed SVGs at all | stop and discuss |
| R4 fill colour policy | pending | pending | pending | pending | pending |
| R5 viewBox contract | pending | pending | pending | pending | pending |
| R6 mask vs two files | pending | pending | pending | pending | pending |
| R7 icon pins | pending | pending | pending | pending | pending |
Question D6:
D6 — Keep committing the logo SVGs (and their tests) in MUT-401?
Project/branch/task: main, MUT-401 brand-kit import; the outside reviewer flagged that nothing uses the SVGs until MUT-402.
ELI10: Right now MUT-401 commits the two logo files and pins them with tests, even though no screen shows them until MUT-402. The reviewer's worry: if MUT-402 then finds the logo needs a change (a smaller cut, different padding), you re-export from Claude Design and update the pins twice. The other side: committing them now makes the drawing final and reviewable, and MUT-404's store work can start from the same file.
Stakes if we pick wrong: a round trip to Claude Design plus re-pinning, or a logo that sits only in Claude Design until MUT-402.
Recommendation: A because a re-pin is a one-line change, and freezing the drawing in MUT-401 is the point of the ticket
Note: options differ in kind, not coverage — no completeness score.
Header: SVGs in 401
Options:
A) Include (recommended)
MUT-401 commits wordmark.svg and wordmark-dark.svg with tests 1–8, as planned. If MUT-402 needs a different cut, it re-exports and updates the pins in its own commit. (human: ~2h / CC: ~20min for 401)
B) Defer
MUT-401 lands the README spec, previews, store templates, Claude Design sources and the mark pins (test 7) only. The SVGs and tests 1–6 and 8 move to MUT-402, where the logo is first rendered. (401 drops to human: ~1h / CC: ~10min)
C) Cut
No SVGs are committed in either ticket; MUT-402 decides from scratch. Not recommended: MUT-402 and MUT-404 both need the drawing.
D) Hold
Stop here and talk it through before choosing; the current Include stays until then.

State: approved
Actual answer: A) Include (recommended), Basel, D6 answer 2026-10-22
Accepted scope: MUT-401 commits the logotype SVG (one file since R6/D7) with its tests as planned; a later re-export in MUT-402 updates the pins in its own commit
History: none

### R6: One SVG used as a CSS mask instead of two colour files
Finding: OV-5, Medium, outside voice (Claude Plan subagent); plan D5 "Two colour files, like the mark" was never put to Basel
Plan baseline: D5 (unapproved): `wordmark.svg` + `wordmark-dark.svg`, each with one fill pinned to its theme's `ink`
Runtime evidence: `BrandMark.tsx` picks a file per theme with `useTheme()` (two files because the mark is multi-colour); no CSS in `src/` uses `mask-image` or `forced-colors` today (grep, 0 hits); portal CSP `img-src 'self' data:` covers `mask-image` URLs
Comparison grid:
| Choice | Current | A Apply | B Keep | C Investigate | D Defer |
|---|---|---|---|---|---|
| R6 logotype file format | two colour files (D5, unapproved) | one `wordmark.svg`, any single opaque fill, shown as a CSS mask over `background-color: var(--ink)` in MUT-402; tests 4–5 become "one opaque fill, no dark file"; README notes the forced-colors and print rules MUT-402 must add | two colour files as planned; R4 (exact ink colour) still to decide | prototype both in MUT-402 before export; export waits | proposal stays open; the plan keeps D5 meanwhile |
| R8 SVGs in 401 | approved Include (D6) | Include | Include | Include | Include |
| R4 fill colour policy | pending | becomes irrelevant (colour comes from CSS) | pending | pending | pending |
| R5 viewBox contract | pending | pending | pending | pending | pending |
| R7 icon pins | pending | pending | pending | pending | pending |
Question D7:
D7 — One logo file coloured by CSS, or two coloured files?
Project/branch/task: main, MUT-401 export contract; the outside reviewer proposed a single mask file.
ELI10: The plan asks Claude Design for two logo files, one dark-ink for light mode and one light-ink for dark mode, like the mark. But the logotype is one colour. A single file can be used as a stencil (a CSS mask) and filled with the theme's ink colour by CSS, so it follows light/dark and any future ink change automatically. That also removes the problem of the export's colour not matching the token exactly. The costs: the screen shows a styled span instead of an image, so MUT-402 must add an accessible label, a rule for Windows high-contrast mode and one for printing.
Stakes if we pick wrong: two files that can drift from the ink token, or a mask that vanishes in high-contrast mode or print if MUT-402 forgets those rules.
Recommendation: A because one file cannot drift from the ink, and the two edge-case rules are a few lines of CSS that MUT-402 tests anyway
Note: options differ in kind, not coverage — no completeness score.
Header: Logo format
Options:
A) One mask file (recommended)
Export one wordmark.svg with any single opaque fill. MUT-402 shows it as a CSS mask over the ink colour, with role="img" and an aria-label, a forced-colors rule (CanvasText) and a print rule. Tests 4–5 become "one opaque fill, no dark file"; question R4 (exact ink hex) falls away. (human: ~2h / CC: ~15min across 401+402)
B) Two colour files
Keep D5: wordmark.svg and wordmark-dark.svg as <img>, each filled with its theme's ink; R4 (exact ink colour) still needs an answer. (as planned)
C) Investigate first
Prototype both renderings in a throwaway branch before Basel exports; the export waits until then. (human: ~3h / CC: ~30min)
D) Defer this proposal
Leave this open; the plan keeps two files meanwhile and R4 is asked next.

State: approved
Actual answer: A) One mask file (recommended), Basel, D7 answer 2026-10-22
Accepted scope: export one wordmark.svg with a single opaque fill; MUT-402 renders it as a CSS mask over var(--ink) with role="img" + aria-label, a forced-colors rule (CanvasText) and a print rule; tests 4–5 become "one opaque fill, no dark file"; R4 falls away
History: none

### R4: Exact ink colour in the exported fill
Finding: OV-2, High, outside voice (Claude Plan subagent)
State: not asked: irrelevant after R6 (D7). With one mask file the fill colour carries no meaning; the ink comes from `var(--ink)` in CSS, so the export can't drift from the token and the "test fails, no hand-edit" deadlock can't happen.

### R5: The viewBox is cropped to the letters
Finding: OV-4, Medium, outside voice (Claude Plan subagent); D3 records "logotype height relative to the mark", and MUT-402 sizes the mask box by height
Plan baseline: export contract says nothing about what the viewBox covers
Runtime evidence: no SVG-path or bbox library in package.json (probe); jsdom has no `getBBox`, so a test must read path coordinates itself
Comparison grid:
| Choice | Current | A Apply | B Keep | C Investigate | D Defer |
|---|---|---|---|---|---|
| R5 viewBox contract | unspecified | contract: viewBox top = cap height, bottom = baseline, left/right = first/last ink, zero padding, B/3 overshoot inside; test 9 checks the path coordinates touch all four edges within 1% and never leave the viewBox | unspecified; README ratios apply to whatever box the export has | try one export first, then write the rule | proposal stays open |
| R8 SVGs in 401 | approved Include (D6) | Include | Include | Include | Include |
| R6 logo format | approved one mask file (D7) | one mask file | one mask file | one mask file | one mask file |
| R7 icon pins | pending | pending | pending | pending | pending |
Question D8:
D8 — Require the exported logo's frame to hug the letters exactly?
Project/branch/task: main, MUT-401 export contract; the README will give sizes like "logo height = 0.6 × mark".
ELI10: An SVG has an invisible frame (the viewBox). If Claude Design exports MTB3A with empty space around the letters, then "make the logo 18 px tall" makes the letters smaller than 18 px, and every ratio in the README is off. The fix is a rule in the export contract (the frame runs from the top of the capitals to the baseline and from the first to the last letter, no padding) plus a test that reads the shape coordinates and checks they touch all four edges.
Stakes if we pick wrong: the logo sits too small or off-centre next to the mark everywhere MUT-402 places it, and nobody notices until it renders.
Recommendation: A because the README's numbers only mean something when the frame is the letters, and the test catches a padded export before MUT-402 builds on it
Completeness: A=10/10, B=5/10, C=6/10, D=4/10
Header: Tight frame
Options:
A) Apply: tight frame + test (recommended)
Export contract: viewBox from cap height to baseline and first to last ink, zero padding, overshoot of B and 3 inside. Test 9 parses the path coordinates (absolute and relative commands; on-curve points sit at the extremes in outlined letters) and checks they touch all four edges within 1% and never leave the frame. (human: ~2h / CC: ~15min)
B) Keep: no frame rule
The README ratios apply to whatever frame the export has; MUT-402 adjusts by eye. (no effort now)
C) Investigate first
Look at one throwaway export to see what Claude Design produces, then write the rule. (human: ~30min / CC: ~5min, export waits)
D) Defer this proposal
Leave it open; the contract stays silent meanwhile.

State: approved
Actual answer: A) Apply: tight frame + test (recommended), Basel, D8 answer 2026-10-22
Accepted scope: export contract requires the viewBox from cap height to baseline and first to last ink, zero padding, B/3 overshoot inside; test 9 parses path coordinates (absolute and relative commands) and checks they touch all four viewBox edges within 1% and never leave it
History: none

### R7: Pin the app icon files too
Finding: OV-7, Medium, outside voice (Claude Plan subagent); AC "The app icon and the mark are unchanged"; the AC table claims "no edit to public/icons/" with no check
Plan baseline: R3 (approved D5) pins `mark.svg` and `mark-dark.svg` only
Runtime evidence: no test hashes `public/favicon.svg`, `public/favicon-16/32/48.png`, `public/apple-touch-icon.png` or `public/icons/{icon-192,icon-512,maskable-512,icon-1024}.png` (grep for sha256 near them, 0 hits); `src-tauri/icons/` is generated from `icon-1024.png` (docs/brand/README.md asset map)
Comparison grid:
| Choice | Current | A Apply | B Keep | C Investigate | D Defer |
|---|---|---|---|---|---|
| R7 icon pins | none | test 7 also pins the 9 web icon files (favicon.svg, 3 favicon PNGs, apple-touch-icon, 4 PWA icons); the AC row cites it | AC row reworded "checked in review"; no pin | look at whether an export can even touch public/ first | proposal stays open; AC row keeps its unbacked claim |
| R3 mark pins | approved (D5) | kept | kept | kept | kept |
| R5 tight frame | approved (D8) | kept | kept | kept | kept |
Question D9:
D9 — Also pin the app icon files (favicons, PWA icons)?
Project/branch/task: main, MUT-401 promises the app icon is unchanged.
ELI10: You already chose to lock the mark's two files with hash checks. The app icon lives in nine more files (the browser favicons, the iPhone home-screen icon and the install icons). The ticket promises those are unchanged too, but nothing checks them, so the plan's "no edit to public/icons/" is a claim with no test behind it. Pinning them is nine more lines in the same test.
Stakes if we pick wrong: an icon file changes during the rename and ships in the next web release without anyone deciding it should.
Recommendation: A because it is the same mechanism as the mark pins, it makes the ticket's promise true, and a deliberate icon change later just updates the pin
Completeness: A=10/10, B=6/10, C=6/10, D=4/10
Header: Icon pins
Options:
A) Apply: pin the icons (recommended)
Test 7 also pins the sha256 of public/favicon.svg, favicon-16/32/48.png, apple-touch-icon.png and public/icons/icon-192, icon-512, maskable-512 and icon-1024.png. The AC row cites it. (human: ~15min / CC: ~2min)
B) Keep: review only
Reword the AC row to "checked in review"; no pins for the icon files.
C) Investigate first
Check whether a Claude Design export could even reach public/ before deciding. (human: ~15min / CC: ~3min)
D) Defer this proposal
Leave it open; the AC row keeps its unbacked claim meanwhile.

State: approved
Actual answer: A) Apply: pin the icons (recommended), Basel, D9 answer 2026-10-22
Accepted scope: test 7 also pins the sha256 of public/favicon.svg, favicon-16/32/48.png, apple-touch-icon.png and public/icons/icon-192, icon-512, maskable-512 and icon-1024.png; the AC row cites it
History: none

Approval readiness: PASS. Checked R1 (D3), R2 (D4), R3 (D5), R8 (D6), R6 (D7), R5 (D8), R7 (D9), all approved by Basel on 2026-10-22. R4 was not asked: R6 made it irrelevant.

## Review body

### Reality rows
- premise-table: 7 premises, unverified=1.
  - TRUE: Wordmark = BrandMark + name (Wordmark.tsx:21-28).
  - TRUE: mark.svg carries C2PA (mark.svg:1).
  - TRUE: brand.yaml maps src/assets/brand/** (brand.yaml:17).
  - TRUE: the Flutter app has no wordmark and no flutter_svg (grep).
  - TRUE: the portal caches only /assets/* (app.ts:182 + learning).
  - TRUE: the figure stack is reached only through --font-mono (theme.css:31).
  - UNVERIFIED: Thmanyah Sans has Latin caps and the digit 3. Moot for the logotype, which is outlines.
- REALITY: premise-table finding unverified=1 (Thmanyah Latin coverage) docs/brand/README.md:Typography
- REALITY: already-done pass no commit touches the named brand files since MUT-165 (git log src/assets/brand docs/brand: 6a723969)
- REALITY: surface-check pass npx vitest run and the npm lint/typecheck/test:run/build scripts are the project's documented gate (CLAUDE.md Phase 4)
- REALITY: binding-decisions finding OV-8 would have overruled brand-v2 decision 4 (licence is a guardrail, not a blocker); rejected (memory brand-v2-decisions)
- REALITY: numbers pass mark.svg is 8103 bytes [measured: wc -c]; 4 KB inline limit is Vite's default [estimated: vite.config.ts sets none]
- REALITY: deferred-asks finding the ticket's "files under docs/brand/wordmark/" is narrowed (R1, D3) and the lockup tokens move to MUT-402 (D1); both are recorded for the MUT-401 comment
- REALITY: pr-count pass one local branch, one merge (no PRs in this repo's flow)

### Section 1 — Architecture
- [P1] (confidence 6/10, after OV-6) server/src/app.ts:150,183. The portal sends its CSP with every response, the SVG included. An export with inline styles may render unstyled on the portal. → R2 approved (D4).
- Dispositions: A1 accepted (D4).

### Section 2 — Code quality
- No issues found. `brand.test.ts:50` has a three-line `sha256()`, and `wordmark.test.ts` will want the same. That is too small to extract by the shared-code rubric: one helper line saved, while a new shared module would couple two suites. Rejected; no question needed.

### Section 3 — Tests

```
CODE PATHS (src/styles/__tests__/wordmark.test.ts, all new; no runtime code in MUT-401)
[+] wordmark.svg
  ├── [PLANNED ★★★] parses, has viewBox; no dark file          — test 1
  ├── [PLANNED ★★★] outlines only (no text/font)               — test 2
  ├── [PLANNED ★★★] CSP-safe: no script/style/class/on*/ext href — test 3 (R2)
  ├── [PLANNED ★★★] one opaque effective fill per shape        — test 4 (OV-1, R6)
  ├── [PLANNED ★★ ] bytes pinned                               — test 6
  ├── [PLANNED ★★★] tight viewBox (touches 4 edges, ±1%)       — test 9 (R5)
  └── [PLANNED ★★★] no second copy under docs/brand/           — test 8 (OV-3)
[+] mark + app icon
  └── [PLANNED ★★ ] 11 files pinned (mark ×2, favicons ×4, touch, PWA ×4) — test 7 (R3, R7)

USER FLOWS: none in MUT-401 (nothing renders the logotype). The landing header and portal brand flows are MUT-402's QA.

COVERAGE: 8/8 planned paths have a planned test | GAPS: 0 | E2E: 0 | EVAL: 0
```

- [P2] (confidence 9/10) scripts/__tests__/brand-head.test.ts:171 only checks that the mark files exist. → R3 approved (D5) and widened by R7 (D9).
- Test plan artifact: ~/.gstack/projects/vAWK3-mutaba3a/basel-main-eng-review-test-plan-20261022-211723.md
- Tests to retire: none. Dispositions: T3 accepted (D5).

### Section 4 — Performance
- No issues found. MUT-401 adds one SVG of roughly 8 KB that nothing loads yet. In MUT-402 it is one cached immutable `/assets/` request per first visit.

### NOT in scope
- **Lockup tokens, `--m-wordmark-*` and their drift case:** moved to MUT-402 by D1, so they land with their first reader.
- **Rendering the mask** (aria-label, forced-colors, print, `-webkit-mask`): MUT-402 owns these by D5/D7.
- **MAL-1305, MUT-403 and MUT-404:** their own tickets.
- **Flutter and desktop icon sets:** another repo, or generated from `icon-1024.png`, which is pinned.

### What already exists
- **The mark's theme-aware files** (`BrandMark`, `src/assets/brand/`): they set the location the SVG follows (R1).
- **The sha256 pin pattern** (`brand.test.ts`, `thmanyah.sha256.json`): reused as a pattern, not extracted.
- **jsdom parsing** (`brand-head.test.ts`): reused for the SVG checks.
- **QA path mapping** (`qa/features/web/brand.yaml:17`): already covers the new file.

### Failure modes
- **Padded or styled export:** caught by tests 3 and 9 before merge. Not silent.
- **Mark or icon overwritten during import:** caught by test 7. Not silent.
- **Second copy left in `docs/`:** caught by test 8.
- **Shape with no fill:** caught by test 4.
- **Critical gaps:** 0.

### Worktree parallelization
Sequential implementation, no parallelization opportunity: one module, and the work waits on Basel's export.

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~30min / CC: ~5min)** — export contract — Basel exports one `wordmark.svg` (single opaque fill, plain `fill` attributes, tight viewBox) plus previews, store templates and sources
  - Surfaced by: R2 (D4), R6 (D7), R5 (D8)
  - Files: Claude Design project 160fbfa7… → `docs/brand/wordmark/source/`
  - Verify: tests 3, 4, 9 pass on the export without edits
- [ ] **T2 (P1, human: ~2h / CC: ~15min)** — tests — write `src/styles/__tests__/wordmark.test.ts` (tests 1–4, 6–9) first, red
  - Surfaced by: R2, R3, R5, R6, R7, OV-1, OV-3, OV-12
  - Files: src/styles/__tests__/wordmark.test.ts
  - Verify: `npx vitest run src/styles/__tests__/wordmark.test.ts` red, then green after T3
- [ ] **T3 (P1, human: ~15min / CC: ~3min)** — import — move (not copy) `wordmark.svg` into `src/assets/brand/`; pin it
  - Surfaced by: R1 (D3), OV-3
  - Files: src/assets/brand/wordmark.svg
  - Verify: test 8 passes; `git status` shows no SVG under docs/brand/
- [ ] **T4 (P2, human: ~1h / CC: ~10min)** — docs — `docs/brand/wordmark/README.md`: lockup numbers, min sizes, clear space, RTL/LTR order, running-text rule, frame rule, licence provenance, the MUT-402 obligations from D5; asset map rows in `docs/brand/README.md`
  - Surfaced by: D1 (tokens deferred), R6, OV-8
  - Files: docs/brand/wordmark/README.md, docs/brand/README.md
  - Verify: read-through; links resolve
- [ ] **T5 (P2, human: ~20min / CC: ~3min)** — knowledge + tracker — ADR (next free number) for one mask file + one shipping copy; CHANGELOG, TEST_PLAN; MUT-401 comment (narrowed AC, tokens to MUT-402); MUT-402 comment (tokens, mask rendering rules, licence guardrail)
  - Surfaced by: R1, R6, D1, OV-8, OV-10
  - Files: .claude/DECISIONS.md, .claude/CHANGELOG.md, .claude/TEST_PLAN.md
  - Verify: full gate on Node 22

### Unresolved decisions
None in this review.

### Completion summary
- Step 0, Scope Challenge: scope reduced per recommendation (D1).
- Reality rows: 7/7 tier-1 rows emitted; 1 unverified premise.
- Architecture review: 1 issue found.
- Code quality review: 0 issues found.
- Test review: diagram produced; 1 gap identified.
- Performance review: 0 issues found.
- NOT in scope: written.
- What already exists: written.
- TODOS.md updates: 0 items proposed.
- Failure modes: 0 critical gaps flagged.
- Unresolved decisions: 0 in this review.
- Outside voice: provider codex, unavailable (not installed). The native Claude Plan subagent completed with 12 findings: 7 applied as required proof or factual corrections, 1 rejected under a binding decision, 1 made irrelevant, and 4 decided by Basel (D6–D9).
- Parallelization: 1 lane; 0 parallel, 1 sequential.
- Lake Score: 8/8 answers chose the 10/10 or recommended option. D1, D2, D3 and D6 were scored by kind.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex (unavailable) → in-host Claude Plan subagent | Independent 2nd opinion | 50 | issues_found (in-host) | 12 findings: 7 applied, 1 rejected, 1 moot, 4 decided |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 53 | ISSUES OPEN | 2 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 11 | — (other tickets) | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review: unavailable (not installed). The in-host Claude Plan subagent completed within the 5-minute timer. That gives no external outside coverage.
- **VERDICT:** No review is CLEAR for MUT-401. All findings are resolved by approved decisions, so the issues are mapped work, not blockers. ENG: ISSUES OPEN (2 resolved findings), ready to implement after Basel's export. Eng review required.

NO UNRESOLVED DECISIONS
