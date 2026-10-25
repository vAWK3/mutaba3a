# MUT-426 — Portal: floating tab pill and You island replace the sidebar

Epic MUT-423 · blocked by MUT-424 (merged, shipped web-v0.2.1) and MUT-425 (merged, shipped web-v0.2.0) · design: `.claude/designs/portal-shell-concepts.html` (round 4, variation 3) · status: **planned** (2026-10-25), not built

## Goal

`HostedShell` loses its 240px sidebar and its phone top bar. In their place, three floating glass objects sit over the page:
- the **pill** with Owed · Paid · Spent · Clients;
- the **You island**, which shows the profile's name and your avatar, ringed in the profile's colour;
- the **Reports corner icon**, which takes the wireframe's search circle slot (MUT-424 eng D2; Jira comment 12498).

Pages move with direction: going deeper slides forward, going back slides the other way, the You page grows out of the island, and reduced motion cross-fades. The trial banner becomes one quiet line on Owed.

Nothing else moves: the destinations, the URLs, the You page and the drawers stay exactly as MUT-424 and MUT-425 left them.

## Where it sits

- **Reused unchanged:**
  - `src/hosted/shell/destinations.ts`: `DESTINATIONS`, `destinationOf`, `destinationPath`, `NO_DESTINATION`.
  - `src/hosted/shell/youRoutes.ts`: `youPath`, `isYouPath`, `sectionOf`, `parseYouSearch`, `switchTarget`.
  - `initials.ts`, `AccountDrawers`, `ProfileDrawers`, `TrialWelcomeOpener`, `UsagePrompt`.
  - `src/lib/motion` (`motion` library, `UI_SPRING`, `REDUCED_MOTION_FADE_SECONDS`, `usePrefersReducedMotion`), the same spring the drawers and rows use (ADR-044, ADR-055 §5).
- **Mounted from:** `AuthGate.tsx` (NoProfiles, ProfileLayout, ProfileUnavailable) and `router.tsx` (the profile-less `/you`). Their call sites don't change: `HostedShell({ profile, children })` keeps its signature.
- **Retired:** `YouLinks.tsx` (it says "Temporary: MUT-426 replaces both with the island"), the interim Reports sidebar link, the `.hp-side*`, `.hp-nav`, `.hp-spacer`, `.hp-you-link*` styles, `--hp-sidebar-width`, and the `max-width: 760px` top-bar block.
  - `usePopover` and `.hp-popover` stay: `InGroupsLine` and `HeroFigures` still use them.

## Decisions (engineering, mine)

