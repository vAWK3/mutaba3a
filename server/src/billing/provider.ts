import type { BillingAddress, CheckoutParams, PlanCatalogs, SELLER } from './checkout.js';

/**
 * MUT-702 Part B (ADR-288): the provider-neutral door the plan Checkout goes through. Barmajiyat sells every
 * subscription, on Stripe, Israel included (Basel, 2026-11-26), so there is one adapter (billing/stripe/provider.ts).
 * A second provider or seller widens these two types and adds a choice in `billingProvider`; the routes don't change.
 * Pause, the yearly switch, stay and come-back keep calling the Stripe gateways directly until then.
 */
export type ProviderId = 'stripe';
export type Seller = typeof SELLER;

export interface ProviderCheckout {
  /** The provider's customer for the person (found or made by the route). */
  customer: string;
  /** Saved on the customer first: the tax is computed from it and the provider's page can't change it. */
  address: BillingAddress;
  /** The session's parameters (billing/checkout.ts `planCheckout`), less the customer. */
  params: CheckoutParams;
}

export interface BillingProvider {
  readonly id: ProviderId;
  readonly seller: Seller;
  /** Every plan on sale's list prices (cached by the adapter). */
  catalogs(): Promise<PlanCatalogs>;
  /** The Israeli VAT rate at `percentage` an Israeli address is taxed with (ISRAEL_VAT); null when the provider has none. */
  israelVatRate(percentage: number): Promise<string | null>;
  /** The address saved for the customer, to prefill the form; null with none. */
  billingAddress(customer: string): Promise<BillingAddress | null>;
  /** Saves the address, expires the customer's other open profile-plan Checkouts, and opens this one. */
  startCheckout(input: ProviderCheckout): Promise<{ url: string }>;
}
