# MUT-735 test plan: usage metering

Brief: `mut-735-usage-metering.md`. TDD: each slice's tests are written first and fail, then the code makes them pass.
Run under Node 22. Server: `npm --prefix server test -- usage` while iterating, `test:db` for the Postgres contract. All heavy runs go through `~/Work/tools/heavy-gate/heavy` (`--light` for targeted files, `--maxWorkers=3`).

## Unit (pure, `server/src/usage/__tests__/`)

| File | Cases |
|---|---|
| `month.test.ts` | `usageMonthOf` (built on `todayIn`): 2026-12-31 21:59 UTC → 2026-12, 22:00 UTC → 2027-01 (winter, UTC+2); 2026-07-31 20:59/21:00 UTC (summer, UTC+3); `resetsOn('2026-12')` = 2027-01-01; a server in another TZ gets the same answer. |
| `kinds.test.ts` | `meterOf`: 305/320 → DOCUMENTS; 400, 330 and PAYMENT_REQUEST → none; every SCAN detail → SCANS; other kinds → none. `DOOR_OF` per principal (cookie, device session, agent, API key, operator, job). The `detail` vocabulary rejects anything not listed (no free text). |
| `subject.test.ts` | creator-owned profile → `user:<creator>`; co-owner acting → still the creator; operator firm with no owner → `org:<id>`; personal profile → its owner. |
| `caps.test.ts` | `capOf` per plan × meter from `PLAN_LIMITS` (Solo 50/100, Business 250/500, Firm 1000/2000); null for malafat, none, freelancer (until MUT-707). `usageView` shape for `/v1/billing`, limits null where uncapped. |
| `route-buckets.test.ts` | bucket edges (5, 5.0001, 10000, 10001 ms); `p95Of` on uniform, skewed and single-bucket data; empty → null. |

## Repository contract (memory and Postgres, `repositories/__tests__/usage.contract.ts` run by both suites)

- `record` writes an event and increments the counter; the same `(kind, entityKey)` twice writes once and counts once.
- Conditional increment with a cap: at `cap − 1` succeeds; at `cap` returns `cap_reached` and writes no event; with `cap: null` always increments.
- **Race (Postgres only):** two `record` calls at `cap − 1` under `Promise.allSettled` → exactly one success, one `cap_reached`; counter = cap. Repeat 5× (the pattern's own lesson: it failed 2 of 3 runs without the lock).
- A rolled-back outer transaction leaves neither the event nor the counter.
- `countersFor(subject, months)` returns zeros for months with no row.
- `rollup({ month, groupBy })` answers in one query (assert the query count on Prisma's `$on('query')`), grouped by plan and kind.
- `people({ filter: 'near' })` = counters ≥ 80% of the plan's cap; `over`; `capped` (= cap on a hard-cap plan); keyset pagination stable across pages.
- `routeDaily` upsert adds counts and the 12 bucket columns.
- `prune(before)` deletes events older than 13 months, counters older than 25, route rows older than 90 days; nothing younger.
- Account purge deletes the person's events and counters.

## Integration (routes, memory store, `server/src/__tests__/`)

- Issue a tax invoice → one `DOCUMENT_ISSUED` event (detail TAX_INVOICE, door PORTAL), DOCUMENTS = 1. Replay with the same Idempotency-Key → still 1.
- Issue a credit note, a receipt, a payment request → events recorded, DOCUMENTS unchanged.
- `issueTx` ordering: two concurrent same-key requests at `cap − 1` → one document, one replay (P2002), never `cap_reached`.
- Issue as a co-owner → the creator's counter moves; event's actor is the co-owner.
- Issue all (MUT-660) of 3 → 3 events, counter 3.
- Start a library receipt upload → nothing counted; complete it → SCAN event, SCANS = 1; complete again → still 1; a per-expense upload completed → SCANS = 2; a started-but-abandoned upload → never counted.
- External invoice read → event, no counter.
- A Malafat API key completing a receipt → event with plan `malafat`, counter unchanged, never refused.
- Signed-out local app (`createLocalApp`, `plans: false`): routes work, nothing recorded, no flush scheduled.
- Idempotency: a 409 `PLAN_LIMIT` releases the key (a later same-key request runs again).
- `GET /v1/billing` → `usage` with month, resetsOn, meters and limits; for a Malafat-only person limits are null.
- Route metering (in the `app.ts` access log): a 200, a 404 on an unmatched path (one `UNMATCHED` key), a thrown 402 and a thrown 409 (final status after `onError`), a 500 → right status class; an `app.all` route keyed by its `routePath`; a request finding the last flush > 60 s old starts one (fire and forget) and a flush that throws is logged while the request still succeeds; SIGTERM flushes; `/health` not counted.
- Benchmark (`route-meter.bench.test.ts`, skipped in CI unless `BENCH=1`): 10k middleware passes, p99 < 0.2 ms.
- Operator endpoints: non-operator → 403; operator → data; CSV export without fresh step-up → 403 `STEP_UP_REQUIRED`, with it → `text/csv` and BOM. `PERSON_LEVEL_GATE` classification test still passes (every new person-level endpoint listed).
- Store guard: `usage.rollup` from a session principal → refused (operator-only).

## Portal (Vitest + RTL, `src/hosted/pages/operator/__tests__/`)

- `OperatorUsagePage`: renders per-plan totals, near/over/capped lists, month switch refetches, empty month says so, ar and en strings, RTL, numbers in `<bdi>`.
- `OperatorUsageSection`: six months, per profile; limit null shows "no cap".
- CSV button runs through `useOperatorRun` (step-up), shows the error banner on refusal.
- `operatorUsageQueries` keys include the month.
- i18n parity test (ar/en keys) passes.

## Release-QA (web)

Features in `qa/features/portal-selfservice/operator.yaml`: `operator.usage-overview`, `operator.usage-account`, `operator.usage-routes`, `operator.usage-csv`. Specs in `qa/specs/portal-selfservice/operator.spec.ts`, tagged `@portal-selfservice.operator.<id>`, each action in `step(...)`. The seed adds a Starter person at 3/3 documents and a Solo person at 41/50 (82%). Each spec passes once with `release-qa run --attach --only <id>`; `release-qa lint` clean with the new paths mapped.

## Regression

- Full server suite, `openapi:check`, server typecheck and lint.
- Portal: `npm run lint`, `typecheck`, `test:run`, `build` (Node 22).
- Issuing and receipts suites unchanged in behaviour (metering never refuses in S1; caps arrive with MUT-731).
