# SYSTEM_OVERVIEW.md — Mutaba3a (متابعة)

> **Last Updated**: 2026-02-09
> **Version**: 0.0.48
> **Status**: Production (Beta)

---

## 1. Product Vision

**Mutaba3a** (متابعة, Arabic for "follow-up") is a **privacy-first, offline-only** mini CRM and finance tracker designed for freelancers, consultants, and small service businesses operating in multi-currency environments (primarily USD/ILS/EUR).

### Core Philosophy
- **Privacy by Design**: Zero telemetry, no cloud dependency, data never leaves the device
- **Offline-First**: Full functionality without internet; moving data to another device is an explicit JSON backup and restore
- **Desktop-First UX**: Feels like a tool/cockpit, not a website; drawer-first interactions
- **Multi-Currency Native**: Track income/expenses in original currencies; FX conversions explicit
- **No Sync**: Device-to-device sync (LAN, `.msync` bundles) was retired in MUT-73 (ADR-053), and local↔hosted sync is off the roadmap. A local profile and a hosted profile never exchange data

### Target Users
- Freelancers managing multiple clients and projects
- Consultants tracking retainers and billable work
- Small businesses needing invoice/receipt generation
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
                       ┌──────▼──────┐       ┌──────▼──────┐       ┌───────▼──────┐
                       │  Document   │       │  Retainer   │       │   Expense    │
                       │             │       │  Agreement  │       │              │
                       │ - type      │       │             │       │ - vendor     │
                       │ - number    │       │ - cadence   │       │ - category   │
                       │ - items[]   │       │ - amount    │       │ - receipt    │
                       │ - status    │       │ - status    │       │              │
                       └─────────────┘       └─────────────┘       └──────────────┘
