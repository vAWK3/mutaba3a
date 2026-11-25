import { getLocale } from '../../../lib/i18n/core';
import type { Language } from '../../../lib/i18n/types';
import { ApiError, apiErrorReason, type AccountantGrant, type Me, type ShareLink, type ShareLinkPeriod } from '../../api/client';
import { initialsOf } from '../../shell/initials';

/**
 * MUT-561: the Sharing page's rules, pure so each is a unit test. Who gets the page (D8), what each accountant row
 * says and offers, and every invite refusal mapped to one slot: the email field or the drawer's banner (one table, so
 * the drawer never decides an error twice).
 */

/** MUT-577: the operator's per-account switch for accountant access (MUT-433 features), named on /v1/me. */
export const ACCOUNTANT_ACCESS_FEATURE = 'accountant_access';

/**
 * D8 + MUT-577: an owner of the profile (creator or co-owner), signed in, on a server with accountant access
 * (`/v1/me.clients`), and the person's own `accountant_access` feature. Read defensively: a server that doesn't name
 * features yet (or not this one) keeps the page hidden.
 */
export function sharingOpen(me: { clients?: Me['clients']; user?: { features?: readonly string[] } }, profile: { owned?: boolean }, local: boolean): boolean {
  const featured = Array.isArray(me.user?.features) && me.user.features.includes(ACCOUNTANT_ACCESS_FEATURE);
  return !local && featured && me.clients !== undefined && profile.owned === true;
}

/** The page's own search: `?invite=true` and `?newLink=true` open its drawers (the shell's drawer-key style, DESIGN.md). */
export interface SharingSearch {
  invite?: true;
  newLink?: true;
}

const flag = (value: unknown) => value === true || value === 'true' || value === 1 || value === '1';

export function parseSharingSearch(raw: Record<string, unknown>): SharingSearch {
  return { ...(flag(raw.invite) ? { invite: true } : {}), ...(flag(raw.newLink) ? { newLink: true } : {}) };
}

/** The page's drawer keys, so opening one closes the other and nothing else in the URL is touched. */
export const SHARING_DRAWER_KEYS = ['invite', 'newLink'] as const;

/**
 * Review fix (d): a person's text inside a sentence (an email, a name, a profile name) is isolated (U+2068 FSI …
 * U+2069 PDI), so an Arabic name in an English sentence, or an address in an Arabic one, never reorders the words
 * around it. JSX uses `<bdi>`; translated strings use this.
 */
export function isolate(text: string): string {
  return `\u2068${text}\u2069`;
}

// ---- Dates ---------------------------------------------------------------------------------------------------------

