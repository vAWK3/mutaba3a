# SYSTEM_OVERVIEW.md — Mutaba3a (متابعة)

> **Last Updated**: 2026-02-09
> **Version**: 0.0.48
> **Status**: Production (Beta)
>
> **2026-10-26 (MUT-445, ADR-203):** MTB3A is iOS, Android and the web portal. The desktop apps and the free local web app at `/app` are retired; the website (`dist-web`) is the landing, privacy and terms only. Sections below that describe the local app (Dexie, the `/app` routes, the drawers, onboarding) are history.

---

## 1. Product Vision

**Mutaba3a** (متابعة, Arabic for "follow-up") is a **privacy-first, offline-only** mini CRM and finance tracker designed for freelancers, consultants, and small service businesses operating in multi-currency environments (USD/ILS/EUR, plus JOD for income/expense entry).

### Core Philosophy
- **Privacy by Design**: the local app has zero telemetry, no cloud dependency, and data never leaves the device. Only the landing page (cookieless) and, after opt-in, the portal and the phone app send anonymous usage counts (ADR-090). The server, portal, landing and phone send content-free error reports to Sentry EU (ADR-091)
- **Offline-First**: Full functionality without internet; moving data to another device is an explicit JSON backup and restore
- **Desktop-First UX**: Feels like a tool/cockpit, not a website; drawer-first interactions
- **Multi-Currency Native**: Track income/expenses in original currencies; FX conversions explicit
- **No Sync**: Device-to-device sync (LAN, `.msync` bundles) was retired in MUT-73 (ADR-053), and local↔hosted sync is off the roadmap. A local profile and a hosted profile never exchange data

### Target Users
- Freelancers managing multiple clients and projects
- Consultants tracking billable work
- Small businesses that bill outside the app and track who owes what here (document generation retired, MUT-145)
- Users in regions with privacy concerns or unreliable internet

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Presentation Layer                             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐   │
│  │   Pages     │ │  Drawers    │ │   Modals    │ │   Components    │   │
│  │ (Routes)    │ │ (Forms)     │ │ (Alerts)    │ │   (UI Kit)      │   │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └────────┬────────┘   │
│         └────────────────┴──────────────┴─────────────────┘            │
│                                  │                                      │
├──────────────────────────────────┼──────────────────────────────────────┤
│                           State Layer                                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐     │
│  │ TanStack Query  │  │    Zustand      │  │   URL State         │     │
│  │ (Server State)  │  │  (UI State)     │  │ (Filters/Drawers)   │     │
│  └────────┬────────┘  └────────┬────────┘  └──────────┬──────────┘     │
│           └────────────────────┴─────────────────────┘                  │
│                                  │                                      │
├──────────────────────────────────┼──────────────────────────────────────┤
│                          Repository Layer                                │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Storage-Agnostic API (clientRepo, projectRepo, transactionRepo) │   │
│  │  Abstracts Dexie now, designed for SQLite swap in Tauri         │   │
│  └─────────────────────────────────┬───────────────────────────────┘   │
│                                    │                                    │
├────────────────────────────────────┼────────────────────────────────────┤
│                          Storage Layer                                   │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐     │
│  │     Dexie       │  │  JSON Backup    │  │   File System       │     │
│  │  (IndexedDB)    │  │ (export/restore)│  │  (Tauri fs plugin)  │     │
│  └─────────────────┘  └─────────────────┘  └─────────────────────┘     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

The sync layer (HLC, op-log, conflict resolver, bundles, LAN server) that sat
below this diagram was deleted in MUT-73 (ADR-053); Dexie v21 dropped its eight
tables.

The repository layer is one registry, `getRepositories()` (`src/db/provider.ts`,
23 slots including the whole-database `dataset` and the sample `demoData`).
Outside `src/db` nothing touches Dexie except `initDatabase()` at startup;
ESLint enforces it (MUT-47, ADR-071).

### Layer Responsibilities

| Layer | Responsibility | Key Technologies |
|-------|---------------|------------------|
| **Presentation** | UI rendering, user interactions | React 19, CSS Variables |
| **State** | Data fetching, caching, UI state | TanStack Query, Zustand, URL |
| **Repository** | Business logic, data access abstraction | Custom Repo pattern |
| **Storage** | Persistence, indexing | Dexie (IndexedDB) |

---

## 3. Data Model

### Core Entities

```
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│    Client    │──────<│   Project    │──────<│ Transaction  │
│              │ 1:N   │              │ 1:N   │              │
│ - name       │       │ - name       │       │ - kind       │
│ - email      │       │ - field      │       │ - status     │
│ - phone      │       │ - notes      │       │ - amount     │
│ - notes      │       │              │       │ - currency   │
└──────────────┘       └──────────────┘       │ - dueDate    │
                                              │ - paidAt     │
                                              └──────────────┘
                                                     │
                              ┌─────────────────────┬┴─────────────────────┐
                              │                     │                       │
                       ┌──────▼──────┐                             ┌───────▼──────┐
                       │  Document   │                             │   Expense    │
                       │ (retained)  │                             │              │
                       │ - type      │                             │ - vendor     │
                       │ - number    │                             │ - category   │
                       │ - items[]   │                             │ - receipt    │
                       │ - status    │                             │              │
                       └─────────────┘                             └──────────────┘
```

### Key Relationships

| Entity | Relationships | Notes |
|--------|--------------|-------|
| **Client** | Has many Projects, Transactions | Root entity for billing |
| **Project** | Belongs to Client, has many Transactions | Scopes work |
| **Transaction** | Belongs to Client, Project; links to Document | kind: income/expense, status: paid/unpaid |
| **Document** (retained) | Rows from before MUT-145; nothing renders them | Retained table only (ADR-029/066): backup + profile export/import |
| **BusinessProfile** | Has many Documents, Expenses | Multi-identity support |
| **Expense** | Belongs to BusinessProfile, has Receipts | Profile-scoped costs |

### Currency Model (Non-negotiable)
1. **Always store original amount + currency** (amountMinor in cents)
2. **Reports are per-currency by default** (separate USD/ILS/EUR totals)
3. **"All Converted" is optional** and must show FX source/date

### Receivable Logic
- **Hosted API (MUT-483, ADR-227):** `GET /v1/summaries/period?from&to&currency` (API key with `summaries:read`, or a session) gives per currency billed, credited, received (payments − reversals) and the balance at the start and end of the period: the customer statement's lines summed across clients plus clientless payments, so `change = billed − received − credited` and the closing balance meets the organization summary. The statement's line rule lives in `server/src/statements/lines.ts`, read by both. Closed months still move when something is dated into them.
- **Hosted API (MUT-444, ADR-226):** `POST /v1/agreements/{id}/correct` (with a preview) corrects a fixed or contingency agreement's terms after posting in one write: every line replaced, each billed charge credited on its own date and reposted there, payments moved to the new charges oldest first (the rest unallocated), a `CORRECTION` supplement row. Billed lines keep their count and triggers. Allocation rows a correction moves are released (`releasedAt`), never edited; every reader counts live rows. A matter's `posted` leaves out a replaced charge.
- **Hosted API (MUT-443, ADR-225):** `POST /v1/payments/{id}/correct` (with a preview) corrects a recorded payment in one write: the original reversed with a reason code (`reversalReasonCode`) and the corrected payment recorded with `replacesPaymentId`, or nothing; idempotent, token-checked, API key only, only payments the key recorded.
- **Hosted API (MUT-479, ADR-224):** a fee proposal may store a full draft agreement (FIXED with any schedule, CONTINGENCY, RETAINER); `approve/preview` and `approve` take the full body with a preview token, so a retainer or a 30/70 split is approved, not withdrawn and recreated. Retainer proposals stay out of the summary's `proposed` total.
- **Hosted API (MUT-481, ADR-223):** payments carry the legal receipt's `receiptNumber` (set on create or later with `PUT /v1/payments/{id}/receipt-number`, kept through a correction, filterable, shown on statement lines).
- **Hosted API (MUT-480, ADR-222):** `POST /v1/agreements/{id}/reduce` (with a preview) lowers a fixed fee in one write: unbilled installments first, then credits with a reason code on its open receivables; the agreement detail shows `credited` and `effectiveTotal`.
- **Hosted API (MUT-478, ADR-217):** every receivable carries a `CHG-YYYY-NNNN` number, and `GET /v1/customers/{id}/statement` is the customer's ledger card (charges, credits, payments, reversals, running balance), computed per request from the rows.
- **Receivable** = Transaction with `kind='income'` AND `status='unpaid'`
- **Overdue** = Receivable AND `dueDate < today`
- **Mark Paid / Record Payment are the same flow (ADR-038)**: both open
  `PartialPaymentDrawer` (prefilled to the full remaining balance for Mark
  Paid). `IncomeDrawer`'s fast-add-as-Received path writes a `PaymentRecord`
  too (`transactionRepo.createReceivedIncome`, MUT-60) — every Received entry
  is record-backed regardless of which flow created it. `receivedAmountMinor`,
  `status` and `paidAt` are recalculated from the records — `paidAt` is the
  *latest record's* date, defaulting to today but overridable to record a
  payment that happened earlier; `occurredAt` always stays the earned date.
  Future-dated payments are rejected. Reachable from a primary button on every
  unsettled income row (`RecordPaymentButton`) and from the row kebab's "Mark
  Paid" entry — both open the same dated drawer, never a dateless shortcut
- **Record payment leads with what's left (MUT-86 / ADR-047)**: the drawer's
  title names the balance ("Record Payment · ₪3,550 left"), one large amount
  is prefilled with it, and a live line says "Paid in full" or "₪1,775 still
  owed" as the user types (MUT-5 strict parsing, Arabic-Indic digits). Date
  reads "Today ›" and notes sit behind "+ Add note". One primary button
  records and closes, so open → Record Payment settles the entry for today
  ("Paid? Two taps."). The future-date rule is one helper,
  `isFuturePaymentDate` in `lib/dates.ts`, shared with the repository
- **Overpayment is rejected** — the sum of a transaction's payments can never
  exceed its amount (ADR-030). No entry is ever locked: document locks were
  removed with document generation (MUT-145, ADR-067)
- **Owed Now** = remaining balance of unpaid, non-deleted, non-archived income,
  per currency, overdue part split out — one helper, `summarizeOwedByCurrency`
  (ADR-033), for every screen that shows it. Home and the Clients list sum the
  same entries (those recorded in the business), so their figures are equal
  (ADR-049)
- **A client's payment history** = its `PaymentRecord`s plus one derived
  `entry` row per income whose received amount no record covers (ADR-033).
  Since MUT-60 (TD-029, resolved), every new Received create and every
  CSV-imported paid row is record-backed from the start, and a Dexie v23
  upgrade backfilled existing data — the `entry` row now exists only for
  pre-v23 data a fresh install or an already-migrated database never produces

