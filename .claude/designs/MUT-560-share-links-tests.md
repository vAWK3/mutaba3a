# MUT-560 — share links: test plan

TDD, server only. `npm --prefix server test`; the Prisma store contract and the purge catalog under `test:db`. The
numbered groups are the plan's; each names where it lives.

| # | Group | Where |
|---|---|---|
| 1 | Period, pure: each period from fixed days, the month-end and leap-year ends, the year boundary, the profile's day vs UTC (00:30 on the 1st in Jerusalem), whole profile, the exclusive `occurredBefore = to + 1` | `share-links/__tests__/period.test.ts` |
| 2 | Period end to end: entries on `from − 1`, `from`, `to`, `to + 1` and a future date (only `from` and `to` show); whole profile never shows tomorrow; an entry edited into the range shows, one edited out disappears; the creation day is the profile's | `__tests__/routes-share-links.test.ts` "1 + 2" |
| 3 | Create: every period × expiry; PIN 3, 9, non-digit, blank → 422 PIN_FORMAT; bad expiry or period → 422; Arabic-Indic and Eastern Arabic-Indic PINs; the 11th live link → 409 SHARE_LINK_LIMIT; rate limit; stranger 404, firm member 403 NOT_OWNER, a co-owner sees and revokes; personal profile; LOCKED owner 402 on create, list and revoke still work and the link keeps working | routes "3", "the lapse gate" |
| 4 | Token and PIN at rest: HMAC and argon2id only; the viewer token too; the contract has no token in a path or query and every link route is POST and public | routes "4" |
| 5 | Unlock: correct PIN → viewer token and names (check shows none); `attemptsLeft` 4…1; the 5th → LOCKED, the right PIN after → LOCKED, check → LOCKED, the owner sees `locked`; 7 parallel wrong PINs count exactly 5; a lock ends viewers already in; a malformed PIN counts | routes "5"; store contract |
| 6 | Viewers: 3 open, a 4th → VIEWER_LIMIT (before the PIN: its guesses don't count); a returning viewer keeps its slot with a rotated token (old one stops); parallel unlocks at 2 make exactly one more; 8 h → 401 SHARE_VIEW_EXPIRED, re-unlock keeps the slot; access never outlives the link | routes "6"; store contract (memory + Prisma) |
| 7 | Uniform 404 on check, unlock, entries, summary and receipts for an unknown token, an expired link, a revoked link, the owner closing their account and the switch off; a profile gone under a live link | routes "7"; `share-links/__tests__/access.test.ts` |
| 8 | Reads: only the link's profile, projected without `profileId` / `createdByUserId`; money-date paging with a cursor; the summary per currency (reversed and out-of-range left out); receipts of an in-range expense as signed URLs, out-of-range / deleted / another profile's → 404; no bucket → 503, entries still work | routes "8" |
| 9 | Read-only: `shareLinkStoreGuard` over every STORE_ACCESS method; the named feed reads are real `sessionOnly` reads; the link's own methods are refused under it; no non-POST method reaches `/v1/share-links/*` | `auth/__tests__/share-link-store-guard.test.ts`; routes "9" |
| 10 | Throttles and audit: `lastOpenedAt` at unlock and at most hourly, viewer `lastViewedAt`; audit created, unlocked (new viewers only, `viewerNumber`), locked, revoked, never the token, PIN or an IP | routes "10"; `access/__tests__/view-touch.test.ts` |
| 11 | Rate limits: check + unlock share the per-IP budget (429 + Retry-After); views per viewer | routes "11" |
| 12 | Closure and purge: the owner's purge takes links and viewers and is never blocked; a purged co-owner's link stays with no creator | routes "12"; store contract; `prisma-account-purge-catalog.test.ts` |
| 13 | Headers: `X-Robots-Tag: noindex`, `Cache-Control: no-store` on link routes | routes "13" |
| 14 | Isolation: a viewer token as Bearer or cookie on `/v1` → 401; same origin only; the MUT-559 accountant matrix unchanged | routes "14"; `accountant-route-matrix.test.ts` |

Also updated: `routes.test.ts` (API 1.101.0-mut560), `route-security.test.ts` (owner routes session-only, visitor routes
public), `billing-gate-routes.test.ts` (classification), `auth/__tests__/store-guard.test.ts` (operator list).

Review follow-up: `routes-share-links-review.test.ts` (stale re-unlock, receipt URL clamps, names not ids with a
no-UUID scan, per-IP view budget, summary budget, co-owner closing, foreign cursor), three more store-contract cases
(stale, parallel re-unlock, right PIN vs 5th wrong) and `routes-share-links-prisma.test.ts` (key flows on Postgres).

[→E2E] create → share → PIN → read → revoke belongs to MUT-561/562 (Playwright release-QA).
