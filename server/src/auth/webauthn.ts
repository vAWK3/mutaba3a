import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL, isoUint8Array, parseAuthenticatorData } from '@simplewebauthn/server/helpers';
import type { PasskeyDeviceType, PasskeyRecord, UserRecord } from '../repositories/ports.js';

/**
 * MUT-115 (ADR-189): the WebAuthn relying party, a thin layer over @simplewebauthn/server so the routes never touch
 * its option shapes. One RP ID, the apex domain (D1), so a passkey made on the portal (`https://app.<apex>`) signs in
 * to the iOS app (native assertions carry `https://<apex>`) and the other way round. Attestation `none`, discoverable
 * credentials, user verification required, ES256 + RS256 (D3).
 */
export interface WebauthnConfig {
  rpId: string;
  /** Shown by some platform sheets next to the account. */
  rpName: string;
  /** Every origin an assertion or a creation may carry. */
  origins: readonly string[];
}

export const RP_NAME = 'MTB3A';
/** D5: a challenge is single-use and lives 5 minutes. */
export const CHALLENGE_TTL_MS = 5 * 60_000;
/** D4 / §11.1: adding a passkey needs a sign-in at most this old, else the current password. */
export const STEP_UP_WINDOW_MS = 10 * 60_000;
/** D12: the most passkeys one person holds. */
export const PASSKEY_LIMIT = 10;
const CEREMONY_TIMEOUT_MS = 2 * 60_000;
/** COSE algorithm ids: ES256, RS256. */
const SUPPORTED_ALGORITHMS = [-7, -257];

/**
 * D2: the RP ID comes from WEBAUTHN_RP_ID (Terraform derives it from config/hosts.json). The origins default to the
 * portal's (PORTAL_ORIGIN) and the apex's own (`https://<rpId>`, the iOS app's); WEBAUTHN_ORIGINS replaces the list
 * for local development. Every origin must be the RP ID or a subdomain of it, over https (http only for localhost),
 * or the server refuses to start. Unset RP ID = no passkeys: every passkey route answers 404.
 */
export function webauthnConfigOf(env: { rpId?: string | undefined; origins?: string | undefined; portalOrigin?: string | undefined }): WebauthnConfig | null {
  const rpId = env.rpId?.trim().toLowerCase();
  if (!rpId) {
    if (env.origins) throw new Error('WEBAUTHN_ORIGINS: needs WEBAUTHN_RP_ID');
    return null;
  }
  if (!/^[a-z0-9.-]+$/.test(rpId) || rpId.startsWith('.') || rpId.endsWith('.')) throw new Error(`WEBAUTHN_RP_ID: "${rpId}" is not a host name`);
  const listed = env.origins
    ?.split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  const origins = listed && listed.length > 0 ? listed : [...(env.portalOrigin ? [env.portalOrigin] : []), `https://${rpId}`];
  const normalized = [...new Set(origins.map((o) => originUnder(rpId, o)))];
  return { rpId, rpName: RP_NAME, origins: normalized };
}

function originUnder(rpId: string, origin: string): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error(`WEBAUTHN_ORIGINS: "${origin}" is not a URL`);
  }
  if (url.origin !== origin.replace(/\/$/, '')) throw new Error(`WEBAUTHN_ORIGINS: "${origin}" must be a bare origin (scheme, host, port)`);
  const host = url.hostname.toLowerCase();
  if (host !== rpId && !host.endsWith(`.${rpId}`)) throw new Error(`WEBAUTHN_ORIGINS: "${origin}" is not ${rpId} or a subdomain of it`);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && host === 'localhost')) throw new Error(`WEBAUTHN_ORIGINS: "${origin}" must use https (http only for localhost)`);
  return url.origin;
}

/** The user handle the authenticator stores: the person's UUID (not PII), as bytes. */
export function userHandleOf(userId: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(isoUint8Array.fromUTF8String(userId));
}

export async function creationOptions(
  config: WebauthnConfig,
  user: Pick<UserRecord, 'id' | 'email' | 'displayName'>,
  existing: readonly Pick<PasskeyRecord, 'credentialId' | 'transports'>[],
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpId,
    userID: userHandleOf(user.id),
    userName: user.email,
    userDisplayName: user.displayName,
    timeout: CEREMONY_TIMEOUT_MS,
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.credentialId, transports: p.transports as AuthenticatorTransportFuture[] })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    supportedAlgorithmIDs: SUPPORTED_ALGORITHMS,
  });
}

/** Sign-in: no email first, so no allowCredentials (discoverable credentials). */
export async function signInOptions(config: WebauthnConfig): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({ rpID: config.rpId, allowCredentials: [], userVerification: 'required', timeout: CEREMONY_TIMEOUT_MS });
}

export interface VerifiedCreation {
  credentialId: string;
  publicKey: Uint8Array;
  signCount: number;
  transports: string[];
  deviceType: PasskeyDeviceType;
  backedUp: boolean;
  aaguid: string;
}

/** Null when the response doesn't verify (wrong challenge, origin, RP ID, no user verification, malformed). */
export async function verifyCreation(config: WebauthnConfig, response: RegistrationResponseJSON, expectedChallenge: string): Promise<VerifiedCreation | null> {
  try {
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: [...config.origins],
      expectedRPID: config.rpId,
      requireUserVerification: true,
      supportedAlgorithmIDs: SUPPORTED_ALGORITHMS,
    });
    if (!result.verified) return null;
    const info = result.registrationInfo;
    return {
      credentialId: info.credential.id,
      publicKey: info.credential.publicKey,
      signCount: info.credential.counter,
      transports: info.credential.transports ?? response.response.transports ?? [],
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
      aaguid: info.aaguid,
    };
  } catch {
    return null;
  }
}

export type AssertionOutcome = { kind: 'verified'; signCount: number } | { kind: 'refused' } | { kind: 'counter-regressed' };

/**
 * Verifies a sign-in assertion against the stored passkey: challenge, origin, RP ID, user verification, the
 * signature, and that the user handle names the passkey's own person. A counter that went backwards (either side
 * non-zero, new ≤ stored) is a cloned authenticator: `counter-regressed`, but only once the signature itself proves
 * genuine, so a forged body can't fill the audit log.
 */
export async function verifyAssertion(
  config: WebauthnConfig,
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  passkey: Pick<PasskeyRecord, 'userId' | 'credentialId' | 'publicKey' | 'signCount' | 'transports'>,
): Promise<AssertionOutcome> {
  try {
    if (response.response.userHandle !== isoBase64URL.fromBuffer(userHandleOf(passkey.userId))) return { kind: 'refused' };
    const presented = parseAuthenticatorData(isoBase64URL.toBuffer(response.response.authenticatorData)).counter;
    const regressed = (presented > 0 || passkey.signCount > 0) && presented <= passkey.signCount;
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: [...config.origins],
      expectedRPID: config.rpId,
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId,
        publicKey: Uint8Array.from(passkey.publicKey),
        // A regressed counter is verified against 0 only to learn whether the signature is genuine.
        counter: regressed ? 0 : passkey.signCount,
        transports: passkey.transports as AuthenticatorTransportFuture[],
      },
    });
    if (!result.verified) return { kind: 'refused' };
    return regressed ? { kind: 'counter-regressed' } : { kind: 'verified', signCount: result.authenticationInfo.newCounter };
  } catch {
    return { kind: 'refused' };
  }
}
