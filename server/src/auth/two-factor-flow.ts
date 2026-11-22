import { timingSafeEqual } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import type { Mailer } from '../email/ports.js';
import { ApiError } from '../errors.js';
import type { Logger } from '../logger.js';
import { authLog, type AuthEventKind } from '../observability/auth-log.js';
import type { RateLimiter } from '../rate-limit.js';
import type { JsonObject, LedgerStore, TwoFactorChallengeRecord, TwoFactorFirstStep, TwoFactorPurpose, TwoFactorRecord, UserRecord } from '../repositories/ports.js';
import type { AppEnv } from './middleware.js';
import { requestClientIp, type RequestPathSettings, type SessionKind } from './sessions.js';
import { generateSignInCode } from './sign-in-code.js';
import { verifyTotp } from './totp.js';
import {
  challengeTokenDigest,
  emailCodeDigest,
  generateChallengeToken,
  maskEmail,
  normalizeRecoveryCode,
  TWO_FACTOR_POLICY,
  type TwoFactorKeys,
} from './two-factor.js';

/**
 * MUT-710 (ADR-275 D2, D3, D5): the second step itself, shared by sign-in (sign-in.ts), setup links
 * (routes/account-setup.ts) and the person's own management routes. Holds the keys, the pepper and the mailer; the
 * store comes with each call, so a guarded route keeps its guard.
 *
 * Review 2: every counter moves by the store's conditional updates, never read-then-write here. A try is reserved on
 * the person (reserveTry, under their row lock) and spent on the challenge (spendAttempt) before the code is looked
 * at; a TOTP step, a recovery code and the challenge itself are each claimed by one conditional update, so parallel
 * requests can win neither extra guesses nor a second use of a code.
 */
export type SecondStepUsed = 'totp' | 'email' | 'recovery_code';

export interface TwoFactorFlowOptions {
  keys: TwoFactorKeys;
  pepper: string;
  mailer: Mailer;
  logger: Logger;
  /** D5: emailed codes a person can be sent, across challenges (10 an hour). */
  mailLimiter: RateLimiter;
  settings: RequestPathSettings;
}

export interface ChallengeOptions {
  purpose: TwoFactorPurpose;
  sessionKind?: SessionKind;
  firstStep?: TwoFactorFirstStep;
  linkId?: string;
}

export interface IssuedChallenge {
  token: string;
  challenge: TwoFactorChallengeRecord;
  /** What the client is told: the TWO_FACTOR_REQUIRED details. */
  details: { challengeToken: string; method: TwoFactorRecord['method']; expiresAt: string; emailHint?: string };
}

export interface PresentedSecondStep {
  challengeToken: string;
  code?: string | undefined;
  recoveryCode?: string | undefined;
  /** D8: an app enrolment by a person without their own password also proves the mailbox with an emailed code. */
  emailCode?: string | undefined;
}

export interface VerifiedSecondStep {
  challenge: TwoFactorChallengeRecord;
  used: SecondStepUsed;
  /** An enrolment's TOTP step, stored as lastUsedStep when it turns on. */
  step?: number;
  /** After a recovery code: how many are left. */
  recoveryCodesLeft?: number;
}

const LOCK_POLICY = {
  lockAfter: TWO_FACTOR_POLICY.lockAfterFailures,
  windowMs: TWO_FACTOR_POLICY.failureWindowMinutes * 60_000,
  lockMs: TWO_FACTOR_POLICY.lockMinutes * 60_000,
};

export class TwoFactorFlow {
  constructor(private readonly options: TwoFactorFlowOptions) {}

  get keys(): TwoFactorKeys {
    return this.options.keys;
  }

  /** The person's two-step sign-in, or null when it is off. */
  stateOf(store: LedgerStore, userId: string): Promise<TwoFactorRecord | null> {
    return store.twoFactor.get(userId);
  }

  /** A new challenge for a person who has it on; with the email method the first code is mailed now. */
  async challenge(c: Context<AppEnv>, store: LedgerStore, user: UserRecord, state: TwoFactorRecord, options: ChallengeOptions): Promise<IssuedChallenge> {
    const now = c.get('now')();
    const token = generateChallengeToken();
    const challenge = await store.twoFactor.createChallenge({
      userId: user.id,
      tokenDigest: challengeTokenDigest(this.options.pepper, token),
      purpose: options.purpose,
      method: state.method,
      ...(options.sessionKind ? { sessionKind: options.sessionKind } : {}),
      ...(options.firstStep ? { firstStep: options.firstStep } : {}),
      ...(options.linkId ? { linkId: options.linkId } : {}),
      ...(user.passwordChangedAt ? { passwordChangedAt: user.passwordChangedAt } : {}),
      at: now,
      expiresAt: new Date(now.getTime() + TWO_FACTOR_POLICY.challengeMinutes * 60_000),
    });
    this.log(c, 'two_factor.challenged', user.id, { method: state.method, ...(options.sessionKind ? { sessionKind: options.sessionKind } : {}), outcome: options.purpose });
    if (state.method === 'email') await this.mailCode(c, store, user, challenge);
    return {
      token,
      challenge,
      details: {
        challengeToken: token,
        method: state.method,
        expiresAt: challenge.expiresAt.toISOString(),
        ...(state.method === 'email' ? { emailHint: maskEmail(user.email) } : {}),
      },
    };
  }

