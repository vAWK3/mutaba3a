import { describe, expect, it } from 'vitest';
import type { AnalyticsCapture } from '../../../lib/analytics/guard';
import { posthogInitOptions } from '../../../lib/analytics/posthogConfig';
import type { PublicPageEvent } from '../portalAnalytics';

/**
 * MUT-562 (ADR-250): every count `countPublicPage` sends goes through the cookieless instance's real `before_send`
 * (the contract guard) and comes out with its properties, the cookieless hash inputs, and nothing that names anyone.
 */

const EVENTS: PublicPageEvent[] = [
  { event: 'share_link_opened', properties: { period: 'last_3_months' } },
  { event: 'accountant_accepted', properties: { via: 'signup' } },
  { event: 'accountant_accepted', properties: { via: 'signed_in' } },
  { event: 'period_downloaded', properties: { place: 'link_page', file: 'report', months: 3 } },
  // A whole-profile link has no month count: the event goes without it
  { event: 'period_downloaded', properties: { place: 'link_page', file: 'receipts' } },
];

const beforeSend = posthogInitOptions(() => ({ surface: 'portal', appVersion: '0.3.4', locale: 'en', cookieless: true, origin: 'https://portal.example' }), () => 'production')
  .before_send as unknown as (capture: AnalyticsCapture) => AnalyticsCapture | null;

function capture(event: string, properties: Record<string, unknown>): AnalyticsCapture {
  return {
    uuid: 'u',
    event,
    properties: {
      ...properties,
      token: 'phc_x',
      distinct_id: 'cookieless',
      $cookieless_mode: true,
      $raw_user_agent: 'Mozilla/5.0',
      $current_url: 'https://portal.example/share?x=1#tokentokentoken',
      $referrer: 'https://mail.example/',
      $browser: 'Chrome',
      email: 'sami@khoury-cpa.com',
      profileId: '55555555-5555-4555-8555-555555555555',
      viewerToken: 'v'.repeat(43),
    },
  } as AnalyticsCapture;
}

describe('the public pages’ cookieless counts', () => {
  it.each(EVENTS)('$event passes the guard with its properties and nothing identifying', ({ event, properties }) => {
    const out = beforeSend(capture(event, properties));
    expect(out, `${event} was dropped`).not.toBeNull();
    expect(out!.properties).toMatchObject({ ...properties, surface: 'portal', $cookieless_mode: true });
    expect(out!.properties.$current_url).toBe('https://portal.example/share');
    for (const field of ['email', 'profileId', 'viewerToken', '$referrer', '$browser']) expect(out!.properties, field).not.toHaveProperty(field);
  });

  it('a signed-in-only event is still refused on the cookieless instance', () => {
    expect(beforeSend(capture('income_recorded', { currency: 'USD' }))).toBeNull();
  });
});
