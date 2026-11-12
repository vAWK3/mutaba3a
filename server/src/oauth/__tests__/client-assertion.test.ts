import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

type CryptoKeyLike = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
import { describe, expect, it } from 'vitest';
import type { OAuthClientRecord } from '../../repositories/ports.js';
import { ASSERTION_MAX_LIFETIME_S, verifyClientAssertion } from '../client-assertion.js';

const T0 = new Date('2026-11-12T09:00:00Z');
const TOKEN_ENDPOINT = 'https://app.mtb3a.com/oauth/token';
const ISSUER = 'https://app.mtb3a.com';
const CLIENT_ID = 'mcc_malafat';

const client: OAuthClientRecord = {
  id: CLIENT_ID,
  kind: 'CONFIDENTIAL',
  clientName: 'Malafat',
  redirectUris: ['https://office.malafat.app/mtb3a/callback'],
  createdAt: T0,
  lastUsedAt: null,
  metadataExpiresAt: null,
  jwksUri: 'https://office.malafat.app/.well-known/jwks.json',
  allowedResources: [`${ISSUER}/v1`],
  disabledAt: null,
};

async function keys(alg: 'ES256' | 'RS256' = 'ES256', kid = 'k1') {
  const pair = await generateKeyPair(alg, { extractable: true });
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid, alg, use: 'sig' };
  return { privateKey: pair.privateKey, jwk };
}

type Claims = { iss?: string; sub?: string; aud?: string | string[]; jti?: string | null; exp?: number; iat?: number };

async function assertion(privateKey: CryptoKeyLike, { alg = 'ES256', kid = 'k1', claims = {} }: { alg?: string; kid?: string; claims?: Claims } = {}) {
  const now = Math.floor(T0.getTime() / 1000);
  const body = { iss: CLIENT_ID, sub: CLIENT_ID, aud: TOKEN_ENDPOINT, jti: 'jti-1', iat: now, exp: now + 120, ...claims };
  const payload: Record<string, unknown> = { ...body };
  if (body.jti === null) delete payload.jti;
  return new SignJWT(payload).setProtectedHeader({ alg, kid }).sign(privateKey);
}

function verifier(jwks: JWK[], used = new Set<string>()) {
  return (presented: string, at = T0) =>
    verifyClientAssertion({
      assertion: presented,
      client,
      audiences: [TOKEN_ENDPOINT, ISSUER],
      now: at,
      keys: createLocalJWKSet({ keys: jwks }),
      claimJti: async (jti) => (used.has(jti) ? false : (used.add(jti), true)),
    });
}

describe('verifyClientAssertion (MUT-593, RFC 7523)', () => {
  it('accepts an ES256 and an RS256 assertion signed by a published key', async () => {
    const es = await keys('ES256', 'es');
    const rs = await keys('RS256', 'rs');
    const verify = verifier([es.jwk, rs.jwk]);
    expect(await verify(await assertion(es.privateKey, { kid: 'es' }))).toEqual({ ok: true });
    expect(await verify(await assertion(rs.privateKey, { alg: 'RS256', kid: 'rs', claims: { jti: 'jti-2' } }))).toEqual({ ok: true });
  });

  it('accepts the issuer as the audience', async () => {
    const k = await keys();
    expect(await verifier([k.jwk])(await assertion(k.privateKey, { claims: { aud: ISSUER } }))).toEqual({ ok: true });
  });

  it('refuses a key the client does not publish', async () => {
    const published = await keys();
    const other = await keys();
    expect(await verifier([published.jwk])(await assertion(other.privateKey))).toEqual({ ok: false, reason: 'signature' });
  });

  it.each([
    ['another issuer', { iss: 'mcc_other' }, 'claims'],
    ['another subject', { sub: 'mcc_other' }, 'claims'],
    ['another audience', { aud: 'https://evil.example/token' }, 'claims'],
    ['no assertion id', { jti: null }, 'claims'],
  ] as const)('refuses %s', async (_name, claims, reason) => {
    const k = await keys();
    expect(await verifier([k.jwk])(await assertion(k.privateKey, { claims }))).toEqual({ ok: false, reason });
  });

  it('refuses an expired assertion and one that lives too long', async () => {
    const k = await keys();
    const now = Math.floor(T0.getTime() / 1000);
    expect(await verifier([k.jwk])(await assertion(k.privateKey, { claims: { iat: now - 600, exp: now - 120 } }))).toEqual({ ok: false, reason: 'signature' });
    expect(await verifier([k.jwk])(await assertion(k.privateKey, { claims: { exp: now + ASSERTION_MAX_LIFETIME_S + 3600 } }))).toEqual({ ok: false, reason: 'claims' });
  });

  it('refuses a replayed assertion id', async () => {
    const k = await keys();
    const verify = verifier([k.jwk]);
    const presented = await assertion(k.privateKey);
    expect(await verify(presented)).toEqual({ ok: true });
    expect(await verify(presented)).toEqual({ ok: false, reason: 'replay' });
  });

  it('refuses an HMAC or unsigned assertion, whatever it claims', async () => {
    const k = await keys();
    const hs = await new SignJWT({ iss: CLIENT_ID, sub: CLIENT_ID, aud: TOKEN_ENDPOINT, jti: 'h' }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('2m').sign(new TextEncoder().encode('a-shared-secret-of-at-least-32-bytes!'));
    const none = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(JSON.stringify({ iss: CLIENT_ID, sub: CLIENT_ID, aud: TOKEN_ENDPOINT, jti: 'n', exp: 9_999_999_999 })).toString('base64url')}.`;
    expect(await verifier([k.jwk])(hs)).toEqual({ ok: false, reason: 'signature' });
    expect(await verifier([k.jwk])(none)).toEqual({ ok: false, reason: 'signature' });
  });

  it('refuses an organization API key presented as an assertion', async () => {
    const k = await keys();
    expect(await verifier([k.jwk])('mak_test_0123456789abcdef0123456789abcdef')).toEqual({ ok: false, reason: 'signature' });
  });
});
