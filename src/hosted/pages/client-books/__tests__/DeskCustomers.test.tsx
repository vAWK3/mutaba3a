import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { AccountantClientWithStats, Schemas } from '../../../api/client';
import { emptyProfileRoutes, fail, locationOf, me, ok, profile, renderPortal, stubApi, type Handler } from '../../../__tests__/harness';
import { stripeNavigation } from '../../../data/billingQueries';
import { PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';

/**
 * MUT-768 (accountant channel): the desk with the accountant's customers. States and chips, one next action per row,
 * the Add customer drawer and its code pane, the Customer drawer (new code, change email, Take card), a customer who
 * claims meanwhile, and Activating after Stripe.
 */
const CAFE = '11111111-1111-4111-8111-111111111111';
const BAKERY = '22222222-2222-4222-8222-222222222222';
const STUDIO = '33333333-3333-4333-8333-333333333333';
const LAYLA = '44444444-4444-4444-8444-444444444444';
const U_CAFE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const U_BAKERY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const U_STUDIO = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const book = (profileId: string, name: string, ownerName: string, over: Partial<AccountantClientWithStats> = {}): AccountantClientWithStats => ({
  profileId, name, ownerName, sharedSince: '2026-11-01T09:00:00.000Z', profileType: 'business', status: 'active', endedReason: null, endedAt: null, entriesThisMonth: 2, lastActivityAt: null, ...over,
});
const customer = (userId: string, profileId: string, name: string, over: Partial<Schemas['ProvisionedCustomerRow']> = {}): Schemas['ProvisionedCustomerRow'] => ({
  userId, email: `${name.toLowerCase().replace(/\W/g, '')}@example.ps`, displayName: `${name} Owner`, profile: { id: profileId, name }, provisionedAt: '2026-11-01T09:00:00.000Z',
  state: 'awaiting_claim', link: { expiresAt: '2026-11-15T09:00:00.000Z', mailStatus: 'SENT' }, paid: false, ...over,
});

const CLIENTS = [book(CAFE, 'Café Nour', 'Samer Haddad'), book(BAKERY, 'Bakery', 'Layla Saeed'), book(STUDIO, 'Studio', 'Rana Haddad'), book(LAYLA, 'Old client', 'Nabil Odeh', { status: 'ended', endedReason: 'revoked', endedAt: '2026-11-01T00:00:00.000Z' })];
const CUSTOMERS = [customer(U_CAFE, CAFE, 'Café Nour'), customer(U_BAKERY, BAKERY, 'Bakery', { state: 'link_expired' }), customer(U_STUDIO, STUDIO, 'Studio', { state: 'claimed' })];

function desk(path = '/client-books', routes: Record<string, Handler> = {}, customers: Schemas['ProvisionedCustomerRow'][] | null = CUSTOMERS, clients = CLIENTS) {
  const api = stubApi({
    'GET /v1/me': () => ok(me([profile({ owned: true, isPersonalDefault: true, type: 'personal' })])),
    ...emptyProfileRoutes(),
    'GET /v1/billing': () => ok({ configured: false }),
    'GET /v1/clients': () => ok({ items: clients }),
    'GET /v1/accountant/customers': () => (customers === null ? fail(403, 'ACCOUNTANT_NOT_APPROVED') : ok({ items: customers, nextBefore: null })),
    ...routes,
  });
  return { ...renderPortal(path), api };
}

const created = (over: Record<string, unknown> = {}) => ({
  status: 'created', customer: { userId: U_CAFE, email: 'samer@cafenour.ps', displayName: 'Samer Haddad' }, profile: { id: CAFE, name: 'Café Nour' }, claimCode: '481702', linkExpiresAt: '2026-11-15T09:00:00.000Z', mailSent: true, ...over,
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => {}, removeEventListener: () => {} }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the desk with customers', () => {
  it('shows a state word on every row, and one next action where the customer needs one', async () => {
    desk();
    const table = await screen.findByRole('table', { name: 'Client books' });
    const rowOf = (text: string) => within(table).getAllByRole('row').find((r) => r.textContent?.includes(text))!;
    expect(rowOf('Café Nour')).toHaveTextContent('Awaiting claim');
    expect(within(rowOf('Café Nour')).getByRole('button', { name: /New code/ })).toBeInTheDocument();
    expect(rowOf('Bakery')).toHaveTextContent('Link expired');
    expect(within(rowOf('Bakery')).getByRole('button', { name: /Resend link/ })).toBeInTheDocument();
    expect(rowOf('Studio')).toHaveTextContent('Needs card');
    expect(within(rowOf('Studio')).getByRole('button', { name: /Take card/ })).toBeInTheDocument();
    expect(rowOf('Old client')).toHaveTextContent('No longer shared');
    expect(rowOf('Old client')).toHaveClass('hp-row-ended');
  });

  it('filters by chip, with counts', async () => {
    const { user } = desk();
    await screen.findByRole('table', { name: 'Client books' });
    const chips = screen.getByRole('group', { name: 'Show' });
    expect(within(chips).getByRole('button', { name: /All/ })).toHaveTextContent('4');
    expect(within(chips).getByRole('button', { name: /Awaiting claim/ })).toHaveTextContent('2');
    expect(within(chips).getByRole('button', { name: /Needs card/ })).toHaveTextContent('1');
    await user.click(within(chips).getByRole('button', { name: /Needs card/ }));
    expect(within(chips).getByRole('button', { name: /Needs card/ })).toHaveAttribute('aria-pressed', 'true');
    const table = screen.getByRole('table', { name: 'Client books' });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(table).toHaveTextContent('Studio');
    expect(table).not.toHaveTextContent('Café Nour');
  });

  it('is the plain client books for a person the operator has not approved: no chips, no Add customer', async () => {
    desk('/client-books', {}, null);
    expect(await screen.findByRole('table', { name: 'Client books' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add customer' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Show' })).toBeNull();
  });

  it('answers an empty desk with Add customer and the other way in', async () => {
    desk('/client-books', {}, [], []);
    expect(await screen.findByRole('heading', { name: 'No clients yet' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add customer' }).length).toBeGreaterThan(0);
    expect(screen.getByText('or ask a client to share')).toBeInTheDocument();
  });
});

describe('Add customer', () => {
  async function fill(user: ReturnType<typeof desk>['user'], email = 'Samer@CafeNour.ps') {
    await user.click((await screen.findAllByRole('button', { name: 'Add customer' }))[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Add customer' });
    await user.type(within(dialog).getByLabelText('Customer name'), 'Samer Haddad');
    await user.type(within(dialog).getByLabelText('Business name'), 'Café Nour');
    await user.type(within(dialog).getByLabelText('Email'), email);
    return dialog;
  }

  it('opens on ?newCustomer, asks five things, creates, and shows the code and where the link went', async () => {
    const posts: { body: unknown; key: string | null }[] = [];
    const { user, router } = desk('/client-books', { 'POST /v1/accountant/customers': (req) => (posts.push({ body: req.body, key: req.headers.get('Idempotency-Key') }), ok(created(), 201)) });
    const dialog = await fill(user);
    expect(locationOf(router)).toContain('newCustomer=true');
    expect(within(dialog).getAllByRole('textbox')).toHaveLength(3);
    expect(within(dialog).getAllByRole('combobox')).toHaveLength(2);
    await user.selectOptions(within(dialog).getByLabelText('Language of the mail'), 'en');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));

    expect(await within(dialog).findByText('Link sent to samer@cafenour.ps')).toBeInTheDocument();
    expect(within(dialog).getByTestId('code-reveal')).toHaveAccessibleName('Code: 4 8 1 7 0 2');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({ email: 'samer@cafenour.ps', displayName: 'Samer Haddad', profileName: 'Café Nour', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', locale: 'en' });
    expect(posts[0]!.key).toMatch(/^[0-9a-f-]{36}$/);

    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(locationOf(router)).not.toContain('newCustomer');
  });

  it('tells the accountant an existing address has an account', async () => {
    const { user } = desk('/client-books', { 'POST /v1/accountant/customers': () => ok({ status: 'exists' }) });
    const dialog = await fill(user);
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('An account exists. Ask the customer to share with you.');
    expect(within(dialog).queryByTestId('code-reveal')).toBeNull();
  });

  it.each([
    [fail(429, 'RATE_LIMITED', { limit: 'CREATE_PER_DAY', max: 50 }), 'Daily limit of 50 customers reached'],
    [fail(403, 'ACCOUNTANT_NOT_APPROVED'), "You can't add customers yet"],
    [fail(422, 'VALIDATION_FAILED', { reason: 'ADDRESS_REFUSED' }), "Use the customer's own address"],
  ])('shows the refusal in a banner at the top of the drawer', async (response, text) => {
    const { user } = desk('/client-books', { 'POST /v1/accountant/customers': () => response });
    const dialog = await fill(user);
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(await within(dialog).findByText(text)).toBeInTheDocument();
  });

  it('says the account was added when the link could not be sent, and resends it', async () => {
    const { user, api } = desk('/client-books', {
      'POST /v1/accountant/customers': () => ok(created({ mailSent: false }), 201),
      [`POST /v1/accountant/customers/${U_CAFE}/link`]: () => ok({ claimCode: '135790', email: 'samer@cafenour.ps', linkExpiresAt: '2026-11-15T09:00:00.000Z', mailSent: true }),
    });
    const dialog = await fill(user);
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    const note = await within(dialog).findByText('Added, link not sent');
    await user.click(within(note.closest('[role]') as HTMLElement).getByRole('button', { name: 'Resend link' }));
    await waitFor(() => expect(within(dialog).getByTestId('code-reveal')).toHaveAccessibleName('Code: 1 3 5 7 9 0'));
    expect(api.count(`POST /v1/accountant/customers/${U_CAFE}/link`)).toBe(1);
  });
});

describe('the Customer drawer', () => {
  const link = (code?: string) => ({ ...(code ? { claimCode: code } : {}), email: 'cafnour@example.ps', linkExpiresAt: '2026-11-15T09:00:00.000Z', mailSent: true });

  it('opens from the row on ?customer, with the setup actions of an unclaimed customer', async () => {
    const { user, router } = desk();
    const table = await screen.findByRole('table', { name: 'Client books' });
    await user.click(within(within(table).getAllByRole('row').find((r) => r.textContent?.includes('Café Nour'))!).getByRole('button', { name: /New code/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Customer' });
    expect(locationOf(router)).toContain(`customer=${U_CAFE}`);
    for (const name of ['Resend link', 'New code', 'Change email', 'Take card']) expect(within(dialog).getByRole('button', { name })).toBeInTheDocument();
  });

  it('makes a new code, and shows it once', async () => {
    const { user } = desk(`/client-books?customer=${U_CAFE}`, { [`POST /v1/accountant/customers/${U_CAFE}/link`]: () => ok(link('246810')) });
    const dialog = await screen.findByRole('dialog', { name: 'Customer' });
    await user.click(within(dialog).getByRole('button', { name: 'New code' }));
    expect(await within(dialog).findByTestId('code-reveal')).toHaveAccessibleName('Code: 2 4 6 8 1 0');
  });

  it('changes the email after naming what stops working', async () => {
    const puts: unknown[] = [];
    const { user } = desk(`/client-books?customer=${U_CAFE}`, { [`PUT /v1/accountant/customers/${U_CAFE}/email`]: (req) => (puts.push(req.body), ok(link('987654'))) });
    const dialog = await screen.findByRole('dialog', { name: 'Customer' });
    await user.click(within(dialog).getByRole('button', { name: 'Change email' }));
    expect(within(dialog).getByText('Old link and code stop working.')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('New email'), 'New@Cafe.ps');
    await user.click(within(dialog).getByRole('button', { name: 'Change' }));
    expect(await within(dialog).findByTestId('code-reveal')).toHaveAccessibleName('Code: 9 8 7 6 5 4');
    expect(puts).toEqual([{ email: 'new@cafe.ps' }]);
  });

  it('hides the setup actions once the customer has claimed, also when they claim while the drawer is open', async () => {
    let claimed = false;
    const { user } = desk(`/client-books?customer=${U_CAFE}`, {
      'GET /v1/accountant/customers': () => ok({ items: [customer(U_CAFE, CAFE, 'Café Nour', { state: claimed ? 'claimed' : 'awaiting_claim' })], nextBefore: null }),
      [`POST /v1/accountant/customers/${U_CAFE}/link`]: () => ((claimed = true), fail(403, 'CUSTOMER_CLAIMED')),
    });
    const dialog = await screen.findByRole('dialog', { name: 'Customer' });
    await user.click(within(dialog).getByRole('button', { name: 'New code' }));
    expect(await within(dialog).findByText('Claimed')).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).queryByRole('button', { name: 'New code' })).toBeNull());
    expect(within(dialog).queryByRole('button', { name: 'Change email' })).toBeNull();
  });
});

describe('Take card', () => {
  const openCard = async (routes: Record<string, Handler> = {}) => {
    const harness = desk('/client-books', routes);
    const table = await screen.findByRole('table', { name: 'Client books' });
    await harness.user.click(within(within(table).getAllByRole('row').find((r) => r.textContent?.includes('Studio'))!).getByRole('button', { name: /Take card/ }));
    return { ...harness, dialog: await screen.findByRole('dialog', { name: 'Customer' }) };
  };

  it('opens its pane straight from the row, asks plan, payment, customer type, country and address, and leaves for Stripe', async () => {
    const assign = vi.spyOn(stripeNavigation, 'assign').mockImplementation(() => {});
    const bodies: unknown[] = [];
    const { user, dialog, router } = await openCard({
      [`POST /v1/accountant/customers/${U_STUDIO}/checkout-session`]: (req) => (bodies.push(req.body), ok({ url: 'https://checkout.stripe.com/c/pay/abc' })),
    });
    expect(locationOf(router)).toContain('pane=card');
    for (const label of ['Plan', 'Payment', 'Customer type', 'Country', 'Address', 'City', 'Postal code']) expect(within(dialog).getByLabelText(label)).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText('Plan'), 'business');
    await user.selectOptions(within(dialog).getByLabelText('Payment'), 'year');
    await user.selectOptions(within(dialog).getByLabelText('Country'), 'PS');
    await user.type(within(dialog).getByLabelText('Address'), '12 Main St');
    await user.type(within(dialog).getByLabelText('City'), 'Ramallah');
    await user.type(within(dialog).getByLabelText('Postal code'), '00970');
    await user.click(within(dialog).getByRole('button', { name: 'Continue to Stripe' }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/abc'));
    expect(bodies).toEqual([{ plan: 'business', interval: 'year', country: 'PS', buyer: 'business', address: { country: 'PS', line1: '12 Main St', city: 'Ramallah', postalCode: '00970' }, returnPath: '/client-books' }]);
    // Marked, so the desk reads Activating when the accountant comes back.
    expect(Object.keys(JSON.parse(sessionStorage.getItem('mtb3a.desk.activating') ?? '{}'))).toEqual([U_STUDIO]);
  });

  it('shows the refusal in the pane when Stripe cannot use the address', async () => {
    const { user, dialog } = await openCard({ [`POST /v1/accountant/customers/${U_STUDIO}/checkout-session`]: () => fail(422, 'VALIDATION_FAILED', { reason: 'ADDRESS_INVALID' }) });
    await user.selectOptions(within(dialog).getByLabelText('Country'), 'PS');
    await user.type(within(dialog).getByLabelText('Address'), 'x');
    await user.type(within(dialog).getByLabelText('City'), 'y');
    await user.type(within(dialog).getByLabelText('Postal code'), 'z');
    await user.click(within(dialog).getByRole('button', { name: 'Continue to Stripe' }));
    expect(await within(dialog).findByText('Check the address')).toBeInTheDocument();
  });

  it('shows Activating after Stripe and Active once the list says paid, polling meanwhile', async () => {
    sessionStorage.setItem('mtb3a.desk.activating', JSON.stringify({ [U_STUDIO]: Date.now() }));
    let paid = false;
    const { api } = desk('/client-books', { 'GET /v1/accountant/customers': () => ok({ items: [customer(U_STUDIO, STUDIO, 'Studio', { state: 'claimed', paid })], nextBefore: null }) });
    const table = await screen.findByRole('table', { name: 'Client books' });
    const row = () => within(table).getAllByRole('row').find((r) => r.textContent?.includes('Studio'))!;
    await waitFor(() => expect(row()).toHaveTextContent('Activating'));
    expect(within(row()).queryByRole('button', { name: /Take card/ })).toBeNull();
    paid = true;
    await waitFor(() => expect(row()).toHaveTextContent('Active'), { timeout: 8000 });
    expect(api.count('GET /v1/accountant/customers')).toBeGreaterThan(1);
  }, 20_000);
});
