# MUT-561 — The owner's Sharing page (design brief)

Copy of the approved plan (Jira MUT-561 comment 13242), with Basel's later decisions on top. Built in two slices on
`feat/mut-561-sharing-page`: **slice A** (this commit set) needs only MUT-559; **slice B** (Links column, New link
drawer and done pane, Turn off, Copy message) waits for MUT-560.

## Decisions that override the plan (Jira MUT-558 comments 13236, 13244)

- **Side drawer** for Invite and New link (DESIGN.md drawer-first), not the wireframe's centred dialogs. Plan D2 stands.
- **Owner's "Download a period"** is a row at the bottom of the Sharing page, built with MUT-314. Slice A reserves its
  place in `SharingPage.tsx` (a comment, nothing visible).
- **Copy message** text (slice B), never with the PIN:
  - EN: "Hi, I've shared the books of “{profile}” for {period} with you on Mutaba3a: {url} — the link works until {until}. I'll send you the PIN separately."
  - AR: "مرحباً، شاركتُ معك دفاتر «{profile}» لفترة {period} على متابعة: {url} — يعمل الرابط حتى {until}. سأرسل لك الرمز بشكل منفصل."
- **Ended items per OW5:** locked and ended links hide one day after (server rule S1, slice B).

## Slice A as built (deviations from the plan)

- Drawer URL key is `?invite=true` (the portal's flag style, `parseProfileDrawer`), not `?invite=1`: TanStack quotes a
  string `'1'` in the URL. `parseSharingSearch` accepts `1` too.
- The new-row cue is `.hp-sharing-item--new` (a tinted row), not `.row-flash`, which is table-only (`index.css`).
- Under the lapse gate the invite drawer opens read-only (the note says why); Stop and Cancel still work, Invite again
  is hidden (plan › failure modes: "list/revoke still work").
- With no Links column yet, the page behaves as a server with SHARE_LINKS off: no GET …/share-links is sent, the
  Accountants column is full width, the empty page offers Invite only (`LINKS_ON = false`, `TODO(blocked-by MUT-560)`).
- The Scene's colours map to the brand primitives directly (`--m-field-bg`, `--m-primary`, `--m-peach-strong`), which
  already resolve per theme; no extra scene variables.
- Telemetry: `accountant_invited` has no properties; `accountant_revoked` has `was`. Contract 2.7.0. If MUT-575 owns
  the events contract later, these two entries are already in place for it to extend (phone emitters in MUT-563).

## Slice B and review fixes as built (2026-11-06, after MUT-560 merged)

- Links column on MUT-560's list: `active | locked | expired | revoked` with `endedAt`; the server keeps ended and
  locked links listed for 24 h (OW5, S1 was folded into MUT-560). Expired and revoked read "Ended {day}" with no
  action; locked keeps Turn off. Turn off marks the row ended at once and restores it if refused.
- New link drawer and done pane in one side drawer (`?newLink=true`). Default period last 3 months, 7 days. The PIN is
  sent folded to 0–9. Copy message is Basel's 13244 text in the portal language ("Mutaba3a" in the English text, as
  given); the done pane also says "Message copied, without the PIN".
- Review fixes: concurrent revokes (mutationKey + isMutating, per-item undo); Invite again refetches on stale refusals
  and is inert at the limit; the new row takes focus; FSI/PDI isolates around emails, names and profile names in
  sentences (not in aria-labels or clipboard text); gender-neutral Arabic confirms; the limit falls back to the list's.
- Events `share_link_created` (period, expires_in_days) and `share_link_revoked` (was) join contract 2.7.0, kept at
  2.7.0 on this branch; MUT-575 defines the same entries, and whichever merges second reconciles the version pin.

- **MUT-577 (Basel):** the gate also needs the person's `accountant_access` feature on `/v1/me` (operator switch, like
  `receipt_reading`). Read defensively: absent → hidden. FakeApi seeds it with accountants (`accountantAccess: false`
  withholds it).

## QA scenarios (slice A; `qa/features/portal/sharing.yaml`, `qa/specs/portal/sharing.spec.ts`)

