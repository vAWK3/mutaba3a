import { describe, expect, it } from 'vitest';
import { ApiError } from '../../errors.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import { assertNotFuture, dueDateForOwed, incomeCaptureRulesFor, isOwnCapture, isOwnProfile, owedVatFields, pastMoneyDate, redateTo, resolveIncomeLinks } from '../compose.js';

const PERSONAL = incomeCaptureRulesFor(null);
const MALAFAT = incomeCaptureRulesFor('MALAFAT');

async function fixture() {
  const store = new MemoryLedgerStore();
  const org = await store.organizations.create({ name: 'Personal', slug: `personal-${Math.random().toString(36).slice(2, 8)}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
  const customer = await store.customers.create({ organizationId: org.id, name: 'Nadia', email: null, phone: null, notes: null, vatTreatment: null }, new Date(0));
  const otherCustomer = await store.customers.create({ organizationId: org.id, name: 'Omar', email: null, phone: null, notes: null, vatTreatment: null }, new Date(0));
  const project = await store.projects.create({ organizationId: org.id, customerId: customer.id, name: 'Logo', currency: 'ILS' }, new Date(0));
  const archivedProject = await store.projects.create({ organizationId: org.id, customerId: customer.id, name: 'Old matter', currency: 'ILS' }, new Date(0));
  await store.projects.archive(org.id, archivedProject.id, new Date(0));
  return { store, org, customer, otherCustomer, project, archivedProject };
}

describe('incomeCaptureRulesFor (MUT-61)', () => {
  it('a personal profile keeps MUT-65: Received and Owed, client optional for Received', () => {
    expect(PERSONAL).toEqual({ received: true, owed: true, customer: 'optional' });
  });
  it('a Malafat-fed profile: Received only, for a client Malafat has linked', () => {
    expect(MALAFAT).toEqual({ received: true, owed: false, customer: 'linked-required' });
  });
});

describe('resolveIncomeLinks under linked-required (MUT-61)', () => {
  it('no client → CUSTOMER_REQUIRED', async () => {
    const { store, org } = await fixture();
    const err = await resolveIncomeLinks(store, org.id, 'received', { customerId: null, projectId: null }, 'ILS', MALAFAT).catch((e: unknown) => e);
    expect((err as ApiError).details).toMatchObject({ reason: 'CUSTOMER_REQUIRED', field: 'customerId' });
  });

  it('a client with no Malafat reference → CUSTOMER_NOT_LINKED; with one → resolved', async () => {
    const { store, org, customer, project } = await fixture();
    const err = await resolveIncomeLinks(store, org.id, 'received', { customerId: customer.id, projectId: null }, 'ILS', MALAFAT).catch((e: unknown) => e);
    expect((err as ApiError).details).toMatchObject({ reason: 'CUSTOMER_NOT_LINKED', field: 'customerId' });
    await store.externalReferences.link({ organizationId: org.id, provider: 'MALAFAT', entityType: 'CUSTOMER', entityId: customer.id, externalId: 'c-1' }, new Date(0));
    expect(await resolveIncomeLinks(store, org.id, 'received', { customerId: customer.id, projectId: null }, 'ILS', MALAFAT)).toEqual({ customerId: customer.id, projectId: null });
    expect(await resolveIncomeLinks(store, org.id, 'received', { customerId: null, projectId: project.id }, 'ILS', MALAFAT)).toEqual({ customerId: customer.id, projectId: project.id });
  });

  it('a matter fixes the currency under linked-required (CURRENCY_MISMATCH); personal rules never check it', async () => {
    const { store, org, customer, project } = await fixture();
    await store.externalReferences.link({ organizationId: org.id, provider: 'MALAFAT', entityType: 'CUSTOMER', entityId: customer.id, externalId: 'c-2' }, new Date(0));
    const err = await resolveIncomeLinks(store, org.id, 'received', { customerId: customer.id, projectId: project.id }, 'USD', MALAFAT).catch((e: unknown) => e);
    expect((err as ApiError).details).toMatchObject({ reason: 'CURRENCY_MISMATCH', field: 'currency' });
    expect(await resolveIncomeLinks(store, org.id, 'received', { customerId: customer.id, projectId: null }, 'USD', MALAFAT)).toEqual({ customerId: customer.id, projectId: null });
    expect(await resolveIncomeLinks(store, org.id, 'received', { customerId: customer.id, projectId: project.id }, 'USD', PERSONAL)).toEqual({ customerId: customer.id, projectId: project.id });
  });

  it('a client linked only as a project reference does not count — the CUSTOMER reference is what Malafat allocates against', async () => {
    const { store, org, customer, project } = await fixture();
    await store.externalReferences.link({ organizationId: org.id, provider: 'MALAFAT', entityType: 'PROJECT', entityId: project.id, externalId: 'm-1' }, new Date(0));
    const err = await resolveIncomeLinks(store, org.id, 'received', { customerId: customer.id, projectId: project.id }, 'ILS', MALAFAT).catch((e: unknown) => e);
    expect((err as ApiError).details).toMatchObject({ reason: 'CUSTOMER_NOT_LINKED' });
  });
});

describe('resolveIncomeLinks', () => {
  it("'owed' with no customerId and no projectId → CUSTOMER_REQUIRED_FOR_OWED", async () => {
    const { store, org } = await fixture();
    const err = await resolveIncomeLinks(store, org.id, 'owed', { customerId: null, projectId: null }, 'ILS', PERSONAL).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('VALIDATION_FAILED');
    expect((err as ApiError).details).toMatchObject({ reason: 'CUSTOMER_REQUIRED_FOR_OWED', field: 'customerId' });
  });

  it("'received' with no customerId → no error, money can stand alone", async () => {
    const { store, org } = await fixture();
    expect(await resolveIncomeLinks(store, org.id, 'received', { customerId: null, projectId: null }, 'ILS', PERSONAL)).toEqual({ customerId: null, projectId: null });
  });

  it('projectId resolving to a different customer than the one explicitly given → PROJECT_CUSTOMER_MISMATCH', async () => {
    const { store, org, project, otherCustomer } = await fixture();
    const err = await resolveIncomeLinks(store, org.id, 'received', { customerId: otherCustomer.id, projectId: project.id }, 'ILS', PERSONAL).catch((e: unknown) => e);
    expect((err as ApiError).details).toMatchObject({ reason: 'PROJECT_CUSTOMER_MISMATCH' });
  });

  it('projectId given, no customerId given (received) → customerId is taken from the project', async () => {
    const { store, org, project, customer } = await fixture();
    expect(await resolveIncomeLinks(store, org.id, 'received', { customerId: null, projectId: project.id }, 'ILS', PERSONAL)).toEqual({ customerId: customer.id, projectId: project.id });
  });

  it("'owed' with only a projectId resolves its customer, satisfying the requirement", async () => {
    const { store, org, project, customer } = await fixture();
    expect(await resolveIncomeLinks(store, org.id, 'owed', { customerId: null, projectId: project.id }, 'ILS', PERSONAL)).toEqual({ customerId: customer.id, projectId: project.id });
  });

  it('an archived project may still be linked (MUT-42 D6 precedent, re-asserted on the income path)', async () => {
    const { store, org, archivedProject, customer } = await fixture();
    expect(await resolveIncomeLinks(store, org.id, 'received', { customerId: null, projectId: archivedProject.id }, 'ILS', PERSONAL)).toEqual({ customerId: customer.id, projectId: archivedProject.id });
  });

  it('an unknown customerId → CUSTOMER_NOT_FOUND; an unknown projectId → PROJECT_NOT_FOUND', async () => {
    const { store, org } = await fixture();
    const ghost = '00000000-0000-4000-8000-000000000000';
    const noCustomer = await resolveIncomeLinks(store, org.id, 'received', { customerId: ghost, projectId: null }, 'ILS', PERSONAL).catch((e: unknown) => e);
    expect((noCustomer as ApiError).details).toMatchObject({ reason: 'CUSTOMER_NOT_FOUND' });
    const noProject = await resolveIncomeLinks(store, org.id, 'received', { customerId: null, projectId: ghost }, 'ILS', PERSONAL).catch((e: unknown) => e);
    expect((noProject as ApiError).details).toMatchObject({ reason: 'PROJECT_NOT_FOUND' });
  });
});

describe('dueDateForOwed', () => {
  it('defaults to EOM_15 of occurredOn, not occurredOn itself', () => {
    expect(dueDateForOwed('2026-10-08', undefined)).not.toBe('2026-10-08');
    expect(dueDateForOwed('2026-10-08', undefined)).toBe('2026-11-15');
  });

  it('EOM_15 boundary: the last day of a month', () => {
    expect(dueDateForOwed('2026-01-31', undefined)).toBe('2026-02-15');
  });

  it('EOM_15 boundary: a leap February', () => {
    expect(dueDateForOwed('2028-02-29', undefined)).toBe('2028-03-15');
  });

  it('a mid-month date', () => {
    expect(dueDateForOwed('2026-10-08', undefined)).toBe('2026-11-15');
  });

  it('an explicit dueDate wins over the default', () => {
    expect(dueDateForOwed('2026-10-08', '2026-10-20')).toBe('2026-10-20');
  });
});

describe('owedVatFields', () => {
  it('is always OUT_OF_SCOPE at a zero rate, net = gross = amount, vat = 0', () => {
    expect(owedVatFields(123456n)).toEqual({ vatTreatment: 'OUT_OF_SCOPE', vatRateBasisPoints: 0, netMinor: 123456n, vatMinor: 0n, grossMinor: 123456n });
  });
});

describe('assertNotFuture', () => {
  const today = '2026-10-12';

  it('rejects a future date', () => {
    expect(() => assertNotFuture('2026-10-13', today, 'occurredOn')).toThrow(ApiError);
    try {
      assertNotFuture('2026-10-13', today, 'occurredOn');
    } catch (err) {
      expect((err as ApiError).details).toEqual({ reason: 'DATE_INVALID', field: 'occurredOn', bound: 'future' });
    }
  });

  it('accepts the same day', () => {
    expect(() => assertNotFuture(today, today, 'occurredOn')).not.toThrow();
  });

  it('accepts a backdated date', () => {
    expect(() => assertNotFuture('2026-09-01', today, 'occurredOn')).not.toThrow();
  });
});

describe('isOwnProfile (MUT-223)', () => {
  it.each([
    ['an owned profile', { ownerUserId: 'u1', personalOwnerUserId: null }, true],
    ['a personal profile not yet stamped with ownerUserId (MUT-182 roll window)', { ownerUserId: null, personalOwnerUserId: 'u1' }, true],
    ["someone else's owned profile", { ownerUserId: 'u2', personalOwnerUserId: null }, false],
    ['a firm or Malafat-fed profile (no owner)', { ownerUserId: null, personalOwnerUserId: null }, false],
  ])('%s → %s', (_label, organization, expected) => {
    expect(isOwnProfile(organization, 'u1')).toBe(expected);
  });
});

describe('isOwnCapture (MUT-223)', () => {
  const mine = { origin: 'CAPTURE', createdByUserId: 'u1', status: 'POSTED' } as const;
  it.each([
    ['my posted capture', mine, true],
    ["Malafat's payment", { ...mine, origin: 'INTEGRATION' }, false],
    ["another person's capture", { ...mine, createdByUserId: 'u2' }, false],
    ['a capture whose person left (createdByUserId nulled)', { ...mine, createdByUserId: null }, false],
    ['an undone capture', { ...mine, status: 'REVERSED' }, false],
  ] as const)('%s → %s', (_label, payment, expected) => {
    expect(isOwnCapture(payment, 'u1')).toBe(expected);
  });
});

describe('redateTo (MUT-223)', () => {
  const organization = { timezone: 'Asia/Jerusalem' } as Parameters<typeof redateTo>[1];
  const lateUtc = new Date('2026-10-12T21:30:00Z'); // already the 13th in Jerusalem

  it("accepts the organization's today and any earlier date", () => {
    expect(redateTo('2026-10-13', organization, lateUtc, 'occurredOn')).toBe('2026-10-13');
    expect(redateTo('2025-12-31', organization, lateUtc, 'occurredOn')).toBe('2025-12-31');
  });

  it("refuses the day after the organization's today, and an impossible date, naming the field", () => {
    for (const raw of ['2026-10-14', '2026-02-30']) {
      try {
        redateTo(raw, organization, lateUtc, 'receivedOn');
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).details).toMatchObject({ reason: 'DATE_INVALID', field: 'receivedOn' });
      }
    }
  });

  it('refuses a date more than ten years before the organization\'s today (MUT-227)', () => {
    // Jerusalem's today is 2026-10-13, so the floor is 2016-10-05.
    expect(redateTo('2016-10-05', organization, lateUtc, 'occurredOn')).toBe('2016-10-05');
    try {
      redateTo('2016-10-04', organization, lateUtc, 'occurredOn');
      expect.unreachable();
    } catch (err) {
      expect((err as ApiError).details).toEqual({ reason: 'DATE_INVALID', field: 'occurredOn', bound: 'past' });
    }
  });
});

describe('pastMoneyDate (MUT-227)', () => {
  const today = '2026-10-12';
  const reasonOf = (raw: string) => {
    try {
      pastMoneyDate(raw, today, 'occurredOn');
    } catch (err) {
      return (err as ApiError).details;
    }
    return null;
  };

  it('returns the date when it is between the floor and today, both inclusive', () => {
    expect(pastMoneyDate(today, today, 'occurredOn')).toBe(today);
    expect(pastMoneyDate('2016-10-04', today, 'occurredOn')).toBe('2016-10-04');
  });

  it.each([
    ['an impossible date', '2026-02-30', { reason: 'DATE_INVALID', field: 'occurredOn' }],
    ['tomorrow', '2026-10-13', { reason: 'DATE_INVALID', field: 'occurredOn', bound: 'future' }],
    ['the day before the floor', '2016-10-03', { reason: 'DATE_INVALID', field: 'occurredOn', bound: 'past' }],
    ['a typo year', '0001-01-01', { reason: 'DATE_INVALID', field: 'occurredOn', bound: 'past' }],
  ])('refuses %s', (_label, raw, details) => {
    expect(reasonOf(raw)).toEqual(details);
  });
});
