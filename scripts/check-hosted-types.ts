/**
 * `npm run hosted:types:check` (MUT-43, hosted-portal.md §7.1): the portal's
 * typed client must match the server's OpenAPI document. Regenerates the types
 * into a temp file and fails if they differ from the committed
 * `src/hosted/api/schema.d.ts` — the client-side twin of `server`'s
 * `openapi:check`. Fix with `npm run hosted:types`.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SPEC = 'server/openapi/openapi.yaml';
const COMMITTED = 'src/hosted/api/schema.d.ts';

const dir = mkdtempSync(join(tmpdir(), 'hosted-types-'));
try {
  const fresh = join(dir, 'schema.d.ts');
  execFileSync(join('node_modules', '.bin', 'openapi-typescript'), [SPEC, '-o', fresh], { stdio: 'pipe' });
  if (readFileSync(fresh, 'utf8') !== readFileSync(COMMITTED, 'utf8')) {
    console.error(`${COMMITTED} is out of date with ${SPEC}. Run: npm run hosted:types`);
    process.exit(1);
  }
  console.log(`${COMMITTED} matches ${SPEC}.`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
