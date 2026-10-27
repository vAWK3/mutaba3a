import type { UserLocale } from '../repositories/ports.js';

/**
 * MUT-359 (ADR-159 §5): the transactional-mail port. Callers name a template, a language and its variables; the
 * mailer renders, checks suppression and the caps, and hands the result to one transport (`resend` in production,
 * `log` in development, `memory` in tests and QA, `noop` when unconfigured). Swapping the provider is one transport.
 *
 * No template variable is an amount, a currency or a date: an email carries a link, never a money record
 * (ADR-159 §5, pinned by templates.test.ts). One exception (MUT-333, ADR-188 override log): `account-closing` names
 * the day the account is deleted, a calendar day and never a money date.
 */
export const TEMPLATE_IDS = [
  'finish-signup',
  'account-exists',
  'reset-password',
  'finish-setup',
  'password-changed',
  'account-under-review',
  'account-ready',
  'account-declined',
  'review-digest',
  'trial-ending-soon',
  'trial-ended',
  'trial-locking-soon',
  'account-closing',
  'passkey-added',
] as const;
export type MailTemplateId = (typeof TEMPLATE_IDS)[number];

/**
 * Mail that gets someone back into their account: only these may use the global cap's reserve (D18), so a flood of
 * anything else can't stop recovery. Not the password notice: any signed-in person can trigger it at will.
 */
export const RECOVERY_TEMPLATES: ReadonlySet<MailTemplateId> = new Set<MailTemplateId>(['reset-password', 'finish-setup']);

/**
 * Mail outside the per-recipient cap (D17): the password notice is gated by the password itself, and requests other
 * people can trigger for an address (signup, recovery) must never use up the one mail that reports a takeover.
 * MUT-367 (D26): the review outcomes only the operator triggers, so strangers can't cap them away; and the digest,
 * whose recipient is us.
 */
export const RECIPIENT_CAP_EXEMPT: ReadonlySet<MailTemplateId> = new Set<MailTemplateId>([
  'password-changed',
  'account-ready',
  'account-declined',
  'review-digest',
  // MUT-419 (D11): only the daily run sends these, at most one a day per person, and a stranger asking for signup links
  // to the address must not cap away the lock warning.
  'trial-ending-soon',
  'trial-ended',
  'trial-locking-soon',
  // MUT-333: sent once per close, which the password gates, like the password notice.
  'account-closing',
  // MUT-414: adding a passkey needs a recent sign-in or the password, like the password notice; a stranger asking for
  // signup links to the address must not cap away the one mail that reports a planted passkey.
  'passkey-added',
]);

export interface TemplateVars {
  /** MUT-366: a SIGNUP link to /setup. */
  'finish-signup': { link: string; validHours: number };
  /** MUT-366: a signup request for an address that already has an account. */
  'account-exists': { signInLink: string; recoverLink: string };
  /** MUT-366: a RESET link. */
  'reset-password': { link: string; validHours: number };
  /** MUT-366: a SETUP link for an operator-created account that never set a password. */
  'finish-setup': { link: string; validHours: number };
  /** This ticket: after every password set (`first`) or change. */
  'password-changed': { first: boolean; signInLink: string };
  /** MUT-367. */
  'account-under-review': Record<string, never>;
  'account-ready': { signInLink: string };
  'account-declined': { supportAddress: string };
  /** MUT-367: to the operator. */
  'review-digest': { pending: number; command: string; reviewLink: string | null };
  /**
   * MUT-419: the trial reminders. `daysLeft` is whole days left, rounded up (1-3), always worded "within N days" (D2).
   * `subscribeLink` opens Billing's Subscribe step; `exportLink` opens Your data (the records export).
   */
  'trial-ending-soon': { daysLeft: number; subscribeLink: string };
  'trial-ended': { subscribeLink: string; exportLink: string };
  'trial-locking-soon': { daysLeft: number; subscribeLink: string; exportLink: string };
  /**
   * MUT-333 (D10): the account was closed; it is deleted on `deleteOn` (a calendar day in the person's zone,
   * accounts/closure.ts deletionDayOf) unless they sign in and keep it.
   */
  'account-closing': { deleteOn: CalendarDay; signInLink: string };
  /**
   * MUT-414: a passkey was added to the account, named as the Passkeys list names it. No time: the mail goes out as
   * the passkey is added and says so (ADR-159 §5, no dates in mail).
   */
  'passkey-added': { passkeyName: string; signInLink: string };
}

/** MUT-333: a calendar day, formatted by the template in the mail's own language. */
export interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

export type MailerKind = 'resend' | 'log' | 'memory' | 'noop';

/** What a transport delivers: rendered, addressed, and keyed by a digest (never the caller's raw key). */
export interface OutgoingMail extends RenderedMail {
  to: string;
  from: string;
  replyTo: string | null;
  template: MailTemplateId;
  locale: UserLocale;
  /** sha256 of the caller's idempotency key, hex. Resend's Idempotency-Key. */
  idempotencyKey: string;
}

export interface MailTransport {
  readonly kind: MailerKind;
  deliver(mail: OutgoingMail): Promise<{ id: string }>;
}

export type MailTransportFailure = 'rate_limited' | 'timeout' | 'rejected' | 'unavailable' | 'network';

/** A transport that could not deliver. `status` is the provider's HTTP status when there was one. */
export class MailTransportError extends Error {
  constructor(
    readonly reason: MailTransportFailure,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'MailTransportError';
  }
}

export interface SendInput<T extends MailTemplateId> {
  to: string;
  template: T;
  locale: UserLocale;
  vars: TemplateVars[T];
  /** Stable per logical mail (e.g. `password-notice:<user>:<instant>`); the same key never sends twice. */
  idempotencyKey: string;
}

export type SendResult =
  | { status: 'sent'; id: string }
  | { status: 'duplicate' }
  | { status: 'suppressed' }
  | { status: 'refused'; reason: 'UNOWNED_DOMAIN' | 'INVALID_ADDRESS' }
  | { status: 'capped'; scope: 'global' | 'recipient' }
  | { status: 'disabled' }
  | { status: 'failed'; reason: MailTransportFailure };

export interface Mailer {
  readonly kind: MailerKind;
  /** Never throws for an expected outcome; a throw is a bug (a bad link in the vars, say). */
  send<T extends MailTemplateId>(input: SendInput<T>): Promise<SendResult>;
}

/**
 * Domains we don't own and must never mail (Basel, MUT-359 comment 12412): `mutaba3a.app` is unregistered, so
 * anything sent there reaches whoever registers it. Config also refuses one as the sender or reply-to.
 */
export const UNOWNED_DOMAINS: readonly string[] = ['mutaba3a.app'];

export function isUnownedDomain(address: string): boolean {
  const domain = address.slice(address.lastIndexOf('@') + 1).toLowerCase();
  return UNOWNED_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/** One plain address: no display name, no list, no whitespace or header characters. */
const PLAIN_ADDRESS = /^[^\s@,;:<>"'()[\]\\]+@[^\s@,;:<>"'()[\]\\]+\.[^\s@,;:<>"'()[\]\\.]+$/;
export function isPlainAddress(address: string): boolean {
  return address.length <= 254 && PLAIN_ADDRESS.test(address);
}
