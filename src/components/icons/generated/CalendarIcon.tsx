import type { IconProps } from './types';

export function CalendarIcon({ size = 16, className }: IconProps) {
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
    <g data-part="grid">
      <rect x={"3"} y={"5"} width={"18"} height={"16"} rx={"3"} />
      <path d={"M3 10h18"} />
    </g>
    <path d={"M8 3v4M16 3v4"} data-part="binding" />
    <circle cx={"15.5"} cy={"15.5"} r={"1.6"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
