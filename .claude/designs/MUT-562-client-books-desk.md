# MUT-562 — Portal: accountant's "Client books" desk, the public share-link page and the accept-invite page — plan

Epic MUT-558. Repo: mini-crm: portal (`src/hosted/**`) plus a small server slice (`server/`).
Tracker: Jira · barmajiyat · MUT via atlassian-barmajiyat · Backlog → Planned (transition 2) by /eng-ticket; /eng-build → In Progress; finished → In Review.
Claims: **ADR-248** (MUT-560 holds 246, MUT-314 247), API **next minor `-mut562`** at merge (after `1.102.0-mut314` if that lands first), **no migration**.

## Status and blockers
- **MUT-559** merged (local main 69436d7d): invite check/accept/signup, `/v1/me.clients`, `DELETE /v1/clients/{id}`, the accountant read path through `selectProfile`.
- **MUT-560** being built (`feat/mut-560-share-links`, `1.101.0-mut560`): blocks the share-link page (slice C). Built contract read: `/share#<token>`, check/unlock/entries/summary/expense-receipts, `ownerName` in unlock, whole months.
- **MUT-314** Planned, being revised to two downloads (Excel report + Receipts zip): blocks the Download buttons (slice D).
- **MUT-565** Backlog: blocks the 4th-client card and the "3 of 3 free" counter (slice E).
- Blocker gate: the blocked parts are stubbed `TODO(blocked-by MUT-560|MUT-314|MUT-565)` and built after each merges. Slices S, A, B start now.

## Naming (AW1)
The area is **"دفاتر العملاء / Client books"** everywhere (route, i18n, events), never "Clients", which is the owner's customers.

## Shape
```
Email link /accountant-invite#t ─► AcceptInvitePage (public, layout B two panels)
   check(t) ─► signed out: Sign in to accept | Create an account (signup → POST /v1/sessions)
            └► signed in: Accept ─► /client-books/<profileId>          (AC4)
Shell corner "Client books" (only with ≥1 client) ─► /client-books        ClientBooksPage (desk C1)
   GET /v1/clients (S1) ─► table: owner, profile, entries this month, last activity, ended faded + Remove
/client-books/$profileId ─► ClientBookPage (C2/C3), X-Mutaba3a-Profile = client
   GET /v1/profile-entries (S2) · GET /v1/summaries/activity · GET /v1/expenses/{id} + receipt download
   Download (D): MUT-314 mint → hidden form POST stream (Excel report | Receipts zip), follows the period
Share link /share#t ─► ShareLinkPage (public, layout B): check → PIN boxes → unlock → summary band + table
   POST /v1/share-links/{entries,summary,expense-receipts} with the viewer token; Download (D) via the link mint
```

## Server slice S (ADR-248; only needs MUT-559)
- **S1 `GET /v1/clients`** (session, organization-independent, behind ACCOUNTANT_ACCESS): the desk's list. `[{profileId, name, ownerName, sharedSince, status: 'active'|'ended', endedAt?, entriesThisMonth?, lastActivityAt?}]`. Active = ACTIVE grants; ended = REVOKED grants for this accountant with no newer ACTIVE grant on the same profile and not dismissed. Stats only for active: one grouped count of expenses + received payments with money date in the current month (each profile's timezone) and one grouped `max(createdAt)` over live entries, batched over all client ids (2 queries, no N+1). Ended rows carry name/owner only.
- **S1b dismiss:** `DELETE /v1/clients/{profileId}` also accepts a REVOKED grant and moves it to LEFT (the "Remove" on an ended row); no audit row (nothing the owner sees changes). ACTIVE → LEFT stays as MUT-559 built it.
- **S2 `GET /v1/profile-entries`** (profile-scoped, `X-Mutaba3a-Profile`, `requireScope('expenses:read','payments:read')`): the `/v1/entries` feed by money date for one profile, `kinds` repeatable (`expense`, `received`; default both), `occurredFrom`/`occurredBefore`, cursor, limit ≤100. Reuses `store.entries.list([orgId], {order:'occurredOn', kinds, …})` + `serializeEntry`. It goes through `selectProfile`, so MUT-559's derived allowlist admits accountants with no list edit, and the store guard keeps it read-only. Owners can use it too. Never lazy-posts.
  - Repository: `FeedPageRequest.kinds?` (memory + Prisma: skip the other branches; index use unchanged).
