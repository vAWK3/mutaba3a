import { describe, expect, it } from 'vitest';
import { planCheckout, parseBillingCountries } from '../../checkout.js';
import { stripeProvider } from '../provider.js';
import { FakeCheckoutGateway } from './fake.js';

/** MUT-702 Part B (ADR-286): the Stripe adapter behind the provider-neutral port. */
const ADDRESS = { country: 'IL', line1: 'Az-Zahra St. 18', city: 'Jerusalem', postalCode: '9100000' };
const USER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-26T09:00:00Z');
const COUNTRIES = parseBillingCountries({ consumerCountries: '*', customTaxIdCountries: ['IL'] });

describe('stripeProvider (MUT-702 Part B)', () => {
  it('is Stripe, selling as Barmajiyat', () => {
    const provider = stripeProvider(new FakeCheckoutGateway());
    expect([provider.id, provider.seller]).toEqual(['stripe', 'barmajiyat']);
  });

  it('reads every plan’s catalog from the twelve list keys', async () => {
    const catalogs = await stripeProvider(new FakeCheckoutGateway().withPlanPrices().withGaPrices()).catalogs();
    expect(catalogs.solo.ILS?.month).toEqual({ id: 'price_solo_m_ils', unitAmount: 3900, productId: 'prod_solo' });
    expect(catalogs.business.USD?.year.unitAmount).toBe(27000);
    expect(catalogs.firm.ILS?.month.unitAmount).toBe(24900);
  });

  it('saves the address, expires the other profile-plan Checkouts, then opens this one on the customer', async () => {
    const gateway = new FakeCheckoutGateway().withPlanPrices();
    const provider = stripeProvider(gateway);
    const catalogs = await provider.catalogs();
    const plan = planCheckout(
      { userId: USER, interval: 'month', country: 'IL', buyer: 'person', returnUrl: 'https://app.example', now: NOW, trialEndsAt: null, plan: 'solo', address: ADDRESS },
      { subscriptions: [], owned: [{ state: 'ACTIVE', source: 'TRIAL', tier: 'BUSINESS', until: new Date('2026-12-10T00:00:00Z') }] },
      COUNTRIES,
      catalogs.solo,
    );
    if (!plan.ok) throw new Error(plan.code);
    await gateway.createCheckoutSession({ ...plan.params, customer: 'cus_1', metadata: { mutaba3a_plan: 'business' } });
    const { url } = await provider.startCheckout({ customer: 'cus_1', address: ADDRESS, params: plan.params });
    expect(url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(gateway.calls.slice(-3)).toEqual(['address:cus_1', 'expire:cus_1', 'checkout:cus_1']);
    expect(gateway.expiredCheckouts).toBe(1);
    expect(gateway.addresses.get('cus_1')).toEqual(ADDRESS);
    expect(gateway.checkoutSessions.at(-1)).toMatchObject({ customer: 'cus_1', line_items: [{ price: 'price_solo_m_ils', quantity: 1 }] });
  });

  it('prefills from the customer’s saved address', async () => {
    const gateway = new FakeCheckoutGateway();
    gateway.addresses.set('cus_1', ADDRESS);
    expect(await stripeProvider(gateway).billingAddress('cus_1')).toEqual(ADDRESS);
    expect(await stripeProvider(gateway).billingAddress('cus_2')).toBeNull();
  });
});
