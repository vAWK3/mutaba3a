# MUT-735: Usage metering on every route, with usage reports in the operator console

Status: **planned, not built** (2026-11-25). Epic MUT-701. Blocks MUT-731 (Starter caps) and MUT-733 (paid caps and the gift). Relates MUT-704, MUT-581, MUT-732 (privacy text).
Test plan: `mut-735-usage-metering-tests.md`. Sister plan: `mut-731-736-starter-plan.md`.

```
Tracker: Jira · barmajiyat.atlassian.net · MUT via atlassian-barmajiyat · Backlog/Idea = not committed · this skill may set Planned · finished → In Review (Basel moves to Done)
```

## 0. Neighbourhood

| Ticket | Status | What it means for this plan |
|---|---|---|
| MUT-702 Part A | merged (d4824f6e, ADR-275) | `plans.ts` holds `PLAN_LIMITS`, `RANK`, `currentPlanOf`. Nothing reads the limits yet. |
| MUT-702 Part B | In Progress, held for MUT-700 | Per-plan prices and Checkout. Not needed for metering. |
| MUT-704 | Backlog | Its meters and "counted across the payer's profiles, Jerusalem month" rules come from here. Its soft-cap and move-up rules are replaced by MUT-733. |
| MUT-731 / MUT-733 | Backlog | Read caps from this ledger. MUT-733's gift is a **hook only** here (gift details are still open). |
| MUT-458 (operator console) | done | The Usage tab joins Signups, Accounts and Firms (`OperatorLayout.tsx` + `SectionTabs`). |
| MUT-581 | Backlog | Partner funnel report: reads the same ledger later. Nothing for it in this ticket. |
| MUT-732 | Backlog | The privacy text gains the retention periods set here. |

**No blocker is open.** Metering is provider-neutral and reads the plan through `currentPlanOf` (Part A).

## 1. Problem and acceptance criteria

Nothing is metered today. `PLAN_LIMITS` is read nowhere. Nobody can answer "how many invoices did X issue this month", "which features does Business use" or "who on Starter hits the caps". The caps of MUT-731/733 need one counter that cannot be raced past.

Ticket ACs, each mapped to proof in §9:
1. A ledger table and its write path, idempotent per action; unit-tested, the contract tested on Postgres.
2. Monthly rollups per person, profile and kind, read in one indexed query (index documented).
3. Route metering middleware: under 1 ms overhead, never blocks a request (fire and forget, logged error).
4. Operator › Usage page with the four views, ar + en, plus a QA flow.
5. `GET /v1/billing` returns this month's usage against the limits.
6. An ADR for the metering model.

## 2. Design

### 2.1 Three stores, each for one job

```
                       action (issue, scan, export, MCP call, mail, …)
                                   │
            ┌──────────────────────┴──────────────────────┐
            ▼ same transaction as the action               ▼ after the response, buffered
   usage_events  (one row per action,                route_usage_daily (aggregate per day ×
   idempotent on (kind, entityKey))                  route × plan × status class, duration
            │ same tx                                histogram; no person)
            ▼
   usage_counters (payer × month × meter): the counter caps read in O(1)
```

**1. `usage_events`: the ledger.** One row per billable or interesting action.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `occurredAt` | timestamptz | |
| `month` | char(7) `YYYY-MM` | the **Asia/Jerusalem** calendar month (MUT-704), computed once in code (`usageMonthOf`) |
| `subjectKey` | text | who pays: `user:<profileOwnerOf(org)>`; `org:<id>` for an operator-provisioned profile with no owner |
| `actorUserId` | uuid null | who did it (a co-owner's issue counts to the creator's meter; the actor is kept for reports) |
| `organizationId` | uuid null | null for person-level actions (mails, MCP connect) |
| `kind` | varchar(40) | see 2.2; a closed vocabulary checked in code (no Postgres enum, so a new kind needs no `ALTER TYPE`) |
| `detail` | text null | a closed vocabulary only: the doc type (`TAX_INVOICE`), the scan door (`LIBRARY`), the export kind. Never an amount, a name or free text. |
| `plan` | text | the payer's plan at the time (`starter|solo|business|firm|freelancer|malafat|none`) |
| `door` | varchar(16) | PORTAL, PHONE, MCP, MALAFAT, OPERATOR, JOB (from the principal: cookie session, device session, agent, API key, operator, job) |
| `entityKey` | text | what makes it idempotent: the issued document id, the receipt id, the export ticket, the mail's idempotency key |