---

## 4. Feature Map

### Implemented (v0.0.48)

- **What's new (MUT-24 / ADR-151)**: after an update the app shows the new versions' notes once, from `release-notes.json` (en + ar), until dismissed. Settings › About reopens them. A fresh install never sees them. `make release-web` refuses a version without notes, commits `release-notes.json` with the version bump, and the web tag carries them.
- **Home (MUT-8 / ADR-036)** — `/` answers how much am I owed, who is late, and what came in. Owed now is the largest figure, per currency, over every receivable in the profile. Needs attention lists overdue items and items due within 7 days, oldest first. Recent payments shows the last 10 across clients, including income saved as received. Every row opens its client. **MUT-82 (ADR-055):** each Needs attention row has an always-visible Record Payment that opens the payment drawer in place (remaining amount, today). A payment that settles the row slides it out while Owed now changes in the same render (both read one receivables query); a partial payment keeps the row with its new amount; a toast offers Undo, which deletes that payment record so the entry is recalculated exactly (one Undo at a time; it outlives the screen). The client cell is a keyboard-reachable link. A new install that skipped onboarding sees one action, Add income. The forecast strip, month actuals and guidance feed are gone, and MUT-58 deleted the money-event read side only they used (`useMoneyEventQueries`, `moneyEventRepository`, and the refresh every write path ran for it). The `moneyEventVersions` sync table stayed then (ADR-029); MUT-73 dropped it with the other sync tables in Dexie v21 (ADR-053).
- **All businesses (MUT-89 / ADR-051)** — a lens on the owed screens only, Home and Clients (routes tagged `staticData.owedLens`). With two or more businesses the switcher lists "All businesses" there.
  - **What it shows:** Owed now per currency across every live business, never summed, and a business tag on each row. Unassigned records and archived businesses stay out.
  - **It sticks:** every other screen keeps working in one concrete business, the *working business* (the last one picked), and coming back to Home shows All again. Picking a business turns it off.
  - **Creating from All asks which business:** the Income drawer and the Add menus do.
  - **State and gating:** `profileStore` (working business + `allBusinesses`, persisted) and an unsaved `useOwedScreenStore` (`onOwedScreen`, synced from the route). Home and Clients read `useOwedLens`. AppShell's `BusinessesGate` mounts pages only once the businesses have loaded, so no page ever reads with a blank business.
- **Clients index (MUT-7 / ADR-035, MUT-83 / ADR-049, MUT-84 / ADR-050)** — `/clients` answers "who owes me, and who is late".
  - **Strip:** the client count and Owed now. Owed now equals Home's for every currency.
  - **Columns:** Client · Owed Now (per currency, or Settled) · Overdue (per currency, with the oldest item's age) · Last Payment (date and amount, or Never paid) · Last Activity.
  - **One business only:** every figure counts only the active business's entries. A client created in another business is listed here when it has an entry here.
  - **All businesses (MUT-89, ADR-051):** with the lens on, the list counts every live business. Each row names the businesses its entries are in (a shared client shows each), and the muted rows come one per business, each opening Income in its own business.
  - **Muted rows:** what belongs to no listed client shows as "No client · N entries" and "Archived clients · N", always last. Each opens `/income` filtered to those unpaid entries.
  - **Order:** owed now descending by default, ranked by today's exchange rate with nothing shown converted. Click a header to sort.
  - **Clicks and search:** a row opens the profile. A search narrows the list and hides the muted rows. The search and sort are one model in the URL (`?q=&sort=&dir=`), kept on `/clients/:id` and by every client link.
  - **Split view (MUT-84):** `/clients` is a layout route (`ClientsLayout`) over the list and `/clients/:id`. From `BREAKPOINTS.clientsSplit` (1280 px) an open client sits beside the list, which narrows to a 360 px column (Client and Owed now); Arabic mirrors the columns. Narrower windows keep the full-page profile. The panes are never remounted by a resize, and the list never by a client switch. On a wide window ↑/↓ walk the clients (the profile follows; muted rows skipped; the walk replaces history, the first open pushes). Enter or → (← in Arabic) enters the profile; Escape or ← (→) returns. The open client's link is `aria-current="page"`, and a status line announces a change. The layout owns the one top bar.
- **Income (`/income`)** — the income list. Its filters (period, status tab, search, and client scope `none` / `archived`) are one model in the URL, so a link can open it filtered (MUT-83).
  - **The What column (MUT-62).** Columns: date · What · client · project · status · amount; the project is hidden on a compact table.
    - What shows each entry's title, the work record (MUT-5), under the client profile's label ("What" / "العمل"). An untitled or blank entry shows a dash.
    - The title is cut to one line. It is a button that opens the entry, and when cut, hover and keyboard focus show the full title (`TruncatedTitle`).
    - Search already matched titles in `transactionRepo.list`, so a title word finds its entry through the URL's `q`.
    - Rows are shaped once per result (`toIncomeRow`), and the columns are one stable list (`incomeColumns`).
    - The project page's Transactions tab has the same column.
    - The client profile still says "Untitled" (TD-076).
- **Adding income (MUT-5 / ADR-039)**: the income drawer is the work record.
  - **Fast path:** "What did you do?" (focused), the amount (currency prefix, LTR in Arabic, Arabic-Indic digits accepted, ambiguous input or a symbol naming another currency refused) and the client. Title, Tab, amount, Tab, client, Enter, Enter saves, even while a new client is still being created.
  - **More details:** status, due date, currency (USD/ILS/EUR/JOD — JOD accepts up to 3 decimal places, the others 2), date, project, notes and the profile. Its summary line names the defaults in use. A new entry starts in its profile's currency.
  - **Typed client:** a client name typed but not picked either matches exactly and is picked, or blocks the save with a message.
  - **Edits never rewrite payment data.** An entry with recorded payments shows status and currency read-only, and the repository enforces the same rules.
  - **Typeahead keyboard contract:** one contract serves every picker.
  - **Offline (ADR-040):** local reads and saves run whether or not the device is online; only the live FX rate waits for the network.
  - **App frame (MUT-79):** nothing floats over content. The live FX rate is a top-bar readout (`$1 = ₪3.06 ▾`) with a popover showing the rates, their source, date and Refresh. The Light/Dark/System toggle sits beside Settings in the sidebar footer. The Mac-app offer (Mac browsers only, until dismissed) and the desktop update bar sit in flow at the bottom of the main area.
- **Client profile (MUT-3 / ADR-033)** — `/clients/:id` (beside the list on a wide window, full page otherwise, MUT-84) is one page with no tabs answering the three questions: the header's **Owed now** (largest figure, per currency, overdue part called out), **Work and billing** (the client's income entries — the entry is the work record — with project as a tag, its own date/status/search filters and the row actions: Record payment, Mark paid, duplicate), and **Payments** (full history, newest first, each labelled with what it paid for; a recorded payment opens the payment drawer, money saved on the entry opens the entry). (The retainers card below Payments left with the local Retainers area, MUT-226.)
- **Drawer motion (MUT-80 / ADR-044)**: every drawer (local and portal) renders the shared `DrawerFrame`. It springs in from its edge, follows a horizontal drag with a rubber band, and dismisses on a release past half (projected momentum); a press catches it mid-motion. Closing is immediate: the exit is an inert snapshot sliding out along the same edge (mirrored in RTL; cross-fades under reduced motion). Focus is trapped while open and returns to the trigger. `motion@13.4.4` is a dependency.
- **Unassigned records (2026-10-11)**: records saved without a `profileId` show in no profile's lists. `OrphanedRecordsBanner` (AppShell) counts them with `runIntegrityCheck`; its **Review now** opens `OrphanedRecordsDrawer` in place, which lists the clients, projects, income and expenses involved and assigns them all to the default profile or one by one, each starting on its linked client's profile. "Unassigned" is defined once (`isOrphaned`, `src/db/orphanedRecords.ts`). Clients and Projects no longer open a modal by themselves. Locked income entries can't be assigned yet (TD-035).
- **Optional areas (Advanced features, MUT-12 / ADR-032)** — expenses, insights, projects and conversions are switches in Settings (invoices retired by MUT-145, ADR-067; planning and the local retainers area retired by MUT-226, ADR-082, whose Dexie v24 drops their tables and `/planning`, `/retainers` redirect home), off by default; `Settings.features` on the settings row; the Dexie v20 upgrade and every bulk data load (restore, import, demo) switch on areas that have data and show a one-time banner. Read through `useFeatureEnabled` / `readFeatureFlags`. **Gated so far (MUT-13):** `/retainers` redirected home while off (since MUT-226 it always does, like `/documents*` since MUT-145); the sidebar "More" section, client-profile invoice actions and retainers card (both gone since), and the income drawer's lock notice follow the switches. **MUT-14:** expenses are one gated ledger (`/expenses`); the seven other expense pages, `/suppliers`, forecasting, receipt matching and month close are gone (tables retained; receipts exportable from Settings › Your data). **MUT-16:** `/insights`, `/planning` (retired by MUT-226) and `/projects*` are gated; they join "More"; `+ Add → Project`, the client profile's Projects tab, the drawers' project field and the onboarding project step follow the projects switch (hidden fields keep their data). **MUT-15 (ADR-034):** the sidebar is a fixed, header-less core of Home, Clients, Income, then "More" (optional areas, only while on), with Settings pinned in the footer; a fresh install shows exactly those four. Both `+ Add` menus offer Income, Client, then Expense/Project while on (`visibleAddMenuActions`), with menu-button keyboard support (`useMenuButton`). Switching an area off while its page is open re-runs the route guards (`useLeaveDisabledArea` → `router.invalidate()`), which send the user home. **MUT-141 (ADR-068):** a 7th area, `conversions` (`/conversions`), logs money moved between currencies as a new Transaction `kind:'conversion'` (two amount/currency legs, read-only implied rate), excluded from every P&L total by construction; its data probe is empty (never auto-enabled) since the kind is new and has nothing pre-existing to detect.
- **Expenses Needs attention (MUT-87, ADR-052)** — one row per recurring rule, not one card per missed month: "Server hosting · $80 monthly · Aug, Sep, Oct not marked · $240", grouped by the pure `groupOccurrencesByRule`; the header totals each currency side by side (`CurrencyAmounts`). **Mark Paid** opens `RecurringMarkPaidDrawer`: the payments, all checked, each with its date and an editable amount; saving writes one expense per checked payment, **dated on its own expected date**, in one all-or-nothing write (`confirmPayments` inside `recurringOccurrences.runAtomically`). Skip and Snooze apply per payment in the drawer, or to all from the row's ⋯ menu (`useMenuButton`); snoozing is a view of the same drawer. The per-month confirm and snooze modals are gone; the forecast keeps a read-only card. Editing a rule now refreshes the rows (`invalidateRecurringRuleQueries`). Still looks back only 90 days (TD-069).
- **Settings in five groups (MUT-88, ADR-072)**: Businesses, General, Features, About, Your data, then Delete all data alone below every card. `.page-content` is the one scroll area.
  - **Your data** offers each action once: Back up (shows `settings.lastBackupAt`), Restore (one picker: a full backup is confirmed then replaces everything; a business export or CSV opens `/settings/import` preloaded), Export a business, Export receipts, Check data.
  - **Delete all data** needs a real backup plus a typed word.
  - **Exactly one default business** is enforced by every profile writer (`enforceSingleDefaultProfile`; real profiles outrank `demo_` ones). Dexie v22 repairs older devices.
