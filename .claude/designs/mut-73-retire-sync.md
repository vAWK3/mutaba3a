# Design Brief — MUT-73: Retire device-to-device sync (LAN and .msync) and supersede ADR-013

Epic MUT-2. Owner decision of 2026-10-11: device sync is dropped product-wide, and local↔hosted sync is **off the roadmap** (not deferred).
Worktree `.claude/worktrees/mut-73-retire-sync`, branch `feature/mut-73-retire-sync`, from local main `2b47bfb` (MUT-58 included).
Reserved numbers: ADR-053..054, TD-074..075 (TD-072 and TD-073 went to MUT-66). Test plan: `mut-73-retire-sync-tests.md`.

**Status: approved 2026-10-12, D1–D12 as recommended; implemented in Phase 2.** The ticket drops user-database tables, deletes a Rust subsystem and supersedes an ADR, so §8 lists the decisions the owner answered (all as recommended; ADR-054 stays unused).

---

## 1. Problem and acceptance criteria

Device sync (LAN pairing plus `.msync` bundles, ADR-013) is broken in ways users can't see:
- transaction creates and edits are never captured (MUT-46, TODOS item 1);
- payment ops are captured but never applied (MUT-55, TODOS item 3);
- expenses never sync at all.

The phone app is going hosted-only (MUT-63), so nothing on the roadmap needs device sync. The fix is to delete it, not repair it.

**Acceptance criteria (from the ticket)**
- [ ] No pairing, bundle export/import, sync chip or conflict banner remains in the web or desktop UI, in either language.
- [ ] No module outside the relocated OAuth client imports from a sync path. `tsc -b`, lint, the unit suite and the Tauri build are green.
- [ ] Upgrading a database that has op-log rows and a paired device opens cleanly, with no error and no leftover sync tables (migration-safety test).
- [ ] Every mutation that went through the synced decorator behaves the same through the base repository. The ticket names `markPaid`, `recordPartialPayment` and payment records; the audit adds `businessProfiles.archive`.
- [ ] Malafat OAuth sign-in still works after the move.
- [ ] JSON backup and restore still round-trip.
- [ ] ADR-013 is marked Superseded by the new ADR.

**Guardrails:** deletion only; zero behaviour change on non-sync paths; land on its own, outside any feature PR.

---

## 2. Audit (real greps on `2b47bfb`, 2026-10-12)

### 2.1 Trees that go

| Tree | Files | Lines | Notes |
|---|---|---|---|
| `src/sync/core/` (non-test) | 5 | 2,270 | `ops-engine` 758, `synced-repository` 457, `ops-types` 398, `conflict-resolver` 387, `hlc` 270 |
| `src/sync/stores/syncStore.ts` | 1 | 340 | zustand store: modal flags, counts, pairing state |
| `src/sync/transport/` (bundle) | 2 | 612 | `crypto` 352, `bundle-encoder` 260 |
| `src/sync/index.ts` | 1 | 177 | barrel and `initializeSync()` |
| `src/sync/**/__tests__` (sync) | 4 | 1,780 | `hlc` 587 (59 cases), `syncStore` 657 (37), `ops-engine` 457 (32), `synced-transaction-update` 79 (3). **131 cases.** |
| `src/components/sync/` | 12 | 2,103 | 7 TS/TSX (1,164) + 5 CSS (939): `ConflictBanner`, `ExportBundleModal`, `ImportBundleModal`, `PairingModal`, `SyncSection`, `SyncStatusChip`, `index.ts` |
| `src/hooks/usePairingSession.ts` | 1 | 227 | only importer is `PairingModal` |
| `src-tauri/src/sync/` (all but OAuth) | 7 | 2,484 | `pairing` 681, `server` 616, `commands` 440, `persistence` 374, `crypto` 180, `discovery` 180, `mod` 13. Includes 202 lines of inline tests (14 tests) |

**Moves (kept):**
- `src/sync/transport/oauth-{client,flow,pkce}.ts`: 3 files, 570 lines.
- Their 4 test files (`oauth-client`, `oauth-flow`, `oauth-pkce`, `cimd-document`): 766 lines, 74 cases.
- `src-tauri/src/sync/oauth_callback.rs`: 310 lines, 10 tests.
- The three OAuth commands and their state slot, out of `commands.rs` (lines 18–22 and 375–440).

### 2.2 Importers of a sync path outside the deleted trees

```
src/components/layout/AppShell.tsx:29   from "../sync"                (4 components)
src/components/layout/AppShell.tsx:31   from "../../sync"             (initializeSync)
src/pages/settings/SettingsPage.tsx:15  from '../../components/sync'  (SyncSection)
src/db/provider.ts:71                   from '../sync/core/synced-repository'
src/db/database.ts:40                   from '../sync/core/ops-types' (8 row types)
src/services/tokenStore.ts:28           from '../sync/transport/oauth-client' (TokenSet; stays, path changes)
tests: src/db/__tests__/provider.test.ts:11, src/hooks/__tests__/useQueries.test.tsx:7-8,
       src/services/__tests__/tokenStore.test.ts:8,
       src/pages/settings/__tests__/SettingsPage.a11y.test.tsx:58 (vi.mock('../../../components/sync'))
fixture only: scripts/__tests__/hosted-lint.test.ts:20 ('../../sync/engine', a lint-rule fixture string)
```

