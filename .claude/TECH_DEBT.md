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

### TD-111: The per-profile export leaves out payment records, expenses, receipts and retainers
**Status**: Open
**Ticket**: MUT-145 / MUT-158 (found while fixing import)
**Added**: 2026-10-13
**Priority**: Medium
**Impact**: Settings → Export (`ExportDataModal`, v2 JSON) writes the profile, clients, projects, transactions, fx rates and retained documents only. Payment records own an entry's paid state (ADR-038/039), so after an export → import round trip a paid entry keeps `status`/`receivedAmountMinor` but has no payment history. `db.expenses`, receipts, recurring rules, retainers and categories are not exported at all. The full backup in Data tools (`backup.ts`) is unaffected and covers every table.
**Fix**: Extend the v2 export and `importProfileFile` together (remap `paymentRecords.transactionId`, `expenses.profileId/clientId/projectId`, receipts' expense links), with a round-trip test per table. CSV import's expense rows landing in `transactions` is MUT-138.

### TD-110: BusinessProfileDrawer and ImportDataPage still hard-code English labels
**Status**: Open
**Ticket**: MUT-145
**Added**: 2026-10-13
**Priority**: Low
**Impact**: MUT-145 put every string it added or changed on these screens through i18n (section titles, Default currency, the create/merge choice). The untouched labels are still literal English in an RTL-first app: "Business Name (Arabic) *", "Email", "Phone", "Logo", "Brand Color", "Set as default profile", the drawer titles, and most of ImportDataPage's step copy.
**Fix**: Move the remaining literals to `drawer.businessProfile.*` and `settings.import.*` keys in en and ar.

### TD-109: Document/invoice currency narrow-casts are dead weight once MUT-145 lands
**Status**: Resolved 2026-10-13 by MUT-145 (the document files and their casts are deleted)
**Ticket**: MUT-140 (introduced); resolved by MUT-145
**Added**: 2026-10-13
**Priority**: Low
**Impact**: MUT-140 widened the shared `Currency` type to include JOD. `DocumentDrawer.tsx`, `DocumentFormPage.tsx`, `ProfileDetailPage.tsx`, `BusinessProfileDrawer.tsx`, `RetainerDrawer.tsx`, and `PlanAssumptionDrawer.tsx` each needed `as 'USD' | 'ILS' | 'EUR'` casts at several "assign a wide Currency-typed source into a narrower form field" spots to keep compiling, since those surfaces deliberately don't support JOD. The document-related casts are pure dead weight once MUT-145 (full removal of document/invoice generation) lands — those files disappear entirely. The retainer/plan-assumption/profile-settings casts are not dead weight; they reflect a real, durable scope boundary (JOD stays out of those surfaces) and should stay even after MUT-145.
**Fix**: no action needed before MUT-145 — the casts are correct and harmless in the meantime. When MUT-145 lands, no separate cleanup ticket is needed either, since deleting the files removes the casts along with them.

### TD-107: Enabled-currencies toggle has no control for a currency outside USD/ILS
**Status**: Open
**Ticket**: MUT-139
**Added**: 2026-10-13 (MUT-139 build)
**Priority**: Low
**Impact**: Settings → Currency's "Enabled currencies" toggle (restored by MUT-139, dead code since the initial commit — never shipped live before this) only renders USD/ILS buttons. If `Settings.enabledCurrencies` ever contains a different `Currency` value (only reachable via JSON import of legacy data — no live UI path sets it today), there is no button to turn it off, and the default-currency `<select>` (which iterates `enabledCurrencies` directly) would still list it as a selectable default with no way to remove it from Settings.
**Fix**: either derive the toggle's currency list from the `Currency` union directly instead of a hardcoded `['USD', 'ILS']` array, or validate/strip unsupported currencies on import.

### TD-108: `/settings/import` doesn't use the shared TopBar/breadcrumb component
**Status**: Open
**Ticket**: none yet
**Added**: 2026-10-13 (MUT-139 build)
**Priority**: Low
**Impact**: Every other Settings sub-route (`ProfileDetailPage`) renders through the shared `TopBar` with a `Settings › ...` breadcrumb trail. `ImportDataPage.tsx` has its own hardcoded, non-i18n'd `<div className="page-header"><h1>Import Data</h1></div>` with a plain "← Back to Settings" button instead — functionally it already gets the user back to Settings, but it's a second, inconsistent wayfinding pattern plus a chunk of un-translated UI. Fixing it means replacing the page's whole custom header with `TopBar`, which is a bigger (and visually different) change than a placement fix, so it's logged rather than folded into MUT-139.
**Fix**: convert `ImportDataPage.tsx`'s header to `TopBar` with `breadcrumbs={[{ label: t('nav.settings'), href: '/settings' }, { label: t('settings.data.import') }]}`, and i18n the rest of the page's hardcoded strings while at it (same file, same gap).

### TD-105: seed-demo-account grows its transaction count on a later re-run, not a fixed snapshot
**Status**: Accepted
**Ticket**: MUT-136
**Added**: 2026-10-13 (MUT-136 build)
**Priority**: Low
**Impact**: every seeded income/expense/settle call carries a deterministic Idempotency-Key that embeds the computed date (`seed-<client>-<project>-income-<slug>-<occurredOn>`), so a same-day re-run replays cleanly, but a re-run on a *later* day computes different dates — a different key — and creates a fresh batch on top of the same customers/projects (which dedupe, since their keys don't depend on date). This is deliberate: the alternative (an absolute, fixed fixture date) would eventually make the "Recent entries" screen look stale, and there's no `GET /v1/income` list route a script could use to check "did I already seed this transaction" some other way. The seeded account's record count is only bounded by how often someone actually re-runs the script by hand.
**Fix**: none planned — screenshot tooling, plus (since 2026-10-13) the occasional manual refresh of the store-review account in prod, where a few extra recent entries are harmless. If it ever matters, the fix would be a `GET /v1/income` (or similar) list route the script could use to check existence before creating, replacing the date-keyed Idempotency-Key scheme.

### TD-106: Expenses have two sources of truth — `db.expenses` and legacy `kind:'expense'` transactions
**Status**: Open
**Ticket**: MUT-138
**Added**: 2026-10-13 (MUT-94 review)
**Priority**: Medium
**Impact**: since MUT-14, real expense creation writes `db.expenses` only. But `ImportDataModal.tsx`/`ImportDataPage.tsx` still import expenses as `kind:'expense'` transactions into `db.transactions`, and demo seed data (`src/demo/seedData/transactions.ts`) does the same. Anything imported that way never appears on `/expenses` (which reads `db.expenses` exclusively), and `TransactionsPage.tsx`'s row-click handler for such a row opens the expense drawer with the transaction's id as `expenseId`, looking up the wrong table. MUT-94 made every totals reader (`transactionRepo.getOverviewTotals(ByCurrency)`, `projectSummaryRepo`, `InsightsPage`'s monthly trend) sum both sources additively so totals stay correct either way, but that's a totals-level patch, not a fix for the underlying two-table split.
**Fix**: MUT-138 — Import should write `db.expenses` via `expenseRepo.create`, not `kind:'expense'` transactions; fix or confirm the TransactionsPage edit-routing for any pre-existing legacy rows.


### TD-104: A payment allocation or reversal that loses a deadlock answers 500
**Status**: Open
**Ticket**: MUT-130
**Added**: 2026-10-13 (MUT-100 re-review; payments code unchanged, newly reachable)
**Priority**: Low
**Impact**: since MUT-100 the outcome writes lock upfront receivables (id order) and allocations/reversals lock receivables in request order, so the two can deadlock. The outcome side already maps it to 409 (`isLockConflict` → stale); the payments side surfaces Prisma `P2010 / 40P01` as a 500. Nothing is written (rolled back) and the idempotency key is released, so a retry succeeds.
**Fix**: lock receivables in sorted id order in `applyAllocations` / `payments.reverse`, and map `isLockConflict` to a retryable 409 in the payments store methods.

### TD-100: No upper bound on money amounts — an oversized award is a 500, not a 422
**Status**: Open
**Ticket**: MUT-126
**Added**: 2026-10-13 (MUT-100 review; pre-existing for every amount)
**Priority**: Low
**Impact**: `parseMoney` accepts any digit count, so an award (or an agreement amount) beyond Postgres BIGINT passes validation and fails inside the write with a Prisma error → 500. Nothing is written; the 5xx releases the idempotency key.
**Fix**: a max-minor bound in `parseAmount` (one place for every caller), 422 `AMOUNT_INVALID`.

### TD-101: Outcome audit events are appended after the write commits
**Status**: Accepted
**Ticket**: MUT-127
**Added**: 2026-10-13 (MUT-100 review; the codebase-wide pattern, cf. TD-090)
**Priority**: Low
**Impact**: `agreement.outcome_recorded` / `outcome_corrected` (the dispute figures, CEO C2) and `receivable.credited` are written after the store transaction and the commission posting. A crash in between leaves the ledger right and those audit rows missing; a retry then meets `OUTCOME_ALREADY_RECORDED`.

### TD-102: One live commission line per agreement is not enforced by the database
**Status**: Accepted
**Ticket**: MUT-128
**Added**: 2026-10-13 (MUT-100 review)
**Priority**: Low
**Impact**: a correction replaces "the" live commission line; two would leave one uncredited. Today the agreement row lock, the version guards and the conditional void make a second impossible, but a partial unique index (`installments(agreementId) WHERE isCommission AND voidedAt IS NULL`) cannot be expressed in the Prisma 6 schema without the migration-drift tests flagging it.

### TD-103: Summaries load installments one agreement (and one project) at a time
**Status**: Open
**Ticket**: MUT-129
**Added**: 2026-10-13 (MUT-100 performance review; pre-existing, widened to CONTINGENCY)
**Priority**: Low
**Impact**: `projectSummary` awaits `listInstallments` per ACTIVE fixed-like agreement, and the customer summary calls it per project with its own proposal and agreement lists: about 3P + A sequential queries.
**Fix**: one `installment.findMany({ agreementId: { in } })` per summary, grouped in memory; load a customer's agreements and proposals once.

### TD-097: Contingency terms are sparse columns on `agreements`, and `CONTINGENCY` is a permanent enum value
**Status**: Accepted
**Added**: 2026-10-13 (MUT-100, CEO review S10)
**Priority**: Low
**Impact**: `agreements` carries seven CONTINGENCY-only nullable columns beside the RECURRING-only block; a CHECK keeps rate and treatment present on CONTINGENCY rows, nothing else enforces the outcome fields' shape. Postgres cannot drop an enum value, so `AgreementType.CONTINGENCY` stays even if the feature is withdrawn.
**Fix if ever needed**: a per-type terms table, when a fourth agreement type arrives.

### TD-098: Rolling the server back past MUT-100 breaks contingency reads and silently turns a contingency create into a FIXED one
**Status**: Accepted
**Added**: 2026-10-13 (MUT-100, CEO review S9)
**Priority**: Medium (operational)
**Impact**: once a CONTINGENCY row exists, an older revision (1) fails every read that returns it — its Prisma client has no `CONTINGENCY` enum value — so that organization's agreement lists and project/customer summaries break; (2) reads commission installments as ordinary ones; (3) strips the unknown `contingency` field from `POST /v1/agreements` and creates a FIXED agreement for the upfront alone. Unreachable until Malafat ships the option (MAL-1077).
**Mitigation**: `server/DEPLOYMENT.md` §6 rollback row: before any CONTINGENCY row exists a rollback is harmless; after, roll forward only.

### TD-099: Two ACTIVE contingency agreements on one project — the summary shows the latest only
**Status**: Accepted
**Added**: 2026-10-13 (MUT-100 plan, risk 4)
**Priority**: Low
**Impact**: nothing prevents a second contingency agreement on a project; `agreed` sums both, but `ProjectSummary.contingency` describes only the latest ACTIVE one, and the PENDING rule holds while any of them awaits an outcome. Documented, not prevented.

### TD-092: Pre-MUT-61 captured payments have no captureSource
**Status**: Accepted
**Added**: 2026-10-12 (MUT-61)
**Priority**: Low
**Impact**: Payments captured before the MUT-61 migration (MUT-65 income, MUT-66 filing, settle) are backfilled `origin: CAPTURE` but keep `captureSource: null`; the surface lived only in `income.received`/`receivable.settled` audit metadata. Malafat's list shows them as captured with no surface. These rows exist only on personal profiles (Malafat-fed profiles refused session payments until MUT-61), and MUT-65/66 are not yet deployed, so production is likely empty.
**Fix if ever needed**: a one-off script copying `metadata.captureSource` from each payment's audit row.

### TD-093: No index for an organization-wide "unallocated phone payments" list
**Status**: Accepted
**Added**: 2026-10-12 (MUT-61)
**Priority**: Low
**Impact**: `GET /v1/payments?origin=capture&allocationState=unallocated` without `customerId` scans the organization's payments (the `[organizationId, createdAt, id]` index orders, nothing narrows `origin`). MAL-1097 lists per client, which `[organizationId, customerId]` serves. Revisit with `@@index([organizationId, origin, status])` if Malafat adds a firm-wide inbox.

### TD-095: A capture refused with a 4xx replays that 4xx for the same Idempotency-Key
**Status**: Open
**Added**: 2026-10-12 (MUT-61 /review; pre-existing behaviour)
**Priority**: Medium (for MUT-68/MUT-123)
**Impact**: `idempotency.ts` stores 4xx responses: Hono's `onError` turns a thrown `ApiError` into a response before `next()` returns, so the release-on-throw path never runs. A state-dependent refusal — `CUSTOMER_NOT_LINKED` until Malafat links the client — replays for ever if the phone's outbox retries with the same key. The phone must mint a new key after any 4xx (an edit-and-resend), or the server must stop storing 4xx. Decide with MUT-68/MUT-123.

### TD-096: Captures that can never be allocated — client-only off-currency, and personal-era captures after connecting
**Status**: Accepted
**Added**: 2026-10-12 (MUT-61 /review)
**Priority**: Low
**Impact**: (1) On a Malafat-fed profile a client-only capture may be in a currency the client owes nothing in (only a named matter fixes the currency). (2) A profile that was personal and later connects Malafat keeps its MUT-65 captures as `origin: CAPTURE`, including clientless ones Malafat cannot allocate (`PAYMENT_HAS_NO_CUSTOMER`); they appear in an unfiltered `?origin=capture&allocationState=unallocated`. MAL-1097 lists per client, so neither shows there. Revisit if Malafat adds a firm-wide queue.

### TD-094: Filing an unsorted Received onto a Malafat-fed profile is still refused
**Status**: Open
**Added**: 2026-10-12 (MUT-61)
**Priority**: Low
**Impact**: `POST /v1/income` now accepts Received on a Malafat-fed profile, but `POST /v1/inbox/{id}/file-as-income` still requires `payments:write` and is refused `READ_ONLY_PROFILE` there (MUT-69's AC relies on this). The two doors now differ for Received. Deliberately out of MUT-61's scope; a follow-up would move file-as-income's Received branch onto `capture` + `incomeCaptureRulesFor` (ADR-048 decision 4 means a separate route or a split by kind).
### TD-088: The colour system needs Safari 16.2+ (oklch, color-mix) and 16.4+ (font-synthesis-weight)
**Status**: Open
**Added**: 2026-10-12 (MUT-102 review, red-team finding)
**Priority**: Low
**Impact**:
- Every brand primitive is `oklch()` (Safari 15.4+), and every derived token is a `color-mix()` (Safari/iOS 16.2+). There is no hex fallback.
- On an older WebKit, such as an un-updated macOS WKWebView behind the Tauri app, or iOS 15:
  - the derived tokens are invalid, so borders, hovers, shadows and the overlay vanish;
  - without oklch, every colour drops to its initial value.
- `font-synthesis-weight: none` needs Safari 16.4; older engines fake a bold on a 600 figure.
- No supported-browser matrix is documented.
**Remediation**: Either document a WebKit 16.2 floor (the desktop app's minimum macOS) and gate unsupported engines, or emit hex fallbacks from the JSON's `hex` values under `@supports not (color: color-mix(in oklab, red, red))`.
**Effort**: Small to document; Medium for fallbacks

### TD-087: The PWA's font cache fills only on the second online load, caches any 200, and is not checked in the built sw.js
**Status**: Open
**Added**: 2026-10-12 (MUT-102 review, performance and red-team findings)
**Priority**: Low
**Impact**:
- `registerSW.js` registers the worker on `load`. The first page's fonts are fetched before it controls the page, so they never reach the `fonts` runtime cache. Offline works only after a second online load; the Netlify `/assets` headers (`max-age=0, must-revalidate`) don't cover the gap.
- The CacheFirst rule stores any 200. After a deploy, an old CSS asking for a font hash that no longer exists gets Netlify's `index.html` fallback with a 200, and that is cached under the font URL for good.
- The PD10 contract (no `.otf` in the precache, a `fonts` runtime route) is tested on the exported `PWA_WORKBOX` only, not on the built `sw.js`.
**Remediation**:
- Match fonts by URL as well as destination, and on `navigator.serviceWorker.ready` post `CACHE_URLS` with the `.otf`/`.woff2` already loaded.
- Add a `cacheWillUpdate` plugin that keeps only `font/*` responses.
- Add an `sw.js` rule to `check-bundles`.
**Effort**: Small

### TD-086: Browser contrast checks are AA only, and axe's undecided contrast nodes are dropped
**Status**: Open
**Added**: 2026-10-12 (MUT-102 review, red-team finding)
**Priority**: Medium
**Impact**:
- `expectOnlyKnownAxeViolations` runs axe's default rules. Its `color-contrast` is AA (4.5:1); the 7:1 rule `color-contrast-enhanced` is off.
- The helper also ignores `incomplete`, where axe puts contrast it cannot decide (images, gradients, overlaps).
- The 7:1 light-text promise (ADR-058) is enforced in Node (`brand.test.ts` › `contrast` and `rendered pairs`), which cannot see:
  - a colour and a background set in different rules;
  - a translucent ground;
  - a literal on a parent.
**Remediation**: In light mode, run `color-contrast-enhanced` (or `withTags(['wcag2aaa'])`) on the acceptance surfaces, with its own known list for MUT-103 to burn down. Report `incomplete` colour-contrast nodes.
**Effort**: Small to wire; the known list depends on MUT-103

### TD-085: The pinned Serif Display files are the third-party copies; web release still needs Thmanyah's written OK
**Status**: Open
**Added**: 2026-10-12 (MUT-102 review, adversarial finding)
**Priority**: Medium (licence)
**Impact**:
- `thmanyah-serif-display-{regular,bold}.otf` are byte-identical to the Flutter copies MUT-105 says came from a third-party site; the licence allows only Thmanyah's official site.
- `src/assets/fonts/thmanyah.sha256.json` pins these bytes, so the guards (`brand.test.ts`, `check-bundles`) enforce them until they are swapped.
- Separately, nothing blocks a web release before the written OK from ask@thmanyah.com for web embedding (a MUT-102 guardrail).
**Remediation**: Download both Serif Display files from Thmanyah's official site, replace them in `src/assets/fonts`, and re-pin `thmanyah.sha256.json` once (MUT-105 does the same for Flutter). Track the written OK on the release checklist.
**Effort**: Small

### TD-084: The bundle checks never run on the paths that ship
**Status**: Open
**Added**: 2026-10-12 (MUT-102 review, adversarial finding; the origin checks had the same gap since MUT-43)
**Priority**: Medium
**Impact**:
- `scripts/check-bundles.ts` proves several things:
  - no portal code in the local builds;
  - no new origins;
  - since MUT-102, Thmanyah ships unmodified, no font is preloaded, and every CSS `url()` resolves (desktop offline; no Netlify `index.html` answer for a font).
- It runs only through `npm run test:bundles` (`make check-web`/`release-web`).
- Three ship paths skip it, and it fails unless all three dists exist, so it can't simply be appended to one of them:
  - Netlify builds with `npm run build:web` (`netlify.toml`);
  - `deploy.sh`'s `deploy_web` pushes without it;
  - Tauri's `beforeBuildCommand` is `npm run build:desktop`.
**Remediation**: Give `check-bundles` a per-dist mode (`--dist dist-web --rules local`) and run it after each ship build: in the Netlify command, in `deploy.sh`, and in Tauri's `beforeBuildCommand`.
**Effort**: Small

### TD-083: Phone-width layout: the sidebar never collapses, Income overflows, drawers are a fixed 480px
**Status**: Open
**Added**: 2026-10-12 (MUT-102; found by the 375px layout spec, and present on main `530aec2` before Brand v2)
**Priority**: Medium
**Impact**: At 375px the 240px sidebar stays open and the content beside it is clipped inside `<main>`. Income scrolls sideways: its top bar, status tabs and table are about 680px wide (714px with Brand v2's body 16). Every drawer is `--drawer-width` 480px, so it starts 105px off-screen (or ends 105px past the edge in Arabic). `qa/specs/web/brand.spec.ts` annotates the two overflows (`KNOWN_OVERFLOW`) instead of failing; it fails on any other.
**Remediation**: Collapse the sidebar to the rail or a menu below a breakpoint; let the Income table scroll inside its own container and wrap the top bar and tabs; cap drawers at `min(var(--drawer-width), 100vw)`. Remove each `KNOWN_OVERFLOW` entry as it fits. Needs a ticket (the app is desktop-first; the iPhone app is Flutter).
**Effort**: Medium

### TD-082: The portal sign-in page's language switch sits outside any landmark
**Status**: Open
**Added**: 2026-10-12 (MUT-102; the first portal axe spec)
**Priority**: Low
**Impact**: axe `region` (moderate) on `/sign-in` in both modes: `.hp-signin-top`, the EN/عربي switch above `<main>`, is in no landmark, so screen-reader landmark navigation skips it. Listed in `KNOWN_AXE_VIOLATIONS.portalSignIn`.
**Remediation**: Wrap it in a `<header>` (banner) or move it inside `<main>`; then empty the list. Fits MUT-91 (portal re-cut).
**Effort**: Small

### TD-081: Landing LCP is 628 ms slower on a slow connection with the unmodified Thmanyah files
**Status**: Resolved 2026-10-12 (MUT-102 review, D2). The preload was the whole regression.
  - Medians on `vite preview`, Fast 3G + 4× CPU, 5 cold runs: high-priority preload 4664 ms, `fetchpriority=low` 4356 ms, **no preload 3964 ms**; main is 4116 ms. CLS was 0.009 in all three.
  - The preload is dropped, and `check-bundles` flags an entry that preloads a font. Brand v2's landing now paints faster than main.
**Added**: 2026-10-12 (MUT-102, ADR-058)
**Priority**: Low
**Impact**: `vite preview` builds, landing `/`, Fast 3G + 4× CPU, 5 cold runs: median LCP 4116 ms on main, 4744 ms with Brand v2. The LCP element is the subheadline text; the preloaded Thmanyah Sans 400 `.otf` (236 KB) competes with the JS for bandwidth, where Inter's woff2 subsets were smaller. The licence forbids woff2 conversion and subsetting, so the bytes can't shrink without Thmanyah's permission.
**Remediation**: Measure without the preload on the landing page (the hero text may paint sooner in the fallback face); ask Thmanyah (ask@thmanyah.com, already owed for web embedding) whether a woff2 of the unmodified glyphs is allowed; MUT-108's immutable caching helps repeat visits only.
**Effort**: Small to measure

### TD-080: Input and card borders are below the 3:1 non-text contrast floor
**Status**: Open
**Added**: 2026-10-12 (MUT-102)
**Priority**: Low
**Impact**: `--border` / `--input-border` is the brand `line` (1.18:1 on canvas in light, 1.78:1 in dark). WCAG 1.4.11 asks 3:1 for the boundary of a control that has no other visual cue. Inputs here also differ by fill (`--input-bg` is field-bg), which softens it, but a field on a field-bg surface has no visible edge. axe does not check non-text contrast.
**Remediation**: Decide with the brand whether inputs take `--border-strong` or a darker `line` variant; add the pair to `brand.test.ts` › `contrast` at 3:1.
**Effort**: Small

### TD-079: Brand v2 leaves the legacy names and component literals for MUT-103's sweep
**Status**: Open
**Added**: 2026-10-12 (MUT-102, ADR-058)
**Priority**: Medium
**Impact**: The foundation re-points tokens; components still carry the old system:
- **Legacy size and radius names** alias the brand scale: `--text-xs/sm` → label 13, `--text-base/md/lg` → body 16, `--text-xl/2xl` → headline 20, `--text-3xl/4xl` → title 32; `--radius-xl/2xl/full` → card/hero/pill. Some label/value pairs that differed now match.
- **Layout tokens** (`--sidebar-width`, `--topbar-height`, `--drawer-width`, `--table-row-height`) are defined in both `theme.css` and `index.css` (the later wins; values identical).
- **Headings** that set `--weight-semibold` render with Serif Display's Bold file (no 600), so they look right but compute 600.
- **Amounts** outside the shared components (owed-now, `CurrencyAmounts`, the portal's `.hp-amount`, table `.amount-cell`) are not in Plex Mono: the 40-odd ad-hoc `*-amount`/`*-total` classes.
- **Colour literals** in component CSS: e.g. `.btn-danger { color: white }` on `--error` is 1.52:1 in dark (rose-ink is light there); no AC surface shows one. `CSVValidationPreview.css` still hard-codes its notice colours.
- **48 dead `var()` references** sit in `brand.test.ts`'s `KNOWN_DEAD_REFERENCES` (shrink-only). Six literal-only CSV preview pairs below 7:1 sit in `KNOWN_LITERAL_PAIRS` (shrink-only).
- **Thmanyah has no `tnum` and no ₪.** Sixteen `tabular-nums` rules on body-face text do nothing, and ₪ in body text comes from a system font. Examples:
  - the payment drawer's amount field (`PartialPaymentDrawer.css`);
  - `.record-payment-remaining`;
  - `.table`;
  - the FX readout `$1 = ₪3.06`.

  These amounts belong on `--font-mono`, which has both. A lint should fail a `tabular-nums` rule without a mono family.
- **Non-amount text inside a mono cell inherits Plex Mono.** Examples: the Clients index overdue line inside `.data-table .amount-cell`, and `.client-work-subline`. Arabic falls back to Thmanyah through the mono stack; English sets in mono. Put `--font-mono` on the amount `<bdi>` instead of the cell.
- **Heading sizes collapse.** `index.css` sets `h1`–`h4` to `--text-2xl/xl/lg/md`, which the aliases make 20/20/16/16px, and theme.css's 32px h1 never applies in the app. Map them onto the brand roles.
- **User-chosen business colours.**
  - The default `#3b82f6` with white initials is 3.68:1 in both modes.
  - The field is free text with no format check (zod `z.string()`); `profileAvatarStyle` now ignores an unreadable value.
  - Fix: pick the ink by the colour's luminance, and validate the field.
**Remediation**: MUT-103 migrates call sites to the brand role names, removes the aliases and the duplicate layout block, replaces literals with tokens, puts amounts on `--font-mono`, and empties the allowlist.
**Effort**: Large
**Update (2026-10-13)**: Dropdowns are no longer part of this debt. Every raw `<select className="select">` in the app (69 occurrences across 25 files) was migrated to the existing `Select` component (`src/components/ui/Input.tsx`), which was previously wired up only on the dev-only `/theme-demo` route and never reached production. The stale pre-brand `.select` rule in `index.css` and the dead-`var()` `.plan-select`/`.filter-select` rules in `PlanningPage.css`/`RetainersPage.css` were removed. `Select` gained an `invalid?: boolean` prop (style-only error border, no message) for call sites that render their own error text. See [[Pattern: Select Styling]] in PATTERNS.md.

### TD-068: "All businesses" leftovers from the MUT-89 pre-landing review
**Status**: Open
**Added**: 2026-10-12 (MUT-89, ADR-051; the owner chose to record these rather than fix them)
**Priority**: Low
**Impact**: None of these gives a wrong result in normal use today. Each is a corner of the new lens:
- **Cold start is a few ms slower.** `BusinessesGate` mounts the routed page only after the businesses query answers, and lazy page chunks only start loading when mounted, so the chunk download now waits behind the IndexedDB open plus the businesses read.
- **Extra renders.** `useActiveProfile` (and `useOwedLens` through it) reads the whole profile store and the route flag, so every consumer re-renders once more when navigation crosses Home/Clients.
- **Middle-click on a per-business muted row.** The row sets the working business in its click handler, not in the URL. A middle-click (or a new tab) opens `/income` in the old working business, so it shows another business's "No client" entries.
- **A failed businesses read.** If `useBusinessProfiles` errors, `BusinessesGate` lets pages through with no business, and a blank business reads every record (unassigned and archived-business records too), with no error shown.
- **All turned off from a screen that hides it.** Off Home and Clients the switcher doesn't list All; re-picking the already-checked working business still turns All off (O1's rule).
- **A drawer kept open across Back.** `IncomeDrawer` reads `isAllProfiles` on every render, so if the route changes while it is open it can fill the working business and stop asking.
- **Downgrade.** The profile store is at version 1. An older build reading it resets to the default business and drops the All choice; nothing crashes.
- **Top bar.** Under All the indicator is text only; the single-business indicator has a colour badge.
**Remediation**: in order of value:
- give Income a `profile` search param so the muted row is a plain link;
- show an error state (or hold the gate) when the businesses read fails;
- preload page chunks from the route (`lazyRouteComponent` or a `beforeLoad` preload);
- select store fields narrowly in `useOwedLens`/`useProfileFilter`;
- make re-picking the current working business a no-op for the lens;
- capture `isAllProfiles` once when the drawer opens;
- reuse the switcher's grid glyph in the top-bar indicator.
**Effort**: Small each

### TD-074: `migration-safety`'s hand-kept table list misses five live tables
**Status**: Open
**Added**: 2026-10-12 (MUT-73, found in the audit; brief decision D10)
**Priority**: Low
**Impact**: `ALL_TABLES` in `src/db/migration-safety.ts` decides what the post-migration snapshot in the `mutaba3a_backup` IndexedDB contains. It has never listed `paymentRecords`, `plans`, `planAssumptions`, `planScenarios` or `recurringOccurrences`, so those snapshots, including the one the Dexie v21 upgrade writes, hold no payment records. The user-facing JSON backup (`src/db/backup.ts`) is not affected: it reads `db.tables` and is complete. `importBackupFromFile`, the only restore path for these snapshots, has no UI caller. MUT-73 removed the eight sync names from the list and changed nothing else, to keep a deletion ticket from changing a non-sync path.
**Remediation**: Derive the list from `db.tables` (one line), or delete the snapshot machinery if the JSON backup is the only one anyone restores. Either way, add a test that the snapshot covers every table in the schema.
**Effort**: Small

### TD-075: The Malafat OAuth client has no caller
**Status**: Open
**Added**: 2026-10-12 (MUT-73, brief decision D4)
**Priority**: Low (a product decision, not a defect)
**Impact**: `src/services/oauth/` (`connectWorkspace`, `getValidAccessToken`, `disconnectWorkspace`; 570 lines plus 74 test cases) and `src-tauri/src/oauth/` (the loopback listener and its three IPC commands) are only called from tests. They were built (MUT-28) for op-log sync over Malafat OAuth, which ADR-053 took off the roadmap. MUT-73 kept them as the ticket asked and moved them out of the sync tree. Until something calls them, they cost upkeep and a 127.0.0.1 listener's worth of attack surface that never opens, and TD-015 (durable tokens) has nothing to serve.
**Remediation**: Decide whether the desktop app should ever sign in to a Malafat workspace. If yes, ticket the screen that calls `connectWorkspace` (and TD-015 with it). If no, delete both modules, the three commands, the opener plugin and its `*.malafat.app` permission, and `public/.well-known/oauth-client.json`.
**Effort**: Small either way; the decision is the work.

### TD-089: A user's own personal-profile membership can still be revoked
**Status**: Resolved 2026-10-12 (MUT-120 review, D3): `DELETE /admin/v1/users/{id}/memberships/{own personal org}` now answers 409 `PERSONAL_PROFILE`; tests that need the no-membership state revoke at the store.
**Added**: 2026-10-12 (MUT-120)
**Priority**: Low
**Impact**: MUT-120 guarantees every user is *created* with exactly one personal profile and that nobody else can be granted it, but `DELETE /admin/v1/users/{id}/memberships/{personalOrgId}` still removes the owner's own access. The organization (and its `personalOwnerUserId`) survives, so re-granting it restores access; until then `/v1/me` lists no personal profile and the phone (MUT-121) falls back to Unsorted. Operator-only, so it takes a deliberate act.
**Remediation**: Refuse revoking a user's membership of their own personal profile with `personalProfileConflict`, unless an explicit operator flag is added for account wind-down. Several existing tests revoke "every membership" to reach the no-membership state (`inbox-routes.test.ts`, `inbox-isolation.test.ts`, `routes-users.test.ts`); they would need a store-level revoke instead.
**Effort**: Small

### TD-090: Admin audit rows are appended after, not inside, the store transaction
**Status**: Accepted
**Added**: 2026-10-12 (recorded during MUT-120's eng review; the pattern predates it)
**Priority**: Low
**Impact**: Every `/admin/*` route (organizations, API keys, users, memberships) calls `store.audit.append` after the mutation commits. A failed append (database blip between the two statements) leaves a created user, personal profile or key with no `AuditEvent`. MUT-120 follows the existing pattern rather than diverging in one route.
**Remediation**: Give the stores a way to append audit rows inside the same transaction as the mutation (e.g. an `audit` field on the create inputs, or a `withAudit` unit of work), then move all admin routes over together.
**Effort**: Medium (touches every admin route and both store implementations)

### TD-091: Organization timezones are not validated at org creation, and one bad timezone halts reconcile for every organization
**Status**: Accepted
**Added**: 2026-10-12 (MUT-120 review, red team and adversarial pass)
**Priority**: Medium
**Impact**: MUT-120 validates the personal profile's timezone (`CreateUserRequest.timezone` refines with `isValidTimezone`), but `CreateOrganizationRequest.timezone` (`schemas.ts`) is still only `z.string().min(1)`, and there is no route to edit a timezone afterwards. `reconcileAll` (`scripts/reconcile.ts`) calls `todayIn(organization.timezone)` with no per-organization catch, so one invalid zone throws and every organization after it (oldest first) gets no installments or retainer charges posted on that run. Related: `migration-mut59.test.ts` replays every migration through a spawned `prisma db execute` under vitest's 5 s default and times out under a loaded full `npm run test:db` (passes alone); each new migration nudges it closer.
**Remediation**: `.refine(isValidTimezone)` on `CreateOrganizationRequest.timezone`; wrap each organization in `reconcileAll` in try/catch with a logged error line and a non-zero exit at the end; give the mut59 cases an explicit timeout (e.g. 30 s).
**Effort**: Small

### TD-077: The after-save message is the existing floating Toast, not design review's anchored strip
**Status**: Accepted
**Added**: 2026-10-12 (MUT-81, ADR-057 point 6; design review decision 5B)
**Priority**: Low
**Impact**: Brief decision A1 (epic MUT-74) says "nothing floats over content," and MUT-79 shipped it for the FX widget, theme toggle and the Mac-app bar. MUT-81's `/plan-design-review` pass found the same tension in its own message and proposed an anchored strip in flow above the list instead (`SavedFlashStrip`, decision 5B), which also has room to say *why* a row is missing (its own filter, another business, a page number) rather than only that it is. The build reused `Toast` instead: none of the ticket's five literal acceptance criteria name a presentation surface, and `Toast` already has `role="status"`, `aria-live`, and action support, so it satisfies all five.
**Remediation**: Build `SavedFlashStrip` per the design review's decisions 5B/6A/9A/4A/2A (`.claude/designs/mut-81-after-save-feedback.md`) and swap it in for the Toast call in `SavedFlashAnnouncer`. The underlying store (`savedFlashStore.ts`) needs no change; only the announcer's render branch for the unclaimed case does.
**Effort**: Medium (one new component, its styles, and the responsive/RTL cases the design review specified)

### TD-078: MUT-81's design-review refinements are unbuilt — pagination, the Owed-now tick, currency-block collapse, and a non-Home focus chain
**Status**: Accepted
**Added**: 2026-10-12 (MUT-81)
**Priority**: Low
**Impact**: `.claude/designs/mut-81-after-save-feedback.md` carries several approved decisions beyond the ticket's five literal acceptance criteria that this build did not implement:
- **Pagination** (D7/D8/11A) for `ClientWorkSection` and `IncomePage`, both still defaulting to All Time with no bound — `src/components/ui/Pagination.tsx` still has zero UI callers. This was itself a scope addition the eng review pulled into MUT-81 from an unrelated performance finding, not part of the original ticket.
- **The Owed-now count-up tick** (design 1A/3A) when a save changes the figure — `OwedNowSummary` still snaps to the new value.
- **Currency-block collapse** (design 3A, eng review D9A's `captureBlockExit`) when a save clears or opens a currency entirely.
- **A dedicated keyboard-focus chain** (design 10A) for the client profile, `/income`, and Show's cross-navigation — ADR-055 §6 already covers Home's full-payment path; the other three screens have no equivalent today, so a keyboard user's focus can fall to the page after a save there.
**Remediation**: Each is independently buildable against the landed `savedFlashStore`/`useSavedFlashRows` mechanism; none requires touching it. Pick up from the named design decisions.
**Effort**: Medium in total (pagination and the focus chain are the two with real behavioural weight; the tick and the block collapse are polish)

### TD-076: An untitled entry reads "—" on Income and "Untitled" on the client profile, and only titled rows open from the keyboard
**Status**: Open
**Added**: 2026-10-12 (MUT-62)
**Priority**: Low
**Impact**:
- **Two words for untitled.** On `/income` and the project page's Transactions tab, an untitled entry shows a dash (`EMPTY_CELL`), as MUT-62's acceptance criteria ask. The client profile's Work list (MUT-3) shows "Untitled" (`clients.profile.work.untitled`) for the same entry. The owner chose the dash for `/income` on 2026-10-12 and asked that the profile not be changed.
- **No full title on the profile.** The profile's Work list cuts long titles with CSS only. Its full text shows neither on hover nor on focus, unlike `TruncatedTitle`.
- **Untitled rows can't be opened from the keyboard.** The rows of all three tables are mouse-only (`tr onClick`). MUT-62's title button gives a titled entry a keyboard path, but an untitled row's dash is plain text, so it has none.

**Remediation**:
1. Decide one word for untitled (dash or "Untitled") and use it in all three lists.
2. Move the profile's Work list onto `TruncatedTitle`, keeping its project tag beside the title.
3. Give an untitled row a keyboard path: a `TruncatedTitle`-style button showing the dash, named by `clients.profile.work.untitled`, or a focusable row.

**Effort**: Small

### TD-064: MUT-82's leftovers around Home's in-place payment
**Status**: Open
**Added**: 2026-10-12 (MUT-82)
**Priority**: Low to Medium (item 1 is Medium: it is the sample path visitors take)
**Impact**: Held back to keep MUT-82 to H1:
1. **Undo on an entry with an uncovered received amount** (sample data, TD-063; legacy data, MUT-60) restores the record-derived state, not the seeded number. The save already drops the uncovered part, because `recalculateReceivedAmount` sums records only; deleting the record then leaves `receivedAmountMinor` at what the records cover. Fixed for free once such entries get a record (TD-063's seed fix or MUT-60's backfill).
2. **`useAttentionReceivables` has no app consumer.** Home selects its list from `useReceivables` (ADR-055). Both copies (`useQueries.ts`, `useIncomeQueries.ts`) and their tests remain, and so does `transactionRepo.getAttentionReceivables` in the repository interface (it now calls the shared selector). Not deleted here: `useQueries.ts` was MUT-73's area while this lane was open.
3. **Home's Recent payments rows** still open their client by mouse only (Needs attention's rows gained a link), and at 375 px the date and amount squeeze the client column to one letter.
4. **Toasts and assistive technology.** `ToastContainer` mounts with its first toast, so its `role="status"` region is not in the page before the message and some screen readers won't announce it. Undo has no keyboard shortcut and sits at the end of the tab order; MUT-82 only pauses the timer once focus or the pointer reaches it.
5. ~~**The bidi isolate helper is copied four times** (`PartialPaymentDrawer`, `IncomeDrawer`, `OwedNowSummary`, `HomeNeedsAttention`).~~ **Done 2026-10-13 (MUT-110):** also found copied in `RecurringAttentionList` and `RecurringMarkPaidDrawer` (6 sites total, not 4). Consolidated to two shared helpers in `lib/utils.ts`: `isolate()` (FSI, names) and the new `isolateAmount()` (LRI, amounts) -- the private copies were all FSI, which is wrong for an Arabic-formatted amount (see MUT-110, a real bug this duplication caused).
6. **Untested lines.** `exitSnapshot`'s id stripping (found in the browser after the owner paused new tests) has no unit test; the integration test drives the flow but not a drawer opened during another's exit.
7. ~~**The browser spec is not in `qa/`.**~~ **Done 2026-10-12:** recovered from checkpoint `660ba96` and ported as `web.home.attention-pay-{full,partial,reduced-motion,rtl}` (`qa/specs/web/home.spec.ts`); the axe check runs inside the full-payment flow. TEST_PLAN § MUT-82.
**Remediation**: 1 with TD-063 / MUT-60. 2: MUT-73 has landed, so delete both hooks and their tests, and `getAttentionReceivables` if nothing else reads it. 3: give Recent payments the same link cell and the container-query layout (`HomeNeedsAttention.css`). 4: keep the toast region mounted and empty; consider Cmd/Ctrl+Z for the Undo showing. 5: done. 6: add an `exitSnapshot.test.ts` case: a clone has no `[id]`. 7: done.
**Effort**: Small each

### TD-066: Income's Received / Unpaid strip ignores the page's filters
**Status**: Open
**Added**: 2026-10-12 (MUT-83, seen in the browser check)
**Priority**: Low
**Impact**: The strip above the Income list is `useOverviewTotalsByCurrency(dateFrom, dateTo, profileId)`. It follows the period, but not the status tab, the search or MUT-83's client scope. It also counts archived income (TD-030's lineage). So `/income?client=none`, opened from the Clients list's "No client" row, shows the whole business's Unpaid (₪43,388.8 in the sample) above a one-row list of ₪500, and that Unpaid differs from Owed now. This predates MUT-83, which only made the client-scoped view reachable.
**Remediation**: Either make the strip follow the list's filters (one read over the same `useIncome` filters, with Unpaid as `summarizeOwedByCurrency`), or label it as the whole period's figures. Decide with whoever next touches Income's layout.
**Effort**: Small

### TD-065: A shared client's row on Clients can show less than its profile page
**Status**: Open (accepted for now; revisit with MUT-89)
**Added**: 2026-10-12 (MUT-83, ADR-049)
**Priority**: Low
**Impact**: Since ADR-049, each business's Clients list counts only that business's entries. The client profile page (`/clients/:id`) still adds up the client's entries in every business: Owed now, Work and billing, Payments. For a client shared across businesses, a row can say $700 while the profile says $1,500. The owner accepted this trade-off for parity with Home. The row's cross-profile badges ("N entries" per other business) hint at it, but nothing on the profile says which business each figure belongs to.
**Remediation**: With MUT-89 ("All businesses" lens, business tags on rows), give the profile page the same business context: tag each entry and payment with its business, or show Owed now per business when the client has entries in more than one. Don't scope the profile to one business without an owner decision: it is the one place that shows everything a client owes.
**Update 2026-10-12 (MUT-89, ADR-051)**: the owner deferred profile-page tags (O6). With All businesses on, a shared client's row now counts every business, so it equals the profile page; the gap remains only in the single-business view.
**Effort**: Medium

### TD-069: Expenses Needs attention only looks back 90 days
**Status**: Open
**Added**: 2026-10-12 (MUT-87)
**Priority**: Medium
**Impact**: `getDueOccurrences` (`src/services/recurringExpenseService.ts`) asks for occurrences from 90 days ago to 30 days ahead. A payment missed more than 90 days ago never appears, so a rule started six months ago and never marked shows "Aug, Sep, Oct not marked" and silently drops April to July. MUT-87's one-row-per-rule now names the months, which makes the gap visible but does not cause it. The window predates MUT-87; changing it is a product decision (how far back should "not marked" reach: the rule's start, the last resolved payment, a fixed year?).
**Remediation**: Decide the window with the owner. The likely answer is "since the rule's start date, or the day after its last resolved payment", which needs no new storage: `generateExpectedDates` already clamps to the rule's start. Check the cost for a long-running rule (at most twelve rows a year per rule).
**Effort**: Small once decided

### TD-070: The shared drawer is 480 px wide on a 375 px phone
**Status**: Open
**Added**: 2026-10-12 (found while checking MUT-87 at 375 px)
**Priority**: Medium
**Impact**: `.drawer` takes `width: var(--drawer-width)` (480 px) with no `max-width`, so at phone width every drawer is wider than the screen. In LTR its start edge (the title, the checkboxes) is cut off; in RTL its end edge is. `document.scrollWidth` stays 375, so nothing scrolls to reveal it. Seen on `RecurringMarkPaidDrawer` (MUT-87), and the same for the income, expense and payment drawers. MUT-87 may not touch the shared `Drawer` (MUT-80 rewrote its internals in parallel), so it is logged here.
**Remediation**: In the shared drawer CSS, `width: min(var(--drawer-width), 100vw)` (and check MUT-80's drag offsets use the rendered width, not the variable). Verify at 375 px in English and Arabic on the income drawer and the mark-paid drawer.
**Effort**: Small

### TD-072: The portal's vendored API types have been stale since MUT-65
**Status**: Resolved 2026-10-12
**Added**: 2026-10-12 (found running MUT-66's gates)
**Priority**: Medium
**Impact**: `src/hosted/api/schema.d.ts` is generated from `server/openapi/openapi.yaml` by `npm run hosted:types`, but was not regenerated when MUT-65 landed. Regenerating it now produces ~1,040 changed lines and surfaces two real type errors the portal has been compiling past: `PaymentsList.tsx:39` and `ReceivablesList.tsx:37` pass `string | null` where `string` is required, because MUT-65 made `Payment.customerId` and `Receivable.projectId` nullable. The portal is reading those fields as if they can never be null. MUT-66 deliberately left the file alone — its design scopes it to the server, and regenerating would have dragged MUT-65's portal fixes into this ticket — so root `typecheck` still passes against the stale file.
**Resolution**: Ran `npm run hosted:types`; both call sites now guard the null id before the `Map.get` lookup (`PaymentsList.tsx` customer lookup, `ReceivablesList.tsx` matter lookup), falling back to the existing "—" rendering. `hosted:types:check` already exists (package.json, wired into the Makefile gates) and now passes against the regenerated file.
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
**Status**: Resolved 2026-10-12
**Added**: 2026-10-12 (found by the first `make check-web` run, ADR-043)
**Priority**: High — it blocks `make release web`
**Impact**: `npm run hosted:types:check` fails on `main`. MUT-65 changed `server/openapi/openapi.yaml` (commits `7382c56`, `ac3817f`, merge `8ef2df0`) without regenerating the portal's client types, which were last written at MUT-64 (`8840f1c`). The drift is 382 insertions: the new `POST /v1/receivables/{receivableId}/settle` path, the session-may-create wording on customers and projects, and — the part that matters — `Receivable.projectId` and `Payment.customerId` becoming nullable. So this is not a stale generated file to refresh and forget: running `npm run hosted:types` makes `npm run typecheck` fail with two real errors, `src/hosted/pages/views/ReceivablesList.tsx:37` and `PaymentsList.tsx:39`, both `Argument of type 'string | null' is not assignable to parameter of type 'string'`. The portal reads fields the API may now return as null. Shipped portal code has the same gap at runtime; it is only invisible because the types were never regenerated.
**Resolution**: Regenerated `schema.d.ts` via `npm run hosted:types` (1,038 insertions / 129 deletions against the current `openapi.yaml`). Fixed both views: a null `customerId`/`projectId` now renders "—" instead of being passed into `Map.get`, matching the existing missing-name fallback. `hosted:types:check`, `typecheck`, `lint`, and the hosted test suite (145 tests) all pass. `hosted:types:check` was already wired into the Makefile gates, so no CI change was needed.
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
**Status**: Open (font half resolved by MUT-102; direction half → MUT-109)
**Added**: 2026-10-11 (MUT-75)
**Priority**: Low
**Impact**: `html:lang(en), html:lang(en) body, :lang(en) { font-family: var(--font-en) }` (and the `:lang(ar)` twin, which also sets `direction`) matches *every* element, not just the root, so a `<span>` inside an `<h1>`/`<h2>` renders in Inter instead of inheriting the serif heading. Found when the landing hero's two `<span>` lines rendered sans while the `<h1>` computed Source Serif. Worked around locally with `font-family: inherit` on `.hero-headline-line`.
**Remediation**: scope the rules to `html:lang(..)` and let inheritance do the rest; then sweep for any component that relied on the per-element reset (likely none — the root rule already sets the same family). Pairs with MUT-77 (type pairing).
**Update (2026-10-12, MUT-102): font half resolved.** `theme.css` now sets the face on `<html>` only (`html:lang(..)`), so inline elements inherit; `brand.test.ts` › `tokens` forbids a `:lang()` font-family rule whose subject is not `html`, and `brand.spec.ts` checks the landing headline's inner lines compute Serif Display in EN and AR. The `.hero-headline-line { font-family: inherit }` workaround is removed. **The direction half below is open and is MUT-109** (20 `dir="ltr"` sites, five of them inputs).
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
**Status**: Resolved — moot (2026-10-12, MUT-73). The op-log was deleted with device sync, and ADR-053 took local↔hosted sync off the roadmap, so profile-selective sync will never be asked for. Kept here for history; see the Resolved Debt entry.
**Was**: Accepted (recorded by MUT-36; deliberately not built)
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
  applies `satisfies` to all 21 base repositories and all 8 synced decorators
  (the 8 decorators were deleted with device sync in MUT-73, ADR-053).
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

> **Resolved by deletion (2026-10-12, MUT-73).** The gap below no longer
> exists: device sync was retired (ADR-053), the `synced` family and its
> decorators are gone, and `getRepositories()` returns `{ base }` only, which
> `setRepositories()` swaps completely.

**Known gap — the seam is only half swappable.** *(historical, see above)*
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
**Status**: Resolved — won't do (2026-10-12, MUT-73). Device sync, live and bundle alike, was retired (ADR-053). Kept here for history; see the Resolved Debt entry.
**Was**: In Progress
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
**Status**: Resolved 2026-10-13 by MUT-145 (ImportDataModal deleted; ImportDataPage is the only importer, tested)
**Priority**: Low
**Introduced**: when the import page was added beside the modal (surfaced by MUT-12, 2026-10-10)
**Impact**: Every change to the legacy import (MUT-12 added the feature reconcile) is made twice; the two copies already differ slightly.

**Remediation**: extract `runLegacyImport(fileData)` into `src/db/` (or `src/lib/import/`) and call it from both; one test.

**Effort**: Small

---

### TD-025: Legacy `/transactions` page keeps an ungated "Generate invoice" action
**Status**: Resolved 2026-10-13 by MUT-145 (the unrouted TransactionsPage is deleted)
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
**Status**: Resolved (MUT-57, 2026-10-13)
**Priority**: Low
**Introduced**: MUT-15, 2026-10-11 (pre-existing; out of that ticket's scope)
**Decision** (Basel, 2026-10-11): both menus open the drawer **in place** (no
navigation to the list) and all four actions are profile-aware in both.
**Resolution**: `useAddMenuActions()` (`src/hooks/useAddMenuActions.ts`) is now
the one set of create handlers behind both menus. `SidebarNav`'s New menu and
`TopBar`'s Add menu each call `run(action, event, returnFocus)` and render a
`ProfileQuickPicker` for all four actions; the sidebar's `navigate(...)` calls
after opening a drawer are gone, and Client/Project creation from either menu
is now profile-aware under All businesses, same as Income/Expense already
were. Income/Expense still call `setWorkingProfile` on execute (unchanged
behaviour, now shared instead of duplicated); Client/Project never did and
still don't.

**Effort**: Small

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

### TD-067: The Clients split view has no browser-level spec, and its unit tests have not run yet
**Status**: Resolved (2026-10-12, qa port of the MUT-82/MUT-84 browser checks)
**Added**: 2026-10-12 (MUT-84, ADR-050)
**Priority**: Medium
**Impact**: MUT-84's brief asked for an e2e spec of the split view: the keyboard walk and a deep link. The owner then stopped new tests, and every gate run, in all of the epic's lanes until they merge, so it was not written. Since MUT-97 retired `e2e/`, it belongs in `qa/`. The behaviour is covered only by jsdom tests on a real memory router (`ClientsLayout.test.tsx` and the helpers' tests). Those were written test-first, and the targeted suites passed once mid-build (11 files, 178 tests), before the stop order. They have not run since the last edits: the breakpoint moved from 1200 to 1280 px, and main was merged in. jsdom can't check what only a browser shows: real focus rings, the column widths, the mirrored columns in Arabic, and axe on the split view. `qa/playwright.config.ts` runs at 1280 × 720, which is exactly `BREAKPOINTS.clientsSplit`, so the existing `@web.clients.profile` spec now opens the profile beside the list; it has not been run against it.
**Remediation**: Run the combined gate on main, then add `split-view` to `qa/features/web/clients.yaml`, with a spec in `qa/specs/web/clients.spec.ts`:
- a click opens the profile beside the list;
- ↓/↑ walk, with the URL and `aria-current` following;
- Enter and Escape (→ and ←) move focus between the panes;
- the status line names the client;
- Back after a walk returns to the full list;
- a deep link with `?sort=name&dir=asc` opens both panes, sorted;
- resizing 1280 → 375 → 1280 keeps a value typed in the profile;
- in Arabic the list sits on the right and ← moves into the profile;
- axe on the split view adds no rule.
**Effort**: Small
**Resolution**: Both halves are done. The combined check on main (`eeacd57`) ran the split view's vitest files green. The browser spec is now four `qa/` features in `qa/features/web/clients.yaml`, with their tests in `qa/specs/web/clients.spec.ts`. `split-view` covers the click, the ↓/↑ walk with URL, focus, `aria-current` and the status line following, Enter/Escape and →/← between the panes, axe on both panes (new `clientsSplit` surface, only the known `color-contrast`), and Back after the walk. `split-view-deep-link` covers the sorted deep link and a walk that keeps the sort. `split-view-resize` covers 1280 → 375 → 1280 with a typed Work search kept. `split-view-rtl` covers Arabic: the list on the right, ← in and → out. All four passed first time, and each failed against a deliberately broken build. Real focus rings and exact column widths are still checked by eye only.

### TD-003 and TD-037: device sync is retired (won't do / moot)
**Status**: Resolved (2026-10-12, MUT-73, ADR-053)
**Resolution**: TD-003 tracked activating live LAN sync and TD-037 the op-log's missing profile scope. MUT-73 deleted device sync instead: `src/sync`, `src/components/sync`, the Tauri sync server and the eight sync tables (Dexie v21). Nothing remains for either entry to fix. Their original text stays in place under Open Debt with a Resolved status, so links keep working.

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

> **Update (2026-10-12, MUT-73).** The pairing, persistence and crypto tests were
> deleted with device sync (ADR-053). `cargo test` now runs 15: the 10 OAuth
> listener tests (`src-tauri/src/oauth/callback.rs`) and 5 for the retired-sync
> file cleanup (`src-tauri/src/retired_sync.rs`), which keeps `tempfile` as the
> dev-dependency. CI still does not run them.

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
