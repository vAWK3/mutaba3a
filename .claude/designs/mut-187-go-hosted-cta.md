# MUT-187 — "Go hosted" CTA in the free web app

Status: **Planned, eng-reviewed (2026-10-14)**. Not built. Decisions D1–D4 approved by Basel in the eng review (ledger below); D10 added.
Build (2026-10-14, branch `feature/mut-187-go-hosted-cta`): the Settings row component is `HostedAccountEntry` (not `HostedProfileEntry`), following design D3; the browser check confirmed the 640 px threshold (card 111 px; nav 288 px at 700 px tall). ADR-076, TD-134/135.
Ticket: MUT-187 (Backlog at planning) · Epic MUT-185 · Blocked by MUT-186 (merged to local main a7d5068, Jira In Review → gate passes).

## 1. Problem and acceptance criteria

Free web users never learn hosted exists, and hosted users have no way from the free app to the portal.

| # | AC (ticket) | Proved by |
|---|---|---|
| A1 | Sidebar card above Settings: one line of value + "Go hosted" → /hosted; dismissible; returns after 30 days; dismissal stored locally; 30 days is a config constant | `goHosted.test.ts`, `GoHostedCard.test.tsx` |
| A2 | Settings › Businesses has a "Hosted profile" entry beside the profiles: one sentence, link to /hosted | `HostedProfileEntry.test.tsx` |
| A3 | "Already have an account? Sign in" → portal; portal URL from config | `HostedProfileEntry.test.tsx`, `vite.config` validation test |
| A4 | Links open /hosted in a new tab | both component tests (`target="_blank"`, `rel="noopener noreferrer"`, `href="/hosted"`) |
| A5 | Web build only; a test proves desktop renders neither card nor entry | `SidebarNav.goHosted.test.tsx`, `SettingsPage.goHosted.test.tsx` with `__BUILD_MODE__` stubbed `desktop` vs `web` |
| A6 | No network request (ADR-024); bundle or unit test | unit: spy `fetch`, `XMLHttpRequest.prototype.open`, `navigator.sendBeacon` through render → click → dismiss → zero calls. Bundle: `test:bundles` already fails on any unreviewed origin; the portal origin is added to the allowlist on review |
| A7 | EN + AR with RTL, keyboard-accessible | both component tests run in `ar`; logical CSS properties; Tab order + Enter/Space; focus after dismiss |
| A8 | Tests cover dismissal and the 30-day return | `goHosted.test.ts` (pure, fake `now`) + `GoHostedCard.test.tsx` (localStorage round-trip) |
| G | Brand v2 tokens; doesn't crowd the core four (ADR-034); all strings via i18n | card lives in `.sidebar-footer`, never in `.sidebar-nav`; tokens only (MUT-103 sweep rule) |

## 2. Decisions (★ = approved by Basel, eng review 2026-10-14)

- **D1 ★ Portal URL is a build-time value.** `MUTABA3A_PORTAL_URL` (env) → `__PORTAL_URL__` via Vite `define`, web mode only (desktop gets `""`). Validated as an https origin in `vite.config.ts` the way `MUTABA3A_PUBLIC_ORIGIN` is, so a bad value fails the build. Default `DEFAULT_PORTAL_URL` = today's Cloud Run `run.app` URL (no custom domain, deliberate; MUT-112 will change only this value). **Approved (D2). Input still needed: the exact run.app URL** — it isn't in the repo (DEPLOYMENT.md elides it). Link target is the portal root: a signed-out visitor lands on `/sign-in` by the portal's own guard, so we don't couple to its route names.
- **D2 ★ The sign-in link lives in the Settings entry, not on the card.** The card stays "one line + one button" as the ticket says; a hosted user who dismissed the card still finds sign-in in Settings. (Alt: also a small link on the card — more crowding in the footer.)
- **D3 ★ The card hides while the sidebar is collapsed.** A 64 px rail has no room for a sentence; Settings › Businesses is the always-there path. (Alt: an icon-only button — another unlabeled icon on the rail.)
- **D4 ★ The card hides during a visitor sample session (ADR-042).** The sample bar is that visitor's one call to action; the epic's "one suggestion at a time" spirit (MUT-189 rules) applies. The Settings entry still shows.
- **D5 Dismissal storage.** `localStorage['mutaba3a-go-hosted-dismissed-at']` = epoch ms. `GO_HOSTED_SNOOZE_DAYS = 30` exported from `src/lib/goHosted.ts`. Pure rule `isGoHostedCardDue(dismissedAt, now)`: missing / unparseable / in the future → due (a corrupt or clock-skewed value can never hide the card forever); otherwise due when `now - dismissedAt >= 30 days`. Storage that throws (private mode) → card shows; dismiss hides it for this tab only (state). No cross-tab sync (YAGNI). Not in Dexie: it's a per-browser UI preference like `sidebarCollapsed`, and must not travel in backups.
- **D6 Raw anchor, not router `Link`.** The router's basepath is `/app` on web, so `<Link to="/hosted">` would go to `/app/hosted`. Use `<a href={HOSTED_OFFER_URL} target="_blank" rel="noopener noreferrer">` (AboutSection precedent). `noreferrer` also keeps the referrer off the portal link.
- **D7 Build gate read at render time.** In `src/lib/goHosted.ts` (smaller arrangement, D1): `goHostedEnabled()` = `typeof __BUILD_MODE__ !== 'undefined' && __BUILD_MODE__ === 'web'`, and `hostedPortalUrl()` likewise for `__PORTAL_URL__` (empty → the sign-in link isn't rendered). Vitest defines neither global, so existing SidebarNav/Settings tests keep passing untouched (they see "not web"), and new tests `vi.stubGlobal` per case. Trade-off: Rollup won't fold a function call, so the desktop bundle carries the card's dead code (never rendered; no portal origin since desktop's `__PORTAL_URL__` is `""`). Acceptable while desktop is retired; no desktop bundle rule added (YAGNI).
- **D8 Focus after dismiss** moves to the Settings nav link (the card unmounts; focus must not drop to `<body>`).
- **D10 ★ Short screens.** The card hides under `@media (max-height: 640px)` so it never squeezes the nav (ADR-034); threshold confirmed by measuring at build (D6).
- **D11 Snapshot.** `scripts/__tests__/vite-config.test.ts` snapshots the web/desktop configs; the new `__PORTAL_URL__` define changes them, so the snapshot is updated deliberately in the same commit.
- **D12 Focus target.** After dismiss, focus goes to `footerRowRef.current?.querySelector('a.nav-item')` (Settings), so `renderNavItem` keeps its signature.
- **D9 "Next to New profile"** = a "Hosted account" row (design review D3) at the end of the Businesses section, below the list, not a second button in the section header (the header already holds "+ Add Profile"; two CTAs there compete).

