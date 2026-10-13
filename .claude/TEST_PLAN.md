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
| `scripts/__tests__/release-files.test.ts` | Unit + contract | 7 | **Full** - each manifest staged with its lockfile; `RELEASE_COMMIT_FILES` equals deploy.sh `tag_and_push`'s `git add` (parsed from the script); porcelain partition: unstaged/staged/both columns, untracked, rename destination, leading-space first line, clean tree |

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

