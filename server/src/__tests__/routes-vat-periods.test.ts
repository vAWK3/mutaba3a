import { describe, expect, it } from 'vitest';
import { JOB, accountantHarness, businessOf, json, person, read, shared, type AccountantHarness, type Person } from './helpers/accountants.js';

/**
 * MUT-782 (ADR-343): the client's Done and the accountant's period and review. The accountant never writes through a
 * profile (ADR-245 d3); these are session-only routes under /v1/clients, authorised by an ACTIVE grant. The dark flag
 * (VAT_PERIOD_REMINDERS) answers 404 on all of them and on the job.
 */
const KEY = '2026-B5';
const call = (h: AccountantHarness, method: string, path: string, who: Person, body?: unknown) =>
  h.app.request(path, body === undefined ? { method, headers: who.auth } : json(body, who.auth, method));

async function setup(over: { flag?: boolean } = {}) {
  const h = accountantHarness({ vatPeriodReminders: over.flag ?? true });
  const owner = await person(h, { displayName: 'Samer Haddad' });
  const profileId = await businessOf(h, owner);
  const accountant = await shared(h, owner, profileId);
  return { h, owner, profileId, accountant };
}

/** The sweep's announcement, made directly: what the routes read. */
const announce = (h: AccountantHarness, profileId: string, periodKey = KEY) =>
  h.store.vatPeriods.announce({ organizationId: profileId, periodKey, at: h.now(), followUpDueAt: new Date(h.now().getTime() + 5 * 86_400_000) });

describe('the dark flag', () => {
  it('answers 404 on every route and on the job while VAT_PERIOD_REMINDERS is off', async () => {
    const { h, owner, profileId, accountant } = await setup({ flag: false });
    await announce(h, profileId);
    expect((await call(h, 'GET', `/v1/profiles/${profileId}/vat-periods/current`, owner)).status).toBe(404);
    expect((await call(h, 'POST', `/v1/profiles/${profileId}/vat-periods/${KEY}/done`, owner, {})).status).toBe(404);
    expect((await call(h, 'GET', '/v1/clients/vat-periods', accountant)).status).toBe(404);
    expect((await call(h, 'PUT', `/v1/clients/${profileId}/vat-period`, accountant, { kind: 'MONTHLY' })).status).toBe(404);
    expect((await call(h, 'POST', `/v1/clients/${profileId}/vat-periods/${KEY}/review`, accountant, { decision: 'CONFIRMED' })).status).toBe(404);
    expect((await h.app.request('/jobs/v1/vat-periods/sweep', { method: 'POST', headers: JOB })).status).toBe(404);
  });

  it('the job still wants its token first', async () => {
    const { h } = await setup({ flag: false });
    expect((await h.app.request('/jobs/v1/vat-periods/sweep', { method: 'POST' })).status).toBe(401);
  });
});

