import { describe, expect, it } from 'vitest';
import type { Entitlement } from '../entitlement.js';
import {
  BILLING_COUNTRIES,
  CHECKOUT_SESSION_TTL_SECONDS,
  CHECKOUT_SUBMIT_MESSAGE,
  GA_PRICE_LOOKUP_KEYS,
  catalogFrom,
  currencyOf,
  isReturnPath,
  parseBillingCountries,
  planCheckout,
  type Catalog,
  type CheckoutInput,
  type PersonBilling,
} from '../checkout.js';

/**
 * MUT-362 (plan §2.3, eng review D5/D6): who may start a Checkout, and the exact Stripe parameters. Pure: no Stripe,
 * no store. The rows run in the order planCheckout checks them.
 */

const NOW = new Date('2026-11-01T09:00:00.000Z');
const USER = '11111111-1111-4111-8111-111111111111';
const PROFILE = '22222222-2222-4222-8222-222222222222';
const COUNTRIES = parseBillingCountries({ consumerCountries: ['IL', 'GB'], customTaxIdCountries: ['IL', 'JO'] });
const CATALOG: Catalog = {
  ILS: { month: { id: 'price_ils_m', unitAmount: 3900 }, year: { id: 'price_ils_y', unitAmount: 39000 } },
  USD: { month: { id: 'price_usd_m', unitAmount: 1000 }, year: { id: 'price_usd_y', unitAmount: 10000 } },
};
const trial: Entitlement = { state: 'ACTIVE', source: 'TRIAL', tier: 'FREELANCER', until: new Date('2026-11-10T00:00:00.000Z') };
const malafat: Entitlement = { state: 'ACTIVE', source: 'MALAFAT', tier: null, until: null };
const foreverGrant: Entitlement = { state: 'ACTIVE', source: 'OPERATOR', tier: 'FREELANCER', until: null };
const expiringGrant: Entitlement = { state: 'ACTIVE', source: 'OPERATOR', tier: 'FREELANCER', until: new Date('2026-12-01T00:00:00.000Z') };

const input = (over: Partial<CheckoutInput> = {}): CheckoutInput => ({
  userId: USER,
  interval: 'month',
  country: 'IL',
  buyer: 'person',
  returnUrl: `https://app.mtb3a.com/p/${PROFILE}`,
  now: NOW,
  ...over,
});
const person = (over: Partial<PersonBilling> = {}): PersonBilling => ({ subscriptions: [], owned: [trial], ...over });
const plan = (over: Partial<CheckoutInput> = {}, who: Partial<PersonBilling> = {}, catalog: Catalog = CATALOG) =>
  planCheckout(input(over), person(who), COUNTRIES, catalog);

describe('planCheckout refusals (MUT-362 §2.3)', () => {
  it.each(['active', 'trialing', 'past_due', 'incomplete'])('a %s subscription is ALREADY_SUBSCRIBED', (status) => {
    expect(plan({}, { subscriptions: [{ status }] })).toEqual({ ok: false, code: 'ALREADY_SUBSCRIBED' });
  });

  it('an unpaid subscription sends the person to pay the open invoice (eng review D6)', () => {
    expect(plan({}, { subscriptions: [{ status: 'unpaid' }] })).toEqual({ ok: false, code: 'RESUME_IN_PORTAL' });
  });

  it('a paused subscription (never made by our flow) is CONTACT_US', () => {
    expect(plan({}, { subscriptions: [{ status: 'paused' }] })).toEqual({ ok: false, code: 'CONTACT_US' });
  });

  it('a cancelled or abandoned subscription does not block a new Checkout', () => {
    expect(plan({}, { subscriptions: [{ status: 'canceled' }, { status: 'incomplete_expired' }] })).toMatchObject({ ok: true });
  });

  it('a person who owns no profile has nothing to cover', () => {
    expect(plan({}, { owned: [] })).toEqual({ ok: false, code: 'NOTHING_TO_COVER' });
  });

  it('profiles all covered by Malafat are never priced here', () => {
    expect(plan({}, { owned: [malafat, malafat] })).toEqual({ ok: false, code: 'COVERED_BY_MALAFAT' });
  });

  it('a no-expiry operator grant on every owned profile is COVERED_BY_GRANT (eng review D5)', () => {
    expect(plan({}, { owned: [foreverGrant] })).toEqual({ ok: false, code: 'COVERED_BY_GRANT' });
    expect(plan({}, { owned: [foreverGrant, malafat] })).toEqual({ ok: false, code: 'COVERED_BY_GRANT' });
  });

  it('an expiring grant, or one profile still on its trial, may subscribe', () => {
    expect(plan({}, { owned: [expiringGrant] })).toMatchObject({ ok: true });
    expect(plan({}, { owned: [foreverGrant, trial] })).toMatchObject({ ok: true });
  });

  it('a person in a country not open to consumers is COUNTRY_NEEDS_BUSINESS (AC2)', () => {
    expect(plan({ country: 'JO' })).toEqual({ ok: false, code: 'COUNTRY_NEEDS_BUSINESS' });
    expect(plan({ country: 'US' })).toEqual({ ok: false, code: 'COUNTRY_NEEDS_BUSINESS' });
  });

  it('a currency without both GA prices is PRICES_NOT_SET', () => {
    expect(plan({}, {}, { ...CATALOG, ILS: null })).toEqual({ ok: false, code: 'PRICES_NOT_SET' });
    expect(plan({ country: 'GB' }, {}, { ...CATALOG, USD: null })).toEqual({ ok: false, code: 'PRICES_NOT_SET' });
  });

  it('a malformed country is VALIDATION_FAILED', () => {
    expect(plan({ country: 'il' })).toEqual({ ok: false, code: 'VALIDATION_FAILED' });
    expect(plan({ country: 'ISR' })).toEqual({ ok: false, code: 'VALIDATION_FAILED' });
  });
});

