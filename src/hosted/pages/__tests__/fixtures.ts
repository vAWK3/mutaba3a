import type { Attachment, Customer, OrganizationSummary, Payment, Project, Receivable } from '../../api/client';

export const C1 = 'c1111111-1111-4111-8111-111111111111';
export const C2 = 'c2222222-2222-4222-8222-222222222222';
export const C3 = 'c3333333-3333-4333-8333-333333333333';
export const P1 = 'a1111111-1111-4111-8111-111111111111';
export const P2 = 'a2222222-2222-4222-8222-222222222222';

const STAMP = '2026-09-01T09:00:00.000Z';

export function customer(id: string, name: string): Customer {
  return {
    id,
    name,
    email: null,
    phone: null,
    notes: null,
    vatTreatment: 'STANDARD_RATED',
    status: 'ACTIVE',
    archivedAt: null,
    externalReference: { provider: 'MALAFAT', externalId: `m-${id.slice(0, 4)}` },
    version: 1,
    createdAt: STAMP,
    updatedAt: STAMP,
  } as Customer;
}

export function project(id: string, customerId: string, name: string): Project {
  return {
    id,
    customerId,
    name,
    currency: 'ILS',
    vatTreatment: 'STANDARD_RATED',
    status: 'ACTIVE',
    archivedAt: null,
    externalReference: { provider: 'MALAFAT', externalId: `m-${id.slice(0, 4)}` },
    version: 1,
    createdAt: STAMP,
    updatedAt: STAMP,
  } as Project;
}

export const CUSTOMERS = [customer(C1, 'Al-Quds Bakery'), customer(C2, 'Nablus Trading'), customer(C3, 'Zaytoun Co')];
export const PROJECTS = [project(P1, C1, 'Lease dispute'), project(P2, C2, 'Trademark filing')];

function row(customerId: string, outstanding: string, overdue: string, lastPaymentOn: string | null, status: string) {
  return { customerId, outstanding, overdue, dueToday: '0.00', notYetDue: '0.00', unallocated: '0.00', lastPaymentOn, status, proposals: [] };
}

function block(currency: string, outstanding: string, overdue: string, proposed: string, customers: ReturnType<typeof row>[]) {
  return {
    currency,
    outstanding,
    overdue,
    dueToday: '0.00',
    notYetDue: '0.00',
    unallocated: '0.00',
    proposed,
    counts: { customers: customers.length, overdueCustomers: 0, unallocatedPayments: 0, openProposals: 0 },
    customers,
  };
}

export function organizationSummary(withUsd = false): OrganizationSummary {
  return {
    asOf: '2026-10-11',
    currencies: [
      block('ILS', '12000.00', '2000.00', '10000.00', [
        row(C3, '0.00', '0.00', null, 'SETTLED'),
        row(C1, '9000.00', '0.00', '2026-10-01', 'OUTSTANDING'),
        row(C2, '3000.00', '2000.00', '2026-08-15', 'OVERDUE'),
      ]),
      withUsd ? block('USD', '500.00', '0.00', '0.00', [row(C1, '500.00', '0.00', null, 'OUTSTANDING')]) : block('USD', '0.00', '0.00', '0.00', []),
    ],
  } as OrganizationSummary;
}

export function receivable(id: string, customerId: string, projectId: string, outstanding: string, status: string, dueDate = '2026-10-01'): Receivable {
  return {
    id,
    customerId,
    projectId,
    agreementId: null,
    origin: 'INSTALLMENT',
    originId: null,
    currency: 'ILS',
    net: '1000.00',
    vat: '170.00',
    gross: '1170.00',
    paid: '0.00',
    credited: '0.00',
    outstanding,
    vatTreatment: 'STANDARD_RATED',
    vatRateBasisPoints: 1700,
    dueDate,
    postingDate: '2026-09-01',
    postedAt: STAMP,
    status,
    // The harness's signed-in user (harness.tsx), so an ADJUSTMENT built from this is theirs to re-date (MUT-373).
    capturedByUserId: '99999999-9999-4999-8999-999999999999',
    version: 1,
  } as Receivable;
}

export const R1 = 'b1111111-1111-4111-8111-111111111111';
export const R2 = 'b2222222-2222-4222-8222-222222222222';
export const RECEIVABLES = [receivable(R1, C1, P1, '1170.00', 'OVERDUE'), receivable(R2, C2, P2, '585.00', 'PARTIALLY_PAID', '2026-11-15')];

export function payment(id: string, number: string): Payment {
  return {
    id,
    number,
    customerId: C1,
    currency: 'ILS',
    amount: '585.00',
    allocated: '585.00',
    unallocated: '0.00',
    receivedOn: '2026-10-05',
    method: 'BANK',
    reference: null,
    receiptNumber: null,
    notes: null,
    status: 'POSTED',
    reversedAt: null,
    reversalReason: null,
    replacesPaymentId: null,
    replacedByPaymentId: null,
    allocations: [
      {
        id: 'd1111111-1111-4111-8111-111111111111',
        receivableId: R1,
        projectId: P1,
        origin: 'INSTALLMENT',
        amount: '585.00',
        receivableOutstanding: '585.00',
        receivableStatus: 'PARTIALLY_PAID',
        createdAt: STAMP,
      },
    ],
    version: 1,
    createdAt: STAMP,
    updatedAt: STAMP,
  } as Payment;
}

export function attachment(id: string, filename: string, status: 'READY' | 'PENDING_UPLOAD' = 'READY'): Attachment {
  return {
    id,
    kind: 'INVOICE',
    filename,
    mimeType: 'application/pdf',
    sizeBytes: 48_000,
    status,
    customerId: C1,
    projectId: P1,
    paymentId: null,
    invoiceNumber: 'INV-2026-014',
    invoiceDate: '2026-09-30',
    uploadedByKeyId: null,
    createdAt: STAMP,
    completedAt: STAMP,
  } as Attachment;
}

export function page<T>(items: T[], nextCursor: string | null = null) {
  return { items, nextCursor };
}
