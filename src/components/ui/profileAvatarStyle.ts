import type { CSSProperties } from 'react';

/**
 * The inline style for a business avatar (MUT-102). A business with its own
 * colour is painted in it with white initials. Without one there is no inline
 * style, so each avatar's stylesheet applies the brand's filled pair
 * (--accent-solid / --on-accent), readable in light and dark.
 */
export function profileAvatarStyle(primaryColor: string | undefined): CSSProperties | undefined {
  return primaryColor ? { backgroundColor: primaryColor, color: 'white' } : undefined;
}
