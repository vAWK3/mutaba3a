import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createMailer } from '../mailer.js';
import { MemoryMailTransport } from '../transports/memory.js';
import { createReviewDigest, msUntilNextSweep, REVIEW_COMMAND } from '../review-digest.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import type { LedgerStore } from '../../repositories/ports.js';

/** MUT-367 (A4, D13, D27): at most one operator digest an hour, only while reviews are waiting to be announced. */
const OPERATOR = 'ops@studio.example';
const logger = pino({ level: 'silent' });

async function pending(store: LedgerStore, at: Date) {
  const email = `p-${Math.random().toString(36).slice(2, 10)}@gmail.com`;
  const link = await store.accountSetup.issueSignup({ email, locale: 'ar', tokenDigest: Math.random().toString(36).slice(2).padEnd(64, '0'), at, expiresAt: new Date(at.getTime() + 86_400_000), domainClass: 'WEBMAIL', domainReasons: ['webmail'] });
  await store.accountSetup.redeemSignup({
    tokenDigest: link.tokenDigest,
    passwordHash: 'x',
    at,
    displayName: 'P',
    personal: { name: 'شخصي', slug: `personal-${email}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
    status: 'PENDING_REVIEW',
    review: { domain: 'gmail.com', classification: 'WEBMAIL', reasons: ['webmail'] },
    trialStartsAt: null,
    terms: { version: '2026-10-19', locale: 'ar', textSha256: 'f'.repeat(64), surface: 'portal', clientRelease: null },
    auditFor: () => [],
  });
}

function harness(to: string | null = OPERATOR, reviewLink: string | null = null) {
  let clock = new Date('2026-10-24T09:10:00Z');
  const store = new MemoryLedgerStore();
  const outbox = new MemoryMailTransport(() => clock);
  const mailer = createMailer({ transport: outbox, store, logger, now: () => clock, fromAddress: 'no-reply@mail.example.test', replyTo: null, limits: { daily: 500, securityReserve: 50, perRecipient: 3 } });
  const digest = createReviewDigest({ store, mailer, logger, now: () => clock, to, reviewLink });
  return {
    store,
    outbox,
    digest,
    at: () => clock,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

describe('review digest (MUT-367)', () => {
  it('MUT-460: links to the portal\'s operator signups page when the server knows its portal, keeping the command', async () => {
    const h = harness(OPERATOR, 'https://app.example.test/operator/signups');
    await pending(h.store, h.at());
    await h.digest.announce();
    const [mail] = h.outbox.list({ to: OPERATOR });
    expect(mail!.text).toContain('https://app.example.test/operator/signups');
    expect(mail!.html).toContain('href="https://app.example.test/operator/signups"');
    expect(mail!.text).toContain(REVIEW_COMMAND);
  });

  it('MUT-460: with no portal origin the mail carries only the command, as before', async () => {
    const h = harness();
    await pending(h.store, h.at());
    await h.digest.announce();
    expect(h.outbox.list({ to: OPERATOR })[0]!.text).not.toContain('/operator/signups');
  });

  it('sends nothing while nothing waits', async () => {
    const h = harness();
    expect(await h.digest.announce()).toBe('idle');
    expect(h.outbox.list({ to: OPERATOR })).toHaveLength(0);
  });

  it('announces new reviews at most once per UTC hour, and picks up the rest at the next hour', async () => {
    const h = harness();
    await pending(h.store, h.at());
    expect(await h.digest.announce()).toBe('sent');
    const [first] = h.outbox.list({ to: OPERATOR });
    expect(first).toMatchObject({ template: 'review-digest', locale: 'en' });
    expect(first!.text).toContain('1');
    expect(first!.text).toContain(REVIEW_COMMAND);

    // Already announced: the sweep stays quiet.
    h.advance(10 * 60_000);
    expect(await h.digest.announce()).toBe('idle');

    // A new review in the same hour waits: same-hour key.
    await pending(h.store, h.at());
    expect(await h.digest.announce()).toBe('duplicate');
    expect(h.outbox.list({ to: OPERATOR })).toHaveLength(1);

    // Next hour: one digest, counting both open reviews.
    h.advance(60 * 60_000);
    expect(await h.digest.announce()).toBe('sent');
    expect(h.outbox.list({ to: OPERATOR })).toHaveLength(2);
    expect(h.outbox.list({ to: OPERATOR })[1]!.subject).toContain('2');
  });

  it('never gives up a review on a failed send, and is outside the per-recipient cap', async () => {
    const h = harness();
    for (let hour = 0; hour < 5; hour++) {
      await pending(h.store, h.at());
      expect(await h.digest.announce()).toBe('sent');
      h.advance(60 * 60_000);
    }
    expect(h.outbox.list({ to: OPERATOR })).toHaveLength(5);
  });

  it('with no OPERATOR_ALERT_EMAIL it stays idle', async () => {
    const h = harness(null);
    await pending(h.store, h.at());
    expect(await h.digest.announce()).toBe('idle');
  });

  it('the sweep runs five minutes past each UTC hour', () => {
    expect(msUntilNextSweep(new Date('2026-10-24T09:00:00Z'))).toBe(5 * 60_000);
    expect(msUntilNextSweep(new Date('2026-10-24T09:10:00Z'))).toBe(55 * 60_000);
    expect(msUntilNextSweep(new Date('2026-10-24T09:04:00Z'))).toBe(60_000);
  });
});
