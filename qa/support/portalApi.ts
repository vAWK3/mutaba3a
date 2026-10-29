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
type Currency = 'ILS' | 'USD' | 'EUR' | 'JOD';

export interface Logged {
  method: string;
  path: string;
  query: URLSearchParams;
  body: Json | null;
  headers: Record<string, string>;
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
    version: 1,
    createdAt: STAMP,
    updatedAt: STAMP,
    receipts: [] as StubReceipt[],
  };
}
export type StubExpense = ReturnType<typeof expense>;

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
  b: { outstanding: string; overdue: string; proposed?: string; customers: { customerId: string; outstanding: string; overdue: string; lastPaymentOn?: string | null; status: string }[] },
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
  projects?: ReturnType<typeof project>[];
  receivables?: StubReceivable[];
  payments?: StubPayment[];
  attachments?: ReturnType<typeof attachment>[];
  categories?: ReturnType<typeof category>[];
  expenses?: StubExpense[];
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
  vendors?: { name: string; categoryId?: string }[];
}

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

export class FakeApi {
  readonly log: Logged[] = [];
  /** Requests that reached the storage bucket (receipt PUTs, signed-URL downloads). */
  readonly storage: { method: string; url: string }[] = [];
  signedIn: boolean;
  /** MUT-361: what /v1/me says about the lapse gate. */
  billingStanding: 'open' | 'read-only' | 'locked' | null;
  private readonly billingOverview: Json | null;
  private profiles: ProfileState[];
  private readonly customers;
  private readonly projects;
  private readonly receivables;
  private readonly payments;
  private readonly attachments;
  private readonly categories;
  private readonly expenses;
  /** MUT-254 (A18): vendors as the server saves them, matched on a minimal exact key (case and spacing only). */
  private readonly vendors: { id: string; name: string; keys: Set<string>; lastCategoryId: string | null; lastUsed: number }[] = [];
  private readonly conversions;
  private readonly groups: StubGroup[];
  private readonly marks: Map<string, Mark>;
  private readonly today: string;
  private readonly fxRates: Json | 'unavailable';
  private readonly summary;
  private readonly customerSummaries;
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

  constructor(seed: FakeApiSeed) {
    this.reports = { ...(seed.reports ?? {}) };
    this.verdicts = { ...(seed.verdicts ?? {}) };
    this.signedIn = seed.signedIn ?? true;
    this.billingStanding = seed.billingStanding ?? null;
    this.billingOverview = seed.billing ?? null;
    this.profiles = seed.profiles.map((stub) => ({ stub, defaultCurrency: 'ILS', version: 1 }));
    this.customers = Array.from({ length: seed.clients ?? 0 }, (_, i) => customer(i));
    this.projects = [...(seed.projects ?? [])];
    this.receivables = [...(seed.receivables ?? [])];
    this.payments = [...(seed.payments ?? [])];
    this.attachments = [...(seed.attachments ?? [])];
    this.categories = [...(seed.categories ?? [])];
    this.expenses = [...(seed.expenses ?? [])];
    this.conversions = [...(seed.conversions ?? [])];
    this.groups = [...(seed.groups ?? [])];
    this.marks = new Map(Object.entries(seed.marks ?? {}));
    this.today = seed.today ?? todayInJerusalem();
    this.fxRates = seed.fxRates ?? FX_RATES_ILS;
    this.summary = seed.summary ?? [];
    this.customerSummaries = new Map((seed.customerSummaries ?? []).map((s) => [s.customerId, s]));
    this.uncategorized = seed.uncategorizedOnTypeChange ?? 0;
    this.setupLink = seed.setupLink ?? null;
    this.currentPassword = seed.currentPassword ?? 'the-current-password';
    this.termsAccepted = seed.termsAccepted ?? true;
    this.closure = seed.closure ?? null;
    this.libraryReceipts = seed.receipts ? [...seed.receipts] : null;
    for (const v of seed.vendors ?? []) this.linkVendor(v.name, v.categoryId ?? null);
  }

