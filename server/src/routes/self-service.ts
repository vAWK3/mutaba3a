import { randomUUID } from 'node:crypto';
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { generateSetupToken, setupLinkOrigin, setupUrl } from '../auth/account-setup.js';
import type { AppEnv, SessionSettings } from '../auth/middleware.js';
import { answerNoEarlierThan, recoveryPurposeOf, SELF_SERVICE_POLICY, SYSTEM_CLOCK, type MonotonicClock } from '../auth/self-service.js';
import { isSamePortalOrigin, requestClientIp, sessionDigest } from '../auth/sessions.js';
import { createTurnstileVerifier, TURNSTILE_TEST_SECRETS, type TurnstileAction, type TurnstileVerifier } from '../auth/turnstile.js';
import { normalizeEmail } from '../auth/users.js';
import type { Mailer, MailTemplateId, SendInput } from '../email/ports.js';
import { createFixtureDomainChecker } from '../email/domains/fixture-checker.js';
import { createDomainScreen, type DomainScreen } from '../email/domains/screen.js';
import { DOMAIN_CHECK_BUDGET_MS } from '../email/domains/dns-checker.js';
import type { EmailDomainClass } from '../repositories/ports.js';
import { ApiError } from '../errors.js';
import type { Logger } from '../logger.js';
import { SlidingWindowRateLimiter, type RateLimiter } from '../rate-limit.js';
import { StateConflict } from '../repositories/memory.js';
import type { LedgerStore, UserLocale, UserRecord } from '../repositories/ports.js';
import { AccountRecoveryRequestSchema, ErrorEnvelopeSchema, SelfServiceAcceptedSchema, SelfServiceDoorsSchema, SignupRequestSchema } from '../schemas.js';
import { signInLinkOf } from './account-setup.js';

/**
 * MUT-366 (ADR-159 §3–§7, ADR-175): the two public routes that let a person in without the operator.
 *
 *   POST /v1/signups            mails a SIGNUP link (or "you already have an account"); behind SELF_SIGNUP_ENABLED
 *   POST /v1/account-recovery   mails a RESET link (or SETUP, for an account that never set a password)
 *
 * Both answer 202 {status:"sent"} for every address, no earlier than a fixed floor, so neither the answer nor its
 * timing says whether an account exists (ADR-037 §4). Refusals that depend only on the request (the switch, the
 * origin, the client's address, the body, the bot check, the address's budget) answer at once. Every link ends on
 * the ADR-088 /setup page and redeem; nothing here signs anyone in.
 */
export interface SelfServiceOptions {
  /** SELF_SIGNUP_ENABLED. Off: POST /v1/signups answers 404 (recovery is never behind it). */
  signupEnabled: boolean;
  /**
   * MUT-368 (D1): this server really mails links: a mailer other than noop and a Turnstile secret. GET /v1/self-service
   * reports it, so the portal shows no door that can only fail. Absent = false. Recovery itself stays on either way.
   */
  mailsLinks?: boolean;
  turnstile: TurnstileVerifier;
  /** Per client address, both routes (D6). */
  ipLimiter: RateLimiter;
  /** Per normalised address, both routes, whether or not an account exists (D6). */
  addressMinuteLimiter: RateLimiter;
  addressDayLimiter: RateLimiter;
  /**
   * `screenMs` (MUT-367, D25 as built): the signup answer also covers the domain screen's budget, measured from before
   * the screen, so neither a cache hit nor the branch work shows in the timing. Absent = 0 (tests with short floors).
   */
  floors: { signupMs: number; recoveryMs: number; screenMs?: number };
  /** The floor's clock (D8). Defaults to performance.now and setTimeout. */
  clock?: MonotonicClock;
  /**
   * MUT-367 (ADR-159 §7a): the business-email screen. index.ts passes the configured one (DNS + RDAP in production);
   * absent, the fixture checker answers (tests, QA), so no test ever asks real DNS.
   */
  domainScreen?: DomainScreen;
}

const HOUR_MS = 3_600_000;

/** A branch's mail, still sending: wrapped, because an async function would otherwise wait for it. */
interface PendingMail {
  sending: Promise<void>;
}

/** The production budgets, and Turnstile's always-pass test secret: index.ts passes the configured verifier. */
export function defaultSelfServiceOptions(): SelfServiceOptions {
  return {
    signupEnabled: false,
    turnstile: createTurnstileVerifier({ secret: TURNSTILE_TEST_SECRETS.pass }),
    ipLimiter: new SlidingWindowRateLimiter(SELF_SERVICE_POLICY.ipPerHour, HOUR_MS),
    addressMinuteLimiter: new SlidingWindowRateLimiter(SELF_SERVICE_POLICY.addressPerMinute),
    addressDayLimiter: new SlidingWindowRateLimiter(SELF_SERVICE_POLICY.addressPerDay, 24 * HOUR_MS),
    floors: { signupMs: SELF_SERVICE_POLICY.signupFloorMs, recoveryMs: SELF_SERVICE_POLICY.recoveryFloorMs, screenMs: DOMAIN_CHECK_BUDGET_MS },
  };
}

