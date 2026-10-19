import type { IconProps } from './types';

export function TipIcon({ size = 16, className }: IconProps) {
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
    <path d={"M9.5 17c0-1.2-.5-2-1.4-2.9A6 6 0 1 1 15.9 14.1c-.9.9-1.4 1.7-1.4 2.9z"} data-part="bulb" />
    <path d={"M10 20.5h4"} data-part="base" />
    <circle cx={"12"} cy={"10.5"} r={"1.6"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