## 2b. Design spec (approved in the design review, 2026-10-14)

Wireframe: `.claude/designs/mut-187-go-hosted-wireframe.html` (variant B, light/dark, EN/AR, short-window toggle).

```
Sidebar (240px, expanded, web build, sample = none, height >= 640px)
  header / profile switcher / + New
  nav (scrolls): Home  Clients  Income | More: ...
  footer
    +--------------------------------------+   <- GoHostedCard (role=group, aria-label "Hosted account")
    | Your records, on every device.   [x] |      16px body, --text; [x] 44x44, aria-label/title "Hide for 30 days"
    | ( Go hosted )                        |      .btn.btn-sm.btn-secondary -> /hosted, new tab
    +--------------------------------------+      1px --border, --radius-md, --surface, padding --space-3
    SYSTEM
    Settings  [theme]
```

| Element | Spec |
|---|---|
| Card | `role="group"` + `aria-label` "Hosted account" / "الحساب المستضاف"; 1px `var(--border)`, `var(--radius-md)`, `var(--surface)`, padding `var(--space-3)`, margin-bottom `var(--space-3)`. No new colours. Measured height in the wireframe: EN 117 px, AR 94 px. |
| Text | EN "Your records, on every device." / AR "سجلّاتك، على كل أجهزتك." 16 px body, `var(--text)`; inline-end padding clears the × |
| Button | `.btn btn-sm btn-secondary` anchor, EN "Go hosted" / AR "استضف سجلّاتك"; `href=/hosted`, `target=_blank`, `rel=noopener noreferrer`; sr-only " (opens in a new tab)" / " (يُفتح في علامة تبويب جديدة)" |
| Dismiss | `<button>` 44×44 hit area at the inline end, glyph stays small, `var(--muted)`; `aria-label` + `title` "Hide for 30 days" / "إخفاء لمدة 30 يومًا"; fades out 160 ms ease-out then unmounts, instant under `prefers-reduced-motion`; focus moves to Settings; no toast |
| Focus | `var(--focus-ring)` on button and ×; Tab order: Go hosted → × → Settings |
| Settings row title | "Hosted account" / "الحساب المستضاف" (not the ticket's "Hosted profile") |
| Settings row text | "The free app keeps everything on this device. A hosted account keeps it on our servers, so your phone and laptop show the same numbers." / "التطبيق المجاني يحفظ كل شيء على هذا الجهاز. أما الحساب المستضاف فيحفظه على خوادمنا، فيعرض هاتفك وحاسوبك الأرقام نفسها." |
| Settings row links | `.btn btn-sm btn-secondary` "See hosted accounts" / "اطّلع على الحسابات المستضافة"; then muted "Already have an account?" / "لديك حساب؟" + `var(--primary-hover)` link "Sign in" / "سجّل الدخول" (only when the portal URL is set). Both new tab with the sr-only suffix. |

## 3. Files

| Layer | File | Change |
|---|---|---|
| Build config | `vite.config.ts` | `DEFAULT_PORTAL_URL`, `portalUrl()` validation (https origin, no path), `__PORTAL_URL__` in local `define` (web = URL, desktop = `""`) |
| Types | `src/vite-env.d.ts` | `declare const __PORTAL_URL__: string;` |
| Config doc | `.env.example` | document `MUTABA3A_PORTAL_URL` beside `MUTABA3A_PUBLIC_ORIGIN` |
| Bundle allowlist | `scripts/bundle-origins.json` | add the portal origin to `local` (reviewed: a link target, never fetched) |
| Pure logic | `src/lib/goHosted.ts` (new) | `GO_HOSTED_SNOOZE_DAYS`, storage key, `isGoHostedCardDue`, `readDismissedAt`, `writeDismissedAt` (try/catch), `goHostedEnabled()`, `hostedPortalUrl()` |
| Component | `src/components/layout/GoHostedCard.tsx` + `.css` (new) | hook `useGoHostedCard()` inside (`{ visible, dismiss }` from storage + sample status + `Date.now()`); text, "Go hosted" anchor, dismiss button (`aria-label`); Brand v2 tokens, logical properties; hidden under `max-height: 640px` |
| Wiring | `src/components/layout/SidebarNav.tsx` | top of `.sidebar-footer`: `{goHostedEnabled() && !collapsed && <GoHostedCard onDismissed={focusSettings} />}`; a ref on `.sidebar-footer-row` |
| Component | `src/pages/settings/HostedProfileEntry.tsx` (new) | `settings-row`: title, one sentence, "See hosted" anchor, "Already have an account? Sign in" (only when `hostedPortalUrl()` is set) |
| Wiring | `src/pages/settings/SettingsPage.tsx` | `{goHostedEnabled() && <HostedProfileEntry />}` after the profiles list |
| Snapshot | `scripts/__tests__/__snapshots__/vite-config.test.ts.snap` | deliberate update for `__PORTAL_URL__` (D11) |
| i18n | `src/lib/i18n/translations/{en,ar}.json` | `nav.goHosted.{text,cta,dismiss,newTab}`, `settings.profile.hosted.{title,description,cta,signInPrompt,signIn}`; a visually hidden "(opens in a new tab)" |
| Knowledge | `.claude/{CHANGELOG,COMPONENT_REGISTRY,PATTERNS,DECISIONS,TEST_PLAN,INFRA}.md`, `TODOS`/TECH_DEBT if any | ADR for D1 (portal URL config) + D5; PATTERNS: "links out of the `/app` basepath are raw anchors"; INFRA: the env var; registry: GoHostedCard, HostedProfileEntry, goHosted helpers |

Reuse: `HOSTED_OFFER_URL` (MUT-186, made for this ticket); `useSampleSessionStore`; `settings-row` / `btn` styles; the AboutSection new-tab anchor pattern. Nothing in COMPONENT_REGISTRY does "dismiss for N days" today; `FeatureNoticeBanner` is dismiss-forever and Dexie-backed, so no extension.

## 4. Tests (written first)

- `src/lib/__tests__/goHosted.test.ts` — due when never dismissed; hidden at 0 s, at 29 d 23 h; due at exactly 30 d and after; garbage / negative / future value → due; read/write swallow a throwing storage.
- `src/lib/__tests__/goHosted.test.ts` (same file) — `goHostedEnabled()`/`hostedPortalUrl()`: undefined globals → `false` / `""`; stubbed `web` → `true`; stubbed URL returned as-is.
- `scripts/__tests__/vite-config.test.ts` (exists) — `portalUrl()`: https origin accepted (trailing slash dropped); `http://`, a path, junk → throws naming `MUTABA3A_PORTAL_URL`. The https-origin regex in `socialMetaTags` is extracted to one `assertHttpsOrigin(varName, value)` both use (DRY); its existing tests stay green.
- `src/components/layout/__tests__/GoHostedCard.test.tsx` — renders text + link (`href=/hosted`, `_blank`, `noopener noreferrer`); group labelled "Hosted account"; × named "Hide for 30 days"; dismiss writes the key and hides; remount within 30 d hidden, after 30 d shown (fake timers); focus lands on the `onDismissed` target; AR renders RTL strings; keyboard: Tab reaches link then dismiss, Enter dismisses; **no network**: spies on `fetch`, `XMLHttpRequest.prototype.open`, `navigator.sendBeacon` stay at 0 calls.
- `src/components/layout/__tests__/SidebarNav.goHosted.test.tsx` — `web` + expanded → card; `desktop` → none; collapsed → none; sample session `active` or `preparing` → none; core four order unchanged with the card present.
- `src/pages/settings/__tests__/HostedProfileEntry.test.tsx` + a SettingsPage case — web → entry, desktop → none; sign-in link uses the stubbed portal URL, absent when it's empty; AR.
- `scripts/__tests__/vite-config.test.ts` — web define carries the default portal URL, desktop `""`; snapshot updated (D11).
- Browser check (D6/D10): at 1440×600 the card is hidden, at 1440×800 it shows and the core four stay in view; screenshot in the PR notes, or a case in the `/hosted` QA spec ("sidebar card opens /hosted in a new tab" + height rule).

Run (Node 22, TD-054): `npm run lint && npm run typecheck && npm run test:run && npm run build && npm run test:bundles`.

## 5. Scalability / cost

Zero network, zero DB reads: one `localStorage` read per sidebar mount. No new dependency. Bundle: a few hundred bytes plus strings. Build: one env var with a validated default.

## 6. Risks / landmines

- Main is mid-merge of MUT-182 (2026-10-14): build in a fresh worktree off main only after that merge commits; ADR/TD numbers are assigned then.
- MUT-190 (Malafat suggestions, blocked by MAL-1153) will add rows to the same Settings area and has a "one suggestion on screen at a time" rule; when it's built, it must treat this entry as a suggestion. MUT-90 (web backup reminder) is another future nag; same rule. Note on both tickets, no code now.
- MUT-112 (custom domain) changes only `DEFAULT_PORTAL_URL` and the allowlist.
- Dev server: `/hosted` in `vite dev` is served by `hostedOfferDevRoute()` (MUT-186 gotcha); the link works in dev.

## 7. Out of scope

Desktop; analytics (MUT-152); any network call; hosted profiles inside the local app (ADR-037); landing callout (MUT-172); portal "Request one" link (MUT-188).

---

# Eng review (plan-eng-review, 2026-10-14)

Target: `.claude/designs/mut-187-go-hosted-cta.md` (sections 1–7 above are the original plan, unchanged).

## Scope record

feature answers: no cuts proposed; structure: B "Smaller arrangement" (D1, 2026-10-14); accepted scope: all ACs A1–A8 + G as written, new modules = `src/lib/goHosted.ts` (30-day rule, storage, `goHostedEnabled()`, `hostedPortalUrl()`) + `src/components/layout/GoHostedCard.tsx` (+ `.css`, hook inside) + `src/pages/settings/HostedProfileEntry.tsx`; no `src/lib/buildTarget.ts`, no `src/hooks/useGoHostedCard.ts`; pending remedies: R1–R5.
Scope Challenge result: scope accepted as-is (smaller arrangement, same scope).

## Review findings

### Section 1 — Architecture
- [P2] (confidence: 9/10) server/DEPLOYMENT.md:43 "served by the same Cloud Run service — no separate domain" and :158 "`https://mutaba3a-api-….a.run.app`": the portal URL isn't in the repo, so the plan's portal-URL config (brief D1) needs a value and a source of truth. → R1.
- [P2] (confidence: 6/10, medium: verify by rendering at 1440×600) src/index.css:265-274 `.sidebar-nav { flex: 1; … overflow-y: auto; }` / `.sidebar-footer { padding: var(--space-3); … }`: the footer never shrinks, so a ~110 px card comes out of the nav's scroll area. Estimate: header 64 + profile 56 + New 52 + footer 92 + card 110 ≈ 374 px fixed; at 600 px tall the nav keeps ~226 px, at 500 px ~126 px (three rows). → R5.
- [P3] (confidence: 8/10) brief D5 "No cross-tab sync": a second open tab keeps showing the card until it remounts. Accepted as written (plan baseline), no change.
- Product calls carried from the brief: D2 sign-in placement → R2, D3 collapsed rail → R3, D4 sample session → R4.

### Section 2 — Code quality
- [P2] (confidence: 9/10) scripts/__tests__/vite-config.test.ts:57-59 `it.each(['web', 'desktop'])('leaves the %s build exactly as it was' … toMatchSnapshot()`: adding `__PORTAL_URL__` to the local `define` changes both snapshots. Plan correction (no behavior choice): update the snapshot deliberately in the same commit and say so in the commit body; tests never set `MUTABA3A_PORTAL_URL`, so the default is what's recorded.
- [P3] (confidence: 9/10) src/components/layout/SidebarNav.tsx `{systemItems.map((item) => renderNavItem(item, true))}`: Settings is rendered through the shared `renderNavItem`, which has no ref seam. Plan correction: focus after dismiss goes through a ref on `.sidebar-footer-row` and `querySelector('a.nav-item')`, not a new ref parameter on `renderNavItem`.
- [P3] (confidence: 9/10) vite.config.ts:86 `if (!/^https:\/\/[^/\s]+\/?$/.test(origin))`: the plan's `assertHttpsOrigin` extraction has two callers (socialMetaTags, proposed portal URL); already in the plan, kept.

### Section 3 — Tests
See the coverage diagram below. Gaps were closed in the plan (§4); the one addition is the snapshot update above.

### Section 4 — Performance
No issues found. One `localStorage` read per sidebar mount, no network, no DB.

### Outside voice
Codex not installed (`CODEX_MODE: not_installed`); the native fallback needs TaskOutput, which this session doesn't have. Outside voice unavailable; no outside coverage.

## Decision ledger

### R1: Where the portal URL comes from (brief D1)
Finding: Section 1 #1, P2, confidence 9, server/DEPLOYMENT.md:43, native reviewer
Plan baseline: brief D1 (original proposal, not approved): env `MUTABA3A_PORTAL_URL` with a validated `DEFAULT_PORTAL_URL` in vite.config.ts.
Runtime evidence: no portal URL exists in the client code today; `MUTABA3A_PUBLIC_ORIGIN` uses exactly this env-plus-default shape (vite.config.ts:46, :120).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 portal URL source | none | env `MUTABA3A_PORTAL_URL`, default constant in vite.config.ts, https-validated | env only, set in netlify.toml `[build.environment]`; unset → sign-in link not rendered |
| R2–R5 | pending | pending | pending |
Question D2:
D2 — Where does the free app get the portal's address?
ELI10: "Already have an account? Sign in" has to link to the portal, which today lives at a Cloud Run run.app address. CLAUDE.md forbids hard-coding environment values in app code, so the address is read when the app is built. The question is whether a missing value falls back to a default kept in the build config (A), or just hides the link (B). Both need the real run.app address from you.
Stakes if we pick wrong: A ships a stale address if the default isn't updated at MUT-112; B quietly drops the sign-in link on any build missing the variable.
Recommendation: A because it copies the MUTABA3A_PUBLIC_ORIGIN shape that already exists, and a build always has a working link.
Completeness: A=9/10, B=7/10
Header: Portal URL
Options:
A) Env + default (recommended)
`MUTABA3A_PORTAL_URL` overrides a `DEFAULT_PORTAL_URL` constant in vite.config.ts, validated as https (a bad value fails the build). Every build, local ones included, has the link. MUT-112 changes one constant. ✅ Same shape as MUTABA3A_PUBLIC_ORIGIN. ✅ Snapshot test pins the default. ❌ A default address now sits in vite.config.ts and must move with the domain. Effort: human ~1h / CC ~5 min.
B) Env only, in netlify.toml
`MUTABA3A_PORTAL_URL` lives in netlify.toml `[build.environment]`; vite.config.ts has no default; unset → the sign-in link isn't rendered. ✅ No address in the build code. ✅ Netlify config is the one place to change. ❌ Local and preview builds have no sign-in link, so QA can't check it without setting the var. Effort: human ~1h / CC ~5 min.

