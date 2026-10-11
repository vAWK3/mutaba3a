# SYSTEM_OVERVIEW.md — Mutaba3a (متابعة)

> **Last Updated**: 2026-02-09
> **Version**: 0.0.48
> **Status**: Production (Beta)

---

## 1. Product Vision

**Mutaba3a** (متابعة, Arabic for "follow-up") is a **privacy-first, offline-only** mini CRM and finance tracker designed for freelancers, consultants, and small service businesses operating in multi-currency environments (primarily USD/ILS/EUR).

### Core Philosophy
- **Privacy by Design**: Zero telemetry, no cloud dependency, data never leaves the device
- **Offline-First**: Full functionality without internet; sync is optional and user-controlled
- **Desktop-First UX**: Feels like a tool/cockpit, not a website; drawer-first interactions
- **Multi-Currency Native**: Track income/expenses in original currencies; FX conversions explicit
- **Local-Only Sync**: Device-to-device via LAN or encrypted file bundles; no cloud middleman

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
│  │     Dexie       │  │   Sync OpLog    │  │   File System       │     │
│  │  (IndexedDB)    │  │ (Append-only)   │  │  (Tauri fs plugin)  │     │
│  └─────────────────┘  └─────────────────┘  └─────────────────────┘     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                           Sync Layer (P2P)                               │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐   │
│  │    HLC      │ │   OpLog     │ │  Conflict   │ │     Bundle      │   │
│  │  (Clock)    │ │  (CRDT-ish) │ │  Resolver   │ │  (File Sync)    │   │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Layer Responsibilities

| Layer | Responsibility | Key Technologies |
|-------|---------------|------------------|
| **Presentation** | UI rendering, user interactions | React 19, CSS Variables |
| **State** | Data fetching, caching, UI state | TanStack Query, Zustand, URL |
| **Repository** | Business logic, data access abstraction | Custom Repo pattern |
| **Storage** | Persistence, indexing | Dexie (IndexedDB) |
| **Sync** | Cross-device synchronization | HLC, OpLog, Bundle encoding |

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
- **Mark Paid**: Set `status='paid'`, `paidAt=now()`, keep `occurredAt` as earned date
- **Record Payment**: a `PaymentRecord` per payment; `receivedAmountMinor`,
  `status` and `paidAt` are recalculated from the records. Reachable from a
  primary button on every unsettled income row (`RecordPaymentButton`), not a
  kebab entry, with the drawer prefilled to the remaining balance
- **Overpayment is rejected** — the sum of a transaction's payments can never
  exceed its amount (ADR-030). Payments on a locked (invoiced) transaction are
  allowed: the lock protects the invoice facts, not payment tracking
- **Owed Now** = remaining balance of unpaid, non-deleted, non-archived income,
  per currency, overdue part split out — one helper, `summarizeOwedByCurrency`
  (ADR-033), for every screen that shows it
- **A client's payment history** = its `PaymentRecord`s plus one derived
  `entry` row per income whose received amount no record covers (income saved
  as Received writes none; ADR-033, TD-029)

---

## 4. Feature Map

### Implemented (v0.0.48)

- **Client profile (MUT-3 / ADR-033)** — `/clients/:id` is one page with no tabs answering the three questions: the header's **Owed now** (largest figure, per currency, overdue part called out), **Work and billing** (the client's income entries — the entry is the work record — with project as a tag, its own date/status/search filters and the row actions: Record payment, Mark paid, invoice actions while Invoices is on, duplicate), and **Payments** (full history, newest first, each labelled with what it paid for; a recorded payment opens the payment drawer, money saved on the entry opens the entry). The retainers card follows while Retainers is on.
- **Optional areas (Advanced features, MUT-12 / ADR-032)** — invoices, retainers, expenses, insights, planning and projects are switches in Settings, off by default; `Settings.features` on the settings row; the Dexie v20 upgrade and every bulk data load (restore, import, demo, sync) switch on areas that have data and show a one-time banner. Read through `useFeatureEnabled` / `readFeatureFlags`. **Gated so far (MUT-13):** `/documents*` and `/retainers` redirect home while off; the sidebar "More" section, client-profile invoice actions and retainers card, and the income drawer's lock notice follow the switches. **MUT-14:** expenses are one gated ledger (`/expenses`); the seven other expense pages, `/suppliers`, forecasting, receipt matching and month close are gone (tables retained; receipts exportable from Settings › Data tools). **MUT-16:** `/insights`, `/planning` and `/projects*` are gated; the three join "More"; `+ Add → Project`, the client profile's Projects tab, the drawers' project field and the onboarding project step follow the projects switch (hidden fields keep their data). A fresh install's sidebar is Home, Income, Clients, Settings. The sidebar's final shape is MUT-15.

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
| Sync Foundation | ✅ Complete | OpLog, HLC, conflict types defined |

