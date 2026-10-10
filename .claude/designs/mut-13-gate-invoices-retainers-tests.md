# Test Plan — MUT-13: Gate invoices/documents and retainers

Companion to `mut-13-gate-invoices-retainers.md`. Vitest + jsdom + fake-indexeddb; settings injected through the repository seam (`setRepositories`) as in the MUT-12 tests. Written first (TDD).

## 1. Route guard — `src/lib/features/__tests__/routeGuard.test.ts`

| Case | Expect |
|---|---|
| `requireFeature('invoices')` with flags off | the returned `beforeLoad` **throws** a TanStack redirect (`isRedirect(err)`), `to: '/'` |
| flags on | resolves without throwing |
| custom target `requireFeature('retainers', '/clients')` | redirect `to: '/clients'` |
| settings row without `features` (pre-v20) | treated as off → redirect |

## 2. Router wiring — `src/__tests__/router.gates.test.ts`

Imports `router` and asserts, by route id/path, that the five gated routes carry a `beforeLoad` and the ungated ones (`/income`, `/clients`, `/settings`) do not. (Cheap structural proof that nobody drops a guard; behaviour is proven in §1.)

## 3. Sidebar — `src/components/layout/__tests__/SidebarNav.features.test.tsx`

Mock `@tanstack/react-router` (`Link`, `useNavigate`, `useRouterState`) as the page tests do; `LanguageProvider`; seam settings.

| Case | Expect |
|---|---|
| both off | no `nav.sections.optional` header; no Documents / Retainers link; core items unchanged |
| invoices on | optional section with **Documents** only |
| both on | Documents and Retainers, in that order |
| toggle via `useSetFeatureEnabled` while mounted | entry appears without remount |
| collapsed mode | entries render with `title` tooltips like core items |

## 4. Client profile — extend `src/pages/clients/__tests__/ClientDetailPage.test.tsx`

| Case | Expect |
|---|---|
| invoices off | receivables/transactions row menus contain no "Generate invoice" / "View invoice" |
| invoices on, income row without linked document | "Generate invoice" present; click → `openDocumentDrawer` called with `{ mode: 'create', defaultType: 'invoice' (unpaid) / 'receipt' (paid), defaultClientId }` |
| invoices on, row with `linkedDocumentId` | "View invoice" present; click → navigate to `/documents/$documentId` |
| retainers off | no retainers card on Summary |
| retainers on, client has two retainers | card lists both with status and next date; "New retainer" → `openRetainerDrawer({ mode: 'create', defaultClientId })`; "View all" navigates to `/retainers` with `clientId` search |
| retainers on, none | empty copy + "New retainer" |

## 5. Locked income entry — `src/components/drawers/__tests__/IncomeDrawer.locked.test.tsx`

Seam settings + a locked transaction via the real Dexie repositories (`lockedAt`, `lockedByDocumentId`), document row present.

| Case | Expect |
|---|---|
| locked, invoices **off** | notice with the document number and the "turn on Invoices in Settings" sentence; Save and Delete disabled; no "View document" link |
| locked, invoices **on** | notice with a "View document" action; clicking navigates to `/documents/<id>` and closes the drawer |
| unlocked | no notice; Save enabled |
| locked, submit forced (fireEvent submit) | no `update` call reaches the repository (button disabled → form not submitted) |
| repository contract (existing `transactionRepo.test.ts:402`) | still throws `TransactionLockedError` regardless of flags — reused, not duplicated |

## 6. Home — extend `src/components/home/__tests__/AttentionFeed.test.tsx`

| Case | Expect |
|---|---|
| retainers off | `useGuidance` called with `includeProjectedRetainer: false` |
| retainers on | `true` (today's behaviour) |

## 7. Data safety and auto-enable — `src/lib/features/__tests__/gatingDataSafety.test.ts`

| Case | Expect |
|---|---|
| seed 2 documents, a document sequence at N, 1 retainer; flip invoices and retainers off → on → off through `settingsRepo` | counts unchanged; next sequence number still N+1; `retainerRepo.get` still returns the retainer |
| database with one document and no flags, after `reconcileFeaturesWithData(db)` | `readFeatureFlags()` gives `invoices: true` and `requireFeature('invoices')()` does **not** throw (AC 5 end to end) |

## 8. Gates

`npm run lint`, `npx tsc --noEmit -p tsconfig.app.json`, `npx vitest run` (baseline: 2,088 pass, 18 pre-existing MUT-20 failures), `npm run build`.
