# MUT-89 test plan: "All businesses" lens

Brief: `mut-89-all-businesses-lens.md` (O1–O7, eng review D1–D8). Run under Node 22: `npx vitest run <files>`. Tests are written first.

## By acceptance criterion

| AC | Proven by |
|---|---|
| AC1: "All businesses" appears only with 2+ businesses (and only on Home and Clients, O2) | `useActiveProfile.test.tsx` (`showAllProfilesOption`); `ProfileSwitcher.test.tsx` (the option on `/`, absent with 1 business or on `/income`) |
| AC2: Home and Clients aggregate per currency, with tags | `clientOwedIndex.test.ts` (array scope: totals, `profileIds`, per-business muted rows, O3 exclusions); `paymentRecords.test.ts` (`listRecent` scope + `profileId`); `OverviewPage.test.tsx` and `HomeNeedsAttention.test.tsx` (tags in All only); `ClientsPage.test.tsx` (two tags on a shared client, no cross-profile badges, per-business muted row click) |
| AC3: every other area gets a concrete business | `useActiveProfile.test.tsx` (`activeProfileId` / `useProfileFilter` never `'all'` or a list); `allBusinessesLens.test.tsx` (memory router: lens on at `/`, `/income` receives the working id, back at `/` All returns); `AppShell.gate.test.tsx` (no page mounts while businesses load, D8) |
| AC4: the Income drawer requires a business from All | `IncomeDrawer.test.tsx` (lens + owed screen: the field is up front, empty, and save is blocked; `defaultProfileId` prefills; lens on but off an owed screen prefills the working business) |
| AC5: ADR-051 | knowledge files |
| AC6: tests cover aggregation, tags, fallback and the drawer | all of the above |

## By eng-review decision

- **D1:** `router.owedLens.test.ts`. On the real route tree, `/` and `/clients` carry `staticData.owedLens`; `/income`, `/settings` and `/expenses` do not. `/clients/$clientId` inherits the tag through its layout.
- **D2:** `OverviewPage.test.tsx`. While businesses load there is no empty state and no onboarding.
- **D3:** `useActiveProfile.test.tsx`. `useOwedLens` reports All with `onOwedScreen` false. `OverviewPage.test.tsx`: with the lens persisted, Home's first render asks for the All scope.
- **D4:** `useActiveProfile.test.tsx`. With zero businesses the scope is `''` and the lens is off.
- **D5:** `useActiveProfile.test.tsx`. The auto-correct calls `setWorkingProfile`. `profileStore.test.ts`: the legacy `'all'` migrates to the lens being on.
- **D6:** `profileStore.test.ts` / `useActiveProfile.test.tsx`. `setAllBusinesses` exists, and `setActiveProfile` turns the lens off. `:173` is deleted.
- **D7:** the existing Home mocks move to `useOwedLens`. The ADR-055 one-query assertion also runs in All.
- **D8:** `AppShell.gate.test.tsx`. Pages mount only after businesses resolve. This is one root gate (owner's choice during the build, replacing per-page gates).

## Store (`profileStore.test.ts`, rewritten)

- Initial state: `''`, lens off, not on an owed screen.
- `setActiveProfile` sets the id and turns the lens off.
- `setWorkingProfile` sets the id and keeps the lens.
- `setAllBusinesses` toggles the lens.
- `reset` clears the id and the lens.
- `partialize` drops `onOwedScreen`.
- `migrate` from v0: `'all'` becomes the lens on with an empty id; a concrete id stays and the lens is off.

## Regression contract (D7)

- Every existing case in OverviewPage, HomeNeedsAttention, ClientsPage, clientOwedIndex and IncomeDrawer stays green.
- Intentional changes:
  - `useActiveProfile.test:114` is rewritten (the option shows on owed screens only);
  - `:124` is rewritten (the legacy `'all'` → lens on, working = default);
  - `:173` is deleted.

## Gate

`npx vitest run`, `npm run typecheck`, `npx tsc -b`, `npm run lint` (0 errors), `npm run test:bundles`. Then a browser check on the preview: two businesses, both screens, the switcher, the Income fallback, the drawer, and Arabic RTL.
