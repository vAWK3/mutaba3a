# Design Brief — MUT-13: Gate invoices/documents and retainers behind the Advanced toggle

- **Date:** 2026-10-10
- **Epic:** MUT-2 "Strip to the core: delete dead surface, gate the optional"
- **Blocked by:** MUT-12 — built on this branch (commit 8fab72a, ADR-032), not yet merged; this ticket consumes `useFeatureEnabled` / `useFeatureFlags` / `readFeatureFlags` from it.
- **Related:** MUT-15 (sidebar simplification: owns the final shape of the secondary nav group and the `+ Add` menu), MUT-16 (gates insights/planning/projects with the same guard).
- **Worktree:** `.claude/worktrees/mut-2-strip-core`, branch `feature/mut-2-strip-core`.
- **Status:** planned 2026-10-10; outside-voice review folded in (§9); building under the owner's standing instruction (MUT-12 → 13 → 14 → 16).

---

## 1. Problem and acceptance criteria

`/documents*` (4 routes, 4,385 LOC) and `/retainers` (581 + 980 LOC) are reachable by URL but have no sidebar entry; the intake kept both as optional. With MUT-12's switches in place, this ticket makes them *gated*: invisible and unreachable when off, present with their entry points when on, and never able to weaken the document lock on transactions.

Acceptance criteria (ticket):

1. Both toggles off → neither area in the sidebar; their routes redirect to home **without rendering**.
2. A toggle on → that area's sidebar entry and client-profile entry points appear immediately.
3. A transaction locked by an exported document stays locked and uneditable when invoices are off, and the UI **explains why** rather than failing silently.
4. Toggling never deletes or orphans documents or retainers.
5. An install with documents or retainers gets the toggle auto-enabled on upgrade.
6. Document sequence numbering is unaffected by toggling.
7. Tests: off-state routing, on-state entry points, locked-transaction behaviour with the feature off, auto-enable on existing data.

What exists today (verified): the lock is enforced in the repository only (`repository.ts:353` throws `TransactionLockedError` on any non-archive update); the income drawer has **no** locked-state UI — a save on a locked entry fails with a generic toast from `useMutationWithFeedback.ts:81` ("Unlock the document first") that assumes the user can reach documents. The client profile has **no** invoice or retainer entry point at all; the only "Generate invoice" action lives on the legacy `/transactions` page (`TransactionsPage.tsx:258`), which redirects to `/income`. AC 5 is already delivered by MUT-12 (`documents` and `retainerAgreements` probes) and only needs the gate to read the flag.

## 2. Where it lives

| Concern | File | Notes |
|---|---|---|
| Route guard | `src/lib/features/routeGuard.ts` (new) — `requireFeature(key, to = '/')` returns a `beforeLoad` | One helper for MUT-13 and MUT-16; `readFeatureFlags()` then `throw redirect({ to })`. Runs before the lazy page module is requested, so nothing renders and nothing is bundled into the initial chunk |
| Routes | `src/router.tsx` — `beforeLoad: requireFeature('invoices')` on `/documents`, `/documents/new`, `/documents/$documentId`, `/documents/$documentId/edit`; `requireFeature('retainers')` on `/retainers` | Components stay `lazyPage(...)` |
| Sidebar | `src/components/layout/SidebarNav.tsx` — a secondary section `optional` rendered after `workspace`, containing `/documents` (invoices on) and `/retainers` (retainers on); hidden when empty | Core sections untouched; MUT-15 reshapes the whole nav later and MUT-16 adds its entries to the same section. `nav.sections.optional` new key |
| Client profile — invoices | `src/pages/clients/ClientDetailPage.tsx` receivables and transactions tabs: `RowActionsMenu` gains **Generate invoice** (income, no linked document) / **View invoice** (linked) when invoices is on | Mirrors the legacy `/transactions` action: `openDocumentDrawer({ mode: 'create', defaultType: paid ? 'receipt' : 'invoice', defaultClientId })`; view navigates to `/documents/$documentId` |
| Client profile — retainers | `src/components/clients/ClientRetainersCard.tsx` (new), rendered on the Summary tab when retainers is on | `useRetainers({ clientId })`: status badge, next expected date, due now; **New retainer** → `openRetainerDrawer({ mode: 'create', defaultClientId })`; **View all** → `/retainers?clientId=` |
| Locked income entry | `src/components/drawers/IncomeDrawer.tsx` — when `existingTx.lockedAt`: a notice at the top of the form, Save and Delete disabled | Copy names the document number when loadable (`useDocument(lockedByDocumentId)`); with invoices **on** the notice links to the document; with invoices **off** it says to turn Invoices on in Settings › Advanced features. The repository guard stays the source of truth |
| Home | `src/components/home/AttentionFeed.tsx` — `includeProjectedRetainer: flags.retainers` | With retainers off, no retainer guidance items (whose only action is `navigate('/retainers')`, which would now bounce to home) |
| i18n | `nav.sections.optional`, `clients.detail.retainers.*`, `drawer.income.locked.*` in en + ar | Existing: `nav.documents`, `nav.retainers`, `transactions.generateInvoice`, `transactions.viewInvoice`, `retainers.status.*` |