**E1. One DOM, fixed chrome, CSS places it.**
- `HostedShell` renders `<div class="hp-chrome">` (the fade bands and the three objects) followed by `<main class="hp-page">`. It stays one DOM for every width, as the AC requires and as today.
- The chrome is `position: fixed`, and the document still scrolls (no inner scroll container), so the browser's own scroll restoration, `scrollIntoView`, and the drawers keep working as today.
- **Placement:**

  | | Desktop (> 760px) | Phone (≤ 760px, today's breakpoint) |
  |---|---|---|
  | Pill | top centre | bottom centre |
  | You island | top inline end, name + avatar | beside the pill at the bottom, avatar circle only |
  | Reports icon | top inline start | top inline end |

- **DOM order is Reports → pill → island.** That matches the reading order on both layouts (desktop start → centre → end; phone top → bottom). The keyboard AC is "the tabs and the island are reachable in order".
- **Stacking:** chrome `z-index: 15`. That keeps it above page content, below `.hp-popover` (20), and below `.drawer-overlay` (200) and toasts.
- **Page padding:** `.hp-page` reserves `--hp-chrome-top` (desktop) or `--hp-chrome-bottom` (phone), plus `env(safe-area-inset-bottom)`.
  - `hosted.html`'s viewport meta gains `viewport-fit=cover`. Without it, `env(safe-area-inset-bottom)` is 0 and the pill sits on the iPhone home indicator.
- **On a phone, toasts lift above the pill.** `.hp-toast` uses `inset-block-end: calc(var(--hp-chrome-bottom) + var(--space-3))`.
- **`@media print`** hides `.hp-chrome`. Reports pages get printed.

**E2. Glass is three tokens and one class.**
- `--hp-glass-bg`, `--hp-glass-edge` and `--hp-lift` go on `:root`, with dark values under theme.css's three-selector pattern (`prefers-color-scheme: dark` guarded by `:root:not([data-theme="light"])`, and `:root[data-theme="dark"]`).
- `.hp-glass` = that background + `backdrop-filter: blur(20px) saturate(180%)` + `--hp-lift`.
- **Solid fallbacks:** `@supports not (backdrop-filter: blur(1px))` and `@media (prefers-reduced-transparency: reduce)` both give `--surface` and no filter. The landing page already does the second (`LandingPage.css:71`).
- **The fade is not a mask.** The document scrolls, so a mask on a scroll container (the wireframe's `.edge-top`) doesn't apply. Instead, two fixed, `pointer-events: none` bands sit under the objects: a top band on every width, and a bottom band on a phone. Each is a `linear-gradient` from `--surface-page` to transparent.
- No bars or dividers: nothing in the chrome has a border.
- Text on glass uses the AAA inks (brand v2). The axe check in the shell spec runs over a scrolled page, so the pill sits over content.

**E3. Page motion is a pure rule plus one effect.**
- New pure module `src/hosted/shell/pageMotion.ts` defines:
  - `pageMotionOf(prev, next): 'forward' | 'back' | 'island' | 'fade' | 'none'`;
  - `depthOf(pathname)`, where the four destination pages, `/expenses/groups` (Spent's second tab) and `/reports` are 0, and receivables, conversions, documents, a client and a group are 1.

  | From → to | Motion |
  |---|---|
  | same pathname (filters, `?tx=`, any search change) | none |
  | first render | none |
  | anything → You (`isYouPath`) | island |
  | You part → You part (Profiles · Account · App) | none (the segmented control's own swap) |
  | You → anything | back (the wireframe's `anim: wasYou ? 'back'`) |
  | other profile (the id segment differs) | fade (the profile view remounts anyway: `ProfileLayout` keys on the id) |
  | depth up, same profile | forward |
  | depth down, same profile | back |
  | same depth, different page (tab to tab, Reports) | fade |

- **Direction comes from depth, not history.** Browser Back from a client to Clients slides back, and so does the page's own back link.
- New `src/lib/motion/pageEnter.ts`:
  - `pageEnterFrom(kind, { rtl, reducedMotion, phone })` returns the start frame:
    - forward: x +32px × s;
    - back: x −32px × s;
    - island: scale .94, x +24px × s, origin at the island's corner (top end on desktop, bottom end on a phone);
    - fade: opacity only.
  - Reduced motion makes every kind opacity-only over `REDUCED_MOTION_FADE_SECONDS`.
  - `playPageEnter(el, …)` animates from that frame to rest on `UI_SPRING`, the same shape as `playRowEnter`.
- `HostedShell` holds a ref on `<main>` and runs one `useEffect` on the pathname. The effect reads the previous pathname from a ref, which it updates inside the effect. It sets no state, so it stays clear of the react-hooks v7 set-state-in-effect rule.
- Only the incoming page animates (enter-only, like the wireframe). Nothing is snapshotted.
- RTL is read from `document.documentElement.dir`, as `playRowEnter` reads `closest('[dir]')`.

**E4. The island is a link, never a button that navigates.** New `src/hosted/shell/YouIsland.tsx`:
- **Off the You page:** it links to `youPath(profileId, 'profiles')`, with `?from=sectionOf(pathname)` (MUT-425 D3/D8: profile-less `/you` when there's no profile).
- **On the You page** (`isYouPath`), it is lit (`aria-current="page"`, `.hp-island-on`). A second press leaves to `switchTarget(profileId, from)`, the section the person came from, and `/` with no profile. It never uses history Back (MUT-425 D4).
- **Content:**
  - the profile name, on desktop only (`dir="auto"`, ellipsis at a max width);
  - the avatar (`initialsOf(me.user.displayName)`), ringed in the profile's colour (B1);
  - with no profile: the avatar with a neutral ring.
- **Accessible name:** "You · {profile name}", via new key `hosted.shell.island`. On a phone the name isn't visible, but it is in the label.
- The "Hosted" chip that `YouLinks` showed is dropped. You › Profiles shows each profile's kind (`ProfileKindLine`).

**E5. The pill is today's nav, moved.** New `src/hosted/shell/ShellTabs.tsx`:
- It holds the current `DESTINATIONS.map(Link …)` block, unchanged: `activeOptions={{ exact: true, includeSearch: false }}`, with the lit tab from `destinationOf`.
- It renders only when there's a profile and it isn't LOCKED (MUT-361), as today.
- `aria-label` stays `hosted.shell.sections`.

**E6. Reports corner icon.** New `src/hosted/shell/ReportsCorner.tsx`:
- A `Link` to `/p/:id/reports` with a new `ChartIcon` (in `components/Icons.tsx`, 18px, `currentColor`).
- `aria-label` = `hosted.reports.title`. It is lit (`aria-current="page"`) on Reports.
- It shows under the same rule as the pill.
- The interim sidebar link goes.

**E7. One test file per new unit, and the shell test proves the AC.**

## Decisions for Basel

**B1. Where does "the profile's colour" come from?** Profiles have no colour today: `HostedProfile` has no colour field, and nothing in the portal or the phone assigns one.
- **(Recommended)** The portal derives it from the profile id. A stable hash picks one of 6 brand-checked ring colours, so it's the same on every device, with no server or phone change. Two profiles can share a colour (about a 1-in-6 chance per pair). The name, not the colour, carries identity on desktop.
- Alternatively, the colour comes from the profile's position in `/v1/me`. That's distinct for up to 6 profiles, but a profile's colour changes when one is added before it.
- Or a server-stored colour the person picks. That needs an API change, a migration and phone work. It's a new ticket, not this one.

**B2. The wordmark leaves the chrome.** The wireframe has none, and the AC says "No sidebar or header bar".
- **(Recommended)** The wordmark goes from the signed-in shell. "MTB3A / متابعة" still names the product in the tab title, on sign-in and on You › App. QA feature `shell.mtb3a-name` (MUT-402) changes from "the sidebar names the product" to "the tab title and You › App name it".
- Alternatively, keep a small mark in a corner. That adds a fourth floating object.

**B3. The trial banner as one quiet line on Owed.** Today it is an info banner: icon, "N days left in your free trial · Add a card", a second line with the end date, and Hide.
- **(Recommended)** Keep one line of muted text: "N days left in your free trial · Add a card · Hide". There's no icon and no box. The end-date line goes, and You › Account's Billing row already shows the trial (MUT-425 D6).
- The MUT-418 rules stay: Hide snoozes it for 3 days on the server, it can't be hidden in the last 3 days, and "Add a card" shows only when a card can be taken.

**B4. On a phone the island is a circle with no name** (wireframe). The AC asks that "the active profile (the island's name and ring)" is always visible.
- **(Recommended)** Follow the wireframe: a ring-only circle, with the name in its label. The page title and the You page name the books.
- Alternatively, show the name in small text above the page title on a phone. That would be a second place the name appears, which the wireframe's variation 1 was rejected for.

**Carried over:** المصروف for Spent still needs Basel's ok (MUT-424). The pill makes the word permanent chrome.

## Files

| File | Change |
|---|---|
| `src/hosted/shell/HostedShell.tsx` | Sidebar → `.hp-chrome` (fade bands, `ReportsCorner`, `ShellTabs`, `YouIsland`) + `<main ref>` with the page-motion effect. Wordmark import goes (B2). |
| `src/hosted/shell/ShellTabs.tsx` | new (E5) |
| `src/hosted/shell/YouIsland.tsx` | new (E4) |
| `src/hosted/shell/ReportsCorner.tsx` | new (E6) |
| `src/hosted/shell/profileRing.ts` | new: `ringColorOf(profileId)` (B1), pure |
| `src/hosted/shell/pageMotion.ts` | new: `depthOf`, `pageMotionOf` (E3), pure |
| `src/lib/motion/pageEnter.ts` | new: `pageEnterFrom`, `playPageEnter` (E3) |
| `src/hosted/shell/YouLinks.tsx` | deleted |
| `src/hosted/components/Icons.tsx` | `ChartIcon` |
| `src/hosted/components/TrialBanner.tsx` | one line (B3) |
| `src/hosted/hosted.css` | chrome, glass, fade bands, island ring, phone placement, toast lift, print. Remove the sidebar/top-bar rules and `--hp-sidebar-width`. |
| `hosted.html` | `viewport-fit=cover` |
| `src/hosted/i18n/en.json`, `ar.json` | `hosted.shell.island`. Drop the keys only `YouLinks` used (`hosted.shell.switcher.*` and `hosted.shell.account`, if nothing else reads them: grep at build time). |
| `.claude/designs/hosted-portal.md` §7.1 | the floating shell |
| `.claude/DECISIONS.md` | ADR (next free number at build time, after ADR-192): floating chrome, depth-driven page motion, the profile colour rule |
| `COMPONENT_REGISTRY.md`, `PATTERNS.md`, `CHANGELOG.md`, `SYSTEM_OVERVIEW.md`, `TEST_PLAN.md`, `TECH_DEBT.md` | per CLAUDE.md. PATTERNS gets "glass chrome" and "page enter by depth". |

## Tests (written first)

**Unit (vitest):**
- `shell/__tests__/pageMotion.test.ts`: every row of the E3 table, plus:
  - Owed → Receivables is forward, and Receivables → Owed is back;
  - Clients → a client is forward, and that client → Documents is fade (same depth);
  - Reports ↔ a tab is fade;
  - `/p/a/payments` → `/p/b/payments` is fade;
  - `/p/a/you` → `/p/a/you/account` is none;
  - leaving You is back;
  - a search-only change is none.
- `lib/motion/__tests__/pageEnter.test.ts`:
  - the start frame's x sign flips in RTL for forward, back and island;
  - reduced motion is opacity-only for every kind;
  - the island origin is the top end on desktop and the bottom end on a phone, mirrored in RTL.
- `shell/__tests__/profileRing.test.ts`: the same id gives the same colour; every result is in the palette; the palette passes the ring-contrast check against `--surface` in light and dark.
- `shell/__tests__/HostedShell.test.tsx` (new). On each mount state (profile / locked profile / no profile / profile-less `/you`):
  - no `complementary` landmark and no `banner`;
  - the pill has 4 links in `DESTINATIONS` order, and only the lit one has `aria-current`;
  - the island's href carries `?from=` off You;
  - on You the island has `aria-current` and its href is `switchTarget(id, from)`;
  - a locked profile has no pill and no Reports, but does have the island;
  - with no profile there's only the island;
  - Reports has `aria-current` on `/reports`;
  - DOM order is Reports → tabs → island.
- `components/__tests__/TrialBanner.test.tsx` updated for one line. Hide, the last-3-days rule and the sellable rule are kept.
- **Migrated tests:** anything that queried `YouLinks` (`hp-you-link-*`, "Account: …", the switcher label) is moved to the island's name. Grep at build time; `UsageConsent.test.tsx` is one.

**Release-QA (portal, Playwright):**
- `qa/features/portal/shell.yaml`:
  - **`navigate`:** its steps say "the pill" instead of the sidebar.
  - **`mtb3a-name`:** reworded per B2.
  - **new `floating-chrome`** (tier core): on desktop the pill is top centre, the island top end and Reports top start. On a 375px phone, the pill and the island circle are at the bottom and Reports at the top end. There's no header bar and no sidebar, no horizontal scroll at 320px in English and Arabic, and Arabic mirrors every position.
  - **new `island`:** the island shows the profile's name and ring. Pressing it opens You › Profiles and lights it. Pressing it again returns to the section you came from (`?from=` kept). Any tab also leaves.
  - **new `page-motion`:** Owed → Receivables slides toward the inline end, and its back link slides the other way, both negative in Arabic. The You page grows from the island. Reduced motion moves nothing on x.
    - It reuses `qa/support/motion.ts`. That may need a `traceEnter` beside `traceExit`, since the page enters rather than leaves.
  - **new `reduced-transparency`:** with `prefers-reduced-transparency: reduce` emulated through a Chromium CDP session (`Emulation.setEmulatedMedia`; Playwright's `emulateMedia` has no option for it), the pill's computed `backdrop-filter` is `none` and its background is opaque.
  - **new `keyboard`:** Tab from the page top reaches Reports, Owed, Paid, Spent, Clients, then the island, each with a visible focus ring. `aria-current` is on the lit tab, and on the island while on You.
- `qa/features/portal/billing.yaml`: the trial-banner feature's steps follow B3.
- **Specs updated** where they locate the sidebar or `YouLinks`: `shell`, `you`, `profiles`, `account`, `billing`, `terms`, `expense-groups`, `error-reports`, `local-mode`.
- **Run:** every portal spec once, which is also MUT-424's owed QA rerun. Then `release-qa lint`, with no new unmapped files.

**Verification gate** (on Node 22): `npm run lint && npm run typecheck && npm run test:run && npm run build`.

**Visual proof:** screenshots of desktop and 375px, English and Arabic, light and dark, plus one scrolled frame with content under the pill.

## Acceptance criteria → proof

| AC | Proof |
|---|---|
| No sidebar or header bar at any width; one DOM | HostedShell.test (no complementary or banner landmark; one chrome block); `floating-chrome` at 1280 / 375 / 320 |
| Active tab and active profile always visible | HostedShell.test (lit tab, island name); `island` + `floating-chrome` screenshots (B4 for the phone) |
| Keyboard order, visible focus, `aria-current` on the tab and on the island on You | HostedShell.test (order, aria-current); `keyboard` feature |
| RTL mirrors positions and slide directions | pageEnter.test (sign); `floating-chrome` + `page-motion` in Arabic |
| No regressions in portal QA; shell features updated; lint clean | the full portal run + `release-qa lint` |
| Scope: glass + fade, reduced transparency | `reduced-transparency` feature; scrolled screenshot |
| Scope: motion, including reduced-motion cross-fade | pageMotion.test, pageEnter.test, `page-motion` |
| Scope: trial line on Owed; usage prompt unchanged | TrialBanner.test; billing feature; UsageConsent.test untouched in behaviour |
| Comment 12498: Reports corner icon, lit on Reports | HostedShell.test; `floating-chrome` |

## Scale and cost

- No server change, no new request, no new dependency: `motion` is already in the bundle.
- `backdrop-filter` covers three small surfaces, not the page. The fade bands are plain gradients.
- Page motion is one transform/opacity animation per pathname change, composited, with no layout reads beyond one `getBoundingClientRect`.

## Out of scope

Search (epic D3), the Flutter app and the local web app (D4), a server-stored profile colour (B1, if wanted later), and any change to the You page's own content.

## Business / product impact

- The portal stops looking like an admin dashboard and starts reading like the place people check "who owes me". Every page gets back the 240px the sidebar took, and the phone gets a thumb-reachable tab bar instead of a scrolling top strip.
- This is the last ticket of epic MUT-423. It closes the epic and retires the interim sidebar that MUT-424 and MUT-425 left behind.
- The risk is presentational only. There are no URL, API or data changes, so universal links, mail and Stripe landings, and bookmarks are untouched (MUT-424 E1).

---

# Eng review (/plan-eng-review, 2026-10-25)

Target: `.claude/designs/mut-426-floating-shell-plan.md` (this file). Reviewer: Claude (in-host).

## Scope record

feature answers: none (no cuts proposed; every item is ticket scope or comment 12498); structure: B, Smaller arrangement (D1, Basel 2026-10-25); accepted scope: the plan's features unchanged, with `ShellTabs` and `ReportsCorner` inline in `HostedShell.tsx`, and `ringColorOf` exported from `YouIsland.tsx` (no `profileRing.ts`); pending remedies: B1, B2, B3, B4, A1, A2, A3, C1

Scope Challenge result: scope accepted as-is (the smaller arrangement keeps every feature).

## Scope Challenge findings

- **S1** [P2] (confidence: 9/10) plan E2 — "a `linear-gradient` from `--surface-page` to transparent". There is no `--surface-page`. The page background is `--bg` (`src/styles/theme.css:335` `background-color: var(--bg);`). **Correction:** the fade bands use `--bg`.
- **S2** [P2] (confidence: 9/10) plan E1 — "`.hp-page` reserves `--hp-chrome-top` (desktop) or `--hp-chrome-bottom` (phone)", but the same table puts Reports at the phone's top end, so a phone page's h1 would sit under the icon. **Correction:** on a phone, `.hp-page` reserves both: a top row for the Reports icon and its fade, and the bottom for the pill and the safe area.
- **S3** [P3] (confidence: 9/10) plan E3 table — "You → anything" and "other profile" both match leaving You for another profile. **Correction:** the table is ordered and the first matching row wins, so leaving You is always "back".
- **S4** [info] (confidence: 9/10) `ddca3901` MUT-79 "app frame: nothing floats over content" is the retiring local app's frame rule (`src/components/layout`), not the portal. Epic MUT-423 chose floating chrome for the portal. The ADR records that the portal differs on purpose, and says why: at rest nothing is hidden, because the page reserves the chrome's space.

## Decision ledger

### B1: Source of the island ring's profile colour
Finding: B1, P2, confidence 9/10. `src/hosted/api/schema.d.ts` `HostedProfile` has no colour field (id, name, source, defaultCurrency … billing). `src/hosted/local/carryOver/mapFreeAppBackup.ts:240` drops the free app's `primaryColor` (`business-details-dropped`). Reviewer: Claude.
Plan baseline: the original proposal (B1 recommended): a stable hash of the profile id picks one of 6 brand-checked ring colours.
Runtime evidence: no colour exists anywhere in the portal or the API today (static read).
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| B1 ring colour source | none (pending) | hash of profile id → 6-colour palette, client only | position in `/v1/me` → palette, client only | server-stored colour (new ticket); island ring neutral until then |
| Other rows | D1 approved (smaller arrangement); B2–B4, A1–A3, C1 pending | unchanged | unchanged | unchanged |
Question D2:
D2 — Where does the island ring's "profile colour" come from?
Project/branch/task: mini-crm main, planning MUT-426; the ticket says the island is "ringed in the profile's colour".
ELI10: Profiles have no colour today: not in the API, not in the portal, and the free app's colour is dropped when its data is carried over. So the ring needs a source. The cheapest is to compute one from the profile's id, so it's stable on every device. The catch is that two of your profiles can land on the same colour.
Stakes if we pick wrong: the ring is the only profile cue on a phone (B4). Same-coloured profiles there can't be told apart without opening You, and a colour that changes under you (option B) teaches the wrong thing.
Recommendation: A because it's stable across devices with zero API or phone work, and the name (desktop, label) still carries identity.
Note: options differ in kind, not coverage — no completeness score.
Header: Ring colour
Options:
A) Hash of profile id (recommended)
A stable hash of the profile id picks one of 6 brand-checked ring colours. Same on every device, no API, phone or migration change. Two profiles can share a colour (about 1 in 6 per pair). Human ~2h / CC ~10min; no ongoing maintenance.
B) Position in your profile list
The profile's index in /v1/me picks the colour. Distinct for up to 6 profiles, but a profile's colour shifts when a new one sorts before it. Human ~2h / CC ~10min; confusing when it shifts.
C) Neutral ring now, stored colour later
Ship a neutral ring and file a ticket for a colour the person picks (API field, migration, phone UI). Nothing to tell profiles apart by colour until then. Human ~2 days / CC ~2h for the later ticket.

State: approved
Actual answer: A) Hash of profile id (D2, Basel 2026-10-25)
Accepted scope: `ringColorOf(profileId)` in `YouIsland.tsx`: a stable hash of the id picks one of 6 brand-checked ring colours (light and dark), client only, with no API, phone or migration change. It's tested for stability, palette membership and ring contrast.
History: none

### B2: The wordmark in the signed-in shell
Finding: B2, P2, confidence 9/10. `src/hosted/shell/HostedShell.tsx` renders `<Wordmark className="hp-side-wordmark" markSize={SIDEBAR_MARK_SIZE} />` in the sidebar. `qa/features/portal/shell.yaml` `mtb3a-name` says "Sign-in and the sidebar name the product MTB3A". The ticket AC: "No sidebar or header bar at any width". The wireframe chrome has no wordmark. Reviewer: Claude.
Plan baseline: the original proposal (B2 recommended): the wordmark leaves the signed-in chrome, and MTB3A/متابعة stays in the tab title, on sign-in and on You › App.
Runtime evidence: the wordmark shows only in the sidebar on desktop and is hidden on a phone today (`hosted.css` `.hp-side-wordmark { display: none; }` under 760px). You › App does not show it today: `Wordmark` is used only by `HostedShell` and the auth pages (`AuthLayout`, `BootScreens`, `TermsUpdatePage`, `AccountClosingPage`), so option A adds it there.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| B2 wordmark | sidebar, desktop only | removed from the chrome; the tab title and sign-in name the product, and the `Wordmark` is added at the top of You › App; `mtb3a-name` reworded | a small mark in a fourth floating corner slot |
| Other rows | D1, B1 approved; B3, B4, A1–A3, C1 pending | unchanged | unchanged |
Question D3:
D3 — Does the MTB3A wordmark stay in the signed-in portal chrome?
Project/branch/task: mini-crm main, planning MUT-426; the sidebar is the only place the wordmark appears once you're signed in.
ELI10: The sidebar carries the MTB3A logo today, on desktop only. The new chrome is four tabs, the You island and a Reports icon, and the chosen wireframe has no logo. Dropping it keeps the chrome quiet: the browser tab and the sign-in page still name the product, and the logo moves to the top of You › App, which doesn't show it today. Keeping it in the chrome means a fourth floating object in a corner.
Stakes if we pick wrong: either the brand is missing from every signed-in screen, or the chrome gets busier than the design Basel picked.
Recommendation: A because the wireframe (picked "as is") has no logo, phones already show none, and the product name stays in the tab title and gets a home on You › App.
Note: options differ in kind, not coverage — no completeness score.
Header: Wordmark
Options:
A) Drop it from the chrome (recommended)
No logo in the signed-in chrome, as in the wireframe. The tab title and sign-in say MTB3A / متابعة, and the Wordmark moves to the top of You › App (new there). The QA feature mtb3a-name is reworded to match. Human ~1h / CC ~10min.
B) Keep a small mark in a corner
A small MTB3A mark floats in the free corner (desktop top start would clash with Reports, so it would have to go beside it). It adds a fourth object to the chrome and a placement to design. Human ~3h / CC ~20min.

State: approved
Actual answer: A) Drop it from the chrome (D3, Basel 2026-10-25)
Accepted scope: no wordmark in the signed-in chrome. `Wordmark` is added at the top of You › App. The tab title and sign-in keep naming the product. `qa/features/portal/shell.yaml` `mtb3a-name` is reworded to "sign-in, the tab title and You › App name the product", and its spec is updated.
History: none

