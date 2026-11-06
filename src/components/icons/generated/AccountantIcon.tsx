import type { IconProps } from './types';

export function AccountantIcon({ size = 16, className }: IconProps) {
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
    <g data-part="person">
      <circle cx={"12"} cy={"6"} r={"3"} />
      <path d={"M4.5 19.5a7.5 7.5 0 0 1 15 0"} />
    </g>
    <rect x={"8.5"} y={"15"} width={"7"} height={"6.5"} rx={"1.5"} data-part="page" />
    <circle cx={"12"} cy={"18.25"} r={"1.3"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
