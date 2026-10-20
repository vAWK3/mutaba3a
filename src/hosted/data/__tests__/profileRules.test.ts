import { describe, it, expect } from 'vitest';
import { canCreateProfile, changedFields, firmRequestState, profileEditability, profileKindKey } from '../profileRules';
import { me, profile } from '../../__tests__/harness';

const firm = profile();
const writerNullFirm = profile({ writerOfRecord: null });
const builtIn = profile({ writerOfRecord: null, owned: true, type: 'PERSONAL', isPersonalDefault: true });
const ownedPersonal = profile({ writerOfRecord: null, owned: true, type: 'PERSONAL' });
const ownedBusiness = profile({ writerOfRecord: null, owned: true, type: 'BUSINESS' });

describe('canCreateProfile (RU1)', () => {
  // A cap of 3, not 6: the portal must read the server's limit, never hard-code it.
  const withLimits = (ownedProfiles: number) => ({ ...me([]), limits: { ownedProfiles, maxOwnedProfiles: 3 } });

  it('allows a create below the cap', () => {
    expect(canCreateProfile(withLimits(2))).toBe(true);
  });

  it('refuses at or over the cap', () => {
    expect(canCreateProfile(withLimits(3))).toBe(false);
    expect(canCreateProfile(withLimits(4))).toBe(false);
  });
});

describe('profileEditability (RU2)', () => {
  it('marks a Malafat-fed profile read-only with the Malafat reason', () => {
    expect(profileEditability(firm)).toEqual({ editable: false, reason: 'MALAFAT' });
  });

  it('marks an operator-provisioned profile the user does not own read-only with the operator reason (MUT-300 D5)', () => {
    expect(profileEditability(writerNullFirm)).toEqual({ editable: false, reason: 'OPERATOR' });
  });

  it('lets the owner edit, and locks the type only on the built-in Personal profile', () => {
    expect(profileEditability(ownedBusiness)).toEqual({ editable: true, typeLocked: false });
    expect(profileEditability(ownedPersonal)).toEqual({ editable: true, typeLocked: false });
    expect(profileEditability(builtIn)).toEqual({ editable: true, typeLocked: true });
  });
});

describe('profileKindKey (RU3)', () => {
  it('names each of the five kinds', () => {
    expect(profileKindKey(firm)).toBe('hosted.shell.switcher.sourceMalafat');
    expect(profileKindKey(writerNullFirm)).toBe('hosted.shell.switcher.sourceExpensesOnly');
    expect(profileKindKey(builtIn)).toBe('hosted.profiles.kind.builtIn');
    expect(profileKindKey(ownedPersonal)).toBe('hosted.profiles.kind.personal');
    expect(profileKindKey(ownedBusiness)).toBe('hosted.profiles.kind.business');
  });
});

describe('changedFields (RU4)', () => {
  const current = { ...ownedPersonal, name: 'Side gigs', defaultCurrency: 'ILS' as const };

  it('sends only what changed, with the name trimmed', () => {
    expect(changedFields(current, { name: ' Side gigs ', defaultCurrency: 'USD', type: 'PERSONAL' })).toEqual({ defaultCurrency: 'USD' });
    expect(changedFields(current, { name: 'Studio', defaultCurrency: 'ILS', type: 'BUSINESS' })).toEqual({ name: 'Studio', type: 'BUSINESS' });
  });

  it('is empty when nothing changed', () => {
    expect(changedFields(current, { name: 'Side gigs', defaultCurrency: 'ILS', type: 'PERSONAL' })).toEqual({});
  });

  it('never sends a type for the built-in Personal profile', () => {
    expect(changedFields({ ...builtIn, name: 'Personal' }, { name: 'Personal', defaultCurrency: 'ILS', type: 'BUSINESS' })).toEqual({});
  });
});

describe('firmRequestState (MUT-300)', () => {
  it('offers the request only on an owned Business profile that is not the built-in one', () => {
    expect(firmRequestState(ownedBusiness)).toBe('offer');
    expect(firmRequestState(ownedPersonal)).toBe('hidden');
    expect(firmRequestState(builtIn)).toBe('hidden');
    expect(firmRequestState(writerNullFirm)).toBe('hidden');
    expect(firmRequestState(firm)).toBe('hidden');
  });

  it('shows a pending request as requested, and nothing once firm features are on', () => {
    expect(firmRequestState({ ...ownedBusiness, firmRequestedAt: '2026-10-20T09:00:00.000Z' })).toBe('requested');
    expect(firmRequestState({ ...ownedBusiness, firm: true, role: 'OWNER' })).toBe('hidden');
  });

  it('hides the request when an older server sends no firm fields (it has no route to take it)', () => {
    const older: Partial<typeof ownedBusiness> = { ...ownedBusiness };
    delete older.firm;
    delete older.firmRequestedAt;
    expect(firmRequestState(older as typeof ownedBusiness)).toBe('hidden');
  });
});