## 3. Behaviour

```
URL /documents/… or /retainers
  └─ beforeLoad: requireFeature(key)
       ├─ readFeatureFlags()  (Dexie read; waits for open/upgrade)
       ├─ flag on  → continue → lazy page loads
       └─ flag off → throw redirect({ to: '/' })   (no render, no chunk)

SidebarNav                                   ClientDetailPage
  flags = useFeatureFlags()                    invoices on → row actions: Generate / View invoice
  optional section = [documents?, retainers?]  retainers on → ClientRetainersCard on Summary
  (hidden when both off)                      (both read useFeatureEnabled; re-render on toggle)

IncomeDrawer (edit, tx.lockedAt)
  ├─ notice: "Locked by document {number}. Only archiving is possible."
  │    ├─ invoices on  → [View document] → closes drawer, navigates to /documents/$id
  │    └─ invoices off → "Turn on Invoices in Settings › Advanced features to open it."
  └─ Save + Delete disabled; repository still refuses any non-archive update (unchanged)
```

- Immediate effect (AC 2): every consumer reads the TanStack `['settings']` cache that `useSetFeatureEnabled` invalidates; the guard reads Dexie on each navigation.
- Nothing is written to `documents`, `documentSequences` or `retainerAgreements` by any toggle (AC 4, 6): the flag lives on the settings row only; a test flips both flags on/off/on and asserts counts and the next sequence number.
- Auto-enable (AC 5) is MUT-12's v20 upgrade + reconcile; this ticket adds the end-to-end assertion that a database with a document resolves `invoices: true` and the guard then admits `/documents`.

## 4. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | One `requireFeature()` helper, not per-route closures | MUT-16 needs the same for five routes; one test proves the redirect contract |
| D2 | Redirect target is `/` (home) for every gated route, no `?reason=` query | Ticket says "redirect to home"; a flashless bounce needs no explanation UI; MUT-16 may add a toast later if wanted |
| D3 | Sidebar gets an `optional` section now, with only the two entries | Smallest change that satisfies AC 1/2; MUT-15 decides the final grouping and ordering and MUT-16 appends. Avoids editing the core sections twice |
| D4 | Client-profile invoice actions mirror the legacy `/transactions` menu and open the existing `DocumentDrawer` | Reuse over new UI; the drawer already prefills type and client. Linking the created document back to the income entry is the drawer's existing behaviour (or not) and out of scope |
| D5 | `ClientRetainersCard` is a new small component, read-only plus two actions | The Summary tab has no retainer surface; a card beside "Recent activity" is the lightest entry point; no new repository method (`useRetainers({ clientId })` exists) |
| D6 | Locked notice in the drawer, with Save and Delete disabled; the repository guard is unchanged | AC 3 "explains why rather than failing silently": today the explanation only appears after a failed save. Disabling prevents the failure; the notice explains it; the repository still refuses so nothing depends on the UI |
| D7 | With retainers off, the home attention feed excludes projected-retainer items | Their only action navigates to `/retainers`, which would now bounce; data is untouched |
| D8 | `AttentionFeed`, `SidebarNav`, `ClientDetailPage` read flags through hooks; no prop drilling | Pattern from ADR-032 §4 |

