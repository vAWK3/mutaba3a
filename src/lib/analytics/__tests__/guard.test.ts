import { describe, it, expect } from 'vitest';
import { guardEvent, type AnalyticsCapture, type GuardContext } from '../guard';

const LANDING: GuardContext = { surface: 'landing', appVersion: '0.1.12', locale: 'ar', origin: 'https://landing.example' };
const PORTAL: GuardContext = { surface: 'portal', appVersion: '0.1.12', locale: 'en', origin: 'https://portal.example' };

/** What posthog-js hands `before_send`: routing, identity, control and context properties around the event's own. */
function capture(event: string, properties: Record<string, unknown> = {}, extra: Partial<AnalyticsCapture> = {}): AnalyticsCapture {
  return {
    uuid: '0190-uuid',
    event,
    properties: {
      token: 'phc_test',
      distinct_id: 'random-id',
      $device_id: 'device-id',
      $insert_id: 'ins',
      $time: 1_700_000_000,
      $lib: 'web',
      $lib_version: '1.435.5',
      $process_person_profile: false,
      $session_id: 'sess',
      $window_id: 'win',
      $os: 'Mac OS X',
      $os_version: '14.0',
      $browser: 'Chrome',
      $browser_version: 129,
      $device_type: 'Desktop',
      $current_url: 'https://portal.example/p/profile-1/clients/customer-9?tab=owed',
      $pathname: '/p/profile-1/clients/customer-9',
      $host: 'portal.example',
      $referrer: '$direct',
      $referring_domain: '$direct',
      $screen_width: 1440,
      $timezone: 'Asia/Jerusalem',
      $browser_language: 'ar',
      gclid: 'ad-click',
      ...properties,
    },
    ...extra,
  };
}

describe('guardEvent: which events pass', () => {
  it('drops an event the contract does not list', () => {
    expect(guardEvent(capture('$autocapture'), LANDING)).toBeNull();
    expect(guardEvent(capture('$pageleave'), LANDING)).toBeNull();
    expect(guardEvent(capture('$exception'), PORTAL)).toBeNull();
  });

  it('drops a listed event from a surface that is not one of its emitters', () => {
    expect(guardEvent(capture('portal_opened'), LANDING)).toBeNull();
    expect(guardEvent(capture('$pageview'), PORTAL)).toBeNull();
    expect(guardEvent(capture('client_created'), PORTAL)).toBeNull();
  });

  it('passes a null capture through as null', () => {
    expect(guardEvent(null, LANDING)).toBeNull();
  });
});

describe('guardEvent: event properties', () => {
  it('keeps a valid enum value and drops an unknown one', () => {
    expect(guardEvent(capture('landing_cta_clicked', { cta: 'malafat' }), LANDING)?.properties.cta).toBe('malafat');
    expect(guardEvent(capture('landing_cta_clicked', { cta: 'download_mac' }), LANDING)?.properties).not.toHaveProperty('cta');
  });

  it('keeps a contract currency and a boolean, and drops values of the wrong type', () => {
    const kept = guardEvent(capture('income_recorded', { currency: 'JOD', paid: true }), PORTAL);
    expect(kept?.properties).toMatchObject({ currency: 'JOD', paid: true });
    const dropped = guardEvent(capture('income_recorded', { currency: 'GBP', paid: 'yes' }), PORTAL);
    expect(dropped?.properties).not.toHaveProperty('currency');
    expect(dropped?.properties).not.toHaveProperty('paid');
  });

  it('drops a property the event does not declare, even a harmless-looking one', () => {
    const out = guardEvent(capture('income_recorded', { currency: 'USD', amount_minor: 5000, client: 'Acme' }), PORTAL);
    expect(out?.properties).not.toHaveProperty('amount_minor');
    expect(out?.properties).not.toHaveProperty('client');
  });
});

describe('guardEvent: shared and control properties', () => {
  it('injects surface, app_version and locale, overriding anything the caller set', () => {
    const out = guardEvent(capture('portal_opened', { surface: 'landing', locale: 'he' }), PORTAL);
    expect(out?.properties).toMatchObject({ surface: 'portal', app_version: '0.1.12', locale: 'en' });
  });

  it('always sends $geoip_disable and keeps the routing, identity and control fields', () => {
    const out = guardEvent(capture('portal_opened'), PORTAL)!;
    expect(out.properties).toMatchObject({
      $geoip_disable: true,
      token: 'phc_test',
      distinct_id: 'random-id',
      $device_id: 'device-id',
      $insert_id: 'ins',
      $time: 1_700_000_000,
      $lib: 'web',
      $lib_version: '1.435.5',
      $process_person_profile: false,
    });
    expect(out.uuid).toBe('0190-uuid');
  });

  it('strips $set, $set_once and $unset', () => {
    const out = guardEvent(capture('portal_opened', {}, { $set: { email: 'a@b.c' }, $set_once: { $initial_referrer: 'x' }, $unset: ['x'] }), PORTAL)!;
    expect(out).not.toHaveProperty('$set');
    expect(out).not.toHaveProperty('$set_once');
    expect(out).not.toHaveProperty('$unset');
    expect(guardEvent(capture('portal_opened', { $set: { email: 'a@b.c' } }), PORTAL)?.properties).not.toHaveProperty('$set');
  });

  it('drops session, window, screen, timezone, language and ad-click properties everywhere', () => {
    for (const [event, ctx] of [['$pageview', LANDING], ['portal_opened', PORTAL]] as const) {
      const props = guardEvent(capture(event), ctx)!.properties;
      for (const key of ['$session_id', '$window_id', '$screen_width', '$timezone', '$browser_language', '$browser_version', 'gclid']) {
        expect(props, `${event} ${key}`).not.toHaveProperty(key);
      }
    }
  });
});