### In Progress / Planned

| Feature | Status | Priority |
|---------|--------|----------|
| WiFi Sync (LAN) | 🔄 Foundation ready | High |
| Bundle Sync (File) | 🔄 Types defined | High |
| Reports Presets | 🔄 Routes exist | Medium |
| FX Rate Import | 🔄 Manual only | Low |
| SQLite Migration | 📋 Designed | Future |

---

## 5. Deployment Architecture

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
| Landing | Netlify | mutaba3a.app/ |
| macOS | GitHub Releases | Auto-update via Tauri |
| Windows | GitHub Releases | Auto-update via Tauri |
| **Hosted API** (`server/`, since 2026-10-08) | GCP me-west1: Cloud Run service + migration job, Cloud SQL 16, Secret Manager — Terraform in `server/infrastructure/terraform/`, rolled out by `server/scripts/deploy.sh`, CI in `server-ci.yml`. Deployable; not yet deployed by an operator (runbook: `server/DEPLOYMENT.md`) | Consumed by Malafat's Money section with an organization API key. Separate package, separate database, separate deploy. Production only, `live` keys. M1 (integration, keys), M2 (customers, projects, external references, import) and M3 (effective-dated VAT, fixed-fee agreements with installments and supplements, basic retainers with monthly charges, receivables with server-computed statuses) and M4 (payments with previewed allocations and two suggestion strategies, later allocation of unallocated funds, whole-payment reversal, append-only credits against posted receivables, `PAY-YYYY-NNNN` numbering, operations lookup) implemented; M5 (retainer changes with effective-dated versions, proration, cancel preview, reconcile script), M6 (summaries with server-computed statuses, audit listing, attachments through signed URLs) M7 (fee proposals: the negotiation before an agreement; project summaries carry the current proposal) and M8 (approval creates the agreement in one transaction: `PROPOSED → APPROVED | WITHDRAWN`; the organization summary carries each customer's open proposals and their total; archive refused while a proposal is open; lazy posting heals unposted IMMEDIATE installments) implemented. See ADR-024/025/026 and `.claude/designs/money-v1-*` |

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

# Production
npm run build            # Auto-detect mode
npm run build:web        # → dist-web/
npm run build:desktop    # → dist-desktop/

# Desktop packaging
npm run tauri build      # macOS/Windows bundles
```

---

## 6. Security & Privacy Model

### Data Residency
- **All data stored locally** in browser IndexedDB or Tauri app storage
- **No server-side database** — user owns their data completely
- **No telemetry, analytics, or tracking** of any kind

### Sync Security
- **Device pairing** requires physical presence (QR code or pairing code)
- **Bundle files** encrypted with user-chosen passphrase (AES-256)
- **LAN sync** uses device identity keys (Ed25519) for authentication
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

### Device Sync Onboarding

```
1. Sync Settings Page
   └─> "Add Device" button

2. Choose Method
   ├─> WiFi (LAN)
   │   └─> QR code on new device
   │   └─> Scan from trusted device
   │   └─> Verify fingerprints match
   │
   └─> File Bundle
       └─> Export encrypted bundle
       └─> Transfer via USB/AirDrop/email
       └─> Import on new device
       └─> Enter passphrase

3. Sync Complete
   └─> Devices paired
   └─> Future syncs automatic (LAN) or manual (file)
```

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
│   ├── sync/                  # Sync system
│   │   ├── core/             # HLC, OpLog, conflict resolution
│   │   ├── transport/        # Bundle encoding, crypto
│   │   └── stores/           # Sync state
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