- **Import writes real expenses (MUT-138, ADR-069)** — `/settings/import`'s CSV path now creates expense rows via `expenseRepo.create` into `db.expenses` (categories resolved against `db.expenseCategories`), so they appear on `/expenses` immediately; one `profileId` per import run is threaded through every entity it creates (clients, projects, income, expenses), auto-creating a default profile (`WelcomeModal`'s skip shape) only when none exists yet. `ProjectDetailPage`'s transactions tab routes a pre-existing legacy `kind:'expense'` transaction to a new `LegacyExpenseEditDrawer`, not `ExpenseDrawer` (wrong table), now widened to USD/ILS/EUR/JOD. `TransactionsPage.tsx` and `ImportDataModal.tsx` were confirmed dead code before this ticket touched them — `/transactions` redirected to `/income` and the modal was never rendered by any live code path — and MUT-145 (merged the same day) deleted both outright.

| Feature | Status | Notes |
|---------|--------|-------|
| Transaction Ledger | ✅ Complete | Full CRUD, filters, search |
| Client Management | ✅ Complete | Index, detail, archive |
| Project Management | ✅ Complete | Index, detail, linked transactions |
| Document Generation | 🗑️ Retired (MUT-145) | The app records what happened and issues no documents; tables retained (ADR-067) |
| Multi-Currency | ✅ Complete | USD, ILS, EUR, JOD (income/expense entry); per-currency reports |
| Expense Tracking | ✅ Complete | Profile-scoped, receipts, categories |
| Retainer Agreements (local) | 🗑️ Retired (MUT-226) | Page, drawers and matching deleted; Dexie v24 dropped `retainerAgreements`/`projectedIncome` (ADR-082). Server Money v1 retainers (`/v1/retainers*`) are a separate feature and stay |
| Financial Planning | 🗑️ Retired (MUT-226) | Page and projections deleted; Dexie v24 dropped `plans`/`planAssumptions`/`planScenarios` (ADR-082) |
| Business Profiles | ✅ Complete | Multi-identity, branding |
| Data Export/Import | ✅ Complete | ZIP backup/restore |
| Demo Mode | ✅ Complete | Sample data, time-frozen |
| i18n | ✅ Complete | English, Arabic, RTL; locale files per feature (`translations/<lang>/*.json`), en/ar parity and missing/orphaned-key checks in `test:run` (MUT-24) |
| Dark Theme | ✅ Complete | CSS variables theming |
| Brand v2 chrome (MUT-104, ADR-073) | ✅ Complete | Favicon (SVG light/dark + PNG fallbacks), apple-touch icon, theme-color that follows the in-app theme, Brand v2 PWA manifest, full-bleed desktop icons (`npm run icons:desktop`), theme-aware `BrandMark` in the sidebar and portal, Arabic 1200×630 link-preview card (web build, `MUTABA3A_PUBLIC_ORIGIN`) |
| Brand v2 (MUT-102, ADR-058) | ✅ Complete | Two-layer tokens (`--m-*` from the brand JSON → one semantic map in `theme.css`); AAA light text (7:1), dark 4.5:1, checked in Node and by axe; Thmanyah Sans / Serif Display bundled unmodified from `src/assets/fonts` in web, desktop and portal (no preload: it cost ~700 ms of LCP; runtime-cached in the PWA); Plex Mono figures; body 16, brand radii and motion tokens |
| Brand v2 app-wide sweep (MUT-103) | ✅ Complete | Every colour, px radius and px/rem font size outside `src/styles/` comes from a token, enforced by a guard (`brand.test.ts` › `literals`) with one allowlist for user-chosen colours; the 496 legacy `--text-*`/`--radius-*` aliases and the 48-name dead-reference allowlist are gone; every ad-hoc `*-amount`/`*-total` class is on Plex Mono; table rows have a 48px floor. Two items stay open under TD-079 by decision: heading weight/role reconciliation, and luminance-based ink + hex validation for a user-chosen business colour |
| Brand v2 spacing guard (MUT-165, ADR-089) | ✅ Complete | Padding, margin and gap outside `src/styles/` come from `--space-*` (or a named layout token), in CSS and TSX style objects; the guard follows one `var()` hop. One spacing scale, the union, lives in the brand JSON (`space`) and is mirrored as `--m-space-*`, drift-tested both ways |
| Desktop App | ✅ Complete | Tauri macOS/Windows |
| PWA | ✅ Complete | Offline-capable web app |
| Device sync | ❌ Retired (MUT-73, ADR-053) | LAN pairing, `.msync` bundles, op-log and its tables deleted |

### In Progress / Planned

| Feature | Status | Priority |
|---------|--------|----------|
| Reports Presets | 🔄 Routes exist | Medium |
| FX Rate Import | 🔄 Manual only | Low |
| SQLite Migration | 📋 Designed | Future |
| Firm books (epic MUT-298): roles, approval, receipts read on device, vendor bills, VAT summary, month close, accountant pack | 🚧 v1 in progress: the firm switch is built (MUT-300: operator enables in place, owner requests from the portal, `/v1/me` `firm`/`role`); the rest designed (brief `.claude/designs/firm-books.md`, ADR-099; pilot gate before v3) | High |

---

## 5. Deployment Architecture

### Release entry points (since 2026-10-12, ADR-043)

| Command | Rolls out | How |
|---------|-----------|-----|
| `make release web` | the website (landing, privacy, terms) at mtb3a.com; the free web app at /app is retired (MUT-445) | gates → version prompt → a commit holding only the version files → `git push origin main`; Netlify builds `main` |
| `make release server` | the hosted API + the portal it serves | gates → version prompt → commit + push → `server/scripts/deploy.sh` (image → `prisma migrate deploy` → `terraform apply` → smoke) |

`scripts/preflight.sh` gates the first two and refuses to release from a tree that does not describe itself — wrong branch, uncommitted changes, an unmerged branch, a parked worktree, behind `origin`, the wrong `node` major, stale `node_modules` — then checks that target's tools, credentials and config (`make doctor` runs all of it read-only). Where the server deploy points is derived from `production.tfvars` and the last `terraform init`, and verified rather than trusted; `deploy.env` overrides it.

### Build Targets

| Target | Mode | Output | What |
|--------|------|--------|------|
| Website | `vite --mode web` (the default) | `dist-web/` on Netlify | the landing, `/privacy`, `/terms`; `/app` and `/download` redirect home; `public/sw.js` removes the retired app's service worker (ADR-203) |
| Hosted portal | `vite --mode hosted` | `dist-hosted/`, served by the API | below |

The desktop builds (Tauri, `dist-desktop`) and the PWA were retired by MUT-445 (ADR-203).

### Hosting & Distribution

