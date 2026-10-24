# MUT-425 — The You page (Profiles · Account · App) replaces both menus

Epic MUT-423 (portal shell). Blocks MUT-426. Nothing blocks it. Sibling MUT-424 (four destinations) is Planned and independent: the two share no files except `HostedShell.tsx` (424 changes `SECTIONS`, this ticket changes the bottom and top of the sidebar) and the QA shell feature.
Design: `.claude/designs/portal-shell-concepts.html`, round 4, variation 3; its "Nothing lost" table is the checklist (§Checklist below).

## Goal

One calm page at `/p/:id/you`, split by a segmented control into Profiles, Account and App, holding every item in today's `ProfileSwitcher` and `UserMenu`. Every row opens today's drawer with today's URL keys. The two popovers go away.

## Decisions (proposed; E = engineering, D = needs Basel)

- **D1: This ticket removes both popovers.** The sidebar keeps working until MUT-426 replaces it: the switcher button becomes a link to `you` (Profiles) that still shows the open profile's name and the Hosted chip, and the account button becomes a link to `you/account` with the same avatar, name and email. No menu remains, which matches the ticket's title. `usePopover` stays, because expense groups use it.
  *Alternative:* keep the popovers until MUT-426. Every QA spec would then move twice, and both paths would ship side by side for one release.
- **D2: The segmented control is a set of links.** `SectionTabs` gets a `variant="segmented"` prop drawn as the wireframe's `.you-seg` pill. The three parts are routes (`/you`, `/you/account`, `/you/app`), so Back, deep links and reload all work, and the markup is a `<nav>` with `aria-current`, which is right for navigation. This extends an existing component rather than adding one (registry rule, 70%+ overlap).
  *Alternative:* `SegmentedControl` (a radiogroup) calling navigate on change. This is wrong semantics for routes and has no real links.
- **D3: Add a profile-less `/you` (also `/you/account` and `/you/app`).** `NoProfiles` and `ProfileUnavailable` render the shell with `profile=null`. Today the account menu is still there on those screens. Without the menus, a person with no profile, or one on a profile id they lost, would have no way to Billing, Change password, Language or Your data. Both routes render the same `YouPage`. The profile-less one has no active profile: no check mark, no Malafat rows, and switching lands on the profile's home. The ticket names only `/p/:id/you`, so this is the one addition to its scope.
- **D4: Switching from the You page goes back to the section you came from, in the new profile** (eng review D3, D4). The sidebar links (later the MUT-426 island) add `?from=<section segment>`. The You routes' `validateSearch` keeps `from` only when it is a known section segment. The part tabs carry it on, and the drawer hooks already spread the previous search, so opening or closing a drawer keeps it. `choose()` goes to `/p/<id>/<from>`, or to `/p/<id>` when there is no `from`. The row for the profile you're already in navigates the same way, never with history Back. This is what "keeps the section, as the switcher does today" means once the switcher is a page.
- **E1: The You page shows on a LOCKED profile.** `ProfileLayout` swaps `<Outlet/>` for `LockedScreen` today, so `/p/:id/you` would be the locked screen, and a locked person would lose Billing, Sign out and switching books. Fix: `locked && !isYouPath(pathname) ? <LockedScreen/> : <Outlet/>`, with `isYouPath` from `shell/youRoutes.ts`. AuthGate can't import the factory-built route objects (eng review C1). `LapseBanner` is unchanged.
- **E2: Billing's trial status comes from `/v1/me`, with no new fetch.** A pure `billingRowOf(me, profile, now)` goes in `data/trialPrompt.ts` and returns one of:
  - `{kind:'trial', daysLeft}`, from `runningTrial`, ignoring the banner's snooze;
  - `grace`, `read-only` or `locked`, from `lapseNoticeOf`;
  - `null`.

  The row's sub-line uses the existing `hosted.billing.headline.*` and lapse strings where they fit. The billing query is never fetched by the page.
- **E3: Rows, not menu items.** The three menu-item components lose their `role="menuitem*"` roles and become rows. Their logic doesn't change.
  - `MalafatMenuItems` → `MalafatRows`: the link plus the "Show Malafat suggestions" switch, which the wireframe drops and the "nothing lost" rule keeps.
  - `UsageMenuItem` → `UsageSwitchRow`, a `role="switch"` button.
  - `AppDownloadMenuItems` → `AppDownloadRows`: one row per platform, with the same `storeLinkUrl` logic and "coming soon".

  Renames are done in place, with no copies.
