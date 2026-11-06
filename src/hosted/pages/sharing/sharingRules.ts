import { getLocale } from '../../../lib/i18n/core';
import type { Language } from '../../../lib/i18n/types';
import { ApiError, apiErrorReason, type AccountantGrant, type Me } from '../../api/client';
import { initialsOf } from '../../shell/initials';

/**
 * MUT-561: the Sharing page's rules, pure so each is a unit test. Who gets the page (D8), what each accountant row
 * says and offers, and every invite refusal mapped to one slot: the email field or the drawer's banner (one table, so
 * the drawer never decides an error twice).
 */

/** D8: an owner of the profile (creator or co-owner), signed in, on a server with accountant access (`/v1/me.clients`). */
export function sharingOpen(me: Pick<Me, 'clients'>, profile: { owned?: boolean }, local: boolean): boolean {
  return !local && me.clients !== undefined && profile.owned === true;
}

/** The page's own search: `?invite=true` opens the invite drawer (the shell's drawer-key style, DESIGN.md). */
export interface SharingSearch {
  invite?: true;
}

export function parseSharingSearch(raw: Record<string, unknown>): SharingSearch {
  return raw.invite === true || raw.invite === 'true' || raw.invite === 1 || raw.invite === '1' ? { invite: true } : {};
}

// ---- Dates ---------------------------------------------------------------------------------------------------------

/** Western digits in both languages, as every figure in the portal (DESIGN.md › RTL). */
const latn = (language: Language) => `${getLocale(language)}-u-nu-latn`;

/** "Oct 12": an instant as its day in the profile's zone. */
export function shortDay(iso: string, language: Language, timeZone: string): string {
  return new Intl.DateTimeFormat(latn(language), { day: 'numeric', month: 'short', timeZone }).format(new Date(iso));
}

const DAYS_PER_WEEK = 7;
const DAYS_PER_MONTH = 30;
const DAYS_PER_YEAR = 365;
const MS_PER_DAY = 86_400_000;

/** The calendar day an instant falls on in `timeZone`, as a UTC midnight, so two days subtract cleanly. */
function dayIndex(date: Date, timeZone: string): number {
  const ymd = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(date);
  return Date.parse(`${ymd}T00:00:00Z`) / MS_PER_DAY;
}

/** "today", "yesterday", "2 days ago", "2 weeks ago": calendar days in the profile's zone, Intl's own wording. */
export function relativeDay(iso: string, now: Date, language: Language, timeZone: string): string {
  const days = Math.max(0, dayIndex(now, timeZone) - dayIndex(new Date(iso), timeZone));
  const [count, unit]: [number, Intl.RelativeTimeFormatUnit] =
    days < DAYS_PER_WEEK ? [days, 'day'] : days < DAYS_PER_MONTH ? [Math.floor(days / DAYS_PER_WEEK), 'week'] : days < DAYS_PER_YEAR ? [Math.floor(days / DAYS_PER_MONTH), 'month'] : [Math.floor(days / DAYS_PER_YEAR), 'year'];
  return new Intl.RelativeTimeFormat(latn(language), { numeric: 'auto' }).format(-count, unit);
}

// ---- Accountant rows -----------------------------------------------------------------------------------------------

export type GrantAction = 'stop' | 'cancel' | 'inviteAgain';
export interface Line {
  key: string;
  vars?: Record<string, string>;
}

export interface GrantRow {
  /** The name, or the email when the accountant has no account yet. */
  label: string;
  /** The email under the name; null when the label already is it. */
  email: string | null;
  initial: string;
  chip: AccountantGrant['status'];
  /** The meta line's parts, joined by " · ". */
  meta: Line[];
  action: GrantAction;
}

const ACTION: Record<AccountantGrant['status'], GrantAction> = { active: 'stop', pending: 'cancel', expired: 'inviteAgain' };

