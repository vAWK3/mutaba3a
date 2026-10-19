import type { IconProps } from './types';

export function GridIcon({ size = 16, className }: IconProps) {
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
    <rect x={"3"} y={"3"} width={"7"} height={"7"} rx={"2"} data-part="sq-1" />
    <rect x={"14"} y={"3"} width={"7"} height={"7"} rx={"2"} data-part="sq-2" />
    <rect x={"3"} y={"14"} width={"7"} height={"7"} rx={"2"} data-part="sq-3" />
    <circle cx={"17.5"} cy={"17.5"} r={"2.6"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