### B3: The trial banner as "one quiet line on Owed"
Finding: B3, P2, confidence 9/10. `src/hosted/components/TrialBanner.tsx` renders a `section.hp-banner.hp-banner-info` with `<InfoIcon />`, a title (`hosted.billing.headline.trialDaysLeft` · "Add a card"), a second line (`trialBanner.endsOn` "Ends on {date}. You won't be charged until then." or `endsSoon` "Ends on {date}.") and "Hide for 3 days". The ticket says "The trial banner becomes one quiet line on Owed." Reviewer: Claude.
Plan baseline: the original proposal (B3 recommended): one muted line, "N days left in your free trial · Add a card · Hide". The date line is dropped (You › Account's Billing row shows the trial, MUT-425 D6). The MUT-418 rules are unchanged.
Runtime evidence: the banner shows only on Owed (`OverviewPage.tsx:65`). Hide snoozes it for 3 days on the server, it can't be hidden in the last 3 days, and "Add a card" shows only when sellable (static read).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| B3 trial notice form | info banner: icon, title, date line, Hide | one muted line: days left · Add a card · Hide for 3 days; no icon, no box, no date | one muted line that keeps the date: days left · ends {date} · Add a card · Hide for 3 days (wraps on a phone) |
| MUT-418 rules (snooze, last 3 days, sellable, analytics events) | as built | unchanged | unchanged |
| Other rows | D1, B1, B2 approved; B4, A1–A3, C1 pending | unchanged | unchanged |
Question D4:
D4 — What does the trial notice on Owed say once it's "one quiet line"?
Project/branch/task: mini-crm main, planning MUT-426; the ticket turns today's trial banner into one quiet line on Owed.
ELI10: Today's trial banner has an icon, "12 days left in your free trial · Add a card", a second line ("Ends on 6 Nov. You won't be charged until then.") and Hide. One line can't hold all of that on a phone. Option A keeps the count and the two actions and drops the date sentence, which already appears in You › Account › Billing. Option B keeps the date in the line, which wraps on a phone.
Stakes if we pick wrong: A loses the "you won't be charged until then" reassurance from Home, which may make people hesitate to add a card. B keeps it but stops being one line on a phone.
Recommendation: A because the ticket asks for one quiet line, and the count already says when it ends. The no-charge reassurance belongs where the card is entered: Billing's Subscribe step.
Note: options differ in kind, not coverage — no completeness score.
Header: Trial line
Options:
A) Count + actions only (recommended)
"12 days left in your free trial · Add a card · Hide for 3 days" in muted text, no icon or box. The date sentence leaves Home (Billing still shows the trial). MUT-418's snooze, last-3-days and sellable rules and events unchanged. Human ~1h / CC ~10min.
B) Keep the end date in the line
"12 days left · ends 6 Nov · Add a card · Hide for 3 days" in muted text. Keeps the date on Home, but wraps to two lines on a phone. Same MUT-418 rules. Human ~1h / CC ~10min.