describe('the client: current and Done', () => {
  it('is null before any period is announced', async () => {
    const { h, owner, profileId } = await setup();
    const res = await call(h, 'GET', `/v1/profiles/${profileId}/vat-periods/current`, owner);
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ period: null });
  });

  it('reads the announced period with its months and filing day', async () => {
    const { h, owner, profileId } = await setup();
    await announce(h, profileId);
    const body = await read(await call(h, 'GET', `/v1/profiles/${profileId}/vat-periods/current`, owner));
    expect(body.period).toMatchObject({ periodKey: KEY, kind: 'BIMONTHLY', year: 2026, firstMonth: 9, lastMonth: 10, startDate: '2026-09-01', endDate: '2026-10-31', due: '2026-11-15', state: 'OPEN', note: null, doneAt: null });
  });

  it('Done moves the period to CLIENT_DONE; a repeat answers 200 and changes nothing', async () => {
    const { h, owner, profileId } = await setup();
    await announce(h, profileId);
    const first = await call(h, 'POST', `/v1/profiles/${profileId}/vat-periods/${KEY}/done`, owner, {});
    expect(first.status).toBe(200);
    const done = await read(first);
    expect(done).toMatchObject({ state: 'CLIENT_DONE' });
    h.setNow(new Date(h.now().getTime() + 60_000));
    const again = await read(await call(h, 'POST', `/v1/profiles/${profileId}/vat-periods/${KEY}/done`, owner, {}));
    expect(again.doneAt).toBe(done.doneAt);
  });

  it('Done on a period that was never announced, or a malformed key, is 404', async () => {
    const { h, owner, profileId } = await setup();
    expect((await call(h, 'POST', `/v1/profiles/${profileId}/vat-periods/${KEY}/done`, owner, {})).status).toBe(404);
    expect((await call(h, 'POST', `/v1/profiles/${profileId}/vat-periods/2026-X9/done`, owner, {})).status).toBe(404);
  });

  it('only the owner: an accountant and a stranger can neither read nor mark Done', async () => {
    const { h, profileId, accountant } = await setup();
    await announce(h, profileId);
    const stranger = await person(h);
    for (const who of [accountant, stranger]) {
      expect((await call(h, 'GET', `/v1/profiles/${profileId}/vat-periods/current`, who)).status).toBe(404);
      expect((await call(h, 'POST', `/v1/profiles/${profileId}/vat-periods/${KEY}/done`, who, {})).status).toBe(404);
    }
    expect((await h.store.vatPeriods.recordOf(profileId, KEY))?.state).toBe('OPEN');
  });

  it('an accountant\'s credential on the profile cannot reach it either (the read-only guard, ADR-245)', async () => {
    const { h, profileId, accountant } = await setup();
    await announce(h, profileId);
    const res = await h.app.request(`/v1/profiles/${profileId}/vat-periods/${KEY}/done`, json({}, accountant.on(profileId)));
    expect([403, 404]).toContain(res.status);
    expect((await h.store.vatPeriods.recordOf(profileId, KEY))?.state).toBe('OPEN');
  });
});

