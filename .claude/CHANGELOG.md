# CHANGELOG.md — Change History

> **Purpose**: Track all significant changes to the codebase.
> **Rule**: Update this file after completing any change.

---

## Format

```markdown
## [Version] - YYYY-MM-DD

### Added
- New features

### Changed
- Changes to existing functionality

### Fixed
- Bug fixes

### Removed
- Removed features

### Technical
- Refactoring, dependencies, infrastructure
```

---

## [Unreleased] - 2026-10-12 — MUT-87: Expenses Needs attention is one row per recurring rule

**Why:** three missed months of one recurring expense were three identical cards and 12 buttons for one decision (decision E1, `.claude/designs/landing-apple-redesign.md`). ADR-052. Test plan: `.claude/designs/mut-87-recurring-rows-tests.md`.

**Scope:**
- `src/components/expenses/recurringAttention.ts` (new: grouping, totals, month labels, snooze dates, amount reading), `RecurringAttentionList.tsx` + `.css` (new)
- `src/components/drawers/RecurringMarkPaidDrawer.tsx` + `.css` (new)
- `src/components/ui/CurrencyAmounts.tsx` + `.css` (new), `src/lib/currencyAmounts.ts` (new)
- `src/services/recurringExpenseService.ts` (`confirmPayments`, `skipOccurrences`, `snoozeOccurrences`; `frequency` on virtual occurrences), `src/db/interfaces.ts` + `src/db/expenseRepository.ts` (`recurringOccurrences.runAtomically`), `src/types/index.ts` (`VirtualOccurrenceDisplay.frequency`)
- `src/hooks/useRecurringExpenseQueries.ts` (batch hooks replace the single-payment ones), `src/hooks/useExpenseQueries.ts` (one additive change, below)
- `src/pages/expenses/ExpensesLedgerPage.tsx`; `src/components/ui/RecurringOccurrenceCard.tsx` + `.css` (read-only)
- Removed: `src/components/modals/RecurringConfirmModal.tsx` + `.css` (both modals), their export from `components/modals/index.ts`
- `src/lib/i18n/translations/{en,ar}.json`: `expenses.recurring.attention.*` added; five orphaned `expenses.recurring.occurrence.*` leaves (`confirmPayment`, `actualDate`, `editAmount`, `notes`, `notesPlaceholder`) removed

### Changed
- **One row per rule.** "Server hosting · $80 monthly · Aug, Sep, Oct not marked · $240", with the oldest payment's lateness under the amount, read like Home's Needs attention. The section header shows the number of rules and the total of each currency side by side (`CurrencyAmounts`), never combined.
- **One primary action, Mark Paid,** opens a small drawer: the rule's missed payments, oldest first, all checked, each with its date and an amount prefilled with the rule's amount. **Mark N paid** writes one expense per checked payment, **dated on its own expected date** (the old modal dated them today), in one all-or-nothing write.
- **Skip, Snooze and Edit rule moved to a ⋯ menu** (`useMenuButton`: focus on open, arrows, Escape returns focus) and apply to all of the rule's missed payments; Skip asks first. In the drawer each payment has its own Skip and Snooze. Snoozing is a view of the same drawer, with quick picks in the user's language.
- The forecast's cards are read-only.

### Fixed
- **Editing or creating a recurring rule now refreshes Needs attention and the forecast.** `invalidateRecurringRuleQueries` (`useExpenseQueries.ts`) didn't invalidate `dueOccurrences` / `virtualOccurrences`, so a rule edited from the row's ⋯ › Edit rule kept its old amount until a reload. Found in the browser check.

### Removed
- `RecurringConfirmModal` and `RecurringSnoozeModal` (no consumer left). The confirm modal's paid-date and notes fields go with it (each expense is dated on its expected date; notes stay editable on the expense).

