#!/usr/bin/env node
/**
 * MUT-596 / MUT-597 QA: makes a local MTB3A API know the stub office's people (malafat-people.mjs), through the API
 * the way production gets there, never the database:
 *
 *   1. the firm: the operator creates it, its organization key binds it to the stub's tenant (MUT-594), and the
 *      member sync lists all three people as seats;
 *   2. `existing`: an MTB3A account with a password (EXISTING_PASSWORD), never connected to Malafat;
 *   3. `linked`: signed in with Malafat once, headlessly (start → stub authorize → callback → exchange → consent),
 *      which creates the account and claims the seat.
 * `new` is left as a seat only: their first Sign in with Malafat creates the account.
 *   4. Connected apps (MUT-593): the stub registered as Malafat's confidential client, the firm's delegation switch
 *      on, and `linked`'s live delegated grant (authorize → approve as rana → token with the stub's signed
 *      assertion). Skipped, with a note, when the API runs without MALAFAT_DELEGATION.
 *
 *   node qa/stubs/malafat-seed.mjs [--api http://localhost:8791] [--portal <portal origin>] [--admin-token …]
 *
 * The stub (malafat-oauth.mjs) must be running and the API started with MALAFAT_SIGN_IN=true and
 * MALAFAT_ORIGIN_TEMPLATE=http://{slug}.lvh.me:3939; for step 4 also MALAFAT_DELEGATION=true,
 * OAUTH_CLIENT_LOCAL_HTTP=true and OAUTH_DERIVE_KEY. `--portal` is the API's PORTAL_ORIGIN (default: the API's). Run once per fresh database: a second run finds the tenant
 * bound and stops.
 */
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { EXISTING_PASSWORD, OFFICE, PEOPLE, TENANT_SLUG } from './malafat-people.mjs';

const { values } = parseArgs({
  options: {
    api: { type: 'string', default: process.env.MALAFAT_SEED_API ?? 'http://localhost:8791' },
    portal: { type: 'string' },
    'admin-token': { type: 'string', default: process.env.MUTABA3A_ADMIN_TOKEN ?? 'qa-portal-selfservice-admin-token-0123456789' },
  },
});
const API = values.api.replace(/\/$/, '');
const ADMIN = { 'x-admin-token': values['admin-token'] };
/** PORTAL_ORIGIN: web sign-ins must come from it, and it is the OAuth issuer (resource `/v1`, token audience). */
const PORTAL_ORIGIN = (values.portal ?? API).replace(/\/$/, '');
const PORTAL = { origin: PORTAL_ORIGIN };
const STUB = `http://${TENANT_SLUG}.lvh.me:${process.env.MALAFAT_STUB_PORT ?? 3939}`;
const CURRENCY = 'ILS';
const TIMEZONE = 'Asia/Jerusalem';

async function call(method, path, { body, headers = {}, expect = [200, 201] } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    redirect: 'manual',
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!expect.includes(res.status)) throw Object.assign(new Error(`${method} ${path}: ${res.status} ${text}`), { status: res.status, json });
  return { res, json };
}

/** A redirect hop, manual so each Location can be checked; the stub hop names who it signs in as. */
async function hop(url, headers = {}) {
  const res = await fetch(url, { redirect: 'manual', headers });
  const location = res.headers.get('location');
  if (res.status !== 302 || !location) throw new Error(`${url}: expected a redirect, got ${res.status} ${await res.text()}`);
  return new URL(location, url).toString();
}

async function firm() {
  const org = await call('POST', '/admin/v1/organizations', { headers: ADMIN, body: { name: OFFICE.tenant_name, defaultCurrency: CURRENCY, timezone: TIMEZONE } });
  const organizationId = org.json.id;
  const key = await call('POST', `/admin/v1/organizations/${organizationId}/api-keys`, { headers: ADMIN, body: { name: 'Malafat (QA stub)', scopes: ['integration:write'] } });
  const auth = { authorization: `Bearer ${key.json.secret}` };
  try {
    await call('POST', '/v1/integration/bind', { headers: { ...auth, 'idempotency-key': `qa-bind-${OFFICE.tenant_id}` }, body: { provider: 'MALAFAT', externalTenantId: OFFICE.tenant_id, displayName: OFFICE.tenant_name } });
  } catch (error) {
    if (error.status === 409) {
      console.log(`[malafat-seed] ${OFFICE.tenant_id} is already bound: this database is seeded`);
      process.exit(0);
    }
    throw error;
  }
  const members = Object.values(PEOPLE).map(({ sub, email, role }) => ({ subject: sub, email, role }));
  await call('PUT', '/v1/integration/members', { headers: { ...auth, 'idempotency-key': `qa-members-${Date.now()}` }, body: { members } });
  return organizationId;
}