```

### Key Relationships

| Entity | Relationships | Notes |
|--------|--------------|-------|
| **Client** | Has many Projects, Transactions | Root entity for billing |
| **Project** | Belongs to Client, has many Transactions | Scopes work |
| **Transaction** | Belongs to Client, Project; links to Document | kind: income/expense, status: paid/unpaid |
| **Document** | Belongs to BusinessProfile, Client; links to Transactions | Invoices, receipts, credit notes |
| **BusinessProfile** | Has many Documents, Expenses, Retainers | Multi-identity support |
| **RetainerAgreement** | Belongs to Client, Project | Generates ProjectedIncome |
| **Expense** | Belongs to BusinessProfile, has Receipts | Profile-scoped costs |

### Currency Model (Non-negotiable)
1. **Always store original amount + currency** (amountMinor in cents)
2. **Reports are per-currency by default** (separate USD/ILS/EUR totals)
3. **"All Converted" is optional** and must show FX source/date

### Receivable Logic
- **Receivable** = Transaction with `kind='income'` AND `status='unpaid'`
- **Overdue** = Receivable AND `dueDate < today`
- **Mark Paid / Record Payment are the same flow (ADR-038)**: both open
  `PartialPaymentDrawer` (prefilled to the full remaining balance for Mark
  Paid), the only place that writes a `PaymentRecord`. `receivedAmountMinor`,
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
  exceed its amount (ADR-030). Payments on a locked (invoiced) transaction are
  allowed: the lock protects the invoice facts, not payment tracking
- **Owed Now** = remaining balance of unpaid, non-deleted, non-archived income,
  per currency, overdue part split out — one helper, `summarizeOwedByCurrency`
  (ADR-033), for every screen that shows it. Home and the Clients list sum the
  same entries (those recorded in the business), so their figures are equal
  (ADR-049)
- **A client's payment history** = its `PaymentRecord`s plus one derived
  `entry` row per income whose received amount no record covers (income saved
  as Received writes none; ADR-033, TD-029)

---

## 4. Feature Map

### Implemented (v0.0.48)

- **Home (MUT-8 / ADR-036)** — `/` answers how much am I owed, who is late, and what came in. Owed now is the largest figure, per currency, over every receivable in the profile. Needs attention lists overdue items and items due within 7 days, oldest first. Recent payments shows the last 10 across clients, including income saved as received. Every row opens its client. A new install that skipped onboarding sees one action, Add income. The forecast strip, month actuals and guidance feed are gone, and MUT-58 deleted the money-event read side only they used (`useMoneyEventQueries`, `moneyEventRepository`, and the refresh every write path ran for it). The `moneyEventVersions` sync table stayed then (ADR-029); MUT-73 dropped it with the other sync tables in Dexie v21 (ADR-053).
- **Clients index (MUT-7 / ADR-035, MUT-83 / ADR-049, MUT-84 / ADR-050)** — `/clients` answers "who owes me, and who is late".
  - **Strip:** the client count and Owed now. Owed now equals Home's for every currency.
  - **Columns:** Client · Owed Now (per currency, or Settled) · Overdue (per currency, with the oldest item's age) · Last Payment (date and amount, or Never paid) · Last Activity.
  - **One business only:** every figure counts only the active business's entries. A client created in another business is listed here when it has an entry here.
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
  - **More details:** status, due date, currency (USD/ILS/EUR), date, project, notes and the profile. Its summary line names the defaults in use. A new entry starts in its profile's currency.
  - **Typed client:** a client name typed but not picked either matches exactly and is picked, or blocks the save with a message.
  - **Edits never rewrite payment data.** An entry with recorded payments shows status and currency read-only, and the repository enforces the same rules.
  - **Typeahead keyboard contract:** one contract serves every picker.
  - **Offline (ADR-040):** local reads and saves run whether or not the device is online; only the live FX rate waits for the network.
  - **App frame (MUT-79):** nothing floats over content. The live FX rate is a top-bar readout (`$1 = ₪3.06 ▾`) with a popover showing the rates, their source, date and Refresh. The Light/Dark/System toggle sits beside Settings in the sidebar footer. The Mac-app offer (Mac browsers only, until dismissed) and the desktop update bar sit in flow at the bottom of the main area.
- **Client profile (MUT-3 / ADR-033)** — `/clients/:id` (beside the list on a wide window, full page otherwise, MUT-84) is one page with no tabs answering the three questions: the header's **Owed now** (largest figure, per currency, overdue part called out), **Work and billing** (the client's income entries — the entry is the work record — with project as a tag, its own date/status/search filters and the row actions: Record payment, Mark paid, invoice actions while Invoices is on, duplicate), and **Payments** (full history, newest first, each labelled with what it paid for; a recorded payment opens the payment drawer, money saved on the entry opens the entry). The retainers card follows while Retainers is on.
- **Drawer motion (MUT-80 / ADR-044)**: every drawer (local and portal) renders the shared `DrawerFrame`. It springs in from its edge, follows a horizontal drag with a rubber band, and dismisses on a release past half (projected momentum); a press catches it mid-motion. Closing is immediate: the exit is an inert snapshot sliding out along the same edge (mirrored in RTL; cross-fades under reduced motion). Focus is trapped while open and returns to the trigger. `motion@13.4.4` is a dependency.
- **Unassigned records (2026-10-11)**: records saved without a `profileId` show in no profile's lists. `OrphanedRecordsBanner` (AppShell) counts them with `runIntegrityCheck`; its **Review now** opens `OrphanedRecordsDrawer` in place, which lists the clients, projects, income and expenses involved and assigns them all to the default profile or one by one, each starting on its linked client's profile. "Unassigned" is defined once (`isOrphaned`, `src/db/orphanedRecords.ts`). Clients and Projects no longer open a modal by themselves. Locked income entries can't be assigned yet (TD-035).
- **Optional areas (Advanced features, MUT-12 / ADR-032)** — invoices, retainers, expenses, insights, planning and projects are switches in Settings, off by default; `Settings.features` on the settings row; the Dexie v20 upgrade and every bulk data load (restore, import, demo) switch on areas that have data and show a one-time banner. Read through `useFeatureEnabled` / `readFeatureFlags`. **Gated so far (MUT-13):** `/documents*` and `/retainers` redirect home while off; the sidebar "More" section, client-profile invoice actions and retainers card, and the income drawer's lock notice follow the switches. **MUT-14:** expenses are one gated ledger (`/expenses`); the seven other expense pages, `/suppliers`, forecasting, receipt matching and month close are gone (tables retained; receipts exportable from Settings › Data tools). **MUT-16:** `/insights`, `/planning` and `/projects*` are gated; the three join "More"; `+ Add → Project`, the client profile's Projects tab, the drawers' project field and the onboarding project step follow the projects switch (hidden fields keep their data). **MUT-15 (ADR-034):** the sidebar is a fixed, header-less core of Home, Clients, Income, then "More" (optional areas, only while on), with Settings pinned in the footer; a fresh install shows exactly those four. Both `+ Add` menus offer Income, Client, then Expense/Project while on (`visibleAddMenuActions`), with menu-button keyboard support (`useMenuButton`). Switching an area off while its page is open re-runs the route guards (`useLeaveDisabledArea` → `router.invalidate()`), which send the user home.
- **Expenses Needs attention (MUT-87, ADR-052)** — one row per recurring rule, not one card per missed month: "Server hosting · $80 monthly · Aug, Sep, Oct not marked · $240", grouped by the pure `groupOccurrencesByRule`; the header totals each currency side by side (`CurrencyAmounts`). **Mark Paid** opens `RecurringMarkPaidDrawer`: the payments, all checked, each with its date and an editable amount; saving writes one expense per checked payment, **dated on its own expected date**, in one all-or-nothing write (`confirmPayments` inside `recurringOccurrences.runAtomically`). Skip and Snooze apply per payment in the drawer, or to all from the row's ⋯ menu (`useMenuButton`); snoozing is a view of the same drawer. The per-month confirm and snooze modals are gone; the forecast keeps a read-only card. Editing a rule now refreshes the rows (`invalidateRecurringRuleQueries`). Still looks back only 90 days (TD-069).

| Feature | Status | Notes |
|---------|--------|-------|
| Transaction Ledger | ✅ Complete | Full CRUD, filters, search |
| Client Management | ✅ Complete | Index, detail, archive |
| Project Management | ✅ Complete | Index, detail, linked transactions |
| Document Generation | ✅ Complete | Invoice, receipt, credit note, PDF export |
| Multi-Currency | ✅ Complete | USD, ILS, EUR; per-currency reports |
| Expense Tracking | ✅ Complete | Profile-scoped, receipts, categories |
| Retainer Agreements | ✅ Complete | Monthly/quarterly, matching workflow |
| Business Profiles | ✅ Complete | Multi-identity, branding |
| Data Export/Import | ✅ Complete | ZIP backup/restore |
| Demo Mode | ✅ Complete | Sample data, time-frozen |
| i18n | ✅ Complete | English, Arabic, RTL |
| Dark Theme | ✅ Complete | CSS variables theming |
| Desktop App | ✅ Complete | Tauri macOS/Windows |
| PWA | ✅ Complete | Offline-capable web app |
| Device sync | ❌ Retired (MUT-73, ADR-053) | LAN pairing, `.msync` bundles, op-log and its tables deleted |

### In Progress / Planned

| Feature | Status | Priority |
|---------|--------|----------|
| Reports Presets | 🔄 Routes exist | Medium |
| FX Rate Import | 🔄 Manual only | Low |
| SQLite Migration | 📋 Designed | Future |

---

## 5. Deployment Architecture

### Release entry points (since 2026-10-12, ADR-043)

| Command | Rolls out | How |
|---------|-----------|-----|
| `make release web` | the frontend + landing at mutaba3a.app | gates → version prompt → a commit holding only the version files → `git push origin main`; Netlify builds `main` |
| `make release server` | the hosted API + the portal it serves | gates → version prompt → commit + push → `server/scripts/deploy.sh` (image → `prisma migrate deploy` → `terraform apply` → smoke) |
| `npm run release` | the desktop app (DMG, notarized, GitHub release) | unchanged; `scripts/release.ts` over `deploy.sh` |

`scripts/preflight.sh` gates the first two and refuses to release from a tree that does not describe itself — wrong branch, uncommitted changes, an unmerged branch, a parked worktree, behind `origin`, the wrong `node` major, stale `node_modules` — then checks that target's tools, credentials and config (`make doctor` runs all of it read-only). Where the server deploy points is derived from `production.tfvars` and the last `terraform init`, and verified rather than trusted; `deploy.env` overrides it.

### Build Targets

```
┌─────────────────────────────────────────────────────────────────┐
│                        Source Code                               │
│                         (src/)                                   │
└─────────────────────────────┬───────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   Web (PWA)     │ │ Desktop (macOS) │ │Desktop (Windows)│
│                 │ │                 │ │                 │
│ - dist-web/     │ │ - Tauri + Rust  │ │ - Tauri + Rust  │
│ - Netlify host  │ │ - .dmg bundle   │ │ - .msi/.exe     │
│ - /app/ route   │ │ - Auto-updater  │ │ - Auto-updater  │
│ - Service Worker│ │ - Code signed   │ │                 │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

