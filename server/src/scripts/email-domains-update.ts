import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { isDomainName, loadDomainList } from '../email/domains/lists.js';

/**
 * MUT-367 (D2, A5): refreshes `src/email/domains/disposable.txt` from the public CC0 disposable-email-domains list,
 * at one pinned commit, so the same commit always writes the same bytes:
 *
 *   npm --prefix server run email-domains:update -- --commit <40-character sha>
 *
 * The result is sorted, de-duplicated and lower-cased; domains on our webmail or relay lists are left out (they
 * wait for review; they're never refused). Review the diff and commit it. Nothing else reads the network.
 */
export const UPSTREAM_REPO = 'disposable-email-domains/disposable-email-domains';
export const upstreamUrlFor = (commit: string) => `https://raw.githubusercontent.com/${UPSTREAM_REPO}/${commit}/disposable_email_blocklist.conf`;
const SHA = /^[0-9a-f]{40}$/;

export function buildDisposableFile(upstream: string, options: { commit: string; fetched: string; exclude: ReadonlySet<string> }): string {
  const domains = new Set<string>();
  for (const raw of upstream.split('\n')) {
    const line = raw.trim().toLowerCase();
    if (line === '' || line.startsWith('#')) continue;
    if (!isDomainName(line)) throw new Error(`upstream line "${raw.trim()}" is not a domain`);
    if (!options.exclude.has(line)) domains.add(line);
  }
  const header = [
    '# Disposable email domains: refused at signup (POST /v1/signups → 400 EMAIL_NOT_ACCEPTED, reason "disposable").',
    '# MUT-367 (ADR-159 §7a, ADR-177). A domain here also covers its subdomains.',
    `# source: ${upstreamUrlFor(options.commit)}`,
    `# commit: ${options.commit}`,
    `# fetched: ${options.fetched}`,
    '# licence: CC0-1.0',
    '# Written by `npm --prefix server run email-domains:update -- --commit <sha>`; webmail and relay domains are left out.',
  ];
  return `${[...header, ...[...domains].sort()].join('\n')}\n`;
}

export interface EmailDomainsUpdateIo {
  fetch: typeof fetch;
  write(text: string): void;
  out(line: string): void;
  today(): string;
}

export async function runEmailDomainsUpdate(argv: string[], io: EmailDomainsUpdateIo): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { commit: { type: 'string' } } });
  const commit = values.commit ?? '';
  if (!SHA.test(commit)) {
    io.out('usage: email-domains:update -- --commit <40-character sha of disposable-email-domains/disposable-email-domains>');
    return 2;
  }
  const res = await io.fetch(upstreamUrlFor(commit), { redirect: 'error' });
  if (!res.ok) {
    io.out(`fetch failed: ${res.status}`);
    return 1;
  }
  const exclude = new Set([...loadDomainList('free-webmail'), ...loadDomainList('relay')]);
  const text = buildDisposableFile(await res.text(), { commit, fetched: io.today(), exclude });
  io.write(text);
  io.out(`disposable.txt: ${text.split('\n').filter((l) => l && !l.startsWith('#')).length} domains at ${commit}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = new URL('../email/domains/disposable.txt', import.meta.url);
  process.exitCode = await runEmailDomainsUpdate(process.argv.slice(2), {
    fetch,
    write: (text) => writeFileSync(target, text),
    out: (line) => console.log(line),
    today: () => new Date().toISOString().slice(0, 10),
  });
}
