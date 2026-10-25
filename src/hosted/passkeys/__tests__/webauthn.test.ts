import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRpId, hostUnderRpId, passkeySupport } from '../webauthn';

/** MUT-115: passkeys only on a host under the build's RP ID, so the legacy run.app portal never makes a useless one. */
afterEach(() => vi.unstubAllGlobals());

describe('hostUnderRpId', () => {
  it('accepts the apex and its subdomains, and nothing else', () => {
    expect(hostUnderRpId('placeholder.example', 'placeholder.example')).toBe(true);
    expect(hostUnderRpId('app.placeholder.example', 'placeholder.example')).toBe(true);
    expect(hostUnderRpId('APP.PLACEHOLDER.EXAMPLE', 'placeholder.example')).toBe(true);
    expect(hostUnderRpId('evilplaceholder.example', 'placeholder.example')).toBe(false);
    expect(hostUnderRpId('service-xyz.a.run.example', 'placeholder.example')).toBe(false);
    expect(hostUnderRpId('app.placeholder.example', '')).toBe(false);
  });
});

describe('passkeySupport', () => {
  it('is off without a build RP ID (stages legacy/proxy, and Vitest)', () => {
    expect(buildRpId()).toBe('');
    expect(passkeySupport()).toBe(false);
  });

  it('needs both the host and a WebAuthn browser', () => {
    vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {});
    expect(passkeySupport('placeholder.example', 'app.placeholder.example')).toBe(true);
    expect(passkeySupport('placeholder.example', 'service-xyz.a.run.example')).toBe(false);
    vi.stubGlobal('PublicKeyCredential', undefined);
    expect(passkeySupport('placeholder.example', 'app.placeholder.example')).toBe(false);
  });
});
