import type { IconProps } from './types';

export function BackspaceIcon({ size = 16, className }: IconProps) {
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
    <path d={"M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7z"} data-part="key" />
    <path d={"M11.5 9.5l5 5M16.5 9.5l-2.3 2.3"} data-part="arrow" />
    <circle cx={"11.9"} cy={"14.1"} r={"1.4"} fill={"currentColor"} stroke={"none"} data-part="nuqta" />
    </svg>
  );
}
