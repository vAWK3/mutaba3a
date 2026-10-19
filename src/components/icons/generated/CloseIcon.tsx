import type { IconProps } from './types';

export function CloseIcon({ size = 16, className }: IconProps) {
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
    <path d={"M6 6l12 12"} data-part="stroke-1" />
    <path d={"M18 6L6 18"} data-part="stroke-2" />
    </svg>
  );
}
