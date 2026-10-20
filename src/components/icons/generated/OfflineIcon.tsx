import type { IconProps } from './types';

export function OfflineIcon({ size = 16, className }: IconProps) {
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
    <path d={"M7.5 7.6A6 6 0 0 1 17.7 10a4.5 4.5 0 0 1 2.6 7.4M17 19H7a5 5 0 0 1-2.3-9.4"} data-part="cloud" />
    <path d={"M3 3l15.5 15.5"} data-part="slash" />
    <circle cx={"20.3"} cy={"20.3"} r={"1.5"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
