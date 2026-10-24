import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CarryOverPrepareOptions, LocalBackend } from '../../../session/localBackendContract.js';
import { FREE_APP_BACKUP_MAX_VERSION } from '../freeAppBackup';
import { business, client, freeAppBackup, income, payment } from './helpers/freeAppFixture';

/**
 * MUT-291 through the real local backend (fake-indexeddb, a fake lock
 * manager): Your data › Restore reads the old web app's backup file (E5, T-I3),
 * the old address's records file arrives through the carry-over (T-I4), and
 * nothing is written before `apply()`.
 */

class FakeLockManager {
  private tail: Promise<unknown> = Promise.resolve();
  request<T>(_name: string, _options: unknown, callback: () => Promise<T>): Promise<T> {
    const run = this.tail.then(callback);
    this.tail = run.catch(() => undefined);
    return run;
  }
}

const OPTIONS: CarryOverPrepareOptions = { labels: { noClient: 'No client', defaultBusiness: 'My business' }, locale: 'en' };
const PAGE_LOAD_TIMEOUT_MS = 30_000;

async function openPage(): Promise<{ page: LocalBackend; countRecordsOnThisDevice: () => Promise<number> }> {
  vi.resetModules();
  const module = await import('../../index.js');
  return { page: await module.bootLocalBackend(), countRecordsOnThisDevice: module.countRecordsOnThisDevice };
}

const BACKUP = () =>
  freeAppBackup({
    businessProfiles: [business('b1', { isDefault: true })],
    clients: [client('c1', 'b1')],
    transactions: [income('t1', 'b1', { clientId: 'c1', receivedAmountMinor: 3_000 })],
    paymentRecords: [payment('r1', 't1', 3_000, '2026-02-11')],
  });

function backupFile(): Blob {
  const { version, timestamp, tables } = BACKUP();
  return new Blob([JSON.stringify({ version, timestamp, tables })], { type: 'application/json' });
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  Object.defineProperty(globalThis.navigator, 'locks', { value: new FakeLockManager(), configurable: true });
});

describe('the local backend and the carry-over', () => {
  it('Restore reads the old app\'s backup file only with the carry-over\'s options, and changes nothing before apply (E5)', async () => {
    const { page, countRecordsOnThisDevice } = await openPage();
    await expect(page.readRecordsFile(backupFile())).rejects.toMatchObject({ name: 'LocalRecordsFileRefused', reason: 'not-a-records-file' });

    const pending = await page.readRecordsFile(backupFile(), OPTIONS);
    expect(pending.carryOver?.counts).toMatchObject({ businesses: 1, clients: 1, income: 1, payments: 1 });
    expect(pending.carryOver?.totals.ILS).toMatchObject({ paid: '30.00', outstanding: '70.00' });
    expect(pending.deviceRecordCount).toBe(0);
    expect(await countRecordsOnThisDevice()).toBe(0);

    await pending.apply();
    expect(await countRecordsOnThisDevice()).toBe(3); // the client, the Owed and its payment
    const me = (await (await page.fetch(new Request('http://localhost/v1/me'))).json()) as { profiles: Array<{ name: string }> };
    expect(me.profiles.map((p) => p.name)).toContain('Business b1');
  }, PAGE_LOAD_TIMEOUT_MS);

  it('the old address\'s records file arrives as is, with its counts and totals (T-I4)', async () => {
    const { page: oldAddress } = await openPage();
    await (await oldAddress.readRecordsFile(backupFile(), OPTIONS)).apply();
    const file = await oldAddress.exportRecords();

    globalThis.indexedDB = new IDBFactory();
    const { page: newAddress, countRecordsOnThisDevice } = await openPage();
    const pending = await newAddress.prepareCarryOver('records-file', file, OPTIONS);
    expect(pending.carryOver?.counts).toMatchObject({ clients: 1, income: 1, payments: 1 });
    expect(pending.carryOver?.totals.ILS).toMatchObject({ paid: '30.00', outstanding: '70.00' });
    await pending.apply();
    expect(await countRecordsOnThisDevice()).toBe(3);
  }, PAGE_LOAD_TIMEOUT_MS * 2);

  it('says how many records this device already has, for the D3 warning', async () => {
    const { page } = await openPage();
    await (await page.readRecordsFile(backupFile(), OPTIONS)).apply();
    const again = await page.prepareCarryOver('free-app-backup', backupFile(), OPTIONS);
    expect(again.deviceRecordCount).toBe(3);
  }, PAGE_LOAD_TIMEOUT_MS);

  it('refuses a payload that is not the old app\'s backup', async () => {
    const { page } = await openPage();
    await expect(page.prepareCarryOver('free-app-backup', new Blob(['not json']), OPTIONS)).rejects.toMatchObject({ reason: 'not-a-records-file' });
  }, PAGE_LOAD_TIMEOUT_MS);

  it('refuses a backup from a newer free app as too new, not as a broken file', async () => {
    const { page } = await openPage();
    const newer = new Blob([JSON.stringify({ version: FREE_APP_BACKUP_MAX_VERSION + 1, timestamp: 'x', tables: { clients: [] } })]);
    await expect(page.prepareCarryOver('free-app-backup', newer, OPTIONS)).rejects.toMatchObject({ reason: 'too-new' });
  }, PAGE_LOAD_TIMEOUT_MS);
});
