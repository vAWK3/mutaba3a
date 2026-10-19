import type { IconProps } from './types';

export function InsightsIcon({ size = 16, className }: IconProps) {
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
    <path d={"M3 18l5.5-6 4 3.5 6-6.5"} />
    <circle cx={"20.5"} cy={"7.3"} r={"1.7"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
