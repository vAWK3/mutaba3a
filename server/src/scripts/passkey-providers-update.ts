import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { ProviderList } from '../auth/passkey-names.js';

/**
 * MUT-115 (DR8): refreshes `src/auth/passkey-providers.json`, the AAGUID → provider names a new passkey is named
 * after, from the public community list (MIT) at one pinned commit, so the same commit always writes the same bytes:
 *
 *   npm --prefix server run passkey-providers:update -- --commit <40-character sha>
 *
 * Review the diff and commit it. Nothing else reads the network. The checked-in file is a seed of well-known
 * providers until the operator first runs this (TD-245).
 */
export const UPSTREAM_REPO = 'passkeydeveloper/passkey-authenticator-aaguids';
export const upstreamUrlFor = (commit: string) => `https://raw.githubusercontent.com/${UPSTREAM_REPO}/${commit}/aaguid.json`;
const SHA = /^[0-9a-f]{40}$/;
const AAGUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NAME_MAX = 64;

export function buildProviderList(upstream: unknown, options: { commit: string; fetched: string }): ProviderList {
  if (typeof upstream !== 'object' || upstream === null) throw new Error('upstream is not a JSON object');
  const providers: Record<string, string> = {};
  for (const [key, entry] of Object.entries(upstream).sort(([a], [b]) => a.localeCompare(b))) {
    const aaguid = key.toLowerCase();
    const name = (entry as { name?: unknown }).name;
    if (!AAGUID.test(aaguid)) throw new Error(`upstream key "${key}" is not an AAGUID`);
    if (typeof name !== 'string' || name.trim() === '') throw new Error(`upstream entry ${key} has no name`);
    providers[aaguid] = name.trim().slice(0, NAME_MAX);
  }
  return { source: `${upstreamUrlFor(options.commit)} (MIT)`, updated: options.fetched, providers };
}

export interface PasskeyProvidersUpdateIo {
  fetch: typeof fetch;
  write(text: string): void;
  out(line: string): void;
  today(): string;
}

export async function runPasskeyProvidersUpdate(argv: string[], io: PasskeyProvidersUpdateIo): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { commit: { type: 'string' } } });
  const commit = values.commit ?? '';
  if (!SHA.test(commit)) {
    io.out(`usage: passkey-providers:update -- --commit <40-character sha of ${UPSTREAM_REPO}>`);
    return 2;
  }
  const res = await io.fetch(upstreamUrlFor(commit), { redirect: 'error' });
  if (!res.ok) {
    io.out(`fetch failed: ${res.status}`);
    return 1;
  }
  const list = buildProviderList(await res.json(), { commit, fetched: io.today() });
  io.write(`${JSON.stringify(list, null, 2)}\n`);
  io.out(`passkey-providers.json: ${Object.keys(list.providers).length} providers at ${commit}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = new URL('../auth/passkey-providers.json', import.meta.url);
  process.exitCode = await runPasskeyProvidersUpdate(process.argv.slice(2), {
    fetch,
    write: (text) => writeFileSync(target, text),
    out: (line) => console.log(line),
    today: () => new Date().toISOString().slice(0, 10),
  });
}
