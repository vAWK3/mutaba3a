# TEST_PLAN.md — Testing Strategy & Coverage

> **Purpose**: Document testing approach, coverage targets, and test organization.
> **Current Coverage**: ~65% overall (page tests completed 2026-03-14)
> **Last Updated**: 2026-03-14

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

Malafat's contract test (`features/money/contract/__tests__/mutaba3a-contract.test.ts`)
pins its client to the vendored `openapi.yaml` (TD-019 resolved). Not covered
by automation: the Terraform plan against a real project, the local image
push, the proxy-run migration and the GCS signed-URL path with a real bucket —
exercised by the operator runbook (`server/DEPLOYMENT.md` §2–3) and the
handover checklist (`.claude/designs/money-v1-handover.md`); the smoke step is
the M1 exit criterion, the e2e scripts above are the Money v1 one.

---

## Current Test Coverage

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
| `src/hooks/__tests__/useQueries.test.tsx` | Integration | 19 | Partial - business profile + document hooks |
| `src/components/__tests__/BusinessProfileDrawer.test.tsx` | Component | 8 | Basic - form rendering |
| `src/components/__tests__/ClientDrawer.test.tsx` | Component | 10 | Full - Client drawer with profile selector |
| `src/components/__tests__/ProjectDrawer.test.tsx` | Component | 13 | **Full** - Project drawer with profile selector |
| `src/components/__tests__/UpdateBanner.test.tsx` | Component | 11 | **Full** - Update banner states |
| `src/hooks/__tests__/useTauriUpdater.test.ts` | Unit | 8 | **Full** - Tauri updater hook |
| `src/lib/__tests__/updater-config.test.ts` | Contract | 2 | **Full** - compiled-in updater pubkey equals the canonical BEDF931CA1D6C777 key, asserted from the key bytes (MUT-49, ADR-031) |

#### Page Component Tests (Added 2026-03-14)
| File | Type | Tests | Coverage |
|------|------|-------|----------|
| `src/pages/clients/__tests__/ClientsPage.test.tsx` | Page | 33 | **70.08%** - Sorting, search, multi-currency |
| `src/pages/clients/__tests__/ClientDetailPage.test.tsx` | Page | 10 | Partial - Detail view |
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
| `src/sync/` | ~0% | 80% | ⏳ Pending | Not yet tested |
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
│   ├── matchingAlgorithm.test.ts # Retainer matching
│   └── monthDetection.test.ts   # Date utilities
└── sync/core/__tests__/
    ├── hlc.test.ts              # Hybrid Logical Clock
    ├── ops-engine.test.ts       # Operation processing
    └── conflict-resolver.test.ts # Conflict detection
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
| Concurrent edits (sync) | Integration |
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

# E2E (when implemented)
npm run test:e2e

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
| PKCE S256 | `src/sync/transport/__tests__/oauth-pkce.test.ts` | RFC 7636 Appendix B vector, charset/length bounds, no `plain` |
| Authorization-code client | `__tests__/oauth-client.test.ts` | discovery, authorize URL, state/error handling, exchange, rotation |
| Flow orchestration | `__tests__/oauth-flow.test.ts` | bind-before-open ordering, revocation clears tokens only, transient failure keeps them |
| Published CIMD document | `__tests__/cimd-document.test.ts` | mirrors Malafat's validation; ports match the code |
| Loopback listener (Rust) | `src-tauri/src/sync/oauth_callback.rs` | loopback-only bind, port fallback, single-shot, timeout releases port |

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
| Drawer contract (AC #3, #4, #6) | `src/components/drawers/__tests__/PartialPaymentDrawer.test.tsx` (9) | amount prefilled to the remaining balance and overwritable; the backdated date is what reaches the mutation; overpayment and zero rejected inline without calling the mutation; a repository rejection renders inline; empty prefill when settled; edit mode prefills the record's own amount |
| Local-date default (ADR-022) | `src/components/drawers/__tests__/PartialPaymentDrawer.test.tsx` | the date field defaults to `todayISO()`, asserted at two faked instants straddling midnight in opposite directions so it holds in both `Asia/Jerusalem` and `npm run test:tz` |
| Derived money views refresh | `src/hooks/__tests__/invalidateMoneyEventQueries.test.ts` (10), `useQueries.test.tsx`, `useIncomeQueries.test.tsx` | all nine money-event keys are invalidated and no others; the payment path and `markPaid` both trigger them. The expense and retainer paths are wired but uncovered — those modules have no mutation-test harness |
| Per-surface gate | `IncomePage.test.tsx`, `ClientDetailPage.test.tsx`, `ProjectDetailPage.test.tsx` | the button appears on exactly the rows each surface showed the kebab entry on, never on paid rows or expenses, opens the drawer with the row's id, and does not trigger the row's own click |

The four IncomePage "Record Payment" tests that existed before this ticket
asserted nothing about the action — three carried a comment saying the
behaviour was covered elsewhere, and it was not. They assert the button now.

**Baseline after MUT-6 (2026-10-10)**: 2,078 unit tests passing, 7 skipped.
The same 18 `ExpensesLedgerPage` failures still pre-date the ticket and are
untouched by it.

