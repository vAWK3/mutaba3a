import type { IconProps } from './types';

export function SwapVerticalIcon({ size = 16, className }: IconProps) {
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
    <path d={"M7 15V5m-4 4 4-4 4 4M17 7v12m4-4-4 4-4-4"} />
    <circle cx={"7"} cy={"19.5"} r={"1.6"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