| Target | Host | URL/Distribution |
|--------|------|------------------|
| Web (PWA) | retired | The free web app at mutaba3a.netlify.app/app/ was retired by MUT-445 (ADR-203): `/app` redirects home and its service worker removes itself. Its history: MUT-24, MUT-187, MUT-190, MUT-291's carry-over screen (never shipped) |
| Landing | Netlify | mutaba3a.netlify.app/ — since MUT-75 (2026-10-11): "Know who owes you. Keep it to yourself." over a live HTML Clients list with one button matched to the visitor's device (MUT-76), three one-idea chapters with HTML mock-ups, privacy once, Get it (free during early access; downloads gated on the latest release, ADR-041), six-question FAQ. Since MUT-77 (2026-10-14): a slim sticky frosted header (wordmark, language switch, and the hero's button once the hero's has scrolled away; solid under reduced transparency), press feedback on every button from the motion tokens, chapter visuals that rise in once (none under reduced motion), and tab titles that follow the language. `/download` and `/privacy` wear the same header and footer, never the app's top bar (2026-10-14: `/download` had crashed rendering it outside React Query). "Open the web app" lands on a sample business's Clients list with no dialogs and one "Start with your own" line (MUT-78, ADR-042). Since MUT-186 (2026-10-14): `/hosted` makes the case for a paid hosted account (a free-vs-hosted comparison, manual migration of existing records, no price or store links) and takes a request through Netlify Forms, which emails it to Basel, who replies with an offer by hand (epic MUT-185). Since MUT-187 (2026-10-14): the free web app points at it from a dismissible sidebar card (back after 30 days; hidden when collapsed, during the sample, or on short windows) and a "Hosted account" row in Settings › Businesses, which also links hosted users to the portal's sign-in (ADR-076). Since MUT-190 (2026-10-14): the web app also suggests Malafat to law firms and accounting offices: a Settings › Businesses row with an off switch, a one-time note after a second business is added, and one Clients card at ten clients or two businesses; dismissals are permanent, links carry MUT-189's referral tags, and the Go hosted card steps aside while one shows (ADR-078). Since MUT-172 (2026-10-14): Get it ends with the paid half (hosted account + phone app come with a paid plan; "See hosted accounts" → `/hosted`), so the landing is the funnel's third door. Since MUT-173 (2026-10-14): a phone chapter after Get it ("Log it on your phone. See it all in your hosted account.", the laptop-and-phone mock, one link to `/hosted`, and each phone platform's state from `MOBILE_APP_LINKS`: store link, named with "with your hosted account", or coming soon). Since MUT-174 (2026-10-14): a dark Malafat band after it for law firms and accounting offices (Mutaba3a connects to Malafat; with a hosted account a payment logged in the phone app reaches Malafat unallocated for the firm to apply), with one link to malafat.app tagged by `malafatUrl` (MUT-189's referral vocabulary). Since MUT-202 (2026-10-14): every marketing page opens in Arabic unless the visitor chose a language; the default is not stored (ADR-077). Since MUT-209 (2026-10-15) the web app and the hosted portal do too (one `DEFAULT_LANGUAGE`), and new hosted accounts default to Arabic. Web build only (`src/pages/landing/`) |
| **Hosted API** (`server/`, since 2026-10-08) | GCP me-west1: Cloud Run service + migration job, Cloud SQL 16, Secret Manager — Terraform in `server/infrastructure/terraform/`, rolled out by `server/scripts/deploy.sh`, CI in `server-ci.yml`. Deployable; not yet deployed by an operator (runbook: `server/DEPLOYMENT.md`) | Consumed by Malafat's Money section with an organization API key. Separate package, separate database, separate deploy. Production only, `live` keys. M1 (integration, keys), M2 (customers, projects, external references, import) and M3 (effective-dated VAT, fixed-fee agreements with installments and supplements, basic retainers with monthly charges, receivables with server-computed statuses) and M4 (payments with previewed allocations and two suggestion strategies, later allocation of unallocated funds, whole-payment reversal, append-only credits against posted receivables, `PAY-YYYY-NNNN` numbering, operations lookup) implemented; M5 (retainer changes with effective-dated versions, proration, cancel preview, reconcile script), M6 (summaries with server-computed statuses, audit listing, attachments through signed URLs) M7 (fee proposals: the negotiation before an agreement; project summaries carry the current proposal) and M8 (approval creates the agreement in one transaction: `PROPOSED → APPROVED | WITHDRAWN`; the organization summary carries each customer's open proposals and their total; archive refused while a proposal is open; lazy posting heals unposted IMMEDIATE installments) implemented. MUT-37 (hosted epic MUT-34, ADR-037): operator-issued portal users and memberships with argon2id passwords, admin routes and `npm run provision:user` & co. MUT-38: browser sessions beside API keys (httpOnly `__Host-` cookie, idle + absolute expiry, lockout that cannot enumerate accounts, per-route principals from the OpenAPI `security`, `X-Mutaba3a-Profile` selection, `GET /v1/me`); the portal's 20 read routes accept sessions. MUT-39: the writability matrix is enforced three times — session scopes, `403 READ_ONLY_PROFILE { domain, writerOfRecord }` for a session on Malafat's write routes, and a store guard below the routes that classifies every repository method (provisioning refused under any guard); lazy posting in a session read runs as SYSTEM on the unguarded store. MUT-42: a hosted profile's expenses (CRUD in the original currency, receipts in the attachments bucket, per-profile categories seeded from the offline presets, a per-currency expense summary) — session-only and invisible to Malafat's key at every door (routes, store guard reads, audit listing, idempotency lookup, a separate receipts table). MUT-64 (epic MUT-63, Mutaba3a Capture): a device session — the same `'session'` principal as a portal session, carried as a bearer token (`mds_<secret>`, distinct from an API key's `mut_` prefix) instead of a cookie, for a native app that can't hold one. `POST`/`DELETE /v1/device-sessions`; one `sessions` table with `kind: 'cookie' | 'device'` so `revokeAllForUser` (password reset, disable, operator revoke-all) covers both for free; no CSRF check (no cookie); reachable on every route a cookie session is (writability/store-guard needed no changes — both are already principal-agnostic); 30-day idle / 180-day absolute lifetime. Blocks MUT-67 (app shell). MUT-65: a personal (non-Malafat) hosted profile can now write its own ledger through its own session — `customers`/`projects`/`payments` become profile-dependent writability rows (`sessionAccessFor`/`sessionScopesFor`/`mayWriteFor`), `POST /v1/customers`/`/v1/projects` accept a session, and two new session-only routes land: `POST /v1/income` (Received, optionally clientless/matter-linked; or Owed, a bare agreement-less `ADJUSTMENT` receivable requiring a customer) with `DELETE /v1/income/{id}` to undo, and `POST /v1/receivables/{id}/settle` (one payment, one allocation, no preview token). `Receivable.projectId` and `Payment.customerId` are now nullable; a Malafat-fed profile is unchanged (still read-only on all of it). MUT-66: the unsorted inbox — capture an amount before deciding which profile it belongs to. `InboxEntry` is the first **user-owned** table (no `organizationId`, no FK to an organization or membership, so an inbox outlives every membership its owner had); `GET/POST /v1/inbox` and `PATCH/DELETE /v1/inbox/{id}` send no profile header and declare no scope, like `GET /v1/me`. `POST /v1/inbox/{id}/file-as-expense` and `…/file-as-income` turn an entry into a real record on one chosen profile in a single cross-repository transaction — the entry is claimed by a delete inside the transaction, so concurrent filings produce exactly one record and a failed write rolls the delete back with it. Filing reuses MUT-42's and MUT-65's own validators unchanged, so it is refused in exactly the places a direct create is (any profile for an expense; `READ_ONLY_PROFILE` on a Malafat-fed one for income). The guard gains a `'sessionOnly'` case; no new scope or matrix domain. `GET /admin/v1/users/{id}` carries `inboxEntryCount`. Blocks MUT-68/MUT-69. MUT-120: every user is created with exactly one **personal profile** (an organization marked by unique `personalOwnerUserId`, `Personal`/`شخصي`), in the same transaction; a firm is optional; `/v1/me` marks it `isPersonalDefault`; it is never shared, keyed or bound (409 `PERSONAL_PROFILE`). MUT-61: on a Malafat-fed profile a person may record **Received** for a Malafat-linked client (matter optional) — a new session-only `capture` matrix row (`capture:write`) admits exactly `payments.capture`/`payments.undoCapture`, so `payments` stays Malafat's (Owed, settle, allocations still `READ_ONLY_PROFILE`). The payment is stored unallocated with `origin: CAPTURE` and its `captureSource`; Malafat finds it with `GET /v1/payments?customerId&origin=capture&allocationState=unallocated` (the view also carries `capturedBy`) and allocates it on the existing key routes. Undo is one conditional write that never unwinds an allocation. `GET /v1/me` publishes each profile's `income` capture rules. MUT-100: **contingency fee agreements** — a third agreement type, `CONTINGENCY`, created through `POST /v1/agreements` with `contingency { commissionRateBasisPoints, upfrontTreatment: SEPARATE | CREDITED }`: an upfront scheduled like a fixed fee (₪0 allowed) plus one commission on the award. `PATCH /v1/agreements/{id}/contingency` changes the terms before the outcome; `POST …/outcome/preview`, `…/outcome` and `…/outcome/correct` record it — AWARDED posts one commission installment dated on the outcome date with VAT at the rate in force then, NO_RECOVERY posts nothing, CREDITED subtracts the counted upfront and never refunds, a correction credits the old commission in full while it is unpaid. `ProjectSummary.contingency`; such a project stays PENDING while the outcome is awaited. MUT-107: `fee_proposals` can carry the same `contingency` terms — `POST /v1/fee-proposals` takes an optional `contingency` (the upfront in `amount`, ₪0 allowed), and approving one creates a CONTINGENCY agreement in the same transaction as any other approval; approve's `schedule` is optional, required only when the agreed amount is `> 0`; the proposal always echoes what was proposed, never an approval's terms override — the created agreement is the record of what was agreed (ADR-060). MUT-131: `POST /v1/inbox` (MUT-66's plain capture route) now requires `Idempotency-Key` too — it was the one create route with none, so a lost response could be replayed into a duplicate Unsorted entry. Partitioned by person, not organization: a new `UserIdempotencyKey` table (`userId`, `key` — `InboxEntry`'s own shape, not a polymorphic column on the organization-scoped `IdempotencyKey`) and a new `identityIdempotent()` middleware beside `idempotent()`, sharing one `resolveClaim()` state machine (ADR-061). MAL-1118: a person's own profile (MUT-120 `personalOwnerUserId`) seeds a server-only **personal** expense-category preset (Transportation … Other, en/ar) on its first category list; Malafat-fed firms keep law-firm and other firms keep general (ADR-066). API 1.19.0-mal1118. MUT-182: a signed-in person creates and manages their own **standalone** profiles — `POST /v1/profiles` (≤ 6 owned, the personal one counted), `PATCH /v1/profiles/{id}` (name, default currency, type PERSONAL | BUSINESS in one If-Match write; a type change replaces the expense categories) and a type-change preview. `Organization.ownerUserId`/`profileType`/`version`; an owned profile is never keyed, bound to Malafat or shared (`ownedProfileConflict`), the built-in personal profile is always PERSONAL; `/v1/me` publishes `owned`, `type`, `version`, `limits`. API 1.22.0-mut182. MUT-161 added `/v1/conversions` (ADR-070); MUT-194 makes them editable (`PATCH` with If-Match on `version`; a currency only with its amount, `AMOUNT_REQUIRED`) and soft-deletable (`DELETE` 204), and `GET /v1/audit` now hides conversion activity from Malafat's key like expense activity (`SESSION_ONLY_ENTITY_TYPES`). API 1.23.0-mut194 (ADR-075). MUT-223: a person re-dates their own Owed entry or captured payment on a profile they own — `PATCH /v1/income/{id}` (`occurredOn`; Owed keeps its `dueDate`) and `PATCH /v1/payments/{id}` (`receivedOn`, settle payments included, allocations untouched), If-Match on `version`; `GET /v1/audit` hides the re-dates by action (`SESSION_ONLY_ACTIONS`). API 1.26.0-mut223 (ADR-083). MUT-227: every money date has a ten-year floor in the organization's timezone (inbox capture: lenient, from UTC's yesterday), and a range `DATE_INVALID` carries `details.bound` past/future. API 1.27.0-mut227 (ADR-086). MUT-235: the operator never handles a password — `provision:user` and `rotate:password` print a one-time **setup link** (`/setup#<token>`, 72 h, stored as its session-pepper HMAC) and the person sets their own password (12–128) through `POST /v1/account-setup` (+ `…/check`), the only public routes besides sign-in; a new account has no password until then (`passwordHash` NULL), a reset keeps the current one working until the link is used, and `--lock` clears it and revokes every session at once. API 1.29.0-mut235 (ADR-088). MUT-237: a signed-in person changes a password they already know — `POST /v1/me/password` (session or device, organization-independent like `GET /v1/me`), the current password checked under the same `SignInThrottle` a wrong sign-in would trip; on success `users.changePassword` sets it, revokes every other session (web and device, the caller's own stays live) and audits `user.password_changed`; a wrong current password or a locked account answers `403 CURRENT_PASSWORD_WRONG`, never `401` (would trip the portal's session-expired handler). API 1.31.0-mut237 (ADR-037 amendment). Review fixes: a change racing another (or an operator lock) is refused under the lock with the same 403, and `currentPassword` is capped at 1024; API 1.31.1-mut237. MUT-262 (ADR-194): the caller's own session is rotated in the same transaction (new row, old one revoked `password_rotated`, same absolute deadline): a cookie session always (new Set-Cookie), a device session when it sends `rotateToken: true` (`200 { token }`, else 204 and kept); API 1.72.0-mut262. MUT-270: `GET /v1/entries` — one newest-first feed (by when logged) of a person's expenses, received payments, Owed (ADJUSTMENT) receivables and conversions across every profile they belong to, or the `profileId`s named; session-only, no profile header, never lazy-posts; one typed query per organization and kind merged by `entries/merge.ts`, new createdAt indexes; `IncomeStatus` gains partial / allocated / reversed; Terraform sets the Prisma pool and Cloud SQL `max_connections`. API 1.32.0-mut270 (ADR-093). MUT-267: **expense groups** — a named date range on one profile whose members are computed when read (in the window `startOn..endOn ?? startOn+365` and not left out, or kept), `GET/POST/PATCH/DELETE /v1/expense-groups`, keep/leave-out marks (`PUT/DELETE …/expenses/{expenseId}`), a per-currency summary with per-day buckets that sum to the total, list totals per currency, `groupId` on `GET /v1/expenses`; expenses domain, session-only, never converted (API 1.33.0-mut267, ADR-094). MUT-453: a person corrects money a person recorded — `POST /v1/payments/{id}/reverse` and `POST /v1/receivables/{id}/credits` also accept a session or device session where `payments` is read-write (CAPTURE payments and ADJUSTMENT receivables only, else 404; audited USER); the feed's `IncomeResponse` adds `reversalReason` and `credited`, and a reversed payment no longer settles its Owed in the feed; the portal's entry drawer offers Reverse payment, Reduce amount owed and Cancel. API 1.77.0-mut453 (ADR-206). MUT-464: a profile's seeded expense categories are named in the viewer's language (Accept-Language ar/en, else the account's) wherever they are listed: REST, MCP and the portal's local mode. Which preset entry a category is (`presetKey`) is worked out from its stored name in either language, never stored, and a profile can't hold the same entry twice (409 `CATEGORY_NAME_TAKEN`). API 1.78.0-mut464 (ADR-208). MUT-482: each customer row of the organization summary and each currency block of the customer summary carry `oldestOverdueDueDate` and `daysOverdue`, read through the same `dayBucketOf` rule as `overdue`, so Malafat sorts its chase list without deriving dates. API 1.82.0-mut482 (ADR-219). See ADR-024/025/026/037/038/048/059/060/061/066/075/083/088/093/094 and `.claude/designs/money-v1-*`, `hosted-portal.md`, `mut-64-device-sessions.md`, `mut-65-personal-profile-income.md`, `mut-66-unsorted-inbox.md`, `mut-120-personal-profile.md`, `mut-61-malafat-received-capture.md`, `mut-100-contingency-agreements.md`, `mut-107-contingency-fee-proposals.md` |
| **Hosted portal** (`dist-hosted/`, MUT-43 + expenses MUT-44 + conversions MUT-161 + personal income MUT-133) | MUT-45: served by the API service itself, same origin (`PORTAL_DIST_DIR`, baked into the Cloud Run image by `scripts/deploy.sh`) — `/assets/*` immutable-cached, SPA fallback to `index.html`, CSP on every response. No custom domain (ADR-037 MUT-45 amendment); code-complete, awaiting the next operator deploy | Malafat tenants' partners sign in with operator-issued email + password and read their firm's money: overview, clients, receivables, payments, documents, conversions. Signed in: hosted profiles only, nothing persisted on the device but the language and the mode hint (signed out, records live on the device: MUT-286 below). A separate build target (`vite --mode hosted`), its own TypeScript program and its own dictionaries; `npm run test:bundles` proves the local builds carry none of it. MUT-44: expenses are a portal write — a drawer shared in part with the local app (`ExpenseFormFields`) records/edits an expense with category/client/matter and attaches receipts via a signed-URL PUT, with MUT-42's error vocabulary mapped to field errors or a toast. MUT-161: conversions are the portal's second write — two amount/currency legs, no client/project linking (ADR-070); since MUT-194 a row click (or Enter on the row's `row-link` button) opens `?conversion=<id>` to edit or delete one, with JOD and per-leg decimals (ADR-075). MUT-133: on the signed-in user's own personal profile the portal adds income (Received/Owed) and records payments against open Owed entries, with a polite Saved status; Malafat-fed and other profiles stay read-only; every portal create reuses one Idempotency-Key per save attempt MUT-91: both writes show where a save landed (row tint, or "Expense/Conversion saved · Show" that anchors the list on the record via the API's `anchor` param), and every button presses in on pointer-down like the app's (ADR-074). MUT-182: income writes follow ownership — a business profile the user created gets Add income and Record payment like their personal one. MUT-183: the switcher gets "+ New profile" (disabled at the 6-profile cap, with an explanation) and "Manage profiles"; a user creates, renames, re-currencies and re-types their own owned profiles from the portal itself, with a type change confirmed against a server preview of how many expenses lose their category — no operator needed for any of it (ADR-037 amendment). MUT-224: on an owned profile an Owed entry (`?income=`) and a recorded payment (`?payment=`) open a date-only drawer (If-Match, refill on 409); Receivables shows each entry's own Date (ADR-083). MUT-236: `/setup#<token>` is where an operator-issued setup link lands — the person checks the link, sets their own password (12–128) and is signed in; the token is stripped from the address bar on arrival (ADR-088). MUT-237: the account menu's "Change password" drawer (`?changePassword=true`, `AccountDrawers` beside `ProfileDrawers`) lets a signed-in person set a new password with the current one, no operator or link needed. MUT-268: Expenses › Groups — trip groups on MUT-267's API: list, create/edit/delete drawer, a group page with per-currency headline, ≈ converted line (client-side, today's ECB rate, labelled), currency tab, per-day and category charts, members by day with optimistic Leave out/Undo, Left out, add-from-outside picker, and an "In groups" line on the expense drawer (ADR-095). MUT-286 (epic MUT-284, ADR-097/100): **signed out, the portal is the free app** — a first visit opens on this device in Arabic with no sign-in; the server's own routes (`PORTAL_ROUTES`) run in the page over a `MemoryLedgerStore` persisted to IndexedDB (lazy chunk, 112.7 KB gzip, never loaded signed in); one `GET /v1/me` on a first visit decides local or remote, then nothing is sent; records survive reloads and show across tabs; Your data downloads and restores a versioned file; sign-in offers "Continue on this device"; the client picker adds a client by name ("Add client: «name»", any owned profile, both modes). MUT-318: the matter picker adds a matter for the chosen client the same way ("Add matter: «name»", in the drawer's currency), a picked matter fills its client, and with no client chosen each matter names its client. MUT-287: signed out is the same app — Expenses (with Groups), Conversions, receipts and Documents work on this device: receipt files live in their own IndexedDB `mut-local-blobs`, the expense-group ≈ line reads `GET /v1/public/fx-rates` (the one request after the first-visit check), and Your data downloads a zip with the receipt files. MUT-291 (ADR-185): **the carry-over** — `/carry-over/receive` takes the free web app's backup (from its origin, by a popup the old app opens) or the old address's records file, replays it through a throwaway local app so every server rule checks it, shows counts, per-currency totals, what changed and what didn't come, and lands it with Restore after the person confirms; `/carry-over` on the old address offers the move before stage `redirect` sends anyone on; Your data › Restore also reads the free app's backup file. MUT-425 (ADR-187): **the You page** (`/p/:id/you`, `/you/account`, `/you/app`, and a profile-less `/you`) replaces the profile switcher and the account menu: Profiles · Account · App, every row opening today's drawer by URL key; the You island links into it (MUT-426), carrying `?from=<section>` so a switch keeps the section; a locked profile still reaches it under the locked banner. MUT-175 (ADR-189): **Reports** — `/p/:id/reports` (opened from the chrome's corner icon, MUT-426), both modes: Received, Spent and Kept (≈ at today's ECB rate, exact per currency on tap), Owed to you now, staged insights under "Lately" that unlock with complete months, a received-and-spent chart, Where it went and Who paid, Week/Month/Year with ‹ ›, and an opt-in All profiles switch; one `GET /v1/summaries/activity` per profile. MUT-447 (ADR-204): **the Reports verdict** — `GET /v1/summaries/verdict` answers, in one person-level read, every profile the person owns, co-owns or owns as a firm partner: per profile and per currency what came in, went out and was kept, the same converted to one base at today's ECB rate, the 12-month history, what is owed, and the person's usual (calendar months); locked or failed profiles are named in `unavailable`; both modes. Its screens are MUT-448 (portal) and MUT-449 (phone). MUT-448 (ADR-205): **the Reports Glance**, `/reports`, account-level and both modes, opened from the corner icon (`?back=` returns there). It shows that verdict as sent: what you kept (≈ only when converted; usual on finished months), one row per profile (a row opens that profile's own Reports for the same period), and what you're still owed, in one centred column until Explore (MUT-451). `/p/:id/reports` is now its drill-down. MUT-424 (ADR-192): **four destinations** — Owed (the overview) · Paid · Spent · Clients, with Receivables, Conversions and Documents one level in (a row at the bottom of Owed, Paid and Clients, and a back link from each) and Groups under Spent's tabs; every URL is unchanged, and `destinationOf` lights the tab MUT-260 (ADR-193): **Expenses › Receipts** — where the receipts library is on (`GET /v1/receipts/counts` answers), a third tab with the To-review count: a thumbnail gallery (To review / Filed / All), Upload receipt with no expense, and a review page with the original inline (CSP `img-src`/`frame-src` + the storage origin, `?disposition=inline`) beside the drawer's own expense form prefilled from the phone's suggestion; Approve files it and moves to the next. MUT-426 (ADR-195): **the floating shell** — no sidebar or header bar: a glass pill of the four destinations (top centre; bottom on a phone), the You island (profile name and avatar ringed in a colour hashed from the profile id; ring-only on a phone; a second press returns to the exact page) and a Reports corner icon float over the page; pages slide by depth through TanStack Router view transitions (RTL-mirrored, cross-fade under reduced motion), and the trial notice is one muted line on Owed MUT-491 (ADR-221): a new expense can carry receipts — picked in the create drawer, then uploaded by the new expense's edit drawer after Save (a failed one stays on its file with Upload again) |