describe('planCheckout parameters (MUT-362 §2.3)', () => {
  it('a person in Israel pays the monthly ILS price, linked to them three ways', () => {
    const result = plan();
    expect(result.ok && result.currency).toBe('ILS');
    if (!result.ok) throw new Error('expected a plan');
    expect(result.params).toMatchObject({
      mode: 'subscription',
      line_items: [{ price: 'price_ils_m', quantity: 1 }],
      client_reference_id: USER,
      subscription_data: { metadata: { mutaba3a_user_id: USER } },
      customer_update: { address: 'auto', name: 'auto' },
      automatic_tax: { enabled: true },
      billing_address_collection: 'required',
      locale: 'auto',
      tax_id_collection: { enabled: true, required: 'never' },
      success_url: `https://app.mtb3a.com/p/${PROFILE}?billing=true&checkout=success`,
      cancel_url: `https://app.mtb3a.com/p/${PROFILE}?billing=true&checkout=cancelled`,
      expires_at: Math.floor(NOW.getTime() / 1000) + CHECKOUT_SESSION_TTL_SECONDS,
      custom_text: { submit: { message: CHECKOUT_SUBMIT_MESSAGE } },
    });
    // A person in a consumer country with no Stripe tax-ID type: an optional number field, never required.
    expect(result.params.custom_fields).toEqual([expect.objectContaining({ key: 'business_tax_number', optional: true })]);
  });

  it('yearly picks the yearly price; anywhere but Israel is USD', () => {
    const result = plan({ interval: 'year', country: 'GB' });
    if (!result.ok) throw new Error('expected a plan');
    expect(result.currency).toBe('USD');
    expect(result.params.line_items).toEqual([{ price: 'price_usd_y', quantity: 1 }]);
    expect(result.params.custom_fields).toEqual([]);
  });

  it('a business where Stripe has a tax-ID type must give one', () => {
    const result = plan({ country: 'AE', buyer: 'business' });
    if (!result.ok) throw new Error('expected a plan');
    expect(result.params.tax_id_collection).toEqual({ enabled: true, required: 'if_supported' });
    expect(result.params.custom_fields).toEqual([]);
  });

  it('a business in Jordan (no Stripe type, not open to consumers) must fill the tax number field', () => {
    const result = plan({ country: 'JO', buyer: 'business' });
    if (!result.ok) throw new Error('expected a plan');
    expect(result.params.custom_fields).toEqual([
      expect.objectContaining({ key: 'business_tax_number', type: 'text', optional: false, label: { type: 'custom', custom: expect.any(String) } }),
    ]);
    expect(result.params.tax_id_collection).toEqual({ enabled: true, required: 'never' });
  });

  it('a business in a consumer country gives its number only if it wants to', () => {
    const result = plan({ country: 'GB', buyer: 'business' });
    if (!result.ok) throw new Error('expected a plan');
    expect(result.params.tax_id_collection).toEqual({ enabled: true, required: 'never' });
  });

  it('the custom field label fits Stripe’s 50 characters and the message its 1200', () => {
    const result = plan({ country: 'JO', buyer: 'business' });
    if (!result.ok) throw new Error('expected a plan');
    const label = result.params.custom_fields?.[0]?.label;
    expect(label && 'custom' in label ? label.custom.length : 0).toBeLessThanOrEqual(50);
    expect(CHECKOUT_SUBMIT_MESSAGE.length).toBeLessThanOrEqual(1200);
    expect(CHECKOUT_SUBMIT_MESSAGE).toMatch(/[؀-ۿ]/);
  });
});