Unique `(kind, entityKey)`. Index `(subjectKey, month, kind)` for the per-person rollup; index `(month, kind)` for plan totals.

**2. `usage_counters`: the hot counter.** `(subjectKey, month, meter)` primary key, `count int`, `updatedAt`, plus **`graceUntil timestamptz null` as MUT-733's hook** (nothing writes it in this ticket). Meters are the capped ones: `DOCUMENTS`, `SCANS`. A counter row is written in the **same transaction** as its event, by a conditional upsert:

```sql
INSERT INTO usage_counters (subject_key, month, meter, count) VALUES ($1,$2,$3,1)
ON CONFLICT (subject_key, month, meter) DO UPDATE SET count = usage_counters.count + 1
  WHERE $cap IS NULL OR usage_counters.count < $cap   -- the hard cap, race-free
RETURNING count;
```

No row back means the cap is reached: the action's transaction rolls back and the route answers `PLAN_LIMIT` (MUT-731 defines the error; this ticket only returns `{ kind: 'cap_reached', used, cap }`). Two parallel issues at `cap − 1`: one wins, one is refused (Postgres re-checks the WHERE on the locked row). This is the "Serialize writes to one aggregate on its row lock" pattern (PATTERNS.md) with the row lock implicit in the upsert. Without a cap (`$cap` null) it is a plain increment.

Why a counter and not `COUNT(*)` over events: the cap check runs on every issue and every scan; a counter is one row, and its conditional write is the only way to make a hard cap correct under concurrency without an advisory lock.

**3. `route_usage_daily`: commerciality, no person.** `(day, routeKey, plan, statusClass)` key, `count`, `durationMsSum`, twelve integer bucket columns `b0…b11` (≤5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, >10000 ms). `routeKey` is the Hono route template (`endpointKey`, e.g. `POST /v1/issued-documents`), never the raw path (no ids). p95 is read from the buckets (upper bound of the bucket where the cumulative share crosses 95%), good to a bucket's width, which is enough for an operator view.

### 2.2 What is metered (`UsageKind`)