The hosted API did not change the privacy model of the retired local app:
it stored nothing off-device and never called the hosted API. The
hosted API holds *law-firm* ledgers for firms that connect from Malafat, and
is subject to the encryption, residency and deletion obligations in ADR-024.

### Build Commands

```bash
# Development
npm run dev              # The website on :5173
npm run dev:web          # The same, by name
npm run dev:hosted       # Hosted portal on :5175, /v1 proxied to the API (MUTABA3A_API_ORIGIN, default :8787)

# Production
npm run build:web        # → dist-web/ (the website)
npm run build:hosted     # → dist-hosted/ (the portal; MUT-43)
npm run test:bundles     # build both, then prove they stay apart
npm run hosted:types:check  # the portal's typed client matches server/openapi
```

---

## 6. Security & Privacy Model

### Terms of service (MUT-324, ADR-102)
Hosted accounts are covered by terms of service at `/terms/<version>`. The texts are frozen and versioned, governed by the law of England & Wales, with English prevailing. A person accepts at their setup link, and again in the portal's Updated-terms step after a version bump. Each acceptance records the version, the language, the text's sha256 and the surface. Signed out, no terms apply.

**Billing (MUT-358, MUT-360, MUT-361, ADR-160/162/165/181).**
- The person pays; each hosted profile is entitled. `GET /v1/me` reports `billing: { state, source, tier, until }` on every profile. `server/src/billing/entitlement.ts` resolves it from:
  - a CONNECTED Malafat integration;
  - an operator grant;
  - the owner's (or the profile's own) Stripe subscription mirror; a subscription tied to an organization covers it only when nobody owns it or the payer does (ADR-165);
  - the 14-day trial (read-only until day 30, then locked if never paid).
