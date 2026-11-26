import type { Page, Request, Route } from '@playwright/test';
import type { Verdict } from '../../src/hosted/api/client';
import { QA_TERMS_VERSION, QA_USER_ID, customer, meBody, openSignedInPortal, type StubProfile } from './portal';

/**
 * A small in-memory hosted API for portal specs (shapes from src/hosted/api/schema.d.ts).
 * It answers through openSignedInPortal's `handle`, so the defaults there (Malafat
 * suggestions, empty lists) still apply to anything it does not know. Every /v1 call
 * is logged, writes included, so a spec asserts the body the portal sent; `once()`
 * queues a one-shot answer (an error, an aborted connection) for the next match.
 */

export const STAMP = '2026-10-01T09:00:00.000Z';
/** The signed-in user meBody publishes (qa/support/portal.ts). */
const STUB_USER_ID = '99999999-9999-4999-8999-999999999999';
/** The receipt and document bucket, the origin the portal's CSP allows for uploads (server/src/app.ts). */
export const STORAGE = 'https://storage.googleapis.com/qa-bucket';

/** A UUID the portal's URL parsers accept; `kind` keeps families apart (customers use customer() from portal.ts). */
export const uid = (kind: number, n: number) => `${kind.toString(16)}${String(n).padStart(7, '0')}-0000-4000-8000-000000000000`;

/** Today's calendar date in the stub profiles' zone, as the portal computes it (format/dates.ts todayInZone). */
export const todayInJerusalem = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** A calendar date `days` after `iso` (negative goes back). */
export const daysAfter = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** MUT-392: how far ahead the server takes an Owed or expense date (agreements/compose.ts DAYS_IN_FUTURE_LIMIT). */
export const DAYS_IN_FUTURE_LIMIT = 3660;

/** MUT-392: the latest Owed or expense date the server takes, today + DAYS_IN_FUTURE_LIMIT. */
export const ceilingOf = (iso: string) => daysAfter(iso, DAYS_IN_FUTURE_LIMIT);

type Json = Record<string, unknown>;

/** MUT-303: a vendor's remembered VAT, as the API sends it. */
type VendorVatStub = { treatment: string; rateBasisPoints: number };

/** MUT-254: the stub's minimal exact vendor key (case and spacing only). */
const vendorKey = (name: string | null | undefined): string | undefined => name?.trim().toLowerCase().replace(/\s+/g, ' ') || undefined;
type Currency = 'ILS' | 'USD' | 'EUR' | 'JOD';

export interface Logged {
  method: string;
  path: string;
  query: URLSearchParams;
  body: Json | null;
  headers: Record<string, string>;
  /** MUT-646: a file sent as it is (the logo). */
  raw: Buffer | null;
}

export type OnceAnswer = { status: number; body?: unknown } | 'abort';

/** Two-decimal currencies only (ILS/USD/EUR), which is all these fixtures use. */
const toMinor = (decimal: string) => Math.round(Number(decimal) * 100);
const toDecimal = (minor: number) => (minor / 100).toFixed(2);

