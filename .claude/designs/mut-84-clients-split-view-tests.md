# MUT-84 — Clients open in a split view beside the list on wide windows: test plan

- **Ticket:** MUT-84 (epic MUT-74) · **Brief:** `landing-apple-redesign.md` C1 (approved 2026-10-11) · **ADR:** ADR-050 · **TD:** TD-067
- **Status (2026-10-12):** T1–T18 written test-first (red at `6401562`), passed once mid-build; not run since, at the owner's request (one combined run on main after every lane merges). T19 not written: the owner stopped new tests, and MUT-97 replaced `e2e/` with `qa/` (TD-067). The breakpoint landed at 1280 px, not the 1200 first planned (measured in the browser). **Update 2026-10-12:** T1–T18 ran green in the combined check on main (`eeacd57`); T19 is written as four `qa/` features, `web.clients.split-view{,-deep-link,-resize,-rtl}`, all passing (TD-067 resolved).
- **Relevant decisions:** ADR-003 (drawer-first), ADR-008 (URL-driven UI state), ADR-033 (client profile), ADR-035 (list order), ADR-044 (motion, reduced motion), ADR-049 (muted rows, sort in the URL)

## What is there today (2026-10-12, main `9f6a282`)

- `/clients` (`ClientsPage`) and `/clients/$clientId` (`ClientDetailPage`) are sibling routes under the root. Opening a client unmounts the list; Back mounts it again.
- Each page renders its own `TopBar`.
- The list's search is a `useState`. Its sort is `useSortState`, which writes `?sort=&dir=` with `window.history.replaceState({}, …)` behind the router, so a router navigation (a click on a client) rebuilds the URL from the router's stale location and drops the sort.
- MUT-83's muted rows ("No client · N entries", "Archived clients · N") are links to `/income?client=none|archived`; they always sort last.

## Design

- **One layout route.** `/clients` becomes a layout (`ClientsLayout`) with two children: the index (`/clients/`, nothing beside the list) and `$clientId` (`ClientDetailPage`). The URLs do not change, so deep links, Home's rows and back/forward keep working.
- **One tree, three arrangements.** The layout always renders the same two panes, list then profile; only `data-layout` and `hidden` change:
  - `list`: no client open. The list is full width, as today.
  - `split`: a client is open and the window is at least `BREAKPOINTS.clientsSplit` wide. The list narrows to a column (Client and Owed now; the strip hides) and the profile sits beside it. RTL mirrors the columns.
  - `profile`: a client is open on a narrow window. The profile is full width and the list is hidden but stays mounted. This is today's full-page profile.

  Resizing across the breakpoint changes attributes only, so neither pane remounts.
- **The breakpoint is a named token.** `BREAKPOINTS.clientsSplit` in `src/lib/breakpoints.ts`. `useIsSplitView()` reads it through `matchMedia`; CSS keys off `data-layout`, so the number lives in one place.
- **One top bar.** The layout owns the `TopBar`: "Clients" on the list; the client's name, the Clients breadcrumb and Edit when a client is open, at any width. `ClientDetailPage` renders the profile body only.
- **The list's state is one URL model.** `q` (search), `sort` and `dir` are parsed by `parseClientsSearch` (the layout route's `validateSearch`) and written by `useClientsSearch` with `replace`, both in `src/components/clients/` beside the sort fields they validate (`src/lib` and `src/hooks` import nothing from `components`). Every client link and walk keeps them, so they survive switching clients, Back and a reload. Defaults (owed, descending, no search) are not written. This replaces `useSortState` on this page.
- **Each client's profile starts fresh.** The detail route's `remountDeps` is the client id: walking to the next client remounts the profile, so its Work filters reset and it opens at the top. A resize never changes the key.
- **Keyboard (split only, i.e. a wide window):**
  - On a client row's link, ↑/↓ open the previous/next client. Focus moves to that row and the profile follows. The walk skips the muted rows and stops at either end.
  - The first walk from no open client pushes a history entry; walking from one open client to the next replaces it, so Back closes the profile instead of replaying the walk. A click keeps link semantics and pushes, as today.
  - ↓ in the list's search box focuses the open client's row, or opens the first client.
  - Enter on the open client's row, or → (← in RTL) on any client row, moves focus into the profile pane.
  - In the profile, Escape or ← (→ in RTL) returns focus to the open client's row, unless the key belongs to a control: a text field, a select, anything inside an open menu/listbox/dialog/tablist/radiogroup, a button whose popup is open, or an event already handled. A modifier (Alt+← is browser Back) is never intercepted.
  - On a narrow window the keys do what they do today.
- **Selection is announced.** The open client's link carries `aria-current="page"` and its row is tinted. A polite status line says "Showing {name}" whenever the open client changes after the page loaded (a walk, a click, back/forward), not on a deep-link load.
- **Muted rows stay links.** They are skipped by the walk and keep opening `/income` filtered, in every arrangement.
- **No motion.** The pane appears in place; nothing to reduce.

## Rules under test

