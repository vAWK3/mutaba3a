import type { IconProps } from './types';

export function OverflowIcon({ size = 16, className }: IconProps) {
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
    <circle cx={"12"} cy={"5"} r={"1"} />
    <circle cx={"12"} cy={"12"} r={"1.8"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    <circle cx={"12"} cy={"19"} r={"1"} />
    </svg>
  );
}