State: approved
Actual answer: A) Env + default (D2, 2026-10-14)
Accepted scope: `MUTABA3A_PORTAL_URL` env overrides `DEFAULT_PORTAL_URL` in vite.config.ts; https-origin validated via the shared `assertHttpsOrigin`; injected as `__PORTAL_URL__` (web = URL, desktop = `""`); documented in .env.example; origin added to scripts/bundle-origins.json `local`; web/desktop snapshots updated deliberately. Needs the exact run.app URL from Basel before build.
History: none

### R2: Where "Already have an account? Sign in" lives (brief D2)
Finding: brief D2, product call, native reviewer
Plan baseline: brief D2 (original proposal): Settings › Businesses entry only.
Runtime evidence: n/a (new UI).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R2 sign-in link placement | none | Settings entry only | Settings entry + small link under the card's button |
| R1 portal URL | approved: env + default (D2) | same | same |
| R3–R5 | pending | pending | pending |
Question D3:
D3 — Where does "Already have an account? Sign in" go?
ELI10: People who already pay for hosted need a way from the free app to the portal. The ticket asks for the link but doesn't say where. Settings › Businesses is always there; the sidebar card is more visible but the user can hide it, and the ticket describes it as one line plus one button.
Stakes if we pick wrong: a hosted user who hid the card can't find sign-in (if only on the card), or the card gets crowded (if on both).
Recommendation: A because the card stays as the ticket describes it and Settings is the one place that never goes away.
Completeness: A=9/10, B=9/10
Header: Sign-in link
Options:
A) Settings entry only (recommended)
The Settings › Businesses "Hosted profile" row carries both "See hosted" and "Already have an account? Sign in". The card stays one line + one button. ✅ Matches the ticket's card spec word for word. ✅ Always reachable, can't be dismissed. ❌ A hosted user has to know to look in Settings. Effort: human ~30 min / CC ~5 min.
B) Settings entry + card
Same Settings row, plus a small "Already have an account? Sign in" text link under the card's button. ✅ Hosted users see it in the sidebar on first open. ✅ Settings still covers it after dismissal. ❌ Third line in the footer card, more height taken from the nav (see R5). Effort: human ~45 min / CC ~8 min.
State: approved
Actual answer: A) Settings entry only (D3, 2026-10-14)
Accepted scope: "Already have an account? Sign in" renders only in the Settings › Businesses "Hosted profile" row (when `hostedPortalUrl()` is non-empty); the card stays one line + "Go hosted" + dismiss.
History: none

