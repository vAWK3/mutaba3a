import type { IconProps } from './types';

export function PeopleIcon({ size = 16, className }: IconProps) {
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
    <g data-part="head-1">
      <circle cx={"9"} cy={"8"} r={"3.5"} />
      <path d={"M3 20a6 6 0 0 1 12 0"} />
    </g>
    <g data-part="head-2">
      <circle cx={"17.5"} cy={"9"} r={"2.2"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
      <path d={"M17.5 14a4.5 4.5 0 0 1 4 6"} />
    </g>
    </svg>
  );
}
