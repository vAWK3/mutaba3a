import { describe, expect, it } from 'vitest';
import { pilotChipOf } from '../account-list.js';
import type { OperatorPilotGrant } from '../../repositories/ports.js';

/** MUT-757 (ADR-297): the Pilot chip on an operator's account row. */
const d = (day: number) => new Date(Date.UTC(2026, 11, day, 10));
const NASSER = { id: '00000000-0000-4000-8000-0000000000aa', email: 'nasser@firm.ps', displayName: 'Nasser' };
const grant = (over: Partial<OperatorPilotGrant> = {}): OperatorPilotGrant => ({ cohort: 'dec-2026', createdAt: d(1), expiresAt: d(30), revokedAt: null, referredBy: NASSER, ...over });

describe('pilotChipOf', () => {
  it('no pilot grant: no chip', () => {
    expect(pilotChipOf([])).toBeNull();
  });

  it('one running pilot: its cohort, start, end and accountant', () => {
    expect(pilotChipOf([grant()])).toEqual({ cohort: 'dec-2026', startedAt: d(1), endsAt: d(30), referredBy: NASSER });
  });

  it('an extension (revoked first grant, new one): the new end, the first start', () => {
    const first = grant({ revokedAt: d(20) });
    const extended = grant({ cohort: 'dec-2026-ext', createdAt: d(20), expiresAt: d(31 + 28), referredBy: null });
    expect(pilotChipOf([first, extended])).toEqual({ cohort: 'dec-2026-ext', startedAt: d(1), endsAt: d(31 + 28), referredBy: null });
  });

  it('a pilot revoked before its expiry ended at the revoke', () => {
    expect(pilotChipOf([grant({ revokedAt: d(10) })])!.endsAt).toEqual(d(10));
  });
});
