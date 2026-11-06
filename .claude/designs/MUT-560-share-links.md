# MUT-560 — Server: one-time share link with period, expiry and PIN, no account needed

> **Status (2026-11-06):** plan approved (eng review CLEARED, auto-decided A1–A19), then amended by Basel's decisions B1–B5
> below, which override the plan wherever they differ. Built on `feat/mut-560-share-links` (ADR-246). The "As built"
> section at the end records where the build follows the code rather than the plan's letter.

## Basel's decisions after the plan (2026-11-06; they override it)

- **B1 Period = whole calendar months.** "Last 1/2/3 months" = the last 1–3 COMPLETE calendar months before the
  creation day, in the profile's timezone (created 2026-11-06 → 3 months = 2026-08-01 … 2026-10-31; the month the link
  is made in is never included). "Whole profile" = everything up to and including the creation day. The resolved
  [from, to] is stored on the link and returned in the owner's list and to the visitor. Replaces A8 and the
  "rolling months" rule under "Period, precisely".
- **B2 The URL is shown once**, at creation; only the token's digest is stored (no re-copy). Confirms A19.
- **B3 No emails** to the owner about link activity.
- **B4 Nothing identifying before the PIN.** The public check says only whether the link is usable and needs a PIN: no
  owner name, no profile name. Names appear only after unlock (the unlock answer carries `profileName` and `ownerName`).
- **B5 Kept:** the visitor's access lasts 8 hours (never past the link's expiry); a lock also cuts off visitors already
  in; no analytics on the public page server-side.

---


Epic MUT-558. Repo: mini-crm (`server/`). Built on MUT-559 (merged to local main 69436d7d, In Review). Blocks MUT-561 (portal owner), MUT-562 (portal link page), MUT-563 (phone owner); MUT-314 (download) calls this ticket's access check.
Claims: **ADR-246** (main and every branch/worktree end at ADR-245), **API 1.100.0-mut559 → 1.101.0-mut560**, migration **`20261107120000_mut560_share_links`**.
Tracker: Jira · barmajiyat · MUT via atlassian-barmajiyat · Backlog → Planned (transition 2) by /eng-ticket; /eng-build → In Progress; finished → In Review.

Ticket status was Backlog; planned on the caller's instruction (the epic is the active roadmap item, MUT-559 just landed). No blockers: MUT-559 is merged.

## Core decision: a small dedicated link API, not the accountant route surface (shape B)

Two shapes were compared.

**Shape A — a link viewer as a third access mode in `selectProfile`.** A viewer bearer becomes `access: 'link'`, reuses D1 (the 33 derived GETs) and the store guard, and every allowed GET learns to clamp to the link's period.
- 33 handlers (lists, by-id details, summaries with opening balances, customers, projects, attachments, retainers) would each need a date clamp, and any GET added later is open to the whole history unless its author remembers periods. The period rule would live in 33 places (red flags 2 and 8).
- Customers, projects and summary routes show data that has no money date at all (client lists, balances to date), which a period cannot bound.
- The viewer token would have to ride in a header, adding a third bearer kind to `authenticate()`.

**Shape B (chosen) — six public POST routes under `/v1/share-links/*` behind one access function.**
- `shareLinkAccess(viewerToken)` is the only door: it resolves the viewer, its link, the profile and the clamped date range, or throws the one 404. Every view route and MUT-314's download call it.
- Reads reuse existing code: `store.entries.list` (the `/v1/entries` feed, `order: 'occurredOn'`, bounded by `occurredFrom`/`occurredBefore`), `serializeEntry`, `summarizeExpenses`, `expenseReceipts.listByExpense` and `storage.signDownload`.
- The period is enforced in one place (the range handed to `entries.list`, and a single "is this expense in range" check for receipts). A route added to the main API later is unreachable from a link by construction.
- The data-layer read-only guard (MUT-559 D2, `accountantStoreGuard`) is set on every link view request, so even a mistaken write in a view handler throws.

Depth: B hides token parsing, viewer binding, expiry/revoke/lock, owner closure and period clamping behind one function with one input; A spreads the period policy over every GET. B also gives MUT-314 a clean seam.

## Data (Prisma migration `20261107120000_mut560_share_links`)

