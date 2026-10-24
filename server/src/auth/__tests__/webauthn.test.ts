import { describe, expect, it } from 'vitest';
import { SoftAuthenticator } from '../../__tests__/helpers/soft-authenticator.js';
import { deviceLabel, PASSKEY_PROVIDERS, passkeyNameFor, providerName } from '../passkey-names.js';
import { creationOptions, signInOptions, verifyAssertion, verifyCreation, webauthnConfigOf, type WebauthnConfig } from '../webauthn.js';

const config: WebauthnConfig = webauthnConfigOf({ rpId: 'mtb3a.com', portalOrigin: 'https://app.mtb3a.com' })!;
const user = { id: '7f1c2a8e-58a4-4a52-9b3c-0d6c1b1d2e3f', email: 'nour@firm.ps', displayName: 'Nour' };
const PORTAL = 'https://app.mtb3a.com';
const APP = 'https://mtb3a.com';

async function enrolled(origin = PORTAL, auth = new SoftAuthenticator()) {
  const options = await creationOptions(config, user, []);
  const created = await verifyCreation(config, auth.create(options, origin), options.challenge);
  if (!created) throw new Error('creation did not verify');
  return { auth, passkey: { userId: user.id, credentialId: created.credentialId, publicKey: created.publicKey, signCount: created.signCount, transports: created.transports } };
}

describe('webauthnConfigOf (MUT-115 D2)', () => {
  it('is off without an RP ID', () => {
    expect(webauthnConfigOf({})).toBeNull();
    expect(() => webauthnConfigOf({ origins: 'https://mtb3a.com' })).toThrow(/needs WEBAUTHN_RP_ID/);
  });

  it('derives the portal origin and the apex (the iOS app) by default', () => {
    expect(config).toEqual({ rpId: 'mtb3a.com', rpName: 'MTB3A', origins: ['https://app.mtb3a.com', 'https://mtb3a.com'] });
    expect(webauthnConfigOf({ rpId: 'mtb3a.com' })?.origins).toEqual(['https://mtb3a.com']);
  });

  it('takes an explicit list for local development', () => {
    expect(webauthnConfigOf({ rpId: 'localhost', origins: 'http://localhost:5173, https://localhost' })?.origins).toEqual(['http://localhost:5173', 'https://localhost']);
  });

  it('refuses an origin outside the RP ID, plain http off localhost, a path, and a bad host', () => {
    expect(() => webauthnConfigOf({ rpId: 'mtb3a.com', portalOrigin: 'https://mutaba3a-api.run.app' })).toThrow(/not mtb3a.com or a subdomain/);
    expect(() => webauthnConfigOf({ rpId: 'mtb3a.com', origins: 'https://evilmtb3a.com' })).toThrow(/not mtb3a.com/);
    expect(() => webauthnConfigOf({ rpId: 'mtb3a.com', origins: 'http://app.mtb3a.com' })).toThrow(/https/);
    expect(() => webauthnConfigOf({ rpId: 'mtb3a.com', origins: 'https://app.mtb3a.com/portal' })).toThrow(/bare origin/);
    expect(() => webauthnConfigOf({ rpId: 'https://mtb3a.com' })).toThrow(/not a host name/);
  });
});

