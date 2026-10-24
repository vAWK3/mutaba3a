import { describe, expect, it } from 'vitest';
import { decidePurge, purgeAuditRows, transferTargetOf, type PurgeCandidate, type PurgeProfile } from '../purge-plan.js';

const ME = '00000000-0000-4000-8000-000000000001';
const at = (day: number) => new Date(Date.UTC(2026, 9, day));
const candidate = (userId: string, overrides: Partial<PurgeCandidate> = {}): PurgeCandidate => ({
  userId,
  role: 'OWNER',
  status: 'ACTIVE',
  deleteAfter: null,
  membershipCreatedAt: at(1),
  ...overrides,
});
const personal: PurgeProfile = { id: 'p-personal', ownerUserId: ME, personalOwnerUserId: ME, profileType: 'PERSONAL' };
const business = (id: string): PurgeProfile => ({ id, ownerUserId: ME, personalOwnerUserId: null, profileType: 'BUSINESS' });
const firm = (id: string): PurgeProfile => ({ id, ownerUserId: null, personalOwnerUserId: null, profileType: null });
const someoneElses = (id: string): PurgeProfile => ({ id, ownerUserId: 'someone', personalOwnerUserId: null, profileType: 'BUSINESS' });

describe('transferTargetOf (R10)', () => {
  it('prefers an ACTIVE co-owner who is not closing, oldest membership first', () => {
    expect(transferTargetOf([candidate('b', { membershipCreatedAt: at(5) }), candidate('a', { membershipCreatedAt: at(3) })])).toBe('a');
  });

  it('passes over a disabled co-owner for an active one, and a closing one for a disabled one', () => {
    expect(transferTargetOf([candidate('disabled', { status: 'DISABLED', membershipCreatedAt: at(1) }), candidate('active', { membershipCreatedAt: at(9) })])).toBe('active');
    expect(transferTargetOf([candidate('closing', { deleteAfter: at(20) }), candidate('disabled', { status: 'DISABLED' })])).toBe('disabled');
  });

  it('when every co-owner is closing, picks the one deleted last', () => {
    expect(transferTargetOf([candidate('soon', { deleteAfter: at(10) }), candidate('later', { deleteAfter: at(25) })])).toBe('later');
  });

  it('never picks a member who is not an owner, and answers null with no owner', () => {
    expect(transferTargetOf([candidate('bookkeeper', { role: 'BOOKKEEPER' })])).toBeNull();
    expect(transferTargetOf([])).toBeNull();
  });

  it('breaks a full tie by user id, so both stores choose alike', () => {
    expect(transferTargetOf([candidate('b'), candidate('a')])).toBe('a');
  });
});

describe('decidePurge (D6, R10)', () => {
  it('deletes the personal profile and a business profile nobody else owns', () => {
    const decision = decidePurge(ME, [personal, business('p-solo')], () => []);
    expect(decision).toEqual({ deleteProfileIds: ['p-personal', 'p-solo'], transfers: [], leaveProfileIds: [] });
  });

  it('never deletes a business profile with a co-owner: it passes to them', () => {
    const decision = decidePurge(ME, [business('p-shared')], (id) => (id === 'p-shared' ? [candidate('partner')] : []));
    expect(decision).toEqual({ deleteProfileIds: [], transfers: [{ organizationId: 'p-shared', toUserId: 'partner' }], leaveProfileIds: [] });
  });

  it('deletes the personal profile even with another member, since it is never co-owned', () => {
    const decision = decidePurge(ME, [personal], () => [candidate('someone')]);
    expect(decision.deleteProfileIds).toEqual(['p-personal']);
  });

  it('leaves firms, Malafat-fed profiles and someone else’s profiles: only the membership goes', () => {
    const decision = decidePurge(ME, [firm('p-firm'), someoneElses('p-theirs')], () => {
      throw new Error('never asked about a profile the person did not create');
    });
    expect(decision).toEqual({ deleteProfileIds: [], transfers: [], leaveProfileIds: ['p-firm', 'p-theirs'] });
  });
});

describe('purgeAuditRows (D8)', () => {
  it('writes a tombstone on every surviving profile and a transfer row, naming no email or name', () => {
    const rows = purgeAuditRows(ME, { deleteProfileIds: ['p-gone'], transfers: [{ organizationId: 'p-shared', toUserId: 'partner' }], leaveProfileIds: ['p-firm'] });
    expect(rows.map((r) => [r.organizationId, r.action])).toEqual([
      ['p-shared', 'organization.owner_transferred'],
      ['p-firm', 'user.deleted'],
      ['p-shared', 'user.deleted'],
    ]);
    expect(rows.every((r) => r.actorType === 'SYSTEM' && r.actorId === null)).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/@|displayName|email/);
  });
});
