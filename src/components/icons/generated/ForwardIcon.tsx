import type { IconProps } from './types';

export function ForwardIcon({ size = 16, className }: IconProps) {
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
    <path d={"M9 12h10m-6-6 6 6-6 6"} />
    <circle cx={"4.5"} cy={"12"} r={"1.6"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
