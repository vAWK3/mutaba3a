import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { stringify } from 'yaml';
import { createApp } from '../app.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { MemoryLedgerStore } from '../repositories/memory.js';

/**
 * Writes the generated OpenAPI document to openapi/openapi.yaml, or with
 * --check verifies the committed file matches (mirrors Malafat's
 * `pnpm openapi:check`, ADR-033: the spec in git is the contract).
 */
const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, '../../openapi/openapi.yaml');

const app = createApp({
  store: new MemoryLedgerStore(),
  logger: pino({ level: 'silent' }),
  rateLimiter: new SlidingWindowRateLimiter(1),
  adminToken: 'x'.repeat(32),
  keyEnvironment: 'live',
  version: 'generated',
});

const res = await app.request('/openapi.json');
const runtime = (await res.json()) as Record<string, unknown>;
const yaml = stringify(runtime, { lineWidth: 0 });

// --json: print the vendored-contract envelope Malafat keeps at
// apps/web/src/features/money/contract/mutaba3a-openapi.json (its contract
// test pins the client to this file). Source commit + sha of the YAML so a
// stale copy is visible in review.
if (process.argv.includes('--json')) {
  const { createHash } = await import('node:crypto');
  const { execSync } = await import('node:child_process');
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: here, encoding: 'utf8' }).trim();
  } catch {
    /* not a git checkout */
  }
  const envelope = {
    _vendored: {
      source: 'vAWK3/mutaba3a server/openapi/openapi.yaml',
      commit,
      sha256: createHash('sha256').update(yaml).digest('hex'),
      note: "Vendored copy of Mutaba3a's committed contract. Regenerate: in the Mutaba3a repo run `cd server && npm run openapi:json > /path/to/this/file` (prints this envelope), then run the Money contract test. The test fails when the client calls a path, method or field that is not in this file.",
    },
    ...runtime,
  };
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  process.exit(0);
}

if (process.argv.includes('--check')) {
  let committed = '';
  try {
    committed = readFileSync(target, 'utf8');
  } catch {
    console.error(`openapi:check — ${target} is missing. Run npm run openapi:generate.`);
    process.exit(1);
  }
  if (committed !== yaml) {
    console.error('openapi:check — openapi/openapi.yaml is out of date. Run npm run openapi:generate and commit.');
    process.exit(1);
  }
  console.log('openapi:check — up to date');
} else {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, yaml);
  console.log(`wrote ${target}`);
}
