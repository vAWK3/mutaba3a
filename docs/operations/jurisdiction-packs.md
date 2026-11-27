# Jurisdiction packs: versions and review dates

Each invoicing jurisdiction pack (ADR-287, `server/src/jurisdictions/<cc>/`) carries dated tables of rates and
thresholds. The pack contract (`server/src/jurisdictions/__tests__/pack.contract.test.ts`, MUT-745) fails CI when a
table has no step in force today; it cannot see a change a country has announced but the pack doesn't have yet. That is
what the review date is for: on or before it, check the country's sources, update the pack (a new step is a new pack
version), and move the date.

| Pack | Version | Dated tables | Sources | Last reviewed | Review by |
|---|---|---|---|---|---|
| IL (Israel) | 1.0.0 | `vat.standardRate` (17% from 2015-10-01, 18% from 2025-01-01); `expense.allocationThreshold` (₪25,000 from 2024-05-05 down to ₪5,000 from 2026-06-01) | Israel Tax Authority: VAT rate orders; allocation-number (חשבוניות ישראל) thresholds | 2026-11-27 | 2026-12-15 (before the 1 January changes Israel usually takes effect on) |

When a pack is added: add its row, its fixture (`server/src/jurisdictions/__tests__/fixtures/<cc>.ts`) and, once it is
live, its release-QA map (`qa/features/portal/invoicing-<cc>.yaml`).