### R3: The card on the collapsed rail (brief D3)
Finding: brief D3, product call, native reviewer
Plan baseline: brief D3 (original proposal): hidden while collapsed.
Runtime evidence: collapsed sidebar is 64 px wide (src/index.css `.sidebar.collapsed { width: 64px; }`).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R3 collapsed behaviour | none | hidden | icon-only button with tooltip |
| R1 portal URL | approved: env + default (D2) | same | same |
| R2 sign-in placement | approved: Settings only (D3) | same | same |
| R4–R5 | pending | pending | pending |
Question D4:
D4 — What does the card do when the sidebar is collapsed?
ELI10: The sidebar can shrink to a 64 px icon rail. A sentence and a button don't fit there. We either hide the card while collapsed (it comes back when expanded), or show a single icon that opens /hosted.
Stakes if we pick wrong: hidden means people who keep the rail collapsed never see the card (Settings still has the entry); an icon adds an unlabeled glyph that competes with the core nav icons.
Recommendation: A because the rail holds only navigation today, and Settings › Businesses always offers hosted.
Note: options differ in kind, not coverage — no completeness score.
Header: Collapsed rail
Options:
A) Hide when collapsed (recommended)
`!collapsed` gates the card; expanding brings it back if it's due. ✅ Rail stays navigation only, as ADR-034 keeps it. ✅ Nothing to dismiss in a form that can't show the dismiss reason. ❌ Users who live with the rail collapsed only meet hosted in Settings. Effort: human ~10 min / CC ~2 min.
B) Icon-only button
A small cloud icon with a tooltip and `aria-label` opens /hosted; no dismiss on the rail. ✅ Hosted stays visible in every sidebar state. ✅ Uses the existing tooltip pattern of collapsed nav items. ❌ An unexplained icon among Home/Clients/Income, and it ignores the dismissal. Effort: human ~1h / CC ~10 min.
State: approved
Actual answer: A) Hide when collapsed (D4, 2026-10-14)
Accepted scope: the card renders only while the sidebar is expanded (`!collapsed`); expanding shows it again if due; test case "collapsed → none".
History: none

