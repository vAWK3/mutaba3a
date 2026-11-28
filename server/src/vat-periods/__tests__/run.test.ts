import { describe, expect, it } from 'vitest';
import pino from 'pino';
import type { Mailer, SendInput, SendResult, MailTemplateId } from '../../email/ports.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import type { CreateUserInput, IssuerDetailsInput, LedgerStore } from '../../repositories/ports.js';
import type { DealerType } from '../../issuing/types.js';
import type { VatPeriodKind } from '../types.js';
import { runVatPeriodSweep, VAT_PERIOD_POLICY } from '../run.js';

/**
 * MUT-782 (ADR-341): the daily VAT period sweep. Clock-injected, on the memory store with a recording mailer. A period
 * is announced on the first day after it ends (never mid-period, never a stale one), each kind on its own schedule; a
 * second run the same day does nothing; the client's follow-up comes five days later and stops at Done; one digest a
 * day per accountant.
 */

const DAY = 86_400_000;
/** 08:00 in Jerusalem (06:00 UTC in winter). */
const at = (y: number, m: number, d: number, hour = 6) => new Date(Date.UTC(y, m - 1, d, hour, 0, 0));

interface Sent {
  to: string;
  template: MailTemplateId;
  locale: string;
  vars: Record<string, unknown>;
  key: string;
}

function recordingMailer() {
  const sent: Sent[] = [];
  const keys = new Set<string>();
  const mailer: Mailer = {
    kind: 'memory',
    async send<T extends MailTemplateId>(input: SendInput<T>): Promise<SendResult> {
      if (keys.has(input.idempotencyKey)) return { status: 'duplicate' };
      keys.add(input.idempotencyKey);
      sent.push({ to: input.to, template: input.template, locale: input.locale, vars: input.vars as Record<string, unknown>, key: input.idempotencyKey });
      return { status: 'sent', id: `m${sent.length}` };
    },
  };
  return { mailer, sent, of: (template: MailTemplateId, to?: string) => sent.filter((m) => m.template === template && (to === undefined || m.to === to)) };
}