- Stripe fills the mirror (MUT-360): a signed webhook (`POST /v1/billing/stripe/webhook`) re-reads each subscription an event names, and a nightly Cloud Scheduler job (`/jobs/v1/billing/stripe-reconcile`, 03:30 Israel time) re-reads them all, so a missed or out-of-order event heals by morning. A customer is linked through `mutaba3a_user_id` metadata; an operator's link always wins. Off until `stripe_enabled` is applied (DEPLOYMENT.md §6e).
- Operators grant coverage and link pilot Stripe customers with `npm run billing:*` (admin `/admin/v1/billing/*`), audited.
- Per-user feature flags (MUT-433, ADR-196): every flag is off until the operator grants it with `npm --prefix server run feature:grant|feature:revoke|feature:list` (admin `/admin/v1/users/{userId}/features/{feature}`, `/admin/v1/features/{feature}`), audited on every profile the person belongs to. `/v1/me` lists `user.features`. The first flag, `agent_access`, gates the person's own AI agent over MCP (epic MUT-432; enforcement arrives with MUT-434).
- Agents over MCP (MUT-434, ADR-197): MTB3A is its own OAuth 2.1 authorization server on the portal origin (DCR + CIMD, PKCE S256, idempotent refresh rotation, resource-bound tokens, `iss`). `/connect/approve` is the consent page; You › Account › Connect Claude shows the MCP address and Connected apps. `/mcp` (stateless) re-checks the grant, the account and `agent_access` on every call behind a fail-closed agent store guard. Off until Terraform `oauth_enabled` mounts `OAUTH_DERIVE_KEY`. MTB3A itself still sends nothing to an LLM.
- Agent read tools (MUT-435, ADR-200): with the `read` scope, `/mcp` offers `list_profiles`, `list_categories`, `list_clients`, `list_vendors`, `list_inbox` and `find_similar_expenses`, over the profiles the person owns or co-owns only (a firm they merely belong to is invisible). The agent store guard is an explicit allow-list (`AGENT_STORE_METHODS`). `server/src/expenses/similarity.ts` is the one same-purchase rule (same currency and amount, ±3 days, similar vendor first).
- Agent writes (MUT-436, ADR-201): with the `write` scope, `add_expense` (a required `destination`; profile writes run the REST compose path, inbox writes behind `MCP_INBOX_WRITES`) and `start_receipt_upload`/`complete_receipt_upload` (signed PUT through `expenses/receipts-compose.ts`). Expenses keep `captureSource` (`'mcp'` = Claude), shown in the portal drawer as "Added by Claude". Every write tool takes an idempotency key (`a:<user>` namespace, `runIdempotent`).
- One purchase, one expense (MUT-437, ADR-202): `add_expense` and `file_inbox_entry` (inbox entry → profile) check for look-alikes across the person's profiles and inbox before writing, under a per-person Postgres advisory lock, and answer `matched` with the candidates instead of writing; the agent asks, then attaches the receipt, skips, or retries with `notDuplicateOf`. Write tools need both `read` and `write`.
- Self-service (MUT-362, ADR-170): Settings › Billing on the portal's You › Account (MUT-425) shows where the person stands (trial, active, ending, unpaid, read-only, covered) and opens Stripe Checkout (`POST /v1/billing/checkout-session`) or the Customer Portal (`POST /v1/billing/portal-session`) on the person's own Stripe customer. Prices are the Stripe catalog's `freelancer_list_*` lookup keys (GA ₪49 / $16 a month, 10× a year, VAT-exclusive); `server/src/billing/billing-countries.json` says where a person may buy without a tax ID (`"*"`, every country, since MUT-418). Inert ("open soon") until the prices exist.
- Trial card prompt (MUT-418, ADR-180): a new trial's first sign-in opens Billing's `?step=welcome` ("Your 14-day free trial has started", Add a card now (recommended) / Not now), and Overview shows "N days left in your free trial · Add a card" until a card is on file (hide 3 days, not in the last 3). The answers live on the person (`users.trialPrompt`, `PATCH /v1/me/trial-prompt`). A card added in the trial keeps it: Stripe's subscription is `trialing` until the trial's end.
- Transactional mail (MUT-359, ADR-174): one `Mailer` port (`server/src/email/`) with en/ar templates, sending through Resend in production. Today it sends "your password is set / was changed" after every setup-link redeem and password change; MUT-366 adds signup and recovery links. Caps (global, with a reserve for recovery mail, and per recipient) and idempotency live in a digest-only send log; Resend's Svix-signed webhook (`POST /v1/email/resend/webhook`) suppresses hard-bouncing and complaining addresses, for our own domain only. Live in production since the 2026-10-25 self-service release (api-v0.7.1). MUT-468 (ADR-214): customer mails are drawn in frame 1b (a mood band with header art, a chip and a headline, a hidden preview line, a footer naming the recipient with a Privacy link); the art is static PNGs served by the portal at `<PORTAL_ORIGIN>/mail/v1/`; the operator digest stays plain.
- Signup and recovery (MUT-366, ADR-175): `POST /v1/account-recovery` mails a reset link (or a setup link to an account that never set a password); `POST /v1/signups` mails a SIGNUP link whose redeem creates the account, its personal profile and its 14-day trial, and is shut (404) until `SELF_SIGNUP_ENABLED`. Both give every address the same 202 on a time floor, after same-origin, per-client and per-address budgets and a server-verified Cloudflare Turnstile check. Every link ends on `/setup`; nothing here signs anyone in. Live with mail (recovery) and at GA (signup).
- Business email and the signup review queue (MUT-367, ADR-178):
  - **The screen:** every `POST /v1/signups` address is screened first (`server/src/email/domains/`). Disposable and no-mail addresses are refused (400 `EMAIL_NOT_ACCEPTED`). Webmail and relay addresses, and domains failing DNS/RDAP (MX, apex/www, registered ≥ 90 days), wait for the operator.
  - **The redeem:** a waiting signup opens as `PENDING_REVIEW` with no trial and a `signup_reviews` row. Signing in with its password answers 403 `ACCOUNT_UNDER_REVIEW`; recovery works.
  - **The operator:** `npm --prefix server run signups:review` (`/admin/v1/signup-reviews`) approves (ACTIVE, trial starts) or declines (the empty account is deleted). The operator gets an hourly-at-most digest at `OPERATOR_ALERT_EMAIL`.
- Operator accounts (MUT-459, ADR-212; epic MUT-458): the portal's operator console, server half.
  - **Who:** an account marked `users.operatorAt` by the admin token alone (`PUT/DELETE /admin/v1/users/{id}/operator`, `users.ts operator-grant|operator-revoke`); it must be ACTIVE and hold a passkey. `/v1/me` says `user.operator: true` only for them.
  - **Where:** `/v1/operator/*`, behind `authenticate()` and `operatorGate` (`server/src/auth/operator-gate.ts`): 404 to a signed-in non-operator, 401 signed out, cookie only, open under the lapse gate. Today: the signup review queue (list, approve, decline, resend), billing grants, flags and firm requests (MUT-462), and accounts (MUT-461: find by email, the account view, disable/enable, sign out everywhere, a setup link; never your own account).
  - **How:** every write needs a passkey sign-in or a passkey step-up (`/v1/operator/step-up/options` → `/step-up`, `sessions.stepUpAt`) within 10 minutes; a password never counts (`server/src/auth/step-up.ts`). Actions live in `server/src/operator/actions/`, shared with `/admin`, and record the operator as `actorId` / `operator:<id>`.
  - **Portal (MUT-460, ADR-213):** `/operator/signups`, in the shell with no profile, reached from You › Account › Operator and from the digest's "Review signups" link. Approve and Decline confirm in the row; a stale step-up makes the same tap run the passkey sheet. Sign-in on the way to `/operator` offers the passkey first.
  - **Accounts (MUT-461, ADR-215):** `/operator/accounts` finds an account by exact email; `/operator/accounts/$userId` shows its status, last sign-in, passkey, devices, agents and profiles with billing, and acts on it from the Access group (sign out everywhere, disable/enable, a reset link shown once, lock on by default).
  - **Billing, flags and firms (MUT-462, ADR-216):** the account page's Billing group grants coverage for the person's own profiles (tier, reason, expiry; drawer at `?grant=new`) and revokes it; its Features group turns each `FEATURES` flag on or off. `/operator/firms` lists pending firm requests and enables them (owners chosen for an operator firm, kept for an owned profile) or declines them. Never the operator's own account.
- The portal's self-service pages (MUT-368, ADR-179):
  - `/signup` and `/recover`: an email and a Cloudflare Turnstile check, then one "Check your email" for every address.
  - Sign-in's "Forgot your password?" and "Create an account" show only where `GET /v1/self-service` says the server mails links.
  - The landing reads the same endpoint (MUT-369, ADR-186; CORS `*` on that route only): while signup is open its CTAs say "Create an account" and open `<portal>/signup?lang=<page language>`; the portal starts in that language and takes `?lang` off the address. Closed is the pilot page with the request form.
  - `/setup` finishes a SIGNUP with a name, a currency and a time zone, and lands on the personal profile.
  - A pending signup sees "We're reviewing your account" at setup and at every sign-in until approved.
  - QA runs them on a live API in the `portal-selfservice` release-QA app.
- Lapse gate (MUT-361, ADR-181): `authenticate()` enforces each profile's state for sessions (cookie and phone): READ_ONLY takes reads only, LOCKED only `GET /v1/records-export*`; the inbox, `GET /v1/entries` and New profile follow the person's best standing (`/v1/me` `billingStanding`); identity, billing and sign-out always answer; API keys are never gated. Refusal: 402 `SUBSCRIPTION_LAPSED`. Kill switch: `BILLING_GATE=false` (Terraform `billing_gate_enabled`); `npm run billing:uncovered` lists who it holds. The portal shows GRACE/read-only banners, view-only drawers and the locked screen (Subscribe, Download my records). Nothing is deleted.
- Trial reminders (MUT-419, ADR-184): a daily Cloud Scheduler job (`POST /jobs/v1/billing/trial-mail`, 10:00 Jerusalem, only with mail, Stripe and the gate on) mails each person in days 11–30 of an unpaid trial their current stage once: "ends within N days" (Add a card), "read-only" (Subscribe, Download my records), "locks within N days". Only people whose profiles are all their own TRIAL ones; operator dry run `npm --prefix server run billing:trial-mail -- --dry-run`.
- Billing never travels with a profile's data: it isn't in the local snapshot, in a profile export, or rolled back by a restore.

