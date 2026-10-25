import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRpId, hostUnderRpId, passkeySupport } from '../webauthn';

/** MUT-115: passkeys only on a host under the build's RP ID, so the legacy run.app portal never makes a useless one. */
afterEach(() => vi.unstubAllGlobals());

describe('hostUnderRpId', () => {
  it('accepts the apex and its subdomains, and nothing else', () => {
    expect(hostUnderRpId('mtb3a.com', 'mtb3a.com')).toBe(true);
    expect(hostUnderRpId('app.mtb3a.com', 'mtb3a.com')).toBe(true);
    expect(hostUnderRpId('APP.MTB3A.COM', 'mtb3a.com')).toBe(true);
    expect(hostUnderRpId('evilmtb3a.com', 'mtb3a.com')).toBe(false);
    expect(hostUnderRpId('mutaba3a-api-xyz.a.run.app', 'mtb3a.com')).toBe(false);
    expect(hostUnderRpId('app.mtb3a.com', '')).toBe(false);
  });
});

describe('passkeySupport', () => {
  it('is off without a build RP ID (stages legacy/proxy, and Vitest)', () => {
    expect(buildRpId()).toBe('');
    expect(passkeySupport()).toBe(false);
  });

  it('needs both the host and a WebAuthn browser', () => {
    vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {});
    expect(passkeySupport('mtb3a.com', 'app.mtb3a.com')).toBe(true);
    expect(passkeySupport('mtb3a.com', 'mutaba3a-api-xyz.a.run.app')).toBe(false);
    vi.stubGlobal('PublicKeyCredential', undefined);
    expect(passkeySupport('mtb3a.com', 'app.mtb3a.com')).toBe(false);
  });
});