State: approved
Actual answer: A) Count + actions only (D4, Basel 2026-10-25)
Accepted scope: `TrialBanner` renders one muted line, "N days left in your free trial · Add a card · Hide for 3 days", with no icon and no box. The `endsOn`/`endsSoon` line leaves Home, and their keys are removed if nothing else reads them. MUT-418's snooze, last-3-days, sellable rules and `trial_card_prompt_*` events are unchanged. `TrialBanner.test` and the billing QA feature are updated.
History: none

### B4: The phone island: ring only, or the name too
Finding: B4, P2, confidence 8/10. The ticket AC says "The active tab and the active profile (the island's name and ring) are always visible". The wireframe's phone island (`portal-shell-concepts.html` `wholeIsland(c, phone)`) renders only `<span class="avatar ring">` with no name. Reviewer: Claude.
Plan baseline: the original proposal (B4 recommended): follow the wireframe. A ring-only circle, with the profile name in its accessible label.
Runtime evidence: today's phone top bar shows the profile name (`.hp-you-link-profile { flex: 1 }` under 760px), so a ring-only island removes a visible name from the phone (static read).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| B4 phone profile cue | name in the top bar | ring colour (B1 hash) on the avatar circle; name in `aria-label` only | ring circle + the profile name in small muted text above each page's title |
| AC "active profile always visible" on a phone | met by the name | met by the ring (colour cue; can repeat across profiles per B1) | met by the name |
| Other rows | D1, B1–B3 approved; A1–A3, C1 pending | unchanged | unchanged |
Question D5:
D5 — On a phone, does the island show the profile's name or only its coloured ring?
Project/branch/task: mini-crm main, planning MUT-426; the AC says the active profile is always visible, but the wireframe's phone island is a ring-only circle.
ELI10: On a phone, the island sits beside the four tabs at the bottom, and there's no room for a name. The wireframe shows only your avatar ringed in the profile's colour. Today's phone top bar shows the profile's name. With hashed colours (D2), two profiles can share a ring, so on a phone the ring alone can't always tell your books apart.
Stakes if we pick wrong: a person with two same-coloured profiles might enter money in the wrong books on a phone. Adding the name back puts it in a second place, which round 4 variation 1 was rejected for.
Recommendation: A, because Basel picked the wireframe "as is" and most people have one or two profiles. This is a taste call with real risk, so B is a fair choice.
Note: options differ in kind, not coverage — no completeness score.
Header: Phone name
Options:
A) Ring only, as wireframed (recommended)
The phone island is the avatar ringed in the profile colour; the name is in its label for screen readers. Matches the chosen design. Two profiles may share a ring colour (D2). Human ~0 extra / CC ~0 extra.
B) Ring + name above the page title
Keep the ring-only island, and add the profile name in small muted text above each page title on a phone only. The books are always named on screen, but the name appears in a second place. Human ~2h / CC ~15min.

