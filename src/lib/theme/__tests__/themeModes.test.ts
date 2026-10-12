import { describe, it, expect } from 'vitest';
import { THEME_MODES, nextThemeMode } from '../modes';

describe('theme modes (MUT-79)', () => {
  it('lists light, dark and system, in the order Settings shows them', () => {
    expect(THEME_MODES).toEqual(['light', 'dark', 'system']);
  });

  it('cycles light → dark → system → light', () => {
    expect(nextThemeMode('light')).toBe('dark');
    expect(nextThemeMode('dark')).toBe('system');
    expect(nextThemeMode('system')).toBe('light');
  });
});