- **E4: Language reuses `LanguageSwitch`** from `components/Brand`, the control in today's menu, unchanged.
- **E5: No new data, no API change, no Dexie change.** Everything comes from `useMe()`, `useIsLocalMode()` and the two drawer hooks.

## The page

`src/hosted/pages/you/YouPage.tsx` (props: `part: 'profiles'|'account'|'app'`, `profile: HostedProfile|null`):

- **Header:** a large avatar (initials, moved from `UserMenu`'s `initialsOf` into `shell/initials.ts`) with `h1` name and LTR email; or "On this device" with no email when signed out (`hosted.local.onThisDevice`).
- `SectionTabs variant="segmented"` with Profiles / Account / App.
- **Profiles** (`YouProfiles.tsx`). The logic comes from `ProfileSwitcher`.
  - One row per `me.profiles`: name, the Hosted chip (hidden signed out), `ProfileKindLine`, and a check on the active one. A `button` with `aria-current="true"` marks the active profile.
  - **+ New profile:** `aria-disabled` at the cap, or when the lapse gate holds it, with the same two sub-lines as today. It calls `drawers.openNew()`.
  - **Manage profiles:** calls `drawers.openManage()`.
  - The local-profiles note, which shows only when signed in.
- **Account** (`YouAccount.tsx`).
  - Signed in:
    - Billing, with the E2 sub-line, opening `openBilling()`;
    - Your data, "Download my records", opening `openYourData()`;
    - Change password, opening `open()`;
    - then Sign out in its own group, with danger styling, `useSignOut`, disabled while signing out.
  - Signed out: Sign in (navigates to `/sign-in`), and Your data.
- **App** (`YouApp.tsx`).
  - Signed in:
    - a Preferences group: Language and `UsageSwitchRow`;
    - a More group: `MalafatRows` (eligible profile only), Terms (`termsHref`, a new tab) and `AppDownloadRows`.
  - Signed out: Language and Terms only.
- Every row is a full-width `.hp-you-row` (button or `<a>`) at least 44px tall, in the groups' `.box` style from the wireframe. It is logical-property CSS in `hosted.css`, so RTL needs no overrides, and it fits 375px with no sideways scroll.
- Drawers: no change. `ProfileDrawers` and `AccountDrawers` are already mounted by `HostedShell` on every route, `/you` included, and the URL keys ride on the You route's search.

## Files

| Layer | File | Change |
|---|---|---|
| Route | `src/hosted/router.tsx` | `youRoute` under `profileRoute` with path `/you`, plus children `/you/account` and `/you/app` (or one route with a `$part` param validated to the three; I prefer three static paths for type-safe links). Add the profile-less `/you*` under `authedRoute`, rendering `HostedShell profile={null}` + `YouPage`. `validateSearch: parseYouSearch` keeps `from` only when it is a known section segment (eng review D3). |
| Shared | `src/hosted/shell/youRoutes.ts` (new) | `YOU_PARTS`, `youPath(profileId\|null, part, from?)`, `isYouPath(pathname)`, `parseYouSearch`, and `SECTION_SEGMENTS` plus `sectionOf(pathname)`, moved out of `ProfileSwitcher`'s `SECTION_SEGMENT`. Pure and unit-tested. If MUT-424 lands first, `sectionOf` uses its `destinationOf`/routes list instead. |
| Page | `src/hosted/pages/you/YouPage.tsx`, `YouProfiles.tsx`, `YouAccount.tsx`, `YouApp.tsx` (new) | As above. |
| Shell | `src/hosted/shell/HostedShell.tsx` | Replace `<ProfileSwitcher>` and `<UserMenu>` with `<YouLinks profile>`. |
| Shell | `src/hosted/shell/YouLinks.tsx` (new) | The two sidebar links, each with `?from=<sectionOf(pathname)>`. With no profile they point to the profile-less `/you` (eng review C2). They are temporary: MUT-426 replaces them with the island. |
| Shell | `ProfileSwitcher.tsx`, `UserMenu.tsx` | Deleted. `ProfileKindLine` moves to `pages/you/YouProfiles.tsx`; `initialsOf` moves to `shell/initials.ts`. |
| Gate | `src/hosted/session/AuthGate.tsx` | E1: `LockedScreen` stays off the You route. |
| Data | `src/hosted/data/trialPrompt.ts` | E2: `billingRowOf`. |
| Rows | `components/MalafatPortal.tsx`, `UsageMenuItem.tsx` → `UsageSwitchRow.tsx`, `AppDownloadMenuItems.tsx` → `AppDownloadRows.tsx` | E3. |
| UI kit | `components/SectionTabs.tsx` | D2: `variant?: 'underline' \| 'segmented'`. |
| Style | `src/hosted/hosted.css` | `.hp-you-*`, `.hp-section-tabs--segmented`. Remove the dead `.hp-usermenu*`, `.hp-switcher*` and `.hp-menu-*` rules once nothing uses them (grep first: `hp-popover` is shared with groups). |
| i18n | `src/hosted/i18n/en.json`, `ar.json` | `hosted.you.{title,parts.profiles,parts.account,parts.app,groups.preferences,groups.more,billingSub.*,malafatSub,phoneApp,phoneAppSub}`. Reuse every existing key (`hosted.shell.switcher.*`, `hosted.auth.*`, `hosted.local.*`, `hosted.billing.title`, `hosted.terms.link`, `hosted.usage.toggle`, `hosted.malafat.*`, `hosted.appDownload.*`). Arabic first, both files in the same commit (the key-parity test enforces it). |

## Checklist ("Nothing lost", wireframe table → where it lands)

| Today | You page |
|---|---|
| Switch profile (keeps the section) | Profiles rows (D4) |
| Kind, Hosted, shared cue | Profiles row sub-line (`ProfileKindLine`) |
| + New profile (cap of 6, says why; lapse reason) | Profiles |
| Manage profiles | Profiles |
| Local-profiles note | Under Profiles, signed in only |
| Name and email / "On this device" | Header |
| Billing (trial status), Your data, Change password | Account |
| Sign out / signed out: Sign in, Your data | Account, Sign out set apart |
| Language, anonymous usage | App › Preferences |
| Malafat link **and** suggestions switch, Terms, phone app links | App › More |

## Tests (TDD: written first)

Unit and component tests (Vitest + RTL, under Node 22: `npx vitest run src/hosted`):

1. `shell/__tests__/youRoutes.test.ts`:
   - `sectionOf` for every section path, including `/expenses/groups/x` → `expenses`;
   - `youPath` with and without a profile;
   - `isYouPath`;
   - `parseYouSearch` keeps a known `from` and drops an unknown one.
2. `data/__tests__/trialPrompt.test.ts` (extend), `billingRowOf`:
   - a trial shows days left even while the banner is snoozed;
   - GRACE, READ_ONLY and LOCKED each map to their state;
   - a payer and signed-out both give null.
3. `pages/you/__tests__/YouPage.test.tsx`, signed in:
   - each part renders exactly its checklist rows;
   - the segmented tabs are links, and `aria-current` is set on the right one;
   - each row puts its drawer key on the URL: `newProfile`, `manageProfiles`, `billing`, `yourData`, `changePassword`;
   - at the cap, New profile is `aria-disabled`, says "N of 6 used", and opens nothing;
   - under the lapse gate it shows the lapse reason;
   - Malafat rows appear only on an eligible profile;
   - Sign out calls `useSignOut`.
4. The same file, signed out:
   - Profiles has no Hosted chip and no local note;
   - Account has Sign in and Your data only;
   - App has Language and Terms only;
   - nothing account-only is present (the guardrail).
5. Switching (D4):
   - with `?from=payments` it lands on `/p/B/payments`;
   - with no `from` it lands on `/p/B`;
   - with `?from=bogus` it lands on `/p/B`;
   - after a part-tab click, and after a drawer opens and closes, `from` is still on the URL;
   - picking the active profile goes to `/p/A/<from>` and never calls history back.
6. `session/__tests__/auth-states.test.tsx` (extend): a LOCKED profile renders the You page at `/p/:id/you` and `LockedScreen` at `/p/:id` (E1); no profiles plus `/you` renders the page.
7. `SectionTabs` segmented variant: it renders the variant class with the same link semantics.
8. Migrate the existing tests, rewritten against the page and not deleted:
   - `UserMenu.malafat.test.tsx` → `YouApp.malafat.test.tsx`;
   - `UserMenu.terms.test.tsx` → `YouApp.terms.test.tsx`;
   - `AppDownloadMenuItems.test.tsx` → `AppDownloadRows.test.tsx`;
   - `UsageConsent.test.tsx`;
   - the menu steps inside `local-mode`, `views`, `pressFeedback` and the drawer tests (`ChangePasswordDrawer`, `HostedYourDataDrawer`, `BillingDrawer`, `ProfileCreateDrawer`, `MalafatPortal`).

Release-QA (`qa/features/portal/you.yaml` + `qa/specs/portal/you.spec.ts`, tags `@portal.you.<id>`):

- `switch-profile`: from Payments, open You, pick another profile, and land on that profile's Payments.
- `drawers`: each row opens its drawer and Back closes it: New profile, Manage, Billing, Your data, Change password.
- `signed-out`: in local mode, You shows Profiles, then Sign in and Your data, then Language and Terms, and nothing else.
- `phone-375-rtl`: at 375px in Arabic, each part has no horizontal scroll (`scrollWidth <= clientWidth`), with a screenshot of each part.
- `locked`: a locked profile still reaches You › Account › Billing.

Migrate the 11 portal specs (10 in `qa/specs/portal`, plus `portal-live/billing` through its own `openYou` in `qa/support/livePortal.ts`, run only where the Stripe sandbox key exists; eng review O4) that open a menu (about 58 steps):

- `account`, `billing`, `expense-groups`, `local-mode`, `malafat`, `profiles`, `session`, `shell`, `terms`, `usage-analytics`, `your-data`;
- `portal-live/billing`.

They go through one new helper, `openYou(page, part)` in `qa/support/portal.ts`. Point the `paths:` of `shell.yaml` and the other features at the new files. Run `release-qa lint`: no errors, no new unmapped files. Run every changed spec until it passes (`release-qa run --attach --only <id>`).

Verification (Node 22): `npm run lint && npm run typecheck && npm run test:run && npm run build`.

## Regression contract (eng review D5)

Every rule below keeps an assertion after the menu tests and specs move to the page:

- Malafat rows show only on an eligible profile and never for someone already on Malafat. The suggestions switch keeps its state and shows the save-failed note.
- The usage switch is hidden when the build has no key, and never appears signed out.
- Terms shows in both modes, opening in a new tab.
- Store links show only when signed in. They come last on the App part and keep their coming-soon and available-name rows.
- New profile:
  - at the cap: `aria-disabled`, "N of 6 used", opens nothing;
  - under the lapse gate: the lapse reason.
- Each profile shows its kind, the Hosted chip (signed in only) and the shared cue.
- The local-profiles footer shows only when signed in.
- Each row puts its drawer's URL key on the URL: `newProfile`, `manageProfiles`, `billing`, `yourData`, `changePassword`. Back closes the drawer.
- Signed out: Sign in and Your data, and none of the account-only rows.
- Switching keeps the section. This is now asserted through `?from=`.

Retired on purpose, along with the popovers:

- menu roles (`menu`, `menuitem*`);
- Escape closes the menu;
- focus on the first item when the menu opens.

## Knowledge updates

- **A new ADR** (next free number at build time): "Account and profile settings are a page, not menus", covering D1–D4 and E1. It supersedes the menu descriptions in `hosted-portal.md` §7.1 and §7.2, and is cross-referenced from MUT-424's ADR.
- `COMPONENT_REGISTRY.md`:
  - `YouPage`;
  - the `SectionTabs` segmented variant;
  - the renamed rows;
  - `youRoutes`;
  - remove `ProfileSwitcher` and `UserMenu`.
- `CHANGELOG.md`, and `SYSTEM_OVERVIEW.md` (portal shell).
- `TEST_PLAN.md`.
- `TECH_DEBT.md`: the `YouLinks` sidebar stopgap until MUT-426.

## Acceptance criteria → proof

| AC | Proof |
|---|---|
| Every switcher and menu item is on the page, nothing lost in either mode | Checklist table; tests 3 and 4; QA `drawers` and `signed-out` |
| Switching keeps the current section | Test 5; QA `switch-profile` |
| 375px with no sideways scroll; Arabic and RTL correct | QA `phone-375-rtl` (en and ar screenshots) |
| Release-QA features and passing specs | `you.yaml` and `you.spec.ts`; the migrated specs pass; lint clean |

## Amendments from the eng review (binding; see the Decision ledger)

- O1: on a You path, `YouLinks` passes the current `from` through; `sectionOf` never returns `you`.
- O2: update the allowlist in `src/styles/__tests__/direction.test.ts:39`: remove `UserMenu.tsx`, add the LTR emails in `YouPage` and `YouLinks`.
- O3: `YouLinks` gets the phone top-bar rules that replace `.hp-switcher` and `.hp-usermenu-*` at ≤760px. QA `phone-375-rtl` also checks `.hp-side` on a section page, with a long Arabic name.
- O5: the CSS removal keeps `.hp-menu-item`, `.hp-menu-note` and `.hp-option-sub`, which groups and Manage profiles still use.
- O8: `SectionTab` gains an optional `search` field, and the Profiles tab is `exact: true`.
- D6: `billingRowOf(me, profile|null, now)` returns:
  - the trial, if one is running;
  - otherwise the open profile's lapse state;
  - the trial only when there's no profile.
- D7: a locked You page keeps `LapseBanner`.
- D8: profile-less links keep `?from=`.
- D9: `components/ProfileKindLine.tsx` is shared by `YouProfiles` and `ProfilesManageDrawer`.

## Out of scope

- The pill and the island: MUT-426.
- The four destinations: MUT-424.
- Passkeys: MUT-115 and MUT-415.
- Close account: MUT-333.
- An "All profiles" view (D6 on the epic).
- Search.
- No drawer is rewritten.

## Risks

- **QA churn:** about 58 menu steps across 11 specs. The `openYou` helper keeps it mechanical.
- **Merge order with MUT-424:** both touch `HostedShell.tsx` and `shell.yaml`. Small conflicts, and the second to land rebases.
- **The page could inherit `LapseBanner`, `UsagePrompt` and `TrialWelcomeOpener` from the shell.** That is acceptable and unchanged behaviour.

## Business / product impact

- The account menu has outgrown a popover (billing, Malafat, usage, terms, app links). Pilot users need Billing and the trial status where they can find them, and the self-serve and billing work (MUT-362, 418, 361) depends on that. Passkeys and Close account have a place to go without another redesign.
- It is the middle step of the MUT-423 shell: it unblocks MUT-426, and with it the Apple-style four-tab portal Basel picked.
- The risk is contained: no data, API or drawer changes. The risk is navigation and QA churn, and the checklist and migrated specs guard it.

---

# Eng review (/plan-eng-review, 2026-10-24)

Target: `.claude/designs/mut-425-you-page-plan.md` (this file, above the rule, as first drafted).

## Scope record

feature answers: none proposed; structure: A "Original arrangement" (D1, 2026-10-24); accepted scope: the plan as drafted, 6 new files (YouPage, YouProfiles, YouAccount, YouApp, YouLinks, youRoutes); pending remedies: R1, R2, R3.

## Decision ledger

### R1: Do the popovers go in this ticket or in MUT-426?
Finding: 1, P2, confidence 9, plan "D1" + src/hosted/shell/HostedShell.tsx:71 `{me.profiles.length > 0 && <ProfileSwitcher active={profile} />}` and :87 `<UserMenu profile={profile} />`; reviewer: Claude (eng review)
Plan baseline: original proposal, remove both popovers now, sidebar keeps two links to the You page.
Runtime evidence: 13 portal QA specs (~58 steps) and ~10 unit tests open these menus today (grep of qa/specs/portal, src/hosted).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 popovers | both live | removed in MUT-425; sidebar links to You | kept until MUT-426; You page reachable by URL and one extra sidebar link |
| QA migration | n/a | 13 specs move in MUT-425 | 13 specs move in MUT-426 |
| R2 switch origin | pending | pending | pending |
| R3 pick current profile | pending | pending | pending |
Question D2:
D2 — Remove the two menus now, or when the new shell lands?
(see AskUserQuestion payload of the same text)
Header: Menus
Options:
A) Remove now (recommended)
MUT-425 deletes ProfileSwitcher and UserMenu; the sidebar gets two plain links to the You page until MUT-426. All menu-driven QA specs move to the page here.
B) Keep until MUT-426
The menus stay; the sidebar gains one "You" link. MUT-426 removes the menus and migrates the specs.
State: approved
Actual answer: A) Remove now (D2, 2026-10-24)
Accepted scope: plan D1 as drafted: delete ProfileSwitcher.tsx and UserMenu.tsx, add shell/YouLinks.tsx, migrate the 13 menu-driven QA specs and the unit tests in this ticket.
History: none