  /**
   * D8: an enrolment challenge. The email method mails its test code; the app method carries the new secret sealed and,
   * when `mailProof` (no password of the person's own to prove), mails a code as well.
   */
  async enrolment(c: Context<AppEnv>, store: LedgerStore, user: UserRecord, method: TwoFactorRecord['method'], pendingSecret: string | null, mailProof: boolean): Promise<{ token: string; challenge: TwoFactorChallengeRecord }> {
    const now = c.get('now')();
    const token = generateChallengeToken();
    const challenge = await store.twoFactor.createChallenge({
      userId: user.id,
      tokenDigest: challengeTokenDigest(this.options.pepper, token),
      purpose: 'enrol',
      method,
      ...(pendingSecret ? { pendingSecretSealed: this.options.keys.sealSecret(pendingSecret) } : {}),
      at: now,
      expiresAt: new Date(now.getTime() + TWO_FACTOR_POLICY.challengeMinutes * 60_000),
    });
    if (method === 'email' || mailProof) await this.mailCode(c, store, user, challenge);
    return { token, challenge };
  }

  /** D5: POST /v1/two-factor/email-code. A fresh code for a live email challenge, within the resend limits. */
  async resend(c: Context<AppEnv>, store: LedgerStore, challengeToken: string): Promise<{ expiresAt: string }> {
    const now = c.get('now')();
    const challenge = await store.twoFactor.findChallenge(challengeTokenDigest(this.options.pepper, challengeToken), now);
    if (!challenge || (challenge.method !== 'email' && !(challenge.purpose === 'enrol' && challenge.codeDigest))) throw challengeExpired();
    const user = await store.users.getById(challenge.userId);
    if (!user) throw challengeExpired();
    await this.mailCode(c, store, user, challenge);
    return { expiresAt: challenge.expiresAt.toISOString() };
  }

  /**
   * Checks a second step against a live challenge of `expect.purpose` (and session kind / link), and consumes it.
   * Throws TWO_FACTOR_CHALLENGE_EXPIRED, TWO_FACTOR_CODE_WRONG { triesLeft }, TWO_FACTOR_TOO_MANY_TRIES, or 429
   * RATE_LIMITED while the person's second step is locked.
   */
  async verify(
    c: Context<AppEnv>,
    store: LedgerStore,
    presented: PresentedSecondStep,
    expect: { purpose: TwoFactorPurpose; sessionKind?: SessionKind; linkId?: string; userId?: string },
  ): Promise<VerifiedSecondStep> {
    const now = c.get('now')();
    const challenge = await store.twoFactor.findChallenge(challengeTokenDigest(this.options.pepper, presented.challengeToken), now);
    if (!challenge || !matches(challenge, expect)) throw challengeExpired();
    const userId = challenge.userId;

    const reserved = await store.twoFactor.reserveTry(userId, now, LOCK_POLICY);
    if (!reserved.allowed) {
      if (reserved.lockedUntil) throw this.locked(c, reserved.lockedUntil, now);
      // Off: only a first enrolment has nothing to count on the person (its challenge still caps the tries);
      // any other challenge means it was turned off meanwhile.
      if (challenge.purpose !== 'enrol') throw challengeExpired();
    }
    const spent = await store.twoFactor.spendAttempt(challenge.id, now, TWO_FACTOR_POLICY.maxAttempts);
    if (!spent.spent) throw new ApiError('TWO_FACTOR_TOO_MANY_TRIES', 'Too many wrong codes; start signing in again');

    const outcome = await this.check(store, challenge, presented, now);
    if (!outcome) return this.wrong(c, store, challenge, reserved.lockedUntil, spent.triesLeft, presented, now);

    // Single use: of parallel right answers, exactly one goes on.
    if (!(await store.twoFactor.consumeChallenge(challenge.id, now))) throw challengeExpired();
    await store.twoFactor.clearFailures(userId);
    this.log(c, outcome.used === 'recovery_code' ? 'two_factor.recovery_code_used' : 'two_factor.verified', userId, {
      method: outcome.used,
      ...(challenge.sessionKind ? { sessionKind: challenge.sessionKind } : {}),
      outcome: challenge.purpose,
    });
    return { challenge, ...outcome };
  }