## 5. Reuse, impact, i18n, cost

- **Reuse:** `readFeatureFlags`, `useFeatureFlags`, `useFeatureEnabled` (MUT-12); `RowActionsMenu`, `Badge`, `openDocumentDrawer`, `openRetainerDrawer`, `useRetainers`, `useDocument`, existing nav rendering, `redirect` from TanStack Router.
- **Impact:** no schema change, no repository change; `router.tsx` gains `beforeLoad` on five routes; `SidebarNav` gains one computed section; `ClientDetailPage` gains menu items and one card; `IncomeDrawer` gains one notice block. `TransactionsPage` (legacy) left as is — it is unreachable (`/transactions` redirects).
- **i18n:** all new copy keyed in en + ar; RTL unaffected (reuses existing row/menu/card patterns).
- **Cost:** one extra Dexie row read per gated navigation; the client page adds one `useRetainers` query only when retainers is on.
- **Out of scope (ticket):** deleting either area; redesigning templates or the retainer model; document numbering changes; the `+ Add` menu (MUT-15).

## 6. Risks

- **R1 — `beforeLoad` is async**: first navigation to a gated route waits on the Dexie read (sub-millisecond after open; up to the upgrade time on the first launch). No pending UI is added; the existing `PageLoader` covers the lazy chunk only. Acceptable for a redirect gate; noted for MUT-16.
- **R2 — Sidebar flash**: `useFeatureFlags()` is `false` until settings load, so the optional section appears a frame after the core nav. Accepted (MUT-12 D5).
- **R3 — Sibling tickets touching `ClientDetailPage`** (MUT-6 work on `main`): keep this ticket's edits to the two `RowActionsMenu` arrays and one card insertion so a merge is mechanical.

## 7. Build order

1. `routeGuard.ts` + unit test (seam-injected settings; expect a thrown redirect to `/` when off, no throw when on).
2. `router.tsx` guards (5 routes).
3. `SidebarNav` optional section + test (mocked router `Link`, seam settings: both off → no section; invoices on → Documents only; both on → both; toggling re-renders).
4. `ClientDetailPage` invoice actions + `ClientRetainersCard` + tests (extend `ClientDetailPage.test.tsx` mocks: flags off → no actions/card; on → present; actions call the drawer store).
5. `IncomeDrawer` locked notice + test (locked tx, invoices off → notice text + disabled Save/Delete; invoices on → link; unlocked → nothing).
6. `AttentionFeed` flag + test row.
7. Data-safety test (toggle on/off/on leaves documents, sequences, retainers intact) and the auto-enable end-to-end assertion.
8. Knowledge files: CHANGELOG, COMPONENT_REGISTRY (ClientRetainersCard; `requireFeature` in PATTERNS), TEST_PLAN, DECISIONS (ADR-032 addendum: gating pattern), SYSTEM_OVERVIEW feature map.
9. `npm run lint && npx tsc --noEmit -p tsconfig.app.json && npx vitest run && npm run build`.

## Business / product impact
- The two biggest "why is this here?" areas disappear for new users and reappear, with real entry points, for the users who have invoices or retainers — the first visible step of the strip-down after the switchboard.
- The document lock becomes understandable instead of a failed save, which protects the trust property the intake called out (users not finding or not understanding their data).
- Establishes the guard + optional-section pattern MUT-16 reuses for four more areas.

## 8. Engineering review (condensed, 2026-10-10)