| id | tier | steps → outcome |
|---|---|---|
| `entry` | secondary | Open You › Profiles as an owner → "Share with your accountant" opens the page; Studio's edit pane → Sharing row; a firm member or accountant access off → no row, the URL goes back to You › Profiles. |
| `accountants-list` | secondary | Open Sharing with active, pending, expired → chips, "Since … · viewed 2 days ago", "Sent … · ends …", "Not accepted within 14 days", Stop / Cancel / Invite again, "Up to 5 accountants per profile." |
| `invite` | core | Invite by email → drawer with 4 points; own address → field error; already invited → banner; new address → Pending row, POST `locale: en`, `accountant_invited` counted with nothing identifying. |
| `revoke-access` | core | Stop Sami → in-place confirm, Cancel focused; confirm → row gone, DELETE sent; cancel a pending invite; Invite again on expired. |
| `empty` | secondary | Never-shared profile → scene, title, 4 points, Invite only. |
| `layout` | secondary | Arabic 375 px → RTL, one column, no sideways scroll, emails LTR; drawer fits; English desktop dark → axe clean. |

| `create-link` | core | Create link → months per chip; PIN 12 refused; 4821/7 days/last 3 months → done pane, link once; Copy link; Copy message without the PIN; Done + reload → URL nowhere, row 0 / 3. |
| `link-rows` | secondary | Live, locked, ended rows; Turn off confirm → Ended, DELETE sent. |

---

# MUT-561 — Portal: "Share with your accountant" (invites, share links, revoke) — plan

Epic MUT-558. Repo: mini-crm, portal (`src/hosted/**`); one small server delta (S1) only if MUT-560 merges without it.
Tracker: Jira · barmajiyat · MUT via atlassian-barmajiyat · Backlog → Planned (transition 2) by /eng-ticket; /eng-build → In Progress; finished → In Review.
Ticket was Backlog; planned on the caller's instruction (the epic is the active roadmap item).

## Status and blockers
- **MUT-559** (server grants): merged to local main 69436d7d, In Review. Everything the Accountants column needs is on main.
- **MUT-560** (share links): being built on `feat/mut-560-share-links` (worktree `.claude/worktrees/mut-560`, 4 commits, contract `1.101.0-mut560`). Blocks only the Links column. Its built contract was read: whole calendar months (period.ts), `ownerName` in unlock, `url = {PORTAL}/share#<token>`, list = live links `status: active|locked`.
- Blocker gate: MUT-560 is not merged, so the Links slice (B) is stubbed `TODO(blocked-by MUT-560)` and built after it merges. Slice A starts now.

## Shape (layout B, Basel 13236)
A **Sharing page per profile**, two columns (Accountants | Links with a PIN), one column at 375 px. Invite and Create link open in the portal's **Drawer** by URL key (DESIGN.md drawer-first; Drawer is already `role="dialog"`). Destructive actions are `InPlaceConfirm` rows.

```
You › Profiles ──"Share with your accountant" row──┐
Manage profiles › edit pane ──"Sharing" row────────┤
                                                    ▼
/p/$profileId/you/sharing        SharingPage (owner of that profile only)
 ├─ AccountantsColumn  GET/POST/DELETE /v1/profiles/{id}/accountants      (MUT-559, main)
 │    ?invite=1 → InviteAccountantDrawer
 └─ LinksColumn        GET/POST/DELETE /v1/profiles/{id}/share-links      (MUT-560)
      ?newLink=1 → NewShareLinkDrawer → done pane (URL once, Copy link, Copy message)
```