  /** The code itself; each kind is claimed by a conditional update (a TOTP step, a recovery code). Null = wrong. */
  private async check(store: LedgerStore, challenge: TwoFactorChallengeRecord, presented: PresentedSecondStep, now: Date): Promise<Omit<VerifiedSecondStep, 'challenge'> | null> {
    if (presented.recoveryCode !== undefined) {
      const code = normalizeRecoveryCode(presented.recoveryCode);
      if (!code) return null;
      const result = await store.twoFactor.useRecoveryCode(challenge.userId, this.options.keys.recoveryDigest(challenge.userId, code), now);
      return result.used ? { used: 'recovery_code', recoveryCodesLeft: result.left } : null;
    }
    const code = (presented.code ?? '').replace(/\s/g, '');
    if (challenge.method === 'email') return this.emailCodeMatches(challenge, code) ? { used: 'email' } : null;
    const state = await store.twoFactor.get(challenge.userId);
    const sealed = challenge.purpose === 'enrol' ? challenge.pendingSecretSealed : state?.totpSecretSealed;
    const secret = sealed ? this.options.keys.openSecret(sealed) : null;
    if (!secret) return null;
    const totp = verifyTotp(secret, code, now, challenge.purpose === 'enrol' ? null : state?.lastUsedStep ?? null);
    if (!totp.ok) return null;
    // An enrolment's step is stored when it turns on (enable's lastUsedStep); a sign-in's is claimed now, once.
    if (challenge.purpose === 'enrol') {
      if (challenge.codeDigest && !this.emailCodeMatches(challenge, (presented.emailCode ?? '').replace(/\s/g, ''))) return null;
      return { used: 'totp', step: totp.step };
    }
    return (await store.twoFactor.recordStep(challenge.userId, totp.step, now)) ? { used: 'totp' } : null;
  }

  private emailCodeMatches(challenge: TwoFactorChallengeRecord, code: string): boolean {
    if (!challenge.codeDigest || !/^\d{6}$/.test(code)) return false;
    const presented = Buffer.from(emailCodeDigest(this.options.pepper, challenge.id, code));
    const stored = Buffer.from(challenge.codeDigest);
    return presented.length === stored.length && timingSafeEqual(presented, stored);
  }

  private async wrong(
    c: Context<AppEnv>,
    store: LedgerStore,
    challenge: TwoFactorChallengeRecord,
    lockedUntil: Date | null,
    triesLeft: number,
    presented: PresentedSecondStep,
    now: Date,
  ): Promise<never> {
    const method = presented.recoveryCode !== undefined ? 'recovery_code' : challenge.method;
    const user = await store.users.getById(challenge.userId);
    if (user) await auditPerson(c, store, user, 'user.two_factor_failed', { method, purpose: challenge.purpose });
    this.log(c, 'two_factor.failed', challenge.userId, { method, outcome: triesLeft === 0 ? 'too_many_tries' : 'wrong' });
    if (lockedUntil) {
      if (user) await auditPerson(c, store, user, 'user.locked_out', { method: 'two_factor' });
      this.log(c, 'two_factor.locked_out', challenge.userId, { method });
      throw this.locked(c, lockedUntil, now);
    }
    if (triesLeft === 0) throw new ApiError('TWO_FACTOR_TOO_MANY_TRIES', 'Too many wrong codes; start signing in again');
    throw new ApiError('TWO_FACTOR_CODE_WRONG', 'That code isn’t right', { triesLeft });
  }

