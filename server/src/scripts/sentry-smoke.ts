import { SCRIPT_FLUSH_TIMEOUT_MS } from '../observability/reporter.js';
import { createScriptReporter } from '../observability/sentry-node.js';

/**
 * MUT-148 D4: one deliberate error through the real reporter and scrubber, so the operator can see it
 * land in Sentry's mutaba3a-api project. The post-deploy smoke (`--expect-error-reporting on`) proves
 * Cloud Run has the DSN; this proves an event arrives.
 *
 *   SENTRY_DSN="$(gcloud secrets versions access latest --secret=mutaba3a-api-sentry-dsn)" \
 *     SENTRY_ENVIRONMENT=production npm run sentry:smoke
 */
const reporter = createScriptReporter();
if (!reporter.enabled) {
  console.error('sentry:smoke: SENTRY_DSN is not set');
  process.exit(2);
}
reporter.captureException(new Error(`sentry:smoke deliberate test error ${new Date().toISOString()}`), { route: 'sentry:smoke' });
const sent = await reporter.flush(SCRIPT_FLUSH_TIMEOUT_MS);
console.log(sent ? 'sentry:smoke: sent; look for it in Sentry under mutaba3a-api' : 'sentry:smoke: the event was not sent in time');
process.exit(sent ? 0 : 1);