### R2: How the page remembers which section you came from
Finding: 2, P1, confidence 7, plan "D4" (history state `{ youFrom }`) vs src/hosted/shell/AccountDrawers.tsx:24 `void navigate({ to: '.', search: (prev: Raw) => ({ ...omitShellOverlay(prev), ...next }), replace } as never);` (no `state`), and the part tabs are plain `Link`s; reviewer: Claude (eng review)
Plan baseline: original proposal, router history state set by the sidebar link.
Runtime evidence: unverified in a probe; TanStack Router 1.144 gives each navigate its own `state` (only `__TSR_key` when none is passed), so the first tab switch or drawer close would drop `youFrom` and switching would land on home.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R2 origin carrier | history state (draft) | in-memory `lastSection` store, set by the shell on every non-You route | `?from=<section>` search param, validated, carried by the part tabs | history state as drafted |
| Survives part tabs and drawers | no | yes | yes (tabs must pass it) | no |
| Survives reload | no | no, lands on home | yes | no |
| R1 menus | approved A | A | A | A |
| R3 pick current profile | pending | pending | pending | pending |
Question D3: see AskUserQuestion payload of the same title.
Header: Origin
Options:
A) In-memory store (recommended)
B) ?from= search param
C) History state as drafted
State: approved
Actual answer: B) ?from= search param (D3, 2026-10-24; Basel chose B over the recommended A)
Accepted scope: the sidebar link (and later the MUT-426 island) adds `?from=<section>`; the You routes `validateSearch` keep `from` only when it is a known section segment (`sectionOf` list in youRoutes.ts); the part tabs (`SectionTabs` segmented) carry `from` on; the drawer hooks already spread the previous search, so drawers keep it; switching goes to `/p/<id>/<from>` or `/p/<id>` without it; `from` never reaches a page (the You page is the only reader). Tests: youRoutes parse/validate, tab links keep `from`, drawer open+close keeps `from`, reload with `from` still lands on the section, an unknown `from` falls back to home.
History: none

