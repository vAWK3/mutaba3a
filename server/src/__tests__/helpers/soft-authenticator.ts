import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import { isoBase64URL, isoCBOR } from '@simplewebauthn/server/helpers';
import type { AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from '@simplewebauthn/server';

/**
 * MUT-115 (plan §6): a real ES256 platform authenticator on node:crypto, for tests. It makes attestation-`none`
 * credentials and signs assertions for whatever origin it is told, so the server's real @simplewebauthn checks run
 * (nothing is mocked). Knobs flip the facts a test wants refused: no user verification, a counter that goes back, a
 * different user handle.
 */
export const ICLOUD_AAGUID = 'fbfc3007-154e-4ecc-8c0b-6e020557d7bd';

interface Credential {
  id: Uint8Array<ArrayBuffer>;
  privateKey: KeyObject;
  userHandle: string;
  rpId: string;
  counter: number;
}

export interface SoftAuthenticatorOptions {
  aaguid?: string;
  /** Count signatures (hardware keys do; synced passkeys report 0 forever). */
  counts?: boolean;
}

export class SoftAuthenticator {
  readonly credentials: Credential[] = [];
  private readonly aaguid: Uint8Array;
  private readonly counts: boolean;

  constructor(options: SoftAuthenticatorOptions = {}) {
    this.aaguid = uuidBytes(options.aaguid ?? ICLOUD_AAGUID);
    this.counts = options.counts ?? false;
  }

  /** navigator.credentials.create(), as the browser would serialize it. */
  create(options: PublicKeyCredentialCreationOptionsJSON, origin: string, knobs: { userVerified?: boolean; rpId?: string } = {}): RegistrationResponseJSON {
    const rpId = knobs.rpId ?? options.rp.id ?? new URL(origin).hostname;
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const cose = new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, isoBase64URL.toBuffer(jwk.x!)],
      [-3, isoBase64URL.toBuffer(jwk.y!)],
    ]);
    const id = new Uint8Array(randomBytes(32));
    const credential: Credential = { id, privateKey, userHandle: options.user.id, rpId, counter: this.counts ? 1 : 0 };
    this.credentials.push(credential);
    const idLength = new Uint8Array([id.length >> 8, id.length & 0xff]);
    const authData = concat(
      sha256(rpId),
      new Uint8Array([flags({ userVerified: knobs.userVerified ?? true, attested: true })]),
      u32(credential.counter),
      this.aaguid,
      idLength,
      id,
      isoCBOR.encode(cose),
    );
    const attestationObject = isoCBOR.encode(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]) as never);
    const clientDataJSON = clientData('webauthn.create', options.challenge, origin);
    const credentialId = isoBase64URL.fromBuffer(id);
    return {
      id: credentialId,
      rawId: credentialId,
      type: 'public-key',
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
      response: { clientDataJSON, attestationObject: isoBase64URL.fromBuffer(attestationObject), transports: ['internal', 'hybrid'] },
    };
  }

  /** navigator.credentials.get() with this authenticator's newest credential (or the one given). */
  assert(
    options: PublicKeyCredentialRequestOptionsJSON,
    origin: string,
    knobs: { credential?: Credential; userVerified?: boolean; counter?: number; userHandle?: string; rpId?: string } = {},
  ): AuthenticationResponseJSON {
    const credential = knobs.credential ?? this.credentials.at(-1);
    if (!credential) throw new Error('No credential to assert with');
    if (knobs.counter !== undefined) credential.counter = knobs.counter;
    else if (this.counts) credential.counter += 1;
    const authenticatorData = concat(sha256(knobs.rpId ?? options.rpId ?? credential.rpId), new Uint8Array([flags({ userVerified: knobs.userVerified ?? true, attested: false })]), u32(credential.counter));
    const clientDataJSON = clientData('webauthn.get', options.challenge, origin);
    const signer = createSign('SHA256');
    signer.update(concat(authenticatorData, sha256Bytes(isoBase64URL.toBuffer(clientDataJSON))));
    const signature = new Uint8Array(signer.sign(credential.privateKey));
    const credentialId = isoBase64URL.fromBuffer(credential.id);
    return {
      id: credentialId,
      rawId: credentialId,
      type: 'public-key',
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON,
        authenticatorData: isoBase64URL.fromBuffer(authenticatorData),
        signature: isoBase64URL.fromBuffer(signature),
        userHandle: knobs.userHandle ?? credential.userHandle,
      },
    };
  }
}

function flags({ userVerified, attested }: { userVerified: boolean; attested: boolean }): number {
  // UP (0x01), UV (0x04), BE (0x08) + BS (0x10): a synced passkey, AT (0x40) when credential data follows.
  return 0x01 | (userVerified ? 0x04 : 0) | 0x08 | 0x10 | (attested ? 0x40 : 0);
}

function clientData(type: string, challenge: string, origin: string): string {
  return isoBase64URL.fromUTF8String(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
}

function sha256(text: string): Uint8Array {
  return sha256Bytes(new TextEncoder().encode(text));
}

function sha256Bytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(bytes).digest());
}

function u32(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function uuidBytes(uuid: string): Uint8Array {
  return Uint8Array.from(Buffer.from(uuid.replace(/-/g, ''), 'hex'));
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