### R4: The card during a visitor sample session (brief D4)
Finding: brief D4, product call, native reviewer
Plan baseline: brief D4 (original proposal): hidden while `useSampleSessionStore().status === 'active'`.
Runtime evidence: src/demo/sampleSessionStore.ts `status: 'none' | 'preparing' | 'active'`.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R4 sample-session behaviour | none | hidden while sample `active` or `preparing` | shown |
| R1 portal URL | approved: env + default (D2) | same | same |
| R2 sign-in placement | approved: Settings only (D3) | same | same |
| R3 collapsed rail | approved: hidden (D4) | same | same |
| R5 | pending | pending | pending |
Question D5:
D5 — Does the card show while a visitor is trying the sample business?
ELI10: Visitors from the landing page land in a sample business with a bar that says "this is sample data" and offers "Start with your own". If the hosted card also shows, they get two calls to action at once, before they've used the free app at all. The Settings entry shows either way.
Stakes if we pick wrong: hidden loses a few curious visitors who might have asked for hosted right away; shown splits attention on the very first screen.
Recommendation: A because the sample bar is that visitor's one next step, and the card appears as soon as they start with their own data.
Note: options differ in kind, not coverage — no completeness score.
Header: Sample session
Options:
A) Hide during sample (recommended)
The card renders only when `useSampleSessionStore().status === 'none'`. Leaving the sample ("Start with your own") brings it in. ✅ One call to action on a visitor's first screen. ✅ Matches the epic's "one suggestion at a time" rule from MUT-189. ❌ A visitor ready to pay now has to find Settings or the landing page. Effort: human ~15 min / CC ~3 min.
B) Show during sample
The card ignores the sample session. ✅ Visitors who came for hosted see it immediately. ✅ One less condition in the card and one less test case to keep. ❌ Two competing bars/cards on the sample's first screen. Effort: none.
State: approved
Actual answer: A) Hide during sample (D5, 2026-10-14)
Accepted scope: the card renders only when `useSampleSessionStore().status === 'none'` (hidden while `preparing` or `active`); the Settings entry ignores the sample; test case "sample active → none".
History: none

