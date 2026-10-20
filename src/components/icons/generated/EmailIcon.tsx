import type { IconProps } from './types';

export function EmailIcon({ size = 16, className }: IconProps) {
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
    <rect x={"3"} y={"5"} width={"18"} height={"14"} rx={"3"} data-part="envelope" />
    <path d={"M3.5 6.5l8.5 6.5 8.5-6.5"} data-part="flap" />
    <circle cx={"12"} cy={"16.2"} r={"1.4"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