### R3: Picking the profile you are already in
Finding: 3, P2, confidence 8, plan "D4": "Picking the profile you're already in only goes back."; reviewer: Claude (eng review)
Plan baseline: original proposal, history back.
Runtime evidence: on a deep link or fresh tab, history back leaves the portal (no prior entry).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R3 pick current | history back (draft) | navigate to `/p/<same>/<from>` or `/p/<same>`, like any other profile | history back |
| R2 origin | approved B (?from=) | B | B |
| R1 menus | approved A | A | A |
Question D4: see AskUserQuestion payload of the same title.
Header: Same profile
Options:
A) Same as any switch (recommended)
B) History back
State: approved
Actual answer: A) Same as any switch (D4, 2026-10-24)
Accepted scope: the active profile's row navigates like every other row (`/p/<id>/<from>` or `/p/<id>`); one test covers it.
History: none

### Factual corrections (no behaviour change, no question)
- C1 (Architecture, conf 9): E1 cannot use `useMatch({ from: youRoute.id })` in AuthGate: the router is built by `createPortalRouter` (src/hosted/router.tsx:84) and AuthGate can't import its route objects. Use `isYouPath(useLocation().pathname)` from youRoutes.ts.
- C2 (Architecture, conf 9): `YouLinks` with `profile === null` (NoProfiles, ProfileUnavailable; AuthGate.tsx:112 and :139) links to the profile-less `/you`, which is why plan D3 exists.
- C3 (Code quality, conf 9): the planned i18n key `hosted.you.backToSection` has no element that uses it; drop it (MUT-426 owns any back affordance).

