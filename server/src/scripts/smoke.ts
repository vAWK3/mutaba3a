import { parseArgs } from 'node:util';
import { runSmoke } from '../smoke.js';

/**
 * Post-deploy smoke test against a running service. Exit code 0 only when every
 * check passes. Prints no secrets.
 *
 *   npm run smoke -- --url https://mutaba3a-api-xxxx.a.run.app [--expect-version <sha>]
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
  },
});

console.log(`smoke → ${values.url}`);
if (!process.env.MUTABA3A_ADMIN_TOKEN) console.log('skip  provisioning round trip (set MUTABA3A_ADMIN_TOKEN to run it)');

const results = await runSmoke({
  baseUrl: values.url,
  fetch: (input, init) => fetch(input, init),
  adminToken: process.env.MUTABA3A_ADMIN_TOKEN,
  expectVersion: values['expect-version'],
  log: (line) => console.log(line),
});

const failures = results.filter((r) => !r.ok).length;
console.log(failures === 0 ? 'smoke: all checks passed' : `smoke: ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
