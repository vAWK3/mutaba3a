import type { IconProps } from './types';

export function PersonIcon({ size = 16, className }: IconProps) {
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
    <circle cx={"12"} cy={"7.5"} r={"3.2"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    <path d={"M5 20.5a7 7 0 0 1 14 0"} />
    </svg>
  );
}
