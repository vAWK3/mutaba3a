import type { IconProps } from './types';

export function SuccessIcon({ size = 16, className }: IconProps) {
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
    <circle cx={"12"} cy={"12"} r={"9"} data-part="ring" />
    <path d={"M8 12l3 3 5-6"} data-part="check" />
    </svg>
  );
}
