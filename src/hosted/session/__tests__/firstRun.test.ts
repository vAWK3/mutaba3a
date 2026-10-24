import { describe, expect, it } from 'vitest';
import type { Me } from '../../api/client';
import { firstRunPath } from '../firstRun';

/** MUT-368 (D13): where a person lands after their first sign-in from a signup link; MUT-418 opens the trial step there. */

const NOW = new Date('2026-11-01T09:00:00.000Z');
const TRIAL = { state: 'ACTIVE', source: 'TRIAL', tier: 'FREELANCER', until: '2026-11-15T09:00:00.000Z' };
const profile = (id: string, isPersonalDefault: boolean, billing: unknown = null) => ({ id, isPersonalDefault, billing }) as Me['profiles'][number];
const me = (profiles: Me['profiles'], welcomedAt: string | null = null) =>
  ({ user: { status: 'ACTIVE', trialPrompt: { welcomedAt, welcomeAnswer: welcomedAt ? 'skipped' : null, bannerSnoozedUntil: null } }, profiles }) as unknown as Me;

describe('firstRunPath', () => {
  it('is the personal profile’s Home', () => {
    expect(firstRunPath(me([profile('biz', false), profile('mine', true)]), NOW)).toEqual({ to: '/p/mine' });
  });

  it('falls back to Home, which picks a profile or offers to create one', () => {
    expect(firstRunPath(me([profile('biz', false)]), NOW)).toEqual({ to: '/' });
    expect(firstRunPath(me([]), NOW)).toEqual({ to: '/' });
  });

  it('opens Home on the trial step for a new trial with no card (MUT-418)', () => {
    expect(firstRunPath(me([profile('mine', true, TRIAL)]), NOW)).toEqual({ to: '/p/mine', search: { billing: true, step: 'welcome' } });
  });

  it('never twice: an answered step lands on Home', () => {
    expect(firstRunPath(me([profile('mine', true, TRIAL)], NOW.toISOString()), NOW)).toEqual({ to: '/p/mine' });
  });
});
