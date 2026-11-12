import { randomUUID } from 'node:crypto';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

type CryptoKeyLike = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
import { expect } from 'vitest';
import { SCOPES } from '../../auth/scopes.js';
import { s256Challenge } from '../../oauth/protocol.js';
import { ADMIN, form, harness, json, ORIGIN, person, read, VERIFIER, type Person } from './oauth-agent.js';

/**
 * MUT-593 (ADR-254): a test app with MALAFAT_DELEGATION on, Malafat registered as a confidential client whose key
 * pair lives here, a Malafat-fed firm (bound with its organization key, the operator's switch on), and helpers that
 * connect a person the way Malafat will: authorize for `/v1` naming the tenant, consent, then exchange with a signed
 * client assertion.
 */

export const MALAFAT_CB = 'https://office.malafat.app/mtb3a/callback';
export const V1 = `${ORIGIN}/v1`;
export const TOKEN_ENDPOINT = `${ORIGIN}/oauth/token`;
export const ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

let seq = 0;

export async function signingKey(kid = 'k1') {
  const pair = await generateKeyPair('ES256', { extractable: true });
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid, alg: 'ES256', use: 'sig' };
  return { privateKey: pair.privateKey, jwk };
}

export async function delegatedHarness(options: { malafatDelegation?: boolean; periodDownloads?: boolean; accountantAccess?: boolean } = {}) {
  const key = await signingKey();
  const published: JWK[] = [key.jwk];
  const h = harness({
    malafatDelegation: options.malafatDelegation ?? true,
    keysFor: () => createLocalJWKSet({ keys: published }),
    ...(options.periodDownloads ? { periodDownloads: true } : {}),
    ...(options.accountantAccess ? { accountantAccess: true } : {}),
  });
  const res = await h.app.request('/admin/v1/oauth/confidential-clients', json({ name: 'Malafat', redirectUris: [MALAFAT_CB], jwksUri: 'https://office.malafat.app/.well-known/mtb3a-jwks.json' }, ADMIN));
  expect(res.status).toBe(201);
  const clientId = (await read(res)).clientId as string;
  /** Rotates Malafat's key: publishes `next` alone, as a JWKS change would. */
  const rotate = (next: JWK) => void published.splice(0, published.length, next);
  return { ...h, clientId, privateKey: key.privateKey, rotate };
}
export type DelegatedHarness = Awaited<ReturnType<typeof delegatedHarness>>;

/** A client assertion signed with `privateKey` (Malafat's by default), fresh id each time. */
export async function assertion(h: DelegatedHarness, overrides: { privateKey?: CryptoKeyLike; iss?: string; aud?: string; jti?: string } = {}) {
  const now = Math.floor(h.now().getTime() / 1000);
  return new SignJWT({ iss: overrides.iss ?? h.clientId, sub: overrides.iss ?? h.clientId, aud: overrides.aud ?? TOKEN_ENDPOINT, jti: overrides.jti ?? randomUUID(), iat: now, exp: now + 120 })
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
    .sign(overrides.privateKey ?? h.privateKey);
}

/** A firm Malafat feeds: created by the operator, bound to `tenant` with its organization key, the per-firm switch on. */
export async function malafatFirm(h: DelegatedHarness, { enabled = true } = {}) {
  const tenant = `tenant-${++seq}`;
  const orgRes = await h.app.request('/admin/v1/organizations', json({ name: `Sader Law Office ${seq}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, ADMIN));
  expect(orgRes.status).toBe(201);
  const organizationId = (await read(orgRes)).id as string;
  const keyRes = await h.app.request(`/admin/v1/organizations/${organizationId}/api-keys`, json({ name: 'Malafat', scopes: SCOPES }, ADMIN));
  expect(keyRes.status).toBe(201);
  const orgKey = (await read(keyRes)).secret as string;
  const bind = await h.app.request('/v1/integration/bind', json({ provider: 'MALAFAT', externalTenantId: tenant, displayName: `Sader Law Office ${seq}` }, { authorization: `Bearer ${orgKey}`, 'idempotency-key': `bind-${tenant}-0001` }));
  expect(bind.status).toBe(201);
  const integration = await h.store.integrations.findByProviderAndTenant('MALAFAT', tenant);
  if (enabled) await h.store.integrations.setDelegation({ id: integration!.id, enabled: true, by: null, at: h.now(), audit: [] });
  return { organizationId, tenant, orgKey, integrationId: integration!.id };
}
export type MalafatFirm = Awaited<ReturnType<typeof malafatFirm>>;

/** A person who is a member of `firm` (as Malafat's member sync will make them, MUT-594). */
export async function lawyer(h: DelegatedHarness, firm: MalafatFirm) {
  const p = await person(h, { flag: false });
  await h.store.memberships.grant(p.userId, firm.organizationId, h.now());
  return p;
}

export function authorizeDelegated(h: DelegatedHarness, tenant: string, extra: Record<string, string> = {}) {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: h.clientId,
    redirect_uri: MALAFAT_CB,
    code_challenge: s256Challenge(VERIFIER),
    code_challenge_method: 'S256',
    state: 'st-m',
    resource: V1,
    malafat_tenant: tenant,
    ...extra,
  });
  return h.app.request(`/oauth/authorize?${query.toString()}`);
}

/** The person approves on MTB3A's consent page; Malafat exchanges the code with a signed assertion. */
export async function connectDelegated(h: DelegatedHarness, p: Person, firm: MalafatFirm) {
  const started = await authorizeDelegated(h, firm.tenant);
  expect(started.status).toBe(302);
  const requestId = new URL(started.headers.get('location') ?? '', ORIGIN).searchParams.get('request') ?? '';
  const decided = await h.app.request(`/v1/oauth/requests/${requestId}/decision`, json({ decision: 'approve' }, p.cookie));
  expect(decided.status).toBe(200);
  const code = new URL((await read(decided)).redirectTo).searchParams.get('code') ?? '';
  const res = await h.app.request('/oauth/token', form({ grant_type: 'authorization_code', client_id: h.clientId, code, code_verifier: VERIFIER, redirect_uri: MALAFAT_CB, resource: V1, client_assertion_type: ASSERTION_TYPE, client_assertion: await assertion(h) }));
  expect(res.status).toBe(200);
  const tokens = (await read(res)) as { access_token: string; refresh_token: string };
  return { ...tokens, headers: (profileId: string = firm.organizationId) => ({ authorization: `Bearer ${tokens.access_token}`, 'x-mutaba3a-profile': profileId }) };
}
export type DelegatedConnection = Awaited<ReturnType<typeof connectDelegated>>;

export async function refreshDelegated(h: DelegatedHarness, refreshToken: string) {
  return h.app.request('/oauth/token', form({ grant_type: 'refresh_token', client_id: h.clientId, refresh_token: refreshToken, client_assertion_type: ASSERTION_TYPE, client_assertion: await assertion(h) }));
}

/** POST /v1/expenses as the caller: the opted-in write every test uses. */
export function addExpense(h: DelegatedHarness, headers: Record<string, string>, note = 'Court fees') {
  return h.app.request('/v1/expenses', json({ occurredOn: '2026-10-20', amount: '125.00', currency: 'ILS', vendor: note }, { ...headers, 'idempotency-key': `exp-${randomUUID()}` }));
}