describe('billing countries, currency and return paths', () => {
  it('ILS for Israel, USD everywhere else', () => {
    expect(currencyOf('IL')).toBe('ILS');
    expect(['PS', 'JO', 'AE', 'GB', 'US'].map(currencyOf)).toEqual(['USD', 'USD', 'USD', 'USD', 'USD']);
  });

  it('a currency is in the catalog only with both prices, each in its own currency and interval', () => {
    const fact = (id: string, currency: string, unitAmount: number, interval: 'month' | 'year') => ({ id, currency, unitAmount, interval });
    const prices = new Map([
      ['freelancer_list_monthly_ils', fact('p1', 'ILS', 3900, 'month')],
      ['freelancer_list_yearly_ils', fact('p2', 'ILS', 39000, 'year')],
      ['freelancer_list_monthly_usd', fact('p3', 'USD', 1000, 'month')],
    ]);
    expect(catalogFrom(prices)).toEqual({ ILS: { month: { id: 'p1', unitAmount: 3900 }, year: { id: 'p2', unitAmount: 39000 } }, USD: null });
    // A key pointing at the wrong currency or interval is a dashboard mistake: never sell it.
    prices.set('freelancer_list_yearly_usd', fact('p4', 'EUR', 10000, 'year'));
    expect(catalogFrom(prices).USD).toBeNull();
    prices.set('freelancer_list_yearly_usd', fact('p4', 'USD', 10000, 'month'));
    expect(catalogFrom(prices).USD).toBeNull();
    prices.set('freelancer_list_yearly_usd', fact('p4', 'USD', 10000, 'year'));
    expect(catalogFrom(prices).USD).toEqual({ month: { id: 'p3', unitAmount: 1000 }, year: { id: 'p4', unitAmount: 10000 } });
  });

  it('the lookup keys follow the spike’s convention', () => {
    expect(GA_PRICE_LOOKUP_KEYS).toEqual({
      ILS: { month: 'freelancer_list_monthly_ils', year: 'freelancer_list_yearly_ils' },
      USD: { month: 'freelancer_list_monthly_usd', year: 'freelancer_list_yearly_usd' },
    });
  });

  it('the shipped file parses and opens no consumer country until MUT-355 is answered', () => {
    expect(BILLING_COUNTRIES).toEqual({ consumer: [], customTaxId: ['IL', 'JO'] });
  });

  it('the country file is validated: ISO-2 upper case, no duplicates', () => {
    expect(parseBillingCountries({ consumerCountries: [], customTaxIdCountries: ['IL', 'JO'] })).toEqual({ consumer: [], customTaxId: ['IL', 'JO'] });
    expect(() => parseBillingCountries({ consumerCountries: ['il'], customTaxIdCountries: [] })).toThrow(/consumerCountries/);
    expect(() => parseBillingCountries({ consumerCountries: ['IL', 'IL'], customTaxIdCountries: [] })).toThrow(/duplicate/);
    expect(() => parseBillingCountries({ consumerCountries: ['IL'] })).toThrow(/customTaxIdCountries/);
  });

  it('a return path is one of ours, never another origin', () => {
    expect(isReturnPath('/')).toBe(true);
    expect(isReturnPath(`/p/${PROFILE}`)).toBe(true);
    expect(isReturnPath(`/p/${PROFILE}/expenses/groups`)).toBe(true);
    for (const bad of ['https://evil.example', '//evil.example', '/p/not-a-uuid', `/p/${PROFILE}?x=1`, `/p/${PROFILE}/../..`, '', 'p/x']) {
      expect(isReturnPath(bad), bad).toBe(false);
    }
  });
});
