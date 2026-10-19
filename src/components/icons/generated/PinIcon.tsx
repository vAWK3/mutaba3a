import type { IconProps } from './types';

export function PinIcon({ size = 16, className }: IconProps) {
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
    <circle cx={"12"} cy={"8"} r={"4.5"} data-part="head" />
    <path d={"M9.5 12L7 19.5h10L14.5 12"} strokeLinejoin={"round"} data-part="tip" />
    </svg>
  );
}
