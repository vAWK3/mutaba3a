import { describe, it, expect } from 'vitest';
import { POSTHOG_HOST, posthogInitOptions } from '../posthogConfig';
import type { GuardContext } from '../guard';

const ctx = (surface: GuardContext['surface']): (() => GuardContext) => () => ({ surface, appVersion: '1.2.3', locale: 'ar' });

describe('posthogInitOptions', () => {
  it('sends to PostHog EU only (ADR-090)', () => {
    expect(POSTHOG_HOST).toBe('https://eu.i.posthog.com');
    expect(posthogInitOptions(ctx('landing')).api_host).toBe(POSTHOG_HOST);
  });

  it.each(['landing', 'portal'] as const)('turns every SDK feature off on the %s (README rule 7)', (surface) => {
    expect(posthogInitOptions(ctx(surface))).toMatchObject({
      autocapture: false,
      rageclick: false,
      capture_pageleave: false,
      capture_dead_clicks: false,
      capture_exceptions: false,
      capture_performance: false,
      capture_heatmaps: false,
      enable_heatmaps: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_product_tours: true,
      disable_conversations: true,
      disable_web_experiments: true,
      disable_external_dependency_loading: true,
      advanced_disable_flags: true,
      advanced_disable_feature_flags: true,
      person_profiles: 'never',
    });
  });

  it('counts landing pageviews cookieless, and stores nothing (D1)', () => {
    expect(posthogInitOptions(ctx('landing'))).toMatchObject({ cookieless_mode: 'always', capture_pageview: true, save_referrer: true });
  });

  it('keeps the portal ID in localStorage, never a cookie, and sends each event at once (rules 3, 5)', () => {
    expect(posthogInitOptions(ctx('portal'))).toMatchObject({
      persistence: 'localStorage',
      capture_pageview: false,
      save_referrer: false,
      request_batching: false,
    });
    expect(posthogInitOptions(ctx('portal'))).not.toHaveProperty('cookieless_mode');
  });

  // MUT-513: the welcome's own instance counts its doors cookieless, with nothing stored and no consent record to read
  it('counts the portal welcome cookieless: no storage, no pageview, no referrer, never opted out by a consent record', () => {
    const options = posthogInitOptions(() => ({ ...ctx('portal')(), cookieless: true }));
    expect(options).toMatchObject({ cookieless_mode: 'always', capture_pageview: false, save_referrer: false, request_batching: false });
    expect(options).not.toHaveProperty('persistence');
    expect(options).not.toHaveProperty('opt_out_capturing_by_default');
  });

  it('makes a missing consent record mean "off" on the portal, so an opt-out in one tab silences every tab (MUT-155 review F1)', () => {
    expect(posthogInitOptions(ctx('portal'))).toMatchObject({ opt_out_capturing_by_default: true, opt_out_persistence_by_default: true });
    expect(posthogInitOptions(ctx('landing'))).not.toHaveProperty('opt_out_capturing_by_default');
  });

  it('routes every event through the contract guard with the live context', () => {
    let locale: 'ar' | 'en' = 'ar';
    const options = posthogInitOptions(() => ({ surface: 'portal', appVersion: '1.2.3', locale }));
    const beforeSend = options.before_send as (cr: unknown) => { properties: Record<string, unknown> } | null;
    expect(beforeSend({ uuid: 'u', event: 'not_in_contract', properties: {} })).toBeNull();
    locale = 'en';
    expect(beforeSend({ uuid: 'u', event: 'portal_opened', properties: {} })?.properties).toMatchObject({ surface: 'portal', locale: 'en' });
  });
});