```
enum ShareLinkPeriod { LAST_1_MONTH LAST_2_MONTHS LAST_3_MONTHS WHOLE_PROFILE }

model ShareLink {
  id                 uuid pk
  organizationId     → Organization (onDelete Cascade)
  createdByUserId    → User? (SetNull)
  tokenDigest        String @unique @db.VarChar(64)  // sessionDigest(pepper, token); kept while the link lives (it is reusable)
  pinHash            String                          // argon2id of sessionDigest(pepper, `${id}:${pin}`)
  period             ShareLinkPeriod
  periodFrom         String? @db.Date-like ISO day   // null = whole profile
  periodTo           String  ISO day                 // the creation day, profile timezone, inclusive
  expiresAt          DateTime                        // createdAt + 1, 7 or 30 days; expiry is computed, no cron
  failedPinAttempts  Int @default(0)
  lockedAt           DateTime?
  revokedAt          DateTime?
  lastOpenedAt       DateTime?                       // unlock, or a view (at most hourly)
  createdAt          DateTime
  @@index([organizationId, expiresAt])
  @@map("share_links")
}

model ShareLinkViewer {
  id               uuid pk
  shareLinkId      → ShareLink (onDelete Cascade)
  tokenDigest      String @unique @db.VarChar(64)     // sessionDigest(pepper, viewerToken); rotated on every unlock
  accessExpiresAt  DateTime                           // min(unlock + 8 h, link.expiresAt)
  lastViewedAt     DateTime?
  createdAt        DateTime
  @@index([shareLinkId])
  @@map("share_link_viewers")
}
```
- **One owner per piece of state:** the viewer count is `count(ShareLinkViewer where shareLinkId)`, never a copied column. Adding a viewer runs in one transaction that locks the link row (`SELECT … FOR UPDATE`), counts, and inserts only below 3. The memory store does the same under its single-threaded lock.
- **Failed PINs:** `UPDATE share_links SET failed_pin_attempts = failed_pin_attempts + 1, locked_at = CASE WHEN failed_pin_attempts + 1 >= 5 THEN now END WHERE id = $1 AND locked_at IS NULL RETURNING …` — atomic, so parallel guesses can't exceed 5.
- **Cascades:** profile deletion and the owner's account purge delete the org, which deletes links and viewers. The creator's account deletion nulls `createdByUserId`; the link stays an owner-revocable link on the profile. Purge-plan R18 is untouched (asserted).
- **Cap:** 10 live links (not revoked, not expired) per profile, `config.SHARE_LINKS_PER_PROFILE_MAX`.