### R5: The card on short screens
Finding: Section 1 #2, P2, confidence 6, src/index.css:265-274, native reviewer
Plan baseline: not in the original plan (card always shown when expanded).
Runtime evidence: unverified estimate (see finding); no measurement yet.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R5 short-viewport behaviour | card always shown | hidden under `@media (max-height: 640px)`, threshold confirmed by measuring at /eng-build | always shown |
| R1 portal URL | approved: env + default (D2) | same | same |
| R2 sign-in placement | approved: Settings only (D3) | same | same |
| R3 collapsed rail | approved: hidden (D4) | same | same |
| R4 sample session | approved: hidden (D5) | same | same |
Question D6:
D6 — Should the card hide on short screens?
ELI10: The sidebar's bottom area doesn't shrink; the nav list above it scrolls. A ~110 px card takes that space from the nav. On a 600 px tall window the nav keeps room for about five rows; at 500 px about three, so optional areas scroll out of sight. This is my estimate from the CSS, not a measurement yet.
Stakes if we pick wrong: always shown can squeeze the nav to a sliver on small laptop windows; hiding means short-screen users only see hosted in Settings.
Recommendation: A because ADR-034 says nothing may crowd the core nav, and a CSS media query costs one rule.
Completeness: A=9/10, B=7/10
Header: Short screens
Options:
A) Hide under 640 px (recommended)
One CSS rule hides the card when the window is shorter than 640 px; /eng-build measures the real heights at 1440×600/700 and adjusts the threshold if the estimate is off. ✅ Core nav keeps its room on short windows. ✅ Pure CSS, no JS state or extra test seams. ❌ jsdom can't test media queries, so proof is a Playwright/manual check, not a unit test. Effort: human ~30 min / CC ~5 min.
B) Always show
No height rule; the nav scrolls as it does today with many optional areas. ✅ Every expanded sidebar shows the card. ✅ Nothing extra to build, test or check in a browser. ❌ On short windows the nav area can drop to about three rows. Effort: none.
State: approved
Actual answer: A) Hide under 640 px (D6, 2026-10-14)
Accepted scope: `GoHostedCard.css` hides the card under `@media (max-height: 640px)`; /eng-build measures the sidebar at 1440×600 and 1440×700 and adjusts the threshold if the estimate is off; proof is a browser check (preview screenshot or a Playwright case in the /hosted QA spec), recorded in TEST_PLAN.
History: none

Approval readiness: PASS — R1 (D2), R2 (D3), R3 (D4), R4 (D5), R5 (D6); structure (D1). No pending choices.

## Test coverage diagram

```
CODE PATHS                                              USER FLOWS
[+] src/lib/goHosted.ts                                 [+] Free user → /hosted
  ├── isGoHostedCardDue(dismissedAt, now)                 ├── [PLANNED ★★★] card link: href /hosted, _blank, noopener — GoHostedCard.test
  │   ├── [PLANNED ★★★] never dismissed → due             └── [PLANNED] [→browser] new tab opens /hosted, not /app/hosted
  │   ├── [PLANNED ★★★] < 30 d hidden, = 30 d due       [+] Dismiss and return
  │   └── [PLANNED ★★★] garbage / future → due            ├── [PLANNED ★★★] dismiss → hidden → remount <30 d hidden, ≥30 d shown
  ├── readDismissedAt / writeDismissedAt                  └── [PLANNED ★★ ] focus lands on Settings after dismiss
  │   └── [PLANNED ★★★] storage throws → null / no-op   [+] Hosted user → portal
  ├── goHostedEnabled()                                   └── [PLANNED ★★★] Settings row sign-in uses __PORTAL_URL__, hidden when ""
  │   └── [PLANNED ★★★] undefined / desktop / web       [+] Gates
  └── hostedPortalUrl()                                   ├── [PLANNED ★★★] desktop → no card, no row (ticket AC)
      └── [PLANNED ★★ ] undefined → "", set → value        ├── [PLANNED ★★★] collapsed → no card
[+] vite.config.ts                                        ├── [PLANNED ★★★] sample preparing/active → no card
  ├── portalUrl() / assertHttpsOrigin                     ├── [PLANNED] [→browser] < 640 px tall → no card
  │   └── [PLANNED ★★★] https ok; http/path/junk throw     └── [PLANNED ★★★] core four order unchanged with card
  └── define __PORTAL_URL__                             [+] No network (ADR-024)
      └── [PLANNED ★★ ] web = default, desktop = ""         └── [PLANNED ★★ ] fetch/XHR/beacon spies at 0; test:bundles origin allowlist
[+] SidebarNav.tsx / SettingsPage.tsx wiring           [+] i18n / a11y
  └── [EXISTING] SidebarNav.features/brand tests unaffected  └── [PLANNED ★★ ] AR render + keyboard order
      (no __BUILD_MODE__ global in vitest → card absent)

COVERAGE (planned): every new path has a planned test; 2 paths are browser-only ([→browser]: new-tab target, height media rule)
```

Regression: existing SidebarNav and SettingsPage tests render with no `__BUILD_MODE__` global, so `goHostedEnabled()` is false and they see today's UI unchanged; the new "core four order unchanged with card present" case covers ADR-034 with the card on.

## Failure modes

