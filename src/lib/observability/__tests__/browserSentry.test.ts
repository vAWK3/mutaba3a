import { describe, it, expect } from 'vitest';
import type { Breadcrumb, ErrorEvent, EventHint } from '@sentry/browser';
import { browserSentryOptions } from '../browserSentry';
import { SENTRY_RULES } from '../../../../server/src/observability/sentry-rules';

const base = { dsn: 'https://0123456789abcdef0123456789abcdef@o1.ingest.de.sentry.io/2', release: 'mutaba3a-portal@1.0.0+abc1234', environment: 'production' };

const crash = (overrides: Partial<ErrorEvent> = {}): ErrorEvent =>
  ({ type: undefined, exception: { values: [{ type: 'TypeError', value: 'x is undefined' }] }, ...overrides }) as ErrorEvent;

describe('browserSentryOptions (ADR-091, MUT-149 D4)', () => {
  it('applies the contract SDK options: no PII, errors only, nothing sampled but errors', () => {
    const options = browserSentryOptions('portal', base);
    expect(options).toMatchObject({
      dsn: base.dsn,
      release: base.release,
      environment: base.environment,
      sampleRate: SENTRY_RULES.sdk.sampleRate,
      tracesSampleRate: SENTRY_RULES.sdk.tracesSampleRate,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      profileSessionSampleRate: 0,
      defaultIntegrations: false,
      // MUT-150 review: the SDK's drop-count envelopes skip beforeSend, so they are off too
      sendClientReports: false,
    });
  });

  it('collects no personal data: SDK 11 spells the contract\'s sendDefaultPii: false out per category', () => {
    expect(SENTRY_RULES.sdk.sendDefaultPii).toBe(false);
    expect(browserSentryOptions('portal', base).dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ['User-Agent'] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    });
  });

  it('tags every event with its surface', () => {
    expect(browserSentryOptions('landing', base).initialScope).toEqual({ tags: { surface: 'landing' } });
  });

  it('scrubs every event on send: a URL keeps its path only, a user keeps only its id', () => {
    const { beforeSend } = browserSentryOptions('portal', base);
    const event = crash({ request: { url: 'https://portal.example.test/setup#token=secret' }, user: { id: 'u1', email: 'a@b.c' } });
    const sent = beforeSend!(event, {} as EventHint) as ErrorEvent;
    expect(sent.request?.url).toBe('https://portal.example.test/setup');
    expect(sent.user).toEqual({ id: 'u1' });
  });

  it('drops what the caller says to drop, before scrubbing', () => {
    const hint = { originalException: new Error('handled') } as EventHint;
    const { beforeSend } = browserSentryOptions('portal', { ...base, dropEvent: (_event, h) => h.originalException === hint.originalException });
    expect(beforeSend!(crash(), hint)).toBeNull();
    expect(beforeSend!(crash(), {} as EventHint)).not.toBeNull();
  });

  it('drops the errors the surface ignores (contract rule 8)', () => {
    const { beforeSend } = browserSentryOptions('portal', base);
    expect(beforeSend!(crash({ exception: { values: [{ type: 'TypeError', value: 'Failed to fetch' }] } }), {} as EventHint)).toBeNull();
  });

  it('reads the lazy tags at send time, so a language switch after init is reported (AC6)', () => {
    let locale = 'en';
    const { beforeSend } = browserSentryOptions('portal', { ...base, tags: () => ({ locale }) });
    locale = 'ar';
    const sent = beforeSend!(crash({ tags: { route: '/p/$profileId/' } }), {} as EventHint) as ErrorEvent;
    expect(sent.tags).toEqual({ route: '/p/$profileId/', locale: 'ar' });
  });

  it('keeps only the contract tags, even from the lazy ones', () => {
    const { beforeSend } = browserSentryOptions('portal', { ...base, tags: () => ({ locale: 'ar', org_id: 'o1' }) });
    expect((beforeSend!(crash(), {} as EventHint) as ErrorEvent).tags).toEqual({ locale: 'ar' });
  });

  it('drops console breadcrumbs and keeps navigation ones path-only (rule 6)', () => {
    const { beforeBreadcrumb } = browserSentryOptions('portal', base);
    expect(beforeBreadcrumb!({ category: 'console', message: 'x' } as Breadcrumb)).toBeNull();
    const nav = beforeBreadcrumb!({ category: 'navigation', data: { from: '/setup#token=abc', to: '/p/1/?q=Acme' } } as Breadcrumb);
    expect(nav?.data).toEqual({ from: '/setup', to: '/p/1/' });
  });

  it('strips denied keys from a fetch breadcrumb', () => {
    const { beforeBreadcrumb } = browserSentryOptions('portal', base);
    const crumb = beforeBreadcrumb!({ category: 'fetch', data: { url: '/v1/income?x=1', method: 'POST', status_code: 422, body: '{"amount":"5"}' } } as Breadcrumb);
    expect(crumb?.data).toEqual({ url: '/v1/income', method: 'POST', status_code: 422 });
  });
});
