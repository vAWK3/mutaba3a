/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export interface ThemeContextValue {
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemeMode) => void;
}

const STORAGE_KEY = 'mutaba3a-theme';

/**
 * Get the system's preferred color scheme
 */
function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Get the initial theme from localStorage or default to 'system'
 */
function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'system';

  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored;
  }

  return 'system';
}

/**
 * Resolve theme mode to actual light/dark value
 */
function resolveTheme(theme: ThemeMode): ResolvedTheme {
  if (theme === 'system') {
    return getSystemTheme();
  }
  return theme;
}

// Context
const ThemeContext = createContext<ThemeContextValue | null>(null);

// Provider Props
interface ThemeProviderProps {
  children: ReactNode;
}

/**
 * ThemeProvider - Provides theme context to the entire app
 *
 * Features:
 * - Supports light, dark, and system (auto) modes
 * - Persists theme choice to localStorage
 * - Updates <html> data-theme attribute for CSS targeting
 * - Listens for system theme changes when in 'system' mode
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeMode>(getInitialTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(getInitialTheme()));

  // Apply theme to document and handle system preference changes
  useEffect(() => {
    const resolved = resolveTheme(theme);
    setResolvedTheme(resolved);

    // Apply data-theme attribute for CSS targeting
    if (theme === 'system') {
      // Remove data-theme to let media query handle it
      document.documentElement.removeAttribute('data-theme');
    } else {
      // Set explicit theme
      document.documentElement.setAttribute('data-theme', theme);
    }

    // Persist to localStorage
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  // Listen for system theme changes when in 'system' mode
  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (e: MediaQueryListEvent) => {
      setResolvedTheme(e.matches ? 'dark' : 'light');
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  // Theme setter
  const setTheme = useCallback((newTheme: ThemeMode) => {
    setThemeState(newTheme);
  }, []);

  const contextValue: ThemeContextValue = {
    theme,
    resolvedTheme,
    setTheme,
  };

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * useTheme - Access the theme context
 *
 * Returns: { theme, resolvedTheme, setTheme }
 * - theme: The current theme mode ('light' | 'dark' | 'system')
 * - resolvedTheme: The actual theme being applied ('light' | 'dark')
 * - setTheme: Function to change the theme
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
