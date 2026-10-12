# TECH_DEBT.md — Technical Debt Registry

> **Purpose**: Track known technical debt, workarounds, and areas needing improvement.
> **Rule**: Add debt when introduced; mark resolved when fixed.

---

## Debt Status Legend

| Status | Description |
|--------|-------------|
| **Open** | Needs attention |
| **In Progress** | Being addressed |
| **Resolved** | Fixed (move to Resolved section) |
| **Accepted** | Intentional trade-off, no action needed |

---

## Open Debt

### TD-072: The portal's vendored API types have been stale since MUT-65
**Status**: Open
**Added**: 2026-10-12 (found running MUT-66's gates)
**Priority**: Medium
**Impact**: `src/hosted/api/schema.d.ts` is generated from `server/openapi/openapi.yaml` by `npm run hosted:types`, but was not regenerated when MUT-65 landed. Regenerating it now produces ~1,040 changed lines and surfaces two real type errors the portal has been compiling past: `PaymentsList.tsx:39` and `ReceivablesList.tsx:37` pass `string | null` where `string` is required, because MUT-65 made `Payment.customerId` and `Receivable.projectId` nullable. The portal is reading those fields as if they can never be null. MUT-66 deliberately left the file alone — its design scopes it to the server, and regenerating would have dragged MUT-65's portal fixes into this ticket — so root `typecheck` still passes against the stale file.
**Remediation**: Run `npm run hosted:types`, then handle the null cases at both call sites (and anywhere else the regeneration reveals). Consider adding `hosted:types --check` to the gates, the way `openapi:check` already guards the server document, so the two can never drift silently again.
**Effort**: Small

### TD-073: Suites time out under full parallel load, because the 5 s default is tuned for isolation
**Status**: Open
**Added**: 2026-10-12 (found running MUT-66's gates)
**Priority**: Low
**Impact**: Three suites fail intermittently in a full run and pass every time in isolation. `migration-mut59.test.ts` (5 tests) times out at the 5,000 ms default in `npm run test:db` but passes 5/5 with `--testTimeout=60000`; it shells out to `createdb`/`dropdb` and applies the whole migration history per test. `IncomeDrawer.test.tsx` times out in the root run and passes 54/54 alone, where it alone takes 12.7 s. Separately, `routes-m6`'s audit-pagination assertion failed once in four full runs: it writes `payment.recorded` then `payment.reversed`, both stamped `createdAt: new Date()` by the memory store, and when the two land in the same millisecond the keyset tiebreaker is a random UUID, making the order a coin flip. None of these is a product defect, but they make a green run a matter of luck and train the eye to ignore red.
**Remediation**: Raise `testTimeout` for the DB-backed and heavy component suites (per-file `describe` options or a vitest project config) rather than globally. For `routes-m6`, advance the harness clock between the two audited writes so the ordering is determined by time rather than by UUID.

### TD-063: Sample part-paid entries have a received amount but no payment record, so paying one raises Owed now
**Status**: Open
**Added**: 2026-10-12 (MUT-86, found in the browser on `/app/clients?sample=1`)
**Priority**: Medium. This is the path the landing page's "Paid? Two taps." chapter sends visitors down.
**Impact**: `src/demo/seedData/transactions.ts` (from line 319) seeds part-paid entries with `receivedAmountMinor` set and no `PaymentRecord`. The first payment recorded on one runs `recalculateReceivedAmount`, which sums the records alone and so drops the seeded part. For example, an entry of ₪6,300 with ₪2,298.72 received and ₪4,001.28 left took a ₪2,000 payment and showed ₪4,300 left. The client's Owed now went from ₪6,901.28 up to ₪7,200, and the entry's "Recorded on the entry" row disappeared from Payments. The repository's overpayment guard also counts records only, so it allows more than the drawer does on such an entry. This predates MUT-86; the old drawer did the same. Real data rarely reaches it, because the legacy migration wrote "Migrated from accumulated total" records. TD-029 / MUT-60 is the general case (received money with no record).
**Remediation**: Have the seed write one `PaymentRecord` per part-paid entry, dated before today, instead of a bare `receivedAmountMinor`. MUT-60's backfill, a record per uncovered received amount, would also cover it.
**Effort**: Small (the seed); Medium (with MUT-60)

### TD-062: `formatAmount` prints a lone tenth ("₪887.5")
**Status**: Open
**Added**: 2026-10-12 (MUT-86)
**Priority**: Low
**Impact**: `formatAmount` (`src/lib/utils.ts`) formats with `minimumFractionDigits: 0, maximumFractionDigits: 2`, so ₪887.50 prints "₪887.5". The brief flagged it on the payment drawer's chips, which MUT-86 removed. The same output shows wherever an amount has cents ending in zero: the drawer's new title ("Record Payment · $887.5 left"), the row's Record Payment button, tables and Owed now. Tests pin the current output (`RecordPaymentButton.test.tsx` "₪70.5", `Numeric.test.tsx` "$100.5"). The drawer's amount field is not affected: `minorToAmountInput` writes "887.50".
**Remediation**: Print 0 decimals for whole amounts and 2 otherwise, using two cached formatters keyed by `amountMinor % 100 === 0`. Update the two pinned tests. This is a shared formatter, so make the change in one pass (MUT-92's craft bundle is the natural home) and check the hosted portal's own formatter too.

**Effort**: Small

### TD-071: `src/lib/aggregations.ts` and its forecast types have never had an app consumer
**Status**: Open
**Added**: 2026-10-12 (found during MUT-58's consumer audit)
**Priority**: Low
**Impact**: `src/lib/aggregations.ts` (556 lines: `calculateForecastKPIs`, `calculateMonthActuals`, `calculateRunningBalance`, the `findUnpaidIncome*` finders and their date helpers) is imported only by its own 60-test file. It was added unwired in `9fb9fd7` ("redesign"); the forecast strip computed its own copy instead. The "Forecast KPI Types" block in `src/types/index.ts` (`AmountByCurrency`, `ForecastOptions`, `ForecastKPIs`, `MonthActuals`) is read only by that file, and `AttentionItem` by nothing; its comment still says it replaces `GuidanceItem`, which MUT-58 deleted. Not to be confused with `src/db/aggregations.ts`, which is live (`summarizeOwedByCurrency`, ADR-033). MUT-58 left all of it alone because the money-event read side never kept it alive.
**Remediation**: Delete `src/lib/aggregations.ts`, its test and the five types, and add the paths to a guard test like `noDeadMoneyEventModules.test.ts`. Re-grep first: a future forecast ticket may want to wire it in instead.
**Effort**: Small

### TD-058: `src/hosted/api/schema.d.ts` is stale on `main`, and regenerating it breaks the hosted typecheck
**Status**: Open
**Added**: 2026-10-12 (found by the first `make check-web` run, ADR-043)
**Priority**: High — it blocks `make release web`
**Impact**: `npm run hosted:types:check` fails on `main`. MUT-65 changed `server/openapi/openapi.yaml` (commits `7382c56`, `ac3817f`, merge `8ef2df0`) without regenerating the portal's client types, which were last written at MUT-64 (`8840f1c`). The drift is 382 insertions: the new `POST /v1/receivables/{receivableId}/settle` path, the session-may-create wording on customers and projects, and — the part that matters — `Receivable.projectId` and `Payment.customerId` becoming nullable. So this is not a stale generated file to refresh and forget: running `npm run hosted:types` makes `npm run typecheck` fail with two real errors, `src/hosted/pages/views/ReceivablesList.tsx:37` and `PaymentsList.tsx:39`, both `Argument of type 'string | null' is not assignable to parameter of type 'string'`. The portal reads fields the API may now return as null. Shipped portal code has the same gap at runtime; it is only invisible because the types were never regenerated.
**Remediation**: Run `npm run hosted:types`, then fix both views to handle a null id (a personal-profile receivable has no matter; a personal-profile payment has no client) — decide per view whether that renders a dash, hides the link, or groups under "No client". Land the regenerated `schema.d.ts` with the fixes in one commit. Add `hosted:types:check` to the server's CI alongside `openapi:check` so the pair cannot drift again.
**Effort**: Small–Medium (the regeneration is one command; the two views need a product decision about what a missing client or matter looks like)
### TD-057: Settings' Data Tools sits outside the page's scroll area and squeezes it
**Status**: Open
**Added**: 2026-10-12 (found while checking the TD-009 fixes in the browser)
**Priority**: Medium
**Impact**: `SettingsPage` renders `<DataToolsSection />` after `.page-content`, as a sibling inside `.main-content`, which is a flex column with `overflow: hidden`. Data Tools takes its full natural height, so `.page-content`, the only scroll container, gets what's left. In an 800×600 window that was 276 px, about a third of the screen, for Language through Desktop App. Data Tools itself doesn't scroll and drops the page padding: it sits flush against the sidebar. The cause predates TD-009, which didn't change the layout.
**Remediation**: Render `DataToolsSection` inside `.page-content`, after Desktop App, as one of its sections. Check that its `h2` and the padding match the other sections, and that the e2e Settings and axe specs still pass.
**Effort**: Small

### TD-054: The test suite fails under Node 25+ (Homebrew's default `node`)
**Status**: Open
**Added**: 2026-10-12 (MUT-79)
**Priority**: Medium
**Impact**: Node 25+ defines its own `localStorage` global (Web Storage), which is undefined without `--localstorage-file`, and it hides jsdom's. Every test that touches `localStorage` then fails with "Cannot read properties of undefined", including unchanged main (`SidebarNav.features.test.tsx` fails 32 of 32). On this machine `/opt/homebrew/bin/node` (26.5.1) comes before nvm's, so a plain `npx vitest run` fails. CI pins Node 22, where everything passes. MUT-79 ran its gate with nvm's Node 22.
**Remediation**: Either pass `--no-experimental-webstorage` to the test workers (checked: `NODE_OPTIONS=--no-experimental-webstorage` makes the suite pass on 26.5.1), for example through vitest's `execArgv`, or pin Node 22 with `.nvmrc` plus `engines`. Doing both is fine.
**Effort**: Small

### TD-052: Malafat's vendored OpenAPI contract not re-verified against the new deviceSession scheme
**Status**: Open
**Added**: 2026-10-12 (MUT-64)
**Priority**: Low
**Impact**: MUT-64 adds a `deviceSession` bearer security scheme to the published OpenAPI contract (pure addition — no existing scheme changes shape, Malafat only ever uses `apiKey`). ADR-037 decision 9 set the precedent that a contract change gets Malafat's vendored parser refreshed and confirmed tolerant before it ships; that verification lives in the Malafat repo, outside this one's reach, and wasn't run as part of this ticket.
**Remediation**: before the next deploy that includes this change, refresh Malafat's vendored envelope from `server/openapi/openapi.yaml` and confirm its parser doesn't choke on the unrecognized scheme name. Very likely a non-event given the addition is purely additive. **MUT-65 note (2026-10-12):** this same un-reverified contract also now carries MUT-65's two nullability changes — `ReceivableSchema.projectId` and `PaymentSchema.customerId` went required → nullable, and `ReceivableSchema` gained `title`. A Malafat client deserializing those into non-optional types would break, so the refresh below must cover both tickets' changes, not just the `deviceSession` scheme.

### TD-055: MUT-65's P2 review findings, deliberately left for a later pass
**Status**: Open
**Added**: 2026-10-12 (MUT-65 post-review pass)
**Priority**: Low — none is exploitable on its own; each is a sharp edge, not a hole
**Impact**: The MUT-65 reviews raised four P1s (all fixed in the post-review
pass — see CHANGELOG) and this P2 list, held back under an explicit scope
guard so the four fixes stayed reviewable:
1. `repositories/memory.ts` FK checks look entities up by id without
   re-asserting `organizationId` on some paths, so the memory store is more
   permissive than Prisma's real foreign keys. Test-fidelity risk only.
2. A `requestId` field carried on an input type that nothing reads.
3. `GET /v1/me`'s `access` map advertises `read-write` on domains that have
   no PATCH route, so "write" overstates what the session can actually do.
4. The organization-independent-route guard is permissive by default rather
   than listing what may skip the organization check.
5. `dueDate` is unbounded — a capture can set one centuries out.
6. The income request schema is a flat object with `kind`, not a
   discriminated union, so Zod cannot refuse `kind: 'received'` carrying
   `dueDate`; the route checks by hand instead.
7. `sessionAccess()` / `sessionScopes()` are dead exports, superseded by the
   `…For` variants MUT-65 introduced.
**Fix**: one cleanup ticket, or fold each into whichever ticket next touches
that file. Nothing here blocks MUT-65 shipping.

### TD-056: The hosted portal's "income isn't recorded" copy is now false for personal profiles
**Status**: Open — follow-up filed, MUT-93
**Added**: 2026-10-12 (MUT-65)
**Priority**: Medium — a false statement in the product's own UI
**Impact**: `hosted-portal.md` §7.4 and `src/hosted/i18n/en.json:85` hard-code
*"Income isn't recorded on hosted profiles yet. This profile is for
expenses."* for a read-only domain. After MUT-65, a personal profile's income
**is** recorded — by the user, through the phone capture app — so the string
is wrong, and the portal's read-only affordances (`§7.4`'s suppressed
"Record payment"/edit actions) arguably should unsuppress for a personal
profile too. This is `src/hosted/**` portal-UI work (copy + a real UX call
on whether to also enable editing, not just reword a sentence), a different
module than this ticket's `server/` scope and large enough to be its own
pass. Filed as MUT-93 rather than folded in, the way MUT-44's CSP gap was
left for MUT-45 to pick up.
**Fix**: reword `hosted.*` copy to reflect the mechanism `GET /v1/me`'s
`access` map already publishes per profile (MUT-65 made this mechanically
correct; only the portal's own prose and affordances are stale), decide
whether the portal gains write UI for a personal profile's income in the
same pass or a later one.

### TD-053: Owed capture is always OUT_OF_SCOPE VAT, never the organization's real rate
**Status**: Accepted
**Added**: 2026-10-12 (MUT-65)
**Priority**: Low until VAT-aware personal capture is actually requested
**Impact**: `income/compose.ts`'s `owedVatFields` always returns
`{ vatTreatment: 'OUT_OF_SCOPE', vatRateBasisPoints: 0 }` regardless of any
`VatRate` configured on the organization — a deliberate simplification named
in the design brief, not an oversight. A personal profile has no VAT
settings UI, and the phone capture app's keypad flow (MUT-68) does not
describe a VAT field; computing a real rate would need both to exist first.
**Fix**: if VAT-aware personal capture is wanted, it is its own ticket
(capture-app VAT field + compose.ts + a product decision on whether
`vatTreatment` becomes configurable per personal profile) — not a silent
addition to this one. Explicitly not folded in here (scope guard).

### TD-051: A first run stacks two first-run surfaces
**Status**: Open
**Added**: 2026-10-12 (MUT-78)
**Priority**: Low
**Impact**: With no business profile, Home renders its "Get Started" onboarding card and `WelcomeModal` opens on top of it, so a first run shows two competing first steps. Seen after "Start with your own" (MUT-78), but true of any fresh install.
**Remediation**: one first-run surface: either the Welcome dialog creates/skips the profile and then the card guides, or the card absorbs the profile step. Out of MUT-74's scope.

### TD-050: The document page's payment-request actions fail silently
**Status**: Open
**Added**: 2026-10-12 (MUT-5 final pass)
**Priority**: Low
**Impact**: `useRecordPaymentForRequest`, `useVoidPaymentRequest` and `useCreatePaymentRequest` (`src/hooks/useQueries.ts`) have no `onError`, `DocumentDetailPage` never reads the mutation error, and the app's `QueryClient` has no global mutation error handler. When the repository refuses (a payment record error, a locked entry, an IndexedDB failure), the click does nothing and the document keeps its status. The final pass fixed the one known trigger (the future-date check west of UTC), not the silence.
**Remediation**: Toast the mapped error name, as `IncomeDrawer` does (`PaymentRecordError` / `TransactionLockedError` → translated message), or add a `MutationCache` `onError` in `createAppQueryClient` that toasts any unhandled mutation failure.
**Effort**: Small

### TD-048: `theme.css` sets `font-family` on every `:lang()` element, so inline elements inside headings lose the heading face
**Status**: Open
**Added**: 2026-10-11 (MUT-75)
**Priority**: Low
**Impact**: `html:lang(en), html:lang(en) body, :lang(en) { font-family: var(--font-en) }` (and the `:lang(ar)` twin, which also sets `direction`) matches *every* element, not just the root, so a `<span>` inside an `<h1>`/`<h2>` renders in Inter instead of inheriting the serif heading. Found when the landing hero's two `<span>` lines rendered sans while the `<h1>` computed Source Serif. Worked around locally with `font-family: inherit` on `.hero-headline-line`.
**Remediation**: scope the rules to `html:lang(..)` and let inheritance do the rest; then sweep for any component that relied on the per-element reset (likely none — the root rule already sets the same family). Pairs with MUT-77 (type pairing).
**Also (MUT-79):** the `:lang(ar)` rule's `direction: rtl` beats the `dir` attribute, so every `<bdi dir="ltr">` renders right to left in Arabic. Three amount spans depend on that today: `OwedNowSummary`, `ClientWorkSection` and `HomeNeedsAttention`. Their Arabic-locale strings (`‏2,400 US$`) only look right, in CLDR's order, *because* the attribute loses. Scoping `direction` to the root therefore has to drop their `dir="ltr"` in the same change, leaving plain `<bdi>` (auto). The top bar's FX formula is the one span that must stay LTR; it states `.fx-formula[dir='ltr'] { direction: ltr }`. Tried and reverted in MUT-79.

### TD-047: The expense, retainer and plan drawers read amounts with the lenient parsers
**Status**: Open
**Added**: 2026-10-11 (MUT-5 re-review)
**Priority**: Low
**Impact**: `ExpenseDrawer`, `RetainerDrawer` and `PlanAssumptionDrawer` save `parseAmountToMinor(data.amount)`, which returns 0 for text it can't read and ignores a typed currency token. The income drawer refuses both: an ambiguous amount is a field error, and "€100" in a USD entry is refused (`amountInputCurrency`). In the other drawers "€100" is saved as 100 in the drawer's currency, and an unreadable amount relies on each schema's own checks.
**Remediation**: Validate with `parseAmountInput` (null → field error) and compare `amountInputCurrency` with the selected currency, as `IncomeDrawer` does; keep the lenient wrappers for display-only paths.
**Effort**: Small per drawer
**Update (2026-10-12, MUT-86):** the payment drawer, which was not listed but used the same lenient path (`formatCurrencyInput` filtering keystrokes, then `parseCurrencyInput`), now validates strictly. `describePaymentAmount` reads the text with `parseAmountInput`, and an unreadable amount or another currency's symbol is a field error. The three drawers above remain. `parseCurrencyInput` and `formatCurrencyInput` (`src/lib/utils.ts`) no longer have any production caller; delete them, and their `utils.test.ts` cases, when this entry closes.

### TD-046: `useTransactionActions.ts` is dead code carrying the same dateless mark-paid bug ADR-038 just fixed
**Status**: Open
**Added**: 2026-10-11 (MUT-18)
**Priority**: Low
**Impact**: `src/hooks/useTransactionActions.ts` exports `handleMarkPaid`, which
calls the deprecated `useMarkTransactionPaid()` with no date — the exact
pattern ADR-038 removed from the four live "Mark Paid" row actions. It has no
production caller (grep confirms only its own test imports it), so it poses no
current user-facing risk, but it is a second, unreachable copy of a bug this
ticket just fixed in the reachable code, and would silently reintroduce it if
ever wired up.
**Remediation**: Delete `src/hooks/useTransactionActions.ts` and
`src/hooks/__tests__/useTransactionActions.test.tsx`, or if a future page
needs a shared row-actions hook, rebuild it to route "Mark Paid" to
`openPartialPaymentDrawer` like the four live call sites.
**Effort**: Small

### TD-045: The expense drawer's default date is the browser's local date, not the organization's timezone
**Status**: Accepted
**Added**: 2026-10-11 (MUT-44)
**Priority**: Low
**Impact**: `ExpenseDrawer`'s create-mode default `occurredOn` comes from
`todayLocalISO()` (the browser's calendar date), correctly avoiding the
UTC-date bug MUT-17 fixed on the local app, but it is still the *device's*
local date rather than the *organization's* configured timezone
(`HostedProfile.timezone`). A partner recording an expense while traveling
outside the firm's timezone could see the wrong default day near midnight —
always editable before saving, so this only affects the pre-filled value, not
what can be submitted. Fix: thread `profile.timezone` into the date default
via `Intl.DateTimeFormat` with that zone, once a second real case needs it
(none does yet — every other hosted date default is either absent or already
organization-timezone-correct via the server).

### TD-044: The portal's Clients view loads the whole directory
**Status**: Accepted
**Added**: 2026-10-11 (MUT-43)
**Priority**: Low until a firm has thousands of clients
**Impact**: `useCustomerDirectory` pages through `GET /v1/customers` 200 at a
time and keeps every client in memory, so the name search is instant and every
list can show names for the ids it carries. A firm has hundreds of clients. At
thousands, add a server-side name filter to `GET /v1/customers` and search
against it.

### TD-043: Portal tables scroll sideways on a phone
**Status**: Open
**Added**: 2026-10-11 (MUT-43)
**Priority**: Low
**Impact**: below 760 px the shell becomes a top bar, but the tables keep their
columns and scroll horizontally inside their frame (the page itself doesn't).
The M8 wireframe's phone layout stacks each row into two lines. Port that
pattern to `HostedTable` when phone use is real.

### TD-042: `SearchInput` has no programmatic label and an unnamed clear button
**Status**: Open
**Added**: 2026-10-11 (MUT-43, found while reusing it in the portal)
**Priority**: Low
**Impact**: `src/components/filters/SearchInput.tsx` takes its accessible name
from the placeholder only, and its clear (×) button has no accessible name. It
affects every app list that uses it and the portal's Clients view. Fix in the
component (accept `aria-label`, name the clear button) so both get it.

### TD-041: The Expense Summary Aggregates in Process
**Status**: Open
**Added**: 2026-10-11 (MUT-42)
**Priority**: Low until a profile has thousands of expenses in one range
**Impact**: `GET /v1/summaries/expenses` reads every live expense in the range
(pages of 200 through the store) and sums them in `expenses/summary.ts`. A month
is a few dozen rows; a multi-year range on a busy firm would move every row to
the service.

The range scan uses the `(organizationId, occurredOn DESC, id DESC)` index, so
the cost is transfer and memory, not a table scan.

**Fix**: a `summarize(organizationId, from, to)` store method grouping by
`(currency, categoryId)` and `(currency, customerId)` in SQL (memory store:
the same function over its rows). Keep `summarizeExpenses` as the shaping step
and pin both with one contract test. Also consider capping the range.

### TD-040: Audit Events Written in the Same Millisecond Have No Defined Order
**Status**: Open
**Added**: 2026-10-11 (found during MUT-37)
**Priority**: Low (history readability) — and one flaky test
**Impact**: `GET /v1/audit` ("oldest first") can list two events of one
request in the wrong order; `routes-m6` "lists the organization's events by
entity" fails intermittently under full-suite load

Audit rows are stamped with millisecond precision (`createdAt` in the memory
store via `new Date()`, `TIMESTAMP(3)` with `DEFAULT CURRENT_TIMESTAMP` in
Postgres) and keyset-paginated by `(createdAt, id)`. Two events appended in the
same millisecond — `payment.recorded` then `payment.reversed` in a fast test —
fall back to comparing random UUIDs, so their order is a coin flip. Seen once
in three full `npm test` runs during MUT-37; 0 failures in 20 isolated runs.

**Fix**: a monotonic per-organization sequence (or a `bigserial`) as the
tie-breaker in both stores and in the cursor, with a contract test that
appends two events in one millisecond and expects insertion order.

**Seen again in MUT-42 (2026-10-11):** `routes-expenses.test.ts`'s audit test
compared actions in order and failed once. It now compares them as a set, so
nothing new depends on the order.

**Seen again in MUT-65 (2026-10-12):** `income-routes.test.ts`'s captureSource
audit test indexed `events[0]`/`events[1]` positionally and was flaky for the
same reason. Rewritten to `find()` by a distinguishing field instead of by
position, like MUT-42's fix.

### TD-037: The Sync Op-Log Has No Notion of a Profile
**Status**: Accepted (recorded by MUT-36; deliberately not built)
**Added**: 2026-10-11
**Priority**: Low today — becomes a blocker the day profile-selective sync is proposed
**Impact**: Profile-selective sync ("sync my firm profile, not my personal one")
cannot be expressed

`src/sync/` contains zero references to `profileId` (and `src-tauri/src` none
to `profileId`/`profile_id`). The word "profile" there means the per-field LWW
merge (`ConflictType 'profile_field'`, `applyProfileFieldOp`) and the
`businessProfile` entity type — nothing partitions, filters or scopes
operations by business profile. A sync session exchanges every captured op
(clients, projects, transactions, categories, FX rates, documents, business
profiles, payment records) regardless of which profile they belong to.

This is not a defect today: ADR-013 syncs a person's own devices, where all
profiles belong to the same person. It matters only if a future decision lets
one profile sync to a hosted service or to another person while others stay
local. MUT-34 avoided that path (ADR-037: local and hosted profiles are
separate datasets; neither syncs), so the gap is recorded, not fixed.

**If it is ever needed**: add `profileId` to `Operation`, backfill it from the
entity at capture time, and make transport filters profile-aware — a sync
protocol change requiring its own ADR (with MUT-27, TD-015).

### TD-038: English and Arabic Translations Have Drifted; Parity Is Tested for One Subtree
**Status**: Open
**Added**: 2026-10-11 (found during MUT-36)
**Priority**: Medium
**Impact**: English users can see raw keys on the retainers views; new drift
goes unnoticed

`en.json` has 1,131 leaf keys and `ar.json` 1,160. `en` is missing about 30
keys that `ar` has (`retainers.view.*`, `retainers.inspector.*`,
`retainers.scheduleState.*`, `retainers.filters.*`, `retainers.status.*`), and
`retainers.summary`
is a string in `en` but an object in `ar`. The only parity test
(`src/lib/features/__tests__/i18nParity.test.ts`) covers `settings.features`.
`t()` takes a plain string, so keys are not type-checked either.

**Fix**: a full-tree parity test (same key set, same leaf types, same `{var}`
names), then fill the gaps. MUT-43 adds the same check for the new `hosted.*`
subtree only; the rest is this entry.

### TD-039: Server Log Redaction Is Untested and Only One Level Deep
**Status**: Resolved 2026-10-11 by MUT-38 — `logger.ts` spells every sensitive key (now incl. `cookie`, `set-cookie`, `password`, `sessionToken`) at depths 0–3; `__tests__/logger.test.ts` pins all 40 combinations plus request cookies and response Set-Cookie
**Added**: 2026-10-11 (found during MUT-36)
**Priority**: High once sessions exist
**Impact**: A credential nested two levels deep in a logged object would be
written to Cloud Logging in clear

`server/src/logger.ts` redacts `req.headers.authorization`,
`req.headers["x-admin-token"]`, `*.authorization`, `*.apiKey`, `*.secret`,
`*.token`, `*.key` and the bare names. Its comment says these match "at any
depth", but pino's `*.x` wildcard matches exactly one level below the root.
No test asserts redaction (the handover's "logs redact credentials" was
exercised by hand in the 2026-10-08 e2e run). Today the request log line
carries no headers or body, so nothing leaks in practice; MUT-38 adds
`password`, a session cookie and `Set-Cookie` to the request surface.

**Fix (MUT-38)**: add the session cookie, `cookie`, `set-cookie` and
`password` paths at every depth that can occur, and a test that logs a nested
object carrying each credential and asserts `[redacted]`.

### TD-022: Release Pipeline Does Not Verify the Signer Against the Compiled-In Updater Key
**Status**: Open (ticketed as MUT-51)
**Added**: 2026-10-10
**Priority**: High
**Impact**: A release cut without the signing key configured, from the wrong
checkout, or with a different key than `plugins.updater.pubkey` publishes a
manifest every installed client either cannot find (404) or cannot verify

In `deploy.sh`, `check_updater_signing` only warns when the signing key is
missing and the release proceeds without an update archive or `latest.json`;
`load_release_env` resolves its env file relative to the current directory;
`UPDATER_PRIVATE_KEY_FILE` is declared and never read; `tag_and_push` pushes
and tags from whatever branch is checked out; and `sign_update_artifact`
passes the key and password to `tauri signer sign` as CLI arguments although
the CLI reads the `TAURI_SIGNING_PRIVATE_KEY*` environment variables itself
(the `signer sign` step in `.github/workflows/build-windows.yml` does the
same). Nothing compares the key id in the produced signatures (line 2, bytes
2..10) with the key id in `src-tauri/tauri.conf.json`, and the macOS and
Windows halves sign from separately configured secrets with no check that
they hold the same key. The Windows workflow has the matching soft-fail:
its "Build and sign NSIS updater bundle" step exits 0 with a warning when the
secret is unset and the release then carries a `latest.json` with no
`windows-x86_64` entry, so Windows clients silently never update. The macOS
path also runs no test before building; the Windows workflow now runs
`updater-config.test.ts` before `tauri build` (MUT-49), `deploy.sh` does
not. The workflow's "latest.json not found" message also pointed at
`scripts/deploy.sh`, which does not exist (fixed to `./deploy.sh` in MUT-49).
Found during the MUT-49 review (ADR-031); MUT-51 owns the hard-fail on both
paths, the file fallback, the deploy.sh test gate and the post-publish
verification.

### TD-001: Limited Test Coverage
**Status**: In Progress
**Priority**: Medium (reduced from High)
**Introduced**: 2024-05
**Updated**: 2026-03-14
**Impact**: Reduced - Core pages and repos now well tested

**Description**:
Test coverage has been significantly improved. Core pages and repositories now meet 70%+ targets.

**Current State (Updated 2026-03-14)**:
- `src/db/__tests__/` - Repository tests - **✅ ~85% coverage**
- `src/pages/clients/__tests__/` - **✅ 70.08% coverage** (33 tests)
- `src/pages/projects/__tests__/` - **✅ 73.03% coverage** (40+ tests)
- `src/pages/income/__tests__/` - **✅ ~90% coverage** (30 tests)
- `src/pages/expenses/__tests__/` - **✅ ~80% coverage** (4 pages, 67-100% each)
- `src/hooks/__tests__/` - Partial coverage for business profile and document hooks
- `src/components/__tests__/` - UpdateBanner, BusinessProfileDrawer tested
- `src/features/documents/__tests__/` - totals.test.ts, pdf.test.ts
- **Overall: ~65% coverage** (1,771 tests passing)

**Completed Since Last Update**:
- ✅ ClientsPage: Added 17 new tests (16→33), achieved 70.08% coverage
- ✅ IncomePage: Added 7 new tests (23→30), achieved ~90% coverage
- ✅ ExpensesOverviewPage: Fixed 4 failing tests, all 29 passing, 100% coverage
- ✅ All core page coverage targets met (70%+)

**Remaining Gaps**:
- Hook tests: useTransactionFilters, useProfileAwareAction, other utility hooks
- Component tests: Tables, filters, UI components
- Integration tests for complex flows
- E2E tests (planned in separate TD item)

**Remediation**:
1. ~~Add unit tests for all repository methods~~ ✅ Done
2. ~~Add page component tests~~ ✅ Done (core pages)
3. Add hook tests for utility hooks (useTransactionFilters, etc.)
4. Add component tests for tables and filters
5. Target: 80% overall coverage

**Effort**: Small (reduced from Medium) - Major work completed

---

### TD-013: SQLite Migration for Tauri
**Status**: In Progress
**Priority**: Medium
**Introduced**: 2024-06
**Updated**: 2026-03-13
**Impact**: Desktop app uses IndexedDB instead of native SQLite

**Description**:
Per CLAUDE.md project spec, the app should use SQLite in Tauri desktop builds for better performance and native file system integration. Currently, both web and desktop use IndexedDB via Dexie.

**Current State (2026-10-10, MUT-35)**:
- ✅ Repository interfaces created (`src/db/interfaces.ts`)
- ✅ All repository operations documented with TypeScript interfaces
- ✅ **Conformance is now enforced by the compiler** — `src/db/provider.ts`
  applies `satisfies` to all 21 base repositories and all 8 synced decorators.
  Deleting or renaming a repository method fails `npm run typecheck`.
- ✅ Migration Safety Layer implemented (`src/db/migration-safety.ts`)
- Schema version at 14 with all tables defined

> **Correction (MUT-35).** The entry previously claimed "Current Dexie
> implementation satisfies the interfaces". That was an assertion no check
> enforced: before MUT-35 the `satisfies` count in the codebase was 0. When
> conformance was actually applied, **7 interfaces turned out to have drifted**
> — every case an interface declaring a method the implementation never had:
> `transactionRepo.delete`, `receiptRepo.getByExpense`, `vendorRepo.findByName`,
> `monthCloseRepo.set`, `retainerRepo.delete`,
> `projectedIncomeRepo.{getBySource,getByPeriod,create,delete}`, plus
> `expenseRepo.{getYearlyTotals,getAllProfilesTotals,getReceiptCount}` missing
> from the interface and three wrong parameter/return types. All were fixed by
> correcting the interface to describe reality, never by adding runtime code.
> Lesson: "documented" and "checked" are different states; only the second
> survives contact with a refactor.

**Known gap — the seam is only half swappable.**
`gstack-shortcut(dec-5f2c2123)`: the decorators in
`src/sync/core/synced-repository.ts` bind the Dexie singletons at module load
(`clientRepo.list.bind(clientRepo)`), so `setRepositories()` redirects `base`
but **not** `synced.*`. Harmless today — nothing calls `setRepositories` outside
tests — but a hosted data source injected by MUT-43 would be silently bypassed
on every synced write path. Upgrade when MUT-43 lands: resolve the decorators
lazily through `getRepositories().base`, with a test asserting ops are captured
against a swapped base.

> **Re-homed (2026-10-11, MUT-36).** The hosted portal does not inject into
> the registry (ADR-037 decision 10: it is a separate build target with its own
> HTTP client), so MUT-43 will not trigger this. The upgrade is now due when a
> second implementation is actually injected — the SQLite/Tauri swap this
> entry tracks.

**Every declared slot has a real caller.** Verified by grepping
`base.<slot>.<method>` across `src/`: nine consumers resolve through the
provider, including `useRetainerQueries`. A slot that nothing reads would make
a future `setRepositories` swap silently leave that domain on Dexie — the
registry must never advertise coverage it does not have.

**Outside the seam.** `IRepositoryProvider` covers 21 repositories. Not covered:
`planRepo`, `planAssumptionRepo`, `planScenarioRepo` (`planRepository.ts`),
`scheduleGenerator`, `retainerMatching` (`retainerRepository.ts`) — the last two
are not repositories. `moneyEventRepo` was left alone pending MUT-11, which
kept it because three mounted Overview components imported it (ADR-029); MUT-8
deleted those components and MUT-58 deleted the repository (2026-10-12), so it
no longer needs a slot. `engagementRepo` was deleted with its module in MUT-10.
See TODOS.md item 2.

**Repository Interfaces Created**:
- `IClientRepository`, `IProjectRepository`, `ICategoryRepository`
- `ITransactionRepository`, `IProjectSummaryRepository`, `IClientSummaryRepository`
- `IFxRateRepository`, `ISettingsRepository`, `IBusinessProfileRepository`
- `IDocumentRepository`, `IDocumentSequenceRepository`
- `IExpenseRepository`, `IExpenseCategoryRepository`, `IReceiptRepository`
- `IVendorRepository`, `IMonthCloseStatusRepository`, `IRecurringRuleRepository`
- `IRetainerAgreementRepository`, `IProjectedIncomeRepository`
- `IRepositoryProvider` (factory interface)

**Remaining**:
1. Create SQLite schema matching Dexie tables
2. Implement SQLite repositories using `@tauri-apps/plugin-sql`
3. Create repository factory that selects implementation based on platform
4. Add migration logic for existing IndexedDB data → SQLite
5. Test sync operations with SQLite backend
6. Benchmark performance improvements
7. Implement SQLite-native backup (file copy) for Tauri builds

**Migration Path**:
1. **Phase 1** (Complete): Define interfaces for all repositories
2. **Phase 2**: Implement SQLite versions of repositories
3. **Phase 3**: Add platform detection and factory pattern
4. **Phase 4**: Data migration from IndexedDB to SQLite
5. **Phase 5**: Remove IndexedDB code from Tauri builds

**Note**: Migration Safety Layer is already in place for IndexedDB. When migrating to SQLite, the backup strategy should use native file system backup (copy .db file before migration) instead of the IndexedDB-based backup.

**Effort**: Large

---

### TD-003: Live Sync Not Yet Activated
**Status**: In Progress
**Priority**: High
**Introduced**: 2024-06
**Updated**: 2026-02-09
**Impact**: Users can sync via bundle export/import but not via live LAN/network sync

**Description**:
Sync infrastructure is in place (HLC, OpLog, types, conflict resolution). Bundle-based offline sync is fully working. Live network sync is partially implemented.

**Current State (2026-02-09)**:
- `src/sync/core/` - Complete types and logic ✅
- `src/sync/transport/` - Bundle encoder + crypto ✅
- `src/sync/stores/syncStore.ts` - Complete state management ✅
- **Bundle Sync (Offline)**: ✅ FULLY WORKING
  - `ExportBundleModal` and `ImportBundleModal` wired in AppShell
  - `SyncSection` in Settings page with export/import buttons
  - Encrypted bundle generation and import working
- **Wi-Fi Sync (LAN)**: PARTIALLY IMPLEMENTED
  - UI exists in `SyncSection.tsx` (Tauri-only conditional)
  - Requires Tauri backend commands (`start_sync_server`, `stop_sync_server`)
  - Device discovery and pairing UI exists
  - Status: Needs Tauri backend verification
- **Conflict Resolution UI**:
  - `ConflictBanner` component exists and renders in AppShell
  - Conflict review flow needs testing

**Remaining**:
1. ~~Wire bundle export/import to UI~~ ✅ Done
2. ~~Add sync status indicators~~ ✅ Done (SyncStatusChip, status in SyncSection)
3. Verify Tauri backend sync commands work end-to-end
4. Test Wi-Fi sync between desktop devices
5. Test conflict resolution flows
6. Consider WebRTC or relay server for web-to-web sync (future)

**Effort**: Medium (reduced from Large - much already done)

---

### TD-004: No E2E Tests
**Status**: In Progress
**Priority**: Medium
**Introduced**: 2024-05
**Updated**: 2026-10-12
**Impact**: Critical flows not validated automatically

**Description**:
No end-to-end tests exist. Critical user journeys are only tested manually.

**Current State (2026-02-09)**:
- Playwright installed and configured
- `playwright.config.ts` created with Chromium setup
- E2E tests added:
  - `e2e/navigation.spec.ts` - Main page navigation tests
  - `e2e/transaction.spec.ts` - Transaction CRUD tests
  - `e2e/settings.spec.ts` - Settings page tests
- npm scripts added: `test:e2e`, `test:e2e:ui`

**State on 2026-10-11 (MUT-15)**: `navigation.spec.ts` was rewritten for the
core four and passes (2/2) against a dev server. The other 13 cases fail and
have for some time: they open paths without the `/app` basepath (in dev `/`
is the landing page) and look for pages and headings that no longer exist
(Overview, Transactions, Reports, Projects with projects off). The config's
`webServer`/`baseURL` also hard-code port 5173, which concurrent worktrees
contend for.

**State on 2026-10-12 (e2e port-over)**: the 13 stale cases are ported or
removed and the whole suite passes (19/19; also `--repeat-each 3` and from a
cold dev server). `accessibility.spec.ts` covers the core surfaces with a
per-surface allowlist of known axe rules (TD-009); `settings.spec.ts`
switches language and theme and downloads the CSV export;
`transaction.spec.ts` became `income-drawer.spec.ts` (amount-only save,
"Amount is required", Due Date vs Received); `navigation.spec.ts` lost a
race on the Welcome dialog. Shared helpers live in `e2e/support/`. Until
the port is configurable, run from a worktree with a throwaway config on a
free port (`webServer: npx vite --port <port> --strictPort`) and delete it
afterwards.

**Remaining**:
1. Make the port configurable (`E2E_BASE_URL`) so worktrees stop needing a
   throwaway config
2. Add more E2E tests for:
   - Generate invoice
   - Import data (export is covered: the CSV download)
   - Record payment from the Income list and the client profile
   - The visitor sample entry (`/app/clients?sample=1`, MUT-78) and "Start with your own"
   - Demo mode toggle (`?demo=1`)
3. Add to CI pipeline (GitHub Actions)
4. Expand browser coverage (Firefox, Safari)

**Effort**: Medium (reduced from initial)

---

### TD-005: Large IndexedDB Tables
**Status**: In Progress
**Priority**: Low
**Introduced**: 2024-08
**Updated**: 2026-02-09
**Impact**: Performance may degrade with large datasets

**Description**:
No pagination or virtualization for large tables. Users with 10K+ transactions may experience slowness.

**Current State (2026-02-09)**:
- Repository already supports offset/limit in QueryFilters
- Created reusable `Pagination` component
- Added ChevronLeft/Right icons for pagination controls
- CSS styles for pagination added to index.css

**Remaining**:
1. ~~Implement cursor-based pagination in repositories~~ ✅ Already exists
2. ~~Add reusable pagination component~~ ✅ Done
3. Integrate pagination into TransactionsPage (requires useTransactions hook update)
4. Add virtualization for very large datasets (react-window)
5. Consider IndexedDB query optimization

**Effort**: Medium (reduced)

---

### TD-006: Demo Mode Cleanup
**Status**: Accepted
**Priority**: Low
**Introduced**: 2024-07
**Impact**: Demo data stored in same database as real data

**Description**:
Demo mode uses the same database instance with special flags. This is intentional for simplicity but means demo data cleanup must be careful.

**Current State**:
- Demo data seeded with specific IDs
- Cleanup function removes by ID prefix
- Time-frozen dates for deterministic testing

**Status**: Accepted as design choice. Demo isolation would require separate database.

---

### TD-007: Bundle Size Growth
**Status**: Open (Audited 2026-02-09)
**Priority**: Low
**Introduced**: 2025-01
**Impact**: Initial load time may increase

**Description**:
Bundle size has grown significantly. Total precache is 11.5MB (though most is lazy-loaded).

**Current State** (Audit 2026-02-09):
- **fonts-*.js**: 1,586 KB (527 KB gzipped) - 9 font families/weights bundled together
- **index-B5kMr9UK.js**: 590 KB (163 KB gzipped) - PDF library (@react-pdf/renderer)
- **index-ZWWaRq82.js**: 205 KB (48 KB gzipped) - Unknown, needs investigation
- **monthDetection-*.js**: 101 KB (32 KB gzipped) - Date utilities (a shared chunk Rollup named after `lib/monthDetection.ts`, which MUT-58 deleted)
- Vendor chunks well-organized (react, router, query, forms, db)
- Page routes are lazy-loaded correctly

**Optimization Opportunities**:
1. **Fonts** (HIGH IMPACT): 527KB gzipped for fonts is excessive
   - Move fonts to external CDN (Google Fonts, Bunny Fonts)
   - Or use font subsetting to reduce file size
   - Consider loading Arabic fonts only when Arabic is selected
2. **PDF library** (MEDIUM): Could be further lazy-loaded to only load on document export
3. **Date utilities**: Consider using native Intl APIs where possible

**Remediation**:
1. ~~Audit bundle~~ ✅ Done
2. Move fonts to CDN or use subsetting
3. Lazy-load PDF library on first document action
4. Tree-shake unused i18n strings

**Effort**: Medium

---

### TD-009: Accessibility Audit Needed
**Status**: In Progress
**Priority**: Medium
**Introduced**: 2024-05
**Updated**: 2026-10-12
**Impact**: App may not be fully accessible

**Description**:
No formal accessibility audit has been performed. Some ARIA attributes exist but coverage is inconsistent.

**Current State (2026-02-09)**:
- axe-core/playwright installed for automated accessibility testing
- Created `e2e/accessibility.spec.ts` with tests for:
  - Overview, Transactions, Projects, Clients, Reports, Settings pages
  - Transaction drawer accessibility
- Automated checks will catch common issues (WCAG violations)

**State on 2026-10-12 (e2e port-over)**: those checks never reached a page
(stale paths). `e2e/accessibility.spec.ts` now runs axe on Home (first run
and with an entry), Clients, a client's profile, Income, Settings and the
income drawer with More details open. Each surface may only break the rules
listed for it in `KNOWN_AXE_VIOLATIONS` (`e2e/support/axe.ts`); any other
rule fails the test. Owner's call: baseline and track here, fix separately.
Known violations, measured in Chromium, light theme:
- `color-contrast`, every page. White on the brand teal `#1d8a84` is 4.18:1:
  primary buttons, "+ Add", the drawer's Save, and the client name links on
  white. The active nav label and the sidebar "New" label (`#1d8a84` on
  `#e8f3f3`) are 3.69:1. The profile avatar initials are 1.04:1. The FX
  "Live" chip is 2.95:1 (since MUT-79 it is in the top-bar popover, which axe
  only sees when it is open). The "Unpaid" status badge (`#d97706` on
  `#fbf1e6`) is 2.85:1. Positive amounts (`#16a34a` on white) are 3.29:1.
  Muted text (`#94a3b8`, the Clients "last payment" dash) is 2.56:1. This
  belongs with MUT-74's palette work.
- ~~`landmark-no-duplicate-banner`, every page.~~ **Fixed by MUT-79
  (2026-10-12).** The FX banner, the Mac-app bar and the desktop update bar no
  longer claim `role="banner"`, and the top bar's `<header>` inside `<main>` is
  not a landmark. Axe confirms it on all six surfaces; the rule was removed
  from `KNOWN_AXE_VIOLATIONS`.
- ~~`aria-dialog-name`, every drawer.~~ **Fixed 2026-10-12.** `Drawer` (and
  the portal's own drawer) points `aria-labelledby` at its title.
- ~~`select-name`, on Income, the client profile and Settings.~~ **Fixed
  2026-10-12.** `DateRangeControl` is named "Period". Settings'
  default-currency select has a real `<label for>`: with `aria-labelledby`,
  axe's `label-title-only` reads the label as hidden once it is scrolled out
  of the clipped shell.
- ~~`empty-table-header`, on Income and the client profile.~~ **Fixed
  2026-10-12.** `RowActionsHeader` carries a visually hidden "Actions".
- ~~`button-name`, on Settings (the business profile's ⋯ button).~~ **Fixed
  2026-10-12.** It reads "Actions for <name>".
- ~~`heading-order`, on Settings.~~ **Fixed 2026-10-12.** The section titles
  are `h2`.

`KNOWN_AXE_VIOLATIONS` now lists only `color-contrast`.

Found while fixing these, not caught by axe (the names exist, in English):
- `RowActionsMenu`'s trigger is `aria-label="Actions"`, hard-coded English.
  Its tests render without a `LanguageProvider`, so moving it to
  `common.actions` needs a provider in those tests too.
- `CurrencySummaryPopup`'s button is "Show currency breakdown", hard-coded
  English, on Income's summary strip.

Optional areas (Projects, Insights, Expenses, Retainers, Planning, Documents)
have no axe coverage; they are off on a fresh install.

**Remaining**:
1. ~~Run axe-core or similar accessibility checker~~ ✅ Done
2. ~~Fix the structural violations above~~ ✅ Done 2026-10-12; only
   `color-contrast` is left (MUT-74). Remove it from `KNOWN_AXE_VIOLATIONS`
   when the palette lands
3. Translate the English-only accessible names listed above
4. Test with screen reader
5. Document accessibility features
6. Axe coverage for the optional areas, switched on

**Effort**: Medium

---

### TD-010: PDF Template Flexibility
**Status**: Open
**Priority**: Low
**Introduced**: 2024-09
**Impact**: Users cannot customize PDF layouts beyond predefined templates

**Description**:
Document PDF generation uses hardcoded templates (template1, template2, template3). Users cannot customize layouts.

**Remediation**:
1. Extract template components to be more modular
2. Consider template builder (future)
3. Allow header/footer customization

**Effort**: Large (if template builder), Small (if just modular)

---

### TD-023: `clearDatabase()` clears five tables, so a legacy import keeps stale optional-area data
**Status**: Open
**Priority**: Medium
**Introduced**: pre-2026 (surfaced by MUT-12, 2026-10-10)
**Impact**: A legacy ("replace all data") import wipes transactions, projects, clients, categories, fxRates and settings but leaves documents, expenses, vendors, retainers and plans. Since MUT-12, the post-import reconcile switches those areas on and the banner announces "your existing data" for rows that are leftovers from before the import.

**Description**:
`src/db/seed.ts` `clearDatabase()` predates the optional-area tables. The legacy import in `ImportDataModal` and `ImportDataPage` relies on it to mean "replace everything".

**Remediation**:
1. Decide whether legacy import means *all* user tables (then `clearDatabase()` clears every data table, or reuses `deleteAllData()`), or only the legacy export's tables (then say so in the import copy).
2. Add a test that a legacy import leaves no rows in the probed tables.

**Effort**: Small

---

### TD-024: The legacy import is duplicated in `ImportDataModal` and `ImportDataPage`
**Status**: Open
**Priority**: Low
**Introduced**: when the import page was added beside the modal (surfaced by MUT-12, 2026-10-10)
**Impact**: Every change to the legacy import (MUT-12 added the feature reconcile) is made twice; the two copies already differ slightly.

**Remediation**: extract `runLegacyImport(fileData)` into `src/db/` (or `src/lib/import/`) and call it from both; one test.

**Effort**: Small

---

### TD-025: Legacy `/transactions` page keeps an ungated "Generate invoice" action
**Status**: Open
**Priority**: Low
**Introduced**: when `/transactions` became a redirect to `/income` (surfaced by MUT-13, 2026-10-10)
**Impact**: `src/pages/transactions/TransactionsPage.tsx` still renders a Generate/View invoice menu that ignores the Invoices switch. Unreachable today (the route redirects), so no user impact; it is dead code waiting for the MUT-2 deletion pass.

**Remediation**: delete `TransactionsPage` with the rest of the unreachable surface, or gate its actions with `useFeatureEnabled('invoices')` if it is ever reinstated.

**Effort**: Small

---

### TD-026: Receipts archive is built in one pass in memory
**Status**: Open
**Priority**: Low
**Introduced**: MUT-14, 2026-10-10
**Impact**: `buildAllReceiptsArchive` decodes every receipt's base64 payload across all profiles into memory before `generateAsync`; for a photo-heavy database this can be hundreds of MB in a tab. Fine for the pilot's volumes; a per-profile or per-month streaming build (JSZip `generateInternalStream`, or one ZIP per profile) is the fix.

**Remediation**: build per profile (or per month) and offer one download each, or stream; keep `receipts.count()` as the only payload-free read.

**Effort**: Small

---

### TD-029: Income saved as "Received" writes no PaymentRecord
**Status**: Open
**Priority**: Medium
**Introduced**: pre-existing; surfaced by MUT-3, 2026-10-11
**Impact**: `IncomeDrawer` (`:184-199`) saves a Received entry as `status: 'paid'`, `paidAt` and `receivedAmountMinor = amount` with no `PaymentRecord`, so anything that reads records alone misses those payments. ADR-033 works around it on read: `paymentRecordRepo.listByClient` adds an `entry` row for the uncovered amount. Other record readers (the payment drawer's history via `listByTransaction`, a future statement export) still see nothing for such an entry, and the drawer's received→invoiced edit path clears `receivedAmountMinor` directly.

**Remediation**: in MUT-5 (or alongside it), make create/edit-as-received go through `paymentRecordRepo.create` and define what received→invoiced does to existing records; backfill one record per uncovered paid entry in a Dexie upgrade. The `entry` rows then stop appearing on their own.

**Effort**: Medium

**Update (2026-10-11, MUT-5):** the edit-path half is resolved by ADR-039. An entry with live records never has its payment fields rewritten by the drawer; its status is read-only; amount changes recalculate. An entry without records keeps its `paidAt` and received amount unless its status really changes. What remains (records on create-as-received, plus the backfill) is ticketed as **MUT-60**.

---

### TD-030: Owed Now excludes archived income; client summaries and overview totals include it
**Status**: Open
**Priority**: Low
**Introduced**: MUT-3, 2026-10-11 (ADR-033 §2)
**Impact**: The client profile's Owed Now (`summarizeOwedByCurrency`) skips archived entries so it adds up to the lists beneath it. `clientSummaryRepo.list/get` (`aggregateTransactionTotals*`, `filterTransactionsByEntity*`) and `transactionRepo.getOverviewTotals*` still count archived rows, so a client with an archived unpaid entry shows a larger "unpaid" on `/clients` than "owed now" on its profile until MUT-7/MUT-8 move those screens to the shared helper.

**Remediation**: MUT-7 and MUT-8 compute owed now with `summarizeOwedByCurrency`; then decide whether the remaining aggregate helpers should skip archived rows too.

**Update (2026-10-11, MUT-7):** the clients index half is resolved. `clientSummaryRepo.list` now returns `owed` from `summarizeOwedByCurrency`, and the index reads only that. What remains: the per-currency `paidIncomeMinor*/unpaidIncomeMinor*` report fields (read by the Insights and Reports client tables) and `transactionRepo.getOverviewTotals*` still count archived income. Home (MUT-8) is next.

**Update (2026-10-11, MUT-8):** the Home half is resolved: Home's Owed now uses `summarizeOwedByCurrency`. What remains is period totals, not "owed now": `getOverviewTotals*` (read by the Income and Expenses ledgers) and the per-client report fields read by Insights and Reports still count archived income. Decide whether period reports should follow the same rule.

**Effort**: Small

---

### TD-031: `RowActionsMenu` keeps its own menu listeners and has no arrow-key support
**Status**: Open
**Priority**: Low
**Introduced**: MUT-15, 2026-10-11 (pre-existing; made visible by the new hook)
**Impact**: `src/components/ui/RowActionsMenu.tsx` duplicates the outside-click
and Escape listeners that `useMenuButton` now owns for the two `+ Add` menus,
and its items cannot be reached with the arrow keys or get focus on open. It
also positions itself in a portal, which the hook does not do.

**Remediation**: have `RowActionsMenu` take `buttonProps` / `menuProps` from
`useMenuButton()` (the hook's `contains` checks work across a portal because
they test the menu element itself) and keep only its positioning logic.

**Effort**: Small

---

### TD-032: The two `+ Add` menus share their actions but not their click behaviour
**Status**: Open (ticketed as MUT-57)
**Priority**: Low
**Introduced**: MUT-15, 2026-10-11 (pre-existing; out of the ticket's scope)
**Decision** (Basel, 2026-10-11): both menus open the drawer **in place** (no
navigation to the list) and all four actions are profile-aware in both.
MUT-57 moves them onto one set of handlers.
**Impact**: both menus offer the same actions in the same order
(`visibleAddMenuActions`), but the sidebar **New** menu opens the drawer and
navigates to the list (`/income`, `/clients`, `/expenses`, `/projects`) and
creates clients and projects without the profile picker, while the top bar
**Add** menu opens every drawer in place and is profile-aware for all four.
A user gets a different result from the same label depending on which button
they used.

**Remediation**: decide one behaviour (drawer-first says in place) and move
the handlers next to `visibleAddMenuActions` so both menus call the same one.

**Effort**: Small (decision first)

---

### TD-033: Data Tools still shows some English inside Arabic copy
**Status**: Open
**Priority**: Low
**Introduced**: found 2026-10-11 while translating the Data Tools messages
**Impact**: A failed restore toasts `settings.data.importFailed` with the raw
`Error.message` as `{error}`: `restoreFromBackup` throws English developer
strings ("Invalid backup file: missing version or tables", "Backup is from a
newer version…"), and a malformed file gives the browser's `JSON.parse`
message, so Arabic reads "فشل الاستيراد: Invalid backup file…". Separately,
`settings.exportReceiptsDone` / `exportReceiptsDesc` have one plural form:
English says "1 receipts exported", and the Arabic "{count} إيصالًا" /
"{count} ملف إيصال" is only right for 11+.

**Remediation**: have `restoreFromBackup` throw typed errors (invalid file,
newer version with `{backup}` / `{app}`) that the section maps to keys; split
the receipts strings into singular/plural keys with "label: {count}" Arabic.

**Effort**: Small

---

### TD-035: A locked income entry without a profile can't be assigned one
**Status**: Open
**Priority**: Low
**Introduced**: found 2026-10-11 while building the unassigned-records drawer
**Location**: `src/db/repository.ts` `transactionRepo.update` (lock guard), `src/components/drawers/OrphanedRecordsDrawer.tsx`
**Impact**: `transactionRepo.update` rejects every field but `archivedAt` on
a transaction locked by an exported document (ADR-014). An income entry that
is both locked and missing its `profileId` (an old import, an older sync peer)
fails in the drawer, stays listed with "couldn't be assigned", and keeps the
banner up until dismissed. Normal flows can't produce one: creating a document
needs a profile.

**Remediation**: decide (ADR) whether filling a *missing* `profileId` on a
locked entry is allowed, like ADR-030 lets locked entries take payments. If
so, add `profileId` to the lock guard's allow-list only when the existing
value is empty, with a repo test; the drawer needs no change.

**Effort**: Small (decision first)

---

### TD-036: The client and project drawers can save a record without a profile
**Status**: Open
**Priority**: Medium
**Introduced**: found 2026-10-11 while tracing where unassigned records come from
**Location**: `src/components/drawers/ClientDrawer.tsx:165` and `:66`, `src/components/drawers/ProjectDrawer.tsx:175` and `:76`
**Impact**: With more than one profile, the profile picker's first option is
"Default profile" with value `''`, and `onSubmit` saves `profileId: data.profileId || undefined`.
Picking it creates an unassigned client or project, which drops out of every
profile's lists and shows up in the orphaned-records banner.

**Remediation**: resolve `''` to the default profile's id on save (or drop the
empty option and list the profiles only), with a drawer test for each.

**Effort**: Small

---

## In Progress

*No items currently in progress.*

---

## Resolved Debt

### TD-034: The money-event read side has no consumer after MUT-8
**Status**: Resolved (2026-10-12, MUT-58)
**Priority**: Low
**Introduced**: MUT-8, 2026-10-11 (ADR-036 §3)
**Impact**: Home's forecast strip, month actuals and guidance feed were deleted by decision. They were the only readers of `src/hooks/useMoneyEventQueries.ts` (11 read hooks, zero consumers now) and, through them, `src/db/moneyEventRepository.ts` (842 lines). `invalidateMoneyEventQueries` still runs on four write paths and invalidates keys nothing reads, which wastes a little work on every save and misleads readers of those helpers.

**Remediation**: MUT-58. Delete the hooks, the repository, the invalidation helper and its call sites, and their tests. Keep the Dexie tables (ADR-029). Add the paths to a guard test.

**Resolution**: Deleted `useMoneyEventQueries.ts`, `moneyEventRepository.ts`, `lib/monthDetection.ts` (its last importers were the MUT-8 components) and the twelve money-event and guidance types in `src/types/index.ts`, with their three test files. `invalidateMoneyEventQueries` had three call sites by then, not four: since MUT-5 the income hooks reuse `invalidateTransactionQueries`. All three are gone. The two MUT-6 assertions that a payment and Mark paid refresh the money-event keys now assert that no `money*` key is refreshed. The `moneyEventVersions` table and `MoneyEventVersion` stay: they belong to sync versioning, and the schema is unchanged (ADR-029). `src/__tests__/noDeadMoneyEventModules.test.ts` keeps all of it gone. The unwired forecast helpers found on the way are TD-071.

### TD-049: `isMacOS()` is true on an iPad and `isLinux()` is true on Android
**Status**: Resolved (2026-10-12, MUT-79)
**Added**: 2026-10-12 (MUT-76)
**Priority**: Low
**Impact**: Both read `navigator.platform`/`userAgent` substrings. iPadOS 13+ reports `MacIntel`, and Android's UA contains "Linux", so `MacDownloadBanner` (the only `isMacOS` caller) offers the Mac app to iPad users. `detectDevice()` in the same file gets both right.
**Remediation**: MUT-79 (app frame) shows the Mac-app bar only on a Mac — switch `MacDownloadBanner` to `currentDevice() === 'mac'` there, then decide whether `isMacOS`/`isWindows`/`isLinux` can be deleted (their only other users are tests).
**Resolution**: `MacDownloadBanner` now uses `currentDevice() === 'mac' && !isTauri()`; `isMacOS`, `isWindows` and `isLinux` had no other callers and were deleted with their tests.

### TD-021: Two Overlapping Invalidation Key Lists for the Same Money Views
**Status**: Resolved (2026-10-11, MUT-5)
**Added**: 2026-10-10
**Priority**: Low
**Impact**: A new money query key has to be added in two places or one of the
two write paths silently serves stale data -- which is exactly how MUT-6 AC #5
broke

`invalidateIncomeQueries` (`src/hooks/useIncomeQueries.ts:61`) and
`invalidateTransactionQueries` + `invalidatePaymentRecordQueries`
(`src/hooks/useQueries.ts:21,174`) list overlapping sets of the same keys.
MUT-6 fixed the symptom by adding the four income keys to
`invalidatePaymentRecordQueries` in place; the eng review chose the smaller
arrangement deliberately over extracting a shared `invalidateMoneyQueries`,
and recorded the duplication here instead. Extract it the next time a third
caller needs the same list.

**Note (2026-10-10, MUT-6 QA):** the money-event keys hit exactly that
threshold and were extracted — `invalidateMoneyEventQueries` lives in
`useMoneyEventQueries.ts`, beside the keys it owns, and the four write paths
call it. The *income* key duplication described above is untouched and still
open; the precedent for fixing it is to put the list in the module that owns
the keys rather than in a new `src/hooks/invalidation.ts`. (2026-10-12, MUT-58:
`invalidateMoneyEventQueries` and the keys it listed were deleted with the
money-event read side; the precedent stands.)

**Note (2026-10-11, MUT-3):** the payment-record list key followed the same
precedent: `invalidatePaymentRecordLists` lives in `useQueries.ts` beside the
keys and both `invalidateTransactionQueries` and `invalidateIncomeQueries`
call it. Before that, Mark paid (which writes a record) left the client
Payments section stale for the 60s staleTime. The income key list itself is
still duplicated.

### TD-020: Import State Loads Linked Entities One By One
**Status**: Open
**Added**: 2026-10-08
**Priority**: Low
**Impact**: `POST /v1/import/{preview,commit}` issue one `getById` per already-linked
customer/project (≤ 500 per call by the batch cap); fine for M2 volumes,
wasteful once M3 adds agreements to the same path

`src/routes/import.ts` `loadState` resolves references first (batched) and
then the entities individually. Add `customers.getByIds` / `projects.getByIds`
to the store port and use them here. Introduced by Money v1 M2.

### TD-017: Hosted API Rate Limiter Is Per Instance
**Status**: Open
**Added**: 2026-10-08
**Impact**: On Cloud Run with more than one instance, a key's budget is per
instance, so the effective limit is N × RATE_LIMIT_PER_MINUTE

`server/src/rate-limit.ts` is an in-process sliding window behind a
`RateLimiter` port. It is honest about what it is and stops a runaway client
from exhausting one instance, but a shared store (Redis/Upstash, matching
Malafat's choice) must replace it before the service scales horizontally.
Routes do not change; only `index.ts` wiring does. Introduced by Money v1 M1.

**Mitigation (2026-10-08)**: `infrastructure/terraform/variables.tf` validates
`max_instances == 1`, so a deployment cannot scale horizontally by accident.
Resolving this debt means replacing the limiter port implementation *and*
loosening that validation in the same change.

### TD-015: OAuth Refresh Tokens Have No Durable, Secure Store
**Status**: Open
**Added**: 2026-10-05
**Impact**: Connecting to a Malafat workspace does not survive an app restart

`InMemoryTokenStore` (`src/services/tokenStore.ts`) holds tokens for the
process lifetime only, so every restart forces a re-auth. That is the safe
failure and was chosen deliberately over writing a long-lived credential to
IndexedDB or a plain file. The fix is the OS keychain (Keychain / Credential
Manager / libsecret), which in Tauri 2 needs a plugin and a narrow capability.
The `TokenStore` port exists so this can be swapped without touching the flow.
Introduced by MUT-28.

### TD-016: CI Does Not Run `cargo test`
**Status**: Open
**Added**: 2026-10-05
**Impact**: 14 Rust tests had never executed once

`src-tauri` had no `[dev-dependencies]` section while
`src/sync/persistence.rs:279` had referenced `tempfile::tempdir` since it was
written. The Rust test target therefore failed to compile, and nothing noticed —
which means CI never ran `cargo test`. MUT-28 declared the dependency and all 14
pre-existing tests (pairing, persistence, crypto) now pass. The gap to close is
the CI step, not the dependency.

### TD-014: Remaining UTC Date Derivations Outside Receivables
**Status**: Open
**Added**: 2026-10-05
**Impact**: Three test failures appear only west of UTC; latent off-by-one-day bugs in non-receivable date logic

MUT-17 unified receivable date logic into `src/lib/dates.ts` (ADR-022) but
deliberately scoped out the rest. `grep -rn "toISOString().split('T')\[0\]" src`
still reports ~45 occurrences across ~26 files. Most are **correct** — instants
for HLC timestamps, sync bundles and backup filenames — but these three are
confirmed broken under `TZ=America/New_York` and pass only on a UTC+n machine:

- `src/lib/aggregations.ts` `getDaysInMonth` — `aggregations.test.ts > Date Utilities > getDaysInMonth > should return all days in March`
- `src/db/forecastCalculations.ts` — 2 failures in `forecastCalculations.test.ts > generateVirtualExpenses` (end-of-month clamping, endOfYear end mode)
- `src/features/documents/pdf` — `pdf.test.ts > Date Formatting > should format dates in DD/MM/YYYY format`

**Two private UTC-based `todayISO()` copies remain** (found during QA
reconciliation of MUT-17). Both are in domains ADR-022 scoped out, so neither
affects receivable overdue, but both are the same class of defect:

- `src/db/retainerRepository.ts:29` — feeds the `ProjectedIncome` overdue
  comparison at `:406`, keyed on `expectedDate`
- `src/services/recurringExpenseService.ts:32` — recurring-expense occurrence
  states

For the record, MUT-17 found **six** `todayISO`/`getTodayISO` definitions in
total, not the three its description listed. Four now delegate to
`todayLocalISO()`; these two do not.

**Note (2026-10-11, MUT-3):** `npm run test:tz` on `main` 0c57247 fails four
tests, all outside MUT-3 and reproduced on an untouched `main` checkout:
`aggregations.test.ts > getDaysInMonth` and `pdf.test.ts > Date Formatting`
(both listed above), plus `utils.test.ts > todayISO` and
`transactionRepo.test.ts > getDisplay > daysOverdue`. The two
`forecastCalculations` failures are gone with the MUT-14 expense strip. Same
class, user-visible: `formatDate(dateOnly)` (`src/lib/utils.ts`) parses
`YYYY-MM-DD` as UTC midnight, so every date-only value displays one day early
west of UTC — on every list, including the client profile.

**Resolution**: audit each remaining site, classify it as instant (keep
`toISOString()`) or calendar date (move to `src/lib/dates.ts`), and fix the
three confirmed failures. Verify with `npm run test:tz`.

**Effort**: Medium — mechanical, but each site needs classifying rather than
blanket-replacing.

**Resolution (2026-10-11, MUT-5):** `invalidateTransactionQueries` (`src/hooks/useQueries.ts`) is now the one exported list. It covers the income/receivables keys and `['transactionDisplay']`, and reaches every `['paymentRecords', ...]` key through `invalidatePaymentRecordLists`. `useIncomeQueries` calls it, and `invalidatePaymentRecordQueries` only delegates to it. A test counts each money key once per payment save (PATTERNS: "One invalidation list per entity family").

---


### TD-027: Onboarding Showed a Completed "Project" Step While the Projects Area Was Off
**Status**: Resolved
**Resolved**: 2026-10-11 (MUT-15)
**Original Priority**: Low

`OnboardingStepIndicator` now takes a `steps` list from `OnboardingOverlay`,
which passes `client, income` while projects is off and `client, project,
income` while on; steps are numbered by position. A fresh install sees steps
1–2 with nothing ticked. The store's order and completion rule are unchanged
(ADR-032 MUT-16 addendum), so no persisted-state migration. Tests in
`OnboardingOverlay.projects.test.tsx`.

### TD-028: By-Id Query Hooks Resolved `undefined` for Missing Rows
**Status**: Resolved
**Resolved**: 2026-10-10
**Original Priority**: Low

Every by-id hook that wrapped a repository `get(id)` / `getDefault(planId)`
(`useTransaction`, `useClient`, `useClientSummary`, `useProject`,
`useProjectSummary`, `useDocument`, `useBusinessProfile`, `useIncomeById`,
`useExpense`, both `useRecurringRule`s, `useRetainer`, `usePlan`,
`usePlanAssumption`, `usePlanScenario`, `usePlanDefaultScenario`) now resolves
`null` for a missing row and is typed `Entity | null`, as
`useDefaultBusinessProfile` already was. Repository contracts are unchanged.
The only consumer change was `!!existingDoc` in the two document forms'
`isReadOnly`. Each hook has a "missing row → `null`, no `console.error`" test
(PATTERNS.md, Query Hooks rule; CHANGELOG 2026-10-10).

### TD-018: Organizations and API Keys Are Operator-Provisioned Only
**Status**: Accepted
**Decided**: 2026-10-08 by the product owner
**Original Priority**: Medium

Keys stay operator-issued through `/admin/v1/*` and `npm run provision`; there
will be no self-serve account, organization or key-management flow. Mutaba3a
keeps no account system (ADR-023). Malafat's side records the same decision in
its ADR-150 addendum (MAL-870). Revisit only if a customer other than Malafat
needs keys without an operator.

> **Correction (2026-10-11, ADR-037).** "Mutaba3a keeps no account system" is
> no longer true: the hosted service gains
> users, memberships and sessions for the hosted portal. The *decision* this
> entry records is unchanged and extends to users — they are operator-issued
> through `/admin/v1/users*` exactly like keys, with no self-serve signup,
> invite or password reset in any environment.

### TD-019: No CI for `server/`
**Status**: Resolved
**Resolved**: 2026-10-08
**Original Priority**: High

`.github/workflows/server-ci.yml` runs on every change under `server/`:
type-check, lint, `openapi:check`, unit + route tests, the Postgres contract
suite against a `postgres:16` service container, the Docker image build
(with a `/health` probe), and `terraform validate`. CI never pushes or
deploys; deploys run from the operator's machine (`server/scripts/deploy.sh`).

### TD-002: Reports Feature Incomplete
**Status**: Resolved
**Resolved**: 2026-02-09
**Original Priority**: Medium

**Description**:
The `/reports` route existed but the Reports page was not fully implemented.

**Resolution**:
- Created full Reports page at `src/pages/reports/ReportsPage.tsx`
- Implemented 5 report presets: Summary, By Project, By Client, Expenses by Project, Unpaid Aging
- Added date range filter with presets (This Month, Last Month, This Year, All Time, Custom)
- Added currency mode selector (USD, ILS, Both)
- Implemented CSV export for all report types
- Uncommented and activated route in router.tsx

---

### TD-008: Error Boundaries Missing
**Status**: Resolved
**Resolved**: 2026-02-09
**Original Priority**: Medium

**Description**:
No React error boundaries in place. A rendering error in one component could crash the entire app.

**Resolution**:
- Created `ErrorBoundary` component for app-level error catching with retry/reload UI
- Created `InlineErrorBoundary` for drawer-level errors with minimal fallback
- Wrapped main App component in `ErrorBoundary` in main.tsx
- Wrapped all 8 drawers in `InlineErrorBoundary` in AppShell.tsx
- Added CSS styling for error fallback states

---

### TD-012: fxRateRepo.getLatest() Missing Compound Index
**Status**: Resolved
**Resolved**: 2026-02-09
**Original Priority**: Low

**Description**:
The `fxRateRepo.getLatest()` function used a compound index `[baseCurrency+quoteCurrency]` that was not defined in the database schema, causing SchemaError when called.

**Resolution**:
- Added database version 12 with compound index `[baseCurrency+quoteCurrency]` on fxRates table
- Unskipped tests in `src/db/__tests__/settingsRepo.test.ts`
- All 16 settingsRepo tests now pass

---

### TD-011: Design System Inconsistencies Between Landing and App
**Status**: Resolved
**Resolved**: 2026-02-09
**Original Priority**: High

**Description**:
The design system had accumulated inconsistencies between the landing page and the main app: duplicate token definitions (`--font-size-*` vs `--text-*`), dual button systems (`.landing-btn--*` vs `.btn-*`), focus style mismatch (`outline` vs `box-shadow`), landing page defensive fallbacks, and heading typography not using `--font-heading`.

**Resolution**:
- **Phase 1**: Added deprecation notices to all legacy CSS variables in `index.css`
- **Phase 2**: Removed dead `.landing-btn--*` classes from `LandingPage.css`, removed inline fallback values from 12 landing page CSS files
- **Phase 3**: Migrated 39 CSS files from legacy tokens to canonical tokens:
  - `--font-size-*` → `--text-*`
  - `--font-weight-*` → `--weight-*`
  - `--color-*` → direct theme tokens
  - `--shadow-sm/md/lg` → `--shadow-1/2/3`
- **Phase 4**: Standardized all `:focus-visible` styles to use `box-shadow: var(--focus-ring)` instead of `outline`; updated heading line-height to use `--leading-tight` (kept compact heading sizes for app's data-dense UI)

**Files Modified**:
- `src/index.css` (deprecation notices + token migration + focus styles + heading line-height)
- `src/pages/landing/LandingPage.css` (button removal + fallback removal + focus styles)
- `src/components/layout/ProfileSwitcher.css` (focus styles)
- `src/components/ui/Toast.css` (focus styles)
- `src/components/ui/RowActionsMenu.css` (focus styles)
- `src/features/documents/components/SplitWorkspace.css` (shadow token)
- 39+ component CSS files (token migration)

---

### TD-R001: Missing Document Immutability
**Status**: Resolved
**Resolved**: 2024-08
**Original Priority**: High

**Description**: Documents could be edited after export, breaking audit trail.

**Resolution**: Implemented `lockedAt` timestamp on first PDF export. Locked documents cannot be modified.

---

### TD-R002: No Multi-Profile Support
**Status**: Resolved
**Resolved**: 2024-09
**Original Priority**: High

**Description**: Expenses and documents not scoped to business profiles.

**Resolution**: Added `profileId` to expenses, retainers, and engagements. Business profiles fully isolated.

---

## Adding New Debt

When adding technical debt:

```markdown
### TD-XXX: [Title]
**Status**: Open
**Priority**: High | Medium | Low
**Introduced**: YYYY-MM
**Impact**: [User/developer impact]

**Description**:
[What the debt is and why it exists]

**Current State**:
[How it currently works]

**Remediation**:
1. [Step 1]
2. [Step 2]

**Effort**: Small | Medium | Large
```

When resolving debt:
1. Move to "Resolved Debt" section
2. Add resolution date and description
3. Update status to "Resolved"
