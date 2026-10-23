import type { CSSProperties, ReactNode } from 'react';
import { BrandMark } from './BrandMark';
import './Logotype.css';

/** The mark's default size: the kit minimum, so the logotype beside it is 12px (H = 0.40 M; eng D3). */
const DEFAULT_MARK_SIZE = 30;

interface WordmarkProps {
  /** The product name as this surface writes it (each surface has its own copy key). */
  name: ReactNode;
  /** The mark's width and height in CSS pixels; also sizes the logotype (Logotype.css). At least 30. */
  markSize?: number;
  className?: string;
  markClassName?: string;
}

/**
 * The Brand v2 lockup: the theme-aware mark beside the product name (MUT-104).
 * Shared by the portal and the landing header (MUT-77); each passes its own
 * name and styles. The mark size reaches the CSS as one px custom property,
 * the only source of M, set through the CSSOM so the portal CSP allows it
 * (MUT-402 D2, design D7).
 */
export function Wordmark({ name, markSize = DEFAULT_MARK_SIZE, className = '', markClassName = '' }: WordmarkProps) {
  return (
    <span className={`wordmark ${className}`.trim()} style={{ '--wordmark-mark': `${markSize}px` } as CSSProperties}>
      <BrandMark size={markSize} className={`wordmark-mark ${markClassName}`.trim()} />
      {name}
    </span>
  );
}