| Path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| Card link | Built with router `Link` → /app/hosted (404 in-app) | GoHostedCard.test href assertion | clear: wrong page; caught in test |
| Portal URL | Default stale after MUT-112 domain move | vite-config snapshot + bundle-origins allowlist both change with it | sign-in lands on old host; MUT-112 must update `DEFAULT_PORTAL_URL` (noted in §6) |
| Portal URL | Bad env value | `assertHttpsOrigin` fails the build | build error, never ships |
| Dismissal | localStorage throws | read/write try/catch tests | card shows; dismiss works for the tab |
| Dismissal | Clock set far forward then back | future value → due | card shows again (never stuck hidden) |
| Short window | Threshold estimate wrong | browser check at /eng-build | card hidden too early/late; tuned before merge |

Critical gaps (no test, no handling, silent): none.

## Worktree parallelization strategy

Sequential implementation, no parallelization opportunity (one module area: sidebar + settings + build config, ~1 day human / ~35 min CC).

## NOT in scope
- Desktop card or bundle-level desktop rule: desktop is retired until v2; unit tests satisfy the AC.
- Cross-tab dismissal sync: a second tab updates on its next mount; not worth a storage listener.
- A shared "one suggestion at a time" coordinator with MUT-190/MUT-90: neither is built; note on those tickets instead.
- Analytics on the CTA: MUT-152, and ADR-024 keeps the local app at zero telemetry.

## What already exists
- `HOSTED_OFFER_URL` / `/hosted` page (MUT-186): reused as the link target.
- `useSampleSessionStore` (ADR-042): reused for the sample gate.
- `MUTABA3A_PUBLIC_ORIGIN` env + default + https check (vite.config.ts:46, :86): the portal URL copies its shape; the regex is shared through `assertHttpsOrigin`.
- `scripts/bundle-origins.json` + `test:bundles`: already blocks any unreviewed origin; the portal origin is added on review.
- AboutSection new-tab anchors: the anchor pattern.
- `FeatureNoticeBanner`: looked at, not reused (dismiss-forever, Dexie-backed).

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above.

- [ ] **T1 (P1, human: ~1h / CC: ~10 min)** — build config — Add `MUTABA3A_PORTAL_URL` with `DEFAULT_PORTAL_URL`, shared `assertHttpsOrigin`, `__PORTAL_URL__` define (web URL / desktop ""), .env.example, bundle-origins, snapshot update
  - Surfaced by: Section 1 — portal URL not in repo (R1/D2); Section 2 — snapshot (D11)
  - Files: vite.config.ts, src/vite-env.d.ts, .env.example, scripts/bundle-origins.json, scripts/__tests__/vite-config.test.ts (+ .snap)
  - Verify: `npx vitest run scripts/__tests__/vite-config.test.ts`; `npm run test:bundles`
- [ ] **T2 (P1, human: ~1h / CC: ~10 min)** — lib — `src/lib/goHosted.ts` rule, storage, `goHostedEnabled()`, `hostedPortalUrl()` with tests first
  - Surfaced by: Scope record (smaller arrangement, D1)
  - Files: src/lib/goHosted.ts, src/lib/__tests__/goHosted.test.ts
  - Verify: `npx vitest run src/lib/__tests__/goHosted.test.ts`
- [ ] **T3 (P1, human: ~2h / CC: ~10 min)** — sidebar — `GoHostedCard` (+ hook, CSS with 640 px rule) wired into `.sidebar-footer`; hidden collapsed / in sample; focus to Settings via footer-row ref
  - Surfaced by: R3 (D4), R4 (D5), R5 (D6), Section 2 focus seam (D12)
  - Files: src/components/layout/GoHostedCard.tsx, GoHostedCard.css, SidebarNav.tsx, __tests__/GoHostedCard.test.tsx, __tests__/SidebarNav.goHosted.test.tsx
  - Verify: those two test files; browser check at 1440×600 / 1440×800
- [ ] **T4 (P1, human: ~1h / CC: ~8 min)** — settings — `HostedProfileEntry` row with "See hosted" + "Already have an account? Sign in"
  - Surfaced by: R2 (D3)
  - Files: src/pages/settings/HostedProfileEntry.tsx, SettingsPage.tsx, __tests__/HostedProfileEntry.test.tsx
  - Verify: `npx vitest run src/pages/settings`
- [ ] **T5 (P2, human: ~30 min / CC: ~5 min)** — i18n — EN/AR keys for card and row, visually hidden "opens in a new tab"
  - Surfaced by: AC A7
  - Files: src/lib/i18n/translations/en.json, ar.json
  - Verify: i18n key-parity test in `npm run test:run`