  private locked(c: Context<AppEnv>, until: Date, now: Date): ApiError {
    const retryAfterSeconds = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000));
    c.header('Retry-After', String(retryAfterSeconds));
    return new ApiError('RATE_LIMITED', 'Too many wrong codes; try again later', { retryAfterSeconds });
  }

  private async mailCode(c: Context<AppEnv>, store: LedgerStore, user: UserRecord, challenge: TwoFactorChallengeRecord): Promise<void> {
    const now = c.get('now')();
    const code = generateSignInCode();
    const recorded = await store.twoFactor.recordCodeSent(challenge.id, emailCodeDigest(this.options.pepper, challenge.id, code), now, {
      minGapMs: TWO_FACTOR_POLICY.resendAfterSeconds * 1000,
      maxCodes: TWO_FACTOR_POLICY.maxCodesPerChallenge,
    });
    if (!recorded) {
      c.header('Retry-After', String(TWO_FACTOR_POLICY.resendAfterSeconds));
      throw new ApiError('RATE_LIMITED', 'A code was sent a moment ago; wait before asking again', { retryAfterSeconds: TWO_FACTOR_POLICY.resendAfterSeconds });
    }
    const budget = await this.options.mailLimiter.check(`two-factor-mail:${user.id}`, now);
    if (!budget.allowed) {
      // The digest is stored, but the code isn't mailed: the challenge can't be finished by email until the budget allows.
      c.header('Retry-After', String(budget.retryAfterSeconds));
      throw new ApiError('RATE_LIMITED', 'Too many codes sent; try again later', { retryAfterSeconds: budget.retryAfterSeconds });
    }
    try {
      const sent = await this.options.mailer.send({
        to: user.email,
        template: 'two-factor-code',
        locale: user.locale,
        vars: { code, validMinutes: TWO_FACTOR_POLICY.challengeMinutes },
        idempotencyKey: `two-factor-code:${challenge.id}:${challenge.codesSent + 1}`,
      });
      if (sent.status !== 'sent') this.options.logger.info({ template: 'two-factor-code', outcome: sent.status }, 'two-step code not sent');
    } catch (err) {
      this.options.logger.error({ err, template: 'two-factor-code' }, 'two-step code mail failed');
    }
    this.log(c, 'two_factor.code_sent', user.id, { method: 'email' });
  }

  /** D12: one auth_event line, with the request's address and agent. */
  log(c: Context<AppEnv>, kind: AuthEventKind, userId: string | null, fields: { method?: string; sessionKind?: SessionKind; outcome?: string; emailKey?: string } = {}): void {
    authLog(this.options.logger, {
      kind,
      userId,
      ...fields,
      ip: requestClientIp((name) => c.req.header(name), this.options.settings),
      userAgent: c.req.header('user-agent') ?? null,
      requestId: c.get('requestId'),
    });
  }
}

function matches(challenge: TwoFactorChallengeRecord, expect: { purpose: TwoFactorPurpose; sessionKind?: SessionKind; linkId?: string; userId?: string }): boolean {
  if (challenge.purpose !== expect.purpose) return false;
  if (expect.sessionKind !== undefined && challenge.sessionKind !== expect.sessionKind) return false;
  if (expect.linkId !== undefined && challenge.linkId !== expect.linkId) return false;
  if (expect.userId !== undefined && challenge.userId !== expect.userId) return false;
  return true;
}

export function challengeExpired(): ApiError {
  return new ApiError('TWO_FACTOR_CHALLENGE_EXPIRED', 'This sign-in step has expired; start again');
}

export function twoFactorRequired(issued: IssuedChallenge): ApiError {
  return new ApiError('TWO_FACTOR_REQUIRED', 'Enter the code from your authenticator app or email to finish', issued.details);
}

export type TwoFactorAuditAction =
  | 'user.two_factor_failed'
  | 'user.locked_out'
  | 'user.two_factor_enabled'
  | 'user.two_factor_disabled'
  | 'user.two_factor_recovery_code_used'
  | 'user.two_factor_recovery_codes_regenerated'
  | 'user.two_factor_reset_by_operator';

/** D13: a two-step event on every profile the person belongs to (the auditToMembers pattern). Lockouts and failures are the SYSTEM's. */
export async function auditPerson(c: Context<AppEnv>, store: LedgerStore, user: UserRecord, action: TwoFactorAuditAction, metadata: JsonObject): Promise<void> {
  const system = action === 'user.two_factor_failed' || action === 'user.locked_out';
  for (const m of await store.memberships.listByUser(user.id)) {
    await store.audit.append({
      organizationId: m.organizationId,
      actorType: system ? 'SYSTEM' : action === 'user.two_factor_reset_by_operator' ? 'ADMIN' : 'USER',
      actorId: system || action === 'user.two_factor_reset_by_operator' ? null : user.id,
      action,
      entityType: 'user',
      entityId: user.id,
      requestId: c.get('requestId'),
      metadata,
    });
  }
}

/**
 * MUT-710 (ADR-275 D10, AC4): issuing and the Tax Authority need two-step sign-in on and this session to have passed
 * it. Placed after requireScope and **before** idempotent(...) (review 3: the idempotency layer stores and replays a
 * 4xx, so a refusal inside the handler would replay forever under the same key). `issuing:write` is session-only, so
 * no API key or agent reaches it; anything else without a person session is refused the same way.
 */
export function requireTwoFactor(store: Pick<LedgerStore, 'twoFactor'>): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const session = c.get('identity')?.session ?? null;
    const state = session ? await store.twoFactor.get(c.get('identity').user.id) : null;
    if (!session || !state || !session.twoFactorAt) {
      throw new ApiError('TWO_FACTOR_SETUP_REQUIRED', state ? 'Sign in again with two-step sign-in to do this' : 'Turn on two-step sign-in to do this', { enrolled: state !== null });
    }
    await next();
  };
}