State: approved
Actual answer: A) Ring only, as wireframed (D5, Basel 2026-10-25)
Accepted scope: on a phone (≤ 760px) the island is the avatar circle ringed in `ringColorOf`, and the profile name is only in its `aria-label`. No extra name line. On a phone, the AC "active profile always visible" is met by the ring.
History: none

## Section 1 — Architecture

- **A1** [P1] (confidence: 8/10) plan E3: "`HostedShell` holds a ref on `<main>` and runs one `useEffect` on the pathname". `useEffect` runs after paint, so the new page paints once at rest, then jumps to its start frame and animates. That flash shows on every navigation. The router already has a built-in alternative: `@tanstack/react-router` 1.144.0 `defaultViewTransition?: boolean | ViewTransitionOptions` (`router-core/dist/esm/router.d.ts:144`), with `types: (info) => string[] | false` (`:513`). One caveat is verified in `router-core/dist/esm/router.js:766-790`: when the browser has `startViewTransition` but not view-transition types, the router calls `document.startViewTransition(fn)` with no types and ignores our function. That would cross-fade every navigation, including drawer opens (`?tx=`). So it must be enabled only when types are supported.
- **A2** [P2] (confidence: 9/10) `src/hosted/shell/youRoutes.ts:16` `SECTION_SEGMENTS = ['clients', 'receivables', 'payments', 'documents', 'expenses', 'conversions']` has no `reports`. Opening You from Reports carries no `from`, so the island's second press, and a profile switch, land on Owed instead of Reports.
- **A3** [P2] (confidence: 7/10) The wireframe's island toggle keeps the exact page (`portal-shell-concepts.html` `if (st[c].you) Object.assign(st[c], { you: false, anim: 'back' })` leaves `dest` and `client` as they were), but `from` carries only a section. Leaving You from a client, a group or a filtered list lands on the section's top page.