### Receipts are read on our own server (MUT-441, ADR-220)

The server is the receipt reader (Basel, 2026-10-28; amends ADR-199's device-first rule). When a receipt upload completes with no suggestion, and both the deploy's kill switch (`SERVER_OCR`, Terraform `server_ocr_enabled`, off) and the uploader's per-user `receipt_reading` grant (operator console) are on, the `complete` UPDATE marks it `readStatus = PENDING` and a `ReadDispatcher` schedules a read: Cloud Tasks in production (`POST /jobs/v1/receipts/read {receiptId}`, Google OIDC only), in process locally and in release-QA. The read streams the stored original to `receipt-ocr` (`server/ocr`, Python: RapidOCR + Tesseract, decode caps, no roles, egress locked), extracts amount, date, currency, VAT, registration no., phone, email and vendor in TypeScript (`server/src/receipts/extract/**`, a field under 0.6 confidence stays empty), fills only fields the stored suggestion lacks, and ends DONE, FAILED or SKIPPED. Receipt text is never stored or logged; only the suggested fields are kept, and the person reviews them before approving. A 5-minute sweep re-asks for PENDING receipts whose lease is free and gives up after 3 attempts or 30 minutes. Receipts carry `reading: pending | done | failed | null` on the wire; the portal's review page shows "Reading the receipt…", polls every 3 s for up to 2 minutes, and fills only the fields the person hasn't changed; a gallery card says "Reading…". Clients' approve, file and `PATCH …/suggestion` fill only absent fields too (R7). QR reading is deferred (MUT-490). Local mode never reads (no server). API 1.84.0-mut441. Plan and benchmark: `.claude/designs/mut-441-server-ocr.md`, `mut-441-bench.md`.

### Taking your records with you (MUT-325, ADR-156)
Signed in, Your data › Download my records writes the chosen profiles to the same records file the signed-out portal restores (`records.json` + receipt files, labelled as an export from the account). The server streams each profile (`GET /v1/records-export`, audited `records.exported`) re-homed to the device's one person: no password, no other person's row or email, no Malafat connection or documents. It's an export, not a backup: nothing restores into an account (MUT-290, the move on sign-in, closed as won't do on 2026-10-27).

### Data Residency
- **All data stored locally** in browser IndexedDB or Tauri app storage
- **No server-side database** — user owns their data completely
- **No telemetry, analytics, or tracking** in the local app (web and desktop). The landing page counts visits without cookies; the portal and the phone app send anonymous usage counts only after opt-in. The contract is `docs/analytics/events.json` (ADR-090, MUT-152)

### No Device Sync
- **No LAN listener and no mDNS advertisement**: the desktop's sync server was deleted (MUT-73, ADR-053). The only listener left is the one-shot OAuth callback on 127.0.0.1, which nothing in the app opens yet (TD-075)
- **Paired-device tokens are removed**: every desktop launch deletes the retired `paired_devices.json` from the app config directory
- **No data transmitted** without explicit user action

### Document Immutability (retired)
- Retired with document generation (MUT-145, ADR-067, supersedes ADR-014). Stale
  `lockedAt` values on old rows are ignored; every entry is editable.

---

## 7. Onboarding Flow

### First Launch (New User)

```
1. Welcome Screen
   └─> Language selection (EN/AR)
   └─> Brief value proposition

2. Create Business Profile
   └─> Business name (required)
   └─> Email (required)
   └─> Business type (exempt/authorized/company)
   └─> Default currency (USD/ILS/EUR)
   └─> Optional: logo, tax ID, address

3. Enable Currencies
   └─> Select working currencies
   └─> Set default for new transactions

4. (Optional) Demo Mode
   └─> Try with sample data
   └─> Exit anytime, data isolated

5. Ready to Use
   └─> Overview dashboard
   └─> Guided tips (first transaction, first client)
```

### Moving to Another Device

```
Settings › Your data › Back up  →  move the JSON file  →  Settings › Your data › Restore
```

Device-to-device sync was retired in MUT-73 (ADR-053).

---

## 8. Commercialization Model

### Pricing Strategy: "Pay What You Want" + Premium Desktop

| Tier | Price | Features |
|------|-------|----------|
| **Web (PWA)** | Free | Full features, browser storage |
| **Desktop** | $0-$50 (PWYW) | Native app, file system access, auto-update |
| **Support/Consulting** | Custom | Setup assistance, custom integrations |

### Why This Model Works
1. **Privacy-first users** willing to pay for trustworthy software
2. **No recurring costs** for us (no servers to run)
3. **Desktop builds add value** (offline local database, better perf, native UX)
4. **Low barrier to entry** ensures adoption

### Distribution Channels
- **Direct**: mtb3a.com website
- **GitHub**: Releases for desktop
- **Word of mouth**: Privacy/freelance communities

### Monetization Roadmap
1. **Phase 1 (Current)**: Free, build user base
2. **Phase 2**: PWYW for desktop with suggested price
3. **Phase 3**: Premium features (custom templates, advanced reports)
4. **Phase 4**: B2B licensing for accounting firms

---

## 9. Cost Structure

### Current Monthly Costs: ~$0

| Service | Cost | Notes |
|---------|------|-------|
| Netlify | $0 | Free tier sufficient |
| GitHub | $0 | Free for public repos |
| Domain | ~$12/year | mtb3a.com (Namecheap, DNS on Cloudflare) |
| Code Signing | ~$99/year | Apple Developer (macOS) |

### Scaling Costs (at 10K+ users)
- Still $0/month for hosting (static site)
- No per-user costs (no server, no database)
- Only costs: domain + code signing + development time

---

## 10. Technology Stack Summary

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| **UI Framework** | React | 19.2.0 | Component rendering |
| **Build Tool** | Vite | 7.2.4 | Dev server, bundling |
| **Router** | TanStack Router | 1.144.0 | Type-safe routing |
| **Data Fetching** | TanStack Query | 5.90.16 | Cache, mutations |
| **Forms** | React Hook Form | 7.70.0 | Form state |
| **Validation** | Zod | 4.3.5 | Schema validation |
| **State** | Zustand | 5.0.9 | UI state |
| **Database** | Dexie | 4.2.1 | IndexedDB wrapper |
| **Desktop** | Tauri | 2.x | Native shell |
| **Testing** | Vitest | 4.0.16 | Unit/integration tests |
| **Linting** | ESLint | 9.x | Code quality |
| **Types** | TypeScript | 5.9.3 | Type safety |

---

## 11. File Structure

```
mini-crm/
├── .claude/                    # AI assistant context
│   ├── SYSTEM_OVERVIEW.md     # This file
│   ├── DECISIONS.md           # Architectural decisions
│   ├── COMPONENT_REGISTRY.md  # Reusable components
│   ├── PATTERNS.md            # Code patterns
│   ├── CHANGELOG.md           # Change history
│   └── TECH_DEBT.md           # Known issues
│
├── src/
│   ├── components/            # Reusable UI components
│   │   ├── layout/           # AppShell, SidebarNav, TopBar
│   │   ├── drawers/          # Form drawers (Transaction, Client, etc.)
│   │   ├── ui/               # Base UI kit (Button, Input, Card)
│   │   ├── filters/          # Filter controls
│   │   ├── tables/           # Data tables
│   │   └── modals/           # Dialog modals
│   │
│   ├── pages/                 # Route page components
│   │   ├── overview/         # Dashboard
│   │   ├── projects/         # Project CRUD
│   │   ├── clients/          # Client CRUD
│   │   ├── expenses/         # Expense tracking
│   │   └── settings/         # App configuration
│   │
│   ├── db/                    # Data layer
│   │   ├── database.ts       # Dexie schema
│   │   ├── retained/         # Row types for tables whose UI was removed (ADR-029)
│   │   ├── repository.ts     # Main repo exports
│   │   └── aggregations.ts   # Query helpers
│   │
│   ├── hooks/                 # React hooks
│   │   ├── useQueries.ts     # TanStack Query hooks
│   │   └── use*.ts           # Feature-specific hooks
│   │
│   ├── lib/                   # Utilities
│   │   ├── i18n/             # Translations
│   │   ├── theme/            # Theme system
│   │   ├── stores.ts         # Zustand stores
│   │   ├── dates.ts          # Date-only logic: overdue, due-soon (ADR-022)
│   │   └── utils.ts          # Formatting helpers
│   │
│   ├── types/                 # Type definitions
│   ├── demo/                  # Demo mode
│   └── router.tsx             # Route definitions
│
├── src-tauri/                 # Tauri (Rust) shell
├── public/                    # Static assets
├── dist-web/                  # Web build output
├── dist-desktop/              # Desktop build output
└── docs/                      # Documentation
```

---

## 12. Performance Characteristics

### Bundle Sizes (Production)

| Chunk | Size (gzip) | Contents |
|-------|-------------|----------|
| vendor-react | ~45KB | React, ReactDOM |
| vendor-router | ~15KB | TanStack Router |
| vendor-query | ~12KB | TanStack Query |
| vendor-forms | ~20KB | React Hook Form, Zod |
| vendor-db | ~35KB | Dexie |
| app | ~150KB | Application code |

### Runtime Metrics

| Metric | Target | Current |
|--------|--------|---------|
| First Contentful Paint | <1.5s | ~1.2s |
| Time to Interactive | <3s | ~2.5s |
| Ledger render (100 rows) | <50ms | ~30ms |

### Database Scaling

| Records | Query Time | Notes |
|---------|-----------|-------|
| 1,000 transactions | <20ms | Typical freelancer |
| 10,000 transactions | <100ms | Power user |
| 50,000 transactions | <500ms | Pagination recommended |

---

## 13. Revision History