export function project(n: number, customerId: string, name: string, currency: Currency = 'ILS') {
  return {
    id: uid(0xa, n),
    customerId,
    name,
    currency,
    vatTreatment: 'STANDARD_RATED',
    status: 'ACTIVE',
    archivedAt: null,
    externalReference: null,
    version: 1,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

export function receivable(
  n: number,
  r: { customerId: string; projectId?: string | null; gross: string; paid?: string; currency?: Currency; status?: string; origin?: string; dueDate?: string; postingDate?: string; title?: string | null; capturedBy?: string },
) {
  const paid = r.paid ?? '0.00';
  return {
    id: uid(0xb, n),
    customerId: r.customerId,
    projectId: r.projectId ?? null,
    agreementId: null,
    origin: r.origin ?? 'ADJUSTMENT',
    originId: null,
    currency: r.currency ?? 'ILS',
    net: r.gross,
    vat: '0.00',
    gross: r.gross,
    paid,
    credited: '0.00',
    outstanding: toDecimal(toMinor(r.gross) - toMinor(paid)),
    vatTreatment: null,
    vatRateBasisPoints: 0,
    dueDate: r.dueDate ?? '2026-11-15',
    postingDate: r.postingDate ?? '2026-10-01',
    postedAt: STAMP,
    status: r.status ?? 'DUE',
    title: r.title ?? null,
    // MUT-373: only who captured an Owed entry may re-date it; the signed-in QA user, unless a spec says a partner did.
    capturedByUserId: (r.origin ?? 'ADJUSTMENT') === 'ADJUSTMENT' ? (r.capturedBy ?? QA_USER_ID) : null,
    version: 1,
  };
}
export type StubReceivable = ReturnType<typeof receivable>;

export function allocation(n: number, a: { receivableId: string; projectId: string; amount: string; left: string }) {
  return {
    id: uid(0xd, n),
    receivableId: a.receivableId,
    projectId: a.projectId,
    origin: 'INSTALLMENT',
    amount: a.amount,
    receivableOutstanding: a.left,
    receivableStatus: a.left === '0.00' ? 'PAID' : 'PARTIALLY_PAID',
    createdAt: STAMP,
  };
}

export function payment(
  n: number,
  p: {
    customerId: string | null;
    amount: string;
    currency?: Currency;
    receivedOn?: string;
    method?: 'CASH' | 'BANK';
    status?: 'POSTED' | 'REVERSED';
    allocations?: ReturnType<typeof allocation>[];
    number?: string;
    /** MUT-224: captured by the signed-in user (what the server says for their own Received or settle). */
    mine?: boolean;
  },
) {
  const allocations = p.allocations ?? [];
  const allocated = allocations.reduce((sum, a) => sum + toMinor(a.amount), 0);
  return {
    id: uid(0xc, n),
    number: p.number ?? `PAY-${String(n).padStart(4, '0')}`,
    customerId: p.customerId,
    projectId: null,
    origin: 'capture',
    captureSource: 'app',
    capturedBy: p.mine ? { userId: STUB_USER_ID, displayName: 'Nour Haddad' } : null,
    currency: p.currency ?? 'ILS',
    amount: p.amount,
    allocated: toDecimal(allocated),
    unallocated: toDecimal(toMinor(p.amount) - allocated),
    allocationState: allocated === 0 ? 'unallocated' : allocated < toMinor(p.amount) ? 'partial' : 'allocated',
    receivedOn: p.receivedOn ?? '2026-10-05',
    method: p.method ?? 'BANK',
    reference: null,
    notes: null,
    status: p.status ?? 'POSTED',
    reversedAt: p.status === 'REVERSED' ? STAMP : null,
    reversalReason: null as string | null,
    replacesPaymentId: null,
    replacedByPaymentId: null,
    allocations,
    version: 1,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}
export type StubPayment = ReturnType<typeof payment>;

export function attachment(n: number, a: { filename: string; kind?: 'INVOICE' | 'RECEIPT' | 'OTHER'; customerId?: string | null; invoiceNumber?: string | null; ready?: boolean; sizeBytes?: number }) {
  return {
    id: uid(0xe, n),
    kind: a.kind ?? 'INVOICE',
    filename: a.filename,
    mimeType: 'application/pdf',
    sizeBytes: a.sizeBytes ?? 48_000,
    status: a.ready === false ? 'PENDING_UPLOAD' : 'READY',
    customerId: a.customerId ?? null,
    projectId: null,
    paymentId: null,
    invoiceNumber: a.invoiceNumber ?? null,
    invoiceDate: null,
    uploadedByKeyId: null,
    createdAt: STAMP,
    completedAt: a.ready === false ? null : STAMP,
  };
}

/**
 * A category as GET /v1/expense-categories answers it. MUT-464: a seeded one (`seeded` given) is named in the request's
 * Accept-Language, else the account's, as the server does; a typed one keeps `name` in both.
 */
export function category(n: number, name: string, seeded?: { presetKey: string; ar: string }) {
  return { id: uid(0xf, n), name, presetKey: seeded?.presetKey ?? null, color: null, archived: false, version: 1, createdAt: STAMP, updatedAt: STAMP, ...(seeded ? { nameAr: seeded.ar } : {}) };
}

interface StubReceipt {
  id: string;
  expenseId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: 'PENDING_UPLOAD' | 'READY';
  uploadedByUserId: string;
  createdAt: string;
  completedAt: string | null;
}

/**
 * MUT-260: a receipt in the receipts library (MUT-255's /v1/receipts), as GET /v1/receipts/{id} returns it. The list
 * adds `expense`, computed from the FakeApi's expenses the way the server joins it.
 */
export interface StubLibraryReceipt {
  id: string;
  expenseId: string | null;
  filename: string;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png';
  sizeBytes: number;
  status: 'PENDING_UPLOAD' | 'READY';
  filingStatus: 'TO_REVIEW' | 'FILED';
  receivedOn: string;
  suggested: Json | null;
  approved: Json | null;
  approvedAt: string | null;
  version: number;
  uploadedByUserId: string | null;
  createdAt: string;
  completedAt: string | null;
  /** MUT-503: the profile it is on; absent = every profile sees it (the fixtures before moves existed). */
  profileId?: string;
}

export function libraryReceipt(n: number, r: Partial<StubLibraryReceipt> = {}): StubLibraryReceipt {
  return {
    id: uid(0xb, n),
    expenseId: null,
    filename: `receipt-${n}.jpg`,
    mimeType: 'image/jpeg',
    sizeBytes: 2048,
    status: 'READY',
    filingStatus: 'TO_REVIEW',
    receivedOn: '2026-10-24',
    suggested: null,
    approved: null,
    approvedAt: null,
    version: 1,
    uploadedByUserId: STUB_USER_ID,
    createdAt: STAMP,
    completedAt: STAMP,
    ...r,
  };
}

/** A8: real 1×1 images, so an <img> of a signed receipt URL actually decodes in the browser. */
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const JPEG_1PX = Buffer.from('/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A+mKKKK/Kz/QA/9k=', 'base64');

export function expense(n: number, e: { amount: string; currency?: Currency; title?: string | null; vendor?: string | null; categoryId?: string | null; customerId?: string | null; projectId?: string | null; occurredOn?: string; notes?: string | null }) {
  return {
    id: uid(0x9, n),
    occurredOn: e.occurredOn ?? '2026-10-03',
    amount: e.amount,
    currency: e.currency ?? 'ILS',
    title: e.title ?? null,
    vendor: e.vendor ?? null,
    vendorId: null as string | null,
    categoryId: e.categoryId ?? null,
    customerId: e.customerId ?? null,
    projectId: e.projectId ?? null,
    notes: e.notes ?? null,
    createdByUserId: '99999999-9999-4999-8999-999999999999',
    vat: null as StubExpenseVat | null,
    allocationNumber: null as string | null,
    allocationNumberMissing: false,
    version: 1,
    createdAt: STAMP,
    updatedAt: STAMP,
    receipts: [] as StubReceipt[],
    /** MUT-589: the profile it is on; absent = every profile sees it (the fixtures before moves existed). */
    profileId: undefined as string | undefined,
  };
}

/**
 * MUT-557: the server's flag (ADR-246) for the stub: an ILS expense with VAT whose net is at or above the threshold on
 * its date (₪10,000 from 2026-01-01, ₪5,000 from 2026-06-01) and no number. The stub's profiles are firms.
 */
export function stampAllocationNumber(e: StubExpense): void {
  if (typeof e.allocationNumber === 'string') e.allocationNumber = e.allocationNumber.replace(/[\s-]/g, '') || null;
  const net = e.vat && Number(e.vat.vat) > 0 ? Number(e.vat.net) : 0;
  const threshold = e.occurredOn >= '2026-06-01' ? 5000 : e.occurredOn >= '2026-01-01' ? 10000 : Infinity;
  e.allocationNumberMissing = e.currency === 'ILS' && net >= threshold && !e.allocationNumber;
}
export type StubExpense = ReturnType<typeof expense>;

/** MUT-302: an expense's VAT as the server answers it. */
export interface StubExpenseVat { treatment: string; rateBasisPoints: number; net: string; vat: string; gross: string }

/** MUT-302: the server's split (computeVat, VAT_INCLUSIVE, half-up) of a gross, so the stub answers what the API would. */
export function splitExpenseVat(amount: string, currency: Currency, input: { treatment: string; rateBasisPoints: number } | null): StubExpenseVat | null {
  if (!input) return null;
  // In the currency's own digits, as the server parses it (review: "100" in ILS is 10000 minor units, not 100).
  const exponent = currency === 'JOD' ? 3 : 2;
  const [whole = '0', fraction = ''] = amount.split('.');
  const gross = BigInt(whole + fraction.padEnd(exponent, '0'));
  const rate = input.treatment === 'STANDARD_RATED' ? input.rateBasisPoints : 0;
  const divisor = 10000n + BigInt(rate);
  const net = rate ? (gross * 10000n + divisor / 2n) / divisor : gross;
  const text = (minor: bigint) => {
    if (!exponent) return minor.toString();
    const digits = minor.toString().padStart(exponent + 1, '0');
    return `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
  };
  return { treatment: input.treatment, rateBasisPoints: rate, net: text(net), vat: text(gross - net), gross: text(gross) };
}

export function conversion(n: number, c: { amount: string; currency: Currency; toAmount: string; toCurrency: Currency; occurredOn?: string; notes?: string | null }) {
  return {
    id: uid(0x8, n),
    occurredOn: c.occurredOn ?? '2026-10-04',
    amount: c.amount,
    currency: c.currency,
    toAmount: c.toAmount,
    toCurrency: c.toCurrency,
    notes: c.notes ?? null,
    createdByUserId: '99999999-9999-4999-8999-999999999999',
    version: 1,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}
export type StubConversion = ReturnType<typeof conversion>;

/** An expense group (MUT-267/268); `windowEnd` follows the API: the end, or a year after the start when open. */
export function expenseGroup(n: number, g: { name: string; startOn: string; endOn?: string | null; notes?: string | null }) {
  const endOn = g.endOn ?? null;
  return {
    id: uid(0xb, n),
    name: g.name,
    startOn: g.startOn,
    endOn,
    windowEnd: endOn ?? addDays(g.startOn, 365),
    notes: g.notes ?? null,
    createdByUserId: STUB_USER_ID,
    version: 1,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}
export type StubGroup = ReturnType<typeof expenseGroup>;
type Mark = 'excluded' | 'included';

const addDays = (day: string, days: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const exponent = (currency: string) => (currency === 'JOD' ? 3 : 2);
const minorOf = (amount: string, currency: string) => Math.round(Number(amount) * 10 ** exponent(currency));
const decimalOf = (minor: number, currency: string) => (minor / 10 ** exponent(currency)).toFixed(exponent(currency));

/** Today's reference rates against ILS, the stub profiles' default currency (MUT-228 shape). */
export const FX_RATES_ILS = {
  base: 'ILS',
  rateDate: '2026-10-17',
  fetchedAt: '2026-10-18T06:00:00.000Z',
  source: 'live',
  rates: [
    { currency: 'ILS', rate: 1, derived: false },
    { currency: 'USD', rate: 0.27, derived: false },
    { currency: 'EUR', rate: 0.25, derived: false },
    { currency: 'JOD', rate: 0.191428, derived: true },
  ],
};

/** A per-currency block of the organization summary (OverviewPage, ClientsPage). */
export function currencyBlock(
  currency: Currency,
  b: { outstanding: string; overdue: string; proposed?: string; customers: { customerId: string; outstanding: string; overdue: string; lastPaymentOn?: string | null; status: string; daysOverdue?: number | null }[] },
) {
  return {
    currency,
    outstanding: b.outstanding,
    overdue: b.overdue,
    dueToday: '0.00',
    notYetDue: '0.00',
    unallocated: '0.00',
    proposed: b.proposed ?? '0.00',
    counts: { customers: b.customers.length, overdueCustomers: 0, unallocatedPayments: 0, openProposals: 0 },
    customers: b.customers.map((c) => ({
      customerId: c.customerId,
      outstanding: c.outstanding,
      overdue: c.overdue,
      dueToday: '0.00',
      notYetDue: '0.00',
      unallocated: '0.00',
      lastPaymentOn: c.lastPaymentOn ?? null,
      // MUT-657: home's Clients overdue says how late, as the server's row does
      daysOverdue: c.daysOverdue ?? null,
      oldestOverdueDueDate: null,
      status: c.status,
      proposals: [],
    })),
  };
}

/** One client's summary (ClientDetailPage): one currency block with its matters. */
export function customerSummary(
  customerId: string,
  s: { currency: Currency; outstanding: string; overdue: string; lastPaymentOn?: string | null; status: string; matters: { projectId: string; agreed: string; posted: string; paid: string; outstanding: string; status: string }[] },
) {
  return {
    customerId,
    asOf: '2026-10-15',
    lastPaymentOn: s.lastPaymentOn ?? null,
    currencies: [
      {
        currency: s.currency,
        outstanding: s.outstanding,
        overdue: s.overdue,
        dueToday: '0.00',
        notYetDue: '0.00',
        unallocated: '0.00',
        status: s.status,
        projects: s.matters.map((m) => ({
          projectId: m.projectId,
          currency: s.currency,
          kind: 'FIXED',
          agreed: m.agreed,
          monthly: null,
          posted: m.posted,
          paid: m.paid,
          credited: '0.00',
          outstanding: m.outstanding,
          overdue: '0.00',
          dueToday: '0.00',
          notYetDue: '0.00',
          pending: { count: 0, amount: '0.00' },
          status: m.status,
          proposal: null,
          contingency: null,
        })),
      },
    ],
  };
}

/** MUT-300: when the fake server records a firm request. */
export const FIRM_REQUESTED_AT = '2026-10-20T09:00:00.000Z';

interface ProfileState {
  stub: StubProfile;
  defaultCurrency: Currency;
  version: number;
}

export interface FakeApiSeed {
  profiles: StubProfile[];
  /** How many customer(i) clients (Client 1, Client 2, …). */
  clients?: number;
  /** MUT-661: every seeded client already has this documents preference (none: the ask-once question is asked). */
  clientPreference?: string;
  projects?: ReturnType<typeof project>[];
  receivables?: StubReceivable[];
  payments?: StubPayment[];
  attachments?: ReturnType<typeof attachment>[];
  categories?: ReturnType<typeof category>[];
  expenses?: StubExpense[];
  /** MUT-589: what GET /v1/expenses/{id}/move-preview lists (and the move answers); [] when absent. */
  expenseMoveChanges?: Array<{ field: string; from: string | null; to: string | null }>;
  conversions?: StubConversion[];
  /** Expense groups (MUT-268) and their keep / leave-out marks, keyed `groupId:expenseId`. */
  groups?: StubGroup[];
  marks?: Record<string, Mark>;
  /** The profiles' today (YYYY-MM-DD) for group series; specs fix the browser clock to the same day. */
  today?: string;
  /** GET /v1/fx-rates: these rates (default FX_RATES_ILS), or 503 when 'unavailable'. */
  fxRates?: Json | 'unavailable';
  summary?: ReturnType<typeof currencyBlock>[];
  customerSummaries?: ReturnType<typeof customerSummary>[];
  /** MUT-642: GET /v1/business-lookup answers these by number; any other complete number is NOT_IN_REGISTRY. */
  registry?: { taxId: string; kind: 'company' | 'nonprofit'; name: string; nameEn: string | null; status: string; active: boolean; address: string | null }[];
  /** Expenses a type change would leave uncategorized (GET …/type-change). */
  uncategorizedOnTypeChange?: number;
  signedIn?: boolean;
  /** The setup link `/setup#<token>` carries (MUT-236); `valid` turns `used` once redeemed, as on the server. */
  setupLink?: StubSetupLink;
  /** The account's password (MUT-237): POST /v1/me/password checks it against this. */
  currentPassword?: string;
  /** MUT-324: false makes the portal show the Updated-terms step until the spec agrees. Defaults to true. */
  termsAccepted?: boolean;
  /** MUT-361: /v1/me `billingStanding`, the lapse gate's verdict on the person; absent = null (the gate off). */
  billingStanding?: 'open' | 'read-only' | 'locked' | null;
  /** MUT-361: GET /v1/billing's answer (Settings › Billing, and whether a payment would cover a profile). */
  billing?: Json;
  /**
   * MUT-731 (ADR-284): the person is on the free Starter plan (the server's STARTER_PLAN on). GET /v1/billing, /v1/me
   * `plan` and every owned profile's billing follow it; issuing, library scans and New profile refuse at Starter's
   * limits (409 PLAN_LIMIT, as the server does); Continue free and the active business answer. Overrides `billing`.
   */
  starter?: StarterSeed;
  /** MUT-175: each profile's money for GET /v1/summaries/activity; a profile not named reads the shared payments and expenses. */
  reports?: Record<string, StubReportRecords>;
  /**
   * MUT-448: GET /v1/summaries/verdict, canned (build one with verdictBody): `current` answers the parameterless
   * default view, a `from` date answers that period, `*` any other. Absent: every profile with nothing in it (first run).
   */
  verdicts?: Record<string, Verdict | { refuse: 402 | 500 }>;
  /** MUT-333: the account is already closing (signing in during the grace): /v1/me carries it. */
  closure?: { requestedAt: string; deleteAfter: string };
  /**
   * MUT-260: the receipts library, which turns it on (GET /v1/receipts/counts answers). Absent: every /v1/receipts
   * call answers 404, as a server with RECEIPTS_LIBRARY off does, so the Receipts tab stays hidden.
   */
  receipts?: StubLibraryReceipt[];
  /** MUT-260: vendors already saved on the profile (as earlier expenses would have), with their last category. */
  vendors?: { name: string; categoryId?: string; currency?: string; vat?: VendorVatStub }[];
  /**
   * MUT-561: each owned profile's accountants (MUT-559), which turns accountant access on (/v1/me carries `clients`).
   * Absent: the server has ACCOUNTANT_ACCESS off, so /v1/me has no `clients` and every …/accountants call answers 404.
   */
  accountants?: Record<string, StubGrant[]>;
  /** MUT-577: false withholds the person's `accountant_access` feature while the server has accountant access on. */
  accountantAccess?: boolean;
  /**
   * MUT-561 slice B: each owned profile's share links (MUT-560), which turns share links on. Absent: SHARE_LINKS off,
   * so every …/share-links call answers 404 and the Sharing page shows Accountants alone.
   */
  shareLinks?: Record<string, StubShareLink[]>;
  /** MUT-561 + MUT-314: period downloads on (the ticket and the stream answer); absent = off, every call 404. */
  periodDownloads?: boolean;
  /** MUT-646: issuing on for every business profile (the invoicing setup answers); off, every issuing call is 404. */
  invoicing?: boolean | 'ready' | 'details';
  /** MUT-647: what reading an invoice issued elsewhere answers (default: a read invoice 3381 of 1,500.00). */
  externalReading?: { read: boolean; number: string | null; documentDate: string | null; amount: string | null };
  /** MUT-648: the business's "offer to issue after saving" (on unless false). */
  offerAfterSave?: boolean;
  /** MUT-660: the documents due (GET /v1/documents-due), with invoicing on; absent = nothing due. */
  documentsDue?: DueSeed[];
  /** MUT-660: Reports' income split (GET /v1/summaries/activity invoiceSplit); absent = not an invoicing profile's answer. */
  invoiceSplit?: Array<{ currency: Currency; invoiceIncome: string; notForInvoice: string; all: string }>;
  /**
   * MUT-711: MTB3A can't request allocation numbers here (the Tax Authority is off or the profile not connected): a tax
   * invoice of 5,000.00 or more before VAT previews a MANUAL allocation (every QA client counts as VAT-registered,
   * 516123452) and is issued only with `manualAllocation` for the number it takes.
   */
  manualAllocation?: boolean;
  /**
   * MUT-736 (ADR-282): the Tax Authority is on here, and the payer's plan is `plan`. Starter has no connection: the step
   * offers the upgrade, Connect answers 409 PLAN_LIMIT, a kept connection (`connected`) reads `suspended`, and a tax
   * invoice of 5,000.00 or more previews MANUAL with `automaticOn: 'solo'`. Solo connects (the stand-in sign-in comes
   * straight back with `taxAuthority=connected`) and, connected, such an invoice gets its number by itself.
   */
  taxAuthority?: { plan: 'starter' | 'solo'; connected?: boolean };
}

/** MUT-660: one due document as the server lists it. `hasTaxDocument` makes marking it answer 409 HAS_TAX_DOCUMENT. */
export interface DueSeed {
  kind: 'TAX_INVOICE' | 'TAX_INVOICE_RECEIPT' | 'RECEIPT' | 'PAYMENT_REQUEST';
  entry: { kind: 'owed' | 'received'; id: string; number: string };
  customerId: string | null;
  amount: string;
  currency?: Currency;
  date: string;
  issuable?: boolean;
  reason?: string | null;
  hasTaxDocument?: boolean;
}

/** MUT-646: one profile's invoicing setup, as the server keeps it. */
/** The server's same-day order of statement lines (statements/lines.ts LINE_RANK). */
const LINE_RANK: Record<string, number> = { CHARGE: 0, CREDIT: 1, PAYMENT: 2, PAYMENT_REVERSAL: 3, REFUND: 4 };

/** MUT-570/643: an Owed an issued document posted, in minor units; `credited` is what its credit notes took. */
interface StubIssuedOwed {
  gross: number;
  outstanding: number;
  credited?: number;
  customerId: string | null;
  docId?: string;
  postingDate?: string;
}

interface StubIssuing {
  issuer: (Record<string, Json> & { version: number }) | null;
  logo: { type: string; bytes: Buffer } | null;
  introSeen: boolean;
  numbering: boolean;
  defaults: boolean;
  starts: Record<string, number>;
  /** MUT-570: what this profile issued, newest first, and each Owed it posted (outstanding, in minor units). */
  docs: Record<string, Json>[];
  owed: Map<string, StubIssuedOwed>;
  /** MUT-643: money credit notes gave back (minor units). */
  refunds?: { id: string; customerId: string; amount: number; refundedOn: string; creditNoteId: string; method: string; reference: string | null }[];
  /** MUT-647: invoices issued elsewhere, attached to an Owed or a Received; a removed one leaves the list. */
  external: (Record<string, Json> & { id: string; entryKind: string; entryId: string })[];
}
const ISSUER_DEFAULTS = { ink: 'BLACK', documentStyle: 'PROFESSIONAL', defaultLanguage: 'he', pricesIncludeVat: false, paymentTermsDays: null, bankDetails: null, footerNote: null, offerAfterSave: true };
const ISSUED_DOC_TYPES = ['TAX_INVOICE', 'TAX_INVOICE_RECEIPT', 'RECEIPT', 'CREDIT_NOTE', 'PAYMENT_REQUEST'] as const;

/** MUT-561: one share link as GET /v1/profiles/{id}/share-links lists it (no URL: the server never shows it again). */
export interface StubShareLink {
  id: string;
  period: 'LAST_1_MONTH' | 'LAST_2_MONTHS' | 'LAST_3_MONTHS' | 'WHOLE_PROFILE';
  from: string | null;
  to: string;
  createdAt: string;
  expiresAt: string;
  lastOpenedAt: string | null;
  status: 'active' | 'locked' | 'expired' | 'revoked';
  endedAt: string | null;
  viewers: number;
  maxViewers: number;
  createdByName: string | null;
}

/** The most live share links one profile may have (the server's default). */
export const SHARE_LINK_LIMIT = 3;

/** MUT-561: one accountant grant as GET /v1/profiles/{id}/accountants lists it. */
export interface StubGrant {
  id: string;
  email: string;
  name: string | null;
  status: 'pending' | 'expired' | 'active';
  invitedAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  lastViewedAt: string | null;
}

/** The most pending and active accountants one profile may have (the server's default). */
export const ACCOUNTANT_LIMIT = 5;
const INVITE_TTL_DAYS = 14;

/** MUT-175: what one profile's Reports reads. */
export interface StubReportRecords {
  payments: StubPayment[];
  expenses: StubExpense[];
  /** Each fully paid Owed entry's days (D2): the fake answers the median, n, samples and per-client rows as the server does. */
  daysToPaid?: { samples: number[]; byCustomer?: Array<{ customerId: string; median: number; n: number }> } | null;
  /** 403 / 500: the activity request is refused for this profile. */
  refuse?: 403 | 500;
}

/** The server's D2 figure from the samples a spec gives: the median with n, null below 3. */
function daysToPaidOf(given: StubReportRecords['daysToPaid']) {
  const samples = [...(given?.samples ?? [])].sort((a, b) => a - b);
  const mid = Math.floor(samples.length / 2);
  const median = samples.length % 2 === 1 ? samples[mid]! : Math.round((samples[mid - 1]! + samples[mid]!) / 2);
  return { overall: samples.length >= 3 ? { median, n: samples.length } : null, byCustomer: given?.byCustomer ?? [], samples };
}

export interface StubVerdictLine {
  profileId: string;
  name: string;
  kind?: 'BUSINESS' | 'PERSONAL' | 'FIRM';
  shared?: boolean;
  received?: string;
  spent?: string;
}

/**
 * MUT-448: a canned GET /v1/summaries/verdict in shekels. The portal shows the verdict as the server sends it and does
 * no maths of its own, so a spec gives the figures (MUT-447's server tests own the money rules); this only fills the
 * shape, kept = Σ received − spent unless given.
 */
export function verdictBody(lines: StubVerdictLine[], o: { from: string; to: string; asOf: string; kept?: string; usual?: string | null; owed?: string; overdueCount?: number }): Verdict {
  const profiles = lines.map((l) => {
    const received = l.received ?? '0.00';
    const spent = l.spent ?? '0.00';
    const net = toDecimal(toMinor(received) - toMinor(spent));
    const moved = toMinor(received) !== 0 || toMinor(spent) !== 0;
    return {
      profileId: l.profileId,
      name: l.name,
      kind: l.kind ?? 'BUSINESS',
      shared: l.shared ?? false,
      currencies: moved ? [{ currency: 'ILS' as const, received, spent, net }] : [],
      converted: { received, spent, net },
      history: [],
      owed: { currencies: [], overdueCount: 0 },
      omittedCurrencies: [],
    };
  });
  const kept = o.kept ?? toDecimal(profiles.reduce((sum, p) => sum + toMinor(p.converted.net), 0));
  const owed = o.owed ?? '0.00';
  return {
    from: o.from,
    to: o.to,
    asOf: o.asOf,
    base: 'ILS',
    rates: { date: o.asOf, source: 'live' },
    profiles,
    total: { label: lines.some((l) => l.kind === 'PERSONAL') ? 'kept' : 'businessNet', currencies: toMinor(kept) === 0 ? [] : [{ currency: 'ILS', net: kept }], converted: kept, inCurrencyOnly: null, sharedInFull: lines.some((l) => l.shared), partial: false },
    usual: o.usual ?? null,
    owed: { currencies: toMinor(owed) === 0 ? [] : [{ currency: 'ILS', outstanding: owed, overdue: '0.00' }], overdueCount: o.overdueCount ?? 0, converted: owed },
    unavailable: [],
  };
}

/** MUT-448: a canned verdict for this month (today in the stub profiles' zone), for specs that only pass through the Glance. */
export function currentVerdict(lines: StubVerdictLine[]): Verdict {
  const today = todayInJerusalem();
  const month = today.slice(0, 7);
  const to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  return verdictBody(lines, { from: `${month}-01`, to, asOf: today });
}

const addMonthTo = (month: string, n: number) => {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};

/**
 * GET /v1/summaries/activity in miniature (server/src/summaries/activity.ts):
 * POSTED payments by receivedOn, expenses by occurredOn, per currency, zero-filled
 * buckets, the period's categories and clients, and the 12 months ending with `to`'s.
 * Two-decimal currencies only, like the rest of this fake.
 */
export function activitySummary(records: StubReportRecords, from: string, to: string, bucket: 'day' | 'month', asOf: string) {
  type Row = { on: string; currency: string; minor: number; kind: 'in' | 'out'; customerId: string | null; categoryId: string | null };
  const rows: Row[] = [
    ...records.payments.filter((p) => p.status === 'POSTED').map((p) => ({ on: p.receivedOn, currency: p.currency, minor: toMinor(p.amount), kind: 'in' as const, customerId: p.customerId, categoryId: null })),
    ...records.expenses.map((x) => ({ on: x.occurredOn, currency: x.currency, minor: toMinor(x.amount), kind: 'out' as const, customerId: x.customerId, categoryId: x.categoryId })),
  ];
  const sum = (list: Row[], kind: Row['kind']) => toDecimal(list.filter((r) => r.kind === kind).reduce((s, r) => s + r.minor, 0));
  const grouped = (list: Row[], key: (r: Row) => string | null) => {
    const map = new Map<string | null, Row[]>();
    for (const r of list) map.set(key(r), [...(map.get(key(r)) ?? []), r]);
    return [...map.entries()].sort(([ka, a], [kb, b]) => (ka === null ? 1 : kb === null ? -1 : b.reduce((s, r) => s + r.minor, 0) - a.reduce((s, r) => s + r.minor, 0)));
  };
  const block = (list: Row[]) =>
    [...new Set(list.map((r) => r.currency))].sort().map((currency) => {
      const own = list.filter((r) => r.currency === currency);
      return {
        currency,
        received: sum(own, 'in'),
        spent: sum(own, 'out'),
        byCategory: grouped(own.filter((r) => r.kind === 'out'), (r) => r.categoryId).map(([categoryId, g]) => ({ categoryId, total: sum(g, 'out'), count: g.length })),
        byCustomer: grouped(own.filter((r) => r.kind === 'in'), (r) => r.customerId).map(([customerId, g]) => ({ customerId, total: sum(g, 'in'), count: g.length })),
      };
    });
  const period = rows.filter((r) => r.on >= from && r.on <= to);
  const currencies = block(period);
  const starts: string[] = [];
  if (bucket === 'day') for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) starts.push(d.toISOString().slice(0, 10));
  else for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addMonthTo(m, 1)) starts.push(`${m}-01`);
  const keyOf = (on: string) => (bucket === 'day' ? on : `${on.slice(0, 7)}-01`);
  // The server's read window: from (or the first of the 12 months ending with to's month, if earlier) through to's month end
  const historyFirst = `${addMonthTo(to.slice(0, 7), -11)}-01`;
  const windowStart = from < historyFirst ? from : historyFirst;
  const read = rows.filter((r) => r.on >= windowStart && r.on.slice(0, 7) <= to.slice(0, 7));
  return {
    from,
    to,
    bucket,
    asOf,
    dataSince: read.map((r) => r.on).sort()[0] ?? null,
    earlierData: rows.some((r) => r.on < windowStart),
    buckets: starts.map((start) => ({
      start,
      currencies: currencies.map(({ currency }) => {
        const day = period.filter((r) => r.currency === currency && keyOf(r.on) === start);
        return { currency, received: sum(day, 'in'), spent: sum(day, 'out') };
      }),
    })),
    currencies,
    history: Array.from({ length: 12 }, (_, i) => addMonthTo(to.slice(0, 7), i - 11)).map((month) => ({ month, currencies: block(read.filter((r) => r.on.slice(0, 7) === month)) })),
    daysToPaid: daysToPaidOf(records.daysToPaid ?? null),
  };
}

export type SetupLinkState = 'valid' | 'expired' | 'used' | 'superseded' | 'invalid';
export interface StubSetupLink {
  state: SetupLinkState;
  email?: string;
  locale?: 'en' | 'ar';
  purpose?: 'SETUP' | 'RESET';
}

/** MUT-731: a Starter person's month and choices, as the fake server holds them. */
export interface StarterSeed {
  /** Documents issued this month (cap 3) and scans finished (cap 12). */
  documents?: number;
  scans?: number;
  /** Read-only after cancelling a paid plan; Continue free on Starter moves them to Starter. */
  cancelled?: boolean;
  /** The businesses over Starter's count: none kept active until the person picks (Basel Q5). */
  businesses?: { active: string[]; readOnly: string[] };
  /** Whether a paid plan can be bought here (Upgrade to Solo shows). Default true. */
  sellable?: boolean;
  /**
   * MUT-702 Part B: Solo, Business and Firm on sale (PLAN_CHECKOUT on): GET /v1/billing lists them, with this saved
   * billing address for the prefill, and Checkout answers a Stripe URL. Absent: none on sale (the Freelancer step).
   */
  plans?: { billingAddress?: { country: string; line1: string; city: string; postalCode: string } | null };
}

/** MUT-702 Part B: the catalog script's prices (minor units, before tax) and each plan's limits. */
const QA_PLANS = [
  { plan: 'solo', catalog: { ILS: { month: 3900, year: 39000 }, USD: { month: 1200, year: 12000 } }, limits: { businesses: 1, partners: 0, documentsPerMonth: 50, scansPerMonth: 100 } },
  { plan: 'business', catalog: { ILS: { month: 8900, year: 89000 }, USD: { month: 2700, year: 27000 } }, limits: { businesses: 3, partners: 2, documentsPerMonth: 250, scansPerMonth: 500 } },
  { plan: 'firm', catalog: { ILS: { month: 24900, year: 249000 }, USD: { month: 7500, year: 75000 } }, limits: { businesses: 6, partners: 2, documentsPerMonth: 1000, scansPerMonth: 2000 } },
];

const STARTER_CAPS = { documents: 3, scans: 12 } as const;

/** The server's levelOf (usage/caps.ts): at least two steps and one step before the cap, else 80% and 90%. */
function starterLevel(used: number, cap: number): 'ok' | 'near' | 'nudge' | 'at_cap' {
  if (used >= cap) return 'at_cap';
  if (used >= Math.min(cap * 0.9, cap - 1)) return 'nudge';
  if (used >= Math.min(cap * 0.8, cap - 2)) return 'near';
  return 'ok';
}

/** The 1st of next month (Asia/Jerusalem is close enough for the fake), as GET /v1/billing's `resetsOn`. */
function nextMonthStart(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

/** GET /v1/billing on a server with Stripe off and a person with no trial or plan (every field the schema requires). */
const BILLING_OFF: Json = {
  configured: false,
  subscription: null,
  canManage: false,
  trial: null,
  catalog: { ILS: null, USD: null },
  countries: { consumer: [], consumerEverywhere: true, customTaxId: [] },
  coveredProfileIds: [],
  offer: null,
  yearlySwitch: null,
  comeback: null,
  accountantPlan: null,
  currentPlan: null,
};

export class FakeApi {
  readonly log: Logged[] = [];
  /** Requests that reached the storage bucket (receipt PUTs, signed-URL downloads). */
  readonly storage: { method: string; url: string }[] = [];
  signedIn: boolean;
  /** MUT-361: what /v1/me says about the lapse gate. */
  billingStanding: 'open' | 'read-only' | 'locked' | null;
  private readonly billingOverview: Json | null;
  /** MUT-731: the Starter state (null: the person isn't on Starter). */
  starter: (StarterSeed & { documents: number; scans: number }) | null;
  private profiles: ProfileState[];
  private readonly customers;
  private readonly projects;
  private readonly receivables;
  private readonly payments;
  private readonly attachments;
  private readonly categories;
  private readonly expenses;
  private readonly expenseMoveChanges;
  /** MUT-254 (A18): vendors as the server saves them, matched on a minimal exact key (case and spacing only). */
  private readonly vendors: { id: string; name: string; keys: Set<string>; lastCategoryId: string | null; lastCurrency: string | null; lastVat: VendorVatStub | null; lastUsed: number }[] = [];
  private readonly conversions;
  private readonly groups: StubGroup[];
  private readonly marks: Map<string, Mark>;
  private readonly today: string;
  private readonly fxRates: Json | 'unavailable';
  private readonly summary;
  private readonly customerSummaries;
  private readonly registry;
  private readonly uncategorized: number;
  private readonly onceQueue: { method: string; path: RegExp; answer: OnceAnswer }[] = [];
  private serial = 500;
  /** MUT-453: each Owed entry's credits, newest first. */
  private readonly credits = new Map<string, { id: string; receivableId: string; amount: string; net: string; vat: string; reason: string; effectiveDate: string; createdAt: string }[]>();
  private setupLink: StubSetupLink | null;
  private currentPassword: string;
  /** MUT-324: false = the person is behind on the terms and the portal asks them first. */
  private termsAccepted: boolean;
  /** MUT-324: the version the server names; bumpTerms moves it, as a release would. */
  private termsVersion = QA_TERMS_VERSION;
  /** MUT-373: profiles the person lost access to elsewhere; a request naming one answers 404, as the server does. */
  private readonly gone = new Set<string>();
  /** MUT-175: per-profile Reports records. */
  private readonly reports: Record<string, StubReportRecords>;
  /** MUT-448: canned verdicts (FakeApiSeed.verdicts). */
  private readonly verdicts: Record<string, Verdict | { refuse: 402 | 500 }>;
  /** MUT-333: set while the account is closing; then only Me, Keep my account and sign-out answer (403 ACCOUNT_CLOSING). */
  closure: { requestedAt: string; deleteAfter: string } | null;
  /** MUT-260: the receipts library; null = off (404). */
  readonly libraryReceipts: StubLibraryReceipt[] | null;
  /** MUT-561: accountants per profile; null = accountant access off on this server. */
  readonly accountants: Map<string, StubGrant[]> | null;
  /** MUT-577: the person's accountant_access feature (on unless the seed says false). */
  readonly accountantAccess: boolean;
  /** MUT-561: share links per profile; null = SHARE_LINKS off on this server. */
  readonly shareLinks: Map<string, StubShareLink[]> | null;
  /** MUT-561 + MUT-314: period downloads on or off. */
  readonly periodDownloads: boolean;
  /** MUT-646: per profile; null = issuing off. */
  readonly issuing: Map<string, StubIssuing> | null;
  /** MUT-570: the setup done (details and numbering), so issuing is open. */
  private readonly invoicingReady: boolean;
  /** MUT-722: the details saved and the introduction read, the numbering still unanswered (the setup can't issue). */
  private readonly invoicingDetailsOnly: boolean;
  private readonly externalReading: NonNullable<FakeApiSeed['externalReading']>;
  private readonly offerAfterSave: boolean;
  private readonly manualAllocation: boolean;
  /** MUT-736: the Tax Authority here, per the payer's plan; `connected` per profile. */
  private readonly taxAuthority: { plan: 'starter' | 'solo'; connected: Set<string>; initiallyConnected: boolean } | null;
  /** MUT-660: what is due, and what was marked not for invoice. */
  private readonly due: { items: DueSeed[]; marked: DueSeed[] };
  private readonly invoiceSplit: FakeApiSeed['invoiceSplit'] | null;

  constructor(seed: FakeApiSeed) {
    this.reports = { ...(seed.reports ?? {}) };
    this.verdicts = { ...(seed.verdicts ?? {}) };
    this.signedIn = seed.signedIn ?? true;
    // MUT-731: Starter runs with the lapse gate on (a business over the count is READ_ONLY), so /v1/me has a verdict.
    this.billingStanding = seed.billingStanding ?? (seed.starter ? 'open' : null);
    this.billingOverview = seed.billing ?? null;
    this.starter = seed.starter ? { ...seed.starter, documents: seed.starter.documents ?? 0, scans: seed.starter.scans ?? 0 } : null;
    this.profiles = seed.profiles.map((stub) => ({ stub, defaultCurrency: 'ILS', version: 1 }));
    this.customers = Array.from({ length: seed.clients ?? 0 }, (_, i) => ({ ...customer(i), ...(seed.clientPreference ? { documentsPreference: seed.clientPreference } : {}) }));
    this.projects = [...(seed.projects ?? [])];
    this.receivables = [...(seed.receivables ?? [])];
    this.payments = [...(seed.payments ?? [])];
    this.attachments = [...(seed.attachments ?? [])];
    this.categories = [...(seed.categories ?? [])];
    this.expenses = [...(seed.expenses ?? [])];
    this.expenseMoveChanges = seed.expenseMoveChanges ?? [];
    this.conversions = [...(seed.conversions ?? [])];
    this.groups = [...(seed.groups ?? [])];
    this.marks = new Map(Object.entries(seed.marks ?? {}));
    this.today = seed.today ?? todayInJerusalem();
    this.fxRates = seed.fxRates ?? FX_RATES_ILS;
    this.summary = seed.summary ?? [];
    this.customerSummaries = new Map((seed.customerSummaries ?? []).map((s) => [s.customerId, s]));
    this.registry = new Map((seed.registry ?? []).map((r) => [r.taxId, r]));
    this.uncategorized = seed.uncategorizedOnTypeChange ?? 0;
    this.setupLink = seed.setupLink ?? null;
    this.currentPassword = seed.currentPassword ?? 'the-current-password';
    this.termsAccepted = seed.termsAccepted ?? true;
    this.closure = seed.closure ?? null;
    this.libraryReceipts = seed.receipts ? [...seed.receipts] : null;
    this.accountantAccess = seed.accountantAccess ?? true;
    this.accountants = seed.accountants ? new Map(Object.entries(seed.accountants).map(([id, grants]) => [id, [...grants]])) : null;
    this.periodDownloads = seed.periodDownloads ?? false;
    this.issuing = seed.invoicing ? new Map() : null;
    this.invoicingReady = seed.invoicing === 'ready';
    this.invoicingDetailsOnly = seed.invoicing === 'details';
    this.externalReading = seed.externalReading ?? { read: true, number: '3381', documentDate: '2026-10-12', amount: '1500.00' };
    this.offerAfterSave = seed.offerAfterSave ?? true;
    this.manualAllocation = seed.manualAllocation ?? false;
    this.taxAuthority = seed.taxAuthority ? { plan: seed.taxAuthority.plan, connected: new Set(), initiallyConnected: seed.taxAuthority.connected ?? false } : null;
    this.due = { items: [...(seed.documentsDue ?? [])], marked: [] };
    this.invoiceSplit = seed.invoiceSplit ?? null;
    this.shareLinks = seed.shareLinks ? new Map(Object.entries(seed.shareLinks).map(([id, links]) => [id, [...links]])) : null;
    for (const v of seed.vendors ?? []) this.linkVendor(v.name, v.categoryId ?? null, { currency: v.currency, vat: v.vat ?? null });
  }

  /** MUT-175: GET /v1/summaries/activity for the named profile (defaults: this month, by day). */
  private activityAnswer(profileId: string | undefined, q: (key: string) => string | undefined) {
    const records = (profileId && this.reports[profileId]) || { payments: this.payments, expenses: this.expenses };
    if (records.refuse === 403) return json({ error: { code: 'INSUFFICIENT_SCOPE', message: 'No access' } }, 403);
    if (records.refuse === 500) return json({ error: { code: 'INTERNAL', message: 'Failed' } }, 500);
    const month = this.today.slice(0, 7);
    const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const bucket = q('bucket') === 'month' ? 'month' : 'day';
    const summary = activitySummary(records, q('from') ?? `${month}-01`, q('to') ?? lastDay, bucket, this.today);
    return json(this.invoiceSplit ? { ...summary, invoiceSplit: this.invoiceSplit } : summary);
  }

  /** MUT-660: documents due, Issue all and the not-for-invoice marks, as the server answers them (in miniature). */
  private dueAnswer(e: Logged, id: string | undefined, q: (key: string) => string | undefined) {
    if (!this.issuing) return notFound();
    const wire = (d: DueSeed, marked: boolean) => ({ kind: marked ? null : d.kind, entry: d.entry, customerId: d.customerId, amount: d.amount, currency: d.currency ?? 'ILS', date: d.date, issuable: !marked && d.issuable !== false, reason: marked ? null : (d.reason ?? null), appliesToDocumentId: null });
    const body = (e.body ?? {}) as { items?: Array<{ kind: string; id: string }>; value?: boolean; customerId?: string | null };
    const same = (d: DueSeed, r: { kind: string; id: string }) => d.entry.id === r.id && d.entry.kind === r.kind;
    if (e.method === 'GET' && id === 'count') return json({ total: this.due.items.length });
    if (e.method === 'GET' && !id) {
      const view = q('view') === 'not-for-invoice' ? 'not-for-invoice' : 'to-issue';
      const months = Number(q('olderThanMonths') ?? '0');
      const cutoff = months ? (() => { const d = new Date(`${this.today}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - months); return d.toISOString().slice(0, 10); })() : null;
      const list = (view === 'to-issue' ? this.due.items : this.due.marked).filter((d) => !cutoff || d.date < cutoff);
      const groups: Array<{ customerId: string | null; items: Json[] }> = [];
      for (const d of list) {
        let g = groups.find((x) => x.customerId === d.customerId);
        if (!g) groups.push((g = { customerId: d.customerId, items: [] }));
        g.items.push(wire(d, view === 'not-for-invoice') as unknown as Json);
      }
      return json({ view, groups, counts: { total: list.length, byKind: {} } });
    }
    if (e.method === 'POST' && id === 'issue') {
      const results = (body.items ?? []).map((r) => {
        const d = this.due.items.find((x) => same(x, r));
        if (!d || d.issuable === false) return { entry: r, status: 'refused', reason: d ? (d.reason ?? 'NOT_ISSUABLE') : 'NOT_DUE', document: null };
        this.due.items = this.due.items.filter((x) => x !== d);
        return { entry: r, status: 'issued', reason: null, document: { id: `doc-${d.entry.id}`, docType: d.kind, number: this.due.items.length + 1, gross: d.amount } };
      });
      return json({ results, issued: results.filter((r) => r.status === 'issued').length });
    }
    if (e.method === 'POST' && id === 'not-for-invoice') {
      const refs = body.items ?? [];
      const from = body.value ? this.due.items : this.due.marked;
      const blocked = body.value ? from.find((d) => refs.some((r) => same(d, r)) && d.hasTaxDocument) : undefined;
      if (blocked) return json({ error: { code: 'CONFLICT', message: 'Has a tax document', details: { reason: 'HAS_TAX_DOCUMENT', kind: blocked.entry.kind, id: blocked.entry.id } } }, 409);
      const moving = from.filter((d) => refs.some((r) => same(d, r)));
      if (body.value) {
        this.due.items = this.due.items.filter((d) => !moving.includes(d));
        this.due.marked.push(...moving);
      } else {
        this.due.marked = this.due.marked.filter((d) => !moving.includes(d));
        this.due.items.push(...moving);
      }
      return json({ changed: moving.length });
    }
    return notFound();
  }

  /** MUT-448: GET /v1/summaries/verdict, canned; with none given, every profile with nothing in this month. */
  private verdictAnswer(q: (key: string) => string | undefined) {
    const given = this.verdicts[q('from') ?? 'current'] ?? this.verdicts['*'];
    if (given && 'refuse' in given) return json({ error: { code: given.refuse === 402 ? 'SUBSCRIPTION_LAPSED' : 'INTERNAL', message: 'Refused' } }, given.refuse);
    if (given) return json(given);
    const month = this.today.slice(0, 7);
    const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
    return json(verdictBody(this.profiles.map((p) => ({ profileId: p.stub.id, name: p.stub.name })), { from: q('from') ?? `${month}-01`, to: q('to') ?? lastDay, asOf: this.today }));
  }

  /** MUT-175: a profile's Reports answers normally again (after a `refuse`). */
  serveReports(profileId: string) {
    const records = this.reports[profileId];
    if (records) this.reports[profileId] = { ...records, refuse: undefined };
  }

  /** The setup link changed behind the page's back: a lost answer that committed, a newer link, an expiry. */
  markSetupLink(state: SetupLinkState) {
    if (this.setupLink) this.setupLink = { ...this.setupLink, state };
  }

  /** The next request matching method + path gets this answer instead (then normal service resumes). */
  once(method: string, path: RegExp, answer: OnceAnswer): void {
    this.onceQueue.push({ method, path, answer });
  }

  /** Every logged call to method + path, in order. */
  calls(method: string, path: RegExp): Logged[] {
    return this.log.filter((entry) => entry.method === method && path.test(entry.path));
  }

  last(method: string, path: RegExp): Logged | undefined {
    return this.calls(method, path).at(-1);
  }

  /** MUT-324: a server release names newer terms; the person is behind until they accept those. */
  bumpTerms(version: string) {
    this.termsVersion = version;
    this.termsAccepted = false;
  }

  me(language: 'en' | 'ar' = 'en') {
    const body = meBody(
      this.profiles.map((p) => p.stub),
      language,
      undefined,
      { version: this.termsVersion, accepted: this.termsAccepted },
    );
    return {
      ...body,
      // MUT-577: seeding accountants also gives this person the operator's accountant_access feature
      user: { ...body.user, closure: this.closure, features: [...body.user.features, ...(this.accountants && this.accountantAccess ? ['accountant_access'] : []), ...(this.issuing ? ['invoicing'] : [])] },
      // MUT-559: present only while the server has accountant access on (the portal's gate, MUT-561 D8)
      ...(this.accountants ? { clients: [] } : {}),
      billingStanding: this.billingStanding,
      ...(this.starter ? { plan: this.starterPlan() } : {}),
      // MUT-731: the server publishes Starter's one business plus the personal profile as the owned-profile cap (me.ts).
      ...(this.starter && !this.starter.cancelled ? { limits: { ...body.limits, maxOwnedProfiles: Math.min(body.limits.maxOwnedProfiles, 2) } } : {}),
      profiles: body.profiles.map((p) => {
        const state = this.profiles.find((s) => s.stub.id === p.id);
        const withState = state ? { ...p, defaultCurrency: state.defaultCurrency, version: state.version } : p;
        return this.starter && withState.owned ? { ...withState, billing: this.starterBilling(withState.id) } : withState;
      }),
    };
  }

  /** MUT-731: /v1/me `plan`. */
  private starterPlan() {
    const s = this.starter!;
    const b = s.businesses;
    const cap = 1;
    const businesses = b && b.active.length + b.readOnly.length > cap ? { cap, active: b.active, readOnly: b.readOnly, mustChoose: b.active.length === 0 } : null;
    return { current: s.cancelled ? null : 'starter', businesses, soloTrialOffer: false };
  }

  /** MUT-731: each owned profile's entitlement: Starter, read-only for the count, or read-only after a cancel. */
  private starterBilling(profileId: string) {
    const s = this.starter!;
    if (s.cancelled) return { state: 'READ_ONLY', source: 'STRIPE', tier: 'FREELANCER', until: null, paused: false };
    if (s.businesses?.readOnly.includes(profileId)) return { state: 'READ_ONLY', source: 'STARTER', tier: 'STARTER', until: null, paused: false, planLimit: true };
    return { state: 'ACTIVE', source: 'STARTER', tier: 'STARTER', until: null, paused: false };
  }

  /** MUT-731: GET /v1/billing, Continue free and the active business, for a Starter person. */
  private starterAnswer(e: Logged, id?: string, sub?: string) {
    const s = this.starter!;
    if (e.method === 'GET' && !id) {
      const meters = (['documents', 'scans'] as const).map((meter) => ({ meter, used: s[meter], limit: STARTER_CAPS[meter], level: starterLevel(s[meter], STARTER_CAPS[meter]) }));
      const plan = this.starterPlan();
      return json({
        ...BILLING_OFF,
        configured: s.sellable !== false,
        catalog: s.sellable === false ? { ILS: null, USD: null } : { ILS: { month: 2900, year: 29000 }, USD: null },
        coveredProfileIds: this.profiles.filter((p) => p.stub.owned).map((p) => p.stub.id),
        currentPlan: plan.current,
        usage: { month: nextMonthStart().slice(0, 7), resetsOn: nextMonthStart(), plan: s.cancelled ? 'none' : 'starter', meters, businesses: { used: 1, limit: 1 }, partners: { limit: 0 } },
        starter: { chosenAt: null, canContinueFree: s.cancelled === true },
        activeBusinesses: plan.businesses,
        countries: { consumer: [], consumerEverywhere: true, customTaxId: ['IL', 'JO'] },
        ...(s.plans ? { plans: QA_PLANS, billingAddress: s.plans.billingAddress ?? null } : {}),
      });
    }
    // MUT-702 Part B: Stripe's side is not driven here; the spec stubs checkout.stripe.com.
    if (e.method === 'POST' && id === 'checkout-session' && s.plans) return json({ url: 'https://checkout.stripe.com/c/pay/qa' });
    if (e.method === 'POST' && id === 'starter') {
      s.cancelled = false;
      return json({ starterChosenAt: new Date().toISOString(), changed: true });
    }
    if (e.method === 'PUT' && id === 'active-businesses' && s.businesses) {
      const [chosen] = ((e.body ?? {}) as { organizationIds?: string[] }).organizationIds ?? [];
      const all = [...s.businesses.active, ...s.businesses.readOnly];
      if (!chosen || !all.includes(chosen)) return notFound();
      s.businesses = { active: [chosen], readOnly: all.filter((x) => x !== chosen) };
      return json({ cap: 1, active: s.businesses.active, readOnly: s.businesses.readOnly, mustChoose: false });
    }
    if (e.method === 'POST' && id === 'solo-trial' && sub === 'offered') return json({ offeredAt: new Date().toISOString() });
    return null;
  }

  /** MUT-731: the server's 409 PLAN_LIMIT at Starter's doors, and the counters moving on success. */
  private starterRefusal(e: Logged, resource?: string, id?: string) {
    const s = this.starter!;
    const limit = (kind: 'documents' | 'scans' | 'businesses') =>
      json({ error: { code: 'PLAN_LIMIT', message: 'limit', details: { limit: kind, plan: 'starter', nextPlan: 'solo', canUpgrade: s.sellable !== false, ...(kind === 'businesses' ? { used: 1, cap: 1 } : { used: s[kind], cap: STARTER_CAPS[kind], resetsOn: nextMonthStart() }) } } }, 409);
    if (resource === 'issued-documents' && e.method === 'POST' && !id) {
      const body = (e.body ?? {}) as { docType?: string; appliesToDocumentId?: string };
      const exempt = body.docType === 'RECEIPT' && Boolean(body.appliesToDocumentId);
      if (!exempt && s.documents >= STARTER_CAPS.documents) return limit('documents');
      s.documents += 1;
    }
    if (resource === 'receipts' && id === 'uploads' && e.method === 'POST') {
      if (s.scans >= STARTER_CAPS.scans) return limit('scans');
      s.scans += 1;
    }
    if (resource === 'profiles' && e.method === 'POST' && !id) {
      const body = (e.body ?? {}) as { carriedOver?: boolean };
      const businesses = this.profiles.filter((p) => p.stub.owned && p.stub.type === 'BUSINESS').length;
      if (!body.carriedOver && businesses >= 1) return limit('businesses');
    }
    return null;
  }

  /** Sign in with every /v1 call answered by this API (and openSignedInPortal's defaults behind it). */
  async open(page: Page, path: string, language: 'en' | 'ar' = 'en', options: { chooseLanguage?: boolean; mode?: 'remote' | 'local' | null } = {}) {
    await page.context().route(`${STORAGE}/**`, (route) => this.serveStorage(route));
    return openSignedInPortal(page, {
      profiles: this.profiles.map((p) => p.stub),
      language,
      path,
      chooseLanguage: options.chooseLanguage,
      mode: options.mode,
      handle: (route, request, url) => this.handle(route, request, url, language),
    });
  }

  private async serveStorage(route: Route) {
    const request = route.request();
    this.storage.push({ method: request.method(), url: request.url() });
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'PUT, GET', 'Access-Control-Allow-Headers': '*' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (request.method() === 'PUT') return route.fulfill({ status: 200, headers: cors, body: '' });
    // MUT-260 (A8): a library receipt's original, by its type, served the way its signed URL asked (inline or attachment).
    const url = new URL(request.url());
    if (url.pathname.includes('/library/')) {
      const mime = url.searchParams.get('mime') ?? 'application/pdf';
      const disposition = url.searchParams.get('disposition') === 'inline' ? 'inline' : 'attachment';
      const body = mime === 'image/png' ? PNG_1PX : mime === 'image/jpeg' ? JPEG_1PX : Buffer.from('%PDF-1.4 qa');
      return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': mime, 'Content-Disposition': `${disposition}; filename="receipt"` }, body });
    }
    return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="file.pdf"' }, body: '%PDF-1.4 qa' });
  }

  private record(request: Request, url: URL): Logged {
    let body: Json | null = null;
    try {
      body = request.postDataJSON() as Json | null;
    } catch {
      body = null;
    }
    const entry = { method: request.method(), path: url.pathname, query: url.searchParams, body, headers: request.headers(), raw: request.postDataBuffer() };
    this.log.push(entry);
    return entry;
  }

  private async handle(route: Route, request: Request, url: URL, language: 'en' | 'ar'): Promise<boolean> {
    const entry = this.record(request, url);
    const queued = this.onceQueue.findIndex((q) => q.method === entry.method && q.path.test(entry.path));
    if (queued >= 0) {
      const [{ answer }] = this.onceQueue.splice(queued, 1);
      if (answer === 'abort') await route.abort('failed');
      else await route.fulfill(json(answer.body ?? {}, answer.status));
      return true;
    }
    if (entry.path.startsWith('/v1/account-setup')) {
      await route.fulfill(this.setupAnswer(entry));
      return true;
    }
    const isSession = entry.path === '/v1/sessions' || entry.path === '/v1/sessions/current';
    if (!this.signedIn && !isSession) {
      await route.fulfill(json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in' } }, 401));
      return true;
    }
    const answer = this.answer(entry, language);
    if (answer === undefined) return false;
    await route.fulfill(answer);
    return true;
  }

  private answer(e: Logged, language: 'en' | 'ar') {
    const { method, path, query } = e;
    const seg = path.split('/').filter(Boolean); // ['v1', resource, id?, sub?, subId?, action?]
    const [, resource, id, sub, subId, action] = seg;
    const q = (key: string) => query.get(key) ?? undefined;
    const named = e.headers['x-mutaba3a-profile'];
    if (named && this.gone.has(named)) return notFound();

    if (resource === 'sessions') {
      if (method === 'POST') {
        this.signedIn = true;
        return json(this.me(language));
      }
      if (method === 'DELETE') {
        this.signedIn = false;
        return { status: 204, body: '' };
      }
    }
    if (resource === 'me' && method === 'GET' && !id) return json(this.me(language));
    // MUT-333: Close my account and Keep my account; while closing, nothing else answers (the server's D3).
    if (resource === 'me' && id === 'closure' && method === 'DELETE') {
      this.closure = null;
      return json({ billingNeedsAttention: false });
    }
    if (this.closure && !(resource === 'device-sessions' && method === 'DELETE')) {
      return json({ error: { code: 'ACCOUNT_CLOSING', message: 'closing', details: { deleteAfter: this.closure.deleteAfter } } }, 403);
    }
    if (resource === 'me' && id === 'closure' && method === 'POST') return this.closeAnswer(e.body as { password?: string } | null);
    // Unseeded, the real API's shape with Stripe off: no subscription, no trial, nothing sellable. (Falling through
    // answered something without `subscription`, which Billing reads as a plan and crashed on, MUT-532.)
    if (resource === 'billing' && this.starter) {
      const answered = this.starterAnswer(e, id, sub);
      if (answered) return answered;
    }
    if (resource === 'billing' && method === 'GET' && !id) return json(this.billingOverview ?? BILLING_OFF);
    // MUT-731: Starter's limits at their doors, as the server refuses them (409 PLAN_LIMIT; nothing done).
    const refusal = this.starter ? this.starterRefusal(e, resource, id) : null;
    if (refusal) return refusal;
    if (resource === 'me' && id === 'terms-acceptance' && method === 'POST') {
      const { version } = (e.body ?? {}) as { version?: string };
      if (version !== this.termsVersion) return json({ error: { code: 'TERMS_VERSION_STALE', message: 'changed', details: { current: this.termsVersion } } }, 409);
      this.termsAccepted = true;
      return json({ version: this.termsVersion, accepted: true });
    }
    if (resource === 'me' && id === 'password' && method === 'POST') return this.changePasswordAnswer(e.body as { currentPassword?: string; newPassword?: string } | null);

    if (resource === 'profiles') return this.profileAnswer(e, id, sub, subId);
    if (resource === 'period-downloads') return this.periodDownloadAnswer(e, id, q);

    if (resource === 'summaries') {
      if (id === 'organization') return json({ asOf: '2026-10-15', currencies: this.summary });
      if (id === 'activity') return this.activityAnswer(named, q);
      if (id === 'verdict') return this.verdictAnswer(q);
      if (id === 'customers' && sub) return this.customerSummaries.has(sub) ? json(this.customerSummaries.get(sub)) : notFound();
    }
    if (resource === 'customers' && method === 'POST' && !id) {
      // MUT-286: the client picker's Add «name». The new client joins the directory the next GET returns.
      const created = { ...customer(this.customers.length), name: String((e.body as { name?: unknown } | null)?.name ?? '') };
      this.customers.push(created);
      return json(created, 201);
    }
    if (resource === 'issuer' || resource === 'issuing' || resource === 'issued-documents') return this.issuingAnswer(e, resource, id, sub, subId);
    if (resource === 'documents-due') return this.dueAnswer(e, id, q);
    // MUT-570: the Owed an issued tax invoice posted, as GET /v1/receivables/{id} reads it.
    if (resource === 'receivables' && method === 'GET' && id && this.issuedOwed(id)) return json(this.issuedOwed(id));
    if (resource === 'business-lookup' && method === 'GET') {
      const found = this.registry.get(q('number') ?? '');
      return found ? json(found) : json({ error: { code: 'NOT_FOUND', message: 'Not in the registry', details: { reason: 'NOT_IN_REGISTRY' } } }, 404);
    }
    if (resource === 'customers' && method === 'PATCH' && id) {
      // MUT-642: the client's VAT or company number and address, If-Match the version read.
      const at = this.customers.findIndex((c) => c.id === id);
      if (at < 0) return notFound();
      const current = this.customers[at];
      if (e.headers['if-match'] !== String(current.version)) return json({ error: { code: 'CONFLICT', message: 'changed', details: { reason: 'VERSION_MISMATCH' } } }, 409);
      const saved = { ...current, ...(e.body as object), version: current.version + 1 };
      this.customers[at] = saved;
      return json(saved);
    }
    if (resource === 'customers' && method === 'GET' && id && sub === 'statement') return this.statementAnswer(id, q);
    if (resource === 'customers' && method === 'GET') {
      if (!id) return page(this.customers);
      const found = this.customers.find((c) => c.id === id);
      return found ? json(found) : notFound();
    }
    if (resource === 'projects' && method === 'POST' && !id) {
      // MUT-318: the matter picker's Add «name». The new matter joins every matter list the next GET returns.
      const b = (e.body ?? {}) as { customerId?: string; name?: string; currency?: Currency };
      const created = project(this.projects.length + 900, b.customerId ?? '', b.name ?? '', b.currency ?? 'ILS');
      this.projects.push(created);
      return json(created, 201);
    }
    if (resource === 'projects' && method === 'GET') {
      const customerId = q('customerId');
      return page(this.projects.filter((p) => !customerId || p.customerId === customerId));
    }
    if (resource === 'receivables') return this.receivableAnswer(e, id, sub);
    if (resource === 'payments' && method === 'GET' && !id) {
      return page(this.payments.filter((p) => (!q('status') || p.status === q('status')) && (!q('customerId') || p.customerId === q('customerId'))));
    }
    if (resource === 'payments' && id) return this.paymentAnswer(e, id, sub);
    if (resource === 'income' && method === 'POST') return this.income(e.body ?? {});
    if (resource === 'income' && method === 'PATCH' && id) return this.redateIncome(e, id);
    if (resource === 'attachments' && method === 'GET') {
      if (!id) return page(this.attachments.filter((a) => (!q('kind') || a.kind === q('kind')) && (!q('customerId') || a.customerId === q('customerId'))));
      const found = this.attachments.find((a) => a.id === id);
      if (found && sub === 'download') return json({ url: `${STORAGE}/${encodeURIComponent(found.filename)}`, expiresAt: '2026-10-15T12:15:00Z', filename: found.filename, mimeType: found.mimeType });
      return notFound();
    }
    if (resource === 'expense-categories' && method === 'GET') {
      const asked = e.headers['accept-language'];
      const lang = asked === 'en' || asked === 'ar' ? asked : language;
      return json({ items: this.categories.map(({ nameAr, ...c }: ReturnType<typeof category> & { nameAr?: string }) => (nameAr && lang === 'ar' ? { ...c, name: nameAr } : c)) });
    }
    if (resource === 'expenses') return this.expenseAnswer(e, id, sub, subId, action);
    if (resource === 'vendors' && method === 'GET') return this.vendorAnswer(e);
    if (resource === 'expense-groups') return this.groupAnswer(e, id, sub, subId);
    if (resource === 'fx-rates' && method === 'GET') return this.fxRates === 'unavailable' ? json({ error: { code: 'FX_RATES_UNAVAILABLE', message: 'No rates' } }, 503) : json(this.fxRates);
    if (resource === 'conversions') return this.conversionAnswer(e, id);
    if (resource === 'receipts') return this.libraryAnswer(e, id, sub);
    return undefined;
  }

  /**
   * MUT-664: GET /v1/customers/{id}/statement, the ledger card, from the fake's receivables and payments in one
   * currency: charges debit, payments credit, running balance oldest first, served in the asked order. No documents.
   */
  private statementAnswer(customerId: string, q: (key: string) => string | undefined) {
    const currency = q('currency') ?? 'ILS';
    const toAmount = (minor: number) => toDecimal(minor);
    const raw = [
      ...this.receivables.filter((r) => r.customerId === customerId && r.currency === currency).map((r) => ({ id: r.id, date: r.postingDate as string, debit: toMinor(r.gross), credit: 0, line: { kind: 'CHARGE' as const, receivableId: r.id, number: (r as { number?: string }).number ?? null, outstanding: r.outstanding } })),
      ...this.payments.filter((p) => p.customerId === customerId && p.currency === currency && p.status === 'POSTED').map((p) => ({ id: p.id, date: p.receivedOn as string, debit: 0, credit: toMinor(p.amount), line: { kind: 'PAYMENT' as const, paymentId: p.id, number: p.number } })),
      ...this.issuedLines(customerId),
    ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : LINE_RANK[a.line.kind as string]! - LINE_RANK[b.line.kind as string]!));
    let running = 0;
    const lines = raw.map((x) => {
      running += x.debit - x.credit;
      return { ...x.line, id: x.id, date: x.date, projectId: null, debit: toAmount(x.debit), credit: toAmount(x.credit), runningBalance: toAmount(running), documents: [], due: null };
    });
    const closing = toAmount(running);
    return json({ customerId, currency, projectId: null, from: q('from') ?? null, to: q('to') ?? null, asOf: '2026-10-15', openingBalance: '0.00', totals: { debit: toAmount(raw.reduce((s, x) => s + x.debit, 0)), credit: toAmount(raw.reduce((s, x) => s + x.credit, 0)) }, closingBalance: closing, lines: q('order') === 'desc' ? lines.reverse() : lines, nextCursor: null });
  }

  /**
   * MUT-643: the ledger lines issued documents make for a client, in the order the server's classifier ranks them:
   * an Owed's charge, a 320's payment, a credit note's credit, a refund's debit.
   */
  private issuedLines(customerId: string) {
    type Raw = { id: string; date: string; debit: number; credit: number; line: Record<string, Json> };
    const out: Raw[] = [];
    for (const state of this.issuing?.values() ?? []) {
      for (const d of [...state.docs].reverse()) {
        if (d.customerId !== customerId) continue;
        const gross = toMinor(String(d.gross));
        const date = String(d.documentDate);
        if (d.docType === 'TAX_INVOICE' || d.docType === 'TAX_INVOICE_RECEIPT') out.push({ id: `${d.id}:charge`, date, debit: gross, credit: 0, line: { kind: 'CHARGE', receivableId: d.receivableId ?? null, number: String(d.number), outstanding: '0.00' } });
        if (d.docType === 'TAX_INVOICE_RECEIPT') out.push({ id: `${d.id}:payment`, date, debit: 0, credit: gross, line: { kind: 'PAYMENT', paymentId: `${d.id}:payment`, number: String(d.number) } });
        if (d.docType === 'CREDIT_NOTE') out.push({ id: `${d.id}:credit`, date, debit: 0, credit: gross, line: { kind: 'CREDIT', receivableId: null, number: null } });
      }
      for (const f of state.refunds ?? []) if (f.customerId === customerId) out.push({ id: f.id, date: f.refundedOn, debit: f.amount, credit: 0, line: { kind: 'REFUND', refundId: f.id, creditNoteId: f.creditNoteId, method: f.method, reference: f.reference, number: null } });
    }
    return out;
  }

  /** MUT-260: GET /v1/receipts (and counts, one, download), library uploads, approve and delete, as MUT-255 answers them. */
  private libraryAnswer(e: Logged, id: string | undefined, sub: string | undefined) {
    const library = this.libraryReceipts;
    if (!library) return notFound();
    const q = (key: string) => e.query.get(key) ?? undefined;
    // MUT-503: a receipt with a profile is that profile's only, so a move takes it from one list to the other.
    const here = e.headers['x-mutaba3a-profile'];
    const mine = (r: StubLibraryReceipt) => !r.profileId || r.profileId === here;
    const ready = library.filter((r) => r.status === 'READY' && mine(r));
    if (e.method === 'GET' && !id) {
      const status = q('filingStatus');
      const rows = ready.filter((r) => !status || r.filingStatus === status).map((r) => this.libraryItem(r));
      return paged(rows, Number(q('limit') ?? 24), q('cursor'));
    }
    if (e.method === 'GET' && id === 'counts') return json({ toReview: ready.filter((r) => r.filingStatus === 'TO_REVIEW').length, filed: ready.filter((r) => r.filingStatus === 'FILED').length });
    if (e.method === 'POST' && id === 'uploads') {
      const b = e.body as { filename: string; mimeType: StubLibraryReceipt['mimeType']; sizeBytes: number };
      const made = libraryReceipt(0, { id: this.nextId(0xb), filename: b.filename, mimeType: b.mimeType, sizeBytes: b.sizeBytes, status: 'PENDING_UPLOAD', receivedOn: this.today, completedAt: null });
      library.unshift(made);
      return json({ receipt: made, upload: { url: `${STORAGE}/upload/${made.id}`, method: 'PUT', headers: { 'Content-Type': b.mimeType }, expiresAt: '2099-01-01T00:00:00Z' } }, 201);
    }
    const found = library.find((r) => r.id === id && mine(r));
    if (!found) return notFound();
    if (e.method === 'GET' && !sub) return json({ ...found, vendorDefaults: this.receiptVendorDefaults(found, here) });
    if (e.method === 'POST' && sub === 'move') return this.moveAnswer(found, here, (e.body as { profileId: string }).profileId);
    if (e.method === 'DELETE' && !sub) {
      library.splice(library.indexOf(found), 1);
      return { status: 204, body: '' };
    }
    if (e.method === 'POST' && sub === 'complete') {
      found.status = 'READY';
      found.completedAt = STAMP;
      return json(found);
    }
    if (e.method === 'GET' && sub === 'download') {
      if (found.status !== 'READY') return json({ error: { code: 'VALIDATION_FAILED', message: 'Not ready', details: { reason: 'ATTACHMENT_NOT_READY' } } }, 422);
      const disposition = q('disposition') === 'inline' ? 'inline' : 'attachment';
      return json({ url: `${STORAGE}/library/${found.id}?mime=${encodeURIComponent(found.mimeType)}&disposition=${disposition}`, expiresAt: '2099-01-01T00:00:00Z', filename: found.filename, mimeType: found.mimeType });
    }
    if (e.method === 'POST' && sub === 'approve') {
      if (found.filingStatus === 'FILED') return json({ error: { code: 'CONFLICT', message: 'Already filed', details: { reason: 'RECEIPT_ALREADY_FILED', expenseId: found.expenseId } } }, 409);
      if (found.status !== 'READY') return json({ error: { code: 'VALIDATION_FAILED', message: 'Not ready', details: { reason: 'ATTACHMENT_NOT_READY' } } }, 422);
      const b = { ...(e.body as Json) };
      delete b.suggested;
      delete b.captureSource;
      const made = { ...expense(this.serial++, { amount: String(b.amount), currency: b.currency as Currency }), ...b, id: this.nextId(0x9), receipts: [] as StubReceipt[] } as StubExpense;
      delete (made as { vendorDetails?: unknown }).vendorDetails;
      const vatIn = (b.vat as VendorVatStub | null | undefined) ?? null;
      made.vat = splitExpenseVat(made.amount, made.currency as Currency, vatIn);
      stampAllocationNumber(made);
      made.vendorId = this.linkVendor(made.vendor, made.categoryId, { currency: made.currency, vat: vatIn });
      this.expenses.unshift(made);
      Object.assign(found, { filingStatus: 'FILED', expenseId: made.id, approvedAt: STAMP, version: found.version + 1, approved: { occurredOn: made.occurredOn, amountMinor: '0', currency: made.currency, vendor: made.vendor, categoryId: made.categoryId } });
      return json({ expense: listed(made), receipt: found }, 201);
    }
    return undefined;
  }

  /**
   * MUT-589 (ADR-255): the expense move's preview (`expectedVersion` null) and the move, as the server answers them:
   * the same profile 422, a profile not the person's 404, a lapsed target 402, a stale version 409; the move takes the
   * expense and its filed library receipts to the target, with the seeded changes.
   */
  private expenseMoveAnswer(found: StubExpense, from: string | undefined, to: string, expectedVersion: number | null) {
    if (to === from) return json({ error: { code: 'VALIDATION_FAILED', message: 'Same profile', details: { reason: 'SAME_PROFILE' } } }, 422);
    const target = this.profiles.find((p) => p.stub.id === to)?.stub;
    if (!target) return json({ error: { code: 'NOT_FOUND', message: 'No such profile', details: { reason: 'PROFILE_NOT_FOUND' } } }, 404);
    const state = target.billing?.state;
    if (state === 'READ_ONLY' || state === 'LOCKED') return json({ error: { code: 'SUBSCRIPTION_LAPSED', message: 'Lapsed', details: { profileId: to, state, source: target.billing?.source ?? 'NONE', until: null } } }, 402);
    const filed = (this.libraryReceipts ?? []).filter((r) => r.expenseId === found.id && r.status === 'READY');
    const changes = this.expenseMoveChanges;
    if (expectedVersion === null) return json({ changes, receiptCount: filed.length + found.receipts.filter((r) => r.status === 'READY').length, expenseVersion: found.version });
    if (expectedVersion !== found.version) return conflict('VERSION_MISMATCH');
    Object.assign(found, { profileId: to, version: found.version + 1 });
    for (const r of filed) Object.assign(r, { profileId: to, version: r.version + 1 });
    return json({ expense: found, fromProfileId: from, changes });
  }

  /** MUT-503: POST /v1/receipts/{id}/move, as the server answers it: filed 409, a lapsed target 402, else moved. */
  private moveAnswer(found: StubLibraryReceipt, from: string | undefined, to: string) {
    if (found.filingStatus === 'FILED') return json({ error: { code: 'CONFLICT', message: 'Already filed', details: { reason: 'RECEIPT_ALREADY_FILED', expenseId: found.expenseId } } }, 409);
    const target = this.profiles.find((p) => p.stub.id === to)?.stub;
    if (!target || to === from) return json({ error: { code: 'NOT_FOUND', message: 'No such profile', details: { reason: 'PROFILE_NOT_FOUND' } } }, 404);
    const state = target.billing?.state;
    if (state === 'READ_ONLY' || state === 'LOCKED') return json({ error: { code: 'SUBSCRIPTION_LAPSED', message: 'Lapsed', details: { profileId: to, state, source: target.billing?.source ?? 'NONE', until: null } } }, 402);
    Object.assign(found, { profileId: to, version: found.version + 1, approved: null, approvedAt: null });
    return json({ receipt: found, fromProfileId: from });
  }

  /** A list row: the receipt and, when filed on an expense that still exists, that expense's summary (MUT-258). */
  private libraryItem(r: StubLibraryReceipt) {
    const x = r.expenseId ? this.expenses.find((e) => e.id === r.expenseId) : undefined;
    return { ...r, expense: x ? { vendor: x.vendor, title: x.title, amount: x.amount, currency: x.currency, occurredOn: x.occurredOn, categoryId: x.categoryId } : null };
  }

  /** MUT-237: a wrong current password is refused; a correct one replaces it, as the server does. */
  /** MUT-333: 30 days from now, as the server counts it. */
  /**
   * MUT-647: invoices issued elsewhere, the way the server answers them: read (nothing kept), attach (one per entry;
   * 409 EXTERNAL_INVOICE_EXISTS, 409 ISSUED_HERE for an Owed MTB3A issued), list by entry, open the file, remove.
   */
  private externalAnswer(e: Logged, state: StubIssuing, sub: string | undefined, subId: string | undefined) {
    const { method, query: q } = e;
    if (sub === 'read' && method === 'POST') return json(this.externalReading);
    if (!sub && method === 'POST') {
      const entryKind = q.get('entryKind') ?? '';
      const entryId = q.get('entryId') ?? '';
      const owed = entryKind === 'OWED' ? this.receivables.find((r) => r.id === entryId) : undefined;
      const received = entryKind === 'RECEIVED' ? this.payments.find((p) => p.id === entryId) : undefined;
      if (!owed && !received) return notFound();
      if (owed?.origin === 'ISSUED_DOCUMENT') return conflict('ISSUED_HERE');
      const live = state.external.find((x) => x.entryKind === entryKind && x.entryId === entryId);
      if (live) return json({ error: { code: 'CONFLICT', message: 'exists', details: { reason: 'EXTERNAL_INVOICE_EXISTS', externalInvoiceId: live.id } } }, 409);
      const made = {
        id: uid(0xe7, state.external.length + 1),
        entryKind,
        entryId,
        attachmentId: uid(0xe8, state.external.length + 1),
        number: q.get('number') ?? '',
        documentDate: q.get('documentDate') ?? '',
        filename: q.get('filename') ?? 'invoice',
        mimeType: e.headers['content-type'] ?? 'application/pdf',
        sizeBytes: e.raw?.length ?? 0,
        createdAt: STAMP,
      };
      state.external.push(made);
      return json(made, 201);
    }
    if (!sub && method === 'GET') {
      const ids = new Set((q.get('entryIds') ?? '').split(',').filter(Boolean));
      return json({ items: state.external.filter((x) => x.entryKind === q.get('entryKind') && ids.has(x.entryId)) });
    }
    const found = state.external.find((x) => x.id === sub);
    if (!found) return notFound();
    if (subId === 'file' && method === 'GET') return json({ url: `${STORAGE}/external/${found.id}?disposition=inline`, expiresAt: '2099-01-01T00:00:00Z', filename: found.filename, mimeType: found.mimeType });
    if (!subId && method === 'DELETE') {
      state.external = state.external.filter((x) => x !== found);
      return { status: 204, body: '' };
    }
    return notFound();
  }

  /** MUT-646: the invoicing setup's routes, the way the server answers them (the gate's own rules: details and numbering). */
  private issuingAnswer(e: Logged, resource: string, id: string | undefined, sub: string | undefined, subId?: string) {
    const profileId = e.headers['x-mutaba3a-profile'];
    const profile = this.profiles.find((p) => p.stub.id === profileId);
    if (!this.issuing || !profile || profile.stub.type === 'PERSONAL') return notFound();
    let state = this.issuing.get(profileId!);
    if (!state) {
      state = { issuer: null, logo: null, introSeen: false, numbering: false, defaults: false, starts: {}, docs: [], owed: new Map(), external: [] };
      if (this.invoicingReady) {
        state.issuer = { ...ISSUER_DEFAULTS, offerAfterSave: this.offerAfterSave, legalName: 'Nour Studio Ltd.', vatId: '516123452', dealerType: 'COMPANY', address: '12 Hermon St', city: 'Nazareth', phone: null, email: null, website: null, version: 1 };
        Object.assign(state, { introSeen: true, numbering: true, defaults: true });
      } else if (this.invoicingDetailsOnly) {
        state.issuer = { ...ISSUER_DEFAULTS, offerAfterSave: this.offerAfterSave, legalName: 'Nour Studio Ltd.', vatId: '516123452', dealerType: 'COMPANY', address: '12 Hermon St', city: 'Nazareth', phone: null, email: null, website: null, version: 1 };
        state.introSeen = true;
      }
      this.issuing.set(profileId!, state);
    }
    const body = (e.body ?? {}) as Record<string, Json>;
    const ifMatch = e.headers['if-match'] === undefined ? null : Number(e.headers['if-match']);
    const missingOf = () => [...(state.issuer ? [] : ['DETAILS']), ...(state.numbering ? [] : ['NUMBERING'])];
    const setup = () => {
      const missing = missingOf();
      const done = (ok: boolean) => (ok ? 'done' : 'todo');
      return json({
        steps: { details: done(!!state.issuer), logo: done(!!state.logo), defaults: done(state.defaults), numbering: done(state.numbering), taxAuthority: this.automaticAllocation(profileId!) ? 'done' : 'later' },
        canIssue: missing.length === 0,
        missing,
        introSeen: state.introSeen,
        hasLogo: !!state.logo,
      });
    };
    const { method } = e;
    if (resource === 'issued-documents') return this.issuedAnswer(e, state, id, sub, missingOf());
    if (resource === 'issuing') {
      if (id === 'external-invoices') return this.externalAnswer(e, state, sub, subId);
      if (id === 'setup' && !sub && method === 'GET') return setup();
      if (id === 'setup' && sub === 'intro-seen' && method === 'POST') {
        state.introSeen = true;
        return setup();
      }
      if (id === 'numbering' && method === 'PUT') {
        state.numbering = true;
        state.starts = { ...state.starts, ...((body.starts ?? {}) as Record<string, number>) };
        return setup();
      }
      if (id === 'styles' && method === 'GET') return json({ styles: [{ key: 'PROFESSIONAL' }, { key: 'MODERN' }, { key: 'MINIMAL' }] });
      // MUT-569: the uniform file: the documents dated in the range, counted as the API counts them; the zip is a stand-in.
      if (id === 'uniform-file' && method === 'GET') {
        const from = e.query.get('from') ?? '';
        const to = e.query.get('to') ?? '';
        if (!state.issuer) return json({ error: { code: 'VALIDATION_FAILED', message: 'Add the business details printed on documents first', details: { reason: 'ISSUER_DETAILS_REQUIRED' } } }, 422);
        if (from > to) return json({ error: { code: 'VALIDATION_FAILED', message: 'to comes before from', details: { reason: 'PERIOD_RANGE', field: 'to' } } }, 422);
        const docs = state.docs.filter((d) => String(d.documentDate) >= from && String(d.documentDate) <= to);
        const records = 2 + docs.reduce((sum, d) => sum + 1 + (d.docType === 'RECEIPT' ? 0 : ((d.lines as Json[] | undefined)?.length ?? 1)) + (d.paymentDetails ? 1 : 0), 0);
        const filename = `OPENFRMT-${String(state.issuer.vatId)}-${from}_${to}.zip`;
        return { status: 200, contentType: 'application/zip', headers: { 'Content-Disposition': `attachment; filename="${filename}"`, 'X-Uniform-File-Documents': String(docs.length), 'X-Uniform-File-Records': String(records) }, body: 'PK qa' };
      }
      if (id === 'tax-authority') return this.taxAuthorityAnswer(e, profileId!, sub);
      if (id === 'settings' && method === 'GET') {
        return json({ counters: ISSUED_DOC_TYPES.map((docType) => ({ docType, start: state.starts[docType] ?? 1, next: state.starts[docType] ?? 1, hasDocuments: false })) });
      }
      return notFound();
    }
    if (!id && method === 'GET') return state.issuer ? json(state.issuer) : json({ error: { code: 'NOT_FOUND', message: 'No business details yet', details: { reason: 'ISSUER_DETAILS_REQUIRED' } } }, 404);
    if (!id && method === 'PUT') {
      if ((ifMatch === null) !== !state.issuer || (state.issuer && state.issuer.version !== ifMatch)) return conflict('VERSION_MISMATCH');
      const kept = state.issuer ?? ISSUER_DEFAULTS;
      state.issuer = { ...ISSUER_DEFAULTS, ...kept, address: null, city: null, phone: null, email: null, website: null, ...body, version: (state.issuer?.version ?? 0) + 1 };
      return json(state.issuer);
    }
    if (id === 'defaults' && method === 'PUT') {
      if (!state.issuer) return json({ error: { code: 'VALIDATION_FAILED', message: 'details first', details: { reason: 'ISSUER_DETAILS_REQUIRED' } } }, 422);
      if (state.issuer.version !== ifMatch) return conflict('VERSION_MISMATCH');
      state.issuer = { ...state.issuer, paymentTermsDays: null, bankDetails: null, footerNote: null, ...body, version: state.issuer.version + 1 };
      state.defaults = true;
      return json(state.issuer);
    }
    if (id === 'logo') {
      if (method === 'PUT') {
        state.logo = { type: e.headers['content-type'] ?? 'image/png', bytes: e.raw ?? PNG_1PX };
        return { status: 204, body: '' };
      }
      if (method === 'DELETE') {
        state.logo = null;
        return { status: 204, body: '' };
      }
      if (method === 'GET') return state.logo ? { status: 200, contentType: state.logo.type, body: state.logo.bytes } : notFound();
    }
    return notFound();
  }

  /** MUT-570: issued documents as the server answers them: 18% VAT, gap-free numbers per type, an Owed per tax invoice. */
  private issuedAnswer(e: Logged, state: StubIssuing, id: string | undefined, sub: string | undefined, missing: string[]) {
    const { method } = e;
    const pdf = { status: 200, contentType: 'application/pdf', body: '%PDF-1.4 qa' };
    // MUT-662: a payment request carries its derived status and its PR-0007 number, as the server's serializer does.
    const withFacts = (d: Record<string, Json>) => {
      const displayNumber = d.docType === 'PAYMENT_REQUEST' ? `PR-${String(d.number).padStart(4, '0')}` : String(d.number);
      if (d.docType !== 'PAYMENT_REQUEST') return { ...d, displayNumber, paymentRequest: null };
      const linked = state.docs.filter((x) => x.originalId === d.id && (x.docType === 'TAX_INVOICE_RECEIPT' || x.docType === 'RECEIPT')).reverse();
      const covered = linked.reduce((sum, x) => sum + toMinor(String(x.gross)), 0);
      const cancellation = (d.cancellation as Record<string, Json> | undefined) ?? null;
      const status = cancellation ? 'CANCELLED' : covered >= toMinor(String(d.gross)) ? 'PAID' : covered > 0 ? 'PARTLY_PAID' : 'UNPAID';
      return { ...d, displayNumber, paymentRequest: { status, covered: toDecimal(covered), linked: linked.map((x) => ({ id: x.id, docType: x.docType, number: x.number, gross: x.gross })), cancellation } };
    };
    if (method === 'GET' && !id) {
      const customerId = e.query.get('customerId');
      return page(state.docs.filter((d) => !customerId || d.customerId === customerId).map(withFacts));
    }
    if (method === 'POST' && id && sub === 'cancel') {
      const d = state.docs.find((x) => x.id === id);
      if (!d) return notFound();
      if (d.docType !== 'PAYMENT_REQUEST') return json({ error: { code: 'VALIDATION_FAILED', message: 'not a request', details: { reason: 'NOT_A_PAYMENT_REQUEST' } } }, 422);
      if (d.cancellation) return json({ error: { code: 'CONFLICT', message: 'cancelled', details: { reason: 'ALREADY_CANCELLED' } } }, 409);
      if ((withFacts(d).paymentRequest as { linked: unknown[] }).linked.length > 0) return json({ error: { code: 'CONFLICT', message: 'has documents', details: { reason: 'PAYMENT_REQUEST_HAS_DOCUMENTS' } } }, 409);
      const number = state.docs.filter((x) => x.cancellation).length + 1;
      d.cancellation = { number, displayNumber: `CX-${String(number).padStart(4, '0')}`, cancelledAt: '2026-11-22T11:00:00.000Z', reason: ((e.body as Record<string, Json> | null)?.reason as string | null) ?? null };
      return json(withFacts(d));
    }
    if (id === 'preview' && method === 'POST') {
      if (sub === 'pdf') return pdf;
      const body = e.body as Record<string, Json>;
      const totals = this.composeDoc(body);
      const facts = body.docType === 'CREDIT_NOTE' ? this.creditFacts(state, body.originalId as string | undefined, toMinor(totals.gross)) : null;
      const creditNote = facts ? { outstanding: toDecimal(facts.outstanding), paid: toDecimal(facts.paid), maximum: toDecimal(facts.maximum) } : null;
      const automatic = this.automaticAllocation(String(e.headers['x-mutaba3a-profile']));
      return json({ ...totals, creditNote, allocation: this.needsAllocation(body, totals.net) ? { mode: automatic ? 'AUTOMATIC' : 'MANUAL', nextNumber: this.nextNumber(state, String(body.docType)), documentDate: body.documentDate, net: totals.net, customerTaxId: '516123452', requestUrl: 'https://www.gov.il/he/departments/israel_tax_authority/govil-landing-page', automaticOn: this.automaticOn() } : null });
    }
    if (method === 'GET' && id && !sub) {
      const d = state.docs.find((x) => x.id === id);
      return d ? json(withFacts(d)) : json(null, 404);
    }
    if (id && sub === 'pdf') return pdf;
    if (method === 'POST' && !id) {
      if (missing.length) return json({ error: { code: 'CONFLICT', message: 'setup', details: { reason: 'ISSUING_SETUP_INCOMPLETE', missing } } }, 409);
      const body = e.body as Record<string, Json>;
      const docType = String(body.docType);
      const totals = this.composeDoc(body);
      const number = this.nextNumber(state, docType);
      // MUT-711 (ADR-273): the number is only a preview; a manual allocation number must be for the number this one takes.
      let allocationNumber: string | null = null;
      let allocationSource: 'API' | 'MANUAL' | null = null;
      if (this.needsAllocation(body, totals.net) && this.automaticAllocation(String(e.headers['x-mutaba3a-profile'])) && !body.manualAllocation) {
        // MUT-572: connected on a paid plan, the Tax Authority answers the number (its stand-in: 9 digits from the number).
        allocationNumber = String(100_000_000 + number);
        allocationSource = 'API';
      } else if (this.needsAllocation(body, totals.net)) {
        const manual = body.manualAllocation as { number?: string; forNumber?: number } | undefined;
        if (!manual) return json({ error: { code: 'CONFLICT', message: 'needs a number', details: { reason: 'ALLOCATION_NUMBER_REQUIRED', field: 'manualAllocation', next: number, automaticOn: this.automaticOn() } } }, 409);
        const digits = String(manual.number ?? '').replace(/[\s-]/g, '');
        if (!/^\d{9}$/.test(digits)) return json({ error: { code: 'VALIDATION_FAILED', message: 'nine digits', details: { reason: 'ALLOCATION_NUMBER_INVALID', field: 'allocationNumber' } } }, 422);
        if (manual.forNumber !== number) return json({ error: { code: 'CONFLICT', message: `now ${number}`, details: { reason: 'ALLOCATION_NUMBER_MOVED', field: 'manualAllocation', requestedFor: manual.forNumber ?? null, next: number } } }, 409);
        allocationNumber = digits;
        allocationSource = 'MANUAL';
      }
      const customer = this.customers.find((c) => c.id === body.customerId);
      const docId = uid(0xd0, state.docs.length + 1);
      const gross = toMinor(totals.gross);
      let receivableId: string | null = null;
      // MUT-643: an invoice-receipt posts its own Owed too, paid in full on issue.
      if (docType === 'TAX_INVOICE' || docType === 'PAYMENT_REQUEST' || docType === 'TAX_INVOICE_RECEIPT') {
        receivableId = uid(0xe0, state.docs.length + 1);
        state.owed.set(receivableId, { gross, outstanding: docType === 'TAX_INVOICE_RECEIPT' ? 0 : gross, credited: 0, customerId: (body.customerId as string) ?? null, docId, postingDate: String(body.documentDate) });
      }
      const target = (body.originalId ?? body.appliesToDocumentId) as string | undefined;
      let refundId: string | null = null;
      if (target && docType === 'CREDIT_NOTE') {
        // MUT-643 (ADR-276): the cap, then what is owed, then the paid part, which needs a choice.
        const facts = this.creditFacts(state, target, gross);
        const original = state.docs.find((d) => d.id === target);
        const owed = original?.receivableId ? state.owed.get(String(original.receivableId)) : undefined;
        if (!facts || !owed) return notFound();
        if (gross > facts.maximum) return json({ error: { code: 'VALIDATION_FAILED', message: 'over the original', details: { reason: 'CREDIT_EXCEEDS_ORIGINAL', field: 'lines', maximum: String(facts.maximum) } } }, 422);
        const paidPart = body.paidPart as { mode: string; refundedOn?: string; method?: string; reference?: string | null } | undefined;
        if (facts.paid > 0 && !paidPart) return json({ error: { code: 'VALIDATION_FAILED', message: 'paid part', details: { reason: 'ORIGINAL_PAID', field: 'paidPart', outstanding: String(facts.outstanding), paid: String(facts.paid) } } }, 422);
        owed.outstanding -= facts.outstanding < gross ? facts.outstanding : gross;
        owed.credited = (owed.credited ?? 0) + gross;
        if (facts.paid > 0 && paidPart?.mode === 'REFUND') {
          refundId = uid(0xf0, (state.refunds ?? []).length + 1);
          (state.refunds ??= []).push({ id: refundId, customerId: String(body.customerId), amount: facts.paid, refundedOn: paidPart.refundedOn ?? String(body.documentDate), creditNoteId: docId, method: paidPart.method ?? 'BANK', reference: paidPart.reference ?? null });
        }
      } else if (target) {
        const original = state.docs.find((d) => d.id === target);
        const owed = original?.receivableId ? state.owed.get(String(original.receivableId)) : undefined;
        if (owed) {
          if (gross > owed.outstanding) return json({ error: { code: 'VALIDATION_FAILED', message: 'too much', details: { reason: 'EXCEEDS_OUTSTANDING' } } }, 422);
          owed.outstanding -= gross;
        }
      }
      const doc = { ...totals, id: docId, docType, number, documentDate: body.documentDate, issuedAt: '2026-11-22T10:00:00.000Z', currency: 'ILS', language: body.language, style: 'PROFESSIONAL', ink: 'BLACK', customerId: body.customerId ?? null, customer: customer ? { name: customer.name } : {}, issuer: state.issuer ?? {}, notes: body.notes ?? null, originalId: target ?? null, paymentDetails: body.payment ?? null, allocationNumber, allocationSource, receivableId, paymentId: null, refundId, coreVersion: '1.0.0' };
      state.docs.unshift(doc);
      return json(withFacts(doc), 201);
    }
    return notFound();
  }

  /** MUT-643: a credit note's facts against its original: still owed, the part of this credit already paid, the cap. */
  private creditFacts(state: StubIssuing, originalId: string | undefined, creditMinor: number): { outstanding: number; paid: number; maximum: number } | null {
    const original = state.docs.find((d) => d.id === originalId && (d.docType === 'TAX_INVOICE' || d.docType === 'TAX_INVOICE_RECEIPT'));
    const owed = original?.receivableId ? state.owed.get(String(original.receivableId)) : undefined;
    if (!owed) return null;
    const maximum = owed.gross - (owed.credited ?? 0);
    const upTo = creditMinor < maximum ? creditMinor : maximum;
    return { outstanding: owed.outstanding, paid: upTo > owed.outstanding ? upTo - owed.outstanding : 0, maximum };
  }

  /** The number the next document of this type takes (gap-free per type). */
  private nextNumber(state: StubIssuing, docType: string): number {
    return (state.starts[docType] ?? 1) + state.docs.filter((d) => d.docType === docType).length;
  }

  /** MUT-711: a tax invoice of 5,000.00 or more before VAT to a client, where allocation numbers are in play here. */
  private needsAllocation(body: Record<string, Json>, net: string): boolean {
    return (this.manualAllocation || !!this.taxAuthority) && (body.docType === 'TAX_INVOICE' || body.docType === 'TAX_INVOICE_RECEIPT') && !!body.customerId && toMinor(net) >= 500_000;
  }

  /** MUT-736: MTB3A requests the number itself: the Tax Authority is on, the plan includes it and the profile is connected. */
  private automaticAllocation(profileId: string): boolean {
    return !!this.taxAuthority && this.taxAuthority.plan !== 'starter' && this.isConnected(profileId);
  }

  /** MUT-736: the plan on which numbers would come automatically, when the plan is why they don't. */
  private automaticOn(): 'solo' | null {
    return this.taxAuthority?.plan === 'starter' ? 'solo' : null;
  }

  private isConnected(profileId: string): boolean {
    return !!this.taxAuthority && (this.taxAuthority.connected.has(profileId) || this.taxAuthority.initiallyConnected);
  }

  /** MUT-571 + MUT-736: the Tax Authority step's routes. 404 where the Tax Authority isn't on here (no seed). */
  private taxAuthorityAnswer(e: Logged, profileId: string, sub: string | undefined) {
    const ta = this.taxAuthority;
    if (!ta) return json({ error: { code: 'NOT_FOUND', message: 'Not found', details: { reason: 'TAX_AUTHORITY_OFF' } } }, 404);
    const allowed = ta.plan !== 'starter';
    const plan = { allowed, nextPlan: allowed ? null : 'solo' };
    if (!sub && e.method === 'GET') {
      const connected = this.isConnected(profileId);
      if (!connected) return json({ state: 'none', connectedAt: null, until: null, environment: null, plan });
      return json({ state: allowed ? 'connected' : 'suspended', connectedAt: '2026-11-01T10:00:00.000Z', until: '2027-01-30T10:00:00.000Z', environment: 'sandbox', plan });
    }
    if (sub === 'connect' && e.method === 'POST') {
      if (!allowed) return json({ error: { code: 'PLAN_LIMIT', message: 'The Tax Authority connection is on Solo and above', details: { limit: 'taxAuthority', plan: 'starter', nextPlan: 'solo', canUpgrade: true } } }, 409);
      // The stand-in sign-in: the owner approves at once and the browser comes back to the setup, as the callback sends it.
      ta.connected.add(profileId);
      return json({ authorizeUrl: `/p/${profileId}/you/invoicing?taxAuthority=connected` });
    }
    if (!sub && e.method === 'DELETE') {
      ta.connected.delete(profileId);
      ta.initiallyConnected = false;
      return { status: 204, body: '' };
    }
    return notFound();
  }

  /** MUT-711 (AC3): another session issues a tax invoice now, taking the number a preview showed. */
  issueElsewhere(profileId: string, docType = 'TAX_INVOICE'): number {
    const state = this.issuing?.get(profileId);
    if (!state) throw new Error('open the profile first');
    const number = this.nextNumber(state, docType);
    state.docs.unshift({ id: uid(0xd0, 900 + state.docs.length), docType, number, documentDate: '2026-11-22', issuedAt: '2026-11-22T10:00:00.000Z', currency: 'ILS', language: 'en', customerId: null, customer: { name: 'Elsewhere' }, gross: '100.00', net: '100.00', allocationNumber: null, allocationSource: null });
    return number;
  }

  /** The issued-document Owed for GET /v1/receivables/{id}, or undefined. */
  private issuedOwed(receivableId: string) {
    for (const state of this.issuing?.values() ?? []) {
      const owed = state.owed.get(receivableId);
      if (owed) {
        const credited = owed.credited ?? 0;
        return { id: receivableId, customerId: owed.customerId, origin: 'ISSUED_DOCUMENT', originId: owed.docId ?? null, currency: 'ILS', gross: toDecimal(owed.gross), outstanding: toDecimal(owed.outstanding), paid: toDecimal(owed.gross - owed.outstanding - credited), credited: toDecimal(credited), status: owed.outstanding === 0 ? 'PAID' : 'OPEN', version: 1 };
      }
    }
    return undefined;
  }

  /** The server's preview math for the QA: lines at 18% VAT, prices before VAT unless the document says they include it. */
  private composeDoc(body: Record<string, Json>) {
    const lines = ((body.lines ?? []) as Record<string, string>[]).map((l, index) => {
      const net = Math.round(Number(l.quantity) * toMinor(l.unitPrice)) - (l.discount ? toMinor(l.discount) : 0);
      return { index, description: l.description, kind: l.kind, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount ?? '0.00', net: toDecimal(net), pricesIncludeVat: !!body.pricesIncludeVat, vatRateBasisPoints: 1800, vat: '0.00' };
    });
    const sum = lines.reduce((acc, l) => acc + toMinor(l.net), 0);
    const exempt = body.docType === 'RECEIPT';
    const net = body.pricesIncludeVat && !exempt ? Math.round(sum / 1.18) : sum;
    const vat = exempt ? 0 : Math.round(net * 0.18);
    return { subtotal: toDecimal(net), discount: '0.00', net: toDecimal(net), vatRateBasisPoints: exempt ? 0 : 1800, vat: toDecimal(vat), gross: toDecimal(net + vat), pricesIncludeVat: !!body.pricesIncludeVat, lines };
  }

  private closeAnswer(body: { password?: string } | null) {
    if (body?.password !== this.currentPassword) return json({ error: { code: 'CURRENT_PASSWORD_WRONG', message: 'Current password is wrong' } }, 403);
    const now = new Date();
    this.closure = { requestedAt: now.toISOString(), deleteAfter: new Date(now.getTime() + 30 * 86_400_000).toISOString() };
    return json({ closure: this.closure, subscriptionsEnded: 0, subscriptionsCancelled: 0 });
  }

  private changePasswordAnswer(body: { currentPassword?: string; newPassword?: string } | null) {
    if (body?.currentPassword !== this.currentPassword) return json({ error: { code: 'CURRENT_PASSWORD_WRONG', message: 'Current password is wrong' } }, 403);
    this.currentPassword = body.newPassword ?? this.currentPassword;
    return { status: 204, body: '' };
  }

  /** The two public setup routes (MUT-235): the check names the account only for a valid link; a redeem uses it up. */
  private setupAnswer(e: Logged) {
    const link = this.setupLink ?? { state: 'invalid' as const };
    const email = link.email ?? 'nour@office.ps';
    if (e.path === '/v1/account-setup/check') {
      if (link.state !== 'valid') return json({ state: link.state });
      return json({ state: 'valid', email, locale: link.locale ?? 'en', purpose: link.purpose ?? 'SETUP', expiresAt: '2026-10-19T09:00:00.000Z', termsVersion: this.termsVersion });
    }
    if (link.state !== 'valid') return json({ error: { code: 'SETUP_LINK_UNUSABLE', message: 'Ask for a new link', details: { state: link.state } } }, 410);
    // MUT-324: the real server checks the version after the link state
    if ((e.body as { acceptedTermsVersion?: string } | null)?.acceptedTermsVersion !== this.termsVersion) {
      return json({ error: { code: 'TERMS_VERSION_STALE', message: 'changed', details: { current: this.termsVersion } } }, 409);
    }
    this.markSetupLink('used');
    return json({ email });
  }

  private nextId(kind: number) {
    this.serial += 1;
    return uid(kind, this.serial);
  }

  /** MUT-561: MUT-559's owner routes, as the server answers them (one invite per address, the limit, never yourself). */
  /** MUT-561 + MUT-314: a ticket (what the period holds), and the stream that answers it with an attachment. */
  private periodDownloadAnswer(e: Logged, id: string | undefined, q: (key: string) => string | undefined) {
    if (!this.periodDownloads) return notFound();
    if (e.method === 'GET' && id === 'ticket') {
      const type = q('type');
      if (type !== 'report' && type !== 'receipts') return json({ error: { code: 'VALIDATION_FAILED', message: 'type', details: [{ path: ['type'] }] } }, 422);
      const ticket = `qa-ticket-${type}-${q('from')}-${q('to')}`;
      const filename = type === 'report' ? `mtb3a-${q('from')}-${q('to')}.xlsx` : `mtb3a-receipts-${q('from')}-${q('to')}.zip`;
      return json({ type, ticket, expiresAt: new Date(Date.now() + 120_000).toISOString(), filename, estimate: { expenses: 84, income: 12, receipts: 29, receiptBytes: 12_900_000 } });
    }
    if (e.method === 'POST' && id === 'stream') {
      const ticket = new URLSearchParams(String(e.body ?? '')).get('ticket') ?? (e.body as { ticket?: string } | null)?.ticket ?? '';
      const report = ticket.startsWith('qa-ticket-report');
      const filename = report ? 'mtb3a-report.xlsx' : 'mtb3a-receipts.zip';
      return { status: 200, contentType: report ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/zip', headers: { 'Content-Disposition': `attachment; filename="${filename}"` }, body: 'PK qa' };
    }
    return notFound();
  }

  /** MUT-561 slice B: MUT-560's owner routes, as the server answers them (the PIN rule, the limit, whole months). */
  private shareLinksAnswer(e: Logged, profile: StubProfile, linkId?: string) {
    if (!this.shareLinks) return notFound();
    if (!profile.owned) return json({ error: { code: 'READ_ONLY_PROFILE', message: 'Not an owner', details: { reason: 'NOT_OWNER' } } }, 403);
    const list = this.shareLinks.get(profile.id) ?? [];
    this.shareLinks.set(profile.id, list);
    const live = () => list.filter((l) => l.status === 'active' || l.status === 'locked').length;
    if (e.method === 'GET' && !linkId) return json({ items: list, limit: SHARE_LINK_LIMIT });
    if (e.method === 'DELETE' && linkId) {
      const link = list.find((l) => l.id === linkId && (l.status === 'active' || l.status === 'locked'));
      if (!link) return notFound();
      link.status = 'revoked';
      link.endedAt = new Date().toISOString();
      return { status: 204, body: '' };
    }
    if (e.method === 'POST' && !linkId) {
      const body = (e.body ?? {}) as { period?: StubShareLink['period']; expiresInDays?: number; pin?: string };
      const pin = String(body.pin ?? '').replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) => String((d.codePointAt(0) ?? 0) % 16));
      if (!/^\d{4,8}$/.test(pin)) return json({ error: { code: 'VALIDATION_FAILED', message: 'PIN', details: { reason: 'PIN_FORMAT', field: 'pin' } } }, 422);
      if (live() >= SHARE_LINK_LIMIT) return json({ error: { code: 'CONFLICT', message: 'limit', details: { reason: 'SHARE_LINK_LIMIT', limit: SHARE_LINK_LIMIT } } }, 409);
      const now = new Date();
      const today = todayInJerusalem();
      const period = body.period ?? 'LAST_1_MONTH';
      const months = { LAST_1_MONTH: 1, LAST_2_MONTHS: 2, LAST_3_MONTHS: 3, WHOLE_PROFILE: 0 }[period];
      const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
      const from = months ? new Date(Date.UTC(y, m - 1 - months, 1)).toISOString().slice(0, 10) : null;
      const to = months ? new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10) : today;
      const id = this.nextId(0x5b);
      const link: StubShareLink = { id, period, from, to, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + (body.expiresInDays ?? 7) * 86_400_000).toISOString(), lastOpenedAt: null, status: 'active', endedAt: null, viewers: 0, maxViewers: 3, createdByName: 'Nour Haddad' };
      list.push(link);
      const url = `http://127.0.0.1:5175/share#qaShareToken${id.slice(0, 8)}abcdefghijklmnopqrstuvwxyz`;
      return json({ id, url, period, from, to, expiresAt: link.expiresAt, createdAt: link.createdAt }, 201);
    }
    return notFound();
  }

  private accountantsAnswer(e: Logged, profile: StubProfile, grantId?: string) {
    const grants = this.accountants?.get(profile.id);
    if (!this.accountants) return notFound();
    if (!profile.owned) return json({ error: { code: 'READ_ONLY_PROFILE', message: 'Not an owner', details: { reason: 'NOT_OWNER' } } }, 403);
    const list = grants ?? [];
    if (!grants) this.accountants.set(profile.id, list);
    if (e.method === 'GET' && !grantId) return json({ items: list, limit: ACCOUNTANT_LIMIT });
    if (e.method === 'DELETE' && grantId) {
      const index = list.findIndex((g) => g.id === grantId && g.status !== 'expired');
      if (index < 0) return notFound();
      list.splice(index, 1);
      return { status: 204, body: '' };
    }
    if (e.method === 'POST' && !grantId) {
      const email = String((e.body as { email?: unknown } | null)?.email ?? '').trim().toLowerCase();
      const refuse = (status: number, code: string, details: unknown) => json({ error: { code, message: code, details } }, status);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return refuse(422, 'VALIDATION_FAILED', [{ path: ['email'] }]);
      if (email === 'nour@office.ps') return refuse(422, 'VALIDATION_FAILED', { reason: 'SELF_INVITE' });
      if (email.endsWith('@mailinator.com')) return refuse(422, 'VALIDATION_FAILED', { reason: 'INVITE_ADDRESS_REFUSED' });
      const existing = list.find((g) => g.email === email);
      if (existing && existing.status !== 'expired') return refuse(409, 'CONFLICT', { reason: 'ALREADY_INVITED' });
      if (list.filter((g) => g.status !== 'expired').length >= ACCOUNTANT_LIMIT) return refuse(409, 'CONFLICT', { reason: 'ACCOUNTANT_LIMIT', limit: ACCOUNTANT_LIMIT });
      if (existing) list.splice(list.indexOf(existing), 1);
      const now = new Date();
      const grant: StubGrant = { id: this.nextId(0x56), email, name: null, status: 'pending', invitedAt: now.toISOString(), expiresAt: new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000).toISOString(), acceptedAt: null, lastViewedAt: null };
      list.push(grant);
      return json(grant, 201);
    }
    return notFound();
  }

  private profileAnswer(e: Logged, id?: string, sub?: string, subId?: string) {
    const state = this.profiles.find((p) => p.stub.id === id);
    if (e.method === 'POST' && !id) {
      const body = e.body as { name: string; type: 'BUSINESS' | 'PERSONAL'; defaultCurrency?: Currency };
      const stub: StubProfile = { id: this.nextId(0x7), name: body.name, type: body.type, owned: true, writerOfRecord: null };
      this.profiles.unshift({ stub, defaultCurrency: body.defaultCurrency ?? 'ILS', version: 1 });
      return json(this.me().profiles[0], 201);
    }
    if (!state) return notFound();
    if (sub === 'accountants') return this.accountantsAnswer(e, state.stub, subId);
    if (sub === 'share-links') return this.shareLinksAnswer(e, state.stub, subId);
    if (e.method === 'POST' && sub === 'firm-request') {
      // MUT-300: idempotent like the server; the version stays put (eng review O3).
      state.stub = { ...state.stub, firmRequestedAt: state.stub.firmRequestedAt ?? FIRM_REQUESTED_AT };
      return json({ firmRequest: { requestedAt: state.stub.firmRequestedAt } }, 202);
    }
    if (e.method === 'DELETE' && sub === 'owners' && subId) {
      // MUT-373: yourself leaves; anyone else is removed (the spec seeds who may do which).
      if (subId === QA_USER_ID) {
        this.profiles = this.profiles.filter((p) => p !== state);
        return json({ result: 'left' });
      }
      const owners = state.stub.owners ?? [];
      if (!owners.some((o) => o.userId === subId)) return notFound();
      state.stub = { ...state.stub, owners: owners.filter((o) => o.userId !== subId) };
      return json({ result: 'removed' });
    }
    if (e.method === 'GET' && sub === 'type-change') {
      const to = e.query.get('to');
      return json({ uncategorizedExpenses: this.uncategorized, deletedCategories: 6, preset: to === 'BUSINESS' ? 'general' : 'personal' });
    }
    if (e.method === 'PATCH') {
      if (e.headers['if-match'] !== String(state.version)) return conflict('VERSION_MISMATCH');
      const body = e.body as { name?: string; defaultCurrency?: Currency; type?: 'BUSINESS' | 'PERSONAL' };
      const typeChanged = body.type !== undefined && body.type !== state.stub.type;
      state.stub = { ...state.stub, name: body.name ?? state.stub.name, type: body.type ?? state.stub.type };
      state.defaultCurrency = body.defaultCurrency ?? state.defaultCurrency;
      state.version += 1;
      const profile = this.me().profiles.find((p) => p.id === id);
      return json({ profile, typeChange: typeChanged ? { uncategorizedExpenses: this.uncategorized, deletedCategories: 6, preset: body.type === 'BUSINESS' ? 'general' : 'personal' } : null });
    }
    return undefined;
  }

  /** MUT-373: the creator removed the signed-in person from this profile, elsewhere. */
  removedElsewhere(profileId: string) {
    this.profiles = this.profiles.filter((p) => p.stub.id !== profileId);
    this.gone.add(profileId);
  }

  /** Bump a profile's version as if it were edited on another device. */
  editedElsewhere(profileId: string, change: { name?: string } = {}) {
    const state = this.profiles.find((p) => p.stub.id === profileId);
    if (!state) throw new Error(`no profile ${profileId}`);
    state.version += 1;
    if (change.name) state.stub = { ...state.stub, name: change.name };
  }

  private receivableAnswer(e: Logged, id?: string, sub?: string) {
    const q = (key: string) => e.query.get(key) ?? undefined;
    if (e.method === 'GET' && !id) {
      const status = q('status');
      const closed = (r: StubReceivable) => r.status === 'PAID' || r.status === 'VOID';
      return page(
        this.receivables.filter(
          (r) =>
            (!status || (status === 'OPEN' ? !closed(r) : closed(r))) &&
            (!q('customerId') || r.customerId === q('customerId')) &&
            (!q('projectId') || r.projectId === q('projectId')) &&
            (!q('currency') || r.currency === q('currency')),
        ),
      );
    }
    const found = this.receivables.find((r) => r.id === id);
    if (!found) return notFound();
    if (e.method === 'GET' && !sub) return json(found);
    if (e.method === 'GET' && sub === 'credits') return json({ receivable: found, credits: this.credits.get(found.id) ?? [] });
    if (e.method === 'POST' && sub === 'credits') return this.credit(found, e.body as { amount: string; reason: string });
    if (e.method === 'POST' && (sub === 'settle' || sub === 'settle-and-issue')) {
      const body = e.body as { amount: string; paidAt: string; method: 'CASH' | 'BANK'; issue?: boolean };
      const paid = toMinor(found.paid) + toMinor(body.amount);
      found.paid = toDecimal(paid);
      found.outstanding = toDecimal(toMinor(found.gross) - paid);
      found.status = found.outstanding === '0.00' ? 'PAID' : 'PARTIALLY_PAID';
      found.version += 1;
      const made = payment(this.serial++, {
        customerId: found.customerId,
        amount: body.amount,
        currency: found.currency as Currency,
        receivedOn: body.paidAt,
        method: body.method,
        allocations: [allocation(this.serial++, { receivableId: found.id, projectId: found.projectId ?? uid(0xa, 0), amount: body.amount, left: found.outstanding })],
        mine: true,
      });
      this.payments.unshift(made);
      // MUT-661: settle-and-issue also answers what happened to the payment's document (the fake issues no real document).
      if (sub === 'settle-and-issue') {
        const issue = body.issue === false ? { status: 'not_requested', reason: null, document: null } : { status: 'issued', reason: null, document: { id: uid(0xd, this.serial++), number: 1, docType: 'TAX_INVOICE_RECEIPT', gross: body.amount } };
        return json({ receivable: found, payment: made, issue }, 201);
      }
      return json({ receivable: found, payment: made }, 201);
    }
    return undefined;
  }

  private income(body: Json) {
    const b = body as { kind: 'received' | 'owed'; amount: string; currency: Currency; occurredOn: string; customerId?: string; projectId?: string; title?: string; dueDate?: string; method?: 'CASH' | 'BANK'; notes?: string };
    const n = this.serial++;
    if (b.kind === 'owed') {
      // As the server: a matter names its client when none was sent (MUT-318)
      const customerId = b.customerId ?? this.projects.find((p) => p.id === b.projectId)?.customerId ?? '';
      const made = receivable(n, { customerId, projectId: b.projectId ?? null, gross: b.amount, currency: b.currency, dueDate: b.dueDate, postingDate: b.occurredOn, title: b.title ?? null });
      this.receivables.unshift(made);
      return json({ id: made.id, kind: 'owed', amount: b.amount, currency: b.currency, occurredOn: b.occurredOn, customerId, projectId: b.projectId ?? null, title: b.title ?? null, notes: b.notes ?? null, dueDate: made.dueDate, status: 'open' }, 201);
    }
    const made = payment(n, { customerId: b.customerId ?? null, amount: b.amount, currency: b.currency, receivedOn: b.occurredOn, method: b.method, mine: true });
    this.payments.unshift(made);
    return json({ id: made.id, kind: 'received', amount: b.amount, currency: b.currency, occurredOn: b.occurredOn, customerId: b.customerId ?? null, projectId: null, title: null, notes: b.notes ?? null, dueDate: null, status: 'unallocated' }, 201);
  }

  /** MUT-224: GET one payment; PATCH its received date with If-Match (MUT-223), allocations untouched. */
  private paymentAnswer(e: Logged, id: string, sub?: string) {
    const found = this.payments.find((p) => p.id === id);
    if (!found) return notFound();
    if (e.method === 'POST' && sub === 'reverse') return this.reverse(found, (e.body as { reason: string }).reason);
    if (e.method === 'GET') return json(found);
    if (e.method === 'PATCH') {
      if (e.headers['if-match'] !== String(found.version)) return conflict('VERSION_MISMATCH');
      found.receivedOn = (e.body as { receivedOn: string }).receivedOn;
      found.version += 1;
      return json(found);
    }
    return undefined;
  }

  /** MUT-453: as the server: whole and final; every Owed it paid is owed again. */
  private reverse(found: StubPayment, reason: string) {
    if (found.status === 'REVERSED') return conflict('ALREADY_REVERSED');
    for (const a of found.allocations) {
      const r = this.receivables.find((x) => x.id === a.receivableId);
      if (!r) continue;
      r.paid = toDecimal(toMinor(r.paid) - toMinor(a.amount));
      r.outstanding = toDecimal(toMinor(r.gross) - toMinor(r.paid) - toMinor(r.credited));
      r.status = r.outstanding === '0.00' ? 'PAID' : toMinor(r.paid) > 0 ? 'PARTIALLY_PAID' : 'DUE';
      r.version += 1;
    }
    Object.assign(found, { status: 'REVERSED', reversedAt: STAMP, reversalReason: reason, allocated: '0.00', unallocated: found.amount, allocationState: 'unallocated', version: found.version + 1 });
    return json(found);
  }

  /** MUT-453: a credit up to what is left; crediting everything left closes the entry (Cancel). */
  private credit(found: StubReceivable, body: { amount: string; reason: string }) {
    if (toMinor(found.outstanding) === 0) return json({ error: { code: 'VALIDATION_FAILED', message: 'Nothing is outstanding', details: { reason: 'RECEIVABLE_NOT_OPEN' } } }, 422);
    if (toMinor(body.amount) > toMinor(found.outstanding)) {
      return json({ error: { code: 'VALIDATION_FAILED', message: 'The credit exceeds what is outstanding', details: { reason: 'CREDIT_EXCEEDS_OUTSTANDING', outstanding: found.outstanding } } }, 422);
    }
    found.credited = toDecimal(toMinor(found.credited) + toMinor(body.amount));
    found.outstanding = toDecimal(toMinor(found.gross) - toMinor(found.paid) - toMinor(found.credited));
    if (found.outstanding === '0.00') found.status = 'PAID';
    found.version += 1;
    const made = { id: uid(0x9, this.serial++), receivableId: found.id, amount: body.amount, net: body.amount, vat: '0.00', reason: body.reason, effectiveDate: todayInJerusalem(), createdAt: STAMP };
    this.credits.set(found.id, [made, ...(this.credits.get(found.id) ?? [])]);
    return json({ receivable: found, credit: made }, 201);
  }

  /** MUT-224: PATCH /v1/income/{id} moves an Owed entry's postingDate (its due date stays). */
  private redateIncome(e: Logged, id: string) {
    const found = this.receivables.find((r) => r.id === id);
    if (!found) return notFound();
    if (e.headers['if-match'] !== String(found.version)) return conflict('VERSION_MISMATCH');
    found.postingDate = (e.body as { occurredOn: string }).occurredOn;
    found.version += 1;
    return json({ id: found.id, kind: 'owed', amount: found.gross, currency: found.currency, occurredOn: found.postingDate, customerId: found.customerId, projectId: found.projectId, title: found.title, notes: null, dueDate: found.dueDate, status: found.status === 'PAID' ? 'settled' : 'open', version: found.version });
  }

  /** MUT-224: an Owed entry or a payment re-dated on another device: its version moves on. */
  redatedElsewhere(id: string, date: string) {
    const r = this.receivables.find((x) => x.id === id);
    if (r) {
      r.postingDate = date;
      r.version += 1;
      return;
    }
    const p = this.payments.find((x) => x.id === id);
    if (!p) throw new Error(`no receivable or payment ${id}`);
    p.receivedOn = date;
    p.version += 1;
  }

  /**
   * MUT-254: the server's resolve + touch, minimally: the typed vendor's own exact key, created on first sight.
   * MUT-303: a new expense also teaches its currency, and its VAT when it carries one (`learn`).
   */
  private linkVendor(name: string | null, categoryId: string | null, learn?: { currency?: string; vat?: VendorVatStub | null }): string | null {
    const key = vendorKey(name);
    if (!name || !key) return null;
    let vendor = this.vendors.find((v) => v.keys.has(key));
    if (!vendor) {
      vendor = { id: this.nextId(0xa), name: name.trim(), keys: new Set([key]), lastCategoryId: null, lastCurrency: null, lastVat: null, lastUsed: 0 };
      this.vendors.push(vendor);
    }
    vendor.lastUsed = ++this.serial;
    if (categoryId) vendor.lastCategoryId = categoryId;
    if (learn?.currency) vendor.lastCurrency = learn.currency;
    if (learn?.vat) vendor.lastVat = learn.vat;
    return vendor.id;
  }

  /** MUT-303 (D6): a To-review receipt's vendor defaults, matched by the read name (the stub has no registration index). */
  private receiptVendorDefaults(found: StubLibraryReceipt, profileId: string | undefined) {
    const read = (found.suggested as { vendorName?: { value?: string } } | null)?.vendorName?.value ?? null;
    const key = vendorKey(read);
    const vendor = key ? this.vendors.find((v) => v.keys.has(key)) : undefined;
    if (found.expenseId || !vendor) return null;
    const firm = this.profiles.find((p) => p.stub.id === profileId)?.stub.firm ?? false;
    return { vendorId: vendor.id, currency: vendor.lastCurrency, vat: firm ? vendor.lastVat : null };
  }

  /** GET /v1/vendors: names containing the query (no fuzzy matching here), else the most recently used. */
  private vendorAnswer(e: Logged) {
    const q = (e.query.get('q') ?? '').trim().toLowerCase();
    const items = this.vendors
      .filter((v) => !q || v.name.toLowerCase().includes(q))
      .sort((a, b) => b.lastUsed - a.lastUsed)
      .map((v) => ({ id: v.id, name: v.name, matchedName: v.name, exact: v.keys.has(q.replace(/\s+/g, ' ')), registrationNo: null, phone: null, email: null, lastCategoryId: v.lastCategoryId, lastCurrency: v.lastCurrency, lastVat: v.lastVat }));
    return json({ items });
  }

  private expenseAnswer(e: Logged, id?: string, sub?: string, subId?: string, action?: string) {
    const q = (key: string) => e.query.get(key) ?? undefined;
    if (!id) {
      if (e.method === 'GET') {
        const groupId = q('groupId');
        const group = groupId ? this.groups.find((g) => g.id === groupId) : undefined;
        if (groupId && !group) return notFound();
        const rows = this.expenses
          .filter((x) => !x.profileId || x.profileId === e.headers['x-mutaba3a-profile'])
          .filter((x) => (!q('categoryId') || x.categoryId === q('categoryId')) && (!q('customerId') || x.customerId === q('customerId')))
          .filter((x) => (!q('from') || x.occurredOn >= q('from')!) && (!q('to') || x.occurredOn <= q('to')!))
          .filter((x) => !group || (q('groupMembership') === 'excluded' ? this.isLeftOut(group, x) : this.isMember(group, x)))
          .sort((a, b) => (a.occurredOn === b.occurredOn ? (a.id < b.id ? 1 : -1) : a.occurredOn < b.occurredOn ? 1 : -1))
          .map(listed);
        // Group members come back in pages of two, so the portal's every-page loop is exercised (eng R7)
        return group ? paged(rows, 2, q('cursor')) : page(rows);
      }
      if (e.method === 'POST') {
        const b = e.body as Json;
        const made = { ...expense(this.serial++, { amount: String(b.amount), currency: b.currency as Currency }), ...b, id: this.nextId(0x9), receipts: [] as StubReceipt[] } as StubExpense;
        delete (made as { vendorDetails?: unknown }).vendorDetails;
        const vatIn = (b.vat as VendorVatStub | null | undefined) ?? null;
        made.vat = splitExpenseVat(made.amount, made.currency as Currency, vatIn);
        stampAllocationNumber(made);
        made.vendorId = this.linkVendor(made.vendor, made.categoryId, { currency: made.currency, vat: vatIn });
        this.expenses.unshift(made);
        return json(listed(made), 201);
      }
      return undefined;
    }
    const found = this.expenses.find((x) => x.id === id && (!x.profileId || x.profileId === e.headers['x-mutaba3a-profile']));
    if (!found) return notFound();
    if (sub === 'move-preview' && e.method === 'GET') return this.expenseMoveAnswer(found, e.headers['x-mutaba3a-profile'], e.query.get('profileId') ?? '', null);
    if (sub === 'move' && e.method === 'POST') {
      const b = e.body as { profileId: string; expectedVersion: number };
      return this.expenseMoveAnswer(found, e.headers['x-mutaba3a-profile'], b.profileId, b.expectedVersion);
    }
    if (!sub) {
      if (e.method === 'GET') return json(found);
      if (e.method === 'PATCH') {
        if (e.headers['if-match'] !== String(found.version)) return conflict('VERSION_MISMATCH');
        // MUT-302 (D4): vat absent keeps the treatment and rate (re-split on a new amount); null clears; an object sets it.
        const sentVat = (e.body as { vat?: { treatment: string; rateBasisPoints: number } | null }).vat;
        const keptVat = found.vat ? { treatment: found.vat.treatment, rateBasisPoints: found.vat.rateBasisPoints } : null;
        Object.assign(found, e.body, { version: found.version + 1 });
        found.vat = splitExpenseVat(found.amount, found.currency as Currency, sentVat === undefined ? keptVat : sentVat);
        stampAllocationNumber(found);
        const patch = e.body as { vendor?: string | null; categoryId?: string | null };
        if (patch.vendor !== undefined || patch.categoryId !== undefined) found.vendorId = this.linkVendor(found.vendor, found.categoryId);
        return json(listed(found));
      }
      if (e.method === 'DELETE') {
        this.expenses.splice(this.expenses.indexOf(found), 1);
        return { status: 204, body: '' };
      }
      return undefined;
    }
    if (sub === 'receipts') {
      if (e.method === 'POST' && !subId) {
        const b = e.body as { filename: string; mimeType: string; sizeBytes: number };
        const made: StubReceipt = { id: this.nextId(0x6), expenseId: found.id, filename: b.filename, mimeType: b.mimeType, sizeBytes: b.sizeBytes, status: 'PENDING_UPLOAD', uploadedByUserId: '99999999-9999-4999-8999-999999999999', createdAt: STAMP, completedAt: null };
        found.receipts.push(made);
        return json({ receipt: made, upload: { url: `${STORAGE}/upload/${made.id}`, method: 'PUT', headers: { 'Content-Type': b.mimeType }, expiresAt: '2026-10-15T12:15:00Z' } }, 201);
      }
      const receipt = found.receipts.find((r) => r.id === subId);
      if (!receipt) return notFound();
      if (e.method === 'POST' && action === 'complete') {
        receipt.status = 'READY';
        receipt.completedAt = STAMP;
        return json(receipt);
      }
      if (e.method === 'GET' && action === 'download') return json({ url: `${STORAGE}/${encodeURIComponent(receipt.filename)}`, expiresAt: '2026-10-15T12:15:00Z', filename: receipt.filename, mimeType: receipt.mimeType });
      if (e.method === 'DELETE') {
        found.receipts.splice(found.receipts.indexOf(receipt), 1);
        return { status: 204, body: '' };
      }
    }
    return undefined;
  }

  private mark(group: StubGroup, expenseId: string): Mark | undefined {
    return this.marks.get(`${group.id}:${expenseId}`);
  }

  private inWindow(group: StubGroup, day: string) {
    return day >= group.startOn && day <= group.windowEnd;
  }

  /** The API's rule (MUT-267 D4): in the window and not left out, or kept. */
  private isMember(group: StubGroup, x: StubExpense) {
    const mark = this.mark(group, x.id);
    return mark === 'included' || (this.inWindow(group, x.occurredOn) && mark !== 'excluded');
  }

  /** Left out = an excluded mark on an expense dated inside the window (22A). */
  private isLeftOut(group: StubGroup, x: StubExpense) {
    return this.mark(group, x.id) === 'excluded' && this.inWindow(group, x.occurredOn);
  }

  private members(group: StubGroup) {
    return this.expenses.filter((x) => this.isMember(group, x));
  }

  private totals(group: StubGroup) {
    const byCurrency = new Map<string, { currency: string; minor: number; count: number }>();
    for (const x of this.members(group)) {
      const t = byCurrency.get(x.currency) ?? { currency: x.currency, minor: 0, count: 0 };
      t.minor += minorOf(x.amount, x.currency);
      t.count += 1;
      byCurrency.set(x.currency, t);
    }
    // Alphabetical by currency, as the API orders them
    return [...byCurrency.values()].sort((a, b) => (a.currency < b.currency ? -1 : 1)).map((t) => ({ currency: t.currency, total: decimalOf(t.minor, t.currency), count: t.count }));
  }

  private listedGroup(group: StubGroup) {
    const currencies = this.totals(group);
    return { ...group, currencies, memberCount: currencies.reduce((n, c) => n + c.count, 0) };
  }

  /** The summary as the API builds it: series zero-filled per currency, sparse before/after buckets (6A). */
  private groupSummary(group: StubGroup) {
    const seriesFrom = group.startOn;
    const seriesTo = group.endOn ?? (this.today < group.startOn ? group.startOn : this.today < group.windowEnd ? this.today : group.windowEnd);
    const currencies = this.totals(group).map(({ currency, total, count }) => {
      const rows = this.members(group).filter((x) => x.currency === currency);
      const buckets = new Map<string, { date: string; position: string; minor: number; count: number }>();
      for (let day = seriesFrom; day <= seriesTo; day = addDays(day, 1)) buckets.set(day, { date: day, position: 'in', minor: 0, count: 0 });
      const categories = new Map<string | null, { minor: number; count: number }>();
      for (const x of rows) {
        const position = x.occurredOn < seriesFrom ? 'before' : x.occurredOn > seriesTo ? 'after' : 'in';
        const b = buckets.get(x.occurredOn) ?? { date: x.occurredOn, position, minor: 0, count: 0 };
        b.minor += minorOf(x.amount, currency);
        b.count += 1;
        buckets.set(x.occurredOn, b);
        const c = categories.get(x.categoryId) ?? { minor: 0, count: 0 };
        c.minor += minorOf(x.amount, currency);
        c.count += 1;
        categories.set(x.categoryId, c);
      }
      return {
        currency,
        total,
        count,
        byCategory: [...categories.entries()].map(([categoryId, c]) => ({ categoryId, total: decimalOf(c.minor, currency), count: c.count })),
        byCustomer: [],
        byDay: [...buckets.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).map((b) => ({ date: b.date, position: b.position, total: decimalOf(b.minor, currency), count: b.count })),
      };
    });
    return { groupId: group.id, seriesFrom, seriesTo, currencies };
  }

  private groupAnswer(e: Logged, id?: string, sub?: string, subId?: string) {
    if (!id) {
      if (e.method === 'GET') {
        const expenseId = e.query.get('expenseId');
        const groups = [...this.groups].sort((a, b) => (a.startOn < b.startOn ? 1 : -1));
        const expense = expenseId ? this.expenses.find((x) => x.id === expenseId) : undefined;
        return json({ items: groups.filter((g) => !expenseId || (expense && this.isMember(g, expense))).map((g) => this.listedGroup(g)) });
      }
      if (e.method === 'POST') {
        const b = e.body as { name: string; startOn: string; endOn?: string; notes?: string };
        const made = { ...expenseGroup(this.serial++, b), id: this.nextId(0xb) };
        this.groups.push(made);
        return json(this.listedGroup(made), 201);
      }
      return undefined;
    }
    const group = this.groups.find((g) => g.id === id);
    if (!group) return notFound();
    if (!sub) {
      if (e.method === 'GET') return json({ ...this.listedGroup(group), excludedCount: this.expenses.filter((x) => this.isLeftOut(group, x)).length });
      if (e.method === 'PATCH') {
        if (e.headers['if-match'] !== String(group.version)) return conflict('VERSION_MISMATCH');
        const b = e.body as { name?: string; startOn?: string; endOn?: string | null; notes?: string | null };
        Object.assign(group, b, { version: group.version + 1 });
        group.windowEnd = group.endOn ?? addDays(group.startOn, 365);
        return json(this.listedGroup(group));
      }
      if (e.method === 'DELETE') {
        this.groups.splice(this.groups.indexOf(group), 1);
        return { status: 204, body: '' };
      }
      return undefined;
    }
    if (sub === 'summary' && e.method === 'GET') return json(this.groupSummary(group));
    if (sub === 'expenses' && subId) {
      if (!this.expenses.some((x) => x.id === subId)) return notFound();
      const key = `${group.id}:${subId}`;
      if (e.method === 'PUT') {
        const mode = (e.body as { mode: Mark }).mode;
        this.marks.set(key, mode);
        return json({ groupId: group.id, expenseId: subId, mode, updatedAt: STAMP });
      }
      if (e.method === 'DELETE') {
        this.marks.delete(key);
        return { status: 204, body: '' };
      }
    }
    return undefined;
  }

  /** The mark the portal left on an expense for a group, for assertions. */
  markOf(groupId: string, expenseId: string): Mark | undefined {
    return this.marks.get(`${groupId}:${expenseId}`);
  }

  private conversionAnswer(e: Logged, id?: string) {
    if (!id) {
      if (e.method === 'GET') return page(this.conversions.filter((c) => !e.query.get('currency') || c.currency === e.query.get('currency') || c.toCurrency === e.query.get('currency')));
      if (e.method === 'POST') {
        const b = e.body as { amount: string; currency: Currency; toAmount: string; toCurrency: Currency; occurredOn: string; notes?: string };
        const made = { ...conversion(this.serial++, b), id: this.nextId(0x8) };
        this.conversions.unshift(made);
        return json(made, 201);
      }
      return undefined;
    }
    const found = this.conversions.find((c) => c.id === id);
    if (!found) return notFound();
    if (e.method === 'GET') return json(found);
    if (e.method === 'PATCH') {
      if (e.headers['if-match'] !== String(found.version)) return conflict('VERSION_MISMATCH');
      Object.assign(found, e.body, { version: found.version + 1 });
      return json(found);
    }
    if (e.method === 'DELETE') {
      this.conversions.splice(this.conversions.indexOf(found), 1);
      return { status: 204, body: '' };
    }
    return undefined;
  }
}

/** An expense as lists and writes return it: the receipts belong to the detail read only. */
function listed(item: StubExpense) {
  const copy: Partial<StubExpense> = { ...item };
  delete copy.receipts;
  return copy;
}

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}
function page(items: unknown[]) {
  return json({ items, nextCursor: null });
}
/** A cursor list in pages of `size`; the cursor is the next index. */
function paged(items: unknown[], size: number, cursor?: string) {
  const start = cursor ? Number(cursor) : 0;
  const end = start + size;
  return json({ items: items.slice(start, end), nextCursor: end < items.length ? String(end) : null });
}
function notFound() {
  return json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
}
function conflict(reason: string) {
  return json({ error: { code: 'CONFLICT', message: 'Changed elsewhere', details: { reason } } }, 409);
}

/** A server refusal in the API's error envelope. */
export function apiError(status: number, code: string, details: Json = {}): OnceAnswer {
  return { status, body: { error: { code, message: code, details } } };
}
