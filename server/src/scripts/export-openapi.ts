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
