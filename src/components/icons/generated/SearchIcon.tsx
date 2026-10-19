import type { IconProps } from './types';

export function SearchIcon({ size = 16, className }: IconProps) {
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
    <circle cx={"10.5"} cy={"10.5"} r={"6.5"} data-part="circle" />
    <path d={"M15.5 15.5L20 20"} data-part="handle" />
    <circle cx={"8.5"} cy={"8.5"} r={"1.4"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
