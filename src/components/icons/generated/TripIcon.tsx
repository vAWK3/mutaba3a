import type { IconProps } from './types';

export function TripIcon({ size = 16, className }: IconProps) {
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
    <rect x={"5"} y={"7"} width={"14"} height={"13"} rx={"2.5"} data-part="body" />
    <path d={"M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"} data-part="handle" />
    <circle cx={"12"} cy={"13.5"} r={"1.6"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
