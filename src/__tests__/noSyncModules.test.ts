import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../db/database';
import { getRepositories } from '../db/provider';

/**
 * MUT-73 guard (ADR-053): device-to-device sync — LAN pairing, `.msync`
 * bundles, the op-log and its Dexie tables, the Tauri sync server — is retired
 * product-wide. Only the Malafat OAuth client survives, moved out of the sync
 * tree. A partial revert must not bring any of it back: not a file, not an
 * import (test files and `vi.mock` paths included, which `tsc` never sees),
 * not a table, not a Tauri command, not a crate.
 */
const SRC = join(__dirname, '..');
const REPO = join(SRC, '..');
const read = (path: string) => readFileSync(path, 'utf8');

const GONE = [
  'src/sync',
  'src/components/sync',
  'src/hooks/usePairingSession.ts',
  'src-tauri/src/sync',
];

const OAUTH_HOME = [
  'src/services/oauth/oauth-client.ts',
  'src/services/oauth/oauth-flow.ts',
  'src/services/oauth/oauth-pkce.ts',
  'src-tauri/src/oauth/mod.rs',
  'src-tauri/src/oauth/callback.rs',
];

const SYNC_TABLES = [
  'localDevice',
  'trustedPeers',
  'opLog',
  'peerCursors',
  'entityFieldMeta',
  'moneyEventVersions',
  'conflictQueue',
  'syncHistory',
];

const DELETED_NAMES =
  /\b(initializeSync|captureOp|useSyncStore|ISyncedRepositories|syncedTransactionRepo|syncedPaymentRecordRepo|ConflictBanner|PairingModal|ExportBundleModal|ImportBundleModal|SyncSection|SyncStatusChip|usePairingSession)\b|\.synced\./;

const SYNC_COMMANDS = [
  'start_sync_server',
  'stop_sync_server',
  'is_sync_server_running',
  'get_sync_server_port',
  'discover_lan_peers',
  'encrypt_bundle',
  'decrypt_bundle',
  'get_hostname',
  'start_pairing_session',
  'get_pairing_status',
  'cancel_pairing_session',
  'get_paired_devices',
  'revoke_paired_device',
  'get_pending_sync_ops',
  'clear_pending_sync_ops',
  'store_local_sync_op',
  'get_local_sync_ops_count',
];
const OAUTH_COMMANDS = ['bind_oauth_callback', 'await_oauth_callback', 'cancel_oauth_callback'];

const REMOVED_CRATES = [
  'mdns-sd',
  'ring',
  'argon2',
  'base64',
  'uuid',
  'rand',
  'hostname',
  'chrono',
  'thiserror',
  'sha2',
  'local-ip-address',
  'urlencoding',
  'axum-server',
  'rustls',
  'rcgen',
];

function sourceFiles(): string[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .filter((rel) => /\.tsx?$/.test(rel))
    .filter((rel) => !rel.endsWith('noSyncModules.test.ts'));
}

/** Every module specifier a file names: static and dynamic imports, re-exports, vi.mock. */
function specifiers(text: string): string[] {
  const found: string[] = [];
  const pattern = /(?:from\s+|import\s*\(\s*|vi\.mock\s*\(\s*)['"]([^'"]+)['"]/g;
  for (const match of text.matchAll(pattern)) found.push(match[1]);
  return found;
}

const isSyncPath = (spec: string) =>
  /(^|\/)sync(\/|$)/.test(spec) || /usePairingSession/.test(spec);

describe('device sync after MUT-73', () => {
  it.each(GONE)('%s no longer exists', (rel) => {
    expect(existsSync(join(REPO, rel))).toBe(false);
  });

  it.each(OAUTH_HOME)('the OAuth client lives at %s', (rel) => {
    expect(existsSync(join(REPO, rel))).toBe(true);
  });

  it('no source or test file imports or mocks a sync path', () => {
    const offenders = sourceFiles().flatMap((rel) =>
      specifiers(read(join(SRC, rel)))
        .filter(isSyncPath)
        .map((spec) => `${rel} → ${spec}`)
    );
    expect(offenders).toEqual([]);
  });

  it('no source or test file names a deleted sync module, component or decorator', () => {
    const offenders = sourceFiles().filter((rel) => DELETED_NAMES.test(read(join(SRC, rel))));
    expect(offenders).toEqual([]);
  });

  it('the repository registry has one family, base', () => {
    expect(Object.keys(getRepositories())).toEqual(['base']);
  });

  it('the Dexie schema has none of the sync tables (ADR-053 overrides ADR-029 for these eight)', () => {
    const names = db.tables.map((t) => t.name);
    expect(SYNC_TABLES.filter((name) => names.includes(name))).toEqual([]);
  });

  it('a data load is never attributed to sync any more', () => {
    const features = read(join(SRC, 'lib/features/features.ts'));
    expect(features).not.toMatch(/source:[^)]*'sync'/);
  });

  it('the Tauri app registers only the OAuth commands', () => {
    const lib = read(join(REPO, 'src-tauri/src/lib.rs'));
    expect(SYNC_COMMANDS.filter((name) => new RegExp(`\\b${name}\\b`).test(lib))).toEqual([]);
    for (const name of OAUTH_COMMANDS) expect(lib).toMatch(new RegExp(`\\b${name}\\b`));
  });

  it('Cargo.toml declares none of the crates only sync used', () => {
    const cargo = read(join(REPO, 'src-tauri/Cargo.toml'));
    const declared = REMOVED_CRATES.filter((name) => new RegExp(`^${name}\\s*=`, 'm').test(cargo));
    expect(declared).toEqual([]);
  });

  it('package.json no longer depends on the pairing QR code library', () => {
    const pkg = JSON.parse(read(join(REPO, 'package.json'))) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty('qrcode.react');
  });
});
