# Test Plan — MUT-73: Retire device-to-device sync and supersede ADR-013

Brief: `mut-73-retire-sync.md`. Epic MUT-2.
Tooling: Vitest + jsdom + fake-indexeddb, Playwright, `cargo test`.
This is a deletion with zero behaviour change on non-sync paths, so TDD here means the guard and the migration test go red first and the deletion turns them green. The tests that pin "same behaviour" stay green throughout.

Every gate command runs with Node 22 first (TD-054):

```bash
export PATH=/Users/basel/.nvm/versions/node/v22.23.1/bin:$PATH;
```

## 0. Baseline (recorded on `2b47bfb`, 2026-10-12, before any change)

| What | Result |
|---|---|
| Vitest on the 14 affected files (all of `src/sync`, `provider`, `useQueries`, `useIncomeQueries`, `tokenStore`, `noDeadMoneyEventModules`, `SettingsPage.a11y`) | 14 files, 295 cases, all green |
| …of which are deleted with their subjects | `hlc` 59, `ops-engine` 32, `syncStore` 37, `synced-transaction-update` 3 = **131** |
| …of which move with OAuth | `oauth-client` 28, `oauth-flow` 18, `oauth-pkce` 18, `cimd-document` 10 = **74** |
| `cargo test` (cold, 1 m 37 s) | 24 passed: OAuth 10, pairing 6, persistence 6, crypto 2 |
| Rust compiler warnings | 12, every one dead code in `src-tauri/src/sync` |
| `cargo clippy` | **not installed** (`rustup component add clippy` needed; see §6) |

Phase 2 re-runs the full suite counts on the branch before deleting anything, following MUT-58's rule to audit the branch you delete from.

## 1. Deletion guard: `src/__tests__/noSyncModules.test.ts` (new, written first)

Same shape as `noDeadMoneyEventModules.test.ts`. It reads files with `node:fs`, so stale `vi.mock` paths that `tsc` can't see are caught too.

| Case | Expect | Red before deletion because |
|---|---|---|
| `src/sync`, `src/components/sync`, `src/hooks/usePairingSession.ts`, `src-tauri/src/sync` (`it.each`) | `existsSync` is false | they exist |
| `src/services/oauth/{oauth-client,oauth-flow,oauth-pkce}.ts` and `src-tauri/src/oauth/{mod,callback}.rs` | exist | not moved yet |
| No file under `src/` (tests included, guard excluded) has an import or `vi.mock` specifier matching `/(^\|\/)sync\//`, `components/sync` or `usePairingSession` | empty offender list | AppShell, SettingsPage, provider, database, tokenStore and 4 tests import sync |
| No file under `src/` names `initializeSync`, `captureOp`, `useSyncStore`, `ISyncedRepositories`, `syncedTransactionRepo`, `syncedPaymentRecordRepo`, `.synced.`, `ConflictBanner`, `PairingModal`, `ExportBundleModal`, `ImportBundleModal`, `SyncSection`, `SyncStatusChip` | empty | the mounts and the 8 call sites |
| `Object.keys(getRepositories())` | `['base']` | `synced` is present |
| `db.tables` names none of `localDevice`, `trustedPeers`, `opLog`, `peerCursors`, `entityFieldMeta`, `moneyEventVersions`, `conflictQueue`, `syncHistory` | true | all 8 are present |
| `src-tauri/src/lib.rs` registers none of the 17 sync commands and does register the 3 OAuth commands | true | the 17 are registered |
| `src-tauri/Cargo.toml` declares none of the 15 removed crates (`mdns-sd`, `ring`, `argon2`, `base64`, `uuid`, `rand`, `hostname`, `chrono`, `thiserror`, `sha2`, `local-ip-address`, `urlencoding`, `axum-server`, `rustls`, `rcgen`), and `package.json` has no `qrcode.react` | true | declared |
| `reconcileFeaturesAfterDataLoad`'s source union has no `'sync'` (text check on `features.ts`) | true | present |

**Flip in `noDeadMoneyEventModules.test.ts:61`:** "keeps the moneyEventVersions table (ADR-029)" becomes "`moneyEventVersions` is gone (ADR-053 overrides ADR-029 for sync tables)". The new guard owns the assertion, so remove the case there and point to it.

