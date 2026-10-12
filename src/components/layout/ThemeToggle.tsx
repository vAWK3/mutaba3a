import type { ComponentType } from 'react';
import { useT } from '../../lib/i18n';
import { useTheme, nextThemeMode, type ThemeMode } from '../../lib/theme';

/**
 * The sidebar footer's appearance switch, beside Settings (MUT-79). Each
 * press moves to the next of Light, Dark and System, the same modes and the
 * same state as Settings → Theme. The button is named after the current mode.
 */
export function ThemeToggle() {
  const t = useT();
  const { theme, setTheme } = useTheme();
  const Icon = modeIcons[theme];
  const label = t('nav.theme', { mode: t(`settings.theme.${theme}`) });

  return (
    <button
      type="button"
      className="sidebar-theme-toggle"
      onClick={() => setTheme(nextThemeMode(theme))}
      aria-label={label}
      title={label}
    >
      <Icon />
    </button>
  );
}

function SunIcon() {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path strokeLinecap="round" d="M12 2.75v1.5m0 15.5v1.5M4.75 12h-1.5m17.5 0h-1.5M6.87 6.87 5.81 5.81m12.38 12.38-1.06-1.06M6.87 17.13l-1.06 1.06M18.19 5.81l-1.06 1.06" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 0 1 8.646 3.646 9.003 9.003 0 0 0 12 21a9.003 9.003 0 0 0 8.354-5.646Z" />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="12" rx="1.5" />
      <path strokeLinecap="round" d="M9 20.25h6M12 16.5v3.75" />
    </svg>
  );
}

const modeIcons: Record<ThemeMode, ComponentType> = {
  light: SunIcon,
  dark: MoonIcon,
  system: SystemIcon,
};
