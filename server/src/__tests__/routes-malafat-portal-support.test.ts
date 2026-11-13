import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { addExpense, connectDelegated, delegatedHarness, lawyer, malafatFirm, type DelegatedHarness } from './helpers/delegated.js';
import { json, person, read, SAME_ORIGIN } from './helpers/oauth-agent.js';
import { consent, exchange, malafatSetup, NEW_ACCOUNT, roundTrip } from './helpers/malafat-sign-in.js';

/** MUT-596: what the portal's Malafat screens read from the server — "(via Malafat)", the members list, ownSignIn. */

const on = (cookie: Record<string, string>, profileId: string) => ({ ...cookie, 'x-mutaba3a-profile': profileId });

describe('"(via Malafat)": a record Malafat writes as the person says so', () => {
  it('an expense and money received carry captureSource malafat; the person’s own do not', async () => {
    const h = await delegatedHarness();
    const firm = await malafatFirm(h);
    const p = await lawyer(h, firm);
    const conn = await connectDelegated(h, p, firm);
    const viaMalafat = await read(await addExpense(h, conn.headers()));
    expect(viaMalafat.captureSource).toBe('malafat');
    const own = await read(await addExpense(h, on(p.cookie, firm.organizationId)));
    expect(own.captureSource).toBeNull();
    // Malafat can't claim another source either: the server sets it.
    const claimed = await read(await h.app.request('/v1/expenses', json({ occurredOn: '2026-10-20', amount: '9.00', currency: 'ILS', captureSource: 'app' }, { ...conn.headers(), 'idempotency-key': `e-${randomUUID()}` })));
    expect(claimed.captureSource).toBe('malafat');
  });
});

describe('GET /v1/members', () => {
  async function firmWithSeats(h: DelegatedHarness) {
    const firm = await malafatFirm(h);
    const partner = await lawyer(h, firm, 'PARTNER');
    firm.seats.push({ subject: 'pending-1', email: 'sami@sader.law', role: 'INTERN' });
    await h.store.externalIdentities.syncMembers({ organizationId: firm.organizationId, tenantId: firm.tenant, members: firm.seats, at: h.now(), audit: [] });
    return { firm, partner };
  }

  it('on a Malafat firm: the seats with their Malafat role, pending ones too, managed in Malafat', async () => {
    const h = await delegatedHarness();
    const { firm, partner } = await firmWithSeats(h);
    const res = await read(await h.app.request('/v1/members', { headers: on(partner.cookie, firm.organizationId) }));
    expect(res.managedInMalafat).toBe(true);
    // The profile says so too, so the portal offers none of Malafat's records to edit, even to the partner who owns it.
    const listed = (await read(await h.app.request('/v1/me', { headers: partner.cookie }))).profiles.find((p: { id: string }) => p.id === firm.organizationId);
    expect(listed).toMatchObject({ owned: true, managedInMalafat: true });
    expect(res.items).toEqual([
      { name: 'Rana Saleh', role: 'OWNER', malafatRole: 'PARTNER', pending: false, you: true },
      { name: 'sami@sader.law', role: null, malafatRole: 'INTERN', pending: true, you: false },
    ]);
  });

  it('elsewhere: the memberships, not managed in Malafat; a stranger gets 404', async () => {
    const h = await delegatedHarness();
    const p = await person(h, { flag: false });
    const res = await read(await h.app.request('/v1/members', { headers: on(p.cookie, p.personalId) }));
    expect(res).toEqual({ managedInMalafat: false, items: [{ name: 'Rana Saleh', role: 'OWNER', malafatRole: null, pending: false, you: true }] });
    const stranger = await person(h, { flag: false });
    expect((await h.app.request('/v1/members', { headers: on(stranger.cookie, p.personalId) })).status).toBe(404);
  });
});

describe('ownSignIn: an account Sign in with Malafat created sets its first own password without a current one', () => {
  it('a normal account still needs its current password; Me says ownSignIn', async () => {
    const h = await delegatedHarness();
    const p = await person(h, { flag: false });
    expect((await read(await h.app.request('/v1/me', { headers: p.cookie }))).user).toMatchObject({ ownSignIn: true, ownPassword: true });
    const res = await h.app.request('/v1/me/password', json({ newPassword: 'a brand new long passphrase' }, p.cookie));
    expect(res.status).toBe(403);
  });

  it('a Malafat-created account: ownSignIn false until it sets a password, which needs no current one', async () => {
    const { h, malafat, who } = await malafatSetup();
    malafat.state.who = who();
    const step = await read(await exchange(h, (await roundTrip(h)).fragment.get('result') ?? ''));
    const done = await consent(h, { ticket: step.ticket, ...NEW_ACCOUNT });
    const cookie = { cookie: (done.headers.get('set-cookie') ?? '').split(';')[0]!, ...SAME_ORIGIN };
    expect((await read(done)).me.user).toMatchObject({ ownSignIn: false, ownPassword: false });
    const set = await h.app.request('/v1/me/password', json({ newPassword: 'my own long passphrase here' }, cookie));
    expect(set.status).toBe(204);
    const rotated = { cookie: (set.headers.get('set-cookie') ?? '').split(';')[0]!, ...SAME_ORIGIN };
    expect((await read(await h.app.request('/v1/me', { headers: rotated }))).user).toMatchObject({ ownSignIn: true, ownPassword: true });
    // Now it is their own: the next change needs it.
    expect((await h.app.request('/v1/me/password', json({ newPassword: 'another long passphrase' }, rotated))).status).toBe(403);
  });

  it('a first password needs a recent sign-in, as a passkey does: a lifted old session cannot add one', async () => {
    const { h, malafat, who } = await malafatSetup();
    malafat.state.who = who();
    const step = await read(await exchange(h, (await roundTrip(h)).fragment.get('result') ?? ''));
    const done = await consent(h, { ticket: step.ticket, ...NEW_ACCOUNT });
    const cookie = { cookie: (done.headers.get('set-cookie') ?? '').split(';')[0]!, ...SAME_ORIGIN };
    h.setNow(new Date(h.now().getTime() + 11 * 60_000));
    const late = await h.app.request('/v1/me/password', json({ newPassword: 'my own long passphrase here' }, cookie));
    expect(late.status).toBe(403);
    expect((await read(late)).error.code).toBe('RECENT_SIGN_IN_REQUIRED');
    expect((await read(await h.app.request('/v1/me', { headers: cookie }))).user.ownPassword).toBe(false);
  });
});