**Bundle rule (D11, if approved):** add `\.msync\b`, `start_sync_server` and `Export Sync Bundle` to `scripts/bundle-rules.ts` `LOCAL_RULES`.
- **Before the deletion,** `npm run test:bundles` fails on `dist-web` / `dist-desktop`. All three strings ship today: verified in the `2b47bfb` web build, where `.msync` is in the main chunk and the other two are in `SettingsPage`.
- **After the deletion,** it passes.
- Add a case to `scripts/__tests__/check-bundles.test.ts` that the three tokens are found by `findForbidden(…, LOCAL_RULES)` and that ordinary code (`"async"`, `"Sync"` in a library string) is not.

## 2. Migration: `src/db/__tests__/migration-v21.test.ts` (new, written first)

Uses `migration-v20.test.ts`'s pattern: build a raw `Dexie` at the prior version under a unique name, seed it, close it, open `MiniCrmDatabase`, and clean up in `afterEach`.

The fixture `createV20Database(name, seed)` declares the v20 index strings for every table the case touches, including **all eight sync tables**, and seeds:
- 1 `localDevice`;
- 1 active `trustedPeers` row with a token;
- 5 `opLog` ops: a client create, a transaction update, a `paymentRecord` create that never applied (MUT-55), a `mark_paid`, and a remote op from another `createdBy`;
- 1 `peerCursors` row;
- 2 `entityFieldMeta` rows;
- 2 `moneyEventVersions` rows (one active);
- 1 **open** `conflictQueue` money conflict;
- 1 `syncHistory` row.

Alongside the sync rows it seeds user rows: a business profile, a client, a project, income with a `paymentRecord`, an unpaid receivable, an expense, and settings with `features`.

| # | Case | Expect |
|---|---|---|
| M1 | Open a v20 database with op-log rows and a paired peer at v21 | `open()` resolves, no console error, `verno === 21` |
| M2 | Stores after upgrade | `backendDB().objectStoreNames` contains none of the 8; `db.opLog` is `undefined` |
| M3 | User data intact | every non-sync table deep-equals its pre-upgrade rows (snapshot taken through the raw v20 handle before close) |
| M4 | Fresh install | a new name opens at v21 with none of the 8 stores, and the v20 feature reconcile does not run on create (existing v20 test, re-pinned) |
| M5 | v19 → v21 in one hop | the v20 upgrade still switches on areas with data (existing `migration-v20` cases, pins moved to 21) |
| M6 | **Pre-upgrade JSON backup restores into v21** | `serializeAllTables()` taken from the raw v20 database, then `restoreFromBackup` on v21, resolves; `recordsRestored` equals the user-row count only; the sync tables are skipped; the user rows match |
| M7 | Migration-safety after v20 → v21 | `completeMigrationSafety()` (localStorage `mutaba3a_last_known_version = 20`) returns `success: true`; the backup it writes has no sync table keys |
| M8 | Re-land after rollback (brief §13.4), only if a v22 exists at implementation time | otherwise documented, not committed. Scratch-verified on 2026-10-12: v21 → v20 build → v21 leaves the empty stores; a `version(22)` with the same `null`s removes them |

**Re-pinned `verno` assertions (20 → 21):**
- `migration-v20.test.ts:52,75,116`;
- `retainedMonthCloseSchema.test.ts:31`;
- `expensesGatingDataSafety.test.ts:39`.

The tests' intent is unchanged (they check the singleton is current).

## 3. Rerouted mutations behave the same

Behaviour lives in the base repositories, whose suites already cover it and stay **unchanged and green**:
- `paymentRecords.test.ts`;
- `partialPayment.test.ts`;
- `transactionRepo.test.ts`;
- `businessProfileRepo.test.ts`.

The hook-level checks below prove each call site still lands there.

