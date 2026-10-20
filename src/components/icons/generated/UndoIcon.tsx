import type { IconProps } from './types';

export function UndoIcon({ size = 16, className }: IconProps) {
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
    <path d={"M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H12"} />
    <circle cx={"8.5"} cy={"20"} r={"1.5"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