/** "Oct 12": an instant as its day in the profile's zone. */
export function shortDay(iso: string, language: Language, timeZone: string): string {
  return new Intl.DateTimeFormat(getLocale(language), { day: 'numeric', month: 'short', timeZone }).format(new Date(iso));
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
  return new Intl.RelativeTimeFormat(getLocale(language), { numeric: 'auto' }).format(-count, unit);
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

/** The limit the refusal names, else the one the list said (an older server sends none in `details`). */
function limitOf(error: ApiError, listLimit: number | undefined): string {
  const limit = (error.details as { limit?: unknown } | null)?.limit;
  if (typeof limit === 'number') return String(limit);
  return listLimit === undefined ? '' : String(listLimit);
}

/** Where an invite refusal shows (plan › Invite drawer). `email` is the address that was sent; `listLimit` the list's. */
export function inviteErrorOf(error: unknown, email: string, listLimit?: number): InviteError {
  if (!(error instanceof ApiError)) return UNREACHABLE;
  const reason = apiErrorReason(error);
  if (error.status === 422) return { field: (reason && FIELD_REASONS[reason]) || 'hosted.sharing.invite.errors.invalid' };
  if (error.status === 409 && reason === 'ACCOUNTANT_LIMIT') return { banner: { key: 'hosted.sharing.invite.errors.limit', vars: { limit: limitOf(error, listLimit) } }, refetch: true };
  if (error.status === 409) return { banner: { key: 'hosted.sharing.invite.errors.already', vars: { email: isolate(email) } } };
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

// ---- Share links (slice B, MUT-560) ---------------------------------------------------------------------------------

export const SHARE_PERIODS = ['LAST_1_MONTH', 'LAST_2_MONTHS', 'LAST_3_MONTHS', 'WHOLE_PROFILE'] as const satisfies readonly ShareLinkPeriod[];
export const SHARE_DAYS = [1, 7, 30] as const;
export type ShareDays = (typeof SHARE_DAYS)[number];
const PERIOD_MONTHS: Record<Exclude<ShareLinkPeriod, 'WHOLE_PROFILE'>, number> = { LAST_1_MONTH: 1, LAST_2_MONTHS: 2, LAST_3_MONTHS: 3 };

/** The calendar day `at` falls on in `timeZone`, as `YYYY-MM-DD`. */
export function dayIn(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(at);
}

/**
 * D9: the range a period means for a link made on `today` (the profile's day), for the form's preview only. The rule's
 * one owner is the server (`server/src/share-links/period.ts`): the last N complete calendar months before today;
 * whole profile = everything up to today. Rows show the range the server froze, never this.
 */
export function periodRange(period: ShareLinkPeriod, today: string): { from: string | null; to: string } {
  if (period === 'WHOLE_PROFILE') return { from: null, to: today };
  const day = new Date(`${today}T00:00:00Z`);
  const first = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() - PERIOD_MONTHS[period], 1));
  const last = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

const monthYear = (iso: string, language: Language) => new Intl.DateTimeFormat(getLocale(language), { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const monthOnly = (iso: string, language: Language) => new Intl.DateTimeFormat(getLocale(language), { month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

/**
 * "Oct 2026", "Aug – Oct 2026", "Dec 2025 – Jan 2026" (OW3: whole months by name); null when `from` is null (the whole
 * profile, which the caller words).
 */
export function monthsLabel(from: string | null, to: string, language: Language): string | null {
  if (from === null) return null;
  if (from.slice(0, 7) === to.slice(0, 7)) return monthYear(to, language);
  const start = from.slice(0, 4) === to.slice(0, 4) ? monthOnly(from, language) : monthYear(from, language);
  return `${start} – ${monthYear(to, language)}`;
}

/** The period as the reader sees it: its months, or the whole-profile words. */
export function rangeLine(range: { from: string | null; to: string }, language: Language): Line {
  const months = monthsLabel(range.from, range.to, language);
  return months ? { key: 'hosted.sharing.links.months', vars: { months } } : { key: 'hosted.sharing.links.wholeProfile' };
}

const ARABIC_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;

/** Arabic-Indic and Eastern Arabic-Indic digits as 0–9, as the server reads them. */
export function foldDigits(text: string): string {
  return text.replace(ARABIC_DIGITS, (digit) => String((digit.codePointAt(0) ?? 0) % 16));
}

/** The PIN to send (folded), or null when it isn't 4 to 8 digits. */
export function pinOf(text: string): string | null {
  const folded = foldDigits(text.trim());
  return /^\d{4,8}$/.test(folded) ? folded : null;
}

export type LinkChip = 'active' | 'locked' | 'ended';
export interface LinkRow {
  period: Line;
  ends: string;
  /** "Ended Nov 1" in place of Ends, for a link that has. */
  ended: Line | null;
  lastOpened: string | null;
  viewers: string;
  chip: LinkChip;
  /** Turn off: an active or a locked link (a locked one still counts toward the limit until it is turned off). */
  canTurnOff: boolean;
}

/** Review 3: a link that expired while the page was open is ended, whatever the list said when it was read. */
const lapsed = (link: ShareLink, now: Date) => (link.status === 'active' || link.status === 'locked') && Date.parse(link.expiresAt) <= now.getTime();

export function linkRow(link: ShareLink, now: Date, language: Language, timeZone: string): LinkRow {
  const chip: LinkChip = lapsed(link, now) ? 'ended' : link.status === 'active' ? 'active' : link.status === 'locked' ? 'locked' : 'ended';
  return {
    period: rangeLine(link, language),
    ends: shortDay(link.expiresAt, language, timeZone),
    ended: chip === 'ended' ? { key: 'hosted.sharing.links.ended', vars: { date: shortDay(lapsed(link, now) ? link.expiresAt : (link.endedAt ?? link.expiresAt), language, timeZone) } } : null,
    lastOpened: link.lastOpenedAt ? relativeDay(link.lastOpenedAt, now, language, timeZone) : null,
    viewers: `${link.viewers} / ${link.maxViewers}`,
    chip,
    canTurnOff: chip !== 'ended',
  };
}

/** Links that hold a place toward the profile's limit: everything not ended (by `now`, review 3). */
export const liveLinks = (links: ShareLink[], now: Date = new Date()) => links.filter((link) => (link.status === 'active' || link.status === 'locked') && !lapsed(link, now)).length;

/** Where a create refusal shows (plan › New link drawer). */
export function linkErrorOf(error: unknown, listLimit?: number): InviteError {
  if (!(error instanceof ApiError)) return UNREACHABLE_LINK;
  const reason = apiErrorReason(error);
  if (error.status === 422 && reason === 'PIN_FORMAT') return { field: 'hosted.sharing.newLink.errors.pin' };
  if (error.status === 422) return { banner: { key: 'hosted.sharing.newLink.errors.unreachable' } };
  if (error.status === 409) return { banner: { key: 'hosted.sharing.newLink.errors.limit', vars: { limit: limitOf(error, listLimit) } }, refetch: true };
  if (error.status === 403) return { banner: { key: 'hosted.sharing.invite.errors.notOwner' }, refetch: true };
  if (error.status === 404) return { banner: { key: 'hosted.sharing.invite.errors.gone' }, refetch: true };
  if (error.status === 402) return { banner: { key: 'hosted.billing.gate.drawerNote' } };
  if (error.status === 429) return { banner: { key: 'hosted.sharing.newLink.errors.rate' } };
  return UNREACHABLE_LINK;
}

const UNREACHABLE_LINK: InviteError = { banner: { key: 'hosted.sharing.newLink.errors.unreachable' } };

/** The contract's names for the period (lower case) in `share_link_created`. */
export const periodEvent = (period: ShareLinkPeriod) => period.toLowerCase();

// ---- The owner's "Download a period" (MUT-314, Basel 13244) ------------------------------------------------------------

/** The server's most months in one download (MUT-314). */
export const DOWNLOAD_MAX_MONTHS = 24;

/** The months one can pick: this month and the 23 before it, newest first, as `YYYY-MM` (never a future month). */
export function monthOptions(today: string, count: number = DOWNLOAD_MAX_MONTHS): string[] {
  const day = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  return Array.from({ length: count }, (_, back) => new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() - back, 1)).toISOString().slice(0, 7));
}

/** How many calendar months `from`…`to` spans (inclusive); 0 when `to` is before `from`. */
export function monthSpan(from: string, to: string): number {
  const months = (month: string) => {
    const at = new Date(`${month}-01T00:00:00Z`);
    return at.getUTCFullYear() * 12 + at.getUTCMonth();
  };
  return Math.max(0, months(to) - months(from) + 1);
}

/** "Oct 2026" for a `YYYY-MM`. */
export const monthName = (month: string, language: Language) => monthsLabel(`${month}-01`, `${month}-01`, language) ?? month;

/** Where a ticket refusal shows: the row's one message line. */
export function downloadErrorOf(error: unknown): Line {
  if (!(error instanceof ApiError)) return { key: 'hosted.sharing.download.errors.unreachable' };
  const reason = apiErrorReason(error);
  if (error.status === 422 && reason === 'PERIOD_TOO_LARGE') return { key: 'hosted.sharing.download.errors.tooLarge' };
  if (error.status === 422) return { key: 'hosted.sharing.download.errors.range' };
  if (error.status === 429) return { key: 'hosted.sharing.download.errors.rate' };
  if (error.status === 404) return { key: 'hosted.sharing.download.errors.gone' };
  return { key: 'hosted.sharing.download.errors.unreachable' };
}