| # | Rule | Level | File |
|---|---|---|---|
| T1 | `parseClientsSearch`: empty URL → `{}`; keeps a valid `q`, `sort`, `dir`; drops an unknown sort field or direction; reads a numeric `q` as text. `mergeClientsSearch` drops cleared fields and defaults. `resolveClientsSearch` fills owed / desc / '' | unit | `src/components/clients/__tests__/clientsSearch.test.ts` |
| T2 | `useClientsSearch` on a real memory router: reads the URL; a change is written with `replace` (no history entry), on `/clients` and on `/clients/:id`, keeping the path and the other fields; a default is removed | hook | `src/components/clients/__tests__/useClientsSearch.test.tsx` |
| T3 | `listKeyAction` / `profileKeyAction`: ↑/↓/Enter; → toward the profile and ← back in LTR, mirrored in RTL; Escape back; other keys nothing | unit | `src/components/clients/__tests__/clientsSplitView.test.ts` |
| T4 | `adjacentClientId`: next and previous in display order; skips the muted rows; undefined past either end or for an id not listed | unit | same |
| T5 | `keyBelongsToControl`: true for input, textarea, select, contenteditable, anything inside `[role=menu]`, `listbox`, `dialog`, `tablist`, `radiogroup`, `combobox`, and a button with `aria-expanded="true"`; false for a plain link, button or the pane itself. `hasModifier` for Alt/Ctrl/Meta/Shift | unit | same |
| T6 | `BREAKPOINTS.clientsSplit` is a number; `useIsSplitView` asks `matchMedia` for `(min-width: <token>px)` | unit | `src/hooks/__tests__/useMediaQuery.test.ts` |
| T7 | **Narrow:** `/clients` shows the list and no profile pane; `/clients/:id` shows the profile full width with the list hidden; the top bar shows the client's name and the Clients breadcrumb | component (memory router) | `src/pages/clients/__tests__/ClientsLayout.test.tsx` |
| T8 | **Wide:** `/clients` shows the full list and no pane; `/clients/:id` shows both, `data-layout="split"`, the open row tinted with `aria-current="page"` on its link | component | same |
| T9 | **Resize with a profile open:** wide → narrow → wide switches `data-layout` and never remounts the profile (mount count stays 1; a value typed in it is kept) | component | same |
| T10 | **Walk:** ↓/↑ on a row open the next/previous client, move focus to its link and update the URL; muted rows are skipped; the ends do nothing; the first walk from `/clients` pushes and later walks replace (history length) | component | same |
| T11 | **Into and out of the profile:** Enter on the open row and → focus the profile pane; Escape and ← return focus to the open row; in RTL ← goes in and → comes back; a key typed in a field inside the profile is left alone; Alt+← is not intercepted | component | same |
| T12 | **Narrow keys:** ↑/↓ on a row neither navigate nor move focus | component | same |
| T13 | **Announcement:** after a walk the status line reads "Showing {name}"; a deep-link load leaves it empty | component | same |
| T14 | **List state survives switching clients:** search and sort stay in the URL through walks and clicks; the list pane is the same element before and after (its scroll position is kept) | component | same |
| T15 | **Each profile starts fresh:** walking to another client remounts the profile (route `remountDeps`); resizing does not | component | same |
| T16 | ClientsPage: existing MUT-7 and MUT-83 behaviour unchanged with `useClientsSearch` stood in by an in-memory model; the sort and search are written through it; a row click keeps the list's search; rows carry `data-client-id` (muted rows don't); the open client's link has `aria-current="page"` | component | `src/pages/clients/__tests__/ClientsPage.test.tsx` |
| T17 | ClientDetailPage renders no top bar of its own; its sections are unchanged | component | `src/pages/clients/__tests__/ClientDetailPage.test.tsx` |
| T18 | i18n: the `clients.split.*` keys exist in en and ar; the announcement keeps `{name}` | unit | `src/lib/i18n/__tests__/clientsSplitKeys.test.ts` |
| T19 | **e2e (not written, TD-067; now a `qa/` feature):** at 1280 px, a click opens the profile beside the list; ↓/↑ walk with the URL and `aria-current` following; Enter/Escape and →/← move focus between the panes; the status line names the client; Back from a walk returns to the full list; a deep link with `?sort=name` opens both panes sorted; resizing to 375 px and back keeps a value typed in the profile; in Arabic the list sits on the right and ← moves into the profile; axe on the split view adds no rule | e2e | `qa/specs/web/clients.spec.ts` (`web.clients.split-view`, `-deep-link`, `-resize`, `-rtl`) |

## Edge cases

- The open client is not in the list (a search hides it, or it has no entry in this business): no row is marked; Escape falls back to the first client row, then the search box (T11 covers the fallback through the helper).
- A deep link to a missing client: the top bar says "Client not found" and the pane shows the not-found state; the list still walks.
- ↑ on the first client and ↓ on the last do nothing and don't scroll the page (T10).
- A muted row is reachable by Tab and opens `/income` with Enter, in every arrangement (MUT-83's tests stay green).
- Escape with a ⋯ menu open inside the profile closes the menu only (T5 via `aria-expanded`/`role=menu`).
- A drawer opened from the profile renders in `AppShell`, outside the pane, so its keys never reach the pane's handler.
- Existing e2e specs that open a client (`accessibility.spec.ts` "Client profile", `income-fast-path.spec.ts`) run at 1280 px and so now run against the split view; they must stay green.
