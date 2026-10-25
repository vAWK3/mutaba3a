import { readFileSync } from 'node:fs';
import * as Sentry from '@sentry/node-core/light';
import { SENTRY_EU_DSN } from '../config.js';
import { NOOP_REPORTER, type ErrorReporter } from './reporter.js';
import { SENTRY_RULES } from './sentry-rules.js';
import { scrubEvent } from './sentry-scrub.js';

/**
 * The only file that imports the Sentry SDK (ADR-091, MUT-148). `@sentry/node-core/light` runs without
 * OpenTelemetry (D2): errors only, no tracing, no auto-instrumentation.
 */
export type SentryTransportFactory = NonNullable<Parameters<typeof Sentry.init>[0]>['transport'];

export interface SentryReporterOptions {
  /** Unset = the no-op reporter: dev, tests and CI send nothing. */
  dsn: string | undefined;
  environment: string;
  release: string;
  /** Tests capture events here instead of sending them. */
  transport?: SentryTransportFactory;
}

const SURFACE = 'api';
/** A fixed name: the SDK would otherwise send the host name, which on an operator's laptop is a person's. */
const SERVER_NAME = 'mutaba3a-api';

/**
 * Default integrations are off (they include http, console and local-variable capture). An unhandled
 * rejection still ends the process, as Node 22 does without Sentry, once its event is sent ('strict').
 */
export const SENTRY_INTEGRATIONS = [
  Sentry.eventFiltersIntegration(),
  Sentry.functionToStringIntegration(),
  Sentry.linkedErrorsIntegration(),
  Sentry.dedupeIntegration(),
  Sentry.contextLinesIntegration(),
  Sentry.nodeContextIntegration(),
  Sentry.onUncaughtExceptionIntegration(),
  Sentry.onUnhandledRejectionIntegration({ mode: 'strict' }),
];

/** `mutaba3a-api@<package version>+<git SHA>`, so an event matches the deployed image and its pino lines. */
export const apiRelease = (packageVersion: string, serviceVersion: string) => `mutaba3a-api@${packageVersion}+${serviceVersion}`;

/** The server's package.json version: `dist/observability` and `src/observability` both sit two levels below it. */
export function serverPackageVersion(): string {
  const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
  return (JSON.parse(raw) as { version: string }).version;
}

/**
 * The reporter for the operator scripts deploy.sh runs through the proxy (pre-roll, post-roll). They read
 * no full Config, so the DSN gets the server config's EU-region check here.
 */
export function createScriptReporter(env: NodeJS.ProcessEnv = process.env, transport?: SentryTransportFactory): ErrorReporter {
  const dsn = env.SENTRY_DSN;
  if (dsn !== undefined && !SENTRY_EU_DSN.test(dsn)) throw new Error('SENTRY_DSN must be an https DSN on the EU region (ingest.de.sentry.io)');
  return createSentryReporter({
    dsn,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV ?? 'development',
    release: apiRelease(serverPackageVersion(), env.SERVICE_VERSION ?? '0.0.0-dev'),
    ...(transport ? { transport } : {}),
  });
}

export function createSentryReporter(options: SentryReporterOptions): ErrorReporter {
  if (!options.dsn) return NOOP_REPORTER;
  Sentry.init({
    dsn: options.dsn,
    environment: options.environment,
    release: options.release,
    serverName: SERVER_NAME,
    sendDefaultPii: SENTRY_RULES.sdk.sendDefaultPii,
    sampleRate: SENTRY_RULES.sdk.sampleRate,
    tracesSampleRate: SENTRY_RULES.sdk.tracesSampleRate,
    includeLocalVariables: SENTRY_RULES.sdk.includeLocalVariables,
    defaultIntegrations: false,
    integrations: SENTRY_INTEGRATIONS,
    initialScope: { tags: { surface: SURFACE } },
    beforeBreadcrumb: (breadcrumb) => (breadcrumb.category === 'console' ? null : breadcrumb),
    beforeSend: (event) => scrubEvent(event, SURFACE),
    ...(options.transport ? { transport: options.transport } : {}),
  });
  return {
    enabled: true,
    captureException: (error, context = {}) => {
      const tags = {
        ...(context.requestId ? { request_id: context.requestId } : {}),
        ...(context.route ? { route: context.route } : {}),
      };
      Sentry.captureException(error, { tags });
    },
    captureMessage: (level, message, tags = {}) => {
      Sentry.captureMessage(message, { level, tags });
    },
    flush: (timeoutMs) => Sentry.flush(timeoutMs),
  };
}
