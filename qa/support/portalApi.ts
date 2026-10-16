import type { Page, Request, Route } from '@playwright/test';
import { customer, meBody, openSignedInPortal, type StubProfile } from './portal';

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
  r: { customerId: string; projectId?: string | null; gross: string; paid?: string; currency?: Currency; status?: string; origin?: string; dueDate?: string; postingDate?: string; title?: string | null },
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
    reversalReason: null,
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

export function category(n: number, name: string) {
  return { id: uid(0xf, n), name, color: null, archived: false, version: 1, createdAt: STAMP, updatedAt: STAMP };
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

export function expense(n: number, e: { amount: string; currency?: Currency; title?: string | null; vendor?: string | null; categoryId?: string | null; customerId?: string | null; occurredOn?: string; notes?: string | null }) {
  return {
    id: uid(0x9, n),
    occurredOn: e.occurredOn ?? '2026-10-03',
    amount: e.amount,
    currency: e.currency ?? 'ILS',
    title: e.title ?? null,
    vendor: e.vendor ?? null,
    categoryId: e.categoryId ?? null,
    customerId: e.customerId ?? null,
    projectId: null,
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
  summary?: ReturnType<typeof currencyBlock>[];
  customerSummaries?: ReturnType<typeof customerSummary>[];
  /** Expenses a type change would leave uncategorized (GET …/type-change). */
  uncategorizedOnTypeChange?: number;
  signedIn?: boolean;
  /** The setup link `/setup#<token>` carries (MUT-236); `valid` turns `used` once redeemed, as on the server. */
  setupLink?: StubSetupLink;
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
  private profiles: ProfileState[];
  private readonly customers;
  private readonly projects;
  private readonly receivables;
  private readonly payments;
  private readonly attachments;
  private readonly categories;
  private readonly expenses;
  private readonly conversions;
  private readonly summary;
  private readonly customerSummaries;
  private readonly uncategorized: number;
  private readonly onceQueue: { method: string; path: RegExp; answer: OnceAnswer }[] = [];
  private serial = 500;
  private setupLink: StubSetupLink | null;

  constructor(seed: FakeApiSeed) {
    this.signedIn = seed.signedIn ?? true;
    this.profiles = seed.profiles.map((stub) => ({ stub, defaultCurrency: 'ILS', version: 1 }));
    this.customers = Array.from({ length: seed.clients ?? 0 }, (_, i) => customer(i));
    this.projects = [...(seed.projects ?? [])];
    this.receivables = [...(seed.receivables ?? [])];
    this.payments = [...(seed.payments ?? [])];
    this.attachments = [...(seed.attachments ?? [])];
    this.categories = [...(seed.categories ?? [])];
    this.expenses = [...(seed.expenses ?? [])];
    this.conversions = [...(seed.conversions ?? [])];
    this.summary = seed.summary ?? [];
    this.customerSummaries = new Map((seed.customerSummaries ?? []).map((s) => [s.customerId, s]));
    this.uncategorized = seed.uncategorizedOnTypeChange ?? 0;
    this.setupLink = seed.setupLink ?? null;
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

  me(language: 'en' | 'ar' = 'en') {
    const body = meBody(
      this.profiles.map((p) => p.stub),
      language,
    );
    return {
      ...body,
      profiles: body.profiles.map((p) => {
        const state = this.profiles.find((s) => s.stub.id === p.id);
        return state ? { ...p, defaultCurrency: state.defaultCurrency, version: state.version } : p;
      }),
    };
  }

  /** Sign in with every /v1 call answered by this API (and openSignedInPortal's defaults behind it). */
  async open(page: Page, path: string, language: 'en' | 'ar' = 'en', options: { chooseLanguage?: boolean } = {}) {
    await page.context().route(`${STORAGE}/**`, (route) => this.serveStorage(route));
    return openSignedInPortal(page, {
      profiles: this.profiles.map((p) => p.stub),
      language,
      path,
      chooseLanguage: options.chooseLanguage,
      handle: (route, request, url) => this.handle(route, request, url, language),
    });
  }

  private async serveStorage(route: Route) {
    const request = route.request();
    this.storage.push({ method: request.method(), url: request.url() });
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'PUT, GET', 'Access-Control-Allow-Headers': '*' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (request.method() === 'PUT') return route.fulfill({ status: 200, headers: cors, body: '' });
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

    if (resource === 'profiles') return this.profileAnswer(e, id, sub);

    if (resource === 'summaries') {
      if (id === 'organization') return json({ asOf: '2026-10-15', currencies: this.summary });
      if (id === 'customers' && sub) return this.customerSummaries.has(sub) ? json(this.customerSummaries.get(sub)) : notFound();
    }
    if (resource === 'customers' && method === 'GET') {
      if (!id) return page(this.customers);
      const found = this.customers.find((c) => c.id === id);
      return found ? json(found) : notFound();
    }
    if (resource === 'projects' && method === 'GET') {
      const customerId = q('customerId');
      return page(this.projects.filter((p) => !customerId || p.customerId === customerId));
    }
    if (resource === 'receivables') return this.receivableAnswer(e, id, sub);
    if (resource === 'payments' && method === 'GET' && !id) {
      return page(this.payments.filter((p) => (!q('status') || p.status === q('status')) && (!q('customerId') || p.customerId === q('customerId'))));
    }
    if (resource === 'payments' && id) return this.paymentAnswer(e, id);
    if (resource === 'income' && method === 'POST') return this.income(e.body ?? {});
    if (resource === 'income' && method === 'PATCH' && id) return this.redateIncome(e, id);
    if (resource === 'attachments' && method === 'GET') {
      if (!id) return page(this.attachments.filter((a) => (!q('kind') || a.kind === q('kind')) && (!q('customerId') || a.customerId === q('customerId'))));
      const found = this.attachments.find((a) => a.id === id);
      if (found && sub === 'download') return json({ url: `${STORAGE}/${encodeURIComponent(found.filename)}`, expiresAt: '2026-10-15T12:15:00Z', filename: found.filename, mimeType: found.mimeType });
      return notFound();
    }
    if (resource === 'expense-categories' && method === 'GET') return json({ items: this.categories });
    if (resource === 'expenses') return this.expenseAnswer(e, id, sub, subId, action);
    if (resource === 'conversions') return this.conversionAnswer(e, id);
    return undefined;
  }

  /** The two public setup routes (MUT-235): the check names the account only for a valid link; a redeem uses it up. */
  private setupAnswer(e: Logged) {
    const link = this.setupLink ?? { state: 'invalid' as const };
    const email = link.email ?? 'nour@office.ps';
    if (e.path === '/v1/account-setup/check') {
      if (link.state !== 'valid') return json({ state: link.state });
      return json({ state: 'valid', email, locale: link.locale ?? 'en', purpose: link.purpose ?? 'SETUP', expiresAt: '2026-10-19T09:00:00.000Z' });
    }
    if (link.state !== 'valid') return json({ error: { code: 'SETUP_LINK_UNUSABLE', message: 'Ask for a new link', details: { state: link.state } } }, 410);
    this.markSetupLink('used');
    return json({ email });
  }

  private nextId(kind: number) {
    this.serial += 1;
    return uid(kind, this.serial);
  }

  private profileAnswer(e: Logged, id?: string, sub?: string) {
    const state = this.profiles.find((p) => p.stub.id === id);
    if (e.method === 'POST' && !id) {
      const body = e.body as { name: string; type: 'BUSINESS' | 'PERSONAL'; defaultCurrency?: Currency };
      const stub: StubProfile = { id: this.nextId(0x7), name: body.name, type: body.type, owned: true, writerOfRecord: null };
      this.profiles.unshift({ stub, defaultCurrency: body.defaultCurrency ?? 'ILS', version: 1 });
      return json(this.me().profiles[0], 201);
    }
    if (!state) return notFound();
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
    const b = body as { kind: 'received' | 'owed'; amount: string; currency: Currency; occurredOn: string; customerId?: string; title?: string; dueDate?: string; method?: 'CASH' | 'BANK'; notes?: string };
    const n = this.serial++;
    if (b.kind === 'owed') {
      const made = receivable(n, { customerId: b.customerId ?? '', gross: b.amount, currency: b.currency, dueDate: b.dueDate, postingDate: b.occurredOn, title: b.title ?? null });
      this.receivables.unshift(made);
      return json({ id: made.id, kind: 'owed', amount: b.amount, currency: b.currency, occurredOn: b.occurredOn, customerId: b.customerId ?? null, projectId: null, title: b.title ?? null, notes: b.notes ?? null, dueDate: made.dueDate, status: 'open' }, 201);
    }
    const made = payment(n, { customerId: b.customerId ?? null, amount: b.amount, currency: b.currency, receivedOn: b.occurredOn, method: b.method, mine: true });
    this.payments.unshift(made);
    return json({ id: made.id, kind: 'received', amount: b.amount, currency: b.currency, occurredOn: b.occurredOn, customerId: b.customerId ?? null, projectId: null, title: null, notes: b.notes ?? null, dueDate: null, status: 'unallocated' }, 201);
  }

  /** MUT-224: GET one payment; PATCH its received date with If-Match (MUT-223), allocations untouched. */
  private paymentAnswer(e: Logged, id: string) {
    const found = this.payments.find((p) => p.id === id);
    if (!found) return notFound();
    if (e.method === 'GET') return json(found);
    if (e.method === 'PATCH') {
      if (e.headers['if-match'] !== String(found.version)) return conflict('VERSION_MISMATCH');
      found.receivedOn = (e.body as { receivedOn: string }).receivedOn;
      found.version += 1;
      return json(found);
    }
    return undefined;
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

  private expenseAnswer(e: Logged, id?: string, sub?: string, subId?: string, action?: string) {
    const q = (key: string) => e.query.get(key) ?? undefined;
    if (!id) {
      if (e.method === 'GET') {
        return page(
          this.expenses
            .filter((x) => (!q('categoryId') || x.categoryId === q('categoryId')) && (!q('customerId') || x.customerId === q('customerId')))
            .map(listed),
        );
      }
      if (e.method === 'POST') {
        const b = e.body as Json;
        const made = { ...expense(this.serial++, { amount: String(b.amount), currency: b.currency as Currency }), ...b, id: this.nextId(0x9), receipts: [] as StubReceipt[] } as StubExpense;
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