describe('the accountant: choose the period, confirm, ask for more', () => {
  it('chooses how often the client files; NONE and a change are remembered', async () => {
    const { h, profileId, accountant } = await setup();
    const res = await call(h, 'PUT', `/v1/clients/${profileId}/vat-period`, accountant, { kind: 'MONTHLY' });
    expect(res.status).toBe(200);
    expect(await read(res)).toEqual({ kind: 'MONTHLY' });
    expect(await h.store.vatPeriods.settingOf(profileId)).toBe('MONTHLY');
    await call(h, 'PUT', `/v1/clients/${profileId}/vat-period`, accountant, { kind: 'NONE' });
    expect(await h.store.vatPeriods.settingOf(profileId)).toBe('NONE');
    expect((await call(h, 'PUT', `/v1/clients/${profileId}/vat-period`, accountant, { kind: 'WEEKLY' })).status).toBe(422);
  });

  it('only an ACTIVE accountant on that client: a stranger, the owner and a revoked accountant get 404', async () => {
    const { h, owner, profileId, accountant } = await setup();
    await announce(h, profileId);
    const other = await person(h, { displayName: 'Other Accountant' });
    for (const who of [other, owner]) {
      expect((await call(h, 'PUT', `/v1/clients/${profileId}/vat-period`, who, { kind: 'MONTHLY' })).status).toBe(404);
      expect((await call(h, 'POST', `/v1/clients/${profileId}/vat-periods/${KEY}/review`, who, { decision: 'CONFIRMED' })).status).toBe(404);
    }
    const list = await read(await call(h, 'GET', `/v1/profiles/${profileId}/accountants`, owner));
    const grantId = list.items.find((g: { status: string }) => g.status === 'active').id as string;
    expect((await h.app.request(`/v1/profiles/${profileId}/accountants/${grantId}`, { method: 'DELETE', headers: owner.auth })).status).toBe(204);
    expect((await call(h, 'PUT', `/v1/clients/${profileId}/vat-period`, accountant, { kind: 'MONTHLY' })).status).toBe(404);
    expect((await call(h, 'POST', `/v1/clients/${profileId}/vat-periods/${KEY}/review`, accountant, { decision: 'CONFIRMED' })).status).toBe(404);
    expect(await h.store.vatPeriods.settingOf(profileId)).toBeNull();
    expect((await h.store.vatPeriods.recordOf(profileId, KEY))?.state).toBe('OPEN');
  });

  it('confirms; a confirmed period is final for Done and for another review (409 VAT_PERIOD_STATE)', async () => {
    const { h, owner, profileId, accountant } = await setup();
    await announce(h, profileId);
    await call(h, 'POST', `/v1/profiles/${profileId}/vat-periods/${KEY}/done`, owner, {});
    const res = await call(h, 'POST', `/v1/clients/${profileId}/vat-periods/${KEY}/review`, accountant, { decision: 'CONFIRMED' });
    expect(res.status).toBe(200);
    expect(await read(res)).toMatchObject({ state: 'CONFIRMED' });
    const done = await call(h, 'POST', `/v1/profiles/${profileId}/vat-periods/${KEY}/done`, owner, {});
    expect(done.status).toBe(409);
    expect((await read(done)).error.code).toBe('VAT_PERIOD_STATE');
    expect((await call(h, 'POST', `/v1/clients/${profileId}/vat-periods/${KEY}/review`, accountant, { decision: 'MORE_NEEDED' })).status).toBe(409);
  });

  it('can confirm straight from OPEN, when the client never tapped Done', async () => {
    const { h, profileId, accountant } = await setup();
    await announce(h, profileId);
    expect((await call(h, 'POST', `/v1/clients/${profileId}/vat-periods/${KEY}/review`, accountant, { decision: 'CONFIRMED' })).status).toBe(200);
  });

  it('Ask for more keeps the note, re-opens the follow-up, and the client says Done again', async () => {
    const { h, owner, profileId, accountant } = await setup();
    await announce(h, profileId);
    await call(h, 'POST', `/v1/profiles/${profileId}/vat-periods/${KEY}/done`, owner, {});
    const asked = await read(await call(h, 'POST', `/v1/clients/${profileId}/vat-periods/${KEY}/review`, accountant, { decision: 'MORE_NEEDED', note: '  October fuel  ' }));
    expect(asked).toMatchObject({ state: 'MORE_NEEDED', note: 'October fuel' });
    expect((await h.store.vatPeriods.recordOf(profileId, KEY))).toMatchObject({ followUpSentAt: null });
    const seen = await read(await call(h, 'GET', `/v1/profiles/${profileId}/vat-periods/current`, owner));
    expect(seen.period).toMatchObject({ state: 'MORE_NEEDED', note: 'October fuel' });
    const again = await call(h, 'POST', `/v1/profiles/${profileId}/vat-periods/${KEY}/done`, owner, {});
    expect((await read(again)).state).toBe('CLIENT_DONE');
  });

  it('refuses a note over 200 characters', async () => {
    const { h, profileId, accountant } = await setup();
    await announce(h, profileId);
    expect((await call(h, 'POST', `/v1/clients/${profileId}/vat-periods/${KEY}/review`, accountant, { decision: 'MORE_NEEDED', note: 'x'.repeat(201) })).status).toBe(422);
  });

  it('review of a period never announced is 404', async () => {
    const { h, profileId, accountant } = await setup();
    expect((await call(h, 'POST', `/v1/clients/${profileId}/vat-periods/${KEY}/review`, accountant, { decision: 'CONFIRMED' })).status).toBe(404);
  });
});

