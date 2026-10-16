import { describe, it, expect } from 'vitest';
import en from '../translations/en';
import ar from '../translations/ar';

// MUT-84: the split view's profile pane label and its announcement
const TEXT_KEYS = ['clients.split.profile', 'clients.split.showing'] as const;

function lookup(dict: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], dict);
}

describe('clients split-view i18n keys', () => {
  it.each([
    ['en', en],
    ['ar', ar],
  ] as const)('%s has every key, and the announcement names the client', (_locale, dict) => {
    for (const key of TEXT_KEYS) {
      const value = lookup(dict, key);
      expect(typeof value, key).toBe('string');
      expect(String(value).trim().length, key).toBeGreaterThan(0);
    }
    expect(lookup(dict, 'clients.split.showing')).toContain('{name}');
  });
});
