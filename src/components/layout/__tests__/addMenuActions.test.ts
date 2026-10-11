import { describe, it, expect } from 'vitest';
import { DEFAULT_FEATURES, FEATURE_KEYS, resolveFeatures } from '../../../lib/features/features';
import type { FeatureKey } from '../../../types';
import { visibleAddMenuActions } from '../addMenuActions';

describe('visibleAddMenuActions (MUT-15)', () => {
  it('offers Income and Client while every area is off', () => {
    expect(visibleAddMenuActions(DEFAULT_FEATURES)).toEqual(['income', 'client']);
  });

  it('appends Expense while expenses is on', () => {
    expect(visibleAddMenuActions(resolveFeatures({ expenses: true }))).toEqual(['income', 'client', 'expense']);
  });

  it('appends Project while projects is on', () => {
    expect(visibleAddMenuActions(resolveFeatures({ projects: true }))).toEqual(['income', 'client', 'project']);
  });

  it('lists all four, core first, while both are on', () => {
    expect(visibleAddMenuActions(resolveFeatures({ expenses: true, projects: true }))).toEqual([
      'income',
      'client',
      'expense',
      'project',
    ]);
  });

  it('never moves a core action, whatever combination of areas is on', () => {
    for (let mask = 0; mask < 2 ** FEATURE_KEYS.length; mask++) {
      const stored: Partial<Record<FeatureKey, boolean>> = {};
      FEATURE_KEYS.forEach((key, bit) => {
        stored[key] = (mask & (1 << bit)) !== 0;
      });
      const actions = visibleAddMenuActions(resolveFeatures(stored));
      expect(actions.slice(0, 2)).toEqual(['income', 'client']);
    }
  });
});
