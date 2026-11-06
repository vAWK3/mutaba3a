# MUT-575 — Server: client-books list, client feed, ended clients, invite app link and the accountant events contract (plan)

Epic MUT-558. Repo: mini-crm (`server/` + `docs/analytics/`). Built on MUT-559 (local main 69436d7d, In Review), on top of MUT-560 (`feat/mut-560-share-links`, merges first) and MUT-314 (Planned).
Blocks MUT-562 (portal desk) and MUT-564 (phone Client books). **This ticket is the one home of the client-books server slice**: MUT-562's planned slice S (S1–S4) and MUT-564's S1–S3 move here and are reconciled into one contract below.
Claims (renumbered at build; re-check at merge): **ADR-249**, **API 1.104.0-mut575** (after 1.102.0-mut560 and 1.103.0-mut314; MUT-314 holds ADR-248), migration **`20261107140000_mut575_client_books`** (after MUT-557's `20261107130000`).
Numbering collisions found: `feat/mut-557-allocation-number` also claims ADR-246 and `1.101.0-mut557`; MUT-562's plan claimed ADR-248. Whoever merges later renumbers; MUT-562 moves to ADR-250+.
Tracker: Jira · barmajiyat · MUT via atlassian-barmajiyat · Backlog → Planned (transition 2) by /eng-ticket; /eng-build → In Progress; finished → In Review.

Ticket status was Backlog; planned on the caller's instruction (it blocks two planned stories). No blockers: MUT-559 is merged. MUT-560 must merge first only because S5 and the shared guard set build on its code.

## One contract for both clients

```
Phone tab / portal corner  ──► GET /v1/me  .clients[]        (active + ended-undismissed, no stats; cached with me)
Desk list / phone list     ──► GET /v1/clients               (same rows + entriesThisMonth, lastActivityAt)
Client feed (both)         ──► GET /v1/profile-entries       X-Mutaba3a-Profile: <client>  (selectProfile → grant)
Stop reading / Remove      ──► DELETE /v1/clients/{id}       (ACTIVE → LEFT; ended → dismissed)
Receipt preview (desk)     ──► GET /v1/expenses/{e}/receipts/{r}/download?disposition=inline
Invite email link          ──► https://<portal>/accountant-invite#t   (AASA claims /accountant-invite*)
```

**Tab/corner visibility comes from `/v1/me.clients`** (non-empty). Reason: the phone caches `/v1/me` offline (MUT-208), so the tab renders on a cold start with no extra call, and `/v1/me` stays free of stat queries. `/v1/clients` is only fetched when the list screen opens.

## S1 — Ended clients

### Data (migration `20261107140000_mut575_client_books`, additive)
```
model AccountantGrant { … + dismissedAt DateTime?   // the accountant removed this ended client from their list }
```
- No new status. **Ended** is computed:
  - `revoked`: status REVOKED, `endedAt = revokedAt`.
  - `closed`: status ACTIVE but the profile owner's account is closing (MUT-333 `closure` set), `endedAt = closure.requestedAt`. "Keep my account" brings it back as active; the purge deletes the profile and its grants, so the row is gone after purge.
- **LEFT is not listed**: the accountant chose to stop (see Question 2).
- Why a `dismissedAt` column instead of MUT-562's REVOKED → LEFT: REVOKED vs LEFT is the record of who ended access (schema comment, owner audit). Rewriting REVOKED as LEFT would make the history say the accountant left. One nullable column, no backfill, no index (reads use `(accountantUserId, status)`).

### Which rows (pure `clientRows(grants, owners)` in `accountants/grants.ts`)
Per profile, from the accountant's ACTIVE grants and undismissed REVOKED grants (`accountantGrants.listForAccountant`, one indexed query):
1. An ACTIVE grant → `active` (or `ended/closed` when the owner is closing).
2. Else the latest undismissed REVOKED grant (by `revokedAt`) → `ended/revoked`. A re-invite that's accepted hides older REVOKED rows; a pending re-invite doesn't (not accepted yet).
3. Profile gone (purged) → no row.
Order: active (oldest accept first, as today), then ended (newest `endedAt` first).

### Shape (`AccountantClientSchema`, extended additively; also the accept response)
`{profileId, name, ownerName, profileType: 'personal'|'business'|null, sharedSince, status: 'active'|'ended', endedReason: 'revoked'|'closed'|null, endedAt: datetime|null}`.
An ended row carries only these (no data access: every profile-scoped call answers 404).

### Routes
- `GET /v1/me` `.clients`: the rows above, no stats. Omitted when ACCOUNTANT_ACCESS is off (as today).
- **New `GET /v1/clients`** (session, organization-independent, in `ACCOUNTANT_ENDPOINTS` so the flag 404s it, `PERSON_LEVEL_GATE` class `open`): `{items: [row + {entriesThisMonth: int|null, lastActivityAt: datetime|null}]}`. Stats for active rows only; null on ended.
  - `entriesThisMonth`: live expenses + received payments whose money date is in the current calendar month in **each profile's timezone** (`todayFor`).
  - `lastActivityAt`: newest `createdAt` of a live expense or received payment.
  - New `entries.clientActivity(windows: {organizationId, from, before}[]) → Map` (memory + Prisma). Prisma: one grouped count over the money-date indexes the feed uses, one `LATERAL … ORDER BY createdAt DESC LIMIT 1` per profile on the createdAt indexes. 2 queries whatever the client count; store class `sessionOnly`.
  - No paging: bounded by the person's grants (MUT-565 caps the free tier at 3).
- **`DELETE /v1/clients/{profileId}`** (exists) gains the dismiss branch, decided server-side so clients send one call:
  - ACTIVE grant (owner closing or not) → LEFT, audit `accountant.left` (unchanged MUT-559 behaviour).
  - Else undismissed REVOKED grants → set `dismissedAt` on all of them (so an older one can't resurface). No audit row: the owner sees nothing change.
  - Else 404.
  - New repository `accountantGrants.dismiss({organizationId, accountantUserId, at}) → count`, class `sessionOnly` like `leave`.

### Closing owner ends access too (consistency fix)
Today `namedClient` (middleware.ts) admits an accountant to a closing owner's profile, while MUT-560's `openLinkProfile` refuses a link to it. One predicate, **`ownerIsClosing(store, organization)`**, extracted to `src/access/owner-closing.ts` (next to MUT-560's `view-touch.ts`), used by `openLinkProfile`, `namedClient` (→ 404, like a revoke) and `clientRows`. It reads the owner user once; `ownerNameOf` reuses that read (no extra query per client).

## S2 — A client's feed: `GET /v1/profile-entries` (profile-scoped)

- Named by **`X-Mutaba3a-Profile`** and served through `selectProfile`, so for an accountant MUT-559's three layers apply unchanged: method gate, the derived GET allowlist (D1 admits it because its tags are all accountant scopes, no list edit) and the read-only store guard. Owners and members can use it too (same rows they already read).
- Tags: `requireScope('expenses:read')`, `('payments:read')`, `('conversions:read')`. `SESSION_ONLY`.
- Query: `kinds` repeatable `expense|received|owed|conversion` (default all four, as `/v1/entries`), `occurredFrom`, `occurredBefore` (ISO days), `cursor`, `limit` 1–100. Order is always money date (`occurredOn`), newest first.
- Response: `EntryPageSchema`, byte-for-byte the `/v1/entries` shape, so the phone's `FeedPage`/`RecentItem` and the portal's table parse it unchanged.
- **Never mixes:** `/v1/entries` stays membership-only (`entries.ts:62`), so the accountant's own feed is unchanged; `/v1/profile-entries` reads exactly one organization, the selected one. Any profile the person can't select → 404 PROFILE_NOT_FOUND (selectProfile's rule).
- Never lazy-posts (doesn't call `postDueItems`). Lapse: inherits the profile gate (member on a LOCKED profile → 402; accountant of a LOCKED owner → read allowed, MUT-559).
- **One feed builder:** the page logic in `routes/entries.ts` (cursor decode, `entries.list`, receipt counts, settled-Owed lookup, `serializeEntry`) moves to `src/entries/feed-page.ts` `feedPage(store, organizationIds, request)`; both routes call it (red flag 6).
- Repository: `FeedPageRequest.kinds?: readonly EntryRow['kind'][]` (memory + Prisma skip the other branches; indexes unchanged). The API ↔ row kind map (`received`↔`payment`, `owed`↔`receivable`) lives once in `entries/merge.ts`.
- Store guard: `entries.list` and `entries.settledOwedIds` are `sessionOnly`. MUT-560's `SHARE_LINK_SESSION_READS` is renamed **`PROFILE_FEED_READS`** and passed by both `shareLinkStoreGuard()` and `accountantStoreGuard()` (one named list; nothing else joins).
- Why not `/v1/entries?profileId=` (MUT-564's proposal): it would put a second access path inside an organization-independent route that MUT-559 kept membership-only on purpose; the D1 allowlist and the store guard would not apply, so the route would need its own grant check (two doors). Rejected. The AC's "`/v1/entries` for a shared client profile" is met by this route; AC wording to be amended.

## S3 — Invite app link
- `server/src/routes/well-known.ts` `ALLOWED_APPLINKS_PATHS` gains `'/accountant-invite*'`; existing paths unchanged. The apex proxies the same AASA (vite.config.ts), so one source. Never claim `/share*` or `/client-books*` (link visitors and the desk stay on the web).
- Android: assetlinks is domain-level; the path goes in the app's manifest (MUT-564).
- Apple's CDN can take ~24 h to pick up a changed AASA after deploy.

## S4 — Inline receipt preview (from MUT-562 S3)
`GET /v1/expenses/{expenseId}/receipts/{receiptId}/download` accepts `disposition=attachment|inline` (default attachment), using the library route's existing `ReceiptDownloadQuerySchema` and `signDownload(…, {disposition})` (MUT-260). Accountants already read this route (expenses:read).

## S5 — Link feed filters (from MUT-562 S4)
`POST /v1/share-links/entries` gains optional `kinds` (default unchanged: what MUT-560 ships) and `occurredFrom`/`occurredBefore`, **clamped inside the link's range, never widened** (one `clampToRange(range, from, before)` next to MUT-560's `feedBoundsOf`). Which kinds the link page asks for is MUT-562's choice.

## Events contract (`docs/analytics/events.json` 2.6.0 → 2.7.0)
The API never sends (README, ADR-090); these are for the clients. `surface` is the shared property (portal/ios/android), so the "where" inside a surface is **`place`** (the `billing_offer_shown` precedent). No email, name, profile id, token, URL or PIN. Integers only where the enum rule (snake_case values starting with a letter) can't express numbers.

| Event | Emitters | Properties | When |
|---|---|---|---|
| `accountant_invited` | portal, ios, android | — | owner, after 201 |
| `accountant_revoked` | portal, ios, android | `was`: pending\|active | owner, after 204 |
| `accountant_accepted` | portal, ios, android | `via`: signed_in\|signup | accountant, after accept/signup |
| `accountant_left` | ios, android | — | accountant "Stop reading", after 204 |
| `share_link_created` | portal, ios, android | `period`: last_1_month\|last_2_months\|last_3_months\|whole_profile; `expires_in_days`: integer (1, 7, 30) | owner, after 201 |
| `share_link_revoked` | portal, ios, android | — | owner, after 204 (MUT-563 needs it; same bump) |
| `share_link_opened` | portal | `period` (as above) | link page, after a successful unlock |
| `period_downloaded` | portal, ios, android | `place`: owner\|client_books\|link_page; `file`: report\|receipts; `months`: integer 1–24 | after the MUT-314 mint answers 200 |

- Supersedes the property names in sibling plans: MUT-314's `surface` values → `place`; MUT-564's `kind`/`side`/bucket → `file`/`place`/integer `months`; MUT-563's `expires_days` → `expires_in_days`.
- The pinned sha in `scripts/__tests__/analytics-taxonomy.test.ts` gets the 2.7.0 line; the phone's fixture copy + sha follow in MUT-563/564.
- Whether public pages (link page, invite page signed out) may send without consent is still open (MUT-560 Q5 / MUT-562 Q4); the README exception, if any, lands with MUT-562.

## Files
- **New:** `src/routes/profile-entries.ts`, `src/entries/feed-page.ts`, `src/access/owner-closing.ts`, migration.
- **Changed:**
  - `prisma/schema.prisma` (`dismissedAt`).
  - `src/repositories/ports.ts`, `memory.ts`, `prisma.ts`: `accountantGrants.listForAccountant`, `accountantGrants.dismiss`, `entries.clientActivity`, `FeedPageRequest.kinds`.
  - `src/auth/store-guard.ts`: STORE_ACCESS rows for the 3 new methods; `PROFILE_FEED_READS`.
  - `src/accountants/grants.ts`: `clientRows` (pure) + `clientBooksOf(store, userId, now, {activity})` replacing `clientsOf`; `clientOf` returns the extended shape.
  - `src/auth/middleware.ts` (`namedClient` closing check), `src/share-links/access.ts` (uses `ownerIsClosing`), `src/routes/share-links.ts` (S5).
  - `src/routes/accountants.ts` (`GET /v1/clients`, DELETE dismiss branch, endpoint sets), `src/routes/me.ts`, `src/routes/entries.ts` (calls `feedPage`), `src/routes/expenses.ts` (S4), `src/routes/well-known.ts` (S3).
  - `src/billing/gate.ts` `PERSON_LEVEL_GATE` (`GET /v1/clients: open`), `src/schemas.ts`, `src/app.ts` (registration, API_VERSION).
  - `docs/analytics/events.json`, `scripts/__tests__/analytics-taxonomy.test.ts` (pin).
  - OpenAPI (`npm run openapi:generate`), `npm run hosted:types`.
- **Docs:** ADR-249 in `.claude/DECISIONS.md` (ended = computed + dismissedAt; profile-scoped client feed, `/v1/entries` stays membership-only; a closing owner ends accountant access; events `place` rule). Brief `.claude/designs/MUT-575-client-books-server.md` + `-tests.md` on the build branch.

## Tests (TDD; `npm --prefix server test`, `test:db` for Prisma, root `npx vitest run scripts/__tests__/analytics-taxonomy.test.ts`)
1. **`clientRows` (pure):** active; revoked → ended/revoked with `endedAt = revokedAt`; owner closing → ended/closed; LEFT not listed; dismissed not listed; re-invited and accepted hides older REVOKED; two REVOKED → latest only; pending re-invite keeps the ended row; order active-then-ended.
2. **`/v1/me.clients`:** extended shape; ended rows present; flag off → field absent; accept response carries `status: active`.
3. **`GET /v1/clients`:** rows + stats; `entriesThisMonth` at a month boundary in two timezones (UTC 22:30 on the 31st vs Asia/Jerusalem); deleted/undone rows not counted; ended rows have null stats; non-accountant → `[]`; flag off → 404.
4. **Stats cost:** 10 clients → exactly 2 activity queries (query counter on Prisma), no per-client entry reads.
5. **DELETE /v1/clients:** ACTIVE → LEFT with audit (unchanged); ended → dismissed, no audit, gone from both lists, stays gone after re-read; two REVOKED both dismissed; closing owner + ACTIVE → LEFT; unknown or another user's → 404.
6. **Closing owner:** owner requests closure → accountant's profile-scoped GET → 404 and the row shows ended/closed; "Keep my account" → active again and reads 200; purge → row gone; share link behaviour unchanged (MUT-560 tests still pass through `ownerIsClosing`).
7. **`/v1/profile-entries` as accountant:** 200 with only the client's rows; `kinds` filter each value and combinations; `occurredFrom/Before` bounds; cursor paging stable; limit 101 → 422; unshared profile → 404; revoked mid-session → 404; any non-GET → 403 ACCOUNTANT_READ_ONLY.
8. **Never mixes:** the accountant's `/v1/entries` (no header, and with `profileId` = the client) has none of the client's rows / 404; `/v1/summaries/verdict` unchanged (MUT-559 isolation test extended).
9. **`/v1/profile-entries` as owner/member:** same rows as `/v1/entries?profileId=X&order=occurredOn` page for page (parity, proves one builder); LOCKED profile → 402; never posts a due installment.
10. **Derived allowlist + guard:** MUT-559's route matrix classifies the new route with no hand edit (allowlisted GET → 200 for the accountant); under an accountant request `entries.list` passes the guard and a write still throws; `PROFILE_FEED_READS` used by both guards (share-link guard tests unchanged).
11. **Receipt inline (S4):** `disposition=inline` signs inline; default and `attachment` unchanged; accountant 200; invalid value 422.
12. **Link feed filters (S5):** `kinds` narrows; a `from` before the link's range is clamped to it, a `before` after it clamped; never widened; default response unchanged.
13. **AASA (S3):** `paths` = the 3 existing + `/accountant-invite*` in order; `/share`, `/client-books`, `/setup`, `/sign-in` still unclaimed (extends `well-known-routes.test.ts`).
14. **Events contract:** taxonomy rules pass for the 8 events; 2.7.0 pinned; `place`, `file`, `via`, `was`, `period` enums snake_case; no banned token.
15. **Migration:** `test:db` applies it on a MUT-559 database; existing grants read `dismissedAt = null`.

Checks before merge, through the heavy queue: `typecheck`, `lint`, `openapi:check`, `test`, `test:db`.

## Scale and cost
- `/v1/me`: one indexed grant query + one org and one owner read per client (bounded, ≤ a handful); no stat queries.
- `/v1/clients`: the same + 2 activity queries total, on existing indexes. No N+1.
- `/v1/profile-entries`: the existing feed query for one organization (indexed, bounded page).
- Accountant requests gain one owner read (closing check) on top of the grant read; members pay nothing.
- No new infrastructure, no cron.

## Out of scope
- Client screens (MUT-562, MUT-564), the 3-client cap and price (MUT-565), downloads (MUT-314), consent mode for public-page events (MUT-562).
- Auto-expiring ended rows; notifying the accountant by email when access ends.
- A `withReceipt` server filter for the feed (MUT-562's "Only with a receipt" is client-side; flagged to MUT-562 as a paging risk).

## Decisions (auto, with reason)
- **E1 Ended status is computed; dismissal is a nullable `dismissedAt`**: keeps REVOKED/LEFT truthful as history; additive migration.
- **E2 LEFT grants are not listed**: the accountant's own act; nothing to tell them (Question 2).
- **E3 A closing owner ends accountant access and shows `ended/closed`**: one rule with share links (`ownerIsClosing`); purge removes the row (the deletion promise).
- **E4 One DELETE for Stop reading and Remove**, server picks LEFT vs dismiss: one client call, no state guessing.
- **E5 `/v1/me.clients` drives tab/corner visibility; `/v1/clients` adds stats**: offline cold start, `/v1/me` stays cheap; one builder (`clientBooksOf`) for both.
- **E6 Client feed = profile-scoped `/v1/profile-entries` through `selectProfile`**: one door, derived allowlist and store guard for free; `/v1/entries` stays membership-only.
- **E7 One feed builder (`feedPage`) for both feed routes; one kind map**: no second way to build a page.
- **E8 `PROFILE_FEED_READS` shared by the accountant and link guards**: one named list.
- **E9 Default kinds = all four** (same as `/v1/entries`, all within the accountant's scopes); clients narrow.
- **E10 Stats = expenses + received payments, month in the profile's timezone**; 2 grouped queries.
- **E11 AASA claims only `/accountant-invite*`**.
- **E12 Events: `place` for location, integers for counts, `share_link_revoked` added in the same bump**.
- **E13 S4/S5 included** (moved from MUT-562): same files, small, keeps the server slice in one ticket.

## Review notes (plan-eng-review, auto-decided)
**Scope challenge:** ~3 new files, ~20 touched, 1 additive migration, 2 new routes. Past the 8-file gate, but each slice is small and lives in its existing module; splitting would scatter one contract over tickets. Accepted.

**Architecture**
- Design-twice for S2: (A, chosen) a profile-scoped route behind `selectProfile`; (B) `/v1/entries?profileId=` admitting grants inside an organization-independent route. A hides grant checks, scopes, read-only and lapse behind the existing door; B needs a second grant check and bypasses D1/D2.
- Design-twice for dismissal: (A, chosen) `dismissedAt`; (B) REVOKED → LEFT (no migration). A keeps one meaning per status; B corrupts the ended-by record.
- Red flags: (2) leakage — closing rule in `ownerIsClosing` only; kind map in `merge.ts` only. (5) split ownership — none; ended is computed, not stored twice. (6) two ways — one feed builder, one DELETE, one rows builder. (8) hand-synced — guard reads in one named set; allowlist derived; endpoint sets derived as in MUT-559. None open.
- Failure modes: owner revokes mid-scroll → next page 404 → clients show "no longer shared" (tested 7); owner closes then cancels → active again (6); two DELETEs racing (Stop + Remove) → conditional updates, second 404; stats query slow on a huge profile → indexed + bounded month; AASA CDN lag → link opens the web page until refreshed (acceptable).
- Security: no new public surface; ended rows expose only names the accountant already saw; the flag 404s `/v1/clients`.
- Distribution: server deploy + AASA; the phone manifest ships with MUT-564.

**Code quality:** reuses `selectProfile`, D1, `accountantStoreGuard`, `entries.list`, `serializeEntry`, `signDownload`, `ReceiptDownloadQuerySchema`, `todayFor`, MUT-560's guard and bounds. Extractions with proven callers: `feedPage` (2), `ownerIsClosing` (3), `PROFILE_FEED_READS` (2).

**Tests:** every branch maps to 1–15; 1, 7, 8 and 10 are the regression net. [→E2E] invite → read → revoke → faded → remove belongs to MUT-562 (Playwright) and MUT-564 (`ios.clients.read-only`).

**Performance:** see Scale; no N+1; 2 stat queries regardless of client count.

Outside voice: unavailable (codex not installed).

VERDICT: ENG CLEARED (auto-decided) — ready for /eng-build MUT-575 after MUT-560 merges.

## Questions for Basel (what users see)
1. **Tab/corner with only ended clients left:** visible until the last ended row is removed (the ticket's S1 rule), on both the phone and the portal? Rec: yes, same rule on both (MUT-562 planned "active only" for the corner; this replaces it so faded rows stay reachable).
2. **After "Stop reading this client"**, does the client stay as a faded row? Rec: no, it disappears (the accountant chose it).
3. **Owner closes their account:** the accountant's access ends at once, the client shows as ended "account closed" for the 30-day window, then disappears at deletion. Rec: yes (same as share links).
4. **Ended rows** show only owner, profile and the end date (no entry count or last activity). Rec: yes.
5. **Ended rows stay until removed** (no automatic cleanup). Rec: yes (MUT-564 Q3).

## Business / product impact
- Accountants can read a client's entries on the phone and the web desk, keep ended clients visible until they clear them, and open the invite straight in the app — the server half the accountant screens need (MUT-558).
- Unblocks MUT-562 and MUT-564; ships dark behind ACCOUNTANT_ACCESS with no new infrastructure.
- Low risk: no new access path (everything goes through `selectProfile`), one additive column, and the events contract lands once for all four client tickets.

## Answers (Jira MUT-575 comment 13247, 2026-11-06)
1. The phone tab and the portal corner show while the accountant has any active client or any ended client not yet removed (`/v1/me.clients` non-empty), on both clients.
2. "Stop reading" makes the client disappear (LEFT is never listed).
3. An owner who starts closing their account ends the accountant's access at once (404), the same rule share links follow; the row shows ended/closed until the purge removes it.
4. Ended rows show owner, profile and end date only (no stats).
5. Ended rows stay until the accountant removes them; no automatic cleanup.

AC wording: "`/v1/entries` accepts a client profile" is met by the profile-scoped `/v1/profile-entries`.

## QA scenarios
Server-only: no user-visible screen ships here. The flows (invite → read the client's feed → owner revokes → faded row → Remove) are recorded with MUT-562 (portal, Playwright) and MUT-564 (phone, `ios.clients.read-only`). Server behaviour is pinned by the route tests listed in `MUT-575-client-books-server-tests.md`.

## Build notes (deviations)
- `FeedPageRequest.kinds` already existed (MUT-560); this ticket only adds the API ↔ row kind map in `entries/merge.ts`.
- Link feed filters (S5) accept `kinds` of `expense|received` only: the link's own kinds (MUT-560) are the ceiling, so a narrower list intersects and nothing can widen them.
