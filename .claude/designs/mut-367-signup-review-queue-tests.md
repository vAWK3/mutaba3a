# MUT-367 test plan: the business-email screen and the signup review queue

This plan goes with `.claude/designs/mut-367-signup-review-queue.md`. All the tests are server-side vitest. The Postgres rows run under `test:db`. No real DNS or RDAP lookup runs in any test: the fixture checker answers, or a fake resolver and a fake fetch do.

| AC | Tests |
|---|---|
| A1 refuse disposable/no-mail; business → ACTIVE; gmail → review; 12-day → `rdap-age-12d` | `routes-signup-review.test.ts` S1–S5; `screen.test.ts` (rules, fixture outcomes, lists before the checker); `dns-checker.test.ts` (MX/null MX/A/AAAA/RDAP, errno, budget); `self-service.test.ts` (`signupAccountOutcome`) |
| A2 right password → 403; wrong → 401 identical to unknown (timing) | S6 (cookie + device, no session, no failure); S7 (same status, body and message; exactly one hash verify on each path; both wait on it); S8 locked → 401; S9 recovery |
| A3 approve mails and lets them in; decline removes, mails, address reusable | S10–S13, D11; `store-contract-signup-reviews.ts` (memory + Prisma: decline after a used recovery link, `not_empty`, concurrent decisions); `users-cli.test.ts` |
| A4 digest at most once an hour while pending | `review-digest.test.ts`; S4/S5 (one digest for two signups in one hour) |
| A5 reproducible update script; the lists parse and have no duplicates | `email-domains-update.test.ts`; `lists.test.ts` |
| A6 gate | `npm --prefix server run typecheck`, `lint`, `openapi:check`, `test`, `test:db` (an isolated database, `mutaba3a_test_mut367`); `migration-mut367.test.ts` |

Written first (Red), in this order: lists, screen, dns-checker and update script, then the outcome and contract, then the routes.
