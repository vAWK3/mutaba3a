import { addBreadcrumb } from '@sentry/node-core/light';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOOP_REPORTER, runScript, SHUTDOWN_FLUSH_TIMEOUT_MS, shutdownAndFlush, type ErrorReporter } from '../observability/reporter.js';
import {
  apiRelease,
  createScriptReporter,
  createSentryReporter,
  SENTRY_INTEGRATIONS,
  serverPackageVersion,
  type SentryTransportFactory,
} from '../observability/sentry-node.js';

const DSN = 'https://publickey@o1.ingest.de.sentry.io/42';

/** A transport that keeps every event the SDK would have sent. */
function capturing(): { events: Array<Record<string, any>>; transport: SentryTransportFactory } { // eslint-disable-line @typescript-eslint/no-explicit-any
  const events: Array<Record<string, any>> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    events,
    transport: () => ({
      send: async (envelope) => {
        for (const [header, item] of envelope[1]) if (header.type === 'event') events.push(item as Record<string, unknown>);
        return {};
      },
      flush: async () => true,
    }),
  };
}

function reporterWith(transport: SentryTransportFactory): ErrorReporter {
  return createSentryReporter({ dsn: DSN, environment: 'production', release: 'mutaba3a-api@0.4.1+abc1234', transport });
}

afterEach(() => vi.restoreAllMocks());

describe('createSentryReporter (MUT-148)', () => {
  it('is the no-op reporter when no DSN is configured, so dev, tests and CI send nothing', () => {
    expect(createSentryReporter({ dsn: undefined, environment: 'test', release: 'r' })).toBe(NOOP_REPORTER);
    expect(NOOP_REPORTER.enabled).toBe(false);
  });

  it('sends an event carrying request_id, route, release, environment and surface', async () => {
    const sink = capturing();
    const reporter = reporterWith(sink.transport);
    reporter.captureException(new Error('insert failed'), { requestId: 'req_91c2', route: '/v1/income/:id' });
    await reporter.flush(1000);
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toMatchObject({
      release: 'mutaba3a-api@0.4.1+abc1234',
      environment: 'production',
      tags: { surface: 'api', request_id: 'req_91c2', route: '/v1/income/:id' },
      exception: { values: [{ type: 'Error', value: 'insert failed' }] },
    });
  });

  it('names the server mutaba3a-api, never the machine (post-roll runs on the operator laptop)', async () => {
    const sink = capturing();
    const reporter = reporterWith(sink.transport);
    reporter.captureException(new Error('x'));
    await reporter.flush(1000);
    expect(sink.events[0]?.server_name).toBe('mutaba3a-api');
  });

  it('runs the contract scrubber on every event before it leaves', async () => {
    const sink = capturing();
    const reporter = reporterWith(sink.transport);
    reporter.captureException(new Error('lookup failed email=owner@example.test'));
    await reporter.flush(1000);
    expect(sink.events[0]?.exception.values[0].value).toBe('lookup failed email=[Filtered]');
  });

  it('drops the errors the api surface ignores', async () => {
    const sink = capturing();
    const reporter = reporterWith(sink.transport);
    const aborted = new Error('This operation was aborted');
    aborted.name = 'AbortError';
    reporter.captureException(aborted);
    await reporter.flush(1000);
    expect(sink.events).toHaveLength(0);
  });

  it('sends no console breadcrumbs', async () => {
    const sink = capturing();
    const reporter = reporterWith(sink.transport);
    addBreadcrumb({ category: 'console', message: 'name: John Smith' });
    reporter.captureException(new Error('x'));
    await reporter.flush(1000);
    expect(JSON.stringify(sink.events[0]?.breadcrumbs ?? [])).not.toContain('John Smith');
  });

  it('installs only the integrations the contract allows, with no http, console or local-variable capture', () => {
    expect(SENTRY_INTEGRATIONS.map((integration) => integration.name).sort()).toEqual(
      ['Context', 'ContextLines', 'Dedupe', 'EventFilters', 'FunctionToString', 'LinkedErrors', 'OnUncaughtException', 'OnUnhandledRejection'].sort(),
    );
  });
});