## Routes and entry points
- **Route:** `/p/$profileId/you/sharing` (the wireframe's URL), a child of the profile route, not a You tab. `you` is already in `NO_DESTINATION` and `isYouPath`, so the island lights and the route-walking test passes. `validateSearch`: `invite?: '1'`, `newLink?: '1'` (drawer keys, merged with `pickShellOverlay`).
- **Who sees it:** `profile.owned === true` (creator or co-owner; the server's `ownsProfile`). A member of a firm profile, local mode, or a server without accountant access (`me.clients === undefined`, comment 13231) gets `<Navigate>` to `/p/$profileId/you` and no entry rows.
- **Entry rows:** You › Profiles gets a `RowLink` "Share with your accountant" under the profile list for the open profile when it is owned; the Manage profiles edit pane gets a `RowLink` "Sharing" (opens that profile's page; it switches the open profile, as every You link does). "‹ Profiles" on the page goes back to You › Profiles.
- **API gate (13231):** the portal ships in the same image as the API, so the version check is implicit; the feature gate is `me.clients !== undefined`. The Links column additionally hides itself when `GET …/share-links` answers 404 (SHARE_LINKS off), and shows the Accountants column alone, full width.

## Every state (from owner-share-portal.html B1–B5)
**Page header:** "Sharing Studio", one-line scope note ("Whoever you share with reads expenses, income and receipts only…").
**Accountants column**
- Row: avatar initial, name (or email), email `dir="ltr"`, meta, chip, one action:
  - active: "Since 12 Oct · viewed 2 days ago" (or "not viewed yet"), chip Active, action **Stop** → InPlaceConfirm "Stop Sami's access to Studio? He won't be able to open it any more. You can invite him again later."
  - pending: "Sent 3 Nov · ends 17 Nov", chip Pending, action **Cancel** → InPlaceConfirm.
  - expired: "Not accepted within 14 days", chip Expired, action **Invite again** (POST same email; the server replaces an expired invite).
- Foot: "Up to {limit} accountants per profile" (`limit` from the list response).
- Header button "Invite by email" (inert with a reason at the limit).
**Invite drawer (B2):** email field; the 4 scope bullets (shared component, below); "They'll get an email to accept. It ends after 14 days."; Cancel / Send invite. No language picker: the email goes in the portal's current language (OW2), sent as `locale`. Errors in the banner slot or under the field:
  - 422 SELF_INVITE → field: "That's your own email. Use your accountant's."
  - 422 VALIDATION_FAILED (email) → field error; 422 INVITE_ADDRESS_REFUSED → field: "We can't send invites to this address."
  - 409 ALREADY_INVITED → banner "{email} already has an invite or access to this profile."; 409 ACCOUNTANT_LIMIT → banner with the limit.
  - 403 NOT_OWNER → banner + list refetch; 402/lapse (LOCKED owner) → the lapse note (`readOnly` drawer); network → banner "unreachable" with retry on submit.
  - Success: drawer closes, row appears pending with `.row-flash`, polite toast "Invite sent to {email}".
**Links column (slice B)**
- Table (HostedTable at desktop, stacked rows at 375): Period ("Aug – Oct 2026", "Whole profile"), Ends, Last opened ("Yesterday" / "—"), Viewers "2 / 3", action **Turn off** (InPlaceConfirm row).
- Locked row: chip Locked + Turn off. Ended row: "Ended 1 Nov", no action. Locked and ended rows are dropped one day after they lock/end (OW5); revoked links vanish at once.
- Foot note (B1): what Locked means, a link is never shown twice, no emails about link activity.
- Header button "Create link" (inert with a reason at `limit` live links).
**New link drawer (B3):** Period chips Last month / Last 2 months / Last 3 months / Whole profile, each with its month names (OW3: "Aug – Oct 2026"); Works for 1 / 7 / 30 days; PIN (4–8 digits, Show/Hide, `inputmode="numeric"`, Arabic-Indic digits accepted — the server folds them); summary line; Cancel / Create link. Errors: 422 PIN_FORMAT → field; 409 SHARE_LINK_LIMIT → banner; 429 → banner "Too many links in an hour, try later"; lapse → read-only note.
**Done pane (B4)**, same drawer, swapped body (DESIGN.md "panes inside a drawer"): scene `link-ready`, "Your link is ready", period · works until · up to 3 viewers, the URL in `CopyField`, **Copy link** and **Copy message** (OW4: a ready message in the portal's language with owner, profile, period, end date and the link, never the PIN), the warning "Send the PIN separately — we won't show the link or the PIN again", Done. The URL and PIN live only in component state; closing, Escape or reload drops them (the URL key `?newLink` is removed on Done).
**Empty page (B5):** scene `accountant-empty`, "You haven't shared this profile yet", the 4 scope bullets, buttons Invite by email / Create a link with a PIN. With SHARE_LINKS off, only Invite.
**Loading / errors:** `QueryView` Skeleton per column; Unreachable with Retry per column (one column failing never blanks the other); 404 on the page's profile → the portal's existing "This profile isn't available" handling.
**375 px, RTL, dark:** one column (Accountants first), actions wrap under the meta (`.hp-profile-row` recipe), logical properties only, emails/URL `dir="ltr"`, names `dir="auto"`.

## Components and reuse
- New `src/hosted/pages/sharing/`: `SharingPage.tsx`, `AccountantsColumn.tsx`, `LinksColumn.tsx` (slice B), `InviteAccountantDrawer.tsx`, `NewShareLinkDrawer.tsx` (form + done pane, slice B), `sharingRules.ts` (pure: grant row view, link row view, period label, share message, error → banner mapping).
- New shared `src/hosted/components/AccessScopeList.tsx`: the 4 "sees / can download / can't change / doesn't see" bullets; reused by MUT-562's invite page (one copy of the promise).
- New `src/hosted/components/Scene.tsx` + `scripts/generate-illustrations.ts` (→ `src/components/illustrations/generated/`): the portal's first illustration renderer (brief "web gap"). Maps the three art hexes to CSS variables (fieldBg / primary / peachStrong tokens), `aria-hidden`, reduced motion = final frame. A scene not drawn yet renders the existing `empty-state` scene (placeholder) and swaps when the SVG lands and the generator reruns. Built here first; MUT-562 reuses it.
- Reused: `Drawer` + URL keys (`AccountDrawers` pattern), `InPlaceConfirm`/`useConfirmStep` (row appearance), `CopyField` + `copyToClipboard`, `HostedTable`, `QueryView`, `RowGroup`/`RowLink`, `Badge`, `Toast`, `ProfileBanner`-style banner, `useWritableFor` (lapse), `Icons` (+ generated `email`, `lock`, `copy`, `check`, `visibility`, `calendar`; new `accountant`, `link` icons from Claude Design, placeholders `person`/`external` until then).

## State and data fetching (`src/hosted/data/sharingQueries.ts`)
- `useAccountants(profileId)` → `profileKey(profileId, 'accountants')`; `useShareLinks(profileId)` → `profileKey(profileId, 'shareLinks')` (404 → `{ off: true }`, not an error).
- Mutations: `inviteAccountant` (POST, then `setQueryData` + invalidate), `revokeAccountant` (DELETE; optimistic remove with rollback on error), `createShareLink` (POST; returns `ShareLinkCreated` to the done pane; invalidates the list), `revokeShareLink` (DELETE; optimistic).
- `api` additions in `src/hosted/api/client.ts`: `listAccountants`, `inviteAccountant`, `revokeAccountant`, `listShareLinks`, `createShareLink`, `revokeShareLink` (typed from `schema.d.ts`, regenerated after MUT-560 merges).
- No polling. Lists refetch on window focus (React Query default), so "viewed", "opened" and viewers stay fresh enough.
- Relative times ("2 days ago") through the portal's existing relative-date formatter; dates in the profile's timezone.

## i18n (`src/hosted/i18n/{ar,en}.json`, Arabic written first)
- `hosted.sharing.*`: `title` ("Sharing {profile}"), `back`, `scopeNote`, `entryRow`, `manageRow`, `accountants.{heading,invite,limit,since,viewed,notViewed,sent,ends,expiredMeta,chip.{active,pending,expired},stop,cancel,inviteAgain,stopConfirm,cancelConfirm,stopped,cancelled}`, `invite.{title,email,intro,send,sent,errors.{self,refused,already,limit,notOwner,invalid}}`, `links.{heading,create,cols.{period,ends,lastOpened,viewers},wholeProfile,ended,locked,turnOff,turnOffConfirm,turnedOff,footnote,limit}`, `newLink.{title,period,last1,last2,last3,whole,worksFor,days1,days7,days30,pin,pinHint,show,hide,summary,create,errors.{pin,limit,rate}}`, `done.{title,summary,copyLink,copyMessage,copied,pinWarning,done}`, `message` (the Copy message template with `{owner} {profile} {period} {until} {url}`), `empty.{title,invite,createLink}`.
- `hosted.accessScope.{sees,download,cannotChange,cannotSeeOther}` (shared with MUT-562).
- Month-range label via `Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' })`, Arabic month names in Arabic.
- `translations.test.ts` keeps ar/en key parity; the no-hardcoded-strings lint covers the new files.

## Telemetry (portal opt-in `trackPortal`, release-only gate; contract `docs/analytics/events.json`)
- `accountant_invited` after a 201; `accountant_revoked` after a DELETE (`was: pending|active`); `share_link_created` after a 201 (`period`, `expires_in_days`). `surface` is the shared property (`portal`). No email, name, token, PIN or profile id. Contract entries with `emitters: ["portal"]` (the phone adds itself in MUT-563); `analytics-taxonomy.test.ts` checks them.

## Server delta S1 (only if MUT-560 merges without it)
OW5 needs the list to return links that **ended in the last 24 h** (`status: 'ended'`, `endedAt`) and to **drop locked links 24 h after `lockedAt`**; MUT-560's built list returns live links only and keeps locked ones until expiry. The rule belongs on the server (one owner, phone MUT-563 needs it too): `listForOwner(now)` in `server/src/share-links/links.ts`, `ShareLinkSchema.status` gains `ended`, a test for each boundary (23h59 shown, 24h00 gone), OpenAPI + `hosted:types`. **Recommended: fold it into MUT-560 before it merges** (relay to that builder); otherwise it is the first commit of slice B.

## Release-QA (portal app, stubbed API; `qa/features/portal/sharing.yaml`, `qa/specs/portal/sharing.spec.ts`)
Feature file `area: sharing`, paths `src/hosted/pages/sharing/**`, `src/hosted/data/sharingQueries.ts`, `src/hosted/components/{AccessScopeList,Scene}.tsx`, `src/components/illustrations/**`. Each test tagged `@portal.sharing.<id>`, every action in `step(...)`, stubs in `qa/support/portalApi.ts`.
| id | tier | AC | Named steps → expect |
|---|---|---|---|
| `entry` | secondary | AC1 | step "Open You › Profiles as an owner" → row visible; step "Open as a member of a firm profile" → no row; step "Open with accountant access off" → no row. |
| `accountants-list` | secondary | AC1, AC4 | step "Open Sharing" → active row with viewed, pending row with end date, expired row with Invite again; scope note shown. |
| `invite` | core | AC2, AC4 | step "Invite by email" → drawer with 4 bullets; step "Send own address" → SELF_INVITE field error; step "Send an address already invited" → banner; step "Send a new address" → pending row, POST body has `locale` = UI language, `accountant_invited` captured (usage on). |
| `revoke-access` | core | AC2 | step "Stop Sami" → in-place confirm, focus on Cancel; step "Confirm" → row gone, DELETE sent; step "Cancel a pending invite"; step "Invite again on expired". |
| `create-link` | core | AC2, AC3 | step "Create link" → period chips show month names; step "Enter PIN 12" → PIN error; step "Enter 4821, 7 days, last 3 months" → done pane shows URL once; step "Copy link"; step "Copy message" → clipboard holds the URL and no PIN; step "Done, reload" → URL appears nowhere, list shows the link "0 / 3". |
| `link-rows` | secondary | AC1, AC2 | step "Open with active, locked and ended links" → chips and Ends/Last opened/Viewers; step "Turn off the active link" → confirm, row gone. |
| `empty` | secondary | AC4 | step "Open a never-shared profile" → scene, bullets, both buttons. |
| `layout` | secondary | AC5 | step "Arabic at 375" → one column, no horizontal overflow (`expectNoHorizontalOverflow`), `dir=rtl`; step "English desktop dark" → two columns; axe clean (`qa/support/axe.ts`). |
The live end-to-end journey (owner invites → accountant accepts → owner stops) is in MUT-562's `portal-selfservice/accountant` feature, which also paths these files. Each spec passes once before done (`release-qa run --attach --only portal.sharing.<id>`); `release-qa lint` clean.

## Unit tests (Vitest, TDD; `npm run test:run -- src/hosted/pages/sharing`)
1. `sharingRules.test.ts`: grant row view (active/pending/expired → meta, chip, action) at fixed clocks; link row view (active/locked/ended); period label for each period on 2026-11-06 = Oct 2026, Sep–Oct 2026, Aug–Oct 2026, Whole profile (the server's documented examples), Jan 1 crossing a year, Arabic months; `shareMessage` contains the URL and never the PIN (property test over random PINs); error → banner/field mapping for every code above.
2. `InviteAccountantDrawer.test.tsx`: submit sends `{email, locale}`; each error shown in its slot; busy state; lapse read-only.
3. `NewShareLinkDrawer.test.tsx`: PIN validation (3, 9, letters, Arabic-Indic accepted); done pane shows URL, Copy message; closing clears the URL from the DOM.
4. `SharingPage.test.tsx`: owner vs member vs flag off vs local; links 404 → Accountants alone; one column failing leaves the other.
5. `Scene.test.tsx` + generator test: three hexes mapped to variables, unknown hex fails the generator, missing scene falls back.
6. Route-walking and destinations tests updated; `pressFeedback.test.tsx` and `direction.test.ts` cover new controls.
Checks before merge (heavy queue): `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run build`; plus server checks if S1 lands here.

## Files
- **New:** `src/hosted/pages/sharing/{SharingPage,AccountantsColumn,LinksColumn,InviteAccountantDrawer,NewShareLinkDrawer}.tsx`, `src/hosted/pages/sharing/sharingRules.ts`, `src/hosted/data/sharingQueries.ts`, `src/hosted/components/{AccessScopeList,Scene}.tsx`, `scripts/generate-illustrations.ts`, `src/components/illustrations/generated/**` (generated), tests under each `__tests__/`, `qa/features/portal/sharing.yaml`, `qa/specs/portal/sharing.spec.ts`.
- **Changed:** `src/hosted/router.tsx` (route), `src/hosted/pages/you/YouProfiles.tsx` (entry row), `src/hosted/components/ProfilesManageDrawer.tsx` (Sharing row), `src/hosted/api/client.ts`, `src/hosted/i18n/{ar,en}.json`, `src/hosted/hosted.css` (`.hp-sharing-*` with logical properties), `docs/analytics/events.json`, `package.json` (`illustrations:generate`), `qa/support/portalApi.ts`, `DESIGN.md` (Scene + Sharing recipes), `.claude/{COMPONENT_REGISTRY,CHANGELOG,TEST_PLAN}.md`.
- **Docs:** design brief `.claude/designs/MUT-561-portal-sharing.md` (this plan + QA scenarios) and `-tests.md` on the build branch. No ADR unless S1 lands here (then a line in ADR-246's amendments).

## Build order
- **Slice A — now (needs only MUT-559):** Scene renderer → Sharing page with the Accountants column, invite drawer, stop/cancel/invite again, entry rows, empty state, i18n, telemetry, QA `entry`/`accountants-list`/`invite`/`revoke-access`/`empty`/`layout`.
- **Slice B — after MUT-560 merges:** (S1 if still needed) → Links column, New link drawer + done pane, Turn off, QA `create-link`/`link-rows`, layout re-run.
- Assets: placeholders until Claude Design delivers `accountant-empty`, `link-ready`, `accountant`, `link`; then swap (regenerate, no code change).
- Close when both slices pass; MUT-562 starts its UI slices after slice A's Scene commit merges (shared component).

## Decisions (auto)
- **D1 Route** `/p/$profileId/you/sharing` under the profile route: the wireframe's URL; the island stays lit; no new destination.
- **D2 Drawer, not a dialog component**, for Invite and New link: DESIGN.md drawer-first (BlockingDialog is only for must-answer); the Drawer is already a `role="dialog"`. (Visual check in Questions.)
- **D3 Done pane swaps the drawer body; URL and PIN never in the URL, storage or cache**: AC3, "shown once".
- **D4 No email-language picker**; `locale` = the portal's current language (OW2).
- **D5 Copy message** built client-side in the portal's language, never containing the PIN (OW4, AC3).
- **D6 OW5 rule on the server** (S1), not filtered in the client: one owner for the phone and portal.
- **D7 Destructive actions (Stop, Cancel, Turn off) are InPlaceConfirm rows**: DESIGN.md rule; Invite again needs no confirm.
- **D8 Feature gate** `me.clients !== undefined` + owned profile + signed in; Links column hidden on its own 404: matches 13231 and the separate SHARE_LINKS flag.
- **D9 Period label computed client-side for the form preview only**; rows show the server's `from/to`: the rule's source of truth stays `period.ts`; the client copy is pinned to the server's examples in tests.
- **D10 Scene renderer built here** (first portal ticket to need one) with fallback art: unblocks every MUT-558 portal surface.
- **D11 Optimistic revoke with rollback**: the row leaves at once; a failure puts it back with a toast.
- **D12 Telemetry via opt-in `trackPortal`**; `share_link_created` carries period and expiry only.

## Questions for Basel (UX, not decided here)
1. **Dialog vs drawer:** wireframe B shows small centred dialogs; the portal's rule is drawers. Rec: the standard side drawer (same content, consistent with every other create/edit).
2. **Owner's Download a period** (MUT-314 Q1): not on layout B. Rec: leave it out of MUT-561; a follow-up "Download a period" row on the Sharing page or Reports.
3. **Copy message wording:** rec "{owner} shared {profile} on MTB3A with you ({period}). Open: {url} — I'll send the PIN separately. Works until {date}." in the portal's language.

## Review notes (plan-eng-review, auto-decided)
**Scope challenge:** ~13 new files + ~12 touched, 1 new shared component pair (Scene, AccessScopeList). Smaller arrangement considered: fold `AccountantsColumn`/`LinksColumn` into `SharingPage` — rejected, each column has its own query, error state and slice; the split matches the build slices. Scope accepted as-is; S1 recommended upstream to MUT-560.
**Architecture**
- Design-twice: (A) a Sharing page with drawers, data per column (chosen); (B) one `useSharing` hook returning both lists and all mutations to a monolithic page — shallower (one wide interface, one loading state for two independent servers/flags). A hides the SHARE_LINKS-off case inside LinksColumn.
- Red flags: (2) leakage — the period rule exists client-side for preview (D9, test-pinned; rows trust the server); (5) split ownership — OW5 visibility owned by the server (D6); (6) two ways — invite errors mapped in one `sharingRules` table; (8) hand-synced — the scope bullets are one component shared with MUT-562. None open.
- Security: owner-only by the server (403 NOT_OWNER handled); the link URL never persisted; clipboard only on click; no PII in events.
- Failure modes: invite mail fails → server keeps PENDING, the owner sees Pending (MUT-559); DELETE fails → optimistic rollback + toast; create succeeds but the response is lost (network) → the link exists without its URL: the list shows it, the owner turns it off and makes another (copy in the footnote); SHARE_LINKS off → column hidden; owner LOCKED → create refused, read-only note, list/revoke still work.
**Code quality:** reuses Drawer, InPlaceConfirm, CopyField, HostedTable, QueryView, RowLink, trackPortal; new shared pieces have two proven callers (AccessScopeList: Sharing + invite page; Scene: Sharing + Client books/link page).
**Tests:** every AC maps to a named QA step above; pure rules unit-tested; [→E2E] invite→accept→stop lives in MUT-562's live journey.
**Performance:** two GETs per page view, refetch on focus only; no N+1; drawers lazy-mounted.
**Worktree:** Lane A (this ticket, `src/hosted/pages/sharing`) runs parallel to MUT-562's server slice; router.tsx, i18n JSON and events.json are shared with MUT-562 → merge in order, small conflicts expected.
VERDICT: ENG CLEARED (auto-decided) — slice A ready for /eng-build; slice B after MUT-560 merges.

## Business / product impact
- Owners get one place to hand books to their accountant and take access back, which replaces WhatsApp screenshots and is the owner half of MUT-558.
- Unblocks the accountant side (MUT-562) end to end on the web and gives the phone story (MUT-563) a reference UI.
- Low risk: every rule is enforced by the server; the portal adds no new access path, and the link and PIN are never stored.
