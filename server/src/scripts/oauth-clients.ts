import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

/**
 * MUT-593 (ADR-254): the operator's CLI for confidential OAuth clients (Malafat), through the admin API of a running
 * service like `npm run provision:user`. MUTABA3A_ADMIN_TOKEN comes from the environment, never a flag.
 *
 *   npm run oauth:client -- register --url "$URL" --name Malafat \
 *     --jwks-uri https://office.malafat.app/.well-known/mtb3a-jwks.json --redirect-uri https://office.malafat.app/mtb3a/callback
 *   npm run oauth:client -- disable --url "$URL" --client-id mcc_…   (a compromised key: every token ends)
 *
 * A routine key rotation needs neither: Malafat publishes the new key at its JWKS URL and MTB3A picks it up.
 */

export interface OAuthClientCliDeps {
  fetch: typeof fetch;
  url: string;
  token: string | undefined;
  out: (line: string) => void;
  err: (line: string) => void;
}

export async function runOAuthClientCli(argv: string[], deps: OAuthClientCliDeps): Promise<number> {
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: { url: { type: 'string' }, name: { type: 'string' }, 'jwks-uri': { type: 'string' }, 'redirect-uri': { type: 'string', multiple: true }, 'client-id': { type: 'string' } },
    strict: true,
  });
  if (!deps.token) {
    deps.err('MUTABA3A_ADMIN_TOKEN is not set');
    return 2;
  }
  const base = (values.url ?? deps.url).replace(/\/$/, '');
  const headers = { 'content-type': 'application/json', 'x-admin-token': deps.token };
  let res: Response;
  if (command === 'register') {
    if (!values.name || !values['jwks-uri'] || !values['redirect-uri']?.length) {
      deps.err('register needs --name, --jwks-uri and at least one --redirect-uri');
      return 2;
    }
    res = await deps.fetch(`${base}/admin/v1/oauth/confidential-clients`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: values.name, jwksUri: values['jwks-uri'], redirectUris: values['redirect-uri'] }),
    });
  } else if (command === 'disable') {
    if (!values['client-id']) {
      deps.err('disable needs --client-id');
      return 2;
    }
    res = await deps.fetch(`${base}/admin/v1/oauth/confidential-clients/${encodeURIComponent(values['client-id'])}/disable`, { method: 'POST', headers });
  } else {
    deps.err('Usage: oauth:client -- register|disable [options]');
    return 2;
  }
  const body = await res.text();
  (res.ok ? deps.out : deps.err)(body);
  return res.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const code = await runOAuthClientCli(process.argv.slice(2), {
    fetch,
    url: process.env.MUTABA3A_URL ?? 'http://localhost:8787',
    token: process.env.MUTABA3A_ADMIN_TOKEN,
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  });
  process.exit(code);
}
