import { describe, expect, it } from 'vitest';
import { ApiError } from '../../errors.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import { assertNotFuture, dueDateForOwed, incomeCaptureRulesFor, owedVatFields, resolveIncomeLinks } from '../compose.js';

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
    const err = await resolveIncomeLinks(store, org.id, 'received', { customerId: null, projectId: null }, MALAFAT).catch((e: unknown) => e);
    expect((err as ApiError).details).toMatchObject({ reason: 'CUSTOMER_REQUIRED', field: 'customerId' });
  });

  it('a client with no Malafat reference → CUSTOMER_NOT_LINKED; with one → resolved', async () => {
    const { store, org, customer, project } = await fixture();
    const err = await resolveIncomeLinks(store, org.id, 'received', { customerId: customer.id, projectId: null }, MALAFAT).catch((e: unknown) => e);
    expect((err as ApiError).details).toMatchObject({ reason: 'CUSTOMER_NOT_LINKED', field: 'customerId' });
    await store.externalReferences.link({ organizationId: org.id, provider: 'MALAFAT', entityType: 'CUSTOMER', entityId: customer.id, externalId: 'c-1' }, new Date(0));
    expect(await resolveIncomeLinks(store, org.id, 'received', { customerId: customer.id, projectId: null }, MALAFAT)).toEqual({ customerId: customer.id, projectId: null });
    expect(await resolveIncomeLinks(store, org.id, 'received', { customerId: null, projectId: project.id }, MALAFAT)).toEqual({ customerId: customer.id, projectId: project.id });
  });

  it('a client linked only as a project reference does not count — the CUSTOMER reference is what Malafat allocates against', async () => {
    const { store, org, customer, project } = await fixture();
    await store.externalReferences.link({ organizationId: org.id, provider: 'MALAFAT', entityType: 'PROJECT', entityId: project.id, externalId: 'm-1' }, new Date(0));
    const err = await resolveIncomeLinks(store, org.id, 'received', { customerId: customer.id, projectId: project.id }, MALAFAT).catch((e: unknown) => e);
    expect((err as ApiError).details).toMatchObject({ reason: 'CUSTOMER_NOT_LINKED' });
  });
});

describe('resolveIncomeLinks', () => {
  it("'owed' with no customerId and no projectId → CUSTOMER_REQUIRED_FOR_OWED", async () => {
    const { store, org } = await fixture();
    const err = await resolveIncomeLinks(store, org.id, 'owed', { customerId: null, projectId: null }, PERSONAL).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('VALIDATION_FAILED');
    expect((err as ApiError).details).toMatchObject({ reason: 'CUSTOMER_REQUIRED_FOR_OWED', field: 'customerId' });
  });

  it("'received' with no customerId → no error, money can stand alone", async () => {
    const { store, org } = await fixture();
    expect(await resolveIncomeLinks(store, org.id, 'received', { customerId: null, projectId: null }, PERSONAL)).toEqual({ customerId: null, projectId: null });
  });

  it('projectId resolving to a different customer than the one explicitly given → PROJECT_CUSTOMER_MISMATCH', async () => {
    const { store, org, project, otherCustomer } = await fixture();
    const err = await resolveIncomeLinks(store, org.id, 'received', { customerId: otherCustomer.id, projectId: project.id }, PERSONAL).catch((e: unknown) => e);
    expect((err as ApiError).details).toMatchObject({ reason: 'PROJECT_CUSTOMER_MISMATCH' });
  });

  it('projectId given, no customerId given (received) → customerId is taken from the project', async () => {
    const { store, org, project, customer } = await fixture();
    expect(await resolveIncomeLinks(store, org.id, 'received', { customerId: null, projectId: project.id }, PERSONAL)).toEqual({ customerId: customer.id, projectId: project.id });
  });

  it("'owed' with only a projectId resolves its customer, satisfying the requirement", async () => {
    const { store, org, project, customer } = await fixture();
    expect(await resolveIncomeLinks(store, org.id, 'owed', { customerId: null, projectId: project.id }, PERSONAL)).toEqual({ customerId: customer.id, projectId: project.id });
  });

  it('an archived project may still be linked (MUT-42 D6 precedent, re-asserted on the income path)', async () => {
    const { store, org, archivedProject, customer } = await fixture();
    expect(await resolveIncomeLinks(store, org.id, 'received', { customerId: null, projectId: archivedProject.id }, PERSONAL)).toEqual({ customerId: customer.id, projectId: archivedProject.id });
  });

  it('an unknown customerId → CUSTOMER_NOT_FOUND; an unknown projectId → PROJECT_NOT_FOUND', async () => {
    const { store, org } = await fixture();
    const ghost = '00000000-0000-4000-8000-000000000000';
    const noCustomer = await resolveIncomeLinks(store, org.id, 'received', { customerId: ghost, projectId: null }, PERSONAL).catch((e: unknown) => e);
    expect((noCustomer as ApiError).details).toMatchObject({ reason: 'CUSTOMER_NOT_FOUND' });
    const noProject = await resolveIncomeLinks(store, org.id, 'received', { customerId: null, projectId: ghost }, PERSONAL).catch((e: unknown) => e);
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
      expect((err as ApiError).details).toMatchObject({ reason: 'DATE_INVALID', field: 'occurredOn' });
    }
  });

  it('accepts the same day', () => {
    expect(() => assertNotFuture(today, today, 'occurredOn')).not.toThrow();
  });

  it('accepts a backdated date', () => {
    expect(() => assertNotFuture('2026-09-01', today, 'occurredOn')).not.toThrow();
  });
});