| Date | Version | Changes |
|------|---------|---------|
| 2026-10-26 | 0.2.2 | MUT-445 (ADR-203): the desktop apps, their release pipeline and update check, and the free web app at /app retired; the website is the landing, privacy and terms |
| 2026-10-20 | 0.3.15 | MUT-327: pilot operator runbook (`docs/operations/pilot-runbook.md`), restore drill script and the one-profile export, restore and purge tool (ADR-157); drill against production pending Basel |
| 2026-10-16 | 0.1.6 | MUT-24: locale files split by feature + key check (121 orphans removed, 2 raw-key bugs fixed); What's new after an update from `release-notes.json`, with a release gate (ADR-151) |
| 2026-10-16 | 0.0.65 | MUT-237: change your own password from the account menu (`POST /v1/me/password`, API 1.31.0-mut237); other sessions revoked, this one stays signed in |
| 2026-10-16 | 0.0.65 | MUT-236: portal `/setup` page for setup links (check, set password, sign in; token stripped from the URL); ships with MUT-235 in one server release |
| 2026-02-09 | 0.0.48 | Initial SYSTEM_OVERVIEW created |
| 2026-10-11 | 0.0.65 | MUT-43: hosted portal build target (sign-in, session states, six read views), bundle-separation check, i18n core split |
| 2026-10-11 | 0.0.65 | MUT-44: hosted expense capture (shared form, drawer, pickers, receipts) — the portal's only write, closing epic MUT-34's build work |
| 2026-10-11 | 0.0.65 | MUT-45: the API serves the hosted portal from its own origin (static assets, SPA fallback, CSP incl. the GCS upload host), `deploy.sh` and CI build it into the image; no custom domain — epic MUT-34's build work now reachable in a browser |
| 2026-10-12 | 0.0.65 | MUT-83: the Clients list's Owed now equals Home's; per-business rows; No client / Archived clients rows; `/income` filters in the URL (ADR-049) |
| 2026-10-12 | 0.0.65 | MUT-62: `/income` and the project Transactions tab show each entry's title (What), cut to one line with the full title on hover and focus (`TruncatedTitle`); untitled shows a dash |
| 2026-10-12 | 0.0.65 | MUT-84: Clients split view on wide windows (layout route, `BREAKPOINTS.clientsSplit`, keyboard walk, list search/sort in the URL) (ADR-050) |
| 2026-10-12 | 0.0.65 | MUT-82: Record Payment from Home's Needs attention with Undo; row slide-out (`rowExit`); toast groups and pause; drawer `onRecorded`; exit snapshots drop ids (ADR-055) |
| 2026-10-12 | 0.0.65 | MUT-81: after-save feedback — a saved row tints if visible, a toast names where it went if not, with Show; one shared `savedFlashStore`/`useSavedFlashRows` claim mechanism across five lists; shared `isolate()` (FSI) replaces two private bidi copies (ADR-057) |
| 2026-10-14 | 0.1.4 | MUT-91: the portal picks up press feedback (app-wide, CSS `scale`), the shared spring drawer (already MUT-80) and after-save feedback for expenses and conversions; API `anchor` on the two list endpoints (1.21.0-mut91); saved-flash backstop waits for fetching lists; RTL tint rail fixed (ADR-074, ADR-057 §8) |
| 2026-10-14 | 0.1.4 | MUT-182: self-service standalone hosted profiles — `/v1/profiles` create/rename/currency/type (cap 6), owned-profile standalone guarantee, type-keyed expense presets, portal income gate on `owned` (API 1.22.0-mut182) |
| 2026-10-13 | 0.0.65 | MUT-141: currency conversion logging — new `kind:'conversion'` Transaction, excluded from P&L totals, on a new dedicated `/conversions` page gated by a 7th feature flag (ADR-068) |
| 2026-10-13 | 0.1.1 | MUT-138: CSV import writes expense rows into `db.expenses` via `expenseRepo` instead of `db.transactions`, with `profileId` threaded through every entity one import run creates; `ProjectDetailPage` routes a legacy `kind:'expense'` row to a new `LegacyExpenseEditDrawer` instead of the wrong-table `ExpenseDrawer`; `TransactionsPage.tsx`/`ImportDataModal.tsx` confirmed dead code before MUT-145 deleted them the same day (ADR-069) |
| 2026-10-14 | 1.23.0-mut194 (API) | MUT-194: conversions are edited (PATCH, If-Match) and soft-deleted (DELETE) on the server and in the portal; Malafat's audit feed hides conversion activity; JOD in the portal's conversion form; keyboard-reachable clickable rows in `HostedTable` (ADR-075, supersedes ADR-070 §2) |
| 2026-10-15 | 1.25.0-mut191 (API) | MUT-191: Malafat suggestions in the hosted portal — account-menu link + switch, one Clients card, a note on a new business profile; stored per user on the server (`User.malafatSuggestions`, `PATCH /v1/me/malafat-suggestions`, unioned dismissals, no audit); nothing for Malafat customers or on personal profiles and firms (ADR-078 amended) |
| 2026-10-15 | 1.26.0-mut223 (API) | MUT-223: change the date of a saved Owed entry or captured payment (`PATCH /v1/income/{id}`, `PATCH /v1/payments/{id}`), date only, owned profiles only, If-Match; `IncomeResponse.version`; Malafat's audit feed hides re-dates (ADR-083) |
| 2026-10-15 | 1.27.0-mut227 (API) | MUT-227: every hosted money date is refused more than ten years before the organization's today, on create and edit; `DATE_INVALID` carries `details.bound`; the portal and the phone say "more than ten years ago" (ADR-086) |
| 2026-10-18 | 1.35.0-mut280 (API) | MUT-280: AED, SAR, QAR (2 dp) and BHD, OMR (3 dp) on every money endpoint; `USD_PEGS` replaces the JOD constant, every pair priced through USD, `derived` = either side pegged; `currencies` on Me and the device session; `docs/fx/pegs.json`; analytics contract 1.2.0. Portal types follow in MUT-281, released together (ADR-098, TD-170) |
| 2026-10-22 | 1.47.0-mut388 (API) | MUT-388: ILS, USD, EUR and JOD only; the Gulf five go from `SUPPORTED_CURRENCIES`, `USD_PEGS` and `docs/fx/pegs.json`; `parseMoney` refuses a currency with no exponent (422 `AMOUNT_INVALID`); analytics contract 2.0.0; `scripts/currency-rows.sh` release gate (ADR-166) |
| 2026-10-16 | 1.28.0-mut228 (API) | MUT-228: `GET /v1/fx-rates?base=` serves ECB reference rates (via Frankfurter) for every supported currency, JOD from the USD peg; sessions and device sessions only, display only; cached per instance with a 7-day age cap, no redirects, https-only provider, filled at startup; new error code `FX_RATES_UNAVAILABLE` (503); config `FX_RATES_URL`, `FX_RATES_TTL_MINUTES`, `FX_RATES_TIMEOUT_MS` (ADR-087) |
| 2026-10-15 | 1.24.0-mut209 (API) | MUT-209: a user created without `locale` is Arabic (`CreateUserRequest.locale` defaults to `ar`), so its personal profile is شخصي and the portal adopts Arabic after sign-in; existing accounts unchanged |
| 2026-10-13 | 1.20.0-mut161 (API) | MUT-161: hosted `/v1/conversions` (create + read only), the server-side counterpart to MUT-141 that unblocks MUT-159 (mobile); new `Conversion` Prisma model (own table, not a kind column), new hosted-only `/conversions` page/drawer, session+device-session only (ADR-070) |
| 2026-10-14 | (portal, no API change) | MUT-183: the portal creates and manages its own owned profiles — ProfileSwitcher gains "+ New profile"/"Manage profiles", a URL-driven drawer tree (create / manage list / edit pane), attempt-scoped Idempotency-Key, and an inline type-change confirm against the server's uncategorized-expense preview; the no-profile empty state no longer says "ask your operator" (ADR-037 amendment, qa-reconcile fixed a page-filter-rewrite bug that could silently close a shell drawer) |

## MUT-373 — Co-owners (2026-10-21, ADR-163)

- **Model**: a co-owner is an OWNER `Membership` on an owned BUSINESS profile; the creator stays `ownerUserId`. Up to 3 owners. One rule, `ownsProfile` (`server/src/personal-profile.ts`), gates every owner write; `SessionAuth.membershipRole` carries the role from `selectProfile`.
- **Paths**: the operator adds (`grant:user --role owner`, `memberships.grantOwner`); a co-owner leaves or the creator removes (`DELETE /v1/profiles/{id}/owners/{userId}`, `memberships.removeOwner`); the creator can't leave (TD-194). `/v1/me` and the profile responses carry `owners` and `firmRequestedBy` (API 1.43.0-mut373).
- **Guards**: a shared profile stays BUSINESS (`CO_OWNED`); firm enable keeps every OWNER; `npm run pre-roll` stops a deploy on a stray membership; `purge-user` refuses a creator with co-owners. Billing still follows the creator (TD-193).
- **Portal**: Owners section in the edit pane, shared cue in the switcher and list, cap hint, lost-access banner, leave → personal profile. Hidden in local mode (one person).

## MUT-333 — Close my account (2026-10-24, ADR-188, web half)

- **Close**: You › Account's last row opens the Close my account drawer (`?closeAccount=true`) → `POST /v1/me/closure {password}`: Stripe subscriptions end at the period end (past-due ones now, open checkouts expired), other sessions revoked, an `account-closing` mail (en/ar) names the deletion day. The closure lives on the user row (`deleteAfter` = +30 days).
- **Grace**: a closing session reaches only `GET /v1/me`, `DELETE /v1/me/closure` (Keep my account) and sign-out; anything else is 403 `ACCOUNT_CLOSING`. The portal's AuthGate shows the closing page. Past the deadline the account no longer signs in.
- **Hard delete**: Cloud Scheduler hourly → `POST /jobs/v1/accounts/purge` (operator: `npm run accounts:purge [-- --dry-run]`): claim → delete the Stripe customers → one transaction (own profiles deleted; a shared one passes to a co-owner; records elsewhere anonymized; audit scrubbed to a tombstone; the person's own rows deleted) → empty the deleted profiles' bucket prefixes (`storage_purges` queue). At most 25 a run.
- **Phone**: not built yet (MUT-371/364 phase); the contract is §7 of `.claude/designs/mut-333-close-account.md`.

## MUT-115 — Passkeys (2026-10-25, ADR-190, web half)

- **Sign in:** /sign-in offers "Sign in with a passkey" and passkeys in the email field's autofill, where passkeys work on the host (RP ID `mtb3a.com`). `POST /v1/passkey-challenges` → the platform sheet → `POST /v1/sessions/passkey` (portal cookie) or `/v1/device-sessions/passkey` (phone token). Same throttle, lockout and 401 as the password.
- **Manage:** You › Account › Passkeys: add (a sign-in under 10 minutes old, else the password), rename, remove (signs out the sessions it opened). At most 10. A password change keeps passkeys.
- **Infra:** `WEBAUTHN_RP_ID` from stage live; the apex proxies the portal's AASA for iOS `webcredentials`.
- **Phone:** not built yet (the run's phone phase): it ports Malafat's `WebAuthnService` on the `passkeys` package against the same routes.
- **Suggestion (MUT-370, ADR-191):** after a sign-in, Home shows "Add a passkey: the more secure way to sign in" while `/v1/me` `user.passkeyPrompt.due` (no passkey, fewer than 3 Not nows, not hidden 30 days; stored on `users.passkeyPrompt`, `PATCH /v1/me/passkey-prompt`). It waits for the trial's first-run step. The phone half reads the same field.