| File | Change | Asserts |
|---|---|---|
| `src/db/__tests__/provider.test.ts` | "exposes the op-capturing decorators…" → "exposes only the base repositories"; "fills every declared slot" loses the `synced` loop | `getRepositories().base.transactions === transactionRepo`, `.base.paymentRecords === paymentRecordRepo`, no `synced` key |
| `src/hooks/__tests__/useIncomeQueries.test.tsx` | the mock's `synced.transactions.{markPaid,recordPartialPayment}` move under `base.transactions` | `useMarkIncomePaid` calls `base.transactions.markPaid('tx-1', { paidAt: undefined })` and `('tx-1', { paidAt: '2026-09-20' })`; same invalidations; error toast path unchanged. **New:** `useRecordIncomePartialPayment` calls `base.transactions.recordPartialPayment('tx-1', 5000)` |
| `src/hooks/__tests__/useQueries.test.tsx` (real fake-indexeddb) | drop `getOrCreateLocalDevice()` / `initializeClock()` from three `beforeEach` | existing cases stay green: `useCreatePaymentRecord` (row written, invalidation set), `useMarkTransactionPaid` (client history refreshed), `useRecentPayments`, invalidate-once, `useArchiveBusinessProfile` |
| same file, **new cases** | the call sites with no hook test today | `useUpdatePaymentRecord` changes the amount and recalculates `receivedAmountMinor`; `useDeletePaymentRecord` soft-deletes and the entry goes back to unpaid; `useRecordPartialPayment` writes a record and the entry's received total. Each is checked against the same rows the repository test expects |
| `src/sync/core/__tests__/synced-transaction-update.test.ts` | **deleted** | it tested only what the op-log logged. ADR-039's stored-state rules stay covered by `transactionRepo.test.ts` |

## 4. OAuth after the move

| # | Check | Expect |
|---|---|---|
| O1 | Moved suites at `src/services/oauth/__tests__/` | 74 cases green; only import paths changed (`git diff -M` shows renames at ≥ 90% similarity) |
| O2 | `src/services/__tests__/tokenStore.test.ts` | 15 cases green with the new `TokenSet` path |
| O3 | Rust `oauth::callback` tests | the same 10 green under the new module path: loopback-only bind, port fallback, all ports taken, single shot, raw query passthrough, error redirect passthrough, timeout releases the port |
| O4 | **Desktop IPC smoke** (isolated identifier, §10) | In devtools: `__TAURI_INTERNALS__.invoke('bind_oauth_callback', { ports: [14100,14101,14102,14103] })` returns a port in that list. `curl "http://127.0.0.1:<port>/callback?code=abc&state=xyz"` gets the done page. `invoke('await_oauth_callback')` resolves to `code=abc&state=xyz`. `invoke('cancel_oauth_callback')` resolves, and a second bind gets the same port back. This proves the commands are registered and the `OAuthState` is managed, which unit tests can't |

