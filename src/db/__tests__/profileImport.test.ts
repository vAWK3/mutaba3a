import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../database';
import { findMatchingProfile, importProfileFile, type ProfileExportFile } from '../profileImport';
import type { BusinessProfile } from '../../types';

/**
 * MUT-158 (fixed inside MUT-145): importing a v2 profile export must bring the
 * profile's data back with every link intact. IDs are re-minted so an import
 * never collides with what is already there, and every reference (client,
 * project, profile, linked document) follows its row to the new ID.
 */
const T = '2024-01-01T00:00:00.000Z';

function exportFile(overrides: Partial<ProfileExportFile> = {}): ProfileExportFile {
  return {
    version: 2,
    profileId: 'src-profile',
    profile: { id: 'src-profile', name: 'Studio', email: 'hi@studio.test', defaultCurrency: 'USD', isDefault: true, createdAt: T, updatedAt: T },
    clients: [{ id: 'src-client', name: 'Acme', email: 'ap@acme.test', profileId: 'src-profile', createdAt: T, updatedAt: T }],
    projects: [{ id: 'src-project', name: 'Site', clientId: 'src-client', profileId: 'src-profile', createdAt: T, updatedAt: T }],
    transactions: [
      {
        id: 'src-tx',
        kind: 'income',
        status: 'unpaid',
        title: 'Design sprint',
        amountMinor: 50000,
        currency: 'USD',
        occurredAt: '2024-01-15',
        clientId: 'src-client',
        projectId: 'src-project',
        profileId: 'src-profile',
        linkedDocumentId: 'src-doc',
        createdAt: T,
        updatedAt: T,
      },
    ],
    documents: [
      {
        id: 'src-doc',
        number: 'INV-0001',
        type: 'invoice',
        status: 'issued',
        businessProfileId: 'src-profile',
        clientId: 'src-client',
        linkedTransactionIds: ['src-tx'],
        createdAt: T,
        updatedAt: T,
      },
    ],
    documentSequences: [{ id: 'src-profile:invoice', businessProfileId: 'src-profile', documentType: 'invoice', lastNumber: 1 }],
    fxRates: [{ id: 'src-fx', baseCurrency: 'USD', quoteCurrency: 'ILS', rate: 3.5, effectiveDate: '2024-01-01', source: 'manual', createdAt: T }],
    ...overrides,
  };
}

async function clearAll() {
  await Promise.all(
    ['businessProfiles', 'clients', 'projects', 'transactions', 'documents', 'documentSequences', 'fxRates'].map((name) =>
      db.table(name).clear(),
    ),
  );
}

beforeEach(clearAll);

describe('importProfileFile — create', () => {
  it('adds a new profile and its data with fresh IDs and every link remapped', async () => {
    const result = await importProfileFile(exportFile(), { mode: 'create', makeDefault: true });

    const [profile] = await db.businessProfiles.toArray();
    const [client] = await db.clients.toArray();
    const [project] = await db.projects.toArray();
    const [tx] = await db.transactions.toArray();
    const [doc] = await db.documents.toArray();

    expect(profile.id).not.toBe('src-profile');
    expect(profile).toMatchObject({ name: 'Studio', isDefault: true });
    expect(client).toMatchObject({ name: 'Acme', profileId: profile.id });
    expect(client.id).not.toBe('src-client');
    expect(project).toMatchObject({ name: 'Site', clientId: client.id, profileId: profile.id });
    expect(tx).toMatchObject({ title: 'Design sprint', clientId: client.id, projectId: project.id, profileId: profile.id });
    expect(tx.id).not.toBe('src-tx');
    // Retained documents (MUT-145) come back too, pointing at the new rows.
    expect(doc).toMatchObject({ number: 'INV-0001', businessProfileId: profile.id, clientId: client.id, linkedTransactionIds: [tx.id] });
    expect((tx as unknown as Record<string, unknown>).linkedDocumentId).toBe(doc.id);
    expect(await db.documentSequences.get(`${profile.id}:invoice`)).toMatchObject({ businessProfileId: profile.id });
    expect(result).toEqual({ profiles: 1, clients: 1, projects: 1, transactions: 1 });
  });

  it('keeps a new profile non-default when told to', async () => {
    await importProfileFile(exportFile(), { mode: 'create', makeDefault: false });
    expect((await db.businessProfiles.toArray())[0].isDefault).toBe(false);
  });

  it('never links a new business to another business\'s client, even with the same email', async () => {
    await db.clients.add({ id: 'other-client', name: 'Acme elsewhere', email: 'ap@acme.test', profileId: 'other', createdAt: T, updatedAt: T });

    await importProfileFile(exportFile(), { mode: 'create', makeDefault: false });

    const [profile] = await db.businessProfiles.toArray();
    const mine = await db.clients.filter((c) => c.profileId === profile.id).toArray();
    expect(mine).toHaveLength(1);
    expect((await db.transactions.toArray())[0].clientId).toBe(mine[0].id);
  });

  it('adds an FX rate once, skipping one that already exists for the same pair and date', async () => {
    await db.fxRates.add({ id: 'have', baseCurrency: 'USD', quoteCurrency: 'ILS', rate: 3.6, effectiveDate: '2024-01-01', source: 'manual', createdAt: T });
    await importProfileFile(exportFile(), { mode: 'create', makeDefault: false });
    expect(await db.fxRates.count()).toBe(1);
  });
});