### A1: Page-motion mechanism
Finding: A1, P1, confidence 8/10, plan E3 + `router-core/dist/esm/router.d.ts:144,513` + `router.js:766-790`. Reviewer: Claude.
Plan baseline: the original proposal (E3): `motion` spring (`UI_SPRING`), enter-only, played from a `useEffect` on the pathname in `HostedShell` (`lib/motion/pageEnter.ts`).
Runtime evidence: the portal has no route loaders (`grep -c "loader:" src/hosted/router.tsx` = 0), so the new page renders as the location changes. Nothing in `src` uses view transitions today. TanStack falls back to a plain update when `document.startViewTransition` is missing (static read of `router.js`).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| A1 mechanism | E3: `useEffect` + `motion` spring, enter-only | router `defaultViewTransition: { types }` from the pure `pageMotionOf`, set only when view-transition types are supported. CSS keyframes per type on `::view-transition-old/new(root)`: the old page leaves and the new one arrives. The chrome gets its own `view-transition-name`, so it stays still. Reduced motion is a cross-fade. No `pageEnter.ts`. | `useLayoutEffect` (start frame set before paint) + `motion` spring as in E3, enter-only (the old page vanishes at once). Runs in every browser. Keeps `pageEnter.ts`. |
| Browsers without VT types (older Safari/Firefox) | n/a | no motion; instant swap | motion plays |
| `pageMotionOf` pure rule + its unit table | planned | kept: it returns the types | kept: it returns the kind |
| QA proof | planned `page-motion` | `document.getAnimations()` on the `::view-transition-new(root)` pseudo-element: direction sign, RTL, reduced motion | a `traceEnter` probe beside `traceExit` (`qa/support/motion.ts`) |
| Other rows | D1, B1–B4 approved; A2, A3, C1 pending | unchanged | unchanged |
Question D6:
D6 — How do pages slide: the browser's View Transitions through the router, or our own spring after render?
Project/branch/task: mini-crm main, planning MUT-426; the ticket asks for "going deeper slides forward, back slides the other way, the You page grows out of the island".
ELI10: The plan animated the new page from a React effect that runs after the browser has already drawn it, so you'd see a one-frame flash before every slide. Two ways fix it. A: TanStack Router can wrap each navigation in the browser's View Transitions, which snapshot the old page and the new one and slide them as a pair, with the floating chrome held still. B: keep our own spring, but run it before paint, so only the new page slides in.
Stakes if we pick wrong: A gives no motion in browsers without view-transition types, and enabling it carelessly would fade every drawer open. B is our own code to keep in step with routing, and the old page never leaves; it just vanishes.
Recommendation: A because it's the router's built-in path ([Layer 1]) and moves old and new pages the way the wireframe does. We gate it on view-transition types support, so drawers never fade.
Note: options differ in kind, not coverage — no completeness score.
Header: Page motion
Options:
A) Router View Transitions (recommended)
defaultViewTransition with types from the pure pageMotionOf, enabled only where view-transition types work; CSS keyframes slide old and new pages, the chrome stays put, reduced motion cross-fades. Browsers without types get no motion. No pageEnter.ts. Human ~1 day / CC ~40min.
B) Own spring before paint
useLayoutEffect sets the start frame before paint, then the motion spring (UI_SPRING) settles the new page; enter-only, in every browser, consistent with ADR-044. Keeps pageEnter.ts and a traceEnter QA probe. Human ~1 day / CC ~40min.

State: approved
Actual answer: A) Router View Transitions (D6, Basel 2026-10-25)
Accepted scope:
- **Router setup:** `createRouter` gets `defaultViewTransition: { types }` only when the browser supports view-transition types (feature test, e.g. `'types' in ViewTransition.prototype`). Otherwise it's left unset, so there's no untyped cross-fade on drawer opens.
- **`types`:** maps `pageMotionOf(from.pathname, to.pathname)` to `['forward'|'back'|'island'|'fade']`, or `false` for `none`.
- **CSS:** keyframes per type on `::view-transition-old(root)` / `::view-transition-new(root)` (`:active-view-transition-type(...)`), signs mirrored in RTL. `.hp-chrome` gets its own `view-transition-name`, so it holds still. Under `prefers-reduced-motion` every type is a cross-fade.
- **Removed:** `lib/motion/pageEnter.ts`, the `useEffect` in `HostedShell`, and the `traceEnter` probe.
- **QA:** `page-motion` reads `document.getAnimations()` for the root pseudo-elements (direction sign, RTL, reduced motion), and checks that a drawer open (`?tx=`) starts no view transition.
- **Unit tests:** cover `pageMotionOf` and the types mapping, including that a search-only change returns `false`.
History: none

### A3: Where the island's second press returns to
Finding: A3, P2, confidence 7/10. `portal-shell-concepts.html` island toggle keeps `dest` and `client`. `youRoutes.ts` `switchTarget(profileId, from)` returns `/p/${profileId}/${from}` (section only). Reviewer: Claude.
Plan baseline: the original proposal (E4): a second press leaves to `switchTarget(profileId, from)`, which is the section, never history Back (MUT-425 D4).
Runtime evidence: `from` holds only a `SectionSegment` (`parseYouSearch` keeps only known sections). Today, leaving You from `/p/x/clients/abc` via a link lands on `/p/x/clients`. Browser Back already returns to the exact page (static read).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| A3 island second-press target | section top (`switchTarget`) | section top, unchanged | the exact page you opened You from: a new `back` search param holding that page's in-profile path (path only, validated as `/p/<that profile>/<known segment>[/…]`, else ignored) |
| Profile switch from You › Profiles | section in the new profile (MUT-425 D3/D4) | unchanged | unchanged: switching still keeps the section, never the record |
| Other rows | D1–D6 approved; A2, C1 pending | unchanged | unchanged |
Question D7:
D7 — When you press the island again to leave You, do you go back to the exact page or to its section?
Project/branch/task: mini-crm main, planning MUT-426; the ticket says "a second press on the island leaves the page", and the wireframe returns to the exact page.
ELI10: If you open You from a client's page, pressing the island again today would take you to the Clients list, not back to that client. That's because the link only remembers the section, so a profile switch can never land on another profile's client. Option B adds a second, separate memory used only by the island: the exact page you came from, checked so it can only point inside that profile.
Stakes if we pick wrong: with A, people who peek at You from a client or a group lose their place and must find it again (filters are not kept in either option: B keeps the path only). B adds a URL parameter that must be validated so it can't be used to bounce people elsewhere.
Recommendation: B because it matches the wireframe and the cost is small. The path-only, same-profile check keeps it from becoming an open redirect.
Completeness: A=7/10, B=10/10
Header: Island return
Options:
A) Back to the section
Second press goes to the section's top page (e.g. Clients list from a client). Keeps today's from contract only. Human ~0 / CC ~0; people lose their place.
B) Back to the exact page (recommended)
A separate back param holds the page you came from, used only by the island; validated path-only and same-profile, else falls back to the section. Profile switching still keeps only the section. Unit-tested parse and QA step. Human ~3h / CC ~20min.