async function existingAccount() {
  const person = PEOPLE.existing;
  const created = await call('POST', '/admin/v1/users', { headers: ADMIN, body: { email: person.email, displayName: person.name, defaultCurrency: CURRENCY, timezone: TIMEZONE, locale: person.locale } });
  const token = new URL(created.json.setupLink.url).hash.slice(1);
  const check = await call('POST', '/v1/account-setup/check', { headers: PORTAL, body: { token } });
  await call('POST', '/v1/account-setup', { headers: PORTAL, body: { token, password: EXISTING_PASSWORD, acceptedTermsVersion: check.json.termsVersion } });
}

async function linkedAccount() {
  const toStub = await hop(`${API}/v1/auth/malafat/start?tenant=${TENANT_SLUG}&client=web`);
  const toCallback = await hop(toStub, { 'x-qa-person': 'linked' });
  const back = await hop(toCallback);
  const result = new URLSearchParams(new URL(back).hash.slice(1)).get('result');
  if (!result) throw new Error(`the callback returned no result: ${back}`);
  const exchanged = await call('POST', '/v1/auth/malafat/exchange', { headers: PORTAL, body: { result } });
  if (exchanged.json.state !== 'needs_consent') throw new Error(`expected needs_consent for a new account, got ${exchanged.json.state}`);
  const consent = await call('POST', '/v1/auth/malafat/consent', { headers: PORTAL, body: { ticket: exchanged.json.ticket, defaultCurrency: CURRENCY, timezone: TIMEZONE } });
  return sessionCookieOf(consent.res);
}

/** The portal session the sign-in set, as a Cookie header. */
function sessionCookieOf(res) {
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('the sign-in set no session cookie');
  return cookie;
}

async function connectedApp(organizationId, cookie) {
  const redirect = `${STUB}/mtb3a/callback`;
  let client;
  try {
    client = await call('POST', '/admin/v1/oauth/confidential-clients', { headers: ADMIN, body: { name: 'Malafat', redirectUris: [redirect], jwksUri: `${STUB}/.well-known/mtb3a-jwks.json` } });
  } catch (error) {
    if (error.status === 404 || error.status === 503 || error.status === 422) {
      console.log(`[malafat-seed] no Connected apps row: the API needs MALAFAT_DELEGATION=true, OAUTH_CLIENT_LOCAL_HTTP=true and OAUTH_DERIVE_KEY (${error.message})`);
      return false;
    }
    throw error;
  }
  const clientId = client.json.clientId;
  await call('POST', `/admin/v1/organizations/${organizationId}/malafat-delegation`, { headers: ADMIN, body: { enabled: true } });
  const verifier = 'qa-malafat-delegated-verifier-0123456789-abcdefgh';
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const resource = `${PORTAL_ORIGIN}/v1`;
  const query = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state: 'qa-seed', resource, malafat_tenant: OFFICE.tenant_id });
  const toConsent = await hop(`${API}/oauth/authorize?${query}`, { cookie });
  const requestId = new URL(toConsent).searchParams.get('request');
  if (!requestId) throw new Error(`authorize did not ask for consent: ${toConsent}`);
  const decided = await call('POST', `/v1/oauth/requests/${requestId}/decision`, { headers: { ...PORTAL, cookie }, body: { decision: 'approve' } });
  const code = new URL(decided.json.redirectTo).searchParams.get('code');
  const aud = `${PORTAL_ORIGIN}/oauth/token`;
  const signed = await fetch(`${STUB}/__qa/assertion`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId, aud }) }).then((r) => r.json());
  const token = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: redirect, resource, client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: signed.assertion }),
  });
  if (!token.ok) throw new Error(`token: ${token.status} ${await token.text()}`);
  return true;
}

const organizationId = await firm();
await existingAccount();
const cookie = await linkedAccount();
const connected = await connectedApp(organizationId, cookie);
console.log(`[malafat-seed] firm ${organizationId} (${OFFICE.tenant_id}); existing: ${PEOPLE.existing.email} / "${EXISTING_PASSWORD}"; linked: ${PEOPLE.linked.email}${connected ? ' (Malafat in Connected apps)' : ''}; new: ${PEOPLE.new.email} (seat only)`);