function metaOf(grant: AccountantGrant, now: Date, language: Language, timeZone: string): Line[] {
  if (grant.status === 'expired') return [{ key: 'hosted.sharing.accountants.expiredMeta' }];
  if (grant.status === 'pending') {
    return [
      { key: 'hosted.sharing.accountants.sent', vars: { date: shortDay(grant.invitedAt, language, timeZone) } },
      { key: 'hosted.sharing.accountants.ends', vars: { date: shortDay(grant.expiresAt, language, timeZone) } },
    ];
  }
  const viewed: Line = grant.lastViewedAt
    ? { key: 'hosted.sharing.accountants.viewed', vars: { when: relativeDay(grant.lastViewedAt, now, language, timeZone) } }
    : { key: 'hosted.sharing.accountants.notViewed' };
  return [{ key: 'hosted.sharing.accountants.since', vars: { date: shortDay(grant.acceptedAt ?? grant.invitedAt, language, timeZone) } }, viewed];
}

export function grantRow(grant: AccountantGrant, now: Date, language: Language, timeZone: string): GrantRow {
  const label = grant.name?.trim() || grant.email;
  return {
    label,
    email: label === grant.email ? null : grant.email,
    initial: initialsOf(label),
    chip: grant.status,
    meta: metaOf(grant, now, language, timeZone),
    action: ACTION[grant.status],
  };
}

// ---- Errors --------------------------------------------------------------------------------------------------------

export interface InviteError {
  /** Under the email field: the address itself is the problem. */
  field?: string;
  /** The drawer's banner slot: the whole submit failed. */
  banner?: Line;
  /** The list (and /v1/me) changed under the drawer: read them again. */
  refetch?: true;
}

const FIELD_REASONS: Record<string, string> = {
  SELF_INVITE: 'hosted.sharing.invite.errors.self',
  INVITE_ADDRESS_REFUSED: 'hosted.sharing.invite.errors.refused',
};

const UNREACHABLE: InviteError = { banner: { key: 'hosted.sharing.invite.errors.unreachable' } };

function limitOf(error: ApiError): string {
  const limit = (error.details as { limit?: unknown } | null)?.limit;
  return typeof limit === 'number' ? String(limit) : '';
}

/** Where an invite refusal shows (plan › Invite drawer). `email` is the address that was sent. */
export function inviteErrorOf(error: unknown, email: string): InviteError {
  if (!(error instanceof ApiError)) return UNREACHABLE;
  const reason = apiErrorReason(error);
  if (error.status === 422) return { field: (reason && FIELD_REASONS[reason]) || 'hosted.sharing.invite.errors.invalid' };
  if (error.status === 409 && reason === 'ACCOUNTANT_LIMIT') return { banner: { key: 'hosted.sharing.invite.errors.limit', vars: { limit: limitOf(error) } }, refetch: true };
  if (error.status === 409) return { banner: { key: 'hosted.sharing.invite.errors.already', vars: { email } } };
  if (error.status === 403) return { banner: { key: 'hosted.sharing.invite.errors.notOwner' }, refetch: true };
  if (error.status === 404) return { banner: { key: 'hosted.sharing.invite.errors.gone' }, refetch: true };
  // The portal's query client re-reads /v1/me on a lapse refusal, so the drawer turns read-only on its own.
  if (error.status === 402) return { banner: { key: 'hosted.billing.gate.drawerNote' } };
  if (error.status === 429) return { banner: { key: 'hosted.sharing.invite.errors.rate' } };
  return UNREACHABLE;
}

/** D11: a failed Stop or Cancel puts the row back with a toast; a grant already gone was stopped elsewhere. */
export function revokeErrorOf(error: unknown): { done: true } | { done: false; toast: string } {
  if (error instanceof ApiError && error.status === 404) return { done: true };
  if (error instanceof ApiError && error.status === 403) return { done: false, toast: 'hosted.sharing.invite.errors.notOwner' };
  return { done: false, toast: 'hosted.sharing.accountants.revokeFailed' };
}
