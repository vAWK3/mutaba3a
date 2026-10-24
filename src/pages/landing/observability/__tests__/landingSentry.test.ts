import { afterEach, describe, expect, it } from 'vitest';
import * as Sentry from '@sentry/browser';
import type { Envelope, ErrorEvent } from '@sentry/browser';
import { MAX_REPORTS_PER_PAGE, startLandingSentry } from '../landingSentry';

/**
 * The live wiring (MUT-150 D2): the real SDK, a recording transport, and the
 * events exactly as they would leave the browser, after beforeSend.
 */

const DSN = 'https://0123456789abcdef0123456789abcdef@o1.ingest.de.sentry.io/3';

let sent: ErrorEvent[] = [];

function recordingTransport() {
  return {
    send: async (envelope: Envelope) => {
      for (const [header, payload] of envelope[1]) if (header.type === 'event') sent.push(payload as ErrorEvent);
      return {};
    },
    flush: async () => true,
  };
}

const start = () => startLandingSentry({ dsn: DSN, release: 'mutaba3a-landing@0.1.21+abc1234', environment: 'test', transport: recordingTransport });

const delivered = async () => {
  await Sentry.flush(2000);
  return sent;
};

afterEach(async () => {
  await Sentry.close(100);
  sent = [];
  document.documentElement.lang = 'en';
  window.history.replaceState(null, '', '/');
});

describe('landingSentry (MUT-150 D2, AC2)', () => {
  it('reports with the landing surface, the release, the route template and the language, and no user', async () => {
    document.documentElement.lang = 'ar';
    window.history.replaceState(null, '', '/terms/2026-10-20?lang=ar');
    start().reportGlobal(new Error('boom'));
    const [event] = await delivered();
    expect(event.exception?.values?.[0]).toMatchObject({ type: 'Error', value: 'boom' });
    expect(event.tags).toMatchObject({ surface: 'landing', route: '/terms/:version', locale: 'ar' });
    expect(event).toMatchObject({ release: 'mutaba3a-landing@0.1.21+abc1234', environment: 'test' });
    expect(event.user).toBeUndefined();
    // The page URL keeps its path, never its query string (the contract's urlQueryParams: false)
    expect(event.request?.url).toBe('http://localhost:3000/terms/2026-10-20');
  });

  it('reports a crash with its component stack', async () => {
    start().reportBoundary(new Error('render'), '\n    at HeroSection');
    const [event] = await delivered();
    expect(event.contexts?.react).toMatchObject({ componentStack: '\n    at HeroSection' });
  });

  it('scrubs what a visitor typed into the request form before it leaves', async () => {
    start().reportGlobal(new Error('Request failed: email=layla@example.com phone=+972501234567'));
    const [event] = await delivered();
    const text = JSON.stringify(event);
    expect(text).not.toContain('layla@example.com');
    expect(text).not.toContain('+972501234567');
  });

  it('sends nothing once the page is no longer a website page, even from the SDK (eng R1, ADR-024)', async () => {
    const reporter = start();
    window.history.pushState(null, '', '/app/clients');
    reporter.reportGlobal(new Error('in the app'));
    expect(await delivered()).toEqual([]);
  });

  it(`sends at most ${MAX_REPORTS_PER_PAGE} reports per page load (eng R2, TD-200)`, async () => {
    const reporter = start();
    for (let index = 0; index < MAX_REPORTS_PER_PAGE + 2; index += 1) reporter.reportGlobal(new Error(`loop ${index}`));
    expect(await delivered()).toHaveLength(MAX_REPORTS_PER_PAGE);
  });

  it("doesn't count an error the contract ignores against the cap", async () => {
    const reporter = start();
    reporter.reportGlobal(new TypeError('Failed to fetch'));
    for (let index = 0; index < MAX_REPORTS_PER_PAGE; index += 1) reporter.reportGlobal(new Error(`real ${index}`));
    expect(await delivered()).toHaveLength(MAX_REPORTS_PER_PAGE);
  });
});
