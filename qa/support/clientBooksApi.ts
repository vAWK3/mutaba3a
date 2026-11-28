import { randomUUID } from 'node:crypto';
import type { Page, Request, Route } from '@playwright/test';
import { OFFICE_A, QA_TERMS_VERSION, meBody, office, openSignedInPortal, type StubProfile } from './portal';
import { STORAGE } from './portalApi';

/**
 * MUT-562: an in-memory API for the accountant's side of sharing (MUT-559/560/575's routes): the Client books desk,
 * a client's feed, totals and receipts, the accept-invite routes and a share link's visitor routes. It answers the way
 * the server does and logs every /v1 call, so a spec asserts what the portal sent. Nothing reaches a real server.
 */

export const STUDIO = '55555555-5555-4555-8555-555555555555';
export const BAKERY = '66666666-6666-4666-8666-666666666666';
export const RENT = '77777777-7777-4777-8777-777777777777';
export const RENT_RECEIPT = '88888888-8888-4888-8888-888888888888';
export const LINK_TOKEN = 't'.repeat(43);
export const INVITE_TOKEN = 'k'.repeat(43);
export const PIN = '4821';

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
/** A money date `days` back, in this month when possible (the desk opens on this month). */
const thisMonthDay = (day: number) => {
  const now = new Date();
  const d = Math.min(day, now.getDate());
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/** A one-pixel PNG, the receipt's bytes. */
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** MUT-783 (MUT-782): a client's VAT state as GET /v1/clients/vat-periods lists it. */
export interface StubVat {
  chosenKind: 'MONTHLY' | 'BIMONTHLY' | 'YEARLY' | 'NONE' | null;
  period: {
    periodKey: string;
    kind: 'MONTHLY' | 'BIMONTHLY' | 'YEARLY';
    year: number;
    firstMonth: number;
    lastMonth: number;
    startDate: string;
    endDate: string;
    due: string | null;
    state: 'OPEN' | 'CLIENT_DONE' | 'CONFIRMED' | 'MORE_NEEDED';
    note: string | null;
    announcedAt: string;
    doneAt: string | null;
  } | null;
}

export interface StubClient {
  profileId: string;
  name: string;
  ownerName: string | null;
  status: 'active' | 'ended';
  entriesThisMonth: number | null;
  lastActivityAt: string | null;
}

export const RANA: StubClient = { profileId: STUDIO, name: 'Studio', ownerName: 'Rana Haddad', status: 'active', entriesThisMonth: 23, lastActivityAt: ago(0) };
export const LINA: StubClient = { profileId: BAKERY, name: 'Bakery', ownerName: 'Lina Sabbagh', status: 'ended', entriesThisMonth: null, lastActivityAt: null };

/** MUT-768 (accountant channel): an account the accountant created for a customer, as GET /v1/accountant/customers lists it. */
export interface StubCustomer {
  userId: string;
  profileId: string;
  name: string;
  email: string;
  displayName: string;
  state: 'awaiting_claim' | 'link_expired' | 'code_locked' | 'claimed';
  paid: boolean;
  /** The Stripe webhook is slow: after Checkout the list says paid only from this moment (ms since epoch). */
  paidAt?: number;
}

export const CAFE_USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const CAFE = '11111111-1111-4111-8111-111111111111';
export const CARD_USER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const CARD_PROFILE = '33333333-3333-4333-8333-333333333333';
export const NEW_CODE = '135790';
export const FIRST_CODE = '481702';

export const CAFE_CUSTOMER: StubCustomer = { userId: CAFE_USER, profileId: CAFE, name: 'Café Nour', email: 'samer@cafenour.ps', displayName: 'Samer Haddad', state: 'awaiting_claim', paid: false };
export const CARD_CUSTOMER: StubCustomer = { userId: CARD_USER, profileId: CARD_PROFILE, name: 'Dar Al-Salam', email: 'layla@daralsalam.ps', displayName: 'Layla Mansour', state: 'claimed', paid: false };

export interface Logged {
  method: string;
  path: string;
  query: URLSearchParams;
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
}

type InviteAnswer = 'ok' | 'gone' | 'mismatch' | 'already';
type UnlockAnswer = 'ok' | 'wrong' | 'locked' | 'limit' | 'gone';

export interface ClientBooksOptions {
  signedIn?: boolean;
  clients?: StubClient[];
  /** MUT-783: each client's VAT state by profile id, which turns the feature on (absent: vat-periods answers 404). */
  vat?: Record<string, StubVat>;
  /** The accept-invite page: what accept answers. */
  invite?: InviteAnswer;
  /** The share link: what unlock answers; `expireView` makes the first view read answer 401 (the 8 hours ended). */
  unlock?: UnlockAnswer;
  checkLocked?: boolean;
  expireView?: boolean;
  /** A client read answers 404 from now on (the owner stopped sharing). */
  revoked?: boolean;
  /** signup answers 409 ACCOUNT_EXISTS. */
  accountExists?: boolean;
  /** MUT-768: the accountant's customers. Absent = the feature is off and every accountant route answers 404. */
  customers?: StubCustomer[];
}

const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const error = (status: number, code: string, details: unknown = null) => json({ error: { code, message: code, details, requestId: 'qa' } }, status);

export class ClientBooksApi {
  readonly log: Logged[] = [];
  signedIn: boolean;
  clients: StubClient[];
  revoked: boolean;
  /** MUT-768: null while the feature is off. A spec changes a state to play "the customer claimed meanwhile". */
  customers: StubCustomer[] | null;
  attemptsLeft = 4;
  /** MUT-783: the desk's VAT state per client profile; null while the feature is off. */
  vat: Record<string, StubVat> | null;
  /** expireView: every view read after the first unlock answers 401 (the 8 hours ended) until the PIN is entered again. */
  private viewExpired: boolean;
  /** MUT-565: set by the Checkout stub; /v1/me reports the plan ACTIVE from the next read. */
  planActive = false;
  /** MUT-314: every stream form post, as the stream received it. */
  readonly streamed: Record<string, string>[] = [];
  private lastBody: string | null = null;
  private unlocks = 0;

  constructor(private readonly options: ClientBooksOptions = {}) {
    this.signedIn = options.signedIn ?? true;
    this.clients = options.clients ?? [RANA, LINA];
    this.revoked = options.revoked ?? false;
    this.viewExpired = options.expireView ?? false;
    this.customers = options.customers ? options.customers.map((c) => ({ ...c })) : null;
    this.vat = options.vat ? Object.fromEntries(Object.entries(options.vat).map(([id, v]) => [id, { ...v, period: v.period ? { ...v.period } : null }])) : null;
    // A customer's profile is a client book the accountant reads.
    for (const c of this.customers ?? []) if (!this.clients.some((k) => k.profileId === c.profileId)) this.clients.push({ profileId: c.profileId, name: c.name, ownerName: c.displayName, status: 'active', entriesThisMonth: 0, lastActivityAt: null });
  }

  calls(method: string, path: string): Logged[] {
    return this.log.filter((call) => call.method === method && call.path === path);
  }

  private profiles(): StubProfile[] {
    return [{ ...office(OFFICE_A, 'Sami Khoury'), type: 'PERSONAL' }];
  }

  private me(language: 'en' | 'ar') {
    const plan = { state: this.planActive ? 'ACTIVE' : 'NONE', source: this.planActive ? 'STRIPE' : null, until: null, cancelAtPeriodEnd: false };
    return {
      ...meBody(this.profiles(), language),
      clients: this.clients.map((c) => this.clientRow(c)),
      ...(this.options.freeBooksUsed ? { clientBooks: { count: 3, freeLimit: 3, cap: this.planActive ? 50 : 3, readable: 3, plan } } : {}),
    };
  }

  private ticket(type: string) {
    return json({ type, ticket: `${type}-ticket-${this.log.length}`, expiresAt: new Date(Date.now() + 120_000).toISOString(), filename: type === 'report' ? 'period.xlsx' : 'receipts.zip', estimate: { expenses: 9, income: 3, receipts: 11, receiptBytes: 4 * 1024 * 1024 } });
  }

  private clientRow(c: StubClient) {
    const ended = c.status === 'ended';
    return { profileId: c.profileId, name: c.name, ownerName: c.ownerName, sharedSince: ago(25), profileType: 'business', status: c.status, endedReason: ended ? 'revoked' : null, endedAt: ended ? ago(5) : null };
  }

  async open(page: Page, path: string, language: 'en' | 'ar' = 'en') {
    await page.context().route(`${STORAGE}/**`, (route) => route.fulfill({ status: 200, headers: { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' }, body: PNG_1PX }));
    return openSignedInPortal(page, { profiles: this.profiles(), language, path, mode: this.signedIn ? 'remote' : null, handle: (route, request, url) => this.handle(route, request, url, language) });
  }

  private async handle(route: Route, request: Request, url: URL, language: 'en' | 'ar'): Promise<boolean> {
    const method = request.method();
    const path = url.pathname;
    let body: Record<string, unknown> | null = null;
    this.lastBody = request.postData();
    try {
      body = request.postDataJSON() as Record<string, unknown> | null;
    } catch {
      body = null;
    }
    this.log.push({ method, path, query: url.searchParams, body, headers: request.headers() });
    const answer = this.answer(method, path, url, body, request.headers(), language);
    if (!answer) return false;
    await route.fulfill(answer);
    return true;
  }

  private answer(method: string, path: string, url: URL, body: Record<string, unknown> | null, headers: Record<string, string>, language: 'en' | 'ar') {
    const key = `${method} ${path}`;
    if (key === 'GET /v1/me') return this.signedIn ? json(this.me(language)) : error(401, 'UNAUTHENTICATED');
    if (key === 'GET /v1/billing') {
      if (!this.options.freeBooksUsed) return json({ configured: false });
      return json({ configured: true, countries: { consumer: ['IL'], consumerEverywhere: false, customTaxId: [] }, accountantPlan: { state: 'NONE', source: null, until: null, cancelAtPeriodEnd: false, interval: null, currency: null, catalog: { ILS: { month: 9900 }, USD: { month: 2900 } } } });
    }
    if (key === 'POST /v1/billing/checkout-session') {
      // Stripe's side is not driven here: the spec opens the success return itself
      this.planActive = true;
      return json({ url: 'https://checkout.stripe.com/c/pay/qa' });
    }
    if (key === 'POST /v1/period-downloads/stream') {
      this.streamed.push(Object.fromEntries(new URLSearchParams(String(this.lastBody ?? ''))));
      return { status: 200, headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="period.xlsx"' }, body: 'PK' };
    }
    if (key === 'POST /v1/share-links/download-ticket') return this.ticket(String(body?.type));
    // The accountant invite
    if (key === 'POST /v1/accountant-invites/check') return json({ profileName: 'Studio', ownerName: 'Rana Haddad', maskedEmail: 's***@khoury-cpa.com', expired: false, expiresAt: new Date(Date.now() + 11 * DAY).toISOString(), termsVersion: QA_TERMS_VERSION });
    if (key === 'POST /v1/accountant-invites/accept') return this.accept();
    if (key === 'POST /v1/accountant-invites/signup') {
      if (this.options.accountExists) return error(409, 'CONFLICT', { reason: 'ACCOUNT_EXISTS' });
      if (!this.clients.some((c) => c.profileId === STUDIO)) this.clients = [RANA, ...this.clients];
      return json({ email: 'sami@khoury-cpa.com', status: 'ACTIVE', client: this.clientRow(RANA) }, 201);
    }
    if (key === 'POST /v1/sessions') {
      this.signedIn = true;
      return json(this.me(language));
    }
    // MUT-768: the accountant's customers
    if (path.startsWith('/v1/accountant/customers')) return this.customerRoute(method, path, body);
    // MUT-783: the desk's VAT periods
    if (path.startsWith('/v1/clients/') && path.includes('vat-period')) return this.vatRoute(method, path, body);
    // The desk
    if (key === 'GET /v1/clients') return json({ items: this.clients.map((c) => ({ ...this.clientRow(c), entriesThisMonth: c.entriesThisMonth, lastActivityAt: c.lastActivityAt })) });
    if (method === 'DELETE' && path.startsWith('/v1/clients/')) {
      const id = path.split('/').at(-1);
      this.clients = this.clients.filter((c) => c.profileId !== id);
      return { status: 204, body: '' };
    }
    const profile = headers['x-mutaba3a-profile'];
    if (profile && profile !== OFFICE_A) return this.clientRead(key, url, profile);
    // A share link's visitor
    if (path.startsWith('/v1/share-links/')) return this.visitor(key, body);
    return null;
  }

  /** MUT-783: list, choose the kind, confirm or ask for more. Off (404) when the spec gave no VAT state. */
  private vatRoute(method: string, path: string, body: Record<string, unknown> | null) {
    if (!this.vat) return error(404, 'NOT_FOUND');
    const vat = this.vat;
    const kindOf = (v: StubVat | undefined) => v?.chosenKind ?? v?.period?.kind ?? 'NONE';
    if (method === 'GET' && path === '/v1/clients/vat-periods') {
      return json({ items: this.clients.filter((c) => c.status === 'active').map((c) => ({ profileId: c.profileId, kind: kindOf(vat[c.profileId]), chosenKind: vat[c.profileId]?.chosenKind ?? null, period: vat[c.profileId]?.period ?? null })) });
    }
    const [, , , profileId, resource, periodKey] = path.split('/');
    const entry = profileId ? vat[profileId] : undefined;
    if (!profileId || !entry) return error(404, 'NOT_FOUND');
    if (method === 'PUT' && resource === 'vat-period') {
      entry.chosenKind = body?.kind as StubVat['chosenKind'];
      return json({ kind: entry.chosenKind });
    }
    if (method === 'POST' && resource === 'vat-periods' && periodKey && entry.period?.periodKey === periodKey) {
      if (entry.period.state === 'CONFIRMED') return error(409, 'VAT_PERIOD_STATE');
      const confirmed = body?.decision === 'CONFIRMED';
      entry.period = { ...entry.period, state: confirmed ? 'CONFIRMED' : 'MORE_NEEDED', note: confirmed ? null : ((body?.note as string | undefined) ?? null) };
      return json(entry.period);
    }
    return error(404, 'NOT_FOUND');
  }

  /**
   * MUT-768: list, create, new code (the link route), change email and the activation Checkout. A customer who has
   * claimed refuses setup (403 CUSTOMER_CLAIMED). After Checkout the list says paid only a few seconds later (a slow
   * webhook), which is what the desk's Activating wait is for.
   */
  private customerRoute(method: string, path: string, body: Record<string, unknown> | null) {
    if (!this.customers) return error(404, 'NOT_FOUND');
    const customers = this.customers;
    const linkEnds = () => new Date(Date.now() + 14 * DAY).toISOString();
    if (method === 'GET' && path === '/v1/accountant/customers') {
      const now = Date.now();
      return json({
        items: customers.map((c) => ({
          userId: c.userId,
          email: c.email,
          displayName: c.displayName,
          profile: { id: c.profileId, name: c.name },
          provisionedAt: ago(1),
          state: c.state,
          link: c.state === 'claimed' ? null : { expiresAt: linkEnds(), mailStatus: 'SENT' },
          paid: c.paid || (c.paidAt !== undefined && now >= c.paidAt),
        })),
        nextBefore: null,
      });
    }
    if (method === 'POST' && path === '/v1/accountant/customers') {
      const userId = randomUUID();
      const profileId = randomUUID();
      const name = String(body?.profileName ?? '');
      const displayName = String(body?.displayName ?? '');
      const email = String(body?.email ?? '');
      customers.push({ userId, profileId, name, email, displayName, state: 'awaiting_claim', paid: false });
      this.clients.push({ profileId, name, ownerName: displayName, status: 'active', entriesThisMonth: 0, lastActivityAt: null });
      return json({ status: 'created', customer: { userId, email, displayName }, profile: { id: profileId, name }, claimCode: FIRST_CODE, linkExpiresAt: linkEnds(), mailSent: true }, 201);
    }
    const match = /^\/v1\/accountant\/customers\/([^/]+)\/(link|email|checkout-session)$/.exec(path);
    const customer = match ? customers.find((c) => c.userId === match[1]) : undefined;
    if (!match || !customer) return error(404, 'NOT_FOUND');
    if (match[2] === 'checkout-session') {
      customer.paidAt = Date.now() + 6_000;
      return json({ url: 'https://checkout.stripe.com/c/pay/qa-customer' });
    }
    if (customer.state === 'claimed') return error(403, 'CUSTOMER_CLAIMED');
    if (match[2] === 'email') customer.email = String(body?.email ?? customer.email);
    return json({ claimCode: NEW_CODE, email: customer.email, linkExpiresAt: linkEnds(), mailSent: true });
  }

  private accept() {
    const answer = this.options.invite ?? 'ok';
    if (answer === 'gone') return error(404, 'NOT_FOUND');
    if (answer === 'mismatch') return error(403, 'INVITE_EMAIL_MISMATCH', { maskedEmail: 'h***@firm.com' });
    if (answer === 'already') return error(409, 'CONFLICT', { reason: 'ALREADY_HAS_ACCESS' });
    if (!this.clients.some((c) => c.profileId === STUDIO)) this.clients = [RANA, ...this.clients];
    return json(this.clientRow(RANA));
  }

  private clientRead(key: string, url: URL, profile: string) {
    const client = this.clients.find((c) => c.profileId === profile);
    if (this.revoked || !client || client.status === 'ended') {
      if (this.revoked && client) client.status = 'ended';
      return error(404, 'PROFILE_NOT_FOUND');
    }
    if (key === 'GET /v1/profile-entries') {
      const kinds = url.searchParams.getAll('kinds');
      const items = clientEntries().filter((entry) => kinds.length === 0 || kinds.includes(entry.kind));
      return json({ items, nextCursor: null });
    }
    if (key === 'GET /v1/summaries/activity') {
      return json({ from: url.searchParams.get('from'), to: url.searchParams.get('to'), bucket: 'month', asOf: thisMonthDay(28), dataSince: null, earlierData: false, buckets: [], currencies: [{ currency: 'ILS', spent: '350.00', received: '3200.00', byCategory: [], byCustomer: [] }, { currency: 'USD', spent: '20.00', received: '0.00', byCategory: [], byCustomer: [] }], history: [], daysToPaid: { overall: null, byCustomer: [], samples: [] } });
    }
    if (key === 'GET /v1/period-downloads/ticket') {
      const type = url.searchParams.get('type')!;
      if (type === 'receipts' && this.options.zipTooLarge) return error(422, 'VALIDATION_FAILED', { reason: 'PERIOD_TOO_LARGE', type, limit: 1, estimate: 2 });
      return this.ticket(type);
    }
    if (key === 'GET /v1/expense-categories') return json({ items: [{ id: 'c0000001-0000-4000-8000-000000000000', name: 'Rent' }] });
    if (key === `GET /v1/expenses/${RENT}`) return json({ ...clientEntries()[0]!.expense, receipts: [{ id: RENT_RECEIPT, filename: 'rent.png', mimeType: 'image/png', status: 'READY', sizeBytes: 68 }] });
    if (key === `GET /v1/expenses/${RENT}/receipts/${RENT_RECEIPT}/download`) {
      const disposition = url.searchParams.get('disposition') === 'inline' ? 'inline' : 'attachment';
      return json({ url: `${STORAGE}/receipts/rent.png?disposition=${disposition}`, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() });
    }
    // Nothing else is readable, and nothing is writable: the server refuses writes regardless (MUT-559)
    return error(404, 'NOT_FOUND');
  }

  private visitor(key: string, body: Record<string, unknown> | null) {
    if (key === 'POST /v1/share-links/check') return this.options.checkLocked ? error(403, 'SHARE_LINK_REFUSED', { reason: 'LOCKED' }) : json({ state: 'pin' });
    if (key === 'POST /v1/share-links/unlock') {
      const answer = this.options.unlock ?? 'ok';
      if (answer === 'locked') return error(403, 'SHARE_LINK_REFUSED', { reason: 'LOCKED' });
      if (answer === 'limit') return error(403, 'SHARE_LINK_REFUSED', { reason: 'VIEWER_LIMIT' });
      if (answer === 'gone') return error(404, 'NOT_FOUND', { reason: 'SHARE_LINK_UNAVAILABLE' });
      if (body?.pin !== PIN || answer === 'wrong') return error(403, 'SHARE_LINK_REFUSED', { reason: 'PIN_WRONG', attemptsLeft: this.attemptsLeft-- });
      this.unlocks += 1;
      return json({ viewerToken: 'v'.repeat(43), viewerExpiresAt: new Date(Date.now() + 8 * 3_600_000).toISOString(), linkExpiresAt: new Date(Date.now() + 6 * DAY).toISOString(), profileName: 'Studio', ownerName: 'Rana Haddad', period: 'LAST_3_MONTHS', from: '2026-08-01', to: '2026-10-31' });
    }
    // Every read answers 401 (a dev build's first fetch can be aborted and sent again) until the second unlock
    if (this.viewExpired && this.unlocks === 1) return error(401, 'UNAUTHENTICATED', { reason: 'SHARE_VIEW_EXPIRED' });
    if (key === 'POST /v1/share-links/summary') return json({ from: '2026-08-01', to: '2026-10-31', expenses: [{ currency: 'ILS', total: '4812.40', count: 9, byCategory: [], byClient: [] }], received: [{ currency: 'ILS', total: '9600.00', count: 3 }] });
    if (key === 'POST /v1/share-links/entries') {
      const kinds = (body?.kinds as string[] | undefined) ?? ['expense', 'received'];
      return json({ items: linkEntries().filter((e) => kinds.includes(e.kind)), nextCursor: null });
    }
    if (key === 'POST /v1/share-links/expense-receipts') return json({ items: [{ filename: 'rent.png', mimeType: 'image/png', url: `${STORAGE}/receipts/rent.png?disposition=attachment`, expiresAt: new Date(Date.now() + 60_000).toISOString() }] });
    return error(404, 'NOT_FOUND');
  }
}

function clientEntries() {
  const expense = { id: RENT, occurredOn: thisMonthDay(3), amount: '350.00', currency: 'ILS', title: 'Office rent', vendor: null, vendorId: null, categoryId: 'c0000001-0000-4000-8000-000000000000', customerId: null, projectId: null, notes: null, createdByUserId: null, captureSource: null, vat: null, version: '1', createdAt: ago(2), updatedAt: ago(2), receiptCount: 1 };
  const income = { id: '99999999-0000-4000-8000-000000000001', kind: 'RECEIVED', amount: '3200.00', currency: 'ILS', occurredOn: thisMonthDay(1), customerId: null, projectId: null, title: 'Brand identity', notes: null, dueDate: null, status: 'POSTED', version: '1' };
  return [
    { kind: 'expense' as const, profileId: STUDIO, createdAt: ago(2), createdByUserId: null, expense },
    { kind: 'received' as const, profileId: STUDIO, createdAt: ago(3), createdByUserId: null, origin: 'capture', settlesOwedId: null, replacesPaymentId: null, income },
  ];
}

function linkEntries() {
  return [
    { kind: 'expense', createdAt: ago(7), expense: { key: 'AAAAAAAAAAAAAAAAAAAAAA', occurredOn: '2026-10-30', amount: '350.00', currency: 'ILS', title: 'Office rent', vendor: null, category: 'Rent', client: null, project: null, notes: null, vat: null, receiptCount: 1 } },
    { kind: 'received', createdAt: ago(9), origin: 'capture', settlesOwed: false, replacesPayment: false, income: { key: 'BBBBBBBBBBBBBBBBBBBBBB', kind: 'RECEIVED', occurredOn: '2026-10-28', amount: '3200.00', currency: 'ILS', title: 'Brand identity', notes: null, dueDate: null, status: 'POSTED', client: null, project: null } },
  ];
}
