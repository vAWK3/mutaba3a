import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import type { QueryClient } from '@tanstack/react-query';
import { api, ApiError, type Passkey, type Schemas } from '../api/client';
import { ME_KEY } from '../session/me';
import { createPasskey } from './webauthn';

/**
 * MUT-115: the "add a passkey" ceremony and its outcomes, without any UI: You › Account › Passkeys runs it, and so can
 * MUT-370's "suggest a passkey" card right after first sign-in (no step-up then: the sign-in is under 10 minutes old).
 */
export const PASSKEYS_KEY = ['passkeys'] as const;

/**
 * After a passkey is added or removed: the list, and /v1/me, whose `passkeyPrompt` the server recomputes (MUT-370, eng
 * review E3), so the Home suggestion goes when one is added anywhere and may return when the last one is removed.
 */
export function passkeysChanged(queryClient: QueryClient): Promise<void> {
  return Promise.all([queryClient.invalidateQueries({ queryKey: PASSKEYS_KEY }), queryClient.invalidateQueries({ queryKey: ME_KEY })]).then(() => undefined);
}

export type AddPasskeyOutcome =
  | { kind: 'added'; passkey: Passkey }
  | { kind: 'cancelled' }
  | { kind: 'stepUp' }
  | { kind: 'wrongPassword' }
  | { kind: 'limit' }
  | { kind: 'failed' }
  | { kind: 'unreachable' };

/** Options, the platform sheet, then the server: the add ceremony, for this drawer and MUT-370's card alike. */
export async function addPasskeyFlow(currentPassword?: string): Promise<AddPasskeyOutcome> {
  try {
    const { challengeId, publicKey } = await api.passkeyCreationOptions(currentPassword);
    const created = await createPasskey(publicKey as unknown as PublicKeyCredentialCreationOptionsJSON);
    if (created.kind === 'cancelled') return { kind: 'cancelled' };
    if (created.kind === 'failed') return { kind: 'failed' };
    const passkey = await api.addPasskey({ challengeId, response: created.response as Schemas['AddPasskeyRequest']['response'], ...(currentPassword === undefined ? {} : { currentPassword }) });
    return { kind: 'added', passkey };
  } catch (error) {
    if (!(error instanceof ApiError)) return { kind: 'failed' };
    if (error.code === 'RECENT_SIGN_IN_REQUIRED') return { kind: 'stepUp' };
    if (error.code === 'CURRENT_PASSWORD_WRONG') return { kind: 'wrongPassword' };
    if (error.code === 'PASSKEY_LIMIT') return { kind: 'limit' };
    if (error.code === 'NETWORK') return { kind: 'unreachable' };
    return { kind: 'failed' };
  }
}

