# MUT-62 — Show what you did (the entry title) in the /income ledger: test plan

- **Ticket:** MUT-62 (epic MUT-1) · found during MUT-5's browser pass (2026-10-11)
- **Relevant decisions:** ADR-039 (the income entry is the work record; brief `mut-5-income-fast-path.md`), ADR-049 (`/income`'s filters are one URL model), ADR-033 / MUT-3 (the client profile's Work list is the reference for the label)
- **Reserved ids:** ADR-056 (not expected), TD-076
- **Status (2026-10-12):** T1–T13 are written; T14 (e2e) was not, because the owner stopped new tests. Only T1–T7 have run (green once). Lint, typecheck and tests wait for the combined run on main, at the owner's request (see TEST_PLAN.md).

## What exists today (2026-10-12)

- `/income` (`src/pages/income/IncomePage.tsx`) renders date · client · project · status · amount · actions straight from the raw `TransactionDisplay[]`; no column shows `tx.title`.
- Search already matches the title: `transactionRepo.list` checks `title`, `notes`, client name and project name (`src/db/repository.ts`). `/income` reaches it via URL `q` → `resolveIncomeFilters` → `useIncome({ search })`. No new search code; this ticket pins the path with a page-level test.
- The client profile's Work list (`ClientWorkSection`) heads the title column `clients.profile.work.what` ("What" / "العمل") and shows "Untitled" for an entry with no title. It truncates with CSS only: no hover or focus text.
- There's no tooltip component in the main app; `title=` attributes are the only hover text, and they never show on keyboard focus. No shared dash constant either; pages use a literal `'-'` or `'—'`.
- Other income lists: the legacy `/transactions` page redirects to `/income` (dead code, TD-025), so it is left alone. The project page's Transactions tab (behind the Projects switch) lists income and legacy expense rows with no title column, so it gets the same column. The hosted portal's receivables carry no title field, so they're out of scope.

## Decisions (owner, 2026-10-12)

- **Label:** reuse `clients.profile.work.what`, which reads "What" / "العمل".
- **Untitled:** a dash, as the acceptance criteria say. This differs from the profile's "Untitled"; the profile is not changed (recorded in the CHANGELOG, TD-076).

## Design

- **`EMPTY_CELL = '—'`** (`src/lib/utils.ts`): the one dash for an empty table cell. `/income`'s project cell switches from `'-'` to it.
- **`toIncomeRow(tx)`** (`src/pages/income/incomeRows.ts`): the pre-shaped row. `title` is trimmed, and blank becomes undefined. It also carries client, project, payment status, overdue days, the partial received amount and `canMarkPaid`. The page maps rows in `useMemo([transactions])`.
- **`incomeColumns(compact)`**: one of two module-level column lists (wide / compact), so the definitions are referentially stable across renders. The header and every row render from the same list, so they can't drift. Order: date · **What** · client · project (wide only) · status · amount · actions.
- **`TruncatedTitle`** (`src/components/ui/TruncatedTitle.tsx`): the title as a button that opens the entry, one line with an ellipsis, with `dir="auto"` so Arabic or mixed titles lay out correctly in either UI direction. When the text is cut, hover or keyboard focus shows the full title in a tooltip portalled to `<body>`, because `.data-table` scrolls and would clip it. The tooltip is hoverable (a short grace period before it hides), dismissed by Escape, and hidden on blur, scroll and resize (WCAG 1.4.13). It is `aria-hidden`, because the button's accessible name is already the full title. A click runs `onOpen` and stops the row's own click, so the drawer opens once.
- **Cell sizing:** `td.work-cell { width: 40%; max-width: 0 }` takes the spare width and truncates instead of widening the table (the client profile's technique).

## Rules under test

| # | Rule | Level | File |
|---|---|---|---|
| T1 | `toIncomeRow`: title passed through; missing, empty and whitespace-only titles become undefined; surrounding spaces trimmed; overdue days only when > 0; partial received only on a part-paid entry; `canMarkPaid` for unpaid and not fully received | unit | `src/pages/income/__tests__/incomeRows.test.ts` |
| T2 | `incomeColumns`: wide order is date, work, client, project, status, amount, actions; compact drops only project; the same array instance on every call (stable) | unit | same |
| T3 | `TruncatedTitle`: renders the title as a button named by the full text, with `dir="auto"`; click calls `onOpen` once and doesn't bubble to the row | component | `src/components/ui/__tests__/TruncatedTitle.test.tsx` |
| T4 | `TruncatedTitle`: when cut (`scrollWidth > clientWidth`), hover shows the full title in a tooltip and leaving hides it after the grace period; moving onto the tooltip keeps it | component | same |
| T5 | `TruncatedTitle`: when cut, keyboard focus shows the tooltip, Escape hides it, blur hides it | component | same |
| T6 | `TruncatedTitle`: when not cut, neither hover nor focus shows a tooltip | component | same |
| T7 | `TruncatedTitle`: the tooltip sits below the title at its inline start (left in LTR, right in RTL) and hides on scroll | component | same |
| T8 | IncomePage (AC1): a "What" header right after Date; each titled entry shows its title; an untitled entry and a whitespace title show `—`; a missing project shows `—` | component | `src/pages/income/__tests__/IncomePage.test.tsx` |
| T9 | IncomePage (AC2): the title is a button inside the row; Enter or click opens the edit drawer for that entry, once | component | same |
| T10 | IncomePage (AC4 / 375 px): on a compact table, What stays and Project goes; header and cells line up (same count per row) | component | same |
| T11 | IncomePage (AC5): every header cell and every row cell comes from one column list, and a re-render with the same entries keeps the same row objects (the `useMemo`) | component | same |
| T12 | **Search through the URL model (AC3):** with real Dexie and the real `useIncome`, a URL `q` with one word of a title lists only that entry; typing a title word in the search box writes `q` and narrows the list; matching ignores case; an Arabic title is found by an Arabic word | integration (fake-indexeddb) | `src/pages/income/__tests__/IncomePage.titleSearch.test.tsx` |
| T13 | ProjectDetailPage: the Transactions tab gets a What column after Date with the title or `—`; the title button opens the right drawer (income or expense) once | component | `src/pages/projects/__tests__/ProjectDetailPage.test.tsx` |
| T14 | **e2e (real layout):** a long title is cut to one line (the row keeps its single-line height); hover and Tab focus show the full title; Escape hides it; a short title shows no tooltip; searching a title word finds the entry; in Arabic the What column is mirrored to the right of Date and an Arabic title renders; axe adds no rule on `/income` | e2e | `e2e/income-work-column.spec.ts` |

## Edge cases

- Whitespace-only title → dash (T1, T8).
- An entry whose title holds Latin and Arabic → `dir="auto"` gives it the right base direction in either UI (T3, T14).
- Title button inside a clickable row → one drawer open (T3, T9, T13).
- Tooltip near the bottom of the window → it flips above the title, and is nudged inside the viewport horizontally (checked by hand in the browser; layout isn't measurable in jsdom).
- 375 px: the What cell shrinks and truncates; it never adds width to the table (browser check, reported).
- MUT-83 suites stay green: `incomeSearch.test.ts`, `useIncomeFilters.test.tsx`, `IncomePage.test.tsx` "URL filters", `e2e/owed-parity.spec.ts`.
