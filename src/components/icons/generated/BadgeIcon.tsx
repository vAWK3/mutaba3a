import type { IconProps } from './types';

export function BadgeIcon({ size = 16, className }: IconProps) {
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
    <g data-part="card">
      <rect x={"3"} y={"6"} width={"18"} height={"15"} rx={"3"} />
      <path d={"M8.5 17h7"} />
    </g>
    <path d={"M9 6V3h6v3"} data-part="ribbon" />
    <circle cx={"12"} cy={"12"} r={"2.2"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