There is no end-to-end Malafat sign-in: the client has no UI caller (brief §2.11 #2, TD-075). "Sign-in still works" therefore means the flow's unit tests, the Rust listener tests and the live IPC smoke all pass after the move.

## 5. JSON backup round trip

- Existing and unchanged:
  - `retainedSchema.test.ts` (engagements round-trip);
  - `retainedMonthCloseSchema.test.ts`;
  - `expensesGatingDataSafety.test.ts` (serialize, clear, restore);
  - `DataToolsSection.test.tsx` (`backupVersion` fixture stays at 20, since it is a mocked old backup).
- New: §2 M6 (a pre-upgrade backup carrying sync tables restores into v21).
- Browser: §9 T-B5.

## 6. Rust

| # | Command (from the worktree, `CARGO_TARGET_DIR` in the scratchpad) | Expect |
|---|---|---|
| R1 | `cargo test --manifest-path src-tauri/Cargo.toml` | 10 OAuth + the `retired_sync` tests, all green; **0 compiler warnings** (12 at baseline) |
| R2 | `retired_sync` unit tests (tempfile) | removes `paired_devices.json` and `paired_devices.tmp`; both absent is success with no error; unrelated files and the directory are untouched; a **directory** named `paired_devices.json` is reported as an error, not a panic; a missing config dir counts as success (nothing to remove) |
| R3 | `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | clean. **Prerequisite:** `rustup component add clippy` is not installed here and needs the owner's OK; if declined, record the gate as waived |
| R4 | `cargo tree -i rustls -e features` | no `aws-lc-rs` / `aws_lc_rs` feature; `ring` only via `tauri-plugin-updater` |
| R5 | `npm run tauri build -- --debug --no-bundle --config '{"identifier":"com.elmokhtbr.mutaba3a.mut73"}'` | builds green (the "Tauri build is green" AC) |

## 7. Unit and static gates

```bash
cd <worktree> && export PATH=/Users/basel/.nvm/versions/node/v22.23.1/bin:$PATH;
npx vitest run            # full suite; count = baseline − 131 deleted + new guard/migration/hook cases
npm run typecheck
npx tsc -b
npm run lint              # 0 errors
npm run build
npm run test:bundles      # web/desktop/hosted bundles; D11 rules if approved
```

## 8. E2E: full Playwright suite on port 5198

The committed `playwright.config.ts` pins 5173 (TD-004), so use a throwaway config.
- Path: `playwright.mut73.config.ts` in the worktree, never committed.
- Contents: the committed config with `baseURL: 'http://localhost:5198'` and `webServer: { command: 'npm run dev -- --port 5198 --strictPort', url: 'http://localhost:5198', reuseExistingServer: true }`.
- Output goes to the session scratchpad.
- Afterwards delete the config and `test-results/`.

**Expect:** all specs pass. The `settings` axe surface still reports only `color-contrast`. If a known rule stops firing, the helper annotates it, and that is noted rather than failed.

## 9. Browser check: `preview_start {name: "web-mut73"}` (port 5186; use only the `tabId` it returns)

| # | When | Steps | Expect |
|---|---|---|---|
| T-B0 | **Phase 2 step 0, before any code change (v20)** | Open `/app/`, skip onboarding, add a client and an income entry, Mark paid with today's date. In `javascript_tool`, list `indexedDB` `mutaba3a` stores and count `opLog` and `localDevice`. Export a JSON backup from Settings › Data tools into the scratchpad | 8 sync stores exist; `localDevice` has 1 row; `opLog` ≥ 1 row; the backup has sync table keys |
| T-B1 | After implementation, reload the same tab | the app opens with no error banner and no console errors; `verno` 21; none of the 8 stores; the client, entry and payment from T-B0 are intact |
| T-B2 | Settings in English, then العربية | no Sync / Wi-Fi Sync / Export Sync Bundle / Conflicts section in either language; no conflict banner on any page |
| T-B3 | Mutations that used to be synced | Record a partial payment, edit it, delete it, Mark paid, archive a business profile: each updates Home, Clients and Income exactly as before, with no console warnings (`[OpsEngine]` is gone) |
| T-B4 | Console at startup | no `[Sync] Initialized…` log and no `Failed to initialize sync` |
| T-B5 | Restore T-B0's pre-upgrade backup from Settings › Data tools | succeeds; the records come back; no sync stores are recreated |

## 10. Desktop smoke (isolated identifier only)

**Safety rule (brief R6):** never launch a debug build under `com.elmokhtbr.mutaba3a`. It shares the installed app's config directory and WebView storage, so it would upgrade the owner's real database and delete his real `paired_devices.json`.

Build with R5's `--config` override, then confirm before the first launch that `~/Library/Application Support/com.elmokhtbr.mutaba3a.mut73/` is the directory in use.

| # | Steps | Expect |
|---|---|---|
| T-D1 | Create `paired_devices.json` and `paired_devices.tmp` (dummy content) in the isolated config dir; launch the binary | both files are gone after launch; the app opens; any other file placed there survives |
| T-D2 | §4 O4 (OAuth IPC smoke) | as specified |
| T-D3 | Let the updater's on-launch `check()` run (devtools console / log) | it resolves to "no update" or to an available update, with **no rustls/TLS/CryptoProvider error or panic** (the provider set changed, brief R5) |
| T-D4 | Settings | no Sync section, and no LAN or pairing UI |

Afterwards, delete the isolated config and WebView data directories, and the scratch target directory.

## 11. Acceptance criteria → evidence

| AC | Evidence |
|---|---|
| No pairing, bundle, chip or conflict banner, in either language | §1 guard (paths and names), §1 bundle rule, T-B2, T-D4 |
| No module outside OAuth imports a sync path; `tsc -b`, lint, unit suite, Tauri build green | §1 guard (import specifiers), §7, R1, R5 |
| A v20 database with op-log rows and a paired device upgrades cleanly with no leftover sync tables | §2 M1–M3, M7; T-B0 → T-B1 |
| Rerouted mutations behave the same | §3, T-B3 |
| Malafat OAuth sign-in still works | §4 O1–O4 |
| JSON backup and restore round-trip | §5, §2 M6, T-B5 |
| ADR-013 Superseded by the new ADR | review of `DECISIONS.md` (index row and ADR status) at qa-reconcile; not a test |
| Paired-devices file removed on first launch (scope item) | R2, T-D1 |