- [ ] **T6 (P2, human: ~30 min / CC: ~10 min)** — knowledge — ADR (portal URL config + dismissal storage), PATTERNS (raw anchors out of /app), INFRA (env var), registry, TEST_PLAN, CHANGELOG
  - Surfaced by: CLAUDE.md knowledge protocol
  - Files: .claude/*.md
  - Verify: review diff

## Unresolved decisions
None. One open input (not a decision): Basel supplies the exact Cloud Run run.app URL for `DEFAULT_PORTAL_URL` before T1.

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is (smaller arrangement, same scope)
- Architecture Review: 3 issues found
- Code Quality Review: 3 issues found
- Test Review: diagram produced, 0 gaps identified (2 browser-only checks planned)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (CLI not installed; native fallback needs TaskOutput, not available)
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 0/3 (D2, D3, D6 were scored; each pick was the highest-scored option at 9/10)

## Suppressed findings (appendix)
- (confidence 4/10) Rollup may keep `GoHostedCard.css` in the desktop bundle as a side-effect import even though the component never renders; harmless bytes, not verified.

# Design review (plan-design-review, 2026-10-14)

Target: `.claude/designs/mut-187-go-hosted-cta.md`. System audit: UI scope = sidebar card + Settings row; no DESIGN.md, Brand v2 kit (`docs/brand/README.md`, `src/styles/brand/mutaba3a.tokens.json`) used as the design system. Mockups: HTML wireframe from real tokens instead of generated PNGs (Basel's standing preference); `$D` not used. Step 0: 5/10, all 7 passes (D1).

Prior learning applied: basel-prefers-html-wireframes-over-ai-mockups (confidence 10/10, from 2026-10-12)

| Pass | Before | After | Findings and decisions |
|---|---|---|---|
| 1 Info architecture | 6 | 9 | Card weight undefined → **B outlined card** (D2). Row name clashed with "+ Add Profile" → **"Hosted account"** (D3). |
| 2 Interaction states | 5 | 9 | Dismiss had no visible meaning → **label/tooltip "Hide for 30 days", 160 ms fade, no toast** (D4). Storage-blocked and portal-empty states already in the plan. No loading state (sync read). |
| 3 Journey | 7 | 8 | No issues. Storyboard below. |
| 4 AI slop | 6 | 9 | OPERATE surface. No hard rejections. Draft copy wrapped to 3 lines and the AR button to 2 → **copy echoes /hosted** (D5). Card justified: it is the dismissible object. |
| 5 Design system | 6 | 9 | Tokens and classes named in §2b (follows from D2, no new colour). |
| 6 Responsive / a11y | 5 | 9 | Keyboard, group label, new-tab text, focus ring specified; **× hit area 44×44** (D6). Height rule from the eng review (640 px) stays. Sidebar has no phone layout today (desktop-first app). |
| 7 Decisions | – | – | 5 resolved, 0 deferred. |

Journey storyboard:

| Step | User does | User feels | Plan specifies |
|---|---|---|---|
| 1 | Opens the free app | Focused on clients and income | Card sits in the footer, below the nav, outlined, never lavender |
| 2 | Notices the card | Curious, not pushed | One short line that matches the page it opens |
| 3 | Clicks "Go hosted" | In control | /hosted opens in a new tab; the app tab stays put |
| 4 | Not interested, clicks × | Respected | Label says "Hide for 30 days"; quiet fade; focus lands on Settings |
| 5 | Already hosted | "Where do I sign in?" | Settings › Businesses › Hosted account › "Sign in" |

Measured evidence (wireframe, 240 px sidebar): approved card EN 117 px, AR 94 px tall; AR button on one line. The eng review's 640 px threshold is still to be confirmed in the real app at /eng-build.

NOT in scope: a collapsed-rail icon (eng D4); a confirmation line after dismissing (D4 B); a lavender/brand-tinted card (D2 C); a phone layout for the sidebar (no phone layout exists).

What already exists: `.btn btn-sm btn-secondary`, `--border`/`--radius-md`/`--surface`/`--focus-ring` tokens, the AboutSection new-tab anchor, `/hosted` hero copy in en/ar.json (`landing.hostedOffer.hero`).

TODOS.md updates: none proposed.

### Design implementation tasks
- [ ] **DT1 (P1, human: ~1h / CC: ~10 min)** — GoHostedCard — build variant B from §2b (tokens, `.btn btn-sm btn-secondary`, 44×44 ×, group label, 160 ms fade with reduced-motion fallback)
  - Surfaced by: Pass 1 D2, Pass 2 D4, Pass 6 D6
  - Files: src/components/layout/GoHostedCard.tsx, GoHostedCard.css
  - Verify: GoHostedCard.test.tsx; browser screenshot vs the wireframe in light/dark, EN/AR
- [ ] **DT2 (P1, human: ~30 min / CC: ~5 min)** — i18n — the approved EN/AR strings from §2b, row titled "Hosted account"
  - Surfaced by: Pass 1 D3, Pass 4 D5
  - Files: src/lib/i18n/translations/en.json, ar.json
  - Verify: key-parity test; AR render in the browser
- [ ] **DT3 (P2, human: ~15 min / CC: ~2 min)** — Jira — note on MUT-187 that the row is titled "Hosted account"
  - Surfaced by: Pass 1 D3
  - Verify: comment on MUT-187

### Design completion summary
```
+====================================================================+
|         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
+====================================================================+
| System Audit         | no DESIGN.md (Brand v2 kit used); UI scope   |
| Step 0               | 5/10, all 7 passes                          |
| Pass 1  (Info Arch)  | 6/10 → 9/10 after fixes                     |
| Pass 2  (States)     | 5/10 → 9/10 after fixes                     |
| Pass 3  (Journey)    | 7/10 → 8/10 after fixes                     |
| Pass 4  (AI Slop)    | 6/10 → 9/10 after fixes                     |
| Pass 5  (Design Sys) | 6/10 → 9/10 after fixes                     |
| Pass 6  (Responsive) | 5/10 → 9/10 after fixes                     |
| Pass 7  (Decisions)  | 5 resolved, 0 deferred                      |
+--------------------------------------------------------------------+
| NOT in scope         | written (4 items)                           |
| What already exists  | written                                     |
| TODOS.md updates     | 0 items proposed                            |
| Approved Mockups     | 1 HTML wireframe (variant B approved)       |
| Decisions made       | 5 added to plan                             |
| Decisions deferred   | 0                                           |
| Overall design score | 5/10 → 8/10                                 |
+====================================================================+
```

### Unresolved design decisions
None.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex via `/plan-eng-review` | Independent 2nd opinion | 1 | unavailable | codex CLI not installed; no outside coverage |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN (all resolved in plan) | 6 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR | score: 5/10 → 8/10, 5 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable (not installed). Design outside voices were not offered in this run (codex not installed; the Claude-subagent voice was skipped); no outside design coverage.
- **VERDICT:** DESIGN CLEARED. Eng Review status is issues_open by its own rule (6 findings, all folded in with approved decisions, 0 unresolved); eng review required.

NO UNRESOLVED DECISIONS
