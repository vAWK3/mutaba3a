import type { IconProps } from './types';

export function HomeIcon({ size = 16, className }: IconProps) {
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
    <path d={"M3 11l9-8 9 8"} data-part="roof" />
    <path d={"M5 9.5V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9.5"} data-part="base" />
    <circle cx={"12"} cy={"16"} r={"1.6"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