export interface SelfServiceRouteDependencies {
  store: LedgerStore;
  settings: SessionSettings;
  mailer: Mailer;
  logger: Logger;
  options: SelfServiceOptions;
  /** The app's clock (the fixture screen's "today"). */
  now: () => Date;
}

const SIGNUPS_PATH = '/v1/signups';
const RECOVERY_PATH = '/v1/account-recovery';
const DOORS_PATH = '/v1/self-service';

const errorResponse = (description: string) => ({ description, content: { 'application/json': { schema: ErrorEnvelopeSchema } } });

const accepted = { description: 'Accepted. The same answer for every address, whether or not it has an account', content: { 'application/json': { schema: SelfServiceAcceptedSchema } } };

export function selfServiceRoutes(deps: SelfServiceRouteDependencies): OpenAPIHono<AppEnv> {
  const { store, settings, mailer, logger, options } = deps;
  const clock = options.clock ?? SYSTEM_CLOCK;
  // Built on first use when not injected: the fixture screen reads the vendored lists from disk, which the portal's
  // local mode (createApp in a browser or jsdom) must never do just by composing the app. index.ts injects the
  // production screen, built at boot so a bad list still fails the deploy.
  let fallbackScreen: DomainScreen | null = null;
  const domainScreen = (): DomainScreen => options.domainScreen ?? (fallbackScreen ??= createDomainScreen({ checker: createFixtureDomainChecker(deps.now), now: deps.now, logger }));
  const app = new OpenAPIHono<AppEnv>();

  // MUT-368 (D1): the doors, before anything else; public, no origin check (a GET changes nothing), never cached.
  // MUT-369 (D2): readable from any site, so the landing (another origin) can show "Create an account" only while
  // signup is open. Two public booleans that name no account, and no credentials are allowed, so `*` exposes nothing.
  // No preflight is answered: the landing's request must stay CORS-simple (a GET with no custom headers, D17).
  app.openapi(
    createRoute({
      method: 'get',
      path: DOORS_PATH,
      tags: ['Sessions'],
      summary: 'Which self-service doors this server opens: signup, and recovery by email (says nothing about any account)',
      security: [],
      responses: { 200: { description: 'The doors', content: { 'application/json': { schema: SelfServiceDoorsSchema } } } },
    }),
    (c) => {
      const mails = options.mailsLinks ?? false;
      c.header('Access-Control-Allow-Origin', '*');
      return c.json({ signup: mails && options.signupEnabled, recovery: mails }, 200);
    },
  );

  // The switch answers before the body is validated, so a closed signup is a 404 whatever is sent (D10).
  app.use(SIGNUPS_PATH, async (_c, next) => {
    if (!options.signupEnabled) throw new ApiError('NOT_FOUND', 'Signup is not open');
    await next();
  });

  /** Same origin, then the client address's budget. */
  async function guard(c: Context<AppEnv>, now: Date): Promise<string> {
    if (!isSamePortalOrigin(c.req, settings)) throw new ApiError('CROSS_SITE_REQUEST', 'Use the MTB3A portal itself');
    const ip = requestClientIp((name) => c.req.header(name), settings);
    refuseIfLimited(c, await options.ipLimiter.check(`self-service:${ip}`, now));
    return ip;
  }

  /** The bot check, then the address's budgets: a request without a passing token never spends a person's budget. */
  async function checkAndBudget(c: Context<AppEnv>, input: { ip: string; email: string; token: string; action: TurnstileAction; now: Date }): Promise<void> {
    // Review #1: the key is ours. The request id comes from the client's X-Request-Id, and Cloudflare answers a repeated
    // (token, key) pair with the first verdict, so a client-chosen key would let one solved token pass again and again.
    const passed = await options.turnstile.verify(input.token, { ip: input.ip === 'unknown' ? null : input.ip, action: input.action, idempotencyKey: randomUUID() });
    if (!passed) throw new ApiError('CHECK_FAILED', 'The check didn’t pass; try again');
    const key = `self-service:${input.email}`;
    refuseIfLimited(c, await options.addressMinuteLimiter.check(key, input.now));
    refuseIfLimited(c, await options.addressDayLimiter.check(key, input.now));
  }

  /** A mail outcome never changes the answer; a throw is a bug, logged, and still the same answer. */
  async function send<T extends MailTemplateId>(input: SendInput<T>): Promise<void> {
    try {
      const result = await mailer.send(input);
      if (result.status !== 'sent') logger.info({ template: input.template, outcome: result.status }, 'self-service mail not sent');
    } catch (err) {
      logger.error({ err, template: input.template }, 'self-service mail failed');
    }
  }

  /**
   * Runs one branch so that nothing it does can change the answer (review #3, #4). Its store work is awaited, and a
   * failure is logged, never thrown: only one branch reaches each store call, so an early 500 would name the branch.
   * Its mail is given until the floor and then left to finish in the background: a slow provider (up to Resend's 5 s
   * timeout) would otherwise hold only the branches that mail past the floor.
   */
  async function runBranch(c: Context<AppEnv>, startedMs: number, floorMs: number, branch: () => Promise<PendingMail | null>) {
    let mail: Promise<void> | null = null;
    try {
      mail = (await branch())?.sending ?? null;
    } catch (err) {
      logger.error({ err, path: c.req.path, requestId: c.get('requestId') }, 'self-service branch failed; answered as usual');
    }
    if (mail) await Promise.race([mail, clock.sleep(Math.max(0, startedMs + floorMs - clock.now()))]);
    const overshootMs = await answerNoEarlierThan(startedMs, floorMs, clock);
    // R4: a branch slower than the floor can be told apart by its timing; say so, so the floor can be raised.
    if (overshootMs > 0) logger.warn({ path: c.req.path, floorMs, overshootMs }, 'self-service answer ran past its floor');
    return c.json({ status: 'sent' as const }, 202);
  }

  const origin = (c: Context<AppEnv>) => setupLinkOrigin(settings.portalOrigin, c.req.url).replace(/\/+$/, '');

  app.openapi(
    createRoute({
      method: 'post',
      path: SIGNUPS_PATH,
      tags: ['Sessions'],
      summary: 'Ask for an account: mails a link that finishes creating it (SELF_SIGNUP_ENABLED; same answer for every address)',
      security: [],
      request: { body: { required: true, content: { 'application/json': { schema: SignupRequestSchema } } } },
      responses: {
        202: accepted,
        400: errorResponse('EMAIL_NOT_ACCEPTED: details.reason is disposable (a throwaway service) or no-mail (the domain takes no mail). Depends only on the address; nothing is sent (MUT-367)'),
        403: errorResponse('CROSS_SITE_REQUEST, or CHECK_FAILED (the Turnstile check, action "signup")'),
        404: errorResponse('NOT_FOUND: signup is not open on this server'),
        422: errorResponse('Validation failed'),
        429: errorResponse('RATE_LIMITED: this client or this address asked too often; details.retryAfterSeconds'),
      },
    }),
    async (c) => {
      const now = c.get('now')();
      const ip = await guard(c, now);
      const body = c.req.valid('json');
      const email = normalizeEmail(body.email);
      await checkAndBudget(c, { ip, email, token: body.turnstileToken, action: 'signup', now });
      // MUT-367 (ADR-159 §7a): the business-email screen, for every address alike, before anything is issued. A refusal
      // depends only on the address. The floor runs from before the screen and covers its budget too (D25 as built,
      // code review): a cached domain answers no faster than a fresh one, and the branches still get a full floor.
      const startedMs = clock.now();
      const screened = await domainScreen().screen(email);
      if (screened.kind === 'refused') throw new ApiError('EMAIL_NOT_ACCEPTED', 'Please use a permanent work email address', { reason: screened.reason });
      const domain = { domainClass: screened.domainClass, domainReasons: screened.reasons };
      const floorMs = options.floors.signupMs + (options.floors.screenMs ?? 0);
      return runBranch(c, startedMs, floorMs, () => signupBranch(c, { email, locale: body.locale, now, domain }));
    },
  );

  /** The branch's store work; resolves to its mail, still sending, or null when it mails nothing. */
  async function signupBranch(
    c: Context<AppEnv>,
    input: { email: string; locale: UserLocale; now: Date; domain: { domainClass: EmailDomainClass; domainReasons: string[] } },
  ): Promise<PendingMail | null> {
    // D15: a suppressed address gets nothing, not even a token.
    if (await store.email.isSuppressed(input.email)) return null;
    const holder = await store.users.findByEmail(input.email);
    if (holder) {
      // D16: a disabled account is pointed nowhere (recovery can't help it). MUT-367 (D8): one waiting for review is
      // told it exists, like an active one: signing in then shows the waiting screen.
      if (holder.status === 'DISABLED') return null;
      return { sending: send({
        to: holder.email,
        template: 'account-exists',
        locale: input.locale,
        vars: { signInLink: signInLinkOf(settings, c.req.url), recoverLink: `${origin(c)}/recover` },
        idempotencyKey: `account-exists:${holder.id}:${c.get('requestId')}`,
      }) };
    }
    const token = generateSetupToken();
    const link = await store.accountSetup.issueSignup({
      email: input.email,
      locale: input.locale,
      tokenDigest: sessionDigest(settings.pepper, token),
      at: input.now,
      expiresAt: new Date(input.now.getTime() + SELF_SERVICE_POLICY.signupLinkHours * HOUR_MS),
      ...input.domain,
    });
    return {
      sending: send({
        to: input.email,
        template: 'finish-signup',
        locale: input.locale,
        vars: { link: setupUrl(origin(c), token), validHours: SELF_SERVICE_POLICY.signupLinkHours },
        idempotencyKey: `signup:${link.id}`,
      }),
    };
  }

  app.openapi(
    createRoute({
      method: 'post',
      path: RECOVERY_PATH,
      tags: ['Sessions'],
      summary: 'Forgot your password: mails a link that sets a new one (same answer for every address; nothing changes until it is used)',
      security: [],
      request: { body: { required: true, content: { 'application/json': { schema: AccountRecoveryRequestSchema } } } },
      responses: {
        202: accepted,
        403: errorResponse('CROSS_SITE_REQUEST, or CHECK_FAILED (the Turnstile check, action "recover")'),
        422: errorResponse('Validation failed'),
        429: errorResponse('RATE_LIMITED: this client or this address asked too often; details.retryAfterSeconds'),
      },
    }),
    async (c) => {
      const startedMs = clock.now();
      const now = c.get('now')();
      const ip = await guard(c, now);
      const body = c.req.valid('json');
      const email = normalizeEmail(body.email);
      await checkAndBudget(c, { ip, email, token: body.turnstileToken, action: 'recover', now });
      return runBranch(c, startedMs, options.floors.recoveryMs, () => recoveryBranch(c, { email, locale: body.locale, now }));
    },
  );

  async function recoveryBranch(c: Context<AppEnv>, input: { email: string; locale: UserLocale | undefined; now: Date }): Promise<PendingMail | null> {
    if (await store.email.isSuppressed(input.email)) return null;
    const person = await store.users.findByEmail(input.email);
    const purpose = person ? recoveryPurposeOf(person) : null;
    if (!person || !purpose) return null;
    const hours = purpose === 'RESET' ? SELF_SERVICE_POLICY.recoveryResetHours : SELF_SERVICE_POLICY.recoverySetupHours;
    const token = generateSetupToken();
    const expiresAt = new Date(input.now.getTime() + hours * HOUR_MS);
    let linkId: string;
    try {
      // ADR-088 §3: no lock. The current password, sessions and any operator link keep working until the link is used.
      const link = await store.accountSetup.issue({
        userId: person.id,
        tokenDigest: sessionDigest(settings.pepper, token),
        purpose,
        at: input.now,
        expiresAt,
        lock: false,
        mailed: true,
        audit: await recoveryAudit(c, person, { purpose, expiresAt }),
      });
      linkId = link.id;
    } catch (err) {
      // Disabled between the read and the issue: the same as disabled before it.
      if (err instanceof StateConflict) return null;
      throw err;
    }
    return {
      sending: send({
        to: person.email,
        template: purpose === 'RESET' ? 'reset-password' : 'finish-setup',
        locale: input.locale ?? person.locale,
        vars: { link: setupUrl(origin(c), token), validHours: hours },
        idempotencyKey: `recovery:${linkId}`,
      }),
    };
  }

  /** `user.setup_link_issued`, as the operator's links are, but by the system on the person's request. */
  async function recoveryAudit(c: Context<AppEnv>, person: UserRecord, link: { purpose: 'SETUP' | 'RESET'; expiresAt: Date }) {
    return (await store.memberships.listByUser(person.id)).map((m) => ({
      organizationId: m.organizationId,
      actorType: 'SYSTEM' as const,
      actorId: null,
      action: 'user.setup_link_issued',
      entityType: 'user',
      entityId: person.id,
      metadata: { purpose: link.purpose, expiresAt: link.expiresAt.toISOString(), via: 'recovery' },
      requestId: c.get('requestId'),
    }));
  }

  return app;
}

function refuseIfLimited(c: Context<AppEnv>, decision: { allowed: boolean; retryAfterSeconds: number }): void {
  if (decision.allowed) return;
  c.header('Retry-After', String(decision.retryAfterSeconds));
  throw new ApiError('RATE_LIMITED', 'Too many requests; try again later', { retryAfterSeconds: decision.retryAfterSeconds });
}
