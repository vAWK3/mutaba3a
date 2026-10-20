import type { IconProps } from './types';

export function VisibilityIcon({ size = 16, className }: IconProps) {
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
    <path d={"M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"} data-part="eye" />
    <circle cx={"12"} cy={"12"} r={"2.6"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
