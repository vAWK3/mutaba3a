import type { QueryClient } from '@tanstack/react-query';
import { api, type Schemas } from '../api/client';
import { PASSKEYS_KEY } from './addPasskey';
import { passkeySupport } from './webauthn';

/**
 * MUT-415: whether a password change or a recovery goes on to the passkey review. Passkeys survive both (MUT-115), so
 * someone changing a password they think was stolen should see what else still signs in. Only where this host does
 * passkeys, and only when the account has one: no passkeys, or a list that can't be read, is no extra step. The list
 * it read seeds the drawer's query, so the review opens without reading it again. Never throws.
 */
export async function passkeysToReview(queryClient: QueryClient): Promise<boolean> {
  if (!passkeySupport()) return false;
  try {
    const list = await api.listPasskeys();
    queryClient.setQueryData<Schemas['PasskeyList']>(PASSKEYS_KEY, list);
    return list.items.length > 0;
  } catch {
    return false;
  }
}