describe('importProfileFile — merge', () => {
  beforeEach(async () => {
    await db.businessProfiles.add({ id: 'mine', name: 'My Studio', defaultCurrency: 'ILS', isDefault: true, createdAt: T, updatedAt: T });
  });

  it('adds the rows to the chosen profile and leaves the profile itself unchanged', async () => {
    const result = await importProfileFile(exportFile(), { mode: 'merge', profileId: 'mine' });

    expect(await db.businessProfiles.count()).toBe(1);
    expect(await db.businessProfiles.get('mine')).toMatchObject({ name: 'My Studio', defaultCurrency: 'ILS' });
    const [tx] = await db.transactions.toArray();
    const [client] = await db.clients.toArray();
    expect(client.profileId).toBe('mine');
    expect(tx).toMatchObject({ profileId: 'mine', clientId: client.id });
    expect(result.profiles).toBe(0);
  });

  it('reuses the profile\'s own client with the same email and its own project with the same name', async () => {
    await db.clients.add({ id: 'have-client', name: 'Acme Ltd', email: 'ap@acme.test', profileId: 'mine', createdAt: T, updatedAt: T });
    await db.projects.add({ id: 'have-project', name: 'Site', profileId: 'mine', createdAt: T, updatedAt: T });

    const result = await importProfileFile(exportFile(), { mode: 'merge', profileId: 'mine' });

    expect(await db.clients.count()).toBe(1);
    expect(await db.projects.count()).toBe(1);
    expect((await db.transactions.toArray())[0]).toMatchObject({ clientId: 'have-client', projectId: 'have-project' });
    expect(result).toMatchObject({ clients: 0, projects: 0, transactions: 1 });
  });

  it('does not treat two clients without an email as the same client', async () => {
    await db.clients.add({ id: 'have-client', name: 'Walk-in', profileId: 'mine', createdAt: T, updatedAt: T });
    const file = exportFile({ clients: [{ id: 'src-client', name: 'Acme', profileId: 'src-profile', createdAt: T, updatedAt: T }] });

    await importProfileFile(file, { mode: 'merge', profileId: 'mine' });

    expect(await db.clients.count()).toBe(2);
  });

  it('keeps an existing document sequence for the profile rather than overwriting it', async () => {
    await db.documentSequences.add({ id: 'mine:invoice', businessProfileId: 'mine', documentType: 'invoice', lastNumber: 9 });
    await importProfileFile(exportFile(), { mode: 'merge', profileId: 'mine' });
    expect(await db.documentSequences.get('mine:invoice')).toMatchObject({ lastNumber: 9 });
  });
});

describe('findMatchingProfile', () => {
  const profiles = [
    { id: 'p1', name: 'A', defaultCurrency: 'USD', isDefault: true, createdAt: T, updatedAt: T },
    { id: 'p2', name: 'B', email: 'b@b.test', defaultCurrency: 'USD', isDefault: false, createdAt: T, updatedAt: T },
  ] as BusinessProfile[];

  it('matches by id first', () => {
    expect(findMatchingProfile(profiles, exportFile({ profileId: 'p1' }))?.id).toBe('p1');
  });

  it('matches by a non-empty email on both sides', () => {
    const file = exportFile({ profileId: 'x', profile: { ...exportFile().profile, id: 'x', email: 'b@b.test' } });
    expect(findMatchingProfile(profiles, file)?.id).toBe('p2');
  });

  it('never matches two profiles that both lack an email (MUT-145 made email optional)', () => {
    const file = exportFile({ profileId: 'x', profile: { ...exportFile().profile, id: 'x', email: undefined } });
    expect(findMatchingProfile(profiles, file)).toBeUndefined();
  });
});