describe('guardEvent: the landing allowance', () => {
  it('keeps URL, UTM, referrer, device and the cookieless hash inputs on landing events', () => {
    const out = guardEvent(
      capture('$pageview', {
        $current_url: 'https://landing.example/?utm_source=x',
        $pathname: '/',
        $referrer: 'https://google.com/',
        $referring_domain: 'google.com',
        utm_source: 'x',
        $cookieless_mode: true,
        $raw_user_agent: 'Mozilla/5.0',
      }),
      LANDING,
    )!;
    expect(out.properties).toMatchObject({
      $current_url: 'https://landing.example/?utm_source=x',
      $pathname: '/',
      $referrer: 'https://google.com/',
      $referring_domain: 'google.com',
      utm_source: 'x',
      $cookieless_mode: true,
      $raw_user_agent: 'Mozilla/5.0',
      $host: 'portal.example',
      $device_type: 'Desktop',
    });
  });

  it('drops the OS and browser on the landing: the contract allows only URL, UTM, referrer and device type (review F3)', () => {
    const out = guardEvent(capture('$pageview', {}), LANDING)!;
    expect(out.properties).not.toHaveProperty('$os');
    expect(out.properties).not.toHaveProperty('$browser');
  });

  it('drops the referrer when it is this site\'s local app (/app)', () => {
    const out = guardEvent(
      capture('$pageview', { $referrer: 'https://landing.example/app/settings?tx=1', $referring_domain: 'landing.example' }),
      LANDING,
    )!;
    expect(out.properties).not.toHaveProperty('$referrer');
    expect(out.properties).not.toHaveProperty('$referring_domain');
  });

  it('keeps a same-site referrer that is another landing page', () => {
    const out = guardEvent(capture('$pageview', { $referrer: 'https://landing.example/hosted' }), LANDING)!;
    expect(out.properties.$referrer).toBe('https://landing.example/hosted');
  });
});

describe('guardEvent: the portal allowance', () => {
  it('drops every URL, path, host and referrer property, because portal URLs carry profile and client ids', () => {
    const props = guardEvent(capture('portal_opened'), PORTAL)!.properties;
    for (const key of ['$current_url', '$pathname', '$host', '$referrer', '$referring_domain', '$raw_user_agent', '$cookieless_mode', 'utm_source']) {
      expect(props, key).not.toHaveProperty(key);
    }
    expect(props).toMatchObject({ $browser: 'Chrome', $os: 'Mac OS X', $os_version: '14.0', $device_type: 'Desktop' });
  });
});

// MUT-513 (ADR-230): the welcome counts its doors before anyone signs in, the landing's cookieless way: only the
// fields PostHog's daily hash reads, and the choice. Nothing that tells one browser from another, and no other event.
describe('guardEvent: the portal welcome (MUT-513)', () => {
  const WELCOME: GuardContext = { ...PORTAL, cookieless: true };
  const COOKIELESS = { $cookieless_mode: true, $raw_user_agent: 'Mozilla/5.0', $referrer: 'https://elsewhere.example/', utm_source: 'mail' };

  it('keeps the cookieless routing fields and the choice, and drops the rest', () => {
    const guarded = guardEvent(capture('portal_welcome_choice', { choice: 'local', ...COOKIELESS }), WELCOME);

    expect(guarded?.properties).toMatchObject({ choice: 'local', surface: 'portal', $cookieless_mode: true, $raw_user_agent: 'Mozilla/5.0', $host: 'portal.example' });
    for (const field of ['$referrer', 'utm_source', '$browser', '$os', '$session_id', '$pathname']) expect(guarded?.properties).not.toHaveProperty(field);
  });

  it('keeps the page address without its query or fragment', () => {
    const guarded = guardEvent(capture('portal_welcome_choice', { choice: 'sign_in', $current_url: 'https://portal.example/sign-in?next=%2Fp%2F1#x' }), WELCOME);
    expect(guarded?.properties.$current_url).toBe('https://portal.example/sign-in');
  });

  it('sends nothing but the door count from the welcome, not even another portal event', () => {
    expect(guardEvent(capture('income_recorded', { currency: 'USD' }), WELCOME)).toBeNull();
    expect(guardEvent(capture('portal_opened'), WELCOME)).toBeNull();
  });

  it('drops an unknown door', () => {
    expect(guardEvent(capture('portal_welcome_choice', { choice: 'phone' }), WELCOME)?.properties).not.toHaveProperty('choice');
  });

  it('a signed-in portal event never carries the cookieless fields', () => {
    const guarded = guardEvent(capture('portal_welcome_choice', { choice: 'sign_in', ...COOKIELESS }), PORTAL);
    expect(guarded?.properties).not.toHaveProperty('$cookieless_mode');
    expect(guarded?.properties).not.toHaveProperty('$raw_user_agent');
  });
});