describe('creation and assertion (MUT-115)', () => {
  it('creation options ask for a discoverable, user-verified credential and exclude existing ones', async () => {
    const options = await creationOptions(config, user, [{ credentialId: 'abc', transports: ['internal'] }]);
    expect(options).toMatchObject({ rp: { id: 'mtb3a.com', name: 'MTB3A' }, attestation: 'none', authenticatorSelection: { residentKey: 'required', userVerification: 'required' } });
    expect(options.excludeCredentials).toEqual([{ id: 'abc', type: 'public-key', transports: ['internal'] }]);
    expect(options.pubKeyCredParams.map((p) => p.alg)).toEqual([-7, -257]);
  });

  it('verifies a creation and keeps its AAGUID, backup state and key', async () => {
    const options = await creationOptions(config, user, []);
    const created = await verifyCreation(config, new SoftAuthenticator().create(options, PORTAL), options.challenge);
    expect(created).toMatchObject({ signCount: 0, deviceType: 'multiDevice', backedUp: true, aaguid: 'fbfc3007-154e-4ecc-8c0b-6e020557d7bd' });
  });

  it('refuses a creation with the wrong challenge, origin or RP ID, or without user verification', async () => {
    const options = await creationOptions(config, user, []);
    const auth = new SoftAuthenticator();
    expect(await verifyCreation(config, auth.create(options, PORTAL), 'another-challenge')).toBeNull();
    expect(await verifyCreation(config, auth.create(options, 'https://evil.example'), options.challenge)).toBeNull();
    expect(await verifyCreation(config, auth.create(options, PORTAL, { rpId: 'evil.example' }), options.challenge)).toBeNull();
    expect(await verifyCreation(config, auth.create(options, PORTAL, { userVerified: false }), options.challenge)).toBeNull();
  });

  it('a passkey made on the portal asserts from the app, and the other way round (A1)', async () => {
    for (const [made, used] of [
      [PORTAL, APP],
      [APP, PORTAL],
    ] as const) {
      const { auth, passkey } = await enrolled(made);
      const options = await signInOptions(config);
      expect(options.allowCredentials).toEqual([]);
      expect(await verifyAssertion(config, auth.assert(options, used), options.challenge, passkey)).toEqual({ kind: 'verified', signCount: 0 });
    }
  });

  it('refuses an assertion with the wrong challenge, origin, RP ID, user handle, or no user verification', async () => {
    const { auth, passkey } = await enrolled();
    const options = await signInOptions(config);
    expect(await verifyAssertion(config, auth.assert(options, PORTAL), 'other', passkey)).toEqual({ kind: 'refused' });
    expect(await verifyAssertion(config, auth.assert(options, 'https://evil.example'), options.challenge, passkey)).toEqual({ kind: 'refused' });
    expect(await verifyAssertion(config, auth.assert(options, PORTAL, { rpId: 'evil.example' }), options.challenge, passkey)).toEqual({ kind: 'refused' });
    expect(await verifyAssertion(config, auth.assert(options, PORTAL, { userHandle: 'c29tZW9uZS1lbHNl' }), options.challenge, passkey)).toEqual({ kind: 'refused' });
    expect(await verifyAssertion(config, auth.assert(options, PORTAL, { userVerified: false }), options.challenge, passkey)).toEqual({ kind: 'refused' });
  });

  it('reports a counter that went backwards only when the signature is genuine', async () => {
    const { auth, passkey } = await enrolled(PORTAL, new SoftAuthenticator({ counts: true }));
    const options = await signInOptions(config);
    const first = await verifyAssertion(config, auth.assert(options, PORTAL), options.challenge, passkey);
    expect(first).toEqual({ kind: 'verified', signCount: 2 });
    const stored = { ...passkey, signCount: 2 };
    expect(await verifyAssertion(config, auth.assert(options, PORTAL, { counter: 2 }), options.challenge, stored)).toEqual({ kind: 'counter-regressed' });
    const forged = auth.assert(options, PORTAL, { counter: 1 });
    forged.response.signature = forged.response.signature.slice(0, -4) + 'AAAA';
    expect(await verifyAssertion(config, forged, options.challenge, stored)).toEqual({ kind: 'refused' });
  });
});

describe('passkey names (MUT-115 DR8)', () => {
  it('names a known provider from its AAGUID', () => {
    expect(providerName('FBFC3007-154E-4ECC-8C0B-6E020557D7BD')).toBe('iCloud Keychain');
    expect(providerName('00000000-0000-0000-0000-000000000000')).toBeNull();
    expect(providerName('11111111-2222-3333-4444-555555555555')).toBeNull();
  });

  it('the vendored list parses, records its source, and has lower-case uuid keys', () => {
    expect(PASSKEY_PROVIDERS.source).toMatch(/passkey-authenticator-aaguids/);
    for (const [aaguid, name] of Object.entries(PASSKEY_PROVIDERS.providers)) {
      expect(aaguid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(name.length).toBeGreaterThan(0);
      expect(name.length).toBeLessThanOrEqual(64);
    }
  });

  it('falls back to the browser and system, or "iPhone" from the app', () => {
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    expect(deviceLabel(mac, 'cookie')).toBe('Chrome on Mac');
    expect(deviceLabel(iphone, 'cookie')).toBe('Safari on iPhone');
    expect(deviceLabel('Dart/3.9 (dart:io)', 'device')).toBe('iPhone');
    expect(deviceLabel(null, 'cookie')).toBe('Passkey');
  });

  it('adds " 2", " 3" for a name the person already has', () => {
    const aaguid = 'fbfc3007-154e-4ecc-8c0b-6e020557d7bd';
    expect(passkeyNameFor(aaguid, null, 'cookie', [])).toBe('iCloud Keychain');
    expect(passkeyNameFor(aaguid, null, 'cookie', ['iCloud Keychain'])).toBe('iCloud Keychain 2');
    expect(passkeyNameFor(aaguid, null, 'cookie', ['iCloud Keychain', 'iCloud Keychain 2'])).toBe('iCloud Keychain 3');
  });
});
