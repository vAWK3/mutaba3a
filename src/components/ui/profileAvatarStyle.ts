import type { CSSProperties } from 'react';

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** A colour the browser can paint. Without CSS.supports (jsdom), hex only. */
function isPaintable(value: string): boolean {
  if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') return CSS.supports('color', value);
  return HEX_COLOR.test(value);
}

/**
 * The inline style for a business avatar (MUT-102). A business with its own
 * colour is painted in it with white initials. Without one, or with one the
 * browser can't read (the field is free text), there is no inline style, so
 * each avatar's stylesheet applies the brand's filled pair
 * (--accent-solid / --on-accent), readable in light and dark.
 */
export function profileAvatarStyle(primaryColor: string | undefined): CSSProperties | undefined {
  return primaryColor && isPaintable(primaryColor) ? { backgroundColor: primaryColor, color: 'white' } : undefined;
}
