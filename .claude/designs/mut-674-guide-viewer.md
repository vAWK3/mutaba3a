# MUT-674 Portal: a guide viewer with one content format

Engineering plan, 2026-11-28. Planning only: no code written. Epic MUT-672 (Guides and prompts). Layout picked by Basel 2026-11-27 (guide A on the portal): a drawer, a hero, then every step in one scrolling list. Mockup: `.claude/designs/guides-and-help/mockups/index.html`. Art and motion are on local main (merge 7b16331b).

Tracker: Jira barmajiyat, MUT-674 is in Backlog, not blocked (it blocks MUT-676, 677, 678, 679, 680, 681). Siblings: MUT-673 (copy deck, Backlog), MUT-675 (Get started state), MUT-611 (the prompt engine, widened).

## 1. What exists and what does not

| Need | Exists | Gap |
|---|---|---|
| Drawer shell | `Drawer` (`src/hosted/components/Drawer.tsx`) on `DrawerFrame`: dialog, labelled by title, focus trap, Escape, overlay, drag, returns focus to the trigger | none |
| Opened by a URL key, on every page | `useAccountDrawers` / `AccountDrawers` (`src/hosted/shell/AccountDrawers.tsx`), keys registered in `ProfileDrawerSearch`, `SHELL_OVERLAY_KEYS`, `parseProfileDrawer` (`src/hosted/data/filters.ts`) | a `guide` key |
| Illustrations | `Scene` (picks the `-rtl` drawing in RTL), 58 `guide-*` scenes generated | none |
| Icon | `GuideIcon` (generated) | none |
| Telemetry, opt-in | `trackPortal` (`src/hosted/analytics/portalAnalytics.ts`), contract `docs/analytics/events.json` v2.13.0 | two events |
| A typed JSON file shared across surfaces | `release-notes.json` + `src/lib/whatsNew/releaseNotes.ts` (en/ar inline) | the guide schema |
| Guide content | none | MUT-679, 680, 681 write it; copy deck MUT-673 signs it off |

No existing guide, help or tour component to extend (COMPONENT_REGISTRY checked). No portal i18n for guides yet.

## 2. Decisions (technical: recommended option taken; the two UI/flow ones are in section 8)