### Hosting & Distribution

| Target | Host | URL/Distribution |
|--------|------|------------------|
| Web (PWA) | Netlify | mutaba3a.app/app/ |
| Landing | Netlify | mutaba3a.app/ — since MUT-75 (2026-10-11): "Know who owes you. Keep it to yourself." over a live HTML Clients list with one button matched to the visitor's device (MUT-76), three one-idea chapters with HTML mock-ups, privacy once, Get it (free during early access; downloads gated on the latest release, ADR-041), six-question FAQ. "Open the web app" lands on a sample business's Clients list with no dialogs and one "Start with your own" line (MUT-78, ADR-042). Web build only (`src/pages/landing/`) |
| macOS | GitHub Releases | Auto-update via Tauri |
| Windows | GitHub Releases | Auto-update via Tauri |
| **Hosted API** (`server/`, since 2026-10-08) | GCP me-west1: Cloud Run service + migration job, Cloud SQL 16, Secret Manager — Terraform in `server/infrastructure/terraform/`, rolled out by `server/scripts/deploy.sh`, CI in `server-ci.yml`. Deployable; not yet deployed by an operator (runbook: `server/DEPLOYMENT.md`) | Consumed by Malafat's Money section with an organization API key. Separate package, separate database, separate deploy. Production only, `live` keys. M1 (integration, keys), M2 (customers, projects, external references, import) and M3 (effective-dated VAT, fixed-fee agreements with installments and supplements, basic retainers with monthly charges, receivables with server-computed statuses) and M4 (payments with previewed allocations and two suggestion strategies, later allocation of unallocated funds, whole-payment reversal, append-only credits against posted receivables, `PAY-YYYY-NNNN` numbering, operations lookup) implemented; M5 (retainer changes with effective-dated versions, proration, cancel preview, reconcile script), M6 (summaries with server-computed statuses, audit listing, attachments through signed URLs) M7 (fee proposals: the negotiation before an agreement; project summaries carry the current proposal) and M8 (approval creates the agreement in one transaction: `PROPOSED → APPROVED | WITHDRAWN`; the organization summary carries each customer's open proposals and their total; archive refused while a proposal is open; lazy posting heals unposted IMMEDIATE installments) implemented. MUT-37 (hosted epic MUT-34, ADR-037): operator-issued portal users and memberships with argon2id passwords, admin routes and `npm run provision:user` & co. MUT-38: browser sessions beside API keys (httpOnly `__Host-` cookie, idle + absolute expiry, lockout that cannot enumerate accounts, per-route principals from the OpenAPI `security`, `X-Mutaba3a-Profile` selection, `GET /v1/me`); the portal's 20 read routes accept sessions. MUT-39: the writability matrix is enforced three times — session scopes, `403 READ_ONLY_PROFILE { domain, writerOfRecord }` for a session on Malafat's write routes, and a store guard below the routes that classifies every repository method (provisioning refused under any guard); lazy posting in a session read runs as SYSTEM on the unguarded store. MUT-42: a hosted profile's expenses (CRUD in the original currency, receipts in the attachments bucket, per-profile categories seeded from the offline presets, a per-currency expense summary) — session-only and invisible to Malafat's key at every door (routes, store guard reads, audit listing, idempotency lookup, a separate receipts table). MUT-64 (epic MUT-63, Mutaba3a Capture): a device session — the same `'session'` principal as a portal session, carried as a bearer token (`mds_<secret>`, distinct from an API key's `mut_` prefix) instead of a cookie, for a native app that can't hold one. `POST`/`DELETE /v1/device-sessions`; one `sessions` table with `kind: 'cookie' | 'device'` so `revokeAllForUser` (password reset, disable, operator revoke-all) covers both for free; no CSRF check (no cookie); reachable on every route a cookie session is (writability/store-guard needed no changes — both are already principal-agnostic); 30-day idle / 180-day absolute lifetime. Blocks MUT-67 (app shell). MUT-65: a personal (non-Malafat) hosted profile can now write its own ledger through its own session — `customers`/`projects`/`payments` become profile-dependent writability rows (`sessionAccessFor`/`sessionScopesFor`/`mayWriteFor`), `POST /v1/customers`/`/v1/projects` accept a session, and two new session-only routes land: `POST /v1/income` (Received, optionally clientless/matter-linked; or Owed, a bare agreement-less `ADJUSTMENT` receivable requiring a customer) with `DELETE /v1/income/{id}` to undo, and `POST /v1/receivables/{id}/settle` (one payment, one allocation, no preview token). `Receivable.projectId` and `Payment.customerId` are now nullable; a Malafat-fed profile is unchanged (still read-only on all of it). MUT-66: the unsorted inbox — capture an amount before deciding which profile it belongs to. `InboxEntry` is the first **user-owned** table (no `organizationId`, no FK to an organization or membership, so an inbox outlives every membership its owner had); `GET/POST /v1/inbox` and `PATCH/DELETE /v1/inbox/{id}` send no profile header and declare no scope, like `GET /v1/me`. `POST /v1/inbox/{id}/file-as-expense` and `…/file-as-income` turn an entry into a real record on one chosen profile in a single cross-repository transaction — the entry is claimed by a delete inside the transaction, so concurrent filings produce exactly one record and a failed write rolls the delete back with it. Filing reuses MUT-42's and MUT-65's own validators unchanged, so it is refused in exactly the places a direct create is (any profile for an expense; `READ_ONLY_PROFILE` on a Malafat-fed one for income). The guard gains a `'sessionOnly'` case; no new scope or matrix domain. `GET /admin/v1/users/{id}` carries `inboxEntryCount`. Blocks MUT-68/MUT-69. See ADR-024/025/026/037/038/048 and `.claude/designs/money-v1-*`, `hosted-portal.md`, `mut-64-device-sessions.md`, `mut-65-personal-profile-income.md`, `mut-66-unsorted-inbox.md` |
| **Hosted portal** (`dist-hosted/`, MUT-43 + expenses MUT-44) | MUT-45: served by the API service itself, same origin (`PORTAL_DIST_DIR`, baked into the Cloud Run image by `scripts/deploy.sh`) — `/assets/*` immutable-cached, SPA fallback to `index.html`, CSP on every response. No custom domain (ADR-037 MUT-45 amendment); code-complete, awaiting the next operator deploy | Malafat tenants' partners sign in with operator-issued email + password and read their firm's money: overview, clients, receivables, payments, documents. Hosted profiles only; nothing persisted on the device but the language. A separate build target (`vite --mode hosted`), its own TypeScript program and its own dictionaries; `npm run test:bundles` proves the local builds carry none of it. MUT-44: expenses are the portal's only write — a drawer shared in part with the local app (`ExpenseFormFields`) records/edits an expense with category/client/matter and attaches receipts via a signed-URL PUT, with MUT-42's error vocabulary mapped to field errors or a toast |

The hosted API does not change the privacy model of the app above this line:
the desktop/PWA stores nothing off-device and never calls the hosted API. The
hosted API holds *law-firm* ledgers for firms that connect from Malafat, and
is subject to the encryption, residency and deletion obligations in ADR-024.

### Build Commands

```bash
# Development
npm run dev              # Default (desktop mode in Tauri context)
npm run dev:web          # Web mode
npm run dev:desktop      # Desktop mode
npm run dev:hosted       # Hosted portal on :5175, /v1 proxied to the API (MUTABA3A_API_ORIGIN, default :8787)

# Production
npm run build            # Auto-detect mode
npm run build:web        # → dist-web/
npm run build:desktop    # → dist-desktop/
npm run build:hosted     # → dist-hosted/ (the portal; MUT-43)
npm run test:bundles     # build all three, then prove they stay apart
npm run hosted:types:check  # the portal's typed client matches server/openapi

# Desktop packaging
npm run tauri build      # macOS/Windows bundles
```

---

## 6. Security & Privacy Model

### Data Residency
- **All data stored locally** in browser IndexedDB or Tauri app storage
- **No server-side database** — user owns their data completely
- **No telemetry, analytics, or tracking** of any kind

### No Device Sync
- **No LAN listener and no mDNS advertisement**: the desktop's sync server was deleted (MUT-73, ADR-053). The only listener left is the one-shot OAuth callback on 127.0.0.1, which nothing in the app opens yet (TD-075)
- **Paired-device tokens are removed**: every desktop launch deletes the retired `paired_devices.json` from the app config directory
- **No data transmitted** without explicit user action

### Document Immutability
- Documents **locked after first PDF export** (audit trail)
- Locked documents cannot be edited, only archived
- Linked transactions locked when document is exported

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
Settings › Data tools › Export Backup  →  move the JSON file  →  Settings › Data tools › Import Backup
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
3. **Desktop builds add value** (PDF archival, better perf, native UX)
4. **Low barrier to entry** ensures adoption

### Distribution Channels
- **Direct**: mutaba3a.app website
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
| Domain | ~$12/year | mutaba3a.app |
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
| **PDF** | @react-pdf/renderer | 4.3.2 | Document generation |
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
│   │   ├── transactions/     # Ledger
│   │   ├── projects/         # Project CRUD
│   │   ├── clients/          # Client CRUD
│   │   ├── documents/        # Invoice/receipt management
│   │   ├── expenses/         # Expense tracking
│   │   ├── retainers/        # Retainer agreements
│   │   └── settings/         # App configuration
│   │
│   ├── features/              # Domain feature modules
│   │   └── documents/        # Invoice PDF generation
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
| PDF generation | <2s | ~1.5s |

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
| 2026-02-09 | 0.0.48 | Initial SYSTEM_OVERVIEW created |
| 2026-10-11 | 0.0.65 | MUT-43: hosted portal build target (sign-in, session states, six read views), bundle-separation check, i18n core split |
| 2026-10-11 | 0.0.65 | MUT-44: hosted expense capture (shared form, drawer, pickers, receipts) — the portal's only write, closing epic MUT-34's build work |
| 2026-10-11 | 0.0.65 | MUT-45: the API serves the hosted portal from its own origin (static assets, SPA fallback, CSP incl. the GCS upload host), `deploy.sh` and CI build it into the image; no custom domain — epic MUT-34's build work now reachable in a browser |
| 2026-10-12 | 0.0.65 | MUT-83: the Clients list's Owed now equals Home's; per-business rows; No client / Archived clients rows; `/income` filters in the URL (ADR-049) |
| 2026-10-12 | 0.0.65 | MUT-62: `/income` and the project Transactions tab show each entry's title (What), cut to one line with the full title on hover and focus (`TruncatedTitle`); untitled shows a dash |
| 2026-10-12 | 0.0.65 | MUT-84: Clients split view on wide windows (layout route, `BREAKPOINTS.clientsSplit`, keyboard walk, list search/sort in the URL) (ADR-050) |