describe('createScriptReporter (pre-roll and post-roll, run by deploy.sh on the operator machine)', () => {
  it('sends nothing without SENTRY_DSN', () => {
    expect(createScriptReporter({})).toBe(NOOP_REPORTER);
  });

  it('refuses a DSN outside the EU region, like the server config', () => {
    expect(() => createScriptReporter({ SENTRY_DSN: 'https://k@o1.ingest.us.sentry.io/2' })).toThrow(/SENTRY_DSN/);
  });

  it('files events under the release and environment deploy.sh passes', async () => {
    const sink = capturing();
    const reporter = createScriptReporter({ SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: 'production', SERVICE_VERSION: '5119667b' }, sink.transport);
    reporter.captureException(new Error('backfill failed'));
    await reporter.flush(1000);
    expect(sink.events[0]).toMatchObject({ environment: 'production', release: `mutaba3a-api@${serverPackageVersion()}+5119667b` });
  });
});

describe('apiRelease', () => {
  it('joins the server package version and the deployed git SHA', () => {
    expect(apiRelease('0.4.1', '5119667b')).toBe('mutaba3a-api@0.4.1+5119667b');
  });
});

describe('shutdownAndFlush (MUT-148 AC6)', () => {
  it('stops taking requests, disconnects, then waits for pending reports before exiting', async () => {
    const order: string[] = [];
    const reporter: ErrorReporter = {
      enabled: true,
      captureException: () => undefined,
      captureMessage: () => undefined,
      flush: async (timeoutMs) => {
        order.push(`flush ${timeoutMs}`);
        return true;
      },
    };
    await shutdownAndFlush({
      stopAccepting: () => void order.push('close'),
      disconnect: async () => void order.push('disconnect'),
      reporter,
      exit: (code) => void order.push(`exit ${code}`),
    });
    expect(order).toEqual(['close', 'disconnect', `flush ${SHUTDOWN_FLUSH_TIMEOUT_MS}`, 'exit 0']);
  });

  it('still flushes and exits when the database disconnect fails', async () => {
    const order: string[] = [];
    const reporter: ErrorReporter = { enabled: true, captureException: () => undefined, captureMessage: () => undefined, flush: async () => (order.push('flush'), false) };
    await shutdownAndFlush({
      stopAccepting: () => undefined,
      disconnect: async () => {
        throw new Error('already closed');
      },
      reporter,
      exit: (code) => void order.push(`exit ${code}`),
      logError: (message) => void order.push(String(message)),
    });
    expect(order).toEqual(['shutdown: disconnect failed', 'flush', 'exit 0']);
  });
});

describe('runScript (MUT-148: post-roll and pre-roll report their crashes)', () => {
  const fake = () => {
    const captured: unknown[] = [];
    const reporter: ErrorReporter = {
      enabled: true,
      captureException: (error) => void captured.push(error),
      captureMessage: () => undefined,
      flush: vi.fn(async () => true),
    };
    return { captured, reporter };
  };

  it('reports a crash, flushes, and leaves exit code 1', async () => {
    const { captured, reporter } = fake();
    const failure = new Error('backfill failed');
    const exit: { code?: number } = {};
    const lines: unknown[][] = [];
    await runScript('post-roll', reporter, async () => {
      throw failure;
    }, { setExitCode: (code) => (exit.code = code), logError: (...args) => void lines.push(args) });
    expect(captured).toEqual([failure]);
    expect(reporter.flush).toHaveBeenCalledOnce();
    expect(exit.code).toBe(1);
    expect(lines[0]?.[0]).toBe('post-roll: failed');
  });

  it('reports nothing and keeps the exit code when the script succeeds', async () => {
    const { captured, reporter } = fake();
    const exit: { code?: number } = {};
    await runScript('pre-roll', reporter, async () => undefined, { setExitCode: (code) => (exit.code = code), logError: () => undefined });
    expect(captured).toEqual([]);
    expect(exit.code).toBeUndefined();
    expect(reporter.flush).toHaveBeenCalledOnce();
  });
});
