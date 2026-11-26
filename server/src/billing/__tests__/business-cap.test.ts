import { describe, expect, it } from 'vitest';
import { applyBusinessCap, businessCapStateOf, enforcedBusinessCapOf } from '../business-cap.js';
import { STARTER_ENTITLEMENT, type Entitlement } from '../entitlement.js';

/** MUT-731 (ADR-284, Basel Q5): Starter keeps one business active; the rest read-only until the person picks. */
const OWNER = 'u1';
const starter = (): Entitlement => ({ ...STARTER_ENTITLEMENT });

describe('businessCapStateOf', () => {
  it('within the cap: everything active, nothing to choose', () => {
    expect(businessCapStateOf(['a'], null, 1)).toEqual({ cap: 1, businesses: ['a'], active: ['a'], readOnly: [], mustChoose: false });
  });

  it('over the cap with no choice: all read-only and the person must pick (no default)', () => {
    expect(businessCapStateOf(['a', 'b'], null, 1)).toMatchObject({ active: [], readOnly: ['a', 'b'], mustChoose: true });
    expect(businessCapStateOf(['a', 'b'], [], 1).mustChoose).toBe(true);
  });

  it('a choice keeps that one; the others are read-only', () => {
    expect(businessCapStateOf(['a', 'b', 'c'], ['b'], 1)).toMatchObject({ active: ['b'], readOnly: ['a', 'c'], mustChoose: false });
  });

  it('a choice naming a profile no longer theirs is ignored; too many is cut to the cap', () => {
    expect(businessCapStateOf(['a', 'b'], ['gone'], 1).mustChoose).toBe(true);
    expect(businessCapStateOf(['a', 'b'], ['b', 'a'], 1)).toMatchObject({ active: ['b'], readOnly: ['a'] });
  });
});

describe('enforcedBusinessCapOf', () => {
  it('Starter has a cap of 1; the paid plans are not enforced yet (MUT-704)', () => {
    expect(enforcedBusinessCapOf(starter())).toBe(1);
    expect(enforcedBusinessCapOf({ state: 'ACTIVE', tier: 'SOLO' })).toBeNull();
    expect(enforcedBusinessCapOf({ state: 'READ_ONLY', tier: 'STARTER' })).toBeNull();
  });
});

describe('applyBusinessCap', () => {
  it('turns the businesses past the cap READ_ONLY with planLimit, leaving the personal profile alone', () => {
    const entitlements = new Map<string, Entitlement>([
      ['personal', starter()],
      ['a', starter()],
      ['b', starter()],
    ]);
    const states = applyBusinessCap(entitlements, [{ organizationId: 'a', ownerUserId: OWNER }, { organizationId: 'b', ownerUserId: OWNER }], new Map([[OWNER, ['a']]]));
    expect(entitlements.get('personal')).toEqual(STARTER_ENTITLEMENT);
    expect(entitlements.get('a')).toEqual(STARTER_ENTITLEMENT);
    expect(entitlements.get('b')).toEqual({ ...STARTER_ENTITLEMENT, state: 'READ_ONLY', planLimit: true });
    expect(states.get(OWNER)).toMatchObject({ active: ['a'], readOnly: ['b'], mustChoose: false });
  });

  it('a business covered by something else (a grant on it, Malafat) neither counts nor turns read-only', () => {
    const entitlements = new Map<string, Entitlement>([
      ['a', starter()],
      ['b', { state: 'ACTIVE', source: 'OPERATOR', tier: 'SOLO', until: null }],
      ['c', { state: 'ACTIVE', source: 'MALAFAT', tier: null, until: null }],
    ]);
    const owned = ['a', 'b', 'c'].map((organizationId) => ({ organizationId, ownerUserId: OWNER }));
    applyBusinessCap(entitlements, owned, new Map());
    expect([...entitlements.values()].every((e) => e.state === 'ACTIVE')).toBe(true);
  });

  it('owners are independent', () => {
    const entitlements = new Map<string, Entitlement>([
      ['a', starter()],
      ['x', starter()],
      ['y', starter()],
    ]);
    applyBusinessCap(
      entitlements,
      [
        { organizationId: 'a', ownerUserId: OWNER },
        { organizationId: 'x', ownerUserId: 'u2' },
        { organizationId: 'y', ownerUserId: 'u2' },
      ],
      new Map(),
    );
    expect(entitlements.get('a')!.state).toBe('ACTIVE');
    expect(entitlements.get('x')!.planLimit).toBe(true);
    expect(entitlements.get('y')!.planLimit).toBe(true);
  });
});
