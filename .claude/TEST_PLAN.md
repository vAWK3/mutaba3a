# TEST_PLAN.md — Testing Strategy & Coverage

> **Purpose**: Document testing approach, coverage targets, and test organization.
> **Current Coverage**: web lines 91.69%, statements 91.01%, functions 88.74%, branches 84.12% (MUT-24 §C, 2026-10-16; enforced by `vitest.config.ts` thresholds in Web CI)
> **Last Updated**: 2026-10-16

---

## Testing Pyramid

```
                    ┌─────────┐
                   /   E2E    \           10%
                  /  (Planned) \          Critical flows
                 /───────────────\
                /   Integration   \       20%
               /   (In Progress)   \      Component + hook tests
              /─────────────────────\
             /        Unit           \    70%
            /     (Repository +       \   Repository, utilities,
           /       Utilities)          \  pure functions
          /─────────────────────────────\
```

---

## Hosted API (`server/`) — Money v1 M1 (added 2026-10-08)

Separate vitest project (`cd server && npm test`; `npm run test:db` adds the
Postgres contract suite against the docker container in `server/README.md`).
CI: `.github/workflows/server-ci.yml` runs the whole set, plus the Docker
build and `terraform validate`, on every change under `server/`.
304 unit tests + 7 skipped Postgres runners (43 files) at M8 (counted by `vitest run` without a database; 342 with `MUTABA3A_TEST_DATABASE_URL` set):

| Area | File | What is pinned |
|------|------|----------------|
| Money | `src/__tests__/money.test.ts` | canonical decimal parse/format, rejection of locale separators/exponents/over-precision, bigint precision, no cross-currency arithmetic |
| Keys & scopes | `src/auth/__tests__/api-key.test.ts` | key format, sha256 storage, constant-time compare, masking never leaks the secret, unknown scope fails the whole list, non-hierarchical scopes |
| Rate limit | `src/__tests__/rate-limit.test.ts` | sliding window, Retry-After, per-key isolation, prune |
| Storage contract | `src/repositories/__tests__/store-contract.ts` run by `store-memory.test.ts` always and `store-prisma.test.ts` when `MUTABA3A_TEST_DATABASE_URL` is set | unique slug/prefix/hash, revoke-once, one tenant ↔ one organization, reconnect keeps id, audit ordering, idempotency new/in_progress/replay/mismatch/fail |
| Smoke | `src/__tests__/smoke.test.ts` | `runSmoke` against the in-memory app: every unauthenticated check passes on a healthy deployment, version mismatch is the only failure when the tag differs, the admin round trip (provision → key → validate → revoke → `API_KEY_REVOKED`) passes and never logs a secret, a non-JSON 502 is reported not thrown, a wrong admin token stops the round trip after one step; `parseBaseUrl` accepts absolute http(s) and strips trailing slashes, rejects empty (the `terraform output` failure mode), relative and non-http values |
| Dates | `src/__tests__/dates.test.ts` | organization-timezone today, ISO validation, day/month arithmetic across boundaries, payment-terms due dates |
| VAT | `src/__tests__/vat.test.ts` | half-up symmetric rounding; table of exclusive/inclusive × treatments × 16/17/18 % with net + vat = gross on every row; rate bounds |
| Schedule | `src/agreements/__tests__/schedule.test.ts` | exact sums, difference reporting, percent split with last-absorbs, mixed/empty/too-many/non-positive, per-installment treatment, inclusive reconciliation over 7 uneven items |
| Status | `src/agreements/__tests__/status.test.ts` | every (voided, posted, due vs today, paid) cell |
| Retainer schedule | `src/retainers/__tests__/schedule.test.ts` | validation, clamped charge dates, chargeable months with end/cancel FULL/WAIVE, 120-month bound |
| Preview token | `src/__tests__/preview-token.test.ts` | canonical JSON (key order, bigint), changes per part, constant-time verify |
| Storage contract (M3) | `store-contract-m3.ts` via memory + Postgres runners | VAT rates append-only + effectiveOn; atomic agreement + installments with BigInt > 2^53; post-once with receivable; due-unposted listing; supplement with version check; cancel voids unposted, idempotent; posted charges unique per month; receivable filters + outstanding count + isolation |
| Routes (M3) | `src/__tests__/routes-m3.test.ts` | VAT rate scopes/conflict/current; preview totals + due dates; create + receivable; PREVIEW_STALE on body or rate change; VAT_RATE_MISSING vs foreign client vs per-installment override; validation reasons; idempotent create + audit; lazy DATE posting across Jerusalem midnight; manual trigger 201/200/NOT_MANUAL/AGREEMENT_CANCELLED; DUE vs OVERDUE by timezone, PARTIALLY_PAID/PAID via a real payment; receivable filters + scope; supplements LAST_UNPOSTED / PRORATE / NEW_INSTALLMENT / exceeds-unposted with requiresAdjustment; cancel rules; CURRENCY_LOCKED + PROJECT_HAS_OUTSTANDING; retainers preview/create/lazy charge/reconcile counts/cancel FULL vs WAIVE/NOT_FIXED/NOT_RECURRING; OpenAPI paths + reasons + version |
| Allocation math (M4) | `src/payments/__tests__/allocate.test.ts` | outstanding honours paid + credited; eligibility (customer, currency, OPEN, > 0, oldest first); explicit-set validation with every reason and its details; OLDEST_FIRST order + tie-breaks + stop-at-amount; SETTLE_MATTERS whole-projects-first, smallest first, ties by due date, nothing-fits fallback; resulting balances per receivable/project/customer with statuses; grep guard: no `Number()` on minor units |
| Credits (M4) | `src/payments/__tests__/credit.test.ts` | VAT split table at 16/17/18 %, treatments, rate 0; `net + vat = credit` over a grid; capacity check reasons |
| Numbering + token (M4) | `src/payments/__tests__/numbering.test.ts` | `PAY-YYYY-NNNN` incl. > 4 digits; year from receivedOn; token stable across snapshot order, changes with body / organization / any eligible version |
| Status (M4) | `status.test.ts` "credits" | credited-but-unpaid is DUE/OVERDUE, credited to zero is PAID, partial payment with credits is PARTIALLY_PAID |
| Storage contract (M4) | `store-contract-m4.ts` via memory + Postgres runners | atomic payment + allocations + sums + number; rollback on insufficient capacity (no number consumed); gap-free numbers per organization/year under 12 concurrent creates; allocate later within the remainder, refused when reversed; reverse restores/reopens, idempotent, history kept, replacedBy; credits append-only with capacity and status; sums equal rows after create/allocate/reverse/credit; eligibility + payment filters/paging/isolation; BigInt > 2^53; idempotency.get PENDING/COMPLETED/absent |
| Routes (M4) | `src/__tests__/routes-m4.test.ts` | preview scope, eligible list, strategies, explicit wins, writes nothing; SETTLE_MATTERS and NO_ELIGIBLE_RECEIVABLES; every allocation reason incl. cross-customer/currency/archived/settled; create 201 with number, receivable + installment statuses, SETTLED filter, same-key-different-body 422, true replay, audit incl. `receivable.settled`; PREVIEW_STALE on changed set / credit in between / payment in between; body validation (date, method, replacesPaymentId rules, scope, key required); allocate later from `{ paymentId }` preview, EXCEEDS_PAYMENT, NO_UNALLOCATED_FUNDS, PAYMENT_NOT_POSTED, 404; reversal reopens receivable + installment, replay vs ALREADY_REVERSED, cross-organization 404, unallocated reversal; credits VAT split, settle at zero, CREDIT_EXCEEDS_OUTSTANDING with outstanding, RECEIVABLE_NOT_OPEN, list newest first, archive after credits, reversal after credit; operations COMPLETED (201 and stored 422) / PENDING / 404 / isolation / scope; PARTIALLY_PAID vs OVERDUE vs PAID by clock; payment list filters + pages; OpenAPI paths, reasons, version, `credited` |
| Retainer terms (M5) | `src/retainers/__tests__/terms.test.ts`, `proration.test.ts`, `schedule.test.ts` | v1 synthesized from the agreement; timeline / termsFor / latest; validateChange every reason in order; diffTerms; applyChange; chargesKept; calendar-day inclusive proration half-up; cancelOutcome FULL / PRORATE / WAIVE with posted charge, credit capped at outstanding, earlier credits not double-credited |
| Storage contract (M5) | `store-contract-m5.ts` via memory + Postgres runners | versions append-only per agreement, unique per effective month; charges stamped with version; cancelEffectiveDate; organizations.list ordering |
| Routes (M5) | `src/__tests__/routes-m5.test.ts` | change preview / apply (token, kept months, VAT at effective month, billing day per version), CHANGE_EFFECTIVE_INVALID / CHANGE_NOTHING_CHANGED / BILLING_DAY_INVALID / END_*; cancel preview FULL / PRORATE / WAIVE incl. posted month with payments (`limitedByPayments`); cancel requires the token only when a credit is created (PREVIEW_TOKEN_REQUIRED, PREVIEW_STALE); OpenAPI paths + reasons + version |
| Summaries (M6) | `src/summaries/__tests__/compute.test.ts` | bucketize by due date vs today; unallocated; last payment; customer and project statuses for every cell; project figures |
| Attachment rules (M6) | `src/attachments/__tests__/rules.test.ts` | MIME allow-list, size bounds, filename rules (path separators, control chars, length), exactly one target, storage key, Content-Disposition |
| Storage contract (M6) | `store-contract-m6.ts` via memory + Postgres runners | attachments create / complete / list (READY only, by target) / soft delete / isolation; audit.list keyset filters and paging |
| Routes (M6) | `src/__tests__/routes-m6.test.ts` | summaries invariants and statuses; audit list scope / filters / cursor; attachments create (503 without storage, reasons, 404 target, cross-org), complete (UPLOAD_INCOMPLETE / UPLOAD_MISMATCH / idempotent), list, download (ATTACHMENT_NOT_READY, TTL), delete (204, 404 after); scopes |
| Transitions (M8) | `src/proposals/__tests__/transitions.test.ts` | the three-state table (approve / withdraw from PROPOSED only; APPROVED and WITHDRAWN terminal), `currentProposal` (open wins, else latest approved, never withdrawn) |
| Storage contract (M8) | `store-contract-m8.ts` via memory + Postgres runners | create PROPOSED, second open proposal refused (`UniqueViolation`), `open=true` = PROPOSED, isolation; conditional `transition` + version bump, terminal states; agreement create with `approveProposal` moves PROPOSED → APPROVED atomically (amount, date, note, link) and refuses APPROVED / WITHDRAWN / other-project proposals; `listUnpostedDue` returns due DATE and unposted IMMEDIATE installments, never MANUAL / posted / future / other organizations |
| Routes (M7, kept) | `src/__tests__/routes-m7.test.ts` | create (currency, defaults, audit, idempotent replay, validation reasons, scope), 409 `PROPOSAL_OPEN` + currency lock, withdraw idempotency and refusal once approved, lists / pagination / isolation, project + customer summaries carry `proposal` |
| Routes (M8) | `src/__tests__/routes-m8.test.ts` | approve ONCE (final amount, `agreementDate = approvedOn`, IMMEDIATE installment posted with the due date, receivable, audit, project summary, project free again) and INSTALLMENTS (equal shares with the remainder first, #1 IMMEDIATE, #2..n DATE monthly clamped, lazy posting of #2 on its date); 409 `PROPOSAL_NOT_OPEN` from APPROVED / WITHDRAWN, idempotent replay, `AMOUNT_INVALID` / `DATE_INVALID` / zod bounds, scope, cross-org 404; `422 VAT_RATE_MISSING` by approval date; organization summary `proposed`, `counts.openProposals`, per-row `proposals[]`, proposals-only currency block, `?currency=`; archive 409 `PROPOSAL_OPEN`; healed unposted IMMEDIATE installment with `trigger: IMMEDIATE` audit; contract version, paths, schemas |
| **End-to-end (HTTP)** | `server/e2e/money-v1.e2e.mts` | Malafat's client against a running server on Postgres: every milestone's flows and states plus the security edges, and since M8 the approval flow (propose → PROPOSAL_OPEN → archive refused → VAT_RATE_MISSING by date → approve ONCE creates the agreement and posts the receivable → replay → NOT_OPEN → summary proposed/outstanding move → INSTALLMENTS split and clamp → cross-org / narrow key); 103 checks (run 2026-10-10 against `mutaba3a_test_m8`, all passing). Needs `MUTABA3A_ADMIN_TOKEN`, `E2E_BASE_URL`, `MALAFAT_WEB_DIR`; creates throwaway organizations, so dev/staging only |
| **End-to-end (attachments)** | `server/e2e/attachments.e2e.mts` | the real app on Postgres with `MemoryAttachmentStorage`; 34 checks (run 2026-10-08, all passing). Needs `E2E_DATABASE_URL` |
| Pagination | `src/__tests__/pagination.test.ts` | cursor round trip with ms precision, tampered/foreign cursors → VALIDATION_FAILED, limit default/cap |
| Import planner | `src/import/__tests__/plan.test.ts`, `preview-token.test.ts` | every row of the brief's preview/commit table, batch customer resolution, first-occurrence-wins on duplicates, 500-row cap, input order; token stable/changes on rows, order, organization; constant-time verify |
| Storage contract (M2) | `src/repositories/__tests__/store-contract-m2.ts` run by `store-memory-m2.test.ts` and `store-prisma-m2.test.ts` | organization scoping of get/list, external-reference uniqueness (by entity type, by entity), atomic create+reference (no orphan on failure), optimistic update updated/stale/not_found, idempotent archive, active-project count, filters, keyset pagination over 23 rows with equal timestamps |
| Routes (M2) | `src/__tests__/routes-m2.test.ts` | scope matrix incl. import's two write scopes, Idempotency-Key required/replay, external-reference idempotency (200, no audit, no duplicate), INTEGRATION_NOT_CONNECTED, body validation, 404 cross-organization, list filters + cursor pages + limit cap + bad cursor, PATCH If-Match / VERSION_MISMATCH / audit fields, archive HAS_ACTIVE_PROJECTS then idempotent, project customer checks (not found / archived / foreign), CUSTOMER_MISMATCH, CURRENCY_LOCKED via `markProjectPosted`, immutable customerId, import preview (no writes, totals, token), 501 rows, commit order + idempotent re-run + replay + partial failure + audit, isolation with identical external ids, OpenAPI paths + reason vocabulary + version |
| Routes | `src/__tests__/routes.test.ts` | health/ready, request ids, OpenAPI document, admin auth, provisioning + audit trail, every 401 code (UNAUTHENTICATED, INVALID_API_KEY, API_KEY_ENVIRONMENT_MISMATCH, API_KEY_REVOKED, API_KEY_EXPIRED), forged suffix with a real prefix, INSUFFICIENT_SCOPE details, missingScopes, 429 headers, Idempotency-Key required/replay/reuse, ORGANIZATION_MISMATCH both directions, disconnect revokes + reconnect keeps id, cross-organization isolation |
| Conversions (MUT-161) | `src/conversions/__tests__/cursor.test.ts`, `compose.test.ts` | cursor round-trip + rejects a foreign-collection cursor; `conversionDate`/`parseConversionAmount` (positive, currency-aware precision, per-leg field name) / `assertDifferentCurrencies` (SAME_CURRENCY on `toCurrency`) |
| Storage contract (conversions) | `store-contract-conversions.ts` via memory + Postgres runners | create + read inside one organization, newest-first (occurredOn, id) pagination without gaps/repeats, every filter incl. currency matching either leg |
| Routes (conversions) | `src/__tests__/routes-conversions.test.ts` | 201 full shape incl. JOD 3-decimal; device-session create (MUT-64); AMOUNT_INVALID per leg with field name; SAME_CURRENCY; future-dated refused / backdated and today accepted (ADR-038); Idempotency-Key replay + reuse-refused; writability (API key 403 `PRINCIPAL_NOT_ACCEPTED` on every operation); list pagination + filters + cross-org isolation; get-by-id 404 cross-org/unknown; regression — a conversion leaves `/v1/summaries/organization` and `/v1/summaries/expenses` byte-identical |
| Expense groups (MUT-267) | `src/expenses/__tests__/groups.test.ts`, `summary.test.ts` (`summarizeGroup`) | window end (open = start+365, R6), `isGroupMember` table (in/out of range × no mark/excluded/included), series bounds incl. future-start open group (C2), create/patch validation on the merged range (END_BEFORE_START, GROUP_RANGE_TOO_LONG 366/367, floor, unchanged date not re-checked); day buckets zero-filled + sparse before/after, buckets sum to the total per currency |
| Storage contract (expense groups) | `store-contract-expense-groups.ts` via memory + Postgres runners; `migration-mut267.test.ts` | group CRUD + versioned update + soft delete per organization; one mark per (group, expense), last write wins, clear, per-expense lookup; member filter == `isGroupMember` on a 10-case fixture with cursor paging; excluded = in-window only; group filter AND other filters + inclusive anchor cursor; open group stops at a year; `totalsByCurrency` incl. overlapping groups and deleted expenses; migration from empty matches the schema, mode CHECK |
| Routes (expense groups) | `src/__tests__/routes-expense-groups.test.ts` | AC1–AC9 one test each; Idempotency-Key replay + If-Match 409; list totals == summary; 6A after bucket; R6; 22A excluded moved out; `?expenseId=`; C4 anchor; cross-profile 404s (A1); API key 403 on all 8 operations |

Malafat's contract test (`features/money/contract/__tests__/mutaba3a-contract.test.ts`)
pins its client to the vendored `openapi.yaml` (TD-019 resolved). Not covered
by automation: the Terraform plan against a real project, the local image
push, the proxy-run migration and the GCS signed-URL path with a real bucket —
exercised by the operator runbook (`server/DEPLOYMENT.md` §2–3) and the
handover checklist (`.claude/designs/money-v1-handover.md`); the smoke step is
the M1 exit criterion, the e2e scripts above are the Money v1 one.

---

## Coverage thresholds and the risk files (MUT-24 §C, 2026-10-16)

Measured with `npx vitest run --coverage --coverage.reportOnFailure` (v8, Node 22, TZ Asia/Jerusalem) over all 385 files under `src/`. `npm run test:coverage` fails below the floors in `vitest.config.ts`, and Web CI (`.github/workflows/web-ci.yml`) runs it on every PR and every push to main. To raise a floor, edit `COVERAGE_THRESHOLDS` after a gain. Never lower one to land a change.

| | Lines | Statements | Functions | Branches |
|---|---|---|---|---|
| Baseline (main 9866f0f) | 89.48 | 88.55 | 87.24 | 81.07 |
| After MUT-24 §C | 91.69 | 91.01 | 88.74 | 84.12 |
| Enforced floor | 91 | 91 | 88 | 84 |

Risk files (lines / branches, baseline → final), floors 100 = pure, 95 = risk:

| File | Area | Baseline | Final | Floor |
|---|---|---|---|---|
| `src/db/database.ts` | every Dexie `upgrade()` | 42.6 / 26.9 | 100 / 98.9 | 95 |
| `src/db/migration-safety.ts` | backup, validate, auto-fix | 72.9 / 61.7 | 100 / 98.3 | 95 |
| `src/db/csvImport.ts` | CSV import (MUT-60 writer) | 68.2 / 51.9 | 100 / 98.7 | 95 |
| `src/db/expenseRepository.ts` | expense money, recurring | 74.6 / 61.5 | 99.4 / 99.4 | 95 |
| `src/db/repository.ts` | payment records (MUT-18/60) | 98.9 / 92.7 | 99.3 / 95.5 | 95 |
| `src/db/aggregations.ts` | totals, owed, ageing filters | 99.4 / 92.6 | 100 / 100 | 100 |
| `src/components/clients/clientIndexRows.ts` | overdue days, owed-now order | 100 / 84.4 | 100 / 100 | 100 |
| `src/hosted/format/dates.ts` | MUT-227 `moneyDateFloor` | 100 / 83.3 | 100 / 100 | 100 |
| `src/hosted/components/incomeApiErrors.ts` | MUT-227 past/future bound | 95.1 / 83.9 | 100 / 98.2 | 95 |
| `src/hosted/components/conversionApiErrors.ts` | MUT-227 bound, conversion | 66.7 / 68.8 | 100 / 100 | 100 |
| `src/db/profileDefault.ts` | one default business | 100 / 83.3 | 100 / 100 | 100 |
| `src/lib/utils.ts`, `currencyAmounts.ts`, `paymentEntry.ts`, `incomeEntry.ts`, `fx/fxService.ts`, `dates.ts`, `attention.ts`, `pages/income/incomeRows.ts`, `clients/clientProfileRows.ts`, `expenses/recurringAttention.ts`, `ui/AmountWithConversion.tsx`, `hosted/format/DecimalAmount.tsx` | money, minor units, FX, overdue | 100 / 100 | 100 / 100 | 100 |
| `src/components/ui/CurrencySummaryPopup.tsx` (not floored) | unified ILS total | 53.0 / 44.1 | 100 / 94.9 | — |

New harness: `src/test/legacyDexie.ts` (`schemaAt(n)`, `createDatabaseAt(name, n, rows)`) builds a database as version n left it, so an upgrade test opens the current `MiniCrmDatabase` over it. Use it for every new Dexie version. `src/test/timeouts.ts` `SLOW_UNDER_COVERAGE` is the per-test timeout for a test that crosses 5 s only under instrumentation (TD-155).

Unreachable branches left uncovered on purpose: `if (table)` in migration-safety's two loops over a hand-kept list of existing tables (TD-074), and v14's `amountMinor || 0` (v18 rewrites it).

## Firm books (epic MUT-298, planned 2026-10-19)

The test plan for MUT-300..314 is `.claude/designs/firm-books-tests.md`. It covers:
- the cross-cutting contract tests: role matrix drift, the role refusal table, approval in totals, the period lock and close race, no double count, the VAT split and the compliance copy guard;
- the minimum tests for each child.

Every money rule runs on both stores (memory and `test:db`).

**MUT-300 (built 2026-10-20):**
| File | Type | Covers |
|------|------|--------|
| `server/src/repositories/__tests__/store-contract-firm.ts` (+ `store-memory-firm`, `store-prisma-firm`) | contract, both stores | request (idempotent, no version bump, audited once, concurrent requests on Postgres), enable in place / operator firm roles, refusals (owners required, not a member, personal, not business), disable keeps roles, no-op writes nothing, decline, listing order and cursor, BOOKKEEPER on later grants |
| `server/src/repositories/__tests__/migration-mut300.test.ts` | test:db | OWNER backfill, pair CHECK, not-personal CHECK, RESTRICT FK, no schema drift |
| `server/src/__tests__/routes-profiles-firm.test.ts` | routes | firm-request matrix (202, replay and new key, O3 save after request, PERSONAL_PROFILE, NOT_BUSINESS, NOT_OWNER, 404, ALREADY_FIRM, API key); `/v1/me` `firm`/`role`/`firmRequestedAt`; POST/PATCH profile carry them |
| `server/src/__tests__/routes-admin-firm.test.ts` | routes | enable/disable/decline/listing, members with roles, 401/404/409/422 |
| `server/src/scripts/__tests__/users-cli.test.ts` | CLI | `firm-requests`, `firm-enable` (owned and `--owner`), `firm-disable`, `firm-decline` |
| `src/hosted/data/__tests__/profileRules.test.ts` | unit | `'OPERATOR'` reason, `firmRequestState` incl. older servers |
| `src/hosted/components/__tests__/ProfileEditForm.firm.test.tsx`, `FirmOnBanner.test.tsx` | portal | offer → Requested with Idempotency-Key, error, visibility, Arabic; banner shown/hidden, dismissal persists, blocked storage, Arabic |
| `scripts/__tests__/firm-copy-guard.test.ts` | unit | banned compliance phrases in every `hosted.firm.*` / `hosted.profiles.firm.*` string, ar and en |
| `qa/specs/portal/profiles.spec.ts` `@portal.profiles.firm-request`, `shell.spec.ts` `@portal.shell.firm-enabled-banner` | release-QA | the two user flows, RTL |
| `src/hosted/local/__tests__/migrations.test.ts`, `format-fingerprint.test.ts` (orgs, members) | unit | local snapshot 1 → 2: firm off, nothing requested, OWNER; the input snapshot untouched; restores into a store |
| `server/src/records-file/__tests__/export.test.ts` | unit | the export writes firm off and the exporter as OWNER, even as a firm's BOOKKEEPER |
| `src/hosted/session/__tests__/local-mode.test.tsx` | portal | signed out on this device, an owned Business profile's pane has no firm request |

## Signed-in records export (MUT-325, added 2026-10-20)

| Layer | Where | Covers |
|---|---|---|
| Unit | `server/src/records-file/__tests__/codec.test.ts`, `export.test.ts` | streamed JSON equals the one-shot encoder at any page size; every field once and in order; re-homing (one person, no foreign email, no integrations or documents, firms owned, extra columns dropped); page bound |
| Route | `server/src/__tests__/routes-records-export.test.ts` | auth (member only, header required, key refused), audit, gzip, lazy posting first, paging, mid-stream abort; receipt route bytes/headers/404s/503 |
| Schema | `server/src/repositories/__tests__/prisma-records-export-columns.test.ts` | every selected column exists in the Prisma schema (no DB) |
| Postgres (`test:db`) | `store-records-export-parity.test.ts` | Prisma export reads every field and the inbox exactly as the memory store does; key cursors over 2-row pages; receipt lookup |
| Parity (AC1) | `src/hosted/local/__tests__/hosted-export-parity.test.ts` | hosted export → local restore: every portal read equal field for field (personal + Malafat-fed firm), inbox rows, receipt bytes; documented re-homing differences |
| Scale (AC2) | `hosted-export-large.test.ts` | 10k entries + 200 receipts through the real routes; progress to 200/200; cancel partway |
| Component | `HostedYourDataDrawer.test.tsx`, `local-mode.test.tsx` | menu/URL, checklist, progress, cancel, missing files, too-new reload, Arabic RTL; Restore confirm names an account export |
| Release-QA | `qa/specs/portal/your-data.spec.ts` | `portal.your-data.download-signed-in`, `portal.your-data.download-cancel` |

## Current Test Coverage

### MTB3A name (MUT-402, added 2026-10-23)
| File | Type | Covers |
|------|------|--------|
| `src/components/brand/__tests__/Logotype.test.tsx` | Unit (jsdom + postcss) | Logotype is one image named MTB3A (`lang="en"`); BrandName per language; the mask names the pinned file; `currentColor`; the pinned box; H never on `:root`; no undefined custom property; 0.60 H gap; the Arabic name's own type; the separator's 3px floor; forced colours per context (CanvasText / LinkText / VisitedText) and the square mark ring; whole-lockup print ink; the `hosted.html` preload names the same file in CORS mode; the retired lockup CSS and the 480px `.wordmark-other` rule |
| `src/components/brand/__tests__/Wordmark.test.tsx` | Unit | `--wordmark-mark` is the markSize in px, default 30; no lockup in source under 30px; no stylesheet sets `--wordmark-mark` |
| `src/styles/__tests__/brand.test.ts` › drift | Unit (node) | `--m-wordmark-*` equal the JSON both ways; the print ink is the light ink in both themes; the aspect equals the SVG viewBox |
| `src/lib/i18n/__tests__/brandName.test.ts` | Unit (node) | No English leaf says Mutaba3a, no Arabic leaf has Latin (privacy exempt); both HTML titles are متابعة; `client_name` is MTB3A; the guard catches its fixtures |
| `src/pages/landing/__tests__/LandingHeader.test.tsx`, `src/hosted/components/__tests__/Brand.test.tsx` | Unit | The link's name follows `dir`; the phone pieces are marked; the portal's 40/32px marks; `PortalTitle` follows the switch |
| Server route tests (`routes-m*`, `routes-sessions`, `routes-account-setup`) | Unit | `1.52.1-mut402`, "MTB3A Financial API", the three CROSS_SITE_REQUEST messages |
| `backupDownload`, `ImportExportModals`, `ImportDataPage`, `migration-safety-paths`, `HostedYourDataDrawer`, `local-mode` | Unit | Downloads are `mtb3a-…`; old `mutaba3a-…` files still restore (`dataFiles`, `YourDataSection`, `recordsArchive`) |
| `qa/specs/web/brand.spec.ts` › `@web.brand.mtb3a-name` | E2E (Chromium) | The landing lockup in both directions at 1280, 360 and 320px, painted in the link's colour; forced colours one colour with a ring; the download page's title |
| `qa/specs/portal/shell.spec.ts` › `@portal.shell.mtb3a-name` | E2E (Chromium) | Sign-in at 40px, one logotype fetch on a cold load, forced colours, Arabic text and tab title, the 32px sidebar |

Baseline on main (2026-10-23, preview builds): `web.landing.375`, `web.brand.contrast-landing` (`.hosted-notice` links), the `/hosted` landing specs and `portal.signin.boot-slow-session` fail on main too; this branch fixes `web.landing.title`.

### MTB3A logotype (MUT-401, added 2026-10-23)
| File | Type | Covers |
|------|------|--------|
| `src/styles/__tests__/wordmark.test.ts` › pathPoints | Unit (node) | Absolute and relative M/L/H/V/Z, end points vs. the control-point hull, S/T reflection, implicit lines after a move, upper-case exponents; throws on a leading number, an unknown command, a number after Z, a truncated command and arcs |
| `src/styles/__tests__/wordmark.test.ts` › wordmark.svg | Unit (node, jsdom) | One file with a viewBox and no dark variant (eng D7); elements and attributes from an allowlist only (eng D4); `<metadata>` holds only the C2PA manifest as base64 text; every path has one opaque fill; the outline touches all four viewBox edges within 1% and no end or control point leaves it (eng D8); no copy of its bytes, and no SVG named wordmark or MTB3A, under docs/brand, public or src/hosted/public (eng D3) |
| `src/styles/__tests__/wordmark.test.ts` › feature graphic | Unit (node) | `store/feature-graphic-en-1024x500.png` is 1024 × 500, 8-bit RGB (colour type 2), no tRNS chunk |
| `src/styles/__tests__/wordmark.test.ts` › the checks fail on what they guard against | Unit (node, jsdom fixtures) | Allowlist rejects `<constructor>`/`<toString>` (Object.prototype names), a nested svg, `<set>`, a path in another namespace, metadata outside the root, a manifest outside metadata; metadata rejects loose text, CDATA and non-base64; the PNG check rejects RGBA, 16-bit, grey and palette; the copy scan reports symlinks, dangling ones included. S/T reflect only C/S and Q/T controls; unreadable characters in path data throw |
| `src/styles/__tests__/wordmark.test.ts` › pins | Unit (node) | `brand.sha256.json` lists exactly the mark, nine web icons and the logotype, and each matches (eng D5, D9) |

Checked by mutation on 2026-10-23:
- a padded viewBox with a `style` attribute failed the viewBox, attribute, frame and pin tests;
- a path with no fill failed the fill and pin tests;
- a control point at y = −50 plus a `<set>` element failed the frame, allowlist and pin tests;
- a renamed copy in `public/` failed the one-copy test;
- the RGBA feature graphic failed the alpha test.

No release-QA spec: nothing renders the file until MUT-402, whose spec covers the landing header and portal.

### Landing header and motion (MUT-77, added 2026-10-14)
| File | Type | Covers |
|------|------|--------|
| `src/hooks/__tests__/useLatestRelease.test.ts` | Unit (hook) | R6 contract: cache hit → no fetch; concurrent mounts → one fetch; shared failure → error to both, then the next call retries; `useCheckForUpdates` still fetches after a settle; a stalled call times out at 10s and the next call asks again; a failed cache write keeps the release |
| `src/hooks/__tests__/useInView.test.ts` | Unit (hook) | null until the first report or without IntersectionObserver; in/out; options passed through; once → disconnect and stay true; disconnect on unmount |
| `src/hooks/__tests__/useDocumentTitle.test.ts` | Unit (hook) | Sets and follows the title |
| `src/components/brand/__tests__/Wordmark.test.tsx` | Component | Name + decorative mark at size; caller classes |
| `src/pages/landing/__tests__/LandingHeader.test.tsx` | Component | Wordmark link to `#top` (full + phone names); switch named in EN/AR with its letters; switches language; `data-visible` contract; same href as the hero for mac/windows/iPhone; short label + full accessible name, AR too; shown by default; scroll-edge fade from the sentinel |
| `src/pages/landing/__tests__/LandingPage.test.tsx` › header button, title | Integration | Hidden while unknown, shown only when the hero button is out of view, hidden again; hidden without IntersectionObserver; title EN → AR |
| `src/pages/landing/__tests__/ChapterSection.test.tsx` | Component | Below the fold → pending → done once; never pending in view, under reduced motion, or without IntersectionObserver; `extra` renders in the copy column after the body, nothing by default (MUT-173) |
| `src/pages/landing/__tests__/landingCss.test.ts` | Unit (node, CSS) | No `transition: all` (landing + theme); no `[data-theme` in landing CSS; press tokens on 6 buttons (incl. `a.landing-phone-store`), no literal scale; the store link keeps its colour and no underline on hover; text links dim (incl. `.landing-phone-hint a`, `.landing-band-link`); the band link's focus ring is `2px solid currentColor`; sticky 85% frost with the -webkit- prefix; solid under reduced transparency and `@supports not`; hidden button uses visibility; AR tracking 0; reveal uses `--stagger-rise`, zeroed under reduced motion |
| `src/content/__tests__/download-config.test.ts` | Unit | `storeLinkUrl`: https listing of an available app → URL; unset → null; unavailable with a URL → null; placeholders (`TBD`, `#`, http, bare host, empty) → null (MUT-173) |
| `src/lib/i18n/__tests__/core.test.tsx` › defaultLanguage (MUT-202) | Component | The default beats an `en-US` system and stores nothing; a marked stored `en` wins; a detected (unmarked) `en` does not; an invalid value is ignored; the switch stores the language and the mark; storage that throws still renders; the app's two "as before" cases unchanged |
| `src/pages/landing/__tests__/LandingProviders.test.tsx` | Component | `LANDING_DEFAULT_LANGUAGE` is `ar`; an `en-US` browser with nothing stored gets `ar`/`rtl` and no stored key; a stored `en` wins (MUT-202) |
| `src/content/__tests__/malafatLinks.test.ts` | Unit | Landing link to the localized home with the landing tags; MUT-189's in-app contract (contact page, topic first); exactly five query keys (MUT-174) |
| `src/pages/landing/__tests__/LandingPage.test.tsx` › Malafat (MUT-174) | Integration | Nine parts with `malafat` after `phone`; title, one link from `malafatUrl` (new tab, noopener); capture claim names the hosted account and the phone app; AR; shared banned claims (automatic/sync/reports/price/MUT-25/inside) EN+AR |
| `src/pages/landing/__tests__/LandingPage.test.tsx` › phone and portal (MUT-173) | Integration | Eight parts with `phone` after `get-it`; title/body/one `/hosted` link; store link only when a `url` is set (new tab, noopener); an available app with no `url` is named with "with your hosted account" and no link (icons `aria-hidden`); a placeholder or an unavailable app's URL never links; "coming soon" while unavailable, gone once available with a url; AR; honesty (no reports/analytics/price words, mock stripped first) |
| `PrivacyPolicyPage.test.tsx` | Component | Tab title EN/AR |
| `src/pages/download/__tests__/DownloadPage.test.tsx` | Component | Renders under `LandingProviders` with no app mocks (only the GitHub release is stubbed); landing chrome (skip link, bar home to `/`, `main#main-content`, footer); no `.topbar`; AR/RTL with no raw keys; tab title EN/AR |
| `src/pages/download/__tests__/downloadCss.test.ts` | Unit (node, CSS) | One top-level `.download-title` rule |
| `qa/specs/web/landing.spec.ts` | E2E (Playwright, preview build) | `@web.landing.header-cta`, `.transparency` (CDP), `.press` (buttons scale, FAQ dims, + reduced motion), `.hover-light` (contrast + colour held), `.375` at 375/320 EN/AR (no overlap, wordmark not clipped, fits, 44px target, `#get-it` jump lands below the bar), `.title`, `.reveal` (+ reduced motion), `.privacy-bar` (no button, no GitHub call, home link), `.download` (renders: h1, a platform button, bar home to `/` with no button, footer, no `.topbar`, no page errors; red on a main build), `.phone` EN/AR (MUT-173: chapter after Get it with laptop, phone and caption visible, also at 375 with `dir` asserted; at 1024 no amount under the phone frame; each platform's state from `MOBILE_APP_LINKS`, a store link pressing and keeping its colour when one exists; the underlined hint link opens `/hosted`), `.arabic-default` (MUT-202: in an `en-US` browser, `/`, `/hosted`, `/privacy`, `/download` are `ar`/`rtl` with nothing stored, `/app` stays `en` and stores it, the landing stays Arabic over that detected `en`, EN sticks after a reload; `.download`, `.hosted`, `.hosted-slash` now set English first), `.malafat` EN/AR (MUT-174: href from `malafatUrl`, ≥4.5:1 on the ink band, colour kept on hover and keyboard ring in its own colour in light and dark, 375 fit, axe) |
| `qa/specs/web/brand.spec.ts` › contrast-landing | E2E | Axe light/dark also with the bar and its button over a chapter |
| Manual (TD-121) | — | Safari with Reduce Transparency |

### Classed-link hover (TD-122, added 2026-10-14)
| File | Type | Covers |
|------|------|--------|
| `src/styles/__tests__/brand.test.ts` › tokens | Unit (node, CSS) | No stylesheet in `src/` has a bare `a:hover`; `theme.css` and `index.css` each have exactly `a:not([class]):hover` |
| `src/styles/__tests__/brand.test.ts` › classed text links | Unit (node, CSS) | Each audited text link's `:hover` declares a `var(--…)` colour and `text-decoration: underline` (8 classes, portal `.hp-back` included) |
| `qa/specs/web/link-hover.spec.ts` (`@web.brand.link-hover`) | E2E (Playwright, preview build), light + dark | Controls keep their label colour with no underline: hero button, Get it card, sidebar mark, Needs attention client link, About `.btn-secondary`, and `.btn-ghost` (goes to its own `--text`). Text links underline: hero alt, privacy back, Clients name, breadcrumb. An injected unclassed link still takes `--link-hover` and an underline. On /download (since the crash fix): the platform button keeps its colours and the back link underlines |

### Edit a payment from the ledger (MUT-169, added 2026-10-14)
| File | Type | Covers |
|------|------|--------|
| `src/components/drawers/__tests__/PartialPaymentDrawer.test.tsx` › edit intent | Component | One payment opens on its edit (date focused, local-day prefill of a UTC instant); Update closes; Cancel closes; future date refused; several → picker, pencil edits, Update returns to the list with the intent; none → empty state; loading → nothing; failed read → notice + Retry |
| `src/lib/__tests__/stores.test.ts` › intent | Unit | Intent travels with open, kept for the same entry's record edit, dropped for another entry, cleared on close |
| `src/pages/income/__tests__/incomeRows.test.ts`, `IncomePage.test.tsx` › Edit Payment | Unit + Component | `canEditPayment` on paid/part-paid only; the row menu opens the drawer with the intent on paid and part-paid rows, not unpaid |
| `src/components/__tests__/IncomeDrawer.test.tsx` › Edit payment | Component (Dexie) | "Last payment {date}" + Edit Payment up front; hand-over closes the income drawer and opens the payment drawer with the intent; disabled with the hint while dirty; absent on new/unpaid entries; status hint copy |
| `src/lib/__tests__/dates.test.ts` › paymentLocalDay, `utils.test.ts` › formatPaymentDate | Unit | Local day of a UTC instant (Jerusalem, New York); date-only passthrough; date-only shown on its own day west of UTC |
| `src/pages/clients/__tests__/ClientDetailPage.test.tsx` | Component | Client Payments row on its own day west of UTC |
| `src/db/__tests__/paymentRecords.test.ts` › update | Integration (Dexie) | Moving a payment's date re-dates a fully paid entry (stays paid, same received); a part-paid entry stays part-paid |
| `qa/specs/web/record-payment.spec.ts` | E2E (release-qa) | `@web.record-payment.edit-payment-date` (row menu → date focused → Enter updates, never a second payment) and `-rtl` |

### Compact date width (MUT-250, added 2026-10-19)
| File | Type | Covers |
|------|------|--------|
| `src/components/ui/__tests__/CompactDate.test.tsx` (new) | Component | `dd/mm/yyyy` inside `.num` (the tabular figure face) |
| `src/pages/income/__tests__/IncomePage.test.tsx` › compact date | Component | Every compact row's date cell holds a `.num` `dd/mm/yyyy` |
| QA `@web.brand.date-width` (new) | Browser (Playwright, mocked clock) | Income at 375px in Arabic is one width on 11/11, 08/08 and 01/10 |
| QA `@web.brand.layout` | Browser | `Income@375` / `Income drawer@375` caps re-measured to 735px; all 8 cells pass |

**Run (2026-10-19, preview build, Node 22):** a throwaway probe measured 9 dates across the year: 735px on each (it was 718–736px before). Brand, Expenses, Conversions and Income specs: 39/39.

### Plural counts (MUT-179, added 2026-10-19)
| File | Type | Covers |
|------|------|--------|
| `src/lib/i18n/__tests__/pluralCountKeys.test.ts` (new) | Unit | All 18 counted strings are plural objects (en one/other, ar six forms, `{count}` in every numeric form, `{total}`/`{version}` kept); the 14 retired Singular/Plural/One keys are gone; `orphanedRecords.groups` stays; `tp` gives "1 project", "Due in 1d", "متأخر 3 أيام", "متأخر 11 يومًا", "الأقدم 227 يومًا", and words 1 and 2 in Arabic |
| `src/components/home/__tests__/HomeAttentionRow.plurals.test.tsx` (new) | Component (real dictionaries) | "Due in 1d" in EN; 3 and 11 days overdue in the AR few/many forms |
| `src/pages/landing/__tests__/landingMockPlurals.test.tsx` (new) | Component (real dictionaries) | AR Clients mock 3/227/158 days and profile badge 34 days in their forms; no "{n} يوم" past 2; EN stays "oldest 3d" |
| `src/components/expenses/__tests__/RecurringAttentionList.test.tsx` › MUT-179 | Component | AR lateness −3, −11, +3 in few/many forms (/expenses) |
| `src/components/ui/__tests__/RecurringOccurrenceCard.test.tsx` (new, qa-reconcile) | Component (real dictionaries) | Due/overdue in EN one form and AR few/many/two; these branches are unreachable from the ledger today (it passes only projected occurrences) |
| `src/pages/projects/__tests__/ProjectsPage.searchEmpty.test.tsx` › summary strip | Component (real dictionaries) | One project reads "1 project" |
| `YourDataSection`, `OrphanedRecordsBanner`, `OrphanedRecordsDrawer`, `ClientsPage`, `ClientDetailPage`, `ProjectDetailPage`, `IncomePage` tests | Updated | Pick the CLDR form via `pluralKey` instead of the Singular/Plural keys; the "label: {count}" Arabic workaround test now asserts few ≠ many; i18n mocks also mock `plural` |
| QA `@web.home.attention-day-plurals`, `@web.clients.count-plurals`, `@web.landing.arabic-day-counts` | Browser (Playwright) | EN and AR on Home, Clients and the landing page with real day counts |
| QA `@web.businesses.shared-client`, `@web.data.older-backup` | Updated | They asserted the old wording ("D1 entries", "1 uploaded receipt files", "1 receipts exported"); now the singular |

**Run (2026-10-19, preview build, Node 22):** full web QA suite, 133/135 passed. The 2 failures are `@web.brand.layout` at 375px in Arabic, light and dark: Income measures 727px against the 726px `KNOWN_OVERFLOW` cap. That is MUT-250, already measured on main on 2026-10-16. What's New needs `MUTABA3A_APP_VERSION` set to a version with notes (0.1.10 used here).

### Craft-fix bundle (MUT-92, added 2026-10-14)
| File | Type | Covers |
|------|------|--------|
| `src/components/__tests__/IncomeDrawer.test.tsx` › currency follows the client (MUT-92) | Integration (real Dexie) | Opens in the client's newest income currency and saves it; profile currency for a client with no income; switches on a typeahead pick; a user-picked currency sticks; newest by `occurredAt`, deleted + expense ignored, archived counts; edit and duplicate keep their own currency |
| `src/styles/__tests__/layering.test.ts` | Unit (node, CSS) | Drawer above its overlay; `.demo-banner` above content (100) and below `.drawer-overlay` |
| `src/components/ui/__tests__/RecordPaymentButton.test.tsx` | Component | Text is "Record Payment ₪3,550" with the accessible name unchanged |
| `src/components/filters/__tests__/DateRangeControl.test.tsx` | Component | All Time shows no range (no 2000/2100); This month keeps its range |
| `src/pages/clients/__tests__/ClientDetailPage.test.tsx` › Payments | Component | Entry-saved row has empty notes and opens the entry; migration note hidden; user note shown under Notes; no Notes column without notes |
| `src/pages/expenses/__tests__/ExpensesLedgerPage.test.tsx` | Component | Row amounts have no minus sign, flat and by-category |
| `src/lib/__tests__/utils.test.ts` › formatRelativeDate | Unit | Today/Yesterday keys; EN one/other across day/week/month/year; AR one/two/few/many forms match `Intl.RelativeTimeFormat('ar')` and differ |
| `src/lib/i18n/__tests__/craftFixKeys.test.ts` | Unit | EN + AR: no "Mini CRM", About name, Today/Yesterday kept, retired keys gone |

### Brand chrome (MUT-104, added 2026-10-13)
| File | Type | Covers |
|------|------|--------|
| `scripts/__tests__/brand-head.test.ts` | Unit (node) | Both heads' icon links resolve at their sizes; theme-color = token canvases; no manual manifest; portal links `./public/` copies; every `favicon.svg` class styled, dark rule, no C2PA; desktop icons present at their sizes, `icons:desktop` source, no mobile leftovers |
| `scripts/__tests__/vite-config.test.ts` › PWA manifest, social preview | Unit (node) | Manifest colours = tokens; icons/include assets exist at size; OG/Twitter tags from the Arabic hero, absolute https card at its real size, origin validation, web-only plugin, cards not precached |
| `src/components/brand/__tests__/BrandMark.test.tsx` | Component | Light/Dark/System (live OS change), toggle press, decorative + sized |
| `src/lib/theme/__tests__/themeColorMeta.test.tsx` | Component | theme-color follows explicit Light/Dark, System restores, no-meta page |
| `SidebarNav.brand.test.tsx`, `src/hosted/components/__tests__/Brand.test.tsx` | Component (regression, R6) | Home link + accessible name, collapsed keeps the mark, theme-aware mark; portal name in EN/AR with a decorative mark |
| Manual (TD-118) | — | macOS Dock (Tahoe), Windows taskbar + MSI/NSIS, OG debugger after deploy, iOS Add to Home Screen |

### Existing Test Files (Updated 2026-03-14)

#### Repository & Unit Tests
| File | Type | Tests | Coverage |
|------|------|-------|----------|
| `src/db/__tests__/transactionRepo.test.ts` | Unit | 37 | **Full** - CRUD, filters, totals, attention |
| `src/db/__tests__/clientRepo.test.ts` | Unit | 22 | **Full** - CRUD, summaries |
| `src/db/__tests__/projectRepo.test.ts` | Unit | 24 | **Full** - CRUD, summaries |
| `src/db/__tests__/businessProfileRepo.test.ts` | Unit | 16 | Full - CRUD, defaults |
| `src/db/__tests__/documentRepo.test.ts` | Unit | 35 | Full - CRUD, sequences, locking |
| `src/db/__tests__/settingsRepo.test.ts` | Unit | 16 | Full - settings, FX rates, categories |
| `src/db/__tests__/aggregations.test.ts` | Unit | 27 | **Full** - pure aggregation functions |
| `src/features/documents/__tests__/totals.test.ts` | Unit | 20 | Full - calculations |
| `src/features/documents/__tests__/pdf.test.ts` | Unit | 24 | Full - PDF text utilities |

#### Optional areas / Advanced features (MUT-12, added 2026-10-10)
| File | Type | Tests | Coverage |
|------|------|-------|----------|
| `src/lib/features/__tests__/features.test.ts` | Unit | 9 | **Full** - vocabulary snapshot, defaults, tolerant resolver, `withFeature`, probe map |
| `src/lib/features/__tests__/featureDataProbes.test.ts` | Unit | 8 | **Full** - per-table probes, soft-deleted vs archived rows, vendors → expenses, insights never, db vs transaction |
| `src/lib/features/__tests__/reconcile.test.ts` | Unit | 9 | **Full** - enabling-only, no-op when nothing new, notice merge, row creation, swallowing wrapper |
| `src/lib/features/__tests__/useFeatures.test.tsx` | Hook | 8 | **Full** - loading → off, stored flags, full-map write + immediate effect, notice dismiss, `readFeatureFlags` |
| `src/lib/features/__tests__/i18nParity.test.ts` | Unit | 2 | en + ar carry every `settings.features.*` key |
| `src/db/__tests__/migration-v20.test.ts` | Migration | 5 | **Full** - real v19 → v20 open on a named DB: data → flags + notice, no row → created, nothing → untouched, fresh → all off |
| `src/db/__tests__/settingsRepo.test.ts` (extended) | Unit | +5 | resolved defaults, pre-v20 row, persistence, notice clear, seed = defaults |
| `src/db/__tests__/migration-safety.test.ts` (extended) | Unit | +1 | restore of a pre-v20 backup switches the area on |
| `src/components/modals/__tests__/ImportExportModals.test.tsx` (extended) | Component | +0 (assertions) | legacy import enables projects + notice |
| `src/components/ui/__tests__/Switch.test.tsx` | Component | 5 | **Full** - role/aria, click/Space/Enter, other keys, disabled |
| `src/pages/settings/__tests__/AdvancedFeaturesSection.test.tsx` | Component | 4 | **Full** - six switches in order, stored flags, on, off |
| `src/components/layout/__tests__/FeatureNoticeBanner.test.tsx` | Component | 2 | **Full** - names areas, link, clears only on dismiss (StrictMode), nothing without notice |

Still manual: RTL check of the `Switch` knob direction and the banner layout at 375px; the real upgrade on a long-lived database (v16 → v20 chain).

#### Orphaned-records banner copy (added 2026-10-11)
| File | Type | Tests | Coverage |
|------|------|-------|----------|
| `src/components/layout/__tests__/OrphanedRecordsBanner.test.tsx` | Component | 5 | en + ar × 1 and 8 records: message from `integrity.*` with `{count}` filled, no raw key or `{count}` left, translated link and dismiss label, no "Translation missing" warning; exact English sentences for 1 and 8 |

`tsc -b` also guards the section: `integrity` is required in `Translations`, so
removing it from either locale file fails the `as Translations` cast in
`context.tsx`. Not run on this change: the full `npx vitest run` (stopped on
request; only this file was run). Still manual: the banner in RTL.

#### Unassigned records: Review now opens a drawer in place (added 2026-10-11)
| File | Type | Tests | Coverage |
|------|------|-------|----------|
| `src/db/__tests__/orphanedRecords.test.ts` | Unit (real Dexie) | 16 | **Full** - `findOrphanedRecords`: empty, one of each kind vs assigned, archived/soft-deleted skipped, profile maps hold assigned rows only, client names; same ids as `runIntegrityCheck`. `startingProfileId`: client none, project → client, income/expense → client then project, no links, non-selectable profile skipped |
| `src/components/drawers/__tests__/OrphanedRecordsDrawer.test.tsx` | Component (real Dexie) | 14 | store open/close; groups with counts, empty groups hidden, untitled income named after its client with date and amount; one profile: no pickers, assign all writes four kinds + toast + close; several: rows start on linked client's profile, per-row Save, quick action ignores pickers; locked income fails, others saved, row stays with alert; no profiles; nothing left; Cancel writes nothing; Arabic copy; en/ar key parity and placeholders |
| `src/components/layout/__tests__/OrphanedRecordsBanner.test.tsx` (extended) | Component | 7 (+2) | Review now is a `type="button"`, no `<a href>` in the banner; click opens the drawer store, URL unchanged |
| `src/pages/clients/__tests__/ClientsPage.test.tsx`, `src/pages/projects/__tests__/ProjectsPage.test.tsx` (extended) | Page | +1 each | an unassigned client/project no longer opens a dialog |
| `src/db/__tests__/integrityCheck.test.ts` | Unit | 6 (unchanged) | still green on the shared `isOrphaned` predicates |

Removed: `src/components/modals/__tests__/OrphanedRecordsModal.test.tsx` (10),
with the modal. Full suite after merging main (with MUT-8, f210b31): 139 files,
2,306 passed, 5 skipped. Checked by hand in the web dev build: no URL change or reload on
Review now, Arabic/RTL drawer, Save clears the banner. Not covered:
`AppShell` mounting the drawer (no AppShell test exists; covered by the manual run).

#### Settings › Data Tools copy (added 2026-10-11)
| File | Type | Tests | Coverage |
|------|------|-------|----------|
| `src/pages/settings/__tests__/DataToolsSection.test.tsx` | Component | 24 | en + ar: heading, row and button labels; clean run (result line + success toast); 1, 3 and 12 issues mixing orphaned and broken references (singular/plural line + toast); a failed check, both returned `error` and thrown, shows the failure toast, not "0 issues"; backup toast, success and failure; restore toast for 1 and 57 records with the backup version; failed restore wrapped in `settings.data.importFailed`. Each test also checks for no raw key or `{placeholder}` left and no "Translation missing" warning. Plus exact English sentences, and a check that Arabic plural templates are "label: {count}" |

`tsc -b` guards the keys (`integrity.*` and the Data Tools keys under
`settings` are required in `Translations`). The full suite passed on the
branch as first written on `d2a050d` (135 files, 2230 passed, 5 skipped). It
was not re-run, on request, after an `eslint-disable-next-line` comment was
added to the new test or after the rebase onto main with MUT-7 and MUT-15
(no overlap in `src/pages/settings` or the i18n keys; lint and `tsc -b` pass). The restore tests print jsdom's
"Not implemented: navigation" because `Location.reload` can't be stubbed.
Still manual: the Data Tools row in RTL.

#### Release tooling (added 2026-10-11)
| File | Type | Tests | Coverage |
|------|------|-------|----------|
| `server/src/scripts/__tests__/deploy-bootstrap.test.ts` | Unit (bash via fake `terraform`) | 4 | **Full** - deploy.sh step 0 helper (ADR-161): skip when all four bootstrap addresses are in state; apply exactly the four targets when one is missing; apply with no state at all; exact-address match (`api` vs `api_readonly`) |
| `scripts/__tests__/release-files.test.ts` | Unit + contract | 7 | **Full** - each manifest staged with its lockfile; `RELEASE_COMMIT_FILES` equals deploy.sh `tag_and_push`'s `git add` (parsed from the script); porcelain partition: unstaged/staged/both columns, untracked, rename destination, leading-space first line, clean tree |
| `scripts/__tests__/before-release.test.ts` | Unit (bash) | 13 | **Full** - target items only, none/no section, never blocks; restore drill (MUT-327): never run, ≤ 60 days quiet, > 60 days names the date, newest of several, only the Drill results section counts, counted with the listed steps, server only, no runbook; the real runbook has the `Drill date (UTC)` row |

`vitest.config.ts` includes `scripts/**/*.{test,spec}.ts` for this. Still manual
(no unit seam): `update_version` / `writeVersionFiles` bumping
`package-lock.json`, and the release commit's contents. Both were dry-run on
2026-10-11 in a local clone with `origin` removed, so `tag_and_push` committed
and then failed at the push.

#### Expenses collapse (MUT-14, added 2026-10-10)
| File | Type | Tests | Coverage |
|------|------|-------|----------|
| `src/pages/expenses/__tests__/ExpensesLedgerPage.test.tsx` (fixed, +1) | Page | 19 | MUT-20 green; no-profile branch pinned |
| `src/lib/__tests__/zipExport.test.ts` | Unit | 3 | **Full** - folders per profile/month, duplicate names, empty refusal |
| `src/lib/features/__tests__/legacyRedirects.test.ts` | Structural | 8 | every deleted path redirects to `/expenses` with no component |
| `src/__tests__/noDeadExpenseModules.test.ts` | Guard | 15 | deleted pages/modules stay deleted; barrels trimmed |
| `src/db/__tests__/retainedMonthCloseSchema.test.ts` | Retention | 3 | table kept, rows round-trip backup/restore |
| `src/lib/features/__tests__/expensesGatingDataSafety.test.ts` | Data safety | 2 | switch inert; receipts/vendors/rules/month-close survive backup → clear → restore |
| removed with their pages | — | — | `ExpensesPage`, `ProfileExpensesPage`, `ExpensesOverviewPage` tests; `forecastCalculations`, `matchingAlgorithm` tests; vendor-match and rule-history cases |

Still manual: RTL on the surviving ledger; the receipts ZIP opened in Finder; a real `/expenses/overview` bookmark landing on the ledger.

#### Gated areas (MUT-13, added 2026-10-10)
| File | Type | Tests | Coverage |
|------|------|-------|----------|
| `src/lib/features/__tests__/routeGuard.test.ts` | Unit | 5 | **Full** - redirect when off, pass when on, custom target, pre-v20 row, re-read per navigation |
| `src/__tests__/router.gates.test.ts` | Structural | 10 | gated routes carry `beforeLoad`, core routes do not |
| `src/components/layout/__tests__/SidebarNav.features.test.tsx` | Component | 4 | **Full** - no section when off, Documents only, both in order, appears on toggle |
| `src/pages/clients/__tests__/ClientDetailPage.test.tsx` (extended) | Page | +5 | invoice actions off/on (generate, view), retainers card off/on |
| `src/components/drawers/__tests__/IncomeDrawer.locked.test.tsx` | Component | 5 | **Full** - lock notice off/on, unlocked, forced submit writes nothing, repository refuses update and delete |
| `src/db/__tests__/transactionRepo.test.ts` (extended) | Unit | +1 | `softDelete` refuses a locked transaction |
| `src/components/home/__tests__/AttentionFeed.features.test.tsx` | Component | 2 | guidance asked without/with projected retainers |
| `src/lib/features/__tests__/gatingDataSafety.test.ts` | Unit | 2 | toggling leaves documents/sequences/retainers intact; auto-enable → guard admits |

Still manual: RTL check of the "More" section and the locked notice; a real navigation to `/documents` while off (redirect with no flash) in the browser.

#### Gated areas, part 2 (MUT-16, added 2026-10-10)
| File | Type | Tests | Coverage |
|------|------|-------|----------|
| `src/__tests__/router.gates.test.ts` (extended) | Structural | +4 gated | `/insights`, `/planning`, `/projects`, `/projects/$projectId` carry `beforeLoad` |
| `src/lib/features/__tests__/legacyRedirectsCore.test.ts` | Structural | 2 | `/reports` → `/insights` with every area off, then the insights gate bounces home; `/transactions` → `/income` forwards search |
| `src/components/layout/__tests__/SidebarNav.features.test.tsx` (extended) | Component | +3 | none of the three while off and no `+ Add → Project`; Projects in "More" + `+ Add` while on; Insights then Planning after Retainers |
| `src/pages/clients/__tests__/ClientDetailPage.test.tsx` (extended) | Page | +2 | projects off: no Projects tab, no + Project, project name on the work list as text; on: tab present |
| `src/components/__tests__/IncomeDrawer.test.tsx` (extended) | Component | +3 | no project field off; field on; edit keeps `projectId` while hidden (real Dexie round-trip) |
| `src/components/onboarding/__tests__/OnboardingOverlay.projects.test.tsx` | Component | 6 | **Full** - step auto-completes without an entity while off (from the project step and from client → project), untouched while on, untouched while flags load, `onComplete` not called by the skip, income step opens without a stale `defaultProjectId` |
| `src/__tests__/router.gateKeys.test.ts` | Structural | 30 | each of the ten gated routes reads its own key: redirects with all off, admits with only its key, redirects with every key but its own |
| `src/components/__tests__/ExpenseDrawer.projectField.test.tsx` | Component | 3 | no field off; field on; edit keeps `projectId` and `categoryId` while hidden |
| `src/components/__tests__/RetainerDrawer.projectField.test.tsx` | Component | 2 | picker off / on |

Still manual: a real navigation to `/projects` while off in the browser (redirect with no flash); the onboarding card on a fresh install showing step 2 as done (TD-027); RTL check of the longer "More" section.

#### Hook & Component Tests
| File | Type | Tests | Coverage |
|------|------|-------|----------|
| `src/hooks/__tests__/useQueries.test.tsx` | Integration | 29 | Partial - business profile + document + payment-record hooks; fresh-install `null` case for the default profile; missing-row `null` case for the seven by-id hooks |
| `src/hooks/__tests__/useExpenseQueries.test.tsx` | Unit (mocked repos) | 6 | `useExpense`, `useRecurringRule`: found row, empty id, missing row → `null` |
| `src/hooks/__tests__/useRetainerQueries.test.tsx` | Unit (mocked repos) | 3 | `useRetainer`: found row, empty id, missing row → `null` |
| `src/hooks/__tests__/usePlanQueries.test.tsx` | Unit (mocked repos) | 12 | `usePlan`, `usePlanAssumption`, `usePlanScenario`, `usePlanDefaultScenario`: found row, empty id, missing row → `null` |
| `src/components/__tests__/BusinessProfileDrawer.test.tsx` | Component | 8 | Basic - form rendering |
| `src/components/__tests__/ClientDrawer.test.tsx` | Component | 10 | Full - Client drawer with profile selector |
| `src/components/__tests__/ProjectDrawer.test.tsx` | Component | 13 | **Full** - Project drawer with profile selector |
| `src/components/__tests__/UpdateBanner.test.tsx` | Component | 11 | **Full** - Update banner states |
| `src/hooks/__tests__/useTauriUpdater.test.ts` | Unit | 8 | **Full** - Tauri updater hook |
| `src/lib/__tests__/updater-config.test.ts` | Contract | 2 | **Full** - compiled-in updater pubkey equals the canonical BEDF931CA1D6C777 key, asserted from the key bytes (MUT-49, ADR-031) |
| `src/lib/__tests__/updater-capabilities.test.ts` | Contract | 2 | **Full** - `capabilities/default.json` grants `updater:default` and `process:allow-restart` (MUT-99) |

#### Page Component Tests (Added 2026-03-14)
| File | Type | Tests | Coverage |
|------|------|-------|----------|
| `src/pages/clients/__tests__/ClientsPage.test.tsx` | Page | 33 | **70.08%** - Sorting, search, multi-currency |
| `src/pages/clients/__tests__/ClientDetailPage.test.tsx` | Page | 34 | Rewritten for MUT-3: three sections, empty states, MUT-6/13/16 gates |
| `src/pages/projects/__tests__/ProjectsPage.test.tsx` | Page | ~40 | **73.03%** - Projects list |
| `src/pages/projects/__tests__/ProjectDetailPage.test.tsx` | Page | ~30 | Partial - Project detail |
| `src/pages/income/__tests__/IncomePage.test.tsx` | Page | 30 | **~90%** - Income ledger, filters, interactions |
| `src/pages/expenses/__tests__/ExpensesPage.test.tsx` | Page | ~40 | **95.65%** - Expense profiles overview |
| `src/pages/expenses/__tests__/ExpensesOverviewPage.test.tsx` | Page | 29 | **100%** - Monthly breakdown |
| `src/pages/expenses/__tests__/ProfileExpensesPage.test.tsx` | Page | 26 | **65.13%** - Profile-specific expenses |
| `src/pages/expenses/__tests__/ExpensesLedgerPage.test.tsx` | Page | ~60 | **67.24%** - Expense ledger |

**Total: 1,771 tests passing (7 skipped, 1 failing in IncomeDrawer - unrelated)**

### Coverage by Module (Updated 2026-03-14)

| Module | Current | Target | Status | Notes |
|--------|---------|--------|--------|-------|
| `src/db/` | **~85%** | 90% | ✅ Excellent | Core repos fully tested |
| `src/pages/clients/` | **70.08%** | 70% | ✅ **TARGET MET** | 33 tests, sorting, search, multi-currency |
| `src/pages/projects/` | **73.03%** | 70% | ✅ **EXCEEDED** | Projects list & detail |
| `src/pages/income/` | **~90%** | 90% | ✅ **TARGET MET** | 30 tests, ledger, filters, interactions |
| `src/pages/expenses/` | **~80%** | 70% | ✅ **EXCEEDED** | 4 expense pages tested (67-100% each) |
| `src/hooks/` | ~25% | 80% | 🔄 In Progress | Business profile + document hooks tested |
| `src/components/` | ~15% | 70% | 🔄 In Progress | UpdateBanner, BusinessProfileDrawer tested |
| `src/lib/` | ~10% | 90% | ⏳ Pending | Needs utils tests |
| `src/features/` | ~40% | 80% | 🔄 In Progress | Document calculations tested |
| **Overall** | **~65%** | **80%** | 🔄 **Good Progress** | Core pages meet targets |

---

## Test Categories

### 1. Unit Tests

**Scope**: Pure functions, utilities, repository methods.

**Files**:
```
src/
├── db/__tests__/
│   ├── repository.test.ts       # CRUD operations
│   ├── clientRepo.test.ts       # Client-specific
│   ├── transactionRepo.test.ts  # Transaction-specific
│   └── aggregations.test.ts     # Aggregation functions
├── lib/__tests__/
│   ├── utils.test.ts            # Format, parse utilities
│   └── matchingAlgorithm.test.ts # Retainer matching
└── services/oauth/__tests__/    # Malafat OAuth client (moved from sync/ by MUT-73)
```

**Example**:
```typescript
// src/lib/__tests__/utils.test.ts
import { formatAmount, parseAmountToMinor, todayISO } from '../utils';

describe('formatAmount', () => {
  it('formats USD correctly', () => {
    expect(formatAmount(1999, 'USD')).toBe('$19.99');
  });

  it('formats ILS correctly', () => {
    expect(formatAmount(1999, 'ILS')).toBe('₪19.99');
  });

  it('handles zero', () => {
    expect(formatAmount(0, 'USD')).toBe('$0.00');
  });

  it('handles negative amounts', () => {
    expect(formatAmount(-1999, 'USD')).toBe('-$19.99');
  });
});

describe('parseAmountToMinor', () => {
  it('converts decimal to cents', () => {
    expect(parseAmountToMinor('19.99')).toBe(1999);
  });

  it('handles integers', () => {
    expect(parseAmountToMinor('20')).toBe(2000);
  });

  it('returns 0 for invalid input', () => {
    expect(parseAmountToMinor('abc')).toBe(0);
  });
});
```

---

### 2. Integration Tests

**Scope**: Hooks with repository, component interactions.

**Files**:
```
src/
├── hooks/__tests__/
│   ├── useQueries.test.tsx      # Query hooks
│   ├── useTransactions.test.tsx # Transaction hooks
│   └── useFilters.test.tsx      # Filter state
└── components/__tests__/
    ├── drawers/
    │   ├── TransactionDrawer.test.tsx
    │   └── ClientDrawer.test.tsx
    └── filters/
        ├── DateRangeControl.test.tsx
        └── SearchInput.test.tsx
```

**Test Setup**:
```typescript
// src/test/setup.ts
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/lib/i18n/context';

export function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          {children}
        </LanguageProvider>
      </QueryClientProvider>
    );
  };
}
```

**Example**:
```typescript
// src/hooks/__tests__/useTransactions.test.tsx
import { renderHook, waitFor } from '@testing-library/react';
import { useTransactions, useCreateTransaction } from '../useQueries';
import { createWrapper } from '@/test/setup';
import { db } from '@/db/database';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('useTransactions', () => {
  it('returns empty array initially', async () => {
    const { result } = renderHook(() => useTransactions({}), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual([]);
  });

  it('returns transactions after creation', async () => {
    const wrapper = createWrapper();

    // Create a transaction
    const { result: createResult } = renderHook(
      () => useCreateTransaction(),
      { wrapper }
    );

    await act(async () => {
      await createResult.current.mutateAsync({
        kind: 'income',
        amountMinor: 1999,
        currency: 'USD',
        status: 'paid',
        occurredAt: '2024-01-15',
      });
    });

    // Query transactions
    const { result: queryResult } = renderHook(
      () => useTransactions({}),
      { wrapper }
    );

    await waitFor(() => {
      expect(queryResult.current.data?.length).toBe(1);
    });
  });
});
```

---

### 3. Component Tests

**Scope**: UI components in isolation with mocked data.

**Files**:
```
src/components/__tests__/
├── ui/
│   ├── Button.test.tsx
│   ├── Input.test.tsx
│   ├── Badge.test.tsx
│   └── Modal.test.tsx
├── tables/
│   ├── DataTable.test.tsx
│   ├── CellAmount.test.tsx
│   └── CellStatus.test.tsx
└── layout/
    ├── SidebarNav.test.tsx
    └── TopBar.test.tsx
```

**Example**:
```typescript
// src/components/__tests__/ui/Button.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '../../ui/Button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('disables when disabled prop is true', () => {
    render(<Button disabled>Submit</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('shows loading spinner when isLoading', () => {
    render(<Button isLoading>Submit</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
  });

  it('applies variant classes', () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn-danger');
  });
});
```

---

### 4. E2E Tests (Planned)

> The live suite is `qa/specs/web/*.spec.ts`, run via `release-qa` (`make check-e2e`; MUT-97, 2026-10-12). It replaced `e2e/*.spec.ts`, listed under "E2E port-over" below — that section is now history, not the current location. This section (the examples that follow) was always the original aspirational plan, never implemented as written.

**Scope**: Full user flows from UI to database.

**Tool**: Playwright (recommended for cross-browser)

**Files**:
```
e2e/
├── flows/
│   ├── transaction.spec.ts      # CRUD transactions
│   ├── invoice.spec.ts          # Generate invoice
│   ├── demo-mode.spec.ts        # Demo mode toggle
│   └── export-import.spec.ts    # Data backup
├── pages/
│   ├── overview.spec.ts
│   ├── transactions.spec.ts
│   └── documents.spec.ts
└── playwright.config.ts
```

**Example**:
```typescript
// e2e/flows/transaction.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Transaction Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/');
  });

  test('creates a new income transaction', async ({ page }) => {
    // Open create drawer
    await page.click('text=+ Add');
    await page.click('text=Income');

    // Fill form
    await page.fill('[name="amountMinor"]', '100');
    await page.selectOption('[name="currency"]', 'USD');
    await page.fill('[name="occurredAt"]', '2024-01-15');

    // Submit
    await page.click('text=Save');

    // Verify toast
    await expect(page.locator('.toast-success')).toBeVisible();

    // Verify in list
    await page.goto('/app/transactions');
    await expect(page.locator('text=$100.00')).toBeVisible();
  });

  test('marks transaction as paid', async ({ page }) => {
    // Navigate to transactions
    await page.goto('/app/transactions');

    // Click row menu
    await page.click('[data-testid="row-actions"]');
    await page.click('text=Mark as Paid');

    // Verify status change
    await expect(page.locator('.status-badge-paid')).toBeVisible();
  });
});
```

---

## MUT-91 — portal press feedback and after-save (added 2026-10-14)

| Area | Tests | Proves |
|---|---|---|
| Press CSS | `src/styles/__tests__/pressFeedback.test.ts` | one `:is(.btn,.press):active` rule on `scale: var(--press-scale)`; `.btn` transitions `scale`; no `transform: scale(var(--press-scale))` anywhere; reduced motion zeroes the tokens |
| Portal buttons | `src/hosted/pages/__tests__/pressFeedback.test.tsx` | every button in the signed-in shell (open menus, a payments row) and on sign-in carries `btn` or `press` (tabs exempt) |
| Row tint CSS | `src/styles/__tests__/rowFlash.test.ts` | `tr.row-flash > td` (any table), rail mirrored under `[dir="rtl"]`, reduced motion holds the tint |
| Store | `src/lib/__tests__/savedFlashStore.test.ts` (+5) | backstop waits for a fetching list; a late row still claims; a late no-match resolves then; a quiet settled list doesn't hold resolution after the backstop; `settleMessage` is identity-guarded |
| Portal after-save | `src/hosted/pages/__tests__/afterSave.test.tsx`, `src/hosted/components/__tests__/SavedNotice.test.tsx` | visible save tints + "Saved"; hidden save → notice → Show anchors (`anchor=`, no cursor) → tint → "Show latest"; edit tints; delete nothing; conversions both ways; other profile/kind ignored; notice settles on timeout/unmount/Show |
| Drawer reuse (AC1) | `src/hosted/components/__tests__/Drawer.test.tsx` (+2) | the portal Drawer is `DrawerFrame`; no portal source builds its own dialog; close presses |
| Lint boundary | `scripts/__tests__/hosted-lint.test.ts` (+1) | portal may import `lib/useSavedFlash`, not `hooks/useSavedFlash` |
| Bundles (AC2) | `scripts/__tests__/check-bundles.test.ts` (+2), `npm run test:bundles` | no app profile store / Show route in dist-hosted; no `hp-toast` in dist-web/desktop |
| Server anchor | `server/src/repositories/__tests__/store-contract-{expenses,conversions}.ts` (+1 each, memory + Prisma), `server/src/__tests__/routes-{expenses,conversions}.test.ts` (+2 each) | inclusive start with a same-day tie, exclusive continuation, filters apply, 422 with cursor, 404 unknown/deleted/other org, 422 non-uuid |
| MUT-43 (AC3) | `src/hosted/session/__tests__/auth-states.test.tsx` | unchanged byte-for-byte, green |
| Browser | throwaway Playwright on preview builds | toggle 0.96 with translate kept; app Button 0.96; AR hidden save (1.6s refetch) → notice → Show → anchored, tinted, rail on the right |

## MUT-109 — direction from `<html dir>` and the `dir` attribute (added 2026-10-19)

| Area | Tests | Proves |
|---|---|---|
| CSS guard | `src/styles/__tests__/direction.test.ts` | no rule in any `src/**/*.css` declares `direction` on a `:lang()` selector |
| Site ratchet | same file | every `dir="ltr|rtl|auto"` in `src/**/*.tsx` matches `DIR_SITES` (45 on 2026-10-19, by file and count); no `dir={…}`; the seven amount files wrap the amount in a plain `<bdi>` |
| Amount markup | `OwedNowSummary`, `format` (DecimalAmount), `ClientsPage`, `ClientDetailPage`, `HomeAttentionRow.plurals`, `OrphanedRecordsDrawer` tests | the amount is a `<bdi>` with no `dir`; the Arabic string starts with RLM |
| Field markup | `ConversionDrawer`, `PartialPaymentDrawer`, `RecordPaymentDrawer` tests (+ existing pins in `IncomeDrawer`, `ExpenseFormFields`, hosted `ExpenseDrawer`, `ConversionDrawer`, `IncomeCaptureDrawer`, `SetupPage`, `HostedOfferPage`) | amount and LTR inputs carry `dir="ltr"` |
| Browser | `qa/specs/web/direction.spec.ts` (`@web.direction.*`), `qa/specs/portal/direction.spec.ts` (`@portal.direction.*`) | Arabic amounts read `$US 1,300` / `₪ 1,500.00` on screen with no `dir`; the FX formula, emails, payment and invoice numbers compute `ltr`; LTR fields sit on the right in Arabic; English unchanged; the Arabic business name is `rtl` in English. Red on main, green on the branch (preview builds) |
| Before/after | throwaway capture on preview builds of main and the branch | 0 changed pixels on the income and payment drawers, the local and portal expense forms, portal sign-in, Home, Clients and the client profile (a 3 px Add-button edge also differs between two runs of main) |

## Critical Test Scenarios

### Must-Have Coverage (Updated 2026-02-09)

| Scenario | Type | Priority | Status |
|----------|------|----------|--------|
| Create transaction | Unit | P0 | ✅ Done |
| Mark transaction paid | Unit | P0 | ✅ Done |
| Create client | Unit | P0 | ✅ Done |
| Create project | Unit | P0 | ✅ Done |
| Generate invoice PDF | E2E | P0 | ⏳ Pending |
| Lock document on export | Unit | P0 | ✅ Done |
| Demo mode toggle | E2E | P1 | ⏳ Pending |
| Data export | E2E | P1 | ⏳ Pending |
| Data import | E2E | P1 | ⏳ Pending |
| Filter transactions | Unit | P1 | ✅ Done |
| Multi-currency totals | Unit | P1 | ✅ Done |
| Overdue calculation | Unit | P1 | ✅ Done |
| Client summaries | Unit | P1 | ✅ Done |
| Project summaries | Unit | P1 | ✅ Done |
| Aggregation functions | Unit | P1 | ✅ Done |
| Settings CRUD | Unit | P2 | ✅ Done |
| Category CRUD | Unit | P2 | ✅ Done |
| Retained tables survive a UI removal (ADR-029) | Unit | P0 | ✅ Done |

### Edge Cases

| Case | Test Type |
|------|-----------|
| Empty state (no data) | Component |
| Large dataset (1000+ rows) | Performance |
| Invalid form input | Component |
| Network offline | E2E |
| Browser back/forward | E2E |
| RTL layout (Arabic) | Visual |

---

## Running Tests

### Commands

```bash
# Watch mode (development)
npm run test

# Single run
npm run test:run

# With coverage
npm run test:coverage

# Specific file
npm run test -- src/db/__tests__/repository.test.ts

# Pattern match
npm run test -- -t "creates a transaction"

# E2E (release-qa kit; MUT-97)
release-qa run --attach   # against a dev server you already started
release-qa release        # isolated worktree + its own dev server + recorded review page
make check-e2e            # the latter, wired for local/CI use

# Timezone matrix -- runs the suite west of UTC (America/New_York)
npm run test:tz
```

### Timezone discipline (ADR-022)

`vitest.config.ts` pins `TZ`, defaulting to `Asia/Jerusalem` (the primary user
timezone, and it observes DST). Before this was pinned, results depended on the
developer's machine: the suite showed 22 failures in `Asia/Jerusalem` and 29 in
`America/New_York`, hiding 7 latent timezone bugs including 3 in
`getDaysUntil`'s own tests.

Rules for any date-sensitive test:

- Pin the clock. `vi.useFakeTimers({ shouldAdvanceTime: true })` plus
  `vi.setSystemTime(...)`. `shouldAdvanceTime` is required or Testing Library's
  `waitFor` deadlocks.
- Express fixture dates relative to the pinned clock, not as literals with an
  explanatory comment. `IncomePage.test.tsx` hardcoded March 2026 dates and
  rotted silently as the calendar advanced (MUT-21).
- Assert the boundaries explicitly: due yesterday, due today, due tomorrow, no
  due date, paid-but-past-due.
- Run `npm run test:tz` before landing anything that touches dates.

### CI Configuration

```yaml
# .github/workflows/ci.yml
test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
    - run: npm ci
    - run: npm run test:coverage
    - uses: codecov/codecov-action@v3
```

---

## Coverage Goals by Phase

### Phase 1 (Immediate) - ✅ COMPLETED 2026-02-09
- [x] Repository tests: 85% coverage
- [x] Core page tests: 70% coverage ✅ Achieved
- Target: 50% overall ✅ Achieved ~65%

### Phase 2 (Short-term) - ✅ COMPLETED 2026-03-14
- [x] Page component tests: 70%+ coverage for core pages
  - [x] ClientsPage: 70.08% (33 tests)
  - [x] ProjectsPage: 73.03% (40+ tests)
  - [x] IncomePage: ~90% (30 tests)
  - [x] ExpensesPage: 95.65% (40+ tests)
  - [x] ExpensesOverviewPage: 100% (29 tests)
- [x] All page tests passing
- Target: 65% overall ✅ **ACHIEVED**

### Phase 3 (Next Priority)
- [ ] Hook tests: 80% coverage
- [ ] Core component tests (drawers, tables)
- [ ] Utility tests: 90% coverage
- Target: 75% overall

### Phase 4 (Medium-term)
- [ ] E2E setup with Playwright
- [ ] Critical flow tests
- Target: 80% overall

### Phase 5 (Ongoing)
- [ ] Visual regression tests
- [ ] Performance benchmarks
- Target: Maintain 80%+

---

## Test Data Fixtures

### Location
```
src/test/
├── fixtures/
│   ├── clients.ts       # Sample clients
│   ├── projects.ts      # Sample projects
│   ├── transactions.ts  # Sample transactions
│   └── documents.ts     # Sample documents
└── factories/
    ├── clientFactory.ts
    ├── transactionFactory.ts
    └── documentFactory.ts
```

### Example Factory
```typescript
// src/test/factories/transactionFactory.ts
import type { Transaction } from '@/types';

let idCounter = 0;

export function createTransaction(
  overrides: Partial<Transaction> = {}
): Transaction {
  const now = new Date().toISOString();
  return {
    id: `test-tx-${++idCounter}`,
    kind: 'income',
    status: 'paid',
    amountMinor: 10000,
    currency: 'USD',
    occurredAt: now.split('T')[0],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function createTransactions(count: number): Transaction[] {
  return Array.from({ length: count }, () => createTransaction());
}
```

---

## Best Practices

### Do
- Use `fake-indexeddb` for database tests
- Mock external dependencies (PDF generation)
- Test error states and edge cases
- Use factories for test data
- Keep tests focused and fast

### Don't
- Don't test implementation details
- Don't mock React Query internals
- Don't write flaky async tests
- Don't depend on test order
- Don't test third-party libraries

### MUT-28 — OAuth client for Malafat workspaces

| Area | File | Coverage |
|---|---|---|
| PKCE S256 | `src/services/oauth/__tests__/oauth-pkce.test.ts` (moved from `src/sync/transport/` by MUT-73) | RFC 7636 Appendix B vector, charset/length bounds, no `plain` |
| Authorization-code client | `__tests__/oauth-client.test.ts` | discovery, authorize URL, state/error handling, exchange, rotation |
| Flow orchestration | `__tests__/oauth-flow.test.ts` | bind-before-open ordering, revocation clears tokens only, transient failure keeps them |
| Published CIMD document | `__tests__/cimd-document.test.ts` | mirrors Malafat's validation; ports match the code |
| Loopback listener (Rust) | `src-tauri/src/oauth/callback.rs` (moved from `src-tauri/src/sync/oauth_callback.rs` by MUT-73) | loopback-only bind, port fallback, single-shot, timeout releases port |

Not covered by automated tests (requires a provisioned staging tenant, see the
findings doc): live CIMD fetch, consent screen, grant appearing and revoking in
Malafat Settings, and the firm-level MCP gate.

### MUT-10 / MUT-11 — removals keep their data

`src/db/__tests__/retainedSchema.test.ts` (4 tests) is the standing guard for
ADR-029. It asserts that the `engagements` and `engagementVersions` tables stay
in the Dexie schema after the engagements UI was deleted, that rows written to
them read back unchanged, that `serializeAllTables()` includes them, and that a
backup/restore round-trip returns the opaque version snapshot intact.

Add a case here whenever another feature's UI is deleted while its tables are
retained — the test is what stops the next reader from treating the leftover
table as dead weight.

**Baseline when written (2026-10-10)**: 2,033 unit tests passing, 7 skipped.
The 18 failures in `src/pages/expenses/__tests__/ExpensesLedgerPage.test.tsx`
pre-date these tickets and are untouched by them.

### MUT-6 — "Record payment" as a primary row action

| Area | File | What is pinned |
|---|---|---|
| Affordance gate | `src/components/ui/__tests__/RecordPaymentButton.test.tsx` (10) | renders for unpaid and partial income; nothing for paid, expense, zero or unknown remaining; renders on a locked row; remaining amount in the row currency; one click fires once; the click does not reach a row-level handler |
| Overpayment policy (ADR-030) | `src/db/__tests__/paymentRecords.test.ts` | reject over the total on `create` with nothing written; reject when the accumulated sum would pass it; accept the exact remaining balance; reject on `update`; allow an update that stays within; deleted records free the balance again |
| Lock exemption (ADR-030) | `src/db/__tests__/paymentRecords.test.ts` | a payment on a `lockedAt` transaction succeeds, flips status to `paid` and leaves `lockedAt` intact; overpayment is still rejected there |
| One guard, both doors | `src/db/__tests__/partialPayment.test.ts` | `recordPartialPayment` inherits the rejection through its delegation to `paymentRecordRepo.create` |
| Refresh after save (AC #5) | `src/hooks/__tests__/useQueries.test.tsx` | `useCreatePaymentRecord` invalidates `income`, `receivables`, `incomeOverviewTotals`, `incomeAttentionReceivables` alongside the payment-record and transaction keys. Uses real Dexie, no `vi.mock`, so a stubbed barrel cannot fake a pass |
| Drawer contract (AC #3, #4, #6) | `src/components/drawers/__tests__/PartialPaymentDrawer.test.tsx` (9; rewritten by MUT-86) | amount prefilled to the remaining balance and overwritable; the backdated date is what reaches the mutation; overpayment and zero rejected inline without calling the mutation; a repository rejection renders inline; ~~empty prefill when settled~~ (MUT-86: a settled entry shows no form); edit mode prefills the record's own amount |
| Local-date default (ADR-022) | `src/components/drawers/__tests__/PartialPaymentDrawer.test.tsx` | the date field defaults to `todayISO()`, asserted at two faked instants straddling midnight in opposite directions so it holds in both `Asia/Jerusalem` and `npm run test:tz` |
| Derived money views refresh | `src/hooks/__tests__/invalidateMoneyEventQueries.test.ts` (10), `useQueries.test.tsx`, `useIncomeQueries.test.tsx` | all nine money-event keys are invalidated and no others; the payment path and `markPaid` both trigger them. The expense and retainer paths are wired but uncovered — those modules have no mutation-test harness. **Superseded by MUT-58:** the keys lost their last reader, the helper and its test file are deleted, and the two hook cases now assert that no `money*` key is invalidated |
| Per-surface gate | `IncomePage.test.tsx`, `ClientDetailPage.test.tsx`, `ProjectDetailPage.test.tsx` | the button appears on exactly the rows each surface showed the kebab entry on, never on paid rows or expenses, opens the drawer with the row's id, and does not trigger the row's own click |

The four IncomePage "Record Payment" tests that existed before this ticket
asserted nothing about the action — three carried a comment saying the
behaviour was covered elsewhere, and it was not. They assert the button now.

**Baseline after MUT-6 (2026-10-10)**: 2,078 unit tests passing, 7 skipped.
The same 18 `ExpensesLedgerPage` failures still pre-date the ticket and are
untouched by it.

### Fresh install — `useDefaultBusinessProfile` resolves to `null`

| Area | File | What is pinned |
|---|---|---|
| No-row singleton query (PATTERNS: Query Hooks rule) | `src/hooks/__tests__/useQueries.test.tsx` | With an empty `businessProfiles` table the hook reaches `isSuccess`, `data` is `null`, `isError` is false and `console.error` is never called (spied, restored in `finally`). With profiles present but none default, `data` is `null`. Both run against real Dexie through `getRepositories()`, no `vi.mock` |

The case this replaced ("returns undefined when no default exists") waited on
`isFetching === false`, which a failed query also satisfies; it was green while
the query was in `error` state and logging on every fresh install. Assert
`isSuccess` + `toBeNull()` for any no-row case, never `isFetching`.

**Baseline after this fix (2026-10-10)**: 2,079 unit tests passing, 7 skipped.
The same 18 `ExpensesLedgerPage` failures still pre-date it and are untouched.

### TD-028 — every by-id hook resolves `null` for a missing row

| Area | File | What is pinned |
|---|---|---|
| By-id query against real Dexie (PATTERNS: Query Hooks rule) | `src/hooks/__tests__/useQueries.test.tsx` | `useTransaction`, `useClient`, `useClientSummary`, `useProject`, `useProjectSummary`, `useDocument`, `useBusinessProfile` with an id that was never written reach `isSuccess`, `data` is `null`, `isError` is false, `console.error` never called (spied, restored in `finally`). One shared `expectResolvesNull` helper, no `vi.mock` |
| By-id query with a mocked `get` resolving `undefined` | `useIncomeQueries.test.tsx` (`useIncomeById`), `useRecurringExpenseQueries.test.tsx` (`useRecurringRule`) | same four assertions; the mock is the repository's documented "not found" value |
| New hook files | `useExpenseQueries.test.tsx`, `useRetainerQueries.test.tsx`, `usePlanQueries.test.tsx` | `describe.each` over the hook table: found row round-trips and calls `get(id)`, empty id never calls `get`, missing row → `null` with no `console.error`. `usePlanDefaultScenario` is driven through `planScenarioRepo.getDefault` |

All 16 missing-row cases were red before the `?? null` change (the query sat in
`error` state with the TanStack "Query data cannot be undefined" log) and
green after it, with no other test touched. The consumer-side change
(`!!existingDoc` in the two document forms' `isReadOnly`) is covered by the
existing `DocumentDrawer` and document page tests, which still pass.

**Baseline after TD-028 (2026-10-10)**: 2,149 unit tests passing, 5 skipped,
0 failing. The 18 `ExpensesLedgerPage` failures noted above no longer exist on
`main`; the page was removed by the MUT-2 strip.

### MUT-3 — one-page client profile (with the MUT-4 Payments UI)

| Area | File | What is pinned |
|---|---|---|
| Owed Now definition (ADR-033 §1–2) | `src/db/__tests__/aggregations.test.ts` (8) | empty → `[]`; unpaid in full; partial counts remaining only; paid, expense, soft-deleted and archived ignored; overdue = due before today only (due today is not); currencies apart in USD → ILS → EUR order; fully covered currency omitted; over-received clamps to 0 |
| Payment history (ADR-033 §3) | `src/db/__tests__/paymentRecords.test.ts` (+8) | record rows carry `source: 'record'`; income saved as paid with no records → one `entry` row (`entry:<id>`, full amount, `paidAt`); `occurredAt` fallback; no double count when records cover it; partial cover → only the gap; unpaid with nothing received → no row; soft-deleted entry → nothing; currency/date/limit apply to entry rows and sort with records; a timestamped `paidAt` on the `dateTo` day is included |
| Refresh after any income write | `useQueries.test.tsx` (real Dexie), `useIncomeQueries.test.tsx` (3) | Mark paid → `usePaymentsByClient` refetches and shows the new record with no manual invalidation; `useMarkIncomePaid`, `useUpdateIncome`, `useDeleteIncome` invalidate `['paymentRecords']` |
| Row shaping | `src/components/clients/__tests__/clientProfileRows.test.ts` (7) | fields copied; remaining only when partial; overdue vs due-in vs due-today; paid has neither; missing title stays undefined; status derived when absent |
| Hero | `src/components/clients/__tests__/OwedNowSummary.test.tsx` (5) | one amount per currency; overdue line in the overdue style; "Nothing overdue"; "Nothing owed"; `dir="ltr"` and U+2066/U+2069 around the sentence amount |
| Page | `src/pages/clients/__tests__/ClientDetailPage.test.tsx` (34, rewritten) | no tab buttons, three regions at once, contact details; Owed Now per currency from unfiltered receivables and unchanged by work filters; row content incl. remaining and due lines; project tag link/text/absent; untitled label; row click → income drawer; filters as one object; no-work empty state with exactly one Add income → `openIncomeDrawer({ mode: 'create', defaultClientId })`; filtered-empty with Clear filters; Record payment gate and remaining amount (MUT-6); Mark paid only on receivables; Payments rows, record → `editPaymentRecord`, entry → income drawer, row menu "Open income entry", migrated note translated, empty text; invoice actions off/on, retainers card off/on, + Project on/off (MUT-13/16); `useProjects` never called (MUT-23) |

Dates are pinned with `vi.useFakeTimers({ shouldAdvanceTime: true })` at
2026-10-11 and date strings are asserted through `formatDate` itself, so the
page suite also passes under `npm run test:tz`.

Manual (browser, 2026-10-11, seeded data, 1024 px and 1280 px, English and
Arabic): no horizontal scroll on page or either table; Owed Now is the largest
text (30px vs an 18px title); amounts stay LTR in Arabic; Mark paid from the
row menu updates Owed Now, the row and Payments without a reload; the no-work
client shows one Add income that opens the drawer with the client filled in;
a payment row opens the drawer in edit mode on the right record.

**Baseline after MUT-3 (2026-10-11)**: 2,194 unit tests passing, 5 skipped,
0 failing. `npm run test:tz`: 4 failures, all pre-existing on `main` (TD-014).

### MUT-15 — the sidebar is Home / Clients / Income / Settings

| Area | File | What is pinned |
|---|---|---|
| Core shape (AC 1, 2, 8) | `src/components/layout/__tests__/SidebarNav.features.test.tsx` | fresh install: exactly Home, Clients, Income, Settings in DOM (Tab) order, no Main/Workspace/More header; every area on: the core three first, More holds the six in order, Settings last; switching an area on then off adds and removes it below the core with the core link **nodes** identical throughout; Settings is inside `.sidebar-footer`, never `.sidebar-nav`, with all areas off and on |
| Active state (AC 6) | same file | parametrised over `/`, `/clients`, `/clients/c1`, `/income`, `/expenses`, `/documents/d1/edit`, `/retainers`, `/insights`, `/planning`, `/projects/p1`, `/settings/profiles/p1`, `/settings/import`: exactly one link has `active` + `aria-current="page"` and it is the expected entry; nothing active on `/theme-demo` |
| Collapsed mode (AC 7) | same file | four icon links titled with their labels, no labels or headers rendered; the toggle collapses/expands and writes `localStorage.sidebarCollapsed` |
| `+ Add` actions (AC 5) | `layout/__tests__/addMenuActions.test.ts`, `SidebarNav.features.test.tsx`, `TopBar.addMenu.test.tsx` | Income, Client always; Expense / Project appended only while on; all 64 flag combinations keep Income, Client first; both menus render the same order |
| Menu keyboard (D5) | `src/hooks/__tests__/useMenuButton.test.tsx` (11), plus one case in each menu's test | `aria-haspopup`/`aria-expanded`/`aria-controls`; opening focuses the first item (ArrowUp on the button: last); arrows wrap; Home/End; Escape closes and refocuses the button (also when the button has focus); Tab and outside mousedown close, inside mousedown does not; a picked item runs and the menu closes without pulling focus back |
| Redirect on disable (AC 4) | `src/lib/features/__tests__/leaveDisabledArea.test.tsx` (6), `features.test.ts` (`featuresTurnedOff`, 5) | real memory-history router + real `requireFeature`: switching the open page's area off lands on `/` with history length 1 (replace); a core page stays; another area off re-runs the guard and stays; switching on, a non-feature settings change and the first load never call `router.invalidate` (spied before the first render) |
| Onboarding (TD-027) | `src/components/onboarding/__tests__/OnboardingOverlay.projects.test.tsx` (+3) | projects off: two circles numbered 1, 2, none ticked, first current; after the client step, 1 ticked and 2 current; projects on: three circles |
| E2E | `e2e/navigation.spec.ts` (run locally against a worktree dev server) | `/app/` shows the four links in order with no optional or legacy link; each navigates and gets `aria-current="page"` |

Browser check (2026-10-11, dev server): English and Arabic × expanded and
collapsed × no areas and two areas on — core order, More below, Settings in
the footer, active rail on the inline-start edge, collapse chevron direction
in all four direction × state combinations, collapsed toggles in flow with no
overlap. Two-tab check: tab A on `/app/expenses`, tab B switches Expenses off,
tab A's settings query refetches → More loses Expenses and the tab lands on
`/app/` with history length unchanged.

**Baseline after MUT-15 (2026-10-11)**: 134 files, 2,207 passed, 5 skipped,
0 failed (was 130 / 2,149).

### MUT-7 — clients index: who owes me, and who is late

| Area | File | What is pinned |
|---|---|---|
| Payment derivation, extracted (ADR-033) | `src/db/__tests__/aggregations.test.ts` (+9) | `paymentRowsForIncome`: record rows; one entry row for the uncovered received amount; `occurredAt` fallback; nothing for unpaid. `latestPayment`: none → undefined; newest wins; same-day tie → larger amount, then id, whatever the input order. `combineOwed`: sums within a currency only, `[]` when settled. `listByClient`'s 15 existing tests guard the refactor |
| Summary collection fields | `src/db/__tests__/clientRepo.test.ts` (+9) | owed per currency without paid or archived income; settled → `[]` and no overdue age; oldest overdue age, with due-today not overdue; last payment from a partial record; a backdated record beats an older paid entry; deleted records ignored; income saved as paid counts; never paid → undefined; archived clients excluded; `get()` follows payments too. Dates are relative to the real today (no fake timers around Dexie) |
| Row shaping and ordering | `src/components/clients/__tests__/clientIndexRows.test.ts` (14) | settled flag; overdue lists only late currencies; `owedRank` converts rated currencies, keeps unrated ones in their own slot, all zeros when settled; owed desc/asc by rate with settled last; unrated amounts rank after rated; overdue by days; last payment newest first with never-paid last; activity; name; ties name then id in both directions |
| Header | `src/components/ui/__tests__/SortableHeader.test.tsx` (4) | `aria-sort` none, descending, ascending; click reports the field; end alignment and title |
| Page | `src/pages/clients/__tests__/ClientsPage.test.tsx` (18, rewritten from 33) | exact column set; per-currency lines in Owed Now; Overdue amounts plus "oldest Nd"; Settled and dash; last payment date and amount, or Never paid; order hint on the header; default order and `aria-sort`; order flips when the USD rate changes; toggle; each column's order; sort in the URL; ties by name; strip count and per-currency total owed; row click → profile; name is a link; empty, search-empty (translated keys, debounce awaited) and loading states |

The old page suite asserted the name-ascending default and cross-currency
sums, both of which this ticket removes. Its search and empty-state cases were
kept in spirit. Archived-client exclusion is pinned at the repository, where
it happens.

Manual (browser, 2026-10-11, seeded data, 1280px and 1024px, English and
Arabic): order Gamma ₪12,000 > Acme $1,300 + ₪4,200 > Beta $900 > the
settled clients, at a live rate of ₪3.06/$. The strip read $2,200 and
₪16,200 with the overdue parts. The archived client and archived-only debt
were left out. Header clicks and the URL matched. A row opened a profile
that agrees with its index row. No horizontal scroll, and RTL amount columns
sit at the end edge.

**Baseline after MUT-7 (2026-10-11)**: 2,222 unit tests passing, 5 skipped,
0 failing.

### MUT-8 — Home: owed now, needs attention, recent payments

| Area | File | What is pinned |
|---|---|---|
| Needs attention data | `src/db/__tests__/transactionRepo.test.ts` (+5, "as Home's Needs attention") | due today and day 7 in, day 8 out; only before-today is overdue (`daysOverdue` 1 vs undefined); every currency incl. EUR without a filter; oldest first, equal dates by client name; archived entries left out. Dates are relative to the real today via `formatLocalDate` |
| Recent payments data | `src/db/__tests__/paymentRecords.test.ts` (+6, `listRecent`) | empty → `[]`; across clients, newest first, client and what-for named, record and entry rows; client-less income kept unnamed; default limit 10 and a smaller limit; profile scoping; deleted entries and records out, archived entries' payments in |
| Refresh | `src/hooks/__tests__/useQueries.test.tsx` (+1, real Dexie) | Mark paid → `useRecentPayments` shows the payment with no manual invalidation (inherits MUT-3's `['paymentRecords']` prefix, so it passed on first run as a regression guard) |
| Page | `src/pages/overview/__tests__/OverviewPage.test.tsx` (15, new — Home had no test) | block order; Owed now per currency with overdue part; profile-scoped queries; old blocks absent; attention rows in repo order with client, what for, remaining; bucketing (3d overdue, Due today not overdue); day-7 label; row → client or entry drawer; attention empty state; payments rows and navigation; payments empty state; new install → one page action, Add income, no tables; loading → spinner, no onboarding or empty-state flash; onboarding still shown when not skipped |
| Deletion guard | `src/__tests__/noDeadHomeModules.test.ts` (5) | the four deleted component files stay gone; the home barrel exports only the two MUT-8 sections |

Removed with the deleted components: `PredictiveKpiStrip.test.tsx`,
`MonthActualsRow.test.tsx`, `AttentionFeed.test.tsx`,
`AttentionFeed.features.test.tsx` and `src/components/__tests__/KpiCard.test.tsx`
(59 tests).

Manual (browser, 2026-10-11, seeded data, 1280px English, 1024px Arabic):
- Owed now read $3,434 and ₪16,200. The $1,234 above the clients index belongs
  to the archived client (ADR-036 §5), and the archived EUR entry was left out.
- Needs attention listed Gamma 31d, Acme 3d and Beta due in 5d. The 9- and
  10-day items were left out.
- Recent payments listed three rows, newest first.
- A row opened Gamma's profile. No horizontal scroll, RTL stacked to one
  column, and amounts stayed LTR.
- No onboarding flash after the loading fix.

**Baseline after MUT-8 (2026-10-11)**: 2,258 unit tests passing, 5 skipped,
0 failing.

### MUT-37 — operator-only user accounts (`server/`)

Plan: `.claude/designs/mut-37-operator-accounts-tests.md`. Written red first.

| Area | File | What is pinned |
|---|---|---|
| Pure helpers | `src/auth/__tests__/users.test.ts` | email normalisation (trim, NFKC, lower-case, idempotent); 24-char base64url one-time passwords, no repeats in 1,000; argon2id PHC string with the configured m/t/p; verify true/false; salted; malformed stored hash → false |
| Config | `src/__tests__/config.test.ts` | argon2 defaults = OWASP profile 1; anything below is a `ConfigError` naming the variable |
| Storage contract (memory + Postgres) | `src/repositories/__tests__/store-contract-users.ts` | user + first membership in one transaction; unique email; unknown organization → `ForeignKeyViolation` and no user; `setPassword` clears lockout counters; `setStatus`; idempotent `grant` keeps `createdAt`; `revoke` once; organization isolation |
| Routes | `src/__tests__/routes-users.test.ts` | the seven admin routes: 201/200/404/409/422; email normalised on create and lookup; hash never returned; reset invalidates the old password; idempotent disable/enable; audit per member organization; 401 without or with a wrong admin token on all eight route forms; **no password or `$argon2id$` in any log line** at `trace` |
| No self-registration | `src/__tests__/no-self-registration.test.ts` | router and published contract: no path outside `/admin/` matches signup / register / invite / forgot / reset (non-vacuous: >50 paths inspected) |
| CLI | `src/scripts/__tests__/users-cli.test.ts` | create / grant / revoke / rotate / disable / enable against the in-process app; password printed exactly once; no token → non-zero, no secret; server error codes surfaced; unknown subcommand → usage |

**Baseline after MUT-37 (2026-10-11)**: server 363 passed, 8 skipped without a
database; **410 passed, 0 skipped** with `npm run test:db` against an isolated
`mutaba3a_test_mut34` database (users contract green on Postgres). Root app
unchanged: 2,149 passed, 5 skipped. One pre-existing flake seen
under full-suite load: `routes-m6` "lists the organization's events by entity"
(TD-040), never reproduced in isolation (0/20).

### MUT-38 — session auth beside API keys (`server/`)

Plan: `.claude/designs/mut-38-session-auth-tests.md`. Written red first (57 failing before implementation).

| Area | File | What is pinned |
|---|---|---|
| Pure helpers | `src/auth/__tests__/sessions.test.ts` | 43-char tokens; HMAC digest per pepper; `__Host-` name only when Secure; trusted-hop client IP (forged leftmost ignored); same-origin rule; throttle locks on the 5th failure, unlocks at 15:00, forgets old failures |
| Config | `src/__tests__/config.test.ts` | pepper required ≥ 32; idle/absolute/hops bounds and defaults; optional portal origin |
| Storage contract (memory + Postgres) | `store-contract-sessions.ts` | create/find by digest; unique digest; FK user; touch; revoke wins once; `revokeAllForUser` counts only live ones; failed/success sign-in bookkeeping; audit actor `USER` |
| Routes | `src/__tests__/routes-sessions.test.ts` | cookie attributes; Me body without the token; four refusals identical with exactly one argon2 verify each; dummy hash parameters; lockout + one `user.locked_out` + unlock after 15 min; unknown emails lock identically; per-IP 429; cross-site sign-in and sign-out refused; `/v1/me` writer of record and access; idle and absolute expiry; sign-out revokes server-side; reset/disable/explicit revoke end sessions; both credentials refused; profile header 422/200/404s incl. removed membership; lazy posting attributed to `SYSTEM`; session rate limit; token, digest and password never logged |
| Route security | `src/__tests__/route-security.test.ts` | generated from the published document: every `/v1` operation declares principals (only sign-in is public); exactly 22 operations accept sessions; a session is refused on every key-only operation and let through on every session operation; a key is refused on both identity routes; every key-reachable operation enforces a scope |
| Logger | `src/__tests__/logger.test.ts` | 10 sensitive keys × depths 0–3, request cookie, response Set-Cookie |

**Baseline after MUT-38 (2026-10-11)**: server `npm test` 466 passed, 9 skipped; `npm run test:db` 520 passed.

### MUT-39 — server-enforced writability (`server/`)

Plan: `.claude/designs/mut-39-writability-tests.md`. The guard and drift tests were written red first (in the WIP commit); the route tests are derived from the matrix and mutation-checked.

| Area | File | What is pinned |
|---|---|---|
| Store guard | `src/auth/__tests__/store-guard.test.ts` | `STORE_ACCESS` = the runtime store's methods exactly; every write names a matrix row; the operator set by name; each method × {session/Malafat, session/personal, key} decided from the matrix; expenses: session yes, key no; the proxy refuses before the store, `unguarded` reaches the base, provisioning refused under a guard, pass-through without a guard or outside a request |
| Matrix drift | `src/__tests__/writability-drift.test.ts` | brief §5 block ↔ `WRITABILITY_MATRIX`, cell by cell, 10 rows, local column `device` |
| Routes from the matrix | `src/__tests__/writability-routes.test.ts` | every scoped operation: scopes are matrix rows, granted by each declared principal's column; every key-only operation × session naming a Malafat-fed / personal / non-member profile → READ_ONLY_PROFILE `{domain, MALAFAT \| null}` or PRINCIPAL_NOT_ACCEPTED, nothing written; session list reads 200; AC writes (agreement, installment trigger, credit, payment, customer); `unguarded(`/`lazyPostingOf(` call sites; 7 lazy-posting reads post once as SYSTEM, no other read writes; no cross-profile id reaches any store call |
| Route security | `src/__tests__/route-security.test.ts` | key-only operations: READ_ONLY_PROFILE on Malafat writes (>20), PRINCIPAL_NOT_ACCEPTED elsewhere; every key-reachable operation has tagged scopes |

### MUT-42 — expenses on the hosted ledger (`server/`)

Plan: `.claude/designs/mut-42-hosted-expenses-tests.md`. The tests were written red first; the closures were mutation-checked.

| Area | File | What is pinned |
|---|---|---|
| Storage contract (memory + Postgres) | `store-contract-expenses.ts` | full-field round trip (bigint); organization scoping; newest-first `(occurredOn, id)` paging with same-date rows; every filter; optimistic update with null/absent semantics; soft delete twice; category name unique case-insensitively; archive and restore; seeding once under a race; receipts pending → READY → soft delete (one or all) |
| Pure units | `expenses/__tests__/{summary,presets,cursor}.test.ts`, `rules.test.ts`, `api-key.test.ts` | per-currency blocks with ordered breakdowns; preset parity with the offline source; cursor round-trip and refusals; `checkFile`/`receiptStorageKey`; key vocabulary unchanged; expense scopes session-only |
| Guard | `store-guard.test.ts` | `{ read }` decided per column; all 17 expense methods in `expenses`, refused to the key, allowed to a session |
| Routes | `routes-expenses.test.ts` | MUT-39's carried criteria (session write on a Malafat-fed profile; key refused on all 13 operations); exact wire shape; idempotent replay/reuse; 9 validations; links and mismatch; archived links; PATCH (If-Match, null, currency immutable, archived category); delete; paging and filters on a personal profile; receipt flow, TTL, incomplete/mismatch, cap, M6 rules, 503; seeding (locale, preset per writer, once, SYSTEM); category CRUD and conflict; summary default month, inclusive range, `END_BEFORE_START`; USER audit |
| Invisible to Malafat | `expenses-invisible.test.ts` | canary sweep over every key-readable operation × every canary id; `/v1/audit` excludes expense types; idempotency namespaced (lookup 404, no collision, digest ≤ 128) |
| Inventory | `route-security.test.ts`, `writability-routes.test.ts` | 13 expense operations session-only; 25 session GETs; the category list is the one read that writes (seed) |

### MAL-1118 — personal expense-category preset (`server/`)

Tests written red first (ADR-066).

| Area | File | What is pinned |
|---|---|---|
| Pure unit | `expenses/__tests__/presets.test.ts` | `presetFor` for Malafat-fed (law-firm), personal (personal, en and ar) and other firms (general); Malafat beats the personal mark; `PERSONAL_PRESET` order, Other last, every Arabic name present, hex colours; every preset's names distinct under `categoryNameKey` in both languages (a clash would be dropped silently by the Postgres seed's `skipDuplicates`). Parity with the offline source still covers general and law-firm only; the law-firm list is the general list, then the six firm costs, Other last (ADR-066 amendment, 2026-10-22) |
| Routes | `routes-expenses.test.ts` | a real personal profile (`/admin/v1/users` → `personalProfile.id`) seeds the personal preset in English and in Arabic, once, as SYSTEM, audit `{ preset: 'personal', count: 10, locale }`; a firm with no Malafat link keeps general (renamed from the mislabeled "personal profile" test) |

### MUT-59 — repair of a database that applied the original M7 (`server/`)

`src/repositories/__tests__/migration-mut59.test.ts`, Postgres only (`npm run test:db`), on scratch databases built with `prisma db execute` from every migration, with M7 replaced by its original (`fixtures/m7_fee_proposals.acb1144.sql`):

- **Repair:** every M7 status mapped (`CONVERTED` dated and priced from its agreement); version bumped; one `SYSTEM` `fee_proposal.repaired` row per touched proposal, with the exact old values; columns dropped; no drift against `schema.prisma`; the M8 store lists every row and approves a formerly client-approved one.
- **Idempotent:** a second run changes nothing.
- **Refusals:** both cases abort with `MUT-59 repair refused`, leaving the enum, columns, rows and audit untouched.
- **Fresh database:** a no-op.

Rehearsed once by hand, the way production deploys: `migrate deploy` of the acb1144 history, then of `main`. That included a refusal and the `migrate resolve --rolled-back` recovery.

### MUT-43 — the hosted portal (root package)

Plan: `.claude/designs/mut-43-hosted-portal-tests.md`. Tests were written before the code they pin, except the shell's CSS.

| Area | File | What is pinned |
|---|---|---|
| Build target | `scripts/__tests__/vite-config.test.ts` | web and desktop configs equal a snapshot taken before the hosted branch existed; hosted: `dist-hosted`, own public dir, no PWA plugin, entry emitted as `index.html`, `/v1` proxied |
| Bundle rules | `scripts/__tests__/check-bundles.test.ts` | each portal marker in a local bundle; IndexedDB / Dexie / service worker and each en/ar self-service string in the portal; "sign in" and `تسجيل الدخول` not mistaken; origins extracted and diffed |
| Lint guards | `scripts/__tests__/hosted-lint.test.ts` | every forbidden import and `Number`/`parseFloat`/`parseInt`/unary `+` fire under `src/hosted`; the i18n core and UI kit are allowed; the app is unaffected |
| i18n | `src/lib/i18n/__tests__/{core,plural}.test.*`, `src/hosted/i18n/__tests__/*` | the app provider behaves as before the split; CLDR forms en/ar; full-tree en/ar parity with plural rules; `common.*` pinned to the app; E4 precedence |
| Client | `src/hosted/api/__tests__/client.test.ts` | credentials, no `Authorization`, profile header only on scoped calls, query encoding, envelope → `ApiError`, `Retry-After`, `UNKNOWN`/`NETWORK`, one 401 handler, never on sign-in |
| Auth states | `src/hosted/session/__tests__/{auth-states,safeNext}.test.*` | S1–S13 and E1–E4 of the addendum, including the cache cleared before sign-in renders, the broadcast, and the sign-in form surviving a late announcement |
| Views | `src/hosted/pages/__tests__/views.test.tsx` | each view's states; the stale-figure AC; strip, sort and the D13 currency rule; filters as one URL object with `replace`; cursor "show more"; allocations; signed-URL download and no preview; read-only reasons for both writers; switcher chips, sources, footer and no cross-profile figures |
| Formatting | `src/hosted/format/__tests__/format.test.tsx` | exact decimal formatting (no float), zero spellings, LTR isolation, calendar dates never shifted, instants in the organization zone |

Also run once by hand against the real API on a scratch database (2026-10-11): wrong then right password, every view, allocations, the switcher to an expenses-only profile, Arabic, phone width, sign-out, and an operator `revoke-sessions` landing on the expired note with `next` kept. Two bugs found there are now covered (see CHANGELOG).

**Baseline after MUT-43 (2026-10-11)**: root `npx vitest run` 151 files, 2462 passed, 5 skipped; `npm run test:bundles`, `npm run hosted:types:check`, `npm run typecheck` (both programs), `npm run lint` (0 errors) and `npm run build` pass. The server package is unchanged.

### MUT-44: hosted expense capture

Plan: `.claude/designs/mut-44-expense-capture-tests.md`.

| Area | File | What is pinned |
|---|---|---|
| Shared schema | `src/components/expenses/__tests__/expenseFormSchema.test.ts` | the base schema's validation matches local's pre-extraction behaviour exactly (no regex on amount); `DECIMAL_AMOUNT` accepted/rejected shapes |
| Shared form | `src/components/expenses/__tests__/ExpenseFormFields.test.tsx` | field order; currency options given, not hardcoded; `amountInputMode` swaps `type`/`dir`/`inputMode`; required-category error; an omitted `projectField` renders nothing |
| Local extraction regression | `src/components/__tests__/ExpenseDrawer.projectField.test.tsx` (unmodified), `ExpenseDrawer.oneTimeFields.test.tsx` (new) | the pre-existing test passes byte-for-byte; amount persists as `amountMinor`, currency/date/title/category-required/notes round-trip through the real drawer and Dexie |
| Hosted client | `src/hosted/api/__tests__/client.test.ts` | `idempotency-key` on create, `if-match: <version>` on update, every expense/category/receipt operation hits the right path/method |
| Pickers | `src/hosted/components/__tests__/{ClientPicker,ProjectPicker}.test.tsx` | options from the directory query; no "create new" branch ever renders |
| Error mapping | `src/hosted/components/__tests__/expenseApiErrors.test.ts` | every MUT-42 `VALIDATION_FAILED` reason → its field with `type: 'manual'`; `CONFLICT`/network/non-`ApiError` → toast |
| Hosted drawer | `src/hosted/components/__tests__/ExpenseDrawer.test.tsx` | decimal-text amount input (`dir="ltr"`); Idempotency-Key on create; the loading gate blocks partial data in edit mode; a field error renders and does not close the drawer; Escape and overlay-click close; receipts section only in edit mode |
| Receipts | `src/hosted/components/__tests__/ReceiptUploader.test.tsx` | start → PUT (with the server's own headers, `credentials: 'omit'`) → complete; type/size rejected client-side before any call; the 10-cap counts only `READY` |
| Expenses list | `src/hosted/pages/__tests__/ExpensesList.test.tsx` | populated row shape; empty state with a "Record expense" action; row click and the header button open the drawer with the right search params; sidebar nav entry |

**Baseline after MUT-44 (2026-10-11)**: root `npx vitest run` 160 files, 2537 passed, 5 skipped; `npm run test:bundles` (after adding `json-schema.org` to the hosted allowlist), `npm run typecheck` (both programs), `npm run lint` (0 errors, 17 pre-existing warnings unrelated to this ticket) and `npm run build` pass. The server package is unchanged.

### MUT-18/19/20/21: payment dates, and closing out three already-fixed test tickets

MUT-19, MUT-20 and most of MUT-21 were found already fixed on `main` before any
code changed — see ADR-038 and the CHANGELOG entry for what was verified
rather than rebuilt. Only MUT-18 (payment dates) and MUT-21's missing
due-tomorrow boundary case needed new code/tests.

| Area | File | What is pinned |
|---|---|---|
| Repository | `src/db/__tests__/transactionRepo.test.ts` (`markPaid`) | backdated `paidAt` stored verbatim; defaults to today when omitted; a payment near a month boundary buckets under the month it was received; a future-dated `paidAt` is rejected |
| Repository | `src/db/__tests__/partialPayment.test.ts` (`recordPartialPayment`) | same four cases for partial payments, plus: a transaction's `paidAt` after two payment records reflects the *later* record's date, not the instant the recalculation ran |
| Repository | `src/db/__tests__/paymentRecords.test.ts` | `paymentRecordRepo.create`/`.update` reject a future `paidAt`; a same-day timestamp with a time component is accepted (date-only comparison, not a full-timestamp one) |
| Hook | ~~`src/hooks/__tests__/useIncomeQueries.test.tsx` (`useMarkIncomePaid`)~~ | ~~`{ id, paidAt }` forwards both fields to the repository; omitting `paidAt` forwards `undefined` (repository default applies)~~ (hook and test deleted, MUT-98 — no app caller outside tests; `transactionRepo.markPaid` itself stays covered by the Repository row above) |
| Drawer | `src/components/drawers/__tests__/PartialPaymentDrawer.test.tsx` | ~~"Mark fully paid" records under today by default and under a backdated date when the field was changed first~~ (button removed by MUT-86, ADR-047; the backdated-date case now runs through Record Payment); a future-dated "Record Payment" is rejected inline with no mutation call |
| Client profile | `src/pages/clients/__tests__/ClientDetailPage.test.tsx` | the work-section "Mark Paid" row action opens the payment drawer and does **not** call the mark-paid mutation directly |
| Income page | `src/pages/income/__tests__/IncomePage.test.tsx` | due-tomorrow is asserted not-overdue (the boundary case MUT-21's acceptance criteria named but the existing fix had not added) |

No test file exists for `TransactionsPage` or `ClientWorkSection` as a whole
(their Mark Paid wiring is exercised only indirectly, via `ClientDetailPage`'s
test of the shared section and via reading the source for `TransactionsPage`)
— a pre-existing coverage gap, not introduced by this ticket.

**Baseline after MUT-18/19/20/21 (2026-10-11)**: root `npx vitest run` 160
files, 2555 passed, 5 skipped; `npm run typecheck`, `npm run lint` (0 errors,
20 pre-existing warnings unrelated to this ticket) and `npm run build` pass.

### MUT-45: serve the hosted portal

No separate test-plan artifact — scope is server-only (static serving, SPA fallback, CSP, config), not a new feature surface.

| Area | File | What is pinned |
|---|---|---|
| Portal serving | `server/src/__tests__/portal.test.ts` | `/assets/*` immutable caching **only on an actual hit**; a stale/nonexistent hashed asset falls back to the SPA shell with `no-store`, never a year-long cache of a broken response; a root-level public file (favicon) served as itself, never immutable-cached; client-side routes fall back to `index.html` without immutable caching; `/health`, `/ready`, `/openapi.json`, unknown `/v1/*` and unknown `/admin/*` paths are never caught by the fallback; CSP header on both API and portal responses; disabled (`portal` omitted) leaves every other test file's behavior unchanged |
| Config | `server/src/__tests__/config.test.ts` | `PORTAL_DIST_DIR` optional, defaults to unset, rejects an empty string |
| Smoke | `server/src/__tests__/smoke.test.ts` | `GET /` (hosted portal) check: 200, `text/html`, CSP present; fails cleanly (not a crash) when no portal is configured, matching a pre-MUT-45 deployment shape |

Verified against the real built artifact, not only the fixture: built `dist-hosted/` with `npm run build:hosted`, built the Docker image, booted it, and curled `/`, `/assets/<real hashed file>` (immutable), `/assets/<fake-stale-hash>.js` (falls back to the shell, `no-store`), `/favicon.svg` (`no-store`), a client-side route, `/v1/bogus` (401, unauthenticated) and `/admin/bogus` (404, valid token) — all matched the unit-test expectations exactly, both before and after the `/qa-reconcile` fix below.

**Found and fixed during `/qa-reconcile` (2026-10-11)**: the original immutable-caching middleware keyed on the URL prefix (`/assets/*`) alone, before checking the file existed — a stale/rotated hashed asset fell through to the SPA shell but kept the immutable header, so a browser or CDN would cache that broken response for a year. Caught by directly probing the running app (not just reading the fixture tests), confirmed against the real Docker image, fixed, and re-verified both ways. Also surfaced along the way: `serveStatic`'s `onFound` callback fires after it has already built its `Response`, so `c.header()` inside it is silently dropped — see `.claude/PATTERNS.md`.

**Baseline after MUT-45 (2026-10-11)**: server `npm test` 1071 passed, 11 skipped; `npm run typecheck` and `npm run lint` pass. Root `npm run build:hosted` and a local `docker build`/`docker run` round-trip verified by hand twice (see above). No Terraform changes (`terraform validate` passes; `terraform plan` is a no-op for this ticket).

**Baseline after MUT-59 (2026-10-11)**: server `npm test` 1056 passed, 11 skipped; `npm run test:db` 1122 passed.

**Baseline after MUT-42 (2026-10-11)**: server `npm test` 1056 passed, 10 skipped; `npm run test:db` 1117 passed; the migration applies from an empty database with no drift.

**Baseline after MUT-39 (2026-10-11)**: server `npm test` 924 passed, 9 skipped; `npm run test:db` 978 passed (after re-migrating the local test database).

### MUT-5 — the income entry is the work record (2026-10-11)

Brief: `.claude/designs/mut-5-income-fast-path.md`; plan: `.claude/designs/mut-5-income-fast-path-tests.md`. Written test-first, apart from the drawer. Its 41 tests were written after the restructure, then run against the old drawer: 35 failed there and 6, the preserved behaviours, passed.

| File | Type | Tests | Covers |
|---|---|---|---|
| `src/lib/__tests__/utils.test.ts` (extended) | Unit | +27 | `parseAmountInput`: ASCII, grouped thousands, decimals, Arabic-Indic and Extended digits, Arabic separators, currency symbol/code, bidi marks, NBSP. Ambiguous input → null. Arabic digits in the lenient wrappers and `formatCurrencyInput` |
| `src/lib/__tests__/incomeEntry.test.ts` (new) | Unit | 27 | `buildIncomeCreate`/`buildIncomeUpdate` for every status transition, with keys asserted absent rather than undefined, and record-backed edits writing no payment fields; `isBelowRecordedTotal`; `shouldExpandDetails`; `resolveDefaultCurrency` |
| `src/db/__tests__/paymentRecords.test.ts` (extended) | Integration (Dexie) | +6 | `transactionRepo.update`: an amount below the recorded total is rejected and nothing is written; a cut to the total → paid; raised → unpaid with the difference; an unchanged amount → no recalc; no records → no guard; deleted records ignored |
| `src/components/ui/__tests__/EntityTypeahead.test.tsx` (extended) | Component | +9 | Keyboard contract: highlight on typing, clear drops it, Enter picks the first match or a lone create option, Enter on a closed or empty list submits the form, Escape stays inside the list, Tab closes without picking |
| `src/components/ui/__tests__/ClientTypeahead.test.tsx` (extended) | Component | +4 | Exact name picked on blur; a partial name is reported as pending; a create pick counts as picked at once, with `onCreatingChange` true → false; pending is cleared after a pick and after clearing |
| `src/lib/i18n/__tests__/incomeDrawerKeys.test.ts` (new) | Unit | 3 | The ten new keys exist and aren't empty in en and ar; `{amount}` survives in both |
| `src/hooks/__tests__/useQueries.test.tsx` (extended) | Hook (real Dexie) | +2 | A drawer create/update refreshes `useIncome` and `useReceivables` |
| `src/components/__tests__/IncomeDrawer.test.tsx` (rewritten) | Component | 41 | Every MUT-5 criterion: fast path; More details contents; the 3-field save with defaults; the defaults line; profile currency and following it; EUR; LTR amount group; client prefill or none; amount required/invalid/zero/Arabic digits; unpicked client; Escape; focus order; status inside More details; reopening on an invalid hidden field; profile up front when unresolved; edit load and expansion rules; paid → invoiced; lock regression; payment data on edit, both record-less and record-backed; the MUT-16 project switch |
| `e2e/income-fast-path.spec.ts` (new) | E2E (Playwright, Chromium) | 2 | title, Tab, amount, Tab, new client, Enter, Enter saves (the entry shows on the client page); Escape keeps the drawer. Passed 10/10 and 6/6 with `--repeat-each` against the worktree dev server |

**Manual (in-app browser, port 5191, English and Arabic):**
- keyboard-only create, which found the Enter-Enter race (fixed);
- the RTL amount group and the defaults line, which found the `:lang(ar)` override and a bidi reorder (both fixed);
- payment-drawer prefix styling, with Arabic digits accepted;
- a record-backed edit: status read-only, the hint, and the below-recorded error in Arabic;
- the client page refreshing after a save.

**Gate (2026-10-11):**
- `npm run lint`: 0 errors, 16 warnings (main has 20).
- `npx tsc -b`: clean.
- `npx vitest run`: 162 files, 2,642 passed, 4 skipped. The baseline was 2,539 passed and 5 skipped; the edit-mode drawer test is un-skipped.
- `npm run test:tz`: only the 3 TD-014 failures, identical on main.
- `npm run build`: OK. Its `@media` warning comes from the existing `.print-header` rule.

**Pre-landing review fixes (2026-10-11):** each new test was shown failing first, except the regression pins noted.

| File | Added | Covers |
|---|---|---|
| `src/lib/__tests__/utils.test.ts` | +22 | Refused: letter suffixes ("2k", "50%", "5 ألف", "10O", "1e3"), "0,500", "100 50", "1 2 3", more than 2 decimals, unsafe integers. Accepted: currency codes either side, NBSP / narrow-NBSP grouping. Half-up string rounding for the lenient wrappers. |
| `src/lib/__tests__/incomeEntry.test.ts` | +4 | A Received save leaves `dueDate` out of the write on create, paid → paid and record-backed edits; an unpaid save that empties the field still clears it. |
| `src/db/__tests__/paymentRecords.test.ts` | +4 | `transactionRepo.update` strips and re-derives payment state on a record-backed entry; rejects a currency change with records and allows one without; lets a legacy overpaid entry be retitled. |
| `src/components/ui/__tests__/EntityTypeahead.test.tsx` | +7 (1 rewritten) | Prefix-first highlight; select-only single option; Enter held on unmatched text and after Escape; Enter held with `aria-busy` while an async pick runs; Enter submits after tab-in with nothing typed; `aria-controls` / `aria-activedescendant`. "Selects the only option with nothing typed" was rewritten to "Enter goes through". |
| `src/components/ui/__tests__/ClientTypeahead.test.tsx` | +1 | A failed create keeps the typed name unpicked, with `onCreatingChange` going true then false. |
| `src/components/__tests__/IncomeDrawer.test.tsx` | +9 | A queued save during a client create and its failure path (regression pins, green on the typeahead fix); the records-loading gate; the currency lock; currency kept on edit and duplicate (pins); the refused-save toast; the legacy retitle; a missing entry never created. The 30ms sleeps are replaced by settle signals. |
| `src/hooks/__tests__/useQueries.test.tsx` | +2 | Each money key is invalidated once per payment save; an edit invalidates `['transactionDisplay']`. |
| `e2e/income-fast-path.spec.ts` | +1 (1 updated) | Arabic: the amount group's computed direction is LTR and the prefix sits left of the input. This fails without the CSS fix. The keyboard spec waits for `aria-busy` to clear before the saving Enter. |

**Adversarial re-review fixes (2026-10-11):** every new test was shown failing first; the `£`/one-token and "types again" cases are guards.

| File | Added | Covers |
|---|---|---|
| `src/services/__tests__/paymentRequestService.test.ts` (new) | 4 | Record Payment pays a fresh and a part-paid receivable (status, `paidAt`, received); an update reaches the receivable; a refused currency change leaves the document untouched. |
| `src/components/ui/__tests__/EntityTypeahead.test.tsx` | +5 | A held Enter submits once the pick is saved; typing again drops it; a pick resolving `false` drops it and makes Enter retry; Enter after Escape picks on the next Enter; a consumer `autoHighlight`. |
| `src/components/ui/__tests__/{Client,Project,Vendor}Typeahead.test.tsx` | +1 each | A failed create over a picked client keeps the typed name; a failed project create empties the box (final pass); the vendor alias match is highlighted over a prefix match. |
| `src/lib/__tests__/utils.test.ts` | +22 | Bidi embeddings/isolates stripped; two tokens, `£`, `GBP` and over-long input refused; a 50k-space paste parses in linear time (3.4 s before); `amountInputCurrency` for every token form and for no token. |
| `src/components/__tests__/IncomeDrawer.test.tsx` | +4 (1 updated) | A mismatched currency symbol is refused and opens More details; switching the currency clears it and saves; a matching symbol saves; a failed records load shows the notice and Try again recovers. The recorded-total message now expects FSI. |
| `src/lib/i18n/__tests__/incomeDrawerKeys.test.ts` | +1 | Three new keys in both locales; `{typed}`/`{currency}` survive. |
| `src/sync/core/__tests__/synced-transaction-update.test.ts` (new; deleted with device sync by MUT-73) | 3 | Requested fields logged on a record-less entry; refused payment fields not logged; a derived status change logged. |
| `src/lib/__tests__/queryClient.test.ts` (new) | 2 | A local query and a mutation settle while `onlineManager` is offline. |
| `src/hooks/__tests__/useFxRate.test.tsx` | +1 | Offline, the FX query waits instead of fetching or erroring, and loads once online. |
| `e2e/income-fast-path.spec.ts` | +1 | Enter, Enter straight away creates the client and saves the entry; it fails with the replay disabled. |

**Final verification pass (2026-10-12):** each test was shown failing first, apart from the "still rejects tomorrow" guard.

| File | Added | Covers |
|---|---|---|
| `src/db/__tests__/paymentRecords.test.ts` | +3 | In New York at 21:30 (already tomorrow in UTC) `create` and `update` accept `new Date().toISOString()`; a timestamp whose local day is tomorrow is still rejected. The clock and `process.env.TZ` are set per test (`atInstantIn`). |
| `src/services/__tests__/paymentRequestService.test.ts` | +1 | Record Payment as the document page calls it (`new Date().toISOString()`) pays the receivable in the evening west of UTC. |
| `src/components/ui/__tests__/EntityTypeahead.test.tsx` | +1 | A box a failed pick emptied highlights nothing and lets Enter through. The `renderTypeahead` helper is now controlled, like every real picker. |
| `src/components/ui/__tests__/ProjectTypeahead.test.tsx` | 1 changed | A failed project create empties the box. |

### MUT-75 — the landing page story (epic MUT-74)

Test plan: `.claude/designs/mut-75-landing-story-tests.md`.

| Area | File | What is pinned |
|---|---|---|
| Structure | `src/pages/landing/__tests__/LandingPage.test.tsx` | `main` holds exactly hero, three chapters, privacy, get-it, faq in order, then the footer; the two-beat h1; each chapter's h2 |
| Honesty | same | no Buy / $49 / Universal / Intel in `main` (EN), no شراء / 49 (AR); "Free during early access"; Windows link only when `hasWindowsBuild`, otherwise a plain "isn't in this release" note; Mac says Apple Silicon; downloads still offered while the release is unknown |
| FAQ | same | exactly six disclosure buttons with `aria-expanded`/`aria-controls`/`hidden`; the data-loss warning appears once, inside the backup answer; the currency answer names all three currencies |
| Language | same | Arabic sets `dir="rtl"` and renders the Arabic h1; no raw `landing.` key in EN or AR; the payment chapter shows the app's own Record Payment label |
| Copy | `src/pages/landing/__tests__/landingCopy.test.ts` | `landing.*` key sets identical in en/ar; `CURRENCY_NAME_KEYS` covers USD/ILS/EUR (and `Record<Currency, …>` makes a missing one a compile error) |

Checked by hand in the browser pane (2026-10-11): 1440/1024/375 widths in EN and AR, live release v0.0.65 (no Windows build) showing the unavailable note, no horizontal scroll at 375.

**Baseline after MUT-75 (2026-10-11)**: root `npx vitest run` 162 files, 2574 passed, 5 skipped; `npm run typecheck`, `npm run lint` (0 errors, 17 pre-existing warnings in untouched files) and `npm run test:bundles` (web, desktop, hosted builds + bundle check) pass.

### MUT-76 — the landing hero (epic MUT-74)

Test plan: `.claude/designs/mut-76-landing-hero-tests.md`.

| Area | File | What is pinned |
|---|---|---|
| Device | `src/lib/__tests__/platform.test.ts` › `detectDevice` | Mac, Windows, iPhone, iPad-as-Mac (touch), Android-with-Linux-UA, desktop Linux, ChromeOS, empty signals |
| CTA rule | `src/pages/landing/__tests__/heroCta.test.ts` | mac/windows(+build)/everything-else → web; the alternative link; the sample list adds up per currency and is ranked |
| Hero | `src/pages/landing/__tests__/HeroSection.test.tsx` | exactly one `.hero-cta-primary` per device with the right href/label; Windows without an installer → web app; no `<img>`; Owed Now + sample clients present; animating digits `aria-hidden` with an `.sr-only` final value each |
| Count-up | `src/pages/landing/__tests__/useCountUp.test.ts` | reduced motion → target immediately; 0 → target over the duration with a stepped frame clock; a re-render doesn't restart it |
| Motion pref | `src/hooks/__tests__/usePrefersReducedMotion.test.ts` | reads the query, follows change events, unsubscribes on unmount, false without `matchMedia` |

Checked by hand (2026-10-12): Mac pane → Mac button; mobile emulation (Android UA) → web app + desktop link; 1280 EN/AR light/dark; 375 no horizontal scroll.

**Baseline after MUT-76 (2026-10-12)**: root `npx vitest run` 166 files, 2607 passed, 5 skipped; `npm run typecheck`, `npm run lint` (0 errors, 17 pre-existing warnings) and `npm run test:bundles` pass. Incidental: `utils.test.ts` › `todayISO` no longer fails between local midnight and the UTC rollover.

### MUT-78 — the visitor sample entry (epic MUT-74)

Test plan: `.claude/designs/mut-78-sample-entry-tests.md`.

| Area | File | What is pinned |
|---|---|---|
| Entry and exit (fake-indexeddb) | `src/demo/__tests__/visitorSample.test.ts` | empty database → sample on the business with clients owing, session recorded; second entry doesn't re-seed; own data → nothing written; areas switched on quietly (no notice) and remembered; a session without its rows re-seeds; leaving removes `demo_` rows and session additions (client, entry, payment record), switches the areas off, clears the session; older (restored) rows survive; `countSessionAdditions` counts only session rows |
| Seed | `src/demo/__tests__/seedDates.test.ts` | `notAfter`; no payment after now, no expense after today; one default, never a second next to an existing one |
| Hook | `src/demo/__tests__/useVisitorSample.test.tsx` | under `<StrictMode>`: enters once, ends `active`, selects the sample business, strips `?sample=1`; no parameter → nothing |
| Bar | `src/components/ui/__tests__/SampleDataBar.test.tsx` | message; hidden outside a session; leaves at once with no additions and navigates home; asks with the count when there are additions; "Keep looking" cancels; confirming leaves |
| Welcome | `src/components/modals/__tests__/WelcomeModal.sample.test.tsx` | opens on a first run; stays closed while the sample is prepared |

Checked by hand in the browser (2026-10-12) from a cleared origin: landing → "Or use it in your browser" → Clients of the sample business, no dialog, only the sample bar; "Start with your own" → Home with the Welcome dialog, database empty, all six areas off, session cleared. The StrictMode bug (stuck on "Setting up the sample…") was found this way and is now pinned.

**Baseline after MUT-78 (2026-10-12)**: root `npx vitest run` 171 files, 2630 passed, 5 skipped; `npm run typecheck`, `npm run lint` (0 errors, 17 pre-existing warnings) and `npm run test:bundles` pass.

### MUT-80 — drawers on springs (epic MUT-74, ADR-044)

Test plan: `.claude/designs/mut-80-drawer-springs-tests.md`. The tests were written before the code. Five deliberate mutations were each caught: no interrupt, no snapshot, no StrictMode guard, no focus return, and no dismissed flag. The StrictMode test had to be tightened to catch its mutation.

| Area | File | What is pinned |
|---|---|---|
| Physics | `src/lib/motion/__tests__/physics.test.ts` | Projection (1000 px/s → 499 px); rubber band (0.55 near the edge, bounded, signed, inverse round-trips); response 0.3 / ζ 1 → k ≈ 438.65, c ≈ 41.89; velocity over the last 100ms, zero for a pause or shared timestamps |
| Gesture rules | `src/components/ui/drawer/__tests__/drawerGesture.test.ts` | 10px hysteresis, with ties going to scroll; RTL closing axis; the display offset is capped at the exit distance and rubber-banded past open; release by projected momentum (half stays open, a flick from 60px closes); overlay opacity; no-drag targets |
| Snapshot | `src/components/ui/drawer/__tests__/exitSnapshot.test.ts` | Values, selection and checks copied; `aria-hidden` + `inert` + no pointer events; attached where the original was (or appended); scroll restored; removed |
| Frame | `src/components/ui/drawer/__tests__/DrawerFrame.test.tsx` | Named dialog; synchronous `onClose`; enter from the edge to rest with no inline transform; a snapshot exit in LTR and RTL; none under StrictMode or without layout; reduced-motion fades; drag past half → `onClose` after the exit; short drag → spring back; 1:1 tracking and overlay at 0.5; vertical and field presses ignored; caught mid-exit → stays open; focus in, autofocus kept, Tab wrap, return to trigger, not stolen back |
| Focusables | `src/lib/dom/__tests__/focusable.test.ts` | Order; disabled, `tabindex=-1`, hidden inputs and `[hidden]` skipped |
| Real browser | `e2e/drawer-motion.spec.ts` | Escape: the dialog is gone at once, and the snapshot slides right past 400px and is removed. A 120px drag springs back; a 320px drag closes. In Arabic the panel is at x = 0 and a drag left closes it. |

Not covered: touch on a real device (Playwright drove a mouse), and trackpad swipes (out of scope). The hidden preview pane pauses `requestAnimationFrame`, so motion was checked in Playwright, not in the pane.

**Baseline after MUT-80 (2026-10-12, before merging main)**: root `npx vitest run` under Node 22: 187 files, 2923 passed, 4 skipped. `npm run typecheck` and `npm run lint` (0 errors) pass, the 3 new Playwright specs pass, and `npm run test:bundles` passes.

**After merging main** (TD-009's drawer naming and the release front door): the two `Drawer.tsx` conflicts resolved to the `DrawerFrame` wrappers, whose shell carries TD-009's `aria-labelledby`, `common.close` and `aria-hidden` icon. Typecheck passed, and lint reported 0 errors. All 22 Playwright specs pass, including axe on every surface and main's new `Drawer.test.tsx` files. A full vitest run at load average ~45 (other sessions) timed out 4 heavy tests, each at about 5s. Every file that timed out passed when re-run alone (2,941 tests across both runs; no assertion failed).

### MUT-79 — app frame: nothing floats over content (epic MUT-74)

Test plan: `.claude/designs/mut-79-app-frame-tests.md`.

| Area | File | What is pinned |
|---|---|---|
| Dialog mode | `src/hooks/__tests__/useMenuButton.test.tsx` | `aria-haspopup="dialog"`, `role="dialog"`, `aria-controls`. Opening focuses the first enabled control, or the panel when there is none. Tab between controls stays open; Tab past the last, or Shift+Tab past the first, closes. Arrows don't move focus. Escape refocuses the button. An outside press closes, an inside one doesn't. The menu-mode tests are unchanged. |
| FX readout | `src/components/layout/__tests__/FxRateReadout.test.tsx` | `$1 = ₪3.06`, named "Exchange rate: …", a dash with no rate. Dialog "Exchange rate": both rates at 4 decimals, their sources, the rate date and the update time; no date lines when unavailable. Refresh is focused on open, refetches both, and is disabled while loading. Escape refocuses the readout. |
| Popover placement | `src/components/layout/__tests__/popoverPosition.test.ts` | `nudgeInside`: fits → 0; past the right or left edge → back inside with the margin; wider than the bounds → pinned left |
| Theme | `src/lib/theme/__tests__/themeModes.test.ts`, `src/components/layout/__tests__/ThemeToggle.test.tsx` | `THEME_MODES` order; `nextThemeMode` cycles. The toggle names the current mode, and each press sets `data-theme` (none for System) and saves `mutaba3a-theme`, the state Settings reads. |
| Frame placement | `SidebarNav.features.test.tsx`, `TopBar.addMenu.test.tsx` | The toggle shares Settings' footer row, expanded and collapsed. The readout is in the top bar, with or without Add. |
| Mac bar | `src/components/ui/__tests__/MacDownloadBanner.test.tsx` | Shows on a Mac browser. Hidden on an iPad (MacIntel + touch), on Windows, in Tauri, and after dismissal (also after a remount). Throwing storage doesn't break it. |
| Retired keys | `src/lib/__tests__/retiredStorage.test.ts` | Removes `mutaba3a_fx_banner_state` and keeps other keys; survives throwing storage |

Checked by hand in the browser (2026-10-12, sample data):
- **Overlap sweep:** no `fixed`/`sticky`/outside-`absolute` element intersects `<main>` at 1440, 1024, 768 or 375 px.
- **Popover:** opens by mouse, Escape returns focus.
- **Theme:** the toggle cycles System → Light → Dark, and Settings → Theme agrees both ways.
- **Arabic:** the formula reads `$1 = ₪3.06`. At 575 px the popover was being clipped by `<main>`, which led to `nudgeInside` (it now shifts −83 px and fits). Amounts are unchanged.
- **Mac bar:** in flow (`position: static`); dismissed, it stays gone after a reload.

**E2E (after merging main, which ported the stale specs):** all 19 Playwright specs pass, run through a throwaway config on port 5194. Axe no longer reports `landmark-no-duplicate-banner` on any of the six surfaces, so it was removed from `KNOWN_AXE_VIOLATIONS`, and no new rule fires.

**Baseline after MUT-79 (2026-10-12)**: root `npx vitest run` **under Node 22** 182 files, 2857 passed, 4 skipped; `npm run typecheck`, `npm run lint` (0 errors, 16 pre-existing warnings) and `npm run test:bundles` pass. Under Node 26, files that touch `localStorage` fail even on main (TD-054).

### MUT-64 — device sessions, native app sign-in for hosted accounts (`server/`, epic MUT-63)

Plan: `.claude/designs/mut-64-device-sessions-tests.md`. Written red first per file; each new file confirmed failing for the right reason (missing export/route) before implementation.

| Area | File | What is pinned |
|---|---|---|
| Token shape | `src/auth/__tests__/sessions.test.ts` | `mds_` + 43 base64url chars, no repeats; same `sessionDigest` under the same pepper as a cookie token; `isDeviceSessionToken` true/false table incl. an API-key-shaped string |
| Shared sign-in core | `src/auth/__tests__/sign-in.test.ts` | success threads `sessionKind`/lifetime into the session row; wrong password / unknown email / disabled user all `INVALID_CREDENTIALS`; lockout refuses the right password without a verify; throttle clears and `recordSignIn` fires on success; audit row carries `metadata.sessionKind` |
| Middleware dispatch | `src/auth/__tests__/middleware.test.ts` (new) | a device bearer reaches `GET /v1/me` with full session access; refused on an apiKey-only route (`/v1/audit`); unknown/expired/revoked device session → `SESSION_EXPIRED`; device bearer + cookie together → ambiguous; a device token never parses as an API key and vice versa; missing/non-member `X-Mutaba3a-Profile` with a device bearer → 422/404, same as a cookie session |
| Device-session routes | `src/__tests__/routes-device-sessions.test.ts` (new) | sign-in returns a token with no `Set-Cookie`; succeeds with no `Origin` header at all (the CSRF exemption is real, not accidentally-passing); unknown email / wrong password identical; lockout matches the portal's window; per-IP 429; validation 422; sign-out revokes, reuse afterward refused; no credential / an API key on sign-out → `UNAUTHENTICATED` / `PRINCIPAL_NOT_ACCEPTED` |
| Route security (extended) | `src/__tests__/route-security.test.ts` | `deviceSession` accepts exactly the cookie-session surface minus cookie sign-out plus device sign-out; a device bearer is refused on every key-only operation (READ_ONLY_PROFILE / PRINCIPAL_NOT_ACCEPTED, same as a cookie session); an API key is refused on every device-session-only operation; a device bearer is let through on every operation that declares it |
| Expense CRUD via device token | `src/__tests__/routes-expenses.test.ts` | one focused case: create, edit (`PATCH`) and delete an expense authenticated with a device bearer instead of a cookie — the ticket's named acceptance example |
| Admin revocation | `src/__tests__/routes-sessions.test.ts` (extended) | password reset, disable, and explicit "revoke all" each hold a cookie session and a device session for the same user and prove both are revoked; the explicit revoke-all count reflects both (`2`, not `1`) |
| Storage contract (memory + Postgres) | `store-contract-sessions.ts` (extended) | `kind` round-trips through `create`/`findByDigest`; `revokeAllForUser` revokes a cookie and a device session together in one call |
| Config | `src/__tests__/config.test.ts` (extended) | `DEVICE_SESSION_IDLE_DAYS`/`DEVICE_SESSION_ABSOLUTE_DAYS` default to 30/180, bounds enforced |
| ADR-037 invariant (regression) | `src/__tests__/no-self-registration.test.ts` | unchanged; confirmed the new route names don't trip the forbidden-word regex |

**Baseline after MUT-64 (2026-10-12)**: server `npm test` 1110 passed, 11 skipped; server `npm run typecheck`/`npm run lint` clean; `store-contract-sessions.ts` also run against a local Postgres (`mutaba3a_dev_mut64`) via the Prisma-backed store; root `npm run typecheck` (app + hosted programs), `npm run openapi:check` and `npm run hosted:types:check` all clean.


### E2E port-over — the stale Playwright specs on the current UI (TD-004, 2026-10-12)

> **Superseded 2026-10-12 (MUT-97)**: `e2e/` was retired in favor of `qa/` (the
> release-qa kit, companion to Malafat's MAL-1007). Every file and path named
> below was ported to `qa/specs/web/*.spec.ts` with the same coverage, tagged
> `@web.<area>.<id>` and described in `qa/features/web/*.yaml`. This section
> stays as the historical record of the 2026-10-12 port-over itself.

The 13 cases that failed on main (stale paths without `/app`, pages that no longer exist, the pre-MUT-5 drawer) are each updated or removed. Helpers live in `e2e/support/`:
- `openFreshApp(page, path)` waits for the Welcome dialog and skips it, which creates the default USD profile;
- `openNewIncomeDrawer(page)` opens the drawer from the top bar's "+ Add" › Income;
- `logIncome(page, …)` logs an entry for a new client;
- `expectOnlyKnownAxeViolations(page, surface)` fails on any axe rule not listed for that surface in `KNOWN_AXE_VIOLATIONS` (TD-009).

| File | Was | Now |
|---|---|---|
| `e2e/accessibility.spec.ts` | 7 cases: Overview, Transactions, Projects, Clients, Reports, Settings, transaction drawer. None reached its page | 7 cases. On a fresh install: Home first run (Get Started), Settings, the income drawer with More details open. With one entry logged: Home, Clients, the client profile, Income. Projects and Reports were removed: optional areas, off by default, whose routes send you home. Transactions was removed: `/transactions` redirects to Income |
| `e2e/settings.spec.ts` | 4 cases: language, theme, data management, theme toggle. The theme case passed without reaching Settings: `/settings` is outside the `/app` basepath, and its loose text matches hit whatever rendered there | 3 cases: switching to Arabic sets `lang="ar"` and `dir="rtl"`, and English restores them; Dark, Light and System set and clear `html[data-theme]`; Data Management › Export JSON › Export downloads `mutaba3a-Default-Profile-<date>.csv`. The "show theme" case is folded into the theme switch |
| `e2e/income-drawer.spec.ts` (was `transaction.spec.ts`) | 3 cases: create income, empty-amount error, Income/Expense/Receivable type switch | 3 cases: an amount alone saves an entry that shows as Unpaid, with No client, in the Income list; Save with no amount shows "Amount is required" and keeps the drawer open; under More details, Due Date shows for Earned and Invoiced and hides for Received. The type switch no longer exists: a receivable is unpaid income, and expenses are an optional area |
| `e2e/navigation.spec.ts` | passed alone, failed once under parallel load | Uses `openFreshApp`. The old one-off `isVisible()` check could run before the Welcome dialog mounted, and the dialog then swallowed the first sidebar click |

**Verified:**
- 19/19 pass with `income-fast-path.spec.ts`, which is unchanged.
- The suite also passes `--repeat-each 3` (57/57) and `--repeat-each 2` (38/38, after the rebase onto MUT-64/MUT-78), and on a cold dev server started by Playwright. The slowest test took 12 s.
- Mutation check: taking `heading-order` off the Settings allowlist fails that case. The failure names the rule, its help text and the element.
- `eslint e2e` and `tsc --strict` over `e2e/` are clean. `e2e/` is in no tsconfig program, so `npm run typecheck` doesn't cover it.

**How it was run:** the committed `playwright.config.ts` pins 5173 (TD-004). The runs used a throwaway config with `webServer: npx vite --port 5193 --strictPort` and `reuseExistingServer`, deleted afterwards along with `test-results/`.

**Gate (2026-10-12, on main 89a0adb plus this branch):** `npm run lint` shows 0 errors and 16 warnings, none in `e2e/`. `npm run typecheck` is clean. `npx vitest run`: 176 files, 2,832 passed, 4 skipped. `npm run build` is OK.

### MUT-65 — personal hosted profiles accept income, clients and matters (`server/`)

Plan: `.claude/designs/mut-65-personal-profile-income-tests.md`. Four mutation checks were manually applied, confirmed failing, and reverted (noted inline below); the `deletedAt` exclusion check is pinned permanently.

| Area | File | What is pinned |
|---|---|---|
| Per-profile writability (unit) | `auth/__tests__/writability.test.ts` (new) | `sessionAccessFor`/`sessionScopesFor`/`mayWriteFor` on the three profile-dependent domains; non-regression guards that `agreements`/`attachments`/`expenses` are unaffected; `PROFILE_DEPENDENT_DOMAINS` is exactly the three named |
| Drift | `__tests__/writability-drift.test.ts` | the brief's literal `read; read-write on a personal profile` suffix on exactly the three rows, backed directly by `sessionAccessFor` |
| Store guard | `auth/__tests__/store-guard.test.ts` | the generic per-method `describe.each` corrected for per-profile reality (mutation-checked: reverting `mayWriteFor` to the static `mayWrite` fails 15 of its cases); a real proxy positive-path test (`session`, `writer: null` now allowed where `MALAFAT` is refused); the two new receivables methods classified `{ write: 'payments' }` |
| Sessions | `__tests__/routes-sessions.test.ts` | `GET /v1/me`'s `access` map differs by organization (a personal profile's three rows read `read-write`, a Malafat-fed one's read `read`) |
| Pure compose | `income/__tests__/compose.test.ts` (new) | `resolveIncomeLinks` (Owed requires a customer; a project resolves/validates its customer; archived links allowed); `dueDateForOwed` (EOM_15 default incl. last-day-of-month and leap-February boundaries); `owedVatFields` (always OUT_OF_SCOPE/zero, regardless of any configured rate); `assertNotFuture` (same day accepted, backdated accepted, future rejected) |
| Repository contract | `repositories/__tests__/store-contract-m4.ts` (extended) | `createAdjustment` (with/without a matter, FK violations); `softDeleteAdjustment` (idempotent, excluded from every read, cross-organization null) **and the deletedAt mutation check**: a voided Owed entry is absent from `listEligible` and doesn't count in `countOutstandingByProject`; a clientless/matter-carrying Received payment; `getByIdIncludingDeleted` (sees a voided row, still organization-scoped) |
| Routes: income | `__tests__/income-routes.test.ts` (new) | Received (no client / with client / with client+matter) and Owed (with/without a matter; no client → 422 `CUSTOMER_REQUIRED_FOR_OWED`) on a personal profile; future/backdated `occurredOn`; `dueDate` default; missing/replayed/mismatched Idempotency-Key; `captureSource` present/absent on the audit row; every write audited `actorType: USER`; refused `READ_ONLY_PROFILE`/`PRINCIPAL_NOT_ACCEPTED` on a Malafat-fed profile with nothing written; undo (Received reversed, Owed voided, both idempotent on repeat, 409 on settled/allocated, 404 across users/organizations and on an unknown id); the read-surface agreement (`GET /v1/receivables?customerId=`, `GET /v1/summaries/organization`'s Owed→Overdue bucketing, two independent currency blocks, a partial settle's outstanding delta) |
| Routes: settle | `__tests__/receivables-settle.test.ts` (new) | full and partial settle; `amount` over outstanding → 422; future/backdated/defaulted `paidAt` (lands on `Payment.receivedOn`); idempotent replay; Malafat refusal; cross-organization 404; an already-settled receivable → 422 `RECEIVABLE_NOT_OPEN`; method default/override; `captureSource` on the audit row; `payment.recorded`/`receivable.settled` audited `actorType: USER` |
| Inventory (generic, route-derived) | `__tests__/writability-routes.test.ts`, `__tests__/route-security.test.ts` | the three new/changed routes fold into the existing matrix-driven and principal-driven sweeps with no hand-kept list drifting out of sync; `POST /v1/customers`/`/v1/projects` move out of the key-only set; `INCOME_OPERATIONS` is the new session-only trio |
| Mutation checks (manual, reverted) | — | undo's ownership check (another user's entry wrongly succeeds without it); the `paidMinor`/`creditedMinor` guard (an already-settled entry wrongly deletes without it); `selectProfile`'s `sessionScopesFor` wiring (every positive case fails without it); `store-guard.ts`'s `mayWriteFor` (15 store-guard cases fail without it, independently of the scope layer) |

**Not run in this environment**: `npm run test:db` (the Prisma contract against Postgres, and the migration applying from an empty/pre-existing database) — no `MUTABA3A_TEST_DATABASE_URL`/`DATABASE_URL` configured here. The Prisma repository code and the migration SQL were written and reviewed against the schema and the existing M4 migration's conventions, but not executed.

**Post-review pass (2026-10-12)** — four approved fixes, each written test-first and watched fail for the right reason before the fix:

| Fix | Test | Red looked like |
|---|---|---|
| Settle refuses a non-ADJUSTMENT receivable (404) | `__tests__/receivables-settle.test.ts` — seeds a real installment-origin receivable through `agreements.create` + `postInstallment`, then settles it | 201: a Malafat installment settled from a session, bypassing the allocation engine |
| Settle maps `InsufficientCapacity` → 409 `VERSION_MISMATCH` | same file — a store proxy arms the next `payments.create` to throw it (the `FOR UPDATE` re-read losing the race) | 500, and `idempotency.ts` releasing the key on a 5xx |
| `softDeleteAdjustment` re-asserts the money guard in its `WHERE` | `repositories/__tests__/store-contract-m4.ts` (runs against **both** stores): paid and credited rows come back undeleted, a clean one still voids. Route level: `__tests__/income-routes.test.ts` stages the race with a one-shot `interleave` hook that fires a real settle between the undo's guard read and its write | contract: the paid row voided anyway; route: 204, with a POSTED payment allocated to a now-hidden receivable |
| The customer summary counts matterless Owed | `__tests__/income-routes.test.ts` — the AC 3 test (title corrected; it had baked the gap in as expected behaviour) now asserts the client block's buckets and status before/after the due date, plus a second test for an Owed whose currency nothing else touches | buckets `0.00`/`SETTLED`; the second test: no USD block at all |

New harness affordances, both minimal and local to their test file: `harness(wrap)` in `receivables-settle.test.ts` lets one test hand the app a stubbed store while assertions keep reading the real one; `h.interleave` in `income-routes.test.ts` registers a one-shot side effect to run immediately before a named store call.

**Baseline after MUT-65 (2026-10-12)**: server `npm test` 1159 passed, 11 skipped. lint, typecheck, build and `openapi:check` pass.
**Baseline after the MUT-65 post-review pass (2026-10-12)**: server `npm test` 1171 passed, 11 skipped (72 files). lint, typecheck, build and `openapi:check` pass. `npm run test:db` still not runnable here (no `MUTABA3A_TEST_DATABASE_URL`), so the new `softDeleteAdjustment` contract case has been executed against the memory store only; the Prisma `WHERE` clause change is unexecuted.

### TD-009 — the structural axe violations on the core surfaces (2026-10-12)

Plan: `.claude/designs/td-009-axe-structural-tests.md`. Each new assertion was written first and failed on the old code (16 of them; the English "Close" case already passed, because the label was hard-coded English).

| File | Covers |
|---|---|
| `src/components/drawers/__tests__/Drawer.test.tsx` (new) | The drawer is a dialog named by its title, and the name follows a title change; two open drawers each have their own name; the close button is "Close" in English and "إغلاق" in Arabic |
| `src/hosted/components/__tests__/Drawer.test.tsx` (new) | The portal's drawer is a dialog named by its title |
| `src/components/filters/__tests__/DateRangeControl.test.tsx` | The preset select is a combobox named "Period"; with a custom range, the date inputs are labelled "From" and "To" |
| `src/components/ui/__tests__/RowActionsHeader.test.tsx` (new) | It is a column header named "Actions", and the text is `.sr-only` |
| `src/pages/income/__tests__/IncomePage.test.tsx` | The Income table has an "Actions" column header, and the period select is named |
| `src/pages/clients/__tests__/ClientDetailPage.test.tsx` | The work table and the payments table each have an "Actions" column header, and the work list's period select is named |
| `src/pages/settings/__tests__/SettingsPage.a11y.test.tsx` (new) | The default-currency select is named by its `<label>` and described by its row's description; each profile's ⋯ button is "Actions for <name>", and `aria-expanded` follows it open; the eight section titles are `h2` under the `h1`, with no `h3` |
| `src/pages/settings/__tests__/AdvancedFeaturesSection.test.tsx` | The section title is a level-2 heading |
| `src/lib/i18n/__tests__/a11yKeys.test.ts` (new) | `common.actions`, `common.close`, `filters.period`, `filters.periodFrom`, `filters.periodTo` and `settings.profile.actionsFor` are non-empty in en and ar; `{name}` is kept in both |
| `e2e/support/axe.ts` | `KNOWN_AXE_VIOLATIONS` is only `color-contrast`, so any of the five fixed rules coming back fails `accessibility.spec.ts` |

**Found by the e2e run, not by jsdom:** the first Settings fix named the select with `aria-labelledby`. That passed `select-name`, but axe's best-practice `label-title-only` fired. Axe's `labelVirtual` takes a labelledby target's *on-screen* visible text, and the label sat at y = 890, outside the 720 px `overflow: hidden` `.main-content`/`.app-shell`. A `<label for>` is checked for screen-reader visibility only, so it passes wherever it is scrolled. The unit test now asserts the label is a `LABEL`.

**Verified in the browser** (dev server, 800×600 and 1024×768, English and Arabic):
- The Settings section titles and the currency row look unchanged. `.settings-label` is `display: block`, so the `<label>` lays out like the `<div>`s: 20 px tall, with the select still 440 px wide.
- In Arabic, the period select is "الفترة", the new-income drawer is labelled "إيراد جديد", and its close button is "إغلاق".

**How e2e was run:** a throwaway config on port 5193 (`webServer: npx vite --port 5193 --strictPort`, TD-004), deleted afterwards along with `test-results/`.

**Gate (2026-10-12, branch head 976093d on main 4eaa583):**
- `npx playwright test`: 19/19. `accessibility.spec.ts` passed 7/7 again after the CSS change.
- `npx vitest run` (Node 22, TD-054): 187 files, 2,875 passed, 4 skipped.
- `npm run lint`: 0 errors, 16 warnings, none in changed files.
- `npm run typecheck`: clean.
- `npm run build` and `npm run test:bundles`: OK.

Main 8ef2df0 (MUT-65: `server/` and docs only) was merged in afterwards. Only lint and typecheck were re-run on the merged tree.

### Release tooling — `make release web` / `make release server` (ADR-043, 2026-10-12)

No automated tests. These scripts deploy; a test suite for them would either mock away the only thing they do or actually push and roll. They are verified by running the non-destructive halves and by reading the destructive half's dry run. What was verified on 2026-10-12, on `main` at `4eaa583`:

| Checked | How | Result |
|---|---|---|
| `make help`, target dispatch | `make help`; `make --dry-run release web`; `make --dry-run release server` | pass |
| An unknown target is rejected | `make release desktop` | exits 2, "unknown release target" |
| Shell/Makefile syntax | `bash -n` on all three scripts; `make --dry-run` | pass |
| Preflight catches a real dirty tree | `make preflight-web` with 8 uncommitted files | fails, lists them |
| Preflight catches parked worktrees | same run, 2 epic worktrees checked out | fails, names both |
| Preflight catches stale deps | `scripts/preflight.sh web` before `npm ci` | fails ("package-lock.json is newer than node_modules") — this is what the missing `openapi-typescript` binary looked like before the check existed |
| …and passes once fixed | after `npm ci` | passes |
| Server tools/credentials/config | `make preflight-server` | gcloud, ADC, docker, terraform, cloud-sql-proxy, tfvars all detected; `GCP_PROJECT_ID` and `TF_STATE_BUCKET` derived and cross-checked; `gs://…` confirmed readable |
| The version prompt | `scripts/bump-version.sh server` with `9` then `2` | re-prompts on `9`, bumps minor `0.1.0 → 0.2.0` on `2`; reverted |
| Non-interactive bumps | `BUMP=patch make bump-web`; `BUMP=keep`; `BUMP=custom BUMP_VERSION=9.9` | `0.0.65 → 0.0.66` across all five manifests **including `Cargo.lock`**; keep is a no-op; `9.9` rejected; reverted |
| No terminal, no release | piped stdin, `/dev/tty` unopenable | bump and confirm both refuse with "set BUMP=…" / "re-run with AUTO=1" rather than hanging or defaulting to yes |
| Server gates | `make check-server` | pass — lint, typecheck, **1210 tests**, `openapi:check` up to date, build |
| Web gates | `make check-web` | lint (0 errors, 19 warnings), typecheck, **2857 tests**, and `test:bundles` (3 builds + the leak guard) all pass; **`hosted:types:check` fails** — pre-existing drift on `main`, logged as TD-058 |

Not exercised, by nature: the push, `server/scripts/deploy.sh`, and the Netlify build. The confirmation in front of each is the tested part.

### MUT-58 — prune the money-event read side (2026-10-12)

Plan: `.claude/designs/mut-58-prune-money-events-tests.md`. A deletion with zero behaviour change. The guard and the two flipped assertions were written first and failed (7 red) before anything was deleted.

| File | Covers |
|---|---|
| `src/__tests__/noDeadMoneyEventModules.test.ts` (new, 6) | `useMoneyEventQueries.ts`, `moneyEventRepository.ts` and `lib/monthDetection.ts` stay gone; no file under `src/` (tests included, since they are outside `tsc`) names them or `invalidateMoneyEventQueries`; `src/types/index.ts` declares none of the twelve money-event and guidance types; `moneyEventVersions` is still a Dexie table (ADR-029) |
| `src/hooks/__tests__/useQueries.test.tsx` | `useCreatePaymentRecord` still invalidates the income, receivable, payment and transaction keys, and no `money*` key (was: asserted three money-event keys) |
| `src/hooks/__tests__/useIncomeQueries.test.tsx` | ~~`useMarkIncomePaid` invalidates `income` and `transactions`, and no `money*` key (was: "should invalidate the derived money-event views")~~ (hook and test deleted, MUT-98 2026-10-13 — see the Hook row earlier in this file) |

Removed with their subjects: `src/db/__tests__/moneyEvent.test.ts` (5), `src/hooks/__tests__/invalidateMoneyEventQueries.test.ts` (10) and `src/lib/__tests__/monthDetection.test.ts` (23), 38 tests in all.

**How e2e was run:** a throwaway config on port 5198 (`webServer: npm run dev -- --port 5198 --strictPort`, output in the session scratchpad, TD-004), deleted afterwards and never committed.

**Verified in the browser** (`web-mut58`, `/app/`, a fresh install): saved an unpaid $500 income for a new client, and Home's Owed now read $500. Marked it fully paid; Income moved it to Received, Home read "Nothing owed" with the payment under Recent payments, and Clients showed the client settled with the payment as the last one. Turned on Expenses and saved a $42 expense, which the ledger listed. No console errors. The ledger's Total expenses strip read ₪0 before and after a reload. That is not this change: the strip reads `useOverviewTotalsByCurrency` (expense *transactions*), and the rows come from the `expenses` table.

**Gate (2026-10-12, branch `feature/mut-58-prune-money-events` on main 5674515, Node 22):**
- `npx vitest run`: 185 files, 2,843 passed, 4 skipped. Before: 187 files, 2,875 passed, 4 skipped; the difference is the 38 deleted tests and the 6 new ones.
- `npx playwright test` (port 5198): 19/19.
- `npm run lint`: 0 errors, 16 warnings, none in changed files.
- `npm run typecheck` and `npx tsc -b`: clean.
- `npm run build` and `npm run test:bundles`: OK.

### MUT-86 — the Record payment drawer leads with what's left (epic MUT-74, 2026-10-12)

Plan: `.claude/designs/mut-86-payment-drawer-tests.md` (T1–T22). Written first: 38 of the new tests failed against the old drawer before the code changed.

| Acceptance criterion | How it is met | Covered by |
|---|---|---|
| Open, then Record payment, records the full remaining amount for today ("Paid? Two taps.") | Amount prefilled with the balance and selected, date today, one primary button that records and closes | `PartialPaymentDrawer.test.tsx` "two taps"; `e2e/record-payment.spec.ts` (click, and Enter in the amount) |
| The live line updates on every keystroke and reads Arabic-Indic digits | `describePaymentAmount` on every render, with MUT-5's `parseAmountInput` | `PartialPaymentDrawer.test.tsx` "the live line" (1 → 10 → 100, "١٠٠"); `paymentEntry.test.ts`; e2e partial payment |
| Overpayment still rejected inline (MUT-6 D1); future dates rejected (ADR-038) | Over shows live, and Record refuses it with no mutation call; `isFuturePaymentDate` (now in `lib/dates.ts`) refuses a future date; an emptied date is refused too | `PartialPaymentDrawer.test.tsx` "refused inline" and "the date"; `dates.test.ts` `isFuturePaymentDate` |
| Edit mode still works | Record's amount, date and notes prefilled; allowed includes its own amount; Update sends the record and returns to the entry; waits for the records to load | `PartialPaymentDrawer.test.tsx` "edit mode" (4) |
| The removed strings' i18n keys are deleted | `markFullyPaid` is gone from en and ar; new keys exist in both | `paymentDrawerKeys.test.ts` |
| Tests cover two taps, partial, notes kept, overpayment | All four | `PartialPaymentDrawer.test.tsx` "two taps", "a partial payment", "notes", "refused inline" |

| File | Tests | Covers |
|---|---|---|
| `src/components/drawers/__tests__/PartialPaymentDrawer.test.tsx` (rewritten) | 33 | Title with the balance; prefill (whole and with cents) and selection; exactly Cancel + Record Payment; no chips, box or empty history; two taps; the live line by keystroke, Arabic-Indic digits, quiet while "1,2" is half typed, overpayment live; partial; notes behind "+ Add note" and kept; refused inline (over, "1,2", "0", "€100"), errors clearing on change; date row, backdate, future, empty; ADR-022 at two instants; edit mode (prefill, allowed, update, waits for records); history below the form and its edit button; settled entry; repository rejection keeps the drawer open |
| `src/lib/__tests__/paymentEntry.test.ts` (new) | 19 | `describePaymentAmount` (all kinds, symbols and codes, Arabic-Indic and Extended digits, separators, grouping); `minorToAmountInput` and its round trip |
| `src/lib/__tests__/dates.test.ts` | +5 | `isFuturePaymentDate`: date-only, local-evening timestamp, tomorrow's timestamp, unreadable timestamp, clock default |
| `src/lib/i18n/__tests__/paymentDrawerKeys.test.ts` (new) | 5 | New keys in en and ar with `{amount}`; `markFullyPaid` gone |
| `e2e/record-payment.spec.ts` (new) | 4 | Two taps by click; Enter records; a partial leaves the rest owed; axe on the open drawer with date and note revealed (`paymentDrawer`: `color-contrast` only) |

The repository's own future-date and overpayment tests (`paymentRecords.test.ts`, `partialPayment.test.ts`) pass unchanged against the moved helper.

**Verified in the browser** (web-mut86 preview, `/app/clients?sample=1`):
- English light and dark, and Arabic dark, at 800×600. Title, prefill, "Paid in full", "Today ›", "+ Add note" and one primary button; a partial amount with a note recorded and closed; Enter recorded; edit from the client's Payments list; overpayment live.
- In Arabic: "تسجيل دفعة · المتبقي ₪ 4,300", the chevron points left, the amount stays LTR, and "١٠٠٠" gives "يبقى ₪ 3,300 مستحقًا".
- At 375 px: every drawer is a fixed 480 px, so it is wider than the screen there. That comes from the shared `Drawer` (MUT-80 is reworking it). With the drawer forced to 375 px, nothing inside it overflows.
- Found and fixed: global `.payment-row` and `.payment-amount` in `index.css` squeezed the field to 120 px, so the classes are now `pay-drawer-`. The history rows' fallback colours were light in dark mode, so they now use theme tokens.
- Found and logged: TD-062 (`formatAmount` prints "$887.5"), TD-063 (sample part-paid entries lose their seeded received amount on the first payment).

**How e2e was run:** a throwaway config on port 5195 (`webServer: npx vite --port 5195 --strictPort`, TD-004), deleted afterwards along with `test-results/`. All 23 specs passed.

**Gate (2026-10-12, branch head dad50d2 on main 5674515, Node 22 per TD-054):**
- `npx vitest run`: 189 files, 2,923 passed, 4 skipped. An earlier full run on the same code had 3 tests and 2 suites time out under the load of four parallel lanes. They were `ExpenseDrawer.oneTimeFields`, `RetainerDrawer.projectField`, `CurrencyTabs`, `router.gates` and `legacyRedirects`. Rerun alone, those 5 files passed (35 tests), and the full rerun was clean.
- `npx playwright test` (throwaway config, port 5195): 23/23, including the 4 new specs.

### MUT-87 — Expenses Needs attention, one row per recurring rule (epic MUT-74, 2026-10-12)

Plan: `.claude/designs/mut-87-recurring-rows-tests.md` (T1–T30). ADR-052.

| File | Covers |
|---|---|
| `src/components/expenses/__tests__/recurringAttention.test.ts` (new, 15) | Grouping: one payment, several out of order (oldest first), several rules (ordered by oldest payment, title, id; never mixed), the row's fields, empty input; per-currency totals (no zero, USD → ILS → EUR, never combined); month lists in English and Arabic, the year only across two years, date-only values read as local dates; snooze dates across month and year ends |
| `src/lib/__tests__/currencyAmounts.test.ts` (new, 2) | `orderCurrencyAmounts` order and zero handling |
| `src/services/__tests__/recurringExpenseService.batch.test.ts` (new, 12, fake-indexeddb) | `confirmPayments` writes one expense per payment on its own expected date and links each occurrence; a partial selection leaves the rest due; **a failure on the second write leaves no expense and no occurrence**; an unknown rule writes nothing; an edited amount is the expense amount and `actualAmountMinor`, an unedited one leaves it unset; `skipOccurrences` (one, all, all or nothing); `snoozeOccurrences` (a date, a past date rejects the batch); `frequency` on virtual occurrences |
| `src/hooks/__tests__/useRecurringExpenseQueries.test.tsx` (3 replaced) | The batch hooks call their service function once and invalidate occurrences, due occurrences, the rule's history, and expenses only on confirm |
| `src/hooks/__tests__/useExpenseQueries.test.tsx` (+1) | Editing a rule invalidates `dueOccurrences` and `virtualOccurrences` |
| `src/components/expenses/__tests__/RecurringAttentionList.test.tsx` (new, 5, real dictionaries) | One row per rule with months, period amount, total and lateness; a one-payment rule ("Oct not marked", "Skip", "Snooze…"); the header's count and side-by-side totals in `<bdi dir="ltr">`; Mark Paid and the ⋯ menu by keyboard (focus on open, arrows, Escape back to the button) and each item's handler; Arabic month names, LTR amounts and the `few` plural form |
| `src/components/drawers/__tests__/RecurringMarkPaidDrawer.test.tsx` (new, 10, real dictionaries) | All payments checked with their dates; Mark 3 paid sends each expected date; partial selection and the counted button; none checked disables it; an edited amount is sent, an unreadable, zero or other-currency amount blocks saving with the field error; per-payment Skip asks first; per-payment Snooze through the snooze view and back; Snooze all with a quick pick; a date not after today is refused; Cancel closes; Arabic |
| `src/pages/expenses/__tests__/ExpensesLedgerPage.test.tsx` (+4) | The grouped section replaces the cards; Mark Paid opens the drawer on the rule; ⋯ › Skip all asks and skips every payment; ⋯ › Edit rule opens the expense drawer on the rule |
| `src/lib/i18n/__tests__/recurringAttentionKeys.test.ts` (new, 5) | Every new string in en and ar with its placeholders; every counted string has `one`/`other` in English and all six forms in Arabic |
| `src/__tests__/noDeadExpenseModules.test.ts` (+1) | The two recurring modals stay deleted and unexported |

**Verified in the browser** (dev server `web-mut87`, Expenses switched on, two monthly rules started in July and September): the grouped rows, the header totals ($240 and ₪7,000 side by side), the ⋯ menu by keyboard, Mark 2 of 3 paid (IndexedDB holds expenses dated 2026-08-05 and 2026-10-05, the row then reads "Sep not marked"), a per-payment snooze and back, and Snooze all, in English and Arabic (RTL), light and dark, at 1024 px and 375 px. At 375 px every drawer is wider than the screen (TD-070, the shared `Drawer`). The "Total expenses" strip stayed ₪0 after marking expenses paid: it sums the wrong table (reported, not changed).

**e2e:** not run. No Playwright spec covers the Expenses page (it is an optional area, off on a fresh install); `navigation.spec.ts` only asserts it is absent from the sidebar by default, which this ticket doesn't change.

**Gate (2026-10-12, Node 22, branch on main 5674515):**
- `npx vitest run`: 193 files, 2,930 passed, 4 skipped. A first run under load timed out 6 tests in four untouched files (IncomeDrawer, hosted views, ClientDetailPage, OverviewPage, 5 s timeouts); those four files pass alone, and the second full run passed.
- `npm run lint`: 0 errors, 16 warnings, none in changed files.
- `npm run typecheck`: clean.
- `npm run test:bundles`: OK.


---

## MUT-66 — the unsorted inbox (2026-10-12)

Plan: `.claude/designs/mut-66-unsorted-inbox-tests.md`. Server-only; the portal and offline app are untouched, so nothing here is a component or e2e test.

| AC | Proven by |
|---|---|
| A device session can create, list, edit and delete its own entries; another user can never see them | `store-contract-inbox.ts` (per-user scoping on every method; another person's rows absent from every page) + `inbox-routes.test.ts` (404 — never 403 — on a foreign entry; a second person's list never shows the first's, however many pages are walked) |
| Filing as an expense onto any profile creates the expense and removes the entry in one transaction | `store-contract-inbox.ts` (both effects from one call; a refused filing writes no expense, asserted by counting the ledger rather than trusting the return value) + `inbox-filing.test.ts` (201 on personal and Malafat-fed profiles alike) |
| Filing as income follows MUT-65 on a personal profile; `READ_ONLY_PROFILE` on a Malafat-fed one, entry stays | `inbox-filing.test.ts` (Received clientless, Owed with a client, `CUSTOMER_REQUIRED_FOR_OWED` byte-identical to `POST /v1/income`'s own refusal; on M every shape is 403 with `{ domain: 'payments', writerOfRecord: 'MALAFAT' }`, the entry still listed, and a spy proves zero `payments.create`/`receivables.createAdjustment`/`inboxEntries.file*` calls) |
| Replaying with the same `Idempotency-Key` creates no second record | `inbox-filing.test.ts` (identical response, one expense/payment by direct count; a different body with the same key → `IDEMPOTENCY_KEY_REUSED`; a missing key → 422 with the entry untouched) |
| Unsorted entries never change any `/v1/summaries/*` result | `inbox-isolation.test.ts` (50 entries leave both summaries byte-identical; filing one moves exactly one currency block by exactly that amount; and the summary sources, enumerated from the directory, contain no reference to the inbox) |
| Losing the last membership does not delete the inbox; the operator can see a per-user count | `store-contract-inbox.ts` (revoke, then list and count unchanged), `inbox-ownership.test.ts` (the DMMF carries no organization/membership FK — the structural reason), `inbox-routes.test.ts` (end-to-end after revocation), `inbox-isolation.test.ts` (`inboxEntryCount` for 0/1/many, falling on delete and on filing, never another person's) |

**Beyond the ACs.** The transaction boundary itself is tested where it lives: a concurrent double-filing of one entry yields exactly one `filed` and one `not_found` with one ledger row, and a financial insert made to throw after the entry was claimed leaves the entry byte-identical. Both run against the **memory store and real Postgres** through the same contract file, so the in-memory simulation cannot drift from the database's behaviour unnoticed.

`inbox/__tests__/compose.test.ts` pins the deliberate asymmetry that a future-dated capture is accepted and a future-dated *filing* is refused — a regression guard, since "fixing" it by reflex is the obvious wrong move.

`store-guard.test.ts` exercises both branches of the new `'sessionOnly'` case, asserts `inboxEntries`' full classification, and asserts that filing-as-income's `READ_ONLY_PROFILE` falls straight out of `STORE_ACCESS` — if that assertion needed anything inbox-specific, the design's central claim would be false. It also pins the matrix at ten domains, so reaching for an `inbox` domain fails immediately.

**Counts:** 15 store-contract cases × 2 stores, 4 DMMF, 9 compose/cursor, 16 CRUD route, 18 filing route, 6 isolation. Server suite 1310 (memory) / 1397 (`test:db`, all 82 files) green.

### MUT-83 — Owed now on Home and Clients always match (2026-10-12)

Plan: `.claude/designs/mut-83-owed-parity-tests.md`. ADR-049. Every new assertion was written first and failed on the old code (checkpoint `5623e7e`, 32 failures plus 5 files that did not load).

| File | Covers |
|---|---|
| `src/db/__tests__/aggregations.test.ts` | `clientScopeOf` (none / gone row / archived / live); `owedNowRemaining`; `partitionOwedNow`: the No client and Archived clients buckets and their counts, every live entry of a live client grouped, total = `summarizeOwedByCurrency` of the same entries, parts add up to the total, empty input |
| `src/db/__tests__/clientOwedIndex.test.ts` (new, fake-indexeddb) | **AC1 parity:** two businesses, USD/ILS/EUR, unassigned, deleted-client, archived-client, archived-entry and shared-client (D3/D4) debts. `listOwedIndex(P).total` equals Home's `summarizeOwedByCurrency(transactionRepo.list(Home's filters))` in each business, the rows add up to it, and it stays equal after archiving a client. Also covers listing (own clients even with no entries, plus other businesses' clients with an entry here), per-business row columns (owed, overdue age, last payment, activity), search, and `transactionRepo.list({ clientScope })` returning exactly the entries behind each muted row |
| `src/components/clients/__tests__/clientIndexRows.test.ts` | `toOwedBucketRows` (non-zero only, fixed order, overdue split); **AC2:** `orderClientIndex` puts the muted rows last for all 5 fields × 2 directions |
| `src/pages/clients/__tests__/ClientsPage.test.tsx` | Mocks `useClientOwedIndex`. Muted rows are absent when zero, after the clients, muted, labelled with counts, amounts per currency, and last under any sort. The strip includes them. Clicking a row navigates to `/income` with `owedEntriesSearch`, and the label is a link. A search hides them and sums only the matches. No clients but a No-client debt shows the strip and the row |
| `src/lib/__tests__/incomeSearch.test.ts` (new) | Parsing, merging, defaults and the muted-row link of `/income`'s URL model |
| `src/hooks/__tests__/useIncomeFilters.test.tsx` (new) | On a real memory router: reads the URL; a write keeps the other filters and adds no history entry; a cleared filter leaves the URL |
| `src/pages/income/__tests__/IncomePage.test.tsx` | `useIncomeFilters` is replaced by an in-memory stand-in. No params = old defaults; a link's scope, status and period apply; the chip names the scope and clears it; tabs write to the URL; an empty scoped list says nothing matched |
| `src/lib/i18n/__tests__/owedIndexKeys.test.ts` (new) | Chip keys in en/ar with `{name}`; row labels have every plural form (en one/other, ar six) |
| `e2e/owed-parity.spec.ts` (new) | Logs a client entry and a no-client entry, then checks: Home's and Clients' Owed now are equal (`$1,500`); the No client row opens `/income?client=none` with one row and a chip that clears it; axe adds no rule on either page; the muted row and the chip pass `color-contrast` |

**Verified in the browser** (`web-mut83`, sample data):
- **Setup through the UI:** an income with no client, an archived client, and an income in Creative Design Studio for a client created in Advanced Tech.
- **Parity:** Home and Clients showed the same Owed now in both businesses: `$2,400 / ₪36,051.28`, and `$1,600 / ₪46,834.41`.
- **Shared client:** it was listed in the second business with only its `$700`. Its row in its own business was unchanged.
- **The No client row** opened `/income` filtered, with the chip.
- **Languages and themes:** English and Arabic (RTL labels and plural forms), light and dark.
- **375 px:** the strip used to run past its card. It now wraps (CSS fix), with no page-level horizontal scroll.

**How e2e was run:** a throwaway config on port 5196, deleted afterwards along with `test-results/`.

**Gate (2026-10-12, branch `feature/mut-83-owed-parity` on main 5674515, Node 22):**
- `npx vitest run`: 191 files, 2,949 passed, 4 skipped, 0 failed. An earlier full run under four-agent load timed out 2 unrelated tests (`IncomeDrawer.locked`, `DataToolsSection`), which pass on their own.
- `npm run typecheck`: clean.
- `npm run lint`: 0 errors, 16 warnings, none in changed files.
- `npm run test:bundles`: passed.
- `npx playwright test`: 21/21.

### MUT-62 — the What column on /income (epic MUT-1, 2026-10-12)

Plan: `.claude/designs/mut-62-income-work-column-tests.md`. **At the owner's request, lint, typecheck and tests were not run as a gate; they wait for the combined run on main after every lane merges.** The owner also stopped new test writing midway. The tests below were written first, against the planned code (red checkpoint `a43852b`). The e2e test (plan T14) was never written.

| File | Covers | Run? |
|---|---|---|
| `src/pages/income/__tests__/incomeRows.test.ts` (new) | T1–T2: `toIncomeRow` (title trimmed, blank → none, Arabic kept, overdue only > 0, part-paid received, `canMarkPaid`); `incomeColumns` order, compact drops only Project, What's header key, same array on every call | Green once, before the stop-testing instruction |
| `src/components/ui/__tests__/TruncatedTitle.test.tsx` (new) | T3–T7: a button named by the full title with `dir="auto"`; click/Enter opens once and doesn't bubble to the row; when cut, hover shows the tooltip, it survives moving onto it, focus shows it, Escape/blur/scroll hide it; placement left in LTR, right in RTL; no tooltip when the title fits | Green once, before the stop-testing instruction |
| `src/pages/income/__tests__/IncomePage.test.tsx` | T8–T11: "What" right after Date; titles (Arabic too); dash for untitled and blank; dash for a missing project; the title button opens the entry once by click and Enter; compact keeps What, drops Project, cells line up; rows shaped once per result (`toIncomeRow` spied) | **Never run** |
| `src/pages/income/__tests__/IncomePage.titleSearch.test.tsx` (new, fake-indexeddb) | T12, AC3: real Dexie and the real `useIncome`, with only the router stood in for. A URL `q` holding a title word lists just that entry; typing writes `q` and narrows; matching ignores case; Arabic finds Arabic; client-name search still finds untitled entries | **Never run** |
| `src/pages/projects/__tests__/ProjectDetailPage.test.tsx` | T13: What after Date on the Transactions tab; title or dash; the title opens the income or expense drawer once | **Never run** |

**Acceptance criteria with no passing test on the final tree** (none of the suites ran after the code was finished):
- **AC1, column and dash:** IncomePage tests written, never run.
- **AC2, truncation and the full title on hover and focus:** `TruncatedTitle` passed once; that the row stays one line is checked only in the browser.
- **AC3, search by a title word:** an integration test written, never run.
- **AC4, RTL mirror and Arabic titles:** no automated test; checked only in the browser.
- **AC5, shaped rows and stable columns:** `incomeRows` passed once; the page-level `useMemo` test was never run.

**Verified in the browser** (`web-mut62`, entries added in the dev database and removed afterwards):
- **Titles:** a short title, a 100-character title, an untitled entry, a blank title, a long Arabic title and a mixed Arabic/Latin title, in both EN and AR (RTL) and in light and dark.
- **Column:** What sits after Date, mirrored in RTL. The dash shows for untitled and blank titles.
- **Truncation:** long titles cut to one line. Hover and Tab focus show the full title; Escape hides it, and Enter opens the drawer once. A title that fits shows no tooltip. Near the window's bottom the tooltip flips above the title.
- **Search:** "stationery" and "بصرية" each narrowed the list to their entry via `?q=`.
- **Project tab:** the Transactions tab shows the column, and clicking a title opens the income drawer once.
- **375 px (AR, dark):** see the CHANGELOG for how the column behaves.

---

## MUT-120 — every user gets exactly one personal profile (2026-10-12)

Plan: `.claude/designs/mut-120-personal-profile-tests.md`. ADR-037 amendment (MUT-120).

| Area | File | What it proves |
|---|---|---|
| Store contract (memory and Postgres) | `repositories/__tests__/store-contract-users.ts` | user, personal org (marked, named, settings) and memberships created together; personal-only user; a second personal org for the same user is a `UniqueViolation`; a duplicate email or unknown firm leaves no user and no personal org behind; firms carry `personalOwnerUserId: null` |
| Admin users | `__tests__/routes-users.test.ts` (`personal profile (MUT-120)`) | firm inherits currency/timezone; `شخصي` for `ar`; personal-only from currency+timezone; 422 for each incomplete combination with nobody created; request overrides firm; retry → 409 with exactly one personal org; ADMIN audit rows per org; grant to another user → 409 (owner re-grant → 200 `created:false`); create inside another's personal profile → 409, nobody created |
| Admin orgs / bind | `__tests__/routes.test.ts` (`personal profiles are never bound, keyed or shown as firms`) | API key refused on a personal org (firms unaffected); `personalOwnerUserId` on the org detail; bind refused even with a key planted through the store |
| `/v1/me`, device sessions | `routes-sessions.test.ts`, `routes-device-sessions.test.ts` | `isPersonalDefault` only on the caller's own personal profile; customers/projects/payments `read-write` there; firm `false` |
| CLI | `scripts/__tests__/users-cli.test.ts` | `create` with no `--organization-id`, from `--currency`/`--timezone`, makes exactly one membership and prints `personal <id> Personal` |
| Review fixes | `routes-sessions.test.ts`, `routes-users.test.ts`, `routes.test.ts`, `store-contract-users.ts` | `/v1/me` order is firms then personal, compared without sorting; another user's personal profile is never marked; an unknown IANA timezone gets 422 with nobody created; revoking one's own personal profile gets 409 and the membership stays; a key planted on a personal profile gets 409 on bind and on `GET /v1/customers`; unknown owner gives ForeignKeyViolation; a personal-slug clash rolls back |

Run: server lint 0, typecheck clean, `npm test` 1,333 passed (12 Postgres files skipped), `npm run test:db` on a dedicated database 1,423 passed (82 files), `openapi:check` up to date, build ok; root typecheck clean, `hosted:types:check` matches, `npx vitest run src/hosted` 145 passed.


**Backfill (2026-10-13):** `scripts/__tests__/post-roll.test.ts` (`backfillPersonalProfiles`, DB only): a legacy `ar` user with a USD/Asia/Gaza firm gets `شخصي` with the firm's currency and zone, a membership and two `SYSTEM` audit rows, then nothing on the second run. A user created with a personal profile is untouched. A firmless legacy user is skipped `NO_FIRM`. Not covered: `INVALID_TIMEZONE` (the reason exists only for TD-091), and the concurrent-create `P2002` path.

## MUT-73 — device sync retired (2026-10-12)

Plan: `.claude/designs/mut-73-retire-sync-tests.md`. ADR-053.

**What was run, and what was not.**
- **Before the owner's instructions to skip gates arrived**, the gates ran once on this branch at `eaedf2f`: the code state after the last code commit, merged with main at `6ec7c56`. Results:
  - `npx vitest run`: 190 files, 2,857 passed, 4 skipped;
  - Playwright, full suite on a throwaway config on port 5198: 26/26, on the old `e2e/` suite that MUT-97 has since retired. From here it is replaced by the combined `qa/` run on main;
  - `npm run test:bundles`: passed;
  - `npm run lint`: 0 errors, 13 warnings, none in changed files;
  - `npm run typecheck` and `npx tsc -b`: clean;
  - `cargo test`: 15 passed, 0 warnings;
  - `cargo clippy --all-targets -- -D warnings`: clean.
- **After the instructions**, at the owner's request, **lint, typecheck, clippy and tests were not run again**, pending one combined run on main after every lane merges. That covers the knowledge commits (docs only) and the final merge of main into this branch.
- **The one compile check left in this lane** was the desktop debug build. It was green at `eaedf2f` and was not rebuilt after the final merge.

**Acceptance criteria → evidence.** "Written, not re-run after the final merge" means the test passed at `eaedf2f` but has not run against the merged tree.

| AC | Evidence | Status |
|---|---|---|
| No pairing, bundle, chip or conflict banner in either language | `src/__tests__/noSyncModules.test.ts` (paths, imports and `vi.mock` paths, names, Tauri commands, crates, `qrcode.react`); `scripts/bundle-rules.ts` markers (`.msync`, `start_sync_server`, `Export Sync Bundle`) plus 4 unit cases; browser check in English and Arabic | Browser: done. Tests: written, not re-run after the final merge |
| No module outside OAuth imports a sync path; `tsc -b`, lint, unit suite and Tauri build green | `noSyncModules` import scan; the gates listed above; the debug Tauri build | Green at `eaedf2f`; not re-run after the final merge |
| A v20 database with op-log rows and a paired device opens cleanly, with no sync tables left | `src/db/__tests__/migration-v21.test.ts`: opens without `console.error`, stores gone, every user row unchanged, fresh install at v21; `completeMigrationSafety` v20→v21 writes a snapshot with no sync tables. Browser: a real v20 database (op-log rows, a paired peer, an open conflict, a version snapshot) upgraded to native 210; all 24 user tables byte-identical; no sync stores | Browser: done. Test: written, not re-run after the final merge |
| Rerouted mutations behave the same | `provider.test.ts` (registry is `{ base }`); `useIncomeQueries.test.tsx` (Mark paid and partial payment call `base`, +1 case); `useQueries.test.tsx` (+3 cases: partial payment, payment update, payment delete, on real Dexie); the repository suites unchanged. Browser: a partial payment, a payment edit, a payment delete and Mark paid each updated Income and Home, with no console warnings | Browser: done. Tests: written, not re-run after the final merge |
| Malafat OAuth sign-in still works | 74 moved TS cases plus 10 Rust listener tests. **Desktop IPC smoke** on the debug build under `com.elmokhtbr.mutaba3a.mut73`: `bind_oauth_callback` bound 14100; a redirect returned exactly `code=abc&state=xyz` through `await_oauth_callback`; a replayed redirect was refused (listener gone); `cancel_oauth_callback` released the port | Smoke: done. Tests: not re-run after the final merge |
| JSON backup and restore round-trip | `migration-v21.test.ts`: a v20 backup carrying all eight sync tables restores into v21, user rows only. Browser: the real pre-upgrade backup restored 24 rows and recreated no sync store | Browser: done. Test: written, not re-run after the final merge |
| ADR-013 marked Superseded | `DECISIONS.md`: index, status lines and the Superseded table | Done |
| `paired_devices.json` removed on launch | `src-tauri/src/retired_sync.rs` (5 tests). Desktop smoke: `paired_devices.json` and `.tmp` in the isolated config dir were gone after launch, and a neighbouring file survived | Smoke: done. Tests: not re-run after the final merge |

**Desktop smoke, as run.** The method is in PATTERNS, "Smoke a desktop debug build without touching the owner's data".
- **Isolation:** the identifier was overridden, the binary was copied under a unique name, and the owner's `~/Library/WebKit/app` and `~/Library/WebKit/com.elmokhtbr.mutaba3a` mtimes were unchanged afterwards. The isolated directories were deleted.
- **Updater, with the shipped capabilities:** `plugin:updater|check` was rejected with "not allowed". `capabilities/default.json` grants no updater permission, so the in-app update check cannot run in any shipped build. This predates MUT-73 and is unrelated to it; it was reported for a ticket. **Fixed 2026-10-13 (MUT-99):** `updater:default` and `process:allow-restart` are now granted; see `updater-capabilities.test.ts`.
- **Updater, with the permission added inline for the smoke only:** the check reached GitHub over TLS and resolved "no newer version". There was nothing on stderr. This is the `ring`-only `rustls` path; `tauri-plugin-updater` installs that provider itself when none is set.

**Browser note.** While files were being deleted under a running dev server, Vite's hot reload logged `removeChild` and `createRoot` errors. That was a dev-only artefact; clean page loads afterwards logged nothing.

**Counts at `eaedf2f`.**
- Deleted: 131 TS cases (with `src/sync`) and 14 Rust tests (pairing, persistence, crypto).
- Added: 17 guard cases, 7 migration-v21 cases, 4 hook cases and 4 bundle-rule cases (2 new `it` blocks, one of them `it.each` over 3 markers), plus 5 Rust cleanup tests.
- Moved: 74 OAuth cases and 10 Rust tests.

### MUT-89 — "All businesses" on Home and Clients (epic MUT-74, 2026-10-12)
Plan: `.claude/designs/mut-89-all-businesses-lens-tests.md`. ADR-051. Tests were written first and failed for the right reason before each unit's code.

| File | Covers |
|---|---|
| `src/lib/__tests__/profileStore.test.ts` (rewritten) | A pick turns the lens off; a repair keeps it; `setAllBusinesses`; `reset`; persisted at v1 without `onOwedScreen`; legacy `'all'` → lens on |
| `src/hooks/__tests__/useActiveProfile.test.tsx` | **AC1:** the option needs an owed screen and 2+ businesses; `isAllProfiles` needs the lens too. **AC3:** `activeProfileId` / `useProfileFilter` stay the working business. **D5:** the auto-correct uses `setWorkingProfile`. **D6:** `setAllBusinesses`, refused with one business. **useOwedLens:** undefined while loading (D2), `''` with no business (D4), every business in All, ignores the route flag (D3). Strict-mode `:114`/`:124` rewritten, `:173` deleted |
| `src/hooks/__tests__/allBusinessesLens.test.tsx` (new, memory router, real stores and fake-indexeddb) | **AC3 / O1:** Home reads every business; `/income` reads the working one with no All option; back on `/`, All returns; a client under the Clients layout is an owed screen |
| `src/__tests__/router.owedLens.test.ts` (new) | `/`, `/clients` and `/clients/$clientId` are tagged on the real route tree; eight other areas are not |
| `src/components/layout/__tests__/AppShell.gate.test.tsx` (new) | **D8:** the page is held until the businesses load; it mounts with no business at all |
| `src/db/__tests__/baseQuery.test.ts` | A list scope: members match; others, unassigned records and `[]` don't |
| `src/db/__tests__/clientOwedIndex.test.ts` | **AC2 / O3 / O4** over two businesses: the total equals the sum of each business's Home; rows plus per-business muted rows add up; a shared client counts both and is tagged with both; a no-entry client carries its own business; unassigned and archived-business records stay out; `byProfile` in scope order; one business unchanged |
| `src/db/__tests__/paymentRecords.test.ts` | `listRecent` over a list carries each row's business and leaves out unassigned and archived-business payments |
| `src/components/clients/__tests__/clientIndexRows.test.ts`, `src/components/ui/__tests__/ProfileBadge.test.tsx` | `profileIds` on rows; `toBusinessBucketRows` order; `BusinessTags` order, `<bdi>`, unknown ids skipped |
| `src/pages/overview/__tests__/OverviewPage.test.tsx` | Mock moved to `useOwedLens` (D7). No tags in one business. In All: one receivables query (ADR-055), per currency across businesses, tags on both sections. Waits for the scope (D2). Reads All on its first render (D3, real lens) |
| `src/components/home/__tests__/HomeNeedsAttention.test.tsx` | Mock moved to `useOwedLens` (D7). In All: both businesses listed and tagged; **the same-frame payment test passes with a list scope** (ADR-055) |
| `src/pages/clients/__tests__/ClientsPage.test.tsx` | In All: reads every business; tags (two on a shared client); no cross-profile badges or their query; one No client row per business; a click sets the working business with All kept on and opens Income; the badges stay in one business |
| `src/components/layout/__tests__/ProfileSwitcher.test.tsx` (new), `TopBar.profileIndicator.test.tsx` (new) | **AC1 / O1 / O2:** All is listed first only on owed screens with 2+ businesses; picking it labels the switcher; picking a business turns it off; off the owed screens the working business is shown. The top bar says All businesses |
| `src/components/__tests__/IncomeDrawer.test.tsx` | **AC4:** from All the business field is up front, empty and required; the Add menu's pick prefills it; off the owed screens it works in the working business |
| `src/components/ui/__tests__/ProfileQuickPicker.test.tsx` (new) | The picker stays inside the window (found in the browser check) |

**What was run (Node 22), on this branch:**
- `npx vitest run`: 219 files, 3,218 passed, 4 skipped;
- `npm run typecheck` and `npx tsc -b`: clean;
- `npm run lint`: 0 errors (12 pre-existing warnings);
- `npm run test:bundles`: passed.

**Browser check** (preview on port 5187, visitor sample, three businesses):
- **Switcher on Clients:** it listed All first; picking it showed 10 clients with tags under each name, and the top bar read All businesses.
- **A shared client from the app:** income added through Add → (picker) → the consulting office for a client created in the tech business. The row showed both tags, and Owed now covered both (₪18,100 + ₪500).
- **An entry with no client in the design studio:** one tagged "No client · 1 entry" row. Its click opened Income in the design studio, listing exactly that entry, with All still on.
- **Income:** the switcher listed only the businesses.
- **Home in All:** Owed now matched Clients' strip, and the rows were tagged.
- **Client profile in All:** Add income showed "Business Profile *" up front and empty (AC4).
- **Arabic RTL** read correctly, and there were no console errors.
- **Two bugs found and fixed:** the tags ran on the name's line (CSS specificity), and the picker overflowed the window.

**Not run:** the `qa/` release-QA kit (no qa spec covers this flow yet).

**Pre-landing review round (tests written first):**
- `SavedFlashAnnouncer.test.tsx`: Show keeps All on.
- `ClientDrawer.test.tsx` and `ProjectDrawer.test.tsx`: each prefills the picker's business.
- `SidebarNav.features.test.tsx`: New → Income/Expense sets the working business before navigating.
- `ProfileQuickPicker.test.tsx`: placed from the saved rectangle, focuses its first business, Escape returns focus, arrows/Home/End move, leaving closes it.
- `IncomeDrawer.test.tsx`: "Create new" client only once a business is chosen.
- `useProfileAwareAction.test.tsx`: the real All state, with a concrete working id.
- `IncomeDrawer.test.tsx`: business before client; from a client; duplicating keeps the business.
- `profileStore.test.ts`: the route flag never writes the saved key.
- `AppShell.gate.test.tsx`: AppShell routes pages through the gate (mutation-checked).
- Third pass: `IncomeDrawer.test.tsx` (the client error says choose the business first; the project field is closed until then), `ProfileQuickPicker.test.tsx` (one Tab stop; focus going nowhere keeps it open), `incomeDrawerKeys.test.ts` (the hint key).

### MUT-84 — Clients split view on wide windows (epic MUT-74, 2026-10-12)

Plan: `.claude/designs/mut-84-clients-split-view-tests.md`. ADR-050. TD-067.

**Not run, at the owner's request.** The owner asked every lane of the epic to skip lint, typecheck and tests until all lanes have merged, then run them once on main. The tests below were written first and failed on the old code (checkpoint `6401562`: 8 files red). The targeted suites passed once mid-build (11 files, 178 tests), before the stop order. They have not run since the breakpoint moved from 1200 to 1280 px and main (MUT-97) was merged in. The full suite, `test:bundles` and any `qa/` run were never run. The split view's browser-level spec (T19: the keyboard walk, Enter/Escape and ←/→ between the panes, the status line, Back after a walk, a deep link with a sort, a resize that keeps the profile, Arabic, axe) was never written and nothing was added under `e2e/`. It is **to port to `qa/` (MUT-97 kit)** as a `split-view` entry in `qa/features/web/clients.yaml` with its spec in `qa/specs/web/clients.spec.ts` (TD-067).

**Update 2026-10-12: the unit tests ran and the browser spec is in `qa/` (TD-067 resolved).** The combined check on main (`eeacd57`) ran the vitest files below green. T19 is now four `qa/` features in `qa/features/web/clients.yaml`, with their tests in `qa/specs/web/clients.spec.ts`, run at 1280 × 720 (exactly `BREAKPOINTS.clientsSplit`):

| Feature | Tier | Covers |
|---|---|---|
| `web.clients.split-view` | secondary | A click opens the profile beside the list; ↓/↑ walk with the URL, focus and `aria-current` following; "Showing Beta Labs" on the status line; Enter/Escape and →/← move focus between the panes; axe on both panes (`clientsSplit` surface, only the known `color-contrast`); Back after the walk returns to the full list |
| `web.clients.split-view-deep-link` | secondary | `/clients/<id>?sort=name&dir=asc` opens both panes sorted by name, with nothing announced; ↓ walks in name order and the URL keeps the sort |
| `web.clients.split-view-resize` | tertiary | A Work search typed in the profile survives 1280 → 375 → 1280 px (the profile never remounts); at 375 px the list is hidden |
| `web.clients.split-view-rtl` | tertiary | In Arabic the list column is right of the profile; ← moves focus into the profile and → back |

All four passed on the first run (`release-qa pw --record`, retries off). Each was also checked against a deliberately broken build: with the walk disabled and the profile keyed by layout, all four failed on the assertion that guards the broken behaviour. Still covered only in jsdom: Alt+← left alone, keys typed in a field, ↓ from the list's search box, and the ends of the walk.

| File | Covers |
|---|---|
| `src/components/clients/__tests__/clientsSearch.test.ts` (new) | `parseClientsSearch` (unknown values dropped, numeric `q` as text, every sort column), `mergeClientsSearch` (cleared search and defaults removed), `resolveClientsSearch` (owed / desc / '') |
| `src/components/clients/__tests__/useClientsSearch.test.tsx` (new) | On a real memory router: reads the URL; writes with `replace` on `/clients` and on `/clients/:id` (path kept, no history entry); defaults leave the URL |
| `src/components/clients/__tests__/clientsSplitView.test.ts` (new) | Key mapping in LTR and RTL; `adjacentClientId` skipping muted rows and stopping at the ends; `keyBelongsToControl` (fields, menu/listbox/dialog/tablist/radiogroup/combobox, open popup button); `hasModifier`; `splitLayout`; `clientProfileRemountDeps` |
| `src/hooks/__tests__/useMediaQuery.test.ts` | `useIsSplitView` asks for `(min-width: BREAKPOINTS.clientsSplit px)` |
| `src/pages/clients/__tests__/ClientsLayout.test.tsx` (new) | On a real memory router with the app's route shape and a profile stub that counts mounts: narrow vs wide arrangements; top bar (name, breadcrumb, Edit, not found); **resize with a profile open does not remount it** (typed value kept); ↑/↓ walk with focus and URL following; muted rows skipped; ends stop without scrolling; first open pushes, walking replaces, Back returns to the list; search and sort kept through walks and clicks, list pane and scroller the same nodes; a fresh profile per client; ↓ from the search box; Enter/→ into the profile, Escape/← back; RTL mirrored; keys in a field and Alt+← left alone; announcement after a walk, silence on a deep-link load |
| `src/pages/clients/__tests__/ClientsPage.test.tsx` | `useClientsSearch` stood in by an in-memory model. MUT-7/MUT-83 behaviour unchanged; sort and search written through the model and read from it; a row click keeps the list's search (`search: true`); rows carry `data-client-id` (muted rows don't); the open row is marked with `aria-current="page"`; ↑/↓ do nothing without `onWalk` |
| `src/pages/clients/__tests__/ClientDetailPage.test.tsx` | Renders no top bar of its own (the layout owns it); the existing sections unchanged |
| `src/lib/i18n/__tests__/clientsSplitKeys.test.ts` (new) | `clients.split.profile` and `clients.split.showing` (with `{name}`) in en and ar |

**Acceptance criteria and their coverage:**

| AC | Covered by | Status |
|---|---|---|
| Named breakpoint; the layout switches without remounting the profile on resize | `useMediaQuery.test.ts`, `ClientsLayout.test.tsx` "resizing across the breakpoint" | Written, not run. Verified in the browser |
| ↑/↓ move the selection, Enter/→ focus the profile, Escape/← return; the selection is announced | `clientsSplitView.test.ts`, `ClientsLayout.test.tsx` "walking" / "moving between" / "announcing" | Written, not run. Verified in the browser |
| Selection, scroll position and filters survive switching clients | `ClientsLayout.test.tsx` "keeps the list, its search and its sort", `useClientsSearch.test.tsx` | Written, not run. Verified in the browser |
| RTL mirrors the columns | `ClientsLayout.test.tsx` "follows the screen in Arabic" (keys only; jsdom has no layout) | Keys written, not run. Columns verified in the browser only |
| An ADR records the navigation change | ADR-050 | Done |
| Tests cover wide vs narrow rendering and keyboard navigation | All of the above | Written, not run. No browser-level spec (TD-067) |

**Verified in the browser** (`web-mut84`, sample data):
- **Widths:** split at 1440 and 1280 px, full page at 1279 and 375 px. At 1200 px with the sidebar expanded, the profile's Work and Payments tables needed 604 px but had 528, so the token moved to 1280, where they fit (608/608).
- **Resize:** 1440 → 375 → 1440 with a Work search typed in the profile kept the same DOM node and the value.
- **Keyboard walk:** URL, focus, `aria-current` and status line follow. ↓ at the last client stays. The history length doesn't change while walking, and Back returns to `/clients`. Enter, → and Tab, ←, and Escape move focus between the panes. Narrow ↓ does nothing.
- **URL model:** search typed in the list stays in the URL through walks; sorting while a client is open keeps the path; the scroll container is the same node.
- **Languages and themes:** Arabic in dark mode, with the list on the right, the profile on the left, ← in and → out.

### MUT-82 — Record payment from Home's Needs attention, with Undo (epic MUT-74, 2026-10-12)
Plan: `.claude/designs/mut-82-home-inline-payment-tests.md`. ADR-055, TD-064. Every new assertion was written first and failed on the old code (a red checkpoint, since folded into the feature commit: 31 failures plus 3 files that did not load).

| File | Covers |
|---|---|
| `src/lib/__tests__/attention.test.ts` (new) | `selectAttentionReceivables`: overdue and due within 7 days (today and day 7 in, day 8 out), undated / paid / expense out, order by due date then client then id, input untouched |
| `src/lib/motion/__tests__/rowExit.test.ts` (new) | No layout → nothing captured; the copy is inert, `aria-hidden`, placed over the row, cells pinned, ids stripped; slides toward the inline end (LTR +x, RTL −x) while fading, then goes; following rows start one row lower and glide to rest; reduced motion fades only; nothing plays while the row is still in the document or after the list has gone |
| `src/hooks/__tests__/usePaymentUndo.test.tsx` (new, fake-indexeddb) | **AC3:** status, remaining and paidAt after Undo equal their values before the payment for an unpaid entry paid in full, a part-paid entry paid in full, and a second partial payment; the toast's message and group; a second payment replaces the first Undo and the first stays recorded; Undo after the offering component unmounts; a failed delete shows the error toast |
| `src/components/home/__tests__/HomeNeedsAttention.test.tsx` (new, fake-indexeddb, real translations, drawer mounted from the store, `ToastContainer`) | **AC1:** the button's name "Record Payment — Remaining: ₪3,550", Tab reaches it after the row's link, Enter opens the drawer and does not navigate; the client link and a click elsewhere on the row open the client; a no-client row's button opens the entry. **AC2:** a partial payment keeps the row with ₪2,550 left and Owed now updated. **AC5:** a full payment removes the row, lowers Owed now and shows the Undo toast; a `MutationObserver` proves no DOM batch shows the row gone with the old Owed now, or the reverse; focus moves to the next row's button; Undo brings back the row, Owed now and the entry exactly, with focus on the row |
| `src/pages/overview/__tests__/OverviewPage.test.tsx` | Owed now and Needs attention read one `useReceivables({ profileId })`; `useAttentionReceivables` is not called; the list is selected and ordered from the receivables |
| `src/components/drawers/__tests__/PartialPaymentDrawer.test.tsx` | `onRecorded` gets the created record before `onClose`; nothing reported on a refusal or an update; returning to the entry passes the callback along |
| `src/lib/__tests__/stores.test.ts` | `onRecorded` travels with the open options, clears on close, survives an edit of the same entry and not of another |
| `src/lib/__tests__/toastStore.test.ts`, `src/components/ui/__tests__/ToastContainer.test.tsx` (new) | A `group` replaces its toast; others stack; a toast waits while hovered or focused and resumes with the time left; the action runs once and removes it |
| `src/components/ui/__tests__/RecordPaymentButton.test.tsx` | `compact`: label alone, amount still in the accessible name |
| `src/lib/i18n/__tests__/homePaymentKeys.test.ts` (new) | `overview.paymentRecorded`, `paymentRecordedNoClient`, `undoFailed` in en and ar, with their placeholders |
| `qa/specs/web/home.spec.ts` (`web.home.attention-pay-*`, ported 2026-10-12) | See below |

**Browser spec, ported to `qa/` on 2026-10-12 (TD-064 item 7).** The dropped spec was recovered from the pre-rebase checkpoint `660ba96` and ported as four features in `qa/features/web/home.yaml`, with their tests in `qa/specs/web/home.spec.ts`. The axe check now runs inside the full-payment flow, as every `qa/` axe check does since MUT-97:

| Feature | Tier | Covers |
|---|---|---|
| `web.home.attention-pay-full` | secondary | Axe on Home with the buttons (`home` surface); the drawer prefilled with $1,200, the amount focused; the copy slides more than 100 px toward the inline end, fading below 0.5, then goes; Owed now $1,500 → $300; focus on Beta Labs' Record Payment; the toast "Recorded $1,200 from Acme Studio"; Undo brings back the row and Owed now, with focus on the row's button |
| `web.home.attention-pay-partial` | secondary | $200 of $1,200: the row stays, named "Remaining: $1,000"; Owed now $1,300 |
| `web.home.attention-pay-reduced-motion` | tertiary | The copy only fades: x stays 0, opacity drops below 1 |
| `web.home.attention-pay-rtl` | tertiary | In Arabic (switched from Settings) the copy slides more than 100 px to the left |

All four passed on the first run (`release-qa pw --record`, retries off), and each failed against a deliberately broken build: ignoring reduced motion, dropping the focus hand-off, and forcing the slide to the right failed the full, reduced-motion and Arabic features; the partial feature rightly kept passing. This closes AC4's real-browser proof.

**Original note.** `e2e/home-record-payment.spec.ts` (5 Playwright tests, written for this ticket, passed 5/5 before main was merged in) was dropped when main retired `e2e/` (MUT-97): **to port to `qa/` (MUT-97 kit)**. It covered, in a real browser: a full payment from a Needs attention row (the row's copy slides toward the inline end, more than 100 px, fading below 0.5, then goes; Owed now drops; focus moves to the next row's Record Payment; the toast reads "Recorded $1,200 from Acme Studio"; Undo brings the row and Owed now back with focus on the row's button); a partial payment (the row stays, named "Remaining: $1,000", Owed now $1,300); reduced motion (the copy only fades, x stays 0); Arabic (the copy slides left, below −100 px); and axe on Home with the buttons (the `home` surface). It needed `logIncome` to take a `dueDate` and a `localDateFromToday(days)` helper, which go with the port.

**What was run, and what was not.** At the owner's request, lint, typecheck and tests are **not** part of this lane's finish: they run once on main after every lane has merged. Before that instruction arrived, on this branch before merging main (Node 22): `npx vitest run` 198 files, 3,006 passed, 4 skipped; `npm run typecheck` clean; `npm run lint` 0 errors (15 warnings, none in changed files); the five browser specs, then in `e2e/`, 5/5 on a throwaway config (port 5195, deleted). **Not run at all:** the full browser suite and `npm run test:bundles`. **Not re-run after:** the exit-snapshot id fix and bringing in main (MUT-83, MUT-87, MUT-66, MUT-97, MUT-62, MUT-73, MUT-84; the branch is rebased on `eba9676`). After MUT-73 retired the `synced` repositories, `usePaymentUndo.test.tsx` reads `getRepositories().base` instead (a mechanical change). The merged tree has never run, so every acceptance criterion rests on the combined run on main. **Covered only by written-but-unrun tests on this tree:** AC1–AC3 and AC5 (vitest files above). **AC4 (reduced motion swaps the slide for a fade)** is covered on this tree only by `rowExit.test.ts`; its real-browser proof was in the dropped spec.

**Verified in the browser** (`web-mut82`, entries created for the check; the pane was hidden, so actions were driven from the page and read back from the DOM):
- English: a full payment on ₪3,550 took the row off and Owed now from ₪5,637.5 to ₪2,087.5 in the same read, toast "Recorded ₪3,550 from Acme Studio · Undo", focus on the next row's button; Undo restored both. A partial ₪1,000 kept the row with ₪2,550 left and Owed now ₪4,637.5; Undo restored it.
- Arabic (RTL): the same full and partial flows, the amount typed in Arabic-Indic digits ("١٠٠٠" → "يبقى ‏2,550 ₪ مستحقًا"), the toast "تم تسجيل ‏3,550 ₪ من Acme Studio · تراجع".
- Found and fixed there: a payment drawer opened while another drawer's exit snapshot was still in the page submitted the snapshot's form (duplicate `id="partial-payment-form"`); snapshots now strip ids.
- Light/dark, EN/AR, 1280 and 375 px, the slide-out mid-frame and the drawer were checked from Playwright screenshots (headless, so the motion runs). At 375 px the Record Payment button moves to its own line (container query); there is no page-level horizontal scroll.

### MUT-81 — After saving, show where the entry or payment landed (epic MUT-74, 2026-10-12)
Plan: `.claude/designs/mut-81-after-save-feedback.md` (two `/plan-eng-review` passes, one `/plan-design-review` pass). ADR-057, TD-077, TD-078.

| File | Covers |
|---|---|
| `src/lib/__tests__/savedFlashStore.test.ts` (new) | `flashTarget`/`matchesFlash` pure; `markSaved` sets/resets state, a second save replaces the first; claim on a settled matching report, not on an unsettled one; unclaimed only once every registered list has reported settled with no match; one claim is enough even if another list never has the row; deregistering the only unsettled list lets resolution proceed; the backstop fires unclaimed with zero registered lists, and a claim before it cancels it; the tint clock starts at the claiming report, not at `markSaved`; `rearm` restarts the clock and sets `messaged`; `clear` resets everything; never written to `localStorage` |
| `src/hooks/__tests__/useSavedFlash.test.tsx` (new) | `useSavedFlashRows` claims a visible row once settled; does not report settled while loading; deregisters on unmount, letting resolution proceed without it; `useSavedFlashResolution` exposes `pending`/`claimed`/`flashIds` |
| `src/components/layout/__tests__/SavedFlashAnnouncer.test.tsx` (new) | Renders nothing while unresolved; announces "Saved" politely once claimed and raises no message; raises the message with Show when nothing claims the row; Show switches the active profile, navigates, and re-arms so the original message can't fire twice; never shows the same message twice for one save |
| `src/lib/i18n/__tests__/savedFlashKeys.test.ts` (new) | `savedFlash.*` keys non-empty in en and ar, with `{client}` kept |
| `src/lib/__tests__/utils.test.ts` | `isolate()`: wraps in FSI (U+2068…U+2069); does not force a strong right-to-left string to render left-to-right (the case the LRI it replaces got wrong) |
| `src/components/clients/__tests__/OwedNowSummary.test.tsx` | `:65` (renamed from "keeps amounts left-to-right…") now expects the shared `isolate()`'s FSI codepoint — a deliberate tripwire against a silent revert to the old LRI |
| `src/components/__tests__/IncomeDrawer.test.tsx` | Captures the saved entry for the flash with the client's name resolved at save time (create); captures an edit too |
| `src/components/drawers/__tests__/PartialPaymentDrawer.test.tsx` | Captures a recorded payment (`ids: [record.id, transactionId]`) and an updated one; skips the flash when the transaction has no `profileId` (defensive, legacy data) |
| `src/components/home/__tests__/HomeNeedsAttention.test.tsx` | A full payment raises **no** flash (the drawer's unconditional `markSaved` is undone by `clear()` in the branch `captureRowExit` already fires); a partial payment tints the row it keeps (`tr.row-flash`) |

**Scope note.** The design review (`/plan-design-review`) approved eleven refinements beyond the ticket's five literal acceptance criteria; this build implements the mechanism and all five criteria, and discloses the rest as TD-077 (anchored-strip presentation, kept as the existing Toast instead) and TD-078 (pagination, the Owed-now tick, currency-block collapse, and a focus chain outside Home) rather than silently dropping them.

**What was run.** `npm run lint`: 0 errors (12 pre-existing warnings, none in changed files). `npm run typecheck`: clean (both `tsconfig.app.json` and `tsconfig.hosted.json`). `npx vitest run`: 218 files, 3,186 passed, 4 skipped (pre-existing). `npm run build`: clean (the one chunk-size warning is pre-existing, unrelated to this change). **Not run:** `npm run test:e2e` / `release-qa` — no browser spec was written for this ticket in this session.

## Hosted API — MUT-61: Received on Malafat profiles (2026-10-12)

Plan: `.claude/designs/mut-61-malafat-received-capture-tests.md`; regression contract D3 in the brief. Run (Node 22, `server/`): `npm test` 1,354 passed / 14 skipped; `npm run test:db` 1,450 passed (twice in a row).

| Area | File | What is pinned |
|---|---|---|
| Matrix | `auth/__tests__/writability.test.ts`, `api-key.test.ts`, `store-guard.test.ts`, `__tests__/writability-drift.test.ts` | `capture` is session read-write on both profile kinds, invisible to a key; `sessionScopesFor('MALAFAT')` holds `capture:write`, not `payments:write`; `capture:write` is never issuable; the domain list is pinned exactly; the brief row matches; the generic per-method table covers `capture`/`undoCapture` for every principal × profile |
| Repository contract | `repositories/__tests__/store-contract-capture.ts` (new; memory + Postgres) | capture writes POSTED/CAPTURE/source/person with no allocations; create writes INTEGRATION; undo reversed → already-reversed; refused on full or partial allocation with nothing changed; not-found for another person, organization, a Malafat payment or an unknown id; `origin`/`allocationState` filters; D2 (a matter is a hint until allocated); the project filter on page 2 |
| Migration | `repositories/__tests__/migration-mut61.test.ts` (new) | backfill CAPTURE exactly where `createdByUserId` is set; schema has no drift afterwards |
| Rules | `income/__tests__/compose.test.ts` | `incomeCaptureRulesFor` both ways; `linked-required`: no client, unlinked client, PROJECT-only reference, derived client from a matter |
| Routes | `__tests__/income-routes.test.ts` | AC 1–6 on profile M: 201 unallocated capture; matter kept; matter alone → client derived and checked; 422 CUSTOMER_REQUIRED / CUSTOMER_NOT_LINKED / PROJECT_CUSTOMER_MISMATCH with nothing written; Owed 403 with nothing written; idempotent replay writes one payment; key → PRINCIPAL_NOT_ACCEPTED; undo 204 → 204, 409 after full/partial allocation, staged race (allocation before the write) → 409 with the allocation intact, Malafat payment → 404; payment view fields + filters via the key; summaries count it once and drop it after allocation; `/v1/me` income rules |
| Regression (D3) | `__tests__/writability-routes.test.ts`, `inbox-filing.test.ts` | every other READ_ONLY row unchanged (403, zero writes); the one intended change (Received, no client → 422) is its own named test; inbox file-as-income on M still 403 |

## Hosted API — MUT-100: Contingency fee agreements (2026-10-13)

Plan: `.claude/designs/mut-100-contingency-agreements-tests.md`; regression contract R5/D7 in the brief. Run (Node 22, `server/`): `npm test` 1,490 passed / 17 skipped; full suite on Postgres 1,613 passed (after both pre-landing review cycles). `repositories/__tests__/prisma-lock-conflict.test.ts` pins which Postgres failures count as a retryable lock conflict.

| Area | File | What is pinned |
|---|---|---|
| Pure maths | `agreements/__tests__/contingency.test.ts` (new) | AC 1–4 figures; half-up rounding (33.33 %, 20.5 %, exact half); rate bounds; counted upfront: posted or not, voided/commission lines excluded, stored nets vs grosses by pricing basis, stored splits beat a re-split (R4/D6), never below 0 |
| Summaries | `summaries/__tests__/compute.test.ts` (rows added) | contingency is fixed-like; PENDING while awaiting even with the upfront paid; OUTSTANDING / PARTIALLY_PAID after the award; PAID_IN_FULL once decided and paid; hearing FIXED + contingency sum in `agreed`; latest ACTIVE contingency shown; FIXED + RETAINER mix regression row |
| Repository contract | `repositories/__tests__/store-contract-mut100.ts` (new; memory + Postgres) | terms persist; `updateContingencyTerms` / `recordOutcome` / `correctOutcome` all-or-nothing under the version; record stale once an outcome exists; correction credits in full, voids, writes new terms; `has_payments` with nothing written; unposted commission returned by `listUnpostedDue` |
| Migrations | `repositories/__tests__/migration-mut100.test.ts` (new) | the two files apply in order, one transaction each, after a pre-existing agreement; the CHECK refuses a CONTINGENCY row without a valid rate or a treatment; no schema drift |
| Routes | `__tests__/routes-mut100.test.ts` (new, 29 tests) | create both treatments and ₪0 upfront; FIXED `[]` → `NO_INSTALLMENTS`; PATCH terms (If-Match, nothing-changed, frozen after outcome); AC 1–5 end to end (23,600 / 21,830 / nothing / NO_RECOVERY / 17 % → 18 %); due-date default and override; credit between preview and record → `PREVIEW_STALE`; FIXED hearing agreement; second record, race, idempotent replay; crash heal; audit metadata pinned; validation rows; `VAT_RATE_MISSING`; correction (full credit + void + new line, terms fix, matrix), `OUTCOME_HAS_PAYMENTS` from the route and from the store; project summary block |
| Review fixes | `routes-mut100.test.ts` › "review fixes (D1–D4)", `store-contract-mut100.ts` (7 rows added) | voided line never posts; cancel refuses after an outcome (store + racing route); upfront moved after compose → stale / `PREVIEW_STALE`; reason outside the token; credited-not-paid commission refused; correcting a never-posted line; VAT-included CREDITED; read-only key 403; two corrections racing on Postgres (one `updated`, one `stale`, one credit). Mutation-checked: each fails with its fix reverted |
| Regression | every existing server suite | unchanged assertions; edits limited to the API version pins (`1.16.0-mut100`), record fixtures gaining the new fields, and the MUT-59/MUT-61 migration harnesses applying history one transaction per file |

## Hosted API — MUT-131: Idempotency for POST /v1/inbox (2026-10-13)

Found while planning MUT-125 (the phone app's offline outbox). ADR-061. Run (Node 22, `server/`): `npm run lint` clean; `npm run typecheck` clean; `npm test` 1,523 passed / 18 skipped; `npm run test:db` (Postgres, scratch databases) 1,650 passed; `npm run build` clean.

| Area | File | What is pinned |
|---|---|---|
| Repository contract | `store-contract-inbox.ts` (2 cases added; memory + Postgres) | `userIdempotency`: new → in_progress → replay; mismatch on a different fingerprint or a different operation; `fail` releases the key; a stranger presenting the identical literal key string gets a fresh claim, never the owner's replay; `get` returns the stored claim, null after fail, nothing for another person |
| Routes | `__tests__/inbox-routes.test.ts` (4 new cases) | missing `Idempotency-Key` → 422; replay (same key + body) → identical entry, `Idempotent-Replayed: true`, confirmed via a follow-up list call that only one entry exists; same key + different body → 422 `IDEMPOTENCY_KEY_REUSED`; two different people using the identical literal key each get their own entry |
| Regression | `inbox-routes.test.ts`, `inbox-filing.test.ts`, `inbox-isolation.test.ts` | every direct `POST /v1/inbox` call updated to send an `idempotency-key` header — these pre-dated the requirement and would otherwise 422 |
| Migration | no dedicated migration test — plain additive `CREATE TABLE`, no CHECK constraint, no backfill, nothing a replay-the-history test would catch that `npm run test:db`'s scratch-database setup doesn't already exercise | `migration-mut107.test.ts` now applies the rest of the migration history before its final schema diff (matching `migration-mut61.test.ts`'s and `migration-mut100.test.ts`'s existing pattern) — it previously stopped right after its own file, which broke the first time a later migration (this one) was added |

Session writes to `POST /v1/inbox` with no identity (an API key) are covered by the existing `refuses an API key outright` case in `inbox-routes.test.ts` — refused before the idempotency middleware ever runs, so it needed no new test.

## Hosted API — MUT-107: Contingency fee proposals (2026-10-13)

Plan: `.claude/designs/mut-107-contingency-fee-proposals.md` (MUT-100 plan §11, D9/D10 already locked). Run (Node 22, `server/`): `npm test` 1,505 passed / 18 skipped; `npm run test:db` (Postgres, scratch databases) 1,630 passed.

| Area | File | What is pinned |
|---|---|---|
| Routes | `__tests__/routes-mut107.test.ts` (new, 14 tests) | propose contingency at ₪1,500 and ₪0; out-of-range rate → `COMMISSION_RATE_INVALID`; negative upfront → `AMOUNT_INVALID`; FIXED propose at ₪0 still refused (regression); one open proposal per project across types; approve with and without a terms override (agreement carries the override, the proposal keeps the originally proposed terms — ADR-060); ₪0 upfront approve with no schedule → 201, no installments; upfront > 0 with no schedule → `SCHEDULE_REQUIRED`; a ₪0 approve with a schedule sent anyway → `NON_POSITIVE_INSTALLMENT` (the pre-existing schedule guard already covers it, confirmed rather than reimplemented); FIXED approve with no schedule → `SCHEDULE_REQUIRED` (the reviewed D10 regression); FIXED approve with a `contingency` override → `NOT_CONTINGENCY`; negative agreed amount → `AMOUNT_INVALID` |
| Summaries | `routes-mut107.test.ts` (organization summary describe block) | one FIXED (10,000) + one CONTINGENCY (1,500 upfront) proposal sum to 11,500 in `proposed`; the customer row's proposal entry carries `contingency` |
| Repository contract | `store-contract-m8.ts` (1 row added; memory + Postgres) | `feeProposals.create` persists and round-trips `commissionRateBasisPoints`/`upfrontTreatment`; a FIXED proposal carries neither |
| Migration | `repositories/__tests__/migration-mut107.test.ts` (new) | applies cleanly on top of the full history (including MUT-100's two-file enum split, sequenced correctly); the CHECK rejects one-set-one-null on a raw insert; a both-or-neither row round-trips; no schema drift |
| Regression | every existing server suite | unchanged assertions; edits limited to the API version pin (`1.17.0-mut107`), one `routes-m8.test.ts` assertion gaining the new `contingency: null` field, and `migration-mut100.test.ts` gaining the same "apply the rest of history before the schema diff" step `migration-mut61.test.ts` already had (it previously stopped right after its own files, which only broke once a later migration — this one — was added) |

Session writes to the new routes (403 `READ_ONLY_PROFILE`) are covered by `writability-routes.test.ts`, which derives its cases from every route's declared security.

### MUT-102 — Brand v2 foundation (epic MUT-101, 2026-10-12)
Plan: `.claude/designs/mut-102-brand-v2-foundation-tests.md`. ADR-058. Each unit's tests were written first and failed for the right reason (missing font files; the evaluator refusing the old four-copy `theme.css`; the missing plugin, cache rule and font checks; 41 `color: var(--accent)` sites; axe and the browser for the rest).

| File | Covers |
|---|---|
| `src/test/css/brandCss.ts` (new support) | postcss-based `:root` evaluator for OS light/dark × `data-theme` × reduced motion; `var()` resolution; OKLCH ↔ sRGB, `color-mix(in oklch)`, compositing, WCAG contrast; src scans for custom-property definitions and bare `var()` references |
| `src/styles/__tests__/brand.test.ts` (new, node) | **harness:** every JSON hex within ±1 of its OKLCH; mix/contrast edge cases; cascade, the six state combinations, refusals. **fonts:** sha256 pins, `@font-face` set, Plex Mono via @fontsource, retired packages gone from `package.json` and the entries. **drift:** `--m-*` = JSON. **tokens:** every var resolves in 4 states, no colour literal, colour tokens only over `--m-*`, radii on the brand scale, body 16 and the type roles, faces, motion + reduced motion, TD-048 font half, no Inter features. **contrast:** light ≥ 7, dark ≥ 4.5 over the plan's pair list; purple text = primary-hover; placeholder ≥ 4.5 and below muted. **names:** the 132 pre-rewrite names stay defined. **references:** no new dead `var()`; the allowlist (48) shrinks only. **accent-text guard** |
| `scripts/__tests__/vite-config.test.ts` | Snapshot updated on purpose (plugin; version masked). Preload plugin in all three builds; font runtime cache CacheFirst/12, `font` only; no `otf` in precache; `findEmittedAsset` hit/miss; `fontPreloadTag` with the base |
| `scripts/__tests__/check-bundles.test.ts` | `cssUrls`, `unresolvedUrls` (missing file, escaping the dist), `fontProblems` (retired face, missing/altered Thmanyah, preload missing/without crossorigin/wrong file) |
| `qa/specs/web/brand.spec.ts` (new) | axe incl. contrast, light and dark: Home, payment drawer, Income, income drawer, Clients split, Settings, landing. EN/AR: Thmanyah Sans body 16px and loaded; Serif Display headings (landing headline inner lines too); Plex Mono tabular on Home, Income and Clients amounts; no off-origin font/stylesheet. ThemeToggle 4 states (`--bg`) + focus ring. 375/1280 × EN/AR fit, screenshots attached; TD-083's two overflows annotated |
| `qa/specs/portal/signin.spec.ts` (new; `portal` app in `qa.config.mjs`) | `/v1` stubbed 401: Thmanyah Sans body, heading Serif Display 700 in EN/AR, no off-origin font; axe light and dark (`region` known, TD-082) |
| existing `qa/specs/web/*` | Now enforce `color-contrast` (empty `KNOWN_AXE_VIOLATIONS` for the app); axe waits for drawers and animations to settle |

**What was run (Node 22):** `npx vitest run` 225 files, 3,390 passed, 4 skipped · `npm run typecheck` clean · `npm run lint` 0 errors (12 pre-existing warnings) · `npm run test:bundles` passed · `npm run build:desktop` built · `npm --prefix server test` 70 passed, 12 skipped · QA web + portal on `vite preview` builds (a gitignored throwaway config, ports 5192–5194; dev servers broke lazy chunks under parallel workers while optimising deps): 45/45, 90/90 with `--repeat-each=2` · PWA offline after one visit: Thmanyah still renders · landing LCP (Fast 3G, 4× CPU, median of 5): 4116 ms on main → 4744 ms (TD-081). **Not run:** `npm run tauri dev` with the network off; `check-bundles`' url() resolution in `dist-desktop` stands in for it.

**Review round (qa-reconcile, 2026-10-12).** New and changed tests. Each new guard was red before its fix.

| File | Covers |
|---|---|
| `brand.test.ts` › `rendered pairs` | Every `src` rule that sets a colour and an opaque background clears 7:1 light / 4.5:1 dark in 4 states. Every stylesheet parses. `KNOWN_LITERAL_PAIRS` (6 CSV literals) is shrink-only |
| `brand.test.ts` › `contrast` | Token pairs composited over `--bg` and `--surface`. New grounds: `--bg-subtle`, `--surface-hover/2`, row and nav tints; `--on-accent-subtle`; `--on-status` on the status inks and their hovers; `--text` on `--surface-3` and lavender. `--focus` on `--bg` ≥ 3:1 |
| `brand.test.ts` › `tokens` | oklch hue-drift guard (> 30°). Mono stack falls back to Thmanyah Sans. `a:not([class]):visited` |
| `brand.test.ts` › `fonts` | `src/assets/fonts` holds exactly the pinned files, and the pins live in one JSON. Only theme.css sets the page face. No mono rule asks for 600+. `html` disables bold synthesis |
| `brand.test.ts` › `focus` | No `inset var(--focus-ring)`. Primary/danger/success/warning take `--focus-ring-on-fill`, including a hovered primary. No literal colour in a focus rule |
| `brand.test.ts` › `accent-text guard` | Also `var(--accent, fallback)`, multi-line declarations, and `.ts` files |
| `scripts/__tests__/check-bundles.test.ts` | `fontProblems` flags a font preload (it used to require one) |
| `scripts/__tests__/vite-config.test.ts` | No build preloads a font. Snapshot back to main's plugin list (version masked) |
| `profileAvatarStyle.test.ts` (new), `ProfileBadge.test.tsx`, `ProfileSwitcher.test.tsx` | No inline style without a readable colour; white initials on a chosen one |
| `qa/specs/web/brand.spec.ts`, `qa/specs/portal/signin.spec.ts` | Enter moves focus into the Clients profile pane and shows a ring. Known overflows fail past their measured width (Income 726px, drawer 480px). Theme toggling is bounded. The portal heading is read from its translations |

**What was run (Node 22):**
- `npx vitest run`: 226 files, 3,418 passed, 4 skipped;
- typecheck clean; lint 0 errors (12 pre-existing warnings);
- `test:bundles` passed;
- QA web + portal on `vite preview`: 90/90 with `--repeat-each=2`, after setting the Arabic Income ceiling to its measured 726px.

**Perf runs:** landing LCP medians: preload high 4664 ms, low 4356 ms, none **3964 ms**; main 4116 ms; CLS 0.009 throughout.

**Still not run:** `npm run tauri dev` with the network off. The AAA axe rule in the browser is TD-086.

### MUT-103 — Brand v2 app sweep: no literal outside a token (epic MUT-101, 2026-10-13)

Plan: `.claude/designs/mut-103-brand-sweep.md`. ADR-058 (amendment). TD-079 (narrowed). Nine commits on `feature/mut-103-brand-sweep`: the guard and baseline first (TDD — detector fixtures were red before the matching code), then the alias codemod, then one surface group per commit, then density, then knowledge files.

| File | Covers |
|---|---|
| `src/test/css/brandCss.ts` › `cssLiterals`/`scriptLiterals`/`tabularWithoutMono` (new) | A colour (hex, `rgb/hsl/hwb/lab/lch/oklab/oklch/color()`, `white`/`black`), a px/rem font-size, or a px `*radius` in a CSS declaration; a whole-string colour or a numeric `fontSize`/`borderRadius` in TS/TSX; any `<style>` element in TSX; a `tabular-nums` rule with no `--font-mono` in the same rule. Each has `it.each` fixtures for what it catches and what it leaves alone (`transparent`, `currentColor`, `0`, `%`, `em`, `calc(var(--radius-*) - 1px)`, an href fragment, prose containing `rgb(`) |
| `brand.test.ts` › `literals` › `the repo` | Every file outside `src/styles/` and the D4 user-data allowlist (`ALLOWED_LITERAL_FILES`) has zero literals; `KNOWN_LITERALS` (shrink-only, now `{}`) and `KNOWN_TABULAR_WITHOUT_MONO` (now `[]`) fail on a new file, a higher count, or a stale (too-low) count — so a fixed file must be removed from the list, not just left at a smaller number |
| `brand.test.ts` › `tokens` | `--radius-xs`/`--text-micro` resolve and match the JSON (D1); `FROZEN_THEME_NAMES` no longer lists the deleted aliases; the mono-weight check (`asks Plex Mono only for the weights it ships`) fails a rule that sets `font-family: var(--font-mono)` and `font-weight: var(--weight-semibold|bold)` (or a literal 600+) in the same declaration block |
| `brand.test.ts` › `references` | No new dead `var()` — the 48-name allowlist the foundation left is gone entirely, so this is now a plain "zero dead references" check, not a shrink-only one |
| `qa/specs/web/brand.spec.ts` › `@web.brand.layout` | The Clients row is ≥ 48px tall at 1280px (D5, new); the existing 8-surface × 2 scheme × 2 viewport × 2 language matrix (Home, Clients, Income + both drawers, Settings, Import, Expenses, Planning) still fits, with `KNOWN_OVERFLOW` unchanged from its MUT-102 baseline |

**What was run (Node 22, this session):** `npx vitest run src/styles/__tests__/brand.test.ts` 168/168 · `npx vitest run src/styles` and `src/pages/landing` (217 tests total) · `npm run lint` 0 errors (6 pre-existing warnings) · `npm run typecheck` clean · `npm run build` (web) succeeded · `npm run test:bundles` passed · `npx playwright test qa/specs/web/brand.spec.ts` against a local `vite dev` server (QA_CONTEXT override, no QA engine): 16/16, including the new row-height assertion at all 8 layout-matrix combinations. **Not run this session:** the full `npm run test:run` Vitest suite (explicitly skipped per instruction) and the desktop/hosted builds.

## MUT-111 — App-association files and the /capture web fallback (2026-10-13)

Epic MUT-63. Serves `/.well-known/apple-app-site-association` and
`/.well-known/assetlinks.json` from the API origin, generated from config
(all-or-nothing: `config.ts` fails fast at boot on a partial set, a
Terraform `lifecycle.precondition` catches it earlier at `plan` time), plus
a `/capture` route on the hosted portal that redirects to the first
profile's expenses page (signed-in) or through sign-in first (signed-out),
never a 404. Unblocks MUT-113 (iOS) and MUT-114 (Android, already partially
built against this ticket's config shape).

| Area | File | What is pinned |
|---|---|---|
| Config | `server/src/__tests__/config.test.ts` | all four app-association vars default absent; all four set parses; each of the four set alone throws `ConfigError` naming the missing ones; an empty string on any one is refused by the existing schema validation |
| Routes | `server/src/__tests__/well-known-routes.test.ts` (new) | both routes 200 + `application/json`, no redirect; AASA carries exactly `['/p/*/expenses*', '/p/*/payments*', '/capture*']` and the `teamId.bundleId` appID; assetlinks grants `handle_all_urls` + `get_login_creds` for the Android package with every fingerprint; a blank entry from a trailing/doubled comma is dropped |
| App wiring | `server/src/__tests__/portal.test.ts` (rows added) | `appAssociation` absent → both well-known paths still get the JSON 404, not the SPA shell, even with the portal build mounted; `appAssociation` present → answers directly with no portal build; both mounted → well-known paths win over the SPA shell, `/health`/`/ready`/CSP unaffected |
| Route security | `server/src/__tests__/route-security.test.ts` | unchanged — confirms the new routes (outside `/v1/*`) need no `security` declaration |
| Hosted portal | `src/hosted/session/__tests__/auth-states.test.tsx` (new "MUT-111" block) | signed-out `/capture` → `/sign-in?next=%2Fcapture`; signed-in with a profile → lands on `/p/<id>/expenses` and it actually renders ("No expenses recorded…"); signed-in with zero profiles → S11's existing "no profiles" screen |

**What was run (Node 22):**
- `server/`: `npm run lint` clean; `npm run typecheck` clean; `npm test` 1,538 passed / 18 skipped; `npm run build` clean; `openapi:check` up to date (the two new routes are behind the same off-by-default `appAssociation` dependency as the portal routes, so the committed spec — generated with every optional dependency disabled — is unaffected, matching precedent).
- root: `npm run lint` 0 errors (12 pre-existing warnings, none in touched files); `npm run typecheck` clean; `npm run test:run` 3,432 passed / 4 skipped, one unrelated flake (`ExpenseDrawer.oneTimeFields.test.tsx`, times out only under full-suite parallel load, passes in isolation — not touched by this ticket); `build:web`, `build:hosted`, `build:desktop` all clean.
- Terraform: `terraform fmt` clean; `terraform validate` not run (no cached provider plugins in this environment) — the `dynamic "env"` block and `lifecycle.precondition` are standard HCL already used elsewhere in GCP modules, but a real `terraform plan` against a scratch project is the first opportunity to catch anything this review missed.

**Still not run (inherently manual, see `server/DEPLOYMENT.md` §4d):** Apple's AASA validator and Google's Digital Asset Links tester against a live deploy — no test harness in this repo calls either service's live infrastructure.

## MUT-94 — Expenses "Total expenses" strip stale-source fix (2026-10-13)

Root cause: since MUT-14, real expenses live in `db.expenses`, but
`aggregateTransactionTotals*` only ever summed `expensesMinor` from
`db.transactions`, which has held no real expense rows since. Fixed at the
repository layer (`transactionRepo.getOverviewTotals(ByCurrency)`,
`projectSummaryRepo.list`/`get`) and in `InsightsPage`'s monthly trend chart
(a 4th reader with its own independent copy of the same bug), additively —
`db.expenses` is summed alongside the legacy `db.transactions` `kind:'expense'`
path (ADR-062), not instead of it, since demo seed data and CSV import still
write that legacy shape (TD-105, follow-up MUT-138).

| Area | File | What is pinned |
|---|---|---|
| New helpers | `src/db/__tests__/aggregations.test.ts` | `filterExpensesByDateAndCurrency`/`filterExpensesByEntity`/`filterExpensesByEntityAndDate`/`sumExpensesMinor`/`sumExpensesByCurrency` — empty input, date-range filter, currency filter, project/client entity filter, `deletedAt` exclusion |
| Repository | `src/db/__tests__/transactionRepo.test.ts`, `src/db/__tests__/projectRepo.test.ts` | 5 existing tests that seeded `kind:'expense'` **transactions** (impossible via real app usage since MUT-14) switched to seed real `db.expenses` rows via `expenseRepo.create` — this is exactly the gap that let the bug ship; new `projectSummaryRepo.get` case covers the same for the single-project read path |
| Expenses ledger | `src/pages/expenses/__tests__/ExpensesLedgerPage.test.tsx` | strip sums the `mockExpenses` fixture ($900, all USD), not a stale ₪0; a dedicated $42 case matches the ticket's literal acceptance criterion |
| Insights | `src/pages/insights/__tests__/InsightsPage.test.tsx` | monthly trend's expense figure includes a `db.expenses`-sourced row on top of the legacy transaction-side one ($1,000 + $500 = $1,500) |

**Scope note:** `clientSummaryRepo`/clients pages were checked and confirmed to
never read `expensesMinor` (receivables/owed only) — not affected, no fix
needed. `IncomePage` reads `useOverviewTotalsByCurrency` but only destructures
`paidIncomeMinor`/`unpaidIncomeMinor` — unaffected visually, though the
underlying totals it reads are now also correct. `getOverviewTotals`
(singular-currency variant) has zero current UI callers; fixed anyway for
consistency since it shares the same code path as `getOverviewTotalsByCurrency`.

**What was run (Node 22):** `npx vitest run`: 228 files, 3,449 passed, 4
skipped; `npm run lint` 0 errors (12 pre-existing warnings, none in touched
files); `npm run typecheck` clean; `npm run build` (web) clean.

**Out of scope, filed separately:** MUT-138 — Import Data writes expense rows
as `kind:'expense'` transactions instead of `db.expenses`, so imported
expenses never appear on `/expenses`; `TransactionsPage`'s row-click handler
for such a legacy row also looks up the wrong table for editing. Found while
tracing this bug's full reader graph, not built here.

## MUT-138 — Import writes expenses into db.expenses; legacy row edit routing fixed (2026-10-13, ADR-069)

Follow-up to MUT-94/TD-106. Two independent fixes: (1) CSV import
(`ImportDataPage.tsx`) now writes expense rows via a shared
`importExpenseRow()` helper into `db.expenses`, with a `profileId` resolved
once per import run and threaded through every entity created, not just
expenses; (2) `ProjectDetailPage.tsx`'s row click for a legacy
`kind:'expense'` transaction now opens a new `LegacyExpenseEditDrawer`
instead of `ExpenseDrawer`, which was looking the row up in the wrong table.
`TransactionsPage.tsx`/`ImportDataModal.tsx` had the identical bugs but were
confirmed dead code (unrouted/unrendered — confirmed against `src/router.tsx`,
where `/transactions` redirects to `/income`) and were intentionally left
unfixed here; MUT-145 (merged to main the same day) deleted both outright,
porting `ImportDataModal`'s tests onto `ImportDataPage.test.tsx`. Merging
this branch with MUT-140/MUT-141/MUT-145 (all landed the same day) also
surfaced and fixed two real pre-existing JOD gaps in shared code: the
drawer's amount prefill hardcoded `/100` (now `currencyExponent`-aware), and
`ExpenseFormFields.tsx`'s amount input hardcoded `step="0.01"`, which
silently blocked saving any 3-decimal JOD amount in the real `ExpenseDrawer`
too (a step mismatch fails the browser's native constraint check before the
submit event fires at all — no visible error).

| Area | File | What is pinned |
|---|---|---|
| New helpers | `src/utils/__tests__/csvImport.test.ts` | `importExpenseRow` writes `db.expenses` not `db.transactions`, category resolves against `db.expenseCategories` (creates once, reuses on a repeat name), client/project id resolution from the import's name maps, skips a row missing amount/currency/date, defaults title; `resolveImportProfileId` returns an already-selected profile unchanged, auto-creates a default profile (English and Arabic name) via `businessProfileRepo.create`, matching `WelcomeModal`'s skip shape, when none exists |
| CSV import, page | `src/pages/settings/__tests__/ImportDataPage.test.tsx` | a CSV expense row lands in `db.expenses` (via `expenseRepo.list()`) and not `db.transactions`, with the category in `db.expenseCategories` not the legacy global `db.categories` (AC1, AC3) — merged into MUT-145's ported suite for the one live import page |
| Legacy edit drawer | `src/components/drawers/__tests__/LegacyExpenseEditDrawer.test.tsx` | loads an existing `db.transactions` row by id (not `db.expenses`); a save preserves `kind:'expense'`/`status:'paid'` and never writes `db.expenses`; delete asks for confirmation and soft-deletes (`deletedAt`) only when confirmed; saving with no category selected doesn't fail; a stale `clientId`/`projectId` pointing at a deleted record renders without crashing; a JOD row loads and saves at 3-decimal precision |
| Store | `src/lib/__tests__/stores.test.ts` | `openLegacyExpenseDrawer`/`closeLegacyExpenseDrawer` state transitions |
| Edit routing | `src/pages/projects/__tests__/ProjectDetailPage.test.tsx` | both the row-click and the title-click paths for a `kind:'expense'` transaction now call `openLegacyExpenseDrawer`, and explicitly assert `openExpenseDrawer` is NOT called (the exact regression this ticket fixes) |

**Scope note:** `src/demo/seedData/transactions.ts` is unchanged — explicitly
out of scope per the ticket (dev/demo-only), so the two-table split isn't
fully eliminated, only the import and edit-routing consequences MUT-138's
acceptance criteria named. `ImportDataPage.tsx`'s own income/expense CSV
loops still hardcode base-100 amount parsing (wrong for JOD) — pre-existing,
tracked separately as TD-112 (filed during MUT-141's build), not fixed here.

**What was run (Node 22, on the fully merged tree with MUT-140/141/145):**
see this merge's own verification note for exact counts — full `npx vitest run`,
`npm run lint`, `npm run typecheck` (both tsconfigs), `npm run build` and
`npm run build:hosted` all green before landing.

### MUT-139 — Settings IA reorg (2026-10-13)
Plan: `.claude/designs/settings-ia-reorg.md`. IA/placement only, no visual redesign. Two gaps from the original review corrected during planning/build after reading the actual code and tests: the Theme control is an intentional shared-state pattern (MUT-79), not a duplicate — dropped from scope; `/settings/import` already has a working "back to Settings" button (just not the shared `TopBar` breadcrumb pattern) — logged as TD-108 instead of forcing a header-component swap.

| File | Covers |
|---|---|
| `src/pages/settings/__tests__/SettingsPage.a11y.test.tsx` | Updated heading-presence list (profile/language/theme/currency/data — About, Advanced Features and Data Tools are mocked out, each covered by its own test). New DOM-order assertion locks in Business Profiles first. New `describe('enabled currencies')`: toggling a currency off calls `updateSettings` with the new array, toggling a disabled one back on, and refusing to disable the last remaining currency (no mutate call) |
| `src/pages/settings/__tests__/AboutSection.test.tsx` (new) | One h2, zero h3s. App name/description shown once; current version shown exactly once (in the update-status row, not duplicated in the About blurb — a pre-existing duplication the merge made glaring, fixed as part of it). Checking/error/up-to-date/has-update states each show the version. Support links, desktop download links and the all-versions link |
| `src/components/__tests__/BusinessProfileDrawer.test.tsx` | Field labels updated to "Document Currency"/"Document Language" (same collision as `ProfileDetailPage`'s Document Defaults tab, found in a second file while fixing the first) |

**What was run (Node 22):** `npm run lint` 0 errors (12 pre-existing warnings, none in touched files); `npm run typecheck` clean; `npx vitest run` 229 files, 3,461 passed, 4 skipped; `npm run build` (web) clean.

**Logged, not fixed here:** TD-107 (enabled-currencies toggle has no control for a currency outside USD/ILS, e.g. one that reached `enabledCurrencies` via JSON import — never shipped live before this ticket restored the toggle, so not a regression); TD-108 (`/settings/import`'s custom header vs. the shared `TopBar` breadcrumb pattern used everywhere else in Settings).

### MUT-139 follow-up — Settings visual redesign (2026-10-13, ADR-064)
Wireframe: `.claude/designs/mut-139-settings-visual-redesign-wireframe.html`, built from real Brand v2 tokens, reviewed and refined twice before implementation.

| File | Covers |
|---|---|
| `src/components/ui/__tests__/SegmentedControl.test.tsx` (new) | Radiogroup renders one radio per option with the current value checked; click calls `onChange` with the new value and does nothing when clicking the already-selected option; arrow keys move selection and wrap at the ends; roving tabindex (only the selected option is tab-reachable); accepts `labelledBy` |
| `src/pages/settings/__tests__/SettingsPage.a11y.test.tsx` | Heading list updated: Language/Theme/Currency titles replaced by one `preferences.title`; DOM-order assertion updated to 3 inline headings (Profile, Preferences, Data); new test confirms Language/Theme/Currency render as plain text inside the merged card, not headings; new tests exercise the segmented controls end to end — Theme via the mocked `setTheme`, Language via the real `LanguageProvider` (with a `beforeEach` `localStorage.removeItem` so the real provider's persistence can't leak state into later tests) |
| `src/components/ui/__tests__/ProfileBadge.test.tsx`, `BusinessProfileDrawer.test.tsx` | Unchanged — `ProfileBadge` reused as-is for the Business Profiles no-logo fallback, no new test needed since its existing contract already covers this use |

**What was run (Node 22):** `npm run lint` 0 errors; `npm run typecheck` clean; `npx vitest run` on the settings + SegmentedControl suites green throughout; full-suite run (3,470/3,474) was clean immediately before the final two CSS/JSX tweaks (family-wrapper margins, currency-pill colour), which touched only class names and a CSS rule, not test-observable behavior. Verified live via Playwright against the dev server, light and dark themes — this caught two defects the wireframe couldn't show: Data Tools still read as a separate full-width section (tint alone wasn't enough; fixed by moving it inside the width cap, confirmed with Basel first) and the enabled-currencies pills' solid fill read as visually loud next to the new segmented controls (fixed with a softer tint).

---

## MUT-140 — JOD currency support (2026-10-13)

JOD is a 3-decimal (fils) currency, unlike USD/ILS/EUR (all 2-decimal) — the risk this ticket guards against is the exact one the sister Flutter app hit (MUT-72 → MUT-119): a 2-decimal assumption baked into shared formatting code, discovered only after shipping.

| File | Added | Covers |
|---|---|---|
| `server/src/__tests__/money.test.ts` | +5 | JOD parses/formats/round-trips at 3 decimals; rejects a 4th fractional digit; `isSupportedCurrency('JOD')` and `currencyExponent` for all four currencies |
| `src/lib/__tests__/utils.test.ts` | +9 | `formatAmount`/`parseAmountInput`/`parseAmountToMinor`/`parseCurrencyInput` at JOD's 3 decimals, including the `maxDecimals: Infinity` half-up rounding path; the regression case proving USD still caps at 2 decimals after the arithmetic generalized from hardcoded base-100 to exponent-driven; `amountInputCurrency` reads a JOD token; new `currencyExponent()` unit |
| `src/components/drawers/__tests__/IncomeDrawer.schema.test.ts` (new) | 5 | The amount/currency `superRefine` cross-field check directly against the exported zod schema (cheaper and more precise than a full component render): JOD accepts 3 decimals, rejects a 4th; USD still rejects a 3rd after the schema restructuring; non-positive amounts rejected for any currency |
| `src/components/drawers/__tests__/IncomeDrawer.locked.test.tsx` | 0 (regression) | Full suite re-run green after the schema `superRefine` restructuring and the `incomeFormSchema.ts` extraction — no behavior change to the locked-transaction flow |
| `src/utils/__tests__/csv.test.ts` | +2 (new `exportDataToCSV` describe block) | A JOD transaction exports at 3 decimals (not rounded to 2 — this was a real bug: the hardcoded `/100` divisor produced a 10x-too-large amount); a USD transaction is unaffected |
| `src/utils/__tests__/csvValidation.test.ts` | +1 (1 updated) | JOD accepted as a valid CSV currency; the "invalid currency" error message updated to list JOD among the valid options |
| `src/features/documents/__tests__/pdf.test.ts` | +1 | `DocumentPdf.tsx`'s independent local `formatAmount` (a second, separate implementation from `utils.ts`'s) also made currency-aware — found mid-ticket: the PDF renderer doesn't use `Intl.NumberFormat` the same way, so it carries its own exponent table that had the identical hardcoded-2-decimal bug |
| `src/pages/landing/__tests__/landingCopy.test.ts` | 1 updated | The public FAQ's currency list now includes JOD (`CURRENCY_NAME_KEYS` is an exhaustive `Record<Currency, string>` — the type widening forced this as a real decision, not a type-check formality) |
| `src/components/drawers/__tests__/ExpenseDrawer.schema.test.ts` (new — this drawer's first test file) | 6 | qa-reconcile gap found and closed same-session: ExpenseDrawer's amount field never validated decimal precision for any currency (only non-empty) — a USD expense typed with a 3rd decimal silently rounded instead of being rejected. Added the same amount/currency `superRefine` cross-field check as `IncomeDrawer` (schema extracted to `expenseDrawerFormSchema.ts`): JOD accepts 3 decimals, rejects a 4th; USD rejects a 3rd; non-positive rejected; the pre-existing recurring-type cross-field checks still enforced (regression) |

**What was run (Node 22):** `npm run typecheck` clean · `npm run lint` 0 errors (12 pre-existing warnings, unrelated) · `npm run build` succeeded. Targeted `vitest run` on every file listed above: 256 tests passed. **The full suite (`vitest run` with no path filter) was not re-run this session** (explicit instruction mid-session) — run it before merge to confirm no regression outside the files touched here.

**Scope note:** document/invoice generation (`DocumentFormPage.tsx`, `DocumentDrawer.tsx`, `LineItemsTable.tsx`) was briefly widened to accept JOD, then reverted — that whole feature is being removed (MUT-145, product direction is digital-ledger-only). `DocumentPdf.tsx`'s fix above stayed, since it's the same defensive type-completeness category as the aggregation fixes, not new JOD feature investment in a surface that's going away.

## MUT-145 — Retire document generation; MUT-158 — profile import (2026-10-13)

Each acceptance criterion maps to a test (plan: `.claude/designs/mut-145-remove-documents.md`).

| File | Added / changed | Covers |
|---|---|---|
| `src/__tests__/noDeadDocumentModules.test.ts` (new) | 15 | AC1/AC7 guard: deleted paths stay gone (documents module and pages, DocumentDrawer, TransactionsPage, ProfileDetailPage, ImportDataModal, PDF services, DocumentIcon, `public/fonts`); `@react-pdf/renderer` not a dependency; no app source names a deleted module or an absolute `/fonts/` path; barrels clean |
| `src/db/__tests__/retainedDocumentSchema.test.ts` (new) | 3 | AC3: both tables stay at v21; rows read back unchanged and round-trip through backup/restore |
| `src/db/__tests__/transactionRepo.test.ts` | 2 rewritten, isLocked block removed | AC2: a row seeded with `lockedAt`/`lockedByDocumentId` updates and soft-deletes |
| `src/components/drawers/__tests__/IncomeDrawer.legacyLock.test.tsx` (replaces `.locked`) | 2 | AC2: a legacy-locked entry opens editable with no notice and saves an edit |
| `src/components/layout/__tests__/FeatureNoticeBanner.test.tsx` | +2 | A stored retired key (`invoices`) never renders a raw i18n key; a notice of only retired keys shows no banner |
| `src/__tests__/router.gateKeys.test.ts`, `router.gates.test.ts` | +4, lists trimmed | `/documents`, `/documents/$`, `/settings/profiles/$profileId` redirect; document routes no longer exist |
| `src/lib/features/__tests__/*` | updated | AC4: five areas; a stored `invoices` switch is dropped; retained documents enable nothing and survive gating |
| `src/components/__tests__/BusinessProfileDrawer.test.tsx` | +5, 2 removed | IA: Identity/Money/Contact order; no letterhead fields; name-only create with no email; a malformed email is still rejected; edit keeps stale letterhead fields |
| `src/db/__tests__/profileImport.test.ts` (new) | 11 | MUT-158: create/merge remap every ID and link (incl. retained documents); profile-scoped duplicates; email-less profiles never match; FX dedupe; existing sequence kept |
| `src/pages/settings/__tests__/ImportDataPage.test.tsx` (new, ported from the modal) | 18 | The live import page: drop zone, errors, legacy replace, v2 create/merge choice, duplicates, stats without documents, and a real Settings → Export → Import round trip with links intact |
| `ClientDetailPage`, `SidebarNav.features`, `OrphanedRecordsDrawer`, `migration-v20`, `migration-safety`, `settingsRepo`, `paymentRecords`, `RecordPaymentButton`, `brand` | updated | No invoice actions or Documents nav; partial-failure assign via a failing write instead of a lock; v20/restore enable nothing from documents; legacy-lock payment tests reframed |

| qa-reconcile review regressions | +4 | F1 `profileImport.test.ts` (same-name project under another client stays separate); F5 `ImportDataPage.test.tsx` x2 (a full backup is refused and data kept; a file with nothing to import is refused); F3 round trip (an archived client and project keep their entries linked). Each was proven red before its fix. |

**Retired:** `documentRepo.test.ts`, `features/documents/__tests__/{pdf,totals}.test.ts`, `paymentRequestService.test.ts`, `IncomeDrawer.locked.test.tsx`, and the ImportDataModal block of `ImportExportModals.test.tsx` (ported).

**Gate (Node 22):** `npm run typecheck` clean, `npm run lint` 0 errors (5 pre-existing warnings), `npx vitest run` 233/233 files (3420 tests) green, `npm run build` succeeds; `dist-web` has 0 `react-pdf` hits and no `fonts/` (3.2 MB).

## MUT-141 — Currency conversion logging (2026-10-13)

New `kind: 'conversion'` on `Transaction`, excluded from P&L totals, on a new dedicated `/conversions` page gated by a 7th feature flag — see ADR-067 for the two findings that reshaped this ticket mid-build (the "excluded by construction" premise was false until the aggregation branches were tightened; the "Transactions ledger" the ticket assumed exists is dead code).

| File | Added | Covers |
|---|---|---|
| `src/db/__tests__/aggregations.test.ts` | +3 | A conversion row contributes 0 to `paidIncomeMinor`/`unpaidIncomeMinor`/`expensesMinor` in `aggregateTransactionTotals`, `aggregateTransactionTotalsByCurrency` (per-currency), `aggregateTransactionTotalsWithActivity` (also confirms `lastActivityAt` still tracks it); mixed-batch case alongside real income/expense rows |
| `src/lib/__tests__/aggregations.test.ts` | +2 | `calculateForecastKPIs`: a past AND a future conversion in the same batch touch neither `cashOnHand` nor `leaving` (the exact two branches that would have miscounted it as an expense); `calculateMonthActuals`: a conversion contributes 0 to `expenses`/`received`/`unpaid` |
| `src/lib/features/__tests__/features.test.ts` | 1 updated, +1 | "six areas" → "seven areas" assertion updated for the new `conversions` key; new assertion that `FEATURE_DATA_PROBES.conversions` is `[]` (never auto-enabled by data, same as `insights`, for a stronger reason — see ADR-067 point 5) |
| `src/components/drawers/__tests__/conversionFormSchema.test.ts` (new) | 10 | Valid two-currency conversion parses; JOD's 3rd decimal accepted independently on either side; a 4th decimal / wrong-precision rejected independently on either side (proves the two `superRefine` checks don't leak into each other); non-positive amount rejected on either side; same-currency conversion rejected; date required; note optional |
| `src/components/__tests__/ConversionDrawer.test.tsx` (new) | 4 | Create flow writes `kind:'conversion'`, `status:'paid'`, both currency legs, and the selected profile to `db.transactions`; the implied-rate readout renders and matches hand-computed expectation; same-currency conversion blocked before any write; edit flow loads an existing row's both amounts/currencies/notes correctly and re-saves |
| `src/pages/conversions/__tests__/ConversionsPage.test.tsx` (new) | 5 | Empty state; a row renders both currency amounts (exact `Intl.NumberFormat` output, not an assumption) and the correct implied rate; the default this-month date range excludes an out-of-range conversion; search filters by note text; row click opens the edit drawer with the right `transactionId` |
| `src/utils/__tests__/csv.test.ts` | +2 | A conversion row exports both legs at each currency's own precision (JOD's 3 decimals preserved, not rounded); `toCurrency`/`toAmount` are blank for income/expense rows (no cross-contamination) |
| `src/utils/__tests__/csvValidation.test.ts` | +6 (1 updated) | Valid conversion row passes; missing `toAmount`/`toCurrency` each rejected with their own message; invalid `toCurrency` rejected; same currency on both sides rejected; missing date rejected; the "invalid type" error message updated to list `conversion` among valid types |
| `src/lib/features/__tests__/routeGuard.test.ts` | 0 (no change needed) | Already generic over `FeatureKey` — `requireFeature('conversions')` is covered by the existing key-agnostic suite with no new test required |
| `src/pages/insights/__tests__/InsightsPage.test.tsx` | +1 | **`/qa-reconcile` finding, fixed same session:** this page's own `summaryTotals` doesn't route through the shared `aggregations.ts` module — it had the identical bare-`else` bug, duplicated inline, missed by the first pass. Test proves a conversion row no longer inflates the Expenses KPI ($1,000 → would have been $1,500 uncaught). `ReportsPage.tsx` has the same duplicate logic but is confirmed-unreachable dead code (`/reports` redirects to `/insights`) — not fixed, not tested, consistent with how this ticket's other dead-code discoveries were handled |

**Known gap (not closed this session):** `ImportDataPage.tsx`'s new conversion-import branch has no render/integration test — the whole page has none (TD-111), a pre-existing gap this ticket's branch inherited rather than fixed. Covered indirectly (row-shape validation + export round-trip), not end-to-end.

**What was run (Node 22):** `npm run lint` 0 errors (13 pre-existing warnings, unrelated — the `react-hooks/incompatible-library` `watch()` warning already exists on every other React Hook Form drawer) · `npm run typecheck` clean · `npm run build` succeeded (new `ConversionsPage` chunk code-split as expected) · full `vitest run` (no path filter): 3,536 passed / 4 skipped, after the `/qa-reconcile` fix above.


## MUT-47 — The storage seam made complete and linted (2026-10-13, ADR-071)

Every storage call outside `src/db` now goes through `getRepositories()`; moves were characterized before they were made (D8).

| File | Added | Covers |
|---|---|---|
| `src/db/__tests__/provider.test.ts` | +2 | The `plans`, `planAssumptions`, `planScenarios`, `dataset` and `demoData` slots resolve to the Dexie objects |
| `src/hooks/__tests__/usePlanQueries.test.tsx` | rewritten mock, +1 | Mocks the `db` barrel instead of `planRepository`; `usePlanCategorySummary` summarises through the injected `planAssumptions` in the plan's currency |
| `src/db/__tests__/retainerRepo.test.ts` | +4, 4 re-pointed | Characterization (run green against the old helpers first): `refreshDueStates` flips only upcoming rows dated today or earlier; `markMissed`; `getAllMatchSuggestions` skips unpaid, linked and deleted income; regenerating keeps received rows and drops upcoming ones. Match/unmatch/suggestions/summary tests now call the repository methods |
| `src/hooks/__tests__/useRetainerQueries.test.tsx` | +3 | Every retainer hook (summary, suggestions, mark missed, due states, match, unmatch) calls `getRepositories()` |
| `src/db/__tests__/dataset.test.ts` (new) | 5 | `importLegacyV1` replaces the six tables; **a failing write leaves the database unchanged** (D8, proven red without the transaction); `exportCoreTables` returns archived and deleted rows; `wipeCoreData` clears exactly five tables and keeps profiles, expenses and settings; `csvValidationContext` lists names across businesses |
| `src/db/__tests__/csvImport.test.ts` | moved from `src/utils/__tests__/` | Unchanged assertions; module moved into `src/db` |
| `src/db/__tests__/transactionsNeedsReview.test.ts` (new) | 2 | `listNeedsReview`; `resolveNeedsReview` writes exactly `{ profileId, needsReview: undefined }` (no `updatedAt`, TODOS #11) |
| `src/db/__tests__/demoData.test.ts` (new) | 1 | `removeDemoData` deletes `demo_` rows and keeps the person's own clients, entries and business |
| `src/db/__tests__/expenseCategoriesSeedDefaults.test.ts` (new) | 2 | `seedDefaults` creates the preset in the chosen language; it is not de-duplicated |
| `src/__tests__/seamLint.test.ts` (new) | 14 | The ESLint seam rule rejects 8 bypass shapes outside `src/db` and allows `getRepositories`, constants, pure helpers, types and aggregations; it does not apply inside `src/db` or to tests |
| `src/pages/settings/__tests__/DataToolsSection.test.tsx` | updated | Mocks `serializeAllTables` + `downloadBackup` instead of the removed `exportBackup`; asserts the download gets the serialized backup |

Regression net kept unchanged and green: `ImportDataPage.test`, `ImportExportModals.test`, `OrphanedRecordsBanner.test`, `ClientsPage.test` (its spy on `getCrossProfileClientStats` still applies through the slot), `visitorSample.test`, `crossProfileBadges.test`.

**Gate (Node 22, worktree, 2026-10-13):** `npm run lint` 0 errors (6 pre-existing warnings) · `npm run typecheck` clean · `npm run test:run` 246/246 files, 3536 passed, 4 skipped · `npm run build` succeeds. The IncomeDrawer load failure seen on main (TD-073) did not recur in two full runs.

## MUT-88 — Settings in five groups, one home per action (2026-10-13, ADR-072)

| AC | Tests |
|---|---|
| Each action exactly once; duplicates removed | `SettingsPage.structure.test.tsx` (real sections: six buttons once each; the old Export JSON / Export Backup / Import Data / Import Backup and the Data Tools heading are gone), `YourDataSection.test.tsx` (row order, once each) |
| Last backup date stored and shown | `backup.test.ts` (stamp on success only; restore sets the backup's timestamp; newer-version refusal keeps data), `YourDataSection.test.tsx` ("Last backed up" / "Not backed up yet", EN + AR) |
| One scroll area | `SettingsPage.a11y.test.tsx` (every section inside `.settings-column`; `.page-content` uncapped). Browser check: one scroller, at full width |
| Exactly one default | `profileDefault.test.ts` (pick rules + enforce), `businessProfileRepo.test.ts` (two creates, archive hands the default to the earliest real profile, unset moves it, repair on next write), `profileImport.test.ts` (makeDefault), `seedDefault.test.ts` (the welcome-modal race), `backup.test.ts` (restore with two defaults), `migration-v22.test.ts` |
| No Sync row | `SettingsPage.a11y.test.tsx` |
| Order + typed confirmation | `SettingsPage.a11y.test.tsx` (Businesses, General, Features, About, Your data; Delete last and outside every card), `DeleteAllDataModal.test.tsx` (locked until backup + word; case and space tolerant; Arabic حذف; backup failure keeps step 2 locked; real backup, not CSV) |
| Restore routing | `dataFiles.test.ts`, `RestoreBackupModal.test.tsx` (date, count, plural, cancel, failure inline), `YourDataSection.test.tsx` (full → confirm → restore; CSV / business export → import page; unknown → toast), `ImportDataPage.test.tsx` (hand-off preview, profile match after load, taken once) |

Regression contract (review D3): all 6 DataToolsSection cases are ported to `YourDataSection.test.tsx`, and all 9 SettingsPage.a11y cases are kept (the order case is rewritten on purpose).
QA: `qa/specs/web/settings.spec.ts` `@web.settings.export` follows "Export a business". It was not run here; run it on a preview build. The language and theme specs are already broken by MUT-139's radios (MUT-160). Fixed in MUT-160 (below).

**Merged onto MUT-47 (qa-reconcile, 2026-10-13):** `DataToolsSection.test.tsx` (the version MUT-47 updated, line above) is deleted along with the component; its cases are the ones ported into `YourDataSection.test.tsx`. `YourDataSection`, `RestoreBackupModal` and `demoData.seed` were adjusted to call `getRepositories().base.dataset.*` instead of the direct `db/*` imports MUT-88 was built against, per ADR-071's seam; `backUpNow`'s test moved to `src/utils/__tests__/backupDownload.test.ts` alongside its new home. Gate re-run post-merge (Node 22, per Basel no full suite): `lint` 0 errors, `typecheck` clean, targeted suite (profileDefault, migration-v22, businessProfileRepo, profileImport, backup, dataFiles, RestoreBackupModal, ImportDataPage, SettingsPage, DeleteAllDataModal, YourDataSection, seedDefault) 155/155 passed.

## MUT-60 — Every Received income entry is record-backed (2026-10-13, TD-029)

| AC | Tests |
|---|---|
| Saving a new income as Received creates exactly one PaymentRecord for the full amount, dated the payment date | `transactionRepo.test.ts` (`createReceivedIncome`: one record, full amount, dated `paidAt`; atomic rollback on a rejected date; the `hasRecords` edit branch applies afterward), `IncomeDrawer.test.tsx` (strengthened "creates a paid entry when Received is chosen" to also assert the record), `useQueries.test.tsx` (`useCreateReceivedIncome` wiring + invalidation) |
| `listByTransaction` returns that record, and the client's Payments section shows it once | `paymentRecords.test.ts` ("adds no entry row for a fast-added Received entry -- it is record-backed from creation") |
| The upgrade backfills every uncovered paid entry exactly once; running it twice creates no duplicates | `database.test.ts` (`uncoveredPaymentAmount`, every branch, pure), `migration-v23.test.ts` (fully-paid, part-paid, already-covered, top-up-partial-coverage, soft-deleted, archived, expense-skip, future-date clamp, empty DB, fresh install) |
| Owed Now, Recent payments and Last payment unchanged before/after the backfill | `aggregations.test.ts` (`paymentRowsForIncome` reports identical amount/paidAt whether covered by the ADR-033 entry fallback or a backfilled record -- only `source` flips; `summarizeOwedByCurrency` needs no test, it reads only `Transaction[]`, which the backfill never writes to) |
| A migration-safety test covers the new version | `migration-v23.test.ts` ("Migration safety after v22 → v23", mirroring v21's precedent) |

**Found in eng review, folded into scope:** CSV import (`csvImport.ts`) wrote paid income rows the same record-less way, through a third door nothing else in this ticket touches -- `csvImport.test.ts` gained three cases (paid creates a record, blank paidAt falls back to the row date, unpaid creates none).

**Regression sweep for the version bump (v22 → v23):** every test hardcoding the app's current top schema version was re-verified and bumped: `migration-v20/v21/v22.test.ts`, `retainedDocumentSchema.test.ts`, `retainedMonthCloseSchema.test.ts`, and one in `expensesGatingDataSafety.test.ts` that was already stale since MUT-88's v22 bump and had gone uncaught until this ticket's full-suite run.

Full suite (Node 22): 3693/3697 pass (4 pre-existing skips), 262/262 files -- no regressions. `lint` 0 errors (6 pre-existing warnings, none in touched files), `typecheck` clean, `build` clean.

## MUT-160 — The Settings QA specs find Language and Theme as radiogroups (2026-10-14)

| AC | Tests |
|---|---|
| `@web.income.rtl-amount` passes | Already fixed in MUT-103 (`5bd1b09`); passes again in this run |
| No QA spec targets the Language/Theme controls as buttons | `settings.spec.ts` `@web.settings.language` and `@web.settings.theme` now wait for the named `radiogroup`, click `radio`s and assert `aria-checked`. Both failed on main and pass here. `grep` for `getByRole('button'` with العربية/English/Dark/Light/System in `qa/specs` and `qa/support` finds nothing |

Test-only change: no app code, so no unit run. Full `web` suite against the branch (dev server on :5173, `--retries 0`): 42 passed, 3 failed. All 3 fail the same way on main, and this change can't touch them: `@web.brand.type` ×2 (Home loads no IBM Plex Mono face) and `@web.clients.owed-now-parity` (Home's Owed now amount is empty).

## TD-014 (partial) — retainer projections use the local "today" (2026-10-14)

Every case runs at 01:30 on 2026-10-14 in Asia/Jerusalem (`2026-10-13T22:30:00.000Z`, `atInstantIn` from `src/test/atInstantIn.ts`), where the UTC date is a day behind. All six failed on the old UTC helper.

| Path | Test (`src/db/__tests__/retainerRepo.test.ts`) |
|---|---|
| `refreshDueStates` flips a row due today | "refreshes due states: only upcoming rows dated today or earlier become due" (was flaky between 00:00 and 03:00; now deterministic) |
| `end` stamps the local date | "end() stamps the local date as the end date" |
| `generateSchedule` initial state | "a generated row expected today is born due" |
| `generateSchedule` 12-month horizon | "the schedule horizon is twelve months from the local date" |
| `unmatch` restores due | "unmatching the only payment of a row expected today puts it back to due" |
| `list` `daysOverdue` and `getSummary` overdue totals | "a due row expected yesterday is overdue by one day and counts as overdue" |

`paymentRecords.test.ts` now imports the shared `atInstantIn` instead of its own copy. Both files pass with host `TZ` = Asia/Jerusalem, America/New_York, UTC and Pacific/Kiritimati.

Full suite (Node 22): 3751 passed, 4 skipped, 262/262 files. `lint` 0 errors (6 pre-existing warnings, none in touched files), `typecheck` clean, `build` clean.

## TD-120 — a retainer's schedule gets every month and quarter (2026-10-14)

`src/db/__tests__/retainerRepo.test.ts` › `scheduleGenerator` › `generateSchedule` › "every month and quarter gets a row (TD-120)". Each case runs at a fixed instant with `atInstantIn`, so the 12-month horizon is fixed and the full list of period starts can be asserted. All four failed on the old `Date` cursor.

| Case | Instant / zone | Asserts |
|---|---|---|
| Monthly, starts 2026-01-31, pays on the 31st | 2026-01-20, Asia/Jerusalem | 13 consecutive months Jan 2026 – Jan 2027; February ends and is paid 2026-02-28; April paid 2026-04-30 |
| Monthly, starts 2028-01-31 (leap year) | 2028-01-20, Asia/Jerusalem | 13 consecutive months; February ends and is paid 2028-02-29 |
| Quarterly, starts 2026-03-31, pays on the 31st | 2026-03-20, Asia/Jerusalem | Q1 2026 – Q1 2027, five rows, each paid on the last day of the quarter's last month (Jun 30, Sep 30, …) |
| Monthly, starts 2026-01-01 | 2026-01-10, America/New_York | 13 consecutive months, first paid 2026-01-15 |

`retainerRepo.test.ts` (39) passes with host `TZ` = Asia/Jerusalem, America/New_York, UTC, Pacific/Kiritimati and Pacific/Honolulu. Related suites (RetainerDrawer, useRetainerQueries, gating/reconcile/probes, provider, migration-safety): 55/55. Full suite not run at the user's request; `lint` 0 errors (6 pre-existing warnings, none in touched files), `typecheck` clean, `openapi:check` up to date.

## MUT-133 — portal income writes on a personal profile (2026-10-14)

| Suite | Cases |
|---|---|
| `src/hosted/format/__tests__/format.test.tsx` › todayInZone | zone ahead of UTC, behind UTC, exact local midnight, unknown zone → browser calendar |
| `src/hosted/data/__tests__/attemptKey.test.ts` | same body → same key; changed body → new key; after success → new key; stable across renders |
| `src/hosted/data/__tests__/incomeAffordances.test.ts` | personal → both kinds + settle; **Malafat-fed (received: true) → nothing**; writer-null non-personal → nothing; capture vs payments access; rules without Owed; `isSettleable` origin × status |
| `src/hosted/data/__tests__/filters.test.ts` | `newIncome` received/owed only; `settle` uuid only; page parsers; `splitIncomeDrawer` keeps drawer state out of filters |
| `src/hosted/components/__tests__/incomeForm.test.ts` | lenient amounts (commas, ₪, Arabic-Indic, JOD 3 decimals) → canonical; currency mismatch; invalid/zero/negative/blank; schema (Owed needs client, Received rules, future date); request builder isolates kind fields; live line |
| `src/hosted/components/__tests__/incomeApiErrors.test.ts` | every reason → field or toast; READ_ONLY_PROFILE uses the §7.4 sentence; settle race → inline + re-read; NOT_FOUND / RECEIVABLE_NOT_OPEN / VERSION_MISMATCH → toast + re-read |
| `src/hosted/components/__tests__/Toast.test.tsx` | empty polite region exists with no status role; info fills it; message-only keeps the alert |
| `src/hosted/components/__tests__/IncomeCaptureDrawer.test.tsx` | Owed POST with profile header, key and canonical body + Saved status; Owed needs client; Received with method, no Owed fields; defaults summary and auto-open on server DATE_INVALID; profile-zone date cap; retry reuses key, edit mints new; double-click → one POST; kinds follow rules; currency mismatch; Arabic |
| `src/hosted/components/__tests__/RecordPaymentDrawer.test.tsx` | skeleton + disabled Save then title with what's left and context line; full settle sends amount + zone date; partial line + body; over blocks Save; race → new figure + re-read; inline race error; PAID / 404 → nothing left; 500 → unreachable; 409 → toast + re-read; Method radiogroup |
| `src/hosted/pages/__tests__/views.test.tsx` › MUT-133 | personal: no notice, Add, Record payment only on open ADJUSTMENT rows, sticky Actions column; opening/closing the drawer doesn't refetch the list; full settle → row gone, status, focus on next row's button; partial → Partly paid, focus kept; Add Owed → list re-reads, status; Payments defaults to Received + empty-state action; Client detail prefill + tab settle. **Regression**: Malafat-fed and writer-null non-personal → no button, no column, deep links inert, Malafat notice unchanged |
| `ExpenseDrawer.test.tsx`, `ConversionDrawer.test.tsx` (D5) | retry after a network failure resends the same key; default date in the profile's zone |
| Review fixes (qa-reconcile) | race re-read with a **new version** keeps the typed amount, the inline error and the Save block; an untouched full payment keeps the sent amount after a race; empty Paid on → "Choose a date"; collapsed More details reopens on a hidden error; pending Save is `aria-disabled` and still sends one POST; after Add from the empty state focus is on the header Add button; an identical second info toast re-renders; row button names the client |

Run: `npx vitest run src/hosted src/components/ui/__tests__` — 55 files / 704 tests green after the review fixes. Full suite not run at the user's request; `lint`, `typecheck` and `openapi:check` run.

## MUT-186 — /hosted offer page and request form (2026-10-14)

| Suite | Cases |
|---|---|
| `src/pages/landing/__tests__/hostedRequest.test.ts` | validate: required name/email, whitespace-only, 5 bad emails, trimmed email; encode: form-name + exact field order, trimming, joined devices, language (D4), honeypot as typed, profession code; submit: POST url-encoded to `/__forms.html`, 500 → error, thrown → error, **15 s timeout aborts → error (D5)** |
| `src/pages/landing/__tests__/HostedOfferPage.test.tsx` | structure (4 parts in landing chrome), hero names the trade (3A), CTA → `#request`, no-price line, mock aria-hidden with equal balances (5A), tab title; comparison headers and 7 row headers (1A), "Not included" for screen readers, Android coming soon on/off, **no store anchors even with URLs (9A)**; honesty EN/AR (no checkout, price, reports, backup, automatic, sync, sign-up, profiles); form: required vs optional, LTR email/phone in Arabic, hidden honeypot, notice + /privacy (D3), empty submit → errors + focus, email-only focus, error clears on edit, Sending… disabled + one POST, full Arabic body incl. language, success with name/email/2-day promise/focus/free-app link (2A/4A), edit-and-resend keeps answers, failure keeps answers + retry; Arabic RTL with no raw keys |
| `src/pages/landing/__tests__/hostedOfferKeys.test.ts` | `landing.hostedOffer` EN/AR key parity, non-empty, matching placeholders; privacy section in both; 2-working-day promise in lead and success |
| `src/pages/landing/__tests__/PrivacyPolicyPage.test.tsx` | the request-form section names Netlify, its purpose and the contact address |
| `scripts/__tests__/vite-config.test.ts` | twin declares form/netlify/honeypot/hidden; names exactly the posted fields; noindex (D2); emitted as `__forms.html`; web only; out of the SW precache (D2); dev route `/hosted` → `/index.html` (query kept), `/hosted.html` and `/app/hosted` untouched, web only |
| `qa/specs/web/landing.spec.ts` | `@web.landing.hosted`: landing chrome, axe light + dark, empty → errors + focus, 500 → alert in view beside Try again, retry → focused confirmation with the email, body has form-name + language; `@web.landing.hosted-375`: Arabic at 375 fits, laptop hidden, phone shown, thead hidden, full-width row headers, pills ≥ 44px |

| /qa-reconcile fixes | contract: `bot-field` carries no autofill meaning; `request-id` encoded; limits 200/254/40/4000 at the boundary; error codes `required` / `invalid` / `tooLong`. Page: honeypot inside `[hidden]`; `maxLength` on every field; over-long → "Keep this under N characters."; language switched after load → sent as `ar`; a form submit while sending → one POST; retry and edit-resend reuse one `request-id`. `marketingPath.test.ts`: trailing slash dropped once, `/` kept. Privacy: Akismet, IP address, 12 months; Netlify in Sharing; the form named in Scope and Network. `vite-config.test.ts`: the `/hosted` card (og:url `/hosted`, Arabic hero), `withPageMeta` swaps the tags and title, escapes them and keeps the scripts, the plugin emits `hosted-offer.html` (web only), and `netlify.toml` serves it ahead of `/*`, outside the precache. QA `@web.landing.hosted-slash` |

Run: `npx vitest run src/pages/landing scripts/__tests__/vite-config.test.ts`; QA on a dev or preview server with `QA_CONTEXT` pointing `web` at it. **Not testable locally:** Netlify registering the form and emailing it (INFRA §1, post-deploy check).

## MUT-182 — profile management API (2026-10-14)

| Suite | Cases |
|---|---|
| `server/src/repositories/__tests__/store-contract-profiles.ts` (memory + Postgres) | MUT-120 profile owned + PERSONAL at v1; firms unowned; createOwned + membership; cap counts personal, refuses past it writing nothing; granted firm not counted; **C4** two concurrent creates at cap−1 → one created (PG); **C10** type change racing the first seed → one preset (PG, D3); updateOwned versioned, stale; not_found for another owner and a firm; type change uncategorizes live + deleted expenses (version bump), deletes custom + archived categories, seeds preset; same type keeps categories; name + type one bump (D4); stale changes nothing; built-in personal can't become BUSINESS (D2); expense with missing category → FK |
| `server/src/repositories/__tests__/migration-mut182.test.ts` (PG) | backfill: personal → owned + PERSONAL, firm untouched; both CHECKs fire; rest of history ends at the schema (`migrate diff --exit-code`) |
| `server/src/__tests__/routes-profiles.test.ts` | R1 shape + ownership; R2 replay / key reuse / missing key; R3 seven invalid bodies; R4 audit; R5 cap 409 PROFILE_LIMIT (firm member); device session creates; R6/R7 rename + currency, project keeps its currency; R8 stale/garbage If-Match; empty body; R9 type change: preset in Arabic, expense uncategorized, audit rows; R16 name + type together; R11 404 stranger/unknown, 403 NOT_OWNER on a firm; R15 personal: 409 retype, rename OK; R10 preview == result, same type zeros, 404/422; R13 `/v1/me` owned/type/version/order/limits; R14 owned BUSINESS takes customer, project, received, owed, settle, expense |
| `server/src/__tests__/routes-owned-profiles-standalone.test.ts` | BUSINESS and extra PERSONAL: no API key (S1), planted key refused at bind and on a ledger route (S2/S3), no grant to another user (S4), not a provisioning target (S5), owner's membership not revocable (S5); built-in profile still PERSONAL_PROFILE |
| `server/src/__tests__/routes-expenses.test.ts` › R17 | category deleted between check and write → 422 CATEGORY_NOT_FOUND on create and PATCH |
| `server/src/scripts/__tests__/post-roll.test.ts` (PG) | backfilled personal profile owned + PERSONAL; settings taken from an operator firm, never an owned profile |
| `server/src/expenses/__tests__/presets.test.ts` | selector by type: PERSONAL → personal, BUSINESS / null → general, Malafat wins |
| `src/hosted/data/__tests__/incomeAffordances.test.ts`, `src/hosted/pages/__tests__/views.test.tsx` | created BUSINESS profile → both kinds + settle, no lock notice, Add income; writer-null firm (not owned) → nothing |

Run: `npm --prefix server test` (88 files / 1697 tests), `MUTABA3A_TEST_DATABASE_URL=… npx vitest run` on a fresh migrated DB for the Postgres suites, `npx vitest run src/hosted` (30 files / 286 tests). Regression contract: MUT-120's existing tests (routes-users, routes, routes-sessions, store-contract-users) pass unchanged.

### MUT-182 qa-reconcile additions (2026-10-14)
| Suite | Cases |
|---|---|
| `store-contract-profiles.ts` | create writes `organization.created` + `membership.granted` as the person; type change records `removedCategories` + `uncategorized` pairs, `organization.updated` fields, SYSTEM seed; stale writes no audit; D2 refusal leaves categories, expense and audit untouched; **C11** category create racing a retype (PG); **C12** expense moving between categories racing a retype (PG, 5 rounds) |
| `routes-owned-profiles-standalone.test.ts` | an unstamped personal profile is still refused a key and a grant (PERSONAL_PROFILE) and still counts — proven red on the old single-column guard |
| `routes-profiles.test.ts` | `/me` order = membership order; unstamped personal shows owned + PERSONAL and its rename stamps it; its first category list seeds the personal preset (proven red on the old line); preview refuses the built-in profile (409) and a firm (403 NOT_OWNER) |
| `inbox-filing.test.ts` | filing whose category a type change deleted → 422 CATEGORY_NOT_FOUND, entry kept, no expense |
| `post-roll.test.ts` | `repairPersonalOwnership` stamps an unstamped personal profile, idempotent; `updateOwned` stamps it too |
| `migration-mut182.test.ts` | an old-shape personal insert after the migration is accepted and stays unstamped |

Run: targeted suites only (owner's request) — 23 files / 984 tests, then 12 files / 358 tests after cycle 2, on a freshly migrated `mutaba3a_test_mut182`; portal 30 files / 286.

## MUT-194 — edit and delete a logged currency conversion (2026-10-14, ADR-075)

| Suite | Cases |
|---|---|
| `server/src/repositories/__tests__/store-contract-conversions.ts` (memory + Postgres) | new row at version 1, updatedAt = createdAt, not deleted; update at the expected version bumps it and stamps updatedAt, absent keys unchanged, stale returns the current record; not_found for unknown id, other org, deleted row; softDelete changed → unchanged → null (unknown id, other org); get and list hide deleted rows |
| `server/src/repositories/__tests__/migration-mut194.test.ts` (Postgres) | pre-migration rows get version 1, updatedAt = createdAt, deletedAt null; the history ends at the schema (`migrate diff --exit-code`) |
| `server/src/conversions/__tests__/compose.test.ts` › conversionPatch | only sent fields; `notes:null` clears; currency/toCurrency without its amount → AMOUNT_REQUIRED on that field (G1); amount-only on a JOD leg uses 3 digits (G1); amount re-parsed in a new currency; merged same-currency and lone `toCurrency` collision → SAME_CURRENCY; leg swap accepted; bad date / zero amount |
| `server/src/__tests__/routes-conversions.test.ts` | PATCH 200 version+1 with audit `{fields, version}`; device session; stale If-Match → 409 + currentVersion, nothing changed; missing If-Match → 422; AMOUNT_REQUIRED ×2, SAME_CURRENCY, AMOUNT_INVALID, future date → 422; notes-only edit of a 2020 row OK; 404 unknown / other profile / after DELETE. DELETE 204 + 204, audited once, gone from get/list, anchor → 404 ANCHOR_NOT_FOUND; device session; 404 unknown / other profile (G2). Summaries byte-identical after an edit and a delete. API-key sweep covers PATCH and DELETE; full shape includes version/updatedAt |
| `server/src/__tests__/route-security.test.ts` | `CONVERSION_OPERATIONS` includes PATCH and DELETE |
| `server/src/__tests__/conversions-invisible.test.ts` | after create, update and delete, Malafat's `/v1/audit` lists none, also by `entityType`, `entityId` and `action`; the store recorded all three |
| `src/hosted/components/__tests__/HostedTable.test.tsx` | row button in the first cell, Tab-reachable, `.press`; Enter and Space fire once each; mouse click fires once (no double fire); rows unchanged with no role/tabindex; no button without `onRowClick`; `.row-link` CSS has the focus ring |
| `src/hosted/components/__tests__/conversionFormSchema.test.ts` | JOD on either leg; JOD 3 decimals valid, 4 invalid; USD 3 decimals invalid beside a JOD leg; JOD→JOD refused; implied rate across JOD |
| `src/hosted/components/__tests__/ConversionDrawer.test.tsx` › edit mode | prefill + edit title; Save/Delete hidden while loading; load error → Unreachable; PATCH both legs at the loaded version, `notes:null`; 409 → toast, stays open, refetch, refill, next Save at the new version (D6); Delete confirm names both legs (D7) then DELETE + `onDeleted`; cancelled confirm sends nothing; JOD edit; Arabic title and confirm (AC9) |
| `src/hosted/pages/__tests__/ConversionsList.test.tsx` | row click and Enter on the row button open `?conversion=`; close clears it; deleting the anchored conversion drops `anchor`; the currency filter offers JOD |
| `src/hosted/data/__tests__/filters.test.ts` | `?conversion=` uuid kept, malformed dropped; `newConversion` kept; JOD kept, unknown currency dropped |
| Regression | `ExpensesList.test.tsx` row-click test unchanged and green |

Run so far: server `typecheck`, `lint`, `openapi:check`, `npm test` (86 files, 1675 passed, 21 skipped) and `test:db` against a scratch Postgres database (107 files, 1819 passed); `npx vitest run src/hosted` (31 files, 311 passed). The root `lint`/`typecheck`/`test:run`/`build`/`hosted:types:check` set was not run on the final tree in this pass.

## MUT-187 — "Go hosted" in the free web app (2026-10-14, ADR-076)

| Suite | Cases |
|---|---|
| `src/lib/__tests__/goHosted.test.ts` | due when never dismissed; hidden at 0 and at 30 d minus 1 h; due at exactly 30 d and later; future → due; storage round-trip; 5 garbage values → never dismissed; read and write survive a throwing storage; `goHostedEnabled()` off when undefined/desktop, on for web; `hostedPortalUrl()` "" or the stubbed URL |
| `src/components/layout/__tests__/GoHostedCard.test.tsx` | EN and AR: group label, text, Go hosted → `/hosted`, `_blank`, `noopener noreferrer`, sr-only new-tab text, × named and titled "Hide for 30 days"; Tab reaches link then ×, Enter dismisses and calls `onDismissed`; dismissal stored, hidden at 29 d, back at 30 d (fake Date); blocked storage still hides for the tab; hidden while a sample is `preparing` or `active`; no fetch, XHR or sendBeacon across show/click/dismiss |
| `src/components/layout/__tests__/SidebarNav.goHosted.test.tsx` | web: card after Home/Clients/Income and before Settings; desktop: none; collapsed: none; dismiss focuses Settings |
| `src/pages/settings/__tests__/HostedAccountEntry.test.tsx` | EN and AR: title, sentence, prompt, "See hosted accounts" → `/hosted` and "Sign in" → portal URL, both new tab; no sign-in line when the build set no portal URL |
| `src/pages/settings/__tests__/SettingsPage.goHosted.test.tsx` | web: the row is inside the Businesses section; desktop: no row |
| `scripts/__tests__/vite-config.test.ts` | web define = default portal URL, desktop ""; default is a run.app origin; override with trailing slash dropped; 5 bad values throw naming `MUTABA3A_PORTAL_URL`; web/desktop snapshots updated for the new define |
| Browser check (dev server, 2026-10-14) | 1440×800: card 111 px, nav 388 px; 1440×700: card shown, nav 288 px; 1440×640: card `display: none`; × 44×44; Arabic RTL with × at the inline end; dismiss stores the timestamp, focuses Settings, no network entries; Settings row in Arabic with `/hosted` and the run.app sign-in link, both `_blank` |

Run: `npx vitest run src/lib/__tests__/goHosted.test.ts src/components/layout src/pages/settings scripts/__tests__/vite-config.test.ts`; `npm run test:bundles` for the origin allowlist.

## MUT-183 — Hosted portal: profile management, new/rename/currency/type (2026-10-14, ADR-037 amendment)

| Suite | Cases |
|---|---|
| `src/hosted/data/__tests__/profileRules.test.ts` | RU1 `canCreateProfile` false at cap (fixture max 3, so a hard-coded 6 fails), true below; RU2 `profileEditability` per kind (Malafat/firm/owned/built-in `typeLocked`); RU3 `profileKindKey` for all five kinds; RU4 `changedFields` diff-only, empty when nothing changed |
| `src/hosted/format/__tests__/timezones.test.ts` | browser zone prefilled; a zone missing from `supportedValuesOf` still offered; falls back to `[zone]` with no `supportedValuesOf` |
| `src/hosted/components/__tests__/profileFormSchema.test.ts` | FS1 name trimmed/empty rejected/81 chars rejected, currency+type enums enforced; FS2 (R5) missing type → "Choose Personal or Business" |
| `src/hosted/components/__tests__/profileApiErrors.test.ts` | ER1–ER8 one per error-mapping row; AR1 (R3) `apiErrorReason` string/undefined cases, and the pre-existing expense/income/conversion mapper suites pass unmodified |
| `src/hosted/components/__tests__/ProfileCreateDrawer.test.tsx` | CR1 opens over the page, URL unchanged; CR2/CR2b timezone prefill + fact row + Change reveal + 422 auto-reveal; CR3/CR3b create → lands on new profile, `/v1/me` refetched in background, a replayed 201 doesn't duplicate; CR4/CR4b/CR5 Idempotency-Key same on retry, new after an edited body or after success; CR6/CR7 409 PROFILE_LIMIT cap banner, deep state at cap opens disabled; CR8 (R5) type starts unselected; CR9 double-click sends one POST |
| `src/hosted/components/__tests__/ProfilesManageDrawer.test.tsx` | MG1 lists in `me` order; MG2 Malafat/firm rows not buttons, show reason; MG3 rename PATCHes `{name}` with `If-Match`; MG4 a version bump mid-edit still sends the opened version, 409 shows conflict + Reload; MG5 built-in profile has no type control; MG6 `dir="rtl"` + Arabic strings; MG7 403 NOT_OWNER refetches `me`, pane returns to a now-read-only row |
| `src/hosted/components/__tests__/ProfilesManageDrawer.test.tsx` (type change, inline, part of the same suite as MG1–MG7) | TC1 Save GETs the preview, renders the count; TC2 Back sends no PATCH; TC3 Confirm sends one PATCH; TC4/TC4b categories refetched, banner text from the response count, "Open Expenses" closes the drawer; TC5 zero-count copy; TC6 preview failure shows no confirm; TC7 focus to the confirm heading, Back returns it to Save |
| `src/hosted/session/__tests__/auth-states.test.tsx` (edited in place, EM1/EM1b/EM2) | empty state keeps "no Sections nav" + "Sign out offered", changes the copy, adds "+ New profile" opening the create drawer; `/capture` with no profiles unchanged otherwise; the no-profiles-left fallback keeps its copy and button |
| `src/hosted/data/__tests__/filters.test.ts` (RT3 + router merge fix) | `omitShellOverlay` drops the three shell keys, keeps every other; `pickShellOverlay` keeps only the shell keys; a page search rewrite carries an open drawer forward (qa-reconcile regression test for `useReplaceSearch`) |
| `src/hosted/pages/__tests__/views.test.tsx` (Profile switcher block, RT1/RT2/RT4/RT5) | SW1–SW4 switcher entries and sub-lines; RT1 route-inventory snapshot unchanged (no `/profiles/new`); RT2 (critical) opening "+ New profile" on `/receivables` or `/payments` fires no second list GET and keeps the unfiltered empty state; RT4 Back closes the drawer, a deep link opens it over an empty state; RT5 an `editProfile` id that isn't in `me` or isn't owned renders the list, never an edit form |

Run: `npx vitest run src/hosted` — 304 files, 4312 passed, 4 skipped (post qa-reconcile fix). Root gate (`lint`, `typecheck`, `test:run`, `build`, `build:hosted`) all green. **Gap (plan §5, not built):** no `qa/` catalog entry yet for the new profile-management surface — see TECH_DEBT.

## MUT-188 — portal sign-in links out to /hosted (2026-10-14)

| Suite | Cases |
|---|---|
| `scripts/__tests__/vite-config.test.ts` → "portal request link (MUT-188)" | hosted define = `DEFAULT_PUBLIC_ORIGIN + /hosted`; web and desktop define none; default pinned to a `.netlify.app` origin until MUT-112; override trims a trailing slash; `http://`, bare host, empty, `https://` and a path all throw naming `MUTABA3A_PUBLIC_ORIGIN`; the `/hosted` link-preview test reads the default instead of a literal |
| `src/hosted/session/__tests__/auth-states.test.tsx` → S3b | EN: link "Request one" with the stubbed href, no `target`, the only link, "No account?" present, `BANNED` absent; AR: "اطلب حسابًا" / "ليس لديك حساب؟", `dir="rtl"`. S3's zero-links case is untouched (no global in Vitest) |
| `scripts/__tests__/brand-head.test.ts` | `hosted.html` keeps `<meta name="referrer" content="same-origin">` |
| `src/hosted/i18n/__tests__/parity.test.ts` | covers `hosted.auth.request.*` automatically |
| `npm run test:bundles` | `dist-hosted` references only allowlisted origins (Netlify added) and no forbidden phrase; `dist-web` still carries the OAuth client id host |
| QA `qa/specs/portal/signin.spec.ts` `@portal.signin.request-link` | EN and AR on the hosted dev/preview build: link visible, href matches `^https://[^/]+/hosted$`, no `target`, lead text visible, exactly one link, axe clean |

Run: `npx vitest run scripts/__tests__/vite-config.test.ts src/hosted/session/__tests__/auth-states.test.tsx scripts/__tests__/brand-head.test.ts src/hosted/i18n`; `npm run test:bundles`.

## MUT-172 — landing free vs. paid split (2026-10-14)

| Suite | Cases |
|---|---|
| `src/pages/landing/__tests__/LandingPage.test.tsx` → "Get it, free vs paid" | EN: `get-it-paid` says "Unlike the apps above" and "paid plan", its only link is "See hosted accounts" → `/hosted` with no `target`, and the block matches no banned word (price, /month, checkout, sign up, $, android, ios); the free line "Free during early access" is still in `get-it` and "stay free" never appears; AR: "خطة مدفوعة", link "اطّلع على الحسابات المستضافة" → `/hosted`, no سعر/اشترك/إنشاء حساب. The seven-part structure test and the earlier Get it cases are untouched |
| `src/pages/landing/__tests__/landingCopy.test.ts`, `landingCss.test.ts` | unchanged; parity covers `landing.getIt.paid.*`; the CSS contract bans literal scale/opacity (the CTA uses tokens) |
| `release-qa lint` | 0 errors with `qa/features/web/landing.yaml` (13 features) |
| QA `qa/specs/web/landing.spec.ts` `@web.landing.get-it-paid` | EN and AR on a built web preview: lead visible, one link, height ≥ 44 px, press scale 0.96, hover keeps colour and no underline, click → `/hosted` with `#hosted-title` visible |

Run: `npx vitest run src/pages/landing`; `release-qa lint`.

### MUT-190 — Malafat suggestions in the web app (2026-10-14)
| File | Type | Covers |
|------|------|--------|
| `src/lib/__tests__/malafatSuggestions.test.ts` | Unit | resolve (missing → on; junk dropped; deduped); dismiss (switch kept; business-profile retires second-business); `pickClientsMoment` (9/10 boundary, C2 over C3, dismissed skipped, off); `showBusinessAddedNote`; `shouldMarkBusinessAdded` (first business, sample, demo); `malafatSuggestionsEnabled` web/desktop/undefined |
| `src/lib/__tests__/useMalafatSuggestions.test.tsx` | Hook | null until loaded; dismiss keeps the switch and the switch keeps dismissals (nested replace); a moment recorded once; other settings untouched |
| `src/lib/__tests__/malafatMomentStore.test.ts` | Unit | business-added flag; slot counting with idempotent release |
| `src/components/malafat/__tests__/MalafatSuggestionCard.test.tsx` | Component | labelled group, new-tab link, named dismiss; holds/releases the slot; hides at once on dismiss and on link click, retires, hands focus |
| `src/pages/clients/__tests__/MalafatClientsSuggestion.test.tsx` | Component | C2 at ten clients of the working business only, tags; C3 for a second business; nothing while loading, without a working business, off, sample, demo; AR |
| `src/pages/settings/__tests__/MalafatEntry.test.tsx` | Component | one link tagged settings; row stays when off; switch writes; the business-added note replaces the line with one link tagged business-profile; dismiss retires, clears and focuses the row link; no note for one business / off / dismissed; AR |
| `src/components/layout/__tests__/GoHostedCard.test.tsx` | Component | + steps aside while a Malafat suggestion holds the slot |
| `qa/specs/web/settings.spec.ts` | E2E | `@web.settings.malafat`: row link tags; second business → note (business-profile) and Go hosted card hidden; dismiss → row back, link focused, gone after reload; switch off persists, row stays |
| `qa/specs/web/clients.spec.ts` | E2E | `@web.clients.malafat`: two businesses + a client → one card (second-business tags), hidden while searching, dismiss → search focused, gone after reload |

### MUT-191 — Malafat suggestions in the hosted portal (2026-10-15)
| File | Type | Covers |
|------|------|--------|
| `server/src/__tests__/routes-sessions.test.ts` | Integration | `/v1/me` resolves `malafatSuggestions`; PATCH sets `off`, unions dismissals, rejects an empty, unknown, duplicate or oversized body (422), works with a device session, refuses an API key, leaves other users untouched; version pin 1.25.0-mut191 |
| `server/src/__tests__/store-contract-users.ts` (memory + Postgres) | Contract | `updateMalafatSuggestions` unions, keeps `off` when absent, stamps `updatedAt` |
| `server/src/__tests__/route-security.test.ts` | Integration | the route is session, identity and device-identity scoped |
| `src/hosted/data/__tests__/malafatSuggestions.test.ts` | Unit | eligibility (owned business only; firms, personal and Malafat-fed never), Malafat customer, business count, `retireChange`, the hook's PATCH and `ME_KEY` write |
| `src/hosted/components/__tests__/MalafatPortal.test.tsx` | Component | menu items (link href, switch PATCH, nothing on personal or for Malafat customers); Clients card C2 at 10 active (archived not counted), C3 at two businesses, hidden while searching, suppressed while C1 is due, dismiss → PATCH + `onGone` + nothing more this visit, Arabic; created note on the marked profile only, not when dismissed, survives StrictMode and is gone after leaving |
| `src/hosted/shell/__tests__/UserMenu.malafat.test.tsx`, `components/__tests__/ProfileCreateDrawer.test.tsx` (CR3c/CR3d), `session/__tests__/endSession.test.ts` | Integration | through the real router: menu order and in-place toggle; a new Business profile lands with the note, a Personal one without; sign-out resets the moment store |
| `qa/specs/portal/malafat.spec.ts` | E2E | `@portal.malafat.menu` (axe on the menu), `@portal.malafat.clients` (EN two offices + search + dismiss + reload, axe on the card; AR ten clients RTL), `@portal.malafat.created`, `@portal.malafat.none` |

### MUT-209 — Arabic by default in the web app and the portal (2026-10-15)
| File | Type | Covers |
|------|------|--------|
| `src/lib/i18n/__tests__/core.test.tsx` | Unit | `DEFAULT_LANGUAGE` is `ar` |
| `src/hosted/i18n/__tests__/HostedLanguageProvider.test.tsx` | Component | Arabic in an `en-US` browser with nothing stored, nothing stored; adopting the account's `en`; a stored choice beats the account; an explicit switch persists, the default never does |
| `server/src/__tests__/routes-users.test.ts`, `routes-sessions.test.ts`, `scripts/__tests__/users-cli.test.ts` | Integration | a user created without `locale` is `ar` with a personal profile named شخصي; `--locale en` still honoured; `/v1/me` reports `ar`; API version pins 1.24.0-mut209 |
| `qa/specs/web/settings.spec.ts` | E2E | `@web.settings.arabic-default`: `en-US` browser, nothing chosen → `/app` Arabic RTL with the Arabic welcome; English chosen in Settings sticks after reload |
| `qa/specs/web/landing.spec.ts` | E2E | `@web.landing.arabic-default` now asserts `/app` opens in Arabic and stores nothing |
| `qa/specs/portal/signin.spec.ts` | E2E | `@portal.signin.arabic-default`: `en-US` browser, nothing chosen → Arabic sign-in, nothing stored |
| `qa/support/app.ts` | QA helper | `openFreshApp` chooses English once (only when no choice exists), so English specs keep their labels and `switchToArabic` still wins |


### Settings at 375 px — Hosted account row fits its column (2026-10-15, MUT-187 follow-up)
| File | Type | Covers |
|------|------|--------|
| `src/pages/settings/__tests__/HostedAccountEntry.css.test.ts` | Unit (stylesheet) | the row is `position: relative` with a `minmax(0, 1fr)` track; its button wraps (`white-space: normal`, `block-size: auto`, `min-block-size: var(--space-8)`, `max-inline-size: 100%`); no physical properties in the file |
| `qa/specs/web/brand.spec.ts` | E2E | `@web.brand.layout` (now maps `HostedAccountEntry.tsx/.css`): Settings fits 375 px in light/dark × English/Arabic |

### MUT-206 — the bloom loader (2026-10-15, ADR-079)
| File | Type | Covers |
|------|------|--------|
| `src/components/brand/__tests__/bloomLoaderData.test.ts` | Unit (parity) | duration and box from the Lottie file; layer order; per piece `keyTimes` = t/270, every keyframe path = the Lottie bezier (absolute control points), `keySplines` = the easing handles; seamless loop; dark file moves like light; one turn about (50, 50) with the rotation keys; each class's token hex = the JSON fill, light and dark |
| `src/components/brand/__tests__/BrandLoader.test.tsx` | Component | empty status with the same footprint for 400 ms, then "Loading"/"جارٍ التحميل" as text (no aria-label); fresh SVG on show; `delay={0}` shows at once without the fade; the fade after a delay; reduced motion: no animate children, `d` = frame 0, the word shown once; 4 animate + 1 animateTransform at 4.5 s; slow caption at 3 s with the SVG unchanged; chained waits (50 ms chains, 150 ms waits, a placeholder doesn't chain); no timer left on unmount; no `style` attribute; old spinner selectors and keyframes gone from every stylesheet |
| `src/styles/__tests__/brand.test.ts` | Unit (stylesheet) | `--mark-*` equal the token hexes in all four theme states; `--duration-fade` 150 ms, 0 under reduced motion; `.loading` 50vh centred, `.loading--section` top-aligned, `.content-enter` on the fade token; drift/harness cover the new `--m-mark-*` |
| `src/lib/i18n/__tests__/loaderKeys.test.ts` | Unit | loader label and slow caption in the app and portal dictionaries; the Import page's keys in Arabic with the same vars; the row plural forms |
| `src/pages/settings/__tests__/ImportDataPage.copy.test.tsx` | Component + static | the idle step in Arabic; no Latin JSX text in the page (file extensions exempt) |
| `ClientsPage.test.tsx`, `ProjectsPage.test.tsx`, `OverviewPage.test.tsx` | Component | the loader's status says Loading (real timers, `findByRole` + text); DR8: a background refetch keeps the rows and shows no loader |
| `src/hosted/session/__tests__/auth-states.test.tsx` | Integration | S1: no status before 400 ms, then "Checking your session" as the status text |
| `qa/specs/web/brand.spec.ts` | E2E | `@web.brand.loader-slow-route`: Insights' code held 2 s, light and dark (empty status, then the bloom named Loading in the theme's dot colour, axe, then the page); reduced motion (still mark + word); 1440×900 English and Arabic (centred in the page column ±1 px, not mirrored) |
| `qa/specs/portal/signin.spec.ts` | E2E | `@portal.signin.boot-slow-session`: `/v1/me` held 3 s → wordmark, then the loader's status "Checking your session", then sign-in, no CSP console error |

### MUT-207 — the boot splash (2026-10-15, ADR-080)
| File | Type | Covers |
|------|------|--------|
| `scripts/__tests__/brand-head.test.ts` | Unit (HTML, node) | both heads link `boot-splash.css`; `#root` holds exactly one hidden `.boot-splash` with the dark `<source>` and the 80 px `<img>`, files present; no `style` attribute or inline `<style>`/`<script>` in the body; `BootSplash`'s first render ≡ the HTML splash; the splash and page backgrounds equal the token canvas in four theme states (OS × `data-theme`), and no other colour is written |
| `scripts/__tests__/check-bundles.test.ts` | Unit | the boot-splash rule: passes absolute and relative (desktop) URLs and `data:` marks; flags an empty `#root`, a missing mark or stylesheet, a URL outside the dist, no `.boot-splash` rule in any linked sheet, no stylesheet |
| `scripts/__tests__/vite-config.test.ts` | Unit | the /hosted copy of index.html keeps the splash and its stylesheet |
| `src/components/brand/__tests__/BootSplash.test.tsx` | Component | `bootDelayMs` (0→400, 100→300, 400→0, 2500→0, default reads the clock); the hidden still mark, then the loader in place with no fade and no aria-hidden; blooms on first render on a slow load; no slow caption; Arabic |
| `src/hosted/pages/auth/__tests__/BootScreens.test.tsx` | Component + integration | the mark (decorative, 80, `.boot-splash`, not under aria-hidden), no status, no wordmark; at 400 ms the status "Checking your session" (Arabic too), no fade, same container; slow page load blooms at once; reduced motion: no animation, the words visible; "Still connecting…" at 3 s with the mark in place; DR6 through the real portal: still checking at 14.9 s, BootUnreachable at 15 s, Retry calls `/v1/me` again, no unhandled rejection |
| `src/hosted/session/__tests__/auth-states.test.tsx` | Integration | S1 updated to D4: the mark first, no wordmark text, the status only after 400 ms |
| `src/lib/i18n/__tests__/loaderKeys.test.ts` | Unit | `hosted.auth.connectingSlow` in both languages |
| `qa/specs/web/brand.spec.ts` | E2E | `@web.brand.boot-splash`: scripts off, OS light/dark, `/app/` and `/`: canvas background, the right mark loaded, 80 px, centred ±1 px |
| `qa/specs/portal/signin.spec.ts` | E2E | `@portal.signin.boot-splash`: scripts off light/dark; the hand-off (React's mark or loader keeps the static centre and size ±1 px, then the status); axe on the boot screen light/dark. `@portal.signin.boot-slow-session` (updated): mark first, no wordmark, the bloom in place without a fade, "Still connecting…" at 3 s, sign-in, no CSP error; reduced motion writes the words under a still mark |


## Release-QA catalog covers the whole app; release tags (2026-10-15, ADR-081)

| Where | Kind | What it proves |
|---|---|---|
| `scripts/__tests__/tag-release.test.ts` | Unit (temp git repos) | `tag-release.sh` writes annotated `web-v<x>`/`api-v<x>` on HEAD, is idempotent, never moves a tag, rejects bad args; `--backfill` tags every `release:` commit dated like it, newest first by `creatordate`; `make release web/server` call it (server only after `deploy.sh`); qa config reads `web-v*` / `api-v*` |
| `qa/specs/web/foundation.spec.ts` | E2E (release-qa, **core**) | `.persists`: an unpaid and a paid entry survive a reload (Dexie + repository + UI kit); `.row-actions-duplicate` |
| `qa/specs/web/{expenses,retainers,conversions,projects,reports,insights,planning,data,onboarding,businesses}.spec.ts` | E2E (release-qa) | One test per feature in the matching `qa/features/web/*.yaml`; each optional area is switched on through Settings → Advanced features |
| `qa/specs/portal/{shell,session,ledger,income,expenses,conversions,profiles}.spec.ts` | E2E (release-qa, stubbed `/v1` via `qa/support/portalApi.ts`) | `shell.navigate` and `session.return-to-next` are core; income/expense writes assert POST bodies and Idempotency-Key reuse on retry; 409 handling per drawer |

- Catalog: 146 features in 29 areas (25 core). Mapped: web 92% (31 left, all TD-143), portal 100%.
- `manual: true` until their bugs are fixed (specs already assert the right behaviour): `web.conversions.log`, `.edit-delete`, `web.data.csv-new-client`, `web.planning.export-confidence`, `web.onboarding.demo-summary`, `portal.expenses.edit-conflict`. Unmark each when its fix lands.
- On `vite preview` builds, `web.brand.loader-slow-route` (delays `/src/...`, dev-server only by design), `web.landing.375` (the known 375 px header regression) and `portal.signin.boot-slow-session` fail; `release-qa release` uses dev servers. The other 165 pass with 4 workers.

## Dead web code deleted (2026-10-15, TD-143)

- Removed 7 test files with the code they covered: `CurrencyTabs`, `TypeSegment`, `StepperInput`, `InlineStats`, `useTransactionFilters`, `useTransactionActions`, `lib/aggregations` (`db/aggregations` keeps its own tests). No live behaviour lost coverage.
- Removed `MacDownloadBanner.test.tsx` with the banner (product decision: desktop retired until v2), and its mock in `AppShell.gate.test.tsx`.
- Node 22: lint (0 errors, 6 old warnings), typecheck, `test:run` (317 files, 4,394 passed, 4 skipped) and build all pass.
- `release-qa lint`: the 6 web files left are the two intentional `db/` files and the OAuth client + `tokenStore` (ADR-053 / TD-075).

## MUT-226 — Planning and local Retainers retired; Dexie v24 drops their tables (2026-10-15, ADR-082)

| File | Kind | Tests | What it proves |
|---|---|---|---|
| `src/db/__tests__/migration-v24.test.ts` | Integration (fake IndexedDB) | 8 | A seeded v23 database (plans, assumptions, scenarios, a retainer, projected income, a matched transaction, both switches on) opens at v24 without an error; the five stores are gone on disk and in the schema; `linkedProjectedIncomeId` is stripped and its index dropped; `planning`/`retainers` leave `features` and `featureNotice` while the rest of settings stays; every other row is unchanged; a fresh install has none of the five; a pre-v24 backup restores its other tables and skips the five; the migration-safety snapshot omits them |
| `src/__tests__/noDeadPlanningRetainerModules.test.ts` | Structural | 18 | 14 deleted paths stay gone; no app source names a deleted module (outside `db/database.ts`'s historical versions and `src/hosted`); `FEATURE_KEYS` is exactly expenses, insights, projects, conversions; neither locale carries a retired key |
| `src/__tests__/router.gateKeys.test.ts` (extended) | Structural | +4 | `/planning` and `/retainers` redirect home with every switch on; they render no component and drop a bookmarked search |
| `src/lib/features/__tests__/features.test.ts` (extended) | Unit | +1 | Stored `planning`/`retainers` switches resolve to nothing |
| `src/components/layout/__tests__/SidebarNav.features.test.tsx` (rewritten examples) | Component | +1 | No Planning or Retainers entry even with their stored switches; "More" order is Expenses, Conversions, Insights, Projects |
| `src/pages/clients/__tests__/ClientDetailPage.test.tsx` | Page | 1 (was 2) | No retainers card, even with a stored retainers switch |
| `src/db/__tests__/provider.test.ts` | Unit | 1 (rewritten) | The registry has no plan or retainer slots |
| `src/components/layout/__tests__/FeatureNoticeBanner.test.tsx` (extended, qa-reconcile) | Component | +1 | A notice restored from a pre-v24 backup (`retainers`, `expenses`, `planning`) names only Expenses and never a raw key. It fails when `useFeatureNotice` stops filtering through `FEATURE_KEYS` (mutation-checked) |
| `qa/specs/web/navigation.spec.ts` › `@web.navigation.retired-areas` | E2E (release-qa) | 1 | Bookmarked `/app/planning?plan=p1` and `/app/retainers?status=active` land on Home; the sidebar has no entry; Settings › Features shows exactly four switches |

Re-pointed (same assertions, a live area as the example): `featureDataProbes`, `reconcile`, `routeGuard`, `useFeatures`, `leaveDisabledArea`, `gatingDataSafety`, `settingsRepo`, `migration-safety`, `migration-v20` (the no-settings-row case now seeds a project), `migration-v21` (its kept-table list excludes the five v24 drops), and every `verno` 23 → 24.

Deleted with their code: `planCalculationService.test.ts`, `usePlanQueries.test.tsx`, `retainerRepo.test.ts`, `useRetainerQueries.test.tsx`, `RetainerDrawer.projectField.test.tsx`, the stores' retainer blocks, `qa/specs/web/{planning,retainers}.spec.ts`.

Run (Node 22): `npm run typecheck` clean; `npm run lint` 0 errors (4 warnings, all in untouched files); `npx vitest run`: 314 files, 4,310 passed, 4 skipped; `npm run build` OK; `release-qa lint` no errors, and the same 6 unmapped web files as `main`.

Web QA on `vite preview` builds (throwaway `QA_CONTEXT`, 2 workers): 111 passed and 12 failed. The same 12 also fail on a `main` (a093306) build with `--last-failed`, so none is a regression:
- the Brand loader's three slow-route checks;
- Brand English and Arabic at 1440px;
- Conversions log and edit/delete (`manual: true`, known bugs);
- `web.data.csv-new-client` (`manual: true`);
- the landing bar at 320 and 375px in EN and AR.

`web.navigation.retired-areas` and all 8 `web.brand.layout` cells pass.

## MUT-218 — CSV import duplicates (2026-10-15)

| File | Kind | Tests | What it proves |
|---|---|---|---|
| `src/utils/__tests__/csvValidation.test.ts` › `validateCSVImport (MUT-218)` | Unit | +4 | New client and project rows are New with no warning; names already in the app are still Duplicate; a name repeated in the file is Duplicate on the repeat only (trimmed); an income row referencing a client from the same file stays New. The first and third failed before the fix |
| `qa/specs/web/data.spec.ts` › `@web.data.csv-new-client` | E2E (release-qa) | 1 | No longer manual: a new client reads New, and the summary shows New 2, Duplicates 0, with no duplicate notice. Passes on a `vite preview` build with the other 5 data specs |

## MUT-223 — hosted re-dating: change the date of a saved income entry or payment (2026-10-15, ADR-083)

| Suite | Cases |
|---|---|
| `server/src/repositories/__tests__/store-contract-capture.ts` › re-date (memory + Postgres) | `redateAdjustment`: posting date moves, due date kept, version +1; stale → current row, nothing changed; not_found for another person, an INSTALLMENT receivable, a voided entry. `redateCapture`: receivedOn moves, version +1, updatedAt stamped, number kept; stale; not_found for INTEGRATION, an undone capture, another person; a settle payment moves with its allocations and the receivable byte-for-byte unchanged |
| `server/src/repositories/__tests__/store-contract-m6.ts` (memory + Postgres) | `excludeActions` alone, with `excludeEntityTypes`, and with `action` (asserted sorted, never by position: TODOS #8) |
| `server/src/income/__tests__/compose.test.ts` | `isOwnProfile` (owner, unstamped personal via `personalOwnerUserId`, someone else's, firm); `isOwnCapture` (INTEGRATION, other person, person gone, REVERSED); `redateTo` (org's today ok when UTC is a day behind; the day after and 2026-02-30 → DATE_INVALID naming the field) |
| `server/src/__tests__/income-redate.test.ts` | AC1 Owed 200 + dueDate kept + version in the response; AC2 Received moves receivedOn; D3 settle payment via /v1/income → 409 ALREADY_ALLOCATED; AC3 settle payment via /v1/payments, allocations + receivable unchanged; AC4 stale → 409 + currentVersion, pre-settle version → 409, org-timezone future → 422, malformed / missing If-Match / extra field → 422; AC5 other person, unowned firm, Malafat-fed (404 via income, 403 READ_ONLY_PROFILE via payments, D2), INTEGRATION + INSTALLMENT, voided + undone → 404, nothing changed; AC6 device session 200, API key 403 PRINCIPAL_NOT_ACCEPTED; AC7 audit rows `{from,to,version}`, Malafat's `/v1/audit` hides both actions but lists `payment.recorded`; AC8 payment window filter follows, `lastPaymentOn` and `postingDate` follow |
| `server/src/__tests__/route-security.test.ts` | `INCOME_OPERATIONS` lists both PATCHes (session + device session surfaces, API key refused) |
| Regression | `income-routes`, `receivables-settle`, `routes-m6` audit tests unchanged and green; version pins in routes-m2..m8 moved to 1.26.0-mut223 |

Pre-landing review additions: firm-profile capture → 404 via PATCH /v1/payments (mutation-checked: removing the owner check fails only this test); stale version on the payment branch via both routes, one audit row; PATCH /v1/payments 422s (missing If-Match, future receivedOn). Known gap, no automated guard: the Postgres write-and-re-read race the review closed by wrapping both statements in one `$transaction` (an undo between them used to give a 404 with no audit row) — proven by construction, not reproduced by a test.

Release-QA: server-only; the user-visible scenarios (plan §7) are automated by MUT-224's portal spec. `release-qa lint`: no errors, portal 100% mapped.

Run (Node 22, 2026-10-15): server `typecheck`, `lint`, `openapi:check` clean; `npm test` 90 files, 1806 passed, 23 skipped; `test:db` (Postgres :54329) 1982 passed, 1 failed: `routes-m6` audit listing returned two same-millisecond rows swapped (`payment.reversed` before `payment.recorded`), the known TODOS #8 ordering flake. Re-run alone 3/3 green. Root `lint`, `typecheck`, `test:run` (317 files, 4394 passed, 4 skipped) and `build` clean.

## MUT-164 — Delete all data (2026-10-15, ADR-084)

| File | Kind | Tests | What it proves |
|---|---|---|---|
| `src/db/__tests__/dataset.test.ts` | Integration (fake IndexedDB) | 2 (replaces the five-table test) | With a row in every table of `db.tables`, `wipeAllData` leaves only settings, so a new table can't be missed silently; settings keep currencies, `lastBackupAt` and `malafatSuggestions` while `features` and `featureNotice` are emptied |
| `src/components/modals/__tests__/DeleteAllDataModal.test.tsx` | Component | +2 | After the delete, `invalidateQueries()` is called with no key, the active business is cleared, demo mode is off and the walkthrough is reset; the "kept" line exists in both locales and is shown |
| `qa/specs/web/data.spec.ts` › `@web.data.delete-and-restore` (extended) | E2E (release-qa) | 1 | The dialog says what is kept; after deleting, the welcome comes back (no business left), Income is empty, and the backup restores the entry |

## MUT-221 — Portal expense drawer after a 409 (2026-10-15)

| File | Kind | Tests | What it proves |
|---|---|---|---|
| `src/hosted/components/__tests__/ExpenseDrawer.test.tsx` › `a stale version (MUT-221)` | Component | +2 | On 409 the drawer shows the conflict toast, stays open, refills with the other device's values, and the next Save sends `If-Match: 4` after `3` (it failed before the fix); a background refetch of the same version keeps what was typed |
| `qa/specs/portal/expenses.spec.ts` › `@portal.expenses.edit-conflict` | E2E (release-qa) | 1 | No longer manual; passes on a `vite preview --mode hosted` build with the other 4 portal expense specs |

## MUT-217 — Conversions list refresh (2026-10-15)

| File | Kind | Tests | What it proves |
|---|---|---|---|
| `src/hooks/__tests__/useConversionQueries.test.tsx` (new) | Integration (hooks + fake IndexedDB) | 1 | With the list mounted, a created conversion appears, an update shows its new `toAmountMinor`, and a delete empties the list, all without a remount. It failed before the fix |
| `qa/specs/web/conversions.spec.ts` › `@web.conversions.log`, `@web.conversions.edit-delete` | E2E (release-qa) | 2 | No longer manual; pass with no reload on a `vite preview` build, with the other 2 conversion specs |

## MUT-126 — Amount upper bound (2026-10-15, TD-100)

| File | Kind | Tests | What it proves |
|---|---|---|---|
| `server/src/__tests__/money.test.ts` | Unit | +2 (1 rewritten) | The bound parses, either sign, in USD/ILS and JOD; one minor unit above it, and a 20-digit amount, throw `MoneyParseError` |
| `server/src/__tests__/routes-m3.test.ts` › validates … amounts | Route (memory store) | +1 assertion | An agreement preview with a 20-digit amount is 422 `AMOUNT_INVALID`, `field: 'amount'` |
| `server/src/__tests__/routes-mut100.test.ts` › outcome validation | Route (memory store) | +1 assertion | A 20-digit `awardedAmount` is 422 `AMOUNT_INVALID`, `field: 'awardedAmount'` |

## MUT-130 — Payment lock order and lock conflicts (2026-10-15, TD-104)

| File | Kind | Tests | What it proves |
|---|---|---|---|
| `server/src/repositories/__tests__/store-prisma-lock-order.test.ts` (new, `test:db`) | Integration (Postgres) | 3 | While another connection holds the lower receivable's row lock, a payment create (allocations high→low) and a reversal leave the higher row lockable (`FOR UPDATE NOWAIT`), so they lock in id order; both failed before the fix. A deadlock the write loses rejects with `LockConflict` (not a raw Prisma error) and writes no payment. Allocation rows keep the request order |
| `server/src/__tests__/routes-m4.test.ts` › a write that loses a lock conflict | Route (memory store, `LockConflict` stubbed) | 1 | Record and allocate answer 409 `PREVIEW_STALE`; reverse answers 409 `VERSION_MISMATCH`, and a new request then reverses |

The ticket's "drive a deadlock between an allocation and an outcome write" can no longer be produced: both now lock in id order. The third DB test drives a real deadlock with a raw connection that locks against the order, instead.

## MUT-199 — Canonical idempotency fingerprint (2026-10-15, ADR-085)

| File | Kind | Tests | What it proves |
|---|---|---|---|
| `server/src/__tests__/idempotency-fingerprint.test.ts` (new) | Unit + route (memory store) | 6 | The widget's body and the app's body for one capture fingerprint identically. Nested keys, whitespace and `\u` escapes don't count; a value, array order, method and path do; a non-JSON body counts byte for byte. A replay with reordered keys and `\/` gets the stored 201 with `Idempotent-Replayed` and the same id, while a changed value is 422 `IDEMPOTENCY_KEY_REUSED`. A key stored under the old byte fingerprint still replays |

The phone-side AC ("the row shows saved") follows from the server returning the stored 2xx. It is not exercised end to end from the Flutter app here.

## MUT-178 — QA specs wait for Owed now (2026-10-15)

| File | Kind | Tests | What it proves |
|---|---|---|---|
| `qa/specs/web/clients.spec.ts`, `home.spec.ts`, `brand.spec.ts` (changed) | E2E (release-qa) | 0 new | Owed now is read with waiting assertions; `@web.clients.owed-now-parity`, `@web.home` and both `@web.brand.type` pass 45/45 with `--repeat-each 5 --retries 0` |

Full web suite on 2026-10-15 (after MUT-218/164/217/178): 114 passed, 9 failed, all on the main baseline (5× `loader-slow-route`, 4× `landing.375`). `csv-new-client`, `conversions.log` and `conversions.edit-delete` now pass unattended.

## MUT-224 — hosted portal: change the date of a saved income entry and a recorded payment (2026-10-15, ADR-083 amendment)

| Suite | Cases |
|---|---|
| `src/hosted/data/__tests__/incomeAffordances.test.ts` | `redateAffordancesFor` (owned + capture/payments write; Malafat-fed and unowned: neither); `canRedateOwed` (ADJUSTMENT, open or settled; not VOID, INSTALLMENT, no capture write, unowned); `canRedatePayment` (own POSTED capture incl. allocated; not REVERSED, integration, someone else's, no payments write, Malafat-fed) |
| `src/hosted/data/__tests__/filters.test.ts` | `?income=` / `?payment=` keep a uuid, drop a malformed id, survive page parsers, and split out of list filters |
| `src/hosted/components/__tests__/HostedTable.test.tsx` | `linkColumn` moves the row-link; `canOpen` false gives no link, no `clickable`, no handler; existing row-link tests unchanged |
| `src/hosted/components/__tests__/RedateDrawer.test.tsx` | Owed: read-only summary, `max` = profile today, "Due … stays as it is"; save → PATCH /v1/income with If-Match 3 and `{occurredOn}`; unchanged date closes with no request; 409 → re-read, refill, conflict toast, next save If-Match 4; 422 inline; 404 gone; no payments request for an unpaid entry; settled entry lists only its payment lines (one opens `?payment=`); incomplete page → See payments. Payment: PATCH /v1/payments with `{receivedOn}` and If-Match. Arabic labels. Review fixes: a background re-read keeps a typed date and saves at the new version, refills an untouched one; a save answering after unmount doesn't close; an INSTALLMENT entry, a REVERSED payment and someone else's capture show "no longer available" with no Save; a 404 on save says so |
| `src/hosted/components/__tests__/RecordPaymentDrawer.test.tsx` | the reworded note |
| `src/hosted/pages/__tests__/views.test.tsx` › MUT-224 | Receivables Date column; Record payment opens only `?settle=`; Enter on the row-link opens `?income=`; Payments: own capture links from Received (3rd cell), expander doesn't open, REVERSED row inert; Malafat-fed: no row-link, deep links render nothing |
| Release-QA (portal, preview build) | `portal.income.redate-owed`, `-received`, `-payment`, `-no-future`, `-conflict`, `-malafat-readonly`, `portal.expenses.redate-expense` |

## MUT-220 — Demo mode summary and active business (2026-10-15)

| File | Kind | Tests | What it proves |
|---|---|---|---|
| `src/components/modals/__tests__/DemoSeedModal.test.tsx` (new) | Component + fake IndexedDB (seed stubbed) | 3 | In an AppShell-like shell, Show Demo leads to the summary with "3 Businesses" (it unmounted before the fix); the first demo business stays active through `useActiveProfile`'s repair (it switched back to the person's own before the fix); the preview names the count from the seed list, and both locales take `{count}` |
| `qa/specs/web/onboarding.spec.ts` › `@web.onboarding.demo-summary`, `@web.onboarding.demo-mode` | E2E (release-qa) | 2 | demo-summary is automated; demo-mode follows the summary flow. All 6 onboarding specs pass 18/18 with `--repeat-each 3 --retries 0` |

## MUT-95 — Sample payment records (2026-10-15, TD-063)

| File | Kind | Tests | What it proves |
|---|---|---|---|
| `src/demo/__tests__/seedPayments.test.ts` (new) | Integration (fake IndexedDB, real seed) | 3 | Every sample income entry's records add up to what it has received (paid: its amount; part-paid: `receivedAmountMinor`), none future-dated, all `demo_`. A 1,000 payment on a part-paid entry raises its received amount by exactly 1,000 (before the fix it reset to 1,000), and the guard refuses one minor unit over the true remainder. `removeDemoData` leaves no payment on a sample entry |
| `qa/specs/web/record-payment.spec.ts` › `@web.record-payment.sample-part-paid` (new) | E2E (release-qa) | 1 | On `/?sample=1`, Income for All Time: paying 1,000 on the part-paid entry leaves exactly 1,000 less owed. 3/3 with `--repeat-each 3`; fails on the old seed |

## MUT-96 — Recurring lookback (2026-10-15, TD-069)

| File | Kind | Tests | What it proves |
|---|---|---|---|
| `src/services/__tests__/recurringExpenseService.dueWindow.test.ts` (new) | Integration (fake IndexedDB, clock fixed at 15 Oct 2026) | 3 | A rule started six months ago lists all seven months, where it showed 3 before the fix. A paid June, then a skipped August, move the start to the month after. A rule started three years ago lists 37 months |
| `src/components/expenses/__tests__/RecurringAttentionList.test.tsx` › a long-running rule | Component | +3 | 37 payments read "37 payments since Oct 2023 not marked" with a $2,960 total; three still read "Aug, Sep, Oct"; Arabic uses the many form ("37 دفعة منذ") |
| `qa/specs/web/expenses.spec.ts` › `@web.expenses.recurring-long-missed` (new) | E2E (release-qa) | 1 | A rule from eight months ago: "9 payments since <month> not marked", $720, nine months in Mark Paid. Passes with the other recurring specs |

## MUT-231 — The web QA baseline (2026-10-15)

| File | Kind | Tests | What it proves |
|---|---|---|---|
| `src/pages/landing/__tests__/LandingHeader.test.tsx` › one slot | Component | +1 | The sign-in link and the bar's button sit in `.landing-header-slot`, which carries `data-cta-visible` false at the top and true once the button shows. The phone CSS keys off it. Failed before the fix (no slot) |
| `qa/specs/web/landing.spec.ts` › `@web.landing.375` | E2E (release-qa) | 4 (extended) | 320 and 375, EN and AR: the wordmark is not clipped, Sign in shows at the top and is hidden once scrolled, the button fits. Failed on main ("wordmark clipped: 110px in 47px") |
| `qa/specs/web/brand.spec.ts` › `@web.brand.loader-slow-route` | E2E (release-qa) | 5 (fixed) | Now holds Insights in a build too, with service workers blocked, and accepts `page-has-heading-one` on the loader screen. 5/5 on a dev server; 27/27 with the landing cells, `--repeat-each 3 --retries 0`, on a preview build |

This retires the nine-cell baseline from the MUT-226 and MUT-178 notes above. On preview builds `loader-slow-route` now passes as well, so it is no longer dev-server-only.

## MUT-227 — a ten-year floor on hosted money dates (2026-10-15, ADR-086)

| Suite | Cases |
|---|---|
| `server/src/agreements/__tests__/date-bounds.test.ts` (new) | `DAYS_IN_PAST_LIMIT` is 3660 and equals the ceiling; the floor day and today pass; floor − 1 → `{ reason: DATE_INVALID, field, bound: past }`; `0001-01-01`; the message; the ceiling now says `bound: future` |
| `server/src/income/__tests__/compose.test.ts` | `assertNotFuture` carries `bound: future`; `pastMoneyDate` (today and the floor day pass; impossible date, tomorrow, floor − 1, `0001-01-01`); `redateTo` refuses below the org-timezone floor |
| `server/src/inbox/__tests__/compose.test.ts` | lenient capture floor from UTC yesterday; at four instants, capture accepts every timezone's exact floor (Etc/GMT+12, Kiritimati, UTC, Jerusalem) |
| Route suites | `income-routes` (received + owed), `receivables-settle` (nothing recorded), `income-redate` (both PATCHes, nothing moved), `routes-m4` (API-key `POST /v1/payments`), `routes-expenses` (create + patch; a seeded 2001 row is editable without its date and listed by `from=2001-01-01`, and its summary range works), `routes-conversions` (create + patch), `inbox-routes` (capture + patch), `inbox-filing` (both filings refuse below the profile's floor and keep the entry, matching the direct create's details) |
| `src/hosted/components/__tests__/incomeApiErrors.test.ts` | `bound: past` → `dateTooOld`; `future` or no bound → `dateFuture`, for income and settle |
| Release-QA | `portal.income.date-too-old` (`qa/specs/portal/income.spec.ts`): passing, recorded |
| Regression | version pins in routes-m2..m8 moved to 1.27.0-mut227; every other date test unchanged and green |
| qa-reconcile additions | per endpoint group: `0001-01-01` on settle and both re-dates, the floor day accepted on expense, conversion and inbox PATCH, and on both filings |
| MUT-224 integration (merged second) | `RedateDrawer.test.tsx`: `min` is today − 3660; a date before it is refused with no request; a server `bound: past` reads "more than ten years ago"; an unchanged pre-floor entry closes with no request. `incomeApiErrors.test.ts`: `mapRedateError` past / future / no bound |
| pre-landing review fixes | an unchanged pre-floor date resent with another edit → 200 on expense, conversion and inbox PATCH (written failing first); `routes-m4` replacement keeps the reversed payment's 2015 date (201), an earlier date or a fresh payment there → 422 bound past; `expenseApiErrors` + new `conversionApiErrors.test.ts` map bound past to `dateTooOld`; the floor message test asserts with `toThrow` |

## MUT-228 — GET /v1/fx-rates (2026-10-15, ADR-087)

| File | Kind | Tests | What it proves |
|---|---|---|---|
| `server/src/__tests__/fx-rates.test.ts` (new) | Unit | 40 | `crossRates`: every base lists the four currencies in order with itself at 1; EUR reads the snapshot; crosses round to 6 dp; USD→JOD is 0.709 and JOD→USD 1.410437; `derived` exactly when one side is JOD. `FrankfurterSource`: asks base=EUR&symbols=USD,ILS; refuses a non-2xx, a missing/zero/negative/non-numeric rate, a bad date (including 2026-02-30 and month 13), another base, and a hang past the timeout; never follows a redirect. `CachedFxRates`: 100 concurrent cold calls make 1 provider call; no refetch inside the window, one after; a failed refresh serves the old snapshot as stale; nothing cached + failure is 503 `FX_RATES_UNAVAILABLE`; no provider call inside the 60 s backoff, which is the default when none is passed; a failing cold burst makes 1 call, refuses every request and retries after the backoff; a provider snapshot more than 7 days old is refused and a cached one stops being served as stale past 7 days, and a live one inside its window ages out too; a rate date more than a day ahead or not on the calendar is unusable, up to a day ahead is fine; `warm()` fills the cache, and a failed `warm()` does not start the backoff (a request that joins a failing warm-up is refused, the next one retries); a provider answer too old or in the future does not replace good cached rates, which stay stale; recovery is live again |
| `server/src/__tests__/routes-fx-rates.test.ts` (new) | Route (memory store, fake provider) | 11 | A device session gets the full ILS-base shape with no profile header; a cookie session gets USD-base rates with or without one; five requests make one provider call; `GBP`, `ils` and no base are 422 `VALIDATION_FAILED` without touching the provider; no auth 401, an API key 403 `PRINCIPAL_NOT_ACCEPTED`; provider down with nothing cached, or no rate source configured, is 503 `FX_RATES_UNAVAILABLE`; after the window with the provider down, 200 `stale` with the original `rateDate` and `fetchedAt`; the published `FxRate.derived` description names the peg the code uses |
| `server/src/__tests__/config.test.ts` › reference exchange rates | Unit | +4 (10 cases) | Defaults (Frankfurter URL, 240 min, 3000 ms); values at the bounds are accepted; plain http only for localhost/127.0.0.1; a bad URL, a non-local http URL, an ftp URL, TTL 14/1441 and timeout 499/10001 refuse boot naming the variable |
| `server/src/__tests__/route-security.test.ts` (changed) | Contract | 0 new | `GET /v1/fx-rates` is in the session and device-session surfaces and in both session-only lists (`FX_OPERATIONS`), so an API key is refused |

The phone flows that use it (MUT-229) and a live call to Frankfurter are not exercised here; the provider is faked.

## MUT-165 — Brand v2 spacing guard (2026-10-16, ADR-089)

Plan: `.claude/designs/mut-165-spacing-guard.md` (Section 3 test review). Each new guard was written first and failed for the right reason (the drift tests on the missing `--m-space-*`; the literal fixtures on the missing `spacing` kind).

| File | Kind | Tests | What it proves |
|---|---|---|---|
| `src/styles/__tests__/brand.test.ts` › `drift` | Unit (node, CSS) | +1 | JSON `space` and `--m-space-*` agree both ways, each `--m-space-<n>` is n px |
| `src/styles/__tests__/brand.test.ts` › `tokens` | Unit (node, CSS) | +1 | every `--space-N` (bar 0/px) reads exactly `var(--m-space-<N×4>)`, so a typo can't move a step |
| `src/styles/__tests__/brand.test.ts` › `literals › in CSS` | Unit (fixtures) | +11 catches, +13 leaves alone, +2 | px and rem, negative margins, `var()` fallbacks, `calc()` terms, logical sides, row/column gap; one `var()` hop (in-file and across files); `0`/`auto`/`%`/`em`/token/`calc(token * -1)`, `inset`, a custom-property definition and print rules pass; `lengthCustomProperties` collects only raw-length definitions. `padding: 12px` moved from "leaves alone" to "catches" |
| `src/styles/__tests__/brand.test.ts` › `literals › in TS and TSX` | Unit (fixtures) | +8 catches, +8 leaves alone, +1 | `gap: 8`, `marginTop: 16`, `'24px 0'`, `'0.5rem'`, negatives; token strings, `0`, `'auto'`, `'5%'`, `const gap = 8`, `gap={2}`, a type annotation pass; `SCRIPT_SIZE` and `SCRIPT_SPACING` are key-disjoint |
| `src/styles/__tests__/brand.test.ts` › `literals › the repo` | Repo scan | 0 new (reused) | `KNOWN_LITERALS` froze 175 spacing literals, shrank per sweep commit (175 → 130 → 64 → 13 → 0) and is `{}` |
| `qa/specs/web/brand.spec.ts` `@web.brand.layout` | Release-QA (Playwright) | 8 cells, 2 steps more | the landing page and `/privacy` fit 375/1280 × EN/AR × light/dark with screenshots (D9); each Settings segmented highlight's insets equal its track padding (D11) |
| `qa/specs/portal/shell.spec.ts` `@portal.shell.navigate` | Release-QA (Playwright) | +1 step | shell screenshots in English and Arabic (D9) |

**What was run (Node 22, preview builds):** `npm run lint` 0 errors (4 pre-existing warnings in untouched files) · `npm run typecheck` clean · `npm run test:run` 323 files, 4,462 passed, 4 skipped · `npm run build` passed · `release-qa lint` no errors (6 pre-existing unmapped web files) · full Playwright suite (web + portal, 2 workers, no retries) 188 passed, 2 failed (the pre-existing cells below). Matrix before (T1+T2 tree, pixel-identical to main) vs after: 82 screenshots, 59 identical; every other difference also appears between two runs of the same tree (drawers captured mid-fade, two same-day Income rows swapping order, the portal's loader), plus 7 anti-aliased pixels on one Clients edge. The D4 3px → 2px snap sits below the fold in the Settings screenshot; the D11 assertion passed in every cell. `KNOWN_OVERFLOW`/`KNOWN_AXE_VIOLATIONS` unchanged.

**Pre-existing, not MUT-165 (MUT-250):** `@web.brand.layout` at 375px in Arabic, light and dark, fails on unchanged main 1150d40 too, reproduced before any MUT-165 change: Income and the income drawer measure 727px against the 726px `KNOWN_OVERFLOW` cap (TD-083). The cap is left at 726 by decision; MUT-250 fixes or re-measures it.

## MUT-270 — GET /v1/entries (2026-10-18, ADR-093)

| File | Kind | Tests | What it proves |
|---|---|---|---|
| `server/src/entries/__tests__/merge.test.ts` (new) | Unit | 6 | branches interleave newest first with the id tie-break; a cursor only when rows exceed the limit, at the last row; empty input; `isBeforeCursor` strictness |
| `server/src/payments/__tests__/allocation-state.test.ts` (new) | Unit | 2 | `incomeStatusOf`: unallocated / partial / allocated by applied amount; reversed wins |
| `server/src/__tests__/routes-entries.test.ts` (new) | Route (memory store) | 14 | every kind across profiles newest logged first with its envelope; stable paging while a row lands between pages; no filter = every membership, named / repeated / duplicated `profileId`; 404 alike for another person's, unknown and malformed ids; the profile header ignored; deleted / undone entries out, a Malafat reversal in as `reversed`; `partial` / `allocated` / `origin`; installments out; READY live receipts counted; API key 403, anonymous 401; bad cursor / limit 422; 20 per page by default; a settle links `settlesOwedId` to its Owed and a Malafat correction `replacesPaymentId`; a partial settle links while the Owed reads open; the installment case posts a real installment |
| `server/src/repositories/__tests__/store-contract-entries.ts` (new; memory + Postgres) | Contract | 5 each | merge across organizations and nothing from others; paging without gaps or repeats across equal instants; exclusions incl. a posted INSTALLMENT; receipt counts scoped to the organizations given; `settledOwedIds` links a one-allocation settle to its Owed, never a split, a bare capture or a payment to a scheduled installment |
| `server/src/repositories/__tests__/store-prisma-entries-fanout.test.ts` (new) | Unit (fake Prisma) | 1 | at most 4 queries in flight over 10 organizations, all 40 branches still read |
| `server/src/auth/__tests__/store-guard.test.ts` (changed) | Unit | +1 | `entries.list` is `sessionOnly`: a session on any profile writer, never an API key |
| `server/src/repositories/__tests__/store-prisma-entries-plan.test.ts` (new; test:db) | Query plan | 2 | on a firm with 2,000 installments, every per-kind query is an ordered index scan on its MUT-270 index (no Seq Scan, Bitmap or Sort), and past a cursor the index range starts at `createdAt <=`; fails with the indexes dropped |
| `server/src/__tests__/route-security.test.ts` (changed) | Contract | 0 new | `GET /v1/entries` in the session and device surfaces, organization-independent, API key refused |
| `server/infrastructure/terraform/tests/database_pool.tftest.hcl` (new; `terraform test`, mocked Google + random) | Terraform | 3 | the DATABASE_URL ends `&connection_limit=10` and Cloud SQL has `max_connections` 50; a pool of 20 (2 × 20 + 10 = 50) is accepted and 21 refused by the precondition. CI now runs `terraform test` for this module too |

Unchanged and green: `income-routes.test.ts`, `inbox-filing.test.ts` (fresh payments still `unallocated`), `store-guard.test.ts` (receipt count classified `{ read: 'expenses' }`), `routes-m2/m3/m4/m5/m6/m8.test.ts` (pinned `API_VERSION` bumped to 1.32.0-mut270).

## MUT-237 — change your own password (2026-10-16, ADR-037 amendment)

| File | Kind | Tests | What it proves |
|---|---|---|---|
| `server/src/repositories/__tests__/store-contract-change-password.ts` (new; memory + Postgres) | Contract | 5 each | sets the hash, stamps `passwordChangedAt`, clears a lockout; revokes every other session (cookie and device), keeps the caller's own; writes its audit rows; unknown user → null, nothing written; a session tied to the old verified hash is refused once the row-lock has committed |
| `server/src/__tests__/routes-sessions.test.ts` (changed) | Route (memory store) | +6 | sets the password, revokes other web and device sessions, keeps this one, audits `user.password_changed`; works from a device session too; a wrong current password is 403 `CURRENT_PASSWORD_WRONG` (never 401) and counts toward the shared sign-in lockout, which a subsequent sign-in also trips (D1); new password outside 12–128 is 422 and changes nothing; cross-site/API-key/no-session refused; the current and new passwords never appear in a log line |
| `server/src/__tests__/route-security.test.ts` (changed) | Contract | 0 new (exhaustive snapshot updated) | `POST /v1/me/password` is in the session and device-session surfaces, organization-independent, and an API key is refused on it |
| `src/hosted/components/__tests__/ChangePasswordDrawer.test.tsx` (new) | Component (real router + query client, stubbed fetch) | 7 | opens from the account menu and from the URL, not a page; current/new-password `autocomplete`; success closes with a toast; under-12 refused inline with nothing sent; a wrong current password banners and keeps focus on the field; the button holds while saving, a second click sends one request; Cancel sends nothing |
| `src/hosted/data/__tests__/filters.test.ts` (changed) | Unit | +1 | `changePassword` is carried by the same `omitShellOverlay`/`pickShellOverlay` the profile drawers use |
| `qa/specs/portal/account.spec.ts` (new) | Release-QA (Playwright, in-place env) | 3 | `@portal.account.change-password`, `wrong-current-password`, `password-rule` |

Unchanged and green: `routes-m2/m3/m4/m5/m6/m8.test.ts` (pinned `API_VERSION` string bumped to 1.31.0-mut237, no behaviour change); `no-self-registration.test.ts` (the path carries no forbidden word).

Fix (2026-10-16, kept session signed out on a real clock): the route tests now move the clock between sign-in and the change, which is what exposed the bug. The first test asserts the kept cookie session answers 200 and keeps its `createdAt` and absolute deadline. The device test asserts a second device session is 401, the kept one is still 200 five minutes later, and the old password no longer signs in. The lockout test's success after the lock is followed by a 200 `/v1/me`. A new route test shows a session that signed in with the new password is live, and a second change from the first session ends it. Store contract +2 each: the kept session's `credentialsVerifiedAt` is the change's instant with its start and deadlines unchanged, and the other session keeps its sign-in stamp; a different person's session named as `exceptSessionId` is neither re-stamped nor revoked. Not caught by `qa/specs/portal/account.spec.ts`: it runs on the in-memory `FakeApi`, not the real session middleware.

Review fixes (2026-10-16, MUT-238's pre-landing review), each red before its fix: route +4. (1) A `findByDigest` spy commits the session's own change between the middleware's session read and its user read; `/v1/me` stays 200 twice and the session unrevoked, while the device session the change ended stays 401. (2) The same interleave with another session's change: the reader is still 401. (3) A `changePassword` spy lets the portal's change land while the phone's is between verify and lock: the phone gets 403 `CURRENT_PASSWORD_WRONG`, the portal stays 200, only the portal's password signs in, `failedSignIns` is 0, one audit row. (4) A 1025-character current password is a 422 with no `verify` call; 1024 reaches the hasher. Store contract (memory + Prisma) +3: a moved hash is refused and writes nothing (hash, sessions, stamp, audit); a revoked caller session is refused; the second of two changes loses and the first's session stays live. One changed: another person's session named as `exceptSessionId` is now refused, and neither person is touched.

## MUT-236 — portal /setup page (2026-10-16, ADR-088 §8)

| File | Kind | Tests | What it proves |
|---|---|---|---|
| `src/hosted/pages/auth/__tests__/setupLink.test.ts` (new) | Unit | 8 | 11/12/128/129 and emoji (UTF-16, as zod) boundaries; the policy equals the OpenAPI `NewPassword` minLength/maxLength (drift); token from the router hash; 410 × each state, unknown/missing state → invalid, `used` after a lost answer → try sign-in, 422/429 (whole minutes)/0/5xx/non-API errors; which failures count as a lost answer |
| `src/hosted/pages/auth/__tests__/SetupPage.test.tsx` (new) | Component (real router + query client, stubbed fetch) | 26 | check body is `{ token }` and the location loses its hash; EN/AR (RTL) from the check's locale, a stored choice wins; RESET wording; one visible read-only username input, new-password field, rule as accessible description, autofocus; no re-check on focus (A1); short/long refused inline with nothing sent; redeem → sign-in bodies → Home; button held while saving, second click sends nothing; 410 expired mid-form; plain used without sign-in; lost answer then used → signed in (D3), or "probably saved" when that sign-in fails; 429 minutes; sign-in failure after redeem → "saved"; each refused state's heading with no input and no banned self-service wording; Arabic refusal; 422 → invalid; no fragment → incomplete with no request; check unreachable → Try again → form; check 429; a second link pasted into the same tab is checked; another tab's sign-out leaves `/setup` |
| `server/src/__tests__/well-known-routes.test.ts` (changed) | Route | +1 | no AASA `applinks` pattern claims `/setup` |
| `qa/specs/portal/setup.spec.ts` (new) | Release-QA (Playwright, preview build) | 5 | `@portal.setup.set-password` EN + AR (URL `/setup` with no `#`, read-only email, axe), `refused-links`, `password-rule`, `answer-lost` |

Unchanged and green: `auth-states.test.tsx` (sign-in's rate-limit minutes after the `retryMinutes` move), `BootScreens.test.tsx` (default label), `parity.test.ts`, `check-bundles` in `npm run build`. Known pre-existing release-QA failures: `@portal.signin.boot-slow-session` ×2 (TD-150).

## MUT-235 — setup links replace printed passwords (2026-10-16, ADR-088)

| File | Kind | Tests | What it proves |
|---|---|---|---|
| `server/src/__tests__/account-setup.test.ts` (new) | Unit | 11 | 43-char base64url tokens, no repeats in 1,000; `setupLinkState`: valid, expired at and after the instant, used beats expired, superseded, invalid for unknown / no person / DISABLED; `setupUrl` puts the token in the fragment only; link policy 72 h in 1–720; new password 11/12/128/129 boundaries, emoji allowed |
| `server/src/repositories/__tests__/store-contract-account-setup.ts` (new; memory + Postgres) | Contract | 16 each | null password round-trips; issue/find; unknown user FK; a new link cancels only that person's open links; a used link stays used; issue audits and, without lock, leaves password and sessions alone; lock clears the password and revokes cookie and device sessions (`setup_link_lock`); redeem sets the hash, clears the lockout, revokes sessions (`password_set`), audits; a refused redeem (second use, at expiry, superseded, unknown, disabled) writes nothing; just before expiry redeems; concurrent redeems → one winner; concurrent issues → one open link |
| `server/src/__tests__/routes-account-setup.test.ts` (new) | Route (memory store) | 11 | check: valid names email/locale/purpose/expiry only, each refusal says only its state, disabled reads invalid, malformed token 422; redeem: sets the password and both sign-ins work with no cookie set, 410 + state for used/expired/superseded/unknown, 422 outside 12–128 with the link still usable, every cookie and device session signed out (AC 5), cross-site 403 on both routes, 21st call from one address 429 with Retry-After and sign-in's budget untouched; AC 2: an unredeemed account and a wrong password give the same code and message after exactly one argon2 verify, on both sign-ins |
| `server/src/__tests__/routes-users.test.ts` (changed) | Route | +6 | create returns a SETUP link (72 h) and stores no hash; `setupLinkValidHours` 1/720 ok, 0/721 422; a reset keeps the old password and session until the link is used, then only the new one signs in (AC 4); a reset before any password is SETUP and supersedes the first link; `lock` kills the password, cookie and device sessions at once; disabled 409 `USER_DISABLED`; the old `/password` route is 404; audit sequences include `user.setup_link_issued`; logs never contain a token, a password or an argon2 hash across create, check, redeem, a failed redeem and a locked reset (AC 6) |
| `server/src/__tests__/no-self-registration.test.ts` (changed) | Contract | +1 | the public `/v1` operations are exactly sign-in, device sign-in and the setup-link pair (AC 7) |
| `server/src/scripts/__tests__/users-cli.test.ts` (changed) | CLI | +3 | create prints one link and no password, `--valid-hours` reaches the stored expiry and a non-number fails; rotate prints a link and the keeps-working note; `rotate --lock` prints the signed-out note and clears the password |
| `server/src/scripts/seed-demo-account/__tests__/*` (changed) | CLI | 0 new | the seed still returns a fresh password that signs in, now set through a setup link |
| ~20 route suites (changed) | Route | 0 new | provision through `helpers/provision.ts`; behaviour unchanged |

qa-reconcile additions (2026-10-16): `account-setup.test.ts` +3 (`setupLinkOrigin`: PORTAL_ORIGIN wins, plain-http real host → https, loopback keeps http); store contract +3 (disable cancels open links and re-enable does not revive; create writes the first link in its transaction; a create whose link cannot be stored leaves no user) and the lock test asserts `passwordChangedAt`; `routes-account-setup.test.ts` +8 (concurrent redeems → 200 + 410 `used`; `user.password_set` metadata; the redeem route's own 429; re-enable → 410 `superseded`; a lockout lifted by redeem; a session inserted after `--lock` but started before it is 401; an http request yields an https link; PORTAL_ORIGIN is where links point and the only origin that may redeem); `routes-users.test.ts` +1 (no body 200, empty JSON body 422, `{}` 200) and the lock test asserts the `lock` echo and audit metadata. Fix-review round: store contract +2 (a session tied to the verified hash is refused after a lock, after a redeem and for a disabled person; issue refuses a non-ACTIVE person and writes nothing) and `routes-account-setup.test.ts` +1 (a device sign-in whose password check overlaps a `--lock` is 401 `INVALID_CREDENTIALS`, the lock injected from inside the hasher's verify).

Not exercised here: the portal `/setup` page (MUT-236, which carries the UI release-QA scenarios) and the phone, which only signs in.

## MUT-24 — locale split, key check, What's new (2026-10-16, ADR-151)

- `src/lib/i18n/__tests__/translations.test.ts`: `composeDictionary` merges and throws on a namespace in two files, every JSON file on disk is in `PARTS` (`import.meta.glob`), en/ar have the same files and namespaces, and the dictionaries are in parity (shared `parityProblems`).
- `scripts/__tests__/i18n-keys.test.ts`: unit cases for literal, data-held, template, concatenation, namespace-constant and property-access references, plus the whole app having no missing and no orphaned key.
- `src/pages/projects/__tests__/ProjectsPage.searchEmpty.test.tsx`: real dictionaries; no-match copy, en singular/plural, Clear search, and Arabic with the dual.
- `ExpensesLedgerPage.test.tsx`: an uncategorized expense groups under "Uncategorized".
- `src/lib/whatsNew/__tests__/releaseNotes.test.ts`: `compareVersions`, `notesSince` (range ends, newest first, both languages), `latestNotesUpTo`, `releaseNotesProblems` (shape, line counts, blanks, required version) and the shipped `release-notes.json`.
- `src/lib/whatsNew/__tests__/whatsNewState.test.ts`: fresh-install and upgrade seeding, never moving a stored seen version, showing until dismissed across starts, and storage throwing on read or write.
- `src/components/modals/__tests__/WhatsNewModal.test.tsx`: upgrade shows the versions newest first; Got it persists across a remount; Escape dismisses; nothing when already seen; it waits for the welcome flow; Arabic RTL with an LTR version.
- `platform.test.ts`: `handleVersionChange` returns the previous version (null fresh or on unreadable storage). `AboutSection.test.tsx`: the What's new row opens the newest included notes, and is absent when there are none (`appVersion` mocked with a getter).
- `tag-release.test.ts`: web tags carry the English lines from the tagged commit, there is no notes block without an entry or a file, API tags never carry notes, `release-web` runs `release:notes` after the bump and before the build and stages `release-notes.json` in the release commit, and a dirty tree never reaches deploy.sh (server preflight fails without asking; `release-server` re-checks the tree before its commit and push). `vite-config.test.ts`: `appVersion()` default, override and refusals.
- Release-QA: `web.whats-new.after-update`, `.fresh-install`, `.reopen-arabic`, 3/3 on a `MUTABA3A_APP_VERSION=0.1.7` web preview build (throwaway config, `serviceWorkers: 'block'`).
- **Coverage (MUT-24 C)**: this item runs on its own branch (`claude/mut-24-coverage-*`); its baseline and final numbers land with it.


## MUT-153 — analytics event contract (2026-10-17, ADR-090)

- After the pre-landing review it has 118 cases. Added:
  - the contract's top-level `currencies` list, checked against `server/src/money.ts` `SUPPORTED_CURRENCIES`, with malformed lists rejected;
  - a sha256 pin per contract version (append-only), and the portal emitters;
  - one row per banned token, plus integer money names (`cost`, `fee`, `amounts`, `minor_units`, `ids`, `cents`);
  - failed/failure/crashed/exceptions events, and the SDK's `$pageleave` / `$opt_in` / `$screen`;
  - unknown keys, a fourth shared property, `semver` outside app_version, and `iso4217` (replaced by `currency`, the app's four codes).
- `scripts/__tests__/analytics-taxonomy.test.ts` (first version: 53 cases, node environment):
  - The real `docs/analytics/events.json` passes every rule.
  - Its events and emitters match the MUT-152 funnels exactly.
  - Table-driven bad fixtures prove each rule rejects:
    - a bad version, and a missing shared property;
    - a `surface` enum other than the four surfaces;
    - non-snake_case and non-allowlisted `$` event names, and error/exception/crash events (Sentry owns them);
    - missing, unknown, duplicate and server/web/desktop emitters;
    - missing descriptions;
    - banned property tokens matched whole (`client_id`, `amount_minor`, `user_id`, `page_url`), while `paid`, `currency`, `prompt` and `cta` pass;
    - free-form types;
    - bad or duplicate enum values, values on a non-enum, and an event property that repeats a shared one.
- Release-QA: not applicable (docs and contract only; no user-visible flow). MUT-154, MUT-155 and MUT-157 carry the QA scenarios and the "what we send is a subset of the contract" tests. The Flutter parity test against a vendored copy is MUT-157's.

## MUT-154 — landing visit counts (2026-10-17, ADR-090)

- **`src/lib/analytics/__tests__/guard.test.ts`** (14 cases):
  - unknown events and wrong emitters dropped;
  - enum, currency and boolean values validated; undeclared properties dropped;
  - shared properties stamped over the caller's;
  - routing and control fields kept;
  - `$set` / `$set_once` / `$unset` stripped;
  - session, window, screen, timezone, language and ad-click fields dropped everywhere;
  - the landing allowance kept (URL, UTM, referrer, cookieless hash inputs);
  - an `/app` referrer dropped;
  - the portal allowance (no URL, path, host or referrer).
- **`posthogConfig.test.ts`** (6 cases):
  - EU host;
  - every feature off on both surfaces;
  - landing cookieless;
  - portal `localStorage`, unbatched;
  - `before_send` reads the live context.
- **`src/pages/landing/analytics/__tests__/landingAnalytics.test.ts`** (25 cases):
  - the `ctaForHref` table;
  - no key → no SDK and no listener;
  - one init with the cookieless config;
  - the visible language stamped;
  - a CTA click sends `landing_cta_clicked` at once;
  - SDK load failure swallowed;
  - the hook waits for idle (key mocked through `posthogKey.ts`).
- **`scripts/__tests__/vite-config.test.ts`**: `posthogKey()` takes unset or a `phc_` key and
  refuses `phx_`, short or malformed values; web and hosted get the key, desktop `""`.
- **`scripts/__tests__/analytics-lint.test.ts`**: posthog-js is forbidden in `main.tsx`,
  `LandingProviders`, the landing pages, app code and the portal shell; allowed in the two
  analytics modules; type-only allowed in `src/lib/analytics`.
- **`scripts/__tests__/check-bundles.test.ts`**: static-import parsing (minified, spaced, never
  `import()`); the entry graph from the module script plus modulepreloads; PostHog in a reachable
  chunk fails; marker table.
- **`download-config.test.ts`**: the campaign on App Store (`ct`, `pt` once set) and Play
  (UTM referrer) links.
- **`PrivacyPolicyPage.test.tsx`**: the "Anonymous usage counts" section right after "No ads,
  no tracking", in en and ar; PostHog named in sharing and network; the crash-reporting clause
  kept.
- **Release-QA `qa/specs/web/landing-analytics.spec.ts`** (4 features). On a preview build with
  the dummy key:
  - `pageview-cookieless` (no `ph_*` cookie or storage);
  - `cta` (`hosted_offer`);
  - `local-app-referrer`;
  - `local-app-silent` (core: zero PostHog requests from `/app`).
- **`landing.spec.ts` phone test** now expects the campaign on store links.
- **Review fixes (qa-reconcile F1–F8):**
  - `check-bundles.test.ts`: `precachedUrls` reads both quoting styles; `posthogPrecached` names
    every precached file that mentions PostHog.
  - `vite-config.test.ts`: the SDK and `posthogConfig-*` chunks are in `globIgnores`;
    `vendor-posthog` is named in the web build only.
  - `analytics-lint.test.ts` (20 cases): `lib/analytics` may not load the SDK but keeps the storage
    seam; local-app pages may not import `landing/analytics`; nothing outside the analytics modules
    imports the guard; landing and download pages may call the counter.
  - `guard.test.ts`: the landing drops `$os` and `$browser`.
  - `landingAnalytics.test.ts` (27): waits for `load` before scheduling; leaving first cancels.
  - The landing QA spec asserts only event posts leave and catches `__ph_*` keys. The spy answers
    every `*.posthog.com` host.

## MUT-155 — portal opt-in usage counts (2026-10-17, ADR-090)

- **`src/hosted/analytics/__tests__/portalAnalytics.test.ts`** (14 cases):
  - no key → `unavailable`, nothing loaded;
  - no SDK before a choice;
  - on → init with the portal config, then `analytics_opted_in`;
  - off → `analytics_opted_out`, `reset(true)`, `opt_out_capturing`, `ph_*` keys removed;
  - sign-out → nothing sent, the record cleared;
  - another account → reset and asked again;
  - `trackPortal` is a no-op unless on;
  - `portal_opened` once per page load;
  - on again after off → `opt_in_capturing` with no `$opt_in`.
- **`src/hosted/shell/__tests__/UsageConsent.test.tsx`** (8, through the real shell):
  - the prompt with two equal buttons and no SDK;
  - on from the prompt (`first_run`);
  - "Not now" not asked again;
  - no key → no prompt and no switch;
  - Arabic copy;
  - the menu switch reflects and turns off (one last note) and on (`settings`);
  - sign-out forgets the choice and the `ph_*` keys, sending nothing.
- **The drawer tests:**
  - `IncomeCaptureDrawer`: `{currency, paid}` after a confirmed save, nothing on a failed one;
  - `RecordPaymentDrawer`: `{currency}`, nothing on a 409;
  - `ExpenseDrawer`: `{currency}` on create; nothing on edit or a 422; once across a retried save.
- **Other unit tests:**
  - `endSession.test.ts`: `endPortalUsage` on `signed_out`, not on `expired`;
  - `AppDownloadMenuItems.test.tsx`: `ct=mutaba3a-portal`;
  - `PrivacyPolicyPage.test.tsx`: the portal sentence before the closing, the network sentence, Arabic.
- **Server:** `portal.test.ts` pins the CSP with `https://eu.i.posthog.com`.
- **Release-QA `qa/specs/portal/usage-analytics.spec.ts`** (5). On a keyed preview build, PostHog answered locally:
  - `prompt-silent-until-chosen` (core: zero requests before an answer);
  - `opt-in-counts` (no URL, path, host, referrer or profile ID; no cookie; event posts only);
  - `save-income-counts` (ILS, paid, no amount or client);
  - `opt-out-last-note`;
  - `sign-out-resets`.
- **`@portal.account.get-the-app`**: the iPhone link carries `ct=mutaba3a-portal`; Android is the last, inert row.
- **Review fixes (F1–F6):**
  - `portalAnalytics.test.ts` (23):
    - opt-out order capture → opt out → reset, sweeping both storages;
    - opting out or signing out while the SDK loads sends nothing;
    - a save right after a reload waits for the SDK;
    - another tab's opt-out (a `storage` event, or a record re-read at save time) silences this tab and clears its sessionStorage.
  - `portalAnalytics.sdk.test.ts` (4, real posthog-js):
    - opted out and nothing stored before a yes;
    - after opt-out, no `ph_` key in either storage, and a stale capture neither sends nor writes;
    - a fresh `$device_id` on re-opt-in;
    - a new page after an opt-out starts opted out.
  - `posthogConfig.test.ts`: the portal's `opt_out_*_by_default`.
  - QA `other-tab-silenced`: a save in a second tab after an opt-out in the first sends nothing, and its switch reads off.
- **Known:** on preview builds, `portal.signin.boot-slow-session` (2 tests) still fails, as listed above. The other 72 portal and landing specs pass.

## MUT-157 — phone opt-in usage counts (2026-10-17, ADR-090, ADR-092; Flutter repo)

- **`test/domain/services/analytics/analytics_contract_test.dart`** (5): the fixture's sha256 and README row; the phone event set equals the contract's ios+android emitters; property types and values; shared properties; currencies equal `Currency.values`.
- **`analytics_guard_test.dart`** (6):
  - the exact property set;
  - undeclared and invalid values dropped, including `$screen_name`, `$set`, `$set_once`, `$initial_*`, `$timezone`;
  - shared properties can't be overwritten;
  - `$geoip_disable` on every event;
  - non-semver, locale and surface refusals;
  - prompt values.
- **`product_analytics_test.dart`** (17):
  - nothing and no ID before a yes;
  - unavailable without a transport;
  - opted_in + first open once per person;
  - every note guarded, with uuid and timestamp;
  - `trackEntrySaved` mapping, conversions not counted;
  - opt-out order with the last note under the old ID, offline-queued then delivered, and ID rotation;
  - declining sends nothing;
  - sign-out and account switch forget everything and send nothing;
  - expiry keeps the choice;
  - queue cap and serialised flush;
  - a throwing transport never escapes.
- **Widget tests:**
  - `usage_prompt_test.dart` (6): equal buttons, on/decline, waits for the App Lock nudge, never without a key, Arabic RTL;
  - `settings_usage_test.dart` (4): Privacy row off then on (settings) then off (last note), absent without a key, sign-out forgets and sends nothing.
- **Hooks:**
  - `capture_usage_test.dart` (4): received → paid true, expense, blocked Save, sharing off;
  - `target_picker_sheet_test.dart` (+2): client_created on the server's ok only, no name;
  - `widget_capture_inbox_test.dart` (+1): new widget/Siri entries reported once.
- **Release-QA `qa/features/ios/analytics.yaml`** (5 flows, recorder transport):
  - `prompt-silent-until-chosen` (core);
  - `opt-in-counts`;
  - `save-income-counts`;
  - `opt-out-last-note`;
  - `sign-out-resets`.
- **Known, already on main:** `test/core/capture_amount_contract_test.dart` "1000 EUR → 1000.00" fails the same way on main (849b3243): number grouping.

## MUT-147 — Sentry foundation (2026-10-17, ADR-091)

- `scripts/__tests__/sentry-rules.test.ts` (37 cases, node environment). Contract-level, with no scrubber code (the surfaces own theirs). It checks:
  - **Tokenizer.** Whole-token splitting (snake, kebab, dot, camelCase, acronyms).
  - **Shape.** Known keys only; the same semver version in both files; the sha256 of both files pinned per version; the fixture marker only in the fixtures file.
  - **Surfaces and options.** Surfaces are exactly api, portal, landing and capture-app. The SDK options are exact, the server status floor is 500, and every org privacy switch is on.
  - **Lists.** The deny lists hold the ADR minimum, lowercase, with no duplicates. Allowed tags and user keys hold no deny token. Safe and always-dropped context keys are disjoint, with `device.name` dropped.
  - **Ignored errors.** Every surface has some, each compiles, each is in the portable regex subset, and the portability check itself rejects five non-portable forms.
  - **Fixtures, per fixture.** The expected event has nothing forbidden; the input has something to strip; frames, release and environment pass through.
  - **Fixtures, across the set.** A frame `filename`, `os.name` and `browser.name` survive; `device.name`, `client_name` and `clientName` are dropped; and a labelled message value becomes `[Filtered]`.
  - **Mutation check (manual, 2026-10-17).** Putting `device.name` and `clientName` back into two expected events fails 4 cases.
- `scripts/__tests__/sentry-org-settings.test.ts` (15 cases), with `fetch` mocked at the boundary. It checks:
  - **Desired settings.** Derived from the rules.
  - **Drift.** None when the org matches. A switch that is off or missing is flagged. Missing sensitive fields are flagged, ignoring case and extra fields.
  - **Arguments.** The mode, org and token, the default EU host, and normalising `/api/` and a trailing slash. Missing or double modes, a missing `--org` value, a missing token or org, and a plain-http host are rejected.
  - **Apply and check.** `--apply` PUTs then GETs with a Bearer token. `--check` only GETs and reports drift. An apply that didn't stick is reported. An error status shows the method and status, never the token.
- `server/infrastructure/sentry/tests/sentry.tftest.hcl` (6 runs, mocked provider, server-ci):
  - four projects with `default_key = false` and `default_rules = false`, and one key each, rate-limited per hour;
  - `allowed_domains` exact on portal and landing, and `*` on api and capture-app;
  - browser inbound filters on portal and landing only;
  - spike protection enabled across all four;
  - three email alerts per project, to issue owners falling through to all members, with the spike alert at 50 per hour;
  - a wildcard browser origin and an incomplete rate-limit map are both rejected.
  - **Mutation check (manual, 2026-10-17).** `default_key = true` plus a wildcard portal origin fails two runs.
- Release-QA: not applicable (no user-visible flow). MUT-148..151 carry the QA scenarios, for example "landing sends zero Sentry requests on `/app`".
- **Pre-landing review additions (2026-10-17, D1–D13):**
  - `sentry-rules.test.ts` is now 62 cases.
    - **Fixtures.** Allowed content survives in every fixture. Three new fixtures: the portal `/setup#token` navigation, an api Prisma validation error with frame vars and compound keys, and a landing JSON plus `key: value` message.
    - **Contract rows.** Curated `orgSensitiveFields`, never a substring of kept text. Exact `urlFields`. Compound deny tokens. The shared `labelledValuePattern`, finding all three forms and not URLs or times (superseded by D15, then the cycle-3 changes). Prisma first-line-only. `includeLocalVariables: false`. The six org switches.
  - `sentry-org-settings.test.ts` is now 30 cases.
    - **Org settings.** The six switches, `safeFields` drift and the region refusal before any write.
    - **Apply.** The merge keeps hand-added fields. An empty PUT body passes. Every request has a timeout signal.
    - **Arguments and tokens.** Only `--apply`/`--check`. `SENTRY_ADMIN_TOKEN` is read, never `SENTRY_AUTH_TOKEN`. The `sentry.io` host allowlist, with four rejected and three accepted hosts.
    - **CLI.** A run from `server/infrastructure/sentry` doesn't hit ENOENT. It was red first, on the old code.
  - **Terraform.** 13 runs.
    - Daily caps (`rate_limit_window` 86400).
    - Rejections: wildcard landing origin, http origin, origin with a path, empty list, zero cap, and caps overrunning the monthly quota.
    - `eu_region.tftest.hcl`: a US ingest DSN fails the `sentry_key` postcondition. It's in its own file because runs in one file share state.
  - **CI.** `contracts-ci.yml` runs the Sentry and analytics contract tests on contract-only changes.
- **Re-review additions (fix cycle 2, D15–D17):** `sentry-rules.test.ts` has 75 cases, `sentry-org-settings.test.ts` 36.
  - **Pattern-independent leak cases.** Each of these must lose its secret substrings after the reference scrub: compact JSON, spaced JSON, Bearer, `name=Acme Legal`, a Dart map, a single-quoted value, a comma amount, `email = x` and a harmless label in front.
  - **Untouched texts.** URLs and times, and an ordinary TypeError message, stay exactly as they were.
  - **Other contract rows.** A bounded-cost check: 150k- and 200k-character worst cases, truncated to `maxMessageLength`, scrub within a 2 s budget (the scan itself is quadratic; the cap bounds it), `requestDropFields`, and `referer` in the deny headers.
  - **Settings script.**
    - It refuses an org holding a foreign project, before any write.
    - An empty org passes.
    - It refuses an org with an unknown region.
    - A trailing slash on the region URL is accepted.
    - Every request has `redirect: 'error'`.
    - A failing first GET reports the method and status without the token.
- **Final re-review additions (fix cycle 3, D18–D19):** `sentry-rules.test.ts` has 99 cases, `sentry-org-settings.test.ts` 37.
  - **Leak cases.** Nested objects and arrays, compact and spaced, including an array of objects. A cut-off quoted value. Parentheses inside a bare value. The domain labels: `client`, `vendor`, `title`, `E-mail` and `withdrawnReason`. URLs inside text with a fragment or a query.
  - **Untouched texts.** The Prisma unique-constraint message is left alone.
  - **Reproduction.** For every fixture, the contract's reference scrub must reproduce each expected exception value exactly, so a fixture can't drift from the algorithm.
  - **Fixtures.** The portal fixture now carries `request.fragment`, `request.env` and a URL with a token inside its exception text.
  - **Pattern.** `urlInTextPattern` is in the portable subset.
  - **Script.** It refuses a paginated project list (Link `rel="next"; results="true"`). The admin-token error names a personal token.
- **Convergence review additions (contract 1.1.0, 2026-10-18):** `sentry-rules.test.ts` has 156 cases, `sentry-org-settings.test.ts` 38, Terraform 14 runs.
  - **Pins.** 1.0.0 stays pinned; 1.1.0 is a new row.
  - **Leak cases.** `grossMinor`/`netMinor`, `reference`, `label`, `metadata`; pretty-printed JSON (`JSON.stringify(x, null, 2)`) and `util.inspect` output; `email2`, `phone2`, `address2Line`; plural keys.
  - **Messages.** The top-level message (string, `message.formatted`, `logentry.formatted`) and breadcrumb messages get the labelled-value and URL checks, and the reference scrub must reproduce them in every fixture. `params` in `message`/`logentry` is forbidden in expected output.
  - **Rows.** `firstLineOnly('FormatException')`, `messageDropFields` equals `['params']`, the tokenizer splits at digits.
  - **Script.** A single page with Sentry's always-present `rel="next"; results="false"` link passes.
  - **Terraform.** The spike alert is 10 an hour; a threshold of 50 (above the 20-a-day portal and landing caps) is rejected.
  - **Second pass.**
    - Leak cases: one-line nesting under a bare key (Dart `Map.toString`, `util.inspect`), and `Set(n) {`, `Map(n) {`, `Client {` and `[Object: null prototype] {` containers.
    - Untouched: Flutter and JS assertion text with `==` / `===`.
    - `firstLineOnly` matches an obfuscated type by its value; a Prisma message without the prefix doesn't.
    - `flutter_error_details.context` and `.information` are always dropped.
    - Every message shape (`message`, `message.formatted`, `logentry.formatted`) and `params` under both `message` and `logentry` appear in the fixtures.
    - Mutation evidence: the 8 new leak cases all leak under the previous rules (7 through the pattern, 1 through missing deny tokens), and a 4,000-object fuzz of Dart and `util.inspect` output finds 0 leaks under the new one (685 under the old).
  - **Third pass.** Leak cases: a quoted key over a `Set(2) {` container, `util.inspect` Map and URLSearchParams `=>` entries, Dart `Invalid argument (key):` and `RangeError (key):`, compound plurals. Untouched: `Invalid argument(s): …`. Each leak case leaks under the second-pass rules (scratch probe, 7 of 7).

## MUT-268 — Portal expense groups (2026-10-18)

| Area | Tests | Covers |
|---|---|---|
| Rules | `src/hosted/data/__tests__/expenseGroups.test.ts` (34) | calendar helpers, status/nudges/reached a year, window + action table + inverses, default currency, per day rounding, daily/weekly bars (locale week start, sum = total), other-currency days, category order, picker window, ≈ conversion (exponents, derived, missing rate, stale), optimistic marks (summary + rows, net zero), member filter, day grouping, sequential saves |
| Queries | `src/hosted/data/__tests__/expenseGroupQueries.test.tsx` | every-page loop at 200 sorted oldest first; per-expense mark order incl. failure; overlay never double-counts when the summary reloads first; refused mark goes back; batch moves at once, saves in order, refetches once; expense edits invalidate groups; FX key outside the root |
| URL | `filters.test.ts` | `?newGroup`, `?currency`, `?category=uuid|none`, `?editGroup`, `?addToGroup` |
| Components | `DayBars.test.tsx`, `CategoryBars.test.tsx`, `Toast.test.tsx`, `src/lib/motion/__tests__/rowEnter.test.ts` | keyboard + RTL arrows, tab stop, dot/zero classes; toggles; toast action in both tones; row return LTR/RTL/reduced/no layout |
| Pages | `src/hosted/pages/__tests__/ExpenseGroups.test.tsx` (23) | tabs aria-current, list order/totals/+N/nudges/error, create defaults + validation + POST/key + landing, GROUP_LIMIT fresh key, headline/≈/tab/chart/per day, members by day + Kept + verbs, optimistic leave out + Undo, category leave-out-all, Uncategorized, every 8A detail state, Arabic default, edit If-Match + delete confirm, picker pool/partial, In groups line |
| Release-QA | `qa/specs/portal/expense-groups.spec.ts` (9, tagged `@portal.expense-groups.*`) | create, leave-out-undo, add-from-outside, currencies-converted, category-prune, states, in-groups-line, edit-delete, arabic-375 (no sideways scroll) |

### MUT-280 — Gulf currencies on the server (2026-10-18)

| Test | Covers |
|---|---|
| `server/src/__tests__/money.test.ts` › currency support, Gulf currencies | nine codes in order, exponents, KWD/GBP/lower-case unsupported, AED/SAR/QAR 2 dp, BHD/OMR 3 dp, over-precision refused, BHD ceiling = `MAX_AMOUNT_MINOR` |
| `server/src/__tests__/fx-rates.test.ts` › crossRates, peg fixture | 9×9 equals a hand-built per-USD table with literal pegs; AED→SAR 1.021103, BHD→OMR 1.022606, ratio independent of the ECB snapshot; `derived` matrix (AED base: 8, USD base: the 6 pegged); `USD_PEGS` literal; `docs/fx/pegs.json` equals `USD_PEGS` |
| `server/src/__tests__/routes-fx-rates.test.ts` | ILS base lists nine rows with the Gulf rates; base AED/BHD: nine rows, 8 derived; KWD 422; pegged base 503 with the provider down and nothing cached; every peg in the `derived` description |
| `server/src/__tests__/routes-sessions.test.ts`, `routes-device-sessions.test.ts` › MUT-280 | `currencies` = `SUPPORTED_CURRENCIES` on POST /v1/sessions, GET /v1/me and POST /v1/device-sessions; bodies parse with `MeSchema` / `DeviceSessionSchema` |
| `income-routes`, `routes-expenses`, `routes-conversions`, `routes-profiles` › MUT-280 | AED 1250.50 and BHD 12.345 income; BHD 4th / AED 3rd decimal / KWD → 422; OMR 0.385 expense, 4th decimal 422; AED→BHD conversion; SAR profile moved to QAR |
| `server/src/import/__tests__/plan.test.ts` › MUT-280 | AED project planned as create; KWD → `UNSUPPORTED_CURRENCY` |
| `server/src/repositories/__tests__/store-contract-expenses.ts` › MUT-280 | BHD 12_345n round-trips in both stores (Postgres via `test:db`) |
| `scripts/__tests__/analytics-taxonomy.test.ts` | contract 1.2.0 pinned by sha256; its currencies equal the server list |

### MUT-272 — expense currency edit (server half, 2026-10-18)

| Test | Covers |
|---|---|
| `server/src/expenses/__tests__/compose.test.ts` › expensePatch currency | currency alone → AMOUNT_REQUIRED (changed or not); amount + currency → both set, read in the new currency's digits (JOD 3, JOD→USD 2); too many digits for the new currency → refused on amount; amount-only keeps the row's currency |
| `server/src/__tests__/routes-expenses.test.ts` › MUT-272 ×5 | 422 AMOUNT_REQUIRED alone (USD and ILS), row unchanged; USD "1.234" → 422 amount; JOD 1.234 → 200 v2; stale If-Match → 409; USD → 200 v3; exact audit per version (`currency` + `amount` {from,to}), none on an amount-only edit; month summary under USD only; same currency resent → plain edit, no move audited; another profile's expense → 404, unchanged; JOD→USD move then stale JOD-shaped amount → 409 VERSION_MISMATCH (not 422) |
| `server/src/__tests__/inbox-routes.test.ts` › MUT-272 ×2 | stale edit after a JOD→USD move → 409 before the amount is read; a write landing between read and update → store 409, that write survives |
| `server/src/__tests__/routes-expenses.test.ts` › MUT-272 race | a write landing between read and update → store 409 with currentVersion 2, the other device's notes survive (fails with the stale mapping removed) |
| `src/hosted/components/__tests__/ExpenseDrawer.test.tsx` › PATCHes on edit | the currency select is disabled on edit (MUT-272 review; MUT-277 enables it) |
| `server/src/__tests__/routes-expense-groups.test.ts` › MUT-272 | a moved member sums under JOD only, day buckets add up to the total, `?currency=JOD` lists it and `?currency=ILS` doesn't |
| `server/src/repositories/__tests__/store-contract-expenses.ts` › MUT-272 | both stores write `currency` with `amountMinor` |

## MUT-286 — Use the portal without an account (2026-10-19, ADR-097, ADR-100)

| Test | Covers |
|---|---|
| existing server suite, unmodified | `createApiShell` / `routes/me.ts` / `PORTAL_ROUTES` extraction changed no behavior |
| `server/src/__tests__/portal-routes-coverage.test.ts` | every one of the portal's 49 client calls is answered by `PORTAL_ROUTES` |
| `server/src/repositories/__tests__/store-contract-snapshot.test.ts` | snapshot → fresh store → restore answers identically |
| `store-contract-expenses.ts` › unlinked + customerId | memory lets `unlinked` win, like Prisma |
| `server/src/__tests__/platform-shim.test.ts` (8) | SHA-256, HMAC, base64url/hex/utf8 and the three cursor formats byte-identical to Node across 10,000 seeded inputs |
| `src/hosted/local/__tests__/createLocalApp.test.ts` (3) | `/v1/me` answers for the minted person; no token → 401; a fresh session every boot, same person, old token dead after restore |
| `src/hosted/local/__tests__/format-fingerprint.test.ts` (3) | organization/customer/receivable shapes pinned (D1; the other 24 maps are TD-171) |
| `src/hosted/local/__tests__/locks.test.ts` (3) | two and three tabs racing a write: the later one sees stale, reloads, and no write is lost |
| `src/hosted/local/__tests__/transport.test.ts` (5) | a 2xx write persists and bumps stateVersion; a read and a refused write write nothing; a restored store answers with what was saved; a newer stored format refuses the request and is never written over |
| `src/hosted/local/__tests__/parity.test.ts` (2) | AC3: the same records through `createApp` and `createLocalApp` give identical answers (ids normalized, per-side ticking clock); the script hits a part-paid OVERDUE receivable and a 422 |
| `src/hosted/local/__tests__/no-network.test.ts` | AC4: a whole signed-out session through the portal's `api` with `fetch` booby-trapped: never called |
| `src/hosted/local/__tests__/boot.test.ts` (9) | first boot answers /v1/me; same person and profile across reloads with nothing entered; records across reloads (AC2); two empty tabs become one person; a write in one tab is in the other's next answer; restore replaces and persists; a tab whose person was replaced re-mints; a non-records file changes nothing; a newer stored format refuses to boot and retries next time |
| `src/hosted/local/__tests__/recordsFile.test.ts` (6) | Maps/Dates/bigints round-trip; restored store answers; record count; refuses non-JSON, missing maps, newer format |
| `src/hosted/local/__tests__/createLocalApp.test.ts` › console | a route failure goes to `console.error` |
| `src/hosted/session/__tests__/mode.test.ts` (5) | no hint → probe; stored modes; junk hint ignored; blocked storage keeps the mode for the page; readers re-render |
| `src/hosted/api/__tests__/client-mode.test.ts` (11) | remote → fetch only; local → backend with a page-origin Request; sign-in/setup always remote; probe 401 → local saved, 200 → remote saved, 503/offline → nothing saved; a local 401 never ends a session; newer format → `LOCAL_FORMAT_TOO_NEW`; a failed boot retries |
| `src/hosted/session/__tests__/local-mode.test.tsx` (21) | through the real router: first visit (one request, Arabic, pre-existing session kept); account menu, nav, switcher, Malafat hidden (AC5); cross-tab refresh; reload screen; sign-in "Continue on this device", expired choice, sign-in → remote + local cache dropped, sign-out → local; Your data download, restore lands on the restored profile, cancel, refusals, absent signed in |
| `scripts/__tests__/hosted-lint.test.ts` › local mode | portal ⊄ server/src; no static `@mut/local-backend`; allowlist admits route list + store, refuses sessions routes, app.ts, prisma; portal bans hold in the local backend |
| `scripts/__tests__/check-bundles.test.ts` › local backend stays lazy | IndexedDB allowed lazily, flagged in a statically loaded file |
| `src/hosted/components/__tests__/ClientPicker.test.tsx` › Add «name» (4) | offered only for a name no client has (any case) and only with `canCreate`; picking POSTs `{ name }` with Idempotency-Key and profile header and picks the new client; a refusal keeps the name unpicked with a toast; directory and summaries refetch |
| `incomeAffordances.test.ts` › canAddClient (3) | owned personal/business yes; Malafat-fed and writer-null firm no |
| `ExpenseDrawer.test.tsx` › client label | the Client label names the picker; no Add row without `canAddClient` |
| `no-network.test.ts` › client + owed + part paid | createCustomer → Owed 900 → settle 400 → PARTIALLY_PAID, 500.00 outstanding, no fetch |
| `portal-routes-coverage.test.ts` | 50 portal calls (MUT-286 adds `POST /v1/customers`) |
| Review fixes (ADR-100 §9) | `boot.test.ts`: Download includes another tab's save; a refused save rejects and stops the page, reload shows disk; a refused Restore keeps memory; local profiles to the cap of 6. `createLocalApp.test.ts`: clock moved back still signs in. `client-mode.test.ts`: LOCAL_SAVE_FAILED / LOCAL_FORMAT_TOO_NEW call the stop handler; LOCAL_UNAVAILABLE for a backend that can't run; server failures stay NETWORK. `local-mode.test.tsx`: another tab's sign-in / continue-on-device reopens this tab; sign-in page left alone; refused save replaces the route with the reload screen; blocked-storage screen with Sign in; slow earlier Restore pick; post-apply hiccup still says restored. `ClientPicker.test.tsx`: failed add clears the earlier client. `check-bundles.test.ts`: IndexedDB outside the `mut-local` chunk flagged |
| Release-QA `qa/specs/portal/local-mode.spec.ts` (`@portal.local.*`) | first-visit, received-persists, owed-part-paid (Add client in the picker), two-tabs, download-restore, session-expired — all pass on a preview build |
| Release-QA `qa/specs/portal/income.spec.ts` › `@portal.income.add-client` | signed in: Add client creates and picks the client, the income goes to it; no Add row on a Malafat-fed profile |

## MUT-318 — Add a matter from the portal's matter picker (2026-10-19, ADR-100 decision 10)

| Test | Covers |
|---|---|
| `src/hosted/components/__tests__/ProjectPicker.test.tsx` (12) | Add row only with `canCreate` + a client + an unknown name (any case; another client's name is new here); POST `{customerId, name, currency}` with Idempotency-Key and profile header, then picked; no client → no Add row, polite hint in the input's `aria-describedby`; no hint without `canCreate`; client chips only with no client chosen; refused create keeps the name unpicked, value `''`, toast; enabled + read-only + focused while saving; directory and summaries refetch |
| `src/components/ui/__tests__/EntityTypeahead.test.tsx` › saving and cues (4) | read-only not disabled while a pick saves, focus kept (A1); `create-success` after a resolved create, not after a refused one (A2); cascade flash on a new `flashSignal`, never on mount (A3); `describedBy` → `aria-describedby` (5A) |
| `src/lib/forms/__tests__/useClientProjectCascade.test.tsx` (moved, +3) | hosted `ownerOf` fills the client and reports the fill; a client change clears a matter of another client without a fill; a matter not yet in the list is left alone |
| `ClientPicker.test.tsx` › enabled while adding | A1 for the client picker |
| `ClientTypeahead.test.tsx` › flash | the local client field flashes on a new `flashSignal` |
| `IncomeCaptureDrawer.test.tsx` › matters (4) | Add matter in the drawer currency, then Owed carries `projectId`; picking a matter with no client fills it and Owed saves; clearing the client clears its matter; no Add row on a Malafat-fed profile |
| `ExpenseDrawer.test.tsx` › add matter | Matter label names the field; hint with no client; Add matter in the expense currency once a client is picked |
| `no-network.test.ts` › client → matter → owed | createCustomer → createProject → Owed on the matter: receivable names both, no fetch |
| `portal-routes-coverage.test.ts` | 51 portal calls (MUT-318 adds `POST /v1/projects`) |
| Release-QA `@portal.local.matter-owed` | signed out: Add client, Add matter by Enter (focus kept), save, reload: listed under both; only the first-visit request |
| Release-QA `@portal.income.add-matter` | signed in: hint with no client; Add matter POST body + headers; income names it; nothing offered on a Malafat-fed profile |
| Release-QA `@portal.income.matter-fills-client` | client chips; picking Client 2's Retainer fills Client 2; switching to Client 1 empties Matter |
| Reconcile additions (2026-10-19) | `EntityTypeahead.test.tsx`: no second pick while one saves (list shut on ArrowDown/refocus); cascade flash comes off after its span and replays. `useClientProjectCascade.test.tsx`: `onAutoFill` with the default owner, not when the client already owns it. `IncomeCaptureDrawer.test.tsx`: Save held while a matter is added; Enter held still saves once it lands; CURRENCY_MISMATCH under Matter; Malafat no-Add check now waits for the open list (was vacuous). `ExpenseDrawer.test.tsx`: Save held while a matter is added; picking a matter fills the client, changing the client empties it. `incomeApiErrors.test.ts`: CURRENCY_MISMATCH → `matterCurrency` with the matter's currency. Release-QA `@portal.income.add-matter`: the Malafat step waits for the open list before asserting no Add row |

## MUT-356 — /privacy honours ?lang, like /terms (2026-10-20)

- **Landing:** `src/content/legal/__tests__/language.test.ts` (`legalLanguageOf`: en, ar, among other params; absent, empty, unknown, upper case and other names ignored). `PrivacyPolicyPage.test.tsx` `?lang` (English text on an Arabic site and the reverse, `lang`/`dir` on the text, `<html dir>` and the stored language unchanged; an unknown value falls back to the page language).
- **Release-QA:** `@web.legal.privacy-linked-language` (new); `@web.legal.links` now reads the hosted-accounts heading from the translation files (it had gone stale when the heading became "Where your records live").
- **Phone (mutaba3a-flutter):** `legal_links_test.dart` (`privacyUri` `?lang=en|ar`); `ios.settings.terms-link` taps Privacy in English and in Arabic.

## MUT-354 — The client release on each terms acceptance (2026-10-20)

- **Server:**
  - `server/src/__tests__/terms.test.ts` "the client release on each acceptance":
    - the redeem and the accept route record it; the audit and the admin report show it, with the release of the latest version;
    - an old client that sends none succeeds and records null;
    - a repeat keeps the first release;
    - an empty, 65-character, spaced, control-character or non-ASCII value gets 422 on both routes, with nothing written;
    - a 64-character value and a phone-style `phone-1.4.0+52` are accepted;
    - the OpenAPI document states the optional field with its limits.
  - `store-contract-account-setup.ts` (memory + Postgres): the release is kept on a repeat; `listLatestTermsVersions` returns `latestClientRelease`; a redeem records it, or null.
  - `users-cli.test.ts`: `terms` prints the release, or `-`.
  - The migration has no drift against `schema.prisma` (`prisma migrate diff --exit-code` on a fresh database).
- **Portal:** `src/hosted/__tests__/terms.test.ts` (`TERMS_CLIENT_RELEASE` = `web-v0.0.0` under tests); the `SetupPage.test.tsx` and `TermsUpdatePage.test.tsx` request bodies carry it.
- **Release-QA:** the bodies in `@portal.terms.setup-requires-accept`, `.language-switch-clears-tick`, `.updated-terms-step`, `.changed-mid-step` and `@portal.setup.set-password` carry `clientRelease` matching `web-v<x.y.z>` (`QA_CLIENT_RELEASE`). 11/11 `@portal.terms.*` + `@portal.setup.*` pass on a hosted preview build (Node 22, 2026-10-20).

## MUT-324 — Terms of service, accepted at setup (2026-10-19, ADR-102)

- **Server:**
  - `server/src/__tests__/terms.test.ts`: the version in the check; a missing or stale version is refused before hashing; a dead link says why first; version, locale, sha256 and surface are recorded; audit on owned profiles only; a reset after acceptance; `Me.terms` on every sign-in surface; a bump asks again; null signed out; the accept route is idempotent, phone surface, stale, 401.
  - `store-contract-account-setup.ts` (memory + Postgres): idempotent accept, the latest by version, FK, redeem + reset keep one row, and a refused redeem records nothing.
  - `check-terms-live.test.ts`, the `users-cli` terms report, route-security lists, the store-guard operator list.
- **Landing:** `TermsPage.test.tsx` (EN/AR, versions, unknown version, English prevails); `PrivacyPolicyPage.test.tsx` (hosted-accounts section, footer link); `HostedOfferPage.test.tsx` (terms link); `termsManifest.test.ts`; `scripts/__tests__/legal-terms.test.ts` (server pin = files = landing latest; deploy-check origin = Vite's).
- **Portal:**
  - `SetupPage.test.tsx`: the tick is required, sends the version and the language, links the exact version, terms changed. The existing setup behaviours are kept (R5); `save()` ticks.
  - `setupLink.test.ts` (termsChanged), `TermsUpdatePage.test.tsx`, `UserMenu.terms.test.tsx`.
- **Release-QA:** `qa/features/web/legal.yaml` (terms-page, links, terms-manifest) and `qa/features/portal/terms.yaml` (setup-requires-accept, updated-terms-step, links); specs in `qa/specs/{web/legal,portal/terms}.spec.ts`. `setup.spec.ts` now ticks the terms.
- **Review fixes (2026-10-19, `fix/mut-324-review-fixes`):**
  - Fix 1, the link language: `src/hosted/__tests__/terms.test.ts` (termsHref `?lang`); `TermsPage.test.tsx` `?lang` (wins over the page language, lang/dir on the text, never stored, unknown language ignored, kept on the current-terms link); the portal link hrefs in `SetupPage`/`TermsUpdatePage`/`UserMenu.terms` tests, both languages.
  - Fixes 2–3, release order: `legal-terms.test.ts` (release-full is web then server; the server preflight runs `terms:check-live` before bump-version; deploy.sh checks only when run alone). `check-terms-live.test.ts` `checkTermsLive` (HTTP status, fetch error, not JSON, missing version).
  - Fix 4: `TermsUpdatePage.test.tsx` (a 409 refetches Me, and the retry sends the new version; Sign out on the step).
  - Fix 5: `legal-terms.test.ts` privacy promise = terraform (14 backups, 7 PITR).
  - Should-fix: a `RELEASED_TERMS` frozen table; `termsManifest` skips non-JSON; the Arabic governing law; Arabic setup (`?lang=ar`, `termsLocale: 'ar'`); a setup 409 without `details.current` asks the check again; `aria-busy` while loading only. Server: accept-route cross-site 403 and 422; a contract test (memory + Postgres) for `listLatestTermsVersions`.
  - Release-QA: `@web.legal.terms-linked-language`, `@portal.terms.changed-mid-step`, `@portal.terms.step-sign-out`; `?lang` assertions in `portal/terms` and `portal/signin`; the privacy facts list includes "the last 7 days".
- **Review pass 2 (2026-10-19):** `legal-terms.test.ts` (no TERMS_CHECKED_BY_PREFLIGHT; only SKIP_TERMS_CHECK skips the preflight check); `TermsUpdatePage.test.tsx` (a refetch naming newer terms shows "changed"; an in-flight /v1/me can't bring the step back, which fails without cancelQueries; a 409 uses details.current when the refetch fails); `SetupPage.test.tsx` (a language switch clears the tick; after a 409 with no version, a dead re-check shows the refusal and a failed one the unreachable banner); `server terms.test.ts` (TermsStatus non-null, Me.terms an inline nullable object) plus a compile-time `MeTermsMayBeNull` in `client.ts`; `termsManifest.test.ts` (misnamed files refused, dotfiles skipped); `store-contract-account-setup.ts` (`acceptTerms` → `{ created }`). Release-QA `@portal.terms.language-switch-clears-tick`.
## MUT-287 — Signed out: expenses, groups, conversions, receipts and documents on this device (2026-10-19, ADR-100 decision 11)

| Test | Covers |
|---|---|
| `server/src/__tests__/routes-fx-rates.test.ts` › public (5) | 200 with no session or profile header, the raw snapshot; same cache as `/v1/fx-rates` (one provider call); 503 with no source / provider down; 429 + Retry-After past the per-address limit, other addresses unaffected |
| `route-security.test.ts`, `no-self-registration.test.ts` | `GET /v1/public/fx-rates` is the one new public operation |
| `src/hosted/local/__tests__/blobStore.test.ts` (4) | type and size kept; keys/delete; survives a new connection; its own `mut-local-blobs` database, never `mut-local` |
| `attachments.test.ts` (7) | `local-blob:` upload/download URLs; head size/type (untyped → null); removal staged until flush, forgotten on discard; sweep deletes only unnamed files |
| `receipts.test.ts` (8) | start → putBlob → complete READY → reload → same bytes; UPLOAD_INCOMPLETE / UPLOAD_MISMATCH; deleting the expense removes the file after the save; non-local URLs refused; boot sweep keeps a pending upload; Documents lists an empty page (AC3); export zip → cleared device → restore → receipt downloads |
| `transport.test.ts` › staged removals (3) | flush after a saved write; discard on a refused write; discard and no flush when the save fails |
| `fxSource.test.ts` (8) | no credentials, no redirects; non-2xx / bad body / offline fail; local `/v1/fx-rates` runs `crossRates`; offline → 503; one fetch per cache window; the local app never serves the public route |
| `no-network.test.ts` (+3) | expense + receipt + documents + categories, and group + mark + conversion, with no fetch (AC1, AC4); reference rates: exactly one fetch, to `/v1/public/fx-rates`, `credentials: 'omit'` (D3) |
| `recordsArchive.test.ts` (6) | zip of `records.json` + binary receipt entries; round trip typed from the receipt; MUT-286 `.json` restores; missing receipt entry named, records restored; unnamed entries ignored; refusals |
| `restore.test.ts` (2) | backup replaces records and files and sweeps the old; a refused save leaves this device's records and files intact (R1) |
| `format-fingerprint.test.ts` (29) | every snapshot map has a case and a record; per-map field kinds (TD-171) |
| `src/hosted/data/__tests__/download.test.ts` (2) | local-blob download via object URL + `<a download>` named after the file, released later; missing file rejects |
| `ReceiptUploader.test.tsx` (+2, 1 changed) | local-blob upload goes to `localFiles.put`, never fetched; a refused store shows the upload-failed toast; download passes the filename |
| `local-mode.test.tsx`, `views.test.tsx` | nav shows Expenses and Conversions signed out; Your data downloads a `.zip`; Documents download passes the filename |
| `scripts/__tests__/check-bundles.test.ts` (+2) | jszip only in a lazy chunk |
| Release-QA `@portal.local.expense-receipt` (core) | record, attach a PDF, reload, download by name, same bytes; only the first-visit request |
| Release-QA `@portal.local.fx-line` | USD + ILS group shows the ≈ line with the ECB date; offline it hides; only `/v1/me` and `/v1/public/fx-rates` |
| Release-QA `@portal.local.conversion`, `@portal.local.documents-empty` | log, reload, edit a conversion; Documents empty state with no error |
| Release-QA `@portal.local.download-restore` (extended) | zip with `records.json` and the receipt as its own file; after Restore the receipt downloads again byte for byte |
| Review (2026-10-19) | `routes-fx-rates.test.ts` default limiter at 120/min; `fx-rates.test.ts` relayed upstream staleness; `fx-outside-lock.test.ts` a save never waits on a stuck FX fetch; `fxSource.test.ts` relay + device memory (1 h) + unreadable storage; `idb.test.ts` superseded and blocked upgrades; `blobStore.test.ts` `stat`; `attachments.test.ts` live vs backed-up keys (pending expiry); `recordsArchive.test.ts` damaged zip, Safari-folder zip, two folders refused, upload-rule refusal, `.json` missing count; `restore.test.ts` refused save leaves no backup files; `parity.test.ts` expense/receipt/group/conversion script; `format-fingerprint.test.ts` no null-only field; `vite-config.test.ts` Buffer plugin; `local-mode.test.tsx` missing-receipts confirm line; release-QA `@portal.local.restore-missing-receipts`, `fx-line` remembered rates |


## MUT-336 — SVG → React icon codegen pipeline (2026-10-19)

| Test | Covers |
|---|---|
| `scripts/__tests__/icon-set.test.ts` (21) | `kebabToComponentName` (single-word, hyphenated, 3-part); `parseSvg` (simple path children, nested `<g>` groups, throws on unrecognized element/attribute naming the file, throws on unclosed tag); `generateComponent` (imports shared `IconProps`, injects `size`/`className`/drops `xmlns`, numeric `strokeWidth`, `id` → `data-part` never raw `id`, nested groups preserved, a quote/backslash in an attribute value round-trips as a safe JS expression); `generateBarrel` (sorted, one line per name); `ICON_PROPS_MODULE`; `findIconSetProblems` (clean, missing, stale, orphaned, ignores `index.ts`/`types.ts`) |
| `src/pages/settings/__tests__/SettingsPage.icons.test.tsx` | Pilot (AC #3): the generated `LanguageIcon` renders next to the language setting, asserted via its `data-part="nuqta"` sub-element |
| Existing `src/pages/settings/__tests__/*` (116 tests) | Re-run unchanged after the pilot edit — no regression |
| Manual: `npm run icons:generate` then `npm run icons:check` | 61/61 source icons generate; validator reports clean |

## MUT-337 — Icon save-feedback animation runtime decision + web prototype (2026-10-19, ADR-152)

| Test | Covers |
|---|---|
| `src/lib/motion/__tests__/iconMotion.test.ts` (7) | `ICON_OVERSHOOT_EASE`/`ICON_RESTRAINED_EASE` match `MMotion.overshoot`/`.spring` exactly; playful and restrained both settle at scale(1); the playful preset's live value exceeds 1 mid-flight (the actual "bounce," not just which constant was selected); reduced motion jumps straight to scale(1) on either preset; every target in a list animates; re-triggering mid-flight doesn't throw and still settles cleanly |
| Manual | No dev-server CSP check performed — the mechanism writes `element.style.transform` directly via JS, the same pattern `playRowEnter`/`playRowExit` already use under the portal's CSP (ADR-044), so it's CSP-safe by construction, not by inspection |

## MUT-328 — Uptime checks and alerts (2026-10-20, ADR-154)

| Test | Covers |
|---|---|
| `server/infrastructure/terraform/tests/monitoring.tftest.hcl` (14 runs, mocked Google + random, server-ci `terraform test`) | Defaults: `health`/`ready`/`portal` on the Cloud Run host, every 300 s over validated HTTPS, all regions, no channel or policy, `/health` keeps its display name; the portal matcher `id="root"`; `uptime_host` moves every check; a host with a scheme, path or port is refused; email + SMS create 2 channels and 5 policies, each notifying both plus existing ids; uptime policy > 1 region for 360 s at 300 s `ALIGN_NEXT_OLDER` + `REDUCE_COUNT_FALSE`, its own check id, CRITICAL; Cloud SQL disk > 0.8 / CPU > 0.9 for 900 s on `<project>:mutaba3a-pg`, WARNING; non-E.164 SMS refused; existing channel ids alone still alert; the drill adds a check + policy, and a path without `/` is refused; `enable_uptime_check = false` keeps the SQL alerts |
| `tests/database_pool.tftest.hcl` (3) | Unchanged, still green after the monitoring section moved out of `main.tf` |
| Not automatable here | The real plan against production (expected: 9 to add, the `/health` check moved) and the drill (fire, then close) are Basel's steps in `server/DEPLOYMENT.md` §6b |

## MUT-326 — The custom domain is one input (2026-10-20, ADR-155)

| Test | Covers |
|---|---|
| `scripts/__tests__/hosts.test.ts` (24) | `parseHostsConfig` refuses each bad field by name (domain shape, subdomain label, unknown stage, stage/domain mismatch, http or pathful legacy origins, a domain the legacy hosts live under); `resolveHosts` per stage: legacy (legacy hosts, no front door), proxy (front door built, builds unchanged), live (apex + `app.` subdomain, both hosts for the phone), redirect; the fixtures shared with Terraform |
| `scripts/__tests__/hosts-cli.test.ts` (18) | `get` per key and an unknown key; `withDomain` previews without touching the file; `domain:plan` names every consumer, shows before → after, keeps both hosts in the phone lines, the Netlify rules per stage, the proxy stage leaving builds alone; `main` exit codes and usage |
| `scripts/__tests__/no-hardcoded-hosts.test.ts` (3) | AC1: no legacy host, `mutaba3a*.a.run.app` / `*.netlify.app` or chosen domain outside `config/hosts.json` (prose and the CIMD files exempt); the pattern catches a planted literal; a rehearsal with `mutaba3a.app` as the domain stays green |
| `scripts/__tests__/front-door-worker.test.ts` (7) | The Worker forwards path and query, sends the token and the edge-read client IP, overwrites forged copies, passes `X-Mutaba3a-Profile`/cookies/`Sec-Fetch-Site`/`Origin` through but not Host, never gives GET/HEAD a body, keeps the server's 302 and both `Set-Cookie`s (`redirect: manual`), fails closed when unconfigured |
| `scripts/__tests__/vite-config.test.ts` (+5) | Defaults equal `HOSTS`; the Netlify rules: none before live, `<apex>/app*` back to netlify.app from live, the old landing pages (and only those) to the apex at redirect, never `/app` or assets on the old host; web build only. The web snapshot masks the config-derived portal URL |
| `scripts/__tests__/legal-terms.test.ts` | The terms guard's npm script reads the landing origin from the config, the same value vite builds for |
| `server/src/auth/__tests__/front-door.test.ts` (10) | Token match exact, absent without a configured token; client IP from the front door only with the token, `unknown` for a missing/odd/listed value, `X-Forwarded-For` with the configured hops on the direct path (forged headers ignored); same-origin per path; no token = today's rules |
| `server/src/__tests__/config.test.ts` (+9) | `FRONT_DOOR_TOKEN` length and its need for `PORTAL_ORIGIN`; `PORTAL_LEGACY_REDIRECT` reads only "true"/"false" ("false" is off) and needs the token |
| `server/src/__tests__/legacy-redirect.test.ts` (17) | Old-host page visits 302 to `/carry-over?next=…` with no-store; the carry-over page itself, the API, admin, health, readiness, assets, static files, association files and writes are never redirected; through the front door never; off unless the stage says so and without a front door |
| `server/src/__tests__/check-terms-live.test.ts` (+4) | `publicOrigin` takes the env value without a trailing slash and refuses to guess when it's unset |
| `server/infrastructure/terraform/tests/domain.tftest.hcl` (4) | No domain: no front-door env or IAM, today's plan unchanged; the checked-in config; a live domain: `PORTAL_ORIGIN`, `FRONT_DOOR_TOKEN` as a secret ref, no redirect env, the IAM grant, `public_portal_origin`; an unnamed environment |
| `server/infrastructure/frontdoor/tests/frontdoor.tftest.hcl` (5) | No domain: zero resources; the checked-in config; a domain: zone, apex/www DNS-only to Netlify, proxied portal host, Worker route, upstream and secret bindings, strict TLS and no edge challenge, token secret name, Netlify domain, output; staging names; missing account ids flagged |
| `server/infrastructure/sentry/tests/sentry.tftest.hcl` (+2) | DSN origins come from the config (no extras still allows them); a chosen domain adds its origins and keeps the legacy ones |
| Manual (offline) | `terraform plan` of the frontdoor stack with the placeholder fixture, a local backend and dummy tokens: **16 to add, 0 to change, 0 to destroy**, all `create` |
| Manual (operator, MUT-112) | DEPLOYMENT.md §5a's checks per stage (curl of `/health`, `/ready`, both association files and a sign-in through `app.<apex>`; the redirect check at stage redirect) |
| Release-QA | None added: nothing is user-visible while `domain` is null (builds byte-identical, pinned by the snapshot and the guard). The carry-over's `web.bridge`, `portal.carry-over` and `portal.carry-over-fallback` belong to MUT-112/MUT-291 (design §7) |

## MUT-327 — Restore drill and pilot operator runbook (2026-10-20, ADR-157)

| Test | Covers |
|---|---|
| `server/src/scripts/__tests__/restore-drill.test.ts` (8, no database, fake `gcloud`/`cloud-sql-proxy`/`psql` that fail if called) | Usage without `--project`; the dry run prints backup list, create, backup restore, PITR clone, receipt checks and teardown, and calls nothing; every create/clone/patch/restore/set-password/delete targets only a `mutaba3a-pg-drill-<stamp>-b\|p` name; `--only pitr`; teardown refuses `mutaba3a-pg` and non-drill names; a drill name as the source is refused; `--pitr-minutes` outside 1 to 7 days is refused; no alpha/beta-only flag (`--labels`, found on the first production run 2026-10-23); teardown skips a never-created instance and deletes an existing one |
| `server/src/scripts/__tests__/profile-rows.test.ts` (7, `MUTABA3A_TEST_DATABASE_URL` + `psql`, two databases built from the migrations) | export: one CSV per table, no `api_keys`/`idempotency_keys`, other profiles excluded, receipt copy lines; restore refuses the same database and a schema mismatch; restore puts back a renamed customer, a deleted expense and receipt, removes a later customer, leaves another profile, memberships and later audit rows, adds `organization.restored`, and a dry run changes nothing; purge-user refuses a shared membership and a reference from someone else's profile, then deletes the user, owned profiles and their rows, terms rows and `user.terms_accepted` everywhere, and nothing else |
| Shellcheck | Both scripts clean |
| Local walk (runbook §9) | Every locally walkable step against the local API and copies of `mutaba3a_dev` |
| Not automatable here | The drill against production backups (AC1), in-place restore, ingress close and reopen, bucket soft-delete restore: Basel's steps |

## MUT-357 — Drawers fit a phone (2026-10-20, TD-070)

| Test | Covers |
|---|---|
| `src/styles/__tests__/drawerFit.test.ts` (2) | `.drawer` in `src/index.css` declares `max-width: 100%`; its only `width` is `var(--drawer-width)`, and no `.drawer` rule (plain, `[dir="rtl"]`, dark) sets another `width` or a `min-width` |
| `qa/specs/portal/direction.spec.ts` (`@portal.direction.drawer-phone-ar`, `-en`) | At 375×812, Change password in Arabic and English: once its spring settles the dialog's box is 0..375 (fills the screen) and `scrollWidth` does not exceed `clientWidth`. Both red on main (Arabic 0..480, English −105..375), green on the branch (preview build) |
| `qa/specs/web/brand.spec.ts` (`@web.brand.layout`) | The payment drawer at 375px now has to fit outright (its `KNOWN_OVERFLOW` entry is gone), English and Arabic, light and dark |
| Re-run, unchanged | `@portal.account.*`, `@portal.your-data.*`, `@web.drawer-motion.*` (incl. `rtl-mirror`): desktop drawers, drag-to-dismiss and the RTL mirror still pass |

## MUT-358 — Billing core (2026-10-21, ADR-162)

| Test | Covers |
|---|---|
| `server/src/billing/__tests__/entitlement.test.ts` (22, pure) | Every rule in order: Malafat first; live, expired, revoked and someone else's grants; Freelancer covers the owner's profiles but not a firm they belong to; Firm covers its organization and the payer's own; trialing = active; past_due = GRACE; ranking ACTIVE > GRACE then FIRM; lapsed paid = READ_ONLY for good; incomplete ignored; trial ACTIVE to day 14, READ_ONLY to day 30, LOCKED from day 30; a payer is never LOCKED (AC2); incomplete_expired isn't paying; running trial beats a lapsed subscription; operator firm and no-trial accounts are READ_ONLY/NONE |
| `server/src/billing/__tests__/gate.test.ts` (15, pure) + `server/src/__tests__/billing-gate-routes.test.ts` (20, memory, gate on) | MUT-361: standing per state; READ_ONLY reads only, LOCKED only the export; every state × list read, expense/income/conversion writes, receipts upload, records export (+ receipt) of a LOCKED profile with nothing deleted; /v1/me, trial prompt, billing and sign-out open; person-level inbox/entries/New profile on the best standing, the feed leaving a LOCKED profile out; profile PATCH on the path's profile; a device session; a Malafat API key never gated; an unmatched route's 404; every organization-independent endpoint classified; `billingStanding` null with the gate off. Plus `users-cli` `billing-uncovered`, `config` BILLING_GATE default and `trialTimelineOf` |
| `src/hosted/components/__tests__/LapseGate.test.tsx` (13) + `src/hosted/__tests__/queryClient.test.ts` (3) | MUT-361 portal: read-only banner (trial lock date, paid lapse, not-yours), no Record/Add income, view-only expense drawer with receipt Download, `?newExpense` refused, gate-off unchanged, GRACE banner, locked screen (no list read, Download → Your data, Subscribe → step, switcher kept, Arabic RTL), a late 402 re-reading /v1/me; mapper tests for SUBSCRIPTION_LAPSED |
| `server/src/__tests__/billing-core.test.ts` (13, memory) | `/v1/me` `billing` per profile through a trial, past_due and a grant (ISO `until`); Malafat-covered firm; `null` in signed-out mode; one `factsFor` read per call; the snapshot carries no billing; admin grant by email (audited on owned profiles only) and on a profile with expiry; 422 two targets / past expiry, 404 unknown, 401 no token; revoke once + idempotent + `active=true` listing; link needs a currency for a new customer, is idempotent and audited; unlinked listing; 409 `CUSTOMER_LINKED_ELSEWHERE` / `USER_HAS_ANOTHER_ACCOUNT`; 422 bad customer id |
| `server/src/repositories/__tests__/store-contract-billing.ts` via `store-memory-billing.test.ts` and `store-prisma-billing.test.ts` (6 each) | `factsFor` (payer on each subscription, grants, trial starts), grant write + audit, revoke once, `activeAt`, one-target + FK refusals, link idempotency/conflicts/currency, unlinked listing, subscription upsert needs a known customer |
| `server/src/repositories/__tests__/migration-mut358.test.ts` (1, scratch DB) | The backfill grants every existing user (FREELANCER) and operator firm (FIRM), none for owned profiles, no trials; the one-target CHECK; schema parity after later migrations |
| `server/src/scripts/__tests__/users-cli.test.ts` (+3) | `billing-grant/grants/revoke` (idempotent), exactly one target, `billing-link`, `billing-unlinked` |
| `server/src/scripts/__tests__/profile-rows.test.ts` (extended) | Export leaves out `entitlement_grants` / `billing_subscriptions`; a grant made after the backup survives a restore |
| Release-QA | None: no user-visible flow. MUT-361/362 carry the portal billing scenarios |


## MUT-373 — Co-owners (2026-10-21, ADR-163)

| Layer | Where | Covers |
|---|---|---|
| Unit (server) | `server/src/__tests__/owns-profile.test.ts` | R1 truth table: creator, co-owner, firm/Malafat/personal OWNER-role members never own, no membership |
| Route (server) | `server/src/__tests__/routes-profile-owners.test.ts` | grant role OWNER (refusals, limit, D7), co-owner rights (PATCH, CO_OWNED, income, re-date own vs other's, firm request, firm enable keeps OWNER), firm member never owned (OV2), leave/remove/creator/NOT_CREATOR/404/idempotent replay, terms audit |
| Store contract | `store-contract-co-owners.ts` (memory + Prisma) | grantOwner incl. concurrent limit (Prisma), listOwnersOf, updateOwned co-owner vs firm member, CO_OWNED, removeOwner + audit, setFirm keeps OWNER, role conflict |
| Scripts | `pre-roll.test.ts`, `profile-rows.test.ts`, `users-cli.test.ts` | stray membership found, operator co-owner not; purge refuses a creator with co-owners; `--role owner` + partner note |
| Portal unit | `profileRules.test.ts`, `profileApiErrors.test.ts`, `useProfileKind.test.ts`, `malafatSuggestions.test.ts` | shared cue, actions, cap hint, created-by, error maps, ListFormat en/ar, requested-by line, OV9 |
| Portal component | `ProfileOwnersSection.test.tsx` | order, remove/leave confirms, network retry same key, 404 done, footer steps aside, type card lock, mailto, cue + cap hint, lost-access banner |
| Route (server, review) | `routes-profile-owners.test.ts` | USER_DISABLED (D2), operator revoke audits the role, Owed re-date own vs partner's + `capturedByUserId` (D1), NOT_OWNER for firm staff, refusals keep memberships and write no audit, `firmRequestedBy` name null after the requester leaves |
| Store contract (review) | `store-contract-co-owners.ts` | grant audit in the transaction and once on confirm, none on refusal; staff never removed or promoted; firm off keeps roles; retype vs grant race (Prisma) |
| Scripts (review) | `pre-roll.test.ts` | BOOKKEEPER rows pass; built-in personal profile strays; confirm clears a flagged row |
| Portal (review) | `ProfileOwnersSection.test.tsx`, `endSession.test.ts`, `RedateDrawer.test.tsx`, `incomeAffordances.test.ts` | focus to next Remove (fails on the old code), cancel, NOT_CREATOR, close while pending, leave errors/404/not-open, lost-access dismiss/deep link/sign-out reset, partner's Owed entry not re-datable |
| Release-QA | `portal.profiles.co-owner-write|remove|leave|removed|full-rights` | recorded flows |

## API error reports to Sentry (MUT-148, added 2026-10-22)

| Layer | File | Covers |
|---|---|---|
| Contract (root, contracts-ci) | `scripts/__tests__/sentry-server-scrub.test.ts` | embedded rules equal `sentry-rules.json` field by field; every surface's fixtures exact; AC4 body/cookie/Authorization/API key gone; ignored errors per surface; SDK-shaped breadcrumbs; input not mutated |
| Boundary (root) | `scripts/__tests__/sentry-local-boundary.test.ts` | nothing reachable from `createLocalApp.ts` or `app-shell.ts` imports `@sentry/` or `sentry-node.ts`; walker sanity |
| Unit (server) | `sentry-reporter.test.ts` | no DSN = no-op; event tags/release/environment/server_name; scrubber runs; AbortError dropped; integration list; script reporter EU check; `shutdownAndFlush` order and failed disconnect; `runScript` crash/success |
| Route (server) | `error-reporting.test.ts` | unknown error and ApiError ≥ 500 reported with request id and route template; 4xx and unparseable body never; createApp wiring; `/health` errorReporting |
| Config / smoke | `config.test.ts`, `smoke.test.ts` | EU DSN only, SENTRY_ENVIRONMENT default; `--expect-error-reporting` pass/fail |
| Deploy | `release-guard.test.ts` | `guard_sentry_release` refuse/allow/fail-closed/skip; deploy.sh wiring (smoke flag, script DSN) |
| Terraform | `tests/sentry_dsn.tftest.hcl` | off by default; on mounts the secret from remote state; US DSN refused |
| UI / Release-QA | `PrivacyPolicyPage.test.tsx`, `web.legal.privacy-error-reports` | Error reports section en + ar, server-only wording |
| Manual | `npm run sentry:smoke` (DEPLOYMENT.md §1.5 step 8) | one real event lands in `mutaba3a-api` |

### MUT-388 — the Gulf currencies go (2026-10-22)

| Test | Covers |
|---|---|
| `money.test.ts` | the four codes and exponents; AED…OMR unsupported; `parseMoney` refuses a removed code instead of rescaling |
| `fx-rates.test.ts`, `routes-fx-rates.test.ts` | 4 × 4 grid through USD; only JOD pairs derived; `?base=JOD` 3 derived; `?base=AED` 422; peg fixture parity |
| `income-routes`, `routes-expenses`, `routes-conversions`, `routes-profiles`, `import/plan.test.ts` | a Gulf write, leg, profile currency or import row → 422 / `UNSUPPORTED_CURRENCY`; JOD 3-decimal expense |
| `routes-expenses.test.ts` › MUT-388 | a stored BHD expense reads back as 12.345 (single and list); PATCH amount → 422 `AMOUNT_INVALID`, row unchanged; moving it to JOD with its amount → 200 |
| `inbox-filing.test.ts` › MUT-388 | an AED inbox entry: filing as expense, received or owed → 422 `UNSUPPORTED_CURRENCY`, entry kept |
| `store-contract-expenses.ts` › MUT-280 | a row in a removed currency still round-trips untouched (VarChar(3)) |
| `src/scripts/__tests__/currency-rows.test.ts` (test:db, macOS `/bin/bash`) | count ignores soft-deleted rows, lists table, column, code and owner (`user:` for the inbox), exits 3; dry run previews and changes nothing; a referenced matter stops the run with blockers listed; soft-delete keeps a receipt valid; inbox cleared by `--user-id`; others untouched; bad or unknown id refused |
| Portal unit tests | pickers offer exactly USD, ILS, EUR, JOD; Gulf filters dropped; per-line derived flag with JOD + EUR |
| Release-QA | `portal.income.currency-jod`, `portal.expense-groups.currencies-converted` |


### MUT-389 — file a To-review receipt onto an existing expense; the library behind RECEIPTS_LIBRARY (2026-10-22)

| Test | Covers |
|---|---|
| `store-contract-receipts.ts` › fileOntoExpense (memory + Prisma) | filed onto the expense, version + 1, no expense created, nothing approved; a sent suggestion replaces the stored one; already filed (another expense or this one); unfinished upload; deleted, other-profile receipt; deleted, other-profile or missing expense; 10 READY refuse, a pending upload doesn't count; an earlier approval survives a re-file |
| `store-prisma-receipt-file-lock.test.ts` (test:db) | forced overlap under the expense row lock: a rival 10th receipt → `too_many_receipts`; an expense delete → `expense_not_found`. Both fail ("never waited") without the lock |
| `routes-receipts.test.ts` › POST /v1/receipts/{id}/file | AC1–AC4: 200 with `expense.receipts`, replay identical, 409 with `details.expenseId`, 404s, strict body 422, `ATTACHMENT_NOT_READY`, `TOO_MANY_RECEIPTS` equal to the MUT-44 answer, one `expense_receipt.filed` audit with `mode: 'existing'` and no `expense.created`, edit rate unchanged; 503 with no bucket; 404 for the whole library while `RECEIPTS_LIBRARY` is off |
| `routes-expenses.test.ts` | with the library off, deleting an expense takes its receipts and files (pre-MUT-255) |
| `config.test.ts` | `RECEIPTS_LIBRARY` off unless exactly `"true"`; `"false"` off; `1`/`yes`/`TRUE`/empty refused |
| `route-security`, `writability-routes`, `store-guard` | the new route is session-only and in the expenses domain (store-guard walks every `expenseReceipts` method) |
| Terraform `tests/receipts_library.tftest.hcl` | off by default with no `RECEIPTS_LIBRARY` env; on sets it to `"true"` exactly once |
| qa-reconcile additions (2026-10-22) | `store-contract-receipts.ts`: re-file keeps the earlier reading (D1, red before the fix); filed-onto receipt unlinked by delete; library receipts removed with the flag off; re-approval replaces an approval; concurrent file/file and file/approve (Prisma). `store-prisma-receipt-file-lock.test.ts`: filing commits before a waiting delete → unlinked; probe tied to the holder via `pg_blocking_pids`. `routes-receipts.test.ts`: 404 `details.reason`; flag-off covers all 11 library routes with real ids and `/openapi.json` |

## MUT-390 — GET /v1/entries by money date (2026-10-22, ADR-168)

| File | Kind | Tests | What it proves |
|---|---|---|---|
| `server/src/entries/__tests__/merge.test.ts` (changed) | Unit | +8 | money-date order by day, logged instant, id (future day on top); the cursor carries the day; `isBeforeMoneyDateCursor` at each tie level; `moneyDateOf` per kind; cursor codec round-trips, the default cursor unchanged, the other order's cursor and malformed ones 422 `cursor` |
| `server/src/repositories/__tests__/store-contract-entries.ts` (changed; memory + Postgres) | Contract | +4, +1 assertion | limit-2 walk across two profiles and four kinds equals the full list; `occurredFrom`/`occurredBefore` and `loggedSince`+`occurredBefore` walked with cursors; an edited-older expense shows again later (D3); exclusions hold under the money-date order |
| `server/src/__tests__/routes-entries.test.ts` (changed) | Route (memory store) | +7 | every kind by money day with a future expense on top, paged once each; profile narrowing; the filters; `loggedSince` with an offset; each refused combination 422 naming its field; bad order/day/instant 422; each order pages only with its own cursor |
| `server/src/repositories/__tests__/store-prisma-entries-plan.test.ts` (changed; test:db) | Query plan | +5 | each kind's money-date query uses its new index (first page, past a cursor, from a day, all bounds together in `Index Cond`); `loggedSince`+`occurredBefore` stays a `createdAt >=` range |
| `server/src/repositories/__tests__/store-prisma-entries-fanout.test.ts` (changed) | Unit (fake Prisma) | +1 | at most 4 queries in flight under both orders |
| review fixes (/qa-reconcile, 2026-10-22) | Unit + route + contract | +7 | the default order's malformed-cursor error is byte-identical to `pagination.ts`; a cursor instant past ±8.64e15 is 422; each store refuses the other order's cursor; `loggedSince` older than 31 days is 422 (31 accepted); offsets read as the instant they name; `loggedSince` alone filters and pages; the day filters apply to every kind by its own money date (memory + Postgres) |

## MUT-392 — future-dated Owed income and expenses (2026-10-22, ADR-169)

| File | Kind | Tests | What it proves |
|---|---|---|---|
| `server/src/income/__tests__/compose.test.ts` (changed) | Unit | +9 | `incomeMoneyDate` per kind at today, +1, the ceiling and one past it, the floor; `redateTo` by kind in the org's day; `dueDateAfterRedate` keeps or moves |
| `server/src/__tests__/income-routes.test.ts` (changed) | Route | +1 (split) | Received tomorrow 422 bound future; Owed +30 saves with EOM_15 due date; Owed ceiling day 201, day after 422 |
| `server/src/__tests__/income-redate.test.ts` (changed) | Route | +5 | Owed moves ahead and keeps a due date still after it; past the due date it moves (audit `dueFrom`/`dueTo`); no due change recorded otherwise; past the ceiling 422; unknown id with a future date 404, malformed 422 |
| `server/src/__tests__/inbox-filing.test.ts` (changed) | Route | +2 | filing a future entry as Owed works; as Received 422 bound future; an expense past the ceiling 422 like a direct create |
| `server/src/__tests__/routes-expenses.test.ts` (changed) | Route | +1 | create and PATCH refuse past the ceiling, accept the ceiling day |
| `server/src/repositories/__tests__/store-contract-capture.ts` (changed; memory + Postgres) | Contract | +1 | `redateAdjustment` with a dueDate moves both in one write |
| `server/src/summaries/__tests__/compute.test.ts` (changed) | Unit | +3 | a future Owed is out of buckets and project totals until its day, then by its due date; `countsOn` boundary |
| `src/hosted/components/__tests__/{incomeForm,incomeApiErrors,expenseApiErrors}.test.ts`, `format/__tests__/format.test.tsx` (changed) | Unit | +6 | the form rule by kind; future bound → "too far ahead" for Owed and expenses, "later than today" for Received/payments; ceiling and EOM_15 helpers |
| `src/hosted/components/__tests__/{RedateDrawer,IncomeCaptureDrawer,ExpenseDrawer}.test.tsx` (changed) | Component | +7 | date `max` per kind; due note moves; ceiling refused before a request; Received tomorrow refused; an expense date past the max reaches the server (noValidate) |
| `qa/specs/portal/{income,expenses}.spec.ts` | Release-QA | +3, 1 changed | `add-owed-future`, `redate-owed-future`, `redate-no-future` (payment), `date-too-far`; 30/30 income + expenses pass |
| `server/src/summaries/__tests__/compute.test.ts` (review) | Unit | 1 replaced, +1 | an Owed counts on its own day; an INSTALLMENT and a RETAINER_CHARGE posted ahead still count (bucketize and projectFigures); a future Owed with a payment, a credit or settled counts at once in posted, paid, credited and the buckets (D2) |
| `server/src/__tests__/income-redate.test.ts` (review) | Route | +6 | a settled Owed moves past today and keeps its payment; a part-paid Owed moved ahead still counts what is left; a future Owed is never PENDING, settles before its day and counts from that payment (D2); dueDate before occurredOn / past the ceiling 422; summaries: no row or block until its day, then it joins; audit test asserts its row |
| `server/src/__tests__/inbox-{routes,filing}.test.ts`, `inbox/__tests__/compose.test.ts` (review) | Route + unit | +3 | capture refuses past the lenient ceiling (UTC tomorrow + 3660), accepts the ceiling day; file-as-Owed refuses a dueDate before the entry date |
| `src/hosted/data/__tests__/incomeAffordances.test.ts`, `components/__tests__/{RedateDrawer,incomeApiErrors}.test.*` (review) | Unit + component | +1 | a part-paid Owed moves ahead in the re-date drawer (no cap at today, D2); `kind` required in the error mappers |


## MUT-387 — The Malafat OAuth client identity moves to mtb3a.com (2026-10-22, ADR-155 amendment)

| File | Kind | Tests | What it proves |
|---|---|---|---|
| `scripts/__tests__/no-hardcoded-hosts.test.ts` (changed) | Unit (node, repo scan) | +2, −1 | `RETIRED_HOSTS` (`mutaba3a.app`) appears in no code, test, script, Terraform or CI file, own-value files included (red on the old tree: 6 hits). The rehearsal that could not fail is deleted. Tripwire: `config/hosts.json` production domain equals `CIMD_CLIENT_ID`'s host, so a domain move must decide the identity's fate (review fix). One shared `findings(patternsFor)` scan |
| `scripts/__tests__/vite-config.test.ts` (changed) | Unit (node) | +4 | No `_redirects` rule at stages proxy/live/redirect covers `CIMD_CLIENT_ID`'s path, with the identity host as apex or as the legacy landing after a move; no forced `netlify.toml` rule covers it. A planted `/.well-known/*` legacy path fails it. The matcher reads a `from` as a site path or a full URL, `*` as a splat and `:name` as one segment; planted shapes (`/*`, an apex `/*` 301, `/.well-known/:file`) match and unrelated ones do not (review fix, red first) |
| `src/services/oauth/__tests__/cimd-document.test.ts` (changed) | Unit | +1 | `client_uri` and `logo_uri` share the `client_id` origin. The existing byte-equality case pins the fixed literal. |
| `scripts/__tests__/oauth-client-live.test.ts` (new) | Unit (node, fake fetch + clock) | 11 | The live check accepts the published document (charset and whitespace tolerated). It refuses a 3xx with its location, a non-200, a non-JSON content type, a non-JSON body, a mismatched `client_id`, and a stale copy. It waits through network errors until the deadline and checks once at 0 |
| `scripts/__tests__/check-bundles.test.ts` (changed) | Unit (node) | +3 | `originsNeedingReview` drops an origin only in its scoped file. `FILE_SCOPED_ORIGINS` scopes the identity origin to `.well-known/oauth-client.json`, which `public/` ships. `bundle-origins.json` does not list it bundle-wide |
| `src/services/oauth/__tests__/oauth-client.test.ts` (changed) | Unit | 0 | `CONFIG.clientId` is `CIMD_CLIENT_ID` (was a stale literal without `.json`) |

Run: `npx vitest run scripts/__tests__/no-hardcoded-hosts.test.ts scripts/__tests__/vite-config.test.ts src/services/oauth`; `npm run test:bundles` for the allowlist. **Not testable locally:** the live fetch. After `make release web`, run `curl -s https://mtb3a.com/.well-known/oauth-client.json | jq -r .client_id`.

## MUT-408 — portal Add income saves after a kind switch with More details open (2026-10-22)

| Test | Covers |
|---|---|
| `src/hosted/components/__tests__/IncomeCaptureDrawer.test.tsx` › MUT-408 (3) | Owed → More details → Received → Save posts Received with `method: CASH` and no Owed fields; Owed (what for + due date) → Received (Bank) → Owed posts the title and due date; Received (Bank) → Owed → Received posts `method: BANK`. Red before the keyed Due date / Method groups (`dueDate` or `method` dropped by the Controller rename) |
| Release-QA `@portal.income.switch-kind` | Receivables → + Add income (Owed) → 500, Client 1, More details → Received, Bank transfer → Save: drawer closes, "Saved · ₪500.00 received from Client 1", POST body `{kind received, 500.00, ILS, today, C1, BANK}` |

## MUT-362 — Self-service billing (2026-10-22, ADR-170)

| Layer | Where | Covers |
|---|---|---|
| Unit (server) | `server/src/billing/__tests__/checkout.test.ts` | every refusal in order (live statuses, unpaid D6, paused, no owned profile, Malafat, no-expiry grant D5, expiring grant allowed, consumer countries AC2, prices, malformed country); params (ILS/USD, three tax-ID variants, custom field optional/required, return URLs, `expires_at`, metadata), copy limits, `catalogFrom`, the shipped country file, `consumerCountryCheck`, return paths |
| Adapter (server) | `server/src/billing/stripe/__tests__/checkout-gateway.test.ts` | real SDK over a fake fetch: customer lookup order and idempotency key, Checkout and portal bodies, no-URL session, `resource_missing` not transient, one retry with the same idempotency key, price lookup + 10-minute cache (failures not cached), non-recurring prices skipped, tax-ID count |
| Route (server) | `server/src/__tests__/billing-routes.test.ts` | GET shapes (trial, subscription, unconfigured, Stripe failing on prices); POST checkout (customer made with the person's id and audited, linked customer reused, 409 reasons, 422 country/return path/body, 503 prices/not configured, 502, `BILLING_ACCOUNT_NEEDS_HELP` warn, 10/min); POST portal (redirect + audit, `NO_BILLING_ACCOUNT`, deleted customer, 502); admin `countryCheck` |
| Store contract | `store-contract-billing.ts` (memory + Prisma) | `summaryOf`: trial start, linked account, subscriptions latest first; never an unlinked or another person's account |
| Sync / CLI / security | `sync.test.ts`, `users-cli.test.ts`, `route-security.test.ts` | a Checkout-made subscription on our customer links and covers; `billing-status` CHECK line; the three routes session-only and refused to API keys |
| Portal unit | `data/__tests__/billingView.test.ts`, `countries.test.ts`, `filters.test.ts` | every panel and action, open soon, DR3 list, checkout route, currency, computed saving, days left; country order and the Palestine name; the `billing`/`step`/`checkout` URL keys |
| Portal component | `components/__tests__/BillingDrawer.test.tsx` | menu → URL, status first with focus, both prices, open soon, covered by grant, load error + retry, Arabic; Subscribe step (no default country, ILS, saving label, POST body, redirect), contact us vs business, Palestine + back, session failure keeps choices; return confirming → subscribed, cancelled; Manage billing, ending, unpaid, deleted customer |
| Release-QA | `portal.billing.open-soon` (stubbed); `portal-live.billing.subscribe`, `subscribe-usd`, `business-only`, `manage`, `manage-ended`, `rtl-375` (Stripe sandbox, D8 B) | all seven pass 2026-10-23 (the six live ones in one recorded run at ad1d5d97); Checkout pays through the API behind Stripe's hCaptcha (TD-201) |
| Mirror (server) | `server/src/billing/stripe/__tests__/mirror.test.ts` | a Customer Portal cancel (`cancel_at` on or before the period end) reads as ending; past the period it renews; none is not ending |

### MUT-362 — the /qa-reconcile review fixes (2026-10-23)

| Layer | Where | Covers |
|---|---|---|
| Unit (server) | `checkout.test.ts` | `currentSubscription` (live first, stale live rows never shown); stale rows don't refuse, unpaid always does; `trial_end` carried at ≥ 48 h only; `adaptive_pricing` off |
| Adapter (server) | `checkout-gateway.test.ts` | Stripe's own subscriptions; expiring open Checkouts; sellable prices only (tier, VAT-exclusive, interval count 1); failure cache and one call in flight; idempotency key follows email and name; tax IDs + invoice tax number; writing it |
| Route (server) | `billing-routes.test.ts` | live subscription over a later cancelled one (proven red on the old route); `coveredProfileIds` for a creator and a co-owner; Stripe's live subscription refuses; a second Checkout expires the first; trial carried; Malafat refusal before Stripe; stale row; permanent errors → NEEDS_HELP at error level; non-customer `resource_missing`; best-effort audit; cross-site 403 on both POSTs; portal shares the limit; the IL/JO tax number clears D9 |
| Sync (server) | `sync.test.ts` | the Checkout tax number is copied to the customer's invoices; a failed copy is an error |
| Portal | `billingView.test.ts`, `billingQueries.test.ts`, `BillingDrawer.test.tsx`, `Button.test.tsx` | pending panel; paid-entitlement manage; `isConfirmed`; `firstChargeOf`; return paths and the Stripe-only redirect; focus and one live region per phase; slow hides Subscribe and stops at 30 s (fake timers); portal return stops at 30 s; DR6 note under Manage billing; failures under their button; refusal copy and refresh; co-owner note; step Back replaces history; busy button keeps label and focus |

## MUT-150 — landing error reports (2026-10-24, ADR-091 am.12)
- Unit: `src/pages/landing/observability/__tests__/landingErrorReporting.test.ts` (no DSN, non-website routes never start, load only after load + idle, queue cap and order, rejections, "Script error." ignored, boundary hold and direct, no forwarding after handover, path guard drops held errors, chunk failure silent, start once); `landingSentry.test.ts` (real SDK + recording transport: surface, route template, locale, release, no user, path-only URL, component stack, scrubbed form values, path guard at send, cap of 5, ignored errors don't count); `LandingCrashScreen.test.tsx` (Arabic default, English, reload, reports once); `marketingPath.test.ts` (`landingRoute`); `afterLoadIdle.test.ts`.
- Build and guards: `vite-config.test.ts` (no DSN → off, no chunk, no plugin; DSN → on + named chunk + dev pre-bundle; desktop always off; EU host only; release from `COMMIT_REF`; environment from `CONTEXT`; production without token fails; precache ignores; portal cases unchanged); `check-bundles.test.ts` (landing chunk names, SDK outside them fails, precached Sentry fails, origins scoped to the chunks). Real builds: with a QA DSN `check-bundles --dist dist-web` passes; without one dist-web has no Sentry file.
- Privacy: `PrivacyPolicyPage.test.tsx` (website sentences en/ar; "fails to load" absent).
- Release-QA: `web.error-reports.{landing-crash-reported, landing-crash-reported-ar, download-and-terms-covered, app-routes-silent, landing-crash-screen}` and `web.legal.privacy-error-reports`, all passing 2026-10-24.
- Manual: the Netlify production build (upload + guard with the real DSN) and the live console smoke, in `server/DEPLOYMENT.md` §1.5 step 9.

## MUT-149 — portal crash reports (2026-10-23, ADR-091 am.11)
- Unit: `src/lib/observability/__tests__/browserSentry.test.ts` (contract options, `dataCollection`, scrub on send and breadcrumb, lazy tags, drop hook); `src/hosted/observability/__tests__/errorReporting.test.ts` (no DSN, local never loads, remote loads once, queue cap and order, signed-out discard, SDK owns window errors after load, stop and restart, chunk failure swallowed); `portalSentry.test.ts` (the real SDK with a recording transport: ApiError via window dropped, via boundary kept with `request_id`, user id only, locale at send time, route template, setup token never sent, nothing after stop); `crashScreens.test.tsx` (inline card with the nav, frame crash full page, reported once, focus, Tab, ar/en); `LastResortBoundary.test.tsx`; `endSession.test.ts` (user cleared).
- Build and guards: `scripts/__tests__/vite-config.test.ts` (DSN only on the org host, release and environment, hosted-only defines, maps only with DSN + token); `check-bundles.test.ts` (markers, entry graph, fixtures and tokens, `.map`, DSN origin); `hosted-lint.test.ts` (SDK only in `portalSentry.ts`, shared module imports only the contract and scrubber). `npm run test:bundles` with a DSN passes; a build without one emits no Sentry chunk (checked 2026-10-23).
- Server: `portal.test.ts` (CSP pins with the ingest host, `.map` 404 even when the file exists).
- Privacy: `PrivacyPolicyPage.test.tsx` (portal sentence en/ar; phone and PostHog sentences kept).
- Release-QA: `portal.error-reports.{crash-reported, crash-reported-ar, handled-api-error-not-reported, signed-out-silent, crash-screen}` and `web.legal.privacy-error-reports`, all passing 2026-10-23.
- Manual: deploy.sh's DSN-without-token stop and the Makefile's Keychain fallback (no shell harness; `make -n release-server` shows the token never printed). The first release's console smoke is in `docs/operations/before-release.md`.

## MUT-359 — transactional mail through Resend (2026-10-23, ADR-174)

| Layer | Where | Covers |
|---|---|---|
| Unit (server) | `server/src/email/__tests__/templates.test.ts` | every template in en and ar; RTL/LTR html; no image, style, script or foreign link; links in text and in `<bdi dir="ltr">`; no amount, currency or date; escaping; non-http link refused; first-set vs changed wording; Arabic hour agreement |
| Unit (server) | `svix.test.ts` | Svix's published vector; wrong secret, body, id, timestamp; ±5 min; rotation lists; other versions; missing headers; malformed secret |
| Adapter (server) | `resend-transport.test.ts` | exact body keys (no tracking, tags or headers), reply_to optional, headers incl. Idempotency-Key; 429/4xx/5xx mapping; timeout; network; 2xx without id |
| Unit (server) | `mailer.test.ts`, `password-notice.test.ts` | each template × language through the memory outbox; duplicate key; suppression spends no cap; unowned domain and non-plain addresses refused; the 501st mail capped with an error log and a day later allowed; security reserve; per-recipient cap (warn); provider failure logged and retryable; 429 logged apart; noop warns once; caller bug throws; the notice never throws |
| Store contract | `store-contract-email.ts` (memory + Prisma) | suppression first-wins; claim/duplicate; FAILED and stale PENDING re-claimed; global and recipient caps; FAILED not counted; concurrent claims → one; prune |
| Route (server) | `routes-email-webhook.test.ts` | signed hard bounce suppresses (normalized) and the mailer then refuses; complaint; transient, other events and other domains ignored; unsigned, mis-signed and replayed → 401, nothing written; redelivery; non-event body; 503 unconfigured; failed-signature rate limit; published as public |
| Route (server) | `routes-password-notice.test.ts`, `dev-outbox.test.ts` | redeem (first, Arabic), reset link and `POST /v1/me/password` each mail one notice; a failing provider changes neither answer; no mailer = unchanged behaviour; outbox admin-only, filtered, unpublished, absent without memory |
| Config / scripts | `config.test.ts`, `email-check.test.ts`, `release-guard.test.ts` | defaults and every refusal; DNS and API modes of email:check (stubbed); `guard_mailer_release` paths and deploy.sh wiring |
| Pins | `no-self-registration.test.ts`, `route-security.test.ts` | the public operations now include `POST /v1/email/resend/webhook` |
| Terraform | `terraform/tests/email.tftest.hcl`, `frontdoor/tests/frontdoor.tftest.hcl` | noop default mounts nothing; resend mounts secrets, sender from hosts, reply-to, cap, alerts; resend without a domain or cap fails; `log` not offered; DNS records only with a DKIM value, DNS only, rua optional, region moves the MX |
| Release-QA | none: server-only, no user-visible flow (`server/src/**` is outside every app's watch). MUT-368's `signup.*`/`recover.*` specs will read `GET /admin/v1/dev-outbox` | — |
| Live (deferred) | DEPLOYMENT.md §6f step 8 | a real mail reaches Gmail and Outlook inboxes in both languages: at Basel's end-of-run go-live |

## MUT-366 — signup and recovery routes (2026-10-23, ADR-176)

| Layer | Where | Covers |
|---|---|---|
| Unit (server) | `server/src/auth/__tests__/self-service.test.ts` | the policy numbers; `signupLinkState` (held address → used; used/superseded/expired order); `recoveryPurposeOf` (disabled, RESET, never-set SETUP, locked RESET); `signupAccountOutcome`; display-name default; the floor waits and reports overshoot |
| Unit (server) | `turnstile.test.ts`, `rate-limit.test.ts` | test secrets answered locally (pass/fail/spent, no fetch); siteverify body (secret, response, remoteip, idempotency key), timeout signal; fails closed on success:false, other action, non-200, bad JSON, network error, timeout, empty token; hour and day windows and pruning |
| Store contract | `store-contract-signup.ts` (memory + Prisma) | issue binds to the address and supersedes; duplicate digest; redeem creates one user + personal profile + membership + trial + verified address + terms + audit; no-trial variant; refusals write nothing (second use, expiry instant, cancelled, unknown, person link, operator create meanwhile); concurrent redeems of one link and of two links → one account; a later link can't make a second; mailed person link verifies, operator link doesn't; prune only stale unredeemed SIGNUP links |
| Migration | `migration-mut366.test.ts` (test:db) | applies in one transaction (enum value + CHECKs), keeps existing links, refuses each bad shape, matches the schema |
| Route (server) | `routes-self-service.test.ts` | A1 new/existing/suppressed: same status, body, ≥ floor, outbox differs; A2 check + redeem creates exactly one account with trial, terms and audit, no session, no notice, sign-in works, second use 410 used; 422 without currency; stale terms 409 before creating; concurrent redeems and superseded link; operator create meanwhile → 410 used; disabled address no mail; A3 recovery changes nothing until used, then revokes sessions, clears the lockout, verifies the address, notice sent; never-set account gets SETUP; disabled/unknown/suppressed same answer and no mail; A4 missing (422) / empty / failed check (403) sends nothing; IP 429 shared; address 429 with or without an account, not spent by a failed check; day limit; A5 switch off 404 and recovery works; cross-site 403; malformed 422 at once; failing provider still 202 |
| Config | `config.test.ts` | floor defaults and bounds; test secret default outside production; production refuses a test secret and a missing one with mail on |
| Pins | `no-self-registration.test.ts`, `route-security.test.ts`, `store-guard.test.ts`, `routes-m*.test.ts` | the two public operations as reviewed exceptions; signup 404 while off; the new store methods operator-only; API 1.55.0-mut366 |
| Terraform | `terraform/tests/email.tftest.hcl` | Turnstile secret and grant exist empty; `SELF_SIGNUP_ENABLED=false` by default; mounted with resend; signup on needs resend |
| Code review fixes | `routes-self-service.test.ts` "code review fixes", `store-contract-signup.ts`, `turnstile.test.ts`, `config.test.ts` | #1 the Turnstile key is never the client's `X-Request-Id`; #2 recovery leaves the operator link valid, redeeming one supersedes the other (store: mailed cancels mailed only, operator cancels all); #3 a 600 ms provider doesn't hold the answer past the floor; #4 a store failure on either branch answers 202 after the floor; #5 no or empty action fails; #6 staging with resend needs a secret |
| Local snapshot | `src/hosted/local/__tests__/{format-fingerprint,migrations}.test.ts` | `people.emailVerifiedAt` in the fingerprint (fixture verifies an address through a mailed link); 3 → 4 adds it as null |
| Release-QA | none: server-only. MUT-368's `signup.*`/`recover.*` portal specs drive these routes through `GET /admin/v1/dev-outbox` | — |
## MUT-340 — receivedCount on Received captures (2026-10-23, ADR-176)
- Route: `src/__tests__/income-routes.test.ts`: counts 1, 2, 3; an undone capture drops out; Owed has no count; an Idempotency-Key replay answers the stored count; Malafat's own payments count; the entries feed never carries it.
- Store contract (memory and Postgres): `src/repositories/__tests__/store-contract-capture.ts`: count after each capture, after an undo, per organization; four parallel captures get four different counts (proved on Postgres on a scratch database).
- OpenAPI: `npm run openapi:check` with `IncomeCaptureResponse`.
- Release-QA: the phone's `ios.capture.milestone-*` flows (mutaba3a-flutter) cover it end to end.

## MUT-339 — logging streak and capturedAt (2026-10-23, ADR-177)
- Unit: `src/expenses/__tests__/streak.test.ts`: runs and gaps, alive through yesterday, previous (3+ days, within 7), DST midnight, the 48 h clamp.
- Route: `src/__tests__/streak-routes.test.ts`: any entry counts (S1); deleted and undone don't; the 23:50-offline case counts on its day (S4); an old capturedAt is clamped; 409 NOT_PERSONAL on business and firm; no API key.
- Store contract (memory and Postgres): `store-contract-entries.ts` loggedDays: zone shift, live rows only, conversions out, the since bound, Owed counted.
- Inventories: `route-security`, `writability-routes`, `routes-expenses`.
- Release-QA: the phone's `ios.capture.streak-*` flows (mutaba3a-flutter).

## MUT-367 — business-email screen and the signup review queue (2026-10-23, ADR-178)

| Layer | Where | Covers |
|---|---|---|
| Unit (server) | `email/domains/__tests__/lists.test.ts` | each list parses, is sorted, has no duplicates and names source/commit/fetched/licence; no domain on two lists; gmail/outlook/mailinator/privaterelay pinned; a bad line throws; parent matching on a label boundary |
| Unit (server) | `email/domains/__tests__/screen.test.ts` | the business rule (MX + apex or www + ≥ 90 days, exactly 90); `rdap-age-12d`; no-mail only on null MX or none+none, A-record fallback; DNS failure never refuses; every reason once; the screen's fixture outcomes (disposable incl. subdomain, no-mail, business, webmail, young, relay, timeout, unlisted); lists never reach the checker; a throwing checker means review; cache 24 h / 10 min / size bound |
| Unit (server) | `email/domains/__tests__/dns-checker.test.ts` | fake resolver + fetch: MX/apex/www/RDAP date, RDAP straight to the registry with `redirect: 'error'`; null MX; ENODATA = none; SERVFAIL/REFUSED/ECONNREFUSED/ETIMEOUT = unknown; unsupported TLD, registry 503, no date; the budget stops everything and cancels the resolver; the bootstrap is read once |
| Unit (server) | `scripts/__tests__/email-domains-update.test.ts` | the same commit gives the same bytes; sorted, de-duplicated, lower-cased, webmail/relay excluded, header names the commit; a branch name or no commit is refused; fetches the pinned URL and writes |
| Unit (server) | `auth/__tests__/self-service.test.ts` | `signupAccountOutcome` BUSINESS → ACTIVE + trial; WEBMAIL/UNVERIFIED → PENDING_REVIEW, no trial, review; unclassified link → review; `recoveryPurposeOf` PENDING_REVIEW → RESET |
| Unit (server) | `email/__tests__/review-digest.test.ts` | idle with nothing waiting; one per UTC hour (same-hour duplicate, next hour counts both); outside the per-recipient cap; no operator address = idle; the sweep timer offsets |
| Store contract | `store-contract-signup-reviews.ts` (memory + Prisma) | the pending redeem writes its review; the list is oldest first with the person, and pages; approve opens, starts the trial and audits, then `already_decided`; not_found; decline after a used recovery link deletes user, profile, every link and the SIGNUP rows, keeps the review without a person, and the address can sign up again; a grant makes it `not_empty` with nothing deleted; concurrent approve and decline decide once; digest facts and `markNotified` |
| Store contract | `store-contract-signup.ts` | the token round-trips `domainClass` / `domainReasons` |
| Migration | `migration-mut367.test.ts` (test:db) | the two migrations are consecutive and each applies in one transaction; an old SIGNUP link keeps a null verdict; CHECKs refuse a person link with a verdict, a decision without its time, and an open review without a person; one review per user; matches the schema |
| Route (server) | `routes-signup-review.test.ts` | S1 disposable / S2 no-mail → 400, no mail; S3 business → ACTIVE + trial + sign-in; S4 gmail → PENDING_REVIEW, under-review mail, a digest; S5 young (`rdap-age-12d`) and relay; D8 account-exists for a pending holder; S6 403 on cookie and device, no session, no failure counted; S7 wrong password = unknown (status, body, one verify each, both wait on it); S8 locked → 401; S9 recovery works and still 403; the queue lists with reasons, needs the admin token; S10 approve (trial, ready mail with sign-in link, audit, sign-in 201); S11 409 ALREADY_DECIDED, 404 unknown; S12 decline (account and profile gone, declined mail with support address, sign-in 401, 404 after); S13 sign up again; D11 enable/disable 409; D16 Me.user.status |
| CLI | `scripts/__tests__/users-cli.test.ts` | `signup-reviews` lists, approves and declines by address, refuses both flags and a second decision |
| Config | `config.test.ts` | `EMAIL_DOMAIN_CHECKER` defaults (fixture / dns in production) and refuses the fixture in production |
| Pins | `store-guard.test.ts`, `routes-m*.test.ts`, `routes-account-setup.test.ts`, `routes-self-service.test.ts` | the six new store methods operator-only; API 1.57.0-mut367; the redeem's `status` |
| Release-QA | none: server and operator only. MUT-368's `signup.review-webmail` (core), `signup.review-declined`, `signup.business-instant`, `signup.disposable` and `signup.no-mail-domain` drive these through the dev outbox and the admin routes (design §6) | — |


## MUT-368 — the portal's signup, recovery and under-review screens (2026-10-24, ADR-179)

| Layer | Where | Covers |
|---|---|---|
| Unit (portal) | `pages/auth/__tests__/selfService.test.ts` | every refusal row: 404 closed; EMAIL_NOT_ACCEPTED disposable / no-mail / other; CHECK_FAILED; 422 email vs other fields; 429 minutes; unreachable; `waitFor` minutes then hours |
| Unit (portal) | `components/turnstile/__tests__/{loadTurnstile,useTurnstile}.test.ts(x)` | one script, explicit render with `onload`; a failed or silent load rejects and retries; render gets action, language, site key, theme; token/expired/timeout/error map to statuses; reset spends the token; a language switch renders again; unmount removes |
| Component (portal) | `pages/auth/__tests__/SignupPage.test.tsx` | the form (focus, ltr email, terms line), the body sent (trimmed email, locale, token); Arabic by default; Send again after 60 s with the email kept; disposable / no-mail inline with a fresh check; a refused check; a limit in minutes and hours; malformed email; a press before the token waits (D15); a widget that can't run; a 404 POST; closed doors; a doors outage with Try again; a signed-in visitor goes Home |
| Component (portal) | `pages/auth/__tests__/RecoverPage.test.tsx` | the body and action; the one answer; a limit; mail off says who can help (D14); Arabic RTL with the address in `<bdi>` |
| Component (portal) | `pages/auth/__tests__/SignInPage.test.tsx` | the doors by what the server says (both, recovery only, none, no answer); 403 under review and its Sign out; a wrong password is still the usual refusal |
| Component (portal) | `pages/auth/__tests__/SetupPage.test.tsx` (+11) | SIGNUP copy and fields; currency/timezone sent, blank name left out, typed name trimmed; lands on the personal profile; PENDING_REVIEW without sign-in; sign-in 403; Sign out ends another person's session; a refused timezone; dead links offer /signup or /recover only when open; a 410 keeps the form's purpose |
| Unit (portal) | `session/__tests__/firstRun.test.ts`, `local/__tests__/argon2Stub.test.ts`, `api/__tests__/client-mode.test.ts` | the personal profile's path; the stub throws; signup/recovery/doors always go to the server, with no probe |
| Build | `scripts/__tests__/check-bundles.test.ts`, `vite-config.test.ts`, `src/styles/__tests__/direction.test.ts` | the self-service words are allowed and invite/دعوة still caught; the site key's default and shape (a secret fails the build); argon2 aliased in the hosted build only; the new `dir` sites |
| Route (server) | `routes-self-service.test.ts`, `routes-account-setup.test.ts`, `routes-users.test.ts`, `portal.test.ts`, `no-self-registration.test.ts`, `route-security.test.ts` | `GET /v1/self-service` for every switch/mail combination, public, no-store; a dead link's purpose (and none for an unknown token); the CSP; the public-operation pins |
| Release guard | `server/src/scripts/__tests__/release-guard.test.ts` | `guard_turnstile_site_key`: any key with mail off; a real key with resend; refuses unset/empty/test keys with resend; refuses rather than guess; wired before the bootstrap and the portal build |
| Release-QA | `qa/specs/portal-selfservice/{signup,recover}.spec.ts` (live API, built portal, real CSP) | signup.create (core, ar + en), existing-email, expired-link, check-refused, disposable, no-mail-domain, rate-limited, closed, business-instant, review-webmail (core, en + ar), review-declined, 375; recover.reset (core), unknown, pending-account: 17 tests, all passing recorded |

## MUT-369 — Landing signup CTA, portal `?lang`, privacy-policy draft (2026-10-24, ADR-186)

| Layer | Tests | Command |
|---|---|---|
| Landing unit | `pages/landing/__tests__/signupDoor.test.ts` (10): open only on `signup: true`; closed on 5xx, bad JSON, wrong shape, network error, 3 s timeout; CORS-simple request (no credentials, no headers, no-store); one request per page; `?lang` on the href; hook null without a portal URL | `npm run test:run` |
| Landing pages | `LandingPage.test.tsx` MUT-369 block (8): open → hero, bar, Get it first option, phone link, FAQ a1, Arabic `?lang=ar`, no price/checkout/banned words; closed, unreachable, 503 → today's page | same |
| Privacy | `PrivacyPolicyPage.test.tsx` MUT-369 block (7): section order, Turnstile/DNS/RDAP/Resend facts, sharing and network lines, TD-219 sentence, MTB3A in English, Arabic; `hostedOfferKeys.test.ts` (2): same privacy keys in en/ar, open-state keys filled; `brandName.test.ts`: no privacy exemption | same |
| Portal | `lib/i18n/__tests__/linkLanguage.test.ts` (4), `hosted/i18n/__tests__/HostedLanguageProvider.test.tsx` (+3): link language beats default and stored choice, never stored, switch still stored; `?lang` stripped, other params and hash kept | same |
| Server | `routes-self-service.test.ts` (+2): doors GET has ACAO `*` and no allow-credentials; signup and recovery have none | `npm --prefix server test` |
| Release-QA | `web.landing.signup-open`, `web.landing.signup-closed`, `web.legal.privacy-signup` (recorded, passing; `qa/runs/MUT-369/`) | `release-qa run --app web --only …` |

## MUT-175 — Portal Reports (2026-10-24, ADR-189)

| Layer | Tests | Command |
|---|---|---|
| Server unit | `summaries/__tests__/activity.test.ts` (13): day/month buckets zero-filled, REVERSED excluded, currencies apart (JOD 3 digits), categories and clients order, 12-month history with a partial month, dataSince; days to paid: median vs outlier, n=2 → null, partial-then-full counts once from the last payment, open and reversed skipped, clamp at 0, per-client n ≥ 3 | `npm --prefix server test` |
| Server routes | `__tests__/routes-activity.test.ts` (7): per day and currency, days to paid through real settles, month buckets + earlierData, empty profile, org-timezone today, 422s, key refused; route-security, writability and portal-routes-coverage inventories | same |
| Store contract | `store-contract-m4.ts` `listAllocationsFor` (IN read, other org's ids, empty list), memory + Prisma | `npm --prefix server run test:db` |
| Local parity | `src/hosted/local/__tests__/parity.test.ts` Reports script (day + month + 422) | `npm run test:run` |
| Portal unit | `data/__tests__/reports.test.ts` (18): week starts en/ar, month/year ranges, stepping across year ends and bounds, 7th/8th-day stages, unlock month, combine (per currency, aligned buckets, categories by name, clients per profile, weighted days), chart bars and shares, D3 units; `reportInsights.test.ts` (12): every threshold above/below, recap, ranking, cap, rotation; `filters.test.ts` parseReports; `analytics/__tests__/reportViewed.test.ts` (debounce, signed out sends nothing) | `npm run test:run` |
| Components | `DayBars.test.tsx` D5 contract (one bar per day, describe text, dot, gaps, selection, fills, jump vs spring) + second series and future days; `CategoryBars.test.tsx` contract + plain rows; `components/reports/__tests__/reportsComponents.test.tsx` (CountUp reduced motion, controls RTL arrows, Year lock, steps, switch); `pages/__tests__/Reports.test.tsx` (15): nav, first run, stage 1/3, Year lock, chart, insights stay while stepping, ≈ breakdown, missing rate, All profiles, failed profile + Retry, DS5 teaser, 403, error card, Arabic | same |
| Analytics contract | `scripts/__tests__/analytics-taxonomy.test.ts` (v2.2.0 pinned) | same |
| Release-QA | `@portal.reports.*` (10): first-run, first-month, third-month, converted-breakdown, period-step, all-profiles-switch, profile-fails, teaser-suggests-switch, arabic (375 px), signed-out; plus `@portal.expense-groups.*` before and after the DayBars change (D5) | `release-qa release --only portal.reports` |

## MUT-419 — Trial reminder mails (2026-10-24, ADR-184)

| Layer | Tests | Command |
|---|---|---|
| Server unit | `billing/__tests__/trial-mail.test.ts` (22): stage table + daily-run rounding (R3); a 33-day daily walk sends exactly three mails in order (A1); same day twice → duplicate (A2); skips paying (trialing, active, lapsed), covered (user grant, own profile's org grant, Malafat), suppressed, other-profiles (operator firm, covered firm); PENDING_REVIEW/DISABLED/no trial absent; en/ar (A3); dry run; mail off then on; gate off; time budget on its own clock | `npm --prefix server test` |
| Templates | `email/__tests__/templates.test.ts`: the three new ids in the per-template table (en/ar, RTL, only passed links, no amount/currency/date), "within N days" + Arabic day agreement, links per mail (A3) | same |
| Server routes | `__tests__/routes-trial-mail.test.ts` (9): job counts only, A2 over HTTP, token checks, 503 without Stripe, gate off, PORTAL_ORIGIN links; admin dry run/real run, loopback refusal; `scripts/__tests__/users-cli.test.ts` (2): `billing-trial-mail [--dry-run]` | same |
| Store contract | `store-contract-billing.ts` `trialMailCandidates` (window bounds, ACTIVE only, order), memory + Prisma | `npm --prefix server run test:db` |
| Terraform | `tests/trial_mail.tftest.hcl` (4): no job by default, without Stripe, with the gate off; one daily job with the token when all on | `terraform init -backend=false && terraform test` |
| Release-QA | None: server only, no screen. The acceptance criteria are proven by the tests above (brief §8) | — |

## MUT-418 — Trial start step, Home trial banner, consumers everywhere (2026-10-24, ADR-180)

| Layer | Tests | Command |
|---|---|---|
| Server unit | `billing/__tests__/trial-prompt.test.ts` (resolve, first answer wins, snooze); `billing/__tests__/checkout.test.ts` (`"*"`, business always proves it is one, D9 flag under `"*"`) | `npm --prefix server test` |
| Server routes | `routes-sessions.test.ts` (PATCH /v1/me/trial-prompt: both sessions, device, 422s, CSRF/key/401, no audit); `billing-routes.test.ts` (`consumerEverywhere`, a person in JO gets Checkout); `users-cli.test.ts` (no D9 flag under `"*"`); `route-security`, `portal-routes-coverage` | same |
| Store contract | `store-contract-users.ts` (memory + Prisma via test:db): `updateTrialPrompt`, concurrent answers keep one | `npm --prefix server run test:db` |
| Portal unit | `data/__tests__/trialPrompt.test.ts`, `session/__tests__/firstRun.test.ts`, `data/__tests__/billingView.test.ts` (activeTrial, `isSellable`, consumers everywhere), local `migrations.test.ts` (4 → 5) + fingerprint | `npm run test:run` |
| Portal integration | `components/__tests__/TrialWelcome.test.tsx`: step (open, Not now, close, Add a card → Subscribe by replace, open-soon, never for answered/paid/<48 h, Arabic, no reopen after /setup's link), banner (Add a card, hide, last 3 days, gone when paid, no card when unsellable), `/` keeps drawer keys | same |
| Release-QA | `portal-live.billing.trial-start` (core), `.trial-banner`, `.consumer-everywhere`, and the amount updates in `.subscribe`, `.subscribe-usd`, `.rtl-375`; `portal-selfservice.signup.*` pass through the step's open-soon variant | `release-qa run --attach --only portal-live.billing` (env: `node qa/support/billing-live.mjs`) |

## MUT-291 — the carry-over from the old web app and the old address (2026-10-24, ADR-185)
- Unit: `src/lib/carryOver/__tests__/protocol.test.ts` (23); `src/hosted/local/carryOver/__tests__/mapFreeAppBackup.test.ts` (34); `replay.test.ts` (rate limit, refusals, progress, gate); `src/hosted/local/__tests__/createLocalApp.test.ts` (rate-limit option); `scripts/__tests__/vite-config.test.ts` (carry-over origins); `src/hosted/local/carryOver/__tests__/money.test.ts` (retired currencies), `totalsGate.test.ts` (E4 refuses through `prepareFromBackup`); `src/hosted/pages/carry-over/__tests__/carryOverCopy.test.ts` (every report code has copy in both languages); `src/db/__tests__/backup.test.ts` (strict read); `src/db/__tests__/carryOverBackupVersion.test.ts`, `datasetCountRecords.test.ts`.
- Integration: `src/db/__tests__/carryOver.integration.test.ts` (T-I1 the free app's own demo + CSV data, T-I5 twice); `src/hosted/local/carryOver/__tests__/backend.test.ts` (T-I3, T-I4 through the real local backend).
- UI: `src/hosted/pages/carry-over/__tests__/carryOverPages.test.tsx` (11); `src/pages/carryOver/__tests__/CarryOverScreen.test.tsx` (7); `local-mode.test.tsx` (Restore reads the old backup).
- Guards: `server/src/__tests__/legacy-redirect.test.ts` (no COOP on either page); `scripts/__tests__/netlify-no-coop.test.ts`; `scripts/__tests__/check-bundles.test.ts` (the carry-over code under HOSTED_RULES and LOCAL_RULES); `npm run test:bundles` passes.
- Perf (off by default): `replay.perf.test.ts`, `CARRY_OVER_PERF=1`: 20,000 records, 4.3 s, heap +149 MB.
- Release QA: app `carry-over`, `qa/features/carry-over/carry-over.yaml`, 7 features, `qa/specs/carry-over/carry-over.spec.ts` 7/7 passing (2026-10-24).
- Not covered: a real cross-host run (run.app or netlify.app to app.mtb3a.com) on a real browser: the operator's day-7 check (plan §6). Real iOS standalone: stubbed in QA.

## MUT-396 — local-disk attachment storage for the dev server (2026-10-24)

| Layer | Tests | Command |
|---|---|---|
| Server unit | `attachments/__tests__/local-storage.test.ts`: round trip, signed download, expiry on the injected clock, tampered/foreign-secret tokens, action binding, Content-Type, Content-Length and streamed size caps, aborted upload, concurrent PUTs, key traversal, idempotent remove, missing download | `npm --prefix server test` |
| Server routes | `__tests__/routes-dev-attachments.test.ts`: expense receipt and library receipt start → PUT → complete → download same bytes on a frozen clock; complete before bytes and an oversized PUT; expiry on the app clock; the probe; not mounted without the driver; never the portal fallback | same |
| Config | `__tests__/config.test.ts`: default dir under server/, local in development/test, refused in production and staging, local + bucket, gcs without bucket | same |
| Release-QA (phone) | `ios.privacy.receipt-cleanup` without its stand-in, asserting READY and the downloaded bytes (lands after MUT-124); Flutter `qa.config.mjs` checks `GET /dev/attachments` | `release-qa release --only ios.privacy.receipt-cleanup --wait` (mutaba3a-flutter) |

## MUT-397 — receipt completion under the expense lock (2026-10-24)

| Layer | Tests | Command |
|---|---|---|
| Store contract | `store-contract-receipts.ts` `completeOnExpense`: completes, already_ready, receipt_not_found (other expense, deleted), expense_not_found (other profile, missing, deleted with unlink and remove), cap with pending uploads not counted, two concurrent completions (Prisma) | `npm --prefix server test` + `test:db` |
| Prisma lock | `store-prisma-receipt-complete-lock.test.ts`: completion queued behind a filing's 10th place, two completions queued with one place, completion queued behind a delete; mutation without the lock fails all three | `test:db` (private DB) |
| Routes | `routes-expenses.test.ts`: the eleventh refused at completion though its start had room, idempotent at the cap, 404 after a delete | `npm --prefix server test` |

## MUT-254 — vendors (2026-10-24, ADR-183)

| Layer | Tests | Command |
|---|---|---|
| Unit | `vendors/__tests__/keys.test.ts`: case, spacing, ASCII and Arabic punctuation, Arabic letter forms, tashkeel/tatweel, legal suffixes (Latin, Hebrew, Arabic), leading "the" only, never empty, registration digits (Arabic-Indic, Extended), scorer order | `npm --prefix server test` |
| Store contract | `store-contract-vendors.ts` (memory + Prisma): one vendor per name however written, per profile; Arabic folding; blank → none; number first with alias; no merge; fill never overwrites; concurrent first sightings → one; touch (Other, other profile's category, null, no version bump); type change clears defaults; search ranking and recent; expense link through update | `test` + `test:db` |
| Prisma | `store-prisma-vendor-lock-order.test.ts` (touch waits on the category before the vendor row); `store-records-export-parity.test.ts` (vendors, vendorNames) | `test:db` (private DB) |
| Routes | `routes-vendors.test.ts`: four writers link, alias via vendorDetails, PATCH re-link/unlink/leave, refused writes move no default, Other skipped, typeahead in ar/he/Latin, recent, isolation, limit, Malafat's key 403 | `npm --prefix server test` |
| Backfill | `scripts/__tests__/backfill-vendors.test.ts`: --dry writes nothing; oldest-first canonical name, last-used, default not Other, no version bump, idempotent; re-link and unlink of old-revision rows | `test:db` |
| Local mode | `migrations.test.ts` 5 → 6, `format-fingerprint.test.ts` (vendors, vendorNames, exps.vendorId) | `npx vitest run src/hosted/local` |
| Portal | `VendorPicker.test.tsx` (recent, free text kept on Enter, alias hint, Arabic q); `ExpenseDrawer.test.tsx` (prefill only into an empty category) | `npx vitest run src/hosted` |
| Release-QA | `portal.expenses.vendor-typeahead` (new vendor kept, suggestion, prefill, POST body); `portal.expenses.create`, `.edit-receipts` still green | `release-qa release --only portal.expenses` |
## MUT-425 — the You page replaces the switcher and the account menu (2026-10-24, ADR-187)

| Layer | Tests | Command |
|---|---|---|
| Unit | `shell/__tests__/youRoutes.test.ts` (sectionOf, youPath, isYouPath, parseYouSearch, switchTarget); `data/__tests__/trialPrompt.test.ts` › billingRowOf (trial while snoozed, grace/read-only/locked, payer, no profile) | `npx vitest run src/hosted` |
| Component (real router) | `pages/you/__tests__/YouPage.test.tsx` (parts, rows → drawer keys, cap and lapse New profile, `?from=` across tabs and drawers, open profile never history Back, locked banner, profile-less `/you`); `YouApp.terms`, `YouApp.malafat`, `AppDownloadRows`; local-mode signed-out You › Account and You › App | same |
| Regression contract (eng D5) | menu tests migrated: views (switcher entries), local-mode, auth-states sign-out, UsageConsent, LapseGate, pressFeedback, the four account/profile drawers, MalafatPortal | same |
| Release-QA | `portal.you.{drawers,signed-out,phone-rtl,locked}`; `portal.shell.switch-profile` and the 10 migrated areas | `release-qa run --attach --app portal --only portal.you` |

## MUT-258 — receipt library rows carry their expense (2026-10-24)

| Layer | Tests | Command |
|---|---|---|
| Store contract | `store-contract-receipts.ts`: a FILED row's expense summary, none To review, none after the expense is deleted (memory + Prisma) | `npm --prefix server test` + `test:db` |
| Routes | `routes-receipts.test.ts`: the serialized `expense` (formatted amount) on a filed row, null on a To-review one | `npm --prefix server test` |


## MUT-333 — Close my account, web half (2026-10-24, ADR-188)

| Layer | Tests | Command |
|---|---|---|
| Unit | `accounts/__tests__/closure.test.ts` (deadline, open endpoints, gone, due, subscription actions, deletion day), `purge-plan.test.ts` (transfer target, decisions, tombstones), `purge-run.test.ts` (dry run, Stripe customers, not due, Stripe failure keeps the claim, Stripe unconfigured, storage queue, cap and budget, one failure), `billing/stripe/__tests__/account-gateway.test.ts` (real SDK, fake fetch) | `npm --prefix server test` |
| Store contract | `store-contract-account-closure.ts` (memory + Prisma): close/keep, revoked sessions, deadline and claim refuse a keep, listDue order, purge without claim, full purge (transfer, anonymize, scrub, tombstone, own rows, SIGNUP link, billing), storage queue | `test` + `test:db` |
| Catalog | `prisma-account-purge-catalog.test.ts`: every org table and user FK classified; no value names a purged person anywhere but the audit tombstone | `test:db` (private DB) |
| Routes | `routes-account-closure.test.ts`: close, mail en/ar, wrong password + lockout, other sessions revoked, the grace session's 403s, sign-in during grace, Stripe end/cancel/compensate, 503 without Stripe, a locked person, keep (+ billing attention), after the deadline, job/admin doors | `npm --prefix server test` |
| Mail / CLI / infra | `templates.test.ts` (`account-closing`, the date exemption), `users-cli.test.ts` (`accounts-purge`), `tests/account_purge.tftest.hcl` | `test`, `terraform test` |
| Portal | `CloseAccountDrawer.test.tsx` (impact, menu → drawer, download, wrong password, Stripe down, close → closing page, keep, Arabic, before the terms step), `queryClient.test.ts` (ACCOUNT_CLOSING re-reads me), local `migrations.test.ts` 6 → 7 | `npm run test:run` |
| Release-QA | `portal.account.close`, `.close-cancel`, `.close-locked`, `.close-arabic-phone` | `release-qa run --only portal.account.close` |

## MUT-115 — passkeys, web half (2026-10-25, ADR-190)

| Layer | Tests | Command |
|---|---|---|
| Unit | `auth/__tests__/webauthn.test.ts` (config cross-check, options, creation/assertion verify, A1 cross-origin pair, refusals, counter regression, names), `sign-in-audit.test.ts` (R1 audit actors + `method`), `scripts/__tests__/passkey-providers-update.test.ts`, `config.test.ts` | `npm --prefix server test` |
| Store contract | `store-contract-passkeys.ts` (memory + Prisma): cap, duplicate, rename, remove revokes its sessions but the caller's, atomic single-use challenge, concurrent consume, prune | `test` / `test:db` |
| Catalog | `prisma-account-purge-catalog.test.ts`: passkeys and challenges are deleted with the person | `test:db` |
| Routes | `routes-passkeys.test.ts` (19: auth, 404 unconfigured, step-up, wrong password counts, cap, refused creations, rename/remove ownership, closing, cookie + device sign-in, A1, A2, A3 shared lockout, operator lock / disabled / pending / closed, counter, unknown credential, replay, purpose crossing, IP budget, A4), `front-door-sign-in.test.ts` (passkey sign-in through the front door), `no-self-registration`, `route-security`, `billing-gate-routes`, `store-guard` | `test` |
| Infra / build | `tests/domain.tftest.hcl` (`WEBAUTHN_RP_ID` from stage live), `scripts/__tests__/vite-config.test.ts` (apex AASA 200 rewrite), `hosts.test.ts` | `terraform test`, `test:run` |
| Portal | `PasskeysDrawer.test.tsx` (12), `SignInPasskey.test.tsx` (8), `passkeys/__tests__/webauthn.test.ts` | `npm run test:run` |
| Release-QA | `portal-selfservice.passkeys.add` (core), `.sign-in` (core), `.remove`, `.password-change-keeps`, `.autofill`, `.arabic-phone` | `release-qa run --attach --only portal-selfservice.passkeys` |

## MUT-370 — passkey suggestion, portal half (2026-10-25, ADR-191)

| Layer | Tests | Command |
|---|---|---|
| Unit | `server/src/auth/__tests__/passkey-prompt.test.ts` (12: resolve, Not now counts/hides/caps/no-op while hidden, view due/not due, D11) | `npm --prefix server test` |
| Store contract | `store-contract-passkeys.ts` › suggestion (memory + Prisma): default, stored with the passkey count, concurrent Not nows spend one offer, per person | `test`, `test:db` |
| Routes | `routes-passkeys.test.ts` › suggestion (6): due on sign-in and /v1/me, not due with a passkey and back after removal, 30 days × 3 across devices, 422/401/403 and no audit, null + 404 without passkeys, closing refused; `route-security`, `portal-routes-coverage` | `npm --prefix server test` |
| Portal | `data/__tests__/passkeyPrompt.test.ts` (8), `components/__tests__/PasskeySuggestion.test.tsx` (10: shown, Arabic, hidden cases, D4 after the trial step, Not now, added, cancelled, stepUp hand-off, failure, drawer add takes it away) | `npm run test:run` |
| Release-QA | `portal-selfservice.passkeys.suggest-first-sign-in` (core), `.suggest-not-now`, `.suggest-add`, `.suggest-has-passkey`, `.suggest-arabic-phone` | `release-qa run --attach --only portal-selfservice.passkeys.suggest` |

## MUT-260 — portal receipts gallery, review and approve (2026-10-25, ADR-193)

| Layer | Tests | Command |
|---|---|---|
| Server | `attachments/__tests__/rules.test.ts` (inline disposition), `local-storage.test.ts` (the `d` claim; absent = attachment), `routes-receipts.test.ts` (`?disposition=inline` signs inline; unknown → 422), `routes-dev-attachments.test.ts` (inline PDF: no sandbox, no portal CSP, nosniff; attachment keeps sandbox), `portal.test.ts` (CSP string) | `npm --prefix server test` |
| Portal unit | `lib/__tests__/receiptSuggestion.test.ts` (JOD 3dp, ILS 2dp, unsupported currency, missing fields, date only, ignored fields), `data/__tests__/receiptQueries.test.ts` (file rules, filter mapping, next receipt, 404/503 off, the two 429s, upload sequence + cleanup) | `npm run test:run` |
| Portal pages | `pages/__tests__/Receipts.test.tsx` (21: tab + count, 404/503 hide, gallery filter/counts/PDF tile/lazy image, upload + refusals + 429, read-only, prefill + hints, unsupported currency, inline image/PDF, approve body without `suggested` + next, last → gallery, 409 → Filed view, 422 banner, network keeps the key, filed by link, not found); the drawer's own tests guard the extraction | `npm run test:run` |
| Release-QA | `portal.receipts.gallery`, `.upload`, `.review-approve`, `.filed`, `.unavailable`, `portal.direction.receipts-review-ar`; `portal.expenses` re-run for the extraction | `release-qa release --only portal.receipts,portal.direction.receipts-review-ar,portal.expenses` |

