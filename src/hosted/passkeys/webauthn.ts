import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  startRegistration,
  WebAuthnAbortService,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/browser';

/**
 * MUT-115 (ADR-190): the portal's side of passkeys, a thin wrapper over @simplewebauthn/browser. The relying party is
 * the apex domain, fixed at build time (`__PASSKEY_RP_ID__`, from config/hosts.json); passkeys are offered only on a
 * host under it, so the legacy run.app portal never makes one that would be useless after the move.
 *
 * Cancelling the system sheet, or having no passkey for this site, is not an error to show: `cancelled`.
 */
export type CeremonyOutcome<T> = { kind: 'ok'; response: T } | { kind: 'cancelled' } | { kind: 'failed' };

/** The build's RP ID; "" (or absent, in Vitest) = no passkeys. */
export function buildRpId(): string {
  return typeof __PASSKEY_RP_ID__ !== 'undefined' ? __PASSKEY_RP_ID__ : '';
}

/** Whether `hostname` is the RP ID or a subdomain of it. */
export function hostUnderRpId(hostname: string, rpId: string): boolean {
  if (!rpId) return false;
  const host = hostname.toLowerCase();
  return host === rpId || host.endsWith(`.${rpId}`);
}

/** Passkeys on this page: a WebAuthn browser, on a host under the build's RP ID. */
export function passkeySupport(rpId: string = buildRpId(), hostname: string = window.location.hostname): boolean {
  return hostUnderRpId(hostname, rpId) && browserSupportsWebAuthn();
}

/** Conditional mediation (passkeys offered in the email field's autofill), where the browser has it. */
export function passkeyAutofillSupport(): Promise<boolean> {
  return browserSupportsWebAuthnAutofill().catch(() => false);
}

/** NotAllowedError is the platform's answer to a cancel, a timeout and "no passkey for this site" alike. */
function outcomeOf(error: unknown): { kind: 'cancelled' } | { kind: 'failed' } {
  const name = error instanceof Error ? error.name : '';
  return name === 'NotAllowedError' || name === 'AbortError' ? { kind: 'cancelled' } : { kind: 'failed' };
}

export async function createPasskey(optionsJSON: PublicKeyCredentialCreationOptionsJSON): Promise<CeremonyOutcome<RegistrationResponseJSON>> {
  try {
    return { kind: 'ok', response: await startRegistration({ optionsJSON }) };
  } catch (error) {
    // An authenticator that already holds one of this person's passkeys (excludeCredentials) refuses with InvalidStateError.
    return outcomeOf(error);
  }
}

/**
 * Sign-in. `autofill` waits on the email field's suggestions (conditional mediation) until the person picks a
 * passkey there; a later call (the button) or `cancelPasskeyCeremony()` aborts it.
 */
export async function assertPasskey(optionsJSON: PublicKeyCredentialRequestOptionsJSON, autofill = false): Promise<CeremonyOutcome<AuthenticationResponseJSON>> {
  try {
    return { kind: 'ok', response: await startAuthentication({ optionsJSON, useBrowserAutofill: autofill }) };
  } catch (error) {
    return outcomeOf(error);
  }
}

/** Ends a waiting ceremony (the password form was submitted, or the page left). */
export function cancelPasskeyCeremony(): void {
  WebAuthnAbortService.cancelCeremony();
}
