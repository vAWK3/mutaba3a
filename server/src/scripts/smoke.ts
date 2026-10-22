import { parseArgs } from 'node:util';
import { parseBaseUrl, runSmoke } from '../smoke.js';

/**
 * Post-deploy smoke test against a running service. Exit code 0 only when every
 * check passes. Prints no secrets.
 *
 *   npm run smoke -- --url https://<service>.a.run.app [--expect-version <sha>] [--expect-error-reporting on|off]
 *
 * Without MUTABA3A_ADMIN_TOKEN it checks the unauthenticated surface only
 * (health, readiness, contract, auth rejections). With it, it also provisions
 * a throwaway organization, validates its key end to end and revokes the key:
 * the Milestone 1 exit criterion exercised against a real deployment.
 */
const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:8787' },
    'expect-version': { type: 'string' },
    /** MUT-148 D4: on | off, what /health must say about error reporting (deploy.sh passes it from sentry_enabled). */
    'expect-error-reporting': { type: 'string' },
  },
});

const expectErrorReporting = values['expect-error-reporting'];
if (expectErrorReporting !== undefined && expectErrorReporting !== 'on' && expectErrorReporting !== 'off') {
  console.error(`smoke: --expect-error-reporting must be on or off, got "${expectErrorReporting}"`);
  process.exit(2);
}

let baseUrl: string;
try {
  baseUrl = parseBaseUrl(values.url);
} catch (error) {
  console.error(`smoke: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

console.log(`smoke → ${baseUrl}`);
if (!process.env.MUTABA3A_ADMIN_TOKEN) console.log('skip  provisioning round trip (set MUTABA3A_ADMIN_TOKEN to run it)');

const results = await runSmoke({
  baseUrl,
  fetch: (input, init) => fetch(input, init),
  adminToken: process.env.MUTABA3A_ADMIN_TOKEN,
  expectVersion: values['expect-version'],
  expectErrorReporting,
  log: (line) => console.log(line),
});

const failures = results.filter((r) => !r.ok).length;
console.log(failures === 0 ? 'smoke: all checks passed' : `smoke: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
