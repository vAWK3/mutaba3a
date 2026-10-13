import { useTheme } from '../../lib/theme';
import markUrl from '../../assets/brand/mark.svg';
import markDarkUrl from '../../assets/brand/mark-dark.svg';

interface BrandMarkProps {
  /** Rendered width and height in CSS pixels. */
  size: number;
  className?: string;
}

/**
 * The Brand v2 mark (MUT-104). It follows the app's own theme, so Light, Dark
 * and System all pick the right file: the dark one swaps the purple dot for
 * butter, which stays visible on the dark canvas. Decorative: the link or
 * heading around it carries the product name. Both files are bundled assets,
 * so the portal serves them from its cached /assets/.
 */
export function BrandMark({ size, className }: BrandMarkProps) {
  const { resolvedTheme } = useTheme();
  return (
    <img
      className={className}
      src={resolvedTheme === 'dark' ? markDarkUrl : markUrl}
      alt=""
      width={size}
      height={size}
      decoding="async"
    />
  );
}