**D1. One JSON file per guide, copy inline in both languages.** `src/content/guides/<id>.json`. Not i18n keys: a guide then needs edits in two dictionaries plus code, and the phone and the website could not read it. JSON is language-neutral, so the Flutter repo can copy or fetch it and MUT-678 can build pages from it. Copy is `{ "ar": "...", "en": "..." }` with an optional `he` (the website's Hebrew pages come later, MUT-689; the portal never shows Hebrew).

```jsonc
{
  "id": "tax-authority",            // = file name; the ?guide= value and the analytics value
  "surfaces": ["portal", "phone", "web"],
  "title": { "ar": "...", "en": "..." },
  "lead":  { "ar": "...", "en": "..." },
  "hero":  "guide-tax-hero",        // a scene name (no -rtl suffix)
  "steps": [ { "text": { "ar": "...", "en": "..." }, "scene": "guide-tax-1" } ],
  "note":  { "ar": "...", "en": "..." },          // optional: the "reconnect every 90 days" line
  "source": { "url": "https://...", "label": { "ar": "...", "en": "..." } }  // optional official source
}
```

`surfaces` is there because Scan and bank-text are phone-only: the portal registry must not list them, and the website must know which pages to build. The "need help?" link is not per guide: the viewer builds it from one constant (section 5), so a guide file carries no support address. Fields later stories need (`requires: "agent_access"` for the Claude guide in the Get started hub, a footer `action`) are optional additions to the same schema; nothing here blocks them.

**D2. Lazy registry.** `src/content/guides/index.ts`: `import.meta.glob('./*.json')` (not eager). The portal then ships one ~1 KB chunk per guide, fetched when it opens, and adding a guide is adding a file (no code, no registry edit). The id list comes from the glob keys. MUT-678 builds its pages with its own eager glob at website build time. Cost: one tiny request per open, behind the drawer's existing loader.

**D3. A pure parser is the only door.** `parseGuide(unknown, fileId)` in `src/content/guides/guideSchema.ts` (no React, no zod import in the portal chunk: hand-rolled like `releaseNotes.ts`, or zod if it is already in the portal bundle; check `package.json` before the build). It rejects: id not equal to the file name, a missing `ar` or `en`, empty strings, zero steps, an unknown key, a `source.url` that is not `https:`. It never throws into the UI: the loader returns `null` and the drawer closes (D5).

**D4. Scene names are checked in a test, not at runtime.** A content test asserts every `hero` and step `scene` exists in `SCENE_ART`, and that the `-rtl` pairing exists unless the scene is direction-neutral. A missing scene would otherwise render the `empty-state` placeholder silently.

**D5. URL key `?guide=<id>`**, a shell overlay key: add `guide?: string` to `ProfileDrawerSearch`, to `SHELL_OVERLAY_KEYS` and to `parseProfileDrawer` (value must match `^[a-z0-9-]{1,40}$`, else dropped). Mounted in `AccountDrawers` (every page, both modes: guides are static content, so signed-out local mode works too). `openGuide(id)` pushes a history entry; `close()` is the existing `go({}, true)`, so the page and its filters stay (AC 1). An id that is not in the registry (typo, old link, a phone-only guide) closes itself with a replace and shows nothing. A guide that is in the registry but fails to load (offline, a stale chunk after a deploy) is different: the drawer stays open and shows `QueryView`'s Unreachable state with Retry, never a silent close. The drawer is keyed by guide id, so Back or Forward between two guides resets its state and counts the second open. Because `go()` strips every shell overlay key, opening a guide from inside another shell drawer replaces that drawer (DESIGN: no drawer on a drawer); the story that adds a button inside a drawer (MUT-680, Connect Claude) puts it on the page row beside it instead, and Back returns.

**D6. Viewer layout (mockup A).** `GuideDrawer` (`src/hosted/components/GuideDrawer.tsx`) on `Drawer`: title in the header; body = `Scene` hero (120 wide), lead (`hp-muted`), then an `<ol>` of steps (number, text, `Scene` at 120 wide; the 160×160 art keeps its subject in the central 120×96, per DESIGN), then the note as `hp-banner-info`-style `role="note"`, the official-source link (`rel="noopener noreferrer"`, new tab, visually-hidden "opens in a new tab"), and the "need help?" link. Footer: see Q1. Press feedback on the link buttons (`press`). Logical properties only; at 375 px the drawer is full width already. Motion: the website-entrance moment for the first screen (headline, lead, first block rise once, 14 px, 50 ms stagger, text readable from frame 1); reduced motion shows the still (no movement). The step-change slide is the phone's, not built here.

**D7. Need-help link. (Built differently: the portal already has one support address, `SUPPORT_EMAIL` in `src/hosted/terms.ts`, used by the sign-in, recovery and billing screens, so the link is a `mailto:` to it and no new constant was added.)** A guide file carries no address. MUT-692 changes the one constant if the address changes.

**D8. Telemetry through the existing gate.** Two contract events, version 2.15.0 (2.14.0 was taken by the billing stack): `guide_opened` and `guide_finished`, emitter `portal` (iOS and Android join in MUT-677, a minor bump), one property `guide` (an enum of guide ids with dashes as underscores, since every contract enum value is snake_case; `trackGuide` converts). The guard stays strict (no free-text properties, ADR-090), so the enum lists every guide id; a test fails when a content file has no entry in the contract and when the contract names a guide with no file, and its message names the exact line to add. This is the one place "add a guide" touches a second file; it is a data file, not code, and it is what keeps the anonymous-counts promise. `trackGuide(event, guide)` in `portalAnalytics.ts` wraps `trackPortal`, so nothing leaves unless the person opted in; signed-out and local mode send nothing. `guide_opened` once per open of the drawer. A re-render is not an open and neither is React StrictMode's second effect run in dev: send from a mount effect guarded by a ref, keyed by guide id (not the page-wide once-set of `trackPlanEvent`, which would count a second open of the same guide as nothing).

**D9. Accessibility.** `role="dialog"` named by the title (from `Drawer`), steps in a real ordered list, art `aria-hidden` (Scene already), Escape and ✕ and overlay close, focus returns to the button that opened it, links have visible focus and 44 px targets, RTL through `dir` only. Nothing is conveyed by colour.

## 3. Files

Add
- `src/content/guides/guideSchema.ts`, `index.ts`, `types.ts`; one fixture file under `src/content/guides/__tests__/fixtures/`
- `src/hosted/components/GuideDrawer.tsx`, `GuideButton.tsx` (a `hp-link-button` with `GuideIcon`, props `guide` and an optional label, calls `openGuide`)
- guide drawer CSS in `src/hosted/hosted.css` (`.hp-guide-*`, tokens only; `brand.test.ts` forbids colour literals)
- `qa/features/portal/guides.yaml`, `qa/specs/portal/guides.spec.ts`
- `.claude/designs/mut-674-guide-viewer.md` (this file)

Touch
- `src/hosted/data/filters.ts` (key, parser, overlay list)
- `src/hosted/shell/AccountDrawers.tsx` (`openGuide`, mount)
- `src/hosted/analytics/portalAnalytics.ts` (`trackGuide`, event union)
- `docs/analytics/events.json` (+ `docs/analytics/README.md` if it lists events), version 2.15.0
- `src/hosted/i18n/{en,ar}.json` (`hosted.guide.*`: close/done, needHelp, officialSource, opensInNewTab, notFound if any)
- `DESIGN.md` (the Guides motion line: viewer built), `.claude/COMPONENT_REGISTRY.md`, `PATTERNS.md` (the content-file pattern), `DECISIONS.md` (one ADR), `CHANGELOG.md`, `SYSTEM_OVERVIEW.md`, `TEST_PLAN.md`

No server, no migration, no new dependency expected. The website bundle must not import `GuideDrawer` (it lives in `src/hosted`); the schema and registry live in `src/content` so MUT-678 can import them without portal code.

## 4. Tests (TDD: red first)

`npm run test:run` under Node 22, affected files first with `--maxWorkers=3`, through the heavy queue (light lane for typecheck and lint).

1. `guideSchema.test.ts`: a full guide parses; missing `ar` or `en` in title, lead, a step or the note rejects; empty string rejects; zero steps rejects; unknown key rejects; `javascript:` and `http:` source rejects; `he` optional; id/file mismatch rejects.
2. `content/guides/__tests__/guides.test.ts` (runs over the real files, passes vacuously with none): every file parses; every scene exists and its `-rtl` pairing exists or the scene is neutral; every guide id is in the contract enum and the reverse.
3. `filters` tests: `?guide=x` parses, a bad value drops, `omitShellOverlay` strips it, `pickShellOverlay` carries it across a filter change.
4. `GuideDrawer.test.tsx` (the fixture guide): renders in English and in Arabic (`dir="rtl"`, the `-rtl` art chosen by `data-scene-art`), title is the dialog's name, steps are an `<ol>` in order, source link has `https`, `rel`, `target`, the note has `role="note"`, Escape and ✕ call `onClose`, focus returns to the trigger, an unknown id closes with a replace and renders nothing, a failed load shows Unreachable and Retry loads it, the need-help link is a `mailto:` to `SUPPORT_EMAIL`.
5. `GuideButton` test: click pushes `?guide=<id>` and keeps the page's existing search (state kept after close).
6. Analytics: opted in sends `guide_opened { guide }` once per open; off, signed out and local mode send nothing; the guard accepts the event and drops an unknown guide id; `analytics-taxonomy.test.ts` passes on the new contract.
7. `pressFeedback.test.tsx`, `direction.test.ts`, `brand.test.ts` stay green (new buttons carry `press`, no physical properties, no colour literals).
8. Release-QA (CLAUDE.md Phase 5): `qa/features/portal/guides.yaml` flow `guide-open-read-close`, spec tagged `@portal.guides.guide-open-read-close`. Steps: from a feature screen press the guide button; the drawer opens over the page, not as a page; read the steps (Arabic first, then English); close with ✕; the page and its state are as before. The registry is a build-time glob, so a QA flow needs a real file in the build; a stub cannot be injected into a preview build (the id list is the glob's keys). That is why Q2 recommends shipping one guide file. Until MUT-679 places the Connect button's entry point, the spec opens the guide through its URL key and the QA feature says so; MUT-679 then repoints the same flow at the button. `release-qa lint` clean; run `release-qa run --attach --only guide-open-read-close` until it passes before calling it done.

## 5. Scalability, cost, constraints

- Reads: no API calls. One static chunk per opened guide. Bundle impact on the portal main chunk: the `guide` key parser lines and the lazy glob map only.
- No server, no cost. PostHog volume: two events per opted-in person per guide, no props beyond the id.
- Drawer-first, Arabic first and right to left, ar+en only in the portal, DESIGN.md roles and type styles, minimal UI copy (CLAUDE.md global rule: no explainer lines of our own around the guide; the guide content is the only prose), telemetry release-only through the existing gate, no money, no profile data anywhere in a guide or an event.
- Local mode: the viewer works signed out (no API); events do not send.

## 6. Risks

| Risk | Handling |
|---|---|
| Unsigned copy reaching production | At most one draft guide ships, with no entry point (Q2), and "MUT-673 signed off" is a before-release precondition; MUT-680/681 add files only after MUT-673 signs the copy |
| A chunk fails to load (offline, stale after a deploy) | D5: the drawer shows Unreachable with Retry; test 4 covers it |
| StrictMode double effect counts an open twice | D8: ref-guarded mount effect; test 6 mounts under StrictMode |
| A guide file with a wrong scene name shows the placeholder art quietly | D4 test, runs in CI |
| The analytics enum drifts from the content | D8 test names the line to add |
| Support address not confirmed | D7: the link hides when empty; Basel's open item |
| Opening a guide while another shell drawer is open replaces it | Intended (D5); noted for MUT-680 |
| `import.meta.glob` under vitest/QA preview build | Verified in the first red test; QA runs on a preview build (memory: qa-run-on-preview-builds) |

## 7. Scope check against the ticket

AC1 drawer + page state kept: D5, D6, tests 3 and 5. AC2 ar/en, RTL, keyboard, screen reader: D6, D9, test 4. AC3 add a guide = one content file, no code: D1, D2, D8 (plus one data line in the analytics contract, flagged). AC4 release-QA flow: test 8. AC5 DESIGN.md: D6 and the DESIGN.md line. Telemetry scope item: D8. Out of scope kept out: the Get started card and hub (MUT-676), guide content (679..681), search inside guides, the phone (MUT-677), public pages (MUT-678), the prompt (MUT-611), a footer primary action.

Revealed by the plan, to note on the ticket: (a) the analytics contract needs a line per guide; (b) the ticket says "Guides open from the button on the feature's own screen", but no real feature screen can carry a button until a real guide exists, so the button's real placements are MUT-679/680/681 and 674's QA opens the one shipped guide through its URL key (Q2); (c) the mockup's footer has a feature action (Connect) beside Close, which the ticket does not mention (Q1).

## 8. Settled by Basel (2026-11-28: "Yes, both")

- **Q1. SETTLED: what "finished" means and the footer.** Decision: the footer's one primary button is **Done** (closes, counts `guide_finished`); ✕, Escape and the overlay just close (count nothing). Reliable, one signal, nothing guessed from scrolling (a four-step guide often fits on screen, so "scrolled to the end" would fire on open). Alternative: no footer, finished = the last step seen for a few seconds (soft, noisy). The mockup's second footer button (a feature action such as Connect) is left to MUT-679.
- **Q2. SETTLED: 674 ships one guide file.** Decision: yes, `tax-authority.json` with the draft copy from `guides-draft.md`, no button on any screen (MUT-679 places them), and "copy deck MUT-673 signed off" added to `docs/operations/before-release.md` as a precondition of the next web release. Reason: the registry is a build-time glob, so AC4's release-QA flow can only run against a real file, and the file is reachable only by typing `?guide=tax-authority`. Alternative: ship no guide, test with fixtures, and move the release-QA flow to MUT-679 (AC4 of 674 then waits on 679). Merging to local main is not a release; the web release stays Basel's gate.

## Business / product impact

- The portal gets its first place to teach a feature in plain steps; every guide story and the Get started card sit on it, and so do the help pages and the prompt that sends people to a guide.
- Roadmap: first story of epic MUT-672, on the path to MUT-676, 678, 679 to 681. Without it nothing else in the epic can render.
- Risk is low: no server, no migration, no new dependency, no cost; the main risk is shipping unsigned copy, handled by shipping no real guide until MUT-673 is signed.

## 9. Built (2026-11-28)

Branch `feature/mut-674-guide-viewer`. Differences from the plan: the need-help link reuses `SUPPORT_EMAIL` (D7); the contract is 2.15.0 and the enum value is `tax_authority` (D8); the shipped `tax-authority.json` has no `source` link, because the Tax Authority's page address belongs to the signed-off copy (MUT-673), and the viewer's source link is covered by the fixture test; `qa/qa.config.mjs` moves `src/content/guides/**` from the website's watch to the portal's. Not done here: the Flutter copy of the contract (TD-373).
