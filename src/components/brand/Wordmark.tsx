import { BrandMark } from './BrandMark';

/** The mark's default size, about the cap height of a title-sized name beside it. */
const DEFAULT_MARK_SIZE = 28;

interface WordmarkProps {
  /** The product name as this surface writes it (each surface has its own copy key). */
  name: string;
  /** The mark's width and height in CSS pixels. */
  markSize?: number;
  className?: string;
  markClassName?: string;
}

/**
 * The Brand v2 lockup: the theme-aware mark beside the product name (MUT-104).
 * Shared by the portal and the landing header (MUT-77); each passes its own
 * name and styles.
 */
export function Wordmark({ name, markSize = DEFAULT_MARK_SIZE, className = '', markClassName = '' }: WordmarkProps) {
  return (
    <span className={`wordmark ${className}`.trim()}>
      <BrandMark size={markSize} className={`wordmark-mark ${markClassName}`.trim()} />
      {name}
    </span>
  );
}
