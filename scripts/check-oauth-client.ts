/**
 * `npm run release:oauth-client` (MUT-387): `make release web` runs it after the push. It waits
 * for Netlify to serve the OAuth client document this release published at CIMD_CLIENT_ID, then
 * checks it the way Malafat will: 200, no redirect, JSON, `client_id` equal to the URL.
 * `OAUTH_CLIENT_WAIT_SECONDS` sets the wait (0 checks once, e.g. any time after a release).
 */
import { readFileSync } from 'node:fs';
import { CIMD_CLIENT_ID } from '../src/services/oauth/oauth-client';
import { waitForLiveDocument, type LiveResponse } from './oauth-client-live';

const PUBLISHED_PATH = 'public/.well-known/oauth-client.json';
const DEFAULT_WAIT_SECONDS = 600; // a Netlify build plus deploy
const INTERVAL_MS = 15_000;

const waitSeconds = Number(process.env.OAUTH_CLIENT_WAIT_SECONDS ?? DEFAULT_WAIT_SECONDS);
if (!Number.isFinite(waitSeconds) || waitSeconds < 0) {
  console.error(`OAUTH_CLIENT_WAIT_SECONDS must be a number of seconds ≥ 0, got ${process.env.OAUTH_CLIENT_WAIT_SECONDS}`);
  process.exit(2);
}

async function fetchDocument(): Promise<LiveResponse> {
  const res = await fetch(CIMD_CLIENT_ID, { redirect: 'manual', headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(INTERVAL_MS) });
  return { status: res.status, location: res.headers.get('location'), contentType: res.headers.get('content-type'), body: await res.text() };
}

console.log(`Waiting up to ${waitSeconds}s for ${CIMD_CLIENT_ID} to serve this release's document…`);
const { problems, attempts } = await waitForLiveDocument({
  fetchDocument,
  published: readFileSync(PUBLISHED_PATH, 'utf8'),
  now: () => Date.now(),
  sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  timeoutMs: waitSeconds * 1000,
  intervalMs: INTERVAL_MS,
});

if (problems.length > 0) {
  console.error(`The live OAuth client document ${CIMD_CLIENT_ID} (after ${attempts} checks):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  console.error('Malafat sign-in with this identity fails until it is fixed: server/DEPLOYMENT.md §5a "What doesn\'t move".');
  process.exit(1);
}
console.log(`✓ ${CIMD_CLIENT_ID} serves this release's document: 200, JSON, no redirect, client_id matches.`);