Nothing in `server/`, `src/hosted/` or `e2e/` imports sync.

### 2.3 `synced` call sites to reroute (8, in 2 files)

| # | Hook | File:line | Synced call → base call |
|---|---|---|---|
| 1 | `useMarkTransactionPaid` (deprecated) | `useQueries.ts:180` | `synced.transactions.markPaid(id)` → `base.…` |
| 2 | `useRecordPartialPayment` | `useQueries.ts:190` | `synced.transactions.recordPartialPayment` → `base.…` |
| 3 | `useCreatePaymentRecord` | `useQueries.ts:245` | `synced.paymentRecords.create` → `base.…` |
| 4 | `useUpdatePaymentRecord` | `useQueries.ts:258` | `synced.paymentRecords.update` → `base.…` |
| 5 | `useDeletePaymentRecord` | `useQueries.ts:268` | `synced.paymentRecords.delete` → `base.…` |
| 6 | `useArchiveBusinessProfile` | `useQueries.ts:686` | `synced.businessProfiles.archive` → `base.…` (**not named in the ticket**) |
| 7 | `useMarkIncomePaid` | `useIncomeQueries.ts:192` | `synced.transactions.markPaid(id, { paidAt })` → `base.…` |
| 8 | `useRecordIncomePartialPayment` | `useIncomeQueries.ts:206` | `synced.transactions.recordPartialPayment` → `base.…` |

No production code imports a `synced*Repo` directly; `provider.ts` is the only consumer. The base signatures are identical (`interfaces.ts` lines 106–107 and 320–322: same arguments, same `Promise<void>` / `Promise<PaymentRecord>`).

### 2.4 AppShell mounts and the Settings section

- `AppShell.tsx`:
  - imports at lines 24–31;
  - a `useEffect` that calls `initializeSync()` on mount (66–71);
  - `<ConflictBanner />` in `<main>` (106);
  - `<ExportBundleModal /> <ImportBundleModal /> <PairingModal />` (180–182).
- `SettingsPage.tsx`: the import (15) and the `{/* Sync Settings */}` section (257–260).
- `SyncStatusChip` is exported but **mounted nowhere** (dead already).
- `ConflictBanner` and `SyncStatusChip` navigate to `/settings?section=sync`. The settings route has no `validateSearch`, so there is no route schema to edit.

### 2.5 i18n

- `en.json` (1,043 keys) and `ar.json` (1,076 keys) contain **zero** sync, pairing, bundle, device or conflict keys.
- The sync UI never called `t()`: every string is hard-coded English, so Arabic users saw English sync copy. Deleting the components removes it in both languages.
- The landing FAQ already describes moving devices as backup export/import (`landing…q3/a3`), so no landing copy changes.

### 2.6 Dexie: every sync table (all added in v2, unchanged since)

