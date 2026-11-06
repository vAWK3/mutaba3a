import { describe, expect, it } from 'vitest';
import { FEATURES } from '../features.js';
import { ADMIN, acceptInvite, accountantHarness, inviteAccountant, inviteTokenFor, json, person, read, shared, type AccountantHarness, type Person } from './helpers/accountants.js';
import { createLink, entriesOf, linkOn, listLinks, revokeLink, shareLinkHarness, viewerOf } from './helpers/share-links.js';

/**
 * MUT-577 (ADR-249 addendum): accountant access per account. The env switches stay the global kill switches; an
 * owner also needs the operator's `accountant_access` feature to invite an accountant or make a share link (else the
 * same 404 as switched off). Listing and revoking always work; accountants and link visitors need no feature; turning
 * the feature off stops new invites and links, and what exists keeps working until revoked.
 */
const grant = (h: AccountantHarness, p: Person) => h.app.request(`/admin/v1/users/${p.userId}/features/accountant_access`, { method: 'PUT', headers: ADMIN });
const revoke = (h: AccountantHarness, p: Person) => h.app.request(`/admin/v1/users/${p.userId}/features/accountant_access`, { method: 'DELETE', headers: ADMIN });
const accountantsOf = (h: AccountantHarness, owner: Person) => h.app.request(`/v1/profiles/${owner.personalId}/accountants`, { headers: owner.auth });

describe('accountant_access per account (MUT-577)', () => {
  it('is an operator feature next to receipt reading', () => {
    expect(FEATURES).toContain('accountant_access');
  });

  it('off (the default): inviting and making a link answer the switched-off 404; listing works; /v1/me shows no feature', async () => {
    const h = shareLinkHarness();
    const owner = await person(h, { sharing: false });
    const invite = await inviteAccountant(h, owner, owner.personalId, 'hadi@books.ps');
    expect(invite.status).toBe(404);
    expect((await read(invite)).error.code).toBe('NOT_FOUND');
    const link = await createLink(h, owner, owner.personalId);
    expect(link.status).toBe(404);
    expect((await read(link)).error.details).toEqual({ reason: 'SHARE_LINK_UNAVAILABLE' });
    expect((await accountantsOf(h, owner)).status).toBe(200);
    expect((await listLinks(h, owner, owner.personalId)).items).toEqual([]);
    expect(h.transport.list({ to: 'hadi@books.ps' })).toEqual([]);
    expect((await read(await h.app.request('/v1/me', { headers: owner.auth }))).user.features).not.toContain('accountant_access');
  });

  it('on: sharing works as built, and /v1/me names the feature', async () => {
    const h = shareLinkHarness();
    const owner = await person(h, { sharing: false });
    expect((await grant(h, owner)).status).toBe(200);
    expect((await read(await h.app.request('/v1/me', { headers: owner.auth }))).user.features).toContain('accountant_access');
    expect((await inviteAccountant(h, owner, owner.personalId, 'hadi@books.ps')).status).toBe(201);
    expect((await createLink(h, owner, owner.personalId)).status).toBe(201);
  });

  it('turning it off stops new invites and links; the accountant and the link keep working until the owner revokes', async () => {
    const h = shareLinkHarness();
    const owner = await person(h);
    const acc = await shared(h, owner, owner.personalId);
    const link = await linkOn(h, owner, owner.personalId);
    const viewer = await viewerOf(h, link.token);
    expect((await revoke(h, owner)).status).toBe(200);

    expect((await inviteAccountant(h, owner, owner.personalId, 'second@books.ps')).status).toBe(404);
    expect((await createLink(h, owner, owner.personalId)).status).toBe(404);
    // What exists keeps working.
    expect((await h.app.request('/v1/expenses', { headers: acc.on(owner.personalId) })).status).toBe(200);
    expect((await entriesOf(h, viewer)).status).toBe(200);
    // ...and the owner can still see and revoke it.
    const [g] = (await read(await accountantsOf(h, owner))).items;
    expect((await h.app.request(`/v1/profiles/${owner.personalId}/accountants/${g.id}`, { method: 'DELETE', headers: owner.auth })).status).toBe(204);
    expect((await revokeLink(h, owner, owner.personalId, link.id)).status).toBe(204);
    expect((await h.app.request('/v1/expenses', { headers: acc.on(owner.personalId) })).status).toBe(404);
  });

  it('an accountant needs no feature: accept, client books and the client feed work without it', async () => {
    const h = accountantHarness();
    const owner = await person(h);
    const acc = await person(h, { sharing: false });
    expect((await inviteAccountant(h, owner, owner.personalId, acc.email)).status).toBe(201);
    expect((await acceptInvite(h, acc, inviteTokenFor(h, acc.email))).status).toBe(200);
    expect((await read(await h.app.request('/v1/me', { headers: acc.auth }))).clients).toHaveLength(1);
    expect((await h.app.request('/v1/clients', { headers: acc.auth })).status).toBe(200);
    expect((await h.app.request('/v1/profile-entries', { headers: acc.on(owner.personalId) })).status).toBe(200);
  });

  it('the env switch still wins: off, even a feature holder gets 404', async () => {
    const h = accountantHarness({ accountantAccess: false, shareLinks: false });
    const owner = await person(h);
    expect((await inviteAccountant(h, owner, owner.personalId, 'hadi@books.ps')).status).toBe(404);
    expect((await h.app.request(`/v1/profiles/${owner.personalId}/share-links`, json({ period: 'LAST_1_MONTH', expiresInDays: 7, pin: '2468' }, owner.auth))).status).toBe(404);
  });
});
