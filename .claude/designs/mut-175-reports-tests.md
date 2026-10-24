# MUT-175 — Portal Reports: test plan (Phase 2)

Brief: `mut-175-reports.md`. Plan and decisions: `mut-175-reports-plan.md`. Layer table: `.claude/TEST_PLAN.md` § MUT-175.

Tests were written before the code for each unit (TDD): the D5 characterization tests landed first, unchanged code under them, and the expense-group release-QA ran green before the DayBars change.

| AC (plan §7) | Proof |
|---|---|
| 1. Reachable from the shell, every profile, both modes, en/ar | `Reports.test.tsx` "is a nav item…", "Arabic"; `local-mode.test.tsx` sections; QA `first-run`, `arabic`, `signed-out` |
| 2. Received headline, Owed secondary, never "billed" | `Reports.test.tsx` stage 1; QA `first-month` |
| 3. One ≈ at today's ECB rate, exact per currency on hover/focus/tap, per-currency fallback | `reports.test.ts` units; `Reports.test.tsx` ≈ breakdown + missing rate; QA `converted-breakdown` |
| 4. Week/Month/Year (Year from stage 3), ‹ ›, All profiles switch with its lines, state in the URL | `reports.test.ts` periods/stepping; `reportsComponents.test.tsx`; `filters.test.ts`; `Reports.test.tsx` stepping + All profiles; QA `period-step`, `all-profiles-switch`, `teaser-suggests-switch` |
| 5. Stage from data (7th-day rule), recap at 2, insights at 3, "Lately" ignores the period | `reports.test.ts` stages; `reportInsights.test.ts`; `activity.test.ts` days to paid; `Reports.test.tsx` stage 1/3 + stepping; QA `first-month`, `third-month` |
| 6. Animated, keyboard-navigable charts with spoken values; reduced motion | `DayBars.test.tsx`; `reportsComponents.test.tsx` CountUp; `Reports.test.tsx` chart |
| 7. A profile the person can't read is named and left out; the rest renders | `Reports.test.tsx` 403 explainer + failed profile; QA `profile-fails` |
| 8. Release-QA scenarios pass, lint clean, gate green | `release-qa` run + `release-qa lint`; the full gate (CLAUDE.md Phase 4) |

Server: `activity.test.ts`, `routes-activity.test.ts`, the M4 store contract (`listAllocationsFor`, memory + Prisma), the local parity script, and the route inventories (security, writability, portal-routes coverage). Analytics: `reportViewed.test.ts` and the pinned taxonomy v2.2.0.
