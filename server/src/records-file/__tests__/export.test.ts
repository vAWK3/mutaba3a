import { describe, expect, it, vi } from 'vitest';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import type { Organization } from '../../repositories/ports.js';
import { decodeTagged, SNAPSHOT_FIELDS, writeRecordsFile, type RecordsFilePage } from '../codec.js';
import { localProfileOf, profileExportPages } from '../export.js';
import { LOCAL_PERSON_EMAIL } from '../local-person.js';

/** MUT-325 brief §4.3: one profile's rows, re-homed to the device's one person, a bounded page at a time. */

const AT = new Date('2026-10-01T08:00:00.000Z');

async function twoPeopleOneFirm() {
  const store = new MemoryLedgerStore();
  const { user: rana } = await store.users.create({ email: 'rana@studio.ps', displayName: 'Rana', passwordHash: 'argon2-hash', locale: 'en', personal: { name: 'Personal', slug: 'p-rana', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: AT });
  const { user: omar } = await store.users.create({ email: 'omar@firm.ps', displayName: 'Omar', passwordHash: 'argon2-hash', locale: 'ar', personal: { name: 'Personal', slug: 'p-omar', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: AT });
  const firm = await store.organizations.create({ name: 'Haddad Law', slug: 'haddad', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
  await store.memberships.grant(rana.id, firm.id, AT);
  await store.memberships.grant(omar.id, firm.id, AT);
  await store.integrations.connect({ organizationId: firm.id, provider: 'MALAFAT', externalTenantId: 'tenant-1', displayName: 'Haddad Law', connectedByApiKeyId: 'key-1', at: AT });
  const omarOrg = (await store.memberships.listByUser(omar.id)).find((m) => m.organizationId !== firm.id)!.organizationId;
  for (let i = 0; i < 7; i++) await store.customers.create({ organizationId: firm.id, name: `Client ${i}`, email: null, phone: null, notes: null }, AT);
  await store.customers.create({ organizationId: omarOrg, name: "Omar's own client", email: null, phone: null, notes: null }, AT);
  await store.inboxEntries.create({ userId: rana.id, kind: 'EXPENSE', amountMinor: 1200n, currency: 'ILS', occurredOn: '2026-10-01', note: null, captureSource: null }, AT);
  await store.inboxEntries.create({ userId: omar.id, kind: 'EXPENSE', amountMinor: 900n, currency: 'ILS', occurredOn: '2026-10-01', note: 'not Rana’s', captureSource: null }, AT);
  return { store, rana, firm: (await store.organizations.getById(firm.id))!, membership: (await store.memberships.find(rana.id, firm.id))! };
}

async function collect(pages: AsyncIterable<RecordsFilePage>) {
  const chunks: string[] = [];
  await writeRecordsFile(async (c) => void chunks.push(c), { formatVersion: 1, savedAt: AT }, pages);
  return decodeTagged((JSON.parse(chunks.join('')) as { maps: unknown }).maps) as Record<string, Map<string, Record<string, unknown>>>;
}

describe('profile export pages', () => {
  it("holds the profile's own rows and nobody else's", async () => {
    const { store, rana, firm, membership } = await twoPeopleOneFirm();

    const maps = await collect(profileExportPages(store, { person: rana, organization: firm, membership }));

    expect([...maps.custs!.values()].map((c) => c.name).sort()).toEqual(['Client 0', 'Client 1', 'Client 2', 'Client 3', 'Client 4', 'Client 5', 'Client 6']);
    expect([...maps.orgs!.keys()]).toEqual([firm.id]);
    expect([...maps.inbox!.values()].map((e) => e.userId)).toEqual([rana.id]);
  });

  it('writes one person, the exporter, under the device address, with nothing of the hosted account', async () => {
    const { store, rana, firm, membership } = await twoPeopleOneFirm();

    const maps = await collect(profileExportPages(store, { person: rana, organization: firm, membership }));

    expect([...maps.people!.values()]).toEqual([expect.objectContaining({ id: rana.id, email: LOCAL_PERSON_EMAIL, passwordHash: null, displayName: 'Rana', lockedUntil: null, lastSignInAt: null, failedSignIns: 0 })]);
    expect([...maps.members!.values()]).toEqual([membership]);
    expect(JSON.stringify([...maps.people!.values()])).not.toContain('omar');
  });

  it("never writes the Malafat connection, so the profile has no other writer on the device", async () => {
    const { store, rana, firm, membership } = await twoPeopleOneFirm();

    const maps = await collect(profileExportPages(store, { person: rana, organization: firm, membership }));

    expect(maps.ints!.size).toBe(0);
  });

  it("never writes Malafat's documents: receipts are the files a records file carries", async () => {
    const { store, rana, firm, membership } = await twoPeopleOneFirm();
    const customer = [...store.snapshot().maps.custs.values()].find((c) => c.organizationId === firm.id)!;
    await store.attachments.create({ organizationId: firm.id, kind: 'INVOICE', filename: 'i.pdf', mimeType: 'application/pdf', sizeBytes: 10, storageKey: `org/${firm.id}/a`, customerId: customer.id, projectId: null, paymentId: null, invoiceNumber: null, invoiceDate: null, uploadedByKeyId: null, requestId: null } as never, AT);

    const maps = await collect(profileExportPages(store, { person: rana, organization: firm, membership }));

    expect(store.snapshot().maps.files.size).toBe(1);
    expect(maps.files!.size).toBe(0);
  });

  it('reads at most a page of rows at a time', async () => {
    const { store, rana, firm, membership } = await twoPeopleOneFirm();
    const profilePage = vi.spyOn(store.recordsExport, 'profilePage');

    const maps = await collect(profileExportPages(store, { person: rana, organization: firm, membership }, 3));

    expect(maps.custs!.size).toBe(7);
    expect(profilePage.mock.calls.every(([, , , limit]) => limit === 3)).toBe(true);
    expect(profilePage.mock.calls.filter(([, field]) => field === 'custs')).toHaveLength(3); // 3 + 3 + 1
  });

  it('writes every snapshot field, empty ones included', async () => {
    const { store, rana, firm, membership } = await twoPeopleOneFirm();

    const maps = await collect(profileExportPages(store, { person: rana, organization: firm, membership }));

    expect(Object.keys(maps)).toEqual([...SNAPSHOT_FIELDS]);
  });
});

describe('localProfileOf', () => {
  const base: Organization = { id: 'org', name: 'X', slug: 'x', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', personalOwnerUserId: null, ownerUserId: null, profileType: null, version: 1, createdAt: AT };

  it("keeps the exporter's own profiles as they are", () => {
    const personal = { ...base, personalOwnerUserId: 'me', ownerUserId: 'me', profileType: 'PERSONAL' as const };
    const owned = { ...base, ownerUserId: 'me', profileType: 'BUSINESS' as const };
    expect(localProfileOf(personal, 'me')).toEqual(personal);
    expect(localProfileOf(owned, 'me')).toEqual(owned);
  });

  it('drops any column the record type does not name (a later role or firm field never reaches a device)', () => {
    const withExtra = { ...base, ownerUserId: 'me', profileType: 'BUSINESS' as const, updatedAt: AT, firmEnabledAt: AT } as Organization;
    expect(Object.keys(localProfileOf(withExtra, 'me')).sort()).toEqual(Object.keys(base).sort());
  });

  it('makes a firm the exporter belongs to theirs, as a business profile', () => {
    expect(localProfileOf(base, 'me')).toEqual({ ...base, ownerUserId: 'me', profileType: 'BUSINESS' });
    expect(localProfileOf({ ...base, ownerUserId: 'someone', profileType: 'PERSONAL' }, 'me')).toEqual({ ...base, ownerUserId: 'me', profileType: 'PERSONAL' });
  });

  it("makes someone else's personal profile a plain personal profile of the exporter's", () => {
    expect(localProfileOf({ ...base, personalOwnerUserId: 'them', ownerUserId: 'them', profileType: 'PERSONAL' }, 'me')).toEqual({ ...base, ownerUserId: 'me', profileType: 'PERSONAL' });
  });
});
