import { describe, expect, it } from 'vitest';
import { clientRows, type ClientProfileFacts } from '../grants.js';
import type { AccountantGrantRecord, Organization } from '../../repositories/ports.js';

/**
 * MUT-575 (ADR-249, plan test 1): which clients an accountant's list shows, pure. Ended is computed from the grant's
 * status and the owner's closure, never stored; a dismissed or LEFT grant is never listed.
 */
const at = (day: number) => new Date(Date.UTC(2026, 10, day, 9, 0, 0));
const ACC = '00000000-0000-4000-8000-0000000000ac';
let seq = 0;

function grant(organizationId: string, over: Partial<AccountantGrantRecord> = {}): AccountantGrantRecord {
  return {
    id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
    organizationId,
    inviteEmail: 'hadi@books.ps',
    locale: 'en',
    invitedByUserId: null,
    accountantUserId: ACC,
    status: 'ACTIVE',
    tokenDigest: null,
    inviteExpiresAt: at(20),
    acceptedAt: at(1),
    revokedAt: null,
    dismissedAt: null,
    lastViewedAt: null,
    createdAt: at(1),
    ...over,
  };
}

function profile(id: string, name: string, closingSince: Date | null = null, profileType: Organization['profileType'] = 'BUSINESS'): [string, ClientProfileFacts] {
  const organization = { id, name, profileType } as Organization;
  return [id, { organization, ownerName: `Owner of ${name}`, closingSince }];
}

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';

describe('clientRows (MUT-575)', () => {
  it('an ACTIVE grant is an active row with the profile, owner and type', () => {
    const rows = clientRows([grant(A)], new Map([profile(A, 'Sader Studio', null, 'PERSONAL')]));
    expect(rows).toEqual([
      { profileId: A, name: 'Sader Studio', ownerName: 'Owner of Sader Studio', profileType: 'personal', sharedSince: at(1).toISOString(), status: 'active', endedReason: null, endedAt: null },
    ]);
  });

  it('a REVOKED grant is ended/revoked, ended when it was revoked', () => {
    const [row] = clientRows([grant(A, { status: 'REVOKED', revokedAt: at(3) })], new Map([profile(A, 'Sader Studio')]));
    expect(row).toMatchObject({ status: 'ended', endedReason: 'revoked', endedAt: at(3).toISOString(), profileType: 'business' });
  });

  it('an ACTIVE grant on a closing owner’s profile is ended/closed, ended when the closure was asked for', () => {
    const [row] = clientRows([grant(A)], new Map([profile(A, 'Sader Studio', at(4))]));
    expect(row).toMatchObject({ status: 'ended', endedReason: 'closed', endedAt: at(4).toISOString() });
  });

  it('never lists a LEFT or a dismissed grant', () => {
    const rows = clientRows([grant(A, { status: 'LEFT', revokedAt: at(2) }), grant(B, { status: 'REVOKED', revokedAt: at(2), dismissedAt: at(3) })], new Map([profile(A, 'A'), profile(B, 'B')]));
    expect(rows).toEqual([]);
  });

  it('a re-invite that was accepted hides the older REVOKED grant on the same profile', () => {
    const rows = clientRows([grant(A, { status: 'REVOKED', revokedAt: at(2) }), grant(A, { acceptedAt: at(5) })], new Map([profile(A, 'A')]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'active', sharedSince: at(5).toISOString() });
  });

  it('two REVOKED grants on one profile show once, as the latest', () => {
    const rows = clientRows([grant(A, { status: 'REVOKED', revokedAt: at(2) }), grant(A, { status: 'REVOKED', revokedAt: at(6), acceptedAt: at(4) })], new Map([profile(A, 'A')]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ endedAt: at(6).toISOString(), sharedSince: at(4).toISOString() });
  });

  it('a pending re-invite keeps the ended row (it is not the accountant’s yet)', () => {
    // A pending invite carries no accountant, so it never reaches the accountant's list; the REVOKED row stays.
    const rows = clientRows([grant(A, { status: 'REVOKED', revokedAt: at(2) })], new Map([profile(A, 'A')]));
    expect(rows[0]).toMatchObject({ status: 'ended', endedReason: 'revoked' });
  });

  it('a profile that is gone (purged) has no row', () => {
    expect(clientRows([grant(A)], new Map())).toEqual([]);
  });

  it('lists active first, oldest accept first, then ended, newest end first', () => {
    const rows = clientRows(
      [
        grant(A, { status: 'REVOKED', revokedAt: at(3) }),
        grant(B, { acceptedAt: at(4) }),
        grant(C, { status: 'REVOKED', revokedAt: at(7) }),
        grant('00000000-0000-4000-8000-00000000000d', { acceptedAt: at(2) }),
        grant('00000000-0000-4000-8000-00000000000e', { acceptedAt: at(1) }),
      ],
      new Map([profile(A, 'A'), profile(B, 'B'), profile(C, 'C'), profile('00000000-0000-4000-8000-00000000000d', 'D', at(5)), profile('00000000-0000-4000-8000-00000000000e', 'E')]),
    );
    expect(rows.map((r) => `${r.name}:${r.status}`)).toEqual(['E:active', 'B:active', 'C:ended', 'D:ended', 'A:ended']);
  });
});
