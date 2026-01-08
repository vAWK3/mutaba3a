# Mutaba3a (متابعة) — Privacy-First, Offline-First Mini-CRM + Finance Tracker

Mutaba3a is a small, open-source tool for freelancers to track **clients, projects, income, unpaid amounts, and expenses** — built around one core principle:

**Your business data belongs to you. It should live on your device, under your control, and remain inaccessible to anyone else by default.**

---

## Why Mutaba3a exists

Most “simple” finance/CRM tools quietly become data funnels:
- they require accounts,
- they upload your client list and notes,
- they store invoices and relationships,
- they add analytics/tracking SDKs,
- they centralize your livelihood into a database you don’t own.

Mutaba3a takes the opposite stance.

### Privacy principles (non-negotiable)

- **Offline-first by design**: the app works fully without an internet connection.
- **Local-only by default**: your database is stored on your device.
- **No tracking**: no analytics, no session replay, no third-party trackers.
- **No silent sync**: nothing leaves your device unless you explicitly choose it.
- **User-initiated sharing only**: exports/backups are triggered by you, not the app.

> In short: **your data in your hands only**.

---

## Multi-account support (one app, separate vaults)

Mutaba3a supports **multiple accounts on the same device**.

This is designed for:

- freelancers managing multiple businesses/brands,
- shared devices (family tablet / office laptop),
- keeping **personal** and **work** data separate,
- separating clients by region, partner, or entity.

### How it works (conceptually)

- Each account is its own **separate local data space** (a “vault”).
- Switching accounts does **not** merge data.
- Export/backup is **per account**.
- Account separation is strict by default to avoid accidental cross-contamination.

> No “global” data pool. No surprise mixing of clients or transactions.

---

## What Mutaba3a tracks

Mutaba3a focuses on business clarity, not project management.

- **Clients**
- **Projects** (under a client, tagged by a work field like Design / Development / Legal)
- **Money events**
  - income (earned / invoiced / received)
  - expenses (linked to a project or general)

Core questions it answers:

- How much did I **receive** this month?
- What’s **still unpaid**?
- What did I spend this year — overall or per project?
- How much did I earn in **USD vs ILS**?

---

## Product principles

- **Not a project management tool**: no tasks, no Gantt, no time tracking by default.
- **No tax/accounting theater**: no VAT, no complicated bookkeeping flows.
- **Fast input → fast truth**: add entries quickly; dashboards stay simple.
- **Multi-currency without lying**:
  - Separate ledgers per currency by default.
  - Optional conversion view for unified reporting — transparent, reversible, never “guessy.”

---

## MVP features

### Clients

- name
- contact info (optional)
- notes (optional)

### Projects

- belongs to a client
- tagged by **Work Field** (user-editable)
- optional dates + notes

### Money events

**Income**

- linked to a project (client auto-attached)
- amount + currency (USD/ILS in MVP)
- status: Earned → Invoiced → Received

**Expense**

- linked to a project (optional) or “General”
- amount + currency
- minimal categories (editable): Tools/Software, Transport, Materials, Subcontractors, Other
- date + note

### Dashboards & reporting (answers-first)

- Overview:
  - This month: Received (USD) / Received (ILS)
  - Outstanding: Unpaid (USD) / Unpaid (ILS)
  - This year: Expenses (USD) / Expenses (ILS)
- Reports (filters: month/year/client/project/field/status):
  - Income report
  - Expense report
  - Project summary (received vs outstanding vs expenses per currency)
  - Client summary (totals vs unpaid per currency)

### Quality-of-life

- global search (clients/projects)
- one-click export:
  - CSV income ledger
  - CSV expense ledger
- **backup/restore** local data bundle (per account)

---

## Currency behavior (strict and non-confusing)

### Ledger rules

- Every money event has **exactly one currency** (USD or ILS in MVP).
- Reports exist **per currency by default**, never mixed.

### Optional unified view (conversion)

- User chooses a base currency (USD or ILS).
- Conversion uses **manual rate per month**.
- Unified view always shows:
  - original amount + currency
  - rate used
  - converted amount
- If a month’s rate is missing, the unified report shows **“missing rate”** -- no guessing.

---

## Offline-first

### ✅ What it means

- You can use Mutaba3a without signing up.
- It works in spotty Wi-Fi, no-Wi-Fi, and “I don’t trust apps” mode.
- Your sensitive data doesn’t need to be uploaded to be useful.

### ❌ What it doesn’t mean

- The app does not silently sync anything.
- Cloud is not required to unlock basic functionality.

---

## Security model (simple, realistic)

Mutaba3a minimizes risk by default:

- **Default: local-only storage**
- **Optional: user-initiated exports/backups**
- **Clear boundaries**: if you choose to move data, you do it intentionally

Planned/optional (depending on roadmap):

- encrypted backups
- local network sync (LAN) without routing through a server
- end-to-end encrypted sync for users who explicitly enable it

---

## Getting started

```bash
# 1) Clone
git clone https://github.com/vAWK3/mutaba3a
cd mutaba3a

# 2) Install
npm install

# 3) Start dev
npm run dev

# 4) Build
npm run build
```

---

## Data model (conceptual)

    •	Account (local vault boundary)
    •	WorkField
    •	Client
    •	Project
    •	MoneyEvent (income/expense)

Key rule: account separation is strict (no shared tables unless explicitly designed).

⸻

## What Mutaba3a will never do

    •	Require an account to function
    •	Upload your client/project data by default
    •	Add trackers or third-party analytics SDKs
    •	Make your business depend on a server you don’t control

⸻

## License & trademarks

Mutaba3a is **source-available** and free to use for **personal** and **educational** purposes.

### Allowed

- Personal use (individual freelancers managing their own work)
- Educational use (learning, teaching, workshops, research, classroom projects)
- Non-commercial community use (as long as no fees are charged for access or use)

### Not allowed (commercial use / reselling prohibited)

- Selling, sublicensing, or reselling Mutaba3a (or forks/derivatives) in any form
- Offering Mutaba3a (or forks/derivatives) as a paid product or service (SaaS), including paid hosting
- Charging fees for access, features, “premium versions,” or bundled distributions that include Mutaba3a
- Using Mutaba3a’s code in a commercial product where the product is sold, licensed, or monetized

If you need commercial use rights (including company use, paid distribution, or hosting), you must obtain explicit written permission from the maintainer.

### Trademarks

The name **Mutaba3a** (متابعة) and the **Mutaba3a logo** are trademarks of the project maintainer.

- You may not use the Mutaba3a name or logo to brand, market, or distribute a fork/derivative.
- Forks must use a different name and branding and must not imply endorsement or affiliation.

### License file

This repository includes a license file that reflects the terms above. See `LICENSE`.

⸻

## Support the project

If privacy-first tools matter to you and Mutaba3a helps your work, support keeps it alive:
<!-- • GitHub Sponsors: <LINK> -->
<!-- • Open Collective: <LINK> -->
• Buy Me a Coffee: [<LINK>](https://buymeacoffee.com/elmokhtbr)
<!-- • Ko-fi:  -->
<!-- • Stripe monthly/yearly support: <LINK> -->

⸻

## Contact & security

    •	Issues / feature requests: GitHub Issues
    •	Security reports: m@elmokhtbr.com
    •	Maintainer: elMokhtbr
