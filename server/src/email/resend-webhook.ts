import { normalizeEmail } from '../auth/users.js';
import type { EmailSuppressionReason } from '../repositories/ports.js';
import { isPlainAddress } from './ports.js';

/**
 * MUT-359 (D10, D20): what a verified Resend webhook event asks us to do. Only two things suppress an address:
 * `email.bounced` with `data.bounce.type === 'Permanent'` (a hard bounce) and `email.complained`. Everything else
 * is ignored, and so is any event not sent from our own domain: the Resend account and its webhooks are shared with
 * Malafat, whose bounces and complaints are not ours to act on or store.
 */
export interface SuppressionIntent {
  email: string;
  reason: EmailSuppressionReason;
}

/** The address in `Name <addr@domain>` or a bare `addr@domain`. */
function addressOf(from: string): string {
  const angle = /<([^<>]+)>\s*$/.exec(from);
  return (angle ? angle[1]! : from).trim().toLowerCase();
}

export function suppressionsFrom(event: unknown, fromDomain: string): SuppressionIntent[] {
  if (typeof event !== 'object' || event === null) return [];
  const { type, data } = event as { type?: unknown; data?: unknown };
  if (typeof data !== 'object' || data === null) return [];
  const { from, to, bounce } = data as { from?: unknown; to?: unknown; bounce?: unknown };
  if (typeof from !== 'string' || addressOf(from).split('@').pop() !== fromDomain.toLowerCase()) return [];
  if (!Array.isArray(to)) return [];

  let reason: EmailSuppressionReason;
  if (type === 'email.complained') reason = 'COMPLAINT';
  else if (type === 'email.bounced' && typeof bounce === 'object' && bounce !== null && (bounce as { type?: unknown }).type === 'Permanent') reason = 'HARD_BOUNCE';
  else return [];

  return to
    .filter((v): v is string => typeof v === 'string')
    .map((v) => normalizeEmail(v))
    .filter(isPlainAddress)
    .map((email) => ({ email, reason }));
}