### Period, precisely (`src/share-links/period.ts`, pure)
- `today = todayFor(organization, createdAt)` (profile timezone) at creation. `periodTo = today`, inclusive.
- `LAST_N_MONTHS`: `periodFrom = today − N calendar months`, day clamped to the month's last day (Nov 6 → Oct 6; Mar 31 − 1 month → Feb 28/29). Inclusive. So "last month" on Nov 6 is Oct 6 … Nov 6.
- `WHOLE_PROFILE`: `periodFrom = null`, `periodTo = today`.
- The range is frozen at creation and stored. Reads are live inside it: an entry backdated into the range later shows; one edited out of it disappears. Entries dated after the creation day (future-dated, MUT-392) never show.
- To `entries.list`: `occurredFrom = periodFrom`, `occurredBefore = periodTo + 1 day` (the repository's bound is exclusive).

## Access

### The link token and the PIN
- **Link token:** `generateSetupToken()` (32 random bytes, base64url). Stored as `sessionDigest(pepper, token)` (HMAC-SHA256 with the session pepper), the same as invite tokens. Returned once at creation inside the URL `{PORTAL}/share#<token>`. The fragment is never sent to the server (MUT-559 D3), and the token travels only in POST bodies.
- **PIN:** 4–8 digits. The server folds Arabic-Indic and Eastern Arabic-Indic digits to ASCII before validating (Arabic-first; the phone and portal keypads can send either). Hash: `passwordHasher.hash(sessionDigest(pepper, `${linkId}:${pin}`))` — the repo's argon2id (`auth/users.ts`) over a peppered input. A database leak alone can't brute-force the 10⁴–10⁸ space without the pepper, and argon2 slows it if the pepper leaks too.

### The viewer (comment 13226)
- A correct PIN issues a **viewer token** (32 random bytes) bound to one `ShareLinkViewer` row. It is returned in the body; the portal keeps it per link in the browser (MUT-562) and sends it in the body of every view request.
- **Lifetime:** `min(unlock + 8 h, link.expiresAt)`. After that the visitor enters the PIN again.
- **Re-opening doesn't count again:** `unlock` accepts the previous `viewerToken`, even if its access expired. If it matches a viewer of this link, the same row is reused and its token rotated, so the slot is kept.
- **Cap of 3:** a 4th viewer gets 403 `SHARE_LINK_REFUSED` with reason `VIEWER_LIMIT`. The owner revokes and creates a new link.

### `shareLinkAccess` — the one door (`src/share-links/access.ts`)
`shareLinkAccess(store, pepper, viewerToken, now) → { link, viewer, organization, range: { from: IsoDate | null, to: IsoDate } }`.
Throws the uniform **404 NOT_FOUND "This link is no longer available"** (reason `SHARE_LINK_UNAVAILABLE`) when the viewer token is unknown, or its link is revoked, expired, locked or over its profile, or the profile is gone, or the profile's owner account is closing (MUT-333). Throws **401 UNAUTHENTICATED** (reason `SHARE_VIEW_EXPIRED`) only when the viewer is known and its link is usable but its 8-hour access ended; the page then asks for the PIN again.
It stamps `viewer.lastViewedAt` and `link.lastOpenedAt` at most once an hour on the base store (the `accountantViewTouch` throttle, generalised to `viewTouch` in `accountants/grants.ts` → `src/access/view-touch.ts`, so one function serves both).

**Lock policy:** a locked link refuses new unlocks and also ends every viewer's access. The owner sees "locked" and creates a new link.

**Owner's plan lapse:** link routes are public, so the lapse gate never sees them. A READ_ONLY or LOCKED owner's links keep working (epic decision; same as MUT-559). Creating a link is a write on the profile (`pathProfile` class, as inviting is), so a LOCKED owner can't create one; listing and revoking stay `open` (privacy, never paid).

### Read-only enforcement
- The view routes set `c.set('storeGuard', accountantStoreGuard())` before calling `shareLinkAccess`, so any repository write in a handler throws 403. The view touches go through `unguarded(store)`, as the accountant touch does.
- The view routes never call `postDueItems`: the feed never lazy-posts (MUT-270 D2).
- Entry rows are projected for strangers: `serializeEntry` minus `profileId` and `createdByUserId` (no internal ids to anonymous visitors).

## Routes (new file `src/routes/share-links.ts`, OpenAPI regenerated)

Owner side (session; owns the profile — creator or co-owner — else 403 NOT_OWNER; 404 when they can't see it; organization-independent like `/v1/profiles/{id}/accountants`):

| Method | Path | Result |
|---|---|---|
| POST | `/v1/profiles/{profileId}/share-links` `{period, expiresInDays: 1\|7\|30, pin}` | 201 `{id, url, period, from, to, expiresAt, createdAt}`. `url` holds the token in its fragment and is returned **only here**. 409 CONFLICT `SHARE_LINK_LIMIT` at 10 live links. 422 VALIDATION_FAILED `PIN_FORMAT` for a PIN that isn't 4–8 digits. Rate-limited: 20 creates per owner per hour. Audited `share_link.created`. |
| GET | `/v1/profiles/{profileId}/share-links` | `[{id, period, from, to, createdAt, expiresAt, lastOpenedAt, status: active\|locked, viewers, maxViewers: 3, createdByName}]`. Live links only (revoked and expired are hidden); locked links are listed. Every owner sees every link on the profile. |
| DELETE | `/v1/profiles/{profileId}/share-links/{linkId}` | 204. Sets `revokedAt`; every viewer's next request answers 404. Audited `share_link.revoked`. |

Visitor side (public in OpenAPI; all POST so tokens stay in bodies; per-IP limiter on check and unlock, per-viewer limiter on views):

| Method | Path | Body | Result |
|---|---|---|---|
| POST | `/v1/share-links/check` | `{token}` | 200 `{state: 'pin'}`, or 403 `SHARE_LINK_REFUSED` reason `LOCKED`, or the uniform 404. Says nothing about the profile. |
| POST | `/v1/share-links/unlock` | `{token, pin, viewerToken?}` | 200 `{viewerToken, viewerExpiresAt, linkExpiresAt, profileName, period, from, to}`. 403 `SHARE_LINK_REFUSED` with reason `PIN_WRONG` (+ `attemptsLeft`), `LOCKED` (the 5th wrong PIN answers LOCKED), or `VIEWER_LIMIT`. 404 uniform. 429 RATE_LIMITED. Order: find the link → locked → match the returning viewer → cap → verify the PIN → add or rotate the viewer. Audited `share_link.unlocked` (new viewer only, metadata `{viewerNumber}`) and `share_link.locked`. |
| POST | `/v1/share-links/entries` | `{viewerToken, cursor?, limit?}` | The `/v1/entries` page shape (by money date, newest first), clamped to the range, rows projected as above. |
| POST | `/v1/share-links/summary` | `{viewerToken}` | `{from, to, expenses: summarizeExpenses(…), received: [{currency, totalMinor, count}]}` for the range, per currency, never summed across currencies. |
| POST | `/v1/share-links/expense-receipts` | `{viewerToken, expenseId}` | `[{id, filename, mimeType, url, expiresAt}]`: READY receipts of a live expense inside the range, each with a short-lived signed URL (`storage.signDownload`, the existing TTL). Any other expense answers 404. 503 ATTACHMENTS_NOT_CONFIGURED without a bucket. |

Errors: one new code, `SHARE_LINK_REFUSED` (403), with reasons LOCKED, PIN_WRONG and VIEWER_LIMIT (no existing 403 fits a visitor with no account). Everything else reuses codes as reasons, as MUT-559 did.

Headers: the app already sends `X-Robots-Tag: noindex`, `Cache-Control: no-store` and `Referrer-Policy` on every response (app.ts, MUT-551); a test pins them on the link routes. The link page's own `noindex` meta and `Referrer-Policy: no-referrer` are MUT-562's.

## Email
None. The owner shares the URL and PIN themselves (the phone's share sheet, MUT-563). An email to the owner when a link locks is out of scope.

## Telemetry
The API has no PostHog client (`observability/telemetry-gate.ts`). `share_link_created` (with `surface`) is sent by the owner clients MUT-561/563 after a 201; `share_link_opened` by the link page MUT-562 after a successful unlock. Both go through each client's telemetry gate and carry no token, PIN or profile id. The server's own record is the audit rows.

## Dark launch
A sibling flag **`SHARE_LINKS`** (env, default false in prod, true in dev and QA). When off, every share-link route answers 404 before authentication. The existing ACCOUNTANT_ACCESS 404 middleware in `app.ts` becomes one table of `{endpoints, flag}` pairs, so the two switches share one mechanism.

## Files
- **New:** `src/share-links/period.ts` (pure range rules), `src/share-links/links.ts` (create, PIN fold and hash, unlock, revoke, list view, audit rows, constants), `src/share-links/access.ts` (`shareLinkAccess`, the seam MUT-314 calls), `src/routes/share-links.ts`.
- **Changed:**
  - `prisma/schema.prisma` + the migration.
  - `src/repositories/ports.ts`, `memory.ts`, `prisma.ts`: a `shareLinks` repository (create, findByTokenDigest, findViewerByDigest, listLiveByOrganization, countLive, recordFailedPin, addOrRotateViewer, revoke, touchOpened, touchViewer).
  - `src/auth/store-guard.ts`: STORE_ACCESS rows for the new methods (reads `read`; touches `control`).
  - `src/accountants/grants.ts`: the view throttle moves to `src/access/view-touch.ts`.
  - `src/auth/billing-gate.ts` (PERSON_LEVEL_GATE classes), `src/app.ts` (registration, the flag table, organization-independent set, API_VERSION), `src/app-shell.ts`, `src/config.ts` (`SHARE_LINKS`, `SHARE_LINKS_PER_PROFILE_MAX`), `src/errors.ts` (`SHARE_LINK_REFUSED`), `src/schemas.ts`.
  - OpenAPI (`npm run openapi:generate`) and `npm run hosted:types`.
- **Docs:** ADR-246 in `.claude/DECISIONS.md`; this brief as `.claude/designs/MUT-560-share-links.md` and its test plan as `.claude/designs/MUT-560-share-links-tests.md`, committed on the build branch.

## Tests (TDD; `npm --prefix server test`, plus `test:db` for the Prisma repository)
1. **Period (pure):** each period from fixed days, including month-end clamps (Mar 31, leap Feb 29), timezone day boundaries (UTC 22:30 vs Asia/Jerusalem), whole profile, and the exclusive `occurredBefore = to + 1`.
2. **Period boundaries end to end:** entries on `from − 1`, `from`, `to`, `to + 1` and a future date: only `from` and `to` show; an entry backdated into the range later shows; one edited out disappears.
3. **Create:** each period × expiry; PIN 3, 9 and non-digit → 422; Arabic-Indic PIN accepted and verified as ASCII; 11th live link → 409; rate limit; non-owner 403; unseen profile 404; personal profile allowed; LOCKED owner → 402 on create, list and revoke still 200.
4. **Token and PIN at rest:** the DB row has neither the token nor the PIN; `tokenDigest` is the HMAC; `pinHash` is argon2id; OpenAPI has no `{token}` path parameter and no GET carries a token.
5. **Unlock:** correct PIN → viewer token; wrong PIN → `attemptsLeft` 4…1; 5th wrong → LOCKED; correct PIN after lock → LOCKED; 5 parallel wrong PINs → exactly 5 counted; existing viewers 404 after lock; owner list shows `locked`.
6. **Viewers:** 3 viewers ok; 4th → VIEWER_LIMIT; a returning viewer (same or expired viewerToken) keeps its slot and gets a rotated token; the old token stops working; 2 parallel new viewers at count 2 → one wins; 8-hour access end → 401 SHARE_VIEW_EXPIRED, re-unlock ok; access never outlives `link.expiresAt`.
7. **Uniform 404:** unknown token, expired (fake clock), revoked, deleted profile, owner closing, flag off: identical status and body on check, unlock and every view route.
8. **Reads:** entries only from the link's profile (a second profile's rows never appear); projection drops `profileId` and `createdByUserId`; summary per currency equals the feed's sums; receipts of an in-range expense return signed URLs; an out-of-range, deleted or other-profile expense → 404.
9. **Read-only guard:** under a link view, a repository write throws 403; the touches still succeed; no route under `/v1/share-links/` is reachable with a non-POST method.
10. **Throttles and audit:** `lastOpenedAt` and viewer `lastViewedAt` at most hourly; audit rows created, revoked, unlocked (new viewer only) and locked, none with the token, PIN or an IP.
11. **Rate limits:** per-IP on check and unlock (429 with Retry-After); per-viewer on views.
12. **Closure and purge:** owner purge deletes links and viewers; creator deletion keeps the link with a null creator; purge plan not blocked.
13. **Headers:** `X-Robots-Tag: noindex` and `Cache-Control: no-store` on every link route.
14. **Isolation from the main API:** a viewer token sent as a Bearer or cookie on any `/v1` route is refused (401), and the accountant route matrix (MUT-559) is unchanged.

Checks before merge, through the heavy queue: `typecheck`, `lint`, `openapi:check`, `test`, `test:db`.

## Scale and cost
- Check and unlock: one indexed lookup by digest, one argon2 verify (only on unlock, bounded by 5 wrong per link and the IP limiter).
- Views: one viewer lookup, one link + org read, one owner read for closure, then the existing indexed feed query (`order=occurredOn`, bounded both ends). The summary pages the range at 200 rows a page, as `/v1/summaries/expenses` does; a whole-profile summary is the one unbounded walk, acceptable at today's profile sizes (≤ a few thousand rows) and noted for TD-291's trigger.
- Writes: touches at most hourly; no cron (expiry is computed). Expired rows stay; volume is tiny (≤10 live per profile).
- The in-process limiters are per instance (as for sign-in); the per-link lockout lives in the database, so it holds across instances.
- No new infrastructure.

## Out of scope (other tickets)
- The link page and its states (MUT-562); owner screens (MUT-561, MUT-563).
- Download of the period (MUT-314): it calls `shareLinkAccess` and gets the clamped range.
- Emailing the owner on lock or first open; re-showing a link after creation (only its hash is kept); editing a link (revoke and create).
- Malafat documents (`attachments` domain) on a link: receipts here are expense receipts only.

## Decisions (auto)
- **A1 Shape B** (dedicated link API) over shape A: the period rule lives in one function instead of 33 handlers, and new routes stay closed to links by construction.
- **A2 Viewer auth = a body-borne viewer token, 8 h, capped at link expiry**, no cookie: keeps the token out of URLs and headers (D3), needs no CSRF handling on a public route, and a short life limits a left-open browser.
- **A3 Returning viewers present their old viewer token at unlock** (PIN still required after 8 h): satisfies "re-opening doesn't count again" without a PIN-free long-lived bearer.
- **A4 PIN hash = argon2id over an HMAC-peppered input**, reusing `PasswordHasher` and `sessionDigest`: a tiny PIN space needs the pepper so a DB leak alone can't crack it.
- **A5 Lockout = 5 wrong PINs over the link's life, never reset; atomic SQL increment**: simplest rule that can't be raced or reset by an attacker.
- **A6 A lock also ends existing viewers' access**: one "usable" predicate; the owner re-shares.
- **A7 Per-IP limiter (the sign-in IP limiter, own key) on check+unlock; per-viewer limiter on views**: mirrors MUT-559's public routes.
- **A8 Period = rolling calendar months ending on the creation day (profile timezone), frozen at creation; whole profile = everything up to the creation day**: literal reading of "last N months"; no future-dated leakage.
- **A9 Viewer cap counted from viewer rows under a link-row lock** (no counter column): one owner of the state.
- **A10 Uniform 404 also covers locked-for-viewers, deleted profile, owner closing and flag off**; locked is shown as LOCKED only at check/unlock (the page has a locked state).
- **A11 Sibling flag `SHARE_LINKS`**, sharing one 404 table with ACCOUNTANT_ACCESS: a public, unauthenticated surface should be switchable on its own in an incident.
- **A12 Cap 10 live links per profile; 20 creates per owner per hour**: stops spam, far above real use.
- **A13 Owner's plan lapse: links keep working; LOCKED owner can't create**: consistent with the epic and MUT-559's gate classes.
- **A14 Receipts = expense receipts of in-range entries, as short-lived signed URLs**: reuses the existing download path; Malafat documents stay out.
- **A15 Every owner of the profile sees and revokes every link**; links survive the creator leaving: the remaining owner stays in control.
- **A16 Entries shown = the `/v1/entries` feed kinds** (expenses, received, Owed, conversions), projected without internal ids.
- **A17 Telemetry from the clients**, audit rows on the server: no server PostHog client exists.
- **A18 Server folds Arabic-Indic digits in the PIN**: Arabic-first input.
- **A19 Link URL shown once** (only its hash is stored): the safer default; see the user questions below.

## Review notes (plan-eng-review, auto-decided)

**Architecture**
- Design-twice: shape A (selectProfile mode + period clamps in 33 GETs) vs shape B (one access function + 6 routes). B chosen (A1).
- Red flags: (2) information leakage — the period rule is only in `period.ts` + `shareLinkAccess`; (5) split ownership — avoided by counting viewer rows (A9); (6) two ways to do one task — the view throttle is shared with grants, the flag middleware is one table; (8) hand-synced list — the flag table is derived from each route file's exported endpoint set, as `ACCOUNTANT_ENDPOINTS` is. None remain.
- Failure modes: argon2 CPU under PIN spraying → IP limiter + 5-per-link lock; two instances → the DB lock holds, limiters per instance (accepted, as sign-in); storage down → 503 on receipts, entries still work; owner closes their account mid-share → 404 at once; lost viewer token → PIN again, slot spent (owner re-shares at 3).
- Security: tokens only in bodies and the fragment; no profile data in any URL; `noindex` + `no-store` global; anonymous rows carry no internal ids.

**Code quality**
- Reuses `generateSetupToken`, `sessionDigest`, `PasswordHasher`, `requestClientIp`, the IP limiter, `accountantStoreGuard`, `unguarded`, `entries.list`, `serializeEntry`, `summarizeExpenses`, `expenseReceipts.listByExpense`, `storage.signDownload`, `todayFor`, `ownsProfile`. The only extraction is the view throttle.

**Tests**
- Every branch maps to tests 1–14; 2, 5, 6 and 7 are the regression net. [→E2E] create → share → PIN → read → revoke belongs to MUT-561/562 (Playwright release-QA).

**Performance**
- Indexed lookups only; no N+1 (receipt counts batched as in `/v1/entries`); touches throttled. The whole-profile summary is the one unbounded read (noted).

**Outside voice:** unavailable (codex not installed), as for MUT-559.

VERDICT: ENG CLEARED (auto-decided) — ready for /eng-build MUT-560.

## Questions for Basel (product/UX, not decided here)
1. **"Last N months":** rolling (Oct 6 – Nov 6) as planned, or whole calendar months (e.g. "last 3 months" = Aug 1 – Oct 31, the closed quarter accountants usually want), or the current month included?
2. **Link shown once:** the owner can't see the URL again after creating it. OK, or should the owner be able to re-copy it (means storing the token encrypted)?
3. **Lock policy:** after 5 wrong PINs the link is dead for everyone, including viewers already in. OK, or keep existing viewers in?
4. **PIN again every 8 hours** for a returning viewer: OK, or should a viewer stay in for the link's whole life?
5. **Telemetry on the public page:** `share_link_opened` is sent from a visitor with no account. Ask the visitor for consent (the portal's usual prompt), or count it without asking as an anonymous, consent-free event?
6. **Notify the owner** when a link locks or is first opened (email/push)? Not planned.
7. **Profile name before the PIN:** the plan shows nothing before the PIN (AC). Should the PIN screen at least say whose data it is ("Basel shared a profile with you")?

## Business / product impact
- Owners who send their books once a quarter can share a period with an accountant in one step, with no account on either side — the low-friction half of the accountant epic (MUT-558).
- Unblocks MUT-561/562/563 and gives MUT-314's download its access check; the server can ship dark behind `SHARE_LINKS`.
- Risk is contained: a public surface of six POST routes, PIN lockout, 3 viewers, short viewer sessions and a uniform 404, with the data-layer read-only guard underneath.

## As built (2026-11-06, ADR-246)

Where the build follows the code rather than the plan's letter:

- **Period (B1).** `share-links/period.ts`: `resolveShareLinkPeriod` (pure), `shareLinkRangeAt` (the profile's calendar
  day at creation), `feedBoundsOf` (`occurredBefore = to + 1`, exclusive) and `isInRange`. Stored as `periodFrom`
  (null for WHOLE_PROFILE) and `periodTo`, `VARCHAR(10)` like every money date in the schema.
- **Read-only guard.** `accountantStoreGuard` refuses the entries feed (`entries.list` is classed `sessionOnly`: it
  reads across a person's memberships), so the view routes run under a sibling, `shareLinkStoreGuard`: reads pass, plus
  a named list (`SHARE_LINK_SESSION_READS`: `entries.list`, `entries.settledOwedIds`), nothing else; a write answers 403
  READ_ONLY_PROFILE, reason SHARE_LINK_READ_ONLY. Both guards are one `readOnlyStoreGuard` underneath.
- **Store classes.** The owner's methods (`create`, `listLiveByOrganization`, `revoke`) are `sessionOnly`; the link's
  own lookups, PIN count, viewers and stamps are `operator` (refused under every guard), and run on the base store the
  routes are handed as `linkStore`, as authenticate() reads sessions. No new `unguarded()` call site (the escape-hatch
  test stays as it was). `countLive` was not needed: `create` counts under the profile lock, and
  `findByTokenDigest` / `listLiveByOrganization` answer each link's viewer count from its rows.
- **Same origin.** The five visitor routes answer 403 CROSS_SITE_REQUEST unless called from the portal (as MUT-559's
  public invite routes); the link page is the portal's (MUT-562).
- **Unlock.** A PIN that isn't 4–8 digits (after folding) counts as a wrong one (no 422 at unlock). The viewer cap is
  checked before the PIN, so a 4th device's guesses never count toward the lock. Unlock answers `ownerName` too (B4).
  A link locked or revoked between the read and the viewer insert answers LOCKED or the uniform 404.
- **Summary.** Totals are formatted amounts (`total`, as `/v1/summaries/expenses`), not `totalMinor`; reversed
  payments are left out of `received`.
- **Receipts.** `POST /v1/share-links/expense-receipts` answers `{ items: [...] }` (the repo's list shape) rather than a
  bare array.
- **Dark launch.** One table in `app.ts` (`darkLaunches`: each route file's exported endpoint set, its switch and its
  404); SHARE_LINKS off answers the same uniform 404 (`SHARE_LINK_UNAVAILABLE`) as an unusable link.
- **Owner gate.** `ownedProfileOf` (personal-profile.ts) is the owner check MUT-559's routes had inline, now shared.
- **Route registration.** The share-link routes are registered last, so the published components keep their order.

## QA scenarios

Server only: the user-visible flows (create → share → PIN → read → revoke) are the portal and phone stories
MUT-561..563, which carry their release-QA specs. The server's proof is the vitest suites in
`MUT-560-share-links-tests.md` and TEST_PLAN.md (MUT-560).
