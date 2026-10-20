import type { IconProps } from './types';

export function CheckIcon({ size = 16, className }: IconProps) {
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
    <path d={"M5 13l3 3"} data-part="short-stroke" />
    <path d={"M8 16l10-10"} data-part="long-stroke" />
    </svg>
  );
}
