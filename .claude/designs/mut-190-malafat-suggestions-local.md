# MUT-190 — Malafat suggestions in the local web app

Status: **PLANNED (2026-10-14)**, branch `feature/mut-189-malafat-upsell` (one worktree for epic MUT-189: `.claude/worktrees/mut-189-malafat-upsell`).
Ticket: MUT-190 (Story) · epic MUT-189 (upsell Malafat inside Mutaba3a to lawyers and accountants). Siblings: MUT-191 (portal), MUT-192 (Flutter, other repo). Relates to MUT-174 (landing Malafat band; it shipped `malafatUrl`).
Tracker: Jira · barmajiyat.atlassian.net · MUT via atlassian-barmajiyat · finished → In Review after /qa-reconcile.

**Blocker gate.** MUT-190 is blocked by MAL-1153 ("Recognise Mutaba3a referrals on malafat.app/contact", To Do). MAL-1153 makes malafat.app prefill the message for `?topic=mutaba3a` and persist the UTM attribution; it changes nothing Mutaba3a builds. Without it, the link still opens Malafat's contact form, with an empty message and an uncounted referral. Planned under option (b) of /eng-ticket: build the Mutaba3a side now; **release it only after MAL-1153 ships** (noted on the ticket). Nothing deploys from local main without Basel.

## 1. Problem and acceptance criteria

Users who run a law or accounting office never hear about Malafat inside the free app.

| # | AC (ticket) | Plan | Proved by |
|---|---|---|---|
| A1 | One shared link builder `(surface, placement, locale)` → the MUT-189 CTA URL, unit-tested; URL and threshold in config | `malafatUrl` (MUT-174, `src/content/malafatLinks.ts`) with `contact: true`; `MALAFAT_CLIENT_THRESHOLD = 10` in `src/lib/malafatSuggestions.ts` | `malafatLinks.test.ts` (exists, covers the contract); `malafatSuggestions.test.ts` (threshold) |
| A2 | `utm_medium` = `web-local` on the web build, `desktop` on Tauri | `web-local`. **Desktop is retired until v2** (Basel, 2026-10-14): the moments render on the web build only (`__BUILD_MODE__ === 'web'`, the `goHostedEnabled` gate), so no `desktop` link is ever built. *Reading flagged for Basel.* | component tests assert `utm_medium=web-local`; a desktop-mode test asserts nothing renders |
| A3 | Dismissals and the "Show Malafat suggestions" switch persist locally; no network call except the user's own click (ADR-024) | the Dexie `settings` row gains `malafatSuggestions?: { off?: boolean; dismissed?: MalafatMoment[] }` (same row and mechanism as `features` / `featureNotice`; travels with a backup, like the other switches) | hook tests (write + read back); no fetch anywhere (grep test) |
| A4 | No suggestion on Malafat-fed profiles | **Vacuous on the local app**: local `BusinessProfile` has no Malafat link and no personal/business type (`src/types/index.ts:364-378`); Malafat-fed profiles exist only on the hosted side (MUT-191). Recorded, nothing to gate. | — |
| A5 | EN + AR, RTL; in Tauri the link opens in the system browser | `settings.malafat.*`, `clients.malafat.*` keys; Tauri n/a (A2) | AR component tests; QA in AR |
| A6 | Nothing in empty states, onboarding or any save flow | Clients card only beside a non-empty list; C1 only for a business added while another exists (the first business is onboarding: WelcomeModal); never inside a drawer; hidden during the visitor sample and demo mode | component tests |

## 2. The moments in the local app

| Moment | Where | When | Dismiss |
|---|---|---|---|
| **S1** static | Settings › Businesses, a "Mutaba3a + Malafat" row under the Hosted account row | always (web build), even with suggestions switched off | not dismissible; holds the **"Show Malafat suggestions"** switch |
| **C1** business-profile | Settings › Businesses, a one-line note at the top of the section | right after a business is added in this session, when another business already existed (never the first: that is onboarding) | permanent (`dismissed` += `business-profile`) |
| **C2** client-threshold | Clients, a card between the search row and the count strip | the working business has ≥ `MALAFAT_CLIENT_THRESHOLD` live clients | permanent |
| **C3** second-business | Clients, the same slot | ≥ 2 live businesses | permanent |

**One at a time:** each screen has one slot (Settings: C1; Clients: C2, else C3). Different moments never share a screen; the Go hosted sidebar card is a different offer and is left alone.

