# MUT-575 — client books server: test plan

TDD, server only. `npm --prefix server test`; Prisma store contracts and the migration under `test:db`; the events
contract from the root (`npx vitest run scripts/__tests__/analytics-taxonomy.test.ts`).

| # | Test | Where |
|---|---|---|
| 1 | `clientRows`: active; revoked → ended/revoked at `revokedAt`; owner closing → ended/closed; LEFT and dismissed never listed; accepted re-invite hides older REVOKED; two REVOKED → latest; pending re-invite keeps the ended row; purged profile → no row; order | `accountants/__tests__/client-rows.test.ts` |
| 2 | `/v1/me.clients` extended shape, ended rows, flag off → absent; accept answers `status: active` | `__tests__/routes-client-books.test.ts` "2" |
| 3 | `GET /v1/clients`: stats at 22:30 UTC on 31 Oct (UTC vs Jerusalem); deleted/undone not counted; ended → null stats; non-accountant `[]`; flag off 404 | routes "3" |
| 4 | Stats cost: 10 clients → exactly 2 queries (fake Prisma), and one `clientActivity` call, no `entries.list`, on the route | `repositories/__tests__/store-prisma-client-activity.test.ts`; routes "3" |
| 5 | DELETE: ACTIVE → LEFT + audit; ended → dismissed, no audit, gone from both lists and stays gone; two REVOKED both dismissed; closing owner + ACTIVE → LEFT; unknown / another's → 404 | routes "5"; store contract |
| 6 | Closing owner → 404 + ended/closed; Keep my account → active and 200; purge → gone; share links unchanged through `ownerIsClosing` | routes "6"; `routes-share-links*.test.ts` |
| 7 | `/v1/profile-entries` as accountant: only the client's rows; each kind and combinations; from/before; cursor paging; limit 101 → 422; unshared → 404; revoked mid-session → 404; non-GET refused | routes "7" |
| 8 | Never mixes: the accountant's `/v1/entries` (no header, with the header, `profileId` = client → 404) and the verdict | routes "8"; MUT-559 isolation test |
| 9 | Owner/member: page-for-page parity with `/v1/entries?profileId=X&order=occurredOn`; LOCKED → 402; no installment posted | routes "9" |
| 10 | Derived allowlist admits `GET /v1/profile-entries` (matrix pin); `PROFILE_FEED_READS` passes under both guards, writes throw | `accountant-route-matrix.test.ts`; `auth/__tests__/{accountant,share-link}-store-guard.test.ts` |
| 11 | `disposition=inline` signs inline; default/attachment unchanged; accountant 200; bad value 422 | routes "11" |
| 12 | Link filters: kinds narrow (owed → 422); from/before clamped, never widened; default unchanged | `routes-share-links-filters.test.ts` |
| 13 | AASA: 3 existing paths + `/accountant-invite*` in order; `/share`, `/client-books`, `/setup`, `/sign-in` unclaimed | `well-known-routes.test.ts` |
| 14 | Events 2.7.0: rules pass, emitters, each event's properties, pinned sha | `scripts/__tests__/analytics-taxonomy.test.ts` |
| 15 | Migration on a MUT-560 database: grants kept, `dismissedAt` null, schema matches | `repositories/__tests__/migration-mut575.test.ts` (`test:db`) |

Also: store contracts for `listForAccountant`, `dismiss` and `clientActivity` (memory and Prisma).
[→E2E] invite → read → revoke → faded → remove: MUT-562 (Playwright) and MUT-564 (`ios.clients.read-only`).
