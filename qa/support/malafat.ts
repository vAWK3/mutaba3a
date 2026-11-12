import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import { liveState } from './selfService';

/**
 * MUT-596: Sign in with Malafat on the portal-selfservice env, against the stub office (qa/stubs/malafat-oauth.mjs,
 * started by selfservice-live.mjs at http://sader.lvh.me:3939). Every spec makes its own people: a seat in the one
 * firm bound to the stub's tenant, with the Malafat role it needs, and the stub signs in as them (its `qa_person`
 * cookie holds their claims). The firm and its key live in a state file next to the env's, per database, so specs
 * share the firm without sharing people.
 */

export type MalafatRole = 'PARTNER' | 'OFFICE_ADMIN' | 'ASSOCIATE' | 'INTERN';
export interface MalafatPerson {
  sub: string;
  email: string;
  name: string;
  role: MalafatRole;
  locale: 'en' | 'ar';
}

/** selfservice-live.mjs's stub; MALAFAT_STUB_PORT when the run moved it off 3939. */
export const STUB = `http://sader.lvh.me:${process.env.MALAFAT_STUB_PORT ?? 3939}`;
export const OFFICE = { slug: 'sader', tenantId: 'tenant-sader', name: 'Sader Law Office' };

const STATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.state', 'malafat-firm.json');
interface FirmState {
  database: string;
  organizationId: string;
  orgKey: string;
  seats: Array<{ subject: string; email: string; role: MalafatRole }>;
  clientId?: string;
}

const admin = () => ({ 'x-admin-token': liveState().adminToken, 'content-type': 'application/json' });

async function call(method: string, url: string, headers: Record<string, string>, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  expect(res.ok, `${method} ${url}: ${res.status} ${text}`).toBe(true);
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function readState(): FirmState | null {
  try {
    const state = JSON.parse(fs.readFileSync(STATE, 'utf8')) as FirmState;
    return state.database === (liveState() as { database?: string }).database ? state : null;
  } catch {
    return null;
  }
}

const writeState = (state: FirmState) => fs.writeFileSync(STATE, JSON.stringify(state, null, 2));

/** The firm bound to the stub's tenant (created once per env database), Malafat's members synced from its seats. */
async function firm(): Promise<FirmState> {
  const known = readState();
  if (known) return known;
  const { origin } = liveState();
  const org = await call('POST', `${origin}/admin/v1/organizations`, admin(), { name: OFFICE.name, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
  const organizationId = org.id as string;
  const key = await call('POST', `${origin}/admin/v1/organizations/${organizationId}/api-keys`, admin(), { name: 'Malafat (QA stub)', scopes: ['integration:write'] });
  const orgKey = key.secret as string;
  await call('POST', `${origin}/v1/integration/bind`, { authorization: `Bearer ${orgKey}`, 'content-type': 'application/json', 'idempotency-key': `qa-bind-${randomUUID()}` }, { provider: 'MALAFAT', externalTenantId: OFFICE.tenantId, displayName: OFFICE.name });
  const state: FirmState = { database: (liveState() as { database?: string }).database ?? '', organizationId, orgKey, seats: [] };
  writeState(state);
  return state;
}

/** A new person in the firm with `role` (a seat Malafat's member sync lists), whom the stub can sign in as. */
export async function malafatSeat(role: MalafatRole, label: string, locale: 'en' | 'ar' = 'en'): Promise<MalafatPerson & { organizationId: string }> {
  const state = await firm();
  const tag = `${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const person: MalafatPerson = { sub: `qa-${tag}`, email: `qa-${tag}@sader.law`, name: `${label[0]!.toUpperCase()}${label.slice(1)} Haddad`, role, locale };
  state.seats.push({ subject: person.sub, email: person.email, role });
  await call('PUT', `${liveState().origin}/v1/integration/members`, { authorization: `Bearer ${state.orgKey}`, 'content-type': 'application/json', 'idempotency-key': `qa-members-${randomUUID()}` }, { members: state.seats });
  writeState(state);
  return { ...person, organizationId: state.organizationId };
}

/** The stub signs this page in as `person` (its `qa_person` cookie, per browser context); `deny` answers access_denied. */
export async function malafatAs(page: Page, person: MalafatPerson, options: { deny?: boolean } = {}): Promise<void> {
  const cookies = [{ name: 'qa_person', value: encodeURIComponent(JSON.stringify(person)), domain: 'sader.lvh.me', path: '/' }];
  if (options.deny) cookies.push({ name: 'qa_deny', value: '1', domain: 'sader.lvh.me', path: '/' });
  await page.context().addCookies(cookies);
}

/** Sign-in › Sign in with Malafat › the office address › Continue: the browser goes to the stub and comes back. */
export async function startMalafatSignIn(page: Page): Promise<void> {
  await page.goto('/sign-in');
  await page.getByRole('link', { name: 'Sign in with Malafat' }).click();
  await page.getByLabel('Your Malafat office address').fill(OFFICE.slug);
  await page.getByRole('button', { name: 'Continue to Malafat' }).click();
}

/**
 * Malafat's own connection for `person` (MUT-593), as Malafat makes it: the stub registered once as the confidential
 * client, the firm's delegation switch on, the person approving on MTB3A's consent (with their session), the code
 * exchanged with the stub's signed assertion. Connected apps then lists it.
 */
export async function connectMalafat(page: Page): Promise<void> {
  const state = await firm();
  const { origin } = liveState();
  const redirect = `${STUB}/mtb3a/callback`;
  if (!state.clientId) {
    const client = await call('POST', `${origin}/admin/v1/oauth/confidential-clients`, admin(), { name: 'Malafat', redirectUris: [redirect], jwksUri: `${STUB}/.well-known/mtb3a-jwks.json` });
    state.clientId = client.clientId as string;
    writeState(state);
  }
  await call('POST', `${origin}/admin/v1/organizations/${state.organizationId}/malafat-delegation`, admin(), { enabled: true });
  const verifier = `qa-malafat-${randomUUID()}-${randomUUID()}`;
  const resource = `${origin}/v1`;
  const query = new URLSearchParams({ response_type: 'code', client_id: state.clientId, redirect_uri: redirect, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', state: 'qa', resource, malafat_tenant: OFFICE.tenantId });
  // The page's own session: the authorize and the consent decision are the person's.
  const authorize = await page.request.get(`/oauth/authorize?${query}`, { maxRedirects: 0 });
  const requestId = new URL(authorize.headers().location ?? '', origin).searchParams.get('request');
  expect(requestId, `authorize: ${authorize.status()} ${authorize.headers().location}`).toBeTruthy();
  const decided = await page.request.post(`/v1/oauth/requests/${requestId}/decision`, { data: { decision: 'approve' }, headers: { origin } });
  expect(decided.ok(), `decision ${decided.status()}`).toBe(true);
  const code = new URL(((await decided.json()) as { redirectTo: string }).redirectTo).searchParams.get('code') ?? '';
  const { assertion } = (await call('POST', `${STUB}/__qa/assertion`, { 'content-type': 'application/json' }, { clientId: state.clientId, aud: `${origin}/oauth/token` })) as { assertion: string };
  const token = await fetch(`${origin}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: state.clientId, code, code_verifier: verifier, redirect_uri: redirect, resource, client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', client_assertion: assertion }),
  });
  expect(token.ok, `token ${token.status} ${await token.clone().text()}`).toBe(true);
}
