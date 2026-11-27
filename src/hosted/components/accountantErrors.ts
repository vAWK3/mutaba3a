import { ApiError, apiErrorReason } from '../api/client';

/**
 * MUT-768 (accountant channel): the desk's refusals (customer create, resend, new code, change email, take card) in
 * mapProfileError's pure shape. Each is a banner at the top of the drawer body, never a toast: a "nothing happened"
 * must stay on screen until it is resolved. A refusal that means the desk list is stale asks for a re-read.
 */

export interface DeskBanner {
  tone: 'info' | 'error';
  key: string;
  /** `{placeholders}` in the string. */
  vars?: Record<string, string>;
}

export interface MappedDeskError {
  banner: DeskBanner;
  /** The list on screen is out of date (approval withdrawn, claimed meanwhile, paid): re-read it. */
  refetchDesk?: boolean;
}

const KEY = 'hosted.desk.errors.';
const error = (key: string, vars?: Record<string, string>): MappedDeskError => ({ banner: { tone: 'error', key: KEY + key, ...(vars ? { vars } : {}) } });
const info = (key: string, refetchDesk = false): MappedDeskError => ({ banner: { tone: 'info', key: KEY + key }, ...(refetchDesk ? { refetchDesk } : {}) });

const LIMIT_KEYS: Record<string, string> = { CREATE_PER_DAY: 'limitCreate', LOOKUP_PER_DAY: 'limitLookup', REISSUE_PER_DAY: 'limitReissue' };
const CARD_UNAVAILABLE = new Set(['RESUME_IN_PORTAL', 'CONTACT_US', 'NOTHING_TO_COVER', 'COVERED_BY_MALAFAT', 'COVERED_BY_GRANT', 'NO_BILLING_ACCOUNT', 'BILLING_ACCOUNT_NEEDS_HELP', 'OFFER_ENDED']);

function limitError(refusal: ApiError): MappedDeskError {
  const details = refusal.details as { limit?: unknown; max?: unknown } | null;
  const key = typeof details?.limit === 'string' ? LIMIT_KEYS[details.limit] : undefined;
  if (!key) return error('rateLimited');
  return error(key, typeof details?.max === 'number' ? { max: String(details.max) } : undefined);
}

export function mapDeskError(thrown: unknown): MappedDeskError {
  if (!(thrown instanceof ApiError)) return error('failed');
  const reason = apiErrorReason(thrown);
  switch (thrown.code) {
    case 'ACCOUNTANT_NOT_APPROVED':
      return info('notApproved', true);
    case 'CUSTOMER_CLAIMED':
      return info('claimed', true);
    case 'RATE_LIMITED':
      return limitError(thrown);
    case 'CONFLICT':
      if (reason === 'EMAIL_TAKEN') return error('emailTaken');
      if (reason === 'ALREADY_SUBSCRIBED') return info('alreadyPaid', true);
      if (reason && CARD_UNAVAILABLE.has(reason)) return error('cardUnavailable');
      return error('failed');
    case 'VALIDATION_FAILED':
      if (reason === 'ADDRESS_REFUSED') return error('addressRefused');
      if (reason === 'COUNTRY_NEEDS_BUSINESS') return error('countryNeedsBusiness');
      if (reason === 'ADDRESS_INVALID') return error('addressInvalid');
      return error('failed');
    case 'STRIPE_UNAVAILABLE':
    case 'BILLING_NOT_CONFIGURED':
      return error('stripeDown');
    default:
      return error('failed');
  }
}
