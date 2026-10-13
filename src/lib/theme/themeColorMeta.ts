import { color, colorDark } from '../../styles/brand/mutaba3a.tokens.json';
import type { ResolvedTheme, ThemeMode } from './context';

const CANVAS: Record<ResolvedTheme, string> = { light: color.canvas.hex, dark: colorDark.canvas.hex };

/** The scheme a head meta was written for, from its `media` query. */
function schemeOf(meta: HTMLMetaElement): ResolvedTheme {
  return /dark/.test(meta.getAttribute('media') ?? '') ? 'dark' : 'light';
}

/**
 * Keeps <meta name="theme-color"> in step with the app's theme (MUT-104, D6).
 * The heads hold one meta per OS scheme. An explicit Light or Dark paints both
 * with that canvas, so Safari's tab bar and an installed app's title bar match
 * the app; System gives each meta back its own scheme's canvas. DOM only; a
 * page without the metas is left alone.
 */
export function syncThemeColorMeta(theme: ThemeMode): void {
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    meta.content = CANVAS[theme === 'system' ? schemeOf(meta) : theme];
  });
}
