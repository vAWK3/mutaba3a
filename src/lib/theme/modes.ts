import type { ThemeMode } from './context';

/** The appearance choices, in the order Settings lists them and the sidebar toggle cycles them (MUT-79). */
export const THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];

/** The mode after `current` in `THEME_MODES`, wrapping from the last back to the first. */
export function nextThemeMode(current: ThemeMode): ThemeMode {
  return THEME_MODES[(THEME_MODES.indexOf(current) + 1) % THEME_MODES.length];
}
