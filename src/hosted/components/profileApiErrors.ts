import { ApiError, apiErrorReason } from '../api/client';

/**
 * Maps the profile API's refusals (MUT-182) onto the profile drawers, in
 * mapIncomeError's pure shape. Every refusal is a banner at the top of the
 * drawer body, never a toast (design review Issue 5): a "nothing was saved"
 * must stay on screen until it is resolved. A refusal that means `me` is stale
 * (the cap, a version, ownership, a removed profile) asks for a re-read.
 */

export interface ProfileBanner {
  tone: 'info' | 'error';
  key: string;
  /** For a plural key, rendered with `tp(key, count)`. */
  count?: number;
  /** Other `{placeholders}` in the string. */
  vars?: Record<string, string>;
}

export interface MappedProfileError {
  banner?: ProfileBanner;
  /** An inline error on a form field instead of a banner. */
  field?: { field: 'name' | 'timezone' | 'defaultCurrency'; key: string };
  /** At the cap: Save stays disabled. */
  capReached?: boolean;
  /** The profile changed elsewhere: offer Reload. */
  conflict?: boolean;
  refetchMe?: boolean;
  /** The edit pane can't continue: go back to the list. */
  backToList?: boolean;
}

const FIELD_KEYS = {
  name: 'hosted.profiles.errors.nameInvalid',
  timezone: 'hosted.profiles.errors.timezoneInvalid',
  defaultCurrency: 'hosted.profiles.errors.currencyInvalid',
} as const;

const banner = (key: string): MappedProfileError => ({ banner: { tone: 'error', key } });

function conflict(error: ApiError, shared: boolean): MappedProfileError {
  switch (apiErrorReason(error)) {
    case 'PROFILE_LIMIT': {
      const limit = (error.details as { limit?: unknown } | null)?.limit;
      return {
        banner: { tone: 'info', key: 'hosted.profiles.errors.limit', count: typeof limit === 'number' ? limit : undefined },
        capReached: true,
        refetchMe: true,
      };
    }
    case 'VERSION_MISMATCH':
      // MUT-373 (DR7): with partners, "elsewhere" is usually another owner.
      return { ...banner(shared ? 'hosted.profiles.errors.changedByOwner' : 'hosted.profiles.errors.changedElsewhere'), conflict: true, refetchMe: true };
    case 'CO_OWNED':
      return { ...banner('hosted.profiles.errors.coOwned'), refetchMe: true };
    case 'DEFAULT_PERSONAL_PROFILE':
      return { ...banner('hosted.profiles.errors.builtInType'), refetchMe: true };
    default:
      return banner('hosted.profiles.errors.generic');
  }
}

function validation(error: ApiError): MappedProfileError {
  const field = (error.details as { field?: unknown } | null)?.field;
  if (field === 'name' || field === 'timezone' || field === 'defaultCurrency') return { field: { field, key: FIELD_KEYS[field] } };
  return banner('hosted.profiles.errors.generic');
}

/** `shared` (MUT-373): the profile has other owners, so a version conflict names them (DR7). */
export function mapProfileError(error: unknown, shared = false): MappedProfileError {
  if (!(error instanceof ApiError) || error.code === 'NETWORK') return banner('hosted.profiles.errors.network');
  switch (error.code) {
    case 'CONFLICT':
      return conflict(error, shared);
    case 'READ_ONLY_PROFILE':
      return { ...banner('hosted.profiles.errors.notOwner'), refetchMe: true, backToList: true };
    case 'SUBSCRIPTION_LAPSED':
      return { ...banner('hosted.billing.gate.refused'), refetchMe: true };
    case 'NOT_FOUND':
      return { ...banner('hosted.profiles.errors.gone'), refetchMe: true, backToList: true };
    case 'VALIDATION_FAILED':
      return validation(error);
    default:
      return banner('hosted.profiles.errors.generic');
  }
}

/**
 * MUT-373: what a leave or a removal's refusal means (design review DR5). The confirm stays open with a banner for
 * anything the person can retry; `done` treats an owner who was already gone as success (refetch, then the toast).
 */
export interface MappedOwnerError {
  banner?: ProfileBanner;
  done?: boolean;
  refetchMe?: boolean;
}

export function mapOwnerError(error: unknown): MappedOwnerError {
  if (!(error instanceof ApiError) || error.code === 'NETWORK') return { banner: { tone: 'error', key: 'hosted.profiles.errors.network' } };
  const reason = apiErrorReason(error);
  if (error.code === 'CONFLICT' && reason === 'CREATOR_CANNOT_LEAVE') return { banner: { tone: 'error', key: 'hosted.profiles.owners.creatorCannotLeave' }, refetchMe: true };
  if (error.code === 'READ_ONLY_PROFILE' && reason === 'NOT_CREATOR') return { banner: { tone: 'error', key: 'hosted.profiles.owners.notCreator' }, refetchMe: true };
  // Already removed, or already left, elsewhere: what was asked for is true (DR5).
  if (error.code === 'NOT_FOUND') return { done: true, refetchMe: true };
  return { banner: { tone: 'error', key: 'hosted.profiles.errors.generic' }, refetchMe: true };
}