| Kind | Where it is written | Counter meter | Counts toward a cap |
|---|---|---|---|
| `DOCUMENT_ISSUED` (`detail` = doc type) | `store.issuing.issue` transaction (`issueTx`), only when `created` | `DOCUMENTS` for the counted types (§2.4) | yes |
| `SCAN` (`detail` = `LIBRARY`, `EXPENSE`) | the upload's **complete**: the UPDATE that marks the receipt READY in `completeLibraryReceipt` / `completeOnExpense` (`receipts-compose.ts`), keyed by the receipt id, so a repeated complete counts once; an unlocked pre-check at start refuses early (eng review #11) | `SCANS` | yes |
| `EXTERNAL_INVOICE_READ` | `routes/external-invoices.ts` read (no store row: written after the OCR answers) | none | no (it attaches an invoice issued elsewhere) |
| `ALLOCATION_REQUESTED` (`detail` = `AUTOMATIC`/`MANUAL`) | the issue transaction, when an allocation number was set | none | no |
| `PROFILE_CREATED`, `PARTNER_ADDED`, `PARTNER_REMOVED` | the profile and co-owner writes | none | no: business and partner caps read **live** counts (§2.5) |
| `RECORDS_EXPORTED`, `PERIOD_DOWNLOAD`, `UNIFORM_FILE` | their routes | none | no |
| `MCP_TOOL_CALL` (`detail` = tool name) | `routes/mcp.ts` after a tool returns | none | no |
| `MAIL_SENT` (`detail` = the mail's template id) | `email/mailer.ts` after a send is accepted | none | no |

The scan is counted when the upload **completes** (eng review #11): the conditional upsert is as race-free there as anywhere; an abandoned or failed upload uses up nothing; the per-expense start has no Idempotency-Key, so counting at start would double-count retries; and complete is where the reading (the OCR cost) is decided. The start does an unlocked pre-check (`used >= cap` → refuse) so a person at 12/12 is told before uploading. Two uploads racing at 11/12 both start, and the second is refused at complete with the bytes discarded: acceptable and stated in the ADR.

**Never metered against a cap, never refused (eng review #7):** a request by a Malafat API key, a write whose writer of record is Malafat, or a profile whose entitlement source is MALAFAT (ADR-160 decision 4). Their events are still recorded with plan `malafat` and `cap: null`.

The writes for non-capped kinds are best effort: written in the action's transaction when one exists (issue, scan, profile), else after the response through the same buffered writer as route usage. A failed best-effort write is logged and reported to Sentry, never surfaced.

### 2.3 Where the code lives (new module `server/src/usage/`)

| File | Pure? | What |
|---|---|---|
| `usage/kinds.ts` | pure | `UsageKind`, `UsageMeter`, `DOOR_OF(principal)`, `COUNTED_DOC_TYPES`, `meterOf(kind, detail)` |
| `usage/month.ts` | pure | `usageMonthOf(at)` built on `todayIn('Asia/Jerusalem', now)` (`agreements/compose.ts`), `monthBounds`, `resetsOn(month)` (the 1st of next month) |
| `usage/subject.ts` | pure | `subjectKeyOf(organization)` from `profileOwnerOf` |
| `usage/caps.ts` | pure | `capOf(plan, meter)` from `PLAN_LIMITS` (+ Starter's row from MUT-731), `usageView(counters, plan)` for `/v1/billing` |
| `usage/route-buckets.ts` | pure | bucket index for a duration, `p95Of(buckets)` |
| `usage/route-meter.ts` | I/O | the in-memory aggregator the `app.ts` access log feeds; due-driven `flush()` (≥60 s since the last, started from a live request) and on SIGTERM (`index.ts` shutdown hook) |
| `usage/recorder.ts` | I/O | `UsageRecorder` port: `recordInTx(tx, event, cap?)` for the store, `recordLater(event)` for best-effort kinds |
| `repositories/ports.ts` | | `UsageRepository`: `record`, `countersFor(subjectKey, months)`, `rollup({ month, groupBy })`, `routeDaily(range)`, `people({ month, plan, nearOrOver })`, `prune(before)` |
| `repositories/prisma.ts` / `memory.ts` | | both implementations. The signed-out portal (`src/hosted/local/createLocalApp.ts` mounts `PORTAL_ROUTES` over the memory store) gets `plans: false` in `PortalRouteDependencies`, like `billing: false`: it passes `usage: null` everywhere and keeps today's profile cap (eng review #8) |
| `auth/store-guard.ts` | | `STORE_ACCESS`: `usage.record*` = `control` (written by the server on any principal's action), `usage.rollup/people/routeDaily` = `operator` |

`store.issuing.issue(input)` gains `input.usage: { subjectKey, month, plan, door, cap: number | null } | null` as **data** (not a closure, unlike `allocate`), and `issueTx` writes the event and the counter **strictly after** `issuedDocument.create` (so two concurrent requests with the same Idempotency-Key resolve through the existing P2002 replay path, not `cap_reached`) and before commit. An unlocked pre-check runs before `input.allocate`, so a refusal never wastes a Tax Authority allocation number. The SQL casts the cap (`$cap::int IS NULL`). `memory.ts` refuses before any mutation (it has no rollback) (eng review #14). New result kind `{ kind: 'cap_reached', meter, used, cap }`. The same shape for the receipt start (`expenseReceipts.create`).

The payer's plan for `input.usage.plan` and `cap`: one helper `payerPlanOf(store, organization, now)` in `usage/plan-of.ts`: `currentPlanOf` over the **payer's own** profiles (not the actor's: a co-owner's `personEntitlements` are their own), one `entitlementsFor` read, run **only on capped actions** (issue, scan complete, profile create), whether or not `BILLING_GATE` is on (eng review #17). An organization-scoped grant does not change the payer's plan for the shared counter: the counter belongs to the payer, and so does the plan.

### 2.4 Which issued documents count (cap meter `DOCUMENTS`)

Counted: tax invoice (305) and tax invoice-receipt (320). Not counted: receipts (400), credit notes (330) and payment requests. Receipts must stay free: paying a tax invoice **is** issuing a receipt (`payTaxInvoice`, `routes/documents-due.ts:229`, ADR-280 refuses a payment without its document), so counting them would stop a capped person recording money on invoices they already issued (eng review #1, CRITICAL). A correction (330) must never be blocked. This is a default awaiting Basel (open question Q1). It lives in one constant, `COUNTED_DOC_TYPES`, so changing it is one line; every issued document is still **recorded**, counted or not.

### 2.5 Businesses and partners

Stock counts, not monthly flows: the cap reads the live truth (owned business profiles from memberships; owners on a profile), as `routes/profiles.ts` does today. The ledger keeps `PROFILE_CREATED` / `PARTNER_*` events for history and the operator's six-month view. ADR note: "caps read from the ledger" applies to monthly meters; stock caps read the records themselves, so they can never drift.

### 2.6 Route metering (folded into the access log, eng review #8, #18)

Not a new middleware in `app-shell.ts`: the shell also runs in the browser for signed-out mode (`createLocalApp.ts`). The existing access-log middleware in **`app.ts`** (~430-446) already sees the final status (after `onError`, including thrown 402/409) and the duration. It gains:
- `routeKey`: `endpointKey(c)`, falling back to `c.req.routePath` for `app.all` routes (where `endpointKey` returns null); unmatched paths share one `UNMATCHED` key;
- `plan`: `c.get('meterPlan')` if a capped action resolved it this request, else `unknown` (no extra read on the hot path);
- `statusClass`.

It increments an in-memory map (no I/O on the request path; a micro-benchmark asserts p99 < 0.2 ms). Cloud Run runs with `cpu_idle = true` and min 0 (`terraform/main.tf:550`), so a `setInterval` won't fire between requests (the TD-215 lesson). The flush is **due-driven**: a request that finds the last flush older than 60 s starts one, fire and forget (one multi-row upsert adding counts and bucket columns), plus a flush on SIGTERM. A failed flush is logged once a minute and the batch dropped (statistics, not money). At most a minute of counts is lost on a hard kill; stated in the ADR.

Excluded: `/health`, `/ready`, static portal assets.

### 2.7 `GET /v1/billing` gains `usage`

Additive (API minor bump):
```jsonc
"usage": {
  "month": "2026-12",
  "resetsOn": "2027-01-01",
  "plan": "starter",
  "meters": [
    { "meter": "documents", "used": 2, "limit": 3 },
    { "meter": "scans", "used": 7, "limit": 12 }
  ],
  "businesses": { "used": 1, "limit": 1 },
  "partners": { "limit": 0 }
}
```
`limit` is null for no cap (Malafat, accountant-only, legacy Freelancer until MUT-707 decides). One `countersFor(subjectKey, [month])` read (primary-key lookup) plus the business count `/v1/me` already computes. MUT-733 later adds `graceUntil` per meter; the field is reserved in the schema now as optional.

### 2.8 Operator console › Usage

Server, all under `/v1/operator/usage*`, classified `open` in `PERSON_LEVEL_GATE` like the other operator reads, behind the operator role check (`operator/` module, MUT-459). Reads need no passkey step-up (they change nothing); the CSV export does (it leaves the system).

| Endpoint | Query | Backs |
|---|---|---|
| `GET /v1/operator/usage/overview?month=` | `rollup({ month, groupBy: ['plan','kind'] })` + people counts per plan | Per plan: totals, near (≥80%) and over, Starter people who hit a cap |
| `GET /v1/operator/usage/people?month=&plan=&filter=near|over|capped&cursor=` | counters joined to users, keyset pagination 50 | The "upgrade leads" list |
| `GET /v1/operator/accounts/{userId}/usage` | `countersFor(user, last 6 months)` + per-profile event counts | A section on the existing account page |
| `GET /v1/operator/usage/routes?from=&to=` | `routeDaily` summed, p95 from buckets, top 50 by volume, errors | Per route |
| `GET /v1/operator/usage/export.csv?view=overview|people|routes&month=` | the same reads as CSV, UTF-8 with BOM | CSV export (step-up) |

Portal: `src/hosted/pages/operator/OperatorUsagePage.tsx` (a fourth `SectionTabs` tab "Usage / الاستخدام"), `OperatorUsageSection.tsx` on `OperatorAccountPage` (six months, per profile), data in `src/hosted/data/operatorUsageQueries.ts`. House recipes only (MUT-458 §3b "no cards, no new components"): rows with `--text-label` meta, numbers in `<bdi>`, a month `Select`. A small inline bar per meter (used/limit) reuses the `hp-` progress recipe if one exists in COMPONENT_REGISTRY, else plain "7 / 12" text (no new component).

i18n keys `hosted.operator.usage.*` in ar and en (Arabic first, Levantine month names via `getLocale`, ADR on Levantine dates).

### 2.9 PostHog: a conflict, flagged, not built server-side

The ticket asks for server-side PostHog events (cap reached, gift used, upgrade offered/accepted, plan change). This contradicts **ADR-090** and `docs/analytics/README.md` ("Hosted API server: never sends", MUT-156 closed; events are opt-in and anonymous). Doing it needs an ADR-090 override that Basel approves (Q2). The plan:
- The **authoritative commercial numbers** come from the ledger and the operator console (first-party, no third party, no consent issue).
- The **funnel events** (`plan_cap_reached`, `plan_upgrade_offered`, `plan_upgrade_chosen`) are sent by the **portal and the phone**, opt-in and anonymous like every other event, added to `docs/analytics/events.json` (contract minor bump) with MUT-731's UI, where the cap sheet is shown. `plan_changed` is not sent; the operator console shows plan history (MUT-734).
- If Basel overrides ADR-090, a server emitter goes through a new `serverPosthogEnabled` in `observability/telemetry-gate.ts` (ADR-236), with no identifier but a hashed subject. Not in this ticket's build.

### 2.10 Privacy and retention

Counts and closed vocabularies only. No amount, name, email, client or free text in any usage table (a unit test walks every `detail` value through the vocabulary). Retention (default, Q3): `usage_events` 13 months, `usage_counters` 25 months (year-on-year), `route_usage_daily` 90 days. A daily prune job on the `renewal-mail.ts` job pattern (`POST /jobs/usage-prune`, `jobAuth`, Cloud Scheduler entry in Terraform). Account closure purge (MUT-333's `account-purge.ts`) deletes the person's events and counters. The periods go into MUT-732's privacy text.

## 3. Data model and migration

Migration `2026112xxxxxxx_mut735_usage_metering` (number set at merge, after whatever lands first):
- `usage_events`, `usage_counters`, `route_usage_daily` with the keys and indexes above;
- **Backfill** for the current month only, so caps start true on release day: `DOCUMENTS` from `issued_documents` (counted types, `createdAt` in the Jerusalem month, grouped by the profile owner), `SCANS` from READY `expense_receipts` completed this month. Events are not backfilled (history starts at release).

Additive only: no column changes on existing tables. Merging restarts the shared dev API: warn the orchestrator first (memory: "Warn before merging a migration").

## 4. Cost

- Postgres (db-f1-micro): one extra row and one upsert per issue or scan (single-digit per person per day). Route aggregates: at most routes × plans × 4 rows per day (~200 routes × 7 × 4 ≈ 5.6k rows/day upper bound, ~500k over 90 days, a few tens of MB). Flushes: 2 per minute per instance. No new service, no third party.
- Request path: an in-memory increment. No extra DB read on a gated server (the plan reuses the gate's entitlement).
- `/v1/billing`: one primary-key read added.

## 5. Phone impact (Flutter, `mutaba3a-flutter/mutaba3a`)

None required by this ticket. `GET /v1/billing`'s `usage` is additive; `BillingOverview` parsing ignores unknown fields. MUT-731/706 read it. The phone's device session is recorded as door `PHONE` (from `identity.session.kind`), so its usage shows separately in the operator console.

## 6. Build order (slices, each green and mergeable)

1. **S1 Ledger + counters (server only).** Migration, `usage/` pure modules, repository (prisma + memory), recorder, `issueTx` and receipt start writes **with `cap: null`** (record only, never refuse). Contract tests on Postgres. ADR.
2. **S2 `/v1/billing.usage`.** Schema, serializer, OpenAPI + `npm run hosted:types`.
3. **S3 Route metering.** Middleware, aggregator, flush, SIGTERM hook, benchmark test.
4. **S4 Other kinds (optional, after the caps ship).** Exports, MCP, mails, profiles/partners, external invoice read. Not needed by any AC; kept because Basel asked to meter "all usages"; can be a follow-up (eng review: scope).
5. **S5 Operator API + CSV.** Endpoints, gate classification, step-up on export.
6. **S6 Operator portal.** Usage tab, account section, ar/en, release-QA feature + spec.
7. **S7 Prune job + Terraform scheduler + docs (can follow the caps)** (privacy retention handed to MUT-732, `before-release.md` block).

MUT-731 starts after S1+S2 (it passes real caps).

## 7. Risks

| Risk | Handling |
|---|---|
| A counter drifts from the events (manual SQL, a bug) | A `usage:reconcile --month` operator script recounts counters from events and from the source tables, prints differences, fixes with `--apply`. Run once after release. |
| Month boundary at Jerusalem midnight vs UTC | `usageMonthOf` is the only place; tests at 21:59/22:00 UTC on the last day in winter and summer time. |
| Issue retried with the same Idempotency-Key | The document isn't `created` again, so no second event; the unique `(kind, entityKey)` is the backstop. A refusal (`PLAN_LIMIT`) **releases** the key in `idempotency.ts` (it did nothing), so the same request succeeds after an upgrade or the reset (eng review #10). |
| Route table grows from odd paths | Route template only; unmatched routes share one key. |
| ADR-090 conflict | Flagged (Q2); client-side events instead. |
| Co-owner issues on a profile they didn't create | Counts to the creator's meter (the creator's plan covers the profile, `subscriptionCovers`). Shown with the actor in reports. |

## 8. Knowledge updates on build

ADR (next free number at merge): "Usage is metered in a first-party ledger; monthly caps read a per-payer counter written in the action's transaction; stock caps read the records; routes are aggregated without a person". SYSTEM_OVERVIEW §8 (still describes the old PWYW model: rewrite with the plans), PATTERNS ("A hard cap is a conditional upsert in the action's transaction"), COMPONENT_REGISTRY (`usage/*`, `OperatorUsagePage`), TEST_PLAN, CHANGELOG, `docs/admin-panel/05-FEATURES.md` operator section.

## 9. Acceptance criteria → proof

| AC | Proof |
|---|---|
| 1 | `usage/__tests__/*.test.ts`; `repositories/__tests__/usage.db.test.ts` (idempotency, cap race with `Promise.allSettled`) |
| 2 | `rollup` contract test; index named in the ADR and the migration comment |
| 3 | `route-meter.test.ts` (failed flush never throws into a request; benchmark) |
| 4 | `qa/features/portal-selfservice/operator.yaml` `operator.usage-overview`, spec `operator.spec.ts` |
| 5 | `routes/__tests__/billing.test.ts` usage block |
| 6 | The ADR |

## 10. QA scenarios (release-QA, web)

1. **operator.usage-overview** (portal-selfservice, tier normal): "As the operator, open Operator › Usage. Pick this month. See totals per plan, and the people near or over their caps." Expect: the seeded Starter person with 3/3 documents is listed under "hit a cap".
2. **operator.usage-account**: "Open an account, scroll to Usage." Expect: six months of documents and scans against the plan's limits, per profile.
3. **operator.usage-routes**: "Open the Routes view." Expect: the routes the QA run just called, with counts and p95.
4. **operator.usage-csv**: "Export the overview as CSV (step-up)." Expect: a CSV download with the same totals.
5. **portal.billing-usage** (portal, in MUT-731's flows): Billing shows "Documents 2 of 3 this month".

Paths: `server/src/usage/**`, `server/src/routes/operator-usage.ts`, `src/hosted/pages/operator/OperatorUsage*.tsx`, `src/hosted/data/operatorUsageQueries.ts`.

## 11. Open questions (for Basel, with the default the plan uses)

- **Q1** Which documents count toward "documents a month"? Default: tax invoices (305) and invoice-receipts (320) only. Receipts, credit notes and payment requests never count: recording a payment on an invoice already issued makes a receipt, and that must never be blocked.
- **Q2** Server-side PostHog needs an override of ADR-090 ("the API never sends"). Default: no; the operator console reads the ledger, and the portal/phone send anonymous, opt-in cap and upgrade events.
- **Q3** Retention: usage events 13 months, monthly counters 25 months, route statistics 90 days. Default as written.
- **Q4** A scan counts when the upload finishes (default), so an abandoned upload costs nothing. OK?

## Business / product impact
- Gives MTB3A its first honest answer to "who uses what, on which plan", and the race-free counter every cap (Starter's 3 invoices and 12 scans, the paid plans' limits, MUT-733's gift) stands on.
- Unblocks MUT-731 and MUT-733, and therefore the Starter launch alongside the three paid plans (MUT-701).
- Cost is a few small tables and an in-memory counter; the risk it removes is selling caps the product cannot count or enforce.

## Eng review (2026-11-25, adversarial Plan agent; findings folded in above)

| # | Sev | Finding | Resolution |
|---|---|---|---|
| 1 | CRITICAL | Counting receipts (400) blocks recording payments on issued invoices (`payTaxInvoice` issues a receipt, ADR-280) | `COUNTED_DOC_TYPES` = 305 + 320 only; Q1 default changed |
| 7 | HIGH | Malafat API-key writes would hit a Starter owner's cap, against ADR-160 d4 | Never capped or refused for an API key, a Malafat writer of record or a MALAFAT-sourced profile |
| 8 | HIGH | The app shell runs in the browser for signed-out mode | Route meter folded into `app.ts`'s access log; `plans: false` for the local app |
| 10 | HIGH | `idempotency.ts` stores 409s, so a refused issue replays its refusal after an upgrade | `PLAN_LIMIT` releases the key |
| 11 | HIGH | Counting scans at start: abandoned uploads count, per-expense start retries double-count | Count at complete, pre-check at start |
| 14 | MED | Upsert placement in `issueTx`; untyped `$cap`; memory store has no rollback | Strictly after the document row; pre-check before allocation; `$cap::int`; memory refuses first |
| 17 | MED | Whose plan: selected profile vs payer vs actor | `payerPlanOf` over the payer's own profiles, only on capped actions |
| 18 | MED | `cpu_idle = true` means a timer won't flush; `endpointKey` null for `app.all` | Due-driven flush from a live request + SIGTERM; `routePath` fallback |
| 19 | MED | Postgres enums and `int[]` make later changes costly | varchar kinds with a code vocabulary; 12 bucket columns |
| 23 | LOW | A new Jerusalem formatter | Reuse `todayIn('Asia/Jerusalem')` |
| scope | — | S4, CSV step-up, prune, reconcile go beyond the six ACs | S4 and S7 marked optional/follow-up; CSV kept (AC4 asks for it in the ticket scope) |

Ticket text to amend (offered, not done): the AC "Every authenticated route records a route-level usage line" is met through the access log aggregate, not a separate middleware; server-side PostHog waits on Q2.