### R4: Regression contract for the migrated menu tests
Finding: 4, CRITICAL (regression rule), confidence 9, src/hosted/shell/__tests__/UserMenu.malafat.test.tsx, UserMenu.terms.test.tsx, AppDownloadMenuItems.test.tsx, UsageConsent.test.tsx and 13 qa/specs/portal files assert menu roles; reviewer: Claude (eng review)
Plan baseline: original proposal, "rewritten against the page, not deleted" with no stated contract.
Runtime evidence: those tests pass today against the popovers.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| Behaviour kept | n/a | every visibility rule each test asserts (Malafat eligibility and never-on-Malafat, usage switch hidden without a key, terms in both modes, store links signed in only and last, coming-soon rows, New profile cap and lapse reason, kind/Hosted/shared cue, local footer signed in only, each drawer's URL key) | same assertions, no explicit list; reviewer judges at PR time |
| Intended differences | n/a | menu roles become rows/switches; Escape-closes and focus-on-open assertions are retired with the popovers; switcher "keeps section" assertions move to ?from= | unstated |
| R1/R2/R3 | approved A/B/A | unchanged | unchanged |
Question D5: see AskUserQuestion payload of the same title.
Header: Regressions
Options:
A) Written contract (recommended)
B) Judge at PR time
State: approved
Actual answer: A) Written contract (D5, 2026-10-24)
Accepted scope: the "Regression contract" section in the plan body; every listed rule keeps an assertion after migration; only menu roles, Escape-closes and focus-on-open are retired.
History: none