- **Scope:** 3 new files (`routeGuard.ts`, `ClientRetainersCard.tsx`, tests), 6 modified. Arrangement accepted as-is.
- **A1 [P2] (8/10)** `src/components/home/AttentionFeed.tsx:49,57` hardcode `includeProjectedRetainer: true` — with retainers off, items would deep-link to a bouncing route. Resolved: D7.
- **A2 [P2] (8/10)** `src/hooks/useMutationWithFeedback.ts:81` — the only lock explanation today is a post-failure toast that says "Unlock the document first", wrong advice when invoices is off. Resolved: D6 (notice before the attempt; copy depends on the flag). The toast stays as the last line of defence.
- **C1 [P3] (7/10)** The legacy `/transactions` page keeps its own "Generate invoice" item ungated. Not reachable (route redirects); left alone, noted in TECH_DEBT as part of the eventual `TransactionsPage` deletion (MUT-2 later).
- **Tests:** the drawer and sidebar have no tests today; both get them. Repository lock tests exist (`transactionRepo.test.ts:402`) and are reused, not duplicated.
- **Performance:** no finding.

## 9. Outside voice (native Plan subagent; Codex not installed, so not outside coverage in gstack's sense)

The reviewer verified: `beforeLoad` runs before the loader phase and `loadRouteChunk` only preloads the lazy component, so a redirect never requests the chunk; every `useFeatureFlags` consumer sits under `QueryClientProvider`; no other surface deep-links to `/documents` or `/retainers`; `retainerRepository.list` honours `clientId`. Eleven findings:

| # | Sev | Finding | Disposition |
|---|---|---|---|
| F1 | High | `softDelete` had no lock check — the disabled Delete button was the only guard; `markPaid` / payments bypass the lock on purpose; the notice promised "archive" though no archive UI exists | **Accepted:** `transactionRepo.softDelete` now throws `TransactionLockedError` (test added beside the update-lock test); notice copy says details can't change *here* and payments can still be recorded from the client page; the lock contract is: details immutable, payments allowed, delete refused, archive allowed |
| F2 | High | "Generate invoice" opened the drawer without linking the entry; "View invoice" would never appear afterwards | **Accepted:** `openDocumentDrawer({ linkTransactionId })`; `DocumentDrawer` prefills currency, client and one line from the entry and calls `documents.linkTransactions` after create, then invalidates the transaction queries — the row flips to View invoice |
| F3 | Med | A forced form submit bypassed the disabled button | **Accepted:** `onSubmit` returns early while locked; test added |
| F4 | Med | `router.gates.test` would fail on `__BUILD_MODE__` | **Already handled:** the test stubs the global before importing the router; passes |
| F5 | Med | Sidebar test must mock `useLocation` and `useCheckForUpdates` (network) | **Already handled:** both mocked; passes |
| F6 | Med | `PredictiveKpiStrip` still counted projected retainer income with retainers off | **Accepted:** the strip reads `useFeatureEnabled('retainers')` like the feed |
| F7 | Med | A gated route starts pending → blank first paint on reload/deep link | **Accepted:** `defaultPendingComponent: PageLoader` on `createRouter` |
| F8 | Low | Separate `optionalItems` list and a duplicated document icon | **Partly:** the sidebar reuses `components/icons` `DocumentIcon`; the explicit list stays (MUT-16 appends two lines; MUT-15 reshapes anyway) |
| F9 | Low | Data-safety and pre-v20 tests are near-tautological | **Kept:** cheap, and they pin the contract the ticket names |
| F10 | Low | Client page test mocks needed more than "extend" | **Done** as part of the build |
| F11 | Low | The fallback toast said "Unlock the document first" regardless of the flag | **Accepted:** copy is now flag-neutral ("its details can't change") |

## 10. Downstream notes
- MUT-15: the "More" section and `optionalItems` are the seam to reshape; the `+ Add` menu is untouched here.
- MUT-16: add `{ path, labelKey, icon, feature }` rows to `optionalItems` and `requireFeature('<key>')` to the routes; `PredictiveKpiStrip` / `AttentionFeed` show the pattern for home surfaces.
- TD-025 (legacy `/transactions` page) — delete with the unreachable surface.
