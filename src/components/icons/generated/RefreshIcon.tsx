import type { IconProps } from './types';

export function RefreshIcon({ size = 16, className }: IconProps) {
  return (
    <svg
    width={size}
    height={size}
    viewBox={"0 0 24 24"}
    fill={"none"}
    stroke={"currentColor"}
    strokeWidth={2}
    strokeLinecap={"round"}
    strokeLinejoin={"round"}
    className={className}
    >
    <path d={"M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"} />
    <path d={"M18 3v4h-4M6 21v-4h4"} />
    </svg>
  );
}