  /** MUT-175: GET /v1/summaries/activity for the named profile (defaults: this month, by day). */
  private activityAnswer(profileId: string | undefined, q: (key: string) => string | undefined) {
    const records = (profileId && this.reports[profileId]) || { payments: this.payments, expenses: this.expenses };
    if (records.refuse === 403) return json({ error: { code: 'INSUFFICIENT_SCOPE', message: 'No access' } }, 403);
    if (records.refuse === 500) return json({ error: { code: 'INTERNAL', message: 'Failed' } }, 500);
    const month = this.today.slice(0, 7);
    const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const bucket = q('bucket') === 'month' ? 'month' : 'day';
    return json(activitySummary(records, q('from') ?? `${month}-01`, q('to') ?? lastDay, bucket, this.today));
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
      user: { ...body.user, closure: this.closure },
      billingStanding: this.billingStanding,
      profiles: body.profiles.map((p) => {
        const state = this.profiles.find((s) => s.stub.id === p.id);
        return state ? { ...p, defaultCurrency: state.defaultCurrency, version: state.version } : p;
      }),
    };
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
    const entry = { method: request.method(), path: url.pathname, query: url.searchParams, body, headers: request.headers() };
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
    if (resource === 'billing' && method === 'GET' && !id && this.billingOverview) return json(this.billingOverview);
    if (resource === 'me' && id === 'terms-acceptance' && method === 'POST') {
      const { version } = (e.body ?? {}) as { version?: string };
      if (version !== this.termsVersion) return json({ error: { code: 'TERMS_VERSION_STALE', message: 'changed', details: { current: this.termsVersion } } }, 409);
      this.termsAccepted = true;
      return json({ version: this.termsVersion, accepted: true });
    }
    if (resource === 'me' && id === 'password' && method === 'POST') return this.changePasswordAnswer(e.body as { currentPassword?: string; newPassword?: string } | null);

    if (resource === 'profiles') return this.profileAnswer(e, id, sub, subId);

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
    if (e.method === 'GET' && !sub) return json(found);
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
      made.vendorId = this.linkVendor(made.vendor, made.categoryId);
      this.expenses.unshift(made);
      Object.assign(found, { filingStatus: 'FILED', expenseId: made.id, approvedAt: STAMP, version: found.version + 1, approved: { occurredOn: made.occurredOn, amountMinor: '0', currency: made.currency, vendor: made.vendor, categoryId: made.categoryId } });
      return json({ expense: listed(made), receipt: found }, 201);
    }
    return undefined;
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

  private profileAnswer(e: Logged, id?: string, sub?: string, subId?: string) {
    const state = this.profiles.find((p) => p.stub.id === id);
    if (e.method === 'POST' && !id) {
      const body = e.body as { name: string; type: 'BUSINESS' | 'PERSONAL'; defaultCurrency?: Currency };
      const stub: StubProfile = { id: this.nextId(0x7), name: body.name, type: body.type, owned: true, writerOfRecord: null };
      this.profiles.unshift({ stub, defaultCurrency: body.defaultCurrency ?? 'ILS', version: 1 });
      return json(this.me().profiles[0], 201);
    }
    if (!state) return notFound();
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
    if (e.method === 'POST' && sub === 'settle') {
      const body = e.body as { amount: string; paidAt: string; method: 'CASH' | 'BANK' };
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

  /** MUT-254: the server's resolve + touch, minimally: the typed vendor's own exact key, created on first sight. */
  private linkVendor(name: string | null, categoryId: string | null): string | null {
    const key = name?.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!name || !key) return null;
    let vendor = this.vendors.find((v) => v.keys.has(key));
    if (!vendor) {
      vendor = { id: this.nextId(0xa), name: name.trim(), keys: new Set([key]), lastCategoryId: null, lastUsed: 0 };
      this.vendors.push(vendor);
    }
    vendor.lastUsed = ++this.serial;
    if (categoryId) vendor.lastCategoryId = categoryId;
    return vendor.id;
  }

  /** GET /v1/vendors: names containing the query (no fuzzy matching here), else the most recently used. */
  private vendorAnswer(e: Logged) {
    const q = (e.query.get('q') ?? '').trim().toLowerCase();
    const items = this.vendors
      .filter((v) => !q || v.name.toLowerCase().includes(q))
      .sort((a, b) => b.lastUsed - a.lastUsed)
      .map((v) => ({ id: v.id, name: v.name, matchedName: v.name, exact: v.keys.has(q.replace(/\s+/g, ' ')), registrationNo: null, phone: null, email: null, lastCategoryId: v.lastCategoryId }));
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
        made.vendorId = this.linkVendor(made.vendor, made.categoryId);
        this.expenses.unshift(made);
        return json(listed(made), 201);
      }
      return undefined;
    }
    const found = this.expenses.find((x) => x.id === id);
    if (!found) return notFound();
    if (!sub) {
      if (e.method === 'GET') return json(found);
      if (e.method === 'PATCH') {
        if (e.headers['if-match'] !== String(found.version)) return conflict('VERSION_MISMATCH');
        Object.assign(found, e.body, { version: found.version + 1 });
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
