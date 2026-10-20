import type { IconProps } from './types';

export function LogoutIcon({ size = 16, className }: IconProps) {
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
    <path d={"M10 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"} data-part="door" />
    <path d={"M16 7l5 5-5 5M21 12h-8"} data-part="arrow" />
    <circle cx={"9"} cy={"12"} r={"1.5"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