## Outside voice (Claude subagent, native fallback; Codex not installed)

Completed in about 2 minutes, inside the 5-minute timer. 10 findings. Verified against code: O2 (`src/styles/__tests__/direction.test.ts:39` `'src/hosted/shell/UserMenu.tsx': { ltr: 1 }, // email`), O3 (`src/hosted/hosted.css:480` `.hp-switcher { flex: 1; min-width: 0; }`, :482 `.hp-usermenu-who { display: none; }`), O4 (`qa/specs/portal/expense-groups.spec.ts:248` is the groups popover; `qa/specs/portal-live/billing.spec.ts:2` imports `livePortal`).

Corrections and proof already covered by earlier answers, so no question:
- **O1** (proof for D3): on a You path, `YouLinks` passes the current `from` through unchanged, and `sectionOf` never returns `you`. One test.
- **O2** (correction): update the `direction.test.ts` allowlist. Remove `UserMenu.tsx` and add the `YouPage` header and `YouLinks` LTR emails.
- **O3** (proof for AC 375px): the phone rules for `YouLinks` replace `.hp-switcher` and `.hp-usermenu-*` at ≤760px. QA `phone-375-rtl` also checks that `.hp-side` doesn't overflow on a section page, with a long Arabic profile name.
- **O4** (correction): migrate 11 specs, not 13.
  - `expense-groups` is out.
  - `portal-live/billing` gets its own `openYou` in `livePortal.ts`. It runs only where the Stripe sandbox key is available; otherwise say that it was not run.