State: approved
Actual answer: B) Back to the exact page (D7, Basel 2026-10-25)
Accepted scope:
- **The `back` param:** a new `back` search param on the You routes holds the path of the page You was opened from. It is path only, with no query or hash. `youRoutes.ts` parses it, and it survives only when it matches `/p/<the same profile id>/` plus a known first segment: a destination segment, `reports`, or empty for Owed, never `you`.
- **Where it applies:**
  - The island off You links with `from` + `back`.
  - On You, the part tabs pass `back` through, as they do `from`.
  - The island's second press goes to `back`, else `switchTarget(profileId, from)`.
  - Profile switching ignores `back`: it keeps the section only (MUT-425 D3/D4 unchanged).
- **Tests:**
  - Unit tests: the parse accepts and rejects (another profile, `/you`, an absolute URL, `//host`, a query string).
  - The island test checks the href.
  - The QA step `island` covers client → You → island back to that client.
History: none

### A2: Reports as a kept section
Finding: A2, P2, confidence 9/10. `src/hosted/shell/youRoutes.ts:16` `SECTION_SEGMENTS = ['clients', 'receivables', 'payments', 'documents', 'expenses', 'conversions'] as const;` has no `reports`. Reviewer: Claude.
Plan baseline: the original proposal (E4): `?from=sectionOf(pathname)`, which carries nothing from Reports.
Runtime evidence: `sectionOf('/p/x/reports')` returns undefined. A profile switch made after opening You from Reports lands on the new profile's Owed. With D7, the island's second press already returns to Reports through `back` (static read).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| A2 `reports` in `SECTION_SEGMENTS` | absent: switching from Reports lands on Owed | added: switching keeps Reports (`/p/<new>/reports`); `youRoutes.test` gains rows | unchanged: switching from Reports lands on Owed |
| Island second press from Reports | via `back` (D7) | unchanged | unchanged |
| Other rows | D1–D7 approved; C1 pending | unchanged | unchanged |
Question D8:
D8 — If you open You from Reports and switch profile, do you land on the other profile's Reports?
Project/branch/task: mini-crm main, planning MUT-426; switching profile keeps the section you came from (MUT-425 D3), but Reports isn't on that list.
ELI10: When you switch books from the You page, the portal takes you to the same section in the other books, for example Paid to Paid. Reports came later (MUT-175) and was never added to that list, so switching from Reports drops you on Owed. Every profile has its own Reports page, so keeping it is safe.
Stakes if we pick wrong: someone comparing reports across their books has to find Reports again after every switch.
Recommendation: A because Reports is per profile and the fix is one word in a list plus test rows.
Completeness: A=10/10, B=6/10
Header: Reports kept
Options:
A) Keep Reports when switching (recommended)
Add 'reports' to SECTION_SEGMENTS so from=reports survives and switching lands on the other profile's Reports; youRoutes.test gets the rows. Human ~15min / CC ~3min.
B) Leave it out
Switching from Reports keeps landing on Owed, as today. No change.

State: approved
Actual answer: A) Keep Reports when switching (D8, Basel 2026-10-25)
Accepted scope: `'reports'` is added to `SECTION_SEGMENTS` in `youRoutes.ts`, so `sectionOf('/p/x/reports')` is `'reports'`, `from=reports` survives the parse, and switching lands on `/p/<new>/reports`. `youRoutes.test` gains the `sectionOf`, `parseYouSearch` and `switchTarget` rows. The `you.yaml` `switch-profile` steps are unchanged, plus one QA step: from Reports, switching lands on the other profile's Reports.
History: none

## Section 2 — Code quality

- **C1** [P2] (confidence: 6/10, medium confidence: verify on a device) plan E1 says "The chrome is `position: fixed`", with the pill at the bottom on a phone. iOS Safari does not keep fixed bottom bars reliably above the on-screen keyboard: [WebKit 202120](https://bugs.webkit.org/show_bug.cgi?id=202120), [WebKit 230225](https://bugs.webkit.org/show_bug.cgi?id=230225), and on iOS 26 a fixed footer is left misaligned after the keyboard closes ([Apple forums 800154](https://developer.apple.com/forums/thread/800154)). Page-level fields exist: `ClientsPage.tsx:65` `<SearchInput …>`, plus the list filters. Drawer fields are unaffected, because drawers overlay the chrome at z 200.
- **C2** [P3] (confidence: 5/10, estimated) The phone pill holds المستحق · المدفوع · المصروف · العملاء (`ar.json` `hosted.destinations`) beside a 40px island. At the wireframe's 13px with 8×10px padding, that's about 300px `[estimated]` against 288px usable at a 320px viewport with 16px gutters. **Correction (implementation of the plan's own no-horizontal-scroll check, no new behaviour):** below 360px the tab padding drops to `var(--space-1-5)` and the pill may shrink (`min-width: 0`). Labels never truncate. The `floating-chrome` QA step at 320px in Arabic proves it.
- **C3** [CRITICAL regression, carried forward] Deleting `YouLinks.tsx` puts MUT-425's link behaviour at risk. **Carried forward:** the exact approved regression contract (MUT-425 D3/D5/D8): `?from=` on every link into You, profile-less `/you` with `from` kept, exact active state on the current part. The island's tests assert each of these, and the migrated menu tests keep their assertions on the island. No new question.

### C1: The bottom pill while the phone keyboard is open
Finding: C1, P2, confidence 6/10; see C1 above. Reviewer: Claude.
Plan baseline: the original proposal (E1): the fixed chrome is always shown.
Runtime evidence: unknown on a device. The portal has page-level inputs (`ClientsPage.tsx:65`, list filters). The iOS behaviour is from the WebKit and Apple reports above, not from a probe.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| C1 bottom chrome while a page field has focus (phone ≤ 760px) | always shown (plan E1) | hidden while a text field, textarea or select inside `.hp-page` has focus (`.hp-shell:has(.hp-page :is(input, textarea, select):focus)` → `.hp-chrome-bottom { visibility: hidden }`), back on blur. QA step on a 375px Chromium viewport; a manual iPhone check is noted in the QA feature. | always shown; any iOS misplacement is accepted and fixed later if seen |
| Other rows | D1–D8 approved | unchanged | unchanged |
Question D9:
D9 — On a phone, should the bottom pill hide while you type in a page field?
Project/branch/task: mini-crm main, planning MUT-426; the pill sits fixed at the bottom of a phone screen.
ELI10: When you tap a search box on an iPhone, the keyboard slides up. Safari is known to misplace bars fixed to the bottom while the keyboard is up, and on iOS 26 even after it closes. The pill can end up floating over the field you're typing in, or stranded mid-screen. Hiding the bottom pill and island while a field on the page has focus avoids it, and they come back when you're done typing.
Stakes if we pick wrong: with B, iPhone users may see the pill covering the search field or stuck in the wrong place. With A, the tabs are briefly unavailable while typing, which matches how iOS apps behave.
Recommendation: A because it's one CSS rule (with :has()) that sidesteps a long-standing Safari bug class, and nobody switches tabs mid-typing.
Completeness: A=9/10, B=5/10
Header: Keyboard
Options:
A) Hide pill while typing (recommended)
On phones, the bottom pill and island hide while a field in the page has focus and return on blur (CSS :has, no JS). QA step at 375px; manual iPhone check noted. Drawers unaffected. Human ~1h / CC ~10min.
B) Always show it
Keep the pill fixed at all times; accept possible iOS misplacement with the keyboard and fix later if reported. No change.

