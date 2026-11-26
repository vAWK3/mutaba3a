import { ALL_PLAN_LOOKUP_KEYS } from '../plans.js';
import { planCatalogsFrom, SELLER } from '../checkout.js';
import type { BillingProvider } from '../provider.js';
import type { CheckoutGateway } from './checkout-gateway.js';

/** MUT-702 Part B (ADR-286): the one adapter, a thin wrapper over the Stripe gateway; no Stripe logic lives here. */
export function stripeProvider(checkout: CheckoutGateway): BillingProvider {
  return {
    id: 'stripe',
    seller: SELLER,
    async catalogs() {
      return planCatalogsFrom(await checkout.pricesByLookupKey(ALL_PLAN_LOOKUP_KEYS));
    },
    billingAddress: (customer) => checkout.customerAddress(customer),
    async startCheckout({ customer, address, params }) {
      // Stripe Tax reads the customer's address, and `customer_update.address: never` keeps it as given.
      await checkout.setCustomerAddress(customer, address);
      // Only the newest profile-plan Checkout can be paid: two tabs can't buy two plans.
      await checkout.expireOpenCheckouts(customer, 'profile');
      return checkout.createCheckoutSession({ ...params, customer });
    },
  };
}