- **O5** (correction): `.hp-menu-item`, `.hp-menu-note` and `.hp-option-sub` stay (groups and Manage profiles use them). Remove only `.hp-usermenu*`, `.hp-switcher*`, `.hp-menu-row` and `.hp-menu-sep`, after a grep shows no other users.
- **O8** (correction): `SectionTab` gets an optional `search` field. The Profiles tab is `exact: true`. Covered by test 7.
- **O9a** (correction): delete the Risks line about history state; `?from=` replaced it.

### R5: billingRowOf with no profile, and which status the Billing row shows
Finding: O7, Low, conf 8, `src/hosted/data/trialPrompt.ts:51` `export function lapseNoticeOf(me, profile)` needs a profile; the profile-less /you passes null.
Options: A) The row shows the person's trial plus the open profile's lapse state, and with no profile the trial only (recommended). B) The trial only, everywhere.
State: approved | Actual answer: A) Trial + profile (D6, 2026-10-24) | Accepted scope: `billingRowOf(me, profile|null, now)` returns the trial from `runningTrial`, else the open profile's `lapseNoticeOf`; null profile → trial only; test for each, the null case included.

### R6: A lapse banner on a locked profile's You page
Finding: O9b, Low, conf 8, `src/hosted/session/AuthGate.tsx:158` `<LapseBanner profile={profile} />` sits only in the unlocked branch.
Options: A) Show `LapseBanner` above the You page on locked and read-only profiles (recommended). B) No banner; the Billing row carries the status.
State: approved | Actual answer: A) Show the banner (D7, 2026-10-24) | Accepted scope: E1 renders `<LapseBanner/>` + `<Outlet/>` on the You route for locked profiles too; auth-states test asserts the banner on a locked You page.