State: approved
Actual answer: A) Hide pill while typing (D9, Basel 2026-10-25)
Accepted scope: on a phone (≤ 760px) the bottom chrome (pill + island) gets `visibility: hidden` while an `input`, `textarea` or `select` inside `.hp-page` has focus, through `.hp-shell:has(.hp-page :is(input, textarea, select):focus)` with no JS. It comes back on blur. Drawers are unaffected. The Reports corner at the top stays. There's a QA step at 375px (focus Clients search → the pill is hidden; blur → it's visible), and the QA feature notes a manual iPhone check.
History: none

## Section 3 — Tests

Framework (CLAUDE.md, Phase 4): Vitest (`npm run test:run`, Node 22) for unit and jsdom component tests. Release-QA Playwright for the portal (`qa/specs/portal/*.spec.ts`, `release-qa run --attach --only <id>`, `release-qa lint`).

```
CODE PATHS                                                   USER FLOWS
[+] shell/pageMotion.ts  pageMotionOf(prev, next)            [+] Move between pages
  ├── same pathname / first render → none   [GAP→unit]         ├── [GAP] [→E2E] Owed → Receivables slides forward, back link slides back
  ├── into You → island                     [GAP→unit]         ├── [GAP] [→E2E] Same in Arabic: signs mirror
  ├── You part → part → none                [GAP→unit]         ├── [GAP] [→E2E] Reduced motion: opacity only, no x
  ├── leaving You → back (first match wins) [GAP→unit]         └── [GAP] [→E2E] Drawer open (?tx=) starts no transition
  ├── other profile → fade                  [GAP→unit]       [+] The island
  ├── depth up / down → forward / back      [GAP→unit]         ├── [GAP] [→E2E] Press → You › Profiles, island lit (aria-current)
  └── same depth → fade                     [GAP→unit]         ├── [GAP] [→E2E] Client → You → island → that client (D7 back)
[+] router: viewTransitionOption()                             ├── [GAP] [→E2E] Any tab leaves You
  ├── types supported → { types: fn }       [GAP→unit]         └── [GAP] [→E2E] From Reports, switch profile → other's Reports (D8)
  ├── types unsupported → undefined         [GAP→unit]       [+] Chrome layout
  └── fn: search-only change → false        [GAP→unit]         ├── [GAP] [→E2E] Desktop: pill top centre, island top end, Reports top start
[+] shell/youRoutes.ts                                         ├── [GAP] [→E2E] 375px: pill + island bottom, Reports top end
  ├── sectionOf('reports') (D8)             [★★ extend youRoutes.test]  ├── [GAP] [→E2E] 320px ar/en: no horizontal scroll (C2)
  └── parseYouSearch back: same-profile ok; other profile,    ├── [GAP] [→E2E] Scrolled: content under glass, axe clean
      /you, absolute, //host, query → dropped [GAP→unit]       ├── [GAP] [→E2E] Reduced transparency (CDP): opaque, no filter
[+] YouIsland.tsx                                              ├── [GAP] [→E2E] 375px: field focus hides pill, blur shows it (D9)
  ├── ringColorOf: stable, in palette, contrast [GAP→unit]     └── [GAP] [→E2E] Keyboard: Reports → 4 tabs → island, focus visible
  ├── off You: href youPath + from + back   [GAP→unit]       [+] Trial line on Owed (D4)
  ├── on You: aria-current, href back|switchTarget [GAP→unit]  └── [★★ extend billing feature] one line, Add a card, Hide for 3 days
  ├── no profile: neutral ring, /you        [GAP→unit]
  └── phone: name only in label (D5)        [GAP→unit]
[+] HostedShell.tsx
  ├── no complementary/banner landmark      [GAP→unit]
  ├── pill: 4 links, one aria-current       [★★ moved from interim nav, re-pointed]
  ├── locked: no pill, no Reports, island   [GAP→unit]
  └── DOM order Reports → tabs → island     [GAP→unit]
[+] TrialBanner (D4)                        [★★ extend TrialBanner.test: one line; snooze/last-3-days/sellable unchanged]

COVERAGE (planned): every path above has a planned test; 0 paths left without one.
QUALITY target: unit ★★★ for pageMotionOf/back parse/viewTransitionOption (edges + rejects); E2E ★★ per flow.
```

Value cards (the critical ones):
- pageMotionOf table: Value: protects=slide direction per navigation; fails_when=a row reorders or depth map drifts; why_new=no motion rule exists; seam=none; no_claim=real rendering (pure function)
- back parse: Value: protects=island return cannot leave the profile or the site; fails_when=validation loosened; why_new=new param; seam=none; no_claim=none beyond protects
- viewTransitionOption: Value: protects=no untyped cross-fade on drawer opens; fails_when=gate removed; why_new=router.js:766-790 falls back to untyped VT; seam=none (takes the feature-test result as an argument); no_claim=browser VT behaviour (QA covers)
- page-motion E2E: Value: protects=forward/back/island/reduced motion in a real browser; fails_when=CSS keyframes or types mapping break; why_new=jsdom has no VT; seam=none; no_claim=non-Chromium browsers

Tests made obsolete: `YouLinks` assertions in `UsageConsent.test.tsx` and any `hp-you-link-*` queries move to the island (C3 contract). The interim Reports link assertions move to the corner icon.

Findings: no new test choices. All the proof above is required proof of approved behaviour (D1–D9, C3).

## Section 4 — Performance

No issues found. No server calls, queries or caches change. `backdrop-filter` covers three small fixed surfaces. A view transition takes one viewport-sized snapshot per pathname change and none on search-only changes (D6). The fade bands are static gradients. Scale: once per navigation, `[estimated]` well under one frame of main-thread work.
