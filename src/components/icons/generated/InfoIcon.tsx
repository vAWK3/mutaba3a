import type { IconProps } from './types';

export function InfoIcon({ size = 16, className }: IconProps) {
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
    <circle cx={"12"} cy={"12"} r={"9"} data-part="circle" />
    <path d={"M12 11v5.5"} data-part="mark" />
    <circle cx={"12"} cy={"7.5"} r={"1.5"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
