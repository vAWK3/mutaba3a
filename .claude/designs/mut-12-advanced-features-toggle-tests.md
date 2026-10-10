# Test Plan — MUT-12: Per-feature Advanced toggle

Companion to `mut-12-advanced-features-toggle.md`. Vitest + jsdom + fake-indexeddb (`src/test/setup.ts`). Written before the code (TDD); each file below starts red.

## 0. Eng-review findings folded in (2026-10-10)

- **A2 (P1):** restore/import paths rewrite the settings row from a pre-v20 file → §3b covers `reconcileFeaturesWithData()`.
- **A1 / D10:** modules are `features.ts` (pure, incl. probes and reconcile) and `useFeatures.ts`; file names below follow.
- **A3:** §8 adds the StrictMode double-effect case.
- **C1:** `DEFAULT_SETTINGS` constant is asserted equal in `seed` and `settingsRepo` defaults (§3).
- **C3:** §2 asserts `insights` is never produced by the probes.

## 1. Unit — `src/lib/features/__tests__/features.test.ts`

| Case | Expect |
|---|---|
| `DEFAULT_FEATURES` | every key in `FEATURE_KEYS` is `false`; no extra keys |
| `resolveFeatures(undefined)` / `(null)` / `({})` | equals `DEFAULT_FEATURES` |
| `resolveFeatures({ projects: true })` | projects true, all others false |
| `resolveFeatures({ bogus: true } as any)` | unknown key dropped; result has exactly `FEATURE_KEYS` |
| `resolveFeatures({ expenses: 'yes' } as any)` | non-boolean coerced to `false` (never truthy by accident) |
| `withFeature(flags, 'expenses', true)` | new object with only that key changed; input untouched |
| `FEATURE_KEYS` snapshot | `['invoices','retainers','expenses','insights','planning','suppliers','projects']` — guards MUT-13/14/16 against silent renames |

## 2. Unit — `src/lib/features/__tests__/featureDataProbes.test.ts`

Uses the singleton `db` as the `TableReader` and inside `db.transaction('r', [...], tx => detectFeaturesWithData(tx))`.

| Seed | Expect |
|---|---|
| empty tables | `[]` |
| one live `documents` row | `['invoices']` |
| one `documents` row with `deletedAt` | `[]` |
| one `projects` row live + one `expenses` row deleted | `['projects']` |
| rows in `retainerAgreements`, `plans`, `vendors` | `['retainers','planning','suppliers']` in `FEATURE_KEYS` order |
| anything at all | never contains `insights` |
| same seed via `db` and via a `Transaction` | identical result |

## 3. Repository — extend `src/db/__tests__/settingsRepo.test.ts`

| Case | Expect |
|---|---|
| `get()` with no row | `features` equals `DEFAULT_FEATURES`; `featureNotice` undefined; equals `DEFAULT_SETTINGS` + resolved features |
| `get()` with a stored row lacking `features` (pre-v20 shape) | resolved defaults, other fields intact |
| `update({ features: { projects: true } })` then `get()` | projects true, currencies preserved (persistence AC 4) |
| `update({ featureNotice: undefined })` | clears the notice, leaves `features` |
| `seed.ts` default row | deep-equals `DEFAULT_SETTINGS` (one constant, two callers) |

## 3b. Reconcile after restore / import — `src/lib/features/__tests__/reconcile.test.ts` + extend `src/components/modals/__tests__/ImportExportModals.test.tsx`

| Case | Expect |
|---|---|
| settings row `{ features: {} }`, one live project in `db` | `reconcileFeaturesWithData(db)` → `features.projects === true`, `featureNotice` = `['projects']` |
| settings row with `expenses: false` set by the user, expenses rows present | enabling-only by data presence: `expenses: true` and noticed (documented: data you just imported is shown) |
| flags already true, data present | no write (row deep-equal before/after), no new notice |
| pending notice `['invoices']`, projects newly enabled | notice becomes `['invoices','projects']` (merged, ordered, no duplicates) |
| no settings row | row created from `DEFAULT_SETTINGS` + enabled flags |
| `restoreFromBackup` with a v19-shaped backup containing documents | returns `true` and afterwards `settingsRepo.get().features.invoices === true` |
| `restoreFromBackup` when reconcile throws (mocked) | still returns `true`; error logged once |
| legacy import in `ImportDataModal` with projects + old settings row | reconcile called once after `bulkAdd`; projects enabled |

