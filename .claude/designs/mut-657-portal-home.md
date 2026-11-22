# MUT-657 — Portal home: receipts and what is waiting first, In & out behind a switch

Plan: `~/.gstack/projects/vAWK3-mutaba3a/mut-657-plan.md` (eng review folded in). Wireframe: `.claude/designs/portal-home-hub.html`, **concept 2 "Two lanes"** (Basel, 2026-11-22); `.claude/designs/portal-home.html` shows In & out. Decision: ADR-269 (addendum to ADR-192).

## Problem and acceptance criteria
The portal opened on Owed, a page of totals. Most visits are to file a receipt, record income or see who is late.
1. Opening the portal and switching profile land on home.
2. Home shows no totals; receipt cards show vendor, date and status.
3. Dropping or picking receipts lands them in To review with the existing rules and messages.
4. What is waiting shows with counts and links, each group hidden at 0 (To invoice waits for MUT-648).
5. In & out: received, owed and overdue, spent by category, this month, per currency, with links on.
6. Coming back to home opens Receipts & to-dos; `?view=in-out` is In & out's address.
7. Every existing link still works.
8. The four QA flows pass.

## Solution
- Routes: home at `/p/:id` (`parseHome`), Owed's overview at `/p/:id/owed`; a bare `?currency=` redirects to `/owed` keeping the shell keys (`legacyOwedSearch`, `replace: true`). The pill starts with Home (an icon on a phone). `switchTarget` returns home.
- `HomePage` → `HomeViewSwitch` (aria-pressed pair) → `HomeTodo` | `HomeInOut`; `LandingNotices` under the header; `IncomeDrawerHost` for Add income (`?newIncome=received`, or owed where that is the only kind).
- `HomeTodo` ("Two lanes", one column at 760 px, Add first in reading order, mirrored in RTL):
  - Add lane (`<section>` named "Add"): `ReceiptDropZone` (drop zone hidden on a phone, Add receipt, Take a photo under `(pointer: coarse)` with `accept="image/jpeg,image/png" capture="environment"`), all behind `useWriteGate().writable` and the library being on; Add income behind `incomeAffordancesFor`.
  - Waiting lane (`<section>` "Waiting for you"): `ToReviewGroup` (`useReceipts(…, 'to_review', 8)`, count from `useReceiptCounts`), `OverdueGroup` (up to 3 of `overdueClients(summary)`, names from the customer directory, "N days late", no amounts). Each hidden at 0; all 0 → "Nothing needs you right now." The To invoice slot is a `TODO(blocked-by MUT-648 + not-for-invoice flag)`.
  - Library off (signed out, or the flag off): the receipt parts give way to `ReceiptsUnavailable` (plus Sign in, signed out); Clients overdue still works.
- `HomeInOut`: `useOrganizationSummary` (owed, overdue now) + `useReportActivity([profile], periodRange('month', today), 'day')` (received, spent, byCategory; Reports' own cache entry). Currency in component state. Category names from `useNameDirectories` (archived included).
- `useReceiptFiles` lifts the gallery's `onFiles` (checkReceiptFile, useUploadReceipts, uploadErrorOf) with `onLanded`; the gallery uses it to leave Filed.

## API contracts and error states
No API change. Reads: receipt counts (404/503 = library off), receipts list (`limit=8`), org summary, activity (this month). Summary failure → `Unreachable` with Retry in the Waiting lane; activity or summary failure → `Unreachable` on In & out. Upload errors are the gallery's toasts. Server: the monthly summary mail's link gains `?view=in-out`.

## Reuse
`ReceiptCard` (+ `showAmount`), `ReceiptsUnavailable`, `IncomeDrawerHost`, `SegmentedTabs`, `DecimalAmount`, `useReportActivity`, `useNameDirectories`, `Skeleton` / `Unreachable`, `HomeIcon` (generated set).

## Impact
Bare-path links (mail, Stripe returns, phone Recent row, first run) land on home. Owed's old address keeps working through the redirect. PostHog's bare-path page views now mean home.

## i18n
`hosted.home.*` and `hosted.destinations.home` in en and ar (MSA; plurals through `tp()`: zero/one/two/few/many/other in Arabic). Names `dir="auto"`, amounts `<bdi>`.

## Cost
Receipts & to-dos: three reads (counts, org summary shared with Owed, To review page of 8) plus the cached directory. In & out: one more (activity, shared with Reports). Nothing new in local mode.

## QA scenarios
- **portal.home.waiting** (core): sign in at `/` → home, Home lit first in the pill; the Add lane has Drop receipts here, Add receipt and Add income; To review shows 2 cards; Clients overdue shows Client 2 (12 days late) then Client 1 (5 days late); no amount on the page; a receipt opens its review page; a client opens its page; See all opens Owed at `/owed`.
- **portal.home.clear**: nothing waiting → "Nothing needs you right now." and no group; `/p/:id?currency=USD` lands on `/p/:id/owed?currency=USD` with the USD block.
- **portal.home.upload**: a text file is refused with its name and nothing is sent; a PNG is started, PUT and completed, "1 receipt added to To review" and To review counts 2; a dropped PDF lands and To review counts 3.
- **portal.home.in-out**: In & out puts `?view=in-out` in the address; Money in shows this month's received with owed and overdue now; Money out shows spent with Rent then Food; USD switches the figures with no currency in the address; leaving and coming back with Home opens Receipts & to-dos; the mail's link opens In & out with Open Owed, Open Spent and Compare months in Reports.