const unique = () => Math.random().toString(36).slice(2, 10);
const userInput = (prefix: string, over: Partial<CreateUserInput> = {}): CreateUserInput => ({
  email: `${prefix}-${unique()}@firm-${unique()}.ps`,
  displayName: prefix,
  passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
  locale: 'en',
  personal: { name: `Personal ${prefix}`, slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
  at: at(2026, 1, 1),
  ...over,
});
const issuer = (dealerType: DealerType): IssuerDetailsInput => ({
  legalName: 'Café Nour', vatId: '515000009', vatIdScheme: 'IL_TAX_ID', country: 'IL', dealerType, address: null, city: null, phone: null, email: null, website: null,
  pricesIncludeVat: false, ink: 'BLACK', documentStyle: 'PROFESSIONAL', defaultLanguage: 'ar', paymentTermsDays: null, bankDetails: null, footerNote: null, offerAfterSave: true, defaultDocumentsPreference: 'ON_PAYMENT',
});

interface World {
  store: MemoryLedgerStore;
  mail: ReturnType<typeof recordingMailer>;
  sweep: (now: Date) => ReturnType<typeof runVatPeriodSweep>;
}
function world(): World {
  const store = new MemoryLedgerStore();
  const mail = recordingMailer();
  return { store, mail, sweep: (now) => runVatPeriodSweep({ store, mailer: mail.mailer, logger: pino({ level: 'silent' }), origin: 'https://portal.test', now }) };
}

async function addAccountant(store: LedgerStore, organizationId: string, ownerId: string, accountant?: { id: string; email: string }) {
  const a = accountant ?? (await (async () => {
    const { user } = await store.users.create(userInput('acct'));
    return { id: user.id, email: user.email };
  })());
  const tokenDigest = `t-${unique()}${unique()}`;
  await store.accountantGrants.invite({ organizationId, inviteEmail: a.email, locale: 'en', invitedByUserId: ownerId, tokenDigest, at: at(2026, 1, 2), expiresAt: at(2026, 1, 20), max: 5, auditFor: () => [] });
  await store.accountantGrants.accept({ tokenDigest, accountantUserId: a.id, at: at(2026, 1, 3), auditFor: () => [] });
  return a;
}

async function client(w: World, opts: { dealer?: DealerType; kind?: VatPeriodKind; accountant?: { id: string; email: string }; locale?: 'en' | 'ar'; claimed?: boolean } = {}) {
  const { user, personalOrganization } = await w.store.users.create(userInput('owner', { locale: opts.locale ?? 'en', passwordHash: opts.claimed === false ? null : '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA' }));
  const organizationId = personalOrganization.id;
  if (opts.dealer) await w.store.issuing.putIssuer(organizationId, issuer(opts.dealer), null, at(2026, 1, 1));
  const accountant = await addAccountant(w.store, organizationId, user.id, opts.accountant);
  if (opts.kind) await w.store.vatPeriods.setKind({ organizationId, kind: opts.kind, userId: accountant.id, at: at(2026, 1, 4) });
  return { organizationId, ownerId: user.id, ownerEmail: user.email, accountant };
}

describe('runVatPeriodSweep: when each kind pings', () => {
  it('a 2-monthly client (licensed dealer) is pinged once, on the first day after the period ends, never before', async () => {
    const w = world();
    const c = await client(w, { dealer: 'LICENSED' });
    expect(await w.sweep(at(2026, 2, 28))).toMatchObject({ announced: 0 });
    expect(w.mail.sent).toHaveLength(0);
    expect(await w.sweep(at(2026, 3, 1))).toMatchObject({ announced: 1, digests: 1 });
    const mail = w.mail.of('vat-period-client', c.ownerEmail);
    expect(mail).toHaveLength(1);
    expect(mail[0]!.vars).toMatchObject({ period: { kind: 'BIMONTHLY', year: 2026, firstMonth: 1, lastMonth: 2 }, dueOn: { year: 2026, month: 3, day: 15 }, reminder: false, link: 'https://portal.test/sign-in' });
    expect(await w.store.vatPeriods.recordOf(c.organizationId, '2026-B1')).toMatchObject({ state: 'OPEN' });
  });

  it('a second run the same day sends nothing more', async () => {
    const w = world();
    await client(w, { dealer: 'LICENSED' });
    await w.sweep(at(2026, 3, 1));
    const before = w.mail.sent.length;
    expect(await w.sweep(at(2026, 3, 1, 15))).toMatchObject({ announced: 0, digests: 0, followUps: 0 });
    expect(w.mail.sent).toHaveLength(before);
  });

  it('mid-period and the days after the window say nothing', async () => {
    const w = world();
    await client(w, { dealer: 'LICENSED' });
    expect(await w.sweep(at(2026, 4, 15))).toMatchObject({ announced: 0 });
    expect(w.mail.sent).toHaveLength(0);
  });

  it('turning the sweep on late does not announce an old period (the catch-up window)', async () => {
    const w = world();
    await client(w, { dealer: 'LICENSED' });
    const late = new Date(at(2026, 3, 1).getTime() + (VAT_PERIOD_POLICY.announceWindowDays + 1) * DAY);
    expect(await w.sweep(late)).toMatchObject({ announced: 0 });
  });

  it('a company is pinged monthly, the next month on its own day', async () => {
    const w = world();
    const c = await client(w, { dealer: 'COMPANY' });
    await w.sweep(at(2026, 3, 1));
    await w.sweep(at(2026, 4, 1));
    const periods = w.mail.of('vat-period-client', c.ownerEmail).map((m) => (m.vars.period as { firstMonth: number }).firstMonth);
    expect(periods).toEqual([2, 3]);
  });

  it('an exempt dealer is pinged yearly, with no filing day in the mail', async () => {
    const w = world();
    const c = await client(w, { dealer: 'EXEMPT' });
    expect(await w.sweep(at(2026, 6, 1))).toMatchObject({ announced: 0 });
    await w.sweep(at(2027, 1, 1));
    const mail = w.mail.of('vat-period-client', c.ownerEmail);
    expect(mail).toHaveLength(1);
    expect(mail[0]!.vars).toMatchObject({ period: { kind: 'YEARLY', year: 2026 }, dueOn: null });
  });

  it('NONE never pings: a nonprofit by default, or whatever the accountant chose', async () => {
    const w = world();
    await client(w, { dealer: 'NONPROFIT' });
    await client(w, { dealer: 'COMPANY', kind: 'NONE' });
    expect(await w.sweep(at(2026, 3, 1))).toMatchObject({ announced: 0 });
    expect(w.mail.sent).toHaveLength(0);
  });

  it('a profile with no issuer details and no chosen kind has no period; once chosen it pings', async () => {
    const w = world();
    const c = await client(w);
    expect(await w.sweep(at(2026, 3, 1))).toMatchObject({ announced: 0 });
    await w.store.vatPeriods.setKind({ organizationId: c.organizationId, kind: 'MONTHLY', userId: c.accountant.id, at: at(2026, 3, 1) });
    expect(await w.sweep(at(2026, 3, 2))).toMatchObject({ announced: 1 });
  });

  it('changing the period applies from the next period and leaves past records alone', async () => {
    const w = world();
    const c = await client(w, { dealer: 'LICENSED' });
    await w.sweep(at(2026, 3, 1));
    const before = await w.store.vatPeriods.recordOf(c.organizationId, '2026-B1');
    await w.store.vatPeriods.setKind({ organizationId: c.organizationId, kind: 'MONTHLY', userId: c.accountant.id, at: at(2026, 3, 10) });
    expect(await w.store.vatPeriods.recordOf(c.organizationId, '2026-B1')).toEqual(before);
    await w.sweep(at(2026, 4, 1));
    expect(await w.store.vatPeriods.recordOf(c.organizationId, '2026-M3')).toMatchObject({ state: 'OPEN' });
    expect(await w.store.vatPeriods.recordOf(c.organizationId, '2026-B1')).toEqual(before);
  });

  it('the accountant\'s chosen kind wins over the dealer type', async () => {
    const w = world();
    await client(w, { dealer: 'LICENSED', kind: 'MONTHLY' });
    await w.sweep(at(2026, 4, 1));
    expect(w.mail.of('vat-period-client')[0]!.vars).toMatchObject({ period: { kind: 'MONTHLY', firstMonth: 3 } });
  });

  it('never pings an owner who has not claimed the account', async () => {
    const w = world();
    await client(w, { dealer: 'LICENSED', claimed: false });
    expect(await w.sweep(at(2026, 3, 1))).toMatchObject({ announced: 0, looked: 0 });
  });

  it('writes in the owner\'s language', async () => {
    const w = world();
    await client(w, { dealer: 'LICENSED', locale: 'ar' });
    await w.sweep(at(2026, 3, 1));
    expect(w.mail.of('vat-period-client')[0]!.locale).toBe('ar');
  });
});

describe('runVatPeriodSweep: the accountant\'s digest', () => {
  it('forty clients make one digest with the count, not forty mails', async () => {
    const w = world();
    const first = await client(w, { dealer: 'LICENSED' });
    for (let i = 0; i < 39; i += 1) await client(w, { dealer: 'LICENSED', accountant: first.accountant });
    expect(await w.sweep(at(2026, 3, 1))).toMatchObject({ announced: 40, digests: 1 });
    const digests = w.mail.of('vat-period-accountant-digest', first.accountant.email);
    expect(digests).toHaveLength(1);
    expect(digests[0]!.vars).toMatchObject({ ended: 40, deskLink: 'https://portal.test/client-books' });
    expect(w.mail.of('vat-period-client')).toHaveLength(40);
  });

  it('is not sent on a day nothing ended', async () => {
    const w = world();
    await client(w, { dealer: 'LICENSED' });
    await w.sweep(at(2026, 3, 1));
    expect(await w.sweep(at(2026, 3, 2))).toMatchObject({ digests: 0 });
  });
});

describe('runVatPeriodSweep: the follow-up', () => {
  it('reaches the client five days later, once, and never after Done', async () => {
    const w = world();
    const a = await client(w, { dealer: 'LICENSED' });
    const b = await client(w, { dealer: 'LICENSED' });
    await w.sweep(at(2026, 3, 1));
    expect(await w.sweep(at(2026, 3, 5))).toMatchObject({ followUps: 0 });
    await w.store.vatPeriods.markDone({ organizationId: b.organizationId, periodKey: '2026-B1', userId: b.ownerId, at: at(2026, 3, 5) });
    expect(await w.sweep(at(2026, 3, 6, 7))).toMatchObject({ followUps: 1 });
    expect(w.mail.of('vat-period-client', a.ownerEmail).map((m) => m.vars.reminder)).toEqual([false, true]);
    expect(w.mail.of('vat-period-client', b.ownerEmail)).toHaveLength(1);
    expect(await w.sweep(at(2026, 3, 7))).toMatchObject({ followUps: 0 });
  });

  it('Ask for more re-opens it: the client is reminded again five days after', async () => {
    const w = world();
    const a = await client(w, { dealer: 'LICENSED' });
    await w.sweep(at(2026, 3, 1));
    await w.store.vatPeriods.markDone({ organizationId: a.organizationId, periodKey: '2026-B1', userId: a.ownerId, at: at(2026, 3, 2) });
    await w.store.vatPeriods.review({ organizationId: a.organizationId, periodKey: '2026-B1', userId: a.accountant.id, decision: 'MORE_NEEDED', note: 'Fuel', at: at(2026, 3, 3), followUpDueAt: new Date(at(2026, 3, 3).getTime() + VAT_PERIOD_POLICY.followUpAfterDays * DAY) });
    expect(await w.sweep(at(2026, 3, 7))).toMatchObject({ followUps: 0 });
    expect(await w.sweep(at(2026, 3, 8, 7))).toMatchObject({ followUps: 1 });
    expect(w.mail.of('vat-period-client', a.ownerEmail).at(-1)!.vars.reminder).toBe(true);
  });

  it('a confirmed period is never followed up', async () => {
    const w = world();
    const a = await client(w, { dealer: 'LICENSED' });
    await w.sweep(at(2026, 3, 1));
    await w.store.vatPeriods.review({ organizationId: a.organizationId, periodKey: '2026-B1', userId: a.accountant.id, decision: 'CONFIRMED', note: null, at: at(2026, 3, 2), followUpDueAt: null });
    expect(await w.sweep(at(2026, 3, 9))).toMatchObject({ followUps: 0 });
  });
});