## 4. Migration — `src/db/__tests__/migration-v20.test.ts`

Opens a throwaway Dexie under a unique name declaring the **v19** schema (tables used by the probes + `settings`), seeds rows, closes it, then opens `new MiniCrmDatabase(sameName)` and reads `settings`.

| Scenario | Expect |
|---|---|
| v19 DB with 2 live projects and 1 live document, settings row present | `features.projects` and `features.invoices` true; the rest false; `featureNotice` = `['invoices','projects']`; `enabledCurrencies`/`defaultCurrency` unchanged; `db.verno === 20` |
| v19 DB with data but **no** settings row | row created with defaults + the enabled flags + notice |
| v19 DB with no optional data | settings row untouched (deep-equal before/after); no `featureNotice` |
| fresh `MiniCrmDatabase(uniqueName)` | `verno === 20`; a read gives all-false; no notice (AC 1) |
| existing singleton `db` | `db.verno === 20`; `settings.schema.primKey.name === 'id'` (no index change) |

## 5. Hooks — `src/lib/features/__tests__/useFeatures.test.tsx`

Wrap in `QueryClientProvider`; inject a fake settings repo through `setRepositories` (repository seam, `provider.test.ts` pattern); `resetRepositories` after each.

| Case | Expect |
|---|---|
| repo returns no `features` | `useFeatureEnabled('expenses')` → `false` after load (and `false` while loading) |
| repo returns `{ expenses: true }` | `true` |
| `useSetFeatureEnabled().mutate({ key: 'expenses', enabled: true })` | repo `update` called with the **full** resolved map (`expenses: true`, others false); after invalidation `useFeatureEnabled('expenses')` re-renders `true` (immediate effect, AC 3) |
| `useFeatureFlags()` | returns the resolved map, referentially stable between renders with the same data |
| `useFeatureNotice()` with `featureNotice: ['projects']` | exposes it; `dismiss()` calls `update({ featureNotice: undefined })` and invalidates |
| `readFeatureFlags()` | resolves from the injected repo without React |

## 6. Component — `src/components/ui/__tests__/Switch.test.tsx`

| Case | Expect |
|---|---|
| render checked / unchecked | `role="switch"`, `aria-checked` mirrors, label associated via `aria-labelledby` |
| click, Space, Enter | `onChange(!checked)` once each |
| `disabled` | no `onChange`, `aria-disabled` |

## 7. Page — `src/pages/settings/__tests__/SettingsPage.features.test.tsx` (new)

| Case | Expect |
|---|---|
| section renders | heading `settings.features.title`, seven switches in `FEATURE_KEYS` order, all unchecked with default settings |
| click "Projects" switch | settings repo `update` receives `features.projects === true`; switch reflects after invalidation |
| i18n parity | every `settings.features.*` key present in both `en.json` and `ar.json` |

## 8. Shell — `src/components/layout/__tests__/AppShell.featureNotice.test.tsx`

| Case | Expect |
|---|---|
| settings carry `featureNotice: ['invoices','projects']` | exactly one toast with `settings.features.autoEnabledToast`; `update({ featureNotice: undefined })` called once; re-render (StrictMode double effect) shows no second toast |
| no notice | no toast, no update call |

## 9. Data-safety check (AC 7)

`src/lib/features/__tests__/toggleNeverDeletes.test.ts`: seed one row in each probed table through the real repositories, flip every flag off and on via `settingsRepo`, assert row counts unchanged. (Hiding is MUT-13/16's job; this proves the switchboard itself is inert on data.)

## 10. Gates

`npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run build` — all green before the ticket is called done. Coverage target: 100% on `src/lib/features/*` (critical logic), ≥80% elsewhere touched.