| Table | Index string | Written by | Read by | Holds user data that exists nowhere else? |
|---|---|---|---|---|
| `localDevice` | `id` | `initializeSync()` on **every** app load (`getOrCreateLocalDevice`), so every install has 1 row | sync only | No. A random device id and name; keys are empty strings |
| `trustedPeers` | `id, pairingCode, status, pairedAt` | **no TS writer** (paired devices live in Rust's `paired_devices.json`) | `syncStore`, `ops-engine:667` | No. Empty in practice |
| `opLog` | `id, hlc, [entityType+entityId], createdBy, appliedAt` | every synced write (§2.3) and every applied remote op | bundle encoder, `syncStore` counts | Mostly no: copies of rows that also live in their tables. **Exception:** ops received from another device that never applied, e.g. payment-record creates (MUT-55). Those exist on the sender, never appeared on this device, and nothing here shows them |
| `peerCursors` | `peerId` | **no TS writer** | `bundle-encoder:49` | No. Empty in practice |
| `entityFieldMeta` | `[entityType+entityId+field], hlc` | `captureOp` update ops, applied ops, conflict resolver | LWW checks | No. Clocks only |
| `moneyEventVersions` | `id, transactionId, hlc, isActive, createdBy` | `applyMoneyEventOp` (incoming bundle) | conflict resolver | **Snapshots of a transaction taken before an incoming sync overwrote it.** No shipped UI can reach them: `getTransactionVersions`, `resolveMoneyConflict` and `resolveProfileConflict` have zero UI callers, and SyncSection's "Review Conflicts" button has no `onClick` |
| `conflictQueue` | `id, entityType, entityId, status, detectedAt` | apply conflicts | banner count | Same as above: counted, never resolvable in the UI |
| `syncHistory` | `id, peerId, method, status, completedAt` | `bundle-encoder` | `syncStore` "last sync" | No. Audit of past syncs |

MUT-58 confirmed `moneyEventVersions` is sync-only (`ops-engine`, `conflict-resolver`). `noDeadMoneyEventModules.test.ts:61` currently asserts the table **stays**, so this ticket flips that assertion.

**Backup formats that embed sync data:**
- `src/db/backup.ts` serializes every table in `db.tables`, so every JSON backup a user saved before this release contains the eight sync tables.
- Restore is safe on v21: `db.table('opLog')` throws `InvalidTableError`, and `restoreFromBackup` catches it per table and skips. Verified with Dexie 4.2.1 under fake-indexeddb (§5.3).
- `migration-safety.ts` lists the eight names in its hand-kept `ALL_TABLES`, and so does every migration backup in the `mutaba3a_backup` IndexedDB (last 3 kept). Those backups age out on their own.
- The legacy import formats (`ImportDataModal`, `ImportDataPage`) never touch sync tables.

**HLC and device id:** read by nothing outside `src/sync`. Document numbering, demo, telemetry and the hosted path don't use them.

### 2.7 Rust / Tauri

**Command registrations** in `lib.rs` `invoke_handler`:
- 17 sync commands go: `start_sync_server`, `stop_sync_server`, `is_sync_server_running`, `get_sync_server_port`, `discover_lan_peers`, `encrypt_bundle`, `decrypt_bundle`, `get_hostname`, `start_pairing_session`, `get_pairing_status`, `cancel_pairing_session`, `get_paired_devices`, `revoke_paired_device`, `get_pending_sync_ops`, `clear_pending_sync_ops`, `store_local_sync_op`, `get_local_sync_ops_count`.
- 3 OAuth commands stay: `bind_oauth_callback`, `await_oauth_callback`, `cancel_oauth_callback`.

**Managed state:** `.manage(SyncState::default())`. `SyncState` bundles the server, the mDNS advertiser, `config_dir`, two op queues **and** the OAuth slot `oauth_callback: TokioMutex<Option<BoundCallback>>`. The OAuth slot moves to its own `OAuthState`.

**Capabilities** (`capabilities/default.json`): nothing sync-specific.
- Custom commands need no permission entries; there is no app manifest in `build.rs`.
- `opener:allow-open-url` for `https://*.malafat.app/*` is OAuth and **stays**.
- The `fs:*` entries are PDF archival and stay.
- `tauri.conf.json` has nothing to change, and there is no Info.plist, entitlement or installer file for LAN/Bonjour.

**Crates** (`Cargo.toml`), checked file by file:

| Crate | Used by after deletion | Action |
|---|---|---|
| `tokio` (full), `axum` 0.7, `log` | `oauth_callback.rs` | keep |
| `tauri-plugin-opener` | OAuth authorize URL | keep |
| `serde`, `serde_json` | none directly (Tauri template baseline; Tauri depends on both anyway) | keep (D9) |
| `mdns-sd`, `ring`, `argon2`, `base64`, `uuid`, `rand`, `hostname`, `chrono`, `thiserror`, `sha2`, `local-ip-address`, `urlencoding` | sync only | **remove** (12) |
| `axum-server` (tls-rustls), `rustls`, `rcgen` | **nothing, already today**: no `.rs` file references them; the LAN server is plain `axum::serve` on `0.0.0.0` | **remove** (3) |
| dev `tempfile` | persistence tests today; the new cleanup tests (§7.3) | keep |

**TLS provider consequence (needs a smoke test):**
- Today `rustls` is built with both `ring` (enabled by our crate and by `tauri-plugin-updater`) and `aws-lc-rs` (enabled by `axum-server/tls-rustls`).
- After removal only `ring` remains, coming from the updater itself. The updater's TLS stack (`reqwest`, `rustls-no-provider`) then sees one provider instead of two.
- That should be strictly simpler, but the updater is the release-critical path (ADR-031), so the test plan smoke-tests the update check (T-D3).
- Side benefit: `aws-lc-sys`, a C/CMake build, leaves the dependency graph, which speeds up the Windows CI build.

**Baseline** (`cargo test`, 1 m 37 s cold): 24 passed (10 OAuth, 6 pairing, 6 persistence, 2 crypto), plus 12 compiler warnings, **all** dead code in sync files. `cargo clippy` **is not installed** on this machine (`rustup component add clippy` is needed; see Risks).

### 2.8 On-disk state outside IndexedDB

- `persistence.rs` writes `{app_config_dir}/paired_devices.json` and uses `paired_devices.tmp` for atomic writes. With identifier `com.elmokhtbr.mutaba3a` that is:
  - macOS `~/Library/Application Support/com.elmokhtbr.mutaba3a/`
  - Windows `%APPDATA%\com.elmokhtbr.mutaba3a\`
  - Linux `~/.config/com.elmokhtbr.mutaba3a/`
- The file holds the bearer tokens the desktop issued to paired phones. With the server gone they authenticate to nothing, but they are still credentials left on disk.
- Nothing else is persisted: the op queues are in memory, and mDNS keeps no state.
- `localStorage['sync_passphrase_hint']` is defined in `crypto.ts`, but no UI ever called `storePassphraseHint`, so no cleanup is needed.

### 2.9 e2e

None of the 5 specs (`accessibility`, `income-drawer`, `income-fast-path`, `navigation`, `settings`) mentions sync, pairing, bundles or conflicts; every `sync` hit is `async`. Settings' axe surface allows only `color-contrast`, so removing SyncSection can only shrink it.

### 2.10 Other residue the deletion must touch

- `src/lib/features/features.ts:192`: the `'sync'` member of `reconcileFeaturesAfterDataLoad`'s source union. Its only caller is `ImportBundleModal`.
- `FeatureNoticeBanner.tsx:8` (comment), ADR-032 §2 ("…and sync-bundle import").
- `migration-safety.ts`: the eight names in `ALL_TABLES`.
- Five tests pin `db.verno` to 20:
  - `migration-v20.test.ts:52,75,116`;
  - `retainedMonthCloseSchema.test.ts:31`;
  - `expensesGatingDataSafety.test.ts:39`.
- `noDeadMoneyEventModules.test.ts:61` (assertion flips, §2.6).
- The `qrcode.react` npm dependency: its only importer is `PairingModal`.
- `eslint.config.js:36`: the portal ban regex `(db|sync|hooks)` **stays**. It is harmless, still meaningful, and has a lint-fixture test.
- `README.md:180-181` ("Planned: local network sync (LAN)… end-to-end encrypted sync").
- `.claude/SYSTEM_OVERVIEW.md`:
  - principle line 18;
  - the architecture diagram (57–67);
  - the layer table (81);
  - feature status (188–195);
  - Sync Security (281–284);
  - Device Sync Onboarding (323–343);
  - the tree (466–469).
- `.claude/PATTERNS.md`: "Sync Patterns" (641ff), "A synced write logs what was stored" (1694), the provider section (1183–1187).
- `.claude/COMPONENT_REGISTRY.md` provider entry (1317–1339).
- `.claude/TEST_PLAN.md` sync and OAuth rows.
- `docs/` contains no sync text. The `docs/admin-panel` and `docs/roadmap` trees that CLAUDE.md names don't exist in this repo.

### 2.11 Findings the ticket does not mention

1. **`useArchiveBusinessProfile` is a fifth synced mutation** (§2.3 #6).
2. **The OAuth client has no production caller.** `connectWorkspace` / `getValidAccessToken` / `disconnectWorkspace` are called only from tests. Its planned consumer, op-log sync over Malafat OAuth (MUT-27), is now off the roadmap. Kept per the ticket; see D4.
3. **Sync conflicts were never resolvable** in the shipped UI (§2.6). This is what makes dropping `moneyEventVersions` and `conflictQueue` safe.
4. **The LAN server listened on plain HTTP on 0.0.0.0** whenever it was started; the TLS crates were declared but unused. Deleting it removes a network listener and an mDNS advertisement.
5. **A synced write could report failure for data that was saved.** The op-log append ran after the base write, outside its Dexie transaction. If the append threw (quota, closed DB), the hook rejected even though the payment was already stored, and a retry could **record the payment twice**. Base calls remove that path.
6. **Visitor sample sessions leaked op-log rows.** ADR-042 says "leaves nothing behind", but `opLog` was not in `sessionTables()`. That leak ends here.
7. **`migration-safety`'s `ALL_TABLES` already omits five live tables:** `paymentRecords`, `plans`, `planAssumptions`, `planScenarios`, `recurringOccurrences`. Its post-migration backup (which v21 triggers) therefore never contained payment records. This is pre-existing, and the user-facing JSON backup (`backup.ts`) is unaffected. Proposed TD-074 (D10).

---

## 3. Deletion map in numbers

| | Files | Lines | Test cases |
|---|---|---|---|
| TS/TSX source deleted (`src/sync` non-OAuth, `src/components/sync`, `usePairingSession`) | 17 | 4,790 | — |
| CSS deleted | 5 | 939 | — |
| TS tests deleted | 4 | 1,780 | 131 |
| Rust deleted | 7 | 2,484 (202 of them tests) | 14 |
| **Total deleted** | **33** | **9,993** | **145** |
| TS moved (OAuth source + tests) | 7 | 1,336 | 74 |
| Rust moved (`oauth_callback.rs`) plus OAuth commands split out of `commands.rs` | 1 (+1 new `mod.rs`) | 310 + ~70 | 10 |
| Crates removed / npm deps removed | 15 / 1 (`qrcode.react`) | | |

Edited, not deleted:
- source: `AppShell.tsx`, `SettingsPage.tsx`, `provider.ts`, `interfaces.ts`, `database.ts`, `migration-safety.ts`, `useQueries.ts`, `useIncomeQueries.ts`, `features.ts`, `FeatureNoticeBanner.tsx` (comment), `tokenStore.ts` (import path), `lib.rs`, `Cargo.toml` / `Cargo.lock`, `package.json` / `package-lock.json`;
- 9 test files;
- docs.

New:
- `src/__tests__/noSyncModules.test.ts` (guard);
- `src/db/__tests__/migration-v21.test.ts`;
- `src-tauri/src/oauth/mod.rs`;
- `src-tauri/src/retired_sync.rs` (startup cleanup plus its tests).

---

## 4. Reroute plan

1. In the 8 call sites (§2.3), `.synced.` becomes `.base.`. The arguments and the `onSuccess` invalidations stay exactly as they are.
2. In `provider.ts`, delete the `synced` import, `dexieSynced` and the `synced` key. `Repositories` becomes `{ base: IRepositoryProvider }`, and the file's header comment loses the two-families and caveat sections (TD-013's `gstack-shortcut(dec-5f2c2123)` caveat is resolved by deletion). Keep the `{ base }` wrapper (D6).
3. In `interfaces.ts`, delete `ISyncedRepositories` and its comment block (326–377).
4. Tests:
   - `useIncomeQueries.test.tsx`: the mock's `synced.transactions` fakes move under `base.transactions` (`markPaid` already exists there; add `recordPartialPayment`). Assertions keep their expected arguments.
   - `provider.test.ts`: the decorator test becomes "the registry exposes only `base`".
   - `useQueries.test.tsx`: drop the `getOrCreateLocalDevice()` / `initializeClock()` set-up in three `beforeEach` blocks.

**Why behaviour is unchanged.** Each synced method was `await base.method(...)`, followed by an optional re-read and an op-log append. On the desktop it also made an IPC call to `store_local_sync_op`. Dropping that tail leaves:
- the same rows written in the same Dexie transaction;
- the same return value;
- the same errors from the base write.

The only differences are in failure paths, and both are improvements: there are no false failures after a committed write (§2.11 #5), and the `[OpsEngine] Sync not initialized` console warnings and per-op IPC disappear. ADR-039's guarantees live in `transactionRepo.update` and are untouched; `synced-transaction-update.test.ts` tested only what got logged.

---

## 5. Dexie v21

### 5.1 Schema change

```ts
// V21 (MUT-73, ADR-053): device sync is retired; its bookkeeping tables go.
// Explicit, narrow override of ADR-029 for these eight tables only.
this.version(21).stores({
  localDevice: null, trustedPeers: null, opLog: null, peerCursors: null,
  entityFieldMeta: null, moneyEventVersions: null, conflictQueue: null, syncHistory: null,
});
```

- No `.upgrade()` is needed: no data moves.
- Versions 1–20 keep their history verbatim, under PATTERNS' "migrations are append-only".
- Delete the eight `Table<…>` class fields and the `ops-types` type import.
- A fresh install is created at v21 and never has the stores.
- Remove the eight names from `migration-safety.ts` `ALL_TABLES`.
- Update the five `verno` pins (§2.10) to 21.

### 5.2 Version number

- No other lane claims v21 today. A grep of `version(21` across all local branches came back empty.
- MUT-73 claims v21. If another lane lands a Dexie bump first, MUT-73 renumbers to the next free version.
- The migration test asserts the drop, not the number. Only the five pins move.

### 5.3 Verified behaviour (Dexie 4.2.1 + fake-indexeddb, scratch experiment, not committed)

- **v20 → v21 drop.** Opens cleanly. The native version goes 200 → 210, and `objectStoreNames` loses the dropped stores while user stores keep their rows. An upgrade function can still read the doomed tables, because Dexie deletes them after upgraders run. `db.opLog` is `undefined`, and `db.table('opLog')` throws `InvalidTableError`.
- **Rollback** (a v20 build opens the v21 database). Opens; Dexie logs "Schema was extended…", bumps the native version to 211 and recreates the tables empty. The old build works, with a fresh device identity.
- **Forward again** (v21 build on native 211). Opens, but the v21 drop does **not** re-run, so the empty sync stores linger, undeclared and harmless. A later `version(22)` that re-declares the eight `null`s removes them (verified).

### 5.4 Error states

- **Upgrade blocked by another open tab on v20:** the standard Dexie `versionchange` handling, exactly as for v17–v20. Nothing new.
- **Upgrade failure:** `db.open()` rejects, and the existing `initDatabase` error path handles it as it would any version bump. Dropping stores is a metadata operation with no row-level work, so the failure surface is smaller than v18's backfill.

---

## 6. OAuth relocation

**TypeScript** (D3): `git mv` to `src/services/oauth/`.

```
src/services/oauth/oauth-client.ts   (from src/sync/transport/oauth-client.ts)
src/services/oauth/oauth-flow.ts     (… oauth-flow.ts)   import '../../services/tokenStore' → '../tokenStore'
src/services/oauth/oauth-pkce.ts     (… oauth-pkce.ts)
src/services/oauth/__tests__/{oauth-client,oauth-flow,oauth-pkce,cimd-document}.test.ts
src/services/tokenStore.ts           import type { TokenSet } from './oauth/oauth-client'
src/services/__tests__/tokenStore.test.ts  same path fix
```

- File names stay, so git detects renames and history follows.
- `cimd-document.test.ts` resolves `public/.well-known/oauth-client.json` from `process.cwd()` and needs no change.
- The ports `14100–14103` stay in the CIMD document and the bundle-origin allowlist.
- The portal lint ban does not touch `services/`, and the portal does not import OAuth.

**Rust:**

```
src-tauri/src/oauth/callback.rs   git mv of sync/oauth_callback.rs (doc comment path → src/services/oauth/oauth-client.ts)
src-tauri/src/oauth/mod.rs        OAuthState { callback: TokioMutex<Option<BoundCallback>> } + the three commands,
                                  moved verbatim from commands.rs (OAUTH_CALLBACK_TIMEOUT_SECS too), State<'_, OAuthState>
src-tauri/src/lib.rs              mod oauth; .manage(oauth::OAuthState::default()); handler = 3 oauth commands
```

- The command names are unchanged, so `oauth-flow`'s injected `bindCallback` / `awaitCallback` contract still holds when it is wired.
- The `opener` plugin and its `*.malafat.app` capability stay.
- `oauth_callback.rs` binds only `127.0.0.1` and is independent of the LAN server.

---

## 7. Rust changes

### 7.1 Deletions

- `src-tauri/src/sync/{commands,crypto,discovery,mod,pairing,persistence,server}.rs`.
- In `lib.rs`: `mod sync;`, the sync `use` list, `SyncState`, and the 17 handler entries.

### 7.2 Crates

- Remove the 15 crates in §2.7. Keep `tokio`, `axum`, `log`, `serde`, `serde_json`, the four plugins and dev `tempfile`.
- Let `Cargo.lock` re-resolve.
- Then confirm `cargo tree -i rustls -e features` no longer lists `aws-lc-rs`.

### 7.3 Removing the paired-devices file on upgrade (D5)

New `src-tauri/src/retired_sync.rs`:

```rust
/// MUT-73: device sync is retired. Its only on-disk state was the paired-devices
/// file (bearer tokens issued to phones) and its atomic-write temp file.
pub const RETIRED_FILES: [&str; 2] = ["paired_devices.json", "paired_devices.tmp"];

/// Best-effort. NotFound is success; any other error is returned for logging and
/// never stops the app from starting.
pub fn remove_retired_sync_files(config_dir: &Path) -> Vec<(PathBuf, std::io::Error)>
```

- It is called from `.setup()` with `app.path().app_config_dir()`.
- If the directory can't be resolved, it logs and continues.
- Each failure goes to `log::warn!`, and `setup` still returns `Ok(())`.
- It runs on every launch: one `remove_file` that returns `NotFound`, microseconds, with no marker file. It never touches the directory or any other file.

**If removal fails:** the file stays, inert, because nothing reads it and nothing listens for its tokens. The next launch tries again. The user sees nothing and the app starts normally.

---

## 8. Decisions for the owner

Each decision has a recommendation; "approve as recommended" answers them all.

**D1. ADR-029 says removing a feature never drops its tables. Override it for sync?**
- **A (rec.)** Drop in v21, with ADR-053 carrying an explicit override log limited to these eight tables. ADR-029 gets a pointer note, and the rule stands for everything else. It is safe because the rows are sync bookkeeping:
  - the user's clients, income, payments and expenses all live in their own tables, which v21 doesn't touch;
  - the two tables that hold anything record-like (`moneyEventVersions` snapshots, unapplied received ops in `opLog`) were never reachable in the shipped UI (§2.6);
  - the originals live on the sending device;
  - every JSON backup saved before the upgrade still contains them.
- B: Keep the tables, inert, under `src/db/retained/` with a retention test (ADR-029 as written). Then there is no Dexie bump, but every install keeps a `localDevice` row and op-log copies of its money forever. The AC "no leftover sync tables" fails.
- C: Clear the rows but keep empty tables. This gets the worst of both.

**D2. Which tables drop?** The ticket names "op-log, peer, conflict".
- **A (rec.)** All eight sync-only tables: `localDevice`, `trustedPeers`, `opLog`, `peerCursors`, `entityFieldMeta`, `moneyEventVersions`, `conflictQueue`, `syncHistory`. None has a reader once `src/sync` is gone. `moneyEventVersions` and `entityFieldMeta` are the LWW/versioning tables MUT-58 found sync-only.
- B: Only `opLog`, `trustedPeers` and `conflictQueue`, retaining the other five under ADR-029. That leaves dead tables with no reader and still needs the override.

**D3. Where does the OAuth client go?**
- **A (rec.)** `src/services/oauth/`, beside `tokenStore.ts`, which it is already coupled to. Same file names.
- B: `src/lib/oauth/`. `lib/` holds pure helpers, and `oauth-flow` does network I/O.
- C: a new `src/integrations/malafat/`. That is a new top-level convention for three files.

In Rust: **A (rec.)** `src-tauri/src/oauth/{mod.rs, callback.rs}`; B flat `oauth_callback.rs` with commands in `lib.rs`. `oauth_callback.rs` **stays** (the flow needs it), and so do the `axum`, `tokio`, `log` and opener crates.

**D4. The OAuth client has no production caller** (§2.11 #2).
- **A (rec.)** Keep it as the ticket says, and record TD-075 so its fate is decided deliberately. Desktop→Malafat sign-in is a separate product question.
- B: Delete it too. That changes the ticket, closes MUT-28's artefacts and makes TD-015 moot.

**D5. How is `paired_devices.json` removed?**
- **A (rec.)** Rust, in `.setup()`, every launch, best-effort, as in §7.3.
- B: from JS through the fs plugin. This needs a new `fs:allow-remove` permission on `$APPCONFIG` (it widens the capabilities), and it runs only after the UI mounts.
- C: one-shot with a marker file. That adds state to do less.

Keep the cleanup permanently. It is ~20 lines, and a user can skip versions.

**D6. Repository registry shape.**
- **A (rec.)** `getRepositories()` keeps returning `{ base }`, with only `synced` removed. 160 `.base.` call sites in 17 files stay untouched, and so do the files the parallel lanes are editing.
- B: Flatten to return `IRepositoryProvider` directly. That rewrites 160 call sites; if wanted, it is a separate refactor ticket.

**D7. ADRs.**
- **A (rec.)** One **ADR-053**:
  - "Device sync is retired; local↔hosted sync is off the roadmap". It supersedes **ADR-013 and also ADR-011 (HLC) and ADR-012 (op-log)**, which exist only for sync.
  - It carries the narrow ADR-029 override log.
  - It closes the sync thread in ADR-023/024/037 and MUT-25, and makes MUT-34 decision 1 ("no sync in v1") permanent.
  - It adds notes to ADR-032 §2, ADR-038 and ADR-039, whose text cites the synced wrapper.
  - The three superseded ADRs move to "Superseded Decisions".
  - ADR-054 is released unused.
- B: ADR-053 for retirement plus ADR-054 for a general "retiring a subsystem may drop its bookkeeping tables" rule. That is a new rule with one user (YAGNI).

**D8. Remove the `qrcode.react` npm dependency?**
- **A (rec.)** Yes. It is only used by PairingModal and is 16.6 KB minified in the main chunk. It touches `package-lock.json`, which lane mut-80 also changed, so expect a lockfile rebase.
- B: Leave it as a dead dependency.

**D9. Rust template crates `serde` / `serde_json`** have no direct user once sync is gone.
- **A (rec.)** Keep them. Tauri depends on both, so removing them saves nothing and risks command-macro breakage.
- B: Remove them and see if it builds.

**D10. `migration-safety` `ALL_TABLES` omits five live tables** (§2.11 #7).
- **A (rec.)** Remove only the eight sync names here and record **TD-074** for the gap. It is pre-existing, and the user-facing backup is unaffected.
- B: Derive the list from `db.tables` now. That is one line and arguably safer, but it changes a non-sync path, which the guardrail says not to do.

**D11. A bundle-level guard as well as the source guard?**
- **A (rec.)** Add three exact tokens to `scripts/bundle-rules.ts` `LOCAL_RULES`: `\.msync\b`, `start_sync_server`, `Export Sync Bundle`. `npm run test:bundles` then fails if pairing or bundle UI ever ships again. Broad words like "pairing" or "sync" would false-positive on libraries.
- B: The source guard only.

**D12. TODOS.md items 1 and 3.**
- **A (rec.)** Delete both. Keep items 2, 4 and 5 numbered as they are, because "TODOS.md item 2" is cited in TECH_DEBT and COMPONENT_REGISTRY. Add one line saying 1 and 3 were retired with sync (MUT-73).
- B: Renumber, which breaks those citations.

---

## 9. Knowledge and doc updates (Phase 2, after approval)

- **DECISIONS:**
  - ADR-053 (D7) and index rows;
  - ADR-011/012/013 → Superseded by ADR-053, moved under "Superseded Decisions";
  - notes on ADR-023, 024, 029, 032 §2, 037, 038, 039.
- **TECH_DEBT:**
  - TD-003 (live sync) → Resolved / won't do;
  - TD-037 (op-log has no profile) → Resolved / moot;
  - TD-013 → the synced caveat and "8 synced decorators" are gone;
  - TD-016 → Rust test count (24 → 10 OAuth + the cleanup tests);
  - new **TD-074** (D10) and **TD-075** (D4);
  - TD-015 stays (OAuth).
- **TODOS.md** per D12.
- **PATTERNS:**
  - retire "Sync Patterns" and "A synced write logs what was stored";
  - provider section → one family;
  - "Pruning after a UI deletion" gains the MUT-73 refinement: a *retired subsystem's bookkeeping* tables may drop under an explicit ADR override, with a migration test, when no shipped UI could reach their rows.
- **COMPONENT_REGISTRY:** provider entry (`{ base }`); OAuth module paths.
- **SYSTEM_OVERVIEW:** every section listed in §2.10.
- **TEST_PLAN:** a MUT-73 section, OAuth paths, the `src/sync` coverage row deleted.
- **CHANGELOG:** a "Removed" entry.
- **README:** drop the two planned-sync bullets and keep "no silent sync".

---

## 10. Impact

**Bundle (web build measured from sourcemaps, `2b47bfb`).**
- 61.9 KB of minified JS is attributable to sync: 57.1 KB in the main entry chunk (8% of its 710 KB, of which 16.6 KB is `qrcode.react`) and 4.8 KB in `SettingsPage`.
- That is about 17 KB gzipped, plus the sync CSS (939 source lines).
- The OAuth modules aren't in the bundle today (no caller), and the desktop build carries the same code.

**Desktop binary and CI.**
- 15 fewer direct crates, including the `aws-lc-sys` C build and `mdns-sd`.
- 17 fewer IPC commands.
- No LAN listener and no mDNS advertisement.

**Performance.** Every payment save, mark-paid and profile archive does 1–3 fewer IndexedDB writes and no IPC call. There is also no device-identity write on every app load.

**Security.**
- A plain-HTTP listener on `0.0.0.0` goes.
- Device bearer tokens are deleted from disk.
- The capabilities don't change.

**Data.** See D1 and §2.6: no user-visible record is removed.

**Files shared with other lanes** (checked against each branch and its uncommitted tree):

| File | MUT-73 change | Other lane touching it |
|---|---|---|
| `src/hooks/useQueries.ts` | 6 one-word edits (`synced`→`base`) | **mut-83** (uncommitted edits) |
| `src/hooks/useIncomeQueries.ts` | 2 one-word edits | **mut-83** (uncommitted) |
| `src/db/interfaces.ts` | delete `ISyncedRepositories` block (326–377) | **mut-83** (uncommitted), **mut-87** (committed) |
| `src/db/provider.ts` | remove `synced` family | none |
| `src/db/database.ts` | v21 + remove 8 fields/import | none (no lane claims v21) |
| `src/components/layout/AppShell.tsx` | remove 4 mounts + init effect | none |
| `src/pages/settings/SettingsPage.tsx` | remove section + import | none |
| `src/hooks/useExpenseQueries.ts` | **not touched** (expenses never synced) | — |
| `src/db/repository.ts`, i18n JSON | **not touched** | mut-83, mut-86, mut-87 |
| `package.json` / `package-lock.json` | drop `qrcode.react` (D8) | **mut-80** (committed) |
| `.claude/DECISIONS.md`, `TECH_DEBT.md`, `CHANGELOG.md`, `PATTERNS.md`, `COMPONENT_REGISTRY.md`, `SYSTEM_OVERVIEW.md`, `TEST_PLAN.md` | knowledge updates | **mut-66** (uncommitted), **mut-80** (committed) |

The source overlaps are one-line edits in hunks the other lanes don't touch. Expect textual rebase conflicts only in the knowledge files and the lockfile.

---

## 11. i18n

- No keys are added or removed (§2.5). The deleted UI was English-only, so after this ticket every remaining Settings string is translated.
- The Arabic Settings page loses an untranslated section. The browser check covers both languages.

## 12. Cost and infrastructure

- No hosted or server change, no Terraform, and no new environment variables.
- CI gets cheaper: the Windows desktop build drops `aws-lc-sys` and `mdns-sd`.

## 13. Rollback story

1. **Code:** revert the merge commit. It is self-contained because it lands outside any feature PR.
2. **Data already upgraded:** the dropped rows can't be brought back from the database. They are still in any JSON backup the user saved before upgrading, and in up to three `mutaba3a_backup` migration snapshots. Nothing in a rolled-back build needs them either: it creates a new device identity and starts with an empty op-log, which is exactly the state of a fresh install.
3. **A pre-MUT-73 build on a v21 database** works (verified in §5.3): Dexie recreates the eight tables empty at native version 211.
4. **Re-landing after a rollback:** a v21 build opens the 211 database without re-running the drop, and the empty sync stores linger, harmless and undeclared. The release that re-lands must bump to v22 and re-declare the eight `null`s. A migration test from a native-211 database pins this.
5. **Desktop:** the updater never downgrades. A rollback ships as a higher version of the old code, so it is case 3.
6. **`paired_devices.json`** is gone. A rolled-back build simply shows no paired devices.

## 14. Build order (Phase 2)

0. **Before changing anything,** record a real browser database on `web-mut73` (v20): seed data, mark an entry paid, and confirm the sync stores and op-log rows exist (test plan T-B0).
1. Write the guard test (red) and `migration-v21.test.ts` (red).
2. Reroute the 8 call sites; remove `synced` from the provider and interfaces; fix the three test files. Unit suite green; the guard is still red.
3. Unmount sync from AppShell and Settings; delete `src/components/sync`, `usePairingSession`, `src/sync` (non-OAuth); move OAuth to `src/services/oauth`; drop the `'sync'` source and the `qrcode.react` dependency.
4. Dexie v21, the `ALL_TABLES` and `verno` pins, and the `noDeadMoneyEventModules` flip. Guard and migration tests green.
5. Rust: split out OAuth, add `retired_sync.rs` and its tests, delete `src-tauri/src/sync`, clean up `Cargo.toml`, `cargo tree` check.
6. Bundle rule (D11), knowledge files and README.
7. Run the gates in the test plan.

## 15. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Dropping `moneyEventVersions` / `conflictQueue` loses a transaction's pre-sync value on a device that once imported a conflicting bundle | Low (unreachable in UI) | D1; the owner confirms; pre-upgrade JSON backups keep them |
| R2 | `opLog` holds received-but-never-applied ops (payment records, MUT-55) | Low | That data lives on the sending device and was never visible on this one |
| R3 | A rerouted mutation behaves differently | Low | Identical base calls; existing hook and repository tests plus new hook cases (test plan §3) |
| R4 | **OAuth breaks silently.** There is no production caller, so nothing in the app would notice | Medium | Moved unit suites (74 cases) plus 10 Rust tests plus a desktop IPC smoke of all three commands (T-D2); command names unchanged |
| R5 | **The updater's TLS provider set changes** (`aws-lc-rs` leaves the graph) | Medium (release-critical, ADR-031) | `cargo tree` check plus the update-check smoke on the debug build (T-D3) |
| R6 | **The desktop smoke could upgrade the owner's real database and delete his real `paired_devices.json`**: a debug build uses the same identifier and data directories as the installed app | High if done naively | The smoke runs only with an overridden identifier (`--config '{"identifier":"com.elmokhtbr.mutaba3a.mut73"}'`), checked before launch (test plan §10) |
| R7 | Another lane lands a Dexie bump first | Low | Renumber; tests assert the drop, not the number (§5.2) |
| R8 | Lockfile and knowledge-file rebase conflicts with mut-80 / mut-66 | Low | Rebase onto main just before landing; regenerate `package-lock.json` / `Cargo.lock` rather than hand-merging |
| R9 | `cargo clippy` isn't installed, so the clippy gate can't run | Process | Needs the owner's OK to run `rustup component add clippy` (a toolchain change), or the clippy gate is waived |
| R10 | A pre-MUT-73 JSON backup restore fails on unknown tables | Low | Already skipped per table; pinned by a new migration-v21 test |