- **S3 inline receipts:** `GET /v1/expenses/{id}/receipts/{rid}/download?disposition=inline`, the same rule as the library route (MUT-260 A12), so a PDF previews in the pane. Shared helper with `receipts.ts`.
- **S4 (only if MUT-560 merges without it):** `POST /v1/share-links/entries` gains `kinds` (default `expense`,`received`) and optional `occurredFrom/occurredBefore` clamped inside the link's range. Recommended upstream to MUT-560 (relay): the link feed should send only expenses and received payments (the accountant grant can't read Owed either; the Excel report has the same two kinds).
- Tests (vitest + test:db): S1 active/ended/dismissed/re-invited, stats in each profile's timezone at a month boundary, ≤2 stat queries for 10 clients, flag off 404; S1b REVOKED→LEFT, ACTIVE→LEFT unchanged, other user's grant 404; S2 kinds filter, bounds, cursor, accountant 200 on a client, 404 on an unshared profile, owner 200, never posts a due item, the MUT-559 route matrix classifies it (derived); S3 inline signs `inline`, attachment default unchanged; S4 kinds + clamp (a from outside the range is clamped, never widened). OpenAPI + `hosted:types`.

## Routes (portal) and entry points
- `/accountant-invite` (public; also works signed in), `/share` (public), `/client-books`, `/client-books/$profileId` (authed, outside any profile, `HostedShell profile={null}` with a desk pill).
- `/accountant-invite` and `/share` join `SessionBridge`'s `SIGNED_OUT_PAGES` (mid-way pages are never yanked to `/`).
- Desk search (`validateSearch`, pure parser): `from`/`to` (`YYYY-MM`), `preset` (`month|quarter|year|custom`), `kinds` (`expense`,`income`), `receipts=only`, `entry=<id>` (receipt pane), `download=1` (download drawer).
- **Shell:** a "Client books" corner link beside the Reports icon when `me.clients?.length > 0` (icon `client-books`, placeholder until drawn). On the desk, `HostedShell` takes an optional `pill` slot: "Client books" (lit) | "My books" (→ `/`, HomeRedirect picks the person's profile).
- `destinations.ts`: `/client-books…` lights no profile destination (added to the route-walking test's exceptions).

## Every state
### Accept-invite page (layout B, two panels: lavender context panel with `shared-books` scene | action panel)
Token: read from the fragment, stripped with `replace` (as SetupPage), kept in `sessionStorage` for this tab so it survives the sign-in round trip (`/sign-in?next=/accountant-invite`); cleared on accept, decline-by-leaving does nothing.
- **checking:** BrandLoader.
- **invite (signed out):** "{owner} invited you to read {profile}", "For {masked email} · ends 17 Nov", the 4 scope bullets (`AccessScopeList`, shared with MUT-561), MTB3A one-liner, buttons **Sign in to accept** / **Create an account**.
- **signup:** email fixed (`maskedEmail` shown; the server uses the invite's address) with the lock icon and "the invite's address; it can't be changed", Name, Password (12–128), terms checkbox (current terms version), Turnstile; SL5 note "An account for reading your clients' books. Reading up to 3 client books is always free." (never "no trial"); **Create account and accept** → `POST /v1/accountant-invites/signup` → `POST /v1/sessions` (13231: no session from signup) → `/client-books/<profileId>`. Errors: 409 ACCOUNT_EXISTS → "You already have an account" + Sign in to accept; 409 TERMS_VERSION_STALE → re-check terms and retry once; 403 CHECK_FAILED → Turnstile retry; 422 password → field; 429 → banner; 404 → gone state.
- **accept (signed in):** "Accept {owner}'s invite? You'll read {profile} under Client books. You're signed in as {email}." **Accept** / **Not now** (→ `/`). Accept → `/client-books/<profileId>` (AC4), `me` invalidated.
- **mismatch (403 INVITE_EMAIL_MISMATCH):** "This invite was sent to another address — sent to h***@firm.com, you're signed in as sami@gmail.com." + SL7 hint "An address on the same company domain works too (not Gmail or similar)." + **Sign out and use another account** / **Back to MTB3A**.
- **already (409 ALREADY_HAS_ACCESS):** "You can already read this profile" + Open (client book, or the profile if you own/belong to it).
- **gone (404, or check `expired: true`):** `link-closed` scene, "This invite is no longer available — it was used, withdrawn or ended. Ask {owner|the sender} for a new one."
- **fourth client (slice E, MUT-565):** in place of the Accept button (SL6): "You already read 3 client books for free. Subscribe to the Accountant plan to add more (₪99/month)" + Subscribe (MUT-565 Checkout) + "Not now (the invite stays open until 17 Nov)". The invite stays pending.
### Client books desk (layout C)
- **C1 list:** title "Client books", search by owner or profile (client-side, `dir="auto"`), "3 of 3 free client books" only when `/v1/me` carries MUT-565's cap (slice E). Table: Owner, Profile, Entries this month, Last activity, row action **Download {last month}** (slice D, the Excel report). Ended row faded (tokens, not art) with "No longer shared" and **Remove** (InPlaceConfirm row) (AW4). Row opens the client book.
- **C5 empty (AW5):** `client-books-empty` scene, "No client books yet", "Ask your client to invite you from MTB3A › their profile › Sharing. You'll get an email to accept."
- **C2 client book:** header "{owner} · {profile}" and the read-only line "Read-only · since 12 Oct" (AW2 = C, a line under the title, no icon); side pane: Period (month / quarter / year presets + from-month → to-month), Type (Expenses ☑, Income ☑, Only with a receipt ☐), totals per currency "Spent" / "Received" (`/v1/summaries/activity` for the months; never summed across currencies; one block per currency), Download (slice D). Table: Date, What, Category, Receipt (count / —), Amount (signed, `DecimalAmount`). Infinite "Load more" at 100 per page; "Only with a receipt" filters loaded expense rows and keeps paging until a page is full or the feed ends.
- **No write controls anywhere (AC3):** the desk is built without add/edit/delete; no drawer URL keys are honoured on `/client-books*`; the server refuses writes regardless (MUT-559 three layers).
- **C3 receipt pane:** row → side pane (Drawer at 375): image preview or PDF iframe (S3 inline URL), "Download receipt", the entry's line. Built on `ReceiptPreviewFrame` (extracted from `ReceiptPreview`, which keeps the library route).
- **C4 download (slice D, AW3 + SL3):** two buttons, **Excel report** and **Receipts (zip)** "(about N MB)", both for the current filter's months; over 500 MB the receipts button is off with "Pick a shorter period" (MUT-314 cap).
- **No longer shared (revoked mid-session):** any client read answering 404 → `share-ended` scene, "{owner} stopped sharing {profile}", **Back to Client books**; `me` + `/v1/clients` invalidated, the client's cached queries removed.
- Loading Skeleton; Unreachable + Retry; 375: filters collapse into a block above the table, receipt pane becomes a Drawer.
### Share-link page (layout B)
Token: fragment stripped with `replace`, kept in `sessionStorage` (tab). The viewer token is kept in `localStorage` keyed by `SHA-256(link token)` (WebCrypto; the link token itself is never stored there) so a returning browser keeps its viewer slot; removed when the link answers 404. `<meta name="robots" content="noindex">` and `<meta name="referrer" content="no-referrer">` set on mount.
- **pin (SL1/SL2):** lavender panel with `shared-books` scene, "A private, read-only view. No names or numbers show before the right PIN."; action panel "Enter the PIN you were given", **PIN boxes** (a `PinBoxes` component: 4 boxes that grow to 8, one digit each, paste fills, Arabic-Indic digits accepted, `inputmode="numeric"`, `autocomplete="one-time-code"`, one accessible label for the group), **Open**, "Don't know the PIN? Ask whoever sent you this link."
- **wrong:** "That PIN isn't right. {n} tries left, then the link locks." (`attemptsLeft`).
- **locked (403 LOCKED, SL4):** `link-closed` scene, "This link is locked — a wrong PIN was entered 5 times, so it's locked for everyone. Ask whoever sent it for a new one."
- **gone (404):** `link-closed`, "This link is no longer available — it ended or was turned off."
- **limit (403 VIEWER_LIMIT):** `link-closed`, "This link has reached its viewer limit — only 3 people can open it."
- **again (401 SHARE_VIEW_EXPIRED, SL8):** "Enter the PIN again — for safety, the PIN is asked for every 8 hours." No session clock is shown before then.
- **unlocked:** header "Shared with you by {ownerName} · {profileName}" (SL1; owner omitted when null), lavender summary band "{Aug – Oct 2026} · read-only · Spent … · Received …" per currency (`/summary`), **Excel report** / **Receipts (zip)** (slice D), filter All / Expenses / Income + month select (months of the range), table Date, What, Category, Receipt (View), Amount; View → receipt pane (images inline; PDFs as Download, since link URLs are attachment-signed). 429 → "Too many tries, wait a minute".
- 375: panels stack (context above action), table rows stack.

## Components and reuse
- New `src/hosted/pages/accountant-invite/AcceptInvitePage.tsx` (+ `inviteState.ts` pure reducer), `src/hosted/pages/client-books/{ClientBooksPage,ClientBookPage,ClientBookFilters,ClientBookTable,ClientReceiptPane,ClientDownloads}.tsx` (+ `clientBooksRules.ts`: search → range, presets, kinds, totals view), `src/hosted/pages/share-link/{ShareLinkPage,ShareLinkView}.tsx` (+ `shareLinkState.ts` reducer, `viewerTokens.ts` storage), `src/hosted/components/{PinBoxes,TwoPanelLayout,ReceiptPreviewFrame,EntriesTable}.tsx`, `src/hosted/data/{clientBooksQueries,shareLinkQueries,periodDownload}.ts`.
- **One table for two pages:** `EntriesTable` renders feed rows (expense/received) for the desk and the link page (different data sources, same columns); `TwoPanelLayout` serves the invite and link pages.
- **One download helper:** `periodDownload.ts` mints (MUT-314: member/accountant GET mint, link POST mint) and submits a hidden `<form method="post">` to the stream route so the browser's own downloader writes the file (no Blob in memory); exact mint parameters taken from MUT-314's revised OpenAPI at build.
- Reused: `Scene` + `AccessScopeList` (from MUT-561 slice A), `SetupPage`'s fragment pattern and new-account fields (password, terms, timezone, Turnstile from `components/turnstile`), `HostedTable`, `QueryView`, `InPlaceConfirm`, `Drawer`, `DecimalAmount`, `FilterControls`/`SegmentedControl`, `api.request` with `profileId` = client.

## State and data fetching
- `useClientBooks()` → `['clientBooks']` (`GET /v1/clients`); `useClientEntries(profileId, filters)` → `profileKey(id, 'clientBooks', 'entries', filters)` (infinite); `useClientTotals(profileId, months)` → `/v1/summaries/activity`; `useClientExpense(profileId, expenseId)` → `GET /v1/expenses/{id}`; receipt URL query with `staleTime` from `expiresAt` (the existing URL-margin rule).
- Share link: a reducer (`shareLinkState`) drives check → pin → unlocked/locked/gone/limit/again from API answers; view queries keyed `['shareLink', digest, …]`, never under a profile key; `retry: false` on 4xx.
- Invite: `inviteState` reducer from check result × `/v1/me` (signed in or not) × accept/signup errors.
- On any client 404: `removeQueries(profileKey(id))`, invalidate `ME_KEY` and `['clientBooks']`.

## i18n (`src/hosted/i18n/{ar,en}.json`, Arabic first)
- `hosted.clientBooks.*`: `title` ("دفاتر العملاء" / "Client books"), `corner`, `myBooks`, `search`, `free` ("{used} of {cap} free client books"), `cols.{owner,profile,thisMonth,lastActivity}`, `downloadMonth`, `ended`, `remove`, `removeConfirm`, `empty.{title,body}`, `readOnly` ("Read-only · since {date}"), `filters.{period,month,quarter,year,custom,type,expenses,income,withReceipt}`, `totals.{spent,received}`, `table.{date,what,category,receipt,amount,loadMore}`, `receipt.{download,title}`, `download.{report,receipts,about,tooLarge}`, `gone.{title,body,back}`.
- `hosted.shareLink.*`: `privateView`, `enterPin`, `pinLabel`, `open`, `askSender`, `wrong` (plural by tries left), `locked.{title,body}`, `gone.{title,body}`, `limit.{title,body}`, `again.{title,body}`, `sharedBy`, `band.{readOnly,spent,received}`, `filter.{all,expenses,income,allMonths}`, `view`, `rateLimited`.
- `hosted.accountantInvite.*`: `invited`, `forAddress`, `about`, `signIn`, `create`, `signup.{title,emailFixed,name,password,terms,freeNote,submit,exists}`, `accept.{title,body,accept,notNow}`, `mismatch.{title,body,domainHint,signOut,back}`, `already.{title,open}`, `gone.{title,body}`, `fourth.{title,body,subscribe,notNow}`.
- Shared `hosted.accessScope.*` (MUT-561). Plurals via `useTp`; month names via `Intl`.

## Telemetry
- Signed-in desk (opt-in `trackPortal`): `period_downloaded` with `place: client_books`, `file: report|receipts`, `months` (shared `surface` = portal; MUT-314's surface names become `place`, since `surface` is a fixed shared property).
- Public pages (no account, no consent prompt): `share_link_opened` (after a successful unlock, `period`), `period_downloaded` (`place: link_page`) and `accountant_accepted` (`via: sign_in|signup`) through the cookieless counter `portal_welcome_choice` already uses (ADR-230 precedent): no cookie, no person id, release-only gate. ADR-248 records the extension. See Question 4.
- Contract entries in `docs/analytics/events.json` (`emitters: ["portal"]`); no token, PIN, email or profile id.

## Release-QA
**Stubbed portal app** (`qa/features/portal/{client-books,share-link,accountant-invite}.yaml`, specs in `qa/specs/portal/`, tags `@portal.<area>.<id>`, every action in `step(...)`, stubs in `qa/support/portalApi.ts`):
| feature | AC | Named steps → expect |
|---|---|---|
| `portal.client-books.list` | AC1, AC6 | "Open Client books from the corner" → rows with owner, profile, this month, last activity; "See an ended client" → faded, Remove → confirm → gone; "Arabic at 375" → no overflow. |
| `portal.client-books.empty` | AC1 | "Open with no clients" → scene + explanation. |
| `portal.client-books.client` | AC2, AC3 | "Open Rana · Studio" → read-only line, totals per currency; "Pick Q3" → URL `from=2026-07&to=2026-09`, rows in range; "Income only"; "Only with a receipt"; "Look for write controls" → no Add/Edit/Delete button, `?newIncome=1` ignored. |
| `portal.client-books.receipt` | AC2 | "Open a row's receipt" → pane with the image; "Download receipt" → signed URL request; 375 → drawer. |
| `portal.client-books.revoked` | AC2 | "Read after the owner stops" (stub 404) → share-ended scene, back to the list showing the faded row. |
| `portal.client-books.download` (slice D) | AC2 | "Excel report for Q3" → mint with `2026-07..2026-09`, hidden form POST to the stream; "Receipts (zip)"; over-cap → disabled with hint. |
| `portal.accountant-invite.signed-out` | AC4 | "Open the invite link" → fragment gone from the URL, owner/profile/masked email, bullets. |
| `portal.accountant-invite.signup` | AC4, AC6 | "Create an account" → email fixed, free note; "Submit" → signup then POST /v1/sessions, lands on `/client-books/<id>`. |
| `portal.accountant-invite.accept` | AC4 | "Sign in to accept" → back on the invite after sign-in; "Accept" → client book open. |
| `portal.accountant-invite.refusals` | AC4 | mismatch (masked address + domain hint), account exists, already has access, gone/expired. |
| `portal.share-link.pin` | AC5, AC6 | "Open the link" → no names; "Wrong PIN" → tries left; "Locked"; "Gone"; "Viewer limit"; "PIN again after 8 hours"; Arabic-Indic digits typed into the boxes. |
| `portal.share-link.view` | AC5 | "Right PIN" → owner · profile, band per currency, table; "Expenses only"; "View a receipt"; (slice D) "Excel report" / "Receipts (zip)". |
**Live API** (`qa/features/portal-selfservice/accountant.yaml`, the memory mailer outbox, Turnstile stand-in; `selfservice-live.mjs` with ACCOUNTANT_ACCESS, SHARE_LINKS, PERIOD_DOWNLOADS on):
- `portal-selfservice.accountant.invite-to-books` [→E2E, core]: owner signs in → Sharing → invites `cpa@studio.example` → outbox mail link → new context opens it → Create an account → lands on the client book with the owner's seeded expense → owner Stops → accountant reload shows "stopped sharing" and the faded row. Covers MUT-561 AC2 and MUT-562 AC1–4.
- `portal-selfservice.accountant.share-link` [→E2E] (after MUT-560): owner creates a link (PIN 4821) → fresh context opens it → wrong PIN (4 left) → right PIN → owner · profile and the seeded rows → (after MUT-314) Excel report downloads a non-empty `.xlsx`.
Each passes once before done; `release-qa lint` clean.

## Unit tests (Vitest, TDD)
1. `clientBooksRules`: presets → month ranges (Q3, year, custom; never a future month; ≤24 months), search parse/serialize round trip, totals view per currency.
2. `inviteState`: every check × session × error combination → state.
3. `shareLinkState`: check/unlock/view answers → state, attempts left, 401 → again, 404 clears the viewer token.
4. `viewerTokens`: stores by SHA-256 digest, never the link token; survives reload; cleared on 404.
5. `PinBoxes`: typing, backspace across boxes, paste of 6 digits, Arabic-Indic → ASCII, grows to 8, RTL order, one label.
6. `EntriesTable`: expense vs received rows, signed amounts, receipt column, `dir="auto"` names.
7. `periodDownload`: builds the form with the ticket in the body, never in the action URL; mint error → message.
8. Page tests: `AcceptInvitePage`, `ClientBooksPage`, `ClientBookPage` (no write controls; 404 → share-ended), `ShareLinkPage` (meta tags set; no profile data before unlock).
9. Server tests (slice S) as listed above.
Checks before merge (heavy queue): `npm run lint`, `typecheck`, `test:run`, `build`; server `typecheck`, `lint`, `openapi:check`, `test`, `test:db`.

## Files
- **Server (slice S):** `server/src/routes/accountants.ts` (S1, S1b), new `server/src/routes/profile-entries.ts` (S2), `server/src/routes/expenses.ts` + `receipts.ts` (S3 shared helper), `server/src/accountants/grants.ts` (`clientBooksOf`), `server/src/repositories/{ports,memory,prisma}.ts` (`kinds`, `listEndedByAccountant`, `dismiss`, client stats), `server/src/schemas.ts`, `server/src/app.ts` (registration, organization-independent set, API_VERSION), `server/src/auth/store-guard.ts` (new read methods `read`), OpenAPI, `src/hosted/api/schema.d.ts`; S4 in `server/src/routes/share-links.ts` if needed.
- **Portal:** pages and components listed above; `src/hosted/router.tsx`, `src/hosted/shell/{HostedShell,destinations}.tsx`, `src/hosted/session/SessionBridge.tsx`, `src/hosted/components/ReceiptPreview.tsx` (extract `ReceiptPreviewFrame`), `src/hosted/api/client.ts`, `src/hosted/i18n/{ar,en}.json`, `src/hosted/hosted.css`, `docs/analytics/events.json`, `src/hosted/analytics/portalAnalytics.ts` (public counter), `qa/**` as listed, `DESIGN.md` (desk, two-panel, PIN boxes), `.claude/{DECISIONS (ADR-248),COMPONENT_REGISTRY,CHANGELOG,TEST_PLAN}.md`.
- **Docs:** `.claude/designs/MUT-562-client-books-and-link-page.md` (+ `-tests.md`) on the build branch.

## Build order
- **S — now:** server slice S1–S3 (needs only MUT-559). Lands first; the UI slices read its types.
- **A — now, after MUT-561's Scene commit merges:** accept-invite page (all states except fourth-client).
- **B — now:** Client books desk (list, empty, client book, receipts pane, revoked), shell corner + desk pill. The live `invite-to-books` journey runs once A + B + MUT-561 slice A are on main.
- **C — after MUT-560 merges:** share-link page (S4 first if still needed).
- **D — after MUT-314 merges:** downloads on the desk (filter + row "Download {month}") and the link page.
- **E — after MUT-565's server part:** fourth-client card and the free counter. If MUT-565 lags when A–D are done, E moves to MUT-565 (its AC already covers it) and this ticket closes.
- Lanes: Lane 1 MUT-561 A (`src/hosted/pages/sharing`) ∥ Lane 2 this ticket's S (`server/`). Then A ∥ B in this ticket (disjoint pages; shared router/i18n/CSS → merge in order).

## Decisions (auto)
- **D1 Area named Client books, route `/client-books`** (AW1); outside any profile with a desk pill: the owner's "Clients" keeps its meaning.
- **D2 New profile-scoped `GET /v1/profile-entries`** rather than widening `/v1/entries` to grants: access stays at the one door (`selectProfile`, MUT-559), the derived allowlist and store guard apply for free, and the cross-profile feed keeps memberships only.
- **D3 `GET /v1/clients` for the desk; `/v1/me.clients` unchanged** (active only): keeps the phone contract and `/v1/me` lean; ended rows and stats are a desk need.
- **D4 Remove on an ended client = REVOKED → LEFT** through the existing DELETE: no migration, one route.
- **D5 Desk period = whole months** (month/quarter/year/custom months): the same rule as links and MUT-314's download, so the download can follow the filter exactly (AW3).
- **D6 Totals from `/v1/summaries/activity`** (per currency, never summed): an existing accountant-readable route, no client-side summing over pages.
- **D7 Download = mint + hidden form POST** to MUT-314's stream: native downloader, nothing in URLs, no Blob in memory.
- **D8 Tokens:** fragments stripped; link/invite token in `sessionStorage` (tab); viewer token in `localStorage` keyed by SHA-256 of the link token: survives reload and keeps the viewer slot without storing the link.
- **D9 Signup then `POST /v1/sessions`** (13231), then land on the client book (AC4).
- **D10 One `EntriesTable`, one `TwoPanelLayout`, one `ReceiptPreviewFrame`** across desk, link page and receipts library.
- **D11 Inline receipt URLs (S3)** for the desk; the link page shows PDFs as downloads (MUT-560 signs attachment URLs).
- **D12 Public-page events cookieless** (ADR-230 precedent) and desk events opt-in; MUT-314's surfaces become a `place` property.
- **D13 Client books corner only with ≥1 active client** (AP5's rule on the web).
- **D14 Link and desk show expenses and received payments only**; S4 / MUT-560 note for the link feed.
- **D15 Slice E moves to MUT-565** if its server part isn't ready when A–D are done.

## Questions for Basel (UX, not decided here)
1. **Download follows which filter?** Rec: the period only. The Excel report always has Expenses, Income and Summary sheets; the Type filter only narrows the screen.
2. **Row "Download Oct" on the Client books list:** rec the Excel report for last month only (receipts from the client book).
3. **Accountant with only ended clients:** the corner link disappears; the desk stays reachable by URL. Rec: accept. Also rec: keep Home as it is (no automatic landing on Client books).
4. **Counting on public pages:** `share_link_opened`, link downloads and `accountant_accepted` counted without consent, cookieless (as the welcome's door count), or not at all? Rec: cookieless count (MUT-560 Q5 is still open).
5. **"Stop reading this client" on the portal:** decided for the phone (AP6), not the web. Rec: not on the portal now.

## Review notes (plan-eng-review, auto-decided)
**Scope challenge:** ~25 new files, ~20 touched across server + portal: past the complexity gate. Smaller arrangement considered: drop S2 and read `/v1/expenses` + `/v1/payments` and merge pages client-side — rejected (two paginations merged by date in the browser, wrong totals with partial pages, a second way to build the feed). Drop S1 and show `/v1/me.clients` only — rejected (AC1 needs last activity; AW4 needs ended rows). Split this ticket into desk / link page / invite page tickets — not needed: slices give the same isolation. Scope accepted as-is; structure = original arrangement in 5 slices.
**Architecture**
- Design-twice for the client read: (A) profile-scoped `GET /v1/profile-entries` behind `selectProfile` (chosen: one door, derived allowlist, store guard); (B) `/v1/entries?profileId=` admitting ACTIVE grants (second access path inside an organization-independent route; MUT-559 kept those membership-only on purpose). A hides more policy behind the existing interface.
- Red flags: (2) leakage — the period rule: desk months parsed in `clientBooksRules` and validated by the server (MUT-314 range rules); (5) split ownership — `/v1/me.clients` (active) vs `/v1/clients` (desk): one server function `clientBooksOf` builds both views; (6) two ways — one EntriesTable, one download helper; (7) importable internals — `share-link/viewerTokens.ts` is imported only by the page (eslint `no-restricted-imports` for `pages/*/**` cross-imports); (8) hand-synced — the scope bullets are one component. None open.
- Security: tokens only in fragments, bodies and tab storage; the link token never in localStorage; `noindex` + `no-referrer`; download tickets in POST bodies; no write control on any accountant surface and the server refuses writes regardless; public pages show nothing identifying before the PIN; mismatch shows only the masked address.
- Failure modes: owner revokes mid-session → 404 → share-ended state (tested); viewer's 8 h ends mid-scroll → 401 → PIN again, filters kept; link locked while viewing → 404/403 → locked state; signup ok but sign-in fails (network) → "Account created, sign in to continue" with the email prefilled (never a second signup); mint 422 PERIOD_TOO_LARGE → receipts button off with hint; stream cut → browser's failed download, retry; Turnstile unavailable → CHECK_FAILED retry; storage blocked (Safari private) → viewer token kept in memory only (slot spent on the next visit, acceptable).
**Code quality:** reuses SetupPage's fragment handling and account fields, Turnstile, HostedTable, QueryView, InPlaceConfirm, DecimalAmount, Scene/AccessScopeList (MUT-561); extractions (`ReceiptPreviewFrame`, `EntriesTable`, `TwoPanelLayout`) each have two proven callers.
**Tests:** every AC maps to named steps above; the two live journeys are the [→E2E] for auth + access + revoke; pure reducers carry the state matrix.
**Performance:** desk list = 1 call (S1: grants + 2 grouped stat queries); client book = entries page (indexed, ≤100) + 1 summary; receipt URLs fetched on open only; link page = summary + entries pages. No N+1, no polling.
VERDICT: ENG CLEARED (auto-decided) — slices S, A, B ready for /eng-build; C, D, E wait on MUT-560, MUT-314, MUT-565.

## Business / product impact
- Accountants get a desk for every client's books on the web, and anyone with a link and PIN can read and download a period without an account: the accountant half of MUT-558 and the reason accountants send clients to MTB3A.
- Closes the web loop with MUT-561 (invite → accept → read → stop) and sets up the Accountant plan upsell (MUT-565).
- Risk is contained: two small server reads behind the existing access door, read-only everywhere, and public pages that show nothing before the PIN.

## Build notes (2026-11-06, /eng-build, branch feat/mut-562-client-books-desk)

The server slice S moved to MUT-575 (MUT-562 comment 13246); this branch consumes its routes. Basel's decisions
(MUT-558 13236 + 13244, MUT-575 13247) override the plan where they differ:

- **Corner visibility:** `/v1/me.clients` non-empty, which now lists ended clients not yet removed (13247 Q1).
- **Remove** on an ended row = `DELETE /v1/clients/{id}` (MUT-575 sets `dismissedAt`, not LEFT).
- **Feed:** `/v1/profile-entries` with `kinds=expense&kinds=received` (repeatable query params; `api/client.ts` now
  serialises arrays).
- **Public pages:** cookieless counts only (`countPublicPage`, ADR-250): `share_link_opened {period}` and
  `accountant_accepted {via}`. The contract (2.7.0) already lists both; its descriptions ("decided with MUT-562", the
  welcome being "the only portal event sent without consent") are updated at the next contract bump, not here (a
  description change needs a version and a pin row).

### Deviations (closest option picked, no user asked)

1. **Desk periods are at most 12 months** (not 24): `/v1/summaries/activity` reads at most 13. MUT-314's download cap
   is wider, so a download can still follow any desk period.
2. **Receipt pane = the portal Drawer at every width** (a side sheet on desktop, a sheet at 375), not a grid column.
   `ReceiptPreviewFrame` was not extracted: the library's `ReceiptPreview` reads library URLs; the pane reuses its
   classes and asks the expense's own (inline) URL. One fewer shared component, same look.
3. **Terms version on signup:** the invite check answers none, so the first signup names none; the 409
   TERMS_VERSION_STALE answers `current`, and the form sends again once (a fresh Turnstile token) naming it. Suggest
   MUT-575/559 add `termsVersion` to the check (as /setup's check has) to drop the retry.
4. **"Already reading" → Open** goes to `/client-books` (or Home with no client): the check names no profile id.
5. **Scenes and the scope bullets** wait for MUT-561's Scene renderer and AccessScopeList (unmerged): the context
   panel is words only, with `TODO(MUT-561)` hooks. MUT-558's drawn client-books icon is used for the corner.
6. **Share-link referrer:** the portal's own `<meta name="referrer" content="same-origin">` is switched to
   `no-referrer` while the page is open and put back on leaving; `noindex` is already the portal's.
7. **Viewer token (review fix 2):** the live token stays in memory; localStorage keeps `{viewerToken, viewerExpiresAt,
   linkExpiresAt}` only to keep this device's place, dropped once the link has ended (not at `viewerExpiresAt`: MUT-560
   keeps a place only when the ended token comes back with the PIN). Gone/locked/full also clears the tab's link token;
   the crash reporter's user is cleared while /share is open. The public counts are allowed on the cookieless instance
   (`COOKIELESS_PORTAL_EVENTS`).
8. **SHARE_VIEW_EXPIRED** (401 on a visitor route) never ends a signed-in session (`SESSIONLESS_401` in the client).

### Blocked (TODOs in code)

- `TODO(blocked-by MUT-314)`: Excel report / Receipts (zip) on the client book, the row "Download {last month}" and the
  link page (periodDownload, `period_downloaded`). MUT-314 is not on main.
- `TODO(blocked-by MUT-565)`: the 4th-client card (402 ACCOUNTANT_PLAN_REQUIRED on accept) and "{used} of {cap} free".
- `TODO(MUT-561)`: scenes (`shared-books`, `link-closed`, `client-books-empty`, `share-ended`) and AccessScopeList.

### QA scenarios (release-QA, stubbed portal)

`qa/features/portal/{client-books,accountant-invite,share-link}.yaml`, specs in `qa/specs/portal/`, over
`qa/support/clientBooksApi.ts`: client-books.{list,empty,client,receipt,revoked}, accountant-invite.{signed-out,
signup,accept,refusals}, share-link.{pin,view}. The live `portal-selfservice.accountant` journeys wait for MUT-561 and
MUT-575 on main (and MUT-314 for the Excel step).
