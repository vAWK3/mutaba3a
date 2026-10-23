import { describe, expect, it } from 'vitest';
import { assertStripeUrl, billingReturnPath } from '../billingQueries';

/** MUT-362 review: where Stripe sends the person back, and where the drawer lets the browser go. */

const PROFILE = '22222222-2222-4222-8222-222222222222';

describe('billingReturnPath', () => {
  it.each([
    [`/p/${PROFILE}`, `/p/${PROFILE}`],
    [`/p/${PROFILE}/expenses/groups`, `/p/${PROFILE}/expenses/groups`],
    ['/', '/'],
    ['/sign-in', '/'],
    [`/p/${PROFILE}/`, '/'],
    // 36 characters of the UUID alphabet but not a UUID: the server refuses it, so fall back rather than fail with 422.
    ['/p/------------------------------------', '/'],
    ['', '/'],
  ])('%s → %s', (path, want) => {
    expect(billingReturnPath(path)).toBe(want);
  });
});

describe('assertStripeUrl', () => {
  it('lets the browser go only to Stripe over https', () => {
    expect(() => assertStripeUrl('https://checkout.stripe.com/c/pay/cs_test_1')).not.toThrow();
    expect(() => assertStripeUrl('https://billing.stripe.com/p/session/test_1')).not.toThrow();
    for (const url of ['http://checkout.stripe.com/c/pay/cs_1', 'https://evil.example/stripe.com', 'https://stripe.com.evil.example/', 'javascript:alert(1)', 'not a url']) {
      expect(() => assertStripeUrl(url), url).toThrow();
    }
  });
});
