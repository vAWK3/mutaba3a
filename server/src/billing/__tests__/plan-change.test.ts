import { describe, expect, it } from 'vitest';
import { planChangeOf, planChangeOptionsOf, type PlanChangeCurrent } from '../plan-change.js';

/** MUT-734 (ADR-291): every row of the plan-change decision. */
const END = new Date('2026-12-15T00:00:00Z');
const current = (over: Partial<PlanChangeCurrent> = {}): PlanChangeCurrent => ({
  tier: 'SOLO',
  status: 'active',
  currentPeriodEnd: END,
  paused: false,
  cancelAtPeriodEnd: false,
  managedBySchedule: false,
  scheduled: false,
  ...over,
});
const B = ['b1', 'b2', 'b3'];

describe('planChangeOf', () => {
  it('up a rank is an upgrade, now', () => {
    expect(planChangeOf({ current: current(), target: 'business', ownedBusinesses: [], chosenActive: null })).toEqual({ kind: 'upgrade' });
    expect(planChangeOf({ current: current({ tier: 'BUSINESS' }), target: 'firm', ownedBusinesses: [], chosenActive: null })).toEqual({ kind: 'upgrade' });
    expect(planChangeOf({ current: current({ status: 'trialing' }), target: 'firm', ownedBusinesses: [], chosenActive: null })).toEqual({ kind: 'upgrade' });
  });

  it('down to a lower paid plan waits for the period end; within the cap nothing turns read-only', () => {
    expect(planChangeOf({ current: current({ tier: 'FIRM' }), target: 'business', ownedBusinesses: ['b1', 'b2', 'b3'], chosenActive: null })).toEqual({ kind: 'downgrade', effectiveAt: END, cap: 3, active: B, readOnly: [] });
  });

  it('below the business count: a pick is required (cap - 1, cap, cap + 1)', () => {
    const firm = current({ tier: 'BUSINESS' });
    expect(planChangeOf({ current: firm, target: 'solo', ownedBusinesses: [], chosenActive: null })).toMatchObject({ kind: 'downgrade', readOnly: [] });
    expect(planChangeOf({ current: firm, target: 'solo', ownedBusinesses: ['b1'], chosenActive: null })).toMatchObject({ kind: 'downgrade', active: ['b1'], readOnly: [] });
    expect(planChangeOf({ current: firm, target: 'solo', ownedBusinesses: ['b1', 'b2'], chosenActive: null })).toEqual({ refused: 'ACTIVE_BUSINESSES_REQUIRED', cap: 1 });
    expect(planChangeOf({ current: firm, target: 'solo', ownedBusinesses: ['b1', 'b2'], chosenActive: ['b2'] })).toEqual({ kind: 'downgrade', effectiveAt: END, cap: 1, active: ['b2'], readOnly: ['b1'] });
  });

  it('refuses an invalid pick: someone else’s, repeated, more than the cap, or empty', () => {
    const input = { current: current({ tier: 'FIRM' }), target: 'solo' as const, ownedBusinesses: B };
    for (const chosenActive of [['x'], ['b1', 'b1'], ['b1', 'b2'], []]) expect(planChangeOf({ ...input, chosenActive })).toEqual({ refused: 'ACTIVE_BUSINESSES_REQUIRED', cap: 1 });
  });

  it('to Starter waits for the period end and needs a pick past one business', () => {
    expect(planChangeOf({ current: current(), target: 'starter', ownedBusinesses: ['b1'], chosenActive: null })).toEqual({ kind: 'to_starter', effectiveAt: END, cap: 1, active: ['b1'], readOnly: [] });
    expect(planChangeOf({ current: current({ tier: 'BUSINESS' }), target: 'starter', ownedBusinesses: ['b1', 'b2'], chosenActive: null })).toEqual({ refused: 'ACTIVE_BUSINESSES_REQUIRED', cap: 1 });
  });

  it('refusals, in order', () => {
    const go = (over: Partial<PlanChangeCurrent> | null, target: 'solo' | 'business' = 'business') =>
      planChangeOf({ current: over === null ? null : current(over), target, ownedBusinesses: [], chosenActive: null });
    expect(go(null)).toEqual({ refused: 'NOT_SUBSCRIBED' });
    expect(go({}, 'solo')).toEqual({ refused: 'SAME_PLAN' });
    expect(go({ scheduled: true })).toEqual({ refused: 'SCHEDULE_PENDING' });
    expect(go({ tier: 'FREELANCER' })).toEqual({ refused: 'LEGACY_PLAN' });
    expect(go({ managedBySchedule: true })).toEqual({ refused: 'LEGACY_PLAN' });
    expect(go({ status: 'past_due' })).toEqual({ refused: 'PAST_DUE' });
    expect(go({ status: 'canceled' })).toEqual({ refused: 'NOT_SUBSCRIBED' });
    expect(go({ paused: true })).toEqual({ refused: 'PAUSED' });
    expect(go({ cancelAtPeriodEnd: true })).toEqual({ refused: 'CANCELLING' });
  });
});

describe('planChangeOptionsOf', () => {
  it('lists the plans above and below, Starter last', () => {
    expect(planChangeOptionsOf(current({ tier: 'BUSINESS' }))).toEqual({ canUpgradeTo: ['firm'], canDowngradeTo: ['solo', 'starter'] });
    expect(planChangeOptionsOf(current())).toEqual({ canUpgradeTo: ['business', 'firm'], canDowngradeTo: ['starter'] });
  });

  it('nothing when no change is possible', () => {
    expect(planChangeOptionsOf(null)).toEqual({ canUpgradeTo: [], canDowngradeTo: [] });
    expect(planChangeOptionsOf(current({ tier: 'FREELANCER' }))).toEqual({ canUpgradeTo: [], canDowngradeTo: [] });
  });
});