### R7: `from` on profile-less links
Finding: O10, Low, conf 8; on `/p/bad/clients`, `sectionOf` returns `clients`.
Options: A) Let it apply: profile-less switching also goes to `/p/<id>/<from>` (recommended). B) Drop `from` on profile-less links.
State: approved | Actual answer: A) Keep the section (D8, 2026-10-24) | Accepted scope: `YouLinks` always adds `?from=sectionOf(pathname)`, profile-less too; profile-less switching goes to `/p/<id>/<from>`; one test.

### R8: One shared ProfileKindLine
Finding: O6, Low, conf 7, `src/hosted/components/ProfilesManageDrawer.tsx:160-163` renders the same line inline that `ProfileSwitcher.tsx:127` does.
Options: A) Extract `components/ProfileKindLine.tsx`, used by YouProfiles and ProfilesManageDrawer (recommended). B) Move it into YouProfiles only.
State: approved | Actual answer: A) Extract one (D9, 2026-10-24) | Accepted scope: `src/hosted/components/ProfileKindLine.tsx` with its own test; YouProfiles and ProfilesManageDrawer both use it; registry entry.

Approval readiness: PASS (R1 D2, R2 D3, R3 D4, R4 D5, R5 D6, R6 D7, R7 D8, R8 D9; corrections C1–C3, O1–O5, O8, O9a carry under those answers or change no behaviour)

## Review summary

- Step 0: Scope Challenge — scope accepted as-is (structure: original arrangement, D1)
- Reality rows: 7/7 tier-1 rows:
  - premise-table: the premises were checked against the code (TanStack 1.144, `LanguageSwitch`, `usePopover` users, `qa/support/portal.ts`, i18n parity test); unverified=1 (R2 runtime, no probe).
  - already-done: nothing on main since 2026-10-24 touches these files.
  - surface-check: n/a, no new CLI or HTTP surface.
  - binding-decisions: the epic's D1–D6 are honoured.
  - numbers: 58 steps and 11 specs, measured by grep.
  - deferred-asks: none.
  - pr-count: 1.
- Architecture: 4 (R2, R3, C1, C2)
- Code quality: 1 (C3)
- Tests: diagram produced, 1 regression contract (R4); 14/14 planned paths have a test
- Performance: 0
- NOT in scope: written ("Out of scope")
- What already exists: SectionTabs, SegmentedControl (rejected for route semantics), LanguageSwitch, the drawer hooks, the Malafat, Usage and AppDownload items (renamed in place), `trialPrompt` helpers
- TODOS.md: 0 proposed
- Failure modes: 0 critical gaps. The silent ones are now tested: `from` dropped (T5), a locked profile hiding You (T6), and phone top-bar overflow (O3 QA).
- Unresolved decisions: 0
- Outside voice: Claude subagent (native fallback, Codex not installed), completed, 10 findings, all dispositioned
- Parallelization: sequential implementation, no parallelization opportunity (one module, `src/hosted`)
- Lake Score: 8/9 answers picked the 10/10 or highest-scored option (D3 picked B, tied 9/10)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | Claude subagent (native fallback; codex not installed) | Independent 2nd opinion | 1 | unavailable (in-host completed) | 10 findings, all dispositioned |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open (all resolved in plan) | 6 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex: unavailable (not installed); native Claude Plan subagent completed within the 5-minute limit, 10 findings (4 Medium, 6 Low), all folded in as corrections or D6–D9.
- **VERDICT:** Eng review run, all 6 issues resolved in the plan; status issues_open by rule (issues_found > 0), so not CLEARED: eng review required to re-run for CLEAR, or accept as resolved.
NO UNRESOLVED DECISIONS
