import { afterEach, describe, expect, it } from 'vitest';
import * as Sentry from '@sentry/browser';
import type { Envelope, ErrorEvent } from '@sentry/browser';
import { ApiError } from '../../api/client';
import { startPortalSentry, type PortalReporter } from '../portalSentry';

/**
 * The live wiring (MUT-149 T3): the real SDK, a recording transport, and the
 * events exactly as they would leave the browser, after beforeSend.
 */

const DSN = 'https://0123456789abcdef0123456789abcdef@o1.ingest.de.sentry.io/2';

let sent: ErrorEvent[] = [];
let reporter: PortalReporter | null = null;
let routeId: string | undefined = '/authed/p/$profileId/clients/$customerId';

function recordingTransport() {
  return {
    send: async (envelope: Envelope) => {
      for (const [header, payload] of envelope[1]) if (header.type === 'event') sent.push(payload as ErrorEvent);
      return {};
    },
    flush: async () => true,
  };
}

function start() {
  reporter = startPortalSentry({ currentRouteId: () => routeId }, { dsn: DSN, release: 'mutaba3a-portal@1.0.0+abc1234', environment: 'test', transport: recordingTransport });
  return reporter;
}

const delivered = async () => {
  await Sentry.flush(2000);
  return sent;
};

afterEach(async () => {
  reporter?.stop();
  reporter = null;
  sent = [];
  routeId = '/authed/p/$profileId/clients/$customerId';
  document.documentElement.lang = 'en';
  window.history.replaceState(null, '', '/');
  await Sentry.flush(100);
});

describe('portalSentry (MUT-149 D2, D4, D5)', () => {
  it('reports an uncaught error with the portal surface, the release and the environment', async () => {
    start().reportGlobal(new Error('boom'));
    const [event] = await delivered();
    expect(event.exception?.values?.[0]).toMatchObject({ type: 'Error', value: 'boom' });
    expect(event.tags).toMatchObject({ surface: 'portal' });
    expect(event).toMatchObject({ release: 'mutaba3a-portal@1.0.0+abc1234', environment: 'test' });
  });

  it.each([
    ['a network failure', new ApiError(0, 'NETWORK', 'Network error')],
    ['a 422', new ApiError(422, 'VALIDATION_FAILED', 'Invalid')],
    ['a 500', new ApiError(500, 'INTERNAL', 'Server error')],
  ])('drops %s the UI already handles, when it reaches the window (AC2, F14)', async (_name, error) => {
    start().reportGlobal(error);
    expect(await delivered()).toEqual([]);
  });

  it('reports an ApiError that crashed a page, with the request id that links it to the server event', async () => {
    start().reportBoundary(new ApiError(500, 'INTERNAL', 'Server error', null, 'req-123'), '\n    at ClientsPage');
    const [event] = await delivered();
    expect(event.tags).toMatchObject({ request_id: 'req-123' });
    expect(event.contexts?.react).toEqual({ componentStack: '\n    at ClientsPage' });
  });

  it('keeps a plain error from a boundary', async () => {
    start().reportBoundary(new TypeError('x is undefined'));
    expect(await delivered()).toHaveLength(1);
  });

  it('carries the internal user id only (AC3, D5)', async () => {
    const r = start();
    r.setUser('usr_1');
    r.reportGlobal(new Error('with user'));
    const [event] = await delivered();
    expect(event.user).toEqual({ id: 'usr_1' });
  });

  it('forgets the user when told to', async () => {
    const r = start();
    r.setUser('usr_1');
    r.setUser(null);
    r.reportGlobal(new Error('no user'));
    const [event] = await delivered();
    expect(event.user?.id).toBeUndefined();
  });

  it('reads the language at send time: Arabic after the SDK started in English (AC6)', async () => {
    document.documentElement.lang = 'en';
    const r = start();
    document.documentElement.lang = 'ar';
    r.reportGlobal(new Error('in Arabic'));
    const [event] = await delivered();
    expect(event.tags).toMatchObject({ locale: 'ar' });
  });

  it('tags the route template, never the concrete path', async () => {
    window.history.replaceState(null, '', '/p/2b1f0c3e-1111-4444-8888-000000000000/clients/c-1');
    start().reportGlobal(new Error('on a client'));
    const [event] = await delivered();
    expect(event.tags).toMatchObject({ route: '/authed/p/$profileId/clients/$customerId' });
    expect(event.request?.url).toBe('http://localhost:3000/p/2b1f0c3e-1111-4444-8888-000000000000/clients/c-1');
  });

  it('keeps a setup link token out: the page URL and error text are path-only', async () => {
    window.history.replaceState(null, '', '/setup#t=st_synthetic_setup_token');
    routeId = '/setup';
    start().reportGlobal(new TypeError('Cannot read properties of null on http://localhost:3000/setup#t=st_synthetic_setup_token'));
    const [event] = await delivered();
    expect(JSON.stringify(event)).not.toContain('st_synthetic_setup_token');
    expect(event.request?.url).toBe('http://localhost:3000/setup');
  });

  it('sends nothing after it stops', async () => {
    const r = start();
    r.stop();
    reporter = null;
    r.reportGlobal(new Error('after stop'));
    expect(await delivered()).toEqual([]);
  });
});