### Technical
- `recurringOccurrences.runAtomically(work)`: one Dexie `rw` transaction over `recurringRules`, `recurringOccurrences` and `expenses`; the batch service functions loop over the existing single-payment functions inside it.
- Tests (+55 net): grouping and labels (15), currency order (2), batches on fake-indexeddb incl. rollback (12), batch hooks (3, replacing 3), list (5), drawer (10), page (4), i18n keys (5), rule-edit refresh (1), modals-gone guard (1). Full suite: 193 files, 2,930 passed, 4 skipped.
- Debt: TD-069 (Needs attention looks back only 90 days), TD-070 (the shared drawer is 480 px wide on a 375 px phone).
- Found, not changed: the page's "Total expenses" strip sums `db.transactions`, not the ledger's `db.expenses` (also found by MUT-58's smoke test).

## [Unreleased] - 2026-10-12 — TD-009: the structural axe violations on the core surfaces are fixed

**Scope:**
- `src/components/drawers/Drawer.tsx` and the hosted `src/hosted/components/Drawer.tsx` (`aria-labelledby` on the title)
- `src/components/filters/DateRangeControl.tsx` (named select and custom-range inputs)
- `src/components/ui/RowActionsHeader.tsx` + `.css` (new); used by `IncomePage`, `ClientWorkSection`, `ClientPaymentsSection`, `ProjectDetailPage`; the `.row-actions-header` rule moved out of `RecordPaymentButton.css`
- `src/pages/settings/SettingsPage.tsx`, `AdvancedFeaturesSection.tsx`; `src/index.css` (`.settings-label` is `display: block`)
- `src/lib/i18n/translations/{en,ar}.json`; `e2e/support/axe.ts`
- Test plan: `.claude/designs/td-009-axe-structural-tests.md`

### Fixed
- **Every drawer is a named dialog.** `Drawer` points `aria-labelledby` at its title, using an id from `useId()`. Its close button reads `common.close` ("إغلاق" in Arabic), not a fixed "Close". The portal's own drawer gets the same `aria-labelledby`. (axe `aria-dialog-name`)
- **The period filter has a name.** It is "Period" / "الفترة" on Income, the client profile and every other page that uses `DateRangeControl`. With Custom chosen, its two date inputs are "From" and "To". (axe `select-name`)
- **Settings' default-currency select is named by its visible label.** The label is now a real `<label for>`. `aria-labelledby` was tried first. It satisfied `select-name`, but axe's best-practice `label-title-only` then fired: it treats a labelledby target as hidden once it is scrolled below the fold, because `.main-content` and `.app-shell` are `overflow: hidden`. The row's description is its `aria-describedby`. (axe `select-name`)
- **The business profile's ⋯ button says what it is**: "Actions for <profile name>", with `aria-expanded`. (axe `button-name`)
- **The row-actions column has a header.** `RowActionsHeader` carries a visually hidden "Actions" in Income, in the client profile's work and payments tables, and in project detail. (axe `empty-table-header`)
- **Settings' headings are in order.** The section titles are `h2` under the page's `h1`, as Data Tools already was. They look the same: the class sets the size, and the reset zeroes the margins. (axe `heading-order`)

### Changed
- `KNOWN_AXE_VIOLATIONS` is down to `color-contrast` on every surface, which is left for MUT-74's palette work. MUT-79 had already removed `landmark-no-duplicate-banner`; the only `role="banner"` left is the demo-mode bar, which renders alone.

## [Unreleased] - 2026-10-12 — MUT-79: App frame — nothing floats over content

**Scope:**
- `src/components/layout/FxRateReadout.tsx` + `.css` (new), `popoverPosition.ts` (new: `nudgeInside`), `ThemeToggle.tsx` (new); `TopBar.tsx` (readout before the profile indicator), `SidebarNav.tsx` (`.sidebar-footer-row`: Settings + toggle), `AppShell.tsx` (bottom bars inside `<main>`)
- `src/hooks/useMenuButton.ts` (`{ kind: 'dialog' }`)
- `src/lib/theme/modes.ts` (new: `THEME_MODES`, `nextThemeMode`); `SettingsPage.tsx` renders `THEME_MODES`
- `src/components/ui/MacDownloadBanner.tsx` + `.css`, `UpdateBanner.tsx` + `.css` (in flow; `role="status"`)
- `src/lib/retiredStorage.ts` (new), called from `src/main.tsx`; `src/lib/platform.ts` (removed `isMacOS`/`isWindows`/`isLinux`)
- `src/index.css` (footer row, toggle; Settings' `.update-banner` card renamed `.settings-update-card`)
- `src/lib/i18n/translations/{en,ar}.json`; `src/test/setup.ts` (fetch guard)
- Removed: `src/components/ui/FxRateBanner.tsx` + `.css`
- Tests: `FxRateReadout`, `ThemeToggle`, `popoverPosition`, `themeModes`, `MacDownloadBanner`, `retiredStorage` (new); `useMenuButton` (dialog mode), `SidebarNav.features`, `TopBar.addMenu`, `platform` (updated)
- Test plan `.claude/designs/mut-79-app-frame-tests.md` (decisions D1–D8); TD-049 resolved; TD-048 updated; TD-054

### Added
- **Exchange rate in the top bar.** A quiet `$1 = ₪3.06 ▾` opens a small dialog showing the dollar and euro rates to four decimals, where each came from (Live / Cached / Unavailable), the date of the rates, when they were fetched, and Refresh rates. The formula reads left to right in Arabic too. On a narrow window the panel shifts to stay inside `<main>` rather than being clipped.
- **Theme toggle beside Settings** in the sidebar footer, stacked on the collapsed rail. It cycles Light → Dark → System from the same list Settings shows, so the two always agree. Its icon is per mode, and it is named "Theme: Dark".
- `useMenuButton({ kind: 'dialog' })` for a small non-modal panel. Opening focuses the first enabled control (or the panel). Tab leaves past the last control and closes it. Escape or an outside press closes it, as with a menu.

### Changed
- **The Mac-app bar** shows only on a Mac (`currentDevice() === 'mac'`, so not on an iPad), in a browser, until it is dismissed. Storage errors no longer break it.
- **Both bottom bars**, the Mac bar and the desktop "update available" bar, sit in flow at the bottom of `<main>` instead of `position: fixed` over the page. The fixed update bar also used to start at the expanded sidebar's width when the sidebar was collapsed.
- The `fx.*` keys: `refresh` is now "Refresh rates"; new keys `title`, `readoutLabel`, `rateDate`, `updated` and `nav.theme`.

### Removed
- **`FxRateBanner`**, the draggable, minimisable floating panel that covered table rows on every screen. Its drag and position state, its `fx.bannerTitle`/`showBanner`/`minimize`/`drag` keys, and its `mutaba3a_fx_banner_state` key all went with it; `removeRetiredStorageKeys()` deletes that key from existing browsers at startup.
- `isMacOS`, `isWindows` and `isLinux` (TD-049), whose substring checks took an iPad for a Mac and Android for Linux.

### Technical
- Settings' update card used the class `.update-banner`, which is also the app-wide desktop bar's class. Once that bar sat in flow, the card's margin and border would have leaked onto it, so the card is now `.settings-update-card`.
- The test setup replaces `fetch` with a guard that rejects, because every page test now renders the readout. Tests that need `fetch` already stub it themselves.
- The test suite needs Node 22 (as in CI). Under Homebrew's Node 26, jsdom's `localStorage` is undefined (TD-054).

### Fixed
- Axe `landmark-no-duplicate-banner` on every app page (TD-009). None of the bars claims `role="banner"` any more: the FX banner is gone, the Mac bar is a plain `div`, and the update bar is `role="status"`. The rule is removed from `e2e/support/axe.ts`'s `KNOWN_AXE_VIOLATIONS`.

**Why:** decision A1 of the Apple-design brief: nothing floats over content (F15).

---

## [Unreleased] - 2026-10-12 — E2E: the stale Playwright specs run against the current UI (TD-004)

**Scope:**
- `e2e/accessibility.spec.ts`, `e2e/settings.spec.ts` (rewritten); `e2e/transaction.spec.ts` → `e2e/income-drawer.spec.ts` (rewritten); `e2e/navigation.spec.ts` (Welcome race)
- `e2e/support/app.ts`, `e2e/support/axe.ts` (new)
- TD-004, TD-009, TEST_PLAN, PATTERNS

### Fixed
- **The 13 failing e2e cases are updated or removed; the suite passes 19/19.** They opened paths outside the `/app` basepath and looked for pages, headings and a drawer that no longer exist (Overview, Transactions, Reports, Projects, the Income/Expense/Receivable switch).
- `navigation.spec.ts` checked for the Welcome dialog once with `isVisible()`. Under parallel load the dialog could mount after the check and swallow the first sidebar click. It now waits for the dialog.

### Changed
- **Axe covers the core surfaces**: Home (first run, and with an entry), Clients, a client's profile, Income, Settings, and the income drawer with More details open. The pages that existed all have violations today. The owner chose to baseline them, not fix them here, so each surface lists the rules it is known to break (`KNOWN_AXE_VIOLATIONS`, all described in TD-009). Any other rule fails the test.
- **Settings now checks what the controls do**, not just that they're visible: Arabic sets `lang`/`dir` and English restores them; Dark, Light and System set and clear `html[data-theme]`; Export downloads the default profile's CSV.
- **The income drawer by mouse**: an amount alone saves an Unpaid entry with No client; an empty amount shows "Amount is required"; Due Date hides when the status is Received. The keyboard path stays in `income-fast-path.spec.ts`.

### Removed
- Axe checks for Projects and Reports. They are optional areas, off on a fresh install, and their routes send you home. Transactions is gone too, because `/transactions` redirects to Income.
- The Income/Expense/Receivable type-switch case. A receivable is unpaid income (Earned or Invoiced), and expenses are their own optional area.

## [Unreleased] - 2026-10-12 — MUT-64: device sessions — native app sign-in for hosted accounts

**Scope:** `server/` only:
- `prisma/schema.prisma` and migration `20261011213616_mut64_device_sessions` (`SessionKind` enum, `sessions.kind`)
- `src/auth/{sessions,sign-in,middleware}.ts` (new: `sign-in.ts`), `src/routes/{sessions,device-sessions}.ts` (new: `device-sessions.ts`)
- `src/routes/{customers,projects,payments,receivables,agreements,attachments,summaries,retainers,vat,fee-proposals,expenses,expense-categories}.ts` (security array only)
- `src/{app,index,config,schemas}.ts`, `src/repositories/{ports,memory,prisma}.ts`
- `openapi/openapi.yaml`, root `src/hosted/api/schema.d.ts`, `.env.example`
- tests: `src/auth/__tests__/{sessions,sign-in,middleware}.test.ts` (new `sign-in.test.ts`, new `middleware.test.ts`), `src/__tests__/{routes-device-sessions,route-security,routes-sessions,routes-expenses,config}.test.ts` (new `routes-device-sessions.test.ts`), `src/repositories/__tests__/store-contract-sessions.ts`
- `.claude/designs/mut-64-device-sessions{,-tests}.md` (new), ADR-037 amendment

### Added
- **A bearer-token principal for native apps.** `POST /v1/device-sessions` (email + password, same throttle/lockout/anti-enumeration timing as the portal) returns a token (`mds_<secret>`, prefix distinct from an API key's `mut_`) instead of setting a cookie. `DELETE /v1/device-sessions/current` revokes it.
- **Exactly a portal session's access.** A device session is the `'session'` `Principal` for the writability matrix — same scopes, same store guard, same `X-Mutaba3a-Profile` organization selection — reachable on every route a cookie session is (13 route files' OpenAPI `security` gain `{ deviceSession: [] }`), minus the cookie-only `DELETE /v1/sessions/current`.
- **Revocable the same way a cookie session is.** One `sessions` table (`kind: 'cookie' | 'device'`) means the operator's password reset, disable, and explicit "revoke sessions" all cover device sessions with zero changes to `admin-users.ts`.
- **No same-origin check for a device token.** `authenticate()`'s CSRF/`Sec-Fetch-Site` enforcement stays scoped to the cookie branch; a native app has no comparable signal.
- **Device-session lifetime**: 30-day idle, 180-day absolute (`DEVICE_SESSION_IDLE_DAYS`/`DEVICE_SESSION_ABSOLUTE_DAYS`, optional, default applied) — longer than a cookie's 120 min/12 h, since capture happens days apart.
- **Audit gains `metadata.sessionKind`** on `user.signed_in`/`user.locked_out`, so an operator can tell a device sign-in from a portal one.
- **Contract.** New `deviceSession` bearer security scheme; `SESSION_EXPIRED` reused for an invalid/expired/revoked device token (not a new code).

### Changed
- **`auth/sign-in.ts` (new)**: the credential-verification core (dummy-hash timing, throttle/lockout, audit) extracted out of `routes/sessions.ts` so the cookie and device routes share one tested implementation instead of two copies. `routes/sessions.ts`'s existing test suite passes unmodified — the proof the extraction didn't change cookie sign-in behavior.
- **`middleware.ts`**: `authenticateSession`/the new `authenticateDeviceSessionToken` share a `validateSessionRecord` core; a `finishSessionAuth` helper is the tail both the cookie and device-bearer paths call after their own credential check.

### Verified
- Server gates: lint, typecheck, `openapi:check`, `hosted:types:check`.
- `npm test` (server): 1110 passed, 11 skipped. Root `npm run typecheck` (app + hosted programs): clean.
- `store-contract-sessions.ts` run against both `MemoryLedgerStore` and the Prisma-backed store (local Postgres).

## [Unreleased] - 2026-10-12 — MUT-65: personal hosted profiles accept income, clients and matters from the user

**Scope:** `server/` only.
- `prisma/schema.prisma` and migration `20261012090000_mut65_personal_income` (column-altering: `payments.customerId` and `receivables.projectId` drop `NOT NULL`; new `payments.{projectId,createdByUserId}` and `receivables.{title,createdByUserId,deletedAt}`)
- `src/income/{compose,__tests__/compose}.ts` (new); `src/routes/income.ts` (new); `src/routes/receivables.ts` (+settle)
- `src/auth/{writability,middleware,store-guard}.ts`, `src/routes/{sessions,customers,projects,payments,expenses,summaries}.ts`, `src/repositories/{ports,memory,prisma}.ts`, `src/{schemas,serializers}.ts`, `src/app.ts`
- `openapi/openapi.yaml`
- tests: `src/income/__tests__/compose.test.ts`, `src/__tests__/{income-routes,receivables-settle}.test.ts` (new); `src/auth/__tests__/writability.test.ts` (new); extensions to `src/auth/__tests__/store-guard.test.ts`, `src/__tests__/{writability-drift,writability-routes,routes-sessions,route-security,routes-m2..m8}.test.ts`, `src/repositories/__tests__/store-contract-m4.ts`, `src/retainers/__tests__/proration.test.ts`, `src/summaries/__tests__/compute.test.ts`
- records: the approved brief `mut-65-personal-profile-income.md` and its test plan; ADR-037 amendment; ADR-038 addendum

### Added
- **`POST /v1/income`** (session-only, `payments:write`): Received (optionally with no client at all, optionally carrying a matter) or Owed (a client is required — explicit or resolved from a matter, else `422 CUSTOMER_REQUIRED_FOR_OWED`). Received is an ordinary `Payment`, created through the existing M4 transaction unmodified; Owed is a new, agreement-less `Receivable` (`origin: ADJUSTMENT`), always `OUT_OF_SCOPE` VAT at a zero rate, due `EOM_15` of the occurred date by default (the existing `dueDateFor` helper, no new date math). `occurredOn` may not be later than today; a capture source (`app|siri|widget|quick_action|share`) lands on the audit row only, never persisted on the entity.
- **`DELETE /v1/income/{id}`** (undo): voids an unsettled Owed entry of the caller's own, or reverses an unallocated Received payment of the caller's own (the existing M4 `reverse()`), each idempotent on repeat calls. Never reveals another user's or another profile's row (404, not 403).
- **`POST /v1/receivables/{id}/settle`**: one payment + one allocation against a session's own receivable, no preview/allocation dance; `amount` defaults to the full outstanding, `paidAt` to today (and may not be later).
- **A personal hosted profile can now write customers, projects and payments through its own session** (hosted-portal.md §5a amendment): `sessionAccessFor`/`sessionScopesFor`/`mayWriteFor` make the session column of exactly these three matrix rows a function of the profile (`profileWriter === null` → read-write) rather than a constant; a Malafat-fed profile is unchanged (still read-only there). `POST /v1/customers` and `POST /v1/projects` now accept a session as well as an API key; a session's `externalReference` is refused (`EXTERNAL_REFERENCE_NOT_ALLOWED`); the audit actor is `actorOf(c)` (USER for a session) instead of always API_KEY.
- `receivables.createAdjustment` / `softDeleteAdjustment` and an internal `createPaymentTx`/`createAdjustmentTx` split on the Prisma repository (the `settleReceivable(tx, …)` idiom), so MUT-66 can compose a payment or adjustment inside its own transaction without re-touching this code.
- `receivables.getByIdIncludingDeleted`: the undo route's own idempotency re-check needs to see an already-voided row; every other reader keeps using the deletedAt-filtered `getById`/`list`.

### Changed
- **`GET /v1/me`'s `access` map is now computed per organization** (`sessionAccessFor`), not once from a static table — a personal profile's `access` actually reflects what it can write.
- **`Receivable.projectId` and `Payment.customerId` are now nullable**, rippling into `routes/payments.ts`'s allocation engine (a projectless receivable is never eligible there — Owed is read/settled through `/v1/income`/`/v1/receivables/{id}/settle` instead), the organization summary's per-customer breakdown (a clientless payment contributes to the currency block's own totals but keys no row), and the `ReceivableSchema`/`PaymentSchema` wire contracts.
- `expenses.ts`'s create route threads an optional `captureSource` into its audit metadata, the one existing write path the ticket names.
- Contract: new reasons `CUSTOMER_REQUIRED_FOR_OWED`, `EXTERNAL_REFERENCE_NOT_ALLOWED`, `PAYMENT_HAS_NO_CUSTOMER` (422) and `ALREADY_SETTLED`, `ALREADY_ALLOCATED` (409); an "Income" tag and description paragraph; API `1.12.0-mut65`.

### Deviation from the plan (verified against ground truth)
- The design doc's §4.1/§4.6 assumed `occurredOn`'s future-date rejection could reuse `assertNotAbsurdDate` (agreements/compose.ts), the same call `POST /v1/payments` makes on `receivedOn`. Read against the real code, that function only rejects a date **more than ten years ahead** — Malafat's `receivedOn` is not rejected for being merely tomorrow. Ticket AC 7 requires a real "not later than today" rule, so `income/compose.ts` adds `assertNotFuture` (reusing the existing `DATE_INVALID` reason, not a new one) instead. `payments.ts`'s own `receivedOn` check is untouched — out of scope for this ticket.

### Fixed — post-review pass (2026-10-12, four approved fixes, one commit each, each test-first)
- **`POST /v1/receivables/{id}/settle` only ever touches an app-captured entry** (`routes/receivables.ts`). It looked a receivable up by `organizationId` alone. On a Malafat organization whose integration is `DISCONNECTED`, `profileWriterOf` returns `null`, so a session holds `payments:write` over that firm's whole historical ledger and could settle a real `INSTALLMENT`/`RETAINER_CHARGE` directly, bypassing the allocation engine. `origin !== 'ADJUSTMENT'` is now a 404 — not a 403 — mirroring `DELETE /v1/income/{id}`'s non-leaking discipline. Pinned by `receivables-settle.test.ts` ("a non-ADJUSTMENT receivable … → 404, nothing written"), which seeds a real installment-origin receivable straight into the store.
- **Settle maps `InsufficientCapacity` to 409, not 500** (`routes/receivables.ts`). `store.payments.create` throws it when `applyAllocations`' `FOR UPDATE` re-read finds the capacity gone — the concurrent-settle race. It escaped to `app.onError` as a generic 500, which `idempotency.ts` then treats as a 5xx and releases the key for. Converted the way both pre-existing call sites do, reusing the registered `VERSION_MISMATCH` reason (the credit route's shape, same file, same situation). No contract change: the route already declared `conflictResponse`. Pinned by a store stub that arms the next `payments.create` to throw.
- **Undo can no longer void a receivable a settle just paid** (`routes/income.ts`, `repositories/{prisma,memory,ports}.ts`). The route checked `paidMinor`/`creditedMinor` and then called `softDeleteAdjustment`, whose `updateMany` neither locked the row nor re-asserted the guard — a settle landing in between left a POSTED payment allocated to a receivable every read path hides, and answered 204 as if nothing was owed. The guard now lives in the `WHERE` clause (`paidMinor: 0n, creditedMinor: 0n`) in both stores, the same shape as `payments.reverse` re-asserting `status: 'POSTED'` inside its own `updateMany`. A refusal surfaces as a record that comes back still undeleted, so no signature change was needed; the route answers the same 409 `ALREADY_SETTLED` as its pre-check. Pinned in `store-contract-m4.ts` (both stores) and by a route-level test that stages the race deterministically with a one-shot store interleave hook.
- **`GET /v1/summaries/customers/{id}` counts matterless Owed entries** (`routes/summaries.ts`). It consumed its receivables only through a per-project filter, so a `projectId === null` row — MUT-65's **default** capture shape — reached no bucket, and when it was the client's only row in a currency that whole currency block was missing. `GET /v1/summaries/organization` does count them, so the two endpoints disagreed about what one client owes; AC 3 names the client-detail surface. Matterless rows now fold into the client's currency block through `bucketize`, the same helper the organization summary uses (ADR-033: one definition of a bucket), and their currencies join the block set; they stay out of `projects[]`. The test title that had baked the gap in as expected behaviour is fixed, and the figure is now pinned against the organization summary's.
- **Out of scope by instruction** (reported, not fixed): the review's P2 list — memory-store org-blind FK checks, the dead `requestId` field, `GET /v1/me` advertising write on PATCH-less domains, the organization-independent-route guard's permissiveness, unbounded `dueDate`, the non-discriminated income schema, dead `sessionAccess()`/`sessionScopes()` exports. Recorded as TD-055.
- **Verified after the pass**: server `npm test` 1171 passed, 11 skipped (72 files, 11 skipped — the Prisma suites, no database here); `npm run lint`, `npm run typecheck`, `npm run build` and `npm run openapi:check` all pass. `openapi.yaml` regenerated once, for fix 1's description sentence.

### Verified
- **Mutation checks** (temporarily applied, confirmed failing, reverted): the undo route's ownership check; the `paidMinor`/`creditedMinor` guard before voiding an Owed entry; the `sessionScopesFor` wiring in `selectProfile`; the `mayWriteFor` change in `store-guard.ts`'s `storeRefusal`. Each genuinely breaks the relevant test when removed. The `deletedAt` exclusion from `listEligible`/`countOutstandingByProject` is pinned permanently in `store-contract-m4.ts`.
- `npm test`: 1159 passed, 11 skipped. lint, typecheck, build and `openapi:check` pass. `npm run test:db` and the migration against a live Postgres could not be run in this environment (no `DATABASE_URL`/`MUTABA3A_TEST_DATABASE_URL`) — flagged, not claimed.
- openapi.yaml diff on `/v1/customers`/`/v1/projects` is exactly a second `security` entry plus description text, confirmed by hand — no schema or operation shape Malafat's vendored contract pins changes. No vendored-contract test exists in this repo to run automatically (Malafat owns that file, in its own repository).

---
## [Unreleased] - 2026-10-12 — MUT-78: "Open the web app" lands straight in sample data, with no dialogs

**Scope:**
- `src/demo/visitorSample.ts` (new: `enterVisitorSample`, `leaveVisitorSample`, `countSessionAdditions`), `sampleSession.ts` (new: the session record), `sampleSessionStore.ts` (new), `useVisitorSample.ts` (new: `useVisitorSampleEntry`, `useLeaveSample`)
- `src/demo/seedData/index.ts` (`seedDemoData({ announceFeatures })`, returns `featuresEnabled`, never a second default), `profile.ts` (`createDemoProfiles({ existingDefault })`), `transactions.ts` + `expenses.ts` (dates capped at today via `dates.ts` `notAfter`), `src/demo/types.ts`
- `src/components/ui/SampleDataBar.tsx` + `.css` (new); `src/components/layout/AppShell.tsx` (entry hook, bar, "Setting up the sample…"); `src/components/modals/WelcomeModal.tsx` (held back while preparing)
- `src/content/download-config.ts` (`WEB_APP_URL` → `/app/clients?sample=1`)
- `src/lib/i18n/translations/{en,ar}.json` (`sample.*`, Arabic with all six plural forms)
- Tests: `src/demo/__tests__/{visitorSample,seedDates,useVisitorSample}.test.*`, `SampleDataBar.test.tsx`, `WelcomeModal.sample.test.tsx`
- ADR-042; TD-051; test plan `.claude/designs/mut-78-sample-entry-tests.md`

### Changed
- **The landing page's web-app link opens a sample business's Clients list in one tap** — no Welcome dialog over a demo confirmation, no "DEMO MODE" bar, no "Switched on for your existing data" notice. Before, the link opened the internal demo tool (`?demo=1`): two stacked dialogs, then an empty Clients list because "Default Profile" stayed selected while the sample lived in three other profiles.
- **One quiet line while looking around**: "You're looking at sample data. · Start with your own ›", in the content flow (it cannot cover a drawer). "Start with your own" removes the sample, anything added while looking around, and the optional areas the sample switched on, then lands on the first run. It asks first only when the visitor added things ("This also removes the 2 things you added…").
- The sample goes only into a database without the person's own data; otherwise the link just opens their app. A second visit reuses the sample instead of seeding again.
- The internal demo (`?demo=1`, freeze time, reset) is unchanged.

### Fixed
- The demo seed wrote payments and expenses dated after today (a "Last payment" of Oct 19 on Oct 11), against ADR-038. Both generators cap at today.
- Seeding next to an existing default profile made two defaults; the sample now becomes the default only when nothing else is.

## [Unreleased] - 2026-10-11 — MUT-5: the income entry is the work record

**Scope:**
- `src/components/drawers/IncomeDrawer.tsx` (restructured, same component)
- `src/lib/incomeEntry.ts` (new: `buildIncomeCreate`, `buildIncomeUpdate`, `shouldExpandDetails`, `isBelowRecordedTotal`, `recordedTotalMinor`, `resolveDefaultCurrency`)
- `src/lib/utils.ts` (`parseAmountInput`, `normalizeNumerals`)
- `src/db/repository.ts` (`transactionRepo.update`)
- `src/components/ui/EntityTypeahead.tsx`, `src/components/ui/ClientTypeahead.tsx`
- `src/hooks/useQueries.ts`, `src/hooks/useIncomeQueries.ts`
- `src/index.css`, `src/lib/i18n/translations/{en,ar}.json`
- `e2e/income-fast-path.spec.ts` (new)
- Brief: `.claude/designs/mut-5-income-fast-path.md` (decisions P1–P5, eng-review ledger R1–R8); ADR-039, TD-029 update

### Added
- **Fast path.** Title ("What did you do?", autofocused), amount and client are the only fields up front.
- **More details.** Status, due date, currency, date, project, notes and the profile sit behind a toggle. Its summary line names the defaults in use: status · currency · date · profile when there are several.
- **Defaults.** A new entry starts in its profile's `defaultCurrency` and follows a profile change until the user picks a currency. EUR is offered.
- **Profile.** It is asked up front only when none can be resolved. An invalid field inside More details reopens it.
- **Edit view.** On edit, More details opens only when the entry has a due date, project, notes, a non-default currency or no profile.
- **Amount input.** Arabic-Indic and Extended Arabic-Indic digits and the Arabic separators are accepted, through `parseAmountInput`. An ambiguous amount ("12,5", "1.200,50") is a field error, never a guess.
- **Typed client.** A client name typed but not picked: an exact match is picked on blur, and any other text blocks the save with a message.

### Changed
- **One keyboard model in every typeahead** (client, project and vendor; hosted client and project pickers):
  - typing highlights the first match;
  - Enter on a closed list submits the surrounding form;
  - Escape closes only the list.
- **The lenient parsers** (`parseAmountToMinor`, `parseCurrencyInput`) wrap `parseAmountInput`. `formatCurrencyInput` normalizes numerals first, so the payment drawer accepts Arabic digits.
- **One transaction invalidation list.** `invalidateTransactionQueries` is now exported and covers the `income`, `receivables`, `incomeOverviewTotals` and `incomeAttentionReceivables` keys too; `useIncomeQueries` reuses it.

### Fixed
- **Editing reset payment data.** Editing a paid entry reset its payment date to today, and editing a part-paid entry wiped what had been received. The drawer now leaves payment fields absent from the write unless the status really changes.
- **Record-backed entries** (paid through Mark paid / Record payment): their payment state belongs to their records (ADR-039).
  - The status is read-only in the drawer.
  - An amount below the recorded total is refused, in the drawer and in `transactionRepo.update`.
  - An amount change recalculates received and status.
- **Keyboard path.** Enter after picking a client re-opened the list instead of saving. Pressing Enter twice right after creating a new client now saves with that client: the drawer holds the save until the client exists.
- **Escape** in an open client list also closed the drawer and discarded the form.
- **No refresh after save.** A save from the income drawer didn't refresh the client profile or `/income` until you navigated away and back. This was pre-existing and was folded in at the owner's request.
- **Amount input type.** The amount input was `type="number"`, which rejected "1,200" and Arabic digits.
- **The payment drawer's currency prefix** (`.input-with-prefix`) had no CSS. It now renders as a joined prefix.
- **Arabic layout.** The amount stays left-to-right in Arabic: `:lang(ar) { direction: rtl }` in theme.css beat the markup's `dir="ltr"`.
- **Defaults line in Arabic.** Its parts no longer reorder: each one is a `<bdi>`.

### Technical
- **TDD:**
  - 41 drawer tests; 35 of them fail against the old drawer;
  - 27 `incomeEntry` tests;
  - `parseAmountInput` tables;
  - 6 `transactionRepo.update` tests;
  - 9 typeahead keyboard-contract tests;
  - 4 `ClientTypeahead` tests;
  - an i18n parity test;
  - 2 hook tests proving a drawer save refreshes `useIncome`/`useReceivables`.
- **E2E:** a Playwright spec for the keyboard-only path and Escape. It passed 10/10 with `--repeat-each=5` against the worktree dev server; the committed config pins port 5173 (TD-004).
- **Test count:** the skipped edit-mode drawer test is back.
- **Follow-ups:** MUT-60 (TD-029 write side + backfill), MUT-61 (Malafat client/matter intake), MUT-62 (title column in `/income`).

---
### Fixed (pre-landing review, `/qa-reconcile` → `/review`)

Seven specialist and adversarial reviewers ran. These fixes were all approved by Basel ("fix all as recommended"):

- **Amount parser.** It no longer guesses:
  - letters other than a currency symbol or code are refused ("2k", "50%", "5 ألف");
  - spaces group thousands like commas, threes only ("100 50" is refused);
  - a leading 0 group is refused ("0,500");
  - the drawer refuses more than 2 decimals, while the lenient wrappers round half-up on the digits;
  - results must be safe integers.
  The literal invisible bidi characters in `utils.ts` and its test are now `\u` escapes.
- **Due date.** A Received save leaves it untouched. It used to delete it, so a reopened entry never went overdue.
- **Repository invariant (ADR-039 amended).** With live payment records, `transactionRepo.update`:
  - strips `status` / `paidAt` / `receivedAmountMinor` and re-derives them;
  - rejects a currency change;
  - checks the recorded total only when the amount changes, so legacy overpaid entries can still be retitled.
- **Typeahead Enter safety.** Enter is held while a pick is still being saved (`aria-busy`) and while typed text is unpicked. Typing highlights the first *prefix* match or the create option, never a substring match. The input gains `aria-controls` / `aria-activedescendant`. A failed client create keeps the typed name unpicked.
- **Drawer.**
  - Status, currency and Save wait for the payment records.
  - Currency is locked on record-backed entries, with a hint.
  - A refused save shows a translated toast.
  - An edit of a missing entry never creates one.
  - The recorded amount in the Arabic error is bidi-isolated.
- **Invalidation.** Each money key is invalidated once per payment save. `['transactionDisplay']`, the payment drawer's remaining balance, now refreshes after edits. TD-021 is resolved.
- **Styles and copy.** The hint sits with its status selector, the disclosure label never wraps, and the RTL chevron rotates instead of mirroring. One apostrophe is straightened. The unused `drawer.transaction.title` / `titlePlaceholder` keys are removed.
- **Tests.**
  - Drawer cases: the queued save and its failure path, the records gate, the currency lock, currency kept on edit and duplicate, the refused save, the legacy retitle and the missing entry.
  - Typeahead Enter-safety and a11y cases.
  - Repository invariant cases.
  - Each-key-once invalidation.
  - An Arabic Playwright check, which fails without the CSS fix.
  - The two 30ms sleeps are replaced by settle signals.

### Fixed (adversarial re-review, 2026-10-11)

The re-review verified the pre-landing fixes and found one medium regression and eleven smaller gaps; all are fixed, each test-first:

- **Record Payment on a payment request** (`paymentRequestService.recordPaymentForRequest`) left a part-paid receivable unpaid while the document showed paid: it wrote `status` through `update`, which ADR-039 now strips. It calls `markPaid`. `updatePaymentRequestWithTransaction` updates the receivable before the document (ADR-039 amended).
- **Enter, Enter.** An Enter held while a new client is saving now submits the form once it exists, so the keyboard path no longer needs a pause. Typing or another key in between drops it.
- **Failed creates stay retryable.** `onSelect` may resolve to `false`: the held Enter is dropped, the typed name is unpicked again and Enter offers the create option once more. A failed client create over a client picked earlier no longer empties the box. (The project picker empties its box on a failed create, as before: no form guards unpicked project text; see the final pass below.)
- **Enter after Escape** reopens the list on the auto highlight, so the next Enter picks.
- **Vendor highlight.** Pickers can supply the highlight rule (`autoHighlight`, default in `typeaheadHighlight.ts`); the vendor picker highlights its 95%+ name or alias match over a vendor whose name merely starts with the text.
- **Amount parser.** The currency suffix pattern no longer backtracks quadratically (3.4 s on a 50k-space paste, now linear) and inputs over 64 characters are refused first. One currency token at most; £ is no longer stripped. Bidi embeddings, overrides and isolates are stripped.
- **Typed currency.** "€100" in a USD entry is refused with a field error naming both currencies, and More details opens on the currency. `amountInputCurrency` reads the token.
- **Payment records that fail to load** show a notice with Try again instead of a silently disabled Save.
- **FSI, not LRI,** isolates the recorded amount in the below-recorded message.
- **Op log.** `syncedTransactionRepo.update` logs the entry as stored, not the payment fields the repository refused.
- **Offline (ADR-040).** Local queries and saves no longer pause while the device is offline (`networkMode: 'always'`, `src/lib/queryClient.ts`); the live FX rate still waits for the network.
- **New debt:** TD-047 (other drawers still use the lenient parsers).

### Fixed (final verification pass, 2026-10-12)
- **"Now" was a future payment west of UTC.** `paymentRecordRepo` compared the UTC date of a full timestamp with the local today, so in the evening in the Americas `new Date().toISOString()` was "tomorrow". Record Payment on a payment request (now routed through `markPaid`) and Mark paid failed, with no message. A timestamp is future only when both its UTC and its local date are (`isFuturePaymentDate`); date-only strings are unchanged (ADR-038 amended).
- **A failed project create** kept the name in the box while `projectId` was empty, and nothing guards unpicked project text, so the entry saved without the project it showed. The box empties again, as before MUT-5.
- **An empty box highlights nothing,** even when the last typed text would.
- **New debt:** TD-050 (the document page's payment-request actions fail silently).

## [Unreleased] - 2026-10-12 — MUT-76: the hero shows who owes you, and offers one next step per device

**Scope:**
- `src/pages/landing/components/HeroSection.tsx` + `.css` (rebuilt), `components/mocks/{ClientsListMock,CountUpAmount}.tsx`, `heroCta.ts`, `useCountUp.ts`, `sampleData.ts` (`SAMPLE_CLIENTS`, `sampleOwedTotals`), `GetItSection` (`id="get-it"`)
- `src/lib/platform.ts` (`detectDevice`, `currentDevice`, `DeviceKind`); `src/pages/download/DownloadPage.tsx` uses it
- `src/hooks/usePrefersReducedMotion.ts` (new, shared)
- `src/lib/i18n/translations/{en,ar}.json` (`landing.hero.cta*`, `alt*`, `landing.sample.client2/3`)
- `public/assets/landing/hero-dashboard.png` deleted (the folder is now empty)
- Tests: `HeroSection.test.tsx`, `heroCta.test.ts`, `useCountUp.test.ts`, `usePrefersReducedMotion.test.ts`, `platform.test.ts` (+`detectDevice`)
- Test plan `.claude/designs/mut-76-landing-hero-tests.md`; TD-049

### Changed
- **The hero image is the Clients list, built in HTML** (brief L5, L6): Owed now per currency ($900 · ₪46,834.41, overdue in red), then three clients ranked by what they owe, with each one's overdue amount and oldest overdue age. App labels, app tokens, light/dark and RTL for free. The strip's totals are computed from the rows (`sampleOwedTotals`), so the picture always adds up.
- **One filled button per visitor** (L4): a Mac gets "Download for Mac · Apple Silicon (M1 or later)", a Windows PC "Download for Windows" (only if the release has an installer), everything else — phones, tablets, Linux, ChromeOS — "Open the web app". One text link offers the alternative: the browser for a download, "Desktop apps for Mac and Windows" (→ `#get-it`) for the web app.
- **The owed totals count up once on load** (600 ms, ease-out), skipped under reduced motion. The final value is laid out invisibly underneath so the width never changes, and screen readers get only the final value.
- The hero button no longer swaps to a white background on hover — the old light-mode hover made its label disappear (F10). It dims slightly and presses in on pointer-down.
- The headline is capped at 56px and the copy column widened so each beat sits on one line at desktop widths; headings use `text-wrap: balance`.

### Fixed
- `detectDevice` tells an iPad from a Mac (iPadOS 13+ reports `MacIntel`; touch gives it away) and Android from Linux. `DownloadPage` now uses it, so an iPad no longer gets the Mac card first. The older `isMacOS`/`isLinux` keep their behaviour (TD-049).
- `utils.test.ts` › `todayISO` compared the local date with a UTC date and failed every night from local midnight to the UTC rollover; it now compares local with local.

## [Unreleased] - 2026-10-11 — MUT-75: the landing page tells the true story, in chapters

**Scope:**
- `src/pages/landing/LandingPage.tsx`, `LandingPage.css` (rewritten), `landingCopy.ts`, `sampleData.ts`
- `src/pages/landing/components/`: `HeroSection` (copy, honest buttons), new `ChapterSection`, `PrivacyBand`, `GetItSection`, `PlatformIcons`, `mocks/{ClientProfileMock,RecordPaymentMock,ProfileSwitcherMock,useMockFormat}`; `FAQSection` rewritten (six questions, `aria-controls` + `hidden`)
- `src/content/download-config.ts` (`DOWNLOAD_URLS` moved here from `DownloadPage`, `WEB_APP_URL`)
- `src/lib/i18n/translations/{en,ar}.json` (`landing.*` rebuilt)
- Tests: `src/pages/landing/__tests__/LandingPage.test.tsx`, `landingCopy.test.ts`
- Brief `.claude/designs/landing-apple-redesign.md` (L1–L3, L7, L12); test plan `.claude/designs/mut-75-landing-story-tests.md`; ADR-041; TD-048

### Changed
- **The landing page leads with the product's job and says privacy once.** Hero: "Know who owes you. Keep it to yourself." Then three one-idea chapters with HTML mock-ups built from the app's own labels (a client's page, the payment drawer, the business switcher), one privacy band, Get it, a six-question FAQ. About 3,800px at 1440 wide, down from 7,200.
- **Honest about price and platforms.** "Free during early access"; no "Buy", "$49", "Universal" or "Intel" anywhere in the page content. The Mac download says Apple Silicon (the build is arm64-only). The Windows download is offered only when the latest release has an installer (`release.hasWindowsBuild`), otherwise the page says the installer isn't in this release — v0.0.65 has none.
- **The currency answer is built from code**: `CURRENCY_NAME_KEYS: Record<Currency, string>` + `Intl.ListFormat`, so it names USD, ILS and EUR and can't drift from the `Currency` type. The old copy said EUR in one place and USD/ILS in another.
- The data-loss warning moved from under the pricing cards into the backup FAQ answer.
- "Open the web app" links go to `/app` (was `/app?demo=1`, the internal demo tool); MUT-78 replaces this with a sample-data entry.

### Removed
- `TrustBadgesSection`, `ValuePropsSection`, `ProblemSection`, `CapabilitiesSection`, `ProofGallerySection`, `DownloadSection`, `PricingSection`, `FinalCTASection`, and the already-unused `UseCasesSection` and `PrivacySection`, with their CSS and i18n keys. Fourteen unreferenced screenshots in `public/assets/landing/` (`proof-*`, `usecase-*`, `screenshot-answers.png`). `hero-dashboard.png` stays until MUT-76 replaces it.

### Fixed
- The skip link was hard-coded English; it is now `landing.skipToContent`.

## [Unreleased] - 2026-10-11 — MUT-18/19/20/21: payment dates, and closing out three already-fixed test tickets

**Scope:**
- `src/db/repository.ts` (`recalculateReceivedAmount`, `markPaid`, `paymentRecordRepo.create`/`.update`)
- `src/hooks/useIncomeQueries.ts` (`useMarkIncomePaid`)
- `src/components/drawers/PartialPaymentDrawer.tsx` ("Mark fully paid", lifted `dateInput`, future-date validation)
- `src/pages/income/IncomePage.tsx`, `src/pages/projects/ProjectDetailPage.tsx`, `src/pages/transactions/TransactionsPage.tsx`, `src/components/clients/ClientWorkSection.tsx` (Mark Paid row action)
- `src/lib/i18n/translations/{en,ar}.json` (`transactions.partialPayment.futureDate`)
- Tests: `transactionRepo.test.ts`, `partialPayment.test.ts`, `paymentRecords.test.ts`, `useIncomeQueries.test.tsx`, `PartialPaymentDrawer.test.tsx`, `ClientDetailPage.test.tsx`, `IncomePage.test.tsx`
- ADR-038; TD-046

### Fixed
- **MUT-18 — "Mark paid" could not record a payment that happened earlier.**
  `markPaid`/`recordPartialPayment` already had an unused `opts.paidAt`
  parameter from an earlier partial fix, but nothing threaded a date through
  it: all four row-menu "Mark Paid" quick actions (Income, Transactions,
  Project detail, Client work) called the mutation with no date, and
  `PartialPaymentDrawer`'s own "Mark fully paid" shortcut silently discarded
  the date field sitting right next to it, calling the deprecated
  `useMarkTransactionPaid` instead. Separately, `recalculateReceivedAmount`
  (what every payment write funnels through) stamped a transaction's own
  `paidAt` with the recalculation instant instead of deriving it from the
  payment records it had just summed, so even the already-correct
  `PartialPaymentDrawer` date-entry path produced a wrong transaction-level
  date the first time a transaction crossed into fully paid.
  - Fix: `recalculateReceivedAmount` now derives `paidAt` from the latest
    payment record; the four quick actions open `PartialPaymentDrawer`
    (prefilled to the full remaining balance) instead of firing the dateless
    mutation; "Mark fully paid" now submits through the same dated
    `useCreatePaymentRecord` path as "Record Payment" via a `dateInput` state
    lifted out of the form; a future-dated payment is rejected with a
    translated inline error, enforced at the repository layer
    (`paymentRecordRepo.create`/`.update`) so no path can bypass it.
  - See ADR-038 for the full decision and alternatives considered.
- **MUT-21 — overdue-count test hardcoded March 2026 dates with no fake
  timers.** Confirmed already fixed on `main` (fake clock pinned to
  2026-03-14, fixture dates documented relative to it, due-today/due-yesterday
  asserted deliberately). Added the one missing boundary case the ticket's
  acceptance criteria named explicitly: due-tomorrow is asserted not-overdue.
  Swept the rest of the suite for the same real-clock-plus-hardcoded-date
  pattern (grep for `overdue`/`aging`/`dueSoon`/`lastActivity` assertions
  without `useFakeTimers`): no other production code computes "today"
  internally without an explicit `today`/fixed-clock parameter, so no further
  time bombs found.
- **MUT-19 — IncomeDrawer client dropdown / project filtering / status-reset
  tests.** Confirmed already fixed on `main`; all three tests pass, and the
  received→invoiced clear is verified at the repository level as the ticket
  required. The client field also resolves a concrete `profileId` even in
  "All Profiles" mode (falls back to the first profile), so clients remain
  selectable there too.
- **MUT-20 — ExpensesLedgerPage 18 failing tests.** Confirmed already fixed
  and merged (`8f7bb7b`), matching its Jira "Done" status. Verified the
  remaining acceptance criteria not obvious from the fix commit alone: the
  no-profile branch has its own dedicated test, `expenses.noProfileSelected`
  exists in both locale files, and there is only one expense test file so the
  "extract shared fixture" criterion doesn't apply.

### Technical
- `markPaid`'s already-fully-covered branch (`remaining <= 0`) now delegates
  to `recalculateReceivedAmount` instead of duplicating its status/paidAt
  logic inline.
- New tests: backdated full/partial payments, default-to-today, the
  month-boundary case the ticket named, future-date rejection at create/update,
  "Mark fully paid" under both today and a backdated date, and the
  due-tomorrow boundary.
- `useMarkTransactionPaid`/`useMarkIncomePaid` remain in place as
  repository/hook primitives — `synced-repository.ts` and
  `paymentRequestService` still call `markPaid` directly for reasons outside
  this ticket's scope — so only the UI call sites moved, not the primitives.
  `useTransactionActions.ts` carries the same dateless pattern but has no
  production caller; left alone and logged as TD-046 rather than deleted as a
  scope expansion of this ticket.

## [Unreleased] - 2026-10-11 — MUT-45: serve the hosted portal

**Scope:**
- `server/src/app.ts` (`AppDependencies.portal`, portal static/SPA-fallback serving, CSP header); `server/src/config.ts` (`PORTAL_DIST_DIR`); `server/src/index.ts` (wiring)
- `server/src/smoke.ts` (`GET / (hosted portal)` check); `server/Dockerfile` (`COPY dist-hosted ./portal`, `ENV PORTAL_DIST_DIR`); `server/scripts/deploy.sh` (builds and copies the portal bundle before the Docker build; widens the uncommitted-changes guard to the whole repo)
- `.github/workflows/server-ci.yml` (docker job builds the hosted bundle first, so the image CI proves matches what's deployed)
- `server/src/__tests__/{portal,config,smoke}.test.ts` (new/changed)
- `server/DEPLOYMENT.md` (§0, new §4c, §5, §8); `.claude/designs/hosted-portal.md` §9/§10; ADR-037 MUT-45 amendment

### Added
- **The hosted portal is live.** The API serves the built `dist-hosted/` bundle from the same Cloud Run service: `/assets/*` immutable-cached, any other non-API GET falls back to `index.html` for client-side routing, registered after every API route so a real route (or a genuinely missing `/v1`/`/admin` path) always wins over the fallback.
- **CSP on every response**: `default-src 'self'; connect-src 'self' https://storage.googleapis.com; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'`. The `connect-src` addition resolves the gap the MUT-44 amendment flagged — receipt uploads `fetch()` a `PUT` straight to a GCS signed URL, which `'self'` alone would have silently broken.

### Changed
- `deploy.sh` now builds the hosted-portal bundle at the repo root and copies it into `server/`'s Docker build context before `docker build`; its uncommitted-changes guard now covers the whole repo, not just `server/`, since the image tag now names the portal source too.
- `server-ci.yml`'s docker job does the same, so the image CI builds and health-probes is the same shape that gets deployed, portal included.

### Technical
- **No custom domain.** The design brief's open "Domain" decision (an external HTTPS load balancer or a Cloudflare proxy, since Cloud Run domain mapping is unavailable in `me-west1`) is resolved by not doing either: ADR-037 decision 10 only requires one origin, which the bare `run.app` URL already is. `PORTAL_ORIGIN` and `TRUSTED_PROXY_HOPS` stay at their MUT-38 defaults. A branded domain is deliberately left for its own follow-up ticket.
- **No Terraform changes.** `terraform plan` is a no-op for this ticket; `terraform validate` passes.
- Corrected the ticket's stale "ADR-033" citation — that number is now a different, unrelated decision on `main`; ADR-037 is the actual reference.

## [Unreleased] - 2026-10-11 — MUT-44: hosted expense capture

**Scope:**
- `src/components/expenses/` (new, shared): `ExpenseFormFields`, `expenseFormSchema`; `src/components/drawers/ExpenseDrawer.tsx` (changed to use it, no behaviour change); new `src/components/__tests__/ExpenseDrawer.oneTimeFields.test.tsx`
- `src/hosted/api/client.ts` (`request()` gains PATCH + `idempotencyKey`/`ifMatchVersion`; expense/category/receipt operations); `src/hosted/data/expenseQueries.ts` (new), `queries.ts` (`useCursorList`, `Page` exported), `filters.ts` (`ExpenseFilters`, `ExpenseDrawerSearch`, `ExpensesPageSearch`)
- `src/hosted/components/`: `Drawer.tsx`, `ExpenseDrawer.tsx`, `ClientPicker.tsx`, `ProjectPicker.tsx`, `ReceiptUploader.tsx`, `expenseApiErrors.ts` (all new); `HostedTable.tsx` (`onRowClick`), `FilterControls.tsx` (`CategoryFilter`)
- `src/hosted/pages/views/ExpensesList.tsx` (new); `router.tsx` (`/expenses` route); `shell/HostedShell.tsx` (nav entry); `format/dates.ts` (`todayLocalISO`)
- `src/hosted/i18n/{en,ar}.json` (`hosted.expenses.*`, `hosted.filters.category`, `hosted.shell.nav.expenses`, `common.{save,cancel,delete,close,loading,saving}`)
- `scripts/bundle-origins.json` (`json-schema.org` added to `hosted`)
- `.claude/designs/mut-44-expense-capture.md` + `-tests.md` (new); ADR-037 MUT-44 amendment

### Added
- **Expense capture on the hosted portal** — the only write a hosted (Malafat-fed) tenant has. A drawer records or edits an expense (amount, currency, date, title, vendor, client, matter, category, notes) against MUT-42's API, deep-linkable via `?newExpense=`/`?expense=<id>` on the new `/expenses` route.
- **Receipt attachment** on an existing expense: PDF/JPEG/PNG up to 10 MB, a 10-receipt cap (counting only `READY`), start → signed-URL PUT → complete, matching the M6 attachment flow.
- **Shared expense form.** `ExpenseFormFields` (amount/currency/date/title/category/notes) now renders inside both the local `ExpenseDrawer` and the new hosted one; vendor/client/project stay host-specific slots (local's are Dexie-backed and create-capable; hosted's are read-only directory lookups with no server-side vendor concept at all).
- **Field-level error mapping.** MUT-42's `VALIDATION_FAILED`/`CONFLICT` reasons land on the owning form field or a toast, per `expenseApiErrors.ts`.

### Changed
- `HostedTable` takes an opt-in `onRowClick` (every other list is unaffected); `QueryView`'s `Empty` already supported an `action`, now used for "Record expense".
- The local `ExpenseDrawer`'s one-time-expense JSX is now `ExpenseFormFields` under the hood; its recurring mode, Dexie hooks and existing test are untouched.

### Technical
- `request()` (hosted API client) gains `PATCH` and `Idempotency-Key`/`If-Match` header support — the portal's first write ever needed either.
- The portal's mutation hooks live in `src/hosted/data/expenseQueries.ts`, not a `hooks/` dir: the lint ban on `(^|/)(db|sync|hooks)(/|$)` matches the path segment literally, regardless of whose hooks they are.
- `src/hosted/components/Drawer.tsx` renders the app's own `.drawer`/`.drawer-overlay` classes from the shared `src/index.css` (both builds already import it) rather than new CSS — same interaction and pixels as the local drawer.
- Receipt upload is a bare cross-origin `fetch` (`credentials: 'omit'`) to the storage bucket's signed URL, bypassing `request()`'s same-origin/`/v1/*` assumptions. Flagged on MUT-45 (comment 10956): its CSP needs the bucket origin in `connect-src`.

---

## [Unreleased] - 2026-10-11 — MUT-43: the hosted portal — sign-in and the money views

**Scope:**
- `hosted.html`, `src/hosted/**` (new): the portal build, its shell, sign-in, session handling, the six read views, typed client (`api/schema.d.ts` generated from `server/openapi/openapi.yaml`), `hosted.css`, en/ar dictionaries
- `src/lib/i18n/core.tsx`, `plural.ts` (new); `context.tsx` reduced to the app's state + persistence over the core
- `vite.config.ts` (a `hosted` branch; web/desktop unchanged and snapshot-pinned), `tsconfig.hosted.json` (new), `tsconfig.app.json` (excludes `src/hosted`), `tsconfig.json`, `eslint.config.js`, `package.json`, `.gitignore`
- `scripts/check-bundles.ts`, `bundle-rules.ts`, `bundle-origins.json`, `check-hosted-types.ts` (new); `scripts/__tests__/*` (new); `src/test/setup.ts` (browser shims guarded for node-environment tests)
- `.claude/designs/mut-43-auth-states.md` + wireframe, `mut-43-hosted-portal-tests.md` (new); `hosted-portal.md` and ADR-037 (Malafat sign-in removed; MUT-43 amendment)

### Added
- **Hosted portal** (`npm run dev:hosted`, `build:hosted` → `dist-hosted/index.html`). Email + password sign-in on MUT-38's session API, with no signup, reset, invite or third-party door. Every auth state in the approved addendum (`mut-43-auth-states.md`):
  - boot check and the boot-unreachable card;
  - the one 401 banner with the lockout hint, and `Retry-After` plurals;
  - a safe `next`, and the expired vs signed-out notes;
  - no profiles, and profile unavailable;
  - a sign-out failure that keeps the person signed in;
  - cross-tab sign-out, and account-locale precedence.
- **Shell and switcher.** Hosted profiles only; each has a "Hosted" chip and its source sentence, and a footer says local profiles stay on the device. Switching keeps the section and never shows the other profile's figures.
- **Views:** Overview (strip + clients, overdue first, a currency switch only when more than one currency has figures), Clients (search), Client detail (summary + matters; receivables / payments / documents tabs), Receivables, Payments (with allocations), Documents (signed-URL download, no preview).
  - Each view has four states, and **a view in error renders no data**.
  - Income views explain why they are read-only.
  - Filters are one URL object, updated with `replace`.
- **`DecimalAmount`** formats wire decimal strings with `Intl.NumberFormat`, never `Number()`.
- **`tp()`** plurals over `Intl.PluralRules` (ADR-019, no ICU parser).
- **`npm run test:bundles`** proves the separation on the built output:
  - web and desktop carry no portal endpoint, cookie or header;
  - the portal carries no IndexedDB, Dexie, service worker or self-service copy (en/ar);
  - neither carries an origin outside `scripts/bundle-origins.json`.
- **`npm run hosted:types:check`** fails when the typed client drifts from the contract.

### Changed
- `npm run typecheck` checks two programs: `tsconfig.app.json` (which no longer sees portal code) and `tsconfig.hosted.json`.
- The app's i18n is split into a translation-free core and the app provider; the provider's behaviour is unchanged (tested).

### Fixed (found by running the portal against the real API on a scratch database)
- Sign-out: the signing-out tab heard its own cross-tab announcement and cleared the cache under the mounted sign-in check, leaving an endless spinner. One channel per tab now sends and listens.
- `vite --mode hosted` served the local app at `/` in dev.

### Technical
- Lint guards for `src/hosted/**`: no local data layer, sync, hooks, shell, drawers, stores or app i18n provider; no `Number()`/`parseFloat`/`parseInt`/unary `+`. Proven by `scripts/__tests__/hosted-lint.test.ts`.
- Root suite: 151 files, 2462 passed, 5 skipped. MUT-43's own tests: 163.

---

## [Unreleased] - 2026-10-11 — MUT-59: repair migration for databases that applied the original M7

**Scope:**
- `server/prisma/migrations/20261011120000_mut59_fee_proposal_enum_repair/` (new)
- `server/src/repositories/__tests__/migration-mut59.test.ts` and `fixtures/m7_fee_proposals.acb1144.sql` (new)
- `server/DEPLOYMENT.md` §7–8, `.claude/{DECISIONS,PATTERNS,TEST_PLAN}.md`, `money-v1-handover.md`

### Fixed
- **Approving a fee proposal failed in production.** The database had applied the original M7 enum before M8 edited that migration in place. The forward repair migration:
  - is guarded, and a no-op where the schema already has M8's shape;
  - audits each touched row as `SYSTEM` `fee_proposal.repaired` with its old values;
  - maps `CONVERTED` → `APPROVED` (date and amount from M7's fields or the agreement) and `CLIENT_APPROVED`/`AGREED` → `PROPOSED`;
  - refuses, all or nothing, on a `CONVERTED` row without an agreement or a project with two open proposals;
  - recreates the enum and drops `agreedOn` and `agreedNote`.

### Changed
- **ADR-027 decision 5 (D20)** gets an override log: its premise that nothing was deployed was false.
- **New pattern:** migrations are append-only once merged.
- **`DEPLOYMENT.md` §7** explains how the repair ships, and the recovery if it refuses.

### Verified
- **`test:db`:** 5 new cases on scratch databases built as production was: repair, idempotence, two refusals, fresh no-op.
- **Rehearsal of the real path:** `migrate deploy` of the acb1144 history, then of `main`, plus a refusal and the `migrate resolve --rolled-back` recovery.
- `npm test` 1056 passed and `test:db` 1122 passed; lint, typecheck, build and `openapi:check` pass.

---

## [Unreleased] - 2026-10-11 — Deployment record after the hosted-epic deploy; vendored-contract command fixed

**Scope:** `server/DEPLOYMENT.md`, `server/src/scripts/export-openapi.ts`, `.claude/INFRA.md`, `.claude/designs/money-v1-handover.md`.

### Fixed
- **The vendored-contract command (`DEPLOYMENT.md` §4a)** failed three ways for the operator on 2026-10-11, all now documented, with a `node -e` validity check after the redirect:
  - run from the repository root it is `Missing script` (the script lives in `server/`);
  - the shell's `>` had already emptied Malafat's file to 0 bytes;
  - without `-s`, npm's banner made the file invalid JSON.

  The note `export-openapi.ts` writes into every generated file now says `-s` too.
- **Piped `openapi:json` output was cut at about 64 KB.** `export-openapi.ts --json` called `process.exit` before stdout drained, so `| jq` and the like got truncated JSON (a file redirect was unaffected). It now waits for the write.
- **Two sections were numbered §4a.** The portal-access section is now §4b.

### Changed
- **`DEPLOYMENT.md`:**
  - §0 lists the session-pepper secret and the attachments bucket;
  - the stale M1-era "Tickets to close" becomes **§7 Production record**: every Cloud Run revision with its commit and time (read from Cloud Run, Artifact Registry and Secret Manager), Malafat's production release, and the firms;
  - §8 lists the current next steps.
- **`INFRA.md`** now shows the service in production at `ced04f7` and its URL.
- **The M8 handover** records that Malafat `web@2.2.4` shipped M8 (so §2's mismatch is closed) and that §2a is now reachable.

### Found
- **Production probably still has the original M7 fee-proposal enum.**
  - Revision `00003` rolled `acb1144` on 2026-10-09; M8 later edited that migration in place; `prisma migrate deploy` never re-runs a recorded migration.
  - Approving a proposal (offered by Malafat `web@2.2.4`) would fail with an enum error.
  - The read-only check and the repair migration's requirements are in `DEPLOYMENT.md` §7. The repair is not written yet.

---

## [Unreleased] - 2026-10-11 — MUT-42: expenses on the hosted ledger

**Scope:** `server/` only.
- `prisma/schema.prisma` and migration `20261011080000_mut42_expenses` (additive: `expenses`, `expense_categories`, `expense_receipts`)
- `src/expenses/{compose,cursor,names,presets,summary}.ts` (new); `src/routes/{expenses,expense-categories}.ts` (new)
- `src/auth/{scopes,store-guard,writability,middleware}.ts`, `src/{idempotency,app,schemas,serializers}.ts`, `src/attachments/rules.ts`, `src/routes/audit.ts`, `src/repositories/{ports,memory,prisma}.ts`
- `openapi/openapi.yaml`, `README.md`
- tests: new store contract (memory and Postgres), unit tests (summary, presets, cursor), `routes-expenses` and `expenses-invisible`; additions to the rules, scopes and guard tests; `route-security` and `writability-routes`; version pins
- records: the approved brief `mut-42-hosted-expenses.md` and its test plan; ADR-037 amendment; TD-041

### Added
- **Expenses on a hosted profile, sessions only.**
  - Record, list (newest first, with filters), read, change (`If-Match`; the currency never changes) and soft-delete.
  - Each expense keeps its original amount and currency. A client or matter link is optional; a matter alone brings its client, and currencies are never compared.
  - Personal versus firm-associated is the profile. There is no classification field.
- **Receipts:** the M6 signed-URL flow, on the same bucket and TTL, under `org/{id}/expense-receipts/{receiptId}`, in a table of their own. At most 10 per expense; uploaded by a user (`uploadedByUserId`).
- **Categories:** per profile, as offline (name, colour, archive).
  - The first list seeds a preset in the user's language, as `SYSTEM`: law-firm on a Malafat-fed profile, general on a personal one.
  - A parity test keeps the presets equal to the offline app's.
- **`GET /v1/summaries/expenses?from&to`:** defaults to this month. One block per currency, broken down by category and by client (`null` = linked to no client).
- **Audit:** actor `USER` with the user id on every write.

### Changed
- **Expenses are invisible to Malafat's key.** The routes are session-only.
  - The store guard gains `{ read: Domain }`, so expense reads are refused to a key below the routes.
  - `GET /v1/audit` leaves expense activity out.
  - Session idempotency keys are namespaced per user, so `GET /v1/operations/{key}` can't return them.
- **`expenses:read` and `expenses:write` are session-only scopes** (`SESSION_ONLY_SCOPES`). They can't be issued to a key, and Malafat's scope vocabulary is unchanged.
- **Small refactors:** `checkFile` is factored out of `checkUpload`, and `sessionAuth(c)` is the session counterpart of `keyAuth(c)`.
- **Contract:** reasons `PROJECT_CUSTOMER_MISMATCH`, `CATEGORY_NOT_FOUND`, `CATEGORY_ARCHIVED`, `TOO_MANY_RECEIPTS` and `CATEGORY_NAME_TAKEN`; an "Expenses" tag and description paragraph; API `1.11.0-mut42`.

### Verified
- **Canary sweep:** every key-readable operation, handed every expense, receipt and category id, returns none of the canaries.
- **Mutation checks:** removing the audit exclusion or the key namespacing fails the invisibility tests.
- **The migration** applies from an empty database with no schema drift.
- `npm test`: 1056 passed, 10 skipped. `npm run test:db`: 1117 passed. lint, typecheck, build and `openapi:check` pass.
- **MUT-39's carried criteria hold:** a session writes an expense on a Malafat-fed profile, and the key is refused on all 13 expense operations.

---

## [Unreleased] - 2026-10-11 — MUT-39: server-enforced writability on hosted profiles

**Scope:** `server/` only. No schema change.
- `src/auth/{store-guard (new),writability,middleware}.ts`, `src/{app,errors}.ts`
- `src/routes/{summaries,receivables,agreements,retainers}.ts`, `openapi/openapi.yaml`
- tests: `src/auth/__tests__/store-guard.test.ts`, `src/__tests__/{writability-drift,writability-routes}.test.ts` (new); `route-security.test.ts`; version pins in `routes-m*`
- records: `.claude/designs/hosted-portal.md` §5 "As built", `mut-39-writability-tests.md`, ADR-037 amendment

### Added
- **`403 READ_ONLY_PROFILE { domain, writerOfRecord }`.** A session that writes customers, projects, agreements, payments or attachments gets this refusal.
  - It comes from `authenticate()` on the key-only write routes, and from `requireScope` should a session-reachable route ever need a write scope.
  - `writerOfRecord` is `MALAFAT` when the profile's Malafat integration is CONNECTED, otherwise `null`. It is resolved only for a member organization, so a non-member's is never revealed.
  - Every other key-only route still answers `PRINCIPAL_NOT_ACCEPTED`, as before.
- **A store guard below the routes (`auth/store-guard.ts`).**
  - `STORE_ACCESS` classifies all 98 repository methods: 53 read, 8 control, 8 operator and 29 writes, each in one matrix domain. It is typed over `LedgerStore`, so a new method does not compile until it is classified.
  - Every route factory now receives `requestScopedStore(store)`. Each repository call checks the guard `authenticate()` put on the request: the session column for a session, the API-key column for a key.
  - Provisioning (`operator`) is refused under any guard.
- **Route scopes are readable.** `requireScope` tags its middleware, and `buildRouteAccessIndex` reads the tags from `app.routes`, so every operation's scopes are known without a second declaration.
- **The matrix const carries the brief's "Routes covered" cell,** and a drift test compares the two cell by cell.

### Changed
- **Lazy posting by the portal's reads** (three summaries, the receivables list, the agreements list and detail, retainer charges) goes through `lazyPostingOf(c, store)`:
  - a key posts through the guarded store as itself;
  - a session posts as `SYSTEM` on `unguarded(store)`.
  `unguarded()` has no other caller, and a test pins both functions' call sites.
- **Contract.** Error code `READ_ONLY_PROFILE`; a "Writability" paragraph in the API description; API `1.10.0-mut39`.

### Verified
- Generated route tests cover every key-only operation for a session naming a Malafat-fed profile, a personal profile and a non-member, with nothing written. They also cover the AC's income, receivable, payment and customer writes, lazy posting as `SYSTEM` on all seven reads, and that the other profile's organization id never reaches any store call.
- Mutation checks: with layers 1–2 off, the AC cases fail. Lazy posting without `unguarded` gets 403 on every read, which shows the guard is beneath them.
- `npm test`: 924 passed, 9 skipped. `npm run test:db`: 978 passed. The local test database was re-migrated first: it had only the first of nine migrations applied.
- lint, typecheck, build and `openapi:check` pass.

### Not in this ticket
- The expense AC ("an expense write succeeds"; "Malafat's key cannot see, read or write expenses"): no expense routes or store methods exist until MUT-42.
  - The guard rule is tested: a session may write expenses, the key may not.
  - Expense routes will declare `[{ session: [] }]`.

---

## [Unreleased] - 2026-10-11 — MUT-38: session auth, a second principal beside API keys

**Scope:** `server/` only:
- `prisma/schema.prisma` and migration `20261011042708_mut38_sessions_user_actor` (`sessions` table, `AuditActorType` + `USER`)
- `src/auth/{sessions,writability,middleware}.ts`, `src/routes/sessions.ts`
- `src/routes/{admin-users,agreements,attachments,customers,fee-proposals,import,installments,integration,payments,projects,receivables,retainers,summaries,vat}.ts`
- `src/{app,index,config,errors,logger,schemas}.ts`, `src/repositories/{ports,memory,prisma}.ts`, `src/scripts/users.ts`
- `infrastructure/terraform/{main,outputs}.tf`, `.env.example`, `README.md`, `DEPLOYMENT.md`, `openapi/openapi.yaml`, `package.json`
- tests: `src/auth/__tests__/sessions.test.ts`, `src/__tests__/{routes-sessions,route-security,logger}.test.ts`, `src/repositories/__tests__/store-{contract,memory,prisma}-sessions*`; additions to the `config` and `users-cli` tests; version pins in `routes-m*`

### Added
- **Sign-in, sign-out, `/v1/me`.**
  - `POST /v1/sessions` sets an httpOnly, `Secure`, `SameSite=Strict`, `__Host-mut_session` cookie on the API's own origin. The token is 32 random bytes; only `HMAC-SHA256(SESSION_TOKEN_PEPPER, token)` is stored.
  - Sessions expire after 120 minutes idle (activity slides the deadline) and 12 hours absolute.
  - `DELETE /v1/sessions/current` revokes the session server-side and clears the cookie.
  - `GET /v1/me` lists the hosted profiles the person may open, each with `source`, `writerOfRecord` and `access`.
- **Sign-in never reveals accounts.**
  - Unknown email, wrong password, disabled user and locked account all get the same `401 INVALID_CREDENTIALS`.
  - Each attempt runs exactly one argon2 verify; an unknown email is verified against a pre-warmed dummy hash with the same parameters.
  - Lockout (5 failures in 15 minutes → locked 15 minutes) keys on the normalised email whether or not it exists.
  - Attempts are capped at 20 per minute per client IP, taken from the trusted `X-Forwarded-For` hop.
  - Sign-ins (`user.signed_in`, actor `USER`) and locks (`user.locked_out`, actor `SYSTEM`) are audited on each member organization.
- **One principal per request, declared per route.**
  - `authenticate()` replaces `apiKeyAuth` on `/v1/*` and enforces each operation's OpenAPI `security`, using an index built from the registry. A request carrying both credentials gets 401 `ambiguous_credentials`.
  - Non-GET session requests and sign-in must be same-origin, otherwise `403 CROSS_SITE_REQUEST`.
  - Sessions select an organization with `X-Mutaba3a-Profile`: missing → `422 PROFILE_REQUIRED`; non-member → 404 (ADR-025 §2 amended for sessions only).
  - Sessions are rate-limited like keys.
- **The portal's 20 read routes accept sessions.** These are the GET routes in the `read` rows of the writability matrix, now a const in `auth/writability.ts`. Session scopes come from it. Lazy posting during a session read is audited as `SYSTEM`.
- **Operator controls.**
  - An operator reset or a disable revokes all of the user's sessions.
  - New `POST /admin/v1/users/{id}/sessions/revoke` route, and `npm run revoke:sessions`.
  - A session is also void once its user is disabled or their password changes.
- **Contract.** Error codes `INVALID_CREDENTIALS`, `SESSION_EXPIRED`, `PRINCIPAL_NOT_ACCEPTED`, `CROSS_SITE_REQUEST`; reason `PROFILE_REQUIRED`; a `session` cookie security scheme; audit actor `USER`; API `1.9.0-mut38`.
- **Configuration and Terraform.**
  - Config: `SESSION_TOKEN_PEPPER` (required, ≥ 32 characters), `SESSION_IDLE_MINUTES`, `SESSION_ABSOLUTE_HOURS`, `PORTAL_ORIGIN` (optional), `TRUSTED_PROXY_HOPS`.
  - Terraform generates, stores and mounts the pepper secret `mutaba3a-api-session-pepper` (moved forward from MUT-45 so `main` stays deployable).

### Changed
- **Handlers.** Key-only handlers read `keyAuth(c)` instead of destructuring `auth.apiKey`. Session-reachable handlers use `postingActorOf(c)`.
- **Log redaction (TD-039 resolved).** Every sensitive key, now including cookies, `Set-Cookie`, `password` and `sessionToken`, is redacted at depths 0–3, and a test pins it.

### Verified
- Server gates: lint, typecheck, `openapi:check`.
- `npm test`: 466 passed. `npm run test:db`: 520 passed.
- `terraform validate` (scratch copy).
- HTTP smoke against a running server: sign-in, `me`, a scoped read, `PROFILE_REQUIRED`, `PRINCIPAL_NOT_ACCEPTED`, sign-out, replay refused, bad password. Zero log lines contained the token or password.

## [Unreleased] - 2026-10-11 — MUT-37: operator-only user accounts on the hosted service

**Scope:** `server/` only:
- `prisma/schema.prisma` and migration `20261011040107_mut37_users_memberships`
- `src/auth/users.ts`, `src/config.ts`
- `src/repositories/{ports,memory,prisma}.ts`
- `src/routes/admin-users.ts`, `src/schemas.ts`, `src/serializers.ts`, `src/app.ts`, `src/index.ts`
- `src/scripts/users.ts`, `package.json` (+ `@node-rs/argon2` 2.2.1, six npm scripts)
- `openapi/openapi.yaml`, `README.md`, `DEPLOYMENT.md`
- tests (new): `src/auth/__tests__/users.test.ts`, `src/__tests__/{config,routes-users,no-self-registration}.test.ts`, `src/repositories/__tests__/store-{contract,memory,prisma}-users*`, `src/scripts/__tests__/users-cli.test.ts`
- `src/__tests__/routes-m{2,3,4,5,6,8}.test.ts`: version pin only

No `src/` (app) change.

### Added
- **Users and memberships.** `users` and `memberships` tables via an additive migration. A user isn't organization-scoped: a person can belong to several firms. Creating a user always creates its first membership in the same transaction.
- **Password hashing.** argon2id via `@node-rs/argon2` behind a `PasswordHasher` port. `ARGON2_MEMORY_KIB`, `ARGON2_TIME_COST` and `ARGON2_PARALLELISM` default to OWASP profile 1, and the service refuses to boot below it.
- **Admin routes** behind `X-Admin-Token`:
  - `POST /admin/v1/users` returns a one-time password, shown once.
  - `GET /admin/v1/users?email=` and `GET /admin/v1/users/{id}`.
  - Grant and remove memberships.
  - Operator password reset.
  - Disable and enable.
- **Audit.** Every account change is audited as `ADMIN` on each member organization: `user.created` (with email and display name), `membership.granted`, `membership.revoked`, `user.password_reset`, `user.disabled`, `user.enabled`.
- **Operator CLI** `src/scripts/users.ts`, run as `npm run provision:user`, `grant:user`, `revoke:user`, `rotate:password`, `disable:user` and `enable:user`. It is a function over an injected fetch and is tested against the in-process app.
- **No self-registration test.** No route or published path outside `/admin/` may match signup, register, invite, forgot or reset.
- API version `1.8.0-mut37`.

### Changed vs the original MUT-37 ticket (per its MUT-36 re-cut)
- There is no `organizationId` on the user and no owner/member roles.
- The audit actor is `ADMIN`, because the admin token carries no person.
- **Session invalidation on reset and disable moved to MUT-38**, which introduces sessions.
- `enable` was added as the inverse of `disable`, so a mistaken disable doesn't need database surgery.

### Technical
- **TD-040 (new):** audit rows written in the same millisecond have no defined order (`(createdAt, id)` with a random UUID tie-breaker in both stores). This causes an intermittent `routes-m6` failure under full-suite load, seen once in three runs and never in 20 isolated runs. It predates MUT-37.

## [Unreleased] - 2026-10-11 — MUT-36: hosted portal design brief and ADR-037 (approved)

**Scope:** `.claude/designs/hosted-portal.md` (new), `.claude/{DECISIONS,TECH_DEBT,COMPONENT_REGISTRY,CHANGELOG}.md`.
Docs only; no code. Gates MUT-37/38/39/42/43/44/45 (epic MUT-34).

### Added
- **Design brief** deciding the four forks that block the hosted build stories:
  - the portal is a hosted-only Vite build target served same-origin by the API, not the existing app repointed through the MUT-35 registry;
  - a hosted profile is `Membership × Organization`, with `ProfileSource = 'local' | 'hosted'` as a client-side union;
  - one parseable writability matrix, enforced as effective scopes, principal declarations and a compiler-exhaustive store guard;
  - httpOnly `__Host-` cookie sessions beside API keys, with routes declaring principals in the OpenAPI `security` field.

  It also re-cuts MUT-37/38/39/42/43/44/45.
- **ADR-037** (approved by the owner as written on 2026-10-11). It extends ADR-025 with a user principal and amends ADR-025 §2 for sessions only (`X-Mutaba3a-Profile` header, non-member → 404). It states that ADR-013 is untouched and that hosted profile data is a separate dataset from local profile data.
- **TD-037:** the sync op-log has no `profileId` concept. Recorded, deliberately not built.
- **TD-038:** en/ar translation drift (30 `retainers.*` keys missing in en); parity is tested for `settings.features` only.
- **TD-039:** server log redaction is untested and pino's `*.x` wildcards are one level deep. MUT-38 resolves it; the MUT-38 AC that assumed an existing redaction test is corrected in the brief.

### Changed
- **ADR-023:** override note. Its "no account system, no password storage, no session" clause no longer describes the hosted service. The rest of the ADR still governs the desktop's Malafat connection.
- **TD-018:** correction. Users are operator-issued like keys, with no self-serve signup, invite or reset; "Mutaba3a keeps no account system" no longer holds.
- **TD-013:** the synced-decorator upgrade no longer waits on MUT-43, because the portal doesn't inject into the registry. It now waits on the SQLite swap.
- **COMPONENT_REGISTRY:** `DataTable` and `CellAmount` are listed but don't exist (`src/components/tables/` is absent); a correction note points at the real page-local tables.

## [Unreleased] - 2026-10-11 — "Review now" fixes unassigned records in place

**Scope:** `src/components/drawers/OrphanedRecordsDrawer.tsx` (new),
`src/db/orphanedRecords.ts` (new), `src/hooks/useOrphanedRecords.ts` (new),
`src/components/layout/{OrphanedRecordsBanner,AppShell}.tsx`,
`src/db/integrityCheck.ts`, `src/lib/stores.ts`, `src/index.css`,
`src/pages/{clients/ClientsPage,projects/ProjectsPage}.tsx`,
`src/lib/i18n/translations/{en,ar}.json`, `src/lib/i18n/types.ts`,
`src/components/modals/{OrphanedRecordsModal.tsx,OrphanedRecordsModal.css,index.ts}`
(deleted / export removed), tests below,
`.claude/designs/orphan-banner-review{,-tests}.md`,
`.claude/{CHANGELOG,TEST_PLAN,COMPONENT_REGISTRY,PATTERNS,TECH_DEBT,SYSTEM_OVERVIEW}.md`.

### Fixed
- The orphaned-records banner's **Review now** was `<a href="/settings">`.
  On the web build (router `basepath: '/app'`) it did a full page load to
  `/settings`, outside the PWA scope and the service worker's offline
  fallback (verified in the dev build). On desktop it reloaded the app.
  Settings could only count the records anyway. It's now a button that opens
  the new **Unassigned records** drawer over the current page.
- Clients and Projects opened the assign modal by themselves whenever an
  unassigned client/project existed, and **Cancel couldn't close it**: the
  page set it open again during render. The pages no longer open anything;
  the banner is the one entry point.
- Unassigned income entries and expenses, which the banner counts, couldn't
  be fixed anywhere. The drawer covers all four kinds.

### Added
- `OrphanedRecordsDrawer`: clients, projects, income and expenses grouped
  with counts. With one profile it offers "Assign all to ‹profile›"; with
  several, "Assign all to ‹default›" plus a picker per row and Save. A row
  starts on its linked client's profile, then its project's, then the
  default. Rows that fail stay listed with a message; the rest are saved.
- `src/db/orphanedRecords.ts`: `isOrphaned` (the one definition of
  "unassigned", now also used by `runIntegrityCheck`), `findOrphanedRecords`,
  `startingProfileId`.
- `useOrphanedRecords` / `useAssignOrphanedRecords`: row-by-row writes through
  the `base` repositories, then every query refetches.

### Removed
- `OrphanedRecordsModal` (+ CSS, 10 tests, barrel export); the
  `orphanedRecords.description.*`, `assignIndividually`, `assignAllToDefault`
  and `or` keys.

### Debt
- TD-035 (locked unassigned income can't be assigned: lock rule unchanged,
  ADR needed) and TD-036 (client/project drawers save `profileId: undefined`
  for the "Default profile" option).

### Verified
- `npx tsc -b` clean; `npm run lint` 0 errors (17 warnings, all in files
  this change doesn't touch); `npx vitest run` after merging main (with
  MUT-8, f210b31): 139 files, 2,306 passed, 5 skipped, 0 failed.
- Browser pane, web dev build: Review now opens the drawer with the URL still
  `/app/` and no document reload; Arabic/RTL layout; Save assigned 6 records
  as suggested, the banner disappeared and the toast showed the count.

---

## [Unreleased] - 2026-10-11 — MUT-8: Home is owed now, needs attention and recent payments

**Scope:** `src/pages/overview/OverviewPage.tsx`, `src/components/home/{HomeNeedsAttention,HomeRecentPayments}.tsx` (new),
`src/components/home/{PredictiveKpiStrip,MonthActualsRow,AttentionFeed,KpiCard}.tsx` (deleted) and their tests,
`src/db/{repository,interfaces}.ts`, `src/sync/core/synced-repository.ts`, `src/hooks/useQueries.ts`,
`src/types/index.ts`, `src/index.css`, `src/lib/i18n/*`, `src/__tests__/noDeadHomeModules.test.ts` (new),
`docs/ux-redesign/UX-REDESIGN-SPEC.md`, `.claude/designs/{insights-reintegration,mut-1-client-accounting-core,mut-8-home-owed-attention-payments}.md`,
`.claude/{CHANGELOG,DECISIONS,COMPONENT_REGISTRY,PATTERNS,TECH_DEBT,TEST_PLAN,SYSTEM_OVERVIEW}.md`.
Branch `feature/mut-1-client-core`.

### Changed
- **Home is three blocks** (ADR-036):
  - **Owed now:** the largest figure on the page, per currency, with the
    overdue part called out, over every receivable in the active profile.
  - **Needs attention:** every overdue item and every item due within 7 days,
    in all currencies, oldest due date first. Each row shows the client, what
    it was for, the remaining amount and "Nd overdue", "Due in Nd" or "Due
    today".
  - **Recent payments:** the last 10, with date, amount, client and what each
    was for. Income saved as Received is included.
- **Every row opens its client profile**, or the entry when it has no client.
- **A new install that skipped onboarding** now sees one action, **Add
  income**, instead of zeroes.

### Removed
- The forecast strip ("Will I make it?", cash on hand, coming/leaving), the
  month-actuals row, the guidance attention feed (which never showed EUR) and
  "Recent activity", by Basel's decision (D10 = B). That covers
  `PredictiveKpiStrip`, `MonthActualsRow`, `AttentionFeed` and
  `KpiCard`/`KpiStrip`.
- Their five test files, about 600 lines of `.kpi-*`, `.attention-*` and
  `.actuals-*` CSS, and the `home.*`, `overview.recentActivity` and
  `overview.noRecent` keys.
- A guard test keeps the deleted files gone. MUT-58 prunes the money-event
  read side they leave unused (TD-034).

### Fixed
- **Onboarding, and the new empty state, flashed on every Home load.** The
  clients and entries queries looked empty while Dexie was still reading.
  Home now shows a spinner until both have answered.

### Technical
- `paymentRecordRepo.listRecent({ profileId, limit = 10 })`, plus
  `useRecentPayments`, keyed under `['paymentRecords']` so every write
  refreshes it.
- `getAttentionReceivables` breaks equal due dates by client name, then id.
  Its 7-day window, every-currency coverage and archived exclusion are now
  pinned by tests.
- **Tests:** +32 new: OverviewPage 15, attention 5, `listRecent` 6, refresh 1,
  guard 5. 59 tests left with the deleted components. Full suite 2,258
  passed, 5 skipped, 0 failed. Lint 0 errors, typecheck clean.
- **Browser check:** 1280px in English and 1024px in Arabic on seeded data.
  Values matched expectations, rows opened their clients, there was no
  horizontal scroll, and no onboarding flashed. The brand-new-install empty
  state is covered by tests only.

---

## [Unreleased] - 2026-10-11 — Settings › Data Tools messages follow the app language

**Scope:** `src/pages/settings/DataToolsSection.tsx` (new, moved out of
`SettingsPage.tsx`), `src/pages/settings/SettingsPage.tsx`,
`src/lib/i18n/translations/{en,ar}.json`, `src/lib/i18n/types.ts`,
`src/pages/settings/__tests__/DataToolsSection.test.tsx` (new),
`.claude/{CHANGELOG,TEST_PLAN,COMPONENT_REGISTRY,TECH_DEBT}.md`.

### Fixed
- The integrity check's result line and toasts were hardcoded English
  ("All N records verified…", "Found N issue(s) across N records.",
  "Data integrity check passed", "N data integrity issue(s) found",
  "Integrity check failed"), with an English-only `issue${n !== 1 ? 's' : ''}`
  plural. They now come from `integrity.checkClean`,
  `checkIssuesSingular/Plural`, `checkFailed`, `toastClean` and
  `toastIssuesSingular/Plural`, with `{count}` / `{total}` filled by `t()`.
- The backup and restore toasts in the same section were hardcoded too
  ("Backup downloaded", "Backup failed", "Restored N records from backup (vN)",
  "Import failed"). They now use `settings.backupDone`, `backupFailed`,
  `importBackupDoneSingular/Plural`, and the existing
  `settings.data.importFailed` ("Import failed: {error}").
- A scan that stopped part-way said "Found 0 issues…" and toasted
  "0 data integrity issues found": `runIntegrityCheck` reports failures in
  `result.error` instead of throwing, so the page's `catch` never ran. An
  `error` now takes the failure path (toast `integrity.checkFailed`, the row
  goes back to its default description).

### Changed
- English copy reads correctly for 0 and 1 records: "No issues found. Records
  checked: 42." / "Found 1 issue. Records checked: 1." The old "All 1 records
  verified" and "All 0 records verified" are gone.
- Arabic plurals use a "label: {count}" phrasing (e.g. "عدد المشكلات: {count}")
  that reads correctly for 2, 3–10 and 11+, as in the orphaned-records banner.
- The result line is stored as numbers and worded at render, so switching
  language on the Settings page rewords it. It used to stay in the language it
  was produced in.
- `DataToolsSection` moved to its own file, as `AdvancedFeaturesSection` did,
  so it can be tested without the whole Settings page.
- `Translations` now lists the integrity-check keys and every Data Tools key
  under `settings`, so `tsc -b` fails if either locale drops one (checked by
  deleting `integrity.checkClean` from ar.json).

---

## [Unreleased] - 2026-10-11 — MUT-7: the clients index answers "who owes me, and who is late"

**Scope:** `src/pages/clients/ClientsPage.tsx`, `src/components/clients/clientIndexRows.ts` (new),
`src/components/ui/SortableHeader.{tsx,css}` (new), `src/db/{aggregations,repository}.ts`,
`src/types/index.ts`, `src/lib/utils.ts`, `src/index.css`,
`src/lib/i18n/{types.ts,translations/en.json,translations/ar.json}`, tests beside each,
`.claude/{CHANGELOG,DECISIONS,COMPONENT_REGISTRY,PATTERNS,TECH_DEBT,TEST_PLAN,SYSTEM_OVERVIEW}.md`,
`.claude/designs/mut-7-clients-who-owes-me.md`. Branch `feature/mut-1-client-core`.

### Changed
- `/clients` columns are now **Client · Owed Now · Overdue · Last Payment ·
  Last Activity**:
  - **Owed Now:** one line per currency, or **Settled** when nothing is owed.
  - **Overdue:** each late currency in the error colour with "oldest Nd", or a
    dash.
  - **Last Payment:** the date over the amount, or **Never paid**.
  - Active projects and received are gone.
- **Default order is owed now, descending**, ranked by today's exchange rate
  with nothing converted on screen (ADR-035). The header tooltip says so. The
  Overdue column sorts by days late, Last Payment and Last Activity by date,
  Client by name. Ties fall back to name, then id.
- **Click a column header to sort** (`SortableHeader`, with `aria-sort`). It
  replaces the sort dropdown and stays in the URL (`?sort=&dir=`).
- **The whole row opens the client profile**; the name is still a link.
- **The strip** shows the client count plus `OwedNowSummary` for everyone
  listed, per currency. It replaces the "Total received" and "Total unpaid"
  figures, which were converted to ILS.

### Fixed
- **Last payment ignored partial, backdated and received-at-creation
  payments.** `lastPaymentAt` was read only from fully paid entries'
  `tx.paidAt`. It now comes from the same payment rows as the profile's
  Payments section (parent-brief D6).
- **Sorting by value or unpaid added raw minor units across USD, ILS and EUR.**
- **Unpaid on the index counted archived income.** The index now reads
  `owed` (TD-030, index half).
- **The search-empty state showed raw keys** (`clients.emptyFiltered`,
  `clients.emptyFilteredCount`, `clients.clearSearch`), and the cross-profile
  badge showed a literal "txns". Both are translated in en and ar now.

### Technical
- `clientSummaryRepo.list/get` return `owed`, `oldestOverdueDays` and
  `lastPayment`. `list()` reads transactions and payment records once and
  groups them, instead of scanning every transaction once per client.
- New pure helpers in `aggregations.ts`: `paymentRowsForIncome` (the
  ADR-033 derivation, moved out of `listByClient`), `latestPayment`,
  `combineOwed`, `summarizeClientCollection` and `groupBy`.
  `OwedByCurrency` and `LastPayment` move to `src/types`.
- **Brief D4 reverted mid-build:** the per-currency paid/unpaid report fields
  stay, because Insights and Reports read them.
- `formatAmount` reuses one `Intl.NumberFormat` per locale + currency.
- Pruned: the `.clients-summary-strip/item/label` CSS,
  `clients.columns.received`, `clients.summary.totalReceived/totalUnpaid` and
  `common.sort.valueHigh/valueLow`.
- **Tests:** 21 more in total. Added: aggregations +9, client summary +9,
  `clientIndexRows` 14, `SortableHeader` 4. The page suite was rewritten from
  33 to 18. The old suite asserted the name-ascending default and
  cross-currency sums.
- **Verification:** full suite 2,222 passed, 5 skipped, 0 failed. Lint 0
  errors (17 pre-existing warnings), typecheck clean.
- **Browser check** on seeded data at 1280px and 1024px, in English and
  Arabic. Order matched the ranking by rate. Archived client and archived
  income were excluded. Last payment covered a partial payment, income saved
  as received and a backdated Mark paid. The row opened a profile that agrees
  with its index row. No horizontal scroll, and amount columns align to the
  end edge in RTL.

---

## [Unreleased] - 2026-10-11 — MUT-15: the sidebar is Home / Clients / Income / Settings

**Scope:** `src/components/layout/{SidebarNav,TopBar,AppShell}.tsx`, `src/components/layout/addMenuActions.ts` (new),
`src/hooks/useMenuButton.ts` (new), `src/lib/features/{features,routeGuard}.ts`,
`src/components/onboarding/{OnboardingOverlay,OnboardingStepIndicator}.tsx`, `src/index.css`,
`src/lib/i18n/translations/{en,ar}.json`, `e2e/navigation.spec.ts`; tests
`src/components/layout/__tests__/{SidebarNav.features,TopBar.addMenu,addMenuActions}.test.*`,
`src/hooks/__tests__/useMenuButton.test.tsx`, `src/lib/features/__tests__/{features,leaveDisabledArea}.test.*`,
`src/components/onboarding/__tests__/OnboardingOverlay.projects.test.tsx`, `src/pages/clients/__tests__/ClientDetailPage.test.tsx` (mock);
`.claude/{DECISIONS,SYSTEM_OVERVIEW,COMPONENT_REGISTRY,PATTERNS,TECH_DEBT,TEST_PLAN}.md`; brief
`.claude/designs/mut-15-sidebar-core-four{,-tests}.md`. Branch `feature/mut-2-strip-core`. ADR-034.

### Changed
- **Sidebar core.** One header-less group, Home → Clients → Income, that no
  switch can move (a constant rendered above "More"). The "Main" and
  "Workspace" headers are gone; "More" and "System" stay. Fresh install: exactly
  Home, Clients, Income, Settings.
- **`+ Add` menus.** The sidebar **New** menu and the top bar **Add** menu read
  one list (`visibleAddMenuActions`) and now offer the same order: Income,
  Client, then Expense / Project while those areas are on (the top bar used to
  list Income, Expense, Project, Client).
- **Keyboard.** Both menus follow the menu-button pattern (`useMenuButton`):
  opening focuses the first item, ArrowUp/Down/Home/End move, Escape closes and
  returns focus to the button, Tab and outside clicks close. Before, the
  sidebar menu declared `role="menu"` but ignored arrows and the top bar menu
  had no roles and did not return focus.
- **Onboarding (TD-027).** The step indicator takes its step list from the
  overlay: with projects off a fresh install sees steps 1–2, not a pre-ticked
  "Project" step 2.

### Added
- **Leaving a switched-off area.** `useLeaveDisabledArea` (mounted in
  `AppShell`) re-runs the route guards (`router.invalidate()`) when any area
  goes from on to off, so a page whose area was switched off, for example in
  another window of the web build, lands on Home with `replace`. Verified in
  the browser with two tabs.

### Fixed
- **Collapsed sidebar.** The collapse chevron and the expand button were
  absolutely positioned with no containing block in the sidebar, so they
  floated at the window's top-right (beside `+ Add`) and bottom-centre (behind
  the download banner). Both are in flow now: chevron under the brand, expand
  button under Settings. A hairline separates the core group from "More"
  while headers are hidden.
- **RTL.** The collapse chevron pointed the wrong way in Arabic; it now points
  toward the edge the sidebar collapses to in all four direction × state
  combinations (checked in the browser).

### Removed
- `nav.sections.main | workspace | work | money` (en, ar): unused.
- `SidebarNav`'s `/download` external-link branch and a commented-out icon.

### Technical
- `e2e/navigation.spec.ts` rewritten for the core four (it walked Overview →
  Projects → Transactions → Reports from the landing page). Run locally: 2/2
  pass. The other 13 e2e cases fail for reasons that predate this change
  (TD-004 updated).
- Verification: `npm run lint` 0 errors (17 pre-existing warnings, none in
  changed files); `npm run typecheck` and `npx tsc -b` clean; full suite
  134 files, 2,207 passed, 5 skipped, 0 failed (baseline 130 / 2,149);
  `npm run build` succeeds.

---

## [Unreleased] - 2026-10-11 — Orphaned-records banner shows text, not i18n keys

**Scope:** `src/components/layout/OrphanedRecordsBanner.tsx`,
`src/lib/i18n/translations/{en,ar}.json`, `src/lib/i18n/types.ts`,
`src/components/layout/__tests__/OrphanedRecordsBanner.test.tsx` (new),
`.claude/{CHANGELOG,TEST_PLAN}.md`.

### Fixed
- With records saved without a `profileId`, the banner read
  "8 integrity.orphanedRecordPlural" and its link "integrity.reviewNow", in
  both languages (seen 2026-10-11 on a dev build). Neither locale file had an
  `integrity` section. The `|| 'fallback'` strings in the banner never ran,
  because `t()` returns the key itself when one is missing.
- Added `integrity.orphanedRecordSingular`, `orphanedRecordPlural`,
  `reviewNow` and `dismiss` to en.json and ar.json, and the section to the
  `Translations` type, so `tsc -b` fails if either file drops it.

### Changed
- The banner passes `{ count }` to `t()` instead of printing the number before
  the translated phrase, so each language places the number itself. The
  Arabic plural is a "count: N" label ("عدد السجلات غير المرتبطة بأي ملف
  تجاري: {count}"). It reads correctly for 2, 3–10 and 11+, which a fixed
  "{count} سجلات" does not.
- The dismiss button's `aria-label` is translated (was hardcoded "Dismiss").
  The dead fallback strings are gone.

---

## [Unreleased] - 2026-10-11 — Release commit carries both lockfiles (v0.0.65 Windows build failure)

**Scope:** `deploy.sh`, `scripts/release.ts`, `scripts/release-files.ts` (new),
`scripts/__tests__/release-files.test.ts` (new), `vitest.config.ts`,
`.claude/{CHANGELOG,TEST_PLAN,CI_CD}.md`.

### Fixed
- The v0.0.65 Windows build ([run 38106560692](https://github.com/vAWK3/mutaba3a/actions/runs/38106560692))
  failed the Tauri CLI's npm-vs-crate version check: `tauri (v2.11.2) :
  @tauri-apps/api (v2.12.1)` and `tauri-plugin-opener (v2.5.5) :
  @tauri-apps/plugin-opener (v2.7.0)`. The tag held a `Cargo.toml` requiring
  tauri 2.12.1 (an uncommitted dependency bump the release commit swept in)
  beside a `Cargo.lock` still pinning 2.11.2. `build_mac` had rewritten the
  lock on disk, but `tag_and_push` only staged `package.json`,
  `tauri.conf.json` and `Cargo.toml`. Every tag back to at least v0.0.58 held
  a `Cargo.lock` at least one app version behind, fixed up by hand later (`0c57247 misc`).
- `tag_and_push` now stages `package-lock.json` and `src-tauri/Cargo.lock`
  with their manifests, so the tag holds the lock the mac build used.
- Both version writers (`update_version` in deploy.sh, `writeVersionFiles` in
  release.ts) use `npm version --no-git-tag-version`, which also bumps
  `package-lock.json`'s own version. That version was stuck at 0.0.63.

### Changed
- `npm run release` now warns when a file that goes into the release commit is
  already modified before the bump, and prints the `git diff` to review. This
  is the change that let v0.0.65's tauri bump ride in without notice. The
  "left out" warning now lists the files from the shared list.
- The release-commit file list lives in `scripts/release-files.ts`
  (`RELEASE_COMMIT_FILES`). A test asserts it equals the paths deploy.sh's
  `git add` stages, so the two cannot drift.

### Considered and dropped
- A `cargo metadata --locked` preflight. It would not have caught this
  failure: `cargo update --workspace` makes the lock satisfy `Cargo.toml`
  while leaving `tauri-plugin-opener` at 2.5.5 against npm's 2.7.0. Once the
  lock is committed, `tauri build` on the mac already runs the same version
  check against exactly the files that get tagged.

### Not done here
- v0.0.65 still has no Windows installers. Either cut v0.0.66 (pushes
  `0c57247` with the fixed lock) or move the `v0.0.65` tag to `0c57247` and
  re-run `build-windows.yml`. Both need a push by the operator.

---

## [Unreleased] - 2026-10-11 — MUT-3: the client profile is one page answering the three questions (with the MUT-4 Payments UI)

**Scope:** `src/pages/clients/ClientDetailPage.tsx`,
`src/components/clients/{OwedNowSummary,ClientWorkSection,ClientPaymentsSection}.tsx` (new),
`src/components/clients/clientProfileRows.ts` (new), `src/db/{aggregations,repository,database}.ts`,
`src/types/index.ts`, `src/hooks/{useQueries,useIncomeQueries}.ts`, `src/index.css`,
`src/lib/i18n/{types.ts,translations/en.json,translations/ar.json}`, tests beside each,
`.claude/{CHANGELOG,DECISIONS,COMPONENT_REGISTRY,PATTERNS,TECH_DEBT,TEST_PLAN,SYSTEM_OVERVIEW}.md`,
`.claude/designs/mut-3-client-profile{,-tests}.md`. Branch `feature/mut-1-client-core`.

### Changed
- `/clients/:id` loses its four tabs. One page now shows, top to bottom: the
  contact details and **Owed now** (the largest figure on the page, one amount
  per currency, overdue part called out or "Nothing overdue", "Nothing owed"
  when settled); **Work and billing** (every income entry: date, title,
  project tag, amount, status, remaining balance on partial rows, due/overdue
  line; date range + status + search as one filter object; Record payment,
  Mark paid, invoice actions, duplicate); **Payments** (full history newest
  first: date, amount, what it was for, notes). Retainers card unchanged
  below, while Retainers is on.
- A client with no work shows one primary action, **Add income**, which opens
  the income drawer for that client; filters that match nothing say so and
  offer **Clear filters** instead.
- The project is a tag inside the "What" cell — a link while Projects is on,
  text while off (MUT-16), absent when unset.
- Removed from the page: the stats strip (active projects, paid income,
  unpaid, expenses), Recent activity, the Projects table, expense rows.

### Fixed
- **Owed now was always zero on the client page.** The old strip read
  `unpaidIncomeMinorUSD/ILS/EUR`, which `clientSummaryRepo.get` never returns,
  and showed them through `CurrencySummaryPopup`, which converts to one ILS
  sum. `summarizeOwedByCurrency` (ADR-033) replaces both.
- **Payment history missed income saved as Received.** Such entries are
  marked paid with no `PaymentRecord`; `listByClient` now adds one `entry`
  row per uncovered amount (ADR-033 §3, TD-029 for the write-side fix).
- **Payment lists went stale after Mark paid**, retitling or deleting an
  entry, for the 60s staleTime: transaction and income writes now invalidate
  `['paymentRecords']` too (also refreshes the payment drawer's history).
- `listByClient` date bounds compare the calendar date of `paidAt`, so a
  payment stored as a timestamp on the `dateTo` day is included.
- The v18 migration's English note ("Migrated from accumulated total") shows
  as the existing `transactions.partialPayment.migratedNote` translation.
- MUT-23: the discarded `useProjects(clientId)` call is gone.

### Technical
- New: `summarizeOwedByCurrency`, `OwedByCurrency` (`aggregations.ts`);
  `PaymentByClientRow.source: 'record' | 'entry'`; `invalidatePaymentRecordLists`;
  `MIGRATED_PAYMENT_NOTE` (`database.ts`, value-identical, v18 upgrade
  unchanged); `toWorkRow` / `WorkRow` (`clientProfileRows.ts`).
- i18n: `clients.profile.*` added in en + ar; dead `clients.tabs`,
  `clients.receivables` and ten `clients.detail.*` keys pruned from both files
  and from `Translations`.
- Tests: +45 (8 owed-now, 8 `listByClient`, 4 invalidation incl. a real-Dexie
  Mark paid → Payments refresh, 7 row shaping, 5 `OwedNowSummary`, page suite
  rewritten to 34). Full suite 2,194 passed, 5 skipped, 0 failed; lint 0
  errors; typecheck and build clean. `npm run test:tz` has 4 failures, all
  pre-existing on `main` (TD-014 note).
- Browser check at 1024 and 1280 px, English and Arabic: no horizontal
  scroll, Owed now is the largest text (30px), amounts stay LTR in Arabic,
  Mark paid updates Owed now and Payments without a reload.

---

## [Unreleased] - 2026-10-10 — Money v1 handover refreshed for M8 and the pilot

**Scope:** `.claude/designs/money-v1-handover.md`, `.claude/CHANGELOG.md`. Docs only; no code.

### Changed
- The handover now records the real state rather than the 2026-10-08 one: M1–M8
  merged and pushed in both repos, the Mutaba3a server deployed, Malafat
  production on `web@2.2.2` (M1–M7, not M8), and the pilot firm onboarded with
  its manual runbook still to walk.
- New §2 "Ship M8 to both sides together". Malafat M7 against Mutaba3a M8
  breaks only the fee-proposal actions: `/agree` is gone, `/approve` changed
  its body, and `feeProposalId` was dropped from agreement creation.
- New §2a records a read-only check for databases that ran the **original** M7
  migration. M8 edited it in place (D20), and `prisma migrate deploy` never
  re-runs an applied migration. Such a database has no `APPROVED` enum value
  and needs a forward repair migration, which is not written yet.
- §5 lists the follow-up tickets filed today: MUT-56 (malware scan, gates GA),
  MAL-950 (native ar/he review), MAL-951 (375px LTR/RTL pass) and MAL-952
  (closing a matter archives its project; D19 copy). It also lists the still-open
  MUT-28, MAL-870 and MAL-150.

## [Unreleased] - 2026-10-10 — TD-028: every by-id query hook resolves `null`, not `undefined`, for a missing row

**Scope:** `src/hooks/{useQueries,useIncomeQueries,useExpenseQueries,useRecurringExpenseQueries,useRetainerQueries,usePlanQueries}.ts`,
`src/components/drawers/DocumentDrawer.tsx`, `src/pages/documents/DocumentFormPage.tsx`,
`src/hooks/__tests__/{useQueries,useIncomeQueries,useRecurringExpenseQueries}.test.tsx`,
`src/hooks/__tests__/{useExpenseQueries,useRetainerQueries,usePlanQueries}.test.tsx` (new),
`.claude/{CHANGELOG,PATTERNS,TECH_DEBT,TEST_PLAN}.md`.

### Fixed
- Opening a deep link whose row was deleted (`?tx=<id>`, `/clients/:id`,
  `/projects/:id`, a document, profile, expense, recurring rule, retainer or
  plan id) put that query in `error` state and logged *"Query data cannot be
  undefined"*, because every by-id hook handed the repository's `undefined`
  straight to TanStack Query v5. The 16 hooks below now normalise the absence
  to `null` (`?? null`) and are typed `UseQueryResult<Entity | null>`, the
  same shape `useDefaultBusinessProfile` got earlier today:
  `useTransaction`, `useClient`, `useClientSummary`, `useProject`,
  `useProjectSummary`, `useDocument`, `useBusinessProfile` (`useQueries`);
  `useIncomeById`; `useExpense`, `useRecurringRule` (`useExpenseQueries`);
  `useRecurringRule` (`useRecurringExpenseQueries`); `useRetainer`; `usePlan`,
  `usePlanAssumption`, `usePlanScenario`, `usePlanDefaultScenario`.
- The two summary hooks were not on the TD-028 list but have the same contract
  (`Promise<Summary | undefined>` when the parent client/project is gone), so
  they are included rather than left as a third round.

### Changed
- `DocumentDrawer` and `DocumentFormPage` derived `isReadOnly` as
  `… && existingDoc && …`, which typed as `boolean | null | undefined` once the
  hook could resolve `null` and failed 60 `disabled={isReadOnly}` props. Both
  now use `!!existingDoc`; the rendered value is unchanged (falsy either way).
  No other consumer needed a change: every one reads the value through `?.`,
  `&&` inside JSX or a truthy guard, and none reads `isError`.
- Repository contracts are untouched (`get(id): Promise<Entity | undefined>`,
  `getDefault(planId): Promise<PlanScenario | undefined>`); the hook is the
  only place the absence is normalised, per the PATTERNS Query Hooks rule.

### Technical
- Tests (TDD, all red before the hook change): a "missing row resolves to
  `null`, `isSuccess`, `isError` false, no `console.error`" case per hook.
  `useQueries.test.tsx` runs the seven `useQueries` hooks against real Dexie
  with an id that was never written; the income and recurring files mock
  `get` to resolve `undefined`; three new files cover the expense, retainer
  and plan hooks through mocked repositories (`describe.each` over the hook
  table, plus a found-row and an empty-id case each). The main-branch hooks
  for receipts, categories, vendors and recurring occurrences named in the
  original TD-028 note no longer exist after the MUT-2 strip, so they have no
  test.
- Verification: lint 0 errors (17 pre-existing warnings), typecheck clean,
  `npm run build` clean, full suite green — the 18 `ExpensesLedgerPage`
  failures recorded as pre-existing in TEST_PLAN are gone on current `main`
  (the page was removed by the MUT-2 strip).
- TD-028 resolved.

---

## [Unreleased] - 2026-10-10 — Fresh install: `useDefaultBusinessProfile` resolves to `null`, not `undefined`

**Scope:** `src/hooks/useQueries.ts`, `src/hooks/__tests__/useQueries.test.tsx`,
`.claude/{PATTERNS,TECH_DEBT,TEST_PLAN}.md`.

### Fixed
- On every fresh install (empty IndexedDB) the `['defaultBusinessProfile']`
  query's `queryFn` resolved to `undefined`, because
  `businessProfileRepo.getDefault()` returns `undefined` for "no default".
  TanStack Query v5 rejects `undefined` as query data: the query sat in
  `error` state and logged *"Query data cannot be undefined … Affected query
  key: ["defaultBusinessProfile"]"* in the console on `/app/`. The hook now
  normalises the absence to `null` (`?? null`) and is typed
  `UseQueryResult<BusinessProfile | null>`.

### Changed
- `useDefaultBusinessProfile` resolves `null` instead of `undefined` when no
  default profile exists. The three consumers (`useActiveProfile`,
  `DocumentDrawer`, `DocumentFormPage`) already read it through `?.`/truthy
  checks, so none needed a code change; the repository contract
  (`IBusinessProfileRepository.getDefault(): Promise<BusinessProfile | undefined>`)
  is unchanged, so the hosted and synced repositories are unaffected.

### Technical
- Tests: the prior "returns undefined when no default exists" case passed only
  because it waited on `isFetching === false`, which is also true in `error`
  state — it never noticed the query had failed. Replaced by two cases: the
  fresh-install case (no profiles at all) asserts `isSuccess`, `data === null`
  and no `console.error`; the "profiles exist, none default" case asserts
  `null`. The first one reproduced the exact console message before the fix.
- Verification: lint 0 errors (18 pre-existing warnings), typecheck clean,
  `npm run build` clean. Full suite: the same 18 `ExpensesLedgerPage` failures
  recorded in TEST_PLAN as pre-dating MUT-6 are still the only failures and are
  untouched here.
- Pattern note added to PATTERNS.md (Query Hooks); the other possibly-`undefined`
  `queryFn`s are logged as TD-028.

---

## [Unreleased] - 2026-10-10 — MUT-6: "Record payment" becomes a primary row action

**Scope:** `src/components/ui/RecordPaymentButton.{tsx,css}` (new) + `index.ts`,
`src/components/drawers/PartialPaymentDrawer.tsx`, `src/db/repository.ts`,
`src/hooks/useQueries.ts`, `src/lib/i18n/translations/{en,ar}.json`,
`src/pages/{clients/ClientDetailPage,income/IncomePage,projects/ProjectDetailPage}.tsx`,
7 test files (2 new), `.claude/{DECISIONS,COMPONENT_REGISTRY,TECH_DEBT,TEST_PLAN}.md`,
`TODOS.md`.

### Added
- **`RecordPaymentButton`** — the payment affordance is now a button on the row
  with the remaining balance on it, at all four surfaces: ClientDetailPage
  (receivables and transactions tabs), IncomePage, ProjectDetailPage. It owns
  the single gate (`income && paymentStatus !== 'paid' && remaining > 0`) that
  previously existed as three different inline conditions, one of which was
  missing entirely — the client receivables tab offered "Record payment" on
  settled rows. Props-in, no store import, matching the rest of `components/ui`.
- Overpayment guard in `paymentRecordRepo.create`/`.update`, inside the
  existing `rw` block so concurrent writes cannot both pass (**ADR-030**).
- i18n keys `transactions.partialPayment.{amountMustBePositive,overpayment}` in
  en and ar.

### Changed
- The payment drawer opens with the full remaining balance prefilled, so
  settling in full is one confirm; the field is still editable down to a
  partial amount, and empty when there is nothing left to pay.
- Its two hardcoded English validation strings are now translated.
- The row actions column was a fixed 40–48px sized for a kebab alone; it is now
  shrink-to-fit, so the added button cannot squeeze the amount column.
- **Behaviour reversal (ADR-030 override log):** overpayment was allowed and
  clamped, documented by two passing tests. It is rejected now, and those tests
  are rewritten to assert rejection.
- Payments on a `lockedAt` transaction keep working — that was true only by
  accident before (the recalc bypasses the lock guard); it is now named in a
  comment and pinned by a test. The `['archivedAt']` allowlist is untouched.

### Fixed
- **Stale balances after a payment (MUT-6 AC #5, a live defect).**
  `invalidatePaymentRecordQueries` never invalidated the income keys, so
  `/income` and the client Receivables tab kept showing an old status and
  remaining amount for up to the 60s staleTime right after a payment was saved.
  Adds `['income']`, `['receivables']`, `['incomeOverviewTotals']` and
  `['incomeAttentionReceivables']` — the set `markPaid` already invalidated.
- **The Overview KPI strip and attention feed went stale after every write**
  (found in QA reconciliation). Money-event views are *derived* —
  `moneyEventRepository` recomputes them from transactions, expenses and
  projected income on every read and never writes — so nothing invalidated
  their keys as a side effect. The one helper that listed them,
  `useInvalidateMoneyEvents`, had **zero callers anywhere in the app**, so the
  home page served pre-write numbers after recording a payment, creating
  income, marking paid, adding an expense or changing a retainer.
  `invalidateMoneyEventQueries` is now exported from `useMoneyEventQueries.ts`
  (beside the keys it owns, so the list still exists once) and called by all
  four write paths: `useQueries`, `useIncomeQueries`, `useExpenseQueries`,
  `useRetainerQueries`. Pre-existing and app-wide, not caused by MUT-6; fixed
  here at the owner's request because the payment path is where it cost most.
- **The payment date defaulted to the UTC date, not the local one** (AC #4,
  found in QA reconciliation). `PartialPaymentDrawer` computed "today" with
  `new Date().toISOString().split('T')[0]`, which ADR-022 forbids: a user in
  New York recording a payment at 20:30 on 15 March was handed **16 March**,
  and one in Jerusalem after midnight was handed yesterday. It now uses
  `todayISO()` like every other drawer. Pinned by two faked instants that
  straddle midnight in opposite directions, so the test is honest in both
  `Asia/Jerusalem` and `npm run test:tz`.

### Technical
- **TD-021** recorded: `invalidateIncomeQueries` and
  `invalidatePaymentRecordQueries` keep overlapping key lists. The eng review
  deliberately chose the in-place fix over extracting a shared helper.
- TODOS 3–5 from the eng review: payment-record sync ops are captured but
  `ops-engine.ts` can never apply them (MUT-55); a failed refetch after a
  successful write is silent app-wide; "Mark paid" and "Record payment" are now
  two-click duplicates that disagree about the date (decide after MUT-18).
- Pre-existing and untouched: the 18 `ExpensesLedgerPage` test failures.
---

## [Unreleased] - 2026-10-10 — MUT-49: updater public key restored to BEDF931CA1D6C777

**Scope:** `src-tauri/tauri.conf.json`, `src/lib/__tests__/updater-config.test.ts` (new), `.claude/DECISIONS.md` (ADR-031, ADR-027 merge, index), `.claude/TECH_DEBT.md` (TD-022), `.claude/TEST_PLAN.md`, `.claude/PATTERNS.md`, `.claude/CI_CD.md`, `.github/workflows/build-windows.yml`. Epic MUT-48.

### Fixed
- `plugins.updater.pubkey` is back to the pre-`ae9fb1c` value, byte-identical to
  `~/.tauri/mutaba3a.key.pub`. The 2026-10-05 rotation pointed the app at a key
  (`AB7B64537B1DE22C`) whose private half never signed a published release
  and is not configured anywhere the pipeline signs from. Every real signer
  (the macOS release signer, the CI secret, the v0.0.63 signatures) is
  `BEDF931CA1D6C777`. No shipped build embeds the wrong key
  (`ae9fb1c` is not an ancestor of `v0.0.63`), so the revert is
  backward-compatible.

### Added
- `src/lib/__tests__/updater-config.test.ts`: pins the configured public key
  to the canonical base64 string and asserts the key id from the key bytes
  (line 2, bytes 2..10), printing both fingerprints on mismatch. Written red
  against the `AB7B...` config, green after the revert.
- ADR-031: the key is canonical; a real rotation ships the new public key in a
  release signed by the old key before signing switches, and that transitional
  release is necessary, not sufficient (late clients still reinstall).
- TD-022: the release-time guards deferred to MUT-51.
- `.claude/CI_CD.md`: the Tauri troubleshooting row no longer says to
  regenerate the signing key on a bad signature (that is how `ae9fb1c`
  happened); the updater secret names now match the real workflow. The
  Windows workflow's "latest.json not found" hint points at `./deploy.sh`, and
  the workflow runs `updater-config.test.ts` against the release tag before
  `tauri build`, so the guard executes on the path that compiles the key into
  the Windows build. The macOS script's test gate is MUT-51 (TD-022).

### Technical
- `.claude/DECISIONS.md` carried two `## ADR-027` headings (the 2026-10-09
  fee-proposal record and its 2026-10-10 override). They are now one ADR-027
  with two dated sections; ADR-028 and ADR-029 keep their numbers because
  CHANGELOG, TEST_PLAN, TECH_DEBT and the designs cite them. The `## ADR-XXX`
  inside the Decision Template is the template, not a placeholder to fill.
- Release-time checklist for the ticket's acceptance criteria 3 and 4 lives
  on MUT-49; the shell signer-vs-config check and the dead
  `UPDATER_PRIVATE_KEY_FILE` declaration in `deploy.sh` are handed to MUT-51.

---

## [Unreleased] - 2026-10-10 — MUT-16: insights, planning and projects are gated behind their switches

Brief `.claude/designs/mut-16-gate-insights-planning-projects.md` (+ test
plan), eng review §8, outside voice §9. ADR-032 addendum. Five commits, one
per build-order step (router, nav, client profile, drawers, onboarding).

### Added
- `/insights`, `/planning`, `/projects` and `/projects/$projectId` carry
  `beforeLoad: requireFeature(key)`: a deep link while the area is off
  redirects home before the lazy chunk loads. `/reports` → `/insights` and
  `/transactions` → `/income` stay unconditional (AC 3), proven by the new
  `legacyRedirectsCore` test with every area off.
- Sidebar: Insights, Planning and Projects leave the main/workspace sections
  for "More" (after Expenses, Documents, Retainers). A fresh install shows
  Home, Income, Clients, Settings. `+ Add → Project` (sidebar and top bar)
  renders only while projects is on.
- Client profile: the Projects tab, its body and both **+ Project** buttons
  render only while projects is on; an active projects tab falls back to
  Summary. Project names on the work list stay as text (AC 4).
- Income and expense drawers: the optional project field hides while
  projects is off; form state is untouched, so editing an entry that carries a
  `projectId` saves it unchanged (D3).
- Onboarding: while projects is off the overlay completes the project step
  itself (no entity), so a new install runs client → income (D4).
- `RetainerDrawer`'s project picker follows the switch too (review #2).
- `useFeaturesLoaded()` in `lib/features/useFeatures.ts`: whether the
  settings row has been read; the onboarding skip waits for it (review #1).
- Tests: router gates (+4), gate keys (30: each gated route reads its own
  key), legacy core redirects (2), sidebar (+3), client profile (+2), income
  drawer (+3), expense drawer project field (3), retainer drawer project
  field (2), onboarding overlay (6). Suite: 123 files, 2067 passed, 5 skipped.

### Fixed (outside review, brief §9)
- The onboarding project-step skip no longer fires while the settings row is
  still loading, so a projects-on user mid-onboarding keeps their step.
- A project created during onboarding before the area was switched off is no
  longer attached to the income step through a hidden field.
- `ClientDetailPage` reads `visibleTab` in every tab comparison.

### Removed
- `useOnboardingDrawerSuccess` (zero callers; the drawers call
  `completeStep` directly).

### Decided
- Projects off hides; the switch never clears: `Transaction.projectId` is
  kept through an edit while the field is hidden. The client→project cascade
  still clears a tag that no longer matches the chosen client, visible or
  not (D3, review #4).
- The onboarding store's completion rule (`client`, `project`, `income`)
  stays; the overlay auto-completes the step rather than the store learning
  about flags (D4). The indicator still shows three steps (TD-027).

### Not done here
- The sidebar's final grouping and the `+ Add` menu's shape (MUT-15).
- No `suppliers` work: folded into expenses by MUT-12, view deleted by MUT-14.

---

## [Unreleased] - 2026-10-10 — MUT-14: expenses collapse to one gated ledger; MUT-20 fixed

Brief `.claude/designs/mut-14-collapse-expenses.md` (+ test plan), eng
review §9, outside voice §10 (twelve findings, all dispositioned before the
prune commit). ADR-029 and ADR-032 addenda. Safety tag before deletion:
`mut-14-pre-expenses-collapse`.

### Removed (one commit per page)
- `ExpensesPage` (profiles), `ProfileExpensesPage`, `ReceiptsPage` (+ its
  match components), `ExpensesOverviewPage`, `ExpensesForecastPage`,
  `VendorsPage`, `MonthCloseChecklistPage` (+ `ClosedMonthWarning`),
  `SuppliersPage` and the `/suppliers` route, the orphan
  `RecurringRuleDrawer` and `BulkUploadDrawer`. Their eight paths redirect to
  `/expenses`.
- Pruned by the consumer rule: forecasting (`forecastCalculations.ts`,
  `useExpenseForecast`, yearly / all-profile totals), receipt matching
  (`matchingAlgorithm.ts`, suggestion and bulk-upload hooks and helpers,
  `receiptRepo.linkToExpense`), month close (`monthCloseRepo` and hooks;
  the **table stays**, typed in `src/db/retained/monthCloseSchema.ts`),
  vendor management (`mergeVendors`, `addAlias`, `isSameVendor`,
  `findBestVendorMatch`), the `linkReceiptId` drawer chain, and 216 orphaned
  i18n leaves (`suppliers.*`, `monthClose.*`, `receipts.*`, most of
  `expenses.*`) in en and ar.

### Added
- **Export receipts** in Settings › Data tools: one ZIP with
  `<profile>/<YYYY-MM>/<file>` for every uploaded receipt, built by the
  tested `buildAllReceiptsArchive`; `receipts.count()` for the row count.
  Shipped before the receipts pages were deleted (ADR-029 addendum).
- `/expenses` gated by `requireFeature('expenses')`; Expenses moved from the
  main sidebar section to "More"; `+ Add → Expense`, the top bar's New
  expense and duplicate-as-expense on the project page follow the switch.
- Ledger: **Edit recurring rule** on recurring rows and on projected
  occurrence cards (the only management entry point was on a deleted page);
  receipt-count badge on rows; the two links to deleted routes are gone.
- `ExpenseDrawer` seeds the default categories for a profile that has none
  (the seeding button lived on a deleted page).
- Tests: ledger (+1), zip export (3), router gates (+1), legacy redirects (8),
  sidebar (+2), no-dead-modules guard, retained month-close schema (3),
  backup round-trip data safety (2); i18n parity for `expenses` en/ar.

### Fixed
- **The Settings backup import now reconciles optional areas.** MUT-12 wired
  the reconcile into `migration-safety.ts`'s restore only; the Settings page
  uses `src/db/backup.ts`, which is now covered too (found by the new
  round-trip test).
- **`useFeatureEnabled` no longer imports the `hooks/useQueries` barrel**;
  page tests that mock that barrel wholesale (IncomePage) broke the moment
  the top bar read a flag. The settings query is declared inside the features
  module with the same `['settings']` key.
- **MUT-20:** the 18 failing `ExpensesLedgerPage` tests. Root cause: the
  page renders its no-profile state without an active profile and the test
  never provided one. Fixed by mocking `useActiveProfile` (a test fix, not a
  product change; nothing renders the ledger against a real profile row).

### Decided
- Expenses already recorded stay visible on Home, client and project pages
  while the area is off; only create entry points follow the switch (D9).
- Receipts are exportable, not viewable, after this ticket; vendors stay
  viewable and creatable through the ledger and the drawer.

---

## [Unreleased] - 2026-10-10 — MUT-13: invoices/documents and retainers are gated behind their switches

Brief `.claude/designs/mut-13-gate-invoices-retainers.md` (+ test plan), eng
review §8, outside voice §9. First consumer of the MUT-12 switchboard;
ADR-032 addendum records the gating pattern. Jira MUT-13 under MUT-2.

### Added
- **`requireFeature(key, to = '/')`** (`src/lib/features/routeGuard.ts`): a
  router `beforeLoad` that reads the flag through the repository and throws a
  redirect before the lazy page chunk is requested. Applied to `/documents`,
  `/documents/new`, `/documents/$documentId`, `/documents/$documentId/edit`
  and `/retainers` in `src/router.tsx`.
- **Sidebar "More" section** (`nav.sections.optional`): Documents and
  Retainers appear only while their areas are on; hidden when both are off.
  Core sections untouched (MUT-15 owns the final grouping).
- **Client profile entry points**: *Generate invoice* / *View invoice* row
  actions on income rows (invoices on) in both the Receivables and
  Transactions tabs, mirroring the legacy `/transactions` action;
  **`ClientRetainersCard`** on the Summary tab (retainers on) with New
  retainer and View all.
- **Locked income entry** (`IncomeDrawer`): a notice naming the locking
  document, Save and Delete disabled; *View document* while invoices is on,
  "turn on Invoices in Settings" while it is off. The repository guard is
  unchanged and still the source of truth.
- **Home attention feed** leaves projected-retainer items out while retainers
  is off (their only action deep-links to `/retainers`).
- i18n en + ar: `nav.sections.optional`, `clients.detail.retainers.*`,
  `drawer.income.locked.*`. `.drawer-notice` styles.
- **Create invoice from an income entry really links it:** `openDocumentDrawer`
  takes `linkTransactionId`; the drawer prefills currency, client and one line
  from the entry and links it on create, so the row flips to *View invoice*.
- `defaultPendingComponent: PageLoader` on the router, so a reload or deep link
  into a gated route shows the loader while the flag is read instead of a
  blank first paint.
- Tests: route guard (5), router gates (10), sidebar (4), client profile entry
  points (5), locked drawer (5), attention feed (2), data safety + auto-enable
  end to end (2), repository delete-lock (1).

### Fixed
- **`transactionRepo.softDelete` now honours the document lock** (it only
  guarded `update`); the drawer's disabled Delete is no longer the only guard.
- The home KPI strip (`PredictiveKpiStrip`) no longer counts projected
  retainer income while the Retainers area is off.
- The lock error toast no longer says "unlock the document first".

### Notes
- Lock contract, now stated: details immutable, payments allowed (row menu),
  delete refused, archive allowed. Toggling writes only the settings row;
  documents, sequences and retainers are untouched (tested). Auto-enable on
  upgrade is MUT-12's.
- The legacy `/transactions` page keeps its own ungated *Generate invoice*
  item; the route redirects to `/income`, so it is unreachable (TD-025).

---

## [Unreleased] - 2026-10-10 — MUT-12: per-feature Advanced toggle in Settings, off by default (Dexie v20)

Brief `.claude/designs/mut-12-advanced-features-toggle.md` (+ test plan),
eng-reviewed with an outside-voice pass; ADR-032 (numbered ADR-030 on the branch; renumbered at merge because main's MUT-6 took ADR-030). Jira MUT-12 under MUT-2.
Nothing is gated yet — MUT-13/14/16 consume the switches.

### Added
- **Settings › Advanced features**: one `Switch` per optional area —
  invoices, retainers, expenses, insights, planning, projects — all off on a
  fresh install (`pages/settings/AdvancedFeaturesSection.tsx`).
- **`Settings.features`** (typed partial map) and **`Settings.featureNotice`**
  on the settings row; `settingsRepo.get()` now returns `ResolvedSettings`
  with every key present. `src/db/defaultSettings.ts` holds the one default
  row used by the repository and `initDatabase()`.
- **`src/lib/features/features.ts`** (pure): `FEATURE_KEYS`, `DEFAULT_FEATURES`,
  `resolveFeatures`, `withFeature`, data probes, `reconcileFeaturesWithData`
  and the swallowing `reconcileFeaturesAfterDataLoad`.
- **`src/lib/features/useFeatures.ts`**: `useFeatureEnabled`, `useFeatureFlags`,
  `useSetFeatureEnabled`, `useFeatureNotice` (React) and `readFeatureFlags()`
  for router `beforeLoad` guards.
- **Dexie v20** (no schema change): the upgrade switches on every area that
  already has data and records a notice; try/caught so it can never block
  open. Same reconcile after backup restore, data import (both legacy import
  flows and the profile import modes), demo seeding and sync-bundle import.
- **`FeatureNoticeBanner`** in `AppShell`: tells the user once which areas were
  switched on for their data, links to Settings, clears on dismiss.
- **`Switch`** UI component (`role="switch"`, keyboard, RTL via logical
  properties). i18n `settings.features.*` in en + ar.
- Tests: 8 new files (features, probes, reconcile, hooks, migration v20,
  Switch, section, banner) + extended settingsRepo, migration-safety and
  ImportExportModals tests; i18n parity test for the new keys.

### Decided
- `suppliers` is folded into `expenses` (vendors are the expenses module's
  table); the ticket's seventh toggle is not shipped (ADR-032 §5).
- Archived rows count as data for auto-enable; soft-deleted rows do not;
  projects have no soft delete so any row counts.

### Technical
- `MiniCrmDatabase` takes an optional database name so the v20 upgrade is
  tested on a real v19 → v20 open.
- `ISettingsRepository.get()` returns `ResolvedSettings` (a subtype; no caller
  changes).

---

## [Unreleased] - 2026-10-10 — Money v1 pilot decisions: download-only attachments accepted, Office Admin excluded; epic bookkeeping (MUT-25 / MAL-939)

**Scope:** `.claude/DECISIONS.md` (ADR-028 + index), `.claude/designs/money-v1-m6-summaries-audit-attachments.md` §5, `.claude/designs/money-v1-handover.md` §4. No code.

### Summary
- **ADR-028:** M6 decision 4 accepted for the pilot — attachments stay download-only, `READY` means verified size and type, the scanner pipeline is a post-pilot follow-up to ticket before GA.
- **Office Admin does not get access to Money** (owner, 2026-10-10): recorded against MAL-870 and as an ADR-150 addendum in Malafat; Mutaba3a's handover §4 updated to match.
- **Jira:** MUT-40, MUT-41, MAL-940…943 → Done; spikes MUT-26, 27, 29, 30, 31, 32 and MAL-869, 871 closed as answered by ADR-024/025 and ADR-150; MUT-28 and MAL-870 left open; MUT-25 and MAL-939 → In Progress (pilot).
- **Worktrees:** `.claude/worktrees/money-v1-m8` and branch `feature/money-v1-m8` removed in both repositories (merged: Mutaba3a e7754f3, Malafat 1477e55f5).

---

## [Unreleased] - 2026-10-10 — MUT-10 / MUT-11: delete the two unreachable modules (`src/`)

Epic MUT-2 (strip to the core). Branch `feature/mut-2-strip-core`; tag
`pre-mut-10-11` marks the state before either removal. One commit per ticket so
each reverts independently.

### Removed
- **Engagements (MUT-10)** — 11,192 lines: three routes (`/engagements`,
  `/engagements/new`, `/engagements/$engagementId/edit`), `src/pages/engagements`,
  `src/features/engagements` (wizard, PDF generator, autosave hook, presets,
  repository), and the `engagements.*`, `nav.engagements` and orphaned
  `nav.newMenu.engagement` i18n keys from both locales. No navigation entry had
  pointed at any of it.
- **Money answers (MUT-11)** — 3,180 lines: the `/money-answers` route,
  `src/pages/money-answers`, `DayDetailDrawer` and its two drawer-store actions
  (the page was the only caller), the Insights "Cash Flow Timeline" link into
  the deleted route, the already-unreferenced landing `MoneyAnswersSection`, and
  the `moneyAnswers`, `nav.moneyAnswers`, `landing.moneyAnswers` and
  `insights.cashFlowTimeline` i18n keys.

### Changed
- `src/db/database.ts` takes the `Engagement` / `EngagementVersion` row types
  from the new `src/db/retained/engagementSchema.ts` instead of the deleted
  feature directory. The version snapshot is modelled as opaque JSON — nothing
  interprets it any more.
- Renamed the shared money-event surface off the deleted page's name:
  `useMoneyAnswersQueries` → `useMoneyEventQueries`, `moneyAnswersQueryKeys` →
  `moneyEventQueryKeys`, `useInvalidateMoneyAnswers` → `useInvalidateMoneyEvents`,
  `MoneyAnswersFilters` → `MoneyEventFilters`.

### Kept deliberately
- The Dexie `engagements` and `engagementVersions` tables, at the same schema
  version. Deleting UI must never delete user records (ADR-029). The generic
  backup in `src/db/backup.ts` walks `db.tables`, so retaining the tables keeps
  any rows a user holds exportable and restorable with no new export path.
- `src/db/moneyEventRepository.ts` and the `MoneyEvent` type family: shared with
  `PredictiveKpiStrip`, `MonthActualsRow` and `AttentionFeed` on the Overview
  page, so MUT-11's "remove only if exclusively used here" condition failed.
- The `moneyEventVersions` table — unrelated to the deleted page; it is the
  transaction sync op-log.

### Added
- `src/db/__tests__/retainedSchema.test.ts` — four tests that fail if a later
  change drops the retained tables or stops backing them up.

### Technical
- Dexie schema version unchanged; no table dropped, no migration added.
- Typecheck clean. Lint went from 18 errors / 75 warnings to 0 errors / 18
  warnings — the deleted modules owned every remaining lint error, which closes
  most of MUT-22.
- Unit suite: 2,029 passing before and after, plus the 4 new tests. The 18
  failures in `ExpensesLedgerPage.test.tsx` are pre-existing and untouched.
- Bundle: JS 3,396 KB → 3,152 KB (−244 KB, −7.2%) across 48 → 45 chunks;
  precache 11,902 KiB → 11,647 KiB.

---

## [Unreleased] - 2026-10-10 — Money v1 Milestone 8: approval creates the agreement; the overview carries proposals (`server/`, API `1.7.0-m8`)

Brief `money-v1-m8-overview-ia.md` (design-reviewed D1–D13, eng-reviewed
D14–D20; HTML wireframe beside it). Jira MUT-40, MUT-41 under MUT-25. Replaces
the M7 lifecycle: nothing from M1–M7 is deployed, so the M7 migration is edited
in place rather than mapped (D20).

### Changed
- **Fee proposal lifecycle** is `PROPOSED → APPROVED | WITHDRAWN`
  (`src/proposals/transitions.ts`). `CLIENT_APPROVED`, `AGREED`, `CONVERTED`,
  `POST …/agree`, `agreedOn` / `agreedNote` and the `feeProposalId` field of
  `POST /v1/agreements` are gone; `currentProposal` prefers the open one, else
  the latest APPROVED. Reasons `PROPOSAL_NOT_FOUND`, `PROPOSAL_NOT_AGREED`,
  `PROPOSAL_PROJECT_MISMATCH` retired.
- **`POST /v1/fee-proposals/{id}/approve`** now creates the fixed-fee agreement
  (D5): body `{ amount, approvedOn?, schedule: ONCE { dueOn } | INSTALLMENTS
  { count 2–60, firstDueOn }, note? }`; the agreement is dated `approvedOn`
  so the VAT rate in force on that date applies (D18, `422 VAT_RATE_MISSING`
  names the date); ONCE posts one IMMEDIATE installment due on `dueOn`;
  INSTALLMENTS splits the amount into equal minor-unit shares (remainder on
  the first), posts the first now and DATE-triggers the rest one month apart
  with the day clamped (D15 B). The store transaction writes the agreement and
  moves the proposal to APPROVED (`agreedAmountMinor`, `clientApprovedOn`,
  `clientApprovalNote`, `agreementId`) or refuses the whole create
  (`StateConflict` → `409 PROPOSAL_NOT_OPEN`). Returns `{ proposal, agreement }`.
  Audit `fee_proposal.approved` (with `agreementId`, `schedule`).
- **Organization summary** (D17): `CustomerSummaryRow.proposals[]`
  (`{ proposalId, projectId, amount, proposedOn }`), `CurrencySummary.proposed`
  and `counts.openProposals`; the currency and customer sets include customers
  that only have PROPOSED proposals, so a proposals-only firm gets a block.
- **Archive** (`POST /v1/projects/{id}/archive`) is refused with
  `409 PROPOSAL_OPEN { openProposalId }` while a proposal is open (D19).
- **Lazy posting heals IMMEDIATE installments** (D16):
  `AgreementRepository.listUnpostedDue` also returns unposted, non-voided
  IMMEDIATE installments on ACTIVE agreements (MANUAL excluded), so a crash
  between agreement create and the posting step is repaired on the next read
  or by `npm run reconcile`; `installment.posted` audits `trigger` from the
  installment.
- API version `1.7.0-m8`; `openapi/openapi.yaml` regenerated.

### Technical
- `src/agreements/create.ts` (new, D14): `composePreview`, `PreviewBody`,
  `createAgreementFromPreview`, `agreementDetail`, `paidMap` lifted out of
  `routes/agreements.ts` and shared with the approve route. `POST /v1/agreements`
  behaviour unchanged (`routes-m3.test.ts` untouched and green).
- Tests: `src/__tests__/routes-m8.test.ts` (approve ONCE / INSTALLMENTS incl.
  remainder, month clamp and lazy posting of #2; 409 / 422 / validation /
  scope / cross-org; `VAT_RATE_MISSING` by date; summary proposals and
  proposals-only currency; archive refusal; healed IMMEDIATE installment;
  contract), `routes-m7.test.ts` trimmed to the surviving routes,
  `transitions.test.ts` rewritten, `store-contract-m8.ts` (+ memory / Prisma
  runners) replaces `store-contract-m7.ts`. 304 unit tests; 342 with Postgres.
- `e2e/money-v1.e2e.mts` gains the M8 section (19 checks: proposal → approval →
  receivable → summary, installments, security edges); 103 checks pass against
  a local Postgres with Malafat's updated client.
- Prisma: `FeeProposalStatus` enum and `fee_proposals` columns edited in the
  M7 migration (`20261009120000_m7_fee_proposals`); local databases need
  `prisma migrate reset` or a fresh database (the test suite ran against
  `mutaba3a_test_m8`).

---

## [Unreleased] - 2026-10-10 — MUT-35: the repository seam becomes real (`src/db/`)

Epic MUT-34 (hosted Mutaba3a). Eng-reviewed 2026-10-10 (`/plan-eng-review`,
11 findings, 0 critical gaps). Scope reduced during review: the React context
layer was cut as an abstraction with no consumer (D1), so CLAUDE.md's AppShell
`RepoProvider(repo)` gap stays open. No behaviour change — the suite's
pass/fail counts are unchanged apart from the 9 new provider tests.

### Added
- **`src/db/provider.ts`** — the data-access seam. A frozen, module-scoped
  registry exposing `{ base, synced }`, with `getRepositories()`,
  `setRepositories()` (refused in production builds) and `resetRepositories()`.
  Module-scoped rather than a React context because Dexie migrations run inside
  `db.open()` before React mounts.
- `satisfies` conformance on 21 base repositories and 8 synced decorators.
  Renaming or deleting a repository method now fails `npm run typecheck`.
- `npm run typecheck` (`tsc --noEmit -p tsconfig.app.json`). The repo had no
  such script despite CLAUDE.md Phase 4 mandating it; typechecking only
  happened inside `npm run build`.
- `ISyncedRepositories` and `IPaymentRecordRepository` in `interfaces.ts`.
- `src/db/__tests__/provider.test.ts` — 9 tests covering default resolution,
  reference stability, injection, reset isolation and the production guard.

### Fixed
- **7 drifted repository interfaces corrected to describe reality.** Every case
  was an interface declaring something the implementation never had:
  `transactionRepo.delete` (it soft-deletes), `receiptRepo.getByExpense`,
  `vendorRepo.findByName` (it matches by alias), `monthCloseRepo.set`,
  `retainerRepo.delete`, `projectedIncomeRepo.{getBySource,getByPeriod,create,delete}`,
  and `IExpenseRepository` missing `getYearlyTotals` / `getAllProfilesTotals` /
  `getReceiptCount` while typing `list` as `Expense[]` instead of
  `ExpenseDisplay[]`. Three `create` parameter types were also wrong. No runtime
  behaviour was added to satisfy an aspirational signature.

### Fixed (QA reconciliation, 2026-10-10)
- **Settings could not be saved.** `useUpdateSettings` passed
  `settingsRepo.update` as a bare method reference; `update` calls `this.get()`,
  and TanStack invokes `mutationFn` with its own `this`, so it threw
  `this.get is not a function`. With no `onError` on the mutation it failed
  silently — changing the default currency from Settings never persisted.
  Pre-existing (`acb1144:useQueries.ts:442` had the same shape), surfaced
  because the refactor touched the line. Now a closure, which binds `this` and
  keeps resolution lazy. **This is the one deliberate behaviour change in
  MUT-35**, accepted rather than preserving a silent data-loss bug.

### Changed
- `useRetainerQueries` also routes through the provider (nine consumers total).
  Without it the `retainerAgreements` and `projectedIncome` slots had zero
  callers, so a future `setRepositories` swap would have left retainer screens
  reading Dexie while everything else moved — a half-local view with no error.
- Removed a provider test that asserted a tautology (it could not fail for the
  reason its comment claimed), rather than leave it posing as coverage.
- Eight consumers now resolve through the provider: the four query hooks,
  `paymentRequestService`, `recurringExpenseService`, `lib/zipExport.ts` and
  `useIssueAndDownload.tsx`. Each call site keeps the family it used before
  (`base` → `base`, `synced` → `synced`), so which mutations capture a sync op
  is unchanged.
- Mock wiring updated in `useIncomeQueries.test.tsx` and
  `useRecurringExpenseQueries.test.tsx` — assertions untouched. `vi.mock`
  intercepts imports, so the barrel had to become the interception point.

### Technical
- `TECH_DEBT.md` TD-013 corrected: it claimed the Dexie implementation
  satisfied the interfaces, which nothing checked. Applying the check found the
  7 drifts above.
- `TODOS.md`: recorded that most transaction mutations bypass the sync op-log
  and never sync between devices, and that expenses never sync at all. Both
  pre-existing, both preserved here.
- Known gap `gstack-shortcut(dec-5f2c2123)`: `synced.*` is bound to the Dexie
  singletons at module load and does not follow `setRepositories`. Upgrade when
  MUT-43 injects a hosted source.

---

## [Unreleased] - 2026-10-09 — Money v1 Milestone 7: fee proposals (negotiations) (`server/`, API `1.6.0-m7`)

Brief `money-v1-m7-fee-proposals.md` (+ `-tests.md`), approved by the owner on
2026-10-09 (single round · agreed amount prefills the wizard · fixed fee only ·
overview lists every connected client). Additive; closes the gap before a fee
agreement exists.

### Added
- **Fee proposals** (`src/proposals/transitions.ts`, `src/routes/fee-proposals.ts`):
  `POST /v1/fee-proposals` (project currency, `proposedOn` defaults to today,
  409 `PROPOSAL_OPEN` while one is open on the project), `GET /v1/fee-proposals`
  (`projectId`, `customerId`, `status`, `open=true|false`, keyset pages),
  `GET /v1/fee-proposals/{id}`, `POST …/approve` (PROPOSED → CLIENT_APPROVED,
  agreed amount = proposed), `POST …/agree` (PROPOSED | CLIENT_APPROVED →
  AGREED with an explicit amount), `POST …/withdraw` (any open state →
  WITHDRAWN, idempotent). Scopes reused: `agreements:read` / `agreements:write`.
  Audit `fee_proposal.{created,client_approved,agreed,withdrawn,converted}`.
- **Conversion**: `POST /v1/agreements` accepts `feeProposalId` (outside the
  preview token); the store marks the proposal CONVERTED with `agreementId` in
  the agreement's transaction (`StateConflict` → 409 `PROPOSAL_NOT_OPEN` on a
  race); 422 `PROPOSAL_NOT_FOUND` / `PROPOSAL_PROJECT_MISMATCH` /
  `PROPOSAL_NOT_AGREED` before it.
- **Project summary** gains `proposal` (`FeeProposalSummary | null`: the open
  one, else the latest converted one), on `GET /v1/summaries/projects/{id}` and
  the customer summary's project rows.
- Table `fee_proposals` (migration `20261009120000_m7_fee_proposals`); one open
  proposal per project is serialised by the project row lock in
  `PrismaLedgerStore.feeProposals.create`, mirrored by the memory store.
- `PATCH /v1/projects/{id}` refuses a currency change (409 `CURRENCY_LOCKED`)
  while a proposal is open.

### Changed
- API version `1.6.0-m7`; `openapi/openapi.yaml` regenerated (new tag "Fee
  proposals", reasons `PROPOSAL_OPEN`, `PROPOSAL_NOT_OPEN`, `PROJECT_NOT_FOUND`
  (already raised by the preview, now published), `PROPOSAL_NOT_FOUND`,
  `PROPOSAL_NOT_AGREED`, `PROPOSAL_PROJECT_MISMATCH`).

### Technical
- Tests: `src/proposals/__tests__/transitions.test.ts` (state table, agreed
  amount, current proposal), `store-contract-m7.ts` (memory always, Postgres
  with `MUTABA3A_TEST_DATABASE_URL`), `src/__tests__/routes-m7.test.ts` (7
  cases: create / open conflict / approve + agree / withdraw / conversion /
  lists + summaries / contract). Earlier milestones' version pins bumped.
  Lint, typecheck, 299 unit tests, build, `openapi:check` green. The Postgres
  contract suite could not run in the authoring session (no database); CI's
  `server-ci.yml` runs it.
- Operator action on release: `deploy.sh` applies the migration (handover §2).

## [Unreleased] - 2026-10-08 — First production deploy: Cloud Run rejected the `PORT` env; smoke CLI hardened (`server/`)

The first `scripts/deploy.sh` run against `malafat-production` created Cloud
SQL, the secrets, the service account and migrated the database, then failed
at `google_cloud_run_v2_service.api` with `Error 400 … reserved env names were
provided: PORT`. Downstream, `terraform output -raw service_url` had nothing
to print and `npm run smoke -- --url ""` crashed with
`Failed to parse URL from /health`.

### Fixed
- `server/infrastructure/terraform/main.tf`: removed the `PORT=8787` env
  entry. Cloud Run injects `PORT` from `container_port` and refuses templates
  that set it; `config.PORT` reads the injected value (default 8787 locally).
  Comment on the `ports` block records why.
- `server/src/smoke.ts` + `server/src/scripts/smoke.ts`: new exported
  `parseBaseUrl` validates `--url` before any request (empty → names the
  `terraform output` cause and the recovery; relative or non-http → "must be
  an absolute http(s) URL"); the CLI exits 2 with that one line instead of an
  undici stack trace. `runSmoke` uses the same validation.
- `server/scripts/deploy.sh`: fails with a red `[deploy]` line naming the
  recovery (re-run) when the full apply leaves no `service_url`, instead of
  calling the smoke script with an empty URL.

### Changed
- `server/DEPLOYMENT.md`: new §2.1 "If a step fails" (what each step leaves
  behind, re-run is the recovery, the `-target` warnings are expected, the
  PORT error verbatim); §3 echoes the URL and stops on a missing output; §1.1
  records that production is in `malafat-production`.
- `.claude/INFRA.md`: project choice recorded; Deployed table notes the
  2026-10-08 partial apply (database and secrets exist, service pending the
  re-run).

### Technical
- Tests: `src/__tests__/smoke.test.ts` +3 (`parseBaseUrl` accept/strip,
  empty, relative/non-http). Lint, typecheck, 180 unit tests, build green;
  `terraform fmt -check` green. `terraform validate` could not run in the
  session (provider registry unreachable); CI's `terraform` job covers it.
- Operator action: pull and re-run `./scripts/deploy.sh`; then §3–§5.
## [Unreleased] - 2026-10-09 — Database access through the Cloud SQL proxy (`server/scripts/db.sh`)

### Added
- `scripts/db.sh <migrate|status|psql|proxy>` with npm shortcuts `db:migrate`, `db:migrate:status`, `db:psql`, `db:proxy`: reads the instance connection name and local URL from `terraform output` (so only `TF_STATE_BUCKET` is needed), opens `cloud-sql-proxy` on 127.0.0.1:5440 for the one command and stops it on exit. `migrate` is `prisma migrate deploy` (forward-only); `status` is read-only and does not fail on pending migrations; `proxy` waits for Ctrl-C and prints the local URL for other tools. With `DATABASE_URL` set no proxy is started, so the same commands serve local development. Same mechanics as `deploy.sh`'s own migration step, which is unchanged: a normal release still needs none of this.

### Changed
- `DEPLOYMENT.md` §6 day-2 rows and `README.md` point at the shortcuts; the handover's deployment section now says that `deploy.sh` migrates by itself and when the by-hand path applies.

## [Unreleased] - 2026-10-08 — Money v1 end-to-end run; two fixes it found (`server/`, API `1.5.1-m6`)

### Fixed
- **Supplement with a new IMMEDIATE installment never posted.** `POST /v1/agreements/{id}/supplements` with `distribution: NEW_INSTALLMENT` and `trigger.type: IMMEDIATE` created the installment but left it PENDING with no receivable: creation posts IMMEDIATE installments inline and lazy posting only handles DATE triggers. The route now posts it as creation does, audits `installment.posted` (with the supplement id) and answers with the posted state. `routes-m3.test.ts` covers it.
- **`POST /v1/retainers/{id}/cancel` answered with the fixed-fee detail shape** (`agreement` + empty `installments`/`supplements`). It now returns the retainer charges view (`agreement`, `versions`, `charges`), the same shape as `GET …/charges` and `POST …/changes` and the shape Malafat's published contract already declared. The cancelled final month (prorated or credited) is visible in the response.

### Added
- `server/e2e/money-v1.e2e.mts` — the end-to-end run over HTTP: Malafat's own Mutaba3a client (`features/money/application/mutaba3a-client.ts`, loaded from a Malafat checkout) driving a running server through provisioning, M1 bind, M2 customers / projects / import / PATCH, M3 VAT / fixed fee / installments / supplement / retainer, M5 change preview and apply, cancel preview and PRORATE cancel with credit, M4 allocation preview, payment, replay, operations lookup, allocate later, reversal, credit, corrected payment, M6 summaries (invariants `outstanding = overdue + dueToday + notYetDue`, equality with open receivables and with the customers' rows, unallocated vs POSTED payments), audit, attachments-not-configured, reconcile, disconnect — plus the security edges: forged key, narrow scopes, cross-organization 404s, same-tenant second binding, idempotency reuse, stale `If-Match`, forged preview tokens, token required for a crediting cancel. **84 checks, all passing** against Postgres 16.
- `server/e2e/attachments.e2e.mts` — attachments in process on the real Postgres store with `MemoryAttachmentStorage`: create → PUT → complete (incomplete / size and type mismatch / idempotent complete) → list (pending hidden) → download (TTL, filename) → delete (object removed, 404 after), scope and cross-organization refusals, every rule reason, audit trail. **34 checks, all passing.**
- `npm run smoke` (with the admin token) and `npm run reconcile` / `-- --dry` were run against the same database.

### Technical
- API version `1.5.1-m6`; `openapi/openapi.yaml` regenerated; Malafat's vendored contract refreshed to it.
- The e2e scripts are `.mts` outside `src/`, so lint and typecheck do not cover them; `tsx` runs them.

## [Unreleased] - 2026-10-08 — Money v1 Milestone 6: summaries, audit listing, attachments (`server/`)

Brief `money-v1-m6-summaries-audit-attachments.md`, decided by the engineering
owner under the "complete the epic" instruction. API version `1.5.0-m6`;
additive. Closes the Money v1 server epic (M1–M6).

### Added
- **Summaries** (`src/summaries/compute.ts`, `src/routes/summaries.ts`):
  `GET /v1/summaries/organization[?currency=]`, `/customers/{id}`,
  `/projects/{id}`. Computed on read from OPEN receivables and POSTED payments:
  exact day buckets (`outstanding = overdue + dueToday + notYetDue`),
  unallocated funds, last payment date, and statuses — customer `SETTLED /
  OVERDUE / OUTSTANDING / UP_TO_DATE`, fixed project `PENDING / OUTSTANDING /
  PARTIALLY_PAID / OVERDUE / PAID_IN_FULL` (never `PAID_IN_FULL` while an
  installment is pending), retainer `UP_TO_DATE / OUTSTANDING / OVERDUE /
  CANCELLED / SETTLED`, `NONE` without agreements. Retainer `monthly` is the
  gross of the terms in force (M5 versions). Scope `summaries:read`.
- **Audit listing** `GET /v1/audit?entityType=&entityId=&action=&cursor=&limit=`
  (scope `audit:read`), keyset-paginated like every list;
  `AuditRepository.list`; index `(organizationId, entityType, entityId,
  createdAt)`.
- **Attachments** (`src/attachments/{rules,storage}.ts`,
  `src/routes/attachments.ts`): `POST /v1/attachments/uploads` (PDF / JPEG /
  PNG ≤ 10 MB, exactly one of customerId / projectId / paymentId, 201 with a
  V4 signed PUT URL), `POST /v1/attachments/{id}/complete` (verifies the
  object's size and type: `UPLOAD_INCOMPLETE` / `UPLOAD_MISMATCH`),
  `GET /v1/attachments?…`, `GET /v1/attachments/{id}/download` (signed URL
  with a safe `Content-Disposition`), `DELETE /v1/attachments/{id}` (soft
  delete + object removal). Object key `org/{organizationId}/{attachmentId}`,
  never the filename. `AttachmentStorage` port with `GcsAttachmentStorage`
  (`@google-cloud/storage`, signBlob through the service account) and
  `MemoryAttachmentStorage` (tests). Config `ATTACHMENTS_BUCKET` (optional →
  503 `ATTACHMENTS_NOT_CONFIGURED`), `ATTACHMENTS_URL_TTL_SECONDS` (900).
  Audit `attachment.uploaded`, `attachment.deleted`.
- **Terraform:** private bucket (uniform access, public access prevention),
  `roles/storage.objectAdmin` on it and `roles/iam.serviceAccountTokenCreator`
  on the service account for itself, `storage` + `iamcredentials` APIs, the two
  env vars on Cloud Run, output `attachments_bucket`.
- **Schema + migration `20261008230000_m6_attachments_audit_index`.**
- **Published reasons:** 422 `UPLOAD_INCOMPLETE`, `UPLOAD_MISMATCH`,
  `ATTACHMENT_TARGET_REQUIRED`, `ATTACHMENT_TARGET_AMBIGUOUS`,
  `MIME_TYPE_UNSUPPORTED`, `FILE_TOO_LARGE`, `FILENAME_INVALID`,
  `ATTACHMENT_NOT_READY`; error code `ATTACHMENTS_NOT_CONFIGURED` (503).
- **Tests:** 315 (M6: compute 7, rules 3, store contract 2 × memory +
  Postgres, routes-m6 5).

### Not done (brief §5.4, §7)
- No malware scan before `READY`; `complete` checks size and type only. A
  scanner on bucket events is the follow-up; the UI downloads, never renders
  inline.

---

## [Unreleased] - 2026-10-08 — Money v1 Milestone 5: retainer changes, proration, cancel preview, reconcile script (`server/`)

Brief `money-v1-m5-retainer-changes.md`, decided by the engineering owner under
the "complete the epic" instruction. API version `1.4.0-m5`; additive
(`RetainerChargesResponse.versions`, `RetainerCharge.version`,
`Agreement.retainer.cancelEffectiveDate`, `FinalMonth` gains `PRORATE`).

### Added
- **Versions, not edits:** `retainer_versions` appends a version per change;
  version 1 is synthesized from the agreement row (no backfill).
  `generateCharges` prices each service month from the version in force for it
  (`src/retainers/terms.ts`), honours a per-version billing day and end month,
  and stamps `retainer_charges.version`. Charges already generated keep their
  terms.
- **Routes:** `POST /v1/retainers/{id}/changes/preview` (previous vs next terms
  at the VAT rate in force on the effective month, `changed`,
  `firstChargedMonth`, `chargesKept`, token), `POST /v1/retainers/{id}/changes`
  (201, idempotent; token covers body + agreement version + latest version +
  rate), `POST /v1/retainers/{id}/cancel/preview` (final month under FULL /
  PRORATE / WAIVE, posted charge, credit with `limitedByPayments`,
  `stoppedFrom`, `outstandingAfter`); `POST /v1/retainers/{id}/cancel` accepts
  `PRORATE` and an optional `previewToken`, required whenever a credit is
  created (422 `PREVIEW_TOKEN_REQUIRED`). Audit `retainer.changed`;
  `receivable.credited` with `source: RETAINER_CANCEL`.
- **Proration** (`src/retainers/proration.ts`): `amount × days ÷ daysInMonth`,
  half-up, days = the cancellation day inclusive; VAT computed on the prorated
  amount at the version's rate. A posted final month is adjusted by a credit
  (WAIVE: the outstanding; PRORATE: the difference), never above the
  outstanding — what was paid is not refunded; earlier credits are not credited
  twice.
- **Reconcile script:** `npm run reconcile [-- --dry]` walks every organization
  (`organizations.list()`), posts due installments and charges in its timezone,
  prints a per-organization summary; for cron / Cloud Scheduler (README).
- **Published reasons:** 422 `CHANGE_EFFECTIVE_INVALID`,
  `CHANGE_NOTHING_CHANGED`, `FINAL_MONTH_INVALID`, `PREVIEW_TOKEN_REQUIRED`;
  409 `AGREEMENT_CANCELLED` on changing or previewing a cancelled retainer.
- **Schema + migration `20261008220000_m5_retainer_versions_proration`.**
- **Tests:** 295 (M5: terms 7, proration 6, schedule +1, store contract 3 ×
  memory + Postgres, routes-m5 8 incl. the reconcile script).

---

## [Unreleased] - 2026-10-08 — Money v1 Milestone 4: payments, allocations, reversals, credits, operations lookup (`server/`)

All eight decisions of `money-v1-m4-payments-allocations.md` approved as
proposed. API version `1.3.0-m4`; additive (receivables gain `credited`).

### Added
- **Pure money math:** `src/payments/allocate.ts` (outstanding = gross − paid −
  credited; explicit-set validation that never adjusts; `OLDEST_FIRST` and
  `SETTLE_MATTERS` suggestions; resulting balances per receivable, project and
  customer), `src/payments/credit.ts` (credit VAT split at the receivable's
  frozen rate, `net + vat = credit`; capacity check), `src/payments/numbering.ts`
  (`PAY-YYYY-NNNN`), `src/payments/preview-token.ts` (token over the allocation
  set **and** the `(id, version)` of every eligible receivable — decision 2).
- **Schema + migration `20261008205727_m4_payments_allocations_credits`:**
  `payments` (number unique per organization, `allocatedMinor`, status
  POSTED/REVERSED, reversal fields, `replacesPaymentId`), `payment_allocations`,
  `receivable_credits` (append-only), `payment_counters` (per organization and
  year, row-locked in the posting transaction); `receivables.creditedMinor`.
- **Store:** `PaymentRepository` (create / allocate / reverse / list / replacedBy)
  and `ReceivableRepository.{getByIds, listEligible, credit, listCredits}`,
  `IdempotencyRepository.get`. Postgres locks each receivable (`FOR UPDATE`),
  checks capacity under the lock and recomputes `status` from the sums; a race
  the token did not catch surfaces as `InsufficientCapacity` → 409
  `PREVIEW_STALE`. The memory store's `seedPaid` test hook is gone.
- **Routes:** `POST /v1/allocations/preview` (new payment or `{ paymentId }`),
  `POST /v1/payments`, `GET /v1/payments`, `GET /v1/payments/{id}`,
  `POST /v1/payments/{id}/allocations`, `POST /v1/payments/{id}/reverse`,
  `POST /v1/receivables/{id}/credits`, `GET /v1/receivables/{id}/credits`,
  `GET /v1/operations/{idempotencyKey}`. Audit actions `payment.recorded`,
  `payment.allocated`, `payment.reversed`, `receivable.settled`,
  `receivable.credited`.
- **Published reasons:** 422 `ALLOCATION_EXCEEDS_PAYMENT`,
  `ALLOCATION_EXCEEDS_OUTSTANDING`, `ALLOCATION_DUPLICATE`,
  `RECEIVABLE_NOT_FOUND`, `RECEIVABLE_NOT_OPEN`, `RECEIVABLE_CUSTOMER_MISMATCH`,
  `PAYMENT_NOT_POSTED`, `NO_UNALLOCATED_FUNDS`, `CREDIT_EXCEEDS_OUTSTANDING`,
  `REPLACES_NOT_REVERSED`, `REPLACES_CUSTOMER_MISMATCH`, `CUSTOMER_NOT_FOUND`;
  409 `ALREADY_REVERSED`; preview warning `NO_ELIGIBLE_RECEIVABLES`.

### Changed
- `itemStatus` takes `creditedMinor`: credits count towards `PAID` but never
  read as `PARTIALLY_PAID` (a credited, unpaid item stays `DUE` / `OVERDUE`).
  Installment and charge statuses, `countOutstandingByProject` (archive guard)
  and receivable `outstanding` all subtract credits.
- `GET /v1/operations/{key}` is `PENDING | COMPLETED | 404`, not `FAILED`
  (decision 7): a key released by a 5xx is reusable.

### Technical
- Tests: 268 (28 files), +88: `payments/__tests__/{allocate,credit,numbering}`,
  `store-contract-m4.ts` (memory + Postgres, incl. 12 concurrent numbered
  creates and a sums-equal-rows sequence), `routes-m4.test.ts`; the M3
  receivable-status test now records a real payment. Postgres 16 ran locally
  for the contract suite. `openapi:check` green; ESLint and `tsc` clean.

---

## [Docs] - 2026-10-08 — Money v1 Milestone 4 design brief and test plan (proposed)

### Added
- `.claude/designs/money-v1-m4-payments-allocations.md` and `…-tests.md`:
  payments with allocations previewed before posting (OLDEST_FIRST /
  SETTLE_MATTERS suggestions, balance-covering preview token), unallocated
  funds allocated later, whole-payment reversal with `replacesPaymentId`,
  append-only credits against posted receivables (the adjustment M3
  reserved), `PAY-YYYY-NNNN` numbering, `GET /v1/operations/{key}`. Eight
  decisions await the product owner before Phase 2. No `server/` change.

---

## [Docs] - 2026-10-08 — Money v1 Milestone 3, Malafat side: design brief and test plan

### Added
- `.claude/designs/money-v1-m3-malafat-ui.md` and `…-tests.md`: the Malafat
  obligations of the M3 brief (§2.6) — VAT settings card, fee-agreement wizard
  with the preview step, matter and client financial detail — designed and
  implemented the same day in the Malafat repo (`crm-platform/.claude/
  CHANGELOG.md` "Money v1 Milestone 3"). Kept here with the other Money v1
  cross-repo artifacts because Malafat's repo rule forbids new Markdown and
  Confluence was not reachable from the session. No `server/` change.

---

## [Unreleased] - 2026-10-08 — Money v1 Milestone 3: agreements, installments, VAT, retainers, receivables (`server/`)

Approved with amendments (brief rev. 2: VAT treatment per payable item with
project/customer defaults; due dates default to end of month with the
payment-terms vocabulary; retainers in basic form). API version `1.2.0-m3`;
additive, M1/M2 routes unchanged except the project currency lock and the
archive guard promised in M2.

### Added
- **Pure money math:** `src/vat.ts` (basis points, half-up `bigint` rounding,
  exclusive/inclusive bases, four treatments), `src/agreements/schedule.ts`
  (installments split the contractual amount in its basis, per-item VAT, last
  absorbs the remainder, 1–60 items), `src/agreements/status.ts`
  (`PENDING / DUE / OVERDUE / PARTIALLY_PAID / PAID / VOID`), `src/dates.ts`
  (organization-timezone "today", ISO date arithmetic, `dueDateFor` with
  `IMMEDIATE | EOM | EOM_15 | EOM_30 | EOM_45 | EOM_60`),
  `src/retainers/schedule.ts` (chargeable service months, 120-month bound),
  `src/preview-token.ts` (generic, canonical JSON, bigint-safe).
- **Schema + migration `20261008192015_m3_agreements_installments_vat`:**
  `vat_rates` (append-only, effective-dated), `agreements` (FIXED/RECURRING,
  frozen rate, totals, terms, retainer fields), `installments`,
  `retainer_charges` (unique per agreement + month), `receivables`
  (created only when posted; `paid_minor` reserved for M4),
  `agreement_supplements`; `vatTreatment` on customers and projects.
  Amounts are `BIGINT`; calendar dates are ISO strings.
- **Routes:** `GET /v1/vat-rates`, `PUT /v1/settings/vat`;
  `POST /v1/agreements/preview`, `POST /v1/agreements`, `GET /v1/agreements`,
  `GET /v1/agreements/{id}`, `POST …/{id}/supplements`, `POST …/{id}/cancel`;
  `POST /v1/installments/{id}/trigger`; `POST /v1/retainers/preview`,
  `POST /v1/retainers`, `GET /v1/retainers/{id}/charges`,
  `POST /v1/retainers/{id}/cancel`, `POST /v1/retainers/reconcile`;
  `GET /v1/receivables`, `GET /v1/receivables/{id}`.
- **Lazy posting** (`src/agreements/posting.ts`): dated installments and
  retainer charges post when their date has arrived, on every read that
  renders agreements or receivables and on reconcile; idempotent in the store
  (receivable + marker in one transaction, unique charge per month).
- **Preview tokens freeze the rate:** a VAT-rate change between preview and
  create is `409 PREVIEW_STALE`.
- **Supplements** (`src/agreements/supplement.ts`): last-unposted / prorate /
  new installment; negative only within unposted capacity, otherwise
  `422 SUPPLEMENT_EXCEEDS_UNPOSTED` with `requiresAdjustment` naming the
  posted receivables.
- Published `details.reason` vocabularies for 409 and 422 in the API
  description (`CONFLICT_REASONS`, `VALIDATION_REASONS`).
- **Tests (79 new, 196 total, 22 files):** unit (dates, VAT table, schedule,
  status, retainer schedule, token), M3 storage contract on memory and
  Postgres, `routes-m3.test.ts` (VAT rates, preview/create/stale token/rate
  change, treatment chain, validation reasons, idempotent create + audit,
  lazy posting across a timezone midnight, manual triggers, receivable
  statuses in two timezones with seeded payments, filters, supplements in
  all three distributions, cancel rules, currency lock + archive guard,
  retainers preview/create/reconcile/cancel FULL vs WAIVE, contract).

### Changed
- `projects.hasPostedActivity` is now "has an agreement"; `POST /v1/projects/{id}/archive`
  refuses with `409 PROJECT_HAS_OUTSTANDING`. `MemoryLedgerStore.markProjectPosted`
  removed (`seedPaid` added for M4-shaped tests).
- `openapi/openapi.yaml` regenerated (3990 lines).

### Technical
- Verification: typecheck, lint, `npm run test:db` (196), `openapi:check`.
- Deferred to M4/M5 (brief rev. 2): payments and allocations, credits/
  adjustments against posted receivables, retainer amendments and proration,
  invoice numbering, summaries.

---

## [Unreleased] - 2026-10-08 — M3 design brief + test plan (agreements, installments, VAT)

### Added
- `.claude/designs/money-v1-m3-agreements-installments-vat.md` — fixed-fee
  agreements, installments, effective-dated VAT, lazy posting of dated
  installments, supplements within unposted capacity, cancel while nothing is
  posted, receivables with server-computed statuses. Seven decisions for
  product-owner approval; no code until approved.
- `.claude/designs/money-v1-m3-agreements-installments-vat-tests.md`.

---

## [Unreleased] - 2026-10-08 — `npm run openapi:json` for Malafat's vendored contract

### Added
- `server/src/scripts/export-openapi.ts --json` (`npm run openapi:json`):
  prints the contract as JSON inside a `_vendored` envelope (source, git
  commit, sha256 of the YAML). Malafat keeps that output at
  `apps/web/src/features/money/contract/mutaba3a-openapi.json`, and its
  contract test fails when the Malafat client calls anything not in it. Refresh
  the copy whenever `openapi.yaml` changes.

---

## [Unreleased] - 2026-10-08 — Money v1 Milestone 2: customers, projects, external references, import (`server/`)

Approved by the product owner the same day (all six decisions in the brief).
API version `1.1.0-m2`; everything additive, M1 untouched.

### Added
- **Schema + migration `20261008152452_m2_customers_projects`:** `customers`,
  `projects` (one currency each, `version` for optimistic concurrency,
  ACTIVE/ARCHIVED, never deleted) and `external_references` (unique per
  organization + provider + entity type + external id; one per entity per
  provider). Keyset indexes on `(organizationId, createdAt, id)`.
- **Routes:** `POST/GET /v1/customers`, `GET/PATCH /v1/customers/{id}`,
  `POST /v1/customers/{id}/archive`; the same for `/v1/projects`;
  `POST /v1/import/preview` and `POST /v1/import/commit`. Scopes
  `customers:*` / `projects:*` (import needs both write scopes). Creation
  with an `externalReference` is idempotent (200 existing, never a
  duplicate) and requires a CONNECTED integration; `PATCH` needs
  `If-Match: <version>`; a project's currency is locked once anything is
  posted (`hasPostedActivity`, always false until M3); archiving a customer
  with active projects is refused.
- **`src/pagination.ts`:** opaque `(createdAt, id)` cursors, `limit` 1–200
  default 50, shared by every list.
- **`src/import/plan.ts`:** the pure planner preview and commit share
  (`create | link | conflict` per row, reasons `UNKNOWN_CUSTOMER`,
  `CUSTOMER_MISMATCH`, `CURRENCY_DIFFERS`, `VALIDATION:<detail>`, warnings
  `NAME_DIFFERS`, `ARCHIVED`; 500-row cap). `src/import/preview-token.ts`:
  sha256 proof that commit carries the previewed rows, verified in constant
  time, never stored.
- **`src/if-match.ts`** middleware; `src/routes/shared.ts` (error response
  sets, connected-integration guard, page helpers, reference batch lookup).
- **Published `details.reason` vocabulary** for 409 CONFLICT
  (`VERSION_MISMATCH CURRENCY_LOCKED CUSTOMER_MISMATCH HAS_ACTIVE_PROJECTS
  PREVIEW_STALE INTEGRATION_NOT_CONNECTED`) in the OpenAPI description.
- **Tests (52 new, 117 total, 13 files):** `pagination.test.ts`,
  `import/__tests__/plan.test.ts`, `preview-token.test.ts`, the M2 storage
  contract (`store-contract-m2.ts`, run by memory and Postgres), and
  `routes-m2.test.ts` (scope matrix, idempotency, external-reference
  idempotency, pagination, If-Match, archive rules, currency lock, import
  preview/commit/re-run/partial failure/isolation, contract check).

### Changed
- `LedgerStore` gains `customers`, `projects`, `externalReferences`; both
  implementations updated. `MemoryLedgerStore.markProjectPosted()` is a test
  hook for the M3 currency lock.
- `openapi/openapi.yaml` regenerated (2036 lines); `openapi:check` green.
- `money-v1-api-contract.md` §3 M2 marked implemented (with the entity-type
  refinement of external-id uniqueness); the M2 brief status → implemented.

### Technical
- Verification: typecheck, lint, `npm run test:db` (117, Postgres 16),
  `openapi:check`. Migration generated with `prisma migrate dev` and applied
  with `migrate deploy`; production picks it up through `deploy.sh`'s proxy
  step, no runbook change.
- Debt: TD-020 (import `loadState` reads linked entities one by one; bounded
  by the 500-row cap, batch it when M3 adds more lookups).

---

## [Unreleased] - 2026-10-08 — M2 design brief + test plan; TD-018 accepted

### Added
- `.claude/designs/money-v1-m2-customers-projects.md` — Milestone 2 design
  brief (customers, projects, external references, import preview/commit,
  pagination, optimistic concurrency). Six decisions listed for product-owner
  approval; no code until approved (CLAUDE.md lifecycle).
- `.claude/designs/money-v1-m2-customers-projects-tests.md` — the test plan
  that lands first once approved.

### Changed
- `TECH_DEBT.md` TD-018 → **Accepted**: keys stay operator-issued, no
  self-serve (product-owner decision; Malafat records the same in its
  ADR-150 addendum together with MAL-870: Money included for every tenant as a
  $0 Stripe add-on).

---

## [Unreleased] - 2026-10-08 — Deploy path revised: production only, everything local except hosting (ADR-026 rev. 2)

### Changed
- Product-owner direction after the first deploy artifacts landed on `main`:
  no staging for now, and nothing runs in GCP that can run on the operator's
  machine — build with the local Docker daemon and push, like Malafat's
  `pnpm release`.
- `server/scripts/deploy.sh` — no environment argument (production; a later
  `ENVIRONMENT=staging` still works), `docker build --platform linux/amd64`
  + `docker push` from the operator's daemon, `prisma migrate deploy` run from
  `server/` through the **Cloud SQL Auth Proxy** on `127.0.0.1:5440`, then
  `terraform apply -var image_tag`, then smoke. Checks for every tool up front.
- `server/infrastructure/terraform` — the Cloud Run migration job and the
  Cloud Build API are gone; `environment` defaults to `production`,
  `db_availability` to `REGIONAL`; new outputs `proxy_port` and the sensitive
  `local_database_url` for operator-side migrations and psql.
- `server/Dockerfile` — back to a single runtime image (the `migrate` target
  existed only for the job); `openssl` kept for Prisma on musl.
- `.github/workflows/server-ci.yml` — builds the one image; still never pushes.
- `server/DEPLOYMENT.md`, `server/README.md`, `.claude/INFRA.md`, ADR-026,
  TEST_PLAN, CI_CD, TECH_DEBT (TD-019 wording), M1 proposal — rewritten for
  the production-only, local-build flow.

### Removed
- `server/cloudbuild.yaml`, `server/infrastructure/terraform/staging.tfvars.example`.

### Technical
- Verification: `npm run typecheck`, `npm run lint`, `npm run test:db`
  (65 tests), `npm run openapi:check`, `terraform fmt -check` + `validate`.

---

## [Unreleased] - 2026-10-08 — Money v1 M1: the hosted API becomes deployable (TD-019, ADR-026)

### Added
- `server/infrastructure/terraform/` — Terraform for one environment of the
  hosted API: Cloud SQL Postgres 16 (db `mutaba3a`, user `mutaba3a_api`),
  Secret Manager secrets with Terraform-generated values (database URL, admin
  token), a least-privilege service account, Artifact Registry, a Cloud Run
  **job** for `prisma migrate deploy`, the Cloud Run **service** with probes,
  Cloud SQL volume and secret-backed env, public invoker, and an uptime check
  with an optional alert. `environment` selects `-staging`/`test` keys vs
  production/`live` keys. `max_instances` is validated to 1 (TD-017).
- `server/scripts/deploy.sh` — the operator rollout: Cloud Build (or local
  Docker) builds both images tagged with the git SHA, a targeted apply points
  the migration job at the new image, the job runs and is waited on, the full
  apply rolls the service with `SERVICE_VERSION=<sha>`, then the smoke test
  runs. The service stays on the old revision if migrations fail.
- `server/cloudbuild.yaml` — builds `mutaba3a-api` and `mutaba3a-api-migrate`
  from the two Dockerfile targets.
- `server/src/smoke.ts` + `src/scripts/smoke.ts` (`npm run smoke`) —
  post-deploy checks over an injected `fetch`: health (+ expected version),
  readiness, contract, three auth rejections, and with `MUTABA3A_ADMIN_TOKEN`
  the M1 exit criterion end to end (provision → issue key → validate → revoke
  → revoked key rejected). Never prints a secret. 5 tests in
  `src/__tests__/smoke.test.ts` run it against the in-memory app.
- `.github/workflows/server-ci.yml` — on every change under `server/`:
  type-check, lint, `openapi:check`, unit + route tests, the Postgres contract
  suite against a `postgres:16` service container, both Docker builds with a
  `/health` probe of the runtime image and a Prisma CLI check of the migrate
  image, `terraform fmt -check` + `validate`. Resolves TD-019.
- `server/DEPLOYMENT.md` — the operator runbook: prerequisites, staging,
  proof, provisioning the first firm, wiring Malafat (`malafat-web-mutaba3a-api-url`),
  production, day-2 operations, the ticket-closure table and what comes next.
- `.claude/INFRA.md` — created (CLAUDE.md listed it; it did not exist).

### Fixed
- `server/Dockerfile` — the migration story was broken: `npm prune --omit=dev`
  removed the Prisma CLI from the runtime image, so the documented
  `npx prisma migrate deploy` job would have tried to download it at run time.
  The Dockerfile now has a `migrate` target (full dependency tree, no app code,
  `CMD node_modules/.bin/prisma migrate deploy`) beside `runtime`, and both
  stages install `openssl` for Prisma's musl engines. `.dockerignore` added.

### Changed
- `server/README.md` — Deploy section points at Terraform, `deploy.sh` and
  `DEPLOYMENT.md`; Verify lists `npm run smoke` and CI.
- `.claude/designs/money-v1-m1-proposal.md` — deployment steps replaced by the
  shipped artifacts; acceptance table updated (implementation merged to main).

### Technical
- Malafat side (same day, its own changelog): `MUTABA3A_API_URL` is mounted
  from the secret `malafat-web-mutaba3a-api-url` in `release.ts`, listed as
  required by the secrets gate, with a release step to create it first.
- Verification: `npm run typecheck`, `npm run lint`, `npm run test:db`
  (65 tests, 7 files, Postgres 16), `npm run openapi:check`,
  `terraform fmt -check` + `terraform validate` (google 5.45.2, random 3.6.3).
  The Docker builds could not be run in the authoring environment (no daemon);
  CI builds them on the first push.

---

## [Unreleased] - 2026-10-08 — Money v1 Milestone 1: hosted Mutaba3a API (`server/`)

### Added
- `server/` — a standalone npm package (`@mutaba3a/api`): the hosted,
  organization-scoped financial API that Malafat's Money section calls
  (MUT/MAL Money v1, Option B; ADR-024/025). Hono + zod-openapi, Prisma 6 on
  Postgres, pino, vitest. Own lockfile, lint, Dockerfile and README.
- Milestone 1 surface: `GET /health`, `GET /ready`, `GET /v1/integration`
  (validate key; organization, masked key, scopes, missing scopes, binding),
  `POST /v1/integration/bind` (idempotent tenant binding, ORGANIZATION_MISMATCH
  on conflict), `POST /v1/integration/disconnect` (preserves history, revokes
  the calling key), and operator provisioning under `/admin/v1/*` behind
  `MUTABA3A_ADMIN_TOKEN` (organizations, API keys shown once, revoke, audit).
- Cross-cutting: API-key auth (format, sha256 storage, constant-time compare,
  live/test environment split, revocation, expiry), closed scope vocabulary,
  per-key sliding-window rate limit with `X-RateLimit-*`/`Retry-After`,
  `Idempotency-Key` middleware (replay / reuse-rejection / in-progress),
  append-only audit, standard error envelope with stable codes, request ids,
  decimal-safe `Money` (bigint minor units, string on the wire).
- Prisma migration `20261008093850_m1_control_tables`: organizations,
  api_keys, integrations, audit_events, idempotency_keys.
- Generated contract `server/openapi/openapi.yaml` with `openapi:generate` /
  `openapi:check`; `provision` CLI.
- Tests: 59 (money, keys/scopes, rate limiter, LedgerStore contract against
  memory and Postgres, route tests covering every auth failure code, scope
  enforcement, idempotency, binding conflicts, disconnect, isolation).
- Design artifacts: `.claude/designs/money-v1-repository-audit.md`,
  `money-v1-api-contract.md`, `money-v1-m1-proposal.md`.

### Changed
- `eslint.config.js` ignores `server/` (it has its own config).
- `.claude/DECISIONS.md`: ADR-024 overrides ADR-005 (MUT-30); ADR-025 records
  the hosted-API architecture (MUT-32). ADR-013 is unchanged.

### Technical
- The desktop/PWA app (`src/`) is untouched; it imports nothing from
  `server/`. Local-only operation remains a permanently supported mode.
- `server/.npmrc` sets `legacy-peer-deps` to work around an npm 10.9 arborist
  crash (`edgesOut`) when resolving zod 4 peer ranges.
- Debt: TD-017 (per-instance rate limiter), TD-018 (operator-only
  provisioning; no self-serve accounts), TD-019 (no CI for `server/`).

---

## [Unreleased] - 2026-10-05 — Updater signing key rotation

### Changed
- Rotated the Tauri updater public key in `src-tauri/tauri.conf.json` to the
  keypair with minisign fingerprint `AB7B64537B1DE22C` (was `BEDF931CA1D6C777`).
  The matching private key is what `deploy.sh` and `build-windows.yml` sign
  release artifacts with, via `TAURI_SIGNING_PRIVATE_KEY`.
- Consequence: builds already installed in the field carry the old public key,
  so they will reject updates signed with the new private key. Clients on an
  older build need a manual reinstall to rejoin the update channel.
- **Withdrawn 2026-10-10 (MUT-49, ADR-031).** The premise above was false: the
  v0.0.63 signatures, the macOS release signer and the CI secret are all
  `BEDF931CA1D6C777`; the `AB7B64537B1DE22C` private half never signed a
  release and is not configured in the pipeline. The key was restored on
  2026-10-10; no reinstall is needed.

---

## [Unreleased] - 2026-10-05 — MUT-28 OAuth client for Malafat workspaces

### Added
- PKCE S256 helpers (`src/sync/transport/oauth-pkce.ts`), verified against the
  RFC 7636 Appendix B test vector. `plain` is not implemented.
- Malafat authorization-code client (`oauth-client.ts`): RFC 8414 discovery,
  authorize URL, callback parsing, code exchange, refreshing.
- Flow orchestrator (`oauth-flow.ts`): connect, refresh, disconnect. Owns the
  guarantee that revoked consent clears a token and never application data.
- Token storage port (`src/services/tokenStore.ts`), keyed per workspace origin
  so one lawyer can serve two firms.
- Published CIMD document at `public/.well-known/oauth-client.json`, with a test
  that re-states Malafat's own validation rules against the shipped artifact.
- Rust loopback callback listener (`src-tauri/src/sync/oauth_callback.rs`) plus
  `bind_oauth_callback` / `await_oauth_callback` / `cancel_oauth_callback`.
  Binds 127.0.0.1 only, serves exactly one redirect, releases its port on every
  exit path.
- `tauri-plugin-opener`, scoped to `https://*.malafat.app/*`, to open the
  authorize page in the system browser rather than the webview.

### Fixed
- Declared `tempfile` as a `[dev-dependency]`. The Rust test target had never
  compiled, so 14 pre-existing tests had never run. They pass (see TD-016).

### Technical
- 79 new assertions; `cargo test --lib` 24 passed, `vitest` 2024 passed.
- Verified empirically that Vite ships `public/.well-known/` into `dist-web`.
- Findings: `.claude/designs/mut-28-oauth-client-findings.md`. Three Malafat-side
  policy gaps (MCP gate, missing money scopes, one-grant-per-user vs a
  multi-device desktop app) are recorded on MAL-870 and MUT-28.
- New decision: ADR-023. ADR-005 and ADR-013 remain Active and unoverridden —
  that is MUT-30's job and gates any cloud sync shipping.

---

## [Unreleased] - 2026-10-05

### Fixed
- **Overdue computed five different ways, all off by a day in some timezone** (MUT-17)
  - `/income`'s Overdue tab badge counted items due today as overdue while the
    repository's `overdue` filter excluded them: the badge said 1 and the list
    it opened showed 0. Three screens gave three answers for the same row.
  - Root cause: three duplicate helpers derived "today" as
    `new Date().toISOString().split('T')[0]` — the **UTC** date. In
    Asia/Jerusalem 00:00–03:00 local that is yesterday (overdue items
    under-reported); in America/New_York after ~20:00 it is tomorrow (items due
    today reported overdue).
  - `getDaysUntil` parsed its argument as UTC midnight and compared against
    local midnight, so it was one day off for every timezone west of UTC. Its
    tests passed only because the dev machine is UTC+3; they failed 3/3 under
    `TZ=America/New_York`.
  - **New records got the wrong default date**: `IncomeDrawer`,
    `ExpenseDrawer`, `RetainerDrawer` and `RecurringRuleDrawer` seed from
    `todayISO()`, so a Jerusalem user adding income at 01:00 got it dated
    yesterday.
  - `getAttentionReceivables` derived its 7-day bound via `toISOString()` on a
    local-shifted `Date`, so the window was a day off west of UTC.
  - `ClientDetailPage`'s transactions tab classified overdue as
    `daysUntilDue < 0` without checking the row was unpaid income, so a paid
    invoice or an expense with a past due date rendered as overdue.
  - Files: added `src/lib/dates.ts` + `src/lib/__tests__/dates.test.ts`;
    changed `src/lib/utils.ts`, `src/lib/aggregations.ts`,
    `src/db/repository.ts`, `src/pages/income/IncomePage.tsx`,
    `src/pages/clients/ClientDetailPage.tsx`,
    `src/components/transactions/TransactionStatusCell.tsx`,
    `vitest.config.ts`, `package.json`.
  - Test status: 50 new tests in `dates.test.ts`, green from UTC-10 to UTC+14.
    Full suite Asia/Jerusalem 22 → 21 failures, America/New_York 29 → 25. All
    remaining failures pre-existing and separately ticketed (MUT-19, MUT-20,
    and 4 out-of-scope UTC sites).

### Added
- **`src/lib/dates.ts`**: canonical date-only logic — `todayLocalISO`,
  `daysBetweenLocal`, `daysUntilDue`, `isOverdueReceivable`, `daysOverdue`,
  `isDueSoon`, `isValidDateOnly`. Pure predicates taking `today` explicitly;
  `Date.UTC`-based day ordinals so arithmetic is exact across DST. See ADR-022.
- **Timezone-pinned tests**: `vitest.config.ts` sets `TZ` (default
  `Asia/Jerusalem`) so date tests are deterministic; `npm run test:tz` runs the
  suite under `America/New_York`. Previously results depended on the
  developer's machine and 7 timezone bugs were invisible.
- **Boundary tests** on `IncomePage`: due today is not overdue, due yesterday
  is. Suite clock pinned to 2026-03-14, the instant its fixtures were always
  written against (closes most of MUT-21).

### Technical
- Removed the private `formatLocalDate` duplicate from `src/lib/utils.ts` and
  the private `todayISO` copy from `src/db/repository.ts`.
- `getDaysUntil` is now a one-line delegate, kept for display-only call sites
  (Insights/Reports CSV columns, `ProjectDetailPage`, `TransactionsPage`).
- Zero inline overdue expressions remain in `repository.ts` or
  `aggregations.ts`.

---

## [Unreleased] - 2026-03-14

### Changed
- **ProjectDrawer Profile Selector**: Profile selector now displays when at least one profile exists (changed from requiring 2+ profiles)
  - Updated condition from `profiles.length > 1` to `profiles.length > 0` in `src/components/drawers/ProjectDrawer.tsx:167`
  - Makes profile association explicit and visible even for single-profile users
  - Aligns with UX principle of making profile relationships transparent
  - Added 5 comprehensive tests for profile selector behavior in `ProjectDrawer.test.tsx`:
    - Shows selector when one profile exists
    - Shows selector when multiple profiles exist
    - Allows selecting a profile
    - Pre-populates with active profile
    - Hides selector when no profiles exist
  - Files changed: `ProjectDrawer.tsx`, `ProjectDrawer.test.tsx`
  - Test status: 13 passing (2 skipped)

### Added
- **Partial Payments UI Integration**: Fully integrated partial payment functionality into income tables across the application
  - Added `PaymentStatusBadge` component to display payment status with percentage for partial payments
  - Exported `PaymentStatusBadge` from `src/components/ui/index.ts`
  - Updated `transactionRepo.list()` to compute `paymentStatus` and `remainingAmountMinor` for all income transactions
  - Income tables now show:
    - Payment status badge (Paid, Partial X%, Unpaid)
    - Received amount display for partial payments
    - "Record Payment" action in row menu for unpaid income
    - Visual indication of payment progress
  - Updated pages:
    - `/income` (IncomePage.tsx) - main income ledger
    - `/projects/:id` (ProjectDetailPage.tsx) - project transactions tab
    - `/clients/:id` (ClientDetailPage.tsx) - receivables tab and transactions tab
  - Added comprehensive tests in `IncomePage.test.tsx`:
    - PaymentStatusBadge rendering
    - Partial payment display
    - Record payment action availability
    - Payment status calculations
  - All translations (en, ar) already in place for partial payment UI
  - Removed completed TODO item

### Fixed
- **Timezone Bug in Recurring Expense Calculations**: Fixed `shouldRuleOccurInMonth` in `forecastCalculations.ts` to use consistent year/month numeric comparison instead of Date object comparison, which was causing incorrect results in UTC+ timezones
- **untilDate End Mode**: Fixed end date logic to properly exclude months where the occurrence day would fall after the end date

### Added
- **Recurring Source Badge**: Expenses generated from recurring rules now display a "Recurring" badge next to the title
  - Added `.recurring-badge` CSS styling in `index.css`
  - Added translation keys `expenses.fromRecurring` and `expenses.recurringBadge`
- **Profile Mode Indicator**: Expenses page now shows explicit "All Profiles" vs "Current Profile" toggle
  - Added `.expenses-mode-indicator` and `.expenses-mode-button` styles
  - Added translation keys for profile mode UI
  - Now shows all available profiles as buttons for quick switching
- **Profile-Specific Tools Card**: Shows explanatory message when in All Profiles mode about features that require a specific profile
- **Delete Action**: Added delete action to expense row actions menu with confirmation dialog
  - Special confirmation message for expenses from recurring rules
- **Keyboard Shortcuts**: Added keyboard shortcuts to expenses page
  - `N` - Open new expense drawer
  - `/` - Focus search input
  - `Esc` - Close drawer (already handled by Drawer component)
- **Profile-Aware Routing**: Clicking a profile button now navigates to `/expenses/profile/$profileId`
  - Deep-linkable profile URLs
  - URL reflects current profile context

### Changed
- **Duplicate Button**: Now properly prefills expense data (amount, currency, vendor, category, title) when duplicating
- **Multi-Currency Group Totals**: `ExpenseGroupedView` now shows separate totals per currency instead of summing all currencies
- **SearchInput Component**: Now uses `forwardRef` and exposes `focus()` method via ref

### Fixed
- **GAP 1**: Delete action now available in row actions menu
- **GAP 2**: Duplicate button now prefills expense data correctly
- **GAP 3**: Page mode is now explicit with visible toggle
- **GAP 4**: Profile selection now navigates to profile-specific URL
- **GAP 6**: Multi-currency group totals now show separate amounts per currency
- **GAP 10**: Recurring source badge now identifies expenses generated from rules

### Technical
- Changed `GroupedExpenses` interface from `totalMinor: number` to `totalsByCurrency: Record<string, number>`
- Added `.expense-title-cell` wrapper for title cell content
- Added `SearchInputRef` type export from filters
- Added `useNavigate` hook for profile-based routing

---

## [Previous] - 2026-03-13

### Added
- **Income Query Hooks (`useIncomeQueries.ts`)**: New dedicated hooks for income-specific queries
  - `useIncome(filters)`: Fetch income transactions with optional filters (pre-filters by kind='income')
  - `useIncomeById(id)`: Fetch a single income transaction
  - `useReceivables(filters)`: Fetch unpaid income (receivables) with optional overdue filter
  - `useIncomeTotals()`: Fetch income totals for overview displays
  - `useAttentionReceivables()`: Fetch receivables needing attention
  - `useCreateIncome()`, `useUpdateIncome()`: Create/update income transactions
  - `useMarkIncomePaid()`: Mark income as paid (replaces deprecated `useMarkTransactionPaid`)
  - `useRecordIncomePartialPayment()`: Record partial payments
  - `useDeleteIncome()`, `useArchiveIncome()`, `useUnarchiveIncome()`: Lifecycle mutations

### Changed
- **IncomePage**: Migrated from `useTransactions` to `useIncome` and `useMarkIncomePaid`
- **ClientDetailPage**: Migrated receivables tab from `useTransactions` to `useReceivables`, mark paid to `useMarkIncomePaid`
- **ProjectDetailPage**: Migrated mark paid from `useMarkTransactionPaid` to `useMarkIncomePaid`
- **TransactionsPage**: Migrated mark paid from `useMarkTransactionPaid` to `useMarkIncomePaid` (keeps `useTransactions` for mixed view)
- **RetainerMatchingDrawer**: Migrated from `useTransactions` to `useIncome` for paid income lookup

### Technical
- **Deprecated `useTransactions`**: Added deprecation notice; kept for legacy mixed views until next release
- **Deprecated `useMarkTransactionPaid`**: Added deprecation notice; use `useMarkIncomePaid` instead
- Proper query key separation for income queries vs generic transaction queries
- Income hooks automatically invalidate both income-specific and legacy transaction caches for backwards compatibility

---

- **Insights Reintegration (Phase 1 & 2)**:
  - **Phase 1: Data Contracts & Aggregation Functions**
    - New forecast types: `ForecastKPIs`, `AmountByCurrency`, `ForecastOptions`, `MonthActuals`, `AttentionItem` in `src/types/index.ts`
    - Pure aggregation functions in `src/lib/aggregations.ts`:
      - Date utilities: `getTodayISO`, `getMonthRange`, `getDaysInMonth`, `daysBetween`, `isDateInRange`
      - Amount utilities: `zeroAmounts`, `addAmount`, `subtractAmount`
      - Transaction grouping: `getTransactionEffectiveDate`, `groupTransactionsByDay`, `groupTransactionsByMonth`
      - Forecast calculations: `calculateForecastKPIs`, `calculateMonthActuals`, `calculateRunningBalance`
      - Attention helpers: `findOverdueUnpaidIncome`, `findUnpaidIncomeDueSoon`, `findUnpaidIncomeMissingDueDate`
    - 60 unit tests for aggregation functions in `src/lib/__tests__/aggregations.test.ts`
    - Terminology update per ADR-010: "receivables" → "unpaid income", "projections" → "projected retainer"
  - **Phase 2: Home Page Components**
    - `PredictiveKpiStrip` component: 3 forecast KPI cards (Will I Make It?, Cash on Hand, Coming/Leaving)
    - `AttentionFeed` component: Severity-sorted attention items with max 5 items, collapsible
    - `MonthActualsRow` component: Collapsible summary of received/unpaid/expenses/net
    - `InfoIcon` in icons
    - Updated `OverviewPage` to use new components (current-month only, no date range selector)
    - i18n translations for all new components (English and Arabic)
    - CSS styles for all new components
  - **Phase 3: Insights Page Enhancement**
    - Added Cash Flow Timeline link to Insights Summary tab
    - Links to `/money-answers` page for dedicated timeline view with its own date picker
    - i18n translations for timeline link and hint text (English and Arabic)
    - Removed inline period toggle and inclusion toggles to avoid conflicts with Insights date range
  - **Phase 4: Polish, Responsiveness, Testing, Documentation**
    - **Responsive Design**:
      - Added mobile breakpoint (480px) for attention-feed, actuals-row, kpi-card-forecast
      - Stack layouts and reduced padding on small screens
      - Hidden currency tabs on mobile in actuals-row (uses localStorage default)
    - **Accessibility Improvements**:
      - AttentionFeed: semantic `<ul>`/`<li>` with role="list"/role="listitem"
      - Added aria-label on attention list container
      - Added aria-hidden="true" on decorative icons
      - Added aria-label on action buttons for screen readers
      - Added aria-expanded on expand/collapse toggle buttons
    - **Component Documentation**:
      - Updated COMPONENT_REGISTRY.md with new Home components section
      - Documented PredictiveKpiStrip, AttentionFeed, MonthActualsRow, QuickSummaries, InfoIcon
      - Added props tables, usage examples, and accessibility notes
      - Updated Component Ownership table
    - **Integration Tests**:
      - 47 new tests for Home components in `src/components/home/__tests__/`
      - AttentionFeed.test.tsx: rendering, accessibility, severity styling, actions, currency display
      - PredictiveKpiStrip.test.tsx: currency tabs, help tooltips, value display, Coming/Leaving card
      - MonthActualsRow.test.tsx: expand/collapse, localStorage persistence, currency tabs, color coding

### Fixed
- **Desktop app update mechanism**:
  - Fixed `deploy.sh` signature extraction - was including full CLI output instead of just the base64 signature in `latest.json`, breaking Tauri's auto-updater
  - Added version change detection (`handleVersionChange()` in `src/lib/platform.ts`) - clears update-related localStorage caches when app version changes, ensuring users who install a new DMG see the correct version (macOS preserves app data across installs)

### Added
- **Migration Safety Layer** (`src/db/migration-safety.ts`):
  - Automatic pre-migration backups to prevent data loss during schema updates
  - Post-migration validation to detect missing fields (profileId, receivedAmountMinor)
  - Auto-fix capability for common migration issues
  - Backup storage in separate IndexedDB database (`mutaba3a_backup`)
  - Recovery functions: `restoreFromBackup()`, `importBackupFromFile()`
  - Validation functions: `validateMigration()`, `autoFixMigrationIssues()`
  - Export functions: `downloadBackup()`, `exportCompleteBackup()`
  - Migration event logging for audit trail
  - Keeps last 3 backups automatically, cleans up older ones
  - Tests: 16 tests in `src/db/__tests__/migration-safety.test.ts`
  - Integrated into `initDatabase()` - runs automatically on app startup
  - `repairDatabase()` function for manual recovery

- **AmountWithConversion component**: New UI component that displays single-currency amounts with hover tooltip showing ILS-converted value using live FX rates from Frankfurter API
  - Used in transaction tables where each row has a single currency
  - Shows original currency with hover tooltip displaying approximate ILS conversion and FX rate source (Live/Cached)
  - Graceful degradation: shows plain amount if FX rate unavailable

### Changed
- **Multi-currency display reintegration**: Updated all transaction-related pages to use unified currency display components
  - **TransactionsPage**: Uses `AmountWithConversion` for individual transaction amounts with hover conversion
  - **OverviewPage**: Uses `AmountWithConversion` in recent activity and needs attention sections
  - **ClientDetailPage**: Uses `AmountWithConversion` in transaction tables and recent activity
  - **ProjectDetailPage**: Uses `AmountWithConversion` in transaction tables
  - **IncomePage**: Uses `CurrencySummaryPopup` for summary totals, `AmountWithConversion` for rows
  - **ExpensesLedgerPage**: Uses `CurrencySummaryPopup` for summary totals, `AmountWithConversion` for rows
- ILS is now the default display currency with hover tooltips showing conversion breakdown

### Changed
- **IncomeDrawer Refactor (TransactionDrawer → IncomeDrawer)**:
  - Renamed `TransactionDrawer` to `IncomeDrawer` for clarity
  - Replaced type selector (Income/Receivable/Expense) with status selector (Earned/Invoiced/Received)
  - New status model maps: Earned → unpaid, Invoiced → unpaid, Received → paid
  - Added contextual profile handling:
    - Single profile users: profile hidden
    - Multi-profile users: profile shown as compact chip
    - "All Profiles" mode: shows profile quick picker
  - Added `ProfileContextChip` component for drawer profile display
  - Added `ProfileQuickPicker` component for fast profile selection
  - Added `useProfileAwareAction` hook for profile-checking before actions
  - Updated `useDrawerStore` with `incomeDrawer` state (legacy `transactionDrawer` aliased)
  - Updated SidebarNav to use profile-aware actions
  - Added i18n keys for income drawer status labels (en/ar)
  - Migrated tests from TransactionDrawer.test.tsx to IncomeDrawer.test.tsx

### Added
- **Partial Payments Support**:
  - Added `receivedAmountMinor` field to Transaction for tracking partial payments
  - Added `PaymentStatus` type ('unpaid' | 'partial' | 'paid')
  - Database schema v14 with migration for existing transactions
  - `transactionRepo.recordPartialPayment()` method to record incremental payments
  - Updated `transactionRepo.getDisplay()` to compute `paymentStatus` and `remainingAmountMinor`
  - `PaymentStatusBadge` component (`src/components/ui/PaymentStatusBadge.tsx`)
  - `PartialPaymentDrawer` component with quick-fill buttons (25%, 50%, 100%)
  - `useRecordPartialPayment` mutation hook
  - i18n keys for partial payment UI in en.json and ar.json

- **URL-Persisted Sorting**:
  - `useSortState` hook (`src/hooks/useSortState.ts`) for URL-based sort state management
  - ClientsPage and ProjectsPage now persist sort field/direction in URL params
  - Sort state survives page refresh and navigation

- **First-Run Onboarding**:
  - `useOnboardingStore` (`src/lib/onboardingStore.ts`) - Zustand store with localStorage persistence
  - `OnboardingOverlay` component with step-based guided setup
  - `OnboardingStepIndicator` component for visual progress
  - 3-step flow: Add Client → Create Project → Record Income
  - Auto-advances when drawers complete entity creation
  - Skip option persists in localStorage
  - i18n keys for onboarding UI in en.json and ar.json

- **Multi-Profile with "All Profiles" Lens**:
  - Added `profileId` field to `Client`, `Project`, `Transaction` types for profile isolation
  - Database schema v13 with migration to assign existing records to default profile
  - `ProfileStore` (`src/lib/profileStore.ts`) - Zustand store for active profile state
  - `useActiveProfile` hook (`src/hooks/useActiveProfile.ts`) - Business logic for profile context
  - `useProfileFilter` hook - Helper for query filtering
  - "All Profiles" option in ProfileSwitcher when 2+ profiles exist
  - `ProfileBadge` component (`src/components/ui/ProfileBadge.tsx`) - Visual indicator for profile
  - `ProfilePickerModal` (`src/components/modals/ProfilePickerModal.tsx`) - Profile selection for creation flows
  - Updated drawer stores to support `defaultProfileId` parameter
  - Updated pages (Overview, Clients, Projects, Expenses) to respect profile context
  - i18n keys: `profileSwitcher.allProfiles`, `profile.select`, `profile.selectPrompt`, `profile.badge.viewingAll` (en/ar)

- **UX Redesign Phase 4 - Insights Page** (`src/pages/insights/InsightsPage.tsx`):
  - New consolidated Insights page at `/insights` replacing Reports redirect
  - Preset tabs: Summary, Clients, Projects, Expenses, Unpaid
  - Summary tab: Paid income, unpaid receivables, expenses, net calculation
  - Clients tab: Client list with paid income and unpaid breakdown
  - Projects tab: Project list with received, unpaid, expenses, net columns
  - Expenses tab: Expenses by project breakdown
  - Unpaid tab: Aging buckets (current, 1-30d, 31-60d, 60+d overdue)
  - Date range filter (period control)
  - Currency mode selector (USD, ILS, Both)
  - CSV export for each preset tab
  - Tests: 21 tests in `src/pages/insights/__tests__/InsightsPage.test.tsx`
  - i18n: Added `insights.title` and `insights.tabs.*` keys (en/ar)
  - CSS: Added `.insights-tabs`, `.insights-tab`, `.insights-section` styles

### Fixed
- **i18n**: Added missing `transactions.columns.description` key (en: "Description", ar: "الوصف")

### Changed
- **Router**: `/insights` route now uses dedicated InsightsPage instead of redirecting to ReportsPage

### Deprecated
- **MoneyAnswersPage** (`src/pages/money-answers/`): Marked as deprecated with JSDoc comments. Route redirects to `/insights`. Code kept for reference.
- **ReportsPage** (`src/pages/reports/`): Marked as deprecated with JSDoc comments. Route redirects to `/insights`. Code kept for reference.

### Added
- **UX Redesign Specification**:
  - Created `docs/ux-redesign/UX-REDESIGN-SPEC.md` - Authoritative spec for question-first UX redesign
  - Created `docs/ux-redesign/IMPLEMENTATION-PLAN.md` - 4-phase implementation breakdown with ~100 actionable tasks
  - Product direction shift: entity-first CRM → question-first cash flow workspace
  - New navigation structure: Home, Income, Expenses, Insights | Clients, Projects | Settings
  - Deprecation plan for Documents, Retainers, Engagements, standalone Reports/Money Answers

### Added
- **UX Redesign Phase 2.3 - Expenses Page** (`src/pages/expenses/ExpensesLedgerPage.tsx`):
  - New question-first expenses ledger page at `/expenses`
  - View toggles: List (default), By Category, By Project
  - Expenses summary strip showing total expenses
  - Category grouping with subtotals
  - Project grouping with subtotals
  - Transaction-based filtering (kind='expense')
  - Connects to TransactionDrawer for edit with default kind='expense'
  - Empty state with "Add Expense" action
  - Tests: 15 tests in `src/pages/expenses/__tests__/ExpensesLedgerPage.test.tsx`
  - Profile-based expense system moved to `/expenses/profiles` route

- **EmptyState Component Enhancement** (`src/components/ui/EmptyState.tsx`):
  - Added `hint` prop as alias for `description`
  - Added `actionLabel` and `onAction` props as convenience alternatives to `action` object
  - Maintains backwards compatibility with existing `description` and `action` props

- **UX Redesign Phase 3.1 - Clients List Redesign** (`src/pages/clients/ClientsPage.tsx`):
  - Added "Received" column showing paid income totals per client
  - Added summary strip with total clients count, total received, total unpaid
  - CurrencySummaryPopup for multi-currency display (USD/ILS/EUR)
  - Tests: 16 tests in `src/pages/clients/__tests__/ClientsPage.test.tsx`
  - i18n: Added `clients.columns.received` and `clients.summary.*` keys

- **UX Redesign Phase 3.3 - Projects List Redesign** (`src/pages/projects/ProjectsPage.tsx`):
  - Added columns: Received, Expenses, Net
  - Net calculation: received - expenses per project
  - Visual indicator for negative net projects (color-coded cells)
  - Summary strip with totals: projects count, received, unpaid, expenses, net
  - Tests: 23 tests in `src/pages/projects/__tests__/ProjectsPage.test.tsx`
  - i18n: Added `projects.columns.received` and `projects.summary.*` keys
  - CSS: Added `.projects-summary-strip`, `.net-cell.positive/.negative` styles

### Changed
- **UX Redesign Phase 1 Complete** (Navigation + Routes + i18n + Add Menu + Titles):
  - **Sidebar restructured** with question-first navigation sections (Main, Workspace, System)
  - **New routes**: `/income`, `/expenses`, `/insights` created
  - **Legacy redirects added**:
    - `/transactions` → `/income`
    - `/reports` → `/insights`
    - `/money-answers` → `/insights`
  - **Navigation items removed** from sidebar: Documents, Retainers, Engagements, Money Answers
  - **Global Add Menu simplified**: Removed Document option from TopBar add menu (now only: Income, Expense, Project, Client)
  - **Page title updated**: Overview page title changed from "Overview" to "Home" (en: "Home", ar: "الرئيسية")
  - **i18n labels** updated in en.json and ar.json with new nav keys
  - Files changed:
    - `src/router.tsx` - Added redirects for legacy routes
    - `src/components/layout/SidebarNav.tsx` - Already restructured with new nav sections
    - `src/components/layout/TopBar.tsx` - Removed Document from add menu
    - `src/lib/i18n/translations/en.json` - Updated overview.title to "Home"
    - `src/lib/i18n/translations/ar.json` - Updated overview.title to "الرئيسية"

---

## [0.0.51] - 2026-03-13

### Fixed
- **Desktop App Update System**:
  - Re-enabled UpdateBanner component in AppShell
  - Fixed translation interpolation syntax (changed `{{var}}` to `{var}` to match i18n system)
  - UpdateBanner now properly shows when updates are available in Tauri desktop app
  - Users see update notifications with download progress and restart prompts

### Added
- **Update Banner Tests**:
  - `src/components/__tests__/UpdateBanner.test.tsx` (11 tests) - Full coverage for update banner states
  - `src/hooks/__tests__/useTauriUpdater.test.ts` (8 tests) - Hook behavior and API tests

### Technical
- Test count increased from 337 to 356 (19 new tests for update system)
- All 356 tests passing (5 skipped)
- Files changed:
  - `src/components/ui/UpdateBanner.tsx` - Uncommented and improved implementation
  - `src/components/layout/AppShell.tsx` - Re-enabled UpdateBanner import and usage
  - `src/lib/i18n/translations/en.json` - Fixed interpolation syntax in updateBanner keys
  - `src/lib/i18n/translations/ar.json` - Fixed interpolation syntax in updateBanner keys

---

## [0.0.50] - 2026-02-09

### Added
- **Reports Feature (TD-002 Resolved)**:
  - Full Reports page at `src/pages/reports/ReportsPage.tsx`
  - 5 report presets: Summary, By Project, By Client, Expenses by Project, Unpaid Aging
  - Date range filter (This Month, Last Month, This Year, All Time, Custom)
  - Currency mode selector (USD, ILS, Both)
  - CSV export for all report types
  - Route activated in `router.tsx`

- **Error Boundaries (TD-008 Resolved)**:
  - `ErrorBoundary` component for app-level error catching
  - `InlineErrorBoundary` for drawer-level errors
  - CSS styling for error fallback states

- **Database Schema v12**:
  - Added compound index `[baseCurrency+quoteCurrency]` on fxRates table (TD-012 resolved)

- **Test Coverage Expansion**:
  - `src/db/__tests__/expenseRepo.test.ts` (37 tests) - Expense, category, receipt, vendor, monthClose repos
  - `src/db/__tests__/retainerRepo.test.ts` (26 tests) - Retainer, projected income, schedule generator, matching
  - `src/components/__tests__/TransactionDrawer.test.tsx` (12 tests)
  - `src/components/__tests__/ClientDrawer.test.tsx` (10 tests)
  - `src/components/__tests__/ProjectDrawer.test.tsx` (10 tests)

- **E2E Testing Infrastructure (TD-004)**:
  - Playwright test framework configured (`playwright.config.ts`)
  - E2E test files created:
    - `e2e/navigation.spec.ts` - Page navigation tests
    - `e2e/transaction.spec.ts` - Transaction CRUD tests
    - `e2e/settings.spec.ts` - Settings page tests
  - npm scripts: `test:e2e`, `test:e2e:ui`

- **Accessibility Testing Infrastructure (TD-009)**:
  - axe-core/playwright installed for automated a11y testing
  - `e2e/accessibility.spec.ts` - Tests for WCAG compliance on all main pages

- **Pagination Infrastructure (TD-005)**:
  - `Pagination` component at `src/components/ui/Pagination.tsx`
  - `ChevronLeftIcon` and `ChevronRightIcon` icons
  - Pagination CSS styles with RTL support

- **SQLite Migration Preparation (TD-013)**:
  - Created `src/db/interfaces.ts` with TypeScript interfaces for all repositories
  - 19 repository interfaces defined for complete data layer abstraction
  - `IRepositoryProvider` factory interface for platform-based implementation selection
  - Exported interfaces from `src/db/index.ts`

### Fixed
- Fixed missing required fields in test data (BusinessProfile, Receipt)
- Fixed unused variable warning in retainerRepo.test.ts

### Technical
- Test count increased from 246 to 337 (91 new tests)
- All 337 tests passing (5 skipped)
- TD-002, TD-008, TD-012 resolved
- **Sync Feature Audit (TD-003 Updated)**:
  - Verified bundle export/import sync is fully working
  - All sync modals wired in AppShell (Export, Import, Pairing)
  - `initializeSync()` called on app load
  - SyncSection component displayed in Settings
  - Updated TD-003 status: bundle sync working, live LAN sync needs Tauri verification

---

## [0.0.49] - 2026-02-09

### Added
- **Comprehensive Test Coverage for Main Flows**:
  - `src/db/__tests__/transactionRepo.test.ts` (37 tests) - Full CRUD, filtering, totals, overdue/attention logic
  - `src/db/__tests__/clientRepo.test.ts` (22 tests) - CRUD operations and client summaries
  - `src/db/__tests__/projectRepo.test.ts` (24 tests) - CRUD operations and project summaries
  - `src/db/__tests__/settingsRepo.test.ts` (16 tests) - Settings, FX rates, categories
  - `src/db/__tests__/aggregations.test.ts` (27 tests) - Pure aggregation functions
- Extended `src/test/utils.tsx` with new factory functions:
  - `createMockTransaction`, `createMockProject`, `createMockCategory`, `createMockFxRate`
  - Helper functions: `createMockIncome`, `createMockExpense`, `createMockReceivable`, `createMockOverdueReceivable`
  - Date utilities: `getRelativeDate`, `getRelativeTimestamp`

### Changed
- Updated `TEST_PLAN.md` with current coverage status
- Updated `TECH_DEBT.md`:
  - TD-001 status changed to "In Progress" with updated coverage information
  - Added TD-012 for fxRateRepo.getLatest() missing compound index bug

### Technical
- Test coverage improved from ~3% to ~40%
- All 246 tests passing (2 skipped due to missing compound index)
- Repository layer now has ~85% test coverage
- Tests cover: transactions, clients, projects, documents, business profiles, settings, categories, aggregations

---

## [0.0.48] - 2026-02-09

### Added
- Created `.claude/SYSTEM_OVERVIEW.md` - comprehensive system documentation
- Created `.claude/DECISIONS.md` - architectural decision records
- Created `.claude/COMPONENT_REGISTRY.md` - reusable component catalog
- Created `.claude/PATTERNS.md` - code patterns and conventions
- Created `.claude/CHANGELOG.md` - this file
- Created `.claude/TECH_DEBT.md` - technical debt tracking
- Created `.claude/CI_CD.md` - CI/CD pipeline documentation
- Added h5, h6 heading styles to index.css for completeness

### Changed
- Updated `DECISIONS.md` ADR-018 with canonical token naming clarification
- Updated `PATTERNS.md` with Design Token Patterns section (token quick reference, button styling, focus styles, dark mode support)
- Updated `TECH_DEBT.md` with TD-011 for design system inconsistencies (now resolved)

### Fixed
- **Design System Unification (TD-011 - Resolved)**:
  - Phase 1: Added deprecation notices to legacy CSS variables in index.css
  - Phase 2: Removed dead `.landing-btn--*` classes from LandingPage.css, removed inline fallback values from 12 landing page CSS files
  - Phase 3: Migrated 39+ CSS files from legacy tokens to canonical tokens (`--font-size-*` → `--text-*`, `--font-weight-*` → `--weight-*`, `--shadow-sm/md/lg` → `--shadow-1/2/3`)
  - Phase 4: Standardized focus styles to use `box-shadow: var(--focus-ring)` instead of `outline` across 7 files; updated line-height to use `--leading-tight` (kept compact heading sizes for app UI)

### Technical
- Formalized project knowledge management system
- Design system now has single source of truth: `theme.css` for canonical tokens
- All focus-visible styles use `box-shadow: var(--focus-ring)` for consistency
- App headings use compact sizes (h1: 20px, h2: 18px, h3: 16px, h4: 14px) for data-dense cockpit UI
- Landing page headings use larger theme.css scale for marketing emphasis
- Fixed missed token migration in SplitWorkspace.css (`--shadow-lg` → `--shadow-3`)

---

## [0.0.47] - Previous

### Added
- Engagement letter feature (task/retainer types)
- PDF generation for engagement letters
- Profile-scoped engagements

### Changed
- Engagement schema to support profileId

---

## [0.0.46] - Previous

### Fixed
- Payment matching UI improvements
- Cache issues with service worker

---

## [0.0.44] - Previous

### Added
- Web release automation
- Service worker improvements

---

## [0.0.43] and Earlier

*Historical releases - see git log for details.*

---

## Migration Notes

### v0.0.48
- No database schema changes
- No breaking API changes

### v0.0.47
- Database schema v10: Added `profileId` to engagements table
- Migration: Existing engagements assigned to default profile

### v0.0.44
- Database schema v9: Added engagement tables

---

## Version History Summary

| Version | Date | Highlights |
|---------|------|------------|
| 0.0.48 | 2026-02-09 | System documentation |
| 0.0.47 | 2026-02 | Engagement letters |
| 0.0.46 | 2026-01 | Payment UI fixes |
| 0.0.44 | 2026-01 | Web release |
| 0.0.40 | 2025-12 | Retainer matching |
| 0.0.35 | 2025-11 | Document immutability |
| 0.0.30 | 2025-10 | Expense tracking |
| 0.0.25 | 2025-09 | Document generation |
| 0.0.20 | 2025-08 | Sync foundation |
| 0.0.15 | 2025-07 | Multi-profile support |
| 0.0.10 | 2025-06 | Desktop (Tauri) |
| 0.0.5 | 2025-05 | Core MVP |
| 0.0.1 | 2025-04 | Initial release |
