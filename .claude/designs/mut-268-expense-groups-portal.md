# Design brief — MUT-268 Portal expense groups

Approved 2026-10-18 by Basel (design review 1A–23A + Apple-design pass, then eng plan + eng-review corrections R1–R12). This brief is the CLAUDE.md Phase 1 wrapper; the substance lives in:
- `mut-268-expense-groups-portal-plan.md` — decisions 1A–23A, state table (8A), action → request table, craft spec.
- `mut-268-expense-groups-portal-eng.md` — files, E1–E12, R1–R12, tests, QA mapping.
- `mut-268-expense-groups-wireframe.html` — layout and copy.

## Problem and acceptance criteria
A freelancer back from a trip can't see what it cost. Ticket ACs:
1. Create "Jordan trip" for 3–7 Oct and see every expense in that range listed.
2. Exclude one: it leaves the totals and charts at once and appears under Excluded.
3. Add an expense from 12 Sep: it appears and counts.
4. Per-currency tabs never sum currencies; the converted total shows its base currency and FX date.
5. Empty state for a group with no expenses, plus loading and error states.
6. Arabic default, RTL charts and lists, works at 375 width.
7. Release-QA feature in `qa/features/portal` + a passing tagged portal spec.

## Solution (component diagram)
```
router.tsx
├─ /p/:id/expenses ─────────── ExpensesList ─ SectionTabs
├─ /p/:id/expenses/groups ──── ExpenseGroupsList ─ SectionTabs, GroupDrawer(?newGroup)
└─ /p/:id/expenses/groups/:g ─ ExpenseGroupDetail (key=g)
     ├─ headline + ≈ line (useFxRates) + SegmentedTabs(currency)
     ├─ DayBars · CategoryBars
     ├─ GroupMembers (members by day, Left out)
     ├─ GroupDrawer(?editGroup) · AddToGroupDrawer(?addToGroup)
     └─ Toast(action: Undo / Retry)
ExpenseDrawer ─ InGroupsLine (Add to group… / Remove)
data/expenseGroups.ts (pure rules) ← data/expenseGroupQueries.ts (TanStack) ← api/client.ts
```

## API contracts and error states
Consumes MUT-267 unchanged (API 1.33.0-mut267): `/v1/expense-groups` CRUD (+`?expenseId=`), PUT/DELETE `…/expenses/{expenseId}`, `…/summary`, `/v1/expenses?groupId&groupMembership`, `/v1/fx-rates?base=`. Errors: 422 NAME_REQUIRED / END_BEFORE_START / GROUP_RANGE_TOO_LONG / GROUP_LIMIT / DATE_INVALID(bound) → field or form messages; 409 → reload notice; 404 → "This group was deleted"; FX 503 → ≈ line hidden; network → Unreachable card + Retry.

## Reuse (COMPONENT_REGISTRY)
Reused: PageHeader, QueryView/Empty/Skeleton/Unreachable, Drawer (DrawerFrame), SegmentedTabs, DecimalAmount, formatDay, hp-strip styles, Toast (extended with an action), useAttemptKey, usePopover/hp-popover, captureRowExit, UI_SPRING, Table.css. New (registered): SectionTabs, DayBars, CategoryBars, GroupMembers, GroupDrawer, AddToGroupDrawer, InGroupsLine, playRowEnter.

## Impact
Portal only (`src/hosted/**`, `src/lib/motion/`, `qa/`). `usePrefersReducedMotion` moves to `src/lib/motion/` with a re-export at its old path; `minorToDecimal` moves to `src/hosted/format/currencies.ts`. Expense writes now also refetch group queries. No server, schema, migration or env change.

## i18n / l10n
All strings in `src/hosted/i18n/{ar,en}.json` under `hosted.groups.*`; Arabic is the default. Amounts via DecimalAmount (Latin digits, mono, isolated). Dates via `formatDay`. Week starts follow the locale (Sat for ar, Mon for en). Counts follow a colon or lead the phrase until MUT-179's `tp()`.

## Cost
No new infra. Per detail view: group, summary, member pages (window + keep marks), Left out, one cached FX read. Bulk leave-out is one PUT per row (accepted, 13A).

## Infra
None.

## QA scenarios
See the eng plan's table: `create`, `leave-out-undo`, `add-from-outside`, `currencies-converted`, `category-prune`, `states`, `in-groups-line`, `edit-delete`, `arabic-375` → `qa/features/portal/expense-groups.yaml`, specs tagged `@portal.expense-groups.<id>` in `qa/specs/portal/expense-groups.spec.ts`.
