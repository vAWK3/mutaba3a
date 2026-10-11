import { describe, it, expect } from 'vitest';
import {
  FEATURE_KEYS,
  DEFAULT_FEATURES,
  resolveFeatures,
  withFeature,
  featuresTurnedOff,
  FEATURE_DATA_PROBES,
} from '../features';

describe('feature vocabulary', () => {
  it('lists the six optional areas in display order', () => {
    expect([...FEATURE_KEYS]).toEqual([
      'invoices',
      'retainers',
      'expenses',
      'insights',
      'planning',
      'projects',
    ]);
  });

  it('defaults every area to off and nothing else', () => {
    expect(Object.keys(DEFAULT_FEATURES).sort()).toEqual([...FEATURE_KEYS].sort());
    for (const key of FEATURE_KEYS) {
      expect(DEFAULT_FEATURES[key]).toBe(false);
    }
  });

  it('names the probed tables for every key, none for insights, and vendors under expenses', () => {
    expect(Object.keys(FEATURE_DATA_PROBES).sort()).toEqual([...FEATURE_KEYS].sort());
    expect(FEATURE_DATA_PROBES.insights).toEqual([]);
    expect(FEATURE_DATA_PROBES.expenses.map((p) => p.table)).toEqual(['expenses', 'vendors']);
    // Projects have no soft delete (archivedAt only), so any row counts
    expect(FEATURE_DATA_PROBES.projects).toEqual([{ table: 'projects', softDelete: false }]);
  });
});

describe('resolveFeatures', () => {
  it('returns the defaults for undefined, null and an empty object', () => {
    expect(resolveFeatures(undefined)).toEqual(DEFAULT_FEATURES);
    expect(resolveFeatures(null)).toEqual(DEFAULT_FEATURES);
    expect(resolveFeatures({})).toEqual(DEFAULT_FEATURES);
  });

  it('keeps a stored true and defaults the rest', () => {
    const flags = resolveFeatures({ projects: true });
    expect(flags.projects).toBe(true);
    for (const key of FEATURE_KEYS) {
      if (key !== 'projects') expect(flags[key]).toBe(false);
    }
  });

  it('drops unknown keys', () => {
    const flags = resolveFeatures({ bogus: true } as unknown as Record<string, boolean>);
    expect(Object.keys(flags).sort()).toEqual([...FEATURE_KEYS].sort());
    expect((flags as Record<string, boolean>).bogus).toBeUndefined();
  });

  it('coerces non-boolean values to off, never on by accident', () => {
    const flags = resolveFeatures({ expenses: 'yes', invoices: 1 } as unknown as Record<string, boolean>);
    expect(flags.expenses).toBe(false);
    expect(flags.invoices).toBe(false);
  });
});

describe('withFeature', () => {
  it('returns a new map with only that key changed and leaves the input untouched', () => {
    const before = resolveFeatures({ projects: true });
    const after = withFeature(before, 'expenses', true);
    expect(after).not.toBe(before);
    expect(after.expenses).toBe(true);
    expect(after.projects).toBe(true);
    expect(before.expenses).toBe(false);
    expect(Object.keys(after).sort()).toEqual([...FEATURE_KEYS].sort());
  });

  it('can switch a key off again', () => {
    const on = withFeature(DEFAULT_FEATURES, 'retainers', true);
    expect(withFeature(on, 'retainers', false)).toEqual(DEFAULT_FEATURES);
  });
});

describe('featuresTurnedOff (MUT-15)', () => {
  it('is empty when nothing changed', () => {
    const flags = resolveFeatures({ expenses: true });
    expect(featuresTurnedOff(flags, resolveFeatures({ expenses: true }))).toEqual([]);
  });

  it('names a key that went from on to off', () => {
    expect(featuresTurnedOff(resolveFeatures({ expenses: true }), DEFAULT_FEATURES)).toEqual(['expenses']);
  });

  it('ignores keys that were switched on', () => {
    expect(featuresTurnedOff(DEFAULT_FEATURES, resolveFeatures({ projects: true, insights: true }))).toEqual([]);
  });

  it('lists several keys in FEATURE_KEYS order', () => {
    const before = resolveFeatures({ projects: true, invoices: true, planning: true });
    expect(featuresTurnedOff(before, DEFAULT_FEATURES)).toEqual(['invoices', 'planning', 'projects']);
  });

  it('reports only the key that went off when another went on', () => {
    const before = resolveFeatures({ retainers: true });
    const after = resolveFeatures({ expenses: true });
    expect(featuresTurnedOff(before, after)).toEqual(['retainers']);
  });
});