describe('the Accountant plan (ADR-251)', () => {
  /** Free up to one client: the second is past it, and a lapsed accountant cannot read it. Both accept while the plan is off, then it is switched on. */
  async function twoClients() {
    const plan = { on: false, freeClients: 1, maxClients: 100 };
    const h = accountantHarness({ vatPeriodReminders: true, accountantPlan: plan });
    const ownerA = await person(h, { displayName: 'Owner A' });
    const ownerB = await person(h, { displayName: 'Owner B' });
    const first = await businessOf(h, ownerA, 'First');
    const second = await businessOf(h, ownerB, 'Second');
    const accountant = await shared(h, ownerA, first);
    // The oldest accept is the free one: a minute apart so the order is not a tie.
    h.setNow(new Date(h.now().getTime() + 60_000));
    await shared(h, ownerB, second, accountant);
    plan.on = true;
    return { h, first, second, accountant };
  }

  it('lists only the clients the accountant may read', async () => {
    const { h, first, accountant } = await twoClients();
    const body = await read(await call(h, 'GET', '/v1/clients/vat-periods', accountant));
    expect(body.items.map((i: { profileId: string }) => i.profileId)).toEqual([first]);
  });

  it('answers 402 ACCOUNTANT_PLAN_REQUIRED to the period and the review of a client past the free ones, and writes nothing', async () => {
    const { h, second, accountant } = await twoClients();
    await announce(h, second);
    const put = await call(h, 'PUT', `/v1/clients/${second}/vat-period`, accountant, { kind: 'MONTHLY' });
    expect(put.status).toBe(402);
    expect((await read(put)).error.code).toBe('ACCOUNTANT_PLAN_REQUIRED');
    const review = await call(h, 'POST', `/v1/clients/${second}/vat-periods/${KEY}/review`, accountant, { decision: 'CONFIRMED' });
    expect(review.status).toBe(402);
    expect(await h.store.vatPeriods.settingOf(second)).toBeNull();
    expect((await h.store.vatPeriods.recordOf(second, KEY))?.state).toBe('OPEN');
  });

  it('the first client still works', async () => {
    const { h, first, accountant } = await twoClients();
    expect((await call(h, 'PUT', `/v1/clients/${first}/vat-period`, accountant, { kind: 'MONTHLY' })).status).toBe(200);
  });
});

describe('GET /v1/clients/vat-periods', () => {
  it('lists the accountant\'s active clients with what each files and where its period stands', async () => {
    const { h, owner, profileId, accountant } = await setup();
    const second = await businessOf(h, owner, 'Second Studio');
    await shared(h, owner, second, accountant);
    await call(h, 'PUT', `/v1/clients/${profileId}/vat-period`, accountant, { kind: 'BIMONTHLY' });
    await announce(h, profileId);
    const body = await read(await call(h, 'GET', '/v1/clients/vat-periods', accountant));
    expect(body.items).toHaveLength(2);
    const one = body.items.find((i: { profileId: string }) => i.profileId === profileId);
    const two = body.items.find((i: { profileId: string }) => i.profileId === second);
    expect(one).toMatchObject({ kind: 'BIMONTHLY', chosenKind: 'BIMONTHLY', period: { periodKey: KEY, state: 'OPEN' } });
    expect(two).toEqual({ profileId: second, kind: 'NONE', chosenKind: null, period: null });
  });

  it('lists only your own clients, and none once access ended', async () => {
    const { h, owner, profileId, accountant } = await setup();
    const other = await person(h);
    expect((await read(await call(h, 'GET', '/v1/clients/vat-periods', other))).items).toEqual([]);
    const list = await read(await call(h, 'GET', `/v1/profiles/${profileId}/accountants`, owner));
    await h.app.request(`/v1/profiles/${profileId}/accountants/${list.items[0].id as string}`, { method: 'DELETE', headers: owner.auth });
    expect((await read(await call(h, 'GET', '/v1/clients/vat-periods', accountant))).items).toEqual([]);
  });
});

describe('POST /jobs/v1/vat-periods/sweep (through the app)', () => {
  it('announces on the first day after a period ends, and the client and accountant see it', async () => {
    const { h, owner, profileId, accountant } = await setup();
    await call(h, 'PUT', `/v1/clients/${profileId}/vat-period`, accountant, { kind: 'MONTHLY' });
    h.setNow(new Date('2026-12-01T06:00:00Z'));
    const res = await h.app.request('/jobs/v1/vat-periods/sweep', { method: 'POST', headers: JOB });
    expect(res.status).toBe(200);
    expect(await read(res)).toMatchObject({ announced: 1, digests: 1, failed: 0 });
    expect(h.transport.list({ to: owner.email }).filter((m) => m.template === 'vat-period-client')).toHaveLength(1);
    expect(h.transport.list({ to: accountant.email }).filter((m) => m.template === 'vat-period-accountant-digest')).toHaveLength(1);
    const seen = await read(await call(h, 'GET', `/v1/profiles/${profileId}/vat-periods/current`, owner));
    expect(seen.period).toMatchObject({ periodKey: '2026-M11', state: 'OPEN', due: '2026-12-15' });
    expect(await read(await h.app.request('/jobs/v1/vat-periods/sweep', { method: 'POST', headers: JOB }))).toMatchObject({ announced: 0, digests: 0 });
  });
});