## 3. Where the code goes

| File | Change |
|---|---|
| `src/types/index.ts` | `MalafatMoment = 'business-profile' \| 'client-threshold' \| 'second-business'`; `Settings.malafatSuggestions?: { off?: boolean; dismissed?: MalafatMoment[] }` (optional, so old rows and imported backups resolve to "on, nothing dismissed") |
| `src/lib/malafatSuggestions.ts` (new, pure) | `MALAFAT_CLIENT_THRESHOLD = 10`; `malafatSuggestionsEnabled()` (web build, typeof-guarded like `goHostedEnabled`); `resolveMalafatSuggestions(stored)` → `{ on, dismissed: Set }` tolerant of junk; `pickClientsMoment({ suggestions, clientCount, businessCount })` → `'client-threshold' \| 'second-business' \| null`; `showBusinessAddedNote({ suggestions, justAdded })` |
| `src/lib/useMalafatSuggestions.ts` (new) | `useMalafatSuggestions()` reads the settings row with its own `['settings']` key (as `useFeatures.ts` does, so page tests that mock `hooks/useQueries` keep it); `useDismissMalafatMoment()`, `useSetMalafatSuggestionsOn()` write the field and invalidate `['settings']` |
| `src/lib/malafatMomentStore.ts` (new, zustand) | `businessAddedAt: number \| null`, `markBusinessAdded()`, `clear()`; session-only (not persisted): C1 is "right after", not forever |
| `src/components/drawers/BusinessProfileDrawer.tsx` | on a successful **create**, when the live businesses before the create were ≥ 1, `markBusinessAdded()` (one line; the drawer still just closes) |
| `src/components/malafat/MalafatSuggestion.tsx` + `.css` (new) | the card/note: `role="group"`, `aria-label`, one line of text, a `btn btn-sm btn-secondary` anchor to `malafatUrl({ locale, medium: 'web-local', content, contact: true })` in a new tab (sr-only "opens in a new tab"), and a 44 px × button "Don't show this again". Visual: `GoHostedCard`'s outlined object (border, surface), page width, tokens only. Props: `moment`, `text`, `onDismiss`, `variant: 'card' \| 'note'` |
| `src/pages/clients/MalafatClientsSuggestion.tsx` (new) | reads `useMalafatSuggestions`, `useActiveProfile`, `useClients(activeProfileId)`, `useBusinessProfiles`, the sample/demo stores; renders `MalafatSuggestion` for `pickClientsMoment(...)` or nothing |
| `src/pages/clients/ClientsPage.tsx` | `{malafatSuggestionsEnabled() && <MalafatClientsSuggestion />}` inside the non-empty branch, above the count strip |
| `src/pages/settings/MalafatEntry.tsx` + `.css` (new) | S1 row: `.settings-label` "Mutaba3a + Malafat", one sentence, "See Malafat" link (`content: 'settings'`), and a `.settings-row` with the `Switch` "Show Malafat suggestions" (`labelledBy`) |
| `src/pages/settings/SettingsPage.tsx` | in Businesses: the C1 note at the top (`MalafatBusinessAddedNote`, in `MalafatEntry.tsx`), and `{malafatSuggestionsEnabled() && <MalafatEntry />}` after `HostedAccountEntry` |
| `src/lib/i18n/translations/{en,ar}.json` | `settings.malafat.{title,text,cta,switchLabel,switchDescription}`, `malafat.suggestion.{label,cta,dismiss,businessProfile,clientThreshold,secondBusiness}` |
| tests | `malafatSuggestions.test.ts`, `useMalafatSuggestions.test.tsx`, `MalafatSuggestion.test.tsx`, `MalafatClientsSuggestion.test.tsx`, `MalafatEntry.test.tsx`, a `BusinessProfileDrawer` case |
| QA | `qa/features/web/settings.yaml` + `clients.yaml` features; specs tagged `@web.settings.malafat`, `@web.clients.malafat` |
| knowledge | CHANGELOG, COMPONENT_REGISTRY (`MalafatSuggestion`, `MalafatEntry`, `malafatSuggestions`), PATTERNS (a permanent dismissal lives in the settings row, a snooze in localStorage), TEST_PLAN, SYSTEM_OVERVIEW, DECISIONS (ADR-078: where the moments live and how they are dismissed) |

