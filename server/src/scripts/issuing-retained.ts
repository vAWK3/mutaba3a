import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { adminClient, CliError } from './users.js';

/**
 * MUT-644 (ADR-277 D6): the operator's command for closed profiles' issued documents (`npm run issuing:retained -- …`).
 * Check who is asking before exporting: the zip holds the business's and its customers' details.
 */
const USAGE = [
  'usage: npm run issuing:retained -- <command> [--url <base url>] <options>',
  '  list    [--query <business name or VAT number>]   closed profiles whose issued documents are still kept, oldest first',
  '  archive --organization-id <uuid> --reference <support ticket> --out <file.zip> [--lang ar|en]',
  '          the former owner\'s archive: signed originals, signed copies of the rest, the uniform file; logged with --reference',
  '  sweep   [--dry-run]   delete those whose 7 years have passed (the hourly purge does the same)',
  'MUTABA3A_ADMIN_TOKEN is read from the environment.',
].join('\n');

export interface RetainedCliDeps {
  fetch: typeof fetch;
  url: string;
  token: string | undefined;
  out: (line: string) => void;
  err: (line: string) => void;
  write: (path: string, bytes: Uint8Array) => Promise<void>;
}

interface RetainedRow {
  organizationId: string;
  legalName: string | null;
  vatId: string | null;
  documents: number;
  newestDocumentDate: string | null;
  retainedUntil: string | null;
}

export async function runRetainedCommand(argv: string[], deps: RetainedCliDeps): Promise<number> {
  const [command, ...rest] = argv;
  if (command !== 'list' && command !== 'archive' && command !== 'sweep') {
    deps.err(USAGE);
    return 2;
  }
  let values: Record<string, string | boolean | undefined>;
  try {
    values = parseArgs({ args: rest, options: { url: { type: 'string' }, query: { type: 'string' }, 'organization-id': { type: 'string' }, reference: { type: 'string' }, out: { type: 'string' }, lang: { type: 'string' }, 'dry-run': { type: 'boolean' } } }).values;
  } catch (e) {
    deps.err(`${(e as Error).message}\n${USAGE}`);
    return 2;
  }
  const text = (name: string) => (typeof values[name] === 'string' && values[name] !== '' ? (values[name] as string) : undefined);
  const need = (name: string) => {
    const value = text(name);
    if (!value) throw new CliError(`--${name} is required`);
    return value;
  };
  try {
    if (!deps.token) throw new CliError('MUTABA3A_ADMIN_TOKEN is not set');
    const base = text('url') ?? deps.url;
    const client = adminClient(deps.fetch, base, deps.token);
    if (command === 'list') {
      const query = text('query');
      const { data } = await client.call<{ data: RetainedRow[] }>('GET', `/admin/v1/issuing/retained${query ? `?query=${encodeURIComponent(query)}` : ''}`);
      for (const r of data) deps.out(`${r.organizationId}  ${r.legalName ?? '(no details)'}  ${r.vatId ?? ''}  ${r.documents} document(s), newest ${r.newestDocumentDate ?? 'none'}, kept until ${r.retainedUntil ?? 'the next sweep'}`);
      deps.out(data.length === 0 ? 'no closed profile matches' : `${data.length} closed profile(s)`);
    } else if (command === 'sweep') {
      const dryRun = values['dry-run'] === true;
      const run = await client.call<{ due: number; swept: number; failed: number; incomplete: boolean; rows: { organizationId: string; outcome: string; documents: number }[] }>('POST', '/admin/v1/issuing/retention/sweep', { dryRun });
      for (const r of run.rows) deps.out(`${r.outcome}  ${r.organizationId}  ${r.documents} document(s)`);
      deps.out(`${run.due} due. ${dryRun ? `Dry run: ${run.swept} would be deleted.` : `Deleted ${run.swept}, failed ${run.failed}.`}${run.incomplete ? ' More are due: run it again.' : ''}`);
    } else {
      const id = need('organization-id');
      const out = need('out');
      const res = await deps.fetch(`${base}/admin/v1/issuing/retained/${encodeURIComponent(id)}/archive`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-token': deps.token },
        body: JSON.stringify({ reference: need('reference'), ...(text('lang') ? { lang: text('lang') } : {}) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
        throw new CliError(`archive → ${res.status} ${body.error?.code}: ${body.error?.message}`);
      }
      await deps.write(out, new Uint8Array(await res.arrayBuffer()));
      deps.out(`${res.headers.get('x-archive-documents') ?? '?'} document(s) written to ${out}. Hand it to the former owner over a channel you trust.`);
    }
    return 0;
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    deps.err(e.message);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = await runRetainedCommand(process.argv.slice(2), {
    fetch,
    url: 'http://localhost:8787',
    token: process.env.MUTABA3A_ADMIN_TOKEN,
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    write: (path, bytes) => writeFile(path, bytes),
  });
  process.exit(code);
}
