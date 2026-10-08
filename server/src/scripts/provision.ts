import { parseArgs } from 'node:util';
import { SCOPES } from '../auth/scopes.js';

/**
 * Operator CLI: create an organization and issue its first API key through
 * the admin API of a running service. Prints the secret once.
 *
 *   npm run provision -- --url https://api.mutaba3a.app --name "Sader Law Firm" \
 *       --currency ILS --timezone Asia/Jerusalem --key-name "Malafat"
 *
 * MUTABA3A_ADMIN_TOKEN is read from the environment, never from a flag, so it
 * does not land in shell history.
 */
const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:8787' },
    name: { type: 'string' },
    slug: { type: 'string' },
    currency: { type: 'string', default: 'ILS' },
    timezone: { type: 'string', default: 'Asia/Jerusalem' },
    'key-name': { type: 'string', default: 'Malafat' },
    scopes: { type: 'string', default: SCOPES.join(',') },
    'organization-id': { type: 'string' },
  },
});

const token = process.env.MUTABA3A_ADMIN_TOKEN;
if (!token) {
  console.error('MUTABA3A_ADMIN_TOKEN is not set');
  process.exit(1);
}

const headers = { 'content-type': 'application/json', 'x-admin-token': token };

async function call<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${values.url}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const json = (await res.json()) as T & { error?: { code: string; message: string } };
  if (!res.ok) {
    console.error(`${path} → ${res.status} ${json.error?.code}: ${json.error?.message}`);
    process.exit(1);
  }
  return json;
}

let organizationId = values['organization-id'];
if (!organizationId) {
  if (!values.name) {
    console.error('--name is required when --organization-id is not given');
    process.exit(1);
  }
  const org = await call<{ id: string; slug: string }>('/admin/v1/organizations', {
    name: values.name,
    ...(values.slug ? { slug: values.slug } : {}),
    defaultCurrency: values.currency,
    timezone: values.timezone,
  });
  organizationId = org.id;
  console.log(`organization ${org.slug} = ${org.id}`);
}

const key = await call<{ secret: string; apiKey: { id: string; masked: string; scopes: string[] } }>(
  `/admin/v1/organizations/${organizationId}/api-keys`,
  { name: values['key-name'], scopes: values.scopes.split(',').map((s) => s.trim()) },
);

console.log(`api key ${key.apiKey.id} (${key.apiKey.masked})`);
console.log(`scopes: ${key.apiKey.scopes.join(' ')}`);
console.log('');
console.log('Secret — shown once, hand it to the Partner over a secure channel:');
console.log(key.secret);