**Copy** (never "automatic"/"sync"; MUT-174's honesty rule; Malafat's own product claims are the epic's pitch):
- card/note label: "A suggestion from Mutaba3a" / "اقتراح من متابعة"; CTA "See Malafat" / "اطّلع على Malafat"; dismiss "Don't show this again" / "لا تُظهر هذا مجددًا".
- C1: "Is this business a law firm or an accounting office? Malafat manages clients, matters and documents, and connects to Mutaba3a." / "هل هذا العمل مكتب محاماة أو محاسبة؟ يدير Malafat العملاء والملفات القانونية والمستندات، ويتّصل بمتابعة."
- C2: "Lots of clients to keep track of? If you run a law firm or an accounting office, Malafat manages clients, matters and documents, and connects to Mutaba3a." / AR equivalent.
- C3: "Running more than one office? If it's a law firm or an accounting office, Malafat manages clients, matters and documents, and connects to Mutaba3a." / AR equivalent.
- S1 text: "For law firms and accounting offices: Malafat manages clients, matters and documents, and connects to Mutaba3a through a hosted account." Switch: "Show Malafat suggestions" / "Occasional cards for law firms and accounting offices. This row stays."

## 4. Decisions

- **D1 — Dismissals and the switch live in the Dexie settings row**, not localStorage: they are permanent product preferences like the optional-area switches (`features`) and the auto-enable notice dismissal (`featureNotice`), not a per-browser snooze like Go hosted's 30 days. They travel with a backup.
- **D2 — Web build only; no desktop link.** Desktop is retired until v2; adding `__BUILD_MODE__ === 'desktop'` paths is out (memory: desktop-retired-until-v2).
- **D3 — C1 is session-only and skips the first business.** The local app has no success state after "Add business" (the drawer closes), so the note appears at the top of Settings › Businesses, where the person just was. The first business is created from the welcome flow, which the epic rules out (onboarding).
- **D4 — C2 counts the working business's live clients** (`useClients(activeProfileId)`), also under All businesses; one cheap list read that the Clients page's cache usually already holds.
- **D5 — Hidden during the visitor sample and demo mode**, like the Go hosted card (a visitor exploring sample data is not a firm).
- **D6 — The card component is shared** by C1/C2/C3 (variant `note` for C1); S1 is a settings row, not a card.

## 5. Tests (written first)

- `malafatSuggestions.test.ts`: resolve (undefined → on, none dismissed; junk dropped); `pickClientsMoment`: threshold boundary 9/10, C2 beats C3, dismissed moments skipped, off → null, one business + few clients → null; `malafatSuggestionsEnabled` web/desktop/undefined.
- `useMalafatSuggestions.test.tsx`: dismiss appends once and persists; the switch writes `off`; other settings fields untouched.
- `MalafatSuggestion.test.tsx`: text, link href = `malafatUrl({ locale, medium: 'web-local', content, contact: true })`, new tab + sr-only, dismiss button name, AR.
- `MalafatClientsSuggestion.test.tsx`: shows C2 at 10 clients, C3 with two businesses, nothing when both dismissed, off, in sample/demo, under the threshold with one business.
- `MalafatEntry.test.tsx`: S1 row link `content=settings`; switch toggles the stored `off`; the row stays when off; the C1 note shows after `markBusinessAdded()` and hides permanently on dismiss.
- `BusinessProfileDrawer` case: creating with one existing business marks the moment; creating the first does not; editing never does.
- QA `@web.settings.malafat` (EN+AR): add a second business → the note, its link (`utm_medium=web-local&utm_content=business-profile`), dismiss, reload, gone; the switch off; S1 stays. `@web.clients.malafat`: with two businesses and a client, the Clients card (`second-business`), dismiss, reload, gone. C2 (10 clients) is proved at component level (ten clients through the UI is slow and adds nothing the component test misses).

Gate (Node 22): lint, typecheck, `test:run`, build, `test:bundles` (`malafat.app` is already in `local`), `release-qa lint`, QA on a built web preview.

## 6. Scope check

Covers A1–A6 with two flagged readings (A2 desktop, A4 vacuous). Not in scope: the portal (MUT-191), Flutter (MUT-192), MAL-1153, any telemetry, an in-app form.

Business / product impact
- The free app's law and accounting users meet Malafat at the moments it helps (growing client lists, a second office), without a modal, a toast or a nag, and can turn it off; referrals are tagged for Malafat to count once MAL-1153 lands.
- First of epic MUT-189's three stories; MUT-191 reuses the same builder, copy pattern and dismissal model.
